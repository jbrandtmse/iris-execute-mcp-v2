import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  productionLogsTool,
  productionQueuesTool,
  productionMessagesTool,
  productionAdaptersTool,
} from "../tools/monitor.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris.production.logs ─────────────────────────────────────

describe("iris.production.logs", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send GET with namespace query param", async () => {
    const logData = {
      entries: [
        { id: 1, timestamp: "2026-04-06 12:00:00", type: "Error", itemName: "MyService", text: "Connection failed" },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(logData));

    const result = await productionLogsTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/interop/production/logs"),
    );
    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=USER");

    const structured = result.structuredContent as typeof logData;
    expect(structured.entries).toHaveLength(1);
    expect(structured.count).toBe(1);
    expect(result.isError).toBeUndefined();
  });

  it("should include type filter in query params", async () => {
    mockHttp.get.mockResolvedValue(envelope({ entries: [], count: 0 }));

    await productionLogsTool.handler({ type: "Error" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("type=Error");
  });

  it("should include itemName filter in query params", async () => {
    mockHttp.get.mockResolvedValue(envelope({ entries: [], count: 0 }));

    await productionLogsTool.handler({ itemName: "MyService" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("itemName=MyService");
  });

  it("should include count in query params", async () => {
    mockHttp.get.mockResolvedValue(envelope({ entries: [], count: 0 }));

    await productionLogsTool.handler({ count: 50 }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("count=50");
  });

  it("should pass resolved namespace from args", async () => {
    mockHttp.get.mockResolvedValue(envelope({ entries: [], count: 0 }));

    await productionLogsTool.handler({ namespace: "MYNS" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=MYNS");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/production/logs", "Server error"),
    );

    const result = await productionLogsTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error querying production logs");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionLogsTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(productionLogsTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionLogsTool.scope).toBe("NS");
  });
});

// ── iris.production.queues ───────────────────────────────────

describe("iris.production.queues", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send GET with namespace query param", async () => {
    const queueData = {
      queues: [
        { name: "MyService", count: 5 },
        { name: "MyOperation", count: 0 },
      ],
      count: 2,
    };
    mockHttp.get.mockResolvedValue(envelope(queueData));

    const result = await productionQueuesTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/interop/production/queues"),
    );

    const structured = result.structuredContent as typeof queueData;
    expect(structured.queues).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(result.isError).toBeUndefined();
  });

  it("should pass resolved namespace from args", async () => {
    mockHttp.get.mockResolvedValue(envelope({ queues: [], count: 0 }));

    await productionQueuesTool.handler({ namespace: "MYNS" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=MYNS");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/production/queues", "Server error"),
    );

    const result = await productionQueuesTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error querying production queues");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionQueuesTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(productionQueuesTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionQueuesTool.scope).toBe("NS");
  });
});

// ── iris.production.messages ─────────────────────────────────

describe("iris.production.messages", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send GET with sessionId query param", async () => {
    const msgData = {
      messages: [
        {
          id: 101,
          sourceItem: "MyService",
          targetItem: "MyProcess",
          messageClass: "Ens.Request",
          timeCreated: "2026-04-06 12:00:00",
          status: "Completed",
          sessionId: 42,
        },
      ],
      count: 1,
    };
    mockHttp.get.mockResolvedValue(envelope(msgData));

    const result = await productionMessagesTool.handler({ sessionId: 42 }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("sessionId=42");
    expect(calledPath).toContain("namespace=USER");

    const structured = result.structuredContent as typeof msgData;
    expect(structured.messages).toHaveLength(1);
    expect(structured.messages[0]?.sourceItem).toBe("MyService");
    expect(result.isError).toBeUndefined();
  });

  it("should send GET with headerId query param", async () => {
    mockHttp.get.mockResolvedValue(envelope({ messages: [], count: 0 }));

    await productionMessagesTool.handler({ headerId: 101 }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("headerId=101");
  });

  it("should include count in query params", async () => {
    mockHttp.get.mockResolvedValue(envelope({ messages: [], count: 0 }));

    await productionMessagesTool.handler({ sessionId: 1, count: 50 }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("count=50");
  });

  it("should pass resolved namespace from args", async () => {
    mockHttp.get.mockResolvedValue(envelope({ messages: [], count: 0 }));

    await productionMessagesTool.handler({ sessionId: 1, namespace: "MYNS" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=MYNS");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/production/messages", "Server error"),
    );

    const result = await productionMessagesTool.handler({ sessionId: 1 }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error tracing production messages");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionMessagesTool.handler({ sessionId: 1 }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(productionMessagesTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionMessagesTool.scope).toBe("NS");
  });

  it("should return error when neither sessionId nor headerId is provided", async () => {
    const result = await productionMessagesTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "at least one of 'sessionId' or 'headerId' is required",
    );
  });
});

// ── iris.production.adapters ────────────────────────────────

describe("iris.production.adapters", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send GET with namespace query param", async () => {
    const adapterData = {
      inbound: [{ name: "EnsLib.File.InboundAdapter" }],
      outbound: [{ name: "EnsLib.File.OutboundAdapter" }],
      totalCount: 2,
    };
    mockHttp.get.mockResolvedValue(envelope(adapterData));

    const result = await productionAdaptersTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/interop/production/adapters"),
    );

    const structured = result.structuredContent as typeof adapterData;
    expect(structured.inbound).toHaveLength(1);
    expect(structured.outbound).toHaveLength(1);
    expect(structured.totalCount).toBe(2);
    expect(result.isError).toBeUndefined();
  });

  it("should include category filter in query params", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ inbound: [{ name: "EnsLib.File.InboundAdapter" }], totalCount: 1 }),
    );

    await productionAdaptersTool.handler({ category: "inbound" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("category=inbound");
  });

  it("should pass resolved namespace from args", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ inbound: [], outbound: [], totalCount: 0 }),
    );

    await productionAdaptersTool.handler({ namespace: "MYNS" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("namespace=MYNS");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/production/adapters", "Server error"),
    );

    const result = await productionAdaptersTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing production adapters");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      productionAdaptersTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have readOnlyHint: true annotation", () => {
    expect(productionAdaptersTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(productionAdaptersTool.scope).toBe("NS");
  });
});
