/**
 * Story 38.3 (AC-1, AC-2, AC-5, AC-7) - the `iris_doc_put` Storage-drop guard against a REAL IRIS.
 *
 * `doc-put-storage-guard.test.ts` pins the handler against mocked HTTP. This gate drives the handler
 * through the real `IrisHttpClient` and the real Atelier `PUT /doc` route, so the properties the guard
 * rests on are proven where they happen:
 *
 *  - the record (AC-1): a compile generates `Storage Default` in the UDL shape the scanner reads; a PUT
 *    to an existing document with no `If-None-Match` is refused with HTTP 409 carrying the current
 *    document; a PUT without a Storage block drops the class's Storage, the rows still read until the
 *    next compile, and the compile then regenerates storage with the properties in a new order, which
 *    reads the existing rows swapped;
 *  - the guard (AC-5): on a persistent class with two rows, a put that drops its storage is refused with
 *    STORAGE_DROPPED and changes nothing (source, `ts`, row count, Storage lines); a content change
 *    inside the Storage block and a put that keeps it are saved, with a new `ts` (DW-540); the override
 *    saves, and the next compile swaps the rows;
 *  - the other fixtures behave as the matrix says: two Storage definitions, a class with none, a routine,
 *    CRLF content, carriage-return elements and decoys;
 *  - the request counts (AC-3, AC-7): a new class and a new routine make one PUT and no GET or HEAD, and
 *    an existing class makes exactly the unversioned PUT and then the version-checked PUT;
 *  - the oracle (AC-2): the Storage names the scanner reads from every scanner fixture equal the names
 *    IRIS itself reports when the fixture is PUT, and the 409 shape the guard reads is the real one.
 *
 * The pinned literals below were captured from the live run of 2026-10-15 (IRIS 2026.2 build 221U,
 * Atelier v8, `default` profile, HSCUSTOM) by running this file armed and reading the values it
 * reported; they are not edited to match the implementation (Rule #36).
 *
 * Target: `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE`, defaulting to the dev
 * instance at localhost:52773 / HSCUSTOM. Writes only the disposable
 * `ExecuteMCPv2.Temp.QaStory383Guard.cls` (persistent, compiled, two rows), `...Multi.cls`,
 * `...NoStorage.cls`, `...Shape.cls` and `...Rtn.mac` documents. Only `Guard` is compiled. Before and
 * after the run the gate removes the Guard data with `%KillExtent()`, every data global whose name starts
 * `ExecuteMCPv` and contains `QaStory383`, and the documents, then asserts that nothing named
 * `QaStory383` is left. Skips when IRIS is unreachable; fails instead when `IRIS_REQUIRE_LIVE` is armed
 * (same arming convention as the other live gates in this directory).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import {
  IrisApiError,
  IrisHttpClient,
  buildToolContext,
  droppedStorageDefinitions,
  loadConfig,
  negotiateVersion,
  ping,
  storageDefinitionNames,
  type ToolContext,
} from "@iris-mcp/shared";
import { STORAGE_FIXTURES } from "@iris-mcp/shared/test-helpers/storage-guard-fixtures";
import { docGetTool, docListTool, docPutTool } from "../tools/doc.js";
import { executeClassMethodTool } from "../tools/execute.js";
import { globalKillTool, globalListTool } from "../tools/global.js";
import {
  compileDocs,
  docPath,
  putDocLines,
  putStatus,
  readStoredLines,
  removeStored,
  runQuery,
  type AtelierDocResult,
} from "./live-doc-helpers.js";

const IRIS_HOST = process.env.IRIS_HOST ?? "localhost";
const IRIS_PORT = process.env.IRIS_PORT ?? "52773";
const IRIS_USERNAME = process.env.IRIS_USERNAME ?? "_SYSTEM";
const IRIS_PASSWORD = process.env.IRIS_PASSWORD ?? "SYS";
const IRIS_NAMESPACE = process.env.IRIS_NAMESPACE ?? "HSCUSTOM";

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const PREFIX = "ExecuteMCPv2.Temp.QaStory383";
const GUARD = `${PREFIX}Guard`;
const MULTI = `${PREFIX}Multi`;
const NOSTORAGE = `${PREFIX}NoStorage`;
const SHAPE = `${PREFIX}Shape`;
const RTN = `${PREFIX}Rtn`;
const GUARD_DOC = `${GUARD}.cls`;
const MULTI_DOC = `${MULTI}.cls`;
const NOSTORAGE_DOC = `${NOSTORAGE}.cls`;
const SHAPE_DOC = `${SHAPE}.cls`;
const RTN_DOC = `${RTN}.mac`;
const ALL_DOCS = [GUARD_DOC, MULTI_DOC, NOSTORAGE_DOC, SHAPE_DOC, RTN_DOC];
/** The SQL table of the Guard class. */
const GUARD_TABLE = "ExecuteMCPv2_Temp.QaStory383Guard";

let skipReason: string | undefined;
let ctx: ToolContext;
let client: IrisHttpClient;
let version: number;

// -- Fixtures --------------------------------------------------------

/** The Guard class as written: two properties, no Storage (the compile generates it). */
const GUARD_SOURCE = [
  `Class ${GUARD} Extends %Persistent`,
  "{",
  "",
  "Property Alpha As %String;",
  "",
  "Property Beta As %String;",
  "",
  "}",
];

/** The same class with the properties in the other order. */
const GUARD_REORDERED = [
  `Class ${GUARD} Extends %Persistent`,
  "{",
  "",
  "Property Beta As %String;",
  "",
  "Property Alpha As %String;",
  "",
  "}",
];

const ROWS = [
  { ID: 1, Alpha: "alpha-1", Beta: "beta-1" },
  { ID: 2, Alpha: "alpha-2", Beta: "beta-2" },
];

/** A scanner fixture's text for class `className`, found by the start of its id. */
function fixtureLines(idPrefix: string, className: string): string[] {
  const fixture = STORAGE_FIXTURES.find((candidate) => candidate.id.startsWith(idPrefix));
  if (fixture === undefined) throw new Error(`no scanner fixture starts with '${idPrefix}'`);
  return fixture.lines(className);
}

const ROUTINE_V1 = [`ROUTINE ${RTN} [Type=MAC]`, "Label ; the first version", "    Quit"];
const ROUTINE_V2 = [`ROUTINE ${RTN} [Type=MAC]`, "Label ; the second version", "    Quit 2"];

// -- Cleanup ---------------------------------------------------------

/** Remove the Guard data with `%KillExtent()`; a Guard class that does not exist has no data to remove. */
async function killGuardData(): Promise<void> {
  const result = await executeClassMethodTool.handler(
    { className: GUARD, methodName: "%KillExtent", namespace: IRIS_NAMESPACE },
    ctx,
  );
  const text = result.content[0]?.text ?? "";
  if (result.isError && !text.includes("CLASS DOES NOT EXIST")) {
    throw new Error(`%KillExtent on ${GUARD} failed: ${text}`);
  }
}

/** The globals whose name contains `QaStory383`, with the caret IRIS lists them with. */
async function listFixtureGlobals(): Promise<string[]> {
  const listed = await globalListTool.handler({ filter: "QaStory383", namespace: IRIS_NAMESPACE }, ctx);
  expect(listed.isError, "the global listing").toBeUndefined();
  return (listed.structuredContent as { globals: string[] }).globals;
}

/** Kill every global whose name starts `ExecuteMCPv` and contains `QaStory383`. */
async function killFixtureGlobals(): Promise<void> {
  for (const listed of await listFixtureGlobals()) {
    const name = listed.replace(/^\^/, "");
    if (!name.startsWith("ExecuteMCPv") || !name.includes("QaStory383")) continue;
    const result = await globalKillTool.handler({ global: name, namespace: IRIS_NAMESPACE }, ctx);
    expect(result.isError, `killing global ${name}`).toBeUndefined();
  }
}

/** The documents IRIS lists for `QaStory383`, generated documents included. */
async function listFixtureDocuments(): Promise<string[]> {
  const listed = await docListTool.handler(
    { filter: "QaStory383", generated: true, namespace: IRIS_NAMESPACE },
    ctx,
  );
  return (listed.structuredContent as { items: Array<{ name: string }> }).items.map((item) => item.name);
}

/** Remove everything the gate writes: the data, then the data globals, then the documents. */
async function removeFixtures(): Promise<void> {
  await killGuardData();
  await killFixtureGlobals();
  for (const docName of ALL_DOCS) await removeStored(client, version, IRIS_NAMESPACE, docName);
}

// -- Guard helpers ---------------------------------------------------

async function guardRows(): Promise<Array<Record<string, unknown>>> {
  return runQuery(client, version, IRIS_NAMESPACE, `SELECT ID, Alpha, Beta FROM ${GUARD_TABLE} ORDER BY ID`);
}

/** A fresh Guard: removed, written, compiled (which generates its Storage), and given two rows. */
async function createGuard(): Promise<void> {
  await removeFixtures();
  await putDocLines(client, version, IRIS_NAMESPACE, GUARD_DOC, GUARD_SOURCE);
  await compileDocs(client, version, IRIS_NAMESPACE, [GUARD_DOC]);
  await runQuery(
    client,
    version,
    IRIS_NAMESPACE,
    `INSERT INTO ${GUARD_TABLE} (Alpha, Beta) SELECT 'alpha-1', 'beta-1' UNION ALL SELECT 'alpha-2', 'beta-2'`,
  );
}

/** The lines of the first Storage definition of `content`: from its `Storage <name>` line to its closing `}`. */
function storageLines(content: string[]): string[] {
  const start = content.findIndex((line) => /^Storage \S+$/.test(line));
  if (start < 0) return [];
  const end = content.indexOf("}", start);
  return content.slice(start, end + 1);
}

interface Snapshot {
  ts: string;
  content: string[];
  storage: string[];
  rows: Array<Record<string, unknown>>;
  count: unknown;
}

/** Everything a refused put must leave alone: the source, its `ts`, the Storage lines, the rows. */
async function snapshot(): Promise<Snapshot> {
  const read = await docGetTool.handler({ name: GUARD_DOC, namespace: IRIS_NAMESPACE }, ctx);
  const doc = read.structuredContent as { ts: string; content: string[] };
  const count = await runQuery(client, version, IRIS_NAMESPACE, `SELECT COUNT(*) AS n FROM ${GUARD_TABLE}`);
  return { ts: doc.ts, content: doc.content, storage: storageLines(doc.content), rows: await guardRows(), count: count[0]?.n };
}

function putGuard(args: Record<string, unknown>) {
  return docPutTool.handler({ name: GUARD_DOC, namespace: IRIS_NAMESPACE, ...args }, ctx);
}

/** The refusal text for a put to `docName` that drops `subject`. */
function droppedText(docName: string, subject: string): string {
  return (
    `Document '${docName}' was not saved in namespace '${IRIS_NAMESPACE}': the content drops ${subject} that the class has now, ` +
    "and IRIS would generate new storage at the next compile, which can change how existing rows are read. " +
    "Nothing was stored. Keep the Storage definitions in the content (read the class with iris_doc_get first), " +
    "or pass allowStorageRegeneration: true to let IRIS regenerate the storage."
  );
}

/** The Storage names IRIS echoes in the result of a class PUT (`flags: 1`; none otherwise). */
function echoedStorageNames(result: AtelierDocResult): string[] {
  return result.content.flatMap((line) => {
    const name = /^Storage (\S+)$/.exec(line)?.[1];
    return name === undefined ? [] : [name];
  });
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
}, 60000);

afterAll(async () => {
  if (skipReason) return;
  await removeFixtures();
}, 60000);

// -- The record: what IRIS does (AC-1) -------------------------------

describe("the record on a real persistent class, with raw requests (Story 38.3, AC-1)", () => {
  beforeEach(async () => {
    if (skipReason) return;
    await createGuard();
  }, 60000);

  it("the compile generates Storage Default in the UDL shape the scanner reads, with the class's two rows readable", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const before = await snapshot();

    expect(before.storage[0]).toBe("Storage Default");
    expect(before.storage[1]).toBe("{");
    expect(before.storage.at(-1)).toBe("}");
    expect(before.storage).toContain("<Type>%Storage.Persistent</Type>");
    expect(before.storage.filter((line) => line.startsWith("<Value>"))).toEqual([
      "<Value>%%CLASSNAME</Value>",
      "<Value>Alpha</Value>",
      "<Value>Beta</Value>",
    ]);
    expect(storageDefinitionNames(before.content)).toEqual(["Default"]);
    expect(before.content.at(-1)).toBe("");
    expect(before.rows).toEqual(ROWS);
    expect(before.count).toBe(2);
  }, 60000);

  it("a PUT with no If-None-Match to the existing class is refused with HTTP 409 that carries the current document, and writes nothing", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await snapshot();

    let rejection: unknown;
    try {
      await putDocLines(client, version, IRIS_NAMESPACE, GUARD_DOC, GUARD_REORDERED);
    } catch (error) {
      rejection = error;
    }

    expect(rejection).toBeInstanceOf(IrisApiError);
    const error = rejection as IrisApiError;
    expect(error.statusCode).toBe(409);
    const current = error.result as AtelierDocResult;
    expect(Object.keys(current).sort()).toEqual(
      ["cat", "content", "db", "enc", "flags", "name", "status", "ts", "upd"],
    );
    expect(current).toMatchObject({ name: GUARD_DOC, cat: "CLS", status: "", enc: false });
    expect(current.ts).toBe(before.ts);
    expect(current.content).toEqual(before.content);
    expect(await snapshot()).toEqual(before);
  }, 60000);

  it("If-None-Match: <ts> saves, and a stale ts is refused with HTTP 409 that carries the newer document", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await snapshot();

    await putDocLines(client, version, IRIS_NAMESPACE, GUARD_DOC, ["/// first", ...before.content], {
      "If-None-Match": before.ts,
    });
    const afterFirst = await snapshot();
    const statusCode = await putStatus(client, version, IRIS_NAMESPACE, GUARD_DOC, ["/// second", ...before.content], {
      "If-None-Match": before.ts,
    });

    expect(afterFirst.ts).not.toBe(before.ts);
    expect(afterFirst.content[0]).toBe("/// first");
    expect(statusCode).toBe(409);
    expect(await snapshot()).toEqual(afterFirst);
  }, 60000);

  it("a PUT without a Storage block drops the class's Storage, the rows still read, and the compile regenerates storage with the properties reordered, so the existing rows read swapped", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await snapshot();

    const dropped = await putDocLines(client, version, IRIS_NAMESPACE, GUARD_DOC, GUARD_REORDERED, {
      "If-None-Match": before.ts,
    });

    expect(dropped.flags).toBe(0);
    expect(dropped.content).toEqual([]);
    const afterDrop = await snapshot();
    expect(afterDrop.storage, "the stored source has no Storage").toEqual([]);
    expect(afterDrop.rows, "the rows still read until the next compile").toEqual(ROWS);

    await compileDocs(client, version, IRIS_NAMESPACE, [GUARD_DOC]);

    const afterCompile = await snapshot();
    expect(afterCompile.storage[0]).toBe("Storage Default");
    expect(afterCompile.storage.filter((line) => line.startsWith("<Value>"))).toEqual([
      "<Value>%%CLASSNAME</Value>",
      "<Value>Beta</Value>",
      "<Value>Alpha</Value>",
    ]);
    expect(afterCompile.rows, "the rows read swapped: silent data corruption").toEqual([
      { ID: 1, Alpha: "beta-1", Beta: "alpha-1" },
      { ID: 2, Alpha: "beta-2", Beta: "alpha-2" },
    ]);
    expect(afterCompile.count).toBe(2);
  }, 60000);
});

// -- The guard on the Guard class (AC-5) -----------------------------

describe("iris_doc_put on a persistent class with rows (Story 38.3, AC-5, AC-7)", () => {
  beforeEach(async () => {
    if (skipReason) return;
    await createGuard();
  }, 60000);

  for (const flags of [{}, { ignoreConflict: true }]) {
    const label = "ignoreConflict" in flags ? "with ignoreConflict" : "with no flags";

    it(`a put that drops the storage is refused with STORAGE_DROPPED ${label}, and the source, ts, row count and Storage lines are unchanged`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const before = await snapshot();
      expect(before.storage.length).toBeGreaterThan(0);

      const result = await putGuard({ content: GUARD_SOURCE, ...flags });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(droppedText(GUARD_DOC, "the Storage definition 'Default'"));
      expect(result.structuredContent).toEqual({
        code: "STORAGE_DROPPED",
        name: GUARD_DOC,
        namespace: IRIS_NAMESPACE,
        droppedStorage: ["Default"],
      });
      const after = await snapshot();
      expect(after.content).toEqual(before.content);
      expect(after.ts).toBe(before.ts);
      expect(after.count).toBe(2);
      expect(after.storage).toEqual(before.storage);
      expect(after.rows).toEqual(ROWS);
    }, 60000);
  }

  it("a content change inside the Storage block is saved, and the rows are unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await snapshot();
    const changed = before.content.map((line) =>
      line.startsWith("<StreamLocation>") ? line.replace("</StreamLocation>", "X</StreamLocation>") : line,
    );
    expect(changed, "the fixture has a StreamLocation line to change").not.toEqual(before.content);

    const result = await putGuard({ content: changed });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(`Document '${GUARD_DOC}' saved successfully in namespace '${IRIS_NAMESPACE}'.`);
    const after = await snapshot();
    expect(after.ts).not.toBe(before.ts);
    expect(after.storage.some((line) => line.startsWith("<StreamLocation>") && line.endsWith("X</StreamLocation>"))).toBe(true);
    expect(storageDefinitionNames(after.content)).toEqual(["Default"]);
    expect(after.rows).toEqual(ROWS);
  }, 60000);

  it("a default-mode put that keeps the storage saves, and the ts changes (DW-540)", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await snapshot();

    const result = await putGuard({ content: ["/// touched", ...before.content] });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(`Document '${GUARD_DOC}' saved successfully in namespace '${IRIS_NAMESPACE}'.`);
    const saved = result.structuredContent as AtelierDocResult;
    expect(saved).toMatchObject({ name: GUARD_DOC, status: "", flags: 1 });
    expect(echoedStorageNames(saved)).toEqual(["Default"]);
    const after = await snapshot();
    expect(after.content[0]).toBe("/// touched");
    expect(after.ts).not.toBe(before.ts);
    expect(after.storage).toEqual(before.storage);
    expect(after.rows).toEqual(ROWS);
  }, 60000);

  it("the same put with ignoreConflict also saves and the ts changes", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await snapshot();

    const result = await putGuard({ content: ["/// touched", ...before.content], ignoreConflict: true });

    expect(result.isError).toBeUndefined();
    const after = await snapshot();
    expect(after.content[0]).toBe("/// touched");
    expect(after.ts).not.toBe(before.ts);
  }, 60000);

  it("the override, with the properties reordered, saves with no Storage in the source, and the next compile swaps the rows", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const before = await snapshot();

    const result = await putGuard({ content: GUARD_REORDERED, allowStorageRegeneration: true });

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(`Document '${GUARD_DOC}' saved successfully in namespace '${IRIS_NAMESPACE}'.`);
    const afterPut = await snapshot();
    expect(afterPut.ts).not.toBe(before.ts);
    expect(afterPut.storage, "the source has no Storage").toEqual([]);
    expect(afterPut.rows, "the rows read as before until the compile").toEqual(ROWS);

    await compileDocs(client, version, IRIS_NAMESPACE, [GUARD_DOC]);

    expect((await snapshot()).rows).toEqual([
      { ID: 1, Alpha: "beta-1", Beta: "alpha-1" },
      { ID: 2, Alpha: "beta-2", Beta: "alpha-2" },
    ]);
  }, 60000);

  it("both flags: the put goes ahead on the one ignoreConflict request", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    const result = await putGuard({ content: GUARD_REORDERED, ignoreConflict: true, allowStorageRegeneration: true });

    expect(result.isError).toBeUndefined();
    expect((await snapshot()).storage).toEqual([]);
  }, 60000);
});

// -- The other fixtures (AC-5) ---------------------------------------

describe("iris_doc_put on the other fixtures (Story 38.3, AC-5)", () => {
  /** Create `docName` with `lines` by a raw PUT, after removing any earlier copy. */
  async function createRaw(docName: string, lines: string[]): Promise<AtelierDocResult> {
    await removeStored(client, version, IRIS_NAMESPACE, docName);
    return putDocLines(client, version, IRIS_NAMESPACE, docName, lines);
  }

  async function stored(docName: string): Promise<string[]> {
    const lines = await readStoredLines(client, version, IRIS_NAMESPACE, docName);
    expect(lines, `${docName} exists`).toBeDefined();
    return lines as string[];
  }

  function put(docName: string, args: Record<string, unknown>) {
    return docPutTool.handler({ name: docName, namespace: IRIS_NAMESPACE, ...args }, ctx);
  }

  describe("Multi: two Storage definitions, Default and Second", () => {
    const multiLines = (): string[] => fixtureLines("B: ", MULTI);

    beforeEach(async () => {
      if (skipReason) return;
      await createRaw(MULTI_DOC, multiLines());
    }, 60000);

    it("the stored class has both definitions", async (testCtx) => {
      if (skipReason) return testCtx.skip();

      expect(storageDefinitionNames(await stored(MULTI_DOC))).toEqual(["Default", "Second"]);
    }, 60000);

    it("dropping Second is refused with droppedStorage ['Second'], and the class is unchanged", async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const before = await stored(MULTI_DOC);

      const result = await put(MULTI_DOC, { content: fixtureLines("F:", MULTI) });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(droppedText(MULTI_DOC, "the Storage definition 'Second'"));
      expect(result.structuredContent).toEqual({
        code: "STORAGE_DROPPED",
        name: MULTI_DOC,
        namespace: IRIS_NAMESPACE,
        droppedStorage: ["Second"],
      });
      expect(await stored(MULTI_DOC)).toEqual(before);
    }, 60000);

    it("dropping both names several definitions in the order of the source", async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const before = await stored(MULTI_DOC);

      const result = await put(MULTI_DOC, { content: fixtureLines("A:", MULTI) });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toBe(droppedText(MULTI_DOC, "the Storage definitions 'Default', 'Second'"));
      expect((result.structuredContent as { droppedStorage: string[] }).droppedStorage).toEqual(["Default", "Second"]);
      expect(await stored(MULTI_DOC)).toEqual(before);
    }, 60000);

    it("changing a Storage definition's content is saved", async (testCtx) => {
      if (skipReason) return testCtx.skip();
      // Second's body gains a DataLocation line: the same names, different content.
      const changed = multiLines();
      const secondType = changed.lastIndexOf("<Type>%Storage.Persistent</Type>");
      changed.splice(secondType + 1, 0, "<DataLocation>^ExecuteMCPv2.Temp.QaStory383SecondD</DataLocation>");

      const result = await put(MULTI_DOC, { content: changed });

      expect(result.isError).toBeUndefined();
      const after = await stored(MULTI_DOC);
      expect(after.some((line) => line === "<DataLocation>^ExecuteMCPv2.Temp.QaStory383SecondD</DataLocation>")).toBe(true);
      expect(storageDefinitionNames(after)).toEqual(["Default", "Second"]);
    }, 60000);

    it("CRLF string content that keeps both definitions is split as today and saved", async (testCtx) => {
      if (skipReason) return testCtx.skip();

      const result = await put(MULTI_DOC, { content: multiLines().join("\r\n") });

      expect(result.isError).toBeUndefined();
      const after = await stored(MULTI_DOC);
      expect(storageDefinitionNames(after)).toEqual(["Default", "Second"]);
      expect(after.some((line) => line.includes("\r"))).toBe(false);
    }, 60000);

    it("array elements that end in a carriage return are refused: IRIS would not parse the Storage members", async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const before = await stored(MULTI_DOC);

      const result = await put(MULTI_DOC, { content: multiLines().map((line) => `${line}\r`) });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as { droppedStorage: string[] }).droppedStorage).toEqual(["Default", "Second"]);
      expect(await stored(MULTI_DOC)).toEqual(before);
    }, 60000);

    it("decoys that mention Storage in comments and strings do not keep it: the put with the real blocks removed is refused", async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const before = await stored(MULTI_DOC);

      const result = await put(MULTI_DOC, { content: fixtureLines("B decoys", MULTI) });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as { droppedStorage: string[] }).droppedStorage).toEqual(["Default", "Second"]);
      expect(await stored(MULTI_DOC)).toEqual(before);
    }, 60000);

    it("the override saves the drop", async (testCtx) => {
      if (skipReason) return testCtx.skip();

      const result = await put(MULTI_DOC, { content: fixtureLines("F:", MULTI), allowStorageRegeneration: true });

      expect(result.isError).toBeUndefined();
      expect(storageDefinitionNames(await stored(MULTI_DOC))).toEqual(["Default"]);
    }, 60000);

    it("the XML export of the same class is read the same way on both sides", async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const before = await stored(MULTI_DOC);
      const xmlBoth = fixtureLines("B as XML", MULTI);
      const secondStart = xmlBoth.indexOf('<Storage name="Second">');
      const xmlDefaultOnly = [
        ...xmlBoth.slice(0, secondStart),
        ...xmlBoth.slice(xmlBoth.indexOf("</Storage>", secondStart) + 1),
      ];

      const refused = await put(MULTI_DOC, { content: xmlDefaultOnly.join("\n") });

      expect(refused.isError).toBe(true);
      expect((refused.structuredContent as { droppedStorage: string[] }).droppedStorage).toEqual(["Second"]);
      expect(await stored(MULTI_DOC)).toEqual(before);

      const saved = await put(MULTI_DOC, { content: xmlBoth.join("\n") });

      expect(saved.isError).toBeUndefined();
      expect(storageDefinitionNames(await stored(MULTI_DOC))).toEqual(["Default", "Second"]);
    }, 60000);
  });

  describe("NoStorage: a class whose source has no Storage definition", () => {
    beforeEach(async () => {
      if (skipReason) return;
      await createRaw(NOSTORAGE_DOC, fixtureLines("A:", NOSTORAGE));
    }, 60000);

    it("is saved with a Storage block added, and again without one", async (testCtx) => {
      if (skipReason) return testCtx.skip();
      expect(storageDefinitionNames(await stored(NOSTORAGE_DOC))).toEqual([]);

      const added = await put(NOSTORAGE_DOC, { content: fixtureLines("F:", NOSTORAGE) });
      expect(added.isError).toBeUndefined();
      expect(storageDefinitionNames(await stored(NOSTORAGE_DOC))).toEqual(["Default"]);

      const replaced = await put(NOSTORAGE_DOC, { content: fixtureLines("A:", NOSTORAGE), allowStorageRegeneration: true });
      expect(replaced.isError).toBeUndefined();
      expect(storageDefinitionNames(await stored(NOSTORAGE_DOC))).toEqual([]);
    }, 60000);

    it("is saved by a put that has no Storage, with no override", async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const before = await stored(NOSTORAGE_DOC);

      const result = await put(NOSTORAGE_DOC, { content: ["/// touched", ...fixtureLines("A:", NOSTORAGE)] });

      expect(result.isError).toBeUndefined();
      const after = await stored(NOSTORAGE_DOC);
      expect(after[0]).toBe("/// touched");
      expect(after).not.toEqual(before);
    }, 60000);
  });

  describe("a routine", () => {
    beforeEach(async () => {
      if (skipReason) return;
      await createRaw(RTN_DOC, ROUTINE_V1);
    }, 60000);

    it("an existing routine is saved in default mode, and its ts changes (DW-540)", async (testCtx) => {
      if (skipReason) return testCtx.skip();
      const before = (await client.get(docPath(version, IRIS_NAMESPACE, RTN_DOC))).result as AtelierDocResult;
      expect(before.content).toEqual(ROUTINE_V1.map((line) => line.replace(" [Type=MAC]", "")));

      const result = await put(RTN_DOC, { content: ROUTINE_V2 });

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toBe(`Document '${RTN_DOC}' saved successfully in namespace '${IRIS_NAMESPACE}'.`);
      const after = (await client.get(docPath(version, IRIS_NAMESPACE, RTN_DOC))).result as AtelierDocResult;
      expect(after.content).toContain("Label ; the second version");
      expect(after.ts).not.toBe(before.ts);
    }, 60000);

    it("ignoreConflict saves it as before, and allowStorageRegeneration changes nothing", async (testCtx) => {
      if (skipReason) return testCtx.skip();

      const result = await put(RTN_DOC, { content: ROUTINE_V2, ignoreConflict: true, allowStorageRegeneration: false });

      expect(result.isError).toBeUndefined();
      expect(await stored(RTN_DOC)).toContain("Label ; the second version");
    }, 60000);
  });
});

// -- Request counts (AC-3, AC-7) -------------------------------------

describe("the requests iris_doc_put sends on the real client (Story 38.3, AC-3, AC-7)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("a new class makes one PUT with two arguments and no GET or HEAD", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await removeStored(client, version, IRIS_NAMESPACE, NOSTORAGE_DOC);
    const put = vi.spyOn(client, "put");
    const get = vi.spyOn(client, "get");
    const head = vi.spyOn(client, "head");

    const result = await docPutTool.handler(
      { name: NOSTORAGE_DOC, namespace: IRIS_NAMESPACE, content: fixtureLines("A:", NOSTORAGE) },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]).toHaveLength(2);
    expect(put.mock.calls[0]?.[0]).toBe(docPath(version, IRIS_NAMESPACE, NOSTORAGE_DOC));
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  }, 60000);

  it("a new routine makes one PUT and no GET or HEAD", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await removeStored(client, version, IRIS_NAMESPACE, RTN_DOC);
    const put = vi.spyOn(client, "put");
    const get = vi.spyOn(client, "get");
    const head = vi.spyOn(client, "head");

    const result = await docPutTool.handler({ name: RTN_DOC, namespace: IRIS_NAMESPACE, content: ROUTINE_V1 }, ctx);

    expect(result.isError).toBeUndefined();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]).toHaveLength(2);
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  }, 60000);

  it("an existing class makes exactly P0, then Pv carrying the ts it had, and no GET or HEAD", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await removeStored(client, version, IRIS_NAMESPACE, NOSTORAGE_DOC);
    await putDocLines(client, version, IRIS_NAMESPACE, NOSTORAGE_DOC, fixtureLines("A:", NOSTORAGE));
    const before = (await client.get(docPath(version, IRIS_NAMESPACE, NOSTORAGE_DOC))).result as AtelierDocResult;
    const put = vi.spyOn(client, "put");
    const get = vi.spyOn(client, "get");
    const head = vi.spyOn(client, "head");
    const content = ["/// touched", ...fixtureLines("A:", NOSTORAGE)];

    const result = await docPutTool.handler({ name: NOSTORAGE_DOC, namespace: IRIS_NAMESPACE, content }, ctx);

    expect(result.isError).toBeUndefined();
    const path = docPath(version, IRIS_NAMESPACE, NOSTORAGE_DOC);
    expect(put.mock.calls).toEqual([
      [path, { enc: false, content }],
      [path, { enc: false, content }, { headers: { "If-None-Match": before.ts } }],
    ]);
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  }, 60000);

  it("a refused drop makes exactly one PUT, the 409 that carries the read", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await removeStored(client, version, IRIS_NAMESPACE, MULTI_DOC);
    await putDocLines(client, version, IRIS_NAMESPACE, MULTI_DOC, fixtureLines("B: ", MULTI));
    const put = vi.spyOn(client, "put");
    const get = vi.spyOn(client, "get");
    const head = vi.spyOn(client, "head");

    const result = await docPutTool.handler(
      { name: MULTI_DOC, namespace: IRIS_NAMESPACE, content: fixtureLines("A:", MULTI) },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(put).toHaveBeenCalledTimes(1);
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
  }, 60000);
});

// -- Rows the mocked tests cannot prove on the wire ------------------

describe("iris_doc_put on the real wire: a conflict, a soft error, a new class with ignoreConflict, a .CLS name (Story 38.3, AC-3, AC-4)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Create `docName` with `lines` by a raw PUT, after removing any earlier copy. */
  async function createRaw(docName: string, lines: string[]): Promise<void> {
    await removeStored(client, version, IRIS_NAMESPACE, docName);
    await putDocLines(client, version, IRIS_NAMESPACE, docName, lines);
  }

  it("a change between the unversioned and the version-checked PUT is DOCUMENT_CONFLICT after exactly two PUTs, and only the other writer's text is stored", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    const original = fixtureLines("A:", NOSTORAGE);
    await createRaw(NOSTORAGE_DOC, original);
    const otherWriter = ["/// the other writer", ...original];
    const realPut = client.put.bind(client);
    let calls = 0;
    const put = vi.spyOn(client, "put").mockImplementation(async (path, body, options) => {
      calls += 1;
      try {
        return await realPut(path, body, options);
      } catch (error) {
        if (calls === 1 && error instanceof IrisApiError && error.statusCode === 409) {
          // The document changes between this tool's first request and its second.
          const { ts } = error.result as AtelierDocResult;
          await realPut(path, { enc: false, content: otherWriter }, { headers: { "If-None-Match": ts } });
        }
        throw error;
      }
    });

    const result = await docPutTool.handler(
      { name: NOSTORAGE_DOC, namespace: IRIS_NAMESPACE, content: ["/// this tool", ...original] },
      ctx,
    );

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text:
            `Document '${NOSTORAGE_DOC}' was not saved in namespace '${IRIS_NAMESPACE}': it changed on the server while this tool was saving it. ` +
            "Nothing was stored. Run iris_doc_put again to replace the current version.",
        },
      ],
      structuredContent: { code: "DOCUMENT_CONFLICT", name: NOSTORAGE_DOC, namespace: IRIS_NAMESPACE },
      isError: true,
    });
    expect(put, "the tool sent the unversioned PUT and the version-checked PUT, and never retried").toHaveBeenCalledTimes(2);
    const stored = await readStoredLines(client, version, IRIS_NAMESPACE, NOSTORAGE_DOC);
    expect(stored?.[0], "the other writer's text is the stored text").toBe("/// the other writer");
    expect(stored?.includes("/// this tool"), "nothing of this tool's text was stored").toBe(false);
  }, 60000);

  it("IRIS's refusal of text that is not a class, on the version-checked save, is today's refusal text and shape, after two PUTs, and the class is unchanged", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await createRaw(NOSTORAGE_DOC, fixtureLines("A:", NOSTORAGE));
    const before = await readStoredLines(client, version, IRIS_NAMESPACE, NOSTORAGE_DOC);
    const put = vi.spyOn(client, "put");

    const result = await docPutTool.handler(
      { name: NOSTORAGE_DOC, namespace: IRIS_NAMESPACE, content: "this is not a class header" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const refused = result.structuredContent as { name: string; db: string; ts: string; cat: string; enc: boolean; content: string; status: string };
    expect(refused).toEqual({ name: NOSTORAGE_DOC, db: "", ts: "", cat: "CLS", enc: false, content: "", status: refused.status });
    expect(refused.status, "IRIS's own text, carried through").not.toBe("");
    expect(result.content[0]?.text).toBe(
      `Document '${NOSTORAGE_DOC}' was not saved in namespace '${IRIS_NAMESPACE}': ${refused.status}. Nothing was stored; correct the document text and retry.`,
    );
    expect(put).toHaveBeenCalledTimes(2);
    expect(await readStoredLines(client, version, IRIS_NAMESPACE, NOSTORAGE_DOC)).toEqual(before);
  }, 60000);

  it("a new class with ignoreConflict makes one PUT on the bare path, and IRIS answers it as it answers the request that carries the flag", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    // A class with a Storage block, so both answers carry the Storage echo (flags 1) that is compared below.
    const lines = fixtureLines("F:", NOSTORAGE);
    await removeStored(client, version, IRIS_NAMESPACE, NOSTORAGE_DOC);
    const flagged = (
      await client.put(`${docPath(version, IRIS_NAMESPACE, NOSTORAGE_DOC)}?ignoreConflict=1`, { enc: false, content: lines })
    ).result as AtelierDocResult;
    await removeStored(client, version, IRIS_NAMESPACE, NOSTORAGE_DOC);
    const put = vi.spyOn(client, "put");
    const get = vi.spyOn(client, "get");
    const head = vi.spyOn(client, "head");

    const result = await docPutTool.handler(
      { name: NOSTORAGE_DOC, namespace: IRIS_NAMESPACE, content: lines, ignoreConflict: true },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]).toHaveLength(2);
    expect(put.mock.calls[0]?.[0], "no ?ignoreConflict=1 on a new document").toBe(docPath(version, IRIS_NAMESPACE, NOSTORAGE_DOC));
    expect(get).not.toHaveBeenCalled();
    expect(head).not.toHaveBeenCalled();
    expect(flagged.flags, "the flagged create echoes the Storage lines").toBe(1);
    expect(echoedStorageNames(flagged)).toEqual(["Default"]);
    expect({ ...(result.structuredContent as AtelierDocResult), ts: "" }, "the same result as the flagged request, apart from the ts").toEqual({
      ...flagged,
      ts: "",
    });
  }, 60000);

  it("a drop under an upper-case .CLS name is refused: IRIS treats Name.CLS and Name.cls as the same class", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await createRaw(MULTI_DOC, fixtureLines("B: ", MULTI));
    const before = await readStoredLines(client, version, IRIS_NAMESPACE, MULTI_DOC);
    const upperName = `${MULTI}.CLS`;

    const result = await docPutTool.handler(
      { name: upperName, namespace: IRIS_NAMESPACE, content: fixtureLines("F:", MULTI) },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(droppedText(upperName, "the Storage definition 'Second'"));
    expect(result.structuredContent).toEqual({
      code: "STORAGE_DROPPED",
      name: upperName,
      namespace: IRIS_NAMESPACE,
      droppedStorage: ["Second"],
    });
    expect(await readStoredLines(client, version, IRIS_NAMESPACE, MULTI_DOC)).toEqual(before);
  }, 60000);
});

// -- The oracle (AC-2) -----------------------------------------------

describe("the scanner against IRIS: every scanner fixture (Story 38.3, AC-2)", () => {
  for (const fixture of STORAGE_FIXTURES.filter((candidate) => candidate.oracle)) {
    it(`${fixture.id}: the names the scanner reads equal the names IRIS reports`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      await removeStored(client, version, IRIS_NAMESPACE, SHAPE_DOC);
      const lines = fixture.lines(SHAPE);

      const created = await putDocLines(client, version, IRIS_NAMESPACE, SHAPE_DOC, lines);

      const irisNames = echoedStorageNames(created);
      expect(irisNames, "the pinned names equal what IRIS reports").toEqual(fixture.names);
      expect(storageDefinitionNames(lines), "the scanner equals IRIS").toEqual(irisNames);
      expect(created.flags).toBe(irisNames.length > 0 ? 1 : 0);
    }, 60000);

    it(`${fixture.id}: the 409 for the next put carries the current document in the nine-key shape, in the input's format`, async (testCtx) => {
      if (skipReason) return testCtx.skip();
      await removeStored(client, version, IRIS_NAMESPACE, SHAPE_DOC);
      const lines = fixture.lines(SHAPE);
      await putDocLines(client, version, IRIS_NAMESPACE, SHAPE_DOC, lines);

      let rejection: unknown;
      try {
        await putDocLines(client, version, IRIS_NAMESPACE, SHAPE_DOC, lines);
      } catch (error) {
        rejection = error;
      }

      expect(rejection).toBeInstanceOf(IrisApiError);
      const error = rejection as IrisApiError;
      expect(error.statusCode).toBe(409);
      const current = error.result as AtelierDocResult;
      expect(Object.keys(current).sort()).toEqual(
        ["cat", "content", "db", "enc", "flags", "name", "status", "ts", "upd"],
      );
      expect(current.status).toBe("");
      expect(current.enc).toBe(false);
      expect(typeof current.ts).toBe("string");
      expect(current.ts).not.toBe("");
      expect(Array.isArray(current.content)).toBe(true);
      expect(storageDefinitionNames(current.content), "the echoed source has the stored Storage names").toEqual(fixture.names);
      const echoedAsXml = current.content[0]?.trimStart().startsWith("<");
      expect(echoedAsXml, "XML in, XML out; UDL in, UDL out").toBe(lines[0]?.trimStart().startsWith("<"));
      expect(droppedStorageDefinitions(current.content, lines)).toEqual([]);
    }, 60000);
  }
});

// -- Nothing left behind ---------------------------------------------

describe("cleanup (Story 38.3, AC-5)", () => {
  it("after the gate removes its fixtures, no document, generated routine or global named QaStory383 remains", async (testCtx) => {
    if (skipReason) return testCtx.skip();

    await removeFixtures();

    expect(await listFixtureDocuments()).toEqual([]);
    expect(await listFixtureGlobals()).toEqual([]);
  }, 60000);
});
