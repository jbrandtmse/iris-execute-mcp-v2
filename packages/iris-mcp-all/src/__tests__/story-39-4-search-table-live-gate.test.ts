/**
 * Story 39.4 live gate: `iris_message_search` `searchTable`, driven on the REAL wire against disposable
 * Interoperability namespaces, in the default suite (rule #59: each row names the path it guards).
 *
 * Paths: the BUILT iris-interop-mcp dist, spawned as a child process and driven by the MCP SDK `Client`
 * over stdio, for every tool row; raw HTTP `POST`s to `/api/executemcp/v2/interop/message/search` for the
 * route rows and the injection fuzz (past every MCP-layer check, so they exercise the handler's own
 * validation). The oracle is SQL written by hand over the search table, resolving the PropId with its own
 * join on `Ens_Config.SearchTableProp`, run through the raw Atelier `action/query` route against the same
 * namespace, never the code under test.
 *
 * Fixtures (`interop-namespace-fixture.ts`): A (`EXECMCPTMP394A`) holds fixture tau, eleven headers over six
 * HL7 messages (five indexed by `Story394.SearchTable`) and one string body; B (`EXECMCPTMP394B`) compiles a
 * different Search Table class first, so its PropIds differ from A's; C (`EXECMCPTMP394C`) has the interop
 * mappings and no Search Table. Every identifying value contains `SYNTHPHI394`, and all times are on
 * 2001-02-03 UTC. `beforeAll` removes leftovers by name and asserts there are none; `afterAll` removes the
 * three namespaces, their database files and the fixture class and asserts nothing is left.
 *
 * Rows:
 *  1. `capture` (armed only by `STORY_39_4_CAPTURE=1`): replay the `headers` and `body` request list against
 *     A and C and write `fixtures/story-39-4-search-baseline.json`. Run once, on the classes deployed
 *     BEFORE the searchTable action existed.
 *  2. Byte identity: replay every captured request against the current classes; each raw response text
 *     equals its capture, and the capture predates the `BOOTSTRAP_VERSION` the gate runs on.
 *  3. The MRN lookup, every operator on every kind of property, combined filters, `bodyClass` and paging,
 *     each equal to the hand-written `IN` / `NOT IN` oracle over the search table.
 *  4. A lookup returns header rows only: no Search Table or body value in any response.
 *  5. Refusals over the route: a property, a class or a shape that cannot be looked up names its parameter
 *     and never the value, and a shape error comes before the namespace switch.
 *  6. The injection fuzz over the property, operator and value slots, driven at the route.
 *  7. A second namespace with other PropIds, a namespace with no Search Table, and a missing namespace.
 *  8. The data policy (`block` makes no IRIS call, per profile, `redact` and `allow`) and the audit trail.
 *  9. The plan of every statement the route prepared, read back from `INFORMATION_SCHEMA.STATEMENTS`.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the three `EXECMCPTMP394*` namespaces and databases, and the HSCUSTOM
 * class `ExecuteMCPv2.Temp.Story391Fixture`. A missing or stale dist, an unresolvable SDK or an
 * unreachable IRIS skips each row with the reason, or fails with "may not be skipped" when
 * `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDeployedBootstrapVersion,
  atelierQuery,
  distEntry,
  executeMcpPost,
  firstText,
  fixtureDocumentNames,
  headerIds,
  irisTargetFromEnv,
  isIrisReachable,
  openWireSession,
  pollAuditEntries,
  postEnvelope,
  resolveSdkEsmDir,
  shippedBootstrapVersion,
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
  resetSide,
  seedSearchTable,
  sideCount,
  sideDefined,
} from "./interop-namespace-fixture.js";
import { HEADER_COLUMNS, HEADER_INDEX_HINT, headerPlanProblems, searchTableCondition, searchTableOracle, squash } from "./header-row-oracle.js";
import { fuzzText } from "./fuzz-corpus.js";
import { mulberry32 } from "../../../shared/src/__tests__/test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const GATE_TAG = "story-39-4-search-table-live-gate";
const BASELINE_PATH = path.join(__dirname, "fixtures", "story-39-4-search-baseline.json");

const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";
const CAPTURE = process.env.STORY_39_4_CAPTURE === "1";

/** The namespaces: A (fixture tau), B (a different Search Table class), C (not configured). */
const NS_A = "EXECMCPTMP394A";
const NS_B = "EXECMCPTMP394B";
const NS_C = "EXECMCPTMP394C";
const NAMESPACES = [NS_A, NS_B, NS_C];

/** The `BOOTSTRAP_VERSION` the baseline must have been captured on: the one before this story. */
const PRE_STORY_BOOTSTRAP_VERSION = "f7b0868c95d0";

/** The window W: every header of fixture tau except header 11. */
const FROM = "2001-02-03T07:00:00Z";
const TO = "2001-02-03T09:00:00Z";
const ROUTE = "/interop/message/search";

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
/** The built interop server under default configuration (no data-policy setting: `redact`). */
let interop: WireSession;
/** How long the first built-server start took, which includes the bootstrap deployment. */
let firstStartMs = 0;
let tempDir = "";

function wireOptions(pkg: string, extra: Partial<WireSessionOptions> = {}): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "story-39-4-live-gate",
    ...extra,
  };
}

/** Sessions the rows open, closed in `afterAll`. */
const opened: WireSession[] = [];

/** A session on the built interop server with `extraEnv`, and, when given, a receiver for its stderr. */
async function interopSession(
  extraEnv: Record<string, string> = {},
  onStderr?: (chunk: string) => void,
): Promise<WireSession> {
  const session = await openWireSession(wireOptions("iris-interop-mcp", onStderr ? { onStderr } : {}), extraEnv);
  opened.push(session);
  return session;
}

// -- The request list the byte-identity pin replays ----------------------------

interface CaptureCase {
  name: string;
  body: Record<string, unknown>;
}

/** A `headers` request against `namespace` with an explicit window. */
const headersRequest = (name: string, namespace: string, extra: Record<string, unknown> = {}): CaptureCase => ({
  name,
  body: { action: "headers", namespace, from: FROM, to: TO, ...extra },
});

/** A `body` request against `namespace` with an explicit window. */
const bodyRequest = (name: string, namespace: string, extra: Record<string, unknown> = {}): CaptureCase => ({
  name,
  body: {
    action: "body",
    namespace,
    from: FROM,
    to: TO,
    bodyClass: "EnsLib.HL7.Message",
    filters: [{ property: "RawContent", op: "contains", value: "SYNTHPHI394-MRN-1" }],
    ...extra,
  },
});

/**
 * Every `headers` and `body` request the capture replays: against A, the window alone and with each of
 * three header filters, two pages of two, three `headers` refusals and four `body` requests; against C, a
 * `headers` request and the same `body` search. The two sanctioned text changes (the route's `action`
 * refusal and the `filters`-on-`headers` refusal) are not in the list.
 */
const CAPTURE_CASES: CaptureCase[] = [
  headersRequest("A headers: window alone", NS_A),
  headersRequest("A headers: bodyClass", NS_A, { bodyClass: "EnsLib.HL7.Message" }),
  headersRequest("A headers: target", NS_A, { target: "Story394.Other" }),
  headersRequest("A headers: errorOnly", NS_A, { errorOnly: true }),
  headersRequest("A headers: limit 2, page 1", NS_A, { limit: 2 }),
  headersRequest("A headers: limit 2, page 2", NS_A, { limit: 2, afterTimeCreated: "2001-02-03 08:00:01", afterId: 2 }),
  { name: "A headers: no from", body: { action: "headers", namespace: NS_A, to: TO } },
  headersRequest("A headers: window over 7 days", NS_A, { from: "2001-01-27T00:00:00Z", to: "2001-02-03T00:00:01Z" }),
  headersRequest("A headers: limit 0", NS_A, { limit: 0 }),
  bodyRequest("A body: RawContent contains the marker", NS_A),
  bodyRequest("A body: a class that does not exist", NS_A, { bodyClass: "No.Such.Story394Class" }),
  bodyRequest("A body: filters empty", NS_A, { filters: [] }),
  bodyRequest("A body: a property that does not exist", NS_A, { filters: [{ property: "Nope", op: "eq", value: "x" }] }),
  headersRequest("C headers: window alone", NS_C),
  bodyRequest("C body: RawContent contains the marker", NS_C),
];

interface BaselineCase extends CaptureCase {
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

/** Send one request to the search route and return the raw HTTP answer. */
const sendSearch = (body: Record<string, unknown>): Promise<{ status: number; text: string }> =>
  executeMcpPost(TARGET, ROUTE, body);

// -- Setup and teardown ------------------------------------------------

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared");
  for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);
  if (!skipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      skipReason =
        "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    } else if (!(await isIrisReachable(TARGET.host, TARGET.port))) {
      skipReason = `IRIS is not reachable at http://${TARGET.host}:${TARGET.port}/api/atelier/ (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.4 live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  tempDir = mkdtempSync(path.join(tmpdir(), "story-39-4-gate-"));
  const started = performance.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  firstStartMs = Math.round(performance.now() - started);
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  interop = await openWireSession(wireOptions("iris-interop-mcp"));
  await putFixtureClass(dev);
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS_A, { interop: true });
  await seedSearchTable(dev, NS_A, "a");
  await createInteropNamespace(admin, dev, NS_B, { interop: true });
  await seedSearchTable(dev, NS_B, "b");
  await createInteropNamespace(admin, dev, NS_C, { interop: true });

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
      for (const { filter: filterText, names } of await fixtureDocumentNames(dev, ["Story391", "Story393", "Story394"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filterText} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [...opened, interop, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- Byte identity of the headers and body wire ---------------------------------

describe("Story 39.4: the headers and body wire is unchanged (AD-15, AD-33)", () => {
  it.runIf(CAPTURE)("capture: replay the request list against A and C and write the baseline", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const deployed = await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
    expect(deployed, "the capture runs on the classes deployed before the searchTable action").toBe(
      PRE_STORY_BOOTSTRAP_VERSION,
    );

    const info = await dev.call("iris_server_info", { namespace: TARGET.namespace });
    const irisVersion = String(
      (info.structuredContent as { content?: { version?: unknown } } | undefined)?.content?.version ?? "",
    );
    expect(irisVersion, "the IRIS version string").not.toBe("");

    const cases: BaselineCase[] = [];
    for (const requestCase of CAPTURE_CASES) {
      const answer = await sendSearch(requestCase.body);
      cases.push({ ...requestCase, status: answer.status, text: answer.text });
    }
    const baseline: Baseline = {
      capturedWithBootstrapVersion: deployed,
      irisVersion,
      capturedAt: new Date().toISOString(),
      command:
        "STORY_39_4_CAPTURE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-4-search-table-live-gate.test.ts -t capture",
      cases,
    };
    mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  }, 240000);

  it.skipIf(CAPTURE)("every headers and body request answers byte for byte as it did on the pre-story classes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;

    expect(baseline.capturedWithBootstrapVersion, "the capture was taken on the classes before this story").toBe(
      PRE_STORY_BOOTSTRAP_VERSION,
    );
    expect(baseline.capturedWithBootstrapVersion, "the gate runs on a different build than the capture").not.toBe(
      await shippedBootstrapVersion(REPO_ROOT),
    );
    expect(baseline.cases.map((c) => c.name), "the capture holds every request in the list").toEqual(
      CAPTURE_CASES.map((c) => c.name),
    );

    for (const captured of baseline.cases) {
      const answer = await sendSearch(captured.body);
      expect({ status: answer.status, text: answer.text }, captured.name).toEqual({
        status: captured.status,
        text: captured.text,
      });
    }
  }, 240000);
});

// -- The oracle and the helpers --------------------------------------------

/** Every identifying value contains this marker; nothing a response holds may. */
const MARKER = "SYNTHPHI394";
/** A value stored in an entry that no lookup result may hold either (it is lower-cased in the table). */
const KEEP = "KEEPME394";
/** A namespace that does not exist: a call that reaches the namespace switch fails there. */
const NS_Z = "EXECMCPTMP394Z";
const ST = "EnsLib.HL7.SearchTable";
const ST4 = "Story394.SearchTable";
const ST_B = "Story394.SearchTableB";
/** The extent table of all three classes (their extent root) and their class extent in `Ens_Config.SearchTableProp`. */
const EXTENT_TABLE = "EnsLib_HL7.SearchTable";
const CLASS_EXTENT = "EnsLib.HL7.SearchTable";

/** The window W as the SQL the oracle uses: the stored form, both ends inclusive. */
const WINDOW_SQL = "h.TimeCreated >= '2001-02-03 07:00:00' AND h.TimeCreated <= '2001-02-03 09:00:00'";

/** The headers of W whose body is an `EnsLib.HL7.Message` (header 7 is a string, 9 a literal, 11 is outside W), by hand. */
const HL7_HEADERS: readonly number[] = [1, 2, 3, 4, 5, 6, 8, 10];

type Structured = Record<string, unknown> & {
  action: string;
  rows: Array<Record<string, unknown>>;
  hasMore: boolean;
  nextCursor?: string;
  dataPolicy?: unknown;
};

/** The structured content of a successful lookup, which holds no Search Table value, stored or given. */
function succeeded(result: WireToolResult): Structured {
  expect(result.isError, firstText(result)).toBeFalsy();
  const text = JSON.stringify(result).toLowerCase();
  expect(text, "a lookup result holds no Search Table value").not.toContain(MARKER.toLowerCase());
  expect(text, "nor a value of an entry that was not asked for").not.toContain(KEEP.toLowerCase());
  return result.structuredContent as Structured;
}

/** A Search Table lookup of A over W through `session`; `args` overrides any field. */
function tableSearch(session: WireSession, args: Record<string, unknown> = {}): Promise<WireToolResult> {
  return session.call("iris_message_search", {
    action: "searchTable",
    namespace: NS_A,
    from: FROM,
    to: TO,
    searchTableClass: ST,
    ...args,
  });
}

/** One filter. */
const filter = (property: string, op: string, value?: string | number | boolean): Record<string, unknown> =>
  value === undefined ? { property, op } : { property, op, value };

/** A Search Table lookup of A over W straight to the route. */
const routeBody = (filters: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: "searchTable",
  namespace: NS_A,
  from: FROM,
  to: TO,
  searchTableClass: ST,
  filters,
  ...extra,
});

/**
 * The hand-written `IN` / `NOT IN` oracle (Rule #36) over window W: `searchTableOracle` of
 * `header-row-oracle.ts`, resolving the PropId by its own join on `Ens_Config.SearchTableProp`.
 */
const oracle = (
  namespace: string,
  property: string,
  predicate: string,
  negate = false,
  extra = "",
): Promise<Array<Record<string, unknown>>> =>
  searchTableOracle(TARGET, namespace, EXTENT_TABLE, CLASS_EXTENT, property, WINDOW_SQL, predicate, negate, extra);

// -- The MRN lookup ---------------------------------------------------------------

describe.skipIf(CAPTURE)("Story 39.4: the synthetic message is found by its MRN (AC-4, G34)", () => {
  it("PatientID eq the MRN finds headers 1, 2 (second PID-3 repetition) and 10, equal to the oracle; 7 (ID collision) and 11 (outside W) never appear", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const held = await atelierQuery(
      { ...TARGET, namespace: NS_A },
      "SELECT s.DocId FROM EnsLib_HL7.SearchTable s WHERE s.PropValue [ 'synthphi394'",
    );
    expect(held.length, "the stored entries hold the marker (positive control: the table can hold it)").toBeGreaterThan(0);
    const collision = await atelierQuery(
      { ...TARGET, namespace: NS_A },
      "SELECT ID, MessageBodyClassName, MessageBodyId FROM Ens.MessageHeader WHERE ID IN (1, 7, 11) ORDER BY ID",
    );
    expect(
      collision.map((row) => [Number(row["ID"]), String(row["MessageBodyClassName"]), String(row["MessageBodyId"])]),
      "header 7 is a string body whose ID equals the HL7 message of headers 1 and 11",
    ).toEqual([
      [1, "EnsLib.HL7.Message", "1"],
      [7, "Ens.StringRequest", "1"],
      [11, "EnsLib.HL7.Message", "1"],
    ]);

    const expected = await oracle(NS_A, "PatientID", "s.PropValue = 'synthphi394-mrn-1'");
    expect(headerIds(expected), "the oracle selects the rows written by hand").toEqual([1, 2, 10]);

    const started = performance.now();
    const content = succeeded(await tableSearch(interop, { filters: [filter("PatientID", "eq", "SYNTHPHI394-MRN-1")] }));
    const elapsed = performance.now() - started;
    // eslint-disable-next-line no-console
    console.log(`[PERF] story-39-4: first start ${firstStartMs} ms; one lookup of A over W ${Math.round(elapsed)} ms`);

    expect(content.rows, "every field of every row, in order").toEqual(expected);
    expect(headerIds(content.rows)).not.toContain(7);
    expect(headerIds(content.rows)).not.toContain(11);
    expect(content.action).toBe("searchTable");
    expect(content.hasMore).toBe(false);
    expect(content).not.toHaveProperty("nextCursor");
    expect(content.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
    expect(firstStartMs, "the first armed bootstrap stays under its 60 s budget").toBeLessThan(60000);
    expect(elapsed, "one lookup of A over W stays under its 2 s budget").toBeLessThan(2000);
  }, 120000);
});

// -- Each operator on each kind of property -----------------------------------------

interface OperatorCase {
  name: string;
  searchTableClass: string;
  filters: Array<Record<string, unknown>>;
  /** The property the oracle resolves by name, and its predicate on the stored form, written by hand with literals. */
  property: string;
  predicate: string;
  /** The oracle selects the messages with no such entry. */
  negate?: boolean;
  /** The header IDs the oracle selects, in order: written by hand, so an oracle that returns nothing cannot pass. */
  ids: number[];
}

const OPERATOR_CASES: OperatorCase[] = [
  { name: "PatientID contains: the value is lower-cased like the stored one", searchTableClass: ST, filters: [filter("PatientID", "contains", "MRN-1")], property: "PatientID", predicate: "s.PropValue [ 'mrn-1'", ids: [1, 2, 10] },
  { name: "PatientID startsWith matches PID-2 as well as PID-3", searchTableClass: ST, filters: [filter("PatientID", "startsWith", "synthphi394-alt")], property: "PatientID", predicate: "s.PropValue %STARTSWITH 'synthphi394-alt'", ids: [1, 10] },
  { name: "PatientID ne: NOT EXISTS, so header 2 (which also has MRN-1) is excluded", searchTableClass: ST, filters: [filter("PatientID", "ne", "SYNTHPHI394-MRN-1")], property: "PatientID", predicate: "s.PropValue = 'synthphi394-mrn-1'", negate: true, ids: [3, 4, 5, 6, 8] },
  { name: "PatientID isNull: header 6 was never indexed and header 8 has no message", searchTableClass: ST, filters: [filter("PatientID", "isNull")], property: "PatientID", predicate: "s.PropValue <> ''", negate: true, ids: [6, 8] },
  { name: "PatientID notNull", searchTableClass: ST, filters: [filter("PatientID", "notNull")], property: "PatientID", predicate: "s.PropValue <> ''", ids: [1, 2, 3, 4, 5, 10] },
  { name: "PatientName ge", searchTableClass: ST, filters: [filter("PatientName", "ge", "synthphi394^t")], property: "PatientName", predicate: "s.PropValue <> '' AND s.PropValue >= 'synthphi394^t'", ids: [2] },
  { name: "PatientName lt: the value is lower-cased", searchTableClass: ST, filters: [filter("PatientName", "lt", "SYNTHPHI394^P")], property: "PatientName", predicate: "s.PropValue <> '' AND s.PropValue < 'synthphi394^p'", ids: [1, 10] },
  { name: "MSHControlID eq compares exactly: header 2 (CTL-A) is not CTL-a", searchTableClass: ST, filters: [filter("MSHControlID", "eq", "Story394-CTL-a")], property: "MSHControlID", predicate: "%EXACT(s.PropValue) = 'Story394-CTL-a'", ids: [1, 10] },
  { name: "MSHControlID startsWith", searchTableClass: ST, filters: [filter("MSHControlID", "startsWith", "Story394-CTL-")], property: "MSHControlID", predicate: "%EXACT(s.PropValue) %STARTSWITH 'Story394-CTL-'", ids: [1, 2, 3, 4, 5, 10] },
  { name: "MSHControlID startsWith in the wrong case matches nothing", searchTableClass: ST, filters: [filter("MSHControlID", "startsWith", "story394")], property: "MSHControlID", predicate: "%EXACT(s.PropValue) %STARTSWITH 'story394'", ids: [] },
  { name: "MSHTypeName eq is stored as adt_a01", searchTableClass: ST, filters: [filter("MSHTypeName", "eq", "ADT_A01")], property: "MSHTypeName", predicate: "s.PropValue = 'adt_a01'", ids: [1, 4, 5, 10] },
  { name: "Story394Int eq the string 0007 is the integer 7", searchTableClass: ST4, filters: [filter("Story394Int", "eq", "0007")], property: "Story394Int", predicate: "s.PropValue = '7'", ids: [1, 10] },
  { name: "Story394Int eq the number 7", searchTableClass: ST4, filters: [filter("Story394Int", "eq", 7)], property: "Story394Int", predicate: "s.PropValue = '7'", ids: [1, 10] },
  { name: "Story394Int ne 12: the messages with no entry of 12", searchTableClass: ST4, filters: [filter("Story394Int", "ne", 12)], property: "Story394Int", predicate: "s.PropValue = '12'", negate: true, ids: [1, 3, 4, 5, 6, 8, 10] },
  { name: "Story394Empty notNull: the StoreNulls marker never counts", searchTableClass: ST4, filters: [filter("Story394Empty", "notNull")], property: "Story394Empty", predicate: "s.PropValue <> ''", ids: [2] },
  { name: "Story394Empty isNull", searchTableClass: ST4, filters: [filter("Story394Empty", "isNull")], property: "Story394Empty", predicate: "s.PropValue <> ''", negate: true, ids: [1, 3, 4, 5, 6, 8, 10] },
];

describe.skipIf(CAPTURE)("Story 39.4: each operator on each kind of property equals a hand-written IN / NOT IN oracle (AC-4, Rule #36)", () => {
  for (const operatorCase of OPERATOR_CASES) {
    it(operatorCase.name, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      const expected = await oracle(NS_A, operatorCase.property, operatorCase.predicate, operatorCase.negate ?? false);
      expect(headerIds(expected), "the oracle selects the rows written by hand").toEqual(operatorCase.ids);

      const content = succeeded(
        await tableSearch(interop, { searchTableClass: operatorCase.searchTableClass, filters: operatorCase.filters }),
      );

      expect(content.rows, "every field of every row, in order").toEqual(expected);
      expect(content.action).toBe("searchTable");
      expect(content.hasMore).toBe(false);
      expect(content).not.toHaveProperty("nextCursor");
      expect(content.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
    }, 120000);
  }

  it("filters combine with AND, and with the header filters: MRN-1 and ORU_R01, then target and errorOnly", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const typeCondition = searchTableCondition(EXTENT_TABLE, CLASS_EXTENT, "MSHTypeName", "s.PropValue = 'oru_r01'");
    const expected = await oracle(NS_A, "PatientID", "s.PropValue = 'synthphi394-mrn-1'", false, ` AND ${typeCondition}`);
    expect(headerIds(expected)).toEqual([2]);
    const content = succeeded(
      await tableSearch(interop, { filters: [filter("PatientID", "eq", "SYNTHPHI394-MRN-1"), filter("MSHTypeName", "eq", "ORU_R01")] }),
    );
    expect(content.rows).toEqual(expected);

    const onlyThree = await oracle(
      NS_A,
      "PatientID",
      "s.PropValue %STARTSWITH 'synthphi394-mrn'",
      false,
      " AND h.TargetConfigName = 'Story394.Other' AND h.IsError = 1",
    );
    expect(headerIds(onlyThree)).toEqual([3]);
    const headerFiltered = succeeded(
      await tableSearch(interop, {
        filters: [filter("PatientID", "startsWith", "synthphi394-mrn")],
        target: "Story394.Other",
        errorOnly: true,
      }),
    );
    expect(headerFiltered.rows).toEqual(onlyThree);

    // The same header filters with a Search Table filter nothing satisfies: the header filters alone do not match.
    const none = succeeded(
      await tableSearch(interop, { filters: [filter("PatientID", "eq", "SYNTHPHI394-MRN-1")], target: "Story394.Other", errorOnly: true }),
    );
    expect(none.rows).toEqual([]);
  }, 120000);

  it("bodyClass EnsLib.HL7.Message equals the lookup without it, a subclass replaces the document class; Ens.StringRequest and a class that does not exist are refused naming bodyClass", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const filters = [filter("PatientID", "notNull")];
    const without = succeeded(await tableSearch(interop, { filters }));
    const narrowed = succeeded(await tableSearch(interop, { filters, bodyClass: "EnsLib.HL7.Message" }));
    expect(narrowed.rows).toEqual(without.rows);
    expect(headerIds(narrowed.rows)).toEqual([1, 2, 3, 4, 5, 10]);

    // A strict subclass of the document class replaces it as the header class: no header carries that class.
    const subclass = succeeded(await tableSearch(interop, { filters, bodyClass: "Story394.SubMessage" }));
    expect(subclass.rows, "the header class is the given subclass, so no header matches").toEqual([]);
    expect(subclass.hasMore).toBe(false);

    for (const bodyClass of ["Ens.StringRequest", "No.Such.Story394Class", "enslib.hl7.message"]) {
      const answer = await postEnvelope(TARGET, ROUTE, routeBody([filter("PatientID", "notNull")], { bodyClass }));
      expect(answer.errors.length, `${bodyClass}: ${answer.text}`).toBe(1);
      expect(answer.errors[0], bodyClass).toContain("'bodyClass'");
      expect(answer.errors[0], "the text may name the document class").toContain("EnsLib.HL7.Message");
      expect(answer.text).not.toContain(MARKER);
      expect(answer.result, `${bodyClass}: a refusal returns an empty result`).toEqual({});
      const viaTool = await tableSearch(interop, { filters, bodyClass });
      expect(viaTool.isError).toBe(true);
      expect(firstText(viaTool)).toContain("bodyClass");
    }
  }, 120000);

  // Six indexed headers: 1, 2, 3, 4, 5 and 10; the tie of headers 4 and 5 at 08:00:03 falls on a page boundary.
  it("pages of 2 join, in order, without a gap or a duplicate; the 4/5 tie breaks by ID; only a page with more carries nextCursor", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const expected = await oracle(NS_A, "PatientID", "s.PropValue <> ''");
    expect(headerIds(expected)).toEqual([1, 2, 3, 4, 5, 10]);

    const pages: Structured[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = succeeded(await tableSearch(interop, { filters: [filter("PatientID", "notNull")], limit: 2, ...(cursor === undefined ? {} : { cursor }) }));
      pages.push(page);
      if (!page.hasMore) break;
      expect(typeof page.nextCursor, `page ${pages.length} has more, so it carries nextCursor`).toBe("string");
      cursor = page.nextCursor;
    }

    expect(pages.map((page) => headerIds(page.rows))).toEqual([[1, 2], [3, 4], [5, 10]]);
    expect(pages.flatMap((page) => page.rows)).toEqual(expected);
    const last = pages[pages.length - 1] as Structured;
    expect(last.hasMore).toBe(false);
    expect(last).not.toHaveProperty("nextCursor");
    for (const page of pages) expect(page.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
  }, 120000);
});

// -- A lookup result is header rows only ---------------------------------------------

describe.skipIf(CAPTURE)("Story 39.4: a lookup returns header rows and never a Search Table value (AC-2)", () => {
  it("the matched entries hold the marker and the KEEPME value (positive control), and neither the tool nor the route returns either", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const held = await atelierQuery(
      { ...TARGET, namespace: NS_A },
      `SELECT s.PropValue FROM EnsLib_HL7.SearchTable s WHERE s.PropValue [ 'synthphi394' OR s.PropValue [ 'keepme394'`,
    );
    expect(held.length, "the entries hold the marker").toBeGreaterThan(0);
    expect(held.some((row) => String(row["PropValue"]).includes("keepme394")), "and the KEEPME value").toBe(true);

    const filters = [filter("Story394Empty", "notNull")];
    const viaTool = await tableSearch(interop, { searchTableClass: ST4, filters });
    expect(headerIds(succeeded(viaTool).rows), "the lookup matched the entry that holds the KEEPME value").toEqual([2]);
    expect(JSON.stringify(viaTool).toLowerCase()).not.toContain("keepme394");

    const viaRoute = await postEnvelope(TARGET, ROUTE, routeBody(filters, { searchTableClass: ST4 }));
    expect(viaRoute.errors).toEqual([]);
    expect((viaRoute.result.rows as Array<{ id: number }>).map((row) => row.id)).toEqual([2]);
    expect(viaRoute.text.toLowerCase(), "the raw route answer").not.toContain("synthphi394");
    expect(viaRoute.text.toLowerCase(), "the raw route answer").not.toContain("keepme394");
    expect(Object.keys((viaRoute.result.rows as Array<Record<string, unknown>>)[0] as object)).toEqual([
      "id", "sessionId", "type", "status", "isError", "sourceItem", "targetItem", "bodyClassName", "bodyId",
      "timeCreated", "timeProcessed", "correspondingMessageId",
    ]);
    expect(Object.keys(viaRoute.result)).toEqual([
      "action", "limit", "from", "to", "interopEnabled", "searchTablesConfigured", "rows", "hasMore",
    ]);
  }, 120000);
});

// -- Refusals ---------------------------------------------------------------------------

describe.skipIf(CAPTURE)("Story 39.4: a property, class or shape that cannot be looked up is refused, naming the parameter and not the value (AC-1)", () => {
  const STOCK_NAMES = ["MSHControlID", "MSHTypeName", "PatientAcct", "PatientID", "PatientName"];

  const REFUSED_PROPERTIES: Array<[string, string]> = [
    ["a property only the subclass defines (asked of the stock class)", "Story394Int"],
    ["a case variant", "patientid"],
    ["a column of the Search Table", "PropValue"],
    ["another column of the Search Table", "DocId"],
    ["a property nothing defines", "NoSuch"],
  ];
  for (const [what, property] of REFUSED_PROPERTIES) {
    it(`route: ${what} (${property}) is refused naming filters[0].property and listing the configured names`, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      const answer = await postEnvelope(TARGET, ROUTE, routeBody([filter(property, "eq", MARKER)]));

      expect(answer.status).toBe(200);
      expect(answer.errors.length, answer.text).toBe(1);
      expect(answer.errors[0]).toContain("filters[0].property");
      for (const name of STOCK_NAMES) expect(answer.errors[0], `lists ${name}`).toContain(name);
      expect(answer.errors[0], "the stock class has five properties, not the subclass's two").not.toContain("Story394");
      expect(answer.text).not.toContain(MARKER);
      expect(answer.result, "a refusal returns an empty result").toEqual({});
    }, 120000);
  }

  it("route: the subclass lists its own seven names, and refuses a range or a substring on an Integer property naming filters[0].op", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const unknown = await postEnvelope(TARGET, ROUTE, routeBody([filter("NoSuch", "eq", MARKER)], { searchTableClass: ST4 }));
    for (const name of [...STOCK_NAMES, "Story394Int", "Story394Empty"]) expect(unknown.errors[0], `lists ${name}`).toContain(name);

    for (const [op, value] of [["gt", 5], ["contains", "7"], ["startsWith", "7"], ["lt", MARKER], ["ge", 5], ["le", 5]] as const) {
      const answer = await postEnvelope(TARGET, ROUTE, routeBody([filter("Story394Int", op, value)], { searchTableClass: ST4 }));
      expect(answer.errors.length, `${op}: ${answer.text}`).toBe(1);
      expect(answer.errors[0], op).toContain("filters[0].op");
      expect(answer.errors[0], op).toContain("Integer");
      expect(answer.text, `${op}: the refusal does not echo the value`).not.toContain(MARKER);
      expect(answer.result).toEqual({});
    }
    for (const op of ["eq", "ne", "isNull", "notNull"]) {
      const answer = await postEnvelope(TARGET, ROUTE, routeBody([op === "isNull" || op === "notNull" ? filter("Story394Int", op) : filter("Story394Int", op, 7)], { searchTableClass: ST4 }));
      expect(answer.errors, `${op} is allowed on an Integer property`).toEqual([]);
    }
  }, 120000);

  it("a value of 256 characters runs, and one of 257 is refused naming filters[0].value for every operator that takes a value (an index lookup by a long value would fail with SQLCODE -490)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const op of ["eq", "ne", "lt", "le", "gt", "ge", "contains", "startsWith"]) {
      const accepted = await postEnvelope(TARGET, ROUTE, routeBody([filter("MSHControlID", op, "x".repeat(256))]));
      expect(accepted.errors, `${op} with 256 characters`).toEqual([]);

      const refused = await postEnvelope(TARGET, ROUTE, routeBody([filter("MSHControlID", op, `${MARKER}${"x".repeat(246)}`)]));
      expect(refused.errors.length, `${op} with 257 characters: ${refused.text}`).toBe(1);
      expect(refused.errors[0], op).toContain("filters[0].value");
      expect(refused.errors[0], op).toContain("256 characters");
      expect(refused.errors[0], op).not.toContain("SQLCODE");
      expect(refused.text).not.toContain(MARKER);
      expect(refused.result).toEqual({});
    }
    // The length is a shape rule: it is checked before the property and the operator (the dictionary), as well as
    // before the namespace switch (the refused-shape rows aim it at a missing namespace).
    const wrongProperty = await postEnvelope(TARGET, ROUTE, routeBody([filter("NoSuch", "eq", "x".repeat(300))]));
    expect(wrongProperty.errors[0]).toContain("filters[0].value");
    const wrongOp = await postEnvelope(TARGET, ROUTE, routeBody([filter("Story394Int", "gt", "x".repeat(300))], { searchTableClass: ST4 }));
    expect(wrongOp.errors[0]).toContain("filters[0].value");
  }, 120000);

  it("the tool refuses a property that does not exist with the IRIS text, never the value", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await tableSearch(interop, { filters: [filter("NoSuch", "eq", MARKER)] });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("filters[0].property");
    expect(firstText(result)).toContain("PatientID");
    expect(JSON.stringify(result)).not.toContain(MARKER);
  }, 120000);

  const REFUSED_CLASSES: Array<[string, string]> = [
    ["the abstract Search Table base", "Ens.VDoc.SearchTable"],
    ["the abstract XML Search Table base", "Ens.VDoc.XMLSearchTable"],
    ["the custom Search Table model, which has no configured properties", "Ens.CustomSearchTable"],
    ["a document class", "EnsLib.HL7.Message"],
    ["a case variant of a class", "enslib.hl7.searchtable"],
    ["a well-formed name that carries the marker", `No.${MARKER}`],
    ["a class that does not exist", "No.Such.Story394Class"],
  ];
  for (const [what, searchTableClass] of REFUSED_CLASSES) {
    it(`route: ${what} (${searchTableClass}) is refused naming searchTableClass`, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      const answer = await postEnvelope(TARGET, ROUTE, routeBody([filter("PatientID", "eq", MARKER)], { searchTableClass }));

      expect(answer.errors.length, answer.text).toBe(1);
      expect(answer.errors[0]).toContain("'searchTableClass'");
      expect(answer.text).not.toContain(MARKER);
      expect(answer.result).toEqual({});
    }, 120000);
  }

  const ok = filter("PatientID", "eq", "x");
  const eleven = Array.from({ length: 11 }, () => ok);
  const SHAPE_CASES: Array<[string, Record<string, unknown>, string]> = [
    ["no searchTableClass", { searchTableClass: undefined }, "searchTableClass"],
    ["a searchTableClass with a quote", { searchTableClass: `EnsLib.HL7.SearchTable' OR '1'='1 ${MARKER}` }, "searchTableClass"],
    ["a searchTableClass of 221 characters", { searchTableClass: `${MARKER}${"x".repeat(210)}` }, "searchTableClass"],
    ["a bodyClass with a quote", { bodyClass: `EnsLib.HL7.Message' OR '1'='1 ${MARKER}` }, "bodyClass"],
    ["no filters", { filters: undefined }, "'filters' is required for the searchTable action"],
    ["no filters on the body action keeps its own action name", { action: "body", bodyClass: "Ens.StringRequest", searchTableClass: undefined, filters: undefined }, "'filters' is required for the body action"],
    ["filters empty", { filters: [] }, "filters"],
    ["11 filters", { filters: eleven }, "filters"],
    ["filters a string", { filters: MARKER }, "filters"],
    ["a filter that is a number", { filters: [5] }, "filters[0]"],
    ["an extra key", { filters: [{ ...ok, [MARKER]: 1 }] }, "filters[0]"],
    ["property missing", { filters: [{ op: "eq", value: MARKER }] }, "filters[0].property"],
    ["property with a space", { filters: [filter(`Pa tient ${MARKER}`, "eq", "x")] }, "filters[0].property"],
    ["property with a double quote", { filters: [filter(`a"b ${MARKER}`, "eq", "x")] }, "filters[0].property"],
    ["property of 129 characters", { filters: [filter(`${MARKER}${"x".repeat(118)}`, "eq", "x")] }, "filters[0].property"],
    ["op missing", { filters: [{ property: "PatientID", value: MARKER }] }, "filters[0].op"],
    ["op EQ", { filters: [filter("PatientID", `EQ ${MARKER}`, "x")] }, "filters[0].op"],
    ["op like", { filters: [filter("PatientID", "like", `${MARKER}%`)] }, "filters[0].op"],
    ["op =", { filters: [filter("PatientID", "=", MARKER)] }, "filters[0].op"],
    ["eq with no value", { filters: [filter("PatientID", "eq")] }, "filters[0].value"],
    ["isNull with a value", { filters: [filter("PatientID", "isNull", MARKER)] }, "filters[0].value"],
    ["a value of the empty string", { filters: [filter("PatientID", "eq", "")] }, "filters[0].value"],
    ["a value of 1025 characters", { filters: [filter("PatientID", "eq", `${MARKER}${"x".repeat(1014)}`)] }, "filters[0].value"],
    ["a value of 257 characters", { filters: [filter("PatientID", "eq", `${MARKER}${"x".repeat(246)}`)] }, "filters[0].value"],
    ["a value of 257 characters in the second filter, with contains", { filters: [ok, filter("PatientID", "contains", `${MARKER}${"x".repeat(246)}`)] }, "filters[1].value"],
    ["a value that is an object", { filters: [{ property: "PatientID", op: "eq", value: { a: MARKER } }] }, "filters[0].value"],
    ["a bad op in the third filter", { filters: [ok, ok, filter("PatientID", `bad ${MARKER}`, "x")] }, "filters[2].op"],
    ["searchTableClass on the headers action", { action: "headers", filters: undefined }, "'searchTableClass' applies only to the searchTable action"],
    ["searchTableClass on the body action", { action: "body", bodyClass: "Ens.StringRequest" }, "'searchTableClass' applies only to the searchTable action"],
    ["filters on the headers action", { action: "headers", searchTableClass: undefined }, "'filters' applies only to the body and searchTable actions"],
    ["an unknown action lists all three", { action: `bogus ${MARKER}` }, "must be one of: headers, body, searchTable"],
    ["a window over 7 days", { from: "2001-02-01T00:00:00Z", to: "2001-02-09T00:00:01Z" }, "exceeds the maximum of 7 days"],
    ["half a cursor", { afterTimeCreated: "2001-02-03 08:00:00" }, "afterId"],
  ];
  const valid = routeBody([ok], { namespace: NS_Z });
  for (const [what, overrides, token] of SHAPE_CASES) {
    it(`route: ${what} is refused naming ${token}, before the namespace is switched`, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      const answer = await postEnvelope(TARGET, ROUTE, Object.fromEntries(Object.entries({ ...valid, ...overrides }).filter(([, value]) => value !== undefined)));

      expect(answer.status).toBe(200);
      expect(answer.errors.length, answer.text).toBeGreaterThanOrEqual(1);
      expect(answer.errors[0]).toContain(token);
      expect(answer.errors[0], "a shape error, not the namespace switch").not.toContain("<NAMESPACE>");
      expect(answer.text).not.toContain(MARKER);
      expect(answer.result).toEqual({});
    }, 120000);
  }

  it("route: the valid shape aimed at the same missing namespace fails at the switch (positive control for the rows above)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const answer = await postEnvelope(TARGET, ROUTE, valid);

    expect(answer.errors.length, answer.text).toBeGreaterThanOrEqual(1);
    expect(answer.errors[0], "the namespace switch error").toContain("<NAMESPACE>");
  }, 120000);
});

// -- The injection fuzz -----------------------------------------------------

/** The header IDs of the messages that hold each stored control ID (m1 is read by headers 1 and 10), by hand from the seed. */
const CONTROL_IDS: ReadonlyArray<{ stored: string; headers: readonly number[] }> = [
  { stored: "Story394-CTL-a", headers: [1, 10] },
  { stored: "Story394-CTL-A", headers: [2] },
  { stored: "Story394-CTL-3", headers: [3] },
  { stored: "Story394-CTL-4", headers: [4] },
  { stored: "Story394-CTL-5", headers: [5] },
];

/** Each message's stored PatientID entries (lower-cased) and the headers that read it, by hand from the seed. */
const PATIENT_ENTRIES: ReadonlyArray<{ stored: readonly string[]; headers: readonly number[] }> = [
  { stored: ["synthphi394-alt-1", "synthphi394-mrn-1"], headers: [1, 10] },
  { stored: ["synthphi394-mrn-2", "synthphi394-mrn-1"], headers: [2] },
  { stored: ["synthphi394-mrn-3"], headers: [3] },
  { stored: ["synthphi394-mrn-4"], headers: [4] },
  { stored: ["synthphi394-mrn-5"], headers: [5] },
];

/** The headers whose Search Table property is not null: the expected result of `notNull` for each of ST4's seven properties. */
const NOT_NULL_HEADERS: Record<string, readonly number[]> = {
  MSHControlID: [1, 2, 3, 4, 5, 10],
  MSHTypeName: [1, 2, 3, 4, 5, 10],
  PatientAcct: [],
  PatientID: [1, 2, 3, 4, 5, 10],
  PatientName: [1, 2, 10],
  Story394Empty: [2],
  Story394Int: [1, 2, 3, 10],
};

const sorted = (values: Iterable<number>): number[] => [...new Set(values)].sort((a, b) => a - b);

/** The headers of the messages that have an entry satisfying `test`, for the entries of `PATIENT_ENTRIES`. */
const patientHeaders = (test: (entry: string) => boolean): number[] =>
  sorted(PATIENT_ENTRIES.filter((message) => message.stored.some(test)).flatMap((message) => message.headers));

/** The control-ID operators by EXACT comparison, mapped to the headers: the TypeScript oracle (a `|` is stored as `+`). */
function controlHeaders(op: string, value: string): number[] {
  const needle = value.replaceAll("|", "+");
  const test: Record<string, (stored: string) => boolean> = {
    eq: (stored) => stored === needle,
    contains: (stored) => stored.includes(needle),
    startsWith: (stored) => stored.startsWith(needle),
  };
  if (op === "ne") {
    const equal = new Set(CONTROL_IDS.filter((message) => message.stored === needle).flatMap((message) => message.headers));
    return HL7_HEADERS.filter((header) => !equal.has(header));
  }
  return sorted(CONTROL_IDS.filter((message) => (test[op] as (stored: string) => boolean)(message.stored)).flatMap((message) => message.headers));
}

describe.skipIf(CAPTURE)("Story 39.4: the injection fuzz drives the REST route directly (AC-3, Rule #59, AD-26)", () => {
  it("the configured properties are the ones the fuzz expects (the oracle's own read of Ens_Config.SearchTableProp)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const rows = await atelierQuery(
      { ...TARGET, namespace: NS_A },
      `SELECT Name FROM Ens_Config.SearchTableProp WHERE ClassExtent = '${CLASS_EXTENT}' ORDER BY Name`,
    );
    expect(rows.map((row) => String(row["Name"]))).toEqual(Object.keys(NOT_NULL_HEADERS).sort());
  }, 120000);

  it("the positive control: a statement that calls the side-effect function does increment ^Story393Side", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await resetSide(dev, NS_A);
    expect(await sideCount(dev, NS_A)).toBe(0);
    await atelierQuery({ ...TARGET, namespace: NS_A }, "SELECT Story393.Side_Bump() AS n");
    expect(await sideCount(dev, NS_A), "the probe can vary").toBe(1);
    await resetSide(dev, NS_A);
    expect(await sideDefined(dev, NS_A), "reset leaves the global undefined").toBe(0);
  }, 120000);

  it("a seeded corpus over the property, op and value slots: 0 violations", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    await resetSide(dev, NS_A);
    const random = mulberry32(394);
    const violations: string[] = [];
    let requests = 0;
    const started = performance.now();

    /** Send one filter on `searchTableClass` and check the invariants every request must keep. */
    async function probe(slot: string, filterValue: Record<string, unknown>, expectedHeaders: readonly number[] | undefined, token: string, searchTableClass: string): Promise<void> {
      requests += 1;
      const answer = await postEnvelope(TARGET, ROUTE, routeBody([filterValue], { searchTableClass }));
      const label = `${slot} ${JSON.stringify(filterValue).slice(0, 120)}`;
      if (answer.text.toLowerCase().includes(MARKER.toLowerCase())) violations.push(`${label}: the response echoes the marker`);
      if (answer.status !== 200) violations.push(`${label}: HTTP ${answer.status}`);
      if (expectedHeaders === undefined) {
        if (answer.errors.length === 0) violations.push(`${label}: accepted, but it is not a valid input`);
        else if (!answer.errors[0]?.includes(token)) violations.push(`${label}: refused without naming ${token}: ${answer.errors[0]?.slice(0, 160)}`);
        return;
      }
      if (answer.errors.length > 0) {
        violations.push(`${label}: refused, but it is valid: ${answer.errors[0]?.slice(0, 160)}`);
        return;
      }
      const got = (answer.result.rows as Array<{ id: number }>).map((row) => row.id);
      if (JSON.stringify(got) !== JSON.stringify(expectedHeaders)) violations.push(`${label}: rows ${JSON.stringify(got)}, expected ${JSON.stringify(expectedHeaders)}`);
    }

    // Property slot: a fixed corpus and 200 random names, with notNull on ST4.
    const propertyCorpus = [
      ...Object.keys(NOT_NULL_HEADERS),
      "patientid", "PATIENTID", "PropValue", "PropId", "DocId", "ID", "Name", "%ID", "Story394", "OnlyInB", "AOnlyInB",
      MARKER, 'PatientID" = 1 OR Story393.Side_Bump() = 1 OR "PatientID', `PatientID' OR Story393.Side_Bump() = 1 --${MARKER}`,
    ];
    const randomProperties = Array.from({ length: 200 }, () => fuzzText(random, MARKER));
    for (const property of [...propertyCorpus, ...randomProperties]) {
      const known = Object.prototype.hasOwnProperty.call(NOT_NULL_HEADERS, property);
      await probe("property", filter(property, "notNull"), known ? NOT_NULL_HEADERS[property] : undefined, "filters[0].property", ST4);
    }

    // Op slot: a fixed corpus and 100 random strings that are not operators, on ST's PatientID.
    const opCorpus = ["EQ", "Eq", "=", "like", "in", "between", "[", "%STARTSWITH", "eq OR Story393.Side_Bump()=1", `eq ${MARKER}`, "", " eq", "eq "];
    const randomOps = Array.from({ length: 100 }, () => fuzzText(random, MARKER));
    for (const op of [...opCorpus, ...randomOps]) await probe("op", filter("PatientID", op, "x"), undefined, "filters[0].op", ST);

    // Value slot 1: 300 random strings on ST's MSHControlID (compared exactly) with eq, ne, contains and startsWith.
    const stored = CONTROL_IDS.map((message) => message.stored);
    const valueCorpus = [
      "' OR '1'='1", "\" OR \"1\"=\"1", "'; SELECT Story393.Side_Bump() --", "x' OR Story393.Side_Bump() = 1 OR 'x", "Story393.Side_Bump()",
      "%", "_", "\\", "[", "]", "?", "\n", "\t", "\r\n", "x", " ", "|", "a|b", " Story394-CTL-a", "Story394-CTL-a ", "story394-ctl-a",
      String.fromCodePoint(0xe9), String.fromCodePoint(0x4e2d), "OR 1=1", "UNION SELECT 1", "x".repeat(1024),
      ...stored, ...stored.map((value) => value.slice(1)), ...stored.map((value) => value.slice(0, -1)),
    ];
    const randomValues = Array.from({ length: 300 }, () => {
      const pick = random();
      const source = stored[Math.floor(random() * stored.length)] as string;
      if (pick < 0.25) return source;
      if (pick < 0.5) {
        const from = Math.floor(random() * source.length);
        return source.slice(from, from + 1 + Math.floor(random() * (source.length - from)));
      }
      if (pick < 0.65) return `${source}${fuzzText(random)}`;
      return fuzzText(random, random() < 0.5 ? MARKER : undefined);
    });
    const valueOps = ["eq", "ne", "contains", "startsWith"];
    let index = 0;
    for (const value of [...valueCorpus, ...randomValues]) {
      const op = valueOps[index % valueOps.length] as string;
      index += 1;
      // A Search Table stores at most 256 characters of a value, so a longer one is refused naming the value.
      const tooLong = value.length > 256;
      await probe("value", filter("MSHControlID", op, value), tooLong ? undefined : controlHeaders(op, value), "filters[0].value", ST);
    }

    // Value slot 2: 100 random strings on ST's PatientID with contains, against the stored lower-cased identifiers.
    const patientSources = PATIENT_ENTRIES.flatMap((message) => message.stored);
    for (let count = 0; count < 100; count += 1) {
      const pick = random();
      const source = patientSources[Math.floor(random() * patientSources.length)] as string;
      const value =
        pick < 0.3
          ? source
          : pick < 0.6
            ? source.slice(Math.floor(random() * source.length))
            : pick < 0.8
              ? `${source}${fuzzText(random)}`
              : fuzzText(random, random() < 0.5 ? MARKER : undefined);
      const needle = value.toLowerCase().replaceAll("|", "+");
      await probe("value", filter("PatientID", "contains", value), patientHeaders((entry) => entry.includes(needle)), "filters[0].value", ST);
    }

    // eslint-disable-next-line no-console
    console.log(`[PERF] story-39-4 fuzz: ${requests} requests in ${Math.round(performance.now() - started)} ms`);
    expect(violations.slice(0, 5), `${violations.length} violation(s); the first five`).toEqual([]);
    expect(violations).toEqual([]);
    expect(requests, "the corpus ran in full").toBeGreaterThanOrEqual(740);
    expect(await sideCount(dev, NS_A), "no statement of the fuzz called the side-effect function").toBe(0);
    expect(await sideDefined(dev, NS_A), "^Story393Side is still undefined").toBe(0);
  }, 600000);
});

// -- A second namespace, a namespace that is not configured, a namespace that is missing -----------

describe.skipIf(CAPTURE)("Story 39.4: second namespace, not configured, unknown namespace (AC-4; Rules #34, #41)", () => {
  it("PropIds differ between the namespaces, and each namespace equals its own oracle for the same request", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const propId = async (namespace: string): Promise<number> => {
      const rows = await atelierQuery(
        { ...TARGET, namespace },
        `SELECT PropId FROM Ens_Config.SearchTableProp WHERE ClassExtent = '${CLASS_EXTENT}' AND Name = 'PatientID'`,
      );
      return Number(rows[0]?.["PropId"]);
    };
    const inA = await propId(NS_A);
    const inB = await propId(NS_B);
    expect([inA, inB], "the positive control: B's PatientID PropId is not A's").toEqual([4, 5]);

    const lookup = { filters: [filter("PatientID", "eq", "SYNTHPHI394-MRN-1")] };
    const inAResult = succeeded(await tableSearch(interop, { namespace: NS_A, ...lookup }));
    const inBResult = succeeded(await tableSearch(interop, { namespace: NS_B, ...lookup }));
    expect(inAResult.rows).toEqual(await oracle(NS_A, "PatientID", "s.PropValue = 'synthphi394-mrn-1'"));
    expect(inBResult.rows).toEqual(await oracle(NS_B, "PatientID", "s.PropValue = 'synthphi394-mrn-1'"));
    expect(headerIds(inAResult.rows)).toEqual([1, 2, 10]);
    expect(headerIds(inBResult.rows)).toEqual([1]);
    expect(inAResult.rows).not.toEqual(inBResult.rows);
  }, 120000);

  it("each namespace's own subclass: AOnlyInB in B, Story394Int in A, and the other's class is refused", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const onlyInB = succeeded(await tableSearch(interop, { namespace: NS_B, searchTableClass: ST_B, filters: [filter("AOnlyInB", "notNull")] }));
    expect(onlyInB.rows).toEqual(await oracle(NS_B, "AOnlyInB", "s.PropValue <> ''"));
    expect(headerIds(onlyInB.rows)).toEqual([1]);

    const intInA = succeeded(await tableSearch(interop, { namespace: NS_A, searchTableClass: ST4, filters: [filter("Story394Int", "notNull")] }));
    expect(intInA.rows).toEqual(await oracle(NS_A, "Story394Int", "s.PropValue <> ''"));
    expect(headerIds(intInA.rows)).toEqual([1, 2, 3, 10]);

    for (const [namespace, searchTableClass, filters] of [
      [NS_A, ST_B, [filter("AOnlyInB", "notNull")]],
      [NS_B, ST4, [filter("Story394Int", "notNull")]],
    ] as const) {
      const refused = await tableSearch(interop, { namespace, searchTableClass, filters });
      expect(refused.isError, `${searchTableClass} in ${namespace}`).toBe(true);
      expect(firstText(refused)).toContain("searchTableClass");
    }
    // The stock class does not know the subclass's property in B either.
    const stockInB = await tableSearch(interop, { namespace: NS_B, filters: [filter("AOnlyInB", "notNull")] });
    expect(stockInB.isError).toBe(true);
    expect(firstText(stockInB)).toContain("filters[0].property");
  }, 120000);

  it("a namespace with the Interoperability mappings and no Search Table is notApplicable with the policy, whatever the class; configuration is checked before the class", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const searchTableClass of [ST, "No.Such.Story394Class"]) {
      const result = await tableSearch(interop, { namespace: NS_C, searchTableClass, filters: [filter("PatientID", "eq", "x")] });

      expect(result.isError, firstText(result)).toBeFalsy();
      expect(result.structuredContent, searchTableClass).toMatchObject({
        action: "searchTable",
        notApplicable: true,
        rows: [],
        hasMore: false,
        dataPolicy: { policy: "redact", redacted: 0, blocked: 0 },
      });
      const reason = String((result.structuredContent as { reason?: unknown }).reason);
      expect(reason).toContain(`No Search Table is configured in namespace '${NS_C}'`);
      expect(reason).toContain("Ens.Config.SearchTableProp is empty");

      const viaRoute = await postEnvelope(TARGET, ROUTE, routeBody([filter("PatientID", "eq", "x")], { namespace: NS_C, searchTableClass }));
      expect(viaRoute.errors, searchTableClass).toEqual([]);
      expect(viaRoute.result).toMatchObject({ action: "searchTable", interopEnabled: true, searchTablesConfigured: false, rows: [], hasMore: false });
    }
  }, 120000);

  it("a namespace that does not exist, with a valid shape, is an error carrying the sanitized switch text", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await tableSearch(interop, { namespace: NS_Z, filters: [filter("PatientID", "eq", "x")] });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code?: unknown } | undefined)?.code).toBeUndefined();
    expect(firstText(result), "the namespace switch error").toContain("<NAMESPACE>");
    expect(firstText(result)).not.toContain("^");
  }, 120000);
});

// -- The data policy ------------------------------------------------------------

describe.skipIf(CAPTURE)("Story 39.4: the data policy decides before any IRIS call (AC-2; AD-26, AD-9)", () => {
  const SEARCH = { filters: [filter("PatientID", "eq", "SYNTHPHI394-MRN-1")] };
  const BLOCKED = { code: "DATA_POLICY_BLOCKED", action: "searchTable", policy: "block" };

  it("under IRIS_DATA_POLICY=block searchTable is refused, and no IRIS call is made (the same call at a missing namespace is refused, not a namespace error)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const blocked = await interopSession({ IRIS_DATA_POLICY: "block" });

    for (const namespace of [NS_A, NS_Z]) {
      const refused = await tableSearch(blocked, { ...SEARCH, namespace });
      expect(refused.isError, namespace).toBe(true);
      expect(refused.structuredContent, namespace).toEqual(BLOCKED);
    }

    const headers = await blocked.call("iris_message_search", { action: "headers", namespace: NS_A, from: FROM, to: TO });
    expect(headers.isError, "headers is not under the policy").toBeFalsy();
    expect(headerIds((headers.structuredContent as Structured).rows)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  }, 120000);

  it("a profile with dataPolicy block is refused while the default profile of the same server runs searchTable", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const session = await interopSession({ IRIS_PROFILES: JSON.stringify({ tight: { dataPolicy: "block" } }) });

    for (const namespace of [NS_A, NS_Z]) {
      const refused = await session.callOn("tight", "iris_message_search", {
        action: "searchTable",
        namespace,
        from: FROM,
        to: TO,
        searchTableClass: ST,
        ...SEARCH,
      });
      expect(refused.structuredContent, namespace).toEqual(BLOCKED);
    }
    const ran = succeeded(await tableSearch(session, SEARCH));
    expect(headerIds(ran.rows)).toEqual([1, 2, 10]);
    expect(ran.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
  }, 120000);

  it("redact and allow return the same rows, each naming its policy in dataPolicy and in one trailing line", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const allow = await interopSession({ IRIS_DATA_POLICY: "allow" });
    const expected = await oracle(NS_A, "PatientID", "s.PropValue = 'synthphi394-mrn-1'");
    expect(headerIds(expected), "the oracle selects the rows written by hand").toEqual([1, 2, 10]);

    for (const [policy, session] of [["redact", interop], ["allow", allow]] as const) {
      const result = await tableSearch(session, SEARCH);
      const content = succeeded(result);
      expect(content.rows, policy).toEqual(expected);
      expect(content.dataPolicy, policy).toEqual({ policy, redacted: 0, blocked: 0 });
      const lines = firstText(result).split("\n");
      expect(lines.at(-1), policy).toBe(
        `Data policy ${policy}: header rows only; the searchTable action returns no Search Table or body values.`,
      );
      expect(lines.filter((line) => line.startsWith("Data policy")), `one policy line (${policy})`).toHaveLength(1);
    }
  }, 120000);
});

// -- The audit trail ------------------------------------------------------------

describe.skipIf(CAPTURE)("Story 39.4: the audit trail redacts the filters and records the policy (AC-2, AC-5; AD-19)", () => {
  it("records dataPolicy for redact, block and allow; logs filters as [REDACTED] under redact and block and as given under allow", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const search = { filters: [filter("PatientID", "eq", `${MARKER}-MRN-1`)] };
    const rows: Array<{ policy: string; env: Record<string, string>; outcome: string; redacted: boolean }> = [
      { policy: "redact", env: {}, outcome: "ok", redacted: true },
      { policy: "block", env: { IRIS_DATA_POLICY: "block" }, outcome: "error", redacted: true },
      { policy: "allow", env: { IRIS_DATA_POLICY: "allow" }, outcome: "ok", redacted: false },
    ];
    for (const row of rows) {
      const file = path.join(tempDir, `audit-${row.policy}.jsonl`);
      let stderr = "";
      const session = await interopSession(
        { IRIS_AUDIT_LOG: file, IRIS_AUDIT_LOG_PARAMS: "true", LOG_LEVEL: "DEBUG", ...row.env },
        (chunk) => {
          stderr += chunk;
        },
      );
      const result = await tableSearch(session, search);
      const invalid = await tableSearch(session, { filters: [filter("PatientID", MARKER, MARKER)] });
      // The MCP SDK rejects the invalid op before the call reaches the audited chokepoint, so only the first call has an entry.
      expect(invalid.isError, "a Zod-invalid op").toBe(true);
      expect(firstText(invalid), "the invalid call names the path").toContain("op");

      const entries = await pollAuditEntries(file, { tool: "iris_message_search", count: 1, intervalMs: 50, timeoutMs: 10000, excerpt: 3000 });
      const [entry] = entries as [Record<string, unknown>];
      expect(entry, row.policy).toMatchObject({
        action: "searchTable",
        outcome: row.outcome,
        dataPolicy: { policy: row.policy, redacted: 0, blocked: 0 },
      });
      const params = entry["params"] as Record<string, unknown>;
      if (row.redacted) {
        expect(params["filters"], `${row.policy}: the filters`).toBe("[REDACTED]");
        const raw = readFileSync(file, "utf8");
        expect(raw, `${row.policy}: the audit file`).not.toContain(MARKER);
        expect(stderr.length, `${row.policy}: the server logged at DEBUG`).toBeGreaterThan(0);
        expect(stderr, `${row.policy}: the server's stderr`).not.toContain(MARKER);
        expect(JSON.stringify(result), `${row.policy}: the response`).not.toContain(MARKER);
        expect(JSON.stringify(invalid), `${row.policy}: the invalid call's response`).not.toContain(MARKER);
      } else {
        expect(params["filters"], "allow: the filters are logged (the positive control)").toEqual(search.filters);
        expect(readFileSync(file, "utf8")).toContain(MARKER);
      }
    }
  }, 180000);
});

// -- The plan -------------------------------------------------------------------

/**
 * What is wrong with a Search Table lookup statement as the statement index stores it and with its plan: the
 * select list is exactly the header columns and the header table is read first through `%INORDER` with no
 * other table in the FROM list, every `EXISTS` subquery reads the Search Table's `indexDocId` map by the
 * given document ID and PropId, and the plan reads the header maps before the Search Table and never scans
 * the Search Table by property. The plan lines are the wording of IRIS 2026.2 (Build 221U); another build that
 * words them differently is a re-capture of these patterns, not a regression.
 */
function planProblems(statement: string, plan: string): string[] {
  const problems: string[] = [];
  const text = squash(statement);
  if (!text.includes(squash(`SELECT TOP ? ${HEADER_COLUMNS} FROM %INORDER ${HEADER_INDEX_HINT} Ens.MessageHeader h WHERE`))) {
    problems.push("the statement is not exactly the header columns read first from the header table through %INORDER, with no other table");
  }
  const selectList = text.split("FROM%INORDER")[0] ?? "";
  if (/S\d+\./.test(selectList) || selectList.includes("PROPVALUE")) problems.push("the select list names the Search Table");
  const lines = plan.split(/\r?\n/).map((line) => line.trim());
  const header = lines.findIndex((line) => /Ens\.MessageHeader\(H\)/.test(line));
  const table = lines.findIndex((line) => /SearchTable\(S\d+\)/.test(line));
  if (header < 0) problems.push("the plan does not read the header maps");
  if (table < 0) problems.push("the plan does not read the Search Table");
  if (header >= 0 && table >= 0 && header > table) problems.push("the plan reads the Search Table before the headers");
  const probes = lines.filter((line) => /^Read index map EnsLib_HL7\.SearchTable\(S(\d+)\)\.indexDocId, using the given S\1\.DocId(?:, | and )S\1\.PropId/.test(line));
  const subqueries = text.split("EXISTS(SELECT").length - 1;
  if (probes.length !== subqueries) problems.push(`${subqueries} subquery(ies) but ${probes.length} read(s) of indexDocId by the given DocId and PropId`);
  if (lines.some((line) => /^Read (?:master|index) map EnsLib_HL7\.SearchTable\(S\d+\)\.(?!indexDocId)/.test(line))) {
    problems.push("the plan reads the Search Table by a map other than indexDocId");
  }
  return problems;
}

describe.skipIf(CAPTURE)("Story 39.4: the statements the route prepared read the headers first and the Search Table by each header's body ID (Rules #19, #59)", () => {
  const GOOD_STATEMENT = `SELECT TOP ? ${HEADER_COLUMNS} FROM %INORDER ${HEADER_INDEX_HINT} Ens.MessageHeader h WHERE h.TimeCreated >= ? AND EXISTS (SELECT 1 FROM "EnsLib_HL7"."SearchTable" s0 WHERE s0.DocId = h.MessageBodyId AND s0.PropId = ?)`;
  const GOOD_PLAN = [
    "Read master map Ens.MessageHeader(H).IDKEY, using the given idkey value.",
    "Read index map EnsLib_HL7.SearchTable(S0).indexDocId, using the given S0.DocId, S0.PropId, and S0.PropValue.",
  ].join("\n");

  it("the checker can fail: a joined Search Table, a Search Table column, a scan by property, or the wrong order is reported", (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    expect(planProblems(GOOD_STATEMENT, GOOD_PLAN), "a well-formed statement and plan").toEqual([]);
    const ranged = "Read index map EnsLib_HL7.SearchTable(S0).indexDocId, using the given S0.DocId and S0.PropId, and looping on S0.PropValue (with a <> condition).";
    expect(planProblems(GOOD_STATEMENT, `Read master map Ens.MessageHeader(H).IDKEY, using the given idkey value.\n${ranged}`), "the range form").toEqual([]);

    expect(planProblems(GOOD_STATEMENT.replace("h.ID,", "h.ID, s0.PropValue,"), GOOD_PLAN).length, "a Search Table column in the select list").toBeGreaterThan(0);
    expect(planProblems(GOOD_STATEMENT.replace("%INORDER", ""), GOOD_PLAN).length, "no %INORDER").toBeGreaterThan(0);
    expect(planProblems(GOOD_STATEMENT.replace("Ens.MessageHeader h WHERE", 'Ens.MessageHeader h, "EnsLib_HL7"."SearchTable" s9 WHERE'), GOOD_PLAN).length, "a joined Search Table").toBeGreaterThan(0);
    expect(planProblems(GOOD_STATEMENT.replace(HEADER_INDEX_HINT, ""), GOOD_PLAN).length, "no index hint").toBeGreaterThan(0);
    expect(planProblems(GOOD_STATEMENT, [...GOOD_PLAN.split("\n")].reverse().join("\n")).length, "the Search Table read before the headers").toBeGreaterThan(0);
    expect(planProblems(GOOD_STATEMENT, `${GOOD_PLAN}\nRead master map EnsLib_HL7.SearchTable(S0).indexValue, using the given S0.PropId, and looping on S0.PropValue.`).length, "a scan of the property").toBeGreaterThan(0);
    expect(planProblems(GOOD_STATEMENT, "Read master map Ens.MessageHeader(H).IDKEY, using the given idkey value.").length, "no read of the Search Table by DocId").toBeGreaterThan(0);
    expect(planProblems(GOOD_STATEMENT, GOOD_PLAN.replace("S0.PropId, and S0.PropValue", "S0.PropValue")).length, "a read that is not by the PropId").toBeGreaterThan(0);
  });

  it("after real calls, every route statement for the Search Table has the header-first plan, and each call's own statement is among them", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const calls: Array<{ name: string; filters: Array<Record<string, unknown>>; searchTableClass: string; extra?: Record<string, unknown>; fragment: string }> = [
      { name: "text eq", filters: [filter("PatientID", "eq", "x")], searchTableClass: ST, fragment: "AND s0.PropValue <> ? AND s0.PropValue = ?)" },
      { name: "contains", filters: [filter("PatientName", "contains", "x")], searchTableClass: ST, fragment: "AND s0.PropValue [ ?)" },
      { name: "case-sensitive startsWith", filters: [filter("MSHControlID", "startsWith", "x")], searchTableClass: ST, fragment: "%EXACT(s0.PropValue) %STARTSWITH ?)" },
      { name: "ne", filters: [filter("PatientID", "ne", "x")], searchTableClass: ST, fragment: "NOT EXISTS (SELECT ? FROM \"EnsLib_HL7\".\"SearchTable\" s0 WHERE s0.DocId = h.MessageBodyId AND s0.PropId = ? AND s0.PropValue = ?)" },
      { name: "isNull", filters: [filter("Story394Empty", "isNull")], searchTableClass: ST4, fragment: "NOT EXISTS (SELECT ? FROM \"EnsLib_HL7\".\"SearchTable\" s0 WHERE s0.DocId = h.MessageBodyId AND s0.PropId = ? AND s0.PropValue <> ?)" },
      { name: "three filters", filters: [filter("PatientID", "eq", "x"), filter("MSHTypeName", "ne", "x"), filter("Story394Int", "notNull")], searchTableClass: ST4, fragment: "AND s2.PropId = ? AND s2.PropValue <> ?)" },
      { name: "a page after a cursor", filters: [filter("PatientID", "notNull")], searchTableClass: ST, extra: { afterTimeCreated: "2001-02-03 08:00:00", afterId: 1 }, fragment: "(h.TimeCreated > ? OR (h.TimeCreated = ? AND h.ID > ?))" },
    ];
    for (const call of calls) {
      const answer = await postEnvelope(TARGET, ROUTE, routeBody(call.filters, { searchTableClass: call.searchTableClass, ...(call.extra ?? {}) }));
      expect(answer.errors, `${call.name}: ${answer.text}`).toEqual([]);
    }

    const stored = await atelierQuery(
      { ...TARGET, namespace: NS_A },
      "SELECT Statement, Plan FROM INFORMATION_SCHEMA.STATEMENTS WHERE Statement [ 'SEARCHTABLE'",
    );
    // The route's statements, told from the oracle's own queries by their select list: TOP ?, then the header columns.
    const routeStatements = stored.filter((row) => squash(String(row["Statement"])).includes("SELECTTOP?H.ID,"));
    expect(routeStatements.length, "the index holds a statement for each distinct call").toBeGreaterThanOrEqual(calls.length);

    for (const row of routeStatements) {
      expect(planProblems(String(row["Statement"]), String(row["Plan"])), String(row["Statement"])).toEqual([]);
      expect(headerPlanProblems(String(row["Statement"]), String(row["Plan"])), `the window plan of ${String(row["Statement"])}`).toEqual([]);
    }
    for (const call of calls) {
      const mine = routeStatements.filter((row) => squash(String(row["Statement"])).includes(squash(call.fragment)));
      expect(mine.length, `${call.name}: the index holds the statement of this call (${call.fragment})`).toBeGreaterThanOrEqual(1);
    }
  }, 120000);
});
