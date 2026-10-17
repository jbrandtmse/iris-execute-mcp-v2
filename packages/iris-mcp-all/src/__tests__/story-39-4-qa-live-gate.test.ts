/**
 * Story 39.4 (QA) live gate: what the Search Table gate leaves open, on the REAL wire, in the default suite
 * (Rules #34, #36, #41, #59).
 *
 * Paths: the BUILT iris-interop-mcp dist over stdio for the tool rows; raw HTTP `POST`s to the search route for
 * the route rows; the oracle is SQL written by hand (`IN` / `NOT IN` over the search table, the PropId resolved by
 * its own join on `Ens_Config.SearchTableProp`), run through the raw Atelier `action/query` route, never the code
 * under test.
 *
 * Rows:
 *  - a REAL Interoperability namespace (HSCUSTOM, set up by the product, not mapped like the scratch namespaces)
 *    with no Search Table property answers `notApplicable`, whatever the class, and the lookup reads no message:
 *    the row runs only when an independent, read-only count of `Ens_Config.SearchTableProp` there is 0, with a
 *    window on 2001-02-03, and is skipped with the reason otherwise (the Search Table gate's namespace C is a
 *    mapping-only namespace);
 *  - filters combine with AND, each on its own entries, also when they name the SAME multi-valued property: header
 *    2 holds two medical record numbers, so `eq MRN-2` AND `eq MRN-1` finds it, `eq MRN-1` AND `ne MRN-2` does not,
 *    and `notNull` AND `isNull` of one property find nothing (one `EXISTS` for both would answer differently);
 *  - every scope filter at once (item, source, target, status, session ID, body class, error flag) beside a Search
 *    Table filter, one filter mismatching at a time, and a paged run under them, each equal to the oracle: the
 *    header parameters, the Search Table parameters and the cursor position meet in one positional argument list.
 *
 * Fixture: tau of the Search Table gate (eleven headers over six HL7 messages and one string body, all on
 * 2001-02-03 UTC; `Story394.SearchTable` compiled inside), in its own scratch namespace `EXECMCPTMP394Q`, which is
 * removed in `afterAll` with nothing-left assertions. Every identifying value contains `SYNTHPHI394`.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD` (defaults: localhost:52773, `_SYSTEM`). Writes only
 * the namespace and database `EXECMCPTMP394Q` and the HSCUSTOM class `ExecuteMCPv2.Temp.Story391Fixture`; reads
 * HSCUSTOM's `Ens_Config.SearchTableProp` row count and sends the HSCUSTOM lookups described above. A missing or
 * stale dist, an unresolvable SDK or an unreachable IRIS skips each row with the reason, or fails with "may not be
 * skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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
  staleDistReason,
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
  seedSearchTable,
} from "./interop-namespace-fixture.js";
import { searchTableCondition, searchTableOracle } from "./header-row-oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const entryOf = (pkg: string): string => path.join(REPO_ROOT, "packages", pkg, "dist", "index.js");

const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The scratch namespace holding fixture tau, and the product's own Interoperability namespace (read-only here). */
const NS_Q = "EXECMCPTMP394Q";
const NS_HOME = "HSCUSTOM";
const ST = "EnsLib.HL7.SearchTable";
const NO_SUCH_CLASS = "No.Such.Story394Class";
/** The extent table of the Search Table classes (their extent root) and their class extent in `Ens_Config.SearchTableProp`. */
const EXTENT_TABLE = "EnsLib_HL7.SearchTable";
const CLASS_EXTENT = "EnsLib.HL7.SearchTable";
/** Every identifying value contains this marker; nothing a response holds may. */
const MARKER = "SYNTHPHI394";

/** The window W: every header of the fixture except header 11. */
const FROM = "2001-02-03T07:00:00Z";
const TO = "2001-02-03T09:00:00Z";
const WINDOW_SQL = "h.TimeCreated >= '2001-02-03 07:00:00' AND h.TimeCreated <= '2001-02-03 09:00:00'";
const ROUTE = "/interop/message/search";

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
/** The built interop server under default configuration (no data-policy setting: `redact`). */
let interop: WireSession;

function wireOptions(pkg: string): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: entryOf(pkg),
    target: TARGET,
    clientName: "story-39-4-qa-live-gate",
  };
}

/** Per-test skip helper: log the reason, then mark the test skipped. */
function skip(testCtx: { skip: () => void }): void {
  // eslint-disable-next-line no-console
  console.log(`[SKIP] story-39-4-qa-live-gate: ${skipReason}`);
  testCtx.skip();
}

const textOf = (result: WireToolResult): string => result.content?.[0]?.text ?? "";
const ids = (rows: Array<Record<string, unknown>>): number[] => rows.map((row) => Number(row["id"]));
const filter = (property: string, op: string, value?: string | number | boolean): Record<string, unknown> =>
  value === undefined ? { property, op } : { property, op, value };

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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.4 QA live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  const started = performance.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  const firstStartMs = Math.round(performance.now() - started);
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  // eslint-disable-next-line no-console
  console.log(`[PERF] story-39-4-qa: first start ${firstStartMs} ms`);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  interop = await openWireSession(wireOptions("iris-interop-mcp"));
  await putFixtureClass(dev);
  await removeInteropNamespace(admin, dev, NS_Q);
  expect(await leftovers(dev, [NS_Q]), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS_Q, { interop: true });
  await seedSearchTable(dev, NS_Q, "a");

  // A positive control: the same check that must read empty after the run sees the namespace now.
  expect(await leftovers(dev, [NS_Q]), "the leftovers check sees the namespace while it exists").toEqual(
    expect.arrayContaining([`namespace ${NS_Q}`, `database configuration ${NS_Q}`]),
  );
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
    await attempt(`removing ${NS_Q}`, () => removeInteropNamespace(admin, dev, NS_Q));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, [NS_Q]), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      for (const filterText of ["Story391", "Story393", "Story394"]) {
        const listed = await dev.call("iris_doc_list", { filter: filterText, generated: true });
        expect(listed.isError, `the ${filterText} document listing`).toBeFalsy();
        const names = (listed.structuredContent as { items: Array<{ name: string }> }).items.map((item) => item.name);
        expect(names, `no ${FIXTURE_DOC} or ${filterText} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [interop, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- Helpers ---------------------------------------------------------------------

type Structured = Record<string, unknown> & { rows: Array<Record<string, unknown>>; hasMore: boolean; nextCursor?: string };

/** A Search Table lookup of `namespace` over window W through the built interop server; `args` overrides any field. */
function lookup(args: Record<string, unknown>, namespace: string = NS_Q): Promise<WireToolResult> {
  return interop.call("iris_message_search", {
    action: "searchTable",
    namespace,
    from: FROM,
    to: TO,
    searchTableClass: ST,
    ...args,
  });
}

/** The structured content of a successful lookup, which must hold no Search Table value. */
function succeeded(result: WireToolResult): Structured {
  expect(result.isError, textOf(result)).toBeFalsy();
  expect(JSON.stringify(result).toLowerCase(), "a lookup result holds no Search Table value").not.toContain(MARKER.toLowerCase());
  return result.structuredContent as Structured;
}

interface RouteAnswer {
  status: number;
  text: string;
  errors: string[];
  result: Record<string, unknown>;
}

/** POST a lookup of `namespace` over window W straight to the route and parse the envelope. */
async function route(body: Record<string, unknown>, namespace: string = NS_Q): Promise<RouteAnswer> {
  const answer = await executeMcpPost(TARGET, ROUTE, {
    action: "searchTable",
    namespace,
    from: FROM,
    to: TO,
    searchTableClass: ST,
    ...body,
  });
  const parsed = JSON.parse(answer.text) as { status: { errors?: Array<{ error: string }> }; result: Record<string, unknown> };
  return { status: answer.status, text: answer.text, errors: (parsed.status.errors ?? []).map((entry) => entry.error), result: parsed.result };
}

/** One condition of the hand-written oracle: entries of `prop` satisfying `predicate` (stored form, alias `s`), or, with `negate`, none. */
interface Condition {
  prop: string;
  predicate: string;
  negate?: boolean;
}

/**
 * The hand-written `IN` / `NOT IN` oracle (Rule #36) of fixture tau over window W: every condition is its own
 * `IN` / `NOT IN` subquery of the search table, joined with AND, and `extra` adds header conditions (it starts
 * with ` AND `). The PropIds are resolved by the oracle's own join on `Ens_Config.SearchTableProp`.
 */
function oracle(conditions: readonly Condition[], extra = ""): Promise<Array<Record<string, unknown>>> {
  const [first, ...rest] = conditions as [Condition, ...Condition[]];
  const more = rest.map((c) => ` AND ${searchTableCondition(EXTENT_TABLE, CLASS_EXTENT, c.prop, c.predicate, c.negate ?? false)}`).join("");
  return searchTableOracle(TARGET, NS_Q, EXTENT_TABLE, CLASS_EXTENT, first.prop, WINDOW_SQL, first.predicate, first.negate ?? false, `${more}${extra}`);
}

// -- A real Interoperability namespace with no Search Table property -----------------------------

describe("Story 39.4 QA: a real Interoperability namespace with no Search Table property is notApplicable (AC-4; Rules #34, #41)", () => {
  it("HSCUSTOM follows an independent count of Ens_Config.SearchTableProp: none is notApplicable whatever the class, and no lookup is run there", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    // The oracle: a read-only count in the product's own namespace, written by hand, never the code under test.
    const counted = await atelierQuery({ ...TARGET, namespace: NS_HOME }, "SELECT COUNT(*) AS N FROM Ens_Config.SearchTableProp");
    const configured = Number(counted[0]?.["N"] ?? Number.NaN);
    expect(Number.isFinite(configured), "the count is a number").toBe(true);

    const filters = [filter("PatientID", "eq", `${MARKER}-MRN-1`)];
    if (configured === 0) {
      for (const searchTableClass of [ST, NO_SUCH_CLASS]) {
        const result = await lookup({ searchTableClass, filters }, NS_HOME);
        expect(result.isError, `${searchTableClass}: ${textOf(result)}`).toBeFalsy();
        expect(result.structuredContent, searchTableClass).toMatchObject({
          action: "searchTable",
          notApplicable: true,
          rows: [],
          hasMore: false,
          dataPolicy: { policy: "redact", redacted: 0, blocked: 0 },
        });
        const reason = String((result.structuredContent as { reason?: unknown }).reason);
        expect(reason, searchTableClass).toContain(`No Search Table is configured in namespace '${NS_HOME}'`);
        expect(reason, searchTableClass).toContain("Ens.Config.SearchTableProp is empty");
        expect(JSON.stringify(result), "no filter value in the answer").not.toContain(MARKER);

        // The route itself: Interoperability is enabled, no Search Table is configured, and nothing else is in the answer.
        const viaRoute = await route({ searchTableClass, filters }, NS_HOME);
        expect(viaRoute.status, viaRoute.text).toBe(200);
        expect(viaRoute.errors, searchTableClass).toEqual([]);
        expect(viaRoute.result, searchTableClass).toEqual({
          action: "searchTable",
          limit: 100,
          from: "2001-02-03 07:00:00",
          to: "2001-02-03 09:00:00",
          interopEnabled: true,
          searchTablesConfigured: false,
          rows: [],
          hasMore: false,
        });
        expect(viaRoute.text).not.toContain(MARKER);
      }
      // A shape error is still a shape error there: validation comes before the namespace is looked at.
      const noFilters = await route({ filters: [] }, NS_HOME);
      expect(noFilters.errors[0], "no filters").toContain("filters");
    } else {
      // HSCUSTOM is configured (another session compiled a Search Table class there), so it is not the namespace this
      // row needs: the row reports itself skipped rather than passing on a check that cannot test notApplicable, and
      // it sends no lookup into a configured namespace it does not own.
      // eslint-disable-next-line no-console
      console.log(`[SKIP] story-39-4-qa-live-gate: ${NS_HOME} holds ${configured} Search Table propert(ies), so it cannot show notApplicable`);
      testCtx.skip();
    }
  }, 120000);
});

// -- Filters combine with AND, each on its own entries ---------------------------------------------

/** The stored (lower-cased) forms the hand-written predicates compare with. */
const MRN = (n: number): string => `s.PropValue = 'synthphi394-mrn-${n}'`;

interface AndCase {
  name: string;
  filters: Array<Record<string, unknown>>;
  conditions: Condition[];
  /** The header IDs the oracle selects, in order, written by hand. */
  ids: number[];
}

/**
 * Fixture tau, by hand: header 2's message holds PID-3 `MRN-2~MRN-1`; headers 1 and 10 share message 1 (`ALT-1` in PID-2 and `MRN-1`
 * in PID-3); headers 3, 4 and 5 hold `MRN-3`, `MRN-4` and `MRN-5`; header 6 is not indexed.
 */
const AND_CASES: AndCase[] = [
  {
    name: "eq MRN-2 AND eq MRN-1 on the same property: header 2 holds both entries, so it is found",
    filters: [filter("PatientID", "eq", `${MARKER}-MRN-2`), filter("PatientID", "eq", `${MARKER}-MRN-1`)],
    conditions: [{ prop: "PatientID", predicate: MRN(2) }, { prop: "PatientID", predicate: MRN(1) }],
    ids: [2],
  },
  {
    name: "eq MRN-1 AND ne MRN-2: headers 1 and 10 have MRN-1 and no MRN-2; header 2 has both and is excluded",
    filters: [filter("PatientID", "eq", `${MARKER}-MRN-1`), filter("PatientID", "ne", `${MARKER}-MRN-2`)],
    conditions: [{ prop: "PatientID", predicate: MRN(1) }, { prop: "PatientID", predicate: MRN(2), negate: true }],
    ids: [1, 10],
  },
  {
    name: "startsWith MRN- AND ne MRN-1: only the messages with no MRN-1 entry are left",
    filters: [filter("PatientID", "startsWith", `${MARKER}-MRN-`), filter("PatientID", "ne", `${MARKER}-MRN-1`)],
    conditions: [
      { prop: "PatientID", predicate: "s.PropValue %STARTSWITH 'synthphi394-mrn-'" },
      { prop: "PatientID", predicate: MRN(1), negate: true },
    ],
    ids: [3, 4, 5],
  },
  {
    name: "notNull AND isNull on one property find nothing",
    filters: [filter("PatientID", "notNull"), filter("PatientID", "isNull")],
    conditions: [
      { prop: "PatientID", predicate: "s.PropValue <> ''" },
      { prop: "PatientID", predicate: "s.PropValue <> ''", negate: true },
    ],
    ids: [],
  },
  {
    name: "three conditions on three properties of two types (a string, a case-sensitive string and an integer)",
    filters: [filter("PatientID", "eq", `${MARKER}-MRN-1`), filter("MSHControlID", "startsWith", "Story394-CTL-"), filter("Story394Int", "eq", 7)],
    conditions: [
      { prop: "PatientID", predicate: MRN(1) },
      { prop: "MSHControlID", predicate: "s.PropValue %STARTSWITH 'Story394-CTL-'" },
      { prop: "Story394Int", predicate: "s.PropValue = '7'" },
    ],
    ids: [1, 10],
  },
];

describe("Story 39.4 QA: filters combine with AND, each on its own entries, also on one multi-valued property (AC-4; Rule #36)", () => {
  for (const andCase of AND_CASES) {
    it(andCase.name, async (testCtx) => {
      if (skipReason) return skip(testCtx);
      const expected = await oracle(andCase.conditions);
      expect(ids(expected), "the oracle selects the rows written by hand").toEqual(andCase.ids);

      const searchTableClass = andCase.filters.some((f) => f["property"] === "Story394Int") ? "Story394.SearchTable" : ST;
      const content = succeeded(await lookup({ searchTableClass, filters: andCase.filters }));
      expect(content.rows, "every field of every row, in order").toEqual(expected);
      expect(content.hasMore).toBe(false);

      const viaRoute = await route({ searchTableClass, filters: andCase.filters });
      expect(viaRoute.errors, viaRoute.text).toEqual([]);
      expect((viaRoute.result["rows"] as Array<{ id: number }>).map((row) => row.id), "the route says the same").toEqual(andCase.ids);
    }, 120000);
  }
});

// -- Every scope filter at once --------------------------------------------------------------------

/** The scope filters of the combined row, and the header conditions the oracle writes for them. */
const SCOPE = {
  item: "Story394.Source",
  source: "Story394.Source",
  target: "Story394.Target",
  status: "Completed",
  bodyClass: "EnsLib.HL7.Message",
} as const;
const SCOPE_SQL =
  " AND (h.SourceConfigName = 'Story394.Source' OR h.TargetConfigName = 'Story394.Source')" +
  " AND h.SourceConfigName = 'Story394.Source' AND h.TargetConfigName = 'Story394.Target' AND h.Status = 9";

describe("Story 39.4 QA: every scope filter at once, beside a Search Table filter, equals the oracle (AC-4; Rule #36)", () => {
  const notNull = [filter("PatientID", "notNull")];
  const entries: Condition[] = [{ prop: "PatientID", predicate: "s.PropValue <> ''" }];

  it("item, source, target, status and bodyClass together leave the Completed headers sent to Story394.Target (header 3 is an error to Story394.Other); a session ID narrows them to one", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const expected = await oracle(entries, SCOPE_SQL);
    expect(ids(expected), "the oracle selects the rows written by hand").toEqual([1, 2, 4, 5, 10]);
    const content = succeeded(await lookup({ filters: notNull, ...SCOPE }));
    expect(content.rows).toEqual(expected);

    const narrowed = await oracle(entries, `${SCOPE_SQL} AND h.SessionId = 394010`);
    expect(ids(narrowed)).toEqual([10]);
    expect(succeeded(await lookup({ filters: notNull, ...SCOPE, sessionId: 394010 })).rows).toEqual(narrowed);

    // The same lookup, errorOnly: every scope filter still holds and header 3 is outside the target, so nothing is left.
    expect(succeeded(await lookup({ filters: notNull, ...SCOPE, errorOnly: true })).rows, "errorOnly with the Completed target").toEqual([]);
  }, 120000);

  it("each scope filter bound on its own: a value that matches nothing empties the result, and the matching one keeps exactly its headers", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const probes: Array<{ name: string; scope: Record<string, unknown>; sql: string; ids: number[] }> = [
      { name: "item that is neither source nor target", scope: { item: "Story394.Nope" }, sql: " AND (h.SourceConfigName = 'Story394.Nope' OR h.TargetConfigName = 'Story394.Nope')", ids: [] },
      { name: "item that is the target of header 3 only", scope: { item: "Story394.Other" }, sql: " AND (h.SourceConfigName = 'Story394.Other' OR h.TargetConfigName = 'Story394.Other')", ids: [3] },
      { name: "source that is only a target", scope: { source: "Story394.Target" }, sql: " AND h.SourceConfigName = 'Story394.Target'", ids: [] },
      { name: "target Story394.Other", scope: { target: "Story394.Other" }, sql: " AND h.TargetConfigName = 'Story394.Other'", ids: [3] },
      { name: "status Errored", scope: { status: "Errored" }, sql: " AND h.Status = 8", ids: [3] },
      { name: "status Queued", scope: { status: "Queued" }, sql: " AND h.Status = 2", ids: [] },
      { name: "session 394002", scope: { sessionId: 394002 }, sql: " AND h.SessionId = 394002", ids: [2] },
      { name: "errorOnly", scope: { errorOnly: true }, sql: " AND h.IsError = 1", ids: [3] },
    ];
    for (const probe of probes) {
      const expected = await oracle(entries, probe.sql);
      expect(ids(expected), `${probe.name}: the oracle selects the rows written by hand`).toEqual(probe.ids);
      const content = succeeded(await lookup({ filters: notNull, ...probe.scope }));
      expect(content.rows, probe.name).toEqual(expected);
    }
  }, 120000);

  it("pages of 2 under every scope filter join, in order, without a gap or a duplicate (header, Search Table and cursor parameters in one argument list)", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const expected = await oracle(entries, SCOPE_SQL);
    expect(ids(expected)).toEqual([1, 2, 4, 5, 10]);

    const pages: Structured[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard += 1) {
      const page = succeeded(await lookup({ filters: notNull, ...SCOPE, limit: 2, ...(cursor === undefined ? {} : { cursor }) }));
      pages.push(page);
      if (!page.hasMore) break;
      expect(typeof page.nextCursor, `page ${pages.length} has more, so it carries nextCursor`).toBe("string");
      cursor = page.nextCursor;
    }

    expect(pages.map((page) => ids(page.rows))).toEqual([[1, 2], [4, 5], [10]]);
    expect(pages.flatMap((page) => page.rows)).toEqual(expected);
    const last = pages[pages.length - 1] as Structured;
    expect(last.hasMore).toBe(false);
    expect(last).not.toHaveProperty("nextCursor");
  }, 120000);
});
