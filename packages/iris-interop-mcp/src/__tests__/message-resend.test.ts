/**
 * Tests for `iris_message_resend` (Epic 26, Story 26.2 — AC 26.2.1/26.2.3).
 *
 * Mocked-HTTP unit tests covering: request wiring for all three actions
 * (preview / resend / resendFiltered), Zod schema validation (numeric
 * headerIds bounds, action enum, maxMessages bounds, boolean dryRun/confirm),
 * handler-level cross-field validation (resendFiltered requires item+from —
 * NOT expressed via Zod `.refine()` per the story's Constraints section, so
 * these are handler-level tests, not raw `inputSchema.safeParse` tests),
 * guard-refusal envelope passthrough (an IrisApiError thrown by the mocked
 * HTTP client, mirroring a Story 26.1 ObjectScript guard refusal, surfaces as
 * a tool error rather than crashing), per-header result mapping including
 * partial failure, and timestamp formatting (ODBC -> ISO-8601 + `*Raw`
 * sibling, Story 26.0 AC 26.0.4 correction — no `horologToIso`).
 *
 * Dev Agent Record cross-reference — which deferred Story 26.1 CR items this
 * schema closes at the TS layer:
 * - CR 26.1-1 (dryRun/confirm non-boolean coercion): CLOSED — `z.boolean()`
 *   rejects a non-boolean (e.g. `"true"`, `1`) outright; see the schema tests
 *   below.
 * - CR 26.1-3 (headerIds JSON-object accepted): CLOSED — `z.array(...)`
 *   rejects a non-array (a JSON object) outright.
 * - CR 26.1-5 (non-integer maxMessages into TOP): CLOSED — `z.number().int()`
 *   rejects a non-integer.
 * - CR 26.1-2 (bare-date `to` excludes final day), CR 26.1-4 (filtered-execute
 *   composition untested), CR 26.1-6 (execute-path fetch-failure swallowed):
 *   remain server-side / Story-26.3-smoke-covered — not addressable at the
 *   TS schema layer.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError, IrisConnectionError } from "@iris-mcp/shared";
import { messageResendTool } from "../tools/message-resend.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

describe("iris_message_resend", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
    // These rows pin the legacy preview wire and result, which the `allow` data policy keeps unchanged
    // (Story 39.2). The policy rows are in message-resend-policy.test.ts.
    ctx = { ...ctx, config: { ...ctx.config, dataPolicy: "allow" } };
  });

  // ── metadata ─────────────────────────────────────────────────

  it("should have correct tool name, scope, and annotations", () => {
    expect(messageResendTool.name).toBe("iris_message_resend");
    expect(messageResendTool.scope).toBe("NS");
    expect(messageResendTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should classify preview as read and resend/resendFiltered as write in mutates", () => {
    expect(messageResendTool.mutates).toEqual({
      preview: "read",
      resend: "write",
      resendFiltered: "write",
    });
  });

  it("should NOT declare defaultEnabled (Rule #32 — writes stay truthfully default-disabled)", () => {
    expect(messageResendTool.defaultEnabled).toBeUndefined();
  });

  it("description should state the default-disabled writes with an IRIS_GOVERNANCE enable snippet and the duplication hazard", () => {
    expect(messageResendTool.description).toContain("DEFAULT-DISABLED");
    expect(messageResendTool.description).toContain("IRIS_GOVERNANCE");
    expect(messageResendTool.description).toContain("iris_message_resend:resend");
    expect(messageResendTool.description).toContain("iris_message_resend:resendFiltered");
    expect(messageResendTool.description).toContain("DUPLICATION HAZARD");
    expect(messageResendTool.description).toContain("dryRun");
  });

  // ── Zod schema validation ───────────────────────────────────

  describe("schema validation", () => {
    it("should accept a valid preview call", () => {
      const result = messageResendTool.inputSchema.safeParse({
        action: "preview",
        headerIds: [1, "2", 3],
      });
      expect(result.success).toBe(true);
    });

    it("should reject an unknown action", () => {
      expect(
        messageResendTool.inputSchema.safeParse({ action: "delete", headerIds: [1] }).success,
      ).toBe(false);
    });

    it("should reject headerIds with fewer than 1 or more than 100 entries", () => {
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: [] }).success,
      ).toBe(false);
      const tooMany = Array.from({ length: 101 }, (_, i) => i + 1);
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: tooMany })
          .success,
      ).toBe(false);
      const oneHundred = Array.from({ length: 100 }, (_, i) => i + 1);
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: oneHundred })
          .success,
      ).toBe(true);
    });

    it("should reject a non-numeric header ID string", () => {
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: ["abc"] })
          .success,
      ).toBe(false);
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: ["1.5"] })
          .success,
      ).toBe(false);
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: ["-1"] })
          .success,
      ).toBe(false);
    });

    it("should reject '0' and leading-zero header ID strings (symmetric with the numeric .positive() arm)", () => {
      // The number arm rejects 0 via .positive(); the string arm must agree —
      // "0"/"00" are not positive, and "007" would otherwise silently resolve
      // to header 7 on the write path.
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: ["0"] }).success,
      ).toBe(false);
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: ["00"] }).success,
      ).toBe(false);
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: ["007"] }).success,
      ).toBe(false);
    });

    it("should reject a non-integer numeric header ID", () => {
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: [1.5] }).success,
      ).toBe(false);
      expect(
        messageResendTool.inputSchema.safeParse({ action: "preview", headerIds: [-1] }).success,
      ).toBe(false);
    });

    it("should reject headerIds supplied as a JSON object instead of an array (CR 26.1-3)", () => {
      expect(
        messageResendTool.inputSchema.safeParse({
          action: "preview",
          headerIds: { "0": 1, "1": 2 },
        }).success,
      ).toBe(false);
    });

    it("should reject non-boolean dryRun/confirm (CR 26.1-1)", () => {
      const base = { action: "resendFiltered" as const, item: "X", from: "2026-07-01" };
      expect(
        messageResendTool.inputSchema.safeParse({ ...base, dryRun: "true" }).success,
      ).toBe(false);
      expect(messageResendTool.inputSchema.safeParse({ ...base, dryRun: 1 }).success).toBe(
        false,
      );
      expect(
        messageResendTool.inputSchema.safeParse({ ...base, confirm: "false" }).success,
      ).toBe(false);
      expect(
        messageResendTool.inputSchema.safeParse({ ...base, dryRun: false, confirm: true })
          .success,
      ).toBe(true);
    });

    it("should reject maxMessages out of bounds or non-integer (CR 26.1-5)", () => {
      const base = { action: "resendFiltered" as const, item: "X", from: "2026-07-01" };
      expect(
        messageResendTool.inputSchema.safeParse({ ...base, maxMessages: 0 }).success,
      ).toBe(false);
      expect(
        messageResendTool.inputSchema.safeParse({ ...base, maxMessages: 501 }).success,
      ).toBe(false);
      expect(
        messageResendTool.inputSchema.safeParse({ ...base, maxMessages: 100.5 }).success,
      ).toBe(false);
      expect(
        messageResendTool.inputSchema.safeParse({ ...base, maxMessages: 500 }).success,
      ).toBe(true);
    });

    it("should reject an invalid status label", () => {
      expect(
        messageResendTool.inputSchema.safeParse({
          action: "resendFiltered",
          item: "X",
          from: "2026-07-01",
          status: "Bogus",
        }).success,
      ).toBe(false);
    });

    it("should accept resendFiltered with only item+from (other fields optional at the schema level)", () => {
      const result = messageResendTool.inputSchema.safeParse({
        action: "resendFiltered",
        item: "MyApp.Service",
        from: "2026-07-01",
      });
      expect(result.success).toBe(true);
    });
  });

  // ── handler-level cross-field validation (no .refine() per story Constraints) ──

  describe("handler-level required-field validation", () => {
    it("should reject 'preview' with no headerIds", async () => {
      const result = await messageResendTool.handler({ action: "preview" }, ctx);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("headerIds");
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("should reject 'resend' with no headerIds", async () => {
      const result = await messageResendTool.handler({ action: "resend" }, ctx);
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("headerIds");
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("should reject 'resendFiltered' with no item (requires item+from)", async () => {
      const result = await messageResendTool.handler(
        { action: "resendFiltered", from: "2026-07-01" },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("item");
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("should reject 'resendFiltered' with no from (requires item+from)", async () => {
      const result = await messageResendTool.handler(
        { action: "resendFiltered", item: "MyApp.Service" },
        ctx,
      );
      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("from");
      expect(mockHttp.post).not.toHaveBeenCalled();
    });
  });

  // ── preview ──────────────────────────────────────────────────

  describe("preview", () => {
    it("should POST to the preview endpoint with headerIds + namespace", async () => {
      mockHttp.post.mockResolvedValue(envelope({ headers: [], count: 0 }));

      await messageResendTool.handler({ action: "preview", headerIds: [1, 2] }, ctx);

      expect(mockHttp.post).toHaveBeenCalledWith(
        "/api/executemcp/v2/interop/message/resend/preview",
        { headerIds: [1, 2], namespace: "USER" },
      );
    });

    it("should map a found header's fields through, including verdict/reason", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          headers: [
            {
              id: 100,
              found: true,
              sessionId: 5,
              type: "Request",
              sourceItem: "Svc.In",
              targetItem: "Op.Out",
              status: "Error",
              isError: true,
              timeCreated: "2026-07-02 10:00:01.298",
              timeProcessed: "2026-07-02 10:00:02.100",
              bodyClassName: "Demo.Msg",
              bodyClassExists: true,
              bodySummary: "hello",
              verdict: "recommended",
              reason: "This is the failed REQUEST message",
            },
          ],
          count: 1,
        }),
      );

      const result = await messageResendTool.handler(
        { action: "preview", headerIds: [100] },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        headers: Array<Record<string, unknown>>;
        count: number;
      };
      expect(structured.count).toBe(1);
      expect(structured.headers[0]).toMatchObject({
        id: 100,
        found: true,
        verdict: "recommended",
        bodyClassExists: true,
      });
      expect(result.content[0]?.text).toContain("recommended");
    });

    it("should map a not-found header's error", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          headers: [{ id: 999, found: false, error: "Header 999 not found" }],
          count: 1,
        }),
      );

      const result = await messageResendTool.handler(
        { action: "preview", headerIds: [999] },
        ctx,
      );

      const structured = result.structuredContent as {
        headers: Array<{ id: number; found: boolean; error: string }>;
      };
      expect(structured.headers[0]?.found).toBe(false);
      expect(structured.headers[0]?.error).toBe("Header 999 not found");
      expect(result.content[0]?.text).toContain("NOT FOUND");
    });

    // ── timestamp formatting (Story 26.0 AC 26.0.4 — no horologToIso) ──

    it("should convert ODBC timestamps to ISO-8601 and preserve the raw ODBC string in *Raw fields", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          headers: [
            {
              id: 1,
              found: true,
              timeCreated: "2026-07-02 10:00:01.298",
              timeProcessed: "2026-07-02 10:00:02.5",
              verdict: "note",
              reason: "",
            },
          ],
          count: 1,
        }),
      );

      const result = await messageResendTool.handler({ action: "preview", headerIds: [1] }, ctx);

      const structured = result.structuredContent as {
        headers: Array<Record<string, unknown>>;
      };
      const h = structured.headers[0] as Record<string, unknown>;
      expect(h.timeCreated).toBe("2026-07-02T10:00:01.298Z");
      expect(h.timeCreatedRaw).toBe("2026-07-02 10:00:01.298");
      expect(h.timeProcessed).toBe("2026-07-02T10:00:02.5Z");
      expect(h.timeProcessedRaw).toBe("2026-07-02 10:00:02.5");
    });

    it("should leave an absent timeProcessed unset (no *Raw sibling added)", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          headers: [
            {
              id: 1,
              found: true,
              timeCreated: "2026-07-02 10:00:01.298",
              verdict: "note",
              reason: "",
            },
          ],
          count: 1,
        }),
      );

      const result = await messageResendTool.handler({ action: "preview", headerIds: [1] }, ctx);
      const structured = result.structuredContent as {
        headers: Array<Record<string, unknown>>;
      };
      expect(structured.headers[0]?.timeProcessed).toBeUndefined();
      expect(structured.headers[0]?.timeProcessedRaw).toBeUndefined();
    });

    it("should pass a spaceless timestamp (already ISO/malformed) through unchanged without throwing", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          headers: [
            {
              id: 1,
              found: true,
              // No space -> odbcToIso's indexOf(" ") === -1 pass-through branch.
              timeCreated: "2026-07-02T10:00:01.298Z",
              verdict: "note",
              reason: "",
            },
          ],
          count: 1,
        }),
      );

      const result = await messageResendTool.handler({ action: "preview", headerIds: [1] }, ctx);
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        headers: Array<Record<string, unknown>>;
      };
      const h = structured.headers[0] as Record<string, unknown>;
      // Unchanged (pass-through), and the *Raw sibling mirrors it exactly.
      expect(h.timeCreated).toBe("2026-07-02T10:00:01.298Z");
      expect(h.timeCreatedRaw).toBe("2026-07-02T10:00:01.298Z");
    });

    it("should not throw and should skip the *Raw sibling when timeCreated is null", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          headers: [
            {
              id: 1,
              found: true,
              timeCreated: null,
              verdict: "note",
              reason: "",
            },
          ],
          count: 1,
        }),
      );

      const result = await messageResendTool.handler({ action: "preview", headerIds: [1] }, ctx);
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        headers: Array<Record<string, unknown>>;
      };
      const h = structured.headers[0] as Record<string, unknown>;
      expect(h.timeCreated).toBeNull();
      expect(h.timeCreatedRaw).toBeUndefined();
    });

    it("should not throw and should skip the *Raw sibling when timeCreated is an empty string", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          headers: [
            {
              id: 1,
              found: true,
              timeCreated: "",
              verdict: "note",
              reason: "",
            },
          ],
          count: 1,
        }),
      );

      const result = await messageResendTool.handler({ action: "preview", headerIds: [1] }, ctx);
      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        headers: Array<Record<string, unknown>>;
      };
      const h = structured.headers[0] as Record<string, unknown>;
      expect(h.timeCreated).toBe("");
      expect(h.timeCreatedRaw).toBeUndefined();
    });
  });

  // ── resend ───────────────────────────────────────────────────

  describe("resend", () => {
    it("should POST action:resend with headerIds + namespace", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "resend",
          results: [{ originalId: 1, newHeaderId: 2, ok: true }],
          summary: { total: 1, succeeded: 1, failed: 0 },
        }),
      );

      await messageResendTool.handler({ action: "resend", headerIds: [1] }, ctx);

      expect(mockHttp.post).toHaveBeenCalledWith("/api/executemcp/v2/interop/message/resend", {
        action: "resend",
        headerIds: [1],
        namespace: "USER",
      });
    });

    it("should include headOfQueue only when provided", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "resend",
          results: [{ originalId: 1, newHeaderId: 2, ok: true }],
          summary: { total: 1, succeeded: 1, failed: 0 },
        }),
      );

      await messageResendTool.handler(
        { action: "resend", headerIds: [1], headOfQueue: true },
        ctx,
      );

      const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body.headOfQueue).toBe(true);
    });

    it("should map per-header results including a partial failure", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "resend",
          results: [
            { originalId: 1, newHeaderId: 101, ok: true },
            { originalId: 2, ok: false, error: "Target config item 'X' is not running" },
          ],
          summary: { total: 2, succeeded: 1, failed: 1 },
        }),
      );

      const result = await messageResendTool.handler(
        { action: "resend", headerIds: [1, 2] },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        results: Array<{ originalId: number; newHeaderId?: number; ok: boolean; error?: string }>;
        summary: { total: number; succeeded: number; failed: number };
      };
      expect(structured.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
      expect(structured.results).toEqual([
        { originalId: 1, newHeaderId: 101, ok: true },
        { originalId: 2, ok: false, error: "Target config item 'X' is not running" },
      ]);
      expect(result.content[0]?.text).toContain("1/2 succeeded, 1 failed");
      expect(result.content[0]?.text).toContain("new header #101");
      expect(result.content[0]?.text).toContain("FAILED: Target config item 'X' is not running");
    });

    // ── CR 26.2-1 regression: malformed 200 (server contract drift) must not crash ──

    it("should not throw when a 200 response omits 'summary' (CR 26.2-1) — renders 0/0 succeeded, 0 failed", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "resend",
          results: [{ originalId: 1, newHeaderId: 2, ok: true }],
          // summary intentionally omitted — malformed/contract-drift response
        }),
      );

      const result = await messageResendTool.handler(
        { action: "resend", headerIds: [1] },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain("0/0 succeeded, 0 failed");
    });
  });

  // ── resendFiltered ───────────────────────────────────────────

  describe("resendFiltered", () => {
    it("should POST action:resendFiltered with item+from and only the provided optional fields", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "resendFiltered",
          dryRun: true,
          matchCount: 0,
          sample: [],
          item: "MyApp.Service",
          status: "Errored",
          from: "2026-07-01 00:00:00",
          to: "2026-07-02 00:00:00",
          maxMessages: 100,
        }),
      );

      await messageResendTool.handler(
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01" },
        ctx,
      );

      expect(mockHttp.post).toHaveBeenCalledWith("/api/executemcp/v2/interop/message/resend", {
        action: "resendFiltered",
        item: "MyApp.Service",
        from: "2026-07-01",
        namespace: "USER",
      });
    });

    it("should forward status/to/maxMessages/dryRun/confirm when provided", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "resendFiltered",
          dryRun: false,
          matchCount: 0,
          results: [],
          summary: { total: 0, succeeded: 0, failed: 0 },
        }),
      );

      await messageResendTool.handler(
        {
          action: "resendFiltered",
          item: "MyApp.Service",
          status: "Discarded",
          from: "2026-07-01",
          to: "2026-07-02",
          maxMessages: 250,
          dryRun: false,
          confirm: true,
        },
        ctx,
      );

      const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(body).toMatchObject({
        action: "resendFiltered",
        item: "MyApp.Service",
        status: "Discarded",
        from: "2026-07-01",
        to: "2026-07-02",
        maxMessages: 250,
        dryRun: false,
        confirm: true,
        namespace: "USER",
      });
    });

    it("dry-run: should surface matchCount + mapped sample with ISO timestamps, never a results/summary field", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "resendFiltered",
          dryRun: true,
          matchCount: 3,
          sample: [
            {
              id: 10,
              sourceItem: "Svc.In",
              targetItem: "Op.Out",
              status: "Error",
              timeCreated: "2026-07-02 10:00:01.298",
              sessionId: 5,
            },
          ],
          item: "MyApp.Service",
          status: "Errored",
          from: "2026-07-01 00:00:00",
          to: "2026-07-02 00:00:00",
          maxMessages: 100,
        }),
      );

      const result = await messageResendTool.handler(
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01" },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        dryRun: boolean;
        matchCount: number;
        sample: Array<Record<string, unknown>>;
      };
      expect(structured.dryRun).toBe(true);
      expect(structured.matchCount).toBe(3);
      expect(structured.sample[0]?.timeCreated).toBe("2026-07-02T10:00:01.298Z");
      expect(structured.sample[0]?.timeCreatedRaw).toBe("2026-07-02 10:00:01.298");
      expect(result.content[0]?.text).toContain("DRY RUN");
      expect(result.content[0]?.text).toContain("resent NOTHING");
    });

    it("executed (dryRun:false): should surface matchCount + per-header results incl. partial failure", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "resendFiltered",
          dryRun: false,
          matchCount: 2,
          results: [
            { originalId: 10, newHeaderId: 110, ok: true },
            { originalId: 11, ok: false, error: "Target config item 'X' is not running" },
          ],
          summary: { total: 2, succeeded: 1, failed: 1 },
        }),
      );

      const result = await messageResendTool.handler(
        {
          action: "resendFiltered",
          item: "MyApp.Service",
          from: "2026-07-01",
          dryRun: false,
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as {
        dryRun: boolean;
        matchCount: number;
        results: Array<{ originalId: number; ok: boolean }>;
        summary: { total: number; succeeded: number; failed: number };
      };
      expect(structured.dryRun).toBe(false);
      expect(structured.matchCount).toBe(2);
      expect(structured.summary).toEqual({ total: 2, succeeded: 1, failed: 1 });
      expect(result.content[0]?.text).toContain("2 matched");
      expect(result.content[0]?.text).toContain("FAILED: Target config item 'X' is not running");
    });

    // ── CR 26.2-1 regression: bare-truthiness dryRun discriminant hardening ──

    it("should route to the EXECUTED branch (not dry-run) when a 200 response's dryRun is the string 'false' (CR 26.2-1)", async () => {
      // Not reachable with the current Story 26.1 server (which always emits a
      // real JSON boolean), but a contract-drift response with a truthy
      // non-`true` dryRun must not be mis-routed to the dry-run branch, which
      // would then dereference the (absent) sample/matchCount-only shape.
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "resendFiltered",
          dryRun: "false",
          matchCount: 2,
          results: [{ originalId: 10, newHeaderId: 110, ok: true }],
          summary: { total: 1, succeeded: 1, failed: 0 },
        }),
      );

      const result = await messageResendTool.handler(
        {
          action: "resendFiltered",
          item: "MyApp.Service",
          from: "2026-07-01",
          dryRun: false,
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      // Executed-branch rendering ("N matched, X/Y succeeded"), not "DRY RUN".
      expect(result.content[0]?.text).toContain("2 matched");
      expect(result.content[0]?.text).not.toContain("DRY RUN");
    });

    it("should not throw when the EXECUTED branch's 200 response omits 'summary' (CR 26.2-1)", async () => {
      mockHttp.post.mockResolvedValue(
        envelope({
          action: "resendFiltered",
          dryRun: false,
          matchCount: 1,
          results: [{ originalId: 10, newHeaderId: 110, ok: true }],
          // summary intentionally omitted — malformed/contract-drift response
        }),
      );

      const result = await messageResendTool.handler(
        {
          action: "resendFiltered",
          item: "MyApp.Service",
          from: "2026-07-01",
          dryRun: false,
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain("0/0 succeeded, 0 failed");
    });
  });

  // ── namespace ────────────────────────────────────────────────

  it("should pass an explicit namespace through for every action", async () => {
    mockHttp.post.mockResolvedValue(envelope({ headers: [], count: 0 }));
    await messageResendTool.handler(
      { action: "preview", headerIds: [1], namespace: "MYNS" },
      ctx,
    );
    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/message/resend/preview",
      { headerIds: [1], namespace: "MYNS" },
    );
  });

  // ── guard-refusal envelope passthrough (Story 26.1 ObjectScript guards) ──

  describe("guard-refusal passthrough (IrisApiError)", () => {
    it("should surface a resend production-not-running refusal as isError, not a crash", async () => {
      mockHttp.post.mockRejectedValue(
        new IrisApiError(
          500,
          [{ error: "Cannot resend: no Interoperability production is running in this namespace. Start the production first. No changes were made." }],
          "/api/executemcp/v2/interop/message/resend",
          "Cannot resend: no Interoperability production is running in this namespace.",
        ),
      );

      const result = await messageResendTool.handler(
        { action: "resend", headerIds: [1] },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("iris_message_resend");
      expect(result.content[0]?.text).toContain("no Interoperability production is running");
    });

    it("should surface a resendFiltered double-gate refusal as isError, not a crash", async () => {
      mockHttp.post.mockRejectedValue(
        new IrisApiError(
          500,
          [{ error: "resendFiltered execution requires dryRun:false and confirm:true; by default dryRun is true and only previews matching messages without resending. No changes were made." }],
          "/api/executemcp/v2/interop/message/resend",
          "resendFiltered execution requires dryRun:false and confirm:true.",
        ),
      );

      const result = await messageResendTool.handler(
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01", dryRun: false },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("dryRun:false and confirm:true");
    });

    it("should surface a maxMessages-cap-exceeded refusal as isError", async () => {
      mockHttp.post.mockRejectedValue(
        new IrisApiError(
          500,
          [{ error: "600 messages match the filter, exceeding the maxMessages cap of 100; narrow the time window or item filter and retry. No changes were made." }],
          "/api/executemcp/v2/interop/message/resend",
          "600 messages match the filter, exceeding the maxMessages cap of 100.",
        ),
      );

      const result = await messageResendTool.handler(
        {
          action: "resendFiltered",
          item: "MyApp.Service",
          from: "2026-07-01",
          dryRun: false,
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("exceeding the maxMessages cap");
    });

    it("should surface a resendFiltered window-exceeded (>7 days) refusal as isError", async () => {
      // The TS schema does not validate the from/to span (only IRIS enforces
      // the 7-day cap server-side), so this request reaches the mocked
      // endpoint and the ObjectScript guard's refusal must pass through
      // cleanly rather than crash or report a false success.
      mockHttp.post.mockRejectedValue(
        new IrisApiError(
          500,
          [{ error: "The from/to window may not exceed 7 days; narrow the window and retry. No changes were made." }],
          "/api/executemcp/v2/interop/message/resend",
          "The from/to window may not exceed 7 days.",
        ),
      );

      const result = await messageResendTool.handler(
        {
          action: "resendFiltered",
          item: "MyApp.Service",
          from: "2026-01-01",
          to: "2026-07-01",
          dryRun: false,
          confirm: true,
        },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("may not exceed 7 days");
    });

    it("should propagate a non-IrisApiError exception (network error) rather than swallow it", async () => {
      mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        messageResendTool.handler({ action: "preview", headerIds: [1] }, ctx),
      ).rejects.toThrow("ECONNREFUSED");
    });
  });
});

// -- Story 43.3: confirmation (resend) -------------------------

describe("Story 43.3: confirmation (resend)", () => {
  const RESEND_PATH = "/api/executemcp/v2/interop/message/resend";
  const PREVIEW_PATH = "/api/executemcp/v2/interop/message/resend/preview";
  const HEADER_OPERATION = "resend messages by header ID";
  const FILTER_OPERATION = "resend the messages that match a filter";
  const FIRST_TWENTY = "1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20";

  type ConfirmFn = NonNullable<ToolContext["confirm"]>;
  type ConfirmRequest = Parameters<ConfirmFn>[0];
  type ConfirmOutcome = Awaited<ReturnType<ConfirmFn>>;

  const RESEND_REPLY = {
    action: "resend",
    results: [{ originalId: 1, newHeaderId: 2, ok: true }],
    summary: { total: 1, succeeded: 1, failed: 0 },
  };
  const EXECUTE_REPLY = {
    action: "resendFiltered",
    dryRun: false,
    matchCount: 7,
    results: [{ originalId: 10, newHeaderId: 11, ok: true }],
    summary: { total: 1, succeeded: 1, failed: 0 },
  };
  const dryRunReply = (overrides: Record<string, unknown> = {}) => ({
    action: "resendFiltered",
    dryRun: true,
    matchCount: 7,
    sample: [],
    item: "MyApp.Service",
    status: "Errored",
    from: "2026-07-01 00:00:00",
    to: "2026-07-02 00:00:00",
    maxMessages: 100,
    ...overrides,
  });

  // A resendFiltered call that IRIS lets through, and the request bodies it and its preflight send.
  const FILTER_ARGS = {
    action: "resendFiltered",
    item: "MyApp.Service",
    from: "2026-07-01",
    dryRun: false,
    confirm: true,
  };
  const FILTER_EXECUTE_BODY = {
    action: "resendFiltered",
    item: "MyApp.Service",
    from: "2026-07-01",
    namespace: "USER",
    dryRun: false,
    confirm: true,
  };
  const FILTER_PREFLIGHT_BODY = {
    action: "resendFiltered",
    item: "MyApp.Service",
    from: "2026-07-01",
    namespace: "USER",
    dryRun: true,
  };
  const FULL_ARGS = {
    action: "resendFiltered",
    item: "MyApp.Service",
    status: "Discarded",
    from: "2026-07-01",
    to: "2026-07-02",
    maxMessages: 250,
    dryRun: false,
    confirm: true,
    namespace: "MYNS",
  };
  const FULL_EXECUTE_BODY = {
    action: "resendFiltered",
    item: "MyApp.Service",
    status: "Discarded",
    from: "2026-07-01",
    to: "2026-07-02",
    maxMessages: 250,
    namespace: "MYNS",
    dryRun: false,
    confirm: true,
  };
  const FULL_PREFLIGHT_BODY = {
    action: "resendFiltered",
    item: "MyApp.Service",
    status: "Discarded",
    from: "2026-07-01",
    to: "2026-07-02",
    maxMessages: 250,
    namespace: "MYNS",
    dryRun: true,
  };
  const FULL_PREFLIGHT_KEYS = ["action", "dryRun", "from", "item", "maxMessages", "namespace", "status", "to"];

  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;
  let preflightAnswer: () => Promise<unknown>;

  beforeEach(() => {
    mockHttp = createMockHttp();
    preflightAnswer = async () => envelope(dryRunReply());
    mockHttp.post.mockImplementation(async (path: string, body: Record<string, unknown>) => {
      if (path === PREVIEW_PATH) return envelope({ headers: [], count: 0 });
      if (body.action === "resend") return envelope(RESEND_REPLY);
      if (body.dryRun === false) return envelope(EXECUTE_REPLY);
      return preflightAnswer();
    });
    ctx = createMockCtx(mockHttp);
    ctx = { ...ctx, config: { ...ctx.config, dataPolicy: "allow" } };
  });

  /**
   * A hand-written confirm that records every request, and how many POSTs had been made when it was
   * asked, and answers with what `answer` returns.
   */
  function recordingConfirm(answer: (request: ConfirmRequest) => Promise<ConfirmOutcome>) {
    const requests: ConfirmRequest[] = [];
    const postsBefore: number[] = [];
    const confirm: ConfirmFn = async (request) => {
      requests.push(request);
      postsBefore.push(mockHttp.post.mock.calls.length);
      return answer(request);
    };
    return { confirm, requests, postsBefore };
  }
  const proceed = async (): Promise<ConfirmOutcome> => ({ proceed: true });

  const declinedResult = {
    content: [{ type: "text" as const, text: "The person declined the confirmation." }],
    isError: true,
  };
  const decline = async (): Promise<ConfirmOutcome> => ({ proceed: false, result: declinedResult });

  /** The scope function of the first request. */
  function scopeOf(requests: ConfirmRequest[]): () => Promise<string | undefined> {
    const scope = requests[0]?.scope;
    if (typeof scope !== "function") throw new Error("the confirm request carried no scope function");
    return scope;
  }

  /** The POSTs made so far whose body has `dryRun` set to `dryRun`. */
  function postsWithDryRun(dryRun: boolean) {
    return mockHttp.post.mock.calls.filter(
      (call) => (call[1] as Record<string, unknown>).dryRun === dryRun,
    );
  }

  // -- resend ----------------------------------------------------

  describe("resend", () => {
    it("asks once with the fixed operation, the namespace target and the header IDs, before the POST", async () => {
      const { confirm, requests, postsBefore } = recordingConfirm(proceed);

      await messageResendTool.handler({ action: "resend", headerIds: [1, "2", 3] }, { ...ctx, confirm });

      expect(requests).toStrictEqual([
        { operation: HEADER_OPERATION, target: "namespace USER", scope: "3 header ID(s): 1, 2, 3" },
      ]);
      expect(postsBefore).toEqual([0]);
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
    });

    it("states the resolved namespace in the target", async () => {
      const { confirm, requests } = recordingConfirm(proceed);

      await messageResendTool.handler(
        { action: "resend", headerIds: [5], namespace: "MYNS" },
        { ...ctx, confirm },
      );

      expect(requests).toStrictEqual([
        { operation: HEADER_OPERATION, target: "namespace MYNS", scope: "1 header ID(s): 5" },
      ]);
    });

    it.each([
      ["20 IDs list all of them", 20, `20 header ID(s): ${FIRST_TWENTY}`],
      ["21 IDs list the first 20 and one more", 21, `21 header ID(s): ${FIRST_TWENTY} and 1 more`],
      ["25 IDs list the first 20 and 5 more", 25, `25 header ID(s): ${FIRST_TWENTY} and 5 more`],
      ["100 IDs list the first 20 and 80 more", 100, `100 header ID(s): ${FIRST_TWENTY} and 80 more`],
    ])("scope: %s", async (_label, count, scope) => {
      const { confirm, requests } = recordingConfirm(proceed);
      const headerIds = Array.from({ length: count }, (_, i) => i + 1);

      await messageResendTool.handler({ action: "resend", headerIds }, { ...ctx, confirm });

      expect(requests).toStrictEqual([{ operation: HEADER_OPERATION, target: "namespace USER", scope }]);
    });

    it.each([
      ["headOfQueue true", { headOfQueue: true }, "3 header ID(s): 1, 2, 3; each goes to the head of its queue"],
      ["headOfQueue false", { headOfQueue: false }, "3 header ID(s): 1, 2, 3"],
    ])("scope: %s", async (_label, extra, scope) => {
      const { confirm, requests } = recordingConfirm(proceed);

      await messageResendTool.handler(
        { action: "resend", headerIds: [1, 2, 3], ...extra },
        { ...ctx, confirm },
      );

      expect(requests).toStrictEqual([{ operation: HEADER_OPERATION, target: "namespace USER", scope }]);
    });

    it("scope: more than 20 IDs with headOfQueue true ends with the head-of-queue note", async () => {
      const { confirm, requests } = recordingConfirm(proceed);
      const headerIds = Array.from({ length: 25 }, (_, i) => i + 1);

      await messageResendTool.handler({ action: "resend", headerIds, headOfQueue: true }, { ...ctx, confirm });

      expect(requests).toStrictEqual([
        {
          operation: HEADER_OPERATION,
          target: "namespace USER",
          scope: `25 header ID(s): ${FIRST_TWENTY} and 5 more; each goes to the head of its queue`,
        },
      ]);
    });

    it.each([
      ["missing", { action: "resend" }],
      ["empty", { action: "resend", headerIds: [] }],
    ])("does not ask when headerIds is %s: the validation error comes back and nothing is posted", async (_label, args) => {
      const { confirm, requests } = recordingConfirm(proceed);

      const result = await messageResendTool.handler(args, { ...ctx, confirm });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("headerIds");
      expect(requests).toHaveLength(0);
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it.each([["allow"], ["redact"], ["block"]])("does not ask for a preview under data policy %s", async (dataPolicy) => {
      const { confirm, requests } = recordingConfirm(proceed);
      const previewCtx = { ...ctx, config: { ...ctx.config, dataPolicy: dataPolicy as "allow" | "redact" | "block" }, confirm };

      await messageResendTool.handler({ action: "preview", headerIds: [1, 2] }, previewCtx);

      expect(requests).toHaveLength(0);
      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      expect(mockHttp.post.mock.calls[0]?.[0]).toBe(PREVIEW_PATH);
    });

    it("returns a declined outcome unchanged and makes no POST", async () => {
      const { confirm, requests } = recordingConfirm(decline);

      const result = await messageResendTool.handler({ action: "resend", headerIds: [1] }, { ...ctx, confirm });

      expect(result).toBe(declinedResult);
      expect(requests).toHaveLength(1);
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it.each([
      ["plain", { action: "resend", headerIds: [1, 2] }, { action: "resend", headerIds: [1, 2], namespace: "USER" }],
      [
        "head of queue",
        { action: "resend", headerIds: [1, 2], headOfQueue: true },
        { action: "resend", headerIds: [1, 2], namespace: "USER", headOfQueue: true },
      ],
    ])("posts exactly as it does without a confirm when the outcome is proceed (%s)", async (_label, args, body) => {
      const without = await messageResendTool.handler(args, ctx);
      const withoutCalls = [...mockHttp.post.mock.calls];
      mockHttp.post.mockClear();

      const { confirm } = recordingConfirm(proceed);
      const result = await messageResendTool.handler(args, { ...ctx, confirm });

      expect(withoutCalls).toStrictEqual([[RESEND_PATH, body]]);
      expect(mockHttp.post.mock.calls).toStrictEqual(withoutCalls);
      expect(result).toStrictEqual(without);
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain("Resend: 1/1 succeeded, 0 failed");
    });

    it("runs as it does today when the context has no confirm", async () => {
      expect(ctx.confirm).toBeUndefined();

      const result = await messageResendTool.handler({ action: "resend", headerIds: [1, 2] }, ctx);

      expect(mockHttp.post.mock.calls).toStrictEqual([
        [RESEND_PATH, { action: "resend", headerIds: [1, 2], namespace: "USER" }],
      ]);
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain("Resend: 1/1 succeeded, 0 failed");
    });
  });

  // -- resendFiltered --------------------------------------------

  describe("resendFiltered", () => {
    it("asks once with the fixed operation, the item and namespace target and a scope function, before any POST", async () => {
      const { confirm, requests, postsBefore } = recordingConfirm(proceed);

      await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });

      expect(requests).toStrictEqual([
        {
          operation: FILTER_OPERATION,
          target: "item MyApp.Service, namespace USER",
          scope: expect.any(Function),
        },
      ]);
      expect(postsBefore).toEqual([0]);
      expect(mockHttp.post.mock.calls).toStrictEqual([[RESEND_PATH, FILTER_EXECUTE_BODY]]);
    });

    it("states the resolved namespace in the target", async () => {
      const { confirm, requests } = recordingConfirm(proceed);

      await messageResendTool.handler(FULL_ARGS, { ...ctx, confirm });

      expect(requests[0]?.target).toBe("item MyApp.Service, namespace MYNS");
    });

    it("the scope function POSTs a preflight to the same path with the same body except dryRun true and no confirm", async () => {
      const { confirm, requests } = recordingConfirm(proceed);
      await messageResendTool.handler(FULL_ARGS, { ...ctx, confirm });
      const executeCall = mockHttp.post.mock.calls[0];
      mockHttp.post.mockClear();
      preflightAnswer = async () =>
        envelope(dryRunReply({ status: "Discarded", maxMessages: 250 }));

      await scopeOf(requests)();

      expect(mockHttp.post).toHaveBeenCalledTimes(1);
      const [path, body] = mockHttp.post.mock.calls[0] as [string, Record<string, unknown>];
      expect(path).toBe(RESEND_PATH);
      expect(body).toStrictEqual(FULL_PREFLIGHT_BODY);
      expect(Object.keys(body).sort()).toEqual(FULL_PREFLIGHT_KEYS);
      expect(body).not.toHaveProperty("confirm");
      // The execute request the handler already sent is not touched by the preflight.
      expect(executeCall).toStrictEqual([RESEND_PATH, FULL_EXECUTE_BODY]);
    });

    it("the preflight body for a call with only item and from carries exactly action, item, from, namespace and dryRun", async () => {
      const { confirm, requests } = recordingConfirm(proceed);
      await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });
      mockHttp.post.mockClear();

      await scopeOf(requests)();

      const [path, body] = mockHttp.post.mock.calls[0] as [string, Record<string, unknown>];
      expect(path).toBe(RESEND_PATH);
      expect(body).toStrictEqual(FILTER_PREFLIGHT_BODY);
      expect(Object.keys(body).sort()).toEqual(["action", "dryRun", "from", "item", "namespace"]);
    });

    it("the scope function resolves to the dialog text built from the preflight reply", async () => {
      const { confirm, requests } = recordingConfirm(proceed);
      await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });
      preflightAnswer = async () => envelope(dryRunReply({ matchCount: 7 }));

      await expect(scopeOf(requests)()).resolves.toBe(
        "7 message(s) match now (status Errored, from 2026-07-01 00:00:00 to 2026-07-02 00:00:00); " +
          "IRIS counts again when it runs and resends at most 100",
      );
    });

    it("the scope function uses the status, window and cap the preflight reply carries", async () => {
      const { confirm, requests } = recordingConfirm(proceed);
      await messageResendTool.handler(FULL_ARGS, { ...ctx, confirm });
      preflightAnswer = async () =>
        envelope(dryRunReply({ matchCount: 42, status: "Discarded", maxMessages: 250 }));

      await expect(scopeOf(requests)()).resolves.toBe(
        "42 message(s) match now (status Discarded, from 2026-07-01 00:00:00 to 2026-07-02 00:00:00); " +
          "IRIS counts again when it runs and resends at most 250",
      );
    });

    it.each([
      ["one match", 1, 100, "1 message(s) match now"],
      ["a match count equal to the cap", 100, 100, "100 message(s) match now"],
    ])("the scope function resolves to the dialog text for %s", async (_label, matchCount, maxMessages, start) => {
      const { confirm, requests } = recordingConfirm(proceed);
      await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });
      preflightAnswer = async () => envelope(dryRunReply({ matchCount, maxMessages }));

      const text = await scopeOf(requests)();

      expect(text).toBe(
        `${start} (status Errored, from 2026-07-01 00:00:00 to 2026-07-02 00:00:00); ` +
          `IRIS counts again when it runs and resends at most ${maxMessages}`,
      );
    });

    it.each([
      ["no message matches", async () => envelope(dryRunReply({ matchCount: 0 }))],
      ["more messages match than the cap allows", async () => envelope(dryRunReply({ matchCount: 101, maxMessages: 100 }))],
      [
        // The ExecuteMCPv2 handlers refuse with HTTP 200 and the error in the envelope.
        "the preflight is refused by IRIS",
        async () => {
          throw new IrisApiError(
            200,
            [{ error: "The from/to window may not exceed 7 days; narrow the window and retry. No changes were made." }],
            RESEND_PATH,
            "The from/to window may not exceed 7 days.",
          );
        },
      ],
      [
        "the preflight is refused with an HTTP 400",
        async () => {
          throw new IrisApiError(400, [], RESEND_PATH, "IRIS returned HTTP 400.");
        },
      ],
      ["the reply is not a dry-run reply", async () => envelope(EXECUTE_REPLY)],
    ])("the scope function resolves undefined when %s", async (_label, answer) => {
      const { confirm, requests } = recordingConfirm(proceed);
      await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });
      preflightAnswer = answer;

      await expect(scopeOf(requests)()).resolves.toBeUndefined();
    });

    const connectionRefused = new Error("ECONNREFUSED");
    const timedOut = new IrisConnectionError("TIMEOUT", "Connection to IRIS timed out after 60000ms", "Check the port");
    const cancelledPreview = new IrisConnectionError("CANCELLED", "Request POST /x was cancelled by the client", "No answer");
    const serverError = new IrisApiError(500, [{ error: "ERROR #5002: the preview failed" }], RESEND_PATH, "IRIS returned HTTP 500.");
    const unavailable = new IrisApiError(503, [], RESEND_PATH, "IRIS returned HTTP 503 with a non-JSON response.");
    it.each([
      ["the preflight fails with a connection error", connectionRefused],
      ["the preflight times out", timedOut],
      ["the preflight is cancelled", cancelledPreview],
      ["the preflight fails with an HTTP 500", serverError],
      ["the preflight fails with an HTTP 503", unavailable],
    ])("the scope function rejects with the preflight's error when %s", async (_label, failure) => {
      const { confirm, requests } = recordingConfirm(proceed);
      await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });
      preflightAnswer = async () => {
        throw failure;
      };

      await expect(scopeOf(requests)()).rejects.toBe(failure);
    });

    it("a preflight that fails with a server error ends the call with that error; the execute POST is never made", async () => {
      preflightAnswer = async () => {
        throw serverError;
      };
      const { confirm } = recordingConfirm(async (request) => {
        if (typeof request.scope === "function") await request.scope();
        return { proceed: true };
      });

      const result = await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });

      expect(result).toStrictEqual({
        content: [{ type: "text", text: `Error performing 'resendFiltered' on iris_message_resend: ${serverError.message}` }],
        isError: true,
      });
      expect(mockHttp.post.mock.calls).toStrictEqual([[RESEND_PATH, FILTER_PREFLIGHT_BODY]]);
      expect(postsWithDryRun(false)).toHaveLength(0);
    });

    it("a preflight that fails with a connection error rejects with that error; the execute POST is never made", async () => {
      preflightAnswer = async () => {
        throw connectionRefused;
      };
      const { confirm } = recordingConfirm(async (request) => {
        if (typeof request.scope === "function") await request.scope();
        return { proceed: true };
      });

      await expect(messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm })).rejects.toBe(connectionRefused);
      expect(mockHttp.post.mock.calls).toStrictEqual([[RESEND_PATH, FILTER_PREFLIGHT_BODY]]);
      expect(postsWithDryRun(false)).toHaveLength(0);
    });

    const notAsked: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      [
        "dryRun is omitted",
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01" },
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01", namespace: "USER" },
      ],
      [
        "dryRun is omitted and confirm is true",
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01", confirm: true },
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01", namespace: "USER", confirm: true },
      ],
      [
        "dryRun is true",
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01", dryRun: true },
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01", namespace: "USER", dryRun: true },
      ],
      [
        "dryRun is true and confirm is true",
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01", dryRun: true, confirm: true },
        {
          action: "resendFiltered",
          item: "MyApp.Service",
          from: "2026-07-01",
          namespace: "USER",
          dryRun: true,
          confirm: true,
        },
      ],
      [
        "dryRun is false and confirm is missing",
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01", dryRun: false },
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01", namespace: "USER", dryRun: false },
      ],
      [
        "dryRun is false and confirm is false",
        { action: "resendFiltered", item: "MyApp.Service", from: "2026-07-01", dryRun: false, confirm: false },
        {
          action: "resendFiltered",
          item: "MyApp.Service",
          from: "2026-07-01",
          namespace: "USER",
          dryRun: false,
          confirm: false,
        },
      ],
    ];

    it.each(notAsked)("does not ask when %s, and the request still goes to IRIS", async (_label, args, body) => {
      const { confirm, requests } = recordingConfirm(proceed);

      await messageResendTool.handler(args, { ...ctx, confirm });

      expect(requests).toHaveLength(0);
      expect(mockHttp.post.mock.calls).toStrictEqual([[RESEND_PATH, body]]);
    });

    it.each([
      ["item", { action: "resendFiltered", from: "2026-07-01", dryRun: false, confirm: true }],
      ["from", { action: "resendFiltered", item: "MyApp.Service", dryRun: false, confirm: true }],
    ])("does not ask when %s is missing: the validation error comes back and nothing is posted", async (field, args) => {
      const { confirm, requests } = recordingConfirm(proceed);

      const result = await messageResendTool.handler(args, { ...ctx, confirm });

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain(`'${field}' is required`);
      expect(requests).toHaveLength(0);
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("returns a declined outcome unchanged; the execute POST is never made", async () => {
      const { confirm, requests } = recordingConfirm(decline);

      const result = await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });

      expect(result).toBe(declinedResult);
      expect(requests).toHaveLength(1);
      expect(mockHttp.post).not.toHaveBeenCalled();
    });

    it("returns a declined outcome unchanged after the scope function ran; only the preflight was posted", async () => {
      const { confirm } = recordingConfirm(async (request) => {
        if (typeof request.scope === "function") await request.scope();
        return { proceed: false, result: declinedResult };
      });

      const result = await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });

      expect(result).toBe(declinedResult);
      expect(mockHttp.post.mock.calls).toStrictEqual([[RESEND_PATH, FILTER_PREFLIGHT_BODY]]);
      expect(postsWithDryRun(false)).toHaveLength(0);
    });

    it("sends the execute POST as before after a scope function that ran and proceeded", async () => {
      const without = await messageResendTool.handler(FILTER_ARGS, ctx);
      mockHttp.post.mockClear();
      let scopeText: string | undefined = "not run";
      const { confirm } = recordingConfirm(async (request) => {
        if (typeof request.scope === "function") scopeText = await request.scope();
        return { proceed: true };
      });

      const result = await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });

      expect(scopeText).toBe(
        "7 message(s) match now (status Errored, from 2026-07-01 00:00:00 to 2026-07-02 00:00:00); " +
          "IRIS counts again when it runs and resends at most 100",
      );
      expect(mockHttp.post.mock.calls).toStrictEqual([
        [RESEND_PATH, FILTER_PREFLIGHT_BODY],
        [RESEND_PATH, FILTER_EXECUTE_BODY],
      ]);
      expect(result).toStrictEqual(without);
    });

    it("sends the execute POST exactly as before when the preflight found more matches than the cap", async () => {
      const without = await messageResendTool.handler(FILTER_ARGS, ctx);
      mockHttp.post.mockClear();
      preflightAnswer = async () => envelope(dryRunReply({ matchCount: 101, maxMessages: 100 }));
      let scopeText: string | undefined = "not run";
      const { confirm } = recordingConfirm(async (request) => {
        if (typeof request.scope === "function") scopeText = await request.scope();
        return { proceed: true };
      });

      const result = await messageResendTool.handler(FILTER_ARGS, { ...ctx, confirm });

      expect(scopeText).toBeUndefined();
      expect(postsWithDryRun(false)).toStrictEqual([[RESEND_PATH, FILTER_EXECUTE_BODY]]);
      expect(mockHttp.post.mock.calls.at(-1)).toStrictEqual([RESEND_PATH, FILTER_EXECUTE_BODY]);
      expect(result).toStrictEqual(without);
    });

    it.each([
      ["item and from only", FILTER_ARGS, FILTER_EXECUTE_BODY],
      ["every filter field", FULL_ARGS, FULL_EXECUTE_BODY],
    ])("posts exactly as it does without a confirm when the outcome is proceed (%s)", async (_label, args, body) => {
      const without = await messageResendTool.handler(args, ctx);
      const withoutCalls = [...mockHttp.post.mock.calls];
      mockHttp.post.mockClear();

      const { confirm } = recordingConfirm(proceed);
      const result = await messageResendTool.handler(args, { ...ctx, confirm });

      expect(withoutCalls).toStrictEqual([[RESEND_PATH, body]]);
      expect(mockHttp.post.mock.calls).toStrictEqual(withoutCalls);
      expect(result).toStrictEqual(without);
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain("resendFiltered: 7 matched, 1/1 succeeded, 0 failed");
    });

    it("runs as it does today when the context has no confirm: one POST, no preflight", async () => {
      expect(ctx.confirm).toBeUndefined();

      const result = await messageResendTool.handler(FILTER_ARGS, ctx);

      expect(mockHttp.post.mock.calls).toStrictEqual([[RESEND_PATH, FILTER_EXECUTE_BODY]]);
      expect(postsWithDryRun(true)).toHaveLength(0);
      expect(result.isError).toBeUndefined();
      expect(result.content[0]?.text).toContain("resendFiltered: 7 matched, 1/1 succeeded, 0 failed");
    });
  });
});
