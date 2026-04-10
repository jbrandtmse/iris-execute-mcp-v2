import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { permissionCheckTool } from "../tools/permission.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_permission_check ──────────────────────────────────────

describe("iris_permission_check", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should POST to check permission for a user", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        target: "_SYSTEM",
        targetType: "user",
        resource: "%DB_USER",
        permission: "RW",
        granted: true,
        grantedPermission: "RWU",
      }),
    );

    const result = await permissionCheckTool.handler(
      { target: "_SYSTEM", resource: "%DB_USER", permission: "RW" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/permission",
      {
        target: "_SYSTEM",
        resource: "%DB_USER",
        permission: "RW",
      },
    );

    const structured = result.structuredContent as {
      target: string;
      targetType: string;
      resource: string;
      permission: string;
      granted: boolean;
      grantedPermission: string;
    };
    expect(structured.target).toBe("_SYSTEM");
    expect(structured.targetType).toBe("user");
    expect(structured.granted).toBe(true);
    expect(structured.grantedPermission).toBe("RWU");
    expect(result.isError).toBeUndefined();
  });

  it("should POST to check permission for a role", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        target: "%Developer",
        targetType: "role",
        resource: "%Development",
        permission: "U",
        granted: true,
        grantedPermission: "U",
      }),
    );

    const result = await permissionCheckTool.handler(
      { target: "%Developer", resource: "%Development", permission: "U" },
      ctx,
    );

    const structured = result.structuredContent as {
      targetType: string;
      granted: boolean;
    };
    expect(structured.targetType).toBe("role");
    expect(structured.granted).toBe(true);
  });

  it("should handle permission denied", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        target: "limiteduser",
        targetType: "user",
        resource: "%DB_SYS",
        permission: "W",
        granted: false,
        grantedPermission: "R",
      }),
    );

    const result = await permissionCheckTool.handler(
      { target: "limiteduser", resource: "%DB_SYS", permission: "W" },
      ctx,
    );

    const structured = result.structuredContent as {
      granted: boolean;
      grantedPermission: string;
    };
    expect(structured.granted).toBe(false);
    expect(structured.grantedPermission).toBe("R");
    expect(result.isError).toBeUndefined();
  });

  it("should handle resource not found on target", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        target: "_SYSTEM",
        targetType: "user",
        resource: "NonExistentResource",
        permission: "R",
        granted: false,
      }),
    );

    const result = await permissionCheckTool.handler(
      {
        target: "_SYSTEM",
        resource: "NonExistentResource",
        permission: "R",
      },
      ctx,
    );

    const structured = result.structuredContent as {
      granted: boolean;
      grantedPermission?: string;
    };
    expect(structured.granted).toBe(false);
    expect(structured.grantedPermission).toBeUndefined();
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Target not found" }],
        "/api/executemcp/v2/security/permission",
        "Target not found",
      ),
    );

    const result = await permissionCheckTool.handler(
      { target: "NOBODY", resource: "%DB_USER", permission: "R" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error checking permission");
    expect(result.content[0]?.text).toContain("NOBODY");
    expect(result.content[0]?.text).toContain("%DB_USER");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      permissionCheckTool.handler(
        { target: "TEST", resource: "RES", permission: "R" },
        ctx,
      ),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(permissionCheckTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(permissionCheckTool.scope).toBe("SYS");
  });
});
