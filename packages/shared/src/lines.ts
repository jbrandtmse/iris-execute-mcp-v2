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
