/**
 * Story 28.3, AC 28.3.2 (Rule #19) — the four PRE-EXISTING `iris_sql_analyze`
 * actions (`explain`, `stats`, `indexUsage`, `running`) must be byte-for-byte
 * unchanged by the addition of the new `advise` action.
 *
 * `sqlAnalyze.test.ts` and `sqlAnalyze-e2e.test.ts` already assert each
 * action's behavior in detail; this suite is the DEDICATED Rule #19 gate
 * AC 28.3.2 calls for — one full-object `toEqual` snapshot per action,
 * fixed inputs, locked against the exact output shape as it existed before
 * this story. A regression here means Story 28.3's `advise` wiring altered
 * behavior it was never supposed to touch.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { sqlAnalyzeTool } from "../tools/sqlAnalyze.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

describe("iris_sql_analyze — Rule #19 byte-for-byte snapshot of the four pre-existing actions", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  const PLAN_TEXT =
    "<plans>\n <plan>\n   SQL:\n    SELECT TOP ? * FROM Ens_Config . Item\n   Cost: 1020\n   " +
    "Module-FIRST:\n     Read master map Ens_Config.Item.IDKEY, looping on ID.\n     " +
    "Read index map Sample.Person.NameIDX, looping on Name.\n </plan>\n</plans>";

  it("explain: exact request + response shape", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [{ Plan: PLAN_TEXT }] }));

    const result = await sqlAnalyzeTool.handler(
      { action: "explain", query: "SELECT TOP 1 * FROM Ens_Config.Item" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect(mockHttp.post).toHaveBeenCalledWith("/api/atelier/v7/USER/action/query", {
      query: "EXPLAIN SELECT TOP 1 * FROM Ens_Config.Item",
    });
    expect(result).toEqual({
      content: [{ type: "text", text: PLAN_TEXT }],
      structuredContent: { action: "explain", plan: PLAN_TEXT },
    });
  });

  it("indexUsage: exact request + response shape", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [{ Plan: PLAN_TEXT }] }));

    const result = await sqlAnalyzeTool.handler(
      { action: "indexUsage", query: "SELECT TOP 1 * FROM Ens_Config.Item" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect(mockHttp.post).toHaveBeenCalledWith("/api/atelier/v7/USER/action/query", {
      query: "EXPLAIN SELECT TOP 1 * FROM Ens_Config.Item",
    });
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Indexes/maps read:\n  - Ens_Config.Item.IDKEY\n  - Sample.Person.NameIDX",
        },
      ],
      structuredContent: {
        action: "indexUsage",
        indexes: ["Ens_Config.Item.IDKEY", "Sample.Person.NameIDX"],
        plan: PLAN_TEXT,
      },
    });
  });

  it("stats: exact request + response shape (no filter)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ Hash: "abc", StatCount: 1, StatTotal: 0.000478, StatAverage: 0.000478 }] }),
    );

    const result = await sqlAnalyzeTool.handler({ action: "stats" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect(mockHttp.post).toHaveBeenCalledWith("/api/atelier/v7/USER/action/query", {
      query:
        "SELECT Hash, Statement, StatCount, StatTotal, StatAverage, StatStdDev, StatRowCount, Timestamp " +
        "FROM INFORMATION_SCHEMA.STATEMENTS",
    });
    const structured = {
      action: "stats",
      columns: ["Hash", "StatCount", "StatTotal", "StatAverage"],
      rows: [["abc", 1, 0.000478, 0.000478]],
      rowCount: 1,
    };
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
      structuredContent: structured,
    });
  });

  it("running: exact request + response shape (with a filter)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ SQLStatementID: 1, UserName: "_SYSTEM", Status: "Executing" }] }),
    );

    const result = await sqlAnalyzeTool.handler({ action: "running", filter: "Al'ice" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect(mockHttp.post).toHaveBeenCalledWith("/api/atelier/v7/USER/action/query", {
      query:
        "SELECT * FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS WHERE UPPER(UserName) LIKE '%' || " +
        "UPPER('Al''ice') || '%' ESCAPE '\\'",
    });
    const structured = {
      action: "running",
      columns: ["SQLStatementID", "UserName", "Status"],
      rows: [[1, "_SYSTEM", "Executing"]],
      rowCount: 1,
    };
    expect(result).toEqual({
      content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
      structuredContent: structured,
    });
  });

  it("explain: missing-query error shape unchanged", async () => {
    const result = await sqlAnalyzeTool.handler({ action: "explain" }, ctx);

    expect(result).toEqual({
      content: [{ type: "text", text: "'explain' requires a 'query' parameter." }],
      isError: true,
    });
    expect(mockHttp.post).not.toHaveBeenCalled();
  });
});
