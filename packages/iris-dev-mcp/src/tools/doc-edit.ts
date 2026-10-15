/**
 * Surgical line edits for the IRIS Development MCP server.
 *
 * {@link docEditTool} changes a few lines of an existing document without
 * resending the whole text. It reads the document once, checks every edit's
 * `expected` text against what it read, applies all edits bottom-up, and saves
 * them in one version-checked write. It answers from a re-read: a unified diff,
 * an excerpt of each edit, and the new line count.
 *
 * Lines are numbered as `iris_doc_get` numbers them (see `documentLines` in
 * `@iris-mcp/shared`), and every split, join and diff goes through the shared
 * line utility.
 */

import {
  alignLines,
  atelierDocStatusError,
  atelierPath,
  DIFF_CONTEXT_LINES,
  droppedStorageDefinitions,
  formatNumberedLines,
  IrisApiError,
  isClassDocument,
  joinLines,
  REFUSAL_CODES,
  refusalResult,
  storageDroppedRefusal,
  textToLines,
  unifiedDiff,
  type AtelierEnvelope,
  type ToolDefinition,
  type ToolResult,
} from "@iris-mcp/shared";
import { z } from "zod";
import {
  readTextDocument,
  unreadableDocumentText,
  validateDocName,
  type DocGetResult,
  type TextDocumentRead,
} from "./doc.js";

// -- Edits -----------------------------------------------------------

/** The three line operations. */
export type EditOp = "insert" | "delete" | "replace";

/** One edit as the caller sends it. Line numbers address the document as the tool reads it. */
export interface LineEdit {
  op: EditOp;
  /** Insert only: the text goes after this line; 0 puts it before line 1. */
  afterLine?: number;
  /** Delete and replace: the first line addressed. */
  startLine?: number;
  /** Delete and replace: the last line addressed (inclusive). */
  endLine?: number;
  /** Insert and replace: the new text (see `textToLines`). */
  text?: string;
  /** The current text of the addressed lines (of line `afterLine`, or line 1, for an insert). */
  expected: string;
}

type EditField = "afterLine" | "startLine" | "endLine" | "text" | "expected";

/** The fields each op takes, in the order the usage text names them. */
const OP_FIELDS: Record<EditOp, readonly EditField[]> = {
  insert: ["afterLine", "text", "expected"],
  delete: ["startLine", "endLine", "expected"],
  replace: ["startLine", "endLine", "text", "expected"],
};

/** Every field an edit can carry, in the order a surplus field is reported. */
const ALL_FIELDS: readonly EditField[] = ["afterLine", "startLine", "endLine", "text", "expected"];

/** `An insert takes afterLine, text and expected` (no closing period). */
function usage(op: EditOp): string {
  const fields = OP_FIELDS[op];
  const list = `${fields.slice(0, -1).join(", ")} and ${fields[fields.length - 1]}`;
  return `${op === "insert" ? "An" : "A"} ${op} takes ${list}`;
}

/** The edit in the read's numbering: `insert after line <a>`, `delete lines <s>-<e>` or `replace lines <s>-<e>`. */
function describeEdit(edit: LineEdit): string {
  return edit.op === "insert"
    ? `insert after line ${edit.afterLine}`
    : `${edit.op} lines ${edit.startLine}-${edit.endLine}`;
}

/** The first and last line an edit addresses; an insert addresses its anchor, line `afterLine` (line 1 when 0). */
function addressedLines(edit: LineEdit): { first: number; last: number } {
  if (edit.op === "insert") {
    const anchor = Math.max(edit.afterLine as number, 1);
    return { first: anchor, last: anchor };
  }
  return { first: edit.startLine as number, last: edit.endLine as number };
}

/** The 0-based index at which an edit starts in the read's lines; ties order an insert before a range. */
function readPosition(edit: LineEdit): number {
  return edit.op === "insert" ? (edit.afterLine as number) : (edit.startLine as number) - 1;
}

/** Whether an insert after line `afterLine` falls between two lines of `range`. */
function insideRange(afterLine: number, range: LineEdit): boolean {
  return (range.startLine as number) <= afterLine && afterLine < (range.endLine as number);
}

/** Whether two edits address the same lines or the same position. */
function overlaps(a: LineEdit, b: LineEdit): boolean {
  if (a.op === "insert" && b.op === "insert") return a.afterLine === b.afterLine;
  if (a.op === "insert") return insideRange(a.afterLine as number, b);
  if (b.op === "insert") return insideRange(b.afterLine as number, a);
  return (
    (a.startLine as number) <= (b.endLine as number) && (b.startLine as number) <= (a.endLine as number)
  );
}

/** Edit numbers (1-based) in read order: by start position, an insert before a range at the same position. */
function readOrder(edits: readonly LineEdit[]): number[] {
  return edits
    .map((edit, index) => index)
    .sort((x, y) => {
      const a = edits[x] as LineEdit;
      const b = edits[y] as LineEdit;
      const byPosition = readPosition(a) - readPosition(b);
      if (byPosition !== 0) return byPosition;
      if (a.op === "insert" && b.op !== "insert") return -1;
      if (a.op !== "insert" && b.op === "insert") return 1;
      return x - y;
    });
}

/**
 * Check the edits that need no document: every edit carries the fields its op takes and no others,
 * `startLine` is not after `endLine`, and no two edits address the same lines.
 *
 * @param edits - The edits as the caller sent them.
 * @returns The error text for the first problem (`<what happened>. <what to do about it>.`), or
 *   `undefined` when the edits are well formed.
 */
export function validateEdits(edits: readonly LineEdit[]): string | undefined {
  for (const [index, edit] of edits.entries()) {
    const number = index + 1;
    const takes = OP_FIELDS[edit.op];
    for (const field of takes) {
      if (edit[field] === undefined) {
        return `Edit ${number} (${edit.op}) is missing ${field}. ${usage(edit.op)}.`;
      }
    }
    for (const field of ALL_FIELDS) {
      if (!takes.includes(field) && edit[field] !== undefined) {
        return `Edit ${number} (${edit.op}) does not take ${field}. ${usage(edit.op)}.`;
      }
    }
    if (edit.op !== "insert" && (edit.startLine as number) > (edit.endLine as number)) {
      return (
        `Edit ${number} (${edit.op}): startLine ${edit.startLine} is after endLine ${edit.endLine}. ` +
        "Pass a startLine that is less than or equal to endLine."
      );
    }
  }

  const order = readOrder(edits);
  for (const [position, x] of order.entries()) {
    for (const y of order.slice(position + 1)) {
      const a = edits[x] as LineEdit;
      const b = edits[y] as LineEdit;
      if (overlaps(a, b)) {
        return (
          `Edits ${x + 1} and ${y + 1} overlap: ${describeEdit(a)} and ${describeEdit(b)} address the same lines. ` +
          "Combine them into one edit, or address lines that do not overlap."
        );
      }
    }
  }
  return undefined;
}

/**
 * Check that every edit addresses lines the document has.
 *
 * @param edits - Well-formed edits (see {@link validateEdits}).
 * @param name - The document name, for the text.
 * @param totalLines - The document's line count.
 * @returns The error text for the first edit past the last line, or `undefined`.
 */
function checkRange(edits: readonly LineEdit[], name: string, totalLines: number): string | undefined {
  for (const [index, edit] of edits.entries()) {
    const { first, last } = addressedLines(edit);
    const past = first > totalLines ? first : last > totalLines ? last : undefined;
    if (past !== undefined) {
      return (
        `Edit ${index + 1} (${edit.op}) addresses line ${past}, but document '${name}' has ${totalLines} lines. ` +
        `Read the lines again with iris_doc_get and address lines 1 to ${totalLines}.`
      );
    }
  }
  return undefined;
}

/** An edit whose `expected` text does not match the document as it is now. */
export interface StaleEdit {
  /** The edit's 1-based number in the call. */
  edit: number;
  op: EditOp;
  /** The first line the edit addresses (the anchor line for an insert). */
  startLine: number;
  /** The last line the edit addresses (the anchor line for an insert). */
  endLine: number;
  /** The document's lines at `startLine` to `endLine` now. */
  current: string[];
  description: string;
}

/**
 * The edits whose `expected` text differs from the document's lines, compared line by line after
 * `textToLines`, so a wrong text and a wrong line count are both a mismatch.
 *
 * @param edits - Well-formed edits whose lines exist in `lines` (see {@link validateEdits}).
 * @param lines - The document's lines as the tool read them.
 * @returns The mismatches in edit order; empty when every edit matches.
 */
export function findStaleEdits(edits: readonly LineEdit[], lines: readonly string[]): StaleEdit[] {
  const stale: StaleEdit[] = [];
  for (const [index, edit] of edits.entries()) {
    const { first, last } = addressedLines(edit);
    const current = lines.slice(first - 1, last);
    const expected = textToLines(edit.expected);
    if (current.length !== expected.length || current.some((line, i) => line !== expected[i])) {
      stale.push({
        edit: index + 1,
        op: edit.op,
        startLine: first,
        endLine: last,
        current,
        description: describeEdit(edit),
      });
    }
  }
  return stale;
}

/** Where an edit's lines sit in the edited array. */
export interface EditRegion {
  /** The 0-based index of the first line the edit produced. */
  start: number;
  /** How many lines the edit produced (0 for a delete). */
  length: number;
}

/**
 * Apply every edit to `lines`, bottom-up, so each edit's line numbers keep their meaning in the
 * numbering of the read.
 *
 * @param edits - Well-formed, non-overlapping edits whose lines exist in `lines`, in any order.
 * @param lines - The document's lines as the tool read them; never mutated.
 * @returns The edited lines, and for each edit (in the order of `edits`) the region of the edited
 *   array that its text occupies.
 */
export function applyEdits(
  edits: readonly LineEdit[],
  lines: readonly string[],
): { lines: string[]; regions: EditRegion[] } {
  const placed = edits.map((edit) => ({
    start: readPosition(edit),
    removed: edit.op === "insert" ? 0 : (edit.endLine as number) - (edit.startLine as number) + 1,
    text: edit.op === "delete" ? [] : textToLines(edit.text as string),
  }));
  const order = readOrder(edits);

  let edited = [...lines];
  for (const index of [...order].reverse()) {
    const edit = placed[index] as (typeof placed)[number];
    edited = edited.slice(0, edit.start).concat(edit.text, edited.slice(edit.start + edit.removed));
  }

  const regions: EditRegion[] = new Array<EditRegion>(edits.length);
  let shift = 0;
  for (const index of order) {
    const edit = placed[index] as (typeof placed)[number];
    regions[index] = { start: edit.start + shift, length: edit.text.length };
    shift += edit.text.length - edit.removed;
  }
  return { lines: edited, regions };
}

// -- Results ---------------------------------------------------------

/** An argument, range or read error: `isError: true`, no structured code, nothing changed. */
function failure(text: string): ToolResult {
  return { content: [{ type: "text", text }], isError: true };
}

/** One edit's excerpt of the re-read document. */
interface Excerpt {
  edit: number;
  op: EditOp;
  startLine: number;
  endLine: number;
  lines: string[];
}

/** The refusal for edits whose `expected` text no longer matches: every mismatch with its current text. */
function staleRefusal(
  name: string,
  ns: string,
  ts: string,
  totalLines: number,
  stale: readonly StaleEdit[],
): ToolResult {
  const subject =
    stale.length === 1
      ? `the expected text of edit ${stale[0]?.edit} does not match`
      : `the expected text of edits ${stale.map((entry) => entry.edit).join(", ")} do not match`;
  const sections = stale.map((entry) => {
    const heading =
      entry.op === "insert"
        ? `Edit ${entry.edit} (${entry.description}), current text of line ${entry.startLine}:`
        : `Edit ${entry.edit} (${entry.description}), current text:`;
    return `\n\n${heading}\n${formatNumberedLines(entry.current, entry.startLine)}`;
  });
  const text =
    `Document '${name}' was not changed in namespace '${ns}': ${subject} the document now. ` +
    "Nothing was stored. Retry with the current text below as expected, or read the lines again with iris_doc_get." +
    sections.join("");
  return refusalResult(REFUSAL_CODES.STALE_CONTENT, text, {
    name,
    namespace: ns,
    ts,
    totalLines,
    mismatches: stale.map((entry) => ({
      edit: entry.edit,
      op: entry.op,
      startLine: entry.startLine,
      endLine: entry.endLine,
      current: joinLines(entry.current),
    })),
  });
}

/**
 * The part of the re-read document an edit produced: the lines between the nearest line above and
 * the nearest line below the edit's region that survive from the edited array into the re-read one.
 * When IRIS stored the text as sent, every line survives and this is exactly the edit's region.
 *
 * @returns The half-open 0-based range `[start, end)` of the re-read lines.
 */
function regionInReread(
  pairs: ReadonlyArray<readonly [number, number]>,
  region: EditRegion,
  rereadLength: number,
): [number, number] {
  const end = region.start + region.length;
  let above = -1;
  let below = rereadLength;
  for (const [editedLine, rereadLine] of pairs) {
    const index = editedLine - 1;
    if (index < region.start) {
      above = rereadLine - 1;
    } else if (index >= end) {
      below = rereadLine - 1;
      break;
    }
  }
  return [above + 1, below];
}

/** The excerpt of `lines` around the half-open region `[start, end)`: the region and its context lines, clamped. */
function excerptAround(
  number: number,
  edit: LineEdit,
  lines: readonly string[],
  start: number,
  end: number,
): Excerpt {
  const first = Math.max(0, start - DIFF_CONTEXT_LINES);
  const last = Math.min(lines.length, end + DIFF_CONTEXT_LINES);
  return { edit: number, op: edit.op, startLine: first + 1, endLine: last, lines: lines.slice(first, last) };
}

/** `Edit <i> (<description>), now lines <x>-<y>:` and the numbered excerpt. */
function excerptSection(edit: LineEdit, excerpt: Excerpt): string {
  return (
    `\n\nEdit ${excerpt.edit} (${describeEdit(edit)}), now lines ${excerpt.startLine}-${excerpt.endLine}:\n` +
    formatNumberedLines(excerpt.lines, excerpt.startLine)
  );
}

/** `1 edit applied` or `<n> edits applied`. */
function appliedCount(count: number): string {
  return `${count} ${count === 1 ? "edit" : "edits"} applied`;
}

// -- iris_doc_edit ---------------------------------------------------

/** The closing sentence of the refusal for an apply that drops Storage definitions. */
const EDIT_STORAGE_REMEDY =
  "Keep the Storage definitions in the edited lines, or run the same edits with action regenerateStorage " +
  "(disabled unless an operator enables it) to let IRIS regenerate the storage.";

const editSchema = z.object({
  op: z.enum(["insert", "delete", "replace"]).describe(
    "The operation. insert: add text after line afterLine. delete: remove lines startLine to endLine. " +
      "replace: replace lines startLine to endLine with text.",
  ),
  afterLine: z.coerce
    .number()
    .int()
    .min(0)
    .optional()
    .describe(
      "Insert only: the text goes after this line, 1-based (0 puts it before line 1). " +
        "Line numbers are those of `iris_doc_get` for the same document.",
    ),
  startLine: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Delete and replace: the first line addressed, 1-based and inclusive."),
  endLine: z.coerce
    .number()
    .int()
    .min(1)
    .optional()
    .describe("Delete and replace: the last line addressed, 1-based and inclusive (not before startLine)."),
  text: z
    .string()
    .optional()
    .describe(
      "Insert and replace: the new text. One leading byte-order mark and one trailing line break are ignored, and CRLF " +
        "and LF both separate lines. An empty text is one empty line; to remove lines use delete.",
    ),
  expected: z
    .string()
    .describe(
      "The current text of the lines this edit addresses (for an insert, of line afterLine, or of line 1 when afterLine is 0), " +
        "parsed like text. If it does not match the document now, nothing is changed. Make it distinctive when a line such as `}` is not unique.",
    ),
});

export const docEditTool: ToolDefinition = {
  name: "iris_doc_edit",
  title: "Edit Document Lines",
  description:
    "Change a few lines of an existing class, routine or include file without resending the whole document. " +
    "Read the exact lines first with a ranged `iris_doc_get` (startLine/endLine): both tools use the same 1-based line numbers. " +
    "Each edit is an `insert` (afterLine, text, expected; afterLine 0 inserts before line 1), a `delete` (startLine, endLine, expected) " +
    "or a `replace` (startLine, endLine, text, expected), addressed in the numbering of that read. " +
    "`expected` is the current text of the lines the edit addresses (for an insert, of line afterLine, or line 1 when afterLine is 0); " +
    "an edit whose expected text does not match is refused, so an edit never overwrites a line whose text differs from what you expected. " +
    "`text` and `expected` are plain text: one leading BOM and one trailing line break are ignored, CRLF and LF both separate lines, " +
    "and an empty text is one empty line (use delete to remove lines). Make `expected` distinctive when a line such as `}` is not unique. " +
    "All edits apply or none: they are checked together, applied bottom-up against the numbering of the read, and saved in one " +
    "version-checked write; overlapping edits are rejected. " +
    "A STALE_CONTENT refusal lists the current text of every mismatched edit, and a DOCUMENT_CONFLICT refusal means the document " +
    "changed after it was read; nothing is stored in either case, so read the lines again and retry (a conflict is never retried here). " +
    "For a class, an edit that would drop a Storage definition is refused with STORAGE_DROPPED: keep the Storage lines, " +
    "or use action `regenerateStorage` to let IRIS regenerate the storage. " +
    "Returns the result of a fresh read, never the whole document: `unifiedDiff` (3 context lines), an excerpt of each edit " +
    "(the lines it produced and 3 context lines on each side), `totalLines` and the new version `ts`. " +
    "IRIS reformats class source when it saves (it adds blank lines between members, for example), so the result can differ from what was sent. " +
    "The tool does not compile: run `iris_doc_compile` next. " +
    "Governance: `apply` is a write that is enabled by default. It is disabled when `iris_doc_put` is explicitly disabled " +
    "(unless `iris_doc_edit:apply` is set explicitly) and under the read-only preset. `regenerateStorage` runs the same edits " +
    "without the Storage guard and is disabled by default.",
  inputSchema: z.object({
    action: z
      .enum(["apply", "regenerateStorage"])
      .describe(
        "apply: make the edits, refusing any that would drop a Storage definition of a class (enabled by default). " +
          "regenerateStorage: the same edits without the Storage guard, so IRIS generates new storage at the next compile (disabled by default).",
      ),
    name: z.string().describe("Full document name with extension (e.g., 'MyApp.Service.cls', 'MyApp.Utils.mac')"),
    edits: z
      .array(editSchema)
      .min(1)
      .describe("The edits, in any order. All are checked and applied together, or none is."),
    namespace: z.string().optional().describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  // Governance (Rules #28/#32; AD-4/AD-6): both action keys are new. `apply` is a truthful write that
  // ships enabled (the S-3 decision: guarded by `expected`, the version check and the Storage guard);
  // `regenerateStorage` is the default-disabled override. Every key inherits a disable of `iris_doc_put`.
  mutates: { apply: "write", regenerateStorage: "write" },
  defaultEnabled: ["apply"],
  parent: "iris_doc_put",
  handler: async (args, ctx) => {
    const { action, name, edits, namespace } = args as {
      action: "apply" | "regenerateStorage";
      name: string;
      edits: LineEdit[];
      namespace?: string;
    };

    const nameError = validateDocName(name);
    if (nameError) return failure(nameError);
    const ns = ctx.resolveNamespace(namespace);

    const shapeError = validateEdits(edits);
    if (shapeError !== undefined) return failure(shapeError);

    const path = atelierPath(ctx.atelierVersion, ns, `doc/${encodeURIComponent(name)}`);

    // The one read: the lines every check runs against, and the version the save is checked against.
    let read: TextDocumentRead;
    try {
      read = readTextDocument((await ctx.http.get(path)).result as DocGetResult | undefined);
    } catch (error: unknown) {
      if (error instanceof IrisApiError && error.statusCode === 404) {
        return failure(
          `Document '${name}' not found in namespace '${ns}'. iris_doc_edit changes an existing document; create it with iris_doc_put.`,
        );
      }
      throw error;
    }
    if (read.kind === "unreadable") return failure(unreadableDocumentText(name, ns, read.reason));
    if (read.kind === "binary") {
      return failure(
        `Document '${name}' is a binary document, and line edits apply only to text. Replace it with iris_doc_put.`,
      );
    }
    const { lines, ts } = read;

    const rangeError = checkRange(edits, name, lines.length);
    if (rangeError !== undefined) return failure(rangeError);

    const stale = findStaleEdits(edits, lines);
    if (stale.length > 0) return staleRefusal(name, ns, ts, lines.length, stale);

    const applied = applyEdits(edits, lines);

    if (action === "apply" && isClassDocument(name)) {
      const dropped = droppedStorageDefinitions(lines, applied.lines);
      if (dropped.length > 0) return storageDroppedRefusal(name, ns, dropped, EDIT_STORAGE_REMEDY);
    }

    const unchanged =
      applied.lines.length === lines.length && applied.lines.every((line, index) => line === lines[index]);
    if (unchanged) {
      const excerpts = edits.map((edit, index) => {
        const region = applied.regions[index] as EditRegion;
        return excerptAround(index + 1, edit, lines, region.start, region.start + region.length);
      });
      return {
        content: [
          {
            type: "text",
            text: `Document '${name}' in namespace '${ns}' already has the edited text, so nothing was saved; it has ${lines.length} lines (ts ${ts}).`,
          },
        ],
        structuredContent: {
          name,
          namespace: ns,
          ts,
          totalLines: lines.length,
          changed: false,
          unifiedDiff: "",
          excerpts,
        },
      };
    }

    // The one save. It carries the version of the read, so a change made since then is a conflict, and
    // a conflict is never retried.
    let saved: AtelierEnvelope;
    try {
      saved = await ctx.http.put(
        path,
        { enc: false, content: applied.lines },
        { headers: { "If-None-Match": ts } },
      );
    } catch (error: unknown) {
      if (error instanceof IrisApiError && error.statusCode === 409) {
        return refusalResult(
          REFUSAL_CODES.DOCUMENT_CONFLICT,
          `Document '${name}' was not changed in namespace '${ns}': it changed on the server after this tool read it. ` +
            "Nothing was stored. Read the lines again with iris_doc_get and retry the edits against the current text.",
          { name, namespace: ns },
        );
      }
      throw error;
    }

    // IRIS can refuse the text inside an HTTP 200 envelope, reporting the reason only as a string
    // `result.status` while storing nothing.
    const refusal = atelierDocStatusError(saved.result);
    if (refusal !== undefined) {
      return {
        content: [
          {
            type: "text",
            text: `Document '${name}' was not saved in namespace '${ns}': ${refusal}. Nothing was stored; correct the edits and retry.`,
          },
        ],
        structuredContent: { name, namespace: ns, status: refusal },
        isError: true,
      };
    }

    // The answer comes from a re-read: IRIS may store the text differently from what was sent.
    let reread: TextDocumentRead | undefined;
    let rereadFailure: string | undefined;
    try {
      reread = readTextDocument((await ctx.http.get(path)).result as DocGetResult | undefined);
    } catch (error: unknown) {
      rereadFailure = error instanceof Error ? error.message : String(error);
    }
    if (reread?.kind === "unreadable") rereadFailure = reread.reason;
    if (reread?.kind === "binary") rereadFailure = "IRIS returned the document as binary content";
    if (reread?.kind !== "text") {
      const savedTs = (saved.result as { ts?: unknown } | undefined)?.ts;
      return {
        content: [
          {
            type: "text",
            text:
              `Document '${name}' was saved in namespace '${ns}', but reading it back failed: ${rereadFailure}. ` +
              "The edits are applied: do not repeat them. Read the document with iris_doc_get to see the result.",
          },
        ],
        structuredContent: { name, namespace: ns, saved: true, ts: typeof savedTs === "string" ? savedTs : "" },
        isError: true,
      };
    }

    const diff = unifiedDiff(lines, reread.lines, {
      oldLabel: `${name}\t${ts}`,
      newLabel: `${name}\t${reread.ts}`,
    });
    const pairs = alignLines(applied.lines, reread.lines);
    const excerpts = edits.map((edit, index) => {
      const region = applied.regions[index] as EditRegion;
      const [start, end] = regionInReread(pairs, region, reread.lines.length);
      return excerptAround(index + 1, edit, reread.lines, start, end);
    });
    const sections = excerpts
      .map((excerpt) => excerptSection(edits[excerpt.edit - 1] as LineEdit, excerpt))
      .join("");

    // Whether the document changed is read from the re-read, never from the edited lines: IRIS can
    // store a class edit back as it was (it restores a deleted blank line between members, for example).
    const changed = diff !== "";
    const text = changed
      ? `Document '${name}' edited in namespace '${ns}': ${appliedCount(edits.length)}; ` +
        `it has ${reread.lines.length} lines now (ts ${reread.ts}). It is not compiled: run iris_doc_compile next.` +
        `\n\n${diff}` +
        sections
      : `Document '${name}' was saved in namespace '${ns}', but IRIS stored the text it already had, so nothing changed; ` +
        `it has ${reread.lines.length} lines (ts ${reread.ts}). IRIS reformats class source when it saves, so ` +
        `${edits.length === 1 ? "the edit has" : "the edits have"} no effect.` +
        sections;
    return {
      content: [{ type: "text", text }],
      structuredContent: {
        name,
        namespace: ns,
        ts: reread.ts,
        totalLines: reread.lines.length,
        changed,
        unifiedDiff: diff,
        excerpts,
      },
    };
  },
};
