/**
 * Story 38.3 - `iris_doc_put` Storage-drop guard.
 *
 * Describes:
 *
 *  1. Back-compat (AC-4, Rule #19): the inputs whose result and calls the story leaves alone are pinned
 *     as literals. The literals were captured on the UNMODIFIED tree (baseline commit 2e9114e, before
 *     any 38.3 source edit) by running
 *     `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc-put-storage-guard.test.ts`
 *     with this describe only: it passed on that tree, so every literal below is what the baseline
 *     handler returned and sent for these inputs (Rule #36). They are never edited to match the new code,
 *     except the two call lists the story changes on purpose (marked in place).
 *  2. The matrix (AC-3, AC-7): an existing class (the guard, the version-checked save, the refusals),
 *     the other document types, and the schema and description.
 *
 * The fakes are real Atelier shapes, captured live on 2026-10-15 (IRIS 2026.2 build 221U, Atelier v8,
 * HSCUSTOM): a `PUT /doc` result has the nine keys `name, db, ts, upd, cat, status, enc, flags, content`;
 * a class create echoes only the class's Storage lines in `content` with `flags: 1` (`flags: 0` and
 * `content: []` when the class has none); a routine create is `flags: 0, content: []`; and a document
 * IRIS refuses inside an HTTP 200 envelope has `ts: ""`, `content: ""` and a string `status`.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IrisApiError, type ToolContext } from "@iris-mcp/shared";
import { STORAGE_FIXTURES } from "@iris-mcp/shared/test-helpers/storage-guard-fixtures";
import { docPutTool } from "../tools/doc.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

const CLASS_PATH = "/api/atelier/v7/USER/doc/Test.Fixture.cls";
const ROUTINE_PATH = "/api/atelier/v7/USER/doc/Test.Fixture.mac";
const TS_CREATE = "2026-10-15 17:59:20.947";
const TS_CURRENT = "2026-10-15 17:58:02.301";
const TS_UPDATE = "2026-10-15 17:59:21.512";

/** A class create: IRIS echoes the generated Storage lines, `flags: 1`. */
const CLASS_CREATE_RESULT = {
  name: "Test.Fixture.cls",
  db: "HSCUSTOM",
  ts: TS_CREATE,
  upd: false,
  cat: "CLS",
  status: "",
  enc: false,
  flags: 1,
  content: ["Storage Default", "{", "<Type>%Storage.Persistent</Type>", "}", ""],
};

/** A routine create: no echoed lines. */
const ROUTINE_CREATE_RESULT = {
  name: "Test.Fixture.mac",
  db: "HSCUSTOM",
  ts: TS_CREATE,
  upd: false,
  cat: "RTN",
  status: "",
  enc: false,
  flags: 0,
  content: [],
};

/** A successful replace of an existing class that has no Storage. */
const CLASS_REPLACE_RESULT = {
  name: "Test.Fixture.cls",
  db: "HSCUSTOM",
  ts: TS_UPDATE,
  upd: false,
  cat: "CLS",
  status: "",
  enc: false,
  flags: 0,
  content: [],
};

/** The soft error: HTTP 200, empty `status.errors`, the reason only in `result.status`. */
const SOFT_ERROR_RESULT = {
  name: "Test.Fixture.cls",
  db: "",
  ts: "",
  cat: "CLS",
  enc: false,
  content: "",
  status: "ERROR #16021: Illegal Header Line: this is not a class header",
};

/**
 * The current document of an existing class as the 409 carries it: the same nine keys as a GET, with
 * the class's lines (and a trailing empty element) in `content`.
 */
function currentClass(lines: string[], ts = TS_CURRENT): Record<string, unknown> {
  return {
    name: "Test.Fixture.cls",
    db: "HSCUSTOM",
    ts,
    upd: false,
    cat: "CLS",
    status: "",
    enc: false,
    flags: 0,
    content: [...lines, ""],
  };
}

/** The HTTP 409 the shared client throws for a put to an existing document that carries no version token. */
function conflict(path: string, result: unknown): IrisApiError {
  return new IrisApiError(
    409,
    [],
    path,
    `IRIS returned HTTP 409 for PUT ${path}. Check the request parameters and try again.`,
    result,
  );
}

const CLASS_LINES = ["Class Test.Fixture Extends %Persistent", "{", "}"];
const CLASS_TEXT = CLASS_LINES.join("\n");
const ROUTINE_LINES = ["ROUTINE Test.Fixture [Type=MAC]", "Label ; routine", "    Quit"];
const ROUTINE_TEXT = ROUTINE_LINES.join("\n");

const SAVED_CLASS = {
  content: [{ type: "text", text: "Document 'Test.Fixture.cls' saved successfully in namespace 'USER'." }],
};
const SAVED_ROUTINE = {
  content: [{ type: "text", text: "Document 'Test.Fixture.mac' saved successfully in namespace 'USER'." }],
};

describe("iris_doc_put back-compat: the unchanged rows (Story 38.3, AC-4, Rule #19)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("a new class: one PUT on the bare path, today's result, no GET or HEAD", async () => {
    mockHttp.put.mockResolvedValue(envelope(CLASS_CREATE_RESULT));

    const result = await docPutTool.handler({ name: "Test.Fixture.cls", content: CLASS_TEXT }, ctx);

    expect(result).toEqual({ ...SAVED_CLASS, structuredContent: CLASS_CREATE_RESULT });
    expect(mockHttp.put.mock.calls).toEqual([[CLASS_PATH, { enc: false, content: CLASS_LINES }]]);
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  });

  it("a new class with ignoreConflict: today's result, from one request that omits the flag", async () => {
    mockHttp.put.mockResolvedValue(envelope(CLASS_CREATE_RESULT));

    const result = await docPutTool.handler(
      { name: "Test.Fixture.cls", content: CLASS_TEXT, ignoreConflict: true },
      ctx,
    );

    expect(result).toEqual({ ...SAVED_CLASS, structuredContent: CLASS_CREATE_RESULT });
    // The baseline tree sent this one request as `${CLASS_PATH}?ignoreConflict=1`. The flag has no effect on
    // a new document and the result is identical, so the request omits it: a new class pays no extra read
    // (spec interpretation 1).
    expect(mockHttp.put.mock.calls).toEqual([[CLASS_PATH, { enc: false, content: CLASS_LINES }]]);
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  });

  it("an existing class with ignoreConflict: the last request and the result are today's, after the 409 that writes nothing", async () => {
    mockHttp.put
      .mockRejectedValueOnce(conflict(CLASS_PATH, currentClass([])))
      .mockResolvedValueOnce(envelope(CLASS_REPLACE_RESULT));

    const result = await docPutTool.handler(
      { name: "Test.Fixture.cls", content: CLASS_TEXT, ignoreConflict: true },
      ctx,
    );

    expect(result).toEqual({ ...SAVED_CLASS, structuredContent: CLASS_REPLACE_RESULT });
    // The baseline tree sent only this request.
    expect(mockHttp.put.mock.calls.at(-1)).toEqual([
      `${CLASS_PATH}?ignoreConflict=1`,
      { enc: false, content: CLASS_LINES },
    ]);
    expect(mockHttp.put.mock.calls).toHaveLength(2);
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  });

  it("a new routine: one PUT on the bare path, today's result", async () => {
    mockHttp.put.mockResolvedValue(envelope(ROUTINE_CREATE_RESULT));

    const result = await docPutTool.handler({ name: "Test.Fixture.mac", content: ROUTINE_TEXT }, ctx);

    expect(result).toEqual({ ...SAVED_ROUTINE, structuredContent: ROUTINE_CREATE_RESULT });
    expect(mockHttp.put.mock.calls).toEqual([[ROUTINE_PATH, { enc: false, content: ROUTINE_LINES }]]);
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  });

  it("a routine with ignoreConflict: one request carrying ?ignoreConflict=1, today's result", async () => {
    mockHttp.put.mockResolvedValue(envelope(ROUTINE_CREATE_RESULT));

    const result = await docPutTool.handler(
      { name: "Test.Fixture.mac", content: ROUTINE_TEXT, ignoreConflict: true },
      ctx,
    );

    expect(result).toEqual({ ...SAVED_ROUTINE, structuredContent: ROUTINE_CREATE_RESULT });
    expect(mockHttp.put.mock.calls).toEqual([
      [`${ROUTINE_PATH}?ignoreConflict=1`, { enc: false, content: ROUTINE_LINES }],
    ]);
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  });

  it("a BOM-prefixed string: the BOM never reaches the wire, today's result", async () => {
    mockHttp.put.mockResolvedValue(envelope(CLASS_CREATE_RESULT));

    const result = await docPutTool.handler(
      { name: "Test.Fixture.cls", content: `\uFEFF${CLASS_TEXT}` },
      ctx,
    );

    expect(result).toEqual({ ...SAVED_CLASS, structuredContent: CLASS_CREATE_RESULT });
    expect(mockHttp.put.mock.calls).toEqual([[CLASS_PATH, { enc: false, content: CLASS_LINES }]]);
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  });

  it("the soft error: today's refusal text and shape, one PUT", async () => {
    mockHttp.put.mockResolvedValue(envelope(SOFT_ERROR_RESULT));

    const result = await docPutTool.handler({ name: "Test.Fixture.cls", content: "this is not a class header" }, ctx);

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Document 'Test.Fixture.cls' was not saved in namespace 'USER': ERROR #16021: Illegal Header Line: this is not a class header. Nothing was stored; correct the document text and retry.",
        },
      ],
      structuredContent: SOFT_ERROR_RESULT,
      isError: true,
    });
    expect(mockHttp.put.mock.calls).toEqual([[CLASS_PATH, { enc: false, content: ["this is not a class header"] }]]);
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The matrix (AC-3, AC-7). "P0" is the request with no query and no header, "Pi" carries
// ?ignoreConflict=1, and "Pv" carries `If-None-Match` set to the `ts` of the 409.
// ---------------------------------------------------------------------------

/** A scanner fixture's text for class `Test.Fixture`, found by the start of its id. */
function fixtureLines(idPrefix: string): string[] {
  const fixture = STORAGE_FIXTURES.find((candidate) => candidate.id.startsWith(idPrefix));
  if (fixture === undefined) throw new Error(`no scanner fixture starts with '${idPrefix}'`);
  return fixture.lines("Test.Fixture");
}

const NO_STORAGE = fixtureLines("A:");
const DEFAULT_ONLY = fixtureLines("F:");
const DEFAULT_AND_SECOND = fixtureLines("B: ");
const DECOYS_ONLY = fixtureLines("B decoys");

/** `lines` with the Storage definition named `name` renamed to `renamed`. */
function renameStorage(lines: string[], name: string, renamed: string): string[] {
  return lines.map((line) => (line === `Storage ${name}` ? `Storage ${renamed}` : line));
}

const SAVED_REPLACE = { ...SAVED_CLASS, structuredContent: CLASS_REPLACE_RESULT };
const bodyOf = (lines: string[]) => ({ enc: false, content: lines });
const versionChecked = (ts: string) => ({ headers: { "If-None-Match": ts } });

/** The refusal text for a put that drops `names` (quoted) from `Test.Fixture.cls` in namespace USER. */
function droppedText(subject: string): string {
  return (
    `Document 'Test.Fixture.cls' was not saved in namespace 'USER': the content drops ${subject} that the class has now, ` +
    "and IRIS would generate new storage at the next compile, which can change how existing rows are read. " +
    "Nothing was stored. Keep the Storage definitions in the content (read the class with iris_doc_get first), " +
    "or pass allowStorageRegeneration: true to let IRIS regenerate the storage."
  );
}

describe("iris_doc_put on an existing class: the Storage guard and the version-checked save (Story 38.3, AC-3, AC-7)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  /** The class exists with text `current`: P0 is answered with the 409, then the next request is saved. */
  function existingClass(current: string[], saved: unknown = CLASS_REPLACE_RESULT): void {
    mockHttp.put
      .mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(current)))
      .mockResolvedValueOnce(envelope(saved));
  }

  function put(args: Record<string, unknown>) {
    return docPutTool.handler({ name: "Test.Fixture.cls", ...args }, ctx);
  }

  function expectNoReadRequests(): void {
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  }

  it("keeps its storage: P0 returns the 409, then Pv carries the 409's ts, then success (DW-540)", async () => {
    existingClass(DEFAULT_ONLY);

    const result = await put({ content: DEFAULT_ONLY });

    expect(result).toEqual(SAVED_REPLACE);
    expect(mockHttp.put.mock.calls).toEqual([
      [CLASS_PATH, bodyOf(DEFAULT_ONLY)],
      [CLASS_PATH, bodyOf(DEFAULT_ONLY), versionChecked(TS_CURRENT)],
    ]);
    expectNoReadRequests();
  });

  it("changed storage content under the same names is saved the same way", async () => {
    existingClass(DEFAULT_ONLY);
    const changed = DEFAULT_ONLY.map((line) =>
      line === "<Type>%Storage.Persistent</Type>" ? "<Type>%Storage.Persistent</Type><DataLocation>^X</DataLocation>" : line,
    );

    const result = await put({ content: changed });

    expect(result).toEqual(SAVED_REPLACE);
    expect(mockHttp.put.mock.calls).toEqual([
      [CLASS_PATH, bodyOf(changed)],
      [CLASS_PATH, bodyOf(changed), versionChecked(TS_CURRENT)],
    ]);
  });

  it("a class that has no Storage now may be saved with or without one", async () => {
    for (const proposed of [NO_STORAGE, DEFAULT_ONLY]) {
      mockHttp.put.mockReset();
      existingClass(NO_STORAGE);

      const result = await put({ content: proposed });

      expect(result, proposed === NO_STORAGE ? "without" : "with").toEqual(SAVED_REPLACE);
      expect(mockHttp.put.mock.calls).toEqual([
        [CLASS_PATH, bodyOf(proposed)],
        [CLASS_PATH, bodyOf(proposed), versionChecked(TS_CURRENT)],
      ]);
    }
  });

  it("keeps its storage with ignoreConflict: P0 returns the 409, then Pi", async () => {
    existingClass(DEFAULT_ONLY);

    const result = await put({ content: DEFAULT_ONLY, ignoreConflict: true });

    expect(result).toEqual(SAVED_REPLACE);
    expect(mockHttp.put.mock.calls).toEqual([
      [CLASS_PATH, bodyOf(DEFAULT_ONLY)],
      [`${CLASS_PATH}?ignoreConflict=1`, bodyOf(DEFAULT_ONLY)],
    ]);
    expectNoReadRequests();
  });

  it("a drop is refused with STORAGE_DROPPED: the 409 is the only request, and nothing is written", async () => {
    mockHttp.put.mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(DEFAULT_AND_SECOND)));

    const result = await put({ content: DEFAULT_ONLY });

    expect(result).toEqual({
      content: [{ type: "text", text: droppedText("the Storage definition 'Second'") }],
      structuredContent: { code: "STORAGE_DROPPED", name: "Test.Fixture.cls", namespace: "USER", droppedStorage: ["Second"] },
      isError: true,
    });
    expect(mockHttp.put.mock.calls).toEqual([[CLASS_PATH, bodyOf(DEFAULT_ONLY)]]);
    expectNoReadRequests();
  });

  it("a rename is a drop of the old name", async () => {
    mockHttp.put.mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(DEFAULT_ONLY)));

    const result = await put({ content: renameStorage(DEFAULT_ONLY, "Default", "Main") });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(droppedText("the Storage definition 'Default'"));
    expect(result.structuredContent).toEqual({
      code: "STORAGE_DROPPED",
      name: "Test.Fixture.cls",
      namespace: "USER",
      droppedStorage: ["Default"],
    });
    expect(mockHttp.put.mock.calls).toHaveLength(1);
  });

  it("several dropped definitions are listed in the order of the current source", async () => {
    mockHttp.put.mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(DEFAULT_AND_SECOND)));

    const result = await put({ content: NO_STORAGE });

    expect(result.content[0]?.text).toBe(droppedText("the Storage definitions 'Default', 'Second'"));
    expect((result.structuredContent as { droppedStorage: string[] }).droppedStorage).toEqual(["Default", "Second"]);
    expect(mockHttp.put.mock.calls).toHaveLength(1);
  });

  it("a refused drop with ignoreConflict is still refused: no Pi follows the 409", async () => {
    mockHttp.put.mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(DEFAULT_AND_SECOND)));

    const result = await put({ content: DEFAULT_ONLY, ignoreConflict: true });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { code: string }).code).toBe("STORAGE_DROPPED");
    expect(mockHttp.put.mock.calls).toEqual([[CLASS_PATH, bodyOf(DEFAULT_ONLY)]]);
  });

  it("allowStorageRegeneration lets the drop through: P0, the 409, then Pv, then success", async () => {
    existingClass(DEFAULT_AND_SECOND);

    const result = await put({ content: DEFAULT_ONLY, allowStorageRegeneration: true });

    expect(result).toEqual(SAVED_REPLACE);
    expect(mockHttp.put.mock.calls).toEqual([
      [CLASS_PATH, bodyOf(DEFAULT_ONLY)],
      [CLASS_PATH, bodyOf(DEFAULT_ONLY), versionChecked(TS_CURRENT)],
    ]);
  });

  it("both flags: Pi only, today's request and result, whatever the class holds", async () => {
    mockHttp.put.mockResolvedValue(envelope(CLASS_REPLACE_RESULT));

    const result = await put({ content: DEFAULT_ONLY, ignoreConflict: true, allowStorageRegeneration: true });

    expect(result).toEqual(SAVED_REPLACE);
    expect(mockHttp.put.mock.calls).toEqual([[`${CLASS_PATH}?ignoreConflict=1`, bodyOf(DEFAULT_ONLY)]]);
    expectNoReadRequests();
  });

  it("decoys that mention Storage do not count: a class whose real blocks are removed drops them all", async () => {
    mockHttp.put.mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(DEFAULT_AND_SECOND)));

    const result = await put({ content: DECOYS_ONLY });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { droppedStorage: string[] }).droppedStorage).toEqual(["Default", "Second"]);
    expect(mockHttp.put.mock.calls).toHaveLength(1);
  });

  it("CRLF string content is split as today and its Storage is found, so it is saved", async () => {
    existingClass(DEFAULT_ONLY);

    const result = await put({ content: DEFAULT_ONLY.join("\r\n") });

    expect(result).toEqual(SAVED_REPLACE);
    expect(mockHttp.put.mock.calls[0]).toEqual([CLASS_PATH, bodyOf(DEFAULT_ONLY)]);
  });

  it("array elements that end in a carriage return keep no Storage that IRIS would parse, so the drop is refused", async () => {
    mockHttp.put.mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(DEFAULT_ONLY)));

    const result = await put({ content: fixtureLines("G:") });

    expect(result.isError).toBe(true);
    expect((result.structuredContent as { droppedStorage: string[] }).droppedStorage).toEqual(["Default"]);
    expect(mockHttp.put.mock.calls).toHaveLength(1);
  });

  describe("XML content (the 409 echoes the current source in XML)", () => {
    const xmlBoth = fixtureLines("B as XML");
    const secondStart = xmlBoth.indexOf('<Storage name="Second">');
    const xmlDefaultOnly = [
      ...xmlBoth.slice(0, secondStart),
      ...xmlBoth.slice(xmlBoth.indexOf("</Storage>", secondStart) + 1),
    ];

    it("names come from <Storage name=...> on both sides: dropping Second is refused", async () => {
      mockHttp.put.mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(xmlBoth)));

      const result = await put({ content: xmlDefaultOnly.join("\n") });

      expect(result.isError).toBe(true);
      expect((result.structuredContent as { droppedStorage: string[] }).droppedStorage).toEqual(["Second"]);
      expect(mockHttp.put.mock.calls).toEqual([[CLASS_PATH, bodyOf(xmlDefaultOnly)]]);
    });

    it("keeping both is saved with Pv", async () => {
      existingClass(xmlBoth);

      const result = await put({ content: xmlBoth.join("\n") });

      expect(result).toEqual(SAVED_REPLACE);
      expect(mockHttp.put.mock.calls[1]).toEqual([CLASS_PATH, bodyOf(xmlBoth), versionChecked(TS_CURRENT)]);
    });
  });

  it("a 409 on the version-checked save is the DOCUMENT_CONFLICT refusal: exactly two requests, never a third", async () => {
    // A third request would succeed: only the count and the result can catch a retry.
    mockHttp.put
      .mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(DEFAULT_ONLY)))
      .mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(DEFAULT_ONLY, TS_UPDATE)))
      .mockResolvedValue(envelope(CLASS_REPLACE_RESULT));

    const result = await put({ content: DEFAULT_ONLY });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text:
            "Document 'Test.Fixture.cls' was not saved in namespace 'USER': it changed on the server while this tool was saving it. " +
            "Nothing was stored. Run iris_doc_put again to replace the current version.",
        },
      ],
      structuredContent: { code: "DOCUMENT_CONFLICT", name: "Test.Fixture.cls", namespace: "USER" },
      isError: true,
    });
    expect(mockHttp.put.mock.calls).toHaveLength(2);
    expectNoReadRequests();
  });

  it("a 409 on Pi is not the conflict refusal: it propagates", async () => {
    const second = conflict(CLASS_PATH, currentClass(DEFAULT_ONLY));
    mockHttp.put.mockRejectedValueOnce(conflict(CLASS_PATH, currentClass(DEFAULT_ONLY))).mockRejectedValueOnce(second);

    await expect(put({ content: DEFAULT_ONLY, ignoreConflict: true })).rejects.toBe(second);
    expect(mockHttp.put.mock.calls).toHaveLength(2);
  });

  describe("an unreadable 409 is rethrown as it is, with no second request", () => {
    const unreadable: Array<[string, Record<string, unknown>]> = [
      ["content is not an array", { ...currentClass(DEFAULT_ONLY), content: "Class Test.Fixture {}" }],
      ["ts is not a string", { ...currentClass(DEFAULT_ONLY), ts: 12345 }],
      ["ts is missing", Object.fromEntries(Object.entries(currentClass(DEFAULT_ONLY)).filter(([key]) => key !== "ts"))],
      ["status is not empty", { ...currentClass(DEFAULT_ONLY), status: "ERROR #16006: Document does not exist" }],
    ];

    for (const [label, result] of unreadable) {
      it(label, async () => {
        const error = conflict(CLASS_PATH, result);
        mockHttp.put.mockRejectedValueOnce(error);

        await expect(put({ content: DEFAULT_ONLY })).rejects.toBe(error);
        expect(error.message).toContain("IRIS returned HTTP 409");
        expect(mockHttp.put.mock.calls).toHaveLength(1);
      });
    }

    it("a 409 that carries no result at all", async () => {
      const error = new IrisApiError(409, [], CLASS_PATH);
      mockHttp.put.mockRejectedValueOnce(error);

      await expect(put({ content: DEFAULT_ONLY })).rejects.toBe(error);
      expect(mockHttp.put.mock.calls).toHaveLength(1);
    });
  });

  describe("any other error on P0 propagates as today", () => {
    for (const error of [
      new IrisApiError(423, [], CLASS_PATH),
      new IrisApiError(500, [], CLASS_PATH),
      new Error("ECONNREFUSED"),
    ]) {
      it(error instanceof IrisApiError ? `HTTP ${error.statusCode}` : "a network failure", async () => {
        mockHttp.put.mockRejectedValueOnce(error);

        await expect(put({ content: DEFAULT_ONLY })).rejects.toBe(error);
        expect(mockHttp.put.mock.calls).toHaveLength(1);
      });
    }
  });

  it("a soft error on the version-checked save is today's refusal text and shape", async () => {
    existingClass(DEFAULT_ONLY, SOFT_ERROR_RESULT);

    const result = await put({ content: DEFAULT_ONLY });

    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Document 'Test.Fixture.cls' was not saved in namespace 'USER': ERROR #16021: Illegal Header Line: this is not a class header. Nothing was stored; correct the document text and retry.",
        },
      ],
      structuredContent: SOFT_ERROR_RESULT,
      isError: true,
    });
    expect(mockHttp.put.mock.calls).toHaveLength(2);
  });
});

describe("iris_doc_put on other document types: never guarded, never read first (Story 38.3, AC-3, AC-7)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  const MACRO_PATH = "/api/atelier/v7/USER/doc/Test.Fixture.inc";

  it("a new include file: one request on the bare path", async () => {
    mockHttp.put.mockResolvedValue(envelope({ ...ROUTINE_CREATE_RESULT, name: "Test.Fixture.inc" }));

    const result = await docPutTool.handler({ name: "Test.Fixture.inc", content: ["ROUTINE Test.Fixture [Type=INC]"] }, ctx);

    expect(result.isError).toBeUndefined();
    expect(mockHttp.put.mock.calls).toEqual([[MACRO_PATH, bodyOf(["ROUTINE Test.Fixture [Type=INC]"])]]);
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  });

  it("an existing routine, no flags: P0 returns the 409, then Pv carries its ts, then success (DW-540)", async () => {
    mockHttp.put
      .mockRejectedValueOnce(
        conflict(ROUTINE_PATH, { ...ROUTINE_CREATE_RESULT, ts: TS_CURRENT, content: ["ROUTINE Test.Fixture", "Label ; old", "    Quit"] }),
      )
      .mockResolvedValueOnce(envelope({ ...ROUTINE_CREATE_RESULT, ts: TS_UPDATE }));

    const result = await docPutTool.handler({ name: "Test.Fixture.mac", content: ROUTINE_TEXT }, ctx);

    expect(result).toEqual({ ...SAVED_ROUTINE, structuredContent: { ...ROUTINE_CREATE_RESULT, ts: TS_UPDATE } });
    expect(mockHttp.put.mock.calls).toEqual([
      [ROUTINE_PATH, bodyOf(ROUTINE_LINES)],
      [ROUTINE_PATH, bodyOf(ROUTINE_LINES), versionChecked(TS_CURRENT)],
    ]);
    expect(mockHttp.get.mock.calls).toEqual([]);
    expect(mockHttp.head.mock.calls).toEqual([]);
  });

  it("a conflict on the routine's version-checked save is DOCUMENT_CONFLICT after exactly two requests", async () => {
    mockHttp.put
      .mockRejectedValueOnce(conflict(ROUTINE_PATH, { ...ROUTINE_CREATE_RESULT, ts: TS_CURRENT, content: ["ROUTINE Test.Fixture"] }))
      .mockRejectedValueOnce(conflict(ROUTINE_PATH, { ...ROUTINE_CREATE_RESULT, ts: TS_UPDATE, content: ["ROUTINE Test.Fixture"] }))
      .mockResolvedValue(envelope(ROUTINE_CREATE_RESULT));

    const result = await docPutTool.handler({ name: "Test.Fixture.mac", content: ROUTINE_TEXT }, ctx);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ code: "DOCUMENT_CONFLICT", name: "Test.Fixture.mac", namespace: "USER" });
    expect(mockHttp.put.mock.calls).toHaveLength(2);
  });

  it("with ignoreConflict: Pi only, and allowStorageRegeneration is ignored either way", async () => {
    for (const extra of [{}, { allowStorageRegeneration: true }, { allowStorageRegeneration: false }]) {
      mockHttp.put.mockReset();
      mockHttp.put.mockResolvedValue(envelope(ROUTINE_CREATE_RESULT));

      const result = await docPutTool.handler(
        { name: "Test.Fixture.mac", content: ROUTINE_TEXT, ignoreConflict: true, ...extra },
        ctx,
      );

      expect(result).toEqual({ ...SAVED_ROUTINE, structuredContent: ROUTINE_CREATE_RESULT });
      expect(mockHttp.put.mock.calls).toEqual([[`${ROUTINE_PATH}?ignoreConflict=1`, bodyOf(ROUTINE_LINES)]]);
    }
  });

  it("a non-class document is never scanned for Storage, even when its current text holds Storage definitions the new text lacks", async () => {
    mockHttp.put
      .mockRejectedValueOnce(
        conflict(ROUTINE_PATH, { ...ROUTINE_CREATE_RESULT, ts: TS_CURRENT, content: DEFAULT_AND_SECOND }),
      )
      .mockResolvedValueOnce(envelope(ROUTINE_CREATE_RESULT));

    const result = await docPutTool.handler({ name: "Test.Fixture.mac", content: ROUTINE_TEXT }, ctx);

    expect(result).toEqual({ ...SAVED_ROUTINE, structuredContent: ROUTINE_CREATE_RESULT });
    expect(mockHttp.put.mock.calls).toEqual([
      [ROUTINE_PATH, bodyOf(ROUTINE_LINES)],
      [ROUTINE_PATH, bodyOf(ROUTINE_LINES), versionChecked(TS_CURRENT)],
    ]);
  });
});

describe("iris_doc_put: the schema and the description (Story 38.3, AC-3, AC-7)", () => {
  const shape = docPutTool.inputSchema.shape as Record<string, { description?: string; parse(value: unknown): unknown }>;

  it("allowStorageRegeneration is documented, with its default, the refusal and the override's consequence", () => {
    const text = shape.allowStorageRegeneration?.description ?? "";
    expect(text).toContain("default false");
    expect(text).toContain("refused and nothing is stored");
    expect(text).toContain("changing a Storage definition's content is allowed");
    expect(text).toContain("generates new storage at the next compile");
    expect(text).toContain("No effect on a new class or on other document types");
  });

  it("allowStorageRegeneration is optional, takes a boolean or its string form, and has no injected default", () => {
    const parse = (value: unknown) => docPutTool.inputSchema.parse(value) as { allowStorageRegeneration?: boolean };
    expect(parse({ name: "A.cls", content: "x" }).allowStorageRegeneration).toBeUndefined();
    expect(parse({ name: "A.cls", content: "x", allowStorageRegeneration: true }).allowStorageRegeneration).toBe(true);
    expect(parse({ name: "A.cls", content: "x", allowStorageRegeneration: "false" }).allowStorageRegeneration).toBe(false);
  });

  it("ignoreConflict is documented as optional, default false, and the version check it skips", () => {
    const text = shape.ignoreConflict?.description ?? "";
    expect(text).toContain("default false");
    expect(text).toContain("Not needed to replace an existing document");
    expect(text).toContain("saves only if it is still that version");
    expect(text).toContain("IRIS skips that version check");
    expect(text).not.toContain("newer");
  });

  it("the tool description states the version check, the Storage refusal, the override and the always-allowed content change", () => {
    const description = docPutTool.description ?? "";
    expect(description).toContain("An existing document is saved only if it has not changed since this tool read its current version; ignoreConflict skips that check.");
    expect(description).toContain("a put whose content drops one of the class's Storage definitions is refused and nothing is stored");
    expect(description).toContain("allowStorageRegeneration (default false) lets it through");
    expect(description).toContain("changing a Storage definition's content is always allowed");
    expect(description).toContain("A leading byte-order mark is stripped from the content before it is sent");
  });

  it("the tool key, its annotations and its scope are unchanged", () => {
    expect(docPutTool.name).toBe("iris_doc_put");
    expect(docPutTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(docPutTool.scope).toBe("NS");
    expect(docPutTool.mutates).toBeUndefined();
  });
});
