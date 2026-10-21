/**
 * Story 40.2 live gate: the class-source coverage summary, `minCoverage`, the Cobertura export and the loaded-routines check,
 * driven on the REAL wire against a disposable namespace, in the default suite (rule #59: each row names the path it guards).
 *
 * Path: the BUILT iris-dev-mcp and iris-admin-mcp dists, spawned as child processes and driven by the MCP SDK `Client` over
 * stdio -> `iris_test_coverage` / `iris_test_status` -> the coverage routes of the ExecuteMCPv2 service -> a supervisor job and a
 * runner job that run `Story402.FixtureTest` in `EXECMCPTMP402A` under an instance-wide Line-by-Line session. The oracles are the
 * values captured live (`coverage-fixture.ts`, Rule #36), the class documents read by raw Atelier `GET /doc`, the raw coverage
 * routes, the written files read from disk and the monitor read through the fixture class; never the tools under test. Rows 1 to 14
 * of the matrix run, with row 13b, each self-contained, and every row ends by asserting the monitor is idle and the ownership node is unset.
 *
 *  - Rows 1 to 3: the summary oracle, the mapping onto the stored class document (which names the statement at every reported line),
 *    and the non-canonical layout (the stored numbering differs from the uploaded text's).
 *  - Rows 4 to 6: the verdict (fail without a tool error, pass at the boundary, unrounded comparison).
 *  - Row 7: the companion reproduces the primary call's result from the handle alone.
 *  - Rows 8 to 12: the Cobertura export (default-disabled, the file against the pinned DTD's content model, byte-identical re-export,
 *    runs that are not complete, bad arguments).
 *  - Row 13: a routine that disappears before the runner's `Start` ends the run `failed`, the runner stops its own session at once.
 *  - Row 13b: the same when every listed routine disappears, so the session monitors none and only its scope can prove it.
 *  - Row 14: a terminal run record at the largest size a run can hold is read in well under 2 seconds.
 *
 * This gate, the Story 40.1 gates, the Story 40.2 QA gate, the two Story 40.3 gates, the Epic 40 capstone and the Story 40.4 QA gate are the only ones that start Line-by-Line sessions (the package runs its files serially,
 * `fileParallelism: false`). It starts every row with the monitor idle: when a session it did not start is active, an armed gate fails
 * and names it, an unarmed one skips, and the session is left alone. No production is started.
 *
 * Fixtures: the disposable namespace `EXECMCPTMP402A` (the `Story402` classes), its database file, the HSCUSTOM class
 * `ExecuteMCPv2.Temp.Story391Fixture`, the gate's own temporary directory and one synthetic run record, all removed in `afterAll`,
 * which also asserts nothing is left and the monitor is idle.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773, `_SYSTEM`, HSCUSTOM). A
 * missing or stale dist, an unresolvable SDK or an unreachable IRIS skips each row with the reason, or fails with "may not be
 * skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseXml, validateCobertura } from "../../../../scripts/lib/cobertura-dtd.mjs";
import {
  allText,
  assertDeployedBootstrapVersion,
  atelierDocument,
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
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
} from "./interop-namespace-fixture.js";
import { monitorGate, sleep } from "./monitor-gate-helpers.js";
import {
  STORY402_FIXTURE_NEVER_EXECUTABLE,
  STORY402_FIXTURE_ROUTINE_STABLE,
  STORY402_FIXTURE_SOURCE_VALUES,
  STORY402_FIXTURE_STATEMENTS,
  STORY402_LAYOUT_ROUTINE,
  STORY402_LAYOUT_SOURCE,
  STORY402_LAYOUT_SOURCE_VALUES,
  STORY402_LAYOUT_STATEMENTS,
  seedReportFixture,
  setSlowTestHang,
} from "./coverage-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-2-coverage-reports-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The one scratch namespace, holding the Story402 classes (no Interoperability). */
const NS_A = "EXECMCPTMP402A";
const NAMESPACES = [NS_A];

/** The operator enables the write tool and the companion's cancel and export; the plain session below sets nothing. */
const ENABLED_GOVERNANCE = JSON.stringify({
  global: { iris_test_coverage: true, "iris_test_status:cancel": true, "iris_test_status:export": true },
});

/** The route below the web port, for raw HTTP. */
const COVERAGE_ROUTE = "/api/executemcp/v2/dev/test/coverage";

/**
 * The routines of the sessions a row of this gate may leave behind, for the safety net (the first is the usual run's). The empty set
 * is a session that monitors no routine (row 13b): the fixture proves it by the ownership node's process list and routine count.
 */
const SUITE_ROUTINE_SETS = ["Story402.Fixture.1,Story402.Layout.1", "Story402.Fixture.1", ""];

/** The id of the synthetic run record of row 14: above every id a real run gets. */
const LARGE_RUN_ID = 990000001;

/**
 * The fields of the Status record of a completed run that was released by its runner, as Story 40.1 returned them. Story 40.2's Status
 * route returns a superset (AD-33): these keys, `sources` always, and `minCoverage` when the run was started with one.
 */
const STATUS_KEYS_40_1 = [
  "cancelRequested",
  "coverageRunId",
  "finishedAt",
  "level",
  "namespace",
  "pid",
  "releasedBy",
  "routines",
  "runIndex",
  "runnerAlive",
  "runnerPid",
  "startedAt",
  "status",
  "supervisorAlive",
  "target",
  "unmeasured",
];

/** The run's classes in the usual order: two measured, one not compiled. */
const CLASSES = ["Story402.Fixture", "Story402.Layout", "Story402.Missing"];

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let devPlain: WireSession;
let admin: WireSession;
let tempDir = "";

const { fixtureCall, monitorState, coverageGlobal, runCounter, expectMonitorIdle, releaseLeftoverSession } = monitorGate({
  dev: () => dev,
  suiteRoutineSets: SUITE_ROUTINE_SETS,
});

function wireOptions(pkg: string): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: distEntry(REPO_ROOT, pkg), target: TARGET, clientName: "story-40-2-live-gate" };
}

/** The target of the raw Atelier oracle: the scratch namespace A. */
const oracleTarget = (): typeof TARGET => ({ ...TARGET, namespace: NS_A });

type Range = [number, number];

interface MethodSummary {
  method: string;
  line: number | null;
  executableLines: number;
  coveredLines: number;
  percent: number | null;
  uncoveredRanges: Range[];
  reason?: string;
}

interface ClassSourceContent {
  executableLines: number;
  coveredLines: number;
  percent: number | null;
  executableRanges: Range[];
  coveredRanges: Range[];
  uncoveredRanges: Range[];
  methods: MethodSummary[];
  generated: { executableLines: number; coveredLines: number };
  reason?: string;
}

interface RoutineValues {
  routine: string;
  lines: number;
  executableLines: number;
  coveredLines: number;
  percent: number | null;
  executableRanges: Range[];
  coveredRanges: Range[];
}

interface Verdict {
  minCoverage: number;
  overall: string;
  percent: number | null;
  classes: Array<{ class: string; verdict: string; percent: number | null; reason?: string }>;
}

interface CoverageContent {
  status: string;
  total?: number;
  passed?: number;
  coverageRunId: number;
  runIndex: number | null;
  namespace: string;
  error?: string;
  reclaimed?: unknown;
  cobertura?: { outputPath: string; bytes: number; classes: number; lines: number };
  coverage?: {
    complete: boolean;
    classes: Array<{ class: string; routines: RoutineValues[]; source?: ClassSourceContent }>;
    unmeasured: Array<{ class: string; reason: string }>;
    source?: { executableLines: number; coveredLines: number; percent: number | null };
    verdict?: Verdict;
  };
}

/** The structured content of a tool call that must not be an error. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

/** `iris_test_coverage` over A for the oracle run, with `overrides`. */
function coverage(overrides: Record<string, unknown> = {}): Promise<WireToolResult> {
  return dev.call("iris_test_coverage", {
    target: "Story402.FixtureTest",
    level: "class",
    classes: CLASSES,
    namespace: NS_A,
    ...overrides,
  });
}

/** A start of `Story402.SlowTest` with a 1 second budget: returns the `running` result. */
async function startSlow(): Promise<CoverageContent> {
  const content = succeeded<CoverageContent>(
    await coverage({ target: "Story402.SlowTest", classes: ["Story402.Fixture"], timeout: 1 }),
  );
  expect(content.status, "the budget expired with the run still executing").toBe("running");
  return content;
}

/** The companion's poll by the handle alone: through the session's `raw` call, so no namespace is sent. */
function poll(session: WireSession, coverageRunId: number | string): Promise<WireToolResult> {
  return session.raw("iris_test_status", { action: "poll", coverageRunId: String(coverageRunId) });
}

/** The companion's export by the handle alone. */
function exportRun(session: WireSession, coverageRunId: number | string, outputPath: string, extra: Record<string, unknown> = {}): Promise<WireToolResult> {
  return session.raw("iris_test_status", { action: "export", coverageRunId: String(coverageRunId), outputPath, ...extra });
}

/** The Status route of the service, raw: its HTTP status and the run record. */
async function rawStatus(coverageRunId: number): Promise<{ status: number; run: Record<string, unknown> }> {
  const answer = await rawIrisRequest(TARGET, `${COVERAGE_ROUTE}?id=${coverageRunId}`, { method: "GET" });
  const body = answer.json as { result?: Record<string, unknown> } | undefined;
  return { status: answer.status, run: body?.result ?? {} };
}

/** A path below the gate's own temporary directory. */
function tempPath(...segments: string[]): string {
  return path.join(tempDir, ...segments);
}

/** The class source of one class of a coverage result. */
function sourceOf(content: CoverageContent, className: string): ClassSourceContent {
  const entry = content.coverage?.classes.find((candidate) => candidate.class === className);
  expect(entry?.source, `${className} has a class-source result`).toBeDefined();
  return entry?.source as ClassSourceContent;
}

/** The class source of a class without its generated-line counts that depend on whether the run is the first after a compile. */
function withoutGeneratedCovered(source: ClassSourceContent): Omit<ClassSourceContent, "generated"> & { generated: { executableLines: number } } {
  return { ...source, generated: { executableLines: source.generated.executableLines } };
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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.2 live gate may not be skipped: ${skipReason}`);
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
    if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.2 live gate may not be skipped: ${named}`);
    skipReason = named;
    return;
  }

  tempDir = mkdtempSync(path.join(tmpdir(), "story-40-2-gate-"));
  await removeInteropNamespace(admin, dev, NS_A);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);
  await createInteropNamespace(admin, dev, NS_A, { interop: false });
  await seedReportFixture(dev, NS_A);

  // A positive control: the same check that must read empty after the run sees the namespace now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees the namespace while it exists").toEqual(
    expect.arrayContaining([`namespace ${NS_A}`, `database configuration ${NS_A}`]),
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
    await attempt("letting go of a runner lock left behind", async () => {
      await fixtureCall("ReleaseRunnerLock", [(await runCounter()) + 1]);
    });
    await attempt("removing the large run record", async () => {
      await fixtureCall("ClearLargeRun", [LARGE_RUN_ID]);
      expect((await coverageGlobal(`"run",${LARGE_RUN_ID},"status"`)).defined, "no large run record is left").toBe(false);
    });
    await attempt("the monitor is idle", async () => {
      expect((await monitorState()).active, "the monitor is idle after the run").toBe(0);
    });
    await attempt("no coverage ownership node is left", async () => {
      expect((await coverageGlobal('"session"')).defined, "no suite session node after the run").toBe(false);
    });
    await attempt(`removing ${NS_A}`, () => removeInteropNamespace(admin, dev, NS_A));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, NAMESPACES), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the temporary directory", async () => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      expect(tempDir !== "" && existsSync(tempDir), "the temporary directory is gone").toBe(false);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story402", "Story391Fixture"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [admin, devPlain, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- Rows 1 to 3: the summary oracle and the mapping ------------------------------------

describe("Story 40.2: the class-source summary (AC-1, matrix rows 1 to 3)", () => {
  it("row 1: the summary of Story402.Fixture and Story402.Layout deep-equals the live oracle, the totals add up, the 40.1 routine fields are unchanged, Story402.Missing is not-compiled, and the monitor is idle", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await coverage();
    const content = succeeded<CoverageContent>(result);
    expect(content).toMatchObject({ status: "completed", total: 1, passed: 1, namespace: NS_A });
    expect(content.coverage?.complete).toBe(true);

    const fixture = sourceOf(content, "Story402.Fixture");
    expect(withoutGeneratedCovered(fixture)).toEqual({ ...STORY402_FIXTURE_SOURCE_VALUES, generated: { executableLines: 23 } });
    expect(fixture.generated.coveredLines, "generated code that ran is counted, not pinned").toBeGreaterThanOrEqual(0);
    expect(fixture.generated.coveredLines).toBeLessThanOrEqual(23);
    expect(sourceOf(content, "Story402.Layout")).toEqual(STORY402_LAYOUT_SOURCE_VALUES);
    expect(content.coverage?.source).toEqual({ executableLines: 27, coveredLines: 24, percent: 88.89 });
    expect(content.coverage?.unmeasured).toEqual([{ class: "Story402.Missing", reason: "not-compiled" }]);
    expect(content.coverage?.verdict, "no minimum, no verdict").toBeUndefined();

    // The 40.1 fields of the routines are unchanged: the INT routines of the two classes.
    const fixtureRoutine = content.coverage?.classes[0]?.routines[0];
    expect(fixtureRoutine).toMatchObject(STORY402_FIXTURE_ROUTINE_STABLE);
    expect(content.coverage?.classes[1]?.routines).toEqual([STORY402_LAYOUT_ROUTINE]);

    const lines = allText(result).split("\n");
    expect(lines[0]).toBe(`Coverage run ${content.coverageRunId} completed: 1 tests, 1 passed, 0 failed, 0 skipped.`);
    expect(lines.slice(1, 6)).toEqual([
      "Story402.Fixture: 22 of 23 class lines covered (95.65%); uncovered 31",
      "  Macro: 4 of 5 (80%); uncovered 31",
      "Story402.Layout: 2 of 4 class lines covered (50%); uncovered 21, 26",
      "  Gap: 0 of 1 (0%); uncovered 21",
      "  Inst: 0 of 1 (0%); uncovered 26",
    ]);
    expect(lines[6]).toMatch(/^Story402\.Fixture\.1: \d+ of 46 executable INT lines covered/);
    expect(lines[7]).toBe("Story402.Layout.1: 2 of 4 executable INT lines covered (50%); uncovered 6, 8");
    expect(lines[8]).toBe("Not measured: Story402.Missing (not-compiled)");
    expect(lines).toHaveLength(9);

    // The Status route returns a superset (AD-33): every field of the 40.1 record, and `sources`; no `minCoverage` without a minimum.
    const raw = await rawStatus(content.coverageRunId);
    expect(Object.keys(raw.run).sort(), "the raw Status record: the 40.1 keys plus sources").toEqual([...STATUS_KEYS_40_1, "sources"].sort());
    expect(raw.run["routines"], "the 40.1 routines are the tool's").toEqual(
      content.coverage?.classes.flatMap((entry) => entry.routines.map((routine) => expect.objectContaining({ routine: routine.routine }))),
    );
    await expectMonitorIdle("row 1");
  }, 180000);

  it("row 2: every reported class line names the statement the oracle expects in the stored class document; a #define, a continuation line, a lone brace and a comment are never reported; Generated, Constant and Py are as expected", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded<CoverageContent>(await coverage());
    const fixture = sourceOf(content, "Story402.Fixture");
    const layout = sourceOf(content, "Story402.Layout");

    // The class documents are read by raw Atelier GET /doc, never by the tools under test.
    const fixtureDocument = await atelierDocument(oracleTarget(), "Story402.Fixture.cls");
    const layoutDocument = await atelierDocument(oracleTarget(), "Story402.Layout.cls");
    const reported = (ranges: Range[]): number[] => ranges.flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, index) => start + index));
    const executableFixture = reported(fixture.executableRanges);
    expect(executableFixture, "exactly the oracle's lines are executable").toEqual(Object.keys(STORY402_FIXTURE_STATEMENTS).map(Number));
    for (const line of executableFixture) {
      expect((fixtureDocument.content[line - 1] ?? "").trim(), `Story402.Fixture line ${line}`).toBe(STORY402_FIXTURE_STATEMENTS[line]);
    }
    const executableLayout = reported(layout.executableRanges);
    expect(executableLayout).toEqual(Object.keys(STORY402_LAYOUT_STATEMENTS).map(Number));
    for (const line of executableLayout) {
      expect((layoutDocument.content[line - 1] ?? "").trim(), `Story402.Layout line ${line}`).toBe(STORY402_LAYOUT_STATEMENTS[line]);
    }

    // Fixture's only uncovered line is `Quit "error"` in Macro.
    expect(reported(fixture.uncoveredRanges)).toEqual([31]);
    expect((fixtureDocument.content[30] ?? "").trim()).toBe('Quit "error"');
    expect(fixture.methods.find((method) => method.method === "Macro")?.uncoveredRanges).toEqual([[31, 31]]);

    // Lines that are never class lines: a #define, comments, continuation lines of a multi-line statement and lone braces.
    const never = fixtureDocument.content
      .map((text, index) => ({ line: index + 1, text: text.trim() }))
      .filter((entry) => STORY402_FIXTURE_NEVER_EXECUTABLE.includes(entry.text));
    expect(never.length, "the document has those lines").toBeGreaterThanOrEqual(9);
    for (const entry of never) expect(executableFixture, `line ${entry.line} (${entry.text}) is not executable`).not.toContain(entry.line);

    // Methods without class-source lines, each with its reason or none.
    expect(fixture.methods.find((method) => method.method === "Generated")).toMatchObject({ reason: "generator", executableLines: 0 });
    expect(fixture.methods.find((method) => method.method === "Constant")).toMatchObject({ executableLines: 0, percent: null });
    expect(fixture.methods.find((method) => method.method === "Constant")).not.toHaveProperty("reason");
    expect(layout.methods.find((method) => method.method === "Py")).toMatchObject({ reason: "not-objectscript", executableLines: 0 });
    expect(fixture.generated.executableLines, "the compiler's own code is counted per class, never as source lines").toBe(23);
    await expectMonitorIdle("row 2");
  }, 180000);

  it("row 3: Story402.Layout, uploaded in a non-canonical layout, reports the line numbers of the document IRIS stores, and the uploaded text numbers them differently", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded<CoverageContent>(await coverage());
    const layout = sourceOf(content, "Story402.Layout");

    const stored = await atelierDocument(oracleTarget(), "Story402.Layout.cls");
    const uploaded = STORY402_LAYOUT_SOURCE.split("\n");
    const storedSet = stored.content.findIndex((text) => text.includes("Set tX = pN")) + 1;
    const uploadedSet = uploaded.findIndex((text) => text.includes("Set tX = pN")) + 1;
    expect(layout.methods.find((method) => method.method === "Spaced")?.line, "the declaration line is the stored one").toBe(
      stored.content.findIndex((text) => text.startsWith("ClassMethod Spaced(")) + 1,
    );
    expect(layout.executableRanges.slice(0, 2), "Spaced's two lines are the stored document's").toEqual([[storedSet, storedSet], [storedSet + 2, storedSet + 2]]);
    expect(storedSet).not.toBe(uploadedSet);
    expect(uploadedSet, "the uploaded text numbers the same statement one line earlier").toBe(8);
    expect(storedSet).toBe(9);
    // IRIS stored its own layout: the blank line after `{`, one signature line, one blank line between members.
    expect(stored.content.slice(0, 8)).toEqual([
      "/// Synthetic non-canonical layout (Story 40.2).",
      "Class Story402.Layout",
      "{",
      "",
      "/// doc one",
      "/// doc two",
      "ClassMethod Spaced(pN As %Integer) As %Integer",
      "{",
    ]);
    expect(stored.content[18], "the two-line signature was joined").toBe("ClassMethod Gap(pA As %Integer, pB As %Integer) As %Integer");
    await expectMonitorIdle("row 3");
  }, 180000);
});

// -- Rows 4 to 6: the verdict -------------------------------------------------------------

describe("Story 40.2: minCoverage and the verdict (AC-2, matrix rows 4 to 6)", () => {
  it("row 4: minCoverage 90 fails without a tool error: Fixture passes, Layout fails, Missing fails with not-compiled, and the text names Layout and Missing", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await coverage({ minCoverage: 90 });
    expect(result.isError, allText(result)).toBeFalsy();
    const content = result.structuredContent as unknown as CoverageContent;
    expect(content.coverage?.verdict).toEqual({
      minCoverage: 90,
      overall: "fail",
      percent: 88.89,
      classes: [
        { class: "Story402.Fixture", verdict: "pass", percent: 95.65 },
        { class: "Story402.Layout", verdict: "fail", percent: 50 },
        { class: "Story402.Missing", verdict: "fail", percent: null, reason: "not-compiled" },
      ],
    });
    expect(allText(result).split("\n")[1]).toBe(
      "Coverage target 90%: FAIL (88.89% overall); failing: Story402.Layout 50%, Story402.Missing (not-compiled)",
    );
    const raw = await rawStatus(content.coverageRunId);
    expect(raw.run["minCoverage"], "the minimum is stored with the run").toBe(90);
    expect(Object.keys(raw.run).sort(), "the raw Status record: the 40.1 keys plus sources and the stored minimum").toEqual(
      [...STATUS_KEYS_40_1, "minCoverage", "sources"].sort(),
    );
    await expectMonitorIdle("row 4");
  }, 180000);

  it("row 5: a class at exactly the minimum passes (Layout at its own 50%), and so does overall", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await coverage({ classes: ["Story402.Fixture", "Story402.Layout"], minCoverage: 50 });
    expect(result.isError, allText(result)).toBeFalsy();
    const verdict = (result.structuredContent as unknown as CoverageContent).coverage?.verdict;
    expect(verdict?.classes.map((entry) => [entry.class, entry.verdict])).toEqual([
      ["Story402.Fixture", "pass"],
      ["Story402.Layout", "pass"],
    ]);
    expect(verdict?.overall).toBe("pass");
    expect(allText(result).split("\n")[1]).toBe("Coverage target 50%: PASS (88.89% overall)");
    await expectMonitorIdle("row 5");
  }, 180000);

  it("row 6: the aggregate is compared unrounded: a minimum equal to the displayed 88.89 fails, and 88.88 passes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const failing = await coverage({ classes: ["Story402.Fixture", "Story402.Layout"], minCoverage: 88.89 });
    expect(failing.isError, allText(failing)).toBeFalsy();
    const failVerdict = (failing.structuredContent as unknown as CoverageContent).coverage?.verdict;
    expect(failVerdict?.percent, "the displayed aggregate rounds to the minimum").toBe(88.89);
    expect(failVerdict?.overall, "but the unrounded ratio 24/27 is below it").toBe("fail");

    const passing = await coverage({ classes: ["Story402.Fixture", "Story402.Layout"], minCoverage: 88.88 });
    expect((passing.structuredContent as unknown as CoverageContent).coverage?.verdict?.overall).toBe("pass");
    await expectMonitorIdle("row 6");
  }, 240000);

  it("row 16: a bad minCoverage is refused by the schema, and a raw Start with 101 is refused by the route; nothing is started", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const before = await runCounter();
    for (const minCoverage of [-1, 101, "x"]) {
      let refused: { isError: boolean; text: string };
      try {
        const result = await coverage({ minCoverage });
        refused = { isError: result.isError === true, text: allText(result) };
      } catch (error) {
        refused = { isError: true, text: error instanceof Error ? error.message : String(error) };
      }
      expect(refused.isError, `minCoverage ${JSON.stringify(minCoverage)}: ${refused.text}`).toBe(true);
    }
    const answer = await rawIrisRequest(TARGET, COVERAGE_ROUTE, {
      method: "POST",
      body: { target: "Story402.FixtureTest", level: "class", classes: ["Story402.Fixture"], namespace: NS_A, maxSeconds: 3600, maxLines: 200000, minCoverage: 101 },
    });
    const body = answer.json as { status?: { errors?: Array<{ error?: string }> } };
    expect(body.status?.errors?.[0]?.error ?? "").toContain("'minCoverage' must be a number from 0 to 100");
    expect(await runCounter(), "no run id was allocated").toBe(before);
    await expectMonitorIdle("row 16");
  }, 120000);
});

// -- Row 7: the companion reproduces the result -------------------------------------------

describe("Story 40.2: the companion reproduces the result from the handle alone (AC-3, AD-16, matrix row 7)", () => {
  it("row 7: iris_test_status poll of rows 1 and 4 by coverageRunId deep-equals the primary call's structuredContent, source and verdict included, and a second poll is equal", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const overrides of [{}, { minCoverage: 90 }]) {
      const primary = await coverage(overrides);
      const content = primary.structuredContent as unknown as CoverageContent;
      expect(content.status).toBe("completed");
      const first = await poll(dev, content.coverageRunId);
      expect(first.isError, allText(first)).toBeFalsy();
      expect(first.structuredContent).toEqual(primary.structuredContent);
      expect(allText(first)).toBe(allText(primary));
      const second = await poll(dev, content.coverageRunId);
      expect(second.structuredContent, "a second poll deep-equals the first").toEqual(first.structuredContent);
      expect(Boolean((first.structuredContent as unknown as CoverageContent).coverage?.verdict), "the verdict is there exactly when a minimum was given").toBe(
        "minCoverage" in overrides,
      );
    }
    await expectMonitorIdle("row 7");
  }, 240000);
});

// -- Rows 8 to 12: the Cobertura export ------------------------------------------------------

/** The coverage object of a parsed Cobertura file as [package, class, filename, methods, lines] tuples, for comparison with the summary. */
function coberturaClasses(xml: string): Array<{
  package: string;
  class: string;
  filename: string;
  methods: Array<{ name: string; lines: Array<[number, number]> }>;
  lines: Array<[number, number]>;
}> {
  const root = parseXml(xml).root;
  const linesOf = (element: { children: Array<{ name: string; attributes: Record<string, string> }> }): Array<[number, number]> =>
    element.children.map((line) => [Number(line.attributes["number"]), Number(line.attributes["hits"])]);
  type Node = { name: string; attributes: Record<string, string>; children: Node[] };
  const found: ReturnType<typeof coberturaClasses> = [];
  for (const packages of (root as Node).children.filter((child) => child.name === "packages")) {
    for (const pack of packages.children) {
      for (const classes of pack.children) {
        for (const klass of classes.children) {
          const methods = klass.children.find((child) => child.name === "methods")?.children ?? [];
          const lines = klass.children.find((child) => child.name === "lines");
          found.push({
            package: pack.attributes["name"] as string,
            class: klass.attributes["name"] as string,
            filename: klass.attributes["filename"] as string,
            methods: methods.map((method) => ({
              name: method.attributes["name"] as string,
              lines: linesOf(method.children.find((child) => child.name === "lines") as Node),
            })),
            lines: linesOf(lines as Node),
          });
        }
      }
    }
  }
  return found;
}

describe("Story 40.2: the Cobertura export (AC-4, AC-5, AC-6, matrix rows 8 to 12)", () => {
  it("row 8: under default governance, export is refused with GOVERNANCE_DISABLED on iris_test_status:export and no file is written", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const primary = succeeded<CoverageContent>(await coverage());
    const target = tempPath("disabled", "coverage.xml");
    const refused = await exportRun(devPlain, primary.coverageRunId, target);
    expect(refused.isError, allText(refused)).toBe(true);
    expect(refused.structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED", action: "iris_test_status:export" });
    expect(existsSync(target), "no file").toBe(false);
    expect(existsSync(path.dirname(target)), "not even its directory").toBe(false);
    const polled = await poll(devPlain, primary.coverageRunId);
    expect(polled.isError, "poll is a read and stays enabled").toBeFalsy();
    await expectMonitorIdle("row 8");
  }, 180000);

  it("row 9: an enabled export writes a Cobertura file that validates against the pinned DTD's content model and, parsed back, equals the summary", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const primary = await coverage();
    const content = succeeded<CoverageContent>(primary);
    const target = tempPath("x", "y", "coverage.xml");
    expect(existsSync(path.dirname(target)), "the parents do not exist yet").toBe(false);
    const exported = await exportRun(dev, content.coverageRunId, target);
    expect(exported.isError, allText(exported)).toBeFalsy();

    const xml = readFileSync(target, "utf8");
    expect(validateCobertura(xml), "the file is valid against the pinned DTD's content model").toEqual([]);
    expect(xml.startsWith('<?xml version="1.0" ?>\n<!DOCTYPE coverage SYSTEM "https://raw.githubusercontent.com/cobertura/web/master/htdocs/xml/coverage-04.dtd">\n')).toBe(true);
    expect(xml, "no <sources> without a source root").not.toContain("<sources>");
    expect(xml, "a <method> carries no complexity attribute, which the pinned DTD does not declare").not.toMatch(/<method [^>]*complexity/);
    const classes = coberturaClasses(xml);
    expect(classes.map((entry) => [entry.package, entry.class, entry.filename])).toEqual([
      ["Story402", "Story402.Fixture", "Story402/Fixture.cls"],
      ["Story402", "Story402.Layout", "Story402/Layout.cls"],
    ]);
    const fixture = sourceOf(content, "Story402.Fixture");
    const layout = sourceOf(content, "Story402.Layout");
    const reported = (ranges: Range[]): number[] => ranges.flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, index) => start + index));
    for (const [entry, source] of [[classes[0], fixture], [classes[1], layout]] as const) {
      const covered = new Set(reported(source.coveredRanges));
      expect(entry?.lines.map(([line]) => line), `${entry?.class}: the file's lines are the summary's executable lines`).toEqual(
        reported(source.executableRanges),
      );
      for (const [line, hits] of entry?.lines ?? []) expect(hits > 0, `${entry?.class} line ${line}: hits above 0 exactly on the covered lines`).toBe(covered.has(line));
      expect(entry?.methods.map((method) => method.name), `${entry?.class}: one method per mapped method with an executable line`).toEqual(
        source.methods.filter((method) => method.executableLines > 0).map((method) => method.method),
      );
      expect(entry?.methods.flatMap((method) => method.lines), "the methods' lines are the class's lines").toEqual(entry?.lines);
    }
    expect(classes.flatMap((entry) => entry.lines.map(([line]) => line)).length).toBe(content.coverage?.source?.executableLines);

    // The result is the poll result plus cobertura.
    const polled = await poll(dev, content.coverageRunId);
    const { cobertura, ...rest } = exported.structuredContent as unknown as CoverageContent & Record<string, unknown>;
    expect(rest).toEqual(polled.structuredContent);
    expect(cobertura).toEqual({ outputPath: path.resolve(target), bytes: Buffer.byteLength(xml), classes: 2, lines: 27 });
    expect(allText(exported).split("\n").pop()).toBe(`Cobertura XML written to ${path.resolve(target)} (${Buffer.byteLength(xml)} bytes).`);
    expect(readdirSync(path.dirname(target)), "no temporary file is left").toEqual(["coverage.xml"]);
    await expectMonitorIdle("row 9");
  }, 180000);

  it("row 10: a second export with a source root is identical but for the one <sources> element, and a third export to the first path overwrites it with identical bytes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded<CoverageContent>(await coverage());
    const first = tempPath("r10", "first.xml");
    const second = tempPath("r10", "second", "rooted.xml");
    expect((await exportRun(dev, content.coverageRunId, first)).isError).toBeFalsy();
    expect((await exportRun(dev, content.coverageRunId, second, { sourceRoot: "src" })).isError).toBeFalsy();
    const plain = readFileSync(first, "utf8");
    const rooted = readFileSync(second, "utf8");
    expect(rooted).toBe(plain.replace(/(timestamp="\d+">\n)/, "$1  <sources>\n    <source>src</source>\n  </sources>\n"));
    expect(validateCobertura(rooted)).toEqual([]);
    expect(rooted).toContain("<sources>\n    <source>src</source>\n  </sources>");

    writeFileSync(first, "overwritten by something else");
    expect((await exportRun(dev, content.coverageRunId, first)).isError).toBeFalsy();
    expect(readFileSync(first, "utf8"), "the third export overwrote the file with identical bytes").toBe(plain);
    await expectMonitorIdle("row 10");
  }, 180000);

  it("row 11: a running run, then the same run after a cancel, cannot be exported: isError, the text names the status, no file, and the run is unaffected", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await setSlowTestHang(dev, NS_A, 20);
    const running = await startSlow();
    const target = tempPath("r11", "coverage.xml");
    try {
      const refusedRunning = await exportRun(dev, running.coverageRunId, target);
      expect(refusedRunning.isError, allText(refusedRunning)).toBe(true);
      expect(allText(refusedRunning)).toContain("status is running");
      expect(existsSync(target), "no file").toBe(false);
      const still = await poll(dev, running.coverageRunId);
      expect((still.structuredContent as unknown as CoverageContent).status, "the run is unaffected by the refused export").toBe("running");
      expect((await monitorState()).active, "and still holds the monitor").toBe(1);
    } finally {
      const cancelled = await dev.raw("iris_test_status", { action: "cancel", coverageRunId: String(running.coverageRunId) });
      expect(cancelled.structuredContent).toMatchObject({ status: "cancelled", reason: "cancel" });
    }
    const refusedCancelled = await exportRun(dev, running.coverageRunId, target);
    expect(refusedCancelled.isError, allText(refusedCancelled)).toBe(true);
    expect(allText(refusedCancelled)).toContain("status is cancelled");
    expect(existsSync(target), "no file").toBe(false);
    expect(existsSync(path.dirname(target)), "not even its directory").toBe(false);
    await expectMonitorIdle("row 11");
  }, 240000);

  it("row 12: a relative path, one with .., one ending .txt, a missing one and one with jobId are errors that name outputPath, nothing is sent to IRIS (a run that does not exist is never looked up) and no file is written", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // The handle names no run. A call that read the run first would answer "was not found"; a validation error never reaches IRIS.
    const ghost = "999999999";
    const before = readdirSync(tempDir);
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ["relative", { action: "export", coverageRunId: ghost, outputPath: "out/coverage.xml" }, /outputPath 'out\/coverage.xml' must be an absolute path/],
      ["a .. segment", { action: "export", coverageRunId: ghost, outputPath: `${tempDir}/../coverage.xml` }, /outputPath .* must not contain '\.\.'/],
      ["not .xml", { action: "export", coverageRunId: ghost, outputPath: tempPath("coverage.txt") }, /outputPath .* must end in \.xml/],
      ["missing", { action: "export", coverageRunId: ghost }, /needs outputPath/],
      ["with jobId", { action: "export", coverageRunId: ghost, outputPath: tempPath("c.xml"), jobId: "31797604" }, /cannot be combined with jobId or runIndex/],
      ["with poll", { action: "poll", coverageRunId: ghost, outputPath: tempPath("c.xml") }, /only for action "export"/],
    ];
    for (const [name, args, expected] of cases) {
      const result = await dev.raw("iris_test_status", args);
      expect(result.isError, `${name}: ${allText(result)}`).toBe(true);
      expect(allText(result), name).toMatch(expected);
      expect(allText(result), `${name}: validation comes before any lookup`).not.toContain("was not found");
    }
    expect(readdirSync(tempDir), "no file or directory was written").toEqual(before);
    // Control: the same handle with a good path IS looked up, and the error says so.
    const control = await exportRun(dev, ghost, tempPath("control", "c.xml"));
    expect(control.isError).toBe(true);
    expect(allText(control)).toContain("was not found");
    expect(existsSync(tempPath("control"))).toBe(false);
    await expectMonitorIdle("row 12");
  }, 120000);
});

// -- Row 13: a routine that disappears before the runner's Start (DW-598) ------------------------

/**
 * A run of `classes` (one of them `Story402.Gone`) whose runner waits for its owner lock while `Story402.Gone`'s compiled routine
 * is deleted, so the runner's `Start` skips that routine without an error. The class is compiled again first, forced (no up-to-date
 * skip), because an earlier row deleted its object code. Returns the run's id and the tool result.
 */
async function runWithGoneRoutineDeleted(classes: string[]): Promise<{ next: number; result: WireToolResult }> {
  const compiled = await dev.call("iris_doc_compile", { namespace: NS_A, doc: "Story402.Gone.cls", flags: "ck" });
  expect(compiled.isError, allText(compiled)).toBeFalsy();

  const next = (await runCounter()) + 1;
  expect(await fixtureCall("HoldRunnerLock", [next, 8])).toBe("held");
  let pending: Promise<WireToolResult> | undefined;
  let result: WireToolResult;
  try {
    pending = coverage({ classes });
    pending.catch(() => undefined);
    const deadline = Date.now() + 15000;
    while (!(await coverageGlobal(`"run",${next},"status"`)).defined && Date.now() < deadline) await sleep(100);
    expect((await coverageGlobal(`"run",${next},"status"`)).value, "the run exists and its runner is still waiting for its lock").toBe("starting");
    expect(await fixtureCall("DeleteObjectCode", [NS_A, "Story402.Gone.1"])).toBe("deleted");
  } finally {
    // The holder lets go and the runner takes the lock for its whole life, so whether the lock is free again says nothing about the
    // outcome: the run's own result does (a holder that never let go would end the run without naming the routine).
    await fixtureCall("ReleaseRunnerLock", [next]);
    result = await (pending as Promise<WireToolResult>);
  }
  return { next, result };
}

describe("Story 40.2: a session that did not load every listed routine runs no test (AC-7, DW-598, matrix row 13)", () => {
  it("row 13: Story402.Gone's compiled routine is deleted while the runner waits for its lock: the run ends failed naming Story402.Gone.1, no test ran, the runner stopped its own session at once, and the next run completes with no reclaim", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { next, result } = await runWithGoneRoutineDeleted(["Story402.Fixture", "Story402.Gone"]);

    expect(result.isError, allText(result)).toBe(true);
    const content = result.structuredContent as unknown as CoverageContent;
    expect(content).toMatchObject({ status: "failed", coverageRunId: next, runIndex: null });
    expect(content.error).toContain("Story402.Gone.1");
    expect(content.error).toMatch(/no test was run/i);
    expect((await coverageGlobal(`"run",${next},"testsDone"`)).defined, "no test ran").toBe(false);
    expect((await coverageGlobal(`"run",${next},"runIndex"`)).defined, "no test run was recorded").toBe(false);
    await expectMonitorIdle("row 13, as soon as the run is terminal");
    const raw = await rawStatus(next);
    expect(raw.run["status"]).toBe("failed");
    expect(raw.run["releasedBy"], "the runner stopped its own session").toBe("runner");

    const after = succeeded<CoverageContent>(await coverage({ classes: ["Story402.Fixture", "Story402.Layout"] }));
    expect(after.status).toBe("completed");
    expect(after, "the next run starts normally: nothing was reclaimed").not.toHaveProperty("reclaimed");
    await expectMonitorIdle("row 13, after the next run");
  }, 240000);

  it("row 13b: every listed routine is gone, so the session monitors none: the run ends failed naming Story402.Gone.1, no test ran, the runner still proved the session by its scope and stopped it at once, and the next run completes with no reclaim", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { next, result } = await runWithGoneRoutineDeleted(["Story402.Gone"]);

    expect(result.isError, allText(result)).toBe(true);
    const content = result.structuredContent as unknown as CoverageContent;
    expect(content).toMatchObject({ status: "failed", coverageRunId: next, runIndex: null });
    expect(content.error).toContain("Story402.Gone.1");
    expect(content.error).toMatch(/no test was run/i);
    expect((await coverageGlobal(`"run",${next},"testsDone"`)).defined, "no test ran").toBe(false);
    expect((await coverageGlobal(`"run",${next},"runIndex"`)).defined, "no test run was recorded").toBe(false);
    await expectMonitorIdle("row 13b, as soon as the run is terminal");
    const raw = await rawStatus(next);
    expect(raw.run["status"]).toBe("failed");
    expect(raw.run["releasedBy"], "the runner stopped its own session, which monitored no routine").toBe("runner");

    const after = succeeded<CoverageContent>(await coverage({ classes: ["Story402.Fixture", "Story402.Layout"] }));
    expect(after.status).toBe("completed");
    expect(after, "the next run starts normally: nothing was reclaimed").not.toHaveProperty("reclaimed");
    await expectMonitorIdle("row 13b, after the next run");
  }, 240000);
});

// -- Row 14: the read at the cap (DW-596) -------------------------------------------------------------

describe("Story 40.2: a terminal record at the largest size a run can hold is read in well under 2 seconds (AC-8, DW-596, matrix row 14)", () => {
  it("row 14: a synthetic completed run of 200,000 INT lines over 4 routines, with hits, skeletons and a source map, is polled with its summary computed, and its Status read is measured", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    try {
      expect(await fixtureCall("SeedLargeRun", [LARGE_RUN_ID])).toBe("200000");

      const startedTool = Date.now();
      const polled = await poll(dev, LARGE_RUN_ID);
      const toolMs = Date.now() - startedTool;
      const content = polled.structuredContent as unknown as CoverageContent;
      expect(content.status).toBe("completed");
      expect(content.coverage?.source, "the summary is computed over the 180,000 class lines").toEqual({ executableLines: 180000, coveredLines: 100000, percent: 55.56 });
      expect(content.coverage?.verdict?.overall).toBe("pass");
      expect(content.coverage?.classes.every((entry) => entry.source?.executableLines === 45000 && entry.source.generated.executableLines === 0)).toBe(true);
      expect(toolMs, `iris_test_status poll returned in ${toolMs} ms`).toBeLessThan(2000);

      const startedRaw = Date.now();
      const raw = await rawIrisRequest(TARGET, `${COVERAGE_ROUTE}?id=${LARGE_RUN_ID}`, { method: "GET" });
      const rawMs = Date.now() - startedRaw;
      expect(raw.status).toBe(200);
      expect(rawMs, `the raw Status read took ${rawMs} ms`).toBeLessThan(2000);

      const inside = JSON.parse(await fixtureCall("MeasureStatus", [LARGE_RUN_ID])) as {
        buildSeconds: number;
        buildAndSerializeSeconds: number;
        bytes: number;
        memoryGrowthKB: number;
      };
      expect(inside.buildAndSerializeSeconds, "building and serializing the record inside IRIS").toBeLessThan(2);
      // eslint-disable-next-line no-console
      console.log(
        `[INFO] ${GATE_TAG}: DW-596 at 200,000 INT lines: Status over HTTP ${rawMs} ms, ${Buffer.byteLength(raw.text)} bytes; ` +
          `iris_test_status poll ${toolMs} ms; inside IRIS build ${inside.buildSeconds} s, build and serialize ${inside.buildAndSerializeSeconds} s, ` +
          `${inside.bytes} bytes, process memory growth ${inside.memoryGrowthKB} KB`,
      );
    } finally {
      expect(await fixtureCall("ClearLargeRun", [LARGE_RUN_ID])).toBe("cleared");
    }
    expect((await coverageGlobal(`"run",${LARGE_RUN_ID},"status"`)).defined, "the large record is gone").toBe(false);
    await expectMonitorIdle("row 14");
  }, 240000);
});
