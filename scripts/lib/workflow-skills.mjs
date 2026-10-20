// The generated workflow skills: what each `skills/<name>/SKILL.md` is rendered from, and what a prompt
// must carry for it to be rendered.
//
// A workflow skill is generated from the MCP prompt of the same name (AD-28). Its body is the text the
// prompt renders. Its `description` and its tool preset are the prompt's separate skill-only field,
// `skill: { description, preset }`, which only `scripts/gen-skills.mjs` and `scripts/validate-prompts.mjs`
// read: the server never sends it, so `prompts/list` and `prompts/get` stay as they were (AD-15).
//
// Pure functions: no filesystem and no process access. The gen-skills CLI and the default-suite tests
// import this one module.

import { SKILL_PRESET_KEY, SKILL_PRESETS } from './skills-pack.mjs';

/** The one comment line every generated skill carries inside its frontmatter (Rule #18). It names no repository path. */
export const WORKFLOW_SKILL_COMMENT = '# DO NOT EDIT: generated from the MCP prompt of the same name.';

/**
 * What is wrong with a prompt's skill-only field, for the generator and the validator to report.
 *
 * @param {{ skill?: { description?: unknown, preset?: unknown } | null }} prompt
 * @returns {string[]} Empty when the prompt can be rendered as a skill.
 */
export function promptSkillProblems(prompt) {
  const skill = prompt.skill;
  if (skill === undefined || skill === null || typeof skill !== 'object') {
    return ['has no skill field; give its prompt definition a skill with a description and a preset'];
  }
  const problems = [];
  if (typeof skill.description !== 'string' || skill.description.trim() === '') {
    problems.push('has an empty skill description');
  }
  if (typeof skill.preset !== 'string' || !SKILL_PRESETS.includes(skill.preset)) {
    problems.push(`has the skill preset "${String(skill.preset)}", which is not one of core, developer and full`);
  }
  return problems;
}

/**
 * Render one prompt's `skills/<name>/SKILL.md`: frontmatter with the DO-NOT-EDIT comment, `name`, the skill
 * `description` as one JSON string, and the `metadata` map that declares the tool preset; then the prompt
 * body. The body is `build({})`: every prompt falls back to a bracketed `<argName>` placeholder per omitted
 * argument, so the static skill reads as a parameterized template.
 *
 * @param {{ name: string, build: (args: Record<string, string | undefined>) => string, skill: { description: string, preset: string } }} prompt
 *   A prompt for which `promptSkillProblems` is empty.
 * @returns {string}
 */
export function renderWorkflowSkill(prompt) {
  const frontmatter =
    `---\n${WORKFLOW_SKILL_COMMENT}\n` +
    `name: ${prompt.name}\n` +
    `description: ${JSON.stringify(prompt.skill.description)}\n` +
    `metadata:\n  ${SKILL_PRESET_KEY}: ${prompt.skill.preset}\n` +
    `---\n\n`;
  return `${frontmatter}${prompt.build({})}\n`;
}
