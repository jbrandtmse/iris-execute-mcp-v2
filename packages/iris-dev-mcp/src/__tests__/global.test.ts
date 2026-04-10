import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext, PaginateResult } from "@iris-mcp/shared";
import { IrisApiError, encodeCursor, decodeCursor } from "@iris-mcp/shared";
import {
  globalGetTool,
  globalSetTool,
  globalKillTool,
  globalListTool,
} from "../tools/global.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── iris_global_get ──────────────────────────────────────────────

describe("iris_global_get", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return global value and defined flag", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ value: "hello", defined: true }),
    );

    const result = await globalGetTool.handler({ global: "TestGlobal" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/global?"),
    );
    const url = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(url).toContain("global=TestGlobal");
    expect(url).toContain("namespace=USER");

    const structured = result.structuredContent as { value: string; defined: boolean };
    expect(structured.value).toBe("hello");
    expect(structured.defined).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("should pass subscripts when provided", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ value: "42", defined: true }),
    );

    await globalGetTool.handler(
      { global: "TestGlobal", subscripts: '"key1","key2"' },
      ctx,
    );

    const url = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(url).toContain("subscripts=");
    expect(url).toContain("global=TestGlobal");
  });

  it("should forward namespace override", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ value: "", defined: false }),
    );

    await globalGetTool.handler(
      { global: "TestGlobal", namespace: "HSCUSTOM" },
      ctx,
    );

    const url = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(url).toContain("namespace=HSCUSTOM");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(400, [{ error: "Missing param" }], "/api/executemcp/v2/global", "Missing param"),
    );

    const result = await globalGetTool.handler({ global: "Bad" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error reading global");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      globalGetTool.handler({ global: "TestGlobal" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(globalGetTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(globalGetTool.scope).toBe("NS");
  });
});

// ── iris_global_set ──────────────────────────────────────────────

describe("iris_global_set", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send PUT with global name and value in body", async () => {
    mockHttp.put.mockResolvedValue(
      envelope({ value: "hello", verified: true }),
    );

    const result = await globalSetTool.handler(
      { global: "TestGlobal", value: "hello" },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledWith(
      "/api/executemcp/v2/global",
      expect.objectContaining({
        global: "TestGlobal",
        value: "hello",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { value: string; verified: boolean };
    expect(structured.value).toBe("hello");
    expect(structured.verified).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("should include subscripts in body when provided", async () => {
    mockHttp.put.mockResolvedValue(
      envelope({ value: "42", verified: true }),
    );

    await globalSetTool.handler(
      { global: "TestGlobal", value: "42", subscripts: "1,2" },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledWith(
      "/api/executemcp/v2/global",
      expect.objectContaining({
        global: "TestGlobal",
        value: "42",
        subscripts: "1,2",
        namespace: "USER",
      }),
    );
  });

  it("should forward namespace override in body", async () => {
    mockHttp.put.mockResolvedValue(
      envelope({ value: "val", verified: true }),
    );

    await globalSetTool.handler(
      { global: "TestGlobal", value: "val", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledWith(
      "/api/executemcp/v2/global",
      expect.objectContaining({
        namespace: "HSCUSTOM",
      }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.put.mockRejectedValue(
      new IrisApiError(500, [{ error: "Internal" }], "/api/executemcp/v2/global", "Internal error"),
    );

    const result = await globalSetTool.handler(
      { global: "Bad", value: "x" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error setting global");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.put.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      globalSetTool.handler({ global: "TestGlobal", value: "x" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: false)", () => {
    expect(globalSetTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(globalSetTool.scope).toBe("NS");
  });
});

// ── iris_global_kill ─────────────────────────────────────────────

describe("iris_global_kill", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send DELETE with global name in query params", async () => {
    mockHttp.delete.mockResolvedValue(
      envelope({ deleted: true, global: "TestGlobal" }),
    );

    const result = await globalKillTool.handler({ global: "TestGlobal" }, ctx);

    expect(mockHttp.delete).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/global?"),
    );
    const url = mockHttp.delete.mock.calls[0]?.[0] as string;
    expect(url).toContain("global=TestGlobal");
    expect(url).toContain("namespace=USER");

    const structured = result.structuredContent as { deleted: boolean; global: string };
    expect(structured.deleted).toBe(true);
    expect(structured.global).toBe("TestGlobal");
    expect(result.isError).toBeUndefined();
  });

  it("should pass subscripts when provided", async () => {
    mockHttp.delete.mockResolvedValue(
      envelope({ deleted: true, global: "TestGlobal", subscripts: '"key1"' }),
    );

    await globalKillTool.handler(
      { global: "TestGlobal", subscripts: '"key1"' },
      ctx,
    );

    const url = mockHttp.delete.mock.calls[0]?.[0] as string;
    expect(url).toContain("subscripts=");
  });

  it("should forward namespace override", async () => {
    mockHttp.delete.mockResolvedValue(
      envelope({ deleted: true, global: "TestGlobal" }),
    );

    await globalKillTool.handler(
      { global: "TestGlobal", namespace: "HSCUSTOM" },
      ctx,
    );

    const url = mockHttp.delete.mock.calls[0]?.[0] as string;
    expect(url).toContain("namespace=HSCUSTOM");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.delete.mockRejectedValue(
      new IrisApiError(400, [{ error: "Invalid" }], "/api/executemcp/v2/global", "Invalid global"),
    );

    const result = await globalKillTool.handler({ global: "Bad" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error deleting global");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.delete.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      globalKillTool.handler({ global: "TestGlobal" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (destructiveHint: true)", () => {
    expect(globalKillTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(globalKillTool.scope).toBe("NS");
  });
});

// ── iris_global_list ─────────────────────────────────────────────

describe("iris_global_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return list of globals with count", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ globals: ["CacheTemp", "ERRORS", "MyGlobal"], count: 3 }),
    );

    const result = await globalListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/global/list?"),
    );
    const url = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(url).toContain("namespace=USER");

    const structured = result.structuredContent as { globals: string[]; count: number };
    expect(structured.globals).toEqual(["CacheTemp", "ERRORS", "MyGlobal"]);
    expect(structured.count).toBe(3);
    expect(result.isError).toBeUndefined();
  });

  it("should pass filter when provided", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ globals: ["CacheTemp"], count: 1, filter: "Cache" }),
    );

    await globalListTool.handler({ filter: "Cache" }, ctx);

    const url = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(url).toContain("filter=Cache");
  });

  it("should forward namespace override", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ globals: [], count: 0 }),
    );

    await globalListTool.handler({ namespace: "HSCUSTOM" }, ctx);

    const url = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(url).toContain("namespace=HSCUSTOM");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/global/list", "Server error"),
    );

    const result = await globalListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing globals");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      globalListTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: true)", () => {
    expect(globalListTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(globalListTool.scope).toBe("NS");
  });

  it("should accept cursor parameter in schema", () => {
    const shape = globalListTool.inputSchema.shape as Record<string, unknown>;
    expect(shape).toHaveProperty("cursor");
  });

  it("should paginate results via ctx.paginate()", async () => {
    const globals = Array.from({ length: 5 }, (_, i) => `Global${i}`);
    mockHttp.get.mockResolvedValue(
      envelope({ globals, count: 5 }),
    );

    // Override paginate to simulate a page size of 2
    const paginatingCtx: ToolContext = {
      ...ctx,
      paginate<T>(items: T[], cursor?: string, _pageSize?: number): PaginateResult<T> {
        const offset = decodeCursor(cursor);
        const size = 2;
        const page = items.slice(offset, offset + size);
        const nextOffset = offset + size;
        const nextCursor =
          nextOffset < items.length ? encodeCursor(nextOffset) : undefined;
        return { page, nextCursor };
      },
    };

    const result = await globalListTool.handler({}, paginatingCtx);

    const structured = result.structuredContent as { globals: string[]; count: number; nextCursor?: string };
    expect(structured.globals).toEqual(["Global0", "Global1"]);
    expect(structured.count).toBe(2);
    expect(structured.nextCursor).toBeDefined();
  });

  it("should forward cursor to ctx.paginate()", async () => {
    const globals = Array.from({ length: 5 }, (_, i) => `Global${i}`);
    mockHttp.get.mockResolvedValue(
      envelope({ globals, count: 5 }),
    );

    const cursor = encodeCursor(2);

    // Override paginate to simulate a page size of 2 starting at offset 2
    const paginatingCtx: ToolContext = {
      ...ctx,
      paginate<T>(items: T[], cur?: string, _pageSize?: number): PaginateResult<T> {
        const offset = decodeCursor(cur);
        const size = 2;
        const page = items.slice(offset, offset + size);
        const nextOffset = offset + size;
        const nextCur =
          nextOffset < items.length ? encodeCursor(nextOffset) : undefined;
        return { page, nextCursor: nextCur };
      },
    };

    const result = await globalListTool.handler({ cursor }, paginatingCtx);

    const structured = result.structuredContent as { globals: string[]; count: number; nextCursor?: string };
    expect(structured.globals).toEqual(["Global2", "Global3"]);
    expect(structured.count).toBe(2);
    expect(structured.nextCursor).toBeDefined();
  });

  it("should omit nextCursor on last page", async () => {
    const globals = ["A", "B"];
    mockHttp.get.mockResolvedValue(
      envelope({ globals, count: 2 }),
    );

    // Default mock paginate returns all items with no nextCursor
    const result = await globalListTool.handler({}, ctx);

    const structured = result.structuredContent as { globals: string[]; count: number; nextCursor?: string };
    expect(structured.globals).toEqual(["A", "B"]);
    expect(structured.nextCursor).toBeUndefined();
  });

  it("should preserve filter field in paginated response", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ globals: ["CacheTemp"], count: 1, filter: "Cache" }),
    );

    const result = await globalListTool.handler({ filter: "Cache" }, ctx);

    const structured = result.structuredContent as { globals: string[]; count: number; filter?: string };
    expect(structured.filter).toBe("Cache");
  });
});
