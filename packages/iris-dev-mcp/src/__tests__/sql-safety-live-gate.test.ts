/**
 * Story 38.5 (AC-4, AC-5, AC-7) - SQL write safety against a REAL IRIS.
 *
 * `sql-safety.test.ts` pins the tools against mocked HTTP. This gate drives `iris_sql_execute` and
 * `iris_sql_query` through the real `IrisHttpClient` and the real `/dev/sql/execute` route
 * (`ExecuteMCPv2.REST.Sql`), so the properties the safety rests on are proven where they happen:
 *
 *  - the serializer: the rows of the fixture SELECT and CALL, of expressions of every column kind, of
 *    parameterized statements and of JSON-looking strings equal the rows the Atelier `action/query` route
 *    returns for the same statement, through the tool's mapping, for both tools; the fixture SELECT and the
 *    two-result-set CALL are also compared with no mapping, key for key;
 *  - the default path: no transaction from the tool, `rowsAffected` equal to the change `action/query`
 *    sees, and a function's device output discarded;
 *  - the rows-affected cap, by parameter and by `ctx.config.sqlMaxRowsAffected`: a DELETE over the cap is
 *    rolled back with the rows and the trigger's audit rows intact (the trigger's `$INCREMENT` moved: the
 *    recorded residual), a DELETE within it commits, TRUNCATE TABLE reports -1 and is rolled back, and a
 *    CALL is refused before it runs;
 *  - read-only mode, by parameter, by `ctx.config.sqlReadOnly` and by `iris_sql_query`: an UPDATE is
 *    refused with the values unchanged, and a SELECT that calls a function has its SQL write and its
 *    journaled global set undone while its `$INCREMENT` counter is not;
 *  - a function that ends or opens a transaction inside the tool's is reported as such, also when the
 *    statement then fails;
 *  - a statement that prepares and then fails to run is an error carrying the SQLCODE, on every path;
 *  - the namespace a call names decides where the statement runs;
 *  - the endpoint's own input checks reject a malformed body;
 *  - `countOnly` equals the `COUNT(*)` that `action/query` returns, and transfers no rows.
 *
 * The expected values come from the live Atelier route, never from the implementation (Rule #36).
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, defaulting to the dev
 * instance at localhost:52773 / HSCUSTOM. Writes only the disposable `ExecuteMCPv2.Temp.QaStory385Gate.cls`
 * (persistent, compiled, with a DELETE trigger, SQL functions and a class query) and
 * `ExecuteMCPv2.Temp.QaStory385GateAudit.cls` (persistent, compiled) documents, their data and stream
 * globals, and the counter and marker globals `^ExecuteMCPv2.QaStory385GateC` and `...G`. Before and after
 * the run, and before every test, the gate removes the data (`%KillExtent()` is not enough: a stream global
 * survives it) by killing every global whose name starts `ExecuteMCPv` and contains `QaStory385Gate`; before
 * and after the run it also removes the documents, and in `afterAll` it asserts that nothing named
 * `QaStory385Gate` is left.
 * Skips when IRIS is unreachable; fails instead when `IRIS_REQUIRE_LIVE` is armed (same arming convention as
 * the other live gates in this directory).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  IrisHttpClient,
  atelierPath,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  type ToolContext,
} from "@iris-mcp/shared";
import { docListTool } from "../tools/doc.js";
import { executeClassMethodTool } from "../tools/execute.js";
import { globalKillTool, globalListTool } from "../tools/global.js";
import { sqlExecuteTool, sqlQueryTool } from "../tools/sql.js";
import { compileDocs, putDocLines, removeStored, runQuery } from "./live-doc-helpers.js";
import { SQL_PATH } from "./sql-test-support.js";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const STEM = "QaStory385Gate";
const GATE = `ExecuteMCPv2.Temp.${STEM}`;
const AUDIT = `ExecuteMCPv2.Temp.${STEM}Audit`;
const GATE_DOC = `${GATE}.cls`;
const AUDIT_DOC = `${AUDIT}.cls`;
/** The class IRIS generates for the DDL tests. */
const DDL_DOC = `${GATE}Ddl.cls`;
const ALL_DOCS = [GATE_DOC, AUDIT_DOC, DDL_DOC];
/** The SQL tables of the two classes. */
const T = `ExecuteMCPv2_Temp.${STEM}`;
const TA = `ExecuteMCPv2_Temp.${STEM}Audit`;
/** The SQL functions of the Gate class. */
const FN = (name: string): string => `${T}_${name}()`;
/** The table the DDL tests create and drop. */
const DDL_TABLE = `${T}Ddl`;

let skipReason: string | undefined;
let ctx: ToolContext;
let client: IrisHttpClient;
let version: number;

// -- Fixtures --------------------------------------------------------

/** The audit table: one row per delete trigger firing and per function that writes. */
const AUDIT_SOURCE = [
  `Class ${AUDIT} Extends %Persistent`,
  "{",
  "",
  'Parameter DEFAULTGLOBAL = "^ExecuteMCPv2.QaStory385GateAud";',
  "",
  "Property Note As %String;",
  "",
  "}",
];

/**
 * The table the statements run against: one column of every kind the serializer maps, a DELETE trigger that
 * writes an audit row and `$INCREMENT`s a counter, SQL functions that write, set a global, end the
 * transaction, write to the device and report `$TLEVEL`, a class query and a procedure with two result sets.
 * Non-ASCII text is built with `$Char`, so the source stays ASCII.
 */
const GATE_SOURCE = [
  `Class ${GATE} Extends %Persistent`,
  "{",
  "",
  "Property Name As %String;",
  "",
  "Property Born As %Date;",
  "",
  "Property Clock As %Time;",
  "",
  "Property Stamp As %TimeStamp;",
  "",
  "Property Tags As %List;",
  "",
  "Property Doc As %Stream.GlobalCharacter;",
  "",
  "Property Amount As %Numeric(SCALE = 2);",
  "",
  "Property Flag As %Boolean;",
  "",
  "Property Json As %String;",
  "",
  "Property Qty As %Integer;",
  "",
  "Trigger AfterDelete [ Event = DELETE, Foreach = row/object, Time = AFTER ]",
  "{",
  "    Set tN = $Increment(^ExecuteMCPv2.QaStory385GateC)",
  `    &sql(INSERT INTO ${TA} (Note) VALUES ('deleted'))`,
  "}",
  "",
  "ClassMethod SideEffect() As %Integer [ SqlProc ]",
  "{",
  `    &sql(INSERT INTO ${TA} (Note) VALUES ('side-effect'))`,
  '    Set ^ExecuteMCPv2.QaStory385GateG = "set"',
  "    Set tN = $Increment(^ExecuteMCPv2.QaStory385GateC)",
  "    Quit 1",
  "}",
  "",
  "ClassMethod EndTx() As %Integer [ SqlProc ]",
  "{",
  `    &sql(INSERT INTO ${TA} (Note) VALUES ('ended'))`,
  "    TCOMMIT",
  "    Quit 1",
  "}",
  "",
  "ClassMethod OpenTx() As %Integer [ SqlProc ]",
  "{",
  "    TSTART",
  "    Quit $TLevel",
  "}",
  "",
  "ClassMethod Noise() As %Integer [ SqlProc ]",
  "{",
  '    Write "device-noise"',
  "    Quit 1",
  "}",
  "",
  "ClassMethod Level() As %Integer [ SqlProc ]",
  "{",
  "    Quit $TLevel",
  "}",
  "",
  "ClassMethod WriteRow() As %Integer [ SqlProc ]",
  "{",
  `    &sql(INSERT INTO ${TA} (Note) VALUES ('called'))`,
  "    Quit 1",
  "}",
  "",
  "Query ListAll() As %SQLQuery(CONTAINID = 1) [ SqlProc ]",
  "{",
  `    SELECT ID, Name, Born, Clock, Stamp, Tags, Doc, Amount, Flag, Json, Qty FROM ${T} ORDER BY ID`,
  "}",
  "",
  "ClassMethod TwoSets() [ ReturnResultsets, SqlProc ]",
  "{",
  "    Set tStmt = ##class(%SQL.Statement).%New()",
  `    Set tSC = tStmt.%Prepare("SELECT ID, Name FROM ${T} WHERE Name IN ('alpha', 'beta') ORDER BY ID")`,
  "    Do %sqlcontext.AddResultSet(tStmt.%Execute())",
  "    Set tStmt2 = ##class(%SQL.Statement).%New()",
  `    Set tSC = tStmt2.%Prepare("SELECT COUNT(*) AS N FROM ${T}")`,
  "    Do %sqlcontext.AddResultSet(tStmt2.%Execute())",
  "    Quit",
  "}",
  "",
  `ClassMethod Add(pName As %String, pJson As %String = "", pQty As %Integer = "") As %Status`,
  "{",
  "    Set tObj = ..%New()",
  "    Set tObj.Name = pName",
  "    Set tObj.Json = pJson",
  "    Set tObj.Qty = pQty",
  "    Quit tObj.%Save()",
  "}",
  "",
  "ClassMethod Seed() As %String",
  "{",
  "    Set tFull = ..%New()",
  '    Set tFull.Name = "alpha"',
  "    Set tFull.Born = 66001",
  "    Set tFull.Clock = 3600",
  '    Set tFull.Stamp = "2026-10-15 12:01:00"',
  '    Set tFull.Tags = $ListBuild("a", "b")',
  '    Do tFull.Doc.Write("stream text")',
  "    Set tFull.Amount = 1.5",
  "    Set tFull.Flag = 1",
  '    Set tFull.Json = "{""a"":1}"',
  "    Set tFull.Qty = 7",
  "    Set tSC = tFull.%Save()",
  '    Set tSC = ..Add("beta")',
  '    Set tSC = ..Add("gamma", "plain")',
  '    Set tJson = $ListBuild("[1,2]", "{bad", " {""a"":1} ", "{""a"":1,}", "[1,2]x", "123", "true", "null", """q""", "line1"_$Char(10)_"line2", "tab"_$Char(9)_"x", "back"_$Char(92)_"slash", "quo""te", "uni"_$Char(233)_$Char(8364), "{}")',
  "    For tI = 1:1:$ListLength(tJson) {",
  '        Set tSC = ..Add("json"_tI, $List(tJson, tI))',
  "    }",
  "    For tI = 1:1:6 {",
  '        Set tSC = ..Add("del"_tI, "", 1)',
  "    }",
  '    Quit "seeded"',
  "}",
  "",
  "ClassMethod Counters() As %String",
  "{",
  '    Quit $Get(^ExecuteMCPv2.QaStory385GateC, 0)_"|"_$Get(^ExecuteMCPv2.QaStory385GateG, "")',
  "}",
  "",
  "}",
];

/** The number of rows `Seed()` writes to the Gate table. */
const SEEDED_ROWS = 3 + 15 + 6;
/** The rows the cap tests delete or update: `del1` to `del6`. */
const DEL_WHERE = "Name LIKE 'del%'";
const DEL_ROWS = 6;

// -- Cleanup ---------------------------------------------------------

/** The globals whose name contains the stem, with the caret IRIS lists them with. */
async function listFixtureGlobals(): Promise<string[]> {
  const listed = await globalListTool.handler({ filter: STEM, namespace: IRIS_NAMESPACE }, ctx);
  expect(listed.isError, "the global listing").toBeUndefined();
  return (listed.structuredContent as { globals: string[] }).globals;
}

/** Kill every global whose name starts `ExecuteMCPv` and contains the stem. */
async function killFixtureGlobals(): Promise<void> {
  for (const listed of await listFixtureGlobals()) {
    const name = listed.replace(/^\^/, "");
    if (!name.startsWith("ExecuteMCPv") || !name.includes(STEM)) continue;
    const result = await globalKillTool.handler({ global: name, namespace: IRIS_NAMESPACE }, ctx);
    expect(result.isError, `killing global ${name}`).toBeUndefined();
  }
}

/** The documents IRIS lists for the stem, generated documents included. */
async function listFixtureDocuments(): Promise<string[]> {
  const listed = await docListTool.handler({ filter: STEM, generated: true, namespace: IRIS_NAMESPACE }, ctx);
  return (listed.structuredContent as { items: Array<{ name: string }> }).items.map((item) => item.name);
}

/** Remove everything the gate writes: the data and its globals, then the documents. */
async function removeFixtures(): Promise<void> {
  await killFixtureGlobals();
  for (const docName of ALL_DOCS) await removeStored(client, version, IRIS_NAMESPACE, docName);
}

async function callClassMethod(className: string, methodName: string): Promise<string> {
  const result = await executeClassMethodTool.handler({ className, methodName, namespace: IRIS_NAMESPACE }, ctx);
  expect(result.isError, `${className}.${methodName}`).toBeUndefined();
  return String((result.structuredContent as { returnValue: unknown }).returnValue);
}

/** Empty tables and counters, then the seeded rows. */
async function reseed(): Promise<void> {
  await killFixtureGlobals();
  expect(await callClassMethod(GATE, "Seed")).toBe("seeded");
}

// -- Helpers ---------------------------------------------------------

type Row = Record<string, unknown>;

/** The Atelier `action/query` rows for a statement: the oracle. */
async function atelierRows(query: string, parameters?: unknown[]): Promise<Row[]> {
  if (parameters === undefined) return runQuery(client, version, IRIS_NAMESPACE, query);
  const response = await client.post(atelierPath(version, IRIS_NAMESPACE, "action/query"), { query, parameters });
  const content = (response.result as { content?: unknown }).content;
  return Array.isArray(content) ? (content as Row[]) : [];
}

/** The rows the new route returns for a statement, with no tool mapping. */
async function endpointResult(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await client.post(SQL_PATH, { namespace: IRIS_NAMESPACE, readOnly: false, countOnly: false, maxRowsAffected: null, ...body });
  return response.result as Record<string, unknown>;
}

/** Today's mapping of Atelier rows to the tool result. */
function todayMapping(rows: Row[]): { columns: string[]; rows: unknown[][]; rowCount: number } {
  const columns = rows.length > 0 ? Object.keys(rows[0] as Row) : [];
  return { columns, rows: rows.map((row) => columns.map((column) => row[column])), rowCount: rows.length };
}

async function scalar(query: string): Promise<unknown> {
  const rows = await atelierRows(query);
  return Object.values(rows[0] ?? {})[0];
}

/** How many tables named like the DDL test table exist (0 or 1). */
const ddlTableCount = (): Promise<unknown> =>
  scalar(`SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'ExecuteMCPv2_Temp' AND TABLE_NAME = '${STEM}Ddl'`);
const gateRows = (): Promise<unknown> => scalar(`SELECT COUNT(*) FROM ${T}`);
const auditRows = (): Promise<unknown> => scalar(`SELECT COUNT(*) FROM ${TA}`);

function ctxWith(config: Record<string, unknown>): ToolContext {
  return { ...ctx, config: { ...ctx.config, ...config } };
}

function run(tool: typeof sqlExecuteTool, args: Record<string, unknown>, context: ToolContext = ctx) {
  return tool.handler({ namespace: IRIS_NAMESPACE, ...args }, context);
}

beforeAll(async () => {
  try {
    const config = loadConfig({
      IRIS_HOST,
      IRIS_PORT,
      IRIS_USERNAME,
      IRIS_PASSWORD,
      IRIS_NAMESPACE,
      IRIS_HTTPS: "false",
    });
    client = new IrisHttpClient(config);
    if (!(await ping(client, 3000))) {
      skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
    } else {
      version = await negotiateVersion(client);
      ctx = buildToolContext("NS", config, client, version);
    }
  } catch (error) {
    skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so this gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  await removeFixtures();
  await putDocLines(client, version, IRIS_NAMESPACE, AUDIT_DOC, AUDIT_SOURCE);
  await putDocLines(client, version, IRIS_NAMESPACE, GATE_DOC, GATE_SOURCE);
  await compileDocs(client, version, IRIS_NAMESPACE, [AUDIT_DOC, GATE_DOC]);
}, 120000);

/** AC-7: after the gate removes its fixtures, no document, generated routine or global named QaStory385Gate remains. */
afterAll(async () => {
  if (skipReason) return;
  await removeFixtures();
  expect(await listFixtureDocuments(), "no QaStory385Gate document after the run").toEqual([]);
  expect(await listFixtureGlobals(), "no QaStory385Gate global after the run").toEqual([]);
}, 60000);

/** Registers a beforeEach that restores the seeded rows, for a describe whose tests change data or counters. */
function reseedBeforeEach(): void {
  beforeEach(async () => {
    if (skipReason) return;
    await reseed();
  }, 60000);
}

// -- The serializer (AC-5, AC-7) -------------------------------------

describe("the serializer: rows equal the Atelier action/query rows through today's mapping (Story 38.5, AC-5, AC-7)", () => {
  beforeAll(async () => {
    if (skipReason) return;
    await reseed();
  }, 60000);

  const SELECTS: Array<[string, string, unknown[]?]> = [
    ["the fixture SELECT of every column kind", `SELECT ID, Name, Born, Clock, Stamp, Tags, Doc, Amount, Flag, Json, Qty, CAST(NULL AS INTEGER) AS NullInt FROM ${T} WHERE Name IN ('alpha', 'beta', 'gamma') ORDER BY ID`],
    ["SELECT * (the column order IRIS chooses)", `SELECT * FROM ${T} WHERE Name IN ('alpha', 'beta') ORDER BY ID`],
    ["a qualified star after a column", `SELECT t.Name, t.* FROM ${T} t WHERE Name = 'beta'`],
    ["JSON-looking and awkward strings, every row", `SELECT Name, Json FROM ${T} WHERE Name = 'gamma' OR Name LIKE 'json%' ORDER BY ID`],
    ["numbers, big numbers, doubles and NULL numbers", "SELECT 1E20 AS d1, CAST(0.1 AS DOUBLE)+CAST(0.2 AS DOUBLE) AS d2, 0.5 AS n1, .25 AS n2, 12345678901234567890 AS bigv, CAST(9007199254740993 AS BIGINT) AS bi, -0.0 AS nz, CAST(5 AS TINYINT) AS ti, CAST(1 AS BIT) AS b, 1/3 AS dv, CAST(NULL AS DOUBLE) AS ndb, CAST(NULL AS BIT) AS nb, CAST(NULL AS INTEGER) AS ni"],
    ["dates, times, timestamps, text and NULLs", "SELECT CAST('2026-01-01 10:00:00' AS TIMESTAMP) AS ts, CAST('12:30:00' AS TIME) AS tm, 'x' AS s, CAST(NULL AS VARCHAR(5)) AS ns, CAST(NULL AS DATE) AS nd, DATEADD('dd', 1, CAST('2026-01-01' AS DATE)) AS dd"],
    ["unaliased expressions and aggregates", `SELECT COUNT(*), 1+1, %ID, Name||1 FROM ${T} WHERE ID = 1`],
    ["a repeated column name", `SELECT 1 AS a, 2 AS a, 3 AS "b c", 'x' AS "Mixed Case", Name FROM ${T} WHERE ID = 1`],
    ["a %List value", "SELECT $LISTBUILD('a', 'b') AS l"],
    ["an empty result", `SELECT ID FROM ${T} WHERE 1 = 0`],
    ["an EXPLAIN plan", `EXPLAIN SELECT ID FROM ${T}`],
    ["parameters of every JSON kind", "SELECT ? AS a, ? AS b, ? AS c, ? AS d, ? AS e, ? AS f", [null, true, false, 1.5, "s", ""]],
    ["a parameterized WHERE", `SELECT Name, Qty FROM ${T} WHERE Name = ?`, ["alpha"]],
  ];

  for (const [label, query, parameters] of SELECTS) {
    for (const tool of [sqlExecuteTool, sqlQueryTool]) {
      it(`${tool.name}: ${label}`, async (testCtx) => {
        if (skipReason) return testCtx.skip();
        const oracle = await atelierRows(query, parameters);

        const result = await run(tool, { query, ...(parameters ? { parameters } : {}) });

        expect(result.isError).toBeUndefined();
        expect(result.structuredContent).toEqual(todayMapping(oracle));
      }, 60000);
    }
  }

  it("the oracle is not vacuous: the fixture rows carry values of every kind", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const [full, nulls] = await atelierRows(`SELECT ID, Name, Born, Doc, Amount, Flag, Json, Qty FROM ${T} WHERE Name IN ('alpha', 'beta') ORDER BY ID`);

    expect(full).toMatchObject({ Name: "alpha", Born: "66001", Amount: 1.5, Flag: true, Json: { a: 1 }, Qty: 7 });
    expect(typeof full?.ID).toBe("number");
    expect(String(full?.Doc)).toContain("%Stream.GlobalCharacter");
    expect(nulls).toMatchObject({ Name: "beta", Born: "", Doc: "", Amount: 0, Flag: false, Json: "", Qty: 0 });
  }, 60000);

  for (const [label, query] of [
    ["a CALL of a class query (every value is a string)", `CALL ${T}_ListAll()`],
    ["a CALL with two result sets (rows of both, in order)", `CALL ${T}_TwoSets()`],
  ] as const) {
    it(`iris_sql_execute: ${label}`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const oracle = await atelierRows(query);

      const result = await run(sqlExecuteTool, { query, maxRows: 5000 });

      expect(oracle.length).toBeGreaterThan(2);
      expect(result.structuredContent).toEqual(todayMapping(oracle));
      expect(result.structuredContent).not.toHaveProperty("rowsAffected");
    }, 60000);
  }

  it("the endpoint's rows equal the Atelier rows key for key and in order, with no mapping", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const query = `SELECT ID, Name, Born, Clock, Stamp, Tags, Doc, Amount, Flag, Json, Qty FROM ${T} ORDER BY ID`;

    const oracle = await atelierRows(query);
    const result = await endpointResult({ query });

    expect(oracle).toHaveLength(SEEDED_ROWS);
    expect(result.content).toEqual(oracle);
    expect((result.content as Row[]).map((row) => Object.keys(row))).toEqual(oracle.map((row) => Object.keys(row)));
    expect(result).toMatchObject({ outcome: "ok", statementType: 1, statementTypeName: "SELECT" });
  }, 60000);

  it("a CALL with two result sets: the endpoint's rows equal the Atelier rows key for key, the second set's values included", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const query = `CALL ${T}_TwoSets()`;

    const oracle = await atelierRows(query);
    const result = await endpointResult({ query });

    expect(oracle.map((row) => Object.keys(row)), "the oracle carries the second set's own column").toContainEqual(["N"]);
    expect(result.content).toEqual(oracle);
    expect((result.content as Row[]).map((row) => Object.keys(row))).toEqual(oracle.map((row) => Object.keys(row)));
  }, 60000);
});

// -- The default path (AC-4, AC-5) -----------------------------------

describe("the default path: no transaction from the tool, rowsAffected, device output discarded (Story 38.5, AC-4, AC-5)", () => {
  reseedBeforeEach();

  it("a default-path UPDATE reports the rowsAffected that action/query's data shows", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    expect(await scalar(`SELECT COUNT(*) FROM ${T} WHERE Qty = 99`)).toBe(0);

    const result = await run(sqlExecuteTool, { query: `UPDATE ${T} SET Qty = 99 WHERE ${DEL_WHERE}` });

    expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: DEL_ROWS });
    expect(await scalar(`SELECT COUNT(*) FROM ${T} WHERE Qty = 99`)).toBe(DEL_ROWS);
  }, 60000);

  it("a default-path INSERT ... SELECT reports the rows it added", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `INSERT INTO ${TA} (Note) SELECT 'copied' FROM ${T} WHERE ${DEL_WHERE}` });

    expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: DEL_ROWS });
    expect(await auditRows()).toBe(DEL_ROWS);
  }, 60000);

  it("a default-path DELETE commits as it does today, reports rowsAffected and fires the trigger", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `DELETE FROM ${T} WHERE ${DEL_WHERE}` });

    expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: DEL_ROWS });
    expect(await gateRows()).toBe(SEEDED_ROWS - DEL_ROWS);
    expect(await auditRows()).toBe(DEL_ROWS);
  }, 60000);

  it("DDL runs as today: no rows and no rowsAffected", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    try {
      const result = await run(sqlExecuteTool, { query: `CREATE TABLE ${DDL_TABLE} (A INT)` });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0 });
      expect(await ddlTableCount()).toBe(1);
    } finally {
      await run(sqlExecuteTool, { query: `DROP TABLE ${DDL_TABLE}` });
    }
    expect(await ddlTableCount()).toBe(0);
  }, 60000);

  it("a CALL runs with no transaction from the tool, and its writes are kept", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `CALL ${FN("WriteRow")}` });

    expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0 });
    expect(await auditRows()).toBe(1);
  }, 60000);

  it("the default path and a capped SELECT run with no transaction: the function sees $TLEVEL 0", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const plain = await run(sqlExecuteTool, { query: `SELECT ${FN("Level")} AS lvl` });
    const capped = await run(sqlExecuteTool, { query: `SELECT ${FN("Level")} AS lvl`, maxRowsAffected: 0 });

    expect(plain.structuredContent).toMatchObject({ rows: [[0]] });
    expect(capped.structuredContent).toMatchObject({ rows: [[0]] });
  }, 60000);

  it("read-only runs inside a transaction: the function sees $TLEVEL 1, and a default-path call that follows sees 0", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const readOnly = await run(sqlQueryTool, { query: `SELECT ${FN("Level")} AS lvl` });
    const after = await run(sqlExecuteTool, { query: `SELECT ${FN("Level")} AS lvl` });

    expect(readOnly.structuredContent).toMatchObject({ rows: [[1]] });
    expect(after.structuredContent).toMatchObject({ rows: [[0]] });
  }, 60000);

  it("device output a function writes is discarded on every path, and the response still parses", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const results = [
      await run(sqlExecuteTool, { query: `SELECT ${FN("Noise")} AS v` }),
      await run(sqlExecuteTool, { query: `SELECT ${FN("Noise")} AS v`, readOnly: true }),
      await run(sqlQueryTool, { query: `SELECT ${FN("Noise")} AS v` }),
    ];

    for (const result of results) {
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ columns: ["v"], rows: [[1]], rowCount: 1 });
    }
  }, 60000);

  it("a SQL error carries the SQLCODE and the IRIS message, from the new route", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: "SELEC 1" });

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text.startsWith("SQL error: IRIS reported errors for POST /api/executemcp/v2/dev/sql/execute.")).toBe(true);
    expect(text).toContain("SQLCODE: -51");
    expect(text).toContain("An SQL statement expected, IDENTIFIER found");
  }, 60000);

  it("a multi-statement query is refused by IRIS at prepare (SQLCODE -25) and runs nothing", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `SELECT 1; DELETE FROM ${T}` });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("SQLCODE: -25");
    expect(await gateRows()).toBe(SEEDED_ROWS);
  }, 60000);
});

// -- The rows-affected cap (AC-3, AC-7) ------------------------------

describe("the rows-affected cap (Story 38.5, AC-3, AC-7)", () => {
  reseedBeforeEach();

  async function expectUntouched(): Promise<void> {
    expect(await gateRows()).toBe(SEEDED_ROWS);
    expect(await auditRows()).toBe(0);
  }

  it("a DELETE over the cap, by parameter, is rolled back: the rows and the audit rows are intact, the trigger's counter moved", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `DELETE FROM ${T} WHERE ${DEL_WHERE}`, maxRowsAffected: 2 });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "SQL_ROWS_AFFECTED_CAP",
      namespace: IRIS_NAMESPACE,
      statementType: "DELETE",
      rowsAffected: DEL_ROWS,
      maxRowsAffected: 2,
      capSource: "parameter",
    });
    expect(result.content[0]?.text).toBe(
      `Statement was rolled back in namespace '${IRIS_NAMESPACE}': the DELETE affected ${DEL_ROWS} rows, more than the cap of 2 (from maxRowsAffected). ` +
        "Its row changes were undone. Narrow the statement to at most 2 rows, or raise maxRowsAffected.",
    );
    await expectUntouched();
    expect(await scalar(`SELECT COUNT(*) FROM ${T} WHERE ${DEL_WHERE}`)).toBe(DEL_ROWS);
    // The recorded residual: a rollback does not undo $INCREMENT.
    expect(await callClassMethod(GATE, "Counters")).toBe(`${DEL_ROWS}|`);
  }, 60000);

  it("a DELETE over the operator ceiling (ctx.config.sqlMaxRowsAffected) is rolled back, with capSource operator, whatever the caller asks", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const operator = ctxWith({ sqlMaxRowsAffected: 2 });

    for (const args of [{}, { maxRowsAffected: 50 }]) {
      const result = await run(sqlExecuteTool, { query: `DELETE FROM ${T} WHERE ${DEL_WHERE}`, ...args }, operator);

      expect(result.isError, JSON.stringify(args)).toBe(true);
      expect(result.structuredContent, JSON.stringify(args)).toEqual({
        code: "SQL_ROWS_AFFECTED_CAP",
        namespace: IRIS_NAMESPACE,
        statementType: "DELETE",
        rowsAffected: DEL_ROWS,
        maxRowsAffected: 2,
        capSource: "operator",
      });
      await expectUntouched();
    }
  }, 60000);

  it("maxRowsAffected 0 is a dry count: an UPDATE of 6 rows is rolled back and the count is reported", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `UPDATE ${T} SET Qty = 99 WHERE ${DEL_WHERE}`, maxRowsAffected: 0 });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { rowsAffected: number }).rowsAffected).toBe(DEL_ROWS);
    expect(await scalar(`SELECT COUNT(*) FROM ${T} WHERE Qty = 99`)).toBe(0);
  }, 60000);

  it("a DELETE within the cap commits: rowsAffected, the rows gone, and the trigger's audit rows kept", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `DELETE FROM ${T} WHERE ${DEL_WHERE}`, maxRowsAffected: 10 });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: DEL_ROWS });
    expect(await gateRows()).toBe(SEEDED_ROWS - DEL_ROWS);
    expect(await auditRows()).toBe(DEL_ROWS);
  }, 60000);

  it("a DELETE within the operator ceiling commits and reports maxRowsAffectedCapped", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `DELETE FROM ${T} WHERE ${DEL_WHERE}` }, ctxWith({ sqlMaxRowsAffected: 10 }));

    expect(result.structuredContent).toEqual({
      columns: [],
      rows: [],
      rowCount: 0,
      rowsAffected: DEL_ROWS,
      maxRowsAffectedCapped: true,
    });
    expect(await gateRows()).toBe(SEEDED_ROWS - DEL_ROWS);
  }, 60000);

  it("an INSERT within the cap commits", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `INSERT INTO ${TA} (Note) VALUES (?)`, parameters: ["manual"], maxRowsAffected: 1 });

    expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: 1 });
    expect(await auditRows()).toBe(1);
  }, 60000);

  it("TRUNCATE TABLE under a cap reports -1 and is rolled back with the rows intact", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await run(sqlExecuteTool, { query: `INSERT INTO ${TA} (Note) SELECT 'row' FROM ${T} WHERE ${DEL_WHERE}` });
    expect(await auditRows()).toBe(DEL_ROWS);

    const result = await run(sqlExecuteTool, { query: `TRUNCATE TABLE ${TA}`, maxRowsAffected: 1000 });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ code: "SQL_ROWS_AFFECTED_CAP", rowsAffected: -1, maxRowsAffected: 1000 });
    expect(result.content[0]?.text).toContain("affected an unknown number of rows (IRIS reports -1, as it does for TRUNCATE TABLE)");
    expect(await auditRows()).toBe(DEL_ROWS);
  }, 60000);

  it("a CALL under a cap is refused before it runs: its write does not happen", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `CALL ${FN("WriteRow")}`, maxRowsAffected: 100 });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "SQL_ROWS_AFFECTED_CAP",
      namespace: IRIS_NAMESPACE,
      statementType: "CALL",
      maxRowsAffected: 100,
      capSource: "parameter",
    });
    expect(await auditRows()).toBe(0);
  }, 60000);

  it("DDL under a cap is refused before it runs", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `CREATE TABLE ${DDL_TABLE} (A INT)`, maxRowsAffected: 100 });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { statementType: string }).statementType).toBe("CREATE TABLE");
    expect(await ddlTableCount()).toBe(0);
  }, 60000);

  it("a SELECT under a cap runs as it does without one", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const query = `SELECT Name, Qty FROM ${T} WHERE Name IN ('alpha', 'beta') ORDER BY ID`;

    const result = await run(sqlExecuteTool, { query, maxRowsAffected: 0 });

    expect(result.structuredContent).toEqual(todayMapping(await atelierRows(query)));
  }, 60000);

  it("a function that ends the transaction of a capped UPDATE is reported", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `UPDATE ${T} SET Qty = ${FN("EndTx")} WHERE Name = 'del1'`, maxRowsAffected: 5 });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      `Statement changed the transaction this tool opened in namespace '${IRIS_NAMESPACE}': a function, procedure or trigger it ran ` +
        "started, committed or rolled back a transaction, so the tool could not check or undo its effects reliably and " +
        "some changes may be saved. Check the data the statement touches before running it again.",
    );
    const after = await run(sqlExecuteTool, { query: `SELECT ${FN("Level")} AS lvl` });
    expect(after.structuredContent).toMatchObject({ rows: [[0]] });
  }, 60000);

  it("a function that ends the transaction of a capped UPDATE that then fails is reported as the changed transaction, not as a SQL error", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, {
      query: `UPDATE ${T} SET Qty = 1 / (${FN("EndTx")} - 1) WHERE Name = 'del1'`,
      maxRowsAffected: 5,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(`Statement changed the transaction this tool opened in namespace '${IRIS_NAMESPACE}'`);
  }, 60000);

  it("a function that opens a transaction inside a capped UPDATE is reported the same way", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `UPDATE ${T} SET Qty = ${FN("OpenTx")} WHERE Name = 'del1'`, maxRowsAffected: 5 });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toContain(`Statement changed the transaction this tool opened in namespace '${IRIS_NAMESPACE}'`);
    const after = await run(sqlExecuteTool, { query: `SELECT ${FN("Level")} AS lvl` });
    expect(after.structuredContent).toMatchObject({ rows: [[0]] });
  }, 60000);
});

// -- Read-only mode (AC-2, AC-7) -------------------------------------

describe("read-only mode (Story 38.5, AC-2, AC-7)", () => {
  reseedBeforeEach();

  async function quantities(): Promise<unknown[]> {
    return (await atelierRows(`SELECT Qty FROM ${T} ORDER BY ID`)).map((row) => row.Qty);
  }

  it("readOnly refuses an UPDATE and the values are unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await quantities();

    const result = await run(sqlExecuteTool, { query: `UPDATE ${T} SET Qty = 99`, readOnly: true });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "SQL_READ_ONLY",
      namespace: IRIS_NAMESPACE,
      statementType: "UPDATE",
      readOnlySource: "parameter",
    });
    expect(await quantities()).toEqual(before);
  }, 60000);

  it("ctx.config.sqlReadOnly refuses an UPDATE and a DELETE even when readOnly:false is passed, and the data is unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const operator = ctxWith({ sqlReadOnly: true });
    const before = await quantities();

    for (const query of [`UPDATE ${T} SET Qty = 99`, `DELETE FROM ${T}`]) {
      const result = await run(sqlExecuteTool, { query, readOnly: false }, operator);

      expect(result.isError, query).toBe(true);
      expect((result.structuredContent as { readOnlySource: string }).readOnlySource, query).toBe("operator");
    }
    expect(await quantities()).toEqual(before);
    expect(await gateRows()).toBe(SEEDED_ROWS);
    expect(await auditRows()).toBe(0);
  }, 60000);

  it("iris_sql_query refuses DML, DDL and CALL, and runs a SELECT and a CTE SELECT", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    for (const query of [`DELETE FROM ${T}`, `CALL ${FN("WriteRow")}`, `CREATE TABLE ${DDL_TABLE} (A INT)`, `WITH c AS (SELECT 1 AS a) DELETE FROM ${T} WHERE 1 = 0`]) {
      const result = await run(sqlQueryTool, { query });
      expect(result.isError, query).toBe(true);
      expect((result.structuredContent as { code: string; readOnlySource: string }), query).toMatchObject({ code: "SQL_READ_ONLY", readOnlySource: "tool" });
    }
    const select = await run(sqlQueryTool, { query: "WITH c AS (SELECT 1 AS a) SELECT a FROM c" });
    expect(select.structuredContent).toEqual({ columns: ["a"], rows: [[1]], rowCount: 1 });
    expect(await gateRows()).toBe(SEEDED_ROWS);
    expect(await ddlTableCount()).toBe(0);
    expect(await auditRows()).toBe(0);
  }, 60000);

  it("IRIS_SQL_READ_ONLY forces a SELECT read-only and the result says so", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: "SELECT 1 AS a" }, ctxWith({ sqlReadOnly: true }));

    expect(result.structuredContent).toEqual({ columns: ["a"], rows: [[1]], rowCount: 1, readOnlyForced: true });
  }, 60000);

  it("a SELECT that calls a function has its SQL write and its journaled global set undone, and its counter not", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlQueryTool, { query: `SELECT ${FN("SideEffect")} AS v` });

    expect(result.structuredContent).toEqual({ columns: ["v"], rows: [[1]], rowCount: 1 });
    expect(await auditRows()).toBe(0);
    // Marker empty (the journaled set was undone), counter 1 (the $INCREMENT was not).
    expect(await callClassMethod(GATE, "Counters")).toBe("1|");
  }, 60000);

  it("the same SELECT on the default path keeps all of it", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    await run(sqlExecuteTool, { query: `SELECT ${FN("SideEffect")} AS v` });

    expect(await auditRows()).toBe(1);
    expect(await callClassMethod(GATE, "Counters")).toBe("1|set");
  }, 60000);

  it("a SELECT whose function ends the transaction is reported, and what the function committed stays", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlQueryTool, { query: `SELECT ${FN("EndTx")} AS v` });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toContain(`Statement changed the transaction this tool opened in namespace '${IRIS_NAMESPACE}'`);
    expect(await auditRows()).toBe(1);
    const after = await run(sqlQueryTool, { query: `SELECT ${FN("Level")} AS lvl` });
    expect(after.structuredContent).toMatchObject({ rows: [[1]] });
  }, 60000);

  it("a SELECT whose function ends the transaction and that then fails is reported as the changed transaction, not as a SQL error, and what the function committed stays", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlQueryTool, { query: `SELECT 1 / (${FN("EndTx")} - 1) AS v` });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toContain(`Statement changed the transaction this tool opened in namespace '${IRIS_NAMESPACE}'`);
    expect(await auditRows()).toBe(1);
  }, 60000);

  it("a SELECT whose function opens a transaction is reported the same way", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlQueryTool, { query: `SELECT ${FN("OpenTx")} AS v` });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toContain(`Statement changed the transaction this tool opened in namespace '${IRIS_NAMESPACE}'`);
    const after = await run(sqlExecuteTool, { query: `SELECT ${FN("Level")} AS lvl` });
    expect(after.structuredContent).toMatchObject({ rows: [[0]] });
  }, 60000);

  it("read-only and a cap together: read-only governs, so a SELECT runs and an UPDATE is refused as read-only", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const select = await run(sqlExecuteTool, { query: "SELECT 1 AS a", readOnly: true, maxRowsAffected: 0 });
    const update = await run(sqlExecuteTool, { query: `UPDATE ${T} SET Qty = 99`, readOnly: true, maxRowsAffected: 0 });

    expect(select.structuredContent).toEqual({ columns: ["a"], rows: [[1]], rowCount: 1 });
    expect((update.structuredContent as { code: string }).code).toBe("SQL_READ_ONLY");
  }, 60000);
});

// -- countOnly (AC-4, AC-7) ------------------------------------------

describe("countOnly (Story 38.5, AC-4, AC-7)", () => {
  reseedBeforeEach();

  for (const tool of [sqlExecuteTool, sqlQueryTool]) {
    it(`${tool.name}: totalCount equals the COUNT(*) that action/query returns, and no rows are transferred`, async (testCtx) => {
      if (skipReason) return testCtx.skip();

      const result = await run(tool, { query: `SELECT ID, Name, Doc FROM ${T}`, countOnly: true });

      const expected = await scalar(`SELECT COUNT(*) FROM ${T}`);
      expect(expected).toBe(SEEDED_ROWS);
      expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, totalCount: expected });
      const raw = await endpointResult({ query: `SELECT ID, Name, Doc FROM ${T}`, countOnly: true });
      expect(raw.content).toEqual([]);
      expect(raw.totalCount).toBe(expected);
    }, 60000);
  }

  it("a filtered count, a zero count and a count past maxRows and IRIS_SQL_MAX_ROWS", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const filtered = await run(sqlQueryTool, { query: `SELECT ID FROM ${T} WHERE ${DEL_WHERE}`, countOnly: true });
    const none = await run(sqlQueryTool, { query: `SELECT ID FROM ${T} WHERE 1 = 0`, countOnly: true });
    const large = await run(sqlQueryTool, { query: `SELECT ID FROM ${T}`, countOnly: true, maxRows: 1 }, ctxWith({ sqlMaxRows: 1 }));

    expect(filtered.structuredContent).toMatchObject({ rowCount: 0, totalCount: DEL_ROWS });
    expect(none.structuredContent).toMatchObject({ rowCount: 0, totalCount: 0 });
    expect(large.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, totalCount: SEEDED_ROWS });
  }, 60000);

  it("countOnly on a non-query runs nothing", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `DELETE FROM ${T}`, countOnly: true });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      "countOnly counts the rows a query returns, and this is a DELETE statement, so nothing was run. Remove countOnly, or pass a SELECT.",
    );
    expect(await gateRows()).toBe(SEEDED_ROWS);
  }, 60000);
});

// -- SQL errors at execution (AC-2, AC-3, AC-7) ----------------------

describe("a statement that prepares and then fails to run is an error, never a result (Story 38.5, AC-2, AC-3, AC-7)", () => {
  reseedBeforeEach();

  /** A value no %Integer column accepts: IRIS prepares the UPDATE and rejects it at execution (SQLCODE -105). */
  const BAD_UPDATE = `UPDATE ${T} SET Qty = 'abc' WHERE Name = 'del1'`;

  async function expectExecutionError(result: Awaited<ReturnType<typeof run>>, sqlcode: string): Promise<void> {
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text.startsWith("SQL error: IRIS reported errors for POST /api/executemcp/v2/dev/sql/execute.")).toBe(true);
    expect(text).toContain(`SQLCODE: ${sqlcode}`);
  }

  it("on the default path: the SQLCODE and message are reported and the row is unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: BAD_UPDATE });

    await expectExecutionError(result, "-105");
    expect(await scalar(`SELECT COUNT(*) FROM ${T} WHERE Qty = 1`)).toBe(DEL_ROWS);
  }, 60000);

  it("under a cap: the same error, and not a clean result with rowsAffected 0", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: BAD_UPDATE, maxRowsAffected: 10 });

    await expectExecutionError(result, "-105");
    expect(await scalar(`SELECT COUNT(*) FROM ${T} WHERE Qty = 1`)).toBe(DEL_ROWS);
  }, 60000);

  it("under read-only: a query that fails while running is the same kind of error, and a call that follows still runs", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlQueryTool, { query: "SELECT 1/0 AS x" });

    await expectExecutionError(result, "-400");
    const after = await run(sqlExecuteTool, { query: `SELECT ${FN("Level")} AS lvl` });
    expect(after.structuredContent).toMatchObject({ rows: [[0]] });
  }, 60000);
});

// -- The namespace a call names (Rules #34, #59) ----------------------

describe("the namespace the call names (Story 38.5, Rules #34 and #59)", () => {
  /** A class that exists in exactly one of the two namespaces below. */
  const PROBE = "SELECT COUNT(*) AS n FROM %Dictionary.ClassDefinition WHERE Name = 'Security.Users'";
  const OTHER_NAMESPACE = IRIS_NAMESPACE.toUpperCase() === "%SYS" ? "USER" : "%SYS";

  const countIn = async (namespace: string): Promise<unknown> => (await runQuery(client, version, namespace, PROBE))[0]?.n;

  it("both tools answer for the namespace they name, errors included, and a call that names the home namespace answers for it", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const here = await countIn(IRIS_NAMESPACE);
    const there = await countIn(OTHER_NAMESPACE);
    // The oracle must differ between the namespaces, or the assertions below could not fail.
    expect(there, `${PROBE} must differ between ${IRIS_NAMESPACE} and ${OTHER_NAMESPACE}`).not.toBe(here);

    for (const tool of [sqlExecuteTool, sqlQueryTool]) {
      const named = await run(tool, { query: PROBE, namespace: OTHER_NAMESPACE });
      expect(named.structuredContent, `${tool.name} in ${OTHER_NAMESPACE}`).toMatchObject({ rows: [[there]] });

      const failed = await run(tool, { query: "SELEC 1", namespace: OTHER_NAMESPACE });
      expect(failed.isError).toBe(true);

      const back = await run(tool, { query: PROBE });
      expect(back.structuredContent, `${tool.name} back in ${IRIS_NAMESPACE}`).toMatchObject({ rows: [[here]] });
    }
  }, 60000);

  it("a refusal and a refused cap name the namespace the call asked for", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    // COMMIT prepares in every namespace and changes nothing, so a missing check cannot touch the other namespace's data.
    const readOnly = await run(sqlExecuteTool, { query: "COMMIT", readOnly: true, namespace: OTHER_NAMESPACE });
    const capped = await run(sqlExecuteTool, { query: "COMMIT", maxRowsAffected: 1, namespace: OTHER_NAMESPACE });

    expect(readOnly.structuredContent).toMatchObject({ code: "SQL_READ_ONLY", statementType: "COMMIT", namespace: OTHER_NAMESPACE });
    expect(capped.structuredContent).toMatchObject({ code: "SQL_ROWS_AFFECTED_CAP", statementType: "COMMIT", namespace: OTHER_NAMESPACE });
  }, 60000);
});

// -- The handler's own input checks (the tools never send these) ------

describe("the endpoint rejects a malformed body before it runs anything (Story 38.5, AC-2, AC-3)", () => {
  const BODIES: Array<[string, Record<string, unknown>, RegExp]> = [
    ["an empty query", { query: "" }, /Required parameter 'query'/],
    ["a maxRowsAffected that is not a non-negative integer", { query: "SELECT 1", maxRowsAffected: "abc" }, /'maxRowsAffected' must be a non-negative integer/],
    ["a negative maxRowsAffected", { query: "SELECT 1", maxRowsAffected: -1 }, /'maxRowsAffected' must be a non-negative integer/],
    ["a readOnly that is not a boolean", { query: "SELECT 1", readOnly: "maybe" }, /'readOnly' must be a boolean/],
    ["a countOnly that is not a boolean", { query: "SELECT 1", countOnly: "maybe" }, /'countOnly' must be a boolean/],
    ["parameters that are not an array", { query: "SELECT 1", parameters: "x" }, /'parameters' must be an array/],
  ];

  for (const [label, body, message] of BODIES) {
    it(`${label}`, async (testCtx) => {
      if (skipReason) return testCtx.skip();

      await expect(client.post(SQL_PATH, { namespace: IRIS_NAMESPACE, ...body })).rejects.toThrow(message);
    }, 60000);
  }

  it("a body that names a namespace that does not exist runs nothing, and a call that follows still runs", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    await expect(client.post(SQL_PATH, { query: "SELECT 1", namespace: "NoSuchNamespaceQa385" })).rejects.toThrow();
    const after = await run(sqlExecuteTool, { query: "SELECT 1 AS a" });
    expect(after.structuredContent).toEqual({ columns: ["a"], rows: [[1]], rowCount: 1 });
  }, 60000);
});
