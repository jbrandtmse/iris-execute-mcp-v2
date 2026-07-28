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

import { readConfigEntries, type RawEntry } from "./readers.js";
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
  op: "insert" | "replace-region" | "remove-region" | "set-flag";
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
   * (e.g. `enabled = false`); null for "remove-region". */
  insertText: string | null;
}

/** YAML edit — a CST operation 33.1 executes via the yaml Document API. */
export interface YamlNativeEdit {
  kind: "yaml-cst";
  op: "set" | "delete" | "set-flag";
  /** Node path under the document root. */
  path: string[];
  /** The entry (op "set") or flag value (op "set-flag"); null for "delete". */
  value: unknown;
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

/** Quote a TOML basic string. */
function tomlString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
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
  lines.push(`[${adapter.rootKey}.${entry.name}]`);
  lines.push(`command = ${tomlString(entry.command)}`);
  const args = (shaped.args as string[]).map(tomlString).join(", ");
  lines.push(`args = [${args}]`);
  // A native-flag client's flag is rendered explicitly at its enabled value
  // (e.g. `enabled = true` for Codex) — see renderNativeEntry.
  const flag = adapter.nativeDisableFlag;
  if (flag) lines.push(`${flag.key} = ${tomlScalar(shaped[flag.key] ?? flag.enabledValue)}`);
  const env = shaped.env as Record<string, string> | undefined;
  if (env) {
    lines.push("");
    lines.push(`[${adapter.rootKey}.${entry.name}.env]`);
    for (const [key, value] of Object.entries(env)) {
      lines.push(`${key} = ${tomlString(value)}`);
    }
  }
  return lines.join("\n");
}

/** Find the owned `[<rootKey>.<name>]`(+sub-table) line region, 0-based
 * inclusive. The region ends before the next non-owned table header, with
 * the trailing run of blank AND comment lines excluded — a comment block
 * immediately preceding the next header belongs to the FOLLOWING section
 * (TOML comment convention), never to the owned tables. A comment ABOVE the
 * owned header is likewise outside the region (left in place on removal —
 * documented v1 choice). A trailing comment ON the owned header line itself
 * (`[root.name] # managed by iris-mcp`) is legal TOML and stays INSIDE the
 * region (it belongs to the owned table). Returns null when the entry is
 * absent — OR when it exists only in a form with no table header (e.g.
 * dotted-key definitions or quoted table names; callers treat a parser-present
 * but region-less entry as a REFUSAL, never an insert/removal guess). */
export function findTomlEntryRegion(
  content: string,
  rootKey: string,
  name: string,
): { startLine: number; endLine: number } | null {
  const lines = content.split("\n");
  const escapedRoot = rootKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownedHeader = new RegExp(`^\\s*\\[\\s*${escapedRoot}\\.${escapedName}(\\..+)?\\]\\s*(#.*)?$`);
  const anyHeader = /^\s*\[/;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (start === -1) {
      if (ownedHeader.test(lines[i] ?? "")) start = i;
      continue;
    }
    const line = lines[i] ?? "";
    if (anyHeader.test(line) && !ownedHeader.test(line)) {
      return { startLine: start, endLine: trimRegionEnd(lines, start, i - 1) };
    }
  }
  if (start === -1) return null;
  return { startLine: start, endLine: trimRegionEnd(lines, start, lines.length - 1) };
}

/** Region end: trim the trailing run of blank and whole-line comment lines. */
function trimRegionEnd(lines: string[], start: number, end: number): number {
  let e = end;
  while (e > start) {
    const trimmed = (lines[e] ?? "").trim();
    if (trimmed !== "" && !trimmed.startsWith("#")) break;
    e--;
  }
  return e;
}

/** Insert-point end: trim trailing blank lines only (comments may belong to
 * the last section — inserting before them would split them off). */
function trimTrailingBlank(lines: string[], start: number, end: number): number {
  let e = end;
  while (e > start && (lines[e] ?? "").trim() === "") e--;
  return e;
}

/** Line index after which a NEW `[<rootKey>.*]` block should be inserted:
 * the end of the last existing `<rootKey>` table, else end of file. */
export function findTomlInsertLine(content: string, rootKey: string): number {
  const lines = content.split("\n");
  const escapedRoot = rootKey.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rootHeader = new RegExp(`^\\s*\\[\\s*${escapedRoot}(\\..+)?\\]\\s*(#.*)?$`);
  const anyHeader = /^\s*\[/;
  let insertAfter = lines.length - 1;
  let inRoot = false;
  let rootEnd = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (anyHeader.test(line)) {
      if (inRoot) rootEnd = i - 1;
      inRoot = rootHeader.test(line);
    }
  }
  if (inRoot) rootEnd = lines.length - 1;
  if (rootEnd !== -1) insertAfter = trimTrailingBlank(lines, 0, rootEnd);
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
  if (content.trim() !== "") {
    const parsed = readConfigEntries(adapter, content);
    if (!parsed.ok) return fail(`config is unparseable: ${parsed.error}`);
    const existing = parsed.entries[entry.name];
    present = existing !== undefined;
    if (present && adapter.nativeDisableFlag && existing) {
      disabled = existing[adapter.nativeDisableFlag.key] === adapter.nativeDisableFlag.disabledValue;
    }
  }

  const plan = planAction(adapter, entry, action, present, disabled);
  if ("error" in plan) return fail(plan.error);

  const shaped = options?.nativeEntry ?? renderNativeEntry(adapter, entry);
  // already-in-state renders NO descriptor (native: null) — see DiffResult.
  let native: NativeEdit | null = null;
  if (plan.mechanism !== "already-in-state") {
    if (adapter.format === "toml") {
      const edit = tomlEdit(adapter, entry, content, plan);
      if ("error" in edit) return fail(edit.error);
      native = edit;
    } else if (adapter.format === "yaml") {
      native = yamlEdit(adapter, entry, shaped, plan);
    } else {
      const edit = jsoncEdit(adapter, entry, content, shaped, plan);
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
    // Last property: swallow the PRECEDING comma instead.
    let j = start - 1;
    while (j >= 0 && /\s/.test(content[j] ?? "")) j--;
    if (content[j] === ",") start = j;
  }
  return [{ offset: start, length: end - start, content: "" }];
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
  if (!tree) return [];
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

function jsoncEdit(
  adapter: ClientAdapter,
  entry: CanonicalEntry,
  content: string,
  shaped: RawEntry,
  plan: ActionPlan,
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
  const edits = plan.mechanism === "update" ? replacementEdits(content, path, shaped) : insertionEdits(content, path, shaped);
  return { kind: "jsonc", path, value: shaped, edits };
}

function tomlEdit(
  adapter: ClientAdapter,
  entry: CanonicalEntry,
  content: string,
  plan: ActionPlan,
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
    const flagLine = `${flag.key} = ${tomlScalar(plan.flagValue)}`;
    const keyRe = new RegExp(`^\\s*${flag.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`);
    const anyHeader = /^\s*\[/;
    const lines = content.split("\n");
    for (let i = region.startLine + 1; i <= region.endLine; i++) {
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
  const block = serializeTomlEntry(adapter, entry);
  if (region) {
    return { kind: "toml-splice", op: "replace-region", tablePath, region, insertAfterLine: null, insertText: block };
  }
  if (plan.mechanism === "update") {
    // The parser says the entry EXISTS but no header region matched — an
    // insert would REDEFINE the table and produce invalid TOML. Refuse.
    return {
      error: `entry "${entry.name}" is present per the TOML parser but no [${adapter.rootKey}.${entry.name}] table header could be located (unsupported TOML form — e.g. dotted-key definition or quoted table name); refusing to render an update as an insert`,
    };
  }
  const insertAfterLine = content.trim() === "" ? -1 : findTomlInsertLine(content, adapter.rootKey);
  return { kind: "toml-splice", op: "insert", tablePath, region: null, insertAfterLine, insertText: block };
}

function yamlEdit(
  adapter: ClientAdapter,
  entry: CanonicalEntry,
  shaped: RawEntry,
  plan: ActionPlan,
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
  return {
    kind: "yaml-cst",
    op: "set",
    path: basePath,
    value: shaped,
    renderedEntry: snippetDoc.toString().trimEnd(),
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
      lines.push(`Replace entry "${entry.name}" (currently present).`);
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
    } else if (native.region) {
      lines.push(`${native.op === "remove-region" ? "Remove" : "Replace"} lines ${native.region.startLine + 1}–${native.region.endLine + 1}:`);
    }
  } else {
    lines.push(`YAML CST op "${native.op}" at ${native.path.join(".")}.`);
  }
  // Show ONLY the owned entry's rendered form — never other entries.
  if (plan.setsEntry) {
    if (native.kind === "toml-splice" && native.insertText !== null) {
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
