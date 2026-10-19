// Provenance rules for adapted third-party content in the skills pack, and the frontmatter rule for every
// pack skill file (AD-28).
//
// Pure functions: no filesystem and no process access. `scripts/check-provenance.mjs` (the CLI) and
// `packages/iris-mcp-all/src/__tests__/pack-provenance.test.ts` (the default-suite test) both import this
// one module. `scripts/lib/provenance-inputs.mjs` gathers the inputs.
//
// The pinned constants below are oracles. None of them is derived from the notice, the pack or any other
// file the check reads. Each names the command that captured it, run in a read-only checkout of
// https://github.com/intersystems-community/iris-agentic-dev (never in this repository).

import { createHash } from 'node:crypto';
import { NOTICE_FILENAME, skillFrontmatterProblems } from './skills-pack.mjs';

/**
 * The upstream commit adapted content is pinned to.
 * Capture: `git rev-parse HEAD` in the upstream checkout.
 */
export const UPSTREAM_COMMIT = 'b6205bbbad2f431ae14c34401fd55d85cb5d2305';

/**
 * sha256 of the upstream `LICENSE` file at UPSTREAM_COMMIT.
 * Capture: `git cat-file blob HEAD:LICENSE | shasum -a 256`.
 */
export const UPSTREAM_LICENSE_SHA256 = '85b458dc150c4d17873dd5e73d01cfa23c797997a09d841884e08378242e929c';

/**
 * Byte length of the upstream `LICENSE` file at UPSTREAM_COMMIT (LF line endings, ASCII, ending in one LF).
 * Capture: `git cat-file blob HEAD:LICENSE | wc -c`.
 */
export const UPSTREAM_LICENSE_BYTES = 1081;

/**
 * The adaptation header: the first non-blank line, after any frontmatter, of every adapted file. The
 * copyright sign is a unicode escape so the source stays ASCII.
 * Capture: the wording of AD-28 in the architecture spine.
 */
export const ADAPTATION_HEADER =
  'Adapted from intersystems-community/iris-agentic-dev (MIT, \u00A9 2025 InterSystems Corporation); ' +
  `see ${NOTICE_FILENAME}`;

/**
 * An ASCII marker that identifies adapted content inside any file, compiled JavaScript included.
 * Capture: ADAPTATION_HEADER cut before its parenthesised licence clause, so the marker holds no
 * non-ASCII character.
 */
export const DISTRIBUTION_MARKER = 'Adapted from intersystems-community/iris-agentic-dev';

/**
 * Upstream sources that must never be adapted. A path is excluded when it ends with the first entry or
 * has a segment equal to the second.
 * Capture: AD-28 ("Nothing is derived from `kb/ipm-module-authoring.md` or `iris-objectscript-eval`").
 */
export const EXCLUDED_SOURCES = {
  fileSuffixes: ['kb/ipm-module-authoring.md'],
  segments: ['iris-objectscript-eval'],
};

/**
 * Names the notice must credit.
 * Capture: `skills/README.md` and `skills/iris-dev.toml` in the upstream checkout.
 */
export const REQUIRED_CREDITS = ['Tim Leavitt', 'Tom Dyar'];

/**
 * The non-endorsement sentence the notice must carry, which meets AD-28's "Names and endorsement".
 * Capture: the pinned notice text of the skills-pack spec (Story 41.1, Design Notes, "Pinned oracles").
 */
export const NON_ENDORSEMENT =
  'The IRIS MCP Server Suite and this skills pack are independent projects; they are not affiliated with, ' +
  'sponsored by, or endorsed by InterSystems Corporation.';

/**
 * The header row of the notice's provenance table.
 * Capture: the notice skeleton of the skills-pack spec (Story 41.1, Design Notes, "Golden example").
 */
export const PROVENANCE_HEADER_ROW = '| Pack file | Source file at b6205bb | Adaptation |';

/** The directory, inside a package, that holds the shipped pack. */
export const PACK_PATH_IN_PACKAGE = 'skills-pack';

// A skill definition file's pack-relative path; group 1 is the skill's directory name.
const SKILL_FILE_PACK_REL = /^skills\/([^/]+)\/SKILL\.md$/;

const LICENSE_OPEN = '<!-- BEGIN iris-agentic-dev LICENSE (verbatim) -->\n```text\n';
const LICENSE_CLOSE = '```\n<!-- END iris-agentic-dev LICENSE -->';

/** @param {Buffer | Uint8Array} bytes */
function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

/**
 * The MIT block of a notice: the bytes strictly between the opening marker plus its code fence and the
 * closing fence plus its marker.
 *
 * @param {Buffer} noticeBuf
 * @returns {Buffer | null} `null` when either marker or fence is absent, appears twice, or is out of order.
 */
export function extractLicenseBlock(noticeBuf) {
  const open = noticeBuf.indexOf(LICENSE_OPEN);
  const close = noticeBuf.indexOf(LICENSE_CLOSE);
  if (open < 0 || close < 0) return null;
  if (noticeBuf.indexOf(LICENSE_OPEN, open + 1) >= 0 || noticeBuf.indexOf(LICENSE_CLOSE, close + 1) >= 0) return null;
  const start = open + LICENSE_OPEN.length;
  if (close < start) return null;
  return noticeBuf.subarray(start, close);
}

/**
 * Split one Markdown table row into its trimmed cells.
 *
 * @param {string} line
 * @returns {string[]}
 */
function splitRow(line) {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|')) body = body.slice(0, -1);
  return body.split('|').map((cell) => cell.trim());
}

/** @param {string} cell */
function stripCodeTicks(cell) {
  const match = /^`(.*)`$/.exec(cell);
  return match ? (match[1] ?? '') : cell;
}

/**
 * The rows of the provenance table: the lines after PROVENANCE_HEADER_ROW and its separator row, up to the
 * first line that does not start with `|`. A cell holds no `|`. A pack-file or source cell may be wrapped in
 * code ticks.
 *
 * @param {string} noticeText
 * @returns {{ rows: Array<{ packFile: string, source: string, adaptation: string, line: number }>, problems: string[] }}
 *   `rows` is empty when the header row is absent; the caller reports that absence.
 */
export function parseProvenanceRows(noticeText) {
  const rows = [];
  const problems = [];
  const lines = noticeText.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim() === PROVENANCE_HEADER_ROW);
  if (headerIndex < 0) return { rows, problems };

  const separator = (lines[headerIndex + 1] ?? '').trim();
  if (!/^\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|\s*:?-+:?\s*\|$/.test(separator)) {
    problems.push('provenance table: the separator row is missing after the header row');
    return { rows, problems };
  }

  for (let index = headerIndex + 2; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (!line.trim().startsWith('|')) break;
    const cells = splitRow(line);
    if (cells.length !== 3 || cells.some((cell) => cell === '')) {
      problems.push(`provenance table line ${index + 1}: expected three non-empty cells`);
      continue;
    }
    rows.push({
      packFile: stripCodeTicks(cells[0] ?? ''),
      source: stripCodeTicks(cells[1] ?? ''),
      adaptation: cells[2] ?? '',
      line: index + 1,
    });
  }
  return { rows, problems };
}

/**
 * Whether the first non-blank line after a leading `---` frontmatter block (or the first non-blank line
 * when there is no frontmatter) is exactly ADAPTATION_HEADER.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function hasValidAdaptationHeader(text) {
  const lines = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).split('\n').map((line) => line.replace(/\r$/, ''));
  let index = 0;
  if (lines[0] === '---') {
    const closing = lines.indexOf('---', 1);
    if (closing < 0) return false;
    index = closing + 1;
  }
  while (index < lines.length && (lines[index] ?? '').trim() === '') index += 1;
  return lines[index] === ADAPTATION_HEADER;
}

/**
 * The text with its adaptation header line removed, for the checks that read an adapted file's body.
 * Only the first line that is exactly ADAPTATION_HEADER goes, and only when it is the first body line
 * (`hasValidAdaptationHeader`); any other copy of the header, a header anywhere else, and a header with a
 * changed character or a CRLF ending stay in the text and are read like any other line. The caller decides
 * which files may use this: only a file its provenance row names is adapted.
 *
 * @param {string} text
 * @returns {string}
 */
export function withoutAdaptationHeader(text) {
  if (!hasValidAdaptationHeader(text)) return text;
  const lines = text.split('\n');
  const at = lines.indexOf(ADAPTATION_HEADER);
  if (at < 0) return text;
  lines.splice(at, 1);
  return lines.join('\n');
}

/**
 * Whether a provenance source path may not be cited: it is an excluded upstream source, or it is not a
 * plain relative path inside the upstream checkout. A plain path is non-empty, not absolute, free of `..`,
 * and made only of letters, digits, `.`, `_`, `-` and `/`; anything else (a fragment, a line suffix, a note,
 * a list) is malformed because it cannot be matched against the exclusions.
 *
 * @param {string} path
 * @returns {boolean}
 */
export function isExcludedSource(path) {
  if (typeof path !== 'string') return true;
  const normalized = path.trim().replace(/\\/g, '/');
  if (!/^[A-Za-z0-9._/-]+$/.test(normalized)) return true;
  if (normalized.startsWith('/') || normalized.includes('..')) return true;
  const segments = normalized.split('/').filter((segment) => segment !== '' && segment !== '.');
  const lowered = segments.map((segment) => segment.toLowerCase());
  if (EXCLUDED_SOURCES.segments.some((segment) => lowered.includes(segment))) return true;
  const joined = lowered.join('/');
  return EXCLUDED_SOURCES.fileSuffixes.some((suffix) => joined === suffix || joined.endsWith(`/${suffix}`));
}

/**
 * @typedef {object} ProvenanceInputs
 * @property {Buffer | null} sourceNotice - `skills-pack-src/IRIS-MCP-THIRD-PARTY-NOTICES.md`.
 * @property {Buffer | null} packNotice - The notice inside the pack.
 * @property {Array<{ label: string, packRel: string, text: string }>} agentFiles - Every agent content file.
 * @property {Array<{ rel: string, bytes: Buffer }>} packFiles - Every file of the pack, pack-relative.
 * @property {Array<{ name: string, mustShipPack: boolean, noticeBeside?: boolean, files: Array<{ path: string, bytes: Buffer }>, problem?: string }>} distributions
 *   One per npm tarball, and one per installer route. `problem` is set when the file list could not be gathered.
 *   `noticeBeside` marks an installer payload: each of its files that carries adapted content needs the notice
 *   in its own directory.
 */

/**
 * Every provenance rule, applied to gathered inputs. The `skill-frontmatter` rule covers each agent file at
 * `skills/<name>/SKILL.md` (a workflow source, a knowledge source or a pack copy): it reports each problem of
 * `skillFrontmatterProblems`, labelled with the file.
 *
 * @param {ProvenanceInputs} inputs
 * @returns {Array<{ rule: string, label: string, message: string }>} Empty when every rule holds.
 */
export function checkProvenance(inputs) {
  const problems = [];
  const add = (rule, label, message) => problems.push({ rule, label, message });

  const sourceLabel = `skills-pack-src/${NOTICE_FILENAME}`;
  let rows = [];

  if (inputs.sourceNotice === null) {
    add('notice', sourceLabel, 'the notice is missing');
  } else {
    const block = extractLicenseBlock(inputs.sourceNotice);
    const expected = `sha256 ${UPSTREAM_LICENSE_SHA256}, ${UPSTREAM_LICENSE_BYTES} bytes`;
    if (block === null) {
      add('mit-block', sourceLabel, `the MIT license block is missing or its markers or fence are altered (expected ${expected})`);
    } else if (sha256(block) !== UPSTREAM_LICENSE_SHA256 || block.length !== UPSTREAM_LICENSE_BYTES) {
      add(
        'mit-block',
        sourceLabel,
        `the MIT license block differs from the upstream LICENSE: sha256 ${sha256(block)}, ${block.length} bytes (expected ${expected})`,
      );
    }

    const text = inputs.sourceNotice.toString('utf8');
    const required = [
      [UPSTREAM_COMMIT, `the full upstream commit ${UPSTREAM_COMMIT}`],
      ...REQUIRED_CREDITS.map((name) => [name, `the credit "${name}"`]),
      [NON_ENDORSEMENT, 'the non-endorsement sentence'],
    ];
    for (const [needle, description] of required) {
      if (!text.includes(needle)) add('notice', sourceLabel, `the notice lacks ${description}`);
    }
    if (!text.split(/\r?\n/).some((line) => line.trim() === PROVENANCE_HEADER_ROW)) {
      add('notice', sourceLabel, `the notice lacks the provenance table header row: ${PROVENANCE_HEADER_ROW}`);
    }

    const parsed = parseProvenanceRows(text);
    rows = parsed.rows;
    for (const message of parsed.problems) add('provenance-table', sourceLabel, message);
  }

  if (inputs.packNotice === null) {
    add('notice-sync', `${PACK_PATH_IN_PACKAGE}/${NOTICE_FILENAME}`, 'the pack does not contain the notice');
  } else if (inputs.sourceNotice !== null && !inputs.packNotice.equals(inputs.sourceNotice)) {
    add('notice-sync', `${PACK_PATH_IN_PACKAGE}/${NOTICE_FILENAME}`, 'the pack notice differs from the source notice');
  }

  const packBytes = new Map(inputs.packFiles.map((file) => [file.rel, file.bytes]));
  const rowFiles = new Set(rows.map((row) => row.packFile));

  for (const row of rows) {
    if (isExcludedSource(row.source)) {
      add('excluded-source', row.packFile, `excluded or malformed source: ${row.source}`);
    }
    const bytes = packBytes.get(row.packFile);
    if (bytes === undefined) {
      add('row-file', row.packFile, `the provenance row names a file that is not in the pack: ${row.packFile}`);
    } else if (!hasValidAdaptationHeader(bytes.toString('utf8'))) {
      add('row-file', row.packFile, `the provenance row names a pack file without the adaptation header: ${row.packFile}`);
    }
  }

  for (const file of inputs.agentFiles) {
    const skill = SKILL_FILE_PACK_REL.exec(file.packRel);
    if (skill !== null) {
      for (const message of skillFrontmatterProblems(file.text, skill[1] ?? '')) {
        add('skill-frontmatter', file.label, message);
      }
    }
    if (!/iris-agentic-dev/i.test(file.text)) continue;
    if (!hasValidAdaptationHeader(file.text)) {
      add('header', file.label, 'missing or misplaced adaptation header');
    }
    if (!rowFiles.has(file.packRel)) {
      add('claim-row', file.label, `no provenance row for ${file.packRel}`);
    }
  }

  const packHashes = new Set(inputs.packFiles.map((file) => sha256(file.bytes)));
  const canonical = inputs.sourceNotice;
  if (!inputs.distributions.some((distribution) => distribution.mustShipPack)) {
    add('distribution', 'distributions', 'no distribution is marked as shipping the pack');
  }
  for (const distribution of inputs.distributions) {
    if (distribution.problem !== undefined) {
      add('distribution', distribution.name, distribution.problem);
      continue;
    }
    const shipsPackFile = distribution.files.some(
      (file) => file.path.split('/').includes(PACK_PATH_IN_PACKAGE) || packHashes.has(sha256(file.bytes)),
    );
    const carriesMarker = distribution.files.some((file) => file.bytes.includes(DISTRIBUTION_MARKER));
    const hasNotice = distribution.files.some(
      (file) => file.path.split('/').pop() === NOTICE_FILENAME && canonical !== null && file.bytes.equals(canonical),
    );
    if ((shipsPackFile || carriesMarker) && !hasNotice) {
      add(
        'distribution',
        distribution.name,
        `the tarball carries pack or adapted content but no ${NOTICE_FILENAME} equal to the canonical notice`,
      );
    }
    if (distribution.noticeBeside === true) {
      const byPath = new Map(distribution.files.map((file) => [file.path, file.bytes]));
      for (const file of distribution.files) {
        if (!file.bytes.includes(DISTRIBUTION_MARKER)) continue;
        const slash = file.path.lastIndexOf('/');
        const beside = `${slash < 0 ? '' : file.path.slice(0, slash + 1)}${NOTICE_FILENAME}`;
        const notice = byPath.get(beside);
        if (notice === undefined || canonical === null || !notice.equals(canonical)) {
          add(
            'distribution',
            distribution.name,
            `the installed copy ${file.path} carries adapted content but no ${NOTICE_FILENAME} beside it equal to the canonical notice`,
          );
        }
      }
    }
    if (distribution.mustShipPack) {
      const shipped = new Set(distribution.files.map((file) => file.path));
      for (const file of inputs.packFiles) {
        const path = `${PACK_PATH_IN_PACKAGE}/${file.rel}`;
        if (!shipped.has(path)) add('distribution', distribution.name, `the tarball lacks the pack file ${path}`);
      }
    }
  }

  return problems;
}

/**
 * The figures the CLI prints on success.
 *
 * @param {ProvenanceInputs} inputs
 * @returns {{ mitSha256: string, mitBytes: number, rows: number, agentFiles: number, distributions: number }}
 */
export function provenanceSummary(inputs) {
  const block = inputs.sourceNotice === null ? null : extractLicenseBlock(inputs.sourceNotice);
  const rows = inputs.sourceNotice === null ? 0 : parseProvenanceRows(inputs.sourceNotice.toString('utf8')).rows.length;
  return {
    mitSha256: block === null ? '' : sha256(block),
    mitBytes: block === null ? 0 : block.length,
    rows,
    agentFiles: inputs.agentFiles.length,
    distributions: inputs.distributions.length,
  };
}
