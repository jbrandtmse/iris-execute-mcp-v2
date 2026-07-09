/**
 * QA-added boundary/interaction coverage for Story 24.2's SQL resource caps
 * (`IRIS_SQL_MAX_ROWS` / `IRIS_SQL_TIMEOUT` on `iris_sql_execute`).
 *
 * Orthogonal to `sql.test.ts`'s dev-authored cap tests: this file targets
 * (1) a stronger, end-to-end (real `loadConfig`) re-verification of the
 * Rule #19 byte-for-byte no-op proof, (2) boundary/interaction cases between
 * `rowsCapped` and the pre-existing `truncated`/`totalAvailable` fields not
 * covered by the dev's tests, and (3) the seconds->milliseconds conversion
 * flowing through the REAL `loadConfig` path end-to-end (not just a
 * hand-constructed ctx.config).
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { loadConfig } from "@iris-mcp/shared";
import { sqlExecuteTool } from "../tools/sql.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

describe("iris_sql_execute — SQL resource caps QA boundary coverage (Story 24.2)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── Re-verify the Rule #19 no-op proof through the REAL loadConfig path ──

  it("is a genuine no-op end-to-end through the real loadConfig (not just a hand-built ctx.config)", async () => {
    // Build config the way the running server actually does — via loadConfig
    // — with neither IRIS_SQL_MAX_ROWS nor IRIS_SQL_TIMEOUT set. This closes
    // the gap between "the mock ctx happens to omit the fields" and "the real
    // config-loading pipeline produces a ctx that omits the fields."
    const realConfig = loadConfig({
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
    });
    ctx = { ...ctx, config: realConfig };

    const manyRows = Array.from({ length: 50 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(envelope({ content: manyRows }));

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person", maxRows: 10 },
      ctx,
    );

    // Exactly 2 args — no timeout options object, matching pre-caps behavior.
    expect(mockHttp.post.mock.calls[0]).toHaveLength(2);
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/query",
      { query: "SELECT ID FROM Sample.Person" },
    );

    // Check the full serialized text output too, not just structuredContent —
    // a regression that leaked rowsCapped into content[].text but not
    // structuredContent (or vice versa) would not be caught by a
    // structuredContent-only assertion.
    const text = result.content[0]?.text ?? "";
    expect(text).not.toContain("rowsCapped");

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).not.toHaveProperty("rowsCapped");
    expect(structured.rowCount).toBe(10);
  });

  it("would fail if a caps regression leaked rowsCapped into the unset path (meta-check via mutation)", async () => {
    // Sanity-check that the no-op assertions above are not vacuously true —
    // deliberately simulate a "regression" by setting sqlMaxRows below the
    // request and confirm the SAME assertions used above WOULD catch it.
    ctx = { ...ctx, config: { ...ctx.config, sqlMaxRows: 3 } };
    const manyRows = Array.from({ length: 50 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(envelope({ content: manyRows }));

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person", maxRows: 10 },
      ctx,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    // This MUST be true here — proving the no-op tests above are
    // discriminating (they would fail if this path leaked into the unset case).
    expect(structured).toHaveProperty("rowsCapped", true);
  });

  // ── rowsCapped x truncated/totalAvailable interaction/boundary cases ──

  it("sets rowsCapped: true WITHOUT truncated when the cap is above the actual row count but below the caller's request (no additional truncation)", async () => {
    // actual=3 rows, cap=5 (< requested=20), so effectiveLimit=5 >= actual=3:
    // no rows are dropped by the cap itself, but rowsCapped is still true
    // because the cap DID reduce the requested ceiling from 20 to 5.
    const actualRows = Array.from({ length: 3 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(envelope({ content: actualRows }));
    ctx = { ...ctx, config: { ...ctx.config, sqlMaxRows: 5 } };

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person", maxRows: 20 },
      ctx,
    );

    const structured = result.structuredContent as {
      rowCount: number;
      rowsCapped?: boolean;
      truncated?: boolean;
      totalAvailable?: number;
    };
    expect(structured.rowCount).toBe(3);
    expect(structured.rowsCapped).toBe(true);
    expect(structured.truncated).toBeUndefined();
    expect(structured.totalAvailable).toBeUndefined();
  });

  it("sets both rowsCapped AND truncated/totalAvailable when the cap clamps below the actual returned row count", async () => {
    // Distinct fixture from sql.test.ts's cap-below test (different row/cap
    // values) — proves the coexistence holds generally, not for one magic
    // numeric combination.
    const actualRows = Array.from({ length: 200 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(envelope({ content: actualRows }));
    ctx = { ...ctx, config: { ...ctx.config, sqlMaxRows: 7 } };

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person", maxRows: 100 },
      ctx,
    );

    const structured = result.structuredContent as {
      rowCount: number;
      rowsCapped?: boolean;
      truncated?: boolean;
      totalAvailable?: number;
    };
    expect(structured.rowCount).toBe(7);
    expect(structured.rowsCapped).toBe(true);
    expect(structured.truncated).toBe(true);
    expect(structured.totalAvailable).toBe(200);
  });

  it("does NOT set rowsCapped when the cap exactly equals the caller's explicit maxRows", async () => {
    // Distinct from sql.test.ts's equal-cap test, which only exercises the
    // implicit DEFAULT_MAX_ROWS (1000) case. This covers an explicit,
    // non-default maxRows equal to the cap.
    const manyRows = Array.from({ length: 100 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(envelope({ content: manyRows }));
    ctx = { ...ctx, config: { ...ctx.config, sqlMaxRows: 50 } };

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person", maxRows: 50 },
      ctx,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).not.toHaveProperty("rowsCapped");
    expect(structured.rowCount).toBe(50);
    // truncated still fires independently (more rows exist beyond the 50 returned).
    expect(structured.truncated).toBe(true);
    expect(structured.totalAvailable).toBe(100);
  });

  it("clamps against the implicit DEFAULT_MAX_ROWS (1000) when the caller omits maxRows and the cap is below 1000", async () => {
    const manyRows = Array.from({ length: 500 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(envelope({ content: manyRows }));
    ctx = { ...ctx, config: { ...ctx.config, sqlMaxRows: 200 } };

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person" },
      ctx,
    );

    const structured = result.structuredContent as {
      rowCount: number;
      rowsCapped?: boolean;
      truncated?: boolean;
      totalAvailable?: number;
    };
    expect(structured.rowCount).toBe(200);
    expect(structured.rowsCapped).toBe(true);
    expect(structured.truncated).toBe(true);
    expect(structured.totalAvailable).toBe(500);
  });

  // ── sqlTimeoutMs: real seconds→ms conversion end-to-end ──

  it("forwards a timeout that is EXACTLY seconds*1000 when derived through the real loadConfig (not a hand-set ms value)", async () => {
    const realConfig = loadConfig({
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_TIMEOUT: "7",
    });
    expect(realConfig.sqlTimeoutMs).toBe(7 * 1000);

    ctx = { ...ctx, config: realConfig };
    mockHttp.post.mockResolvedValue(envelope({ content: [{ ID: 1 }] }));

    await sqlExecuteTool.handler({ query: "SELECT 1" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/query",
      { query: "SELECT 1" },
      { timeout: 7000 },
    );
  });

  it("forwards a fractional-second timeout correctly (2.5s -> 2500ms) end-to-end", async () => {
    const realConfig = loadConfig({
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_TIMEOUT: "2.5",
    });
    expect(realConfig.sqlTimeoutMs).toBe(2500);

    ctx = { ...ctx, config: realConfig };
    mockHttp.post.mockResolvedValue(envelope({ content: [{ ID: 1 }] }));

    await sqlExecuteTool.handler({ query: "SELECT 1" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/query",
      { query: "SELECT 1" },
      { timeout: 2500 },
    );
  });

  // ── Both caps set together ──

  it("applies both IRIS_SQL_MAX_ROWS and IRIS_SQL_TIMEOUT together in a single call", async () => {
    const realConfig = loadConfig({
      IRIS_USERNAME: "admin",
      IRIS_PASSWORD: "secret",
      IRIS_SQL_MAX_ROWS: "4",
      IRIS_SQL_TIMEOUT: "10",
    });
    ctx = { ...ctx, config: realConfig };

    const manyRows = Array.from({ length: 30 }, (_, i) => ({ ID: i }));
    mockHttp.post.mockResolvedValue(envelope({ content: manyRows }));

    const result = await sqlExecuteTool.handler(
      { query: "SELECT ID FROM Sample.Person", maxRows: 15 },
      ctx,
    );

    // Row cap applied.
    const structured = result.structuredContent as {
      rowCount: number;
      rowsCapped?: boolean;
      truncated?: boolean;
      totalAvailable?: number;
    };
    expect(structured.rowCount).toBe(4);
    expect(structured.rowsCapped).toBe(true);
    expect(structured.truncated).toBe(true);
    expect(structured.totalAvailable).toBe(30);

    // Timeout forwarded in the SAME call.
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/query",
      { query: "SELECT ID FROM Sample.Person" },
      { timeout: 10_000 },
    );
  });
});
