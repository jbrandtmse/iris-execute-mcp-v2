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
 * NOT an `*.integration.test.ts` (Rule #21) — this MUST run in the default
 * suite so a renamed/removed tool breaks CI, not a client mid-workflow.
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { loadAllPrompts } from "../../../../scripts/lib/prompt-catalog.mjs";
import { loadAllToolNames } from "../../../../scripts/lib/tool-catalog.mjs";
import {
  renderPromptText,
  validateSources,
  extractIrisTokens,
} from "../../../../scripts/lib/validate-prompts-core.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");

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
  it("all iris_* tokens across all 10 registered prompts resolve to a real tool", async () => {
    const [prompts, toolNames] = await Promise.all([
      loadAllPrompts(root),
      loadAllToolNames(root),
    ]);

    // Sanity: the pack is exactly 10 non-gated prompts across 4 packages —
    // the 9 v1 stakeholder-approved prompts (AC 25.1.5) plus
    // `resend-failed-messages`, un-gated in Story 26.3 once
    // `iris_message_resend` shipped (Story 26.2). `promote-environment-change`
    // remains gated and must NOT be registered yet.
    expect(prompts).toHaveLength(10);

    const sources = prompts.map(({ pkg, prompt }) => ({
      label: `prompt:${pkg}/${prompt.name}`,
      text: renderPromptText(prompt),
    }));

    const problems = validateSources(sources, toolNames);
    expect(problems).toEqual([]);
  });

  it("resend-failed-messages IS registered (Story 26.3); promote-environment-change remains gated and is NOT registered", async () => {
    const prompts = await loadAllPrompts(root);
    const names = prompts.map(({ prompt }) => prompt.name);
    expect(names).toContain("resend-failed-messages");
    expect(names).not.toContain("promote-environment-change");
  });
});

describe("generated skills/ output (if present) matches the same tool-name validation (AC 25.1.3)", () => {
  it("every iris_* token in every generated skills/<name>/SKILL.md resolves to a real tool", async () => {
    const skillsDir = resolve(root, "skills");
    if (!existsSync(skillsDir)) {
      // gen:skills has not been run in this checkout/CI step yet — nothing to
      // validate here; the prompt-source test above is the authoritative gate.
      return;
    }
    const toolNames = await loadAllToolNames(root);
    const sources: Array<{ label: string; text: string }> = [];
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const md = resolve(skillsDir, entry.name, "SKILL.md");
      if (existsSync(md)) {
        sources.push({ label: `skill:${entry.name}`, text: readFileSync(md, "utf-8") });
      }
    }
    const problems = validateSources(sources, toolNames);
    expect(problems).toEqual([]);
  });
});
