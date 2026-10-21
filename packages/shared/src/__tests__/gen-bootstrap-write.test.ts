import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
const PAST_SECONDS = 1_000_000_000; // 2001-09-09, well before any real write

let scratch = "";
let script = "";
let embedPath = "";
let statePath = "";
let manifestPath = "";

function runGenerator(): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: scratch, timeout: 60000 });
  expect(result.error, "the generator started").toBeUndefined();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
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
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    script = join(scratch, "scripts", "gen-bootstrap.mjs");
    copyFileSync(join(REPO_ROOT, "scripts", "gen-bootstrap.mjs"), script);
    cpSync(join(REPO_ROOT, "src", "ExecuteMCPv2"), join(scratch, "src", "ExecuteMCPv2"), { recursive: true });
    mkdirSync(join(scratch, "packages", "shared", "src"), { recursive: true });
    manifestPath = join(scratch, MANIFEST_RELATIVE_PATH);
    copyFileSync(join(REPO_ROOT, MANIFEST_RELATIVE_PATH), manifestPath);
    statePath = join(scratch, STATE_RELATIVE_PATH);
    copyFileSync(join(REPO_ROOT, STATE_RELATIVE_PATH), statePath);
    embedPath = join(scratch, EMBED_RELATIVE_PATH);
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
    expect(run.stdout).not.toMatch(/unchanged/i);

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
    expect(run.stdout).not.toMatch(/unchanged/i);
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
    mkdirSync(join(scratch, "scripts"), { recursive: true });
    script = join(scratch, "scripts", "gen-bootstrap.mjs");
    copyFileSync(join(REPO_ROOT, "scripts", "gen-bootstrap.mjs"), script);
    cpSync(join(REPO_ROOT, "src", "ExecuteMCPv2"), join(scratch, "src", "ExecuteMCPv2"), { recursive: true });
    mkdirSync(join(scratch, "packages", "shared", "src"), { recursive: true });
    manifestPath = join(scratch, MANIFEST_RELATIVE_PATH);
    copyFileSync(join(REPO_ROOT, MANIFEST_RELATIVE_PATH), manifestPath);
    statePath = join(scratch, STATE_RELATIVE_PATH);
    copyFileSync(join(REPO_ROOT, STATE_RELATIVE_PATH), statePath);
    embedPath = join(scratch, EMBED_RELATIVE_PATH);
  });

  afterEach(() => {
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  });

  it("an unchanged rerun keeps the sequence and leaves the state file byte-identical", () => {
    const stateBefore = readFileSync(statePath, "utf8");

    const first = runGenerator();
    expect(first.status, first.stderr).toBe(0);
    const second = runGenerator();
    expect(second.status, second.stderr).toBe(0);

    expect(readFileSync(statePath, "utf8")).toBe(stateBefore);
    expect(sequenceOf(readFileSync(embedPath, "utf8"))).toBe(JSON.parse(stateBefore).sequence);
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
