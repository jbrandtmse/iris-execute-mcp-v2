/**
 * Story 42.11 - the Storage-drop guard on the `iris_doc_xml_export` import.
 *
 * The matrix rows (refusal with zero POSTs, the override, nothing dropped, a failed read) with exact texts.
 * The expected texts come from the story's Design Notes, never from the implementation. The class text a GET
 * answers is the real nine-key document of `conflict-fakes.ts`; a class that does not exist is a 404.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { IrisApiError, type ToolContext } from "@iris-mcp/shared";
import { STORAGE_FIXTURES } from "@iris-mcp/shared/test-helpers/storage-guard-fixtures";
import { docXmlExportTool } from "../tools/format.js";
import { currentClass, notFound } from "./conflict-fakes.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

/** A scanner fixture's text for class `Test.Fixture`, found by the start of its id. */
function fixtureLines(idPrefix: string): string[] {
  const fixture = STORAGE_FIXTURES.find((candidate) => candidate.id.startsWith(idPrefix));
  if (fixture === undefined) throw new Error(`no scanner fixture starts with '${idPrefix}'`);
  return fixture.lines("Test.Fixture");
}

const DEFAULT_ONLY = fixtureLines("F:");
const DEFAULT_AND_SECOND = fixtureLines("B: ");

const LOAD_PATH = "/api/atelier/v7/USER/action/xml/load";
const doc = (name: string): string => `/api/atelier/v7/USER/doc/${name}`;

/** One `<Class>` element of an export, with the Storage definitions `storage` (each an empty element). */
function classXml(name: string, ...storage: string[]): string {
  const elements = storage.map((definition) => `<Storage name="${definition}"><Type>%Storage.Persistent</Type></Storage>`);
  return `<Class name="${name}"><Super>%Persistent</Super>${elements.join("")}</Class>`;
}

/** An export of the given class elements, as the text of an import. */
function exportOf(...elements: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Export generator="IRIS" version="26">\n${elements.join("\n")}\n</Export>`;
}

const IMPORT_REMEDY =
  "Keep each class's Storage elements in the XML (export the classes with iris_doc_xml_export first), " +
  "or pass allowStorageRegeneration: true to let IRIS regenerate the storage.";
const WHY = "and IRIS would generate new storage at the next compile, which can change how existing rows are read.";
const API_RESULT = { content: [{ file: "import.xml", imported: ["Pkg.A.cls"], status: "" }] };

describe("iris_doc_xml_export import: the Storage guard (Story 42.11)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  /** The server holds the classes in `held` (name to lines); every other document is new (404). */
  function serverHolds(held: Record<string, string[]>): void {
    mockHttp.get.mockImplementation(async (path: string) => {
      const name = Object.keys(held).find((candidate) => path === doc(candidate));
      if (name !== undefined) return envelope(currentClass(held[name] as string[]));
      throw notFound(path);
    });
  }

  function importXml(content: string, extra: Record<string, unknown> = {}) {
    return docXmlExportTool.handler({ action: "import", content, ...extra }, ctx);
  }

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
    mockHttp.post.mockResolvedValue(envelope(API_RESULT));
  });

  describe("a drop, without the override", () => {
    it("refuses before the POST: one GET for the class, no POST, and the refusal carries the text, the code, the namespace and storageDrops", async () => {
      serverHolds({ "Pkg.A.cls": DEFAULT_ONLY });

      const result = await importXml(exportOf(classXml("Pkg.A")));

      expect(mockHttp.get.mock.calls).toEqual([[doc("Pkg.A.cls")]]);
      expect(mockHttp.post.mock.calls).toEqual([]);
      expect(result).toEqual({
        content: [
          {
            type: "text",
            text:
              "The XML was not imported into namespace 'USER' and nothing was stored: it drops the Storage definition 'Default' of 'Pkg.A.cls' " +
              `that the class has now, ${WHY} ${IMPORT_REMEDY}`,
          },
        ],
        structuredContent: {
          code: "STORAGE_DROPPED",
          namespace: "USER",
          storageDrops: [{ name: "Pkg.A.cls", droppedStorage: ["Default"] }],
        },
        isError: true,
      });
      expect(Object.keys(result.structuredContent as object)).toEqual(["code", "namespace", "storageDrops"]);
    });

    it("names the drops of several classes, reads each class once, and loads none of them", async () => {
      serverHolds({ "Pkg.A.cls": DEFAULT_ONLY, "Pkg.B.cls": DEFAULT_AND_SECOND, "Pkg.Keep.cls": DEFAULT_ONLY });

      const result = await importXml(
        exportOf(classXml("Pkg.A"), classXml("Pkg.B", "Default"), classXml("Pkg.Keep", "Default"), classXml("Pkg.New"), classXml("Pkg.A")),
      );

      expect(mockHttp.get.mock.calls).toEqual([
        [doc("Pkg.A.cls")],
        [doc("Pkg.B.cls")],
        [doc("Pkg.Keep.cls")],
        [doc("Pkg.New.cls")],
      ]);
      expect(mockHttp.post.mock.calls).toEqual([]);
      expect(result.content[0]?.text).toBe(
        "The XML was not imported into namespace 'USER' and nothing was stored: it drops " +
          "the Storage definition 'Default' of 'Pkg.A.cls'; the Storage definition 'Second' of 'Pkg.B.cls' " +
          `that the classes have now, ${WHY} ${IMPORT_REMEDY}`,
      );
      expect((result.structuredContent as { storageDrops: unknown }).storageDrops).toEqual([
        { name: "Pkg.A.cls", droppedStorage: ["Default"] },
        { name: "Pkg.B.cls", droppedStorage: ["Second"] },
      ]);
    });

    it("a Storage element hidden in a comment or CDATA does not keep the definition", async () => {
      serverHolds({ "Pkg.A.cls": DEFAULT_ONLY });
      const hidden =
        '<Class name="Pkg.A"><!-- <Storage name="Default"></Storage> -->' +
        '<Method name="M"><Implementation><![CDATA[<Storage name="Default"></Storage>]]></Implementation></Method></Class>';

      const result = await importXml(exportOf(hidden));

      expect(mockHttp.post.mock.calls).toEqual([]);
      expect((result.structuredContent as { storageDrops: unknown }).storageDrops).toEqual([
        { name: "Pkg.A.cls", droppedStorage: ["Default"] },
      ]);
    });

    it("compile: true is refused the same way, with no POST", async () => {
      serverHolds({ "Pkg.A.cls": DEFAULT_ONLY });

      const result = await importXml(exportOf(classXml("Pkg.A")), { compile: true });

      expect(result.isError).toBe(true);
      expect(mockHttp.post.mock.calls).toEqual([]);
    });
  });

  describe("allowStorageRegeneration: true", () => {
    it("posts as today, and the result is the API result plus storageDrops, with a text block that names the drops", async () => {
      serverHolds({ "Pkg.A.cls": DEFAULT_ONLY });
      const xml = exportOf(classXml("Pkg.A"));

      const result = await importXml(xml, { allowStorageRegeneration: true });

      expect(mockHttp.post.mock.calls).toEqual([
        [LOAD_PATH, [{ file: "import.xml", content: xml.split("\n") }]],
      ]);
      expect(result.structuredContent).toEqual({ ...API_RESULT, storageDrops: [{ name: "Pkg.A.cls", droppedStorage: ["Default"] }] });
      expect(Object.keys(result.structuredContent as object)).toEqual(["content", "storageDrops"]);
      expect(result.isError).toBeUndefined();
      expect(result.content.map((block) => block.text)).toEqual([
        JSON.stringify(API_RESULT, null, 2),
        expect.stringContaining("NOT compiled"),
        "Storage definitions dropped (allowStorageRegeneration; IRIS generates new storage at the next compile): Pkg.A.cls ('Default').",
      ]);
    });

    it("with compile: true the load carries the compile flags and the drops are still named", async () => {
      serverHolds({ "Pkg.A.cls": DEFAULT_ONLY });

      const result = await importXml(exportOf(classXml("Pkg.A")), { allowStorageRegeneration: true, compile: true });

      expect(mockHttp.post.mock.calls.map((call) => call[0])).toEqual([`${LOAD_PATH}?flags=c`]);
      expect((result.structuredContent as { storageDrops: unknown }).storageDrops).toEqual([
        { name: "Pkg.A.cls", droppedStorage: ["Default"] },
      ]);
    });

    it("with nothing to drop the structuredContent is the untouched API result", async () => {
      serverHolds({ "Pkg.A.cls": DEFAULT_ONLY });

      const result = await importXml(exportOf(classXml("Pkg.A", "Default")), { allowStorageRegeneration: true });

      expect(result.structuredContent).toBe(API_RESULT);
    });
  });

  describe("nothing dropped: the request and the result are those of today", () => {
    it("XML with no <Class> is posted with no read", async () => {
      const xml = '<?xml version="1.0"?>\n<Export><Routine name="R" type="MAC"><![CDATA[ quit ]]></Routine></Export>';

      const result = await importXml(xml);

      expect(mockHttp.get.mock.calls).toEqual([]);
      expect(mockHttp.post.mock.calls).toEqual([[LOAD_PATH, [{ file: "import.xml", content: xml.split("\n") }]]]);
      expect(result.structuredContent).toBe(API_RESULT);
    });

    it("only new classes (each GET is a 404): one POST and the untouched result", async () => {
      serverHolds({});

      const result = await importXml(exportOf(classXml("Pkg.A", "Default"), classXml("Pkg.B")));

      expect(mockHttp.get.mock.calls).toEqual([[doc("Pkg.A.cls")], [doc("Pkg.B.cls")]]);
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      expect(result.structuredContent).toBe(API_RESULT);
      expect(result.isError).toBeUndefined();
    });

    it("every name kept, changed content and an added definition: one POST and the untouched result", async () => {
      serverHolds({ "Pkg.A.cls": DEFAULT_ONLY });

      const result = await importXml(exportOf(classXml("Pkg.A", "Default", "Extra")));

      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      expect(result.structuredContent).toBe(API_RESULT);
    });

    it("a CRLF import is read and posted as the same lines as before", async () => {
      serverHolds({ "Pkg.A.cls": DEFAULT_ONLY });
      const xml = exportOf(classXml("Pkg.A", "Default")).replace(/\n/g, "\r\n");

      await importXml(xml);

      expect(mockHttp.post.mock.calls[0]?.[1]).toEqual([{ file: "import.xml", content: xml.split(/\r?\n/) }]);
    });

    it("export and list never read a class", async () => {
      mockHttp.post.mockResolvedValue(envelope({ content: [] }));

      await docXmlExportTool.handler({ action: "export", docs: ["Pkg.A.cls"] }, ctx);
      await docXmlExportTool.handler({ action: "list", content: exportOf(classXml("Pkg.A")) }, ctx);

      expect(mockHttp.get.mock.calls).toEqual([]);
    });
  });

  describe("a read that fails", () => {
    it("a 500 on the GET throws and posts nothing", async () => {
      mockHttp.get.mockRejectedValue(new IrisApiError(500, [], doc("Pkg.A.cls"), "IRIS returned HTTP 500."));

      await expect(importXml(exportOf(classXml("Pkg.A")))).rejects.toThrow("IRIS returned HTTP 500.");
      expect(mockHttp.post.mock.calls).toEqual([]);
    });

    it("an unreadable class throws with the unreadable text and posts nothing", async () => {
      mockHttp.get.mockResolvedValue(envelope({ ...currentClass(DEFAULT_ONLY), status: "ERROR #5001: Not readable" }));

      await expect(importXml(exportOf(classXml("Pkg.A")))).rejects.toThrow(
        "Document 'Pkg.A.cls' could not be read in namespace 'USER': ERROR #5001: Not readable. Check the document name and namespace, then retry.",
      );
      expect(mockHttp.post.mock.calls).toEqual([]);
    });
  });

  describe("the schema and the description", () => {
    it("allowStorageRegeneration follows namespace and carries the Design Notes text", () => {
      const shape = docXmlExportTool.inputSchema.shape as Record<string, { description?: string }>;
      const keys = Object.keys(shape);

      expect(keys.indexOf("allowStorageRegeneration")).toBe(keys.indexOf("namespace") + 1);
      expect(shape.allowStorageRegeneration?.description).toBe(
        'For action "import" only. Boolean (true/false), default false. When false, an import is refused (STORAGE_DROPPED, nothing loaded) ' +
          "if the XML of a class lacks one of the Storage definitions that class has now; changing a definition's content is allowed. " +
          "When true, the import goes ahead, IRIS generates new storage at the next compile (which can change how existing rows are read), " +
          "and the result's storageDrops names the dropped definitions. No effect on a new class or on other document types.",
      );
    });

    it("the description ends with the Design Notes sentence, and the parameter is optional with no default", () => {
      expect(
        docXmlExportTool.description.endsWith(
          " An import that would drop one of the Storage definitions a class has now (its XML lacks that definition) is refused with " +
            "STORAGE_DROPPED and nothing is loaded, because IRIS would generate new storage at the next compile, which can change how " +
            "existing rows are read; allowStorageRegeneration (default false) lets it through, and the result names the dropped definitions.",
        ),
      ).toBe(true);
      expect(docXmlExportTool.inputSchema.safeParse({ action: "import", content: "x" }).data).toEqual({
        action: "import",
        content: "x",
      });
    });
  });
});
