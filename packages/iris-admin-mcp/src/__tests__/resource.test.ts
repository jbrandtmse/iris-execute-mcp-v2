import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  resourceManageTool,
  resourceListTool,
} from "../tools/resource.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_resource_manage ───────────────────────────────────────

describe("iris_resource_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with action create and required fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "TestResource" }),
    );

    const result = await resourceManageTool.handler(
      {
        action: "create",
        name: "TestResource",
        description: "A test resource",
        publicPermission: "R",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/resource",
      expect.objectContaining({
        action: "create",
        name: "TestResource",
        description: "A test resource",
        publicPermission: "R",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("TestResource");
    expect(result.isError).toBeUndefined();
  });

  it("creates resource with description without error", async () => {
    // Regression test for Story 10.5: ObjectScript handler used to pass a byref
    // array to Security.Resources.Create, which takes positional scalars. The
    // create call now extracts description/publicPermission explicitly.
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "MCPTestStory105" }),
    );

    const result = await resourceManageTool.handler(
      {
        action: "create",
        name: "MCPTestStory105",
        description: "test description",
      },
      ctx,
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("MCPTestStory105");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST for modify with only provided fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", name: "ExistingRes" }),
    );

    await resourceManageTool.handler(
      {
        action: "modify",
        name: "ExistingRes",
        description: "Updated description",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/resource",
      expect.objectContaining({
        action: "modify",
        name: "ExistingRes",
        description: "Updated description",
      }),
    );
  });

  it("should send POST for delete with only name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "OldRes" }),
    );

    const result = await resourceManageTool.handler(
      { action: "delete", name: "OldRes" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/resource",
      expect.objectContaining({
        action: "delete",
        name: "OldRes",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
    };
    expect(structured.action).toBe("deleted");
  });

  it("should not include optional fields when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "MinimalRes" }),
    );

    await resourceManageTool.handler(
      { action: "create", name: "MinimalRes" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/resource",
      { action: "create", name: "MinimalRes" },
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Invalid" }],
        "/api/executemcp/v2/security/resource",
        "Invalid resource",
      ),
    );

    const result = await resourceManageTool.handler(
      { action: "create", name: "BAD" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing resource");
    expect(result.content[0]?.text).toContain("BAD");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      resourceManageTool.handler({ action: "create", name: "TEST" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(resourceManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(resourceManageTool.scope).toBe("SYS");
  });
});

// ── iris_resource_list ─────────────────────────────────────────

describe("iris_resource_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return list of resources with count", async () => {
    const resData = [
      {
        name: "%DB_USER",
        description: "User database resource",
        publicPermission: "RW",
        type: "Database",
      },
      {
        name: "%Development",
        description: "Development resource",
        publicPermission: "",
        type: "System",
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(resData));

    const result = await resourceListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/resource",
    );

    const structured = result.structuredContent as {
      resources: typeof resData;
      count: number;
    };
    expect(structured.resources).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.resources[0]?.name).toBe("%DB_USER");
    expect(result.isError).toBeUndefined();
  });

  it("should handle empty resource list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await resourceListTool.handler({}, ctx);

    const structured = result.structuredContent as {
      resources: unknown[];
      count: number;
    };
    expect(structured.resources).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/security/resource",
        "Server error",
      ),
    );

    const result = await resourceListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing resources");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(resourceListTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(resourceListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(resourceListTool.scope).toBe("SYS");
  });

  it("should accept cursor parameter in schema", () => {
    const shape = resourceListTool.inputSchema.shape as Record<
      string,
      unknown
    >;
    expect(shape).toHaveProperty("cursor");
  });
});
