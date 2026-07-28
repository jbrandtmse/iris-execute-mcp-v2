/**
 * Extension activation entry point (Task 2; Story 31.5 extends it). The ONLY
 * file in this extension with a value-level `import * as vscode from
 * "vscode"` — every other module is plain-data / injected-dependency and
 * unit-testable without a VS Code host (see `serverDefinitionProvider.ts`'s
 * and `selectServers.ts`'s doc comments).
 *
 * Acquires the Server Manager extension API (`extensionDependencies` in
 * package.json guarantees it is installed; activation itself is still
 * defensive — see `getServerManagerApi` below), registers the
 * `iris-mcp-launcher` MCP server definition provider
 * (`contributes.mcpServerDefinitionProviders` in package.json), and adapts
 * `LauncherProvider`'s plain-data output onto real
 * `vscode.McpStdioServerDefinition` instances.
 *
 * Story 31.5 additionally registers the `irisMcpLauncher.selectServers`
 * command and a status bar item — both thin adapters over `selectServers.ts`'s
 * pure logic, following the same injected-dependency pattern as the provider
 * above. `package.json`'s `activationEvents: ["onStartupFinished"]` (AC
 * 31.5.4) is what makes `activate()` — and so the status bar item — run on
 * every window, not only when the MCP subsystem first asks for definitions.
 *
 * **AC 31.5.4 — the cost accepted.** `onStartupFinished` means (a) this
 * extension activates in EVERY VS Code window, including windows with no IRIS
 * work, and (b) because `extensionDependencies` declares
 * `intersystems-community.servermanager` — which VS Code activates BEFORE
 * this extension — the Server Manager extension is now activated in every
 * window too, where previously both stayed dormant until the MCP subsystem
 * first asked for definitions. That cost is accepted because AC 31.5.3's
 * zero-state status bar item is "the only signal a fresh install gives that
 * the extension is installed and waiting for input", and a lazily-activated
 * extension cannot render one. Activation cost: the initial status-bar
 * refresh awaits one `providePlannedDefinitions()` (31-5-2 — the status bar
 * reports the EFFECTIVE registered count), which activates Server Manager
 * and enumerates its roster once; the fs validation that path can trigger is
 * fully async (31-6-2), so the extension host is never blocked on I/O.
 *
 * **32-3-R4 (Story 32.4 — recorded product decision).** The eager activation
 * the late review layer flagged is NOT a Story-32.3 regression:
 * `extensionDependencies` + `onStartupFinished` activate Server Manager in
 * every window regardless (the AC-31.5.4 accepted cost above). What 32.3
 * added is the activation-time PLAN (roster enumeration + async fs
 * validation) the effective-count status bar (31-5-2) requires — and 31-5-2's
 * decision stands: the alternative (a raw-count status bar) re-ships the
 * divergence it burned down. Recorded, not replanned.
 */
import * as vscode from "vscode";
import { stat } from "node:fs/promises";

import { SERVER_MANAGER_EXTENSION_ID } from "./constants.js";
import {
  applyJson,
  availableModes,
  buildClientsCliEnv,
  detectClientsJson,
  diffApplyJson,
  diffApplyText,
  doctorJson,
  resolveClientsCli,
  restoreJson,
  runClientsCli,
  statusMatrixJson,
  toggleJson,
  type ClientsCliCommand,
} from "./clientsEngine.js";
import {
  CLIENT_ROSTER_STATE_KEY,
  createClientsPanelOpener,
  MANAGE_CLIENTS_COMMAND_ID,
  type ClientsEngineHost,
} from "./clientsPanel.js";
import {
  buildGovernanceCliEnv,
  resolveGovernanceCli,
  runGovernanceCli,
} from "./governanceEngine.js";
import {
  createGovernancePanelOpener,
  OPEN_GOVERNANCE_EDITOR_COMMAND_ID,
  type GovernanceEngineHost,
} from "./governancePanel.js";
import {
  buildStatusBarState,
  selectServers,
  SELECT_SERVERS_COMMAND_ID,
  type ConfigInspection,
  type ConfigWriteTarget,
  type SelectServersDeps,
  type SelectServersQuickPickItem,
} from "./selectServers.js";
import { LauncherProvider } from "./serverDefinitionProvider.js";
import { CONFIG_SECTION, readSettings, type ConfigReader } from "./settings.js";
import type { AuthApi, ServerManagerApi, ServerManagerApiFailureReason } from "./types.js";

const PROVIDER_ID = "iris-mcp-launcher";
const STATUS_BAR_ITEM_ID = "irisMcpLauncher.status";

let cachedApi: ServerManagerApi | undefined;

/**
 * 32-3-R3 (Story 32.4): why the most recent `getServerManagerApi()` call
 * failed (`undefined` when it has not failed). Handed to the provider and
 * the select-servers command as an optional dep so their generic "not
 * available" warnings can stay silent when the real cause — a shape/version
 * mismatch — already produced its own accurate warning here.
 */
let lastApiFailure: ServerManagerApiFailureReason | undefined;

/** 32-3-R3: the 31-4-8 shape-mismatch warning fires ONCE per session, not on every provide/resolve/refresh against a persistently mis-shaped Server Manager. */
let apiShapeWarned = false;

/**
 * Acquire (and cache) the Server Manager extension's exported API, activating
 * the extension if needed. Returns `undefined` — never throws — if the
 * extension is absent or inactive-and-unactivatable, so a missing dependency
 * degrades to "no servers registered" rather than crashing this extension's
 * own activation (story Dev Notes / Task 2: "should not happen given
 * extensionDependencies, but do not crash activation").
 */
async function getServerManagerApi(): Promise<ServerManagerApi | undefined> {
  if (cachedApi) return cachedApi;

  const extension = vscode.extensions.getExtension<ServerManagerApi>(SERVER_MANAGER_EXTENSION_ID);
  if (!extension) {
    lastApiFailure = "not-available";
    return undefined;
  }

  try {
    if (!extension.isActive) {
      await extension.activate();
    }
  } catch {
    lastApiFailure = "not-available";
    return undefined;
  }

  // 31-4-8 (Story 32.3): duck-type the exports BEFORE caching. A truthy-but-
  // wrong-shaped exports object (an API change, a partial activation) was
  // previously cached permanently — `if (cachedApi) return cachedApi` would
  // short-circuit for the rest of the session, so the "not available" branch
  // could never fire and the user got only a downstream "could not read the
  // server list". On a mismatch: do NOT cache (a later, fully-activated
  // exports object can still succeed), and say what actually happened.
  const candidate = extension.exports;
  if (
    typeof candidate?.getServerNames !== "function" ||
    typeof candidate?.getServerSpec !== "function" ||
    typeof candidate?.getAccount !== "function"
  ) {
    lastApiFailure = "shape-mismatch";
    // 32-3-R3 (Story 32.4): ONE warning per session. A persistently
    // mis-shaped Server Manager used to re-toast on EVERY provide / resolve /
    // status-bar refresh (the mismatch is never cached, so every call
    // re-checked and re-warned) — the exact re-fire class 31-6-1 burned down.
    // Once-per-session (vs 32-3-R7's rising-edge) is deliberate here: a
    // RECOVERED API is cached for the rest of the session, so a
    // fix-then-rebreak is not observable in-session — there is no edge to
    // re-fire on. The flag is set only when the sink actually receives the
    // message (32.4 review): a pre-activation call (sink still undefined)
    // must not consume the session's one warning without showing it.
    if (!apiShapeWarned && apiShapeWarningSink !== undefined) {
      apiShapeWarned = true;
      apiShapeWarningSink(
        "IRIS MCP Launcher: the InterSystems Server Manager extension activated, but its API is " +
          "not the shape this extension expects (missing getServerNames/getServerSpec/getAccount) — " +
          "a version mismatch. No IRIS MCP servers were registered.",
      );
    }
    return undefined;
  }

  lastApiFailure = undefined;
  cachedApi = candidate;
  return cachedApi;
}

/**
 * Where the 31-4-8 shape-mismatch message goes (31-4-8). `getServerManagerApi`
 * is module-level (its cache outlives any single activation path), so the
 * `showWarning` closure — which exists only inside `activate()` — is handed
 * over once activation runs. Until then the message is dropped (activation
 * itself is the only earlier caller, and it registers the sink first).
 */
let apiShapeWarningSink: ((message: string) => void) | undefined;

const authApi: AuthApi = {
  getSession: (providerId, scopes, options) =>
    vscode.authentication.getSession(providerId, scopes, options),
};

function toConfigReader(config: vscode.WorkspaceConfiguration): ConfigReader {
  return { get: (section, defaultValue) => config.get(section, defaultValue) };
}

/** Adapts this extension's own `vscode`-independent {@link ConfigWriteTarget} vocabulary (`selectServers.ts`) onto the real `vscode.ConfigurationTarget` enum. */
function toConfigurationTarget(target: ConfigWriteTarget): vscode.ConfigurationTarget {
  switch (target) {
    case "workspace":
      return vscode.ConfigurationTarget.Workspace;
    case "global":
      return vscode.ConfigurationTarget.Global;
  }
}

/**
 * The `irisMcpLauncher.servers` section key, single-sourced so the inspect and
 * update adapters below can never drift apart and so `packaging.test.ts` can
 * pin it mechanically against `settings.ts`'s read key and `package.json`'s
 * declared property (Integration AC 31.5.8's "a rename on EITHER side must
 * fail this test" — added at code review, which found the write side
 * uncovered).
 */
const SERVERS_SETTING_KEY = "servers";

/**
 * The `irisMcpLauncher.governanceFile` section key, single-sourced so the
 * choose-file write below and `settings.ts`'s read can never drift (the
 * SERVERS_SETTING_KEY discipline; `containment.test.ts` pins BOTH writes
 * positively).
 */
const GOVERNANCE_FILE_SETTING_KEY = "governanceFile";

/**
 * `WorkspaceConfiguration.inspect("servers")`, scoped to `irisMcpLauncher`.
 * Fetches a FRESH `WorkspaceConfiguration` on every call (never caches one),
 * matching `toConfigReader`'s own call pattern above — settings can change
 * between activation and any later read.
 *
 * Deliberately UNSCOPED (no `ConfigurationScope` second argument), matching
 * the read path: `getSettings()` below also calls
 * `vscode.workspace.getConfiguration(section)` with no resource. Both sides
 * must agree, or the command would write a value the provider never reads —
 * see {@link ConfigWriteTarget} in `selectServers.ts` for why a folder scope
 * is not a write candidate at all.
 */
function inspectServersConfig(): ConfigInspection<string[]> | undefined {
  return vscode.workspace.getConfiguration(CONFIG_SECTION).inspect<string[]>(SERVERS_SETTING_KEY);
}

/** `WorkspaceConfiguration.update("servers", value, target)`, scoped to `irisMcpLauncher`. */
function updateServersConfig(value: string[], target: ConfigWriteTarget): PromiseLike<void> {
  const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
  return config.update(SERVERS_SETTING_KEY, value, toConfigurationTarget(target));
}

export function activate(context: vscode.ExtensionContext): void {
  const outputChannel = vscode.window.createOutputChannel("IRIS MCP Launcher");
  context.subscriptions.push(outputChannel);

  // Credential containment (AC 31.4.3, extended by AC 31.5.5 to the Story
  // 31.5 UI surfaces): this output channel and every `showWarning`/`showInfo`
  // call below carry only fixed, human-authored strings plus non-secret data
  // — server/package/plan labels (`serverDefinitionProvider.ts`), Server
  // Manager server names/descriptions, and the `irisMcpLauncher.servers`
  // selection itself (`selectServers.ts`) — never a resolved profile, env
  // map, or session/token value. The ONE settings write this extension makes
  // (`updateServersConfig`, below) writes exactly that same non-secret
  // selection to `irisMcpLauncher.servers` and nothing else; no code path in
  // this extension writes a credential to `context.globalState`,
  // `context.workspaceState`, any configuration key, or any log/output
  // channel.
  const showWarning = (message: string): void => {
    outputChannel.appendLine(message);
    void vscode.window.showWarningMessage(message);
  };

  // Task 2 / AC 31.5.2 / AC 31.5.6: the ONLY informational (non-warning)
  // message this extension shows — the post-write "servers saved"
  // confirmation. Kept separate from `showWarning` so a successful save does
  // not render with a warning icon; still funnels through the same output
  // channel as every other user-facing message.
  const showInfo = (message: string): void => {
    outputChannel.appendLine(message);
    void vscode.window.showInformationMessage(message);
  };

  apiShapeWarningSink = showWarning;

  const getSettings = () =>
    readSettings((section) => toConfigReader(vscode.workspace.getConfiguration(section)));

  // Story 31.5: the command + status bar item are registered FIRST, before the
  // MCP provider below (code review, Story 31.5). `activate()` has no
  // top-level error containment, so anything that throws before this point
  // takes the whole activation down with it — and the single most likely
  // thrower is `vscode.lm.registerMcpServerDefinitionProvider`, which is
  // absent on VS Code forks and on hosts older than the `engines.vscode`
  // floor. Registering the UI surfaces first means that failure degrades to
  // "MCP not registered, one warning" instead of "command not found + no
  // status bar item", i.e. it cannot silently destroy exactly the zero-state
  // discoverability signal AC 31.5.3/31.5.4 exist to guarantee.

  // Story 31.5: server-selection command (AC 31.5.1/31.5.2/31.5.5/31.5.6).
  const selectServersDeps: SelectServersDeps = {
    getServerManagerApi,
    // 32-3-R3: lets the command's "not available" warning stay silent when
    // the real cause was a shape/version mismatch (already warned, once).
    getServerManagerApiFailureReason: () => lastApiFailure,
    getSettings,
    configWriter: {
      inspectServers: inspectServersConfig,
      updateServers: updateServersConfig,
    },
    showQuickPick: (items: SelectServersQuickPickItem[]) =>
      vscode.window.showQuickPick(items, {
        canPickMany: true,
        matchOnDescription: true,
        matchOnDetail: true,
        // Without this the picker is dismissed — resolving `undefined`, i.e.
        // the cancel path — the moment focus moves elsewhere, silently
        // discarding a multi-selection the user may have spent a while
        // building. `QuickPickOptions.ignoreFocusOut` defaults to `false`
        // (`@types/vscode@1.125.0` index.d.ts, `QuickInput.ignoreFocusOut`:
        // "Determines if the UI should stay open even when losing UI focus.
        // Defaults to false."). This picker actively invites the user to
        // switch to the Server Manager view to tell two similarly-named
        // servers apart, so losing the selection is a realistic gesture.
        ignoreFocusOut: true,
        placeHolder: "Select the IRIS servers to expose as MCP servers",
      }),
    // 31-5-3: confirm before writing an empty selection ([] = expose ALL,
    // the inverse of the uncheck-everything gesture).
    confirmExposeAll: async () => {
      const choice = await vscode.window.showWarningMessage(
        "IRIS MCP Launcher: you unchecked every server. An empty irisMcpLauncher.servers means " +
          "EVERY server InterSystems Server Manager reports will be exposed (the documented " +
          "default) — not that no servers are exposed.",
        { modal: true },
        "Expose All",
      );
      return choice === "Expose All";
    },
    showWarning,
    showInfo,
  };

  const selectServersCommand = vscode.commands.registerCommand(SELECT_SERVERS_COMMAND_ID, () =>
    selectServers(selectServersDeps),
  );
  context.subscriptions.push(selectServersCommand);

  // Story 32.2: governance editor command (AC 32.2.1/32.2.2). Thin adapters
  // over governancePanel.ts's injected-dependency orchestration — the real
  // WebviewPanel, showOpenDialog, the governanceFile settings write, and the
  // engine host that composes governanceEngine.ts's pure pieces (resolution,
  // env scrub, subprocess). The panel edits the governance FILE only — never
  // client configs, never env — and every write goes through the shared CLI.
  const governanceEngineHost: GovernanceEngineHost = {
    describe: async () => {
      try {
        const resolution = await resolveGovernanceCli(getSettings(), true);
        return resolution.ok
          ? { ok: true, mode: resolution.target.mode }
          : { ok: false, error: resolution.error };
      } catch {
        return {
          ok: false as const,
          error: "could not read the irisMcpLauncher settings to resolve the governance CLI",
        };
      }
    },
    run: async (command) => {
      let settings;
      try {
        settings = getSettings();
      } catch {
        return {
          status: null,
          stdout: "",
          stderr: "",
          spawnError: "could not read the irisMcpLauncher settings to run the governance CLI",
        };
      }
      const resolution = await resolveGovernanceCli(settings, command.kind === "universe");
      if (!resolution.ok) {
        return { status: null, stdout: "", stderr: "", spawnError: resolution.error };
      }
      const env = buildGovernanceCliEnv(settings, resolution.target.extraEnv);
      return runGovernanceCli(resolution.target, command, env);
    },
  };

  const openGovernanceEditor = createGovernancePanelOpener({
    getSettings,
    getServerManagerNames: async () => {
      const api = await getServerManagerApi();
      if (!api) return [];
      return api.getServerNames().map((server) => server.name);
    },
    engine: governanceEngineHost,
    fileExists: async (candidatePath) => {
      // 32-2-R1: async stat (the 31-6-2 discipline) — a UNC governance-file
      // path must never stall the extension host on panel open/refresh.
      try {
        return (await stat(candidatePath)).isFile();
      } catch {
        return false;
      }
    },
    chooseFile: async () => {
      const uris = await vscode.window.showOpenDialog({
        canSelectFiles: true,
        canSelectFolders: false,
        canSelectMany: false,
        openLabel: "Use as governance file",
        filters: { "JSON files": ["json"], "All files": ["*"] },
        title: "Choose the IRIS governance policy file",
      });
      return uris?.[0]?.fsPath;
    },
    updateGovernanceFileSetting: (filePath) => {
      // Two-statement idiom (mirrors updateServersConfig): keeps the write
      // legible to containment.test.ts's single-expression-chain grep.
      // Scope: write to the scope that ALREADY carries the setting (the
      // selectServers resolveWriteTarget discipline) — a hardcoded Global
      // write is silently shadowed by a workspace-scoped value on the very
      // next read, so the picker would appear to do nothing (32.2 review).
      const config = vscode.workspace.getConfiguration(CONFIG_SECTION);
      const inspection = config.inspect<string>(GOVERNANCE_FILE_SETTING_KEY);
      const target =
        inspection?.workspaceValue !== undefined
          ? vscode.ConfigurationTarget.Workspace
          : vscode.ConfigurationTarget.Global;
      return config.update(GOVERNANCE_FILE_SETTING_KEY, filePath, target);
    },
    createPanel: () => {
      const webviewPanel = vscode.window.createWebviewPanel(
        "irisMcpGovernance",
        "IRIS Governance",
        vscode.ViewColumn.One,
        { enableScripts: true },
      );
      return {
        setHtml: (html) => {
          webviewPanel.webview.html = html;
        },
        onMessage: (listener) => {
          webviewPanel.webview.onDidReceiveMessage(listener, undefined, context.subscriptions);
        },
        onDispose: (listener) => {
          webviewPanel.onDidDispose(listener, undefined, context.subscriptions);
        },
        reveal: () => {
          webviewPanel.reveal();
        },
      };
    },
    showWarning,
  });

  const openGovernanceEditorCommand = vscode.commands.registerCommand(
    OPEN_GOVERNANCE_EDITOR_COMMAND_ID,
    () => void openGovernanceEditor(),
  );
  context.subscriptions.push(openGovernanceEditorCommand);

  // Story 33.3: "MCP Clients" view (AC 33.3.1–33.3.3, Integration AC
  // 33.3-I1). Thin adapters over clientsPanel.ts's injected-dependency
  // orchestration — the real WebviewPanel, the globalState roster memento,
  // the explicit-mode input boxes, and the engine host that composes
  // clientsEngine.ts's pieces (resolution, IRIS_* env scrub, subprocess).
  // Every client-config read/write happens inside the iris-mcp-clients CLI
  // subprocess — the same single code path as the terminal CLI; the ONE
  // state write this surface adds is the roster (client ids, UI state only).
  const runClientsCommand = async (command: ClientsCliCommand) => {
    let settings;
    try {
      settings = getSettings();
    } catch {
      return {
        status: null,
        stdout: "",
        stderr: "",
        spawnError: "could not read the irisMcpLauncher settings to run the clients CLI",
      };
    }
    const resolution = await resolveClientsCli(settings);
    if (!resolution.ok) {
      return { status: null, stdout: "", stderr: "", spawnError: resolution.error };
    }
    const env = buildClientsCliEnv(settings, resolution.target.extraEnv);
    return runClientsCli(resolution.target, command, env);
  };

  const clientsEngineHost: ClientsEngineHost = {
    describe: async () => {
      try {
        const resolution = await resolveClientsCli(getSettings());
        return resolution.ok
          ? { ok: true, mode: resolution.target.mode }
          : { ok: false, error: resolution.error };
      } catch {
        return {
          ok: false as const,
          error: "could not read the irisMcpLauncher settings to resolve the clients CLI",
        };
      }
    },
    detect: () => detectClientsJson(runClientsCommand),
    status: () => statusMatrixJson(runClientsCommand),
    modes: () => availableModes(runClientsCommand),
    diffApply: (args) => diffApplyJson(runClientsCommand, args),
    diffApplyText: (args) => diffApplyText(runClientsCommand, args),
    apply: (args) => applyJson(runClientsCommand, args),
    toggle: (action, args) => toggleJson(runClientsCommand, action, args),
    restore: (args) => restoreJson(runClientsCommand, args),
    doctor: () => doctorJson(runClientsCommand),
  };

  const manageClients = createClientsPanelOpener({
    engine: clientsEngineHost,
    getClientRoster: () => context.globalState.get<unknown>(CLIENT_ROSTER_STATE_KEY),
    setClientRoster: (ids) => {
      // Two-statement idiom (mirrors updateServersConfig): keeps the write
      // legible to containment.test.ts's single-expression-chain grep. The
      // roster is UI state (client ids) — never config, never a credential.
      const state = context.globalState;
      return state.update(CLIENT_ROSTER_STATE_KEY, ids);
    },
    askInput: (options) =>
      vscode.window.showInputBox({
        prompt: options.prompt,
        password: options.password === true,
        placeHolder: options.placeHolder,
        // The explicit-mode confirmation + password are deliberately typed;
        // losing the box on focus-out would silently discard them.
        ignoreFocusOut: true,
      }),
    createPanel: () => {
      const webviewPanel = vscode.window.createWebviewPanel(
        "irisMcpClients",
        "MCP Clients",
        vscode.ViewColumn.One,
        { enableScripts: true },
      );
      return {
        setHtml: (html) => {
          webviewPanel.webview.html = html;
        },
        onMessage: (listener) => {
          webviewPanel.webview.onDidReceiveMessage(listener, undefined, context.subscriptions);
        },
        onDispose: (listener) => {
          webviewPanel.onDidDispose(listener, undefined, context.subscriptions);
        },
        reveal: () => {
          webviewPanel.reveal();
        },
      };
    },
    showWarning,
  });

  const manageClientsCommand = vscode.commands.registerCommand(MANAGE_CLIENTS_COMMAND_ID, () =>
    void manageClients(),
  );
  context.subscriptions.push(manageClientsCommand);

  // Story 31.5: status bar item (AC 31.5.3/31.5.4) — created unconditionally
  // in `activate()`. `package.json`'s `onStartupFinished` activation event
  // (AC 31.5.4) is what makes this appear on a plain window reload with MCP
  // never exercised; without it, `activate()` (and this item) would not run
  // until VS Code's MCP subsystem first asked for definitions, defeating the
  // zero-state's whole purpose.
  const statusBarItem = vscode.window.createStatusBarItem(
    STATUS_BAR_ITEM_ID,
    vscode.StatusBarAlignment.Left,
  );
  statusBarItem.name = "IRIS MCP Launcher";
  statusBarItem.command = SELECT_SERVERS_COMMAND_ID;
  context.subscriptions.push(statusBarItem);

  const provider = new LauncherProvider({
    getServerManagerApi,
    // 32-3-R3: same misattribution guard as the select-servers command.
    getServerManagerApiFailureReason: () => lastApiFailure,
    authApi,
    getSettings,
    showWarning,
    // 32.4 review (Edge L4): diagnostic crumb for the 32-3-R14 containment —
    // output channel only, never a toast; the provider bounds the content to
    // the error name + a truncated message (no profile/env/session data).
    logDiagnostic: (message) => outputChannel.appendLine(message),
  });

  // 32-3-R8 (Story 32.4): monotonic refresh guard. Two overlapping async
  // refreshes (activation + a config change, or rapid successive changes)
  // otherwise complete out of order and the OLDER settings read / plan count
  // overwrites the newer render. The latest refresh owns the item; an older
  // one still in flight when a newer starts abandons its render.
  let refreshSeq = 0;

  const refreshStatusBar = async (): Promise<void> => {
    const seq = ++refreshSeq;
    let settings;
    try {
      settings = getSettings();
    } catch {
      // Never let a hand-edited settings.json crash the status bar refresh
      // (same containment/never-throw bar as the provider). Deliberately NOT
      // the zero-state text: rendering "IRIS MCP: none" here would be
      // indistinguishable from a healthy fresh install, hiding a broken
      // settings file behind a normal-looking status bar (code review, Story
      // 31.5). Logged to the output channel — the sanctioned surface — rather
      // than shown as a toast, since this runs on every configuration change.
      outputChannel.appendLine(
        "IRIS MCP Launcher: could not read irisMcpLauncher settings while refreshing the status bar. " +
          "Check that irisMcpLauncher.servers and irisMcpLauncher.packages are arrays of strings.",
      );
      statusBarItem.text = "$(warning) IRIS MCP: settings error";
      statusBarItem.tooltip =
        "IRIS MCP Launcher: could not read your irisMcpLauncher settings.\n" +
        "See the 'IRIS MCP Launcher' output channel for details.";
      statusBarItem.show();
      return;
    }
    // 31-5-2 (Story 32.3 — product decision): the status bar reports the
    // EFFECTIVE registered-server count (distinct servers in the accepted
    // plans), not the raw `irisMcpLauncher.servers.length`, which diverges on
    // hand-edited duplicates and mistyped names. Replanning here also keeps
    // `plansByLabel` fresh on every config change; the one-time-warning
    // dedupe (31-6-1) keeps repeated replans silent. A planning failure
    // degrades to the raw count (registeredCount undefined) rather than
    // breaking the status bar.
    let registeredCount: number | undefined;
    try {
      await provider.providePlannedDefinitions();
      registeredCount = provider.registeredServerCount();
    } catch {
      registeredCount = undefined;
    }
    // 32-3-R8: a newer refresh started while this one awaited — it owns the
    // status bar; rendering here would restore a STALE settings read.
    if (seq !== refreshSeq) return;
    const state = buildStatusBarState(settings, registeredCount);
    statusBarItem.text = state.text;
    statusBarItem.tooltip = state.tooltip;
    statusBarItem.show();
  };

  void refreshStatusBar();

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration(CONFIG_SECTION)) {
        void refreshStatusBar();
      }
    }),
  );

  try {
    const registration = vscode.lm.registerMcpServerDefinitionProvider(PROVIDER_ID, {
      provideMcpServerDefinitions: async (_token) => {
        // 31-4-6: the editor's CancellationToken is honored on the resolve
        // path (the multi-server credential loop); the provide path resolves
        // no credentials, so the token is not needed here.
        const planned = await provider.providePlannedDefinitions();
        return planned.map(
          (definition) =>
            new vscode.McpStdioServerDefinition(
              definition.label,
              definition.command,
              definition.args,
              {},
            ),
        );
      },
      resolveMcpServerDefinition: async (server, token) => {
        const env = await provider.resolveEnvForLabel(server.label, token);
        if (!env) {
          // First-class cancellation/error outcome: return undefined so the
          // editor quietly does not start this server (Task 3) — no exception,
          // no toast storm beyond the single `showWarning` already issued above.
          return undefined;
        }
        if (!(server instanceof vscode.McpStdioServerDefinition)) {
          // Fail CLOSED. Returning `server` unmodified here would spawn a child
          // with none of the resolved IRIS_* variables — after having already
          // prompted the user for their password — and it would die with an
          // opaque "IRIS_USERNAME environment variable is required".
          showWarning(
            `IRIS MCP Launcher: "${server.label}" was not started — the editor returned an ` +
              `unexpected server definition type, so the resolved connection could not be applied.`,
          );
          return undefined;
        }
        server.env = env;
        return server;
      },
    });

    context.subscriptions.push(registration);
  } catch {
    // `vscode.lm.registerMcpServerDefinitionProvider` is finalized as of the
    // `engines.vscode` floor (^1.101.0), but VS Code forks report their own
    // version and may not implement it. One warning, no third-party error
    // text, and — because this block runs LAST — the command and status bar
    // item registered above survive (code review, Story 31.5).
    showWarning(
      "IRIS MCP Launcher: this editor does not support MCP server definition providers, so no " +
        "IRIS MCP servers were registered. The extension's settings and the " +
        '"IRIS MCP Launcher: Select Servers…" command still work.',
    );
  }
}

export function deactivate(): void {
  cachedApi = undefined;
  apiShapeWarningSink = undefined;
  lastApiFailure = undefined;
  apiShapeWarned = false;
}
