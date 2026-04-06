import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { mappingManageTool, mappingListTool } from "../tools/mapping.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris.mapping.manage ────────────────────────────────────────

describe("iris.mapping.manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST for create global mapping with required params", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", type: "global", namespace: "USER", name: "MyGlobal" }),
    );

    const result = await mappingManageTool.handler(
      {
        action: "create",
        type: "global",
        namespace: "USER",
        name: "MyGlobal",
        database: "TESTDB",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/mapping/global",
      expect.objectContaining({
        action: "create",
        namespace: "USER",
        name: "MyGlobal",
        database: "TESTDB",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      type: string;
      namespace: string;
      name: string;
    };
    expect(structured.action).toBe("created");
    expect(structured.type).toBe("global");
    expect(structured.namespace).toBe("USER");
    expect(structured.name).toBe("MyGlobal");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST for create routine mapping", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", type: "routine", namespace: "USER", name: "MyRoutine" }),
    );

    await mappingManageTool.handler(
      {
        action: "create",
        type: "routine",
        namespace: "USER",
        name: "MyRoutine",
        database: "ROUTINEDB",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/mapping/routine",
      expect.objectContaining({
        action: "create",
        namespace: "USER",
        name: "MyRoutine",
        database: "ROUTINEDB",
      }),
    );
  });

  it("should send POST for create package mapping", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", type: "package", namespace: "USER", name: "MyPackage" }),
    );

    await mappingManageTool.handler(
      {
        action: "create",
        type: "package",
        namespace: "USER",
        name: "MyPackage",
        database: "PKGDB",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/mapping/package",
      expect.objectContaining({
        action: "create",
        namespace: "USER",
        name: "MyPackage",
        database: "PKGDB",
      }),
    );
  });

  it("should send POST for delete mapping with only required params", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", type: "global", namespace: "USER", name: "OldGlobal" }),
    );

    const result = await mappingManageTool.handler(
      { action: "delete", type: "global", namespace: "USER", name: "OldGlobal" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/mapping/global",
      expect.objectContaining({
        action: "delete",
        namespace: "USER",
        name: "OldGlobal",
      }),
    );

    const structured = result.structuredContent as { action: string };
    expect(structured.action).toBe("deleted");
  });

  it("should include global-specific optional params when provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", type: "global", namespace: "USER", name: "SubGlobal" }),
    );

    await mappingManageTool.handler(
      {
        action: "create",
        type: "global",
        namespace: "USER",
        name: "SubGlobal",
        database: "TESTDB",
        collation: "IRIS standard",
        lockDatabase: "LOCKDB",
        subscript: "(1):(100)",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/mapping/global",
      expect.objectContaining({
        action: "create",
        namespace: "USER",
        name: "SubGlobal",
        database: "TESTDB",
        collation: "IRIS standard",
        lockDatabase: "LOCKDB",
        subscript: "(1):(100)",
      }),
    );
  });

  it("should not include undefined optional params in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", type: "routine", namespace: "USER", name: "Simple" }),
    );

    await mappingManageTool.handler(
      {
        action: "create",
        type: "routine",
        namespace: "USER",
        name: "Simple",
        database: "SIMPLEDB",
      },
      ctx,
    );

    const calledBody = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(calledBody).not.toHaveProperty("collation");
    expect(calledBody).not.toHaveProperty("lockDatabase");
    expect(calledBody).not.toHaveProperty("subscript");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Invalid" }], "/api/executemcp/v2/config/mapping/global", "Invalid mapping"),
    );

    const result = await mappingManageTool.handler(
      { action: "create", type: "global", namespace: "USER", name: "BAD" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing global mapping");
    expect(result.content[0]?.text).toContain("BAD");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      mappingManageTool.handler(
        { action: "create", type: "global", namespace: "USER", name: "TEST" },
        ctx,
      ),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(mappingManageTool.annotations).toEqual({
      destructiveHint: true,
      readOnlyHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(mappingManageTool.scope).toBe("SYS");
  });
});

// ── iris.mapping.list ──────────────────────────────────────────

describe("iris.mapping.list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return list of global mappings with count", async () => {
    const mappingData = [
      { name: "MyGlobal", type: "global", namespace: "USER", database: "TESTDB" },
      { name: "AnotherGlobal", type: "global", namespace: "USER", database: "OTHERDB", collation: "IRIS standard" },
    ];
    mockHttp.get.mockResolvedValue(envelope(mappingData));

    const result = await mappingListTool.handler(
      { namespace: "USER", type: "global" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/mapping/global?namespace=USER",
    );

    const structured = result.structuredContent as {
      mappings: typeof mappingData;
      count: number;
    };
    expect(structured.mappings).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(structured.mappings[0]?.name).toBe("MyGlobal");
    expect(structured.mappings[0]?.database).toBe("TESTDB");
    expect(result.isError).toBeUndefined();
  });

  it("should return list of routine mappings", async () => {
    const mappingData = [
      { name: "MyRoutine", type: "routine", namespace: "USER", database: "ROUTINEDB" },
    ];
    mockHttp.get.mockResolvedValue(envelope(mappingData));

    const result = await mappingListTool.handler(
      { namespace: "USER", type: "routine" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/mapping/routine?namespace=USER",
    );

    const structured = result.structuredContent as {
      mappings: typeof mappingData;
      count: number;
    };
    expect(structured.mappings).toHaveLength(1);
    expect(structured.mappings[0]?.type).toBe("routine");
  });

  it("should return list of package mappings", async () => {
    const mappingData = [
      { name: "MyPkg", type: "package", namespace: "MYAPP", database: "PKGDB" },
    ];
    mockHttp.get.mockResolvedValue(envelope(mappingData));

    const result = await mappingListTool.handler(
      { namespace: "MYAPP", type: "package" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/mapping/package?namespace=MYAPP",
    );

    const structured = result.structuredContent as {
      mappings: typeof mappingData;
      count: number;
    };
    expect(structured.mappings).toHaveLength(1);
  });

  it("should handle empty mapping list", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await mappingListTool.handler(
      { namespace: "EMPTY", type: "global" },
      ctx,
    );

    const structured = result.structuredContent as {
      mappings: unknown[];
      count: number;
    };
    expect(structured.mappings).toEqual([]);
    expect(structured.count).toBe(0);
  });

  it("should encode namespace in URL query parameter", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await mappingListTool.handler(
      { namespace: "%SYS", type: "global" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/executemcp/v2/config/mapping/global?namespace=%25SYS",
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/config/mapping/global", "Server error"),
    );

    const result = await mappingListTool.handler(
      { namespace: "USER", type: "global" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing global mappings");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      mappingListTool.handler({ namespace: "USER", type: "global" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(mappingListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope SYS", () => {
    expect(mappingListTool.scope).toBe("SYS");
  });

  it("should accept cursor parameter in schema", () => {
    const shape = mappingListTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("cursor");
  });
});
