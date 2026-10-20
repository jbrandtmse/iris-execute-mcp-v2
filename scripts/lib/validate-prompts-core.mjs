// Shared tool-name-reference validation logic (Epic 25, Story 25.1, AC 25.1.3).
//
// Pure functions with NO filesystem/dist-loading concerns, so the SAME
// module is imported by both `scripts/validate-prompts.mjs` (the CLI /
// default-suite-wired entry point per the story's Task 3) and
// `packages/iris-mcp-all/src/__tests__/validate-prompts.test.ts` (the
// default-suite vitest test) — "keep the validation logic single-sourced"
// per the story's Dev Notes.

// Story 41.5 adds two checks beside the tool-name one: tool-preset visibility (`presetProblems`) and
// no internal references in agent content (`internalReferenceProblems`, with the one DW-623 exemption).

import { withoutAdaptationHeader } from './provenance-core.mjs';
import { SKILL_PRESET_KEY, SKILL_PRESETS, readSkillFrontmatter } from './skills-pack.mjs';

/** Matches every `iris_<lowercase/digits/underscore>` token in a string. */
const IRIS_TOKEN_RE = /\biris_[a-z0-9_]+\b/g;

/** The framework discovery tool: registered by every server, in no package's `tools` array, never hidden. */
const DISCOVERY_TOOL = 'iris_server_profiles';

/**
 * Extract every `iris_[a-z0-9_]+` token from `text`, de-duplicated,
 * preserving first-seen order.
 *
 * @param {string} text
 * @returns {string[]}
 */
export function extractIrisTokens(text) {
  const seen = new Set();
  const tokens = [];
  for (const match of text.matchAll(IRIS_TOKEN_RE)) {
    const token = match[0];
    if (!seen.has(token)) {
      seen.add(token);
      tokens.push(token);
    }
  }
  return tokens;
}

/**
 * Render a `PromptDefinition`'s full text surface (title + description +
 * body) for token scanning. The body is rendered via `prompt.build({})` —
 * an OMITTED-everything call — which every Story 25.1 prompt author has
 * designed to fall back to a bracketed `<argName>` placeholder per
 * argument (see each prompt's local `arg()` helper), so the FULL
 * instructional text — including every literal tool-name reference — is
 * still produced even with no concrete argument values supplied.
 *
 * @param {{ title: string, description: string, build: (args: Record<string, string | undefined>) => string }} prompt
 * @returns {string}
 */
export function renderPromptText(prompt) {
  return `${prompt.title}\n${prompt.description}\n${prompt.build({})}`;
}

/**
 * The text of a prompt that `validate:prompts` checks: what `renderPromptText` renders, then each argument's
 * name and description (both served by `prompts/list`), then the description of its skill-only `skill`
 * field, which only its generated skill carries. The CLI and its tests build a prompt's source from this.
 *
 * @param {{ title: string, description: string, arguments: Array<{ name: string, description: string }>, build: (args: Record<string, string | undefined>) => string, skill?: { description?: string } | null }} prompt
 * @returns {string}
 */
export function promptSourceText(prompt) {
  const argumentLines = prompt.arguments.map((argument) => `${argument.name}: ${argument.description}`).join('\n');
  return `${renderPromptText(prompt)}\n${argumentLines}\n${prompt.skill?.description ?? ''}`;
}

/**
 * The tool preset an agent content file declares: the `metadata` `iris-tools-preset` of a `SKILL.md`
 * (`packRel` `skills/<name>/SKILL.md`), or `null` when the file declares none. Any other file cannot declare
 * one, so it is `null` too. The value is returned as written, valid or not, for `presetProblems` to judge.
 *
 * @param {string} text
 * @param {string} packRel
 * @returns {string | null}
 */
export function declaredToolPreset(text, packRel) {
  const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(packRel);
  if (skill === null) return null;
  return readSkillFrontmatter(text, skill[1] ?? '').metadata[SKILL_PRESET_KEY] ?? null;
}

/**
 * Validate a set of labeled text sources against a set of known-valid tool
 * names, returning every (label, token) pair where the token does not match
 * a real tool name.
 *
 * @param {Array<{ label: string, text: string }>} sources
 * @param {Set<string>} validNames
 * @returns {Array<{ label: string, token: string }>}
 */
export function validateSources(sources, validNames) {
  const problems = [];
  for (const { label, text } of sources) {
    for (const token of extractIrisTokens(text)) {
      if (!validNames.has(token)) {
        problems.push({ label, token });
      }
    }
  }
  return problems;
}

// -- No internal references (Story 41.5, AD-28) -------------------------------

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The nine classes of internal reference that agent content never holds: a prompt's title, description,
 * body, argument names and descriptions and skill description, a workflow skill, a pack file, a knowledge
 * skill and the rule. Each entry is `[name, pattern, sample]`; `sample` is a short text that the class flags.
 *
 * Each class covers the spellings below; a spelling outside them passes.
 * - A rule number: `Rule #7`, `Rules #7`, `Rule#7` (any case). A number with no `#` (`Rule 7`) passes,
 *   because the rules of an interoperability routing rule set are numbered in legitimate text.
 * - A bare `#` and digits: `item #58`, but not after a letter, digit, `_` or `&` (the ObjectScript
 *   operators in `i#2` and `Read x#5`, an HTML entity) and not after `ERROR ` in any case (an IRIS error code).
 * - A planning or deferred-work id: `DW-615`, `DW 615`, `AC41`, and the same for `AD`, `AC`, `NFR` and `FR`.
 * - A story or epic number: `Story 41.2`, `Stories 41.2`, `story-41-5`, `Epic41`, `Sprint 3` (any case).
 * - A repository path: a top-level entry of the repository followed by `/`, alone or after `./` or `../`,
 *   only where a path starts (not after a letter, digit, `_`, `.`, `/` or `-`), so a user's own
 *   `c:/path/to/src/**` passes.
 * - A repository file: a name ending `.md`, `.ts`, `.mjs`, `.json`, `.yaml`, `.yml` or `.toml`.
 * - Repository tooling: `pnpm`, `turbo`, `vitest`, `tsc`, and a `gen:`, `validate:` or `check:` script name.
 *
 * `npm` and `npx` are deliberately not classes (an install command can be legitimate content), and neither
 * is `ExecuteMCPv2` (that IRIS package is deployed into the user's instance).
 *
 * @param {readonly string[]} repositoryEntries - The names in the repository root directory.
 * @returns {Array<[name: string, pattern: RegExp, sample: string]>}
 */
export function INTERNAL_REFERENCE_CLASSES(repositoryEntries) {
  const repositoryPath =
    repositoryEntries.length === 0
      ? /(?!)/
      : new RegExp(`(?<![A-Za-z0-9_./-])(?:\\.\\.?/)?(?:${repositoryEntries.map(escapeRegExp).join('|')})/`);
  return [
    ['an internal rule number', /\bRules? ?#\d+/i, 'see Rule #7'],
    ['a number sign and digits that are not an IRIS error code', /(?<![\w&])(?<![Ee][Rr][Rr][Oo][Rr] )#\d+(?!\d|:)/, 'item #58'],
    ['a planning or deferred-work id', /\b(?:DW|AD|AC|NFR|FR)[- ]?\d+/, 'tracked as DW-615'],
    ['a story or epic number', /\b(?:Stor(?:y|ies)|Epics?|Sprints?)[\s-]*\d/i, 'added in Story 41.2'],
    ['a repository path', repositoryPath, 'see packages/shared'],
    ['an absolute path', /(?<![A-Za-z0-9_.-])\/(?:Users|home|private|tmp|usr|opt|var)\//, 'open /Users/someone/file'],
    ['a repository file', /\b[\w-]+\.(?:md|ts|mjs|json|ya?ml|toml)\b/i, 'edit rules.md'],
    ['repository tooling', /\b(?:pnpm|turbo|vitest|tsc)\b|\b(?:gen|validate|check):[a-z]/, 'run pnpm test'],
    ['a snapshot folder', /\birislib\b|\birissys\b/, 'read irislib'],
  ];
}

/**
 * Check labeled sources for internal references, one problem per source and class (the first match).
 *
 * The one exemption (DW-623): a source whose `packRel` is in `adaptedPackFiles` (a pack file that a row of
 * the notice's provenance table names) is read without its adaptation header line, which names the notice
 * file; `withoutAdaptationHeader` removes only the exact header as the first body line. Any other copy of
 * the header, a header in a file no row names, and a header with a changed character are read like any
 * other line, so they are flagged.
 *
 * @param {Array<{ label: string, text: string, packRel?: string | null }>} sources
 * @param {{ repositoryEntries: readonly string[], adaptedPackFiles: ReadonlySet<string> }} options
 * @returns {{ problems: Array<{ label: string, className: string, match: string }>, exempted: number }}
 *   `exempted` is the number of sources whose header line was skipped.
 */
export function internalReferenceProblems(sources, { repositoryEntries, adaptedPackFiles }) {
  const classes = INTERNAL_REFERENCE_CLASSES(repositoryEntries);
  const problems = [];
  let exempted = 0;
  for (const { label, text, packRel } of sources) {
    let read = text;
    if (typeof packRel === 'string' && adaptedPackFiles.has(packRel)) {
      read = withoutAdaptationHeader(text);
      if (read !== text) exempted += 1;
    }
    for (const [className, pattern] of classes) {
      const found = pattern.exec(read);
      if (found !== null) problems.push({ label, className, match: found[0] });
    }
  }
  return { problems, exempted };
}

// -- Tool presets (Story 41.5, AD-28, AD-7) -----------------------------------

/**
 * Whether `preset` shows `token` to an agent: `full` shows everything, the discovery tool is always shown,
 * and under `core` or `developer` a tool is shown when a package that owns it lists it in that preset's
 * `include`. `loadToolPresetCatalog` supplies the `core` and `developer` roster of every server package.
 *
 * @param {string} token
 * @param {string} preset
 * @param {{ owners: ReadonlyMap<string, readonly string[]>, rosters: Record<string, any> }} catalog
 * @returns {boolean}
 */
function visibleUnder(token, preset, catalog) {
  if (preset === 'full' || token === DISCOVERY_TOOL) return true;
  return (catalog.owners.get(token) ?? []).some((pkg) => catalog.rosters[pkg][preset].include.includes(token));
}

/**
 * Check that each source declares the tool preset it needs. A source's counted tokens are the `iris_*`
 * tokens, in first-seen order, that name a real tool (an owning package, or the discovery tool); an unknown
 * token is left to the tool-name check. The preset a source needs is `first`: the first of SKILL_PRESETS
 * under which every counted token is visible on the package that owns it. The presets are not nested, so
 * the rule is that fixed order, not "the smallest".
 *
 * - no tokens and no declaration: tool-free, no problem;
 * - tokens and no declaration: a problem naming `first` (a `SKILL.md`) or telling the author to name no
 *   tool (any other file, which cannot declare one);
 * - a declaration outside SKILL_PRESETS, one that hides a counted token, one wider than `first`, and one
 *   with no counted token are each a problem.
 *
 * @param {Array<{ label: string, text: string, packRel: string, preset: string | null }>} sources
 *   `preset` is the declared value, or `null` when there is none.
 * @param {{ owners: ReadonlyMap<string, readonly string[]>, rosters: Record<string, any> }} catalog
 * @returns {{ problems: Array<{ label: string, message: string }>, declared: { core: number, developer: number, full: number }, toolFree: number }}
 *   `declared` counts the sources with a valid declaration; `toolFree` counts those with neither tokens
 *   nor a declaration.
 */
export function presetProblems(sources, catalog) {
  const problems = [];
  const declared = { core: 0, developer: 0, full: 0 };
  let toolFree = 0;
  const isTool = (token) => token === DISCOVERY_TOOL || catalog.owners.has(token);
  for (const { label, text, packRel, preset } of sources) {
    const tokens = extractIrisTokens(text).filter(isTool);
    const first = SKILL_PRESETS.find((candidate) => tokens.every((token) => visibleUnder(token, candidate, catalog))) ?? 'full';
    const add = (message) => problems.push({ label, message });

    if (preset === null) {
      if (tokens.length === 0) {
        toolFree += 1;
      } else if (/^skills\/[^/]+\/SKILL\.md$/.test(packRel)) {
        add(`names ${tokens.join(', ')} but declares no tool preset; declare metadata iris-tools-preset: ${first}`);
      } else {
        add(`names ${tokens.join(', ')} but declares no tool preset; only a SKILL.md can declare one, so name no tool here`);
      }
      continue;
    }
    if (!SKILL_PRESETS.includes(preset)) {
      add(`declares the tool preset "${preset}", which is not one of core, developer and full`);
      continue;
    }
    declared[preset] += 1;
    if (tokens.length === 0) {
      add(`declares the ${preset} tool preset but names no tool; remove the declaration`);
      continue;
    }
    const hidden = tokens.filter((token) => !visibleUnder(token, preset, catalog));
    if (hidden.length > 0) {
      const named = hidden.map((token) => `${token} (${(catalog.owners.get(token) ?? []).join('/')})`).join(', ');
      add(`declares the ${preset} tool preset, which hides ${named}; declare ${first}`);
    } else if (preset !== first) {
      add(`declares the ${preset} tool preset, but every tool it names is visible under ${first}; declare ${first}`);
    }
  }
  return { problems, declared, toolFree };
}
