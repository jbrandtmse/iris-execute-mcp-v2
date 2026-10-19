/**
 * Story 25.1, AC 25.1.3 — default-suite vitest wiring for
 * `scripts/validate-prompts.mjs`'s validation logic.
 *
 * `@iris-mcp/all` is the only package that depends on all five server
 * packages (`@iris-mcp/dev`/`admin`/`interop`/`ops`/`data`), so it is the
 * only place a cross-package "every iris_* token in a prompt/skill body is a
 * real tool name" test can live without `@iris-mcp/shared` importing a leaf
 * package (which would be circular).
 *
 * This test imports the SAME core validation module the CLI script
 * (`scripts/validate-prompts.mjs`) uses — `scripts/lib/validate-prompts-core.mjs`
 * — so the logic is single-sourced (the story's Task 3 requirement), plus
 * the SAME catalog loaders (`scripts/lib/prompt-catalog.mjs`,
 * `scripts/lib/tool-catalog.mjs`) that import the BUILT dist output of every
 * package. `pnpm turbo run test` declares `test: { dependsOn: ["build"] }`,
 * and `@iris-mcp/all`'s own `build` (a phantom/no-op task, since this
 * package has no own build script) still triggers `^build` for its five
 * `dependencies` transitively — so the dists exist by the time this test
 * runs.
 *
 * Story 41.1 (AC 41.1.5) widens the scanned text from the generated
 * `skills/<name>/SKILL.md` files to every Markdown file of agent content,
 * enumerated by `scripts/lib/skills-pack.mjs` `listAgentContentFiles`: the
 * workflow skills, the skills pack (`pack:`), and the hand-authored knowledge
 * skill (`knowledge:`) and rule (`rule:`) sources.
 *
 * NOT an `*.integration.test.ts` (Rule #21) — this MUST run in the default
 * suite so a renamed/removed tool breaks CI, not a client mid-workflow.
 */

import { describe, it, expect, afterEach } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadAllPrompts } from "../../../../scripts/lib/prompt-catalog.mjs";
import { loadAllToolNames } from "../../../../scripts/lib/tool-catalog.mjs";
import {
  KNOWLEDGE_SOURCE_DIR,
  listAgentContentFiles,
  PACK_DIR,
  PACK_SOURCE_DIR,
  RULES_SOURCE_DIR,
  WORKFLOW_SKILLS_DIR,
} from "../../../../scripts/lib/skills-pack.mjs";
import {
  renderPromptText,
  validateSources,
  extractIrisTokens,
} from "../../../../scripts/lib/validate-prompts-core.mjs";
import { makeTempRoot, put, removeTempRoot, REPO_ROOT, runNode } from "./pack-fixture";

const root = REPO_ROOT;

interface ContentFile {
  label: string;
  packRel: string;
  absPath: string;
}

/** The labeled text of every collected content file. */
function contentSources(files: ContentFile[]): Array<{ label: string; text: string }> {
  return files.map(({ label, absPath }) => ({ label, text: readFileSync(absPath, "utf-8") }));
}

const BAD_TOKEN = "iris_not_a_real_tool";

const tempRoots: string[] = [];
afterEach(() => {
  for (const dir of tempRoots.splice(0)) removeTempRoot(dir);
});

describe("validate-prompts core logic (AC 25.1.3)", () => {
  it("extractIrisTokens finds every iris_* token, de-duplicated, in first-seen order", () => {
    const text =
      "Call `iris_health_check` then `iris_journal_info`, then `iris_health_check` again. Not a tool: iris_.";
    expect(extractIrisTokens(text)).toEqual(["iris_health_check", "iris_journal_info"]);
  });

  it("validateSources flags a token that is not in the known-tool set", () => {
    const problems = validateSources(
      [{ label: "fixture", text: "Call `iris_totally_made_up_tool` first." }],
      new Set(["iris_health_check"]),
    );
    expect(problems).toEqual([{ label: "fixture", token: "iris_totally_made_up_tool" }]);
  });

  it("validateSources reports nothing when every token is a known tool", () => {
    const problems = validateSources(
      [{ label: "fixture", text: "Call `iris_health_check` then `iris_journal_info`." }],
      new Set(["iris_health_check", "iris_journal_info"]),
    );
    expect(problems).toEqual([]);
  });
});

describe("every registered prompt references only real, live tool names (AC 25.1.3)", () => {
  it("all iris_* tokens across all 12 registered prompts resolve to a real tool", async () => {
    const [prompts, toolNames] = await Promise.all([
      loadAllPrompts(root),
      loadAllToolNames(root),
    ]);

    // Sanity: the pack is exactly 12 registered prompts across 4 packages —
    // the 9 v1 stakeholder-approved prompts (AC 25.1.5) minus
    // `objectscript-review` (retired in Story 41.2) plus
    // `resend-failed-messages`, un-gated in Story 26.3 once
    // `iris_message_resend` shipped (Story 26.2), plus
    // `promote-environment-change`, un-gated in Story 27.4 once
    // `iris_env_diff`/`iris_env_promote` shipped (Stories 27.0-27.3), plus
    // `edit-and-test-class`, added in Story 38.6. Both
    // gated prompts from the original pack are now registered — none remain, and
    // `find-patient-messages` was added in Story 39.6.
    expect(prompts).toHaveLength(12);

    const sources = prompts.map(({ pkg, prompt }) => ({
      label: `prompt:${pkg}/${prompt.name}`,
      text: renderPromptText(prompt),
    }));

    const problems = validateSources(sources, toolNames);
    expect(problems).toEqual([]);
  });

  it("resend-failed-messages (Story 26.3) AND promote-environment-change (Story 27.4) are BOTH registered — no gated prompt remains", async () => {
    const prompts = await loadAllPrompts(root);
    const names = prompts.map(({ prompt }) => prompt.name);
    expect(names).toContain("resend-failed-messages");
    expect(names).toContain("promote-environment-change");
  });
});

describe("agent content collection (fixture root, AC 41.1.5)", () => {
  function fixtureRoot(): string {
    const dir = makeTempRoot("validate-prompts-test");
    tempRoots.push(dir);
    return dir;
  }

  it("collects workflow, pack, knowledge and rule Markdown with their labels, and a bad token is flagged in each", () => {
    const dir = fixtureRoot();
    const text = `Call \`${BAD_TOKEN}\` first.\n`;
    // Collected.
    put(dir, `${WORKFLOW_SKILLS_DIR}/wf/SKILL.md`, text);
    put(dir, `${WORKFLOW_SKILLS_DIR}/wf/references/notes.md`, text);
    put(dir, `${PACK_DIR}/skills/wf/SKILL.md`, text);
    put(dir, `${PACK_DIR}/rules/r.md`, text);
    put(dir, `${KNOWLEDGE_SOURCE_DIR}/k/SKILL.md`, text);
    put(dir, `${KNOWLEDGE_SOURCE_DIR}/k/references/x.md`, text);
    put(dir, `${RULES_SOURCE_DIR}/r.md`, text);
    // Not agent content: the indexes, and a file that is not Markdown.
    put(dir, `${WORKFLOW_SKILLS_DIR}/README.md`, text);
    put(dir, `${PACK_DIR}/README.md`, text);
    put(dir, `${PACK_SOURCE_DIR}/README.md`, text);
    put(dir, `${KNOWLEDGE_SOURCE_DIR}/k/data.json`, text);

    const files = listAgentContentFiles(dir) as ContentFile[];
    const labels = [
      "workflow:wf/SKILL.md",
      "workflow:wf/references/notes.md",
      "pack:skills/wf/SKILL.md",
      "pack:rules/r.md",
      "knowledge:k/SKILL.md",
      "knowledge:k/references/x.md",
      "rule:r.md",
    ];
    expect(files.map((file) => file.label).sort()).toEqual([...labels].sort());
    expect(files.find((file) => file.label === "knowledge:k/references/x.md")?.packRel).toBe("skills/k/references/x.md");
    expect(files.find((file) => file.label === "rule:r.md")?.packRel).toBe("rules/r.md");
    expect(files.find((file) => file.label === "workflow:wf/SKILL.md")?.packRel).toBe("skills/wf/SKILL.md");

    const problems = validateSources(contentSources(files), new Set(["iris_health_check"]));
    expect(problems.map((problem: { label: string }) => problem.label).sort()).toEqual([...labels].sort());
    expect(new Set(problems.map((problem: { token: string }) => problem.token))).toEqual(new Set([BAD_TOKEN]));
  });

  it("a root with none of the source directories collects nothing", () => {
    expect(listAgentContentFiles(fixtureRoot())).toEqual([]);
  });
});

describe("every pack and source content file names only real tools (AC 41.1.5)", () => {
  it("every pack and source content file resolves to a real tool", async () => {
    const [prompts, toolNames] = await Promise.all([loadAllPrompts(root), loadAllToolNames(root)]);
    const files = listAgentContentFiles(root) as ContentFile[];
    const count = (kind: string): number => files.filter((file) => file.label.startsWith(`${kind}:`)).length;

    // The scan reaches the workflow skills and the pack copies; an empty scan would pass vacuously.
    expect(count("workflow")).toBe(prompts.length);
    expect(count("pack")).toBeGreaterThanOrEqual(count("workflow"));

    const problems = validateSources(contentSources(files), toolNames);
    expect(problems).toEqual([]);
  });

  it("the validate:prompts CLI exits 0 and counts the content files by kind", () => {
    const run = runNode(root, "scripts/validate-prompts.mjs");
    expect(run.status, run.stderr).toBe(0);
    const counts = /(\d+) source\(s\) checked \((\d+) prompt\(s\) \+ (\d+) content file\(s\): (\d+) workflow, (\d+) pack, (\d+) knowledge, (\d+) rule\)/.exec(
      run.stdout,
    );
    expect(counts, run.stdout).not.toBeNull();
    const [sources, prompts, content, workflow, pack, knowledge, rule] = (counts ?? []).slice(1).map(Number);
    expect(prompts).toBe(12);
    expect(workflow).toBe(12);
    expect(pack, "the committed pack copies are scanned").toBeGreaterThanOrEqual(workflow ?? 0);
    expect(content).toBe((workflow ?? 0) + (pack ?? 0) + (knowledge ?? 0) + (rule ?? 0));
    expect(sources).toBe((prompts ?? 0) + (content ?? 0));
  });

  it("the validate:prompts CLI exits 1 and names a temporary rule file holding a bad token", () => {
    const ruleName = "zz-probe-rule.md";
    const rulesDir = join(root, RULES_SOURCE_DIR);
    const rulesDirExisted = existsSync(rulesDir);
    put(root, `${RULES_SOURCE_DIR}/${ruleName}`, `Call \`${BAD_TOKEN}\`.\n`);
    try {
      const run = runNode(root, "scripts/validate-prompts.mjs");
      expect(run.status).toBe(1);
      expect(run.stderr).toContain(`rule:${ruleName}`);
      expect(run.stderr).toContain(BAD_TOKEN);
    } finally {
      rmSync(rulesDirExisted ? join(rulesDir, ruleName) : rulesDir, { recursive: true, force: true });
    }
  });
});
