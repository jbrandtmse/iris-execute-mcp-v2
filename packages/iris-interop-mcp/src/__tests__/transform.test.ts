import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  transformListTool,
  transformTestTool,
} from "../tools/transform.js";
import { createMockHttp, createMockCtx, envelope } from "@iris-mcp/shared/test-helpers";

// ── iris_transform_list ────────────────────────────────────────

describe("iris_transform_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(transformListTool.name).toBe("iris_transform_list");
    expect(transformListTool.annotations?.readOnlyHint).toBe(true);
    expect(transformListTool.annotations?.destructiveHint).toBe(false);
    expect(transformListTool.scope).toBe("NS");
  });

  it("should send GET with namespace query param", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        transforms: [
          { name: "MyPackage.Transforms.HL7toSDA" },
          { name: "MyPackage.Transforms.SDAtoFHIR" },
        ],
        count: 2,
      }),
    );

    const result = await transformListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/interop/transform"),
    );
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=USER"),
    );

    const structured = result.structuredContent as {
      transforms: Array<{ name: string }>;
      count: number;
    };
    expect(structured.transforms).toHaveLength(2);
    expect(structured.count).toBe(2);
    expect(result.isError).toBeUndefined();
  });

  it("should pass custom namespace", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ transforms: [], count: 0 }),
    );

    await transformListTool.handler({ namespace: "PROD" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=PROD"),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [{ error: "Server error" }], "/api/executemcp/v2/interop/transform", "List error"),
    );

    const result = await transformListTool.handler({}, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error listing data transformations");
  });

  it("should rethrow non-IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(new Error("Timeout"));

    await expect(
      transformListTool.handler({}, ctx),
    ).rejects.toThrow("Timeout");
  });
});

// ── iris_transform_test ────────────────────────────────────────

describe("iris_transform_test", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have correct tool metadata", () => {
    expect(transformTestTool.name).toBe("iris_transform_test");
    expect(transformTestTool.annotations?.readOnlyHint).toBe(false);
    expect(transformTestTool.annotations?.destructiveHint).toBe(false);
    expect(transformTestTool.scope).toBe("NS");
  });

  it("should send POST with className, sourceClass, and sourceData", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        className: "MyPackage.Transforms.MyDTL",
        sourceClass: "MyPackage.Messages.Request",
        output: {
          className: "MyPackage.Messages.Response",
          data: { field1: "value1" },
        },
      }),
    );

    const result = await transformTestTool.handler(
      {
        className: "MyPackage.Transforms.MyDTL",
        sourceClass: "MyPackage.Messages.Request",
        sourceData: { name: "test", code: "123" },
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/transform/test",
      expect.objectContaining({
        className: "MyPackage.Transforms.MyDTL",
        sourceClass: "MyPackage.Messages.Request",
        sourceData: { name: "test", code: "123" },
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as {
      className: string;
      sourceClass: string;
      output: { className: string };
    };
    expect(structured.className).toBe("MyPackage.Transforms.MyDTL");
    expect(structured.sourceClass).toBe("MyPackage.Messages.Request");
    expect(structured.output.className).toBe("MyPackage.Messages.Response");
    expect(result.isError).toBeUndefined();
  });

  it("should send POST without sourceData when not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        className: "MyDTL",
        sourceClass: "MyMsg",
        output: {},
      }),
    );

    await transformTestTool.handler(
      { className: "MyDTL", sourceClass: "MyMsg" },
      ctx,
    );

    const callBody = mockHttp.post.mock.calls[0]![1] as Record<string, unknown>;
    expect(callBody.sourceData).toBeUndefined();
  });

  it("should pass custom namespace in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ className: "T", sourceClass: "S", output: {} }),
    );

    await transformTestTool.handler(
      { className: "T", sourceClass: "S", namespace: "PROD" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/interop/transform/test",
      expect.objectContaining({ namespace: "PROD" }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [{ error: "Transform failed" }], "/api/executemcp/v2/interop/transform/test", "Transform error"),
    );

    const result = await transformTestTool.handler(
      { className: "BadDTL", sourceClass: "Msg" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error testing transformation");
    expect(result.content[0]?.text).toContain("BadDTL");
  });

  it("should rethrow non-IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(new Error("Network failure"));

    await expect(
      transformTestTool.handler({ className: "T", sourceClass: "S" }, ctx),
    ).rejects.toThrow("Network failure");
  });
});
