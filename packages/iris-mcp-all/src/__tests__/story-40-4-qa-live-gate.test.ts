/**
 * Story 40.4 QA live gate: what the Story 40.4 gates leave open, on the BUILT iris-dev-mcp and iris-admin-mcp dists over real stdio
 * JSON-RPC (project rule #46) against the live IRIS. It runs in the default suite and is armed by `IRIS_REQUIRE_LIVE` (listed in
 * `scripts/prepublish-gate.mjs` `gateTestFiles`).
 *
 * Every row names the path it guards (rule #59). The oracles are the class documents and INT routines read by raw Atelier `GET /doc`,
 * the raw Status route, the governance policy `iris_server_profiles` reports, and the real `tools/list` and `prompts/get` of the spawned
 * server; never the code under test. Every pinned class line was captured live (rule #36, IRIS 2026.2 build 221U, 2026-10-18, in
 * `EXECMCPTMP404Q`) and checked by hand against the stored class text and the INT text of its routine.
 *
 * Rows:
 *  A. The `deploy-and-test-class` prompt through the spawned dev server (SDK `Client` -> stdio -> `prompts/get`): `arguments` omitted is a
 *     clean InvalidParams and the connection stays usable; the required argument alone renders nine steps in order, and an unknown extra
 *     argument changes nothing; step 8 names the tools, arguments, refusals and recipe that really exist (the `tools/list` input schemas,
 *     the refusal shape, the governance policy, the real preset lists); `skills/deploy-and-test-class/SKILL.md` equals the render.
 *  B. The corrected annotations under the `full`, `core` and `developer` presets as a client reads them in `tools/list`, and the defaults the
 *     docs state (`iris_execute_tests` and `iris_test_status:poll` enabled; `iris_test_coverage`, `:cancel` and `:export` disabled, refused
 *     with nothing written and no run id allocated).
 *  C. DW-601 and DW-602 on a fixture the first 40.4 gates did not use (rule #58): initializing and non-initializing `#dim` lines mixed in
 *     one method, a trailing `//` or `;` comment that holds an `=`, methods whose names begin with `%`, and classes saved with a
 *     comment-only edit after their compile (a default compile leaves them stale, a forced compile rebuilds them). Every reported line is
 *     pinned against the lines an independent rule reads from the stored class text.
 *  D. `iris_test_status` with a runIndex that does not exist (and the same index in a second namespace), a malformed runIndex and jobId, a
 *     stale jobId, and a runIndex whose result table cannot be read: each answers instead of throwing, the handler paths with an error
 *     envelope in `structuredContent`.
 *
 * Fixture: `EXECMCPTMP404Q` holds `Story404Q.*` (no Interoperability) and `EXECMCPTMP404R` is a second, empty namespace. No production is
 * started. The gate starts coverage sessions only in rows C and never touches a session it did not start: the setup and every row start
 * with the monitor idle (an armed gate fails and names a session it did not start, an unarmed one skips, and the session is left alone),
 * and every row that runs coverage ends asserting the monitor idle with no ownership node. `afterAll` stops a session a failed row left
 * behind (`StopIfList`, which proves the session before it stops it), removes both namespaces (their database files too), the fixture class
 * and the temporary directory, and asserts that nothing is left.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773, `_SYSTEM`, HSCUSTOM). Writes
 * only the namespaces and databases `EXECMCPTMP404Q` and `EXECMCPTMP404R`, a temporary directory and the HSCUSTOM class
 * `ExecuteMCPv2.Temp.Story391Fixture`.
 *
 * Placement (rule #45): `@iris-mcp/all` spawns built dists. A missing or stale `shared`, dev, admin or interop dist, an unresolvable SDK or
 * an unreachable IRIS skips each test with the reason, or fails with "may not be skipped" when `IRIS_REQUIRE_LIVE` is armed.
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
  docFixtures,
  fixtureDocumentNames,
  governanceDenial,
  governanceReport,
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-4-qa-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The scratch namespace that holds the `Story404Q` classes and the test runs, and a second, empty one. */
const NS = "EXECMCPTMP404Q";
const NS_OTHER = "EXECMCPTMP404R";
/** A fixture-shaped name that is never created: reading a result table through it fails inside IRIS. */
const NS_MISSING = "EXECMCPTMP404Z";
const NAMESPACES = [NS, NS_OTHER];

/** The operator enables the coverage tool and the companion's export and cancel; nothing else is enabled. */
const ENABLED_GOVERNANCE = JSON.stringify({
  global: { iris_test_coverage: true, "iris_test_status:export": true, "iris_test_status:cancel": true },
});

/** The route below the web port, for raw HTTP. */
const COVERAGE_ROUTE = "/api/executemcp/v2/dev/test/coverage";

const DEPLOY_PROMPT = "deploy-and-test-class";
const INVALID_PARAMS = -32602;

/** The routines of the session a coverage row of this gate may leave behind, and the fixture's foreign session. */
const SUITE_ROUTINE_SETS = ["Story404Q.Mix.1,Story404Q.Pct.1,Story404Q.PctDoc.1,Story404Q.Doc.1,Story404Q.Redo.1"];
const FOREIGN_ROUTINES = "ExecuteMCPv2.Temp.Story391Fixture.1";

const QA_CLASSES = ["Story404Q.Mix", "Story404Q.Pct", "Story404Q.PctDoc", "Story404Q.Doc", "Story404Q.Redo"];

// -- The fixture classes (canonical layout: IRIS stores it unchanged, so the class lines below are those of the stored documents) ------

const MIX_SOURCE = `/// Synthetic QA fixture: initializing and non-initializing #dim lines mixed in methods (Story 40.4 QA).
Class Story404Q.Mix
{

ClassMethod Alternating() As %Integer
{
    #dim tA As %Integer
    #dim tB As %Integer = 1
    #dim tC As %Integer
    #dim tD As %Integer = 2
    Set tE = tB + tD
    #dim tF As %Integer
    Quit tE
}

ClassMethod InitWithComment() As %Integer
{
    #dim tG As %Integer = 3 // initializes tG
    Quit tG
}

ClassMethod CommentMid() As %Integer
{
    Set tH = 4
    #dim tI As %Integer // sets nothing = 5
    Quit tH
}

ClassMethod CommentLead() As %Integer
{
    #dim tJ As %Integer // sets nothing = 6
    Set tK = 7
    Quit tK
}

ClassMethod CommentAfterFour() As %Integer
{
    #dim t1 As %Integer
    #dim t2 As %Integer
    #dim t3 As %Integer
    #dim t4 As %Integer
    #dim t5 As %Integer // sets nothing = 8
    Set tL = 9
    Quit tL
}

ClassMethod SemicolonMid() As %Integer
{
    Set tM = 12
    #dim tN As %Integer ; sets nothing = 13
    Quit tM
}

ClassMethod ControlAfterFour() As %Integer
{
    #dim t1 As %Integer
    #dim t2 As %Integer
    #dim t3 As %Integer
    #dim t4 As %Integer
    #dim t5 As %Integer // sets nothing
    Set tP = 14
    Quit tP
}

}
`;

const PCT_SOURCE = `/// Synthetic QA fixture: methods whose names begin with a percent sign (Story 40.4 QA).
Class Story404Q.Pct
{

ClassMethod %Cm() As %Integer
{
    #dim tA As %Integer = 4
    Set tB = tA + 1
    Quit tB
}

ClassMethod Plain() As %Integer
{
    Set tC = 2
    Quit tC
}

ClassMethod %LeadPlain() As %Integer
{
    #dim tQ As %Integer
    Set tR = 15
    Quit tR
}

ClassMethod %LeadEq() As %Integer
{
    #dim tS As %Integer // sets nothing = 16
    Set tT = 17
    Quit tT
}

}
`;

const PCTDOC_SOURCE = `/// Synthetic QA fixture: only a method named with a percent sign (Story 40.4 QA).
Class Story404Q.PctDoc
{

ClassMethod %Cm() As %Integer
{
    Set tA = 6
    Quit tA
}

}
`;

/** `Story404Q.Doc` and `Story404Q.Redo`: the same class; `edited` adds the one documentation line above the first method. */
function documentedSource(name: string, edited: boolean): string {
  return `/// Synthetic QA fixture: a class saved with a comment-only edit after its compile (Story 40.4 QA).
Class ${name}
{

${edited ? "/// What One returns.\n" : ""}ClassMethod One() As %Integer
{
    #dim tA As %Integer = 1
    Quit tA
}

ClassMethod Two() As %Integer
{
    Set tB = 2
    Quit tB
}

}
`;
}

const TEST_SOURCE = `/// Synthetic QA fixture: calls every method of the QA classes (Story 40.4 QA).
Class Story404Q.FixtureTest Extends %UnitTest.TestCase
{

Method TestEveryMethod()
{
    Do $$$AssertEquals(##class(Story404Q.Mix).Alternating(), 3, "Alternating")
    Do $$$AssertEquals(##class(Story404Q.Mix).InitWithComment(), 3, "InitWithComment")
    Do $$$AssertEquals(##class(Story404Q.Mix).CommentMid(), 4, "CommentMid")
    Do $$$AssertEquals(##class(Story404Q.Mix).CommentLead(), 7, "CommentLead")
    Do $$$AssertEquals(##class(Story404Q.Mix).CommentAfterFour(), 9, "CommentAfterFour")
    Do $$$AssertEquals(##class(Story404Q.Mix).SemicolonMid(), 12, "SemicolonMid")
    Do $$$AssertEquals(##class(Story404Q.Mix).ControlAfterFour(), 14, "ControlAfterFour")
    Do $$$AssertEquals(##class(Story404Q.Pct).%Cm(), 5, "Pct %Cm")
    Do $$$AssertEquals(##class(Story404Q.Pct).Plain(), 2, "Pct Plain")
    Do $$$AssertEquals(##class(Story404Q.Pct).%LeadPlain(), 15, "Pct %LeadPlain")
    Do $$$AssertEquals(##class(Story404Q.Pct).%LeadEq(), 17, "Pct %LeadEq")
    Do $$$AssertEquals(##class(Story404Q.PctDoc).%Cm(), 6, "PctDoc %Cm")
    Do $$$AssertEquals(##class(Story404Q.Doc).One(), 1, "Doc One")
    Do $$$AssertEquals(##class(Story404Q.Doc).Two(), 2, "Doc Two")
    Do $$$AssertEquals(##class(Story404Q.Redo).One(), 1, "Redo One")
    Do $$$AssertEquals(##class(Story404Q.Redo).Two(), 2, "Redo Two")
}

}
`;

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let plain: WireSession;
let admin: WireSession;
let tempDir = "";

const { monitorState, coverageGlobal, runCounter, expectMonitorIdle, releaseLeftoverSession } = monitorGate({
  dev: () => dev,
  suiteRoutineSets: [...SUITE_ROUTINE_SETS, FOREIGN_ROUTINES],
});

function wireOptions(pkg: string): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: distEntry(REPO_ROOT, pkg), target: TARGET, clientName: GATE_TAG };
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

interface CoverageContent {
  status: string;
  coverageRunId: number;
  runIndex: number | null;
  cobertura?: { outputPath: string; bytes: number; classes: number; lines: number };
  coverage?: {
    complete: boolean;
    classes: Array<{ class: string; source?: ClassSourceContent }>;
    unmeasured: Array<{ class: string; reason: string }>;
    source?: { executableLines: number; coveredLines: number; percent: number | null };
    verdict?: {
      minCoverage: number;
      overall: string;
      percent: number | null;
      classes: Array<{ class: string; verdict: string; percent: number | null; reason?: string }>;
    };
  };
}

interface RawMethod {
  name: string;
  line: number | null;
  routine?: string;
  reason?: string;
  intLines?: number[];
  labelLine?: number;
}

interface RawSource {
  class: string;
  reason?: string;
  lineMap?: number;
  methods: RawMethod[];
}

/** The result of `iris_execute_tests` and of a `iris_test_status` poll or cancel. */
interface TestRunContent {
  status?: string;
  total?: number;
  passed?: number;
  jobId?: string;
  runIndex?: number | null;
  runIndexSource?: string | null;
  error?: string;
}

// -- Calling the tools ----------------------------------------------------------------

/** The structured content of a tool call that must not be an error. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

/** The structured content of a tool call that must be an error with an envelope. */
function failedWithEnvelope<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBe(true);
  expect(result.structuredContent, "an error envelope in structuredContent").toBeDefined();
  return result.structuredContent as unknown as T;
}

/** `iris_test_status` on the dev session, exactly as given (a poll by the handles alone carries no `server` argument). */
function companion(args: Record<string, unknown>): Promise<WireToolResult> {
  return dev.raw("iris_test_status", args);
}

/** The result of a call that may have returned `running`: polled by its `coverageRunId` until it completes. */
async function settled(result: WireToolResult): Promise<{ result: WireToolResult; content: CoverageContent }> {
  let current = result;
  let content = succeeded<CoverageContent>(current);
  const deadline = Date.now() + 120000;
  while (content.status === "running" && Date.now() < deadline) {
    await sleep(500);
    current = await companion({ action: "poll", coverageRunId: String(content.coverageRunId) });
    content = succeeded<CoverageContent>(current);
  }
  expect(content.status, "the run completed").toBe("completed");
  return { result: current, content };
}

/** `iris_test_coverage` over the five QA classes with `minCoverage` 50 and `overrides`. */
function qaRun(overrides: Record<string, unknown> = {}): Promise<{ result: WireToolResult; content: CoverageContent }> {
  return dev
    .call("iris_test_coverage", {
      target: "Story404Q.FixtureTest",
      level: "class",
      classes: QA_CLASSES,
      minCoverage: 50,
      namespace: NS,
      ...overrides,
    })
    .then(settled);
}

/** `iris_execute_tests` over the QA test class: a completed run (one test method) and its handles. */
async function runTests(): Promise<{ jobId: string; runIndex: number }> {
  const content = succeeded<TestRunContent>(
    await dev.call("iris_execute_tests", { target: "Story404Q.FixtureTest", level: "class", namespace: NS }),
  );
  expect(content).toMatchObject({ status: "completed", total: 1, passed: 1 });
  expect(typeof content.jobId, "the run reports its Atelier work-queue id").toBe("string");
  expect(typeof content.runIndex, "and its result-table index").toBe("number");
  return { jobId: content.jobId as string, runIndex: content.runIndex as number };
}

/** The raw class-source record of one class of a run, from the Status route. */
async function rawSource(coverageRunId: number, className: string): Promise<RawSource> {
  const answer = await rawIrisRequest(TARGET, `${COVERAGE_ROUTE}?id=${coverageRunId}`, { method: "GET" });
  const sources = ((answer.json as { result?: { sources?: RawSource[] } } | undefined)?.result?.sources ?? []) as RawSource[];
  const found = sources.find((entry) => entry.class === className);
  expect(found, `the raw Status record of run ${coverageRunId} has a class-source entry for ${className}`).toBeDefined();
  return found as RawSource;
}

/** The class source of one class of a coverage result. */
function sourceOf(content: CoverageContent, className: string): ClassSourceContent {
  const entry = content.coverage?.classes.find((candidate) => candidate.class === className);
  expect(entry?.source, `${className} has a class-source result`).toBeDefined();
  return entry?.source as ClassSourceContent;
}

/** The method of a raw class-source record. */
function rawMethod(source: RawSource, name: string): RawMethod {
  const found = source.methods.find((method) => method.name === name);
  expect(found, `${source.class} has the method ${name}`).toBeDefined();
  return found as RawMethod;
}

/** The line numbers of a list of ranges. */
function linesOf(ranges: Range[]): number[] {
  return ranges.flatMap(([start, end]) => Array.from({ length: end - start + 1 }, (_, index) => start + index));
}

/** The lines of a stored class document, read by raw Atelier `GET /doc`; line n is element n - 1. */
async function storedLines(documentName: string): Promise<string[]> {
  return (await atelierDocument(oracleTarget(), documentName)).content;
}

/**
 * The class lines that execute, by a rule that reads only the stored class text: inside a method body, a `Set` or `Quit` line, and a
 * `#dim` line whose code (the text before a trailing `//` or `;` comment) holds an `=`. Every other line (a blank, a brace, a `#dim`
 * that initializes nothing) is not a statement.
 */
function statementLines(stored: string[]): number[] {
  const found: number[] = [];
  let state: "outside" | "declared" | "body" = "outside";
  stored.forEach((text, index) => {
    if (state === "outside") {
      if (/^ClassMethod\s/.test(text)) state = "declared";
    } else if (state === "declared") {
      if (text === "{") state = "body";
    } else if (text === "}") {
      state = "outside";
    } else {
      const trimmed = text.trim();
      const dim = /^#dim\s(.*)$/i.exec(trimmed);
      const code = dim ? (dim[1] as string).split(/\s\/\/|\s;/)[0] : undefined;
      if (/^(?:Set|Quit)\s/.test(trimmed) || (code !== undefined && code.includes("="))) found.push(index + 1);
    }
  });
  return found;
}

/** A path below the gate's own temporary directory. */
function tempPath(...segments: string[]): string {
  return path.join(tempDir, ...segments);
}

type XmlNode = { name: string; attributes: Record<string, string>; children: XmlNode[] };

/** The names of the class elements of a Cobertura document, in document order. */
function coberturaClassNames(xml: string): string[] {
  const names: string[] = [];
  const walk = (node: XmlNode): void => {
    if (node.name === "class") names.push(node.attributes["name"] as string);
    else node.children.forEach(walk);
  };
  walk(parseXml(xml).root as XmlNode);
  return names;
}

/** The numbered steps of a rendered prompt, by number: the text from `N. ` up to the next step. */
function stepsOf(text: string): Map<number, string> {
  const steps = new Map<number, string>();
  for (const chunk of text.split(/\n(?=\d+\. )/)) {
    const match = /^(\d+)\. /.exec(chunk);
    if (match) steps.set(Number(match[1]), chunk);
  }
  return steps;
}

/** The text of the one user message a `prompts/get` answers. */
function promptText(rendered: { messages: Array<{ role: string; content: { type: string; text?: string } }> }): string {
  expect(rendered.messages).toHaveLength(1);
  const message = rendered.messages[0] as (typeof rendered.messages)[number];
  expect(message.role).toBe("user");
  expect(message.content.type).toBe("text");
  return message.content.text ?? "";
}

/** The rejection of a `prompts/get`, or `undefined` when it rendered. */
async function promptRejection(
  session: WireSession,
  request: Parameters<WireSession["getPrompt"]>[0],
): Promise<{ code?: number; message?: string } | undefined> {
  return session.getPrompt(request).then(
    () => undefined,
    (error: unknown) => error as { code?: number; message?: string },
  );
}

/** The `iris_*` tool names a rendered prompt mentions. */
function toolTokens(text: string): string[] {
  return [...new Set(text.match(/\biris_[a-z][a-z0-9_]*/g) ?? [])].sort();
}

// -- The fixture ------------------------------------------------------------------------

/** Put and compile the QA classes, then save the three documented ones again with a comment-only edit. */
async function seedQaFixture(): Promise<void> {
  const docs = docFixtures(dev, NS);
  const documents: Array<[string, string]> = [
    ["Story404Q.Mix.cls", MIX_SOURCE],
    ["Story404Q.Pct.cls", PCT_SOURCE],
    ["Story404Q.PctDoc.cls", PCTDOC_SOURCE],
    ["Story404Q.Doc.cls", documentedSource("Story404Q.Doc", false)],
    ["Story404Q.Redo.cls", documentedSource("Story404Q.Redo", false)],
    ["Story404Q.FixtureTest.cls", TEST_SOURCE],
  ];
  for (const [name, source] of documents) {
    await docs.putDoc(name, source);
    await docs.compileDoc(name);
  }
  // The comment-only edits: saved over the compiled class (no delete first), then compiled. `Doc` and `PctDoc` take the default
  // compile, which skips a class IRIS calls up to date; `Redo` takes a forced compile (flags `ck`), which rebuilds its line map.
  const edits: Array<[string, string, string | undefined]> = [
    ["Story404Q.Doc.cls", documentedSource("Story404Q.Doc", true), undefined],
    ["Story404Q.Redo.cls", documentedSource("Story404Q.Redo", true), "ck"],
    ["Story404Q.PctDoc.cls", PCTDOC_SOURCE.replace("ClassMethod %Cm", "/// A helper.\nClassMethod %Cm"), undefined],
  ];
  for (const [name, source, flags] of edits) {
    const saved = await dev.call("iris_doc_put", { namespace: NS, name, content: source });
    expect(saved.isError, allText(saved)).toBeFalsy();
    const compiled = await dev.call("iris_doc_compile", { namespace: NS, doc: name, ...(flags ? { flags } : {}) });
    expect(compiled.isError, allText(compiled)).toBeFalsy();
  }
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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.4 QA live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  dev = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_GOVERNANCE: ENABLED_GOVERNANCE });
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  plain = await openWireSession(wireOptions("iris-dev-mcp"));
  await putFixtureClass(dev);

  // Every row starts with the monitor idle. A session this gate did not start is named and left alone.
  const initial = await monitorState();
  if (initial.active !== 0) {
    const named = `a Line-by-Line or PERFMON session this gate did not start is active (process list "${initial.pids}", ${initial.count} routine(s): ${JSON.stringify(initial.routines)}); it was left untouched`;
    await plain.close();
    await admin.close();
    await removeFixtureClass(dev);
    await dev.close();
    // Set before the armed throw too, so afterAll sees closed sessions and nothing to remove.
    skipReason = named;
    if (REQUIRE_LIVE) throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.4 QA live gate may not be skipped: ${named}`);
    return;
  }

  tempDir = mkdtempSync(path.join(tmpdir(), "story-40-4-qa-"));
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, [...NAMESPACES, NS_MISSING]), "no fixture namespace before the run").toEqual([]);
  for (const name of NAMESPACES) await createInteropNamespace(admin, dev, name, { interop: false });
  await seedQaFixture();

  // A positive control: the same check that must read empty after the run sees both namespaces now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees the namespaces while they exist").toEqual(
    expect.arrayContaining([`namespace ${NS}`, `database configuration ${NS}`, `namespace ${NS_OTHER}`, `database configuration ${NS_OTHER}`]),
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
    await attempt("stopping a coverage session left behind", releaseLeftoverSession);
    await attempt("the monitor is idle", async () => {
      expect((await monitorState()).active, "the monitor is idle after the run").toBe(0);
    });
    await attempt("no coverage ownership node is left", async () => {
      expect((await coverageGlobal('"session"')).defined, "no suite session node after the run").toBe(false);
    });
    for (const name of NAMESPACES) await attempt(`removing ${name}`, () => removeInteropNamespace(admin, dev, name));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, [...NAMESPACES, NS_MISSING]), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the temporary directory", async () => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
      expect(tempDir !== "" && existsSync(tempDir), "the temporary directory is gone").toBe(false);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story391Fixture", "Story404Q"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [plain, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- Row A: the deploy-and-test-class prompt over stdio -------------------------------------

describe("Story 40.4 QA: deploy-and-test-class through the built dev server over stdio (rule #46)", () => {
  it("A1: prompts/get without `arguments` is a clean InvalidParams naming the prompt, an empty `arguments` is too, and the connection stays usable", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const omitted = await promptRejection(plain, { name: DEPLOY_PROMPT });
    expect(omitted, "the request without arguments was refused").toBeDefined();
    expect(omitted?.code).toBe(INVALID_PARAMS);
    expect(omitted?.message).toContain(DEPLOY_PROMPT);

    const empty = await promptRejection(plain, { name: DEPLOY_PROMPT, arguments: {} });
    expect(empty?.code, "an empty arguments object lacks the required argument").toBe(INVALID_PARAMS);
    expect(empty?.message).toContain("classOrPackage");

    const stillUsable = promptText(await plain.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders" } }));
    expect(stillUsable).toContain("Target: `MyApp.Orders`");
  }, 60000);

  it("A2: the required argument alone renders one user message of nine steps in order, and an unknown extra argument changes nothing", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const listed = (await plain.listPrompts()).find((prompt) => prompt.name === DEPLOY_PROMPT);
    expect(listed?.title).toBe("Deploy And Test Class");
    expect(listed?.arguments?.map((argument) => [argument.name, argument.required === true]), "the one required argument").toEqual([
      ["classOrPackage", true],
    ]);

    const text = promptText(await plain.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders.Tests" } }));
    expect(text).toContain("Target: `MyApp.Orders.Tests`");
    expect(text, "a dotted name becomes the path form of the glob").toContain("`c:/path/to/src/**/MyApp/Orders/Tests*.cls`");
    const steps = stepsOf(text);
    expect([...steps.keys()], "nine steps, numbered in order").toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(steps.get(8), "step 8 is the optional coverage step").toMatch(/^8\. Optional \u2014 line coverage, only when the user asks/);
    expect(steps.get(9), "the report step follows it and mentions the coverage").toMatch(/^9\. Report .*and the coverage, when it was measured\.$/);
    expect(steps.get(4), "step 4 carries the PRODUCTION_BUSY sentence").toContain("If the response is a `PRODUCTION_BUSY` refusal, nothing ran");
    expect(text, "no unresolved placeholder").not.toMatch(/<classOrPackage>|undefined/);

    const extra = promptText(
      await plain.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders.Tests", unknownArgument: "ignored" } }),
    );
    expect(extra, "an argument the prompt does not declare is ignored").toBe(text);
  }, 60000);

  it("A3: step 8 names only tools, arguments, refusals and a governance recipe that exist (tools/list schemas, the refusal shape, the policy)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const text = promptText(await plain.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders.Tests" } }));
    const step8 = stepsOf(text).get(8) as string;
    const tools = new Map((await plain.listTools()).map((tool): [string, WireTool] => [tool.name, tool]));

    for (const token of toolTokens(text)) expect(tools.has(token), `${token} is a real tool on tools/list`).toBe(true);
    expect(toolTokens(step8), "step 8 names exactly these three tools").toEqual(["iris_doc_compile", "iris_test_coverage", "iris_test_status"]);
    // The forced compile step 8 gives for a class a documentation-only edit left not-up-to-date passes a real argument.
    const compileProps = (tools.get("iris_doc_compile") as WireTool).inputSchema.properties ?? {};
    expect("flags" in compileProps, "iris_doc_compile takes flags").toBe(true);
    expect(step8).toContain('call `iris_doc_compile` on it with `flags: "ck"`');

    // The arguments step 8 tells the model to pass are real, and `classes` takes at most the 50 it says.
    const coverageProps = (tools.get("iris_test_coverage") as WireTool).inputSchema.properties ?? {};
    for (const argument of ["target", "level", "classes", "minCoverage"]) {
      expect(argument in coverageProps, `iris_test_coverage takes ${argument}`).toBe(true);
      expect(step8, `step 8 names ${argument}`).toContain(`\`${argument}\``);
    }
    expect((coverageProps["classes"] as { maxItems?: number }).maxItems, "step 8 says at most 50").toBe(50);
    expect(step8).toContain("at most 50");
    const statusProps = (tools.get("iris_test_status") as WireTool).inputSchema.properties ?? {};
    for (const argument of ["action", "coverageRunId", "outputPath"]) {
      expect(argument in statusProps, `iris_test_status takes ${argument}`).toBe(true);
      expect(step8, `step 8 names ${argument}`).toContain(argument);
    }
    expect((statusProps["action"] as { enum?: string[] }).enum, "poll and export are actions").toEqual(expect.arrayContaining(["poll", "export"]));

    // The refusals step 8 copes with carry the code and the action name it uses; the keys are real and disabled by default.
    for (const marker of [
      "refused with `GOVERNANCE_DISABLED`",
      "refused with `MONITOR_BUSY`",
      "refused with `PRODUCTION_BUSY`",
      '`status: "running"`',
      "do NOT re-submit",
      "`iris_test_status:export`",
    ]) {
      expect(step8, `step 8 names ${marker}`).toContain(marker);
    }
    const policy = (await governanceReport(plain)).policy;
    expect(policy["iris_test_coverage"], "the key step 8 names is disabled by default").toBe(false);
    expect(policy["iris_test_status:export"], "so is the export key").toBe(false);

    // The recipe step 8 gives is exactly what enables the tool, and only it.
    const recipe = /for example `(\{"global":\{"iris_test_coverage":true\}\})`/.exec(step8)?.[1];
    expect(recipe, "step 8 gives the recipe").toBeDefined();
    const armed = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_GOVERNANCE: recipe as string });
    try {
      const enabled = (await governanceReport(armed)).policy;
      expect(enabled["iris_test_coverage"], "the recipe enables the coverage tool").toBe(true);
      expect(enabled["iris_test_status:export"], "and not the export").toBe(false);
      expect(enabled["iris_test_status:cancel"], "and not the cancel").toBe(false);
    } finally {
      await armed.close();
    }
  }, 120000);

  it("A4: step 8's claim that the tool is hidden outside the developer and full presets is what the real presets list", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const step8 = stepsOf(promptText(await plain.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders.Tests" } }))).get(8) as string;
    expect(step8).toContain("it is outside `core`");
    expect(step8).toContain("needs the `developer` or full preset (`IRIS_TOOLS_PRESET`)");
    for (const [preset, visible] of [["core", false], ["developer", true], ["full", true]] as const) {
      const session = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_TOOLS_PRESET: preset });
      try {
        const names = new Set((await session.listTools()).map((tool) => tool.name));
        expect(names.has("iris_test_coverage"), `${preset}: iris_test_coverage is ${visible ? "listed" : "hidden"}`).toBe(visible);
        expect(names.has("iris_test_status"), `${preset}: so is its companion, which the poll of step 8 needs`).toBe(visible);
        for (const token of toolTokens(stepsOf(promptText(await session.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "MyApp.Orders" } }))).get(2) as string)) {
          expect(names.has(token), `${preset}: ${token} of step 2 is listed`).toBe(true);
        }
      } finally {
        await session.close();
      }
    }
  }, 120000);

  it("A5: skills/deploy-and-test-class/SKILL.md is the render of the prompt and its description is the listed one", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const skill = readFileSync(path.join(REPO_ROOT, "skills", DEPLOY_PROMPT, "SKILL.md"), "utf8");
    const parts = /^---\n([\s\S]*?)\n---\n+([\s\S]*)$/.exec(skill);
    expect(parts, "the skill has frontmatter and a body").not.toBeNull();
    const frontmatter = parts?.[1] ?? "";
    expect(/^name: (.+)$/m.exec(frontmatter)?.[1]).toBe(DEPLOY_PROMPT);
    const description = /^description: (".*")$/m.exec(frontmatter)?.[1];
    expect(description, "a quoted description").toBeDefined();

    const listed = (await plain.listPrompts()).find((prompt) => prompt.name === DEPLOY_PROMPT) as { description?: string } | undefined;
    expect(JSON.parse(description as string), "the skill description is the description the wire lists").toBe(listed?.description);
    expect(listed?.description).toContain("(iris_test_coverage)");

    const rendered = promptText(await plain.getPrompt({ name: DEPLOY_PROMPT, arguments: { classOrPackage: "<classOrPackage>" } }));
    expect((parts?.[2] ?? "").trimEnd(), "the skill body is the rendered prompt, placeholder included").toBe(rendered.trimEnd());
  }, 60000);
});

// -- Row B: the annotations and the defaults as a client reads them ------------------------------

describe("Story 40.4 QA: the corrected annotations and the stated defaults through the built dev server (row B)", () => {
  const HINTS_OF_A_WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  const HINTS_OF_A_STOPPING_TOOL = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };

  it("B1: tools/list declares iris_execute_tests with the hints of a write under full, core and developer, and the coverage pair only where the presets show it", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const [preset, count, pair] of [["full", 33, true], ["core", 15, false], ["developer", 33, true]] as const) {
      const session = await openWireSession(wireOptions("iris-dev-mcp"), { IRIS_TOOLS_PRESET: preset });
      try {
        const tools = await session.listTools();
        const byName = new Map(tools.map((tool): [string, WireTool] => [tool.name, tool]));
        expect(byName.get("iris_execute_tests")?.annotations, `${preset}: the hints of a write, not read-only and not idempotent`).toEqual(HINTS_OF_A_WRITE);
        expect(tools.length, `${preset}: no tool or preset row was added`).toBe(count);
        expect(byName.get("iris_test_coverage")?.annotations, `${preset}: the coverage tool`).toEqual(pair ? HINTS_OF_A_STOPPING_TOOL : undefined);
        expect(byName.get("iris_test_status")?.annotations, `${preset}: its companion`).toEqual(pair ? HINTS_OF_A_STOPPING_TOOL : undefined);
        for (const tool of tools) {
          if (tool.annotations?.["readOnlyHint"] !== true) continue;
          expect(["iris_execute_tests", "iris_test_status", "iris_test_coverage"], `${preset}: ${tool.name} declares readOnlyHint`).not.toContain(tool.name);
        }
      } finally {
        await session.close();
      }
    }
  }, 120000);

  it("B2: under the default governance iris_execute_tests and the poll are enabled; the coverage tool, the cancel and the export are refused with nothing written and no run id allocated", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const policy = (await governanceReport(plain)).policy;
    expect(policy["iris_execute_tests"], "classified a write, enabled by default").toBe(true);
    expect(policy["iris_test_status:poll"], "the poll is a read").toBe(true);
    expect(policy["iris_test_coverage"], "the coverage tool is a write, disabled by default").toBe(false);
    expect(policy["iris_test_status:cancel"], "the cancel is a write, disabled by default").toBe(false);
    expect(policy["iris_test_status:export"], "the export is a write, disabled by default").toBe(false);

    const counter = await runCounter();
    const refusedCoverage = await plain.call("iris_test_coverage", {
      target: "Story404Q.FixtureTest",
      level: "class",
      classes: ["Story404Q.Mix"],
      namespace: NS,
    });
    expect(refusedCoverage.isError, allText(refusedCoverage)).toBe(true);
    expect(refusedCoverage.structuredContent).toEqual(governanceDenial("iris_test_coverage"));

    const target = tempPath("never", "export.xml");
    const refusedExport = await plain.call("iris_test_status", { action: "export", coverageRunId: "1", outputPath: target, namespace: NS });
    expect(refusedExport.structuredContent).toEqual(governanceDenial("iris_test_status:export"));
    expect(existsSync(path.dirname(target)), "nothing was written, not even the parent directory").toBe(false);

    const refusedCancel = await plain.call("iris_test_status", { action: "cancel", jobId: "1", namespace: NS });
    expect(refusedCancel.structuredContent).toEqual(governanceDenial("iris_test_status:cancel"));

    expect(await runCounter(), "no run id was allocated").toBe(counter);
    await expectMonitorIdle("B2");

    // The enabled side is real: the poll answers under the same default policy, and a test run is not refused.
    const handleOnly = await plain.raw("iris_test_status", { action: "poll", coverageRunId: "99999999" });
    const missing = failedWithEnvelope<{ error?: string; coverageRunId?: number }>(handleOnly);
    expect(missing.coverageRunId).toBe(99999999);
    expect(missing.error).toContain("was not found");
    const ran = succeeded<TestRunContent>(await plain.call("iris_execute_tests", { target: "Story404Q.FixtureTest", level: "class", namespace: NS }));
    expect(ran).toMatchObject({ status: "completed", total: 1, passed: 1 });
  }, 120000);
});

// -- Row C: DW-601 and DW-602 on a fixture the first gates did not use ------------------------------

describe("Story 40.4 QA: the class-source mapping against fixtures the first 40.4 gates did not use (row C, rule #58)", () => {
  it("C1: initializing #dim lines are executable at their own line and non-initializing ones are not, in mixed order, with a trailing // or ; comment, and the two methods that differ only by a comment's = are told apart", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await qaRun();
    const stored = await storedLines("Story404Q.Mix.cls");
    const mix = sourceOf(content, "Story404Q.Mix");

    // The hand-checked expectation, line by line against the stored class text. Reported: the class lines in the second column.
    const at = (line: number): string => (stored[line - 1] ?? "").trim();
    expect(at(8)).toBe("#dim tB As %Integer = 1");
    expect(at(10)).toBe("#dim tD As %Integer = 2");
    expect(at(18)).toBe("#dim tG As %Integer = 3 // initializes tG");
    for (const line of [7, 9, 12, 25, 31, 50]) expect(at(line), `line ${line} is a #dim that initializes nothing`).toMatch(/^#dim \w+ As %Integer( \/\/| ;|$)/);
    expect(mix.executableRanges).toEqual([[8, 8], [10, 11], [13, 13], [18, 19], [24, 24], [26, 26], [32, 33], [43, 44], [49, 49], [51, 51], [61, 62]]);
    expect(mix.coveredRanges, "the test reaches every method").toEqual(mix.executableRanges);
    expect(mix.uncoveredRanges).toEqual([]);
    expect(mix).toMatchObject({ executableLines: 16, coveredLines: 16, percent: 100, generated: { executableLines: 0, coveredLines: 0 } });
    expect(mix.methods.map((method) => [method.method, method.line, method.executableLines])).toEqual([
      ["Alternating", 5, 4],
      ["InitWithComment", 16, 2],
      ["CommentMid", 22, 2],
      ["CommentLead", 29, 2],
      ["CommentAfterFour", 36, 2],
      ["SemicolonMid", 47, 2],
      ["ControlAfterFour", 54, 2],
    ]);

    // Against the independent text rule: the report agrees on every line.
    const reported = linesOf(mix.executableRanges);
    const truth = statementLines(stored);
    expect(truth, "the text rule reads the 16 statements of the class").toHaveLength(16);
    expect(reported, "every reported line is a statement of the text, and every statement is reported").toEqual(truth);

    // The control: the same five leading #dim lines with a comment that holds no `=` map exactly.
    expect(linesOf(mix.executableRanges).filter((line) => line >= 54)).toEqual([61, 62]);
    expect(at(61)).toBe("Set tP = 14");
    expect(at(62)).toBe("Quit tP");
    const raw = await rawSource(content.coverageRunId, "Story404Q.Mix");
    expect(raw.lineMap, "a fresh class has its line map").toBe(10);
    const intText = (await storedLines("Story404Q.Mix.1.int"));
    // INT line n of the Status record is element n of the Atelier INT document (element 0 is its ROUTINE header).
    const alternating = rawMethod(raw, "Alternating");
    expect(alternating.intLines, "#dim tA/tC/tF map to nothing; tB, tD, Set and Quit map to their own INT lines").toEqual([0, 6, 0, 7, 8, 0, 9]);
    expect((alternating.intLines ?? []).map((intLine) => (intLine > 0 ? (intText[intLine] ?? "").trim() : ""))).toEqual([
      "",
      "Set tB=1",
      "",
      "Set tD=2",
      "Set tE = tB + tD",
      "",
      "Quit tE }",
    ]);
    expect(rawMethod(raw, "ControlAfterFour").intLines).toEqual([0, 0, 0, 0, 0, 20, 21]);
    await expectMonitorIdle("C1");
  }, 240000);

  it("C2: a #dim that initializes nothing but has a trailing comment holding = keeps no INT line, although the compiler maps it onto a statement of the method, so the statements keep their own lines", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await qaRun();
    const stored = await storedLines("Story404Q.Mix.cls");
    const intText = await storedLines("Story404Q.Mix.1.int");
    const mix = sourceOf(content, "Story404Q.Mix");
    const raw = await rawSource(content.coverageRunId, "Story404Q.Mix");
    const at = (line: number): string => (stored[line - 1] ?? "").trim();

    // The class text: line 42 is the fifth leading #dim and its comment holds `= 8`; the statements are lines 43 and 44.
    expect(at(42)).toBe("#dim t5 As %Integer // sets nothing = 8");
    expect(at(43)).toBe("Set tL = 9");
    expect(at(44)).toBe("Quit tL");
    // The compiler maps the fifth #dim onto the INT line of `Quit tL` (12); the map gives the directive none, so `Set` and `Quit` keep 11 and 12.
    const method = rawMethod(raw, "CommentAfterFour");
    expect(method.intLines).toEqual([0, 0, 0, 0, 0, 11, 12]);
    expect((intText[12] ?? "").trim()).toBe("Quit tL }");
    expect((intText[11] ?? "").trim()).toBe("Set tL = 9");
    // So the executable lines are the text's [43, 44].
    expect(linesOf(mix.executableRanges).filter((line) => line >= 36 && line < 47)).toEqual([43, 44]);
    expect(mix.methods.find((entry) => entry.method === "CommentAfterFour")).toMatchObject({ executableLines: 2, coveredLines: 2 });

    // A comment that holds an `=` makes no directive line a statement, mid-body or leading, after a // or a ;.
    expect(rawMethod(raw, "CommentMid").intLines?.[1], "a mid-body directive maps to nothing").toBe(0);
    expect(rawMethod(raw, "SemicolonMid").intLines?.[1], "so does one with a ; comment").toBe(0);
    expect(rawMethod(raw, "CommentLead").intLines?.[0], "and a leading one").toBe(0);
    await expectMonitorIdle("C2");
  }, 240000);

  it("C3: a method whose name begins with % has its label line (the INT label is its name), its lines map, and a leading directive whose comment holds = is not reported", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await qaRun();
    const stored = await storedLines("Story404Q.Pct.cls");
    const intText = await storedLines("Story404Q.Pct.1.int");
    const pct = sourceOf(content, "Story404Q.Pct");
    const raw = await rawSource(content.coverageRunId, "Story404Q.Pct");
    const at = (line: number): string => (stored[line - 1] ?? "").trim();

    expect(raw.lineMap).toBe(10);
    // The INT routine holds each method's label at the line the map reports (the oracle is the INT text, not the code under test).
    for (const [name, labelLine] of [["%Cm", 5], ["%LeadEq", 9], ["%LeadPlain", 12], ["Plain", 15]] as const) {
      expect(rawMethod(raw, name).labelLine, `${name}: its label line`).toBe(labelLine);
      expect((intText[labelLine] ?? "").split("(")[0], `INT line ${labelLine} is the label ${name}`).toBe(name);
    }
    expect(pct.methods.map((method) => [method.method, method.line, method.executableLines])).toEqual([
      ["%Cm", 5, 3],
      ["Plain", 12, 2],
      ["%LeadPlain", 18, 2],
      ["%LeadEq", 25, 2],
    ]);
    expect(pct.coveredRanges, "every reported line ran").toEqual(pct.executableRanges);

    // %Cm: the initializing #dim and its two statements map to their own INT lines (hand-checked against the INT text).
    expect(at(7)).toBe("#dim tA As %Integer = 4");
    expect(rawMethod(raw, "%Cm").intLines).toEqual([6, 7, 8]);
    expect((intText[6] ?? "").trim()).toBe("Set tA=4");
    expect((intText[7] ?? "").trim()).toBe("Set tB = tA + 1");
    expect((intText[8] ?? "").trim()).toBe("Quit tB }");
    // %LeadPlain: a leading #dim that initializes nothing is not reported.
    expect(at(20)).toBe("#dim tQ As %Integer");
    expect(linesOf(pct.executableRanges)).not.toContain(20);
    expect(rawMethod(raw, "%LeadPlain").intLines).toEqual([0, 13, 14]);
    // %LeadEq: the compiler maps the leading directive with `= 16` in its comment onto %Cm's `Set tB = tA + 1`; the map gives it no INT line.
    expect(at(27)).toBe("#dim tS As %Integer // sets nothing = 16");
    expect(rawMethod(raw, "%LeadEq").intLines).toEqual([0, 10, 11]);
    expect(pct.executableRanges).toEqual([[7, 9], [14, 15], [21, 22], [28, 29]]);
    expect(statementLines(stored), "the text says the statements are lines 28 and 29").toEqual([7, 8, 9, 14, 15, 21, 22, 28, 29]);
    expect(linesOf(pct.executableRanges), "and the report says the same").toEqual(statementLines(stored));
    await expectMonitorIdle("C3");
  }, 240000);

  it("C4: a class saved with a comment-only edit and compiled by default is not-up-to-date (lineMap 0, label lines kept) and fails the verdict without a tool error; the forced compile of the same edit is measured at the edited document's lines", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { result, content } = await qaRun();
    expect(result.isError, "a failing verdict is not a tool error").toBeFalsy();

    // The edit is in the stored document, the compiled INT is as it was, and the default compile did not rebuild the line map.
    const docStored = await storedLines("Story404Q.Doc.cls");
    expect(docStored[4], "the comment-only edit sits above the first method").toBe("/// What One returns.");
    expect(docStored[5]).toBe("ClassMethod One() As %Integer");
    const docInt = await storedLines("Story404Q.Doc.1.int");
    expect(docInt[5]?.startsWith("One()")).toBe(true);
    expect(docInt[8]?.startsWith("Two()")).toBe(true);
    expect(sourceOf(content, "Story404Q.Doc")).toEqual({ reason: "not-up-to-date" });
    const rawDoc = await rawSource(content.coverageRunId, "Story404Q.Doc");
    expect(rawDoc.lineMap, "the documentation-only save removed the line map and the default compile skipped the class").toBe(0);
    expect(rawDoc).not.toHaveProperty("reason");
    expect(rawDoc.methods.map((method) => [method.name, method.labelLine, method.intLines])).toEqual([
      ["One", 5, [0, 0]],
      ["Two", 8, [0, 0]],
    ]);

    // The forced compile of the identical edit rebuilt the map: the lines are those of the edited document.
    const redoStored = await storedLines("Story404Q.Redo.cls");
    expect(redoStored[4]).toBe("/// What One returns.");
    const redo = sourceOf(content, "Story404Q.Redo");
    expect(redo).toMatchObject({ executableLines: 4, coveredLines: 4, percent: 100, executableRanges: [[8, 9], [14, 15]], uncoveredRanges: [] });
    expect(statementLines(redoStored), "the text rule reads the same four lines").toEqual([8, 9, 14, 15]);
    const rawRedo = await rawSource(content.coverageRunId, "Story404Q.Redo");
    expect(rawRedo.lineMap).toBe(10);
    expect(rawRedo.methods.map((method) => [method.name, method.labelLine, method.intLines])).toEqual([
      ["One", 5, [6, 7]],
      ["Two", 8, [9, 10]],
    ]);

    expect(content.coverage?.verdict).toEqual({
      minCoverage: 50,
      overall: "fail",
      percent: 100,
      classes: [
        { class: "Story404Q.Mix", verdict: "pass", percent: 100 },
        { class: "Story404Q.Pct", verdict: "pass", percent: 100 },
        { class: "Story404Q.PctDoc", verdict: "fail", percent: null, reason: "not-up-to-date" },
        { class: "Story404Q.Doc", verdict: "fail", percent: null, reason: "not-up-to-date" },
        { class: "Story404Q.Redo", verdict: "pass", percent: 100 },
      ],
    });
    // 29 = Mix 16 + Pct 9 + Redo 4 (the statements the text rule reads in C1 and C3), the two stale classes not included.
    expect(content.coverage?.source, "the stale classes are not part of the total").toEqual({ executableLines: 29, coveredLines: 29, percent: 100 });
    expect(content.coverage?.unmeasured).toEqual([]);
    await expectMonitorIdle("C4");
  }, 240000);

  it("C5: a stale class whose only INT-compiled method is named with % is recognised as stale through its label line, fails the verdict, and is left out of the Cobertura file with the stale ordinary class", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { content } = await qaRun();
    const raw = await rawSource(content.coverageRunId, "Story404Q.PctDoc");
    expect(raw.lineMap, "its line map is gone").toBe(0);
    // The INT text, which the documentation-only save left in place, holds the % method's label at the line the map reports.
    const intText = await storedLines("Story404Q.PctDoc.1.int");
    expect(rawMethod(raw, "%Cm").labelLine, "and the % method keeps the label line that proves it").toBe(5);
    expect((intText[5] ?? "").split("(")[0], "INT line 5 is the label %Cm").toBe("%Cm");
    expect(sourceOf(content, "Story404Q.PctDoc")).toEqual({ reason: "not-up-to-date" });
    expect(content.coverage?.verdict?.classes.find((entry) => entry.class === "Story404Q.PctDoc")).toEqual({
      class: "Story404Q.PctDoc",
      verdict: "fail",
      percent: null,
      reason: "not-up-to-date",
    });
    const stored = await storedLines("Story404Q.PctDoc.cls");
    expect(stored[4], "the class was edited after its compile").toBe("/// A helper.");

    const target = tempPath("c5", "qa.xml");
    const exported = await companion({ action: "export", coverageRunId: String(content.coverageRunId), outputPath: target });
    expect(exported.isError, allText(exported)).toBeFalsy();
    const xml = readFileSync(target, "utf8");
    expect(validateCobertura(xml), "the file is valid against the pinned content model").toEqual([]);
    expect(coberturaClassNames(xml), "both stale classes are left out, so none is written as a class with no lines").toEqual([
      "Story404Q.Mix",
      "Story404Q.Pct",
      "Story404Q.Redo",
    ]);
    // The 29 lines are C4's total.
    expect((exported.structuredContent as unknown as CoverageContent).cobertura).toMatchObject({ classes: 3, lines: 29 });
    await expectMonitorIdle("C5");
  }, 240000);
});

// -- Row D: iris_test_status answers instead of throwing ---------------------------------------------

describe("Story 40.4 QA: iris_test_status error envelopes on paths the unit tests mock (row D)", () => {
  it("D1: a runIndex that does not exist is an error envelope naming its namespace; the same index exists in the namespace that ran the tests and not in the second one", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { runIndex } = await runTests();

    const found = succeeded<TestRunContent>(await companion({ action: "poll", runIndex, namespace: NS }));
    expect(found).toMatchObject({ status: "completed", total: 1, passed: 1, runIndex, runIndexSource: "result-table" });

    const other = failedWithEnvelope<TestRunContent>(await companion({ action: "poll", runIndex, namespace: NS_OTHER }));
    expect(other.error).toBe(`No test run recorded at InstanceIndex ${runIndex} in %UnitTest_Result.TestInstance (namespace ${NS_OTHER}).`);
    const absent = failedWithEnvelope<TestRunContent>(await companion({ action: "poll", runIndex: 999999, namespace: NS }));
    expect(absent.error).toBe(`No test run recorded at InstanceIndex 999999 in %UnitTest_Result.TestInstance (namespace ${NS}).`);
    await expectMonitorIdle("D1");
  }, 120000);

  it("D2: a stale jobId is an error envelope that keeps the handle; with the runIndex it recovers the finished run from the result table; cancel of it is an envelope too", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // The run completed inside iris_execute_tests, which consumed its queue node: its jobId is stale.
    const { jobId, runIndex } = await runTests();

    const alone = failedWithEnvelope<TestRunContent>(await companion({ action: "poll", jobId, namespace: NS }));
    expect(alone).toMatchObject({ jobId });
    expect(alone.error).toContain(`No known run for jobId '${jobId}'`);
    expect(alone.error).toContain("Pass 'runIndex' to check %UnitTest_Result directly.");

    const recovered = succeeded<TestRunContent>(await companion({ action: "poll", jobId, runIndex, namespace: NS }));
    expect(recovered).toMatchObject({ status: "completed", total: 1, passed: 1, jobId, runIndex, runIndexSource: "result-table" });

    const wrongIndex = failedWithEnvelope<TestRunContent>(await companion({ action: "poll", jobId, runIndex: 999999, namespace: NS }));
    expect(wrongIndex).toMatchObject({ jobId });
    expect(wrongIndex.error).toContain("No test run recorded at InstanceIndex 999999");

    const cancelled = failedWithEnvelope<TestRunContent>(await companion({ action: "cancel", jobId, namespace: NS }));
    expect(cancelled).toMatchObject({ jobId });
    expect(cancelled.error).toContain(`jobId '${jobId}' was already gone (HTTP 404)`);
    await expectMonitorIdle("D2");
  }, 120000);

  it("D3: a result table IRIS cannot read (a namespace that does not exist) is an error envelope with the handles and the do-not-re-submit text, by runIndex alone and behind a stale jobId", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    expect(await leftovers(dev, [NS_MISSING]), "the namespace read below does not exist").toEqual([]);
    const { jobId } = await runTests();

    const byIndex = failedWithEnvelope<TestRunContent>(await companion({ action: "poll", runIndex: 1, namespace: NS_MISSING }));
    expect(byIndex.runIndex, "the handle the caller holds").toBe(1);
    expect(byIndex.error).toMatch(/^Reading the result of runIndex 1 from %UnitTest_Result failed: .+\. Poll again with runIndex 1; do NOT re-submit the tests\.$/);
    expect(byIndex.error, "the IRIS text is carried").toContain(`/api/atelier/v8/${NS_MISSING}/action/query`);

    const behindStaleJob = failedWithEnvelope<TestRunContent>(await companion({ action: "poll", jobId, runIndex: 1, namespace: NS_MISSING }));
    expect(behindStaleJob).toMatchObject({ jobId, runIndex: 1, runIndexSource: null });
    expect(behindStaleJob.error).toMatch(
      new RegExp(`^Atelier no longer references jobId '${jobId}', and reading runIndex 1 from %UnitTest_Result failed: .+\\. Do NOT re-submit \\u2014 poll again with runIndex 1\\.$`),
    );
    // The IRIS message ends in a full stop of its own; the text quotes it with one full stop before the advice, never two.
    for (const text of [byIndex.error, behindStaleJob.error]) expect(text, "one full stop between the IRIS message and the advice").not.toContain("..");
    await expectMonitorIdle("D3");
  }, 120000);

  it("D4: a malformed runIndex or jobId is answered with an error result naming the tool and the argument, never a thrown error", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const malformed: Array<[string, Record<string, unknown>, string]> = [
      ["runIndex that is not a number", { runIndex: "abc" }, "runIndex"],
      ["runIndex of zero", { runIndex: 0 }, "runIndex"],
      ["negative runIndex", { runIndex: -1 }, "runIndex"],
      ["fractional runIndex", { runIndex: 1.5 }, "runIndex"],
      ["jobId with letters", { jobId: "12ab" }, "jobId"],
      ["jobId that is a path", { jobId: "../x" }, "jobId"],
    ];
    for (const [what, args, property] of malformed) {
      const answer = await companion({ action: "poll", namespace: NS, ...args }).then(
        (result) => ({ result }),
        (error: unknown) => ({ thrown: String(error) }),
      );
      expect("thrown" in answer ? answer.thrown : undefined, `${what} is answered, not thrown`).toBeUndefined();
      const result = (answer as { result: WireToolResult }).result;
      expect(result.isError, `${what}: ${allText(result)}`).toBe(true);
      expect(allText(result), `${what} names the tool and the argument`).toContain("iris_test_status");
      expect(allText(result)).toContain(property);
    }
    await expectMonitorIdle("D4");
  }, 120000);
});
