// The scan that finds a raw audit reader (DW-693), shared by its test
// (`packages/iris-mcp-all/src/__tests__/audit-reader-guard.test.ts`) and any script that wants to run it.
//
// CONTRACT
//   The audit writer appends each entry as one `${line}\n`, so a reader that splits a file on its newlines can parse a half-written
//   last line and throw. Every reader goes through `scripts/lib/audit-lines.mjs` instead. The scan reads each test and script file
//   with its comments removed (`script-ts-import-scan.mjs`), and a file that never mentions `audit` is not read further. In a file
//   that does, it reports one finding per `.split(<a separator that holds a newline>)` (`"\n"`, `'\n'`, `/\n/`, `/\r?\n/`, a template
//   literal) whose receiver is
//     - `direct`: an expression that holds a `readFileSync(...)` call (a ternary such as `(existsSync(f) ? readFileSync(f) : "")`
//       included, and any `.trim()`, `.toString()` or `String(...)` around it); or
//     - `variable`: a variable that the nearest earlier `const`, `let` or `var` declaration of the same name initializes from a
//       `readFileSync(...)` call (`const raw = readFileSync(f, "utf8"); raw.trim().split("\n")`).
//   Text inside a string, template or regular-expression literal is never code, so a corpus of samples held in a literal is not read.
//   A FINDING is `{ file, line, kind, receiver }`; `line` is the line of the `.split(`.
//   The scan is lexical. It does not find: a file read through a wrapper (`read(path)` that calls `readFileSync`), a variable that is
//   passed on before it is split, a `split` on a value that was assigned after its declaration, or a function parameter that shadows
//   an earlier declaration of its name. A reader that is kept on purpose is listed in `AUDIT_READER_KEPT`.
//   Scan roots: the test sources of `packages/*` and of `extensions/*`, and every `.mjs`, `.js` or `.cjs` file under `scripts/`.
//   Every scan reads files and never runs anything.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { REPO_ROOT, testSources, walk } from './live-gate-scan.mjs';
import { lexSource } from './script-ts-import-scan.mjs';

/**
 * Readers that split a file on its newlines and are not audit readers: the file, the receiver text the scan reports, and why the
 * split is safe. A kept entry that matches no finding is stale.
 *
 * @type {ReadonlyArray<{ file: string, receiver: string, reason: string }>}
 */
export const AUDIT_READER_KEPT = Object.freeze(
  [
    [
      'packages/iris-mcp-all/src/__tests__/story-43-3-confirmation-both-eras.test.ts',
      'readFileSync(path.join(REPO_ROOT, relative), "utf8")',
      'it reads the TypeScript sources of the server packages to find their ctx.confirm call sites; the file is source code, not an audit file',
    ],
  ].map(([file, receiver, reason]) => Object.freeze({ file, receiver, reason })),
);

/** The argument of a split that holds a newline: a string, template or regular-expression literal with a newline escape in it. */
const REGEX_PART = String.raw`(?:[^/\n\\[]|\\.|\[(?:[^\]\\\n]|\\.)*\])*`;
const NEWLINE_SPLIT = new RegExp(
  String.raw`\.split\(\s*(?:"[^"\n]*\\n[^"\n]*"|'[^'\n]*\\n[^'\n]*'|` +
    '`[^`\\n]*\\\\n[^`\\n]*`' +
    String.raw`|\/${REGEX_PART}\\n${REGEX_PART}\/[a-z]*)\s*\)`,
  'y',
);

/** The index where the receiver expression of a call on `masked[dot]` begins: it walks back over names, dots, calls and indexes. */
function receiverStart(masked, dot) {
  let index = dot;
  for (;;) {
    while (index > 0 && /\s/.test(masked[index - 1])) index -= 1;
    const last = masked[index - 1];
    if (last === ')' || last === ']') {
      const close = last;
      const open = close === ')' ? '(' : '[';
      let depth = 0;
      let cursor = index - 1;
      for (; cursor >= 0; cursor -= 1) {
        if (masked[cursor] === close) depth += 1;
        else if (masked[cursor] === open) {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (cursor < 0) return index;
      index = cursor;
      continue;
    }
    const word = /[A-Za-z0-9_$]+$/.exec(masked.slice(Math.max(0, index - 80), index));
    if (word === null) return index;
    index -= word[0].length;
    let before = index;
    while (before > 0 && /\s/.test(masked[before - 1])) before -= 1;
    if (masked[before - 1] === '.') {
      index = before - 1;
      continue;
    }
    return index;
  }
}

/** The initializer text of the declaration that `match` found in `masked`, up to its `;` or the end of its statement. */
function initializerAt(masked, match) {
  let depth = 0;
  const start = match.index + match[0].length;
  let index = start;
  for (; index < masked.length; index += 1) {
    const char = masked[index];
    if ('([{'.includes(char)) depth += 1;
    else if (')]}'.includes(char)) depth -= 1;
    else if ((char === ';' || char === '\n') && depth <= 0) {
      if (char === ';' || !/^\s*[+\-*/%&|?:.,]/.test(masked.slice(index + 1, index + 40))) break;
    }
    if (depth < 0) break;
  }
  return masked.slice(start, index);
}

const READS_FILE = /\breadFileSync\s*\(/;

/**
 * The raw audit readers of one source file (see the header).
 *
 * @param {string} source - The file's text.
 * @param {string} [file] - Its name, for the findings.
 * @returns {Array<{ file: string, line: number, kind: 'direct' | 'variable', receiver: string }>}
 */
export function auditReaderFindings(source, file = 'source') {
  const { code, masked } = lexSource(source);
  if (!/audit/i.test(code)) return [];
  const declarations = [...masked.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=\s*/g)].map((match) => ({
    name: match[1],
    at: match.index,
    initializer: initializerAt(masked, match),
  }));
  const found = [];
  for (const candidate of masked.matchAll(/\.split\(/g)) {
    NEWLINE_SPLIT.lastIndex = candidate.index;
    if (NEWLINE_SPLIT.exec(code) === null) continue;
    const start = receiverStart(masked, candidate.index);
    const receiver = masked.slice(start, candidate.index);
    const line = code.slice(0, candidate.index).split('\n').length;
    const text = code.slice(start, candidate.index).replace(/\s+/g, ' ').trim();
    if (READS_FILE.test(receiver)) {
      found.push({ file, line, kind: 'direct', receiver: text });
      continue;
    }
    const root = /^([A-Za-z_$][\w$]*)/.exec(receiver.trim())?.[1];
    if (root === undefined) continue;
    const declared = declarations.filter((declaration) => declaration.name === root && declaration.at < candidate.index).at(-1);
    if (declared !== undefined && READS_FILE.test(declared.initializer)) found.push({ file, line, kind: 'variable', receiver: text });
  }
  return found;
}

/** Whether a repository-relative path is a test source or test helper. */
const isTestSource = (relative) => /(^|\/)(__tests__|test-helpers)\//.test(relative) || relative.endsWith('.test.ts');

/**
 * The files the scan reads, as absolute paths, sorted: the test sources of `packages/*` and of the extensions, and the scripts.
 *
 * @param {string} [repoRoot]
 * @returns {string[]}
 */
export function auditScanFiles(repoRoot = REPO_ROOT) {
  const extensionsDir = path.join(repoRoot, 'extensions');
  const extensionSources = existsSync(extensionsDir)
    ? readdirSync(extensionsDir).flatMap((name) => walk(path.join(extensionsDir, name, 'src'), ['.ts', '.mts', '.mjs']))
    : [];
  const files = [
    ...testSources(),
    ...extensionSources.filter((file) => isTestSource(path.relative(repoRoot, file).split(path.sep).join('/'))),
    ...walk(path.join(repoRoot, 'scripts'), ['.mjs', '.js', '.cjs']),
  ].filter((file) => !/\.d\.m?ts$/.test(file));
  return [...new Set(files)].sort();
}

/**
 * Every raw audit reader of the repository (see the header), kept readers included.
 *
 * @param {string} [repoRoot]
 * @returns {Array<{ file: string, line: number, kind: 'direct' | 'variable', receiver: string }>}
 */
export function auditReaderScan(repoRoot = REPO_ROOT) {
  return auditScanFiles(repoRoot).flatMap((absolute) =>
    auditReaderFindings(readFileSync(absolute, 'utf8'), path.relative(repoRoot, absolute).split(path.sep).join('/')),
  );
}

/**
 * The findings that no kept entry excuses.
 *
 * @param {ReturnType<typeof auditReaderFindings>} findings
 * @param {typeof AUDIT_READER_KEPT} [kept]
 */
export function unkeptFindings(findings, kept = AUDIT_READER_KEPT) {
  return findings.filter((finding) => !kept.some((entry) => entry.file === finding.file && entry.receiver === finding.receiver));
}
