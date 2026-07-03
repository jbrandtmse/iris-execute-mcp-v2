/**
 * Tests for `iris_message_diagram` (Epic 21, Story 21.0 — AC 21.0.7/21.0.9/21.0.12).
 *
 * Mocked-HTTP unit tests covering: request wiring (CSV sessionIds, Rule #10
 * wire-explicit labelMode/maxRows defaults, namespace default + explicit),
 * the decision-G3 output contract (one summary + fenced ```mermaid block per
 * session in `content`; the endpoint result OBJECT verbatim in
 * `structuredContent`), Zod schema rejections, and the IrisApiError envelope.
 *
 * Also carries the AC 21.0.9 back-compat gate (Rule #19, mechanical):
 * a full-object `toEqual` snapshot proving `iris_production_messages`' request
 * path/params and output handling are byte-for-byte unchanged by this story.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { z } from "zod";
import { messageDiagramTool } from "../tools/diagram.js";
import { productionMessagesTool } from "../tools/monitor.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

/** One realistic diagram entry as the endpoint returns it. */
function sampleDiagram(sessionId: number, overrides?: Partial<Record<string, unknown>>) {
  return {
    sessionId,
    mermaid:
      "sequenceDiagram\n" +
      `%% Session ${sessionId}: 2 messages, 2026-07-02 10:00:01 .. 2026-07-02 10:00:02\n` +
      "participant Demo.Service\n" +
      "participant Demo.Process\n" +
      "Demo.Service->>Demo.Process: Demo.Msg.Req\n" +
      "Demo.Process->>Demo.Service: Demo.Msg.Resp",
    messageCount: 2,
    warnings: [] as string[],
    truncated: false,
    ...overrides,
  };
}

describe("iris_message_diagram", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── request wiring ─────────────────────────────────────────────

  it("should GET the diagram endpoint with CSV sessionIds and wire-explicit defaults (Rule #10)", async () => {
    mockHttp.get.mockResolvedValue(envelope({ diagrams: [sampleDiagram(12)], count: 1 }));

    await messageDiagramTool.handler({ sessionIds: [12, 34] }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toBe(
      "/api/executemcp/v2/interop/production/messages/diagram?namespace=USER&sessionIds=12%2C34&labelMode=full&maxRows=2000",
    );
  });

  it("should send explicit labelMode, maxRows, and namespace when provided", async () => {
    mockHttp.get.mockResolvedValue(envelope({ diagrams: [], count: 0 }));

    await messageDiagramTool.handler(
      { sessionIds: [7], labelMode: "short", maxRows: 500, namespace: "MYNS" },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=MYNS");
    expect(calledPath).toContain("sessionIds=7");
    expect(calledPath).toContain("labelMode=short");
    expect(calledPath).toContain("maxRows=500");
  });

  // ── output contract (decision G3) ──────────────────────────────

  it("should return one summary + fenced mermaid block per session in content", async () => {
    const result = {
      diagrams: [sampleDiagram(12), sampleDiagram(34, { messageCount: 0 })],
      count: 2,
    };
    mockHttp.get.mockResolvedValue(envelope(result));

    const toolResult = await messageDiagramTool.handler({ sessionIds: [12, 34] }, ctx);

    expect(toolResult.isError).toBeUndefined();
    expect(toolResult.content).toHaveLength(2);
    const first = toolResult.content[0]?.text as string;
    expect(first.startsWith("Session 12: 2 messages")).toBe(true);
    expect(first).toContain("```mermaid\nsequenceDiagram\n");
    expect(first.endsWith("\n```")).toBe(true);
    const second = toolResult.content[1]?.text as string;
    expect(second.startsWith("Session 34: 0 messages")).toBe(true);
  });

  it("should return the endpoint result OBJECT verbatim as structuredContent", async () => {
    const result = { diagrams: [sampleDiagram(12)], count: 1 };
    mockHttp.get.mockResolvedValue(envelope(result));

    const toolResult = await messageDiagramTool.handler({ sessionIds: [12] }, ctx);

    // Object (never a bare array) — established MCP structuredContent constraint.
    expect(Array.isArray(toolResult.structuredContent)).toBe(false);
    expect(toolResult.structuredContent).toEqual(result);
  });

  it("should surface truncation and warning counts in the summary line", async () => {
    const result = {
      diagrams: [
        sampleDiagram(9, {
          truncated: true,
          warnings: ["Unpaired request: message 1", "Error on message 2: boom"],
        }),
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(result));

    const toolResult = await messageDiagramTool.handler({ sessionIds: [9] }, ctx);

    const text = toolResult.content[0]?.text as string;
    expect(text.startsWith("Session 9: 2 messages (truncated, 2 warnings)")).toBe(true);
  });

  it("should render a singular warning count without the plural s", async () => {
    const result = {
      diagrams: [sampleDiagram(9, { warnings: ["only one"] })],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(result));

    const toolResult = await messageDiagramTool.handler({ sessionIds: [9] }, ctx);

    const text = toolResult.content[0]?.text as string;
    expect(text.startsWith("Session 9: 2 messages (1 warning)")).toBe(true);
  });

  it("should render a singular message count without the plural s (CR 21.0 review)", async () => {
    const result = {
      diagrams: [sampleDiagram(9, { messageCount: 1 })],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(result));

    const toolResult = await messageDiagramTool.handler({ sessionIds: [9] }, ctx);

    const text = toolResult.content[0]?.text as string;
    expect(text.startsWith("Session 9: 1 message\n")).toBe(true);
  });

  // ── Zod schema ─────────────────────────────────────────────────

  it("should reject an empty sessionIds array", () => {
    const parsed = messageDiagramTool.inputSchema.safeParse({ sessionIds: [] });
    expect(parsed.success).toBe(false);
  });

  it("should reject more than 20 sessionIds", () => {
    const ids = Array.from({ length: 21 }, (_, i) => i + 1);
    const parsed = messageDiagramTool.inputSchema.safeParse({ sessionIds: ids });
    expect(parsed.success).toBe(false);
  });

  it("should reject non-positive and non-integer sessionIds", () => {
    expect(messageDiagramTool.inputSchema.safeParse({ sessionIds: [0] }).success).toBe(false);
    expect(messageDiagramTool.inputSchema.safeParse({ sessionIds: [-5] }).success).toBe(false);
    expect(messageDiagramTool.inputSchema.safeParse({ sessionIds: [1.5] }).success).toBe(false);
  });

  it("should reject an invalid labelMode", () => {
    const parsed = messageDiagramTool.inputSchema.safeParse({
      sessionIds: [1],
      labelMode: "fancy",
    });
    expect(parsed.success).toBe(false);
  });

  it("should reject out-of-range maxRows", () => {
    expect(
      messageDiagramTool.inputSchema.safeParse({ sessionIds: [1], maxRows: 0 }).success,
    ).toBe(false);
    expect(
      messageDiagramTool.inputSchema.safeParse({ sessionIds: [1], maxRows: 10001 }).success,
    ).toBe(false);
  });

  it("should accept a minimal valid input", () => {
    const parsed = messageDiagramTool.inputSchema.safeParse({ sessionIds: [1] });
    expect(parsed.success).toBe(true);
  });

  // ── error handling ─────────────────────────────────────────────

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/interop/production/messages/diagram",
        "Server error",
      ),
    );

    const result = await messageDiagramTool.handler({ sessionIds: [1] }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error generating message diagram");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      messageDiagramTool.handler({ sessionIds: [1] }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  // ── tool metadata (AC 21.0.7 / 21.0.8) ─────────────────────────

  it("should carry the read-only annotations", () => {
    expect(messageDiagramTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS and scalar mutates read", () => {
    expect(messageDiagramTool.scope).toBe("NS");
    expect(messageDiagramTool.mutates).toBe("read");
  });

  it("should mention Visual Trace and iris_production_messages in the description", () => {
    expect(messageDiagramTool.description).toContain("Visual Trace");
    expect(messageDiagramTool.description).toContain("iris_production_messages");
  });
});

// ── AC 21.0.9 back-compat gate (Rule #19, mechanical) ────────────

describe("iris_production_messages back-compat snapshot (AC 21.0.9)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("request path/params and full output envelope are byte-for-byte unchanged", async () => {
    const messagesResult = {
      messages: [
        {
          id: 101,
          sourceItem: "Demo.Service",
          targetItem: "Demo.Process",
          messageClass: "Demo.Msg.Req",
          timeCreated: "2026-07-02 10:00:01",
          status: 4,
          sessionId: 12,
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(messagesResult));

    const result = await productionMessagesTool.handler(
      { sessionId: 12, count: 50 },
      ctx,
    );

    // Exact request wiring — same path, same param set, same order as pre-21.0.
    expect(mockHttp.get.mock.calls[0]?.[0]).toBe(
      "/api/executemcp/v2/interop/production/messages?namespace=USER&sessionId=12&count=50",
    );
    // Full-object snapshot of the tool result envelope.
    expect(result).toEqual({
      content: [
        { type: "text", text: JSON.stringify(messagesResult, null, 2) },
      ],
      structuredContent: messagesResult,
    });
  });

  it("input schema keys are unchanged (no new/removed parameters)", () => {
    const shape = (productionMessagesTool.inputSchema as z.ZodObject<z.ZodRawShape>).shape;
    expect(Object.keys(shape).sort()).toEqual([
      "count",
      "headerId",
      "namespace",
      "sessionId",
    ]);
  });

  it("missing sessionId/headerId still short-circuits without an HTTP call", async () => {
    const result = await productionMessagesTool.handler({}, ctx);
    expect(result).toEqual({
      content: [
        {
          type: "text",
          text: "Error: at least one of 'sessionId' or 'headerId' is required",
        },
      ],
      isError: true,
    });
    expect(mockHttp.get).not.toHaveBeenCalled();
  });
});
