import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { copyGeneratorInputs } from "./gen-bootstrap-scratch.js";

// Story 40.5 (DW-591): scripts/gen-bootstrap.mjs rewrites
// packages/shared/src/bootstrap-classes.ts only when the generated content
// differs from the file on disk. The shared dist's freshness check compares
// mtimes, so an unconditional rewrite made an unchanged embed look stale.
//
// Story 42.2 (DW-508): the embed's BOOTSTRAP_VERSION is the marker
// `<semver>+<sequence>.<hash>`. The semver is the version of
// packages/shared/package.json; the sequence lives in
// scripts/bootstrap-sequence.json and rises by exactly 1 whenever the content
// hash differs from the hash recorded there.
//
// The script resolves its repository root from its own location, so a scratch
// tree holding a copy of the script, of src/ExecuteMCPv2, of the shared
// package.json and of the sequence state is a complete stand-in: the real
// embed and the real state are never touched.

// Repo root is 4 levels up from this test file:
// packages/shared/src/__tests__/gen-bootstrap-write.test.ts -> repo root
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");

const EMBED_RELATIVE_PATH = join("packages", "shared", "src", "bootstrap-classes.ts");
const MANIFEST_RELATIVE_PATH = join("packages", "shared", "package.json");
const STATE_RELATIVE_PATH = join("scripts", "bootstrap-sequence.json");
const IPM_GUARD_RELATIVE_PATH = join("ipm", "preload", "ExecuteMCPv2", "InstallGuard.cls");
const PAST_SECONDS = 1_000_000_000; // 2001-09-09, well before any real write

let scratch = "";
let script = "";
let embedPath = "";
let statePath = "";
let manifestPath = "";
let guardPath = "";

function runGenerator(args: string[] = []): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: "utf8", cwd: scratch, timeout: 60000 });
  expect(result.error, "the generator started").toBeUndefined();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** The number of classes in the scratch generator's `classes[]` literal. */
function rosterSize(): number {
  const source = readFileSync(join(scratch, "scripts", "gen-bootstrap.mjs"), "utf8");
  const literal = /const classes = \[([\s\S]*?)\n\];/.exec(source)?.[1] ?? "";
  const size = [...literal.matchAll(/\{\s*name:\s*'([^']+)',\s*path:\s*'([^']+)'\s*\}/g)].length;
  expect(size, "the roster literal was read").toBeGreaterThan(0);
  return size;
}

function versionOf(content: string): string {
  const match = content.match(/export const BOOTSTRAP_VERSION = "(\d+\.\d+\.\d+\+\d+\.[0-9a-f]{12})";/);
  expect(match, "the embed carries a BOOTSTRAP_VERSION marker").not.toBeNull();
  return match?.[1] ?? "";
}

function sequenceOf(content: string): number {
  return Number(/\+(\d+)\./.exec(versionOf(content))?.[1]);
}

function hashOf(content: string): string {
  return /\.([0-9a-f]{12})$/.exec(versionOf(content))?.[1] ?? "";
}

function stateOf(): { sequence: number; hash: string } {
  return JSON.parse(readFileSync(statePath, "utf8")) as { sequence: number; hash: string };
}

describe("gen-bootstrap writes the embed only when its content changes (DW-591)", () => {
  // Each test builds its own scratch tree, so it passes alone, filtered or in any order.
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "gen-bootstrap-write-"));
    copyGeneratorInputs(scratch, REPO_ROOT);
    script = join(scratch, "scripts", "gen-bootstrap.mjs");
    manifestPath = join(scratch, MANIFEST_RELATIVE_PATH);
    statePath = join(scratch, STATE_RELATIVE_PATH);
    embedPath = join(scratch, EMBED_RELATIVE_PATH);
    guardPath = join(scratch, IPM_GUARD_RELATIVE_PATH);
  });

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("an unchanged run leaves the file's mtime and content as they were and says so", () => {
    // First run: the embed does not exist yet, so it is written.
    const first = runGenerator();
    expect(first.status, first.stderr).toBe(0);
    expect(first.stdout).toContain("Generated");
    expect(existsSync(embedPath)).toBe(true);
    const written = readFileSync(embedPath, "utf8");

    // Pin the mtime in the past, then run again with identical sources.
    utimesSync(embedPath, PAST_SECONDS, PAST_SECONDS);
    const pinned = statSync(embedPath).mtimeMs;
    expect(pinned).toBe(PAST_SECONDS * 1000);

    const second = runGenerator();
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/unchanged/i);
    expect(second.stdout).toContain(`BOOTSTRAP_VERSION: ${versionOf(written)}`);
    expect(second.stdout).not.toContain("Generated");
    expect(statSync(embedPath).mtimeMs, "the unchanged embed keeps its mtime").toBe(pinned);
    expect(readFileSync(embedPath, "utf8"), "the unchanged embed keeps its content").toBe(written);
  });

  it("a changed run rewrites the file, moves its mtime and gives it a new BOOTSTRAP_VERSION", () => {
    // Baseline: the embed of the unchanged sources.
    const baseline = runGenerator();
    expect(baseline.status, baseline.stderr).toBe(0);
    expect(existsSync(embedPath)).toBe(true);
    const before = readFileSync(embedPath, "utf8");
    utimesSync(embedPath, PAST_SECONDS, PAST_SECONDS);
    const pinned = statSync(embedPath).mtimeMs;

    appendFileSync(join(scratch, "src", "ExecuteMCPv2", "Utils.cls"), "\n// scratch change\n");
    const run = runGenerator();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("Generated");
    // The embed line only: the manifest does not depend on class content, so its own line says Unchanged.
    expect(run.stdout).not.toMatch(/Unchanged .*bootstrap-classes\.ts/);

    const after = readFileSync(embedPath, "utf8");
    expect(statSync(embedPath).mtimeMs, "the rewritten embed has a new mtime").toBeGreaterThan(pinned);
    expect(after).not.toBe(before);
    expect(versionOf(after)).not.toBe(versionOf(before));
    expect(run.stdout).toContain(`BOOTSTRAP_VERSION: ${versionOf(after)}`);
  });

  it("an embed edited by hand, with its BOOTSTRAP_VERSION line intact, is written back to the generated content", () => {
    const baseline = runGenerator();
    expect(baseline.status, baseline.stderr).toBe(0);
    const generated = readFileSync(embedPath, "utf8");

    // The edit leaves the version line alone, so only a comparison of the whole content can see it.
    const edited = generated.replace("export interface BootstrapClass {", "export interface BootstrapClass {\n  // hand edit");
    expect(edited, "the edit changed the content").not.toBe(generated);
    expect(versionOf(edited), "and left the version line as it was").toBe(versionOf(generated));
    writeFileSync(embedPath, edited);
    utimesSync(embedPath, PAST_SECONDS, PAST_SECONDS);
    const pinned = statSync(embedPath).mtimeMs;

    const run = runGenerator();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("Generated");
    expect(run.stdout).not.toMatch(/Unchanged .*bootstrap-classes\.ts/);
    expect(readFileSync(embedPath, "utf8"), "the hand edit is gone").toBe(generated);
    expect(statSync(embedPath).mtimeMs, "the rewrite has a new mtime").toBeGreaterThan(pinned);
    expect(hashOf(generated), "and the hand edit did not move the sequence").toBe(stateOf().hash);
    expect(sequenceOf(generated)).toBe(stateOf().sequence);
  });

  it("a class change and its reversal never lower the sequence: the original hash comes back under a higher sequence, and the run after that is unchanged", () => {
    const baseline = runGenerator();
    expect(baseline.status, baseline.stderr).toBe(0);
    const original = readFileSync(embedPath, "utf8");
    const classPath = join(scratch, "src", "ExecuteMCPv2", "Utils.cls");
    const classSource = readFileSync(classPath);

    appendFileSync(classPath, "\n// scratch change\n");
    const changed = runGenerator();
    expect(changed.stdout).toContain("Generated");
    expect(readFileSync(embedPath, "utf8"), "the change reached the embed").not.toBe(original);
    expect(sequenceOf(readFileSync(embedPath, "utf8"))).toBe(sequenceOf(original) + 1);

    writeFileSync(classPath, classSource);
    const reverted = runGenerator();
    expect(reverted.stdout, "the embed no longer matches the sources, so it is rewritten").toContain("Generated");
    const after = readFileSync(embedPath, "utf8");
    expect(hashOf(after), "the reversal gives the original content hash back").toBe(hashOf(original));
    expect(sequenceOf(after), "under a sequence that only ever rose").toBe(sequenceOf(original) + 2);
    expect(stateOf()).toEqual({ sequence: sequenceOf(original) + 2, hash: hashOf(original) });

    utimesSync(embedPath, PAST_SECONDS, PAST_SECONDS);
    const settled = runGenerator();
    expect(settled.stdout).toMatch(/unchanged/i);
    expect(statSync(embedPath).mtimeMs, "and the settled embed keeps its mtime").toBe(PAST_SECONDS * 1000);
  });

  it("the checked-in embed is exactly what the generator writes from the checked-in classes, so a run on a clean tree rewrites nothing", () => {
    // A scratch tree holds a copy of the real embed beside a copy of the real classes: the real files are only read.
    copyFileSync(join(REPO_ROOT, EMBED_RELATIVE_PATH), embedPath);
    const checkedIn = readFileSync(embedPath, "utf8");
    const stateBefore = readFileSync(statePath, "utf8");
    utimesSync(embedPath, PAST_SECONDS, PAST_SECONDS);

    const run = runGenerator();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout, "the generator found nothing to change").toMatch(/unchanged/i);
    expect(run.stdout).toContain(`BOOTSTRAP_VERSION: ${versionOf(checkedIn)}`);
    expect(readFileSync(embedPath, "utf8")).toBe(checkedIn);
    expect(statSync(embedPath).mtimeMs).toBe(PAST_SECONDS * 1000);
    expect(readFileSync(statePath, "utf8"), "and the state file is byte-identical").toBe(stateBefore);
  });
});

describe("gen-bootstrap stamps <semver>+<sequence>.<hash> (DW-508)", () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "gen-bootstrap-marker-"));
    copyGeneratorInputs(scratch, REPO_ROOT);
    script = join(scratch, "scripts", "gen-bootstrap.mjs");
    manifestPath = join(scratch, MANIFEST_RELATIVE_PATH);
    statePath = join(scratch, STATE_RELATIVE_PATH);
    embedPath = join(scratch, EMBED_RELATIVE_PATH);
    guardPath = join(scratch, IPM_GUARD_RELATIVE_PATH);
  });

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("an unchanged rerun keeps the sequence and leaves the state file byte-identical", () => {
    // The baseline is the state the first run leaves, so the check holds whether or not the copied state matched the
    // copied classes (that match is the drift test's job, in bootstrap.test.ts).
    const first = runGenerator();
    expect(first.status, first.stderr).toBe(0);
    const stateAfterFirst = readFileSync(statePath, "utf8");
    const embedAfterFirst = readFileSync(embedPath, "utf8");

    const second = runGenerator();
    expect(second.status, second.stderr).toBe(0);

    expect(second.stdout).toMatch(/unchanged/i);
    expect(readFileSync(statePath, "utf8")).toBe(stateAfterFirst);
    expect(readFileSync(embedPath, "utf8")).toBe(embedAfterFirst);
    expect(sequenceOf(embedAfterFirst)).toBe(JSON.parse(stateAfterFirst).sequence);
  });

  it("the hand-committed first state (sequence 0, empty hash) makes the first run sequence 1 and records the hash, and the run after that keeps both", () => {
    writeFileSync(statePath, '{"sequence": 0, "hash": ""}\n');

    const first = runGenerator();
    expect(first.status, first.stderr).toBe(0);
    const embed = readFileSync(embedPath, "utf8");

    expect(sequenceOf(embed)).toBe(1);
    expect(stateOf()).toEqual({ sequence: 1, hash: hashOf(embed) });

    const stateAfter = readFileSync(statePath, "utf8");
    const second = runGenerator();
    expect(second.status, second.stderr).toBe(0);
    expect(second.stdout).toMatch(/unchanged/i);
    expect(readFileSync(statePath, "utf8")).toBe(stateAfter);
  });

  it("a class edit raises the sequence by exactly 1, records the new hash, and a rerun then keeps both", () => {
    const before = stateOf();
    appendFileSync(join(scratch, "src", "ExecuteMCPv2", "Utils.cls"), "\n// scratch change\n");

    const run = runGenerator();
    expect(run.status, run.stderr).toBe(0);
    const embed = readFileSync(embedPath, "utf8");

    expect(sequenceOf(embed)).toBe(before.sequence + 1);
    expect(stateOf()).toEqual({ sequence: before.sequence + 1, hash: hashOf(embed) });
    expect(hashOf(embed), "the hash moved with the class").not.toBe(before.hash);

    const stateAfter = readFileSync(statePath, "utf8");
    const rerun = runGenerator();
    expect(rerun.status, rerun.stderr).toBe(0);
    expect(readFileSync(statePath, "utf8")).toBe(stateAfter);
    expect(readFileSync(embedPath, "utf8")).toBe(embed);
  });

  it("the semver is the version of packages/shared/package.json; a bump with no class change moves the semver only", () => {
    const first = runGenerator();
    expect(first.status, first.stderr).toBe(0);
    const before = readFileSync(embedPath, "utf8");
    const stateBefore = readFileSync(statePath, "utf8");

    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: "7.8.9" }));
    const run = runGenerator();
    expect(run.status, run.stderr).toBe(0);
    const after = readFileSync(embedPath, "utf8");

    expect(versionOf(after)).toBe(`7.8.9+${sequenceOf(before)}.${hashOf(before)}`);
    expect(readFileSync(statePath, "utf8"), "the hash did not change, so the state file did not either").toBe(stateBefore);
  });

  it("the marker is stamped into the embedded Setup.cls, and the placeholder on disk is left alone", () => {
    const run = runGenerator();
    expect(run.status, run.stderr).toBe(0);
    const embed = readFileSync(embedPath, "utf8");

    expect(embed).toContain(`Parameter BOOTSTRAPVERSION = "${versionOf(embed)}";`);
    expect(embed).not.toContain('Parameter BOOTSTRAPVERSION = "dev";');
    expect(readFileSync(join(scratch, "src", "ExecuteMCPv2", "Setup.cls"), "utf8")).toContain(
      'Parameter BOOTSTRAPVERSION = "dev";',
    );
  });

  it("a missing state file is an error that says to restore it from git, and writes nothing", () => {
    rmSync(statePath);

    const run = runGenerator();

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("scripts/bootstrap-sequence.json is missing");
    expect(run.stderr).toContain("restore it from git; the sequence never goes backwards");
    expect(existsSync(statePath), "the generator did not recreate the state").toBe(false);
    expect(existsSync(embedPath), "and did not write an embed").toBe(false);
  });

  it.each([
    ["not JSON", "not json"],
    ["a negative sequence", '{"sequence": -1, "hash": ""}'],
    ["a fractional sequence", '{"sequence": 1.5, "hash": ""}'],
    ["a string sequence", '{"sequence": "1", "hash": ""}'],
    ["an uppercase hash", '{"sequence": 1, "hash": "ABCDEFABCDEF"}'],
    ["a short hash", '{"sequence": 1, "hash": "abc"}'],
    ["no hash", '{"sequence": 1}'],
  ])("a malformed state file (%s) is an error and writes no embed", (_label, content) => {
    writeFileSync(statePath, content);

    const run = runGenerator();

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("bootstrap-sequence.json");
    expect(existsSync(embedPath)).toBe(false);
    expect(readFileSync(statePath, "utf8"), "the bad state is not rewritten").toBe(content);
  });

  it.each([
    ["a pre-release", "1.0.0-beta.1"],
    ["two parts", "1.0"],
    ["a leading v", "v1.0.0"],
    ["a build suffix", "1.0.0+5"],
  ])("a shared package version that is not MAJOR.MINOR.PATCH (%s) is an error", (_label, version) => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    writeFileSync(manifestPath, JSON.stringify({ ...manifest, version }));

    const run = runGenerator();

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("MAJOR.MINOR.PATCH");
    expect(existsSync(embedPath)).toBe(false);
  });
});


// Story 42.4 (AD-14, DW-674): the generator also stamps the IPM install guard, whose content joins the marker's hash.
describe("gen-bootstrap stamps the IPM install guard (Story 42.4)", () => {
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "gen-bootstrap-ipm-"));
    copyGeneratorInputs(scratch, REPO_ROOT);
    script = join(scratch, "scripts", "gen-bootstrap.mjs");
    manifestPath = join(scratch, MANIFEST_RELATIVE_PATH);
    statePath = join(scratch, STATE_RELATIVE_PATH);
    embedPath = join(scratch, EMBED_RELATIVE_PATH);
    guardPath = join(scratch, IPM_GUARD_RELATIVE_PATH);
  });

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("an install guard without the placeholder line is an error that names the file and writes nothing", () => {
    const guard = readFileSync(guardPath, "utf8");
    writeFileSync(guardPath, guard.replace('Parameter BOOTSTRAPVERSION = "dev";', 'Parameter BOOTSTRAPVERSION = "stamped by hand";'));
    const stateBefore = readFileSync(statePath, "utf8");

    const run = runGenerator();

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("placeholder not found in InstallGuard.cls");
    expect(run.stderr).toContain("ipm/preload/ExecuteMCPv2/InstallGuard.cls");
    expect(run.stderr).toContain('Parameter BOOTSTRAPVERSION = "dev";');
    expect(existsSync(embedPath), "no embed was written").toBe(false);
    expect(readFileSync(statePath, "utf8"), "and so is the sequence state").toBe(stateBefore);
  });

  it("a Setup class without the placeholder line is still an error that names its file and writes nothing", () => {
    const setupPath = join(scratch, "src", "ExecuteMCPv2", "Setup.cls");
    writeFileSync(setupPath, readFileSync(setupPath, "utf8").replace('Parameter BOOTSTRAPVERSION = "dev";', 'Parameter BOOTSTRAPVERSION = "stamped by hand";'));
    const stateBefore = readFileSync(statePath, "utf8");

    const run = runGenerator();

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("placeholder not found in Setup.cls");
    expect(run.stderr).toContain("src/ExecuteMCPv2/Setup.cls");
    expect(existsSync(embedPath)).toBe(false);
    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
  });

  it("a missing install guard is an error that names the file and writes nothing", () => {
    rmSync(guardPath);

    const run = runGenerator();

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("InstallGuard.cls");
    expect(existsSync(embedPath)).toBe(false);
  });

  it("the guard's content joins the marker: editing it raises the sequence by 1, moves the hash and reaches the embedded guard, not Setup", () => {
    const baseline = runGenerator();
    expect(baseline.status, baseline.stderr).toBe(0);
    const before = readFileSync(embedPath, "utf8");

    appendFileSync(guardPath, "\n/// scratch change\n");
    const run = runGenerator();

    expect(run.status, run.stderr).toBe(0);
    const after = readFileSync(embedPath, "utf8");
    expect(sequenceOf(after)).toBe(sequenceOf(before) + 1);
    expect(hashOf(after)).not.toBe(hashOf(before));
    expect(stateOf()).toEqual({ sequence: sequenceOf(after), hash: hashOf(after) });
    expect(after).toContain("/// scratch change");
  });

  it("the marker is stamped into the embedded guard as well as Setup, and the placeholder on disk is left alone", () => {
    const run = runGenerator();
    expect(run.status, run.stderr).toBe(0);
    const embed = readFileSync(embedPath, "utf8");
    const marker = versionOf(embed);

    const guardBlock = embed.slice(embed.indexOf("export const IPM_INSTALL_GUARD"));
    expect(guardBlock).toContain(`Parameter BOOTSTRAPVERSION = "${marker}";`);
    expect(guardBlock).not.toContain('Parameter BOOTSTRAPVERSION = "dev";');
    expect(embed).toContain('export const IPM_MODULE_NAME = "iris-execute-mcp-v2";');
    expect(readFileSync(guardPath, "utf8"), "the disk copy keeps the placeholder").toContain('Parameter BOOTSTRAPVERSION = "dev";');
  });

  it("the install guard stays out of classes[]: the embed holds the same bootstrapped classes as the roster", () => {
    const run = runGenerator();
    expect(run.status, run.stderr).toBe(0);
    const embed = readFileSync(embedPath, "utf8");
    const classBlock = embed.slice(embed.indexOf("export const BOOTSTRAP_CLASSES"), embed.indexOf("export function getBootstrapClasses"));
    expect(classBlock).not.toContain("ExecuteMCPv2.InstallGuard");
    expect(embed).toContain(`Contains all ${rosterSize()} production classes`);
  });
});

// Story 42.8 (decision #122; AD-14): the generator's ipm mode writes the committed IPM tree -- the root module.xml, one stamped file per
// class under ipm/src/cls, and the stamped guard under preload/ -- and only at the version step. The scratch tree starts with none of
// it. The oracle for a tree file is its SOURCE (Rule #36): the source with line ends normalized, the placeholder line replaced by the
// marker for Setup and the guard, and a final newline.
describe("gen-bootstrap --ipm writes the stamped IPM tree only at the version step (Story 42.8)", () => {
  const TREE_MANIFEST = () => join(scratch, "module.xml");
  const TREE_UTILS = () => join(scratch, "ipm", "src", "cls", "ExecuteMCPv2", "Utils.cls");
  const TREE_SETUP = () => join(scratch, "ipm", "src", "cls", "ExecuteMCPv2", "Setup.cls");
  const TREE_GUARD = () => join(scratch, "preload", "ipm", "src", "cls", "ExecuteMCPv2", "InstallGuard.cls");
  /** The refusal text at the scratch world's shared version, read from its packages/shared/package.json. */
  const refusal = (): RegExp => {
    const { version } = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
    const v = version.replace(/\./g, "\\.");
    return new RegExp(`the IPM tree is already at ${v}; it is regenerated only by the version step \\(pnpm run version\\), so main keeps the content the registry serves for ${v}\\. Pass --force only to repair a damaged tree\\.`);
  };
  /** The files the tree holds for the scratch roster: one per class, the guard and module.xml. */
  const treeFileCount = (): number => rosterSize() + 2;

  /** Every file under `directory`, relative with forward slashes, sorted. */
  function filesUnder(directory: string, base = directory): string[] {
    if (!existsSync(directory)) return [];
    return readdirSync(directory, { withFileTypes: true })
      .flatMap((entry) => (entry.isDirectory() ? filesUnder(join(directory, entry.name), base) : [relative(base, join(directory, entry.name)).split(sep).join("/")]))
      .sort();
  }
  /** The tree as the scratch repository holds it: the root manifest, the files under ipm/src and the files under preload, with their text. */
  function treeSnapshot(): Record<string, string> {
    const snapshot: Record<string, string> = {};
    if (existsSync(TREE_MANIFEST())) snapshot["module.xml"] = readFileSync(TREE_MANIFEST(), "utf8");
    for (const top of ["ipm/src", "preload"]) for (const file of filesUnder(join(scratch, top))) snapshot[`${top}/${file}`] = readFileSync(join(scratch, top, file), "utf8");
    return snapshot;
  }
  /** The text a source file becomes in the tree, with `marker` for the one placeholder line it may carry. */
  function expectedFrom(source: string, marker: string): string {
    const text = readFileSync(source, "utf8").replace(/\r\n/g, "\n").trimEnd();
    return `${text.replace('Parameter BOOTSTRAPVERSION = "dev";', `Parameter BOOTSTRAPVERSION = "${marker}";`)}\n`;
  }

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), "gen-bootstrap-tree-"));
    copyGeneratorInputs(scratch, REPO_ROOT);
    script = join(scratch, "scripts", "gen-bootstrap.mjs");
    manifestPath = join(scratch, MANIFEST_RELATIVE_PATH);
    statePath = join(scratch, STATE_RELATIVE_PATH);
    embedPath = join(scratch, EMBED_RELATIVE_PATH);
    guardPath = join(scratch, IPM_GUARD_RELATIVE_PATH);
  });

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("a plain run writes no IPM file at all: the tree is not an output of pnpm gen:bootstrap", () => {
    const run = runGenerator();

    expect(run.status, run.stderr).toBe(0);
    expect(existsSync(embedPath)).toBe(true);
    expect(treeSnapshot(), "no module.xml, no file under ipm/src, no file under preload").toEqual({});
    expect(existsSync(join(scratch, "module.xml"))).toBe(false);
    expect(existsSync(join(scratch, "ipm", "src"))).toBe(false);
    expect(existsSync(join(scratch, "preload"))).toBe(false);
  });

  it("--ipm on a repository with no tree (the first generation, at the shared version) writes module.xml, one file per class and the guard, each the stamped source", () => {
    const run = runGenerator(["--ipm"]);

    expect(run.status, run.stderr).toBe(0);
    const marker = versionOf(readFileSync(embedPath, "utf8"));
    const shared = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
    const snapshot = treeSnapshot();
    const classFiles = Object.keys(snapshot).filter((file) => file.startsWith("ipm/src/cls/ExecuteMCPv2/"));
    expect(classFiles, "one file per class of classes[]").toHaveLength(rosterSize());
    expect(Object.keys(snapshot).filter((file) => file.startsWith("preload/"))).toEqual(["preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls"]);
    expect(Object.keys(snapshot)).toHaveLength(treeFileCount());
    expect(snapshot["module.xml"]).toContain(`<Version>${shared.version}</Version>`);
    expect(snapshot["module.xml"]).toContain("<SourcesRoot>ipm/src</SourcesRoot>");
    for (const file of classFiles) {
      const source = join(scratch, "src", file.slice("ipm/src/cls/".length));
      expect(snapshot[file], file).toBe(expectedFrom(source, marker));
    }
    expect(snapshot["preload/ipm/src/cls/ExecuteMCPv2/InstallGuard.cls"]).toBe(expectedFrom(guardPath, marker));
    expect(snapshot["ipm/src/cls/ExecuteMCPv2/Setup.cls"]).toContain(`Parameter BOOTSTRAPVERSION = "${marker}";`);
    expect(Object.values(snapshot).some((text) => text.includes('Parameter BOOTSTRAPVERSION = "dev";')), "no file holds the dev placeholder").toBe(false);
    expect(run.stdout).toContain(`${treeFileCount()} files (${treeFileCount()} written, 0 unchanged, 0 removed)`);
    expect(readFileSync(guardPath, "utf8"), "the dev source is untouched").toContain('Parameter BOOTSTRAPVERSION = "dev";');

    const check = runGenerator(["--ipm-check"]);
    expect(check.status, check.stderr).toBe(0);
    expect(check.stdout).toContain("gen:ipm:check: OK");
  });

  it("--ipm again at the same version refuses with exit 2 and the text, and writes nothing: the files keep their content and mtime", () => {
    expect(runGenerator(["--ipm"]).status).toBe(0);
    const before = treeSnapshot();
    for (const file of [TREE_MANIFEST(), TREE_SETUP(), TREE_GUARD()]) utimesSync(file, PAST_SECONDS, PAST_SECONDS);

    const run = runGenerator(["--ipm"]);

    expect(run.status, run.stderr).toBe(2);
    expect(run.stderr).toMatch(refusal());
    expect(treeSnapshot()).toEqual(before);
    for (const file of [TREE_MANIFEST(), TREE_SETUP(), TREE_GUARD()]) expect(statSync(file).mtimeMs, file).toBe(PAST_SECONDS * 1000);
  });

  it("a class edited and --ipm at the same version: the embed moves by one in sequence, the refusal exits 2, and the tree is the released content untouched", () => {
    expect(runGenerator(["--ipm"]).status).toBe(0);
    const released = treeSnapshot();
    const releasedMarker = versionOf(readFileSync(embedPath, "utf8"));
    appendFileSync(join(scratch, "src", "ExecuteMCPv2", "Utils.cls"), "\n/// edited after the release\n");

    const run = runGenerator(["--ipm"]);

    expect(run.status, run.stderr).toBe(2);
    expect(run.stderr).toMatch(refusal());
    const embedded = versionOf(readFileSync(embedPath, "utf8"));
    expect(sequenceOf(readFileSync(embedPath, "utf8")), "the embed was written as plain gen:bootstrap writes it").toBe(Number(/\+(\d+)\./.exec(releasedMarker)?.[1]) + 1);
    expect(embedded).not.toBe(releasedMarker);
    expect(treeSnapshot(), "the tree is the released content, byte for byte").toEqual(released);
    expect(readFileSync(TREE_UTILS(), "utf8")).not.toContain("edited after the release");
    const check = runGenerator(["--ipm-check"]);
    expect(check.status, `the tree still hashes to its own marker: ${check.stderr}`).toBe(0);
  });

  it("--ipm --force repairs the tree: it rewrites a damaged file and stamps the embed's current marker everywhere", () => {
    expect(runGenerator(["--ipm"]).status).toBe(0);
    writeFileSync(TREE_UTILS(), "Class ExecuteMCPv2.Utils\n{\n}\n");
    appendFileSync(join(scratch, "src", "ExecuteMCPv2", "Utils.cls"), "\n/// edited after the release\n");

    const run = runGenerator(["--ipm", "--force"]);

    expect(run.status, run.stderr).toBe(0);
    const marker = versionOf(readFileSync(embedPath, "utf8"));
    expect(readFileSync(TREE_UTILS(), "utf8")).toBe(expectedFrom(join(scratch, "src", "ExecuteMCPv2", "Utils.cls"), marker));
    expect(readFileSync(TREE_SETUP(), "utf8")).toContain(`Parameter BOOTSTRAPVERSION = "${marker}";`);
    expect(readFileSync(TREE_GUARD(), "utf8")).toContain(`Parameter BOOTSTRAPVERSION = "${marker}";`);
    expect(runGenerator(["--ipm-check"]).status).toBe(0);
  });

  it("the version step: a raised shared version lets --ipm regenerate, moving <Version>, the marker's semver and the stamps, and nothing else in module.xml", () => {
    expect(runGenerator(["--ipm"]).status).toBe(0);
    const before = treeSnapshot();
    const shared = JSON.parse(readFileSync(manifestPath, "utf8")) as { version: string };
    writeFileSync(manifestPath, JSON.stringify({ ...shared, version: "7.8.9" }));

    const run = runGenerator(["--ipm"]);

    expect(run.status, run.stderr).toBe(0);
    const marker = versionOf(readFileSync(embedPath, "utf8"));
    expect(marker).toMatch(/^7\.8\.9\+/);
    const after = treeSnapshot();
    expect(after["module.xml"]).toContain("<Version>7.8.9</Version>");
    expect((after["module.xml"] as string).replace("<Version>7.8.9</Version>", `<Version>${shared.version}</Version>`)).toBe(before["module.xml"]);
    expect(readFileSync(TREE_SETUP(), "utf8")).toContain(`Parameter BOOTSTRAPVERSION = "${marker}";`);
    expect(readFileSync(TREE_GUARD(), "utf8")).toContain(`Parameter BOOTSTRAPVERSION = "${marker}";`);
    expect(Object.keys(after), "the same files").toEqual(Object.keys(before));
    expect(runGenerator(["--ipm-check"]).status, "clean at the new version").toBe(0);
    expect(runGenerator(["--ipm"]).status, "and frozen again until the next version").toBe(2);
  });

  it("removes the files the class list no longer names, and the directories they leave empty", () => {
    expect(runGenerator(["--ipm"]).status).toBe(0);
    writeFileSync(join(scratch, "ipm", "src", "cls", "ExecuteMCPv2", "Removed.cls"), "Class ExecuteMCPv2.Removed\n{\n}\n");
    mkdirSync(join(scratch, "ipm", "src", "cls", "ExecuteMCPv2", "Gone"), { recursive: true });
    writeFileSync(join(scratch, "ipm", "src", "cls", "ExecuteMCPv2", "Gone", "Old.cls"), "Class ExecuteMCPv2.Gone.Old\n{\n}\n");
    writeFileSync(join(scratch, "preload", "stray.txt"), "x\n");

    const run = runGenerator(["--ipm", "--force"]);

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain("3 removed");
    expect(existsSync(join(scratch, "ipm", "src", "cls", "ExecuteMCPv2", "Removed.cls"))).toBe(false);
    expect(existsSync(join(scratch, "ipm", "src", "cls", "ExecuteMCPv2", "Gone")), "the directory left empty is removed").toBe(false);
    expect(existsSync(join(scratch, "preload", "stray.txt"))).toBe(false);
    expect(runGenerator(["--ipm-check"]).status).toBe(0);
  });

  it("--ipm-check writes nothing and needs no embed: on an empty repository it fails naming the missing module.xml and the command", () => {
    const run = runGenerator(["--ipm-check"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toContain("module.xml is missing from the repository root");
    expect(run.stderr).toContain("pnpm gen:ipm");
    expect(existsSync(embedPath), "no embed was written").toBe(false);
    expect(readFileSync(statePath, "utf8")).toBe(readFileSync(join(REPO_ROOT, STATE_RELATIVE_PATH), "utf8"));
  });

  it("--ipm-check refuses a class edited by hand, naming the marker, and the repair command", () => {
    expect(runGenerator(["--ipm"]).status).toBe(0);
    appendFileSync(TREE_UTILS(), "// edited by hand\n");

    const run = runGenerator(["--ipm-check"]);

    expect(run.status).toBe(1);
    expect(run.stderr).toMatch(/does not hash to the marker \d+\.\d+\.\d+\+\d+\.[0-9a-f]{12} it carries: the tree was edited by hand\. Run pnpm gen:ipm -- --force from a clean version commit, or restore it from git\./);
  });

  it.each([
    [["--force"], "--force alone"],
    [["--ipm", "--ipm-check"], "both modes"],
    [["--ipm-check", "--force"], "--force with the check"],
    [["--bogus"], "an unknown flag"],
    [["--ipm", "extra"], "a stray word"],
  ])("refuses %j (%s) with exit 2 and the usage line, and writes nothing", (args) => {
    const run = runGenerator(args);

    expect(run.status).toBe(2);
    expect(run.stderr).toContain("usage: node scripts/gen-bootstrap.mjs [--ipm [--force] | --ipm-check]");
    expect(existsSync(embedPath)).toBe(false);
    expect(treeSnapshot()).toEqual({});
  });

  it("ignores a literal -- between the flags, as a package manager may pass it through", () => {
    const run = runGenerator(["--ipm", "--", "--force"]);

    expect(run.status, run.stderr).toBe(0);
    expect(Object.keys(treeSnapshot())).toHaveLength(treeFileCount());
  });
});
