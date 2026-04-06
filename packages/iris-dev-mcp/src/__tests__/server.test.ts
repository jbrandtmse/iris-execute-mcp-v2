import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { serverInfoTool, serverNamespaceTool } from "../tools/server.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── iris.server.info ──────────────────────────────────────────────

describe("iris.server.info", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return version, platform, and instance name from server info", async () => {
    const serverInfo = {
      version: "8.0.0",
      id: "IRIS for UNIX (Ubuntu Server LTS for x86-64) 2024.1",
      platform: "UNIX (Ubuntu Server LTS for x86-64)",
      instanceName: "IRIS",
      features: [],
      namespaces: ["USER", "%SYS", "HSLIB"],
    };
    mockHttp.get.mockResolvedValue(envelope(serverInfo));

    const result = await serverInfoTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith("/api/atelier/");
    expect(result.structuredContent).toEqual(serverInfo);
    expect(result.isError).toBeUndefined();
  });

  it("should have scope NONE", () => {
    expect(serverInfoTool.scope).toBe("NONE");
  });

  it("should have correct annotations (readOnlyHint: true, idempotentHint: true)", () => {
    expect(serverInfoTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should propagate connection errors", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      serverInfoTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should not require any parameters", () => {
    // inputSchema should be an empty object schema
    const shape = serverInfoTool.inputSchema.shape;
    expect(Object.keys(shape)).toHaveLength(0);
  });
});

// ── iris.server.namespace ─────────────────────────────────────────

describe("iris.server.namespace", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return namespace details including databases and features", async () => {
    const nsInfo = {
      name: "USER",
      databases: {
        default: "USER",
        routine: "IRISSYS",
      },
      features: ["SQL", "Objects", "WebServices"],
      enabled: true,
    };
    mockHttp.get.mockResolvedValue(envelope(nsInfo));

    const result = await serverNamespaceTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith("/api/atelier/v7/USER");
    expect(result.structuredContent).toEqual(nsInfo);
    expect(result.isError).toBeUndefined();
  });

  it("should accept namespace override", async () => {
    const nsInfo = { name: "HSCUSTOM", databases: {}, features: [] };
    mockHttp.get.mockResolvedValue(envelope(nsInfo));

    const result = await serverNamespaceTool.handler(
      { namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith("/api/atelier/v7/HSCUSTOM");
    expect(result.structuredContent).toEqual(nsInfo);
  });

  it("should have scope NS", () => {
    expect(serverNamespaceTool.scope).toBe("NS");
  });

  it("should have correct annotations (readOnlyHint: true, idempotentHint: true)", () => {
    expect(serverNamespaceTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should propagate connection errors", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      serverNamespaceTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });
});
