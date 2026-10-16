import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { sqlExecuteTool } from "../tools/sql.js";
import { createMockHttp, createMockCtx } from "./test-helpers.js";
import { LEGACY_CASES } from "./sql-legacy-cases.js";
import { SQL_PATH, endpointBody, executed } from "./sql-test-support.js";

// ── iris_sql_execute ──────────────────────────────────────────────

describe("iris_sql_execute", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return columns and rows from SQL query", async () => {
    // The endpoint returns result.content as an array of row objects
    mockHttp.post.mockResolvedValue(
      executed([
        { ID: 1, Name: "Smith", DOB: "1990-01-01" },
        { ID: 2, Name: "Jones", DOB: "1985-06-15" },
      ]),
    );

    const result = await sqlExecuteTool.handler({ query: "SELECT ID, Name, DOB FROM Sample.Person" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      SQL_PATH,
      endpointBody("SELECT ID, Name, DOB FROM Sample.Person"),
    );

    const structured = result.structuredContent as {
      columns: string[];
      rows: unknown[][];
      rowCount: number;
    };
    expect(structured.columns).toEqual(["ID", "Name", "DOB"]);
    expect(structured.rows).toHaveLength(2);
    expect(structured.rows[0]).toEqual([1, "Smith", "1990-01-01"]);
    expect(structured.rowCount).toBe(2);
    expect(result.isError).toBeUndefined();
  });

  it("should pass parameters correctly for parameterized queries", async () => {
    mockHttp.post.mockResolvedValue(
      executed([{ ID: 1, Name: "Smith" }]),
    );

    await sqlExecuteTool.handler(
      { query: "SELECT ID, Name FROM Sample.Person WHERE ID = ?", parameters: [1] },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      SQL_PATH,
      endpointBody("SELECT ID, Name FROM Sample.Person WHERE ID = ?", { parameters: [1] }),
    );
  });

  it("should limit results when maxRows is specified", async () => {
    const manyRows = Array.from({ length: 50 }, (_, i) => ({ ID: i, Name: `Name${i}` }));
    mockHttp.post.mockResolvedValue(executed(manyRows));

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
    const manyRows = Array.from({ length: 1500 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(executed(manyRows));

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
        SQL_PATH,
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

  it("keeps the SQLCODE and the IRIS message in the error text of the SQL endpoint (decision #12)", async () => {
    // What IrisHttpClient throws for the endpoint's error envelope for `SELEC 1` (captured live, 2026-10-15):
    // a negative-SQLCODE statement error, sanitized on the IRIS side to ERROR #5001.
    const error = new IrisApiError(
      200,
      [{ error: "ERROR #5001: SQLCODE: -51 Message:  An SQL statement expected, IDENTIFIER found" }],
      SQL_PATH,
      `IRIS reported errors for POST ${SQL_PATH}. Review the error details and correct the request.`,
    );
    mockHttp.post.mockRejectedValue(error);

    const result = await sqlExecuteTool.handler({ query: "SELEC 1" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(`SQL error: ${error.message}`);
    expect(result.content[0]?.text).toContain("SQLCODE: -51");
    expect(result.content[0]?.text).toContain("An SQL statement expected, IDENTIFIER found");
    expect(result.content[0]?.text).toContain("/api/executemcp/v2/dev/sql/execute");
  });

  it("should use namespace override when provided", async () => {
    mockHttp.post.mockResolvedValue(
      executed([{ ID: 1 }]),
    );

    await sqlExecuteTool.handler(
      { query: "SELECT 1", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      SQL_PATH,
      endpointBody("SELECT 1", {}, "HSCUSTOM"),
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
      executed([{ ID: 1 }]),
    );

    await sqlExecuteTool.handler({ query: "SELECT 1", parameters: [] }, ctx);

    const calledBody = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(calledBody).toEqual(endpointBody("SELECT 1"));
    expect(calledBody).not.toHaveProperty("parameters");
  });

  it("should not include parameters in body when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      executed([{ ID: 1 }]),
    );

    await sqlExecuteTool.handler({ query: "SELECT 1" }, ctx);

    const calledBody = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(calledBody).toEqual(endpointBody("SELECT 1"));
    expect(calledBody).not.toHaveProperty("parameters");
  });

  // ── SQL resource caps (Story 24.2, AC 24.2.1) ────────────────────

  it("should be byte-for-byte unchanged when IRIS_SQL_MAX_ROWS/IRIS_SQL_TIMEOUT are unset (Rule #19 no-op)", async () => {
    // createMockCtx's default config carries neither sqlMaxRows nor
    // sqlTimeoutMs, mirroring loadConfig's output when the env vars are unset.
    const manyRows = Array.from({ length: 50 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(executed(manyRows));

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person", maxRows: 10 },
      ctx,
    );

    // Exactly 2 args — no timeout options object passed at all.
    expect(mockHttp.post).toHaveBeenCalledWith(
      SQL_PATH,
      endpointBody("SELECT ID FROM Sample.Person"),
    );
    expect(mockHttp.post.mock.calls[0]).toHaveLength(2);

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).not.toHaveProperty("rowsCapped");
    expect(structured.rowCount).toBe(10);
  });

  it("should set rowsCapped: true and clamp rows when IRIS_SQL_MAX_ROWS is below the caller's requested maxRows", async () => {
    const manyRows = Array.from({ length: 50 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(executed(manyRows));
    ctx = { ...ctx, config: { ...ctx.config, sqlMaxRows: 5 } };

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person", maxRows: 20 },
      ctx,
    );

    const structured = result.structuredContent as {
      rows: unknown[][];
      rowCount: number;
      rowsCapped?: boolean;
      truncated?: boolean;
      totalAvailable?: number;
    };
    expect(structured.rowCount).toBe(5);
    expect(structured.rows).toHaveLength(5);
    expect(structured.rowsCapped).toBe(true);
    // truncated/totalAvailable are distinct and still present (more rows exist).
    expect(structured.truncated).toBe(true);
    expect(structured.totalAvailable).toBe(50);
  });

  it("should NOT set rowsCapped when IRIS_SQL_MAX_ROWS is above the caller's requested maxRows", async () => {
    const manyRows = Array.from({ length: 50 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(executed(manyRows));
    ctx = { ...ctx, config: { ...ctx.config, sqlMaxRows: 1000 } };

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person", maxRows: 20 },
      ctx,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).not.toHaveProperty("rowsCapped");
    expect(structured.rowCount).toBe(20);
  });

  it("should NOT set rowsCapped when IRIS_SQL_MAX_ROWS clamps only the DEFAULT_MAX_ROWS (no explicit maxRows) but does not reduce it below what's requested", async () => {
    // cap === requested (not < requested) -> rowsCapped must be false per spec.
    const manyRows = Array.from({ length: 2000 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(executed(manyRows));
    ctx = { ...ctx, config: { ...ctx.config, sqlMaxRows: 1000 } };

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person" },
      ctx,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).not.toHaveProperty("rowsCapped");
    expect(structured.rowCount).toBe(1000);
  });

  it("should forward IRIS_SQL_TIMEOUT as the http.post timeout option (ms)", async () => {
    mockHttp.post.mockResolvedValue(executed([{ ID: 1 }]));
    ctx = { ...ctx, config: { ...ctx.config, sqlTimeoutMs: 15_000 } };

    await sqlExecuteTool.handler({ query: "SELECT 1" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      SQL_PATH,
      endpointBody("SELECT 1"),
      { timeout: 15_000 },
    );
  });

  it("should handle empty result set gracefully", async () => {
    mockHttp.post.mockResolvedValue(
      executed([]),
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
    // Empty content array means no rows, so columns are derived as empty
    expect(structured.columns).toEqual([]);
    expect(structured.rows).toHaveLength(0);
    expect(structured.rowCount).toBe(0);
    expect(result.isError).toBeUndefined();
  });
});

// -- AD-15: a call that uses no Story 38.5 control returns today's result --

describe("iris_sql_execute with no Story 38.5 control returns the pre-feature result (AD-15, AC-5)", () => {
  for (const legacy of LEGACY_CASES) {
    it(`${legacy.id}: structuredContent and text equal the pre-feature literal`, async () => {
      const mockHttp = createMockHttp();
      const base = createMockCtx(mockHttp);
      const ctx: ToolContext = { ...base, config: { ...base.config, ...legacy.config } };
      mockHttp.post.mockResolvedValue(executed(legacy.rows));

      const result = await sqlExecuteTool.handler(legacy.args, ctx);

      expect(result.isError).toBeUndefined();
      expect(result.structuredContent).toEqual(legacy.expected);
      expect(result.content).toEqual([{ type: "text", text: JSON.stringify(legacy.expected, null, 2) }]);
      expect(Object.keys(result.structuredContent as object)).toEqual(Object.keys(legacy.expected));
    });
  }
});
