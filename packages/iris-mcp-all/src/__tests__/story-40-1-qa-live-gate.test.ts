/**
 * Story 40.1 (QA) live gate: what the implement stage's gate leaves open on the BUILT dev server, in the default suite
 * (Rules #34, #36, #41, #46, #54, #59).
 *
 * Path: the BUILT iris-dev-mcp and iris-admin-mcp dists, each spawned as its own child process and driven by the MCP SDK
 * `Client` over stdio, with several dev server PROCESSES alive at once (one that starts a run, one that polls it, one
 * per preset). The oracles are the matrix values of the Story 40.1 spec (captured live, `coverage-fixture.ts`), the INT
 * source of the measured routine read through the raw Atelier document route, SQL written by hand and run through the
 * raw Atelier `action/query` route, raw HTTP to the coverage Status route, and the monitor read through the fixture
 * class; never the tools under test.
 *
 * Rows:
 *  - Visibility and default governance (AC-6): a default (`full`) dev server lists `iris_test_coverage` with the spec's
 *    annotations and refuses the call as GOVERNANCE_DISABLED; `core` hides it, even with the tool enabled, and the call is
 *    an unknown tool; `developer` lists it and still refuses it. Nothing is started by any of them.
 *  - The documented recipe `IRIS_GOVERNANCE={"global":{"iris_test_coverage":true}}` alone enables the tool: the oracle
 *    run (28 executable INT lines, 20 covered, 71.43%) completes, the covered and uncovered lines are lines of the INT
 *    source that the hand-written table below names, a SECOND server process on default governance polls the handle
 *    and reproduces the result (AD-16), and the recipe does not enable the companion's cancel.
 *  - A client that goes away: the server process that started a run is closed while the run is executing; a fresh process
 *    re-attaches by the handle alone and the run completes with the right values (AD-16, "never re-submit").
 *  - MONITOR_BUSY from another process while a suite run is active, for any arguments and any namespace; the running run
 *    is unaffected and completes with its own coverage, and a refused cancel does not signal it.
 *  - Input edges: every schema rule of `classes`, `level` and `timeout` as the built server reports it, the 50-name
 *    boundary, names that resolve to nothing, a method that does not exist, a namespace that does not exist, and a second
 *    namespace (`EXECMCPTMP40T`) with different classes whose result differs from the first's.
 *  - Companion edges against a real run record: `coverageRunId` with `jobId`, an unknown id, a malformed id and a
 *    namespace other than the record's.
 *
 * This gate starts Line-by-Line sessions too (the package runs its files serially) and starts every row with the monitor
 * idle: when a session it did not start is active, an armed gate fails and names it, an unarmed one skips, and the
 * session is left alone. It terminates no process. Every row ends by asserting the monitor is idle.
 *
 * Fixtures: the disposable namespaces `EXECMCPTMP40S` (the `Story401` oracle classes and `Story401Q.Empty`) and
 * `EXECMCPTMP40T` (`Story401Q.Tiny` and its test), both without Interoperability, their database files, and the HSCUSTOM
 * class `ExecuteMCPv2.Temp.Story391Fixture`, all removed in `afterAll`, which also asserts nothing is left and the
 * monitor is idle. The only global written outside them is the coverage service's own `^IRIS.TempExecuteMCPv2Coverage`.
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
  FIXTURE_DOC,
  createInteropNamespace,
  leftovers,
  putCompileSeed,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
} from "./interop-namespace-fixture.js";
import { monitorGate, sleep } from "./monitor-gate-helpers.js";
import {
  STORY401_FIXTURE_SOURCE,
  STORY401_FIXTURE_TEST_SOURCE,
  STORY401_ORACLE_ROUTINE,
  STORY401_SLOW_ROUTINE,
  STORY401_SLOW_TEST_SOURCE,
} from "./coverage-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-1-qa-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The scratch namespace holding the oracle classes, and the second one holding different classes. */
const NS_S = "EXECMCPTMP40S";
const NS_T = "EXECMCPTMP40T";
const NAMESPACES = [NS_S, NS_T];

/** A well-formed namespace name that is never created. */
const NS_NONE = "EXECMCPTMP40Z";

/** The recipe the tool's description gives an operator, byte for byte: it enables the tool and nothing else. */
const RECIPE = '{"global":{"iris_test_coverage":true}}';

/** The route below the web port, for raw HTTP. */
const COVERAGE_ROUTE = "/api/executemcp/v2/dev/test/coverage";

/** The routines of the sessions this gate may see: the oracle class's in S, the tiny class's in T. */
const SUITE_ROUTINES = ["Story401.Fixture.1", "Story401Q.Tiny.1", "Story401.FixtureTest.1"];

/** The annotations the Boundaries fix for `iris_test_coverage`. */
const COVERAGE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

/**
 * The seed compiled into S and into T: it sets the hang of `Story401.SlowTest` (read from `^Story401Hang`), and
 * refuses any namespace but `EXECMCPTMP40` and one capital letter.
 */
const QA_SEED_DOC = "Story401Q.Seed.cls";
const QA_SEED_SOURCE = String.raw`/// Seed of the Story 40.1 QA fixture namespaces.
Class Story401Q.Seed
{

/// Set the hang of Story401.SlowTest to its default of 3 seconds; returns the JSON map of what was set.
ClassMethod Seed() As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP40"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP40 followed by one capital letter" }
    Set ^Story401Hang = 3
    Quit "{""hang"":""3""}"
}

/// Set how long Story401.SlowTest hangs, in seconds.
ClassMethod SetHang(pSeconds As %Integer) As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP40"1U { Quit "REFUSED: SetHang runs only in a namespace named EXECMCPTMP40 followed by one capital letter" }
    Set ^Story401Hang = +pSeconds
    Quit +pSeconds
}

}
`;

/** A class with no member, so it compiles no routine. */
const EMPTY_DOC = "Story401Q.Empty.cls";
const EMPTY_SOURCE = String.raw`/// A class with no member (Story 40.1 QA).
Class Story401Q.Empty
{

}
`;

/** The second namespace's class and its test. */
const TINY_DOC = "Story401Q.Tiny.cls";
const TINY_SOURCE = String.raw`/// Synthetic second-namespace coverage fixture (Story 40.1 QA).
Class Story401Q.Tiny
{

ClassMethod Double(pN As %Integer) As %Integer
{
    Set tResult = pN * 2
    Quit tResult
}

}
`;
const TINY_TEST_DOC = "Story401Q.TinyTest.cls";
const TINY_TEST_SOURCE = String.raw`/// Test of the second-namespace fixture (Story 40.1 QA).
Class Story401Q.TinyTest Extends %UnitTest.TestCase
{

Method TestDouble()
{
    Do $$$AssertEquals(##class(Story401Q.Tiny).Double(4), 8, "Double(4)")
}

}
`;

const S_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story401.Fixture.cls", STORY401_FIXTURE_SOURCE],
  ["Story401.FixtureTest.cls", STORY401_FIXTURE_TEST_SOURCE],
  ["Story401.SlowTest.cls", STORY401_SLOW_TEST_SOURCE],
  [EMPTY_DOC, EMPTY_SOURCE],
  [QA_SEED_DOC, QA_SEED_SOURCE],
];
const T_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  [TINY_DOC, TINY_SOURCE],
  [TINY_TEST_DOC, TINY_TEST_SOURCE],
  [QA_SEED_DOC, QA_SEED_SOURCE],
];

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
/** Enabled by the recipe alone: the session that runs the fixture calls and the rows' primary runs. */
let dev: WireSession;
/** Default governance and default preset. */
let devPlain: WireSession;
let admin: WireSession;

const { monitorState, runCounter, expectMonitorInactive, releaseLeftoverSession } = monitorGate({
  dev: () => dev,
  suiteRoutineSets: SUITE_ROUTINES,
});

function wireOptions(pkg: string): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "story-40-1-qa-live-gate",
  };
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
  reason?: string;
  error?: string;
  hint?: string;
  partial?: Record<string, unknown>;
  reclaimed?: { coverageRunId: number; pid: number | null };
  coverage?: {
    complete: boolean;
    classes: Array<{ class: string; routines: RoutineValues[] }>;
    unmeasured: Array<{ class: string; reason: string }>;
  };
}

/** The structured content of a tool call that must not be an error. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

/** Set how long `Story401.SlowTest` hangs in S, in seconds. */
async function setHang(seconds: number): Promise<void> {
  const result = await dev.call("iris_execute_classmethod", {
    namespace: NS_S,
    className: "Story401Q.Seed",
    methodName: "SetHang",
    args: [seconds],
  });
  expect(result.isError, allText(result)).toBeFalsy();
  expect(String(result.structuredContent?.["returnValue"] ?? "")).toBe(String(seconds));
}

/** `iris_test_coverage` over S for the oracle run, with `overrides`, on `session` (the recipe-enabled `dev` unless given). */
function coverage(overrides: Record<string, unknown> = {}, session: WireSession = dev): Promise<WireToolResult> {
  return session.call("iris_test_coverage", {
    target: "Story401.FixtureTest",
    level: "class",
    classes: ["Story401.Fixture"],
    namespace: NS_S,
    ...overrides,
  });
}

/** A start of `Story401.SlowTest` with a 1 second budget: returns the `running` result. */
async function startSlow(session: WireSession = dev): Promise<CoverageContent> {
  const content = succeeded<CoverageContent>(await coverage({ target: "Story401.SlowTest", timeout: 1 }, session));
  expect(content.status, "the budget expired with the run still executing").toBe("running");
  return content;
}

/** The companion's poll by the handle alone: through the session's `raw` call, so no namespace is sent. */
function poll(session: WireSession, coverageRunId: number): Promise<WireToolResult> {
  return session.raw("iris_test_status", { action: "poll", coverageRunId: String(coverageRunId) });
}

/** Poll until the run's status is one of `statuses`, or fail after `timeoutMs`. */
async function pollUntil(session: WireSession, coverageRunId: number, statuses: readonly string[], timeoutMs = 60000): Promise<WireToolResult> {
  const deadline = Date.now() + timeoutMs;
  let last: WireToolResult | undefined;
  while (Date.now() < deadline) {
    last = await poll(session, coverageRunId);
    const status = (last.structuredContent as { status?: string } | undefined)?.status;
    if (status !== undefined && statuses.includes(status)) return last;
    await sleep(400);
  }
  throw new Error(`coverage run ${coverageRunId} did not reach ${statuses.join(" or ")} within ${timeoutMs} ms: ${allText(last ?? {})}`);
}

/** The Status route of the service, raw: the run record. */
async function rawStatus(coverageRunId: number): Promise<Record<string, unknown>> {
  const answer = await rawIrisRequest(TARGET, `${COVERAGE_ROUTE}?id=${coverageRunId}`, { method: "GET" });
  expect(answer.status).toBe(200);
  return ((answer.json as { result?: Record<string, unknown> } | undefined)?.result ?? {}) as Record<string, unknown>;
}

/** The routines of the first measured class of a coverage object. */
function routinesOf(content: CoverageContent): RoutineValues[] {
  return content.coverage?.classes[0]?.routines ?? [];
}

/**
 * The text lines of a coverage result as Story 40.1 returned them: Story 40.2 adds the class-source lines (a class line, and an
 * indented method line for each method with an uncovered line) between the status line and the routine lines, so they are removed here
 * and every other line is compared as before.
 */
function withoutClassSourceLines(lines: string[]): string[] {
  return lines.filter(
    (line) =>
      !/^\S+: \d+ of \d+ class lines covered \(/.test(line) &&
      !/^\S+: no (executable class lines|class-source coverage)/.test(line) &&
      !/^ {2}\S+: \d+ of \d+ \([\d.]+%\); uncovered /.test(line),
  );
}

/** The classes of a coverage object as Story 40.1 returned them: without the `source` that Story 40.2 adds to each class. */
function classesWithoutSource(content: CoverageContent): unknown[] {
  return (content.coverage?.classes ?? []).map((entry) => {
    const { source: _source, ...rest } = entry as typeof entry & { source?: unknown };
    return rest;
  });
}

/** The INT source of a routine, one string per line, read through the raw Atelier document route (the oracle for line numbers). */
async function intSource(namespace: string, routine: string): Promise<string[]> {
  const answer = await rawIrisRequest(TARGET, `/api/atelier/v1/${namespace}/doc/${routine}.int`, { method: "GET" });
  expect(answer.status, `reading ${routine}.int in ${namespace}`).toBe(200);
  const content = (answer.json as { result?: { content?: unknown } } | undefined)?.result?.content;
  expect(Array.isArray(content), `${routine}.int has line content`).toBe(true);
  return content as string[];
}

/** Open a further dev server process with `extraEnv` on top of the connection settings; the caller closes it. */
function openDev(extraEnv: Record<string, string>): Promise<WireSession> {
  return openWireSession(wireOptions("iris-dev-mcp"), extraEnv);
}

// -- Setup and teardown ------------------------------------------------

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared");
  for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    } else if (!(await isIrisReachable(TARGET.host, TARGET.port))) {
      skipReason = `IRIS is not reachable at http://${TARGET.host}:${TARGET.port}/api/atelier/ (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.1 QA live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  dev = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_GOVERNANCE: RECIPE });
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
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
    if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.1 QA live gate may not be skipped: ${named}`);
    skipReason = named;
    return;
  }

  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);
  await createInteropNamespace(admin, dev, NS_S, { interop: false });
  await createInteropNamespace(admin, dev, NS_T, { interop: false });
  await putCompileSeed(dev, NS_S, S_DOCUMENTS, { className: "Story401Q.Seed", args: [] }, { hang: "3" }, "the QA coverage fixture");
  await putCompileSeed(dev, NS_T, T_DOCUMENTS, { className: "Story401Q.Seed", args: [] }, { hang: "3" }, "the QA second-namespace fixture");

  // A positive control: the same check that must read empty after the run sees both namespaces now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees both namespaces while they exist").toEqual(
    expect.arrayContaining([`namespace ${NS_S}`, `database configuration ${NS_S}`, `namespace ${NS_T}`, `database configuration ${NS_T}`]),
  );
}, 300000);

afterEach(async () => {
  if (skipReason) return;
  // A row that fails must not leave its session behind for the rows after it.
  await releaseLeftoverSession();
});

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const { problems, attempt } = teardownRecorder();
  try {
    await attempt("stopping a coverage session left behind", releaseLeftoverSession);
    await attempt("the monitor is idle", async () => {
      expect((await monitorState()).active, "the monitor is idle after the run").toBe(0);
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

/** The arguments of the oracle run over S: `Story401.FixtureTest` measuring `Story401.Fixture`. */
const ORACLE_ARGS = { target: "Story401.FixtureTest", level: "class", classes: ["Story401.Fixture"], namespace: NS_S } as const;

/** The hand-written SQL oracle for the tests of run `runIndex` in `namespace`, never the tool under test. */
async function testRows(namespace: string, runIndex: number): Promise<Array<[unknown, number]>> {
  const rows = await atelierQuery(
    { ...TARGET, namespace },
    "SELECT tm.Name AS MethodName, tm.Status FROM %UnitTest_Result.TestMethod tm JOIN %UnitTest_Result.TestCase tc ON tm.TestCase = tc.ID " +
      "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID JOIN %UnitTest_Result.TestInstance ti ON ts.TestInstance = ti.ID " +
      `WHERE ti.InstanceIndex = ${runIndex} ORDER BY tm.Name`,
  );
  return rows.map((row) => [row["MethodName"], Number(row["Status"])]);
}

/**
 * The monitor's INT line n is line n + 1 of the document `iris_doc_get` returns for `<routine>.int`: document line 1 is
 * the `ROUTINE <name> [Type=INT,Generated]` header, which the monitor does not count. The tool's `lines` is therefore
 * the document's line count minus 1.
 */
const INT_LINE_OFFSET = 1;

/**
 * The executable INT lines of `Story401.Fixture.1` that `Story401.FixtureTest` never reaches, derived by hand from the
 * test source: it calls Classify(5), Classify(0), SumTo(3), Guarded(0) and Loop(2), and never Classify(-1), Guarded(1),
 * Exercise or Unused. Each entry is the INT line and a fragment of the source line at that number.
 */
const ORACLE_UNCOVERED: ReadonlyArray<readonly [number, string]> = [
  [8, 'Set tResult = "negative"'],
  [16, "Do ..Classify(5)"],
  [17, "Do ..SumTo(3)"],
  [18, "Quit 1 }"],
  [23, "Throw ##class(%Exception.General)"],
  [27, 'Set tOut = "caught"'],
  [47, "Set tX = 1"],
  [48, "Quit tX }"],
];

/** Every line of inclusive `[start, end]` ranges. */
function expandRanges(ranges: readonly (readonly number[])[]): number[] {
  const lines: number[] = [];
  for (const [start, end] of ranges) for (let line = start as number; line <= (end as number); line++) lines.push(line);
  return lines;
}

// -- Visibility and default governance (AC-6, matrix row 14) -----------------------

describe("Story 40.1 QA: visibility and default governance on the built dev server (AC-6)", () => {
  it("a default dev server lists iris_test_coverage with the Boundaries' annotations and the companion's coverageRunId, and refuses the call as GOVERNANCE_DISABLED, starting nothing", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const tools = await devPlain.listTools();
    const listed = tools.find((tool) => tool.name === "iris_test_coverage");
    expect(listed, "the default preset is full, so the write tool is listed even though governance disables it").toBeDefined();
    expect(listed?.annotations).toEqual(COVERAGE_ANNOTATIONS);
    expect(listed?.inputSchema.required).toEqual(["target", "level", "classes"]);
    expect(Object.keys(listed?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["target", "level", "classes", "timeout", "namespace"]),
    );
    const companion = tools.find((tool) => tool.name === "iris_test_status");
    expect(Object.keys(companion?.inputSchema.properties ?? {}), "the companion gained the optional handle").toContain("coverageRunId");
    expect(companion?.inputSchema.required ?? [], "and it stays optional: an old jobId or runIndex call still validates").not.toContain("coverageRunId");

    const before = await runCounter();
    const refused = await devPlain.call("iris_test_coverage", ORACLE_ARGS);
    expect(refused.isError, allText(refused)).toBe(true);
    expect(refused.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_test_coverage", server: "default" });
    expect(await runCounter(), "no run id was allocated").toBe(before);
    await expectMonitorInactive("default governance");
  }, 120000);

  it("the core preset hides iris_test_coverage even when the recipe enables it, and the call is an unknown tool that starts nothing", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const defaultNames = (await devPlain.listTools()).map((tool) => tool.name);
    const before = await runCounter();
    const core = await openDev({ IRIS_TOOLS_PRESET: "core", IRIS_GOVERNANCE: RECIPE });
    try {
      const coreNames = (await core.listTools()).map((tool) => tool.name);
      expect(coreNames, "core does not list the coverage tool").not.toContain("iris_test_coverage");
      expect(coreNames, "core keeps the everyday test loop").toContain("iris_execute_tests");
      expect(defaultNames.filter((name) => !coreNames.includes(name)), "the coverage tool is among what core hides").toContain("iris_test_coverage");
      expect(coreNames.filter((name) => !defaultNames.includes(name)), "core adds nothing the default list lacks").toEqual([]);

      const called = await core.call("iris_test_coverage", ORACLE_ARGS);
      expect(called.isError, allText(called)).toBe(true);
      expect(allText(called)).toContain("Tool iris_test_coverage not found");
    } finally {
      await core.close();
    }
    expect(await runCounter(), "enabling a hidden tool starts nothing").toBe(before);
    await expectMonitorInactive("core preset");
  }, 120000);

  it("the developer preset lists iris_test_coverage, and default governance still refuses it", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const before = await runCounter();
    const developer = await openDev({ IRIS_TOOLS_PRESET: "developer" });
    try {
      const names = (await developer.listTools()).map((tool) => tool.name);
      expect(names).toContain("iris_test_coverage");
      expect(names).toContain("iris_test_status");
      const refused = await developer.call("iris_test_coverage", ORACLE_ARGS);
      expect(refused.isError, allText(refused)).toBe(true);
      expect(refused.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_test_coverage", server: "default" });
    } finally {
      await developer.close();
    }
    expect(await runCounter(), "no run id was allocated").toBe(before);
    await expectMonitorInactive("developer preset");
  }, 120000);
});

// -- The documented recipe, end to end, across server processes (AC-1, AC-5) ---------

describe("Story 40.1 QA: the documented recipe alone enables the tool, and a second server process re-reads the result (AC-1, AC-5)", () => {
  it("the oracle run completes with 20 of 28 lines (71.43%), its uncovered lines are the code the tests never call, a default-governance process reproduces it by the handle, and the recipe does not enable the companion's cancel", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await coverage();
    const run = succeeded<CoverageContent>(result);
    expect(run).toMatchObject({ status: "completed", total: 4, passed: 4, failed: 0, skipped: 0, namespace: NS_S, target: "Story401.FixtureTest", level: "class" });
    expect(run.coverage?.complete).toBe(true);
    expect(run.coverage?.classes.map((entry) => entry.class)).toEqual(["Story401.Fixture"]);
    expect(routinesOf(run)).toEqual([STORY401_ORACLE_ROUTINE]);
    expect(run.coverage?.unmeasured).toEqual([]);
    expect(run).not.toHaveProperty("reclaimed");
    expect(typeof run.runIndex).toBe("number");
    expect(withoutClassSourceLines(allText(result).split("\n"))).toEqual([
      `Coverage run ${run.coverageRunId} completed: 4 tests, 4 passed, 0 failed, 0 skipped.`,
      "Story401.Fixture.1: 20 of 28 executable INT lines covered (71.43%); uncovered 8, 16-18, 23, 27, 47-48",
    ]);
    expect(await testRows(NS_S, run.runIndex as number), "the tests the summary counts, by hand-written SQL in the run's namespace").toEqual([
      ["TestClassify", 1],
      ["TestGuarded", 1],
      ["TestLoop", 1],
      ["TestSumTo", 1],
    ]);

    // The line numbers mean what the hand table says: read the routine's source through the raw document route.
    const source = await intSource(NS_S, "Story401.Fixture.1");
    expect(source.length - INT_LINE_OFFSET, "lines is the document's line count minus its ROUTINE header").toBe(48);
    expect(source[0], "document line 1 is the header the monitor does not count").toMatch(/^ROUTINE Story401\.Fixture\.1 \[Type=INT/);
    const executable = expandRanges(routinesOf(run)[0]?.executableRanges ?? []);
    const covered = expandRanges(routinesOf(run)[0]?.coveredRanges ?? []);
    for (const [line, fragment] of ORACLE_UNCOVERED) {
      expect(source[line - 1 + INT_LINE_OFFSET], `INT line ${line} is document line ${line + INT_LINE_OFFSET}`).toContain(fragment);
      expect(source[line - 1], `document line ${line} is not INT line ${line}`).not.toContain(fragment);
      expect(executable, `INT line ${line} is executable`).toContain(line);
      expect(covered, `INT line ${line} is not covered: no test calls that code`).not.toContain(line);
    }
    expect(
      executable.filter((line) => !ORACLE_UNCOVERED.some(([uncovered]) => uncovered === line)),
      "every other executable line is covered, and nothing else",
    ).toEqual(covered);

    // A second server process, on default governance, reads the handle from IRISTEMP: the result is reproduced exactly.
    const polled = await poll(devPlain, run.coverageRunId);
    expect(polled.isError, allText(polled)).toBeFalsy();
    expect(polled.structuredContent).toEqual(result.structuredContent);
    expect(allText(polled)).toBe(allText(result));

    // The recipe enabled iris_test_coverage and nothing else: the companion's cancel is its own key, still disabled.
    for (const session of [dev, devPlain]) {
      const cancel = await session.raw("iris_test_status", { action: "cancel", coverageRunId: String(run.coverageRunId) });
      expect(cancel.isError, allText(cancel)).toBe(true);
      expect(cancel.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_test_status:cancel", server: "default" });
    }
    expect((await poll(devPlain, run.coverageRunId)).structuredContent, "a refused cancel changes nothing").toEqual(result.structuredContent);
    await expectMonitorInactive("the recipe run");
  }, 180000);
});

// -- A client that goes away (AD-16) --------------------------------------------

describe("Story 40.1 QA: a run belongs to the instance, not to the server process that started it (AD-16)", () => {
  it("the starting server process is closed while the run executes; a fresh process re-attaches by the handle alone and the run completes with its own coverage, released by its runner", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setHang(6);
    const starter = await openDev({ IRIS_GOVERNANCE: RECIPE });
    let running: CoverageContent;
    try {
      running = await startSlow(starter);
    } finally {
      await starter.close();
    }
    expect(running.coverageRunId).toBeGreaterThan(0);
    expect((await monitorState()).active, "the run goes on in IRIS after the process that started it has ended").toBe(1);

    const first = await pollUntil(devPlain, running.coverageRunId, ["completed"]);
    const done = succeeded<CoverageContent>(first);
    expect(done).toMatchObject({
      status: "completed",
      coverageRunId: running.coverageRunId,
      total: 1,
      passed: 1,
      failed: 0,
      namespace: NS_S,
      target: "Story401.SlowTest",
    });
    expect(done.coverage?.complete).toBe(true);
    expect(routinesOf(done), "only SumTo(3) ran before the hang").toEqual([STORY401_SLOW_ROUTINE]);
    expect(await testRows(NS_S, done.runIndex as number), "the test the summary counts, by hand-written SQL").toEqual([["TestSlow", 1]]);
    expect((await poll(devPlain, running.coverageRunId)).structuredContent, "a second poll deep-equals the first").toEqual(first.structuredContent);

    const record = await rawStatus(running.coverageRunId);
    expect(record["releasedBy"], "the runner stopped its own session").toBe("runner");
    expect(record["cancelRequested"]).toBe(false);
    await expectMonitorInactive("re-attach");
  }, 240000);
});

// -- MONITOR_BUSY from another process; the running run is unaffected (matrix row 11) --

describe("Story 40.1 QA: a busy refusal reaches every other server process and leaves the running run alone (AC-4)", () => {
  it("a second server process is refused as MONITOR_BUSY owner suite for any arguments and any namespace, its cancel is refused by governance, and the running run completes with its own coverage", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // Long enough that the run is still executing after a second server process has started and made five calls.
    await setHang(15);
    const first = await startSlow();
    const second = await openDev({ IRIS_GOVERNANCE: RECIPE });
    try {
      const counter = await runCounter();
      expect(counter, "the running run holds the newest run id").toBe(first.coverageRunId);
      const expected = {
        code: "MONITOR_BUSY",
        owner: "suite",
        coverageRunId: first.coverageRunId,
        pid: first.pid,
        startedAt: first.startedAt,
        namespace: NS_S,
      };

      const sameNamespace = await coverage({}, second);
      expect(sameNamespace.isError, allText(sameNamespace)).toBe(true);
      expect(sameNamespace.structuredContent).toEqual(expected);
      expect(allText(sameNamespace)).toContain("nothing was started");
      expect(allText(sameNamespace)).toContain(`iris_test_status (action "poll", coverageRunId "${first.coverageRunId}")`);

      const otherNamespace = await coverage({ target: "Story401Q.TinyTest", classes: ["Story401Q.Tiny"], namespace: NS_T }, second);
      expect(otherNamespace.isError, allText(otherNamespace)).toBe(true);
      expect(otherNamespace.structuredContent, "the monitor is instance-wide: the answer names the running run, not the refused call's namespace").toEqual(expected);

      const cancel = await second.raw("iris_test_status", { action: "cancel", coverageRunId: String(first.coverageRunId) });
      expect(cancel.isError, allText(cancel)).toBe(true);
      expect(cancel.structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED", action: "iris_test_status:cancel" });

      expect(await runCounter(), "the refusals allocated no run id").toBe(counter);
      const midway = await rawStatus(first.coverageRunId);
      expect(midway["status"], "the run is still executing").toBe("running");
      expect(midway["cancelRequested"], "no refusal signalled it").toBe(false);
      expect((await monitorState()).active).toBe(1);
    } finally {
      await second.close();
    }

    const done = succeeded<CoverageContent>(await pollUntil(devPlain, first.coverageRunId, ["completed"]));
    expect(done).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0, coverageRunId: first.coverageRunId });
    expect(done).not.toHaveProperty("reclaimed");
    expect(routinesOf(done), "the run kept its own counts").toEqual([STORY401_SLOW_ROUTINE]);
    const record = await rawStatus(first.coverageRunId);
    expect(record["releasedBy"]).toBe("runner");
    expect(record["cancelRequested"]).toBe(false);
    await expectMonitorInactive("busy");
  }, 240000);
});

// -- Input edges (matrix rows 2 to 4) ----------------------------------------------

interface SchemaCase {
  label: string;
  overrides: Record<string, unknown>;
  code: string;
  path: string;
  message?: string;
}

/** What the built server's schema layer rejects, and the zod issue it reports for each. */
const SCHEMA_CASES: readonly SchemaCase[] = [
  { label: "no classes", overrides: { classes: [] }, code: "too_small", path: "classes" },
  {
    label: "51 classes",
    overrides: { classes: Array.from({ length: 51 }, (_, index) => `Story401.Fixture${index}`) },
    code: "too_big",
    path: "classes",
  },
  { label: "a trailing wildcard", overrides: { classes: ["Story401.*"] }, code: "invalid_format", path: "classes", message: "no wildcards, no commas" },
  { label: "a percent wildcard", overrides: { classes: ["Story401.Fix%"] }, code: "invalid_format", path: "classes", message: "no wildcards, no commas" },
  {
    label: "a comma list",
    overrides: { classes: ["Story401.Fixture,Story401.FixtureTest"] },
    code: "invalid_format",
    path: "classes",
    message: "no wildcards, no commas",
  },
  { label: "an empty name", overrides: { classes: [""] }, code: "invalid_format", path: "classes", message: "no wildcards, no commas" },
  { label: "a doubled dot", overrides: { classes: ["Story401..Fixture"] }, code: "invalid_format", path: "classes", message: "no wildcards, no commas" },
  { label: "a level that is not package, class or method", overrides: { level: "suite" }, code: "invalid_value", path: "level" },
  { label: "a zero timeout", overrides: { timeout: 0 }, code: "too_small", path: "timeout" },
  { label: "a negative timeout", overrides: { timeout: -5 }, code: "too_small", path: "timeout" },
  { label: "no target", overrides: { target: undefined }, code: "invalid_type", path: "target" },
];

describe("Story 40.1 QA: input edges on the built server start nothing (AC-1, matrix rows 2 to 4)", () => {
  it("the schema layer rejects every malformed argument with the zod issue for it, before any request: nothing is started and no run id is allocated", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const before = await runCounter();
    for (const { label, overrides, code, path: issuePath, message } of SCHEMA_CASES) {
      const result = await coverage(overrides);
      const text = allText(result);
      expect(result.isError, `${label}: ${text}`).toBe(true);
      expect(text, label).toMatch(/^MCP error -32602: Input validation error: Invalid arguments for tool iris_test_coverage/);
      expect(text, `${label}: the zod issue code`).toContain(`"code": "${code}"`);
      expect(text, `${label}: the argument it names`).toMatch(new RegExp(`"path": \\[\\s*"${issuePath}"`));
      if (message) expect(text, `${label}: the message the schema gives`).toContain(message);
    }
    expect(await runCounter(), "no run id was allocated").toBe(before);
    await expectMonitorInactive("schema edges");
  }, 120000);

  it("names that resolve to nothing are refused by the route with its own text, naming the namespace, starting nothing: absent, wrong case, no routine, another namespace's class, 50 absent names, an empty target, a namespace that does not exist", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const before = await runCounter();
    const unmeasurable = "None of the listed classes has a measurable routine in namespace EXECMCPTMP40S";
    const cases: ReadonlyArray<readonly [string, Record<string, unknown>, string]> = [
      ["a class that does not exist", { classes: ["Story401.NoSuchClass"] }, "(Story401.NoSuchClass: not-compiled)"],
      ["the right class in the wrong letter case", { classes: ["story401.fixture"] }, "(story401.fixture: not-compiled)"],
      ["a class that compiled no routine", { classes: ["Story401Q.Empty"] }, "(Story401Q.Empty: no-routines)"],
      [
        "a class that exists only in the second namespace",
        { target: "Story401Q.TinyTest", classes: ["Story401Q.Tiny"] },
        "(Story401Q.Tiny: not-compiled)",
      ],
    ];
    for (const [label, overrides, reason] of cases) {
      const result = await coverage(overrides);
      const text = allText(result);
      expect(result.isError, `${label}: ${text}`).toBe(true);
      expect(text, label).toContain(unmeasurable);
      expect(text, label).toContain(reason);
      expect(text, label).toContain("Nothing was started.");
      expect(text, `${label}: the route's refusal, not the schema's`).not.toContain("Input validation error");
    }

    const fifty = await coverage({ classes: Array.from({ length: 50 }, (_, index) => `Story401.Absent${index}`) });
    expect(fifty.isError, allText(fifty)).toBe(true);
    expect(allText(fifty), "50 names pass the schema, so the route reports all of them").toContain("(Story401.Absent0: not-compiled, ");
    expect(allText(fifty)).toContain("Story401.Absent49: not-compiled)");
    expect(allText(fifty)).not.toContain("Input validation error");

    const noTarget = await coverage({ target: "" });
    expect(noTarget.isError, allText(noTarget)).toBe(true);
    expect(allText(noTarget)).toContain("Required parameter 'target' is missing or empty");

    const noNamespace = await coverage({ namespace: NS_NONE });
    expect(noNamespace.isError, allText(noNamespace)).toBe(true);
    expect(allText(noNamespace)).toContain(`Namespace '${NS_NONE}' does not exist or cannot be used.`);
    expect(allText(noNamespace)).toContain("Nothing was started.");

    expect(await runCounter(), "no run id was allocated by any of them").toBe(before);
    await expectMonitorInactive("names that resolve to nothing");
  }, 120000);

  it("classes are de-duplicated with the order kept, a class with no routine and a wrong-case name are listed as unmeasured beside the measured ones, and a measured test class is fully covered", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await coverage({
      classes: ["Story401.FixtureTest", "Story401Q.Empty", "Story401.Fixture", "Story401.FixtureTest", "story401.fixture"],
    });
    const run = succeeded<CoverageContent>(result);
    expect(run).toMatchObject({ status: "completed", total: 4, passed: 4 });
    expect(run.coverage?.complete).toBe(true);
    expect(run.coverage?.classes.map((entry) => entry.class), "each class once, in the order given").toEqual(["Story401.FixtureTest", "Story401.Fixture"]);
    expect(run.coverage?.unmeasured, "in the order given").toEqual([
      { class: "Story401Q.Empty", reason: "no-routines" },
      { class: "story401.fixture", reason: "not-compiled" },
    ]);
    expect(run.coverage?.classes[1]?.routines).toEqual([STORY401_ORACLE_ROUTINE]);

    // The test class's own routine, checked against its source: its executable lines are the five assertion calls.
    const source = await intSource(NS_S, "Story401.FixtureTest.1");
    const assertions = source.flatMap((line, index) => (line.trim().startsWith("Do ..AssertEqualsViaMacro") ? [index] : []));
    expect(assertions, "INT lines 6, 7, 10, 13 and 16 call the assertion").toEqual([6, 7, 10, 13, 16]);
    expect(run.coverage?.classes[0]?.routines).toEqual([
      {
        routine: "Story401.FixtureTest.1",
        lines: source.length - INT_LINE_OFFSET,
        executableLines: assertions.length,
        coveredLines: assertions.length,
        percent: 100,
        executableRanges: [[6, 7], [10, 10], [13, 13], [16, 16]],
        coveredRanges: [[6, 7], [10, 10], [13, 13], [16, 16]],
      },
    ]);
    expect(withoutClassSourceLines(allText(result).split("\n"))).toEqual([
      `Coverage run ${run.coverageRunId} completed: 4 tests, 4 passed, 0 failed, 0 skipped.`,
      "Story401.FixtureTest.1: 5 of 5 executable INT lines covered (100%)",
      "Story401.Fixture.1: 20 of 28 executable INT lines covered (71.43%); uncovered 8, 16-18, 23, 27, 47-48",
      "Not measured: Story401Q.Empty (no-routines), story401.fixture (not-compiled)",
    ]);
    await expectMonitorInactive("de-duplication");
  }, 180000);

  it("level method: one method covers only its own lines, and a method that does not exist is a completed run with no test, isError, and nothing covered", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const real = succeeded<CoverageContent>(await coverage({ target: "Story401.FixtureTest:TestSumTo", level: "method" }));
    expect(real).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0, level: "method" });
    expect(routinesOf(real), "TestSumTo reaches only SumTo(3)").toEqual([STORY401_SLOW_ROUTINE]);
    await expectMonitorInactive("level method, an existing method");

    const result = await coverage({ target: "Story401.FixtureTest:TestNoSuchMethod", level: "method" });
    expect(result.isError, allText(result)).toBe(true);
    const content = result.structuredContent as unknown as CoverageContent;
    expect(content).toMatchObject({
      status: "completed",
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      level: "method",
      target: "Story401.FixtureTest:TestNoSuchMethod",
    });
    expect(content.error).toContain("no test method ran");
    expect(content.coverage?.complete).toBe(true);
    expect(routinesOf(content)).toEqual([
      { ...STORY401_ORACLE_ROUTINE, coveredLines: 0, percent: 0, coveredRanges: [] },
    ]);
    const lines = withoutClassSourceLines(allText(result).split("\n"));
    expect(lines[0]).toMatch(/^Coverage run \d+ completed, but no test method ran: /);
    expect(lines[1]).toBe(
      "Story401.Fixture.1: 0 of 28 executable INT lines covered (0%); uncovered 6-10, 12, 14, 16-18, 20, 22-23, 25, 27, 29, 31-33, 36-38, 40-42, 44, 47-48",
    );
    await expectMonitorInactive("level method, a method that does not exist");
  }, 240000);

  it("a second namespace with different classes gives a different result: the tiny class is 2 of 2 lines (100%), by hand from its source, and the oracle class is not in it", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const tiny = { target: "Story401Q.TinyTest", classes: ["Story401Q.Tiny"], namespace: NS_T };
    const result = await coverage(tiny);
    const run = succeeded<CoverageContent>(result);
    expect(run).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0, namespace: NS_T, target: "Story401Q.TinyTest" });
    expect(run.coverage?.complete).toBe(true);

    // By hand, from the source IRIS compiled: INT line 5 is the label, 6 is the Set and 7 the Quit.
    const source = await intSource(NS_T, "Story401Q.Tiny.1");
    expect(source[5], "INT line 5 is the label").toMatch(/^Double\(pN\) methodimpl \{/);
    expect(source[6], "INT line 6").toContain("Set tResult = pN * 2");
    expect(source[7], "INT line 7").toContain("Quit tResult }");
    expect(source).toHaveLength(8);
    expect(classesWithoutSource(run)).toEqual([
      {
        class: "Story401Q.Tiny",
        routines: [
          {
            routine: "Story401Q.Tiny.1",
            lines: 7,
            executableLines: 2,
            coveredLines: 2,
            percent: 100,
            executableRanges: [[6, 7]],
            coveredRanges: [[6, 7]],
          },
        ],
      },
    ]);
    expect(run.coverage?.unmeasured).toEqual([]);
    expect(withoutClassSourceLines(allText(result).split("\n"))).toEqual([
      `Coverage run ${run.coverageRunId} completed: 1 tests, 1 passed, 0 failed, 0 skipped.`,
      "Story401Q.Tiny.1: 2 of 2 executable INT lines covered (100%)",
    ]);
    expect(await testRows(NS_T, run.runIndex as number), "the summary is read in the run's own namespace").toEqual([["TestDouble", 1]]);

    // The same handle, polled by a process that names no namespace, reads that namespace too.
    const polled = await poll(devPlain, run.coverageRunId);
    expect(polled.structuredContent).toEqual(result.structuredContent);

    // The oracle result differs from it, and the oracle class is not in the second namespace.
    const oracleInTiny = await coverage({ ...ORACLE_ARGS, namespace: NS_T });
    expect(oracleInTiny.isError, allText(oracleInTiny)).toBe(true);
    expect(allText(oracleInTiny)).toContain("None of the listed classes has a measurable routine in namespace EXECMCPTMP40T (Story401.Fixture: not-compiled)");
    await expectMonitorInactive("the second namespace");
  }, 180000);
});

// -- The companion's edges against a real run record (matrix row 16) -----------------

describe("Story 40.1 QA: iris_test_status with coverageRunId refuses what cannot name a run, against a real record (matrix row 16)", () => {
  it("jobId or runIndex beside the handle, an unknown handle, a malformed handle and a namespace other than the record's are each an error that changes nothing; the record's own namespace in any letter case, or none, polls it", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await coverage();
    const run = succeeded<CoverageContent>(result);
    const id = String(run.coverageRunId);
    const unknown = (await runCounter()) + 1000;
    const before = await runCounter();

    for (const extra of [{ jobId: "123" }, { runIndex: 1 }]) {
      const combined = await dev.raw("iris_test_status", { action: "poll", coverageRunId: id, ...extra });
      expect(combined.isError, allText(combined)).toBe(true);
      expect(allText(combined)).toBe(
        "coverageRunId cannot be combined with jobId or runIndex: a coverage handle names the whole run. Pass coverageRunId alone.",
      );
    }

    const notFound = await dev.raw("iris_test_status", { action: "poll", coverageRunId: String(unknown) });
    expect(notFound.isError, allText(notFound)).toBe(true);
    expect(allText(notFound)).toContain(
      `Coverage run ${unknown} was not found. Only the 20 most recent runs are kept, and runs do not survive an instance restart.`,
    );

    for (const malformed of ["abc", "-1", "1.5", ""]) {
      const bad = await dev.raw("iris_test_status", { action: "poll", coverageRunId: malformed });
      expect(bad.isError, `"${malformed}": ${allText(bad)}`).toBe(true);
      expect(allText(bad), `"${malformed}"`).toMatch(/^MCP error -32602: Input validation error: Invalid arguments for tool iris_test_status/);
      expect(allText(bad), `"${malformed}"`).toContain("coverageRunId must be the all-digits id iris_test_coverage returned");
    }

    const mismatched = await dev.raw("iris_test_status", { action: "poll", coverageRunId: id, namespace: NS_T });
    expect(mismatched.isError, allText(mismatched)).toBe(true);
    expect(allText(mismatched)).toBe(
      `coverageRunId ${id} belongs to namespace ${NS_S}, but namespace ${NS_T} was passed. Omit namespace (the run's own is used), or pass ${NS_S}.`,
    );

    // The session helper `call` adds the profile's configured namespace, which is not the record's: the same error, naming it.
    const configured = await dev.call("iris_test_status", { action: "poll", coverageRunId: id });
    expect(configured.isError, allText(configured)).toBe(true);
    expect(allText(configured)).toContain(`belongs to namespace ${NS_S}, but namespace ${TARGET.namespace} was passed`);

    for (const namespace of [undefined, NS_S, NS_S.toLowerCase()]) {
      const polled = await dev.raw("iris_test_status", { action: "poll", coverageRunId: id, ...(namespace ? { namespace } : {}) });
      expect(polled.isError, `${namespace ?? "no namespace"}: ${allText(polled)}`).toBeFalsy();
      expect(polled.structuredContent, `${namespace ?? "no namespace"}: the same result`).toEqual(result.structuredContent);
    }
    expect(await runCounter(), "no refusal allocated a run id").toBe(before);
    await expectMonitorInactive("companion edges");
  }, 180000);
});

