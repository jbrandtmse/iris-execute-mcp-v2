/**
 * `@iris-mcp/client-config` — pure pending-edit renderer (Epic 33, Story 33.0).
 *
 * `diff(currentContent, entry, adapter, scope, action)` renders the EXACT
 * edit a hypothetical apply/enable/disable would make — WITHOUT writing
 * anything (AC 33.0.3). This is the renderer Story 33.1's confirm flow
 * consumes (the Rule #52 seam: 33.1 owns APPLYING these edits — jsonc-parser
 * applyEdits, TOML text splices, YAML CST writes — plus backups, state.json
 * stash, and entry synthesis; this story's output is directly executable by
 * that apply path and must not be redesigned there).
 *
 * Purity contract: no fs, no clock, no env — identical inputs ⇒ identical
 * output. The rendered edit NEVER contains foreign third-party entries
 * (AC 33.0.4): every edit targets exactly the owned
 * `<rootKey>.<canonicalName>` node, and the text render shows only the owned
 * entry — never other entries' names or values (spec §3.5.5).
 */

import { parseTree, findNodeAtLocation, type Edit as JsoncEdit, type Node as JsoncNode } from "jsonc-parser";
import { Document } from "yaml";

import { readConfigEntries, hasJsonTokens, ownEntry, type RawEntry } from "./readers.js";
import type { CanonicalEntry, ClientAdapter, ClientScope } from "./types.js";

export type DiffAction = "apply" | "enable" | "disable" | "remove";

export type DiffMechanism =
  | "add" // apply: entry absent → insert
  | "update" // apply: entry present → replace value
  | "native-flag" // enable/disable via the client's own flag
  | "stash-add" // enable on a stash client with the entry absent → insert
  | "stash-remove" // disable on a stash client → remove the entry
  | "remove" // remove: entry present → delete it entirely (manager purge)
  | "already-in-state"; // requested state already holds → empty edit

/** JSON/JSONC edit — directly executable via jsonc-parser `applyEdits`. */
export interface JsoncNativeEdit {
  kind: "jsonc";
  /** The jsonc-parser modify path (rootKey + entry name [+ flag key]). */
  path: string[];
  /** The value set; `undefined` means property removal. */
  value: unknown;
  /** The exact edit set jsonc-parser computed (offsets/length/new content). */
  edits: JsoncEdit[];
}

/** TOML edit — a text-splice region descriptor over owned
 * `[mcp_servers.<name>]` tables ONLY (33.1 splices text; serializers are
 * ruled out because they drop comments elsewhere in the file, spec §3.5). */
export interface TomlNativeEdit {
  kind: "toml-splice";
  op: "insert" | "replace-region" | "remove-region" | "set-flag" | "merge-update";
  /** Owned table path, e.g. ["mcp_servers", "iris-dev-mcp"]. */
  tablePath: string[];
  /**
   * 0-based inclusive line range to replace/remove; null for op "insert".
   * For op "set-flag": the single line of an EXISTING flag key to replace,
   * or null when the flag line must be inserted after the table header.
   */
  region: { startLine: number; endLine: number } | null;
  /** For "insert": append the block after this 0-based line (-1 = file start).
   * For "set-flag" with a null region: the owned table's HEADER line. */
  insertAfterLine: number | null;
  /** The TOML block for insert/replace; the flag line for "set-flag"
   * (e.g. `enabled = false`); null for "remove-region" and "merge-update". */
  insertText: string | null;
  /**
   * Op "merge-update" (Story 33.5, AC 33.5.2): the line-span replacements of
   * the apply-update surgery. Each span replaces lines startLine..endLine
   * INCLUSIVE with `lines`; a span with endLine < startLine is a pure
   * INSERT at startLine. Spans are disjoint; the executor applies them
   * bottom-up. Only manager-owned lines (command/args/env) appear here —
   * every unmanaged line of the owned table stays byte-exact.
   */
  spans?: { startLine: number; endLine: number; lines: string[] }[];
}

/** YAML edit — a CST operation 33.1 executes via the yaml Document API. */
export interface YamlNativeEdit {
  kind: "yaml-cst";
  op: "set" | "delete" | "set-flag" | "merge-update";
  /** Node path under the document root. */
  path: string[];
  /** The entry (op "set") or flag value (op "set-flag"); null for "delete"
   * and "merge-update" (the per-key ops carry the values). */
  value: unknown;
  /**
   * Op "merge-update" (Story 33.5 QA): the per-key sets of an apply-update.
   * A whole-entry `set` re-rendered the owned subtree and dropped every
   * comment INSIDE it; only a key whose merged value CHANGES appears here
   * (path = [rootKey, name, key]), so untouched keys — and their comments —
   * stay byte-exact (the TOML merge-update discipline).
   */
  ops?: { path: string[]; value: unknown }[];
  /** Preview snippet of just the owned entry (never the whole file). */
  renderedEntry: string | null;
}

export type NativeEdit = JsoncNativeEdit | TomlNativeEdit | YamlNativeEdit;

export type DiffResult =
  | {
      ok: true;
      client: string;
      scope: ClientScope;
      action: DiffAction;
      mechanism: DiffMechanism;
      /**
       * The executable edit descriptor — `null` EXACTLY when `mechanism` is
       * `"already-in-state"` (there is no edit to apply). Consumers MUST
       * branch on `mechanism` before executing: rendering a no-op as a
       * descriptor would invite a consumer to execute it (a YAML `set` of
       * `null` DESTROYS the entry; a TOML null-field "insert" splices stray
       * blank lines) — `null` makes the no-op unexecutable by construction.
       */
      native: NativeEdit | null;
      /** Human-readable render (owned entry only — safe to print). */
      text: string;
    }
  | { ok: false; client: string; scope: ClientScope; action: DiffAction; reason: string };

/** Render the canonical entry into the adapter's native entry shape. */
export function renderNativeEntry(adapter: ClientAdapter, entry: CanonicalEntry): RawEntry {
  const shaped = shapeEntry(adapter, entry);
  // A native-flag client gets the flag rendered explicitly at its ENABLED
  // value on fresh entries (Goose `enabled: true`, Cline/Roo `disabled: false`,
  // Codex `enabled = true`) so a disable -> enable round-trip restores the
  // applied bytes exactly (Story 33.1 golden round-trip, AC 33.1.3).
  const flag = adapter.nativeDisableFlag;
  if (flag) shaped[flag.key] = flag.enabledValue;
  return shaped;
}

/** The per-entryShape render (flag stamping lives in renderNativeEntry). */
function shapeEntry(adapter: ClientAdapter, entry: CanonicalEntry): RawEntry {
  const env = entry.env && Object.keys(entry.env).length > 0 ? entry.env : undefined;
  switch (adapter.entryShape) {
    case "standard": {
      const shaped: RawEntry = { command: entry.command, args: [...entry.args] };
      if (env) shaped.env = { ...env };
      return shaped;
    }
    case "zed": {
      const command: RawEntry = { path: entry.command, args: [...entry.args] };
      if (env) command.env = { ...env };
      return { command };
    }
    case "goose": {
      const shaped: RawEntry = { type: "stdio", cmd: entry.command, args: [...entry.args] };
      if (env) shaped.envs = { ...env };
      shaped.enabled = true;
      return shaped;
    }
    case "codex-toml": {
      const shaped: RawEntry = { command: entry.command, args: [...entry.args] };
      if (env) shaped.env = { ...env };
      return shaped;
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  // Prototype-checked (the readers.ts discipline): a smol-toml TomlDate is a
  // class instance, NOT a re-renderable table — it must fall through to the
  // documented refusal in tomlSourceValue, never render as an inline table
  // of its internals.
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Merge a fresh manager render OVER an existing owned entry for an apply
 * UPDATE (Story 33.5, AC 33.5.2 — the lead-probed HIGH: an apply-update
 * REPLACED the whole entry, wiping unmanaged keys like Cline `autoApprove` /
 * `timeout` and stamping the native flag back to enabled — an implicit
 * re-enable the user never asked for).
 *
 * Semantics: manager-owned keys (command/args per the adapter's entry shape)
 * are overwritten; the env carrier (`env` / `envs`, nested under `command`
 * for zed) is merged KEY-WISE so user-added env extras survive; EVERY other
 * key on the existing entry is preserved; and the native disable flag is
 * NEVER stamped by an update — a `disabled: true` entry stays disabled
 * through apply, and no flag appears on an entry that didn't have one.
 *
 * Documented seam: when the canonical render carries NO env at all, an
 * existing env carrier is left untouched (the manager cannot distinguish
 * "user extras" from "manager keys from an older mode" — preservation wins).
 */
export function mergeUpdateEntry(adapter: ClientAdapter, existing: RawEntry, fresh: RawEntry): RawEntry {
  const merged: RawEntry = { ...existing };
  const mergeEnvCarrier = (target: RawEntry, source: RawEntry, key: string): void => {
    const freshEnv = source[key];
    if (!isRecord(freshEnv)) return; // canonical render has no env: leave as-is
    const existingEnv = isRecord(target[key]) ? (target[key] as Record<string, unknown>) : {};
    target[key] = { ...existingEnv, ...freshEnv };
  };
  switch (adapter.entryShape) {
    case "standard":
    case "codex-toml":
      merged.command = fresh.command;
      merged.args = fresh.args;
      mergeEnvCarrier(merged, fresh, "env");
      break;
    case "zed": {
      const freshCommand = isRecord(fresh.command) ? (fresh.command as Record<string, unknown>) : {};
      const mergedCommand = isRecord(merged.command) ? { ...(merged.command as Record<string, unknown>) } : {};
      mergedCommand.path = freshCommand.path;
      mergedCommand.args = freshCommand.args;
      mergeEnvCarrier(mergedCommand, freshCommand, "env");
      merged.command = mergedCommand;
      break;
    }
    case "goose":
      merged.type = fresh.type;
      merged.cmd = fresh.cmd;
      merged.args = fresh.args;
      mergeEnvCarrier(merged, fresh, "envs");
      break;
  }
  return merged;
}

/** Quote a TOML basic string, escaping backslashes, quotes, and control
 * characters (Story 33.5, 33-5-13: a value bearing a newline/tab previously
 * produced INVALID TOML — the raw control char landed inside the quotes).
 * Keys are compared by code point so this SOURCE holds no control-char
 * literals (the Rule #55 lesson). */
function tomlString(value: string): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\") {
      out += "\\\\";
      continue;
    }
    if (ch === '"') {
      out += '\\"';
      continue;
    }
    if (code === 0x0a) {
      out += "\\n";
      continue;
    }
    if (code === 0x0d) {
      out += "\\r";
      continue;
    }
    if (code === 0x09) {
      out += "\\t";
      continue;
    }
    if (code === 0x08) {
      out += "\\b";
      continue;
    }
    if (code === 0x0c) {
      out += "\\f";
      continue;
    }
    // Remaining C0/C1 control chars must not appear raw in a basic string.
    out += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? `\\u${code.toString(16).padStart(4, "0")}` : ch;
  }
  return `"${out}"`;
}

/** A TOML key: bare when it matches [A-Za-z0-9_-]+, a quoted basic string
 * otherwise (33-5-13 — an env var or entry name with dots/spaces previously
 * produced broken or mis-targeting TOML). */
function tomlKey(key: string): string {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : tomlString(key);
}

/** Render a scalar as TOML (boolean/number bare, anything else a quoted string). */
function tomlScalar(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  return tomlString(String(value));
}

/** Serialize the owned entry as a Codex `[mcp_servers.<name>]` TOML block. */
export function serializeTomlEntry(adapter: ClientAdapter, entry: CanonicalEntry): string {
  const shaped = renderNativeEntry(adapter, entry);
  const lines: string[] = [];
  lines.push(`[${[adapter.rootKey, entry.name].map(tomlKey).join(".")}]`);
  lines.push(`command = ${tomlString(entry.command)}`);
  const args = (shaped.args as string[]).map(tomlString).join(", ");
  lines.push(`args = [${args}]`);
  // A native-flag client's flag is rendered explicitly at its enabled value
  // (e.g. `enabled = true` for Codex) — see renderNativeEntry.
  const flag = adapter.nativeDisableFlag;
  if (flag) lines.push(`${tomlKey(flag.key)} = ${tomlScalar(shaped[flag.key] ?? flag.enabledValue)}`);
  const env = shaped.env as Record<string, string> | undefined;
  if (env) {
    lines.push("");
    lines.push(`[${[adapter.rootKey, entry.name, "env"].map(tomlKey).join(".")}]`);
    for (const [key, value] of Object.entries(env)) {
      lines.push(`${tomlKey(key)} = ${tomlString(value)}`);
    }
  }
  return lines.join("\n");
}

// ════════════════════════════════════════════════════════════════════
// TOML structure scanning (Story 33.5, AC 33.5.3 — the multiline region
// corruption: a `"""`/`'''` string or a nested multi-line array inside an
// owned table used to TRUNCATE the region at the first header-looking line
// inside the construct, leaving orphaned lines behind on remove/replace).
//
// `scanTomlStructure` runs a line-anchored mini-lexer over the document and
// reports, per line, whether the line STARTS at TOML top level (outside
// every string and bracket nest). Only top-level lines may be table
// headers, key lines, or structural blanks/comments — every consumer
// (region math, insert-point math, flag/key scans) MUST gate on it.
// ════════════════════════════════════════════════════════════════════

type TomlLexState = "normal" | "basic" | "literal" | "mlbasic" | "mlliteral" | "comment";

/**
 * Per-line top-level flags for a TOML document. `result[i] === true` means
 * line `i` begins OUTSIDE every multi-line string and bracket nest.
 * Malformed input degrades gracefully (single-line strings reopened at EOL);
 * callers always parse-validate before splicing, so this never has to be
 * perfect on broken documents — only never wrong on VALID ones.
 */
export function scanTomlStructure(content: string): boolean[] {
  const lines = content.split("\n");
  const topLevel: boolean[] = [];
  let state: TomlLexState = "normal";
  let depth = 0;
  for (const line of lines) {
    topLevel.push(state === "normal" && depth === 0);
    let i = 0;
    while (i < line.length) {
      const ch = line[i] as string;
      switch (state) {
        case "normal":
          if (ch === "#") {
            state = "comment";
          } else if (ch === '"') {
            if (line.startsWith('"""', i)) {
              state = "mlbasic";
              i += 2;
            } else {
              state = "basic";
            }
          } else if (ch === "'") {
            if (line.startsWith("'''", i)) {
              state = "mlliteral";
              i += 2;
            } else {
              state = "literal";
            }
          } else if (ch === "[") {
            depth++;
          } else if (ch === "]") {
            depth = Math.max(0, depth - 1);
          }
          break;
        case "basic":
          if (ch === "\\") i++;
          else if (ch === '"') state = "normal";
          break;
        case "literal":
          if (ch === "'") state = "normal";
          break;
        case "mlbasic":
          if (ch === "\\") i++;
          else if (line.startsWith('"""', i)) {
            state = "normal";
            i += 2;
          }
          break;
        case "mlliteral":
          if (line.startsWith("'''", i)) {
            state = "normal";
            i += 2;
          }
          break;
        case "comment":
          break; // runs to EOL
      }
      i++;
    }
    if (state === "comment" || state === "basic" || state === "literal") state = "normal";
  }
  return topLevel;
}

/** Find the owned `[<rootKey>.<name>]`(+sub-table) line region, 0-based
 * inclusive. The region ends before the next non-owned table header, with
 * the trailing run of blank AND comment lines excluded — a comment block
 * immediately preceding the next header belongs to the FOLLOWING section
 * (TOML comment convention), never to the owned tables. A comment ABOVE the
 * owned header is likewise outside the region (left in place on removal —
 * documented v1 choice). A trailing comment ON the owned header line itself
 * (`[root.name] # managed by iris-mcp`) is legal TOML and stays INSIDE the
 * region (it belongs to the owned table).
 *
 * Multi-line aware (AC 33.5.3): header detection is gated on the
 * scanTomlStructure top-level flags, so a header-looking line inside a
 * `"""`/`'''` string or a nested-array continuation line (`  ["a"],`) no
 * longer truncates the region; trailing-blank/comment trimming also only
 * touches top-level lines (a blank or `#`-looking line inside a multiline
 * string is CONTENT).
 *
 * Returns null when the entry is absent — OR when it exists only in a form
 * with no table header (e.g. dotted-key definitions or quoted table names;
 * callers treat a parser-present but region-less entry as a REFUSAL, never
 * an insert/removal guess). */
export function findTomlEntryRegion(
  content: string,
  rootKey: string,
  name: string,
): { startLine: number; endLine: number } | null {
  const lines = content.split("\n");
  const topLevel = scanTomlStructure(content);
  const escapedRoot = rootKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownedHeader = new RegExp(`^\\s*\\[\\s*${escapedRoot}\\.${escapedName}(\\..+)?\\]\\s*(#.*)?$`);
  const anyHeader = /^\s*\[/;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!topLevel[i]) continue;
    if (start === -1) {
      if (ownedHeader.test(lines[i] ?? "")) start = i;
      continue;
    }
    const line = lines[i] ?? "";
    if (anyHeader.test(line) && !ownedHeader.test(line)) {
      return { startLine: start, endLine: trimRegionEnd(lines, topLevel, start, i - 1) };
    }
  }
  if (start === -1) return null;
  return { startLine: start, endLine: trimRegionEnd(lines, topLevel, start, lines.length - 1) };
}

/** Region end: trim the trailing run of TOP-LEVEL blank and whole-line
 * comment lines (string content is never trimmed — AC 33.5.3). */
function trimRegionEnd(lines: string[], topLevel: boolean[], start: number, end: number): number {
  let e = end;
  while (e > start && topLevel[e]) {
    const trimmed = (lines[e] ?? "").trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) break;
    e--;
  }
  return e;
}

/** Insert-point end: trim trailing TOP-LEVEL blank lines only (comments may
 * belong to the last section — inserting before them would split them off). */
function trimTrailingBlank(lines: string[], topLevel: boolean[], start: number, end: number): number {
  let e = end;
  while (e > start && topLevel[e] && (lines[e] ?? "").trim() === "") e--;
  return e;
}

/** Line index after which a NEW `[<rootKey>.*]` block should be inserted:
 * the end of the last existing `<rootKey>` table, else end of file. */
export function findTomlInsertLine(content: string, rootKey: string): number {
  const lines = content.split("\n");
  const topLevel = scanTomlStructure(content);
  const escapedRoot = rootKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rootHeader = new RegExp(`^\\s*\\[\\s*${escapedRoot}(\\..+)?\\]\\s*(#.*)?$`);
  const anyHeader = /^\s*\[/;
  let insertAfter = lines.length - 1;
  let inRoot = false;
  let rootEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    if (!topLevel[i]) continue;
    const line = lines[i] ?? "";
    if (anyHeader.test(line)) {
      if (inRoot) rootEnd = i - 1;
      inRoot = rootHeader.test(line);
    }
  }
  if (inRoot) rootEnd = lines.length - 1;
  if (rootEnd !== -1) insertAfter = trimTrailingBlank(lines, topLevel, 0, rootEnd);
  return insertAfter;
}

interface ActionPlan {
  mechanism: DiffMechanism;
  /** true when the edit sets the native flag (enable or disable). */
  flagValue?: unknown;
  /** true when the edit removes the entry (stash disable). */
  removes?: boolean;
  /** true when the edit sets the entry (apply / stash-add / native enable). */
  setsEntry?: boolean;
}

function planAction(
  adapter: ClientAdapter,
  entry: CanonicalEntry,
  action: DiffAction,
  present: boolean,
  disabled: boolean,
): ActionPlan | { error: string } {
  const flag = adapter.nativeDisableFlag;
  switch (action) {
    case "apply":
      return present ? { mechanism: "update", setsEntry: true } : { mechanism: "add", setsEntry: true };
    case "enable":
      if (flag) {
        if (!present) return { error: `entry "${entry.name}" is not present; nothing to enable` };
        if (!disabled) return { mechanism: "already-in-state" };
        return { mechanism: "native-flag", flagValue: flag.enabledValue };
      }
      if (present) return { mechanism: "already-in-state" };
      return { mechanism: "stash-add", setsEntry: true };
    case "disable":
      if (flag) {
        if (!present) return { error: `entry "${entry.name}" is not present; nothing to disable` };
        if (disabled) return { mechanism: "already-in-state" };
        return { mechanism: "native-flag", flagValue: flag.disabledValue };
      }
      if (!present) return { mechanism: "already-in-state" };
      return { mechanism: "stash-remove", removes: true };
    case "remove":
      if (!present) return { mechanism: "already-in-state" };
      return { mechanism: "remove", removes: true };
  }
}

/**
 * Optional render overrides for the write engine (Story 33.1).
 *
 * `nativeEntry`: render this PRE-SHAPED native entry instead of
 * `renderNativeEntry(adapter, entry)`. The engine's stash-restore path passes
 * the stashed (parsed) native entry so native-only keys the canonical model
 * cannot express (Cline `autoApprove`, Codex `startup_timeout_sec`, ...)
 * survive a disable -> enable round-trip without re-synthesis.
 */
export interface DiffOptions {
  nativeEntry?: RawEntry;
}

/**
 * Render the pending edit for a hypothetical apply/enable/disable. PURE:
 * no fs, no clock, no env — identical inputs ⇒ identical output.
 * `currentContent` is the config file's current text (`null` = file does not
 * exist yet — an apply creates it).
 */
export function diff(
  currentContent: string | null,
  entry: CanonicalEntry,
  adapter: ClientAdapter,
  scope: ClientScope,
  action: DiffAction,
  options?: DiffOptions,
): DiffResult {
  const fail = (reason: string): DiffResult => ({ ok: false, client: adapter.id, scope, action, reason });

  // Parse in the adapter's native format to establish presence/state; a
  // malformed file is a REFUSAL, never a guess (33.1's safety protocol
  // parse-validates before touching for the same reason).
  const content = currentContent ?? "";
  let present = false;
  let disabled = false;
  let existing: RawEntry | undefined;
  if (content.trim() !== "") {
    const parsed = readConfigEntries(adapter, content);
    if (!parsed.ok) return fail(`config is unparseable: ${parsed.error}`);
    // 33-5-12: an array-of-tables entry is a documented REFUSAL on every
    // write action (never a silent add/update/remove guess).
    const unsupportedForm = ownEntry(parsed.unsupported, entry.name);
    if (unsupportedForm !== undefined) {
      return fail(
        `entry "${entry.name}" exists in ${unsupportedForm} form (e.g. [[${adapter.rootKey}.${entry.name}]]), ` +
          `which the manager cannot model as a single server entry; refusing — restructure it as one [${adapter.rootKey}.${entry.name}] table`,
      );
    }
    existing = ownEntry(parsed.entries, entry.name);
    present = existing !== undefined;
    if (present && adapter.nativeDisableFlag && existing) {
      disabled = existing[adapter.nativeDisableFlag.key] === adapter.nativeDisableFlag.disabledValue;
    }
  }

  const plan = planAction(adapter, entry, action, present, disabled);
  if ("error" in plan) return fail(plan.error);

  let shaped = options?.nativeEntry ?? renderNativeEntry(adapter, entry);
  if (plan.mechanism === "update" && existing !== undefined && adapter.format !== "toml") {
    // AC 33.5.2: an UPDATE merges over the existing entry (unmanaged keys +
    // enablement preserved) — TOML merges at the TEXT layer instead (see
    // tomlMergeUpdate; the text splice preserves unmanaged lines byte-exact).
    shaped = mergeUpdateEntry(adapter, existing, shaped);
  }
  // already-in-state renders NO descriptor (native: null) — see DiffResult.
  let native: NativeEdit | null = null;
  if (plan.mechanism !== "already-in-state") {
    if (adapter.format === "toml") {
      const edit = tomlEdit(adapter, entry, content, plan, shaped, existing);
      if ("error" in edit) return fail(edit.error);
      native = edit;
    } else if (adapter.format === "yaml") {
      native = yamlEdit(adapter, entry, shaped, plan, existing);
    } else {
      const edit = jsoncEdit(adapter, entry, content, shaped, plan, existing);
      if (edit.edits.length === 0) {
        return fail(`could not compute a JSON edit for "${entry.name}" (unsupported document shape); refusing to render an empty edit set`);
      }
      native = edit;
    }
  }

  return {
    ok: true,
    client: adapter.id,
    scope,
    action,
    mechanism: plan.mechanism,
    native,
    text: renderText(adapter, scope, action, plan, entry, shaped, native),
  };
}

/**
 * Compute a surgical removal edit for one property: a single TextEdit with
 * EMPTY content spanning exactly the owned property plus one adjacent comma.
 * jsonc-parser's own `modify(path, undefined)` instead REWRITES through the
 * neighboring property — its edit content then carries an adjacent (possibly
 * foreign) entry's key text, which AC 33.0.4 forbids on the rendered edit
 * surface. This hand-rolled span provably contains only the owned entry.
 */
function removalEdits(content: string, path: string[]): JsoncEdit[] {
  const tree = parseTree(content);
  if (!tree) return [];
  // findNodeAtLocation returns the property's VALUE node; the property node
  // (key + value) is its parent.
  const valueNode = findNodeAtLocation(tree, path);
  const node = valueNode?.parent?.type === "property" ? valueNode.parent : valueNode;
  if (!node) return [];
  let start = node.offset;
  let end = node.offset + node.length;
  // Prefer swallowing the TRAILING comma (+ following newline/indent).
  let i = end;
  while (i < content.length && (content[i] === " " || content[i] === "\t")) i++;
  if (content[i] === ",") {
    // A trailing comma only belongs to the removal span when ANOTHER property
    // follows (it separates the two). When the next non-whitespace token is
    // the closing bracket, this is the LAST property in a trailing-comma-
    // styled JSONC document: swallow the comma plus the PRECEDING
    // newline+indent instead and keep the whitespace before the closer, so
    // add → remove stays a byte-exact inverse in trailing-comma-styled files
    // (QA 33.1-F3 — the old span left the entry's indent glued to `}`).
    let k = i + 1;
    while (k < content.length && /\s/.test(content[k] ?? "")) k++;
    if (content[k] === "}" || content[k] === "]") {
      end = i + 1; // swallow the trailing comma itself
      let j = start - 1;
      while (j >= 0 && (content[j] === " " || content[j] === "\t")) j--;
      if (content[j] === "\n") {
        j--;
        if (j >= 0 && content[j] === "\r") j--;
        start = j + 1;
      }
    } else {
      i++;
      while (i < content.length && (content[i] === " " || content[i] === "\t")) i++;
      if (content[i] === "\r" && content[i + 1] === "\n") i += 2;
      else if (content[i] === "\n") i++;
      while (i < content.length && (content[i] === " " || content[i] === "\t")) i++;
      end = i;
    }
  } else {
    // Last property: swallow the PRECEDING comma. Comments sitting between
    // the comma and the owned property (33-5-4 / AC 33.5.3, probe-verified
    // 2026-07-28: the 33.2 rework did NOT cover it) made the old
    // whitespace-only backward scan miss the comma — leaving a dangling
    // `, }` behind (a syntax error for strict-JSON clients). Whole-line
    // `//` and `/* */` comments are skipped upward; a trailing `//` on the
    // comma's own line keeps its text. When any comment intervened, the
    // comma and the property go as TWO edits so the comment survives.
    let j = start - 1;
    while (j >= 0 && /\s/.test(content[j] ?? "")) j--;
    let commentBetween = false;
    for (;;) {
      if (j < 0) break;
      if (j >= 1 && content[j] === "/" && content[j - 1] === "*") {
        // End of a block comment: skip it when nothing but whitespace
        // precedes it on its line, then keep scanning upward.
        const open = content.lastIndexOf("/*", j - 2);
        const ls = content.lastIndexOf("\n", open) + 1;
        if (open !== -1 && content.slice(ls, open).trim() === "") {
          j = ls - 2;
          while (j >= 0 && /\s/.test(content[j] ?? "")) j--;
          commentBetween = true;
          continue;
        }
        break;
      }
      const ls = content.lastIndexOf("\n", j) + 1;
      const segment = content.slice(ls, j + 1);
      const slashes = segment.indexOf("//");
      if (slashes !== -1) {
        if (segment.slice(0, slashes).trim() === "") {
          // Whole-line comment: skip above it and keep scanning.
          j = ls - 2;
          while (j >= 0 && /\s/.test(content[j] ?? "")) j--;
          commentBetween = true;
          continue;
        }
        // A trailing comment on the previous property's own line: the
        // separator comma (when present) sits BEFORE the comment text.
        const comma = segment.slice(0, slashes).lastIndexOf(",");
        if (comma !== -1) {
          const propStart = propertyStartWithIndent(content, start);
          return [
            { offset: ls + comma, length: 1, content: "" },
            { offset: propStart, length: end - propStart, content: "" },
          ];
        }
        break;
      }
      break;
    }
    if (content[j] === ",") {
      if (!commentBetween) {
        start = j;
      } else {
        const propStart = propertyStartWithIndent(content, start);
        return [
          { offset: j, length: 1, content: "" },
          { offset: propStart, length: end - propStart, content: "" },
        ];
      }
    }
  }
  return [{ offset: start, length: end - start, content: "" }];
}

/** Walk a property's start offset back over its own line's indent (the
 * indent goes with the property; the preceding newline stays). */
function propertyStartWithIndent(content: string, start: number): number {
  let s = start;
  while (s > 0 && (content[s - 1] === " " || content[s - 1] === "\t")) s--;
  return s;
}

/**
 * Detected document line ending: the FIRST line break in the file wins
 * (CRLF when a `\r` precedes it), so inserted text never introduces a
 * foreign EOL into a CRLF (or LF) document.
 */
function detectEol(content: string): string {
  const idx = content.indexOf("\n");
  return idx > 0 && content[idx - 1] === "\r" ? "\r\n" : "\n";
}

/** Leading whitespace of the line containing `offset`. */
function lineIndentAt(content: string, offset: number): string {
  let start = offset;
  while (start > 0 && content[start - 1] !== "\n") start--;
  return /^[ \t]*/.exec(content.slice(start))?.[0] ?? "";
}

/**
 * The document's indent unit: the leading whitespace of its first indented
 * line (the depth-1 indent — 2 vs 4 spaces vs tabs respected verbatim).
 * Defaults to two spaces for an all-unindented document.
 */
function detectIndentUnit(content: string): string {
  for (const line of content.split("\n")) {
    const match = /^([ \t]+)\S/.exec(line);
    if (match) return match[1] ?? "  ";
  }
  return "  ";
}

/**
 * Pretty-render a value at `baseIndent`: `JSON.stringify(value, null, unit)`
 * with every continuation line re-based onto `baseIndent` and joined with the
 * document's own EOL. Line 0 stays inline (it follows `"key": ` or replaces
 * an existing value span).
 */
function renderValueAt(value: unknown, baseIndent: string, unit: string, eol: string): string {
  const raw = JSON.stringify(value, null, unit);
  const lines = raw.split("\n");
  return lines.map((line, i) => (i === 0 ? line : baseIndent + line)).join(eol);
}

/** Wrap `value` in the remaining path segments (object keys / array slots). */
function buildNested(segments: (string | number)[], value: unknown): unknown {
  let acc: unknown = value;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i] ?? "";
    acc = typeof seg === "number" ? [acc] : { [seg]: acc };
  }
  return acc;
}

/**
 * Compute a surgical INSERT edit: a single TextEdit (two when a same-line
 * comment follows the last child — see below) whose span touches NOTHING
 * existing, inserting exactly the owned key text.
 *
 * jsonc-parser's `modify(path, value, { formattingOptions })` is NOT safe
 * here (33.2 lead smoke, HIGH): inserting into a non-empty object makes
 * jsonc-parser re-render ALL sibling properties with the supplied options —
 * compact foreign entries are expanded, 4-space files get 2-space inserts,
 * CRLF regions are re-rendered. This hand-rolled edit provably leaves every
 * sibling byte-untouched (AC 33.0.4/33.1.1) while the inserted entry is
 * rendered pretty in the FILE's own detected indent unit and EOL — the same
 * discipline `removalEdits` applies to deletion.
 *
 * Handles: the empty document (whole-file replace, canonical 2-space — the
 * historical create-file bytes), a missing rootKey / intermediate ancestor
 * (nested build), an empty inline container (`{}` expanded), single-line
 * containers (compact inline insert — the one-line style is preserved),
 * trailing-comma-styled JSONC (the insert carries its own trailing comma so
 * add → remove stays a byte-exact inverse, QA 33.1-F3), and same-line
 * comments after the last child (the new entry lands AFTER the comment; the
 * separating comma is a second edit placed directly after the last value,
 * never inside the comment text).
 */
export function insertionEdits(content: string, path: (string | number)[], value: unknown): JsoncEdit[] {
  if (content.trim() === "") {
    return [{ offset: 0, length: content.length, content: JSON.stringify(buildNested(path, value), null, 2) }];
  }
  const tree = parseTree(content);
  if (!tree) {
    // A comment-only JSONC document (Story 33.5 QA, AC 33.5.4): a VALID empty
    // document with NO parse tree — the add path treats it like an empty file
    // (whole-document write) but preserves the user's trivia verbatim above
    // the new document. Anything WITH real tokens and no tree is genuinely
    // unsupported (empty edit set → refusal, as before).
    if (hasJsonTokens(content)) return [];
    const kept = content.trimEnd();
    const rendered = JSON.stringify(buildNested(path, value), null, 2);
    return [{ offset: 0, length: content.length, content: kept === "" ? rendered : `${kept}${detectEol(content)}${rendered}` }];
  }
  // Walk to the deepest existing ancestor along the path.
  let container: JsoncNode = tree;
  let depth = 0;
  while (depth < path.length) {
    const seg = path[depth] ?? "";
    let child: JsoncNode | undefined;
    if (typeof seg === "number") {
      child = container.type === "array" ? container.children?.[seg] : undefined;
    } else if (container.type === "object") {
      child = findNodeAtLocation(container, [seg]);
    }
    if (!child) break;
    container = child;
    depth++;
  }
  if (depth === path.length) return []; // already present — callers route to replacementEdits
  const key = path[depth] ?? "";
  const inserted = buildNested(path.slice(depth + 1), value);
  return insertIntoContainer(content, container, key, inserted);
}

/** The single-container insert step of `insertionEdits`. */
function insertIntoContainer(content: string, node: JsoncNode, key: string | number, value: unknown): JsoncEdit[] {
  if (node.type !== "object" && node.type !== "array") return [];
  const eol = detectEol(content);
  const isObject = node.type === "object";
  const keyPrefix = isObject ? `${JSON.stringify(String(key))}: ` : "";
  const children = node.children ?? [];

  if (children.length === 0) {
    // Empty container: expand the braces. An interior comment (the rare
    // `{ /* note */ }`) is kept verbatim above the inserted key.
    const nodeIndent = lineIndentAt(content, node.offset);
    const unit = detectIndentUnit(content);
    const childIndent = nodeIndent + unit;
    const pretty = keyPrefix + renderValueAt(value, childIndent, unit, eol);
    const innerStart = node.offset + 1;
    const innerEnd = node.offset + node.length - 1;
    const kept = content.slice(innerStart, innerEnd).trimEnd();
    const text = kept === "" ? `${eol}${childIndent}${pretty}${eol}${nodeIndent}` : `${kept}${eol}${childIndent}${pretty}${eol}${nodeIndent}`;
    return [{ offset: innerStart, length: innerEnd - innerStart, content: text }];
  }

  const first = children[0];
  const last = children[children.length - 1];
  if (!first || !last) return [];
  const lastEnd = last.offset + last.length;
  const sameLine = !content.slice(node.offset, first.offset).includes("\n");

  // Advance past a same-line trailing comma and same-line comments. Spaces
  // are consumed ONLY as part of a comma/comment skip (never bare — a bare
  // skip would detach the insert from the last value's own spacing).
  let i = lastEnd;
  let sawComma = false;
  for (;;) {
    let j = i;
    while (content[j] === " " || content[j] === "\t") j++;
    const c = content[j];
    if (c === "," && !sawComma) {
      sawComma = true;
      i = j + 1;
      continue;
    }
    if (c === "/" && content[j + 1] === "/") {
      const nl = content.indexOf("\n", j);
      i = nl === -1 ? content.length : nl;
      continue;
    }
    if (c === "/" && content[j + 1] === "*") {
      const end = content.indexOf("*/", j + 2);
      i = end === -1 ? content.length : end + 2;
      continue;
    }
    break;
  }

  if (sameLine) {
    // A single-line container stays single-line (compact render).
    const compact = keyPrefix + JSON.stringify(value);
    const text = sawComma ? ` ${compact},` : `, ${compact}`;
    return [{ offset: i, length: 0, content: text }];
  }

  const childIndent = lineIndentAt(content, first.offset);
  const unit = detectIndentUnit(content);
  const pretty = keyPrefix + renderValueAt(value, childIndent, unit, eol);
  if (sawComma) {
    // Trailing-comma-styled JSONC: the comma is already there (skipped above);
    // the new entry carries the style's trailing comma itself.
    return [{ offset: i, length: 0, content: `${eol}${childIndent}${pretty},` }];
  }
  if (i === lastEnd) {
    return [{ offset: i, length: 0, content: `,${eol}${childIndent}${pretty}` }];
  }
  // A comment was skipped: the comma must attach to the LAST VALUE (never
  // land inside the comment text) — two edits, ascending offsets.
  return [
    { offset: lastEnd, length: 0, content: "," },
    { offset: i, length: 0, content: `${eol}${childIndent}${pretty}` },
  ];
}

/**
 * Compute a surgical REPLACE edit for an existing value node: one TextEdit
 * spanning exactly that node, rendered pretty in the file's detected indent
 * unit/EOL. Verified sibling-safe like jsonc-parser's own replace (33.2
 * probe), but without hardcoding 2-space LF into a 4-space/CRLF file.
 */
function replacementEdits(content: string, path: (string | number)[], value: unknown): JsoncEdit[] {
  const tree = parseTree(content);
  if (!tree) return [];
  const node = findNodeAtLocation(tree, path);
  if (!node) return [];
  const anchor = node.parent?.type === "property" ? node.parent.offset : node.offset;
  const baseIndent = lineIndentAt(content, anchor);
  const text = renderValueAt(value, baseIndent, detectIndentUnit(content), detectEol(content));
  return [{ offset: node.offset, length: node.length, content: text }];
}

/**
 * Structural JSON deep-equal (objects order-insensitive, arrays
 * order-sensitive). Backs the per-key update surgery (Story 33.5 QA): a key
 * whose merged value is IDENTICAL to the existing one gets NO edit, so its
 * text — including any interior comment — stays byte-exact.
 */
function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => jsonDeepEqual(item, b[index]))
    );
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(b, key) &&
      jsonDeepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

function jsoncEdit(
  adapter: ClientAdapter,
  entry: CanonicalEntry,
  content: string,
  shaped: RawEntry,
  plan: ActionPlan,
  existing?: RawEntry,
): JsoncNativeEdit {
  if (plan.mechanism === "native-flag") {
    const path = [adapter.rootKey, entry.name, adapter.nativeDisableFlag?.key ?? ""];
    const tree = parseTree(content);
    const flagPresent = tree !== undefined && findNodeAtLocation(tree, path) !== undefined;
    const edits = flagPresent ? replacementEdits(content, path, plan.flagValue) : insertionEdits(content, path, plan.flagValue);
    return { kind: "jsonc", path, value: plan.flagValue, edits };
  }
  if (plan.removes) {
    const path = [adapter.rootKey, entry.name];
    return { kind: "jsonc", path, value: undefined, edits: removalEdits(content, path) };
  }
  const path = [adapter.rootKey, entry.name];
  if (plan.mechanism === "update" && existing !== undefined) {
    // Story 33.5 QA: the update is PER-KEY surgery, never a whole-entry
    // re-render — a whole-value replace dropped every comment INSIDE the
    // owned entry and rewrote untouched keys' formatting. Only a key whose
    // merged value actually CHANGES is edited (replaced, or inserted when
    // newly managed); every other line of the entry stays byte-exact, the
    // TOML merge-update discipline. Falls back to the whole-value replace
    // when nothing differs (a genuine no-op keeps the historical render).
    const edits: JsoncEdit[] = [];
    for (const key of Object.keys(shaped)) {
      if (jsonDeepEqual(existing[key], shaped[key])) continue;
      const keyPath = [...path, key];
      edits.push(
        ...(Object.prototype.hasOwnProperty.call(existing, key)
          ? replacementEdits(content, keyPath, shaped[key])
          : insertionEdits(content, keyPath, shaped[key])),
      );
    }
    if (edits.length > 0) return { kind: "jsonc", path, value: shaped, edits };
  }
  const edits = plan.mechanism === "update" ? replacementEdits(content, path, shaped) : insertionEdits(content, path, shaped);
  return { kind: "jsonc", path, value: shaped, edits };
}

function tomlEdit(
  adapter: ClientAdapter,
  entry: CanonicalEntry,
  content: string,
  plan: ActionPlan,
  shaped: RawEntry,
  existing: RawEntry | undefined,
): TomlNativeEdit | { error: string } {
  const tablePath = [adapter.rootKey, entry.name];
  const region = findTomlEntryRegion(content, adapter.rootKey, entry.name);
  if (plan.mechanism === "native-flag") {
    // Codex `enabled` flag (verified 2026-07-27 — Story 33.1 Rule #16 probe):
    // replace the existing flag line when present (bounded to the MAIN table,
    // never the `.env` sub-table), else insert it directly after the owned
    // table header so the key belongs to the main table by construction.
    const flag = adapter.nativeDisableFlag;
    if (!flag) return { error: `adapter ${adapter.id} plans a native-flag edit but declares no nativeDisableFlag` };
    if (!region) {
      return {
        error: `entry "${entry.name}" is present per the TOML parser but no [${adapter.rootKey}.${entry.name}] table header could be located (unsupported TOML form — e.g. dotted-key definition or quoted table name); refusing to render a flag toggle`,
      };
    }
    const flagLine = `${tomlKey(flag.key)} = ${tomlScalar(plan.flagValue)}`;
    const keyRe = new RegExp(`^\\s*${flag.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
    const anyHeader = /^\s*\[/;
    const lines = content.split("\n");
    const topLevel = scanTomlStructure(content);
    for (let i = region.startLine + 1; i <= region.endLine; i++) {
      if (!topLevel[i]) continue; // string/array content is never a key line (AC 33.5.3)
      const line = lines[i] ?? "";
      if (anyHeader.test(line)) break; // sub-table header: main-table keys are above
      if (keyRe.test(line)) {
        return {
          kind: "toml-splice",
          op: "set-flag",
          tablePath,
          region: { startLine: i, endLine: i },
          insertAfterLine: null,
          insertText: flagLine,
        };
      }
    }
    return {
      kind: "toml-splice",
      op: "set-flag",
      tablePath,
      region: null,
      insertAfterLine: region.startLine,
      insertText: flagLine,
    };
  }
  if (plan.removes) {
    if (!region) {
      // Parser-present but no table header located (dotted-key definition,
      // quoted table name, …) — REFUSE rather than render a splice that
      // cannot target the entry (a silent no-op would report success while
      // the entry survives).
      return {
        error: `entry "${entry.name}" is present per the TOML parser but no [${adapter.rootKey}.${entry.name}] table header could be located (unsupported TOML form — e.g. dotted-key definition or quoted table name); refusing to render a removal`,
      };
    }
    return { kind: "toml-splice", op: "remove-region", tablePath, region, insertAfterLine: null, insertText: null };
  }
  if (plan.mechanism === "update") {
    if (!region) {
      // The parser says the entry EXISTS but no header region matched — an
      // insert would REDEFINE the table and produce invalid TOML. Refuse.
      return {
        error: `entry "${entry.name}" is present per the TOML parser but no [${adapter.rootKey}.${entry.name}] table header could be located (unsupported TOML form — e.g. dotted-key definition or quoted table name); refusing to render an update as an insert`,
      };
    }
    // AC 33.5.2: the update is a line-level surgery over manager-owned lines
    // ONLY — unmanaged keys, comments, and the native flag stay byte-exact.
    if (existing === undefined) {
      return { error: `internal: update planned for "${entry.name}" but no existing entry was parsed` };
    }
    return tomlMergeUpdate(adapter, entry, content, region, shaped, existing);
  }
  const block = serializeTomlEntry(adapter, entry);
  if (region) {
    return { kind: "toml-splice", op: "replace-region", tablePath, region, insertAfterLine: null, insertText: block };
  }
  const insertAfterLine = content.trim() === "" ? -1 : findTomlInsertLine(content, adapter.rootKey);
  return { kind: "toml-splice", op: "insert", tablePath, region: null, insertAfterLine, insertText: block };
}

// ════════════════════════════════════════════════════════════════════
// The apply-update TOML surgery (Story 33.5, AC 33.5.2 — lead-probed HIGH:
// the old replace-region dropped every unmanaged key on the owned table and
// stamped the native flag back to enabled). Only manager-owned LINES are
// touched: `command`/`args` (value spans, multi-line aware) and the env
// carrier (sub-table or inline form, merged key-wise so user extras
// survive). Everything else — unmanaged scalars, comments, the native flag,
// other sub-tables — stays byte-exact.
// ════════════════════════════════════════════════════════════════════

/** Render a parsed TOML value back to source form for the merged env
 * render. Datetime literals (smol-toml TomlDate) cannot round-trip (their
 * toString is a JS Date string, probe 2026-07-28) — null marks the
 * unsupported form and the caller REFUSES, never corrupts. */
function tomlSourceValue(value: unknown): string | null {
  if (typeof value === "string") return tomlString(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    const items: string[] = [];
    for (const item of value) {
      const rendered = tomlSourceValue(item);
      if (rendered === null) return null;
      items.push(rendered);
    }
    return `[${items.join(", ")}]`;
  }
  if (isRecord(value)) {
    const pairs: string[] = [];
    for (const [key, item] of Object.entries(value)) {
      const rendered = tomlSourceValue(item);
      if (rendered === null) return null;
      pairs.push(`${tomlKey(key)} = ${rendered}`);
    }
    return `{ ${pairs.join(", ")} }`;
  }
  return null; // TomlDate / undefined / functions — unsupported
}

/** A key line's value span: the key line itself plus its continuation lines
 * (a multi-line array/string value spans lines that are NOT top-level). */
function tomlKeySpan(
  lines: string[],
  topLevel: boolean[],
  fromLine: number,
  mainEnd: number,
  key: string,
): { startLine: number; endLine: number } | null {
  const keyLine = /^\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*=/;
  for (let i = fromLine; i <= mainEnd; i++) {
    if (!topLevel[i]) continue;
    const match = keyLine.exec(lines[i] ?? "");
    if (match !== null && (match[1] ?? match[2] ?? match[3]) === key) {
      let endLine = i;
      while (endLine + 1 <= mainEnd && !topLevel[endLine + 1]) endLine++;
      return { startLine: i, endLine };
    }
  }
  return null;
}

function tomlMergeUpdate(
  adapter: ClientAdapter,
  entry: CanonicalEntry,
  content: string,
  region: { startLine: number; endLine: number },
  fresh: RawEntry,
  existing: RawEntry,
): TomlNativeEdit | { error: string } {
  const lines = content.split("\n");
  const topLevel = scanTomlStructure(content);
  const tablePath = [adapter.rootKey, entry.name];
  const spans: { startLine: number; endLine: number; lines: string[] }[] = [];
  const refuse = (reason: string): { error: string } => ({ error: reason });

  // The MAIN table ends at the first sub-table header (or the region end).
  const anyHeader = /^\s*\[/;
  let mainEnd = region.endLine;
  for (let i = region.startLine + 1; i <= region.endLine; i++) {
    if (topLevel[i] && anyHeader.test(lines[i] ?? "")) {
      mainEnd = i - 1;
      break;
    }
  }

  // command — must stay a plain string line (a dotted/inline form is an
  // unsupported shape: refuse, never guess).
  if (existing.command !== undefined && typeof existing.command !== "string") {
    return refuse(
      `entry "${entry.name}" defines "command" in an unsupported TOML form (dotted keys or an inline table); refusing the update — restructure it as a plain \`command = "..."\` line`,
    );
  }
  const commandSpan = tomlKeySpan(lines, topLevel, region.startLine + 1, mainEnd, "command");
  const commandLine = `command = ${tomlString(String(fresh.command ?? ""))}`;
  // 33.5 review: skip the span when the value is UNCHANGED — re-rendering an
  // identical command dropped its trailing comment and re-formatted the line
  // for no reason (the JSONC/YAML per-key discipline: only changed keys are
  // touched). A changed value is still replaced wholesale — a trailing
  // comment on a CHANGED line is lost (documented seam, 33-5-R-ledger).
  const commandUnchanged = typeof existing.command === "string" && existing.command === String(fresh.command ?? "");
  if (commandSpan) {
    if (!commandUnchanged) spans.push({ ...commandSpan, lines: [commandLine] });
  } else {
    spans.push({ startLine: region.startLine + 1, endLine: region.startLine, lines: [commandLine] });
  }

  // args — same discipline (an existing non-array args is unsupported).
  if (existing.args !== undefined && !Array.isArray(existing.args)) {
    return refuse(
      `entry "${entry.name}" defines "args" in an unsupported TOML form (not an array); refusing the update — restructure it as \`args = [...]\``,
    );
  }
  const freshArgs = Array.isArray(fresh.args) ? fresh.args.map((arg) => tomlString(String(arg))).join(", ") : "";
  const argsSpan = tomlKeySpan(lines, topLevel, region.startLine + 1, mainEnd, "args");
  const argsLine = `args = [${freshArgs}]`;
  const argsUnchanged = Array.isArray(existing.args) && jsonDeepEqual(existing.args, fresh.args);
  if (argsSpan) {
    if (!argsUnchanged) spans.push({ ...argsSpan, lines: [argsLine] });
  } else {
    const after = commandSpan ? commandSpan.endLine : region.startLine;
    spans.push({ startLine: after + 1, endLine: after, lines: [argsLine] });
  }

  // env — merged KEY-WISE (existing extras survive) when the fresh render
  // carries env at all; untouched otherwise (the documented 33.5.2 seam).
  // 33.5 review: skip the env surgery when the merge is a no-op (fresh env
  // already ⊆ existing env) — re-rendering an unchanged env table dropped
  // its interior comments for zero effect.
  const mergedEnv: Record<string, unknown> | undefined = isRecord(fresh.env)
    ? { ...(isRecord(existing.env) ? (existing.env as Record<string, unknown>) : {}), ...fresh.env }
    : undefined;
  const envUnchanged = mergedEnv !== undefined && isRecord(existing.env) && jsonDeepEqual(existing.env, mergedEnv);
  if (mergedEnv !== undefined && !envUnchanged) {
    const envLines: string[] = [];
    for (const [key, value] of Object.entries(mergedEnv)) {
      const rendered = tomlSourceValue(value);
      if (rendered === null) {
        return refuse(
          `entry "${entry.name}" holds an env value in a TOML form the update cannot re-render (e.g. a datetime literal — its parsed form does not round-trip); refusing the update rather than corrupting the key`,
        );
      }
      envLines.push(`${tomlKey(key)} = ${rendered}`);
    }
    const envHeader = new RegExp(
      `^\\s*\\[\\s*${adapter.rootKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.${entry.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.env\\s*\\]\\s*(#.*)?$`,
    );
    let envTableStart = -1;
    let envTableEnd = -1;
    for (let i = region.startLine + 1; i <= region.endLine; i++) {
      if (!topLevel[i]) continue;
      if (envHeader.test(lines[i] ?? "")) {
        envTableStart = i;
        envTableEnd = i;
        for (let j = i + 1; j <= region.endLine; j++) {
          if (topLevel[j] && anyHeader.test(lines[j] ?? "")) break;
          envTableEnd = j;
        }
        break;
      }
    }
    // The env table's span stops at its last CONTENT line — trailing blanks
    // and comment lines before the next header belong to the following
    // section (the region-math convention), never to the replaced block.
    while (envTableEnd > envTableStart && topLevel[envTableEnd]) {
      const trimmed = (lines[envTableEnd] ?? "").trim();
      if (trimmed !== "" && !trimmed.startsWith("#")) break;
      envTableEnd--;
    }
    const envBlock = [`[${tablePath.map(tomlKey).join(".")}.env]`, ...envLines];
    if (envTableStart !== -1) {
      spans.push({ startLine: envTableStart, endLine: envTableEnd, lines: envBlock });
    } else {
      const inlineSpan = tomlKeySpan(lines, topLevel, region.startLine + 1, mainEnd, "env");
      if (inlineSpan) {
        // Inline form (`env = { A = "1" }`): replace with the merged inline render.
        const inlinePairs = envLines.join(", ");
        spans.push({ ...inlineSpan, lines: [`env = { ${inlinePairs} }`] });
      } else {
        spans.push({ startLine: region.endLine + 1, endLine: region.endLine, lines: ["", ...envBlock] });
      }
    }
  }

  return { kind: "toml-splice", op: "merge-update", tablePath, region, insertAfterLine: null, insertText: null, spans };
}

function yamlEdit(
  adapter: ClientAdapter,
  entry: CanonicalEntry,
  shaped: RawEntry,
  plan: ActionPlan,
  existing?: RawEntry,
): YamlNativeEdit {
  const basePath = [adapter.rootKey, entry.name];
  if (plan.mechanism === "native-flag") {
    return {
      kind: "yaml-cst",
      op: "set-flag",
      path: [...basePath, adapter.nativeDisableFlag?.key ?? ""],
      value: plan.flagValue ?? null,
      renderedEntry: null,
    };
  }
  if (plan.removes) {
    return { kind: "yaml-cst", op: "delete", path: basePath, value: null, renderedEntry: null };
  }
  const snippetDoc = new Document({ [entry.name]: shaped });
  const renderedEntry = snippetDoc.toString().trimEnd();
  if (plan.mechanism === "update" && existing !== undefined) {
    // Story 33.5 QA: per-key sets, never a whole-entry re-render (comments
    // INSIDE the owned entry survive — see YamlNativeEdit.ops). Falls back
    // to the whole-entry set when nothing differs.
    const ops: { path: string[]; value: unknown }[] = [];
    for (const key of Object.keys(shaped)) {
      if (jsonDeepEqual(existing[key], shaped[key])) continue;
      ops.push({ path: [...basePath, key], value: shaped[key] });
    }
    if (ops.length > 0) {
      return { kind: "yaml-cst", op: "merge-update", path: basePath, value: null, ops, renderedEntry };
    }
  }
  return {
    kind: "yaml-cst",
    op: "set",
    path: basePath,
    value: shaped,
    renderedEntry,
  };
}

function renderText(
  adapter: ClientAdapter,
  scope: ClientScope,
  action: DiffAction,
  plan: ActionPlan,
  entry: CanonicalEntry,
  shaped: RawEntry,
  native: NativeEdit | null,
): string {
  const lines: string[] = [];
  const header = `${action.toUpperCase()} ${entry.name} → ${adapter.displayName} (${scope} scope, ${adapter.format}, root key "${adapter.rootKey}")`;
  lines.push(header);
  switch (plan.mechanism) {
    case "already-in-state":
      lines.push(`No change: ${entry.name} is already in the requested state.`);
      return lines.join("\n");
    case "add":
      lines.push(`Add entry "${entry.name}" (not currently present).`);
      break;
    case "update":
      // AC 33.5.2: the confirm text surfaces the preservation contract.
      lines.push(
        `Update entry "${entry.name}" in place (currently present): manager-owned keys (command/args/env) are overwritten; ` +
          `unmanaged keys on the entry (e.g. autoApprove, timeout) and its enablement state are preserved.`,
      );
      break;
    case "stash-add":
      lines.push(`Re-add stashed entry "${entry.name}" (enable on a stash client).`);
      break;
    case "stash-remove":
      lines.push(`Remove entry "${entry.name}" (disable on a stash client; 33.1 preserves it in state.json).`);
      break;
    case "remove":
      lines.push(`Remove entry "${entry.name}" entirely (manager remove/purge).`);
      break;
    case "native-flag":
      lines.push(
        `Set ${adapter.nativeDisableFlag?.key ?? ""} = ${JSON.stringify(plan.flagValue)} on entry "${entry.name}" (native disable flag).`,
      );
      break;
  }
  if (native === null) {
    // Unreachable by construction (only already-in-state renders a null
    // descriptor and it returned above) — guard so the type stays honest.
    lines.push("(no edit descriptor rendered)");
    return lines.join("\n");
  }
  if (native.kind === "jsonc") {
    lines.push(`jsonc-parser edit set: ${native.edits.length} edit(s).`);
  } else if (native.kind === "toml-splice") {
    if (native.op === "insert") {
      lines.push(
        `Insert TOML block after line ${native.insertAfterLine === -1 ? "<file start>" : (native.insertAfterLine ?? 0) + 1}:`,
      );
    } else if (native.op === "set-flag") {
      lines.push(
        native.region
          ? `Replace line ${native.region.startLine + 1} with \`${native.insertText ?? ""}\`:`
          : `Insert \`${native.insertText ?? ""}\` after the [${native.tablePath.join(".")}] table header:`,
      );
    } else if (native.op === "merge-update") {
      lines.push(`Update ${native.spans?.length ?? 0} manager-owned line span(s) in the [${native.tablePath.join(".")}] table:`);
    } else if (native.region) {
      lines.push(`${native.op === "remove-region" ? "Remove" : "Replace"} lines ${native.region.startLine + 1}–${native.region.endLine + 1}:`);
    }
  } else {
    lines.push(`YAML CST op "${native.op}" at ${native.path.join(".")}.`);
  }
  // Show ONLY the owned entry's rendered form — never other entries.
  if (plan.setsEntry) {
    if (native.kind === "toml-splice" && native.op === "merge-update") {
      for (const span of native.spans ?? []) lines.push(...span.lines);
    } else if (native.kind === "toml-splice" && native.insertText !== null) {
      lines.push(native.insertText);
    } else if (native.kind === "yaml-cst" && native.renderedEntry !== null) {
      lines.push(native.renderedEntry);
    } else {
      lines.push(JSON.stringify({ [entry.name]: shaped }, null, 2));
    }
  }
  return lines.join("\n");
}

// Re-exported for consumers that only import the diff module (33.1's apply
// path needs the same RawEntry shape the readers produce).
export type { RawEntry };
