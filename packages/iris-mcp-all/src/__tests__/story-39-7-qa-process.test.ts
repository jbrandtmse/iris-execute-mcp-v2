/**
 * Story 39.7 (QA) - DW-569 and DW-576 on the BUILT servers, over real stdio JSON-RPC against a local listener, where
 * the in-process suites stop short and the live gate drives only the dev server (AC-1, AC-2, AC-5; AD-1, AD-11,
 * AD-15, AD-19, AD-26; Rules #36, #54, #59).
 *
 * The BUILT iris-dev-mcp, iris-admin-mcp, iris-ops-mcp, iris-data-mcp and iris-interop-mcp dists are spawned and
 * pointed at a local HTTP listener that stands in for IRIS: it answers the startup handshake as a current IRIS (the
 * Atelier version, and a bootstrap version equal to the shipped one, so no class is deployed), records every other
 * request and answers it with the status and body the test sets. No IRIS instance is contacted.
 *
 *  - DW-569: for a representative tool of every package, an HTTP 400, 404 and 500 whose envelope carries an EMPTY error
 *    list is `isError` on the wire, with one request and no retry; the 2xx answer of the same tool is the tool's
 *    output byte for byte; a 2xx answer that lists errors is still an error; a 400 with no usable body (empty, HTML,
 *    `null`, `{}`) is an error; and `iris_macro_info` keeps its empty result only for an empty document name.
 *  - DW-576: `iris_production_logs` and `iris_message_diagram` under the default (`redact`), `allow` and `block`
 *    profiles. `redact` and `allow` return the route's result unchanged (the text, the structured output and an
 *    error response, with no `dataPolicy` and no `textPolicy`); `block` withholds the message-derived text with the
 *    fixed reason and counts it; the audit entry carries the policy and the counts; and no identifying value is in
 *    the audit file or in the console log of a session at DEBUG, whatever the policy (positive control: `redact`
 *    and `allow` do show the text).
 *
 * Expected values are written by hand from the Story 39.7 intent contract and the tools' documented output
 * templates, never read from the implementation (Rule #36). The one captured shape is the reply of the Event Log
 * route in a namespace without Interoperability, recorded from the live instance on 2026-10-17 with
 * `curl -u _SYSTEM:SYS 'http://localhost:52773/api/executemcp/v2/interop/production/logs?namespace=%25SYS&count=3'`
 * (HTTP 200, `status.errors` holding `ERROR #5001: SQL error:  Table 'ENS_UTIL.LOG' not found`, `result: {}`).
 * Placement (Rule #45): `@iris-mcp/all` is the only package that depends on every server's built dist. A missing or
 * stale dist, or an unresolvable SDK, skips each test with the reason, or fails when `IRIS_REQUIRE_LIVE` is armed
 * (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allText,
  distEntry,
  openAuditedSession,
  openWireSession,
  pollAuditEntries,
  resolveSdkEsmDir,
  settledAuditCount,
  shippedBootstrapVersion,
  skipIfReason,
  staleDistReason,
  stubTarget,
  type AuditedSession,
  type RecordedRequest,
  type WireSession,
  type WireToolResult,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** Every identifying value of a reply contains this; no output of a `block` call may, and no audit file or log of any call. */
const MARK = "SYNTHPHI397Q";
/** A value that is shown whenever the text is shown (and withheld with it under `block`). */
const KEEP = "KEEPME397Q";

/** The reasons of the spec's Design Notes, written by hand (not read from the shared module that the tools use). */
const EVENT_LOG_REASON = "The block data policy withholds Event Log text, which can carry message content.";
const DIAGRAM_REASON = "The block data policy withholds error text, which can carry message content.";

type Json = Record<string, unknown>;

// -- The listener ------------------------------------------------------------------------------------------------

/** What the listener sends for one request. */
interface Answer {
  status: number;
  body: string;
}

/** A local listener that answers the startup handshake itself and everything else through `answer`. */
interface Listener {
  port: number;
  /** Every request that is not part of the startup handshake, in order. */
  requests: RecordedRequest[];
  answer: (request: RecordedRequest) => Answer;
  close: () => Promise<void>;
}

/** An ExecuteMCPv2 / Atelier envelope with no errors and `result`. */
const okBody = (result: unknown): string => JSON.stringify({ status: { errors: [], summary: "" }, console: [], result });

/** The envelope of a rejected request: an EMPTY error list and an empty result (what Atelier sends for a refused name). */
const EMPTY_ERRORS_BODY = okBody({});

/** The startup handshake of a current IRIS: HEAD and GET of the Atelier root, and the two bootstrap probe queries. */
function handshake(request: RecordedRequest, shipped: string): Answer | undefined {
  if (request.url === "/api/atelier/" && request.method === "HEAD") return { status: 200, body: "" };
  if (request.url === "/api/atelier/" && request.method === "GET") return { status: 200, body: okBody({ content: { api: 8 } }) };
  if (request.method === "POST" && /\/action\/query$/.test(request.url)) {
    const query = String((JSON.parse(request.body || "{}") as { query?: unknown }).query ?? "");
    if (query.includes("Setup_GetBootstrapVersion")) return { status: 200, body: okBody({ content: [{ Version: shipped }] }) };
    if (query.includes("Setup_IsConfigured")) return { status: 200, body: okBody({ content: [{ Configured: "1" }] }) };
  }
  return undefined;
}

async function startListener(shipped: string): Promise<Listener> {
  const listener: Listener = {
    port: 0,
    requests: [],
    answer: () => ({ status: 503, body: "" }),
    close: () => Promise.resolve(),
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const request: RecordedRequest = { method: req.method ?? "", url: req.url ?? "", body: Buffer.concat(chunks).toString("utf8") };
      let reply = handshake(request, shipped);
      if (reply === undefined) {
        listener.requests.push(request);
        reply = listener.answer(request);
      }
      res.statusCode = reply.status;
      res.setHeader("Content-Type", "application/json");
      res.end(request.method === "HEAD" ? undefined : reply.body);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  listener.port = (server.address() as AddressInfo).port;
  listener.close = () =>
    new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
  return listener;
}

// -- Setup -------------------------------------------------------------------------------------------------------

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let listener: Listener;
let tempDir = "";
const opened: WireSession[] = [];
/** One plain session per package, on the default profile. */
const wire: Record<"dev" | "admin" | "ops" | "data" | "interop", WireSession> = {} as never;
/** The built interop server under the default policy (`redact`), under `allow` and under `block`, each writing an audit file. */
let redactS: AuditedSession;
let allowS: AuditedSession;
let blockS: AuditedSession;

const PACKAGES = {
  dev: "iris-dev-mcp",
  admin: "iris-admin-mcp",
  ops: "iris-ops-mcp",
  data: "iris-data-mcp",
  interop: "iris-interop-mcp",
} as const;

function wireOptions(pkg: string): { sdkEsmDir: string; entry: string; target: ReturnType<typeof stubTarget>; clientName: string } {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: stubTarget(listener.port, "story397-qa"),
    clientName: "story-39-7-qa-process",
  };
}

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared");
  for (const pkg of Object.values(PACKAGES)) skipReason ??= staleDistReason(REPO_ROOT, pkg);
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/sdk ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.7 QA process gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) {
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-39-7-qa-process: ${skipReason}`);
    return;
  }
  listener = await startListener(await shippedBootstrapVersion(REPO_ROOT));
  tempDir = mkdtempSync(path.join(tmpdir(), "story-39-7-qa-"));
  for (const [key, pkg] of Object.entries(PACKAGES)) {
    const session = await openWireSession(wireOptions(pkg));
    opened.push(session);
    wire[key as keyof typeof PACKAGES] = session;
  }
  const audited = async (name: string, env: Record<string, string>): Promise<AuditedSession> => {
    const s = await openAuditedSession({ ...wireOptions(PACKAGES.interop), auditFile: path.join(tempDir, `audit-${name}.jsonl`) }, env);
    opened.push(s.session);
    return s;
  };
  redactS = await audited("redact", {});
  allowS = await audited("allow", { IRIS_DATA_POLICY: "allow" });
  blockS = await audited("block", { IRIS_DATA_POLICY: "block" });
}, 180000);

afterAll(async () => {
  for (const session of opened) await session.close();
  if (listener) await listener.close();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
});

/**
 * Answer the next calls with `reply`, forget the earlier requests, and return what `call` sends: the result and the
 * requests. A tool that sends `requests` requests at once (`iris_macro_info` sends two) can fail on the first answer while
 * the other is still on its way, so the helper waits until all of them have arrived; otherwise a late request would be
 * counted in the next call's window.
 */
async function drive(
  reply: (request: RecordedRequest) => Answer,
  call: () => Promise<WireToolResult>,
  requests = 1,
): Promise<{ result: WireToolResult; sent: RecordedRequest[] }> {
  listener.requests.length = 0;
  listener.answer = reply;
  const result = await call();
  const deadline = Date.now() + 5000;
  while (listener.requests.length < requests && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 10));
  return { result, sent: [...listener.requests] };
}

const fixed = (status: number, body: string) => (): Answer => ({ status, body });

// -- DW-569: every non-2xx answer is an error, on every package's server ---------------------------------------

/** One representative tool of a package: how to call it, the request it makes, and what a 2xx answer must become. */
interface ToolRow {
  id: string;
  pkg: keyof typeof PACKAGES;
  tool: string;
  args: Json;
  method: "GET" | "POST";
  /** The path of the one request the tool makes (the recorded URL without its query string). */
  path: RegExp;
  /** The route's `result` for a 2xx answer, the structured content the tool returns for it, and its text. */
  ok: { result: unknown; structured: unknown; text: string };
  /** The prefix of the tool's own error text, or `undefined` when the framework words the error. */
  errorPrefix?: string;
}

const NAMESPACE_ROW = { name: "KEEPME397Q-NS", globals: "KEEPME397Q-G", routines: "KEEPME397Q-R", library: "KEEPME397Q-L", tempGlobals: "KEEPME397Q-T" };
const JOB = { pid: 41, namespace: "HSCUSTOM", routine: "KEEPME397Q", state: "RUN", userName: "qa", clientIPAddress: "", jobType: 1, commandsExecuted: 5, globalReferences: 6, inTransaction: 0, cpuTime: 7 };
const DOC_ENTRY = { name: "KEEPME397Q.A.cls", db: "HSCUSTOM", ts: "2001-02-03 12:00:00.000", upd: true, cat: "CLS", status: "", enc: false, flags: 0, content: [] };

const TOOL_ROWS: ToolRow[] = [
  {
    id: "dev iris_doc_list",
    pkg: "dev",
    tool: "iris_doc_list",
    args: { category: "CLS" },
    method: "GET",
    path: /^\/api\/atelier\/v\d+\/HSCUSTOM\/docnames\/CLS\/\*$/,
    ok: { result: { content: [DOC_ENTRY] }, structured: { items: [DOC_ENTRY] }, text: JSON.stringify({ items: [DOC_ENTRY] }, null, 2) },
  },
  {
    id: "dev iris_doc_search",
    pkg: "dev",
    tool: "iris_doc_search",
    args: { query: "ZZZNOPE397Q", files: "KEEPME397Q.A.cls" },
    method: "GET",
    path: /^\/api\/atelier\/v\d+\/HSCUSTOM\/action\/search$/,
    ok: { result: [], structured: { matches: [] }, text: JSON.stringify({ matches: [] }, null, 2) },
  },
  {
    id: "admin iris_namespace_list",
    pkg: "admin",
    tool: "iris_namespace_list",
    args: {},
    method: "GET",
    path: /^\/api\/executemcp\/v2\/config\/namespace$/,
    ok: {
      result: [NAMESPACE_ROW],
      structured: { namespaces: [NAMESPACE_ROW], count: 1 },
      text: JSON.stringify({ namespaces: [NAMESPACE_ROW], count: 1 }, null, 2),
    },
    errorPrefix: "Error listing namespaces: ",
  },
  {
    id: "ops iris_jobs_list",
    pkg: "ops",
    tool: "iris_jobs_list",
    args: {},
    method: "GET",
    path: /^\/api\/executemcp\/v2\/monitor\/jobs$/,
    ok: {
      result: { jobs: [JOB], count: 1 },
      structured: { jobs: [JOB], count: 1 },
      text: [
        "IRIS Jobs (1 process(es)):",
        "",
        "PID: 41",
        "  Namespace: HSCUSTOM",
        "  Routine: KEEPME397Q",
        "  State: RUN",
        "  User: qa",
        "  Commands: 5 | Globals: 6 | CPU: 7",
      ].join("\n"),
    },
    errorPrefix: "Error retrieving jobs list: ",
  },
  {
    id: "data iris_analytics_cubes list",
    pkg: "data",
    tool: "iris_analytics_cubes",
    args: { action: "list" },
    method: "GET",
    path: /^\/api\/executemcp\/v2\/analytics\/cubes$/,
    ok: {
      result: { cubes: [{ name: "KEEPME397Q" }], count: 1 },
      structured: { cubes: [{ name: "KEEPME397Q", lastBuildTime: "", lastBuildTimeRaw: "" }], count: 1 },
      text: JSON.stringify({ cubes: [{ name: "KEEPME397Q", lastBuildTime: "", lastBuildTimeRaw: "" }], count: 1 }, null, 2),
    },
    errorPrefix: "Error managing cubes: ",
  },
  {
    id: "interop iris_production_queues",
    pkg: "interop",
    tool: "iris_production_queues",
    args: {},
    method: "GET",
    path: /^\/api\/executemcp\/v2\/interop\/production\/queues$/,
    ok: {
      result: { queues: [{ name: "KEEPME397Q.Service", count: 0 }], count: 1 },
      structured: { queues: [{ name: "KEEPME397Q.Service", count: 0 }], count: 1 },
      text: JSON.stringify({ queues: [{ name: "KEEPME397Q.Service", count: 0 }], count: 1 }, null, 2),
    },
    errorPrefix: "Error querying production queues: ",
  },
];

/** The one request a tool made: exactly one, of the row's method and path. */
function onlyRequest(row: ToolRow, sent: RecordedRequest[]): RecordedRequest {
  expect(sent, `${row.id}: exactly one request, and no retry`).toHaveLength(1);
  const request = sent[0] as RecordedRequest;
  expect(request.method, row.id).toBe(row.method);
  expect(request.url.split("?")[0], row.id).toMatch(row.path);
  return request;
}

describe("Story 39.7 QA: DW-569, every non-2xx answer is an error on the built server of every package (AC-1, AC-2; AD-1, AD-11)", () => {
  for (const row of TOOL_ROWS) {
    for (const status of [400, 404, 500]) {
      it(`${row.id}: HTTP ${status} with an empty error list is isError, with one request`, async (ctx) => {
        if (skipIfReason(skipReason, ctx)) return;
        const { result, sent } = await drive(fixed(status, EMPTY_ERRORS_BODY), () => wire[row.pkg].call(row.tool, row.args));
        const request = onlyRequest(row, sent);
        expect(result.isError, `${row.id}: ${allText(result)}`).toBe(true);
        const named = `IRIS returned HTTP ${status} for ${row.method} ${request.url}. Check the request parameters and try again.`;
        if (row.errorPrefix !== undefined) expect(allText(result), row.id).toBe(`${row.errorPrefix}${named}`);
        else expect(allText(result), row.id).toContain(`HTTP ${status} for ${row.method} ${request.url}`);
      }, 60000);
    }

    it(`${row.id}: the 2xx answer is the tool's output, byte for byte`, async (ctx) => {
      if (skipIfReason(skipReason, ctx)) return;
      const { result, sent } = await drive(fixed(200, okBody(row.ok.result)), () => wire[row.pkg].call(row.tool, row.args));
      onlyRequest(row, sent);
      expect(result.isError, `${row.id}: ${allText(result)}`).toBeFalsy();
      expect(result.content, row.id).toEqual([{ type: "text", text: row.ok.text }]);
      expect(result.structuredContent, row.id).toEqual(row.ok.structured);
    }, 60000);
  }

  it("a 2xx answer that lists errors is still an error (unchanged), worded from the route and followed by the error list's own text", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const errors = [{ error: "ERROR #5001: SQL error:  KEEPME397Q not found", code: 5001, domain: "%ObjectErrors", id: "GeneralError", params: [] }];
    const body = JSON.stringify({ status: { errors, summary: "ERROR #5001" }, console: [], result: {} });
    for (const row of TOOL_ROWS) {
      const { result, sent } = await drive(fixed(200, body), () => wire[row.pkg].call(row.tool, row.args));
      const request = onlyRequest(row, sent);
      expect(result.isError, row.id).toBe(true);
      const named = `IRIS reported errors for ${row.method} ${request.url}. Review the error details and correct the request. Details: ERROR #5001: SQL error:  KEEPME397Q not found`;
      if (row.errorPrefix !== undefined) expect(allText(result), row.id).toBe(`${row.errorPrefix}${named}`);
      else expect(allText(result), row.id).toContain(named);
    }
  }, 120000);

  it("an HTTP 400 with no usable body is an error: empty, HTML, a bare null, {} and []", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const queues = TOOL_ROWS.find((row) => row.tool === "iris_production_queues") as ToolRow;
    const docList = TOOL_ROWS.find((row) => row.tool === "iris_doc_list") as ToolRow;
    const bodies: Array<[string, string, string]> = [
      ["an empty body", "", "with a non-JSON response"],
      ["an HTML page", "<html><body>400 Bad Request</body></html>", "with a non-JSON response"],
      ["a bare null", "null", "Check the request parameters and try again."],
      ["an empty object", "{}", "Check the request parameters and try again."],
      ["an empty array", "[]", "Check the request parameters and try again."],
    ];
    for (const row of [queues, docList]) {
      for (const [label, body, tail] of bodies) {
        const { result, sent } = await drive(fixed(400, body), () => wire[row.pkg].call(row.tool, row.args));
        onlyRequest(row, sent);
        expect(result.isError, `${row.id}, ${label}: ${allText(result)}`).toBe(true);
        expect(allText(result), `${row.id}, ${label}`).toContain("IRIS returned HTTP 400");
        expect(allText(result), `${row.id}, ${label}`).toContain(tail);
      }
    }
  }, 120000);

  it("iris_doc_list category CLS with type cls: Atelier's refusal (400, no error list) is an error naming the route, where the old client returned an empty list", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    // Captured live 2026-10-17: GET /api/atelier/v8/HSCUSTOM/docnames/CLS/cls answers HTTP 400 with `errors: []`, `result: {content: []}`.
    const refusal = okBody({ content: [] });
    const { result, sent } = await drive(fixed(400, refusal), () => wire.dev.call("iris_doc_list", { category: "CLS", type: "cls" }));
    expect(sent).toHaveLength(1);
    expect(sent[0]?.url).toMatch(/\/docnames\/CLS\/cls$/);
    expect(result.isError, allText(result)).toBe(true);
    expect(allText(result)).toContain("HTTP 400");
    expect(allText(result)).toContain("docnames/CLS/cls");
  }, 60000);

  it("iris_doc_search: an empty query (Atelier's 400 with no error list) is an error; a search with no match is {matches: []} and a hit is returned as it came", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    // Atelier answers action/search with HTTP 400 and no error list when the query or the files list is empty, and with
    // HTTP 200 for every other valid request, a miss included (captured live 2026-10-17). The listener answers the same way
    // for the query.
    const hit = [{ doc: "KEEPME397Q.A.cls", matches: [{ text: "KEEPME397Q", line: 3 }] }];
    const atelier = (request: RecordedRequest): Answer => {
      const query = new URL(request.url, "http://x").searchParams.get("query") ?? "";
      if (query === "") return { status: 400, body: okBody([]) };
      return { status: 200, body: okBody(query === "HIT" ? hit : []) };
    };
    const empty = await drive(atelier, () => wire.dev.call("iris_doc_search", { query: "" }));
    expect(empty.sent).toHaveLength(1);
    expect(empty.result.isError, allText(empty.result)).toBe(true);
    expect(allText(empty.result)).toContain("HTTP 400");

    const miss = await drive(atelier, () => wire.dev.call("iris_doc_search", { query: "MISS" }));
    expect(miss.result.isError, allText(miss.result)).toBeFalsy();
    expect(miss.result.structuredContent).toEqual({ matches: [] });
    expect(miss.result.content).toEqual([{ type: "text", text: JSON.stringify({ matches: [] }, null, 2) }]);

    const found = await drive(atelier, () => wire.dev.call("iris_doc_search", { query: "HIT" }));
    expect(found.result.structuredContent).toEqual({ matches: hit });
  }, 120000);
});

describe("Story 39.7 QA: DW-569, iris_macro_info keeps its empty result only for an empty document name (AC-2; OD-2)", () => {
  const BODY = (docname: string): Json => ({ docname, macroname: "OK", includes: [] });
  const DEFINITION = { content: { definition: ["#define OK 1"] } };
  const LOCATION = { content: { document: "%occStatus.inc", line: 7 } };

  /** Atelier's answers: 400 with no error list for an empty document name, 200 for any other, a different result per route. */
  const atelier = (request: RecordedRequest): Answer => {
    const docname = String((JSON.parse(request.body) as { docname?: unknown }).docname ?? "");
    if (docname === "") return { status: 400, body: okBody({}) };
    return { status: 200, body: okBody(request.url.endsWith("/getmacrodefinition") ? DEFINITION : LOCATION) };
  };
  const EMPTY = { name: "OK", definition: {}, location: {} };

  it("no document, and document \"\": today's output byte for byte, from two POSTs with an empty docname", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    for (const args of [{ name: "OK" }, { name: "OK", document: "" }]) {
      const { result, sent } = await drive(atelier, () => wire.dev.call("iris_macro_info", args), 2);
      expect(result.isError, allText(result)).toBeFalsy();
      expect(result.structuredContent, JSON.stringify(args)).toEqual(EMPTY);
      expect(result.content, JSON.stringify(args)).toEqual([{ type: "text", text: JSON.stringify(EMPTY, null, 2) }]);
      expect(sent.map((request) => `${request.method} ${request.url.replace(/^\/api\/atelier\/v\d+\/HSCUSTOM/, "")}`).sort()).toEqual([
        "POST /action/getmacrodefinition",
        "POST /action/getmacrolocation",
      ]);
      for (const request of sent) expect(JSON.parse(request.body), JSON.stringify(args)).toEqual(BODY(""));
    }
  }, 60000);

  it("with a document: the definition and the location come from their own routes, as the routes answered", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const { result, sent } = await drive(atelier, () => wire.dev.call("iris_macro_info", { name: "OK", document: "KEEPME397Q.A.cls" }), 2);
    expect(result.isError, allText(result)).toBeFalsy();
    expect(result.structuredContent).toEqual({ name: "OK", definition: DEFINITION, location: LOCATION });
    for (const request of sent) expect(JSON.parse(request.body)).toEqual(BODY("KEEPME397Q.A.cls"));
  }, 60000);

  it("with a document, HTTP 400 with no error list is an error (the fallback is for an empty name only)", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const { result } = await drive(fixed(400, okBody({})), () => wire.dev.call("iris_macro_info", { name: "OK", document: "KEEPME397Q.A.cls" }), 2);
    expect(result.isError, allText(result)).toBe(true);
    expect(allText(result)).toContain("HTTP 400");
  }, 60000);

  it("with no document, any other failure is an error: a 404, a 500, and a 400 that lists errors", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const listed = JSON.stringify({ status: { errors: [{ error: "ERROR #5001: refused", code: 5001 }], summary: "" }, console: [], result: {} });
    for (const [label, answer] of [
      ["404", fixed(404, EMPTY_ERRORS_BODY)],
      ["500", fixed(500, EMPTY_ERRORS_BODY)],
      ["400 with errors", fixed(400, listed)],
    ] as const) {
      const { result } = await drive(answer, () => wire.dev.call("iris_macro_info", { name: "OK" }), 2);
      expect(result.isError, `${label}: ${allText(result)}`).toBe(true);
      expect(allText(result), label).toMatch(/HTTP 40[04]|HTTP 500|reported errors/);
    }
  }, 120000);
});

// -- DW-576: logs and diagram under the PHI data policy -------------------------------------------------------------

/** The Event Log route's reply (the entry keys in the order `Interop.cls` writes them) and the same entries with the text withheld. */
const LOG_RESULT = {
  entries: [
    { id: 2, timestamp: "2001-02-03 12:00:05.000", type: 4, itemName: "Story397Q.Service", text: `${KEEP}-LOG-2 ${MARK}-LOG-2` },
    {
      id: 1,
      timestamp: "2001-02-03 12:00:04.000",
      type: 2,
      itemName: "Story397Q.Operation",
      text: `${MARK}-LOG-1 PID|1||${MARK}-MRN-D`,
      sourceClass: "Story397Q.Seed",
      sourceMethod: "Seed",
      sessionId: 397002,
    },
  ],
  count: 2,
};
const TEXT_POLICY = { outcome: "blocked", reason: EVENT_LOG_REASON };
const BLOCKED_LOG_RESULT = {
  entries: [
    { id: 2, timestamp: "2001-02-03 12:00:05.000", type: 4, itemName: "Story397Q.Service", textPolicy: TEXT_POLICY },
    {
      id: 1,
      timestamp: "2001-02-03 12:00:04.000",
      type: 2,
      itemName: "Story397Q.Operation",
      textPolicy: TEXT_POLICY,
      sourceClass: "Story397Q.Seed",
      sourceMethod: "Seed",
      sessionId: 397002,
    },
  ],
  count: 2,
  dataPolicy: { policy: "block", redacted: 0, blocked: 2 },
};

const ERROR_1 = `Error on message 4: ${MARK}-ERR PID|1||${MARK}-MRN-D`;
const ERROR_2 = `Error on message 77: ${MARK}-LOOP-ERR`;
const UNPAIRED = "Unpaired response: message 9 (Story397Q.Router -> Story397Q.Service) emitted standalone";
const MERMAID_1 = [
  "sequenceDiagram",
  "%% Session 397002: 4 messages, 2001-02-03 12:00:03 to 12:00:04",
  "participant Story397Q_Service as Story397Q.Service",
  "participant Story397Q_Operation as Story397Q.Operation",
  "Story397Q_Service->>Story397Q_Operation: Story397Q.Req",
  "Story397Q_Operation->>Story397Q_Service: Story397Q.Resp [ERROR]",
  `%% ${ERROR_1}`,
].join("\n");
const MERMAID_2 = [
  "sequenceDiagram",
  "%% Session 397003: 7 messages, 2001-02-03 12:00:05 to 12:00:07",
  "participant Story397Q_Service as Story397Q.Service",
  "participant Story397Q_Router as Story397Q.Router",
  "loop 3 times",
  "  Story397Q_Service->>Story397Q_Router: Story397Q.Req",
  "  Story397Q_Router->>Story397Q_Service: Story397Q.Resp [ERROR]",
  `  %% ${ERROR_2}`,
  "end",
  `%% ${UNPAIRED}`,
].join("\n");
const DIAGRAM_RESULT = {
  diagrams: [
    { sessionId: 397002, mermaid: MERMAID_1, messageCount: 4, warnings: [ERROR_1], truncated: false },
    { sessionId: 397003, mermaid: MERMAID_2, messageCount: 7, warnings: [ERROR_2, UNPAIRED], truncated: false },
  ],
  count: 2,
};
const withheld = (text: string): string => text.replace(/(Error on message \d+: ).*/g, `$1${DIAGRAM_REASON}`);
const BLOCKED_DIAGRAM_RESULT = {
  diagrams: [
    { sessionId: 397002, mermaid: withheld(MERMAID_1), messageCount: 4, warnings: [`Error on message 4: ${DIAGRAM_REASON}`], truncated: false },
    {
      sessionId: 397003,
      mermaid: withheld(MERMAID_2),
      messageCount: 7,
      warnings: [`Error on message 77: ${DIAGRAM_REASON}`, UNPAIRED],
      truncated: false,
    },
  ],
  count: 2,
  dataPolicy: { policy: "block", redacted: 0, blocked: 2 },
};

/** The text block of a diagram, from the tool's documented template: a summary line, then the fenced Mermaid text. */
const fence = (sessionId: number, count: number, warnings: number, mermaid: string): string =>
  `Session ${sessionId}: ${count} message${count === 1 ? "" : "s"} (${warnings} warning${warnings === 1 ? "" : "s"})\n\`\`\`mermaid\n${mermaid}\n\`\`\``;

const logsFor = (s: AuditedSession): Promise<WireToolResult> => s.session.call("iris_production_logs", { namespace: "HSCUSTOM", count: 10 });
const diagramFor = (s: AuditedSession): Promise<WireToolResult> => s.session.call("iris_message_diagram", { namespace: "HSCUSTOM", sessionIds: [397002, 397003] });

/** One more round trip, so every line the server wrote to stderr while it handled the calls has been read. */
async function flush(s: AuditedSession): Promise<void> {
  await s.session.listTools();
}

const SESSIONS = (): Array<[string, AuditedSession]> => [
  ["redact", redactS],
  ["allow", allowS],
  ["block", blockS],
];

describe("Story 39.7 QA: DW-576, iris_production_logs under each data policy on the built interop server (AC-5; AD-15, AD-19, AD-26)", () => {
  it("redact and allow: the text, the structured output and the entry order are the route's reply byte for byte, with no dataPolicy and no textPolicy", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    for (const [label, s] of [["redact", redactS], ["allow", allowS]] as const) {
      const { result, sent } = await drive(fixed(200, okBody(LOG_RESULT)), () => logsFor(s));
      expect(sent, `${label}: ${JSON.stringify(sent)}`).toHaveLength(1);
      expect(sent[0]?.url, label).toMatch(/^\/api\/executemcp\/v2\/interop\/production\/logs\?namespace=HSCUSTOM&count=10$/);
      expect(result.isError, `${label}: ${allText(result)}`).toBeFalsy();
      expect(result.content, label).toEqual([{ type: "text", text: JSON.stringify(LOG_RESULT, null, 2) }]);
      expect(result.structuredContent, label).toEqual(LOG_RESULT);
      expect(Object.keys(result.structuredContent ?? {}), `${label}: the route's keys only`).toEqual(["entries", "count"]);
      expect(JSON.stringify(result), `${label}: no textPolicy`).not.toContain("textPolicy");
      expect(JSON.stringify(result), `${label}: the text is shown (the positive control)`).toContain(`${MARK}-LOG-1`);
    }
  }, 60000);

  it("block: every entry loses its text in place, gains textPolicy with the fixed reason, keeps its other keys and order, and the result counts them", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const { result } = await drive(fixed(200, okBody(LOG_RESULT)), () => logsFor(blockS));
    expect(result.isError, allText(result)).toBeFalsy();
    expect(result.structuredContent).toEqual(BLOCKED_LOG_RESULT);
    const entries = (result.structuredContent as { entries: Json[] }).entries;
    expect(entries.map((entry) => Object.keys(entry)), "textPolicy takes the place of text, the other keys keep their order").toEqual([
      ["id", "timestamp", "type", "itemName", "textPolicy"],
      ["id", "timestamp", "type", "itemName", "textPolicy", "sourceClass", "sourceMethod", "sessionId"],
    ]);
    expect(result.content).toEqual([{ type: "text", text: JSON.stringify(BLOCKED_LOG_RESULT, null, 2) }]);
    expect(JSON.stringify(result), "no identifying value anywhere in the result").not.toContain(MARK);
    expect(JSON.stringify(result), "nor the surviving value of the other entry: the whole text is withheld").not.toContain(KEEP);
  }, 60000);

  it("an empty entry list under block is {entries: [], count: 0} with a dataPolicy that counts none", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const empty = { entries: [], count: 0 };
    const { result } = await drive(fixed(200, okBody(empty)), () => logsFor(blockS));
    expect(result.structuredContent).toEqual({ entries: [], count: 0, dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
    const open = await drive(fixed(200, okBody(empty)), () => logsFor(redactS));
    expect(open.result.structuredContent, "under redact the empty result is the route's").toEqual(empty);
  }, 60000);

  it("a failed read: the text is the same under every policy; redact and allow add no structured output at all, block adds dataPolicy with no counts", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    // A namespace without Interoperability answers HTTP 200 with the SQL error in status.errors (captured live 2026-10-17, see the header).
    const notConfigured = JSON.stringify({
      status: {
        errors: [{ error: "ERROR #5001: SQL error:  Table 'ENS_UTIL.LOG' not found", code: 5001, domain: "%ObjectErrors", id: "GeneralError", params: [] }],
        summary: "ERROR #5001: SQL error:  Table 'ENS_UTIL.LOG' not found",
      },
      console: [],
      result: {},
    });
    const answers: Array<[string, Answer, string]> = [
      ["HTTP 500 with an empty error list", { status: 500, body: EMPTY_ERRORS_BODY }, "IRIS returned HTTP 500 for GET"],
      ["HTTP 400 with an empty error list", { status: 400, body: EMPTY_ERRORS_BODY }, "IRIS returned HTTP 400 for GET"],
      ["HTTP 200 listing an error (no Interoperability)", { status: 200, body: notConfigured }, "IRIS reported errors for GET"],
    ];
    for (const [what, answer, phrase] of answers) {
      let first = "";
      for (const [label, s] of SESSIONS()) {
        const { result, sent } = await drive(fixed(answer.status, answer.body), () => logsFor(s));
        expect(sent, `${what}, ${label}`).toHaveLength(1);
        expect(result.isError, `${what}, ${label}`).toBe(true);
        const text = allText(result);
        expect(text, `${what}, ${label}`).toContain(`Error querying production logs: ${phrase} ${sent[0]?.url}`);
        first ||= text;
        expect(text, `${what}, ${label}: the same text under every policy`).toBe(first);
        if (label === "block") {
          expect(result.structuredContent, `${what}, block`).toEqual({ dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
        } else {
          expect(Object.keys(result).sort(), `${what}, ${label}: content and isError only, as before`).toEqual(["content", "isError"]);
        }
      }
    }
  }, 120000);
});

describe("Story 39.7 QA: DW-576, iris_message_diagram under each data policy on the built interop server (AC-5; AD-15, AD-19, AD-26)", () => {
  it("redact and allow: the content blocks and the structured output are the route's reply byte for byte, with no dataPolicy", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    for (const [label, s] of [["redact", redactS], ["allow", allowS]] as const) {
      const { result, sent } = await drive(fixed(200, okBody(DIAGRAM_RESULT)), () => diagramFor(s));
      expect(sent, label).toHaveLength(1);
      expect(sent[0]?.url, label).toBe(
        "/api/executemcp/v2/interop/production/messages/diagram?namespace=HSCUSTOM&sessionIds=397002%2C397003&labelMode=full&maxRows=2000&dedup=true",
      );
      expect(result.isError, `${label}: ${allText(result)}`).toBeFalsy();
      expect(result.content, label).toEqual([
        { type: "text", text: fence(397002, 4, 1, MERMAID_1) },
        { type: "text", text: fence(397003, 7, 2, MERMAID_2) },
      ]);
      expect(result.structuredContent, label).toEqual(DIAGRAM_RESULT);
      expect(Object.keys(result.structuredContent ?? {}), `${label}: the route's keys only`).toEqual(["diagrams", "count"]);
      expect(allText(result), `${label}: the error text is shown (the positive control)`).toContain(`${MARK}-ERR`);
    }
  }, 60000);

  it("block: each error warning keeps its prefix and carries the fixed reason, in warnings[] and on every %% line (also inside a loop); other warnings and lines are untouched; the count is the warnings withheld", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const { result } = await drive(fixed(200, okBody(DIAGRAM_RESULT)), () => diagramFor(blockS));
    expect(result.isError, allText(result)).toBeFalsy();
    expect(result.structuredContent).toEqual(BLOCKED_DIAGRAM_RESULT);
    expect(result.content, "the content is rendered from the rewritten entries").toEqual([
      { type: "text", text: fence(397002, 4, 1, withheld(MERMAID_1)) },
      { type: "text", text: fence(397003, 7, 2, withheld(MERMAID_2)) },
    ]);
    const lines = (BLOCKED_DIAGRAM_RESULT.diagrams[1] as { mermaid: string }).mermaid.split("\n");
    expect(lines, "the loop's comment line keeps its indent").toContain(`  %% Error on message 77: ${DIAGRAM_REASON}`);
    expect(lines, "a warning that is not an error warning is untouched").toContain(`%% ${UNPAIRED}`);
    expect(JSON.stringify(result), "no identifying value anywhere in the result").not.toContain(MARK);
  }, 60000);

  it("a diagram with no error warning is the route's reply under block too, with a dataPolicy that counts none", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const plain = {
      diagrams: [{ sessionId: 397004, mermaid: `sequenceDiagram\n%% ${UNPAIRED}`, messageCount: 1, warnings: [UNPAIRED], truncated: false }],
      count: 1,
    };
    const { result } = await drive(fixed(200, okBody(plain)), () => diagramFor(blockS));
    expect(result.structuredContent).toEqual({ ...plain, dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
    expect(result.content).toEqual([{ type: "text", text: fence(397004, 1, 1, `sequenceDiagram\n%% ${UNPAIRED}`) }]);
  }, 60000);

  it("a failed read: the text is the same under every policy; redact and allow add no structured output at all, block adds dataPolicy with no counts", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    for (const [what, answer] of [
      ["HTTP 500 with an empty error list", { status: 500, body: EMPTY_ERRORS_BODY }],
      ["HTTP 400 with an empty error list", { status: 400, body: EMPTY_ERRORS_BODY }],
    ] as const) {
      let first = "";
      for (const [label, s] of SESSIONS()) {
        const { result, sent } = await drive(fixed(answer.status, answer.body), () => diagramFor(s));
        expect(sent, `${what}, ${label}`).toHaveLength(1);
        expect(result.isError, `${what}, ${label}`).toBe(true);
        const text = allText(result);
        expect(text, `${what}, ${label}`).toBe(`Error generating message diagram: IRIS returned HTTP ${answer.status} for GET ${sent[0]?.url}. Check the request parameters and try again.`);
        first ||= text;
        expect(text, `${what}, ${label}: the same text under every policy`).toBe(first);
        if (label === "block") {
          expect(result.structuredContent, `${what}, block`).toEqual({ dataPolicy: { policy: "block", redacted: 0, blocked: 0 } });
        } else {
          expect(Object.keys(result).sort(), `${what}, ${label}: content and isError only, as before`).toEqual(["content", "isError"]);
        }
      }
    }
  }, 120000);
});

describe("Story 39.7 QA: DW-576, the audit entry and the console log of each policy (AC-5; AD-19)", () => {
  it("the audit entries carry the policy and the counts the response reported, or the profile's policy with none; no audit file and no console log holds an identifying value", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const expected: Record<string, { logs: Json; diagram: Json }> = {
      redact: { logs: { policy: "redact", redacted: 0, blocked: 0 }, diagram: { policy: "redact", redacted: 0, blocked: 0 } },
      allow: { logs: { policy: "allow", redacted: 0, blocked: 0 }, diagram: { policy: "allow", redacted: 0, blocked: 0 } },
      block: { logs: { policy: "block", redacted: 0, blocked: 2 }, diagram: { policy: "block", redacted: 0, blocked: 2 } },
    };
    for (const [label, s] of SESSIONS()) {
      // The entries the earlier tests left in this session's file are not this test's: once they have all landed, it reads
      // only what its own four calls add.
      const before = await settledAuditCount(s.auditFile, 20);
      await drive(fixed(200, okBody(LOG_RESULT)), () => logsFor(s));
      await drive(fixed(200, okBody(DIAGRAM_RESULT)), () => diagramFor(s));
      await drive(fixed(500, EMPTY_ERRORS_BODY), () => logsFor(s));
      await drive(fixed(500, EMPTY_ERRORS_BODY), () => diagramFor(s));
      const all = await pollAuditEntries(s.auditFile, {
        count: before + 4,
        isWanted: () => true,
        returnAll: true,
        intervalMs: 20,
        timeoutMs: 10000,
        excerpt: 2000,
      });
      // The two successful reads carry the counts the response reported (block) or the profile's policy with none; each failed
      // read carries the profile's policy with no counts, because the failed read withheld nothing.
      const none: Json = { policy: label, redacted: 0, blocked: 0 };
      expect(
        all.slice(before).map((entry) => ({ tool: entry["tool"], outcome: entry["outcome"], dataPolicy: entry["dataPolicy"] })),
        `${label}: the four entries of the four calls, in order`,
      ).toEqual([
        { tool: "iris_production_logs", outcome: "ok", dataPolicy: expected[label]?.logs },
        { tool: "iris_message_diagram", outcome: "ok", dataPolicy: expected[label]?.diagram },
        { tool: "iris_production_logs", outcome: "error", dataPolicy: none },
        { tool: "iris_message_diagram", outcome: "error", dataPolicy: none },
      ]);
    }
    for (const [label, s] of SESSIONS()) {
      await flush(s);
      expect(s.stderr().length, `${label}: the server wrote to stderr (LOG_LEVEL=DEBUG)`).toBeGreaterThan(0);
      expect(readFileSync(s.auditFile, "utf8"), `${label}: the audit file`).not.toContain(MARK);
      expect(readFileSync(s.auditFile, "utf8"), `${label}: the audit file`).not.toContain(KEEP);
      expect(s.stderr(), `${label}: the console log`).not.toContain(MARK);
      expect(s.stderr(), `${label}: the console log`).not.toContain(KEEP);
    }
  }, 120000);
});
