// The IRIS MCP skills pack: its layout constants, its assembly from the two source trees, and the one
// enumeration of agent content shared by the validator and the provenance check.
//
// LAYOUT. The pack is the committed, generated directory `packages/client-config/skills-pack/`, a
// standard-layout plugin root:
//
//   skills/<name>/...                       one directory per skill
//   rules/claude-code/<name>.md             each always-on rule, as the Claude Code rule file
//   rules/agents-md/<name>.md               each always-on rule, as an AGENTS.md section
//   IRIS-MCP-THIRD-PARTY-NOTICES.md         the third-party notice
//   README.md                               generated (carries the DO-NOT-EDIT banner)
//
// SOURCES. Workflow skills are `gen:skills` output in `skills/`. Hand-authored content lives in
// `skills-pack-src/`: knowledge skills under `knowledge/<name>/`, the rules under `rules/`, and the notice
// at the root of that directory. Assembly copies bytes and renders only the pack README and each rule's
// two forms.
//
// RULES. A rule source is one flat `rules/<name>.md` with no frontmatter (an always-on rule is unscoped,
// so it takes no `paths:`). Its `claude-code` form is the source bytes. Its `agents-md` form is the same
// bytes between two marker lines, `<!-- IRIS-MCP-RULE:<name>:BEGIN -->` and `<!-- IRIS-MCP-RULE:<name>:END -->`;
// a consumer matches those lines exactly and owns everything between them. No line of a rule source may start with
// `<!-- IRIS-MCP-RULE:`, so each section holds exactly its own two marker lines.
//
// SKILL FRONTMATTER. Every `SKILL.md` in the pack opens with a frontmatter block on its first line, holding
// only `name` and `description` (`skillFrontmatterProblems`). The grammar is a strict subset of YAML read line
// by line, and it is fail-safe: whatever lies outside it is reported, never guessed at. A later field, such as
// a skill's preset declaration, extends SKILL_FRONTMATTER_FIELDS and that grammar. Every field in that list is
// required, so a field a skill may leave out also needs the grammar to allow it without requiring it.
// `check:provenance` applies it to every agent file at `skills/<name>/SKILL.md`; `assemblePack` still copies
// those bytes unchanged.
//
// This module reads the filesystem but never writes it; `scripts/gen-pack.mjs` owns the writes.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { listFilesRecursive } from './generated-tree.mjs';

export const PACK_SOURCE_DIR = 'skills-pack-src';
export const KNOWLEDGE_SOURCE_DIR = 'skills-pack-src/knowledge';
export const RULES_SOURCE_DIR = 'skills-pack-src/rules';
export const PACK_DIR = 'packages/client-config/skills-pack';
export const WORKFLOW_SKILLS_DIR = 'skills';
export const NOTICE_FILENAME = 'IRIS-MCP-THIRD-PARTY-NOTICES.md';

/** The pack's top-level index file. Generated; the source tree's own README is never copied. */
export const PACK_README_FILENAME = 'README.md';

/** The pack directory of each rule form, relative to the pack root. */
export const RULE_FORM_DIRS = Object.freeze({
  claudeCode: 'rules/claude-code',
  agentsMd: 'rules/agents-md',
});

/** A rule source's file name: lower-case letters and digits, in groups joined by single hyphens, with the `.md` extension. */
export const RULE_SOURCE_NAME = /^[a-z0-9]+(-[a-z0-9]+)*\.md$/;

/** The always-on ObjectScript pre-write rule's file name, in the source tree and in both pack forms. */
export const ALWAYS_ON_RULE_FILENAME = 'iris-mcp-objectscript-pre-write.md';

const SOURCE_README_FILENAME = 'README.md';

/** The file that defines a skill, inside its directory. */
export const SKILL_FILENAME = 'SKILL.md';

/** A skill's `name`: lower-case letters and digits, in groups joined by single hyphens. */
export const SKILL_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** The longest `name`, in characters. */
export const SKILL_NAME_MAX_LENGTH = 64;

/** The longest `description`, in characters. */
export const SKILL_DESCRIPTION_MAX_LENGTH = 1024;

/** The only frontmatter fields a pack `SKILL.md` may hold; each of them is required. */
export const SKILL_FRONTMATTER_FIELDS = Object.freeze(['name', 'description']);

// Words a skill `name` may not contain.
const SKILL_NAME_RESERVED_WORDS = ['claude', 'anthropic'];

// An XML-like tag: `<` or `</`, a letter, then anything up to the next `>`. `->` and `<UNDEFINED` do not match.
const XML_LIKE_TAG = /<\/?[A-Za-z][^<>]*>/;

// A frontmatter line: a key at column 1, then `:` and, optionally, whitespace and a value.
const FRONTMATTER_LINE = /^([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/;

// The characters a plain (unquoted) scalar may not start with.
const PLAIN_SCALAR_INDICATOR = /^[-?:,[\]{}#&*!|>'"%@`]/;

// The first line of a rule source, read as bytes: an optional BOM, then `---` and the end of the line.
// Latin-1 maps every byte to one character, so any input is matched without a UTF-8 decode.
const FRONTMATTER_OPENER = /^(?:\xef\xbb\xbf)?---[ \t]*(?:\r?\n|$)/;

// A line of a rule source, read as bytes, that starts like a marker line. Only the section's own two lines may.
const MARKER_LINE_START = /^<!-- IRIS-MCP-RULE:/m;

/**
 * The two marker lines that bound a rule's `AGENTS.md` section, each without its line ending.
 *
 * @param {string} stem - The rule's file name without `.md`.
 * @returns {{ begin: string, end: string }}
 */
export function agentsMdMarkers(stem) {
  return {
    begin: `<!-- IRIS-MCP-RULE:${stem}:BEGIN -->`,
    end: `<!-- IRIS-MCP-RULE:${stem}:END -->`,
  };
}

/**
 * A rule's `AGENTS.md` section: the BEGIN line, the source bytes, the END line, each line ending in LF.
 * One LF is added between the source and the END line when the source does not end in one, so the END
 * marker is always a whole line. The source bytes are never decoded.
 *
 * @param {string} stem - The rule's file name without `.md`.
 * @param {Buffer} bytes - The rule source.
 * @returns {Buffer}
 */
export function renderAgentsMdSection(stem, bytes) {
  const { begin, end } = agentsMdMarkers(stem);
  const endsInLineFeed = bytes.length > 0 && bytes[bytes.length - 1] === 0x0a;
  return Buffer.concat([
    Buffer.from(`${begin}\n`, 'utf8'),
    bytes,
    Buffer.from(`${endsInLineFeed ? '' : '\n'}${end}\n`, 'utf8'),
  ]);
}

/**
 * The generated pack README: a DO-NOT-EDIT banner naming the generator, the layout, and a pointer to
 * the notice.
 *
 * @returns {string}
 */
export function renderPackReadme() {
  return (
    `<!-- DO NOT EDIT. This directory is generated by \`pnpm gen:pack\` from the pack sources. ` +
    `Edit the sources, then regenerate. -->\n\n` +
    `# IRIS MCP skills pack\n\n` +
    `Agent skills and the always-on rule for working with the IRIS MCP Server Suite.\n\n` +
    `## Layout\n\n` +
    `- \`skills/<name>/SKILL.md\`: one directory per skill, in the standard plugin layout.\n` +
    `- \`rules/claude-code/<name>.md\`: the always-on rule as a Claude Code rule file.\n` +
    `- \`rules/agents-md/<name>.md\`: the same rule as an \`AGENTS.md\` section, between the lines ` +
    `\`<!-- IRIS-MCP-RULE:<name>:BEGIN -->\` and \`<!-- IRIS-MCP-RULE:<name>:END -->\`.\n` +
    `- \`${NOTICE_FILENAME}\`: third-party notices and licence texts for adapted content.\n\n` +
    `## Third-party content\n\n` +
    `Content adapted from another project carries a header line as its first non-blank line after any ` +
    `frontmatter, and a row in the provenance table of \`${NOTICE_FILENAME}\`. ` +
    `Read that file before redistributing the pack.\n`
  );
}

/**
 * Read one frontmatter value: a double-quoted string that JSON reads as one string, a single-quoted string
 * (`''` escapes a quote), or a plain scalar that holds no `: ` or ` #`, does not end in `:` and does not start
 * with a YAML indicator character.
 *
 * @param {string} raw - The value text, trimmed and not empty.
 * @returns {{ value: string } | { problem: string }}
 */
function parseFrontmatterValue(raw) {
  if (raw.startsWith('"')) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === 'string') return { value: parsed };
    } catch {
      // Falls through to the problem below.
    }
    return { problem: 'is a double-quoted value that is not one valid JSON string; fix the quotes or the escapes' };
  }
  if (raw.startsWith("'")) {
    const match = /^'((?:[^']|'')*)'$/.exec(raw);
    if (match === null) return { problem: 'is a single-quoted value that is not closed or holds a lone quote; double each inner quote' };
    return { value: (match[1] ?? '').replace(/''/g, "'") };
  }
  if (PLAIN_SCALAR_INDICATOR.test(raw)) {
    return { problem: 'is a plain value that starts with a YAML indicator character; put it in double quotes' };
  }
  if (raw.includes(': ') || raw.includes(' #') || raw.endsWith(':')) {
    return { problem: 'is a plain value that holds ": " or " #" or ends in ":"; put it in double quotes' };
  }
  return { value: raw };
}

/**
 * The problems of a `SKILL.md` frontmatter block, in the strict grammar the pack accepts.
 *
 * - Line 1 is exactly `---` (no byte-order mark) and a later `---` line closes the block. Lines split on LF,
 *   and one trailing CR is dropped from each.
 * - Each line between is blank, a comment (first character after any spaces or tabs is `#`), or `key: value`
 *   at column 1. Only spaces and tabs around a value are dropped, as YAML drops them.
 * - Keys come only from SKILL_FRONTMATTER_FIELDS, each once, and both are required.
 * - `name` matches SKILL_NAME, has at most SKILL_NAME_MAX_LENGTH characters, equals `dirName`, and holds no
 *   reserved word.
 * - `description` is not empty after trimming, has at most SKILL_DESCRIPTION_MAX_LENGTH characters and holds
 *   no XML-like tag.
 *
 * Each message names the problem and the fix.
 *
 * @param {string} text - The decoded file.
 * @param {string} dirName - The skill's directory name.
 * @returns {string[]} Empty when the frontmatter is valid.
 */
export function skillFrontmatterProblems(text, dirName) {
  if (text.charCodeAt(0) === 0xfeff) {
    return ['begins with a byte-order mark, so a client may not read the opening --- as the first line; save the file without a BOM'];
  }
  const lines = text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line));
  if (lines[0] !== '---') {
    return ['does not open with a --- frontmatter line, so clients read no name or description; put the frontmatter on line 1'];
  }
  const closing = lines.indexOf('---', 1);
  if (closing < 0) return ['has no closing --- line after its frontmatter; add one'];

  const problems = [];
  const seen = new Set();
  const values = new Map();
  for (let index = 1; index < closing; index += 1) {
    const line = lines[index] ?? '';
    if (/^[ \t]*(#|$)/.test(line)) continue;
    const position = `frontmatter line ${index + 1}`;
    const match = FRONTMATTER_LINE.exec(line);
    if (match === null) {
      problems.push(`${position} is not "key: value" at column 1; indented, multi-line and list values are not supported`);
      continue;
    }
    const key = match[1] ?? '';
    if (!SKILL_FRONTMATTER_FIELDS.includes(key)) {
      problems.push(`${position} has the field "${key}"; only ${SKILL_FRONTMATTER_FIELDS.join(' and ')} are allowed`);
      continue;
    }
    if (seen.has(key)) {
      problems.push(`${position} repeats the field "${key}"; keep one`);
      continue;
    }
    seen.add(key);
    const raw = (match[2] ?? '').replace(/^[ \t]+|[ \t]+$/g, '');
    if (raw === '') {
      problems.push(`the field "${key}" is empty (${position}); give it a value`);
      continue;
    }
    const parsed = parseFrontmatterValue(raw);
    if ('problem' in parsed) {
      problems.push(`the field "${key}" ${parsed.problem} (${position})`);
      continue;
    }
    values.set(key, parsed.value);
  }

  for (const field of SKILL_FRONTMATTER_FIELDS) {
    if (!seen.has(field)) problems.push(`has no "${field}" field in its frontmatter; add it`);
  }

  const name = values.get('name');
  if (name !== undefined) {
    if (!SKILL_NAME.test(name)) {
      problems.push(`the name "${name}" is not lower-case letters and digits in groups joined by single hyphens; rename it`);
    } else {
      if (name.length > SKILL_NAME_MAX_LENGTH) {
        problems.push(`the name is ${name.length} characters; the limit is ${SKILL_NAME_MAX_LENGTH}`);
      }
      const reserved = SKILL_NAME_RESERVED_WORDS.find((word) => name.includes(word));
      if (reserved !== undefined) problems.push(`the name "${name}" contains the reserved word "${reserved}"; rename it`);
    }
    if (name !== dirName) problems.push(`the name "${name}" is not its directory name "${dirName}"; make them equal`);
  }

  const description = values.get('description');
  if (description !== undefined) {
    if (description.trim() === '') {
      problems.push('the description is empty; say what the skill covers and when to use it');
    } else {
      if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
        problems.push(`the description is ${description.length} characters; the limit is ${SKILL_DESCRIPTION_MAX_LENGTH}`);
      }
      if (XML_LIKE_TAG.test(description)) {
        problems.push('the description holds an XML-like tag, which some clients refuse; write the name without angle brackets');
      }
    }
  }

  return problems;
}

/**
 * The names of the immediate subdirectories of `dir`, sorted. A missing `dir` has none.
 *
 * @param {string} dir
 * @returns {string[]}
 */
function listSubdirectories(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Build the pack: pack-relative POSIX path -> file bytes.
 *
 * - every file of each `skills/<n>/` (not `skills/README.md`) goes to `skills/<n>/...`;
 * - every file of each `skills-pack-src/knowledge/<n>/` goes to `skills/<n>/...`;
 * - each `skills-pack-src/rules/<n>.md` goes to `rules/claude-code/<n>.md` (the source bytes) and to
 *   `rules/agents-md/<n>.md` (the source bytes between the two marker lines);
 * - the notice goes to the pack root, beside a generated `README.md`.
 *
 * A missing `knowledge/` or `rules/` directory counts as empty.
 *
 * @param {string} root - Repository root (absolute path).
 * @returns {Map<string, Buffer>}
 * @throws {Error} If a skill name is defined in both sources, a `knowledge/<n>/` has no `SKILL.md`, the
 *   source directory holds an entry the layout does not know, `rules/` holds anything but flat
 *   `<name>.md` files, a rule source opens with frontmatter or has a line that starts with
 *   `<!-- IRIS-MCP-RULE:`, or the notice is missing. Nothing has been
 *   written when it throws: this function never writes.
 */
export function assemblePack(root) {
  const sourceDir = join(root, PACK_SOURCE_DIR);
  const knowledgeDir = join(root, KNOWLEDGE_SOURCE_DIR);
  const rulesDir = join(root, RULES_SOURCE_DIR);
  const knowledgeEntry = posix.relative(PACK_SOURCE_DIR, KNOWLEDGE_SOURCE_DIR);
  const rulesEntry = posix.relative(PACK_SOURCE_DIR, RULES_SOURCE_DIR);

  // Every top-level entry of the source directory is known, or the build fails and names it.
  const allowedFiles = new Set([SOURCE_README_FILENAME, NOTICE_FILENAME]);
  const allowedDirs = new Set([knowledgeEntry, rulesEntry]);
  const unknown = [];
  if (existsSync(sourceDir)) {
    for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
      const known = entry.isDirectory() ? allowedDirs.has(entry.name) : entry.isFile() && allowedFiles.has(entry.name);
      if (!known) unknown.push(entry.name);
    }
  }
  if (unknown.length > 0) {
    throw new Error(
      `unknown entry in ${PACK_SOURCE_DIR}/: ${unknown.sort().join(', ')}. ` +
        `Allowed: ${[...allowedFiles].join(', ')}, ${knowledgeEntry}/, ${rulesEntry}/.`,
    );
  }

  /** @type {Map<string, Buffer>} */
  const pack = new Map();
  /** @type {Map<string, string>} */
  const origin = new Map();
  const add = (packRel, bytes, source) => {
    const earlier = origin.get(packRel);
    if (earlier !== undefined) {
      throw new Error(`${packRel} is produced by both ${earlier} and ${source}.`);
    }
    origin.set(packRel, source);
    pack.set(packRel, bytes);
  };

  const workflowNames = listSubdirectories(join(root, WORKFLOW_SKILLS_DIR));
  for (const name of workflowNames) {
    const skillDir = join(root, WORKFLOW_SKILLS_DIR, name);
    for (const rel of listFilesRecursive(skillDir)) {
      add(`skills/${name}/${rel}`, readFileSync(join(skillDir, rel)), `${WORKFLOW_SKILLS_DIR}/${name}/`);
    }
  }

  for (const name of listSubdirectories(knowledgeDir)) {
    const skillDir = join(knowledgeDir, name);
    // The exact name, letter case included: a case-insensitive file system would accept `skill.md`.
    if (!readdirSync(skillDir).includes(SKILL_FILENAME)) {
      throw new Error(`${KNOWLEDGE_SOURCE_DIR}/${name}/ has no ${SKILL_FILENAME}.`);
    }
    if (workflowNames.includes(name)) {
      throw new Error(
        `skill name collision: "${name}" is defined by both ${WORKFLOW_SKILLS_DIR}/${name}/ and ` +
          `${KNOWLEDGE_SOURCE_DIR}/${name}/.`,
      );
    }
    for (const rel of listFilesRecursive(skillDir)) {
      add(`skills/${name}/${rel}`, readFileSync(join(skillDir, rel)), `${KNOWLEDGE_SOURCE_DIR}/${name}/`);
    }
  }
  if (existsSync(knowledgeDir)) {
    for (const entry of readdirSync(knowledgeDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        throw new Error(`unknown entry in ${KNOWLEDGE_SOURCE_DIR}/: ${entry.name}. Expected one directory per skill.`);
      }
    }
  }

  if (existsSync(rulesDir)) {
    const ruleEntries = readdirSync(rulesDir, { withFileTypes: true });
    const unknownRules = ruleEntries
      .filter((entry) => !(entry.isFile() && RULE_SOURCE_NAME.test(entry.name)))
      .map((entry) => entry.name)
      .sort();
    if (unknownRules.length > 0) {
      throw new Error(
        `unknown entry in ${RULES_SOURCE_DIR}/: ${unknownRules.join(', ')}. ` +
          `Expected one flat <name>.md file per rule (lower-case letters and digits, in groups joined by single hyphens).`,
      );
    }
    for (const entry of ruleEntries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const bytes = readFileSync(join(rulesDir, entry.name));
      if (FRONTMATTER_OPENER.test(bytes.toString('latin1'))) {
        throw new Error(`${RULES_SOURCE_DIR}/${entry.name} has frontmatter; an always-on rule takes none (no paths:)`);
      }
      if (MARKER_LINE_START.test(bytes.toString('latin1'))) {
        throw new Error(
          `${RULES_SOURCE_DIR}/${entry.name} has a line that starts with "<!-- IRIS-MCP-RULE:"; ` +
            `only the AGENTS.md section's own BEGIN and END lines may`,
        );
      }
      const stem = entry.name.slice(0, -'.md'.length);
      const source = `${RULES_SOURCE_DIR}/${entry.name}`;
      add(`${RULE_FORM_DIRS.claudeCode}/${entry.name}`, bytes, source);
      add(`${RULE_FORM_DIRS.agentsMd}/${entry.name}`, renderAgentsMdSection(stem, bytes), source);
    }
  }

  const noticePath = join(sourceDir, NOTICE_FILENAME);
  if (!existsSync(noticePath)) {
    throw new Error(`missing ${PACK_SOURCE_DIR}/${NOTICE_FILENAME}.`);
  }
  add(NOTICE_FILENAME, readFileSync(noticePath), `${PACK_SOURCE_DIR}/${NOTICE_FILENAME}`);
  add(PACK_README_FILENAME, Buffer.from(renderPackReadme(), 'utf8'), 'the generated pack README');

  return pack;
}

/**
 * Every Markdown file of agent content, with a label for messages and the pack-relative path it
 * occupies (or will occupy) in the pack. This is the one enumeration of agent content.
 *
 * - `workflow:<n>/<f>`: each `.md` under `skills/<n>/` (the generated workflow skills);
 * - `pack:<rel>`: each `.md` under the pack's `skills/` and `rules/`;
 * - `knowledge:<n>/<f>`: each `.md` under `skills-pack-src/knowledge/<n>/`;
 * - `rule:<f>`: each `.md` under `skills-pack-src/rules/`.
 *
 * @param {string} root - Repository root (absolute path).
 * @returns {Array<{ label: string, packRel: string, absPath: string }>}
 */
export function listAgentContentFiles(root) {
  const out = [];
  const markdown = (rels) => rels.filter((rel) => rel.endsWith('.md'));

  const workflowDir = join(root, WORKFLOW_SKILLS_DIR);
  for (const name of listSubdirectories(workflowDir)) {
    const skillDir = join(workflowDir, name);
    for (const rel of markdown(listFilesRecursive(skillDir))) {
      out.push({ label: `workflow:${name}/${rel}`, packRel: `skills/${name}/${rel}`, absPath: join(skillDir, rel) });
    }
  }

  const packDir = join(root, PACK_DIR);
  for (const area of ['skills', 'rules']) {
    for (const rel of markdown(listFilesRecursive(join(packDir, area)))) {
      out.push({ label: `pack:${area}/${rel}`, packRel: `${area}/${rel}`, absPath: join(packDir, area, rel) });
    }
  }

  const knowledgeDir = join(root, KNOWLEDGE_SOURCE_DIR);
  for (const name of listSubdirectories(knowledgeDir)) {
    const skillDir = join(knowledgeDir, name);
    for (const rel of markdown(listFilesRecursive(skillDir))) {
      out.push({ label: `knowledge:${name}/${rel}`, packRel: `skills/${name}/${rel}`, absPath: join(skillDir, rel) });
    }
  }

  const rulesDir = join(root, RULES_SOURCE_DIR);
  for (const rel of markdown(listFilesRecursive(rulesDir))) {
    out.push({ label: `rule:${rel}`, packRel: `rules/${rel}`, absPath: join(rulesDir, rel) });
  }

  return out;
}
