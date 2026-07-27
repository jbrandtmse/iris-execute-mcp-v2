/**
 * `@iris-mcp/client-config` â€” pure pending-edit renderer (Epic 33, Story 33.0).
 *
 * `diff(currentContent, entry, adapter, scope, action)` renders the EXACT
 * edit a hypothetical apply/enable/disable would make â€” WITHOUT writing
 * anything (AC 33.0.3). This is the renderer Story 33.1's confirm flow
 * consumes (the Rule #52 seam: 33.1 owns APPLYING these edits â€” jsonc-parser
 * applyEdits, TOML text splices, YAML CST writes â€” plus backups, state.json
 * stash, and entry synthesis; this story's output is directly executable by
 * that apply path and must not be redesigned there).
 *
 * Purity contract: no fs, no clock, no env â€” identical inputs â‡’ identical
 * output. The rendered edit NEVER contains foreign third-party entries
 * (AC 33.0.4): every edit targets exactly the owned
 * `<rootKey>.<canonicalName>` node, and the text render shows only the owned
 * entry â€” never other entries' names or values (spec Â§3.5.5).
 */

import { modify, parseTree, findNodeAtLocation, type Edit as JsoncEdit } from "jsonc-parser";
import { Document } from "yaml";

import { readConfigEntries, type RawEntry } from "./readers.js";
import type { CanonicalEntry, ClientAdapter, ClientScope } from "./types.js";

export type DiffAction = "apply" | "enable" | "disable";

export type DiffMechanism =
  | "add" // apply: entry absent â†’ insert
  | "update" // apply: entry present â†’ replace value
  | "native-flag" // enable/disable via the client's own flag
  | "stash-add" // enable on a stash client with the entry absent â†’ insert
  | "stash-remove" // disable on a stash client â†’ remove the entry
  | "already-in-state"; // requested state already holds â†’ empty edit

/** JSON/JSONC edit â€” directly executable via jsonc-parser `applyEdits`. */
export interface JsoncNativeEdit {
  kind: "jsonc";
  /** The jsonc-parser modify path (rootKey + entry name [+ flag key]). */
  path: string[];
  /** The value set; `undefined` means property removal. */
  value: unknown;
  /** The exact edit set jsonc-parser computed (offsets/length/new content). */
  edits: JsoncEdit[];
}

/** TOML edit â€” a text-splice region descriptor over owned
 * `[mcp_servers.<name>]` tables ONLY (33.1 splices text; serializers are
 * ruled out because they drop comments elsewhere in the file, spec Â§3.5). */
export interface TomlNativeEdit {
  kind: "toml-splice";
  op: "insert" | "replace-region" | "remove-region";
  /** Owned table path, e.g. ["mcp_servers", "iris-dev-mcp"]. */
  tablePath: string[];
  /** 0-based inclusive line range to replace/remove; null for op "insert". */
  region: { startLine: number; endLine: number } | null;
  /** For "insert": append the block after this 0-based line (-1 = file start). */
  insertAfterLine: number | null;
  /** The TOML block for insert/replace; null for "remove-region". */
  insertText: string | null;
}

/** YAML edit â€” a CST operation 33.1 executes via the yaml Document API. */
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
       * The executable edit descriptor â€” `null` EXACTLY when `mechanism` is
       * `"already-in-state"` (there is no edit to apply). Consumers MUST
       * branch on `mechanism` before executing: rendering a no-op as a
       * descriptor would invite a consumer to execute it (a YAML `set` of
       * `null` DESTROYS the entry; a TOML null-field "insert" splices stray
       * blank lines) â€” `null` makes the no-op unexecutable by construction.
       */
      native: NativeEdit | null;
      /** Human-readable render (owned entry only â€” safe to print). */
      text: string;
    }
  | { ok: false; client: string; scope: ClientScope; action: DiffAction; reason: string };

/** Render the canonical entry into the adapter's native entry shape. */
export function renderNativeEntry(adapter: ClientAdapter, entry: CanonicalEntry): RawEntry {
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

/** Serialize the owned entry as a Codex `[mcp_servers.<name>]` TOML block. */
export function serializeTomlEntry(adapter: ClientAdapter, entry: CanonicalEntry): string {
  const shaped = renderNativeEntry(adapter, entry);
  const lines: string[] = [];
  lines.push(`[${adapter.rootKey}.${entry.name}]`);
  lines.push(`command = ${tomlString(entry.command)}`);
  const args = (shaped.args as string[]).map(tomlString).join(", ");
  lines.push(`args = [${args}]`);
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
 * the trailing run of blank AND comment lines excluded â€” a comment block
 * immediately preceding the next header belongs to the FOLLOWING section
 * (TOML comment convention), never to the owned tables. A comment ABOVE the
 * owned header is likewise outside the region (left in place on removal â€”
 * documented v1 choice). A trailing comment ON the owned header line itself
 * (`[root.name] # managed by iris-mcp`) is legal TOML and stays INSIDE the
 * region (it belongs to the owned table). Returns null when the entry is
 * absent â€” OR when it exists only in a form with no table header (e.g.
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
 * the last section â€” inserting before them would split them off). */
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
  }
}

/**
 * Render the pending edit for a hypothetical apply/enable/disable. PURE:
 * no fs, no clock, no env â€” identical inputs â‡’ identical output.
 * `currentContent` is the config file's current text (`null` = file does not
 * exist yet â€” an apply creates it).
 */
export function diff(
  currentContent: string | null,
  entry: CanonicalEntry,
  adapter: ClientAdapter,
  scope: ClientScope,
  action: DiffAction,
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

  const shaped = renderNativeEntry(adapter, entry);
  // already-in-state renders NO descriptor (native: null) â€” see DiffResult.
  let native: NativeEdit | null = null;
  if (plan.mechanism !== "already-in-state") {
    if (adapter.format === "toml") {
      const edit = tomlEdit(adapter, entry, content, plan);
      if ("error" in edit) return fail(edit.error);
      native = edit;
    } else if (adapter.format === "yaml") {
      native = yamlEdit(adapter, entry, shaped, plan);
    } else {
      native = jsoncEdit(adapter, entry, content, shaped, plan);
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
 * neighboring property â€” its edit content then carries an adjacent (possibly
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
    i++;
    while (i < content.length && (content[i] === " " || content[i] === "\t")) i++;
    if (content[i] === "\r" && content[i + 1] === "\n") i += 2;
    else if (content[i] === "\n") i++;
    while (i < content.length && (content[i] === " " || content[i] === "\t")) i++;
    end = i;
  } else {
    // Last property: swallow the PRECEDING comma instead.
    let j = start - 1;
    while (j >= 0 && /\s/.test(content[j] ?? "")) j--;
    if (content[j] === ",") start = j;
  }
  return [{ offset: start, length: end - start, content: "" }];
}

function jsoncEdit(
  adapter: ClientAdapter,
  entry: CanonicalEntry,
  content: string,
  shaped: RawEntry,
  plan: ActionPlan,
): JsoncNativeEdit {
  const formattingOptions = { tabSize: 2, insertSpaces: true, eol: "\n" };
  if (plan.mechanism === "native-flag") {
    const path = [adapter.rootKey, entry.name, adapter.nativeDisableFlag?.key ?? ""];
    const edits = modify(content, path, plan.flagValue, { formattingOptions });
    return { kind: "jsonc", path, value: plan.flagValue, edits };
  }
  if (plan.removes) {
    const path = [adapter.rootKey, entry.name];
    return { kind: "jsonc", path, value: undefined, edits: removalEdits(content, path) };
  }
  const path = [adapter.rootKey, entry.name];
  const edits = modify(content, path, shaped, { formattingOptions });
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
  if (plan.removes) {
    if (!region) {
      // Parser-present but no table header located (dotted-key definition,
      // quoted table name, â€¦) â€” REFUSE rather than render a splice that
      // cannot target the entry (a silent no-op would report success while
      // the entry survives).
      return {
        error: `entry "${entry.name}" is present per the TOML parser but no [${adapter.rootKey}.${entry.name}] table header could be located (unsupported TOML form â€” e.g. dotted-key definition or quoted table name); refusing to render a removal`,
      };
    }
    return { kind: "toml-splice", op: "remove-region", tablePath, region, insertAfterLine: null, insertText: null };
  }
  const block = serializeTomlEntry(adapter, entry);
  if (region) {
    return { kind: "toml-splice", op: "replace-region", tablePath, region, insertAfterLine: null, insertText: block };
  }
  if (plan.mechanism === "update") {
    // The parser says the entry EXISTS but no header region matched â€” an
    // insert would REDEFINE the table and produce invalid TOML. Refuse.
    return {
      error: `entry "${entry.name}" is present per the TOML parser but no [${adapter.rootKey}.${entry.name}] table header could be located (unsupported TOML form â€” e.g. dotted-key definition or quoted table name); refusing to render an update as an insert`,
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
  const header = `${action.toUpperCase()} ${entry.name} â†’ ${adapter.displayName} (${scope} scope, ${adapter.format}, root key "${adapter.rootKey}")`;
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
    case "native-flag":
      lines.push(
        `Set ${adapter.nativeDisableFlag?.key ?? ""} = ${JSON.stringify(plan.flagValue)} on entry "${entry.name}" (native disable flag).`,
      );
      break;
  }
  if (native === null) {
    // Unreachable by construction (only already-in-state renders a null
    // descriptor and it returned above) â€” guard so the type stays honest.
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
    } else if (native.region) {
      lines.push(`${native.op === "remove-region" ? "Remove" : "Replace"} lines ${native.region.startLine + 1}â€“${native.region.endLine + 1}:`);
    }
  } else {
    lines.push(`YAML CST op "${native.op}" at ${native.path.join(".")}.`);
  }
  // Show ONLY the owned entry's rendered form â€” never other entries.
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
