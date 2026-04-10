import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { docIndexTool, docSearchTool, macroInfoTool } from "../tools/intelligence.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── iris_doc_index ────────────────────────────────────────────────

describe("iris_doc_index", () => {
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

// ── iris_doc_search ───────────────────────────────────────────────

describe("iris_doc_search", () => {
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
    expect(result.structuredContent).toEqual({ matches: searchResult });
  });

  it("should pass regex option as query parameter", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docSearchTool.handler(
      { query: "Set\\s+t\\w+", regex: true },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("regex=1");
  });

  it("should pass word, case, wild, and max options", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docSearchTool.handler(
      { query: "test", word: true, case: true, wild: false, max: 50 },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("word=1");
    expect(calledPath).toContain("case=1");
    expect(calledPath).toContain("wild=0");
    expect(calledPath).toContain("max=50");
  });

  it("should return empty matches when no results found (AC #4)", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await docSearchTool.handler(
      { query: "nonexistent_pattern_xyz" },
      ctx,
    );

    expect(result.structuredContent).toEqual({ matches: [] });
    expect(result.isError).toBeUndefined();
  });

  it("should return empty matches when result is null/undefined", async () => {
    mockHttp.get.mockResolvedValue(envelope(null));

    const result = await docSearchTool.handler(
      { query: "test" },
      ctx,
    );

    expect(result.structuredContent).toEqual({ matches: [] });
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

// ── iris_macro_info ───────────────────────────────────────────────

describe("iris_macro_info", () => {
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
