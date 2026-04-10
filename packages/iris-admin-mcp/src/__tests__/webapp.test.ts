import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  webappManageTool,
  webappGetTool,
  webappListTool,
} from "../tools/webapp.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_webapp_manage ─────────────────────────────────────────

describe("iris_webapp_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with action and name for create", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "created",
        name: "/api/myapp",
        caveat:
          "CSP gateway was NOT notified. Save through the Management Portal or restart the CSP gateway to activate this web application.",
      }),
    );

    const result = await webappManageTool.handler(
      {
        action: "create",
        name: "/api/myapp",
        namespace: "USER",
        dispatchClass: "MyApp.REST.Dispatch",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/webapp",
      expect.objectContaining({
        action: "create",
        name: "/api/myapp",
        namespace: "USER",
        dispatchClass: "MyApp.REST.Dispatch",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
      caveat: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("/api/myapp");
    expect(structured.caveat).toContain("CSP gateway");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST for modify with only provided fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", name: "/csp/user" }),
    );

    await webappManageTool.handler(
      {
        action: "modify",
        name: "/csp/user",
        description: "Updated description",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/webapp",
      expect.objectContaining({
        action: "modify",
        name: "/csp/user",
        description: "Updated description",
      }),
    );
  });

  it("should send POST for delete with only name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "/api/old" }),
    );

    const result = await webappManageTool.handler(
      { action: "delete", name: "/api/old" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/webapp",
      expect.objectContaining({
        action: "delete",
        name: "/api/old",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
    };
    expect(structured.action).toBe("deleted");
  });

  it("should include optional properties when provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "/api/full" }),
    );

    await webappManageTool.handler(
      {
        action: "create",
        name: "/api/full",
        namespace: "MYNS",
        dispatchClass: "Full.Dispatch",
        description: "Full app",
        enabled: true,
        authEnabled: 32,
        isNameSpaceDefault: false,
        cspZenEnabled: true,
        recurse: true,
        matchRoles: "%All",
        resource: "%Development",
        cookiePath: "/api/full/",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/webapp",
      expect.objectContaining({
        action: "create",
        name: "/api/full",
        namespace: "MYNS",
        dispatchClass: "Full.Dispatch",
        description: "Full app",
        enabled: 1,
        authEnabled: 32,
        isNameSpaceDefault: 0,
        cspZenEnabled: 1,
        recurse: 1,
        matchRoles: "%All",
        resource: "%Development",
        cookiePath: "/api/full/",
      }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Invalid" }],
        "/api/executemcp/v2/security/webapp",
        "Invalid web application",
      ),
    );

    const result = await webappManageTool.handler(
      { action: "create", name: "/bad" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error managing web application",
    );
    expect(result.content[0]?.text).toContain("/bad");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      webappManageTool.handler({ action: "create", name: "/test" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(webappManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(webappManageTool.scope).toBe("SYS");
  });
});

// ── iris_webapp_get ─────────────────────────────────────────────

describe("iris_webapp_get", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should POST to get single web application by name", async () => {
    const appData = {
      name: "/csp/user",
      namespace: "USER",
      dispatchClass: "",
      description: "CSP User app",
      enabled: true,
      authEnabled: 32,
      isNameSpaceDefault: true,
      cspZenEnabled: true,
      recurse: true,
      matchRoles: "",
      resource: "",
      cookiePath: "/csp/user/",
    };
    mockHttp.post.mockResolvedValue(envelope(appData));

    const result = await webappGetTool.handler({ name: "/csp/user" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/webapp/get",
      { name: "/csp/user" },
    );

    const structured = result.structuredContent as typeof appData;
    expect(structured.name).toBe("/csp/user");
    expect(structured.namespace).toBe("USER");
    expect(result.isError).toBeUndefined();
  });

  it("should pass app name with slashes in body without encoding", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ name: "/api/my/app", namespace: "USER" }),
    );

    await webappGetTool.handler({ name: "/api/my/app" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/webapp/get",
      { name: "/api/my/app" },
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        404,
        [{ error: "Not found" }],
        "/api/executemcp/v2/security/webapp/get",
        "Not found",
      ),
    );

    const result = await webappGetTool.handler({ name: "/bad" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error getting web application",
    );
    expect(result.content[0]?.text).toContain("/bad");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      webappGetTool.handler({ name: "/test" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(webappGetTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(webappGetTool.scope).toBe("SYS");
  });
});

// ── iris_webapp_list ────────────────────────────────────────────

describe("iris_webapp_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return list of web applications with count", async () => {
    const appData = [
      {
        name: "/csp/user",
        namespace: "USER",
        dispatchClass: "",
        description: "",
        enabled: true,
      },
      {
        name: "/api/executemcp/v2",
        namespace: "USER",
        dispatchClass: "ExecuteMCPv2.REST.Dispatch",
        description: "MCP REST",
        enabled: true,
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(appData));

    const result = await webappListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/webapp",
    );

    const structured = result.structuredContent as {
      webapps: typeof appData;
      count: number;
    };
    expect(structured.webapps).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.webapps[0]?.name).toBe("/csp/user");
    expect(result.isError).toBeUndefined();
  });

  it("should pass namespace filter as query parameter", async () => {
    mockHttp.get.mockResolvedValue(
      envelope([
        { name: "/csp/user", namespace: "USER" },
      ]),
    );

    await webappListTool.handler({ namespace: "USER" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/webapp?namespace=USER",
    );
  });

  it("should URL-encode namespace filter", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await webappListTool.handler({ namespace: "%SYS" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/webapp?namespace=%25SYS",
    );
  });

  it("should handle empty web application list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await webappListTool.handler({}, ctx);

    const structured = result.structuredContent as {
      webapps: unknown[];
      count: number;
    };
    expect(structured.webapps).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/security/webapp",
        "Server error",
      ),
    );

    const result = await webappListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error listing web applications",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(webappListTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(webappListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope BOTH", () => {
    expect(webappListTool.scope).toBe("BOTH");
  });

  it("should accept cursor and namespace parameters in schema", () => {
    const shape = webappListTool.inputSchema.shape as Record<
      string,
      unknown
    >;
    expect(shape).toHaveProperty("cursor");
    expect(shape).toHaveProperty("namespace");
  });
});
