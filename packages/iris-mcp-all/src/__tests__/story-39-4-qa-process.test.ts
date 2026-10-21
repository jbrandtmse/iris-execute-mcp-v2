/**
 * Story 39.4 (QA) - the Search Table lookup and its PHI data policy on the BUILT interop server, where the
 * in-process suites and the live gate stop short (AC-2, AC-5; AD-9, AD-19, AD-26; Rules #36, #54, #59).
 *
 * The BUILT iris-interop-mcp dist is spawned over stdio and pointed at a local HTTP listener that stands in for
 * IRIS: it records every request and answers the search route with a reply the test controls. No IRIS instance is
 * contacted. That makes four properties observable where they happen, which the live gate reaches only through a
 * well-behaved IRIS (the replies) and the unit suites only through mocks (the request):
 *
 *  - `block` (operator-wide, per profile, and from the governance file) refuses the searchTable action before any
 *    request reaches an ExecuteMCPv2 route on the listener (the server's own connection and bootstrap traffic goes
 *    to /api/atelier/ on its own schedule and is not counted), whatever else is wrong with the call, while
 *    `headers` on the same session still sends its request (the positive control that the listener sees what is
 *    sent). The window and the misplaced-parameter checks come first and are validation errors, not refusals;
 *  - `redact` and `allow` send the lookup to IRIS exactly as given (numbers, booleans, quotes, a backslash, a
 *    question mark and non-ASCII text survive the real HTTP client; the class, the scope filters and the cursor
 *    position are all on the wire), and nothing else of the caller's input;
 *  - a reply padded with Search Table and body content (a stored value in extra row fields, an echo of the
 *    filters, extra result fields) comes out as the 14 header-row fields and the named result fields only, in
 *    text and in structured content, and both `notApplicable` answers hold no rows however many the reply carries;
 *  - the audit file and the console log of a session at DEBUG hold neither the padded reply nor, under `redact`,
 *    `block` and for an unresolved profile, a filter value; `allow` logs the filters (the positive control); the
 *    `dataPolicy` field belongs to the searchTable entry and not to the `headers` entry of the same file.
 *
 * Expected values come from the Story 39.4 intent contract, never from the implementation (Rule #36). A padded
 * reply is what a version-skewed, patched or hostile IRIS could send: the real route never sends one, so these
 * rows pin the tool's own mapping (defense in depth, AD-26), and the live gate pins what the real route sends.
 * Placement (Rule #45): `@iris-mcp/all` is the only package that depends on every server's built dist. A missing
 * or stale `shared` or `iris-interop-mcp` dist, or an unresolvable SDK, skips each test with the reason, or fails
 * when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allText,
  openWireSession,
  pollAuditEntries,
  resolveSdkEsmDir,
  routeRequests,
  skipIfReason,
  staleDistReason,
  startRouteStub,
  stubEnvelope,
  stubTarget,
  writeJson,
  type RecordedRequest,
  type RouteStub,
  type WireSession,
  type WireSessionOptions,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const INTEROP_ENTRY = path.join(REPO_ROOT, "packages", "iris-interop-mcp", "dist", "index.js");

const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** A WARN or DEBUG line is not logged under LOG_LEVEL=ERROR, which a developer shell may set. */
const SERVER_LOG_LEVEL = "DEBUG";

/** A Search Table or body value a padded reply carries: it must reach no output of a governed call. */
const SENTINEL = "SYNTHPHI394";
/** Appears only in the filter values the caller sends: it must reach no response and, under redact and block, no log. */
const FILTER_TOKEN = "QAFILTER394";

/** The namespace the calls name. The listener answers whatever it is asked, so no IRIS namespace is involved. */
const NS = "STORY394QA";
const SEARCH_TABLE_CLASS = "EnsLib.HL7.SearchTable";
const BODY_CLASS = "EnsLib.HL7.Message";
const SEARCH_ROUTE = "/api/executemcp/v2/interop/message/search";

type Item = Record<string, unknown>;

/** Every kind of value the wire carries: strings with quotes, a backslash, a question mark and non-ASCII text, a number, a boolean, no value. */
const FILTERS: Array<Record<string, unknown>> = [
  { property: "PatientID", op: "eq", value: `MRN-${FILTER_TOKEN}` },
  { property: "Story394Int", op: "ne", value: 12 },
  { property: "Flag", op: "eq", value: true },
  { property: "PatientAcct", op: "notNull" },
  { property: "PatientName", op: "contains", value: `é中 "q" \\ ? ${FILTER_TOKEN}` },
];

const FROM = "2001-02-03T07:00:00Z";
const TO = "2001-02-03T09:00:00Z";

/** The arguments of a valid Search Table lookup, aimed at the namespace NS. */
const SEARCH = { action: "searchTable", namespace: NS, from: FROM, to: TO, searchTableClass: SEARCH_TABLE_CLASS, filters: FILTERS };

/** The request the server must send for SEARCH under redact and allow: the caller's fields, the window canonical, the default limit. */
const WIRE_BODY = {
  action: "searchTable",
  from: FROM,
  to: TO,
  limit: 100,
  namespace: NS,
  searchTableClass: SEARCH_TABLE_CLASS,
  filters: FILTERS,
};

/** The refusal text of the spec (Task 2, handler step 3), word for word. */
const BLOCKED_TEXT =
  "The block data policy withholds message body data, and a Search Table lookup reveals values taken from " +
  "message bodies, so the searchTable action is refused. Use the headers action, or ask the operator for a " +
  "looser IRIS_DATA_POLICY for this profile.";

// -- The listener ----------------------------------------------------------------------------------------------

/** The search POSTs the listener has recorded. */
const searchesOf = (s: RouteStub): RecordedRequest[] => s.requests.filter((r) => r.method === "POST" && r.url === SEARCH_ROUTE);

/** A header row exactly as the route returns it. */
const ROW: Item = {
  id: 1,
  sessionId: 394001,
  type: "Request",
  status: "Completed",
  isError: false,
  sourceItem: "Story394.Source",
  targetItem: "Story394.Target",
  bodyClassName: BODY_CLASS,
  bodyId: "1",
  timeCreated: "2001-02-03 08:00:00",
  timeProcessed: "",
  correspondingMessageId: null,
};

/** The 14 fields the tool maps a header row to (spec: the shared header-row shape, times with a ...Raw sibling). */
const ROW_FIELDS = [
  "bodyClassName", "bodyId", "correspondingMessageId", "id", "isError", "sessionId", "sourceItem", "status",
  "targetItem", "timeCreated", "timeCreatedRaw", "timeProcessed", "timeProcessedRaw", "type",
].sort();

/** The fields of a searchTable success result (spec: `{action, rows, hasMore, limit, ...window, nextCursor?, dataPolicy}`). */
const RESULT_FIELDS = ["action", "dataPolicy", "from", "fromRaw", "hasMore", "limit", "rows", "to", "toRaw"].sort();

/** The fields of a `notApplicable` result. */
const NOT_APPLICABLE_FIELDS = ["action", "dataPolicy", "from", "fromRaw", "hasMore", "limit", "notApplicable", "reason", "rows", "to", "toRaw"].sort();

const WINDOW = { from: "2001-02-03 07:00:00", to: "2001-02-03 09:00:00" };

/** What a well-behaved route answers for a match: header rows only. */
const WELL_BEHAVED = (): unknown =>
  stubEnvelope({ action: "searchTable", limit: 100, ...WINDOW, interopEnabled: true, searchTablesConfigured: true, rows: [ROW], hasMore: false });

/** A `headers` answer, for the sessions that also call the headers action. */
const HEADERS_REPLY = (): unknown =>
  stubEnvelope({ action: "headers", limit: 100, ...WINDOW, interopEnabled: true, rows: [ROW], hasMore: false });

/**
 * A reply padded the way a version-skewed, patched or hostile IRIS could send it: Search Table and body
 * content in extra row fields (a stored value, the document ID, a column of the search table, a body text, an
 * error text, a description), an echo of the filters, and extra result fields.
 */
const PADDED = (): unknown =>
  stubEnvelope({
    action: "searchTable",
    limit: 100,
    ...WINDOW,
    interopEnabled: true,
    searchTablesConfigured: true,
    rows: [
      {
        ...ROW,
        PropValue: `${SENTINEL}-MRN-1`,
        propValue: `${SENTINEL}-mrn-1`,
        DocId: `${SENTINEL}-DOC`,
        PatientID: `${SENTINEL}-PID`,
        "s0.PropValue": `${SENTINEL}-S0`,
        bodyText: `MSH|^~\\&|${SENTINEL}-TEXT`,
        ErrorStatus: `${SENTINEL}-ERROR`,
        Description: `${SENTINEL}-DESCRIPTION`,
        filters: FILTERS,
      },
    ],
    hasMore: false,
    filters: FILTERS,
    searchTableValues: [`${SENTINEL}-VALUE`],
    note: `${SENTINEL}-NOTE`,
  });

/** A padded answer for a namespace with no Search Table property: rows the route would never send there. */
const PADDED_NO_SEARCH_TABLE = (): unknown =>
  stubEnvelope({
    action: "searchTable",
    limit: 100,
    ...WINDOW,
    interopEnabled: true,
    searchTablesConfigured: false,
    rows: [{ ...ROW, PropValue: `${SENTINEL}-MRN-1` }],
    hasMore: true,
    note: `${SENTINEL}-NOTE`,
  });

/** A padded answer for a namespace without Interoperability. */
const PADDED_NO_INTEROP = (): unknown =>
  stubEnvelope({
    action: "searchTable",
    limit: 100,
    ...WINDOW,
    interopEnabled: false,
    rows: [{ ...ROW, PropValue: `${SENTINEL}-MRN-1` }],
    hasMore: true,
    note: `${SENTINEL}-NOTE`,
  });

// -- Sessions --------------------------------------------------------------------------------------------------

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let fixtureDir = "";
let stub: RouteStub;
const opened: WireSession[] = [];

/**
 * A session on the built interop server pointed at the listener, with `extraEnv`. The listener refuses
 * everything while the server starts (the server starts without its default profile established) and serves
 * the search route afterwards.
 */
async function session(extraEnv: Record<string, string> = {}, onStderr?: (chunk: string) => void): Promise<WireSession> {
  stub.serving = false;
  const options: WireSessionOptions = {
    sdkEsmDir: sdkEsmDir as string,
    entry: INTEROP_ENTRY,
    target: stubTarget(stub.port, "story394-qa"),
    clientName: "story-39-4-qa-process",
    ...(onStderr ? { onStderr } : {}),
  };
  const created = await openWireSession(options, { LOG_LEVEL: SERVER_LOG_LEVEL, ...extraEnv });
  opened.push(created);
  stub.serving = true;
  return created;
}

const REFUSAL = { code: "DATA_POLICY_BLOCKED", action: "searchTable", policy: "block" };

/** How many route requests the listener has seen so far: a refusal must not change it. */
const seen = (): number => routeRequests(stub).length;

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-interop-mcp");
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.4 QA process gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) {
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-39-4-qa-process: ${skipReason}`);
    return;
  }
  fixtureDir = mkdtempSync(path.join(tmpdir(), "story-39-4-qa-"));
  stub = await startRouteStub(SEARCH_ROUTE);
});

afterAll(async () => {
  for (const s of opened) await s.close();
  if (stub) await stub.close();
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------------------------------------------
// block: refused before any request, whatever else is wrong with the call
// ---------------------------------------------------------------------------------------------------------------

describe("Story 39.4 QA: under block the searchTable action sends no route request (AC-2; AD-9, AD-26)", () => {
  it("IRIS_DATA_POLICY=block refuses every searchTable call with the same fixed refusal, before the input checks, and the listener sees no route request", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = WELL_BEHAVED;
    const s = await session({ IRIS_DATA_POLICY: "block" });

    const before = seen();
    const calls: Array<[string, Record<string, unknown>]> = [
      ["a valid lookup", SEARCH],
      ["no searchTableClass and no filters (the input checks come after the policy)", { action: "searchTable", namespace: NS, from: FROM, to: TO }],
      ["a hostile searchTableClass (it is never looked at)", { ...SEARCH, searchTableClass: `x' OR 1=1 --${FILTER_TOKEN}` }],
      ["a bodyClass that is not a class", { ...SEARCH, bodyClass: `No.Such.${FILTER_TOKEN}` }],
      ["a cursor that is not one (the cursor check comes after the policy)", { ...SEARCH, cursor: "!!" }],
      ["hostile filter values", { ...SEARCH, filters: [{ property: "PatientID", op: "eq", value: `x' OR '1'='1 ${FILTER_TOKEN}` }] }],
      ["a namespace that does not exist", { ...SEARCH, namespace: "STORY394NONE" }],
    ];
    const texts: string[] = [];
    for (const [label, args] of calls) {
      const result = await s.call("iris_message_search", args);
      expect(result.isError, label).toBe(true);
      expect(result.structuredContent, label).toEqual(REFUSAL);
      expect(JSON.stringify(result), `${label}: no filter value in the refusal`).not.toContain(FILTER_TOKEN);
      texts.push(allText(result));
    }
    expect(new Set(texts).size, "the refusal text is fixed: it does not vary with the input").toBe(1);
    expect(texts[0], "the text is the spec's, which names the searchTable action").toBe(BLOCKED_TEXT);
    expect(routeRequests(stub).slice(before), "block made no request to a route").toEqual([]);
  }, 60000);

  it("the window and the misplaced-parameter checks come before the policy and are validation errors, and body keeps its own refusal: none sends a request", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const s = await session({ IRIS_DATA_POLICY: "block" });
    const before = seen();

    const badFrom = await s.call("iris_message_search", { ...SEARCH, from: "yesterday" });
    expect(badFrom.isError).toBe(true);
    expect(badFrom.structuredContent?.["code"], "a bad window is a validation error, not a policy refusal").toBeUndefined();
    expect(allText(badFrom)).toContain("'from' must be an ISO 8601");

    const filtersOnHeaders = await s.call("iris_message_search", { action: "headers", namespace: NS, from: FROM, to: TO, filters: FILTERS });
    expect(filtersOnHeaders.isError).toBe(true);
    expect(filtersOnHeaders.structuredContent?.["code"]).toBeUndefined();
    expect(allText(filtersOnHeaders)).toBe("'filters' applies only to the body and searchTable actions.");

    for (const action of ["headers", "body"]) {
      const misplaced = await s.call("iris_message_search", {
        action,
        namespace: NS,
        from: FROM,
        to: TO,
        searchTableClass: SEARCH_TABLE_CLASS,
        ...(action === "body" ? { bodyClass: BODY_CLASS, filters: FILTERS } : {}),
      });
      expect(misplaced.isError, action).toBe(true);
      expect(misplaced.structuredContent?.["code"], `${action}: a misplaced parameter is not a policy refusal`).toBeUndefined();
      expect(allText(misplaced), action).toBe("'searchTableClass' applies only to the searchTable action.");
    }

    const body = await s.call("iris_message_search", { action: "body", namespace: NS, from: FROM, to: TO, bodyClass: BODY_CLASS, filters: FILTERS });
    expect(body.structuredContent, "body keeps its own refusal, naming the body action").toEqual({ code: "DATA_POLICY_BLOCKED", action: "body", policy: "block" });
    expect(allText(body), "and its own text, not the searchTable one").not.toBe(BLOCKED_TEXT);

    expect(routeRequests(stub).slice(before)).toEqual([]);
  }, 60000);

  it("headers on the same blocked session is not under the policy: it sends its request, with no searchTableClass or filters key and no dataPolicy in the result", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = HEADERS_REPLY;
    const s = await session({ IRIS_DATA_POLICY: "block" });
    const before = searchesOf(stub).length;

    const result = await s.call("iris_message_search", { action: "headers", namespace: NS, from: FROM, to: TO });

    expect(result.isError, allText(result)).toBeFalsy();
    expect(result.structuredContent).not.toHaveProperty("dataPolicy");
    const sent = searchesOf(stub).slice(before);
    expect(sent, "the listener sees what is sent (the positive control for the zero counts above)").toHaveLength(1);
    expect(JSON.parse((sent[0] as RecordedRequest).body)).toEqual({ action: "headers", from: FROM, to: TO, limit: 100, namespace: NS });
  }, 60000);

  it("a block profile refuses while the default profile of the same server sends, and an unknown profile sends nothing", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = WELL_BEHAVED;
    const s = await session({ IRIS_PROFILES: JSON.stringify({ tight: { dataPolicy: "block" } }) });

    const before = seen();
    const refused = await s.callOn("tight", "iris_message_search", SEARCH);
    expect(refused.structuredContent).toEqual(REFUSAL);
    expect(routeRequests(stub).slice(before), "the tight profile sent nothing").toEqual([]);

    const unknown = await s.callOn("nosuchprofile", "iris_message_search", SEARCH);
    expect(unknown.isError).toBe(true);
    expect(unknown.structuredContent?.["code"]).not.toBe("DATA_POLICY_BLOCKED");
    expect(JSON.stringify(unknown)).not.toContain(FILTER_TOKEN);
    expect(routeRequests(stub).slice(before), "an unknown profile sent nothing").toEqual([]);

    const searchesBefore = searchesOf(stub).length;
    const ran = await s.call("iris_message_search", SEARCH);
    expect(ran.isError, allText(ran)).toBeFalsy();
    expect((ran.structuredContent as Item).dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
    expect(searchesOf(stub).length - searchesBefore, "the default profile sent its request").toBe(1);
  }, 60000);

  it("the governance file decides too: a profile entry beats the file's global one, in either direction", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = WELL_BEHAVED;
    const file = writeJson(fixtureDir, "governance.json", { dataPolicy: { profiles: { p: "BLOCK" }, global: "allow" } });
    const s = await session({ IRIS_PROFILES: JSON.stringify({ p: {} }), IRIS_GOVERNANCE_FILE: file });

    const before = seen();
    const refused = await s.callOn("p", "iris_message_search", SEARCH);
    expect(refused.structuredContent, "p is block by the file's profiles entry").toEqual(REFUSAL);
    expect(routeRequests(stub).slice(before), "p sent nothing").toEqual([]);

    const searchesBefore = searchesOf(stub).length;
    const ran = await s.call("iris_message_search", SEARCH);
    expect(ran.isError, allText(ran)).toBeFalsy();
    expect((ran.structuredContent as Item).dataPolicy, "the default profile is allow by the file's global entry").toEqual({
      policy: "allow",
      redacted: 0,
      blocked: 0,
    });
    expect(searchesOf(stub).length - searchesBefore, "the allow profile sent its request").toBe(1);

    const globalBlock = writeJson(fixtureDir, "governance-global.json", { dataPolicy: { global: "block" } });
    const g = await session({ IRIS_GOVERNANCE_FILE: globalBlock });
    const mark = seen();
    expect((await g.call("iris_message_search", SEARCH)).structuredContent, "global block").toEqual(REFUSAL);
    expect(routeRequests(stub).slice(mark), "global block sent nothing").toEqual([]);
  }, 60000);
});

// ---------------------------------------------------------------------------------------------------------------
// redact and allow: the request, and a reply that is padded
// ---------------------------------------------------------------------------------------------------------------

describe("Story 39.4 QA: under redact and allow the lookup goes to IRIS as given and only header rows come back (AC-2; AD-26)", () => {
  for (const [policy, env] of [
    ["redact", {}],
    ["allow", { IRIS_DATA_POLICY: "allow" }],
  ] as Array<[string, Record<string, string>]>) {
    it(`${policy}: exactly one request with the caller's class, filters and window, and the 14 header-row fields of a padded reply, nothing else`, async (ctx) => {
      if (skipIfReason(skipReason, ctx)) return;
      stub.reply = PADDED;
      const s = await session(env);
      const before = searchesOf(stub).length;

      const result = await s.call("iris_message_search", SEARCH);

      expect(result.isError, allText(result)).toBeFalsy();
      const sent = searchesOf(stub).slice(before);
      expect(sent, "exactly one search request").toHaveLength(1);
      expect(JSON.parse((sent[0] as RecordedRequest).body), "the wire body: the caller's fields, nothing added").toEqual(WIRE_BODY);

      const structured = result.structuredContent as Item;
      expect(Object.keys(structured).sort(), "only the named result fields").toEqual(RESULT_FIELDS);
      const rows = structured.rows as Item[];
      expect(rows).toHaveLength(1);
      expect(Object.keys(rows[0] as Item).sort(), "only the header-row fields").toEqual(ROW_FIELDS);
      expect(rows[0]).toMatchObject({ id: 1, bodyClassName: BODY_CLASS, bodyId: "1", timeCreated: "2001-02-03T08:00:00.000Z", timeCreatedRaw: "2001-02-03 08:00:00" });
      expect(structured.dataPolicy).toEqual({ policy, redacted: 0, blocked: 0 });

      const everything = JSON.stringify(result);
      expect(everything, "no Search Table or body content from the padded reply, in text or structured output").not.toContain(SENTINEL);
      expect(everything, "no filter value echoed in text or structured output").not.toContain(FILTER_TOKEN);
      const lines = allText(result).split("\n");
      expect(lines, "a heading, one row and the policy line").toHaveLength(3);
      expect(lines[0]).toBe("1 message header(s) from 2001-02-03T07:00:00.000Z to 2001-02-03T09:00:00.000Z.");
      expect(lines.at(-1)).toBe(`Data policy ${policy}: header rows only; the searchTable action returns no Search Table or body values.`);
    }, 60000);

    it(`${policy}: a namespace with no Search Table property is notApplicable with its reason and no rows, however many the reply carries`, async (ctx) => {
      if (skipIfReason(skipReason, ctx)) return;
      stub.reply = PADDED_NO_SEARCH_TABLE;
      const s = await session(env);

      const result = await s.call("iris_message_search", SEARCH);

      expect(result.isError, allText(result)).toBeFalsy();
      const structured = result.structuredContent as Item;
      expect(Object.keys(structured).sort()).toEqual(NOT_APPLICABLE_FIELDS);
      expect(structured).toMatchObject({ action: "searchTable", notApplicable: true, rows: [], hasMore: false, dataPolicy: { policy, redacted: 0, blocked: 0 } });
      expect(structured.reason).toBe(
        `No Search Table is configured in namespace '${NS}': it has no Search Table properties (Ens.Config.SearchTableProp is empty), ` +
          "so there is nothing to look up. Compile or deploy a Search Table class there, or use the headers or body action.",
      );
      expect(allText(result).split("\n").at(-1)).toBe(`Data policy ${policy}: header rows only; the searchTable action returns no Search Table or body values.`);
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(JSON.stringify(result)).not.toContain(FILTER_TOKEN);
    }, 60000);

    it(`${policy}: a namespace without Interoperability is notApplicable with the 39.1 reason and no rows, however many the reply carries`, async (ctx) => {
      if (skipIfReason(skipReason, ctx)) return;
      stub.reply = PADDED_NO_INTEROP;
      const s = await session(env);

      const result = await s.call("iris_message_search", SEARCH);

      expect(result.isError, allText(result)).toBeFalsy();
      const structured = result.structuredContent as Item;
      expect(Object.keys(structured).sort()).toEqual(NOT_APPLICABLE_FIELDS);
      expect(structured).toMatchObject({ action: "searchTable", notApplicable: true, rows: [], hasMore: false, dataPolicy: { policy, redacted: 0, blocked: 0 } });
      expect(String(structured.reason)).toContain(`Interoperability is not configured in namespace '${NS}'`);
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(JSON.stringify(result)).not.toContain(FILTER_TOKEN);
    }, 60000);
  }

  it("an empty page is a success that names the policy and says an index proves nothing about absence", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = () => stubEnvelope({ action: "searchTable", limit: 100, ...WINDOW, interopEnabled: true, searchTablesConfigured: true, rows: [], hasMore: false });
    const s = await session();

    const result = await s.call("iris_message_search", SEARCH);

    expect(result.isError, allText(result)).toBeFalsy();
    const structured = result.structuredContent as Item;
    expect(structured).toMatchObject({ action: "searchTable", rows: [], hasMore: false, dataPolicy: { policy: "redact", redacted: 0, blocked: 0 } });
    expect(structured).not.toHaveProperty("notApplicable");
    expect(structured).not.toHaveProperty("nextCursor");
    expect(allText(result)).toBe(
      "No message headers matched. A Search Table holds only the messages indexed when they were processed (or by BuildIndex), " +
        "so no match does not prove that no message holds the value.\n" +
        "Data policy redact: header rows only; the searchTable action returns no Search Table or body values.",
    );
  }, 60000);

  it("every scope filter, a value-free filter and a page after a cursor reach the wire as given, in one request each", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = () =>
      stubEnvelope({
        action: "searchTable",
        limit: 1,
        ...WINDOW,
        interopEnabled: true,
        searchTablesConfigured: true,
        rows: [ROW, { ...ROW, id: 2, timeCreated: "2001-02-03 08:00:01" }],
        hasMore: true,
      });
    const s = await session();
    const before = searchesOf(stub).length;
    const scoped = {
      ...SEARCH,
      filters: [{ property: "PatientAcct", op: "isNull" }],
      bodyClass: BODY_CLASS,
      item: "Story394.Source",
      source: "Story394.Source",
      target: "Story394.Target",
      status: "Completed",
      sessionId: 394001,
      errorOnly: true,
      limit: 1,
    };

    const first = await s.call("iris_message_search", scoped);
    const cursor = (first.structuredContent as Item).nextCursor as string;
    expect(typeof cursor, "the page has more, so it carries a cursor").toBe("string");
    await s.call("iris_message_search", { ...scoped, cursor });

    const [one, two] = searchesOf(stub).slice(before).map((r) => JSON.parse(r.body) as Item);
    expect(searchesOf(stub).slice(before), "one request per call").toHaveLength(2);
    expect(one, "the first page: every scope field and the class, no cursor position").toEqual({
      action: "searchTable",
      from: FROM,
      to: TO,
      limit: 1,
      namespace: NS,
      searchTableClass: SEARCH_TABLE_CLASS,
      bodyClass: BODY_CLASS,
      item: "Story394.Source",
      source: "Story394.Source",
      target: "Story394.Target",
      status: "Completed",
      sessionId: 394001,
      errorOnly: true,
      filters: [{ property: "PatientAcct", op: "isNull" }],
    });
    expect(two, "the next page: the same request plus the keyset position of the last row").toEqual({
      ...one,
      afterTimeCreated: "2001-02-03 08:00:01",
      afterId: 2,
    });
  }, 60000);
});

// ---------------------------------------------------------------------------------------------------------------
// The audit file and the console log
// ---------------------------------------------------------------------------------------------------------------

describe("Story 39.4 QA: neither the audit file nor the console log holds a Search Table value or, under redact and block, a filter value (AC-2, AC-5; AD-19)", () => {
  it("under each policy, with a padded reply, at DEBUG, the entry carries the policy, the filters are redacted or logged, no stored value is anywhere, and the headers entry of the same file has no dataPolicy", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = (request) => (request.action === "headers" ? HEADERS_REPLY() : PADDED());
    const cases: Array<{ label: string; env: Record<string, string>; outcome: string; filtersLogged: boolean }> = [
      { label: "redact", env: {}, outcome: "ok", filtersLogged: false },
      { label: "block", env: { IRIS_DATA_POLICY: "block" }, outcome: "error", filtersLogged: false },
      { label: "allow", env: { IRIS_DATA_POLICY: "allow" }, outcome: "ok", filtersLogged: true },
    ];
    for (const row of cases) {
      const file = path.join(fixtureDir, `audit-${row.label}.jsonl`);
      let stderr = "";
      const s = await session({ IRIS_AUDIT_LOG: file, IRIS_AUDIT_LOG_PARAMS: "true", ...row.env }, (chunk) => {
        stderr += chunk;
      });

      const result = await s.call("iris_message_search", SEARCH);
      const headers = await s.call("iris_message_search", { action: "headers", namespace: NS, from: FROM, to: TO });
      expect(headers.isError, `${row.label}: headers runs under every policy`).toBeFalsy();

      const [entry, headersEntry] = await pollAuditEntries(file, { tool: "iris_message_search", count: 2, intervalMs: 20, timeoutMs: 10000, excerpt: 2000 });
      expect(entry, row.label).toMatchObject({
        tool: "iris_message_search",
        action: "searchTable",
        outcome: row.outcome,
        dataPolicy: { policy: row.label, redacted: 0, blocked: 0 },
      });
      expect(headersEntry, `${row.label}: the headers entry`).toMatchObject({ tool: "iris_message_search", action: "headers", outcome: "ok" });
      expect(headersEntry, `${row.label}: dataPolicy belongs to the governed actions only`).not.toHaveProperty("dataPolicy");

      const params = (entry as Item).params as Item;
      expect(params.searchTableClass, `${row.label}: the class is logged (the redaction is of the filters, not of every parameter)`).toBe(SEARCH_TABLE_CLASS);
      const raw = readFileSync(file, "utf8");
      if (row.filtersLogged) {
        expect(params.filters, "allow: the filters are logged as given (the positive control)").toEqual(FILTERS);
        expect(raw, "allow: the audit file holds the filter token").toContain(FILTER_TOKEN);
      } else {
        expect(params.filters, `${row.label}: the whole filters value`).toBe("[REDACTED]");
        expect(raw, `${row.label}: the audit file holds no filter value`).not.toContain(FILTER_TOKEN);
        expect(stderr, `${row.label}: the console log holds no filter value`).not.toContain(FILTER_TOKEN);
      }
      expect(raw, `${row.label}: the audit file holds no Search Table or body value`).not.toContain(SENTINEL);
      expect(stderr.length, `${row.label}: the server logged at DEBUG`).toBeGreaterThan(0);
      expect(stderr, `${row.label}: the console log holds no Search Table or body value`).not.toContain(SENTINEL);
      expect(JSON.stringify(result), `${row.label}: the response holds no stored value and no filter value`).not.toMatch(new RegExp(`${SENTINEL}|${FILTER_TOKEN}`));
    }
  }, 180000);

  it("a call that names no profile the server has is audited with its filters redacted, and sends nothing", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = PADDED;
    const file = path.join(fixtureDir, "audit-unresolved.jsonl");
    let stderr = "";
    const s = await session({ IRIS_AUDIT_LOG: file, IRIS_AUDIT_LOG_PARAMS: "true", IRIS_DATA_POLICY: "allow" }, (chunk) => {
      stderr += chunk;
    });
    const before = seen();

    const result = await s.raw("iris_message_search", { ...SEARCH, server: "nosuchprofile" });

    expect(result.isError).toBe(true);
    expect(routeRequests(stub).slice(before), "an unresolved profile sent nothing").toEqual([]);
    const [entry] = await pollAuditEntries(file, { tool: "iris_message_search", count: 1, intervalMs: 20, timeoutMs: 10000, excerpt: 2000 });
    expect(entry, "the entry").toMatchObject({ tool: "iris_message_search", action: "searchTable", outcome: "error" });
    expect(((entry as Item).params as Item).filters, "the profile did not resolve, so its policy is unknown and the filters are redacted").toBe("[REDACTED]");
    expect(entry).not.toHaveProperty("dataPolicy");
    expect(readFileSync(file, "utf8")).not.toContain(FILTER_TOKEN);
    // One more round trip, so every line the server wrote to stderr while it handled the call has been read.
    await s.listTools();
    expect(stderr.length, "the server logged at DEBUG").toBeGreaterThan(0);
    expect(stderr).not.toContain(FILTER_TOKEN);
    expect(JSON.stringify(result)).not.toContain(FILTER_TOKEN);
  }, 60000);
});
