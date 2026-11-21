/**
 * Story 38.6 (AC-3, AC-6) -- the guards of the Epic 38 live gates themselves.
 *
 * A gate that is skipped, or that tests some other build than the shipped one, is a green badge over a dead
 * check (project rule #59). These properties are pinned here, with no IRIS and no shared state:
 *
 *  - This package's default suite runs its test files one at a time (`fileParallelism: false` in its vitest
 *    config), because its live gates bootstrap and write on one shared IRIS instance. A child run of two inert
 *    probe files under the package's own config observes whether the files ever execute at the same time.
 *  - The capstone (`epic38-capstone-gate.test.ts`), run with a full `IRIS_*` target at a closed local port under
 *    the connection-refusing preload: without `IRIS_REQUIRE_LIVE` it skips every test with the opt-in reason and
 *    the preload logs no connect; with `IRIS_REQUIRE_LIVE` it fails in `beforeAll` with "may not be skipped",
 *    each time with the reason its `beforeAll` derives on this machine (a stale shared or iris-dev-mcp dist
 *    first, then the SDK, then the closed port); with `IRIS_REQUIRE_LIVE` and a target variable unset it fails
 *    naming the unset variables and logs no connect. Each case runs the capstone file in its own vitest
 *    process, so the real `beforeAll` branches execute.
 *  - The capstone and the Story 38.4, 38.5 and 38.7 wire gates each check the arming first, then derive their
 *    skip reason from the freshness of the shared and the iris-dev-mcp dist, before their reachability probe
 *    and before their first built-server session opens, and each call `assertDeployedBootstrapVersion` right
 *    after that session has opened, before any test. The check itself is pinned by
 *    `bootstrap-version-check.test.ts`; the live passing path by the gates.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { availableParallelism, tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLiveGateFile } from "./live-gate-child-run.js";
import { inheritedEnv, reserveClosedPort, resolveSdkEsmDir, staleDistReason } from "./process-gate-helpers.js";
import { SERIAL_PROBE_DIR_VAR } from "./serial-probe.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");
const TESTS_DIR = __dirname;

const CAPSTONE_FILE = "epic38-capstone-gate.test.ts";
const GATES_WITH_VERSION_CHECK = [
  "epic38-capstone-gate.test.ts",
  "story-38-4-qa-doc-edit-wire-gate.test.ts",
  "story-38-5-qa-sql-wire-gate.test.ts",
  "story-38-7-qa-wire-gate.test.ts",
];

/** The vitest entry point this package's tests run under. */
const VITEST_ENTRY = path.join(
  path.dirname(createRequire(import.meta.url).resolve("vitest/package.json")),
  "vitest.mjs",
);

let closedPort = "";

/** The reason the capstone's `beforeAll` derives here, in its order: a stale dist, the SDK, the closed port. */
function expectedSkipReason(): string {
  return (
    staleDistReason(REPO_ROOT, "shared") ??
    staleDistReason(REPO_ROOT, "iris-dev-mcp") ??
    (resolveSdkEsmDir(REPO_ROOT) === undefined
      ? "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm"
      : `IRIS is not reachable at http://127.0.0.1:${closedPort}/api/atelier/`)
  );
}

const SERIAL_PROBES = ["src/__tests__/serial-probe-a.test.ts", "src/__tests__/serial-probe-b.test.ts"];

/**
 * Run the two serial-probe files in one child vitest process under this package's own config. The child runs
 * with two workers whatever the machine, so the only thing that can keep the files apart is the config's file
 * parallelism; `--no-file-parallelism` is never passed. Returns the probes' markers from a scratch directory.
 */
function runSerialProbes(): { status: number | null; output: string; markers: string[] } {
  const markerDir = mkdtempSync(path.join(tmpdir(), "mcp-serial-probe-"));
  try {
    const outcome = spawnSync(process.execPath, [VITEST_ENTRY, "run", "--minWorkers=1", "--maxWorkers=2", ...SERIAL_PROBES], {
      cwd: PACKAGE_DIR,
      env: {
        ...inheritedEnv(["VITEST", "VITEST_WORKER_ID", "VITEST_POOL_ID", "VITEST_MODE", "TEST", "NODE_ENV"]),
        IRIS_HOST: "127.0.0.1",
        IRIS_PORT: closedPort,
        [SERIAL_PROBE_DIR_VAR]: markerDir,
      },
      encoding: "utf8",
      timeout: 90000,
    });
    return {
      status: outcome.status,
      output: `${outcome.stdout ?? ""}\n${outcome.stderr ?? ""}`,
      markers: existsSync(markerDir) ? readdirSync(markerDir).sort() : [],
    };
  } finally {
    rmSync(markerDir, { recursive: true, force: true });
  }
}

beforeAll(async () => {
  closedPort = await reserveClosedPort();
});

afterAll(() => {
  closedPort = "";
});

describe("Story 38.6: the capstone's arming guard, on its own real path (I/O matrix: unarmed and armed prerequisites)", () => {
  it("unarmed, with a full target at a closed port: every capstone test is skipped with the opt-in reason, the run passes, and nothing connects", () => {
    const { status, output, connects } = runLiveGateFile(CAPSTONE_FILE, "unarmed", closedPort);

    expect(output).toContain("[SKIP] epic38-capstone-gate: opt-in live leg: set IRIS_REQUIRE_LIVE=1 and IRIS_HOST");
    expect(output).toMatch(/6 skipped/);
    expect(output).not.toContain("may not be skipped");
    expect(status, output).toBe(0);
    expect(connects, "the unarmed capstone attempted no connect to the target or to a default instance").toEqual([]);
  }, 120000);

  it("armed, with IRIS not reachable: the capstone fails in beforeAll with 'may not be skipped: <reason>'", () => {
    const { status, output, connects } = runLiveGateFile(CAPSTONE_FILE, "armed", closedPort);

    expect(output).toContain(`Epic 38 capstone gate may not be skipped: ${expectedSkipReason()}`);
    expect(status, "the armed run must not pass").not.toBe(0);
    if (expectedSkipReason().startsWith("IRIS is not reachable")) {
      expect(
        connects.some((line) => line.endsWith(`:${closedPort}`)),
        "the preload observes the armed capstone's reachability probe, so an empty log in the unarmed case is meaningful",
      ).toBe(true);
    }
  }, 120000);

  it("armed with only IRIS_HOST and IRIS_PORT: the capstone fails naming the unset variables, and nothing connects", () => {
    const { status, output, connects } = runLiveGateFile(CAPSTONE_FILE, "armedIncomplete", closedPort);

    expect(output).toContain("IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE are not set");
    expect(status, "the armed run must not pass").not.toBe(0);
    expect(connects, "the capstone attempted no connect with an incomplete target").toEqual([]);
  }, 120000);
});

describe("Story 38.7: this package's default suite runs its test files one at a time (DW-562)", () => {
  it("two probe files of a child run under the package's own config never execute at the same time", (testCtx) => {
    if (availableParallelism() < 2) {
      console.error("[SKIP] epic38-gate-guards: the serial-suite guard needs two CPUs to be able to observe an overlap.");
      return testCtx.skip();
    }

    const { status, output, markers } = runSerialProbes();

    expect(status, output).toBe(0);
    expect(markers, "both probes ran armed and held their marker for the full time").toEqual(
      expect.arrayContaining(["a.held", "b.held"]),
    );
    expect(markers.filter((name) => name.endsWith(".overlap")), "two test files executed at the same time").toEqual([]);
  }, 120000);
});

describe("Story 38.6: every Epic 38 wire gate refuses a stale shared or iris-dev-mcp dist (I/O matrix: prerequisites)", () => {
  for (const file of GATES_WITH_VERSION_CHECK) {
    it(`${file} checks the arming first, then both dists' freshness, before its reachability probe and its first built-server session`, () => {
      const source = readFileSync(path.join(TESTS_DIR, file), "utf8");

      const shared = source.indexOf('const sharedStale = staleDistReason(REPO_ROOT, "shared");');
      const dev = source.search(
        /(?:skipReason|distSkipReason) = liveArmingSkipReason\(\) \?\? sharedStale \?\? staleDistReason\(REPO_ROOT, "iris-dev-mcp"\);/,
      );
      const probe = source.search(/await isIrisReachable\(/);
      const session = source.search(/admin = await open\w*Session\(/);
      expect(shared, `${file} checks the shared dist`).toBeGreaterThan(-1);
      expect(dev, `${file} takes the arming reason first, then the shared and iris-dev-mcp dist checks`).toBeGreaterThan(shared);
      expect(probe, `${file} probes reachability only after the arming and dist checks`).toBeGreaterThan(dev);
      expect(session, `${file} opens its first session after every check`).toBeGreaterThan(probe);
    });
  }
});

describe("Story 38.6: every Epic 38 wire gate checks the deployed BOOTSTRAP_VERSION before any test (AC-6)", () => {
  for (const file of GATES_WITH_VERSION_CHECK) {
    it(`${file} calls assertDeployedBootstrapVersion right after its admin session opens, ahead of every describe`, () => {
      const source = readFileSync(path.join(TESTS_DIR, file), "utf8");

      expect(source).toMatch(/admin = await open\w*Session\([^\n]*\);\n\s*await assertDeployedBootstrapVersion\(REPO_ROOT, TARGET\);/);
      const check = source.indexOf("await assertDeployedBootstrapVersion(");
      const firstSuite = source.search(/^describe\(/m);
      expect(firstSuite, `${file} has a describe`).toBeGreaterThan(-1);
      expect(check).toBeLessThan(firstSuite);
    });
  }
});
