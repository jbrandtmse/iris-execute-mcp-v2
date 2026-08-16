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

  // AC 34.5.1 (34-4-R4): `truncated` was on the REST error envelope's
  // `result` since Story 34.4 but was invisible to the tool caller because
  // `IrisApiError` discarded `result` at the http-client throw site. The
  // fix threads `result` through to the 5th constructor argument.
  it("surfaces `truncated` in structuredContent on the error path when the envelope carried it (34-4-R4)", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "ERROR #5001: ObjectScript error: <MAXSTRING>" }],
        "/api/executemcp/v2/command",
        "ObjectScript error: <MAXSTRING>",
        { truncated: true },
      ),
    );

    const result = await executeCommandTool.handler(
      { command: "Do ##class(Some.Chatty).Target()" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("Error executing command");
    expect(result.structuredContent).toEqual({ truncated: true });
  });

  it("back-compat (Rule #19): an error whose envelope never carried `truncated` gets no structuredContent at all — not `{truncated: undefined}` or `{truncated: false}`", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        400,
        [{ error: "Required parameter 'command' is missing" }],
        "/api/executemcp/v2/command",
        "Required parameter 'command' is missing",
      ),
    );

    const result = await executeCommandTool.handler({ command: "" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      executeCommandTool.handler({ command: "Write 1" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  // Story 34.3 AC 34.3.5 / Rule #19 — the 34-2-R1 fix touched `Redirects()`, which is
  // SHARED with `/command`, so `Execute()` gained an additive `truncated` field too.
  // The classmethod side got a back-compat pin; this is the missing command-side one.
  it("should surface the additive truncated field on a capture overflow (34-2-R1)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ output: "partial output", truncated: true }),
    );

    const result = await executeCommandTool.handler(
      { command: "Do ##class(Some.Chatty).Target()" },
      ctx,
    );

    // A capture overflow is a partial SUCCESS, never an error envelope, and never silent.
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      output: string;
      truncated: boolean;
    };
    expect(structured.output).toBe("partial output");
    expect(structured.truncated).toBe(true);
  });

  it("should leave a legacy truncated-less command envelope untouched (Rule #19)", async () => {
    // Pre-34.3 servers do not send `truncated`. The tool must not invent, default, or
    // reshape the field — today's behavior for today's envelope, byte for byte.
    mockHttp.post.mockResolvedValue(envelope({ output: "legacy" }));

    const result = await executeCommandTool.handler({ command: "Write 1" }, ctx);

    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ output: "legacy" });
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

  // AC 34.5.1 (34-4-R4): same additive surfacing as `iris_execute_command`.
  it("surfaces `truncated` in structuredContent on the error path when the envelope carried it (34-4-R4)", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "ERROR #5001: ObjectScript error: <MAXSTRING>" }],
        "/api/executemcp/v2/classmethod",
        "ObjectScript error: <MAXSTRING>",
        { truncated: true },
      ),
    );

    const result = await executeClassMethodTool.handler(
      { className: "Some.Chatty", methodName: "Target" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({ truncated: true });
  });

  it("back-compat (Rule #19): an error whose envelope never carried `truncated` gets no structuredContent at all", async () => {
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
    expect(result.structuredContent).toBeUndefined();
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

  // ── Story 34.3: 20-arg ceiling, {byRef, value?} markers, additive fields ──

  it("schema accepts 20 args and rejects 21 (max ceiling raised from 10 to 20)", () => {
    const twenty = Array.from({ length: 20 }, (_, i) => i);
    const twentyOne = Array.from({ length: 21 }, (_, i) => i);
    expect(() =>
      executeClassMethodTool.inputSchema.parse({
        className: "MyClass",
        methodName: "DoSomething",
        args: twenty,
      }),
    ).not.toThrow();
    expect(() =>
      executeClassMethodTool.inputSchema.parse({
        className: "MyClass",
        methodName: "DoSomething",
        args: twentyOne,
      }),
    ).toThrow();
  });

  it("passes {byRef, value?} marker objects through to the REST body untouched (marker pass-through)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        returnValue: "ok",
        argCount: 2,
        output: "",
        byRefValues: { "0": "start-mutated" },
        truncated: false,
      }),
    );

    const markerArgs = [
      { byRef: true, value: "start" },
      { byRef: true },
    ];

    await executeClassMethodTool.handler(
      {
        className: "MyPackage.MyClass",
        methodName: "DoSomething",
        args: markerArgs,
      },
      ctx,
    );

    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    // Markers must reach the server body EXACTLY as supplied — no client-side
    // reshaping, since marker-shape validation is the server's job (Utils.ParseArgEntry).
    expect(body.args).toEqual(markerArgs);
  });

  it("surfaces additive output/byRefValues/truncated fields in structuredContent as an object", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        returnValue: "ok",
        argCount: 1,
        output: "line1\nline2",
        byRefValues: { "0": { value: "top", subscripts: { k1: "v1" } } },
        truncated: false,
      }),
    );

    const result = await executeClassMethodTool.handler(
      {
        className: "MyClass",
        methodName: "DoSomething",
        args: [{ byRef: true }],
      },
      ctx,
    );

    expect(Array.isArray(result.structuredContent)).toBe(false);
    expect(typeof result.structuredContent).toBe("object");
    const structured = result.structuredContent as {
      output: string;
      byRefValues: Record<string, unknown>;
      truncated: boolean;
    };
    expect(structured.output).toBe("line1\nline2");
    expect(structured.byRefValues).toEqual({ "0": { value: "top", subscripts: { k1: "v1" } } });
    expect(structured.truncated).toBe(false);
  });

  // Story 34.6 AC 34.6.1: `byRefTruncated` is computed server-side (ObjectScript
  // `ExecuteMCPv2.Utils.BuildByRefNode`'s node/byte budget) — this pins that the TS
  // tool layer passes it through structuredContent unchanged (never dropped/renamed),
  // and separately from `truncated`, which describes the `output` field. Also serves as
  // the Rule #19 ceiling proof at the tool layer: an over-ceiling `output`/`byRefValues`
  // shape (as the real server would send once truncated) reaches the caller exactly as
  // the server sent it — the tool performs no additional truncation of its own.
  it("passes returnValueTruncated, byRefTruncated, and an over-ceiling output/returnValue/marker shape through unchanged (server-computed, tool is a pure pass-through)", async () => {
    // Rule #54 — these fixtures must be shapes the REAL server can actually emit.
    // All were corrected/added in code review / the 34-6-CR-5/CR-6 review-continuation
    // pass after being pinned against live IRIS:
    //   * The marker is `\n[IRIS-MCP-TRUNCATED ceiling=<N>chars]\n` = 36 + digits(N)
    //     characters, so at the default ceiling it is 41 chars and the server keeps
    //     32768 - 41 = 32727 content characters, for a total of EXACTLY 32768. `output`
    //     AND (as of the CR-5 fix) `returnValue` share this exact shape.
    //   * A byRef leaf truncated at a REMAINING budget of 20 gets NO marker at all (the
    //     34-6-CR-6/CR-8/CR-9 fix): the marker itself is 38 characters at that ceiling,
    //     which is bigger than the 20-char budget, so appending it would replace a
    //     smaller value with something LARGER — the server now falls back to a plain
    //     20-character hard cut of the original content, no marker fragment. A prior
    //     fixture here encoded the marker-alone shape the server produced BEFORE that
    //     fix — an envelope the server can no longer produce.
    const CEILING = 32768;
    const outputMarker = "\n[IRIS-MCP-TRUNCATED ceiling=32768chars]\n";
    const overCeilingOutput = "A".repeat(CEILING - outputMarker.length) + outputMarker;
    expect(overCeilingOutput.length).toBe(CEILING);
    const overCeilingReturnValue = "B".repeat(CEILING - outputMarker.length) + outputMarker;
    expect(overCeilingReturnValue.length).toBe(CEILING);
    const byRefHardCutNoMarker = "C".repeat(20);
    mockHttp.post.mockResolvedValue(
      envelope({
        returnValue: overCeilingReturnValue,
        argCount: 1,
        output: overCeilingOutput,
        byRefValues: { "0": byRefHardCutNoMarker },
        truncated: true,
        byRefTruncated: true,
        returnValueTruncated: true,
      }),
    );

    const result = await executeClassMethodTool.handler(
      { className: "MyClass", methodName: "DoSomething", args: [{ byRef: true }] },
      ctx,
    );

    const structured = result.structuredContent as {
      returnValue: string;
      output: string;
      byRefValues: Record<string, unknown>;
      truncated: boolean;
      byRefTruncated: boolean;
      returnValueTruncated: boolean;
    };
    expect(structured.output).toBe(overCeilingOutput);
    expect(structured.output).toContain("[IRIS-MCP-TRUNCATED");
    expect(structured.returnValue).toBe(overCeilingReturnValue);
    expect(structured.returnValue).toContain("[IRIS-MCP-TRUNCATED");
    expect(structured.byRefValues).toEqual({ "0": byRefHardCutNoMarker });
    expect(structured.truncated).toBe(true);
    expect(structured.byRefTruncated).toBe(true);
    expect(structured.returnValueTruncated).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("back-compat (Rule #19): a legacy envelope with no byRefTruncated field surfaces with the key simply absent, not invented as false", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ returnValue: "ok", argCount: 0, output: "", byRefValues: {}, truncated: false }),
    );

    const result = await executeClassMethodTool.handler(
      { className: "MyClass", methodName: "DoSomething" },
      ctx,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect("byRefTruncated" in structured).toBe(false);
  });

  // Story 34.6 code-review finding CR-5 (review-continuation pass): returnValue is
  // now additionally capped, with its own returnValueTruncated flag — same additive/
  // pure-pass-through discipline as byRefTruncated above.
  it("passes returnValueTruncated through structuredContent unchanged when the server sends it", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        returnValue: "short",
        argCount: 0,
        output: "",
        byRefValues: {},
        truncated: false,
        byRefTruncated: false,
        returnValueTruncated: false,
      }),
    );

    const result = await executeClassMethodTool.handler(
      { className: "MyClass", methodName: "DoSomething" },
      ctx,
    );

    const structured = result.structuredContent as { returnValueTruncated: boolean };
    expect(structured.returnValueTruncated).toBe(false);
    expect(result.isError).toBeUndefined();
  });

  it("back-compat (Rule #19): a legacy envelope with no returnValueTruncated field surfaces with the key simply absent, not invented as false", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ returnValue: "ok", argCount: 0, output: "", byRefValues: {}, truncated: false }),
    );

    const result = await executeClassMethodTool.handler(
      { className: "MyClass", methodName: "DoSomething" },
      ctx,
    );

    const structured = result.structuredContent as Record<string, unknown>;
    expect("returnValueTruncated" in structured).toBe(false);
  });

  it("back-compat (Rule #19): a legacy envelope with only returnValue/argCount (no output/byRefValues/truncated) still surfaces correctly", async () => {
    // Pins that older-server or older-fixture responses lacking the additive Story
    // 34.2/34.3 fields do not break the tool — the fields are additive, never required.
    mockHttp.post.mockResolvedValue(
      envelope({ returnValue: "2024.1", argCount: 0 }),
    );

    const result = await executeClassMethodTool.handler(
      { className: "%SYSTEM.Version", methodName: "GetVersion" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as { returnValue: string; argCount: number };
    expect(structured.returnValue).toBe("2024.1");
    expect(structured.argCount).toBe(0);
  });

  it("surfaces a clear isError for a rejected object arg (non-marker shape)", async () => {
    // Models the server's ParseArgEntry rejection (e.g. an object missing 'byRef').
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [
          {
            error:
              "ERROR #5001: Argument 0 is an object without a 'byRef' key; expected a scalar or a {byRef, value} marker object",
          },
        ],
        "/api/executemcp/v2/classmethod",
        "Argument 0 is an object without a 'byRef' key; expected a scalar or a {byRef, value} marker object",
      ),
    );

    const result = await executeClassMethodTool.handler(
      {
        className: "MyClass",
        methodName: "DoSomething",
        args: [{ notAMarker: true }],
      },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("without a 'byRef' key");
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
    // Raw Atelier result rows carry method names with the "Test" prefix
    // STRIPPED (verified live, Story 34.5 QA — see toAtelierMethodFilter's
    // doc comment in execute.ts) — the tool restores it for its own output.
    const atelierResults = [
      { class: "MyApp.Tests.UtilsTest", method: "Validate", status: 1, duration: 10, failures: [] },
      { class: "MyApp.Tests.UtilsTest", method: "Format", status: 1, duration: 15, failures: [] },
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

    const structured = result.structuredContent as {
      total: number;
      passed: number;
      failed: number;
      details: { method: string }[];
    };
    expect(structured.total).toBe(2); // Only method-level results counted
    expect(structured.passed).toBe(2);
    expect(structured.failed).toBe(0);
    // The tool's OWN output restores the "Test" prefix its schema/README
    // document, even though the raw endpoint row never carried it.
    expect(structured.details.map((d) => d.method).sort()).toEqual(["TestFormat", "TestValidate"]);
    expect(result.isError).toBeUndefined();
  });

  it("should handle mixed results (some pass, some fail)", async () => {
    // Raw rows stripped, as the real endpoint returns them.
    const atelierResults = [
      { class: "MyApp.Tests.UtilsTest", method: "Good", status: 1, duration: 10, failures: [] },
      {
        class: "MyApp.Tests.UtilsTest",
        method: "Bad",
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

    const structured = result.structuredContent as { total: number; passed: number; failed: number; details: { method: string; message: string }[] };
    expect(structured.total).toBe(2);
    expect(structured.passed).toBe(1);
    expect(structured.failed).toBe(1);
    expect(structured.details[1]?.message).toContain("AssertEquals");
    expect(structured.details[1]?.method).toBe("TestBad");
    expect(result.isError).toBeUndefined();
  });

  // ── Atelier "Test"-prefix normalization (Story 34.5 QA follow-up) ──
  //
  // Live probe against HSCUSTOM (2026.1 Build 235U) confirmed the Atelier
  // `/work` unittest endpoint's `methods` request filter matches ONLY the
  // unprefixed form of a test method name, and every result row (at every
  // level, not just filtered method-level runs) carries the unprefixed
  // form too — even though the real OS method, the tool's schema, and the
  // README all use the prefixed form (`%UnitTest.TestCase` requires every
  // test method's real name to start with `Test`). Left unhandled, the
  // documented `ClassName:TestMethodName` call shape drains zero rows and
  // (after AC 34.5.3's guard) reports a misleading "No tests found" for a
  // target that genuinely exists and passes. These tests pin the fix:
  // strip on the way out, restore on the way back.

  it("strips the 'Test' prefix from the outgoing methods filter (documented input form)", async () => {
    mockQueueAndPoll([
      { class: "MyApp.Tests.UtilsTest", method: "Validate", status: 1, duration: 5, failures: [] },
    ]);

    await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest:TestValidate", level: "method" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/work"),
      expect.objectContaining({
        request: "unittest",
        // The endpoint's filter must be sent WITHOUT the prefix, even
        // though the caller supplied the documented, prefixed form.
        tests: [{ class: "MyApp.Tests.UtilsTest", methods: ["Validate"] }],
      }),
    );
  });

  it("does not strip a methods filter that was never prefixed (defensive — real test methods always start with 'Test')", async () => {
    mockQueueAndPoll([
      { class: "MyApp.Tests.UtilsTest", method: "Weird", status: 1, duration: 5, failures: [] },
    ]);

    await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest:Weird", level: "method" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/work"),
      expect.objectContaining({
        tests: [{ class: "MyApp.Tests.UtilsTest", methods: ["Weird"] }],
      }),
    );
  });

  it("restores the 'Test' prefix on result rows (documented output form) end-to-end for a prefixed target", async () => {
    // The documented, correctly-typed call — target uses the "Test"
    // prefix that matches the tool's own schema and README. Before this
    // normalization, this exact shape drained zero rows against the real
    // endpoint (the root cause behind the AC 34.5.3 zero-result guard's
    // false positive on a genuinely correct, documented call).
    mockQueueAndPoll([
      { class: "MyApp.Tests.UtilsTest", method: "Validate", status: 1, duration: 5, failures: [] },
    ]);

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest:TestValidate", level: "method" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      total: number;
      passed: number;
      error?: string;
      details: { method: string }[];
    };
    // Real counts, not the zero-result guard.
    expect(structured.total).toBe(1);
    expect(structured.passed).toBe(1);
    expect(structured.error).toBeUndefined();
    expect(structured.details[0]?.method).toBe("TestValidate");
  });

  it("should discover package test classes via SQL then queue", async () => {
    mockPackageDiscoverAndRun(
      ["MyApp.Tests.UtilsTest", "MyApp.Tests.OtherTest"],
      [
        { class: "MyApp.Tests.UtilsTest", method: "One", status: 1, duration: 5, failures: [] },
        { class: "MyApp.Tests.OtherTest", method: "Two", status: 1, duration: 3, failures: [] },
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
    // AC 34.6.4: the zero-result guard is machine-detectable on every path,
    // including this discovery-time one.
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { total: number }).total).toBe(0);
  });

  // ── Regression: poll-loop truncation (bug 2026-07-09) ──────────
  //
  // The Atelier /work/{id} endpoint signals "job still running" with a
  // Retry-After header (→ envelope.retryafter), and each GET DRAINS the
  // results accumulated since the previous GET — delta semantics, verified
  // live 2026-07-09 (a 5-method HANG-1 class delivered its methods spread
  // across successive drains). Two loop shapes silently truncate:
  //  (a) pre-fix: accept the FIRST non-empty drain as final (a 41-method
  //      class reported as total=2 with a green envelope);
  //  (b) wait-for-completion but keep only the LAST drain (discards every
  //      earlier drain — same truncation, different subset; caught by the
  //      live smoke against the first fix attempt).
  // The correct shape: accumulate EVERY drain (keyed class::method, which
  // also dedupes if the endpoint ever returns cumulative sets) and finalize
  // only when retryafter is absent. These tests pin all of it.

  it("accumulates DELTA drains across polls — neither first-drain-only nor last-drain-only (truncation regression)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ location: "job-slow" }));
    // Poll 1: first drain — one method finished, job STILL RUNNING.
    //   Pre-fix accepted this as final → total=1 (bug shape a).
    // Poll 2: terminal drain — carries ONLY the remaining two methods
    //   (delta semantics, as observed live). A last-drain-only loop
    //   returns total=2 and silently drops TestA (bug shape b).
    // Raw rows are stripped, as the real endpoint returns them; the tool
    // restores the "Test" prefix (Story 34.5 QA normalization) — see the
    // `.details.map(...)` assertion below, which pins the RESTORED form.
    mockHttp.get
      .mockResolvedValueOnce({
        status: { errors: [] },
        console: [],
        result: [
          { class: "MyApp.Tests.SlowTest", method: "A", status: 1, duration: 4000, failures: [] },
        ],
        retryafter: "1",
      })
      .mockResolvedValueOnce({
        status: { errors: [] },
        console: [],
        result: [
          { class: "MyApp.Tests.SlowTest", method: "B", status: 0, duration: 4100, failures: [{ message: "AssertTrue failed" }] },
          { class: "MyApp.Tests.SlowTest", method: "C", status: 1, duration: 3900, failures: [] },
        ],
      });

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.SlowTest", level: "class" },
      ctx,
    );

    // Both polls must have been made — the partial was re-polled, not accepted.
    expect(mockHttp.get).toHaveBeenCalledTimes(2);

    const structured = result.structuredContent as { total: number; passed: number; failed: number; details: { method: string }[] };
    expect(structured.total).toBe(3); // bug (a) → 1; bug (b) → 2
    expect(structured.passed).toBe(2);
    expect(structured.failed).toBe(1); // the failure arriving AFTER the first drain is visible
    expect(structured.details.map((d) => d.method).sort()).toEqual(["TestA", "TestB", "TestC"]);
    expect(result.isError).toBeUndefined();
  });

  it("dedupes by class::method if the endpoint returns CUMULATIVE sets instead of deltas", async () => {
    mockHttp.post.mockResolvedValue(envelope({ location: "job-cumulative" }));
    // Some endpoint variants may repeat already-delivered results on later
    // polls (cumulative). The accumulator must not double-count TestA.
    mockHttp.get
      .mockResolvedValueOnce({
        status: { errors: [] },
        console: [],
        result: [
          { class: "MyApp.Tests.SlowTest", method: "A", status: 1, duration: 1000, failures: [] },
        ],
        retryafter: "1",
      })
      .mockResolvedValueOnce({
        status: { errors: [] },
        console: [],
        result: [
          { class: "MyApp.Tests.SlowTest", method: "A", status: 1, duration: 1000, failures: [] },
          { class: "MyApp.Tests.SlowTest", method: "B", status: 1, duration: 1100, failures: [] },
          { class: "MyApp.Tests.SlowTest", method: "C", status: 1, duration: 900, failures: [] },
        ],
      });

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.SlowTest", level: "class" },
      ctx,
    );

    const structured = result.structuredContent as { total: number; passed: number };
    expect(structured.total).toBe(3); // NOT 4 — TestA deduped by class::method key
    expect(structured.passed).toBe(3);
    expect(result.isError).toBeUndefined();
  });

  it("keeps polling on an EMPTY partial while retryafter is set, then returns the full terminal set", async () => {
    mockHttp.post.mockResolvedValue(envelope({ location: "job-slow-2" }));
    mockHttp.get
      .mockResolvedValueOnce({
        status: { errors: [] },
        console: [],
        result: [],
        retryafter: "1",
      })
      .mockResolvedValueOnce({
        status: { errors: [] },
        console: [],
        result: [
          { class: "MyApp.Tests.SlowTest", method: "A", status: 1, duration: 900, failures: [] },
          { class: "MyApp.Tests.SlowTest", method: "B", status: 1, duration: 950, failures: [] },
        ],
      });

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.SlowTest", level: "class" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledTimes(2);
    const structured = result.structuredContent as { total: number; passed: number };
    expect(structured.total).toBe(2);
    expect(structured.passed).toBe(2);
    expect(result.isError).toBeUndefined();
  });

  // ── Zero-result guard for class/method levels (AC 34.5.3, 34-4-R10) ──
  //
  // `package` already guards a zero-match run at discovery time (the
  // "should return empty results when no test classes found for package"
  // test above). `class` and `method` have no discovery step, so a run
  // that drains zero method-level rows previously reported total:0,
  // passed:0, failed:0 with NO error field — indistinguishable from a
  // genuinely empty test class. This is the exact defect the 34.4 reviewer
  // hit live at `level: "method"` and only caught via Rule #35's
  // total-vs-expected check. These tests pin the fix across the fixture
  // diversity Rule #58 calls for: a class that exists with zero matching
  // rows (this test — stands in for both "class exists, method doesn't"
  // and "class doesn't exist", since the Atelier endpoint returns the same
  // empty-array shape for both and the tool cannot distinguish them from
  // the response alone), the `method`-level case observed live, and the
  // `ClassName:MethodName` parse edges (missing colon, empty method part)
  // below.

  it("guards a class-level run with zero method rows via an explicit error instead of a silent total:0 (34-4-R10)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ location: "job-empty" }));
    mockHttp.get.mockResolvedValueOnce({
      status: { errors: [] },
      console: [],
      result: [],
    });

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.EmptyTest", level: "class" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledTimes(1);
    // AC 34.6.4 (34-5-R1, recorded Lead decision — both halves, not either/or):
    // the guard carries isError:true AND structuredContent with the SAME
    // {total,passed,failed,skipped,details,error} object as the text content,
    // so both isError- and structuredContent-reading consumers see it.
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    const parsed = JSON.parse(text) as { total: number; error?: string };
    expect(parsed.total).toBe(0);
    expect(parsed.error).toContain("MyApp.Tests.EmptyTest");
    expect(parsed.error).toContain("class");
    expect(result.structuredContent).toEqual(parsed);
  });

  it("guards a method-level run with zero method rows via an explicit error (observed live during the 34.4 review)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ location: "job-empty-method" }));
    mockHttp.get.mockResolvedValueOnce({
      status: { errors: [] },
      console: [],
      result: [],
    });

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest:NoSuchMethod", level: "method" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    const parsed = JSON.parse(text) as { total: number; error?: string };
    expect(parsed.total).toBe(0);
    expect(parsed.error).toContain("MyApp.Tests.UtilsTest:NoSuchMethod");
    expect(parsed.error).toContain("method");
    expect(result.structuredContent).toEqual(parsed);
  });

  // ── The guard must not blame the target for a run-level FAILURE ──
  //
  // Review finding (Story 34.5, lead layer — confirmed live on HSCUSTOM
  // 2026.1 Build 235U). The runner reports a failure that stopped any method
  // from running via a CLASS-LEVEL row: no `method` key, `status: 0`, and a
  // populated `error` string. The result loop drops every row without a
  // `method`, so `total` is 0 and the guard fired with "No tests found" —
  // telling the caller their class name was wrong when the class was found,
  // ran, and failed in setup, and when the runner had handed us the exact
  // reason. The fixture below is a VERBATIM live capture:
  //
  //   POST /api/atelier/v8/HSCUSTOM/work
  //     {"request":"unittest","tests":[{"class":"ExecuteMCPv2.Temp.SetupFailProbe345"}],"console":false}
  //   GET  /api/atelier/v8/HSCUSTOM/work/{id}  ->
  //     {"status":{"errors":[],"summary":""},"console":[],"result":[
  //       {"class":"ExecuteMCPv2.Temp.SetupFailProbe345","status":0,
  //        "duration":0.833,"failures":[],
  //        "error":"OnBeforeAllTests: ERROR #5001: deliberate setup failure probe345"}]}
  //
  // (probe class created, captured, and deleted during the review).
  it("surfaces a class-level failure diagnostic instead of blaming the target name (live-captured setup failure)", async () => {
    mockHttp.post.mockResolvedValue(envelope({ location: "job-setup-fail" }));
    mockHttp.get.mockResolvedValueOnce({
      status: { errors: [] },
      console: [],
      result: [
        {
          class: "ExecuteMCPv2.Temp.SetupFailProbe345",
          status: 0,
          duration: 0.833,
          failures: [],
          error: "OnBeforeAllTests: ERROR #5001: deliberate setup failure probe345",
        },
      ],
    });

    const result = await executeTestsTool.handler(
      { target: "ExecuteMCPv2.Temp.SetupFailProbe345", level: "class" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "") as { total: number; error?: string };
    expect(parsed.total).toBe(0);
    // The runner's own reason must reach the caller verbatim...
    expect(parsed.error).toContain("OnBeforeAllTests: ERROR #5001: deliberate setup failure probe345");
    expect(parsed.error).toContain("ExecuteMCPv2.Temp.SetupFailProbe345");
    // ...and the misleading not-found wording must NOT be used for a class
    // that was found and failed.
    expect(parsed.error).not.toContain("No tests found");
    expect(result.structuredContent).toEqual(parsed);
  });

  it("a class-level row with status 0 but no error text still avoids the misleading not-found wording", async () => {
    mockHttp.post.mockResolvedValue(envelope({ location: "job-classfail-noerr" }));
    mockHttp.get.mockResolvedValueOnce({
      status: { errors: [] },
      console: [],
      result: [{ class: "MyApp.Tests.BrokenTest", status: 0, duration: 1, failures: [] }],
    });

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.BrokenTest", level: "class" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "") as { total: number; error?: string };
    expect(parsed.total).toBe(0);
    expect(parsed.error).toContain("class-level failure");
    expect(parsed.error).not.toContain("No tests found");
    expect(result.structuredContent).toEqual(parsed);
  });

  // A PASSING class-level summary row (status 1, no error) is the ordinary
  // roll-up the endpoint sends alongside every run — live-verified on an
  // empty `%UnitTest.TestCase` subclass, which drains exactly
  // `{class, status: 1, duration: 0.086, failures: []}` and nothing else.
  // That must still read as "no tests found", not as a failure.
  it("a passing class-level summary row with zero methods still reports the plain not-found guard", async () => {
    mockHttp.post.mockResolvedValue(envelope({ location: "job-empty-class-summary" }));
    mockHttp.get.mockResolvedValueOnce({
      status: { errors: [] },
      console: [],
      result: [{ class: "ExecuteMCPv2.Temp.EmptyProbe345", status: 1, duration: 0.086, failures: [] }],
    });

    const result = await executeTestsTool.handler(
      { target: "ExecuteMCPv2.Temp.EmptyProbe345", level: "class" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "") as { total: number; error?: string };
    expect(parsed.total).toBe(0);
    expect(parsed.error).toContain("No tests found for 'ExecuteMCPv2.Temp.EmptyProbe345'");
    expect(result.structuredContent).toEqual(parsed);
  });

  // ── AC 34.5.4: the third level ──
  //
  // The package guard fired only at DISCOVERY time (zero classes matched the
  // SQL). A package whose classes ARE discovered but whose run drains zero
  // method rows kept the original silent `total: 0` — the exact 34-4-R10
  // shape, surviving at the one level the story claims to pin. Confirmed
  // live: `level: "package"` over a package of two real
  // `%UnitTest.TestCase` subclasses (one empty, one setup-failing) returned
  // `{"total":0,"passed":0,"failed":0,"skipped":0,"details":[]}` with no
  // error field at all.
  it("guards a package-level run whose classes were discovered but drained zero method rows (AC 34.5.4)", async () => {
    mockPackageDiscoverAndRun(["MyApp.Tests.AlphaTest", "MyApp.Tests.BetaTest"], []);

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests", level: "package" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "") as { total: number; error?: string };
    expect(parsed.total).toBe(0);
    expect(parsed.error).toContain("MyApp.Tests");
    expect(parsed.error).toContain("package");
    expect(result.structuredContent).toEqual(parsed);
  });

  it("a package-level run that drained zero rows surfaces a class-level setup failure too", async () => {
    mockPackageDiscoverAndRun(
      ["ExecuteMCPv2.Temp.SetupFailProbe345"],
      [
        {
          class: "ExecuteMCPv2.Temp.SetupFailProbe345",
          status: 0,
          duration: 0.833,
          failures: [],
          error: "OnBeforeAllTests: ERROR #5001: deliberate setup failure probe345",
        },
      ],
    );

    const result = await executeTestsTool.handler(
      { target: "ExecuteMCPv2.Temp", level: "package" },
      ctx,
    );

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]?.text ?? "") as { total: number; error?: string };
    expect(parsed.error).toContain("OnBeforeAllTests: ERROR #5001");
    expect(parsed.error).not.toContain("No tests found");
    expect(result.structuredContent).toEqual(parsed);
  });

  it("back-compat: a package with zero DISCOVERED classes keeps its original discovery-time message", async () => {
    // "Back-compat" here means the MESSAGE TEXT this guard has always produced
    // is unchanged (Rule #19) — the envelope shape gained isError/structuredContent
    // additively under AC 34.6.4, which the next two assertions cover.
    mockPackageDiscoverAndRun([], []);

    const result = await executeTestsTool.handler(
      { target: "MyApp.Nothing", level: "package" },
      ctx,
    );

    const parsed = JSON.parse(result.content[0]?.text ?? "") as { total: number; error?: string };
    expect(parsed.error).toBe("No test classes found in package 'MyApp.Nothing'");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual(parsed);
  });

  it("a matching method-level run reports real counts (not the zero-result guard)", async () => {
    // Raw row stripped, as the real endpoint returns it.
    mockQueueAndPoll([
      { class: "MyApp.Tests.UtilsTest", method: "Validate", status: 1, duration: 5, failures: [] },
    ]);

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest:TestValidate", level: "method" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as { total: number; passed: number; failed: number; error?: string };
    expect(structured.total).toBe(1);
    expect(structured.passed).toBe(1);
    expect(structured.failed).toBe(0);
    expect(structured.error).toBeUndefined();
  });

  it("method-level target missing the ':' separator runs the whole class unfiltered, and a real match is unaffected by the guard", async () => {
    // target.split(":") on a colon-less string yields [target, undefined] —
    // methodName is undefined, so no `methods` filter is sent; the whole
    // class runs. This pins that parse edge's existing behavior (Rule #58)
    // rather than changing it — the zero-result guard still applies
    // generically on top, keyed off the actual row count, not the parse.
    mockQueueAndPoll([
      { class: "MyApp.Tests.UtilsTest", method: "Validate", status: 1, duration: 5, failures: [] },
    ]);

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.UtilsTest", level: "method" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/work"),
      expect.objectContaining({
        request: "unittest",
        tests: [{ class: "MyApp.Tests.UtilsTest" }],
      }),
    );
    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as { total: number };
    expect(structured.total).toBe(1);
  });

  it("method-level target with an empty method part (trailing ':') runs the whole class unfiltered, and the guard fires on a genuine zero-match", async () => {
    // "Class:" splits to ["Class", ""] — methodName is "" (falsy), so the
    // `if (methodName)` check omits the `methods` filter, same as the
    // missing-colon case above. This test pins that parse edge AND proves
    // the zero-result guard still fires when the drained set is genuinely
    // empty for this shape (Rule #58's second named parse edge).
    mockHttp.post.mockResolvedValue(envelope({ location: "job-empty-trailing-colon" }));
    mockHttp.get.mockResolvedValueOnce({
      status: { errors: [] },
      console: [],
      result: [],
    });

    const result = await executeTestsTool.handler(
      { target: "MyApp.Tests.EmptyTest:", level: "method" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/work"),
      expect.objectContaining({
        request: "unittest",
        tests: [{ class: "MyApp.Tests.EmptyTest" }],
      }),
    );
    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    const parsed = JSON.parse(text) as { total: number; error?: string };
    expect(parsed.total).toBe(0);
    expect(parsed.error).toContain("MyApp.Tests.EmptyTest:");
    expect(result.structuredContent).toEqual(parsed);
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
