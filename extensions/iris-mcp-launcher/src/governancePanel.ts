/**
 * Governance editor panel orchestration (Story 32.2) — the stateful middle
 * layer between the pure view-model ({@link ./governanceView.js}) and the
 * subprocess engine ({@link ./governanceEngine.js}).
 *
 * Deliberately has NO value-level dependency on the `vscode` module (the
 * "one vscode import" rule): `extension.ts` adapts the real WebviewPanel,
 * `window.showOpenDialog`, and the `irisMcpLauncher.governanceFile` settings
 * write onto {@link GovernancePanelDeps}; tests inject fakes whose CLI
 * outputs are captured from the real bin (Rule #36).
 *
 * Credential containment (AC 31.4.3's bar, extended): this module never sees
 * a credential. It reads only Server Manager server NAMES (public metadata,
 * the selectServers discipline), this extension's own non-secret settings,
 * and the governance CLI's JSON output; the engine layer it calls scrubs
 * every `IRIS_*` variable from the spawned environment. The ONE settings
 * write it performs is the governance file PATH (a non-secret string).
 */
import type {
  GovernanceCliCommand,
  GovernanceCliResult,
} from "./governanceEngine.js";
import { parseCliJson } from "./governanceEngine.js";
import {
  GLOBAL_TAB,
  clearStaged,
  computeProfileTabs,
  renderEmptyStateHtml,
  renderGovernanceHtml,
  renderProfileForTab,
  stageToggle,
  stagedCliCommands,
  type DiffJson,
  type GovernanceViewMessage,
  type GovernanceViewState,
  type UniverseJson,
  type ValidateJson,
} from "./governanceView.js";
import type { LauncherSettings } from "./types.js";

/** The command id — single source of truth for package.json + extension.ts (`packaging.test.ts` cross-checks mechanically). */
export const OPEN_GOVERNANCE_EDITOR_COMMAND_ID = "irisMcpLauncher.openGovernanceEditor";

/** How the panel reaches the CLI — composed in `extension.ts` from governanceEngine's pieces. */
export interface GovernanceEngineHost {
  /** Run one CLI command; resolution/spawn failures come back as `spawnError` (never throws). */
  run(command: GovernanceCliCommand): Promise<GovernanceCliResult>;
  /** The resolution mode for display, or the resolution error to render. */
  describe(): { ok: true; mode: "local" | "npx" } | { ok: false; error: string };
}

/** The adapted webview panel surface this module drives. */
export interface GovernancePanelHandle {
  setHtml(html: string): void;
  onMessage(listener: (message: GovernanceViewMessage) => void): void;
  onDispose(listener: () => void): void;
  reveal(): void;
}

export interface GovernancePanelDeps {
  getSettings: () => LauncherSettings;
  /** Server Manager server NAMES only (public metadata — never a spec, never a credential). Failure degrades to []. */
  getServerManagerNames: () => Promise<string[]>;
  engine: GovernanceEngineHost;
  /** Whether the governance file exists on disk (a missing file fails server startup — the view warns). */
  fileExists: (path: string) => boolean;
  /** Adapted `window.showOpenDialog` — resolves the chosen path, or undefined when dismissed. */
  chooseFile: () => Promise<string | undefined>;
  /** Adapted `WorkspaceConfiguration.update("governanceFile", path, Global)`. May reject — guarded. */
  updateGovernanceFileSetting: (path: string) => PromiseLike<void>;
  createPanel: () => GovernancePanelHandle;
  showWarning: (message: string) => void;
  /** Nonce source for the webview CSP (injectable for deterministic tests). */
  nonce?: () => string;
}

function defaultNonce(): string {
  // Webview CSP nonces are not cryptographic key material; 32 bits of
  // decimal noise per call is ample for a same-origin-less webview script.
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/** Human-readable single line for a failed CLI read command (prefers the engine's own JSON error/stderr text). */
function cliFailureText(command: GovernanceCliCommand, result: GovernanceCliResult): string {
  const parsed = parseCliJson(result.stdout, result.stderr);
  const detail =
    !parsed.ok && parsed.error !== ""
      ? parsed.error
      : parsed.ok && typeof (parsed.json as { error?: unknown }).error === "string"
        ? ((parsed.json as { error: string }).error)
        : `exit ${result.status ?? "unknown"}`;
  return `iris-mcp-governance ${command.kind} failed: ${detail}`;
}

/**
 * Create the `irisMcpLauncher.openGovernanceEditor` command handler. The
 * returned function is idempotent across invocations: a second invocation
 * reveals the already-open panel (and refreshes it) rather than stacking
 * duplicates.
 */
export function createGovernancePanelOpener(deps: GovernancePanelDeps): () => Promise<void> {
  const nonce = deps.nonce ?? defaultNonce;
  let panel: GovernancePanelHandle | undefined;
  let state: GovernanceViewState | undefined;
  let busy = false;

  const render = (): void => {
    if (panel === undefined) return;
    panel.setHtml(
      state === undefined
        ? renderEmptyStateHtml(nonce(), engineDescribeError())
        : renderGovernanceHtml(state, nonce()),
    );
  };

  const engineDescribeError = (): string | undefined => {
    const described = deps.engine.describe();
    return described.ok ? undefined : described.error;
  };

  /** Run a read command and parse its single-JSON-object stdout; returns undefined + records loadError on failure. */
  const runRead = async <T>(command: GovernanceCliCommand): Promise<T | undefined> => {
    const result = await deps.engine.run(command);
    if (result.spawnError !== undefined) {
      if (state !== undefined) state = { ...state, loadError: result.spawnError };
      return undefined;
    }
    if (result.status !== 0) {
      if (state !== undefined) state = { ...state, loadError: cliFailureText(command, result) };
      return undefined;
    }
    const parsed = parseCliJson(result.stdout, result.stderr);
    if (!parsed.ok) {
      if (state !== undefined) state = { ...state, loadError: parsed.error };
      return undefined;
    }
    const json = parsed.json as T & { error?: string };
    if (typeof json.error === "string") {
      if (state !== undefined) state = { ...state, loadError: json.error };
      return undefined;
    }
    return json as T;
  };

  /** Fetch (or refetch) the universe render for ONE tab into state. */
  const loadUniverseForTab = async (tab: string, file: string, fileExists: boolean): Promise<void> => {
    if (state === undefined) return;
    const universe = await runRead<UniverseJson>({
      kind: "universe",
      file: fileExists ? file : undefined,
      profile: renderProfileForTab(tab),
    });
    if (universe !== undefined && state !== undefined) {
      // Minimal shape guard: `runRead` proves exit-0 + parseable JSON, not
      // the universe CONTRACT — a version-skewed/buggy CLI emitting a
      // success-status malformed payload would otherwise crash the render
      // (universe.packages.map) with the failure swallowed by the message
      // pump (32.2 review).
      if (
        !Array.isArray(universe.packages) ||
        !Array.isArray(universe.keys) ||
        typeof universe.policy !== "object" ||
        universe.policy === null ||
        typeof universe.configSource !== "object" ||
        universe.configSource === null
      ) {
        state = {
          ...state,
          loadError: "iris-mcp-governance universe produced an unexpected output shape (a version skew with the CLI?)",
        };
        return;
      }
      state = {
        ...state,
        universeByTab: { ...state.universeByTab, [tab]: universe },
      };
    }
  };

  /** Full refresh: re-read settings, validate/diff (existing file only), and the active tab's universe. */
  const refresh = async (): Promise<void> => {
    let settings: LauncherSettings;
    try {
      settings = deps.getSettings();
    } catch {
      deps.showWarning(
        "IRIS MCP Launcher: could not read the irisMcpLauncher settings for the governance editor. " +
          "Check your settings.json.",
      );
      return;
    }
    const described = deps.engine.describe();

    if (settings.governanceFile === "") {
      state = undefined;
      render();
      return;
    }
    const file = settings.governanceFile;
    const fileExists = deps.fileExists(file);

    let serverManagerNames: string[] = [];
    try {
      serverManagerNames = await deps.getServerManagerNames();
    } catch {
      serverManagerNames = [];
    }

    const priorTabs = state?.profileTabs;
    const priorActive = state?.activeTab;
    state = {
      file,
      fileExists,
      engineMode: described.ok ? described.mode : "npx",
      validation: undefined,
      diff: undefined,
      universeByTab: {},
      profileTabs: [],
      activeTab: GLOBAL_TAB,
      staged: state?.staged ?? [],
      preset: settings.governancePreset,
      loadError: described.ok ? undefined : described.error,
    };

    if (fileExists) {
      // `validate` is special: exit 1 with {"ok":false,"error"} is a
      // LEGITIMATE outcome (the file is invalid — the view shows the engine's
      // own error and disables editing), not a load failure. Only a
      // spawn/parse failure is a loadError.
      const validationResult = await deps.engine.run({ kind: "validate", file });
      if (validationResult.spawnError !== undefined) {
        state = { ...state, loadError: validationResult.spawnError };
      } else {
        const parsed = parseCliJson(validationResult.stdout, validationResult.stderr);
        if (!parsed.ok) {
          state = { ...state, loadError: parsed.error };
        } else if (typeof (parsed.json as ValidateJson).ok === "boolean") {
          state = { ...state, validation: parsed.json as ValidateJson };
        } else {
          state = {
            ...state,
            loadError: "iris-mcp-governance validate produced an unexpected output shape",
          };
        }
      }
      if (state.validation?.ok) {
        const diff = await runRead<DiffJson>({ kind: "diff", file });
        if (diff !== undefined && state !== undefined) {
          state = { ...state, diff };
        }
      }
    }

    if (state !== undefined) {
      const tabs = computeProfileTabs(serverManagerNames, state.diff);
      const activeTab =
        priorActive !== undefined && priorTabs !== undefined && tabs.includes(priorActive)
          ? priorActive
          : GLOBAL_TAB;
      state = { ...state, profileTabs: tabs, activeTab };
      if (state.validation === undefined || state.validation.ok) {
        await loadUniverseForTab(activeTab, file, fileExists);
      }
    }
    render();
  };

  const save = async (): Promise<void> => {
    if (state === undefined) return;
    const commands = stagedCliCommands(state);
    for (const command of commands) {
      const result = await deps.engine.run(command);
      if (state === undefined) return; // disposed mid-save — abandon quietly
      if (result.spawnError !== undefined || result.status !== 0) {
        // The CLI's own error text (its validation/write messages) is the
        // actionable content; the FAILED edit and everything after it stay
        // staged so the user can retry after fixing the cause — but edits
        // that already SUCCEEDED were dropped from `staged` as they applied
        // (below), so a retry never replays them (a replayed `unset` fails
        // "nothing to unset" and wedges the sequence at its head — 32.2
        // review).
        const detail =
          result.spawnError ??
          (result.stderr.trim() !== "" ? result.stderr.trim() : `exit ${result.status ?? "unknown"}`);
        state = { ...state, loadError: `Save failed on ${command.kind} "${command.key}": ${detail}` };
        deps.showWarning(
          `IRIS MCP Launcher: the governance edit could not be written — ${detail}`,
        );
        render();
        return;
      }
      // Applied — drop it from the staged list immediately (keyed by the
      // tab/key identity stageToggle enforces as unique).
      const appliedTab = command.profile ?? GLOBAL_TAB;
      state = {
        ...state,
        staged: state.staged.filter(
          (change) => !(change.tab === appliedTab && change.key === command.key),
        ),
      };
    }
    await refresh();
  };

  const onMessage = async (message: GovernanceViewMessage): Promise<void> => {
    switch (message.type) {
      case "chooseFile": {
        if (busy) return;
        busy = true;
        try {
          const chosen = await deps.chooseFile();
          if (chosen !== undefined) {
            try {
              await deps.updateGovernanceFileSetting(chosen);
            } catch {
              deps.showWarning(
                "IRIS MCP Launcher: the chosen governance file path could not be written to " +
                  "irisMcpLauncher.governanceFile (a read-only settings file?). Set it manually.",
              );
            }
            await refresh();
          }
        } finally {
          busy = false;
        }
        return;
      }
      case "refresh": {
        if (busy) return;
        busy = true;
        try {
          await refresh();
        } finally {
          busy = false;
        }
        return;
      }
      case "save": {
        if (busy) return;
        busy = true;
        try {
          await save();
        } finally {
          busy = false;
        }
        return;
      }
      case "discard": {
        // Busy-guarded like save/refresh: a Discard landing mid-save would
        // clear `staged` while the save's snapshot command list keeps
        // writing — Discard appears to work but the writes still land (32.2
        // review).
        if (busy) return;
        if (state !== undefined) {
          state = clearStaged(state);
          render();
        }
        return;
      }
      case "stage": {
        // Busy-guarded like save/refresh: a toggle landing mid-save is never
        // in the save's snapshot command list and was silently wiped by the
        // post-save clear (32.2 review).
        if (busy) return;
        if (state !== undefined) {
          // Message-boundary validation (the switchProfile discipline): the
          // value must be a real tri-state and the key must belong to the
          // active tab's universe when one is loaded — a malformed message
          // otherwise staged a silent key DELETION ("unset") or an unknown
          // key the CLI warns-but-writes (32.2 review).
          if (message.value !== "enabled" && message.value !== "disabled" && message.value !== "inherit") {
            return;
          }
          const universe = state.universeByTab[state.activeTab];
          if (universe !== undefined && !universe.keys.includes(message.key)) {
            return;
          }
          state = stageToggle(state, state.activeTab, message.key, message.value);
          render();
        }
        return;
      }
      case "switchProfile": {
        if (state === undefined || busy) return;
        if (!state.profileTabs.includes(message.profile)) return;
        state = { ...state, activeTab: message.profile };
        if (state.universeByTab[message.profile] === undefined) {
          busy = true;
          try {
            await loadUniverseForTab(message.profile, state.file, state.fileExists);
          } finally {
            busy = false;
          }
        }
        render();
        return;
      }
    }
  };

  return async () => {
    if (panel !== undefined) {
      panel.reveal();
      // Busy-guarded like every other operation that rebuilds state: an
      // unguarded refresh here interleaved with an in-flight save's CLI
      // write sequence, rendering partially-applied intermediate state
      // (32.2 review). The in-flight operation renders when it finishes.
      if (busy) return;
      busy = true;
      try {
        await refresh();
      } finally {
        busy = false;
      }
      return;
    }
    panel = deps.createPanel();
    panel.onMessage((message) => {
      // Never let a rejected handler take down the extension host's message
      // pump — every failure path above renders inline instead.
      void onMessage(message).catch(() => undefined);
    });
    panel.onDispose(() => {
      panel = undefined;
      state = undefined;
      // Reset the busy guard too: a hung CLI (a stalled first-run npx
      // download) holds `busy` in THIS closure, and the opener is the same
      // closure — without the reset a reopened panel inherits busy:true with
      // every guarded action dead until a window reload (32.2 review).
      busy = false;
    });
    await refresh();
  };
}
