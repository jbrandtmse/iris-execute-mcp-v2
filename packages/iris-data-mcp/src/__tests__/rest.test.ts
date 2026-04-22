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

  // Bug #13: scope:"spec-first" (default) must still route to the Mgmnt API
  // at /api/mgmnt/v2/{ns}/ — this preserves current behavior so AI clients
  // and scripts depending on the pre-Story-11.4 response shape continue to
  // work unchanged.
  it("scope:'spec-first' (default) hits Mgmnt API /api/mgmnt/v2/{ns}/ (Bug #13)", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await restManageTool.handler(
      { action: "list", scope: "spec-first", namespace: "HSCUSTOM" },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toMatch(/^\/api\/mgmnt\/v2\//);
    expect(calledPath).not.toContain("/api/executemcp/v2");
  });

  // FEAT-2: scope:"legacy" (was scope:"all" before Story 12.5 — BREAKING)
  // routes to ExecuteMCPv2 webapp endpoint, filters for non-empty dispatchClass.
  it("FEAT-2: scope:'legacy' routes to ExecuteMCPv2 webapp endpoint and filters by dispatchClass", async () => {
    const webapps = [
      {
        name: "/api/executemcp/v2",
        dispatchClass: "ExecuteMCPv2.REST.Dispatch",
        namespace: "HSCUSTOM",
      },
      // Plain CSP webapp — no dispatch class. Must be filtered out.
      {
        name: "/csp/user",
        dispatchClass: "",
        namespace: "USER",
      },
      {
        name: "/api/other",
        dispatchClass: "Other.REST",
        namespace: "HSCUSTOM",
      },
    ];
    mockHttp.get.mockResolvedValue(envelope(webapps));

    const result = await restManageTool.handler(
      { action: "list", scope: "legacy", namespace: "HSCUSTOM" },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toMatch(/^\/api\/executemcp\/v2\/security\/webapp/);
    expect(calledPath).toContain("namespace=HSCUSTOM");
    expect(result.isError).toBeUndefined();

    const structured = result.structuredContent as {
      items: Array<Record<string, unknown>>;
      count: number;
    };
    expect(structured.count).toBe(2);
    expect(structured.items[0]).toEqual({
      name: "/api/executemcp/v2",
      dispatchClass: "ExecuteMCPv2.REST.Dispatch",
      namespace: "HSCUSTOM",
      swaggerSpec: null,
    });
    expect(structured.items.some((x) => x.name === "/csp/user")).toBe(false);
  });

  // FEAT-2: scope:"all" is the NEW union of spec-first + legacy
  it("FEAT-2: scope:'all' returns union of spec-first and legacy apps", async () => {
    const specFirstApps = [
      { name: "/api/spec-app", dispatchClass: "SpecApp.Disp", swaggerSpec: "/swagger/spec-app" },
    ];
    const legacyWebapps = [
      { name: "/api/executemcp/v2", dispatchClass: "ExecuteMCPv2.REST.Dispatch", namespace: "HSCUSTOM" },
      { name: "/csp/user", dispatchClass: "", namespace: "USER" }, // filtered out
    ];

    // scope:"all" makes two calls: mgmnt API for spec-first, executemcp for legacy
    mockHttp.get
      .mockResolvedValueOnce(envelope(specFirstApps))   // spec-first call
      .mockResolvedValueOnce(envelope(legacyWebapps));   // legacy call

    const result = await restManageTool.handler(
      { action: "list", scope: "all", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as { items: Array<Record<string, unknown>>; count: number };
    // spec-first app + 1 legacy (filtered) = 2 total
    expect(structured.count).toBe(2);
    const names = structured.items.map((x) => x.name);
    expect(names).toContain("/api/spec-app");
    expect(names).toContain("/api/executemcp/v2");
    expect(names).not.toContain("/csp/user");
  });

  // Bug #13 backward compat: scope:"all" (old behavior = now scope:"legacy")
  it("scope:'all' routes to ExecuteMCPv2 webapp endpoint and filters by dispatchClass (Bug #13 backward compat via scope:legacy)", async () => {
    const webapps = [
      {
        name: "/api/executemcp/v2",
        dispatchClass: "ExecuteMCPv2.REST.Dispatch",
        namespace: "HSCUSTOM",
      },
      {
        name: "/csp/user",
        dispatchClass: "",
        namespace: "USER",
      },
      {
        name: "/api/other",
        dispatchClass: "Other.REST",
        namespace: "HSCUSTOM",
      },
    ];
    // The old test used scope:"all". Now scope:"all" is the union — two calls.
    // Test the old behavior via scope:"legacy".
    mockHttp.get.mockResolvedValue(envelope(webapps));

    const result = await restManageTool.handler(
      { action: "list", scope: "legacy", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      items: Array<Record<string, unknown>>;
      count: number;
    };
    expect(structured.count).toBe(2);
    expect(structured.items[0]).toEqual({
      name: "/api/executemcp/v2",
      dispatchClass: "ExecuteMCPv2.REST.Dispatch",
      namespace: "HSCUSTOM",
      swaggerSpec: null,
    });
    expect(structured.items[1]).toEqual({
      name: "/api/other",
      dispatchClass: "Other.REST",
      namespace: "HSCUSTOM",
      swaggerSpec: null,
    });
    expect(structured.items.some((x) => x.name === "/csp/user")).toBe(false);
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

  it("should get REST application details via GET (fullSpec:true returns full blob)", async () => {
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
      { action: "get", application: "/api/myapp", fullSpec: true },
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

  // FEAT-6: fullSpec:false (default) returns summary instead of full blob
  it("FEAT-6: get with fullSpec:false (default) returns swagger summary", async () => {
    const fullAppDetails = {
      name: "/api/myapp",
      dispatchClass: "MyApp.REST",
      namespace: "USER",
      swaggerSpec: {
        basePath: "/api/myapp",
        info: {
          title: "My App API",
          version: "1.0",
          description: "My application REST API",
        },
        paths: {
          "/items": { get: {}, post: {} },
          "/items/{id}": { get: {}, put: {}, delete: {} },
        },
        definitions: {
          Item: { type: "object" },
          Error: { type: "object" },
        },
      },
    };
    mockHttp.get.mockResolvedValue(envelope(fullAppDetails));

    const result = await restManageTool.handler(
      { action: "get", application: "/api/myapp", fullSpec: false },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.name).toBe("/api/myapp");
    expect(structured.dispatchClass).toBe("MyApp.REST");
    // Summary mode: swaggerSpec should be a summary object, NOT the full blob
    const swagger = structured.swaggerSpec as Record<string, unknown>;
    expect(swagger).toHaveProperty("basePath", "/api/myapp");
    expect(swagger).toHaveProperty("pathCount", 2);
    expect(swagger).toHaveProperty("definitionCount", 2);
    expect(swagger).toHaveProperty("title", "My App API");
    expect(swagger).toHaveProperty("version", "1.0");
    expect(swagger).toHaveProperty("description", "My application REST API");
    // Full paths/definitions should NOT be present
    expect(swagger).not.toHaveProperty("paths");
    expect(swagger).not.toHaveProperty("definitions");
  });

  it("FEAT-6: get with fullSpec:true returns full swagger blob", async () => {
    const fullAppDetails = {
      name: "/api/myapp",
      dispatchClass: "MyApp.REST",
      namespace: "USER",
      swaggerSpec: {
        basePath: "/api/myapp",
        paths: { "/items": { get: {} } },
        definitions: { Item: {} },
      },
    };
    mockHttp.get.mockResolvedValue(envelope(fullAppDetails));

    const result = await restManageTool.handler(
      { action: "get", application: "/api/myapp", fullSpec: true },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as Record<string, unknown>;
    // Full spec mode: should return the complete structure
    expect(structured).toEqual(fullAppDetails);
  });

  it("FEAT-6: get with no fullSpec param (default false) returns summary", async () => {
    const fullAppDetails = {
      name: "/api/myapp",
      dispatchClass: "MyApp.REST",
      namespace: "USER",
      swaggerSpec: {
        basePath: "/api/myapp",
        info: { title: "T", version: "1.0", description: "D" },
        paths: { "/a": {}, "/b": {} },
        definitions: {},
      },
    };
    mockHttp.get.mockResolvedValue(envelope(fullAppDetails));

    const result = await restManageTool.handler(
      { action: "get", application: "/api/myapp" }, // no fullSpec — defaults to false
      ctx,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    const swagger = structured.swaggerSpec as Record<string, unknown>;
    // Default (no fullSpec arg) => summary mode
    expect(swagger).toHaveProperty("pathCount", 2);
    expect(swagger).not.toHaveProperty("paths");
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
