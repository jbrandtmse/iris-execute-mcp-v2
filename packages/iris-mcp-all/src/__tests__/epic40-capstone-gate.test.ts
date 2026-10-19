/**
 * Epic 40 capstone gate: the coverage loop of Epic 40 driven on the REAL wire against one disposable namespace, in the default suite
 * (project rule #21), each row naming the path it guards (rule #59).
 *
 * Every row drives the BUILT iris-dev-mcp dist (the coverage and companion tools, the prompt and `tools/list`), spawned as a child
 * process, through the real MCP SDK `Client` over stdio, and calls the tools against the live IRIS with `server: "default"` and an
 * explicit namespace. The built iris-admin-mcp dist creates and removes the namespace. The independent oracles are the values captured
 * live (`coverage-fixture.ts`, Rule #36), the class documents read by raw Atelier `GET /doc`, the raw coverage routes, the written
 * Cobertura file read from disk and checked against the pinned content model (`scripts/lib/cobertura-dtd.mjs`; no DTD file is
 * vendored), and the monitor read through the fixture class; never the tools under test.
 *
 * Fixture: the namespace `EXECMCPTMP402C` (no Interoperability) holds the Story 40.2 report fixture (`Story402.*`, used verbatim) and
 * the Story 40.4 class-source mapping fixture (`Story404.*`, `coverage-fixture.ts` `seedSourceMapFixture`). No production is started and
 * no TestProduction test is run: the guard for those is pinned by the Story 40.3 gates.
 *
 * Rows (each runs the loop from the seeded fixture up to its own step, so they pass in any order):
 *  1. The wire surfaces: `tools/list` declares `iris_execute_tests` with the hints of a write (all four false) and lists both coverage
 *     tools, and `deploy-and-test-class` renders its coverage step and its PRODUCTION_BUSY note with its name, title and arguments
 *     unchanged. Path: SDK `Client` -> built dev dist -> `tools/list` and `prompts/get`.
 *  2. The summary and the verdict of `Story402.FixtureTest` over `Story402.Fixture` and `Story402.Layout` with `minCoverage` 50.
 *  3. The companion re-attaches by the handle alone and reproduces row 2's coverage.
 *  4. The Cobertura file of row 2's run validates and reads back equal to its summary.
 *  5. DW-602: every initializing `#dim` line of `Story404.Dim` is an executable, covered class line at its own line; no other
 *     preprocessor line is reported.
 *  6. DW-601, fresh: a class whose methods hold only preprocessor lines is not `not-up-to-date`, and two methods whose names share
 *     their first 31 characters report their lines, with distinct label lines and `lineMap` 10 in the raw Status record.
 *  7. DW-601, stale: a class saved with a documentation-only edit after its compile is `not-up-to-date` (its raw `lineMap` is 0), its
 *     verdict and the overall verdict fail without a tool error, and the exported file has no element for it.
 *  8. A monitor session the suite did not start refuses the run with `MONITOR_BUSY` owner `foreign`, left untouched, and allocates no
 *     run id. Path: SDK `Client` -> built dev dist -> `iris_test_coverage` -> the `Launch` route's busy decision, IRIS side.
 *
 * The setup checks that the monitor is idle (an armed gate fails and names a session it did not start, an unarmed one skips, and the
 * session is left alone). Every row starts by asserting it idle again (a session that appeared since fails the row and is left alone)
 * and ends asserting the monitor idle with no ownership node. The one foreign session is the fixture's own, on
 * its own routine, started and stopped through the fixture. `afterAll` stops a suite or foreign session a failed row left behind
 * (`StopIfList`, which proves the session before it stops it), removes the namespace, the database files, the fixture class and the
 * temporary directory, and asserts that nothing is left.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773, `_SYSTEM`, HSCUSTOM).
 * Writes only the namespace and database `EXECMCPTMP402C` (with the `Story402` and `Story404` classes inside it), a temporary
 * directory and the HSCUSTOM class `ExecuteMCPv2.Temp.Story391Fixture`.
 *
 * Placement (rule #45): `@iris-mcp/all` spawns built dists. A missing or stale `shared`, dev, admin or interop dist, an unresolvable SDK
 * or an unreachable IRIS skips each test with the reason, or fails with "may not be skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in
 * `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  STORY402_FIXTURE_SOURCE_VALUES,
  STORY402_LAYOUT_SOURCE_VALUES,
  STORY404_DIM_SOURCE_VALUES,
  STORY404_HOOKS_SOURCE_VALUES,
  STORY404_LONG_SOURCE_VALUES,
  seedReportFixture,
  seedSourceMapFixture,
} from "./coverage-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "epic40-capstone-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The one scratch namespace, holding the Story402 and Story404 classes (no Interoperability). */
const NS = "EXECMCPTMP402C";
const NAMESPACES = [NS];

/** The operator enables the write tool and the companion's export; nothing else is enabled. */
const ENABLED_GOVERNANCE = JSON.stringify({ global: { iris_test_coverage: true, "iris_test_status:export": true } });

/** The route below the web port, for raw HTTP. */
const COVERAGE_ROUTE = "/api/executemcp/v2/dev/test/coverage";

/** The routines of the session a row of this gate may leave behind (a suite run's), and of the fixture's foreign session. */
const SUITE_ROUTINE_SETS = [
  "Story402.Fixture.1,Story402.Layout.1",
  "Story404.Dim.1,Story404.Hooks.1,Story404.Long.1,Story404.Stale.1",
];
const FOREIGN_ROUTINES = "ExecuteMCPv2.Temp.Story391Fixture.1";

/** The classes of the report run (rows 2 to 4, 8) and of the mapping run (rows 5 to 7). */
const REPORT_CLASSES = ["Story402.Fixture", "Story402.Layout"];
const MAPPING_CLASSES = ["Story404.Dim", "Story404.Hooks", "Story404.Long", "Story404.Stale"];

/** The prompt under test. */
const DEPLOY_PROMPT = "deploy-and-test-class";

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
let tempDir = "";

const { fixtureCall, monitorState, coverageGlobal, runCounter, expectMonitorIdle, releaseLeftoverSession } = monitorGate({
  dev: () => dev,
  suiteRoutineSets: [...SUITE_ROUTINE_SETS, FOREIGN_ROUTINES],
});

function wireOptions(pkg: string): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: distEntry(REPO_ROOT, pkg), target: TARGET, clientName: "epic40-capstone-gate" };
}

/** The target of the raw Atelier oracle: the scratch namespace. */
const oracleTarget = (): typeof TARGET => ({ ...TARGET, namespace: NS });

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
  failed?: number;
  coverageRunId: number;
  runIndex: number | null;
  namespace: string;
  error?: string;
  cobertura?: { outputPath: string; bytes: number; classes: number; lines: number };
  coverage?: {
    complete: boolean;
    classes: Array<{ class: string; source?: ClassSourceContent }>;
    unmeasured: Array<{ class: string; reason: string }>;
    source?: { executableLines: number; coveredLines: number; percent: number | null };
    verdict?: Verdict;
  };
}

interface RawSource {
  class: string;
  reason?: string;
  lineMap?: number;
  methods: Array<{ name: string; line: number | null; reason?: string; routine?: string; intLines?: number[]; labelLine?: number }>;
}

// -- Calling the tools ----------------------------------------------------------------

/** The structured content of a tool call that must not be an error. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

/** The companion's call by the handle alone: through the session's `raw` call, so no namespace is sent. */
function companion(action: "poll" | "export", coverageRunId: number | string, extra: Record<string, unknown> = {}): Promise<WireToolResult> {
  return dev.raw("iris_test_status", { action, coverageRunId: String(coverageRunId), ...extra });
}

/** The result of a call that may have returned `running`: polled by its `coverageRunId` until it completes. */
async function settled(result: WireToolResult): Promise<{ result: WireToolResult; content: CoverageContent }> {
  let current = result;
  let content = succeeded<CoverageContent>(current);
  const deadline = Date.now() + 120000;
  while (content.status === "running" && Date.now() < deadline) {
    await sleep(500);
    current = await companion("poll", content.coverageRunId);
    content = succeeded<CoverageContent>(current);
  }
  expect(content.status, "the run completed").toBe("completed");
  return { result: current, content };
}

/** `iris_test_coverage` over the Story 40.2 report fixture with the row 2 arguments, and `overrides`. */
function reportRun(overrides: Record<string, unknown> = {}): Promise<{ result: WireToolResult; content: CoverageContent }> {
  return dev
    .call("iris_test_coverage", {
      target: "Story402.FixtureTest",
      level: "class",
      classes: REPORT_CLASSES,
      minCoverage: 50,
      namespace: NS,
      ...overrides,
    })
    .then(settled);
}

/** `iris_test_coverage` over the four Story 40.4 classes. */
function mappingRun(overrides: Record<string, unknown> = {}): Promise<{ result: WireToolResult; content: CoverageContent }> {
  return dev
    .call("iris_test_coverage", {
      target: "Story404.FixtureTest",
      level: "class",
      classes: MAPPING_CLASSES,
      minCoverage: 50,
      namespace: NS,
      ...overrides,
    })
    .then(settled);
}

/** The Status route of the service, raw: its HTTP status and the run record. */
async function rawStatus(coverageRunId: number): Promise<{ status: number; run: Record<string, unknown> & { sources?: RawSource[] } }> {
  const answer = await rawIrisRequest(TARGET, `${COVERAGE_ROUTE}?id=${coverageRunId}`, { method: "GET" });
  const body = answer.json as { result?: Record<string, unknown> } | undefined;
  return { status: answer.status, run: body?.result ?? {} };
}

/** The raw class-source record of one class of a run. */
async function rawSource(coverageRunId: number, className: string): Promise<RawSource> {
  const found = (await rawStatus(coverageRunId)).run.sources?.find((entry) => entry.class === className);
  expect(found, `the raw Status record of run ${coverageRunId} has a class-source entry for ${className}`).toBeDefined();
  return found as RawSource;
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

/** The line numbers of a list of ranges. */
function linesOf(ranges: Range[]): number[] {
  return ranges.flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, index) => start + index));
}

/** A path below the gate's own temporary directory. */
function tempPath(...segments: string[]): string {
  return path.join(tempDir, ...segments);
}

type XmlNode = { name: string; attributes: Record<string, string>; children: XmlNode[] };

/** The `[line, hits]` pairs of each class element of a Cobertura document, by class name. */
function coberturaLines(xml: string): Map<string, Array<[number, number]>> {
  const found = new Map<string, Array<[number, number]>>();
  const walk = (node: XmlNode): void => {
    if (node.name === "class") {
      const lines = node.children.find((child) => child.name === "lines");
      found.set(
        node.attributes["name"] as string,
        (lines?.children ?? []).map((line): [number, number] => [Number(line.attributes["number"]), Number(line.attributes["hits"])]),
      );
      return;
    }
    node.children.forEach(walk);
  };
  walk(parseXml(xml).root as XmlNode);
  return found;
}

// -- Setup and teardown ------------------------------------------------------------------

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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Epic 40 capstone live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  const openedAt = Date.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_GOVERNANCE: ENABLED_GOVERNANCE });
  const bootstrapSeconds = (Date.now() - openedAt) / 1000;
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  // eslint-disable-next-line no-console
  console.log(`[INFO] ${GATE_TAG}: the dev server opened (startup bootstrap included) in ${bootstrapSeconds.toFixed(1)} s`);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  await putFixtureClass(dev);

  // Every row starts with the monitor idle. A session this gate did not start is named and left alone.
  const initial = await monitorState();
  if (initial.active !== 0) {
    const named = `a Line-by-Line or PERFMON session this gate did not start is active (process list "${initial.pids}", ${initial.count} routine(s): ${JSON.stringify(initial.routines)}); it was left untouched`;
    await admin.close();
    await removeFixtureClass(dev);
    await dev.close();
    // Set before the armed throw too, so afterAll sees closed sessions and nothing to remove.
    skipReason = named;
    if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so the Epic 40 capstone live gate may not be skipped: ${named}`);
    return;
  }

  tempDir = mkdtempSync(path.join(tmpdir(), "epic40-capstone-"));
  await removeInteropNamespace(admin, dev, NS);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);
  await createInteropNamespace(admin, dev, NS, { interop: false });
  await seedReportFixture(dev, NS);
  await seedSourceMapFixture(dev, NS);

  // A positive control: the same check that must read empty after the run sees the namespace now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees the namespace while it exists").toEqual(
    expect.arrayContaining([`namespace ${NS}`, `database configuration ${NS}`]),
  );
}, 300000);

beforeEach(async () => {
  if (skipReason) return;
  // The idle check before each row: a session this gate did not start fails the row and is left alone.
  const state = await monitorState();
  expect(state.active, `a monitor session is active before the row (process list "${state.pids}", routines ${JSON.stringify(state.routines)}); it was left untouched`).toBe(0);
  expect((await coverageGlobal('"session"')).defined, "no ownership node before the row").toBe(false);
});

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
    await attempt("stopping a coverage or foreign session left behind", releaseLeftoverSession);
    await attempt("the monitor is idle", async () => {
      expect((await monitorState()).active, "the monitor is idle after the run").toBe(0);
    });
    await attempt("no coverage ownership node is left", async () => {
      expect((await coverageGlobal('"session"')).defined, "no suite session node after the run").toBe(false);
    });
    await attempt(`removing ${NS}`, () => removeInteropNamespace(admin, dev, NS));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, NAMESPACES), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the temporary directory", async () => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      expect(tempDir !== "" && existsSync(tempDir), "the temporary directory is gone").toBe(false);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story391Fixture", "Story404", "Story402"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- Row 1: the wire surfaces ------------------------------------------------------------

describe("Epic 40 capstone: the wire surfaces of the built dev server (row 1)", () => {
  it("row 1: tools/list declares iris_execute_tests with the hints of a write and lists both coverage tools; deploy-and-test-class renders its coverage step and its PRODUCTION_BUSY note, with its name, title and arguments unchanged", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const tools = await dev.listTools();
    const byName = new Map(tools.map((tool) => [tool.name, tool]));
    expect(byName.get("iris_execute_tests")?.annotations, "the hints of a write: not read-only, not idempotent").toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(byName.has("iris_test_coverage"), "the coverage tool is listed").toBe(true);
    expect(byName.has("iris_test_status"), "so is its companion").toBe(true);

    const listed = (await dev.listPrompts()).find((prompt) => prompt.name === DEPLOY_PROMPT);
    expect(listed?.title).toBe("Deploy And Test Class");
    expect(listed?.arguments?.map((argument) => [argument.name, argument.required === true])).toEqual([["classOrPackage", true]]);

    const rendered = await dev.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "Story402.FixtureTest" } });
    expect(rendered.messages).toHaveLength(1);
    const text = rendered.messages[0]?.content.text ?? "";
    expect(text).toContain("Target: `Story402.FixtureTest`");
    const step4 = text.slice(text.indexOf("\n4. "), text.indexOf("\n5. "));
    expect(step4, "step 4 says what a PRODUCTION_BUSY refusal means").toContain("If the response is a `PRODUCTION_BUSY` refusal, nothing ran");
    const step8 = text.slice(text.indexOf("\n8. "), text.indexOf("\n9. "));
    expect(step8, "step 8 is the optional coverage step").toContain("Optional");
    for (const marker of ["`iris_test_coverage`", "refused with `GOVERNANCE_DISABLED`", "refused with `MONITOR_BUSY`", "`coverageRunId`", "do NOT re-submit"]) {
      expect(step8, `step 8 names ${marker}`).toContain(marker);
    }
    expect(text.indexOf("\n9. Report"), "the report step follows it").toBeGreaterThan(text.indexOf("\n8. Optional"));
    await expectMonitorIdle("row 1");
  }, 120000);
});

// -- Rows 2 to 4: the report loop ------------------------------------------------------------

describe("Epic 40 capstone: the summary, the verdict, the re-attach and the Cobertura file (rows 2 to 4)", () => {
  it("row 2: the summary deep-equals the 40.2 constants, the totals add up, and minCoverage 50 passes both classes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await reportRun();
    expect(content).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0, namespace: NS });
    expect(content.coverage?.complete).toBe(true);
    const fixture = sourceOf(content, "Story402.Fixture");
    expect(withoutGeneratedCovered(fixture)).toEqual({ ...STORY402_FIXTURE_SOURCE_VALUES, generated: { executableLines: 23 } });
    expect(fixture.generated.coveredLines, "generated code that ran is counted, not pinned").toBeLessThanOrEqual(23);
    expect(sourceOf(content, "Story402.Layout")).toEqual(STORY402_LAYOUT_SOURCE_VALUES);
    expect(content.coverage?.source).toEqual({ executableLines: 27, coveredLines: 24, percent: 88.89 });
    expect(content.coverage?.unmeasured).toEqual([]);
    expect(content.coverage?.verdict).toEqual({
      minCoverage: 50,
      overall: "pass",
      percent: 88.89,
      classes: [
        { class: "Story402.Fixture", verdict: "pass", percent: 95.65 },
        { class: "Story402.Layout", verdict: "pass", percent: 50 },
      ],
    });
    await expectMonitorIdle("row 2");
  }, 240000);

  it("row 3: iris_test_status poll by the coverageRunId alone returns row 2's coverage", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await reportRun();
    const polled = succeeded<CoverageContent>(await companion("poll", content.coverageRunId));
    expect(polled.status).toBe("completed");
    expect(polled.coverage, "the handle reproduces the primary call's coverage, summary and verdict").toEqual(content.coverage);
    expect(polled.coverage?.verdict?.overall).toBe("pass");
    await expectMonitorIdle("row 3");
  }, 240000);

  it("row 4: the exported Cobertura file validates against the pinned content model and, read back, equals row 2's summary", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await reportRun();
    const target = tempPath("row4", "epic40.xml");
    const exported = await companion("export", content.coverageRunId, { outputPath: target });
    expect(exported.isError, allText(exported)).toBeFalsy();
    const xml = readFileSync(target, "utf8");
    expect(validateCobertura(xml), "the file is valid against the pinned content model").toEqual([]);
    const result = exported.structuredContent as unknown as CoverageContent;
    expect(result.cobertura).toEqual({ outputPath: path.resolve(target), bytes: Buffer.byteLength(xml), classes: 2, lines: 27 });

    const written = coberturaLines(xml);
    expect([...written.keys()]).toEqual(REPORT_CLASSES);
    for (const className of REPORT_CLASSES) {
      const source = sourceOf(content, className);
      const covered = new Set(linesOf(source.coveredRanges));
      const lines = written.get(className) ?? [];
      expect(lines.map(([line]) => line), `${className}: the file's lines are the summary's executable lines`).toEqual(linesOf(source.executableRanges));
      for (const [line, hits] of lines) expect(hits > 0, `${className} line ${line}: hits above 0 exactly on the covered lines`).toBe(covered.has(line));
    }
    expect([...written.values()].reduce((sum, lines) => sum + lines.length, 0), "the file's lines are the run's executable class lines").toBe(
      content.coverage?.source?.executableLines,
    );
    await expectMonitorIdle("row 4");
  }, 240000);
});

// -- Rows 5 to 7: the class-source mapping fixes ---------------------------------------------

describe("Epic 40 capstone: the class-source mapping of initializing #dim lines, fresh directive-only methods, and stale classes (rows 5 to 7)", () => {
  it("row 5: every initializing #dim line of Story404.Dim is an executable, covered class line at its own line, and no other preprocessor line is reported", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await mappingRun();
    const dim = sourceOf(content, "Story404.Dim");
    // The class document is read by raw Atelier GET /doc, never by the tools under test.
    const stored = (await atelierDocument(oracleTarget(), "Story404.Dim.cls")).content;
    const text = (line: number): string => (stored[line - 1] ?? "").trim();
    const initializing = stored.map((_, index) => index + 1).filter((line) => /^#dim\b.*=/i.test(text(line)));
    expect(initializing.length, "the stored class has nine initializing #dim lines").toBe(9);
    const reported = linesOf(dim.executableRanges);
    const covered = new Set(linesOf(dim.coveredRanges));
    for (const line of initializing) {
      expect(reported, `the initializing #dim at line ${line} (${text(line)}) is an executable class line`).toContain(line);
      expect(covered.has(line), `and it is covered`).toBe(true);
    }
    const directives = reported.filter((line) => text(line).startsWith("#"));
    expect(directives, "no other preprocessor line is reported").toEqual(initializing);
    expect(dim.uncoveredRanges, "FixtureTest reaches every line of Story404.Dim").toEqual([]);
    expect(dim, "the live values of the whole class summary").toEqual(STORY404_DIM_SOURCE_VALUES);
    await expectMonitorIdle("row 5");
  }, 240000);

  it("row 6: Story404.Hooks has no reason, no executable class line and verdict notApplicable; the two long-name methods of Story404.Long report their lines, with distinct label lines and lineMap 10 in the raw Status record", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await mappingRun();
    const hooks = sourceOf(content, "Story404.Hooks");
    expect(hooks).not.toHaveProperty("reason");
    expect(hooks.executableLines).toBe(0);
    expect(hooks, "the live values of the class summary").toEqual(STORY404_HOOKS_SOURCE_VALUES);
    expect(content.coverage?.verdict?.classes.find((entry) => entry.class === "Story404.Hooks")).toEqual({
      class: "Story404.Hooks",
      verdict: "notApplicable",
      percent: null,
    });
    expect(sourceOf(content, "Story404.Long"), "both long-name methods report their lines").toEqual(STORY404_LONG_SOURCE_VALUES);

    const raw = await rawSource(content.coverageRunId, "Story404.Long");
    expect(raw.lineMap, "a fresh class has its line map").toBe(10);
    const labels = raw.methods.map((method) => method.labelLine ?? 0);
    expect(labels.every((label) => label > 0), "every method has a label line").toBe(true);
    expect(new Set(labels).size, "and the labels are distinct").toBe(labels.length);
    expect((await rawSource(content.coverageRunId, "Story404.Hooks")).lineMap).toBe(10);
    await expectMonitorIdle("row 6");
  }, 240000);

  it("row 7: Story404.Stale is not-up-to-date with raw lineMap 0, its verdict and the overall verdict fail without a tool error, and the exported file has no element for it", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { result, content } = await mappingRun();
    expect(result.isError, "a failing verdict is not a tool error").toBeFalsy();
    expect(sourceOf(content, "Story404.Stale")).toEqual({ reason: "not-up-to-date" });
    expect(content.coverage?.verdict?.classes.find((entry) => entry.class === "Story404.Stale")).toEqual({
      class: "Story404.Stale",
      verdict: "fail",
      percent: null,
      reason: "not-up-to-date",
    });
    expect(content.coverage?.verdict?.overall).toBe("fail");
    const raw = await rawSource(content.coverageRunId, "Story404.Stale");
    expect(raw.lineMap, "the documentation edit removed the class's line map").toBe(0);
    expect(raw).not.toHaveProperty("reason");
    expect(raw.methods.some((method) => (method.labelLine ?? 0) > 0), "while its methods still have label lines").toBe(true);

    const target = tempPath("row7", "stale.xml");
    const exported = await companion("export", content.coverageRunId, { outputPath: target });
    expect(exported.isError, allText(exported)).toBeFalsy();
    const xml = readFileSync(target, "utf8");
    expect(validateCobertura(xml)).toEqual([]);
    const written = coberturaLines(xml);
    expect([...written.keys()], "the classes that have a class-source result, and not the stale one").toEqual(["Story404.Dim", "Story404.Hooks", "Story404.Long"]);
    expect(written.get("Story404.Hooks"), "a class with no executable line has no line element").toEqual([]);
    expect((exported.structuredContent as unknown as CoverageContent).cobertura).toMatchObject({ classes: 3, lines: 27 });
    await expectMonitorIdle("row 7");
  }, 240000);
});

// -- Row 8: a session the suite did not start --------------------------------------------------

describe("Epic 40 capstone: a monitor session the suite did not start refuses the run (row 8)", () => {
  it("row 8: a pre-started foreign session is refused as MONITOR_BUSY owner foreign, left untouched, and no run id is allocated", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const started = await fixtureCall("StartForeign");
    expect(started).toMatch(/^started:\d+$/);
    let stopped = false;
    try {
      const before = await monitorState();
      expect(before.active).toBe(1);
      const counter = await runCounter();

      const refused = await dev.call("iris_test_coverage", {
        target: "Story402.FixtureTest",
        level: "class",
        classes: REPORT_CLASSES,
        minCoverage: 50,
        namespace: NS,
      });
      expect(refused.isError, allText(refused)).toBe(true);
      expect(refused.structuredContent).toEqual({ code: "MONITOR_BUSY", owner: "foreign" });
      expect(allText(refused)).toContain("nothing was started");
      expect(allText(refused)).toContain("left untouched");

      const after = await monitorState();
      expect(after.active, "the foreign session is still active").toBe(1);
      expect(after.pids, "with the same process list").toBe(before.pids);
      expect(after.count, "and the same number of routines").toBe(before.count);
      expect(after.routines, "and one routine, each name either unreadable here or exactly the foreign session's").toHaveLength(1);
      expect([FOREIGN_ROUTINES, ""], "a request process outside the session's process list reads the name as empty").toContain(after.routines[0]);
      expect(await runCounter(), "no run id was allocated, and the sequence counter is unchanged").toBe(counter);

      expect(await fixtureCall("StopIfList", [FOREIGN_ROUTINES])).toBe("stopped");
      stopped = true;
      await expectMonitorIdle("row 8, after the foreign session was stopped");
    } finally {
      if (!stopped) await fixtureCall("StopIfList", [FOREIGN_ROUTINES]);
    }
    await expectMonitorIdle("row 8");
  }, 180000);
});
