/**
 * Story 40.0 (QA) live gate: what the burn-down gate leaves open, on the REAL wire, in the default suite (Rules #34,
 * #36, #41, #46, #54, #59).
 *
 * Paths: the BUILT iris-dev-mcp, iris-admin-mcp, iris-interop-mcp and iris-ops-mcp dists over stdio for the tool
 * rows; raw HTTP `GET`s to the Event Log route for the route rows; a second session on the BUILT iris-interop-mcp entry
 * (`openWireSession`, its own spawned process with a real SDK `Client` over stdio) for the prompt row. The oracles are
 * SQL written by hand and run through the raw Atelier `action/query` route (never the tools under test), and the
 * construction of the seed itself: every row's time is the seed's own `$ZTimeStamp` plus a whole number of seconds,
 * never `UtcCutoff`.
 *
 * Rows:
 *  - DW-584, the window boundary on the wire (the tools, ops server): an Error row 2 minutes inside 24 hours is
 *    counted and one 2 minutes outside is not, a Warning inside is not, and the same holds for headers; a hand-written
 *    SQL cross-check with `DATEADD('hh', -24, GETUTCDATE())` agrees. A header exactly on the boundary is not required.
 *    The window rows are moved to a fresh T0 by that describe's own `beforeAll` (`Story40Q.Seed.Retime`), so they hold
 *    wherever the describe runs in the file.
 *  - DW-585, the route edges over real HTTP (raw route, namespace Q): every value that is not exactly a display name
 *    passes through (lower-case, upper-case, padded, a lone space, out-of-range numbers, a list, an injection string)
 *    and matches what the same SQL literal selects, which is no row; a numeric form IRIS SQL reads as the number 2
 *    (`02`, `2.0`, `+2`) selects the Error rows; an empty `type` is no filter; `count` applies after the type
 *    filter, newest first, against hand-written `SELECT TOP n`, and a count that is not a positive number, or is far
 *    above the rows, returns every filtered row; the built interop server turns an invalid `type` away before any
 *    request.
 *  - Not configured, the other way round (Rules #34, #41): R maps the Interoperability packages but holds no Event Log
 *    row and no header, so the counts are 0 with no error and the log queries answer an empty list, not an error.
 *  - The `trace-message-flow` prompt through the REAL spawned interop entry over stdio with a real SDK `Client`
 *    (the 39.6 wire test registers the built prompts on a replica server over an in-memory pair): the three step
 *    texts of Story 40.0, written here from the spec, reach a client; `arguments` omitted is a clean InvalidParams;
 *    the connection stays usable.
 *
 * Fixtures: two scratch namespaces that map the Interoperability packages, `EXECMCPTMP400Q` (13 Event Log rows and 2
 * headers, seeded by `Story40Q.Seed`, which reuses `Story400.Seed.Shift`/`SaveLog` and `Story391Fixture.Add`) and
 * `EXECMCPTMP400R` (nothing seeded), named after the story like the other QA gates' `EXECMCPTMP<story>Q`; neither
 * collides with the burn-down gate's `EXECMCPTMP400A`/`EXECMCPTMP400B`. No
 * production is started, `EnableNamespace` is never called, and no message or Event Log row of HSCUSTOM is read.
 * `beforeAll` removes leftovers by name and asserts there are none; `afterAll` removes both namespaces, their database
 * files and the fixture class, and asserts nothing is left.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (defaults: localhost:52773,
 * `_SYSTEM`, HSCUSTOM). Writes only the namespaces and databases `EXECMCPTMP400Q` and `EXECMCPTMP400R` and the HSCUSTOM
 * class `ExecuteMCPv2.Temp.Story391Fixture`. A missing or stale dist, an unresolvable SDK or an unreachable IRIS skips
 * each row with the reason, or fails with "may not be skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in
 * `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  allText,
  assertDeployedBootstrapVersion,
  atelierQuery,
  distEntry,
  docFixtures,
  fixtureDocumentNames,
  irisTargetFromEnv,
  isIrisReachable,
  openWireSession,
  rawIrisRequest,
  resolveSdkEsmDir,
  skipTest,
  staleDistReason,
  teardownRecorder,
  type WirePromptRequest,
  type WireSession,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";
import {
  FIXTURE_DOC,
  STORY400_DOCUMENTS,
  createInteropNamespace,
  leftovers,
  putFixtureClass,
  removeFixtureClass,
  removeInteropNamespace,
} from "./interop-namespace-fixture.js";
import { eventLogOracle } from "./header-row-oracle.js";
import { stepsOf } from "./prompt-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

const GATE_TAG = "story-40-0-qa-live-gate";
const TARGET = irisTargetFromEnv();
const REQUIRE_LIVE = process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

/** The seeded scratch namespace Q and the mapped, empty one R. */
const NS_Q = "EXECMCPTMP400Q";
const NS_R = "EXECMCPTMP400R";
const NAMESPACES = [NS_Q, NS_R];

/** The seed class compiled inside Q, after `Story400.Seed` (whose `Shift` and `SaveLog` it calls). */
const QA_SEED_DOC = "Story40Q.Seed.cls";
const QA_SEED_SOURCE = String.raw`Class Story40Q.Seed
{

/// Seed the QA fixture into the current namespace, which must be an empty EXECMCPTMP400 scratch namespace named with one capital letter.
/// Every time is the seed's own $ZTimeStamp plus whole seconds (Story400.Seed:Shift); no cutoff helper of the product is used.
/// Returns the JSON ID map {"logs":"1,...,13","headers":"1,2"}, or the first error text.
ClassMethod Seed() As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP400"1U { Quit "REFUSED: Seed runs only in a namespace named EXECMCPTMP400 followed by one capital letter" }
    If $Order(^Ens.MessageHeaderD("")) '= "" { Quit "REFUSED: the namespace already holds message headers" }
    If $Order(^Ens.Util.LogD("")) '= "" { Quit "REFUSED: the namespace already holds Event Log rows" }
    Set tNow = $ZTimeStamp
    Set tHour = ##class(Story400.Seed).Shift(tNow, -3600)
    Set tInside = ##class(Story400.Seed).Shift(tNow, -86280)
    Set tOutside = ##class(Story400.Seed).Shift(tNow, -86520)
    Set tL = ""
    For tType = 1:1:6 {
        Set tL = tL_$ListBuild(##class(Story400.Seed).SaveLog(tType, "Story40Q.Item", tType, tHour))
    }
    Set tL = tL_$ListBuild(##class(Story400.Seed).SaveLog(2, "Story40Q.Item", 7, tHour))
    Set tL = tL_$ListBuild(##class(Story400.Seed).SaveLog(2, "Story40Q.Other", 8, tHour))
    Set tL = tL_$ListBuild(##class(Story400.Seed).SaveLog(3, "Story40Q.Item", 9, tHour))
    Set tL = tL_$ListBuild(##class(Story400.Seed).SaveLog(2, "Story40Q.Item", 10, tHour))
    Set tL = tL_$ListBuild(##class(Story400.Seed).SaveLog(2, "Story40Q.Window", 11, tInside))
    Set tL = tL_$ListBuild(##class(Story400.Seed).SaveLog(2, "Story40Q.Window", 12, tOutside))
    Set tL = tL_$ListBuild(##class(Story400.Seed).SaveLog(3, "Story40Q.Window", 13, tInside))
    Set tError = ##class(Story400.Seed).FirstError(tL, 13)
    If tError '= "" { Quit tError }
    Set tH = ""
    Set tH = tH_$ListBuild(##class(ExecuteMCPv2.Temp.Story391Fixture).Add(40001, 1, 9, 0, "Story40Q.Service", "Story40Q.Operation", "", "", tInside))
    Set tH = tH_$ListBuild(##class(ExecuteMCPv2.Temp.Story391Fixture).Add(40001, 1, 9, 0, "Story40Q.Service", "Story40Q.Operation", "", "", tOutside))
    Set tError = ##class(Story400.Seed).FirstError(tH, 2)
    If tError '= "" { Quit tError }
    Quit {"logs":($ListToString(tL)),"headers":($ListToString(tH))}.%ToJSON()
}

/// Move the window rows to their offsets from a new T0, the current $ZTimeStamp: Event Log 1 one hour back (the
/// anchor of the minute check), Event Log 11 and 13 and header 1 23 h 58 min back, Event Log 12 and header 2
/// 24 h 02 min back. Returns "OK", or the first error text.
ClassMethod Retime() As %String
{
    If $NAMESPACE '? 1"EXECMCPTMP400"1U { Quit "REFUSED: Retime runs only in a namespace named EXECMCPTMP400 followed by one capital letter" }
    Set tNow = $ZTimeStamp
    Set tHour = ##class(Story400.Seed).Shift(tNow, -3600)
    Set tInside = ##class(Story400.Seed).Shift(tNow, -86280)
    Set tOutside = ##class(Story400.Seed).Shift(tNow, -86520)
    Set tL = $ListBuild(..LogTime(1, tHour), ..LogTime(11, tInside), ..LogTime(12, tOutside), ..LogTime(13, tInside), ..HeaderTime(1, tInside), ..HeaderTime(2, tOutside))
    Set tError = ##class(Story400.Seed).FirstError(tL, 6)
    If tError '= "" { Quit tError }
    Quit "OK"
}

/// Set the TimeLogged of Event Log row pId to pTime and return pId, or the error text.
ClassMethod LogTime(pId As %Integer, pTime As %String) As %String
{
    Set tLog = ##class(Ens.Util.Log).%OpenId(pId)
    If '$IsObject(tLog) { Quit "ERROR: no Event Log row "_pId }
    Set tLog.TimeLogged = pTime
    Set tSC = tLog.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit pId
}

/// Set the TimeCreated of header pId to pTime and return pId, or the error text.
ClassMethod HeaderTime(pId As %Integer, pTime As %String) As %String
{
    Set tHeader = ##class(Ens.MessageHeader).%OpenId(pId)
    If '$IsObject(tHeader) { Quit "ERROR: no header "_pId }
    Set tHeader.TimeCreated = pTime
    Set tSC = tHeader.%Save()
    If $System.Status.IsError(tSC) { Quit "ERROR: "_$System.Status.GetErrorText(tSC) }
    Quit pId
}

}
`;

/**
 * What Q holds, written out from the seed above (type by ID: 1 to 6 are types 1 to 6; 7, 8, 10, 11 and 12 are Error;
 * 9 and 13 are Warning). IDs 1 to 10 are an hour old; 11 and 13 are 23 h 58 min old (inside the window), 12 is
 * 24 h 02 min old (outside it), as of the last `Retime`. Items: 8 is Story40Q.Other, 11 to 13 are Story40Q.Window,
 * the rest Story40Q.Item.
 */
const ALL_IDS = [13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
const ERROR_IDS = [12, 11, 10, 8, 7, 2];

/** Seconds the seed and `Retime` move the window rows back from their T0: 23 h 58 min inside, 24 h 02 min outside. */
const INSIDE_SECONDS = 86280;
const OUTSIDE_SECONDS = 86520;
/** The most the call may come after `Retime`: a quarter of the 2-minute margin, so a slow host fails loudly, not wrongly. */
const MAX_SEED_TO_CALL_MS = 30000;

const LOGS_ROUTE = "/api/executemcp/v2/interop/production/logs";

/** The rendered text Story 40.0 added to steps 4, 5 and 6 of `trace-message-flow`, written here from the spec (Task 5). */
const STEP4_SENTENCE =
  "Under the `block` data policy the text of each `Error on message` warning, in `warnings` and on its `%%` line of the diagram, is replaced by a reason: report that reason to the user, and never read the error text another way (for example through SQL, global or document tools).";
const STEP5_SENTENCE =
  "Under `block` each entry's `text` is withheld and its `textPolicy` gives the reason: report that reason to the user, and never read the log text another way (for example through SQL, global or document tools).";
const STEP6_CLAUSE =
  "what the error log says (where the log or diagram text was withheld, say so and give its reason instead of the text), and where";

const INVALID_PARAMS = -32602;

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let dev: WireSession;
let admin: WireSession;
let interop: WireSession;
let ops: WireSession;
/** When the window rows of Q were last moved to a fresh T0 (wall clock), for the window row's drift guard. */
let seededAt = 0;

function wireOptions(pkg: string): WireSessionOptions {
  return {
    sdkEsmDir: sdkEsmDir as string,
    entry: distEntry(REPO_ROOT, pkg),
    target: TARGET,
    clientName: "story-40-0-qa-live-gate",
  };
}

/** The target of the raw Atelier oracle in the scratch namespace `namespace`. */
const oracleTarget = (namespace: string): typeof TARGET => ({ ...TARGET, namespace });

type Row = Record<string, unknown>;

interface LogsContent {
  entries: Row[];
  count: number;
}

interface MetricsContent {
  namespaces: Array<{
    namespace: string;
    productionName: string;
    productionState: string;
    queueDepth: number;
    errorCount24h: number;
    messageCount24h: number;
  }>;
  count: number;
}

/** The parsed structured content of a successful call: no error. */
function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

const idsOf = (rows: Row[]): number[] => rows.map((row) => Number(row["id"]));

/** The raw route's answer for a query string over `namespace`: its HTTP status, error list and `result`. */
async function rawLogs(namespace: string, query: string): Promise<{ status: number; errors: unknown[]; result: LogsContent }> {
  const answer = await rawIrisRequest(TARGET, `${LOGS_ROUTE}?namespace=${namespace}&${query}`, { method: "GET" });
  const body = answer.json as { status?: { errors?: unknown[] }; result?: LogsContent };
  return { status: answer.status, errors: body?.status?.errors ?? [], result: body?.result as LogsContent };
}

/** `iris_production_logs` over `namespace` through the built interop server. */
function productionLogs(namespace: string, args: Record<string, unknown>): Promise<WireToolResult> {
  return interop.call("iris_production_logs", { namespace, ...args });
}

/** The IDs `SELECT TOP n ID ... WHERE <where> ORDER BY ID DESC` selects in Q: the hand-written oracle of `count`. */
async function topIds(top: number | undefined, where: string): Promise<number[]> {
  const rows = await atelierQuery(
    oracleTarget(NS_Q),
    `SELECT ${top === undefined ? "" : `TOP ${top} `}ID FROM Ens_Util.Log${where === "" ? "" : ` WHERE ${where}`} ORDER BY ID DESC`,
  );
  return rows.map((row) => Number(row["ID"]));
}

// -- Setup and teardown ------------------------------------------------

beforeAll(async () => {
  skipReason = staleDistReason(REPO_ROOT, "shared");
  for (const pkg of ["iris-dev-mcp", "iris-admin-mcp", "iris-interop-mcp"]) skipReason ??= staleDistReason(REPO_ROOT, pkg);
  skipReason ??= staleDistReason(REPO_ROOT, "iris-ops-mcp");
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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 40.0 QA live gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  dev = await openWireSession(wireOptions("iris-dev-mcp"));
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  admin = await openWireSession(wireOptions("iris-admin-mcp"));
  interop = await openWireSession(wireOptions("iris-interop-mcp"));
  ops = await openWireSession(wireOptions("iris-ops-mcp"));
  await putFixtureClass(dev);
  for (const name of NAMESPACES) await removeInteropNamespace(admin, dev, name);
  expect(await leftovers(dev, NAMESPACES), "no fixture namespace before the run").toEqual([]);

  await createInteropNamespace(admin, dev, NS_Q, { interop: true });
  await createInteropNamespace(admin, dev, NS_R, { interop: true });

  // Q: Story400.Seed (for Shift and SaveLog), then this file's seed; the window describe moves its rows to a fresh T0.
  const docs = docFixtures(dev, NS_Q);
  for (const [doc, source] of [...STORY400_DOCUMENTS, [QA_SEED_DOC, QA_SEED_SOURCE] as const]) {
    await docs.putDoc(doc, source);
    await docs.compileDoc(doc);
  }
  const seeded = await dev.call("iris_execute_classmethod", { namespace: NS_Q, className: "Story40Q.Seed", methodName: "Seed", args: [] });
  expect(seeded.isError, allText(seeded)).toBeFalsy();
  expect(String(seeded.structuredContent?.["returnValue"] ?? ""), "the seed's ID map").toBe(
    JSON.stringify({ logs: ALL_IDS.slice().reverse().join(","), headers: "1,2" }),
  );

  // A positive control: the same check that must read empty after the run sees both namespaces and their mappings now.
  expect(await leftovers(dev, NAMESPACES), "the leftovers check sees both namespaces while they exist").toEqual(
    expect.arrayContaining([
      `namespace ${NS_Q}`,
      `database configuration ${NS_Q}`,
      `package mapping ${NS_Q} Ens`,
      `namespace ${NS_R}`,
      `database configuration ${NS_R}`,
      `package mapping ${NS_R} Ens`,
    ]),
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
    await attempt("the fixture document listing", async () => {
      for (const { filter, names } of await fixtureDocumentNames(dev, ["Story400", "Story40Q", "Story391Fixture"])) {
        expect(names, `no ${FIXTURE_DOC} or ${filter} document after the run`).toEqual([]);
      }
    });
  } finally {
    // A session the setup never opened is undefined here; closing the others must still happen.
    for (const session of [ops, interop, admin, dev]) await session?.close();
  }
  expect(problems, "every teardown step completed").toEqual([]);
}, 300000);

// -- DW-584: the window boundary ------------------------------------------

describe("Story 40.0 QA: DW-584, the 24-hour window boundary on the wire", () => {
  // The window rows sit 2 minutes inside and outside 24 hours, so they are moved to a fresh T0 right before this
  // describe's rows run, wherever the describe falls in the file.
  beforeAll(async () => {
    if (skipReason) return;
    const retimed = await dev.call("iris_execute_classmethod", { namespace: NS_Q, className: "Story40Q.Seed", methodName: "Retime", args: [] });
    expect(retimed.isError, allText(retimed)).toBeFalsy();
    expect(String(retimed.structuredContent?.["returnValue"] ?? ""), "the window rows moved to a fresh T0").toBe("OK");
    seededAt = Date.now();
  }, 120000);

  it("the seed placed the window rows where the construction says: 23 h 58 min and 24 h 02 min old by IRIS's own clock, in minutes", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const logs = await atelierQuery(
      oracleTarget(NS_Q),
      "SELECT ID, DATEDIFF('mi', TimeLogged, GETUTCDATE()) AS Mins FROM Ens_Util.Log WHERE ID IN (1, 11, 12, 13) ORDER BY ID",
    );
    const mins = new Map(logs.map((row) => [Number(row["ID"]), Number(row["Mins"])]));
    // DATEDIFF counts minute boundaries crossed, so each value may be one more than the whole minutes; the seed-to-now drift is seconds.
    const within = (id: number, whole: number): void => {
      expect(mins.get(id), `row ${id}: about ${whole} minutes old`).toBeGreaterThanOrEqual(whole - 1);
      expect(mins.get(id), `row ${id}: about ${whole} minutes old`).toBeLessThanOrEqual(whole + 1);
    };
    within(1, 60);
    within(11, Math.floor(INSIDE_SECONDS / 60));
    within(12, Math.floor(OUTSIDE_SECONDS / 60));
    within(13, Math.floor(INSIDE_SECONDS / 60));
    const headers = await atelierQuery(
      oracleTarget(NS_Q),
      "SELECT ID, DATEDIFF('mi', TimeCreated, GETUTCDATE()) AS Mins FROM Ens.MessageHeader ORDER BY ID",
    );
    expect(headers.map((row) => Number(row["ID"])), "two headers").toEqual([1, 2]);
    expect(Number(headers[0]?.["Mins"]), "header 1 is inside").toBeGreaterThanOrEqual(Math.floor(INSIDE_SECONDS / 60) - 1);
    expect(Number(headers[0]?.["Mins"]), "header 1 is inside").toBeLessThanOrEqual(Math.floor(INSIDE_SECONDS / 60) + 1);
    expect(Number(headers[1]?.["Mins"]), "header 2 is outside").toBeGreaterThanOrEqual(Math.floor(OUTSIDE_SECONDS / 60) - 1);
    expect(Number(headers[1]?.["Mins"]), "header 2 is outside").toBeLessThanOrEqual(Math.floor(OUTSIDE_SECONDS / 60) + 1);
  }, 120000);

  it("metrics for Q: an Error 2 minutes inside is counted and one 2 minutes outside is not (errorCount24h 5: L2, L7, L8, L10, L11); a Warning inside is not; the header inside is counted and the one outside is not (messageCount24h 1)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await ops.call("iris_metrics_interop", { namespace: NS_Q });
    // The margins are 2 minutes; the rows were seeded moments ago. A call this far after the seed would make the window wrong, not the code.
    const sinceSeed = Date.now() - seededAt;
    expect(sinceSeed, `the call came ${sinceSeed} ms after the seed; the 2-minute margins assume well under ${MAX_SEED_TO_CALL_MS} ms`).toBeLessThan(MAX_SEED_TO_CALL_MS);
    const content = succeeded<MetricsContent>(result);
    expect(content.count).toBe(1);
    expect(content.namespaces[0]).toMatchObject({ namespace: NS_Q, errorCount24h: 5, messageCount24h: 1, queueDepth: 0 });
    const text = allText(result);
    expect(text).toContain("Errors (24h): 5");
    expect(text).toContain("Messages (24h): 1");

    // An independent cross-check in IRIS's own SQL time arithmetic (written by hand, not by the construction).
    const errors = await atelierQuery(
      oracleTarget(NS_Q),
      "SELECT COUNT(*) AS N FROM Ens_Util.Log WHERE Type = 2 AND TimeLogged > DATEADD('hh', -24, GETUTCDATE())",
    );
    expect(Number(errors[0]?.["N"]), "the SQL window count of Error rows").toBe(5);
    const headers = await atelierQuery(
      oracleTarget(NS_Q),
      "SELECT COUNT(*) AS N FROM Ens.MessageHeader WHERE TimeCreated > DATEADD('hh', -24, GETUTCDATE())",
    );
    expect(Number(headers[0]?.["N"]), "the SQL window count of headers").toBe(1);
  }, 120000);
});

// -- DW-585: the route edges ----------------------------------------------

/** A value the route receives as `type` that is not exactly a display name, with the SQL literal that selects the same rows. */
const NEAR_MISSES: Array<{ label: string; query: string; literal: string }> = [
  { label: "lower-case name", query: "type=error", literal: "'error'" },
  { label: "upper-case name", query: "type=ERROR", literal: "'ERROR'" },
  { label: "name with a leading space", query: "type=%20Error", literal: "' Error'" },
  { label: "name with a trailing space", query: "type=Error%20", literal: "'Error '" },
  { label: "name padded on both sides", query: "type=%20Error%20", literal: "' Error '" },
  { label: "a lone space", query: "type=%20", literal: "' '" },
  { label: "a number with a leading space", query: "type=%202", literal: "' 2'" },
  { label: "a number with a trailing space", query: "type=2%20", literal: "'2 '" },
  { label: "a name inside a longer word", query: "type=ErrorX", literal: "'ErrorX'" },
  { label: "two names in a list", query: "type=Error,Warning", literal: "'Error,Warning'" },
  { label: "two numbers in a list", query: "type=2,3", literal: "'2,3'" },
  { label: "number 7, above the range", query: "type=7", literal: "7" },
  { label: "number 0, below the range", query: "type=0", literal: "0" },
  { label: "a negative number", query: "type=-1", literal: "-1" },
  { label: "number 99", query: "type=99", literal: "99" },
  { label: "number 1000000", query: "type=1000000", literal: "1000000" },
  { label: "an injection string", query: "type=Error%27%20OR%20%271%27%3D%271", literal: "'Error'' OR ''1''=''1'" },
];

/** Numeric spellings of 2 that IRIS SQL reads as the number: the Error rows, by the same literal in SQL. */
const NUMERIC_TWOS: Array<{ label: string; query: string; literal: string }> = [
  { label: "02", query: "type=02", literal: "'02'" },
  { label: "002", query: "type=002", literal: "'002'" },
  { label: "2.0", query: "type=2.0", literal: "'2.0'" },
  { label: "+2", query: "type=%2B2", literal: "'+2'" },
];

describe("Story 40.0 QA: DW-585, the type filter's edge values over real HTTP against hand-written SQL", () => {
  it("a value that is not exactly a display name passes through and selects what the same SQL literal selects: no row, with HTTP 200 and no error", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    for (const { label, query, literal } of NEAR_MISSES) {
      const answer = await rawLogs(NS_Q, `${query}&count=100`);
      const expected = await eventLogOracle(oracleTarget(NS_Q), `Type = ${literal}`);
      expect(answer.status, `${label}: HTTP status`).toBe(200);
      expect(answer.errors, `${label}: no error`).toEqual([]);
      expect(answer.result.entries, `${label}: the entries the same SQL literal selects`).toEqual(expected);
      expect(idsOf(expected), `${label}: the hand-written expectation (no Event Log row has such a type)`).toEqual([]);
      expect(answer.result.count, `${label}: count`).toBe(0);
    }
  }, 180000);

  it("a numeric spelling of 2 selects the Error rows, as the same SQL literal does (an older request still works, AD-33)", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const byName = await rawLogs(NS_Q, "type=Error&count=100");
    expect(idsOf(byName.result.entries), "the Error rows").toEqual(ERROR_IDS);
    for (const { label, query, literal } of [{ label: "2", query: "type=2", literal: "2" }, ...NUMERIC_TWOS]) {
      const answer = await rawLogs(NS_Q, `${query}&count=100`);
      const expected = await eventLogOracle(oracleTarget(NS_Q), `Type = ${literal}`);
      expect(answer.status, `${label}: HTTP status`).toBe(200);
      expect(answer.errors, `${label}: no error`).toEqual([]);
      expect(answer.result.entries, `${label}: every field of every entry equals the SQL literal's rows`).toEqual(expected);
      expect(idsOf(expected), `${label}: the Error rows, newest first`).toEqual(ERROR_IDS);
      expect(answer.result, `${label}: equals type=Error`).toEqual(byName.result);
    }
    // The other numbers still select their own rows: the number passes through, it is not mapped.
    for (const [number, ids] of [[1, [1]], [3, [13, 9, 3]], [6, [6]]] as const) {
      const answer = await rawLogs(NS_Q, `type=${number}&count=100`);
      expect(idsOf(answer.result.entries), `type=${number}`).toEqual(ids);
    }
  }, 180000);

  it("an empty type is no filter: the same rows as an omitted type, newest first, and it combines with itemName", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const omitted = await rawLogs(NS_Q, "count=100");
    const empty = await rawLogs(NS_Q, "type=&count=100");
    const expected = await eventLogOracle(oracleTarget(NS_Q));
    expect(idsOf(expected), "the oracle selects every row").toEqual(ALL_IDS);
    expect(empty.status).toBe(200);
    expect(empty.errors).toEqual([]);
    expect(empty.result.entries, "type= equals the oracle without a filter").toEqual(expected);
    expect(empty.result, "type= equals an omitted type").toEqual(omitted.result);
    const withItem = await rawLogs(NS_Q, "type=&itemName=Story40Q.Other&count=100");
    expect(withItem.result.entries, "type= and itemName").toEqual(await eventLogOracle(oracleTarget(NS_Q), "ConfigName = 'Story40Q.Other'"));
    expect(idsOf(withItem.result.entries)).toEqual([8]);
  }, 120000);

  it("count applies after the type filter, newest first: TOP n of the filtered rows, and a count that is not a positive number, or is far above the rows, returns every filtered row", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const cases: Array<{ count: string; top: number | undefined }> = [
      { count: "1", top: 1 },
      { count: "2", top: 2 },
      { count: "3", top: 3 },
      { count: "6", top: 6 },
      { count: "7", top: 7 },
      { count: "0", top: undefined },
      { count: "-3", top: undefined },
      { count: "abc", top: undefined },
      { count: "", top: undefined },
      { count: "99999999", top: undefined },
    ];
    const full = await eventLogOracle(oracleTarget(NS_Q), "Type = 2");
    expect(idsOf(full), "the Error rows").toEqual(ERROR_IDS);
    for (const { count, top } of cases) {
      const answer = await rawLogs(NS_Q, `type=Error&count=${count}`);
      const expectedIds = await topIds(top, "Type = 2");
      expect(answer.status, `count=${JSON.stringify(count)}: HTTP status`).toBe(200);
      expect(answer.errors, `count=${JSON.stringify(count)}: no error`).toEqual([]);
      expect(idsOf(answer.result.entries), `count=${JSON.stringify(count)}: the IDs of SELECT TOP ${top ?? "(all)"}`).toEqual(expectedIds);
      expect(answer.result.entries, `count=${JSON.stringify(count)}: every field`).toEqual(full.slice(0, expectedIds.length));
      expect(answer.result.count).toBe(expectedIds.length);
    }
    // Written out by hand, so the oracle's own arithmetic is not the only evidence.
    expect(idsOf((await rawLogs(NS_Q, "type=Error&count=2")).result.entries)).toEqual([12, 11]);
    expect(idsOf((await rawLogs(NS_Q, "type=Error&count=0")).result.entries)).toEqual(ERROR_IDS);
    expect(idsOf((await rawLogs(NS_Q, "type=Error&count=7")).result.entries)).toEqual(ERROR_IDS);

    // Count with the other filters.
    const combined: Array<{ query: string; where: string; ids: number[] }> = [
      { query: "type=Warning&count=2", where: "Type = 3", ids: [13, 9] },
      { query: "type=Warning&count=5", where: "Type = 3", ids: [13, 9, 3] },
      { query: "type=Error&itemName=Story40Q.Item&count=2", where: "Type = 2 AND ConfigName = 'Story40Q.Item'", ids: [10, 7] },
      { query: "type=Error&itemName=Story40Q.Window&count=1", where: "Type = 2 AND ConfigName = 'Story40Q.Window'", ids: [12] },
      { query: "type=Info&itemName=Story40Q.Other&count=5", where: "Type = 4 AND ConfigName = 'Story40Q.Other'", ids: [] },
      { query: "itemName=Story40Q.Item&count=3", where: "ConfigName = 'Story40Q.Item'", ids: [10, 9, 7] },
      { query: "type=Bogus&count=3", where: "Type = 'Bogus'", ids: [] },
    ];
    for (const { query, where, ids } of combined) {
      const answer = await rawLogs(NS_Q, query);
      const expectedIds = await topIds(Number(/count=(\d+)/.exec(query)?.[1]), where);
      expect(expectedIds, `${query}: the hand-written SQL selects the rows written out here`).toEqual(ids);
      expect(idsOf(answer.result.entries), query).toEqual(ids);
      expect(answer.result.count, `${query}: count`).toBe(ids.length);
    }
  }, 240000);

  it("the built interop server: type and count together return the oracle's entries, and an invalid type is turned away before any request reaches IRIS", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const content = succeeded<LogsContent>(await productionLogs(NS_Q, { type: "Error", count: 2 }));
    const expected = (await eventLogOracle(oracleTarget(NS_Q), "Type = 2")).slice(0, 2);
    expect(idsOf(expected), "the oracle's two newest Error rows").toEqual([12, 11]);
    expect(content.entries, "every field of both entries").toEqual(expected);
    expect(content.count).toBe(2);
    const windowWarning = succeeded<LogsContent>(await productionLogs(NS_Q, { type: "Warning", itemName: "Story40Q.Window" }));
    expect(idsOf(windowWarning.entries)).toEqual([13]);

    for (const type of ["error", "ERROR", "Error ", " Error", "Errors", "2", ""]) {
      const refused = await productionLogs(NS_Q, { type });
      expect(refused.isError, `type ${JSON.stringify(type)} is refused by the tool schema: ${allText(refused)}`).toBe(true);
      expect(refused.structuredContent?.["entries"], `type ${JSON.stringify(type)}: no entries came back`).toBeUndefined();
    }
    const stillServing = succeeded<LogsContent>(await productionLogs(NS_Q, { type: "Alert" }));
    expect(idsOf(stillServing.entries), "the server still answers after the refusals").toEqual([6]);
  }, 180000);
});

// -- Not configured, the other way round -----------------------------------

describe("Story 40.0 QA: a namespace with the Interoperability packages mapped and nothing in them (Rules #34, #41)", () => {
  it("R holds no Event Log row and no header, by SQL", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const logs = await atelierQuery(oracleTarget(NS_R), "SELECT COUNT(*) AS N FROM Ens_Util.Log");
    const headers = await atelierQuery(oracleTarget(NS_R), "SELECT COUNT(*) AS N FROM Ens.MessageHeader");
    expect(Number(logs[0]?.["N"]), "Ens_Util.Log exists and is empty").toBe(0);
    expect(Number(headers[0]?.["N"]), "Ens.MessageHeader exists and is empty").toBe(0);
    // The control: the same two statements see Q's rows, so the zero above is R's own.
    const seeded = await atelierQuery(oracleTarget(NS_Q), "SELECT COUNT(*) AS N FROM Ens_Util.Log");
    expect(Number(seeded[0]?.["N"]), "Q holds the 13 rows").toBe(13);
  }, 120000);

  it("iris_metrics_interop for R is not an error: errorCount24h 0, messageCount24h 0, queueDepth 0, in the structured result and in the text", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const result = await ops.call("iris_metrics_interop", { namespace: NS_R });
    const content = succeeded<MetricsContent>(result);
    expect(content.count).toBe(1);
    expect(content.namespaces[0]).toMatchObject({ namespace: NS_R, errorCount24h: 0, messageCount24h: 0, queueDepth: 0 });
    const text = allText(result);
    expect(text).toContain("Errors (24h): 0");
    expect(text).toContain("Messages (24h): 0");
  }, 120000);

  it("iris_production_logs for R answers an empty list, not an error, plain, for each of the six names, with an item and a count, and on the raw route", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    const empty = { entries: [], count: 0 };
    expect(succeeded<LogsContent>(await productionLogs(NS_R, {}))).toEqual(empty);
    for (const type of ["Assert", "Error", "Warning", "Info", "Trace", "Alert"]) {
      expect(succeeded<LogsContent>(await productionLogs(NS_R, { type })), `type ${type}`).toEqual(empty);
    }
    expect(succeeded<LogsContent>(await productionLogs(NS_R, { type: "Error", itemName: "Story40Q.Item", count: 5 }))).toEqual(empty);
    for (const query of ["type=Error", "type=2", "type=Bogus", "type=&count=1"]) {
      const answer = await rawLogs(NS_R, query);
      expect(answer.status, `${query}: HTTP status`).toBe(200);
      expect(answer.errors, `${query}: no error`).toEqual([]);
      expect(answer.result, query).toEqual(empty);
    }
  }, 180000);
});

// -- The prompt through the real spawned entry ------------------------------

describe("Story 40.0 QA: trace-message-flow through the REAL spawned interop entry over stdio with a real SDK client (Rule #46)", () => {
  it("lists the prompt unchanged, renders the three Story 40.0 step texts in 6 ordered steps with namespace omitted, refuses an omitted `arguments` cleanly, and keeps serving", async (testCtx) => {
    if (skipReason) return skipTest(GATE_TAG, skipReason, testCtx);
    // Its own spawn of the built interop entry, so the refusals below reach a connection no other row uses.
    const client = await openWireSession({ ...wireOptions("iris-interop-mcp"), clientName: "story-40-0-qa-live-gate-prompts" });
    try {
      const prompts = await client.listPrompts();
      const listed = prompts.find((prompt) => prompt.name === "trace-message-flow");
      expect(listed, "the spawned server lists trace-message-flow").toBeDefined();
      expect({ title: listed?.title, arguments: listed?.arguments?.map((argument) => [argument.name, argument.required === true]) }).toEqual({
        title: "Trace Message Flow",
        arguments: [["sessionOrHeaderId", true], ["namespace", false]],
      });

      const rendered = await client.getPrompt({ name: "trace-message-flow", arguments: { sessionOrHeaderId: "40001" } });
      expect(rendered.messages).toHaveLength(1);
      const message = rendered.messages[0] as { role: string; content: { type: string; text?: string } };
      expect([message.role, message.content.type]).toEqual(["user", "text"]);
      const text = message.content.text as string;
      expect(text).toContain("Session or header ID to trace: `40001`");
      expect(text).toContain("No namespace specified");
      const steps = stepsOf(text);
      expect([...steps.keys()], "6 steps in order").toEqual([1, 2, 3, 4, 5, 6]);
      expect(steps.get(4)?.endsWith(` ${STEP4_SENTENCE}`), "step 4 ends with the new sentence, one space after its earlier text").toBe(true);
      expect(steps.get(5)?.endsWith(` ${STEP5_SENTENCE}`), "step 5 ends with the new sentence, one space after its earlier text").toBe(true);
      expect(steps.get(6), "step 6 holds the new clause").toContain(STEP6_CLAUSE);
      expect(text, "no unresolved placeholder").not.toMatch(/<namespace>|<sessionOrHeaderId>|undefined/);

      const refusedRequests: WirePromptRequest[] = [
        { name: "trace-message-flow" },
        { name: "trace-message-flow", arguments: {} },
        { name: "trace-message-flow", arguments: { namespace: "USER" } },
      ];
      for (const request of refusedRequests) {
        const refused = await client.getPrompt(request).then(
          () => undefined,
          (error: unknown) => error as { code?: number; message?: string },
        );
        expect(refused, `${JSON.stringify(request)} is refused`).toBeDefined();
        expect(refused?.code, JSON.stringify(request)).toBe(INVALID_PARAMS);
        expect(refused?.message, JSON.stringify(request)).toContain("trace-message-flow");
      }
      const again = await client.getPrompt({ name: "trace-message-flow", arguments: { sessionOrHeaderId: "40001", namespace: "USER" } });
      expect(again.messages[0]?.content.text, "the connection is still usable after the refusals").toContain('Target namespace: "USER"');
    } finally {
      await client.close();
    }
  }, 180000);
});
