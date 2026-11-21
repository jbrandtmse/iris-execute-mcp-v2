/**
 * Stories 39.1 to 39.5, 39.7, 40.0 and the Epic 39 capstone -- the arming guard of the live message-forensics
 * gates listed in `GATES` (`story-39-1-message-search-live-gate.test.ts`,
 * `story-39-2-data-policy-live-gate.test.ts`,
 * `story-39-3-body-search-live-gate.test.ts`, `story-39-3-qa-live-gate.test.ts`,
 * `story-39-4-search-table-live-gate.test.ts`, `story-39-4-qa-live-gate.test.ts`,
 * `story-39-5-body-reader-live-gate.test.ts`, `story-39-5-qa-live-gate.test.ts`,
 * `epic39-capstone-gate.test.ts`, `story-39-7-burn-down-live-gate.test.ts` and
 * `story-40-0-burn-down-live-gate.test.ts`, `story-40-0-qa-live-gate.test.ts`, the Story 40.1 and 40.2 coverage gates and
 * `story-40-3-testproduction-live-gate.test.ts`, `story-40-3-qa-live-gate.test.ts` and `epic40-capstone-gate.test.ts`) on their own real path (project
 * rule #59). A gate that drives a
 * further dist beyond the dev, admin and interop ones names it in `extraDriven`: the guard then expects that
 * dist's freshness line after the three, in the skip reason and in the source order, and it checks `extraDriven`
 * against the dists the gate's source spawns (`wireOptions("<pkg>")`, `distEntry(REPO_ROOT, "<pkg>")`), so a gate
 * cannot drive a dist the list leaves out. No IRIS and no shared state.
 *
 * Each gate runs in the default suite and in the prepublish gate. Run with a full `IRIS_*` target at a closed
 * local port, under the connection-refusing preload, it must skip every test with the opt-in reason and log no
 * connect when `IRIS_REQUIRE_LIVE` is not set; fail in `beforeAll` with "may not be skipped" when
 * `IRIS_REQUIRE_LIVE` is set; and, with `IRIS_REQUIRE_LIVE` set and a target variable unset, fail naming the
 * unset variables and log no connect. Otherwise a publish on an unreachable or stale environment would pass
 * with every row skipped, and a plain `pnpm test` would reach an instance. Each case runs the gate file in its
 * own vitest process, so the real `beforeAll` branches execute. A source-order check pins that the gate takes
 * the arming first, then derives its skip reason from the freshness of every dist it drives, before its
 * reachability probe and its first built-server session, and checks the deployed `BOOTSTRAP_VERSION` before
 * any test. A completeness check pins that every gate of this directory carrying the 39.x dist-freshness line
 * is listed in `GATES`, so a gate cannot drop out of this guard unnoticed.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runLiveGateFile } from "./live-gate-child-run.js";
import { reserveClosedPort, resolveSdkEsmDir, staleDistReason } from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = path.resolve(__dirname, "..", "..");
const REPO_ROOT = path.resolve(PACKAGE_DIR, "..", "..");

const DRIVEN_PACKAGES = ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"];

/** A gate this guard covers: the tag its skip line carries, the story its failure names, and any driven dist beyond the three above. */
interface Gate {
  file: string;
  tag: string;
  story: string;
  /** Packages whose dist freshness the gate checks after the three, each on a line `skipReason ??= staleDistReason(REPO_ROOT, "<pkg>");`. */
  extraDriven?: readonly string[];
}

/** The gates this guard covers. */
const GATES: readonly Gate[] = [
  { file: "story-39-1-message-search-live-gate.test.ts", tag: "story-39-1-message-search-live-gate", story: "Story 39.1" },
  { file: "story-39-2-data-policy-live-gate.test.ts", tag: "story-39-2-data-policy-live-gate", story: "Story 39.2" },
  { file: "story-39-3-body-search-live-gate.test.ts", tag: "story-39-3-body-search-live-gate", story: "Story 39.3" },
  { file: "story-39-3-qa-live-gate.test.ts", tag: "story-39-3-qa-live-gate", story: "Story 39.3 QA" },
  { file: "story-39-4-search-table-live-gate.test.ts", tag: "story-39-4-search-table-live-gate", story: "Story 39.4" },
  { file: "story-39-4-qa-live-gate.test.ts", tag: "story-39-4-qa-live-gate", story: "Story 39.4 QA" },
  { file: "story-39-5-body-reader-live-gate.test.ts", tag: "story-39-5-body-reader-live-gate", story: "Story 39.5" },
  { file: "story-39-5-qa-live-gate.test.ts", tag: "story-39-5-qa-live-gate", story: "Story 39.5 QA" },
  { file: "epic39-capstone-gate.test.ts", tag: "epic39-capstone-gate", story: "Epic 39 capstone" },
  { file: "story-39-7-burn-down-live-gate.test.ts", tag: "story-39-7-burn-down-live-gate", story: "Story 39.7" },
  {
    file: "story-40-0-burn-down-live-gate.test.ts",
    tag: "story-40-0-burn-down-live-gate",
    story: "Story 40.0",
    extraDriven: ["iris-ops-mcp"],
  },
  {
    file: "story-40-0-qa-live-gate.test.ts",
    tag: "story-40-0-qa-live-gate",
    story: "Story 40.0 QA",
    extraDriven: ["iris-ops-mcp"],
  },
  { file: "story-40-1-coverage-live-gate.test.ts", tag: "story-40-1-coverage-live-gate", story: "Story 40.1" },
  { file: "story-40-1-qa-live-gate.test.ts", tag: "story-40-1-qa-live-gate", story: "Story 40.1 QA" },
  { file: "story-40-2-coverage-reports-live-gate.test.ts", tag: "story-40-2-coverage-reports-live-gate", story: "Story 40.2" },
  { file: "story-40-2-qa-live-gate.test.ts", tag: "story-40-2-qa-live-gate", story: "Story 40.2 QA" },
  { file: "story-40-3-testproduction-live-gate.test.ts", tag: "story-40-3-testproduction-live-gate", story: "Story 40.3" },
  { file: "story-40-3-qa-live-gate.test.ts", tag: "story-40-3-qa-live-gate", story: "Story 40.3 QA" },
  { file: "epic40-capstone-gate.test.ts", tag: "epic40-capstone-gate", story: "Epic 40 capstone" },
  { file: "story-40-4-qa-live-gate.test.ts", tag: "story-40-4-qa-live-gate", story: "Story 40.4 QA" },
  { file: "story-40-5-burn-down-live-gate.test.ts", tag: "story-40-5-burn-down-live-gate", story: "Story 40.5" },
  { file: "story-40-5-qa-live-gate.test.ts", tag: "story-40-5-qa-live-gate", story: "Story 40.5 QA" },
];

let closedPort = "";

/** The reason a gate's `beforeAll` derives here, in its order: a stale dist (the three, then the gate's extras), the SDK, the closed port. */
function expectedSkipReason(gate: Gate): string {
  let reason = staleDistReason(REPO_ROOT, "shared");
  for (const pkg of DRIVEN_PACKAGES) reason ??= staleDistReason(REPO_ROOT, pkg);
  for (const pkg of gate.extraDriven ?? []) reason ??= staleDistReason(REPO_ROOT, pkg);
  return (
    reason ??
    (resolveSdkEsmDir(REPO_ROOT) === undefined
      ? "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm"
      : `IRIS is not reachable at http://127.0.0.1:${closedPort}/api/atelier/`)
  );
}

beforeAll(async () => {
  closedPort = await reserveClosedPort();
});

afterAll(() => {
  closedPort = "";
});

describe.each(GATES)("$story: the live gate's arming guard, on its own real path (unarmed and armed prerequisites)", (gate) => {
  it("unarmed, with a full target at a closed port: every gate test is skipped with the opt-in reason, the run passes, and nothing connects", () => {
    const { status, output, connects } = runLiveGateFile(gate.file, "unarmed", closedPort);

    expect(output).toContain(`[SKIP] ${gate.tag}: opt-in live leg: set IRIS_REQUIRE_LIVE=1 and IRIS_HOST`);
    expect(output).toMatch(/Tests\s+\d+ skipped \(\d+\)/);
    expect(output).not.toContain("may not be skipped");
    expect(status, output).toBe(0);
    expect(connects, "the unarmed gate attempted no connect to the target or to a default instance").toEqual([]);
  }, 120000);

  it("armed, with IRIS not reachable: the gate fails in beforeAll with 'may not be skipped: <reason>'", () => {
    const { status, output, connects } = runLiveGateFile(gate.file, "armed", closedPort);

    expect(output).toContain(`${gate.story} live gate may not be skipped: ${expectedSkipReason(gate)}`);
    expect(status, "the armed run must not pass").not.toBe(0);
    if (expectedSkipReason(gate).startsWith("IRIS is not reachable")) {
      expect(
        connects.some((line) => line.endsWith(`:${closedPort}`)),
        "the preload observes the armed gate's reachability probe, so an empty log in the unarmed case is meaningful",
      ).toBe(true);
    }
  }, 120000);

  it("armed with only IRIS_HOST and IRIS_PORT: the gate fails naming the unset variables, and nothing connects", () => {
    const { status, output, connects } = runLiveGateFile(gate.file, "armedIncomplete", closedPort);

    expect(output).toContain("IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE are not set");
    expect(status, "the armed run must not pass").not.toBe(0);
    expect(connects, "the gate attempted no connect with an incomplete target").toEqual([]);
  }, 120000);
});

describe.each(GATES)("$story: the live gate refuses a stale dist and checks the deployed BOOTSTRAP_VERSION before any test", (gate) => {
  const source = readFileSync(path.join(__dirname, gate.file), "utf8");

  it("takes the arming first, then the shared dist and every driven dist, before its reachability probe and its first built-server session", () => {
    const shared = source.indexOf('skipReason = liveArmingSkipReason() ?? staleDistReason(REPO_ROOT, "shared");');
    const driven = source.indexOf('for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);');
    const probe = source.search(/await isIrisReachable\(/);
    const session = source.search(/dev = await openWireSession\(/);
    expect(shared, "the gate takes the arming reason first and checks the shared dist in the same statement").toBeGreaterThan(-1);
    expect(driven, "the gate checks the dev, admin and interop dists after the shared one").toBeGreaterThan(shared);
    let previous = driven;
    for (const pkg of gate.extraDriven ?? []) {
      const extra = source.indexOf(`skipReason ??= staleDistReason(REPO_ROOT, "${pkg}");`);
      expect(extra, `the gate checks the ${pkg} dist after the dev, admin and interop ones`).toBeGreaterThan(previous);
      previous = extra;
    }
    expect(probe, "the gate probes reachability only after the arming and every dist check").toBeGreaterThan(previous);
    expect(session, "the gate opens its first session after the probe").toBeGreaterThan(probe);
  });

  it("names in extraDriven exactly the dists it drives beyond the dev, admin and interop ones", () => {
    const spawned = new Set([...source.matchAll(/(?:wireOptions\(|distEntry\(REPO_ROOT, )"(iris-[a-z]+-mcp)"/g)].map((match) => match[1] as string));
    expect(spawned.size, "the scan finds the dists the gate spawns").toBeGreaterThan(0);
    const beyond = [...spawned].filter((pkg) => !DRIVEN_PACKAGES.includes(pkg)).sort();
    expect(beyond, "every further dist the gate spawns is in extraDriven, and nothing else is").toEqual([...(gate.extraDriven ?? [])].sort());
  });

  it("calls assertDeployedBootstrapVersion right after its first session opens, ahead of every describe", () => {
    expect(source).toMatch(/dev = await openWireSession\([^\n]*\);\n(?:[^\n]*\n)?\s*await assertDeployedBootstrapVersion\(REPO_ROOT, TARGET\);/);
    const check = source.indexOf("await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);");
    const firstSuite = source.search(/^describe(?:\.skipIf\([^)]*\))?\(/m);
    expect(firstSuite, "the gate has a describe").toBeGreaterThan(-1);
    expect(check).toBeLessThan(firstSuite);
  });
});

describe("GATES lists every gate of this directory that carries the 39.x dist-freshness line", () => {
  it("no such gate is missing from GATES, and every GATES file carries the line", () => {
    const freshness = 'for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);';
    const self = path.basename(fileURLToPath(import.meta.url));
    const carriers = readdirSync(__dirname)
      .filter((name) => name.endsWith(".test.ts") && name !== self)
      .filter((name) => readFileSync(path.join(__dirname, name), "utf8").includes(freshness))
      .sort();
    expect(carriers.length, "the scan finds the gates at all").toBeGreaterThan(5);
    expect(carriers).toEqual(GATES.map((gate) => gate.file).sort());
  });
});
