/**
 * Story 42.1 QA (I/O matrix row "After release"; Rule #45, Rule #59) - every test that reads a pending changeset survives
 * `changeset version` consuming them.
 *
 * Story 42.6 applies the 1.0.0 template and runs `changeset version`, which deletes every `.changeset/*.md`. A doc-claims
 * test that reads its story's changeset without a presence guard then throws ENOENT, at module load or at collection. The
 * guards themselves only run on that path, so a static look at them proves nothing: this test runs the real tests on it.
 *
 *  1. The control. `hide-changesets-preload.mjs` (loaded with `node --import`) makes the `.md` files of one directory look
 *     consumed to `node:fs`; a synthetic changeset directory shows what it hides and what it leaves alone.
 *  2. The run. Every test file of this package that mentions `.changeset` (found by reading the sources, so a later story's
 *     test is picked up as soon as it exists) runs in its own vitest process, under the package's own config, with the real
 *     `.changeset` hidden. All of them must pass: a failure here is an unguarded reader.
 *
 * Nothing on disk moves: the real `.changeset/` is only hidden from the child's `node:fs` calls. A default-suite test (no IRIS);
 * the child run gets a closed port and drops every `IRIS_*` variable of this process.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "./pack-fixture";
import { inheritedEnv, reserveClosedPort } from "./process-gate-helpers.js";

const TESTS_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join(REPO_ROOT, "packages/iris-mcp-all");
const PRELOAD = join(TESTS_DIR, "hide-changesets-preload.mjs");
const VITEST_ENTRY = join(dirname(createRequire(import.meta.url).resolve("vitest/package.json")), "vitest.mjs");
const SELF = basename(fileURLToPath(import.meta.url));

/** The nine tests that read a pending changeset when Story 42.1 guarded them (its Code Map): the run must include each. */
const KNOWN_READERS = [
  "story-38-5-qa-doc-claims.test.ts",
  "story-38-6-doc-claims.test.ts",
  "story-40-1-doc-claims.test.ts",
  "story-40-2-doc-claims.test.ts",
  "story-40-3-doc-claims.test.ts",
  "story-40-4-doc-claims.test.ts",
  "story-40-5-doc-claims.test.ts",
  "story-43-3-doc-claims.test.ts",
  "story-43-4-doc-claims.test.ts",
];

const tempDirs: string[] = [];
afterAll(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Every test file of this package whose source mentions `.changeset`, other than this one. */
function changesetMentioningTests(): string[] {
  return readdirSync(TESTS_DIR)
    .filter((name) => name.endsWith(".test.ts") && name !== SELF)
    .filter((name) => /\.changeset\b/.test(readFileSync(join(TESTS_DIR, name), "utf8")))
    .sort();
}

const PROBE_SCRIPT = `
import fs from "node:fs";
import { existsSync, readdirSync } from "node:fs";
const dir = process.argv[1];
const outcome = {};
for (const name of ["pending.md", "README.md", "config.json"]) {
  let read = "ok";
  try { fs.readFileSync(dir + "/" + name, "utf8"); } catch (error) { read = error.code; }
  outcome[name] = { exists: existsSync(dir + "/" + name), read };
}
outcome.listing = readdirSync(dir).sort();
outcome.direntListing = readdirSync(dir, { withFileTypes: true }).map((entry) => entry.name).sort();
console.log(JSON.stringify(outcome));
`;

function probe(hidden: string | undefined, directory: string): Record<string, unknown> {
  const env = { ...inheritedEnv(["NODE_OPTIONS"]), ...(hidden === undefined ? {} : { IRIS_HIDE_CHANGESETS_DIR: hidden }) };
  const result = spawnSync(process.execPath, ["--import", pathToFileURL(PRELOAD).href, "--input-type=module", "-e", PROBE_SCRIPT, directory], {
    encoding: "utf8",
    env,
    timeout: 30_000,
  });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

describe("the preload that makes pending changesets look consumed (control)", () => {
  const synthetic = (): string => {
    const dir = tempDir("qa-42-1-changesets-");
    writeFileSync(join(dir, "pending.md"), "---\n---\n");
    writeFileSync(join(dir, "README.md"), "# Changesets\n");
    writeFileSync(join(dir, "config.json"), "{}\n");
    return dir;
  };

  it("hides each pending .md from existsSync, the readers and both directory listings, and nothing else", () => {
    const dir = synthetic();
    expect(probe(dir, dir)).toEqual({
      "pending.md": { exists: false, read: "ENOENT" },
      "README.md": { exists: true, read: "ok" },
      "config.json": { exists: true, read: "ok" },
      listing: ["README.md", "config.json"],
      direntListing: ["README.md", "config.json"],
    });
  });

  it("changes nothing when the directory variable is unset, so the hiding is the preload's doing", () => {
    const dir = synthetic();
    expect(probe(undefined, dir)).toEqual({
      "pending.md": { exists: true, read: "ok" },
      "README.md": { exists: true, read: "ok" },
      "config.json": { exists: true, read: "ok" },
      listing: ["README.md", "config.json", "pending.md"],
      direntListing: ["README.md", "config.json", "pending.md"],
    });
  });

  it("leaves a different directory alone", () => {
    const hidden = synthetic();
    const other = synthetic();
    expect(probe(hidden, other)).toMatchObject({ "pending.md": { exists: true, read: "ok" } });
  });
});

describe("the hiding reaches the repository's own pending changesets", () => {
  const pending = existsSync(join(REPO_ROOT, ".changeset"))
    ? readdirSync(join(REPO_ROOT, ".changeset")).filter((name) => name.endsWith(".md") && name !== "README.md")
    : [];

  // With the child's directory variable set exactly as the run below sets it, every real pending changeset is gone from the
  // child's `node:fs`; the run is only as strong as this. After the release there is nothing to hide and the test skips.
  it.skipIf(pending.length === 0)("the child run's own directory string hides each real pending changeset, and not config.json", () => {
    const script = 'import { existsSync } from "node:fs"; console.log(JSON.stringify(process.argv.slice(1).map((file) => existsSync(file))));';
    const files = [...pending.map((name) => join(REPO_ROOT, ".changeset", name)), join(REPO_ROOT, ".changeset", "config.json")];
    const result = spawnSync(process.execPath, ["--import", pathToFileURL(PRELOAD).href, "--input-type=module", "-e", script, ...files], {
      encoding: "utf8",
      env: { ...inheritedEnv(["NODE_OPTIONS"]), IRIS_HIDE_CHANGESETS_DIR: join(REPO_ROOT, ".changeset") },
      timeout: 30_000,
    });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([...pending.map(() => false), true]);
  });
});

describe("after the release: every test that mentions .changeset passes with the pending changesets consumed (I/O matrix: After release)", () => {
  it("covers the nine readers Story 42.1 guarded and every other test file that mentions .changeset", () => {
    const files = changesetMentioningTests();
    for (const reader of KNOWN_READERS) expect(files, reader).toContain(reader);
    expect(files).toContain("release-1-0-0-mechanism.test.ts");
  });

  it("runs them all in a child vitest process with the real .changeset hidden: no ENOENT, no failure", async () => {
    const files = changesetMentioningTests();
    const closedPort = await reserveClosedPort();
    const out = tempDir("qa-42-1-after-release-");
    const report = join(out, "report.json");
    const child = spawnSync(
      process.execPath,
      [VITEST_ENTRY, "run", "--pool=forks", "--reporter=json", `--outputFile=${report}`, ...files.map((name) => `src/__tests__/${name}`)],
      {
        cwd: PACKAGE_DIR,
        encoding: "utf8",
        timeout: 240_000,
        env: {
          ...inheritedEnv(["VITEST", "VITEST_WORKER_ID", "VITEST_POOL_ID", "VITEST_MODE", "TEST", "NODE_ENV", "NODE_OPTIONS"]),
          IRIS_HOST: "127.0.0.1",
          IRIS_PORT: closedPort,
          IRIS_HIDE_CHANGESETS_DIR: join(REPO_ROOT, ".changeset"),
          NODE_OPTIONS: `--import=${pathToFileURL(PRELOAD).href}`,
        },
      },
    );
    const log = `${child.stdout ?? ""}\n${child.stderr ?? ""}`;
    const summary = JSON.parse(readFileSync(report, "utf8")) as {
      numFailedTestSuites: number;
      numFailedTests: number;
      numTotalTestSuites: number;
      testResults: Array<{ name: string; status: string; message?: string }>;
    };
    const failed = summary.testResults.filter((result) => result.status !== "passed").map((result) => `${basename(result.name)}: ${result.message ?? result.status}`);
    expect(failed, log).toEqual([]);
    expect(summary.testResults.map((result) => basename(result.name)).sort()).toEqual(files);
    expect(summary.numFailedTests).toBe(0);
    expect(summary.numFailedTestSuites).toBe(0);
    expect(log).not.toContain("ENOENT");
    expect(child.status, log).toBe(0);
  }, 300_000);
});
