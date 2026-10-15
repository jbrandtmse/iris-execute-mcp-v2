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
 * splits or joins the elements of that array.
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
