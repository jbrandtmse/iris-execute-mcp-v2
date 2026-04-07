import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  lookupManageTool,
  lookupTransferTool,
} from "../tools/lookup.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris.lookup.manage ──────────────────────────────────────────

describe("iris.lookup.manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(lookupManageTool.name).toBe("iris.lookup.manage");
    expect(lookupManageTool.annotations?.destructiveHint).toBe(true);
    expect(lookupManageTool.annotations?.readOnlyHint).toBe(false);
    expect(lookupManageTool.scope).toBe("NS");
  });

  it("should send POST with get action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "get",
        tableName: "EmailRouting",
        key: "support",
        value: "support@example.com",
        exists: true,
      }),
    );

    const result = await lookupManageTool.handler(
      { action: "get", tableName: "EmailRouting", key: "support" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/lookup",
      expect.objectContaining({
        action: "get",
        tableName: "EmailRouting",
        key: "support",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      tableName: string;
      key: string;
      value: string;
      exists: boolean;
    };
    expect(structured.action).toBe("get");
    expect(structured.value).toBe("support@example.com");
    expect(structured.exists).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("should send POST with set action and value", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "set",
        tableName: "EmailRouting",
        key: "sales",
        value: "sales@example.com",
      }),
    );

    const result = await lookupManageTool.handler(
      { action: "set", tableName: "EmailRouting", key: "sales", value: "sales@example.com" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/lookup",
      expect.objectContaining({
        action: "set",
        tableName: "EmailRouting",
        key: "sales",
        value: "sales@example.com",
      }),
    );

    const structured = result.structuredContent as { action: string; value: string };
    expect(structured.action).toBe("set");
    expect(structured.value).toBe("sales@example.com");
  });

  it("should send POST with delete action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "deleted",
        tableName: "EmailRouting",
        key: "old-entry",
      }),
    );

    const result = await lookupManageTool.handler(
      { action: "delete", tableName: "EmailRouting", key: "old-entry" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/lookup",
      expect.objectContaining({
        action: "delete",
        tableName: "EmailRouting",
        key: "old-entry",
      }),
    );

    const structured = result.structuredContent as { action: string; key: string };
    expect(structured.action).toBe("deleted");
  });

  it("should pass resolved namespace in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "get", tableName: "T", key: "k", value: "v", exists: true }),
    );

    await lookupManageTool.handler(
      { action: "get", tableName: "T", key: "k", namespace: "PROD" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/lookup",
      expect.objectContaining({ namespace: "PROD" }),
    );
  });

  it("should not include value in body when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "get", tableName: "T", key: "k", value: "", exists: false }),
    );

    await lookupManageTool.handler(
      { action: "get", tableName: "T", key: "k" },
      ctx,
    );

    const callBody = mockHttp.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(callBody.value).toBeUndefined();
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Invalid" }], "/api/executemcp/v2/interop/lookup", "Lookup error"),
    );

    const result = await lookupManageTool.handler(
      { action: "get", tableName: "T", key: "k" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing lookup table");
    expect(result.content[0]?.text).toContain("T");
  });

  it("should rethrow non-IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(new Error("Network failure"));

    await expect(
      lookupManageTool.handler({ action: "get", tableName: "T", key: "k" }, ctx),
    ).rejects.toThrow("Network failure");
  });
});

// ── iris.lookup.transfer ────────────────────────────────────────

describe("iris.lookup.transfer", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(lookupTransferTool.name).toBe("iris.lookup.transfer");
    expect(lookupTransferTool.annotations?.destructiveHint).toBe(true);
    expect(lookupTransferTool.annotations?.readOnlyHint).toBe(false);
    expect(lookupTransferTool.scope).toBe("NS");
  });

  it("should send POST with export action", async () => {
    const xmlContent = '<lookupTable name="Routes"><entry key="a" value="1" /></lookupTable>';
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "exported",
        tableName: "Routes",
        entryCount: 1,
        xml: xmlContent,
      }),
    );

    const result = await lookupTransferTool.handler(
      { action: "export", tableName: "Routes" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/lookup/transfer",
      expect.objectContaining({
        action: "export",
        tableName: "Routes",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      tableName: string;
      entryCount: number;
      xml: string;
    };
    expect(structured.action).toBe("exported");
    expect(structured.entryCount).toBe(1);
    expect(structured.xml).toContain("<lookupTable");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST with import action and xml", async () => {
    const xmlContent = '<lookupTable name="Routes"><entry key="a" value="1" /></lookupTable>';
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "imported",
        tableName: "Routes",
        entryCount: 1,
      }),
    );

    const result = await lookupTransferTool.handler(
      { action: "import", tableName: "Routes", xml: xmlContent },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/lookup/transfer",
      expect.objectContaining({
        action: "import",
        tableName: "Routes",
        xml: xmlContent,
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      tableName: string;
      entryCount: number;
    };
    expect(structured.action).toBe("imported");
    expect(structured.entryCount).toBe(1);
  });

  it("should not include xml in body when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "exported", tableName: "T", entryCount: 0, xml: "<lookupTable />" }),
    );

    await lookupTransferTool.handler(
      { action: "export", tableName: "T" },
      ctx,
    );

    const callBody = mockHttp.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(callBody.xml).toBeUndefined();
  });

  it("should pass resolved namespace in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "exported", tableName: "T", entryCount: 0, xml: "" }),
    );

    await lookupTransferTool.handler(
      { action: "export", tableName: "T", namespace: "MYNS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/lookup/transfer",
      expect.objectContaining({ namespace: "MYNS" }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Invalid XML" }], "/api/executemcp/v2/interop/lookup/transfer", "Transfer error"),
    );

    const result = await lookupTransferTool.handler(
      { action: "import", tableName: "Bad", xml: "<invalid>" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error transferring lookup table");
    expect(result.content[0]?.text).toContain("Bad");
  });

  it("should rethrow non-IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(new Error("Timeout"));

    await expect(
      lookupTransferTool.handler({ action: "export", tableName: "T" }, ctx),
    ).rejects.toThrow("Timeout");
  });
});
