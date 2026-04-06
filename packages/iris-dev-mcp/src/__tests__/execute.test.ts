import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  executeCommandTool,
  executeClassMethodTool,
  executeTestsTool,
} from "../tools/execute.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── iris.execute.command ────────────────────────────────────────

describe("iris.execute.command", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with command in body and return output", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ output: "Hello World" }),
    );

    const result = await executeCommandTool.handler(
      { command: 'Write "Hello World"' },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/command",
      expect.objectContaining({
        command: 'Write "Hello World"',
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { output: string };
    expect(structured.output).toBe("Hello World");
    expect(result.isError).toBeUndefined();
  });

  it("should forward namespace override in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ output: "" }),
    );

    await executeCommandTool.handler(
      { command: "Set x=1", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/command",
      expect.objectContaining({
        namespace: "HSCUSTOM",
      }),
    );
  });

  it("should use default namespace when not specified", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ output: "" }),
    );

    await executeCommandTool.handler(
      { command: "Set x=1" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/command",
      expect.objectContaining({
        namespace: "USER",
      }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Required parameter 'command' is missing" }],
        "/api/executemcp/v2/command",
        "Required parameter 'command' is missing",
      ),
    );

    const result = await executeCommandTool.handler(
      { command: "" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error executing command");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      executeCommandTool.handler({ command: "Write 1" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: false, destructiveHint: false)", () => {
    expect(executeCommandTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(executeCommandTool.scope).toBe("NS");
  });

  it("should have correct name and title", () => {
    expect(executeCommandTool.name).toBe("iris.execute.command");
    expect(executeCommandTool.title).toBe("Execute Command");
  });
});

// ── iris.execute.classmethod ────────────────────────────────────

describe("iris.execute.classmethod", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with className and methodName in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ returnValue: "2024.1", argCount: 0 }),
    );

    const result = await executeClassMethodTool.handler(
      { className: "%SYSTEM.Version", methodName: "GetVersion" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/classmethod",
      expect.objectContaining({
        className: "%SYSTEM.Version",
        methodName: "GetVersion",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as { returnValue: string; argCount: number };
    expect(structured.returnValue).toBe("2024.1");
    expect(structured.argCount).toBe(0);
    expect(result.isError).toBeUndefined();
  });

  it("should include args in body when provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ returnValue: "1", argCount: 2 }),
    );

    await executeClassMethodTool.handler(
      {
        className: "MyPackage.MyClass",
        methodName: "Add",
        args: [1, 2],
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/classmethod",
      expect.objectContaining({
        className: "MyPackage.MyClass",
        methodName: "Add",
        args: [1, 2],
        namespace: "USER",
      }),
    );
  });

  it("should not include args key when args is empty", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ returnValue: "ok", argCount: 0 }),
    );

    await executeClassMethodTool.handler(
      { className: "MyClass", methodName: "DoSomething", args: [] },
      ctx,
    );

    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.args).toBeUndefined();
  });

  it("should not include args key when args is not provided", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ returnValue: "ok", argCount: 0 }),
    );

    await executeClassMethodTool.handler(
      { className: "MyClass", methodName: "DoSomething" },
      ctx,
    );

    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body.args).toBeUndefined();
  });

  it("should forward namespace override in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ returnValue: "", argCount: 0 }),
    );

    await executeClassMethodTool.handler(
      {
        className: "MyClass",
        methodName: "DoSomething",
        namespace: "HSCUSTOM",
      },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/classmethod",
      expect.objectContaining({
        namespace: "HSCUSTOM",
      }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Class not found" }],
        "/api/executemcp/v2/classmethod",
        "Class not found",
      ),
    );

    const result = await executeClassMethodTool.handler(
      { className: "NonExistent", methodName: "DoSomething" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error executing class method 'NonExistent.DoSomething'",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      executeClassMethodTool.handler(
        { className: "MyClass", methodName: "DoSomething" },
        ctx,
      ),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: false, destructiveHint: false)", () => {
    expect(executeClassMethodTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(executeClassMethodTool.scope).toBe("NS");
  });

  it("should have correct name and title", () => {
    expect(executeClassMethodTool.name).toBe("iris.execute.classmethod");
    expect(executeClassMethodTool.title).toBe("Execute Class Method");
  });
});

// ── iris.execute.tests ─────────────────────────────────────────

describe("iris.execute.tests", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send POST with target and level in body and return structured results", async () => {
    const testResult = {
      total: 3,
      passed: 3,
      failed: 0,
      skipped: 0,
      duration: 50,
      details: [
        { class: "MyApp.Tests.UtilsTest", method: "TestValidate", status: "passed", duration: 10, message: "" },
        { class: "MyApp.Tests.UtilsTest", method: "TestFormat", status: "passed", duration: 15, message: "" },
        { class: "MyApp.Tests.UtilsTest", method: "TestParse", status: "passed", duration: 25, message: "" },
      ],
    };
    mockHttp.post.mockResolvedValue(envelope(testResult));

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests", level: "package" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/tests",
      expect.objectContaining({
        target: "MyApp.Tests",
        level: "package",
        namespace: "USER",
      }),
    );

    const structured = result.structuredContent as typeof testResult;
    expect(structured.total).toBe(3);
    expect(structured.passed).toBe(3);
    expect(structured.failed).toBe(0);
    expect(structured.details).toHaveLength(3);
    expect(result.isError).toBeUndefined();
  });

  it("should handle mixed results (some pass, some fail)", async () => {
    const testResult = {
      total: 2,
      passed: 1,
      failed: 1,
      skipped: 0,
      duration: 30,
      details: [
        { class: "MyApp.Tests.UtilsTest", method: "TestGood", status: "passed", duration: 10, message: "" },
        {
          class: "MyApp.Tests.UtilsTest",
          method: "TestBad",
          status: "failed",
          duration: 20,
          message: "AssertEquals: Expected 'foo' but got 'bar'",
        },
      ],
    };
    mockHttp.post.mockResolvedValue(envelope(testResult));

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest", level: "class" },
      ctx,
    );

    const structured = result.structuredContent as typeof testResult;
    expect(structured.total).toBe(2);
    expect(structured.passed).toBe(1);
    expect(structured.failed).toBe(1);
    expect(structured.details[1]?.message).toContain("AssertEquals");
    expect(result.isError).toBeUndefined();
  });

  it("should send method-level target correctly", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ total: 1, passed: 1, failed: 0, skipped: 0, duration: 5, details: [] }),
    );

    await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest:TestValidate", level: "method" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/tests",
      expect.objectContaining({
        target: "MyApp.Tests.UtilsTest:TestValidate",
        level: "method",
        namespace: "USER",
      }),
    );
  });

  it("should forward namespace override in body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ total: 0, passed: 0, failed: 0, skipped: 0, duration: 0, details: [] }),
    );

    await executeTestsTool.handler(
      { target: "MyApp.Tests", level: "package", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/tests",
      expect.objectContaining({
        namespace: "HSCUSTOM",
      }),
    );
  });

  it("should use default namespace when not specified", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ total: 0, passed: 0, failed: 0, skipped: 0, duration: 0, details: [] }),
    );

    await executeTestsTool.handler(
      { target: "MyApp.Tests", level: "package" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/executemcp/v2/tests",
      expect.objectContaining({
        namespace: "USER",
      }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Required parameter 'target' is missing" }],
        "/api/executemcp/v2/tests",
        "Required parameter 'target' is missing",
      ),
    );

    const result = await executeTestsTool.handler(
      { target: "", level: "package" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error executing tests");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      executeTestsTool.handler({ target: "MyApp.Tests", level: "package" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should have correct annotations (readOnlyHint: true, destructiveHint: false)", () => {
    expect(executeTestsTool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(executeTestsTool.scope).toBe("NS");
  });

  it("should have correct name and title", () => {
    expect(executeTestsTool.name).toBe("iris.execute.tests");
    expect(executeTestsTool.title).toBe("Execute Tests");
  });
});
