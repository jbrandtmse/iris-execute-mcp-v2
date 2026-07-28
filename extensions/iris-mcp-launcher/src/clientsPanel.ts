/**
 * MCP Clients panel orchestration (Story 33.3, Task 3) — the stateful middle
 * layer between the pure view-model ({@link ./clientsView.js}) and the
 * subprocess engine ({@link ./clientsEngine.js}), mirroring
 * `governancePanel.ts` (the Story 32.2 precedent).
 *
 * Deliberately has NO value-level dependency on the `vscode` module (the
 * "one vscode import" rule): `extension.ts` adapts the real WebviewPanel,
 * `context.globalState`, and `window.showInputBox` onto
 * {@link ClientsPanelDeps}; tests inject fakes whose CLI outputs are shaped
 * like the real bin's (Rule #36).
 *
 * Credential containment (AC 31.4.3's bar, extended): this module never sees
 * a resolved connection credential. The ONE secret it ever holds is the
 * explicit-mode literal password the user types for an explicit apply — held
 * ONLY in this closure (`explicitSecret`), never in view state, never in
 * HTML, never in globalState, never in a log/warning string, and passed to
 * the engine only as the child's stdin payload (the CLI's `--password-stdin`
 * contract). It is cleared on confirm/cancel/dispose/refresh.
 *
 * Every write flows: diff preview → explicit confirm (the webview's Confirm
 * button) → the engine (AC 33.3.3, Integration AC 33.3-I1 — the same single
 * code path as the terminal CLI). The panel never reads or writes a client
 * config file itself; the roster (UI state, client ids only) is the one
 * thing it persists, via the injected globalState seam.
 */
import type {
  ApplyData,
  ApplyPlanArgs,
  CliDataResult,
  CliEnvMode,
  DetectData,
  DiffApplyData,
  DoctorResult,
  EngineResultJson,
  StatusData,
} from "./clientsEngine.js";
import {
  activateClient,
  applyValidation,
  cancelPending,
  dismissNotices,
  effectiveRosterSelection,
  initialClientsViewState,
  modeFor,
  renderClientsHtml,
  sanitizePersistedRoster,
  scopeFor,
  setMode,
  setScope,
  stageApply,
  stageRestore,
  stageToggleAction,
  toggleApplyServer,
  toggleRosterClient,
  writeFailed,
  writeSucceeded,
  type ClientsViewMessage,
  type ClientsViewState,
} from "./clientsView.js";

/** The command id — single source of truth for package.json + extension.ts (`packaging.test.ts` cross-checks mechanically). */
export const MANAGE_CLIENTS_COMMAND_ID = "irisMcpLauncher.manageClients";

/** The globalState key for the persisted client roster (UI state — client ids only, never config or credentials). */
export const CLIENT_ROSTER_STATE_KEY = "irisMcpLauncher.clientRoster";

/**
 * How the panel reaches the CLI — composed in `extension.ts` from
 * clientsEngine's typed per-command wrappers (the Task-1 engine surface).
 */
export interface ClientsEngineHost {
  /** The resolution mode for display, or the resolution error to render. Async (32-2-R1: no sync stat on the extension host). */
  describe(): Promise<{ ok: true; mode: "local" | "npx" } | { ok: false; error: string }>;
  detect(): Promise<CliDataResult<DetectData>>;
  status(): Promise<CliDataResult<StatusData>>;
  modes(): Promise<CliDataResult<CliEnvMode[]>>;
  /** The structured apply preview (non-explicit modes). */
  diffApply(args: ApplyPlanArgs): Promise<CliDataResult<DiffApplyData>>;
  /** The CLI's redacted TEXT apply preview (explicit mode — see clientsEngine's banner). */
  diffApplyText(args: ApplyPlanArgs): Promise<CliDataResult<string>>;
  apply(args: ApplyPlanArgs): Promise<CliDataResult<ApplyData>>;
  toggle(
    action: "enable" | "disable" | "remove",
    args: { client: string; scope: "user" | "project"; server: string },
  ): Promise<CliDataResult<EngineResultJson>>;
  restore(args: { client: string; scope: "user" | "project" }): Promise<CliDataResult<EngineResultJson>>;
  doctor(): Promise<DoctorResult>;
}

/** The adapted webview panel surface this module drives. */
export interface ClientsPanelHandle {
  setHtml(html: string): void;
  onMessage(listener: (message: ClientsViewMessage) => void): void;
  onDispose(listener: () => void): void;
  reveal(): void;
}

export interface ClientsPanelDeps {
  engine: ClientsEngineHost;
  /** Read the persisted roster (extension globalState; unknown shape — sanitized in the view layer). */
  getClientRoster: () => unknown;
  /** Persist the roster (client ids only). May reject — guarded (a persist failure never breaks the view). */
  setClientRoster: (ids: string[]) => PromiseLike<void>;
  /**
   * Adapted `window.showInputBox` — resolves the typed string, or undefined
   * when dismissed. `password: true` hides the input (the explicit-mode
   * literal password). Used ONLY for the explicit-mode confirmation + secret.
   * Return type is `PromiseLike` (not `Promise`) so the REAL `showInputBox` —
   * which returns a `vscode.Thenable` — satisfies it without a cast (the
   * AuthApi discipline in types.ts); fakes can return an ordinary Promise.
   */
  askInput: (options: { prompt: string; password?: boolean; placeHolder?: string }) => PromiseLike<string | undefined>;
  createPanel: () => ClientsPanelHandle;
  showWarning: (message: string) => void;
  /** Nonce source for the webview CSP (injectable for deterministic tests). */
  nonce?: () => string;
}

function defaultNonce(): string {
  // Webview CSP nonces are not cryptographic key material; 32 bits of
  // decimal noise per call is ample for a same-origin-less webview script.
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 1e9).toString(36)}`;
}

/**
 * Create the `irisMcpLauncher.manageClients` command handler. The returned
 * function is idempotent across invocations: a second invocation reveals the
 * already-open panel (and refreshes it) rather than stacking duplicates.
 */
export function createClientsPanelOpener(deps: ClientsPanelDeps): () => Promise<void> {
  const nonce = deps.nonce ?? defaultNonce;
  let panel: ClientsPanelHandle | undefined;
  let state: ClientsViewState | undefined;
  let busy = false;
  /** The explicit-mode literal password, held ONLY between the explicit
   * preview and its confirm/cancel — never in state, never rendered. */
  let explicitSecret: string | undefined;

  const render = (): void => {
    if (panel === undefined) return;
    panel.setHtml(renderClientsHtml(state ?? initialClientsViewState(), nonce()));
  };

  /** Full refresh: describe, detect, status, modes, roster (re-derived from the persisted selection). */
  const refresh = async (): Promise<void> => {
    const described = await deps.engine.describe();
    const persisted = sanitizePersistedRoster(deps.getClientRoster());

    const detect = await deps.engine.detect();
    const prior: ClientsViewState | undefined = state;
    state = {
      ...(prior ?? initialClientsViewState()),
      engineMode: described.ok ? described.mode : "npx",
      detect: detect.ok ? detect.data : undefined,
      status: undefined,
      restartNotices: [],
      loadError: described.ok ? undefined : described.error,
    };
    if (!detect.ok) {
      state = { ...state, loadError: state.loadError ?? detect.error };
      render();
      return;
    }
    const selection = effectiveRosterSelection(detect.data, persisted);
    state = {
      ...state,
      rosterSelected: selection,
      // The active client may have vanished from the selection (undetected
      // since, or deselected persisted roster).
      activeClient:
        state.activeClient !== undefined && selection.includes(state.activeClient)
          ? state.activeClient
          : undefined,
    };

    const modes = await deps.engine.modes();
    if (modes.ok) {
      state = { ...state, modes: modes.data };
    } else {
      // A modes-probe failure degrades to the two always-available modes
      // (the CLI's own gate stays the enforcement point at write time).
      state = { ...state, modes: ["env-reference", "explicit"] };
    }

    const status = await deps.engine.status();
    if (status.ok) {
      state = { ...state, status: status.data };
    } else {
      state = { ...state, loadError: state.loadError ?? status.error };
    }
    render();
  };

  /** Re-run ONLY the status matrix after a successful write (detect/modes cannot have changed). */
  const refreshStatus = async (): Promise<void> => {
    if (state === undefined) return;
    const status = await deps.engine.status();
    if (state === undefined) return;
    if (status.ok) {
      state = { ...state, status: status.data };
    } else {
      state = { ...state, loadError: status.error };
    }
  };

  /** The secret-acquisition + redacted-preview half of an explicit-mode apply (exactly one server, view-validated). */
  const previewExplicit = async (clientId: string, server: string): Promise<void> => {
    if (state === undefined) return;
    const typed = await deps.askInput({
      prompt: `explicit mode writes a literal IRIS_PASSWORD into ${clientId}'s config. Type the entry name exactly to confirm: ${server}`,
      placeHolder: server,
    });
    if (typed === undefined) return; // dismissed — nothing staged, no warning (a cancel is not an error)
    const password = await deps.askInput({
      prompt: "IRIS_PASSWORD (input hidden) — written literally into the client config by the CLI",
      password: true,
    });
    if (password === undefined || password === "") return;
    explicitSecret = password;
    const preview = await deps.engine.diffApplyText({
      client: clientId,
      scope: scopeFor(state, clientId),
      servers: [server],
      mode: "explicit",
      confirmSecret: typed,
      passwordStdin: password,
    });
    if (state === undefined) {
      explicitSecret = undefined;
      return;
    }
    if (!preview.ok) {
      explicitSecret = undefined;
      state = { ...state, loadError: preview.error };
    } else {
      state = stageApply(state, clientId, { kind: "text", text: preview.data }, typed);
    }
    render();
  };

  const previewApply = async (clientId: string): Promise<void> => {
    if (state === undefined) return;
    const validation = applyValidation(state, clientId);
    if (validation !== undefined) {
      deps.showWarning(`IRIS MCP Launcher: ${validation}`);
      return;
    }
    const mode = modeFor(state, clientId);
    const selection = state.applySelectionByClient[clientId] ?? [];
    if (mode === "explicit") {
      await previewExplicit(clientId, selection[0] as string);
      return;
    }
    const preview = await deps.engine.diffApply({
      client: clientId,
      scope: scopeFor(state, clientId),
      servers: selection,
      mode,
    });
    if (state === undefined) return;
    if (!preview.ok) {
      state = { ...state, loadError: preview.error };
    } else {
      state = stageApply(state, clientId, { kind: "json", data: preview.data });
    }
    render();
  };

  const confirmPending = async (): Promise<void> => {
    if (state === undefined || state.pendingAction === undefined) return;
    const pending = state.pendingAction;
    if (pending.kind === "apply") {
      const result = await deps.engine.apply({
        client: pending.client,
        scope: pending.scope,
        servers: pending.servers,
        mode: pending.mode,
        ...(pending.mode === "explicit"
          ? { confirmSecret: pending.confirmSecret ?? "", passwordStdin: explicitSecret ?? "" }
          : {}),
      });
      explicitSecret = undefined;
      if (state === undefined) return;
      if (!result.ok) {
        // An explicit-mode retry can NEVER succeed — the password was cleared
        // with this attempt — so the staged action is dropped and the error
        // surfaces as a banner (re-preview re-collects the secret). Other
        // modes keep the staged action for retry (33.3 review).
        state =
          pending.mode === "explicit"
            ? { ...cancelPending(state), loadError: result.error }
            : writeFailed(state, result.error);
      } else {
        state = writeSucceeded(state, result.data.restartHint);
        await refreshStatus();
      }
      render();
      return;
    }
    if (pending.kind === "toggle") {
      const result = await deps.engine.toggle(pending.action, {
        client: pending.client,
        scope: pending.scope,
        server: pending.server,
      });
      explicitSecret = undefined; // hygiene: never retain a stale secret past ANY confirm
      if (state === undefined) return;
      if (!result.ok) {
        state = writeFailed(state, result.error);
      } else {
        state = writeSucceeded(state, result.data.restartHint);
        await refreshStatus();
      }
      render();
      return;
    }
    const result = await deps.engine.restore({ client: pending.client, scope: pending.scope });
    explicitSecret = undefined; // hygiene: never retain a stale secret past ANY confirm
    if (state === undefined) return;
    if (!result.ok) {
      state = writeFailed(state, result.error);
    } else {
      state = writeSucceeded(state, result.data.restartHint);
      await refreshStatus();
    }
    render();
  };

  const onMessage = async (message: ClientsViewMessage): Promise<void> => {
    switch (message.type) {
      case "refresh": {
        if (busy) return;
        busy = true;
        try {
          explicitSecret = undefined;
          // An explicit-mode staged apply cannot survive the secret wipe
          // above: confirming it would send an EMPTY stdin (a guaranteed
          // exit-2 refusal — and writeFailed would keep the action for a
          // retry that can never succeed). Drop it instead (33.3 review).
          if (state?.pendingAction?.kind === "apply" && state.pendingAction.mode === "explicit") {
            state = cancelPending(state);
          }
          await refresh();
        } finally {
          busy = false;
        }
        return;
      }
      case "toggleClient": {
        if (busy || state === undefined || typeof message.client !== "string") return;
        state = toggleRosterClient(state, message.client);
        try {
          await deps.setClientRoster(state.rosterSelected);
        } catch {
          deps.showWarning(
            "IRIS MCP Launcher: the client roster selection could not be persisted (it will reset on reload).",
          );
        }
        render();
        return;
      }
      case "activateClient": {
        if (busy || state === undefined || typeof message.client !== "string") return;
        state = activateClient(state, message.client);
        render();
        return;
      }
      case "setScope": {
        if (busy || state === undefined) return;
        // Message-boundary validation (the 32.2 stage-message discipline).
        if (message.scope !== "user" && message.scope !== "project") return;
        state = setScope(state, message.client, message.scope);
        render();
        return;
      }
      case "setMode": {
        if (busy || state === undefined) return;
        state = setMode(state, message.client, message.mode);
        render();
        return;
      }
      case "toggleApplyServer": {
        if (busy || state === undefined) return;
        state = toggleApplyServer(state, message.client, message.server);
        render();
        return;
      }
      case "previewApply": {
        if (busy || state === undefined) return;
        busy = true;
        try {
          await previewApply(message.client);
        } finally {
          busy = false;
        }
        return;
      }
      case "stageToggle": {
        if (busy || state === undefined) return;
        if (message.action !== "enable" && message.action !== "disable" && message.action !== "remove") return;
        explicitSecret = undefined; // staging over a pending explicit apply drops its secret with it
        state = stageToggleAction(state, message.client, message.action, message.server);
        render();
        return;
      }
      case "stageRestore": {
        if (busy || state === undefined) return;
        explicitSecret = undefined; // staging over a pending explicit apply drops its secret with it
        state = stageRestore(state, message.client);
        render();
        return;
      }
      case "confirmPending": {
        if (busy) return;
        busy = true;
        try {
          await confirmPending();
        } finally {
          busy = false;
        }
        return;
      }
      case "cancelPending": {
        if (busy || state === undefined) return;
        explicitSecret = undefined;
        state = cancelPending(state);
        render();
        return;
      }
      case "runDoctor": {
        if (busy) return;
        busy = true;
        try {
          const result = await deps.engine.doctor();
          if (state !== undefined) {
            if (result.ok) {
              state = { ...state, doctor: result.data, doctorClean: result.findingsOk };
            } else {
              state = { ...state, loadError: result.error };
            }
            render();
          }
        } finally {
          busy = false;
        }
        return;
      }
      case "dismissNotices": {
        if (state === undefined) return;
        state = dismissNotices(state);
        render();
        return;
      }
    }
  };

  return async () => {
    if (panel !== undefined) {
      panel.reveal();
      // Busy-guarded like every other operation that rebuilds state (the
      // 32.2 review discipline): an unguarded refresh here interleaves with
      // an in-flight write.
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
      explicitSecret = undefined;
      // Reset the busy guard too (the 32.2 hung-CLI lesson): a hung spawn
      // holds `busy` in THIS closure, and the opener is the same closure.
      busy = false;
    });
    await refresh();
  };
}
