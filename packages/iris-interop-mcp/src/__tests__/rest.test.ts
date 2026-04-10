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

  it("should send POST with create action and spec", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "/myapi" }),
    );

    const spec = { openapi: "3.0.0", info: { title: "MyAPI", version: "1.0" } };

    const result = await interopRestTool.handler(
      { action: "create", name: "/myapi", spec },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/rest",
      expect.objectContaining({
        action: "create",
        name: "/myapi",
        spec,
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("created");
    expect(structured.name).toBe("/myapi");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST with delete action", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "/myapi" }),
    );

    const result = await interopRestTool.handler(
      { action: "delete", name: "/myapi" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/rest",
      expect.objectContaining({
        action: "delete",
        name: "/myapi",
      }),
    );

    const structured = result.structuredContent as { action: string; name: string };
    expect(structured.action).toBe("deleted");
  });

  it("should send POST with get action", async () => {
    const returnedSpec = { openapi: "3.0.0", info: { title: "MyAPI", version: "1.0" } };
    mockHttp.post.mockResolvedValue(
      envelope({ action: "get", name: "/myapi", spec: returnedSpec }),
    );

    const result = await interopRestTool.handler(
      { action: "get", name: "/myapi" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/rest",
      expect.objectContaining({
        action: "get",
        name: "/myapi",
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
      envelope({ action: "created", name: "/test" }),
    );

    await interopRestTool.handler(
      { action: "create", name: "/test", namespace: "MYNS" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/rest",
      expect.objectContaining({ namespace: "MYNS" }),
    );
  });

  it("should not include spec in body when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "deleted", name: "/test" }),
    );

    await interopRestTool.handler(
      { action: "delete", name: "/test" },
      ctx,
    );

    const callBody = mockHttp.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(callBody.spec).toBeUndefined();
  });

  it("should accept spec as string", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "created", name: "/test" }),
    );

    const specString = '{"openapi":"3.0.0"}';

    await interopRestTool.handler(
      { action: "create", name: "/test", spec: specString },
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
      { action: "create", name: "/bad" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error managing REST application");
    expect(result.content[0]?.text).toContain("/bad");
  });

  it("should rethrow non-IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(new Error("Network failure"));

    await expect(
      interopRestTool.handler({ action: "create", name: "/test" }, ctx),
    ).rejects.toThrow("Network failure");
  });
});
