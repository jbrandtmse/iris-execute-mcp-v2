/**
 * Story 28.3 — `iris_sql_analyze`'s `advise` action (SQL Performance Advisor
 * wiring). Covers the TS wiring ONLY: `ctx.http` is mocked throughout (no live
 * IRIS at test time). The heuristic engine itself (`analyzeAdviceData`) is
 * exhaustively tested in `sqlAdvisor.test.ts` (Story 28.2) against
 * reference-captured fixtures (Rule #36) — this suite re-imports a subset of
 * those SAME fixtures to prove the wiring passes data through the engine
 * correctly (right path, right body, right structuredContent shape), not to
 * re-derive the engine's own findings logic.
 *
 * Default vitest suite (`*.test.ts`), mocked HTTP — no live IRIS (AC 28.3.1).
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { sqlAnalyzeTool } from "../tools/sqlAnalyze.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";
import {
  ADVISE_DATA_UNINDEXED_BEFORE_TUNE,
  ADVISE_DATA_INDEXED_BEFORE_TUNE,
} from "./sqlAdvisor.fixtures.js";

type StructuredAdvise = {
  mode: "query" | "workload";
  findings: Array<{
    type: string;
    confidence: string;
    statement: string;
    evidence: string;
    recommendation: string;
    suggestedDdl?: string;
    planExcerpt: string;
  }>;
  analyzed: { statements: number; skipped: number };
  notes: string[];
};

const ADVISE_DATA_PATH = "/api/executemcp/v2/dev/sql/advise-data";
const ATELIER_QUERY_PATH = "/api/atelier/v7/USER/action/query";

describe("iris_sql_analyze — advise action (Story 28.3 wiring)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── validation (before any HTTP call) ──────────────────────────────

  it("rejects when neither 'query' nor 'workload' is supplied", async () => {
    const result = await sqlAnalyzeTool.handler({ action: "advise" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("requires either a 'query' parameter or 'workload: true'");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("rejects when both 'query' and 'workload' are supplied", async () => {
    const result = await sqlAnalyzeTool.handler(
      { action: "advise", query: "SELECT 1", workload: true },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("either 'query' or 'workload: true', not both");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("treats a whitespace-only 'query' as absent (workload still required)", async () => {
    const result = await sqlAnalyzeTool.handler({ action: "advise", query: "   " }, ctx);

    expect(result.isError).toBe(true);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // ── query mode ──────────────────────────────────────────────────────

  it("query mode: posts to /dev/sql/advise-data with {query, namespace} and returns findings", async () => {
    mockHttp.post.mockResolvedValue(envelope(ADVISE_DATA_UNINDEXED_BEFORE_TUNE));

    const result = await sqlAnalyzeTool.handler(
      {
        action: "advise",
        query: "SELECT ID, UnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE UnindexedCol = 'U7'",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    expect(mockHttp.post).toHaveBeenCalledWith(ADVISE_DATA_PATH, {
      query: "SELECT ID, UnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE UnindexedCol = 'U7'",
      namespace: "USER",
    });

    expect(result.isError).toBeUndefined();
    expect(Array.isArray(result.structuredContent)).toBe(false);
    const structured = result.structuredContent as StructuredAdvise;
    expect(structured.mode).toBe("query");
    expect(structured.analyzed).toEqual({ statements: 1, skipped: 0 });

    const types = structured.findings.map((f) => f.type);
    expect(types).toContain("full-scan");
    expect(types).toContain("missing-index");
    expect(types).toContain("stale-stats");
    const missingIndex = structured.findings.find((f) => f.type === "missing-index");
    expect(missingIndex?.suggestedDdl).toContain("CREATE INDEX");
    expect(missingIndex?.confidence).toBe("high");

    // Text is evidence-first and carries the advisory disclaimer.
    expect(result.content[0]?.text).toContain("Evidence:");
    expect(result.content[0]?.text).toContain(
      "Recommendations are heuristic; verify with 'explain' before applying any change.",
    );
  });

  it("query mode: text lists findings ranked by confidence (high before medium before low, stable within a tier)", async () => {
    // ADVISE_DATA_UNINDEXED_BEFORE_TUNE's engine output is emitted in this
    // insertion order: full-scan(medium), missing-index(high), stale-stats(low),
    // unused-index(low) — i.e. NOT already confidence-sorted. This proves the
    // wiring's own `rankByConfidence` step (AC 28.3.1 "ranked by confidence"),
    // which no other test in this suite asserts (they only check `.toContain`
    // membership, never relative order).
    mockHttp.post.mockResolvedValue(envelope(ADVISE_DATA_UNINDEXED_BEFORE_TUNE));

    const result = await sqlAnalyzeTool.handler(
      {
        action: "advise",
        query: "SELECT ID, UnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE UnindexedCol = 'U7'",
      },
      ctx,
    );

    const text = result.content[0]?.text ?? "";
    const highIdx = text.indexOf("[high] missing-index");
    const mediumIdx = text.indexOf("[medium] full-scan");
    const lowStaleIdx = text.indexOf("[low] stale-stats");
    const lowUnusedIdx = text.indexOf("[low] unused-index");

    expect(highIdx).toBeGreaterThan(-1);
    expect(mediumIdx).toBeGreaterThan(-1);
    expect(lowStaleIdx).toBeGreaterThan(-1);
    expect(lowUnusedIdx).toBeGreaterThan(-1);
    // high before medium before both lows; stable sort keeps stale-stats (engine
    // insertion order) ahead of unused-index within the low tier.
    expect(highIdx).toBeLessThan(mediumIdx);
    expect(mediumIdx).toBeLessThan(lowStaleIdx);
    expect(lowStaleIdx).toBeLessThan(lowUnusedIdx);
  });

  it("query mode: no finding on the properly-indexed column (engine pass-through, not re-derived)", async () => {
    mockHttp.post.mockResolvedValue(envelope(ADVISE_DATA_INDEXED_BEFORE_TUNE));

    const result = await sqlAnalyzeTool.handler(
      { action: "advise", query: "SELECT ID, IndexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE IndexedCol = 'I7'" },
      ctx,
    );

    const structured = result.structuredContent as StructuredAdvise;
    expect(structured.findings.some((f) => f.type === "missing-index")).toBe(false);
    expect(structured.findings.some((f) => f.type === "full-scan")).toBe(false);
  });

  it("query mode: zero findings renders an explicit 'no findings' text with what was checked (no silent empty)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ plan: "garbage nonsense, not a real plan", tables: [], indexes: [] }));

    const result = await sqlAnalyzeTool.handler({ action: "advise", query: "SELECT 1" }, ctx);

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as StructuredAdvise;
    expect(structured.findings).toEqual([]);
    expect(structured.notes).toContain("plan format not recognized");
    expect(result.content[0]?.text).toContain("No performance findings");
    expect(result.content[0]?.text).toContain("plan format not recognized");
    expect(result.content[0]?.text).toContain("Checked 1 statement");
  });

  it("query mode: a malformed/non-preparable query returns isError with the sanitized SQL error", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "SQLCODE -481: EXPLAIN does not support the following SQL statement type: UNKNOWN" }],
        ADVISE_DATA_PATH,
        "SQLCODE -481: EXPLAIN does not support the following SQL statement type: UNKNOWN",
      ),
    );

    const result = await sqlAnalyzeTool.handler({ action: "advise", query: "SELEKT GARBAGE" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("SQL error");
    expect(result.content[0]?.text).toContain("SQLCODE -481");
  });

  it("query mode: honors the namespace override", async () => {
    mockHttp.post.mockResolvedValue(envelope(ADVISE_DATA_UNINDEXED_BEFORE_TUNE));

    await sqlAnalyzeTool.handler(
      { action: "advise", query: "SELECT 1", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(ADVISE_DATA_PATH, {
      query: "SELECT 1",
      namespace: "HSCUSTOM",
    });
  });

  // ── workload mode ───────────────────────────────────────────────────

  /** Route the shared `mockHttp.post` mock by target path (workload mode
   *  makes TWO distinct kinds of calls: the outer statements query via the
   *  Atelier `action/query` path, then one `advise-data` call per
   *  statement). */
  function routeWorkloadCalls(options: {
    statements: Array<string | undefined>;
    adviseDataForStatement?: (query: string) => unknown;
    failForStatement?: (query: string) => boolean;
  }): void {
    mockHttp.post.mockImplementation(async (path: unknown, body: unknown) => {
      const p = String(path);
      if (p === ATELIER_QUERY_PATH) {
        return envelope({ content: options.statements.map((s) => ({ Statement: s })) });
      }
      if (p === ADVISE_DATA_PATH) {
        const query = (body as { query: string }).query;
        if (options.failForStatement?.(query)) {
          throw new IrisApiError(400, [{ error: "SQLCODE -481" }], ADVISE_DATA_PATH, "SQLCODE -481");
        }
        const data = options.adviseDataForStatement?.(query) ?? ADVISE_DATA_UNINDEXED_BEFORE_TUNE;
        return envelope(data);
      }
      throw new Error(`unexpected path in workload test: ${p}`);
    });
  }

  it("workload mode: queries the top-N recent statements and advises + aggregates each", async () => {
    const stmt1 = "SELECT ID, UnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE UnindexedCol = ?";
    const stmt2 = "SELECT ID, IndexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE IndexedCol = ?";
    routeWorkloadCalls({
      statements: [stmt1, stmt2],
      adviseDataForStatement: (q) => (q === stmt1 ? ADVISE_DATA_UNINDEXED_BEFORE_TUNE : ADVISE_DATA_INDEXED_BEFORE_TUNE),
    });

    const result = await sqlAnalyzeTool.handler({ action: "advise", workload: true }, ctx);

    // First call: the outer recent-statement query, default topN=5.
    expect(mockHttp.post).toHaveBeenNthCalledWith(1, ATELIER_QUERY_PATH, {
      query: expect.stringContaining("SELECT TOP 5"),
    });
    expect((mockHttp.post.mock.calls[0]?.[1] as { query: string }).query).toContain(
      "FROM INFORMATION_SCHEMA.STATEMENTS ORDER BY Timestamp DESC",
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as StructuredAdvise;
    expect(structured.mode).toBe("workload");
    expect(structured.analyzed).toEqual({ statements: 2, skipped: 0 });
    // Aggregated across both statements: stmt1 contributes missing-index, stmt2 does not.
    expect(structured.findings.filter((f) => f.type === "missing-index")).toHaveLength(1);
    expect(Array.isArray(result.structuredContent)).toBe(false);
  });

  it("workload mode: a per-statement EXPLAIN failure is skipped, not fatal to the whole call", async () => {
    const stmtOk = "SELECT ID FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE UnindexedCol = ?";
    const stmtFails = "SET SOMETHING = 1"; // a form the platform can't EXPLAIN
    routeWorkloadCalls({
      statements: [stmtOk, stmtFails, undefined, "  "],
      failForStatement: (q) => q === stmtFails,
    });

    const result = await sqlAnalyzeTool.handler({ action: "advise", workload: true }, ctx);

    const structured = result.structuredContent as StructuredAdvise;
    // stmtOk analyzed; stmtFails skipped (server error); undefined + whitespace-only
    // rows skipped client-side without an HTTP call.
    expect(structured.analyzed).toEqual({ statements: 1, skipped: 3 });
    expect(result.isError).toBeUndefined();
  });

  it("workload mode: an UNEXPECTED (non-IrisApiError) per-statement failure propagates, not silently skipped", async () => {
    // The per-statement loop swallows ONLY IrisApiError (a statement that can't
    // prepare) as a `skip`. An unexpected error (transient connectivity, a
    // framework bug) must propagate so it is not masked as a benign "no
    // findings" — symmetric with `query` mode, which also rethrows non-
    // IrisApiError. A blanket `catch {}` would hide a total advise-data outage
    // as an empty result (CR 28.3-2 regression guard).
    const stmt = "SELECT 1";
    mockHttp.post.mockImplementation(async (path: unknown) => {
      const p = String(path);
      if (p === ATELIER_QUERY_PATH) {
        return envelope({ content: [{ Statement: stmt }] });
      }
      // A non-IrisApiError from the per-statement advise-data call.
      throw new Error("ECONNRESET");
    });

    await expect(
      sqlAnalyzeTool.handler({ action: "advise", workload: true }, ctx),
    ).rejects.toThrow("ECONNRESET");
  });

  it("workload mode: respects a custom topN", async () => {
    routeWorkloadCalls({ statements: [] });

    await sqlAnalyzeTool.handler({ action: "advise", workload: true, topN: 3 }, ctx);

    expect((mockHttp.post.mock.calls[0]?.[1] as { query: string }).query).toContain("SELECT TOP 3");
  });

  it("workload mode: a topN above the schema max is defensively clamped to 20 in the handler, never embedded raw in SQL", async () => {
    // The zod schema (`.max(20)`) would normally reject this before the handler
    // ever runs, but the handler ALSO re-clamps defensively (per the dev notes:
    // "belt-and-suspenders" against a value that reaches the handler outside the
    // schema path) because topN is embedded as a literal in `SELECT TOP <n>` SQL
    // text. Calling the handler directly (as every test in this file does)
    // bypasses the zod layer, so this is the only place that clamp is exercised.
    routeWorkloadCalls({ statements: [] });

    await sqlAnalyzeTool.handler({ action: "advise", workload: true, topN: 999 }, ctx);

    const sql = (mockHttp.post.mock.calls[0]?.[1] as { query: string }).query;
    expect(sql).toContain("SELECT TOP 20");
    expect(sql).not.toContain("999");
  });

  it("workload mode: a non-positive topN is defensively clamped up to 1 in the handler", async () => {
    routeWorkloadCalls({ statements: [] });

    await sqlAnalyzeTool.handler({ action: "advise", workload: true, topN: 0 }, ctx);

    const sql = (mockHttp.post.mock.calls[0]?.[1] as { query: string }).query;
    expect(sql).toContain("SELECT TOP 1");
  });

  it("workload mode: a fractional topN is floored before embedding in SQL (never `SELECT TOP 3.7`)", async () => {
    // The zod schema (`.int()`) rejects fractionals on the real MCP path; the
    // handler's defensive floor+finite guard covers a value reaching the
    // handler outside zod (as direct handler calls do). CR 28.3-3 guard.
    routeWorkloadCalls({ statements: [] });

    await sqlAnalyzeTool.handler({ action: "advise", workload: true, topN: 3.7 as number }, ctx);

    const sql = (mockHttp.post.mock.calls[0]?.[1] as { query: string }).query;
    expect(sql).toContain("SELECT TOP 3");
    expect(sql).not.toContain("3.7");
  });

  it("workload mode: a NaN topN falls back to the default (never `SELECT TOP NaN`)", async () => {
    routeWorkloadCalls({ statements: [] });

    await sqlAnalyzeTool.handler({ action: "advise", workload: true, topN: Number.NaN }, ctx);

    const sql = (mockHttp.post.mock.calls[0]?.[1] as { query: string }).query;
    expect(sql).toContain(`SELECT TOP ${5}`);
    expect(sql).not.toContain("NaN");
  });

  it("workload mode: zero statements returned still succeeds with analyzed:{0,0}", async () => {
    routeWorkloadCalls({ statements: [] });

    const result = await sqlAnalyzeTool.handler({ action: "advise", workload: true }, ctx);

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as StructuredAdvise;
    expect(structured.analyzed).toEqual({ statements: 0, skipped: 0 });
    expect(structured.findings).toEqual([]);
    expect(result.content[0]?.text).toContain("No performance findings");
  });

  it("workload mode: an unavailable statement-workload source returns a clear capability error, never a raw dump", async () => {
    mockHttp.post.mockImplementation(async (path: unknown) => {
      const p = String(path);
      if (p === ATELIER_QUERY_PATH) {
        throw new IrisApiError(
          400,
          [{ error: "SQLCODE -30 - Table 'INFORMATION_SCHEMA.STATEMENTS' not found" }],
          ATELIER_QUERY_PATH,
          "SQLCODE -30 - Table 'INFORMATION_SCHEMA.STATEMENTS' not found",
        );
      }
      throw new Error(`unexpected path: ${p}`);
    });

    const result = await sqlAnalyzeTool.handler({ action: "advise", workload: true }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Workload mode is unavailable");
    expect(result.content[0]?.text).toContain("Try 'query' mode");
    // Never a raw SQLCODE/bracket dump with no framing text.
    expect(result.content[0]?.text.startsWith("SQLCODE")).toBe(false);
  });

  it("workload mode: honors the namespace override on both the outer query and per-statement advise call", async () => {
    const stmt = "SELECT 1";
    mockHttp.post.mockImplementation(async (path: unknown, body: unknown) => {
      const p = String(path);
      if (p.endsWith("/action/query")) {
        return envelope({ content: [{ Statement: stmt }] });
      }
      if (p === ADVISE_DATA_PATH) {
        expect((body as { namespace: string }).namespace).toBe("HSCUSTOM");
        return envelope(ADVISE_DATA_UNINDEXED_BEFORE_TUNE);
      }
      throw new Error(`unexpected path: ${p}`);
    });

    await sqlAnalyzeTool.handler({ action: "advise", workload: true, namespace: "HSCUSTOM" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/action/query",
      expect.objectContaining({ query: expect.any(String) }),
    );
  });
});
