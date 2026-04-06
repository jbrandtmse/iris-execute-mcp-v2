import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IrisHttpClient, ToolContext, IrisConnectionConfig, AtelierEnvelope } from "@iris-mcp/shared";
import { docIndexTool, docSearchTool, macroInfoTool } from "../tools/intelligence.js";

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

// ── iris.doc.index ────────────────────────────────────────────────

describe("iris.doc.index", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return class structure with methods, properties, and parameters", async () => {
    const indexResult = {
      content: [
        {
          name: "MyApp.Service.cls",
          content: [
            { name: "Name", member: "Property", type: "%String" },
            { name: "DoWork", member: "Method", args: "(pInput:%String)" },
            { name: "TIMEOUT", member: "Parameter", default: "30" },
          ],
          super: ["%RegisteredObject"],
        },
      ],
    };
    mockHttp.post.mockResolvedValue(envelope(indexResult));

    const result = await docIndexTool.handler(
      { name: "MyApp.Service.cls" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/index",
      ["MyApp.Service.cls"],
    );
    expect(result.structuredContent).toEqual(indexResult);
    expect(result.content[0]?.text).toContain("MyApp.Service.cls");
  });

  it("should return appropriate response for non-class documents", async () => {
    const indexResult = {
      content: [
        {
          name: "MyApp.Routine.mac",
          content: [],
        },
      ],
    };
    mockHttp.post.mockResolvedValue(envelope(indexResult));

    const result = await docIndexTool.handler(
      { name: "MyApp.Routine.mac" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/index",
      ["MyApp.Routine.mac"],
    );
    expect(result.structuredContent).toEqual(indexResult);
  });

  it("should use namespace override when provided", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    await docIndexTool.handler(
      { name: "Test.cls", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/action/index",
      ["Test.cls"],
    );
  });

  it("should propagate connection failures", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      docIndexTool.handler({ name: "Test.cls" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(docIndexTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});

// ── iris.doc.search ───────────────────────────────────────────────

describe("iris.doc.search", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should search with text query and return matches", async () => {
    const searchResult = [
      { doc: "MyApp.Service.cls", line: 10, text: "Set tResult = $$$OK" },
      { doc: "MyApp.Utils.cls", line: 5, text: "Quit $$$OK" },
    ];
    mockHttp.get.mockResolvedValue(envelope(searchResult));

    const result = await docSearchTool.handler(
      { query: "$$$OK" },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("/api/atelier/v7/USER/action/search");
    expect(calledPath).toContain("query=%24%24%24OK");
    expect(result.structuredContent).toEqual(searchResult);
  });

  it("should pass regex option as query parameter", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docSearchTool.handler(
      { query: "Set\\s+t\\w+", regex: true },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("regex=true");
  });

  it("should pass word, case, wild, and max options", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docSearchTool.handler(
      { query: "test", word: true, case: true, wild: false, max: 50 },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("word=true");
    expect(calledPath).toContain("case=true");
    expect(calledPath).toContain("wild=false");
    expect(calledPath).toContain("max=50");
  });

  it("should return empty array when no results found (AC #4)", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await docSearchTool.handler(
      { query: "nonexistent_pattern_xyz" },
      ctx,
    );

    expect(result.structuredContent).toEqual([]);
    expect(result.isError).toBeUndefined();
  });

  it("should return empty array when result is null/undefined", async () => {
    mockHttp.get.mockResolvedValue(envelope(null));

    const result = await docSearchTool.handler(
      { query: "test" },
      ctx,
    );

    expect(result.structuredContent).toEqual([]);
  });

  it("should use namespace override when provided", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docSearchTool.handler(
      { query: "test", namespace: "HSCUSTOM" },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("/api/atelier/v7/HSCUSTOM/action/search");
  });

  it("should require Atelier API v2+", async () => {
    const v1Ctx = createMockCtx(mockHttp, 1);

    await expect(
      docSearchTool.handler({ query: "test" }, v1Ctx),
    ).rejects.toThrow(/v2/);
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(docSearchTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});

// ── iris.macro.info ───────────────────────────────────────────────

describe("iris.macro.info", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return definition and source location", async () => {
    const definitionResult = {
      definition: "$select($get(sc)=1:1,1:0)",
    };
    const locationResult = {
      document: "%occStatus.inc",
      line: 42,
    };
    mockHttp.post
      .mockResolvedValueOnce(envelope(definitionResult))
      .mockResolvedValueOnce(envelope(locationResult));

    const result = await macroInfoTool.handler(
      { name: "ISERR", document: "MyApp.Service.cls", includes: ["%occStatus"] },
      ctx,
    );

    // Should call both getmacrodefinition and getmacrolocation
    expect(mockHttp.post).toHaveBeenCalledTimes(2);
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/getmacrodefinition",
      { docname: "MyApp.Service.cls", macroname: "ISERR", includes: ["%occStatus"] },
    );
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/getmacrolocation",
      { docname: "MyApp.Service.cls", macroname: "ISERR", includes: ["%occStatus"] },
    );

    const structured = result.structuredContent as {
      name: string;
      definition: unknown;
      location: unknown;
    };
    expect(structured.name).toBe("ISERR");
    expect(structured.definition).toEqual(definitionResult);
    expect(structured.location).toEqual(locationResult);
  });

  it("should use empty defaults when document and includes not provided", async () => {
    mockHttp.post
      .mockResolvedValueOnce(envelope({ definition: "1" }))
      .mockResolvedValueOnce(envelope({ document: "%occStatus.inc", line: 1 }));

    await macroInfoTool.handler(
      { name: "OK" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/getmacrodefinition",
      { docname: "", macroname: "OK", includes: [] },
    );
  });

  it("should require Atelier API v2+", async () => {
    const v1Ctx = createMockCtx(mockHttp, 1);

    await expect(
      macroInfoTool.handler({ name: "OK" }, v1Ctx),
    ).rejects.toThrow(/v2/);
  });

  it("should use namespace override when provided", async () => {
    mockHttp.post
      .mockResolvedValueOnce(envelope({ definition: "1" }))
      .mockResolvedValueOnce(envelope({ document: "test.inc", line: 1 }));

    await macroInfoTool.handler(
      { name: "OK", namespace: "HSCUSTOM" },
      ctx,
    );

    const calledPath = mockHttp.post.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("/api/atelier/v7/HSCUSTOM/action/getmacrodefinition");
  });

  it("should propagate connection failures", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      macroInfoTool.handler({ name: "OK" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(macroInfoTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});

// ── Cross-cutting: all tools readOnlyHint ─────────────────────────

describe("intelligence tools annotations", () => {
  it("all three tools should have readOnlyHint: true", () => {
    for (const tool of [docIndexTool, docSearchTool, macroInfoTool]) {
      expect(tool.annotations.readOnlyHint).toBe(true);
    }
  });
});
