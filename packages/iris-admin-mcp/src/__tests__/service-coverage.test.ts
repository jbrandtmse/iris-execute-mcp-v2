/**
 * Story 15.1 — `iris_service_manage` QA coverage gaps (handler surface).
 *
 * Complementary to the dev's `service.test.ts` (happy-path per-action routing +
 * metadata). This suite fills the handler-level gaps the dev's tests did NOT
 * reach, all through the REAL tool handler with mocked HTTP:
 *
 *   - REAL pagination for `list`: the dev's mock `paginate` is a no-op (returns
 *     every item, never a cursor). Here we drive the tool with the ACTUAL
 *     paginate implementation (via the exported `encodeCursor`/`decodeCursor`),
 *     proving the `nextCursor` is surfaced on page 1, that the `cursor` arg
 *     advances to page 2, and that the final page omits `nextCursor` — the only
 *     place the tool's cursor wiring (`...(nextCursor ? { nextCursor } : {})`) is
 *     exercised.
 *   - error propagation on the `get` READ path (AC 15.1.5): the dev's error test
 *     only covers the POST/`enable` write path; a non-existent service via `get`
 *     (GET) must ALSO surface the real %Status text, not a generic message.
 *   - `get` with the name omitted: the empty-string `?name=` encoding path.
 *   - `set` settings field mapping (AC 15.1.4): each individual settings field
 *     (enabled / autheEnabled / clientSystems / description) is forwarded
 *     verbatim inside the POST body's `settings` object — no field dropped or
 *     renamed.
 *   - `content[0].text` and `structuredContent` describe the SAME payload (the
 *     JSON round-trips), for both a read and a write action.
 *
 * Default vitest suite (`*.test.ts`, NOT `.integration.test.ts`). No live IRIS,
 * no generated-file edits, no ObjectScript.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext, PaginateResult } from "@iris-mcp/shared";
import { IrisApiError, encodeCursor, decodeCursor } from "@iris-mcp/shared";
import { serviceManageTool } from "../tools/service.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── Real-paginate context ──────────────────────────────────────────────
// The shared `createMockCtx` ships a no-op `paginate`. To exercise the tool's
// cursor wiring we substitute the ACTUAL slice-and-cursor implementation (the
// same algorithm `McpServerBase` installs), parameterised by page size.
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

function makeServices(n: number): Array<Record<string, unknown>> {
  return Array.from({ length: n }, (_, i) => ({
    name: `%Service_Test${i}`,
    enabled: i % 2 === 0,
  }));
}

describe("iris_service_manage — coverage gaps (handler surface)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;

  beforeEach(() => {
    mockHttp = createMockHttp();
  });

  // ── REAL pagination ───────────────────────────────────────────────────

  it("list: surfaces nextCursor on a full first page (real paginate)", async () => {
    const all = makeServices(5);
    mockHttp.get.mockResolvedValue(envelope(all));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await serviceManageTool.handler({ action: "list" }, ctx);

    const structured = result.structuredContent as {
      services: unknown[];
      count: number;
      nextCursor?: string;
    };
    expect(structured.count).toBe(2);
    expect(structured.services).toHaveLength(2);
    expect(structured.nextCursor).toBe(encodeCursor(2));
  });

  it("list: a supplied cursor advances to the next page", async () => {
    const all = makeServices(5);
    mockHttp.get.mockResolvedValue(envelope(all));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await serviceManageTool.handler(
      { action: "list", cursor: encodeCursor(2) },
      ctx,
    );

    const structured = result.structuredContent as {
      services: Array<{ name: string }>;
      count: number;
      nextCursor?: string;
    };
    expect(structured.services[0]?.name).toBe("%Service_Test2");
    expect(structured.count).toBe(2);
    expect(structured.nextCursor).toBe(encodeCursor(4));
  });

  it("list: the final page omits nextCursor", async () => {
    const all = makeServices(5);
    mockHttp.get.mockResolvedValue(envelope(all));
    const ctx = ctxWithRealPaginate(mockHttp, 2);

    const result = await serviceManageTool.handler(
      { action: "list", cursor: encodeCursor(4) },
      ctx,
    );

    const structured = result.structuredContent as {
      services: unknown[];
      count: number;
      nextCursor?: string;
    };
    expect(structured.count).toBe(1);
    expect(structured).not.toHaveProperty("nextCursor");
  });

  // ── error propagation on the GET (read) path ──────────────────────────

  it("get: surfaces the real %Status text on IrisApiError (read path)", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        404,
        [{ error: "Service %Service_Ghost does not exist" }],
        "/api/executemcp/v2/security/service",
        "Service %Service_Ghost does not exist",
      ),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await serviceManageTool.handler(
      { action: "get", name: "%Service_Ghost" },
      ctx,
    );

    expect(result.isError).toBe(true);
    // The label names the service, and the SanitizeError-preserved text rides
    // through verbatim — not a generic "failed to get" message.
    expect(result.content[0]?.text).toContain("%Service_Ghost");
    expect(result.content[0]?.text).toContain("does not exist");
  });

  it("get: rejects an empty name rather than degrading to a list-all", async () => {
    // The server's GET treats an absent ?name= as "list all", so the tool must
    // reject an empty name up front instead of silently returning the whole
    // service inventory under a `get` action.
    const ctx = createMockCtx(mockHttp);

    const result = await serviceManageTool.handler(
      { action: "get", name: "" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("name");
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  // ── set: per-field settings mapping (AC 15.1.4) ───────────────────────

  it("set: forwards every settings field verbatim in the POST body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "set", name: "%Service_SQL", success: true }),
    );
    const ctx = createMockCtx(mockHttp);

    const settings = {
      enabled: false,
      autheEnabled: 96,
      description: "hardened",
      clientSystems: "10.0.0.1;10.0.0.2",
    };
    await serviceManageTool.handler(
      { action: "set", name: "%Service_SQL", settings },
      ctx,
    );

    const [, body] = mockHttp.post.mock.calls[0] as unknown as [
      string,
      { settings: typeof settings },
    ];
    expect(body.settings).toEqual(settings);
    expect(body.settings.enabled).toBe(false);
    expect(body.settings.autheEnabled).toBe(96);
    expect(body.settings.clientSystems).toBe("10.0.0.1;10.0.0.2");
    expect(body.settings.description).toBe("hardened");
  });

  // ── content text ↔ structuredContent consistency ──────────────────────

  it("list: content text JSON parses to the same payload as structuredContent", async () => {
    mockHttp.get.mockResolvedValue(envelope(makeServices(2)));
    const ctx = createMockCtx(mockHttp);

    const result = await serviceManageTool.handler({ action: "list" }, ctx);

    const parsed = JSON.parse(result.content[0]?.text ?? "null");
    expect(parsed).toEqual(result.structuredContent);
  });

  it("enable: content text JSON parses to the same payload as structuredContent", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "enable", name: "%Service_Telnet", success: true }),
    );
    const ctx = createMockCtx(mockHttp);

    const result = await serviceManageTool.handler(
      { action: "enable", name: "%Service_Telnet" },
      ctx,
    );

    const parsed = JSON.parse(result.content[0]?.text ?? "null");
    expect(parsed).toEqual(result.structuredContent);
  });
});
