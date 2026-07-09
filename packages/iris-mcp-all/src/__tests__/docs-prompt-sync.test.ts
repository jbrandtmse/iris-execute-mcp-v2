/**
 * Story 25.2 QA — doc-rot guard for the prompts documentation rollup
 * (AC 25.2.1, Rule #30, Rule #31).
 *
 * Story 25.2 is docs-only: it added a "Workflow Prompts & Agent Skills"
 * section to the root README, a "## Prompts" section to each prompt-owning
 * server's README, a CHANGELOG entry, and a `tool_support.md` note — but
 * touched no source or test files. Nothing in the existing suite would fail
 * if a future edit silently let the docs drift out of sync with the actual
 * registered prompts (e.g. a prompt renamed in code but not in the README,
 * or a server's prompt count changed without updating its README table).
 *
 * This test is the mechanical guard against that drift. It is ORTHOGONAL to
 * `validate-prompts.test.ts` (which validates `iris_*` tool-name TOKENS
 * inside prompt/skill BODIES against the live tool catalog — it says
 * nothing about the README files) and to `prompt-safety-invariants.test.ts`
 * (safety-critical wording inside prompt bodies, unrelated to docs). It
 * asserts three things:
 *
 *   1. Every registered prompt's `name` appears in the root README.md.
 *   2. Each owning server's per-server README.md lists exactly its own
 *      prompts (ops 2, dev 3, interop 3, admin 2), and `iris-data-mcp`'s
 *      README does not claim any of the 10 registered prompt names.
 *   3. The root README's "102 tools" claim is still present — a literal
 *      guard against prompts silently inflating the documented tool count
 *      (Rule #31: prompts are a framework/protocol surface, not tools).
 *
 * Uses the SAME `loadAllPrompts` catalog loader (built-dist import) that
 * `validate-prompts.test.ts` / `prompt-safety-invariants.test.ts` use, so it
 * requires the same prior `pnpm turbo run build` (already a `test` task
 * dependency via turbo — see turbo.json `test.dependsOn: ["build"]`).
 *
 * NOT an `*.integration.test.ts` (Rule #21) — this runs in the default
 * suite so a doc/code drift breaks CI, not a client mid-workflow.
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { loadAllPrompts, PROMPT_PACKAGES } from "../../../../scripts/lib/prompt-catalog.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");

/** Expected prompt count per owning server package (Story 25.2 AC 25.2.1 / Task 2). */
const EXPECTED_COUNTS: Record<string, number> = {
  "iris-ops-mcp": 2,
  "iris-dev-mcp": 3,
  "iris-interop-mcp": 3,
  "iris-admin-mcp": 2,
};

function readReadme(pkg: string): string {
  return readFileSync(resolve(root, `packages/${pkg}/README.md`), "utf-8");
}

describe("prompts documentation stays in sync with the registered prompt catalog (Story 25.2, AC 25.2.1)", () => {
  it("every registered prompt name is documented in the root README", async () => {
    const prompts = await loadAllPrompts(root);
    expect(prompts.length).toBeGreaterThan(0);

    const rootReadme = readFileSync(resolve(root, "README.md"), "utf-8");
    const missing = prompts
      .map(({ prompt }) => prompt.name)
      .filter((name) => !rootReadme.includes(name));

    expect(missing).toEqual([]);
  });

  it("each prompt-owning server's README lists exactly its own registered prompts, at the expected count", async () => {
    const prompts = await loadAllPrompts(root);

    for (const pkg of PROMPT_PACKAGES) {
      const own = prompts.filter((p) => p.pkg === pkg).map((p) => p.prompt.name);
      expect(own.length, `${pkg} registered prompt count`).toBe(EXPECTED_COUNTS[pkg]);

      const serverReadme = readReadme(pkg);
      const missing = own.filter((name) => !serverReadme.includes(name));
      expect(missing, `${pkg} README missing prompt names`).toEqual([]);
    }
  });

  it("iris-data-mcp's README does not claim any of the 10 registered prompt names (it ships none in v1)", async () => {
    const prompts = await loadAllPrompts(root);
    const dataReadme = readReadme("iris-data-mcp");

    const wronglyClaimed = prompts
      .map(({ prompt }) => prompt.name)
      .filter((name) => dataReadme.includes(name));

    expect(wronglyClaimed).toEqual([]);
  });

  it("no prompt-owning server's README claims a DIFFERENT server's prompt (cross-attribution guard — Story 25.1 CR 25.1-1)", async () => {
    // The "lists exactly its own prompts" test above asserts only positive
    // inclusion, so a prompt duplicated into the WRONG server's Prompts table
    // (the exact CR 25.1-1 cross-server mis-attribution failure mode) would
    // slip through. This is the missing negative check: each owning server's
    // README must NOT contain any OTHER owning server's prompt name.
    const prompts = await loadAllPrompts(root);

    for (const pkg of PROMPT_PACKAGES) {
      const ownNames = new Set(
        prompts.filter((p) => p.pkg === pkg).map((p) => p.prompt.name),
      );
      const foreignNames = prompts
        .map((p) => p.prompt.name)
        .filter((name) => !ownNames.has(name));

      const serverReadme = readReadme(pkg);
      const wronglyClaimed = foreignNames.filter((name) => serverReadme.includes(name));
      expect(wronglyClaimed, `${pkg} README claims a foreign server's prompt`).toEqual([]);
    }
  });

  it("the root README still advertises 102 tools — prompts must not inflate the documented tool count (Rule #31)", () => {
    const rootReadme = readFileSync(resolve(root, "README.md"), "utf-8");
    expect(rootReadme).toContain("102 tools");
  });

  // CR 25.2-1 (resolved Story 26.4): the primary drift vectors (rename/add/
  // remove/mis-attribution) were already mechanically enforced above, but the
  // human-readable NUMERIC prose (the README's "10 prompts" heading and
  // tool_support.md's per-server tallies) was not -- a green suite could
  // coexist with a stale total if a future prompt is added/removed without
  // updating the prose. These two tests close that gap.

  it("the root README's prompt-count heading matches prompts.length exactly", async () => {
    const prompts = await loadAllPrompts(root);
    const rootReadme = readFileSync(resolve(root, "README.md"), "utf-8");
    const countRe = new RegExp(`\\b${prompts.length}\\s+prompts\\b`);
    expect(
      rootReadme,
      `README.md does not contain a "${prompts.length} prompts" string matching prompts.length=${prompts.length}`,
    ).toMatch(countRe);
  });

  it("tool_support.md's per-server prompt tallies match the registered per-package counts exactly", async () => {
    const prompts = await loadAllPrompts(root);
    const toolSupport = readFileSync(resolve(root, "tool_support.md"), "utf-8");

    const shortNameToPkg: Record<string, string> = {
      ops: "iris-ops-mcp",
      dev: "iris-dev-mcp",
      interop: "iris-interop-mcp",
      admin: "iris-admin-mcp",
    };

    for (const [shortName, pkg] of Object.entries(shortNameToPkg)) {
      const expectedCount = prompts.filter((p) => p.pkg === pkg).length;
      const tallyRe = new RegExp("`" + shortName + "`\\s+(\\d+)");
      const match = toolSupport.match(tallyRe);
      expect(match, `tool_support.md missing a \`${shortName}\` N prompt tally`).not.toBeNull();
      expect(Number(match?.[1]), `tool_support.md \`${shortName}\` prompt tally`).toBe(
        expectedCount,
      );
    }

    // iris-data-mcp ships no prompts in v1 -- asserted via the "none" wording
    // (not a numeric tally) plus the actual registered count.
    expect(toolSupport).toMatch(/`data`\s+none/);
    expect(prompts.filter((p) => p.pkg === "iris-data-mcp")).toHaveLength(0);

    // The sentence's own stated total ("a pack of N **MCP prompts**") must
    // also match prompts.length.
    const totalRe = new RegExp(`pack of ${prompts.length}\\s+\\*\\*MCP prompts\\*\\*`);
    expect(toolSupport).toMatch(totalRe);
  });
});
