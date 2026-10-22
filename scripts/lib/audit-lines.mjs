// The one reader of an audit file (DW-693). Every test and script that reads `IRIS_AUDIT_LOG` goes through it.
//
// CONTRACT
//   - The audit writer (`packages/shared/src/audit.ts`) appends each entry as one `${line}\n` in a single `appendFile` call. A reader
//     that runs while the server writes can therefore see the file end in a partial line, an entry still being written.
//   - `completeAuditLines(text)` returns the non-blank lines of `text` that end in a newline, in order. A last line without its
//     newline is left out, and a later read sees it whole. A line keeps its own characters (a `\r` before the newline stays).
//   - `readAuditEntries(file)` reads `file` once and returns the parsed entries of its complete lines. A missing file reads as `[]`.
//     A newline-terminated line that is not JSON throws: the writer never produces one, so that is a real defect.
//   Importing this module runs nothing.

import { existsSync, readFileSync } from 'node:fs';

/**
 * The non-blank lines of the audit file text `text` that end in a newline, in order (see the header).
 *
 * @param {string} text
 * @returns {string[]}
 */
export function completeAuditLines(text) {
  const end = text.lastIndexOf('\n');
  if (end === -1) return [];
  return text
    .slice(0, end)
    .split('\n')
    .filter((line) => line.trim() !== '');
}

/**
 * The parsed entries of the audit file `file`, from its complete lines only (see the header).
 *
 * @param {string} file
 * @returns {Array<Record<string, unknown>>}
 */
export function readAuditEntries(file) {
  return completeAuditLines(existsSync(file) ? readFileSync(file, 'utf8') : '').map((line) => JSON.parse(line));
}
