/**
 * Story 42.11 (QA) - the rows of the Storage guard on `iris_doc_load` and the `iris_doc_xml_export` import that
 * `load-storage-guard.test.ts` and `format-storage-guard.test.ts` leave open:
 *
 *  - the `namespace` argument: the guard reads, writes and names the namespace the caller asked for, not the default
 *    (every other row runs in the default namespace, where a guard that read the default would still pass);
 *  - several dropping files or classes in one call: the drops are listed in file or XML order, and only the classes
 *    that drop are named (a kept class and a new class are not);
 *  - a refusal leaves nothing to compile: a call whose every file is refused sends no compile request;
 *  - the version-checked save of `ignoreConflict: false` that loses to a concurrent change under the override is a
 *    DOCUMENT_CONFLICT failure and names no drop (a drop is named only for a file that was stored);
 *  - the GET that reads the class and the PUT that saves it address the same document, for a name that needs escaping.
 *
 * The expected texts come from the story's Design Notes, never from the implementation (Rule #36). The fakes are the real
 * Atelier shapes of `conflict-fakes.ts`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { STORAGE_FIXTURES } from "@iris-mcp/shared/test-helpers/storage-guard-fixtures";
import type { ToolContext } from "@iris-mcp/shared";
import { docXmlExportTool } from "../tools/format.js";
import { docLoadTool } from "../tools/load.js";
import { conflict, currentClass, notFound, TS_CURRENT } from "./conflict-fakes.js";
import { createMockCtx, createMockHttp, envelope } from "./test-helpers.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  globSync: vi.fn(),
}));

import { globSync, readFileSync } from "node:fs";

const mockReadFileSync = readFileSync as unknown as ReturnType<typeof vi.fn>;
const mockGlobSync = globSync as unknown as ReturnType<typeof vi.fn>;

/** A scanner fixture's text for class `className`, found by the start of its id. */
function fixtureLines(idPrefix: string, className: string): string[] {
  const fixture = STORAGE_FIXTURES.find((candidate) => candidate.id.startsWith(idPrefix));
  if (fixture === undefined) throw new Error(`no scanner fixture starts with '${idPrefix}'`);
  return fixture.lines(className);
}

const withoutStorage = (className: string): string[] => fixtureLines("A:", className);
const withDefault = (className: string): string[] => fixtureLines("F:", className);

const WHY = "and IRIS would generate new storage at the next compile, which can change how existing rows are read.";
const LOAD_REMEDY =
  "Keep the Storage definitions in the file (read the class with iris_doc_get first), " +
  "or pass allowStorageRegeneration: true to let IRIS regenerate the storage.";
const IMPORT_REMEDY =
  "Keep each class's Storage elements in the XML (export the classes with iris_doc_xml_export first), " +
  "or pass allowStorageRegeneration: true to let IRIS regenerate the storage.";

const doc = (namespace: string, name: string): string => `/api/atelier/v7/${namespace}/doc/${name}`;
const bodyOf = (lines: string[]) => ({ enc: false, content: lines });

describe("Story 42.11 (QA): iris_doc_load and the import beyond the default namespace and a single document", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  /** The local files: each path holds the lines. */
  function localFiles(files: Record<string, string[]>): void {
    mockGlobSync.mockReturnValue(Object.keys(files));
    mockReadFileSync.mockImplementation((filePath: string) => (files[filePath] as string[]).join("\n"));
  }

  /** The server holds the documents in `held` (path to lines); every other path is a 404. */
  function serverHolds(held: Record<string, string[]>): void {
    mockHttp.get.mockImplementation(async (path: string) => {
      const lines = held[path];
      if (lines !== undefined) return envelope(currentClass(lines));
      throw notFound(path);
    });
  }

  beforeEach(() => {
    mockReadFileSync.mockReset();
    mockGlobSync.mockReset();
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  describe("iris_doc_load", () => {
    const load = (args: Record<string, unknown> = {}) => docLoadTool.handler({ path: "c:/src/**/*.cls", ...args }, ctx);

    it("reads the class in the namespace the caller named, and the refusal names that namespace", async () => {
      localFiles({ "c:/src/Test/Fixture.cls": withoutStorage("Test.Fixture") });
      serverHolds({ [doc("OTHER", "Test.Fixture.cls")]: withDefault("Test.Fixture") });

      const result = await load({ namespace: "OTHER" });

      expect(mockHttp.get.mock.calls).toEqual([[doc("OTHER", "Test.Fixture.cls")]]);
      expect(mockHttp.put.mock.calls).toEqual([]);
      expect(result.structuredContent).toEqual({
        total: 1,
        uploaded: 0,
        failed: 1,
        failures: [
          {
            file: "c:/src/Test/Fixture.cls",
            docName: "Test.Fixture.cls",
            error:
              "Document 'Test.Fixture.cls' was not saved in namespace 'OTHER': the content drops the Storage definition 'Default' " +
              `that the class has now, ${WHY} Nothing was stored. ${LOAD_REMEDY}`,
            code: "STORAGE_DROPPED",
            droppedStorage: ["Default"],
          },
        ],
      });
    });

    it("a class that exists only in the default namespace is new in the namespace the caller named: it is stored there", async () => {
      localFiles({ "c:/src/Test/Fixture.cls": withoutStorage("Test.Fixture") });
      serverHolds({ [doc("USER", "Test.Fixture.cls")]: withDefault("Test.Fixture") });
      mockHttp.put.mockResolvedValue(envelope({ name: "Test.Fixture.cls", status: "" }));

      const result = await load({ namespace: "OTHER" });

      expect(mockHttp.get.mock.calls).toEqual([[doc("OTHER", "Test.Fixture.cls")]]);
      expect(mockHttp.put.mock.calls).toEqual([[`${doc("OTHER", "Test.Fixture.cls")}?ignoreConflict=1`, bodyOf(withoutStorage("Test.Fixture"))]]);
      expect(result.structuredContent).toEqual({ total: 1, uploaded: 1, failed: 0 });
    });

    it("the override stores in the namespace the caller named, and the drop is named by the class's document name", async () => {
      localFiles({ "c:/src/Test/Fixture.cls": withoutStorage("Test.Fixture") });
      serverHolds({ [doc("OTHER", "Test.Fixture.cls")]: withDefault("Test.Fixture") });
      mockHttp.put.mockResolvedValue(envelope({ name: "Test.Fixture.cls", status: "" }));

      const result = await load({ namespace: "OTHER", allowStorageRegeneration: true });

      expect(mockHttp.put.mock.calls.map((call) => call[0])).toEqual([`${doc("OTHER", "Test.Fixture.cls")}?ignoreConflict=1`]);
      expect(result.structuredContent).toEqual({
        total: 1,
        uploaded: 1,
        failed: 0,
        storageDrops: [{ name: "Test.Fixture.cls", droppedStorage: ["Default"] }],
      });
    });

    it("several dropping files are named in file order, each with its own definitions, and each is stored", async () => {
      localFiles({
        "c:/src/Test/First.cls": withoutStorage("Test.First"),
        "c:/src/Test/Kept.cls": withDefault("Test.Kept"),
        "c:/src/Test/Second.cls": withoutStorage("Test.Second"),
      });
      serverHolds({
        [doc("USER", "Test.First.cls")]: withDefault("Test.First"),
        [doc("USER", "Test.Kept.cls")]: withDefault("Test.Kept"),
        [doc("USER", "Test.Second.cls")]: withDefault("Test.Second"),
      });
      mockHttp.put.mockResolvedValue(envelope({ status: "" }));

      const result = await load({ allowStorageRegeneration: true });

      expect(mockHttp.put).toHaveBeenCalledTimes(3);
      expect(result.structuredContent).toEqual({
        total: 3,
        uploaded: 3,
        failed: 0,
        storageDrops: [
          { name: "Test.First.cls", droppedStorage: ["Default"] },
          { name: "Test.Second.cls", droppedStorage: ["Default"] },
        ],
      });
      expect(result.content[0]?.text).toBe(
        "Loaded 3/3 document(s) into namespace 'USER'. " +
          "Storage definitions dropped (allowStorageRegeneration; IRIS generates new storage at the next compile): " +
          "Test.First.cls ('Default'); Test.Second.cls ('Default').",
      );
    });

    it("a call whose every file is refused sends no compile request, even with compile: true", async () => {
      localFiles({ "c:/src/Test/Fixture.cls": withoutStorage("Test.Fixture") });
      serverHolds({ [doc("USER", "Test.Fixture.cls")]: withDefault("Test.Fixture") });

      const result = await load({ compile: true });

      expect(mockHttp.post.mock.calls).toEqual([]);
      expect(mockHttp.put.mock.calls).toEqual([]);
      expect(result.structuredContent).not.toHaveProperty("compilationResult");
      expect(result.isError).toBe(true);
    });

    it("ignoreConflict false: a refused file does not stop the next file, which is a new class and takes the one PUT", async () => {
      localFiles({
        "c:/src/Test/First.cls": withoutStorage("Test.First"),
        "c:/src/Test/Second.cls": withoutStorage("Test.Second"),
      });
      mockHttp.put.mockImplementation(async (path: string) => {
        if (path === doc("USER", "Test.First.cls")) throw conflict(path, currentClass(withDefault("Test.First")));
        return envelope({ status: "" });
      });

      const result = await load({ ignoreConflict: false });

      expect(mockHttp.put.mock.calls.map((call) => call[0])).toEqual([doc("USER", "Test.First.cls"), doc("USER", "Test.Second.cls")]);
      expect(result.structuredContent).toMatchObject({
        total: 2,
        uploaded: 1,
        failed: 1,
        failures: [{ docName: "Test.First.cls", code: "STORAGE_DROPPED", droppedStorage: ["Default"] }],
      });
      expect(result.structuredContent).not.toHaveProperty("storageDrops");
    });

    it("ignoreConflict false with the override: a version-checked save that loses is DOCUMENT_CONFLICT and names no drop", async () => {
      localFiles({ "c:/src/Test/Fixture.cls": withoutStorage("Test.Fixture") });
      const path = doc("USER", "Test.Fixture.cls");
      mockHttp.put.mockRejectedValue(conflict(path, currentClass(withDefault("Test.Fixture"))));

      const result = await load({ ignoreConflict: false, allowStorageRegeneration: true });

      expect(mockHttp.put.mock.calls).toEqual([
        [path, bodyOf(withoutStorage("Test.Fixture"))],
        [path, bodyOf(withoutStorage("Test.Fixture")), { headers: { "If-None-Match": TS_CURRENT } }],
      ]);
      expect(result.structuredContent).toEqual({
        total: 1,
        uploaded: 0,
        failed: 1,
        failures: [
          {
            file: "c:/src/Test/Fixture.cls",
            docName: "Test.Fixture.cls",
            error:
              "The document changed on the server while this tool was saving it, so nothing was stored. " +
              "Run iris_doc_load again to replace the current version.",
            code: "DOCUMENT_CONFLICT",
          },
        ],
      });
    });

    it("a refused save under the override (IRIS answers a string status) names no drop either", async () => {
      localFiles({ "c:/src/Test/Fixture.cls": withoutStorage("Test.Fixture") });
      serverHolds({ [doc("USER", "Test.Fixture.cls")]: withDefault("Test.Fixture") });
      mockHttp.put.mockResolvedValue(envelope({ name: "Test.Fixture.cls", status: "ERROR #16021: Illegal Header Line" }));

      const result = await load({ allowStorageRegeneration: true });

      expect(result.structuredContent).toEqual({
        total: 1,
        uploaded: 0,
        failed: 1,
        failures: [
          {
            file: "c:/src/Test/Fixture.cls",
            docName: "Test.Fixture.cls",
            error: "IRIS refused the upload: ERROR #16021: Illegal Header Line",
          },
        ],
      });
    });

    it("the read and the save address the same document for a name that needs escaping", async () => {
      localFiles({ "c:/src/%Test/Fixture.cls": withoutStorage("%Test.Fixture") });
      serverHolds({ [doc("USER", "%25Test.Fixture.cls")]: withDefault("%Test.Fixture") });
      mockHttp.put.mockResolvedValue(envelope({ status: "" }));

      const result = await load({ allowStorageRegeneration: true });

      expect(mockHttp.get.mock.calls).toEqual([[doc("USER", "%25Test.Fixture.cls")]]);
      expect(mockHttp.put.mock.calls.map((call) => call[0])).toEqual([`${doc("USER", "%25Test.Fixture.cls")}?ignoreConflict=1`]);
      expect(result.structuredContent).toMatchObject({ uploaded: 1, storageDrops: [{ name: "%Test.Fixture.cls", droppedStorage: ["Default"] }] });
    });
  });

  describe("the XML import", () => {
    const classXml = (name: string, ...storage: string[]): string =>
      `<Class name="${name}"><Super>%Persistent</Super>${storage.map((definition) => `<Storage name="${definition}"><Type>%Storage.Persistent</Type></Storage>`).join("")}</Class>`;
    const exportOf = (...elements: string[]): string => `<?xml version="1.0" encoding="UTF-8"?>\n<Export generator="IRIS" version="26">\n${elements.join("\n")}\n</Export>`;
    const importXml = (content: string, extra: Record<string, unknown> = {}) => docXmlExportTool.handler({ action: "import", content, ...extra }, ctx);

    beforeEach(() => {
      mockHttp.post.mockResolvedValue(envelope({ content: [{ file: "import.xml", imported: ["Pkg.A.cls"], status: "" }] }));
    });

    it("reads each class in the namespace the caller named, and the refusal names that namespace in its text and its fields", async () => {
      serverHolds({ [doc("OTHER", "Pkg.A.cls")]: withDefault("Pkg.A") });

      const result = await importXml(exportOf(classXml("Pkg.A")), { namespace: "OTHER" });

      expect(mockHttp.get.mock.calls).toEqual([[doc("OTHER", "Pkg.A.cls")]]);
      expect(mockHttp.post.mock.calls).toEqual([]);
      expect(result.content[0]?.text).toBe(
        "The XML was not imported into namespace 'OTHER' and nothing was stored: it drops the Storage definition 'Default' of 'Pkg.A.cls' " +
          `that the class has now, ${WHY} ${IMPORT_REMEDY}`,
      );
      expect(result.structuredContent).toEqual({
        code: "STORAGE_DROPPED",
        namespace: "OTHER",
        storageDrops: [{ name: "Pkg.A.cls", droppedStorage: ["Default"] }],
      });
    });

    it("a class that exists only in the default namespace is new in the namespace the caller named: the import is posted there", async () => {
      serverHolds({ [doc("USER", "Pkg.A.cls")]: withDefault("Pkg.A") });

      const result = await importXml(exportOf(classXml("Pkg.A")), { namespace: "OTHER" });

      expect(mockHttp.post.mock.calls.map((call) => call[0])).toEqual(["/api/atelier/v7/OTHER/action/xml/load"]);
      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).not.toHaveProperty("storageDrops");
    });

    it("the override with a dropping class, a class that keeps its storage and a new class names only the dropping class", async () => {
      serverHolds({
        [doc("USER", "Pkg.Drops.cls")]: withDefault("Pkg.Drops"),
        [doc("USER", "Pkg.Keeps.cls")]: withDefault("Pkg.Keeps"),
      });

      const result = await importXml(exportOf(classXml("Pkg.Keeps", "Default"), classXml("Pkg.Drops"), classXml("Pkg.Fresh")), {
        allowStorageRegeneration: true,
      });

      expect(mockHttp.get.mock.calls.map((call) => call[0])).toEqual([
        doc("USER", "Pkg.Keeps.cls"),
        doc("USER", "Pkg.Drops.cls"),
        doc("USER", "Pkg.Fresh.cls"),
      ]);
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      expect((result.structuredContent as { storageDrops: unknown }).storageDrops).toEqual([{ name: "Pkg.Drops.cls", droppedStorage: ["Default"] }]);
      expect(result.content.at(-1)?.text).toBe(
        "Storage definitions dropped (allowStorageRegeneration; IRIS generates new storage at the next compile): Pkg.Drops.cls ('Default').",
      );
    });

    it("the refusal lists the classes in the order of the XML, whatever order the namespace holds them in", async () => {
      serverHolds({
        [doc("USER", "Pkg.Zed.cls")]: withDefault("Pkg.Zed"),
        [doc("USER", "Pkg.Alpha.cls")]: withDefault("Pkg.Alpha"),
      });

      const result = await importXml(exportOf(classXml("Pkg.Zed"), classXml("Pkg.Alpha")));

      expect((result.structuredContent as { storageDrops: unknown }).storageDrops).toEqual([
        { name: "Pkg.Zed.cls", droppedStorage: ["Default"] },
        { name: "Pkg.Alpha.cls", droppedStorage: ["Default"] },
      ]);
    });
  });
});
