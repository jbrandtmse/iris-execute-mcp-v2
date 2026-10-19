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
// The script resolves its repository root from its own location, so a scratch
// tree holding a copy of the script and of src/ExecuteMCPv2 is a complete
// stand-in: the real embed is never touched.

// Repo root is 4 levels up from this test file:
// packages/shared/src/__tests__/gen-bootstrap-write.test.ts -> repo root
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../../..");

const EMBED_RELATIVE_PATH = join("packages", "shared", "src", "bootstrap-classes.ts");
const PAST_SECONDS = 1_000_000_000; // 2001-09-09, well before any real write

let scratch = "";
let script = "";
let embedPath = "";

function runGenerator(): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [script], { encoding: "utf8", cwd: scratch, timeout: 60000 });
  expect(result.error, "the generator started").toBeUndefined();
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function versionOf(content: string): string {
  const match = content.match(/export const BOOTSTRAP_VERSION = "([0-9a-f]{12})";/);
  expect(match, "the embed carries a BOOTSTRAP_VERSION").not.toBeNull();
  return match?.[1] ?? "";
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
  });

  it("a class change and its reversal give back the original embed byte for byte, and the run after that is unchanged", () => {
    const baseline = runGenerator();
    expect(baseline.status, baseline.stderr).toBe(0);
    const original = readFileSync(embedPath, "utf8");
    const classPath = join(scratch, "src", "ExecuteMCPv2", "Utils.cls");
    const classSource = readFileSync(classPath);

    appendFileSync(classPath, "\n// scratch change\n");
    const changed = runGenerator();
    expect(changed.stdout).toContain("Generated");
    expect(readFileSync(embedPath, "utf8"), "the change reached the embed").not.toBe(original);

    writeFileSync(classPath, classSource);
    const reverted = runGenerator();
    expect(reverted.stdout, "the embed no longer matches the sources, so it is rewritten").toContain("Generated");
    expect(readFileSync(embedPath, "utf8"), "the reversal gives the original embed back").toBe(original);
    expect(versionOf(readFileSync(embedPath, "utf8"))).toBe(versionOf(original));

    utimesSync(embedPath, PAST_SECONDS, PAST_SECONDS);
    const settled = runGenerator();
    expect(settled.stdout).toMatch(/unchanged/i);
    expect(statSync(embedPath).mtimeMs, "and the settled embed keeps its mtime").toBe(PAST_SECONDS * 1000);
  });

  it("the checked-in embed is exactly what the generator writes from the checked-in classes, so a run on a clean tree rewrites nothing", () => {
    // A scratch tree holds a copy of the real embed beside a copy of the real classes: the real files are only read.
    copyFileSync(join(REPO_ROOT, EMBED_RELATIVE_PATH), embedPath);
    const checkedIn = readFileSync(embedPath, "utf8");
    utimesSync(embedPath, PAST_SECONDS, PAST_SECONDS);

    const run = runGenerator();
    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout, "the generator found nothing to change").toMatch(/unchanged/i);
    expect(run.stdout).toContain(`BOOTSTRAP_VERSION: ${versionOf(checkedIn)}`);
    expect(readFileSync(embedPath, "utf8")).toBe(checkedIn);
    expect(statSync(embedPath).mtimeMs).toBe(PAST_SECONDS * 1000);
  });
});
