/**
 * Story 15.4 — `iris_audit_manage` QA coverage gaps (handler surface).
 *
 * Complementary to the dev's `audit.test.ts` (happy-path per-action routing,
 * the configureEvent/purge/export guards, view filter mapping, error text on
 * the status path, metadata). This suite fills the handler-level gaps the dev's
 * tests did NOT reach, all through the REAL tool handler with mocked HTTP:
 *
 *   - **purge SAFETY hardened (AC 15.4.5, destructive).** The dev proves
 *     confirm-required and bound-required in isolation. Here we also prove:
 *       • confirm:false (an explicit refusal, not just omission) is rejected;
 *       • confirm:true + EACH individual bound (begin / end / user / event /
 *         source / type) is sufficient and the POST body carries confirm:true +
 *         that bound — so a future change that dropped any one bound from the
 *         "accepted" set would fail here;
 *       • the returned deleted COUNT surfaces in structuredContent;
 *       • a purge with confirm:true but ZERO bounds NEVER reaches HTTP (the
 *         silent/unbounded-wipe guard) — re-asserted at the wire to pin it.
 *   - **export PATH-TRAVERSAL guard exhaustively (AC 15.4.5, security).** Each
 *     of `/ \ .. :` (and combinations) in `fileName` is rejected at the tool
 *     layer with NO POST; a BARE name is accepted and POSTed; the resolved
 *     server-side `location` + `exported` count surface. The dev covers three
 *     bad names + missing; this widens to the full forbidden-character set incl.
 *     the drive-letter `:` colon and an absolute POSIX path.
 *   - **view filtering precision + default cap (AC 15.4.4):** begin/end/user/
 *     event/source/type/maxRows each map to the query string when present and
 *     are OMITTED when empty-string or undefined; maxRows is forwarded verbatim
 *     (the server applies the default-100/cap-1000 — the tool does not clamp, so
 *     we assert the tool passes the value through unchanged, even a large one).
 *   - **REAL pagination for `view`:** the shared mock `paginate` is a no-op
 *     (returns every item, never a cursor). Here we drive the tool with the
 *     ACTUAL slice-and-cursor implementation, proving `nextCursor` surfaces on a
 *     full first page, a supplied `cursor` advances to page 2, and the final
 *     page omits `nextCursor` — the only place the tool's
 *     `...(nextCursor ? { nextCursor } : {})` wiring is exercised.
 *   - **Error propagation across paths (AC 15.4.6):** a failing `view` (GET) and
 *     a failing `purge`/`export` (POST) each surface the real %Status text
 *     verbatim with the action name, not a generic message.
 *   - **`content[0].text` ↔ `structuredContent` consistency:** the text and the
 *     structured payload describe the SAME object, for a read (status) and a
 *     write (purge).
 *
 * Default vitest suite (`*.test.ts`, NOT `.integration.test.ts`). No live IRIS,
 * no generated-file edits, no ObjectScript.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext, PaginateResult } from "@iris-mcp/shared";
import { IrisApiError, encodeCursor, decodeCursor } from "@iris-mcp/shared";
import { auditManageTool } from "../tools/audit.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

const PATH = "/api/executemcp/v2/security/audit";

// ── Real-paginate context (mirrors x509-coverage.test.ts) ───────────────

function ctxWithRealPaginate(
  http: ReturnType<typeof createMockHttp>,
  pageSize: number,
): ToolContext {
  const base = createMockCtx(http);
  return {
    ...base,
    paginate<T>(items: T[], cursor?: string): PaginateResult<T> {
      const offset = decodeCursor(cursor);
      if (cursor && offset >= items.length && items.length > 0) {
        return { page: [], nextCursor: undefined };
      }
      const page = items.slice(offset, offset + pageSize);
      const nextOffset = offset + pageSize;
      const nextCursor =
        nextOffset < items.length ? encodeCursor(nextOffset) : undefined;
      return { page, nextCursor };
    },
  };
}

/** A synthetic audit-log record. */
function rec(i: number): Record<string, unknown> {
  return {
    timestamp: `2026-06-16 10:0${i % 10}:00`,
    username: `user${i}`,
    event: "Login",
    source: "%System",
    type: "%Login",
  };
}

function makeRecs(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => rec(i));
}

describe("iris_audit_manage — coverage gaps (handler surface)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;

  beforeEach(() => {
    mockHttp = createMockHttp();
  });

  // ── purge SAFETY (AC 15.4.5) ───────────────────────────────────────────

  it("purge: an explicit confirm:false is rejected (not just omission) — no POST", async () => {
    const ctx = createMockCtx(mockHttp);
    const result = await auditManageTool.handler(
      { action: "purge", confirm: false, end: "2026-01-01 00:00:00" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("confirm");
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("purge: confirm:true + ZERO bounds NEVER reaches HTTP (unbounded-wipe guard)", async () => {
    const ctx = createMockCtx(mockHttp);
    const result = await auditManageTool.handler(
      { action: "purge", confirm: true },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("bounded scope");
    // The single most important assertion: the unbounded purge never hit the wire.
    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("purge: confirm:true + a WILDCARD-only scope is rejected (no full-wipe bypass)", async () => {
    // Regression (CR HIGH): a "*" value is the match-all wildcard, NOT a bound.
    // {confirm:true, source:"*"} (or any wildcard-only filter) would otherwise
    // satisfy a naive non-empty check and delete the entire audit log.
    for (const field of ["user", "event", "source", "type"]) {
      mockHttp = createMockHttp();
      const ctx = createMockCtx(mockHttp);
      const result = await auditManageTool.handler(
        { action: "purge", confirm: true, [field]: "*" },
        ctx,
      );
      expect(
        result.isError,
        `wildcard-only '${field}' must be rejected`,
      ).toBe(true);
      expect(result.content[0]?.text).toContain("bounded scope");
      // The unbounded (wildcard-only) purge must never hit the wire.
      expect(mockHttp.post).not.toHaveBeenCalled();
    }
  });

  it("purge: confirm:true + EACH individual bound is sufficient and rides the body", async () => {
    const bounds: Array<[string, string]> = [
      ["begin", "2026-01-01 00:00:00"],
      ["end", "2026-01-01 00:00:00"],
      ["user", "alice"],
      ["event", "Login"],
      ["source", "%System"],
      ["type", "%Login"],
    ];
    for (const [field, value] of bounds) {
      mockHttp = createMockHttp();
      mockHttp.post.mockResolvedValue(
        envelope({ action: "purge", deleted: 5, success: true }),
      );
      const ctx = createMockCtx(mockHttp);

      const result = await auditManageTool.handler(
        { action: "purge", confirm: true, [field]: value },
        ctx,
      );

      expect(result.isError, `bound '${field}' must be accepted`).toBeFalsy();
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      const [calledPath, body] = mockHttp.post.mock.calls[0] as unknown as [
        string,
        Record<string, unknown>,
      ];
      expect(calledPath).toBe(PATH);
      expect(body.action).toBe("purge");
      // Server-side guard depends on confirm:true being present in the body.
      expect(body.confirm).toBe(true);
      expect(body[field]).toBe(value);
    }
  });

  it("purge: the returned deleted COUNT surfaces in structuredContent", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "purge", deleted: 137, success: true }),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await auditManageTool.handler(
      { action: "purge", confirm: true, end: "2026-01-01 00:00:00" },
      ctx,
    );

    const structured = result.structuredContent as { deleted: number };
    expect(structured.deleted).toBe(137);
  });

  // ── export PATH-TRAVERSAL guard (AC 15.4.5) ────────────────────────────

  it("export: rejects every path-separator / traversal / drive-colon fileName — no POST", async () => {
    const badNames = [
      "../etc/passwd",
      "..\\windows\\system32",
      "sub/dir.xml",
      "a\\b.xml",
      "/abs/path.xml",
      "C:\\evil.xml",
      "..",
      "x/..",
      "dir/sub/file.xml",
    ];
    for (const bad of badNames) {
      mockHttp = createMockHttp();
      const ctx = createMockCtx(mockHttp);
      const result = await auditManageTool.handler(
        { action: "export", fileName: bad },
        ctx,
      );
      expect(result.isError, `fileName '${bad}' must be rejected`).toBe(true);
      expect(result.content[0]?.text).toContain("path separators");
      expect(mockHttp.post, `fileName '${bad}' must not POST`).not.toHaveBeenCalled();
    }
  });

  it("export: a BARE fileName is accepted, POSTed, and the resolved location + count surface", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "export",
        location: "/usr/iris/mgr/auditexport/dump.xml",
        exported: 12,
        success: true,
      }),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await auditManageTool.handler(
      { action: "export", fileName: "dump.xml", end: "2026-06-01 00:00:00" },
      ctx,
    );

    expect(result.isError).toBeFalsy();
    const [calledPath, body] = mockHttp.post.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(calledPath).toBe(PATH);
    expect(body).toEqual({
      action: "export",
      fileName: "dump.xml",
      end: "2026-06-01 00:00:00",
    });
    const structured = result.structuredContent as {
      location: string;
      exported: number;
    };
    expect(structured.location).toContain("auditexport");
    expect(structured.location).toContain("dump.xml");
    expect(structured.exported).toBe(12);
  });

  it("export: a plain name with a dot extension is NOT mistaken for traversal", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "export", location: "x/audit.2026.xml", exported: 0 }),
    );
    const ctx = createMockCtx(mockHttp);
    // 'audit.2026.xml' has dots but no '..' and no separators → must be accepted.
    const result = await auditManageTool.handler(
      { action: "export", fileName: "audit.2026.xml" },
      ctx,
    );
    expect(result.isError).toBeFalsy();
    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    const [, body] = mockHttp.post.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
    ];
    expect(body.fileName).toBe("audit.2026.xml");
  });

  // ── view filtering precision + default cap (AC 15.4.4) ─────────────────

  it("view: each present filter maps onto the query string; absent ones are omitted", async () => {
    mockHttp.get.mockResolvedValue(envelope({ events: [], count: 0 }));
    const ctx = createMockCtx(mockHttp);

    await auditManageTool.handler(
      { action: "view", user: "alice", source: "%System" },
      ctx,
    );

    const url = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(url).toContain("action=view");
    expect(url).toContain("user=alice");
    expect(url).toContain("source=%25System");
    // Filters NOT supplied must not appear.
    expect(url).not.toContain("begin=");
    expect(url).not.toContain("end=");
    expect(url).not.toContain("event=");
    expect(url).not.toContain("type=");
    expect(url).not.toContain("maxRows=");
  });

  it("view: empty-string filters are treated as absent (omitted from query)", async () => {
    mockHttp.get.mockResolvedValue(envelope({ events: [], count: 0 }));
    const ctx = createMockCtx(mockHttp);

    await auditManageTool.handler(
      {
        action: "view",
        begin: "",
        end: "",
        user: "",
        event: "",
        source: "",
        type: "",
      },
      ctx,
    );

    const url = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(url).not.toContain("begin=");
    expect(url).not.toContain("end=");
    expect(url).not.toContain("user=");
    expect(url).not.toContain("event=");
    expect(url).not.toContain("source=");
    expect(url).not.toContain("type=");
  });

  it("view: maxRows is forwarded verbatim (the server applies the default/cap, the tool does not clamp)", async () => {
    mockHttp.get.mockResolvedValue(envelope({ events: [], count: 0 }));
    const ctx = createMockCtx(mockHttp);

    // A value larger than the documented 1000 cap — the tool passes it through;
    // the server is authoritative for the cap. (Guards against the tool silently
    // rewriting the caller's intent.)
    await auditManageTool.handler({ action: "view", maxRows: 99999 }, ctx);

    const url = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(url).toContain("maxRows=99999");
  });

  // ── REAL pagination for view ───────────────────────────────────────────

  it("view: surfaces nextCursor on a full first page (real paginate)", async () => {
    mockHttp.get.mockResolvedValue(envelope({ events: makeRecs(5) }));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await auditManageTool.handler({ action: "view" }, ctx);

    const structured = result.structuredContent as {
      events: unknown[];
      count: number;
      nextCursor?: string;
    };
    expect(structured.count).toBe(2);
    expect(structured.events).toHaveLength(2);
    expect(structured.nextCursor).toBe(encodeCursor(2));
  });

  it("view: a supplied cursor advances to the next page", async () => {
    mockHttp.get.mockResolvedValue(envelope({ events: makeRecs(5) }));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await auditManageTool.handler(
      { action: "view", cursor: encodeCursor(2) },
      ctx,
    );

    const structured = result.structuredContent as {
      events: Array<{ username: string }>;
      count: number;
      nextCursor?: string;
    };
    expect(structured.events[0]?.username).toBe("user2");
    expect(structured.count).toBe(2);
    expect(structured.nextCursor).toBe(encodeCursor(4));
  });

  it("view: the final page omits nextCursor", async () => {
    mockHttp.get.mockResolvedValue(envelope({ events: makeRecs(5) }));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await auditManageTool.handler(
      { action: "view", cursor: encodeCursor(4) },
      ctx,
    );

    const structured = result.structuredContent as {
      events: unknown[];
      count: number;
      nextCursor?: string;
    };
    expect(structured.count).toBe(1);
    expect(structured).not.toHaveProperty("nextCursor");
  });

  it("view: a non-array server `events` payload is handled as empty (no throw)", async () => {
    // Defensive: the handler coerces a missing/odd `events` to [] before paginate.
    mockHttp.get.mockResolvedValue(envelope({ events: null }));
    const ctx = createMockCtx(mockHttp);

    const result = await auditManageTool.handler({ action: "view" }, ctx);
    const structured = result.structuredContent as {
      events: unknown[];
      count: number;
    };
    expect(structured.events).toEqual([]);
    expect(structured.count).toBe(0);
  });

  // ── error propagation across paths (AC 15.4.6) ─────────────────────────

  it("view: surfaces the real %Status text on IrisApiError (GET path)", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Failed to enumerate audit records" }],
        PATH,
        "Failed to enumerate audit records",
      ),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await auditManageTool.handler({ action: "view" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("'view'");
    expect(result.content[0]?.text).toContain("Failed to enumerate audit records");
  });

  it("purge: surfaces the real %Status text on IrisApiError (POST path)", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Audit Delete requires %Admin_Secure:Use" }],
        PATH,
        "Audit Delete requires %Admin_Secure:Use",
      ),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await auditManageTool.handler(
      { action: "purge", confirm: true, end: "2026-01-01 00:00:00" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("'purge'");
    expect(result.content[0]?.text).toContain("%Admin_Secure");
  });

  it("export: surfaces the real %Status text on IrisApiError (POST path)", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Unable to open export file" }],
        PATH,
        "Unable to open export file",
      ),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await auditManageTool.handler(
      { action: "export", fileName: "dump.xml" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("'export'");
    expect(result.content[0]?.text).toContain("Unable to open export file");
  });

  it("propagates non-IrisApiError exceptions on the POST path (enable)", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNRESET"));
    const ctx = createMockCtx(mockHttp);
    await expect(
      auditManageTool.handler({ action: "enable" }, ctx),
    ).rejects.toThrow("ECONNRESET");
  });

  // ── content text ↔ structuredContent consistency ───────────────────────

  it("status: content text JSON parses to the same payload as structuredContent", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ auditEnabled: true, events: [], eventCount: 0 }),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await auditManageTool.handler({ action: "status" }, ctx);

    const parsed = JSON.parse(result.content[0]?.text ?? "null");
    expect(parsed).toEqual(result.structuredContent);
  });

  it("purge: content text JSON parses to the same payload as structuredContent", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "purge", deleted: 9, success: true }),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await auditManageTool.handler(
      { action: "purge", confirm: true, user: "alice" },
      ctx,
    );

    const parsed = JSON.parse(result.content[0]?.text ?? "null");
    expect(parsed).toEqual(result.structuredContent);
  });
});
