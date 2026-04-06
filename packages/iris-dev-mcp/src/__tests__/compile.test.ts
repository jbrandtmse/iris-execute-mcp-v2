import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IrisHttpClient, ToolContext, IrisConnectionConfig, AtelierEnvelope } from "@iris-mcp/shared";
import { docCompileTool } from "../tools/compile.js";

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

function createMockCtx(http: IrisHttpClient): ToolContext {
  return {
    resolveNamespace: (override?: string) => override ?? "USER",
    http,
    atelierVersion: 7,
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

// ── iris.doc.compile ───────────────────────────────────────────────

describe("iris.doc.compile", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should compile a single document successfully and return success status", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ name: "MyApp.Service.cls", status: "OK", errors: [] }] }, ["Compilation started..."]),
    );

    const result = await docCompileTool.handler(
      { doc: "MyApp.Service.cls" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/compile",
      ["MyApp.Service.cls"],
    );
    expect(result.structuredContent).toMatchObject({
      success: true,
      documents: ["MyApp.Service.cls"],
    });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain("Successfully compiled");
  });

  it("should pass compilation flags to endpoint as query parameter", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ name: "Test.cls", status: "OK", errors: [] }] }),
    );

    await docCompileTool.handler(
      { doc: "Test.cls", flags: "cku" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/compile?flags=cku",
      ["Test.cls"],
    );
  });

  it("should compile multiple documents in a single request", async () => {
    const docs = ["One.cls", "Two.cls", "Three.cls"];
    mockHttp.post.mockResolvedValue(
      envelope({
        content: docs.map((d) => ({ name: d, status: "OK", errors: [] })),
      }),
    );

    const result = await docCompileTool.handler({ doc: docs }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/compile",
      docs,
    );
    expect(result.structuredContent).toMatchObject({
      success: true,
      documents: docs,
    });
  });

  it("should return compilation errors with line/char positions and isError: false", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        content: [
          {
            name: "Bad.cls",
            status: "ERROR",
            errors: [
              { error: "ERROR #5540: Expected '}' but found EOF", line: 15, char: 1 },
              { error: "ERROR #5541: Missing semicolon", line: 20, char: 5 },
            ],
          },
        ],
      }),
    );

    const result = await docCompileTool.handler(
      { doc: "Bad.cls" },
      ctx,
    );

    // Per AC #4: compilation errors use isError: false
    expect(result.isError).toBe(false);

    const structured = result.structuredContent as {
      success: boolean;
      errors: Array<{ document: string; error: string; line?: number; char?: number }>;
    };
    expect(structured.success).toBe(false);
    expect(structured.errors).toHaveLength(2);
    expect(structured.errors[0]).toEqual({
      document: "Bad.cls",
      error: "ERROR #5540: Expected '}' but found EOF",
      line: 15,
      char: 1,
    });
    expect(structured.errors[1]).toEqual({
      document: "Bad.cls",
      error: "ERROR #5541: Missing semicolon",
      line: 20,
      char: 5,
    });
    expect(result.content[0]?.text).toContain("Compilation failed");
  });

  it("should return job ID when async mode is enabled", async () => {
    const asyncResult = { trackingId: "job-12345" };
    mockHttp.post.mockResolvedValue(
      envelope(asyncResult, ["Async compilation queued"]),
    );

    const result = await docCompileTool.handler(
      { doc: ["Large.pkg.cls"], async: true },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/compile?async=1",
      ["Large.pkg.cls"],
    );
    const structured = result.structuredContent as { mode: string; response: unknown };
    expect(structured.mode).toBe("async");
    expect(structured.response).toEqual(asyncResult);
  });

  it("should propagate connection failures as thrown errors", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      docCompileTool.handler({ doc: "Test.cls" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should use namespace override when provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ name: "Test.cls", status: "OK", errors: [] }] }),
    );

    await docCompileTool.handler(
      { doc: "Test.cls", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/action/compile",
      ["Test.cls"],
    );
  });

  it("should include compilationTime in result", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ name: "Test.cls", status: "OK", errors: [] }] }),
    );

    const result = await docCompileTool.handler(
      { doc: "Test.cls" },
      ctx,
    );

    const structured = result.structuredContent as { compilationTime: string };
    expect(structured.compilationTime).toMatch(/^\d+ms$/);
  });

  it("should pass both flags and async as query parameters", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ trackingId: "job-99" }),
    );

    await docCompileTool.handler(
      { doc: "Test.cls", flags: "ck", async: true },
      ctx,
    );

    const calledPath = mockHttp.post.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("flags=ck");
    expect(calledPath).toContain("async=1");
  });

  it("should have correct tool annotations", () => {
    expect(docCompileTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should return early with a message when doc is an empty array", async () => {
    const result = await docCompileTool.handler({ doc: [] }, ctx);

    expect(mockHttp.post).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toBe("No documents specified for compilation.");
    expect(result.isError).toBe(false);
  });

  it("should include console output when present in sync mode", async () => {
    mockHttp.post.mockResolvedValue(
      envelope(
        { content: [{ name: "Test.cls", status: "OK", errors: [] }] },
        ["Compilation started on Test.cls", "Compilation successful"],
      ),
    );

    const result = await docCompileTool.handler(
      { doc: "Test.cls" },
      ctx,
    );

    const structured = result.structuredContent as { console: string[] };
    expect(structured.console).toEqual([
      "Compilation started on Test.cls",
      "Compilation successful",
    ]);
  });
});
