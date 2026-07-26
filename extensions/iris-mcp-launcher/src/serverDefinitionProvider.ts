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
import { existsSync, statSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { planDefinitions, PACKAGE_DIR_NAME, PACKAGE_NPM_NAME, type DefinitionPlan } from "./definitions.js";
import { resolveServerCredentials } from "./credentials.js";
import { synthesizeIrisEnv, buildGovernanceEnv, withOwnedVarsCleared } from "./env.js";
import type {
  AuthApi,
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
const NODE_COMMAND = "node";

/**
 * Guarded `fs` checks for the `irisMcpLauncher.developmentRepoPath` local-spawn
 * path (Story 31.6, Task 2). `existsSync` never throws by design, but a
 * `statSync` immediately after it is still a TOCTOU-guardable race (the path
 * can vanish, or be an unreadable reparse point on Windows, between the two
 * calls) — Task 2's "guard every fs call; a throw degrades to the same single
 * warning, never a raw error string" applies here. Returning a plain boolean
 * (never throwing) means every call site can treat "invalid" and "fs blew up"
 * identically, with no per-call try/catch needed at the call site.
 */
function isExistingDirectory(candidatePath: string): boolean {
  try {
    return existsSync(candidatePath) && statSync(candidatePath).isDirectory();
  } catch {
    return false;
  }
}

function isExistingFile(candidatePath: string): boolean {
  try {
    return existsSync(candidatePath) && statSync(candidatePath).isFile();
  } catch {
    return false;
  }
}

export class LauncherProvider {
  private readonly deps: ProviderDeps;
  private plansByLabel = new Map<string, DefinitionPlan>();
  /** Configuration scope each Server Manager server name was enumerated in (multi-root workspaces). */
  private scopesByServerName = new Map<string, ConfigScope>();
  /** `server\u0000pathPrefix` pairs already warned about, so the docs' "one-time warning" is literally true. */
  private readonly warnedPathPrefixes = new Set<string>();

  constructor(deps: ProviderDeps) {
    this.deps = deps;
  }

  /**
   * Enumerate the definitions to register, from Server Manager's current
   * server roster and the extension's settings. Never resolves credentials.
   */
  async providePlannedDefinitions(): Promise<PlannedDefinition[]> {
    const api = await this.deps.getServerManagerApi();
    if (!api) {
      this.deps.showWarning(
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
      this.deps.showWarning(
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
    // `settings.packages`/`plans` end up empty after filtering).
    if (settings.hadStaleAllPackage) {
      this.deps.showWarning(
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
      this.deps.showWarning(
        `IRIS MCP Launcher: none of the configured irisMcpLauncher.servers entries ` +
          `(${settings.servers.join(", ")}) match a server InterSystems Server Manager currently ` +
          `reports. No IRIS MCP servers were registered.`,
      );
    }

    const { definitions, acceptedPlans } = this.resolveSpawnTargets(plans, settings.developmentRepoPath);
    this.plansByLabel = new Map(acceptedPlans.map((plan) => [plan.label, plan]));

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
  private resolveSpawnTargets(
    plans: DefinitionPlan[],
    developmentRepoPath: string,
  ): { definitions: PlannedDefinition[]; acceptedPlans: DefinitionPlan[] } {
    const definitions: PlannedDefinition[] = [];
    const acceptedPlans: DefinitionPlan[] = [];

    if (developmentRepoPath === "") {
      for (const plan of plans) {
        definitions.push({
          label: plan.label,
          command: NPX_COMMAND,
          args: ["-y", PACKAGE_NPM_NAME[plan.packageKey]],
        });
        acceptedPlans.push(plan);
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
    } else if (!isExistingDirectory(developmentRepoPath)) {
      repoPathValid = false;
      skippedReasons.push(
        "the configured path does not exist or is not a directory, so no servers were registered from it",
      );
    } else if (!isExistingDirectory(join(developmentRepoPath, "packages"))) {
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

    // Cache per-package validation — several plans (one per selected server)
    // can share the same packageKey, and each would otherwise re-stat the
    // same dist/index.js and, on failure, duplicate the same reason.
    const entryPointByPackage = new Map<SuitePackageKey, string | undefined>();

    for (const plan of plans) {
      if (!repoPathValid) continue;

      if (!entryPointByPackage.has(plan.packageKey)) {
        const entryPoint = join(
          developmentRepoPath,
          "packages",
          PACKAGE_DIR_NAME[plan.packageKey],
          "dist",
          "index.js",
        );
        if (isExistingFile(entryPoint)) {
          entryPointByPackage.set(plan.packageKey, entryPoint);
        } else {
          entryPointByPackage.set(plan.packageKey, undefined);
          skippedReasons.push(
            `package "${plan.packageKey}" has no built dist/index.js at "${entryPoint}", so it was not registered`,
          );
        }
      }

      const entryPoint = entryPointByPackage.get(plan.packageKey);
      if (!entryPoint) continue;

      definitions.push({ label: plan.label, command: NODE_COMMAND, args: [entryPoint] });
      acceptedPlans.push(plan);
    }

    if (skippedReasons.length > 0) {
      this.deps.showWarning(
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
  async resolveEnvForLabel(label: string): Promise<Record<string, string | null> | undefined> {
    const plan = this.plansByLabel.get(label);
    if (!plan) {
      this.deps.showWarning(
        `IRIS MCP Launcher: no configuration found for "${label}" — try reloading the window.`,
      );
      return undefined;
    }

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
      const result = await resolveServerCredentials(
        api,
        this.deps.authApi,
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

    return withOwnedVarsCleared({
      ...synthesizeIrisEnv(profiles, settings.namespace, {
        alwaysEmitProfiles: settings.combineProfiles,
      }),
      ...buildGovernanceEnv(settings),
    });
  }
}
