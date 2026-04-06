import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IrisHttpClient, ToolContext, IrisConnectionConfig, AtelierEnvelope } from "@iris-mcp/shared";
import { docConvertTool, docXmlExportTool } from "../tools/format.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createMockHttp() {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
    head: vi.fn(),
  } as unknown as IrisHttpClient & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    head: ReturnType<typeof vi.fn>;
  };
}

function createMockCtx(http: IrisHttpClient, atelierVersion = 7): ToolContext {
  return {
    resolveNamespace: (override?: string) => override ?? "USER",
    http,
    atelierVersion,
    config: {
      host: "localhost",
      port: 52773,
      username: "_SYSTEM",
      password: "SYS",
      namespace: "USER",
      https: false,
      baseUrl: "http://localhost:52773",
    } as IrisConnectionConfig,
  };
}

function envelope<T>(result: T, console: string[] = []): AtelierEnvelope<T> {
  return {
    status: { errors: [] },
    console,
    result,
  };
}

// ── iris.doc.convert ──────────────────────────────────────────────────

describe("iris.doc.convert", () => {
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

// ── iris.doc.xml_export ───────────────────────────────────────────────

describe("iris.doc.xml_export", () => {
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
    it("should POST XML content to action/xml/load", async () => {
      const importResult = {
        content: [
          { file: "import.xml", imported: ["MyApp.Service.cls"], status: "OK" },
        ],
      };
      mockHttp.post.mockResolvedValue(envelope(importResult));

      const xmlContent =
        '<?xml version="1.0"?>\n<Export>\n<Class name="MyApp.Service"></Class>\n</Export>';
      const result = await docXmlExportTool.handler(
        { action: "import", content: xmlContent },
        ctx,
      );

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
  });

  // ── list action ───────────────────────────────────────────────────

  describe("action=list", () => {
    it("should POST XML content to action/xml/list", async () => {
      const listResult = {
        content: [
          {
            file: "import.xml",
            documents: [
              { name: "MyApp.Service.cls", ts: "2026-04-05T12:00:00Z" },
            ],
            status: "OK",
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
