/**
 * Epic 38 capstone gate: the agent-editing and SQL-safety surfaces of Epic 38, driven together on the
 * REAL wire, in the default suite (project rule #21), each leg naming the path it guards (rule #59).
 *
 * Every leg spawns the BUILT iris-dev-mcp dist as a child process, connects the real MCP SDK
 * `Client` over stdio and calls the tools against the live IRIS, with `server: "default"` and an
 * explicit namespace. The independent oracle is the raw Atelier API (`GET /doc` and `action/query`),
 * never the tools under test.
 *
 * Before any leg, `beforeAll` asserts that the deployed `ExecuteMCPv2` classes carry the
 * `BOOTSTRAP_VERSION` of the built shared dist, once the first built-server session has connected
 * (the server's startup bootstrap redeploys a deployment whose version differs). A mismatch fails the
 * gate, armed or not, naming both values.
 *
 * Legs (each puts the fixture it needs, so they pass in either order):
 *  1. A ranged `iris_doc_get` equals the matching slice of the stored document.
 *  2. An `iris_doc_edit` whose `expected` is built from a ranged read applies; the stored document
 *     holds the new text and `iris_doc_compile` succeeds.
 *  3. A stale edit of a range that ends in an empty line is refused with `STALE_CONTENT` and the stored
 *     document is unchanged (content and `ts`); the retry with `mismatches[0].current` as `expected`
 *     applies. Path: built dev server over stdio -> `iris_doc_edit` -> Atelier `GET` then `PUT`.
 *  4. A storage-dropping `iris_doc_put` on the seeded persistent class is refused with
 *     `STORAGE_DROPPED`; the stored source still holds its Storage block and the row count is unchanged.
 *  5. Under `IRIS_GOVERNANCE_PRESET=read-only`, `iris_sql_query` returns the seeded rows, an UPDATE is
 *     refused with `SQL_READ_ONLY` (`readOnlySource: "tool"`) and changes nothing, and `iris_sql_execute`
 *     is denied with `GOVERNANCE_DISABLED`.
 *  6. With `IRIS_SQL_MAX_ROWS_AFFECTED` below the seeded row count, an `iris_sql_execute` DELETE of every
 *     row is refused with `SQL_ROWS_AFFECTED_CAP` (`capSource: "operator"`) and the rows are intact.
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, defaulting to the
 * dev instance at localhost:52773 / HSCUSTOM. Writes only the disposable
 * `ExecuteMCPv2.Temp.QaStory386CapEdit.cls` (non-persistent) and `ExecuteMCPv2.Temp.QaStory386CapRows.cls`
 * (persistent, compiled, six rows, `^ExecuteMCPv2.QaStory386CapR*`) documents, the table and the globals
 * of the second one. They are removed, and their absence asserted, in `beforeAll` and in `afterAll`.
 *
 * Placement (rule #45): `@iris-mcp/all` spawns built dists. A missing or stale `shared` or `iris-dev-mcp`
 * dist, an unresolvable SDK or an unreachable IRIS skips each test with the reason, or fails with "may
 * not be skipped" when `IRIS_REQUIRE_LIVE` is armed (listed in `scripts/prepublish-gate.mjs`
 * `gateTestFiles`).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertDeployedBootstrapVersion,
  atelierDocument,
  atelierQuery,
  irisTargetFromEnv,
  isIrisReachable,
  openWireSession,
  resolveSdkEsmDir,
  staleDistReason,
  withWireSession,
  type AtelierDocument,
  type WireSession as Session,
  type WireSessionOptions,
} from "./process-gate-helpers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const DEV_ENTRY = path.join(REPO_ROOT, "packages", "iris-dev-mcp", "dist", "index.js");

const TARGET = irisTargetFromEnv();
const NS = TARGET.namespace;

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const STEM = "QaStory386Cap";
const EDIT_CLASS = `ExecuteMCPv2.Temp.${STEM}Edit`;
const ROWS_CLASS = `ExecuteMCPv2.Temp.${STEM}Rows`;
const EDIT_DOC = `${EDIT_CLASS}.cls`;
const ROWS_DOC = `${ROWS_CLASS}.cls`;
/** The SQL table of the Rows class. */
const TABLE = `ExecuteMCPv2_Temp.${STEM}Rows`;
const SEEDED_ROWS = 6;

// -- Fixtures --------------------------------------------------------

/** The Edit class: a method body that holds an empty line, between two statements. */
const EDIT_SOURCE = [
  `Class ${EDIT_CLASS} Extends %RegisteredObject`,
  "{",
  "",
  "Property Alpha As %String;",
  "",
  "Method Run() As %Status",
  "{",
  "\tSet tSC = $$$OK",
  "",
  "\tQuit tSC",
  "}",
  "",
  "}",
].join("\n");

/** The Rows class: persistent, its own data global (31 characters at most with IRIS's suffix), and a seed. */
const ROWS_SOURCE = [
  `Class ${ROWS_CLASS} Extends %Persistent`,
  "{",
  "",
  'Parameter DEFAULTGLOBAL = "^ExecuteMCPv2.QaStory386CapR";',
  "",
  "Property Name As %String;",
  "",
  "Property Qty As %Integer;",
  "",
  "ClassMethod Seed() As %String",
  "{",
  "\tDo ..%KillExtent()",
  `\tFor tI = 1:1:${SEEDED_ROWS} {`,
  "\t\tSet tObj = ..%New()",
  '\t\tSet tObj.Name = "cap"_tI',
  "\t\tSet tObj.Qty = tI",
  "\t\tSet tSC = tObj.%Save()",
  "\t}",
  '\tQuit "seeded"',
  "}",
  "",
  "}",
].join("\n");

let skipReason: string | undefined;
let sdkEsmDir: string | undefined;
let admin: Session;

/** The built dev server and the target, for the shared wire helpers. */
function wireOptions(): WireSessionOptions {
  return { sdkEsmDir: sdkEsmDir as string, entry: DEV_ENTRY, target: TARGET, clientName: "epic38-capstone-gate" };
}

/** Run `body` with a session whose server was started with `extraEnv`, and always close it. */
const withSession = <T>(extraEnv: Record<string, string>, body: (session: Session) => Promise<T>): Promise<T> =>
  withWireSession(wireOptions(), extraEnv, body);

/** Per-test skip helper: log the reason, then mark the test skipped. */
function skip(testCtx: { skip: () => void }): void {
  // eslint-disable-next-line no-console
  console.log(`[SKIP] epic38-capstone-gate: ${skipReason}`);
  testCtx.skip();
}

// -- Writing and reading the fixtures ----------------------------------

/** Remove a document; a document that is not there is not an error here. */
async function removeDoc(docName: string): Promise<void> {
  await admin.call("iris_doc_delete", { name: docName });
}

/** Replace a document with `source`, through the tool under test's neighbour `iris_doc_put`. */
async function putDoc(docName: string, source: string): Promise<void> {
  await removeDoc(docName);
  const result = await admin.call("iris_doc_put", { name: docName, content: source });
  expect(result.isError, `creating ${docName}: ${result.content?.[0]?.text}`).toBeFalsy();
}

async function compileDoc(docName: string): Promise<void> {
  const result = await admin.call("iris_doc_compile", { doc: docName });
  expect(result.isError, `compiling ${docName}`).toBeFalsy();
  expect(result.structuredContent, `compiling ${docName}`).toMatchObject({ success: true });
}

/** A fresh Edit class, returned as the raw Atelier route stores it. */
async function freshEdit(): Promise<AtelierDocument> {
  await putDoc(EDIT_DOC, EDIT_SOURCE);
  return atelierDocument(TARGET, EDIT_DOC);
}

/** The fixture table as stored: every row, in ID order, read over the raw Atelier route. */
const tableRows = (): Promise<Array<Record<string, unknown>>> =>
  atelierQuery(TARGET, `SELECT ID, Name, Qty FROM ${TABLE} ORDER BY ID`);

/** A fresh, compiled Rows class (its Storage generated) with the six seeded rows. */
async function freshRows(): Promise<AtelierDocument> {
  await putDoc(ROWS_DOC, ROWS_SOURCE);
  await compileDoc(ROWS_DOC);
  const seeded = await admin.call("iris_execute_classmethod", { className: ROWS_CLASS, methodName: "Seed" });
  expect(seeded.isError, `seeding: ${seeded.content?.[0]?.text}`).toBeFalsy();
  expect((seeded.structuredContent as { returnValue: unknown }).returnValue).toBe("seeded");
  expect((await tableRows()).length, "the seeded rows").toBe(SEEDED_ROWS);
  const stored = await atelierDocument(TARGET, ROWS_DOC);
  expect(storageLines(stored.content), "the compile generated a Storage definition").not.toEqual([]);
  expect(await fixtureDocuments(), "the document oracle sees the fixture").toContain(ROWS_DOC);
  expect(await fixtureGlobals(), "the global oracle sees the data global").not.toEqual([]);
  expect(await fixtureTables(), "the table oracle sees the fixture table").toBe(1);
  return stored;
}

/** The 1-based number of the first stored line equal to `line`. */
function lineNumber(content: string[], line: string): number {
  const index = content.indexOf(line);
  expect(index, `the stored document has the line ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0);
  return index + 1;
}

/** The lines of every Storage definition, from its `Storage <name>` line to its closing `}`. */
function storageLines(content: string[]): string[] {
  const start = content.findIndex((line) => /^Storage \S+$/.test(line));
  return start < 0 ? [] : content.slice(start, content.indexOf("}", start) + 1);
}

/** The text of a successful tool result's first content block. */
function textOf(result: { content?: Array<{ text?: string }> }): string {
  return result.content?.[0]?.text ?? "";
}

// -- Cleanup ---------------------------------------------------------

async function fixtureDocuments(): Promise<string[]> {
  const listed = await admin.call("iris_doc_list", { filter: STEM, generated: true });
  expect(listed.isError, "the document listing").toBeFalsy();
  return (listed.structuredContent as { items: Array<{ name: string }> }).items.map((item) => item.name);
}

async function fixtureGlobals(): Promise<string[]> {
  const listed = await admin.call("iris_global_list", { filter: STEM });
  expect(listed.isError, "the global listing").toBeFalsy();
  return (listed.structuredContent as { globals: string[] }).globals;
}

async function fixtureTables(): Promise<number> {
  const rows = await atelierQuery(
    TARGET,
    `SELECT COUNT(*) AS N FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = 'ExecuteMCPv2_Temp' AND TABLE_NAME LIKE '${STEM}%'`,
  );
  return Number(Object.values(rows[0] ?? {})[0]);
}

/** Remove everything the gate writes: the documents, then the data globals the persistent class left. */
async function removeFixtures(): Promise<void> {
  for (const docName of [EDIT_DOC, ROWS_DOC]) await removeDoc(docName);
  for (const listed of await fixtureGlobals()) {
    const name = listed.replace(/^\^/, "");
    if (!name.startsWith("ExecuteMCPv") || !name.includes(STEM)) continue;
    const killed = await admin.call("iris_global_kill", { global: name });
    expect(killed.isError, `killing global ${name}`).toBeFalsy();
  }
}

/** Assert that nothing named `QaStory386Cap` is left: no document, no global, no table. */
async function expectNoFixtures(when: string): Promise<void> {
  expect(await fixtureDocuments(), `no ${STEM} document ${when}`).toEqual([]);
  expect(await fixtureGlobals(), `no ${STEM} global ${when}`).toEqual([]);
  expect(await fixtureTables(), `no ${STEM} table ${when}`).toBe(0);
}

beforeAll(async () => {
  const sharedStale = staleDistReason(REPO_ROOT, "shared");
  skipReason = sharedStale ?? staleDistReason(REPO_ROOT, "iris-dev-mcp");
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
    throw new Error(`IRIS_REQUIRE_LIVE is set, so the Epic 38 capstone gate may not be skipped: ${skipReason}`);
  }
  if (skipReason) return;

  admin = await openWireSession(wireOptions());
  await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);
  await removeFixtures();
  await expectNoFixtures("before the run");
}, 120000);

afterAll(async () => {
  if (skipReason) return;
  try {
    await removeFixtures();
    await expectNoFixtures("after the run");
  } finally {
    await admin.close();
  }
}, 90000);

// -- Editing -----------------------------------------------------------

describe("Epic 38 capstone: ranged reads and guarded edits on the built dev server (legs 1-3)", () => {
  it("leg 1: a ranged read equals the matching slice of the stored document", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const stored = await freshEdit();
    const total = stored.content.length;

    const ranges: Array<[number, number, number]> = [
      [1, 1, 1],
      [3, 8, 8],
      [total - 1, total, total],
      [total, total + 5, total],
    ];
    for (const [startLine, endLine, clampedEnd] of ranges) {
      const result = await admin.call("iris_doc_get", { name: EDIT_DOC, startLine, endLine });
      expect(result.isError, `lines ${startLine}-${endLine}: ${textOf(result)}`).toBeFalsy();
      expect(result.structuredContent, `lines ${startLine}-${endLine}`).toEqual({
        name: EDIT_DOC,
        ts: stored.ts,
        startLine,
        endLine: clampedEnd,
        totalLines: total,
        lines: stored.content.slice(startLine - 1, clampedEnd),
      });
    }

    const whole = await admin.call("iris_doc_get", { name: EDIT_DOC });
    expect((whole.structuredContent as { content: string[] }).content).toEqual(stored.content);
  }, 120000);

  it("leg 2: an edit whose expected is built from a ranged read applies, the stored document holds the new text, and it compiles", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const before = await freshEdit();
    const setLine = lineNumber(before.content, "\tSet tSC = $$$OK");
    const endLine = setLine + 2;

    const read = await admin.call("iris_doc_get", { name: EDIT_DOC, startLine: setLine, endLine });
    const lines = (read.structuredContent as { lines: string[] }).lines;
    expect(lines, "the range holds the empty line").toEqual(["\tSet tSC = $$$OK", "", "\tQuit tSC"]);
    const expected = lines.map((line) => `${line}\n`).join("");

    const result = await admin.call("iris_doc_edit", {
      action: "apply",
      name: EDIT_DOC,
      edits: [{ op: "replace", startLine: setLine, endLine, text: "\tSet tSC = 2\n\n\tQuit tSC\n", expected }],
    });

    expect(result.isError, textOf(result)).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ name: EDIT_DOC, namespace: NS, changed: true });
    const after = await atelierDocument(TARGET, EDIT_DOC);
    expect(after.ts).not.toBe(before.ts);
    expect((result.structuredContent as { ts: string }).ts).toBe(after.ts);
    expect(after.content.slice(setLine - 1, endLine)).toEqual(["\tSet tSC = 2", "", "\tQuit tSC"]);
    expect(after.content.length).toBe(before.content.length);
    await compileDoc(EDIT_DOC);
  }, 120000);

  it("leg 3: a stale edit of a range that ends in an empty line is STALE_CONTENT and changes nothing; the retry with current as expected applies (DW-552)", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const before = await freshEdit();
    const setLine = lineNumber(before.content, "\tSet tSC = $$$OK");
    const endLine = setLine + 1;
    expect(before.content[endLine - 1], "the range ends in an empty line").toBe("");

    const stale = await admin.call("iris_doc_edit", {
      action: "apply",
      name: EDIT_DOC,
      edits: [{ op: "replace", startLine: setLine, endLine, text: "\tSet tSC = 2\n", expected: "\tSet tSC = $$$NOT_THE_TEXT\n\n" }],
    });

    expect(stale.isError).toBe(true);
    expect(stale.structuredContent).toEqual({
      code: "STALE_CONTENT",
      name: EDIT_DOC,
      namespace: NS,
      ts: before.ts,
      totalLines: before.content.length,
      mismatches: [{ edit: 1, op: "replace", startLine: setLine, endLine, current: "\tSet tSC = $$$OK\n\n" }],
    });
    expect(await atelierDocument(TARGET, EDIT_DOC), "nothing was stored").toEqual(before);

    const current = (stale.structuredContent as { mismatches: Array<{ current: string }> }).mismatches[0]?.current as string;
    const retried = await admin.call("iris_doc_edit", {
      action: "apply",
      name: EDIT_DOC,
      edits: [{ op: "replace", startLine: setLine, endLine, text: "\tSet tSC = 2\n", expected: current }],
    });

    expect(retried.isError, textOf(retried)).toBeFalsy();
    expect(retried.structuredContent).toMatchObject({ name: EDIT_DOC, namespace: NS, changed: true });
    const after = await atelierDocument(TARGET, EDIT_DOC);
    expect(after.content.slice(setLine - 1, setLine + 1)).toEqual(["\tSet tSC = 2", "\tQuit tSC"]);
    expect(after.content.length).toBe(before.content.length - 1);
  }, 120000);
});

// -- Storage guard -------------------------------------------------------

describe("Epic 38 capstone: the Storage guard on iris_doc_put (leg 4)", () => {
  it("leg 4: a storage-dropping put on the seeded persistent class is STORAGE_DROPPED; the stored Storage block and the rows are unchanged", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    const before = await freshRows();
    const rowsBefore = await tableRows();

    const result = await admin.call("iris_doc_put", { name: ROWS_DOC, content: ROWS_SOURCE });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "STORAGE_DROPPED",
      name: ROWS_DOC,
      namespace: NS,
      droppedStorage: ["Default"],
    });
    const after = await atelierDocument(TARGET, ROWS_DOC);
    expect(after, "the stored source is unchanged").toEqual(before);
    expect(storageLines(after.content), "the Storage block is still stored").toEqual(storageLines(before.content));
    expect(await tableRows(), "the rows are unchanged").toEqual(rowsBefore);
    expect(rowsBefore.length).toBe(SEEDED_ROWS);
  }, 120000);
});

// -- SQL safety ------------------------------------------------------------

describe("Epic 38 capstone: SQL safety on the built dev server (legs 5 and 6)", () => {
  const SELECT_ROWS = `SELECT ID, Name, Qty FROM ${TABLE} ORDER BY ID`;

  it("leg 5: under the read-only preset iris_sql_query returns the rows and refuses an UPDATE, and iris_sql_execute is denied", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    await freshRows();
    const before = await tableRows();

    await withSession({ IRIS_GOVERNANCE_PRESET: "read-only" }, async (session) => {
      const read = await session.call("iris_sql_query", { query: SELECT_ROWS });
      expect(read.isError, textOf(read)).toBeFalsy();
      const answer = read.structuredContent as { rows: unknown[][]; rowCount: number };
      expect(answer.rowCount).toBe(SEEDED_ROWS);
      expect(answer.rows.map((row) => row.map(String))).toEqual(
        before.map((row) => [row["ID"], row["Name"], row["Qty"]].map(String)),
      );

      const update = await session.call("iris_sql_query", { query: `UPDATE ${TABLE} SET Qty = 99` });
      expect(update.isError).toBe(true);
      expect(update.structuredContent).toMatchObject({
        code: "SQL_READ_ONLY",
        statementType: "UPDATE",
        readOnlySource: "tool",
      });

      const denied = await session.call("iris_sql_execute", { query: SELECT_ROWS });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toEqual({
        code: "GOVERNANCE_DISABLED",
        action: "iris_sql_execute",
        server: "default",
        presetApplied: "read-only",
      });
    });

    expect(await tableRows(), "the values are unchanged").toEqual(before);
  }, 120000);

  it("leg 6: with IRIS_SQL_MAX_ROWS_AFFECTED below the row count, a DELETE of every row is SQL_ROWS_AFFECTED_CAP and the rows are intact", async (testCtx) => {
    if (skipReason) return skip(testCtx);
    await freshRows();
    const before = await tableRows();
    expect(before.length).toBeGreaterThan(2);

    await withSession({ IRIS_SQL_MAX_ROWS_AFFECTED: "2" }, async (session) => {
      const result = await session.call("iris_sql_execute", { query: `DELETE FROM ${TABLE}` });
      expect(result.isError, textOf(result)).toBe(true);
      expect(result.structuredContent).toEqual({
        code: "SQL_ROWS_AFFECTED_CAP",
        namespace: NS,
        statementType: "DELETE",
        rowsAffected: SEEDED_ROWS,
        maxRowsAffected: 2,
        capSource: "operator",
      });
    });

    expect(await tableRows(), "the rows are intact").toEqual(before);
  }, 120000);
});
