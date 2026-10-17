/**
 * Story 39.7 live gate: the Epic 39 burn-down, driven on the REAL wire against a disposable Interoperability
 * namespace, in the default suite (rule #59: each row names the path it guards).
 *
 * Paths: the BUILT iris-dev-mcp, iris-admin-mcp and iris-interop-mcp dists, spawned as child processes and driven
 * by the MCP SDK `Client` over stdio. The oracles are raw HTTP to the Atelier routes (status and result), SQL
 * written by hand and run through the raw Atelier `action/query` route, and the texts the fixture's own seed writes,
 * never the tools under test. Five fixes are proven here:
 *
 *  - DW-569: every non-2xx answer is an error. Path: SDK `Client` -> built dev server -> `IrisHttpClient` -> the
 *    live Atelier route. The 2xx rows (a listing, a search with no match, a macro lookup in a known document) are
 *    successes equal to the raw Atelier result, and `iris_macro_info` with no document keeps its empty result.
 *  - DW-572: the header statements the route prepared carry the `%IGNOREINDEX` hint and their plans read the
 *    `TimeCreated` window. Path: SDK `Client` -> built interop server -> `iris_message_search` -> the search route ->
 *    `INFORMATION_SCHEMA.STATEMENTS` of the scratch namespace.
 *  - DW-576: under `block`, `iris_production_logs` and `iris_message_diagram` withhold message-derived text, and
 *    under `redact` and `allow` they are unchanged. Path: SDK `Client` -> built interop server (the default, an
 *    `allow` and a `block` profile, each writing an audit file) -> the Event Log and diagram routes.
 *  - DW-583: under `allow`, `iris_message_body` shows the text of a character-stream property, bounded by `maxChars`.
 *
 * Fixture nu (`interop-namespace-fixture.ts`, `seedBurnDown`): the mapping-only interop namespace
 * `EXECMCPTMP397A` (it also maps `HS` to HSLIB) holds four headers on 2001-02-03 UTC over three bodies (an
 * `HS.Message.XMLMessage` and two `Story397.StreamBody` objects) and two Event Log rows, saved directly. No
 * production is started and no message or Event Log row of HSCUSTOM is read. Every identifying value contains
 * `SYNTHPHI397`; the values that must survive contain `KEEPME397`. `beforeAll` removes leftovers by name and
 * asserts there are none; `afterAll` removes the namespace, its database files, the fixture class and the temp
 * files, and asserts nothing is left.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the namespace and database `EXECMCPTMP397A` and the HSCUSTOM class
 * `ExecuteMCPv2.Temp.Story391Fixture`; the dev rows read document names, search and macro metadata in HSCUSTOM, and
 * send one put of a document name with no type, which IRIS refuses and stores nothing. The fixture needs a
 * HealthShare or IRIS for Health instance: `HS.Message.XMLMessage` lives in the HSLIB database. A missing or stale dist, an unresolvable SDK or an unreachable IRIS skips each row with the reason, or fails with
 * "may not be skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allText,
  assertDeployedBootstrapVersion,
  atelierQuery,
  distEntry,
  fixtureDocumentNames,
  headerIds,
  irisTargetFromEnv,
  isIrisReachable,
  openAuditedSession,
  openWireSession,
  pollAuditEntries,
  postEnvelope,
  rawIrisRequest,
  resolveSdkEsmDir,
  skipTest,
  staleDistReason,
  teardownRecorder,
  type AuditedSession,
  type WireSession,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  FIXTURE_DOC,
  STORY397_IDS,
  createInteropNamespace,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
  seedBurnDown,
} from "./interop-namespace-fixture.js";
import { HEADER_INDEX_HINT, bodyJoinOracle, expectedRow, headerPlanProblems, oracleColumns, squash } from "./header-row-oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-39-7-burn-down-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The one scratch namespace: mapping-only interop plus the HS package, holding fixture nu. */
const NS_A = "EXECMCPTMP397A";
const NAMESPACES = [NS_A];

/** The window W: every header of fixture nu falls on 2001-02-03 between 12:00:01 and 12:00:04 UTC. */
const FROM = "2001-02-03T11:59:00Z";
const TO = "2001-02-03T12:01:00Z";
/** The window as the SQL the oracle uses: the stored form, both ends inclusive. */
const WINDOW_SQL = "h.TimeCreated >= '2001-02-03 11:59:00' AND h.TimeCreated <= '2001-02-03 12:01:00'";

/** Every identifying value contains this marker; nothing a withheld surface holds may. */
const MARKER = "SYNTHPHI397";

/** The bodies of fixture nu, written out from the spec table. */
const X1_TEXT = "<Patient><Name>SYNTHPHI397-XML</Name><Code>KEEPME397-CODE</Code></Patient>";
const S1_CONTENT = "<a>SYNTHPHI397-STREAM</a>\r\nline2\u0001KEEPME397-TAIL";
const S2_TAIL = "SYNTHPHI397-LONG-END";
const S2_LENGTH = 70000 + S2_TAIL.length;

/** The reasons, written by hand (not read from the shared module that the tools use). */
const EVENT_LOG_REASON = "The block data policy withholds Event Log text, which can carry message content.";
const DIAGRAM_REASON = "The block data policy withholds error text, which can carry message content.";
const BLOCK_BODY_REASON = "The block data policy withholds every message body.";
const PERSISTENT_REASON = "A persistent body cannot be redacted reliably, so the redact data policy withholds it.";

const BODY_ROUTE = "/interop/message/body";

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
/** The built interop server under default configuration (`redact`), under `allow` and under `block`, each writing an audit file. */
let redactS: AuditedSession;
let allowS: AuditedSession;
let blockS: AuditedSession;
/** The Atelier API version the instance serves, which the raw oracle routes use. */
let atelierApi = 0;
/** How long the first built-server start took, which includes the bootstrap deployment. */
let firstStartMs = 0;
const FIRST_START_BUDGET_MS = 60000;
let tempDir = "";

function wireOptions(pkg: string): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "story-39-7-live-gate",
  };
}

/** The target of the raw Atelier oracle: the scratch namespace. */
const oracleTarget = (): typeof TARGET => ({ ...TARGET, namespace: NS_A });

type Row = Record<string, unknown>;

/** The parsed structured content of a successful call: no error. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

/** The raw Atelier route `subpath` of `namespace` below the served API version. */
const atelierUrl = (namespace: string, subpath: string): string => `/api/atelier/v${atelierApi}/${namespace}/${subpath}`;

/** The names a raw docnames read of HSCUSTOM returns, and its status. */
async function docnames(category: string, type: string, filter: string): Promise<{ status: number; names: string[]; errors: unknown[] }> {
  const answer = await rawIrisRequest(
    TARGET,
    `${atelierUrl(TARGET.namespace, `docnames/${category}/${type}`)}?filter=${encodeURIComponent(filter)}`,
    { method: "GET" },
  );
  const body = answer.json as { status?: { errors?: unknown[] }; result?: { content?: Array<{ name: string }> } };
  return {
    status: answer.status,
    names: (body.result?.content ?? []).map((entry) => entry.name),
    errors: body.status?.errors ?? [],
  };
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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.7 live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  tempDir = mkdtempSync(path.join(tmpdir(), "story-39-7-gate-"));
  const started = performance.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  firstStartMs = Math.round(performance.now() - started);
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  await putFixtureClass(dev);
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);

  const served = (await rawIrisRequest(TARGET, "/api/atelier/", { method: "GET" })).json as {
    result?: { content?: { api?: number } };
  };
  atelierApi = Number(served.result?.content?.api ?? 0);
  expect(atelierApi, "the instance serves an Atelier API").toBeGreaterThanOrEqual(2);

  await createInteropNamespace(admin, dev, NS_A, { interop: true, hsLib: true });
  await seedBurnDown(dev, NS_A);

  // A positive control: the same check that must read empty after the run sees the namespace and its HS mapping now.
  expect(await leftovers(dev, NAMESPACES), `the leftovers check sees ${NS_A} while it exists`).toEqual(
    expect.arrayContaining([`namespace ${NS_A}`, `database configuration ${NS_A}`, `package mapping ${NS_A} HS`]),
  );

  redactS = await openAuditedSession({ ...wireOptions("iris-interop-mcp"), auditFile: path.join(tempDir, "audit-redact.jsonl") });
  allowS = await openAuditedSession(
    { ...wireOptions("iris-interop-mcp"), auditFile: path.join(tempDir, "audit-allow.jsonl") },
    { IRIS_DATA_POLICY: "allow" },
  );
  blockS = await openAuditedSession(
    { ...wireOptions("iris-interop-mcp"), auditFile: path.join(tempDir, "audit-block.jsonl") },
    { IRIS_DATA_POLICY: "block" },
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
    await attempt("removing the temp files", async () => {
      if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    });
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story397", "Story391Fixture"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [redactS?.session, allowS?.session, blockS?.session, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- DW-569 -------------------------------------------------------------

describe("Story 39.7: DW-569, every non-2xx answer is an error on the real wire (AC-1, AC-2)", () => {
  it("the first built-server start, which includes the armed bootstrap, stays under its 60 s budget", (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // eslint-disable-next-line no-console
    console.log(`[PERF] story-39-7: the first built-server start took ${firstStartMs} ms (budget ${FIRST_START_BUDGET_MS} ms)`);
    expect(firstStartMs).toBeLessThan(FIRST_START_BUDGET_MS);
  });

  it("the 400 pair: the plain-fetch controls read HTTP 400 with no error list, and iris_doc_list on the built dev server is an error naming HTTP 400 and the route", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const wire = await docnames("CLS", "cls", "%Library.Base");
    const wireRtn = await docnames("RTN", "cls", "%occ");
    expect(wire, "control: the old description's CLS example is a 400 with an empty error list").toMatchObject({ status: 400, errors: [] });
    expect(wireRtn, "control: the RTN example is a 400 with an empty error list").toMatchObject({ status: 400, errors: [] });

    const cls = await dev.call("iris_doc_list", { category: "CLS", type: "cls", filter: "%Library.Base" });
    expect(cls.isError, allText(cls)).toBe(true);
    expect(allText(cls)).toContain("HTTP 400");
    expect(allText(cls)).toContain("docnames/CLS/cls");

    const rtn = await dev.call("iris_doc_list", { category: "RTN", type: "cls", filter: "%occ" });
    expect(rtn.isError, allText(rtn)).toBe(true);
    expect(allText(rtn)).toContain("HTTP 400");
    expect(allText(rtn)).toContain("docnames/RTN/cls");
  }, 120000);

  it("a document name IRIS refuses (HTTP 400, no error list, reason in result.status) keeps IRIS's reason in iris_doc_get and iris_doc_put, and a put stores nothing", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const readName = "ExecuteMCPv2.Utils";
    const putName = "ExecuteMCPv2.Temp.Story397NoType";
    const raw = await rawIrisRequest(TARGET, atelierUrl(TARGET.namespace, `doc/${encodeURIComponent(readName)}`), { method: "GET" });
    const reason = `ERROR #16006: Document '${readName}' name is invalid`;
    expect(raw.status, "control: a name with no document type is a 400").toBe(400);
    expect((raw.json as { status: { errors: unknown[] }; result: { status: string } }).status.errors).toEqual([]);
    expect((raw.json as { result: { status: string } }).result.status).toBe(reason);

    const read = await dev.call("iris_doc_get", { name: readName });
    expect(read).toStrictEqual({
      content: [
        {
          type: "text",
          text: `Document '${readName}' could not be read in namespace '${TARGET.namespace}': ${reason}. Check the document name and namespace, then retry.`,
        },
      ],
      isError: true,
    });

    const put = await dev.call("iris_doc_put", { name: putName, content: "Class ExecuteMCPv2.Temp.Story397NoType {}" });
    expect(put.isError, allText(put)).toBe(true);
    expect(allText(put)).toBe(
      `Document '${putName}' was not saved in namespace '${TARGET.namespace}': ERROR #16006: Document '${putName}' name is invalid. Nothing was stored; correct the document text and retry.`,
    );
    for (const { filter, names } of await fixtureDocumentNames(dev, ["Story397NoType"])) {
      expect(names, `no document named like ${filter} was stored`).toEqual([]);
    }
  }, 120000);

  it("the 2xx rows are unchanged: a listing, a search with no match and a macro lookup in a known document are successes equal to the raw Atelier result", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const listing = await dev.call("iris_doc_list", { category: "CLS", filter: "%Library.Base" });
    const wire = await docnames("CLS", "*", "%Library.Base");
    expect(wire.status).toBe(200);
    const items = succeeded<{ items: Array<string | { name: string }> }>(listing).items.map((item) => (typeof item === "string" ? item : item.name));
    expect(items, "the class every IRIS ships is listed").toContain("%Library.Base.cls");
    expect(items, "the first page is the head of the raw list").toEqual(wire.names.slice(0, items.length));

    const search = await dev.call("iris_doc_search", { query: "ZZZNOPE397", files: "ExecuteMCPv2.Utils.cls" });
    const rawSearch = await rawIrisRequest(
      TARGET,
      `${atelierUrl(TARGET.namespace, "action/search")}?query=ZZZNOPE397&regex=0&word=0&case=0&wild=0&files=ExecuteMCPv2.Utils.cls`,
      { method: "GET" },
    );
    expect(rawSearch.status, "control: a search with no match is a 200").toBe(200);
    expect(succeeded<{ matches: unknown[] }>(search)).toEqual({ matches: [] });
    expect((rawSearch.json as { result?: unknown }).result).toEqual([]);

    const macro = await dev.call("iris_macro_info", { name: "NOPEZZZ397", document: "%Library.Base.cls" });
    const macroBody = { docname: "%Library.Base.cls", macroname: "NOPEZZZ397", includes: [] };
    const rawDefinition = await rawIrisRequest(TARGET, atelierUrl(TARGET.namespace, "action/getmacrodefinition"), { method: "POST", body: macroBody });
    const rawLocation = await rawIrisRequest(TARGET, atelierUrl(TARGET.namespace, "action/getmacrolocation"), { method: "POST", body: macroBody });
    expect(rawDefinition.status, "control: a macro lookup in a known document is a 200").toBe(200);
    expect(rawLocation.status).toBe(200);
    expect(succeeded<Row>(macro)).toEqual({
      name: "NOPEZZZ397",
      definition: (rawDefinition.json as { result: unknown }).result,
      location: (rawLocation.json as { result: unknown }).result,
    });
  }, 120000);

  it("an empty search query is an error naming HTTP 400, where the raw route confirms it is a 400", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const raw = await rawIrisRequest(
      TARGET,
      `${atelierUrl(TARGET.namespace, "action/search")}?query=&regex=0&word=0&case=0&wild=0&files=ExecuteMCPv2.Utils.cls`,
      { method: "GET" },
    );
    expect(raw.status, "control: an empty query is a 400").toBe(400);

    const result = await dev.call("iris_doc_search", { query: "", files: "ExecuteMCPv2.Utils.cls" });
    expect(result.isError, allText(result)).toBe(true);
    expect(allText(result)).toContain("HTTP 400");
  }, 120000);

  it("iris_macro_info with no document keeps today's empty result (OD-2), while the raw route reads HTTP 400", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const action of ["getmacrodefinition", "getmacrolocation"]) {
      const raw = await rawIrisRequest(TARGET, atelierUrl(TARGET.namespace, `action/${action}`), {
        method: "POST",
        body: { docname: "", macroname: "OK", includes: [] },
      });
      expect(raw.status, `control: ${action} with no document is a 400`).toBe(400);
    }

    const expected = { name: "OK", definition: {}, location: {} };
    const result = await dev.call("iris_macro_info", { name: "OK" });
    expect(succeeded<Row>(result)).toEqual(expected);
    expect(result.content?.[0]?.text).toBe(JSON.stringify(expected, null, 2));
    const emptyDocument = await dev.call("iris_macro_info", { name: "OK", document: "" });
    expect(succeeded<Row>(emptyDocument)).toEqual(expected);
  }, 120000);
});

// -- DW-572 -------------------------------------------------------------

/** A `headers` or `body` search of the scratch namespace over W through the default session; `args` adds any field. */
function search(args: Record<string, unknown>): Promise<WireToolResult> {
  return redactS.session.call("iris_message_search", { namespace: NS_A, from: FROM, to: TO, ...args });
}

interface SearchContent {
  action: string;
  rows: Row[];
  hasMore: boolean;
  nextCursor?: string;
}

/** The rows the oracle selects in W, written in SQL by hand (`extra` starts with ` AND `). */
async function headerOracle(extra = ""): Promise<Row[]> {
  const rows = await atelierQuery(
    oracleTarget(),
    `SELECT ${oracleColumns("h")} FROM Ens.MessageHeader h WHERE ${WINDOW_SQL}${extra} ORDER BY h.TimeCreated, h.ID`,
  );
  return rows.map(expectedRow);
}

const ITEM_ROUTER = "(h.SourceConfigName = 'Story397.Router' OR h.TargetConfigName = 'Story397.Router')";

describe("Story 39.7: DW-572, the header statements read the window and carry the index hint (AC-4)", () => {
  it("the checker can fail: a statement without the hint, a bitmap of Status, Source or Target, or a plan without the TimeCreated range is reported", (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const goodStatement = `SELECT TOP ? ID, SessionId FROM ${HEADER_INDEX_HINT} Ens.MessageHeader WHERE TimeCreated >= ?`;
    const goodPlan = "Read index map Ens.MessageHeader.TimeCreated, looping on TimeCreated (with a range condition) and ID.";
    const badPlan =
      "((bitmap index Ens.MessageHeader.Status) INTERSECT ((bitmap index Ens.MessageHeader.SourceConfigName) UNION (bitmap index Ens.MessageHeader.TargetConfigName)))";
    expect(headerPlanProblems(goodStatement, goodPlan), "a well-formed statement and plan").toEqual([]);
    expect(
      headerPlanProblems(goodStatement, "Read index map Ens.MessageHeader(H).TimeCreated, looping on H.TimeCreated (with a range condition) and H.ID."),
      "the aliased form",
    ).toEqual([]);
    expect(headerPlanProblems(goodStatement.replace(HEADER_INDEX_HINT, ""), goodPlan).length, "no hint").toBeGreaterThan(0);
    expect(headerPlanProblems(goodStatement.replace(",Ens.MessageHeader.TargetConfigName", ""), goodPlan).length, "a hint without TargetConfigName").toBeGreaterThan(0);
    expect(headerPlanProblems(goodStatement, badPlan).length, "the history-wide bitmap plan").toBeGreaterThan(0);
    expect(headerPlanProblems(goodStatement, `${goodPlan}\n${badPlan}`).length, "a bitmap next to the range read").toBeGreaterThan(0);
    expect(headerPlanProblems(goodStatement, "Read master map Ens.MessageHeader.IDKEY, looping on ID.").length, "no TimeCreated range").toBeGreaterThan(0);
  });

  it("headers calls over W equal the oracle row for row, for every filter shape of the burn-down, and a cursor page continues them", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const calls: Array<{ name: string; args: Record<string, unknown>; extra: string; expectedIds?: number[] }> = [
      { name: "item and status", args: { item: "Story397.Router", status: "Completed" }, extra: ` AND ${ITEM_ROUTER} AND h.Status = 9`, expectedIds: [1, 2] },
      { name: "status only", args: { status: "Completed" }, extra: " AND h.Status = 9", expectedIds: [1, 2, 3] },
      { name: "source only", args: { source: "Story397.Service" }, extra: " AND h.SourceConfigName = 'Story397.Service'", expectedIds: [1, 3] },
      {
        name: "body class, status and error-only",
        args: { bodyClass: "Story397.StreamBody", status: "Completed", errorOnly: true },
        extra: " AND h.MessageBodyClassName = 'Story397.StreamBody' AND h.Status = 9 AND h.IsError = 1",
        expectedIds: [],
      },
      {
        name: "body class and status",
        args: { bodyClass: "Story397.StreamBody", status: "Completed" },
        extra: " AND h.MessageBodyClassName = 'Story397.StreamBody' AND h.Status = 9",
        expectedIds: [2, 3],
      },
      { name: "session", args: { sessionId: 397001 }, extra: " AND h.SessionId = 397001", expectedIds: [1, 2] },
      { name: "window only", args: {}, extra: "", expectedIds: [1, 2, 3, 4] },
    ];
    for (const call of calls) {
      const content = succeeded<SearchContent>(await search({ action: "headers", ...call.args }));
      const expected = await headerOracle(call.extra);
      expect(headerIds(expected), `${call.name}: the oracle selects the rows written by hand`).toEqual(call.expectedIds);
      expect(content.rows, `${call.name}: every field of every row, in order`).toEqual(expected);
      expect(content.hasMore).toBe(false);
    }

    // A page after nextCursor: one row per page walks the whole window in order, and the pages join the oracle's list.
    const pages: Row[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 6; guard += 1) {
      const page = succeeded<SearchContent>(await search({ action: "headers", limit: 1, ...(cursor === undefined ? {} : { cursor }) }));
      pages.push(...page.rows);
      if (!page.hasMore) break;
      cursor = page.nextCursor;
      expect(cursor, "a page with more rows names its cursor").toEqual(expect.any(String));
    }
    expect(pages, "the pages joined").toEqual(await headerOracle());
  }, 180000);

  it("a body search with an item and a status equals the JOIN oracle", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded<SearchContent>(
      await search({
        action: "body",
        bodyClass: "Story397.StreamBody",
        filters: [{ property: "Name", op: "eq", value: "KEEPME397-S1" }],
        item: "Story397.Router",
        status: "Completed",
      }),
    );
    const expected = await bodyJoinOracle(
      TARGET,
      NS_A,
      '"Story397"."StreamBody"',
      "Story397.StreamBody",
      WINDOW_SQL,
      "b.\"Name\" = 'KEEPME397-S1'",
      ` AND ${ITEM_ROUTER} AND h.Status = 9`,
    );
    expect(headerIds(expected), "the oracle selects the row written by hand").toEqual([2]);
    expect(content.rows).toEqual(expected);
  }, 120000);

  it("after real calls, every route statement for the headers and the body join holds the hint and passes headerPlanProblems", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // The shapes of the burn-down, through the built server (headers) and one body call, so the statements are the tool's own.
    for (const args of [
      { item: "Story397.Router", status: "Completed" },
      { status: "Completed" },
      { source: "Story397.Service" },
      { bodyClass: "Story397.StreamBody", status: "Completed", errorOnly: true },
      { sessionId: 397001 },
      {},
    ]) {
      succeeded<SearchContent>(await search({ action: "headers", ...args }));
    }
    const firstPage = succeeded<SearchContent>(await search({ action: "headers", limit: 1 }));
    succeeded<SearchContent>(await search({ action: "headers", limit: 1, cursor: firstPage.nextCursor }));
    succeeded<SearchContent>(
      await search({
        action: "body",
        bodyClass: "Story397.StreamBody",
        filters: [{ property: "Name", op: "eq", value: "KEEPME397-S1" }],
        item: "Story397.Router",
        status: "Completed",
      }),
    );

    const stored = await atelierQuery(oracleTarget(), "SELECT Statement, Plan FROM INFORMATION_SCHEMA.STATEMENTS WHERE Statement [ 'MESSAGEHEADER'");
    const routeHeaders = stored.filter((row) => squash(String(row["Statement"])).includes("SELECTTOP?ID,SESSIONID,"));
    const routeJoins = stored.filter((row) => squash(String(row["Statement"])).includes("SELECTTOP?H.ID,"));
    expect(routeHeaders.length, "the index holds the unaliased headers statements of the calls").toBeGreaterThanOrEqual(2);
    expect(routeJoins.length, "the index holds the aliased statement of the body call").toBeGreaterThanOrEqual(1);

    for (const row of [...routeHeaders, ...routeJoins]) {
      expect(headerPlanProblems(String(row["Statement"]), String(row["Plan"])), String(row["Statement"])).toEqual([]);
    }
    for (const row of routeJoins) {
      const text = squash(String(row["Statement"]));
      expect(text, "the join statement reads the headers first, with the hint after %INORDER").toContain(squash(`FROM %INORDER ${HEADER_INDEX_HINT} Ens.MessageHeader h`));
      const lines = String(row["Plan"]).split(/\r?\n/).map((line) => line.trim());
      const header = lines.findIndex((line) => /Ens\.MessageHeader\(H\)/.test(line));
      const body = lines.findIndex((line) => /Story397\.StreamBody\(B\)/.test(line));
      expect(header, "the plan reads the header maps").toBeGreaterThanOrEqual(0);
      expect(body, "the plan reads the body table").toBeGreaterThanOrEqual(0);
      expect(header, "the header maps are read before the body").toBeLessThan(body);
    }
  }, 180000);
});

// -- DW-576 -------------------------------------------------------------

interface LogsContent {
  entries: Row[];
  count: number;
  dataPolicy?: { policy: string; redacted: number; blocked: number };
}

interface DiagramContent {
  diagrams: Array<{ sessionId: number; mermaid: string; warnings: string[]; messageCount: number }>;
  count: number;
  dataPolicy?: { policy: string; redacted: number; blocked: number };
}

/**
 * The Event Log rows of the scratch namespace, newest first, as the tool maps them (an optional key only when it holds
 * a value). The raw Atelier query route renders a SQL NULL integer as 0, so whether `SessionId` is NULL is read from its
 * own column, `SessionIsNull`.
 */
async function logOracle(): Promise<Row[]> {
  const rows = await atelierQuery(
    oracleTarget(),
    "SELECT ID, TimeLogged, Type, ConfigName, Text, SourceClass, SourceMethod, SessionId, " +
      "CASE WHEN SessionId IS NULL THEN 1 ELSE 0 END AS SessionIsNull FROM Ens_Util.Log ORDER BY ID DESC",
  );
  const present = (value: unknown): boolean => value !== null && value !== undefined && String(value) !== "";
  return rows.map((row) => {
    const entry: Row = {
      id: Number(row["ID"]),
      timestamp: row["TimeLogged"],
      type: row["Type"],
      itemName: row["ConfigName"],
      text: row["Text"],
    };
    if (present(row["SourceClass"])) entry["sourceClass"] = row["SourceClass"];
    if (present(row["SourceMethod"])) entry["sourceMethod"] = row["SourceMethod"];
    if (Number(row["SessionIsNull"]) !== 1) entry["sessionId"] = Number(row["SessionId"]);
    return entry;
  });
}

function productionLogs(session: WireSession): Promise<WireToolResult> {
  return session.call("iris_production_logs", { namespace: NS_A, count: 10 });
}

function messageDiagram(session: WireSession): Promise<WireToolResult> {
  return session.call("iris_message_diagram", { namespace: NS_A, sessionIds: [397002] });
}

describe("Story 39.7: DW-576, iris_production_logs and iris_message_diagram under the data policy (AC-5)", () => {
  it("logs under redact and allow equal the Atelier SQL oracle with the text shown, no dataPolicy and no textPolicy, and the two results are equal", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const oracle = await logOracle();
    expect(oracle.map((entry) => entry["id"]), "the oracle holds the two rows, newest first").toEqual([2, 1]);

    const redact = await productionLogs(redactS.session);
    const allow = await productionLogs(allowS.session);
    for (const [label, result] of [["redact", redact], ["allow", allow]] as const) {
      const content = succeeded<LogsContent>(result);
      expect(content.entries, `${label}: the entries equal the oracle`).toEqual(oracle);
      expect(content.count).toBe(2);
      expect(Object.keys(content), `${label}: no dataPolicy key`).toEqual(["entries", "count"]);
      expect(JSON.stringify(result), `${label}: no textPolicy`).not.toContain("textPolicy");
      expect(JSON.stringify(result), `${label}: the text is shown (the positive control)`).toContain("SYNTHPHI397-LOG-1");
    }
    expect(redact.structuredContent).toEqual(allow.structuredContent);
    expect(redact.content).toEqual(allow.content);
  }, 120000);

  it("logs under block: no entry has text, each has textPolicy with the fixed reason, the other fields equal the oracle, dataPolicy counts 2, and no SYNTHPHI397 is anywhere", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const oracle = await logOracle();

    const result = await productionLogs(blockS.session);
    const content = succeeded<LogsContent>(result);
    expect(content.entries).toHaveLength(2);
    content.entries.forEach((entry, index) => {
      const { text: _withheld, ...rest } = oracle[index] as Row;
      void _withheld;
      expect("text" in entry, `entry ${index}: no text`).toBe(false);
      expect(entry["textPolicy"], `entry ${index}: textPolicy`).toEqual({ outcome: "blocked", reason: EVENT_LOG_REASON });
      const { textPolicy: _policy, ...others } = entry;
      void _policy;
      expect(others, `entry ${index}: the other fields equal the oracle`).toEqual(rest);
    });
    expect(content.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 2 });
    expect(JSON.stringify(result.content), "content holds no identifying value").not.toContain(MARKER);
    expect(JSON.stringify(result.structuredContent), "structuredContent holds no identifying value").not.toContain(MARKER);
    expect(JSON.stringify(result), "nor does the surviving value of the other entry").not.toContain("KEEPME397-LOG-2");
  }, 120000);

  it("a diagram under redact and allow holds the error warning and its Mermaid line, with no dataPolicy, and the two results are equal", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const redact = await messageDiagram(redactS.session);
    const allow = await messageDiagram(allowS.session);
    for (const [label, result] of [["redact", redact], ["allow", allow]] as const) {
      const content = succeeded<DiagramContent>(result);
      expect(Object.keys(content), `${label}: no dataPolicy key`).toEqual(["diagrams", "count"]);
      const warning = content.diagrams[0]?.warnings.find((candidate) => candidate.startsWith("Error on message 4: ")) ?? "";
      expect(warning, `${label}: the error warning of header 4`).toContain("SYNTHPHI397-ERR");
      const mermaid = content.diagrams[0]?.mermaid ?? "";
      expect(
        mermaid.split("\n").some((line) => /^\s*%% Error on message 4: .*SYNTHPHI397-ERR/.test(line)),
        `${label}: the Mermaid text holds it on a %% line`,
      ).toBe(true);
    }
    expect(redact.structuredContent).toEqual(allow.structuredContent);
    expect(redact.content).toEqual(allow.content);
  }, 120000);

  it("a diagram under block: the warning is the prefix plus the fixed reason, the Mermaid line follows, the rest of the text is unchanged, dataPolicy counts 1, and no SYNTHPHI397 is anywhere", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const redact = succeeded<DiagramContent>(await messageDiagram(redactS.session));
    const result = await messageDiagram(blockS.session);
    const content = succeeded<DiagramContent>(result);

    const warning = `Error on message 4: ${DIAGRAM_REASON}`;
    expect(content.diagrams[0]?.warnings.filter((candidate) => candidate.startsWith("Error on message ")), "exactly the one error warning").toEqual([warning]);
    const lines = (content.diagrams[0]?.mermaid ?? "").split("\n");
    const errorLine = lines.find((line) => /%% Error on message 4: /.test(line)) ?? "";
    expect(errorLine, "the Mermaid line is its indent, %% and the warning").toMatch(/^\s*%% /);
    expect(errorLine.trimStart()).toBe(`%% ${warning}`);
    const without = (text: string): string => text.split("\n").filter((line) => !/%% Error on message 4: /.test(line)).join("\n");
    expect(without(content.diagrams[0]?.mermaid ?? ""), "the Mermaid text with that line removed equals redact's with its line removed").toBe(
      without(redact.diagrams[0]?.mermaid ?? ""),
    );
    expect(content.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 1 });
    expect(JSON.stringify(result), "no identifying value anywhere in the result").not.toContain(MARKER);
  }, 120000);

  it("the audit entries carry the policy and the counts, and no audit file and no stderr holds SYNTHPHI397", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const expected: Array<[string, AuditedSession, { policy: string; redacted: number; blocked: number }, { policy: string; redacted: number; blocked: number }]> = [
      ["block", blockS, { policy: "block", redacted: 0, blocked: 2 }, { policy: "block", redacted: 0, blocked: 1 }],
      ["redact", redactS, { policy: "redact", redacted: 0, blocked: 0 }, { policy: "redact", redacted: 0, blocked: 0 }],
      ["allow", allowS, { policy: "allow", redacted: 0, blocked: 0 }, { policy: "allow", redacted: 0, blocked: 0 }],
    ];
    for (const [label, session, logsPolicy, diagramPolicy] of expected) {
      await productionLogs(session.session);
      await messageDiagram(session.session);
      const logs = await pollAuditEntries(session.auditFile, { tool: "iris_production_logs", count: 1, intervalMs: 50, timeoutMs: 10000, excerpt: 3000 });
      const diagrams = await pollAuditEntries(session.auditFile, { tool: "iris_message_diagram", count: 1, intervalMs: 50, timeoutMs: 10000, excerpt: 3000 });
      expect(logs.at(-1), `${label}: the logs entry`).toMatchObject({ outcome: "ok", dataPolicy: logsPolicy });
      expect(diagrams.at(-1), `${label}: the diagram entry`).toMatchObject({ outcome: "ok", dataPolicy: diagramPolicy });
    }
    for (const [label, session] of [["block", blockS], ["redact", redactS], ["allow", allowS]] as const) {
      expect(session.stderr().length, `${label}: the server wrote to stderr at LOG_LEVEL=DEBUG`).toBeGreaterThan(0);
      expect(readFileSync(session.auditFile, "utf8"), `${label}: the audit file`).not.toContain(MARKER);
      expect(session.stderr(), `${label}: the server's stderr`).not.toContain(MARKER);
    }
  }, 180000);
});

// -- DW-583 -------------------------------------------------------------

interface BodyContent {
  items: Row[];
  count: number;
  maxChars: number;
  dataPolicy: { policy: string; redacted: number; blocked: number };
}

const itemOf = (content: BodyContent, id: number): Row => content.items.find((item) => item["id"] === id) as Row;

function readBodies(session: WireSession, headerIdList: number[], args: Record<string, unknown> = {}): Promise<WireToolResult> {
  return session.call("iris_message_body", { namespace: NS_A, headerIds: headerIdList, ...args });
}

/** The JSON a persistent body item shows, parsed. */
const jsonOf = (item: Row): Record<string, Record<string, unknown>> => JSON.parse(String(item["text"])) as Record<string, Record<string, unknown>>;

describe("Story 39.7: DW-583, a character stream is shown under allow, bounded by maxChars (AC-7)", () => {
  it("allow: the XML message shows its ContentStream text, the stream body shows its text with the control characters escaped, and the binary stream stays class and size", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    expect(STORY397_IDS.stream, "the setup is the seed's own").toBe("1,2");
    const content = succeeded<BodyContent>(await readBodies(allowS.session, [1, 2, 3]));
    expect(content.dataPolicy).toEqual({ policy: "allow", redacted: 0, blocked: 0 });

    const x1 = itemOf(content, 1);
    expect(x1).toMatchObject({ format: "json", truncated: false });
    expect(jsonOf(x1)["ContentStream"]).toEqual({ stream: "%Stream.GlobalCharacter", size: X1_TEXT.length, text: X1_TEXT });

    const s1 = itemOf(content, 2);
    expect(s1).toMatchObject({ format: "json", truncated: false });
    const parsed = jsonOf(s1);
    expect(parsed["Content"]?.["text"], "CR LF and U+0001 survive as JSON escapes").toBe(S1_CONTENT);
    expect(parsed["Content"]?.["size"]).toBe(S1_CONTENT.length);
    expect(/[\u0000-\u001f\u007f]/.test(String(s1["text"])), "the shown text holds no raw C0 character").toBe(false);
    expect(parsed["Blob"], "the binary stream is class and size, with no text").toEqual({ stream: "%Stream.GlobalBinary", size: 16 });
    expect(parsed["Second"]?.["text"]).toBe("KEEPME397-SECOND");
    expect(parsed["Name"]).toBe("KEEPME397-S1");

    const s2 = itemOf(content, 3);
    expect(s2, "the 70,000-character stream is cut at the default maxChars").toMatchObject({ format: "json", truncated: true });
    expect(String(s2["text"]).length).toBe(10000);
    expect(String(s2["text"])).not.toContain(S2_TAIL);
  }, 120000);

  it("allow with a larger maxChars reads the long stream to its end, and the second stream after it", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded<BodyContent>(await readBodies(allowS.session, [3], { maxChars: 100000 }));
    const s2 = itemOf(content, 3);
    expect(s2).toMatchObject({ format: "json", truncated: false });
    const parsed = jsonOf(s2);
    expect(String(parsed["Content"]?.["text"]).endsWith(S2_TAIL), "the long text ends with its tail").toBe(true);
    expect(parsed["Content"]?.["size"]).toBe(S2_LENGTH);
    expect(parsed["Second"]?.["text"]).toBe("SYNTHPHI397-SECOND-2");
  }, 120000);

  it("redact and block withhold the stream bodies: no SYNTHPHI397 reaches a result, and the raw route returns no body text", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const redact = await readBodies(redactS.session, [1, 2, 3]);
    const redacted = succeeded<BodyContent>(redact);
    for (const id of [1, 2, 3]) {
      const item = itemOf(redacted, id);
      expect(item["bodyPolicy"], `redact: header ${id}`).toEqual({ outcome: "blocked", reason: PERSISTENT_REASON });
      expect(item["text"], `redact: header ${id} has no text`).toBeUndefined();
    }
    expect(JSON.stringify(redact), "redact: no identifying value").not.toContain(MARKER);

    const block = await readBodies(blockS.session, [1, 2, 3]);
    const blocked = succeeded<BodyContent>(block);
    for (const id of [1, 2, 3]) {
      const item = itemOf(blocked, id);
      expect(item["bodyPolicy"], `block: header ${id}`).toEqual({ outcome: "blocked", reason: BLOCK_BODY_REASON });
      expect(item["text"], `block: header ${id} has no text`).toBeUndefined();
    }
    expect(JSON.stringify(block), "block: no identifying value").not.toContain(MARKER);

    // The raw route, past every MCP-layer check: a read that may touch HL7 only, and a read of the kind only, return no text.
    for (const bodyRead of ["hl7", "kind"]) {
      const answer = await postEnvelope(TARGET, BODY_ROUTE, { headerIds: [1, 2, 3], namespace: NS_A, bodyRead });
      expect(answer.errors, `bodyRead ${bodyRead}: ${answer.text}`).toEqual([]);
      const items = answer.result["items"] as Row[];
      expect(items, `bodyRead ${bodyRead}: three items`).toHaveLength(3);
      for (const item of items) expect(item["bodyText"], `bodyRead ${bodyRead}: no bodyText`).toBeUndefined();
      expect(answer.text, `bodyRead ${bodyRead}: the raw answer holds no identifying value`).not.toContain(MARKER);
    }
    // The positive control: the route does return the stream text when it is told it may.
    const open = await postEnvelope(TARGET, BODY_ROUTE, { headerIds: [2], namespace: NS_A, bodyRead: "all", bodyTextMaxChars: 20000 });
    expect(open.text, "bodyRead all returns the stream text (the positive control)").toContain("SYNTHPHI397-STREAM");
  }, 120000);
});
