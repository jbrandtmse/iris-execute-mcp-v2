/**
 * Governance editor view-model (Story 32.2, Tasks 2+3) — PURE, vscode-free,
 * subprocess-free. Everything this module knows about the governance engine
 * arrives as the CLI's own `--json` output shapes (captured from the real
 * `iris-mcp-governance` bin — Rule #36), and every write it plans is
 * expressed as {@link GovernanceCliCommand}s for the engine layer to
 * subprocess — the UI never reimplements cascade, validation, or
 * serialization logic (AC 32.2.2) and never hand-serializes the governance
 * file.
 *
 * What the view shows:
 * - the FULL governed-key universe (`universe --json`), grouped per server
 *   package exactly as the dist derivation emits it, with per-key
 *   read/write badges, baseline/post-foundation origin, the effective value
 *   and its `configSource` badge (the AC 32.2.3 effective-policy preview);
 * - per-key tri-state toggles (enabled / disabled / inherit) bound to the
 *   FILE layer of the active tab (the global layer, or one profile layer);
 * - per-profile tabs (global + `default` + every Server Manager profile +
 *   every profile the file names);
 * - inline validation errors — the engine's own messages (`validate --json`);
 * - a diff preview before save (the staged edits, plus the current
 *   file-vs-default-seed diff rendered from `diff --json`).
 *
 * Reload semantics (PD-3, Story 32.3): the view reflects file state at
 * open/refresh — there is no hot-reload machinery, and servers read the file
 * once at startup. The rendered HTML says so (restart to apply).
 */
import type { GovernanceCliCommand } from "./governanceEngine.js";

// ── CLI `--json` output shapes (captured from the real bin, Rule #36) ────

export interface UniverseToolJson {
  name: string;
  keys: string[];
}

export interface UniversePackageJson {
  pkg: string;
  tools: UniverseToolJson[];
}

/** `iris-mcp-governance universe --json` (Story 32.2 shared CLI addition). */
export interface UniverseJson {
  profile: string;
  file: string | null;
  preset: string | null;
  universeSource: string;
  packages: UniversePackageJson[];
  frameworkTool: { name: string; keys: string[] };
  keys: string[];
  postFoundation: string[];
  mutates: Record<string, "read" | "write">;
  defaultEnabledWrites: string[];
  policy: Record<string, boolean>;
  configSource: Record<string, "env" | "file" | "preset" | "default">;
  note: string;
  error?: string;
}

export interface DiffEntryJson {
  layer: string;
  key: string;
  file: boolean;
  default: boolean;
  differs: boolean;
}

/** `iris-mcp-governance diff --json` (Story 32.1). */
export interface DiffJson {
  file: string;
  entries: DiffEntryJson[];
  note: string;
  error?: string;
}

/** `iris-mcp-governance validate --json` (Story 32.1). */
export interface ValidateJson {
  ok: boolean;
  file?: string;
  globalKeys?: number;
  profiles?: number;
  error?: string;
}

// ── View state ─────────────────────────────────────────────────────────

/**
 * The sentinel tab id for the file's GLOBAL layer (the tab whose edits run
 * `set`/`unset` WITHOUT `--profile`). A profile NAME could legitimately be
 * "global" (the loader rejects only "" and RESERVED_KEYS), so the id carries
 * a leading NUL — a character no human-named profile will contain — keeping
 * the id outside the practical profile namespace everywhere in this module
 * (32.2 review: a literal "global" sentinel collided with a real
 * profile/server named "global", silently retargeting its edits AND preview
 * to the global layer). Never compared against a raw profile name without
 * this constant.
 */
export const GLOBAL_TAB = "\0global";

/** The profile whose effective render the GLOBAL tab shows (the reserved single-server profile). */
export const GLOBAL_TAB_RENDER_PROFILE = "default";

export type ToggleValue = "enabled" | "disabled" | "inherit";

export interface StagedChange {
  tab: string;
  key: string;
  value: boolean | "unset";
}

export interface GovernanceViewState {
  /** The governance file being edited (`irisMcpLauncher.governanceFile`). Never "" here — the empty state is rendered separately. */
  file: string;
  /** Whether the file exists on disk. A MISSING file fails server startup — the view warns loudly. */
  fileExists: boolean;
  /** How the CLI is being spawned (shown for transparency). */
  engineMode: "local" | "npx";
  /** `validate --json` output (undefined when the file does not exist — there is nothing to validate). */
  validation: ValidateJson | undefined;
  /** `diff --json` output (undefined when the file does not exist). */
  diff: DiffJson | undefined;
  /** `universe --json` per tab, fetched lazily on tab activation. */
  universeByTab: Record<string, UniverseJson | undefined>;
  /** Ordered tab ids: GLOBAL_TAB first, then profile names. */
  profileTabs: string[];
  activeTab: string;
  /** Pending edits across ALL tabs (Save applies them all). */
  staged: StagedChange[];
  /** `irisMcpLauncher.governancePreset` ("" = unset) — display only; the preset is env-sourced and the UI never writes it. */
  preset: string;
  /** A CLI/engine failure to render inline (resolution error, spawn error, non-zero exit). */
  loadError?: string;
}

// ── Tab + layer model ──────────────────────────────────────────────────

const PROFILE_LAYER_RE = /^profile "([\s\S]*)"$/;

/** Profile names the FILE mentions (parsed from `diff --json` layer labels). */
export function fileProfileNames(diff: DiffJson | undefined): string[] {
  const names = new Set<string>();
  for (const entry of diff?.entries ?? []) {
    const match = PROFILE_LAYER_RE.exec(entry.layer);
    if (match?.[1] !== undefined) names.add(match[1]);
  }
  return [...names];
}

/**
 * Ordered tab ids: the global layer first, then every profile the user can
 * reasonably want a layer for — the reserved `default` profile (present on
 * every server), every Server Manager server name, and every profile the
 * file already names — sorted, deduped.
 */
export function computeProfileTabs(
  serverManagerNames: string[],
  diff: DiffJson | undefined,
): string[] {
  const names = new Set<string>(["default", ...serverManagerNames, ...fileProfileNames(diff)]);
  return [GLOBAL_TAB, ...[...names].sort()];
}

/** The file layer a tab edits: `undefined` (the global layer) for GLOBAL_TAB, else the tab-named profile layer. */
export function layerForTab(tab: string): string | undefined {
  return tab === GLOBAL_TAB ? undefined : tab;
}

/** The profile whose effective render a tab shows (the global tab renders the reserved default profile). */
export function renderProfileForTab(tab: string): string {
  return tab === GLOBAL_TAB ? GLOBAL_TAB_RENDER_PROFILE : tab;
}

// ── File values + toggles ──────────────────────────────────────────────

/** The file's OWN value for `key` in `tab`'s layer (undefined = unset), from `diff --json`. */
export function fileValueFor(state: GovernanceViewState, tab: string, key: string): boolean | undefined {
  const layerLabel = tab === GLOBAL_TAB ? "global" : `profile "${tab}"`;
  for (const entry of state.diff?.entries ?? []) {
    if (entry.layer === layerLabel && entry.key === key) return entry.file;
  }
  return undefined;
}

/** The staged value for `key` in `tab`'s layer, if any. */
export function stagedValueFor(state: GovernanceViewState, tab: string, key: string): boolean | "unset" | undefined {
  for (const change of state.staged) {
    if (change.tab === tab && change.key === key) return change.value;
  }
  return undefined;
}

/** The toggle position the UI shows: staged value wins, then the file value, else inherit. */
export function toggleFor(state: GovernanceViewState, tab: string, key: string): ToggleValue {
  const staged = stagedValueFor(state, tab, key);
  if (staged !== undefined) return staged === "unset" ? "inherit" : staged ? "enabled" : "disabled";
  const fileValue = fileValueFor(state, tab, key);
  if (fileValue === undefined) return "inherit";
  return fileValue ? "enabled" : "disabled";
}

/**
 * Stage (or unstage) a toggle. Staging the value the file ALREADY carries
 * is a no-op edit and removes any staged entry instead — the pending list
 * only ever holds real changes.
 */
export function stageToggle(
  state: GovernanceViewState,
  tab: string,
  key: string,
  value: ToggleValue,
): GovernanceViewState {
  const desired: boolean | "unset" = value === "enabled" ? true : value === "disabled" ? false : "unset";
  const current: boolean | "unset" = fileValueFor(state, tab, key) ?? "unset";
  const rest = state.staged.filter((change) => !(change.tab === tab && change.key === key));
  if (desired === current) {
    return { ...state, staged: rest };
  }
  return { ...state, staged: [...rest, { tab, key, value: desired }] };
}

export function clearStaged(state: GovernanceViewState): GovernanceViewState {
  return { ...state, staged: [] };
}

/**
 * Map every staged change to the CLI write that performs it (Save's command
 * sequence) — `set`/`unset` only, never hand-serialized JSON (AC 32.2.2).
 * Deterministic order: tab order, then key.
 */
export type StagedCliCommand = Extract<GovernanceCliCommand, { kind: "set" | "unset" }>;

export function stagedCliCommands(state: GovernanceViewState): StagedCliCommand[] {
  const tabOrder = new Map(state.profileTabs.map((tab, index) => [tab, index]));
  const ordered = [...state.staged].sort((a, b) => {
    const tabDelta = (tabOrder.get(a.tab) ?? 0) - (tabOrder.get(b.tab) ?? 0);
    return tabDelta !== 0 ? tabDelta : a.key.localeCompare(b.key);
  });
  return ordered.map((change) =>
    change.value === "unset"
      ? { kind: "unset", file: state.file, profile: layerForTab(change.tab), key: change.key }
      : {
          kind: "set",
          file: state.file,
          profile: layerForTab(change.tab),
          key: change.key,
          value: change.value,
        },
  );
}

/** One pending-edit preview row: what Save will change, in display vocabulary. */
export interface PendingChange {
  tab: string;
  key: string;
  from: string;
  to: string;
}

function displayValue(value: boolean | "unset"): string {
  return value === "unset" ? "inherit (unset)" : value ? "enabled (true)" : "disabled (false)";
}

export function pendingChanges(state: GovernanceViewState): PendingChange[] {
  return stagedCliCommands(state).map((command) => {
    const tab = command.profile ?? GLOBAL_TAB;
    return {
      tab,
      key: command.key,
      from: displayValue(fileValueFor(state, tab, command.key) ?? "unset"),
      to: displayValue(command.kind === "set" ? command.value : "unset"),
    };
  });
}

// ── Grouping (the universe, per active tab) ────────────────────────────

export interface KeyRow {
  key: string;
  mutates: "read" | "write" | "unclassified";
  /** true for a frozen-baseline (grandfathered) key; false for post-foundation. */
  baseline: boolean;
  effective: boolean;
  source: "env" | "file" | "preset" | "default" | "unknown";
  toggle: ToggleValue;
  staged: boolean;
}

export interface ToolGroup {
  tool: string;
  rows: KeyRow[];
}

export interface PackageGroup {
  pkg: string;
  tools: ToolGroup[];
}

function buildRow(state: GovernanceViewState, universe: UniverseJson, key: string): KeyRow {
  return {
    key,
    mutates: universe.mutates[key] ?? "unclassified",
    baseline: !universe.postFoundation.includes(key),
    effective: universe.policy[key] ?? false,
    source: universe.configSource[key] ?? "unknown",
    toggle: toggleFor(state, state.activeTab, key),
    staged: stagedValueFor(state, state.activeTab, key) !== undefined,
  };
}

/**
 * Group the active tab's universe render for display: per server package
 * exactly as the dist derivation emitted it, then the framework tool, then
 * any baseline key no current package tool produces (defensive — none
 * today).
 */
export function buildGroups(state: GovernanceViewState): PackageGroup[] {
  const universe = state.universeByTab[state.activeTab];
  if (universe === undefined) return [];
  const groups: PackageGroup[] = universe.packages.map((pkg) => ({
    pkg: pkg.pkg,
    tools: pkg.tools.map((tool) => ({
      tool: tool.name,
      rows: tool.keys.map((key) => buildRow(state, universe, key)),
    })),
  }));
  groups.push({
    pkg: "framework",
    tools: [
      {
        tool: universe.frameworkTool.name,
        rows: universe.frameworkTool.keys.map((key) => buildRow(state, universe, key)),
      },
    ],
  });
  const grouped = new Set(
    groups.flatMap((group) => group.tools.flatMap((tool) => tool.rows.map((row) => row.key))),
  );
  const unowned = universe.keys.filter((key) => !grouped.has(key));
  if (unowned.length > 0) {
    groups.push({
      pkg: "baseline (no owning package)",
      tools: [{ tool: "baseline", rows: unowned.map((key) => buildRow(state, universe, key)) }],
    });
  }
  return groups;
}

// ── Badges ─────────────────────────────────────────────────────────────

/** The configSource badge text — the cascade channel that resolved the key (`env`/`file`/`preset`/`default`). */
export function configSourceBadge(source: KeyRow["source"]): string {
  return source;
}

/** The origin badge: frozen-baseline (grandfathered, always default-enabled) vs post-foundation (seeded by mutates). */
export function originBadge(row: KeyRow): string {
  return row.baseline ? "baseline" : "new";
}

// ── Messages (webview → extension) ─────────────────────────────────────

export type GovernanceViewMessage =
  | { type: "switchProfile"; profile: string }
  | { type: "stage"; key: string; value: ToggleValue }
  | { type: "save" }
  | { type: "discard" }
  | { type: "refresh" }
  | { type: "chooseFile" };

// ── HTML rendering ─────────────────────────────────────────────────────

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const VIEW_CSS = `
  body { font-family: var(--vscode-font-family); color: var(--vscode-foreground); padding: 0 16px 24px; }
  h1 { font-size: 1.3em; margin: 12px 0 4px; }
  .meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-bottom: 8px; }
  .toolbar { display: flex; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
  button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 4px 12px; cursor: pointer; }
  button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
  button:disabled { opacity: 0.5; cursor: default; }
  .banner { padding: 8px 10px; margin: 8px 0; border-left: 3px solid var(--vscode-editorWarning-foreground); background: var(--vscode-inputValidation-warningBackground); }
  .banner.error { border-left-color: var(--vscode-editorError-foreground); background: var(--vscode-inputValidation-errorBackground); }
  .tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--vscode-panel-border); margin: 12px 0 8px; flex-wrap: wrap; }
  .tabs button { background: transparent; color: var(--vscode-foreground); border-bottom: 2px solid transparent; padding: 4px 10px; }
  .tabs button.active { border-bottom-color: var(--vscode-button-background); font-weight: bold; }
  .badge { display: inline-block; padding: 0 6px; border-radius: 3px; font-size: 0.8em; margin-right: 4px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); }
  .badge.write { background: var(--vscode-editorWarning-foreground); color: var(--vscode-editor-background); }
  .badge.new { background: var(--vscode-charts-blue); color: var(--vscode-editor-background); }
  .badge.disabled { background: var(--vscode-editorError-foreground); color: var(--vscode-editor-background); }
  .badge.enabled { background: var(--vscode-charts-green); color: var(--vscode-editor-background); }
  .staged { outline: 1px dashed var(--vscode-editorWarning-foreground); }
  table { border-collapse: collapse; width: 100%; }
  td, th { text-align: left; padding: 2px 8px 2px 0; vertical-align: top; }
  td.key { font-family: var(--vscode-editor-font-family); font-size: 0.9em; }
  details { margin: 8px 0; }
  summary { cursor: pointer; font-weight: bold; }
  .pending { border: 1px solid var(--vscode-panel-border); padding: 8px 10px; margin: 8px 0; }
  .note { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 16px; white-space: pre-wrap; }
  select { background: var(--vscode-dropdown-background); color: var(--vscode-dropdown-foreground); border: 1px solid var(--vscode-dropdown-border); }
  .empty { margin-top: 24px; max-width: 60em; }
`;

const VIEW_SCRIPT = `
  const vscode = acquireVsCodeApi();
  document.addEventListener('click', (event) => {
    const el = event.target.closest('[data-msg]');
    if (!el || el.disabled) return;
    vscode.postMessage(JSON.parse(el.getAttribute('data-msg')));
  });
  document.addEventListener('change', (event) => {
    const el = event.target.closest('select[data-key]');
    if (!el) return;
    vscode.postMessage({ type: 'stage', key: el.getAttribute('data-key'), value: el.value });
  });
`;

function msgAttr(message: GovernanceViewMessage): string {
  return escapeHtml(JSON.stringify(message));
}

function renderToolbar(state: GovernanceViewState): string {
  const stagedCount = state.staged.length;
  const editable = state.validation === undefined || state.validation.ok;
  const saveDisabled = stagedCount === 0 || !editable ? " disabled" : "";
  const discardDisabled = stagedCount === 0 ? " disabled" : "";
  return (
    `<div class="toolbar">` +
    `<button class="secondary" data-msg='${msgAttr({ type: "chooseFile" })}'>Choose File…</button>` +
    `<button class="secondary" data-msg='${msgAttr({ type: "refresh" })}'>Refresh</button>` +
    `<button data-msg='${msgAttr({ type: "save" })}'${saveDisabled}>Save${stagedCount > 0 ? ` (${stagedCount})` : ""}</button>` +
    `<button class="secondary" data-msg='${msgAttr({ type: "discard" })}'${discardDisabled}>Discard</button>` +
    `</div>`
  );
}

function renderTabs(state: GovernanceViewState): string {
  const tabs = state.profileTabs
    .map((tab) => {
      const label = tab === GLOBAL_TAB ? "global (file)" : escapeHtml(tab);
      const active = tab === state.activeTab ? " active" : "";
      return `<button class="tab${active}" data-msg='${msgAttr({ type: "switchProfile", profile: tab })}'>${label}</button>`;
    })
    .join("");
  return `<div class="tabs">${tabs}</div>`;
}

function renderPending(state: GovernanceViewState): string {
  const changes = pendingChanges(state);
  if (changes.length === 0) return "";
  const rows = changes
    .map(
      (change) =>
        `<tr><td class="key">${escapeHtml(change.key)}</td><td>${escapeHtml(change.tab === GLOBAL_TAB ? "global (file)" : change.tab)}</td>` +
        `<td>${escapeHtml(change.from)}</td><td>→</td><td>${escapeHtml(change.to)}</td></tr>`,
    )
    .join("");
  return (
    `<div class="pending"><strong>Pending changes (${changes.length})</strong> — applied through the governance CLI on Save:` +
    `<table>${rows}</table></div>`
  );
}

function renderDiff(state: GovernanceViewState): string {
  if (state.diff === undefined) return "";
  const entries = state.diff.entries;
  if (entries.length === 0) {
    return `<div class="meta">The file sets no keys — the defaults govern everything.</div>`;
  }
  const rows = entries
    .map(
      // entry.file/default come from the CLI's JSON (typed boolean, runtime
      // unknown) — String()-coerce + escape like every other interpolated
      // surface (32.2 review: TS types over JSON.parse are not guarantees).
      (entry) =>
        `<tr><td>${entry.differs ? "~" : "="}</td><td>[${escapeHtml(entry.layer)}]</td>` +
        `<td class="key">${escapeHtml(entry.key)}</td><td>file=${escapeHtml(String(entry.file))}</td><td>default=${escapeHtml(String(entry.default))}</td>` +
        `<td>${entry.differs ? "differs" : ""}</td></tr>`,
    )
    .join("");
  return (
    `<details><summary>Current file vs the default seed (${entries.length} entr${entries.length === 1 ? "y" : "ies"})</summary>` +
    `<table>${rows}</table></details>`
  );
}

function renderGroups(state: GovernanceViewState): string {
  const groups = buildGroups(state);
  if (groups.length === 0) return "";
  const editable = state.validation === undefined || state.validation.ok;
  return groups
    .map((group) => {
      const toolSections = group.tools
        .map((tool) => {
          const rows = tool.rows
            .map((row) => {
              const options = (["enabled", "disabled", "inherit"] as const)
                .map(
                  (value) =>
                    `<option value="${value}"${row.toggle === value ? " selected" : ""}>${value}</option>`,
                )
                .join("");
              return (
                `<tr${row.staged ? ' class="staged"' : ""}>` +
                `<td class="key">${escapeHtml(row.key)}</td>` +
                `<td><span class="badge ${row.mutates === "write" ? "write" : ""}">${escapeHtml(row.mutates)}</span></td>` +
                `<td><span class="badge ${row.baseline ? "" : "new"}">${originBadge(row)}</span></td>` +
                `<td><span class="badge ${row.effective ? "enabled" : "disabled"}">${row.effective ? "enabled" : "disabled"}</span>` +
                `<span class="badge">${escapeHtml(configSourceBadge(row.source))}</span></td>` +
                `<td><select data-key="${escapeHtml(row.key)}"${editable ? "" : " disabled"}>${options}</select></td>` +
                `</tr>`
              );
            })
            .join("");
          return `<table><tbody>${rows}</tbody></table>`;
        })
        .join("");
      const keyCount = group.tools.reduce((count, tool) => count + tool.rows.length, 0);
      return `<details open><summary>${escapeHtml(group.pkg)} (${keyCount} keys)</summary>${toolSections}</details>`;
    })
    .join("");
}

function renderBanners(state: GovernanceViewState): string {
  const banners: string[] = [];
  if (!state.fileExists) {
    banners.push(
      `<div class="banner error"><strong>This file does not exist yet.</strong> A server launched with ` +
        `IRIS_GOVERNANCE_FILE pointing at a missing file FAILS TO START — Save any change below (the CLI creates ` +
        `the file), fix the path with Choose File…, or clear <code>irisMcpLauncher.governanceFile</code>.</div>`,
    );
  }
  if (state.validation !== undefined && !state.validation.ok) {
    banners.push(
      `<div class="banner error"><strong>The governance file is invalid</strong> (a server fails startup with ` +
        `this exact error):<br>${escapeHtml(state.validation.error ?? "unknown validation error")}<br>` +
        `Editing is disabled until the file parses — fix it in an editor, then Refresh.</div>`,
    );
  }
  if (state.loadError !== undefined) {
    banners.push(`<div class="banner error">${escapeHtml(state.loadError)}</div>`);
  }
  const universe = state.universeByTab[state.activeTab];
  if (state.fileExists && state.validation?.ok && universe === undefined && state.loadError === undefined) {
    banners.push(`<div class="banner">Loading the governance universe… (Refresh if this persists.)</div>`);
  }
  return banners.join("");
}

/** The full webview document for the editor state. */
export function renderGovernanceHtml(state: GovernanceViewState, nonce: string): string {
  const universe = state.universeByTab[state.activeTab];
  const enabledCount =
    universe === undefined ? 0 : Object.values(universe.policy).filter(Boolean).length;
  const totalCount = universe?.keys.length ?? 0;
  const presetLabel = state.preset === "" ? "unset" : state.preset;
  const summary =
    universe === undefined
      ? ""
      : `<div class="meta">Effective policy for profile <strong>${escapeHtml(universe.profile)}</strong>: ` +
        `${enabledCount} of ${totalCount} keys enabled. Shown exactly as the governance engine computes it — ` +
        `the same render a running server's iris_server_profiles reports over that server's registered key universe.</div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IRIS Governance</title>
<style>${VIEW_CSS}</style>
</head>
<body>
<h1>IRIS Governance</h1>
<div class="meta">File: <code>${escapeHtml(state.file)}</code> · Engine: iris-mcp-governance CLI (${state.engineMode === "local" ? "local build" : "npx, published"}) · Preset (env-sourced, display only): ${escapeHtml(presetLabel)}</div>
${renderBanners(state)}
${renderToolbar(state)}
${renderTabs(state)}
${summary}
${renderPending(state)}
${renderDiff(state)}
${renderGroups(state)}
<div class="note">Changes apply on next server start — servers read the governance file once at startup; restart a server to apply. The view reflects the file's state at open/refresh.
${escapeHtml(universe?.note ?? "")}</div>
<script nonce="${nonce}">${VIEW_SCRIPT}</script>
</body>
</html>`;
}

/** The empty state rendered when `irisMcpLauncher.governanceFile` is unset (J1: explicit path only, never discovered). */
export function renderEmptyStateHtml(nonce: string, engineError?: string): string {
  const errorBlock =
    engineError === undefined
      ? ""
      : `<div class="banner error">${escapeHtml(engineError)}</div>`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>IRIS Governance</title>
<style>${VIEW_CSS}</style>
</head>
<body>
<div class="empty">
<h1>IRIS Governance</h1>
${errorBlock}
<p>No governance file is configured. The governance editor manages ONE JSON policy file that every MCP client
picks up on next server start (via <code>IRIS_GOVERNANCE_FILE</code>) — the file path is explicit only and is
never discovered for you.</p>
<p>Choose an existing governance file:</p>
<div class="toolbar"><button data-msg='${msgAttr({ type: "chooseFile" })}'>Choose File…</button></div>
<p>To start a NEW policy file, set <code>irisMcpLauncher.governanceFile</code> to the path you want in Settings —
the editor will offer to create it on your first Save.</p>
<p class="note">This sets <code>irisMcpLauncher.governanceFile</code>, which is ALSO passed through unchanged as
<code>IRIS_GOVERNANCE_FILE</code> to every spawned server. Empty = unset (no governance file).</p>
</div>
<script nonce="${nonce}">${VIEW_SCRIPT}</script>
</body>
</html>`;
}
