/**
 * Story 17.3 — E2E coverage for `iris_sql_analyze` (QA, Quinn).
 *
 * This suite complements (does NOT duplicate) `sqlAnalyze.test.ts` (per-action
 * happy paths, basic shape, basic filter, namespace, error paths) and
 * `sqlAnalyze-governance.test.ts` (real-gate defaults). It fills the genuine
 * remaining COVERAGE GAPS the dev tests do not assert:
 *
 * 1. UNDERSCORED INFORMATION_SCHEMA table-name regression guards — an explicit
 *    NEGATIVE assertion that the no-underscore form (`CURRENTSTATEMENTS`) is
 *    absent from the built SQL. A regression to the no-underscore name returns
 *    `SQLCODE -30` live (`17-0-api-probes.md` DISCREPANCY #2), which mocked-HTTP
 *    happy-path tests cannot catch. (AC 17.3.2)
 * 2. `indexUsage` plan-text parser branches the dev test does not exercise:
 *    `bitmap`, `temp-file`, and bare `map` reference forms, plus de-duplication
 *    of a repeated index. (AC 17.3.3)
 * 3. `stats` single-quote escaping (SQL-injection-ish safety) — the dev test
 *    asserts escaping only for `running`; the identical `$Replace`-style escape
 *    on the `stats` filter path is otherwise unverified. (AC 17.3.3)
 * 4. `stats` maxRows truncation — the dev test exercises `maxRows` only for
 *    `running`; this confirms the shared `toTabular` limit also applies on the
 *    `stats` path. (AC 17.3.3)
 * 5. `explain`/`indexUsage` plan column absent/null → empty plan string, no
 *    throw. (AC 17.3.3)
 *
 * DEFAULT vitest suite (`*.test.ts`), mocked HTTP — no live IRIS.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { sqlAnalyzeTool } from "../tools/sqlAnalyze.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

describe("iris_sql_analyze (E2E coverage — Story 17.3)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  /** Read the `query` string the handler posted to the Atelier endpoint. */
  function postedQuery(): string {
    return (mockHttp.post.mock.calls[0]?.[1] as { query: string }).query;
  }

  // ── 1. Underscored table-name regression guards (AC 17.3.2) ──────────

  it("running: built SQL keeps the underscore in CURRENT_STATEMENTS (not the SQLCODE -30 form)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    await sqlAnalyzeTool.handler({ action: "running" }, ctx);

    const query = postedQuery();
    // POSITIVE: the underscored form is present.
    expect(query).toContain("INFORMATION_SCHEMA.CURRENT_STATEMENTS");
    // NEGATIVE regression guard: the no-underscore form (which returns
    // SQLCODE -30 live) must NOT appear.
    expect(query).not.toContain("CURRENTSTATEMENTS");
  });

  it("running: the underscore survives even when a filter is appended", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    await sqlAnalyzeTool.handler({ action: "running", filter: "alice" }, ctx);

    const query = postedQuery();
    expect(query).toContain("INFORMATION_SCHEMA.CURRENT_STATEMENTS");
    expect(query).not.toContain("CURRENTSTATEMENTS");
  });

  it("stats: built SQL targets INFORMATION_SCHEMA.STATEMENTS exactly", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    await sqlAnalyzeTool.handler({ action: "stats" }, ctx);

    const query = postedQuery();
    expect(query).toContain("FROM INFORMATION_SCHEMA.STATEMENTS");
  });

  // ── 2. indexUsage parser branches + dedup (AC 17.3.3) ────────────────

  it("indexUsage: parses bitmap / temp-file / bare-map plan references", async () => {
    const plan =
      "Read bitmap index map Sample.Person.GenderBM, looping on Gender.\n" +
      "Build temp-file Sample.Tmp1 from rows.\n" +
      "Read map Sample.Person.Data, looping on ID.";
    mockHttp.post.mockResolvedValue(envelope({ content: [{ Plan: plan }] }));

    const result = await sqlAnalyzeTool.handler(
      { action: "indexUsage", query: "SELECT * FROM Sample.Person" },
      ctx,
    );

    const structured = result.structuredContent as { indexes: string[] };
    // bitmap → GenderBM, temp-file → Tmp1, bare map → Data. (Order = first-seen.)
    expect(structured.indexes).toContain("Sample.Person.GenderBM");
    expect(structured.indexes).toContain("Sample.Tmp1");
    expect(structured.indexes).toContain("Sample.Person.Data");
  });

  it("indexUsage: de-duplicates a map referenced multiple times (first-seen order)", async () => {
    const plan =
      "Read master map Sample.Person.IDKEY, looping on ID.\n" +
      "Read master map Sample.Person.IDKEY, looping on ID.\n" +
      "Read index map Sample.Person.NameIDX, looping on Name.";
    mockHttp.post.mockResolvedValue(envelope({ content: [{ Plan: plan }] }));

    const result = await sqlAnalyzeTool.handler(
      { action: "indexUsage", query: "SELECT 1" },
      ctx,
    );

    const structured = result.structuredContent as { indexes: string[] };
    expect(structured.indexes).toEqual([
      "Sample.Person.IDKEY",
      "Sample.Person.NameIDX",
    ]);
  });

  // ── 3. stats filter quote-escaping — injection-ish safety (AC 17.3.3) ─

  it("stats: a filter with a single quote is escaped (doubled) in the LIKE predicate", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    await sqlAnalyzeTool.handler({ action: "stats", filter: "O'Brien" }, ctx);

    const query = postedQuery();
    // The lone quote must be doubled so it cannot break out of the literal.
    expect(query).toContain("UPPER('O''Brien')");
    // And there must be no un-doubled lone quote left in the user value region.
    expect(query).not.toContain("UPPER('O'Brien')");
  });

  it("stats: a filter with LIKE wildcards (%/_) is escaped to a LITERAL substring", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    await sqlAnalyzeTool.handler({ action: "stats", filter: "a_b%c" }, ctx);

    const query = postedQuery();
    // The %/_ must be escaped (leading backslash) and an ESCAPE clause present,
    // so the filter matches a literal substring rather than acting as wildcards.
    // (The value keeps its original case — UPPER() is applied by SQL at runtime.)
    expect(query).toContain("UPPER('a\\_b\\%c')");
    expect(query).toContain("ESCAPE '\\'");
    // The un-escaped wildcard form must NOT appear in the value region.
    expect(query).not.toContain("UPPER('a_b%c')");
  });

  it("running: a backslash in the filter is escaped (escape-char safety)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    await sqlAnalyzeTool.handler({ action: "running", filter: "a\\b" }, ctx);

    const query = postedQuery();
    // The literal backslash (the LIKE escape char) is itself doubled-escaped.
    expect(query).toContain("UPPER('a\\\\b')");
    expect(query).toContain("ESCAPE '\\'");
  });

  // ── 4. stats maxRows truncation via the shared toTabular path (AC 17.3.3)

  it("stats: respects maxRows and reports truncation", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ Hash: "h" + i, StatCount: i }));
    mockHttp.post.mockResolvedValue(envelope({ content: many }));

    const result = await sqlAnalyzeTool.handler(
      { action: "stats", maxRows: 5 },
      ctx,
    );

    const structured = result.structuredContent as {
      rowCount: number;
      truncated: boolean;
      totalAvailable: number;
    };
    expect(structured.rowCount).toBe(5);
    expect(structured.truncated).toBe(true);
    expect(structured.totalAvailable).toBe(30);
  });

  it("stats: no truncation flag when rows fit within maxRows", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ Hash: "h", StatCount: 1 }] }),
    );

    const result = await sqlAnalyzeTool.handler({ action: "stats" }, ctx);

    const structured = result.structuredContent as {
      rowCount: number;
      truncated?: boolean;
      totalAvailable?: number;
    };
    expect(structured.rowCount).toBe(1);
    expect(structured.truncated).toBeUndefined();
    expect(structured.totalAvailable).toBeUndefined();
  });

  // ── whitespace-only query rejected before any HTTP (AC 17.3.3) ───────

  it("explain: a whitespace-only query is rejected before any HTTP call", async () => {
    const result = await sqlAnalyzeTool.handler({ action: "explain", query: "   " }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("requires a 'query'");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("indexUsage: a whitespace-only query is rejected before any HTTP call", async () => {
    const result = await sqlAnalyzeTool.handler(
      { action: "indexUsage", query: "\t\n " },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  // ── 5. explain/indexUsage with absent/null Plan column (AC 17.3.3) ───

  it("explain: a row with no Plan column yields an empty plan string (no throw)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [{ NotPlan: "x" }] }));

    const result = await sqlAnalyzeTool.handler(
      { action: "explain", query: "SELECT 1" },
      ctx,
    );

    const structured = result.structuredContent as { action: string; plan: string };
    expect(structured.action).toBe("explain");
    expect(structured.plan).toBe("");
    expect(result.isError).toBeUndefined();
  });

  it("explain: an empty result set yields an empty plan string (no throw)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    const result = await sqlAnalyzeTool.handler(
      { action: "explain", query: "SELECT 1" },
      ctx,
    );

    const structured = result.structuredContent as { plan: string };
    expect(structured.plan).toBe("");
    expect(result.isError).toBeUndefined();
  });

  it("indexUsage: an empty result set yields an empty indexes array (no throw)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    const result = await sqlAnalyzeTool.handler(
      { action: "indexUsage", query: "SELECT 1" },
      ctx,
    );

    const structured = result.structuredContent as { indexes: string[]; plan: string };
    expect(structured.indexes).toEqual([]);
    expect(structured.plan).toBe("");
  });

  // ── structuredContent is an OBJECT (never a bare array) per action ────

  it("every action returns a non-array structuredContent object", async () => {
    // explain
    mockHttp.post.mockResolvedValue(envelope({ content: [{ Plan: "p" }] }));
    let r = await sqlAnalyzeTool.handler({ action: "explain", query: "SELECT 1" }, ctx);
    expect(Array.isArray(r.structuredContent)).toBe(false);
    expect(typeof r.structuredContent).toBe("object");

    // indexUsage
    mockHttp.post.mockResolvedValue(envelope({ content: [{ Plan: "p" }] }));
    r = await sqlAnalyzeTool.handler({ action: "indexUsage", query: "SELECT 1" }, ctx);
    expect(Array.isArray(r.structuredContent)).toBe(false);

    // running
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));
    r = await sqlAnalyzeTool.handler({ action: "running" }, ctx);
    expect(Array.isArray(r.structuredContent)).toBe(false);

    // stats
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));
    r = await sqlAnalyzeTool.handler({ action: "stats" }, ctx);
    expect(Array.isArray(r.structuredContent)).toBe(false);
  });
});
