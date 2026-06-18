import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { sqlAnalyzeTool } from "../tools/sqlAnalyze.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── iris_sql_analyze ──────────────────────────────────────────────

describe("iris_sql_analyze", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // Sample EXPLAIN plan text (mirrors the live HSCUSTOM shape).
  const PLAN_TEXT =
    "<plans>\n <plan>\n   SQL:\n    SELECT TOP ? * FROM Ens_Config . Item\n   Cost: 1020\n   " +
    "Module-FIRST:\n     Read master map Ens_Config.Item.IDKEY, looping on ID.\n     " +
    "Read index map Sample.Person.NameIDX, looping on Name.\n </plan>\n</plans>";

  // ── metadata ────────────────────────────────────────────────────

  it("should have name iris_sql_analyze and scope NS", () => {
    expect(sqlAnalyzeTool.name).toBe("iris_sql_analyze");
    expect(sqlAnalyzeTool.scope).toBe("NS");
  });

  it("should declare all four actions as read in `mutates`", () => {
    expect(sqlAnalyzeTool.mutates).toEqual({
      explain: "read",
      stats: "read",
      indexUsage: "read",
      running: "read",
    });
  });

  it("should have read-only annotations", () => {
    expect(sqlAnalyzeTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  // ── explain ─────────────────────────────────────────────────────

  it("explain: builds `EXPLAIN <query>` and returns { action, plan }", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [{ Plan: PLAN_TEXT }] }));

    const result = await sqlAnalyzeTool.handler(
      { action: "explain", query: "SELECT TOP 1 * FROM Ens_Config.Item" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/query",
      { query: "EXPLAIN SELECT TOP 1 * FROM Ens_Config.Item" },
    );

    const structured = result.structuredContent as { action: string; plan: string };
    expect(structured.action).toBe("explain");
    expect(structured.plan).toBe(PLAN_TEXT);
    expect(Array.isArray(result.structuredContent)).toBe(false);
    expect(result.isError).toBeUndefined();
  });

  it("explain: missing query returns isError before any HTTP call", async () => {
    const result = await sqlAnalyzeTool.handler({ action: "explain" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("requires a 'query'");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // ── indexUsage ──────────────────────────────────────────────────

  it("indexUsage: runs EXPLAIN and parses maps/indexes from the plan text", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [{ Plan: PLAN_TEXT }] }));

    const result = await sqlAnalyzeTool.handler(
      { action: "indexUsage", query: "SELECT TOP 1 * FROM Ens_Config.Item" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/query",
      { query: "EXPLAIN SELECT TOP 1 * FROM Ens_Config.Item" },
    );

    const structured = result.structuredContent as {
      action: string;
      indexes: string[];
      plan: string;
    };
    expect(structured.action).toBe("indexUsage");
    expect(structured.indexes).toEqual([
      "Ens_Config.Item.IDKEY",
      "Sample.Person.NameIDX",
    ]);
    expect(structured.plan).toBe(PLAN_TEXT);
    expect(Array.isArray(result.structuredContent)).toBe(false);
  });

  it("indexUsage: missing query returns isError before any HTTP call", async () => {
    const result = await sqlAnalyzeTool.handler({ action: "indexUsage" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("requires a 'query'");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("indexUsage: empty plan yields an empty indexes array (no throw)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [{ Plan: "no maps here" }] }));

    const result = await sqlAnalyzeTool.handler(
      { action: "indexUsage", query: "SELECT 1" },
      ctx,
    );

    const structured = result.structuredContent as { indexes: string[] };
    expect(structured.indexes).toEqual([]);
  });

  // ── running ─────────────────────────────────────────────────────

  it("running: selects from underscored CURRENT_STATEMENTS and shapes a tabular object", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        content: [
          { SQLStatementID: 1, UserName: "_SYSTEM", Status: "Executing" },
          { SQLStatementID: 2, UserName: "Alice", Status: "Executing" },
        ],
      }),
    );

    const result = await sqlAnalyzeTool.handler({ action: "running" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/query",
      { query: "SELECT * FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS" },
    );

    const structured = result.structuredContent as {
      action: string;
      columns: string[];
      rows: unknown[][];
      rowCount: number;
    };
    expect(structured.action).toBe("running");
    expect(structured.columns).toEqual(["SQLStatementID", "UserName", "Status"]);
    expect(structured.rows).toHaveLength(2);
    expect(structured.rows[0]).toEqual([1, "_SYSTEM", "Executing"]);
    expect(structured.rowCount).toBe(2);
    expect(Array.isArray(result.structuredContent)).toBe(false);
  });

  it("running: a filter adds a case-insensitive UserName LIKE predicate (escaped)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    await sqlAnalyzeTool.handler({ action: "running", filter: "Al'ice" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/query",
      {
        query:
          "SELECT * FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS WHERE UPPER(UserName) LIKE '%' || UPPER('Al''ice') || '%' ESCAPE '\\'",
      },
    );
  });

  it("running: respects maxRows and reports truncation", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ SQLStatementID: i }));
    mockHttp.post.mockResolvedValue(envelope({ content: many }));

    const result = await sqlAnalyzeTool.handler(
      { action: "running", maxRows: 10 },
      ctx,
    );

    const structured = result.structuredContent as {
      rowCount: number;
      truncated: boolean;
      totalAvailable: number;
    };
    expect(structured.rowCount).toBe(10);
    expect(structured.truncated).toBe(true);
    expect(structured.totalAvailable).toBe(50);
  });

  // ── stats ───────────────────────────────────────────────────────

  it("stats: selects from underscored STATEMENTS and shapes a tabular object", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        content: [
          { Hash: "abc", StatCount: 1, StatTotal: 0.000478, StatAverage: 0.000478 },
        ],
      }),
    );

    const result = await sqlAnalyzeTool.handler({ action: "stats" }, ctx);

    const calledBody = mockHttp.post.mock.calls[0]?.[1] as { query: string };
    expect(calledBody.query).toContain("FROM INFORMATION_SCHEMA.STATEMENTS");
    expect(calledBody.query).toContain("StatCount");
    expect(calledBody.query).not.toContain("WHERE");

    const structured = result.structuredContent as {
      action: string;
      columns: string[];
      rowCount: number;
    };
    expect(structured.action).toBe("stats");
    expect(structured.columns).toEqual(["Hash", "StatCount", "StatTotal", "StatAverage"]);
    expect(structured.rowCount).toBe(1);
    expect(Array.isArray(result.structuredContent)).toBe(false);
  });

  it("stats: a filter adds a case-insensitive Statement LIKE predicate", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    await sqlAnalyzeTool.handler({ action: "stats", filter: "Sample.Person" }, ctx);

    const calledBody = mockHttp.post.mock.calls[0]?.[1] as { query: string };
    expect(calledBody.query).toContain(
      "WHERE UPPER(Statement) LIKE '%' || UPPER('Sample.Person') || '%' ESCAPE '\\'",
    );
  });

  // ── namespace + error paths ─────────────────────────────────────

  it("uses the namespace override when provided", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [{ Plan: PLAN_TEXT }] }));

    await sqlAnalyzeTool.handler(
      { action: "explain", query: "SELECT 1", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/action/query",
      { query: "EXPLAIN SELECT 1" },
    );
  });

  it("returns isError:true with the SQL error message on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "SQLCODE: -30 - Table 'INFORMATION_SCHEMA.CURRENTSTATEMENTS' not found" }],
        "/api/atelier/v7/USER/action/query",
        "SQLCODE: -30 - Table 'INFORMATION_SCHEMA.CURRENTSTATEMENTS' not found",
      ),
    );

    const result = await sqlAnalyzeTool.handler({ action: "running" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("SQL error");
    expect(result.content[0]?.text).toContain("SQLCODE: -30");
  });

  it("propagates non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      sqlAnalyzeTool.handler({ action: "stats" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });
});
