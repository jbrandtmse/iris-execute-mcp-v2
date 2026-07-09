/**
 * CR 25.1-3 (resolved Story 26.4) — `gen-skills.mjs --check` must detect a
 * stray file inside an otherwise-valid generated skill directory.
 *
 * Before this fix, `listOnDiskSkillFiles()` only enumerated the per-directory
 * `SKILL.md` and the top-level `README.md`, so a hand-added stray file (e.g.
 * `skills/<name>/NOTES.md`) was invisible to `--check`'s drift detection and
 * would have survived write-mode cleanup too — mildly overstating the
 * generator header's "fail on ANY drift" claim. `listAllOnDiskFiles()` now
 * walks the full tree, so any on-disk path that is not an expected generated
 * file is flagged.
 *
 * Exercises the REAL CLI script (`node scripts/gen-skills.mjs --check`)
 * against the actual on-disk `skills/` tree via `child_process` — adds one
 * disposable stray file, asserts `--check` now fails, and always removes the
 * stray file in a `finally` block so the repo tree is left exactly as found.
 * This test only ever invokes `--check` (never write-mode), so no generated
 * content is touched.
 *
 * Skipped gracefully when `skills/` has not been generated in this checkout
 * (mirrors `skills-generated-frontmatter.test.ts`'s skip pattern) — this test
 * does NOT invoke `pnpm turbo run build` itself.
 */

import { describe, it, expect } from "vitest";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/iris-mcp-all/src/__tests__/ -> repo root is 4 levels up.
const root = resolve(__dirname, "../../../..");
const skillsDir = resolve(root, "skills");
const genSkillsScript = resolve(root, "scripts/gen-skills.mjs");

function firstSkillDirName(): string | undefined {
  if (!existsSync(skillsDir)) return undefined;
  return readdirSync(skillsDir, { withFileTypes: true }).find((e) => e.isDirectory())?.name;
}

const skillName = firstSkillDirName();

describe("gen-skills.mjs --check stray-file detection (CR 25.1-3)", () => {
  if (!existsSync(skillsDir) || !skillName) {
    it.skip("skills/ has not been generated in this checkout -- run `pnpm gen:skills` first", () => {});
    return;
  }

  it("flags a hand-added stray file inside an otherwise-valid skill directory", () => {
    const strayPath = resolve(skillsDir, skillName, "NOTES.md");
    writeFileSync(strayPath, "not a generated file\n", "utf-8");
    try {
      let threw = false;
      let output = "";
      try {
        execFileSync("node", [genSkillsScript, "--check"], { cwd: root, encoding: "utf-8" });
      } catch (e: unknown) {
        threw = true;
        const err = e as { stdout?: string; stderr?: string };
        output = `${err.stderr ?? ""}${err.stdout ?? ""}`;
      }
      expect(threw).toBe(true);
      expect(output).toContain("STRAY/STALE");
      expect(output).toContain("NOTES.md");
    } finally {
      rmSync(strayPath, { force: true });
    }
  });

  it("--check passes clean once the stray file is removed (no false-positive drift)", () => {
    // Sanity companion: proves the prior test's failure was caused by the
    // stray file specifically, not pre-existing drift in this checkout.
    execFileSync("node", [genSkillsScript, "--check"], { cwd: root, encoding: "utf-8" });
  });
});
