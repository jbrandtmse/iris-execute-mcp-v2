// ════════════════════════════════════════════════════════════════════════════
// validate-prompts.mjs (Epic 25, Story 25.1, AC 25.1.3)
//
// Extracts every `iris_[a-z0-9_]+` token from every registered prompt's
// text (title + description + `build({})` body) AND every generated
// `skills/<name>/SKILL.md` file (if `skills/` has been generated), and
// asserts each token names a REAL tool: a member of the union of the five
// server packages' `tools` arrays plus the framework discovery tool
// (`iris_server_profiles`). A tool rename/removal breaks CI here, not a
// client mid-workflow.
//
// The core extraction/validation logic lives in
// scripts/lib/validate-prompts-core.mjs, imported by BOTH this script AND
// packages/iris-mcp-all's default-suite vitest test (single source of
// truth, per the story's Task 3).
//
// USAGE:
//   node scripts/validate-prompts.mjs
//   npm: `pnpm validate:prompts`
//
// Requires a prior `pnpm turbo run build` (imports each package's BUILT
// dist/tools/index.js and dist/prompts/index.js).
// ════════════════════════════════════════════════════════════════════════════

import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { loadAllPrompts } from './lib/prompt-catalog.mjs';
import { loadAllToolNames } from './lib/tool-catalog.mjs';
import { renderPromptText, validateSources } from './lib/validate-prompts-core.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

const [prompts, toolNames] = await Promise.all([loadAllPrompts(root), loadAllToolNames(root)]);

const sources = [];
for (const { pkg, prompt } of prompts) {
  sources.push({ label: `prompt:${pkg}/${prompt.name}`, text: renderPromptText(prompt) });
}

// Also scan the generated skills/ output, if it has been generated — a
// generator bug (truncation, wrong prompt mapping) that corrupts content
// would otherwise slip past a prompt-only check.
const skillsDir = resolve(root, 'skills');
if (existsSync(skillsDir)) {
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const md = resolve(skillsDir, entry.name, 'SKILL.md');
    if (existsSync(md)) {
      sources.push({ label: `skill:${entry.name}`, text: readFileSync(md, 'utf-8') });
    }
  }
}

const problems = validateSources(sources, toolNames);

if (problems.length > 0) {
  console.error('validate-prompts: found tool-name references that do not match any real tool:');
  for (const p of problems) {
    console.error(`  - ${p.label}: "${p.token}"`);
  }
  console.error('');
  console.error(
    `Checked against ${toolNames.size} known tool name(s) across the five server packages ` +
      `plus the framework discovery tool. Fix the prompt source (packages/*/src/prompts/*.ts), ` +
      `then re-run "pnpm gen:skills" if skills/ needs regenerating.`,
  );
  process.exit(1);
}

console.log(
  `validate-prompts: OK — ${sources.length} source(s) checked (${prompts.length} prompt(s)` +
    `${sources.length > prompts.length ? ` + ${sources.length - prompts.length} generated skill(s)` : ''}), ` +
    `${toolNames.size} known tool name(s).`,
);
process.exit(0);
