/**
 * Story 40.5 live gate: DW-597, `POST /tests` at the package level runs every test class of the package, driven on the
 * REAL wire against a disposable namespace, in the default suite (rule #59: each row names the path it guards).
 *
 * Path: SDK `Client` -> built iris-dev-mcp and iris-admin-mcp dists, spawned as child processes, for the fixtures only
 * (the namespace, the fixture class, the two test classes); then raw HTTP `POST /api/executemcp/v2/tests` ->
 * `ExecuteMCPv2.REST.UnitTest:RunTests` -> `BuildTestSpec` -> `%UnitTest.Manager:RunTest` in the scratch namespace.
 * The `%ALL` package mapping of `ExecuteMCPv2` to HSCUSTOM makes the handler resolve there. The route has no tool
 * caller (decision #40), so the raw request is the surface. The oracles are the test sources written out below
 * (three methods, all passing) and the route's own response envelope; never `BuildTestSpec` itself.
 *
 *  - Row 6: `level: "package"` over `Story405` (`Story405.ATest` with `TestOne` and `TestTwo`, `Story405.BTest` with
 *    `TestThree`) runs all three methods: `errors` empty, `total` 3, `passed` 3, `failed` 0, and the details in class
 *    then method order. Before the fix the spec was `:A;:B`, which `%UnitTest.Manager` reads as class A and a method
 *    named B, and the run reported `total` 0.
 *  - Row 7 (back-compat, AD-33): `level: "class"` and `level: "method"` run one method each, and the result keeps
 *    exactly the six keys `total, passed, failed, skipped, duration, details`.
 *
 * No Line-by-Line session and no production is started, `EnableNamespace` is never called, and no spec that could
 * resolve to every test class under `^UnitTestRoot` is sent. `beforeAll` removes leftovers by name and asserts there
 * are none; `afterAll` removes the namespace, its database files and the fixture class, and asserts that nothing is
 * left, in the namespace or in HSCUSTOM.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the namespace and database `EXECMCPTMP405A`, `Story405.*` inside it, and the HSCUSTOM
 * class `ExecuteMCPv2.Temp.Story391Fixture`. A missing or stale dist, an unresolvable SDK or an unreachable IRIS skips
 * each row with the reason, or fails with "may not be skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in
 * `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDeployedBootstrapVersion,
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
} from "./process-gate-helpers.js";
import {
  FIXTURE_DOC,
  createInteropNamespace,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
} from "./interop-namespace-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-5-burn-down-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The one scratch namespace: no mappings beyond the system's, holding the two test classes. */
const NS = "EXECMCPTMP405A";
const NAMESPACES = [NS];

/** The route under test, below `/api/executemcp/v2`. */
const TESTS_ROUTE = "/tests";

/** The keys of a `POST /tests` result, in the order `ParseTestResults` sets them, written out from its source. */
const RESULT_KEYS = ["total", "passed", "failed", "skipped", "duration", "details"];

const A_TEST_DOC = "Story405.ATest.cls";
const A_TEST_SOURCE = String.raw`/// Two passing tests, for the package-level run of Story 40.5.
Class Story405.ATest Extends %UnitTest.TestCase
{

Method TestOne()
{
    Do $$$AssertEquals(1, 1, "one is one")
}

Method TestTwo()
{
    Do $$$AssertEquals(2, 2, "two is two")
}

}
`;

const B_TEST_DOC = "Story405.BTest.cls";
const B_TEST_SOURCE = String.raw`/// One passing test, for the package-level run of Story 40.5.
Class Story405.BTest Extends %UnitTest.TestCase
{

Method TestThree()
{
    Do $$$AssertEquals(3, 3, "three is three")
}

}
`;

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;

function wireOptions(pkg: string): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "story-40-5-live-gate",
  };
}

interface TestsResult {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  details: Array<{ class: string; method: string; status: string; duration: number; message: string }>;
}

/** `POST /tests` for `target` at `level` in the scratch namespace: no envelope error, and the parsed result. */
async function runTests(target: string, level: "package" | "class" | "method"): Promise<TestsResult> {
  const answer = await postEnvelope(TARGET, TESTS_ROUTE, { target, level, namespace: NS });
  expect(answer.status, answer.text).toBe(200);
  expect(answer.errors, `${level} run of ${target}`).toEqual([]);
  return answer.result as unknown as TestsResult;
}

/** The (class, method) pairs of a result, in the order the route returned them. */
function pairsOf(result: TestsResult): string[][] {
  return result.details.map((detail) => [detail.class, detail.method]);
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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.5 live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  await putFixtureClass(dev);
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS, { interop: false });
  const fixtures = docFixtures(dev, NS);
  await fixtures.putDoc(A_TEST_DOC, A_TEST_SOURCE);
  await fixtures.putDoc(B_TEST_DOC, B_TEST_SOURCE);
  await fixtures.compileDoc(A_TEST_DOC);
  await fixtures.compileDoc(B_TEST_DOC);

  // A positive control: the same check that must read empty after the run sees the namespace while it exists.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees the namespace while it exists").toEqual(
    expect.arrayContaining([`namespace ${NS}`, `database configuration ${NS}`]),
  );
}, 300000);

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const { problems, attempt } = teardownRecorder();
  try {
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
    for (const session of [admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- DW-597 ---------------------------------------------------------------

describe("Story 40.5: DW-597, POST /tests at the package level runs every test class of the package (AC-3)", () => {
  it("row 6: the package Story405 runs its two classes and three methods, all passing, in class then method order", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await runTests("Story405", "package");
    expect(result.total, JSON.stringify(result)).toBe(3);
    expect(result.passed).toBe(3);
    expect(result.failed).toBe(0);
    expect(pairsOf(result)).toEqual([
      ["Story405.ATest", "TestOne"],
      ["Story405.ATest", "TestTwo"],
      ["Story405.BTest", "TestThree"],
    ]);
    expect(result.details.map((detail) => detail.status)).toEqual(["passed", "passed", "passed"]);
  }, 120000);

  it("row 7: a class run and a method run are unchanged (one method each), and the result keeps exactly its six keys", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const byClass = await runTests("Story405.BTest", "class");
    expect(byClass.total).toBe(1);
    expect(byClass.passed).toBe(1);
    expect(pairsOf(byClass)).toEqual([["Story405.BTest", "TestThree"]]);
    expect(Object.keys(byClass)).toEqual(RESULT_KEYS);

    const byMethod = await runTests("Story405.ATest:TestTwo", "method");
    expect(byMethod.total).toBe(1);
    expect(byMethod.passed).toBe(1);
    expect(pairsOf(byMethod)).toEqual([["Story405.ATest", "TestTwo"]]);
    expect(Object.keys(byMethod)).toEqual(RESULT_KEYS);

    const byPackage = await runTests("Story405", "package");
    expect(Object.keys(byPackage)).toEqual(RESULT_KEYS);
  }, 120000);
});
