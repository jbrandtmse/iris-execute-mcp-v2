/**
 * Story 41.1 (QA, AC 41.1.5) - `pnpm validate:prompts` (`scripts/validate-prompts.mjs`) as a real process, in a
 * SCRATCH COPY of the real tree under `os.tmpdir()`, with an unknown `iris_*` token placed in a file of the
 * PACK itself (not only in a hand-authored source).
 *
 * `validate-prompts.test.ts` plants a token in the real tree's `skills-pack-src/rules/`, where the CLI reports
 * the `rule:` source. These tests edit the pack copy and the regenerated pack, in a scratch root, so the
 * `pack:` label of the CLI is proven on the path it guards, and no file of the working tree is touched.
 *
 * The scratch root holds the real `scripts/`, `skills/`, `skills-pack-src/` and committed pack, and links the
 * five server packages' real directories under `packages/` (their built `dist/` is only read, by the catalogs).
 */

import { afterEach, describe, expect, it } from "vitest";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWLEDGE_SOURCE_DIR, PACK_DIR, RULE_FORM_DIRS, RULES_SOURCE_DIR } from "../../../../scripts/lib/skills-pack.mjs";
import { put } from "./pack-fixture";
import { BOM, makeScratchRepo, removeScratchRepo, runScript, toCrlf } from "./story-41-1-qa-fixture";

const VALIDATE = "scripts/validate-prompts.mjs";
const GEN_PACK = "scripts/gen-pack.mjs";
const BAD_TOKEN = "iris_not_a_real_tool";
const PACK_SKILL = "skills/check-system-health/SKILL.md";

const scratches: string[] = [];
function scratch(): string {
  const root = makeScratchRepo({ serverPackages: true });
  scratches.push(root);
  return root;
}
afterEach(() => {
  for (const root of scratches.splice(0)) removeScratchRepo(root);
});

/** The labels named on stderr: `  - <label>: "<token>"`. */
function flaggedLabels(stderr: string): string[] {
  return [...stderr.matchAll(/^ {2}- (.+): "(.+)"$/gm)].map((match) => `${match[1]} ${match[2]}`).sort();
}

function expectRejected(root: string): string {
  const run = runScript(root, VALIDATE);
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
  expect(run.stdout).not.toContain("validate-prompts: OK");
  return run.stderr;
}

describe("validate:prompts CLI, scratch copy: the green controls", () => {
  it("the unmodified copy passes with 39 sources: 12 prompts and 27 content files (12 workflow, 14 pack, 1 rule)", () => {
    const run = runScript(scratch(), VALIDATE);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("39 source(s) checked (12 prompt(s) + 27 content file(s): 12 workflow, 14 pack, 0 knowledge, 1 rule)");
  });

  it("a real tool name added to a pack file is accepted, and counted as no extra source", () => {
    const root = scratch();
    appendFileSync(join(root, PACK_DIR, PACK_SKILL), "\nThen call `iris_doc_get` and `iris_server_profiles`.\n");
    const run = runScript(root, VALIDATE);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("39 source(s) checked");
  });
});

describe("validate:prompts CLI, scratch copy: an unknown token in the pack (AC 41.1.5)", () => {
  it("in a pack skill file: exits 1 and names only that pack file", () => {
    const root = scratch();
    appendFileSync(join(root, PACK_DIR, PACK_SKILL), `\nThen call \`${BAD_TOKEN}\`.\n`);
    const stderr = expectRejected(root);
    expect(flaggedLabels(stderr)).toEqual([`pack:${PACK_SKILL} ${BAD_TOKEN}`]);
  });

  it("in a nested pack reference file: exits 1 and names it", () => {
    const root = scratch();
    put(root, `${PACK_DIR}/skills/check-system-health/references/extra.md`, `Call \`${BAD_TOKEN}\`.\n`);
    const stderr = expectRejected(root);
    expect(flaggedLabels(stderr)).toEqual([`pack:skills/check-system-health/references/extra.md ${BAD_TOKEN}`]);
  });

  it("in a pack rule file: exits 1 and names it", () => {
    const root = scratch();
    put(root, `${PACK_DIR}/rules/qa-rule.md`, `Call \`${BAD_TOKEN}\`.\n`);
    const stderr = expectRejected(root);
    expect(flaggedLabels(stderr)).toEqual([`pack:rules/qa-rule.md ${BAD_TOKEN}`]);
  });

  it("in a pack file that is CRLF with a BOM: still found (project rule #58)", () => {
    const root = scratch();
    const abs = join(root, PACK_DIR, PACK_SKILL);
    const text = readFileSync(abs).toString("utf8").replace(/\n$/, "") + `\nThen call \`${BAD_TOKEN}\`.\n`;
    writeFileSync(abs, Buffer.concat([BOM, toCrlf(Buffer.from(text, "utf8"))]));
    expect(flaggedLabels(expectRejected(root))).toEqual([`pack:${PACK_SKILL} ${BAD_TOKEN}`]);
  });

  it("a one-letter slip in a real tool name is unknown: iris_doc_gett", () => {
    const root = scratch();
    appendFileSync(join(root, PACK_DIR, PACK_SKILL), "\nCall `iris_doc_gett`.\n");
    expect(flaggedLabels(expectRejected(root))).toEqual([`pack:${PACK_SKILL} iris_doc_gett`]);
  });

  it("two bad tokens in two pack files: every file is named, none is skipped after the first", () => {
    const root = scratch();
    appendFileSync(join(root, PACK_DIR, PACK_SKILL), `\nCall \`${BAD_TOKEN}\`.\n`);
    appendFileSync(join(root, PACK_DIR, "skills/diagnose-slow-query/SKILL.md"), "\nCall `iris_also_not_real`.\n");
    expect(flaggedLabels(expectRejected(root))).toEqual([
      `pack:${PACK_SKILL} ${BAD_TOKEN}`,
      "pack:skills/diagnose-slow-query/SKILL.md iris_also_not_real",
    ]);
  });
});

describe("validate:prompts CLI, scratch copy: a source and its regenerated pack copy (AC 41.1.5)", () => {
  it("a bad token in a knowledge skill names the source and the pack copy after gen:pack", () => {
    const root = scratch();
    put(root, `${KNOWLEDGE_SOURCE_DIR}/qa-k/SKILL.md`, `---\nname: qa-k\n---\n\nCall \`${BAD_TOKEN}\`.\n`);
    expect(runScript(root, GEN_PACK).status).toBe(0);
    expect(flaggedLabels(expectRejected(root))).toEqual([
      `knowledge:qa-k/SKILL.md ${BAD_TOKEN}`,
      `pack:skills/qa-k/SKILL.md ${BAD_TOKEN}`,
    ]);
  });

  it("a bad token in a rule names the source and both pack forms after gen:pack", () => {
    const root = scratch();
    put(root, `${RULES_SOURCE_DIR}/qa-rule.md`, `Call \`${BAD_TOKEN}\`.\n`);
    expect(runScript(root, GEN_PACK).status).toBe(0);
    expect(flaggedLabels(expectRejected(root))).toEqual([
      `pack:${RULE_FORM_DIRS.agentsMd}/qa-rule.md ${BAD_TOKEN}`,
      `pack:${RULE_FORM_DIRS.claudeCode}/qa-rule.md ${BAD_TOKEN}`,
      `rule:qa-rule.md ${BAD_TOKEN}`,
    ]);
  });

  it("a bad token in the generated workflow skill is named with the workflow label", () => {
    const root = scratch();
    appendFileSync(join(root, "skills/check-system-health/SKILL.md"), `\nCall \`${BAD_TOKEN}\`.\n`);
    expect(flaggedLabels(expectRejected(root))).toEqual([`workflow:check-system-health/SKILL.md ${BAD_TOKEN}`]);
  });

  it("good knowledge and rule sources are counted by kind once the pack is built", () => {
    const root = scratch();
    put(root, `${KNOWLEDGE_SOURCE_DIR}/qa-k/SKILL.md`, "---\nname: qa-k\n---\n\nCall `iris_doc_get`.\n");
    put(root, `${RULES_SOURCE_DIR}/qa-rule.md`, "Prefer `iris_doc_search`.\n");
    expect(runScript(root, GEN_PACK).status).toBe(0);
    const run = runScript(root, VALIDATE);
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("(12 prompt(s) + 32 content file(s): 12 workflow, 17 pack, 1 knowledge, 2 rule)");
  });
});
