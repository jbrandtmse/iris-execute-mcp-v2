/**
 * Story 41.3 QA (AC 41.3.3) - what keeps an `iris_*` tool name, an internal rule number, a DW or AD id and a repository
 * path out of a knowledge skill, run as real processes in SCRATCH COPIES of the repository under `os.tmpdir()`.
 *
 * Two layers guard the wording, and they own different things:
 *  - `scripts/validate-prompts.mjs` rejects an `iris_*` token that names no real tool. It accepts a real tool name
 *    (`iris_doc_put` is a tool), and it does not look for a rule number, a planning id or a path at all;
 *  - the committed `skills-pack-knowledge.test.ts` rejects every one of them, a real tool name included.
 *
 * Part 1 drives the validator CLI on the three real knowledge skills (their source and their pack copy) and pins that
 * division of labour. Part 2 runs the COMMITTED `skills-pack-knowledge.test.ts` in a child vitest process against a
 * scratch copy in which one offending line is added to one real skill (source and pack copy alike), and reads which of
 * its tests go red. The scratch copy holds a byte copy of that test file and its two helpers, the real `scripts/`, the
 * sources and the committed pack, an empty entry for every other top-level entry of the repository (the repository-path
 * pattern is built from `readdirSync(REPO_ROOT)`), and a link to the real `node_modules`. The child keeps its Vite cache
 * inside the scratch copy (`cacheDir`), so nothing is written through that link.
 * Every offender row has a negative control: benign lookalikes (an IRIS error code, an IRIS qualifier, a pack skill
 * name, `AD-hoc`) added the same way keep the wording tests green, while the sha256 test goes red, which proves the
 * child run read the edited file.
 *
 * The expected class names are typed here from the story's wording rules, not read from the gate. No IRIS and no
 * network; the real tree is never written.
 */

import { afterEach, describe, expect, it } from "vitest";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { KNOWLEDGE_SOURCE_DIR, PACK_DIR, PACK_SOURCE_DIR } from "../../../../scripts/lib/skills-pack.mjs";
import { makeTempRoot, put, removeTempRoot, REPO_ROOT } from "./pack-fixture";
import { makeScratchRepo, removeScratchRepo, runScript } from "./story-41-1-qa-fixture";

const GOTCHAS = "iris-mcp-objectscript-gotchas";
const ERRORS = "iris-mcp-objectscript-error-handling";
const UNIT_TESTS = "iris-mcp-objectscript-unit-tests";
const SKILL_NAMES = [GOTCHAS, ERRORS, UNIT_TESTS];

const sourceRel = (skill: string): string => `${KNOWLEDGE_SOURCE_DIR}/${skill}/SKILL.md`;
const packRel = (skill: string): string => `${PACK_DIR}/skills/${skill}/SKILL.md`;
/** The real skill text, with `line` added as a last bullet. */
function withLine(skill: string, line: string): string {
  return `${readFileSync(join(REPO_ROOT, sourceRel(skill)), "utf8")}\n- ${line}\n`;
}

// ---------------------------------------------------------------------------------------------------------
// Part 1 - validate:prompts on the real knowledge skills.
// ---------------------------------------------------------------------------------------------------------

const VALIDATE = "scripts/validate-prompts.mjs";
const SCRATCH_ROOTS: string[] = [];
const GATE_ROOTS: string[] = [];

afterEach(() => {
  const roots = [...SCRATCH_ROOTS.splice(0), ...GATE_ROOTS.splice(0)];
  for (const root of roots) {
    if (existsSync(join(root, "node_modules"))) removeGateScratch(root);
    else removeScratchRepo(root);
    expect(existsSync(root), `the scratch root ${root} is removed`).toBe(false);
  }
  // Removing a scratch copy never reaches through its link to the real node_modules.
  expect(existsSync(VITEST_ENTRY), "the real vitest is still installed").toBe(true);
  // A child run never writes its cache through that link either.
  expect(realViteCacheStamp(), "the real node_modules/.vite results cache is untouched").toBe(REAL_VITE_CACHE_BEFORE);
});

function validatorScratch(): string {
  const root = makeScratchRepo({ serverPackages: true });
  SCRATCH_ROOTS.push(root);
  return root;
}

/** Put the same edited text in the source and in the pack copy of a skill, as `gen:pack` would leave them. */
function editSkill(root: string, skill: string, text: string): void {
  put(root, sourceRel(skill), text);
  put(root, packRel(skill), text);
}

/** The labels named on stderr: `  - <label>: "<token>"`. */
function flagged(stderr: string): string[] {
  return [...stderr.matchAll(/^ {2}- (.+): "(.+)"$/gm)].map((match) => `${match[1]} ${match[2]}`).sort();
}

describe("validate:prompts CLI, scratch copy: the three real knowledge skills (AC 41.3.3)", () => {
  it("control: the unmodified copy passes and counts the three knowledge skills", () => {
    const run = runScript(validatorScratch(), VALIDATE);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toMatch(/\d+ source\(s\) checked \(\d+ prompt\(s\) \+ \d+ content file\(s\): 12 workflow, \d+ pack, 3 knowledge, 1 rule\)/);
  });

  it.each(SKILL_NAMES)("an unknown iris_* token in %s names the source and the pack copy and exits 1", (skill) => {
    const root = validatorScratch();
    editSkill(root, skill, withLine(skill, "Call `iris_not_a_real_tool`."));
    const run = runScript(root, VALIDATE);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(run.stdout).not.toContain("validate-prompts: OK");
    expect(flagged(run.stderr)).toEqual([`knowledge:${skill}/SKILL.md iris_not_a_real_tool`, `pack:skills/${skill}/SKILL.md iris_not_a_real_tool`]);
  });

  it("a one-letter slip in a real tool name is unknown: iris_doc_gett", () => {
    const root = validatorScratch();
    editSkill(root, GOTCHAS, withLine(GOTCHAS, "Call `iris_doc_gett`."));
    const run = runScript(root, VALIDATE);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(1);
    expect(flagged(run.stderr)).toEqual([`knowledge:${GOTCHAS}/SKILL.md iris_doc_gett`, `pack:skills/${GOTCHAS}/SKILL.md iris_doc_gett`]);
  });

  it("a REAL tool name passes the validator (the no-tool pin belongs to the knowledge test, not to this layer)", () => {
    const root = validatorScratch();
    editSkill(root, ERRORS, withLine(ERRORS, "Call `iris_doc_put`."));
    const run = runScript(root, VALIDATE);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("validate-prompts: OK");
  });

  it.each([
    ["an internal rule number", "See Rule #7: do this."],
    ["a DW id", "Tracked as DW-613."],
    ["an AD id", "Decided in AD-28."],
    ["a repository path", "Edit packages/shared/src/index.ts."],
  ])("%s passes the validator: it checks tool names only (the wording test owns the rest)", (_row, line) => {
    const root = validatorScratch();
    editSkill(root, UNIT_TESTS, withLine(UNIT_TESTS, line));
    const run = runScript(root, VALIDATE);
    expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("validate-prompts: OK");
  });
});

// ---------------------------------------------------------------------------------------------------------
// Part 2 - the committed knowledge test, run in a child vitest process against an edited scratch copy.
// ---------------------------------------------------------------------------------------------------------

const GATE_TEST = "skills-pack-knowledge.test.ts";
const GATE_FILES = [GATE_TEST, "agent-text-hygiene.ts", "pack-fixture.ts"];
const VITEST_ENTRY = join(REPO_ROOT, "node_modules", "vitest", "vitest.mjs");
/** The scratch-local cache directory, relative to the scratch copy's `packages/iris-mcp-all`. */
const GATE_CACHE_DIR = ".vite-gate";
/** Where a child run would write its results cache if it resolved Vite's default through the node_modules link. */
const REAL_VITE_RESULTS = join(REPO_ROOT, "node_modules", ".vite", "vitest", "results.json");
/** The real results cache's modification time, or -1 when it does not exist. */
function realViteCacheStamp(): number {
  return existsSync(REAL_VITE_RESULTS) ? statSync(REAL_VITE_RESULTS).mtimeMs : -1;
}
const REAL_VITE_CACHE_BEFORE = realViteCacheStamp();
const GATE_CONFIG = [
  'import { defineConfig } from "vitest/config";',
  "",
  "export default defineConfig({",
  // Vite's default cache is `node_modules/.vite` beside the nearest package.json, which here is the scratch root, whose
  // node_modules is the link to the real one. A cache directory of its own keeps every write inside the scratch copy.
  `  cacheDir: ${JSON.stringify(GATE_CACHE_DIR)},`,
  "  test: {",
  "    globals: true,",
  '    environment: "node",',
  '    include: ["src/__tests__/**/*.test.ts"],',
  "    testTimeout: 20_000,",
  "    fileParallelism: false,",
  "  },",
  "});",
  "",
].join("\n");

/** A scratch repository that can run the committed knowledge test. Returns its root. */
function gateScratch(): string {
  const root = makeTempRoot("qa-41-3-gate");
  GATE_ROOTS.push(root);
  cpSync(join(REPO_ROOT, "scripts"), join(root, "scripts"), { recursive: true });
  cpSync(join(REPO_ROOT, PACK_SOURCE_DIR), join(root, PACK_SOURCE_DIR), { recursive: true });
  mkdirSync(join(root, "packages", "client-config"), { recursive: true });
  cpSync(join(REPO_ROOT, PACK_DIR), join(root, PACK_DIR), { recursive: true });
  const testsDir = join(root, "packages", "iris-mcp-all", "src", "__tests__");
  mkdirSync(testsDir, { recursive: true });
  for (const file of GATE_FILES) copyFileSync(join(REPO_ROOT, "packages", "iris-mcp-all", "src", "__tests__", file), join(testsDir, file));
  writeFileSync(join(root, "packages", "iris-mcp-all", "vitest.config.ts"), GATE_CONFIG);
  symlinkSync(join(REPO_ROOT, "node_modules"), join(root, "node_modules"), "junction");
  // The repository-path pattern reads the top-level entries of the repository: give the scratch copy the same names.
  for (const entry of readdirSync(REPO_ROOT, { withFileTypes: true })) {
    if (existsSync(join(root, entry.name))) continue;
    if (entry.isDirectory()) mkdirSync(join(root, entry.name));
    // A JSON placeholder must parse: the child run reads the nearest package.json and tsconfig files.
    else writeFileSync(join(root, entry.name), entry.name.endsWith(".json") ? "{}\n" : "");
  }
  return root;
}

/** Unlink the link to the real node_modules first, so the recursive removal can never reach the real one. */
function removeGateScratch(root: string): void {
  try {
    unlinkSync(join(root, "node_modules"));
  } catch {
    // Already gone.
  }
  removeTempRoot(root);
}

interface GateResult {
  title: string;
  ancestors: string[];
  status: string;
  failure: string;
}

interface GateRun {
  status: number | null;
  total: number;
  failed: number;
  results: GateResult[];
  /** The child's console report. The JSON report cuts a failed array down to `Array(n)`; this one prints its items. */
  log: string;
}

// ANSI colour sequences (ESC [ ... m), built from the code point so the source stays plain ASCII.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** Run the scratch copy's knowledge test in a child vitest process (JSON file plus console report) and read its outcome. */
function runGate(root: string): GateRun {
  const packageDir = join(root, "packages", "iris-mcp-all");
  const reportPath = join(root, "gate-report.json");
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    // A child vitest inside a vitest worker must not inherit the worker's own markers.
    if (value !== undefined && !/^(VITEST|VITE_)/.test(key) && key !== "TEST") env[key] = value;
  }
  const child = spawnSync(
    process.execPath,
    [
      VITEST_ENTRY,
      "run",
      "--root",
      packageDir,
      "--config",
      join(packageDir, "vitest.config.ts"),
      "--reporter=json",
      "--reporter=default",
      `--outputFile.json=${reportPath}`,
      `src/__tests__/${GATE_TEST}`,
    ],
    { cwd: packageDir, encoding: "utf8", env, timeout: 120_000 },
  );
  const log = `${child.stdout ?? ""}\n${child.stderr ?? ""}`.replace(ANSI, "");
  expect(existsSync(reportPath), `the child run wrote no JSON report\n${log}`).toBe(true);
  expect(existsSync(join(packageDir, GATE_CACHE_DIR, "vitest", "results.json")), "the child run kept its cache inside the scratch copy").toBe(true);
  const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
    numTotalTests: number;
    numFailedTests: number;
    testResults: Array<{
      assertionResults: Array<{ title: string; ancestorTitles: string[]; status: string; failureMessages: string[] }>;
    }>;
  };
  const results = report.testResults.flatMap((file) =>
    file.assertionResults.map((test) => ({
      title: test.title,
      ancestors: test.ancestorTitles,
      status: test.status,
      failure: test.failureMessages.join("\n"),
    })),
  );
  return { status: child.status, total: report.numTotalTests, failed: report.numFailedTests, results, log };
}

// The horizontal separator the console report prints between failure blocks (U+23AF), built from the code point.
const SEPARATOR = new RegExp(`\\n${String.fromCharCode(0x23af)}{5,}`);

/** The console report's `FAIL` block for one failed test of a skill (its header line up to the next separator), or "". */
function failureBlock(run: GateRun, skill: string, titleStart: string): string {
  const header = new RegExp(`^ FAIL .*'${skill}' > ${titleStart}`, "m").exec(run.log);
  if (header === null) return "";
  const rest = run.log.slice(header.index);
  const end = rest.search(SEPARATOR);
  return end < 0 ? rest : rest.slice(0, end);
}

const T_NO_TOOL = "names no iris_* tool";
const T_HYGIENE = "names nothing of this repository, its planning or its tooling";
const T_NO_COPY = "goes deeper than the always-on rule";
const T_SHA = "is the text that was run on a live instance";
const WORDING_TESTS = [T_NO_TOOL, T_HYGIENE, T_NO_COPY];

/** The one result of the test whose title starts with `titleStart`, for a skill. */
function resultOf(run: GateRun, skill: string, titleStart: string): GateResult {
  // vitest quotes the interpolated skill name in a describe.each title: 'iris-mcp-objectscript-gotchas'.
  const found = run.results.filter(
    (result) => result.ancestors.some((ancestor) => ancestor.replace(/^'|'$/g, "") === skill) && result.title.startsWith(titleStart),
  );
  expect(found, `${skill} / ${titleStart}`).toHaveLength(1);
  return found[0] as GateResult;
}

describe("the committed knowledge test as a child process: the baseline", () => {
  it("passes on an unmodified scratch copy, for all three skills, and is able to run there", () => {
    const run = runGate(gateScratch());
    expect(run.failed, run.results.filter((result) => result.status === "failed").map((result) => `${result.ancestors.join(" > ")} > ${result.title}\n${result.failure}`).join("\n\n")).toBe(0);
    expect(run.status).toBe(0);
    expect(run.total).toBeGreaterThanOrEqual(58);
    for (const skill of SKILL_NAMES) {
      for (const title of [...WORDING_TESTS, T_SHA]) expect(resultOf(run, skill, title).status, `${skill} / ${title}`).toBe("passed");
    }
  });
});

interface Offender {
  row: string;
  /** The skill that gets the offending line (the other two stay untouched). */
  skill: string;
  line: string;
  /** Each class name the hygiene test must report; empty when only the no-tool test is the subject. */
  classes: string[];
  /** The wording tests that must go red for that skill. */
  red: string[];
}

const OFFENDERS: Offender[] = [
  {
    row: "an iris_* tool name that is a real tool",
    skill: GOTCHAS,
    line: "Call `iris_doc_put`.",
    classes: ["a tool or server name"],
    red: [T_NO_TOOL, T_HYGIENE],
  },
  {
    row: "an unknown iris_* token",
    skill: ERRORS,
    line: "Call `iris_not_a_real_tool`.",
    classes: ["a tool or server name"],
    red: [T_NO_TOOL, T_HYGIENE],
  },
  {
    row: "an internal rule number",
    skill: UNIT_TESTS,
    line: "See Rule #7: do this.",
    classes: ["an internal rule number"],
    red: [T_HYGIENE],
  },
  {
    row: "a bare number sign that is no IRIS error code",
    skill: GOTCHAS,
    line: "See item #58.",
    classes: ["a number sign and digits that are not an IRIS error code"],
    red: [T_HYGIENE],
  },
  {
    row: "a DW id",
    skill: ERRORS,
    line: "Tracked as DW-613.",
    classes: ["a planning or deferred-work id"],
    red: [T_HYGIENE],
  },
  {
    row: "an AD id",
    skill: UNIT_TESTS,
    line: "Decided in AD-28.",
    classes: ["a planning or deferred-work id"],
    red: [T_HYGIENE],
  },
  {
    row: "a repository path",
    skill: GOTCHAS,
    line: "Edit packages/shared/src/index.ts.",
    classes: ["a repository path"],
    red: [T_HYGIENE],
  },
  {
    row: "a path under a dotted repository entry",
    skill: ERRORS,
    line: "Look in .claude/rules.",
    classes: ["a repository path"],
    red: [T_HYGIENE],
  },
  {
    row: "an absolute path",
    skill: UNIT_TESTS,
    line: "Open /Users/someone/file.",
    classes: ["an absolute path"],
    red: [T_HYGIENE],
  },
  {
    row: "a URL",
    skill: GOTCHAS,
    line: "Docs at https://example.com/page.",
    classes: ["a URL"],
    red: [T_HYGIENE],
  },
];

describe("the committed knowledge test as a child process: each offender alone goes red, the others stay green (AC 41.3.3)", () => {
  it.each(OFFENDERS)("$row in $skill", (offender) => {
    const root = gateScratch();
    editSkill(root, offender.skill, withLine(offender.skill, offender.line));
    const run = runGate(root);
    expect(run.status, "the child run exits non-zero").not.toBe(0);

    for (const title of offender.red) {
      const result = resultOf(run, offender.skill, title);
      expect(result.status, `${offender.skill} / ${title}\n${result.failure}`).toBe("failed");
    }
    // The console report prints the classes the text tripped (the JSON report cuts the array down to `Array(n)`).
    const block = failureBlock(run, offender.skill, T_HYGIENE);
    expect(block, `the console report has a failure block for the hygiene test\n${run.log}`).not.toBe("");
    for (const name of offender.classes) expect(block, `names the class "${name}"`).toContain(`"${name}"`);

    // The wording tests that are not expected to go red stay green, for this skill and for the two untouched ones.
    for (const skill of SKILL_NAMES) {
      for (const title of WORDING_TESTS) {
        const expectRed = skill === offender.skill && offender.red.includes(title);
        expect(resultOf(run, skill, title).status, `${skill} / ${title}`).toBe(expectRed ? "failed" : "passed");
      }
    }
    // The edited text is what the child read: its pinned sha256 no longer holds, the untouched skills' still do.
    expect(resultOf(run, offender.skill, T_SHA).status).toBe("failed");
    for (const skill of SKILL_NAMES.filter((name) => name !== offender.skill)) expect(resultOf(run, skill, T_SHA).status).toBe("passed");
  });
});

/** Benign lookalikes: IRIS syntax and plain words the wording rules must keep accepting. */
const LOOKALIKES = [
  "Compile errors read `#1043: QUIT argument not allowed`.",
  "A translated status reads `ERREUR #5001: disk full`.",
  "The English text is `ERROR #5001: disk full`.",
  "Pass `/noload/nodelete/norecursive` to run a compiled class.",
  "See the `iris-mcp-objectscript-error-handling` skill for the status values.",
  "An AD-hoc check is not a planning id, and neither is a DW- prefix.",
  "Rules of thumb: read the signature first.",
];

describe("the committed knowledge test as a child process: benign lookalikes stay accepted (negative controls)", () => {
  it.each(SKILL_NAMES)("IRIS codes, an IRIS qualifier, a pack skill name and AD-hoc in %s keep every wording test green", (skill) => {
    const root = gateScratch();
    editSkill(root, skill, `${readFileSync(join(REPO_ROOT, sourceRel(skill)), "utf8")}\n${LOOKALIKES.map((line) => `- ${line}`).join("\n")}\n`);
    const run = runGate(root);
    for (const title of WORDING_TESTS) {
      const result = resultOf(run, skill, title);
      expect(result.status, `${skill} / ${title}\n${result.failure}`).toBe("passed");
    }
    // The edit was read: only the pinned hash (and what depends on it) is red, and only for the edited skill.
    expect(resultOf(run, skill, T_SHA).status).toBe("failed");
  });
});

describe("these rows are hermetic", () => {
  it("the real node_modules and the real knowledge sources are intact", () => {
    expect(existsSync(VITEST_ENTRY)).toBe(true);
    expect(readdirSync(join(REPO_ROOT, KNOWLEDGE_SOURCE_DIR)).sort()).toEqual([...SKILL_NAMES].sort());
    for (const skill of SKILL_NAMES) {
      expect(readFileSync(join(REPO_ROOT, sourceRel(skill))).equals(readFileSync(join(REPO_ROOT, packRel(skill))))).toBe(true);
    }
  });
});
