/**
 * Story 25.1 QA — generated `skills/<name>/SKILL.md` structural guard
 * (AC 25.1.2, Rule #18).
 *
 * ORTHOGONAL to `validate-prompts.test.ts`'s generated-skills describe block
 * (which only checks `iris_*` tool-name TOKENS inside skill bodies) — this
 * test checks the STRUCTURE every generated skill file must carry: a valid
 * YAML frontmatter block with non-empty `name`/`description` fields, a
 * DO-NOT-EDIT banner (Rule #18) naming the regen command, and that a skill
 * directory exists for EVERY one of the 9 v1 registered prompts (no prompt
 * silently missing its generated skill, no orphaned/stale skill directory
 * left over — `gen-skills.mjs`'s write mode is supposed to remove those, per
 * the story's Task 2).
 *
 * Reads `skills/` directly from disk (repo-committed generated output) —
 * does NOT invoke the generator or require a prior build, unlike the
 * prompt-catalog-based tests in this same directory. If `skills/` has not
 * been generated yet in this checkout, the suite is skipped gracefully
 * (mirrors the existing `validate-prompts.test.ts` generated-skills guard).
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");
const skillsDir = resolve(root, "skills");

/** The 9 stakeholder-approved v1 prompt names (AC 25.1.5) — one skill each. */
const EXPECTED_SKILL_NAMES = [
  "check-system-health",
  "run-external-backup",
  "diagnose-slow-query",
  "objectscript-review",
  "deploy-and-test-class",
  "trace-message-flow",
  "recover-stuck-production",
  "provision-project-environment",
  "audit-security-posture",
];

/**
 * Minimal frontmatter parse: split on the first two `---` delimiter lines
 * and return { banner, fields, body }. Deliberately simple (not a full YAML
 * parser) — good enough to assert presence/non-emptiness of `name` and
 * `description`, which is all this structural guard needs.
 */
function parseSkillMd(raw: string): { frontmatter: string; body: string } {
  const lines = raw.split(/\r?\n/);
  expect(lines[0]).toBe("---");
  const closeIdx = lines.indexOf("---", 1);
  expect(closeIdx).toBeGreaterThan(0);
  const frontmatter = lines.slice(1, closeIdx).join("\n");
  const body = lines.slice(closeIdx + 1).join("\n");
  return { frontmatter, body };
}

describe("generated skills/ directory structure (AC 25.1.2)", () => {
  if (!existsSync(skillsDir)) {
    it.skip("skills/ has not been generated in this checkout — run `pnpm gen:skills` first", () => {});
    return;
  }

  it("has exactly one skill directory per v1 registered prompt, no orphans", () => {
    const dirNames = readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();
    expect(dirNames).toEqual([...EXPECTED_SKILL_NAMES].sort());
  });

  it.each(EXPECTED_SKILL_NAMES)("skills/%s/SKILL.md has a DO-NOT-EDIT banner + valid name/description frontmatter", (skillName) => {
    const mdPath = resolve(skillsDir, skillName, "SKILL.md");
    expect(existsSync(mdPath)).toBe(true);
    const raw = readFileSync(mdPath, "utf-8");

    const { frontmatter, body } = parseSkillMd(raw);

    // Rule #18 — DO-NOT-EDIT banner naming the regen command, inside the
    // frontmatter block (as a YAML comment line).
    expect(frontmatter).toMatch(/#\s*DO NOT EDIT/);
    expect(frontmatter).toContain("gen-skills.mjs");
    expect(frontmatter).toContain("pnpm gen:skills");

    // Required fields: name (matches the directory / prompt name) and a
    // non-empty description.
    const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
    expect(nameMatch, `${skillName}/SKILL.md frontmatter missing a "name:" field`).not.toBeNull();
    expect(nameMatch?.[1]?.trim()).toBe(skillName);

    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    expect(descMatch, `${skillName}/SKILL.md frontmatter missing a "description:" field`).not.toBeNull();
    const descValue = descMatch?.[1]?.trim() ?? "";
    expect(descValue.length).toBeGreaterThan(0);
    // Strip optional surrounding quotes before asserting non-empty content.
    expect(descValue.replace(/^"|"$/g, "").trim().length).toBeGreaterThan(0);

    // Body (everything after the closing `---`) must carry real instructional
    // content, not be empty.
    expect(body.trim().length).toBeGreaterThan(0);
  });

  it("skills/README.md exists with its own DO-NOT-EDIT banner and lists all 9 skills", () => {
    const readmePath = resolve(skillsDir, "README.md");
    expect(existsSync(readmePath)).toBe(true);
    const raw = readFileSync(readmePath, "utf-8");
    expect(raw).toMatch(/DO NOT EDIT/);
    expect(raw).toContain("gen-skills.mjs");
    for (const name of EXPECTED_SKILL_NAMES) {
      expect(raw).toContain(name);
    }
  });
});
