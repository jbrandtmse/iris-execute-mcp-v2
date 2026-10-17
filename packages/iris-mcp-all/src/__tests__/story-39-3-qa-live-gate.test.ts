/**
 * Story 39.3 (QA) live gate: what the body search gate leaves open, on the REAL wire against one disposable
 * Interoperability namespace (`EXECMCPTMP393Q`), in the default suite (Rules #34, #36, #54, #59).
 *
 * Paths: the BUILT iris-interop-mcp dist over stdio for the tool rows; raw HTTP `POST`s to the search route for
 * the route rows and for the rows that must see the statement the route really prepared; the oracle is SQL
 * written by hand, joining `Ens.MessageHeader` to the body table, run through the raw Atelier `action/query`
 * route, never the code under test.
 *
 * Fixture: `Story393.QaBody` (compiled inside the namespace) holds a `%Date`, a `%Time`, a `%TimeStamp`, a text
 * property that holds numbers as text, a `%Numeric` and three kinds of stream. Four bodies, four headers, all on
 * 2001-02-03 UTC. The classes and the namespace are removed in `afterAll`, with nothing-left assertions.
 *
 * Rows:
 *  - value forms: a date and a time are compared as the day number and the seconds since midnight, a timestamp
 *    as its stored text, and a JSON number binds in IRIS canonical form; each equals the hand-written JOIN,
 *    and the ISO forms match nothing (each beside a positive control that the same property is searchable);
 *  - streams: `isNull` and `notNull` on a character, a binary and a legacy stream equal the JOIN, the engine
 *    itself refuses the other operators on a stream (SQLCODE -313), and the route refuses each of the eight
 *    naming `filters[0].op`;
 *  - the plan: every statement the route prepared in the namespace, read back from
 *    `INFORMATION_SCHEMA.STATEMENTS` after real calls, selects the twelve header columns and nothing of the
 *    body, reads `Ens.MessageHeader` first through `%INORDER`, and reads the body table by its ID.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the namespace and database `EXECMCPTMP393Q` and the HSCUSTOM class
 * `ExecuteMCPv2.Temp.Story391Fixture`. A missing or stale dist, an unresolvable SDK or an unreachable IRIS skips
 * each row with the reason, or fails with "may not be skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in
 * `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDeployedBootstrapVersion,
  atelierQuery,
  distEntry,
  docFixtures,
  firstText,
  fixtureDocumentNames,
  headerIds,
  irisTargetFromEnv,
  isIrisReachable,
  openWireSession,
  postEnvelope,
  resolveSdkEsmDir,
  skipTest,
  staleDistReason,
  teardownRecorder,
  type EnvelopeAnswer,
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
} from "./interop-namespace-fixture.js";
import { HEADER_COLUMNS, bodyJoinOracle, squash } from "./header-row-oracle.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const GATE_TAG = "story-39-3-qa-live-gate";

const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const NS_Q = "EXECMCPTMP393Q";
const BODY_CLASS = "Story393.QaBody";
const BODY_TABLE = '"Story393"."QaBody"';
/** Every value that must never appear in a result contains this marker. */
const MARKER = "SYNTHPHI393";

/** The window W: every header of the fixture. */
const FROM = "2001-02-03T07:00:00Z";
const TO = "2001-02-03T09:00:00Z";
const WINDOW_SQL = "h.TimeCreated >= '2001-02-03 07:00:00' AND h.TimeCreated <= '2001-02-03 09:00:00'";
const ROUTE = "/interop/message/search";

/** The body class: one property of each value form the property-kind table sends down the `value` branch, and three kinds of stream. */
const QA_BODY_SOURCE = String.raw`Class Story393.QaBody Extends Ens.Request
{

Property OnDate As %Date;

Property AtTime As %Time;

Property Seen As %TimeStamp;

Property Label As %String(MAXLEN = 64);

Property Price As %Numeric(SCALE = 2);

Property NoteChar As %Stream.GlobalCharacter;

Property NoteBin As %Stream.GlobalBinary;

Property NoteOld As %GlobalCharacterStream;

}
`;

/** Four bodies and four headers (1 to 4, bodies 1 to 4), in EXECMCPTMP393Q only. An argument left empty leaves its property NULL. */
const QA_SEED_SOURCE = String.raw`Class Story393.QaSeed
{

ClassMethod Seed() As %String
{
    If $NAMESPACE '= "EXECMCPTMP393Q" { Quit "REFUSED: Seed runs only in EXECMCPTMP393Q" }
    If $Order(^Ens.MessageHeaderD("")) '= "" { Quit "REFUSED: the namespace already holds message headers" }
    Set tBodies = ""
    Set tBodies = tBodies_$ListBuild(..NewBody($ZDATEH("2001-02-03", 3), $ZTIMEH("08:00:00"), "2001-02-03 08:00:00", "0.5", 0.5, "n1 SYNTHPHI393", "b1", ""))
    Set tBodies = tBodies_$ListBuild(..NewBody($ZDATEH("2001-02-04", 3), $ZTIMEH("12:30:00"), "2001-02-03 12:30:00", ".5", 1.25, "", "", "o2"))
    Set tBodies = tBodies_$ListBuild(..NewBody($ZDATEH("2001-02-02", 3), $ZTIMEH("00:00:00"), "2001-02-03 00:00:00", "1", 2, "", "b3", ""))
    Set tBodies = tBodies_$ListBuild(..NewBody("", "", "", "", "", "n4", "", ""))
    Set tIds = ""
    For tI = 1:1:4 {
        Set tBody = $List(tBodies, tI)
        If $Extract(tBody, 1, 6) = "ERROR:" { Quit }
        Set tId = ##class(ExecuteMCPv2.Temp.Story391Fixture).Add(393100 + tI, 1, 9, 0, "Story393.QaSource", "Story393.QaTarget", "Story393.QaBody", tBody, "2001-02-03 08:00:0" _ (tI - 1))
        If $Extract(tId, 1, 6) = "ERROR:" { Quit }
        Set tIds = tIds _ $Select(tIds = "": "", 1: ",") _ tId
    }
    If $Length(tIds, ",") '= 4 { Quit "FAILED: " _ tIds _ " " _ $Get(tBody) _ " " _ $Get(tId) }
    Quit {"headers":(tIds),"body":($ListToString(tBodies))}.%ToJSON()
}

/// Save one body; an argument that is the empty string leaves its property NULL. Returns the ID or the error text.
ClassMethod NewBody(pDate, pTime, pStamp, pLabel, pPrice, pChar, pBin, pOld) As %String
{
    Set tObj = ##class(Story393.QaBody).%New()
    If pDate '= "" { Set tObj.OnDate = pDate }
    If pTime '= "" { Set tObj.AtTime = pTime }
    If pStamp '= "" { Set tObj.Seen = pStamp }
    If pLabel '= "" { Set tObj.Label = pLabel }
    If pPrice '= "" { Set tObj.Price = pPrice }
    If pChar '= "" { Do tObj.NoteChar.Write(pChar) }
    If pBin '= "" { Do tObj.NoteBin.Write(pBin) }
    If pOld '= "" { Do tObj.NoteOld.Write(pOld) }
    Set tSC = tObj.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: " _ $System.Status.GetErrorText(tSC) }
    Quit tObj.%Id()
}

}
`;

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
/** The built interop server under default configuration (no data-policy setting: `redact`). */
let interop: WireSession;

function wireOptions(pkg: string): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "story-39-3-qa-live-gate",
  };
}

const filter = (property: string, op: string, value?: string | number | boolean): Record<string, unknown> =>
  value === undefined ? { property, op } : { property, op, value };

/** The target of the namespace under test. */
const QTARGET = { ...TARGET, namespace: NS_Q };

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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 39.3 QA live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  const started = performance.now();
  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  const firstStartMs = Math.round(performance.now() - started);
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  // eslint-disable-next-line no-console
  console.log(`[PERF] story-39-3-qa: first start ${firstStartMs} ms`);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  interop = await openWireSession(wireOptions("iris-interop-mcp"));
  await putFixtureClass(dev);
  await removeInteropNamespace(admin, dev, NS_Q);
  expect(await leftovers(dev, [NS_Q]), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS_Q, { interop: true });
  const docs = docFixtures(dev, NS_Q);
  for (const [doc, source] of [
    ["Story393.QaBody.cls", QA_BODY_SOURCE],
    ["Story393.QaSeed.cls", QA_SEED_SOURCE],
  ] as const) {
    await docs.putDoc(doc, source);
    await docs.compileDoc(doc);
  }
  const seeded = await dev.call("iris_execute_classmethod", {
    namespace: NS_Q,
    className: "Story393.QaSeed",
    methodName: "Seed",
    args: [],
  });
  expect(seeded.isError, firstText(seeded)).toBeFalsy();
  expect(JSON.parse(String((seeded.structuredContent as { returnValue?: unknown }).returnValue ?? ""))).toEqual({
    headers: "1,2,3,4",
    body: "1,2,3,4",
  });

  // A positive control: the same check that must read empty after the run sees the namespace now.
  expect(await leftovers(dev, [NS_Q]), "the leftovers check sees the namespace while it exists").toEqual(
    expect.arrayContaining([`namespace ${NS_Q}`, `database configuration ${NS_Q}`]),
  );
}, 300000);

afterAll(async () => {
  if (skipReason) return;
  // Every step runs even when an earlier one failed, so one bad removal cannot leave the others behind.
  const { problems, attempt } = teardownRecorder();
  try {
    await attempt(`removing ${NS_Q}`, () => removeInteropNamespace(admin, dev, NS_Q));
    await attempt("the leftovers check", async () => {
      expect(await leftovers(dev, [NS_Q]), "no fixture namespace after the run").toEqual([]);
    });
    await attempt("removing the fixture class", () => removeFixtureClass(dev));
    await attempt("the fixture document listing", async () => {
      for (const { filter: filterText, names } of await fixtureDocumentNames(dev, ["Story391", "Story393"])) {
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

type Structured = Record<string, unknown> & { rows: Array<Record<string, unknown>>; hasMore: boolean };

/** A body search of the fixture over window W through the built interop server. */
function bodySearch(filters: Array<Record<string, unknown>>, args: Record<string, unknown> = {}): Promise<WireToolResult> {
  return interop.call("iris_message_search", {
    action: "body",
    namespace: NS_Q,
    from: FROM,
    to: TO,
    bodyClass: BODY_CLASS,
    filters,
    ...args,
  });
}

/** The structured content of a successful body result, which must hold no body value. */
function succeeded(result: WireToolResult): Structured {
  expect(result.isError, firstText(result)).toBeFalsy();
  expect(JSON.stringify(result), "a body result holds no body value").not.toContain(MARKER);
  return result.structuredContent as Structured;
}

/** The hand-written JOIN oracle over window W for the fixture's body table. */
const joinOracle = (predicate: string): Promise<Array<Record<string, unknown>>> =>
  bodyJoinOracle(TARGET, NS_Q, BODY_TABLE, BODY_CLASS, WINDOW_SQL, predicate);

/** POST a body search of the fixture straight to the route, assert HTTP 200, and parse the envelope. */
async function route(filters: unknown, extra: Record<string, unknown> = {}): Promise<EnvelopeAnswer> {
  const answer = await postEnvelope(TARGET, ROUTE, {
    action: "body",
    namespace: NS_Q,
    from: FROM,
    to: TO,
    bodyClass: BODY_CLASS,
    filters,
    ...extra,
  });
  expect(answer.status).toBe(200);
  return answer;
}

// -- Value forms -----------------------------------------------------------------

interface ValueCase {
  name: string;
  filters: Array<Record<string, unknown>>;
  /** The oracle's predicate on `b`, written by hand with literals in IRIS logical form. */
  predicate: string;
  /** The header IDs the oracle selects, in order, written by hand (header n reads body n). */
  ids: number[];
}

/**
 * Day numbers are `$ZDATEH(date, 3)`: 2001-02-02 58472, 2001-02-03 58473, 2001-02-04 58474. Seconds since
 * midnight are `$ZTIMEH`: 08:00:00 28800, 12:30:00 45000, 00:00:00 0. The seed derives them with `$ZDATEH` and
 * `$ZTIMEH`; the literals below are the raw Atelier answer for the stored rows (captured 2026-10-17 on IRIS 2026.2
 * Build 221U: `SELECT ID, OnDate, AtTime FROM Story393.QaBody` -> 58473/28800, 58474/45000, 58472/0, NULL/NULL).
 */
const VALUE_CASES: ValueCase[] = [
  { name: "date: the day number matches (control for the ISO form)", filters: [filter("OnDate", "eq", 58473)], predicate: "b.OnDate = 58473", ids: [1] },
  { name: "date: gt compares day numbers", filters: [filter("OnDate", "gt", 58473)], predicate: "b.OnDate > 58473", ids: [2] },
  { name: "date: lt compares day numbers", filters: [filter("OnDate", "lt", 58473)], predicate: "b.OnDate < 58473", ids: [3] },
  { name: "date: an ISO date matches nothing", filters: [filter("OnDate", "eq", "2001-02-03")], predicate: "b.OnDate = '2001-02-03'", ids: [] },
  { name: "time: the seconds since midnight match (control for the ISO form)", filters: [filter("AtTime", "eq", 28800)], predicate: "b.AtTime = 28800", ids: [1] },
  { name: "time: midnight (0) matches and a NULL time does not", filters: [filter("AtTime", "eq", 0)], predicate: "b.AtTime = 0", ids: [3] },
  { name: "time: isNull", filters: [filter("AtTime", "isNull")], predicate: "b.AtTime IS NULL", ids: [4] },
  { name: "time: gt compares as a number (as text 28800 would sort below 9999)", filters: [filter("AtTime", "gt", 9999)], predicate: "b.AtTime > 9999", ids: [1, 2] },
  { name: "time: an ISO time matches nothing", filters: [filter("AtTime", "eq", "08:00:00")], predicate: "b.AtTime = '08:00:00'", ids: [] },
  { name: "timestamp: the stored text matches (control for the ISO T form)", filters: [filter("Seen", "eq", "2001-02-03 08:00:00")], predicate: "b.Seen = '2001-02-03 08:00:00'", ids: [1] },
  { name: "timestamp: an ISO T form matches nothing", filters: [filter("Seen", "eq", "2001-02-03T08:00:00Z")], predicate: "b.Seen = '2001-02-03T08:00:00Z'", ids: [] },
  { name: "timestamp: startsWith the date part", filters: [filter("Seen", "startsWith", "2001-02-03 ")], predicate: "b.Seen %STARTSWITH '2001-02-03 '", ids: [1, 2, 3] },
  { name: "timestamp: contains the time part", filters: [filter("Seen", "contains", "12:30")], predicate: "b.Seen [ '12:30'", ids: [2] },
  { name: "timestamp: lt compares the stored text", filters: [filter("Seen", "lt", "2001-02-03 09:00:00")], predicate: "b.Seen < '2001-02-03 09:00:00'", ids: [1, 3] },
  { name: "text: a string is bound as given (control for the number form)", filters: [filter("Label", "eq", "0.5")], predicate: "b.Label = '0.5'", ids: [1] },
  { name: "text: the JSON number 0.5 binds in canonical form, .5", filters: [filter("Label", "eq", 0.5)], predicate: "b.Label = '.5'", ids: [2] },
  { name: "text: the JSON number 1 binds as 1", filters: [filter("Label", "eq", 1)], predicate: "b.Label = '1'", ids: [3] },
  { name: "text: a boolean binds as 1 or 0", filters: [filter("Label", "eq", true)], predicate: "b.Label = '1'", ids: [3] },
  { name: "numeric: a JSON number compares as a number", filters: [filter("Price", "eq", 0.5)], predicate: "b.Price = 0.5", ids: [1] },
  { name: "numeric: gt", filters: [filter("Price", "gt", 1)], predicate: "b.Price > 1", ids: [2, 3] },
  { name: "numeric: le", filters: [filter("Price", "le", 1.25)], predicate: "b.Price <= 1.25", ids: [1, 2] },
];

describe("Story 39.3 QA: the value forms of date, time, timestamp and number properties equal a hand-written JOIN (Rules #34, #36, #59)", () => {
  it("the fixture holds the day numbers and seconds the cases are written against", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const rows = await atelierQuery(QTARGET, "SELECT ID, OnDate, AtTime FROM Story393.QaBody ORDER BY ID");
    expect(rows.map((row) => [row["ID"], row["OnDate"], row["AtTime"]])).toEqual([
      [1, "58473", "28800"],
      [2, "58474", "45000"],
      [3, "58472", "0"],
      [4, "", ""],
    ]);
  }, 120000);

  for (const valueCase of VALUE_CASES) {
    it(valueCase.name, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      const expected = await joinOracle(valueCase.predicate);
      expect(headerIds(expected), "the oracle selects the rows written by hand").toEqual(valueCase.ids);

      const content = succeeded(await bodySearch(valueCase.filters));

      expect(content.rows, "every field of every row, in order").toEqual(expected);
      expect(content.hasMore).toBe(false);
    }, 120000);
  }

  it("the three ISO forms that match nothing are each paired with a control that matches, so an empty answer is not a dead search", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const empty = VALUE_CASES.filter((valueCase) => valueCase.ids.length === 0);
    expect(empty.map((valueCase) => valueCase.filters[0]?.["property"])).toEqual(["OnDate", "AtTime", "Seen"]);
    for (const emptyCase of empty) {
      const property = emptyCase.filters[0]?.["property"];
      const control = VALUE_CASES.find((valueCase) => valueCase.ids.length > 0 && valueCase.filters[0]?.["property"] === property);
      expect(control, `a control for ${String(property)}`).toBeDefined();
      expect(headerIds(succeeded(await bodySearch((control as ValueCase).filters)).rows).length, `the control for ${String(property)}`).toBeGreaterThan(0);
    }
  }, 120000);
});

// -- Streams ---------------------------------------------------------------------

describe("Story 39.3 QA: a stream accepts isNull and notNull only, whatever its kind (Rules #34, #54)", () => {
  const STREAMS: Array<{ property: string; kind: string; withData: number[] }> = [
    { property: "NoteChar", kind: "%Stream.GlobalCharacter", withData: [1, 4] },
    { property: "NoteBin", kind: "%Stream.GlobalBinary", withData: [1, 3] },
    { property: "NoteOld", kind: "%GlobalCharacterStream", withData: [2] },
  ];
  const OTHER_OPS = ["eq", "ne", "lt", "le", "gt", "ge", "contains", "startsWith"] as const;

  for (const stream of STREAMS) {
    it(`${stream.property} (${stream.kind}): notNull and isNull equal the JOIN`, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      const without = [1, 2, 3, 4].filter((id) => !stream.withData.includes(id));
      for (const [op, sqlOp, expectedIds] of [
        ["notNull", "IS NOT NULL", stream.withData],
        ["isNull", "IS NULL", without],
      ] as const) {
        const expected = await joinOracle(`b.${stream.property} ${sqlOp}`);
        expect(headerIds(expected), `${op}: the oracle selects the rows written by hand`).toEqual(expectedIds);
        expect(succeeded(await bodySearch([filter(stream.property, op)])).rows, op).toEqual(expected);
      }
    }, 120000);

    it(`${stream.property}: the engine itself refuses a comparison on it, and the route refuses all eight other operators naming filters[0].op`, async (testCtx) => {
      if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
      // The refusal is not arbitrary: the engine answers SQLCODE -313 for a stream operand (Task 0 (e) for the character stream).
      for (const sql of [
        `SELECT ID FROM Story393.QaBody WHERE ${stream.property} = 'x'`,
        `SELECT ID FROM Story393.QaBody WHERE ${stream.property} [ 'x'`,
      ]) {
        await expect(atelierQuery(QTARGET, sql), sql).rejects.toThrow(/-313/);
      }
      for (const op of OTHER_OPS) {
        const answer = await route([filter(stream.property, op, MARKER)]);
        expect(answer.errors.length, `${op}: ${answer.text}`).toBe(1);
        expect(answer.errors[0], op).toContain("filters[0].op");
        expect(answer.text, `${op}: the refusal does not echo the value`).not.toContain(MARKER);
        expect(answer.result, `${op}: a refusal returns an empty result`).toEqual({});
      }
      const tool = await bodySearch([filter(stream.property, "contains", MARKER)]);
      expect(tool.isError).toBe(true);
      expect(firstText(tool)).toContain("filters[0].op");
      expect(JSON.stringify(tool)).not.toContain(MARKER);
    }, 120000);
  }
});

// -- The plan ----------------------------------------------------------------------

/**
 * What is wrong with a body-search statement as the statement index stores it and with its plan: the select list
 * is exactly the header columns, the header table is read first through `%INORDER` and the body table is joined on
 * the header's body ID, and the plan reads the header's master map before the body's, the body by the given ID.
 * The plan lines are the wording of IRIS 2026.2 (Build 221U); another build that words them differently is a
 * re-capture of these two patterns, not a regression.
 */
function planProblems(statement: string, plan: string): string[] {
  const problems: string[] = [];
  const text = squash(statement);
  const head = squash(`SELECT TOP ? ${HEADER_COLUMNS} FROM %INORDER Ens.MessageHeader h, ${BODY_TABLE} b WHERE h.MessageBodyId = b.%ID AND`);
  if (!text.includes(head)) problems.push("the select list is not exactly the header columns read first through %INORDER with the body joined on the body ID");
  const selectList = text.split("FROM%INORDER")[0] ?? "";
  if (selectList.includes("B.")) problems.push("the select list names the body alias");
  const lines = plan.split(/\r?\n/).map((line) => line.trim());
  const header = lines.findIndex((line) => /^Read master map Ens\.MessageHeader\(H\)\.IDKEY/.test(line));
  const body = lines.findIndex((line) => /^Read master map Story393\.QaBody\(B\)\.IDKEY, using the given idkey value/.test(line));
  if (header < 0) problems.push("the plan does not read the header master map");
  if (body < 0) problems.push("the plan does not read the body master map by the given ID");
  if (header >= 0 && body >= 0 && header > body) problems.push("the plan reads the body before the header");
  if (lines.some((line) => /^Read master map Story393\.QaBody\(B\)\.IDKEY, looping/.test(line))) problems.push("the plan scans the body table");
  return problems;
}

describe("Story 39.3 QA: the statements the route prepared read the headers first and each body by its ID (Rules #19, #59)", () => {
  interface Call {
    name: string;
    filters: Array<Record<string, unknown>>;
    extra?: Record<string, unknown>;
    /** A fragment of the body predicate the statement must hold, as written before the index normalizes it. */
    fragment: string;
  }

  const CALLS: Call[] = [
    { name: "text eq", filters: [filter("Label", "eq", "0.5")], fragment: 'b."Label" = ?' },
    { name: "numeric gt", filters: [filter("Price", "gt", 1)], fragment: 'b."Price" > ?' },
    { name: "timestamp startsWith", filters: [filter("Seen", "startsWith", "2001-02-03 ")], fragment: 'b."Seen" %STARTSWITH ?' },
    { name: "date lt", filters: [filter("OnDate", "lt", 58473)], fragment: 'b."OnDate" < ?' },
    { name: "stream isNull", filters: [filter("NoteChar", "isNull")], fragment: 'b."NoteChar" IS NULL' },
    { name: "two filters", filters: [filter("Label", "ne", "x"), filter("AtTime", "ge", 0)], fragment: 'b."Label" <> ? AND b."AtTime" >= ?' },
    {
      name: "a page after a cursor",
      filters: [filter("Price", "ge", 0)],
      extra: { afterTimeCreated: "2001-02-03 08:00:00", afterId: 1 },
      fragment: 'b."Price" >= ? AND (h.TimeCreated > ? OR (h.TimeCreated = ? AND h.ID > ?))',
    },
  ];

  it("the checker can fail: a statement that selects a body column, or does not read the headers first, is reported", (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const good = squash(`SELECT TOP ? ${HEADER_COLUMNS} FROM %INORDER Ens.MessageHeader h, ${BODY_TABLE} b WHERE h.MessageBodyId = b.%ID AND b."Label" = ?`);
    const goodPlan = "Read master map Ens.MessageHeader(H).IDKEY, using the given idkey value.\nRead master map Story393.QaBody(B).IDKEY, using the given idkey value.";
    expect(planProblems(good, goodPlan), "a well-formed statement and plan").toEqual([]);

    const withBodyColumn = good.replace("H.ID,", 'H.ID,B."LABEL",');
    expect(planProblems(withBodyColumn, goodPlan).length, "a body column in the select list").toBeGreaterThan(0);
    const withoutInorder = good.replace("%INORDER", "");
    expect(planProblems(withoutInorder, goodPlan).length, "no %INORDER").toBeGreaterThan(0);
    const bodyFirst = "Read master map Story393.QaBody(B).IDKEY, using the given idkey value.\nRead master map Ens.MessageHeader(H).IDKEY, using the given idkey value.";
    expect(planProblems(good, bodyFirst).length, "the body read before the header").toBeGreaterThan(0);
    const scan = `${goodPlan}\nRead master map Story393.QaBody(B).IDKEY, looping on B.ID.`;
    expect(planProblems(good, scan).length, "a scan of the body table").toBeGreaterThan(0);
  });

  it("after real calls, every route statement for the body table has the header-first plan, and each call's own statement is among them", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const call of CALLS) {
      const answer = await route(call.filters, call.extra ?? {});
      expect(answer.errors, `${call.name}: ${answer.text}`).toEqual([]);
    }
    // One call through the built server too, so the plan is read for a statement the tool's request produced.
    succeeded(await bodySearch([filter("Label", "contains", "5")]));

    const stored = await atelierQuery(QTARGET, "SELECT Statement, Plan FROM INFORMATION_SCHEMA.STATEMENTS WHERE Statement [ 'QABODY'");
    // The route's statements, told from the oracle's own queries by their select list: TOP ?, then the header columns.
    const routeStatements = stored.filter((row) => squash(String(row["Statement"])).includes("SELECTTOP?H.ID,"));
    expect(routeStatements.length, "the index holds a statement for each distinct call").toBeGreaterThanOrEqual(CALLS.length + 1);

    for (const row of routeStatements) {
      expect(planProblems(String(row["Statement"]), String(row["Plan"])), String(row["Statement"])).toEqual([]);
    }
    for (const call of CALLS) {
      const mine = routeStatements.filter((row) => squash(String(row["Statement"])).includes(squash(call.fragment)));
      expect(mine.length, `${call.name}: the index holds the statement of this call (${call.fragment})`).toBeGreaterThanOrEqual(1);
    }
  }, 120000);
});
