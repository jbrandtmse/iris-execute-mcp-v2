/**
 * Story 39.1 live gate: `iris_message_search` `headers` and the `resendFiltered` wire, driven on the
 * REAL wire against disposable Interoperability namespaces, in the default suite (rule #59: each row
 * names the path it guards).
 *
 * Paths: the BUILT iris-interop-mcp dist, spawned as a child process and driven by the MCP SDK `Client`
 * over stdio, for every `iris_message_search` row; raw HTTP `POST`s to `/api/executemcp/v2` for the
 * route-level rows (past every MCP-layer check, so they exercise the handler's own guards). The oracle is
 * SQL written by hand and run through the raw Atelier `action/query` route against the same namespace,
 * never the code under test.
 *
 * Fixtures (`interop-namespace-fixture.ts`): three disposable namespaces. A has the 13 synthetic
 * `alpha` headers and B the 3 `beta` ones; both map `Ens`/`EnsLib` to ENSLIB. C has no mappings, so
 * `Ens.MessageHeader` does not exist there. All times are on 2001-02-03 UTC, so a misrouted query cannot
 * match real traffic. `beforeAll` removes leftovers by name and asserts there are none; `afterAll`
 * removes the three namespaces, their database files and the fixture class and asserts nothing is left.
 *
 * Rows:
 *  1. `capture` (armed only by `STORY_39_1_CAPTURE=1`): replay the `resendFiltered` request list against A
 *     and write `fixtures/story-39-1-resend-baseline.json`. Run once, on the classes deployed BEFORE the
 *     shared helper was extracted.
 *  2. Byte identity: replay every captured request against the current classes; each raw response body
 *     equals its capture, and the capture predates the `BOOTSTRAP_VERSION` the gate runs on.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the three `EXECMCPTMP391*` namespaces and databases, and the HSCUSTOM
 * class `ExecuteMCPv2.Temp.Story391Fixture`. A missing or stale dist, an unresolvable SDK or an
 * unreachable IRIS skips each row with the reason, or fails with "may not be skipped" when
 * `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDeployedBootstrapVersion,
  atelierQuery,
  executeMcpPost,
  irisTargetFromEnv,
  isIrisReachable,
  openWireSession,
  resolveSdkEsmDir,
  shippedBootstrapVersion,
  staleDistReason,
  type AtelierRow,
  type WireSession,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  FIXTURE_CLASS,
  FIXTURE_DOC,
  FIXTURE_HOME_NAMESPACE,
  createInteropNamespace,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
  seedHeaders,
} from "./interop-namespace-fixture.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const entryOf = (pkg: string): string => path.join(REPO_ROOT, "packages", pkg, "dist", "index.js");
const BASELINE_PATH = path.join(__dirname, "fixtures", "story-39-1-resend-baseline.json");

const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";
const CAPTURE = process.env.STORY_39_1_CAPTURE === "1";

/** The namespaces: A (alpha headers), B (beta headers), C (not configured). */
const NS_A = "EXECMCPTMP391A";
const NS_B = "EXECMCPTMP391B";
const NS_C = "EXECMCPTMP391C";
const NAMESPACES = [NS_A, NS_B, NS_C];

/** The `BOOTSTRAP_VERSION` the baseline must have been captured on: the one before this story. */
const PRE_STORY_BOOTSTRAP_VERSION = "089f8f0a62b2";

const FROM = "2001-02-03T06:00:00Z";
const TO = "2001-02-03T18:00:00Z";

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
/** The built interop server under default configuration. */
let interop: WireSession;
/** The built interop server with an operator who disabled `iris_message_search:headers`. */
let governed: WireSession;
/** The built interop server under the `read-only` governance preset and the `core` visibility preset. */
let readOnly: WireSession;
/** How long the first built-server start took, which includes the bootstrap deployment. */
let firstStartMs = 0;

function wireOptions(pkg: string): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: entryOf(pkg), target: TARGET, clientName: "story-39-1-live-gate" };
}

/** Per-test skip helper: log the reason, then mark the test skipped. */
function skip(testCtx: { skip: () => void }): void {
  // eslint-disable-next-line no-console
  console.log(`[SKIP] story-39-1-message-search-live-gate: ${skipReason}`);
  testCtx.skip();
}

// -- The resendFiltered request list ---------------------------------

interface ResendCase {
  name: string;
  body: Record<string, unknown>;
}

/** A `resendFiltered` request against A with an explicit `to` on 2001-02-03. */
const resend = (name: string, extra: Record<string, unknown>): ResendCase => ({
  name,
  body: { action: "resendFiltered", namespace: NS_A, to: TO, ...extra },
});

const ODD_ITEM = "Story391.Odd'%_ OR 1=1--";

/**
 * Every request replays against A: dry runs, then guards b to f. Guards d and f are only reached by
 * executing, and both refuse before anything is resent: d because more messages match than the cap, f
 * because no production runs in A.
 */
const RESEND_CASES: ResendCase[] = [
  resend("dry run, default status", { item: "Story391.Alpha", from: FROM }),
  resend("dry run, status Completed", { item: "Story391.Alpha", from: FROM, status: "Completed" }),
  resend("dry run, hostile item name, status Delivered", { item: ODD_ITEM, from: FROM, status: "Delivered" }),
  resend("dry run, ODBC window", {
    item: "Story391.Alpha",
    from: "2001-02-03 06:00:00",
    to: "2001-02-03 18:00:00",
    status: "Error",
  }),
  resend("dry run, fractional from on a fractional row", { item: ODD_ITEM, from: "2001-02-03T08:00:00.5Z", status: "Delivered" }),
  resend("dry run, maxMessages echoed", { item: "Story391.Alpha", from: FROM, maxMessages: 5 }),
  resend("dry run, window of exactly 7 days", { item: "Story391.Alpha", from: "2001-01-27T00:00:00Z", to: "2001-02-03T00:00:00Z" }),
  resend("dry run, no match", { item: "Story391.Nothing", from: FROM }),
  resend("guard b, item missing", { from: FROM }),
  resend("guard b, from missing", { item: "Story391.Alpha" }),
  resend("guard c, negative window", { item: "Story391.Alpha", from: TO, to: FROM }),
  resend("guard c, window over 7 days", { item: "Story391.Alpha", from: "2001-01-27T00:00:00Z", to: "2001-02-03T00:00:01Z" }),
  resend("guard c, unparseable from", { item: "Story391.Alpha", from: "not-a-date" }),
  resend("guard c, unparseable to", { item: "Story391.Alpha", from: FROM, to: "2001-13-45T99:99:99Z" }),
  resend("status not recognized", { item: "Story391.Alpha", from: FROM, status: "Bogus" }),
  resend("maxMessages below 1", { item: "Story391.Alpha", from: FROM, maxMessages: 0 }),
  resend("maxMessages above 500", { item: "Story391.Alpha", from: FROM, maxMessages: 501 }),
  resend("guard e, execute without confirm", { item: "Story391.Alpha", from: FROM, dryRun: false }),
  resend("guard d, more matches than the cap", {
    item: "Story391.Alpha",
    from: FROM,
    dryRun: false,
    confirm: true,
    maxMessages: 1,
  }),
  resend("guard f, no production running", { item: "Story391.Alpha", from: FROM, dryRun: false, confirm: true }),
];

interface BaselineCase extends ResendCase {
  status: number;
  text: string;
}

interface Baseline {
  capturedWithBootstrapVersion: string;
  irisVersion: string;
  capturedAt: string;
  command: string;
  cases: BaselineCase[];
}

/** Send one request to the `resendFiltered` route and return the raw HTTP answer. */
const sendResend = (body: Record<string, unknown>): Promise<{ status: number; text: string }> =>
  executeMcpPost(TARGET, "/interop/message/resend", body);

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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.1 live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  const started = performance.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  firstStartMs = Math.round(performance.now() - started);
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  interop = await openWireSession(wireOptions("iris-interop-mcp"));
  governed = await openWireSession(wireOptions("iris-interop-mcp"), {
    IRIS_GOVERNANCE: JSON.stringify({ global: { "iris_message_search:headers": false } }),
  });
  readOnly = await openWireSession(wireOptions("iris-interop-mcp"), {
    IRIS_GOVERNANCE_PRESET: "read-only",
    IRIS_TOOLS_PRESET: "core",
  });
  await putFixtureClass(dev);
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS_A, { interop: true });
  await seedHeaders(dev, NS_A, "alpha");
  await createInteropNamespace(admin, dev, NS_B, { interop: true });
  await seedHeaders(dev, NS_B, "beta");
  await createInteropNamespace(admin, dev, NS_C, { interop: false });

  // A positive control: the same check that must read empty after the run sees all three namespaces now.
  const present = await leftovers(dev, NAMESPACES);
  for (const name of NAMESPACES) {
    expect(present, `the leftovers check sees ${name} while it exists`).toEqual(
      expect.arrayContaining([`namespace ${name}`, `database configuration ${name}`]),
    );
  }
}, 300000);

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const problems: string[] = [];
  const attempt = async (what: string, step: () => Promise<void>): Promise<void> => {
    try {
      await step();
    } catch (error) {
      problems.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  try {
    for (const name of NAMESPACES) await attempt(`removing ${name}`, () => removeInteropNamespace(admin, dev, name));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, NAMESPACES), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      const listed = await dev.call("iris_doc_list", { filter: "Story391", generated: true });
      expect(listed.isError, "the fixture document listing").toBeFalsy();
      const names = (listed.structuredContent as { items: Array<{ name: string }> }).items.map((item) => item.name);
      expect(names, `no ${FIXTURE_DOC} or generated Story391 document after the run`).toEqual([]);
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [readOnly, governed, interop, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- Byte identity of the resendFiltered wire ----------------------------

describe("Story 39.1: the resendFiltered wire (AD-17, AD-33)", () => {
  it.runIf(CAPTURE)("capture: replay the resendFiltered request list against A and write the baseline", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const deployed = await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
    expect(deployed, "the capture runs on the classes deployed before the extraction").toBe(PRE_STORY_BOOTSTRAP_VERSION);

    const info = await dev.call("iris_server_info", { namespace: TARGET.namespace });
    const irisVersion = String(
      (info.structuredContent as { content?: { version?: unknown } } | undefined)?.content?.version ?? "",
    );
    expect(irisVersion, "the IRIS version string").not.toBe("");

    const cases: BaselineCase[] = [];
    for (const requestCase of RESEND_CASES) {
      const answer = await sendResend(requestCase.body);
      cases.push({ ...requestCase, status: answer.status, text: answer.text });
    }
    const baseline: Baseline = {
      capturedWithBootstrapVersion: deployed,
      irisVersion,
      capturedAt: new Date().toISOString(),
      command:
        "STORY_39_1_CAPTURE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-1-message-search-live-gate.test.ts -t capture",
      cases,
    };
    mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  }, 240000);

  it("every resendFiltered request answers byte for byte as it did before the shared helper", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;

    expect(baseline.capturedWithBootstrapVersion, "the capture was taken on the classes before this story").toBe(
      PRE_STORY_BOOTSTRAP_VERSION,
    );
    expect(baseline.capturedWithBootstrapVersion, "the gate runs on a different build than the capture").not.toBe(
      await shippedBootstrapVersion(REPO_ROOT),
    );
    expect(baseline.cases.map((c) => c.name), "the capture holds every request in the list").toEqual(
      RESEND_CASES.map((c) => c.name),
    );

    for (const captured of baseline.cases) {
      const answer = await sendResend(captured.body);
      expect({ status: answer.status, text: answer.text }, captured.name).toEqual({
        status: captured.status,
        text: captured.text,
      });
    }
  }, 240000);
});

// -- The header search against a hand-written SQL oracle -----------------

/**
 * The oracle's columns. The raw Atelier query route renders a SQL NULL integer as 0, so whether
 * `CorrespondingMessageId` is NULL is read from its own column.
 */
const COLUMNS =
  "ID, SessionId, Type, Status, IsError, SourceConfigName, TargetConfigName, MessageBodyClassName, MessageBodyId, TimeCreated, TimeProcessed, CorrespondingMessageId, CASE WHEN CorrespondingMessageId IS NULL THEN 1 ELSE 0 END AS CorrespondingIsNull";

/** The window FROM to TO as the SQL the oracle uses: the stored form, both ends inclusive. */
const WINDOW_SQL = "TimeCreated >= '2001-02-03 06:00:00' AND TimeCreated <= '2001-02-03 18:00:00'";

const TYPE_LABELS: Record<number, string> = { 1: "Request", 2: "Response", 3: "Terminate" };
const STATUS_ROW_LABELS = ["Created", "Queued", "Delivered", "Discarded", "Suspended", "Deferred", "Aborted", "Error", "Completed"];

/** A stored UTC value as `toISOString()` UTC, or `""`. Written here, not imported, so it is an independent oracle. */
function isoOf(stored: string): string {
  return stored === "" ? "" : new Date(`${stored.replace(" ", "T")}Z`).toISOString();
}

/** The row the tool must return for an oracle row. */
function expectedRow(row: AtelierRow): Record<string, unknown> {
  const created = String(row["TimeCreated"] ?? "");
  const processed = row["TimeProcessed"] === null || row["TimeProcessed"] === undefined ? "" : String(row["TimeProcessed"]);
  return {
    id: Number(row["ID"]),
    sessionId: Number(row["SessionId"]),
    type: TYPE_LABELS[Number(row["Type"])] ?? "Unknown",
    status: STATUS_ROW_LABELS[Number(row["Status"]) - 1] ?? "",
    isError: Number(row["IsError"]) === 1,
    sourceItem: String(row["SourceConfigName"]),
    targetItem: String(row["TargetConfigName"]),
    bodyClassName: String(row["MessageBodyClassName"]),
    bodyId: String(row["MessageBodyId"]),
    timeCreated: isoOf(created),
    timeCreatedRaw: created,
    timeProcessed: isoOf(processed),
    timeProcessedRaw: processed,
    correspondingMessageId: Number(row["CorrespondingIsNull"]) === 1 ? null : Number(row["CorrespondingMessageId"]),
  };
}

/** The rows of `Ens.MessageHeader` in `ns` that `where` selects, in `TimeCreated, ID` order, as the tool must return them. */
async function oracle(ns: string, where: string): Promise<Array<Record<string, unknown>>> {
  const rows = await atelierQuery(
    { ...TARGET, namespace: ns },
    `SELECT ${COLUMNS} FROM Ens.MessageHeader WHERE ${where} ORDER BY TimeCreated, ID`,
  );
  return rows.map(expectedRow);
}

const sqlLiteral = (value: string): string => `'${value.replaceAll("'", "''")}'`;
const textOf = (result: WireToolResult): string => result.content?.[0]?.text ?? "";

type Structured = Record<string, unknown> & { rows: Array<Record<string, unknown>>; hasMore: boolean; nextCursor?: string };

/** Run a `headers` search against A through `session`, defaulting to the 2001 window. */
function search(session: WireSession, args: Record<string, unknown> = {}): Promise<WireToolResult> {
  return session.call("iris_message_search", { action: "headers", namespace: NS_A, from: FROM, to: TO, ...args });
}

/** The structured content of a successful result. */
function succeeded(result: WireToolResult): Structured {
  expect(result.isError, textOf(result)).toBeFalsy();
  return result.structuredContent as Structured;
}

const ids = (rows: Array<Record<string, unknown>>): number[] => rows.map((row) => Number(row["id"]));

interface FilterCase {
  name: string;
  args: Record<string, unknown>;
  where: string;
  /** The IDs the oracle selects, in order: written by hand, so an oracle that returns nothing cannot pass. */
  ids: number[];
}

const ALPHA = sqlLiteral("Story391.Alpha");
const FILTER_CASES: FilterCase[] = [
  { name: "window only (rows at from and at to are in; the rows outside are out)", args: {}, where: WINDOW_SQL, ids: [2, 3, 4, 5, 6, 7, 8, 9, 13, 10, 11] },
  {
    name: "item matches the source or the target",
    args: { item: "Story391.Alpha" },
    where: `${WINDOW_SQL} AND (SourceConfigName = ${ALPHA} OR TargetConfigName = ${ALPHA})`,
    ids: [2, 3, 4, 7, 9, 13, 10, 11],
  },
  { name: "source", args: { source: "Story391.Alpha" }, where: `${WINDOW_SQL} AND SourceConfigName = ${ALPHA}`, ids: [3, 4, 13, 10, 11] },
  { name: "target", args: { target: "Story391.Delta" }, where: `${WINDOW_SQL} AND TargetConfigName = 'Story391.Delta'`, ids: [4, 8, 10] },
  { name: "status Errored is status code 8", args: { status: "Errored" }, where: `${WINDOW_SQL} AND Status = 8`, ids: [3, 4, 9, 10] },
  { name: "sessionId", args: { sessionId: 200 }, where: `${WINDOW_SQL} AND SessionId = 200`, ids: [3, 4] },
  { name: "bodyClass", args: { bodyClass: "Story391.Body.B" }, where: `${WINDOW_SQL} AND MessageBodyClassName = 'Story391.Body.B'`, ids: [3, 4, 10] },
  { name: "errorOnly is the IsError flag, not the status", args: { errorOnly: true }, where: `${WINDOW_SQL} AND IsError = 1`, ids: [3, 4, 8, 9, 10] },
  {
    name: "every filter ANDed",
    args: {
      item: "Story391.Alpha",
      source: "Story391.Alpha",
      target: "Story391.Delta",
      status: "Errored",
      sessionId: 200,
      bodyClass: "Story391.Body.B",
      errorOnly: true,
    },
    where: `${WINDOW_SQL} AND (SourceConfigName = ${ALPHA} OR TargetConfigName = ${ALPHA}) AND SourceConfigName = ${ALPHA} AND TargetConfigName = 'Story391.Delta' AND Status = 8 AND SessionId = 200 AND MessageBodyClassName = 'Story391.Body.B' AND IsError = 1`,
    ids: [4],
  },
  {
    name: "a combination without the session",
    args: { source: "Story391.Alpha", target: "Story391.Delta", status: "Errored", errorOnly: true },
    where: `${WINDOW_SQL} AND SourceConfigName = ${ALPHA} AND TargetConfigName = 'Story391.Delta' AND Status = 8 AND IsError = 1`,
    ids: [4, 10],
  },
  { name: "the odd source name, searched exactly", args: { source: ODD_ITEM }, where: `${WINDOW_SQL} AND SourceConfigName = ${sqlLiteral(ODD_ITEM)}`, ids: [5] },
  { name: "the odd target name, searched exactly", args: { target: ODD_ITEM }, where: `${WINDOW_SQL} AND TargetConfigName = ${sqlLiteral(ODD_ITEM)}`, ids: [6] },
  {
    name: "the odd item name matches its source and its target",
    args: { item: ODD_ITEM },
    where: `${WINDOW_SQL} AND (SourceConfigName = ${sqlLiteral(ODD_ITEM)} OR TargetConfigName = ${sqlLiteral(ODD_ITEM)})`,
    ids: [5, 6],
  },
  { name: "% is a name, not a pattern", args: { source: "%" }, where: `${WINDOW_SQL} AND SourceConfigName = '%'`, ids: [] },
  { name: "_ is a name, not a pattern", args: { target: "_" }, where: `${WINDOW_SQL} AND TargetConfigName = '_'`, ids: [] },
  { name: "a prefix of the odd name matches nothing", args: { item: "Story391.Odd'%" }, where: `${WINDOW_SQL} AND (SourceConfigName = 'Story391.Odd''%' OR TargetConfigName = 'Story391.Odd''%')`, ids: [] },
  {
    name: "an injected condition matches nothing",
    args: { source: "Story391.Alpha' OR '1'='1" },
    where: `${WINDOW_SQL} AND SourceConfigName = 'Story391.Alpha'' OR ''1''=''1'`,
    ids: [],
  },
  {
    name: "a source name in another case matches the same rows",
    args: { source: "story391.alpha" },
    where: `${WINDOW_SQL} AND SourceConfigName = 'story391.alpha'`,
    ids: [3, 4, 13, 10, 11],
  },
  {
    name: "an item name and a body class in another case match the same rows",
    args: { item: "STORY391.ALPHA", bodyClass: "story391.body.b" },
    where: `${WINDOW_SQL} AND (SourceConfigName = 'STORY391.ALPHA' OR TargetConfigName = 'STORY391.ALPHA') AND MessageBodyClassName = 'story391.body.b'`,
    ids: [3, 4, 10],
  },
  {
    name: "an injected body class matches nothing",
    args: { bodyClass: "Story391.Body.A' OR 1=1--" },
    where: `${WINDOW_SQL} AND MessageBodyClassName = 'Story391.Body.A'' OR 1=1--'`,
    ids: [],
  },
];

describe("Story 39.1: iris_message_search headers equals a hand-written SQL oracle (AC-3)", () => {
  for (const filterCase of FILTER_CASES) {
    it(filterCase.name, async (testCtx) => {
      if (skipReason) return skip(testCtx);
      const expected = await oracle(NS_A, filterCase.where);
      expect(ids(expected), "the oracle selects the rows written by hand").toEqual(filterCase.ids);

      const started = performance.now();
      const content = succeeded(await search(interop, filterCase.args));
      if (filterCase.name.startsWith("window only")) {
        // eslint-disable-next-line no-console
        console.log(`[PERF] story-39-1: bootstrap start ${firstStartMs} ms; one headers call on A ${Math.round(performance.now() - started)} ms`);
      }

      expect(content.rows, "every field of every row, in order").toEqual(expected);
      expect(content.hasMore).toBe(false);
      expect(content).not.toHaveProperty("nextCursor");
      expect(content.limit).toBe(100);
    }, 120000);
  }

  // 3 and 2 split the 11 matches into pages that end mid-result; 11 is a page that is exactly full and has no more.
  for (const limit of [3, 2, 11]) {
    it(`pages of ${limit} join, in order, without a gap or a duplicate; only a page with more carries nextCursor`, async (testCtx) => {
      if (skipReason) return skip(testCtx);
      const expected = await oracle(NS_A, WINDOW_SQL);
      const pages: Structured[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 20; guard += 1) {
        const page = succeeded(await search(interop, { limit, ...(cursor === undefined ? {} : { cursor }) }));
        pages.push(page);
        if (!page.hasMore) break;
        expect(typeof page.nextCursor, `page ${pages.length} has more, so it carries nextCursor`).toBe("string");
        cursor = page.nextCursor;
      }

      expect(pages.flatMap((page) => page.rows)).toEqual(expected);
      expect(ids(pages.flatMap((page) => page.rows))).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 13, 10, 11]);
      expect(pages, "no page is empty and none is missing").toHaveLength(Math.ceil(11 / limit));
      for (const page of pages.slice(0, -1)) expect(page.rows).toHaveLength(limit);
      const last = pages[pages.length - 1] as Structured;
      expect(last.hasMore).toBe(false);
      expect(last).not.toHaveProperty("nextCursor");
    }, 120000);
  }

  it("sends to (now) and limit 100 when the caller omits them", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const hourAgo = new Date(Date.now() - 3600_000).toISOString().replace(/\.\d+Z$/, "Z");
    const content = succeeded(
      await interop.call("iris_message_search", { action: "headers", namespace: NS_A, from: hourAgo }),
    );

    expect(content.limit).toBe(100);
    expect(content.rows).toEqual([]);
    expect(String(content["toRaw"])).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,3})?$/);
    expect(Math.abs(Date.parse(String(content["to"])) - Date.now()), "to is now, in UTC").toBeLessThan(120_000);
  }, 120000);

  it("accepts a window of no length and a window of exactly 7 days", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const instant = succeeded(await search(interop, { from: "2001-02-03T07:30:00Z", to: "2001-02-03T07:30:00Z" }));
    const instantOracle = await oracle(NS_A, "TimeCreated >= '2001-02-03 07:30:00' AND TimeCreated <= '2001-02-03 07:30:00'");
    expect(ids(instantOracle), "the two headers created at that instant").toEqual([3, 4]);
    expect(instant.rows).toEqual(instantOracle);

    const week = succeeded(await search(interop, { from: "2001-01-27T12:00:00Z", to: "2001-02-03T12:00:00Z" }));
    const weekOracle = await oracle(NS_A, "TimeCreated >= '2001-01-27 12:00:00' AND TimeCreated <= '2001-02-03 12:00:00'");
    expect(ids(weekOracle), "every header up to noon").toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(week.rows).toEqual(weekOracle);
  }, 120000);

  it("reads an offset as the UTC instant it is", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const content = succeeded(
      await search(interop, { from: "2001-02-03T12:00:00+02:00", to: "2001-02-03T20:00:00+02:00" }),
    );
    const expected = await oracle(NS_A, "TimeCreated >= '2001-02-03 10:00:00' AND TimeCreated <= '2001-02-03 18:00:00'");

    expect(ids(expected)).toEqual([7, 8, 9, 13, 10, 11]);
    expect(content.rows).toEqual(expected);
    expect(content["fromRaw"]).toBe("2001-02-03 10:00:00");
    expect(content["toRaw"]).toBe("2001-02-03 18:00:00");
  }, 120000);
});

describe("Story 39.1: second namespace and not-configured namespace (AC-5; rules #34, #36, #41)", () => {
  it("A and B each return their own rows, equal to their own oracle, and the two differ", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const inA = succeeded(await search(interop, { namespace: NS_A }));
    const inB = succeeded(await search(interop, { namespace: NS_B }));

    expect(inA.rows).toEqual(await oracle(NS_A, WINDOW_SQL));
    expect(inB.rows).toEqual(await oracle(NS_B, WINDOW_SQL));
    expect(ids(inB.rows)).toEqual([1, 2, 3]);
    expect(inB.rows.map((row) => row["sourceItem"])).toEqual(["Story391.Alpha", "Story391.Omega", "Story391.Sigma"]);
    expect(inA.rows).not.toEqual(inB.rows);

    const itemInA = succeeded(await search(interop, { namespace: NS_A, item: "Story391.Alpha" }));
    const itemInB = succeeded(await search(interop, { namespace: NS_B, item: "Story391.Alpha" }));
    expect(ids(itemInA.rows)).toEqual([2, 3, 4, 7, 9, 13, 10, 11]);
    expect(ids(itemInB.rows)).toEqual([1, 2]);
  }, 120000);

  it("a namespace with no Interoperability mappings is notApplicable, not an error", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const result = await search(interop, { namespace: NS_C });

    expect(result.isError, textOf(result)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ action: "headers", notApplicable: true, rows: [], hasMore: false });
    expect(String((result.structuredContent as { reason?: unknown }).reason)).toContain(NS_C);
  }, 120000);

  it("a namespace that does not exist is an error carrying the sanitized switch text", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const result = await search(interop, { namespace: "EXECMCPTMP391Z" });

    expect(result.isError).toBe(true);
    expect(textOf(result)).not.toBe("");
    expect(textOf(result)).not.toContain("^");
  }, 120000);
});

// -- Refusals ---------------------------------------------------------------

describe("Story 39.1: bad input is refused naming the parameter, not the value (the tool and the route)", () => {
  const HOSTILE = "x' OR 1=1--";

  const TOOL_CASES: Array<[string, Record<string, unknown>, string]> = [
    ["a naive from", { from: "2001-02-03T06:00:00" }, "from"],
    ["a garbage from", { from: HOSTILE }, "from"],
    ["a missing from", { from: undefined }, "from"],
    ["a garbage to", { to: HOSTILE }, "to"],
    ["a malformed cursor", { cursor: HOSTILE }, "cursor"],
    ["limit 0", { limit: 0 }, "limit"],
    ["limit 501", { limit: 501 }, "limit"],
    ["limit 2.5", { limit: 2.5 }, "limit"],
  ];
  for (const [name, args, parameter] of TOOL_CASES) {
    it(`tool: ${name}`, async (testCtx) => {
      if (skipReason) return skip(testCtx);
      const result = await search(interop, args);

      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain(parameter);
      expect(textOf(result)).not.toContain(HOSTILE);
    }, 120000);
  }

  const ROUTE = "/interop/message/search";
  const valid = { action: "headers", namespace: NS_A, from: FROM, to: TO };

  const ROUTE_CASES: Array<[string, Record<string, unknown>, string]> = [
    ["no action", { namespace: NS_A, from: FROM }, "action"],
    ["an unknown action", { ...valid, action: HOSTILE }, "action"],
    ["an action that is not built", { ...valid, action: "body" }, "action"],
    ["a negative window", { ...valid, from: TO, to: FROM }, "earlier"],
    ["a window over 7 days", { ...valid, from: "2001-01-27T00:00:00Z", to: "2001-02-03T00:00:01Z" }, "7 days"],
    ["an unparseable from", { ...valid, from: HOSTILE }, "from"],
    ["an unparseable to", { ...valid, to: HOSTILE }, "to"],
    ["limit 0", { ...valid, limit: 0 }, "limit"],
    ["limit 501", { ...valid, limit: 501 }, "limit"],
    ["limit 2.5", { ...valid, limit: 2.5 }, "limit"],
    ["an unknown status", { ...valid, status: HOSTILE }, "status"],
    ["a sessionId that is not an integer", { ...valid, sessionId: HOSTILE }, "sessionId"],
    ["an afterId that is not an integer", { ...valid, afterTimeCreated: "2001-02-03 08:00:00", afterId: HOSTILE }, "afterId"],
    ["an afterId without afterTimeCreated", { ...valid, afterId: 5 }, "afterId"],
    ["an afterTimeCreated without afterId", { ...valid, afterTimeCreated: "2001-02-03 08:00:00" }, "afterTimeCreated"],
    ["an unparseable afterTimeCreated", { ...valid, afterTimeCreated: HOSTILE, afterId: 5 }, "afterTimeCreated"],
    ["a missing from", { action: "headers", namespace: NS_A, to: TO }, "from"],
    ["an item of 129 characters", { ...valid, item: "x".repeat(129) }, "item"],
    ["a source of 129 characters", { ...valid, source: "x".repeat(129) }, "source"],
    ["a target of 129 characters", { ...valid, target: "x".repeat(129) }, "target"],
    ["a bodyClass of 221 characters", { ...valid, bodyClass: "x".repeat(221) }, "bodyClass"],
    ["a source that is not a string", { ...valid, source: 5 }, "source"],
    ["an errorOnly that is not a boolean", { ...valid, errorOnly: "yes" }, "errorOnly"],
    ["a bad from, sent with a namespace that cannot be switched to", { ...valid, from: HOSTILE, namespace: "EXECMCPTMP391Z" }, "from"],
  ];
  for (const [name, body, parameter] of ROUTE_CASES) {
    it(`route: ${name}`, async (testCtx) => {
      if (skipReason) return skip(testCtx);
      const answer = await executeMcpPost(TARGET, ROUTE, body);

      expect(answer.status).toBe(200);
      const envelope = JSON.parse(answer.text) as { status: { errors: Array<{ error: string }> }; result: Record<string, unknown> };
      expect(envelope.status.errors.length, answer.text).toBeGreaterThanOrEqual(1);
      expect(envelope.status.errors[0]?.error).toContain(parameter);
      expect(answer.text).not.toContain(HOSTILE);
      expect(envelope.result, "a refusal returns an empty result").toEqual({});
    }, 120000);
  }

  it("route: leaving out to and limit answers with now, to the millisecond, and 100 (namespace C holds no headers to read)", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const answer = await executeMcpPost(TARGET, ROUTE, {
      action: "headers",
      namespace: NS_C,
      from: new Date(Date.now() - 3600_000).toISOString(),
    });

    expect(answer.status).toBe(200);
    const envelope = JSON.parse(answer.text) as {
      status: { errors?: unknown[] };
      result: { interopEnabled: boolean; limit: number; to: string };
    };
    expect(envelope.status.errors ?? [], answer.text).toHaveLength(0);
    expect(envelope.result.interopEnabled).toBe(false);
    expect(envelope.result.limit).toBe(100);
    expect(envelope.result.to, "now in UTC, with milliseconds").toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    expect(Math.abs(Date.parse(`${envelope.result.to.replace(" ", "T")}Z`) - Date.now())).toBeLessThan(120_000);
  }, 120000);

  it("the fixture class refuses a name that is not a scratch namespace, and runs nothing", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const call = async (methodName: string, args: unknown[], namespace: string): Promise<string> => {
      const result = await dev.call("iris_execute_classmethod", { namespace, className: FIXTURE_CLASS, methodName, args });
      expect(result.isError, textOf(result)).toBeFalsy();
      return String((result.structuredContent as { returnValue?: unknown }).returnValue ?? "");
    };

    // "EXECMCPTMP391" has no capital letter, so it is not a scratch name, and no directory is named for it.
    expect(await call("RemoveDatabaseFiles", ["EXECMCPTMP391"], FIXTURE_HOME_NAMESPACE)).toMatch(/^REFUSED/);
    expect(await call("Leftovers", ["EXECMCPTMP391"], FIXTURE_HOME_NAMESPACE)).toBe('["REFUSED name EXECMCPTMP391"]');
    expect(await call("Seed", ["alpha"], FIXTURE_HOME_NAMESPACE)).toMatch(/^REFUSED: Seed runs only in a namespace named EXECMCPTMP391/);
  }, 120000);
});

describe("Story 39.1: body and searchTable are declared but not built (AC-6)", () => {
  for (const action of ["body", "searchTable"]) {
    it(`${action} returns the NOT_IMPLEMENTED refusal`, async (testCtx) => {
      if (skipReason) return skip(testCtx);
      const result = await search(interop, { action });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({ code: "NOT_IMPLEMENTED", action, availableActions: ["headers"] });
    }, 120000);
  }
});

// -- Visibility and governance --------------------------------------------------

describe("Story 39.1: the tool is listed, its keys are enabled reads, and governance can disable one (AC-4)", () => {
  it("is listed with the stated annotations; the interop server advertises 24 tools", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const tools = await interop.listTools();

    expect(tools).toHaveLength(24);
    const listed = tools.find((tool) => tool.name === "iris_message_search");
    expect(listed?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(listed?.inputSchema.required).toEqual(expect.arrayContaining(["action", "from"]));
  }, 120000);

  it("all three keys are enabled under default configuration and under the read-only preset, which also lists core's 11 tools", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const keys = ["headers", "body", "searchTable"].map((action) => `iris_message_search:${action}`);
    for (const [label, session] of [["default", interop], ["read-only", readOnly]] as const) {
      const profiles = await session.raw("iris_server_profiles", {});
      const policy = (profiles.structuredContent as { governance: { policy: Record<string, boolean> } }).governance.policy;
      for (const key of keys) expect(policy[key], `${key} under ${label}`).toBe(true);
    }

    const coreTools = await readOnly.listTools();
    expect(coreTools).toHaveLength(11);
    expect(coreTools.map((tool) => tool.name)).toContain("iris_message_search");
    const searched = succeeded(await search(readOnly));
    expect(ids(searched.rows)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 13, 10, 11]);
  }, 120000);

  it("an operator's disable of headers denies it, and body still reaches NOT_IMPLEMENTED", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const denied = await search(governed);
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_message_search:headers",
      server: "default",
    });

    const body = await search(governed, { action: "body" });
    expect(body.structuredContent).toMatchObject({ code: "NOT_IMPLEMENTED", action: "body" });
  }, 120000);
});

// -- QA additions: edges the rows above leave open ---------------------------------

/** Search through `interop`, page after page, until a page has no more; every page is returned. */
async function pagesOf(args: Record<string, unknown>): Promise<Structured[]> {
  const pages: Structured[] = [];
  let cursor: string | undefined;
  for (let guard = 0; guard < 20; guard += 1) {
    const page = succeeded(await search(interop, { ...args, ...(cursor === undefined ? {} : { cursor }) }));
    pages.push(page);
    if (!page.hasMore) break;
    expect(typeof page.nextCursor, `page ${pages.length} has more, so it carries nextCursor`).toBe("string");
    cursor = page.nextCursor;
  }
  return pages;
}

/** A cursor written by hand in the documented shape (base64url JSON `{t, id}`), not by the tool's encoder. */
const handWrittenCursor = (t: string, id: number): string =>
  Buffer.from(JSON.stringify({ t, id }), "utf8").toString("base64url");

describe("Story 39.1 (QA): every status label reaches the status code it names (AC-3)", () => {
  // The expected IDs are written by hand from the seed: the headers inside the window by status code.
  const STATUS_CASES: Array<[string, number, number[]]> = [
    ["Created", 1, []],
    ["Queued", 2, [7]],
    ["Delivered", 3, [5, 13]],
    ["Discarded", 4, []],
    ["Suspended", 5, [8]],
    ["Deferred", 6, []],
    ["Aborted", 7, []],
    ["Completed", 9, [2, 6, 11]],
  ];
  for (const [label, code, expectedIds] of STATUS_CASES) {
    it(`status ${label} is status code ${code}`, async (testCtx) => {
      if (skipReason) return skip(testCtx);
      const expected = await oracle(NS_A, `${WINDOW_SQL} AND Status = ${code}`);
      expect(ids(expected), "the oracle selects the rows written by hand").toEqual(expectedIds);

      const content = succeeded(await search(interop, { status: label }));

      expect(content.rows).toEqual(expected);
    }, 120000);
  }

  it("route: the label Error names status code 8, as Errored does", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const answer = await executeMcpPost(TARGET, "/interop/message/search", {
      action: "headers",
      namespace: NS_A,
      from: FROM,
      to: TO,
      status: "Error",
    });

    const envelope = JSON.parse(answer.text) as { status: { errors?: unknown[] }; result: { rows: Array<{ id: number }> } };
    expect(envelope.status.errors ?? [], answer.text).toHaveLength(0);
    expect(envelope.result.rows.map((row) => row.id)).toEqual([3, 4, 9, 10]);
  }, 120000);
});

describe("Story 39.1 (QA): values at the edge of what is allowed are accepted (AC-3)", () => {
  it("limit 1 and limit 500 are both accepted; 500 holds every match in one page", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const one = succeeded(await search(interop, { limit: 1 }));
    expect(ids(one.rows)).toEqual([2]);
    expect(one.limit).toBe(1);
    expect(one.hasMore).toBe(true);
    expect(typeof one.nextCursor).toBe("string");

    const most = succeeded(await search(interop, { limit: 500 }));
    expect(most.limit).toBe(500);
    expect(ids(most.rows)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 13, 10, 11]);
    expect(most.hasMore).toBe(false);
    expect(most).not.toHaveProperty("nextCursor");
  }, 120000);

  it("errorOnly false is no filter at all: every header in the window, not only the flagged ones", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const content = succeeded(await search(interop, { errorOnly: false }));

    expect(content.rows).toEqual(await oracle(NS_A, WINDOW_SQL));
    expect(content.rows.some((row) => row["isError"] === false), "the unflagged headers are there").toBe(true);
  }, 120000);

  it("names of exactly 128 characters and a body class of exactly 220 are accepted, and match nothing", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const name = `Story391.${"x".repeat(119)}`;
    const bodyClass = `Story391.Body.${"y".repeat(206)}`;
    expect(name).toHaveLength(128);
    expect(bodyClass).toHaveLength(220);

    for (const args of [{ item: name }, { source: name }, { target: name }, { bodyClass }]) {
      const content = succeeded(await search(interop, args));
      expect(content.rows, JSON.stringify(Object.keys(args))).toEqual([]);
      expect(content.hasMore).toBe(false);
    }
  }, 120000);

  it("a session ID at the largest safe integer matches nothing; one beyond range is refused naming sessionId", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const largest = succeeded(await search(interop, { sessionId: Number.MAX_SAFE_INTEGER }));
    expect(largest.rows).toEqual([]);

    const beyond = await search(interop, { sessionId: 1e21 });
    expect(beyond.isError, textOf(beyond)).toBe(true);
    expect(textOf(beyond)).toContain("sessionId");
    expect(textOf(beyond)).not.toMatch(/SQLCODE|SQL error|<SYNTAX>/i);
  }, 120000);

  it("the ends of the calendar IRIS can hold are searched without an error", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    for (const window of [
      { from: "1841-01-01T00:00:00Z", to: "1841-01-02T00:00:00Z" },
      { from: "2000-02-29T00:00:00Z", to: "2000-02-29T23:59:59Z" },
      { from: "9999-12-30T00:00:00Z", to: "9999-12-31T23:59:59.999Z" },
    ]) {
      const content = succeeded(await search(interop, window));
      expect(content.rows, JSON.stringify(window)).toEqual([]);
      expect(content.hasMore).toBe(false);
    }
  }, 120000);
});

describe("Story 39.1 (QA): the cursor and the filters work together (AC-3)", () => {
  const ALPHA_NAME = sqlLiteral("Story391.Alpha");
  const PAGED_CASES: Array<{ name: string; args: Record<string, unknown>; where: string; ids: number[] }> = [
    {
      name: "item and errorOnly, one row per page (the page boundary falls between the two headers with the same time)",
      args: { item: "Story391.Alpha", errorOnly: true, limit: 1 },
      where: `${WINDOW_SQL} AND (SourceConfigName = ${ALPHA_NAME} OR TargetConfigName = ${ALPHA_NAME}) AND IsError = 1`,
      ids: [3, 4, 9, 10],
    },
    {
      name: "bodyClass, pages of 2",
      args: { bodyClass: "Story391.Body.A", limit: 2 },
      where: `${WINDOW_SQL} AND MessageBodyClassName = 'Story391.Body.A'`,
      ids: [2, 5, 6, 9, 13],
    },
    {
      name: "status Completed, pages of 2",
      args: { status: "Completed", limit: 2 },
      where: `${WINDOW_SQL} AND Status = 9`,
      ids: [2, 6, 11],
    },
  ];
  for (const pagedCase of PAGED_CASES) {
    it(`filtered pages join without a gap or a duplicate: ${pagedCase.name}`, async (testCtx) => {
      if (skipReason) return skip(testCtx);
      const expected = await oracle(NS_A, pagedCase.where);
      expect(ids(expected), "the oracle selects the rows written by hand").toEqual(pagedCase.ids);

      const pages = await pagesOf(pagedCase.args);

      expect(pages.flatMap((page) => page.rows)).toEqual(expected);
      expect(pages, "the page count follows from the limit").toHaveLength(Math.ceil(pagedCase.ids.length / Number(pagedCase.args["limit"])));
      expect(pages[pages.length - 1]).not.toHaveProperty("nextCursor");
    }, 120000);
  }

  it("a cursor written by hand resumes after its (time, id) exactly, between two headers with the same time", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const tied = "2001-02-03 07:30:00";
    const expected = await oracle(
      NS_A,
      `${WINDOW_SQL} AND (TimeCreated > '${tied}' OR (TimeCreated = '${tied}' AND ID > 3))`,
    );
    expect(ids(expected), "everything after header 3, so header 4 (same time, higher ID) is the first").toEqual([4, 5, 6, 7, 8, 9, 13, 10, 11]);

    const content = succeeded(await search(interop, { cursor: handWrittenCursor(tied, 3) }));

    expect(content.rows).toEqual(expected);
  }, 120000);

  it("a cursor never widens the window: one that points before from still starts at from, and one past the last row is empty", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const early = succeeded(await search(interop, { cursor: handWrittenCursor("2001-02-03 00:00:00", 1) }));
    expect(early.rows).toEqual(await oracle(NS_A, WINDOW_SQL));
    expect(ids(early.rows)[0], "header 1 (05:59:59) is before from, so the window still starts at header 2").toBe(2);

    const late = succeeded(await search(interop, { cursor: handWrittenCursor("2001-02-03 18:00:00", 11) }));
    expect(late.rows).toEqual([]);
    expect(late.hasMore).toBe(false);
  }, 120000);
});

describe("Story 39.1 (QA): the window limits and hostile values, through the built server (AD-20, AD-26)", () => {
  it("tool: a window one second over 7 days is refused, naming the limit", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const result = await search(interop, { from: "2001-01-27T00:00:00Z", to: "2001-02-03T00:00:01Z" });

    expect(result.isError, textOf(result)).toBe(true);
    expect(textOf(result)).toContain("7 days");
    expect(result.structuredContent?.["rows"], "a refusal returns no rows").toBeUndefined();
  }, 120000);

  it("tool: a window that ends before it starts is refused, naming the order", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const result = await search(interop, { from: TO, to: FROM });

    expect(result.isError, textOf(result)).toBe(true);
    expect(textOf(result)).toContain("earlier");
    expect(result.structuredContent?.["rows"], "a refusal returns no rows").toBeUndefined();
  }, 120000);

  // Characters that mean something to JSON, to SQL, to a pattern matcher or to a terminal; each is only a name
  // that no header carries, so each search succeeds and matches nothing.
  const EXOTIC_NAMES: Array<[string, string]> = [
    ["a double quote", 'Story391.Alpha"'],
    ["a backslash", "Story391.Alpha\\"],
    ["a backslash before a quote", "\\' OR 1=1 --"],
    ["a line break", "Story391.Alpha\nStory391.Beta"],
    ["a tab inside the name", "Story391.\tAlpha"],
    ["a leading space", " Story391.Alpha"],
    ["accented, CJK and emoji text", "Story391.Älpha日本語😀"],
    ["brackets and a pattern class", "[Story391.Alpha]"],
    ["a statement terminator and a comment", "Story391.Alpha; DROP TABLE Ens.MessageHeader /* */"],
    ["a trailing wildcard", "Story391.%"],
    ["a single-character wildcard", "Story391.Alph_"],
  ];
  for (const [what, value] of EXOTIC_NAMES) {
    it(`${what} in a name is a name: a clean empty result, not an error`, async (testCtx) => {
      if (skipReason) return skip(testCtx);
      for (const field of ["item", "source", "target", "bodyClass"]) {
        const result = await search(interop, { [field]: value });
        const content = succeeded(result);
        expect(content.rows, `${field} = ${JSON.stringify(value)}`).toEqual([]);
        expect(content.hasMore).toBe(false);
      }
    }, 120000);
  }

  it("blanks and tabs after a name are ignored, as the column's collation ignores them: the rows equal the same SQL equality", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    // Observed with the oracle first (rule #36): the %String name columns compare with trailing blanks and tabs
    // removed (so these are the rows of `source = 'Story391.Alpha'`, written by hand from the seed) but not a
    // trailing line break, which makes a different name.
    const TRAILING: Array<[string, number[]]> = [
      [" ", [3, 4, 13, 10, 11]],
      ["\t", [3, 4, 13, 10, 11]],
      [" \t ", [3, 4, 13, 10, 11]],
      ["\n", []],
    ];
    for (const [trailing, expectedIds] of TRAILING) {
      const expected = await oracle(NS_A, `${WINDOW_SQL} AND SourceConfigName = ${sqlLiteral(`Story391.Alpha${trailing}`)}`);
      expect(ids(expected), `the oracle for ${JSON.stringify(trailing)}`).toEqual(expectedIds);

      const content = succeeded(await search(interop, { source: `Story391.Alpha${trailing}` }));

      expect(content.rows, JSON.stringify(trailing)).toEqual(expected);
    }
  }, 120000);

  it("a hostile namespace is refused as a namespace, with no SQL anywhere in the answer", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const result = await search(interop, { namespace: "EXECMCPTMP391A' OR 1=1--" });

    expect(result.isError, textOf(result)).toBe(true);
    expect(textOf(result)).not.toMatch(/SQLCODE|SQL error|SELECT|Ens\.MessageHeader/i);
    expect(result.structuredContent?.["rows"], "a refusal returns no rows").toBeUndefined();
  }, 120000);
});

describe("Story 39.1 (QA): the audit trail of the built server names the action and the outcome (AC-6)", () => {
  it("records headers as ok, and body and searchTable as error, with each action named", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const dir = mkdtempSync(path.join(tmpdir(), "story-39-1-audit-"));
    const auditPath = path.join(dir, "audit.log");
    const audited = await openWireSession(wireOptions("iris-interop-mcp"), { IRIS_AUDIT_LOG: auditPath });
    try {
      expect(succeeded(await audited.call("iris_message_search", { action: "headers", namespace: NS_B, from: FROM, to: TO })).rows).toHaveLength(3);
      for (const action of ["body", "searchTable"]) {
        const refused = await audited.call("iris_message_search", { action, namespace: NS_B, from: FROM, to: TO });
        expect(refused.structuredContent).toMatchObject({ code: "NOT_IMPLEMENTED", action });
      }

      // The child process writes the log on its own schedule: wait, bounded, for the three entries.
      const deadline = Date.now() + 10000;
      let searches: Array<Record<string, unknown>> = [];
      while (Date.now() < deadline) {
        const text = existsSync(auditPath) ? readFileSync(auditPath, "utf8") : "";
        searches = text
          .split("\n")
          .filter((line) => line.trim() !== "")
          .map((line) => JSON.parse(line) as Record<string, unknown>)
          .filter((entry) => entry["tool"] === "iris_message_search");
        if (searches.length >= 3) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      expect(searches.map((entry) => [entry["action"], entry["outcome"]])).toEqual([
        ["headers", "ok"],
        ["body", "error"],
        ["searchTable", "error"],
      ]);
    } finally {
      await audited.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);
});
