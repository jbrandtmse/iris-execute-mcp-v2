/**
 * Story 38.5 (QA) - the SQL write-safety controls on the REAL wire.
 *
 * `sql-safety-live-gate.test.ts` (iris-dev-mcp) drives the tool handlers against the real
 * `/dev/sql/execute` route with hand-built contexts, and `sql-safety.test.ts` /
 * `sql-query-governance.test.ts` drive them against mock HTTP. Neither follows an operator's setting
 * the way a client does: an environment variable, read by the BUILT server's `loadConfig`, inherited
 * by a profile, applied by the real governance gate, checked by the SDK's argument parsing, and
 * enforced by IRIS. This gate spawns the BUILT iris-dev-mcp dist as a child process, connects the
 * real MCP SDK `Client` over stdio, and calls the tools against the live IRIS, so these properties
 * are proven where they happen. Before any test it asserts that the deployed `ExecuteMCPv2` classes
 * carry the `BOOTSTRAP_VERSION` of the built shared dist (the version check of `process-gate-helpers.ts`):
 *
 *  - `tools/list` shows both tools' schemas and annotations (no `readOnly`/`maxRowsAffected` on
 *    `iris_sql_query`, the frozen annotations on `iris_sql_execute`), and `iris_server_profiles`
 *    reports the default verdicts;
 *  - with no SQL variable set, a query and a DML statement answer as the Atelier `action/query` route
 *    does (the oracle), `rowsAffected` is the change IRIS made, and `countOnly` equals a `COUNT(*)`;
 *  - `IRIS_SQL_READ_ONLY` (any letter case) refuses UPDATE, DELETE, a CALL and DDL with the rows, the
 *    CALL's marker global and the table list unchanged, a `readOnly:false` argument cannot weaken it,
 *    and `IRIS_SQL_READ_ONLY=false` is a real "off" (the same statement then runs);
 *  - `IRIS_SQL_MAX_ROWS_AFFECTED` (a ceiling of 2, and 0) rolls back a DELETE over the cap with the
 *    rows intact whatever larger `maxRowsAffected` the call passes, lets one within it commit, refuses
 *    TRUNCATE, a CALL and DDL, and a caller's smaller cap (0 included) wins;
 *  - the SQLCODE and the IRIS message reach the client in the error text, for a prepare error and an
 *    execution error;
 *  - `IRIS_GOVERNANCE_PRESET=read-only` leaves `iris_sql_query` usable (and statement-level read-only)
 *    while `iris_sql_execute` is denied; an explicit disable of `iris_sql_execute` is inherited by
 *    `iris_sql_query` (`inheritedFrom`, source `parent`) from the env layer and from a real
 *    `IRIS_GOVERNANCE_FILE` (global and profile layers), an explicit `iris_sql_query: true` wins, an env
 *    `iris_sql_execute: true` outranks a file `false`, and hiding the parent with `IRIS_TOOLS_DISABLE`
 *    does not disable the child;
 *  - the built `iris-mcp-governance universe --json` process agrees with the server on every key;
 *  - an `IRIS_PROFILES` profile inherits both operator variables, and a per-profile key cannot loosen
 *    them;
 *  - a malformed `IRIS_SQL_READ_ONLY` / `IRIS_SQL_MAX_ROWS_AFFECTED` stops the server at startup,
 *    naming the variable.
 *
 * Expected values come from the live Atelier route and from the Story 38.5 intent contract (the
 * texts and shapes), never from the implementation (Rule #36).
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, defaulting to the
 * dev instance at localhost:52773 / HSCUSTOM; every call names `server: "default"` (or the profile it
 * tests) and the namespace. Writes only the disposable `ExecuteMCPv2.Temp.QaStory385Wire.cls`
 * (persistent, compiled, six rows) document, its data globals and the marker global
 * `^ExecuteMCPv2.QaStory385WireM`, plus `ExecuteMCPv2.Temp.QaStory385WireDdl` if a DDL refusal were to
 * fail; it removes them before and after the run and asserts that nothing named `QaStory385Wire` is
 * left.
 *
 * Placement (Rule #45): `@iris-mcp/all` spawns built dists. A missing or stale `shared` or
 * `iris-dev-mcp` dist, an unresolvable SDK or an unreachable IRIS skips each test with the reason, or
 * fails when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs` `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  assertDeployedBootstrapVersion,
  atelierQuery,
  atelierScalar,
  connectionEnv,
  docFixtures,
  governanceDenial,
  governanceReport,
  inheritedEnv,
  irisTargetFromEnv,
  isIrisReachable,
  openWireSession,
  resolveSdkEsmDir,
  spawnAndWaitForExit,
  staleDistReason,
  stemFixtures,
  withWireSession,
  type AtelierRow,
  type DocFixtures,
  type StemFixtures,
  type WireSession as Session,
  type WireSessionOptions,
  type WireToolResult,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");
const GOVERNANCE_CLI_BIN = path.join(REPO_ROOT, "packages", "shared", "dist", "cli", "governance-cli.js");

const TARGET = irisTargetFromEnv();
const IRIS_HOST = TARGET.host;
const IRIS_PORT = TARGET.port;
const IRIS_USERNAME = TARGET.username;
const IRIS_PASSWORD = TARGET.password;
const NS = TARGET.namespace;

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const STEM = "QaStory385Wire";
const CLASS = `ExecuteMCPv2.Temp.${STEM}`;
const DOC = `${CLASS}.cls`;
/** The class IRIS would generate if a DDL statement were wrongly run. */
const DDL_DOC = `${CLASS}Ddl.cls`;
/** The SQL table of the fixture class, and the table of the DDL probe. */
const T = `ExecuteMCPv2_Temp.${STEM}`;
const DDL_TABLE = `${T}Ddl`;
/** The SQL procedure that sets the marker global. */
const BUMP = `${T}_Bump()`;
const SEEDED_ROWS = 6;

// -- The wire --------------------------------------------------------

let distSkipReason: string | undefined;
let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let admin: Session;
/** The document helpers and the fixture oracles of `admin`, bound when called, so a teardown after a failed start-up still reaches the tools. */
const docs = (): DocFixtures => docFixtures(admin);
const fixtures = (): StemFixtures => stemFixtures(admin, STEM);

/** The built dev server and the target, for the shared wire helpers. */
function wireOptions(): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: DEV_ENTRY, target: TARGET, clientName: "story-38-5-qa-wire-gate" };
}

/** Spawn the built dev server with `extraEnv` on top of the explicit connection settings, and connect an SDK client over stdio. */
const openSession = (extraEnv: Record<string, string> = {}): Promise<Session> => openWireSession(wireOptions(), extraEnv);

/** Run `body` with a session whose server was started with `extraEnv`, and always close it. */
const withSession = <T>(extraEnv: Record<string, string>, body: (session: Session) => Promise<T>): Promise<T> =>
  withWireSession(wireOptions(), extraEnv, body);

// -- The oracle: the Atelier action/query route ----------------------

type Row = AtelierRow;

/** The rows the Atelier `action/query` route returns for a statement (it never goes through the new endpoint). */
const atelier = (query: string): Promise<Row[]> => atelierQuery(TARGET, query);

/** The fixture table as stored: every row, in ID order. */
const tableRows = (): Promise<Row[]> => atelier(`SELECT ID, Name, Qty FROM ${T} ORDER BY ID`);

const rowTotal = (): Promise<number> => atelierScalar(TARGET, `SELECT COUNT(*) AS N FROM ${T}`);
const ddlTableCount = (): Promise<number> =>
  atelierScalar(
    TARGET,
    `SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'ExecuteMCPv2_Temp' AND TABLE_NAME = '${STEM}Ddl'`,
  );

/** The marker global the `Bump` procedure sets: "" when it has not run since the last seed. */
async function marker(): Promise<string> {
  const result = await admin.call("iris_execute_classmethod", { className: CLASS, methodName: "Marker" });
  expect(result.isError, "reading the marker").toBeFalsy();
  return String((result.structuredContent as { returnValue: unknown }).returnValue);
}

// -- Fixtures --------------------------------------------------------

/** The fixture class: two columns, a SQL procedure that sets a marker global, a seed and a marker reader. */
const SOURCE = [
  `Class ${CLASS} Extends %Persistent`,
  "{",
  "",
  'Parameter DEFAULTGLOBAL = "^ExecuteMCPv2.QaStory385WireD";',
  "",
  "Property Name As %String;",
  "",
  "Property Qty As %Integer;",
  "",
  "ClassMethod Bump() As %Integer [ SqlProc ]",
  "{",
  '    Set ^ExecuteMCPv2.QaStory385WireM = "bumped"',
  "    Quit 1",
  "}",
  "",
  "ClassMethod Seed() As %String",
  "{",
  "    Kill ^ExecuteMCPv2.QaStory385WireM",
  "    Do ..%KillExtent()",
  "    For tI = 1:1:6 {",
  "        Set tObj = ..%New()",
  '        Set tObj.Name = "row"_tI',
  "        Set tObj.Qty = tI",
  "        Set tSC = tObj.%Save()",
  "    }",
  '    Quit "seeded"',
  "}",
  "",
  "ClassMethod Marker() As %String",
  "{",
  '    Quit $Get(^ExecuteMCPv2.QaStory385WireM, "")',
  "}",
  "",
  "}",
].join("\n");

/** Remove everything the gate writes: the data and marker globals, a stray DDL table, then the documents. */
async function removeFixtures(): Promise<void> {
  await fixtures().killGlobals();
  if ((await fixtures().documents()).includes(DDL_DOC)) {
    await admin.call("iris_sql_execute", { query: `DROP TABLE IF EXISTS ${DDL_TABLE}` });
  }
  for (const docName of [DOC, DDL_DOC]) await docs().removeDoc(docName);
}

/** The six seeded rows, `row1`..`row6` with Qty 1..6, and an empty marker. */
async function seed(): Promise<void> {
  const result = await admin.call("iris_execute_classmethod", { className: CLASS, methodName: "Seed" });
  expect(result.isError, `seeding: ${result.content?.[0]?.text}`).toBeFalsy();
  expect((result.structuredContent as { returnValue: unknown }).returnValue).toBe("seeded");
  expect(await rowTotal(), "the seeded rows").toBe(SEEDED_ROWS);
  expect(await marker(), "the marker after a seed").toBe("");
}

beforeAll(async () => {
  const sharedStale = staleDistReason(REPO_ROOT, "shared");
  distSkipReason = sharedStale ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
  if (!distSkipReason) {
    sdkEsmDir = resolveSdkEsmDir(REPO_ROOT);
    if (!sdkEsmDir) {
      distSkipReason =
        "Could not resolve the @modelcontextprotocol/client ESM build under node_modules/.pnpm - run pnpm install from the repo root.";
    }
  }
  skipReason = distSkipReason;
  if (!skipReason && !(await isIrisReachable(IRIS_HOST, IRIS_PORT))) {
    skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT}/api/atelier/ (set IRIS_HOST/IRIS_PORT to point at a live instance).`;
  }
  if ((skipReason || distSkipReason) && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Story 38.5 wire gate may not be skipped: ${skipReason ?? distSkipReason}`);
  }
  if (skipReason) return;

  admin = await openSession();
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  await removeFixtures();
  expect(await fixtures().documents(), "no QaStory385Wire document before the run").toEqual([]);
  expect(await fixtures().globals(), "no QaStory385Wire global before the run").toEqual([]);

  await docs().putDoc(DOC, SOURCE);
  await docs().compileDoc(DOC);
}, 120000);

afterAll(async () => {
  if (skipReason) return;
  try {
    await removeFixtures();
    expect(await fixtures().documents(), "no QaStory385Wire document after the run").toEqual([]);
    expect(await fixtures().globals(), "no QaStory385Wire global after the run").toEqual([]);
  } finally {
    await admin.close();
  }
}, 90000);

// -- Expected texts and shapes (the Story 38.5 intent contract) -----

const ROW_SELECT = `SELECT Name, Qty FROM ${T} ORDER BY ID`;

/** The RO text for a statement type, with the remedy of its source. */
function readOnlyText(typeName: string, remedy: string): string {
  return (
    `Statement was not run in namespace '${NS}': it is a ${typeName} statement, and read-only mode runs only queries (SELECT). ` +
    `Nothing was changed. ${remedy}`
  );
}

const OPERATOR_RO_REMEDY = "The operator's IRIS_SQL_READ_ONLY setting makes every call read-only; run a SELECT instead.";
const TOOL_RO_REMEDY = "iris_sql_query runs only queries; run other statements with iris_sql_execute.";

/** The CAP not-run text for a statement type under a cap from the operator. */
function capNotRunOperatorText(typeName: string, cap: number): string {
  return (
    `Statement was not run in namespace '${NS}': it is a ${typeName} statement, and under a rows-affected cap ` +
    `(${cap}, from IRIS_SQL_MAX_ROWS_AFFECTED) only SELECT, INSERT, UPDATE and DELETE run, because those are the statements ` +
    "whose affected rows IRIS counts. Nothing was changed. The operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling applies to every call, " +
    "so this statement cannot run through iris_sql_execute here."
  );
}

/** The text content parsed as JSON (a successful SQL result's text block is its structured content). */
function textJson(result: WireToolResult): unknown {
  return JSON.parse(result.content?.[0]?.text ?? "null");
}

// -- The tools as a client sees them ---------------------------------

describe("the SQL tools on the wire, no SQL variable set (Story 38.5, AC-4, AC-5, AC-6)", () => {
  it("tools/list shows both schemas and annotations, and iris_server_profiles reports iris_sql_query enabled by default", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const tools = await admin.listTools();
    const query = tools.find((tool) => tool.name === "iris_sql_query");
    const execute = tools.find((tool) => tool.name === "iris_sql_execute");
    expect(query, "iris_sql_query is listed").not.toBeUndefined();
    expect(execute, "iris_sql_execute is listed").not.toBeUndefined();

    const queryProps = Object.keys(query?.inputSchema.properties ?? {}).sort();
    expect(queryProps).toEqual(["countOnly", "maxRows", "namespace", "parameters", "query", "server"]);
    expect(query?.inputSchema.required).toEqual(["query"]);
    expect(query?.annotations).toMatchObject({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    const executeProps = Object.keys(execute?.inputSchema.properties ?? {}).sort();
    expect(executeProps).toEqual(
      ["countOnly", "maxRows", "maxRowsAffected", "namespace", "parameters", "query", "readOnly", "server"],
    );
    expect(execute?.inputSchema.required).toEqual(["query"]);
    // The frozen tool keeps its annotations and gains no `action` enum.
    expect(execute?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
    expect(execute?.inputSchema.properties?.action).toBeUndefined();

    for (const tool of [query, execute]) {
      expect(tool?.description, `${tool?.name} description`).toContain("statement-level read-only, not side-effect-free");
      expect(tool?.description, `${tool?.name} names no REST path`).not.toContain("/api/");
    }
    expect(execute?.description).toContain("IRIS_SQL_READ_ONLY");
    expect(execute?.description).toContain("IRIS_SQL_MAX_ROWS_AFFECTED");

    const { policy, configSource } = await governanceReport(admin);
    expect(policy["iris_sql_query"]).toBe(true);
    expect(configSource["iris_sql_query"]).toBe("default");
    expect(policy["iris_sql_execute"]).toBe(true);
    expect(configSource["iris_sql_execute"]).toBe("default");
  }, 60000);

  it("iris_sql_query with only a query answers as action/query does; DML reports rowsAffected and rowCount 0", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();

    // Every optional argument omitted: the SDK parses a call carrying only `query`.
    const read = await admin.call("iris_sql_query", { query: ROW_SELECT });
    expect(read.isError, read.content?.[0]?.text).toBeFalsy();
    const oracle = await atelier(ROW_SELECT);
    expect(oracle).toHaveLength(SEEDED_ROWS);
    expect(read.structuredContent).toEqual({
      columns: ["Name", "Qty"],
      rows: oracle.map((row) => [row.Name, row.Qty]),
      rowCount: SEEDED_ROWS,
    });
    expect(textJson(read)).toEqual(read.structuredContent);

    const update = await admin.call("iris_sql_execute", { query: `UPDATE ${T} SET Qty = Qty + 10 WHERE Qty <= 3` });
    expect(update.isError, update.content?.[0]?.text).toBeFalsy();
    expect(update.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: 3 });
    expect(textJson(update)).toEqual(update.structuredContent);
    expect((await atelier(`SELECT Qty FROM ${T} ORDER BY ID`)).map((row) => row.Qty)).toEqual([11, 12, 13, 4, 5, 6]);

    // A parameterized, row-limited query: the SDK carries the array and the integer.
    const limited = await admin.call("iris_sql_query", {
      query: `SELECT Name FROM ${T} WHERE Qty > ? ORDER BY ID`,
      parameters: [10],
      maxRows: 2,
    });
    expect(limited.structuredContent).toEqual({
      columns: ["Name"],
      rows: [["row1"], ["row2"]],
      rowCount: 2,
      truncated: true,
      totalAvailable: 3,
    });
  }, 120000);

  it("countOnly equals the Atelier COUNT(*) for both tools, transfers no rows, and ignores maxRows", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const where = `Qty > 2`;
    const expected = await atelierScalar(TARGET, `SELECT COUNT(*) AS N FROM ${T} WHERE ${where}`);
    expect(expected).toBe(4);

    for (const tool of ["iris_sql_query", "iris_sql_execute"]) {
      const result = await admin.call(tool, {
        query: `SELECT Name, Qty FROM ${T} WHERE Qty > ?`,
        parameters: [2],
        countOnly: true,
        maxRows: 1,
      });
      expect(result.isError, `${tool}: ${result.content?.[0]?.text}`).toBeFalsy();
      expect(result.structuredContent, tool).toEqual({ columns: [], rows: [], rowCount: 0, totalCount: expected });
    }

    // Without countOnly the same statement returns the rows, and rowCount keeps meaning "rows returned".
    const rows = await admin.call("iris_sql_query", { query: `SELECT Name FROM ${T} WHERE Qty > ?`, parameters: [2] });
    expect((rows.structuredContent as { rowCount: number }).rowCount).toBe(expected);
    expect(rows.structuredContent).not.toHaveProperty("totalCount");
  }, 120000);

  it("countOnly on a non-query runs nothing and says so", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    const result = await admin.call("iris_sql_execute", { query: `DELETE FROM ${T}`, countOnly: true });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    expect(result.content?.[0]?.text).toBe(
      "countOnly counts the rows a query returns, and this is a DELETE statement, so nothing was run. Remove countOnly, or pass a SELECT.",
    );
    expect(await tableRows()).toEqual(before);
  }, 60000);

  it("a prepare error and an execution error carry the SQLCODE and the IRIS message to the client", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const prepare = await admin.call("iris_sql_execute", { query: "SELEC 1" });
    expect(prepare.isError).toBe(true);
    expect(prepare.content?.[0]?.text).toMatch(/^SQL error: /);
    expect(prepare.content?.[0]?.text).toContain("SQLCODE: -51");
    expect(prepare.content?.[0]?.text).toContain("An SQL statement expected");

    const execution = await admin.call("iris_sql_query", { query: "SELECT 1/0 AS x" });
    expect(execution.isError).toBe(true);
    expect(execution.content?.[0]?.text).toMatch(/^SQL error: /);
    expect(execution.content?.[0]?.text).toContain("SQLCODE: -400");

    // A call that follows the failed calls still runs.
    const next = await admin.call("iris_sql_query", { query: "SELECT 1 AS one" });
    expect(next.structuredContent).toEqual({ columns: ["one"], rows: [[1]], rowCount: 1 });
  }, 60000);
});

// -- IRIS_SQL_READ_ONLY -----------------------------------------------

describe("IRIS_SQL_READ_ONLY on the wire (Story 38.5, AC-2)", () => {
  it("TRUE (any letter case) refuses UPDATE, DELETE, a CALL and DDL as the operator's, even with readOnly:false, and changes nothing", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    await withSession({ IRIS_SQL_READ_ONLY: "TRUE" }, async (session) => {
      const statements: Array<[string, string]> = [
        ["UPDATE", `UPDATE ${T} SET Qty = 99`],
        ["DELETE", `DELETE FROM ${T}`],
        ["CALL", `CALL ${BUMP}`],
        ["CREATE TABLE", `CREATE TABLE ${DDL_TABLE} (A INT)`],
      ];
      for (const [typeName, query] of statements) {
        // readOnly omitted, then readOnly:false: neither can weaken the operator's setting.
        for (const args of [{ query }, { query, readOnly: false }]) {
          const result = await session.call("iris_sql_execute", args);
          expect(result.isError, `${typeName} ${JSON.stringify(args)}`).toBe(true);
          expect(result.structuredContent, `${typeName} ${JSON.stringify(args)}`).toEqual({
            code: "SQL_READ_ONLY",
            namespace: NS,
            statementType: typeName,
            readOnlySource: "operator",
          });
          expect(result.content?.[0]?.text).toBe(readOnlyText(typeName, OPERATOR_RO_REMEDY));
        }
      }
    });

    expect(await tableRows(), "the rows are unchanged").toEqual(before);
    expect(await marker(), "the CALL did not run").toBe("");
    expect(await ddlTableCount(), "the DDL did not run").toBe(0);
  }, 120000);

  it("a SELECT through iris_sql_execute runs read-only and is marked readOnlyForced; iris_sql_query and readOnly:true are not", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const oracle = await atelier(ROW_SELECT);
    const mapped = { columns: ["Name", "Qty"], rows: oracle.map((row) => [row.Name, row.Qty]), rowCount: SEEDED_ROWS };

    await withSession({ IRIS_SQL_READ_ONLY: "true" }, async (session) => {
      const forced = await session.call("iris_sql_execute", { query: ROW_SELECT });
      expect(forced.isError, forced.content?.[0]?.text).toBeFalsy();
      expect(forced.structuredContent).toEqual({ ...mapped, readOnlyForced: true });

      const explicit = await session.call("iris_sql_execute", { query: ROW_SELECT, readOnly: true });
      expect(explicit.structuredContent).toEqual(mapped);

      const viaQuery = await session.call("iris_sql_query", { query: ROW_SELECT });
      expect(viaQuery.structuredContent).toEqual(mapped);

      const counted = await session.call("iris_sql_execute", { query: ROW_SELECT, countOnly: true });
      expect(counted.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, totalCount: SEEDED_ROWS, readOnlyForced: true });
      // The contract orders the additive fields: totalCount, then readOnlyForced.
      expect(Object.keys(counted.structuredContent as object)).toEqual(["columns", "rows", "rowCount", "totalCount", "readOnlyForced"]);
      expect(counted.content?.[0]?.text).toBe(JSON.stringify(counted.structuredContent, null, 2));
    });
  }, 120000);

  it("IRIS_SQL_READ_ONLY=false is a real off: the same UPDATE runs and reports rowsAffected", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();

    await withSession({ IRIS_SQL_READ_ONLY: "false" }, async (session) => {
      const result = await session.call("iris_sql_execute", { query: `UPDATE ${T} SET Qty = 50 WHERE Name = 'row1'` });
      expect(result.isError, result.content?.[0]?.text).toBeFalsy();
      expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: 1 });
    });

    expect(await atelierScalar(TARGET, `SELECT Qty AS N FROM ${T} WHERE Name = 'row1'`)).toBe(50);
  }, 60000);

  it("iris_sql_query refuses every non-query as the tool's own read-only, whatever the operator set", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    for (const env of [{}, { IRIS_SQL_READ_ONLY: "false" }, { IRIS_SQL_READ_ONLY: "true" }]) {
      await withSession(env, async (session) => {
        const update = await session.call("iris_sql_query", { query: `UPDATE ${T} SET Qty = 99` });
        expect(update.isError, JSON.stringify(env)).toBe(true);
        expect(update.structuredContent, JSON.stringify(env)).toEqual({
          code: "SQL_READ_ONLY",
          namespace: NS,
          statementType: "UPDATE",
          readOnlySource: "tool",
        });
        expect(update.content?.[0]?.text).toBe(readOnlyText("UPDATE", TOOL_RO_REMEDY));

        const call = await session.call("iris_sql_query", { query: `CALL ${BUMP}` });
        expect(call.structuredContent).toMatchObject({ code: "SQL_READ_ONLY", statementType: "CALL", readOnlySource: "tool" });
      });
    }

    expect(await tableRows()).toEqual(before);
    expect(await marker()).toBe("");
  }, 120000);
});

// -- IRIS_SQL_MAX_ROWS_AFFECTED ---------------------------------------

describe("IRIS_SQL_MAX_ROWS_AFFECTED on the wire (Story 38.5, AC-3)", () => {
  const CEILING = { IRIS_SQL_MAX_ROWS_AFFECTED: "2" };

  it("a DELETE over the ceiling is rolled back whatever maxRowsAffected the call passes, and the rows are intact", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    await withSession(CEILING, async (session) => {
      for (const args of [{}, { maxRowsAffected: 100 }]) {
        const result = await session.call("iris_sql_execute", { query: `DELETE FROM ${T}`, ...args });
        expect(result.isError, JSON.stringify(args)).toBe(true);
        expect(result.structuredContent, JSON.stringify(args)).toEqual({
          code: "SQL_ROWS_AFFECTED_CAP",
          namespace: NS,
          statementType: "DELETE",
          rowsAffected: SEEDED_ROWS,
          maxRowsAffected: 2,
          capSource: "operator",
        });
        expect(result.content?.[0]?.text, JSON.stringify(args)).toBe(
          `Statement was rolled back in namespace '${NS}': the DELETE affected ${SEEDED_ROWS} rows, more than the cap of 2 ` +
            "(from IRIS_SQL_MAX_ROWS_AFFECTED). Its row changes were undone, except in storage that is not journaled, such as a table stored in IRISTEMP. Narrow the statement to at most 2 rows; " +
            "a call cannot raise the operator's IRIS_SQL_MAX_ROWS_AFFECTED ceiling.",
        );
        expect(await tableRows(), `the rows after ${JSON.stringify(args)}`).toEqual(before);
      }
    });
  }, 120000);

  it("a DELETE within the ceiling commits, reports rowsAffected and is marked maxRowsAffectedCapped", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();

    await withSession(CEILING, async (session) => {
      const result = await session.call("iris_sql_execute", { query: `DELETE FROM ${T} WHERE Name = 'row1'` });
      expect(result.isError, result.content?.[0]?.text).toBeFalsy();
      expect(result.structuredContent).toEqual({
        columns: [],
        rows: [],
        rowCount: 0,
        rowsAffected: 1,
        maxRowsAffectedCapped: true,
      });
      // The contract fixes the order of the additive fields (rowsAffected, then maxRowsAffectedCapped), and the
      // text block is the same object stringified, so the order is visible on the wire.
      expect(Object.keys(result.structuredContent as object)).toEqual([
        "columns",
        "rows",
        "rowCount",
        "rowsAffected",
        "maxRowsAffectedCapped",
      ]);
      expect(result.content?.[0]?.text).toBe(JSON.stringify(result.structuredContent, null, 2));

      // A SELECT is not bounded by the cap and carries no cap flag.
      const select = await session.call("iris_sql_execute", { query: ROW_SELECT });
      expect((select.structuredContent as { rowCount: number }).rowCount).toBe(SEEDED_ROWS - 1);
      expect(select.structuredContent).not.toHaveProperty("maxRowsAffectedCapped");

      // The query tool has nothing for the ceiling to bound.
      const viaQuery = await session.call("iris_sql_query", { query: ROW_SELECT });
      expect((viaQuery.structuredContent as { rowCount: number }).rowCount).toBe(SEEDED_ROWS - 1);
      expect(viaQuery.structuredContent).not.toHaveProperty("maxRowsAffectedCapped");
    });

    expect(await rowTotal()).toBe(SEEDED_ROWS - 1);
    expect(await atelierScalar(TARGET, `SELECT COUNT(*) AS N FROM ${T} WHERE Name = 'row1'`)).toBe(0);
  }, 120000);

  it("a caller's smaller cap wins, a cap of 0 included; the refusal names the parameter as the source", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    await withSession(CEILING, async (session) => {
      const dry = await session.call("iris_sql_execute", {
        query: `UPDATE ${T} SET Qty = 99 WHERE Name = 'row1'`,
        maxRowsAffected: 0,
      });
      expect(dry.isError).toBe(true);
      expect(dry.structuredContent).toEqual({
        code: "SQL_ROWS_AFFECTED_CAP",
        namespace: NS,
        statementType: "UPDATE",
        rowsAffected: 1,
        maxRowsAffected: 0,
        capSource: "parameter",
      });
      expect(dry.content?.[0]?.text).toContain("the UPDATE affected 1 rows, more than the cap of 0 (from maxRowsAffected)");
      expect(dry.content?.[0]?.text).toContain("Narrow the statement to at most 0 rows, or raise maxRowsAffected.");

      const tighter = await session.call("iris_sql_execute", { query: `DELETE FROM ${T} WHERE Qty <= 2`, maxRowsAffected: 1 });
      expect(tighter.isError).toBe(true);
      expect(tighter.structuredContent).toEqual({
        code: "SQL_ROWS_AFFECTED_CAP",
        namespace: NS,
        statementType: "DELETE",
        rowsAffected: 2,
        maxRowsAffected: 1,
        capSource: "parameter",
      });
    });

    expect(await tableRows()).toEqual(before);
  }, 120000);

  it("TRUNCATE TABLE reports -1 and is rolled back; a CALL and DDL are refused before they run", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    await withSession(CEILING, async (session) => {
      const truncate = await session.call("iris_sql_execute", { query: `TRUNCATE TABLE ${T}` });
      expect(truncate.isError).toBe(true);
      expect(truncate.structuredContent).toEqual({
        code: "SQL_ROWS_AFFECTED_CAP",
        namespace: NS,
        statementType: "DELETE",
        rowsAffected: -1,
        maxRowsAffected: 2,
        capSource: "operator",
      });
      expect(truncate.content?.[0]?.text).toContain("affected an unknown number of rows (IRIS reports -1, as it does for TRUNCATE TABLE)");
      expect(await tableRows(), "TRUNCATE was rolled back").toEqual(before);

      const call = await session.call("iris_sql_execute", { query: `CALL ${BUMP}` });
      expect(call.isError).toBe(true);
      expect(call.structuredContent).toEqual({
        code: "SQL_ROWS_AFFECTED_CAP",
        namespace: NS,
        statementType: "CALL",
        maxRowsAffected: 2,
        capSource: "operator",
      });
      expect(call.content?.[0]?.text).toBe(capNotRunOperatorText("CALL", 2));
      expect(await marker(), "the CALL did not run").toBe("");

      const ddl = await session.call("iris_sql_execute", { query: `CREATE TABLE ${DDL_TABLE} (A INT)` });
      expect(ddl.isError).toBe(true);
      expect(ddl.structuredContent).toEqual({
        code: "SQL_ROWS_AFFECTED_CAP",
        namespace: NS,
        statementType: "CREATE TABLE",
        maxRowsAffected: 2,
        capSource: "operator",
      });
      expect(await ddlTableCount(), "the DDL did not run").toBe(0);
    });
  }, 120000);

  it("a ceiling of 0 is a real cap, not 'unset': any affected row is rolled back", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    await withSession({ IRIS_SQL_MAX_ROWS_AFFECTED: "0" }, async (session) => {
      const result = await session.call("iris_sql_execute", { query: `DELETE FROM ${T} WHERE Name = 'row1'` });
      expect(result.isError, result.content?.[0]?.text).toBe(true);
      expect(result.structuredContent).toEqual({
        code: "SQL_ROWS_AFFECTED_CAP",
        namespace: NS,
        statementType: "DELETE",
        rowsAffected: 1,
        maxRowsAffected: 0,
        capSource: "operator",
      });

      const select = await session.call("iris_sql_execute", { query: ROW_SELECT });
      expect((select.structuredContent as { rowCount: number }).rowCount).toBe(SEEDED_ROWS);
    });

    expect(await tableRows()).toEqual(before);
  }, 120000);

  it("read-only governs when both variables are set: an UPDATE is refused as read-only, not as a cap", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    await withSession({ ...CEILING, IRIS_SQL_READ_ONLY: "true" }, async (session) => {
      const result = await session.call("iris_sql_execute", { query: `UPDATE ${T} SET Qty = 99 WHERE Name = 'row1'` });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        code: "SQL_READ_ONLY",
        namespace: NS,
        statementType: "UPDATE",
        readOnlySource: "operator",
      });

      // A SELECT carries readOnlyForced; the cap is not consulted, so there is no cap flag.
      const select = await session.call("iris_sql_execute", { query: ROW_SELECT });
      expect(select.structuredContent).toMatchObject({ rowCount: SEEDED_ROWS, readOnlyForced: true });
      expect(select.structuredContent).not.toHaveProperty("maxRowsAffectedCapped");
    });

    expect(await tableRows()).toEqual(before);
  }, 120000);
});

// -- Governance -------------------------------------------------------

describe("iris_sql_query under governance, on the wire (Story 38.5, AC-6)", () => {
  it("the read-only preset: iris_sql_query runs (and stays statement-level read-only); iris_sql_execute is denied with presetApplied", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    await withSession({ IRIS_GOVERNANCE_PRESET: "read-only" }, async (session) => {
      const read = await session.call("iris_sql_query", { query: ROW_SELECT });
      expect(read.isError, read.content?.[0]?.text).toBeFalsy();
      expect((read.structuredContent as { rowCount: number }).rowCount).toBe(SEEDED_ROWS);

      const counted = await session.call("iris_sql_query", { query: ROW_SELECT, countOnly: true });
      expect(counted.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, totalCount: SEEDED_ROWS });

      const denied = await session.call("iris_sql_execute", { query: ROW_SELECT });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toEqual(governanceDenial("iris_sql_execute", { presetApplied: "read-only" }));
      expect(denied.content?.[0]?.text).toBe("action 'iris_sql_execute' is disabled by governance policy for server 'default'");

      // Governance lets the query tool in; the statement-level guard still refuses a write.
      const write = await session.call("iris_sql_query", { query: `DELETE FROM ${T}` });
      expect(write.structuredContent).toMatchObject({ code: "SQL_READ_ONLY", statementType: "DELETE", readOnlySource: "tool" });

      const { policy } = await governanceReport(session);
      expect(policy["iris_sql_query"]).toBe(true);
      expect(policy["iris_sql_execute"]).toBe(false);
    });

    expect(await tableRows()).toEqual(before);
  }, 120000);

  it("an explicit disable of iris_sql_execute is inherited by iris_sql_query (inheritedFrom, source parent); other reads still work", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    // The documented `{"global": {...}}` shape (the flat shape fails open, DW-554).
    await withSession({ IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_execute: false } }) }, async (session) => {
      const query = await session.call("iris_sql_query", { query: ROW_SELECT });
      expect(query.isError).toBe(true);
      expect(query.structuredContent).toEqual(governanceDenial("iris_sql_query", { inheritedFrom: "iris_sql_execute" }));
      expect(query.content?.[0]?.text).toBe(
        "action 'iris_sql_query' is disabled by governance policy for server 'default' (inherited from 'iris_sql_execute')",
      );

      const execute = await session.call("iris_sql_execute", { query: ROW_SELECT });
      expect(execute.isError).toBe(true);
      expect(execute.structuredContent).toEqual(governanceDenial("iris_sql_execute"));

      const { policy, configSource } = await governanceReport(session);
      expect(policy["iris_sql_query"]).toBe(false);
      expect(policy["iris_sql_execute"]).toBe(false);
      expect(configSource["iris_sql_query"]).toBe("parent");
      expect(configSource["iris_sql_execute"]).toBe("env");

      // The disable reaches only the keys that declare the parent.
      const listed = await session.call("iris_doc_list", { filter: STEM });
      expect(listed.isError).toBeFalsy();
    });

    expect(await tableRows()).toEqual(before);
  }, 120000);

  it("an explicit iris_sql_query: true wins over the inherited disable and runs", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();

    await withSession(
      { IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_execute: false, iris_sql_query: true } }) },
      async (session) => {
        const query = await session.call("iris_sql_query", { query: ROW_SELECT });
        expect(query.isError, query.content?.[0]?.text).toBeFalsy();
        expect((query.structuredContent as { rowCount: number }).rowCount).toBe(SEEDED_ROWS);

        const execute = await session.call("iris_sql_execute", { query: ROW_SELECT });
        expect(execute.structuredContent).toEqual(governanceDenial("iris_sql_execute"));

        const { policy, configSource } = await governanceReport(session);
        expect(policy["iris_sql_query"]).toBe(true);
        expect(configSource["iris_sql_query"]).toBe("env");
        expect(policy["iris_sql_execute"]).toBe(false);
      },
    );
  }, 120000);

  it("with the preset and the disable together the denial names the parent and carries no presetApplied", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    await withSession(
      { IRIS_GOVERNANCE_PRESET: "read-only", IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_execute: false } }) },
      async (session) => {
        const query = await session.call("iris_sql_query", { query: ROW_SELECT });
        expect(query.isError).toBe(true);
        expect(query.structuredContent).toEqual(governanceDenial("iris_sql_query", { inheritedFrom: "iris_sql_execute" }));
      },
    );
  }, 60000);

  it("the same inheritance through a real IRIS_GOVERNANCE_FILE (global and profile layers); an env iris_sql_execute: true outranks a file false", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const dir = mkdtempSync(path.join(tmpdir(), "story-38-5-governance-"));
    try {
      const fileWith = (name: string, content: unknown): string => {
        const file = path.join(dir, name);
        writeFileSync(file, JSON.stringify(content), "utf8");
        return file;
      };
      const globalFile = fileWith("global.json", { global: { iris_sql_execute: false } });
      const profileFile = fileWith("profile.json", { profiles: { default: { iris_sql_execute: false } } });

      for (const [layer, file] of [
        ["file global", globalFile],
        ["file profile", profileFile],
      ] as const) {
        await withSession({ IRIS_GOVERNANCE_FILE: file }, async (session) => {
          const query = await session.call("iris_sql_query", { query: ROW_SELECT });
          expect(query.isError, layer).toBe(true);
          expect(query.structuredContent, layer).toEqual(governanceDenial("iris_sql_query", { inheritedFrom: "iris_sql_execute" }));
          const { configSource } = await governanceReport(session);
          expect(configSource["iris_sql_query"], layer).toBe("parent");
        });
      }

      // The parent enabled at a higher layer than the file's disable: the child runs.
      await withSession(
        { IRIS_GOVERNANCE_FILE: globalFile, IRIS_GOVERNANCE: JSON.stringify({ global: { iris_sql_execute: true } }) },
        async (session) => {
          const query = await session.call("iris_sql_query", { query: ROW_SELECT });
          expect(query.isError, query.content?.[0]?.text).toBeFalsy();
          expect((query.structuredContent as { rowCount: number }).rowCount).toBe(SEEDED_ROWS);
          const { policy } = await governanceReport(session);
          expect(policy["iris_sql_execute"]).toBe(true);
          expect(policy["iris_sql_query"]).toBe(true);
        },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("hiding iris_sql_execute with IRIS_TOOLS_DISABLE removes the tool but does not disable iris_sql_query", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();

    await withSession({ IRIS_TOOLS_DISABLE: "iris_sql_execute" }, async (session) => {
      const names = (await session.listTools()).map((tool) => tool.name);
      expect(names).toContain("iris_sql_query");
      expect(names).not.toContain("iris_sql_execute");

      const query = await session.call("iris_sql_query", { query: ROW_SELECT });
      expect(query.isError, query.content?.[0]?.text).toBeFalsy();
      expect((query.structuredContent as { rowCount: number }).rowCount).toBe(SEEDED_ROWS);
    });
  }, 60000);

  it("`iris-mcp-governance universe --json` and iris_server_profiles report the same policy and source for every key, iris_sql_query included", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const governance = JSON.stringify({ global: { iris_sql_execute: false } });

    const cli = spawnSync(process.execPath, [GOVERNANCE_CLI_BIN, "universe", "--json"], {
      encoding: "utf8",
      env: { ...inheritedEnv(), IRIS_GOVERNANCE: governance },
      maxBuffer: 16 * 1024 * 1024,
    });
    expect(cli.error).toBeUndefined();
    expect(cli.status, cli.stderr).toBe(0);
    const universe = JSON.parse(cli.stdout) as { policy: Record<string, boolean>; configSource: Record<string, string> };
    expect(universe.policy["iris_sql_query"]).toBe(false);
    expect(universe.configSource["iris_sql_query"]).toBe("parent");
    expect(universe.configSource["iris_sql_execute"]).toBe("env");

    await withSession({ IRIS_GOVERNANCE: governance }, async (session) => {
      const served = await governanceReport(session);
      const keys = Object.keys(served.policy);
      expect(keys).toEqual(expect.arrayContaining(["iris_sql_query", "iris_sql_execute"]));
      for (const key of keys) {
        expect(universe.policy[key], `CLI policy[${key}]`).toBe(served.policy[key]);
        expect(universe.configSource[key], `CLI configSource[${key}]`).toBe(served.configSource[key]);
      }
    });
  }, 60000);
});

// -- Profiles ----------------------------------------------------------

describe("the operator variables reach an IRIS_PROFILES profile (Story 38.5, AC-2, AC-3)", () => {
  /** A second profile on the same instance; its own keys try to loosen both operator variables. */
  const PROFILES = JSON.stringify({
    qa385: {
      host: IRIS_HOST,
      port: IRIS_PORT,
      username: IRIS_USERNAME,
      password: IRIS_PASSWORD,
      namespace: NS,
      https: false,
      sqlReadOnly: false,
      sqlMaxRowsAffected: 100,
    },
  });

  it("IRIS_SQL_READ_ONLY applies to the profile, and its own sqlReadOnly:false does not loosen it", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    await withSession({ IRIS_PROFILES: PROFILES, IRIS_SQL_READ_ONLY: "true" }, async (session) => {
      for (const server of ["default", "qa385"]) {
        const result = await session.callOn(server, "iris_sql_execute", { query: `UPDATE ${T} SET Qty = 99` });
        expect(result.isError, server).toBe(true);
        expect(result.structuredContent, server).toEqual({
          code: "SQL_READ_ONLY",
          namespace: NS,
          statementType: "UPDATE",
          readOnlySource: "operator",
        });
      }
    });

    expect(await tableRows()).toEqual(before);
  }, 120000);

  it("IRIS_SQL_MAX_ROWS_AFFECTED applies to the profile, and its own sqlMaxRowsAffected:100 does not raise it", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await seed();
    const before = await tableRows();

    await withSession({ IRIS_PROFILES: PROFILES, IRIS_SQL_MAX_ROWS_AFFECTED: "2" }, async (session) => {
      for (const server of ["default", "qa385"]) {
        const result = await session.callOn(server, "iris_sql_execute", { query: `DELETE FROM ${T}` });
        expect(result.isError, server).toBe(true);
        expect(result.structuredContent, server).toEqual({
          code: "SQL_ROWS_AFFECTED_CAP",
          namespace: NS,
          statementType: "DELETE",
          rowsAffected: SEEDED_ROWS,
          maxRowsAffected: 2,
          capSource: "operator",
        });
      }
    });

    expect(await tableRows()).toEqual(before);
  }, 120000);
});

// -- Startup -----------------------------------------------------------

describe("a malformed operator variable stops the server at startup, naming the variable (Story 38.5, AC-5)", () => {
  const cases: Array<[string, string, string]> = [
    ["IRIS_SQL_READ_ONLY", "yes", 'IRIS_SQL_READ_ONLY must be "true" or "false". Received: "yes".'],
    ["IRIS_SQL_MAX_ROWS_AFFECTED", "-1", 'IRIS_SQL_MAX_ROWS_AFFECTED must be a non-negative integer. Received: "-1".'],
    ["IRIS_SQL_MAX_ROWS_AFFECTED", "2.5", 'IRIS_SQL_MAX_ROWS_AFFECTED must be a non-negative integer. Received: "2.5".'],
    ["IRIS_SQL_MAX_ROWS_AFFECTED", "many", 'IRIS_SQL_MAX_ROWS_AFFECTED must be a non-negative integer. Received: "many".'],
  ];

  for (const [name, value, message] of cases) {
    it(`${name}=${JSON.stringify(value)} exits 1 with the variable's message`, async (testCtx) => {
      if (distSkipReason) return testCtx.skip();

      const outcome = await spawnAndWaitForExit(DEV_ENTRY, [], { ...inheritedEnv(), ...connectionEnv(TARGET), [name]: value }, 20000);

      expect(outcome.timedOut, "the server must fail at startup, not keep running").toBe(false);
      expect(outcome.code).toBe(1);
      expect(outcome.stderr).toContain(message);
    }, 30000);
  }
});
