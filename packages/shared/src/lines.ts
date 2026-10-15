/**
 * Line and text utilities shared by every tool that reads or writes document
 * text on IRIS.
 *
 * This is the single line utility. It owns BOM handling for document reads and
 * writes, the 1-based numbering of a document's line array, and the one
 * numbered-text format; later stories extend this module rather than adding a
 * second one.
 *
 * Line N of a document is element N-1 of the `content` array that Atelier's
 * `GET /doc` returns, after one leading BOM is removed from element 0. A class
 * ends with a trailing empty element, and it counts as a line. Nothing here
 * splits or joins the elements of that array: {@link splitLines},
 * {@link joinLines} and {@link textToLines} convert between caller TEXT and
 * lines, and {@link alignLines} and {@link unifiedDiff} compare two line arrays.
 */

/** The UTF-8 byte-order mark as a JavaScript string (U+FEFF). */
const BYTE_ORDER_MARK = "\uFEFF";

/**
 * Remove a single leading UTF-8 byte-order mark (U+FEFF) from `text`.
 *
 * A BOM carries no source meaning for IRIS; left in the first line of an
 * uploaded document it makes the server reject the line as an illegal header
 * and store nothing. Only the very first character is inspected, so a U+FEFF
 * anywhere else in the text is preserved. The input is never mutated.
 *
 * @param text - Document text, possibly BOM-prefixed.
 * @returns `text` without a leading BOM; the same string when there is none.
 */
export function stripLeadingBom(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
}

/**
 * Remove a single leading UTF-8 byte-order mark from the first element of a
 * document's line array (the `content` array shape Atelier's `PUT /doc` takes).
 *
 * The caller's array is never mutated: when the first line carries a BOM a
 * copy is returned, otherwise the same array. Every other line, and a U+FEFF
 * anywhere but the very first character, is preserved.
 *
 * @param lines - Document lines, the first possibly BOM-prefixed.
 * @returns `lines` without a leading BOM; the same array when there is none.
 */
export function stripLeadingBomFromLines(lines: string[]): string[] {
  const first = lines[0];
  if (first === undefined) return lines;
  const stripped = stripLeadingBom(first);
  return stripped === first ? lines : [stripped, ...lines.slice(1)];
}

/**
 * The lines of a document as read from Atelier's `GET /doc` `content` array:
 * line N is element N-1 of the returned array.
 *
 * One leading BOM is removed from element 0 and nothing else changes, so a
 * class keeps its trailing empty element (a line) and every other element is
 * returned exactly as IRIS sent it. The result is always a fresh array and the
 * input is never mutated.
 *
 * @param content - The `content` array of a `GET /doc` result.
 * @returns A fresh array of the document's lines.
 */
export function documentLines(content: readonly string[]): string[] {
  return stripLeadingBomFromLines([...content]);
}

/**
 * Lines `startLine` through `endLine` of `lines`, 1-based and inclusive.
 *
 * The caller passes a valid range: `1 <= startLine <= endLine <= lines.length`.
 * No validation happens here, so an invalid range yields whatever
 * `Array.prototype.slice` yields. The input is never mutated.
 *
 * @param lines - A document's lines (see {@link documentLines}).
 * @param startLine - First line to return, 1-based.
 * @param endLine - Last line to return, 1-based and inclusive.
 * @returns A fresh array of the lines in the range.
 */
export function linesInRange(
  lines: readonly string[],
  startLine: number,
  endLine: number,
): string[] {
  return lines.slice(startLine - 1, endLine);
}

/** Width of the line-number column in numbered text (the `cat -n` layout). */
export const NUMBERED_LINE_WIDTH = 6;

/**
 * Format lines as numbered text, in the `cat -n` layout: each line is its
 * number right-aligned in {@link NUMBERED_LINE_WIDTH} columns, a TAB, then the
 * line exactly as given.
 *
 * Lines are joined with `"\n"` and there is no trailing newline, so an empty
 * array yields `""`. A number wider than the column is not truncated. The line
 * text is never altered, so the first TAB of an output line always separates
 * the number from the text, even when the text itself starts with a TAB.
 *
 * @param lines - The lines to format.
 * @param firstLineNumber - The 1-based number of `lines[0]`.
 * @returns The numbered text.
 */
export function formatNumberedLines(lines: readonly string[], firstLineNumber: number): string {
  return lines
    .map((text, index) => `${String(firstLineNumber + index).padStart(NUMBERED_LINE_WIDTH)}\t${text}`)
    .join("\n");
}

/**
 * Split text into lines on `\r?\n`. A trailing line break yields a trailing empty
 * element, and `""` yields `[""]`; a lone `\r` is not a line break.
 *
 * @param text - Text with `\n` or `\r\n` line breaks.
 * @returns The lines, always at least one element.
 */
export function splitLines(text: string): string[] {
  return text.split(/\r?\n/);
}

/**
 * Join lines with `"\n"`, with no trailing line break. The inverse of
 * {@link splitLines} for text that uses `\n` line breaks.
 *
 * @param lines - The lines to join.
 * @returns The joined text; `""` for an empty array.
 */
export function joinLines(lines: readonly string[]): string {
  return lines.join("\n");
}

/**
 * Parse caller-supplied text (an edit's `text` or `expected`) into lines: one
 * leading BOM is removed, one trailing `\r?\n` is dropped, and the rest is split
 * on `\r?\n`.
 *
 * So `"a\nb\n"` and `"a\r\nb"` are both `["a", "b"]`, and `""` is one empty
 * line. The result always has at least one element; removing lines is a delete,
 * never an empty text.
 *
 * @param text - Text with `\n` or `\r\n` line breaks.
 * @returns The text's lines.
 */
export function textToLines(text: string): string[] {
  return splitLines(stripLeadingBom(text).replace(/\r?\n$/, ""));
}

/** Context lines around each change in {@link unifiedDiff}, as in `diff -U3`. */
export const DIFF_CONTEXT_LINES = 3;

/**
 * The most inserted plus deleted lines {@link alignLines} searches for. When the
 * lines that differ need more than this, the differing middle is reported as one
 * change: still a valid diff, with fewer lines kept than a minimal one.
 */
export const MAX_DIFF_DISTANCE = 2000;

/** Read element `index` of an integer array, `0` when it is out of range. */
function intAt(values: Int32Array, index: number): number {
  return values[index] ?? 0;
}

/**
 * The 0-based index pairs of the lines that a minimal diff of `a` and `b` keeps
 * unchanged (Myers' O(ND) algorithm), ascending in both indexes. Returns `[]`
 * when more than {@link MAX_DIFF_DISTANCE} inserted plus deleted lines would be
 * needed.
 */
function myersMatches(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const n = a.length;
  const m = b.length;
  const maxDistance = Math.min(n + m, MAX_DIFF_DISTANCE);
  const offset = maxDistance + 1;
  const furthest = new Int32Array(2 * maxDistance + 3);
  // trace[d] holds the furthest-reaching x of each diagonal k in [-d, d] at the start of round d,
  // stored at index k + d.
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= maxDistance && found < 0; d += 1) {
    trace.push(furthest.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && intAt(furthest, offset + k - 1) < intAt(furthest, offset + k + 1))) {
        x = intAt(furthest, offset + k + 1);
      } else {
        x = intAt(furthest, offset + k - 1) + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      furthest[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return [];

  const matches: Array<[number, number]> = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d -= 1) {
    const round = trace[d] as Int32Array;
    const k = x - y;
    const previousK =
      k === -d || (k !== d && intAt(round, k - 1 + d) < intAt(round, k + 1 + d)) ? k + 1 : k - 1;
    const previousX = intAt(round, previousK + d);
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      matches.push([x - 1, y - 1]);
      x -= 1;
      y -= 1;
    }
    if (d > 0) {
      x = previousX;
      y = previousY;
    }
  }
  return matches.reverse();
}

/**
 * The lines that a minimal line diff keeps unchanged: 1-based `[indexInA,
 * indexInB]` pairs, ascending in both indexes, where `a[i - 1] === b[j - 1]`.
 *
 * The common head and tail are paired first; Myers' algorithm pairs the middle.
 * When the middle needs more than {@link MAX_DIFF_DISTANCE} inserted plus
 * deleted lines, it contributes no pairs. Equal arrays pair every line, and an
 * empty array pairs none. The inputs are never mutated.
 *
 * @param a - The old lines.
 * @param b - The new lines.
 * @returns The ascending pairs of unchanged lines.
 */
export function alignLines(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = [];
  const shorter = Math.min(a.length, b.length);
  let head = 0;
  while (head < shorter && a[head] === b[head]) {
    pairs.push([head + 1, head + 1]);
    head += 1;
  }
  let tail = 0;
  while (tail < shorter - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;

  const oldMiddle = a.slice(head, a.length - tail);
  const newMiddle = b.slice(head, b.length - tail);
  if (oldMiddle.length > 0 && newMiddle.length > 0) {
    for (const [i, j] of myersMatches(oldMiddle, newMiddle)) pairs.push([head + i + 1, head + j + 1]);
  }
  for (let t = tail; t >= 1; t -= 1) pairs.push([a.length - t + 1, b.length - t + 1]);
  return pairs;
}

/** One line of a diff: unchanged (`" "`), deleted (`"-"`) or inserted (`"+"`). */
interface DiffOp {
  mark: " " | "-" | "+";
  line: string;
}

/** The ordered unchanged, deleted and inserted lines that turn `before` into `after`; a change's deletions come first. */
function diffOps(before: readonly string[], after: readonly string[]): DiffOp[] {
  const ops: DiffOp[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  for (const [i, j] of alignLines(before, after)) {
    while (oldIndex < i - 1) ops.push({ mark: "-", line: before[oldIndex++] as string });
    while (newIndex < j - 1) ops.push({ mark: "+", line: after[newIndex++] as string });
    ops.push({ mark: " ", line: before[oldIndex] as string });
    oldIndex += 1;
    newIndex += 1;
  }
  while (oldIndex < before.length) ops.push({ mark: "-", line: before[oldIndex++] as string });
  while (newIndex < after.length) ops.push({ mark: "+", line: after[newIndex++] as string });
  return ops;
}

/** `start` or `start,count` of a hunk range: `,count` is omitted when the count is 1. */
function hunkRange(start: number, count: number): string {
  return count === 1 ? String(start) : `${start},${count}`;
}

/**
 * A unified diff of two line arrays, following the `diff -U3` conventions.
 *
 * - The output starts with `--- <oldLabel>` and `+++ <newLabel>`; the labels are
 *   used verbatim, so a caller can put a name, a TAB and a timestamp in them.
 * - Each hunk has {@link DIFF_CONTEXT_LINES} unchanged lines on each side of its
 *   changes, and hunks separated by fewer than 7 unchanged lines are merged.
 * - A hunk header is `@@ -s,c +s,c @@`: `,c` is omitted when `c` is 1, and an
 *   empty range is named by the line before it (`-0,0`).
 * - Lines are prefixed with a space, `-` or `+`, and everything is joined with
 *   `"\n"` with no trailing newline. A change lists its deletions before its
 *   insertions.
 * - The unchanged lines are those of {@link alignLines}.
 *
 * @param before - The old lines.
 * @param after - The new lines.
 * @param labels - The text after `--- ` and `+++ ` in the two header lines.
 * @returns `""` when the arrays are equal, otherwise the diff.
 */
export function unifiedDiff(
  before: readonly string[],
  after: readonly string[],
  labels: { oldLabel: string; newLabel: string },
): string {
  const ops = diffOps(before, after);
  const markAt = (index: number): string => ops[index]?.mark ?? "";

  // Lines of each side that precede op `index`.
  const oldBefore: number[] = [0];
  const newBefore: number[] = [0];
  for (const op of ops) {
    oldBefore.push((oldBefore[oldBefore.length - 1] as number) + (op.mark === "+" ? 0 : 1));
    newBefore.push((newBefore[newBefore.length - 1] as number) + (op.mark === "-" ? 0 : 1));
  }

  const body: string[] = [];
  let first = 0;
  while (first < ops.length) {
    if (markAt(first) === " ") {
      first += 1;
      continue;
    }
    // Extend the hunk through every following change that is close enough to share context.
    let last = first;
    let next = first + 1;
    while (next < ops.length) {
      if (markAt(next) !== " ") {
        last = next;
        next += 1;
        continue;
      }
      let resume = next;
      while (resume < ops.length && markAt(resume) === " ") resume += 1;
      if (resume < ops.length && resume - next <= 2 * DIFF_CONTEXT_LINES) {
        next = resume;
        continue;
      }
      break;
    }
    let leading = 0;
    while (leading < DIFF_CONTEXT_LINES && first - 1 - leading >= 0 && markAt(first - 1 - leading) === " ") {
      leading += 1;
    }
    let trailing = 0;
    while (
      trailing < DIFF_CONTEXT_LINES &&
      last + 1 + trailing < ops.length &&
      markAt(last + 1 + trailing) === " "
    ) {
      trailing += 1;
    }
    const start = first - leading;
    const end = last + 1 + trailing;
    const hunk = ops.slice(start, end);
    const oldCount = hunk.filter((op) => op.mark !== "+").length;
    const newCount = hunk.filter((op) => op.mark !== "-").length;
    const oldStart = (oldBefore[start] as number) + (oldCount === 0 ? 0 : 1);
    const newStart = (newBefore[start] as number) + (newCount === 0 ? 0 : 1);
    body.push(`@@ -${hunkRange(oldStart, oldCount)} +${hunkRange(newStart, newCount)} @@`);
    for (const op of hunk) body.push(`${op.mark}${op.line}`);
    first = end;
  }

  if (body.length === 0) return "";
  return [`--- ${labels.oldLabel}`, `+++ ${labels.newLabel}`, ...body].join("\n");
}
