// Story 42.1 (AC 42.1.6, DW-260; AD-29) -- finds every `npx` spec of the suite that does not
// carry the pinned major.
//
// WHAT IS A SPEC. A token `@iris-mcp/<name>` in the position `npx`, `npm exec` or an
// `npx` flag takes a package: directly after `npx`, `exec`, `-y`, `--yes`, `-p` or
// `--package`, or as `--package=@iris-mcp/<name>`. The scan tokenizes whole files, so a
// JSON/TOML argument array (`"-y", "@iris-mcp/dev"`), a multi-line array and a YAML list
// (`- -y` then `- "@iris-mcp/dev"`) are found the same way as a shell line in Markdown. A
// bare `@iris-mcp/<name>` elsewhere (an import, a package name in prose, an install
// command) is not a spec.
//
// WHAT IS PINNED. Exactly `@iris-mcp/<name>@1`, the major exported by `@iris-mcp/client-config`
// as `IRIS_MCP_MAJOR`. `@latest`, a missing version and `^1` are all unpinned. The scan itself
// holds no major: the caller passes the one it expects.
//
// ONE IMPLEMENTATION. `npx-pin.test.ts` in `@iris-mcp/all` is the only consumer; the exemption
// list lives here so a reader sees every reasoned exception beside the rule it relaxes.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** A spec of the suite: `@iris-mcp/<name>` with an optional `@<version>` (a placeholder name such as `<pkg>` counts). */
const SUITE_TOKEN = /^@iris-mcp\/([^@\s]+)(?:@(.*))?$/;

/** Tokens after which `npx` / `npm exec` take a package. */
const SPEC_INTRODUCERS = new Set(['npx', 'exec', '-y', '--yes', '-p', '--package']);

/** Characters that separate tokens: whitespace, quotes, backticks and the punctuation of arrays, tables and calls. */
const TOKEN = /[^\s`"',[\](){}|;]+/g;

/** Text files the scan reads. */
const TEXT_EXTENSIONS = /\.(?:md|mdc|ts|mts|cts|js|mjs|cjs|json|jsonc|toml|ya?ml)$/;

/** Repository paths (prefixes) that are never scanned: planning/agent material and read-only IRIS source snapshots. */
const EXCLUDED_PREFIXES = ['_bmad', '.claude', 'irislib', 'irissys', 'sources'];

/** The files of the pin tooling itself: the scan, and the two tests whose controls feed the checkers synthetic specs. */
export const PIN_TOOLING_FILES =
  /^(?:packages\/iris-mcp-all\/src\/__tests__\/(?:npx-pin|meta-package-docs)\.test\.ts|scripts\/lib\/npx-pin-scan\.mjs)$/;

/**
 * Reasoned exceptions to the pin rule. An entry relaxes the rule for the lines of `file` that match `line`
 * (all of them when `line` is omitted), and says why. `npx-pin.test.ts` fails on an entry that no longer matches
 * anything, so the list cannot rot.
 *
 * @type {ReadonlyArray<{ file: RegExp, line?: RegExp, reason: string }>}
 */
export const EXEMPTIONS = [
  {
    file: /(?:^|\/)CHANGELOG\.md$/,
    reason: 'History: each section records the command that was current when it was written.',
  },
  {
    file: PIN_TOOLING_FILES,
    reason: 'The pin tooling quotes unpinned specs as the synthetic input its own control tests and comments describe.',
  },
  {
    file: /^packages\/client-config\/src\/__tests__\/fixtures\/(?!golden\/)/,
    reason:
      'Client config files as a user had them before the pin: the legacy input that a re-apply rewrites in place ' +
      'and that status/doctor must still read.',
  },
  {
    file: /^packages\/client-config\/src\/__tests__\/fixtures\/golden\/[^/]+\/stage-\d/,
    line: /@iris-mcp\/(?:dev|data)(?![@\w])/,
    reason:
      'The pre-existing iris-dev-mcp / iris-data-mcp entry that every golden stage carries unchanged as a ' +
      'byte-preservation witness. The entry the lifecycle applies (ops / interop) is scanned and pinned.',
  },
  {
    file: /^packages\/client-config\/(?:scripts\/certification-results\.json|README\.md)$/,
    line: /claude mcp list/,
    reason:
      'The two dated verbatim `claude mcp list` captures of 2026-07-28 in certification-results.json and their ' +
      'rendering in the README; captured evidence is never rewritten.',
  },
];

/**
 * Every unpinned spec in `text`.
 *
 * @param {string} text
 * @param {string} major the pinned major, e.g. "1"
 * @returns {Array<{ line: number, spec: string, text: string }>}
 */
export function findUnpinnedSpecs(text, major) {
  const lineStarts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) lineStarts.push(i + 1);
  const lines = text.split('\n');
  const lineOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  const hits = [];
  let previous = '';
  for (const match of text.matchAll(TOKEN)) {
    // Trailing sentence punctuation is not part of a spec ("... @iris-mcp/dev@1.").
    const raw = match[0].replace(/[.:!?]+$/, '');
    if (raw === '' || raw === '-' || raw === '--') continue; // list markers and bare separators
    let token = raw;
    let introduced = SPEC_INTRODUCERS.has(previous);
    const flagged = /^--package=(.+)$/.exec(raw);
    if (flagged) {
      token = flagged[1];
      introduced = true;
    }
    previous = raw;
    if (!introduced) continue;
    const spec = SUITE_TOKEN.exec(token);
    if (!spec) continue;
    if (spec[2] === major) continue;
    const line = lineOf(match.index);
    hits.push({ line, spec: token, text: lines[line - 1] });
  }
  return hits;
}

/** A source line that carries this marker followed by a reason is exempt: it holds a legacy input a test upgrades. */
export const INLINE_EXEMPTION_MARKER = /npx-pin-exempt:\s*\S/;

/**
 * How `hit` (from a file at repository-relative `file`) is exempt: an inline marker on its line, or an
 * {@link EXEMPTIONS} entry (by index). `null` when it is not exempt.
 *
 * @param {string} file
 * @param {{ text: string }} hit
 * @param {ReadonlyArray<{ file: RegExp, line?: RegExp }>} [exemptions]
 * @returns {{ kind: 'inline' } | { kind: 'list', index: number } | null}
 */
export function exemptionFor(file, hit, exemptions = EXEMPTIONS) {
  if (INLINE_EXEMPTION_MARKER.test(hit.text)) return { kind: 'inline' };
  const index = exemptions.findIndex((entry) => entry.file.test(file) && (entry.line === undefined || entry.line.test(hit.text)));
  return index === -1 ? null : { kind: 'list', index };
}

/**
 * Repository-relative paths of every tracked or untracked-but-not-ignored file that exists on disk (a tracked file deleted
 * in the working tree, such as a consumed changeset, is still listed by git until the deletion is committed).
 *
 * @param {string} root
 * @returns {string[]}
 */
export function listRepoFiles(root) {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  return out.split('\0').filter((file) => file !== '' && existsSync(join(root, file)));
}

/** Generated lockfiles: machine-written package lists, never a place a spec is written or documented. */
const LOCKFILE = /(?:^|\/)(?:pnpm-lock\.yaml|package-lock\.json)$/;

/**
 * The surfaces that write, spawn or document a spec, as repository-relative paths: every
 * tracked text file (documents, source, scripts, manifests, fixtures, the skills pack) outside
 * the excluded prefixes, lockfiles apart. The list is exhaustive as of the file types in
 * {@link TEXT_EXTENSIONS}; a new file type that can hold a spec is added there.
 *
 * @param {string} root
 * @returns {string[]}
 */
export function listScanSurface(root) {
  const excluded = (file) => EXCLUDED_PREFIXES.some((prefix) => file === prefix || file.startsWith(`${prefix}/`) || file.startsWith(`${prefix}-`));
  return listRepoFiles(root).filter((file) => TEXT_EXTENSIONS.test(file) && !excluded(file) && !LOCKFILE.test(file));
}

/**
 * Scan `files` (repository-relative) under `root`.
 *
 * @param {string} root
 * @param {string[]} files
 * @param {string} major
 * @returns {Array<{ file: string, line: number, spec: string, text: string, exemption: ReturnType<typeof exemptionFor> }>}
 */
export function scanFiles(root, files, major) {
  const results = [];
  for (const file of files) {
    const text = readFileSync(join(root, file), 'utf8');
    for (const hit of findUnpinnedSpecs(text, major)) {
      results.push({ file, ...hit, exemption: exemptionFor(file, hit) });
    }
  }
  return results;
}
