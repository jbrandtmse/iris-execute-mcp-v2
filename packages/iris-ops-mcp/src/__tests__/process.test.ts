import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { processManageTool } from "../tools/process.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_process_manage ────────────────────────────────────────

const sampleDetail = {
  pid: 1234,
  namespace: "USER",
  routine: "MyApp.Main",
  state: "RUNW",
  userName: "_SYSTEM",
  clientIPAddress: "127.0.0.1",
  device: "|TCP|51773",
  jobType: 0,
  commandsExecuted: 5000,
  globalReferences: 12000,
  inTransaction: 0,
  cpuTime: 42,
  memoryUsedKB: 2048,
  priority: 8,
  roles: "%All",
  canBeTerminated: 1,
  canBeSuspended: 1,
  canBeExamined: 1,
  isCurrentProcess: 0,
};

describe("iris_process_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NONE", () => {
    expect(processManageTool.scope).toBe("NONE");
  });

  it("should classify every action in mutates (get read; control writes)", () => {
    expect(processManageTool.mutates).toEqual({
      get: "read",
      terminate: "write",
      suspend: "write",
      resume: "write",
    });
  });

  it("should carry destructiveHint at the tool scope", () => {
    expect(processManageTool.annotations.destructiveHint).toBe(true);
  });

  // ── namespace param: accepted-but-ignored (Story 18.0, CR 16.1-1) ──

  it("namespace description states the value has NO EFFECT (%SYS-scoped)", () => {
    const shape = (
      processManageTool.inputSchema as unknown as {
        shape: { namespace: { description?: string } };
      }
    ).shape;
    const desc = shape.namespace.description ?? "";
    expect(desc).toContain("NO EFFECT");
    expect(desc).toContain("%SYS-scoped");
  });

  it("namespace param is still accepted and forwarded without error (back-compat)", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleDetail));

    const result = await processManageTool.handler(
      { action: "get", pid: 1234, namespace: "%SYS" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=%25SYS"),
    );
  });

  it("an empty-string namespace is accepted and dropped from the query path (accepted-but-ignored)", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleDetail));

    const result = await processManageTool.handler(
      { action: "get", pid: 1234, namespace: "" },
      ctx,
    );

    // Empty string is treated as "not supplied" — accepted without error and
    // never appended to the wire (the param has no effect either way).
    expect(result.isError).toBeUndefined();
    const calledPath = String(mockHttp.get.mock.calls[0]?.[0] ?? "");
    expect(calledPath).not.toContain("namespace=");
  });

  it("an empty-string namespace is accepted and dropped from the control POST body (accepted-but-ignored)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "suspend", pid: 1234, refused: 0, success: 1 }),
    );

    const result = await processManageTool.handler(
      { action: "suspend", pid: 1234, namespace: "" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const body = mockHttp.post.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("namespace");
  });

  // ── get (read) ──

  it("get should call GET /monitor/process?pid= and return detail", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleDetail));

    const result = await processManageTool.handler(
      { action: "get", pid: 1234 },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/monitor/process?pid=1234"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(sampleDetail);
  });

  it("get should format process detail for display", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleDetail));

    const result = await processManageTool.handler(
      { action: "get", pid: 1234 },
      ctx,
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Process 1234:");
    expect(text).toContain("Namespace: USER");
    expect(text).toContain("Routine: MyApp.Main");
    expect(text).toContain("State: RUNW");
    expect(text).toContain("Can be terminated: yes");
    expect(text).toContain("Can be suspended: yes");
  });

  it("get should warn when target is the calling process", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ ...sampleDetail, isCurrentProcess: 1 }),
    );

    const result = await processManageTool.handler(
      { action: "get", pid: 1234 },
      ctx,
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("calling process");
  });

  it("get should forward an optional namespace query param", async () => {
    mockHttp.get.mockResolvedValue(envelope(sampleDetail));

    await processManageTool.handler(
      { action: "get", pid: 1234, namespace: "%SYS" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("namespace=%25SYS"),
    );
  });

  // ── control actions (write) — POST body ──

  it.each([
    ["terminate"],
    ["suspend"],
    ["resume"],
  ])("%s should POST /monitor/process/manage with {action, pid}", async (
    action,
  ) => {
    mockHttp.post.mockResolvedValue(
      envelope({ action, pid: 1234, refused: 0, success: 1 }),
    );

    const result = await processManageTool.handler(
      { action, pid: 1234 },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/executemcp/v2/monitor/process/manage"),
      { action, pid: "1234" },
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain(`Action '${action}' on process 1234: success`);
  });

  it("should surface a server refusal (self/critical-process guard)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "terminate",
        pid: 999,
        refused: 1,
        reason:
          "Refused: cannot terminate the calling process (PID 999 = $JOB).",
      }),
    );

    const result = await processManageTool.handler(
      { action: "terminate", pid: 999 },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("REFUSED");
    expect(text).toContain("calling process");
  });

  it("should coerce a numeric pid to a string in the POST body", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ action: "resume", pid: 1234, refused: 0, success: 1 }),
    );

    await processManageTool.handler({ action: "resume", pid: 1234 }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ pid: "1234" }),
    );
  });

  it("should return isError on IrisApiError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "Server error" }],
        "/api/executemcp/v2/monitor/process",
        "Server error",
      ),
    );

    const result = await processManageTool.handler(
      { action: "get", pid: 1234 },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error performing 'get' on process 1234",
    );
  });

  it("should propagate non-IrisApiError exceptions", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      processManageTool.handler({ action: "get", pid: 1234 }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });
});

// ── E2E coverage (Story 16.1 QA stage) ─────────────────────────
//
// Additive end-to-end coverage of user-observable behaviors that the
// dev unit tests above leave partially exercised. All still mock the
// REST layer (no live IRIS — live verification is the lead's smoke).
// Closes the prompt checklist gaps:
//   (a) `get` detail flag surfacing for the "no" / in-transaction case
//   (c) self AND critical-process refusal for terminate AND suspend,
//       asserted as refused:true + reason and NOT a crash (isError unset)
//   (e) control-action server error path (bad/nonexistent PID envelope)

describe("iris_process_manage — e2e behaviors", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  // ── (a) get detail: flags + transaction marker ──

  it("get should surface the canBeTerminated/canBeSuspended/isCurrentProcess flags in structuredContent", async () => {
    const guarded = {
      ...sampleDetail,
      pid: 3736,
      routine: "%SYS.Daemon",
      canBeTerminated: 0,
      canBeSuspended: 0,
      isCurrentProcess: 0,
    };
    mockHttp.get.mockResolvedValue(envelope(guarded));

    const result = await processManageTool.handler(
      { action: "get", pid: 3736 },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as typeof guarded;
    expect(sc.canBeTerminated).toBe(0);
    expect(sc.canBeSuspended).toBe(0);
    expect(sc.isCurrentProcess).toBe(0);
  });

  it("get should render 'no' for a process that cannot be terminated or suspended", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ ...sampleDetail, canBeTerminated: 0, canBeSuspended: 0 }),
    );

    const result = await processManageTool.handler(
      { action: "get", pid: 1234 },
      ctx,
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Can be terminated: no");
    expect(text).toContain("Can be suspended: no");
  });

  it("get should mark a process that is in a transaction", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ ...sampleDetail, inTransaction: 1 }),
    );

    const result = await processManageTool.handler(
      { action: "get", pid: 1234 },
      ctx,
    );

    const text = result.content[0]?.text ?? "";
    expect(text).toContain("In Transaction");
  });

  // ── (c) refusal surfaced for the critical-process guard ──

  it("terminate of a critical process (CanBeTerminated=0) is REFUSED, not crashed", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "terminate",
        pid: 3736,
        refused: 1,
        reason:
          "Refused: process 3736 is a protected system job (CanBeTerminated=0).",
      }),
    );

    const result = await processManageTool.handler(
      { action: "terminate", pid: 3736 },
      ctx,
    );

    // Refusal is a normal 200 outcome — not an error/crash.
    expect(result.isError).toBeUndefined();
    const sc = result.structuredContent as { refused: number; reason?: string };
    expect(sc.refused).toBe(1);
    expect(sc.reason).toContain("protected system job");
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("REFUSED");
    expect(text).toContain("protected system job");
  });

  it("suspend of a protected process (CanBeSuspended=0) is REFUSED with a reason", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "suspend",
        pid: 3736,
        refused: 1,
        reason:
          "Refused: process 3736 cannot be suspended (CanBeSuspended=0).",
      }),
    );

    const result = await processManageTool.handler(
      { action: "suspend", pid: 3736 },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Action 'suspend' on process 3736: REFUSED");
    expect(text).toContain("cannot be suspended");
  });

  it("suspend of the calling process ($JOB) is REFUSED (self-guard, any action)", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        action: "suspend",
        pid: 777,
        refused: 1,
        reason: "Refused: cannot suspend the calling process (PID 777 = $JOB).",
      }),
    );

    const result = await processManageTool.handler(
      { action: "suspend", pid: 777 },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("REFUSED");
    expect(text).toContain("calling process");
  });

  // ── (e) control-action server error path (bad / nonexistent PID) ──

  it("terminate of a nonexistent PID surfaces the server error envelope as isError", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "ERROR #5001: Process 99999 does not exist" }],
        "/api/executemcp/v2/monitor/process/manage",
        "ERROR #5001: Process 99999 does not exist",
      ),
    );

    const result = await processManageTool.handler(
      { action: "terminate", pid: 99999 },
      ctx,
    );

    expect(result.isError).toBe(true);
    const text = result.content[0]?.text ?? "";
    expect(text).toContain("Error performing 'terminate' on process 99999");
    expect(text).toContain("does not exist");
  });

  it("get of a nonexistent PID surfaces the server error envelope as isError", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(
        500,
        [{ error: "ERROR #5001: Process 99999 does not exist" }],
        "/api/executemcp/v2/monitor/process",
        "ERROR #5001: Process 99999 does not exist",
      ),
    );

    const result = await processManageTool.handler(
      { action: "get", pid: 99999 },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain(
      "Error performing 'get' on process 99999",
    );
  });

  it("a string pid is coerced into the GET query path", async () => {
    mockHttp.get.mockResolvedValue(envelope({ ...sampleDetail, pid: 4242 }));

    await processManageTool.handler({ action: "get", pid: "4242" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("pid=4242"),
    );
  });
});
