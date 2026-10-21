/**
 * Story 42.11 - the Storage-drop guard on `iris_doc_load`.
 *
 * The matrix rows (default GET read, `ignoreConflict: false` 409 read, override, nothing dropped, read
 * fails) with exact texts and request sequences. The expected texts come from the story's Design Notes,
 * never from the implementation. The fakes are the real Atelier shapes of `conflict-fakes.ts`: a GET of
 * an existing class answers the nine-key document, a GET of a new one is a 404, and an unversioned PUT of
 * an existing document is the 409 that carries it.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { IrisApiError, type ToolContext } from "@iris-mcp/shared";
import { STORAGE_FIXTURES } from "@iris-mcp/shared/test-helpers/storage-guard-fixtures";
import { docLoadTool } from "../tools/load.js";
import { conflict, currentClass, notFound, TS_CURRENT } from "./conflict-fakes.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  globSync: vi.fn(),
}));

import { readFileSync, globSync } from "node:fs";

const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
const mockGlobSync = globSync as unknown as ReturnType<typeof vi.fn>;

/** A scanner fixture's text for class `Test.Fixture`, found by the start of its id. */
function fixtureLines(idPrefix: string): string[] {
  const fixture = STORAGE_FIXTURES.find((candidate) => candidate.id.startsWith(idPrefix));
  if (fixture === undefined) throw new Error(`no scanner fixture starts with '${idPrefix}'`);
  return fixture.lines("Test.Fixture");
}

const NO_STORAGE = fixtureLines("A:");
const DEFAULT_ONLY = fixtureLines("F:");
const DEFAULT_AND_SECOND = fixtureLines("B: ");

const FILE = "c:/src/Test/Fixture.cls";
const OTHER_FILE = "c:/src/Test/Other.cls";
const OTHER_LINES = ["Class Test.Other Extends %Persistent", "{", "}"];
const GET_PATH = "/api/atelier/v7/USER/doc/Test.Fixture.cls";
const PUT_PATH = GET_PATH;
const OTHER_PUT_PATH = "/api/atelier/v7/USER/doc/Test.Other.cls";

const bodyOf = (lines: string[]) => ({ enc: false, content: lines });
const versionChecked = { headers: { "If-None-Match": TS_CURRENT } };

/** The failure text for a file that drops the Storage definitions `subject` (already quoted and worded). */
function droppedText(subject: string): string {
  return (
    `Document 'Test.Fixture.cls' was not saved in namespace 'USER': the content drops ${subject} that the class has now, ` +
    "and IRIS would generate new storage at the next compile, which can change how existing rows are read. " +
    "Nothing was stored. Keep the Storage definitions in the file (read the class with iris_doc_get first), " +
    "or pass allowStorageRegeneration: true to let IRIS regenerate the storage."
  );
}

describe("iris_doc_load: the Storage guard (Story 42.11)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  /** The local files: each path holds the lines. */
  function localFiles(files: Record<string, string[]>): void {
    mockGlobSync.mockReturnValue(Object.keys(files));
    mockReadFileSync.mockImplementation((path: string) => (files[path] as string[]).join("\n"));
  }

  /** The class `Test.Fixture` exists on the server with `lines`; every other document is new (404). */
  function serverHolds(lines: string[]): void {
    mockHttp.get.mockImplementation(async (path: string) => {
      if (path === GET_PATH) return envelope(currentClass(lines));
      throw notFound(path);
    });
  }

  function load(args: Record<string, unknown> = {}) {
    return docLoadTool.handler({ path: "c:/src/**/*.cls", ...args }, ctx);
  }

  beforeEach(() => {
    mockReadFileSync.mockReset();
    mockGlobSync.mockReset();
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  describe("default (ignoreConflict true): the GET read", () => {
    it("refuses a file that drops the class's Storage: one GET, no PUT, a failures entry with the text, the code and the names", async () => {
      localFiles({ [FILE]: NO_STORAGE });
      serverHolds(DEFAULT_ONLY);

      const result = await load();

      expect(mockHttp.get.mock.calls).toEqual([[GET_PATH]]);
      expect(mockHttp.put.mock.calls).toEqual([]);
      expect(result.structuredContent).toEqual({
        total: 1,
        uploaded: 0,
        failed: 1,
        failures: [
          {
            file: FILE,
            docName: "Test.Fixture.cls",
            error: droppedText("the Storage definition 'Default'"),
            code: "STORAGE_DROPPED",
            droppedStorage: ["Default"],
          },
        ],
      });
      expect(result.isError).toBe(true);
    });

    it("names several dropped definitions in the order the class has them", async () => {
      localFiles({ [FILE]: NO_STORAGE });
      serverHolds(DEFAULT_AND_SECOND);

      const result = await load();

      const failure = (result.structuredContent as { failures: Array<Record<string, unknown>> }).failures[0];
      expect(failure?.droppedStorage).toEqual(["Default", "Second"]);
      expect(failure?.error).toBe(droppedText("the Storage definitions 'Default', 'Second'"));
    });

    it("a renamed definition is a drop", async () => {
      const renamed = DEFAULT_ONLY.map((line) => (line === "Storage Default" ? "Storage Main" : line));
      localFiles({ [FILE]: renamed });
      serverHolds(DEFAULT_ONLY);

      const result = await load();

      expect(mockHttp.put.mock.calls).toEqual([]);
      expect((result.structuredContent as { failures: Array<Record<string, unknown>> }).failures[0]?.droppedStorage).toEqual([
        "Default",
      ]);
    });

    it("a mixed batch continues: the refused file is not stored and not compiled, the others are uploaded and compiled", async () => {
      localFiles({ [FILE]: NO_STORAGE, [OTHER_FILE]: OTHER_LINES });
      serverHolds(DEFAULT_ONLY);
      mockHttp.put.mockResolvedValue(envelope({ name: "Test.Other.cls", status: "" }));
      mockHttp.post.mockResolvedValue(envelope({ content: [{ name: "Test.Other.cls", status: "OK", errors: [] }] }));

      const result = await load({ compile: true });

      expect(mockHttp.put.mock.calls).toEqual([[`${OTHER_PUT_PATH}?ignoreConflict=1`, bodyOf(OTHER_LINES)]]);
      expect(mockHttp.post.mock.calls.map((call) => call[1])).toEqual([["Test.Other.cls"]]);
      expect(result.structuredContent).toMatchObject({ total: 2, uploaded: 1, failed: 1 });
      expect(result.isError).toBe(false);
    });

    it("keeps its storage under changed content: the PUT is the one of today and nothing is named dropped", async () => {
      const changed = DEFAULT_ONLY.map((line) =>
        line === "<Type>%Storage.Persistent</Type>" ? "<Type>%Storage.Persistent</Type><DataLocation>^X</DataLocation>" : line,
      );
      localFiles({ [FILE]: changed });
      serverHolds(DEFAULT_ONLY);
      mockHttp.put.mockResolvedValue(envelope({ name: "Test.Fixture.cls", status: "" }));

      const result = await load();

      expect(mockHttp.put.mock.calls).toEqual([[`${PUT_PATH}?ignoreConflict=1`, bodyOf(changed)]]);
      expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
    });
  });

  describe("ignoreConflict false: the 409 read", () => {
    it("refuses from the 409's document: the unversioned PUT, then no second PUT", async () => {
      localFiles({ [FILE]: NO_STORAGE });
      mockHttp.put.mockRejectedValueOnce(conflict(PUT_PATH, currentClass(DEFAULT_ONLY)));

      const result = await load({ ignoreConflict: false });

      expect(mockHttp.put.mock.calls).toEqual([[PUT_PATH, bodyOf(NO_STORAGE)]]);
      expect(mockHttp.get.mock.calls).toEqual([]);
      expect(result.structuredContent).toEqual({
        total: 1,
        uploaded: 0,
        failed: 1,
        failures: [
          {
            file: FILE,
            docName: "Test.Fixture.cls",
            error: droppedText("the Storage definition 'Default'"),
            code: "STORAGE_DROPPED",
            droppedStorage: ["Default"],
          },
        ],
      });
      expect(result.isError).toBe(true);
    });

    it("a file that keeps its storage is saved under the version check, as today", async () => {
      localFiles({ [FILE]: DEFAULT_ONLY });
      mockHttp.put
        .mockRejectedValueOnce(conflict(PUT_PATH, currentClass(DEFAULT_ONLY)))
        .mockResolvedValueOnce(envelope({ name: "Test.Fixture.cls", status: "" }));

      const result = await load({ ignoreConflict: false });

      expect(mockHttp.put.mock.calls).toEqual([
        [PUT_PATH, bodyOf(DEFAULT_ONLY)],
        [PUT_PATH, bodyOf(DEFAULT_ONLY), versionChecked],
      ]);
      expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
    });

    it("a new class takes the one PUT and is never read", async () => {
      localFiles({ [FILE]: NO_STORAGE });
      mockHttp.put.mockResolvedValue(envelope({ name: "Test.Fixture.cls", status: "" }));

      const result = await load({ ignoreConflict: false });

      expect(mockHttp.put.mock.calls).toEqual([[PUT_PATH, bodyOf(NO_STORAGE)]]);
      expect(mockHttp.get.mock.calls).toEqual([]);
      expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
    });
  });

  describe("allowStorageRegeneration: true", () => {
    it("default path: the GET and the ?ignoreConflict=1 PUT of today, uploaded, and storageDrops after failures and before compilationResult", async () => {
      localFiles({ [FILE]: NO_STORAGE, [OTHER_FILE]: OTHER_LINES });
      serverHolds(DEFAULT_ONLY);
      mockHttp.put.mockResolvedValue(envelope({ name: "ok", status: "" }));
      mockHttp.post.mockResolvedValue(envelope({ content: [] }));

      const result = await load({ allowStorageRegeneration: true, compile: true });

      expect(mockHttp.put.mock.calls).toEqual([
        [`${PUT_PATH}?ignoreConflict=1`, bodyOf(NO_STORAGE)],
        [`${OTHER_PUT_PATH}?ignoreConflict=1`, bodyOf(OTHER_LINES)],
      ]);
      expect(result.structuredContent).toMatchObject({
        total: 2,
        uploaded: 2,
        failed: 0,
        storageDrops: [{ name: "Test.Fixture.cls", droppedStorage: ["Default"] }],
      });
      expect(Object.keys(result.structuredContent as object)).toEqual([
        "total",
        "uploaded",
        "failed",
        "storageDrops",
        "compilationResult",
      ]);
      expect(result.isError).toBe(false);
    });

    it("the text names the dropped definitions", async () => {
      localFiles({ [FILE]: NO_STORAGE });
      serverHolds(DEFAULT_AND_SECOND);
      mockHttp.put.mockResolvedValue(envelope({ name: "ok", status: "" }));

      const result = await load({ allowStorageRegeneration: true });

      expect(result.content[0]?.text).toBe(
        "Loaded 1/1 document(s) into namespace 'USER'. " +
          "Storage definitions dropped (allowStorageRegeneration; IRIS generates new storage at the next compile): " +
          "Test.Fixture.cls ('Default', 'Second').",
      );
      expect(result.structuredContent).toEqual({
        total: 1,
        uploaded: 1,
        failed: 0,
        storageDrops: [{ name: "Test.Fixture.cls", droppedStorage: ["Default", "Second"] }],
      });
    });

    it("ignoreConflict false: the PUT sequence is the one used without the guard (409, then the version-checked PUT)", async () => {
      localFiles({ [FILE]: NO_STORAGE });
      mockHttp.put
        .mockRejectedValueOnce(conflict(PUT_PATH, currentClass(DEFAULT_ONLY)))
        .mockResolvedValueOnce(envelope({ name: "Test.Fixture.cls", status: "" }));

      const result = await load({ ignoreConflict: false, allowStorageRegeneration: true });

      expect(mockHttp.put.mock.calls).toEqual([
        [PUT_PATH, bodyOf(NO_STORAGE)],
        [PUT_PATH, bodyOf(NO_STORAGE), versionChecked],
      ]);
      expect(result.structuredContent).toEqual({
        total: 1,
        uploaded: 1,
        failed: 0,
        storageDrops: [{ name: "Test.Fixture.cls", droppedStorage: ["Default"] }],
      });
    });

    it("a save that then fails is a failure and names no drop", async () => {
      localFiles({ [FILE]: NO_STORAGE });
      serverHolds(DEFAULT_ONLY);
      mockHttp.put.mockRejectedValue(new IrisApiError(500, [], PUT_PATH, "IRIS returned HTTP 500."));

      const result = await load({ allowStorageRegeneration: true });

      expect(result.structuredContent).toEqual({
        total: 1,
        uploaded: 0,
        failed: 1,
        failures: [{ file: FILE, docName: "Test.Fixture.cls", error: "IRIS returned HTTP 500." }],
      });
    });

    it("with nothing dropped the result has no storageDrops", async () => {
      localFiles({ [FILE]: DEFAULT_ONLY });
      serverHolds(DEFAULT_ONLY);
      mockHttp.put.mockResolvedValue(envelope({ name: "ok", status: "" }));

      const result = await load({ allowStorageRegeneration: true });

      expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
      expect(result.content[0]?.text).toBe("Loaded 1/1 document(s) into namespace 'USER'.");
    });
  });

  describe("nothing dropped", () => {
    it("a new class (GET 404): one GET and the PUT of today, no storageDrops", async () => {
      localFiles({ [FILE]: DEFAULT_ONLY });
      mockHttp.get.mockImplementation(async (path: string) => {
        throw notFound(path);
      });
      mockHttp.put.mockResolvedValue(envelope({ name: "ok", status: "" }));

      const result = await load();

      expect(mockHttp.get.mock.calls).toEqual([[GET_PATH]]);
      expect(mockHttp.put.mock.calls).toEqual([[`${PUT_PATH}?ignoreConflict=1`, bodyOf(DEFAULT_ONLY)]]);
      expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
    });

    it("a .mac routine and a CSP page are never read: the PUT alone, as today", async () => {
      localFiles({ "c:/src/Test/Routine.mac": ["ROUTINE Test.Routine", " quit"], "c:/src/csp/page.csp": ["<html></html>"] });
      mockHttp.put.mockResolvedValue(envelope({ name: "ok", status: "" }));

      const result = await load();

      expect(mockHttp.get.mock.calls).toEqual([]);
      expect(mockHttp.put).toHaveBeenCalledTimes(2);
      expect(result.structuredContent).toEqual({ total: 2, uploaded: 2, failed: 0 });
    });

    it("an identity mismatch is refused before any read", async () => {
      localFiles({ [FILE]: ["Class Wrong.Name Extends %Persistent", "{", "}"] });

      const result = await load();

      expect(mockHttp.get.mock.calls).toEqual([]);
      expect(mockHttp.put.mock.calls).toEqual([]);
      expect(result.isError).toBe(true);
    });
  });

  describe("the read fails", () => {
    it("a GET that answers 500 fails that file with the error text and stores nothing; the other files continue", async () => {
      localFiles({ [FILE]: NO_STORAGE, [OTHER_FILE]: OTHER_LINES });
      mockHttp.get.mockImplementation(async (path: string) => {
        if (path === GET_PATH) throw new IrisApiError(500, [], path, "IRIS returned HTTP 500.");
        throw notFound(path);
      });
      mockHttp.put.mockResolvedValue(envelope({ name: "ok", status: "" }));

      const result = await load();

      expect(mockHttp.put.mock.calls).toEqual([[`${OTHER_PUT_PATH}?ignoreConflict=1`, bodyOf(OTHER_LINES)]]);
      expect(result.structuredContent).toEqual({
        total: 2,
        uploaded: 1,
        failed: 1,
        failures: [{ file: FILE, docName: "Test.Fixture.cls", error: "IRIS returned HTTP 500." }],
      });
    });

    it("an unreadable document (a soft error in the answer) fails the file with the unreadable text", async () => {
      localFiles({ [FILE]: NO_STORAGE });
      mockHttp.get.mockResolvedValue(envelope({ ...currentClass(DEFAULT_ONLY), status: "ERROR #5001: Not readable" }));

      const result = await load();

      expect(mockHttp.put.mock.calls).toEqual([]);
      expect(result.structuredContent).toEqual({
        total: 1,
        uploaded: 0,
        failed: 1,
        failures: [
          {
            file: FILE,
            docName: "Test.Fixture.cls",
            error:
              "Document 'Test.Fixture.cls' could not be read in namespace 'USER': ERROR #5001: Not readable. " +
              "Check the document name and namespace, then retry.",
          },
        ],
      });
    });

    it("a binary document fails the file and stores nothing", async () => {
      localFiles({ [FILE]: NO_STORAGE });
      mockHttp.get.mockResolvedValue(envelope({ ...currentClass(DEFAULT_ONLY), enc: true }));

      const result = await load();

      expect(mockHttp.put.mock.calls).toEqual([]);
      expect((result.structuredContent as { failures: Array<{ error: string }> }).failures[0]?.error).toContain(
        "could not be read in namespace 'USER'",
      );
      expect(result.isError).toBe(true);
    });
  });

  describe("the schema and the description", () => {
    it("allowStorageRegeneration follows ignoreConflict and carries the Design Notes text", () => {
      const shape = docLoadTool.inputSchema.shape as Record<string, { description?: string }>;
      const keys = Object.keys(shape);

      expect(keys.indexOf("allowStorageRegeneration")).toBe(keys.indexOf("ignoreConflict") + 1);
      expect(shape.allowStorageRegeneration?.description).toBe(
        "Boolean (true/false), default false. When false, a class file whose content drops one of the Storage definitions the class has now " +
          "is refused (a failures entry with code STORAGE_DROPPED; nothing is stored for that file, and the other files continue); " +
          "changing a Storage definition's content is allowed. When true, the file is uploaded, IRIS generates new storage at the next " +
          "compile (which can change how existing rows are read), and the result's storageDrops names the dropped definitions. " +
          "No effect on a new class or on other document types.",
      );
    });

    it("the description ends with the Design Notes sentence, and the parameter is optional with no default", () => {
      expect(docLoadTool.description.endsWith(
        " For an existing class, a file whose content drops one of the class's Storage definitions is refused and nothing is stored for that file " +
          "(a failures entry with code STORAGE_DROPPED; the other files continue), because IRIS would generate new storage at the next compile, " +
          "which can change how existing rows are read; allowStorageRegeneration (default false) lets it through, and the result names the dropped definitions.",
      )).toBe(true);
      expect(docLoadTool.inputSchema.safeParse({ path: "x" }).data).toEqual({ path: "x" });
      expect(docLoadTool.inputSchema.safeParse({ path: "x", allowStorageRegeneration: "true" }).data).toMatchObject({
        allowStorageRegeneration: true,
      });
    });
  });
});
