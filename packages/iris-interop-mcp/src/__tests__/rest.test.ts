import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  interopRestTool,
} from "../tools/rest.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris_interop_rest ──────────────────────────────────────────

describe("iris_interop_rest", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(interopRestTool.name).toBe("iris_interop_rest");
    expect(interopRestTool.annotations?.destructiveHint).toBe(true);
    expect(interopRestTool.annotations?.readOnlyHint).toBe(false);
    expect(interopRestTool.scope).toBe("NS");
  });

  // 35.5 (AC 35.5.3): the documented example must be a value the real server
  // ACCEPTS — %REST.API.CreateApplication validates $zname(name,4), so the name
  // is an ObjectScript PACKAGE name and '/myapi' is rejected. Assert actual
  // string content (not toBeTruthy) so a vacuous description fails the pin.
  it("name description states the package-name contract (35.5)", () => {
    const shape = interopRestTool.inputSchema.shape as Record<
      string,
      { description?: string }
    >;
    const desc = shape.name?.description ?? "";
    expect(desc).toContain("package name");
    expect(desc).toContain("'MyApi'");
    // the rejected form must be documented AS rejected
    expect(desc).toContain("'/myapi'");
    expect(desc).toContain("rejected");
  });

  it("should send POST with create action and spec", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "MyApi" }),
    );

    const spec = { openapi: "3.0.0", info: { title: "MyAPI", version: "1.0" } };

    const result = await interopRestTool.handler(
      { action: "create", name: "MyApi", spec },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/rest",
      expect.objectContaining({
        action: "create",
        name: "MyApi",
        spec,
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("MyApi");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST with delete action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "MyApi" }),
    );

    const result = await interopRestTool.handler(
      { action: "delete", name: "MyApi" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/rest",
      expect.objectContaining({
        action: "delete",
        name: "MyApi",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("deleted");
  });

  it("should send POST with get action", async () => {
    const returnedSpec = { openapi: "3.0.0", info: { title: "MyAPI", version: "1.0" } };
    mockHttp.post.mockResolvedValue(
      envelope({ action: "get", name: "MyApi", spec: returnedSpec }),
    );

    const result = await interopRestTool.handler(
      { action: "get", name: "MyApi" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/rest",
      expect.objectContaining({
        action: "get",
        name: "MyApi",
      }),
    );

    const structured = result.structuredContent as {
      action: string;
      name: string;
      spec: { openapi: string };
    };
    expect(structured.action).toBe("get");
    expect(structured.spec.openapi).toBe("3.0.0");
  });

  it("should pass resolved namespace in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "TestApi" }),
    );

    await interopRestTool.handler(
      { action: "create", name: "TestApi", namespace: "MYNS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/rest",
      expect.objectContaining({ namespace: "MYNS" }),
    );
  });

  it("should not include spec in body when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "TestApi" }),
    );

    await interopRestTool.handler(
      { action: "delete", name: "TestApi" },
      ctx,
    );

    const callBody = mockHttp.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(callBody.spec).toBeUndefined();
  });

  it("should accept spec as string", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "TestApi" }),
    );

    const specString = '{"openapi":"3.0.0"}';

    await interopRestTool.handler(
      { action: "create", name: "TestApi", spec: specString },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/rest",
      expect.objectContaining({
        spec: specString,
      }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Invalid" }], "/api/executemcp/v2/interop/rest", "REST error"),
    );

    const result = await interopRestTool.handler(
      { action: "create", name: "BadApi" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing REST application");
    expect(result.content[0]?.text).toContain("BadApi");
  });

  it("should rethrow non-IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(new Error("Network failure"));

    await expect(
      interopRestTool.handler({ action: "create", name: "TestApi" }, ctx),
    ).rejects.toThrow("Network failure");
  });
});
