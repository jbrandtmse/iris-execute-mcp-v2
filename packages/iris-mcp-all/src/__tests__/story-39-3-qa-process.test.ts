/**
 * Story 39.3 (QA) - the body search and its PHI data policy on the BUILT interop server, where the in-process suites
 * and the live gate stop short (AC-2, AC-5; AD-9, AD-19, AD-26; Rules #36, #54, #59).
 *
 * The BUILT iris-interop-mcp dist is spawned over stdio and pointed at a local HTTP listener that stands in for
 * IRIS: it records every request and answers the search route with a reply the test controls. No IRIS instance is
 * contacted. That makes four properties observable where they happen, which the other suites reach only through
 * mocks (the request) or through a well-behaved IRIS (the replies):
 *
 *  - `block` (operator-wide, per profile, and from the governance file) refuses the body action before any request
 *    reaches an ExecuteMCPv2 route on the listener (the server's own connection and bootstrap traffic goes to
 *    /api/atelier/ on its own schedule and is not counted), whatever else is wrong with the call, while `headers`
 *    on the same session still sends its request (the positive control that the listener sees what is sent);
 *  - `redact` and `allow` send the filters to IRIS exactly as given (numbers, booleans, quotes, a backslash, a
 *    question mark and non-ASCII text survive the real HTTP client), and nothing else of the caller's input;
 *  - a reply padded with body content (a body value in an extra row field, an echo of the filters, a `bodyText`)
 *    comes out as the 14 header-row fields and the named result fields only, in text and in structured content;
 *  - the audit file and the console log of a session at DEBUG hold neither the padded reply nor, under `redact`,
 *    `block` and for an unresolved profile, a filter value; `allow` logs the filters (the positive control).
 *
 * Expected values come from the Story 39.3 intent contract, never from the implementation (Rule #36). Placement
 * (Rule #45): `@iris-mcp/all` is the only package that depends on every server's built dist. A missing or stale
 * `shared` or `iris-interop-mcp` dist, or an unresolvable SDK, skips each test with the reason, or fails when
 * `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allText,
  distEntry,
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
const INTEROP_ENTRY = distEntry(REPO_ROOT, "iris-interop-mcp");

const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** A WARN or DEBUG line is not logged under LOG_LEVEL=ERROR, which a developer shell may set. */
const SERVER_LOG_LEVEL = "DEBUG";

/** A body value a padded reply carries: it must reach no output of a governed call. */
const SENTINEL = "SYNTHPHI393";
/** Appears only in the filter values the caller sends: it must reach no response and, under redact and block, no log. */
const FILTER_TOKEN = "QAFILTER393";

/** The namespace the calls name. The listener answers whatever it is asked, so no IRIS namespace is involved. */
const NS = "STORY393QA";
const BODY_CLASS = "Story393.Body";
const SEARCH_ROUTE = "/api/executemcp/v2/interop/message/search";

type Item = Record<string, unknown>;

/** Every kind of value the wire carries: strings with quotes, a backslash, a question mark and non-ASCII text, a number, a boolean, no value. */
const FILTERS: Array<Record<string, unknown>> = [
  { property: "Code", op: "eq", value: `K1-${FILTER_TOKEN}` },
  { property: "Amount", op: "ge", value: 0.5 },
  { property: "Flag", op: "eq", value: true },
  { property: "Note", op: "notNull" },
  { property: "Exact", op: "contains", value: `\u00e9\u4e2d "q" \\ ? ${FILTER_TOKEN}` },
];

const FROM = "2001-02-03T07:00:00Z";
const TO = "2001-02-03T09:00:00Z";

/** The arguments of a valid body search, aimed at the namespace NS. */
const SEARCH = { action: "body", namespace: NS, from: FROM, to: TO, bodyClass: BODY_CLASS, filters: FILTERS };

/** The request the server must send for SEARCH under redact and allow: the caller's fields, the window canonical, the default limit. */
const WIRE_BODY = { action: "body", from: FROM, to: TO, limit: 100, namespace: NS, bodyClass: BODY_CLASS, filters: FILTERS };

// -- The listener ----------------------------------------------------------------------------------------------

/** The search POSTs the listener has recorded. */
const searchesOf = (s: RouteStub): RecordedRequest[] => s.requests.filter((r) => r.method === "POST" && r.url === SEARCH_ROUTE);

/** A header row exactly as the route returns it. */
const ROW: Item = {
  id: 1,
  sessionId: 393001,
  type: "Request",
  status: "Completed",
  isError: false,
  sourceItem: "Story393.Source",
  targetItem: "Story393.Target",
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

/** The fields of a body success result (spec: `{action, rows, hasMore, limit, ...window, nextCursor?, dataPolicy}`). */
const RESULT_FIELDS = ["action", "dataPolicy", "from", "fromRaw", "hasMore", "limit", "rows", "to", "toRaw"].sort();

/** What a well-behaved route answers for a match: header rows only. */
const WELL_BEHAVED = (): unknown =>
  stubEnvelope({ action: "body", limit: 100, from: "2001-02-03 07:00:00", to: "2001-02-03 09:00:00", interopEnabled: true, rows: [ROW], hasMore: false });

/**
 * A reply padded the way a version-skewed, patched or hostile IRIS could send it: body content in extra row
 * fields (a body value, a text, an error text, a description), an echo of the filters, and extra result fields.
 */
const PADDED = (): unknown =>
  stubEnvelope({
    action: "body",
    limit: 100,
    from: "2001-02-03 07:00:00",
    to: "2001-02-03 09:00:00",
    interopEnabled: true,
    rows: [
      {
        ...ROW,
        bodyText: `MSH|^~\\&|${SENTINEL}-TEXT`,
        bodySummary: `${SENTINEL}-SUMMARY`,
        Exact: `${SENTINEL}-E1`,
        "b.Exact": `${SENTINEL}-E1`,
        ErrorStatus: `${SENTINEL}-ERROR`,
        Description: `${SENTINEL}-DESCRIPTION`,
        filters: FILTERS,
      },
    ],
    hasMore: false,
    filters: FILTERS,
    bodyValues: [`${SENTINEL}-VALUE`],
    note: `${SENTINEL}-NOTE`,
  });

/** A padded answer for a namespace without Interoperability: rows the route would never send there. */
const PADDED_NOT_CONFIGURED = (): unknown =>
  stubEnvelope({
    action: "body",
    limit: 100,
    from: "2001-02-03 07:00:00",
    to: "2001-02-03 09:00:00",
    interopEnabled: false,
    rows: [{ ...ROW, bodyText: `${SENTINEL}-TEXT` }],
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
    target: stubTarget(stub.port, "story393-qa"),
    clientName: "story-39-3-qa-process",
    ...(onStderr ? { onStderr } : {}),
  };
  const created = await openWireSession(options, { LOG_LEVEL: SERVER_LOG_LEVEL, ...extraEnv });
  opened.push(created);
  stub.serving = true;
  return created;
}

const REFUSAL = { code: "DATA_POLICY_BLOCKED", action: "body", policy: "block" };

/** How many route requests the listener has seen so far: a refusal must not change it. */
const seen = (): number => routeRequests(stub).length;

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared") ?? staleDistReason(REPO_ROOT, "iris-interop-mcp");
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.3 QA process gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) {
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-39-3-qa-process: ${skipReason}`);
    return;
  }
  fixtureDir = mkdtempSync(path.join(tmpdir(), "story-39-3-qa-"));
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

describe("Story 39.3 QA: under block the body action sends no route request (AC-2; AD-9, AD-26)", () => {
  it("IRIS_DATA_POLICY=block refuses every body call with the same fixed refusal, before the input checks, and the listener sees no route request", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = WELL_BEHAVED;
    const s = await session({ IRIS_DATA_POLICY: "block" });

    const before = seen();
    const calls: Array<[string, Record<string, unknown>]> = [
      ["a valid search", SEARCH],
      ["no bodyClass and no filters (the input checks come after the policy)", { action: "body", namespace: NS, from: FROM, to: TO }],
      ["a cursor that is not one (the cursor check comes after the policy)", { ...SEARCH, cursor: "!!" }],
      ["hostile filter values", { ...SEARCH, filters: [{ property: "Code", op: "eq", value: `x' OR '1'='1 ${FILTER_TOKEN}` }] }],
      ["a namespace that does not exist", { ...SEARCH, namespace: "STORY393NONE" }],
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
    expect(routeRequests(stub).slice(before), "block made no request to a route").toEqual([]);
  }, 60000);

  it("the window is parsed before the policy (a validation error, not a policy refusal), and searchTable is itself refused by the policy: neither sends a request", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const s = await session({ IRIS_DATA_POLICY: "block" });
    const before = seen();

    const badFrom = await s.call("iris_message_search", { ...SEARCH, from: "yesterday" });
    expect(badFrom.isError).toBe(true);
    expect(badFrom.structuredContent?.["code"], "a bad window is a validation error, not a policy refusal").toBeUndefined();
    expect(allText(badFrom)).toContain("'from' must be an ISO 8601");

    const table = await s.call("iris_message_search", { ...SEARCH, action: "searchTable", filters: undefined, bodyClass: undefined });
    expect(table.structuredContent).toEqual({ code: "DATA_POLICY_BLOCKED", action: "searchTable", policy: "block" });

    expect(routeRequests(stub).slice(before)).toEqual([]);
  }, 60000);

  it("headers on the same blocked session is not under the policy: it sends its request, with no filters key and no dataPolicy in the result", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = () => stubEnvelope({ action: "headers", limit: 100, from: "2001-02-03 07:00:00", to: "2001-02-03 09:00:00", interopEnabled: true, rows: [ROW], hasMore: false });
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

describe("Story 39.3 QA: under redact and allow the filters go to IRIS as given and only header rows come back (AC-2; AD-26)", () => {
  for (const [policy, env] of [
    ["redact", {}],
    ["allow", { IRIS_DATA_POLICY: "allow" }],
  ] as Array<[string, Record<string, string>]>) {
    it(`${policy}: exactly one request with the caller's filters and window, and the 14 header-row fields of a padded reply, nothing else`, async (ctx) => {
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
      expect(everything, "no body content from the padded reply, in text or structured output").not.toContain(SENTINEL);
      expect(everything, "no filter value echoed in text or structured output").not.toContain(FILTER_TOKEN);
      const lines = allText(result).split("\n");
      expect(lines[0]).toBe("1 message header(s) from 2001-02-03T07:00:00.000Z to 2001-02-03T09:00:00.000Z.");
      expect(lines.at(-1)).toBe(`Data policy ${policy}: header rows only; the body action returns no body content.`);
    }, 60000);

    it(`${policy}: a namespace without Interoperability is notApplicable with no rows, however many the reply carries`, async (ctx) => {
      if (skipIfReason(skipReason, ctx)) return;
      stub.reply = PADDED_NOT_CONFIGURED;
      const s = await session(env);

      const result = await s.call("iris_message_search", SEARCH);

      expect(result.isError, allText(result)).toBeFalsy();
      const structured = result.structuredContent as Item;
      expect(structured).toMatchObject({ action: "body", notApplicable: true, rows: [], hasMore: false, dataPolicy: { policy, redacted: 0, blocked: 0 } });
      expect(JSON.stringify(result)).not.toContain(SENTINEL);
      expect(JSON.stringify(result)).not.toContain(FILTER_TOKEN);
    }, 60000);
  }

  it("a value-free filter goes over the wire without a value key, and a page after a cursor sends the keyset position", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = () =>
      stubEnvelope({
        action: "body",
        limit: 1,
        from: "2001-02-03 07:00:00",
        to: "2001-02-03 09:00:00",
        interopEnabled: true,
        rows: [ROW, { ...ROW, id: 2, timeCreated: "2001-02-03 08:00:01" }],
        hasMore: true,
      });
    const s = await session();
    const before = searchesOf(stub).length;

    const first = await s.call("iris_message_search", { ...SEARCH, filters: [{ property: "Note", op: "isNull" }], limit: 1 });
    const cursor = (first.structuredContent as Item).nextCursor as string;
    expect(typeof cursor, "the page has more, so it carries a cursor").toBe("string");
    await s.call("iris_message_search", { ...SEARCH, filters: [{ property: "Note", op: "isNull" }], limit: 1, cursor });

    const [one, two] = searchesOf(stub).slice(before).map((r) => JSON.parse(r.body) as Item);
    expect(one?.filters, "no value key for isNull").toEqual([{ property: "Note", op: "isNull" }]);
    expect(one).not.toHaveProperty("afterTimeCreated");
    expect(two).toMatchObject({ afterTimeCreated: "2001-02-03 08:00:01", afterId: 2 });
  }, 60000);
});

// ---------------------------------------------------------------------------------------------------------------
// The audit file and the console log
// ---------------------------------------------------------------------------------------------------------------

describe("Story 39.3 QA: neither the audit file nor the console log holds a body value or, under redact and block, a filter value (AC-2, AC-5; AD-19)", () => {
  it("under each policy, with a padded reply, at DEBUG, the entry carries the policy, the filters are redacted or logged, and no body value is anywhere", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = PADDED;
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

      const [entry] = await pollAuditEntries(file, { tool: "iris_message_search", count: 1, intervalMs: 20, timeoutMs: 10000, excerpt: 2000 });
      expect(entry, row.label).toMatchObject({
        tool: "iris_message_search",
        action: "body",
        outcome: row.outcome,
        dataPolicy: { policy: row.label, redacted: 0, blocked: 0 },
      });
      const params = (entry as Item).params as Item;
      const raw = readFileSync(file, "utf8");
      if (row.filtersLogged) {
        expect(params.filters, "allow: the filters are logged as given (the positive control)").toEqual(FILTERS);
        expect(raw, "allow: the audit file holds the filter token").toContain(FILTER_TOKEN);
      } else {
        expect(params.filters, `${row.label}: the whole filters value`).toBe("[REDACTED]");
        expect(raw, `${row.label}: the audit file holds no filter value`).not.toContain(FILTER_TOKEN);
        expect(stderr, `${row.label}: the console log holds no filter value`).not.toContain(FILTER_TOKEN);
      }
      expect(raw, `${row.label}: the audit file holds no body value`).not.toContain(SENTINEL);
      expect(stderr.length, `${row.label}: the server logged at DEBUG`).toBeGreaterThan(0);
      expect(stderr, `${row.label}: the console log holds no body value`).not.toContain(SENTINEL);
      expect(JSON.stringify(result), `${row.label}: the response holds no body value and no filter value`).not.toMatch(new RegExp(`${SENTINEL}|${FILTER_TOKEN}`));
    }
  }, 120000);

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
    expect(entry, "the entry").toMatchObject({ tool: "iris_message_search", outcome: "error" });
    expect(((entry as Item).params as Item).filters, "the profile did not resolve, so its policy is unknown and the filters are redacted").toBe("[REDACTED]");
    expect(entry).not.toHaveProperty("dataPolicy");
    expect(readFileSync(file, "utf8")).not.toContain(FILTER_TOKEN);
    expect(stderr).not.toContain(FILTER_TOKEN);
    expect(JSON.stringify(result)).not.toContain(FILTER_TOKEN);
  }, 60000);
});
