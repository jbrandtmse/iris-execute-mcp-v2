import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  userManageTool,
  userGetTool,
  userRolesTool,
  userPasswordTool,
} from "../tools/user.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_user_manage ───────────────────────────────────────────

describe("iris_user_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with action create and required fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "testuser" }),
    );

    const result = await userManageTool.handler(
      {
        action: "create",
        name: "testuser",
        password: "SecurePass123!",
        fullName: "Test User",
        roles: "%Developer",
        namespace: "USER",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user",
      expect.objectContaining({
        action: "create",
        name: "testuser",
        password: "SecurePass123!",
        fullName: "Test User",
        roles: "%Developer",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("testuser");
    expect(result.isError).toBeUndefined();
  });

  it("creates user with full profile fields without error", async () => {
    // Regression test for Story 10.5: ObjectScript handler used to pass a byref
    // array to Security.Users.Create, which takes positional scalars (Username,
    // UserRoles, Password, FullName, NameSpace, Routine, ExpirationDate,
    // ChangePassword, Enabled, Comment, ...). The create call now extracts
    // each property explicitly and passes positionally.
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "mcptestuser" }),
    );

    const result = await userManageTool.handler(
      {
        action: "create",
        name: "mcptestuser",
        password: "SecurePass123!",
        fullName: "MCP Test User",
        roles: "%Developer",
        namespace: "USER",
        comment: "Regression fixture for 10.5",
      },
      ctx,
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("mcptestuser");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST for modify with only provided fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", name: "existinguser" }),
    );

    await userManageTool.handler(
      { action: "modify", name: "existinguser", fullName: "Updated Name" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user",
      expect.objectContaining({
        action: "modify",
        name: "existinguser",
        fullName: "Updated Name",
      }),
    );
  });

  it("should send POST for delete with only name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "olduser" }),
    );

    const result = await userManageTool.handler(
      { action: "delete", name: "olduser" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user",
      expect.objectContaining({
        action: "delete",
        name: "olduser",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
    };
    expect(structured.action).toBe("deleted");
  });

  it("should convert enabled boolean to number", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "booltest" }),
    );

    await userManageTool.handler(
      {
        action: "create",
        name: "booltest",
        password: "Test123!",
        enabled: true,
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user",
      expect.objectContaining({
        enabled: 1,
      }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Invalid" }],
        "/api/executemcp/v2/security/user",
        "Invalid user",
      ),
    );

    const result = await userManageTool.handler(
      { action: "create", name: "BAD" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing user");
    expect(result.content[0]?.text).toContain("BAD");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      userManageTool.handler({ action: "create", name: "TEST" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(userManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(userManageTool.scope).toBe("SYS");
  });

  it("should NOT include password in response content", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "secureuser" }),
    );

    const result = await userManageTool.handler(
      {
        action: "create",
        name: "secureuser",
        password: "SuperSecret123!",
      },
      ctx,
    );

    // Verify the response text does not contain the password
    const responseText = result.content[0]?.text ?? "";
    expect(responseText).not.toContain("SuperSecret123!");
  });
});

// ── iris_user_get ──────────────────────────────────────────────

describe("iris_user_get", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should GET single user by name", async () => {
    const userData = {
      name: "_SYSTEM",
      fullName: "System User",
      enabled: true,
      namespace: "%SYS",
      roles: "%All",
      comment: "",
    };
    mockHttp.get.mockResolvedValue(envelope(userData));

    const result = await userGetTool.handler({ name: "_SYSTEM" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user/_SYSTEM",
    );

    const structured = result.structuredContent as typeof userData;
    expect(structured.name).toBe("_SYSTEM");
    expect(structured.roles).toBe("%All");
    expect(result.isError).toBeUndefined();
  });

  it("should list all users when name is omitted", async () => {
    const userList = [
      { name: "_SYSTEM", fullName: "System User", enabled: true },
      { name: "Admin", fullName: "Admin User", enabled: true },
    ];
    mockHttp.get.mockResolvedValue(envelope(userList));

    const result = await userGetTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user",
    );

    const structured = result.structuredContent as {
      users: typeof userList;
      count: number;
    };
    expect(structured.users).toHaveLength(2);
    expect(structured.count).toBe(2);
  });

  it("should handle empty user list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await userGetTool.handler({}, ctx);

    const structured = result.structuredContent as {
      users: unknown[];
      count: number;
    };
    expect(structured.users).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("should URL-encode special characters in username", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ name: "test user", fullName: "Test" }),
    );

    await userGetTool.handler({ name: "test user" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user/test%20user",
    );
  });

  it("should return isError on IrisApiError for single user", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        404,
        [{ error: "Not found" }],
        "/api/executemcp/v2/security/user/NOONE",
        "User not found",
      ),
    );

    const result = await userGetTool.handler({ name: "NOONE" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error getting user");
    expect(result.content[0]?.text).toContain("NOONE");
  });

  it("should return isError on IrisApiError for list", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/security/user",
        "Server error",
      ),
    );

    const result = await userGetTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing users");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      userGetTool.handler({ name: "TEST" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(userGetTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(userGetTool.scope).toBe("SYS");
  });

  it("should accept cursor parameter in schema", () => {
    const shape = userGetTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("cursor");
  });

  it("should NOT include password in response content for user get", async () => {
    const userData = {
      name: "secuser",
      fullName: "Secure User",
      enabled: true,
      namespace: "USER",
      roles: "%Developer",
    };
    mockHttp.get.mockResolvedValue(envelope(userData));

    const result = await userGetTool.handler({ name: "secuser" }, ctx);

    const responseText = result.content[0]?.text ?? "";
    expect(responseText).not.toContain("password");
    expect(responseText).not.toContain("Password");
  });

  it("iris_user_get list mode preserves enabled, fullName, and comment", async () => {
    // Story 11.2 Bug #4: the Security.Users:List ROWSPEC does not
    // expose FullName, Namespace, Comment, ExpirationDate, or
    // ChangePassword — only Name, Enabled, Roles, LastLoginTime, Flags.
    // The handler now backfills via per-row Security.Users.Get() so
    // these fields carry real values in list mode.
    const userList = [
      {
        name: "Admin",
        enabled: true,
        fullName: "Administrator",
        comment: "Built-in admin",
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(userList));

    const result = await userGetTool.handler({}, ctx);

    const structured = result.structuredContent as {
      users: typeof userList;
      count: number;
    };
    expect(structured.users).toHaveLength(1);
    expect(structured.users[0]?.enabled).toBe(true);
    expect(structured.users[0]?.fullName).toBe("Administrator");
    expect(structured.users[0]?.comment).toBe("Built-in admin");
    expect(result.isError).toBeUndefined();
  });

  it("iris_user_get single-user mode returns name field", async () => {
    // Story 11.2 Bug #5: Security.Users.Get(name, .tProps) uses name
    // as the lookup key and does NOT populate tProps("Name"). The
    // handler now echoes the pName argument so single-user responses
    // always carry the name field.
    const userData = { name: "Admin", fullName: "Administrator" };
    mockHttp.get.mockResolvedValue(envelope(userData));

    const result = await userGetTool.handler({ name: "Admin" }, ctx);

    const structured = result.structuredContent as typeof userData;
    expect(structured.name).toBe("Admin");
    expect(result.isError).toBeUndefined();
  });
});

// ── iris_user_roles ────────────────────────────────────────────

describe("iris_user_roles", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should POST to add role", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "add",
        username: "testuser",
        role: "%Developer",
        roles: "%All,%Developer",
      }),
    );

    const result = await userRolesTool.handler(
      { action: "add", username: "testuser", role: "%Developer" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user/roles",
      { action: "add", username: "testuser", role: "%Developer" },
    );

    const structured = result.structuredContent as {
      action: string;
      username: string;
      role: string;
      roles: string;
    };
    expect(structured.action).toBe("add");
    expect(structured.roles).toContain("%Developer");
    expect(result.isError).toBeUndefined();
  });

  it("should POST to remove role", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "remove",
        username: "testuser",
        role: "%Developer",
        roles: "%All",
      }),
    );

    const result = await userRolesTool.handler(
      { action: "remove", username: "testuser", role: "%Developer" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user/roles",
      { action: "remove", username: "testuser", role: "%Developer" },
    );

    const structured = result.structuredContent as {
      action: string;
      roles: string;
    };
    expect(structured.roles).not.toContain("%Developer");
  });

  it("should handle already-assigned role gracefully", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "add",
        username: "testuser",
        role: "%All",
        message: "Role already assigned",
      }),
    );

    const result = await userRolesTool.handler(
      { action: "add", username: "testuser", role: "%All" },
      ctx,
    );

    const structured = result.structuredContent as { message: string };
    expect(structured.message).toBe("Role already assigned");
    expect(result.isError).toBeUndefined();
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "User not found" }],
        "/api/executemcp/v2/security/user/roles",
        "User not found",
      ),
    );

    const result = await userRolesTool.handler(
      { action: "add", username: "NOONE", role: "%All" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing roles");
    expect(result.content[0]?.text).toContain("NOONE");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      userRolesTool.handler(
        { action: "add", username: "TEST", role: "%All" },
        ctx,
      ),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(userRolesTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(userRolesTool.scope).toBe("SYS");
  });
});

// ── iris_user_password ─────────────────────────────────────────

describe("iris_user_password", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should POST to change password", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "changed",
        username: "testuser",
        success: true,
      }),
    );

    const result = await userPasswordTool.handler(
      {
        action: "change",
        username: "testuser",
        password: "NewSecure123!",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user/password",
      {
        action: "change",
        username: "testuser",
        password: "NewSecure123!",
      },
    );

    const structured = result.structuredContent as {
      action: string;
      success: boolean;
    };
    expect(structured.action).toBe("changed");
    expect(structured.success).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("should POST to validate password", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "validate", valid: true }),
    );

    const result = await userPasswordTool.handler(
      { action: "validate", password: "StrongPass123!" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user/password",
      { action: "validate", password: "StrongPass123!" },
    );

    const structured = result.structuredContent as {
      action: string;
      valid: boolean;
    };
    expect(structured.valid).toBe(true);
  });

  it("should handle invalid password validation", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "validate",
        valid: false,
        message: "Password does not meet requirements",
      }),
    );

    const result = await userPasswordTool.handler(
      { action: "validate", password: "weak" },
      ctx,
    );

    const structured = result.structuredContent as {
      valid: boolean;
      message: string;
    };
    expect(structured.valid).toBe(false);
    expect(structured.message).toBeDefined();
    expect(result.isError).toBeUndefined();
  });

  it("does not redact short candidate password in validate error text", async () => {
    // Regression test for Story 11.1 Bug #8: short candidates like "a" used to
    // cause the ObjectScript UserPassword validate branch to unconditionally
    // $Replace every occurrence of "a" in the IRIS error text with "***",
    // corrupting the generic "Password does not match length or pattern
    // requirements" message. The fix gates $Replace on $Length(tPassword) >= 8.
    // This tool-side test asserts the tool forwards `message` unchanged.
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "validate",
        valid: false,
        message: "Password does not match length or pattern requirements",
      }),
    );

    const result = await userPasswordTool.handler(
      { action: "validate", password: "a" },
      ctx,
    );

    const structured = result.structuredContent as {
      valid: boolean;
      message: string;
    };
    expect(structured.valid).toBe(false);
    expect(structured.message).toBe(
      "Password does not match length or pattern requirements",
    );
    expect(structured.message).not.toContain("***");
    expect(result.isError).toBeUndefined();
  });

  it("should NOT include password in response content", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "changed", username: "testuser", success: true }),
    );

    const result = await userPasswordTool.handler(
      {
        action: "change",
        username: "testuser",
        password: "TopSecret999!",
      },
      ctx,
    );

    const responseText = result.content[0]?.text ?? "";
    expect(responseText).not.toContain("TopSecret999!");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Failed" }],
        "/api/executemcp/v2/security/user/password",
        "Password change failed",
      ),
    );

    const result = await userPasswordTool.handler(
      { action: "change", username: "testuser", password: "Fail123!" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error with password operation");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      userPasswordTool.handler(
        { action: "change", username: "TEST", password: "Pass123!" },
        ctx,
      ),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(userPasswordTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(userPasswordTool.scope).toBe("SYS");
  });

  it("should NOT leak password in error response", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Invalid" }],
        "/api/executemcp/v2/security/user/password",
        "Password validation failed",
      ),
    );

    const result = await userPasswordTool.handler(
      { action: "validate", password: "LeakyPassword123!" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const responseText = result.content[0]?.text ?? "";
    expect(responseText).not.toContain("LeakyPassword123!");
  });

  it("sends password (not changePasswordOnNextLogin) on change action", async () => {
    // Story 12.1 AC 12.1.1 regression guard: before the fix, the handler set
    // tProps("ChangePassword") = tPassword which caused "not a valid boolean" errors.
    // After the fix, tProps("Password") = tPassword. This test asserts the TS layer
    // sends a body with the 'password' key and that the response contains action:"changed".
    mockHttp.post.mockResolvedValue(
      envelope({ action: "changed", username: "TestUser", success: true }),
    );

    const result = await userPasswordTool.handler(
      { action: "change", username: "TestUser", password: "NewPwd123!" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user/password",
      expect.objectContaining({ password: "NewPwd123!" }),
    );
    // changePasswordOnNextLogin must NOT appear in the body when not provided by caller
    const callBody = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(callBody).not.toHaveProperty("changePasswordOnNextLogin");

    const structured = result.structuredContent as { action: string; success: boolean };
    expect(structured.action).toBe("changed");
    expect(structured.success).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("forwards changePasswordOnNextLogin when provided", async () => {
    // Story 12.1 AC 12.1.2: when changePasswordOnNextLogin is true, the TS layer
    // must pass it through as integer 1 so the ObjectScript handler can set
    // tProps("ChangePassword") = 1 in the same Security.Users.Modify() call.
    mockHttp.post.mockResolvedValue(
      envelope({ action: "changed", username: "TestUser", success: true }),
    );

    await userPasswordTool.handler(
      {
        action: "change",
        username: "TestUser",
        password: "NewPwd123!",
        changePasswordOnNextLogin: true,
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/user/password",
      expect.objectContaining({
        password: "NewPwd123!",
        changePasswordOnNextLogin: 1,
      }),
    );
  });

  it("surfaces password policy in validate response", async () => {
    // Story 12.1 AC 12.1.3: validate response includes policy block so callers
    // can see what rules are being enforced without a round-trip to a config tool.
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "validate",
        valid: true,
        policy: { minLength: 8, pattern: "8.128ANP" },
      }),
    );

    const result = await userPasswordTool.handler(
      { action: "validate", password: "StrongPass123!" },
      ctx,
    );

    const structured = result.structuredContent as {
      action: string;
      valid: boolean;
      policy: { minLength: number; pattern: string };
    };
    expect(structured.valid).toBe(true);
    expect(structured.policy).toBeDefined();
    expect(structured.policy.minLength).toBe(8);
    expect(structured.policy.pattern).toBe("8.128ANP");
    expect(result.isError).toBeUndefined();
  });

  it("iris_user_password change propagates IRIS error text", async () => {
    // Story 11.2 Bug #12: the ObjectScript change branch used to wrap
    // the real %Status from Security.Users.Modify() with a generic
    // "Failed to change password for user 'X'" message, discarding
    // policy-violation details, missing-user errors, etc. The fix is
    // to pass the sanitized original %Status through directly. The
    // IrisApiError.message surfaces the server's error text via
    // shared/src/errors.ts's Details: suffix, so the tool-side
    // responseText must contain the real reason.
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "ERROR #5001: Password does not meet complexity requirements" }],
        "/api/executemcp/v2/security/user/password",
        "Password does not meet complexity requirements",
      ),
    );

    const result = await userPasswordTool.handler(
      {
        action: "change",
        username: "someuser",
        password: "SomePolicyFailingPassword!",
      },
      ctx,
    );

    expect(result.isError).toBe(true);
    const responseText = result.content[0]?.text ?? "";
    expect(responseText).toContain("Password does not meet complexity requirements");
    // Verify the generic wrap is gone — the old handler always surfaced
    // "Failed to change password" as the entire error.
    expect(responseText).not.toBe("Failed to change password");
    // Password itself must never leak
    expect(responseText).not.toContain("SomePolicyFailingPassword!");
  });
});
