import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { alertsManageTool } from "../tools/alerts.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_alerts_manage ──────────────────────────────────────

describe("iris_alerts_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(alertsManageTool.scope).toBe("NONE");
  });

  it("should have correct annotations", () => {
    expect(alertsManageTool.annotations.readOnlyHint).toBe(false);
    expect(alertsManageTool.annotations.destructiveHint).toBe(true);
    expect(alertsManageTool.annotations.idempotentHint).toBe(true);
    expect(alertsManageTool.annotations.openWorldHint).toBe(false);
  });

  it("reset action calls the alerts manage endpoint", async () => {
    const responseData = {
      action: "reset",
      clearedAt: "2026-04-22T10:50:00Z",
    };
    mockHttp.post.mockResolvedValue(envelope(responseData));

    const result = await alertsManageTool.handler({ action: "reset" }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/monitor/alerts/manage",
      { action: "reset" },
    );
    expect(result.isError).toBeUndefined();
  });

  it("reset action returns clearedAt timestamp", async () => {
    const responseData = {
      action: "reset",
      clearedAt: "2026-04-22T10:50:00Z",
    };
    mockHttp.post.mockResolvedValue(envelope(responseData));

    const result = await alertsManageTool.handler({ action: "reset" }, ctx);

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      action: string;
      clearedAt: string;
    };
    expect(structured.action).toBe("reset");
    expect(structured.clearedAt).toBe("2026-04-22T10:50:00Z");
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Action: reset");
    expect(text).toContain("Cleared At: 2026-04-22T10:50:00Z");
  });

  it("rejects invalid action at Zod layer", () => {
    const parseResult = alertsManageTool.inputSchema.safeParse({
      action: "acknowledge",
    });
    expect(parseResult.success).toBe(false);
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/alerts/manage",
        "Server error",
      ),
    );

    const result = await alertsManageTool.handler({ action: "reset" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing alerts");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      alertsManageTool.handler({ action: "reset" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });
});
