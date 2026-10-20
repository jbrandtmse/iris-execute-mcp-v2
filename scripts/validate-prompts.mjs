// ════════════════════════════════════════════════════════════════════════════
// validate-prompts.mjs (Epic 25, Story 25.1, AC 25.1.3; extended in Story 41.5)
//
// Checks every registered prompt's text (title + description + `build({})`
// body + each argument's name and description + the skill description of its
// `skill` field, as `promptSourceText` builds it) AND every Markdown file of
// agent content (scripts/lib/skills-pack.mjs `listAgentContentFiles`: the
// generated workflow skills, the skills pack, and the hand-authored knowledge
// skill and rule sources). Four checks run on that set:
//
//   1. Tool names. Each `iris_[a-z0-9_]+` token names a REAL tool: a member of
//      the union of the five server packages' `tools` arrays plus the framework
//      discovery tool (`iris_server_profiles`). A tool rename/removal breaks CI
//      here, not a client mid-workflow.
//   2. Skill fields. Each prompt has a valid `skill: { description, preset }`
//      field, which `gen:skills` renders into its workflow skill.
//   3. Tool presets. A skill that names a real tool declares, as its `metadata`
//      `iris-tools-preset`, the first of core, developer and full under which every
//      tool it names is visible on the server that owns it. A skill or rule that
//      names no tool declares none. A file that is not a `SKILL.md` names no tool.
//   4. Internal references. No prompt or agent content file holds an internal
//      reference of the nine classes: a rule number, a bare `#` and digits that
//      is not an IRIS error code, a planning or deferred-work id, a story number,
//      a repository path, an absolute path, a repository file, repository tooling
//      or a snapshot folder. The one
//      exemption is the exact adaptation header, as the first body line of a file
//      that a row of the notice's provenance table names (DW-623).
//
// The check logic lives in scripts/lib/validate-prompts-core.mjs, imported by
// BOTH this script AND packages/iris-mcp-all's default-suite vitest tests
// (single source of truth, per the story's Task 3).
//
// USAGE:
//   node scripts/validate-prompts.mjs
//   npm: `pnpm validate:prompts`
//
// Requires a prior `pnpm turbo run build` (imports each package's BUILT
// dist/tools/index.js, dist/tools/presets.js and dist/prompts/index.js).
// ════════════════════════════════════════════════════════════════════════════

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { loadAllPrompts } from './lib/prompt-catalog.mjs';
import { loadAllToolNames, loadToolPresetCatalog } from './lib/tool-catalog.mjs';
import { NOTICE_FILENAME, PACK_SOURCE_DIR, SKILL_PRESET_KEY, listAgentContentFiles } from './lib/skills-pack.mjs';
import { parseProvenanceRows } from './lib/provenance-core.mjs';
import { promptSkillProblems } from './lib/workflow-skills.mjs';
import {
  declaredToolPreset,
  internalReferenceProblems,
  presetProblems,
  promptSourceText,
  validateSources,
} from './lib/validate-prompts-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const [prompts, toolNames, presetCatalog] = await Promise.all([
  loadAllPrompts(root),
  loadAllToolNames(root),
  loadToolPresetCatalog(root),
]);

// A prompt's text surface is what it renders, its arguments as `prompts/list` serves them, and the description of
// its skill, which only its skill reads.
const sources = [];
for (const { pkg, prompt } of prompts) {
  sources.push({ label: `prompt:${pkg}/${prompt.name}`, text: promptSourceText(prompt), packRel: null });
}

// Also scan every file of agent content that exists, since a generator bug (truncation, wrong prompt mapping)
// that corrupts content would otherwise slip past a prompt-only check, and hand-authored content has no
// prompt to check it against.
const contentFiles = listAgentContentFiles(root);
const contentSources = contentFiles.map(({ label, packRel, absPath }) => {
  const text = readFileSync(absPath, 'utf-8');
  return { label, text, packRel, preset: declaredToolPreset(text, packRel) };
});
sources.push(...contentSources);

const toolNameProblems = validateSources(sources, toolNames);

const skillFieldProblems = prompts.flatMap(({ pkg, prompt }) =>
  promptSkillProblems(prompt).map((message) => ({ label: `prompt:${pkg}/${prompt.name}`, message })),
);

const preset = presetProblems(contentSources, presetCatalog);

// The files a row of the notice's provenance table names: the only ones whose adaptation header is exempt.
const noticePath = resolve(root, PACK_SOURCE_DIR, NOTICE_FILENAME);
const adaptedPackFiles = new Set(
  existsSync(noticePath) ? parseProvenanceRows(readFileSync(noticePath, 'utf-8')).rows.map((row) => row.packFile) : [],
);
const references = internalReferenceProblems(sources, { repositoryEntries: readdirSync(root), adaptedPackFiles });

const failed = toolNameProblems.length + skillFieldProblems.length + preset.problems.length + references.problems.length > 0;

if (failed) {
  if (toolNameProblems.length > 0) {
    console.error('validate-prompts: found tool-name references that do not match any real tool:');
    for (const p of toolNameProblems) {
      console.error(`  - ${p.label}: "${p.token}"`);
    }
  }
  if (skillFieldProblems.length > 0) {
    console.error('validate-prompts: found prompts without a valid skill field:');
    for (const p of skillFieldProblems) {
      console.error(`  - [skill-field] ${p.label}: ${p.message}`);
    }
  }
  if (preset.problems.length > 0) {
    console.error('validate-prompts: found tool-preset problems:');
    for (const p of preset.problems) {
      console.error(`  - [preset] ${p.label}: ${p.message}`);
    }
  }
  if (references.problems.length > 0) {
    console.error('validate-prompts: found internal references in agent content:');
    for (const p of references.problems) {
      console.error(`  - [internal-reference] ${p.label}: ${p.className} (${p.match})`);
    }
  }
  console.error('');
  console.error(
    `Checked against ${toolNames.size} known tool name(s) across the five server packages ` +
      `plus the framework discovery tool. Fix the prompt source (packages/*/src/prompts/*.ts, its skill field included) ` +
      `or the hand-authored source (skills-pack-src/), then re-run "pnpm gen:skills" and "pnpm gen:pack" as needed. ` +
      `A skill that names a tool declares its tool preset as the metadata ${SKILL_PRESET_KEY}: for a workflow skill, ` +
      `that is the preset of its prompt's skill field.`,
  );
  process.exit(1);
}

const countOf = (kind) => contentFiles.filter(({ label }) => label.startsWith(`${kind}:`)).length;
console.log(
  `validate-prompts: OK \u2014 ${sources.length} source(s) checked (${prompts.length} prompt(s) + ` +
    `${contentFiles.length} content file(s): ${countOf('workflow')} workflow, ${countOf('pack')} pack, ` +
    `${countOf('knowledge')} knowledge, ${countOf('rule')} rule), ` +
    `${toolNames.size} known tool name(s).`,
);
const declaredTotal = preset.declared.core + preset.declared.developer + preset.declared.full;
console.log(
  `validate-prompts: OK \u2014 tool presets: ${declaredTotal} file(s) declare one ` +
    `(${preset.declared.core} core, ${preset.declared.developer} developer, ${preset.declared.full} full) ` +
    `and ${preset.toolFree} tool-free file(s) declare none; ` +
    `no internal reference in ${sources.length} source(s), ${references.exempted} adaptation header line(s) exempted.`,
);
process.exit(0);
