/**
 * Story 40.1 -- `iris_test_coverage` unit tests.
 *
 * Oracles (Rule #36): the skeleton and the counts below were captured live from the Story401 fixture compiled
 * in a scratch namespace (IRIS 2026.2 build 221U, 2026-10-18): the skeleton with
 * `ExecuteMCPv2.Coverage.Job:Skeleton("EXECMCPTMP401A","Story401.Fixture.1")` (48 INT lines, 38 with a command),
 * the counts from the Status route of a run of `Story401.FixtureTest` (4 tests, all passed). The expected
 * coverage (28 executable lines, 20 covered, 71.43%) is the Story 40.1 matrix row 1. The Status record shapes
 * are the live route's, field for field (Rule #54).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { IrisApiError, REFUSAL_CODES, type IrisHttpClient, type ToolContext } from "@iris-mcp/shared";
import type { TestClock } from "../tools/execute.js";
import {
  CLASS_NAME_PATTERN,
  buildCoverageRunningHint,
  buildCoverageSection,
  cancelCoverageRun,
  coverageRunEnvelope,
  createTestCoverageHandler,
  isExecutableSkeleton,
  percentOf,
  pollCoverageRun,
  routineCoverage,
  testCoverageTool,
  toRanges,
  type CoverageRoutine,
  type CoverageRun,
} from "../tools/test-coverage.js";
import { createMockCtx, createMockHttp, envelope } from "./test-helpers.js";

// -- Fixtures ----------------------------------------------------------------------

/** `[line, skeleton]` of Story401.Fixture.1, as captured. Lines 1-4, 13, 34, 43 and 46 have no entry. */
const ORACLE_SKELETON: Array<[number, string]> = [
  [5, "L C:methodimpl {"],
  [6, "C:set"],
  [7, "C:if {"],
  [8, "C:set"],
  [9, "} C:elseif {"],
  [10, "C:set"],
  [11, "} C:else {"],
  [12, "C:set"],
  [14, "C:quit }"],
  [15, "L C:methodimpl {"],
  [16, "C:do"],
  [17, "C:do"],
  [18, "C:quit }"],
  [19, "L C:methodimpl {"],
  [20, "C:set"],
  [21, "C:try {"],
  [22, "C:if {"],
  [23, "C:throw"],
  [25, "C:set"],
  [26, "} C:catch {"],
  [27, "C:set"],
  [29, "C:quit }"],
  [30, "L C:methodimpl {"],
  [31, "C:set"],
  [32, "C:while {"],
  [33, "C:set"],
  [35, "C:do {"],
  [36, "C:set"],
  [37, "} C:while"],
  [38, "C:quit }"],
  [39, "L C:methodimpl {"],
  [40, "C:set"],
  [41, "C:for {"],
  [42, "C:set"],
  [44, "C:quit }"],
  [45, "L C:methodimpl {"],
  [47, "C:set"],
  [48, "C:quit }"],
];

/** `[line, count]` of the run of FixtureTest, as captured: lines 26, 34 and 43 are counted but not executable. */
const ORACLE_HITS: Array<[number, number]> = [
  [6, 2], [7, 2], [9, 2], [10, 1], [12, 1], [14, 2], [20, 1], [22, 1], [25, 1], [26, 1], [29, 1], [31, 1],
  [32, 1], [33, 2], [34, 2], [36, 2], [37, 2], [38, 1], [40, 1], [41, 1], [42, 3], [43, 3], [44, 1],
];

const ORACLE_ROUTINE: CoverageRoutine = {
  class: "Story401.Fixture",
  routine: "Story401.Fixture.1",
  lines: 48,
  hits: ORACLE_HITS,
  skeleton: ORACLE_SKELETON,
};

const ORACLE_COVERAGE = {
  routine: "Story401.Fixture.1",
  lines: 48,
  executableLines: 28,
  coveredLines: 20,
  percent: 71.43,
  executableRanges: [[6, 10], [12, 12], [14, 14], [16, 18], [20, 20], [22, 23], [25, 25], [27, 27], [29, 29], [31, 33], [36, 38], [40, 42], [44, 44], [47, 48]],
  coveredRanges: [[6, 7], [9, 10], [12, 12], [14, 14], [20, 20], [22, 22], [25, 25], [29, 29], [31, 33], [36, 38], [40, 42], [44, 44]],
};

/** A run record as the Status route returns it. */
function runRecord(overrides: Partial<CoverageRun> = {}): CoverageRun {
  return {
    coverageRunId: 9,
    status: "running",
    namespace: "EXECMCPTMP401A",
    target: "Story401.FixtureTest",
    level: "class",
    pid: 1122162,
    runnerPid: 1122163,
    startedAt: "2026-10-18T01:36:10.613Z",
    finishedAt: null,
    runIndex: 12,
    cancelRequested: false,
    supervisorAlive: true,
    runnerAlive: true,
    unmeasured: [{ class: "Story401.Missing", reason: "not-compiled" }],
    ...overrides,
  };
}

const COMPLETED = runRecord({
  status: "completed",
  finishedAt: "2026-10-18T01:36:11.657Z",
  releasedBy: "runner",
  supervisorAlive: false,
  runnerAlive: false,
  routines: [ORACLE_ROUTINE],
});

const FOUR_PASSED = { total: 4, passed: 4, failed: 0, skipped: 0, details: [] };

/** `%UnitTest_Result` method rows of FixtureTest: four passed tests (Duration is seconds). */
const METHOD_ROWS = ["TestClassify", "TestGuarded", "TestLoop", "TestSumTo"].map((method) => ({
  ClassName: "Story401.FixtureTest",
  MethodName: method,
  Status: 1,
  Duration: 0.000094,
  ErrorAction: "",
  ErrorDescription: "",
}));

// -- Harness -----------------------------------------------------------------------

function createFakeClock(): TestClock {
  let current = 0;
  return {
    now: () => current,
    sleep: async (ms: number) => {
      current += ms;
    },
  };
}

interface Harness {
  ctx: ToolContext;
  http: ReturnType<typeof createMockHttp>;
  starts: unknown[];
  cancels: unknown[];
  sqlQueries: string[];
  /** The bound parameters of each SQL query, in call order. */
  sqlParameters: unknown[];
}

/**
 * Route `ctx.http` the way the tool issues calls: `POST` to the start route, `POST .../cancel`, `POST` Atelier
 * `action/query` SQL, and `GET` of the run record (the records are served in order, the last one repeating).
 */
function makeHarness(options: {
  start?: unknown;
  records?: CoverageRun[];
  methodRows?: unknown[];
  classRows?: unknown[];
  startError?: Error;
}): Harness {
  const http = createMockHttp();
  const starts: unknown[] = [];
  const cancels: unknown[] = [];
  const sqlQueries: string[] = [];
  const sqlParameters: unknown[] = [];
  const records = options.records ?? [COMPLETED];
  let readIndex = 0;
  http.post.mockImplementation(async (path: string, body?: unknown) => {
    if (path.endsWith("/dev/test/coverage/cancel")) {
      cancels.push(body);
      return envelope(records[0]);
    }
    if (path.endsWith("/dev/test/coverage")) {
      starts.push(body);
      if (options.startError) throw options.startError;
      return envelope(options.start ?? { ...records[0], outcome: "started" });
    }
    const query = String((body as { query?: string })?.query ?? "");
    sqlQueries.push(query);
    sqlParameters.push((body as { parameters?: unknown[] })?.parameters);
    if (query.includes("TestAssert")) return envelope({ content: [] });
    if (query.includes("tc.ErrorDescription FROM")) return envelope({ content: options.classRows ?? [] });
    return envelope({ content: options.methodRows ?? METHOD_ROWS });
  });
  http.get.mockImplementation(async (path: string) => {
    expect(path).toMatch(/\/dev\/test\/coverage\?id=\d+$/);
    const record = records[Math.min(readIndex, records.length - 1)];
    readIndex++;
    return envelope(record);
  });
  const ctx = createMockCtx(http as unknown as IrisHttpClient, 8);
  return { ctx, http, starts, cancels, sqlQueries, sqlParameters };
}

const ARGS = {
  target: "Story401.FixtureTest",
  level: "class" as const,
  classes: ["Story401.Fixture", "Story401.Missing"],
  namespace: "EXECMCPTMP401A",
};

// -- Pure functions --------------------------------------------------------------

describe("isExecutableSkeleton (the executable-line rule)", () => {
  const cases: Array<[string, boolean]> = [
    ["L C:methodimpl {", false],
    ["L C:methodimpl", false],
    ["L C:public {", false],
    ["L C:private {", false],
    ["L C:methodimpl { C:new", true],
    ["L C:n", true],
    ["C:set", true],
    ["C:quit }", true],
    ["C:if {", true],
    ["} C:elseif {", true],
    ["C:for {", true],
    ["C:while {", true],
    ["} C:while", true],
    ["C:do", true],
    ["C:throw", true],
    ["C:continue", true],
    ["C:return }", true],
    ["C:if C:set", true],
    ["C:e C:s", true],
    ["C:try {", false],
    ["} C:catch {", false],
    ["C:catch {", false],
    ["} C:else {", false],
    ["C:e", false],
    ["C:do {", false],
    ["C:d {", false],
    ["C:try { C:d } C:catch { C:if { C:d L } C:else { C:throw } }", true],
    ["{", false],
    ["}", false],
    ["L", false],
    ["", false],
  ];
  it.each(cases)("%j -> %s", (skeleton, expected) => {
    expect(isExecutableSkeleton(skeleton)).toBe(expected);
  });

  it("a line with no skeleton is not executable", () => {
    expect(isExecutableSkeleton(undefined)).toBe(false);
    expect(isExecutableSkeleton(null)).toBe(false);
  });

  it("the oracle skeleton has 28 executable lines because an else line is never counted", () => {
    const executable = ORACLE_SKELETON.filter(([, skeleton]) => isExecutableSkeleton(skeleton)).map(([line]) => line);
    expect(executable).toHaveLength(28);
    expect(executable).not.toContain(11);
  });
});

describe("toRanges and percentOf", () => {
  it("joins consecutive lines into inclusive ranges in ascending order, whatever the input order", () => {
    expect(toRanges([5, 1, 2, 3, 9, 7, 8])).toEqual([[1, 3], [5, 5], [7, 9]]);
  });

  it("ignores repeats, and an empty input has no ranges", () => {
    expect(toRanges([2, 2, 3, 3])).toEqual([[2, 3]]);
    expect(toRanges([])).toEqual([]);
  });

  it("percent is round(covered / executable * 10000) / 100, and null without executable lines", () => {
    expect(percentOf(20, 28)).toBe(71.43);
    expect(percentOf(4, 28)).toBe(14.29);
    expect(percentOf(1, 3)).toBe(33.33);
    expect(percentOf(2, 3)).toBe(66.67);
    expect(percentOf(0, 5)).toBe(0);
    expect(percentOf(5, 5)).toBe(100);
    expect(percentOf(0, 0)).toBeNull();
  });
});

describe("routineCoverage against the matrix row 1 oracle", () => {
  it("28 executable lines, 20 covered, 71.43%, with the exact ranges", () => {
    expect(routineCoverage(ORACLE_ROUTINE)).toEqual(ORACLE_COVERAGE);
  });

  it("counted-but-not-executable lines (26, 34, 43) are ignored", () => {
    const coverage = routineCoverage(ORACLE_ROUTINE);
    for (const line of [26, 34, 43]) {
      const covered = coverage.coveredRanges.some(([start, end]) => line >= start && line <= end);
      expect(covered, `line ${line}`).toBe(false);
    }
  });

  it("the SlowTest run: only SumTo executed, 4 covered lines, 14.29%, ranges [[40,42],[44,44]]", () => {
    const coverage = routineCoverage({
      ...ORACLE_ROUTINE,
      hits: [[40, 1], [41, 1], [42, 3], [43, 3], [44, 1]],
    });
    expect(coverage.coveredLines).toBe(4);
    expect(coverage.percent).toBe(14.29);
    expect(coverage.coveredRanges).toEqual([[40, 42], [44, 44]]);
  });

  it("a routine with no executable line has a null percent", () => {
    const coverage = routineCoverage({ class: "A", routine: "A.1", lines: 3, hits: [[1, 1]], skeleton: [[1, "L C:methodimpl {"]] });
    expect(coverage).toMatchObject({ executableLines: 0, coveredLines: 0, percent: null, executableRanges: [], coveredRanges: [] });
  });

  it("groups routines by class in the run's order, and reports the unmeasured classes", () => {
    const section = buildCoverageSection(
      runRecord({
        status: "completed",
        routines: [
          { ...ORACLE_ROUTINE, class: "A.One", routine: "A.One.1" },
          { ...ORACLE_ROUTINE, class: "B.Two", routine: "B.Two.1" },
          { ...ORACLE_ROUTINE, class: "A.One", routine: "A.One.2" },
        ],
      }),
    );
    expect(section.classes.map((entry) => [entry.class, entry.routines.map((routine) => routine.routine)])).toEqual([
      ["A.One", ["A.One.1", "A.One.2"]],
      ["B.Two", ["B.Two.1"]],
    ]);
    expect(section.complete).toBe(true);
    expect(section.unmeasured).toEqual([{ class: "Story401.Missing", reason: "not-compiled" }]);
  });
});

// -- Envelopes ---------------------------------------------------------------------

describe("coverageRunEnvelope shapes and first text lines", () => {
  it("completed: counts, handles, coverage.complete true, and a compact text without a JSON dump", () => {
    const result = coverageRunEnvelope({ run: COMPLETED, summary: FOUR_PASSED });
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(structured)).toEqual([
      "total", "passed", "failed", "skipped", "details", "status", "coverageRunId", "runIndex", "namespace",
      "target", "level", "pid", "runnerPid", "startedAt", "finishedAt", "coverage",
    ]);
    expect(structured).toMatchObject({
      total: 4, passed: 4, failed: 0, skipped: 0, status: "completed", coverageRunId: 9, runIndex: 12,
      namespace: "EXECMCPTMP401A", target: "Story401.FixtureTest", level: "class", pid: 1122162, runnerPid: 1122163,
      startedAt: "2026-10-18T01:36:10.613Z", finishedAt: "2026-10-18T01:36:11.657Z",
    });
    const coverage = structured.coverage as { complete: boolean; classes: Array<{ class: string; routines: unknown[] }>; unmeasured: unknown[] };
    expect(coverage.complete).toBe(true);
    expect(coverage.classes[0]?.routines[0]).toEqual(ORACLE_COVERAGE);
    expect(coverage.unmeasured).toEqual([{ class: "Story401.Missing", reason: "not-compiled" }]);
    const text = (result.content[0] as { text: string }).text.split("\n");
    expect(text[0]).toBe("Coverage run 9 completed: 4 tests, 4 passed, 0 failed, 0 skipped.");
    expect(text[1]).toBe(
      "Story401.Fixture.1: 20 of 28 executable INT lines covered (71.43%); uncovered 8, 16-18, 23, 27, 47-48",
    );
    expect(text[2]).toBe("Not measured: Story401.Missing (not-compiled)");
    expect(text).toHaveLength(3);
  });

  it("completed carries timeoutCapped only when true, and reclaimed when the run reclaimed a dead one", () => {
    const plain = coverageRunEnvelope({ run: COMPLETED, summary: FOUR_PASSED, timeoutCapped: false });
    expect(plain.structuredContent).not.toHaveProperty("timeoutCapped");
    expect(plain.structuredContent).not.toHaveProperty("reclaimed");
    const capped = coverageRunEnvelope({
      run: { ...COMPLETED, reclaimed: { coverageRunId: 8, pid: 1122156 } },
      summary: FOUR_PASSED,
      timeoutCapped: true,
    });
    expect(capped.structuredContent).toMatchObject({ timeoutCapped: true, reclaimed: { coverageRunId: 8, pid: 1122156 } });
  });

  it("completed with no test method run is isError:true with the reason in error, and the coverage stays", () => {
    const result = coverageRunEnvelope({
      run: COMPLETED,
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, details: [] },
      zeroResultError: "Test run at runIndex 12 recorded no method-level results (no test method ran).",
    });
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error).toBe("Test run at runIndex 12 recorded no method-level results (no test method ran).");
    expect((structured.coverage as { classes: unknown[] }).classes).toHaveLength(1);
  });

  it("running: isError:false, the handles, a partial, a hint naming iris_test_status, and the exact first line", () => {
    const result = coverageRunEnvelope({
      run: runRecord(),
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, details: [] },
      elapsedMs: 1000,
      timeoutMs: 1000,
    });
    expect(result.isError).toBe(false);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({
      status: "running", coverageRunId: 9, runIndex: 12, namespace: "EXECMCPTMP401A", pid: 1122162,
      runnerPid: 1122163, elapsedMs: 1000, timeoutMs: 1000,
    });
    expect(structured.partial).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, details: [] });
    expect(structured.hint).toBe(buildCoverageRunningHint(9));
    expect(String(structured.hint)).toContain('iris_test_status');
    expect(String(structured.hint)).toContain('coverageRunId "9"');
    expect(String(structured.hint)).not.toMatch(/\/api\//);
    expect((result.content[0] as { text: string }).text.split("\n")[0]).toBe(
      "COVERAGE RUN STILL EXECUTING \u2014 not finished, not failed. coverageRunId=9. Do NOT re-submit.",
    );
  });

  it("running with no runIndex yet carries runIndex null", () => {
    const result = coverageRunEnvelope({
      run: runRecord({ status: "starting", runIndex: null }),
      summary: { total: 0, passed: 0, failed: 0, skipped: 0, details: [] },
    });
    expect(result.structuredContent).toMatchObject({ status: "running", runIndex: null });
  });

  it("cancelled: isError:false, the reason, a partial and coverage.complete false", () => {
    const run = runRecord({ status: "cancelled", reason: "cancel", finishedAt: "2026-10-18T01:36:14.000Z", releasedBy: "supervisor", routines: [{ ...ORACLE_ROUTINE, hits: [[40, 1], [41, 1], [42, 3], [43, 3], [44, 1]] }] });
    const result = coverageRunEnvelope({ run, summary: { total: 0, passed: 0, failed: 0, skipped: 0, details: [] } });
    expect(result.isError).toBe(false);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({ status: "cancelled", reason: "cancel", coverageRunId: 9 });
    const coverage = structured.coverage as { complete: boolean; classes: Array<{ routines: Array<{ coveredLines: number }> }> };
    expect(coverage.complete).toBe(false);
    expect(coverage.classes[0]?.routines[0]?.coveredLines).toBe(4);
    expect(structured).toHaveProperty("partial");
    expect((result.content[0] as { text: string }).text.split("\n")[0]).toContain("cancelled (cancel)");
  });

  it("failed: isError:true with the error, the handles, and the partial coverage the run reached", () => {
    const run = runRecord({ status: "failed", error: "The test process ended before the tests finished.", releasedBy: "supervisor", routines: [ORACLE_ROUTINE] });
    const result = coverageRunEnvelope({ run, summary: { total: 0, passed: 0, failed: 0, skipped: 0, details: [] } });
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({
      status: "failed", coverageRunId: 9, runIndex: 12, namespace: "EXECMCPTMP401A", pid: 1122162, runnerPid: 1122163,
      error: "The test process ended before the tests finished.",
    });
    expect((structured.coverage as { complete: boolean }).complete).toBe(false);
    expect((result.content[0] as { text: string }).text.split("\n")[0]).toBe(
      "Coverage run 9 failed: The test process ended before the tests finished.",
    );
  });

  it("failed with counts-unreadable: isError:true with the reason, the IRIS text, readError and the test summary, and no coverage", () => {
    const run = runRecord({
      status: "failed",
      reason: "counts-unreadable",
      releasedBy: "runner",
      error: "The line counts of this run could not be read: ERROR #5001: boom",
      readError: "ERROR #5001: boom",
    });
    const result = coverageRunEnvelope({ run, summary: FOUR_PASSED });
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({
      status: "failed", reason: "counts-unreadable", readError: "ERROR #5001: boom",
      error: "The line counts of this run could not be read: ERROR #5001: boom", partial: FOUR_PASSED,
    });
    expect(structured).not.toHaveProperty("coverage");
    expect((result.content[0] as { text: string }).text.split("\n")[0]).toBe(
      "Coverage run 9 failed: The line counts of this run could not be read: ERROR #5001: boom",
    );
  });

  it("failed with release-failed: isError:true with the reason, the test summary and the coverage that was read", () => {
    const run = runRecord({
      status: "failed",
      reason: "release-failed",
      error:
        "A suite-owned Line-by-Line session is still active: it could not be stopped (ERROR #6070: boom). " +
        "The next coverage run reclaims it.",
      routines: [ORACLE_ROUTINE],
    });
    const result = coverageRunEnvelope({ run, summary: FOUR_PASSED });
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({ status: "failed", reason: "release-failed", partial: FOUR_PASSED });
    expect(structured).not.toHaveProperty("readError");
    expect(String(structured.error)).toContain("still active");
    expect(String(structured.error)).toContain("next coverage run reclaims it");
    const coverage = structured.coverage as { complete: boolean; classes: Array<{ routines: unknown[] }> };
    expect(coverage.complete).toBe(false);
    expect(coverage.classes[0]?.routines[0]).toEqual(ORACLE_COVERAGE);
    expect((result.content[0] as { text: string }).text).toContain("20 of 28 executable INT lines covered");
  });

  it("a measured routine without an executable line is reported as such in the text", () => {
    const run = runRecord({
      status: "completed",
      routines: [{ class: "A.Empty", routine: "A.Empty.1", lines: 3, hits: [[1, 1]], skeleton: [[1, "L C:methodimpl {"]] }],
      unmeasured: [],
    });
    const result = coverageRunEnvelope({ run, summary: FOUR_PASSED });
    expect((result.content[0] as { text: string }).text.split("\n")).toEqual([
      "Coverage run 9 completed: 4 tests, 4 passed, 0 failed, 0 skipped.",
      "A.Empty.1: no executable INT lines",
    ]);
  });

  it("failed without a routine list has no coverage object, and without a runIndex no partial", () => {
    const run = runRecord({ status: "failed", error: "ERROR #6062: The Monitor is already running", runIndex: null });
    const structured = coverageRunEnvelope({ run, summary: { total: 0, passed: 0, failed: 0, skipped: 0, details: [] } }).structuredContent as Record<string, unknown>;
    expect(structured).not.toHaveProperty("coverage");
    expect(structured).not.toHaveProperty("partial");
    expect(structured.error).toBe("ERROR #6062: The Monitor is already running");
  });

  it("abandoned: isError:false, the handles and a note", () => {
    const result = coverageRunEnvelope({ run: runRecord({ status: "abandoned", supervisorAlive: false, runnerAlive: false }), summary: FOUR_PASSED });
    expect(result.isError).toBe(false);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(Object.keys(structured)).toEqual(["status", "coverageRunId", "runIndex", "namespace", "note"]);
    expect(structured.status).toBe("abandoned");
    expect(String(structured.note)).toContain("will not complete");
  });
});

// -- The tool --------------------------------------------------------------------

describe("testCoverageTool definition (Story 40.1, AC-6)", () => {
  it("is the governed write the Boundaries describe", () => {
    expect(testCoverageTool.name).toBe("iris_test_coverage");
    expect(testCoverageTool.title).toBe("Test Coverage");
    expect(testCoverageTool.scope).toBe("NS");
    expect(testCoverageTool.mutates).toBe("write");
    expect(testCoverageTool).not.toHaveProperty("defaultEnabled");
    expect(testCoverageTool).not.toHaveProperty("parent");
    expect(testCoverageTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("the description leads with what it does and states the default state, the operator control, the guard and the process scope", () => {
    const description = testCoverageTool.description;
    expect(description.startsWith("Run ObjectScript unit tests and measure which INT lines")).toBe(true);
    expect(description).toContain("DEFAULT-DISABLED");
    expect(description).toContain('IRIS_GOVERNANCE={"global":{"iris_test_coverage":true}}');
    expect(description).toContain("IRIS_TEST_TIMEOUT");
    expect(description).toContain("one coverage run at a time instance-wide");
    expect(description).toContain("MONITOR_BUSY");
    expect(description).toContain("Only the process that runs the tests is measured");
    expect(description).toContain("INT-line coverage of the listed classes' routines");
    expect(description).toContain("iris_test_status");
    expect(description).toContain("coverageRunId");
    expect(description).toContain("do NOT re-submit");
    expect(description).toContain("Class names are matched exactly as compiled, with the package and the letter case");
    // INT line n is document line n+1 of iris_doc_get on <routine>.int: its line 1 is the ROUTINE header.
    expect(description).toContain("INT line n is line n+1 of the document iris_doc_get returns for '<routine>.int'");
    expect(description).toContain("whose line 1 is the ROUTINE header");
    // The companion's cancel is its own default-disabled key, with its own recipe.
    expect(description).toContain("is a key of its own, iris_test_status:cancel, also DEFAULT-DISABLED");
    expect(description).toContain('IRIS_GOVERNANCE={"global":{"iris_test_status:cancel":true}}');
    expect(description).toContain("the suite's own supervisor process, which runs only the suite's own classes, so they count only if you list them");
    expect(description).toContain("including the code the compiler generates in them");
    expect(description).not.toMatch(/\/api\/|\/dev\/|executemcp/i);
  });

  it("validates the input: classes is 1 to 50 class names without wildcards, level is one of three, timeout is positive", () => {
    const schema = testCoverageTool.inputSchema;
    const ok = { target: "A.B", level: "class", classes: ["A.B"] };
    expect(schema.safeParse(ok).success).toBe(true);
    expect(schema.safeParse({ ...ok, classes: [] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, classes: Array.from({ length: 50 }, (_, i) => `P.C${i}`) }).success).toBe(true);
    expect(schema.safeParse({ ...ok, classes: Array.from({ length: 51 }, (_, i) => `P.C${i}`) }).success).toBe(false);
    expect(schema.safeParse({ ...ok, classes: ["A.*"] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, classes: ["A.B,C.D"] }).success).toBe(false);
    expect(schema.safeParse({ ...ok, level: "suite" }).success).toBe(false);
    expect(schema.safeParse({ ...ok, timeout: 0 }).success).toBe(false);
    expect(schema.safeParse({ ...ok, timeout: 5, namespace: "USER" }).success).toBe(true);
    expect(schema.safeParse({ level: "class", classes: ["A.B"] }).success).toBe(false);
    expect(CLASS_NAME_PATTERN.test("%Library.String")).toBe(true);
  });
});

// -- The handler ---------------------------------------------------------------------

describe("createTestCoverageHandler", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sends the documented limits explicitly (Rule #10) with the resolved namespace, then returns the completed result", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(h.starts).toEqual([
      {
        target: "Story401.FixtureTest",
        level: "class",
        classes: ["Story401.Fixture", "Story401.Missing"],
        namespace: "EXECMCPTMP401A",
        maxSeconds: 3600,
        maxLines: 200000,
      },
    ]);
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ status: "completed", total: 4, passed: 4, coverageRunId: 9 });
    expect(h.sqlQueries.length).toBeGreaterThan(0);
    for (const parameters of h.sqlParameters) {
      expect(parameters, "every result read is keyed by the run's runIndex (12), never its coverageRunId (9)").toEqual([12]);
    }
  });

  it("sends the configured namespace when none is passed", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    await createTestCoverageHandler(createFakeClock())({ target: "A.B", level: "class", classes: ["A.B"] }, h.ctx);
    expect((h.starts[0] as { namespace: string }).namespace).toBe("USER");
  });

  it("polls until the run is terminal, sleeping the poll interval between reads", async () => {
    const h = makeHarness({ records: [runRecord(), runRecord(), COMPLETED] });
    const clock = createFakeClock();
    const result = await createTestCoverageHandler(clock)(ARGS, h.ctx);
    expect(h.http.get).toHaveBeenCalledTimes(3);
    expect(clock.now()).toBe(400);
    expect(result.structuredContent).toMatchObject({ status: "completed" });
  });

  it("budget expiry (AD-16): isError:false and status running with every handle, a partial and the hint (matrix row 5)", async () => {
    const h = makeHarness({ records: [runRecord()], methodRows: [] });
    const clock = createFakeClock();
    const result = await createTestCoverageHandler(clock)({ ...ARGS, timeout: 1 }, h.ctx);
    expect(result.isError).toBe(false);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({
      status: "running", coverageRunId: 9, pid: 1122162, runnerPid: 1122163, runIndex: 12, timeoutMs: 1000,
    });
    expect(structured.elapsedMs).toBe(1000);
    expect(structured).toHaveProperty("partial");
    expect(String(structured.hint)).toContain("iris_test_status");
    expect(structured).not.toHaveProperty("timeoutCapped");
  });

  it("timeout precedence: an explicit timeout beats IRIS_TEST_TIMEOUT (ctx.config.testTimeoutMs)", async () => {
    const h = makeHarness({ records: [runRecord()], methodRows: [] });
    h.ctx.config = { ...h.ctx.config, testTimeoutMs: 5_000 };
    const result = await createTestCoverageHandler(createFakeClock())({ ...ARGS, timeout: 10 }, h.ctx);
    expect(result.structuredContent).toMatchObject({ status: "running", timeoutMs: 10_000 });
  });

  it("timeout precedence: IRIS_TEST_TIMEOUT applies when no timeout argument is given", async () => {
    const h = makeHarness({ records: [runRecord()], methodRows: [] });
    h.ctx.config = { ...h.ctx.config, testTimeoutMs: 7_000 };
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(result.structuredContent).toMatchObject({ status: "running", timeoutMs: 7_000 });
  });

  it("timeout default: neither a timeout argument nor IRIS_TEST_TIMEOUT -> 120 s", async () => {
    const h = makeHarness({ records: [runRecord()], methodRows: [] });
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(result.structuredContent).toMatchObject({ status: "running", timeoutMs: 120_000 });
  });

  it("a timeout above the cap is clamped and the result carries timeoutCapped:true", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    const result = await createTestCoverageHandler(createFakeClock())({ ...ARGS, timeout: 7200 }, h.ctx);
    expect(result.structuredContent).toMatchObject({ status: "completed", timeoutCapped: true });
  });

  it("a completed run in which no test method ran is isError:true with the class-level reason, and keeps its coverage (zero-result rule)", async () => {
    const h = makeHarness({
      records: [COMPLETED],
      methodRows: [],
      classRows: [{ ClassName: "Story401.FixtureTest", ErrorAction: "OnBeforeAllTests", ErrorDescription: " ERROR #5001: boom" }],
    });
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as { error: string; coverage: { classes: unknown[] } };
    expect(structured.error).toContain("produced no method-level results");
    expect(structured.error).toContain("Story401.FixtureTest: OnBeforeAllTests: ERROR #5001: boom");
    expect(structured.coverage.classes).toHaveLength(1);
  });

  it("a completed run with no recorded runIndex is isError:true (zeros), not a green result", async () => {
    const h = makeHarness({ records: [{ ...COMPLETED, runIndex: null }] });
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ total: 0, status: "completed" });
  });

  it("busy, owner suite: MONITOR_BUSY with the running run's id, pid, start time and namespace; the text names the poll (matrix row 11)", async () => {
    const h = makeHarness({
      start: { outcome: "busy", owner: "suite", coverageRunId: 7, pid: 1122136, startedAt: "2026-10-18T01:35:48.667Z", namespace: "EXECMCPTMP401A" },
    });
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: REFUSAL_CODES.MONITOR_BUSY,
      owner: "suite",
      coverageRunId: 7,
      pid: 1122136,
      startedAt: "2026-10-18T01:35:48.667Z",
      namespace: "EXECMCPTMP401A",
    });
    expect((result.content[0] as { text: string }).text).toBe(
      "A coverage run is already active on this instance (coverageRunId=7, process 1122136, started " +
        '2026-10-18T01:35:48.667Z); nothing was started. Wait for it with iris_test_status (action "poll", coverageRunId "7") and try again.',
    );
    expect(h.http.get).not.toHaveBeenCalled();
  });

  it("busy from the start lock timing out carries no run fields", async () => {
    const h = makeHarness({ start: { outcome: "busy", owner: "suite" } });
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(result.structuredContent).toEqual({ code: "MONITOR_BUSY", owner: "suite" });
    expect((result.content[0] as { text: string }).text).toContain("nothing was started");
  });

  it("busy, owner foreign: MONITOR_BUSY, the session untouched (matrix row 10)", async () => {
    const h = makeHarness({ start: { outcome: "busy", owner: "foreign" } });
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ code: "MONITOR_BUSY", owner: "foreign" });
    expect((result.content[0] as { text: string }).text).toBe(
      "Another Line-by-Line or PERFMON monitor session is active on this instance and was not started by this suite; " +
        "nothing was started and that session was left untouched. Try again once it has ended.",
    );
  });

  it("a failed start with a run record is isError:true with the error (matrix row 12)", async () => {
    const h = makeHarness({
      start: { ...runRecord({ status: "failed", runIndex: null }), outcome: "failed", error: "ERROR #6062: The Monitor is already running" },
    });
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ status: "failed", error: "ERROR #6062: The Monitor is already running" });
    expect(h.http.get).not.toHaveBeenCalled();
  });

  it("a failed start without a run is isError:true with the error", async () => {
    const h = makeHarness({ start: { outcome: "failed", error: "The monitor session could not be released." } });
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: "The monitor session could not be released." });
  });

  it("an error from the start route is isError:true and names the target (matrix rows 2 to 4)", async () => {
    const h = makeHarness({
      startError: new IrisApiError(
        400,
        [{ error: "ERROR #5001: None of the listed classes has a measurable routine in namespace EXECMCPTMP401B. Nothing was started." }],
        "/api/executemcp/v2/dev/test/coverage",
        "IRIS reported errors for POST /api/executemcp/v2/dev/test/coverage.",
      ),
    });
    const result = await createTestCoverageHandler(createFakeClock())({ ...ARGS, namespace: "EXECMCPTMP401B" }, h.ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("EXECMCPTMP401B");
    expect((result.content[0] as { text: string }).text).toContain("Story401.FixtureTest");
  });

  it("an error while following a started run keeps the handle and says not to re-submit", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    h.http.get.mockRejectedValueOnce(
      new IrisApiError(500, [{ error: "boom" }], "/api/executemcp/v2/dev/test/coverage?id=9", "IRIS reported errors for GET."),
    );
    const result = await createTestCoverageHandler(createFakeClock())(ARGS, h.ctx);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ coverageRunId: 9 });
    expect((result.content[0] as { text: string }).text).toContain("Do NOT re-submit");
  });

  it("the exported tool runs the handler on the real clock: a run that is terminal on the first read needs no wait", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    const parsed = testCoverageTool.inputSchema.parse(ARGS);
    const result = await testCoverageTool.handler(parsed, h.ctx);
    expect(result.structuredContent).toMatchObject({ status: "completed", total: 4, coverageRunId: 9 });
    expect(h.starts).toHaveLength(1);
    expect(h.http.get).toHaveBeenCalledTimes(1);
  });

  it("a poll of a failed run with a reason returns the same result the primary call returns", async () => {
    const failed = runRecord({
      status: "failed", reason: "counts-unreadable", error: "The line counts of this run could not be read: ERROR #5001: boom",
      readError: "ERROR #5001: boom",
    });
    const primary = await createTestCoverageHandler(createFakeClock())(ARGS, makeHarness({ records: [failed] }).ctx);
    const polled = await pollCoverageRun(makeHarness({ records: [failed] }).ctx, { coverageRunId: "9" });
    expect(primary.isError).toBe(true);
    expect(polled.structuredContent).toEqual(primary.structuredContent);
    expect(polled.structuredContent).toMatchObject({ reason: "counts-unreadable", readError: "ERROR #5001: boom" });
  });
});

// -- The companion helpers -----------------------------------------------------------

describe("pollCoverageRun and cancelCoverageRun", () => {
  it("poll reproduces the primary call's structuredContent for the same run, deep-equal (AC-5)", async () => {
    const primary = makeHarness({ records: [COMPLETED] });
    const first = await createTestCoverageHandler(createFakeClock())(ARGS, primary.ctx);
    const polled = makeHarness({ records: [COMPLETED] });
    const second = await pollCoverageRun(polled.ctx, { coverageRunId: "9" });
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect(second.content).toEqual(first.content);
  });

  it("poll reads the test summary in the record's namespace, not the profile's", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    await pollCoverageRun(h.ctx, { coverageRunId: "9" });
    const sqlCalls = h.http.post.mock.calls.filter((call) => String(call[0]).includes("action/query"));
    expect(sqlCalls.length).toBeGreaterThan(0);
    for (const call of sqlCalls) expect(String(call[0])).toContain("/EXECMCPTMP401A/");
    expect(h.sqlParameters.length).toBeGreaterThan(0);
    for (const parameters of h.sqlParameters) expect(parameters, "keyed by the record's runIndex, not its coverageRunId").toEqual([12]);
  });

  it("poll of a running run is the running result", async () => {
    const h = makeHarness({ records: [runRecord()], methodRows: [] });
    const result = await pollCoverageRun(h.ctx, { coverageRunId: "9" });
    expect(result.isError).toBe(false);
    expect(result.structuredContent).toMatchObject({ status: "running", coverageRunId: 9 });
  });

  it("poll with a namespace that differs from the record's is an error naming both", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    const result = await pollCoverageRun(h.ctx, { coverageRunId: "9", namespace: "USER" });
    expect(result.isError).toBe(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("EXECMCPTMP401A");
    expect(text).toContain("USER");
    expect(h.http.post).not.toHaveBeenCalled();
  });

  it("poll accepts the record's own namespace in any case", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    const result = await pollCoverageRun(h.ctx, { coverageRunId: "9", namespace: "execmcptmp401a" });
    expect(result.structuredContent).toMatchObject({ status: "completed" });
  });

  it("a coverageRunId that is not all digits is refused before any IRIS call, by poll and by cancel", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    for (const bad of ["9;1", "../x", "", "1 2"]) {
      const polled = await pollCoverageRun(h.ctx, { coverageRunId: bad });
      expect(polled.isError, bad).toBe(true);
      expect((polled.content[0] as { text: string }).text).toContain("all-digits");
      const cancelled = await cancelCoverageRun(h.ctx, { coverageRunId: bad }, createFakeClock());
      expect(cancelled.isError, bad).toBe(true);
    }
    expect(h.http.get).not.toHaveBeenCalled();
    expect(h.http.post).not.toHaveBeenCalled();
  });

  it("poll of an unknown id is the not-found error from the service", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    h.http.get.mockRejectedValueOnce(
      new IrisApiError(
        400,
        [{ error: "ERROR #5001: Coverage run 9999 was not found. Only the 20 most recent runs are kept, and runs do not survive an instance restart." }],
        "/api/executemcp/v2/dev/test/coverage?id=9999",
        "IRIS reported errors for GET.",
      ),
    );
    const result = await pollCoverageRun(h.ctx, { coverageRunId: "9999" });
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("was not found");
  });

  it("cancel signals the run, reads it up to 10 times 500 ms apart, and reports the cancelled outcome it observed (matrix row 7)", async () => {
    const cancelled = runRecord({
      status: "cancelled", reason: "cancel", finishedAt: "2026-10-18T01:36:14.000Z", releasedBy: "supervisor",
      routines: [{ ...ORACLE_ROUTINE, hits: [[40, 1], [41, 1], [42, 3], [43, 3], [44, 1]] }],
    });
    const h = makeHarness({ records: [runRecord(), runRecord(), runRecord(), cancelled], methodRows: [] });
    const clock = createFakeClock();
    const result = await cancelCoverageRun(h.ctx, { coverageRunId: "9" }, clock);
    expect(h.cancels).toEqual([{ id: 9 }]);
    expect(clock.now()).toBe(1500);
    expect(result.isError).toBe(false);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).toMatchObject({ status: "cancelled", reason: "cancel" });
    expect((structured.coverage as { complete: boolean }).complete).toBe(false);
    expect(String(structured.note)).toContain("Cancel signalled; observed cancelled");
  });

  it("cancel reports a run that is still running after 10 reads as running, with a note", async () => {
    const h = makeHarness({ records: [runRecord()], methodRows: [] });
    const clock = createFakeClock();
    const result = await cancelCoverageRun(h.ctx, { coverageRunId: "9" }, clock);
    expect(clock.now()).toBe(5000);
    expect(result.structuredContent).toMatchObject({ status: "running" });
    expect(String((result.structuredContent as { note: string }).note)).toContain("still running after 10 reads");
  });

  it("cancel of a run that already finished signals nothing and reports it", async () => {
    const h = makeHarness({ records: [COMPLETED] });
    const result = await cancelCoverageRun(h.ctx, { coverageRunId: "9" }, createFakeClock());
    expect(h.cancels).toEqual([]);
    expect(result.structuredContent).toMatchObject({ status: "completed" });
    expect(String((result.structuredContent as { note: string }).note)).toContain("nothing to cancel");
  });

  it("cancel with a namespace that differs from the record's cancels nothing", async () => {
    const h = makeHarness({ records: [runRecord()] });
    const result = await cancelCoverageRun(h.ctx, { coverageRunId: "9", namespace: "USER" }, createFakeClock());
    expect(result.isError).toBe(true);
    expect(h.cancels).toEqual([]);
  });
});
