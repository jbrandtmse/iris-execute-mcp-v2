/**
 * Story 40.3 (QA) live gate: what the Story 40.3 gate leaves open, on the BUILT dev server, in the default suite
 * (Rules #34, #36, #41, #54, #58, #59).
 *
 * Path: the BUILT iris-dev-mcp, iris-admin-mcp and iris-interop-mcp dists, each spawned as its own child process and driven by the
 * MCP SDK `Client` over stdio -> `iris_execute_tests` / `iris_test_coverage` -> `GET /dev/test/production` and the coverage `Start`
 * of the ExecuteMCPv2 service -> `Ens.Director` under Ens's lifecycle lock -> the Atelier work queue or the coverage runner, which run
 * the `Story403` tests in `EXECMCPTMP403W`. The oracles are the values captured live (IRIS 2026.2 build 221U), the production read
 * through the interop tool (name, state, start time and its items), the `%UnitTest_Result` row counts of all five tables read by raw
 * Atelier queries, the processes and the `^%SYS("Ensemble",*)` nodes read through the fixture class, the monitor read through the
 * fixture class and the coverage run record read through `iris_test_status`; never the guard under test.
 *
 * What it adds to the Story 40.3 gate (`story-40-3-testproduction-live-gate.test.ts`):
 *  - Q1: a run with no TestProduction test, at class, method and package level, completes with the structured content of the same
 *    call with no production running, whose key set is pinned, while another production runs and is left untouched (name, state,
 *    start time, items, processes). With Ens's lifecycle lock held elsewhere such a run still proceeds, and a TestProduction run is
 *    the `Unknown` refusal: a run with no TestProduction test never takes the lock.
 *  - Q2: refusals of inputs the first gate does not send: spaces around the method-level colon, a method that does not exist, a
 *    namespace in lower case. Each leaves the other production untouched with its items, and queues nothing in any of the five
 *    `%UnitTest_Result` tables. A class name in another letter case is not a test (today's "No tests found"), and runs nothing. A
 *    method segment holding `;`, `,` or `^` (which the runner reads as more classes, more specs or setup code) is the malformed-target
 *    result and queues nothing, so the TestProduction class it names does not stop the other production.
 *  - Q3: package discovery edges: an abstract base is not listed while its concrete subclass is; a package name that is only the
 *    prefix of another is not that package; a package that mixes plain and TestProduction tests runs whole when nothing else runs;
 *    an uncompiled test reached through two short-name `Extends` (an uncompiled class, then a compiled base) is refused.
 *  - Q4: the run's own productions are those of all its TestProduction tests, so a package whose tests declare two productions
 *    treats a running one of them as its own.
 *  - Q5: `iris_test_coverage` at class, method and package level: the refusal equals `iris_execute_tests`', allocates no run id and
 *    no run record, leaves the monitor idle and the other production untouched; an unreadable state is the `Unknown` refusal; a
 *    plain run is not refused; a compiled class that changed afterwards is judged by its compiled class, where the Atelier path
 *    judges its definition; a package-level run whose target is a class (the runner then runs that class) is refused, and so is a
 *    package whose class is still compiled as a TestProduction test although its definition no longer is one. A target whose
 *    package or class part is empty (the runner would read it as every test class under `^UnitTestRoot`) is refused by the tool's
 *    schema and by the route before any run id, run record, session or production; every request of that row lists a class that
 *    does not exist, so none can start a run even if the refusal were missing.
 *  - Q6: the bare namespace `EXECMCPTMP403X` (no Interoperability): plain runs through both tools, the route's exact answer at every
 *    level, and a namespace that does not exist.
 *
 * This gate starts Line-by-Line sessions too (the package runs its files serially) and starts every row with the monitor idle: when a
 * session it did not start is active, an armed gate fails and names it, an unarmed one skips, and the session is left alone. It
 * terminates no process. Every production it starts runs only in `EXECMCPTMP403W`, and it stops each one it started. Its helpers are
 * the Story 40.3 gate's (`testproduction-gate-helpers.ts`), and its scratch namespace is made and removed by the fixture's own
 * `createTestProductionNamespace` / `removeTestProductionNamespace`.
 *
 * Fixtures: the disposable namespaces `EXECMCPTMP403W` (the `Story403` classes, the `Story403Q` classes the rows put, and the one node
 * `^%SYS("Ensemble","InstalledNamespace","EXECMCPTMP403W")` that lets it compile TestProduction tests) and the bare `EXECMCPTMP403X`, their
 * database files, and the HSCUSTOM class `ExecuteMCPv2.Temp.Story391Fixture`, all removed in `afterAll`, which also asserts that nothing
 * is left (the node included) and that the monitor is idle. The only globals written outside them are the coverage service's own
 * `^IRIS.TempExecuteMCPv2Coverage` and the fixture's `^IRIS.TempStory391Fixture`.
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
  postEnvelope,
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
import {
  STORY403_OTHER,
  STORY403_PRODUCTION,
  createTestProductionNamespace,
  plainTestSource,
  removeTestProductionNamespace,
  testProductionSource,
} from "./testproduction-fixture.js";
import {
  ENABLED_GOVERNANCE,
  installedNode,
  succeeded,
  testProductionGate,
  withoutRunValues,
  type RunContent,
} from "./testproduction-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-3-qa-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The interop-mapped scratch namespace with the InstalledNamespace node, the bare one, and a scratch name that is no namespace. */
const NS_W = "EXECMCPTMP403W";
const NS_X = "EXECMCPTMP403X";
const NS_NONE = "EXECMCPTMP40Z";
const NAMESPACES = [NS_W, NS_X];

/** The routines of the sessions a coverage row may leave behind, for the safety net. */
const SUITE_ROUTINE_SETS = ["Story403.PlainTest.1", "Story403.PassTest.1", "Story403Q.StaleCovTest.1"];

/** The InstalledNamespace node of W, which the leftovers check lists and the processes check ignores. */
const INSTALLED_NODE = installedNode(NS_W);

// -- Fixture sources the rows put -----------------------------------------------------------

/** An abstract TestProduction base and a concrete test that extends it, in a package of their own. */
const ABS_BASE_DOC = "Story403Q.Abs.BaseTest.cls";
const ABS_CHILD_DOC = "Story403Q.Abs.ChildTest.cls";
const ABS_BASE_SOURCE = `Class Story403Q.Abs.BaseTest Extends %UnitTest.TestProduction [ Abstract ]
{

Parameter PRODUCTION = "${STORY403_PRODUCTION}";

Parameter MAXWAIT = 3;

Parameter MINRUN = 1;

}
`;
const ABS_CHILD_SOURCE = `Class Story403Q.Abs.ChildTest Extends Story403Q.Abs.BaseTest
{

}
`;

/** A package whose two tests declare two different productions. */
const OWN_FIRST_DOC = "Story403Q.Own.FirstTest.cls";
const OWN_SECOND_DOC = "Story403Q.Own.SecondTest.cls";

/** A test compiled as a test of Story403.Production and saved afterwards as a test of Story403.Other, with no compile. */
const STALE_DOC = "Story403Q.StaleCovTest.cls";

/**
 * A definition walk of two uncompiled classes named by short `Extends` (resolved within their own package): the leaf extends the
 * middle class, which extends a compiled TestProduction base that declares the production.
 */
const WALK_BASE_DOC = "Story403Q.Walk.BaseTest.cls";
const WALK_MID_DOC = "Story403Q.Walk.MidTest.cls";
const WALK_LEAF_DOC = "Story403Q.Walk.LeafTest.cls";
const WALK_MID_SOURCE = `Class Story403Q.Walk.MidTest Extends BaseTest
{

}
`;
const WALK_LEAF_SOURCE = `Class Story403Q.Walk.LeafTest Extends MidTest
{

}
`;

/** A package whose one class was compiled as a TestProduction test and saved afterwards as a plain test, with no compile. */
const STALE_PKG_DOC = "Story403Q.StalePkg.ProdTest.cls";

/** The documents the rows put into W, children first, for the cleanup after every row. */
const ROW_DOCUMENTS: readonly string[] = [
  ABS_CHILD_DOC,
  ABS_BASE_DOC,
  OWN_FIRST_DOC,
  OWN_SECOND_DOC,
  STALE_DOC,
  WALK_LEAF_DOC,
  WALK_MID_DOC,
  WALK_BASE_DOC,
  STALE_PKG_DOC,
];

/** The plain tests the bare namespace holds. */
const PLAIN_X_DOCUMENTS: ReadonlyArray<readonly [string, string]> = [
  ["Story403.PlainTest.cls", plainTestSource("Story403.PlainTest")],
  ["Story403.Plain.OneTest.cls", plainTestSource("Story403.Plain.OneTest")],
];

// -- Session state and helpers ------------------------------------------------------------

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
let interop: WireSession;
let ensHeld = false;

function wireOptions(pkg: string): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: distEntry(REPO_ROOT, pkg), target: TARGET, clientName: "story-40-3-qa-live-gate" };
}

/** The target of the raw Atelier oracle for a scratch namespace. */
const oracleTarget = (namespace: string): typeof TARGET => ({ ...TARGET, namespace });

/** The helpers this gate shares with the Story 40.3 gate, over W. */
const {
  fixtureCall,
  coverageGlobal,
  monitorState,
  runCounter,
  expectMonitorIdle,
  releaseLeftoverSession,
  productionStatus,
  startOther,
  stopAnyProduction,
  processes: processesOfW,
  residue: residueOfW,
  settledLeftovers,
  settled,
  executeTests,
  coverageRun,
  busyFields,
  expectRefusal,
  rawGuard,
} = testProductionGate({ sessions: () => ({ dev, interop }), target: TARGET, namespace: NS_W, suiteRoutineSets: SUITE_ROUTINE_SETS });

/** What "untouched" compares: the interop tool's status of W with its items, and the production processes. */
interface Snapshot {
  status: Record<string, unknown>;
  processes: string[];
}

async function snapshot(): Promise<Snapshot> {
  const status = await interop.call("iris_production_status", { detail: true, namespace: NS_W });
  expect(status.isError, allText(status)).toBeFalsy();
  return { status: status.structuredContent ?? {}, processes: await processesOfW() };
}

/** The snapshot of a production once it has settled: a production reports Running while its jobs are still starting. */
async function settledSnapshot(): Promise<Snapshot> {
  return settled(snapshot);
}

/** The row counts of the five `%UnitTest_Result` tables of `namespace`, read by raw Atelier queries: "nothing ran" is unchanged counts. */
async function resultRows(namespace: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of ["TestInstance", "TestSuite", "TestCase", "TestMethod", "TestAssert"]) {
    const rows = await atelierQuery(oracleTarget(namespace), `SELECT COUNT(*) AS N FROM %UnitTest_Result.${table}`);
    counts[table] = Number(rows[0]?.["N"] ?? Number.NaN);
  }
  return counts;
}

/** The refusal of an unreadable state: `Unknown`, with the error text and no production. */
function expectUnreadable(result: WireToolResult, tests: Array<{ class: string; production: string }>): void {
  const error = "The Ens runtime lock (Ens.Runtime) was not acquired within 5 seconds";
  expect(result.isError, allText(result)).toBe(true);
  expect(result.structuredContent).toEqual({ code: "PRODUCTION_BUSY", namespace: NS_W, state: "Unknown", testProductions: tests, error });
  expect(allText(result)).toContain(`The production state of namespace ${NS_W} could not be read (${error})`);
}

/** What the guard answers when it read no state: the run has no TestProduction test. */
function proceedWithNoTests(namespace: string): Record<string, unknown> {
  return { decision: "proceed", namespace, testProductions: [] };
}

const PASS_TEST = [{ class: "Story403.PassTest", production: STORY403_PRODUCTION }];

/** A refusal changed nothing: the other production's status, items and processes are as they were, and no result row was added. */
async function expectUntouched(before: Snapshot, rowsBefore: Record<string, number>, what: string): Promise<void> {
  expect(await snapshot(), `${what}: the other production is untouched (name, state, start time, items, processes)`).toEqual(before);
  expect(await resultRows(NS_W), `${what}: nothing ran (no row was added to any %UnitTest_Result table)`).toEqual(rowsBefore);
}

/** The scratch namespace W, running `Story403.Other`, with its snapshot and result row counts taken once it has settled. */
async function otherRunning(): Promise<{ before: Snapshot; rowsBefore: Record<string, number> }> {
  await startOther();
  const before = await settledSnapshot();
  expect(before.status, "Other runs with its one item").toMatchObject({ name: STORY403_OTHER, state: "Running" });
  expect(before.status["items"], "Other has one item").toHaveLength(1);
  return { before, rowsBefore: await resultRows(NS_W) };
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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.3 QA live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  dev = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_GOVERNANCE: ENABLED_GOVERNANCE });
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  interop = await openWireSession(wireOptions("iris-interop-mcp"));
  await putFixtureClass(dev);

  // Every row starts with the monitor idle. A session this gate did not start is named and left alone.
  const initial = await monitorState();
  if (initial.active !== 0) {
    const named = `a Line-by-Line or PERFMON session this gate did not start is active (process list "${initial.pids}"); it was left untouched`;
    for (const session of [admin, interop]) await session.close();
    await removeFixtureClass(dev);
    await dev.close();
    if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.3 QA live gate may not be skipped: ${named}`);
    skipReason = named;
    return;
  }

  await removeTestProductionNamespace(admin, interop, dev, NS_W);
  await removeInteropNamespace(admin, dev, NS_X);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);
  await createTestProductionNamespace(admin, dev, NS_W);
  await createInteropNamespace(admin, dev, NS_X, { interop: false });
  const docsX = docFixtures(dev, NS_X);
  for (const [doc, source] of PLAIN_X_DOCUMENTS) {
    await docsX.putDoc(doc, source);
    await docsX.compileDoc(doc);
  }

  // A positive control: the check that must read empty after the run sees both namespaces and the node now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees the namespaces and the InstalledNamespace node while they exist").toEqual(
    expect.arrayContaining([`namespace ${NS_W}`, `namespace ${NS_X}`, INSTALLED_NODE]),
  );
  expect((await productionStatus()).state, "W starts Stopped").toBe("Stopped");
}, 600000);

afterEach(async () => {
  if (skipReason) return;
  // A row that fails must not leave a lock holder, a coverage session or a production behind for the rows after it.
  if (ensHeld) {
    await fixtureCall("ReleaseEnsRuntime", [NS_W]);
    ensHeld = false;
  }
  await releaseLeftoverSession();
  await stopAnyProduction();
  for (const doc of ROW_DOCUMENTS) await docFixtures(dev, NS_W).removeDoc(doc);
}, 120000);

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const { problems, attempt } = teardownRecorder();
  try {
    await attempt("letting go of the Ens lock", async () => {
      if (ensHeld) await fixtureCall("ReleaseEnsRuntime", [NS_W]);
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
    await attempt(`removing ${NS_W}`, () => removeTestProductionNamespace(admin, interop, dev, NS_W));
    await attempt(`removing ${NS_X}`, () => removeInteropNamespace(admin, dev, NS_X));
    await attempt("the leftovers check", async () => {
      expect(await settledLeftovers(NAMESPACES), "no fixture namespace, database, mapping, process or InstalledNamespace node after the run").toEqual([]);
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

// -- Q1: runs with no TestProduction test are unchanged -----------------------------------------

describe("Story 40.3 QA: a run with no TestProduction test is unchanged (AD-15, AC-3, AC-7)", () => {
  it("Q1a: plain class, method and package runs complete with the structured content of the same calls with no production, whose key set is pinned, while Other runs and is untouched", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const calls: ReadonlyArray<readonly [string, "package" | "class" | "method"]> = [
      ["Story403.PlainTest", "class"],
      ["Story403.Plain.OneTest:TestPlain", "method"],
      ["Story403.Mixed.PlainTest", "class"],
      ["Story403.Plain", "package"],
    ];
    expect((await productionStatus()).state, "no production runs for the captures").toBe("Stopped");
    const captures: RunContent[] = [];
    for (const [target, level] of calls) captures.push(succeeded<RunContent>(await executeTests(target, level)));
    for (const capture of captures) {
      expect(capture).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0, skipped: 0 });
      expect(Object.keys(capture).sort(), "the result keys are those of a run before the guard existed").toEqual([
        "details",
        "failed",
        "jobId",
        "passed",
        "runIndex",
        "runIndexSource",
        "skipped",
        "status",
        "total",
      ]);
      expect(Object.keys(capture.details[0] ?? {}).sort(), "the detail keys").toEqual(["class", "duration", "message", "method", "status"]);
    }
    expect(captures[0]?.details[0]).toMatchObject({ class: "Story403.PlainTest", method: "TestPlain", status: "passed" });
    expect(captures[1]?.details[0]).toMatchObject({ class: "Story403.Plain.OneTest", method: "TestPlain", status: "passed" });
    expect(captures[2]?.details[0]).toMatchObject({ class: "Story403.Mixed.PlainTest", method: "TestPlain", status: "passed" });
    expect(captures[3]?.details[0]).toMatchObject({ class: "Story403.Plain.OneTest", method: "TestPlain", status: "passed" });

    const { before, rowsBefore } = await otherRunning();
    for (const [index, [target, level]] of calls.entries()) {
      const again = succeeded<RunContent>(await executeTests(target, level));
      expect(withoutRunValues(again), `${level} ${target}: equal to its no-production capture`).toEqual(withoutRunValues(captures[index]));
    }
    const rowsAfter = await resultRows(NS_W);
    expect(rowsAfter["TestInstance"], "all four runs ran").toBe((rowsBefore["TestInstance"] ?? Number.NaN) + calls.length);
    expect(await settledSnapshot(), "Other is untouched, with its items").toEqual(before);
    await stopAnyProduction();
  }, 300000);

  it("Q1b: with Ens's runtime lock held elsewhere, a plain run and the raw route proceed without waiting for it, and a TestProduction run is the Unknown refusal", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    ensHeld = true;
    expect(await fixtureCall("HoldEnsRuntime", [NS_W, 25]), "the lock holder took ^Ens.Runtime of W").toBe("held");

    const route = await rawGuard("Story403.PlainTest", "class", NS_W);
    expect(route.status, route.text).toBe(200);
    expect(route.result, "no lock was taken and no state was read").toEqual(proceedWithNoTests(NS_W));
    const plain = succeeded<RunContent>(await executeTests("Story403.PlainTest", "class"));
    expect(plain).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });
    const plainPackage = succeeded<RunContent>(await executeTests("Story403.Plain", "package"));
    expect(plainPackage).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });

    // The control: the lock is really held, so a TestProduction run cannot read the state.
    const rowsBefore = await resultRows(NS_W);
    expectUnreadable(await executeTests("Story403.PassTest", "class"), PASS_TEST);
    expect(await resultRows(NS_W), "the refused run queued nothing").toEqual(rowsBefore);

    expect(await fixtureCall("ReleaseEnsRuntime", [NS_W])).toBe("released");
    ensHeld = false;
    expect((await productionStatus()).state, "no production was started").toBe("Stopped");
  }, 300000);
});

// -- Q2: refused inputs the first gate does not send ----------------------------------------------

describe("Story 40.3 QA: refusals leave the other production untouched, whatever the spelling of the input (AC-2, AD-15)", () => {
  it("Q2: spaces around the method colon, a method that does not exist and a namespace in lower case are PRODUCTION_BUSY; a class name in another letter case is not a test", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { before, rowsBefore } = await otherRunning();
    const refusal = busyFields(STORY403_OTHER, "Running", PASS_TEST);

    const spaced = await executeTests("Story403.PassTest : TestControl", "method");
    expectRefusal(spaced, refusal, STORY403_OTHER);
    await expectUntouched(before, rowsBefore, "spaces around the colon");

    const missing = await executeTests("Story403.PassTest:TestNoSuchMethod", "method");
    expectRefusal(missing, refusal, STORY403_OTHER);
    await expectUntouched(before, rowsBefore, "a method that does not exist");

    const lowerCase = await executeTests("Story403.PassTest", "class", NS_W.toLowerCase());
    expectRefusal(lowerCase, refusal, STORY403_OTHER);
    await expectUntouched(before, rowsBefore, "a namespace in lower case");

    // The guard looks a class up by its exact name, and so does the work queue: another letter case is "No tests found", not a run.
    const otherCase = await executeTests("story403.passtest", "class");
    expect(otherCase.isError, allText(otherCase)).toBe(true);
    expect(otherCase.structuredContent).toMatchObject({ total: 0, error: "No tests found for 'story403.passtest' at level 'class'" });
    expect(otherCase.structuredContent, "not a refusal").not.toHaveProperty("code");
    await expectUntouched(before, rowsBefore, "a class name in another letter case");
    await stopAnyProduction();
  }, 300000);

  it("Q2b: a method segment holding ';', ',' or '^' is a malformed target that queues nothing: the runner would read ';' as more classes (here the TestProduction PassTest, which would stop Other) and '^' as setup code to run", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { before, rowsBefore } = await otherRunning();
    for (const target of [
      "Story403.PlainTest:TestPlain;Story403.PassTest",
      "Story403.PlainTest:TestPlain,Story403.PassTest",
      "Story403.PlainTest:TestPlain^##class(Ens.Director).StopProduction()",
    ]) {
      const result = await executeTests(target, "method");
      expect(result.isError, `${target}: ${allText(result)}`).toBe(true);
      expect(result.structuredContent, target).toMatchObject({
        total: 0,
        error: `Malformed method-level target '${target}': the method segment after ':' must be one method name, without ';', ',' or '^'.`,
      });
      expect(result.structuredContent, `${target}: not a refusal`).not.toHaveProperty("code");
      await expectUntouched(before, rowsBefore, target);
    }
    await stopAnyProduction();
  }, 300000);
});

// -- Q3: package discovery edges ---------------------------------------------------------------

describe("Story 40.3 QA: package discovery (AC-2, AC-7)", () => {
  it("Q3a: an abstract TestProduction base is not listed while its concrete subclass is, and a package name that is only a prefix is not that package", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const docs = docFixtures(dev, NS_W);
    await docs.putDoc(ABS_BASE_DOC, ABS_BASE_SOURCE);
    await docs.compileDoc(ABS_BASE_DOC);
    await docs.putDoc(ABS_CHILD_DOC, ABS_CHILD_SOURCE);
    await docs.compileDoc(ABS_CHILD_DOC);
    const { before, rowsBefore } = await otherRunning();

    const child = [{ class: "Story403Q.Abs.ChildTest", production: STORY403_PRODUCTION }];
    const route = await rawGuard("Story403Q.Abs", "package", NS_W);
    expect(route.result).toEqual({
      decision: "busy",
      namespace: NS_W,
      testProductions: child,
      production: STORY403_OTHER,
      state: "Running",
      stateCode: 1,
    });
    expectRefusal(await executeTests("Story403Q.Abs", "package"), busyFields(STORY403_OTHER, "Running", child), STORY403_OTHER);
    await expectUntouched(before, rowsBefore, "the package with an abstract base");

    // `Story403.Mix` is only the start of `Story403.Mixed`: the route lists nothing, and the tool's own discovery finds no test.
    for (const prefix of ["Story403.Mix", "Story403Q.Ab"]) {
      expect((await rawGuard(prefix, "package", NS_W)).result, `${prefix} is no package of tests`).toEqual(proceedWithNoTests(NS_W));
    }
    const noTests = await executeTests("Story403.Mix", "package");
    expect(noTests.isError, allText(noTests)).toBe(true);
    expect(noTests.structuredContent).toEqual({
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      details: [],
      error: "No test classes found in package 'Story403.Mix'",
    });
    await expectUntouched(before, rowsBefore, "a package name that is a prefix");
    await stopAnyProduction();
  }, 300000);

  it("Q3b: a package that mixes plain and TestProduction tests runs whole when nothing else runs, and W is Stopped with no production process afterwards", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    expect((await productionStatus()).state).toBe("Stopped");
    const content = succeeded<RunContent>(await executeTests("Story403.Mixed", "package"));
    expect(content).toMatchObject({ status: "completed", total: 2, passed: 2, failed: 0, skipped: 0 });
    expect(content.details.map((detail) => `${detail.class}:${detail.method}:${detail.status}`)).toEqual([
      "Story403.Mixed.PlainTest:TestPlain:passed",
      "Story403.Mixed.ProdTest:TestControl:passed",
    ]);
    expect((await productionStatus()).state, "the production is Stopped afterwards").toBe("Stopped");
    expect(await residueOfW(), "no production process and no Ensemble state remains for W").toEqual([]);
  }, 300000);

  it("Q3c: an uncompiled test whose short-name Extends names an uncompiled class of its own package, which extends a compiled TestProduction base, is refused with the base's production", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const docs = docFixtures(dev, NS_W);
    await docs.putDoc(WALK_BASE_DOC, testProductionSource("Story403Q.Walk.BaseTest", STORY403_PRODUCTION));
    await docs.compileDoc(WALK_BASE_DOC);
    await docs.putDoc(WALK_MID_DOC, WALK_MID_SOURCE);
    await docs.putDoc(WALK_LEAF_DOC, WALK_LEAF_SOURCE);
    const compiled = await atelierQuery(
      oracleTarget(NS_W),
      "SELECT COUNT(*) AS N FROM %Dictionary.CompiledClass WHERE Name IN ('Story403Q.Walk.MidTest', 'Story403Q.Walk.LeafTest')",
    );
    expect(Number(compiled[0]?.["N"]), "the middle and leaf classes are defined but not compiled").toBe(0);
    const { before, rowsBefore } = await otherRunning();

    // Leaf -> MidTest (a definition, its short name resolved in Story403Q.Walk) -> BaseTest (compiled): the production is the base's.
    const leaf = [{ class: "Story403Q.Walk.LeafTest", production: STORY403_PRODUCTION }];
    expectRefusal(await executeTests("Story403Q.Walk.LeafTest", "class"), busyFields(STORY403_OTHER, "Running", leaf), STORY403_OTHER);
    await expectUntouched(before, rowsBefore, "the two-hop short-name walk");
    await stopAnyProduction();
  }, 300000);
});

// -- Q4: the run's own productions are those of all its tests ---------------------------------------

describe("Story 40.3 QA: the run's own productions (AC-4)", () => {
  it("Q4: a package whose tests declare two productions treats a running one of them as its own, runs, and leaves W Stopped", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const docs = docFixtures(dev, NS_W);
    await docs.putDoc(OWN_FIRST_DOC, testProductionSource("Story403Q.Own.FirstTest", STORY403_PRODUCTION));
    await docs.compileDoc(OWN_FIRST_DOC);
    await docs.putDoc(OWN_SECOND_DOC, testProductionSource("Story403Q.Own.SecondTest", STORY403_OTHER));
    await docs.compileDoc(OWN_SECOND_DOC);
    await startOther();
    await settledSnapshot();

    const route = await rawGuard("Story403Q.Own", "package", NS_W);
    expect(route.result).toEqual({
      decision: "proceed",
      namespace: NS_W,
      testProductions: [
        { class: "Story403Q.Own.FirstTest", production: STORY403_PRODUCTION },
        { class: "Story403Q.Own.SecondTest", production: STORY403_OTHER },
      ],
      production: STORY403_OTHER,
      state: "Running",
      stateCode: 1,
    });
    const content = succeeded<RunContent>(await executeTests("Story403Q.Own", "package"));
    expect(content).toMatchObject({ status: "completed", total: 2, passed: 2, failed: 0 });
    expect((await productionStatus()).state, "the run left W Stopped").toBe("Stopped");
    expect(await residueOfW()).toEqual([]);
  }, 300000);
});

// -- Q5: the coverage path -----------------------------------------------------------------------

describe("Story 40.3 QA: iris_test_coverage reads the same decision at every level (AC-5, AC-6)", () => {
  it("Q5a: with Other running, a class, method and package coverage run is the refusal iris_execute_tests gives; no run id or record is allocated, the monitor is idle and Other is untouched", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { before, rowsBefore } = await otherRunning();
    const mixedTests = [{ class: "Story403.Mixed.ProdTest", production: STORY403_PRODUCTION }];
    const cases: ReadonlyArray<readonly [string, "package" | "class" | "method", Array<{ class: string; production: string }>]> = [
      ["Story403.PassTest", "class", PASS_TEST],
      ["Story403.PassTest:TestControl", "method", PASS_TEST],
      ["Story403.Mixed", "package", mixedTests],
    ];
    for (const [target, level, tests] of cases) {
      await expectMonitorIdle(`${level} ${target}, before`);
      const counter = await runCounter();
      const result = await coverageRun(target, level, ["Story403.PassTest"]);
      expectRefusal(result, busyFields(STORY403_OTHER, "Running", tests), STORY403_OTHER);
      expect(await runCounter(), `${level}: no coverage run id was allocated`).toBe(counter);
      const unallocated = await dev.raw("iris_test_status", { action: "poll", coverageRunId: String(counter + 1) });
      expect(unallocated.isError, allText(unallocated)).toBe(true);
      expect(allText(unallocated), `${level}: no run record exists for the next id`).toContain(`Coverage run ${counter + 1} was not found`);
      await expectMonitorIdle(`${level} ${target}, after`);
      await expectUntouched(before, rowsBefore, `${level} coverage refusal`);

      const viaExecute = await executeTests(target, level);
      expect(viaExecute.structuredContent, `${level}: the same decision as iris_execute_tests`).toEqual(result.structuredContent);
      expect(allText(viaExecute)).toBe(allText(result));
    }
    await stopAnyProduction();
  }, 300000);

  it("Q5b: with Ens's runtime lock held elsewhere, a coverage run of a TestProduction test is the Unknown refusal; no run id is allocated, the monitor is idle and nothing was started", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await expectMonitorIdle("lock held, before");
    const counter = await runCounter();
    const rowsBefore = await resultRows(NS_W);
    ensHeld = true;
    expect(await fixtureCall("HoldEnsRuntime", [NS_W, 20]), "the lock holder took ^Ens.Runtime of W").toBe("held");
    const result = await coverageRun("Story403.PassTest", "class", ["Story403.PassTest"]);
    expect(await fixtureCall("ReleaseEnsRuntime", [NS_W])).toBe("released");
    ensHeld = false;

    expectUnreadable(result, PASS_TEST);
    expect(await runCounter(), "no coverage run id was allocated").toBe(counter);
    await expectMonitorIdle("lock held, after");
    expect(await resultRows(NS_W), "nothing ran").toEqual(rowsBefore);
    expect((await productionStatus()).state, "no production was started").toBe("Stopped");
  }, 300000);

  it("Q5c: with Other running, a coverage run of a plain test is not refused: it completes, allocates the next run id, leaves the monitor idle and Other untouched", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await expectMonitorIdle("plain coverage, before");
    const { before } = await otherRunning();
    const counter = await runCounter();
    const content = succeeded<RunContent>(await coverageRun("Story403.PlainTest", "class", ["Story403.PlainTest"]));
    expect(content).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });
    expect(content.coverage?.complete).toBe(true);
    expect(content.coverageRunId, "the run id is the next one").toBe(counter + 1);
    await expectMonitorIdle("plain coverage, after");
    expect(await settledSnapshot(), "Other is untouched").toEqual(before);
    await stopAnyProduction();
  }, 300000);

  it("Q5d: a test compiled for one production and saved for another is judged by its compiled class on the coverage path and by its definition on the Atelier path", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const docs = docFixtures(dev, NS_W);
    // Compiled as a test of Story403.Production, then saved as a test of Story403.Other: a plain overwrite, with no compile.
    await docs.putDoc(STALE_DOC, testProductionSource("Story403Q.StaleCovTest", STORY403_PRODUCTION));
    await docs.compileDoc(STALE_DOC);
    const saved = await dev.call("iris_doc_put", {
      name: STALE_DOC,
      content: testProductionSource("Story403Q.StaleCovTest", STORY403_OTHER),
      namespace: NS_W,
    });
    expect(saved.isError, allText(saved)).toBeFalsy();
    const { before, rowsBefore } = await otherRunning();
    await expectMonitorIdle("stale class, before");
    const counter = await runCounter();

    // The work queue compiles the definition first, so the definition answers: Other is this test's own production.
    const route = await rawGuard("Story403Q.StaleCovTest", "class", NS_W);
    expect(route.result).toEqual({
      decision: "proceed",
      namespace: NS_W,
      testProductions: [{ class: "Story403Q.StaleCovTest", production: STORY403_OTHER }],
      production: STORY403_OTHER,
      state: "Running",
      stateCode: 1,
    });
    // The coverage runner never compiles, so the compiled class answers: it starts Story403.Production, and Other is another's.
    const result = await coverageRun("Story403Q.StaleCovTest", "class", ["Story403Q.StaleCovTest"]);
    expectRefusal(
      result,
      busyFields(STORY403_OTHER, "Running", [{ class: "Story403Q.StaleCovTest", production: STORY403_PRODUCTION }]),
      STORY403_OTHER,
    );
    expect(await runCounter(), "no coverage run id was allocated").toBe(counter);
    await expectMonitorIdle("stale class, after");
    await expectUntouched(before, rowsBefore, "the stale class refusal");
    await stopAnyProduction();
  }, 300000);

  it("Q5e: with Other running, a package-level coverage run whose target is a class (the runner then runs that class) is refused like a class-level run; the Atelier path finds no test class in that package", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { before, rowsBefore } = await otherRunning();
    await expectMonitorIdle("package level, class target, before");
    const counter = await runCounter();

    const result = await coverageRun("Story403.PassTest", "package", ["Story403.PassTest"]);
    expectRefusal(result, busyFields(STORY403_OTHER, "Running", PASS_TEST), STORY403_OTHER);
    expect(await runCounter(), "no coverage run id was allocated").toBe(counter);
    await expectMonitorIdle("package level, class target, after");
    await expectUntouched(before, rowsBefore, "the package-level coverage refusal of a class target");

    // The Atelier path lists the classes under `Story403.PassTest.` and finds none, so it runs nothing: today's result, not a refusal.
    const viaExecute = await executeTests("Story403.PassTest", "package");
    expect(viaExecute.isError, allText(viaExecute)).toBe(true);
    expect(viaExecute.structuredContent).toMatchObject({ total: 0, error: "No test classes found in package 'Story403.PassTest'" });
    expect(viaExecute.structuredContent, "not a refusal").not.toHaveProperty("code");
    await expectUntouched(before, rowsBefore, "the package-level Atelier run of a class target");
    await stopAnyProduction();
  }, 300000);

  it("Q5f: a package whose class was compiled as a TestProduction test and saved afterwards as a plain test is refused on the coverage path, which runs the compiled class; the Atelier path's guard lists no TestProduction test, because it compiles the plain definition", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const docs = docFixtures(dev, NS_W);
    await docs.putDoc(STALE_PKG_DOC, testProductionSource("Story403Q.StalePkg.ProdTest", STORY403_PRODUCTION));
    await docs.compileDoc(STALE_PKG_DOC);
    // A plain overwrite with no compile: the definition is now a plain test, the compiled class still a TestProduction test.
    const saved = await dev.call("iris_doc_put", { name: STALE_PKG_DOC, content: plainTestSource("Story403Q.StalePkg.ProdTest"), namespace: NS_W });
    expect(saved.isError, allText(saved)).toBeFalsy();
    const { before, rowsBefore } = await otherRunning();
    await expectMonitorIdle("stale package class, before");
    const counter = await runCounter();

    expect((await rawGuard("Story403Q.StalePkg", "package", NS_W)).result, "the definition is a plain test").toEqual(proceedWithNoTests(NS_W));
    const result = await coverageRun("Story403Q.StalePkg", "package", ["Story403.PassTest"]);
    expectRefusal(
      result,
      busyFields(STORY403_OTHER, "Running", [{ class: "Story403Q.StalePkg.ProdTest", production: STORY403_PRODUCTION }]),
      STORY403_OTHER,
    );
    expect(await runCounter(), "no coverage run id was allocated").toBe(counter);
    await expectMonitorIdle("stale package class, after");
    await expectUntouched(before, rowsBefore, "the stale package class refusal");
    await stopAnyProduction();
  }, 300000);

  it("Q5g: a coverage target whose package or class part is empty or blank is refused by the tool's schema and by the route before any run id, run record, session or production; the control with a valid target gets as far as resolving the listed class", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await expectMonitorIdle("empty class part, before");
    const counter = await runCounter();
    const rowsBefore = await resultRows(NS_W);
    // The listed class does not exist, so a request the validation let through would stop at "no measurable routine", before the
    // guard and the launch: no request of this row can start a run, whatever the validation does.
    const classes = ["Story403.NoSuchClassAnywhere"];
    const routeBody = (target: string, level: string) => ({ target, level, classes, namespace: NS_W, maxSeconds: 3600, maxLines: 200000 });

    // The control: the same request with a valid target is refused later, by the resolution of the listed class (so the refusals
    // below are the target's, and nothing else in the request).
    const control = await postEnvelope(TARGET, "/dev/test/coverage", routeBody("Story403.PlainTest", "class"));
    expect(control.errors, control.text).toHaveLength(1);
    expect(control.errors[0]).toContain(`None of the listed classes has a measurable routine in namespace ${NS_W}`);
    expect(control.errors[0]).toContain("Nothing was started");

    const cases: ReadonlyArray<readonly [string, "package" | "class" | "method"]> = [
      [":", "class"],
      [":", "package"],
      [":TestControl", "method"],
      ["::", "class"],
      [" :TestControl", "method"],
    ];
    for (const [target, level] of cases) {
      const what = `${level} ${JSON.stringify(target)}`;
      const viaTool = await coverageRun(target, level, classes);
      expect(viaTool.isError, `${what}: ${allText(viaTool)}`).toBe(true);
      expect(allText(viaTool), `${what}: refused by the tool's input schema, before any call to IRIS`).toContain(
        "Invalid arguments for tool iris_test_coverage",
      );
      expect(allText(viaTool)).toContain("must start with a package or class name");

      const viaRoute = await postEnvelope(TARGET, "/dev/test/coverage", routeBody(target, level));
      expect(viaRoute.errors, `${what}: ${viaRoute.text}`).toHaveLength(1);
      expect(viaRoute.errors[0], `${what}: refused by the validation, before the class is resolved`).toContain(
        "Parameter 'target' must start with a package or class name",
      );
      expect(viaRoute.errors[0]).not.toContain("measurable routine");
    }

    expect(await runCounter(), "no coverage run id was allocated").toBe(counter);
    const unallocated = await dev.raw("iris_test_status", { action: "poll", coverageRunId: String(counter + 1) });
    expect(unallocated.isError, allText(unallocated)).toBe(true);
    expect(allText(unallocated), "no run record exists for the next id").toContain(`Coverage run ${counter + 1} was not found`);
    await expectMonitorIdle("empty class part, after");
    expect(await resultRows(NS_W), "nothing ran").toEqual(rowsBefore);
    expect((await productionStatus()).state, "no production was started").toBe("Stopped");
  }, 300000);
});

// -- Q6: a namespace where interoperability is not configured --------------------------------------

describe("Story 40.3 QA: interoperability is not configured (Rules #34 and #41, AC-7)", () => {
  it("Q6a: in the bare namespace X plain runs complete at every level, the route answers exactly proceed with no tests and no state at every level, and a namespace that does not exist fails as it did before", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const method = succeeded<RunContent>(await executeTests("Story403.Plain.OneTest:TestPlain", "method", NS_X));
    expect(method).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });
    expect(method.details[0]).toMatchObject({ class: "Story403.Plain.OneTest", method: "TestPlain", status: "passed" });
    const pkg = succeeded<RunContent>(await executeTests("Story403.Plain", "package", NS_X));
    expect(pkg).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });

    const asked: ReadonlyArray<readonly [string, string]> = [
      ["Story403.PlainTest", "class"],
      ["Story403.Plain.OneTest:TestPlain", "method"],
      ["Story403.Plain", "package"],
      ["Story403", "package"],
      ["Story403.PassTest", "class"],
    ];
    for (const [target, level] of asked) {
      const answer = await rawGuard(target, level, NS_X);
      expect(answer.status, answer.text).toBe(200);
      expect(answer.result, `${level} ${target}: proceed, no tests, no state, no error`).toEqual(proceedWithNoTests(NS_X));
    }

    // No such namespace: the guard says proceed (nothing can run there), and the run fails with today's error, not a refusal.
    const route = await rawGuard("Story403.PlainTest", "class", NS_NONE);
    expect(route.status, route.text).toBe(200);
    expect(route.result).toEqual(proceedWithNoTests(NS_NONE));
    const absent = await executeTests("Story403.PlainTest", "class", NS_NONE);
    expect(absent.isError, allText(absent)).toBe(true);
    expect(absent.structuredContent, "not a refusal").not.toHaveProperty("code");
    expect((absent.structuredContent as { error?: string }).error).toMatch(
      new RegExp(`^Error executing tests for 'Story403\\.PlainTest': .*HTTP 404.*${NS_NONE}/work`),
    );
  }, 300000);

  it("Q6b: in the bare namespace X a coverage run of a plain test completes, and the monitor is idle with no ownership node afterwards", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await expectMonitorIdle("bare namespace coverage, before");
    const counter = await runCounter();
    const content = succeeded<RunContent>(await coverageRun("Story403.PlainTest", "class", ["Story403.PlainTest"], NS_X));
    expect(content).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });
    expect(content.coverage?.complete).toBe(true);
    expect(content.coverageRunId).toBe(counter + 1);
    await expectMonitorIdle("bare namespace coverage, after");
  }, 300000);
});
