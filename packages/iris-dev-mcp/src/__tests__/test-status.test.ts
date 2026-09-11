/**
 * Story 36.2 — `iris_test_status` unit tests (AC 36.2.2 cases (i)-(vi), AC
 * 36.2.3 cancel outcomes).
 *
 * Fakes are pinned to REAL shapes captured live against the default HSCUSTOM
 * instance (Rule #54) — the `/global` `{value, defined}` envelope, the Atelier
 * `retryafter` header surfaced as `envelope.retryafter`, a `GET /work/{id}`
 * 404 (`IrisApiError` statusCode 404), all-digits Atelier job ids
 * (`%Api.Atelier.v8` `PollAsync`/`CancelAsync` take `pID As %Integer`), and
 * the SQL rows `%UnitTest_Result.TestMethod`/`TestAssert`/`TestCase` actually
 * return. Value-identity oracles (Rule #36) are the DRAIN-path rows
 * `iris_execute_tests` returned for the SAME run:
 *  - run 62 (Task 1 probe): one assert failure, one pass;
 *  - run 87 (Story 36.2 QA live capture): SQL seconds 0.00006/0.000053/
 *    0.000086/8.007687 vs drain milliseconds 0.06/0.053/0.086 — values a
 *    plain IEEE `* 1000` gets wrong (0.060000000000000005, 8007.687000000001);
 *  - run 94 (Story 36.2 code-review live capture): a pass, an assert failure,
 *    a THROWN exception (method-level `ErrorAction`/`ErrorDescription`) and an
 *    `AssertStatusOK` failure — drain messages captured verbatim.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolContext, IrisHttpClient } from "@iris-mcp/shared";
import { IrisApiError, IrisConnectionError } from "@iris-mcp/shared";
import { testStatusTool } from "../tools/test-status.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── Harness ─────────────────────────────────────────────────────

interface Harness {
  ctx: ToolContext;
  globalGet: ReturnType<typeof vi.fn>;
  workGet: ReturnType<typeof vi.fn>;
  sqlPost: ReturnType<typeof vi.fn>;
  workDelete: ReturnType<typeof vi.fn>;
  /** Set once the job's queue subtree is killed — by a TERMINAL `GET /work`
   * (no `retryafter`, probe (b)) or a successful `DELETE` (`CancelAsync`). */
  state: { consumed: boolean };
}

/**
 * Route `ctx.http`'s calls the way `test-status.ts` actually issues them:
 * `GET /global?...` (queue-node reads) vs `GET /work/{id}` (Atelier poll)
 * both go through `ctx.http.get`, so they are split by path prefix — the
 * SAME technique `execute.test.ts`'s `installPathAwareGet` uses. `POST` is
 * always `action/query` SQL (this tool never queues work); `DELETE` is
 * always the Atelier work-queue cancel. Like the real `PollAsync`/
 * `CancelAsync`, a terminal poll or a successful DELETE kills the queue node
 * (Rule #54 — a fake that kept it would hide read-after-GET ordering bugs).
 */
function makeHarness(atelierVersion = 8): Harness {
  const mockHttp = createMockHttp();
  const state = { consumed: false };
  const globalGet = vi.fn(async (_path?: string, _options?: unknown) => envelope({ value: "", defined: false }));
  const workGet = vi.fn(async (_path?: string, _options?: unknown) => envelope([]));
  const sqlPost = vi.fn(async (_path?: string, _body?: unknown, _options?: unknown) => envelope({ content: [] }));
  const workDelete = vi.fn(async (_path?: string, _options?: unknown) => envelope({}));
  const routedHttp = {
    ...mockHttp,
    get: async (path: string, options?: unknown) => {
      if (path.startsWith("/api/executemcp/v2/global?")) return globalGet(path, options);
      const resp = await workGet(path, options);
      if (!(resp as { retryafter?: unknown })?.retryafter) state.consumed = true;
      return resp;
    },
    post: (path: string, body?: unknown, options?: unknown) => sqlPost(path, body, options),
    delete: async (path: string, options?: unknown) => {
      const resp = await workDelete(path, options);
      state.consumed = true;
      return resp;
    },
  };
  const ctx = createMockCtx(routedHttp as unknown as IrisHttpClient, atelierVersion);
  return { ctx, globalGet, workGet, sqlPost, workDelete, state };
}

function subscriptsOf(path: string): string {
  return new URLSearchParams(path.split("?")[1] ?? "").get("subscripts") ?? "";
}

/**
 * Configure `globalGet` as a live job's queue node: `(jobId,"unittest","id")`
 * answers `runIndex`, `(jobId,"requesttype")` answers `requestType`
 * (`"unittest"` by default) — until the harness records the subtree as
 * consumed (terminal GET or successful DELETE), after which every node reads
 * undefined (exactly what `PollAsync`/`CancelAsync`'s `Kill` leaves).
 */
function stubQueueNode(
  h: Harness,
  jobId: string,
  runIndex: number | undefined,
  opts: { requestType?: string } = {},
) {
  h.globalGet.mockImplementation(async (path: string) => {
    const subs = subscriptsOf(path);
    if (!h.state.consumed && subs === `${jobId},"unittest","id"` && runIndex !== undefined) {
      return envelope({ value: String(runIndex), defined: true });
    }
    if (!h.state.consumed && subs === `${jobId},"requesttype"`) {
      return envelope({ value: opts.requestType ?? "unittest", defined: true });
    }
    return envelope({ value: "", defined: false });
  });
}

/** One `%UnitTest_Result.TestInstance` SQL row, real shape (Task 1 probe). */
function testInstanceRow(finishedAt: string) {
  return envelope({ content: [{ FinishedAt: finishedAt }] });
}

/** Run 62 (Task 1 probe): one fail, one pass. Duration is SECONDS. */
const METHOD_ROWS_FIXTURE = [
  {
    ClassName: "ExecuteMCPv2.Temp.Story362Probe",
    MethodName: "TestFail",
    Status: 0,
    Duration: 0.000094,
    ErrorAction: "",
    ErrorDescription: "There are failed TestAsserts",
  },
  {
    ClassName: "ExecuteMCPv2.Temp.Story362Probe",
    MethodName: "TestPass",
    Status: 1,
    Duration: 0.000054,
    ErrorAction: "",
    ErrorDescription: "",
  },
];
const ASSERT_ROWS_FIXTURE = [
  {
    ClassName: "ExecuteMCPv2.Temp.Story362Probe",
    MethodName: "TestFail",
    Action: "AssertTrue",
    Description: "deliberate failure message for probe",
  },
];

/**
 * Route `sqlPost` to answer the TestInstance-status query, the TestAssert
 * join, the TestCase class-level-error query, and the TestMethod join
 * distinctly, by clause sniffing (the queries `test-status.ts` issues).
 */
function stubSql(
  h: Harness,
  opts: {
    finishedAt?: string;
    methodRows?: unknown[];
    assertRows?: unknown[];
    classErrorRows?: unknown[];
    failWith?: Error;
  } = {},
) {
  h.sqlPost.mockImplementation(async (_path: string, body: unknown) => {
    if (opts.failWith) throw opts.failWith;
    const query = (body as { query: string }).query;
    if (query.includes("FROM %UnitTest_Result.TestInstance WHERE InstanceIndex")) {
      return opts.finishedAt === undefined ? envelope({ content: [] }) : testInstanceRow(opts.finishedAt);
    }
    if (query.includes("TestAssert")) return envelope({ content: opts.assertRows ?? [] });
    if (query.includes("FROM %UnitTest_Result.TestCase tc")) return envelope({ content: opts.classErrorRows ?? [] });
    return envelope({ content: opts.methodRows ?? [] });
  });
}

function expectNoIrisTraffic(h: Harness) {
  expect(h.globalGet).not.toHaveBeenCalled();
  expect(h.workGet).not.toHaveBeenCalled();
  expect(h.workDelete).not.toHaveBeenCalled();
  expect(h.sqlPost).not.toHaveBeenCalled();
}

// ── Governance/registration shape ────────────────────────────────

describe("iris_test_status — registration shape", () => {
  it("declares mutates per-action (poll: read, cancel: write) and truthful mixed annotations", () => {
    expect(testStatusTool.mutates).toEqual({ poll: "read", cancel: "write" });
    expect(testStatusTool.defaultEnabled).toBeUndefined();
    expect(testStatusTool.annotations.readOnlyHint).toBe(false);
    expect(testStatusTool.annotations.destructiveHint).toBe(true);
    expect(testStatusTool.scope).toBe("NS");
  });

  it("requires action, jobId, or runIndex to all be optional except action itself", () => {
    const shape = testStatusTool.inputSchema.shape;
    expect(shape.action).toBeDefined();
    expect(shape.jobId.isOptional()).toBe(true);
    expect(shape.runIndex.isOptional()).toBe(true);
    expect(shape.namespace.isOptional()).toBe(true);
  });

  it("the input schema accepts only an all-digits jobId (Atelier pID is %Integer)", () => {
    expect(testStatusTool.inputSchema.safeParse({ action: "poll", jobId: "31797604" }).success).toBe(true);
    for (const bad of ["../doc/MyApp.Foo.cls", "..", "5?x=1", "12#3", "job-1", " 12", "1,2"]) {
      expect(testStatusTool.inputSchema.safeParse({ action: "cancel", jobId: bad }).success, bad).toBe(false);
    }
  });
});

// ── jobId validation + foreign-job refusal (both actions) ────────

describe("iris_test_status — jobId is validated BEFORE any IRIS call", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("cancel with a path-traversal jobId is refused with NO HTTP call (never reaches DELETE)", async () => {
    const result = await testStatusTool.handler({ action: "cancel", jobId: "../doc/MyApp.Foo.cls" }, h.ctx);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: string }).error).toContain("not an Atelier work-queue id");
    expectNoIrisTraffic(h);
  });

  it("poll with a non-digit jobId is refused with NO HTTP call (never reaches the /global subscripts)", async () => {
    const result = await testStatusTool.handler({ action: "poll", jobId: 'x"_$Increment(^X)_"x' }, h.ctx);
    expect(result.isError).toBe(true);
    expectNoIrisTraffic(h);
  });

  it("a jobId whose live queue node is NOT a unit-test job is refused by poll (no GET /work) and cancel (no DELETE)", async () => {
    stubQueueNode(h, "4211", undefined, { requestType: "compile" });
    const polled = await testStatusTool.handler({ action: "poll", jobId: "4211" }, h.ctx);
    expect(polled.isError).toBe(true);
    expect((polled.structuredContent as { error: string }).error).toContain("'compile'");
    expect(h.workGet).not.toHaveBeenCalled();

    const cancelled = await testStatusTool.handler({ action: "cancel", jobId: "4211" }, h.ctx);
    expect(cancelled.isError).toBe(true);
    expect(h.workDelete).not.toHaveBeenCalled();
  });
});

// ── `poll` — AC 36.2.2 ────────────────────────────────────────────

describe("iris_test_status:poll", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("(vi) neither jobId nor runIndex ⇒ a validation error, no HTTP calls", async () => {
    const result = await testStatusTool.handler({ action: "poll" }, h.ctx);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: string }).error).toContain("requires at least one of");
    expectNoIrisTraffic(h);
  });

  it("(i) jobId still running (Retry-After present) ⇒ status:'running' via testRunEnvelope, EVERY queue-node read strictly BEFORE the GET, partial is this call's DELTA drain only", async () => {
    stubQueueNode(h, "31797604", 61);
    h.workGet.mockResolvedValueOnce({
      status: { errors: [] },
      console: [],
      result: [{ class: "MyApp.Tests.Slow", method: "Slow", status: 1, duration: 5000, failures: [] }],
      retryafter: "3",
    });

    const result = await testStatusTool.handler({ action: "poll", jobId: "31797604" }, h.ctx);

    expect(result.isError).toBe(false);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBe("running");
    expect(structured.jobId).toBe("31797604");
    expect(structured.runIndex).toBe(61);
    expect(structured.runIndexSource).toBe("queue");
    expect(structured.namespace).toBe("USER");
    expect(structured.partial).toEqual({
      total: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      details: [{ class: "MyApp.Tests.Slow", method: "TestSlow", status: "passed", duration: 5000, message: "" }],
    });
    // The hint names the companion WITH the run's namespace (it must match).
    expect(structured.hint as string).toContain('iris_test_status with action "poll" and jobId "31797604"');
    expect(structured.hint as string).toContain('namespace "USER"');
    // Ordering (probe (b)): the terminal GET kills the node, so every
    // queue-node read must precede the (potentially terminal) GET.
    expect(h.globalGet).toHaveBeenCalledTimes(2);
    const lastGlobalRead = Math.max(...h.globalGet.mock.invocationCallOrder);
    expect(lastGlobalRead).toBeLessThan(h.workGet.mock.invocationCallOrder[0]!);
    // Never a completed result from this branch.
    expect(structured.total).toBeUndefined();
  });

  it("(ii) jobId finished-but-undrained ⇒ completed built from %UnitTest_Result by EXACT InstanceIndex (runIndexSource:'result-table'), NOT from the drained rows alone", async () => {
    stubQueueNode(h, "31797605", 62);
    // The drain this poll happens to see carries only ONE stale/partial row --
    // if the completed envelope were built from this alone it would silently
    // under-report (exactly the bug AC 36.2.2(ii) forbids).
    h.workGet.mockResolvedValueOnce({
      status: { errors: [] },
      console: [],
      result: [{ class: "X", method: "Stale", status: 1, duration: 1, failures: [] }],
    });
    stubSql(h, { finishedAt: "2026-09-11 05:13:42", methodRows: METHOD_ROWS_FIXTURE, assertRows: ASSERT_ROWS_FIXTURE });

    const result = await testStatusTool.handler({ action: "poll", jobId: "31797605" }, h.ctx);

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBe("completed");
    expect(structured.runIndexSource).toBe("result-table");
    expect(structured.runIndex).toBe(62);
    expect(structured.total).toBe(2);
    expect(structured.passed).toBe(1);
    expect(structured.failed).toBe(1);
    // Exactly the drain-path rows for run 62 (Task 1 capture) — EXACT values.
    expect(structured.details).toEqual([
      {
        class: "ExecuteMCPv2.Temp.Story362Probe",
        method: "TestFail",
        status: "failed",
        duration: 0.094,
        message: "AssertTrue: deliberate failure message for probe",
      },
      { class: "ExecuteMCPv2.Temp.Story362Probe", method: "TestPass", status: "passed", duration: 0.054, message: "" },
    ]);
  });

  it("(ii) terminal poll but the TestInstance is UNFINISHED ⇒ never 'completed' (interim Status-1 rows are not passes) — reported abandoned", async () => {
    stubQueueNode(h, "31797606", 63);
    h.workGet.mockResolvedValueOnce({ status: { errors: [] }, console: [], result: [] });
    stubSql(h, {
      finishedAt: "",
      methodRows: [{ ClassName: "C", MethodName: "TestSlow", Status: 1, Duration: 0, ErrorAction: "", ErrorDescription: "" }],
    });

    const result = await testStatusTool.handler({ action: "poll", jobId: "31797606" }, h.ctx);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBe("abandoned");
    expect(structured.runIndex).toBe(63);
    expect(structured.total).toBeUndefined();
  });

  it("(ii) terminal poll but NO TestInstance row at the index ⇒ an error, never a green 'completed' with total 0", async () => {
    stubQueueNode(h, "31797607", 64);
    h.workGet.mockResolvedValueOnce({ status: { errors: [] }, console: [], result: [] });
    stubSql(h, {}); // TestInstance query returns no row

    const result = await testStatusTool.handler({ action: "poll", jobId: "31797607" }, h.ctx);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: string }).error).toContain("No test run recorded at InstanceIndex 64");
  });

  it("(ii) no run index obtainable ⇒ the drained rows under 'partial' with the incompleteness explanation — NEVER top-level counts (L1 (2))", async () => {
    // Queue node never observed (e.g. /global unavailable) and no explicit runIndex.
    h.workGet.mockResolvedValueOnce({
      status: { errors: [] },
      console: [],
      result: [{ class: "X", method: "Only", status: 1, duration: 5, failures: [] }],
    });

    const result = await testStatusTool.handler({ action: "poll", jobId: "31797608" }, h.ctx);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBeUndefined();
    expect(structured.total).toBe(0);
    expect(structured.passed).toBe(0);
    expect((structured.partial as { total: number }).total).toBe(1);
    expect(structured.error as string).toContain("delta");
    expect(structured.error as string).toContain("NOT a final result");
    expect(structured.jobId).toBe("31797608");
    expect(h.sqlPost).not.toHaveBeenCalled();
  });

  it("zero-result guard parity: a FINISHED run with no method rows (OnBeforeAllTests failure, Task 1 probe) ⇒ isError:true with the drain's class-level reason, never a green total:0", async () => {
    stubSql(h, {
      finishedAt: "2026-09-11 05:20:01",
      methodRows: [],
      classErrorRows: [
        {
          ClassName: "ExecuteMCPv2.Temp.Story362BadSetup",
          ErrorAction: "OnBeforeAllTests",
          ErrorDescription: " ERROR #5001: deliberate setup failure for probe",
        },
      ],
    });

    const result = await testStatusTool.handler({ action: "poll", runIndex: 71 }, h.ctx);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.total).toBe(0);
    expect(structured.status).toBeUndefined();
    // The drain path's class row reads exactly this (Task 1 probe (5)).
    expect(structured.error as string).toContain(
      "ExecuteMCPv2.Temp.Story362BadSetup: OnBeforeAllTests: ERROR #5001: deliberate setup failure for probe",
    );
    expect(structured.runIndex).toBe(71);
  });

  it("value identity with the DRAIN path, run 94 (code-review live capture): thrown-exception + assert-failure messages, exact durations, drain order", async () => {
    const C = "ExecuteMCPv2.Temp.CR362MsgProbe";
    stubSql(h, {
      finishedAt: "2026-09-11 06:51:12",
      methodRows: [
        { ClassName: C, MethodName: "TestAPass", Status: 1, Duration: 0.000116, ErrorAction: "", ErrorDescription: "" },
        {
          ClassName: C,
          MethodName: "TestBAssertFail",
          Status: 0,
          Duration: 0.000067,
          ErrorAction: "",
          ErrorDescription: "There are failed TestAsserts",
        },
        {
          ClassName: C,
          MethodName: "TestCThrows",
          Status: 0,
          Duration: 0.000054,
          ErrorAction: "TestCThrows",
          ErrorDescription: " ERROR #5035: General exception Name 'CR362Deliberate' Code '5001' Data 'deliberate throw'",
        },
        {
          ClassName: C,
          MethodName: "TestDStatusErr",
          Status: 0,
          Duration: 0.000149,
          ErrorAction: "",
          ErrorDescription: "There are failed TestAsserts",
        },
      ],
      assertRows: [
        { ClassName: C, MethodName: "TestBAssertFail", Action: "AssertTrue", Description: "deliberate assert failure" },
        {
          ClassName: C,
          MethodName: "TestDStatusErr",
          Action: "AssertStatusOK",
          Description: "status check => ERROR #5001: deliberate status",
        },
      ],
    });

    const result = await testStatusTool.handler({ action: "poll", runIndex: 94 }, h.ctx);
    // Verbatim the `details` iris_execute_tests (drain path) returned for run 94.
    expect((result.structuredContent as { details: unknown }).details).toEqual([
      { class: C, method: "TestAPass", status: "passed", duration: 0.116, message: "" },
      { class: C, method: "TestBAssertFail", status: "failed", duration: 0.067, message: "AssertTrue: deliberate assert failure" },
      {
        class: C,
        method: "TestCThrows",
        status: "failed",
        duration: 0.054,
        message: "ERROR #5035: General exception Name 'CR362Deliberate' Code '5001' Data 'deliberate throw'",
      },
      {
        class: C,
        method: "TestDStatusErr",
        status: "failed",
        duration: 0.149,
        message: "AssertStatusOK: status check => ERROR #5001: deliberate status",
      },
    ]);
    // The method query carries the drain's $ORDER traversal order.
    const methodQuery = h.sqlPost.mock.calls
      .map((c) => (c[1] as { query: string }).query)
      .find((q) => q.includes("tm.ErrorDescription"));
    expect(methodQuery).toContain("ORDER BY %EXACT(tc.Name), %EXACT(tm.Name)");
  });

  it("duration normalization is EXACT (run 87 QA capture): SQL seconds -> the drain's milliseconds, including values IEEE `* 1000` gets wrong", async () => {
    const C = "ExecuteMCPv2.Temp.Story362QADeltaDrain";
    const row = (MethodName: string, Status: number, Duration: number) => ({
      ClassName: C,
      MethodName,
      Status,
      Duration,
      ErrorAction: "",
      ErrorDescription: Status === 0 ? "There are failed TestAsserts" : "",
    });
    stubSql(h, {
      finishedAt: "2026-09-11 05:40:10",
      methodRows: [
        row("Test001FastPass", 1, 0.00006),
        row("Test002FastPass", 1, 0.000053),
        row("Test003FastFail", 0, 0.000086),
        row("Test999SlowHang", 1, 8.007687),
      ],
    });

    const result = await testStatusTool.handler({ action: "poll", runIndex: 87 }, h.ctx);
    const durations = (result.structuredContent as { details: { duration: number }[] }).details.map((d) => d.duration);
    // Drain-path values for the same run: 0.06 / 0.053 / 0.086 (captured), and
    // 8007.687 — the drain's exact-decimal `Duration * 1000`.
    expect(durations).toEqual([0.06, 0.053, 0.086, 8007.687]);
  });

  it("(iii) jobId unknown/already-consumed (Atelier 404) with an explicit runIndex ⇒ falls back to the SQL path", async () => {
    h.workGet.mockRejectedValueOnce(
      new IrisApiError(404, [], "/api/atelier/v8/USER/work/31797609", "IRIS returned HTTP 404"),
    );
    stubSql(h, { finishedAt: "2026-09-11 05:13:42", methodRows: METHOD_ROWS_FIXTURE, assertRows: ASSERT_ROWS_FIXTURE });

    const result = await testStatusTool.handler({ action: "poll", jobId: "31797609", runIndex: 62 }, h.ctx);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBe("completed");
    expect(structured.runIndexSource).toBe("result-table");
    expect(structured.jobId).toBe("31797609");
    expect(structured.total).toBe(2);
  });

  it("(iii) jobId unknown/already-consumed with NO runIndex available ⇒ a clear not-found result naming the fallback", async () => {
    h.workGet.mockRejectedValueOnce(
      new IrisApiError(404, [], "/api/atelier/v8/USER/work/31797610", "IRIS returned HTTP 404"),
    );

    const result = await testStatusTool.handler({ action: "poll", jobId: "31797610" }, h.ctx);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as { error: string; jobId: string };
    expect(structured.error).toContain("31797610");
    expect(structured.error.toLowerCase()).toContain("runindex");
    expect(structured.jobId).toBe("31797610");
  });

  it("(iv) runIndex alone, FINISHED ⇒ completed via the SQL path (TestInstance.DateTime non-empty)", async () => {
    stubSql(h, { finishedAt: "2026-09-11 05:13:42", methodRows: METHOD_ROWS_FIXTURE, assertRows: ASSERT_ROWS_FIXTURE });

    const result = await testStatusTool.handler({ action: "poll", runIndex: 62 }, h.ctx);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBe("completed");
    expect(structured.runIndexSource).toBe("result-table");
    expect(structured.jobId).toBeUndefined();
    expect(h.workGet).not.toHaveBeenCalled();
  });

  it("(iv) runIndex alone, UNFINISHED ⇒ status:'unfinished' with interim rows under partial ONLY, never reported as passes", async () => {
    stubSql(h, {
      finishedAt: "",
      methodRows: [
        { ClassName: "ExecuteMCPv2.QAFixtures.LongRunningTest", MethodName: "TestSlowMethod", Status: 1, Duration: 0 },
      ],
    });

    const result = await testStatusTool.handler({ action: "poll", runIndex: 65 }, h.ctx);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBe("unfinished");
    expect(structured.runIndex).toBe(65);
    expect(structured.runIndexSource).toBe("result-table");
    expect(structured.note as string).toContain("may still be running");
    const partial = structured.partial as { total: number; passed: number; details: { status: string }[] };
    // The interim Status-1/Duration-0 row is NEVER counted as a pass.
    expect(partial.passed).toBe(0);
    expect(partial.total).toBe(0);
    expect(partial.details[0]?.status).toBe("in-progress");
  });

  it("(v) jobId whose queue node is gone AND whose run is unfinished ⇒ status:'abandoned'", async () => {
    h.workGet.mockRejectedValueOnce(
      new IrisApiError(404, [], "/api/atelier/v8/USER/work/31797611", "IRIS returned HTTP 404"),
    );
    stubSql(h, { finishedAt: "" });

    const result = await testStatusTool.handler({ action: "poll", jobId: "31797611", runIndex: 65 }, h.ctx);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBe("abandoned");
    expect(structured.jobId).toBe("31797611");
    expect(structured.runIndex).toBe(65);
    expect(structured.note as string).toContain("any longer");
  });

  it("a transport error while polling an existing job (non-404) reports the handles + re-attach hint instead of throwing", async () => {
    stubQueueNode(h, "31797612", 70);
    h.workGet.mockRejectedValueOnce(
      new IrisConnectionError("TIMEOUT", "Connection to IRIS timed out after 60000ms", "Check IRIS is running"),
    );

    const result = await testStatusTool.handler({ action: "poll", jobId: "31797612" }, h.ctx);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as { jobId: string; runIndex: number; hint: string };
    expect(structured.jobId).toBe("31797612");
    expect(structured.runIndex).toBe(70);
    expect(structured.hint).toContain("may still be executing");
    expect(structured.hint).toContain('namespace "USER"');
  });

  it("an SQL failure AFTER the terminal GET consumed the job keeps runIndex + the drained rows and says the job finished (never 'may still be executing')", async () => {
    stubQueueNode(h, "31797613", 72);
    h.workGet.mockResolvedValueOnce({
      status: { errors: [] },
      console: [],
      result: [{ class: "X", method: "Tail", status: 1, duration: 3, failures: [] }],
    });
    // A 404 from the SQL route must NOT be mistaken for the jobId's own 404.
    stubSql(h, { failWith: new IrisApiError(404, [], "/api/atelier/v8/USER/action/query", "IRIS returned HTTP 404") });

    const result = await testStatusTool.handler({ action: "poll", jobId: "31797613" }, h.ctx);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.error as string).toContain("finished");
    expect(structured.error as string).toContain("runIndex 72");
    expect(structured.hint).toBeUndefined();
    expect(structured.runIndex).toBe(72);
    expect((structured.partial as { total: number }).total).toBe(1);
  });
});

// ── `cancel` — AC 36.2.3 ──────────────────────────────────────────

describe("iris_test_status:cancel", () => {
  let h: Harness;
  beforeEach(() => {
    h = makeHarness();
  });

  it("requires jobId -- runIndex alone cannot cancel", async () => {
    const result = await testStatusTool.handler({ action: "cancel", runIndex: 5 }, h.ctx);
    expect(result.isError).toBe(true);
    expect((result.structuredContent as { error: string }).error).toContain("requires 'jobId'");
    expect(h.workDelete).not.toHaveBeenCalled();
  });

  it("cancelling a RUNNING job: reads the run index BEFORE the DELETE, then reports the OBSERVED (never assumed) outcome", async () => {
    stubQueueNode(h, "31797620", 61);
    stubSql(h, { finishedAt: "" }); // %UnitTest_Result not finalized -- observed post-DELETE.

    const result = await testStatusTool.handler({ action: "cancel", jobId: "31797620" }, h.ctx);

    expect(h.workDelete).toHaveBeenCalledTimes(1);
    const deleteCallOrder = h.workDelete.mock.invocationCallOrder[0]!;
    const runIndexRead = h.globalGet.mock.calls.findIndex(
      (c) => subscriptsOf(c[0] as string) === '31797620,"unittest","id"',
    );
    expect(h.globalGet.mock.invocationCallOrder[runIndexRead]!).toBeLessThan(deleteCallOrder);

    const structured = result.structuredContent as { status: string; jobId: string; runIndex: number; observed: { queueNode: string; resultRow: string } };
    expect(structured.status).toBe("cancelled");
    expect(structured.jobId).toBe("31797620");
    expect(structured.runIndex).toBe(61);
    // The queue node is RE-READ after the DELETE (observed, not hard-coded).
    const queueReReads = h.globalGet.mock.invocationCallOrder.filter((o) => o > deleteCallOrder);
    expect(queueReReads.length).toBeGreaterThan(0);
    expect(structured.observed.queueNode).toBe("gone");
    expect(structured.observed.resultRow).toMatch(/^unfinished — TestInstance 61 has no finish time/);
    // The first line reports the observation — it never asserts "stopped".
    const text = (result.content[0] as { text: string }).text.split("\n")[0]!;
    expect(text).not.toContain("stopped.");
    expect(text).toContain("CANCEL ACCEPTED");
  });

  it("a cancelled job whose TestInstance row is ABSENT is reported absent, not 'unfinished'", async () => {
    stubQueueNode(h, "31797621", 66);
    stubSql(h, {}); // no TestInstance row

    const result = await testStatusTool.handler({ action: "cancel", jobId: "31797621" }, h.ctx);
    const observed = (result.structuredContent as { observed: { resultRow: string } }).observed;
    expect(observed.resultRow).toMatch(/^absent — /);
  });

  it("cancelling a FINISHED-but-undrained job discards only the queue entry -- results are preserved and reported at that runIndex", async () => {
    stubQueueNode(h, "31797622", 60);
    stubSql(h, {
      finishedAt: "2026-09-11 05:10:53",
      methodRows: [
        {
          ClassName: "ExecuteMCPv2.QAFixtures.LongRunningTest",
          MethodName: "TestSlowMethod",
          Status: 1,
          Duration: 10.00968,
          ErrorAction: "",
          ErrorDescription: "",
        },
      ],
    });

    const result = await testStatusTool.handler({ action: "cancel", jobId: "31797622" }, h.ctx);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBe("completed");
    expect(structured.runIndex).toBe(60);
    expect(structured.note as string).toContain("already finished");
    expect(structured.total).toBe(1);
    expect(structured.passed).toBe(1);
  });

  it("cancelling a FINISHED job that recorded no method rows returns the zero-result guard (with the preservation note), never a green total:0", async () => {
    stubQueueNode(h, "31797623", 67);
    stubSql(h, { finishedAt: "2026-09-11 05:10:53", methodRows: [], classErrorRows: [] });

    const result = await testStatusTool.handler({ action: "cancel", jobId: "31797623" }, h.ctx);
    expect(result.isError).toBe(true);
    const error = (result.structuredContent as { error: string }).error;
    expect(error).toContain("no method-level results");
    expect(error).toContain("cancelling discarded only its queue entry");
  });

  it("cancelling an already-gone job (DELETE 404, e.g. a concurrent poller consumed it after the pre-read) falls back to the runIndex observation", async () => {
    stubQueueNode(h, "31797624", 66);
    h.workDelete.mockRejectedValueOnce(
      new IrisApiError(404, [], "/api/atelier/v8/USER/work/31797624", "IRIS returned HTTP 404"),
    );
    stubSql(h, { finishedAt: "" });

    const result = await testStatusTool.handler({ action: "cancel", jobId: "31797624" }, h.ctx);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.status).toBe("abandoned");
    expect(structured.runIndex).toBe(66);
  });

  it("a non-404 DELETE failure (HTTP 423 LOCKED by a concurrent poller) keeps jobId + runIndex and says the outcome is unknown — never throws", async () => {
    stubQueueNode(h, "31797625", 68);
    h.workDelete.mockRejectedValueOnce(
      new IrisApiError(423, [], "/api/atelier/v8/USER/work/31797625", "IRIS returned HTTP 423"),
    );

    const result = await testStatusTool.handler({ action: "cancel", jobId: "31797625" }, h.ctx);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.jobId).toBe("31797625");
    expect(structured.runIndex).toBe(68);
    expect(structured.error as string).toContain("whether it took effect is unknown");
    expect(structured.hint as string).toContain('jobId "31797625"');
  });

  it("an SQL failure after a successful DELETE still reports the DELETE's observation with the row state 'unknown'", async () => {
    stubQueueNode(h, "31797626", 69);
    stubSql(h, { failWith: new IrisConnectionError("TIMEOUT", "timed out", "retry") });

    const result = await testStatusTool.handler({ action: "cancel", jobId: "31797626" }, h.ctx);
    const structured = result.structuredContent as { status: string; runIndex: number; observed: { queueNode: string; resultRow: string } };
    expect(structured.status).toBe("cancelled");
    expect(structured.runIndex).toBe(69);
    expect(structured.observed.queueNode).toBe("gone");
    expect(structured.observed.resultRow).toMatch(/^unknown — reading %UnitTest_Result for runIndex 69 failed/);
  });

  it("cancel is governance-classified 'write' and never carries a defaultEnabled marker", () => {
    expect(testStatusTool.mutates).toMatchObject({ cancel: "write" });
    expect(testStatusTool.defaultEnabled ?? []).not.toContain("cancel");
  });
});
