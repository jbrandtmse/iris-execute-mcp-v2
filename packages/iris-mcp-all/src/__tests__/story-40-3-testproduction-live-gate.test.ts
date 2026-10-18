/**
 * Story 40.3 live gate: the TestProduction guard of `iris_execute_tests` and `iris_test_coverage`, driven on the REAL wire against
 * disposable namespaces, in the default suite (rule #59: each row names the path it guards).
 *
 * Path: the BUILT iris-dev-mcp, iris-admin-mcp and iris-interop-mcp dists, spawned as child processes and driven by the MCP SDK
 * `Client` over stdio -> `iris_execute_tests` / `iris_test_coverage` -> `GET /dev/test/production` and the coverage `Start` of the
 * ExecuteMCPv2 service -> `Ens.Director` under Ens's own lifecycle lock -> the Atelier work queue or the coverage runner, which run
 * `%UnitTest.TestProduction` tests (the `Story403` classes) in `EXECMCPTMP403A`. The oracles are the values captured live (Rule #36,
 * IRIS 2026.2 build 221U), the production status and the `%UnitTest_Result` row count read by raw HTTP, the processes and the
 * `^%SYS("Ensemble",*)` nodes read through the fixture class, and the monitor read through the fixture class; never the tools under test.
 * Rows 1 to 15 of the matrix run, each self-contained, and every row that starts a production ends with it Stopped.
 *
 *  - Rows 1 and 2: the pass and fail fixtures report their live result and leave the namespace Stopped with no production process.
 *  - Rows 3 to 5, 7, 14, 14b and 14c: another production runs, so a class, method or package run of a TestProduction test, a
 *    misconfigured one, an uncompiled one, a compiled one whose definition changed afterwards and an uncompiled one that inherits
 *    its production from a base are refused with PRODUCTION_BUSY; nothing ran and the other production is left exactly as it was.
 *  - Row 6: runs with no TestProduction test are unchanged by the other production.
 *  - Rows 8 and 9: the test's own leftover is run over; another test's leftover is refused.
 *  - Rows 10 and 11: `iris_test_coverage` reads the same decision (refused with no run allocated and the monitor idle; completed when
 *    nothing else runs).
 *  - Row 12: the raw route. Row 13: Ens's lifecycle lock held elsewhere, so the state is unreadable and the run is refused. Row 13b:
 *    the fixture methods that touch the instance refuse a name that is not a scratch namespace.
 *  - Row 15: the bare namespace B, where interoperability is not configured; row 15b: a TestProduction test there cannot have its
 *    state read, so it is refused and the lifecycle lock is released.
 *
 * This gate (its row 11), the Story 40.1 gates and the Story 40.2 gates are the only ones that start Line-by-Line sessions (the package runs its
 * files serially, `fileParallelism: false`): row 11 starts one. It starts every row with the monitor idle: when a session it did not
 * start is active, an armed gate fails and names it, an unarmed one skips, and the session is left alone. Every production it starts
 * runs only in `EXECMCPTMP403A`, and it stops each one it started.
 *
 * Fixtures: the disposable namespaces `EXECMCPTMP403A` (the `Story403` classes, and the one node
 * `^%SYS("Ensemble","InstalledNamespace","EXECMCPTMP403A")` that lets it compile TestProduction tests) and the bare `EXECMCPTMP403B`, their
 * database files, and the HSCUSTOM class `ExecuteMCPv2.Temp.Story391Fixture`, all removed in `afterAll`, which also asserts that nothing is
 * left (the node included) and that the monitor is idle.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773, `_SYSTEM`, HSCUSTOM). A
 * missing or stale dist, an unresolvable SDK or an unreachable IRIS skips each row with the reason, or fails with "may not be
 * skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allText,
  assertDeployedBootstrapVersion,
  atelierQuery,
  distEntry,
  docFixtures,
  fixtureDocumentNames,
  irisTargetFromEnv,
  isIrisReachable,
  openWireSession,
  rawIrisRequest,
  resolveSdkEsmDir,
  skipTest,
  staleDistReason,
  teardownRecorder,
  type WireSession,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  FIXTURE_CLASS,
  FIXTURE_DOC,
  createInteropNamespace,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
} from "./interop-namespace-fixture.js";
import {
  STORY403_BASE_SOURCE,
  STORY403_FRESH_SOURCE,
  STORY403_INHERIT_SOURCE,
  STORY403_OTHER,
  STORY403_PRODUCTION,
  STORY403_ROW_DOCUMENTS,
  STORY403_STALE_COMPILED_SOURCE,
  STORY403_STALE_EDITED_SOURCE,
  createTestProductionNamespace,
  holdEnsRuntime,
  releaseEnsRuntime,
  removeTestProductionNamespace,
  seedPlainFixture,
} from "./testproduction-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-3-testproduction-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The interop-mapped scratch namespace with the InstalledNamespace node, and the bare one. */
const NS_A = "EXECMCPTMP403A";
const NS_B = "EXECMCPTMP403B";
const NAMESPACES = [NS_A, NS_B];

/** The operator enables the coverage tool; the other tools are enabled by default. */
const ENABLED_GOVERNANCE = JSON.stringify({ global: { iris_test_coverage: true } });

/** The guard route and the production status route, below the web port. */
const GUARD_ROUTE = "/api/executemcp/v2/dev/test/production";
const STATUS_ROUTE = "/api/executemcp/v2/interop/production/status";

/** The routine of the session a coverage row may leave behind, for the safety net. */
const SUITE_ROUTINE_SETS = ["Story403.PassTest.1"];

/** The InstalledNamespace node of A, which the leftovers check lists and the processes check ignores. */
const INSTALLED_NODE = `^%SYS("Ensemble","InstalledNamespace","${NS_A}")`;

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
let interop: WireSession;
let ensHeld = false;

function wireOptions(pkg: string): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: distEntry(REPO_ROOT, pkg), target: TARGET, clientName: "story-40-3-live-gate" };
}

/** The target of the raw Atelier oracle for a scratch namespace. */
const oracleTarget = (namespace: string): typeof TARGET => ({ ...TARGET, namespace });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface MonitorStateJson {
  active: number;
  count: number;
  pids: string;
  routines: string[];
}

interface ProductionStatusJson {
  name: string;
  state: string;
  stateCode: number;
  startTime?: string;
}

interface TestDetail {
  class: string;
  method: string;
  status: string;
  duration?: number;
  message?: string;
}

interface RunContent {
  status: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  details: TestDetail[];
  coverage?: { complete: boolean };
}

interface GuardRoute {
  decision: string;
  namespace: string;
  testProductions: Array<{ class: string; production: string }>;
  production?: string;
  state?: string;
  stateCode?: number;
  error?: string;
}

/** A class method of the fixture class, which lives in HSCUSTOM, and its string result. */
async function fixtureCall(methodName: string, args: unknown[] = []): Promise<string> {
  const result = await dev.call("iris_execute_classmethod", { namespace: "HSCUSTOM", className: FIXTURE_CLASS, methodName, args });
  expect(result.isError, allText(result)).toBeFalsy();
  return String(result.structuredContent?.["returnValue"] ?? "");
}

async function monitorState(): Promise<MonitorStateJson> {
  return JSON.parse(await fixtureCall("MonitorState")) as MonitorStateJson;
}

/** A node of the coverage service's IRISTEMP global, as `{value, defined}`. */
async function coverageGlobal(subscripts: string): Promise<{ value: unknown; defined: boolean }> {
  const result = await dev.call("iris_global_get", { namespace: "HSCUSTOM", global: "IRIS.TempExecuteMCPv2Coverage", subscripts });
  expect(result.isError, allText(result)).toBeFalsy();
  const content = result.structuredContent as { value?: unknown; defined?: boolean } | undefined;
  return { value: content?.value, defined: content?.defined === true };
}

/** The last run id the coverage service allocated, read from its IRISTEMP counter. */
async function runCounter(): Promise<number> {
  return Number((await coverageGlobal('"seq"')).value ?? 0);
}

/** The monitor is idle and no coverage ownership node is left. */
async function expectMonitorIdle(row: string): Promise<void> {
  const state = await monitorState();
  expect(state.active, `${row}: the monitor is idle (process list "${state.pids}")`).toBe(0);
  expect((await coverageGlobal('"session"')).defined, `${row}: no ownership node is left`).toBe(false);
}

/** Stop a coverage session a failed row left behind: the fixture stops it only when it is provably one of the candidate sets. */
async function releaseLeftoverSession(): Promise<void> {
  for (const routines of SUITE_ROUTINE_SETS) {
    if ((await monitorState()).active === 0) return;
    await fixtureCall("StopIfList", [routines]);
  }
}

/** The production status of namespace `namespace`, by the raw status route: the oracle for "Stopped" and "untouched". */
async function productionStatus(namespace: string = NS_A): Promise<ProductionStatusJson> {
  const answer = await rawIrisRequest(TARGET, `${STATUS_ROUTE}?namespace=${namespace}`, { method: "GET" });
  expect(answer.status, answer.text).toBe(200);
  return (answer.json as { result: ProductionStatusJson }).result;
}

/**
 * The Atelier work queue workers that sit in A. A worker that ran a test stays in A for about a second after the job ends, so it is
 * the test runner and not a production process; it is left out of the production processes below.
 */
async function workerPidsOfA(): Promise<Set<string>> {
  const rows = await atelierQuery(TARGET, `SELECT Pid FROM %SYS.ProcessQuery WHERE NameSpace = '${NS_A}' AND Routine = '%SYS.WorkQueueMgr'`);
  return new Set(rows.map((row) => String(row["Pid"])));
}

/** The production processes the leftovers check lists for A: every process in A that is not a work queue worker. */
async function processesOfA(): Promise<string[]> {
  const workers = await workerPidsOfA();
  return (await leftovers(dev, [NS_A]))
    .filter((entry) => entry.startsWith("process ") && !workers.has(entry.split(" ")[1] ?? ""))
    .sort();
}

/** What "untouched" compares: the production's name, state and start time, and its processes. */
interface Snapshot {
  name: string;
  state: string;
  startTime: string | undefined;
  processes: string[];
}

async function snapshot(): Promise<Snapshot> {
  const status = await productionStatus();
  return { name: status.name, state: status.state, startTime: status.startTime, processes: await processesOfA() };
}

/**
 * The snapshot of a production once it has settled: a production reports Running while its jobs are still starting, so the
 * snapshot a refusal is compared with is taken when two reads one second apart agree.
 */
async function settledSnapshot(): Promise<Snapshot> {
  let previous = await snapshot();
  for (let attempt = 0; attempt < 30; attempt++) {
    await sleep(1000);
    const current = await snapshot();
    if (JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
  }
  return previous;
}

/** The `%UnitTest_Result.TestInstance` row count of A, read by the raw Atelier query: "nothing ran" is an unchanged count. */
async function testInstanceCount(): Promise<number> {
  const rows = await atelierQuery(oracleTarget(NS_A), "SELECT COUNT(*) AS N FROM %UnitTest_Result.TestInstance");
  return Number(rows[0]?.["N"] ?? Number.NaN);
}

/** Wait until A's production reaches `state` (the start and stop calls return before the jobs have settled). */
async function waitForState(state: string, seconds = 30): Promise<ProductionStatusJson> {
  let status = await productionStatus();
  for (let waited = 0; status.state !== state && waited < seconds; waited++) {
    await sleep(1000);
    status = await productionStatus();
  }
  return status;
}

/** Start `Story403.Other`, the foreign stand-in, and wait until it runs. */
async function startOther(): Promise<void> {
  const started = await interop.call("iris_production_control", { action: "start", name: STORY403_OTHER, namespace: NS_A });
  expect(started.isError, allText(started)).toBeFalsy();
  const status = await waitForState("Running");
  expect(status, "Story403.Other runs").toMatchObject({ name: STORY403_OTHER, state: "Running" });
}

/** Stop whatever production A runs (gracefully, then forced), and wait until it is Stopped. Safe to call when nothing runs. */
async function stopAnyProduction(): Promise<void> {
  if ((await productionStatus()).state === "Stopped") return;
  await interop.call("iris_production_control", { action: "stop", namespace: NS_A });
  if ((await waitForState("Stopped", 20)).state === "Stopped") return;
  await interop.call("iris_production_control", { action: "stop", force: true, namespace: NS_A });
  expect((await waitForState("Stopped", 20)).state, "the production was stopped").toBe("Stopped");
}

/**
 * Production processes or Ensemble state of A that remain, other than the InstalledNamespace node. A process that was ending when it
 * was read (a coverage runner, a job of the production) is given up to 10 seconds to go; whatever is still there then is residue.
 */
async function residueOfA(): Promise<string[]> {
  let residue: string[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    const ensemble = (await leftovers(dev, [NS_A])).filter((entry) => entry.startsWith("^%SYS(") && entry !== INSTALLED_NODE);
    residue = [...(await processesOfA()), ...ensemble];
    if (residue.length === 0) return residue;
    await sleep(1000);
  }
  return residue;
}

/** Every leftover of the namespaces, with the processes that were ending when they were read given up to 10 seconds to go. */
async function settledLeftovers(): Promise<string[]> {
  let listed: string[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    listed = await leftovers(dev, NAMESPACES);
    if (listed.every((entry) => entry.startsWith("process "))) {
      if (listed.length === 0) return listed;
    } else {
      return listed;
    }
    await sleep(1000);
  }
  return listed;
}

/** `iris_execute_tests` over A. */
function executeTests(target: string, level: "package" | "class" | "method", namespace: string = NS_A): Promise<WireToolResult> {
  return dev.call("iris_execute_tests", { target, level, namespace });
}

/** `iris_test_coverage` over A for `Story403.PassTest`. */
function coverageOfPassTest(): Promise<WireToolResult> {
  return dev.call("iris_test_coverage", {
    target: "Story403.PassTest",
    level: "class",
    classes: ["Story403.PassTest"],
    namespace: NS_A,
  });
}

/** The structured content of a tool call that must not be an error. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

/** The fields of a PRODUCTION_BUSY refusal that names a production it read. */
function busyFields(production: string, state: string, tests: Array<{ class: string; production: string }>): Record<string, unknown> {
  return { code: "PRODUCTION_BUSY", namespace: NS_A, state, testProductions: tests, production };
}

/** A refusal must be `isError` with exactly the expected structured content and a text that names the production. */
function expectRefusal(result: WireToolResult, expected: Record<string, unknown>, production: string): void {
  expect(result.isError, allText(result)).toBe(true);
  expect(result.structuredContent).toEqual(expected);
  const text = allText(result);
  expect(text).toContain(`Production '${production}' is ${String(expected["state"])} in namespace ${NS_A}`);
  expect(text).toContain(`'${production}' was left untouched`);
  expect(text).toContain("iris_production_control");
}

/** A completed result with run-specific values removed, for comparing two runs of the same tests. */
function withoutRunValues(content: unknown): unknown {
  return JSON.parse(JSON.stringify(content), (key, value) =>
    key === "jobId" || key === "runIndex" || key === "runIndexSource" || key === "runIndexNote" || key === "duration" ? undefined : value,
  );
}

/** The raw guard route for a target, with its time. */
async function rawGuard(target: string, level: string, namespace: string): Promise<{ status: number; result: GuardRoute; ms: number; text: string }> {
  const started = performance.now();
  const answer = await rawIrisRequest(
    TARGET,
    `${GUARD_ROUTE}?target=${encodeURIComponent(target)}&level=${level}&namespace=${namespace}`,
    { method: "GET" },
  );
  const ms = performance.now() - started;
  return { status: answer.status, result: (answer.json as { result: GuardRoute }).result, ms, text: answer.text };
}

// -- Setup and teardown ------------------------------------------------

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared");
  for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    } else if (!(await isIrisReachable(TARGET.host, TARGET.port))) {
      skipReason = `IRIS is not reachable at http://${TARGET.host}:${TARGET.port}/api/atelier/ (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.3 live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  const openedAt = Date.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_GOVERNANCE: ENABLED_GOVERNANCE });
  const bootstrapSeconds = (Date.now() - openedAt) / 1000;
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  // eslint-disable-next-line no-console
  console.log(`[INFO] ${GATE_TAG}: the dev server opened (startup bootstrap included) in ${bootstrapSeconds.toFixed(1)} s`);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  interop = await openWireSession(wireOptions("iris-interop-mcp"));
  await putFixtureClass(dev);

  // Every row starts with the monitor idle. A session this gate did not start is named and left alone.
  const initial = await monitorState();
  if (initial.active !== 0) {
    const named = `a Line-by-Line or PERFMON session this gate did not start is active (process list "${initial.pids}", ${initial.count} routine(s): ${JSON.stringify(initial.routines)}); it was left untouched`;
    for (const session of [admin, interop]) await session.close();
    await removeFixtureClass(dev);
    await dev.close();
    if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.3 live gate may not be skipped: ${named}`);
    skipReason = named;
    return;
  }

  await removeTestProductionNamespace(admin, interop, dev, NS_A);
  await removeInteropNamespace(admin, dev, NS_B);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);
  await createTestProductionNamespace(admin, dev, NS_A);
  await createInteropNamespace(admin, dev, NS_B, { interop: false });
  await seedPlainFixture(dev, NS_B);

  // A positive control: the same check that must read empty after the run sees both namespaces and the node now.
  const present = await leftovers(dev, NAMESPACES);
  expect(present, "the leftovers check sees the namespaces and the InstalledNamespace node while they exist").toEqual(
    expect.arrayContaining([`namespace ${NS_A}`, `namespace ${NS_B}`, INSTALLED_NODE]),
  );
  expect((await productionStatus()).state, "A starts Stopped").toBe("Stopped");
}, 600000);

afterEach(async () => {
  if (skipReason) return;
  // A row that fails must not leave a lock holder, a coverage session or a production behind for the rows after it.
  if (ensHeld) {
    await releaseEnsRuntime(dev, NS_A);
    ensHeld = false;
  }
  await releaseLeftoverSession();
  await stopAnyProduction();
  for (const doc of STORY403_ROW_DOCUMENTS) await docFixtures(dev, NS_A).removeDoc(doc);
  await docFixtures(dev, NS_B).removeDoc("Story403.FreshTest.cls");
}, 120000);

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const { problems, attempt } = teardownRecorder();
  try {
    await attempt("letting go of the Ens lock", async () => {
      if (ensHeld) await releaseEnsRuntime(dev, NS_A);
      ensHeld = false;
    });
    await attempt("stopping a coverage session left behind", releaseLeftoverSession);
    await attempt("stopping a production left behind", stopAnyProduction);
    await attempt("the monitor is idle", async () => {
      expect((await monitorState()).active, "the monitor is idle after the run").toBe(0);
    });
    await attempt("no coverage ownership node is left", async () => {
      expect((await coverageGlobal('"session"')).defined, "no suite session node after the run").toBe(false);
    });
    await attempt(`removing ${NS_A}`, () => removeTestProductionNamespace(admin, interop, dev, NS_A));
    await attempt(`removing ${NS_B}`, () => removeInteropNamespace(admin, dev, NS_B));
    await attempt("the leftovers check", async () => {
      expect(await settledLeftovers(), "no fixture namespace, database, mapping, process or InstalledNamespace node after the run").toEqual([]);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story403", "Story391Fixture"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [admin, interop, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 600000);

// -- Rows 1 and 2: the pass and fail fixtures -------------------------------------------

describe("Story 40.3: TestProduction runs with no other production (AC-1, matrix rows 1 and 2)", () => {
  it("row 1: the pass fixture completes with one passed TestControl, and A is Stopped with no production process left", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    expect((await productionStatus()).state).toBe("Stopped");
    const content = succeeded<RunContent>(await executeTests("Story403.PassTest", "class"));
    expect(content).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0, skipped: 0 });
    expect(content.details).toHaveLength(1);
    expect(content.details[0]).toMatchObject({ class: "Story403.PassTest", method: "TestControl", status: "passed" });
    expect((await productionStatus()).state, "the production is Stopped afterwards").toBe("Stopped");
    expect(await residueOfA(), "no production process and no Ensemble state remains for A").toEqual([]);
  }, 180000);

  it("row 2: the fail fixture completes with one failed TestControl whose message is the failing assertion, and A is Stopped", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded<RunContent>(await executeTests("Story403.FailTest", "class"));
    expect(content).toMatchObject({ status: "completed", total: 1, passed: 0, failed: 1 });
    expect(content.details[0]).toMatchObject({ class: "Story403.FailTest", method: "TestControl", status: "failed", message: "AssertTrue: fail fixture" });
    expect((await productionStatus()).state).toBe("Stopped");
    expect(await residueOfA()).toEqual([]);
  }, 180000);
});

// -- Rows 3 to 5, 7 and 14: another production runs -----------------------------------------

/** Run `call` while Story403.Other runs; the refusal must change nothing about it. Other is stopped afterwards. */
async function refusedWhileOtherRuns(
  call: () => Promise<WireToolResult>,
  expected: Record<string, unknown>,
  production = STORY403_OTHER,
): Promise<void> {
  await startOther();
  const before = await settledSnapshot();
  const instances = await testInstanceCount();
  const result = await call();
  expectRefusal(result, expected, production);
  expect(await testInstanceCount(), "nothing ran: the %UnitTest_Result.TestInstance row count is unchanged").toBe(instances);
  expect(await snapshot(), `${production} is untouched: the same name, state, start time and processes`).toEqual(before);
  expect(before).toMatchObject({ name: production, state: "Running" });
  await stopAnyProduction();
}

const PASS_TEST = [{ class: "Story403.PassTest", production: STORY403_PRODUCTION }];

describe("Story 40.3: a different production runs, so the run is refused and that production is left alone (AC-2, matrix rows 3 to 5, 7, 14)", () => {
  it("row 3: a class-level run of a TestProduction test is PRODUCTION_BUSY, naming Story403.Other", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await refusedWhileOtherRuns(() => executeTests("Story403.PassTest", "class"), busyFields(STORY403_OTHER, "Running", PASS_TEST));
  }, 180000);

  it("row 4: a method-level run is refused the same way", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await refusedWhileOtherRuns(() => executeTests("Story403.PassTest:TestControl", "method"), busyFields(STORY403_OTHER, "Running", PASS_TEST));
  }, 180000);

  it("row 5: a package-level run is refused, and its testProductions are only the package's TestProduction test", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await refusedWhileOtherRuns(
      () => executeTests("Story403.Mixed", "package"),
      busyFields(STORY403_OTHER, "Running", [{ class: "Story403.Mixed.ProdTest", production: STORY403_PRODUCTION }]),
    );
  }, 180000);

  it("row 7: a misconfigured TestProduction test (its PRODUCTION names no class) is refused, because it stops the namespace's production anyway", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await refusedWhileOtherRuns(
      () => executeTests("Story403.BadTest", "class"),
      busyFields(STORY403_OTHER, "Running", [{ class: "Story403.BadTest", production: "Story403.Missing" }]),
    );
  }, 180000);

  it("row 14: a TestProduction class that was put but not compiled is refused (the work queue would compile and run it)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await docFixtures(dev, NS_A).putDoc("Story403.FreshTest.cls", STORY403_FRESH_SOURCE);
    const compiled = await atelierQuery(oracleTarget(NS_A), "SELECT COUNT(*) AS N FROM %Dictionary.CompiledClass WHERE Name = 'Story403.FreshTest'");
    expect(Number(compiled[0]?.["N"]), "FreshTest is defined but not compiled").toBe(0);
    await refusedWhileOtherRuns(
      () => executeTests("Story403.FreshTest", "class"),
      busyFields(STORY403_OTHER, "Running", [{ class: "Story403.FreshTest", production: STORY403_PRODUCTION }]),
    );
    const stillUncompiled = await atelierQuery(oracleTarget(NS_A), "SELECT COUNT(*) AS N FROM %Dictionary.CompiledClass WHERE Name = 'Story403.FreshTest'");
    expect(Number(stillUncompiled[0]?.["N"]), "the refused run compiled nothing").toBe(0);
  }, 180000);

  it("row 14b: a compiled test whose definition was saved afterwards without a compile is judged by its definition, so the production the work queue will start is the one named", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const docs = docFixtures(dev, NS_A);
    // Compiled as a test of Story403.Other, then saved as a test of Story403.Production: the compiled class would say "Other is its own".
    await docs.putDoc("Story403.StaleTest.cls", STORY403_STALE_COMPILED_SOURCE);
    await docs.compileDoc("Story403.StaleTest.cls");
    // A plain overwrite, not docs.putDoc (which deletes the document, and its compiled class, first).
    const edited = await dev.call("iris_doc_put", { name: "Story403.StaleTest.cls", content: STORY403_STALE_EDITED_SOURCE, namespace: NS_A });
    expect(edited.isError, allText(edited)).toBeFalsy();
    const compiled = await atelierQuery(oracleTarget(NS_A), "SELECT COUNT(*) AS N FROM %Dictionary.CompiledClass WHERE Name = 'Story403.StaleTest'");
    expect(Number(compiled[0]?.["N"]), "StaleTest is compiled (with its earlier definition)").toBe(1);
    await refusedWhileOtherRuns(
      () => executeTests("Story403.StaleTest", "class"),
      busyFields(STORY403_OTHER, "Running", [{ class: "Story403.StaleTest", production: STORY403_PRODUCTION }]),
    );
  }, 180000);

  it("row 14c: an uncompiled test that only extends a compiled TestProduction base inherits the base's production and is refused with it", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const docs = docFixtures(dev, NS_A);
    await docs.putDoc("Story403.BaseTest.cls", STORY403_BASE_SOURCE);
    await docs.compileDoc("Story403.BaseTest.cls");
    await docs.putDoc("Story403.InheritTest.cls", STORY403_INHERIT_SOURCE);
    const compiled = await atelierQuery(oracleTarget(NS_A), "SELECT COUNT(*) AS N FROM %Dictionary.CompiledClass WHERE Name = 'Story403.InheritTest'");
    expect(Number(compiled[0]?.["N"]), "InheritTest is defined but not compiled").toBe(0);
    await refusedWhileOtherRuns(
      () => executeTests("Story403.InheritTest", "class"),
      busyFields(STORY403_OTHER, "Running", [{ class: "Story403.InheritTest", production: STORY403_PRODUCTION }]),
    );
  }, 180000);
});

// -- Row 6: runs with no TestProduction test are unchanged ---------------------------------

describe("Story 40.3: a run with no TestProduction test is unchanged (AD-15, AC-3, matrix row 6)", () => {
  it("row 6: PlainTest (class) and Plain (package) complete while Other runs, with the structured content of the same calls with no production, and Other is untouched", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    expect((await productionStatus()).state, "no production runs for the captures").toBe("Stopped");
    const classCapture = succeeded<RunContent>(await executeTests("Story403.PlainTest", "class"));
    const packageCapture = succeeded<RunContent>(await executeTests("Story403.Plain", "package"));
    expect(classCapture).toMatchObject({ status: "completed", total: 1, passed: 1 });
    expect(packageCapture).toMatchObject({ status: "completed", total: 1, passed: 1 });
    expect(packageCapture.details[0]).toMatchObject({ class: "Story403.Plain.OneTest", method: "TestPlain", status: "passed" });

    await startOther();
    const before = await settledSnapshot();
    const classAgain = succeeded<RunContent>(await executeTests("Story403.PlainTest", "class"));
    const packageAgain = succeeded<RunContent>(await executeTests("Story403.Plain", "package"));
    expect(withoutRunValues(classAgain), "the class run equals its no-production capture").toEqual(withoutRunValues(classCapture));
    expect(withoutRunValues(packageAgain), "the package run equals its no-production capture").toEqual(withoutRunValues(packageCapture));
    expect(await snapshot(), "Other is untouched").toEqual(before);
    expect(before).toMatchObject({ name: STORY403_OTHER, state: "Running" });
    await stopAnyProduction();
  }, 240000);
});

// -- Rows 8 and 9: leftovers --------------------------------------------------------------

describe("Story 40.3: a production a TestProduction run left behind (AC-4, matrix rows 8 and 9)", () => {
  it("row 8: the test's own leftover is run over: ErrorTest fails and leaves Story403.Production running, then PassTest passes and A is Stopped", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const failed = succeeded<RunContent>(await executeTests("Story403.ErrorTest", "class"));
    expect(failed).toMatchObject({ status: "completed", total: 1, passed: 0, failed: 1 });
    expect(failed.details[0]).toMatchObject({
      class: "Story403.ErrorTest",
      method: "TestControl",
      status: "failed",
      message: "ERROR #5002: ObjectScript error: <DIVIDE>CheckResults+1^Story403.ErrorTest.1",
    });
    expect(await productionStatus(), "ErrorTest left its production running").toMatchObject({ name: STORY403_PRODUCTION, state: "Running" });

    const passed = succeeded<RunContent>(await executeTests("Story403.PassTest", "class"));
    expect(passed).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });
    expect((await productionStatus()).state, "PassTest stopped its own production").toBe("Stopped");
    expect(await residueOfA()).toEqual([]);
  }, 240000);

  it("row 9: another test's leftover is refused: after ErrorTest leaves Story403.Production running, OtherTest (Story403.Other) is PRODUCTION_BUSY naming it, and it is untouched", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const failed = succeeded<RunContent>(await executeTests("Story403.ErrorTest", "class"));
    expect(failed.failed).toBe(1);
    const leftover = await productionStatus();
    expect(leftover).toMatchObject({ name: STORY403_PRODUCTION, state: "Running" });
    const before = await settledSnapshot();
    const instances = await testInstanceCount();

    const refused = await executeTests("Story403.OtherTest", "class");
    expectRefusal(
      refused,
      busyFields(STORY403_PRODUCTION, "Running", [{ class: "Story403.OtherTest", production: STORY403_OTHER }]),
      STORY403_PRODUCTION,
    );
    expect(await testInstanceCount(), "nothing ran").toBe(instances);
    expect(await snapshot(), "the leftover is untouched").toEqual(before);
    await stopAnyProduction();
  }, 240000);
});

// -- Rows 10 and 11: the coverage path ----------------------------------------------------------

describe("Story 40.3: iris_test_coverage reads the same decision (AC-5, matrix rows 10 and 11)", () => {
  it("row 10: with Other running, a coverage run of a TestProduction test is the same PRODUCTION_BUSY; no run id is allocated, the monitor is idle and Other is untouched", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await expectMonitorIdle("row 10, before");
    await startOther();
    const before = await settledSnapshot();
    const instances = await testInstanceCount();
    const counter = await coverageGlobal('"seq"');

    const result = await coverageOfPassTest();
    expectRefusal(result, busyFields(STORY403_OTHER, "Running", PASS_TEST), STORY403_OTHER);
    expect(await coverageGlobal('"seq"'), "no coverage run id was allocated").toEqual(counter);
    expect(await testInstanceCount(), "nothing ran").toBe(instances);
    await expectMonitorIdle("row 10, after");
    expect(await snapshot(), "Other is untouched").toEqual(before);

    // The same decision as iris_execute_tests: the two refusals are identical.
    const viaExecute = await executeTests("Story403.PassTest", "class");
    expect(viaExecute.structuredContent).toEqual(result.structuredContent);
    expect(allText(viaExecute)).toBe(allText(result));
    await stopAnyProduction();
  }, 240000);

  it("row 11: with no production running, the coverage run of the same test completes with its own production, coverage.complete true, A Stopped and the monitor idle", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await expectMonitorIdle("row 11, before");
    expect((await productionStatus()).state).toBe("Stopped");
    const content = succeeded<RunContent>(await coverageOfPassTest());
    expect(content).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });
    expect(content.coverage?.complete).toBe(true);
    expect((await productionStatus()).state, "the production is Stopped afterwards").toBe("Stopped");
    expect(await residueOfA()).toEqual([]);
    await expectMonitorIdle("row 11, after");
  }, 240000);
});

// -- Row 12: the raw route ----------------------------------------------------------------

describe("Story 40.3: the raw guard route (AD-33, AC-7, matrix row 12)", () => {
  it("row 12: a plain target is proceed with no TestProduction test and no state read; a TestProduction target reads the Stopped state; both within the 2 s read budget", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const plain = await rawGuard("Story403.PlainTest", "class", NS_A);
    expect(plain.status, plain.text).toBe(200);
    expect(plain.result).toEqual({ decision: "proceed", namespace: NS_A, testProductions: [] });
    expect(plain.result, "no state was read").not.toHaveProperty("stateCode");

    const prod = await rawGuard("Story403.PassTest", "class", NS_A);
    expect(prod.status, prod.text).toBe(200);
    expect(prod.result).toEqual({
      decision: "proceed",
      namespace: NS_A,
      testProductions: [{ class: "Story403.PassTest", production: STORY403_PRODUCTION }],
      production: "",
      state: "Stopped",
      stateCode: 2,
    });

    // Method level is guarded whatever the method, a package lists only its TestProduction tests, sorted by class.
    const method = await rawGuard("Story403.Plain.OneTest:TestPlain", "method", NS_A);
    expect(method.result.testProductions).toEqual([]);
    // Whatever the method: a method that does not exist on a TestProduction class still names that class (a subclass method can call StartProduction).
    const anyMethod = await rawGuard("Story403.PassTest:TestNoSuchMethod", "method", NS_A);
    expect(anyMethod.status, anyMethod.text).toBe(200);
    expect(anyMethod.result.testProductions).toEqual(PASS_TEST);
    const mixed = await rawGuard("Story403.Mixed", "package", NS_A);
    expect(mixed.result.testProductions).toEqual([{ class: "Story403.Mixed.ProdTest", production: STORY403_PRODUCTION }]);
    const whole = await rawGuard("Story403", "package", NS_A);
    expect(whole.result.testProductions.map((entry) => entry.class)).toEqual([
      "Story403.BadTest",
      "Story403.ErrorTest",
      "Story403.FailTest",
      "Story403.Mixed.ProdTest",
      "Story403.OtherTest",
      "Story403.PassTest",
    ]);

    // A namespace that cannot be switched to: nothing can run there, so the route says proceed with no tests (the run then fails as it does today).
    const absentNamespace = await rawGuard("Story403.PassTest", "class", "EXECMCPTMP403Z");
    expect(absentNamespace.status, absentNamespace.text).toBe(200);
    expect(absentNamespace.result).toEqual({ decision: "proceed", namespace: "EXECMCPTMP403Z", testProductions: [] });

    // Validation comes before any namespace switch, and each error is one envelope.
    for (const query of ["level=class&namespace=" + NS_A, "target=Story403.PassTest&level=bogus&namespace=" + NS_A, "target=Story403.PassTest&namespace=" + NS_A]) {
      const answer = await rawIrisRequest(TARGET, `${GUARD_ROUTE}?${query}`, { method: "GET" });
      const body = answer.json as { status?: { errors?: Array<{ error?: string }> } };
      expect(body.status?.errors?.length, `${query}: ${answer.text}`).toBeGreaterThan(0);
    }

    // The time a guard read takes, recorded here (Verification, once): a plain target, then a TestProduction target with Other running.
    await startOther();
    const busy = await rawGuard("Story403.PassTest", "class", NS_A);
    expect(busy.result).toEqual({
      decision: "busy",
      namespace: NS_A,
      testProductions: PASS_TEST,
      production: STORY403_OTHER,
      state: "Running",
      stateCode: 1,
    });
    // eslint-disable-next-line no-console
    console.log(`[perf] story-40-3: guard route ${plain.ms.toFixed(0)} ms (plain target), ${prod.ms.toFixed(0)} ms (TestProduction target, Stopped), ${busy.ms.toFixed(0)} ms (TestProduction target, Other running); budget 2000 ms`);
    for (const timing of [plain.ms, prod.ms, busy.ms]) expect(timing).toBeLessThan(2000);
    await stopAnyProduction();
  }, 240000);
});

// -- Row 13: the state is unreadable ----------------------------------------------------------

describe("Story 40.3: the production state cannot be read (AC-6, matrix row 13)", () => {
  it("row 13: with Ens's runtime lock held elsewhere, a TestProduction run is PRODUCTION_BUSY with state Unknown and an error naming the lock; nothing ran", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const instances = await testInstanceCount();
    ensHeld = true;
    await holdEnsRuntime(dev, NS_A, 20);
    const started = performance.now();
    const result = await executeTests("Story403.PassTest", "class");
    const waitedMs = performance.now() - started;
    await releaseEnsRuntime(dev, NS_A);
    ensHeld = false;

    expect(result.isError, allText(result)).toBe(true);
    const fields = result.structuredContent as Record<string, unknown>;
    expect(fields).toEqual({
      code: "PRODUCTION_BUSY",
      namespace: NS_A,
      state: "Unknown",
      testProductions: PASS_TEST,
      error: "The Ens runtime lock (Ens.Runtime) was not acquired within 5 seconds",
    });
    expect(allText(result)).toContain(`The production state of namespace ${NS_A} could not be read (The Ens runtime lock (Ens.Runtime) was not acquired within 5 seconds)`);
    expect(waitedMs, "the guard waited for the lock").toBeGreaterThan(4000);
    expect(await testInstanceCount(), "nothing ran").toBe(instances);
    expect((await productionStatus()).state, "no production was started").toBe("Stopped");

    // Released, the same call goes ahead.
    const after = succeeded<RunContent>(await executeTests("Story403.PassTest", "class"));
    expect(after).toMatchObject({ status: "completed", total: 1, passed: 1 });
    expect((await productionStatus()).state).toBe("Stopped");
  }, 300000);
});

// -- Row 13b: the fixture methods refuse what is not a scratch namespace ---------------------------------

describe("Story 40.3: the fixture methods that touch the instance refuse any other namespace (decision #59)", () => {
  it("row 13b: a name that is not EXECMCPTMP<digits><letter>, and a scratch name that does not exist, are refused with nothing written", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // Neither name is a namespace, so even a missing name guard could not reach a node or a lock.
    const notScratch = "NOTASCRATCHNAME";
    const absentScratch = "EXECMCPTMP403Z";
    for (const method of ["SetInstalledNamespace", "ClearInstalledNamespace"]) {
      expect(await fixtureCall(method, [notScratch]), `${method} with a name that is not a scratch name`).toMatch(/^refused: the name must be EXECMCPTMP/);
      expect(await fixtureCall(method, [absentScratch]), `${method} with a scratch name that does not exist`).toBe(`refused: namespace ${absentScratch} does not exist`);
    }
    expect(await fixtureCall("HoldEnsRuntime", [notScratch, 5]), "HoldEnsRuntime with a name that is not a scratch name").toMatch(/^refused: the namespace must be EXECMCPTMP/);
    expect(await fixtureCall("HoldEnsRuntime", [absentScratch, 5]), "HoldEnsRuntime with a scratch name that does not exist").toBe(`refused: namespace ${absentScratch} does not exist`);
    expect(await leftovers(dev, [absentScratch]), "no InstalledNamespace node, lock holder or other state was left for the scratch name").toEqual([]);
  }, 120000);
});

// -- Row 15: a namespace where interoperability is not configured ---------------------------------

describe("Story 40.3: interoperability is not configured (Rules #34 and #41, AC-7, matrix row 15)", () => {
  it("row 15: in the bare namespace B a plain run completes and the raw route answers proceed with no TestProduction test and no state read", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded<RunContent>(await executeTests("Story403.PlainTest", "class", NS_B));
    expect(content).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });
    expect(content.details[0]).toMatchObject({ class: "Story403.PlainTest", method: "TestPlain", status: "passed" });

    const route = await rawGuard("Story403.PlainTest", "class", NS_B);
    expect(route.status, route.text).toBe(200);
    expect(route.result).toEqual({ decision: "proceed", namespace: NS_B, testProductions: [] });
    expect(route.result).not.toHaveProperty("stateCode");

    // A class that does not exist in B is not a TestProduction test either, and B has no Ens classes for the guard to call.
    const absent = await rawGuard("Story403.PassTest", "class", NS_B);
    expect(absent.result).toEqual({ decision: "proceed", namespace: NS_B, testProductions: [] });
  }, 180000);

  it("row 15b: a TestProduction test in the bare namespace B cannot have its state read (B has no Ens classes), so the run is PRODUCTION_BUSY with state Unknown and the exception text, and B's lock is left free", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // Defined, not compiled (B cannot compile it): the work queue would compile and run it, so the guard asks for the state.
    await docFixtures(dev, NS_B).putDoc("Story403.FreshTest.cls", STORY403_FRESH_SOURCE);
    const result = await executeTests("Story403.FreshTest", "class", NS_B);
    expect(result.isError, allText(result)).toBe(true);
    const fields = result.structuredContent as { code?: string; namespace?: string; state?: string; testProductions?: unknown; error?: string };
    expect(fields).toMatchObject({
      code: "PRODUCTION_BUSY",
      namespace: NS_B,
      state: "Unknown",
      testProductions: [{ class: "Story403.FreshTest", production: STORY403_PRODUCTION }],
    });
    expect(fields).not.toHaveProperty("production");
    expect(fields.error, "the exception text, with no leading ERROR #n:").toMatch(/^ObjectScript error: <CLASS DOES NOT EXIST>/);
    expect(allText(result)).toContain(`The production state of namespace ${NS_B} could not be read (${fields.error})`);
    // The guard took B's lifecycle lock before the exception; its process is still alive, so a leaked lock would still be held.
    expect(await fixtureCall("EnsRuntimeHeld", [NS_B]), "^Ens.Runtime of B was released after the exception").toBe("0");
  }, 180000);
});
