/**
 * Glue between the pure planning/credential/env modules and VS Code's
 * `McpServerDefinitionProvider` contract (Task 2/3/4).
 *
 * Deliberately has NO value-level dependency on the `vscode` module — it deals
 * only in plain data ({@link PlannedDefinition}, `Record<string,string>` env
 * maps) and injected dependencies ({@link ProviderDeps}), so it is fully unit
 * testable in a plain Node process (Task 7). `extension.ts` is the only file
 * that imports `vscode` by value; it adapts this class's output into real
 * `vscode.McpStdioServerDefinition` instances and wires `resolveMcpServerDefinition`
 * to `resolveEnvForLabel`.
 *
 * Per the verified `vscode.d.ts` (`McpServerDefinitionProvider.provideMcpServerDefinitions`
 * doc comment): "the editor will call this method eagerly... extensions should
 * not take actions which would require user interaction, such as
 * authentication." Credential resolution therefore happens ONLY in
 * {@link resolveEnvForLabel} (VS Code's `resolveMcpServerDefinition`), never in
 * {@link providePlannedDefinitions}.
 */
import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { planDefinitions, PACKAGE_DIR_NAME, PACKAGE_NPM_NAME, type DefinitionPlan } from "./definitions.js";
import { resolveServerCredentials, type CredentialResult } from "./credentials.js";
import { synthesizeIrisEnv, buildGovernanceEnv, withOwnedVarsCleared } from "./env.js";
import type {
  AuthApi,
  CancellationTokenLike,
  ConfigScope,
  LauncherSettings,
  ResolvedConnectionProfile,
  ServerManagerApi,
  SuitePackageKey,
} from "./types.js";

/** The skeletal shape `provideMcpServerDefinitions` returns — no credentials, no env yet. */
export interface PlannedDefinition {
  label: string;
  command: string;
  args: string[];
}

/** Dependencies injected into {@link LauncherProvider} — real implementations come from `extension.ts`; fakes come from tests. */
export interface ProviderDeps {
  getServerManagerApi: () => Promise<ServerManagerApi | undefined>;
  authApi: AuthApi;
  getSettings: () => LauncherSettings;
  /** Surfaces ONE clear message to the user (and wherever else the caller wants it logged) — never a toast storm, never thrown. */
  showWarning: (message: string) => void;
}

const NPX_COMMAND = "npx";

/**
 * Guarded `fs` checks for the `irisMcpLauncher.developmentRepoPath` local-spawn
 * path (Story 31.6, Task 2) — ASYNC (31-6-2, Story 32.3). The synchronous
 * `existsSync`/`statSync` pair they replace ran inside
 * `provideMcpServerDefinitions`, which VS Code invokes on the single-threaded
 * extension host: one stat against a nonexistent UNC host measured 1281 ms of
 * extension-host stall (a hung-but-reachable SMB share is far worse), during
 * which EVERY extension in the window freezes. `fs/promises.stat` moves the
 * wait off the event loop, and `resolveSpawnTargets` fans the per-package
 * checks out with `Promise.all` so N packages never cost N serial round-trips.
 * A single awaited `stat` also collapses the old exists-then-stat TOCTOU race
 * (the path could vanish between the two calls). Rejection (ENOENT, EACCES, a
 * broken reparse point) degrades to `false`, so "invalid" and "fs blew up"
 * stay identical for every caller, with no per-call try/catch.
 */
async function isExistingDirectory(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isDirectory();
  } catch {
    return false;
  }
}

async function isExistingFile(candidatePath: string): Promise<boolean> {
  try {
    return (await stat(candidatePath)).isFile();
  } catch {
    return false;
  }
}

export class LauncherProvider {
  private readonly deps: ProviderDeps;
  /** Accepted plans by label, plus whether each spawns the local Electron-as-node interpreter (31-6-3) rather than `npx`. */
  private plansByLabel = new Map<string, { plan: DefinitionPlan; localSpawn: boolean }>();
  /** Configuration scope each Server Manager server name was enumerated in (multi-root workspaces). */
  private scopesByServerName = new Map<string, ConfigScope>();
  /** `server\u0000pathPrefix` pairs already warned about, so the docs' "one-time warning" is literally true. */
  private readonly warnedPathPrefixes = new Set<string>();

  /**
   * Full-text identity of every one-time warning already shown (31-6-1) —
   * covers the stale-"all", no-matching-servers, and aggregated
   * `developmentRepoPath` warnings in `providePlannedDefinitions`, so a
   * second `provide` call (VS Code re-enumerates on activation/MCP refresh,
   * and the status-bar refresh path reuses this provider) cannot re-fire
   * them. Keyed by the full message: identical repeats dedupe, a CHANGED
   * message (e.g. a different offending path) fires again.
   */
  private readonly warnedOnce = new Set<string>();
  /**
   * In-flight credential resolutions keyed by Server Manager server name
   * (31-4-1). VS Code resolves several planned definitions covering the SAME
   * server in parallel (5 packages × N servers), and an un-coalesced cold
   * start fires one `getSession({ createIfNone: true })` per definition —
   * stacking modal credential prompts. Sharing ONE in-flight promise per
   * server gives every concurrent resolver the same round-trip. Evicted when
   * the promise SETTLES (never on completion value), so a cancellation is
   * not cached as a permanent "no" — the next start re-prompts.
   */
  private readonly inFlightCredentials = new Map<string, Promise<CredentialResult>>();

  constructor(deps: ProviderDeps) {
    this.deps = deps;
  }

  /** Show `message` via `showWarning`, but only the first time THIS exact message is produced by this provider (31-6-1). */
  private warnOnce(message: string): void {
    if (this.warnedOnce.has(message)) return;
    this.warnedOnce.add(message);
    this.deps.showWarning(message);
  }

  /**
   * The number of DISTINCT Server Manager servers covered by the currently
   * accepted plans (31-5-2) — the "effective registered" count the status bar
   * reports, as opposed to the raw `irisMcpLauncher.servers.length`, which
   * diverges on duplicates (`["prod","prod"]`) and mistyped names (matched by
   * nothing). Derived from the plans the last `providePlannedDefinitions`
   * actually accepted (post de-dupe, post Server-Manager-roster intersect,
   * post dev-mode fs validation).
   */
  registeredServerCount(): number {
    const names = new Set<string>();
    for (const { plan } of this.plansByLabel.values()) {
      for (const serverName of plan.serverNames) names.add(serverName);
    }
    return names.size;
  }

  /**
   * Resolve credentials for one server, coalescing concurrent resolutions of
   * the SAME server onto one in-flight promise (31-4-1). See the field doc on
   * `inFlightCredentials` for the eviction rule.
   */
  private resolveCredentialsCoalesced(
    api: ServerManagerApi,
    serverName: string,
    namespace: string,
    scope?: ConfigScope,
  ): Promise<CredentialResult> {
    const existing = this.inFlightCredentials.get(serverName);
    if (existing) return existing;
    const promise = resolveServerCredentials(
      api,
      this.deps.authApi,
      serverName,
      namespace,
      scope,
    ).finally(() => {
      this.inFlightCredentials.delete(serverName);
    });
    this.inFlightCredentials.set(serverName, promise);
    return promise;
  }

  /**
   * Enumerate the definitions to register, from Server Manager's current
   * server roster and the extension's settings. Never resolves credentials.
   */
  async providePlannedDefinitions(): Promise<PlannedDefinition[]> {
    const api = await this.deps.getServerManagerApi();
    if (!api) {
      // 31-6-1's dedupe discipline covers this warning too (Story 32.3 code
      // review): 31-5-2's status-bar refresh replans on EVERY configuration
      // change, so an unavailable Server Manager would otherwise re-toast per
      // change — the exact re-fire class 31-6-1 burned down.
      this.warnOnce(
        "IRIS MCP Launcher: the InterSystems Server Manager extension is not available " +
          "(it should be installed automatically as a dependency of this extension). " +
          "No IRIS MCP servers were registered.",
      );
      this.plansByLabel = new Map();
      return [];
    }

    // Reading settings and enumerating Server Manager's roster both touch
    // untrusted input (a hand-edited settings.json) and a third-party API. An
    // exception here would reject `provideMcpServerDefinitions`, so VS Code
    // would surface a generic extension error and register NOTHING — with
    // none of this extension's own messages ever shown.
    let settings: LauncherSettings;
    let availableServers: { name: string; scope?: ConfigScope }[];
    try {
      settings = this.deps.getSettings();
      availableServers = api.getServerNames().map((s) => ({ name: s.name, scope: s.scope }));
    } catch {
      // Same dedupe discipline as the unavailable-API warning above.
      this.warnOnce(
        "IRIS MCP Launcher: could not read the IRIS MCP Launcher settings or the InterSystems " +
          "Server Manager server list. Check that irisMcpLauncher.servers and " +
          "irisMcpLauncher.packages are arrays of strings in your settings. No IRIS MCP servers " +
          "were registered.",
      );
      this.plansByLabel = new Map();
      this.scopesByServerName = new Map();
      return [];
    }

    this.scopesByServerName = new Map(availableServers.map((s) => [s.name, s.scope]));
    const availableServerNames = availableServers.map((s) => s.name);
    const plans = planDefinitions(settings, availableServerNames);

    // AC 31.6.5: a settings.json that still lists the removed "all" key gets
    // exactly one warning naming the removal, independent of everything else
    // below — including when "all" was the user's ONLY selected package (so
    // `settings.packages`/`plans` end up empty after filtering). 31-6-1: via
    // `warnOnce`, so a second provide call cannot re-fire it.
    if (settings.hadStaleAllPackage) {
      this.warnOnce(
        `IRIS MCP Launcher: irisMcpLauncher.packages lists the removed "all" package key. ` +
          `"all" (@iris-mcp/all) ships no dist/bin and could never be started, so it has been ` +
          `dropped. Select the five individual packages instead: admin, data, dev, interop, ops. ` +
          `Any other packages you selected still register normally.`,
      );
    }

    // An explicit `servers` list that matches nothing is a misconfiguration
    // worth naming. An empty `packages`/`servers` list is NOT — that is the
    // documented "everything disabled" intent and stays silent.
    if (plans.length === 0 && settings.packages.length > 0 && settings.servers.length > 0) {
      this.warnOnce(
        `IRIS MCP Launcher: none of the configured irisMcpLauncher.servers entries ` +
          `(${settings.servers.join(", ")}) match a server InterSystems Server Manager currently ` +
          `reports. No IRIS MCP servers were registered.`,
      );
    }

    const { definitions, acceptedPlans } = await this.resolveSpawnTargets(plans, settings.developmentRepoPath);
    this.plansByLabel = new Map(
      acceptedPlans.map(({ plan, localSpawn }) => [plan.label, { plan, localSpawn }]),
    );

    return definitions;
  }

  /**
   * Choose `npx -y @iris-mcp/<pkg>` or `node <developmentRepoPath>/packages/<dir>/dist/index.js`
   * per plan (AC 31.6.1), fail-closed on a bad `developmentRepoPath` or a
   * missing per-package build (AC 31.6.3): the offending package (or, if the
   * repo path itself is invalid, every package) registers no definition, and
   * every reason is collected into exactly ONE aggregated warning — never one
   * per package, never one per server (the 31.4 review's toast-storm bar).
   * `developmentRepoPath === ""` is the default/back-compat path (AC 31.6.6)
   * and never touches the filesystem.
   */
  private async resolveSpawnTargets(
    plans: DefinitionPlan[],
    developmentRepoPath: string,
  ): Promise<{ definitions: PlannedDefinition[]; acceptedPlans: { plan: DefinitionPlan; localSpawn: boolean }[] }> {
    const definitions: PlannedDefinition[] = [];
    const acceptedPlans: { plan: DefinitionPlan; localSpawn: boolean }[] = [];

    if (developmentRepoPath === "") {
      for (const plan of plans) {
        definitions.push({
          label: plan.label,
          command: NPX_COMMAND,
          args: ["-y", PACKAGE_NPM_NAME[plan.packageKey]],
        });
        acceptedPlans.push({ plan, localSpawn: false });
      }
      return { definitions, acceptedPlans };
    }

    // Nothing was going to be registered anyway (no packages selected, or no
    // Server Manager server matched) — an empty plan set is the documented
    // "everything disabled" intent and must stay SILENT, exactly as it did
    // before this story. Validating (and warning about) the repo path here
    // would blame it for a zero-definition outcome it did not cause.
    if (plans.length === 0) {
      return { definitions, acceptedPlans };
    }

    // ONE repo-level reason at most, and it short-circuits the per-package
    // loop entirely — a repo path that is unusable cannot also produce five
    // "no built dist/index.js" clauses for the same underlying problem.
    const skippedReasons: string[] = [];
    let repoPathValid: boolean;
    if (!isAbsolute(developmentRepoPath)) {
      // A RELATIVE path is REJECTED, never resolved. `isExistingDirectory` and
      // `join()` below would resolve it against the EXTENSION HOST's
      // `process.cwd()`, but `extension.ts` hands the resulting `args` to
      // `vscode.McpStdioServerDefinition`, whose constructor takes no `cwd` — so
      // the child process resolves the very same relative string against VS
      // Code's MCP spawner cwd instead. Validation would pass against one file
      // while the spawn targets another (or none): fail-OPEN, and precisely the
      // "guessed or partially-resolved path" AC 31.6.3 forbids. Both
      // `package.json` and the README document this setting as an absolute path.
      repoPathValid = false;
      skippedReasons.push(
        "the configured path is relative — it must be an absolute path, because the spawned " +
          "server resolves a relative path against a different working directory than this " +
          "extension does, so no servers were registered from it",
      );
    } else if (!(await isExistingDirectory(developmentRepoPath))) {
      repoPathValid = false;
      skippedReasons.push(
        "the configured path does not exist or is not a directory, so no servers were registered from it",
      );
    } else if (!(await isExistingDirectory(join(developmentRepoPath, "packages")))) {
      // The "not a checkout at all" case gets ONE actionable reason. Without
      // this, every selected package contributes its own "no built
      // dist/index.js at <absolute path>" clause — five of them for the default
      // selection, well past what a VS Code notification renders, and none of
      // them naming the actual problem.
      repoPathValid = false;
      skippedReasons.push(
        "the configured path has no packages/ subdirectory, so it is not a checkout of the IRIS " +
          "MCP suite monorepo and no servers were registered from it",
      );
    } else {
      repoPathValid = true;
    }

    // Per-package validation, fanned out with Promise.all (31-6-2) so N
    // packages never cost N serial filesystem round-trips on the extension
    // host. Distinct keys first — several plans (one per selected server) can
    // share a packageKey and must not duplicate a reason.
    const distinctKeys = [...new Set(plans.map((plan) => plan.packageKey))];
    const entryPointByPackage = new Map<SuitePackageKey, string | undefined>();
    if (repoPathValid) {
      const probed = await Promise.all(
        distinctKeys.map(async (packageKey) => {
          const entryPoint = join(
            developmentRepoPath,
            "packages",
            PACKAGE_DIR_NAME[packageKey],
            "dist",
            "index.js",
          );
          return { packageKey, entryPoint, exists: await isExistingFile(entryPoint) };
        }),
      );
      for (const { packageKey, entryPoint, exists } of probed) {
        if (exists) {
          entryPointByPackage.set(packageKey, entryPoint);
        } else {
          entryPointByPackage.set(packageKey, undefined);
          skippedReasons.push(
            `package "${packageKey}" has no built dist/index.js at "${entryPoint}", so it was not registered`,
          );
        }
      }
    }

    for (const plan of plans) {
      const entryPoint = entryPointByPackage.get(plan.packageKey);
      if (!entryPoint) continue;

      // 31-6-3 (Story 32.3, AC 31.6.1 amended): spawn the EXTENSION HOST'S OWN
      // interpreter (`process.execPath` with ELECTRON_RUN_AS_NODE=1 — the
      // standard extension-host pattern) instead of a bare `node` resolved
      // from the host's PATH. A user whose `node` exists only in an
      // interactive shell (nvm-windows/Volta shims), or who launched VS Code
      // from a shortcut with a stale PATH, previously passed every check and
      // then died at spawn with an opaque ENOENT — bypassing this story's
      // entire fail-closed, legible-failure design. The interpreter the
      // extension is running in always exists. `resolveEnvForLabel` adds the
      // ELECTRON_RUN_AS_NODE=1 variable for these plans.
      definitions.push({ label: plan.label, command: process.execPath, args: [entryPoint] });
      acceptedPlans.push({ plan, localSpawn: true });
    }

    if (skippedReasons.length > 0) {
      this.warnOnce(
        `IRIS MCP Launcher: irisMcpLauncher.developmentRepoPath is set to "${developmentRepoPath}" — ` +
          `${skippedReasons.join("; ")}.`,
      );
    }

    return { definitions, acceptedPlans };
  }

  /**
   * Resolve the spawn env for one previously-planned definition, identified by
   * its `label` (the only field VS Code is guaranteed to round-trip back
   * through `resolveMcpServerDefinition` — `label` is `readonly` on the real
   * `vscode.McpStdioServerDefinition`, so it is stable across the
   * provide -> resolve hop and is unique by construction, see `definitions.ts`).
   *
   * Returns `undefined` (never throws) when the server should not be started:
   * an unknown label, a Server Manager definition that no longer exists, or a
   * user-cancelled credential prompt. Every `undefined` path surfaces exactly
   * ONE `showWarning` call — never a toast storm, never a retry loop.
   */
  async resolveEnvForLabel(
    label: string,
    token?: CancellationTokenLike,
  ): Promise<Record<string, string | null> | undefined> {
    const entry = this.plansByLabel.get(label);
    if (!entry) {
      this.deps.showWarning(
        `IRIS MCP Launcher: no configuration found for "${label}" — try reloading the window.`,
      );
      return undefined;
    }
    const { plan, localSpawn } = entry;

    const api = await this.deps.getServerManagerApi();
    if (!api) {
      this.deps.showWarning(
        `IRIS MCP Launcher: "${label}" was not started — the InterSystems Server Manager ` +
          `extension is no longer available.`,
      );
      return undefined;
    }

    let settings: LauncherSettings;
    try {
      settings = this.deps.getSettings();
    } catch {
      this.deps.showWarning(
        `IRIS MCP Launcher: "${label}" was not started — the IRIS MCP Launcher settings could ` +
          `not be read. Check that irisMcpLauncher.servers and irisMcpLauncher.packages are ` +
          `arrays of strings in your settings.`,
      );
      return undefined;
    }

    const profiles: ResolvedConnectionProfile[] = [];
    /** Per-server, so a multi-server plan attributes each prefix to the server that actually declared it. */
    const ignoredPathPrefixes: { serverName: string; pathPrefix: string }[] = [];

    for (const serverName of plan.serverNames) {
      // 31-4-6: an editor-side cancellation (a pending tool call cancelled
      // mid-resolution of a multi-server plan) stops the loop silently — a
      // cancellation is not a user error, so NO warning and no further
      // prompts for the remaining servers.
      if (token?.isCancellationRequested) {
        return undefined;
      }
      // 31-4-1: concurrent resolutions of the SAME server (one per package)
      // share ONE in-flight getSession round-trip — no stacked modal prompts.
      const result = await this.resolveCredentialsCoalesced(
        api,
        serverName,
        settings.namespace,
        this.scopesByServerName.get(serverName),
      );

      if (result.status === "cancelled") {
        this.deps.showWarning(
          `IRIS MCP Launcher: "${label}" was not started — credentials for IRIS server ` +
            `"${serverName}" were not provided.`,
        );
        return undefined;
      }
      if (result.status === "no-spec") {
        this.deps.showWarning(
          `IRIS MCP Launcher: "${label}" was not started — Server Manager has no server named ` +
            `"${serverName}" (it may have been renamed or removed; try reloading the window).`,
        );
        return undefined;
      }
      if (result.status === "no-username") {
        // 31-4-3 (DECISION (a), refuse-with-message): an empty resolved
        // username would take down EVERY profile in a combineProfiles child
        // (mergeProfile rejects an empty IRIS_PROFILES username), so refuse
        // here — one clear message pointing at the fix — instead of letting
        // the child fail to start opaquely.
        this.deps.showWarning(
          `IRIS MCP Launcher: "${label}" was not started — no username could be resolved for ` +
            `"${serverName}". Set one on the server's definition in Server Manager ` +
            `(intersystems.servers.${serverName}.username); the IRIS MCP suite requires a ` +
            `non-empty username.`,
        );
        return undefined;
      }
      if (result.status === "unavailable") {
        // Deliberately carries no third-party error text — see credentials.ts's
        // containment note (AC 31.4.3).
        this.deps.showWarning(
          `IRIS MCP Launcher: "${label}" was not started — InterSystems Server Manager could not ` +
            `provide a connection for "${serverName}". Check that server's definition in your ` +
            `intersystems.servers settings.`,
        );
        return undefined;
      }

      profiles.push(result.profile);
      if (result.ignoredPathPrefix !== undefined) {
        ignoredPathPrefixes.push({ serverName, pathPrefix: result.ignoredPathPrefix });
      }
    }

    for (const { serverName, pathPrefix } of ignoredPathPrefixes) {
      // One warning per (server, prefix) for the LIFETIME of this provider, so
      // the README/CHANGELOG's "one-time warning" is literally true rather
      // than once-per-start.
      const key = `${serverName}\u0000${pathPrefix}`;
      if (this.warnedPathPrefixes.has(key)) continue;
      this.warnedPathPrefixes.add(key);
      this.deps.showWarning(
        `IRIS MCP Launcher: "${label}" — server "${serverName}" defines a ` +
          `webServer path prefix ("${pathPrefix}") that the IRIS MCP suite's environment-variable ` +
          `connection contract does not yet support. Connecting without it; the server may be unreachable ` +
          `if a path prefix is required.`,
      );
    }

    // 31-4-4 (PAIRED DECISION with suite item 31-3-1 — AC 32.3.4): the
    // reserved name is never silently shadowed on EITHER side of the process
    // boundary. The suite side warns under `auto` and fails under `required`
    // (profiles.ts); THIS side detects the same shape at plan time and says
    // so once, mirroring the suite-side notice's remedy — rename it. A
    // "default"-named server under combineProfiles is emitted as an
    // IRIS_PROFILES key that overrides the suite's RESERVED default profile,
    // so every tool call omitting the `server` parameter would silently
    // target it. Deliberately NOT auto-renamed here — that would make the
    // `server` parameter disagree with the Server Manager UI.
    if (settings.combineProfiles && profiles.some((profile) => profile.name === "default")) {
      this.warnOnce(
        `IRIS MCP Launcher: server "default" — that name is RESERVED by the IRIS MCP suite. ` +
          `Under combineProfiles it is emitted as an IRIS_PROFILES key that overrides the reserved ` +
          `default profile, so every tool call that omits the "server" parameter silently targets ` +
          `THIS server with its credentials. Rename the server in Server Manager ` +
          `(intersystems.servers) to avoid the shadowing.`,
      );
    }

    const env = withOwnedVarsCleared({
      ...synthesizeIrisEnv(profiles, settings.namespace, {
        alwaysEmitProfiles: settings.combineProfiles,
      }),
      ...buildGovernanceEnv(settings),
    });
    // 31-6-3: a local-build plan spawns the extension host's own Electron
    // binary (process.execPath) as the interpreter; ELECTRON_RUN_AS_NODE=1 is
    // what makes that binary behave as plain Node.
    if (localSpawn) {
      env["ELECTRON_RUN_AS_NODE"] = "1";
    }
    return env;
  }
}
