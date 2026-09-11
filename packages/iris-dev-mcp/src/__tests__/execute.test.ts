import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolContext, IrisHttpClient } from "@iris-mcp/shared";
import { IrisApiError, IrisConnectionError } from "@iris-mcp/shared";
import {
  executeCommandTool,
  executeClassMethodTool,
  executeTestsTool,
  createExecuteTestsHandler,
  type TestClock,
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

  // Ledger 34-3-R5 (Rule #54): `toStructured` used to defensively wrap an
  // `Array.isArray` branch (`{items, count}`) and a final `{value}`
  // scalar/null fallback — neither shape the real `/classmethod` endpoint can
  // ever emit (confirmed by reading `ExecuteMCPv2.REST.Command:ClassMethod`'s
  // and `ExecuteMCPv2.REST.Base:RenderResponseBody`'s full success/error
  // paths, both of which only ever hand `RenderResponseBody` a `%DynamicObject`
  // — see `toStructured`'s own banner in execute.ts). This pin replaces those
  // unreachable-shape assertions with the REAL shape: an arbitrary JSON object
  // passes straight through as `structuredContent`, unmodified — a plain cast,
  // not a remapping.
  it("passes an arbitrary object result straight through as structuredContent unmodified (34-3-R5 — the only shape /classmethod can ever emit)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ returnValue: "ok", argCount: 0, someExtraKey: "value" }),
    );

    const result = await executeClassMethodTool.handler(
      { className: "MyClass", methodName: "DoSomething" },
      ctx,
    );

    expect(result.structuredContent).toEqual({
      returnValue: "ok",
      argCount: 0,
      someExtraKey: "value",
    });
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

  // ── Zod schema bounds (ledger 34-3-R8) ──────────────────────────────────
  //
  // The schema used to be `z.array(z.any())` — it advertised (and the MCP SDK
  // enforced, at BOTH its own `validateToolInput` request-time check and this
  // repo's own `dispatchToolCall` re-validation — confirmed by reading
  // `server-base.ts`) NO real shape at all, even though the server's own
  // `ExecuteMCPv2.Utils.ParseArgEntry` (the actual enforcement) accepts only a
  // plain scalar or a `{byRef, value?}` marker object and rejects everything
  // else with a clear error. This is a STRUCTURAL TIGHTENING to match that
  // already-narrower server contract (Rule #19): every shape the server
  // genuinely accepts must still pass the schema; every shape the server
  // already rejected may now also be rejected earlier, at the schema/MCP
  // layer, instead of only after a round trip to IRIS.
  it("schema accepts every documented args shape (scalars and {byRef, value?} markers, 34-3-R8)", () => {
    const schema = executeClassMethodTool.inputSchema;
    // Plain scalars — string, number, boolean — passed by value.
    expect(
      schema.safeParse({
        className: "MyClass",
        methodName: "DoSomething",
        args: ["hello", 42, true],
      }).success,
    ).toBe(true);
    // {byRef: true} — Output-style undefined-in, value omitted entirely.
    expect(
      schema.safeParse({
        className: "MyClass",
        methodName: "DoSomething",
        args: [{ byRef: true }],
      }).success,
    ).toBe(true);
    // {byRef: true, value: <scalar>} and {byRef: false, value: <scalar>} —
    // both are valid marker shapes per ParseArgEntry (byRef:false requires a
    // value, which this call supplies).
    expect(
      schema.safeParse({
        className: "MyClass",
        methodName: "DoSomething",
        args: [
          { byRef: true, value: "start" },
          { byRef: false, value: 1 },
        ],
      }).success,
    ).toBe(true);
    // No args at all — still optional.
    expect(
      schema.safeParse({ className: "MyClass", methodName: "DoSomething" }).success,
    ).toBe(true);
  });

  it("schema rejects args entries ParseArgEntry itself rejects, at the schema level (34-3-R8)", () => {
    const schema = executeClassMethodTool.inputSchema;
    const base = { className: "MyClass", methodName: "DoSomething" };
    // A nested array element — ParseArgEntry: "Argument N is a JSON array;
    // expected a scalar or a {byRef, value} marker object".
    expect(schema.safeParse({ ...base, args: [[1, 2]] }).success).toBe(false);
    // A bare JSON null element — ParseArgEntry: "Argument N cannot be JSON
    // null; use {"byRef":true} for an undefined argument, or "" for an empty
    // string".
    expect(schema.safeParse({ ...base, args: [null] }).success).toBe(false);
    // An object missing the 'byRef' key — ParseArgEntry: "Argument N is an
    // object without a 'byRef' key; expected a scalar or a {byRef, value}
    // marker object".
    expect(schema.safeParse({ ...base, args: [{ notAMarker: true }] }).success).toBe(
      false,
    );
    // A marker 'value' that is JSON null — ParseArgEntry: "marker 'value'
    // cannot be JSON null; omit 'value' entirely for an undefined argument".
    expect(
      schema.safeParse({ ...base, args: [{ byRef: true, value: null }] }).success,
    ).toBe(false);
    // A marker 'value' that is an object — ParseArgEntry: "marker 'value'
    // must be a scalar (string, number, or boolean)".
    expect(
      schema.safeParse({ ...base, args: [{ byRef: true, value: { nested: 1 } }] })
        .success,
    ).toBe(false);
    // A marker 'value' that is an array — same rejection as the object case.
    expect(
      schema.safeParse({ ...base, args: [{ byRef: true, value: [1] }] }).success,
    ).toBe(false);
    // 'byRef' present but not a boolean — ParseArgEntry: "'byRef' must be a
    // JSON boolean".
    expect(
      schema.safeParse({ ...base, args: [{ byRef: "true", value: "x" }] }).success,
    ).toBe(false);
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
  //
  // Story 34.7 AC 34.7.3 split this ONE test into TWO (Rule #54): `returnValue`,
  // `byRefValues`, and `output` now share a SINGLE 32768-character response budget
  // (spent in that field order) instead of three independent 32768 budgets, so a
  // single envelope can no longer show `returnValue` AND `output` BOTH at the full
  // 32768 characters simultaneously — that shape can never leave the real server. Each
  // scenario below is independently realistic under the shared-budget model.
  it("passes an over-budget returnValue (consuming the ENTIRE shared budget) through unchanged, leaving output empty and byRefValues omitted (server-computed, tool is a pure pass-through)", async () => {
    // Rule #54 — these fixtures must be shapes the REAL server can actually emit, and
    // Rule #36 — pinned from the live measurement in this story's Dev Notes: the marker
    // is `\n[IRIS-MCP-TRUNCATED ceiling=<N>chars]\n` = 36 + digits(N) characters (41 at
    // the default 32768 ceiling), so a returnValue alone exceeding the WHOLE shared
    // budget is truncated to exactly 32768 characters total — consuming it entirely,
    // which is why output is empty (0 remaining) and the byRef position is omitted
    // rather than shown as a hard-cut value.
    const CEILING = 32768;
    const outputMarker = "\n[IRIS-MCP-TRUNCATED ceiling=32768chars]\n";
    const overBudgetReturnValue = "B".repeat(CEILING - outputMarker.length) + outputMarker;
    expect(overBudgetReturnValue.length).toBe(CEILING);
    mockHttp.post.mockResolvedValue(
      envelope({
        returnValue: overBudgetReturnValue,
        argCount: 1,
        output: "",
        byRefValues: {},
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
    expect(structured.returnValue).toBe(overBudgetReturnValue);
    expect(structured.returnValue).toContain("[IRIS-MCP-TRUNCATED");
    expect(structured.output).toBe("");
    expect(structured.byRefValues).toEqual({});
    expect(structured.truncated).toBe(true);
    expect(structured.byRefTruncated).toBe(true);
    expect(structured.returnValueTruncated).toBe(true);
    expect(result.isError).toBeUndefined();
  });

  it("passes a small (untruncated) returnValue and byRefValues alongside an over-budget output through unchanged (server-computed, tool is a pure pass-through)", async () => {
    // Rule #54 — this envelope must be a shape the REAL server can emit, and Rule #36 —
    // every figure below is DERIVED from the server's own documented arithmetic, never
    // hard-coded, so the fixture cannot drift into an impossible shape.
    //
    // The canonical shared-budget case: `returnValue` is small so it is never touched
    // (returnValueTruncated: false), `byRefValues` is small so it is not truncated
    // either (byRefTruncated: false), and `output` — LAST in the shared-budget priority
    // order — absorbs the truncation, exactly as the tool description says narration
    // usually does. The budget `output` therefore sees is
    // 32768 - len(returnValue) - len(byRef value), and the marker the server stamps
    // reports THAT number, not 32768. The server's own invariant (ApplyOutputCeiling)
    // is that the result never exceeds the ceiling it stamps, so the total is asserted.
    //
    // NOTE: a marker-less byRef hard-cut CANNOT coexist with a small untruncated
    // returnValue — a byRef leaf only loses its marker once the remaining budget is
    // below the marker's own ~37-41 characters, which requires returnValue to have
    // consumed nearly the whole budget. That combination is covered by the
    // over-budget-returnValue scenario above instead.
    const CEILING = 32768;
    const smallReturnValue = "short";
    const smallByRefValue = "C".repeat(20);
    const outputBudget = CEILING - smallReturnValue.length - smallByRefValue.length;
    const outputMarker = `\n[IRIS-MCP-TRUNCATED ceiling=${outputBudget}chars]\n`;
    const overBudgetOutput =
      "A".repeat(outputBudget - outputMarker.length) + outputMarker;
    expect(overBudgetOutput.length).toBe(outputBudget);
    mockHttp.post.mockResolvedValue(
      envelope({
        returnValue: smallReturnValue,
        argCount: 1,
        output: overBudgetOutput,
        byRefValues: { "0": smallByRefValue },
        truncated: true,
        byRefTruncated: false,
        returnValueTruncated: false,
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
    expect(structured.returnValue).toBe(smallReturnValue);
    expect(structured.returnValueTruncated).toBe(false);
    expect(structured.output).toBe(overBudgetOutput);
    expect(structured.output).toContain(`[IRIS-MCP-TRUNCATED ceiling=${outputBudget}chars]`);
    expect(structured.byRefValues).toEqual({ "0": smallByRefValue });
    expect(structured.truncated).toBe(true);
    expect(structured.byRefTruncated).toBe(false);
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
  /** `/global` GET reads (run-index capture) — see beforeEach. */
  let globalGet: ReturnType<typeof vi.fn>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    // MOCK PLUMBING ONLY (Story 36.1 code review — lead ruling on
    // `36-1-QA-2`, AC 36.1.7 as amended): the tool reads `^UnitTest.Result`
    // BEFORE `POST /work` and the run-index queue node on every
    // still-running poll, both via the ExecuteMCPv2 `/global` GET route —
    // the SAME `ctx.http.get` transport the Atelier polls use. Route those
    // reads to their own mock (`globalGet`) so every Atelier-poll fixture
    // below (`mockHttp.get` chains and call counts) is served exactly as it
    // was; no test body or assertion changes. Default answer: an undefined
    // node, `{value: "", defined: false}` — a shape the real route returns
    // (`ExecuteMCPv2.REST.Global:GetGlobal`, Rule #54).
    globalGet = vi.fn(async () => ({
      status: { errors: [] },
      console: [],
      result: { value: "", defined: false },
    }));
    const routedHttp = {
      ...mockHttp,
      get: (path: string, options?: unknown) =>
        path.startsWith("/api/executemcp/v2/global?") ? globalGet(path, options) : mockHttp.get(path, options),
    };
    ctx = createMockCtx(routedHttp as unknown as IrisHttpClient);
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

  // ── Story 36.1: running-result contract, handles, timeout budget ──
  //
  // Testability seam (AC 36.1.7): an injectable `now`/`sleep` pair
  // (TestClock), not `vi.useFakeTimers()` — see execute.ts's TestClock
  // banner for why. `createExecuteTestsHandler(clock)` is a factory the
  // production export (`executeTestsTool.handler`) wraps with NO argument
  // (real clock) — every test above this point exercises exactly that
  // real-clock, real-`setTimeout` path unchanged, which is itself the Rule
  // #19 proof that introducing the seam altered nothing about today's
  // default behavior.

  /** Deterministic fake clock: `sleep` advances `now()` synchronously —
   * no real wall-clock time is ever spent, however many iterations a test
   * needs to reach its deadline. */
  function createFakeClock(): TestClock {
    let current = 0;
    return {
      now: () => current,
      sleep: async (ms: number) => {
        current += ms;
      },
    };
  }

  /** Parse the `global`/`subscripts` query params off a `/global` GET path
   * built by execute.ts's `readGlobalNode` (the same shape `iris_global_get`
   * builds). */
  function parseGlobalPath(path: string): { global: string; subscripts: string } {
    const qs = path.slice(path.indexOf("?") + 1);
    const params = new URLSearchParams(qs);
    return { global: params.get("global") ?? "", subscripts: params.get("subscripts") ?? "" };
  }

  /**
   * Serve the Atelier polls (`mockHttp.get`) in order from `pollResponses`
   * (the last entry repeats), and the `/global` reads (`globalGet`, routed
   * in this describe's beforeEach) from `globalStubs`, keyed
   * `"<global>|<subscripts>"` — a stub value may be a function of the read
   * count for that key, to model a node that changes over time. An
   * unconfigured key answers `{value: "", defined: false}` (an undefined
   * node — a real shape the route returns, Rule #54).
   */
  function installPathAwareGet(
    pollResponses: Array<{ result: unknown; retryafter?: string }>,
    globalStubs: Record<
      string,
      { value: string; defined: boolean } | ((readCount: number) => { value: string; defined: boolean })
    > = {},
  ) {
    const readCounts = new Map<string, number>();
    globalGet.mockImplementation(async (path: string) => {
      const { global: g, subscripts } = parseGlobalPath(path);
      const key = `${g}|${subscripts}`;
      const count = (readCounts.get(key) ?? 0) + 1;
      readCounts.set(key, count);
      const entry = globalStubs[key];
      const stub = typeof entry === "function" ? entry(count) : (entry ?? { value: "", defined: false });
      return { status: { errors: [] }, console: [], result: stub };
    });
    let pollIndex = 0;
    mockHttp.get.mockImplementation(async () => {
      const resp = pollResponses[pollIndex] ?? pollResponses[pollResponses.length - 1] ?? { result: [] };
      pollIndex++;
      return {
        status: { errors: [] },
        console: [],
        result: resp.result,
        ...(resp.retryafter ? { retryafter: resp.retryafter } : {}),
      };
    });
  }

  describe("running-result contract, handles, and timeout budget (Story 36.1)", () => {
    it("returns a 'running' envelope (isError:false) with jobId/runIndex captured via the queue node when the wait budget expires mid-run", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-running-1" }));
      // Always still-running — never terminates within the test's budget.
      installPathAwareGet(
        [{ result: [], retryafter: "1" }],
        {
          'IRIS.TempAtelierAsyncQueue|job-running-1,"unittest","id"': { value: "42", defined: true },
          "UnitTest.Result|": { value: "41", defined: true },
        },
      );

      const clock = createFakeClock();
      const handler = createExecuteTestsHandler(clock);
      const result = await handler({ target: "MyApp.Tests.SlowClass", level: "class", timeout: 1 }, ctx);

      expect(result.isError).toBe(false);
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.status).toBe("running");
      expect(structured.jobId).toBe("job-running-1");
      expect(structured.runIndex).toBe(42);
      expect(structured.runIndexSource).toBe("queue");
      expect(structured.timeoutMs).toBe(1000);
      expect(structured.elapsedMs).toBe(1000);
      expect(structured.target).toBe("MyApp.Tests.SlowClass");
      expect(structured.level).toBe("class");
      expect(structured.partial).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, details: [] });
      expect(typeof structured.hint).toBe("string");
      expect(structured.hint as string).toContain("Do NOT re-submit");
      const text = result.content[0]?.text ?? "";
      expect(text).toContain("TEST RUN STILL EXECUTING");
      expect(text).toContain("Do NOT re-submit");
      expect(text).toContain("jobId=job-running-1");
      expect(text).toContain("runIndex=42");
    });

    it("Rule #59/#48 mutation-guard companion: the running branch carries a partial snapshot of whatever drained before expiry", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-running-2" }));
      installPathAwareGet([
        { result: [{ class: "MyApp.Tests.SlowClass", method: "A", status: 1, duration: 10, failures: [] }], retryafter: "1" },
      ]);

      const clock = createFakeClock();
      const handler = createExecuteTestsHandler(clock);
      const result = await handler({ target: "MyApp.Tests.SlowClass", level: "class", timeout: 1 }, ctx);

      const structured = result.structuredContent as { partial: { total: number; passed: number; details: { method: string }[] } };
      expect(structured.partial.total).toBe(1);
      expect(structured.partial.passed).toBe(1);
      expect(structured.partial.details[0]?.method).toBe("TestA");
    });

    /**
     * Shared driver for the counter-fallback tests: the queue node NEVER
     * becomes defined (an undefined node — a real shape, Rule #54), the run
     * completes on the 3rd poll (two still-running polls, then terminal),
     * and the `^UnitTest.Result` counter root answers `counterBeforeValue`
     * on its FIRST read (the pre-`POST /work` snapshot) and
     * `counterAfterValue` on every later one (the post-completion read).
     */
    function installCounterFallbackDriver(
      counterBeforeValue: string,
      counterAfterValue: string,
      terminalRows: unknown[] = [
        { class: "MyApp.Tests.FastClass", method: "Only", status: 1, duration: 5, failures: [] },
      ],
    ) {
      installPathAwareGet(
        [{ result: [], retryafter: "1" }, { result: [], retryafter: "1" }, { result: terminalRows }],
        {
          "UnitTest.Result|": (n) => ({ value: n === 1 ? counterBeforeValue : counterAfterValue, defined: true }),
        },
      );
    }

    it("falls back to the ^UnitTest.Result counter (delta exactly 1) when the queue node was never captured", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-fallback-1" }));
      installCounterFallbackDriver("9", "10");

      const clock = createFakeClock();
      const handler = createExecuteTestsHandler(clock);
      const result = await handler({ target: "MyApp.Tests.FastClass", level: "class" }, ctx);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.status).toBe("completed");
      expect(structured.runIndex).toBe(10);
      expect(structured.runIndexSource).toBe("counter");
      expect(structured).not.toHaveProperty("runIndexNote");
    });

    it("reports runIndex:null with a runIndexNote when the counter delta is ambiguous (not exactly 1)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-fallback-2" }));
      installCounterFallbackDriver("9", "12"); // delta 3 — ambiguous.

      const clock = createFakeClock();
      const handler = createExecuteTestsHandler(clock);
      const result = await handler({ target: "MyApp.Tests.FastClass", level: "class" }, ctx);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.runIndex).toBeNull();
      expect(structured.runIndexSource).toBeNull();
      expect(typeof structured.runIndexNote).toBe("string");
      expect(structured.runIndexNote as string).toContain("advanced by 3");
    });

    // ── Story 36.1 code review: ledger 36-1-QA-1 / 36-1-QA-2 (lead ruling — AC 36.1.5 wins) ──

    it("36-1-QA-1: a STILL-RUNNING result whose queue node was never observed reports runIndex:null — never another client's run via the counter", async () => {
      // Real interleaving (Rule #54 — every fake is a shape the `/global`
      // route really returns): our worker is slow to start (WQM backlog / a
      // slow class compile), so IRIS.TempAtelierAsyncQueue(<jobId>,"unittest",
      // "id") is still UNDEFINED on every poll before the budget expires,
      // while ANOTHER client's run allocates the next ^UnitTest.Result index
      // during our wait (41 at our pre-POST read, 42 on any later read). A
      // counter delta of 1 here is NOT ours — the pre-fix code reported 42.
      mockHttp.post.mockResolvedValue(envelope({ location: "job-slow-start" }));
      installPathAwareGet([{ result: [], retryafter: "1" }], {
        "UnitTest.Result|": (n) => ({ value: n === 1 ? "41" : "42", defined: true }),
      });

      const handler = createExecuteTestsHandler(createFakeClock());
      const result = await handler({ target: "MyApp.Tests.SlowClass", level: "class", timeout: 1 }, ctx);

      expect(result.isError).toBe(false);
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.status).toBe("running");
      expect(structured.runIndex).toBeNull();
      expect(structured.runIndexSource).toBeNull();
      expect(structured.runIndexNote as string).toContain("not yet allocated/captured");
      expect(structured.runIndexNote as string).toContain("Re-attach by jobId");
      expect(result.content[0]?.text).toContain("runIndex=unknown");
    });

    it("36-1-QA-2: the ^UnitTest.Result 'before' snapshot is read BEFORE POST /work, so a run finishing on its FIRST poll still gets a handle", async () => {
      // A fast run: completes on the first poll (no retryafter ever seen, so
      // the queue node — killed by that same terminal poll — is never
      // readable). The pre-fix code took no counter snapshot at all here
      // and returned runIndex:null with no note (the common case, per QA).
      mockHttp.post.mockResolvedValue(envelope({ location: "job-fast" }));
      installPathAwareGet(
        [{ result: [{ class: "MyApp.Tests.FastClass", method: "Only", status: 1, duration: 5, failures: [] }] }],
        { "UnitTest.Result|": (n) => ({ value: n === 1 ? "9" : "10", defined: true }) },
      );

      const handler = createExecuteTestsHandler(createFakeClock());
      const result = await handler({ target: "MyApp.Tests.FastClass", level: "class" }, ctx);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.status).toBe("completed");
      expect(structured.runIndex).toBe(10);
      expect(structured.runIndexSource).toBe("counter");
      // Ordering pin (AC 36.1.5 "read BEFORE queueing"): the first counter
      // read happens before the POST /work.
      const firstCounterRead = globalGet.mock.calls.findIndex(([p]) => String(p).includes("global=UnitTest.Result"));
      const workPost = mockHttp.post.mock.calls.findIndex(([p]) => String(p).endsWith("/work"));
      expect(firstCounterRead).toBeGreaterThanOrEqual(0);
      expect(workPost).toBeGreaterThanOrEqual(0);
      expect(globalGet.mock.invocationCallOrder[firstCounterRead]!).toBeLessThan(
        mockHttp.post.mock.invocationCallOrder[workPost]!,
      );
    });

    it("36-1-QA-2: the queue node is read from the FIRST still-running poll (no 2-poll threshold)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-one-retry" }));
      installPathAwareGet(
        [
          { result: [], retryafter: "1" },
          { result: [{ class: "MyApp.Tests.SlowTest", method: "A", status: 1, duration: 900, failures: [] }] },
        ],
        { 'IRIS.TempAtelierAsyncQueue|job-one-retry,"unittest","id"': { value: "77", defined: true } },
      );

      const handler = createExecuteTestsHandler(createFakeClock());
      const result = await handler({ target: "MyApp.Tests.SlowTest", level: "class" }, ctx);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.status).toBe("completed");
      expect(structured.runIndex).toBe(77);
      expect(structured.runIndexSource).toBe("queue");
      expect(structured).not.toHaveProperty("runIndexNote");
    });

    it("36-1-QA-2: a counter delta of 0 on a completed run reports null with a 'no run index was allocated' note", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-delta-0" }));
      installCounterFallbackDriver("9", "9");

      const handler = createExecuteTestsHandler(createFakeClock());
      const result = await handler({ target: "MyApp.Tests.FastClass", level: "class" }, ctx);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.runIndex).toBeNull();
      expect(structured.runIndexSource).toBeNull();
      expect(structured.runIndexNote as string).toContain("No run index was allocated");
    });

    it("a completed run that drained NO rows is never counter-attributed, even at delta 1 (compile failure + a concurrent run)", async () => {
      // %Api.Atelier.v8:ExecuteAsyncRequest quits BEFORE publishing the run
      // index or calling %UnitTest.Manager.RunTest when the test class fails
      // to compile, so this job allocated nothing; the single increment in
      // the window is another client's run.
      mockHttp.post.mockResolvedValue(envelope({ location: "job-compile-fail" }));
      installCounterFallbackDriver("9", "10", []);

      const handler = createExecuteTestsHandler(createFakeClock());
      const result = await handler({ target: "MyApp.Tests.Broken", level: "class" }, ctx);

      expect(result.isError).toBe(true); // the zero-result guard, carrying the handles
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.jobId).toBe("job-compile-fail");
      expect(structured.runIndex).toBeNull();
      expect(structured.runIndexSource).toBeNull();
      expect(structured.runIndexNote as string).toContain("without draining any result rows");
    });

    it("a counter that moved backwards (reset/purge) reports null with an explicit note", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-reset" }));
      installCounterFallbackDriver("12", "3");

      const handler = createExecuteTestsHandler(createFakeClock());
      const result = await handler({ target: "MyApp.Tests.FastClass", level: "class" }, ctx);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.runIndex).toBeNull();
      expect(structured.runIndexNote as string).toContain("moved backwards by 9");
    });

    it("a network/timeout error while POLLING an existing job returns its handles, the drained rows and the re-attach hint instead of throwing", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-net-blip" }));
      mockHttp.get
        .mockResolvedValueOnce({
          status: { errors: [] },
          console: [],
          result: [{ class: "MyApp.Tests.SlowTest", method: "A", status: 1, duration: 10, failures: [] }],
          retryafter: "1",
        })
        .mockRejectedValueOnce(
          new IrisConnectionError("TIMEOUT", "Connection to IRIS timed out after 60000ms", "Check that IRIS is running"),
        );

      const handler = createExecuteTestsHandler(createFakeClock());
      const result = await handler({ target: "MyApp.Tests.SlowTest", level: "class" }, ctx);

      expect(result.isError).toBe(true);
      const structured = result.structuredContent as {
        jobId: string;
        error: string;
        partial: { total: number; details: { method: string }[] };
        hint: string;
      };
      expect(structured.jobId).toBe("job-net-blip");
      expect(structured.error).toContain("timed out");
      expect(structured.partial.total).toBe(1);
      expect(structured.partial.details[0]?.method).toBe("TestA");
      expect(structured.hint).toContain("may still be executing");
      expect(structured.hint).toContain("Do NOT re-submit");
    });

    it("stops the per-poll queue-node read after 3 consecutive /global transport failures (route unavailable)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-no-global" }));
      installPathAwareGet([{ result: [], retryafter: "1" }]);
      globalGet.mockRejectedValue(
        new IrisApiError(404, [], "/api/executemcp/v2/global", "IRIS returned HTTP 404 for GET /api/executemcp/v2/global."),
      );

      const handler = createExecuteTestsHandler(createFakeClock());
      const result = await handler({ target: "MyApp.Tests.SlowClass", level: "class", timeout: 10 }, ctx);

      // 10 s budget / 200 ms interval = 50 polls, but at most 3 queue-node reads.
      expect(mockHttp.get).toHaveBeenCalledTimes(50);
      const queueReads = globalGet.mock.calls.filter(([p]) => String(p).includes("IRIS.TempAtelierAsyncQueue"));
      expect(queueReads).toHaveLength(3);
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.status).toBe("running");
      expect(structured.runIndex).toBeNull();
      expect(structured.runIndexNote as string).toContain("failed repeatedly");
    });

    it("the running hint names BOTH re-attach routes — the jobId's queue node even once runIndex is captured, and SQL joined down from TestInstance (the only table with InstanceIndex)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-hint" }));
      installPathAwareGet([{ result: [], retryafter: "1" }], {
        'IRIS.TempAtelierAsyncQueue|job-hint,"unittest","id"': { value: "42", defined: true },
      });

      const handler = createExecuteTestsHandler(createFakeClock());
      const result = await handler({ target: "MyApp.Tests.SlowClass", level: "class", timeout: 1 }, ctx);

      const hint = (result.structuredContent as { hint: string }).hint;
      expect(hint).toContain("already captured: 42");
      expect(hint).toContain(`iris_global_get with global "IRIS.TempAtelierAsyncQueue" and subscripts 'job-hint,"unittest","id"'`);
      // The route as live-run at the Story 36.1 code review: InstanceIndex
      // exists ONLY on TestInstance (INFORMATION_SCHEMA.COLUMNS), so the
      // method rows are joined down to it...
      expect(hint).toContain(
        "JOIN %UnitTest_Result.TestSuite ts ON tc.TestSuite = ts.ID JOIN %UnitTest_Result.TestInstance ti ON " +
          "ts.TestInstance = ti.ID WHERE ti.InstanceIndex = ?",
      );
      // ...and, because those rows exist mid-run (a still-hanging method
      // already reads Status 1), the query carries the completion signal.
      expect(hint).toContain("ti.DateTime AS FinishedAt");
      expect(hint).toContain("EMPTY FinishedAt means the run is STILL executing");
      expect(hint).toContain("Never MAX(InstanceIndex)");
      expect(hint).toContain("iris_test_status");
    });

    // ── timeout precedence + cap clamp (AC 36.1.4, Rule #59) ──

    it("timeout precedence: explicit arg beats ctx.config.testTimeoutMs (IRIS_TEST_TIMEOUT)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-prec-1" }));
      installPathAwareGet([{ result: [], retryafter: "1" }]);
      ctx.config = { ...ctx.config, testTimeoutMs: 5_000 };

      const clock = createFakeClock();
      const handler = createExecuteTestsHandler(clock);
      const result = await handler({ target: "MyApp.Tests.SlowClass", level: "class", timeout: 10 }, ctx);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.status).toBe("running");
      expect(structured.timeoutMs).toBe(10_000);
    });

    it("timeout precedence: IRIS_TEST_TIMEOUT (ctx.config.testTimeoutMs) applies when no explicit timeout arg is given", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-prec-2" }));
      installPathAwareGet([{ result: [], retryafter: "1" }]);
      ctx.config = { ...ctx.config, testTimeoutMs: 7_000 };

      const clock = createFakeClock();
      const handler = createExecuteTestsHandler(clock);
      const result = await handler({ target: "MyApp.Tests.SlowClass", level: "class" }, ctx);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.timeoutMs).toBe(7_000);
    });

    it("timeout default: neither explicit arg nor IRIS_TEST_TIMEOUT set -> 120s (unchanged default, Rule #19)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-prec-3" }));
      installPathAwareGet([{ result: [], retryafter: "1" }]);

      const clock = createFakeClock();
      const handler = createExecuteTestsHandler(clock);
      const result = await handler({ target: "MyApp.Tests.SlowClass", level: "class" }, ctx);

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.timeoutMs).toBe(120_000);
    });

    it("clamps an over-cap timeout to 3600s and flags timeoutCapped:true (rowsCapped precedent)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-cap-1" }));
      installPathAwareGet([{ result: [], retryafter: "1" }]);

      const clock = createFakeClock();
      const handler = createExecuteTestsHandler(clock);
      const result = await handler(
        { target: "MyApp.Tests.SlowClass", level: "class", timeout: 999_999 },
        ctx,
      );

      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.timeoutMs).toBe(3_600_000);
      expect(structured.timeoutCapped).toBe(true);
    });

    it("does not set timeoutCapped when the resolved budget is under the cap", async () => {
      mockQueueAndPoll([
        { class: "MyApp.Tests.UtilsTest", method: "Validate", status: 1, duration: 5, failures: [] },
      ]);

      const result = await executeTestsTool.handler(
        { target: "MyApp.Tests.UtilsTest", level: "class", timeout: 30 },
        ctx,
      );

      expect(result.structuredContent).not.toHaveProperty("timeoutCapped");
    });

    // ── Rule #19 back-compat pin: completed envelope minus additive fields ──

    it("back-compat (Rule #19): the completed envelope's PRE-36.1 fields (total/passed/failed/skipped/details) are byte-identical; only status/jobId/runIndex/runIndexSource/runIndexNote are additive", async () => {
      mockQueueAndPoll([
        { class: "MyApp.Tests.UtilsTest", method: "Validate", status: 1, duration: 10, failures: [] },
        { class: "MyApp.Tests.UtilsTest", method: "Format", status: 0, duration: 15, failures: [{ message: "boom" }] },
      ]);

      const result = await executeTestsTool.handler(
        { target: "MyApp.Tests.UtilsTest", level: "class" },
        ctx,
      );

      const structured = result.structuredContent as Record<string, unknown>;
      // runIndexNote is the AC 36.1.5 additive explanation carried whenever
      // runIndex is null (this fixture's counter never moves: delta 0).
      const { status, jobId, runIndex, runIndexSource, runIndexNote, ...preFeatureShape } = structured;
      expect(status).toBe("completed");
      expect(typeof jobId).toBe("string");
      expect(runIndex === null || typeof runIndex === "number").toBe(true);
      expect(runIndexSource === null || runIndexSource === "queue" || runIndexSource === "counter").toBe(true);
      expect(runIndexNote === undefined || typeof runIndexNote === "string").toBe(true);
      expect(preFeatureShape).toEqual({
        total: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        details: [
          { class: "MyApp.Tests.UtilsTest", method: "TestValidate", status: "passed", duration: 10, message: "" },
          { class: "MyApp.Tests.UtilsTest", method: "TestFormat", status: "failed", duration: 15, message: "boom" },
        ],
      });
    });

    // ── Shared envelope helper on every non-completed return (AC 36.1.6) ──

    it("the 'no job ID' early return carries structuredContent (isError:true) via the shared envelope helper", async () => {
      mockHttp.post.mockResolvedValue(envelope({}));

      const result = await executeTestsTool.handler({ target: "MyApp.Tests", level: "class" }, ctx);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        total: 0,
        passed: 0,
        failed: 0,
        skipped: 0,
        details: [],
        error: "Failed to queue test execution — no job ID returned",
      });
      // No job ever existed — jobId/runIndex are absent, not null.
      expect(result.structuredContent).not.toHaveProperty("jobId");
      expect(result.structuredContent).not.toHaveProperty("runIndex");
    });

    it("the IrisApiError catch carries jobId (when already known) alongside its pre-existing human-readable text", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-cancelled" }));
      mockHttp.get
        .mockResolvedValueOnce({ status: { errors: [] }, console: [], result: [], retryafter: "1" })
        .mockRejectedValueOnce(
          new IrisApiError(
            404,
            [],
            "/api/atelier/v7/USER/work/job-cancelled",
            "IRIS returned HTTP 404 for GET /api/atelier/v7/USER/work/job-cancelled. Check the request parameters and try again.",
          ),
        );

      const result = await executeTestsTool.handler({ target: "MyApp.Tests.Cancellable", level: "class" }, ctx);

      expect(result.isError).toBe(true);
      expect(result.content[0]?.text).toContain("Error executing tests for 'MyApp.Tests.Cancellable'");
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.jobId).toBe("job-cancelled");
      expect(structured.error).toContain("HTTP 404");
      // The one still-running poll before the throw read the queue node and
      // found it undefined (this describe's default `/global` answer).
      expect(structured.runIndex).toBeNull();
      expect(structured.runIndexSource).toBeNull();
      // The job exists server-side, so the error carries the re-attach
      // guidance and the drained-so-far rows (architecture L1).
      expect(structured.hint as string).toContain("Do NOT re-submit");
      expect(structured.partial).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0, details: [] });
    });

    it("the zero-result guard also carries jobId/runIndex when known (AC 36.1.5)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-empty-slow" }));
      installPathAwareGet(
        [
          { result: [], retryafter: "1" },
          { result: [], retryafter: "1" },
          { result: [] },
        ],
        {
          'IRIS.TempAtelierAsyncQueue|job-empty-slow,"unittest","id"': { value: "7", defined: true },
        },
      );

      const result = await executeTestsTool.handler({ target: "MyApp.Tests.EmptySlow", level: "class" }, ctx);

      expect(result.isError).toBe(true);
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.error).toContain("No tests found");
      expect(structured.jobId).toBe("job-empty-slow");
      expect(structured.runIndex).toBe(7);
      expect(structured.runIndexSource).toBe("queue");
    });

    // ── Ledger 34-5-R2 (AC 36.1.12 (a)): malformed method-level target ──

    it("rejects a method-level target with more than one ':' separator (34-5-R2)", async () => {
      const result = await executeTestsTool.handler(
        { target: "MyApp.Tests.UtilsTest:TestFoo:TestBar", level: "method" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(mockHttp.post).not.toHaveBeenCalled();
      const structured = result.structuredContent as { error: string };
      expect(structured.error).toContain("at most one ':' separator");
    });

    it("rejects a method-level target with an empty class segment (34-5-R2)", async () => {
      const result = await executeTestsTool.handler(
        { target: ":TestFoo", level: "method" },
        ctx,
      );

      expect(result.isError).toBe(true);
      expect(mockHttp.post).not.toHaveBeenCalled();
      const structured = result.structuredContent as { error: string };
      expect(structured.error).toContain("must not be empty");
    });

    it("trims whitespace around a method-level target's segments (34-5-R2 fix)", async () => {
      mockQueueAndPoll([
        { class: "MyApp.Tests.UtilsTest", method: "Foo", status: 1, duration: 5, failures: [] },
      ]);

      await executeTestsTool.handler({ target: "MyApp.Tests.UtilsTest : TestFoo", level: "method" }, ctx);

      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining("/work"),
        expect.objectContaining({ tests: [{ class: "MyApp.Tests.UtilsTest", methods: ["Foo"] }] }),
      );
    });

    it("still runs the whole class unfiltered for the pinned missing-colon edge (Story 34.5 pin preserved)", async () => {
      mockQueueAndPoll([
        { class: "MyApp.Tests.UtilsTest", method: "Validate", status: 1, duration: 5, failures: [] },
      ]);

      const result = await executeTestsTool.handler({ target: "MyApp.Tests.UtilsTest", level: "method" }, ctx);

      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining("/work"),
        expect.objectContaining({ tests: [{ class: "MyApp.Tests.UtilsTest" }] }),
      );
      expect(result.isError).toBeUndefined();
    });

    it("still runs the whole class unfiltered for the pinned trailing-colon edge (Story 34.5 pin preserved)", async () => {
      mockHttp.post.mockResolvedValue(envelope({ location: "job-empty-trailing-colon-2" }));
      mockHttp.get.mockResolvedValueOnce({ status: { errors: [] }, console: [], result: [] });

      const result = await executeTestsTool.handler({ target: "MyApp.Tests.EmptyTest:", level: "method" }, ctx);

      expect(mockHttp.post).toHaveBeenCalledWith(
        expect.stringContaining("/work"),
        expect.objectContaining({ tests: [{ class: "MyApp.Tests.EmptyTest" }] }),
      );
      expect(result.isError).toBe(true);
    });

    // ── Ledger 34-5-R3 (AC 36.1.12 (b), return leg): a method literally named "Test" ──

    it("counts and restores a method literally named 'Test' instead of silently dropping it (34-5-R3 return leg)", async () => {
      mockQueueAndPoll([
        { class: "MyApp.Tests.LiteralTest", method: "", status: 1, duration: 3, failures: [] },
      ]);

      const result = await executeTestsTool.handler(
        { target: "MyApp.Tests.LiteralTest", level: "class" },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { total: number; details: { method: string }[] };
      expect(structured.total).toBe(1);
      expect(structured.details[0]?.method).toBe("Test");
    });

    it("a method literally named 'Test' does not collide with the class-summary accumulator key (34-5-R3 return leg)", async () => {
      // Both an empty-drain class-summary row AND a method-named-"Test" row
      // in the SAME poll — the pre-36.1 truthiness-keyed accumulator would
      // key them identically ("class-summary::Class"), the fix keys them
      // distinctly (presence, not truthiness).
      mockQueueAndPoll([
        { class: "MyApp.Tests.LiteralTest", method: "", status: 1, duration: 3, failures: [] },
        { class: "MyApp.Tests.LiteralTest", status: 1, duration: 9, failures: [] },
      ]);

      const result = await executeTestsTool.handler(
        { target: "MyApp.Tests.LiteralTest", level: "class" },
        ctx,
      );

      const structured = result.structuredContent as { total: number; details: { method: string }[] };
      expect(structured.total).toBe(1);
      expect(structured.details[0]?.method).toBe("Test");
    });

    // ── Ledger 34-5-R4 (AC 36.1.12 (c)): method-name mismatch detection ──

    it("reports methodMismatchWarning when the drained row's restored name does not match the requested method (34-5-R4)", async () => {
      // Caller omits the documented "Test" prefix ("Validate" instead of
      // "TestValidate"); toAtelierMethodFilter leaves it unchanged (it
      // doesn't start with "Test"), so the SAME wire filter a correctly-
      // typed "TestValidate" caller would send is used, and the endpoint
      // returns the REAL method's stripped name ("Validate", i.e.
      // TestValidate restored).
      mockQueueAndPoll([
        { class: "MyApp.Tests.UtilsTest", method: "Validate", status: 1, duration: 5, failures: [] },
      ]);

      const result = await executeTestsTool.handler(
        { target: "MyApp.Tests.UtilsTest:Validate", level: "method" },
        ctx,
      );

      expect(result.isError).toBeUndefined();
      const structured = result.structuredContent as { methodMismatchWarning?: string; details: { method: string }[] };
      expect(structured.details[0]?.method).toBe("TestValidate");
      expect(structured.methodMismatchWarning).toContain("Requested method 'Validate'");
      expect(structured.methodMismatchWarning).toContain("TestValidate");
    });

    it("does not report methodMismatchWarning for a correctly-typed (prefixed) method-level target", async () => {
      mockQueueAndPoll([
        { class: "MyApp.Tests.UtilsTest", method: "Validate", status: 1, duration: 5, failures: [] },
      ]);

      const result = await executeTestsTool.handler(
        { target: "MyApp.Tests.UtilsTest:TestValidate", level: "method" },
        ctx,
      );

      expect(result.structuredContent).not.toHaveProperty("methodMismatchWarning");
    });

    // ── timeout Zod schema ──

    it("schema accepts an optional positive `timeout` and rejects a non-positive value", () => {
      expect(() =>
        executeTestsTool.inputSchema.parse({ target: "X", level: "class", timeout: 5 }),
      ).not.toThrow();
      expect(() =>
        executeTestsTool.inputSchema.parse({ target: "X", level: "class" }),
      ).not.toThrow();
      expect(() =>
        executeTestsTool.inputSchema.parse({ target: "X", level: "class", timeout: 0 }),
      ).toThrow();
      expect(() =>
        executeTestsTool.inputSchema.parse({ target: "X", level: "class", timeout: -5 }),
      ).toThrow();
    });
  });
});
