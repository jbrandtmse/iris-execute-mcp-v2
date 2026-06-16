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

// ── iris_resource_manage: SQL privileges (Story 15.5, additive) ──

describe("iris_resource_manage SQL privileges (Story 15.5)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("grant (table level): POSTs to /security/sqlprivilege with target/privilege/grantee", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "grant",
        target: "Sample.Person",
        privilege: "SELECT",
        grantee: "AppRole",
        level: "table",
        success: true,
      }),
    );

    const result = await resourceManageTool.handler(
      {
        action: "grant",
        target: "Sample.Person",
        privilege: "SELECT,UPDATE",
        grantee: "AppRole",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/sqlprivilege",
      {
        action: "grant",
        target: "Sample.Person",
        privilege: "SELECT,UPDATE",
        grantee: "AppRole",
      },
    );
    const structured = result.structuredContent as { success: boolean };
    expect(structured.success).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("grant (schema level): bare schema target is forwarded as-is", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "grant", level: "schema", success: true }),
    );

    await resourceManageTool.handler(
      { action: "grant", target: "Sample", privilege: "*", grantee: "AppRole" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/sqlprivilege",
      { action: "grant", target: "Sample", privilege: "*", grantee: "AppRole" },
    );
  });

  it("grant (column level): schema.table(cols) target is forwarded as-is", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "grant", level: "column", success: true }),
    );

    await resourceManageTool.handler(
      {
        action: "grant",
        target: "Sample.Person(Name,SSN)",
        privilege: "SELECT",
        grantee: "AppUser",
        namespace: "USER",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/sqlprivilege",
      {
        action: "grant",
        target: "Sample.Person(Name,SSN)",
        privilege: "SELECT",
        grantee: "AppUser",
        namespace: "USER",
      },
    );
  });

  it("revoke: POSTs with action revoke", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "revoke", success: true }),
    );

    await resourceManageTool.handler(
      {
        action: "revoke",
        target: "Sample.Person",
        privilege: "DELETE",
        grantee: "AppRole",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/sqlprivilege",
      {
        action: "revoke",
        target: "Sample.Person",
        privilege: "DELETE",
        grantee: "AppRole",
      },
    );
  });

  it("listPrivileges (object level): GETs with grantee query param", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        grantee: "AppRole",
        level: "object",
        privileges: [
          { type: "TABLE", name: "Sample.Person", privilege: "SELECT" },
        ],
        count: 1,
      }),
    );

    const result = await resourceManageTool.handler(
      { action: "listPrivileges", grantee: "AppRole" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/sqlprivilege?grantee=AppRole",
    );
    const structured = result.structuredContent as { count: number };
    expect(structured.count).toBe(1);
    expect(result.isError).toBeUndefined();
  });

  it("listPrivileges (column level): GETs with grantee + target query params", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ grantee: "AppRole", level: "column", privileges: [], count: 0 }),
    );

    await resourceManageTool.handler(
      {
        action: "listPrivileges",
        grantee: "AppRole",
        target: "Sample.Person",
      },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/sqlprivilege?grantee=AppRole&target=Sample.Person",
    );
  });

  it("grant: returns isError on IrisApiError with the real error text", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "SQLCODE -428: table does not exist" }],
        "/api/executemcp/v2/security/sqlprivilege",
        "SQLCODE -428: table does not exist",
      ),
    );

    const result = await resourceManageTool.handler(
      {
        action: "grant",
        target: "No.Such",
        privilege: "SELECT",
        grantee: "AppRole",
      },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("SQL privilege 'grant'");
    expect(result.content[0]?.text).toContain("table does not exist");
  });

  it("declares mutates classifying ONLY the new keys", () => {
    expect(resourceManageTool.mutates).toEqual({
      grant: "write",
      revoke: "write",
      listPrivileges: "read",
    });
  });
});

// ── AC 15.5.6 back-compat gate: existing surface byte-for-byte unchanged ──

describe("iris_resource_manage back-compat (AC 15.5.6)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("name/title/scope/annotations are unchanged", () => {
    expect(resourceManageTool.name).toBe("iris_resource_manage");
    expect(resourceManageTool.title).toBe("Manage Resource");
    expect(resourceManageTool.scope).toBe("SYS");
    expect(resourceManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("the original create/modify/delete actions remain in the action enum", () => {
    const shape = resourceManageTool.inputSchema.shape as {
      action: { options: string[] };
    };
    for (const a of ["create", "modify", "delete"]) {
      expect(shape.action.options).toContain(a);
    }
  });

  it("the original resource fields are preserved", () => {
    const shape = resourceManageTool.inputSchema.shape as Record<
      string,
      unknown
    >;
    expect(shape).toHaveProperty("name");
    expect(shape).toHaveProperty("description");
    expect(shape).toHaveProperty("publicPermission");
  });

  it("create still POSTs to /security/resource with the SAME wire body (no SQL-priv leakage)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "MinimalRes" }),
    );

    await resourceManageTool.handler(
      { action: "create", name: "MinimalRes" },
      ctx,
    );

    // Byte-for-byte the SAME call the pre-15.5 tool made.
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/resource",
      { action: "create", name: "MinimalRes" },
    );
  });

  it("modify still routes to /security/resource with only provided fields", async () => {
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
      {
        action: "modify",
        name: "ExistingRes",
        description: "Updated description",
      },
    );
  });

  it("delete still routes to /security/resource and never to /security/sqlprivilege", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "OldRes" }),
    );

    await resourceManageTool.handler(
      { action: "delete", name: "OldRes" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/security/resource",
      { action: "delete", name: "OldRes" },
    );
  });

  it("iris_resource_list is unchanged (no mutates, same annotations)", () => {
    expect(resourceListTool.mutates).toBeUndefined();
    expect(resourceListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });
});
