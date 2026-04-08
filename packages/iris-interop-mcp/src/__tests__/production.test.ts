import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  productionManageTool,
  productionControlTool,
  productionStatusTool,
  productionSummaryTool,
} from "../tools/production.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris.production.manage ────────────��────────────────────────

describe("iris.production.manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with create action and name in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "MyApp.Production" }),
    );

    const result = await productionManageTool.handler(
      { action: "create", name: "MyApp.Production" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production",
      expect.objectContaining({
        action: "create",
        name: "MyApp.Production",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("MyApp.Production");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST with delete action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "MyApp.Production" }),
    );

    const result = await productionManageTool.handler(
      { action: "delete", name: "MyApp.Production" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production",
      expect.objectContaining({
        action: "delete",
        name: "MyApp.Production",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("deleted");
  });

  it("should pass resolved namespace in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "Test.Prod" }),
    );

    await productionManageTool.handler(
      { action: "create", name: "Test.Prod", namespace: "MYNS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production",
      expect.objectContaining({ namespace: "MYNS" }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Invalid" }], "/api/executemcp/v2/interop/production", "Production error"),
    );

    const result = await productionManageTool.handler(
      { action: "create", name: "Bad.Prod" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing production");
    expect(result.content[0]?.text).toContain("Bad.Prod");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionManageTool.handler({ action: "create", name: "Test" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have destructiveHint: true annotation", () => {
    expect(productionManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionManageTool.scope).toBe("NS");
  });
});

// ── iris.production.control ────────────────────────────────────

describe("iris.production.control", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST for start with name in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "started", name: "MyApp.Production" }),
    );

    const result = await productionControlTool.handler(
      { action: "start", name: "MyApp.Production" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({
        action: "start",
        name: "MyApp.Production",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("started");
  });

  it("should send POST for stop action", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "stopped" }));

    await productionControlTool.handler({ action: "stop" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ action: "stop" }),
    );
  });

  it("should send POST for restart with name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "restarted", name: "MyApp.Production" }),
    );

    await productionControlTool.handler(
      { action: "restart", name: "MyApp.Production" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ action: "restart", name: "MyApp.Production" }),
    );
  });

  it("should send POST for update action", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "updated" }));

    await productionControlTool.handler({ action: "update" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ action: "update" }),
    );
  });

  it("should send POST for recover action", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "recovered" }));

    await productionControlTool.handler({ action: "recover" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ action: "recover" }),
    );
  });

  it("should include optional timeout and force when provided", async () => {
    mockHttp.post.mockResolvedValue(envelope({ action: "stopped" }));

    await productionControlTool.handler(
      { action: "stop", timeout: 60, force: true },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/control",
      expect.objectContaining({ timeout: 60, force: true }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(500, [{ error: "Failed" }], "/api/executemcp/v2/interop/production/control", "Control error"),
    );

    const result = await productionControlTool.handler(
      { action: "start", name: "Test" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error controlling production");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionControlTool.handler({ action: "start", name: "Test" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have destructiveHint: true annotation", () => {
    expect(productionControlTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionControlTool.scope).toBe("NS");
  });

  it("should reject start without name via Zod refinement", () => {
    const result = productionControlTool.inputSchema.safeParse({ action: "start" });
    expect(result.success).toBe(false);
  });

  it("should reject restart without name via Zod refinement", () => {
    const result = productionControlTool.inputSchema.safeParse({ action: "restart" });
    expect(result.success).toBe(false);
  });

  it("should accept stop without name via Zod refinement", () => {
    const result = productionControlTool.inputSchema.safeParse({ action: "stop" });
    expect(result.success).toBe(true);
  });

  it("should accept start with name via Zod refinement", () => {
    const result = productionControlTool.inputSchema.safeParse({
      action: "start",
      name: "MyApp.Production",
    });
    expect(result.success).toBe(true);
  });
});

// ─��� iris.production.status ─────────────────────────────────────

describe("iris.production.status", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send GET with namespace query param", async () => {
    const statusData = { name: "MyApp.Production", state: "Running", stateCode: 1 };
    mockHttp.get.mockResolvedValue(envelope(statusData));

    const result = await productionStatusTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/interop/production/status"),
    );

    const structured = result.structuredContent as typeof statusData;
    expect(structured.name).toBe("MyApp.Production");
    expect(structured.state).toBe("Running");
    expect(structured.stateCode).toBe(1);
    expect(result.isError).toBeUndefined();
  });

  it("should include detail=1 query param when detail is true", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ name: "Test.Prod", state: "Running", stateCode: 1, items: [] }),
    );

    await productionStatusTool.handler({ detail: true }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("detail=1");
  });

  it("should pass namespace query param from resolved namespace", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ name: "", state: "Stopped", stateCode: 2 }),
    );

    await productionStatusTool.handler({ namespace: "MYNS" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=MYNS");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/production/status", "Server error"),
    );

    const result = await productionStatusTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error getting production status");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionStatusTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(productionStatusTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionStatusTool.scope).toBe("NS");
  });
});

// ── iris.production.summary ────────────────────────────────────

describe("iris.production.summary", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send GET to summary endpoint with no namespace", async () => {
    const summaryData = [
      { namespace: "HSCUSTOM", name: "MyApp.Production", state: "Running", stateCode: 1 },
      { namespace: "USER", name: "Test.Production", state: "Stopped", stateCode: 2 },
    ];
    mockHttp.get.mockResolvedValue(envelope(summaryData));

    const result = await productionSummaryTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/summary",
    );

    const structured = result.structuredContent as {
      productions: typeof summaryData;
      count: number;
    };
    expect(structured.productions).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.productions[0]?.namespace).toBe("HSCUSTOM");
    expect(result.isError).toBeUndefined();
  });

  it("should handle empty production list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await productionSummaryTool.handler({}, ctx);

    const structured = result.structuredContent as {
      productions: unknown[];
      count: number;
    };
    expect(structured.productions).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("should use scope NONE (no namespace concept)", () => {
    expect(productionSummaryTool.scope).toBe("NONE");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/production/summary", "Server error"),
    );

    const result = await productionSummaryTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error getting production summary");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionSummaryTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(productionSummaryTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should accept cursor parameter in schema", () => {
    const shape = productionSummaryTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("cursor");
  });
});
