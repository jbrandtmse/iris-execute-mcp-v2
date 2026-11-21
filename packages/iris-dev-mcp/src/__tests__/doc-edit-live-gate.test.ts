/**
 * Story 38.4 (AC-3, AC-4, AC-5, AC-7) - `iris_doc_edit` against a REAL IRIS.
 *
 * `doc-edit.test.ts` pins the handler against mocked HTTP. This gate drives the handler through the real
 * `IrisHttpClient` and the real Atelier `GET /doc` and `PUT /doc` routes, so the properties the tool rests
 * on are proven where they happen:
 *
 *  - an edit with a replace, an insert and a delete in one call is saved, the class compiles afterwards,
 *    and the answer comes from the re-read: each excerpt equals the matching ranged `iris_doc_get` slice,
 *    `totalLines` and `ts` equal a fresh read, every hunk of `unifiedDiff` reproduces the lines it names on
 *    both sides, and the blank line IRIS adds between members is in the diff and in the excerpt (AC-5);
 *  - a stale `expected` is refused with STALE_CONTENT and the stored lines and `ts` are byte-identical
 *    afterwards (AC-3);
 *  - a writer that saves between the tool's read and its save makes the tool's one version-checked PUT
 *    answer HTTP 409, reported as DOCUMENT_CONFLICT after exactly one tool PUT, with the other writer's
 *    text stored and no `ignoreConflict` ever sent (AC-3);
 *  - on a persistent compiled class, removing its Storage lines with `apply` is refused with
 *    STORAGE_DROPPED and changes nothing, while the same edits through `regenerateStorage` save (AC-4);
 *  - a routine's last line (a routine has no trailing empty element), edited with a CRLF text, is stored
 *    exactly as sent (AC-7).
 *
 * Every test first PUTs its fixture's starting text. The tool sends no compile request (AC-8).
 *
 * Arming: runs only with `IRIS_REQUIRE_LIVE=1` (or `true`), against the target named by
 * `IRIS_HOST`/`IRIS_PORT`/`IRIS_USERNAME`/`IRIS_PASSWORD`/`IRIS_NAMESPACE` (all required, none defaulted;
 * `@iris-mcp/shared/test-helpers/live-target`). Unarmed, every test skips before any request. Writes only the
 * disposable `ExecuteMCPv2.Temp.QaStory384Edit.cls` (compiled by the test), `...Store.cls` (persistent, compiled, no rows) and `...Rtn.mac` documents. Before
 * and after the run the gate removes the documents and every data global whose name starts `ExecuteMCPv` and
 * carries one of its fixture stems (`QaStory384Edit`, `QaStory384Store`, `QaStory384Rtn`), then asserts that no
 * such document (generated ones included) or global is left; another gate's `QaStory384Wire*` fixtures are
 * not this gate's. Armed, an unreachable IRIS fails the gate instead of skipping it.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import {
  IrisHttpClient,
  buildToolContext,
  loadConfig,
  negotiateVersion,
  ping,
  storageDefinitionNames,
  type ToolContext,
} from "@iris-mcp/shared";
import { liveConnectionEnv, liveGateTarget } from "@iris-mcp/shared/test-helpers/live-target";
import { docGetTool, docListTool } from "../tools/doc.js";
import { docEditTool } from "../tools/doc-edit.js";
import { globalKillTool, globalListTool } from "../tools/global.js";
import {
  compileDocs,
  docPath,
  putDocLines,
  removeStored,
  type AtelierDocResult,
} from "./live-doc-helpers.js";

const LIVE = liveGateTarget();
const IRIS_HOST = LIVE.target.host;
const IRIS_PORT = LIVE.target.port;
const IRIS_NAMESPACE = LIVE.target.namespace;

const REQUIRE_LIVE =
  process.env.IRIS_REQUIRE_LIVE === "1" || process.env.IRIS_REQUIRE_LIVE === "true";

const PREFIX = "ExecuteMCPv2.Temp.QaStory384";
const EDIT = `${PREFIX}Edit`;
const STORE = `${PREFIX}Store`;
const RTN = `${PREFIX}Rtn`;
const EDIT_DOC = `${EDIT}.cls`;
const STORE_DOC = `${STORE}.cls`;
const RTN_DOC = `${RTN}.mac`;
const ALL_DOCS = [EDIT_DOC, STORE_DOC, RTN_DOC];

/**
 * The name stems of this gate's fixtures. The listing filter `QaStory384` also matches other gates'
 * fixtures (the `iris-mcp-all` wire gate's `QaStory384Wire*`), which may exist while this gate runs, so
 * this gate lists, kills and asserts only names that carry one of its own stems.
 */
const OWN_STEMS = ["QaStory384Edit", "QaStory384Store", "QaStory384Rtn"];

/** Whether a listed document or global name belongs to this gate's fixtures. */
function isOwnFixture(name: string): boolean {
  return OWN_STEMS.some((stem) => name.includes(stem));
}

let skipReason: string | undefined;
let ctx: ToolContext;
let client: IrisHttpClient;
let version: number;

// -- Fixtures --------------------------------------------------------

/** The Edit class as written: a property, a scratch comment to delete, and a method. */
const EDIT_SOURCE = [
  `Class ${EDIT} Extends %RegisteredObject`,
  "{",
  "",
  "Property Alpha As %String;",
  "",
  "/// Scratch comment to delete.",
  "Method Run() As %Status",
  "{",
  "\tSet tSC = $$$OK",
  "\tQuit tSC",
  "}",
  "",
  "}",
];

/** The Store class as written: persistent, with no Storage (the compile generates it) and no rows. */
const STORE_SOURCE = [
  `Class ${STORE} Extends %Persistent`,
  "{",
  "",
  "Property Name As %String;",
  "",
  "}",
];

/** The Rtn routine as written: no trailing empty element. */
const RTN_SOURCE = [`ROUTINE ${RTN} [Type=MAC]`, "Main ; entry point", "    Write 1,!", "    Quit"];

// -- Cleanup ---------------------------------------------------------

/** This gate's fixture globals (see {@link OWN_STEMS}), with the caret IRIS lists them with. */
async function listFixtureGlobals(): Promise<string[]> {
  const listed = await globalListTool.handler({ filter: "QaStory384", namespace: IRIS_NAMESPACE }, ctx);
  expect(listed.isError, "the global listing").toBeUndefined();
  return (listed.structuredContent as { globals: string[] }).globals.filter(isOwnFixture);
}

/** Kill every global of this gate's fixtures whose name starts `ExecuteMCPv`. */
async function killFixtureGlobals(): Promise<void> {
  for (const listed of await listFixtureGlobals()) {
    const name = listed.replace(/^\^/, "");
    if (!name.startsWith("ExecuteMCPv")) continue;
    const result = await globalKillTool.handler({ global: name, namespace: IRIS_NAMESPACE }, ctx);
    expect(result.isError, `killing global ${name}`).toBeUndefined();
  }
}

/** This gate's fixture documents (see {@link OWN_STEMS}), generated documents included. */
async function listFixtureDocuments(): Promise<string[]> {
  const listed = await docListTool.handler(
    { filter: "QaStory384", generated: true, namespace: IRIS_NAMESPACE },
    ctx,
  );
  return (listed.structuredContent as { items: Array<{ name: string }> }).items
    .map((item) => item.name)
    .filter(isOwnFixture);
}

/** Remove everything the gate writes: the data globals, then the documents. */
async function removeFixtures(): Promise<void> {
  await killFixtureGlobals();
  for (const docName of ALL_DOCS) await removeStored(client, version, IRIS_NAMESPACE, docName);
}

// -- Helpers ---------------------------------------------------------

/** Create `docName` with `lines` by a raw PUT, after removing any earlier copy. */
async function putFresh(docName: string, lines: string[]): Promise<void> {
  await removeStored(client, version, IRIS_NAMESPACE, docName);
  await putDocLines(client, version, IRIS_NAMESPACE, docName, lines);
}

/** The stored document: its version token and its lines. */
async function readDoc(docName: string): Promise<{ ts: string; content: string[] }> {
  const result = (await client.get(docPath(version, IRIS_NAMESPACE, docName))).result as AtelierDocResult;
  return { ts: result.ts, content: result.content };
}

function edit(args: Record<string, unknown>) {
  return docEditTool.handler({ namespace: IRIS_NAMESPACE, ...args }, ctx);
}

/** The 1-based number of the first stored line equal to `line`; fails when there is none. */
function lineNumber(content: string[], line: string): number {
  const index = content.indexOf(line);
  expect(index, `the stored document has the line ${JSON.stringify(line)}`).toBeGreaterThanOrEqual(0);
  return index + 1;
}

/**
 * Check every hunk of a unified diff against the two documents it compares: the hunk's ` ` and `-` rows
 * are exactly the `before` lines at its old range, and its ` ` and `+` rows are exactly the `after` lines
 * at its new range.
 *
 * @returns The number of hunks.
 */
function checkHunks(diff: string, before: string[], after: string[]): number {
  const rows = diff.split("\n").slice(2);
  const hunks: Array<{ header: string; rows: string[] }> = [];
  for (const row of rows) {
    if (row.startsWith("@@ ")) hunks.push({ header: row, rows: [] });
    else hunks[hunks.length - 1]?.rows.push(row);
  }
  for (const hunk of hunks) {
    const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@$/.exec(hunk.header);
    expect(match, hunk.header).not.toBeNull();
    const oldCount = match?.[2] === undefined ? 1 : Number(match[2]);
    const newCount = match?.[4] === undefined ? 1 : Number(match[4]);
    const oldFirst = oldCount === 0 ? Number(match?.[1]) : Number(match?.[1]) - 1;
    const newFirst = newCount === 0 ? Number(match?.[3]) : Number(match?.[3]) - 1;
    const oldRows = hunk.rows.filter((row) => row[0] !== "+").map((row) => row.slice(1));
    const newRows = hunk.rows.filter((row) => row[0] !== "-").map((row) => row.slice(1));
    expect(before.slice(oldFirst, oldFirst + oldCount), `${hunk.header}: the old side equals the read`).toEqual(oldRows);
    expect(after.slice(newFirst, newFirst + newCount), `${hunk.header}: the new side equals the re-read`).toEqual(newRows);
  }
  return hunks.length;
}

/** The lines of the first Storage definition of `content`: from its `Storage <name>` line to its closing `}`. */
function storageRange(content: string[]): { first: number; last: number } {
  const start = content.findIndex((line) => /^Storage \S+$/.test(line));
  expect(start, "the compiled class has a Storage definition").toBeGreaterThanOrEqual(0);
  return { first: start + 1, last: content.indexOf("}", start) + 1 };
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

  await removeFixtures();
  expect(await listFixtureDocuments(), "no QaStory384 document before the run").toEqual([]);
  expect(await listFixtureGlobals(), "no QaStory384 global before the run").toEqual([]);
}, 60000);

afterAll(async () => {
  if (skipReason) return;
  await removeFixtures();
  expect(await listFixtureDocuments(), "no QaStory384 document after the run").toEqual([]);
  expect(await listFixtureGlobals(), "no QaStory384 global after the run").toEqual([]);
}, 60000);

afterEach(() => {
  vi.restoreAllMocks();
});

// -- A class edit: replace, insert and delete in one call ------------

describe("iris_doc_edit on a class, against the real Atelier routes (Story 38.4, AC-5, AC-7)", () => {
  it("saves a replace, an insert and a delete in one call, answers from the re-read, and the class compiles", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await putFresh(EDIT_DOC, EDIT_SOURCE);
    const before = await readDoc(EDIT_DOC);
    const setLine = lineNumber(before.content, "\tSet tSC = $$$OK");
    const alphaLine = lineNumber(before.content, "Property Alpha As %String;");
    const commentLine = lineNumber(before.content, "/// Scratch comment to delete.");
    const get = vi.spyOn(client, "get");
    const put = vi.spyOn(client, "put");
    const post = vi.spyOn(client, "post");

    const result = await edit({
      action: "apply",
      name: EDIT_DOC,
      edits: [
        {
          op: "replace",
          startLine: setLine,
          endLine: setLine,
          text: '\tSet tSC = $$$ERROR($$$GeneralError, "edited")',
          expected: "\tSet tSC = $$$OK",
        },
        { op: "insert", afterLine: alphaLine, text: "Property Beta As %String;", expected: "Property Alpha As %String;" },
        { op: "delete", startLine: commentLine, endLine: commentLine, expected: "/// Scratch comment to delete." },
      ],
    });

    expect(result.isError).toBeUndefined();
    const answer = result.structuredContent as {
      name: string;
      namespace: string;
      ts: string;
      totalLines: number;
      changed: boolean;
      unifiedDiff: string;
      excerpts: Array<{ edit: number; op: string; startLine: number; endLine: number; lines: string[] }>;
    };
    expect(answer.changed).toBe(true);
    expect(answer.name).toBe(EDIT_DOC);
    expect(answer.namespace).toBe(IRIS_NAMESPACE);

    // The requests: one read, one version-checked save with no flag, one re-read, and no compile.
    const path = docPath(version, IRIS_NAMESPACE, EDIT_DOC);
    expect(get.mock.calls).toEqual([[path], [path]]);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[0], "no ignoreConflict on the PUT").toBe(path);
    expect(put.mock.calls[0]?.[2]).toEqual({ headers: { "If-None-Match": before.ts } });
    expect(post, "the tool sends no compile request").not.toHaveBeenCalled();
    const sent = (put.mock.calls[0]?.[1] as { content: string[] }).content;

    // totalLines and ts are those of a fresh read.
    const fresh = await readDoc(EDIT_DOC);
    expect(answer.totalLines).toBe(fresh.content.length);
    expect(answer.ts).toBe(fresh.ts);
    expect(fresh.ts).not.toBe(before.ts);

    // The three edits are in the stored text.
    expect(fresh.content).toContain('\tSet tSC = $$$ERROR($$$GeneralError, "edited")');
    expect(fresh.content).toContain("Property Beta As %String;");
    expect(fresh.content).not.toContain("/// Scratch comment to delete.");

    // IRIS reformatted the class: it put a blank line between the two properties, which was not sent.
    const sentAlpha = sent.indexOf("Property Alpha As %String;");
    expect(sent[sentAlpha + 1], "the tool sent Beta right after Alpha").toBe("Property Beta As %String;");
    const freshAlpha = fresh.content.indexOf("Property Alpha As %String;");
    expect(fresh.content[freshAlpha + 1], "IRIS added a blank line").toBe("");
    expect(fresh.content[freshAlpha + 2]).toBe("Property Beta As %String;");
    expect(fresh.content.length).toBeGreaterThan(sent.length);

    // The diff compares the read with the re-read: every hunk reproduces both, and it shows the added blank line.
    expect(answer.unifiedDiff.split("\n").slice(0, 2)).toEqual([
      `--- ${EDIT_DOC}\t${before.ts}`,
      `+++ ${EDIT_DOC}\t${fresh.ts}`,
    ]);
    expect(checkHunks(answer.unifiedDiff, before.content, fresh.content)).toBeGreaterThan(0);
    const diffRows = answer.unifiedDiff.split("\n");
    const betaRow = diffRows.indexOf("+Property Beta As %String;");
    expect(betaRow, "the diff adds Beta").toBeGreaterThan(0);
    expect(
      diffRows[betaRow - 1] === "+" || diffRows[betaRow + 1] === "+",
      "the blank line IRIS added is in the diff",
    ).toBe(true);

    // Each excerpt is the matching ranged iris_doc_get slice, and the insert's excerpt holds the blank line.
    expect(answer.excerpts.map((excerpt) => [excerpt.edit, excerpt.op])).toEqual([
      [1, "replace"],
      [2, "insert"],
      [3, "delete"],
    ]);
    for (const excerpt of answer.excerpts) {
      const slice = await docGetTool.handler(
        { name: EDIT_DOC, startLine: excerpt.startLine, endLine: excerpt.endLine, namespace: IRIS_NAMESPACE },
        ctx,
      );
      expect(slice.isError, `the ranged read of excerpt ${excerpt.edit}`).toBeUndefined();
      const range = slice.structuredContent as { lines: string[]; startLine: number; endLine: number; ts: string };
      expect(excerpt.lines, `excerpt ${excerpt.edit}`).toEqual(range.lines);
      expect([excerpt.startLine, excerpt.endLine]).toEqual([range.startLine, range.endLine]);
      expect(range.ts).toBe(answer.ts);
    }
    const insertExcerpt = answer.excerpts[1]?.lines ?? [];
    const alphaInExcerpt = insertExcerpt.indexOf("Property Alpha As %String;");
    expect(insertExcerpt.slice(alphaInExcerpt, alphaInExcerpt + 3)).toEqual([
      "Property Alpha As %String;",
      "",
      "Property Beta As %String;",
    ]);

    // The text mirrors the structured content, and the class compiles.
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(`${answer.excerpts.length} edits applied; it has ${fresh.content.length} lines now (ts ${fresh.ts}).`);
    expect(text).toContain(answer.unifiedDiff);
    expect(text).toContain("It is not compiled: run iris_doc_compile next.");
    await compileDocs(client, version, IRIS_NAMESPACE, [EDIT_DOC]);
  }, 60000);

  it("an edit whose result equals the stored text sends no save and no re-read, and reports no change", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await putFresh(EDIT_DOC, EDIT_SOURCE);
    const before = await readDoc(EDIT_DOC);
    const setLine = lineNumber(before.content, "\tSet tSC = $$$OK");
    const get = vi.spyOn(client, "get");
    const put = vi.spyOn(client, "put");

    const result = await edit({
      action: "apply",
      name: EDIT_DOC,
      edits: [{ op: "replace", startLine: setLine, endLine: setLine, text: "\tSet tSC = $$$OK", expected: "\tSet tSC = $$$OK" }],
    });

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toMatchObject({ changed: false, unifiedDiff: "", ts: before.ts, totalLines: before.content.length });
    expect(get).toHaveBeenCalledTimes(1);
    expect(put).not.toHaveBeenCalled();
    expect(await readDoc(EDIT_DOC)).toEqual(before);
  }, 60000);
});

// -- A stale expected ------------------------------------------------

describe("a stale expected text (Story 38.4, AC-3)", () => {
  it("is refused with STALE_CONTENT, and the stored lines and ts are byte-identical afterwards", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await putFresh(EDIT_DOC, EDIT_SOURCE);
    const before = await readDoc(EDIT_DOC);
    const setLine = lineNumber(before.content, "\tSet tSC = $$$OK");
    const put = vi.spyOn(client, "put");

    const result = await edit({
      action: "apply",
      name: EDIT_DOC,
      edits: [{ op: "replace", startLine: setLine, endLine: setLine, text: "\tSet tSC = 2", expected: "\tSet tSC = $$$NOT_THE_TEXT" }],
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "STALE_CONTENT",
      name: EDIT_DOC,
      namespace: IRIS_NAMESPACE,
      ts: before.ts,
      totalLines: before.content.length,
      mismatches: [{ edit: 1, op: "replace", startLine: setLine, endLine: setLine, current: "\tSet tSC = $$$OK\n" }],
    });
    expect(put, "no save was sent").not.toHaveBeenCalled();
    expect(await readDoc(EDIT_DOC)).toEqual(before);
  }, 60000);

  it("a line shifted by another writer makes the expected text stale, and nothing is stored", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await putFresh(EDIT_DOC, EDIT_SOURCE);
    const before = await readDoc(EDIT_DOC);
    const setLine = lineNumber(before.content, "\tSet tSC = $$$OK");
    await putDocLines(client, version, IRIS_NAMESPACE, EDIT_DOC, ["/// shifted", ...before.content], {
      "If-None-Match": before.ts,
    });
    const shifted = await readDoc(EDIT_DOC);

    const result = await edit({
      action: "apply",
      name: EDIT_DOC,
      edits: [{ op: "replace", startLine: setLine, endLine: setLine, text: "\tSet tSC = 2", expected: "\tSet tSC = $$$OK" }],
    });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code?: string }).code).toBe("STALE_CONTENT");
    expect(await readDoc(EDIT_DOC)).toEqual(shifted);
  }, 60000);
});

// -- A concurrent writer ---------------------------------------------

describe("a writer between the tool's read and its save (Story 38.4, AC-3)", () => {
  it("is DOCUMENT_CONFLICT after exactly one tool PUT, never retried, and the stored text is the other writer's", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await putFresh(EDIT_DOC, EDIT_SOURCE);
    const before = await readDoc(EDIT_DOC);
    const setLine = lineNumber(before.content, "\tSet tSC = $$$OK");
    const otherWriter = ["/// the other writer", ...before.content];
    const realPut = client.put.bind(client);
    let toolPuts = 0;
    const put = vi.spyOn(client, "put").mockImplementation(async (path, body, options) => {
      toolPuts += 1;
      // The document changes between this tool's read and its save.
      await realPut(path, { enc: false, content: otherWriter }, { headers: { "If-None-Match": before.ts } });
      return realPut(path, body, options);
    });

    const result = await edit({
      action: "apply",
      name: EDIT_DOC,
      edits: [{ op: "replace", startLine: setLine, endLine: setLine, text: "\tSet tSC = 2", expected: "\tSet tSC = $$$OK" }],
    });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text:
            `Document '${EDIT_DOC}' was not changed in namespace '${IRIS_NAMESPACE}': it changed on the server after this tool read it. ` +
            "Nothing was stored. Read the lines again with iris_doc_get and retry the edits against the current text.",
        },
      ],
      structuredContent: { code: "DOCUMENT_CONFLICT", name: EDIT_DOC, namespace: IRIS_NAMESPACE },
      isError: true,
    });
    expect(toolPuts, "the tool sent one PUT and never retried").toBe(1);
    expect(put.mock.calls[0]?.[2]).toEqual({ headers: { "If-None-Match": before.ts } });
    expect(JSON.stringify(put.mock.calls.map((call) => call[0]))).not.toContain("ignoreConflict");
    const stored = await readDoc(EDIT_DOC);
    expect(stored.content[0], "the other writer's text is the stored text").toBe("/// the other writer");
    expect(stored.content).not.toContain("\tSet tSC = 2");
  }, 60000);

});

// -- The Storage guard -----------------------------------------------

describe("the Storage guard on a persistent compiled class (Story 38.4, AC-4)", () => {
  async function createStore(): Promise<void> {
    await putFresh(STORE_DOC, STORE_SOURCE);
    await compileDocs(client, version, IRIS_NAMESPACE, [STORE_DOC]);
  }

  it("apply refuses an edit that removes the Storage lines with STORAGE_DROPPED and changes nothing; regenerateStorage saves the same edits", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await createStore();
    const before = await readDoc(STORE_DOC);
    expect(storageDefinitionNames(before.content), "the compile generated Storage").toEqual(["Default"]);
    const { first, last } = storageRange(before.content);
    const edits = [
      { op: "delete", startLine: first, endLine: last, expected: before.content.slice(first - 1, last).join("\n") },
    ];
    const put = vi.spyOn(client, "put");

    const refused = await edit({ action: "apply", name: STORE_DOC, edits });

    expect(refused.isError).toBe(true);
    expect(refused.structuredContent).toEqual({
      code: "STORAGE_DROPPED",
      name: STORE_DOC,
      namespace: IRIS_NAMESPACE,
      droppedStorage: ["Default"],
    });
    expect(refused.content[0]?.text).toContain(
      "Keep the Storage definitions in the edited lines, or run the same edits with action regenerateStorage (disabled unless an operator enables it) to let IRIS regenerate the storage.",
    );
    expect(put, "no save was sent").not.toHaveBeenCalled();
    expect(await readDoc(STORE_DOC)).toEqual(before);

    const saved = await edit({ action: "regenerateStorage", name: STORE_DOC, edits });

    expect(saved.isError).toBeUndefined();
    expect(saved.structuredContent).toMatchObject({ changed: true, name: STORE_DOC });
    expect(put).toHaveBeenCalledTimes(1);
    const after = await readDoc(STORE_DOC);
    expect(after.ts).not.toBe(before.ts);
    expect(storageDefinitionNames(after.content), "the source has no Storage").toEqual([]);
  }, 120000);

  it("an apply that keeps the Storage lines is saved", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await createStore();
    const before = await readDoc(STORE_DOC);
    const nameLine = lineNumber(before.content, "Property Name As %String;");

    const result = await edit({
      action: "apply",
      name: STORE_DOC,
      edits: [{ op: "replace", startLine: nameLine, endLine: nameLine, text: "Property Name As %Integer;", expected: "Property Name As %String;" }],
    });

    expect(result.isError).toBeUndefined();
    const after = await readDoc(STORE_DOC);
    expect(after.content).toContain("Property Name As %Integer;");
    expect(storageDefinitionNames(after.content)).toEqual(["Default"]);
  }, 120000);
});

// -- A routine -------------------------------------------------------

describe("a routine edited at its last line with a CRLF text (Story 38.4, AC-7)", () => {
  it("is stored exactly as sent: the lines before are untouched, the last line has no carriage return, and no trailing empty line is added", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await putFresh(RTN_DOC, RTN_SOURCE);
    const before = await readDoc(RTN_DOC);
    const last = before.content.length;
    expect(before.content.at(-1), "a routine has no trailing empty element").toBe("    Quit");

    const result = await edit({
      action: "apply",
      name: RTN_DOC,
      edits: [{ op: "replace", startLine: last, endLine: last, text: "    Quit 1\r\n", expected: "    Quit" }],
    });

    expect(result.isError).toBeUndefined();
    const after = await readDoc(RTN_DOC);
    expect(after.content).toEqual([...before.content.slice(0, -1), "    Quit 1"]);
    expect(after.content.some((line) => line.includes("\r"))).toBe(false);
    expect(result.structuredContent).toMatchObject({
      changed: true,
      ts: after.ts,
      totalLines: after.content.length,
      excerpts: [{ edit: 1, op: "replace", startLine: 1, endLine: last, lines: after.content }],
    });
    expect((result.structuredContent as { unifiedDiff: string }).unifiedDiff).toContain("-    Quit\n+    Quit 1");
  }, 60000);

  it("inserts after the last line of a routine and deletes it again", async (testCtx) => {
    if (skipReason) return testCtx.skip();
    await putFresh(RTN_DOC, RTN_SOURCE);
    const before = await readDoc(RTN_DOC);
    const last = before.content.length;

    const added = await edit({
      action: "apply",
      name: RTN_DOC,
      edits: [{ op: "insert", afterLine: last, text: "Other ; second label\n    Quit\n", expected: "    Quit" }],
    });

    expect(added.isError).toBeUndefined();
    const withLabel = await readDoc(RTN_DOC);
    expect(withLabel.content).toEqual([...before.content, "Other ; second label", "    Quit"]);

    const removed = await edit({
      action: "apply",
      name: RTN_DOC,
      edits: [{ op: "delete", startLine: last + 1, endLine: last + 2, expected: "Other ; second label\n    Quit" }],
    });

    expect(removed.isError).toBeUndefined();
    expect((await readDoc(RTN_DOC)).content).toEqual(before.content);
  }, 60000);
});

// Nothing left behind (Story 38.4, AC-7): the `beforeAll` and `afterAll` above remove the QaStory384
// fixtures and assert that no document, generated routine or global remains, whatever order the tests ran in.
