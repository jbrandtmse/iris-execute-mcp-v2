import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { defaultSettingsManageTool } from "../tools/defaultSettings.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris_default_settings_manage ──────────────────────────────

describe("iris_default_settings_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── list ──

  it("should GET with namespace and wrap rows under settings", async () => {
    const rows = [
      {
        id: 1,
        production: "*",
        item: "*",
        hostClass: "*",
        setting: "ArchiveIO",
        value: "1",
        deployable: false,
      },
      {
        id: 2,
        production: "My.Prod",
        item: "My.Svc",
        hostClass: "*",
        setting: "PoolSize",
        value: "4",
        description: "pool size override",
        deployable: true,
      },
    ];
    mockHttp.get.mockResolvedValue(envelope({ settings: rows, count: 2 }));

    const result = await defaultSettingsManageTool.handler({ action: "list" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/interop/defaultsettings?"),
    );
    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=USER");

    const structured = result.structuredContent as { settings: unknown[]; count: number };
    expect(structured.settings).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(result.isError).toBeUndefined();
  });

  it("should forward list filters as query params", async () => {
    mockHttp.get.mockResolvedValue(envelope({ settings: [], count: 0 }));

    await defaultSettingsManageTool.handler(
      {
        action: "list",
        production: "My.Prod",
        item: "My.Svc",
        hostClass: "EnsLib.HTTP.GenericService",
        setting: "PoolSize",
      },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("production=My.Prod");
    expect(calledPath).toContain("item=My.Svc");
    expect(calledPath).toContain("hostClass=EnsLib.HTTP.GenericService");
    expect(calledPath).toContain("setting=PoolSize");
  });

  // ── get ──

  it("should POST a get action with the tuple and return the matched row", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "get",
        found: true,
        production: "My.Prod",
        item: "My.Svc",
        hostClass: "*",
        setting: "PoolSize",
        value: "4",
        deployable: false,
      }),
    );

    const result = await defaultSettingsManageTool.handler(
      { action: "get", production: "My.Prod", item: "My.Svc", setting: "PoolSize" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/defaultsettings",
      expect.objectContaining({
        action: "get",
        production: "My.Prod",
        item: "My.Svc",
        setting: "PoolSize",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; found: boolean; value: string };
    expect(structured.action).toBe("get");
    expect(structured.found).toBe(true);
    expect(structured.value).toBe("4");
    expect(result.isError).toBeUndefined();
  });

  it("should surface found:false for a missing tuple on get", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "get",
        found: false,
        production: "*",
        item: "*",
        hostClass: "*",
        setting: "Nope",
      }),
    );

    const result = await defaultSettingsManageTool.handler(
      { action: "get", setting: "Nope" },
      ctx,
    );

    const structured = result.structuredContent as { found: boolean };
    expect(structured.found).toBe(false);
  });

  // ── set ──

  it("should POST a set action with value, description, and deployable", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "set",
        production: "My.Prod",
        item: "*",
        hostClass: "*",
        setting: "PoolSize",
        value: "8",
      }),
    );

    const result = await defaultSettingsManageTool.handler(
      {
        action: "set",
        production: "My.Prod",
        setting: "PoolSize",
        value: "8",
        description: "increase pool",
        deployable: true,
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/defaultsettings",
      expect.objectContaining({
        action: "set",
        production: "My.Prod",
        setting: "PoolSize",
        value: "8",
        description: "increase pool",
        deployable: true,
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; value: string };
    expect(structured.action).toBe("set");
    expect(structured.value).toBe("8");
  });

  it("should not include description/deployable when omitted on set", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "set",
        production: "*",
        item: "*",
        hostClass: "*",
        setting: "PoolSize",
        value: "8",
      }),
    );

    await defaultSettingsManageTool.handler(
      { action: "set", setting: "PoolSize", value: "8" },
      ctx,
    );

    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("description");
    expect(body).not.toHaveProperty("deployable");
    expect(body.value).toBe("8");
  });

  // ── delete ──

  it("should POST a delete action with the tuple", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "deleted",
        production: "My.Prod",
        item: "*",
        hostClass: "*",
        setting: "PoolSize",
      }),
    );

    const result = await defaultSettingsManageTool.handler(
      { action: "delete", production: "My.Prod", setting: "PoolSize" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/defaultsettings",
      expect.objectContaining({
        action: "delete",
        production: "My.Prod",
        setting: "PoolSize",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string };
    expect(structured.action).toBe("deleted");
  });

  // ── namespace ──

  it("should pass resolved namespace through for POST actions", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", production: "*", item: "*", hostClass: "*", setting: "X" }),
    );

    await defaultSettingsManageTool.handler(
      { action: "delete", setting: "X", namespace: "MYNS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/defaultsettings",
      expect.objectContaining({ namespace: "MYNS" }),
    );
  });

  // ── error handling ──

  it("should return isError on IrisApiError (list)", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "boom" }], "/api/executemcp/v2/interop/defaultsettings", "List error"),
    );

    const result = await defaultSettingsManageTool.handler({ action: "list" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing default settings (list)");
  });

  it("should return isError on IrisApiError (set)", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "bad" }], "/api/executemcp/v2/interop/defaultsettings", "Set error"),
    );

    const result = await defaultSettingsManageTool.handler(
      { action: "set", setting: "PoolSize", value: "8" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing default settings (set)");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      defaultSettingsManageTool.handler({ action: "delete", setting: "X" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  // ── metadata ──

  it("should have correct tool name", () => {
    expect(defaultSettingsManageTool.name).toBe("iris_default_settings_manage");
  });

  it("should have scope NS", () => {
    expect(defaultSettingsManageTool.scope).toBe("NS");
  });

  it("should classify list/get as read and set/delete as write in mutates", () => {
    expect(defaultSettingsManageTool.mutates).toEqual({
      list: "read",
      get: "read",
      set: "write",
      delete: "write",
    });
  });

  // ── E2E coverage gaps (QA Story 17.1) ──
  //
  // The dev's 14 unit tests cover happy paths + filters + the two error
  // classes. These fill three genuine gaps the existing suite misses, each
  // grounded in the ObjectScript handler's actual response contract
  // (src/ExecuteMCPv2/REST/Interop.cls DefaultSettingsList/DefaultSettingsManage):
  //   (1) the get-not-found / delete-not-found ASYMMETRY,
  //   (2) the omitted-tuple-key passthrough that lets the server apply "*",
  //   (3) the structuredContent object-shape guard (project memory: never a
  //       bare array).

  // (1) Asymmetry: get-not-found is a SUCCESSFUL 200 ({found:false}); the dev
  // covers that. delete-not-found is a server ERROR (the handler renders a
  // SanitizeError'd %Status), which surfaces in the tool as isError — NOT a
  // {found:false} success. This contrast is the realistic gap.
  it("should surface delete-not-found as isError (NOT a found:false success)", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Default setting '*||*||*||Nope' not found" }],
        "/api/executemcp/v2/interop/defaultsettings",
        "Default setting '*||*||*||Nope' not found",
      ),
    );

    const result = await defaultSettingsManageTool.handler(
      { action: "delete", setting: "Nope" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing default settings (delete)");
    // A delete miss must NOT masquerade as a found:false success payload.
    expect(result.structuredContent).toBeUndefined();
  });

  it("get-not-found and delete-not-found differ: get is a 200 found:false, delete is isError", async () => {
    // get-miss → handler returns the server's 200 {found:false} object verbatim.
    mockHttp.post.mockResolvedValueOnce(
      envelope({ action: "get", found: false, production: "*", item: "*", hostClass: "*", setting: "Nope" }),
    );
    const getMiss = await defaultSettingsManageTool.handler({ action: "get", setting: "Nope" }, ctx);
    expect(getMiss.isError).toBeUndefined();
    expect((getMiss.structuredContent as { found: boolean }).found).toBe(false);

    // delete-miss → server raises, handler reports isError with no structuredContent.
    mockHttp.post.mockRejectedValueOnce(
      new IrisApiError(500, [{ error: "not found" }], "/api/executemcp/v2/interop/defaultsettings", "not found"),
    );
    const delMiss = await defaultSettingsManageTool.handler({ action: "delete", setting: "Nope" }, ctx);
    expect(delMiss.isError).toBe(true);
    expect(delMiss.structuredContent).toBeUndefined();
  });

  // (2) Omitted-tuple-key passthrough. The four slots default to "*" SERVER-side
  // (the class InitialExpression). The tool's contract for enabling that is to
  // OMIT the key from the body entirely — never to send "*" itself. The dev's
  // set-omitted test only checked description/deployable; this asserts the
  // tuple keys are likewise omitted (and namespace/action/value still present).
  it("should omit unspecified tuple key slots from the POST body (server applies '*')", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "set", production: "*", item: "*", hostClass: "*", setting: "PoolSize", value: "8" }),
    );

    await defaultSettingsManageTool.handler(
      { action: "set", setting: "PoolSize", value: "8" },
      ctx,
    );

    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    // Only `setting` was provided; production/item/hostClass must be absent so
    // the server fills "*" from InitialExpression.
    expect(body).not.toHaveProperty("production");
    expect(body).not.toHaveProperty("item");
    expect(body).not.toHaveProperty("hostClass");
    expect(body.setting).toBe("PoolSize");
    expect(body.action).toBe("set");
    expect(body.value).toBe("8");
    expect(body.namespace).toBe("USER");
  });

  it("list omits unspecified tuple filters from the query string", async () => {
    mockHttp.get.mockResolvedValue(envelope({ settings: [], count: 0 }));

    await defaultSettingsManageTool.handler({ action: "list", setting: "PoolSize" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("setting=PoolSize");
    expect(calledPath).not.toContain("production=");
    expect(calledPath).not.toContain("item=");
    expect(calledPath).not.toContain("hostClass=");
  });

  // (3) structuredContent must be a plain OBJECT, never a bare array (project
  // memory: structuredContent must be an object; the MCP SDK rejects arrays).
  // The list handler wraps rows as {settings,count}; this guards that the tool
  // forwards that object shape and does not surface the array directly.
  it("list structuredContent is an object wrapper, never a bare array", async () => {
    const rows = [{ id: 1, production: "*", item: "*", hostClass: "*", setting: "X", value: "1", deployable: false }];
    mockHttp.get.mockResolvedValue(envelope({ settings: rows, count: 1 }));

    const result = await defaultSettingsManageTool.handler({ action: "list" }, ctx);

    expect(Array.isArray(result.structuredContent)).toBe(false);
    expect(typeof result.structuredContent).toBe("object");
    expect(result.structuredContent).not.toBeNull();
    const structured = result.structuredContent as { settings: unknown[]; count: number };
    expect(Array.isArray(structured.settings)).toBe(true);
    expect(structured.count).toBe(1);
  });
});
