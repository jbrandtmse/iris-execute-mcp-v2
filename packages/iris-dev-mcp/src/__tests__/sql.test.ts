import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IrisHttpClient, ToolContext, IrisConnectionConfig, AtelierEnvelope } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { sqlExecuteTool } from "../tools/sql.js";

// ── Helpers ─────────────────────────────────────────────────────────

function createMockHttp() {
  return {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    post: vi.fn(),
    head: vi.fn(),
  } as unknown as IrisHttpClient & {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
    head: ReturnType<typeof vi.fn>;
  };
}

function createMockCtx(http: IrisHttpClient): ToolContext {
  return {
    resolveNamespace: (override?: string) => override ?? "USER",
    http,
    atelierVersion: 7,
    config: {
      host: "localhost",
      port: 52773,
      username: "_SYSTEM",
      password: "SYS",
      namespace: "USER",
      https: false,
      baseUrl: "http://localhost:52773",
    } as IrisConnectionConfig,
  };
}

function envelope<T>(result: T, console: string[] = []): AtelierEnvelope<T> {
  return {
    status: { errors: [] },
    console,
    result,
  };
}

// ── iris.sql.execute ──────────────────────────────────────────────

describe("iris.sql.execute", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return columns and rows from SQL query", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        content: [
          {
            columns: ["ID", "Name", "DOB"],
            rows: [
              [1, "Smith", "1990-01-01"],
              [2, "Jones", "1985-06-15"],
            ],
          },
        ],
      }),
    );

    const result = await sqlExecuteTool.handler({ query: "SELECT ID, Name, DOB FROM Sample.Person" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/query",
      { query: "SELECT ID, Name, DOB FROM Sample.Person" },
    );

    const structured = result.structuredContent as {
      columns: string[];
      rows: unknown[][];
      rowCount: number;
    };
    expect(structured.columns).toEqual(["ID", "Name", "DOB"]);
    expect(structured.rows).toHaveLength(2);
    expect(structured.rowCount).toBe(2);
    expect(result.isError).toBeUndefined();
  });

  it("should pass parameters correctly for parameterized queries", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        content: [
          {
            columns: ["ID", "Name"],
            rows: [[1, "Smith"]],
          },
        ],
      }),
    );

    await sqlExecuteTool.handler(
      { query: "SELECT ID, Name FROM Sample.Person WHERE ID = ?", parameters: [1] },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/query",
      { query: "SELECT ID, Name FROM Sample.Person WHERE ID = ?", parameters: [1] },
    );
  });

  it("should limit results when maxRows is specified", async () => {
    const manyRows = Array.from({ length: 50 }, (_, i) => [i, `Name${i}`]);
    mockHttp.post.mockResolvedValue(
      envelope({
        content: [
          {
            columns: ["ID", "Name"],
            rows: manyRows,
          },
        ],
      }),
    );

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID, Name FROM Sample.Person", maxRows: 10 },
      ctx,
    );

    const structured = result.structuredContent as {
      rows: unknown[][];
      rowCount: number;
      truncated: boolean;
      totalAvailable: number;
    };
    expect(structured.rows).toHaveLength(10);
    expect(structured.rowCount).toBe(10);
    expect(structured.truncated).toBe(true);
    expect(structured.totalAvailable).toBe(50);
  });

  it("should apply default maxRows limit of 1000", async () => {
    const manyRows = Array.from({ length: 1500 }, (_, i) => [i]);
    mockHttp.post.mockResolvedValue(
      envelope({
        content: [
          {
            columns: ["ID"],
            rows: manyRows,
          },
        ],
      }),
    );

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person" },
      ctx,
    );

    const structured = result.structuredContent as {
      rows: unknown[][];
      rowCount: number;
      truncated: boolean;
    };
    expect(structured.rows).toHaveLength(1000);
    expect(structured.truncated).toBe(true);
  });

  it("should return isError: true with SQL error message for invalid SQL", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "SQLCODE: -30 - Table 'NONEXISTENT' not found" }],
        "/api/atelier/v7/USER/action/query",
        "SQLCODE: -30 - Table 'NONEXISTENT' not found",
      ),
    );

    const result = await sqlExecuteTool.handler(
      { query: "SELECT * FROM NONEXISTENT" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("SQL error");
    expect(result.content[0]?.text).toContain("NONEXISTENT");
  });

  it("should use namespace override when provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ columns: ["ID"], rows: [[1]] }] }),
    );

    await sqlExecuteTool.handler(
      { query: "SELECT 1", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/action/query",
      { query: "SELECT 1" },
    );
  });

  it("should have correct annotations (readOnlyHint: false)", () => {
    expect(sqlExecuteTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(sqlExecuteTool.scope).toBe("NS");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      sqlExecuteTool.handler({ query: "SELECT 1" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should not include parameters in body when parameters is empty array", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ columns: ["ID"], rows: [[1]] }] }),
    );

    await sqlExecuteTool.handler({ query: "SELECT 1", parameters: [] }, ctx);

    const calledBody = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(calledBody).toEqual({ query: "SELECT 1" });
    expect(calledBody).not.toHaveProperty("parameters");
  });

  it("should not include parameters in body when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ columns: ["ID"], rows: [[1]] }] }),
    );

    await sqlExecuteTool.handler({ query: "SELECT 1" }, ctx);

    const calledBody = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(calledBody).toEqual({ query: "SELECT 1" });
    expect(calledBody).not.toHaveProperty("parameters");
  });

  it("should handle empty result set gracefully", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        content: [
          {
            columns: ["ID", "Name"],
            rows: [],
          },
        ],
      }),
    );

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID, Name FROM Sample.Person WHERE 1=0" },
      ctx,
    );

    const structured = result.structuredContent as {
      columns: string[];
      rows: unknown[][];
      rowCount: number;
    };
    expect(structured.columns).toEqual(["ID", "Name"]);
    expect(structured.rows).toHaveLength(0);
    expect(structured.rowCount).toBe(0);
    expect(result.isError).toBeUndefined();
  });
});
