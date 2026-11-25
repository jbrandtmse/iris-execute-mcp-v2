/**
 * Story 45.1 (AC 45.1.3, AC 45.1.4, S-45.1-sql-privileges) - SQL privileges against a REAL IRIS.
 *
 * `sql-privilege-mode.test.ts` pins, with no IRIS, that `ExecuteMCPv2.REST.Sql.Perform` prepares with SQL privilege checking on.
 * This gate proves the deployed behaviour. It drives `iris_sql_query` and `iris_sql_execute` through the real `IrisHttpClient`
 * and the real `/dev/sql/execute` route as a LEAST-PRIVILEGE account (a role with the `%Development` resource and the namespace
 * database resource, no `%All`, no SQL grant), and asserts, per row of the story's I/O matrix:
 *
 *  - an ungranted SELECT, INSERT, and SELECT of a SqlProc function are refused with IRIS's SQLCODE -99 and message, and nothing
 *    changed (the table count and the SqlProc's counter global, both read as `_SYSTEM`);
 *  - the privilege error answers AHEAD of every decline: an INSERT with `readOnly`, an UPDATE through `iris_sql_query`, and a
 *    CALL under `maxRowsAffected: 0` get the privilege error, not `SQL_READ_ONLY` or `SQL_ROWS_AFFECTED_CAP`, and nothing runs;
 *  - after `GRANT SELECT` the same calls return the rows that `_SYSTEM`'s Atelier `action/query` returns, a write is still
 *    refused, and after `REVOKE` the SELECT is refused again (no privilege cache); `GRANT EXECUTE` lets the SqlProc run, and
 *    `REVOKE` refuses it again;
 *  - the residual the story documents and 45.5 explains: IRIS's own Atelier `action/query` returns the ungranted rows to the
 *    same account (it prepares with checking off; this suite does not change IRIS's API).
 *
 * Expected rows come from the live Atelier route as `_SYSTEM`, never from the implementation (Rule #36).
 *
 * Arming: runs only with `IRIS_REQUIRE_LIVE=1` (or `true`), against the target named by
 * `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (`@iris-mcp/shared/test-helpers/live-target`).
 * Unarmed, every test skips before any request; armed, an unreachable IRIS fails the gate instead of skipping it. The legs create
 * a user, a role and SQL grants, so they also require an environment shaped like the throwaway harness
 * (`throwawayEnvProblems` of `scripts/throwaway-iris.mjs`: `IRIS_THROWAWAY` set by `exec`, `IRIS_HOST=127.0.0.1`, a port that is
 * not 52773 or 1972); otherwise they skip with that reason before any principal or fixture is written. Writes the disposable
 * `ExecuteMCPv2.Temp.QaStory451Priv.cls` (persistent, compiled, one SqlProc), its data and the counter global
 * `^ExecuteMCPv2.QaStory451PrivC`, the role `QaStory451Role` and the user `QaStory451Lp`, and in `afterAll` removes all of them and
 * asserts that nothing named `QaStory451` is left.
 */

import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  IrisApiError,
  IrisHttpClient,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  type ToolContext,
} from "@iris-mcp/shared";
import { liveConnectionEnv, liveGateTarget } from "@iris-mcp/shared/test-helpers/live-target";
import { docListTool } from "../tools/doc.js";
import { executeClassMethodTool } from "../tools/execute.js";
import { globalKillTool, globalListTool } from "../tools/global.js";
import { sqlExecuteTool, sqlQueryTool } from "../tools/sql.js";
import { compileDocs, putDocLines, removeStored, runQuery } from "./live-doc-helpers.js";

const LIVE = liveGateTarget();
const IRIS_HOST = LIVE.target.host;
const IRIS_PORT = LIVE.target.port;
const IRIS_NAMESPACE = LIVE.target.namespace;

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const STEM = "QaStory451";
const CLASS = `ExecuteMCPv2.Temp.${STEM}Priv`;
const CLASS_DOC = `${CLASS}.cls`;
/** The class IRIS generates for the CREATE TABLE the least-privilege account is refused. */
const DDL_DOC = `ExecuteMCPv2.Temp.${STEM}Ddl.cls`;
/** The SQL table of the class and its SqlProc, as a statement names them. */
const T = `ExecuteMCPv2_Temp.${STEM}Priv`;
const FN = `${T}_Bump`;
const ROLE = `${STEM}Role`;
const USER = `${STEM}Lp`;
const ROWS = 3;
const SECURITY_PATH = "/api/executemcp/v2/security";
const CONFIG_PATH = "/api/executemcp/v2/config";

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The throwaway harness, loaded at run time: it lives outside this package's `src` (no declaration, no rootDir entry). */
const HARNESS_URL = pathToFileURL(path.resolve(HERE, "..", "..", "..", "..", "scripts", "throwaway-iris.mjs")).href;

let skipReason: string | undefined;
let ctx: ToolContext;
let lp: ToolContext;
let client: IrisHttpClient;
let lpClient: IrisHttpClient;
let version: number;

// -- Fixture ---------------------------------------------------------

const CLASS_SOURCE = [
  `Class ${CLASS} Extends %Persistent`,
  "{",
  "",
  "Property Name As %String;",
  "",
  "Property Qty As %Integer;",
  "",
  "/// Increments the counter global and returns it: a SqlProc whose run is visible outside any transaction.",
  "ClassMethod Bump() As %Integer [ SqlProc ]",
  "{",
  "    Quit $Increment(^ExecuteMCPv2.QaStory451PrivC)",
  "}",
  "",
  "ClassMethod Counter() As %Integer",
  "{",
  "    Quit +$Get(^ExecuteMCPv2.QaStory451PrivC)",
  "}",
  "",
  "ClassMethod Seed() As %String",
  "{",
  '    For tI = 1:1:3 {',
  "        Set tObj = ..%New()",
  '        Set tObj.Name = "row"_tI',
  "        Set tObj.Qty = tI",
  "        Set tSC = tObj.%Save()",
  "        If $$$ISERR(tSC) Quit",
  "    }",
  '    Quit $Select($$$ISERR(tSC): $System.Status.GetErrorText(tSC), 1: "seeded")',
  "}",
  "",
  "}",
];

// -- Helpers ---------------------------------------------------------

type Row = Record<string, unknown>;

/** The Atelier `action/query` rows as `_SYSTEM`: the oracle, and the way the gate reads and writes SQL privileges. */
const systemRows = (query: string): Promise<Row[]> => runQuery(client, version, IRIS_NAMESPACE, query);

async function scalar(query: string): Promise<unknown> {
  const rows = await systemRows(query);
  return Object.values(rows[0] ?? {})[0];
}

const tableRows = (): Promise<unknown> => scalar(`SELECT COUNT(*) FROM ${T}`);
const quantities = async (): Promise<unknown[]> => (await systemRows(`SELECT Qty FROM ${T} ORDER BY ID`)).map((row) => row.Qty);

/** The tool's mapping of Atelier rows to the tool result. */
function todayMapping(rows: Row[]): { columns: string[]; rows: unknown[][]; rowCount: number } {
  const columns = rows.length > 0 ? Object.keys(rows[0] as Row) : [];
  return { columns, rows: rows.map((row) => columns.map((column) => row[column])), rowCount: rows.length };
}

function run(tool: typeof sqlExecuteTool, args: Record<string, unknown>, context: ToolContext = lp) {
  return tool.handler({ namespace: IRIS_NAMESPACE, ...args }, context);
}

/** The SqlProc's counter global, read as `_SYSTEM`. */
async function counter(): Promise<number> {
  const result = await executeClassMethodTool.handler({ className: CLASS, methodName: "Counter", namespace: IRIS_NAMESPACE }, ctx);
  expect(result.isError, "reading the counter").toBeUndefined();
  return Number((result.structuredContent as { returnValue: unknown }).returnValue);
}

/** What a refusal for the missing SQL privilege looks like: a tool error with IRIS's SQLCODE and message, and no tool refusal code. */
function expectPrivilegeError(result: Awaited<ReturnType<typeof run>>, label: string): void {
  expect(result.isError, label).toBe(true);
  const text = result.content[0]?.text ?? "";
  expect(text.startsWith("SQL error: IRIS reported errors for POST /api/executemcp/v2/dev/sql/execute."), `${label}: ${text}`).toBe(true);
  expect(text, label).toContain("SQLCODE: -99");
  expect(text, label).toContain(`User ${USER} is not privileged for the operation`);
  expect(result.structuredContent, `${label}: a privilege error carries no tool refusal code`).toBeUndefined();
}

// -- Principals ------------------------------------------------------

async function userExists(name: string): Promise<boolean> {
  try {
    await client.get(`${SECURITY_PATH}/user/${encodeURIComponent(name)}`);
    return true;
  } catch (error) {
    if (error instanceof IrisApiError) return false;
    throw error;
  }
}

async function roleExists(name: string): Promise<boolean> {
  const response = await client.get(`${SECURITY_PATH}/role`);
  return (response.result as Array<{ name: string }>).some((role) => role.name === name);
}

/** Delete the user and the role if they exist, and fail unless both are gone. */
async function removePrincipals(): Promise<void> {
  if (await userExists(USER)) await client.post(`${SECURITY_PATH}/user`, { action: "delete", name: USER });
  if (await roleExists(ROLE)) await client.post(`${SECURITY_PATH}/role`, { action: "delete", name: ROLE });
  expect(await userExists(USER), `user ${USER} is gone`).toBe(false);
  expect(await roleExists(ROLE), `role ${ROLE} is gone`).toBe(false);
}

/** The resource that protects the database the namespace's globals live in, derived from the live configuration. */
async function namespaceDatabaseResource(): Promise<string> {
  const namespaces = (await client.get(`${CONFIG_PATH}/namespace`)).result as Array<{ name: string; globals?: string }>;
  const entry = namespaces.find((candidate) => candidate.name.toUpperCase() === IRIS_NAMESPACE.toUpperCase());
  if (!entry?.globals) throw new Error(`the live configuration lists no globals database for namespace ${IRIS_NAMESPACE}`);
  const databases = (await client.get(`${CONFIG_PATH}/database`)).result as Array<{ name: string; resource?: string }>;
  const database = databases.find((candidate) => candidate.name.toUpperCase() === entry.globals?.toUpperCase());
  if (!database) throw new Error(`the live configuration lists no database ${entry.globals}`);
  // A database with no explicit Resource is protected by IRIS's default, %DB_<name>; the account's login and reads prove it.
  return database.resource ? database.resource : `%DB_${database.name.toUpperCase()}`;
}

// -- Cleanup ---------------------------------------------------------

async function listFixtureGlobals(): Promise<string[]> {
  const listed = await globalListTool.handler({ filter: STEM, namespace: IRIS_NAMESPACE }, ctx);
  expect(listed.isError, "the global listing").toBeUndefined();
  return (listed.structuredContent as { globals: string[] }).globals;
}

async function killFixtureGlobals(): Promise<void> {
  for (const listed of await listFixtureGlobals()) {
    const name = listed.replace(/^\^/, "");
    if (!name.startsWith("ExecuteMCPv") || !name.includes(STEM)) continue;
    const result = await globalKillTool.handler({ global: name, namespace: IRIS_NAMESPACE }, ctx);
    expect(result.isError, `killing global ${name}`).toBeUndefined();
  }
}

async function listFixtureDocuments(): Promise<string[]> {
  const listed = await docListTool.handler({ filter: STEM, generated: true, namespace: IRIS_NAMESPACE }, ctx);
  return (listed.structuredContent as { items: Array<{ name: string }> }).items.map((item) => item.name);
}

/** Remove everything the gate writes: the principals, the data and its globals, then the document. */
async function removeFixtures(): Promise<void> {
  await removePrincipals();
  await killFixtureGlobals();
  // The class IRIS generates when a refused CREATE TABLE is not refused (the gate's own failure mode) is removed too.
  for (const docName of [CLASS_DOC, DDL_DOC]) await removeStored(client, version, IRIS_NAMESPACE, docName);
}

/** Empty table and counter, then the seeded rows. */
async function reseed(): Promise<void> {
  await killFixtureGlobals();
  const result = await executeClassMethodTool.handler({ className: CLASS, methodName: "Seed", namespace: IRIS_NAMESPACE }, ctx);
  expect(result.isError, "seeding").toBeUndefined();
  expect((result.structuredContent as { returnValue: unknown }).returnValue).toBe("seeded");
}

beforeAll(async () => {
  skipReason = LIVE.skipReason;
  if (skipReason === undefined) {
    try {
      const config = loadConfig(liveConnectionEnv(LIVE.target));
      client = new IrisHttpClient(config);
      if (!(await ping(client, 3000))) {
        skipReason = `IRIS is not reachable at http://${IRIS_HOST}:${IRIS_PORT} (check IRIS_HOST/IRIS_PORT).`;
      } else {
        version = await negotiateVersion(client);
        ctx = buildToolContext("NS", config, client, version);
      }
    } catch (error) {
      skipReason = `IRIS availability probe failed: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  if (skipReason && REQUIRE_LIVE) {
    throw new Error(`IRIS_REQUIRE_LIVE is set, so this gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  // The legs create a user, a role and SQL grants: only on a throwaway the harness started, and before anything is written.
  const harness = (await import(HARNESS_URL)) as { throwawayEnvProblems(env: NodeJS.ProcessEnv): string[] };
  const problems = harness.throwawayEnvProblems(process.env);
  if (problems.length > 0) {
    skipReason =
      "this gate creates a user, a role and SQL privileges, so it runs only against a throwaway IRIS that scripts/throwaway-iris.mjs started " +
      `(node scripts/throwaway-iris.mjs exec ...): ${problems.join(" ")}`;
    return;
  }

  const resource = await namespaceDatabaseResource();
  await removeFixtures();
  await putDocLines(client, version, IRIS_NAMESPACE, CLASS_DOC, CLASS_SOURCE);
  await compileDocs(client, version, IRIS_NAMESPACE, [CLASS_DOC]);
  await reseed();

  const password = randomBytes(12).toString("hex");
  await client.post(`${SECURITY_PATH}/role`, {
    action: "create",
    name: ROLE,
    description: "Story 45.1 SQL privileges gate (disposable)",
    resources: `%Development:U,${resource}:RW`,
  });
  await client.post(`${SECURITY_PATH}/user`, { action: "create", name: USER, password, roles: ROLE });

  const lpConfig = loadConfig({ ...liveConnectionEnv(LIVE.target), IRIS_USERNAME: USER, IRIS_PASSWORD: password });
  lpClient = new IrisHttpClient(lpConfig);
  if (!(await ping(lpClient, 3000))) {
    throw new Error(`the least-privilege account ${USER} cannot reach IRIS at http://${IRIS_HOST}:${IRIS_PORT}: its role or password was not accepted`);
  }
  lp = buildToolContext("NS", lpConfig, lpClient, version);
}, 180000);

afterAll(async () => {
  if (skipReason) return;
  await removeFixtures();
  expect(await listFixtureDocuments(), "no QaStory451 document after the run").toEqual([]);
  expect(await listFixtureGlobals(), "no QaStory451 global after the run").toEqual([]);
  expect(await userExists(USER), "no QaStory451 user after the run").toBe(false);
  expect(await roleExists(ROLE), "no QaStory451 role after the run").toBe(false);
}, 120000);

beforeEach(async () => {
  if (skipReason) return;
  await reseed();
}, 60000);

// -- The least-privilege account, ungranted (AC 45.1.3, AC 45.1.4) ----

describe("the least-privilege account with no SQL grant is refused through both tools (Story 45.1)", () => {
  it("the fixture is real: the account exists with its role, and `_SYSTEM` sees the seeded rows and a counter at 0", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const granted = await client.get(`${SECURITY_PATH}/user/${USER}`);

    expect((granted.result as { roles: string }).roles).toBe(ROLE);
    expect(await tableRows()).toBe(ROWS);
    expect(await counter()).toBe(0);
  }, 60000);

  for (const tool of [sqlQueryTool, sqlExecuteTool]) {
    it(`${tool.name}: an ungranted SELECT is refused with SQLCODE -99 and returns no rows`, async (testCtx) => {
      if (skipReason) return testCtx.skip();

      const result = await run(tool, { query: `SELECT ID, Name, Qty FROM ${T} ORDER BY ID` });

      expectPrivilegeError(result, tool.name);
    }, 60000);
  }

  it("iris_sql_execute: an ungranted INSERT is refused and the table count is unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `INSERT INTO ${T} (Name, Qty) VALUES ('x', 9)` });

    expectPrivilegeError(result, "INSERT");
    expect(await tableRows()).toBe(ROWS);
  }, 60000);

  it("iris_sql_execute: an ungranted UPDATE and DELETE are refused and the rows are unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    expectPrivilegeError(await run(sqlExecuteTool, { query: `UPDATE ${T} SET Qty = 99` }), "UPDATE");
    expectPrivilegeError(await run(sqlExecuteTool, { query: `DELETE FROM ${T}` }), "DELETE");

    expect(await quantities()).toEqual([1, 2, 3]);
    expect(await tableRows()).toBe(ROWS);
  }, 60000);

  it("iris_sql_execute: an ungranted CREATE TABLE is refused and the table does not exist", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const created = `ExecuteMCPv2_Temp.${STEM}Ddl`;

    const result = await run(sqlExecuteTool, { query: `CREATE TABLE ${created} (A INT)` });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("SQLCODE: -99");
    expect(
      await scalar(`SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'ExecuteMCPv2_Temp' AND TABLE_NAME = '${STEM}Ddl'`),
    ).toBe(0);
  }, 60000);

  it("ordering, read-only: an INSERT with readOnly gets the privilege error, not SQL_READ_ONLY, and the count is unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `INSERT INTO ${T} (Name, Qty) VALUES ('x', 9)`, readOnly: true });

    expectPrivilegeError(result, "readOnly INSERT");
    expect(result.content[0]?.text).not.toContain("SQL_READ_ONLY");
    expect(await tableRows()).toBe(ROWS);
  }, 60000);

  it("ordering, read-only: iris_sql_query with an UPDATE gets the privilege error, not SQL_READ_ONLY, and the values are unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlQueryTool, { query: `UPDATE ${T} SET Qty = 99` });

    expectPrivilegeError(result, "iris_sql_query UPDATE");
    expect(await quantities()).toEqual([1, 2, 3]);
  }, 60000);

  it("ordering, cap decline: a CALL of the SqlProc under maxRowsAffected 0 gets the privilege error, not SQL_ROWS_AFFECTED_CAP, and it did not run", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await run(sqlExecuteTool, { query: `CALL ${FN}()`, maxRowsAffected: 0 });

    expectPrivilegeError(result, "capped CALL");
    expect(await counter()).toBe(0);
  }, 60000);

  it("a SELECT of a SqlProc function without EXECUTE is refused and the function did not run", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const results = [
      await run(sqlQueryTool, { query: `SELECT ${FN}() AS n` }),
      await run(sqlExecuteTool, { query: `SELECT ${FN}() AS n` }),
      await run(sqlExecuteTool, { query: `CALL ${FN}()` }),
    ];

    results.forEach((result, index) => expectPrivilegeError(result, `SqlProc form ${index}`));
    expect(await counter()).toBe(0);
  }, 60000);

  it("the residual, pinned: IRIS's own Atelier action/query returns the ungranted rows to the same account (IRIS's API, documented by Story 45.5)", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const rows = await runQuery(lpClient, version, IRIS_NAMESPACE, `SELECT Name, Qty FROM ${T} ORDER BY ID`);

    expect(rows).toEqual([
      { Name: "row1", Qty: 1 },
      { Name: "row2", Qty: 2 },
      { Name: "row3", Qty: 3 },
    ]);
  }, 60000);
});

// -- Grant and revoke (AC 45.1.3) ------------------------------------

describe("a SQL grant opens the statement it covers, and REVOKE closes it at once (Story 45.1)", () => {
  it("GRANT SELECT: both tools return the rows `_SYSTEM`'s action/query returns, a write is still refused; after REVOKE the SELECT is refused again", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const query = `SELECT ID, Name, Qty FROM ${T} ORDER BY ID`;
    const oracle = await systemRows(query);
    let granted = false;

    try {
      expectPrivilegeError(await run(sqlQueryTool, { query }), "before the grant");

      await systemRows(`GRANT SELECT ON ${T} TO ${USER}`);
      granted = true;

      expect(oracle).toHaveLength(ROWS);
      for (const tool of [sqlQueryTool, sqlExecuteTool]) {
        const result = await run(tool, { query });
        expect(result.isError, `${tool.name} after the grant`).toBeUndefined();
        expect(result.structuredContent, `${tool.name} after the grant`).toEqual(todayMapping(oracle));
      }
      expectPrivilegeError(await run(sqlExecuteTool, { query: `INSERT INTO ${T} (Name, Qty) VALUES ('x', 9)` }), "INSERT with only SELECT");
      expectPrivilegeError(await run(sqlExecuteTool, { query: `UPDATE ${T} SET Qty = 99` }), "UPDATE with only SELECT");
      expect(await tableRows()).toBe(ROWS);
    } finally {
      if (granted) await systemRows(`REVOKE SELECT ON ${T} FROM ${USER}`);
    }

    for (const tool of [sqlQueryTool, sqlExecuteTool]) expectPrivilegeError(await run(tool, { query }), `${tool.name} after the revoke`);
  }, 120000);

  it("GRANT INSERT: iris_sql_execute inserts one row; after REVOKE the INSERT is refused again and no row is added", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const insert = `INSERT INTO ${T} (Name, Qty) VALUES ('granted', 7)`;
    let granted = false;

    try {
      await systemRows(`GRANT INSERT ON ${T} TO ${USER}`);
      granted = true;

      const result = await run(sqlExecuteTool, { query: insert });

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: 1 });
      expect(await tableRows()).toBe(ROWS + 1);
    } finally {
      if (granted) await systemRows(`REVOKE INSERT ON ${T} FROM ${USER}`);
    }

    expectPrivilegeError(await run(sqlExecuteTool, { query: insert }), "INSERT after the revoke");
    expect(await tableRows()).toBe(ROWS + 1);
  }, 120000);

  it("GRANT EXECUTE: the SqlProc runs through both tools; after REVOKE it is refused again and does not run", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    let granted = false;

    try {
      expectPrivilegeError(await run(sqlQueryTool, { query: `SELECT ${FN}() AS n` }), "before the grant");
      expect(await counter()).toBe(0);

      await systemRows(`GRANT EXECUTE ON ${FN} TO ${USER}`);
      granted = true;

      const selected = await run(sqlExecuteTool, { query: `SELECT ${FN}() AS n` });
      expect(selected.isError).toBeUndefined();
      expect(selected.structuredContent).toEqual({ columns: ["n"], rows: [[1]], rowCount: 1 });
      expect(await counter()).toBe(1);

      const called = await run(sqlExecuteTool, { query: `CALL ${FN}()` });
      expect(called.isError).toBeUndefined();
      expect(await counter()).toBe(2);
    } finally {
      if (granted) await systemRows(`REVOKE EXECUTE ON ${FN} FROM ${USER}`);
    }

    expectPrivilegeError(await run(sqlExecuteTool, { query: `SELECT ${FN}() AS n` }), "after the revoke");
    expectPrivilegeError(await run(sqlExecuteTool, { query: `CALL ${FN}()` }), "CALL after the revoke");
    expect(await counter()).toBe(2);
  }, 120000);
});

// -- An account with %All is unchanged (AC 45.1.6) --------------------

describe("an account with %All is unchanged: the same statements run (Story 45.1, AC 45.1.6)", () => {
  it("`_SYSTEM` reads, writes and calls through both tools with no grant", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const query = `SELECT ID, Name, Qty FROM ${T} ORDER BY ID`;

    const read = await run(sqlQueryTool, { query }, ctx);
    const wrote = await run(sqlExecuteTool, { query: `UPDATE ${T} SET Qty = Qty + 10`, maxRowsAffected: ROWS }, ctx);
    const called = await run(sqlExecuteTool, { query: `SELECT ${FN}() AS n` }, ctx);

    expect(read.isError).toBeUndefined();
    expect((read.structuredContent as { rowCount: number }).rowCount).toBe(ROWS);
    expect(wrote.isError).toBeUndefined();
    expect(wrote.structuredContent).toEqual({ columns: [], rows: [], rowCount: 0, rowsAffected: ROWS });
    expect(called.structuredContent).toEqual({ columns: ["n"], rows: [[1]], rowCount: 1 });
    expect(await quantities()).toEqual([11, 12, 13]);
  }, 60000);
});
