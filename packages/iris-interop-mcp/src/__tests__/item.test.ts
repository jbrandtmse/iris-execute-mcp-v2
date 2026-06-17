import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  productionItemTool,
  productionAutostartTool,
} from "../tools/item.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris_production_item ──────────────────────────────────────

describe("iris_production_item", () => {
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
    expect(productionItemTool.name).toBe("iris_production_item");
  });

  // ── Story 18.0 (CR 17.2-4 doc-only): extent/XData add-then-get visibility note ──

  it("description documents the add-then-get extent/XData visibility split (Rule #27)", () => {
    const desc = productionItemTool.description ?? "";
    expect(desc).toContain("NOT visible to an immediate 'get'/'set'");
    expect(desc).toContain("LoadFromClass");
  });

  // ════════════════════════════════════════════════════════════════
  // Story 17.2 — ADD / REMOVE (additive mutating actions)
  // ════════════════════════════════════════════════════════════════

  describe("add (Story 17.2)", () => {
    it("should send POST with add action, className, and resolved namespace", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "added",
          itemName: "MyApp.Service.New",
          production: "MyApp.Production",
          className: "EnsLib.File.PassthroughService",
          updatedSettings: [],
        }),
      );

      const result = await productionItemTool.handler(
        {
          action: "add",
          itemName: "MyApp.Service.New",
          className: "EnsLib.File.PassthroughService",
          production: "MyApp.Production",
        },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/executemcp/v2/interop/production/item",
        expect.objectContaining({
          action: "add",
          itemName: "MyApp.Service.New",
          className: "EnsLib.File.PassthroughService",
          production: "MyApp.Production",
          namespace: "USER",
        }),
      );

      const structured = result.structuredContent as { action: string };
      expect(structured.action).toBe("added");
      expect(result.isError).toBeUndefined();
    });

    it("should default production (omit it) and forward settings on add", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({ action: "added", itemName: "X", production: "P", className: "C", updatedSettings: ["comment"] }),
      );

      await productionItemTool.handler(
        {
          action: "add",
          itemName: "X",
          className: "C",
          settings: { comment: "new item" },
        },
        ctx,
      );

      const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("production");
      expect(body.settings).toEqual({ comment: "new item" });
    });
  });

  describe("remove (Story 17.2)", () => {
    it("should send POST with remove action and production", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({ action: "removed", itemName: "MyApp.Service.Old", production: "MyApp.Production" }),
      );

      const result = await productionItemTool.handler(
        { action: "remove", itemName: "MyApp.Service.Old", production: "MyApp.Production" },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/executemcp/v2/interop/production/item",
        expect.objectContaining({
          action: "remove",
          itemName: "MyApp.Service.Old",
          production: "MyApp.Production",
        }),
      );

      const structured = result.structuredContent as { action: string };
      expect(structured.action).toBe("removed");
    });
  });

  describe("arbitrary host/adapter settings on set (Story 17.2)", () => {
    it("should forward a non-property setting key unchanged in the body", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({ action: "set", itemName: "MyApp.Service.FileIn", updatedSettings: ["FilePath@Adapter", "Charset@Host"] }),
      );

      await productionItemTool.handler(
        {
          action: "set",
          itemName: "MyApp.Service.FileIn",
          settings: { "FilePath@Adapter": "/data/in", "Charset@Host": "UTF-8" },
        },
        ctx,
      );

      const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
      // The tool is a pass-through: arbitrary keys are forwarded verbatim; the
      // ObjectScript handler decides property-vs-Ens.Config.Setting routing.
      expect(body.settings).toEqual({ "FilePath@Adapter": "/data/in", "Charset@Host": "UTF-8" });
    });
  });

  // ════════════════════════════════════════════════════════════════
  // Story 17.2 AC 17.2.4 — BACK-COMPAT MECHANICAL GATE (Rule #19).
  // Fail-if-drift `toEqual` snapshots pinning the existing enable/disable/get/
  // set request bodies. The 5 working property keys + the existing output shapes
  // MUST stay byte-for-byte unchanged; add/remove/arbitrary-settings are additive.
  // ════════════════════════════════════════════════════════════════

  describe("back-compat gate (AC 17.2.4, Rule #19)", () => {
    it("enable request body is byte-for-byte unchanged", async () => {
      mockHttp.post.mockResolvedValue(envelope({ action: "enabled", itemName: "Svc" }));
      await productionItemTool.handler({ action: "enable", itemName: "Svc" }, ctx);
      expect(mockHttp.post.mock.calls[0]?.[1]).toEqual({
        action: "enable",
        itemName: "Svc",
        namespace: "USER",
      });
    });

    it("disable request body is byte-for-byte unchanged", async () => {
      mockHttp.post.mockResolvedValue(envelope({ action: "disabled", itemName: "Svc" }));
      await productionItemTool.handler({ action: "disable", itemName: "Svc" }, ctx);
      expect(mockHttp.post.mock.calls[0]?.[1]).toEqual({
        action: "disable",
        itemName: "Svc",
        namespace: "USER",
      });
    });

    it("get request body is byte-for-byte unchanged (no settings/className/production)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ action: "get", itemName: "Svc", className: "C", enabled: true, poolSize: 1 }));
      await productionItemTool.handler({ action: "get", itemName: "Svc" }, ctx);
      expect(mockHttp.post.mock.calls[0]?.[1]).toEqual({
        action: "get",
        itemName: "Svc",
        namespace: "USER",
      });
    });

    it("set request body with the 5 working property keys is byte-for-byte unchanged", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({ action: "set", itemName: "Svc", updatedSettings: ["poolSize", "enabled", "comment", "category", "className"] }),
      );
      await productionItemTool.handler(
        {
          action: "set",
          itemName: "Svc",
          settings: { poolSize: 2, enabled: true, comment: "c", category: "cat", className: "Cls" },
        },
        ctx,
      );
      expect(mockHttp.post.mock.calls[0]?.[1]).toEqual({
        action: "set",
        itemName: "Svc",
        namespace: "USER",
        settings: { poolSize: 2, enabled: true, comment: "c", category: "cat", className: "Cls" },
      });
    });

    it("the existing four action enum values remain accepted (additive only)", () => {
      // The action enum is the governance-key source; it MUST still contain the
      // four grandfathered actions plus the two new ones.
      const shape = (
        productionItemTool.inputSchema as unknown as {
          shape: { action: { options: string[] } };
        }
      ).shape;
      expect(shape.action.options).toEqual(
        expect.arrayContaining(["enable", "disable", "get", "set"]),
      );
      expect(shape.action.options).toEqual(
        expect.arrayContaining(["add", "remove"]),
      );
    });

    it("declares mutates for add/remove ONLY (the grandfathered four stay baseline-exempt)", () => {
      expect(productionItemTool.mutates).toEqual({ add: "write", remove: "write" });
    });
  });

  // ════════════════════════════════════════════════════════════════
  // Story 17.2 QA — COVERAGE GAPS (additive to the dev's suite).
  //
  // The dev's back-compat block (above) pins the existing enable/disable/get/set
  // *request bodies* via toEqual. The assertions below close orthogonal gaps the
  // request-body snapshots cannot catch:
  //   1. OUTPUT-shape drift — the tool passes the REST envelope `result` through
  //      as `structuredContent` verbatim, so a full toEqual on structuredContent
  //      is a non-vacuous, fail-if-drift pin of the OUTPUT contract (AC 17.2.4
  //      asks the snapshots assert the FULL object, not a field subset — the
  //      dev's get/enable/disable tests only .toBe individual fields).
  //   2. structuredContent must be an OBJECT, never an array (project invariant)
  //      for the new add/remove plus the existing get.
  //   3. `add` body OMITS `className` when the caller omits it (additive
  //      defaulting — the server enforces Required, the tool forwards verbatim).
  // ════════════════════════════════════════════════════════════════

  describe("QA gap — output-shape pass-through (AC 17.2.4, full-object)", () => {
    it("enable output structuredContent equals the REST result verbatim", async () => {
      const result = { action: "enabled", itemName: "Svc" };
      mockHttp.post.mockResolvedValue(envelope(result));
      const res = await productionItemTool.handler({ action: "enable", itemName: "Svc" }, ctx);
      expect(res.structuredContent).toEqual(result);
    });

    it("disable output structuredContent equals the REST result verbatim", async () => {
      const result = { action: "disabled", itemName: "Svc" };
      mockHttp.post.mockResolvedValue(envelope(result));
      const res = await productionItemTool.handler({ action: "disable", itemName: "Svc" }, ctx);
      expect(res.structuredContent).toEqual(result);
    });

    it("get output structuredContent equals the REST result verbatim (full object, optional keys absent)", async () => {
      // Mirrors the handler shape: {action,itemName,className,enabled,poolSize}
      // with comment/category OMITTED when empty (per AC 17.2.4(b)).
      const result = {
        action: "get",
        itemName: "Svc",
        className: "EnsLib.File.PassthroughService",
        enabled: true,
        poolSize: 1,
      };
      mockHttp.post.mockResolvedValue(envelope(result));
      const res = await productionItemTool.handler({ action: "get", itemName: "Svc" }, ctx);
      expect(res.structuredContent).toEqual(result);
    });

    it("set output structuredContent equals the REST result verbatim (action,itemName,updatedSettings)", async () => {
      const result = {
        action: "set",
        itemName: "Svc",
        updatedSettings: ["poolSize", "comment"],
      };
      mockHttp.post.mockResolvedValue(envelope(result));
      const res = await productionItemTool.handler(
        { action: "set", itemName: "Svc", settings: { poolSize: 2, comment: "c" } },
        ctx,
      );
      expect(res.structuredContent).toEqual(result);
    });

    it("add output structuredContent equals the REST result verbatim", async () => {
      const result = {
        action: "added",
        itemName: "Svc.New",
        production: "MyApp.Production",
        className: "EnsLib.File.PassthroughService",
        updatedSettings: [],
      };
      mockHttp.post.mockResolvedValue(envelope(result));
      const res = await productionItemTool.handler(
        {
          action: "add",
          itemName: "Svc.New",
          className: "EnsLib.File.PassthroughService",
          production: "MyApp.Production",
        },
        ctx,
      );
      expect(res.structuredContent).toEqual(result);
    });

    it("remove output structuredContent equals the REST result verbatim", async () => {
      const result = { action: "removed", itemName: "Svc.Old", production: "MyApp.Production" };
      mockHttp.post.mockResolvedValue(envelope(result));
      const res = await productionItemTool.handler(
        { action: "remove", itemName: "Svc.Old", production: "MyApp.Production" },
        ctx,
      );
      expect(res.structuredContent).toEqual(result);
    });
  });

  describe("QA gap — structuredContent is an OBJECT, not an array", () => {
    it.each([
      ["get", { action: "get", itemName: "Svc", className: "C", enabled: true, poolSize: 1 }, { action: "get", itemName: "Svc" }],
      ["add", { action: "added", itemName: "X", production: "P", className: "C", updatedSettings: [] }, { action: "add", itemName: "X", className: "C", production: "P" }],
      ["remove", { action: "removed", itemName: "X", production: "P" }, { action: "remove", itemName: "X", production: "P" }],
    ])("%s returns a non-array object as structuredContent", async (_label, result, args) => {
      mockHttp.post.mockResolvedValue(envelope(result));
      const res = await productionItemTool.handler(args as Record<string, unknown>, ctx);
      expect(res.structuredContent).toBeTypeOf("object");
      expect(res.structuredContent).not.toBeNull();
      expect(Array.isArray(res.structuredContent)).toBe(false);
    });
  });

  describe("QA gap — add request-body defaulting (additive)", () => {
    it("omits className from the body when the caller omits it (server enforces Required)", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({ action: "added", itemName: "X", production: "P", className: "", updatedSettings: [] }),
      );
      await productionItemTool.handler({ action: "add", itemName: "X", production: "P" }, ctx);
      const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body).not.toHaveProperty("className");
      // production was explicit → present; namespace always resolved.
      expect(body).toMatchObject({ action: "add", itemName: "X", production: "P", namespace: "USER" });
    });

    it("forwards an arbitrary-setting key verbatim on add (same routing as set)", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({ action: "added", itemName: "X", production: "P", className: "C", updatedSettings: ["Charset@Host"] }),
      );
      await productionItemTool.handler(
        {
          action: "add",
          itemName: "X",
          className: "C",
          production: "P",
          settings: { "Charset@Host": "UTF-8" },
        },
        ctx,
      );
      const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body.settings).toEqual({ "Charset@Host": "UTF-8" });
    });
  });
});

// ── iris_production_autostart ─────────────────────────────────

describe("iris_production_autostart", () => {
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
    expect(productionAutostartTool.name).toBe("iris_production_autostart");
  });
});
