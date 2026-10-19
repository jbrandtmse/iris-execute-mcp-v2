/**
 * Story 39.5 (QA) - `iris_message_body` and its PHI data policy on the BUILT interop server, where the in-process
 * suites and the live gate stop short (AC-1, AC-2, AC-3, AC-4, AC-7; AD-9, AD-19, AD-26; Rules #36, #54, #59).
 *
 * The BUILT iris-interop-mcp dist is spawned over stdio and pointed at a local HTTP listener that stands in for
 * IRIS: it records every request and answers the body route with a reply the test controls. No IRIS instance is
 * contacted. The listener replies as a HOSTILE or version-skewed IRIS could: it ignores `bodyRead` and sends a
 * `bodyText` for every kind of body, a `bodyId` for a literal header, extra item fields (`RawContent`,
 * `Description`, `ErrorStatus`, a Search Table value) and, for a version-skewed kind, a token outside the nine.
 * The real route never sends such a reply (the live gate pins what it does send), so these rows pin the tool's
 * own second line of defense (AD-26, Design Notes I2) on the shipped dist, where the unit suites reach it only
 * through mocks:
 *
 *  - the request: under every policy exactly one POST with `headerIds`, `namespace`, `bodyRead` and
 *    `bodyTextMaxChars` and nothing else, over the real HTTP client. `block` is NOT refused before the route:
 *    the spec's `block` asks IRIS for the kind only (`bodyRead: "kind"`), which is the only way to report a
 *    class and a kind. A caller cannot widen what IRIS reads: a `dataPolicy` only tightens (the wire and the
 *    result, also from `block`), and a caller's own `bodyRead` or `bodyTextMaxChars` never reaches the wire;
 *  - the result: under `redact` and `block` no identifying value of the hostile reply is in the text or the
 *    structured output, an HL7 v2 body is shown only redacted, every other body is withheld with its fixed reason,
 *    and an item holds only its specified keys; `allow` is the positive control;
 *  - the audit file and the console log of a session at DEBUG hold no identifying value under any policy,
 *    `allow` included, and the audit entry carries the policy with the counts the response reported;
 *  - the limits: the bounds of the schema (no request for a bad input; a request at each boundary), the cut at
 *    `maxChars` after redaction and sanitization at every length of an HL7 v2 text, an astral character at the
 *    cut, and a text of exactly the cap or one more;
 *  - the shapes: an HL7 v2 text a hostile IRIS could send (a BOM, split-off lines, separators in data, CR, LF and
 *    CRLF mixes, control characters, batches, a trailing line) is shown redacted or withheld, never with an
 *    identifying value.
 *
 * Expected values come from the Story 39.5 intent contract and the hand-written fixtures, never from the
 * implementation (Rule #36); the one engine-derived oracle is the redaction of a fixture text, pinned by running
 * the shipped `redactHl7` on it (the composition under test is the order and the cut, not the engine). Placement
 * (Rule #45): `@iris-mcp/all` is the only package that depends on every server's built dist. A missing or stale
 * `shared` or `iris-interop-mcp` dist, or an unresolvable SDK, skips each test with the reason, or fails when
 * `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  allText,
  openAuditedSession,
  pollAuditEntries,
  resolveSdkEsmDir,
  routeRequests,
  skipIfReason,
  staleDistReason,
  startRouteStub,
  stubEnvelope,
  stubTarget,
  wellFormed,
  type AuditedSession,
  type RecordedRequest,
  type RouteStub,
  type WireSession,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const INTEROP_ENTRY = path.join(REPO_ROOT, "packages", "iris-interop-mcp", "dist", "index.js");
const SHARED_ENTRY = path.join(REPO_ROOT, "packages", "shared", "dist", "index.js");

const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** Every identifying value of a hostile reply contains this; no output of a `redact` or `block` call may. */
const MARK = "SYNTHPHI395QA";
/** A value that must survive a redaction (a kept position of an HL7 v2 text). */
const KEEP = "KEEPME395QA";

/** The namespace the calls name. The listener answers whatever it is asked, so no IRIS namespace is involved. */
const NS = "STORY395QA";
const BODY_ROUTE = "/api/executemcp/v2/interop/message/body";

type Item = Record<string, unknown>;

// -- Texts, written by hand --------------------------------------------------------------------------------------

/** An ADT message with CR segment terminators: eight identifying fields, one kept value in OBX-3.2. */
const ADT = `${[
  `MSH|^~\\&|${MARK}-APP|${MARK}-FAC|||20010203090001||ADT^A01^ADT_A01|${MARK}-CTL|P|2.5.1`,
  `PID|1||${MARK}-MRN^^^${MARK}-AA||${MARK}-LAST^${MARK}-FIRST||19010101|F`,
  `OBX|1|TX|GLU^${KEEP}^L||${MARK}-free text|mg/dL|||||F`,
].join("\r")}\r`;

/** The same message with CRLF terminators (the form an HL7 text takes on a Windows file). */
const ADT_CRLF = ADT.replace(/\r/g, "\r\n");

/** The reasons and texts of the spec, written by hand (not read from the shared module that the tool uses). */
const BLOCK_REASON = "The block data policy withholds every message body.";
const kindReason = (kind: string): string => `A ${kind} body cannot be redacted reliably, so the redact data policy withholds it.`;
const TOO_LARGE_REASON = "The HL7 v2 body is longer than 65536 characters, so the redact data policy withholds it.";
const UNREADABLE_REASON = "The HL7 v2 body could not be read in full, so the redact data policy withholds it.";
const unparseable = (engineReason: string): string =>
  `The HL7 v2 body could not be parsed (${engineReason}), so the redact data policy withholds it.`;
const MISSING_TEXT = "The body class is not compiled in this namespace, so the body cannot be read.";
const UNOPENED_TEXT = "The body does not open (it may have been purged), so it cannot be read.";
const UNREADABLE_TEXT = "The body could not be read.";
const noRenderer = (kind: string): string => `No renderer reads a ${kind} body, so only its class and ID are shown.`;
const CLAMP_LINE = (requested: string, applied: string): string =>
  `The requested data policy ${requested} is looser than the profile's ${applied}, so ${applied} applies.`;

/** The keys an item of the result may hold (the spec's Output section) and the keys of the structured result. */
const FOUND_KEYS = new Set(["id", "found", "bodyClassName", "bodyId", "bodyKind", "bodyPolicy", "format", "text", "truncated", "notShown"]);

/** CR, CRLF and a lone CR become LF; every other C0 control but TAB and LF, and DEL, becomes U+FFFD. Hand-written. */
function sanitize(text: string): string {
  let out = "";
  const flat = text.replace(/\r\n|\r/g, "\n");
  for (const ch of flat) {
    const code = ch.codePointAt(0) as number;
    const isControl = (code < 0x20 && code !== 0x09 && code !== 0x0a) || code === 0x7f;
    out += isControl ? "\u{FFFD}" : ch;
  }
  return out;
}

// -- The hostile reply ------------------------------------------------------------------------------------------

/** Item fields a hostile IRIS could add to any item; none may reach a result. */
function extras(n: number): Item {
  return {
    RawContent: `${MARK}-RAW-${n}`,
    Description: `${MARK}-DESCRIPTION-${n}`,
    ErrorStatus: `${MARK}-ERRORSTATUS-${n}`,
    bodySummary: `${MARK}-SUMMARY-${n}`,
    searchTableValues: [`${MARK}-SEARCHTABLE-${n}`],
  };
}

function hostileItem(id: number): Item {
  const base = (cls: string, bodyId: string, kind: string, available: boolean): Item => ({
    id,
    found: true,
    bodyClassName: cls,
    bodyId,
    bodyKind: kind,
    bodyAvailable: available,
    ...extras(id),
  });
  switch (id) {
    case 1:
      return { ...base("EnsLib.HL7.Message", "1", "hl7v2", true), bodyText: ADT, bodyTextComplete: true };
    case 2:
      return { ...base("EnsLib.HL7.Message", "2", "hl7v2", true), bodyText: ADT_CRLF, bodyTextComplete: true };
    case 3:
      return { ...base("%Stream.GlobalCharacter", "3", "stream", true), bodyText: `${MARK}-STREAM\r\n\tline2`, bodyTextComplete: true };
    case 4:
      return { ...base("Ens.StringRequest", "4", "persistent", true), bodyText: `{"StringValue":"${MARK}-STRING"}`, bodyTextComplete: true };
    case 5:
      return { ...base("Ens.StreamContainer", "5", "streamContainer", true), bodyText: `${MARK}-CONTAINER`, bodyTextComplete: true };
    case 6:
      return {
        ...base("EnsLib.EDI.XML.Document", "6", "xmlvdoc", true),
        bodyText: `<Patient><Name>${MARK}-XML</Name></Patient>`,
        bodyTextComplete: true,
      };
    case 7:
      // The real route leaves bodyId out for a literal header unless the read is `all`; a hostile one does not.
      return { ...base("", `${MARK}-LITERAL`, "literal", false), bodyText: `${MARK}-LITERAL`, bodyTextComplete: true };
    case 8:
      return { ...base("EnsLib.EDI.X12.Document", "8", "vdoc", true), bodyText: `ISA*${MARK}-X12`, bodyTextComplete: true };
    case 9:
      return { ...base("Some.Other.Class", "9", "other", true), bodyText: `${MARK}-OTHER`, bodyTextComplete: true };
    case 10:
      return { ...base("No.Such.Class", "10", "missing", false), bodyText: `${MARK}-MISSING`, bodyTextComplete: true };
    case 11:
      // A kind a later IRIS version could add: outside the nine tokens.
      return { ...base("Future.Kind", "11", "mystery", true), bodyText: `${MARK}-MYSTERY`, bodyTextComplete: true };
    case 12:
      return { ...base("EnsLib.HL7.Message", "12", "hl7v2", true), bodyTextOmitted: "tooLarge" };
    case 13:
      return { ...base("EnsLib.HL7.Message", "13", "hl7v2", true), bodyTextOmitted: "unreadable" };
    case 14:
      return { ...base("EnsLib.HL7.Message", "14", "hl7v2", true), bodyText: ADT, bodyTextComplete: false };
    case 15:
      return { ...base("EnsLib.HL7.Message", "15", "hl7v2", false), bodyText: ADT, bodyTextComplete: true };
    case 16:
      return { id, found: false, error: "Header 16 not found", ...extras(id) };
    case 17:
      return { ...base("EnsLib.HL7.Message", "17", "hl7v2", true), bodyText: `${MARK}-NOT-HL7`, bodyTextComplete: true };
    case 18:
      return { ...base("EnsLib.HL7.Message", "18", "hl7v2", true), bodyText: "", bodyTextComplete: true };
    default:
      throw new Error(`no hostile item ${id}`);
  }
}

const HOSTILE_IDS = Array.from({ length: 18 }, (_, index) => index + 1);

/** A reply with the hostile items for the IDs the request names, whatever `bodyRead` it carries. */
function hostileReply(request: Record<string, unknown>): unknown {
  const ids = (request.headerIds as Array<number | string>).map(Number);
  const items = ids.map((id) => hostileItem(id));
  return stubEnvelope({ interopEnabled: true, items, count: items.length });
}

// -- Sessions ----------------------------------------------------------------------------------------------------

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let fixtureDir = "";
let stub: RouteStub;
const opened: WireSession[] = [];
let engine: {
  redactHl7: (text: string) => { ok: true; text: string; redactedFields: number } | { ok: false; reason: string };
};

let sessionCounter = 0;

/**
 * A session on the built interop server pointed at the listener, at DEBUG, with an audit file that logs parameters,
 * and `extraEnv`. The listener refuses everything while the server starts and serves the body route afterwards.
 */
async function openOnStub(extraEnv: Record<string, string> = {}): Promise<AuditedSession> {
  sessionCounter += 1;
  stub.serving = false;
  const audited = await openAuditedSession(
    {
      sdkEsmDir: sdkEsmDir as string,
      entry: INTEROP_ENTRY,
      target: stubTarget(stub.port, "story395-qa"),
      clientName: "story-39-5-qa-process",
      auditFile: path.join(fixtureDir, `audit-${sessionCounter}.jsonl`),
    },
    extraEnv,
  );
  opened.push(audited.session);
  stub.serving = true;
  return audited;
}

/** `iris_message_body` on NS through `session`. */
function read(
  session: WireSession,
  headerIds: Array<number | string>,
  args: Record<string, unknown> = {},
): ReturnType<WireSession["call"]> {
  return session.call("iris_message_body", { namespace: NS, headerIds, ...args });
}

const bodyRequests = (): RecordedRequest[] => stub.requests.filter((r) => r.method === "POST" && r.url === BODY_ROUTE);

interface Structured {
  items: Item[];
  count: number;
  maxChars: number;
  dataPolicy: { policy: string; redacted: number; blocked: number };
  dataPolicyClamped?: boolean;
  notApplicable?: boolean;
  reason?: string;
}

/** A successful read: no error, one text block; returns the structured content. */
function succeeded(result: { isError?: boolean; content?: Array<{ text?: string }>; structuredContent?: Record<string, unknown> }): Structured {
  expect(result.isError, allText(result)).toBeFalsy();
  expect(result.content, "one text block").toHaveLength(1);
  return result.structuredContent as unknown as Structured;
}

const byId = (content: Structured, id: number): Item => content.items.find((item) => item.id === id) as Item;

/** The `maxChars` a result echoes. */
const contentMax = (result: { structuredContent?: Record<string, unknown> }): unknown => result.structuredContent?.["maxChars"];

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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.5 QA process gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) {
    // eslint-disable-next-line no-console
    console.log(`[SKIP] story-39-5-qa-process: ${skipReason}`);
    return;
  }
  engine = (await import(pathToFileURL(SHARED_ENTRY).href)) as typeof engine;
  fixtureDir = mkdtempSync(path.join(tmpdir(), "story-39-5-qa-"));
  stub = await startRouteStub(BODY_ROUTE);
});

afterAll(async () => {
  for (const s of opened) await s.close();
  if (stub) await stub.close();
  if (fixtureDir) rmSync(fixtureDir, { recursive: true, force: true });
});

/** How the audit file is polled: the body tool's entries, every 20 ms, for at most 10 s (the caller adds `count`). */
const AUDIT_POLL = { tool: "iris_message_body", intervalMs: 20, timeoutMs: 10000, excerpt: 2000 } as const;

/** One more round trip, so every line the server wrote to stderr while it handled the calls has been read. */
async function flush(s: AuditedSession): Promise<void> {
  await s.session.listTools();
}

// ---------------------------------------------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------------------------------------------

describe("Story 39.5 QA: the request goes to IRIS with exactly four fields, and a caller cannot widen what IRIS reads (AC-3; AD-26, Rule #10)", () => {
  const EMPTY = (): unknown => stubEnvelope({ interopEnabled: true, items: [], count: 0 });

  it("per policy and per maxChars: one POST of headerIds as given, the namespace, bodyRead and bodyTextMaxChars, and nothing else; block asks for the kind only", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = EMPTY;
    const ids: Array<number | string> = [1, "2", 30, "400"];
    const rows: Array<{ label: string; env: Record<string, string>; args: Record<string, unknown>; bodyRead: string; max: number }> = [
      { label: "redact, no maxChars", env: {}, args: {}, bodyRead: "hl7", max: 65536 },
      { label: "redact, maxChars 1", env: {}, args: { maxChars: 1 }, bodyRead: "hl7", max: 65536 },
      { label: "redact, maxChars 1048576 (the output cap never widens the HL7 read)", env: {}, args: { maxChars: 1048576 }, bodyRead: "hl7", max: 65536 },
      { label: "allow, no maxChars", env: { IRIS_DATA_POLICY: "allow" }, args: {}, bodyRead: "all", max: 65536 },
      { label: "allow, maxChars 1 (never lowers the HL7 read limit)", env: { IRIS_DATA_POLICY: "allow" }, args: { maxChars: 1 }, bodyRead: "all", max: 65536 },
      { label: "allow, maxChars 65536", env: { IRIS_DATA_POLICY: "allow" }, args: { maxChars: 65536 }, bodyRead: "all", max: 65536 },
      { label: "allow, maxChars 65537", env: { IRIS_DATA_POLICY: "allow" }, args: { maxChars: 65537 }, bodyRead: "all", max: 65537 },
      { label: "allow, maxChars 1048576", env: { IRIS_DATA_POLICY: "allow" }, args: { maxChars: 1048576 }, bodyRead: "all", max: 1048576 },
      { label: "block, no maxChars", env: { IRIS_DATA_POLICY: "block" }, args: {}, bodyRead: "kind", max: 65536 },
      { label: "block, maxChars 1048576", env: { IRIS_DATA_POLICY: "block" }, args: { maxChars: 1048576 }, bodyRead: "kind", max: 65536 },
    ];
    const sessions = new Map<string, AuditedSession>();
    for (const row of rows) {
      const key = JSON.stringify(row.env);
      const s = sessions.get(key) ?? (await openOnStub(row.env));
      sessions.set(key, s);
      const before = bodyRequests().length;
      const result = await read(s.session, ids, row.args);
      expect(result.isError, `${row.label}: ${allText(result)}`).toBeFalsy();
      const sent = bodyRequests().slice(before);
      expect(sent, `${row.label}: exactly one body request`).toHaveLength(1);
      expect(JSON.parse((sent[0] as RecordedRequest).body), row.label).toEqual({
        headerIds: ids,
        namespace: NS,
        bodyRead: row.bodyRead,
        bodyTextMaxChars: row.max,
      });
    }
  }, 180000);

  it("a dataPolicy only tightens, on the wire and in the result, from every operator policy; a looser one is reported once", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = EMPTY;
    const rows: Array<{ operator: string | undefined; caller: string; applied: string; bodyRead: string; clamped: boolean }> = [
      { operator: "allow", caller: "redact", applied: "redact", bodyRead: "hl7", clamped: false },
      { operator: "allow", caller: "block", applied: "block", bodyRead: "kind", clamped: false },
      { operator: "allow", caller: "allow", applied: "allow", bodyRead: "all", clamped: false },
      { operator: undefined, caller: "allow", applied: "redact", bodyRead: "hl7", clamped: true },
      { operator: undefined, caller: "redact", applied: "redact", bodyRead: "hl7", clamped: false },
      { operator: undefined, caller: "block", applied: "block", bodyRead: "kind", clamped: false },
      { operator: "block", caller: "allow", applied: "block", bodyRead: "kind", clamped: true },
      { operator: "block", caller: "redact", applied: "block", bodyRead: "kind", clamped: true },
      { operator: "block", caller: "block", applied: "block", bodyRead: "kind", clamped: false },
    ];
    const sessions = new Map<string, AuditedSession>();
    for (const row of rows) {
      const key = String(row.operator);
      const s = sessions.get(key) ?? (await openOnStub(row.operator === undefined ? {} : { IRIS_DATA_POLICY: row.operator }));
      sessions.set(key, s);
      const label = `operator ${String(row.operator ?? "default redact")}, caller ${row.caller}`;
      const before = bodyRequests().length;
      const result = await read(s.session, [1], { dataPolicy: row.caller });
      const content = succeeded(result);
      expect(content.dataPolicy, label).toEqual({ policy: row.applied, redacted: 0, blocked: 0 });
      if (row.clamped) {
        expect(content.dataPolicyClamped, label).toBe(true);
        expect(allText(result).split("\n").at(-1), label).toBe(CLAMP_LINE(row.caller, row.applied));
      } else {
        expect(content, label).not.toHaveProperty("dataPolicyClamped");
        expect(allText(result), label).not.toContain("is looser than");
      }
      const sent = bodyRequests().slice(before);
      expect(sent, label).toHaveLength(1);
      expect(JSON.parse((sent[0] as RecordedRequest).body), label).toMatchObject({ bodyRead: row.bodyRead, bodyTextMaxChars: 65536 });
      expect(JSON.parse((sent[0] as RecordedRequest).body), `${label}: the caller's policy is not a wire field`).not.toHaveProperty("dataPolicy");
    }
  }, 180000);

  it("a caller that adds its own bodyRead, bodyTextMaxChars or bodyAvailable to the call does not change what IRIS is asked to read", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = EMPTY;
    for (const [env, bodyRead] of [
      [{}, "hl7"],
      [{ IRIS_DATA_POLICY: "block" }, "kind"],
    ] as Array<[Record<string, string>, string]>) {
      const s = await openOnStub(env);
      const before = bodyRequests().length;
      const result = await read(s.session, [1], { bodyRead: "all", bodyTextMaxChars: 1048576, bodyAvailable: true, dataPolicy: "allow" });
      const sent = bodyRequests().slice(before);
      // The framework drops a field the schema does not name (it does not refuse the call), so the call is read
      // under the policy and the caller's own route fields are gone.
      expect(result.isError, allText(result)).toBeFalsy();
      expect(sent, `${JSON.stringify(env)}: one request`).toHaveLength(1);
      expect(JSON.parse((sent[0] as RecordedRequest).body), JSON.stringify(env)).toEqual({
        headerIds: [1],
        namespace: NS,
        bodyRead,
        bodyTextMaxChars: 65536,
      });
    }
  }, 120000);
});

// ---------------------------------------------------------------------------------------------------------------
// The result of a hostile reply
// ---------------------------------------------------------------------------------------------------------------

/** The expected redacted text of the ADT fixture: the shipped engine's output, sanitized by hand. */
function redactedAdtLf(raw: string): string {
  const out = engine.redactHl7(raw);
  if (!out.ok) throw new Error(`the engine refused the fixture: ${out.reason}`);
  return sanitize(out.text);
}

describe("Story 39.5 QA: a hostile reply under each policy (AC-3, AC-4, AC-7; AD-19, AD-26)", () => {
  it("redact: HL7 v2 is shown only redacted, every other body is withheld with its fixed reason, an item holds only its keys, and no identifying value is anywhere", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = hostileReply;
    const s = await openOnStub();

    const result = await read(s.session, HOSTILE_IDS);
    const content = succeeded(result);

    expect(content.count).toBe(18);
    expect(content.maxChars, "the default maxChars is echoed").toBe(10000);
    expect(content.items.map((item) => item.id), "request order").toEqual(HOSTILE_IDS);
    expect(Object.keys(content).sort(), "only the specified result fields").toEqual(["count", "dataPolicy", "items", "maxChars"]);
    expect(content.dataPolicy).toEqual({ policy: "redact", redacted: 2, blocked: 13 });

    // The two HL7 v2 bodies that were read whole are redacted: the engine's output, sanitized, with the kept value.
    for (const id of [1, 2]) {
      const item = byId(content, id);
      expect(item.bodyPolicy, `item ${id}`).toMatchObject({ outcome: "redacted" });
      expect((item.bodyPolicy as { redactedFields: number }).redactedFields, `item ${id}`).toBeGreaterThan(0);
      expect(item, `item ${id}`).toMatchObject({ format: "er7", truncated: false });
      expect(item.text, `item ${id}`).toBe(redactedAdtLf(id === 1 ? ADT : ADT_CRLF));
      expect(String(item.text), `item ${id}: the kept value survives`).toContain(KEEP);
      expect(String(item.text), `item ${id}: one segment per line`).not.toContain("\r");
    }

    // Every other body: withheld with the fixed reason of its kind. The text IRIS sent is dropped.
    const withheld: Array<[number, string, string]> = [
      [3, "stream", kindReason("stream")],
      [4, "persistent", kindReason("persistent")],
      [5, "streamContainer", kindReason("streamContainer")],
      [6, "xmlvdoc", kindReason("xmlvdoc")],
      [7, "literal", kindReason("literal")],
      [8, "vdoc", kindReason("vdoc")],
      [9, "other", kindReason("other")],
      [11, "other", kindReason("other")],
      [12, "hl7v2", TOO_LARGE_REASON],
      [13, "hl7v2", UNREADABLE_REASON],
      [14, "hl7v2", UNREADABLE_REASON],
      [17, "hl7v2", unparseable("The text does not start with an MSH, FHS or BHS segment.")],
      [18, "hl7v2", unparseable("The text does not start with an MSH, FHS or BHS segment.")],
    ];
    for (const [id, kind, reason] of withheld) {
      const item = byId(content, id);
      expect(item.bodyKind, `item ${id}`).toBe(kind);
      expect(item.bodyPolicy, `item ${id}`).toEqual({ outcome: "blocked", reason });
      expect(item.notShown, `item ${id}`).toBe(reason);
      for (const key of ["text", "format", "truncated"]) expect(item, `item ${id}: ${key}`).not.toHaveProperty(key);
    }
    expect(byId(content, 7).bodyId, "the value of a literal header is not shown").toBe("");
    // An unavailable body is not read: nothing is decided and the text IRIS sent is dropped.
    expect(byId(content, 10)).toMatchObject({ bodyPolicy: { outcome: "none" }, notShown: MISSING_TEXT, bodyKind: "missing" });
    expect(byId(content, 15)).toMatchObject({ bodyPolicy: { outcome: "none" }, notShown: UNOPENED_TEXT });
    expect(byId(content, 16)).toEqual({ id: 16, found: false, error: "Header 16 not found" });

    for (const item of content.items) {
      if (item.found !== true) continue;
      for (const key of Object.keys(item)) expect(FOUND_KEYS.has(key), `item ${String(item.id)} has the key ${key}`).toBe(true);
    }

    // The wire: HL7 v2 only, and the whole output carries no identifying value of the hostile reply.
    const sent = bodyRequests().at(-1) as RecordedRequest;
    expect(JSON.parse(sent.body)).toEqual({ headerIds: HOSTILE_IDS, namespace: NS, bodyRead: "hl7", bodyTextMaxChars: 65536 });
    expect(JSON.stringify(result), "no identifying value in the result, content or structuredContent").not.toContain(MARK);
    const lines = allText(result).split("\n");
    expect(lines.at(-1)).toBe("Data policy redact: 2 redacted, 13 withheld.");
    expect(lines, "the redacted heading line").toContain("#1 EnsLib.HL7.Message [hl7v2] redacted");
    expect(lines, "the withheld heading line").toContain("#3 %Stream.GlobalCharacter [stream] blocked");

    // The audit file and the console log (DEBUG): the policy and the counts, never a value.
    const [entry] = await pollAuditEntries(s.auditFile, { ...AUDIT_POLL, count: 1 });
    expect(entry).toMatchObject({ tool: "iris_message_body", outcome: "ok", dataPolicy: { policy: "redact", redacted: 2, blocked: 13 } });
    expect(((entry as Item).params as Item).headerIds, "the header IDs are logged").toEqual(HOSTILE_IDS);
    await flush(s);
    expect(s.stderr().length, "the server wrote to stderr (LOG_LEVEL=DEBUG)").toBeGreaterThan(0);
    expect(readFileSync(s.auditFile, "utf8"), "the audit file").not.toContain(MARK);
    expect(s.stderr(), "the console log").not.toContain(MARK);
  }, 120000);

  it("block: no text and no format anywhere, every available body is withheld with the block reason, the literal value is not shown, and nothing leaks", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = hostileReply;
    const s = await openOnStub({ IRIS_DATA_POLICY: "block" });

    const result = await read(s.session, HOSTILE_IDS);
    const content = succeeded(result);

    expect(content.dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 15 });
    const blocked = content.items.filter((item) => (item.bodyPolicy as { outcome?: string } | undefined)?.outcome === "blocked").map((item) => item.id);
    expect(blocked, "every available body, whatever its kind").toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14, 17, 18]);
    for (const item of content.items.filter((candidate) => blocked.includes(candidate.id))) {
      expect(item.bodyPolicy, `item ${String(item.id)}`).toEqual({ outcome: "blocked", reason: BLOCK_REASON });
      expect(item.notShown, `item ${String(item.id)}`).toBe(BLOCK_REASON);
      for (const key of ["text", "format", "truncated"]) expect(item, `item ${String(item.id)}: ${key}`).not.toHaveProperty(key);
    }
    expect(byId(content, 7).bodyId).toBe("");
    expect(byId(content, 10)).toMatchObject({ bodyPolicy: { outcome: "none" }, notShown: MISSING_TEXT });
    expect(byId(content, 15)).toMatchObject({ bodyPolicy: { outcome: "none" }, notShown: UNOPENED_TEXT });
    expect(byId(content, 16)).toEqual({ id: 16, found: false, error: "Header 16 not found" });
    for (const item of content.items) {
      if (item.found !== true) continue;
      for (const key of Object.keys(item)) expect(FOUND_KEYS.has(key), `item ${String(item.id)} has the key ${key}`).toBe(true);
    }

    const sent = bodyRequests().at(-1) as RecordedRequest;
    expect(JSON.parse(sent.body), "block asks IRIS for the kind only").toEqual({ headerIds: HOSTILE_IDS, namespace: NS, bodyRead: "kind", bodyTextMaxChars: 65536 });
    expect(JSON.stringify(result)).not.toContain(MARK);
    expect(allText(result).split("\n").at(-1)).toBe("Data policy block: 0 redacted, 15 withheld.");

    const [entry] = await pollAuditEntries(s.auditFile, { ...AUDIT_POLL, count: 1 });
    expect(entry).toMatchObject({ tool: "iris_message_body", outcome: "ok", dataPolicy: { policy: "block", redacted: 0, blocked: 15 } });
    await flush(s);
    expect(s.stderr().length).toBeGreaterThan(0);
    expect(readFileSync(s.auditFile, "utf8")).not.toContain(MARK);
    expect(s.stderr()).not.toContain(MARK);
  }, 120000);

  it("allow (the positive control): every renderable body is shown in its format, the rest have their reasons, and the audit file and the console log still hold no value", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = hostileReply;
    const s = await openOnStub({ IRIS_DATA_POLICY: "allow" });

    const result = await read(s.session, HOSTILE_IDS);
    const content = succeeded(result);

    expect(content.dataPolicy).toEqual({ policy: "allow", redacted: 0, blocked: 0 });
    expect(byId(content, 1)).toMatchObject({ format: "er7", text: sanitize(ADT), truncated: false, bodyPolicy: { outcome: "none" } });
    expect(byId(content, 2)).toMatchObject({ format: "er7", text: sanitize(ADT), truncated: false });
    expect(byId(content, 3)).toMatchObject({ format: "text", text: `${MARK}-STREAM\n\tline2`, truncated: false });
    expect(byId(content, 4)).toMatchObject({ format: "json", text: `{"StringValue":"${MARK}-STRING"}`, truncated: false });
    expect(byId(content, 5)).toMatchObject({ format: "text", text: `${MARK}-CONTAINER`, truncated: false });
    expect(byId(content, 6)).toMatchObject({ format: "xml", text: `<Patient><Name>${MARK}-XML</Name></Patient>`, truncated: false });
    expect(byId(content, 7)).toMatchObject({ format: "text", text: `${MARK}-LITERAL`, bodyId: `${MARK}-LITERAL`, truncated: false });
    expect(byId(content, 8), "a vdoc has no renderer, whatever IRIS sent").toMatchObject({ bodyKind: "vdoc", bodyPolicy: { outcome: "none" }, notShown: noRenderer("vdoc") });
    expect(byId(content, 9)).toMatchObject({ bodyKind: "other", notShown: noRenderer("other") });
    expect(byId(content, 10)).toMatchObject({ notShown: MISSING_TEXT });
    expect(byId(content, 11), "a kind outside the nine is other").toMatchObject({ bodyKind: "other", notShown: noRenderer("other") });
    expect(byId(content, 12)).toMatchObject({ notShown: "The HL7 v2 body is longer than 65536 characters, so it is not shown; a larger maxChars (at most 1048576) reads it whole." });
    expect(byId(content, 13)).toMatchObject({ notShown: UNREADABLE_TEXT });
    expect(byId(content, 14), "an incomplete text is shown cut, and says so").toMatchObject({ format: "er7", text: sanitize(ADT), truncated: true });
    expect(byId(content, 15)).toMatchObject({ notShown: UNOPENED_TEXT });
    expect(byId(content, 17)).toMatchObject({ format: "er7", text: `${MARK}-NOT-HL7`, truncated: false });
    expect(byId(content, 18)).toMatchObject({ format: "er7", text: "", truncated: false });
    for (const item of content.items) {
      if (item.found !== true) continue;
      for (const key of Object.keys(item)) expect(FOUND_KEYS.has(key), `item ${String(item.id)} has the key ${key}`).toBe(true);
    }
    expect(JSON.stringify(result), "allow shows the values").toContain(MARK);
    expect(JSON.stringify(result), "and none of the extra fields a hostile reply carries").not.toMatch(/RAW-|DESCRIPTION-|ERRORSTATUS-|SUMMARY-|SEARCHTABLE-/);

    const sent = bodyRequests().at(-1) as RecordedRequest;
    expect(JSON.parse(sent.body)).toEqual({ headerIds: HOSTILE_IDS, namespace: NS, bodyRead: "all", bodyTextMaxChars: 65536 });

    const [entry] = await pollAuditEntries(s.auditFile, { ...AUDIT_POLL, count: 1 });
    expect(entry).toMatchObject({ tool: "iris_message_body", outcome: "ok", dataPolicy: { policy: "allow", redacted: 0, blocked: 0 } });
    await flush(s);
    expect(s.stderr().length).toBeGreaterThan(0);
    expect(readFileSync(s.auditFile, "utf8"), "the audit file holds no body value under allow").not.toContain(MARK);
    expect(s.stderr(), "the console log holds no body value under allow").not.toContain(MARK);
  }, 120000);

  it("a policy per profile: the tight profile (block) and the default (redact) hold no value, the loose profile (allow) shows it, in one server", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = hostileReply;
    const s = await openOnStub({ IRIS_PROFILES: JSON.stringify({ tight: { dataPolicy: "block" }, loose: { dataPolicy: "allow" } }) });

    const tight = await s.session.callOn("tight", "iris_message_body", { namespace: NS, headerIds: [1, 3] });
    expect(succeeded(tight).dataPolicy).toEqual({ policy: "block", redacted: 0, blocked: 2 });
    expect(JSON.stringify(tight)).not.toContain(MARK);

    const standard = await read(s.session, [1, 3]);
    expect(succeeded(standard).dataPolicy).toEqual({ policy: "redact", redacted: 1, blocked: 1 });
    expect(JSON.stringify(standard)).not.toContain(MARK);

    const loose = await s.session.callOn("loose", "iris_message_body", { namespace: NS, headerIds: [1, 3] });
    expect(succeeded(loose).dataPolicy).toEqual({ policy: "allow", redacted: 0, blocked: 0 });
    expect(JSON.stringify(loose)).toContain(MARK);

    const unknown = await s.session.callOn("nosuchprofile", "iris_message_body", { namespace: NS, headerIds: [1] });
    expect(unknown.isError).toBe(true);
    expect(JSON.stringify(unknown)).not.toContain(MARK);

    await flush(s);
    expect(readFileSync(s.auditFile, "utf8")).not.toContain(MARK);
    expect(s.stderr()).not.toContain(MARK);
  }, 120000);

  it("a call that tightens a loose profile is audited with the applied policy and its counts, and the loose result is the only one that shows a value", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = hostileReply;
    const s = await openOnStub({ IRIS_DATA_POLICY: "allow" });

    const tightened = await read(s.session, [1, 3, 4], { dataPolicy: "redact", maxChars: 7101 });
    expect(succeeded(tightened).dataPolicy).toEqual({ policy: "redact", redacted: 1, blocked: 2 });
    expect(contentMax(tightened), "the caller's maxChars is echoed").toBe(7101);
    expect(JSON.stringify(tightened)).not.toContain(MARK);
    const looseResult = await read(s.session, [1, 3, 4], { maxChars: 7102 });
    expect(succeeded(looseResult).dataPolicy).toEqual({ policy: "allow", redacted: 0, blocked: 0 });
    expect(JSON.stringify(looseResult)).toContain(MARK);

    const entries = await pollAuditEntries(s.auditFile, { ...AUDIT_POLL, count: 2 });
    const own = (max: number): Item => entries.find((entry) => ((entry.params as Item | undefined) ?? {}).maxChars === max) as Item;
    expect(own(7101)).toMatchObject({ outcome: "ok", dataPolicy: { policy: "redact", redacted: 1, blocked: 2 } });
    expect(own(7102)).toMatchObject({ outcome: "ok", dataPolicy: { policy: "allow", redacted: 0, blocked: 0 } });
    await flush(s);
    expect(readFileSync(s.auditFile, "utf8")).not.toContain(MARK);
    expect(s.stderr()).not.toContain(MARK);
  }, 120000);

  it("a namespace without Interoperability is notApplicable with no items however many the reply carries, under every policy", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = () =>
      stubEnvelope({
        interopEnabled: false,
        items: [hostileItem(1), hostileItem(3)],
        count: 2,
        note: `${MARK}-NOTE`,
      });
    for (const [env, policy] of [
      [{}, "redact"],
      [{ IRIS_DATA_POLICY: "allow" }, "allow"],
      [{ IRIS_DATA_POLICY: "block" }, "block"],
    ] as Array<[Record<string, string>, string]>) {
      const s = await openOnStub(env);
      const result = await read(s.session, [1, 3]);
      const content = succeeded(result);
      expect(content.notApplicable, policy).toBe(true);
      expect(content.items, policy).toEqual([]);
      expect(content.count, policy).toBe(0);
      expect(content.dataPolicy, policy).toEqual({ policy, redacted: 0, blocked: 0 });
      expect(content.reason, policy).toContain(`Interoperability is not configured in namespace '${NS}'`);
      expect(Object.keys(content).sort(), policy).toEqual(["count", "dataPolicy", "items", "maxChars", "notApplicable", "reason"]);
      expect(JSON.stringify(result), policy).not.toContain(MARK);
    }
  }, 120000);
});

// ---------------------------------------------------------------------------------------------------------------
// The limits
// ---------------------------------------------------------------------------------------------------------------

describe("Story 39.5 QA: the bounds of the input (AC-1)", () => {
  it("a bad input is a validation error and sends no request, and each boundary value sends one", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    stub.reply = () => stubEnvelope({ interopEnabled: true, items: [], count: 0 });
    const s = await openOnStub();
    const twenty = Array.from({ length: 20 }, (_, index) => index + 1);

    const bad: Array<[string, Record<string, unknown>, string]> = [
      ["no headerIds", {}, "headerIds"],
      ["no header IDs", { headerIds: [] }, "headerIds"],
      ["21 header IDs", { headerIds: [...twenty, 21] }, "headerIds"],
      ["a zero", { headerIds: [0] }, "headerIds"],
      ["a zero string", { headerIds: ["0"] }, "headerIds"],
      ["a leading zero", { headerIds: ["007"] }, "headerIds"],
      ["a negative", { headerIds: [-1] }, "headerIds"],
      ["a fraction", { headerIds: [1.5] }, "headerIds"],
      ["a fractional string", { headerIds: ["1.5"] }, "headerIds"],
      ["an exponent string", { headerIds: ["1e3"] }, "headerIds"],
      ["a signed string", { headerIds: ["+1"] }, "headerIds"],
      ["a padded string", { headerIds: [" 1"] }, "headerIds"],
      ["a boolean", { headerIds: [true] }, "headerIds"],
      ["a null", { headerIds: [null] }, "headerIds"],
      ["an object", { headerIds: [{ id: 1 }] }, "headerIds"],
      ["a nested array", { headerIds: [[1]] }, "headerIds"],
      ["an injection string", { headerIds: ["1 OR 1=1"] }, "headerIds"],
      ["a non-ASCII digit", { headerIds: ["\u{663}"] }, "headerIds"],
      ["headerIds not an array", { headerIds: "1" }, "headerIds"],
      ["maxChars 0", { headerIds: [1], maxChars: 0 }, "maxChars"],
      ["maxChars -1", { headerIds: [1], maxChars: -1 }, "maxChars"],
      ["maxChars 1048577", { headerIds: [1], maxChars: 1048577 }, "maxChars"],
      ["maxChars a fraction", { headerIds: [1], maxChars: 10.5 }, "maxChars"],
      ["maxChars a string", { headerIds: [1], maxChars: "10" }, "maxChars"],
      ["maxChars a boolean", { headerIds: [1], maxChars: true }, "maxChars"],
      ["dataPolicy open", { headerIds: [1], dataPolicy: "open" }, "dataPolicy"],
      ["dataPolicy in capitals", { headerIds: [1], dataPolicy: "BLOCK" }, "dataPolicy"],
      ["dataPolicy empty", { headerIds: [1], dataPolicy: "" }, "dataPolicy"],
      ["dataPolicy a number", { headerIds: [1], dataPolicy: 1 }, "dataPolicy"],
      ["namespace a number", { headerIds: [1], namespace: 5 }, "namespace"],
    ];
    const before = routeRequests(stub).length;
    for (const [label, args, field] of bad) {
      const result = await s.session.call("iris_message_body", { namespace: NS, ...args });
      expect(result.isError, label).toBe(true);
      expect(allText(result), label).toContain(field);
    }
    expect(routeRequests(stub).slice(before), "no bad input reached a route").toEqual([]);

    const good: Array<[string, Record<string, unknown>]> = [
      ["20 header IDs, numbers and strings", { headerIds: twenty.map((n, index) => (index % 2 === 0 ? n : String(n))) }],
      ["one header ID, a long digit string", { headerIds: ["9007199254740993"] }],
      ["maxChars 1", { headerIds: [1], maxChars: 1 }],
      ["maxChars 1048576", { headerIds: [1], maxChars: 1048576 }],
      ["dataPolicy block", { headerIds: [1], dataPolicy: "block" }],
    ];
    for (const [label, args] of good) {
      const marker = routeRequests(stub).length;
      const result = await s.session.call("iris_message_body", { namespace: NS, ...args });
      expect(result.isError, `${label}: ${allText(result)}`).toBeFalsy();
      expect(routeRequests(stub).slice(marker), `${label}: one request`).toHaveLength(1);
    }
  }, 180000);
});

describe("Story 39.5 QA: maxChars is a cut of the redacted, sanitized text, at every length (AC-2, AC-3; AD-26)", () => {
  it("redact: at every maxChars the text is the first maxChars characters of the REDACTED text, truncated exactly when something was cut, and no identifying value ever appears", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const s = await openOnStub();
    for (const [label, raw] of [["CR", ADT], ["CRLF", ADT_CRLF]] as Array<[string, string]>) {
      stub.reply = (request) =>
        stubEnvelope({
          interopEnabled: true,
          items: (request.headerIds as number[]).map((id) => ({ ...hostileItem(label === "CR" ? 1 : 2), id: Number(id) })),
          count: (request.headerIds as number[]).length,
        });
      const expected = redactedAdtLf(raw);
      const length = expected.length;
      expect(length, "the fixture's redacted text is long enough to sweep").toBeGreaterThan(100);
      for (let max = 1; max <= length + 2; max += 1) {
        const result = await read(s.session, [1], { maxChars: max });
        const item = byId(succeeded(result), 1);
        const where = `${label}, maxChars ${max}`;
        expect(item.text, where).toBe(expected.slice(0, max));
        expect(item.truncated, where).toBe(max < length);
        expect(item.bodyPolicy, where).toMatchObject({ outcome: "redacted" });
        expect(JSON.stringify(result), where).not.toContain(MARK);
      }
    }
    await flush(s);
    expect(readFileSync(s.auditFile, "utf8")).not.toContain(MARK);
    expect(s.stderr()).not.toContain(MARK);
  }, 300000);

  it("allow: sanitization comes before the cut (CRLF is one character), the cut is exact at the text length and one short, and an astral character is never split", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const s = await openOnStub({ IRIS_DATA_POLICY: "allow" });
    const emoji = "\u{1F600}";
    const texts: Record<number, string> = {
      3: "a\r\nb", // sanitizes to "a\nb": 3 characters
      4: `ab${emoji}cd`, // 6 UTF-16 units
      5: `${emoji}x`, // 3 units, starting with a pair
      6: "q\u0001r\u007Fs\tt", // two controls, a TAB
      7: "x".repeat(1048576),
      8: "y".repeat(1048577),
    };
    stub.reply = (request) =>
      stubEnvelope({
        interopEnabled: true,
        items: (request.headerIds as number[]).map((id) => ({
          id: Number(id),
          found: true,
          bodyClassName: "%Stream.GlobalCharacter",
          bodyId: String(id),
          bodyKind: "stream",
          bodyAvailable: true,
          bodyText: texts[Number(id)],
          bodyTextComplete: true,
        })),
        count: (request.headerIds as number[]).length,
      });
    const cases: Array<[number, number, string, boolean]> = [
      [3, 3, "a\nb", false],
      [3, 2, "a\n", true],
      [3, 1, "a", true],
      [4, 6, `ab${emoji}cd`, false],
      [4, 5, `ab${emoji}c`, true],
      [4, 4, `ab${emoji}`, true],
      [4, 3, "ab", true],
      [4, 2, "ab", true],
      [4, 1, "a", true],
      [5, 1, "", true],
      [5, 2, emoji, true],
      [5, 3, `${emoji}x`, false],
      [6, 7, "q\u{FFFD}r\u{FFFD}s\tt", false],
      [6, 3, "q\u{FFFD}r", true],
      [7, 1048576, "x".repeat(1048576), false],
      [8, 1048576, "y".repeat(1048576), true],
    ];
    for (const [id, max, text, truncated] of cases) {
      const item = byId(succeeded(await read(s.session, [id], { maxChars: max })), id);
      const where = `text ${id}, maxChars ${max}`;
      expect(item.text, where).toBe(text);
      expect(item.truncated, where).toBe(truncated);
      expect(wellFormed(item.text as string), `${where}: no lone surrogate`).toBe(true);
    }
  }, 180000);

  it("allow: a text IRIS reports as incomplete is truncated even when it is shorter than maxChars", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const s = await openOnStub({ IRIS_DATA_POLICY: "allow" });
    stub.reply = (request) =>
      stubEnvelope({
        interopEnabled: true,
        items: (request.headerIds as number[]).map((id) => ({
          id: Number(id),
          found: true,
          bodyClassName: "%Stream.GlobalCharacter",
          bodyId: "1",
          bodyKind: "stream",
          bodyAvailable: true,
          bodyText: "0123456789",
          bodyTextComplete: Number(id) === 2,
        })),
        count: (request.headerIds as number[]).length,
      });
    const content = succeeded(await read(s.session, [1, 2], { maxChars: 10 }));
    expect(byId(content, 1)).toMatchObject({ text: "0123456789", truncated: true });
    expect(byId(content, 2)).toMatchObject({ text: "0123456789", truncated: false });
  }, 120000);
});

describe("Story 39.5 QA: an HL7 v2 text of any shape is shown redacted or withheld, never with an identifying value (AC-4; AD-26)", () => {
  const SHAPES: Array<[string, string]> = [
    ["plain", ADT],
    ["a BOM before MSH", `\u{FEFF}${ADT}`],
    ["a leading LF", `\n${ADT}`],
    ["a leading space", ` ${ADT}`],
    ["LF segment ends", ADT.replace(/\r/g, "\n")],
    ["CRLF segment ends", ADT_CRLF],
    ["mixed CR, LF and CRLF ends", ADT.replace("\rPID", "\r\nPID").replace("\rOBX", "\nOBX")],
    ["no final terminator", ADT.slice(0, -1)],
    ["a line split off a field", ADT.replace(`${MARK}-MRN^^^`, `${MARK}-MRN\r${MARK}-SPLIT|cont^^^`)],
    ["a line split off a field with LF", ADT.replace(`${MARK}-MRN^^^`, `${MARK}-MRN\n${MARK}-SPLITLF|cont^^^`)],
    ["a lowercase segment name", ADT.replace("PID|", "pid|")],
    ["a Z segment", `${ADT}ZZZ|${MARK}-Z|${KEEP}-Z\r`],
    ["MSH only", `MSH|^~\\&|${MARK}-APP|${MARK}-FAC\r`],
    ["a short MSH", "MSH|^~\\&"],
    ["unusable encoding characters", `MSH|abc|${MARK}-APP\rPID|1||${MARK}-MRN\r`],
    ["escape sequences in data", `MSH|^~\\&|A\rPID|1||${MARK}-A\\F\\${MARK}-B\\S\\\\T\\\\R\\\\E\\\\.br\\\\X0D\\${MARK}-C\r`],
    ["repetitions and subcomponents", `MSH|^~\\&|A\rPID|1||${MARK}-A~${MARK}-B~${MARK}-C^&&&${MARK}-D&${MARK}-E\r`],
    ["control characters in data", `MSH|^~\\&|A\rPID|1||${MARK}-MRN\u0001\u000B\u001F\u007F${MARK}-C0\r`],
    ["a line separator in data", `MSH|^~\\&|A\rPID|1||${MARK}-MRN\u{2028}${MARK}-LS\r`],
    ["a NUL in data", `MSH|^~\\&|A\rPID|1||${MARK}-MRN\u0000${MARK}-NUL\r`],
    ["other separators with the default ones in data", `MSH#!@$%#${MARK}-APP#B###2001##ADT!A01#${MARK}-CTL#P#2.5.1\rPID#1##${MARK}|MRN^X!${MARK}|Y@${MARK}-Z%W\r`],
    ["a batch", `FHS|^~\\&|${MARK}-FAPP\rBHS|^~\\&|${MARK}-BAPP\r${ADT}${ADT}BTS|2\rFTS|1\r`],
    ["a batch without a BHS", `FHS|^~\\&|${MARK}-FAPP\r${ADT}FTS|1\r`],
    ["two messages", ADT + ADT],
    ["a trailing line that is not a segment", `${ADT}${MARK}-TAIL-NO-SEGMENT`],
    ["a trailing field-like line", `${ADT}|${MARK}-TAIL-PIPE`],
    ["an empty text", ""],
    ["whitespace only", "   \r\n"],
    ["non-ASCII values", `MSH|^~\\&|A\rPID|1||${MARK}-\u{E9}\u{4E2D}\u{1F600}-MRN\rOBX|1|TX|GLU^${KEEP}-\u{E9}\u{4E2D}\u{1F600}^L||${MARK}-\u{E9}\r`],
  ];

  it("every shape: no identifying value anywhere (result, audit file, console log); a redacted text is the engine's, sanitized; a withheld one has the fixed unparseable reason", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const s = await openOnStub();
    let current = "";
    stub.reply = (request) =>
      stubEnvelope({
        interopEnabled: true,
        items: (request.headerIds as number[]).map((id) => ({
          id: Number(id),
          found: true,
          bodyClassName: "EnsLib.HL7.Message",
          bodyId: "1",
          bodyKind: "hl7v2",
          bodyAvailable: true,
          bodyText: current,
          bodyTextComplete: true,
        })),
        count: (request.headerIds as number[]).length,
      });
    const observed: string[] = [];
    for (const [label, text] of SHAPES) {
      current = text;
      const result = await read(s.session, [1]);
      const content = succeeded(result);
      const item = byId(content, 1);
      expect(JSON.stringify(result), label).not.toContain(MARK);
      const engineOut = engine.redactHl7(text);
      if (engineOut.ok) {
        expect(item.bodyPolicy, label).toMatchObject({ outcome: "redacted" });
        expect(item.text, label).toBe(sanitize(engineOut.text));
        expect(content.dataPolicy, label).toEqual({ policy: "redact", redacted: 1, blocked: 0 });
        if (text.includes(KEEP)) expect(String(item.text), `${label}: a kept value survives`).toContain(KEEP);
        observed.push(`${label}: redacted`);
      } else {
        expect(item.bodyPolicy, label).toEqual({ outcome: "blocked", reason: unparseable(engineOut.reason) });
        expect(item, label).not.toHaveProperty("text");
        expect(content.dataPolicy, label).toEqual({ policy: "redact", redacted: 0, blocked: 1 });
        observed.push(`${label}: withheld`);
      }
    }
    expect(observed.some((line) => line.endsWith("redacted")), "the sweep redacts some shapes").toBe(true);
    expect(observed.some((line) => line.endsWith("withheld")), "and withholds others").toBe(true);
    await flush(s);
    expect(readFileSync(s.auditFile, "utf8")).not.toContain(MARK);
    expect(s.stderr()).not.toContain(MARK);
  }, 300000);

  it("a cut that lands inside a segment of any shape holds no identifying value either, at every length of the shortest redactable shapes", async (ctx) => {
    if (skipIfReason(skipReason, ctx)) return;
    const s = await openOnStub();
    let current = "";
    stub.reply = (request) =>
      stubEnvelope({
        interopEnabled: true,
        items: (request.headerIds as number[]).map((id) => ({
          id: Number(id),
          found: true,
          bodyClassName: "EnsLib.HL7.Message",
          bodyId: "1",
          bodyKind: "hl7v2",
          bodyAvailable: true,
          bodyText: current,
          bodyTextComplete: true,
        })),
        count: (request.headerIds as number[]).length,
      });
    const shapes = SHAPES.filter(([label]) => ["control characters in data", "escape sequences in data", "other separators with the default ones in data", "mixed CR, LF and CRLF ends"].includes(label));
    expect(shapes).toHaveLength(4);
    for (const [label, text] of shapes) {
      current = text;
      const engineOut = engine.redactHl7(text);
      if (!engineOut.ok) throw new Error(`${label}: expected the engine to redact this shape (${engineOut.reason})`);
      const expected = sanitize(engineOut.text);
      for (let max = 1; max <= expected.length + 1; max += 1) {
        const result = await read(s.session, [1], { maxChars: max });
        const item = byId(succeeded(result), 1);
        expect(item.text, `${label}, maxChars ${max}`).toBe(expected.slice(0, max));
        expect(JSON.stringify(result), `${label}, maxChars ${max}`).not.toContain(MARK);
      }
    }
  }, 300000);
});
