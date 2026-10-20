/**
 * Story 39.3 live gate: `iris_message_search` `body`, driven on the REAL wire against disposable
 * Interoperability namespaces, in the default suite (rule #59: each row names the path it guards).
 *
 * Paths: the BUILT iris-interop-mcp dist, spawned as a child process and driven by the MCP SDK `Client`
 * over stdio, for every tool row; raw HTTP `POST`s to `/api/executemcp/v2/interop/message/search` for the
 * route rows and the injection fuzz (past every MCP-layer check, so they exercise the handler's own
 * validation). The oracle is SQL written by hand, joining `Ens.MessageHeader` to the body table, run
 * through the raw Atelier `action/query` route against the same namespace, never the code under test.
 *
 * Fixtures (`interop-namespace-fixture.ts`): A (`EXECMCPTMP393A`) holds fixture sigma, twelve headers over
 * `Story393.Body`, `Story393.Other`, a literal and an HL7 body; B has a different `Story393.Body`; C has
 * no mappings, so `Ens.MessageHeader` does not exist there. Every body value that must never appear in a
 * result contains `SYNTHPHI393`, and all times are on 2001-02-03 UTC. `beforeAll` removes leftovers by
 * name and asserts there are none; `afterAll` removes the three namespaces, their database files and the
 * fixture class and asserts nothing is left.
 *
 * Rows:
 *  1. `capture` (armed only by `STORY_39_3_CAPTURE=1`): replay the `headers` request list against A and C
 *     and write `fixtures/story-39-3-search-baseline.json`. Run once, on the classes deployed BEFORE the
 *     body action existed.
 *  2. Byte identity: replay every captured request against the current classes; each raw response text
 *     equals its capture, and the capture predates the `BOOTSTRAP_VERSION` the gate runs on.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the three `EXECMCPTMP393*` namespaces and databases, and the HSCUSTOM
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
  STORY393_EXACT_VALUES,
  createInteropNamespace,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
  resetSide,
  seedBodySearch,
  sideCount,
  sideDefined,
} from "./interop-namespace-fixture.js";
import { bodyJoinOracle, sqlLiteral } from "./header-row-oracle.js";
import { fuzzText as sharedFuzzText } from "./fuzz-corpus.js";
import { mulberry32 } from "../../../shared/src/__tests__/test-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const BASELINE_PATH = path.join(__dirname, "fixtures", "story-39-3-search-baseline.json");

const GATE_TAG = "story-39-3-body-search-live-gate";

const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";
const CAPTURE = process.env.STORY_39_3_CAPTURE === "1";

/** The namespaces: A (fixture sigma), B (a different body class), C (not configured). */
const NS_A = "EXECMCPTMP393A";
const NS_B = "EXECMCPTMP393B";
const NS_C = "EXECMCPTMP393C";
const NAMESPACES = [NS_A, NS_B, NS_C];

/** The `BOOTSTRAP_VERSION` the baseline must have been captured on: the one before this story. */
const PRE_STORY_BOOTSTRAP_VERSION = "d440a659ba1e";

/** The window W: every header of fixture sigma except header 12. */
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
    clientName: "story-39-3-live-gate",
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

// -- The headers request list ------------------------------------------

interface HeadersCase {
  name: string;
  body: Record<string, unknown>;
}

/** A `headers` request against `namespace` with an explicit window. */
const headersRequest = (name: string, namespace: string, extra: Record<string, unknown> = {}): HeadersCase => ({
  name,
  body: { action: "headers", namespace, from: FROM, to: TO, ...extra },
});

/**
 * Every `headers` request the capture replays: against A, the window alone and with each header filter,
 * two pages of two, and five refusals; against C, the window alone.
 */
const HEADERS_CASES: HeadersCase[] = [
  headersRequest("A: window alone", NS_A),
  headersRequest("A: source", NS_A, { source: "Story393.Source" }),
  headersRequest("A: target", NS_A, { target: "Story393.Other" }),
  headersRequest("A: bodyClass", NS_A, { bodyClass: "Story393.Body" }),
  headersRequest("A: errorOnly", NS_A, { errorOnly: true }),
  headersRequest("A: status Errored", NS_A, { status: "Errored" }),
  headersRequest("A: limit 2, page 1", NS_A, { limit: 2 }),
  headersRequest("A: limit 2, page 2", NS_A, { limit: 2, afterTimeCreated: "2001-02-03 08:00:01", afterId: 2 }),
  { name: "A: no from", body: { action: "headers", namespace: NS_A, to: TO } },
  headersRequest("A: window over 7 days", NS_A, { from: "2001-01-27T00:00:00Z", to: "2001-02-03T00:00:01Z" }),
  headersRequest("A: limit 0", NS_A, { limit: 0 }),
  headersRequest("A: unknown status", NS_A, { status: "Bogus" }),
  headersRequest("A: sessionId not an integer", NS_A, { sessionId: "x1" }),
  headersRequest("C: window alone", NS_C),
];

interface BaselineCase extends HeadersCase {
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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.3 live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  tempDir = mkdtempSync(path.join(tmpdir(), "story-39-3-gate-"));
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
  await seedBodySearch(dev, NS_A, "a");
  await createInteropNamespace(admin, dev, NS_B, { interop: true });
  await seedBodySearch(dev, NS_B, "b");
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
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story391", "Story393"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [...opened, interop, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- Byte identity of the headers wire --------------------------------------

describe("Story 39.3: the headers wire is unchanged (AD-15, AD-33)", () => {
  it.runIf(CAPTURE)("capture: replay the headers request list against A and C and write the baseline", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const deployed = await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
    expect(deployed, "the capture runs on the classes deployed before the body action").toBe(PRE_STORY_BOOTSTRAP_VERSION);

    const info = await dev.call("iris_server_info", { namespace: TARGET.namespace });
    const irisVersion = String(
      (info.structuredContent as { content?: { version?: unknown } } | undefined)?.content?.version ?? "",
    );
    expect(irisVersion, "the IRIS version string").not.toBe("");

    const cases: BaselineCase[] = [];
    for (const requestCase of HEADERS_CASES) {
      const answer = await sendSearch(requestCase.body);
      cases.push({ ...requestCase, status: answer.status, text: answer.text });
    }
    const baseline: Baseline = {
      capturedWithBootstrapVersion: deployed,
      irisVersion,
      capturedAt: new Date().toISOString(),
      command:
        "STORY_39_3_CAPTURE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-3-body-search-live-gate.test.ts -t capture",
      cases,
    };
    mkdirSync(path.dirname(BASELINE_PATH), { recursive: true });
    writeFileSync(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`);
  }, 240000);

  it.skipIf(CAPTURE)("every headers request answers byte for byte as it did on the pre-story classes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8")) as Baseline;

    expect(baseline.capturedWithBootstrapVersion, "the capture was taken on the classes before this story").toBe(
      PRE_STORY_BOOTSTRAP_VERSION,
    );
    expect(baseline.capturedWithBootstrapVersion, "the gate runs on a different build than the capture").not.toBe(
      await shippedBootstrapVersion(REPO_ROOT),
    );
    expect(baseline.cases.map((c) => c.name), "the capture holds every request in the list").toEqual(
      HEADERS_CASES.map((c) => c.name),
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

/** Every body value that must never appear in a result contains this marker. */
const MARKER = "SYNTHPHI393";
/** A namespace that does not exist: a call that reaches the namespace switch fails there. */
const NS_Z = "EXECMCPTMP393Z";
const BODY_TABLE = '"Story393"."Body"';
const BODY_CLASS = "Story393.Body";

/** The window W as the SQL the oracle uses: the stored form, both ends inclusive. */
const WINDOW_SQL = "h.TimeCreated >= '2001-02-03 07:00:00' AND h.TimeCreated <= '2001-02-03 09:00:00'";

/** The hand-written JOIN oracle (Rule #36) over window W: `bodyJoinOracle` of `header-row-oracle.ts`. */
const joinOracle = (
  namespace: string,
  table: string,
  bodyClass: string,
  predicate: string,
  extra = "",
): Promise<Array<Record<string, unknown>>> => bodyJoinOracle(TARGET, namespace, table, bodyClass, WINDOW_SQL, predicate, extra);

type Structured = Record<string, unknown> & {
  action: string;
  rows: Array<Record<string, unknown>>;
  hasMore: boolean;
  nextCursor?: string;
  dataPolicy?: unknown;
};

/** The structured content of a successful body result, which must hold no body value. */
function succeeded(result: WireToolResult): Structured {
  expect(result.isError, firstText(result)).toBeFalsy();
  expect(JSON.stringify(result), "a body result holds no body value").not.toContain(MARKER);
  return result.structuredContent as Structured;
}

/** A body search of A over window W through `session`; `args` overrides any field. */
function bodySearch(session: WireSession, args: Record<string, unknown> = {}): Promise<WireToolResult> {
  return session.call("iris_message_search", {
    action: "body",
    namespace: NS_A,
    from: FROM,
    to: TO,
    bodyClass: BODY_CLASS,
    ...args,
  });
}

/** One filter. */
const filter = (property: string, op: string, value?: string | number | boolean): Record<string, unknown> =>
  value === undefined ? { property, op } : { property, op, value };

/** A body search of A over window W straight to the route. */
const routeBody = (filters: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  action: "body",
  namespace: NS_A,
  from: FROM,
  to: TO,
  bodyClass: BODY_CLASS,
  filters,
  ...extra,
});

/** The headers inside W in `TimeCreated, ID` order, each with the `Story393.Body` number it reads. */
const WINDOW_HEADERS: ReadonlyArray<{ id: number; body: number }> = [
  { id: 1, body: 1 },
  { id: 2, body: 2 },
  { id: 3, body: 3 },
  { id: 4, body: 4 },
  { id: 5, body: 5 },
  { id: 6, body: 6 },
  { id: 10, body: 1 },
];

/** The header IDs, in order, of the headers that read one of `bodies`. */
const headersOfBodies = (bodies: readonly number[]): number[] =>
  WINDOW_HEADERS.filter((header) => bodies.includes(header.body)).map((header) => header.id);

// -- Each operator on each kind of property ------------------------------

interface OperatorCase {
  name: string;
  filters: Array<Record<string, unknown>>;
  /** The oracle's predicate on `b`, written by hand with literals. */
  predicate: string;
  /** The header IDs the oracle selects, in order: written by hand, so an oracle that returns nothing cannot pass. */
  ids: number[];
}

const OPERATOR_CASES: OperatorCase[] = [
  { name: "eq on a default string ignores case: K1-alpha", filters: [filter("Code", "eq", "K1-alpha")], predicate: "b.Code = 'K1-alpha'", ids: [1, 2, 10] },
  { name: "eq on a default string ignores case: k1-ALPHA", filters: [filter("Code", "eq", "k1-ALPHA")], predicate: "b.Code = 'k1-ALPHA'", ids: [1, 2, 10] },
  { name: "startsWith on a default string", filters: [filter("Code", "startsWith", "k1-")], predicate: "b.Code %STARTSWITH 'k1-'", ids: [1, 2, 10] },
  { name: "contains respects case: ALPHA is in body 2 only", filters: [filter("Code", "contains", "ALPHA")], predicate: "b.Code [ 'ALPHA'", ids: [2] },
  { name: "contains respects case: alpha is in body 1 only", filters: [filter("Code", "contains", "alpha")], predicate: "b.Code [ 'alpha'", ids: [1, 10] },
  { name: "ne never matches a NULL Code", filters: [filter("Code", "ne", "K2")], predicate: "b.Code <> 'K2'", ids: [1, 2, 6, 10] },
  { name: "isNull", filters: [filter("Code", "isNull")], predicate: "b.Code IS NULL", ids: [5] },
  { name: "eq on an EXACT string is case-sensitive", filters: [filter("Exact", "eq", STORY393_EXACT_VALUES[0] as string)], predicate: `b.Exact = ${sqlLiteral(STORY393_EXACT_VALUES[0] as string)}`, ids: [1, 10] },
  { name: "eq on an EXACT string: the lower-case value is another body", filters: [filter("Exact", "eq", STORY393_EXACT_VALUES[1] as string)], predicate: `b.Exact = ${sqlLiteral(STORY393_EXACT_VALUES[1] as string)}`, ids: [2] },
  { name: "lt on an integer", filters: [filter("Amount", "lt", 10)], predicate: "b.Amount < 10", ids: [3, 4] },
  { name: "le on an integer", filters: [filter("Amount", "le", 10)], predicate: "b.Amount <= 10", ids: [1, 3, 4, 10] },
  { name: "gt on an integer", filters: [filter("Amount", "gt", 10)], predicate: "b.Amount > 10", ids: [2, 5, 6] },
  { name: "ge on an integer", filters: [filter("Amount", "ge", 10)], predicate: "b.Amount >= 10", ids: [1, 2, 5, 6, 10] },
  { name: "a number compares as a number, not as text (9 is below 10 and 1000)", filters: [filter("Amount", "gt", 9)], predicate: "b.Amount > 9", ids: [1, 2, 5, 6, 10] },
  { name: "notNull on a stream", filters: [filter("Note", "notNull")], predicate: "b.Note IS NOT NULL", ids: [1, 4, 10] },
  { name: "isNull on a stream", filters: [filter("Note", "isNull")], predicate: "b.Note IS NULL", ids: [2, 3, 5, 6] },
  { name: "eq on a boolean", filters: [filter("Flag", "eq", true)], predicate: "b.Flag = 1", ids: [1, 3, 10] },
  { name: "eq false on a boolean does not match a NULL", filters: [filter("Flag", "eq", false)], predicate: "b.Flag = 0", ids: [2] },
  { name: "eq on a reference compares the referenced ID", filters: [filter("Ref", "eq", 1)], predicate: "b.Ref = 1", ids: [1, 3, 10] },
  { name: "eq on a property renamed by SqlFieldName", filters: [filter("Renamed", "eq", "R-one")], predicate: "b.RenamedField = 'R-one'", ids: [1, 10] },
  { name: "eq on a property whose column is the reserved word Group (delimited)", filters: [filter("Group", "eq", "g1")], predicate: 'b."Group" = \'g1\'', ids: [1, 10] },
  { name: "contains on a SQL-computed property", filters: [filter("Computed", "contains", "C-K2")], predicate: "b.Computed [ 'C-K2'", ids: [3, 4] },
  { name: "two filters are ANDed", filters: [filter("Code", "eq", "K2"), filter("Amount", "lt", 0)], predicate: "b.Code = 'K2' AND b.Amount < 0", ids: [3] },
];

describe.skipIf(CAPTURE)("Story 39.3: each operator on each kind of property equals a hand-written JOIN (AC-4, Rule #36)", () => {
  for (const operatorCase of OPERATOR_CASES) {
    it(operatorCase.name, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      const expected = await joinOracle(NS_A, BODY_TABLE, BODY_CLASS, operatorCase.predicate);
      expect(headerIds(expected), "the oracle selects the rows written by hand").toEqual(operatorCase.ids);

      const started = performance.now();
      const content = succeeded(await bodySearch(interop, { filters: operatorCase.filters }));
      if (operatorCase.name.startsWith("two filters")) {
        // eslint-disable-next-line no-console
        console.log(`[PERF] story-39-3: first start ${firstStartMs} ms; one body search of A over W ${Math.round(performance.now() - started)} ms`);
        expect(performance.now() - started, "one body search of A over W stays under its 2 s budget").toBeLessThan(2000);
      }

      expect(content.rows, "every field of every row, in order").toEqual(expected);
      expect(content.action).toBe("body");
      expect(content.hasMore).toBe(false);
      expect(content).not.toHaveProperty("nextCursor");
      expect(content.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
    }, 120000);
  }

  it("never returns header 7, 8, 9 or 12 for a Story393.Body search, whatever the filter", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const seen = new Set<number>();
    for (const operatorCase of OPERATOR_CASES) {
      for (const id of headerIds(succeeded(await bodySearch(interop, { filters: operatorCase.filters })).rows)) seen.add(id);
    }
    expect([...seen].sort((a, b) => a - b), "only headers whose body is a Story393.Body row inside W").toEqual([1, 2, 3, 4, 5, 6, 10]);
  }, 120000);

  it("an HL7 body is searched through RawContent, and the row equals the oracle", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const expected = await joinOracle(NS_A, '"EnsLib_HL7"."Message"', "EnsLib.HL7.Message", "b.RawContent [ 'SYNTHPHI393-MRN'");
    expect(headerIds(expected)).toEqual([11]);

    const content = succeeded(
      await bodySearch(interop, { bodyClass: "EnsLib.HL7.Message", filters: [filter("RawContent", "contains", "SYNTHPHI393-MRN")] }),
    );

    expect(content.rows).toEqual(expected);
  }, 120000);

  it("a body property named like a header column (TimeCreated) is read from the body table, not the header table", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const expected = await joinOracle(
      NS_A,
      '"EnsLib_HL7"."Message"',
      "EnsLib.HL7.Message",
      "b.RawContent [ 'SYNTHPHI393-MRN' AND b.TimeCreated IS NOT NULL",
    );
    expect(headerIds(expected)).toEqual([11]);

    const content = succeeded(
      await bodySearch(interop, {
        bodyClass: "EnsLib.HL7.Message",
        filters: [filter("RawContent", "contains", "SYNTHPHI393-MRN"), filter("TimeCreated", "notNull")],
      }),
    );

    expect(content.rows).toEqual(expected);
  }, 120000);

  it("body filters combine with the header filters: target and errorOnly", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const expected = await joinOracle(
      NS_A,
      BODY_TABLE,
      BODY_CLASS,
      "b.Code = 'K2' AND b.Amount < 0",
      " AND h.TargetConfigName = 'Story393.Other' AND h.IsError = 1",
    );
    expect(headerIds(expected)).toEqual([3]);

    const content = succeeded(
      await bodySearch(interop, {
        filters: [filter("Code", "eq", "K2"), filter("Amount", "lt", 0)],
        target: "Story393.Other",
        errorOnly: true,
      }),
    );
    expect(content.rows).toEqual(expected);

    // The same two header filters with a body filter nothing satisfies: the header filters alone do not match.
    const none = succeeded(await bodySearch(interop, { filters: [filter("Code", "eq", "K3")], target: "Story393.Other", errorOnly: true }));
    expect(none.rows).toEqual([]);
  }, 120000);

  it("a body ID shared by two classes is never joined across them", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const other = succeeded(
      await bodySearch(interop, { bodyClass: "Story393.Other", filters: [filter("Code", "eq", "K1-alpha")] }),
    );
    expect(headerIds(other.rows), "header 7 reads Story393.Other 1").toEqual([7]);
    expect(other.rows).toEqual(
      await joinOracle(NS_A, '"Story393"."Other"', "Story393.Other", "b.Code = 'K1-alpha'", ""),
    );

    const body = succeeded(await bodySearch(interop, { filters: [filter("Code", "eq", "K1-alpha")] }));
    expect(headerIds(body.rows), "Story393.Body 1 is not Story393.Other 1").toEqual([1, 2, 10]);
    expect(headerIds(body.rows)).not.toContain(7);
  }, 120000);

  // Amount ge -5 matches every body, so seven headers; the tie of headers 4 and 5 at 08:00:03 falls on a page boundary.
  it("pages of 2 join, in order, without a gap or a duplicate; the 4/5 tie breaks by ID; only a page with more carries nextCursor", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const expected = await joinOracle(NS_A, BODY_TABLE, BODY_CLASS, "b.Amount >= -5");
    expect(headerIds(expected)).toEqual([1, 2, 3, 4, 5, 6, 10]);

    const pages: Structured[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = succeeded(await bodySearch(interop, { filters: [filter("Amount", "ge", -5)], limit: 2, ...(cursor === undefined ? {} : { cursor }) }));
      pages.push(page);
      if (!page.hasMore) break;
      expect(typeof page.nextCursor, `page ${pages.length} has more, so it carries nextCursor`).toBe("string");
      cursor = page.nextCursor;
    }

    expect(pages.map((page) => headerIds(page.rows))).toEqual([[1, 2], [3, 4], [5, 6], [10]]);
    expect(pages.flatMap((page) => page.rows)).toEqual(expected);
    const last = pages[pages.length - 1] as Structured;
    expect(last.hasMore).toBe(false);
    expect(last).not.toHaveProperty("nextCursor");
    for (const page of pages) expect(page.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
  }, 120000);

  it("a page that is exactly full and has no more carries no nextCursor", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded(await bodySearch(interop, { filters: [filter("Amount", "ge", -5)], limit: 7 }));

    expect(headerIds(content.rows)).toEqual([1, 2, 3, 4, 5, 6, 10]);
    expect(content.hasMore).toBe(false);
    expect(content).not.toHaveProperty("nextCursor");
  }, 120000);
});

// -- A body result is header rows only ------------------------------------

describe.skipIf(CAPTURE)("Story 39.3: a body search returns header rows and never a body value (AC-2)", () => {
  it("the matched bodies hold the marker (positive control), and neither the tool nor the route returns it", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const held = await atelierQuery(
      { ...TARGET, namespace: NS_A },
      `SELECT Exact FROM Story393.Body WHERE Exact [ '${MARKER}' AND ID IN (1, 3, 4, 5, 6)`,
    );
    expect(held.length, "the matched bodies hold the marker").toBe(5);

    const filters = [filter("Exact", "contains", MARKER)];
    const viaTool = await bodySearch(interop, { filters });
    expect(headerIds(succeeded(viaTool).rows)).toEqual(headersOfBodies([1, 3, 4, 5, 6]));
    expect(JSON.stringify(viaTool)).not.toContain(MARKER);

    const viaRoute = await postEnvelope(TARGET, ROUTE, routeBody(filters));
    expect(viaRoute.errors).toEqual([]);
    expect((viaRoute.result.rows as Array<{ id: number }>).map((row) => row.id)).toEqual(headersOfBodies([1, 3, 4, 5, 6]));
    expect(viaRoute.text, "the raw route answer").not.toContain(MARKER);
    expect(Object.keys((viaRoute.result.rows as Array<Record<string, unknown>>)[0] as object)).toEqual([
      "id", "sessionId", "type", "status", "isError", "sourceItem", "targetItem", "bodyClassName", "bodyId",
      "timeCreated", "timeProcessed", "correspondingMessageId",
    ]);
  }, 120000);
});

// -- Refusals ---------------------------------------------------------------

describe.skipIf(CAPTURE)("Story 39.3: a property or class that cannot be searched is refused, naming the parameter and not the value (AC-1)", () => {
  const REFUSED_PROPERTIES: Array<[string, string]> = [
    ["a case variant", "code"],
    ["the SQL name of a renamed property", "RenamedField"],
    ["a transient property", "Secret"],
    ["a calculated property with no SQL computation", "Shown"],
    ["a multidimensional property", "Scratch"],
    ["a list collection", "Tags"],
    ["an array collection", "Props"],
    ["a serial (embedded) object", "Addr"],
    ["a property only the other namespace's class has", "OnlyInB"],
    ["a property nothing has", "NoSuch"],
  ];
  for (const [what, property] of REFUSED_PROPERTIES) {
    it(`route: ${what} (${property}) is refused naming filters[0].property`, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      const answer = await postEnvelope(TARGET, ROUTE, routeBody([filter(property, "eq", MARKER)]));

      expect(answer.status).toBe(200);
      expect(answer.errors.length, answer.text).toBeGreaterThanOrEqual(1);
      expect(answer.errors[0]).toContain("filters[0].property");
      expect(answer.text).not.toContain(MARKER);
      expect(answer.result, "a refusal returns an empty result").toEqual({});
    }, 120000);
  }

  it("route: a stream accepts only isNull and notNull; contains is refused naming filters[0].op", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const answer = await postEnvelope(TARGET, ROUTE, routeBody([filter("Note", "contains", MARKER)]));

    expect(answer.errors[0]).toContain("filters[0].op");
    expect(answer.text).not.toContain(MARKER);
    expect(answer.result).toEqual({});
    expect((await postEnvelope(TARGET, ROUTE, routeBody([filter("Note", "isNull")]))).errors, "isNull on the same stream is accepted").toEqual([]);
  }, 120000);

  it("a statement that fails while it runs gives the fixed text with its SQLCODE, never the value, over the route and the tool", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const answer = await postEnvelope(TARGET, ROUTE, routeBody([filter("Boom", "eq", MARKER)]));

    expect(answer.status).toBe(200);
    expect(answer.errors.length, answer.text).toBe(1);
    expect(answer.errors[0]).toMatch(/^ERROR #5001: The body search failed with SQLCODE -?\d+\.$/);
    expect(answer.text).not.toContain(MARKER);
    expect(answer.result).toEqual({});

    const result = await bodySearch(interop, { filters: [filter("Boom", "eq", MARKER)] });
    expect(result.isError).toBe(true);
    expect(firstText(result)).toMatch(/The body search failed with SQLCODE -?\d+\./);
    expect(JSON.stringify(result)).not.toContain(MARKER);
  }, 120000);

  it("the tool refuses a property that does not exist with the IRIS text, never the value", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await bodySearch(interop, { filters: [filter("NoSuch", "eq", MARKER)] });

    expect(result.isError).toBe(true);
    expect(firstText(result)).toContain("filters[0].property");
    expect(JSON.stringify(result)).not.toContain(MARKER);
  }, 120000);

  it("the tool refuses filters on the headers action instead of ignoring them, and the missing body input", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const withFilters = await interop.call("iris_message_search", {
      action: "headers",
      namespace: NS_A,
      from: FROM,
      to: TO,
      filters: [filter("Code", "eq", MARKER)],
    });
    expect(withFilters.isError).toBe(true);
    expect(firstText(withFilters)).toBe("'filters' applies only to the body and searchTable actions.");

    const noClass = await interop.call("iris_message_search", { action: "body", namespace: NS_A, from: FROM, to: TO, filters: [filter("Code", "eq", "x")] });
    expect(noClass.isError).toBe(true);
    expect(firstText(noClass)).toContain("'bodyClass'");
    const noFilters = await bodySearch(interop, {});
    expect(noFilters.isError).toBe(true);
    expect(firstText(noFilters)).toContain("'filters'");
  }, 120000);

  const REFUSED_CLASSES: Array<[string, string]> = [
    ["a class that does not exist", "Story393.NoSuch"],
    ["a case variant of a class", "story393.body"],
    ["a serial class", "Story393.Addr"],
    ["a stream class", "%Stream.GlobalCharacter"],
    ["a well-formed name that carries the marker", `No.${MARKER}`],
  ];
  for (const [what, bodyClass] of REFUSED_CLASSES) {
    it(`route: ${what} (${bodyClass}) is refused naming bodyClass`, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      const answer = await postEnvelope(TARGET, ROUTE, routeBody([filter("Code", "eq", MARKER)], { bodyClass }));

      expect(answer.errors.length, answer.text).toBeGreaterThanOrEqual(1);
      expect(answer.errors[0]).toContain("'bodyClass'");
      expect(answer.text).not.toContain(MARKER);
      expect(answer.result).toEqual({});
    }, 120000);
  }

  const ok = filter("Code", "eq", "x");
  const eleven = Array.from({ length: 11 }, () => ok);
  const SHAPE_CASES: Array<[string, Record<string, unknown>, string]> = [
    ["no bodyClass", { bodyClass: undefined }, "bodyClass"],
    ["a bodyClass with a quote", { bodyClass: `Story393.Body' OR '1'='1 ${MARKER}` }, "bodyClass"],
    ["no filters", { filters: undefined }, "filters"],
    ["filters empty", { filters: [] }, "filters"],
    ["11 filters", { filters: eleven }, "filters"],
    ["filters a string", { filters: MARKER }, "filters"],
    ["a filter that is a number", { filters: [5] }, "filters[0]"],
    ["an extra key", { filters: [{ ...ok, [MARKER]: 1 }] }, "filters[0]"],
    ["property missing", { filters: [{ op: "eq", value: MARKER }] }, "filters[0].property"],
    ["property a number", { filters: [{ property: 5, op: "eq", value: "x" }] }, "filters[0].property"],
    ["property with a space", { filters: [filter(`Co de ${MARKER}`, "eq", "x")] }, "filters[0].property"],
    ["property with a double quote", { filters: [filter(`a"b ${MARKER}`, "eq", "x")] }, "filters[0].property"],
    ["property of 129 characters", { filters: [filter(`${MARKER}${"x".repeat(118)}`, "eq", "x")] }, "filters[0].property"],
    ["op missing", { filters: [{ property: "Code", value: MARKER }] }, "filters[0].op"],
    ["op EQ", { filters: [filter("Code", `EQ ${MARKER}`, "x")] }, "filters[0].op"],
    ["op like", { filters: [filter("Code", "like", `${MARKER}%`)] }, "filters[0].op"],
    ["op =", { filters: [filter("Code", "=", MARKER)] }, "filters[0].op"],
    ["eq with no value", { filters: [filter("Code", "eq")] }, "filters[0].value"],
    ["isNull with a value", { filters: [filter("Code", "isNull", MARKER)] }, "filters[0].value"],
    ["a value of the empty string", { filters: [filter("Code", "eq", "")] }, "filters[0].value"],
    ["a value of 1025 characters", { filters: [filter("Code", "eq", `${MARKER}${"x".repeat(1014)}`)] }, "filters[0].value"],
    ["a value that is an object", { filters: [{ property: "Code", op: "eq", value: { a: MARKER } }] }, "filters[0].value"],
    ["a value that is an array", { filters: [{ property: "Code", op: "eq", value: [MARKER] }] }, "filters[0].value"],
    ["a bad op in the third filter", { filters: [ok, ok, filter("Code", `bad ${MARKER}`, "x")] }, "filters[2].op"],
    ["filters on the headers action", { action: "headers", filters: [ok] }, "filters"],
    ["a window over 7 days on the body action", { from: "2001-02-01T00:00:00Z", to: "2001-02-09T00:00:01Z" }, "exceeds the maximum of 7 days"],
    ["a limit of 0 on the body action", { limit: 0 }, "limit"],
    ["an unknown status on the body action", { status: "Nope" }, "status"],
    ["half a cursor on the body action", { afterTimeCreated: "2001-02-03 08:00:00" }, "afterId"],
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

/** The properties of `Story393.Body` in A that accept `isNull`, and the bodies whose value is NULL, written by hand from the seed. */
const NULL_BODIES: Record<string, readonly number[]> = {
  Code: [5],
  Exact: [],
  Amount: [],
  Flag: [4, 5, 6],
  Renamed: [3, 4, 5, 6],
  Group: [2, 3, 4, 5, 6],
  Computed: [],
  Ref: [2, 4, 5, 6],
  OnlyInA: [2, 3, 4, 5, 6],
  Note: [2, 3, 5, 6],
};

/** The SQL column of each searchable property, for the check against INFORMATION_SCHEMA. */
const COLUMN_OF: Record<string, string> = { Renamed: "RenamedField" };

/** The operators, written by hand, and the Code values they select for the value K2 (SQLUPPER collation; contains is case-sensitive). */
const CODES: ReadonlyArray<string | null> = ["K1-alpha", "k1-ALPHA", "K2", "K2", null, "K3"];
const CODE_OPS: Record<string, (code: string | null) => boolean> = {
  eq: (code) => code !== null && code.toUpperCase() === "K2",
  ne: (code) => code !== null && code.toUpperCase() !== "K2",
  lt: (code) => code !== null && code.toUpperCase() < "K2",
  le: (code) => code !== null && code.toUpperCase() <= "K2",
  gt: (code) => code !== null && code.toUpperCase() > "K2",
  ge: (code) => code !== null && code.toUpperCase() >= "K2",
  contains: (code) => code !== null && code.includes("K2"),
  startsWith: (code) => code !== null && code.toUpperCase().startsWith("K2"),
  isNull: (code) => code === null,
  notNull: (code) => code !== null,
};

/** The bodies whose Exact value satisfies the operator, by EXACT collation: the TypeScript oracle. */
const EXACT_OPS: Record<string, (stored: string, value: string) => boolean> = {
  eq: (stored, value) => stored === value,
  ne: (stored, value) => stored !== value,
  contains: (stored, value) => stored.includes(value),
  startsWith: (stored, value) => stored.startsWith(value),
};
const exactBodies = (op: string, value: string): number[] =>
  STORY393_EXACT_VALUES.flatMap((stored, index) => (EXACT_OPS[op]?.(stored, value) ? [index + 1] : []));

/** Text made of the shared fuzz alphabet; with `marker` it embeds SYNTHPHI393 at a random position. */
function fuzzText(random: () => number, marker: boolean): string {
  return sharedFuzzText(random, marker ? MARKER : undefined);
}

describe.skipIf(CAPTURE)("Story 39.3: the injection fuzz drives the REST route directly (AC-3, Rule #59, AD-26)", () => {
  it("the searchable properties are the columns INFORMATION_SCHEMA lists (the property-kind table agrees with the dictionary)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const columns = (
      await atelierQuery(
        { ...TARGET, namespace: NS_A },
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = 'Story393' AND TABLE_NAME = 'Body'",
      )
    ).map((row) => String(row["COLUMN_NAME"]));

    for (const property of Object.keys(NULL_BODIES)) {
      expect(columns, `${property} is a column`).toContain(COLUMN_OF[property] ?? property);
    }
    // The columns no searchable property names: the embedded object's column, the list, and the row ID. `Boom`
    // is searchable (it is SQL-computed) but fails while a statement runs, so it has its own row below.
    expect(columns).toContain("Boom");
    const unsearchable = columns.filter(
      (column) => column !== "Boom" && !Object.keys(NULL_BODIES).some((property) => (COLUMN_OF[property] ?? property) === column),
    );
    expect(unsearchable.sort()).toEqual(["Addr_Street", "ID", "Tags"]);
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
    const random = mulberry32(393);
    const violations: string[] = [];
    let requests = 0;
    const started = performance.now();

    /** Send one filter and check the invariants every request must keep. */
    async function probe(slot: string, filterValue: Record<string, unknown>, expectedBodies: number[] | undefined, token: string): Promise<void> {
      requests += 1;
      const answer = await postEnvelope(TARGET, ROUTE, routeBody([filterValue]));
      const label = `${slot} ${JSON.stringify(filterValue).slice(0, 120)}`;
      if (answer.text.includes(MARKER)) violations.push(`${label}: the response echoes the marker`);
      if (answer.status !== 200) violations.push(`${label}: HTTP ${answer.status}`);
      if (expectedBodies === undefined) {
        if (answer.errors.length === 0) violations.push(`${label}: accepted, but it is not a searchable input`);
        else if (!answer.errors[0]?.includes(token)) violations.push(`${label}: refused without naming ${token}: ${answer.errors[0]?.slice(0, 160)}`);
        return;
      }
      if (answer.errors.length > 0) {
        violations.push(`${label}: refused, but it is searchable: ${answer.errors[0]?.slice(0, 160)}`);
        return;
      }
      const got = (answer.result.rows as Array<{ id: number }>).map((row) => row.id);
      const want = headersOfBodies(expectedBodies);
      if (JSON.stringify(got) !== JSON.stringify(want)) violations.push(`${label}: rows ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`);
    }

    // Property slot: a fixed corpus and 200 random names, with isNull.
    const propertyCorpus = [
      ...Object.keys(NULL_BODIES),
      "Secret", "Shown", "Scratch", "Tags", "Props", "Addr", "OnlyInB", "NoSuch",
      "code", "CODE", "renamed", "RenamedField", "ID", "%ID", "Addr.Street", "Addr_Street", "Ens", `${MARKER}`,
      'Code" = 1 OR Story393.Side_Bump() = 1 OR "Code', `Code" IS NULL OR Story393.Side_Bump() = 1 --${MARKER}`,
    ];
    const randomProperties = Array.from({ length: 200 }, () => fuzzText(random, true));
    for (const property of [...propertyCorpus, ...randomProperties]) {
      const searchable = Object.prototype.hasOwnProperty.call(NULL_BODIES, property);
      await probe("property", filter(property, "isNull"), searchable ? [...(NULL_BODIES[property] as readonly number[])] : undefined, "filters[0].property");
    }

    // Op slot: the ten operators on Code with the value K2, and a fixed corpus and 100 random strings that are not operators.
    for (const [op, matches] of Object.entries(CODE_OPS)) {
      const bodies = CODES.flatMap((code, index) => (matches(code) ? [index + 1] : []));
      await probe("op", op === "isNull" || op === "notNull" ? filter("Code", op) : filter("Code", op, "K2"), bodies, "filters[0].op");
    }
    const opCorpus = ["EQ", "Eq", "=", "like", "in", "between", "[", "%STARTSWITH", "eq OR Story393.Side_Bump()=1", `eq ${MARKER}`, "", " eq", "eq "];
    const randomOps = Array.from({ length: 100 }, () => fuzzText(random, true));
    for (const op of [...opCorpus, ...randomOps]) await probe("op", filter("Code", op, "K2"), undefined, "filters[0].op");

    // Value slot: a fixed corpus and 300 random strings on Exact with eq, ne, contains and startsWith.
    const stored = [...STORY393_EXACT_VALUES];
    const valueCorpus = [
      "' OR '1'='1", "\" OR \"1\"=\"1", "'; SELECT Story393.Side_Bump() --", "x' OR Story393.Side_Bump() = 1 OR 'x", "Story393.Side_Bump()",
      "%", "_", "\\", "[", "]", "?",
      "\n", "\t", "\r\n", "x", " ", "  SYNTHPHI393-E1", "SYNTHPHI393-E1 ", String.fromCodePoint(0xe9), String.fromCodePoint(0x4e2d), "OR 1=1", "UNION SELECT 1", "x".repeat(1024),
      ...stored, ...stored.map((value) => value.slice(1)), ...stored.map((value) => value.slice(0, -1)).filter((value) => value !== ""),
    ];
    const randomValues = Array.from({ length: 300 }, () => {
      const pick = random();
      const source = stored[Math.floor(random() * stored.length)] as string;
      if (pick < 0.25) return source;
      if (pick < 0.5) {
        const from = Math.floor(random() * source.length);
        return source.slice(from, from + 1 + Math.floor(random() * (source.length - from)));
      }
      if (pick < 0.65) return `${source}${fuzzText(random, false)}`;
      return fuzzText(random, random() < 0.5);
    });
    const valueOps = ["eq", "ne", "contains", "startsWith"];
    let index = 0;
    for (const value of [...valueCorpus, ...randomValues]) {
      const op = valueOps[index % valueOps.length] as string;
      index += 1;
      await probe("value", filter("Exact", op, value), exactBodies(op, value), "filters[0].value");
    }

    // eslint-disable-next-line no-console
    console.log(`[PERF] story-39-3 fuzz: ${requests} requests in ${Math.round(performance.now() - started)} ms`);
    expect(violations.slice(0, 5), `${violations.length} violation(s); the first five`).toEqual([]);
    expect(violations).toEqual([]);
    expect(requests, "the corpus ran in full").toBeGreaterThanOrEqual(640);
    expect(await sideCount(dev, NS_A), "no statement of the fuzz called the side-effect function").toBe(0);
    expect(await sideDefined(dev, NS_A), "^Story393Side is still undefined").toBe(0);
  }, 600000);
});

// -- A second namespace, a namespace that is not configured, a namespace that is missing -----------

describe.skipIf(CAPTURE)("Story 39.3: second namespace, not configured, unknown namespace (AC-4; Rules #34, #41)", () => {
  it("OnlyInA, OnlyInB and Renamed: each namespace equals its own oracle, they differ, and the other's property is refused", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const renamedInA = succeeded(await bodySearch(interop, { namespace: NS_A, filters: [filter("Renamed", "eq", "R-one")] }));
    const renamedInB = succeeded(await bodySearch(interop, { namespace: NS_B, filters: [filter("Renamed", "eq", "R-one")] }));
    expect(renamedInA.rows).toEqual(await joinOracle(NS_A, BODY_TABLE, BODY_CLASS, "b.RenamedField = 'R-one'"));
    expect(renamedInB.rows).toEqual(await joinOracle(NS_B, BODY_TABLE, BODY_CLASS, "b.RenamedB = 'R-one'"));
    expect(headerIds(renamedInA.rows)).toEqual([1, 10]);
    expect(headerIds(renamedInB.rows)).toEqual([1]);
    expect(renamedInA.rows).not.toEqual(renamedInB.rows);

    const onlyInA = succeeded(await bodySearch(interop, { namespace: NS_A, filters: [filter("OnlyInA", "eq", "a1")] }));
    expect(onlyInA.rows).toEqual(await joinOracle(NS_A, BODY_TABLE, BODY_CLASS, "b.OnlyInA = 'a1'"));
    expect(headerIds(onlyInA.rows)).toEqual([1, 10]);
    const onlyInB = succeeded(await bodySearch(interop, { namespace: NS_B, filters: [filter("OnlyInB", "eq", "b1")] }));
    expect(onlyInB.rows).toEqual(await joinOracle(NS_B, BODY_TABLE, BODY_CLASS, "b.OnlyInB = 'b1'"));
    expect(headerIds(onlyInB.rows)).toEqual([1]);

    const inBRefused = await bodySearch(interop, { namespace: NS_B, filters: [filter("OnlyInA", "eq", "a1")] });
    const inARefused = await bodySearch(interop, { namespace: NS_A, filters: [filter("OnlyInB", "eq", "b1")] });
    for (const refused of [inBRefused, inARefused]) {
      expect(refused.isError).toBe(true);
      expect(firstText(refused)).toContain("filters[0].property");
    }
  }, 120000);

  it("a namespace with no Interoperability mappings is notApplicable with the policy, not an error", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await bodySearch(interop, { namespace: NS_C, filters: [filter("Code", "eq", "x")] });

    expect(result.isError, firstText(result)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      action: "body",
      notApplicable: true,
      rows: [],
      hasMore: false,
      dataPolicy: { policy: "redact", redacted: 0, blocked: 0 },
    });
    expect(String((result.structuredContent as { reason?: unknown }).reason)).toContain(NS_C);

    const viaRoute = await postEnvelope(TARGET, ROUTE, routeBody([filter("Code", "eq", "x")], { namespace: NS_C }));
    expect(viaRoute.errors).toEqual([]);
    expect(viaRoute.result).toMatchObject({ action: "body", interopEnabled: false, rows: [], hasMore: false });
  }, 120000);

  it("searchTable there is notApplicable for no Interoperability too: Interoperability is checked before the Search Table configuration (Story 39.4)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // C has no Ens_Config.SearchTableProp table, so a configuration read before the Interoperability check would be an SQL error.
    const lookup = { action: "searchTable", namespace: NS_C, from: FROM, to: TO, searchTableClass: "EnsLib.HL7.SearchTable", filters: [filter("PatientID", "eq", "x")] };
    const result = await interop.call("iris_message_search", lookup);

    expect(result.isError, firstText(result)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      action: "searchTable",
      notApplicable: true,
      rows: [],
      hasMore: false,
      dataPolicy: { policy: "redact", redacted: 0, blocked: 0 },
    });
    expect(String((result.structuredContent as { reason?: unknown }).reason)).toContain(NS_C);

    const viaRoute = await postEnvelope(TARGET, ROUTE, lookup);
    expect(viaRoute.errors, viaRoute.text).toEqual([]);
    expect(viaRoute.result).toMatchObject({ action: "searchTable", interopEnabled: false, rows: [], hasMore: false });
    expect(viaRoute.result, "the configuration is never read there").not.toHaveProperty("searchTablesConfigured");
  }, 120000);

  it("a namespace that does not exist, with a valid shape, is an error carrying the sanitized switch text", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await bodySearch(interop, { namespace: NS_Z, filters: [filter("Code", "eq", "x")] });

    expect(result.isError).toBe(true);
    expect(result.structuredContent?.["code"]).toBeUndefined();
    expect(firstText(result), "the namespace switch error").toContain("<NAMESPACE>");
    expect(firstText(result)).not.toContain("^");
  }, 120000);
});

// -- The data policy ------------------------------------------------------------

describe.skipIf(CAPTURE)("Story 39.3: the data policy decides before any IRIS call (AC-2; AD-26, AD-9)", () => {
  const SEARCH = { filters: [filter("Code", "eq", "K1-alpha")] };

  it("under IRIS_DATA_POLICY=block the body action is refused, and no IRIS call is made (the same call at a missing namespace is refused, not a namespace error)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const blocked = await interopSession({ IRIS_DATA_POLICY: "block" });

    for (const namespace of [NS_A, NS_Z]) {
      const refused = await bodySearch(blocked, { ...SEARCH, namespace });
      expect(refused.isError, namespace).toBe(true);
      expect(refused.structuredContent, namespace).toEqual({ code: "DATA_POLICY_BLOCKED", action: "body", policy: "block" });
    }

    const headers = await blocked.call("iris_message_search", { action: "headers", namespace: NS_A, from: FROM, to: TO });
    expect(headers.isError, "headers is not under the policy").toBeFalsy();
    expect(headerIds((headers.structuredContent as Structured).rows)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  }, 120000);

  it("a profile with dataPolicy block is refused while the default profile of the same server runs body", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const session = await interopSession({ IRIS_PROFILES: JSON.stringify({ tight: { dataPolicy: "block" } }) });

    for (const namespace of [NS_A, NS_Z]) {
      const refused = await session.callOn("tight", "iris_message_search", {
        action: "body",
        namespace,
        from: FROM,
        to: TO,
        bodyClass: BODY_CLASS,
        ...SEARCH,
      });
      expect(refused.structuredContent, namespace).toEqual({ code: "DATA_POLICY_BLOCKED", action: "body", policy: "block" });
    }
    const ran = succeeded(await bodySearch(session, SEARCH));
    expect(headerIds(ran.rows)).toEqual([1, 2, 10]);
    expect(ran.dataPolicy).toEqual({ policy: "redact", redacted: 0, blocked: 0 });
  }, 120000);

  it("redact and allow return the same rows, each naming its policy in dataPolicy and in one trailing line", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const allow = await interopSession({ IRIS_DATA_POLICY: "allow" });
    const expected = await joinOracle(NS_A, BODY_TABLE, BODY_CLASS, "b.Code = 'K1-alpha'");
    expect(headerIds(expected), "the oracle selects the rows written by hand").toEqual([1, 2, 10]);

    for (const [policy, session] of [["redact", interop], ["allow", allow]] as const) {
      const result = await bodySearch(session, SEARCH);
      const content = succeeded(result);
      expect(content.rows, policy).toEqual(expected);
      expect(content.dataPolicy, policy).toEqual({ policy, redacted: 0, blocked: 0 });
      const lines = firstText(result).split("\n");
      expect(lines.at(-1), policy).toBe(`Data policy ${policy}: header rows only; the body action returns no body content.`);
      expect(lines.filter((line) => line.startsWith("Data policy")), `one policy line (${policy})`).toHaveLength(1);
    }
  }, 120000);

  it("searchTable (built in Story 39.4) runs a valid lookup of A, which has no Search Table, as notApplicable with the policy", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await interop.call("iris_message_search", {
      action: "searchTable",
      namespace: NS_A,
      from: FROM,
      to: TO,
      searchTableClass: "EnsLib.HL7.SearchTable",
      filters: [filter("PatientID", "eq", "x")],
    });

    expect(result.isError, firstText(result)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      action: "searchTable",
      notApplicable: true,
      rows: [],
      dataPolicy: { policy: "redact", redacted: 0, blocked: 0 },
    });
    expect(result.structuredContent).not.toHaveProperty("code");
  }, 120000);
});

// -- The audit trail ------------------------------------------------------------

describe.skipIf(CAPTURE)("Story 39.3: the audit trail redacts the filters and records the policy (AC-2, AC-5; AD-19)", () => {
  it("records dataPolicy for redact, block and allow; logs filters as [REDACTED] under redact and block and as given under allow", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const search = { filters: [filter("Code", "eq", MARKER)] };
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
      const result = await bodySearch(session, search);
      const invalid = await bodySearch(session, { filters: [filter("Code", `${MARKER}`, MARKER)] });
      // The schema-invalid call is refused inside the audited chokepoint (DW-579), so both calls have an entry: the first call's, then
      // the invalid call's, which lists the raw key names and carries neither `params` nor a `dataPolicy` summary.
      expect(invalid.isError, "a Zod-invalid op").toBe(true);
      expect(firstText(invalid), "the invalid call names the path").toContain("op");

      const entries = await pollAuditEntries(file, { tool: "iris_message_search", count: 2, intervalMs: 50, timeoutMs: 10000, excerpt: 3000 });
      const [entry, invalidEntry] = entries as [Record<string, unknown>, Record<string, unknown>];
      expect(entry, row.policy).toMatchObject({
        action: "body",
        outcome: row.outcome,
        dataPolicy: { policy: row.policy, redacted: 0, blocked: 0 },
      });
      expect(invalidEntry, `${row.policy}: the schema-invalid call is audited`).toMatchObject({ action: "body", outcome: "error" });
      expect(invalidEntry["paramKeys"], `${row.policy}: the invalid call's raw key names`).toContain("filters");
      expect(invalidEntry, `${row.policy}: the invalid call records no params`).not.toHaveProperty("params");
      expect(invalidEntry, `${row.policy}: the invalid call records no data policy`).not.toHaveProperty("dataPolicy");
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
