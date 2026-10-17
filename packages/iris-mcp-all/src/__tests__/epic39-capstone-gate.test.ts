/**
 * Epic 39 capstone gate: the message-forensics loop of Epic 39 (search, then read) driven together on the
 * REAL wire under the PHI data policy, in the default suite (project rule #21), each leg naming the path it
 * guards (rule #59).
 *
 * Every leg drives the BUILT iris-interop-mcp dist (the search and read tools), spawned as a child process,
 * through the real MCP SDK `Client` over stdio, and calls the tools against the live IRIS with
 * `server: "default"` and an explicit namespace. The built iris-dev-mcp and iris-admin-mcp dists build and
 * tear down the fixture. The independent oracle is raw Atelier SQL (`header-row-oracle.ts`:
 * `oracleColumns`, `expectedRow`, `searchTableOracle`) and the texts that the fixture's own seed writes,
 * never the tools under test.
 *
 * Fixture mu (`interop-namespace-fixture.ts`, `seedCapstone`): the mapping-only interop namespace
 * `EXECMCPTMP396A` holds three synthetic HL7 v2 messages, each indexed with `Story394.SearchTable`, and four
 * Completed Request headers over three sessions, all on 2001-02-03 UTC. No production is started; the
 * traffic is saved directly, as every Epic 39 gate does. Every identifying value contains `SYNTHPHI396` and
 * appears only in PID-3 and OBX-5; the value that must survive redaction contains `KEEPME396` (OBX-3).
 *
 * Legs (each runs the loop from the seeded fixture up to its own step, so they pass in any order):
 *  1. Traffic is generated: the oracle sees headers 1-4 with the fixture's bodies, `EnsLib_HL7.SearchTable`
 *     holds the synthetic values (the positive control), and a second `Seed()` is refused.
 *  2. A `headers` search over the window equals the oracle row for row, then narrows to one session.
 *     Path: built interop server over stdio -> `iris_message_search` -> the search route -> Atelier SQL.
 *  3. A `searchTable` lookup of one MRN equals the `IN` oracle over the Search Table (headers 1, 2 and 3,
 *     never 4) under `redact`, and the result echoes no value.
 *  4. Under `redact` (the default) the lookup of leg 3, then `iris_message_body` on its row IDs, show the
 *     kept `KEEPME396` and no `SYNTHPHI` in either result, the audit file or the server's stderr, and the
 *     audit entry of the lookup logs `filters` as `[REDACTED]`. Path: SDK `Client` -> built interop dist over
 *     stdio -> `iris_message_body` -> `applyBodyReaderPolicy` -> `redactHl7`.
 *  5. Under `IRIS_DATA_POLICY=allow` the same chain shows the values, which is the positive control for
 *     leg 4: the same detector that reads clean there fires here, on the result and on the audit file. The
 *     body-only value (OBX-5) still reaches neither the audit file nor the server's stderr.
 *
 * Before any leg, `beforeAll` asserts that the deployed `ExecuteMCPv2` classes carry the
 * `BOOTSTRAP_VERSION` of the built shared dist, once the first built-server session has connected (the
 * server's startup bootstrap redeploys a deployment whose version differs). It removes leftovers by name and
 * asserts there are none; `afterAll` removes the namespace, its database files, the fixture class and the
 * temp files, and asserts nothing named `Story391Fixture` or `Story396` is left in HSCUSTOM.
 *
 * Budgets: the first built-server start (which includes the bootstrap deployment) stays under 60 s; each
 * search and each body read stays under 2 s (`[PERF]` log lines).
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the namespace and database `EXECMCPTMP396A` (with `Story396.Seed` and
 * `Story394.SearchTable` inside it) and the HSCUSTOM class `ExecuteMCPv2.Temp.Story391Fixture`. No message of
 * HSCUSTOM is read.
 *
 * Placement (rule #45): `@iris-mcp/all` spawns built dists. A missing or stale `shared`, dev, admin or
 * interop dist, an unresolvable SDK or an unreachable IRIS skips each test with the reason, or fails with
 * "may not be skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs`
 * `gateTestFiles`).
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
  atelierScalar,
  distEntry,
  firstText,
  fixtureDocumentNames,
  headerIds,
  irisClassMethod,
  irisTargetFromEnv,
  isIrisReachable,
  openAuditedSession,
  openWireSession,
  pollAuditEntries,
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
  STORY396_IDS,
  createInteropNamespace,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
  seedCapstone,
} from "./interop-namespace-fixture.js";
import { expectedRow, oracleColumns, searchTableOracle } from "./header-row-oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** The tag of the gate's `[SKIP]` line. */
const GATE_TAG = "epic39-capstone-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The one scratch namespace: mapping-only interop, holding fixture mu. */
const NS = "EXECMCPTMP396A";
const NAMESPACES = [NS];

/** The window W: every header of fixture mu (all fall on 2001-02-03 between 12:00:01 and 12:00:04 UTC). */
const FROM = "2001-02-03T11:59:00Z";
const TO = "2001-02-03T12:01:00Z";
/** The window as the SQL the oracle uses: the stored form, both ends inclusive. */
const WINDOW_SQL = "h.TimeCreated >= '2001-02-03 11:59:00' AND h.TimeCreated <= '2001-02-03 12:01:00'";

/** Every identifying value contains this marker; nothing a redacted surface holds may. */
const MARKER = "SYNTHPHI";
const MRN_P = "SYNTHPHI396-MRN-P";
const MRN_Q = "SYNTHPHI396-MRN-Q";
/** The value that survives redaction (OBX-3). */
const KEEP_CODE = "KEEPME396-CODE";
/** The identifying value only the bodies hold (OBX-5): no filter ever carries it. */
const BODY_ONLY = "SYNTHPHI396-NOTE";

const SEARCH_TABLE = "EnsLib.HL7.SearchTable";
/** The extent table of every `EnsLib.HL7.SearchTable` subclass, and its class extent in `Ens_Config.SearchTableProp`. */
const EXTENT_TABLE = "EnsLib_HL7.SearchTable";
const CLASS_EXTENT = "EnsLib.HL7.SearchTable";

const BUDGET_MS = 2000;
const FIRST_START_BUDGET_MS = 60000;

/**
 * The messages of fixture mu, written out from the spec table: the PID-3, the MSH-9 type and the MSH-10
 * control ID of each. The seed class builds the same texts; leg 5 compares the stored bodies to these.
 */
const MESSAGES = [
  { mrn: MRN_P, type: "ADT^A01", control: "Story396-CTL-1" },
  { mrn: MRN_P, type: "ADT^A08", control: "Story396-CTL-2" },
  { mrn: MRN_Q, type: "ADT^A01", control: "Story396-CTL-3" },
] as const;

/** The headers of fixture mu: ID, session, source, target, index of its message (into MESSAGES), and TimeCreated. */
const HEADERS = [
  { id: 1, sessionId: 396001, source: "Story396.Service", target: "Story396.Router", message: 0, created: "2001-02-03 12:00:01" },
  { id: 2, sessionId: 396001, source: "Story396.Router", target: "Story396.Operation", message: 0, created: "2001-02-03 12:00:02" },
  { id: 3, sessionId: 396002, source: "Story396.Service", target: "Story396.Router", message: 1, created: "2001-02-03 12:00:03" },
  { id: 4, sessionId: 396003, source: "Story396.Service", target: "Story396.Router", message: 2, created: "2001-02-03 12:00:04" },
] as const;

/** The ER7 text of message `index` as the tools render it: the seed's segments, with LF line ends. */
function er7Text(index: number): string {
  const message = MESSAGES[index] as (typeof MESSAGES)[number];
  return [
    `MSH|^~\\&|Story396-APP|Story396-FAC|||20010203120000||${message.type}|${message.control}|P|2.5.1`,
    `PID|1||${message.mrn}`,
    `OBX|1|TX|${KEEP_CODE}^KEEPME396-TEXT^L||SYNTHPHI396-NOTE`,
  ].join("\n");
}

/**
 * The same text as the redact policy renders it, derived by hand from the reviewed keep-list: MSH keeps
 * fields 1, 2, 9, 11 and 12 here (so MSH-3, 4, 7 and 10 become `***`), PID keeps 1 and 8, OBX keeps 1 to 4
 * (so PID-3 and OBX-5 become `***`). Six fields hold a non-empty leaf that is replaced.
 */
function redactedEr7Text(index: number): string {
  const message = MESSAGES[index] as (typeof MESSAGES)[number];
  return [
    `MSH|^~\\&|***|***|||***||${message.type}|***|P|2.5.1`,
    "PID|1||***",
    `OBX|1|TX|${KEEP_CODE}^KEEPME396-TEXT^L||***`,
  ].join("\n");
}
const REDACTED_FIELDS = 6;

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
/** The built interop server under default configuration (no data-policy setting: `redact`), writing an audit file. */
let redactS: AuditedSession;
/** The built interop server with `IRIS_DATA_POLICY=allow`, writing an audit file. */
let allowS: AuditedSession;
/** How long the first built-server start took, which includes the bootstrap deployment. */
let firstStartMs = 0;
let tempDir = "";

function wireOptions(pkg: string): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "epic39-capstone-gate",
  };
}

/** The target of the raw Atelier oracle: the scratch namespace. */
const oracleTarget = (): typeof TARGET => ({ ...TARGET, namespace: NS });

// -- Calling the tools ---------------------------------------------------

type Row = Record<string, unknown>;

interface SearchContent {
  action: string;
  rows: Row[];
  hasMore: boolean;
  nextCursor?: string;
  dataPolicy?: { policy: string; redacted: number; blocked: number };
}

interface BodyContent {
  items: Row[];
  count: number;
  dataPolicy: { policy: string; redacted: number; blocked: number };
  dataPolicyClamped?: boolean;
}

/** Run `body`, log its duration as a `[PERF]` line, and require it to stay inside the 2 s budget. */
async function timed<T>(what: string, body: () => Promise<T>): Promise<T> {
  const started = performance.now();
  const value = await body();
  const elapsedMs = Math.round(performance.now() - started);
  // eslint-disable-next-line no-console
  console.log(`[PERF] epic39-capstone: ${what} took ${elapsedMs} ms (budget ${BUDGET_MS} ms)`);
  expect(elapsedMs, `${what} stays inside the ${BUDGET_MS} ms budget`).toBeLessThan(BUDGET_MS);
  return value;
}

/** The structured content of a successful call: no error, one text block. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  expect(result.content, "one text block").toHaveLength(1);
  return result.structuredContent as unknown as T;
}

/** A `headers` search of the scratch namespace over W; `args` adds any field. */
function headersSearch(session: WireSession, args: Record<string, unknown> = {}): Promise<WireToolResult> {
  return timed("one headers search over W", () =>
    session.call("iris_message_search", { action: "headers", namespace: NS, from: FROM, to: TO, ...args }),
  );
}

/** A Search Table lookup of the scratch namespace over W: `PatientID` equal to `mrn`. */
function mrnLookup(session: WireSession, mrn: string): Promise<WireToolResult> {
  return timed(`one searchTable lookup of ${mrn.slice(-5)} over W`, () =>
    session.call("iris_message_search", {
      action: "searchTable",
      namespace: NS,
      from: FROM,
      to: TO,
      searchTableClass: SEARCH_TABLE,
      filters: [{ property: "PatientID", op: "eq", value: mrn }],
    }),
  );
}

/** `iris_message_body` on the scratch namespace for `headerIdList`. */
function readBodies(session: WireSession, headerIdList: number[]): Promise<WireToolResult> {
  return timed(`one body read of ${headerIdList.length} headers`, () =>
    session.call("iris_message_body", { namespace: NS, headerIds: headerIdList }),
  );
}

/** The header rows the oracle selects in W, written in SQL by hand (`extra` starts with ` AND `). */
async function headerOracle(extra = ""): Promise<Row[]> {
  const rows = await atelierQuery(
    oracleTarget(),
    `SELECT ${oracleColumns("h")} FROM Ens.MessageHeader h WHERE ${WINDOW_SQL}${extra} ORDER BY h.TimeCreated, h.ID`,
  );
  return rows.map(expectedRow);
}

/** The Search Table oracle for `PatientID` equal to the stored (lower-cased) value of `mrn`. */
function patientOracle(mrn: string): Promise<Row[]> {
  return searchTableOracle(
    TARGET,
    NS,
    EXTENT_TABLE,
    CLASS_EXTENT,
    "PatientID",
    WINDOW_SQL,
    `s.PropValue = '${mrn.toLowerCase()}'`,
  );
}

/** The names of the surfaces whose text holds an identifying value (case-insensitive). */
function leakedSurfaces(surfaces: Record<string, string>): string[] {
  return Object.entries(surfaces)
    .filter(([, text]) => text.toLowerCase().includes(MARKER.toLowerCase()))
    .map(([name]) => name);
}

/** The text of a body item without its trailing line end. */
const bodyText = (item: Row): string => String(item["text"]).replace(/\n+$/, "");

/**
 * The loop from the seeded fixture up to the read, on `session`: the lookup of `mrn`, which must return the
 * header IDs `expectedIds` (written by hand), then `iris_message_body` on those row IDs. The raw results
 * are returned so that the policy's own checks, and the leak sweep first of all, run on what was received.
 */
async function lookupThenRead(
  session: WireSession,
  mrn: string,
  expectedIds: number[],
): Promise<{ lookup: WireToolResult; read: WireToolResult }> {
  const lookup = await mrnLookup(session, mrn);
  const rowIds = headerIds(succeeded<SearchContent>(lookup).rows);
  expect(rowIds, "the lookup's row IDs, written by hand").toEqual(expectedIds);
  const read = await readBodies(session, rowIds);
  return { lookup, read };
}

// -- Setup and teardown --------------------------------------------------

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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Epic 39 capstone live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  tempDir = mkdtempSync(path.join(tmpdir(), "epic39-capstone-"));
  const started = performance.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  firstStartMs = Math.round(performance.now() - started);
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  await putFixtureClass(dev);
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS, { interop: true });
  await seedCapstone(dev, NS);

  // A positive control: the same check that must read empty after the run sees the namespace now.
  expect(await leftovers(dev, NAMESPACES), `the leftovers check sees ${NS} while it exists`).toEqual(
    expect.arrayContaining([`namespace ${NS}`, `database configuration ${NS}`]),
  );

  redactS = await openAuditedSession({ ...wireOptions("iris-interop-mcp"), auditFile: path.join(tempDir, "audit-redact.jsonl") });
  allowS = await openAuditedSession(
    { ...wireOptions("iris-interop-mcp"), auditFile: path.join(tempDir, "audit-allow.jsonl") },
    { IRIS_DATA_POLICY: "allow" },
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
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story391Fixture", "Story396"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [redactS?.session, allowS?.session, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- The loop ------------------------------------------------------------

describe("Epic 39 capstone: search, then read, under the PHI data policy on the built servers (legs 1-5)", () => {
  it("leg 1: traffic is generated: the oracle sees headers 1-4 with the fixture's bodies, the Search Table holds the synthetic values, and a second Seed is refused", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // eslint-disable-next-line no-console
    console.log(`[PERF] epic39-capstone: the first built-server start took ${firstStartMs} ms (budget ${FIRST_START_BUDGET_MS} ms)`);
    expect(firstStartMs, "the first armed bootstrap stays under its 60 s budget").toBeLessThan(FIRST_START_BUDGET_MS);
    expect(STORY396_IDS, "the seed's ID map").toEqual({ headers: "1,2,3,4", hl7: "1,2,3" });

    const stored = await atelierQuery(
      oracleTarget(),
      "SELECT ID, SessionId, Type, Status, IsError, SourceConfigName, TargetConfigName, MessageBodyClassName, MessageBodyId, TimeCreated " +
        "FROM Ens.MessageHeader ORDER BY ID",
    );
    expect(
      stored.map((row) => [
        Number(row["ID"]),
        Number(row["SessionId"]),
        Number(row["Type"]),
        Number(row["Status"]),
        Number(row["IsError"]),
        String(row["SourceConfigName"]),
        String(row["TargetConfigName"]),
        String(row["MessageBodyClassName"]),
        String(row["MessageBodyId"]),
        String(row["TimeCreated"]),
      ]),
      "the oracle sees the four Completed Request headers of the spec table, each with its message",
    ).toEqual(
      HEADERS.map((header) => [
        header.id,
        header.sessionId,
        1,
        9,
        0,
        header.source,
        header.target,
        "EnsLib.HL7.Message",
        String(header.message + 1),
        header.created,
      ]),
    );
    expect(
      await atelierScalar(oracleTarget(), "SELECT COUNT(*) AS N FROM EnsLib_HL7.Message WHERE ID IN (1, 2, 3)"),
      "the three messages the headers point at exist",
    ).toBe(3);

    const indexed = await atelierQuery(
      oracleTarget(),
      `SELECT DISTINCT s.DocId FROM ${EXTENT_TABLE} s WHERE s.PropValue [ 'synthphi396' ORDER BY s.DocId`,
    );
    expect(
      indexed.map((row) => Number(row["DocId"])),
      "the Search Table holds the synthetic value of each message (the positive control that the table can hold it)",
    ).toEqual([1, 2, 3]);

    const second = await irisClassMethod(dev, NS, "Story396.Seed", "Seed", []);
    expect(second, "a second Seed is refused").toMatch(/^REFUSED: the namespace already holds message headers/);
    expect(await atelierScalar(oracleTarget(), "SELECT COUNT(*) AS N FROM Ens.MessageHeader"), "the refusal changed nothing").toBe(4);
  }, 120000);

  it("leg 2: a headers search over W equals the oracle row for row and holds no identifying value; sessionId 396001 narrows it to headers 1 and 2", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const all = await headersSearch(redactS.session);
    const content = succeeded<SearchContent>(all);
    const expected = await headerOracle();
    expect(headerIds(expected), "the oracle selects the rows written by hand").toEqual([1, 2, 3, 4]);
    expect(content.rows, "every field of every row, in order").toEqual(expected);
    expect(content.action).toBe("headers");
    expect(content.hasMore).toBe(false);
    expect(JSON.stringify(all), "a headers result holds no identifying value").not.toContain(MARKER);

    const oneSession = await headersSearch(redactS.session, { sessionId: 396001 });
    const narrowed = succeeded<SearchContent>(oneSession);
    const narrowedExpected = await headerOracle(" AND h.SessionId = 396001");
    expect(headerIds(narrowedExpected), "the oracle selects the rows written by hand").toEqual([1, 2]);
    expect(narrowed.rows).toEqual(narrowedExpected);
    expect(JSON.stringify(oneSession)).not.toContain(MARKER);
  }, 120000);

  it("leg 3: a Search Table lookup of one MRN equals the IN oracle (headers 1, 2 and 3, never 4) under redact, and no value is echoed", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await mrnLookup(redactS.session, MRN_P);
    const content = succeeded<SearchContent>(result);
    const expected = await patientOracle(MRN_P);
    expect(headerIds(expected), "the oracle selects the rows written by hand").toEqual([1, 2, 3]);
    expect(content.rows, "every field of every row, in order").toEqual(expected);
    expect(headerIds(content.rows)).not.toContain(4);
    expect(content.action).toBe("searchTable");
    expect(content.hasMore).toBe(false);
    expect(content.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
    expect(JSON.stringify(result), "a lookup result echoes no Search Table value, stored or given").not.toContain(MARKER);
    expect(JSON.stringify(result).toLowerCase()).not.toContain(MARKER.toLowerCase());

    // The other MRN finds the other message: the lookup discriminates.
    const other = succeeded<SearchContent>(await mrnLookup(redactS.session, MRN_Q));
    const otherExpected = await patientOracle(MRN_Q);
    expect(headerIds(otherExpected)).toEqual([4]);
    expect(other.rows).toEqual(otherExpected);
  }, 120000);

  it("leg 4: under redact the lookup, then the body read, keep KEEPME396 and show no SYNTHPHI in either result, the audit file or stderr", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { lookup, read } = await lookupThenRead(redactS.session, MRN_P, [1, 2, 3]);

    // The audit file is written after the call returns: wait for the body read's own entry (the lookup's comes first).
    const auditRecords = await pollAuditEntries(redactS.auditFile, {
      tool: "iris_message_body",
      count: 1,
      returnAll: true,
      intervalMs: 50,
      timeoutMs: 10000,
      excerpt: 3000,
    });
    // stderr is a separate pipe from the answers: one more round trip lets the earlier calls' log lines arrive before it is read.
    await redactS.session.listTools();
    expect(redactS.stderr().length, "the server wrote to stderr at LOG_LEVEL=DEBUG").toBeGreaterThan(0);

    // First, the property the gate exists for: no identifying value on any surface.
    expect(
      leakedSurfaces({
        "the lookup result": JSON.stringify(lookup),
        "the body result": JSON.stringify(read),
        "the audit file": readFileSync(redactS.auditFile, "utf8"),
        "the server's stderr": redactS.stderr(),
      }),
      `${MARKER} leaked under the redact policy through the surfaces received below (the lookup result, the body result, the audit file or the server's stderr); the body read, for reference: ${firstText(read).slice(0, 300)}`,
    ).toEqual([]);

    const bodyContent = succeeded<BodyContent>(read);
    expect(bodyContent.items.map((item) => item["id"]), "the items, in the order of the lookup's rows").toEqual([1, 2, 3]);
    expect(bodyContent.dataPolicy).toEqual({ policy: "redact", redacted: 3, blocked: 0 });
    expect(bodyContent).not.toHaveProperty("dataPolicyClamped");
    for (const item of bodyContent.items) {
      const id = Number(item["id"]);
      const index = (HEADERS.find((header) => header.id === id) as (typeof HEADERS)[number]).message;
      expect(item["bodyKind"], `item ${id}`).toBe("hl7v2");
      expect(item["format"], `item ${id}`).toBe("er7");
      expect(item["bodyPolicy"], `item ${id}`).toEqual({ outcome: "redacted", redactedFields: REDACTED_FIELDS });
      expect(String(item["text"]), `item ${id}: the kept code survives`).toContain(KEEP_CODE);
      expect(bodyText(item), `item ${id}: the text is the seed's, redacted as the keep-list says`).toBe(redactedEr7Text(index));
    }

    // The audit trail: the lookup logs its filters as [REDACTED]; both calls record the policy and its counts.
    const lookupRecords = auditRecords.filter((record) => record["tool"] === "iris_message_search" && record["action"] === "searchTable");
    expect(lookupRecords.length, "the audit file holds an entry for the lookup").toBeGreaterThanOrEqual(1);
    for (const record of lookupRecords) {
      expect((record["params"] as Row)["filters"], "the lookup's filters in the audit entry").toBe("[REDACTED]");
      expect(record).toMatchObject({ outcome: "ok", dataPolicy: { policy: "redact", redacted: 0, blocked: 0 } });
    }
    const readRecords = auditRecords.filter((record) => record["tool"] === "iris_message_body");
    expect(readRecords[readRecords.length - 1]).toMatchObject({
      outcome: "ok",
      dataPolicy: { policy: "redact", redacted: 3, blocked: 0 },
      params: { headerIds: [1, 2, 3] },
    });
  }, 120000);

  it("leg 5: under allow the same chain shows the values, which is the positive control for the redact leg", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const { lookup, read } = await lookupThenRead(allowS.session, MRN_P, [1, 2, 3]);
    const bodyContent = succeeded<BodyContent>(read);

    expect(bodyContent.items.map((item) => item["id"])).toEqual([1, 2, 3]);
    expect(bodyContent.dataPolicy).toEqual({ policy: "allow", redacted: 0, blocked: 0 });
    for (const item of bodyContent.items) {
      const id = Number(item["id"]);
      const index = (HEADERS.find((header) => header.id === id) as (typeof HEADERS)[number]).message;
      expect(item["bodyKind"], `item ${id}`).toBe("hl7v2");
      expect(item["format"], `item ${id}`).toBe("er7");
      expect(item["bodyPolicy"], `item ${id}`).toEqual({ outcome: "none" });
      const text = String(item["text"]);
      expect(text, `item ${id}: the identifier`).toContain(MRN_P);
      expect(text, `item ${id}: the value`).toContain(BODY_ONLY);
      expect(text, `item ${id}: the kept code`).toContain(KEEP_CODE);
      expect(bodyText(item), `item ${id}: the text is the seed's own`).toBe(er7Text(index));
    }

    // The detector that reads clean in leg 4 fires here, on the result and on the audit file.
    expect(leakedSurfaces({ "the lookup result": JSON.stringify(lookup) }), "a lookup result echoes no value even under allow").toEqual([]);
    expect(leakedSurfaces({ "the body result": JSON.stringify(read) }), "the allow result holds the positive control").toEqual(["the body result"]);
    await pollAuditEntries(allowS.auditFile, { tool: "iris_message_body", count: 1, intervalMs: 50, timeoutMs: 10000, excerpt: 3000 });
    const logged = await pollAuditEntries(allowS.auditFile, {
      tool: "iris_message_search",
      count: 1,
      isWanted: (record) => record["action"] === "searchTable",
      intervalMs: 50,
      timeoutMs: 10000,
      excerpt: 3000,
    });
    const lookupRecord = logged.find((record) => record["action"] === "searchTable");
    expect((lookupRecord?.["params"] as Row)["filters"], "under allow the filters are logged as given").toEqual([
      { property: "PatientID", op: "eq", value: MRN_P },
    ]);
    expect(
      leakedSurfaces({ "the audit file": readFileSync(allowS.auditFile, "utf8") }),
      "the allow audit file holds the positive control",
    ).toEqual(["the audit file"]);

    // Under allow too, body content reaches neither the audit file nor the console log: the logged value above is
    // the caller's filter, and OBX-5 is a value only the bodies hold.
    await allowS.session.listTools();
    expect(allowS.stderr().length, "the allow server wrote to stderr at LOG_LEVEL=DEBUG").toBeGreaterThan(0);
    expect(readFileSync(allowS.auditFile, "utf8"), "the allow audit file holds no body-only value").not.toContain(BODY_ONLY);
    expect(allowS.stderr(), "the allow server's stderr holds no body-only value").not.toContain(BODY_ONLY);
  }, 120000);
});
