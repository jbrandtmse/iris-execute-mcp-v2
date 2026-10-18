/**
 * Story 40.1 live gate: `iris_test_coverage` and its companion `iris_test_status` (`coverageRunId`), driven on the
 * REAL wire against disposable namespaces, in the default suite (rule #59: each row names the path it guards).
 *
 * Path: the BUILT iris-dev-mcp and iris-admin-mcp dists, spawned as child processes and driven by the MCP SDK `Client`
 * over stdio -> the tool -> the coverage routes of the ExecuteMCPv2 service -> a supervisor job and a runner job that
 * run the tests in `EXECMCPTMP401A` under an instance-wide Line-by-Line session. The oracles are the matrix values of
 * the Story 40.1 spec (captured live, `coverage-fixture.ts`), SQL written by hand and run through the raw Atelier
 * `action/query` route, raw HTTP to the coverage routes, and the monitor read through the fixture class; never the tools
 * under test. Rows 1 to 11, 13 and 14 of the matrix run, each self-contained (it sets its own hang and reads its own
 * counters), and every row ends by asserting the monitor is idle.
 *
 *  - Rows 1 and 2: the oracle run (28 executable lines, 20 covered, 71.43%) and the not-configured namespace.
 *  - Rows 3 and 4: the line cap and bad input, nothing started and no run id allocated.
 *  - Rows 5 and 6: budget expiry returns `running` with the handles, and the companion reproduces the results.
 *  - Rows 7 to 9: a cancel, a test process killed from outside, and both jobs killed (the next run reclaims the session).
 *  - The MayTerminate decoy: a cancel of a run whose record names a process the supervisor did not start terminates
 *    nothing; the gate's own decoy process stays alive and the run finishes on its own.
 *  - Decision #48: a run whose line counts cannot be read (`counts-unreadable`) or whose session cannot be stopped
 *    (`release-failed`, also when the supervisor's identity proof fails) ends `failed`, with the reason, IRIS's
 *    text, the test summary and any coverage that was read.
 *  - The release locks: a release that cannot take the monitor's own lock (`^%SYS("MON-HOLD")`) proves, reads and
 *    stops nothing, and the run ends `failed` with `release-failed` and no counts.
 *  - The test process stops only the session it started: after a test released every lock of its process (so the
 *    supervisor ended the run), a session started since is left alone and the run keeps its counts; a session that test
 *    code started in place of the suite's, listing the test process but not the run's routines, is neither read nor stopped.
 *  - Stale ownership nodes (`clear-busy-foreign`, `clear-and-proceed`) and the retention of 20 run records.
 *  - Decision #49: the one session of ALL processes this suite ever starts, on the fixture's own routine, stands in for
 *    a foreign session that has no process list of its own; it is refused as foreign, left active and stopped by the
 *    row, and the stale ownership node is kept while it lasts.
 *  - Rows 10 and 11: a foreign session and a running suite run both refuse a new run with `MONITOR_BUSY`.
 *  - Rows 13 and 14: the time limit, and the default governance.
 *
 * This gate, the Story 40.1 QA gate and the two Story 40.2 gates are the only ones that start Line-by-Line sessions (the package runs its files
 * serially, `--no-file-parallelism`). It starts every
 * row with the monitor idle: when a session it did not start is active, an armed gate fails and names it, an unarmed one
 * skips, and the session is left alone. A process is terminated only through the fixture's `TerminateCoverageProcess`,
 * which asks `ExecuteMCPv2.Coverage.Job:MayTerminate` immediately before. No production is started.
 *
 * Fixtures: the disposable namespaces `EXECMCPTMP401A` (the `Story401` classes) and `EXECMCPTMP401B` (empty, no
 * Interoperability), their database files, and the HSCUSTOM class `ExecuteMCPv2.Temp.Story391Fixture`, all removed in
 * `afterAll`, which also asserts nothing is left and the monitor is idle.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773, `_SYSTEM`,
 * HSCUSTOM). A missing or stale dist, an unresolvable SDK or an unreachable IRIS skips each row with the reason, or
 * fails with "may not be skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allText,
  assertDeployedBootstrapVersion,
  atelierQuery,
  distEntry,
  executeMcpPost,
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
import { STORY401_ORACLE_ROUTINE, STORY401_SLOW_ROUTINE, seedCoverageFixture, setSlowTestHang } from "./coverage-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-1-coverage-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The scratch namespace holding the Story401 classes, and the empty one (no Story401 classes, no Interoperability). */
const NS_A = "EXECMCPTMP401A";
const NS_B = "EXECMCPTMP401B";
const NAMESPACES = [NS_A, NS_B];

/** The operator enables the write tool and the companion's cancel; the plain session below sets nothing. */
const ENABLED_GOVERNANCE = JSON.stringify({ global: { iris_test_coverage: true, "iris_test_status:cancel": true } });

/** The route below the web port, for raw HTTP. */
const COVERAGE_ROUTE = "/api/executemcp/v2/dev/test/coverage";

/** The routines of the sessions this gate may see: a suite run's, and the fixture's foreign session. */
const SUITE_ROUTINES = "Story401.Fixture.1";
const FOREIGN_ROUTINES = "ExecuteMCPv2.Temp.Story391Fixture.1";

/** The recorded reason a run that outlives its `maxSeconds` is cancelled with, and the text of a runner killed from outside. */
const RUNNER_ENDED_ERROR = "The test process ended before the tests finished.";

/**
 * A test that releases every lock of its process with an argumentless `Lock` (as old code does), the runner's owner
 * lock included, then hangs for `^Story401Hang` seconds. Put into A by the row that uses it.
 */
const LOCK_DROP_TEST_DOC = "Story401L.LockDropTest.cls";
const LOCK_DROP_TEST_SOURCE = String.raw`/// Synthetic coverage test whose code releases every lock of its process (Story 40.1).
Class Story401L.LockDropTest Extends %UnitTest.TestCase
{

Method TestDropLocks()
{
    Do $$$AssertEquals(##class(Story401.Fixture).SumTo(3), 6, "SumTo(3)")
    Lock
    Hang +$Get(^Story401Hang, 3)
    Do $$$AssertTrue(1, "after the hang")
}

}
`;

/**
 * A test whose code replaces the suite's Line-by-Line session with one of its own that lists the test process, on a
 * routine that is not the run's, and, once its `Start` succeeded, records its process id as the fixture's foreign session
 * so that the row can stop it through `StopIfList` whether or not the fixture process can read the routine names. It
 * stops only a session that lists the test process, which is the suite's own. Put into A by the row that uses it. If
 * another monitor session wins the instant between the `Stop` and the `Start`, the `Start` fails, nothing is recorded,
 * and the test fails its status assertion.
 */
const SWAP_TEST_DOC = "Story401S.SwapTest.cls";
const SWAP_TEST_SOURCE = String.raw`/// Synthetic coverage test whose code replaces the suite's Line-by-Line session with one of its own (Story 40.1).
Class Story401S.SwapTest Extends %UnitTest.TestCase
{

Method TestSwapSession()
{
    Do $$$AssertEquals(##class(Story401.Fixture).SumTo(3), 6, "SumTo(3)")
    If ##class(ExecuteMCPv2.Coverage.Job).ListsProcess($Job) Do ##class(%Monitor.System.LineByLine).Stop()
    Set tSC = ##class(%Monitor.System.LineByLine).Start($ListBuild("ExecuteMCPv2.Temp.Story391Fixture.1"), $ListBuild("RtnLine"), $ListBuild($Job))
    Do $$$AssertStatusOK(tSC, "the test started a session of its own")
    If $$$ISOK(tSC) Set ^IRIS.TempStory391Fixture("foreign") = $Job
}

}
`;

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let devPlain: WireSession;
let admin: WireSession;

function wireOptions(pkg: string): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "story-40-1-live-gate",
  };
}

/** The target of the raw Atelier oracle: the scratch namespace A. */
const oracleTarget = (): typeof TARGET => ({ ...TARGET, namespace: NS_A });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface MonitorStateJson {
  active: number;
  count: number;
  pids: string;
  routines: string[];
}

interface RoutineValues {
  routine: string;
  lines: number;
  executableLines: number;
  coveredLines: number;
  percent: number | null;
  executableRanges: number[][];
  coveredRanges: number[][];
}

interface CoverageContent {
  status: string;
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  coverageRunId: number;
  runIndex: number | null;
  namespace: string;
  target?: string;
  pid: number | null;
  runnerPid: number | null;
  startedAt: string;
  finishedAt?: string | null;
  reason?: string;
  error?: string;
  readError?: string;
  hint?: string;
  partial?: Record<string, unknown>;
  reclaimed?: { coverageRunId: number; pid: number | null };
  coverage?: {
    complete: boolean;
    classes: Array<{ class: string; routines: RoutineValues[] }>;
    unmeasured: Array<{ class: string; reason: string }>;
  };
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

/** The monitor is idle: no Line-by-Line or PERFMON session is active on the instance. */
async function expectIdle(row: string): Promise<void> {
  const state = await monitorState();
  expect(state.active, `${row}: the monitor is idle afterwards (process list "${state.pids}")`).toBe(0);
}

/** Wait up to 5 seconds for the session's process list to read `expected`, then assert it does. */
async function expectPids(expected: string, why: string): Promise<void> {
  const deadline = Date.now() + 5000;
  let state = await monitorState();
  while (state.pids !== expected && Date.now() < deadline) {
    await sleep(100);
    state = await monitorState();
  }
  expect(state.pids, `the session's process list: ${why}`).toBe(expected);
}

/**
 * Stop a session a failed row left behind, so it cannot poison the rows after it: the fixture stops it only when it is
 * provably the one `routines` names, and refuses otherwise.
 */
async function releaseLeftover(routines: string): Promise<void> {
  if ((await monitorState()).active === 1) await fixtureCall("StopIfList", [routines]);
}

/** The last run id the coverage service allocated, read from its IRISTEMP counter. */
async function runCounter(): Promise<number> {
  const result = await dev.call("iris_global_get", { namespace: "HSCUSTOM", global: "IRIS.TempExecuteMCPv2Coverage", subscripts: '"seq"' });
  expect(result.isError, allText(result)).toBeFalsy();
  return Number((result.structuredContent as { value?: unknown } | undefined)?.value ?? 0);
}

/** A node of the coverage service's IRISTEMP global, as `{value, defined}`. */
async function coverageGlobal(subscripts: string): Promise<{ value: unknown; defined: boolean }> {
  const result = await dev.call("iris_global_get", { namespace: "HSCUSTOM", global: "IRIS.TempExecuteMCPv2Coverage", subscripts });
  expect(result.isError, allText(result)).toBeFalsy();
  const content = result.structuredContent as { value?: unknown; defined?: boolean } | undefined;
  return { value: content?.value, defined: content?.defined === true };
}

/** Kill both jobs of a run with the fixture (the supervisor first), leaving its session active with a stale ownership node. */
async function killBothJobs(running: CoverageContent): Promise<void> {
  expect(await fixtureCall("TerminateCoverageProcess", [running.pid])).toMatch(/^terminated:1/);
  expect(await fixtureCall("TerminateCoverageProcess", [running.runnerPid])).toMatch(/^terminated:1/);
  await expectPids("0", "both jobs have ended");
}

/** The structured content of a tool call that must not be an error. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

/** `iris_test_coverage` over A for the target and classes of the oracle run, with `overrides`. */
function coverage(overrides: Record<string, unknown> = {}): Promise<WireToolResult> {
  return dev.call("iris_test_coverage", {
    target: "Story401.FixtureTest",
    level: "class",
    classes: ["Story401.Fixture", "Story401.Missing"],
    namespace: NS_A,
    ...overrides,
  });
}

/** A start of `Story401.SlowTest` with a 1 second budget: returns the `running` result. */
async function startSlow(): Promise<CoverageContent> {
  const content = succeeded<CoverageContent>(
    await coverage({ target: "Story401.SlowTest", classes: ["Story401.Fixture"], timeout: 1 }),
  );
  expect(content.status, "the budget expired with the run still executing").toBe("running");
  return content;
}

/** The companion's poll by the handle alone: through the session's `raw` call, so no namespace is sent. */
function poll(coverageRunId: number): Promise<WireToolResult> {
  return dev.raw("iris_test_status", { action: "poll", coverageRunId: String(coverageRunId) });
}

/** Poll until the run's status is one of `statuses`, or fail after `timeoutMs`. */
async function pollUntil(coverageRunId: number, statuses: readonly string[], timeoutMs = 60000): Promise<WireToolResult> {
  const deadline = Date.now() + timeoutMs;
  let last: WireToolResult | undefined;
  while (Date.now() < deadline) {
    last = await poll(coverageRunId);
    const status = (last.structuredContent as { status?: string } | undefined)?.status;
    if (status !== undefined && statuses.includes(status)) return last;
    await sleep(400);
  }
  throw new Error(`coverage run ${coverageRunId} did not reach ${statuses.join(" or ")} within ${timeoutMs} ms: ${allText(last ?? {})}`);
}

/** The Status route of the service, raw: its HTTP status and the run record. */
async function rawStatus(coverageRunId: number): Promise<{ status: number; run: Record<string, unknown> }> {
  const answer = await rawIrisRequest(TARGET, `${COVERAGE_ROUTE}?id=${coverageRunId}`, { method: "GET" });
  const body = answer.json as { result?: Record<string, unknown> } | undefined;
  return { status: answer.status, run: body?.result ?? {} };
}

/** Poll the raw route until the run is terminal. */
async function rawUntilTerminal(coverageRunId: number, timeoutMs = 60000): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { run } = await rawStatus(coverageRunId);
    if (["completed", "cancelled", "failed", "abandoned"].includes(String(run["status"]))) return run;
    await sleep(400);
  }
  throw new Error(`coverage run ${coverageRunId} was not terminal within ${timeoutMs} ms`);
}

/** The routines of the one measured class of a coverage object. */
function routinesOf(content: CoverageContent): RoutineValues[] {
  return content.coverage?.classes[0]?.routines ?? [];
}

/** The tool refusal, whatever shape the framework gave it: either the result, or the SDK's error. */
async function refusedOrRejected(call: () => Promise<WireToolResult>): Promise<{ isError: boolean; text: string }> {
  try {
    const result = await call();
    return { isError: result.isError === true, text: allText(result) };
  } catch (error) {
    return { isError: true, text: error instanceof Error ? error.message : String(error) };
  }
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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.1 live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  const openedAt = Date.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_GOVERNANCE: ENABLED_GOVERNANCE });
  const bootstrapSeconds = (Date.now() - openedAt) / 1000;
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  // eslint-disable-next-line no-console
  console.log(`[INFO] ${GATE_TAG}: the dev server opened (startup bootstrap included) in ${bootstrapSeconds.toFixed(1)} s`);
  devPlain = await openWireSession(wireOptions("iris-dev-mcp"));
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  await putFixtureClass(dev);

  // Every row starts with the monitor idle. A session this gate did not start is named and left alone.
  const initial = await monitorState();
  if (initial.active !== 0) {
    const named = `a Line-by-Line or PERFMON session this gate did not start is active (process list "${initial.pids}", ${initial.count} routine(s): ${JSON.stringify(initial.routines)}); it was left untouched`;
    for (const session of [admin, devPlain]) await session.close();
    await removeFixtureClass(dev);
    await dev.close();
    if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.1 live gate may not be skipped: ${named}`);
    skipReason = named;
    return;
  }

  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);
  await createInteropNamespace(admin, dev, NS_A, { interop: false });
  await createInteropNamespace(admin, dev, NS_B, { interop: false });
  await seedCoverageFixture(dev, NS_A);

  // A positive control: the same check that must read empty after the run sees both namespaces now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees both namespaces while they exist").toEqual(
    expect.arrayContaining([`namespace ${NS_A}`, `database configuration ${NS_A}`, `namespace ${NS_B}`, `database configuration ${NS_B}`]),
  );
}, 300000);

afterEach(async () => {
  if (skipReason) return;
  // A row that fails must not leave its session behind for the rows after it: the fixture stops it only when it is
  // provably a coverage session of this gate, and refuses otherwise.
  await releaseLeftover(SUITE_ROUTINES);
});

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const { problems, attempt } = teardownRecorder();
  try {
    // The safety net: a session a failed row left behind is stopped, but only when it is provably the one named.
    await attempt("stopping a coverage session left behind", async () => {
      await fixtureCall("StopIfList", [SUITE_ROUTINES]);
    });
    await attempt("stopping the foreign session left behind", async () => {
      await fixtureCall("StopIfList", [FOREIGN_ROUTINES]);
    });
    await attempt("asking the decoy to end", async () => {
      await fixtureCall("StopDecoy");
    });
    await attempt("releasing the monitor lock", async () => {
      await fixtureCall("ReleaseMonitorLock");
    });
    await attempt("removing the fake run records", async () => {
      await fixtureCall("ClearFakeRuns");
    });
    await attempt("the monitor is idle", async () => {
      expect((await monitorState()).active, "the monitor is idle after the run").toBe(0);
    });
    await attempt("no coverage ownership node is left", async () => {
      expect((await coverageGlobal('"session"')).defined, "no suite session node after the run").toBe(false);
    });
    for (const name of NAMESPACES) await attempt(`removing ${name}`, () => removeInteropNamespace(admin, dev, name));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, NAMESPACES), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story401", "Story391Fixture"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [admin, devPlain, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- Rows 1 to 4: the oracle run, the not-configured namespace, the line cap, bad input ----

describe("Story 40.1: the oracle run and the refusals that start nothing (AC-1, matrix rows 1 to 4)", () => {
  it("row 1: Story401.FixtureTest covers 20 of the 28 executable INT lines of Story401.Fixture.1 (71.43%), 4 tests passed, Story401.Missing is not-compiled, the runner released its own session, and the monitor is idle", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await coverage();
    const row1 = succeeded<CoverageContent>(result);
    expect(row1.status).toBe("completed");
    expect(row1).toMatchObject({ total: 4, passed: 4, failed: 0, skipped: 0, namespace: NS_A, target: "Story401.FixtureTest" });
    expect(row1.coverage?.complete).toBe(true);
    expect(routinesOf(row1)[0]).toEqual(STORY401_ORACLE_ROUTINE);
    expect(routinesOf(row1)).toHaveLength(1);
    expect(row1.coverage?.unmeasured).toEqual([{ class: "Story401.Missing", reason: "not-compiled" }]);
    expect(row1).not.toHaveProperty("reclaimed");
    expect(typeof row1.runIndex).toBe("number");

    // The oracle for the counts of tests: %UnitTest_Result of A, by hand, never the tool.
    const rows = await atelierQuery(
      oracleTarget(),
      "SELECT tm.Name AS MethodName, tm.Status FROM %UnitTest_Result.TestMethod tm JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID " +
        "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID JOIN %UnitTest_Result.TestInstance ti ON ts.TestInstance = ti.ID " +
        `WHERE ti.InstanceIndex = ${row1.runIndex} ORDER BY tm.Name`,
    );
    expect(rows.map((row) => [row["MethodName"], Number(row["Status"])])).toEqual([
      ["TestClassify", 1],
      ["TestGuarded", 1],
      ["TestLoop", 1],
      ["TestSumTo", 1],
    ]);

    // The text is compact: a status line, the routine line and the unmeasured line, never a JSON dump. Since Story 40.2 the class-source
    // lines stand between the status line and the routine line; the 40.1 lines are unchanged and follow them.
    const lines = allText(result).split("\n");
    expect(lines[0]).toBe("Coverage run " + row1.coverageRunId + " completed: 4 tests, 4 passed, 0 failed, 0 skipped.");
    expect(lines.slice(-2)).toEqual([
      "Story401.Fixture.1: 20 of 28 executable INT lines covered (71.43%); uncovered 8, 16-18, 23, 27, 47-48",
      "Not measured: Story401.Missing (not-compiled)",
    ]);
    expect(lines[1], "the class-source lines start right after the status line").toMatch(/^Story401\.Fixture: \d+ of \d+ class lines covered \(/);
    expect(lines.slice(1, -2).every((line) => line.startsWith("Story401.Fixture: ") || line.startsWith("  ")), "the lines between are the class-source lines").toBe(true);

    // The raw Status route is the oracle for who stopped the session: a finished run's own runner does.
    const raw = await rawStatus(row1.coverageRunId);
    expect(raw.run["releasedBy"], "the runner stopped its own session").toBe("runner");
    expect(raw.run, "the counts were read").not.toHaveProperty("readError");
    await expectIdle("row 1");
  }, 180000);

  it("row 2: a namespace with no Story401 classes is an error that names the namespace, starts nothing and allocates no run id", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const before = await runCounter();
    const result = await coverage({ namespace: NS_B });
    expect(result.isError, allText(result)).toBe(true);
    expect(allText(result)).toContain(NS_B);
    expect(await runCounter(), "no run id was allocated").toBe(before);
    await expectIdle("row 2");
  }, 120000);

  it("a target that names no test class is an error that says no test method ran, with nothing covered and the monitor idle", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await coverage({ target: "Story401.NoSuchTest", level: "class", classes: ["Story401.Fixture"] });
    expect(result.isError, allText(result)).toBe(true);
    const content = result.structuredContent as unknown as CoverageContent;
    expect(content).toMatchObject({ status: "completed", total: 0, passed: 0, failed: 0 });
    expect(content.error).toContain("no test method ran");
    expect(routinesOf(content)[0], "nothing ran, so nothing is covered").toMatchObject({ executableLines: 28, coveredLines: 0, percent: 0 });
    await expectIdle("unknown target");
  }, 240000);

  it("row 3: a run over the line cap is an error from the route (48 INT lines over a limit of 10), starting nothing", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const before = await runCounter();
    const answer = await executeMcpPost(TARGET, "/dev/test/coverage", {
      target: "Story401.FixtureTest",
      level: "class",
      classes: ["Story401.Fixture"],
      namespace: NS_A,
      maxSeconds: 3600,
      maxLines: 10,
    });
    const body = JSON.parse(answer.text) as { status?: { errors?: Array<{ error?: string }> } };
    expect(body.status?.errors?.[0]?.error ?? "").toContain("Coverage of 48 INT lines exceeds the limit of 10.");
    expect(await runCounter(), "no run id was allocated").toBe(before);
    await expectIdle("row 3");
  }, 120000);

  it("row 4: no classes, 51 classes and a bad level are refused by the tool's schema, and maxSeconds 0 by the route; nothing is started", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const before = await runCounter();
    const fiftyOne = Array.from({ length: 51 }, (_, index) => `Story401.Fixture${index}`);
    for (const overrides of [{ classes: [] }, { classes: fiftyOne }, { level: "suite" }]) {
      const refused = await refusedOrRejected(() => coverage(overrides));
      expect(refused.isError, `${JSON.stringify(overrides).slice(0, 60)}: ${refused.text}`).toBe(true);
    }
    const answer = await executeMcpPost(TARGET, "/dev/test/coverage", {
      target: "Story401.FixtureTest",
      level: "class",
      classes: ["Story401.Fixture"],
      namespace: NS_A,
      maxSeconds: 0,
      maxLines: 200000,
    });
    const body = JSON.parse(answer.text) as { status?: { errors?: Array<{ error?: string }> } };
    expect(body.status?.errors?.[0]?.error ?? "").toContain("maxSeconds");
    expect(await runCounter(), "no run id was allocated").toBe(before);
    await expectIdle("row 4");
  }, 120000);

  it("levels: method runs the one test method (coverage of the SumTo lines only), package runs every test class of the package", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const method = succeeded<CoverageContent>(await coverage({ target: "Story401.FixtureTest:TestSumTo", level: "method" }));
    expect(method).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });
    expect(routinesOf(method)[0], "only SumTo ran").toEqual(STORY401_SLOW_ROUTINE);
    await expectIdle("level method");

    await setSlowTestHang(dev, NS_A, 1);
    const pack = succeeded<CoverageContent>(await coverage({ target: "Story401", level: "package" }));
    expect(pack, "FixtureTest has four tests and SlowTest one").toMatchObject({ status: "completed", total: 5, passed: 5, failed: 0 });
    expect(routinesOf(pack)[0], "the union of both classes covers what FixtureTest alone covers").toEqual(STORY401_ORACLE_ROUTINE);
    await expectIdle("level package");
  }, 240000);

  it("row 6 (the second half): one poll of a completed run's coverageRunId by the handle alone deep-equals that run's own structuredContent (AC-5)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await coverage();
    const content = succeeded<CoverageContent>(result);
    expect(content.status).toBe("completed");
    const polled = await poll(content.coverageRunId);
    expect(polled.isError, allText(polled)).toBeFalsy();
    expect(polled.structuredContent).toEqual(result.structuredContent);
    await expectIdle("row 6, the poll of a completed run");
  }, 180000);
});

// -- Rows 5 and 6: budget expiry and the companion -----------------------------

describe("Story 40.1: a run that outlives its wait budget returns running, and the companion reproduces the result (AC-3, AC-5, matrix rows 5 and 6)", () => {
  it("rows 5 and 6: timeout 1 on a 3 second test returns running with the handles; the polls complete with 14.29% and the second poll deep-equals the first", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 3);
    const running = await startSlow();
    expect(running.coverageRunId).toBeGreaterThan(0);
    expect(typeof running.pid).toBe("number");
    expect(typeof running.runnerPid).toBe("number");
    expect(running.runIndex === null || typeof running.runIndex === "number").toBe(true);
    expect(running.partial).toBeDefined();
    expect(String(running.hint)).toContain("iris_test_status");
    expect(String(running.hint)).toContain(`coverageRunId "${running.coverageRunId}"`);

    const first = await pollUntil(running.coverageRunId, ["completed"]);
    const completed = succeeded<CoverageContent>(first);
    expect(completed).toMatchObject({ status: "completed", total: 1, passed: 1, coverageRunId: running.coverageRunId });
    expect(completed.coverage?.complete).toBe(true);
    expect(routinesOf(completed)[0]).toEqual(STORY401_SLOW_ROUTINE);
    const second = await poll(running.coverageRunId);
    expect(second.structuredContent, "a second poll deep-equals the first").toEqual(first.structuredContent);
    await expectIdle("rows 5 and 6");
  }, 180000);
});

// -- Rows 7 to 9: cancel, a killed test process, both jobs killed ------------------

describe("Story 40.1: a run killed mid-flight leaves no monitor session, and a session whose jobs are both dead is reclaimed (AC-3, AC-4, matrix rows 7 to 9)", () => {
  it("row 7: a cancel through the companion ends the run cancelled with reason cancel, partial coverage of the SumTo lines, and the monitor idle", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 20);
    const startedAt = Date.now();
    const running = await startSlow();
    const cancelled = await dev.raw("iris_test_status", { action: "cancel", coverageRunId: String(running.coverageRunId) });
    expect(cancelled.isError, allText(cancelled)).toBeFalsy();
    const content = cancelled.structuredContent as unknown as CoverageContent;
    expect(content).toMatchObject({ status: "cancelled", reason: "cancel", coverageRunId: running.coverageRunId });
    expect(content.coverage?.complete).toBe(false);
    expect(routinesOf(content)[0]?.coveredRanges, "the SumTo lines the test reached are covered").toEqual([[40, 42], [44, 44]]);
    expect(Date.now() - startedAt, "the cancel did not wait for the 20 second hang").toBeLessThan(18000);
    await expectIdle("row 7");
  }, 180000);

  it("row 8: terminating the test process from outside ends the run failed with the runner-ended error, released by the supervisor, with the monitor idle", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 20);
    const running = await startSlow();
    const terminated = await fixtureCall("TerminateCoverageProcess", [running.runnerPid]);
    expect(terminated, "the fixture terminated the runner after MayTerminate approved it").toMatch(/^terminated:1/);
    const failed = await pollUntil(running.coverageRunId, ["failed"]);
    expect(failed.isError, allText(failed)).toBe(true);
    const content = failed.structuredContent as unknown as CoverageContent;
    expect(content).toMatchObject({ status: "failed", error: RUNNER_ENDED_ERROR, coverageRunId: running.coverageRunId });
    expect(content.coverage, "the supervisor read the counts the dead runner left").toBeDefined();
    expect(content.coverage?.complete).toBe(false);
    expect(routinesOf(content)[0]?.coveredRanges, "the SumTo lines the test reached are covered").toEqual([[40, 42], [44, 44]]);
    const raw = await rawStatus(running.coverageRunId);
    expect(raw.run["releasedBy"], "the raw Status route shows who released the session").toBe("supervisor");
    await expectIdle("row 8");
  }, 180000);

  it("row 9: with the supervisor and then the runner terminated the run is abandoned and its session stays; the next run reclaims it and completes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 20);
    const running = await startSlow();
    try {
      // IRIS lists the session's processes that are still alive, in ascending order of process id, and 0 once none
      // is (captured live, IRIS 2026.2 build 221U): it is the list a reclaiming request reads.
      const ascending = (pids: Array<number | null>): string => pids.map(Number).sort((a, b) => a - b).join(" ");
      await expectPids(ascending([running.pid, running.runnerPid]), "both jobs alive");
      // The supervisor first, then the runner: with the runner killed first, the supervisor's 100 ms watch would
      // release the session before the second kill.
      expect(await fixtureCall("TerminateCoverageProcess", [running.pid])).toMatch(/^terminated:1/);
      await expectPids(String(running.runnerPid), "the supervisor has ended and left the list");
      expect(await fixtureCall("TerminateCoverageProcess", [running.runnerPid])).toMatch(/^terminated:1/);
      await expectPids("0", "both jobs have ended: no live process is left in the list");
      const abandoned = await pollUntil(running.coverageRunId, ["abandoned"], 30000);
      expect(abandoned.isError, allText(abandoned)).toBeFalsy();
      expect(abandoned.structuredContent).toMatchObject({ status: "abandoned", coverageRunId: running.coverageRunId });
      expect((await monitorState()).active, "no one released the session, because both jobs are dead").toBe(1);

      const reclaimed = succeeded<CoverageContent>(await coverage());
      expect(reclaimed.status).toBe("completed");
      expect(reclaimed.reclaimed).toEqual({ coverageRunId: running.coverageRunId, pid: running.pid });
      expect(routinesOf(reclaimed)[0]).toEqual(STORY401_ORACLE_ROUTINE);
    } finally {
      await releaseLeftover(SUITE_ROUTINES);
    }
    await expectIdle("row 9");
  }, 240000);

  it("the MayTerminate decoy: a cancel of a run whose record names another process terminates nothing, so the decoy lives and the run finishes its tests on its own", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 6);
    const decoy = await fixtureCall("StartDecoy");
    expect(decoy).toMatch(/^started:\d+$/);
    const decoyPid = Number(decoy.slice("started:".length));
    try {
      const running = await startSlow();
      // The run record now names the decoy as the runner, as a reused process id would: the supervisor's own
      // record of the runner it started no longer matches, so MayTerminate must refuse.
      expect(await fixtureCall("PointRunnerAtDecoy", [running.coverageRunId, decoyPid])).toBe("pointed");
      expect((await rawStatus(running.coverageRunId)).run["runnerPid"], "the record names the decoy").toBe(decoyPid);

      const signalled = await executeMcpPost(TARGET, "/dev/test/coverage/cancel", { id: running.coverageRunId });
      expect((JSON.parse(signalled.text) as { result?: { cancelRequested?: boolean } }).result?.cancelRequested).toBe(true);

      const finished = await rawUntilTerminal(running.coverageRunId);
      expect(finished["status"], "nothing was terminated, so the run was not cancelled: it ran its test to the end").toBe("completed");
      expect(finished["cancelRequested"], "the cancel was signalled").toBe(true);
      expect(finished["releasedBy"], "the runner stopped its own session").toBe("runner");
      expect(await fixtureCall("DecoyAlive"), "the decoy was not terminated").toBe("1");
      const polled = succeeded<CoverageContent>(await poll(running.coverageRunId));
      expect(polled).toMatchObject({ status: "completed", total: 1, passed: 1 });
    } finally {
      expect(await fixtureCall("StopDecoy"), "the gate ended its own decoy").toBe("stopped");
    }
    await expectIdle("the MayTerminate decoy row");
  }, 240000);
});

// -- Runs that lose their counts or their release are never silent (decision #48) -----------------

describe("Story 40.1: a run whose line counts could not be read, or whose session could not be stopped, ends failed with the reason (AC-3, AC-4, decision #48)", () => {
  it("counts-unreadable: a runner that cannot read its counts still stops its session, and the run ends failed with the reason, IRIS's text, readError and the test summary", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 5);
    const running = await startSlow();
    expect(await fixtureCall("CorruptRoutines", [running.coverageRunId])).toBe("corrupted");
    const failed = await pollUntil(running.coverageRunId, ["failed"], 90000);
    expect(failed.isError, allText(failed)).toBe(true);
    const content = failed.structuredContent as unknown as CoverageContent;
    expect(content).toMatchObject({ status: "failed", reason: "counts-unreadable", coverageRunId: running.coverageRunId });
    expect(content.partial, "the test summary is still returned").toMatchObject({ total: 1, passed: 1, failed: 0 });
    expect(content.error).toContain("The line counts of this run could not be read");
    expect(content.readError, "IRIS's own text").toContain("<LIST>");
    expect(content, "there are no counts to report").not.toHaveProperty("coverage");
    const raw = await rawStatus(running.coverageRunId);
    expect(raw.run["readError"], "the raw Status route returns readError").toBe(content.readError);
    expect(raw.run["releasedBy"], "the runner still stopped its own session").toBe("runner");
    await expectIdle("counts-unreadable");
  }, 240000);

  it("release-failed: a session whose release cannot take the monitor's own lock is left as it was, and the run ends failed with the reason and the test summary but no counts; the next run reclaims the session", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 5);
    const running = await startSlow();
    try {
      // The monitor's own lock is held, so neither the runner nor the supervisor can take it for the release: each waits
      // for it, then proves, reads and stops nothing.
      expect(await fixtureCall("HoldMonitorLock", [30])).toBe("held");
      const failed = await pollUntil(running.coverageRunId, ["failed"], 120000);
      expect(failed.isError, allText(failed)).toBe(true);
      const content = failed.structuredContent as unknown as CoverageContent;
      expect(content).toMatchObject({ status: "failed", reason: "release-failed", coverageRunId: running.coverageRunId });
      expect(content.partial, "the test summary is still returned").toMatchObject({ total: 1, passed: 1, failed: 0 });
      expect(content.error).toContain("A suite-owned Line-by-Line session is still active");
      expect(content.error).toContain("the monitor's own lock was held by another process");
      expect(content.error).toContain("The next coverage run reclaims it");
      expect(content, "nothing is read from a session that was not locked for its release, so there are no counts to report").not.toHaveProperty("coverage");
      const raw = await rawStatus(running.coverageRunId);
      expect(raw.run, "nobody released the session").not.toHaveProperty("releasedBy");
      expect(String(raw.run["readError"]), "the counts were not read, and the run says why").toContain("the monitor's own lock was held by another process");
      expect((await monitorState()).active, "the suite's own session is still active").toBe(1);

      expect(await fixtureCall("ReleaseMonitorLock")).toBe("released");
      const reclaimed = succeeded<CoverageContent>(await coverage());
      expect(reclaimed.status).toBe("completed");
      expect(reclaimed.reclaimed).toEqual({ coverageRunId: running.coverageRunId, pid: running.pid });
      expect((await rawStatus(running.coverageRunId)).run["status"], "reclaiming a finished run's session leaves its status alone").toBe("failed");
    } finally {
      await fixtureCall("ReleaseMonitorLock");
      await releaseLeftover(SUITE_ROUTINES);
    }
    await expectIdle("release-failed");
  }, 300000);

  it("release-failed by the routine-name proof: a session whose routines the supervisor reads but are not the run's is left running, the run ends failed with the reason, and the next run reclaims the session", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 20);
    const running = await startSlow();
    try {
      // The run record now names a routine the session does not monitor; the session itself is still the run's.
      expect(await fixtureCall("RenameRoutineList", [running.coverageRunId])).toBe("renamed");
      expect(await fixtureCall("TerminateCoverageProcess", [running.runnerPid])).toMatch(/^terminated:1/);
      const failed = await pollUntil(running.coverageRunId, ["failed"], 60000);
      expect(failed.isError, allText(failed)).toBe(true);
      const content = failed.structuredContent as unknown as CoverageContent;
      expect(content).toMatchObject({ status: "failed", reason: "release-failed", coverageRunId: running.coverageRunId });
      expect(content.error).toContain("could not be verified as this run's");
      expect(content.error).toContain("are not this run's routine list");
      expect((await rawStatus(running.coverageRunId)).run, "the supervisor stopped nothing").not.toHaveProperty("releasedBy");
      expect((await monitorState()).active, "the session is still active").toBe(1);
      expect((await coverageGlobal('"session"')).defined, "and its ownership node is kept for a reclaim").toBe(true);

      const reclaimed = succeeded<CoverageContent>(await coverage());
      expect(reclaimed.status).toBe("completed");
      expect(reclaimed.reclaimed).toEqual({ coverageRunId: running.coverageRunId, pid: running.pid });
    } finally {
      await releaseLeftover(SUITE_ROUTINES);
    }
    await expectIdle("release-failed by the routine-name proof");
  }, 240000);
});

// -- The test process stops only the session it started (AD-27) ---------------------------------------

describe("Story 40.1: the test process stops only the session it started, so a session started after its own is never touched (AC-2, AD-27)", () => {
  it("a test that releases every lock of its process: the supervisor ends the run and stops its session, and when the tests end the test process stops nothing, so a session started since is left alone and the run keeps its counts", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const [tool, args] of [
      ["iris_doc_put", { namespace: NS_A, name: LOCK_DROP_TEST_DOC, content: LOCK_DROP_TEST_SOURCE }],
      ["iris_doc_compile", { namespace: NS_A, doc: LOCK_DROP_TEST_DOC }],
    ] as const) {
      const result = await dev.call(tool, args);
      expect(result.isError, `${tool}: ${allText(result)}`).toBeFalsy();
    }
    await setSlowTestHang(dev, NS_A, 12);
    const answer = await executeMcpPost(TARGET, "/dev/test/coverage", {
      target: "Story401L.LockDropTest",
      level: "class",
      classes: ["Story401.Fixture"],
      namespace: NS_A,
      maxSeconds: 3600,
      maxLines: 200000,
    });
    const started = (JSON.parse(answer.text) as { result?: { outcome?: string; coverageRunId?: number } }).result;
    expect(started?.outcome, answer.text).toBe("started");
    const id = Number(started?.coverageRunId);

    // The test released the runner's owner lock, so the supervisor took the runner for dead: it read the counts, stopped
    // the session and ended the run, while the test process went on with its hang.
    const ended = await rawUntilTerminal(id, 30000);
    expect(ended).toMatchObject({ status: "failed", error: RUNNER_ENDED_ERROR, releasedBy: "supervisor" });
    const before = (await poll(id)).structuredContent as unknown as CoverageContent;
    expect(routinesOf(before)[0]?.coveredRanges, "the supervisor read the SumTo lines").toEqual([[40, 42], [44, 44]]);
    expect((await coverageGlobal(`"run",${id},"testsDone"`)).defined, "the test process is still in its hang").toBe(false);
    await expectIdle("the supervisor stopped the run's session");

    let stopped = false;
    try {
      expect(await fixtureCall("StartForeign")).toMatch(/^started:\d+$/);
      const foreign = await monitorState();
      const deadline = Date.now() + 30000;
      while (!(await coverageGlobal(`"run",${id},"testsDone"`)).defined && Date.now() < deadline) await sleep(250);
      expect((await coverageGlobal(`"run",${id},"testsDone"`)).defined, "the test process finished its tests").toBe(true);
      await sleep(3000);
      const after = await monitorState();
      expect(after.active, "the test process did not stop the session started after its own").toBe(1);
      expect(after.pids, "which keeps its process list").toBe(foreign.pids);
      const again = (await poll(id)).structuredContent as unknown as CoverageContent;
      expect(again.coverage, "the finished run keeps the counts the supervisor read").toEqual(before.coverage);
      expect((await rawStatus(id)).run["releasedBy"], "and the record of who released its session").toBe("supervisor");
      expect(await fixtureCall("StopIfList", [FOREIGN_ROUTINES])).toBe("stopped");
      stopped = true;
    } finally {
      if (!stopped) await fixtureCall("StopIfList", [FOREIGN_ROUTINES]);
    }
    await expectIdle("the lock-dropping test");
  }, 240000);

  it("a session that test code started in place of the suite's, listing the test process but not this run's routines, is neither read nor stopped by the test process, and the run ends failed with release-failed", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const [tool, args] of [
      ["iris_doc_put", { namespace: NS_A, name: SWAP_TEST_DOC, content: SWAP_TEST_SOURCE }],
      ["iris_doc_compile", { namespace: NS_A, doc: SWAP_TEST_DOC }],
    ] as const) {
      const result = await dev.call(tool, args);
      expect(result.isError, `${tool}: ${allText(result)}`).toBeFalsy();
    }
    const answer = await executeMcpPost(TARGET, "/dev/test/coverage", {
      target: "Story401S.SwapTest",
      level: "class",
      classes: ["Story401.Fixture"],
      namespace: NS_A,
      maxSeconds: 3600,
      maxLines: 200000,
    });
    const started = (JSON.parse(answer.text) as { result?: { outcome?: string; coverageRunId?: number } }).result;
    expect(started?.outcome, answer.text).toBe("started");
    const id = Number(started?.coverageRunId);
    let stopped = false;
    try {
      const ended = await rawUntilTerminal(id, 60000);
      expect(ended, "the supervisor could not verify the session as the run's").toMatchObject({ status: "failed", reason: "release-failed" });
      expect(String(ended["error"])).toContain("could not be verified as this run's");
      expect(ended, "the test process stopped nothing").not.toHaveProperty("releasedBy");
      expect((await coverageGlobal(`"run",${id},"hasCounts"`)).defined, "and read none of the other session's counts").toBe(false);
      const state = await monitorState();
      expect(state.active, "the session the test started is still active").toBe(1);
      expect(state.count).toBe(1);
      expect([FOREIGN_ROUTINES, ""], "each name either unreadable here or exactly the test's session's").toContain(state.routines[0]);
      expect(await fixtureCall("StopIfList", [FOREIGN_ROUTINES])).toBe("stopped");
      stopped = true;
    } finally {
      if (!stopped) await fixtureCall("StopIfList", [FOREIGN_ROUTINES]);
    }
    await expectIdle("the swapped session");

    // A release-failed run keeps its ownership node for a reclaim. The session it named has been stopped, so the next
    // start clears the node with the monitor idle and leaves the finished run's status alone; nothing is left behind.
    expect((await coverageGlobal('"session"')).defined, "the release-failed run kept its ownership node").toBe(true);
    const next = succeeded<CoverageContent>(await coverage());
    expect(next.status).toBe("completed");
    expect(next, "nothing was reclaimed: the swapped session had already been stopped").not.toHaveProperty("reclaimed");
    expect((await coverageGlobal('"session"')).defined, "the next start cleared the node").toBe(false);
    expect((await rawStatus(id)).run["status"], "the finished run keeps its status").toBe("failed");
    await expectIdle("the swapped session's node");
  }, 240000);
});

// -- Stale ownership nodes and the retention of run records --------------------------------

describe("Story 40.1: a stale session node never lets the suite touch a foreign session, and the run records are kept to 20 (AC-2, AC-4)", () => {
  it("clear-busy-foreign: a stale node with a foreign session active is refused as foreign, the node is cleared and the foreign session is left untouched", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 20);
    const running = await startSlow();
    await killBothJobs(running);
    // The suite's own session is stopped (the fixture proves it is the suite's), leaving the stale ownership node.
    expect(await fixtureCall("StopIfList", [SUITE_ROUTINES])).toBe("stopped");
    expect((await coverageGlobal('"session"')).defined, "the stale node is still there").toBe(true);
    let stopped = false;
    try {
      expect(await fixtureCall("StartForeign")).toMatch(/^started:\d+$/);
      const before = await monitorState();
      expect(before.active).toBe(1);
      const counter = await runCounter();

      const refused = await coverage();
      expect(refused.isError, allText(refused)).toBe(true);
      expect(refused.structuredContent).toEqual({ code: "MONITOR_BUSY", owner: "foreign" });
      expect((await coverageGlobal('"session"')).defined, "the stale node was cleared").toBe(false);
      const after = await monitorState();
      expect(after.active, "the foreign session is still active").toBe(1);
      expect(after.pids, "with the same process list").toBe(before.pids);
      expect(after.count, "and the same routines").toBe(1);
      expect(await runCounter(), "no run id was allocated").toBe(counter);

      expect(await fixtureCall("StopIfList", [FOREIGN_ROUTINES])).toBe("stopped");
      stopped = true;
    } finally {
      if (!stopped) await fixtureCall("StopIfList", [FOREIGN_ROUTINES]);
    }
    await expectIdle("clear-busy-foreign");
  }, 240000);

  it("all-processes foreign session (decision #49): a session of ALL processes started by someone else is refused as foreign and left active, the stale ownership node is kept because that session has no process list of its own, and once it has ended the next start clears the node and completes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 20);
    const running = await startSlow();
    await killBothJobs(running);
    // The suite's own session is stopped (the fixture proves it is the suite's), leaving the stale ownership node.
    expect(await fixtureCall("StopIfList", [SUITE_ROUTINES])).toBe("stopped");
    expect((await coverageGlobal('"session"')).defined, "the stale node is still there").toBe(true);
    let stopped = false;
    try {
      // The one all-processes session of the suite, on the fixture's own routine that nobody else runs, started with the
      // monitor idle; this row stops it below and asserts the monitor idle afterwards.
      expect(await fixtureCall("StartForeignAll")).toMatch(/^started:\d+$/);
      const before = await monitorState();
      expect(before.active).toBe(1);
      expect(before.pids, "a session of all processes has no scoped process list, so the suite reads none").toBe("");
      const counter = await runCounter();

      const refused = await coverage();
      expect(refused.isError, allText(refused)).toBe(true);
      expect(refused.structuredContent).toEqual({ code: "MONITOR_BUSY", owner: "foreign" });
      const after = await monitorState();
      expect(after.active, "the all-processes session is still active").toBe(1);
      expect(after.pids, "with no scoped process list").toBe("");
      expect(after.count, "and the same routine").toBe(1);
      expect([FOREIGN_ROUTINES, ""], "each name either unreadable here or exactly the foreign session's").toContain(after.routines[0]);
      expect((await coverageGlobal('"session"')).defined, "the ownership node is kept: this session's process list cannot disprove it").toBe(true);
      expect(await runCounter(), "no run id was allocated").toBe(counter);

      expect(await fixtureCall("StopIfList", [FOREIGN_ROUTINES])).toBe("stopped");
      stopped = true;
    } finally {
      if (!stopped) await fixtureCall("StopIfList", [FOREIGN_ROUTINES]);
    }
    await expectIdle("the all-processes session, after it was stopped");
    expect((await coverageGlobal('"session"')).defined, "the node outlived the foreign session").toBe(true);

    const next = succeeded<CoverageContent>(await coverage());
    expect(next.status).toBe("completed");
    expect(next, "nothing was reclaimed: the dead run's session had already ended").not.toHaveProperty("reclaimed");
    expect((await coverageGlobal(`"run",${running.coverageRunId},"status"`)).value, "the idle monitor cleared the node and recorded the dead run abandoned").toBe("abandoned");
    await expectIdle("all-processes foreign session");
  }, 300000);

  it("clear-and-proceed: a stale node with the monitor idle does not block a start, the dead run is recorded abandoned, and the new run completes without reclaiming anything", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 20);
    const running = await startSlow();
    await killBothJobs(running);
    expect(await fixtureCall("StopIfList", [SUITE_ROUTINES])).toBe("stopped");
    expect((await coverageGlobal('"session"')).defined, "the stale node is still there").toBe(true);
    expect((await coverageGlobal(`"run",${running.coverageRunId},"status"`)).value, "the dead run is still recorded as running").toBe("running");

    const next = succeeded<CoverageContent>(await coverage());
    expect(next.status).toBe("completed");
    expect(next, "nothing was reclaimed: the dead run's session had already ended").not.toHaveProperty("reclaimed");
    expect((await coverageGlobal(`"run",${running.coverageRunId},"status"`)).value, "the dead run is now recorded abandoned").toBe("abandoned");
    await expectIdle("clear-and-proceed");
  }, 240000);

  it("retention: with 25 finished run records ahead of the real ones, a start prunes the run records to 20", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    try {
      expect(await fixtureCall("SeedRunRecords", [25])).toBe("25");
      expect(Number(await fixtureCall("RunRecordCount")), "more than 20 records before the start").toBeGreaterThan(20);
      const result = succeeded<CoverageContent>(await coverage());
      expect(result.status).toBe("completed");
      // The start pruned to its limit of 20, oldest first: the fakes (ids -1001 to -1025) sort before every real run.
      expect(Number(await fixtureCall("RunRecordCount")), "20 records after it").toBe(20);
      expect((await coverageGlobal('"run",-1025,"status"')).defined, "the oldest fake record is gone").toBe(false);
    } finally {
      await fixtureCall("ClearFakeRuns");
    }
    await expectIdle("retention");
  }, 240000);
});

// -- Rows 10 and 11: a foreign session, a running suite run ------------------------------

describe("Story 40.1: the monitor is instance-wide, so a foreign session and a running suite run both refuse a new run (AC-2, AC-4, matrix rows 10 and 11)", () => {
  it("row 10: a session the suite did not start is refused as foreign, left untouched, and no run id is allocated: the next started run's id is the previous one plus 1", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const started = await fixtureCall("StartForeign");
    expect(started).toMatch(/^started:\d+$/);
    let stopped = false;
    try {
      const before = await monitorState();
      expect(before.active).toBe(1);
      const counter = await runCounter();

      const refused = await coverage();
      expect(refused.isError, allText(refused)).toBe(true);
      expect(refused.structuredContent).toEqual({ code: "MONITOR_BUSY", owner: "foreign" });
      expect(allText(refused)).toContain("nothing was started");
      expect(allText(refused)).toContain("left untouched");

      const after = await monitorState();
      expect(after.active, "the foreign session is still active").toBe(1);
      expect(after.pids, "with the same process list").toBe(before.pids);
      expect(after.count, "and the same number of routines").toBe(1);
      expect(after.count).toBe(before.count);
      expect(after.routines, "and one routine, each name either unreadable here or exactly the foreign session's").toHaveLength(1);
      expect([FOREIGN_ROUTINES, ""], "a request process outside the session's process list reads the name as empty").toContain(after.routines[0]);
      expect(await runCounter(), "no run id was allocated").toBe(counter);

      expect(await fixtureCall("StopIfList", [FOREIGN_ROUTINES])).toBe("stopped");
      stopped = true;
      await expectIdle("row 10, after the foreign session was stopped");

      const next = succeeded<CoverageContent>(await coverage());
      expect(next.status).toBe("completed");
      expect(next.coverageRunId, "the refusal allocated no run id, so the next run's is the previous one plus 1").toBe(counter + 1);
    } finally {
      if (!stopped) await fixtureCall("StopIfList", [FOREIGN_ROUTINES]);
    }
    await expectIdle("row 10");
  }, 180000);

  it("row 11: a second call while a suite run is running is refused as MONITOR_BUSY owner suite with that run's handles, allocating no run id, and the running run is unaffected", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 20);
    const first = await startSlow();
    try {
      const counter = await runCounter();
      expect(counter, "the running run holds the newest run id").toBe(first.coverageRunId);
      const refused = await coverage();
      expect(refused.isError, allText(refused)).toBe(true);
      expect(refused.structuredContent).toEqual({
        code: "MONITOR_BUSY",
        owner: "suite",
        coverageRunId: first.coverageRunId,
        pid: first.pid,
        startedAt: first.startedAt,
        namespace: NS_A,
      });
      expect(allText(refused)).toContain("iris_test_status");
      expect(allText(refused)).toContain("poll");
      expect(await runCounter(), "the refusal allocated no run id").toBe(counter);

      const still = succeeded<CoverageContent>(await poll(first.coverageRunId));
      expect(still.status, "the running run is unaffected by the refused call").toBe("running");
      expect((await monitorState()).active).toBe(1);
    } finally {
      const cancelled = await dev.raw("iris_test_status", { action: "cancel", coverageRunId: String(first.coverageRunId) });
      expect(cancelled.structuredContent).toMatchObject({ status: "cancelled", reason: "cancel" });
    }
    await expectIdle("row 11");
  }, 180000);
});

// -- Rows 13 and 14: the time limit and the default governance ---------------------

describe("Story 40.1: the time limit ends a run, and the tool is disabled by default (AC-3, AC-6, matrix rows 13 and 14)", () => {
  it("row 13: a start with maxSeconds 2 on a 20 second test ends cancelled with reason time-limit, and the monitor is idle", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 20);
    const answer = await executeMcpPost(TARGET, "/dev/test/coverage", {
      target: "Story401.SlowTest",
      level: "class",
      classes: ["Story401.Fixture"],
      namespace: NS_A,
      maxSeconds: 2,
      maxLines: 200000,
    });
    const body = JSON.parse(answer.text) as { result?: { outcome?: string; coverageRunId?: number } };
    expect(body.result?.outcome).toBe("started");
    const run = await rawUntilTerminal(Number(body.result?.coverageRunId));
    expect(run["status"]).toBe("cancelled");
    expect(run["reason"]).toBe("time-limit");
    await expectIdle("row 13");
  }, 180000);

  it("row 14: a plain session, with no governance override, is refused with GOVERNANCE_DISABLED and no route is called", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const before = await runCounter();
    const refused = await devPlain.call("iris_test_coverage", {
      target: "Story401.FixtureTest",
      level: "class",
      classes: ["Story401.Fixture"],
      namespace: NS_A,
    });
    expect(refused.isError, allText(refused)).toBe(true);
    expect(refused.structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED" });
    expect(await runCounter(), "no run id was allocated").toBe(before);
    await expectIdle("row 14");
  }, 120000);
});
