import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  executeCommandTool,
  executeClassMethodTool,
  executeTestsTool,
} from "../tools/execute.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── iris_execute_command ────────────────────────────────────────

describe("iris_execute_command", () => {
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

  it("returns structured error envelope when server returns JSON error", async () => {
    // Regression test for Story 11.1 Bug #1: prior to the fix, a runtime
    // ObjectScript error (e.g. <DIVIDE>) caused the REST handler to leave
    // I/O redirect enabled, so the JSON error response was captured into
    // %ExecuteMCPOutput and the client saw "non-JSON response". Now the
    // server emits a proper Atelier error envelope — this test validates
    // the tool-side shape with that envelope mocked.
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [
          {
            code: 5001,
            domain: "%ObjectErrors",
            error:
              "ERROR #5001: ObjectScript error: <DIVIDE>Execute+39^ExecuteMCPv2.REST.Command.1",
            id: "GeneralError",
          },
        ],
        "/api/executemcp/v2/command",
        "ObjectScript error: <DIVIDE>",
      ),
    );

    const result = await executeCommandTool.handler(
      { command: "Set x = 1/0" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error executing command");
    expect(result.content[0]?.text).toContain("<DIVIDE>");
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
    expect(executeCommandTool.name).toBe("iris_execute_command");
    expect(executeCommandTool.title).toBe("Execute Command");
  });
});

// ── iris_execute_classmethod ────────────────────────────────────

describe("iris_execute_classmethod", () => {
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
    expect(executeClassMethodTool.name).toBe("iris_execute_classmethod");
    expect(executeClassMethodTool.title).toBe("Execute Class Method");
  });
});

// ── iris_execute_tests ─────────────────────────────────────────

describe("iris_execute_tests", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  /** Helper: mock queue + immediate poll response (no retryafter) */
  function mockQueueAndPoll(testResults: unknown[]) {
    // First post = SQL discover (for package), second post = queue work
    // For class/method level, first post = queue work directly
    mockHttp.post.mockResolvedValue(
      envelope({ location: "job-123" }),
    );
    mockHttp.get.mockResolvedValue({
      status: { errors: [] },
      console: [],
      result: testResults,
    });
  }

  /** Helper: mock package discovery + queue + poll */
  function mockPackageDiscoverAndRun(classes: string[], testResults: unknown[]) {
    let postCallCount = 0;
    mockHttp.post.mockImplementation(() => {
      postCallCount++;
      if (postCallCount === 1) {
        // First call: SQL query for package discovery
        return Promise.resolve(envelope({ content: classes.map((c) => ({ Name: c })) }));
      }
      // Second call: queue work
      return Promise.resolve(envelope({ location: "job-456" }));
    });
    mockHttp.get.mockResolvedValue({
      status: { errors: [] },
      console: [],
      result: testResults,
    });
  }

  it("should queue async unittest and return structured results for class level", async () => {
    const atelierResults = [
      { class: "MyApp.Tests.UtilsTest", method: "TestValidate", status: 1, duration: 10, failures: [] },
      { class: "MyApp.Tests.UtilsTest", method: "TestFormat", status: 1, duration: 15, failures: [] },
      { class: "MyApp.Tests.UtilsTest", status: 1, duration: 25, failures: [] },
    ];
    mockQueueAndPoll(atelierResults);

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest", level: "class" },
      ctx,
    );

    // Verify queue POST to Atelier work endpoint
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/work"),
      expect.objectContaining({
        request: "unittest",
        tests: [{ class: "MyApp.Tests.UtilsTest" }],
      }),
    );

    const structured = result.structuredContent as { total: number; passed: number; failed: number };
    expect(structured.total).toBe(2); // Only method-level results counted
    expect(structured.passed).toBe(2);
    expect(structured.failed).toBe(0);
    expect(result.isError).toBeUndefined();
  });

  it("should handle mixed results (some pass, some fail)", async () => {
    const atelierResults = [
      { class: "MyApp.Tests.UtilsTest", method: "TestGood", status: 1, duration: 10, failures: [] },
      {
        class: "MyApp.Tests.UtilsTest",
        method: "TestBad",
        status: 0,
        duration: 20,
        failures: [{ message: "AssertEquals: Expected 'foo' but got 'bar'" }],
      },
      { class: "MyApp.Tests.UtilsTest", status: 0, duration: 30, failures: [] },
    ];
    mockQueueAndPoll(atelierResults);

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest", level: "class" },
      ctx,
    );

    const structured = result.structuredContent as { total: number; passed: number; failed: number; details: { message: string }[] };
    expect(structured.total).toBe(2);
    expect(structured.passed).toBe(1);
    expect(structured.failed).toBe(1);
    expect(structured.details[1]?.message).toContain("AssertEquals");
    expect(result.isError).toBeUndefined();
  });

  it("should send method-level with class and methods array", async () => {
    mockQueueAndPoll([
      { class: "MyApp.Tests.UtilsTest", method: "TestValidate", status: 1, duration: 5, failures: [] },
    ]);

    await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest:TestValidate", level: "method" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/work"),
      expect.objectContaining({
        request: "unittest",
        tests: [{ class: "MyApp.Tests.UtilsTest", methods: ["TestValidate"] }],
      }),
    );
  });

  it("should discover package test classes via SQL then queue", async () => {
    mockPackageDiscoverAndRun(
      ["MyApp.Tests.UtilsTest", "MyApp.Tests.OtherTest"],
      [
        { class: "MyApp.Tests.UtilsTest", method: "Test1", status: 1, duration: 5, failures: [] },
        { class: "MyApp.Tests.OtherTest", method: "Test2", status: 1, duration: 3, failures: [] },
      ],
    );

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests", level: "package" },
      ctx,
    );

    // First post = SQL package discovery; second = ensureUnitTestRoot SQL;
    // third = /work queue. The ensureUnitTestRoot call is wrapped in its
    // own try/catch in the handler — if the mock envelope doesn't carry a
    // UnitTestRoot row, the function returns "" silently and the flow
    // continues to the /work POST.
    expect(mockHttp.post).toHaveBeenCalledTimes(3);

    const structured = result.structuredContent as { total: number; passed: number };
    expect(structured.total).toBe(2);
    expect(structured.passed).toBe(2);
  });

  it("should return empty results when no test classes found for package", async () => {
    // SQL discover returns empty
    mockHttp.post.mockResolvedValue(envelope({ content: [] }));

    const result = await executeTestsTool.handler(
      { target: "NonExistent.Tests", level: "package" },
      ctx,
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("No test classes found");
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Server error" }],
        "/api/atelier/v7/USER/work",
        "Server error",
      ),
    );

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests", level: "class" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error executing tests");
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      executeTestsTool.handler({ target: "MyApp.Tests", level: "class" }, ctx),
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
    expect(executeTestsTool.name).toBe("iris_execute_tests");
    expect(executeTestsTool.title).toBe("Execute Tests");
  });
});
