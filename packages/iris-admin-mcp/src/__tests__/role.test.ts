import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { roleManageTool, roleListTool } from "../tools/role.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_role_manage ───────────────────────────────────────────

describe("iris_role_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with action create and required fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "TestRole" }),
    );

    const result = await roleManageTool.handler(
      {
        action: "create",
        name: "TestRole",
        description: "A test role",
        resources: "MyDB:RW,MyApp:U",
        grantedRoles: "%Developer",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/role",
      expect.objectContaining({
        action: "create",
        name: "TestRole",
        description: "A test role",
        resources: "MyDB:RW,MyApp:U",
        grantedRoles: "%Developer",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("TestRole");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST for modify with only provided fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", name: "ExistingRole" }),
    );

    await roleManageTool.handler(
      {
        action: "modify",
        name: "ExistingRole",
        description: "Updated description",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/role",
      expect.objectContaining({
        action: "modify",
        name: "ExistingRole",
        description: "Updated description",
      }),
    );
  });

  it("should send POST for delete with only name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "OldRole" }),
    );

    const result = await roleManageTool.handler(
      { action: "delete", name: "OldRole" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/role",
      expect.objectContaining({
        action: "delete",
        name: "OldRole",
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
      envelope({ action: "created", name: "MinimalRole" }),
    );

    await roleManageTool.handler(
      { action: "create", name: "MinimalRole" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/role",
      { action: "create", name: "MinimalRole" },
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Invalid" }],
        "/api/executemcp/v2/security/role",
        "Invalid role",
      ),
    );

    const result = await roleManageTool.handler(
      { action: "create", name: "BAD" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing role");
    expect(result.content[0]?.text).toContain("BAD");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      roleManageTool.handler({ action: "create", name: "TEST" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(roleManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(roleManageTool.scope).toBe("SYS");
  });
});

// ── iris_role_list ─────────────────────────────────────────────

describe("iris_role_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return list of roles with count", async () => {
    const roleData = [
      {
        name: "%All",
        description: "All privileges",
        resources: "",
        grantedRoles: "",
      },
      {
        name: "%Developer",
        description: "Developer role",
        resources: "%Development:U",
        grantedRoles: "",
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(roleData));

    const result = await roleListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/role",
    );

    const structured = result.structuredContent as {
      roles: typeof roleData;
      count: number;
    };
    expect(structured.roles).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.roles[0]?.name).toBe("%All");
    expect(result.isError).toBeUndefined();
  });

  it("should handle empty role list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await roleListTool.handler({}, ctx);

    const structured = result.structuredContent as {
      roles: unknown[];
      count: number;
    };
    expect(structured.roles).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/security/role",
        "Server error",
      ),
    );

    const result = await roleListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing roles");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(roleListTool.handler({}, ctx)).rejects.toThrow(
      "ECONNREFUSED",
    );
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(roleListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(roleListTool.scope).toBe("SYS");
  });

  it("should accept cursor parameter in schema", () => {
    const shape = roleListTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("cursor");
  });
});
