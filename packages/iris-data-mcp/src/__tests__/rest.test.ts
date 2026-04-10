import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { restManageTool } from "../tools/rest.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_rest_manage ──────────────────────────────────────────

describe("iris_rest_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NS", () => {
    expect(restManageTool.scope).toBe("NS");
  });

  it("should have destructiveHint annotation", () => {
    expect(restManageTool.annotations.destructiveHint).toBe(true);
  });

  // ── list action ───────────────────────────────────────────

  it("should list REST applications via GET", async () => {
    const apps = [
      { name: "/api/myapp", dispatchClass: "MyApp.REST" },
      { name: "/api/other", dispatchClass: "Other.REST" },
    ];
    mockHttp.get.mockResolvedValue(envelope(apps));

    const result = await restManageTool.handler(
      { action: "list" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/mgmnt/v2/USER/"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ items: apps, count: 2 });
  });

  it("should list REST applications with custom namespace", async () => {
    const apps = [{ name: "/api/test", dispatchClass: "Test.REST" }];
    mockHttp.get.mockResolvedValue(envelope(apps));

    await restManageTool.handler(
      { action: "list", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/mgmnt/v2/HSCUSTOM/"),
    );
  });

  it("should handle non-envelope response for list", async () => {
    const plainResponse = [{ name: "/api/plain" }];
    mockHttp.get.mockResolvedValue(plainResponse);

    const result = await restManageTool.handler(
      { action: "list" },
      ctx,
    );

    expect(result.structuredContent).toEqual({ items: plainResponse, count: 1 });
  });

  // ── get action ────────────────────────────────────────────

  it("should get REST application details via GET", async () => {
    const appDetails = {
      name: "/api/myapp",
      dispatchClass: "MyApp.REST",
      routes: [
        { method: "GET", url: "/items" },
        { method: "POST", url: "/items" },
      ],
    };
    mockHttp.get.mockResolvedValue(envelope(appDetails));

    const result = await restManageTool.handler(
      { action: "get", application: "/api/myapp" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/mgmnt/v2/USER/"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(appDetails);
  });

  it("should return error when get is called without application", async () => {
    const result = await restManageTool.handler(
      { action: "get" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'application' is required");
  });

  // ── delete action ─────────────────────────────────────────

  it("should delete REST application via DELETE", async () => {
    const deleted = { status: "deleted", application: "/api/myapp" };
    mockHttp.delete.mockResolvedValue(envelope(deleted));

    const result = await restManageTool.handler(
      { action: "delete", application: "/api/myapp" },
      ctx,
    );

    expect(mockHttp.delete).toHaveBeenCalledWith(
      expect.stringContaining("/api/mgmnt/v2/USER/"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(deleted);
  });

  it("should return error when delete is called without application", async () => {
    const result = await restManageTool.handler(
      { action: "delete" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'application' is required");
  });

  // ── namespace resolution ──────────────────────────────────

  it("should use resolveNamespace for all operations", async () => {
    mockHttp.get.mockResolvedValue(envelope({ details: "ok" }));

    await restManageTool.handler(
      { action: "get", application: "/api/test", namespace: "STAGING" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/mgmnt/v2/STAGING/"),
    );
  });

  // ── URI encoding ──────────────────────────────────────────

  it("should encode special characters in namespace", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await restManageTool.handler(
      { action: "list", namespace: "NS/special" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("NS/special")),
    );
  });

  it("should encode special characters in application name", async () => {
    mockHttp.get.mockResolvedValue(envelope({ details: "ok" }));

    await restManageTool.handler(
      { action: "get", application: "/api/my app" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("/api/my app")),
    );
  });

  // ── error handling ────────────────────────────────────────

  it("should handle IrisApiError gracefully", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [], "/api/mgmnt/v2/USER/", "Internal error"),
    );

    const result = await restManageTool.handler(
      { action: "list" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error managing REST application");
  });

  it("should rethrow non-IrisApiError errors", async () => {
    mockHttp.get.mockRejectedValue(new Error("Network failure"));

    await expect(
      restManageTool.handler({ action: "list" }, ctx),
    ).rejects.toThrow("Network failure");
  });

  it("should handle IrisApiError on delete", async () => {
    mockHttp.delete.mockRejectedValue(
      new IrisApiError(404, [], "/api/mgmnt/v2/USER/notfound", "Not found"),
    );

    const result = await restManageTool.handler(
      { action: "delete", application: "/api/notfound" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error managing REST application");
  });

  it("should handle IrisApiError on get", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(404, [], "/api/mgmnt/v2/USER/missing", "Not found"),
    );

    const result = await restManageTool.handler(
      { action: "get", application: "/api/missing" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error managing REST application");
  });
});
