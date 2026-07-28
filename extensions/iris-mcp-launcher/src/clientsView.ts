/**
 * MCP Clients view-model (Story 33.3, Task 2) — PURE, vscode-free,
 * subprocess-free. Everything this module knows about MCP clients arrives as
 * the `iris-mcp-clients` CLI's own `--json` output shapes (captured from the
 * real built bin — Rule #36; see clientsView.test.ts's header for the capture
 * commands), and every write it plans is expressed as an engine command for
 * the panel to subprocess (Integration AC 33.3-I1: the UI never reimplements
 * detection, parsing, or edit logic and never touches a client config file).
 *
 * What the view shows:
 * - the detected clients with USER-SELECTABLE checkboxes (the roster — AC
 *   33.3.1; persisted by the panel in extension globalState), each selected
 *   client expandable to its section;
 * - per selected client: the iris-mcp server matrix (the 5 servers, exactly
 *   the CLI's canonical rows — `iris-mcp-all` is unmanaged by Project Lead
 *   decision 2026-07-28) with enable/disable/ remove actions, scope +
 *   env-mode pickers, an apply staging row for the absent servers, and the
 *   third-party entries as read-only names (AC 33.3.2 as amended);
 * - undetected v1 clients, collapsed, with a "not detected" note;
 * - NOT the considered-but-dispositioned clients (Pi / roadmap): the
 *   "Other clients considered" section was removed by Project Lead decision
 *   2026-07-28 — supported/dispositioned clients are documented in the
 *   package README's adapter table (AC 33.3.1 as amended);
 * - the diff preview for every pending write and the post-write restart hint
 *   (AC 33.3.3), plus backup restore and doctor findings.
 *
 * Counts and enumerations are ALWAYS derived from the CLI data (Rules
 * #51/#56) — nothing here hardcodes a client or server tally.
 */
import {
  type CliEnvMode,
  type DetectData,
  type DiffApplyData,
  type DoctorData,
  type StatusClientJson,
  type StatusData,
  type StatusScopeJson,
} from "./clientsEngine.js";
import { escapeHtml } from "./governanceView.js";

export { escapeHtml };

// ── State ──────────────────────────────────────────────────────────────

/** The apply preview attached to a pending apply: structured (non-explicit) or the CLI's redacted text render (explicit). */
export type ApplyPreview =
  | { kind: "json"; data: DiffApplyData }
  | { kind: "text"; text: string };

/** A staged, not-yet-confirmed write. The panel's Confirm button is the explicit confirm of AC 33.3.3. */
export type PendingAction =
  | {
      kind: "apply";
      client: string;
      scope: "user" | "project";
      mode: CliEnvMode;
      servers: string[];
      preview: ApplyPreview;
      /** explicit mode: the typed confirmation (the entry name — never the password, which never enters view state). */
      confirmSecret?: string;
    }
  | { kind: "toggle"; action: "enable" | "disable" | "remove"; client: string; scope: "user" | "project"; server: string }
  | { kind: "restore"; client: string; scope: "user" | "project" };

export interface ClientsViewState {
  /** How the CLI is being spawned (shown for transparency). */
  engineMode: "local" | "npx";
  /** `detect --json` (undefined until the first successful refresh). */
  detect: DetectData | undefined;
  /** `status --json` for the matrix. */
  status: StatusData | undefined;
  /** The host-available env modes (the CLI's own gating surface). */
  modes: CliEnvMode[];
  /** The persisted roster selection (client ids). Effective selection intersects with detected. */
  rosterSelected: string[];
  /** The client whose section is expanded (undefined = none). */
  activeClient: string | undefined;
  /** Per-client scope override (default: the first scope the client offers). */
  scopeByClient: Record<string, "user" | "project">;
  /** Per-client env-mode override (default: env-reference). */
  modeByClient: Record<string, CliEnvMode>;
  /** Per-client apply staging: the absent servers checked for inclusion. */
  applySelectionByClient: Record<string, string[]>;
  /** The staged write awaiting the explicit confirm. */
  pendingAction: PendingAction | undefined;
  /** A failure on the LAST write attempt, rendered inside the pending box (the pending action is kept for retry). */
  actionError: string | undefined;
  /** Post-write restart hints, most recent last, surfaced until dismissed/refreshed. */
  restartNotices: string[];
  /** The last doctor run (undefined until "Run doctor" is clicked). */
  doctor: DoctorData | undefined;
  /** Whether doctor's findings are clean (drives the findings banner tone). */
  doctorClean: boolean;
  /** A CLI/engine failure to render inline (resolution error, spawn error, wrapper failure). */
  loadError?: string;
}

export function initialClientsViewState(): ClientsViewState {
  return {
    engineMode: "npx",
    detect: undefined,
    status: undefined,
    modes: ["env-reference", "explicit"],
    rosterSelected: [],
    activeClient: undefined,
    scopeByClient: {},
    modeByClient: {},
    applySelectionByClient: {},
    pendingAction: undefined,
    actionError: undefined,
    restartNotices: [],
    doctor: undefined,
    doctorClean: true,
  };
}

// ── Roster (AC 33.3.1) ─────────────────────────────────────────────────

/**
 * Validate a persisted roster (from extension globalState — hand-editable,
 * so hostile-input tolerant). Returns the client-id list, or undefined when
 * the stored value is not a string array (the panel then falls back to the
 * default: every detected client selected).
 */
export function sanitizePersistedRoster(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const ids = raw.filter((entry): entry is string => typeof entry === "string" && entry !== "");
  return ids;
}

/**
 * The effective roster selection: the DETECTED clients the user has checked,
 * in the CLI's detection order. Default (no persisted roster): every detected
 * client selected (Task 2). A persisted id for a no-longer-detected client
 * drops out of the effective selection — and since the panel persists the
 * effective selection on every toggle, such an id is forgotten at the next
 * toggle (reinstalling the client then re-selects it only via the
 * default-everything rule for a missing roster, or by hand).
 */
export function effectiveRosterSelection(detect: DetectData | undefined, persisted: string[] | undefined): string[] {
  const detected = (detect?.clients ?? []).filter((client) => client.detected).map((client) => client.client);
  if (persisted === undefined) return detected;
  const kept = new Set(persisted);
  return detected.filter((id) => kept.has(id));
}

/** Toggle one detected client's checkbox. Undetected/unknown clients cannot be selected (they have no section to show). */
export function toggleRosterClient(state: ClientsViewState, clientId: string): ClientsViewState {
  const detected = (state.detect?.clients ?? []).filter((client) => client.detected).map((client) => client.client);
  if (!detected.includes(clientId)) return state;
  const selected = state.rosterSelected.includes(clientId)
    ? state.rosterSelected.filter((id) => id !== clientId)
    : [...state.rosterSelected, clientId];
  const next: ClientsViewState = {
    ...state,
    rosterSelected: selected,
    // Deselecting the expanded client collapses its section.
    activeClient: state.activeClient === clientId && !selected.includes(clientId) ? undefined : state.activeClient,
  };
  // A pending action belonging to a now-deselected client is dropped (its confirm target is no longer visible).
  return next.pendingAction !== undefined && !selected.includes(pendingClient(next.pendingAction))
    ? { ...next, pendingAction: undefined, actionError: undefined }
    : next;
}

function pendingClient(action: PendingAction): string {
  return action.client;
}

/** Expand/collapse one selected client's section. */
export function activateClient(state: ClientsViewState, clientId: string): ClientsViewState {
  if (!state.rosterSelected.includes(clientId)) return state;
  return { ...state, activeClient: state.activeClient === clientId ? undefined : clientId };
}

// ── Per-client pickers (AC 33.3.2) ─────────────────────────────────────

/**
 * The scopes a client offers, derived from its detection probes (config
 * probes carry the scope; a client with only a user-scope config offers only
 * "user" — e.g. Claude Desktop, Cline, Kimi CLI). CLI-derived, never a
 * hand-maintained per-client list (Rule #56).
 */
export function scopesForClient(detect: DetectData | undefined, clientId: string): ("user" | "project")[] {
  const client = detect?.clients.find((row) => row.client === clientId);
  if (client === undefined) return [];
  const scopes = new Set<"user" | "project">();
  for (const probe of client.probes) {
    if (probe.kind === "config" && probe.scope !== undefined) scopes.add(probe.scope);
  }
  return (["user", "project"] as const).filter((scope) => scopes.has(scope));
}

/** The scope a client's section currently targets (explicit override, else the first offered). */
export function scopeFor(state: ClientsViewState, clientId: string): "user" | "project" {
  const offered = scopesForClient(state.detect, clientId);
  const override = state.scopeByClient[clientId];
  if (override !== undefined && offered.includes(override)) return override;
  return offered[0] ?? "user";
}

/** Set a client's scope (ignored when the client does not offer it). */
export function setScope(state: ClientsViewState, clientId: string, scope: "user" | "project"): ClientsViewState {
  if (!scopesForClient(state.detect, clientId).includes(scope)) return state;
  return { ...state, scopeByClient: { ...state.scopeByClient, [clientId]: scope } };
}

/** The env mode a client's section currently targets (default env-reference; constrained to the CLI's available modes). */
export function modeFor(state: ClientsViewState, clientId: string): CliEnvMode {
  const override = state.modeByClient[clientId];
  if (override !== undefined && state.modes.includes(override)) return override;
  return "env-reference";
}

/** Set a client's env mode (ignored when the CLI does not offer it on this host). */
export function setMode(state: ClientsViewState, clientId: string, mode: CliEnvMode): ClientsViewState {
  if (!state.modes.includes(mode)) return state;
  return { ...state, modeByClient: { ...state.modeByClient, [clientId]: mode } };
}

// ── The server matrix + apply staging ──────────────────────────────────

/** The client's status row (undefined when the client is not in the matrix). */
export function statusClient(state: ClientsViewState, clientId: string): StatusClientJson | undefined {
  return state.status?.clients.find((row) => row.client === clientId);
}

/** The client's status row for one scope (undefined when the scope has no row). */
export function statusScope(state: ClientsViewState, clientId: string, scope: "user" | "project"): StatusScopeJson | undefined {
  return statusClient(state, clientId)?.scopes.find((row) => row.scope === scope);
}

/** The absent servers a client could apply (drives the apply staging row). */
export function absentServers(state: ClientsViewState, clientId: string, scope: "user" | "project"): string[] {
  const scopeRow = statusScope(state, clientId, scope);
  if (scopeRow === undefined || scopeRow.file !== "ok") return [];
  return scopeRow.servers.filter((row) => row.state === "absent").map((row) => row.server);
}

/** The servers currently checked for apply on one client. */
export function applySelection(state: ClientsViewState, clientId: string): string[] {
  return state.applySelectionByClient[clientId] ?? [];
}

/** Check/uncheck one absent server for apply. */
export function toggleApplyServer(state: ClientsViewState, clientId: string, server: string): ClientsViewState {
  const current = applySelection(state, clientId);
  const next = current.includes(server) ? current.filter((name) => name !== server) : [...current, server];
  return { ...state, applySelectionByClient: { ...state.applySelectionByClient, [clientId]: next } };
}

/**
 * explicit mode writes ONE entry behind a typed confirmation naming that
 * entry (the CLI's `--confirm-secret` takes exactly one name), so the apply
 * staging in explicit mode is constrained to exactly one server — the view
 * surfaces this as a validation message instead of letting the CLI refuse.
 */
export function applyValidation(state: ClientsViewState, clientId: string): string | undefined {
  const selection = applySelection(state, clientId);
  if (selection.length === 0) return "Check at least one absent server to apply.";
  if (modeFor(state, clientId) === "explicit" && selection.length !== 1) {
    return "explicit mode writes one entry at a time behind its typed confirmation — check exactly one server.";
  }
  return undefined;
}

// ── Staging + confirmation (AC 33.3.3) ─────────────────────────────────

/** Stage an apply with its freshly-rendered preview (the panel ran `diff` first — every write flows through a diff preview). */
export function stageApply(
  state: ClientsViewState,
  clientId: string,
  preview: ApplyPreview,
  confirmSecret?: string,
): ClientsViewState {
  return {
    ...state,
    pendingAction: {
      kind: "apply",
      client: clientId,
      scope: scopeFor(state, clientId),
      mode: modeFor(state, clientId),
      servers: applySelection(state, clientId),
      preview,
      ...(confirmSecret !== undefined ? { confirmSecret } : {}),
    },
    actionError: undefined,
  };
}

/** Stage an enable/disable/remove toggle (the matrix row's action; confirmed explicitly before the engine runs). */
export function stageToggleAction(
  state: ClientsViewState,
  clientId: string,
  action: "enable" | "disable" | "remove",
  server: string,
): ClientsViewState {
  return {
    ...state,
    pendingAction: { kind: "toggle", action, client: clientId, scope: scopeFor(state, clientId), server },
    actionError: undefined,
  };
}

/** Stage a backup restore (latest timestamped backup for the client's config at the active scope). */
export function stageRestore(state: ClientsViewState, clientId: string): ClientsViewState {
  return {
    ...state,
    pendingAction: { kind: "restore", client: clientId, scope: scopeFor(state, clientId) },
    actionError: undefined,
  };
}

/** Cancel the staged write. */
export function cancelPending(state: ClientsViewState): ClientsViewState {
  return { ...state, pendingAction: undefined, actionError: undefined };
}

/** A write failed: keep the staged action for retry, surface the engine's error inside the pending box. */
export function writeFailed(state: ClientsViewState, error: string): ClientsViewState {
  return { ...state, actionError: error };
}

/** A write landed: clear the staged action, surface the restart hint (AC 33.3.3), and drop the applied servers from the apply staging. */
export function writeSucceeded(state: ClientsViewState, restartHint: string | undefined): ClientsViewState {
  const applied = state.pendingAction;
  const notices = restartHint !== undefined && restartHint !== "" ? [...state.restartNotices, restartHint] : state.restartNotices;
  let applySelectionByClient = state.applySelectionByClient;
  if (applied?.kind === "apply") {
    const remaining = applySelection(state, applied.client).filter((server) => !applied.servers.includes(server));
    applySelectionByClient = { ...state.applySelectionByClient, [applied.client]: remaining };
  }
  return { ...state, pendingAction: undefined, actionError: undefined, restartNotices: notices, applySelectionByClient };
}

/** Dismiss the restart notices (post-refresh the panel clears them anyway). */
export function dismissNotices(state: ClientsViewState): ClientsViewState {
  return { ...state, restartNotices: [] };
}

// ── Messages (webview → extension) ─────────────────────────────────────

export type ClientsViewMessage =
  | { type: "refresh" }
  | { type: "toggleClient"; client: string }
  | { type: "activateClient"; client: string }
  | { type: "setScope"; client: string; scope: "user" | "project" }
  | { type: "setMode"; client: string; mode: CliEnvMode }
  | { type: "toggleApplyServer"; client: string; server: string }
  | { type: "previewApply"; client: string }
  | { type: "stageToggle"; client: string; action: "enable" | "disable" | "remove"; server: string }
  | { type: "stageRestore"; client: string }
  | { type: "confirmPending" }
  | { type: "cancelPending" }
  | { type: "runDoctor" }
  | { type: "dismissNotices" };

// ── HTML rendering ─────────────────────────────────────────────────────

const VIEW_CSS = `
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 16px 24px; }
  h1 { font-size: 1.3em; margin: 12px 0 4px; }
  h2 { font-size: 1.05em; margin: 16px 0 6px; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 8px; }
  .toolbar { display: flex; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; cursor: pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .banner { padding: 8px 10px; margin: 8px 0; border-left: 3px solid var(--vscode-editorWarning-foreground); background: var(--vscode-inputValidation-warningBackground); }
  .banner.error { border-left-color: var(--vscode-editorError-foreground); background: var(--vscode-inputValidation-errorBackground); }
  .banner.info { border-left-color: var(--vscode-charts-blue); }
  .banner.restart { border-left-color: var(--vscode-charts-green); }
  .badge { display: inline-block; padding: 0 6px; border-radius: 3px; font-size: 0.8em; margin-right: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .badge.enabled { background: var(--vscode-charts-green); color: var(--vscode-editor-background); }
  .badge.disabled { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
  .badge.absent { background: var(--vscode-badge-background); }
  .badge.error { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }
  .client { border: 1px solid var(--vscode-panel-border); margin: 8px 0; padding: 8px 10px; }
  .client-header { display: flex; align-items: center; gap: 8px; }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: 2px 8px 2px 0; vertical-align: top; }
  td.server { font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  details { margin: 8px 0; }
  summary { cursor: pointer; font-weight: bold; }
  .pending { border: 1px solid var(--vscode-panel-border); padding: 8px 10px; margin: 8px 0; }
  pre.preview { background: var(--vscode-textCodeBlock-background); padding: 8px; overflow-x: auto; font-size: 0.85em; max-height: 320px; overflow-y: auto; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); }
  .note { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 16px; white-space: pre-wrap; }
  .foreign { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
  label { user-select: none; }
  label.apply { margin-right: 12px; }
`;

const VIEW_SCRIPT = `
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-msg]');
    if (!el || el.disabled) return;
    vscode.postMessage(JSON.parse(el.getAttribute('data-msg')));
  });
  document.addEventListener('change', (event) => {
    const el = event.target.closest('select[data-picker]');
    if (!el) return;
    // data-picker carries the message prefix up to the value field; the
    // chosen option completes the JSON (select values cannot be pre-serialized).
    vscode.postMessage(JSON.parse(el.getAttribute('data-picker') + JSON.stringify(el.value) + '}'));
  });
`;

function msgAttr(message: ClientsViewMessage): string {
  return escapeHtml(JSON.stringify(message));
}

/**
 * A <select> whose change posts a picker message. `data-picker` carries the
 * message prefix (everything up to the value field); the script appends the
 * chosen value (see VIEW_SCRIPT — select values cannot be pre-serialized).
 */
function pickerAttr(prefix: string): string {
  return escapeHtml(prefix);
}

function stateBadge(serverState: string): string {
  switch (serverState) {
    case "present-enabled":
      return `<span class="badge enabled">enabled</span>`;
    case "present-disabled":
      return `<span class="badge disabled">disabled</span>`;
    default:
      return `<span class="badge absent">absent</span>`;
  }
}

function renderRoster(state: ClientsViewState): string {
  const detect = state.detect;
  if (detect === undefined) return "";
  const rows = detect.clients
    .filter((client) => client.detected)
    .map((client) => {
      const checked = state.rosterSelected.includes(client.client);
      const active = state.activeClient === client.client;
      const toggle = msgAttr({ type: "toggleClient", client: client.client });
      const activate = checked ? msgAttr({ type: "activateClient", client: client.client }) : undefined;
      const expandButton =
        activate !== undefined
          ? `<button class="secondary" data-msg='${activate}'>${active ? "Collapse" : "Manage…"}</button>`
          : "";
      return (
        `<div class="client"><div class="client-header">` +
        `<label><input type="checkbox" data-msg='${toggle}'${checked ? " checked" : ""}> ` +
        `<strong>${escapeHtml(client.displayName)}</strong> <span class="meta">(${escapeHtml(client.client)})</span></label>` +
        expandButton +
        `</div>${active ? renderClientSection(state, client.client) : ""}</div>`
      );
    })
    .join("");
  return (
    `<h2>Detected clients (${escapeHtml(String(detect.counts.detected))} of ${escapeHtml(String(detect.counts.probed))})</h2>` +
    `<div class="meta">Checked clients are managed below; the selection persists across sessions.</div>` +
    rows
  );
}

function renderUndetected(state: ClientsViewState): string {
  const detect = state.detect;
  if (detect === undefined) return "";
  const undetected = detect.clients.filter((client) => !client.detected);
  if (undetected.length === 0) return "";
  const names = undetected.map((client) => `${escapeHtml(client.displayName)} (${escapeHtml(client.client)})`).join(", ");
  return (
    `<details><summary>Not detected (${undetected.length})</summary>` +
    `<div class="meta">These v1 clients were not detected on this machine (no config file or app directory): ${names}.</div></details>`
  );
}

function renderMatrix(state: ClientsViewState, clientId: string, scope: "user" | "project"): string {
  const scopeRow = statusScope(state, clientId, scope);
  if (scopeRow === undefined) {
    return `<div class="meta">No status available for this scope yet.</div>`;
  }
  if (scopeRow.file === "unresolved") {
    return `<div class="meta">${escapeHtml(scope)} scope: unresolved (a project scope needs a project directory).</div>`;
  }
  if (scopeRow.file === "missing") {
    return `<div class="meta">${escapeHtml(scope)} scope: ${escapeHtml(scopeRow.path ?? "(no path)")} — no config file yet; an apply creates it.</div>`;
  }
  if (scopeRow.file === "unparseable") {
    return (
      `<div class="banner error"><strong>${escapeHtml(scope)} scope config is UNPARSEABLE</strong> — ` +
      `${escapeHtml(scopeRow.error ?? "unknown")}. Every write refuses until it is repaired or restored.</div>`
    );
  }
  const pending = state.pendingAction;
  const busy = pending !== undefined;
  const rows = scopeRow.servers
    .map((row) => {
      const checked = applySelection(state, clientId).includes(row.server);
      const actions =
        row.state === "present-enabled"
          ? `<button class="secondary" data-msg='${msgAttr({ type: "stageToggle", client: clientId, action: "disable", server: row.server })}'${busy ? " disabled" : ""}>Disable</button>` +
            `<button class="secondary" data-msg='${msgAttr({ type: "stageToggle", client: clientId, action: "remove", server: row.server })}'${busy ? " disabled" : ""}>Remove</button>`
          : row.state === "present-disabled"
            ? `<button class="secondary" data-msg='${msgAttr({ type: "stageToggle", client: clientId, action: "enable", server: row.server })}'${busy ? " disabled" : ""}>Enable</button>` +
              `<button class="secondary" data-msg='${msgAttr({ type: "stageToggle", client: clientId, action: "remove", server: row.server })}'${busy ? " disabled" : ""}>Remove</button>`
            : `<label class="apply"><input type="checkbox" data-msg='${msgAttr({ type: "toggleApplyServer", client: clientId, server: row.server })}'${checked ? " checked" : ""}${busy ? " disabled" : ""}> include in apply</label>`;
      return `<tr><td class="server">${escapeHtml(row.server)}</td><td>${stateBadge(row.state)}</td><td>${actions}</td></tr>`;
    })
    .join("");
  const foreign =
    scopeRow.foreign.length > 0
      ? `<div class="foreign">Third-party entries (read-only, names only — the manager never touches them): ${scopeRow.foreign.map(escapeHtml).join(", ")}</div>`
      : "";
  return `<table>${rows}</table>${foreign}`;
}

function renderClientSection(state: ClientsViewState, clientId: string): string {
  const scope = scopeFor(state, clientId);
  const mode = modeFor(state, clientId);
  const scopes = scopesForClient(state.detect, clientId);
  const scopePicker =
    scopes.length > 1
      ? `<select data-picker='${pickerAttr(`{"type":"setScope","client":${JSON.stringify(clientId)},"scope":`)}'>` +
        scopes
          .map((candidate) => `<option value="${candidate}"${candidate === scope ? " selected" : ""}>${candidate}</option>`)
          .join("") +
        `</select>`
      : `<span class="meta">scope: ${escapeHtml(scope)} (the only scope this client offers)</span>`;
  const modePicker =
    `<select data-picker='${pickerAttr(`{"type":"setMode","client":${JSON.stringify(clientId)},"mode":`)}'>` +
    state.modes
      .map((candidate) => `<option value="${candidate}"${candidate === mode ? " selected" : ""}>${candidate}</option>`)
      .join("") +
    `</select>`;
  const pending = state.pendingAction;
  const validation = applyValidation(state, clientId);
  const previewDisabled = pending !== undefined || validation !== undefined;
  const applyBar =
    absentServers(state, clientId, scope).length > 0
      ? `<div class="toolbar">` +
        `<button data-msg='${msgAttr({ type: "previewApply", client: clientId })}'${previewDisabled ? " disabled" : ""}>Preview apply…</button>` +
        `<button class="secondary" data-msg='${msgAttr({ type: "stageRestore", client: clientId })}'${pending !== undefined ? " disabled" : ""}>Restore backup…</button>` +
        (validation !== undefined && absentServers(state, clientId, scope).length > 0
          ? `<span class="meta">${escapeHtml(validation)}</span>`
          : "") +
        `</div>`
      : `<div class="toolbar"><button class="secondary" data-msg='${msgAttr({ type: "stageRestore", client: clientId })}'${pending !== undefined ? " disabled" : ""}>Restore backup…</button></div>`;
  return (
    `<div>` +
    `<div class="toolbar">${scopePicker}${modePicker}</div>` +
    renderMatrix(state, clientId, scope) +
    applyBar +
    (pending !== undefined && pendingClient(pending) === clientId ? renderPending(state, pending) : "") +
    `</div>`
  );
}

function renderPending(state: ClientsViewState, pending: PendingAction): string {
  let body: string;
  if (pending.kind === "apply") {
    const preview =
      pending.preview.kind === "json"
        ? pending.preview.data.servers
            .map((server) => `--- ${server.server} (${server.mechanism}) ---\n${server.text}`)
            .join("\n\n")
        : pending.preview.text;
    body =
      `<strong>Pending apply</strong> — ${escapeHtml(pending.servers.join(", "))} → ${escapeHtml(pending.client)} ` +
      `(${escapeHtml(pending.scope)} scope, ${escapeHtml(pending.mode)}). Review the CLI's diff render, then confirm:` +
      `<pre class="preview">${escapeHtml(preview)}</pre>`;
  } else if (pending.kind === "toggle") {
    body =
      `<strong>Pending ${escapeHtml(pending.action)}</strong> — <code>${escapeHtml(pending.server)}</code> in ` +
      `${escapeHtml(pending.client)} (${escapeHtml(pending.scope)} scope). The CLI takes a timestamped backup before writing.`;
  } else {
    body =
      `<strong>Pending restore</strong> — roll ${escapeHtml(pending.client)} (${escapeHtml(pending.scope)} scope) back ` +
      `to the latest timestamped backup. The current file is backed up first.`;
  }
  const error = state.actionError !== undefined ? `<div class="banner error">${escapeHtml(state.actionError)}</div>` : "";
  return (
    `<div class="pending">${body}${error}` +
    `<div class="toolbar">` +
    `<button data-msg='${msgAttr({ type: "confirmPending" })}'>Confirm</button>` +
    `<button class="secondary" data-msg='${msgAttr({ type: "cancelPending" })}'>Cancel</button>` +
    `</div></div>`
  );
}

function renderDoctor(state: ClientsViewState): string {
  const doctor = state.doctor;
  const runButton = `<button class="secondary" data-msg='${msgAttr({ type: "runDoctor" })}'>Run doctor</button>`;
  if (doctor === undefined) {
    return `<h2>Doctor</h2><div class="toolbar">${runButton}</div>`;
  }
  if (doctor.findings.length === 0) {
    return (
      `<h2>Doctor</h2><div class="toolbar">${runButton}</div>` +
      `<div class="banner restart">All checks passed (${doctor.parsedFiles} config file(s) parsed).</div>`
    );
  }
  const rows = doctor.findings
    .map(
      (finding) =>
        `<tr><td><span class="badge error">${escapeHtml(finding.check)}</span></td>` +
        `<td>[${escapeHtml(finding.client)}/${escapeHtml(finding.scope)}]</td><td>${escapeHtml(finding.detail)}</td></tr>`,
    )
    .join("");
  const hints = doctor.restartHints
    .filter((hint) => hint.hint !== "")
    .map((hint) => `<div class="meta">${escapeHtml(hint.client)}: ${escapeHtml(hint.hint)}</div>`)
    .join("");
  return (
    `<h2>Doctor</h2><div class="toolbar">${runButton}</div>` +
    `<div class="banner"><strong>${doctor.findingCount} finding(s).</strong><table>${rows}</table></div>` +
    hints
  );
}

function renderBanners(state: ClientsViewState): string {
  const banners: string[] = [];
  if (state.loadError !== undefined) {
    banners.push(`<div class="banner error">${escapeHtml(state.loadError)}</div>`);
  }
  if (state.restartNotices.length > 0) {
    banners.push(
      `<div class="banner restart">${state.restartNotices.map((notice) => `<div>${escapeHtml(notice)}</div>`).join("")}` +
        `<div class="toolbar"><button class="secondary" data-msg='${msgAttr({ type: "dismissNotices" })}'>Dismiss</button></div></div>`,
    );
  }
  return banners.join("");
}

/** The full webview document for the clients state. */
export function renderClientsHtml(state: ClientsViewState, nonce: string): string {
  const detect = state.detect;
  const summary =
    detect !== undefined
      ? `<div class="meta">Adapter data ${escapeHtml(detect.adapterDataVersion)} · Engine: iris-mcp-clients CLI (${state.engineMode === "local" ? "local build" : "npx, published"}) · ` +
        `${escapeHtml(String(detect.counts.detected))} of ${escapeHtml(String(detect.counts.probed))} clients detected</div>`
      : "";
  const loading =
    detect === undefined && state.loadError === undefined
      ? `<div class="banner">Detecting MCP clients… (Refresh if this persists.)</div>`
      : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MCP Clients</title>
<style>${VIEW_CSS}</style>
</head>
<body>
<h1>MCP Clients</h1>
${summary}
${renderBanners(state)}
<div class="toolbar"><button class="secondary" data-msg='${msgAttr({ type: "refresh" })}'>Refresh</button></div>
${loading}
${renderRoster(state)}
${renderUndetected(state)}
${renderDoctor(state)}
<div class="note">Every write flows: diff preview → explicit confirm → the iris-mcp-clients engine (the same code path as the terminal CLI) — with a timestamped backup before any change. Clients read their MCP config once at startup; the post-write restart hint tells you how to apply.</div>
<script nonce="${nonce}">${VIEW_SCRIPT}</script>
</body>
</html>`;
}
