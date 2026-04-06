import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { namespaceManageTool, namespaceListTool } from "../tools/namespace.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris.namespace.manage ───────────────────────────────────────

describe("iris.namespace.manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with action and name in body for create", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "TESTNS" }),
    );

    const result = await namespaceManageTool.handler(
      {
        action: "create",
        name: "TESTNS",
        codeDatabase: "TESTCODE",
        dataDatabase: "TESTDATA",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/namespace",
      expect.objectContaining({
        action: "create",
        name: "TESTNS",
        codeDatabase: "TESTCODE",
        dataDatabase: "TESTDATA",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("TESTNS");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST for modify with only provided fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", name: "USER" }),
    );

    await namespaceManageTool.handler(
      { action: "modify", name: "USER", codeDatabase: "NEWCODE" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/namespace",
      expect.objectContaining({
        action: "modify",
        name: "USER",
        codeDatabase: "NEWCODE",
      }),
    );
  });

  it("should send POST for delete with only name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "OLDNS" }),
    );

    const result = await namespaceManageTool.handler(
      { action: "delete", name: "OLDNS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/namespace",
      expect.objectContaining({
        action: "delete",
        name: "OLDNS",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("deleted");
  });

  it("should include optional library and tempGlobals when provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "FULL" }),
    );

    await namespaceManageTool.handler(
      {
        action: "create",
        name: "FULL",
        codeDatabase: "CODE",
        dataDatabase: "DATA",
        library: "MYLIB",
        tempGlobals: "MYTEMP",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/namespace",
      expect.objectContaining({
        library: "MYLIB",
        tempGlobals: "MYTEMP",
      }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Invalid" }], "/api/executemcp/v2/config/namespace", "Invalid namespace"),
    );

    const result = await namespaceManageTool.handler(
      { action: "create", name: "BAD" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing namespace");
    expect(result.content[0]?.text).toContain("BAD");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      namespaceManageTool.handler({ action: "create", name: "TEST" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(namespaceManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(namespaceManageTool.scope).toBe("SYS");
  });
});

// ── iris.namespace.list ─────────────────────────────────────────

describe("iris.namespace.list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return list of namespaces with count", async () => {
    const nsData = [
      { name: "USER", globals: "USER", routines: "USER", library: "IRISLIB", tempGlobals: "IRISTEMP" },
      { name: "%SYS", globals: "IRISSYS", routines: "IRISSYS", library: "IRISLIB", tempGlobals: "IRISTEMP" },
    ];
    mockHttp.get.mockResolvedValue(envelope(nsData));

    const result = await namespaceListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/namespace",
    );

    const structured = result.structuredContent as {
      namespaces: typeof nsData;
      count: number;
    };
    expect(structured.namespaces).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.namespaces[0]?.name).toBe("USER");
    expect(result.isError).toBeUndefined();
  });

  it("should handle empty namespace list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await namespaceListTool.handler({}, ctx);

    const structured = result.structuredContent as {
      namespaces: unknown[];
      count: number;
    };
    expect(structured.namespaces).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/config/namespace", "Server error"),
    );

    const result = await namespaceListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing namespaces");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      namespaceListTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(namespaceListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(namespaceListTool.scope).toBe("SYS");
  });

  it("should accept cursor parameter in schema", () => {
    const shape = namespaceListTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("cursor");
  });
});
