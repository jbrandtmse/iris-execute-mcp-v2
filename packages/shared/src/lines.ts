/**
 * Line and text utilities shared by every tool that writes document text to
 * IRIS.
 *
 * `stripLeadingBom` is the seed of the single line utility that owns BOM
 * handling for document reads and writes; later stories extend this module
 * rather than adding a second one.
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
