import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { databaseManageTool, databaseListTool } from "../tools/database.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris.database.manage ────────────────────────────────────────

describe("iris.database.manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with action, name, and directory for create", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "TESTDB" }),
    );

    const result = await databaseManageTool.handler(
      {
        action: "create",
        name: "TESTDB",
        directory: "C:\\InterSystems\\IRIS\\mgr\\testdb",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/database",
      expect.objectContaining({
        action: "create",
        name: "TESTDB",
        directory: "C:\\InterSystems\\IRIS\\mgr\\testdb",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("TESTDB");
    expect(result.isError).toBeUndefined();
  });

  it("should include all optional parameters when provided for create", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "FULLDB" }),
    );

    await databaseManageTool.handler(
      {
        action: "create",
        name: "FULLDB",
        directory: "/data/fulldb",
        size: 100,
        maxSize: 1000,
        expansionSize: 50,
        globalJournalState: 1,
        mountRequired: true,
        mountAtStartup: true,
        readOnly: false,
        resource: "%DB_FULLDB",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/database",
      expect.objectContaining({
        action: "create",
        name: "FULLDB",
        directory: "/data/fulldb",
        size: 100,
        maxSize: 1000,
        expansionSize: 50,
        globalJournalState: 1,
        mountRequired: true,
        mountAtStartup: true,
        readOnly: false,
        resource: "%DB_FULLDB",
      }),
    );
  });

  it("should send POST for modify with only provided fields", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "modified", name: "USER" }),
    );

    await databaseManageTool.handler(
      { action: "modify", name: "USER", size: 200 },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/database",
      expect.objectContaining({
        action: "modify",
        name: "USER",
        size: 200,
      }),
    );
  });

  it("should send POST for delete with only name", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "OLDDB" }),
    );

    const result = await databaseManageTool.handler(
      { action: "delete", name: "OLDDB" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/database",
      expect.objectContaining({
        action: "delete",
        name: "OLDDB",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("deleted");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Invalid" }], "/api/executemcp/v2/config/database", "Invalid database"),
    );

    const result = await databaseManageTool.handler(
      { action: "create", name: "BAD" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing database");
    expect(result.content[0]?.text).toContain("BAD");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      databaseManageTool.handler({ action: "create", name: "TEST" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(databaseManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(databaseManageTool.scope).toBe("SYS");
  });
});

// ── iris.database.list ──────────────────────────────────────────

describe("iris.database.list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return list of databases with count", async () => {
    const dbData = [
      {
        name: "USER",
        directory: "C:\\InterSystems\\IRIS\\mgr\\user",
        size: 100,
        maxSize: 0,
        expansionSize: 10,
        globalJournalState: 1,
        mountRequired: false,
        mountAtStartup: true,
        readOnly: false,
        resource: "%DB_USER",
      },
      {
        name: "IRISSYS",
        directory: "C:\\InterSystems\\IRIS\\mgr\\irissys",
        size: 200,
        maxSize: 0,
        expansionSize: 20,
        globalJournalState: 1,
        mountRequired: true,
        mountAtStartup: true,
        readOnly: false,
        resource: "%DB_IRISSYS",
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(dbData));

    const result = await databaseListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/database",
    );

    const structured = result.structuredContent as {
      databases: typeof dbData;
      count: number;
    };
    expect(structured.databases).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.databases[0]?.name).toBe("USER");
    expect(structured.databases[0]?.size).toBe(100);
    expect(result.isError).toBeUndefined();
  });

  it("should handle empty database list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await databaseListTool.handler({}, ctx);

    const structured = result.structuredContent as {
      databases: unknown[];
      count: number;
    };
    expect(structured.databases).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/config/database", "Server error"),
    );

    const result = await databaseListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing databases");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      databaseListTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(databaseListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(databaseListTool.scope).toBe("SYS");
  });

  it("should accept cursor parameter in schema", () => {
    const shape = databaseListTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("cursor");
  });
});
