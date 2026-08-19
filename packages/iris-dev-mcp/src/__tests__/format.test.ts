import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { docConvertTool, docXmlExportTool } from "../tools/format.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── iris_doc_convert ──────────────────────────────────────────────────

describe("iris_doc_convert", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should convert to XML by fetching with format=xml", async () => {
    const xmlContent = {
      name: "MyApp.Service.cls",
      content: ['<?xml version="1.0"?>', "<Export>", "</Export>"],
    };
    mockHttp.get.mockResolvedValue(envelope(xmlContent));

    const result = await docConvertTool.handler(
      { name: "MyApp.Service.cls", targetFormat: "xml" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/MyApp.Service.cls?format=xml",
    );
    expect(result.structuredContent).toEqual(xmlContent);
    expect(result.isError).toBeUndefined();
  });

  it("should convert to UDL by fetching with format=udl", async () => {
    const udlContent = {
      name: "MyApp.Service.cls",
      content: ["Class MyApp.Service {", "}"],
    };
    mockHttp.get.mockResolvedValue(envelope(udlContent));

    const result = await docConvertTool.handler(
      { name: "MyApp.Service.cls", targetFormat: "udl" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/MyApp.Service.cls?format=udl",
    );
    expect(result.structuredContent).toEqual(udlContent);
  });

  it("should use namespace override when provided", async () => {
    mockHttp.get.mockResolvedValue(envelope({ name: "Test.cls", content: [] }));

    await docConvertTool.handler(
      { name: "Test.cls", targetFormat: "xml", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/doc/Test.cls?format=xml",
    );
  });

  it("should propagate connection failures", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      docConvertTool.handler({ name: "Test.cls", targetFormat: "xml" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation (AC #9)", () => {
    expect(docConvertTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});

// ── iris_doc_xml_export ───────────────────────────────────────────────

describe("iris_doc_xml_export", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── export action ─────────────────────────────────────────────────

  describe("action=export", () => {
    it("should POST document names to action/xml/export", async () => {
      const exportResult = {
        content: ['<?xml version="1.0"?>', "<Export>", "</Export>"],
      };
      mockHttp.post.mockResolvedValue(envelope(exportResult));

      const result = await docXmlExportTool.handler(
        { action: "export", docs: ["MyApp.Service.cls", "MyApp.Utils.cls"] },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/atelier/v7/USER/action/xml/export",
        ["MyApp.Service.cls", "MyApp.Utils.cls"],
      );
      expect(result.structuredContent).toEqual(exportResult);
      expect(result.isError).toBeUndefined();
    });

    it("should return error when no docs provided for export", async () => {
      const result = await docXmlExportTool.handler(
        { action: "export" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("No documents specified");
    });

    it("should return error when docs is empty array for export", async () => {
      const result = await docXmlExportTool.handler(
        { action: "export", docs: [] },
        ctx,
      );

      expect(result.isError).toBe(true);
    });
  });

  // ── import action ─────────────────────────────────────────────────

  describe("action=import", () => {
    // Rule #36/#54 oracle: response shapes pinned from the LIVE Atelier
    // action/xml/load capture on IRIS 2026.1 (2026-08-18, Story 35.6 Task 1
    // probe): a successful load carries per-file status "" (NOT "OK" as the
    // pre-35.6 fixture claimed); a compile failure surfaces ONLY in the
    // per-file status text while HTTP stays 200 and status.errors stays empty.
    it("should POST XML content to action/xml/load", async () => {
      const importResult = {
        content: [
          { file: "import.xml", imported: ["MyApp.Service.cls"], status: "" },
        ],
      };
      mockHttp.post.mockResolvedValue(envelope(importResult));

      const xmlContent =
        '<?xml version="1.0"?>\n<Export>\n<Class name="MyApp.Service"></Class>\n</Export>';
      const result = await docXmlExportTool.handler(
        { action: "import", content: xmlContent },
        ctx,
      );

      // Rule #19 back-compat pin: compile omitted => the request URL is
      // byte-identical to the pre-35.6 behavior (NO flags query param) and the
      // structured content is the untouched API result.
      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/atelier/v7/USER/action/xml/load",
        [
          {
            file: "import.xml",
            content: [
              '<?xml version="1.0"?>',
              "<Export>",
              '<Class name="MyApp.Service"></Class>',
              "</Export>",
            ],
          },
        ],
      );
      expect(result.structuredContent).toEqual(importResult);
    });

    it("should return error when no content provided for import", async () => {
      const result = await docXmlExportTool.handler(
        { action: "import" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("No XML content");
    });

    // ── Story 35.6: compile parity (AC 35.6.1, 35.6.3) ────────────────

    it("compile omitted => NO flags query param + honest uncompiled note (AC 35.6.3)", async () => {
      const importResult = {
        content: [
          { file: "import.xml", imported: ["MyApp.Service.cls"], status: "" },
        ],
      };
      mockHttp.post.mockResolvedValue(envelope(importResult));

      const result = await docXmlExportTool.handler(
        { action: "import", content: "<Export></Export>" },
        ctx,
      );

      const calledPath = mockHttp.post.mock.calls[0]?.[0] as string;
      expect(calledPath).toBe("/api/atelier/v7/USER/action/xml/load");
      expect(calledPath).not.toContain("flags");
      // The AC-mandated additive note: states the docs are NOT compiled and
      // names the remedy. Structured content stays byte-identical.
      const texts = result.content.map((c) => c.text ?? "");
      expect(
        texts.some((t) => t.includes("NOT compiled")),
      ).toBe(true);
      expect(
        texts.some((t) => t.includes("compile: true") && t.includes("iris_doc_compile")),
      ).toBe(true);
      expect(result.structuredContent).toEqual(importResult);
    });

    it("compile:false behaves exactly like compile omitted (no flags param, note present)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ content: [] }));

      const result = await docXmlExportTool.handler(
        { action: "import", content: "<Export></Export>", compile: false },
        ctx,
      );

      const calledPath = mockHttp.post.mock.calls[0]?.[0] as string;
      expect(calledPath).toBe("/api/atelier/v7/USER/action/xml/load");
      const texts = result.content.map((c) => c.text ?? "");
      expect(texts.some((t) => t.includes("NOT compiled"))).toBe(true);
    });

    it("compile:false + flags => flags are IGNORED (no flags param sent)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ content: [] }));

      await docXmlExportTool.handler(
        { action: "import", content: "<Export></Export>", compile: false, flags: "cku" },
        ctx,
      );

      const calledPath = mockHttp.post.mock.calls[0]?.[0] as string;
      expect(calledPath).toBe("/api/atelier/v7/USER/action/xml/load");
    });

    it("compile:true with no flags => ?flags=c (the folded compile qualifier)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ content: [] }));

      const result = await docXmlExportTool.handler(
        { action: "import", content: "<Export></Export>", compile: true },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/atelier/v7/USER/action/xml/load?flags=c",
        expect.anything(),
      );
      // No uncompiled note when compile was requested
      const texts = result.content.map((c) => c.text ?? "");
      expect(texts.some((t) => t.includes("NOT compiled"))).toBe(false);
    });

    it("compile:true + flags lacking 'c' => 'c' folded in (folding rule, AC 35.6.2)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ content: [] }));

      await docXmlExportTool.handler(
        { action: "import", content: "<Export></Export>", compile: true, flags: "k" },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/atelier/v7/USER/action/xml/load?flags=ck",
        expect.anything(),
      );
    });

    it("compile:true + flags already containing 'c' => flags passed through unchanged", async () => {
      mockHttp.post.mockResolvedValue(envelope({ content: [] }));

      await docXmlExportTool.handler(
        { action: "import", content: "<Export></Export>", compile: true, flags: "cku" },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/atelier/v7/USER/action/xml/load?flags=cku",
        expect.anything(),
      );
    });

    // QA (Story 35.6) + code review: qualifier letters are CASE-INSENSITIVE
    // (live-pinned on IRIS 2026.1, 2026-08-18/19: 'C' alone compiles), so an
    // uppercase 'C' suppresses folding and passes through unchanged. This test
    // pins the SHIPPED rule so a future fold change shows up as a deliberate
    // wire change. (QA originally pinned 'C'->'cC' under the lowercase-only
    // fold; the review's negation finding reworked the fold to inspect the
    // last c/C occurrence — see foldCompileFlag's banner.)
    it("compile:true + flags 'C' (uppercase) => passed through unchanged (flags=C)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ content: [] }));

      await docXmlExportTool.handler(
        { action: "import", content: "<Export></Export>", compile: true, flags: "C" },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/atelier/v7/USER/action/xml/load?flags=C",
        expect.anything(),
      );
    });

    // Code review (Story 35.6, Edge finding): '-' NEGATES the immediately
    // following qualifier letter and the LAST c-occurrence wins — live-pinned
    // on IRIS 2026.1 (2026-08-19): 'c-c' does NOT compile, '-cc' DOES. A
    // negated final c would otherwise ship with compile:true and compile
    // NOTHING while suppressing the uncompiled note — the exact 35-SWEEP-8
    // defect class. The fold appends an overriding 'c'; every emitted string
    // below was live-proven to compile.
    it.each([
      ["-c", "-cc"],
      ["c-c", "c-cc"],
      ["-C", "-Cc"],
      ["k-c", "k-cc"],
    ])(
      "compile:true + flags %j (negated final c) => overriding c appended (flags=%j)",
      async (input, expected) => {
        mockHttp.post.mockResolvedValue(envelope({ content: [] }));

        await docXmlExportTool.handler(
          { action: "import", content: "<Export></Export>", compile: true, flags: input },
          ctx,
        );

        expect(mockHttp.post).toHaveBeenCalledWith(
          `/api/atelier/v7/USER/action/xml/load?flags=${expected}`,
          expect.anything(),
        );
      },
    );

    // QA (Story 35.6): the per-file status loop must be SELECTIVE across a
    // multi-entry response — surface only the entry whose status is non-empty
    // (shape pinned from the live multi-doc import, 2026-08-18).
    it("multi-entry response => only the non-empty per-file status is surfaced", async () => {
      const importResult = {
        content: [
          { file: "good.xml", imported: ["MyApp.Good.cls"], status: "" },
          {
            file: "bad.xml",
            imported: ["MyApp.Bad.cls"],
            status: "ERROR #5475: Error compiling routine: MyApp.Bad.1",
          },
        ],
      };
      mockHttp.post.mockResolvedValue(envelope(importResult));

      const result = await docXmlExportTool.handler(
        { action: "import", content: "<Export></Export>", compile: true },
        ctx,
      );

      const texts = result.content.map((c) => c.text ?? "");
      expect(
        texts.some(
          (t) => t.startsWith("Per-file status (bad.xml):") && t.includes("ERROR #5475"),
        ),
      ).toBe(true);
      expect(texts.some((t) => t.startsWith("Per-file status (good.xml):"))).toBe(false);
      expect(result.structuredContent).toEqual(importResult);
    });

    it("surfaces a non-empty per-file status (compile error) in the response text", async () => {
      // Shape pinned from the live broken-XML oracle (Story 35.6 Task 1):
      // HTTP 200, status.errors empty, compile error ONLY in per-file status.
      const importResult = {
        content: [
          {
            file: "import.xml",
            imported: ["ExecuteMCPv2.XmlProbe356Bad.cls"],
            status:
              "ERROR #5475: Error compiling routine: ExecuteMCPv2.XmlProbe356Bad.1.  Errors:  ERROR: ExecuteMCPv2.XmlProbe356Bad.cls(Probe+2) #1001: Missing closing quotation mark",
          },
        ],
      };
      mockHttp.post.mockResolvedValue(envelope(importResult));

      const result = await docXmlExportTool.handler(
        { action: "import", content: "<Export></Export>", compile: true },
        ctx,
      );

      const texts = result.content.map((c) => c.text ?? "");
      // Discriminating assertion: the JSON dump alone contains the status text,
      // so pin the dedicated note format (fails if the surfacing is dropped).
      expect(
        texts.some(
          (t) => t.startsWith("Per-file status (import.xml):") && t.includes("ERROR #5475"),
        ),
      ).toBe(true);
      // Structured content still carries the untouched API result
      expect(result.structuredContent).toEqual(importResult);
    });

    it("does NOT add a per-file status note when every status is empty", async () => {
      const importResult = {
        content: [
          { file: "import.xml", imported: ["MyApp.Service.cls"], status: "" },
        ],
      };
      mockHttp.post.mockResolvedValue(envelope(importResult));

      const result = await docXmlExportTool.handler(
        { action: "import", content: "<Export></Export>", compile: true },
        ctx,
      );

      const texts = result.content.map((c) => c.text ?? "");
      expect(texts.some((t) => t.includes("Per-file status"))).toBe(false);
    });
  });

  // ── list action ───────────────────────────────────────────────────

  describe("action=list", () => {
    it("should POST XML content to action/xml/list", async () => {
      // Rule #54 (QA, Story 35.6): sibling of the corrected import fixture —
      // live xml/list capture on IRIS 2026.1 (2026-08-18) returns per-file
      // status "" (NOT "OK") and ts as the NUMBER -1 for a document that does
      // not exist in the namespace (not an ISO string).
      const listResult = {
        content: [
          {
            file: "import.xml",
            documents: [{ name: "MyApp.Service.cls", ts: -1 }],
            status: "",
          },
        ],
      };
      mockHttp.post.mockResolvedValue(envelope(listResult));

      const xmlContent =
        '<?xml version="1.0"?>\n<Export>\n<Class name="MyApp.Service"></Class>\n</Export>';
      const result = await docXmlExportTool.handler(
        { action: "list", content: xmlContent },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/atelier/v7/USER/action/xml/list",
        [
          {
            file: "import.xml",
            content: [
              '<?xml version="1.0"?>',
              "<Export>",
              '<Class name="MyApp.Service"></Class>',
              "</Export>",
            ],
          },
        ],
      );
      expect(result.structuredContent).toEqual(listResult);
    });

    it("should return error when no content provided for list", async () => {
      const result = await docXmlExportTool.handler(
        { action: "list" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("No XML content");
    });
  });

  // ── version requirement ───────────────────────────────────────────

  it("should require Atelier API v7+", async () => {
    const v6Ctx = createMockCtx(mockHttp, 6);

    await expect(
      docXmlExportTool.handler({ action: "export", docs: ["Test.cls"] }, v6Ctx),
    ).rejects.toThrow(/v7/);
  });

  // ── namespace override ────────────────────────────────────────────

  it("should use namespace override when provided", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    await docXmlExportTool.handler(
      { action: "export", docs: ["Test.cls"], namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/action/xml/export",
      ["Test.cls"],
    );
  });

  // ── annotations ───────────────────────────────────────────────────

  it("should have destructiveHint: true annotation (AC #7, #8)", () => {
    expect(docXmlExportTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });
});
