/**
 * Story 40.5 QA live gate: what the Story 40.5 gate leaves open, on the BUILT iris-dev-mcp, iris-admin-mcp and iris-interop-mcp dists
 * over real stdio JSON-RPC (project rule #46) against the live IRIS. It runs in the default suite and is armed by `IRIS_REQUIRE_LIVE`
 * (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 *
 * Every row names the path it guards (rule #59). The oracles are the test-class sources written out below (a test method per
 * `Method Test...` line), the golden prompt texts of decisions #65 to #67, hand-written SQL over `%UnitTest_Result` through the raw
 * Atelier route, the coverage service's own run record in IRISTEMP, the real `tools/list` and `prompts/get` of the spawned servers,
 * and the PRODUCTION_BUSY refusal a real run returns; never the code under test.
 *
 * Rows:
 *  P. The three changed prompts through the spawned servers (SDK `Client` -> stdio -> `prompts/get`). `recover-stuck-production`
 *     (interop server) renders with `arguments` omitted, empty, partial and complete; `edit-and-test-class` and
 *     `deploy-and-test-class` (dev server) refuse an omitted or empty `arguments` as InvalidParams, then render with the required
 *     arguments alone and with all of them. Each new sentence is present exactly once and ends its step, the names, titles, arguments,
 *     descriptions and step counts (8, 12, 9) are the ones listed before, every `iris_*` token is a real tool of the server that
 *     lists the prompt (the edit prompt's under the `core` preset too), `iris_production_logs` takes the arguments step 3 names and
 *     advertises the `block` policy and `textPolicy`, a live `Unknown` PRODUCTION_BUSY refusal has the fields the note branches on,
 *     and each generated `SKILL.md` is the render of its prompt.
 *  T. DW-597 at the package level: `iris_execute_tests`, `POST /tests` and `iris_test_coverage` over a package of three test classes
 *     (one in a sub-package) beside an abstract test class, a class that is no test and a sibling package whose name starts with
 *     the same letters. All three paths run exactly the three classes and the six `Test*` methods. The coverage run's recorded spec is
 *     `:A;B;C`, and the class and method levels keep their specs.
 *
 * Fixtures: `EXECMCPTMP405Q` holds `Story405Q.*` and `Story405QX.*`; `EXECMCPTMP405R` is bare (no Interoperability) and holds the one
 * `Story405R.FreshTest` TestProduction test, defined and not compiled, whose production state cannot be read there. No production is
 * started. Row P5 makes the guard ask for the bare namespace's production state, which cannot be read there (that refusal is the
 * row's subject); no other namespace's production state is asked for. The coverage rows start Line-by-Line sessions, so this is a gate that starts them (the package runs its files
 * serially): a coverage row runs only with the monitor idle (an armed gate fails and names a session it did not start, an unarmed one
 * skips that row, and the session is left alone), and it ends asserting the monitor idle with no ownership node. `afterAll` stops a
 * session a failed row left behind (`StopIfList`, which proves the session before it stops it), removes both namespaces (their database
 * files too) and the fixture class, and asserts that nothing is left.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773, `_SYSTEM`, HSCUSTOM).
 * Writes only the namespaces and databases `EXECMCPTMP405Q` and `EXECMCPTMP405R` and the HSCUSTOM class
 * `ExecuteMCPv2.Temp.Story391Fixture`. A missing or stale dist, an unresolvable SDK or an unreachable IRIS skips each row with the
 * reason, or fails with "may not be skipped" when `IRIS_REQUIRE_LIVE` is armed.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAllPrompts } from "../../../../scripts/lib/prompt-catalog.mjs";
import {
  allText,
  assertDeployedBootstrapVersion,
  atelierQuery,
  atelierScalar,
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
  type WireTool,
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
import { promptRejection, promptText, stepsOf, toolTokens } from "./prompt-gate-helpers.js";
import { testProductionSource } from "./testproduction-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-5-qa-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The scratch namespace holding the `Story405Q` package and its decoys, and the bare one holding the unreadable-state test. */
const NS = "EXECMCPTMP405Q";
const NS_BARE = "EXECMCPTMP405R";
const NAMESPACES = [NS, NS_BARE];

/** The operator enables the coverage tool; nothing else is enabled. */
const ENABLED_GOVERNANCE = JSON.stringify({ global: { iris_test_coverage: true } });

const EDIT_PROMPT = "edit-and-test-class";
const DEPLOY_PROMPT = "deploy-and-test-class";
const RECOVER_PROMPT = "recover-stuck-production";
const INVALID_PARAMS = -32602;

/** The routines of the one session this gate's coverage rows start: the covered class's routine. */
const SUITE_ROUTINE_SETS = ["Story405Q.Subject.1"];

// -- The golden texts of decisions #65 to #67 (written out, never read from the prompt sources) ------------------------

const PRODUCTION_BUSY_NOTE =
  "If the response is a `PRODUCTION_BUSY` refusal, nothing ran. " +
  "When the refusal has a `production` field, that production is running in the namespace and is not the tests' own: " +
  "tell the user, and do not stop that production unless the user confirms it is a leftover of an interrupted test run. " +
  "When its `state` is `Unknown`, the namespace's production state could not be read (the refusal says why): " +
  "tell the user, run the tests again in a moment, and do not stop any production to make them run.";

const BLOCK_RULE =
  "Under the `block` data policy each entry's `text` is withheld and its `textPolicy` gives the reason: " +
  "report that reason to the user, and never read the log text another way (for example through SQL, global or document tools).";

/** The sentence both dev prompts carry before the note in the edit prompt's step 9. */
const RUNNING_SENTENCE =
  "If the response has `status: \"running\"`, the run has NOT finished: follow the response's `hint` to re-attach, " +
  "and never re-submit the same target (that starts a second concurrent run against shared fixtures).";

/**
 * The names, titles, arguments and descriptions the prompts listed before Story 40.5, captured from the baseline sources
 * (`git show e0d883b:packages/iris-dev-mcp/src/prompts/editAndTestClass.ts`, `deployAndTestClass.ts` and
 * `git show e0d883b:packages/iris-interop-mcp/src/prompts/recoverStuckProduction.ts`).
 */
const LISTED = {
  [EDIT_PROMPT]: {
    title: "Edit And Test Class",
    arguments: [
      ["className", true],
      ["change", true],
      ["testClass", false],
    ],
    description:
      "Change a few lines of an ObjectScript class in place (ranged iris_doc_get, then a guarded iris_doc_edit), " +
      "compile it (iris_doc_compile), then run its unit tests (iris_execute_tests) with a total-count check.",
    steps: 12,
  },
  [DEPLOY_PROMPT]: {
    title: "Deploy And Test Class",
    arguments: [["classOrPackage", true]],
    description:
      "Deploy an ObjectScript class or package to IRIS (iris_doc_load, glob-path form), fix compile errors, then run its unit " +
      "tests (iris_execute_tests) with a total-count check and, when asked, measure their line coverage (iris_test_coverage).",
    steps: 9,
  },
  [RECOVER_PROMPT]: {
    title: "Recover Stuck Production",
    arguments: [
      ["production", false],
      ["namespace", false],
    ],
    description:
      "Diagnose and recover a troubled/wedged Interoperability production, following the recover-first, clean-last-resort " +
      "escalation ladder. Never suggests killAppData without the user's explicit acceptance of persistent business-state loss.",
    steps: 8,
  },
} as const;

// -- The fixture classes ---------------------------------------------------------------------------------------------

/** One fixture class: the document name, its source, and whether a package-level run of `Story405Q` runs it. */
interface FixtureClass {
  doc: string;
  className: string;
  source: string;
  runs: boolean;
}

const SUBJECT_SOURCE = String.raw`/// Synthetic QA fixture: the code the Story 40.5 QA tests cover. Each branch of Sign is reached by one test class only.
Class Story405Q.Subject
{

ClassMethod Add(pA As %Integer, pB As %Integer) As %Integer
{
    Quit pA + pB
}

ClassMethod Sign(pN As %Integer) As %Integer
{
    If pN < 0 {
        Quit -1
    }
    If pN > 0 {
        Quit 1
    }
    Quit 0
}

}
`;

const A_TEST_SOURCE = String.raw`/// Synthetic QA fixture: two passing tests (Story 40.5 QA). TestSign reaches the negative branch of Sign.
Class Story405Q.ATest Extends %UnitTest.TestCase
{

Method TestAdd()
{
    Do $$$AssertEquals(##class(Story405Q.Subject).Add(2, 3), 5, "2 + 3")
}

Method TestSign()
{
    Do $$$AssertEquals(##class(Story405Q.Subject).Sign(-4), -1, "sign of -4")
}

}
`;

const B_TEST_SOURCE = String.raw`/// Synthetic QA fixture: one passing test (Story 40.5 QA). TestZero reaches the zero branch of Sign.
Class Story405Q.BTest Extends %UnitTest.TestCase
{

Method TestZero()
{
    Do $$$AssertEquals(##class(Story405Q.Subject).Sign(0), 0, "sign of 0")
}

}
`;

const C_TEST_SOURCE = String.raw`/// Synthetic QA fixture: three passing tests in a sub-package (Story 40.5 QA). TestOne reaches the positive branch of Sign.
Class Story405Q.Deep.CTest Extends %UnitTest.TestCase
{

Method TestOne()
{
    Do $$$AssertEquals(##class(Story405Q.Subject).Sign(7), 1, "sign of 7")
}

Method TestTwo()
{
    Do $$$AssertEquals(##class(Story405Q.Subject).Add(0, 0), 0, "0 + 0")
}

Method TestThree()
{
    Do $$$AssertEquals(##class(Story405Q.Subject).Add(-1, 1), 0, "-1 + 1")
}

}
`;

const BASE_TEST_SOURCE = String.raw`/// Synthetic QA fixture: an abstract test class, which a package-level run never runs (Story 40.5 QA).
Class Story405Q.BaseTest Extends %UnitTest.TestCase [ Abstract ]
{

Method TestAbstractNeverRuns()
{
    Do $$$AssertTrue(0, "an abstract test class is never run")
}

}
`;

const DECOY_TEST_SOURCE = String.raw`/// Synthetic QA fixture: a failing test in a package whose name starts like Story405Q, which a run of Story405Q never reaches (Story 40.5 QA).
Class Story405QX.DecoyTest Extends %UnitTest.TestCase
{

Method TestDecoy()
{
    Do $$$AssertTrue(0, "a sibling package is never run")
}

}
`;

/** In compile order: the covered class first, then the tests, the abstract one and the decoy. */
const FIXTURES: readonly FixtureClass[] = [
  { doc: "Story405Q.Subject.cls", className: "Story405Q.Subject", source: SUBJECT_SOURCE, runs: false },
  { doc: "Story405Q.ATest.cls", className: "Story405Q.ATest", source: A_TEST_SOURCE, runs: true },
  { doc: "Story405Q.BTest.cls", className: "Story405Q.BTest", source: B_TEST_SOURCE, runs: true },
  { doc: "Story405Q.Deep.CTest.cls", className: "Story405Q.Deep.CTest", source: C_TEST_SOURCE, runs: true },
  { doc: "Story405Q.BaseTest.cls", className: "Story405Q.BaseTest", source: BASE_TEST_SOURCE, runs: false },
  { doc: "Story405QX.DecoyTest.cls", className: "Story405QX.DecoyTest", source: DECOY_TEST_SOURCE, runs: false },
];

/** The `TestProduction` test of the bare namespace: defined, not compiled, naming a production that cannot be looked up there. */
const FRESH_DOC = "Story405R.FreshTest.cls";
const FRESH_CLASS = "Story405R.FreshTest";
const FRESH_PRODUCTION = "Story405R.Production";

/** The (class, method) pairs a package-level run of `Story405Q` must run: the `Method Test...` lines of the sources that run. */
const EXPECTED_PAIRS: Array<[string, string]> = FIXTURES.filter((fixture) => fixture.runs)
  .flatMap((fixture) => [...fixture.source.matchAll(/^Method (Test\w+)\(\)/gm)].map((match): [string, string] => [fixture.className, match[1] as string]))
  .sort((left, right) => (left.join(":") < right.join(":") ? -1 : 1));

/** The classes of those pairs, in the order IRIS lists a package's classes. */
const EXPECTED_CLASSES = ["Story405Q.ATest", "Story405Q.BTest", "Story405Q.Deep.CTest"];

/** The test spec of a package run of `Story405Q`: one colon, then the classes separated by a semicolon alone. */
const EXPECTED_PACKAGE_SPEC = ":Story405Q.ATest;Story405Q.BTest;Story405Q.Deep.CTest";

let skipReason: string | undefined;
let coverageSkipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let plain: WireSession;
let admin: WireSession;
let interop: WireSession;

const { monitorState, coverageGlobal, expectMonitorIdle, releaseLeftoverSession } = monitorGate({
  dev: () => dev,
  suiteRoutineSets: SUITE_ROUTINE_SETS,
});

function wireOptions(pkg: string): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: distEntry(REPO_ROOT, pkg), target: TARGET, clientName: GATE_TAG };
}

/** The target of the raw Atelier oracle in a scratch namespace. */
const oracleTarget = (namespace: string): typeof TARGET => ({ ...TARGET, namespace });

// -- Reading results -------------------------------------------------------------------------------------------------

/** The structured content of a tool call that must not be an error. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

interface RunContent {
  status?: string;
  total?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  jobId?: string;
  details: Array<{ class: string; method: string; status: string }>;
}

interface RoutineValues {
  routine: string;
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
  coverage?: {
    complete: boolean;
    classes: Array<{ class: string; routines: RoutineValues[] }>;
    unmeasured: Array<{ class: string; reason: string }>;
  };
}

/** The (class, method) pairs of a run, sorted. */
function pairsOf(details: ReadonlyArray<{ class: string; method: string }>): string[][] {
  return details.map((detail) => [detail.class, detail.method]).sort((left, right) => (left.join(":") < right.join(":") ? -1 : 1));
}

/** A result that may have returned `running`, polled by its `coverageRunId` until it completes. */
async function settled(result: WireToolResult): Promise<{ result: WireToolResult; content: CoverageContent }> {
  let current = result;
  let content = succeeded<CoverageContent>(current);
  const deadline = Date.now() + 120000;
  while (content.status === "running" && Date.now() < deadline) {
    await sleep(500);
    current = await dev.raw("iris_test_status", { action: "poll", coverageRunId: String(content.coverageRunId) });
    content = succeeded<CoverageContent>(current);
  }
  expect(content.status, "the run completed").toBe("completed");
  return { result: current, content };
}

/** `iris_test_coverage` over `Story405Q.Subject` for `target` at `level`, in the scratch namespace. */
function coverageRun(target: string, level: "package" | "class" | "method"): Promise<{ result: WireToolResult; content: CoverageContent }> {
  return dev.call("iris_test_coverage", { target, level, classes: ["Story405Q.Subject"], namespace: NS }).then(settled);
}

// -- Reading rendered prompts ----------------------------------------------------------------------------------------

/** How many times `part` occurs in `text`. */
function occurrences(text: string, part: string): number {
  return text.split(part).length - 1;
}

/** The names of the tools a session lists, with their definitions. */
async function toolsOf(session: WireSession): Promise<Map<string, WireTool>> {
  return new Map((await session.listTools()).map((tool): [string, WireTool] => [tool.name, tool]));
}

/** The listed entry of a prompt. */
async function listedPrompt(session: WireSession, name: string): Promise<{ name: string; title?: string; description?: string; arguments?: Array<{ name: string; required?: boolean }> }> {
  const found = (await session.listPrompts()).find((prompt) => prompt.name === name);
  expect(found, `${name} is listed`).toBeDefined();
  return found as NonNullable<typeof found>;
}

/** The name, title, arguments and description a prompt lists are the ones it listed before Story 40.5. */
async function expectListedAsBefore(session: WireSession, name: keyof typeof LISTED): Promise<void> {
  const listed = await listedPrompt(session, name);
  expect(listed.title, `${name}: title`).toBe(LISTED[name].title);
  expect(
    listed.arguments?.map((argument) => [argument.name, argument.required === true]),
    `${name}: arguments`,
  ).toEqual(LISTED[name].arguments);
  expect(listed.description, `${name}: description`).toBe(LISTED[name].description);
}

/** The step numbers of a render are 1..n in order. */
function expectSteps(text: string, count: number, label: string): Map<number, string> {
  const steps = stepsOf(text);
  expect([...steps.keys()], `${label}: ${count} steps, numbered in order`).toEqual(Array.from({ length: count }, (_, index) => index + 1));
  return steps;
}

// -- Setup and teardown ----------------------------------------------------------------------------------------------

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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.5 QA live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  dev = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_GOVERNANCE: ENABLED_GOVERNANCE });
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  plain = await openWireSession(wireOptions("iris-dev-mcp"));
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  interop = await openWireSession(wireOptions("iris-interop-mcp"));
  await putFixtureClass(dev);

  // A coverage row needs the monitor idle. A session this gate did not start is named and left alone; only the coverage rows wait for it.
  const initial = await monitorState();
  if (initial.active !== 0) {
    coverageSkipReason = `a Line-by-Line or PERFMON session this gate did not start is active (process list "${initial.pids}", ${initial.count} routine(s): ${JSON.stringify(initial.routines)}); it was left untouched`;
  }

  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);
  for (const name of NAMESPACES) await createInteropNamespace(admin, dev, name, { interop: false });

  const docs = docFixtures(dev, NS);
  for (const fixture of FIXTURES) {
    await docs.putDoc(fixture.doc, fixture.source);
    await docs.compileDoc(fixture.doc);
  }
  // Defined, not compiled: the bare namespace has no Ens classes to compile it with, which is why its production state cannot be read.
  await docFixtures(dev, NS_BARE).putDoc(FRESH_DOC, testProductionSource(FRESH_CLASS, FRESH_PRODUCTION));

  // A positive control: the same check that must read empty after the run sees both namespaces now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees both namespaces while they exist").toEqual(
    expect.arrayContaining([`namespace ${NS}`, `database configuration ${NS}`, `namespace ${NS_BARE}`, `database configuration ${NS_BARE}`]),
  );
}, 300000);

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const { problems, attempt } = teardownRecorder();
  try {
    if (coverageSkipReason === undefined) {
      await attempt("stopping a coverage session left behind", releaseLeftoverSession);
      await attempt("the monitor is idle", async () => {
        expect((await monitorState()).active, "the monitor is idle after the run").toBe(0);
      });
      await attempt("no coverage ownership node is left", async () => {
        expect((await coverageGlobal('"session"')).defined, "no suite session node after the run").toBe(false);
      });
    }
    for (const name of NAMESPACES) await attempt(`removing ${name}`, () => removeInteropNamespace(admin, dev, name));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, NAMESPACES), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story405", "Story391Fixture"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [interop, admin, plain, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- Row P: the three changed prompts over stdio ------------------------------------------------------------------------

describe("Story 40.5 QA: the three changed prompts through the built servers over stdio (rule #46, AC-6)", () => {
  it("P1: edit-and-test-class refuses an omitted or empty `arguments`, then renders twelve steps whose step 9 ends with the note, once, with the testClass argument or without it", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await expectListedAsBefore(plain, EDIT_PROMPT);

    const omitted = await promptRejection(plain, { name: EDIT_PROMPT });
    expect(omitted?.code, "the request without arguments is refused").toBe(INVALID_PARAMS);
    expect(omitted?.message).toContain(EDIT_PROMPT);
    const empty = await promptRejection(plain, { name: EDIT_PROMPT, arguments: {} });
    expect(empty?.code, "an empty arguments object lacks the required ones").toBe(INVALID_PARAMS);
    expect(empty?.message).toContain("className");
    const onlyOne = await promptRejection(plain, { name: EDIT_PROMPT, arguments: { className: "MyApp.Orders" } });
    expect(onlyOne?.code, "one required argument alone is refused").toBe(INVALID_PARAMS);
    expect(onlyOne?.message).toContain("change");

    const required = promptText(
      await plain.getPrompt({ name: EDIT_PROMPT, arguments: { className: "MyApp.Orders", change: "Rename the Total property to Amount" } }),
    );
    const full = promptText(
      await plain.getPrompt({
        name: EDIT_PROMPT,
        arguments: { className: "MyApp.Orders", change: "Rename the Total property to Amount", testClass: "MyApp.Tests.OrdersTest" },
      }),
    );
    const requiredSteps = expectSteps(required, LISTED[EDIT_PROMPT].steps, "required arguments only");
    const fullSteps = expectSteps(full, LISTED[EDIT_PROMPT].steps, "all arguments");

    for (const [label, text, steps] of [["required arguments only", required, requiredSteps], ["all arguments", full, fullSteps]] as const) {
      const step9 = steps.get(9) as string;
      expect(step9.endsWith(` ${RUNNING_SENTENCE} ${PRODUCTION_BUSY_NOTE}`), `${label}: step 9 ends with the running sentence and then the note`).toBe(true);
      expect(occurrences(text, PRODUCTION_BUSY_NOTE), `${label}: the note is in the prompt once`).toBe(1);
      expect(text, `${label}: no unresolved placeholder`).not.toMatch(/<className>|<change>|undefined/);
    }
    expect(requiredSteps.get(9), "without testClass the step finds the test class").toMatch(/^9\. Test: find the test class that covers `MyApp\.Orders`/);
    expect(fullSteps.get(9), "with testClass the step names it").toMatch(
      /^9\. Test: call `iris_execute_tests` with `target: "MyApp\.Tests\.OrdersTest"` and `level: "class"`\. If the response has/,
    );
    // The testClass argument changes step 9 and nothing else.
    for (let step = 1; step <= LISTED[EDIT_PROMPT].steps; step += 1) {
      if (step !== 9) expect(fullSteps.get(step), `step ${step} is the same with and without testClass`).toBe(requiredSteps.get(step));
    }
  }, 120000);

  it("P2: deploy-and-test-class refuses an omitted or empty `arguments`, then renders nine steps whose step 4 is the call and then the note, and step 8 still points at step 4", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await expectListedAsBefore(plain, DEPLOY_PROMPT);

    const omitted = await promptRejection(plain, { name: DEPLOY_PROMPT });
    expect(omitted?.code, "the request without arguments is refused").toBe(INVALID_PARAMS);
    expect(omitted?.message).toContain(DEPLOY_PROMPT);
    const empty = await promptRejection(plain, { name: DEPLOY_PROMPT, arguments: {} });
    expect(empty?.code).toBe(INVALID_PARAMS);
    expect(empty?.message).toContain("classOrPackage");

    // The one argument is the required one, so "required only" and "all arguments" are the same request.
    const text = promptText(await plain.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders.Tests" } }));
    const steps = expectSteps(text, LISTED[DEPLOY_PROMPT].steps, "the required argument");
    expect(steps.get(4), "step 4 is the call and then the note, with nothing between or after").toBe(
      '4. Call `iris_execute_tests` with `target: "MyApp.Orders.Tests"` and the chosen `level`. ' + PRODUCTION_BUSY_NOTE,
    );
    expect(occurrences(text, PRODUCTION_BUSY_NOTE), "the note is in the prompt once").toBe(1);
    expect(steps.get(8), "step 8 hands a PRODUCTION_BUSY refusal to step 4").toContain("If it is refused with `PRODUCTION_BUSY`, handle it as in step 4.");
    expect(steps.get(5), "the next step is the running branch").toMatch(/^5\. \*\*If the response has `status: "running"`/);
    expect(text, "no unresolved placeholder").not.toMatch(/<classOrPackage>|undefined/);
  }, 120000);

  it("P3: recover-stuck-production renders eight steps with `arguments` omitted, empty, partial and complete, and step 3 always ends with the block rule, once", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await expectListedAsBefore(interop, RECOVER_PROMPT);

    // Every argument is optional, so an empty `arguments` object is "the required arguments alone". With `arguments` omitted entirely
    // the SDK either refuses cleanly (InvalidParams naming the prompt: its schema is an object, which rejects `undefined`) or renders
    // what the empty object renders; it never fails any other way, and the connection stays usable.
    const empty = promptText(await interop.getPrompt({ name: RECOVER_PROMPT, arguments: {} }));
    const omittedAnswer = await interop.getPrompt({ name: RECOVER_PROMPT }).then(
      (rendered) => ({ text: promptText(rendered) }),
      (error: unknown) => ({ error: error as { code?: number; message?: string } }),
    );
    if ("error" in omittedAnswer) {
      expect(omittedAnswer.error.code, "an omitted `arguments` is refused as InvalidParams").toBe(INVALID_PARAMS);
      expect(omittedAnswer.error.message).toContain(RECOVER_PROMPT);
    } else {
      expect(omittedAnswer.text, "an omitted `arguments` renders what an empty one does").toBe(empty);
    }
    const omitted = empty;
    expect(omitted).toContain("No production class name given");
    expect(omitted).toContain("No namespace specified");

    const partial = promptText(await interop.getPrompt({ name: RECOVER_PROMPT, arguments: { production: "MyApp.Production" } }));
    const complete = promptText(await interop.getPrompt({ name: RECOVER_PROMPT, arguments: { production: "MyApp.Production", namespace: "MYAPP" } }));
    expect(partial).toContain("Production: `MyApp.Production`.");
    expect(partial).toContain("No namespace specified");
    expect(complete).toContain("Production: `MyApp.Production`.");
    expect(complete).toContain('Target namespace: "MYAPP"');

    const step3s = new Set<string>();
    for (const [label, text] of [["omitted", omitted], ["partial", partial], ["complete", complete]] as const) {
      const steps = expectSteps(text, LISTED[RECOVER_PROMPT].steps, label);
      const step3 = steps.get(3) as string;
      expect(step3.endsWith(` ${BLOCK_RULE}`), `${label}: step 3 ends with the block rule`).toBe(true);
      expect(step3, `${label}: step 3 still opens with the log query`).toMatch(
        /^3\. For each stuck\/errored item, call `iris_production_logs` filtered by `itemName` and\/or `type: "Error"` to understand what is actually wrong\. Under the `block` data policy/,
      );
      expect(occurrences(text, BLOCK_RULE), `${label}: the rule is in the prompt once`).toBe(1);
      expect(steps.get(4), `${label}: the recover step still comes next`).toMatch(/^4\. \*\*Try `iris_production_control` action 'recover' FIRST\*\*/);
      step3s.add(step3);
    }
    expect(step3s.size, "step 3 holds no argument, so it is one text").toBe(1);
  }, 120000);

  it("P4: every tool the prompts name is a real tool of the server that lists them, iris_production_logs takes what step 3 passes and advertises the block policy, and the edit prompt's tools are in core", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const devTools = await toolsOf(plain);
    const interopTools = await toolsOf(interop);

    const edit = promptText(await plain.getPrompt({ name: EDIT_PROMPT, arguments: { className: "MyApp.Orders", change: "x", testClass: "MyApp.Tests.T" } }));
    const deploy = promptText(await plain.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders" } }));
    const recover = promptText(await interop.getPrompt({ name: RECOVER_PROMPT, arguments: {} }));
    for (const token of [...toolTokens(edit), ...toolTokens(deploy)]) expect(devTools.has(token), `${token} is a real dev tool`).toBe(true);
    for (const token of toolTokens(recover)) expect(interopTools.has(token), `${token} is a real interop tool`).toBe(true);
    expect(toolTokens(recover), "step 3 added no tool: the ladder names these five").toEqual([
      "iris_production_control",
      "iris_production_logs",
      "iris_production_queues",
      "iris_production_status",
      "iris_production_summary",
    ]);
    // The tools the two test prompts named before Story 40.5, from the baseline renders with these arguments
    // (`git show e0d883b:packages/iris-dev-mcp/src/prompts/editAndTestClass.ts` and `deployAndTestClass.ts`, transpiled and
    // built against the shared dist, 2026-10-18): the note added no tool to either.
    expect(toolTokens(edit), "the note added no tool to the edit prompt").toEqual(["iris_doc_compile", "iris_doc_edit", "iris_doc_get", "iris_execute_tests"]);
    expect(toolTokens(deploy), "the note added no tool to the deploy prompt").toEqual([
      "iris_doc_compile",
      "iris_doc_edit",
      "iris_doc_get",
      "iris_doc_load",
      "iris_execute_tests",
      "iris_global_get",
      "iris_sql_query",
      "iris_test_coverage",
      "iris_test_status",
    ]);

    // Step 3 filters by `itemName` and `type: "Error"`, and the block rule describes the tool's own block behavior.
    const logs = interopTools.get("iris_production_logs") as WireTool;
    const logProps = logs.inputSchema.properties ?? {};
    expect("itemName" in logProps, "iris_production_logs takes itemName").toBe(true);
    expect((logProps["type"] as { enum?: string[] }).enum, "and a type that can be Error").toEqual(expect.arrayContaining(["Error"]));
    expect(logs.description ?? "", "the tool advertises the block policy").toContain("Under the block PHI data policy");
    expect(logs.description ?? "", "and the textPolicy that carries the reason").toContain("withheld with a reason in textPolicy");

    // The refusal the note names is one the dev test tools document, and both of them can return it.
    for (const name of ["iris_execute_tests", "iris_test_coverage"]) {
      expect(devTools.get(name)?.description ?? "", `${name} documents the PRODUCTION_BUSY refusal`).toContain("PRODUCTION_BUSY");
    }

    // The edit prompt's tools stay visible under the core preset.
    const core = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_TOOLS_PRESET: "core" });
    try {
      const coreTools = await toolsOf(core);
      for (const token of toolTokens(edit)) expect(coreTools.has(token), `${token} of the edit prompt is in core`).toBe(true);
      const coreEdit = promptText(await core.getPrompt({ name: EDIT_PROMPT, arguments: { className: "MyApp.Orders", change: "x" } }));
      expect(coreEdit.includes(PRODUCTION_BUSY_NOTE), "the note is in the prompt under core too").toBe(true);
    } finally {
      await core.close();
    }
  }, 120000);

  it("P5: a PRODUCTION_BUSY refusal for a production state IRIS cannot read has the fields the note branches on, ran nothing, and says what the note says", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const deploy = promptText(await plain.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: FRESH_CLASS } }));
    const note = stepsOf(deploy).get(4) as string;
    // The two branches of the note, read from the rendered text: the field one refusal has, and the state the other carries.
    const field = /When the refusal has a `(\w+)` field/.exec(note)?.[1];
    const state = /When its `state` is `(\w+)`/.exec(note)?.[1];
    expect(field, "the note names the field of the first branch").toBe("production");
    expect(state, "the note names the state of the second branch").toBe("Unknown");

    const before = await atelierScalar(oracleTarget(NS_BARE), "SELECT COUNT(*) FROM %UnitTest_Result.TestInstance");
    const result = await plain.call("iris_execute_tests", { target: FRESH_CLASS, level: "class", namespace: NS_BARE });
    expect(result.isError, "the refusal is an error result").toBe(true);
    const fields = result.structuredContent as Record<string, unknown>;
    expect(fields["code"]).toBe("PRODUCTION_BUSY");
    expect(fields["namespace"]).toBe(NS_BARE);
    expect(fields["state"], "the state the note's second branch tests").toBe(state);
    expect(fields, "no field the note's first branch tests").not.toHaveProperty(field as string);
    expect(typeof fields["error"] === "string" && (fields["error"] as string).length > 0, "the refusal says why: a non-empty error").toBe(true);
    expect(fields["testProductions"]).toEqual([{ class: FRESH_CLASS, production: FRESH_PRODUCTION }]);
    for (const key of ["total", "passed", "failed", "details", "jobId"]) expect(fields, `nothing ran: no ${key}`).not.toHaveProperty(key);
    expect(await atelierScalar(oracleTarget(NS_BARE), "SELECT COUNT(*) FROM %UnitTest_Result.TestInstance"), "no run was recorded").toBe(before);

    // The refusal's own words are the note's: try again in a moment, and nothing tells the model to stop a production.
    const text = allText(result);
    expect(text).toContain("could not be read");
    expect(text).toContain("Try again in a moment.");
    expect(text).not.toMatch(/iris_production_control|stop it/);
  }, 120000);

  it("P6: each generated SKILL.md is the render of its prompt, with its definition's skill description, while the server lists the unchanged prompt description", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const definitions = (await loadAllPrompts(REPO_ROOT)) as Array<{ prompt: { name: string; description: string; skill?: { description: string } } }>;
    const cases: Array<[string, WireSession, Record<string, string>]> = [
      [EDIT_PROMPT, plain, { className: "<className>", change: "<change>" }],
      [DEPLOY_PROMPT, plain, { classOrPackage: "<classOrPackage>" }],
      [RECOVER_PROMPT, interop, {}],
    ];
    for (const [name, session, placeholders] of cases) {
      const skill = readFileSync(path.join(REPO_ROOT, "skills", name, "SKILL.md"), "utf8");
      const parts = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(skill);
      expect(parts, `${name}: the skill has frontmatter and a body`).not.toBeNull();
      const frontmatter = parts?.[1] ?? "";
      expect(/^name: (.+)$/m.exec(frontmatter)?.[1], `${name}: the skill name`).toBe(name);
      const description = /^description: (".*")$/m.exec(frontmatter)?.[1];
      expect(description, `${name}: a quoted description`).toBeDefined();
      const definition = definitions.find((entry) => entry.prompt.name === name)?.prompt;
      expect(definition?.skill, `${name}: the definition sets its skill field`).toBeDefined();
      expect(JSON.parse(description as string), `${name}: the skill description is the definition's skill.description`).toBe(definition?.skill?.description);
      const listedDescription = (await listedPrompt(session, name)).description;
      expect(listedDescription, `${name}: the server lists the prompt's own, unchanged description`).toBe(definition?.description);
      expect(listedDescription, `${name}: the server does not list the skill description`).not.toBe(definition?.skill?.description);

      const rendered = promptText(await session.getPrompt({ name, arguments: placeholders }));
      expect((parts?.[2] ?? "").trimEnd(), `${name}: the skill body is the render, placeholders included`).toBe(rendered.trimEnd());
    }
    const recoverSkill = readFileSync(path.join(REPO_ROOT, "skills", RECOVER_PROMPT, "SKILL.md"), "utf8");
    expect(recoverSkill.includes(BLOCK_RULE), "the recover skill carries the block rule").toBe(true);
    for (const name of [EDIT_PROMPT, DEPLOY_PROMPT]) {
      expect(readFileSync(path.join(REPO_ROOT, "skills", name, "SKILL.md"), "utf8").includes(PRODUCTION_BUSY_NOTE), `the ${name} skill carries the note`).toBe(true);
    }
  }, 120000);
});

// -- Row T: DW-597 at the package level, through the tool, the route and the coverage tool ---------------------------

describe("Story 40.5 QA: a package-level test run runs every test class of the package, through the tool, the route and the coverage tool (AC-3)", () => {
  /** The coverage rows run only with the monitor idle; the others do not wait for it. */
  function coverageBlocked(testCtx: { skip: () => void }): boolean {
    if (coverageSkipReason === undefined) return false;
    if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.5 QA live gate may not be skipped: ${coverageSkipReason}`);
    skipTest(GATE_TAG, coverageSkipReason, testCtx);
    return true;
  }

  afterEach(async () => {
    if (skipReason || coverageSkipReason !== undefined) return;
    // A row that fails must not leave its session behind for the rows after it: the fixture stops it only when it is provably this gate's.
    await releaseLeftoverSession();
  });

  it("T1: iris_execute_tests at the package level runs the three classes and the six Test* methods, and not the abstract class, the class that is no test or the sibling package", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    expect(EXPECTED_PAIRS.map((pair) => pair[1]), "the fixture has six Test* methods in the classes that run").toHaveLength(6);

    const content = succeeded<RunContent>(await plain.call("iris_execute_tests", { target: "Story405Q", level: "package", namespace: NS }));
    expect(content.status).toBe("completed");
    expect(content.total, "total equals the number of Test* methods").toBe(EXPECTED_PAIRS.length);
    expect(content).toMatchObject({ passed: EXPECTED_PAIRS.length, failed: 0, skipped: 0 });
    expect(pairsOf(content.details), "the classes and methods that ran").toEqual(EXPECTED_PAIRS);
    expect(content.details.map((detail) => detail.status)).toEqual(Array(EXPECTED_PAIRS.length).fill("passed"));
  }, 180000);

  it("T2: POST /tests at the package level runs the same six methods; a class run and a method run of the sub-package class keep their one-colon specs and counts", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const post = async (target: string, level: string): Promise<RunContent> => {
      const answer = await postEnvelope(TARGET, "/tests", { target, level, namespace: NS });
      expect(answer.status, answer.text).toBe(200);
      expect(answer.errors, `${level} run of ${target}`).toEqual([]);
      return answer.result as unknown as RunContent;
    };

    const byPackage = await post("Story405Q", "package");
    expect(byPackage.total, JSON.stringify(byPackage)).toBe(EXPECTED_PAIRS.length);
    expect(byPackage).toMatchObject({ passed: EXPECTED_PAIRS.length, failed: 0 });
    expect(pairsOf(byPackage.details), "the route ran what the tool ran").toEqual(EXPECTED_PAIRS);

    const byClass = await post("Story405Q.Deep.CTest", "class");
    expect(byClass.total).toBe(3);
    expect(pairsOf(byClass.details).map((pair) => pair[0])).toEqual(Array(3).fill("Story405Q.Deep.CTest"));

    const byMethod = await post("Story405Q.Deep.CTest:TestTwo", "method");
    expect(byMethod.total).toBe(1);
    expect(pairsOf(byMethod.details)).toEqual([["Story405Q.Deep.CTest", "TestTwo"]]);
  }, 240000);

  it("T3: iris_test_coverage at the package level runs the same three classes under the recorded spec :A;B;C, and every branch of the covered class is covered", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    if (coverageBlocked(testCtx)) return;
    await expectMonitorIdle("T3, before");

    const { content } = await coverageRun("Story405Q", "package");
    expect(content).toMatchObject({
      status: "completed",
      total: EXPECTED_PAIRS.length,
      passed: EXPECTED_PAIRS.length,
      failed: 0,
      skipped: 0,
      namespace: NS,
      target: "Story405Q",
    });
    expect(content.coverage?.complete).toBe(true);
    expect(content.coverage?.classes.map((entry) => entry.class)).toEqual(["Story405Q.Subject"]);

    // The spec the run was created with: the service's own record, read from IRISTEMP, against the hand-written string.
    const spec = await coverageGlobal(`"run",${content.coverageRunId},"spec"`);
    expect(spec.defined, "the run record holds its spec").toBe(true);
    expect(spec.value, "one colon, then the classes separated by a semicolon alone").toBe(EXPECTED_PACKAGE_SPEC);

    // The classes that ran, by hand-written SQL over the run's result rows: the three test classes and no other.
    const rows = await atelierQuery(
      oracleTarget(NS),
      "SELECT DISTINCT tc.Name AS ClassName FROM %UnitTest_Result.TestCase tc JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID " +
        `JOIN %UnitTest_Result.TestInstance ti ON ts.TestInstance = ti.ID WHERE ti.InstanceIndex = ${content.runIndex} ORDER BY tc.Name`,
    );
    expect(rows.map((row) => row["ClassName"]), "the test classes the run recorded").toEqual(EXPECTED_CLASSES);

    // Each branch of Sign is reached by one test class only, so a class that did not run leaves its line uncovered.
    const routine = content.coverage?.classes[0]?.routines[0] as RoutineValues;
    expect(routine.coveredLines, "every executable line of the covered class ran").toBe(routine.executableLines);
    expect(routine.executableLines).toBeGreaterThan(0);
    await expectMonitorIdle("T3");
  }, 240000);

  it("T4: iris_test_coverage at the class and method levels keeps its specs and counts", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    if (coverageBlocked(testCtx)) return;
    await expectMonitorIdle("T4, before");

    const byClass = (await coverageRun("Story405Q.Deep.CTest", "class")).content;
    expect(byClass).toMatchObject({ status: "completed", total: 3, passed: 3, failed: 0 });
    expect((await coverageGlobal(`"run",${byClass.coverageRunId},"spec"`)).value).toBe(":Story405Q.Deep.CTest");
    await expectMonitorIdle("T4, class");

    const byMethod = (await coverageRun("Story405Q.ATest:TestSign", "method")).content;
    expect(byMethod).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });
    expect((await coverageGlobal(`"run",${byMethod.coverageRunId},"spec"`)).value).toBe(":Story405Q.ATest:TestSign");
    await expectMonitorIdle("T4, method");
  }, 240000);
});
