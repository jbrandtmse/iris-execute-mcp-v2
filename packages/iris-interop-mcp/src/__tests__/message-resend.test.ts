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
import { IrisApiError } from "@iris-mcp/shared";
import { messageResendTool } from "../tools/message-resend.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

describe("iris_message_resend", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
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
