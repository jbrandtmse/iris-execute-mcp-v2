/**
 * Story 41.5 QA (AC 41.5.1, matrix row "Missing skill field"; project rule #59) - `gen:skills` refuses a prompt without a
 * valid `skill` field BEFORE it writes anything, in write mode and in `--check` mode, shown in SCRATCH COPIES of the
 * repository under `os.tmpdir()`.
 *
 * Two oracles that a refusal on an up-to-date `skills/` tree cannot give:
 *  - write mode runs on a STALE tree (a generated file edited, a file deleted, `README.md` deleted, a stray file added, on
 *    both sides of the broken prompt in generation order). A generator that wrote the valid skills before it stopped would
 *    change that tree; on an up-to-date tree it would rewrite identical bytes and leave no trace. The same scratch is then
 *    repaired (the prompt made valid) and run again: the run now rewrites the stale tree, so the first run's "nothing
 *    changed" is the refusal and not a generator that never writes;
 *  - `--check` runs on an UP-TO-DATE tree, where a pass is possible: a generator that reported the problem and then went
 *    on to compare the tree would print OK and exit 0. The scratch is repaired and regenerated, and `--check` then passes,
 *    so the red run is the prompt and not the tree.
 *
 * The scratch copy's ops package is a real directory whose `dist/prompts/index.js` re-exports the real built ops prompts and
 * adds the broken ones, so every other prompt in the copy is valid and the broken one sits in the middle of the order
 * (ops, dev, interop, admin). The real tree is never written: the real `skills/` and ops prompts module are fingerprinted
 * before the first row and compared after the last. No IRIS and no network.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { removeLink, REPO_ROOT } from "./pack-fixture";
import { makeScratchRepo, removeScratchRepo, runScript, sha256, treeLines } from "./story-41-1-qa-fixture";
import { stubPromptSource, VALID_STUB_SKILL } from "./story-41-5-qa-fixture";

const GEN_SKILLS = "scripts/gen-skills.mjs";
const OPS_PACKAGE = join("packages", "iris-ops-mcp");
const REAL_OPS_PROMPTS = pathToFileURL(join(REPO_ROOT, OPS_PACKAGE, "dist", "prompts", "index.js")).href;

const NO_SKILL = "has no skill field; give its prompt definition a skill with a description and a preset";
const EMPTY = "has an empty skill description";
const presetMessage = (value: string): string => `has the skill preset "${value}", which is not one of core, developer and full`;
const VALID_SKILL = VALID_STUB_SKILL;

/** A broken prompt: its name and the source text of its `skill` member (`null` leaves the member out). */
type Stub = [name: string, skill: string | null];

interface Variant {
  label: string;
  stubs: Stub[];
  /** The `gen-skills: prompt ...` lines, in order. */
  lines: string[];
}

const line = (name: string, message: string): string => `gen-skills: prompt iris-ops-mcp/${name} ${message}`;

const VARIANTS: Variant[] = [
  { label: "no skill member", stubs: [["zz-bad", null]], lines: [line("zz-bad", NO_SKILL)] },
  { label: "skill is null", stubs: [["zz-bad", "null"]], lines: [line("zz-bad", NO_SKILL)] },
  { label: "skill is a string", stubs: [["zz-bad", '"a description"']], lines: [line("zz-bad", NO_SKILL)] },
  { label: "blank description", stubs: [["zz-bad", '{ description: "   ", preset: "core" }']], lines: [line("zz-bad", EMPTY)] },
  { label: "description is a number", stubs: [["zz-bad", '{ description: 42, preset: "core" }']], lines: [line("zz-bad", EMPTY)] },
  { label: "no preset", stubs: [["zz-bad", '{ description: "A stub. Use when testing." }']], lines: [line("zz-bad", presetMessage("undefined"))] },
  { label: "preset in capitals", stubs: [["zz-bad", '{ description: "A stub. Use when testing.", preset: "Core" }']], lines: [line("zz-bad", presetMessage("Core"))] },
  {
    label: "blank description and a wrong preset together",
    stubs: [["zz-bad", '{ description: "", preset: "huge" }']],
    lines: [line("zz-bad", EMPTY), line("zz-bad", presetMessage("huge"))],
  },
  {
    label: "two broken prompts",
    stubs: [
      ["zz-bad-1", null],
      ["zz-bad-2", '{ description: "A stub. Use when testing.", preset: "huge" }'],
    ],
    lines: [line("zz-bad-1", NO_SKILL), line("zz-bad-2", presetMessage("huge"))],
  },
];

const stubPrompt = (name: string, skill: string | null): string => stubPromptSource(name, skill);

/** A fingerprint of the real generated skills and the real ops prompts module, which the scratch copies stand in for. */
function realTreeFingerprint(): string[] {
  return [
    ...treeLines(join(REPO_ROOT, "skills")),
    `ops prompts module ${sha256(readFileSync(join(REPO_ROOT, OPS_PACKAGE, "dist", "prompts", "index.js")))}`,
  ];
}
let realTreeBefore: string[] = [];
beforeAll(() => {
  realTreeBefore = realTreeFingerprint();
});
afterAll(() => {
  expect(realTreeFingerprint(), "no row wrote to the real tree").toEqual(realTreeBefore);
});

const scratches: string[] = [];
function scratch(): string {
  const root = makeScratchRepo({ serverPackages: true });
  scratches.push(root);
  return root;
}
afterEach(() => {
  for (const root of scratches.splice(0)) removeScratchRepo(root);
});

/** Make the scratch copy's ops package a real directory that serves the real ops prompts plus the given stubs. */
function stubOps(root: string, stubs: Stub[]): void {
  const dir = join(root, OPS_PACKAGE);
  if (lstatSync(dir).isSymbolicLink()) {
    removeLink(dir);
    mkdirSync(join(dir, "dist", "prompts"), { recursive: true });
  }
  const sources = stubs.map(([name, skill]) => stubPrompt(name, skill)).join(",");
  writeFileSync(join(dir, "dist", "prompts", "index.js"), `import { prompts as real } from ${JSON.stringify(REAL_OPS_PROMPTS)};\nexport const prompts = [...real, ${sources}];\n`);
}

const skillsDir = (root: string): string => join(root, "skills");
const read = (root: string, rel: string): string => readFileSync(join(root, rel), "utf8");
const stderrLines = (stderr: string): string[] => stderr.trimEnd().split("\n");

/**
 * Leave `skills/` stale on both sides of the broken prompt: an ops skill (generated before it) and a dev skill (generated
 * after it) edited, an admin skill deleted, `README.md` deleted, and a stray file added.
 */
function makeStale(root: string): void {
  for (const name of ["check-system-health", "edit-and-test-class"]) {
    writeFileSync(join(skillsDir(root), name, "SKILL.md"), `${read(root, `skills/${name}/SKILL.md`)}\nstale\n`);
  }
  rmSync(join(skillsDir(root), "provision-project-environment", "SKILL.md"));
  rmSync(join(skillsDir(root), "README.md"));
  mkdirSync(join(skillsDir(root), "zz-stray"));
  writeFileSync(join(skillsDir(root), "zz-stray", "SKILL.md"), "stray\n");
}

const repaired = (stubs: Stub[]): Stub[] => stubs.map(([name]) => [name, VALID_SKILL]);

describe("gen:skills refuses a prompt without a valid skill field and writes nothing (AC 41.5.1)", () => {
  it.each(VARIANTS)("$label: write mode exits 1 and leaves a stale skills/ tree as it was; the repaired prompt then regenerates it", ({ stubs, lines }) => {
    const root = scratch();
    stubOps(root, stubs);
    makeStale(root);
    const before = treeLines(skillsDir(root));

    const run = runScript(root, GEN_SKILLS);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(stderrLines(run.stderr), "stderr holds the problem lines and nothing else").toEqual(lines);
    expect(run.stdout, "nothing printed on stdout: no success line, no removal notice").toBe("");
    expect(treeLines(skillsDir(root)), "the stale tree is byte-identical, directories included").toEqual(before);

    stubOps(root, repaired(stubs));
    const fixed = runScript(root, GEN_SKILLS);
    expect(fixed.status, `${fixed.stdout}${fixed.stderr}`).toBe(0);
    expect(treeLines(skillsDir(root)), "the repaired run rewrites the stale tree").not.toEqual(before);
    expect(read(root, "skills/check-system-health/SKILL.md")).toBe(readFileSync(join(REPO_ROOT, "skills", "check-system-health", "SKILL.md"), "utf8"));
    expect(read(root, "skills/edit-and-test-class/SKILL.md")).toBe(readFileSync(join(REPO_ROOT, "skills", "edit-and-test-class", "SKILL.md"), "utf8"));
    expect(existsSync(join(skillsDir(root), "README.md")), "README.md regenerated").toBe(true);
    expect(existsSync(join(skillsDir(root), "provision-project-environment", "SKILL.md")), "the deleted skill regenerated").toBe(true);
    expect(existsSync(join(skillsDir(root), "zz-stray")), "the stray file removed").toBe(false);
  });

  it.each(VARIANTS)("$label: --check on an up-to-date tree exits 1 with the same lines and no OK; the repaired prompt then passes --check", ({ stubs, lines }) => {
    const root = scratch();
    stubOps(root, stubs);
    const before = treeLines(skillsDir(root));

    const run = runScript(root, GEN_SKILLS, ["--check"]);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(stderrLines(run.stderr), "stderr holds the problem lines and no drift report").toEqual(lines);
    expect(run.stdout, "no OK line").not.toContain("OK");
    expect(treeLines(skillsDir(root)), "--check wrote nothing").toEqual(before);

    stubOps(root, repaired(stubs));
    const write = runScript(root, GEN_SKILLS);
    expect(write.status, `${write.stdout}${write.stderr}`).toBe(0);
    const check = runScript(root, GEN_SKILLS, ["--check"]);
    expect(check.status, `${check.stdout}${check.stderr}`).toBe(0);
    expect(check.stdout).toContain("gen-skills --check: OK");
  });
});
