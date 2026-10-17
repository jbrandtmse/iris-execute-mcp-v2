/**
 * Story 39.5 live gate: `iris_message_body`, driven on the REAL wire against disposable Interoperability
 * namespaces, in the default suite (rule #59: each row names the path it guards).
 *
 * Paths: the BUILT iris-interop-mcp dist, spawned as a child process and driven by the MCP SDK `Client` over
 * stdio, for every tool row. The built server's HTTP traffic to IRIS goes through a recording proxy (a local
 * listener that forwards every request to the real instance and keeps the body route's request and raw
 * response), so a row can prove what the tool ASKED IRIS for and what IRIS SENT before the tool applied the
 * policy: the policy's wire (`bodyRead`, `bodyTextMaxChars`) and the least exposure of `redact`. Raw HTTP
 * `POST`s to the route (past every MCP-layer check, so they exercise the handler's own guards) drive the
 * route rows. The oracles are SQL written by hand and run through the raw Atelier `action/query` route, the
 * fixture class's own texts, and IRIS's own HL7 parser (`Hl7Fields`).
 *
 * Fixtures (`interop-namespace-fixture.ts`): A (`EXECMCPTMP395A`) holds fixture kappa, seventeen headers with a
 * body of every kind; B (`EXECMCPTMP395B`) holds two headers whose bodies differ from A's; C
 * (`EXECMCPTMP395C`) has no Interoperability mappings at all, so it is the not-configured case. Every
 * identifying value contains `SYNTHPHI`; values that must survive contain `KEEPME`; times fall on
 * 2001-02-03 UTC. `beforeAll` removes leftovers by name (the Task 0 probe namespace `EXECMCPTMP395P` too) and
 * asserts there are none; `afterAll` removes the namespaces, their database files, the fixture class and the
 * temp files, and asserts nothing is left.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the three `EXECMCPTMP395*` namespaces and databases, and the HSCUSTOM class
 * `ExecuteMCPv2.Temp.Story391Fixture`. No production is started and no message of HSCUSTOM is read. A missing
 * or stale dist, an unresolvable SDK or an unreachable IRIS skips each row with the reason, or fails with "may
 * not be skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  allText,
  assertDeployedBootstrapVersion,
  atelierQuery,
  batchUnits,
  distEntry,
  executeMcpPost,
  fixtureDocumentNames,
  irisClassMethod,
  irisTargetFromEnv,
  isIrisReachable,
  openAuditedSession,
  openWireSession,
  pollAuditEntries,
  postEnvelope,
  resolveSdkEsmDir,
  skipTest,
  staleDistReason,
  teardownRecorder,
  type AuditedSession,
  type IrisTarget,
  type WireSession,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  FIXTURE_CLASS,
  FIXTURE_DOC,
  STORY395_IDS,
  createInteropNamespace,
  hl7Fields,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
  seedBodyReader,
} from "./interop-namespace-fixture.js";
import { checkRedactedPositions, separatorCharacters } from "../../../shared/src/__tests__/hl7-redaction-fixtures.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-39-5-body-reader-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The namespaces: A (fixture kappa), B (other bodies), C (not configured), the Task 0 probe, and one never created. */
const NS_A = "EXECMCPTMP395A";
const NS_B = "EXECMCPTMP395B";
const NS_C = "EXECMCPTMP395C";
const NS_PROBE = "EXECMCPTMP395P";
const NS_Z = "EXECMCPTMP395Z";
const NAMESPACES = [NS_A, NS_B, NS_C, NS_PROBE];

const BODY_ROUTE = "/interop/message/body";
const BODY_ROUTE_PATH = `/api/executemcp/v2${BODY_ROUTE}`;

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
/** How long the first built-server start took, which includes the bootstrap deployment. */
let firstStartMs = 0;
let tempDir = "";

function wireOptions(pkg: string, extra: Partial<WireSessionOptions> = {}): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "story-39-5-live-gate",
    ...extra,
  };
}

/** Sessions the rows open, closed in `afterAll`. */
const opened: WireSession[] = [];

// -- The recording proxy ----------------------------------------------------

/** One exchange with the body route: the JSON request body the tool sent and the raw response IRIS gave. */
interface RouteExchange {
  request: Record<string, unknown>;
  status: number;
  responseText: string;
}

interface RecordingProxy {
  port: number;
  /** Every exchange with the body route, oldest first; a row clears it with `exchanges.length = 0`. */
  exchanges: RouteExchange[];
  close: () => Promise<void>;
}

/** The response headers a proxy must not copy: the body it relays is decoded and re-framed. */
const HOP_HEADERS = new Set(["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie"]);

/**
 * A local HTTP listener that forwards every request to `upstream` unchanged and records the exchanges with
 * the body route. Nothing is modified, so a server pointed at it behaves exactly as it does against IRIS.
 */
async function startRecordingProxy(upstream: IrisTarget): Promise<RecordingProxy> {
  const exchanges: RouteExchange[] = [];
  const server = http.createServer((req, res) => {
    void (async () => {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) chunks.push(chunk as Buffer);
        const body = Buffer.concat(chunks);
        const headers: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
          if (["host", "connection", "content-length", "accept-encoding"].includes(key)) continue;
          if (typeof value === "string") headers[key] = value;
          else if (Array.isArray(value)) headers[key] = value.join(", ");
        }
        const method = req.method ?? "GET";
        const answer = await fetch(`http://${upstream.host}:${upstream.port}${req.url ?? "/"}`, {
          method,
          headers,
          ...(method === "GET" || method === "HEAD" ? {} : { body }),
          redirect: "manual",
        });
        const text = Buffer.from(await answer.arrayBuffer());
        if (method === "POST" && (req.url ?? "").split("?")[0] === BODY_ROUTE_PATH) {
          exchanges.push({
            request: JSON.parse(body.toString("utf8")) as Record<string, unknown>,
            status: answer.status,
            responseText: text.toString("utf8"),
          });
        }
        res.statusCode = answer.status;
        answer.headers.forEach((value, key) => {
          if (!HOP_HEADERS.has(key)) res.setHeader(key, value);
        });
        const cookies = answer.headers.getSetCookie();
        if (cookies.length > 0) res.setHeader("set-cookie", cookies);
        res.end(method === "HEAD" ? undefined : text);
      } catch (error) {
        res.statusCode = 502;
        res.end(error instanceof Error ? error.message : String(error));
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    exchanges,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

let proxy: RecordingProxy;

/** A session on the built interop server that talks to IRIS through the recording proxy and writes `audit-<label>.jsonl`. */
async function openThroughProxy(label: string, extraEnv: Record<string, string> = {}): Promise<AuditedSession> {
  const audited = await openAuditedSession(
    {
      ...wireOptions("iris-interop-mcp", { target: { ...TARGET, host: "127.0.0.1", port: String(proxy.port) } }),
      auditFile: path.join(tempDir, `audit-${label}.jsonl`),
    },
    extraEnv,
  );
  opened.push(audited.session);
  return audited;
}

/** A session on the built interop server that talks to IRIS directly. */
async function plainSession(extraEnv: Record<string, string> = {}): Promise<WireSession> {
  const session = await openWireSession(wireOptions("iris-interop-mcp"), extraEnv);
  opened.push(session);
  return session;
}

/** The three policy sessions: the default (redact), the operator's allow, and the operator's block. */
let redactS: AuditedSession;
let allowS: AuditedSession;
let blockS: AuditedSession;

// -- Reading results ------------------------------------------------------

type Item = Record<string, unknown>;

interface BodyContent {
  items: Item[];
  count: number;
  maxChars: number;
  dataPolicy: { policy: string; redacted: number; blocked: number };
  dataPolicyClamped?: boolean;
  notApplicable?: boolean;
  reason?: string;
}

const contentOf = (result: WireToolResult): BodyContent => result.structuredContent as unknown as BodyContent;
const itemOf = (content: BodyContent, id: number): Item => content.items.find((item) => item.id === id) as Item;

const IDS_17 = Array.from({ length: 17 }, (_, index) => index + 1);

/** `iris_message_body` on A through `session`; `args` overrides any field. */
function readBodies(session: WireSession, headerIds: Array<number | string> = IDS_17, args: Record<string, unknown> = {}): Promise<WireToolResult> {
  return session.call("iris_message_body", { namespace: NS_A, headerIds, ...args });
}

/** A successful read: no error, one text block. */
function succeeded(result: WireToolResult): BodyContent {
  expect(result.isError, allText(result)).toBeFalsy();
  expect(result.content, "one text block").toHaveLength(1);
  return contentOf(result);
}

/**
 * Every request to the body route that `action` caused, including the 401 challenges the server's client
 * answers with its credentials: a row that proves a call REACHED NO ROUTE uses this.
 */
async function requestsOf(action: () => Promise<unknown>): Promise<RouteExchange[]> {
  proxy.exchanges.length = 0;
  await action();
  return [...proxy.exchanges];
}

/** The exchanges IRIS served (not the 401 challenges) with the body route that `action` caused. */
async function exchangesOf(action: () => Promise<unknown>): Promise<RouteExchange[]> {
  return (await requestsOf(action)).filter((exchange) => exchange.status !== 401);
}

/** Every item the raw route response holds, in order. */
function rawItems(exchange: RouteExchange): Item[] {
  return (JSON.parse(exchange.responseText) as { result: { items: Item[] } }).result.items;
}

/** The kind of the body of each header of fixture kappa. */
const KAPPA_KINDS = [
  "hl7v2",
  "hl7v2",
  "stream",
  "persistent",
  "streamContainer",
  "missing",
  "literal",
  "hl7v2",
  "hl7v2",
  "xmlvdoc",
  "persistent",
  "persistent",
  "hl7v2",
  "hl7v2",
  "hl7v2",
  "hl7v2",
  "other",
];

/** The reasons, written by hand (not read from the shared module that the tool uses). */
const BLOCK_REASON = "The block data policy withholds every message body.";
const kindReason = (kind: string): string => `A ${kind} body cannot be redacted reliably, so the redact data policy withholds it.`;
const TOO_LARGE_REASON = "The HL7 v2 body is longer than 65536 characters, so the redact data policy withholds it.";
const MISSING_TEXT = "The body class is not compiled in this namespace, so the body cannot be read.";
const UNOPENED_TEXT = "The body does not open (it may have been purged), so it cannot be read.";
const tooLargeShown = (cap: number): string =>
  `The HL7 v2 body is longer than ${cap} characters, so it is not shown; a larger maxChars (at most 1048576) reads it whole.`;
const CLAMP_LINE = "The requested data policy allow is looser than the profile's redact, so redact applies.";

/** The expected outcome of each header of kappa under `redact`. */
const REDACT_OUTCOMES: Array<[number, "redacted" | "blocked" | "none", string?]> = [
  [1, "redacted"],
  [2, "redacted"],
  [3, "blocked", kindReason("stream")],
  [4, "blocked", kindReason("persistent")],
  [5, "blocked", kindReason("streamContainer")],
  [6, "none"],
  [7, "blocked", kindReason("literal")],
  [8, "redacted"],
  [9, "blocked", TOO_LARGE_REASON],
  [10, "blocked", kindReason("xmlvdoc")],
  [11, "blocked", kindReason("persistent")],
  [12, "blocked", kindReason("persistent")],
  [13, "blocked", TOO_LARGE_REASON],
  [14, "none"],
  [15, "redacted"],
  [16, "blocked", TOO_LARGE_REASON],
  [17, "none"],
];

/** Identifying values of non-HL7 bodies: under `redact` no response, raw or shaped, may hold one. */
const NON_HL7_SENTINELS = [
  "SYNTHPHI-S1",
  "SYNTHPHI-STRING",
  "SYNTHPHI-CONTAINER",
  "SYNTHPHI-LITERAL",
  "SYNTHPHI-XML",
  "SYNTHPHI-JSON",
  "SYNTHPHI-PLAIN",
  "SYNTHPHI-NOTE",
  "SYNTHPHI-PRIVATE",
  "SYNTHPHI-TAG",
];

/** The synthetic ER7 text `name` as the fixtures save it (CR-terminated). */
async function fixtureText(name: string): Promise<string> {
  return irisClassMethod(dev, NS_A, "Story395.Seed", "Hl7Text", [name]);
}

const lf = (text: string): string => text.replace(/\r\n|\r/g, "\n");

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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.5 live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  tempDir = mkdtempSync(path.join(tmpdir(), "story-39-5-gate-"));
  const started = performance.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  firstStartMs = Math.round(performance.now() - started);
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  await putFixtureClass(dev);
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS_A, { interop: true });
  await seedBodyReader(dev, NS_A, "a");
  await createInteropNamespace(admin, dev, NS_B, { interop: true });
  await seedBodyReader(dev, NS_B, "b");
  await createInteropNamespace(admin, dev, NS_C, { interop: false });

  // A positive control: the same check that must read empty after the run sees all three namespaces now.
  const present = await leftovers(dev, NAMESPACES);
  for (const name of [NS_A, NS_B, NS_C]) {
    expect(present, `the leftovers check sees ${name} while it exists`).toEqual(
      expect.arrayContaining([`namespace ${name}`, `database configuration ${name}`]),
    );
  }

  proxy = await startRecordingProxy(TARGET);
  redactS = await openThroughProxy("redact");
  allowS = await openThroughProxy("allow", { IRIS_DATA_POLICY: "allow" });
  blockS = await openThroughProxy("block", { IRIS_DATA_POLICY: "block" });
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
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story391", "Story395"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [...opened, admin, dev]) await session?.close();
    await proxy?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- Resolve (AC 39.5.1) --------------------------------------------------

describe("Story 39.5: headers are resolved in request order (AC-1)", () => {
  it("each class and ID equals the header oracle, each kind equals the kappa column, and the setup is the seed's own", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const seeded = await irisClassMethod(dev, NS_A, "Story395.Seed", "Hl7Text", ["adt"]);
    expect(seeded, "the fixture class is deployed and answers").toContain("SYNTHPHI-APP");
    expect(STORY395_IDS.a.headers).toBe(IDS_17.join(","));

    const oracle = await atelierQuery(
      { ...TARGET, namespace: NS_A },
      "SELECT ID, MessageBodyClassName, MessageBodyId FROM Ens.MessageHeader ORDER BY ID",
    );
    expect(oracle.map((row) => Number(row["ID"])), "the oracle holds the seventeen headers").toEqual(IDS_17);

    const content = succeeded(await readBodies(allowS.session));
    expect(content.items.map((item) => item.id), "request order").toEqual(IDS_17);
    expect(content.count).toBe(17);
    expect(content.items.map((item) => [item.bodyClassName, item.bodyId])).toEqual(
      oracle.map((row) => [String(row["MessageBodyClassName"]), String(row["MessageBodyId"])]),
    );
    expect(content.items.map((item) => item.bodyKind)).toEqual(KAPPA_KINDS);
  }, 120000);

  it("a header that does not exist is found: false with its own text, and a repeated ID is a repeated item", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded(await readBodies(redactS.session, [1, 999, 1]));
    expect(content.items.map((item) => item.id)).toEqual([1, 999, 1]);
    expect(content.items[1]).toEqual({ id: 999, found: false, error: "Header 999 not found" });
    expect(content.items[0]).toEqual(content.items[2]);
    expect(content.count).toBe(3);
  }, 120000);

  it("a bad input is a validation error before any request (the tool's schema; the route is never called)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const rows: Array<[Record<string, unknown>, string]> = [
      [{ headerIds: [] }, "headerIds"],
      [{ headerIds: Array.from({ length: 21 }, (_, i) => i + 1) }, "headerIds"],
      [{ headerIds: ["0"] }, "headerIds"],
      [{ headerIds: [1.5] }, "headerIds"],
      [{ headerIds: [1], maxChars: 0 }, "maxChars"],
      [{ headerIds: [1], maxChars: 1048577 }, "maxChars"],
      [{ headerIds: [1], dataPolicy: "open" }, "dataPolicy"],
    ];
    const seen = await requestsOf(async () => {
      for (const [args, field] of rows) {
        const result = await redactS.session.call("iris_message_body", { namespace: NS_A, ...args });
        expect(result.isError, JSON.stringify(args)).toBe(true);
        expect(allText(result), JSON.stringify(args)).toContain(field);
      }
    });
    expect(seen, "no row reached the route").toEqual([]);
  }, 120000);
});

// -- The renderers under allow (AC 39.5.2) -----------------------------------

describe("Story 39.5: every kind renders as the renderer table says under allow (AC-2, Rule #56)", () => {
  it("the kappa allow column: the texts equal their recordings, the fixture's own texts and the dump rules", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const adt = await fixtureText("adt");
    const ack = await fixtureText("ack");
    const alt = await fixtureText("alt");
    const batchSmall = await fixtureText("batchSmall");
    const streamText = await irisClassMethod(dev, NS_A, FIXTURE_CLASS, "StreamText", []);
    expect(streamText.length, "the stream fixture").toBe(1500);

    const content = succeeded(await readBodies(allowS.session));
    const by = (id: number): Item => itemOf(content, id);

    expect(by(1)).toMatchObject({ format: "er7", text: lf(adt), truncated: false, bodyPolicy: { outcome: "none" } });
    expect(by(2)).toMatchObject({ format: "er7", text: lf(ack), truncated: false });
    expect(by(3)).toMatchObject({ format: "text", text: lf(streamText), truncated: false });
    expect(by(4)).toMatchObject({ format: "json", text: '{"StringValue":"SYNTHPHI-STRING"}', truncated: false });
    expect(by(5)).toMatchObject({ format: "text", text: "SYNTHPHI-CONTAINER", truncated: false });
    expect(by(6)).toMatchObject({ bodyPolicy: { outcome: "none" }, notShown: MISSING_TEXT });
    expect(by(7)).toMatchObject({ format: "text", text: "SYNTHPHI-LITERAL", bodyId: "SYNTHPHI-LITERAL", truncated: false });
    expect(by(8)).toMatchObject({ format: "er7", text: lf(alt), truncated: false });
    expect(by(9)).toMatchObject({ bodyPolicy: { outcome: "none" }, notShown: tooLargeShown(65536) });
    // The Task 0 (c) and (d) recordings.
    expect(by(10)).toMatchObject({
      format: "xml",
      text: "<Patient><Name>SYNTHPHI-XML-NAME</Name><Code>KEEPME-XML</Code></Patient>",
      truncated: false,
    });
    expect(by(11)).toMatchObject({ format: "json", text: '{"Name":"SYNTHPHI-JSON-NAME","Code":"KEEPME-JSON"}', truncated: false });
    // The dump rules: header 12's Ref is header 4's string body.
    const stringId = String(by(4).bodyId);
    expect(by(12)).toMatchObject({
      format: "json",
      text:
        '{"Name":"SYNTHPHI-PLAIN","Count":"7","Tags":{"collection":"list","count":1},' +
        '"Note":{"stream":"%Stream.GlobalCharacter","size":13},' +
        `"Ref":{"class":"Ens.StringRequest","id":"${stringId}"}}`,
      truncated: false,
    });
    expect(String(by(12).text)).not.toContain("SYNTHPHI-PRIVATE");
    expect(String(by(12).text)).not.toContain("SYNTHPHI-NOTE");
    expect(by(13)).toMatchObject({ bodyPolicy: { outcome: "none" }, notShown: tooLargeShown(65536) });
    expect(by(14)).toMatchObject({ bodyPolicy: { outcome: "none" }, notShown: UNOPENED_TEXT });
    expect(by(15)).toMatchObject({ format: "er7", text: lf(batchSmall), truncated: false });
    expect(by(16)).toMatchObject({ bodyPolicy: { outcome: "none" }, notShown: tooLargeShown(65536) });
    expect(by(17)).toMatchObject({ bodyPolicy: { outcome: "none" }, notShown: UNOPENED_TEXT });
    expect(content.dataPolicy).toEqual({ policy: "allow", redacted: 0, blocked: 0 });
    expect(JSON.stringify(content), "SYNTHPHI appears under allow (the positive control)").toContain("SYNTHPHI");
    // A text is one string with LF line ends: no CR reaches the result.
    expect(JSON.stringify(content)).not.toContain("\\r");
  }, 120000);

  it("a larger maxChars reads a longer HL7 v2 body whole, and the largest message is still too large", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const wire = await exchangesOf(async () => {
      const content = succeeded(await readBodies(allowS.session, IDS_17, { maxChars: 100000 }));
      const big = itemOf(content, 9);
      expect(big).toMatchObject({ format: "er7", truncated: false });
      expect(String(big.text)).toHaveLength(70180);
      expect(String(big.text).startsWith("MSH|^~\\&|SYNTHPHI-APP|")).toBe(true);
      const batch = itemOf(content, 16);
      expect(batch).toMatchObject({ format: "er7", truncated: false });
      expect(String(batch.text)).toHaveLength(90514);
      expect(String(batch.text).startsWith("FHS|^~\\&|SYNTHPHI-FAPP\n")).toBe(true);
      expect(itemOf(content, 13)).toMatchObject({ notShown: tooLargeShown(100000) });
    });
    expect(wire).toHaveLength(1);
    expect(wire[0]?.request).toMatchObject({ bodyRead: "all", bodyTextMaxChars: 100000 });

    const widest = succeeded(await readBodies(allowS.session, [13], { maxChars: 1048576 }));
    expect(widest.items[0]).toMatchObject({ notShown: tooLargeShown(1048576) });
    expect(widest.items[0]).not.toHaveProperty("text");
  }, 120000);

  it("maxChars cuts each shown text at maxChars with truncated: true, and a text that fits is whole", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const adt = lf(await fixtureText("adt"));
    const content = succeeded(await readBodies(allowS.session, IDS_17, { maxChars: 100 }));
    // The XML text is 72 characters, so it fits a cap of 100; the texts of 1, 3 and 12 are longer.
    for (const id of [1, 3, 12]) {
      const item = itemOf(content, id);
      expect(String(item.text), `item ${id}`).toHaveLength(100);
      expect(item.truncated, `item ${id}`).toBe(true);
    }
    expect(itemOf(content, 1).text).toBe(adt.slice(0, 100));
    expect(itemOf(content, 10)).toMatchObject({ truncated: false });
    expect(String(itemOf(content, 10).text)).toHaveLength(72);
    // An HL7 v2 body longer than the read limit is still too large: maxChars never lowers the limit.
    expect(itemOf(content, 9)).toMatchObject({ notShown: tooLargeShown(65536) });

    const narrow = succeeded(await readBodies(allowS.session, [10, 11], { maxChars: 50 }));
    expect(narrow.items[0]).toMatchObject({ truncated: true });
    expect(String(narrow.items[0]?.text)).toHaveLength(50);
    expect(narrow.items[1]).toMatchObject({ truncated: false });
  }, 120000);
});

// -- The policy: redact, block, allow (AC 39.5.3, 39.5.5) ---------------------

describe("Story 39.5: the policy per body under redact (the default), block and allow (AC-3, AC-4)", () => {
  it("redact: HL7 v2 is redacted whole, every other body is withheld, and the counts are 4 redacted and 10 withheld", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const started = performance.now();
    let content!: BodyContent;
    let result!: WireToolResult;
    const wire = await exchangesOf(async () => {
      result = await readBodies(redactS.session);
      content = succeeded(result);
    });
    const elapsedMs = Math.round(performance.now() - started);
    // eslint-disable-next-line no-console
    console.log(`[perf] story-39-5: one redact read of [1..17] took ${elapsedMs} ms (budget 2000 ms)`);
    expect(elapsedMs, "one redact read of 17 headers stays inside the 2 s read budget").toBeLessThan(2000);

    for (const [id, outcome, reason] of REDACT_OUTCOMES) {
      const item = itemOf(content, id);
      expect(item.bodyKind, `item ${id}`).toBe(KAPPA_KINDS[id - 1]);
      if (outcome === "redacted") {
        expect(item.bodyPolicy, `item ${id}`).toMatchObject({ outcome: "redacted" });
        expect((item.bodyPolicy as { redactedFields: number }).redactedFields, `item ${id}`).toBeGreaterThan(0);
        expect(item.format, `item ${id}`).toBe("er7");
        expect(String(item.text), `item ${id}`).toContain("***");
      } else if (outcome === "blocked") {
        expect(item.bodyPolicy, `item ${id}`).toEqual({ outcome: "blocked", reason });
        expect(item.notShown, `item ${id}`).toBe(reason);
        expect(item).not.toHaveProperty("text");
      } else {
        expect(item.bodyPolicy, `item ${id}`).toEqual({ outcome: "none" });
      }
    }
    expect(itemOf(content, 7).bodyId, "the value of a literal header is not shown").toBe("");
    expect(content.dataPolicy).toEqual({ policy: "redact", redacted: 4, blocked: 10 });
    expect(content).not.toHaveProperty("dataPolicyClamped");

    // The redaction keeps what the keep-list keeps and nothing identifying.
    expect(String(itemOf(content, 1).text)).toContain("KEEPME-GLUCOSE");
    expect(String(itemOf(content, 8).text).startsWith("MSH#!@$%#")).toBe(true);
    expect(JSON.stringify(result), "no identifying value anywhere in the result, content and structuredContent").not.toContain("SYNTHPHI");
    const lines = allText(result).split("\n");
    expect(lines[lines.length - 1]).toBe("Data policy redact: 4 redacted, 10 withheld.");

    // What the tool asked IRIS for, and what IRIS sent (least exposure: the route never read a non-HL7 body).
    expect(wire).toHaveLength(1);
    expect(wire[0]?.request).toEqual({ headerIds: IDS_17, namespace: NS_A, bodyRead: "hl7", bodyTextMaxChars: 65536 });
    const raw = wire[0]?.responseText ?? "";
    for (const sentinel of NON_HL7_SENTINELS) expect(raw, `the route's raw response: ${sentinel}`).not.toContain(sentinel);
    const withText = rawItems(wire[0] as RouteExchange)
      .filter((item) => "bodyText" in item)
      .map((item) => item.id);
    expect(withText, "IRIS sent text for the available HL7 v2 bodies that fit, and for no other body").toEqual([1, 2, 8, 15]);
    expect(rawItems(wire[0] as RouteExchange).find((item) => item.id === 7)).not.toHaveProperty("bodyId");
  }, 120000);

  it("redaction runs on the complete text, before truncation: maxChars 5 keeps the first 5 characters of the REDACTED text", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const whole = itemOf(succeeded(await readBodies(redactS.session, [1])), 1);
    const cut = itemOf(succeeded(await readBodies(redactS.session, [1], { maxChars: 5 })), 1);
    expect(cut.bodyPolicy).toEqual(whole.bodyPolicy);
    expect(cut.text).toBe(String(whole.text).slice(0, 5));
    expect(cut.text).toBe("MSH|^");
    expect(cut.truncated).toBe(true);
    const mid = succeeded(await readBodies(redactS.session, [1], { maxChars: 150 }));
    expect(JSON.stringify(mid), "a cut inside a segment holds no identifying value").not.toContain("SYNTHPHI");
  }, 120000);

  it("block: no text anywhere, the counts are 0 and 14, and the tool asked IRIS for the kind only", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    let result!: WireToolResult;
    const wire = await exchangesOf(async () => {
      result = await readBodies(blockS.session);
    });
    const content = succeeded(result);
    for (const item of content.items) {
      expect(item, `item ${String(item.id)}`).not.toHaveProperty("text");
      expect(item, `item ${String(item.id)}`).not.toHaveProperty("format");
    }
    const blocked = content.items
      .filter((item) => (item.bodyPolicy as { outcome: string }).outcome === "blocked")
      .map((item) => Number(item.id));
    expect(blocked).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 15, 16]);
    for (const id of blocked) expect(itemOf(content, id).bodyPolicy).toEqual({ outcome: "blocked", reason: BLOCK_REASON });
    expect(content.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 14 });
    expect(itemOf(content, 7).bodyId).toBe("");
    expect(JSON.stringify(result)).not.toContain("SYNTHPHI");

    expect(wire).toHaveLength(1);
    expect(wire[0]?.request).toEqual({ headerIds: IDS_17, namespace: NS_A, bodyRead: "kind", bodyTextMaxChars: 65536 });
    expect(wire[0]?.responseText, "IRIS sent no body content at all").not.toContain("SYNTHPHI");
    expect(wire[0]?.responseText).not.toContain('"bodyText"');
  }, 120000);

  it("allow: the wire reads every kind with the limit max(maxChars, 65536)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const wire = await exchangesOf(async () => {
      succeeded(await readBodies(allowS.session, [1, 3]));
    });
    expect(wire[0]?.request).toEqual({ headerIds: [1, 3], namespace: NS_A, bodyRead: "all", bodyTextMaxChars: 65536 });
  }, 120000);

  it("a caller dataPolicy only tightens: allow + redact is redact; redact + allow is redact, clamped; allow + block is block", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    let tightened!: WireToolResult;
    const first = await exchangesOf(async () => {
      tightened = await readBodies(allowS.session, IDS_17, { dataPolicy: "redact" });
    });
    expect(succeeded(tightened).dataPolicy).toEqual({ policy: "redact", redacted: 4, blocked: 10 });
    expect(contentOf(tightened)).not.toHaveProperty("dataPolicyClamped");
    expect(first[0]?.request).toMatchObject({ bodyRead: "hl7" });
    expect(JSON.stringify(tightened)).not.toContain("SYNTHPHI");

    let clamped!: WireToolResult;
    const second = await exchangesOf(async () => {
      clamped = await readBodies(redactS.session, IDS_17, { dataPolicy: "allow" });
    });
    expect(succeeded(clamped).dataPolicy).toEqual({ policy: "redact", redacted: 4, blocked: 10 });
    expect(contentOf(clamped).dataPolicyClamped).toBe(true);
    const lines = allText(clamped).split("\n");
    expect(lines[lines.length - 1]).toBe(CLAMP_LINE);
    expect(second[0]?.request).toMatchObject({ bodyRead: "hl7" });
    expect(JSON.stringify(clamped)).not.toContain("SYNTHPHI");

    let strict!: WireToolResult;
    const third = await exchangesOf(async () => {
      strict = await readBodies(allowS.session, IDS_17, { dataPolicy: "block" });
    });
    expect(succeeded(strict).dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 14 });
    expect(third[0]?.request).toMatchObject({ bodyRead: "kind" });
    expect(JSON.stringify(strict)).not.toContain("SYNTHPHI");
  }, 120000);

  it("a policy per profile: the loose profile shows the values, the default profile does not", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const session = await plainSession({ IRIS_PROFILES: JSON.stringify({ loose: { dataPolicy: "allow" } }) });
    const loose = await session.callOn("loose", "iris_message_body", { namespace: NS_A, headerIds: IDS_17 });
    expect(succeeded(loose).dataPolicy).toEqual({ policy: "allow", redacted: 0, blocked: 0 });
    expect(JSON.stringify(loose), "the loose profile shows SYNTHPHI").toContain("SYNTHPHI");

    const standard = await readBodies(session);
    expect(succeeded(standard).dataPolicy).toEqual({ policy: "redact", redacted: 4, blocked: 10 });
    expect(JSON.stringify(standard), "the default profile does not").not.toContain("SYNTHPHI");
  }, 120000);
});

// -- The redaction against IRIS's own parser (Rule #36) ------------------------

describe("Story 39.5: the redacted texts, parsed by IRIS before and after (AC-4, Rule #36)", () => {
  it("headers 1, 2, 8 and 15 keep IRIS's value at each kept position and hold only *** and separators at every other", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const engine = (await import(pathToFileURL(path.join(REPO_ROOT, "packages", "shared", "dist", "index.js")).href)) as {
      HL7_SAFE_HARBOR_FIELDS: ReadonlyArray<{ segment: string; field: number; category: string }>;
    };
    const original = succeeded(await readBodies(allowS.session, [1, 2, 8, 15], { maxChars: 65536 }));
    const redacted = succeeded(await readBodies(redactS.session, [1, 2, 8, 15], { maxChars: 65536 }));

    for (const id of [1, 2, 8, 15]) {
      const allowText = String(itemOf(original, id).text).replace(/\n/g, "\r");
      const redactText = String(itemOf(redacted, id).text).replace(/\n/g, "\r");
      expect(allowText, `header ${id}: the allow text is the positive control`).toContain("SYNTHPHI");
      expect(redactText, `header ${id}`).not.toContain("SYNTHPHI");

      const pairs: Array<[string, string]> =
        id === 15 ? batchUnits(allowText).map((unit, index) => [unit, batchUnits(redactText)[index] as string]) : [[allowText, redactText]];
      expect(pairs.length, `header ${id}: the units compared`).toBe(id === 15 ? 4 : 1);
      for (const [before, after] of pairs) {
        const parsedBefore = await hl7Fields(dev, NS_A, before);
        const parsedAfter = await hl7Fields(dev, NS_A, after);
        expect(parsedBefore.length, `header ${id}: IRIS parsed the original`).toBeGreaterThan(0);
        expect(checkRedactedPositions(parsedBefore, parsedAfter, separatorCharacters(before)), `header ${id}`).toEqual([]);

        const separators = separatorCharacters(before);
        for (const entry of engine.HL7_SAFE_HARBOR_FIELDS) {
          for (const segment of parsedAfter.filter((candidate) => candidate.name === entry.segment)) {
            const value = segment.fields[entry.field - 1] ?? "";
            const bare = [...value].filter((ch) => !separators.includes(ch)).join("");
            expect(bare, `header ${id}: ${entry.segment}-${entry.field} (category ${entry.category})`).toMatch(/^\**$/);
          }
        }
      }
    }
  }, 180000);
});

// -- The route (AD-11, AD-12, AD-13) -----------------------------------------------

describe("Story 39.5: the route reads least, and refuses before it switches namespace (AC-1, AC-3)", () => {
  it("kind reads no body; hl7 reads only HL7 v2 bodies; all reads every renderable kind", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const kind = await postEnvelope(TARGET, BODY_ROUTE, { headerIds: IDS_17, namespace: NS_A, bodyRead: "kind" });
    expect(kind.status).toBe(200);
    expect(kind.text).not.toContain("SYNTHPHI");
    expect(kind.text).not.toContain('"bodyText"');
    const defaulted = await postEnvelope(TARGET, BODY_ROUTE, { headerIds: IDS_17, namespace: NS_A });
    expect(defaulted.text, "an absent bodyRead is kind").toBe(kind.text);
    const nulled = await postEnvelope(TARGET, BODY_ROUTE, { headerIds: IDS_17, namespace: NS_A, bodyRead: null });
    expect(nulled.text, "a null bodyRead is kind").toBe(kind.text);
    expect((kind.result.items as Item[]).find((item) => item.id === 7), "no bodyId for a literal header").not.toHaveProperty("bodyId");

    const hl7 = await postEnvelope(TARGET, BODY_ROUTE, { headerIds: IDS_17, namespace: NS_A, bodyRead: "hl7" });
    const hl7Items = hl7.result.items as Item[];
    expect(hl7Items.filter((item) => "bodyText" in item).map((item) => item.id)).toEqual([1, 2, 8, 15]);
    expect(hl7Items.filter((item) => item.bodyTextOmitted === "tooLarge").map((item) => item.id)).toEqual([9, 13, 16]);
    expect(hl7Items.find((item) => item.id === 7)).not.toHaveProperty("bodyId");
    for (const sentinel of NON_HL7_SENTINELS) expect(hl7.text, sentinel).not.toContain(sentinel);

    const all = await postEnvelope(TARGET, BODY_ROUTE, { headerIds: IDS_17, namespace: NS_A, bodyRead: "all", bodyTextMaxChars: 1048576 });
    const allItems = all.result.items as Item[];
    expect(allItems.filter((item) => "bodyText" in item).map((item) => item.id)).toEqual([1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 15, 16]);
    expect(allItems.find((item) => item.id === 13)).toMatchObject({ bodyTextOmitted: "tooLarge" });
    expect(allItems.find((item) => item.id === 7)).toMatchObject({ bodyId: "SYNTHPHI-LITERAL", bodyText: "SYNTHPHI-LITERAL" });
  }, 120000);

  it("the cap is inclusive: an HL7 v2 body of L characters fits a cap of L and does not fit L - 1", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const whole = (await postEnvelope(TARGET, BODY_ROUTE, { headerIds: [1], namespace: NS_A, bodyRead: "hl7" })).result.items as Item[];
    const length = String(whole[0]?.bodyText).length;
    expect(length).toBeGreaterThan(100);
    const atCap = (await postEnvelope(TARGET, BODY_ROUTE, { headerIds: [1], namespace: NS_A, bodyRead: "hl7", bodyTextMaxChars: length })).result.items as Item[];
    expect(atCap[0]?.bodyText).toBe(whole[0]?.bodyText);
    const under = (await postEnvelope(TARGET, BODY_ROUTE, { headerIds: [1], namespace: NS_A, bodyRead: "hl7", bodyTextMaxChars: length - 1 })).result.items as Item[];
    expect(under[0]).toMatchObject({ bodyTextOmitted: "tooLarge" });
    expect(under[0]).not.toHaveProperty("bodyText");
  }, 120000);

  it("refuses a bad request, naming the parameter, with no namespace error: the checks run before the switch", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const ok = { headerIds: [1], namespace: NS_Z };
    const rows: Array<[Record<string, unknown>, string]> = [
      [{ namespace: NS_Z }, "headerIds"],
      [{ headerIds: [], namespace: NS_Z }, "headerIds"],
      [{ headerIds: Array.from({ length: 21 }, (_, i) => i + 1), namespace: NS_Z }, "headerIds"],
      [{ headerIds: ["x"], namespace: NS_Z }, "headerIds"],
      [{ ...ok, bodyRead: "raw" }, "bodyRead"],
      [{ ...ok, bodyRead: 5 }, "bodyRead"],
      [{ ...ok, bodyRead: "" }, "bodyRead"],
      [{ ...ok, bodyTextMaxChars: 0 }, "bodyTextMaxChars"],
      [{ ...ok, bodyTextMaxChars: 1048577 }, "bodyTextMaxChars"],
      [{ ...ok, bodyTextMaxChars: "x" }, "bodyTextMaxChars"],
    ];
    for (const [body, parameter] of rows) {
      const answer = await postEnvelope(TARGET, BODY_ROUTE, body);
      expect(answer.errors.length, JSON.stringify(body)).toBeGreaterThan(0);
      expect(answer.errors[0], JSON.stringify(body)).toContain(parameter);
      expect(answer.text, `${JSON.stringify(body)}: validation came before the namespace switch`).not.toContain("NAMESPACE");
      expect(answer.result, JSON.stringify(body)).toEqual({});
    }
    const hostile = await postEnvelope(TARGET, BODY_ROUTE, { ...ok, bodyRead: "ZZhostile'--OR 1=1" });
    expect(hostile.errors[0]).toContain("bodyRead");
    expect(hostile.text).not.toContain("ZZhostile");
  }, 120000);

  it("the limit is 20 headers: 20 are read, 21 are refused with the text of the limit of 20", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const twenty = Array.from({ length: 20 }, (_, index) => (index % 17) + 1);
    const accepted = await postEnvelope(TARGET, BODY_ROUTE, { headerIds: twenty, namespace: NS_A });
    expect(accepted.errors, "20 header IDs are accepted").toEqual([]);
    expect((accepted.result as { count?: number }).count, "one item per ID").toBe(20);
    expect(((accepted.result as { items: Item[] }).items).map((item) => item.id), "in request order, duplicates included").toEqual(twenty);

    const refused = await postEnvelope(TARGET, BODY_ROUTE, { headerIds: [...twenty, 1], namespace: NS_A });
    expect(refused.errors.length, "21 header IDs are refused").toBeGreaterThan(0);
    expect(refused.errors[0]).toContain("Parameter 'headerIds' must contain between 1 and 20 header IDs (found 21)");
    const missing = await postEnvelope(TARGET, BODY_ROUTE, { namespace: NS_A });
    expect(missing.errors[0]).toContain("Parameter 'headerIds' must be a non-empty array of 1-20 numeric header IDs");
  }, 120000);

  it("the resend preview keeps its own limit of 100 headers and its texts (ValidateHeaderIds at its default)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const preview = async (body: Record<string, unknown>): Promise<{ errors: string[]; result: Record<string, unknown> }> => {
      const answer = await executeMcpPost(TARGET, "/interop/message/resend/preview", body);
      const parsed = JSON.parse(answer.text) as { status: { errors?: Array<{ error: string }> }; result: Record<string, unknown> };
      return { errors: (parsed.status.errors ?? []).map((entry) => entry.error), result: parsed.result };
    };
    // IDs no header of the namespace has, so the preview reads nothing and answers not found for each.
    const hundred = Array.from({ length: 100 }, (_, index) => 900001 + index);
    const accepted = await preview({ headerIds: hundred, namespace: NS_A });
    expect(accepted.errors, "100 header IDs are accepted").toEqual([]);
    expect((accepted.result as { count?: number }).count, "one header item per ID").toBe(100);
    expect(JSON.stringify(accepted.result)).not.toContain("SYNTHPHI");

    const refused = await preview({ headerIds: [...hundred, 900101], namespace: NS_A });
    expect(refused.errors[0]).toContain("Parameter 'headerIds' must contain between 1 and 100 header IDs (found 101)");
    const missing = await preview({ namespace: NS_A });
    expect(missing.errors[0]).toContain("Parameter 'headerIds' must be a non-empty array of 1-100 numeric header IDs");
  }, 120000);
});

// -- DW-577 ------------------------------------------------------------

describe("Story 39.5: Hl7Size equals the serialization, and a body over the cap costs a sum (DW-577, AC-6, Rule #59)", () => {
  it("on every HL7 fixture, the two batches included, the precheck equals the length OutputToLibraryStream writes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const sizes = JSON.parse(await irisClassMethod(dev, NS_A, "Story395.Seed", "Sizes", ["1,2,8,9,13,15,16"])) as Array<{
      id: number;
      precheck: number;
      serialized: number;
    }>;
    expect(sizes.map((row) => row.id)).toEqual([1, 2, 8, 9, 13, 15, 16]);
    for (const row of sizes) {
      expect(row.serialized, `header ${row.id}: the serialization is not empty`).toBeGreaterThan(0);
      expect(row.precheck, `header ${row.id}`).toBe(row.serialized);
    }
    expect(sizes.find((row) => row.id === 13)?.serialized, "the huge message is over 2,000,000 characters").toBeGreaterThanOrEqual(2000000);
    expect(sizes.find((row) => row.id === 16)?.serialized, "the large batch is over the read limit in total").toBeGreaterThan(65536);
  }, 120000);

  it("the sum stops at the first node that takes it past the limit: a batch is not sized to its end", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const sizes = JSON.parse(await irisClassMethod(dev, NS_A, "Story395.Seed", "Sizes", ["15,16", 100])) as Array<{
      id: number;
      precheck: number;
      serialized: number;
    }>;
    expect(sizes.map((row) => row.id)).toEqual([15, 16]);
    for (const row of sizes) {
      expect(row.precheck, `header ${row.id}: the sum passed the limit`).toBeGreaterThan(100);
      expect(row.precheck, `header ${row.id}: the sum stopped before the batch's last node`).toBeLessThan(row.serialized);
    }
  }, 120000);

  it("Hl7Text answers tooLarge for the huge body in under a quarter of its serialization time", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const timing = JSON.parse(await irisClassMethod(dev, NS_A, "Story395.Seed", "Timing", [13, 65536])) as {
      result: string;
      hl7TextMs: number;
      serializeMs: number;
    };
    // eslint-disable-next-line no-console
    console.log(`[perf] story-39-5: Hl7Text ${timing.hl7TextMs} ms against a serialization of ${timing.serializeMs} ms (huge body, cap 65536)`);
    expect(timing.result).toBe("tooLarge");
    expect(timing.hl7TextMs * 4, "the work bound: Hl7Text costs under a quarter of the serialization").toBeLessThan(timing.serializeMs);
  }, 120000);
});

// -- Second namespace, not configured, unknown namespace -------------------------------

describe("Story 39.5: other namespaces (AC-8, Rules #34 and #41)", () => {
  it("A and B give different bodies for headers 1 and 2, each from its own namespace", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const inA = succeeded(await readBodies(allowS.session, [1, 2]));
    const inB = succeeded(await allowS.session.call("iris_message_body", { namespace: NS_B, headerIds: [1, 2] }));
    expect(String(itemOf(inA, 1).text)).toContain("SYNTHPHI-MRN");
    expect(String(itemOf(inA, 1).text)).not.toContain("SYNTHPHI-B-MRN");
    expect(String(itemOf(inB, 1).text)).toContain("SYNTHPHI-B-MRN");
    expect(String(itemOf(inB, 1).text)).toContain("KEEPME-B");
    expect(String(itemOf(inB, 1).text)).not.toContain("SYNTHPHI-MRN2");
    expect(itemOf(inA, 2).bodyKind).toBe("hl7v2");
    expect(itemOf(inB, 2)).toMatchObject({ bodyKind: "persistent", text: '{"StringValue":"SYNTHPHI-B-STRING"}' });

    const redactedB = succeeded(await redactS.session.call("iris_message_body", { namespace: NS_B, headerIds: [1, 2] }));
    expect(JSON.stringify(redactedB)).not.toContain("SYNTHPHI");
    expect(String(itemOf(redactedB, 1).text)).toContain("KEEPME-B");
    expect(redactedB.dataPolicy).toEqual({ policy: "redact", redacted: 1, blocked: 1 });
  }, 120000);

  it("a namespace with no Interoperability mappings answers notApplicable, with a reason, no items and the policy", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await redactS.session.call("iris_message_body", { namespace: NS_C, headerIds: [1] });
    expect(result.isError).toBeFalsy();
    const content = contentOf(result);
    expect(content.notApplicable).toBe(true);
    expect(content.reason).toContain(`Interoperability is not configured in namespace '${NS_C}'`);
    expect(content.items).toEqual([]);
    expect(content.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
  }, 120000);

  it("a namespace that does not exist is an error with the sanitized switch text", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await redactS.session.call("iris_message_body", { namespace: NS_Z, headerIds: [1] });
    expect(result.isError).toBe(true);
    expect(allText(result)).toContain("Error reading message bodies with iris_message_body:");
    expect(allText(result)).toContain("NAMESPACE");
    // SanitizeError strips the routine reference (+N^Routine) the switch failure carries.
    expect(allText(result), "no routine or global reference").not.toMatch(/\^[%A-Za-z]/);
  }, 120000);
});

// -- Governance, visibility, audit -------------------------------------------------

describe("Story 39.5: the tool is a listed read, enabled by default, and governance can disable it (AC-5)", () => {
  it("is listed with truthful read-only annotations, and the interop server advertises 25 tools", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const tools = await redactS.session.listTools();
    expect(tools).toHaveLength(25);
    const listed = tools.find((tool) => tool.name === "iris_message_body");
    expect(listed?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(listed?.inputSchema.required).toEqual(["headerIds"]);
  }, 120000);

  it("the key is enabled under default configuration and under the read-only preset, which still reads", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const readOnly = await plainSession({ IRIS_GOVERNANCE_PRESET: "read-only" });
    for (const [label, session] of [["default", redactS.session], ["read-only", readOnly]] as const) {
      const profiles = await session.raw("iris_server_profiles", {});
      const policy = (profiles.structuredContent as { governance: { policy: Record<string, boolean> } }).governance.policy;
      expect(policy["iris_message_body"], `iris_message_body under ${label}`).toBe(true);
    }
    expect(succeeded(await readBodies(readOnly, [1, 2])).dataPolicy).toEqual({ policy: "redact", redacted: 2, blocked: 0 });
  }, 120000);

  it("an operator's disable denies the call with GOVERNANCE_DISABLED and sends no request to the route", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const governed = await openThroughProxy("governed", { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_message_body: false } }) });
    let denied!: WireToolResult;
    const wire = await requestsOf(async () => {
      denied = await readBodies(governed.session, [1]);
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toEqual({ code: "GOVERNANCE_DISABLED", action: "iris_message_body", server: "default" });
    expect(wire, "the denied call reached no route").toEqual([]);
  }, 120000);

  it("is visible next to iris_message_search in every preset, and core lists 12 tools", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const sizes: Record<string, number> = {};
    for (const preset of ["core", "developer", "full"]) {
      const session = await plainSession({ IRIS_TOOLS_PRESET: preset });
      const names = (await session.listTools()).map((tool) => tool.name);
      expect(names, `${preset}: iris_message_body`).toContain("iris_message_body");
      expect(names, `${preset}: iris_message_search`).toContain("iris_message_search");
      sizes[preset] = names.length;
    }
    expect(sizes).toEqual({ core: 12, developer: 25, full: 25 });
  }, 120000);
});

describe("Story 39.5: the audit file and the console log (AC-7, AD-19)", () => {
  it("each entry records the policy and the response's counts and the header IDs, and no identifying value reaches the file or stderr under any policy", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const rows: Array<[string, AuditedSession, { policy: string; redacted: number; blocked: number }]> = [
      ["redact", redactS, { policy: "redact", redacted: 4, blocked: 10 }],
      ["block", blockS, { policy: "block", redacted: 0, blocked: 14 }],
      ["allow", allowS, { policy: "allow", redacted: 0, blocked: 0 }],
    ];
    for (const [index, [label, session, counts]] of rows.entries()) {
      // A maxChars no earlier row sent marks this call's own entry; the counts do not depend on it.
      const marker = 7001 + index;
      const result = await readBodies(session.session, IDS_17, { maxChars: marker });
      expect(succeeded(result).dataPolicy, label).toEqual(counts);
      if (label === "allow") expect(JSON.stringify(result), "the allow result holds the positive control").toContain("SYNTHPHI");

      const isOwn = (candidate: Item): boolean => (candidate.params as Item | undefined)?.maxChars === marker;
      // Every entry of the file, once an iris_message_body entry that is this call's own exists.
      const entries = await pollAuditEntries(session.auditFile, {
        tool: "iris_message_body",
        isWanted: isOwn,
        returnAll: true,
        intervalMs: 20,
        timeoutMs: 5000,
        excerpt: 2000,
      });
      const entry = entries.find((candidate) => candidate.tool === "iris_message_body" && isOwn(candidate)) as Item;
      expect(entry, label).toMatchObject({ tool: "iris_message_body", outcome: "ok", dataPolicy: counts });
      expect((entry.params as Item).headerIds, `${label}: the header IDs are logged`).toEqual(IDS_17);
      for (const candidate of entries.filter((call) => call.tool !== undefined)) {
        expect(["ok", "error", "denied"], label).toContain(candidate.outcome);
      }

      expect(readFileSync(session.auditFile, "utf8"), `${label}: the audit file`).not.toContain("SYNTHPHI");
      expect(session.stderr().length, `${label}: the server wrote to stderr (LOG_LEVEL=DEBUG)`).toBeGreaterThan(0);
      expect(session.stderr(), `${label}: the server's stderr`).not.toContain("SYNTHPHI");
    }
  }, 120000);
});

describe("Story 39.5: the first built-server start", () => {
  it("deploys the bootstrap inside its 60 s budget", (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // eslint-disable-next-line no-console
    console.log(`[perf] story-39-5: the first built-server start took ${firstStartMs} ms (budget 60000 ms)`);
    expect(firstStartMs).toBeLessThan(60000);
  });
});
