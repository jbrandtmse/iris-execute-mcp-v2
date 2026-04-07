import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  productionItemTool,
  productionAutostartTool,
} from "../tools/item.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris.production.item ──────────────────────────────────────

describe("iris.production.item", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── enable ──

  it("should send POST with enable action and itemName", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "enabled", itemName: "MyApp.Service.FileIn" }),
    );

    const result = await productionItemTool.handler(
      { action: "enable", itemName: "MyApp.Service.FileIn" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/item",
      expect.objectContaining({
        action: "enable",
        itemName: "MyApp.Service.FileIn",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; itemName: string };
    expect(structured.action).toBe("enabled");
    expect(structured.itemName).toBe("MyApp.Service.FileIn");
    expect(result.isError).toBeUndefined();
  });

  // ── disable ──

  it("should send POST with disable action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "disabled", itemName: "MyApp.Service.FileIn" }),
    );

    const result = await productionItemTool.handler(
      { action: "disable", itemName: "MyApp.Service.FileIn" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/item",
      expect.objectContaining({
        action: "disable",
        itemName: "MyApp.Service.FileIn",
      }),
    );

    const structured = result.structuredContent as { action: string; itemName: string };
    expect(structured.action).toBe("disabled");
  });

  // ── get ──

  it("should send POST with get action and return item details", async () => {
    const itemData = {
      action: "get",
      itemName: "MyApp.Service.FileIn",
      className: "MyApp.Service.FileIn",
      enabled: true,
      businessType: 1,
      adapter: "EnsLib.File.InboundAdapter",
      poolSize: 1,
    };
    mockHttp.post.mockResolvedValue(envelope(itemData));

    const result = await productionItemTool.handler(
      { action: "get", itemName: "MyApp.Service.FileIn" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/item",
      expect.objectContaining({
        action: "get",
        itemName: "MyApp.Service.FileIn",
      }),
    );

    const structured = result.structuredContent as typeof itemData;
    expect(structured.action).toBe("get");
    expect(structured.className).toBe("MyApp.Service.FileIn");
    expect(structured.enabled).toBe(true);
    expect(structured.adapter).toBe("EnsLib.File.InboundAdapter");
    expect(result.isError).toBeUndefined();
  });

  // ── set ──

  it("should send POST with set action and settings object", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "set", itemName: "MyApp.Service.FileIn", updatedSettings: ["poolSize", "comment"] }),
    );

    const result = await productionItemTool.handler(
      {
        action: "set",
        itemName: "MyApp.Service.FileIn",
        settings: { poolSize: 2, comment: "Updated pool size" },
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/item",
      expect.objectContaining({
        action: "set",
        itemName: "MyApp.Service.FileIn",
        settings: { poolSize: 2, comment: "Updated pool size" },
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; updatedSettings: string[] };
    expect(structured.action).toBe("set");
    expect(structured.updatedSettings).toContain("poolSize");
    expect(structured.updatedSettings).toContain("comment");
  });

  it("should not include settings in body when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "enabled", itemName: "Test.Item" }),
    );

    await productionItemTool.handler(
      { action: "enable", itemName: "Test.Item" },
      ctx,
    );

    const calledBody = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(calledBody).not.toHaveProperty("settings");
  });

  // ── namespace ──

  it("should pass resolved namespace in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "enabled", itemName: "Test.Item" }),
    );

    await productionItemTool.handler(
      { action: "enable", itemName: "Test.Item", namespace: "MYNS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/item",
      expect.objectContaining({ namespace: "MYNS" }),
    );
  });

  // ── error handling ──

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Item not found" }], "/api/executemcp/v2/interop/production/item", "Item error"),
    );

    const result = await productionItemTool.handler(
      { action: "get", itemName: "Bad.Item" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing config item");
    expect(result.content[0]?.text).toContain("Bad.Item");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionItemTool.handler({ action: "get", itemName: "Test" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  // ── annotations ──

  it("should have readOnlyHint: false and destructiveHint: false annotations", () => {
    expect(productionItemTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionItemTool.scope).toBe("NS");
  });

  it("should have correct tool name", () => {
    expect(productionItemTool.name).toBe("iris.production.item");
  });
});

// ── iris.production.autostart ─────────────────────────────────

describe("iris.production.autostart", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── get ──

  it("should send POST with get action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "get", autoStart: "MyApp.Production", enabled: true }),
    );

    const result = await productionAutostartTool.handler(
      { action: "get" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/autostart",
      expect.objectContaining({
        action: "get",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      autoStart: string;
      enabled: boolean;
    };
    expect(structured.action).toBe("get");
    expect(structured.autoStart).toBe("MyApp.Production");
    expect(structured.enabled).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("should return enabled: false when no auto-start configured", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "get", autoStart: "", enabled: false }),
    );

    const result = await productionAutostartTool.handler(
      { action: "get" },
      ctx,
    );

    const structured = result.structuredContent as {
      autoStart: string;
      enabled: boolean;
    };
    expect(structured.autoStart).toBe("");
    expect(structured.enabled).toBe(false);
  });

  // ── set ──

  it("should send POST with set action and productionName", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "set", autoStart: "MyApp.Production", enabled: true }),
    );

    const result = await productionAutostartTool.handler(
      { action: "set", productionName: "MyApp.Production" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/autostart",
      expect.objectContaining({
        action: "set",
        productionName: "MyApp.Production",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      autoStart: string;
      enabled: boolean;
    };
    expect(structured.action).toBe("set");
    expect(structured.autoStart).toBe("MyApp.Production");
    expect(structured.enabled).toBe(true);
  });

  it("should send POST with empty productionName to disable auto-start", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "set", autoStart: "", enabled: false }),
    );

    await productionAutostartTool.handler(
      { action: "set", productionName: "" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/autostart",
      expect.objectContaining({
        action: "set",
        productionName: "",
      }),
    );
  });

  it("should not include productionName when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "get", autoStart: "", enabled: false }),
    );

    await productionAutostartTool.handler(
      { action: "get" },
      ctx,
    );

    const calledBody = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(calledBody).not.toHaveProperty("productionName");
  });

  // ── namespace ──

  it("should pass resolved namespace in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "get", autoStart: "", enabled: false }),
    );

    await productionAutostartTool.handler(
      { action: "get", namespace: "MYNS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/production/autostart",
      expect.objectContaining({ namespace: "MYNS" }),
    );
  });

  // ── error handling ──

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(500, [{ error: "Failed" }], "/api/executemcp/v2/interop/production/autostart", "AutoStart error"),
    );

    const result = await productionAutostartTool.handler(
      { action: "get" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing auto-start");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionAutostartTool.handler({ action: "get" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  // ── annotations ──

  it("should have readOnlyHint: false and destructiveHint: false annotations", () => {
    expect(productionAutostartTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionAutostartTool.scope).toBe("NS");
  });

  it("should have correct tool name", () => {
    expect(productionAutostartTool.name).toBe("iris.production.autostart");
  });
});
