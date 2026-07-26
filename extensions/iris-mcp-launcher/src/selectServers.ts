/**
 * Server-selection UI logic (Story 31.5): the "IRIS MCP Launcher: Select
 * Servers…" command and the pure status-bar text/tooltip computation it
 * drives.
 *
 * Deliberately has NO value-level dependency on the `vscode` module — see the
 * "one vscode import" rule in `extension.ts`'s doc comment (also documented
 * in `serverDefinitionProvider.ts`). Every VS Code API this module needs
 * (QuickPick, configuration inspect/update, warnings) is injected through
 * {@link SelectServersDeps}, mirroring `LauncherProvider`/`ProviderDeps`
 * (`serverDefinitionProvider.ts`): `extension.ts` supplies the real
 * implementations at activation, tests supply fakes — so this module stays
 * fully unit-testable in a plain Node process with no VS Code host.
 *
 * Credential containment (AC 31.5.5, extended from AC 31.4.3's bar to the new
 * QuickPick/tooltip/status-bar surfaces): this module has NO dependency on
 * any credential-bearing type — `AuthApi`, `ResolvedConnectionProfile`,
 * `resolveServerCredentials` are never imported here. It only ever reads
 * `ServerName.{name,description,detail}` (public Server Manager metadata) and
 * `LauncherSettings.{servers,packages}` (this extension's own non-secret
 * settings), so there is no code path by which a password or token could
 * reach a QuickPick item, tooltip, status-bar text, or message here —
 * verified structurally in `containment.test.ts`.
 */
import type { LauncherSettings, ServerManagerApi, ServerName } from "./types.js";

/**
 * Command id for "IRIS MCP Launcher: Select Servers…" — the single source of
 * truth both `package.json`'s `contributes.commands` entry and
 * `extension.ts`'s `registerCommand` call are checked against
 * (`packaging.test.ts`, Rule #51 — mechanical, not hand-rostered).
 */
export const SELECT_SERVERS_COMMAND_ID = "irisMcpLauncher.selectServers";

/**
 * Minimal shape of `vscode.QuickPickItem` this module needs. Structurally
 * assignable to the real `vscode.QuickPickItem` (every field here has the
 * same name/type as its counterpart there), so `extension.ts` can pass these
 * straight to `vscode.window.showQuickPick` with no adapter.
 */
export interface SelectServersQuickPickItem {
  label: string;
  description?: string;
  detail?: string;
  /** Pre-checks the item — only honored by `showQuickPick` when the picker allows multiple selections (`canPickMany: true`). */
  picked?: boolean;
}

/**
 * Which `contributes.configuration` scope `irisMcpLauncher.servers` should be
 * written to. A local, `vscode`-independent vocabulary — `extension.ts` maps
 * this onto the real `vscode.ConfigurationTarget` enum at the injection
 * boundary.
 *
 * **Deliberately has no `workspaceFolder` member** (code review, Story 31.5 —
 * AC 31.5.2 amended in `epics.md` for the same reason). `irisMcpLauncher.servers`
 * declares no `"scope"` in `package.json`'s `contributes.configuration`, so it
 * takes VS Code's default `window` scope, which folder settings cannot carry.
 * The installed `@types/vscode@1.125.0` declaration
 * (`node_modules/@types/vscode/index.d.ts:6943-6948`) lists among
 * `WorkspaceConfiguration.update`'s documented throws BOTH
 * "window configuration to workspace folder" AND "configuration to workspace
 * folder when {@link WorkspaceConfiguration} is not scoped to a resource" —
 * and `extension.ts` deliberately obtains an UNSCOPED configuration, because
 * the READ side (`readSettings` in `settings.ts`) is unscoped too. A
 * folder-scoped write would therefore be unreadable by the very provider
 * Integration AC 31.5.8 requires it to round-trip through. A
 * `"workspaceFolder"` member would be a branch the real API can never reach
 * and, if reached, is documented to reject — exactly the "green suite over an
 * impossible path" defect Story 31.4's review headlined.
 */
export type ConfigWriteTarget = "workspace" | "global";

/**
 * The subset of `WorkspaceConfiguration.inspect()`'s return shape this module
 * reads (AC 31.5.2). The real return type carries more fields (`key`,
 * `defaultValue`, language-specific variants); this is a structural subset,
 * not a full mirror.
 */
export interface ConfigInspection<T> {
  /**
   * Present in the real return shape and deliberately NEVER read — see
   * {@link ConfigWriteTarget}. A `window`-scoped setting read through an
   * unscoped `WorkspaceConfiguration` can never carry a folder value, so
   * branching on it would be dead code.
   */
  workspaceFolderValue?: T;
  workspaceValue?: T;
  globalValue?: T;
}

/**
 * Read/write port for `irisMcpLauncher.servers` specifically — deliberately a
 * SEPARATE port from `settings.ts`'s `ConfigReader` rather than an extension
 * of it. `packaging.test.ts` mechanically extracts `readSettings()`'s keys
 * from `settings.ts`'s `config.get<...>(...)` calls; widening `ConfigReader`
 * with `inspect`/`update` methods would pollute that extraction (Dev Notes:
 * "Extend via a separate port rather than widening ConfigReader").
 */
export interface ConfigWriter {
  inspectServers: () => ConfigInspection<string[]> | undefined;
  /**
   * `WorkspaceConfiguration.update("servers", value, target)`. Returns a
   * Thenable that CAN reject — a read-only settings file, or a
   * workspace-scoped write attempted with no workspace open — so
   * {@link selectServers} guards it (AC 31.5.5: "no unhandled rejection out
   * of a command handler").
   */
  updateServers: (value: string[], target: ConfigWriteTarget) => PromiseLike<void>;
}

/**
 * Dependencies injected into {@link selectServers} — mirrors `ProviderDeps`
 * (`serverDefinitionProvider.ts`): real implementations come from
 * `extension.ts`, fakes come from tests.
 */
export interface SelectServersDeps {
  getServerManagerApi: () => Promise<ServerManagerApi | undefined>;
  getSettings: () => LauncherSettings;
  configWriter: ConfigWriter;
  /**
   * `vscode.window.showQuickPick(items, { canPickMany: true })`.
   *
   * Oracle (Rule #36): the installed `@types/vscode` declaration
   * (`node_modules/@types/vscode/index.d.ts`, the
   * `showQuickPick<T extends QuickPickItem>(items, options: QuickPickOptions
   * & { canPickMany: true }, token?)` overload, ~line 11443) types this
   * call's return as `Thenable<T[] | undefined>` — dismissing the picker
   * (Esc, clicking away) RESOLVES `undefined`; it does not reject. That is
   * the OPPOSITE shape from Story 31.4's
   * `authentication.getSession({ createIfNone: true })`, which REJECTS on
   * cancel. Verified here rather than pattern-matched from 31.4 — see
   * `selectServers()`'s cancellation check below and the Dev Notes warning
   * against assuming either shape.
   */
  showQuickPick: (
    items: SelectServersQuickPickItem[],
  ) => PromiseLike<SelectServersQuickPickItem[] | undefined>;
  /** Surfaces ONE clear failure message (AC 31.5.5) — never a toast storm, never thrown. Same shape as `ProviderDeps.showWarning`. */
  showWarning: (message: string) => void;
  /**
   * Surfaces the post-write confirmation (AC 31.5.2/31.5.6) — deliberately a
   * SEPARATE callback from `showWarning`: a successful save is not a
   * warning, and VS Code's own UX distinguishes an info toast from a warning
   * one. `extension.ts` wires this to `vscode.window.showInformationMessage`.
   */
  showInfo: (message: string) => void;
}

/** Human-readable scope name for the post-write confirmation (AC 31.5.2: "named ... so the user knows which file changed"). */
const TARGET_LABEL: Record<ConfigWriteTarget, string> = {
  workspace: "this workspace's",
  global: "your user (global)",
};

/**
 * Choose which scope to write `irisMcpLauncher.servers` to: the scope it is
 * ALREADY defined in — workspace → global — falling back to Global when it is
 * defined nowhere (AC 31.5.2, as amended). Presence is tested with
 * `!== undefined`, never truthiness: an empty array (`[]`) and a `null` left
 * by a hand-edited settings.json are both falsy but ARE the scope the value
 * already lives in, so the write must self-heal that scope rather than
 * silently landing in a different file.
 *
 * `workspaceFolderValue` is deliberately not a candidate — see
 * {@link ConfigWriteTarget}. In a single-folder window VS Code reports
 * `.vscode/settings.json` as `workspaceValue`, so the common case is covered;
 * in a multi-root window a folder-level `irisMcpLauncher.servers` is inert
 * (window scope) and is neither read nor written by this extension.
 */
export function resolveWriteTarget(
  inspection: ConfigInspection<string[]> | undefined,
): ConfigWriteTarget {
  if (inspection?.workspaceValue !== undefined) return "workspace";
  return "global";
}

/**
 * Command handler for "IRIS MCP Launcher: Select Servers…" (AC 31.5.1).
 *
 * Never throws — every failure path (missing/throwing Server Manager API, an
 * empty roster, a rejecting config write) degrades to exactly ONE
 * `showWarning` call (AC 31.5.5), and the command still returns normally
 * rather than failing silently or leaving an unhandled rejection. Cancelling
 * the picker (see {@link SelectServersDeps.showQuickPick}'s doc comment for
 * the verified resolve-not-reject shape) leaves configuration byte-unchanged
 * — `configWriter.updateServers` is simply never called.
 */
export async function selectServers(deps: SelectServersDeps): Promise<void> {
  // Guarded like every other third-party call on this path (code review,
  // Story 31.5): `extension.ts`'s real `getServerManagerApi` awaits
  // `extension.activate()` on the Server Manager extension, and the
  // `getExtension(...)`/`.exports` reads sit outside its own try — so a
  // rejection here is reachable. Unguarded it would reject `selectServers()`
  // itself, i.e. an unhandled rejection out of the command handler
  // `extension.ts` registers, with VS Code surfacing the third-party error
  // text — the two things AC 31.5.5 rules out. Degrades to the same single
  // "not available" warning as a resolved `undefined`.
  let api: ServerManagerApi | undefined;
  try {
    api = await deps.getServerManagerApi();
  } catch {
    api = undefined;
  }
  if (!api) {
    deps.showWarning(
      "IRIS MCP Launcher: the InterSystems Server Manager extension is not available " +
        "(it should be installed automatically as a dependency of this extension). " +
        "No servers to select.",
    );
    return;
  }

  let serverNames: ServerName[];
  let settings: LauncherSettings;
  try {
    // Same call shape LauncherProvider.providePlannedDefinitions uses: no
    // scope argument. This command only ENUMERATES, so there is no
    // `getServerSpec` call for a `ServerName.scope` to be threaded back into
    // — the 31.4 review's scope-threading fix lives in
    // `serverDefinitionProvider.ts`'s `scopesByServerName`, on the resolve
    // path this module never takes. (Corrected at code review: an earlier
    // comment here claimed this module honored that threading, which
    // overstated what the code does.) Reading settings and enumerating the
    // roster are grouped in one try, matching the provider's own "settings +
    // roster are one failure surface" shape.
    serverNames = api.getServerNames();
    settings = deps.getSettings();
  } catch {
    deps.showWarning(
      "IRIS MCP Launcher: could not read the InterSystems Server Manager server list or the " +
        "IRIS MCP Launcher settings. Check that irisMcpLauncher.servers and irisMcpLauncher.packages " +
        "are arrays of strings in your settings. No servers to select.",
    );
    return;
  }

  // De-duplicate by name — mirrors LauncherProvider's `scopesByServerName`
  // Map (a repeated name keeps only its last-reported scope), and, as a
  // side effect, guarantees the QuickPick never presents two items with the
  // same label (31.4 review finding: "Duplicates collide on label").
  const uniqueServers = [...new Map(serverNames.map((s) => [s.name, s])).values()];

  if (uniqueServers.length === 0) {
    deps.showWarning(
      'IRIS MCP Launcher: InterSystems Server Manager has no servers configured. Add a server ' +
        'there, then run "IRIS MCP Launcher: Select Servers…" again.',
    );
    return;
  }

  const currentlySelected = new Set(settings.servers);
  const reportedNames = new Set(uniqueServers.map((server) => server.name));

  // Names the user has ALREADY configured that Server Manager is not currently
  // reporting (code review, Story 31.5). Without these, the written value is a
  // pure function of the current roster, so a user whose global
  // `irisMcpLauncher.servers` is ["prod","staging"] opening a window where
  // Server Manager only reports "prod" — a workspace-defined server, a window
  // without that folder open, a rename — would have "staging" silently and
  // permanently deleted from their settings by simply confirming the picker
  // without changing anything. Carrying them through as pre-checked items
  // makes a confirm-with-no-changes byte-neutral (matching AC 31.5.1's
  // cancel-is-byte-unchanged spirit) while still letting the user remove them
  // deliberately by unchecking. Blank entries are NOT carried forward: they
  // can match no server, and a blank picker row is not something a user can
  // act on.
  const unreportedSelected = [...new Set(settings.servers)].filter(
    (name) => !reportedNames.has(name) && name.trim() !== "",
  );

  const items: SelectServersQuickPickItem[] = [
    ...uniqueServers.map((server) => ({
      label: server.name,
      description: server.description,
      detail: server.detail,
      picked: currentlySelected.has(server.name),
    })),
    ...unreportedSelected.map((name) => ({
      label: name,
      description: "(not currently reported by InterSystems Server Manager)",
      detail: "Already in irisMcpLauncher.servers. Uncheck to remove it.",
      picked: true,
    })),
  ];

  // Both this call and `deps.configWriter.inspectServers()` below are
  // guarded individually — QA pass (Story 31.5): the initial implementation
  // left them outside any try/catch, which is inconsistent with the
  // "every third-party call on a user-facing path is guarded" bar carried
  // forward from the 31.4 review (Dev Notes) and with AC 31.5.5's "never an
  // unhandled rejection out of a command handler". Neither
  // `WorkspaceConfiguration.inspect()` nor `window.showQuickPick()` is
  // documented to throw in `@types/vscode`, but this module holds the same
  // defensive bar `deps.configWriter.updateServers()` already gets below,
  // rather than assuming a third-party call silently can't fail.
  let picked: SelectServersQuickPickItem[] | undefined;
  try {
    picked = await deps.showQuickPick(items);
  } catch {
    deps.showWarning(
      'IRIS MCP Launcher: could not show the server picker. Try running "IRIS MCP Launcher: ' +
        'Select Servers…" again.',
    );
    return;
  }
  if (picked === undefined) {
    // Cancelled/dismissed. No write, no message — AC 31.5.1's "cancelling
    // leaves configuration byte-unchanged".
    return;
  }

  // Defensive de-dupe on the way out too (belt-and-suspenders with the
  // de-duped `items` list above) — never let the QuickPick write duplicates.
  const selectedNames = [...new Set(picked.map((item) => item.label))];

  let target: ConfigWriteTarget;
  try {
    target = resolveWriteTarget(deps.configWriter.inspectServers());
  } catch {
    deps.showWarning(
      "IRIS MCP Launcher: could not determine which settings scope to save the selected servers " +
        'to. Try running "IRIS MCP Launcher: Select Servers…" again.',
    );
    return;
  }

  try {
    await deps.configWriter.updateServers(selectedNames, target);
  } catch {
    // Never forwards the third-party rejection reason to a user surface
    // (AC 31.5.5) — e.g. a read-only settings file, or a workspace-scoped
    // write attempted with no workspace open.
    deps.showWarning(
      `IRIS MCP Launcher: could not save the selected servers to ${TARGET_LABEL[target]} settings. ` +
        "Check that the settings file is writable, then try again.",
    );
    return;
  }

  const countText =
    selectedNames.length === 0
      ? "0 servers (irisMcpLauncher.servers is now empty, so every server InterSystems Server " +
        "Manager reports will be exposed — the documented default)"
      : `${selectedNames.length} server${selectedNames.length === 1 ? "" : "s"}`;

  deps.showInfo(
    `IRIS MCP Launcher: saved ${countText} to ${TARGET_LABEL[target]} settings ` +
      "(irisMcpLauncher.servers). Reload the window or restart the MCP server(s) for this to take effect.",
  );
}

/** {@link buildStatusBarState}'s return shape — assigned verbatim onto a real `vscode.StatusBarItem`'s `.text`/`.tooltip` by `extension.ts`. */
export interface StatusBarState {
  text: string;
  tooltip: string;
}

/**
 * Pure status-bar text/tooltip computation (AC 31.5.3). `refreshStatusBar` in
 * `extension.ts` is the only caller and does nothing but assign these fields
 * onto the real `vscode.StatusBarItem` — kept here, not there, so the
 * zero-state text and the tooltip wording are unit-testable without a VS
 * Code host.
 *
 * Deliberately reads `settings.servers.length` — the literal
 * `irisMcpLauncher.servers` array — not a Server-Manager-resolved roster: a
 * fresh install has `servers: []` by definition (the setting's own default),
 * so THIS is the zero-state AC 31.5.3 calls "the only signal a fresh install
 * gives that the extension is installed and waiting for input", independent
 * of whether Server Manager currently reports any servers at all.
 */
export function buildStatusBarState(settings: LauncherSettings): StatusBarState {
  const count = settings.servers.length;
  const packagesText = settings.packages.length > 0 ? settings.packages.join(", ") : "(none configured)";
  // AC 31.6.7: surface when development mode is active, so a user cannot
  // forget the extension is running local builds rather than published
  // packages. Deliberately tooltip-only — `text` and the count/zero-state
  // shape are pinned by AC 31.5.3's tests and must not change here.
  const devModeLine =
    settings.developmentRepoPath !== ""
      ? `Development mode: spawning from local build at ${settings.developmentRepoPath}\n`
      : "";

  if (count === 0) {
    return {
      text: "$(server) IRIS MCP: none",
      tooltip:
        "IRIS MCP Launcher — no servers selected yet.\n" +
        "irisMcpLauncher.servers is empty, so every server InterSystems Server Manager currently " +
        "reports will be exposed (the documented default).\n" +
        `Packages: ${packagesText}\n` +
        devModeLine +
        "Click to choose specific servers.",
    };
  }

  return {
    text: `$(server) IRIS MCP: ${count}`,
    tooltip:
      `IRIS MCP Launcher\nServers: ${settings.servers.join(", ")}\nPackages: ${packagesText}\n` +
      devModeLine +
      "Click to change selection.",
  };
}
