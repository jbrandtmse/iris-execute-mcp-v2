/**
 * Story 40.3 -- the TestProduction guard of `iris_execute_tests` and `iris_test_coverage`.
 *
 * The decision is made IRIS-side (`ExecuteMCPv2.REST.UnitTest:ProductionGuard`); these tests pin what TypeScript
 * does with it: the route's path and query encoding, the 404 rule, the one `PRODUCTION_BUSY` refusal (text and
 * fields), where the guard sits in the `iris_execute_tests` handler, and the guard failures (matrix row 16). The
 * answers the mocked route gives have the shape the live route returns (`ProductionCheck`, Rule #54); the live
 * values are the Story 40.3 gate's.
 */

import { describe, it, expect, vi } from "vitest";
import { IrisApiError, IrisConnectionError, REFUSAL_CODES, type IrisHttpClient } from "@iris-mcp/shared";
import { createExecuteTestsHandler, executeTestsTool } from "../tools/execute.js";
import { testCoverageTool } from "../tools/test-coverage.js";
import {
  TEST_PRODUCTION_GUARD_SENTENCE,
  productionBusyRefusal,
  readProductionGuard,
  type ProductionGuardResult,
} from "../tools/test-production-guard.js";
import { createMockCtx, createMockHttp, envelope } from "./test-helpers.js";

const GUARD_PATH = "/api/executemcp/v2/dev/test/production";

const TESTS = [{ class: "Story403.PassTest", production: "Story403.Production" }];

/** The route's answer when another production runs (live shape of row 3). */
const BUSY_RUNNING: ProductionGuardResult = {
  decision: "busy",
  namespace: "EXECMCPTMP403A",
  testProductions: TESTS,
  production: "Story403.Other",
  state: "Running",
  stateCode: 1,
};

/** The route's answer when Ens's lock could not be taken (live shape of row 13). */
const BUSY_UNREADABLE: ProductionGuardResult = {
  decision: "busy",
  namespace: "EXECMCPTMP403A",
  testProductions: TESTS,
  error: "The Ens runtime lock (Ens.Runtime) was not acquired within 5 seconds",
};

function notFound(path: string): IrisApiError {
  return new IrisApiError(404, [], path, "Not Found");
}

describe("readProductionGuard (Story 40.3)", () => {
  function ctxWith(get: ReturnType<typeof vi.fn>) {
    const http = createMockHttp();
    http.get.mockImplementation(get);
    return { ctx: createMockCtx(http as unknown as IrisHttpClient), http };
  }

  it("GETs the route with target, level and namespace sent explicitly and URI-encoded", async () => {
    const { ctx, http } = ctxWith(vi.fn(async () => envelope({ decision: "proceed", namespace: "A B", testProductions: [] })));
    await readProductionGuard(ctx, "A B", "Story403.PassTest:TestControl", "method");
    expect(http.get).toHaveBeenCalledTimes(1);
    expect(http.get.mock.calls[0]?.[0]).toBe(
      `${GUARD_PATH}?target=Story403.PassTest%3ATestControl&level=method&namespace=A%20B`,
    );
  });

  it("encodes characters that would split or end a query value", async () => {
    const { ctx, http } = ctxWith(vi.fn(async () => envelope({ decision: "proceed", namespace: "X", testProductions: [] })));
    await readProductionGuard(ctx, "X&level=package", "A&b=c#d", "class");
    expect(http.get.mock.calls[0]?.[0]).toBe(`${GUARD_PATH}?target=A%26b%3Dc%23d&level=class&namespace=X%26level%3Dpackage`);
  });

  it("returns the route's decision (proceed, no TestProduction test) as it is", async () => {
    const { ctx } = ctxWith(vi.fn(async () => envelope({ decision: "proceed", namespace: "EXECMCPTMP403B", testProductions: [] })));
    expect(await readProductionGuard(ctx, "EXECMCPTMP403B", "Story403.PlainTest", "class")).toEqual({
      decision: "proceed",
      namespace: "EXECMCPTMP403B",
      testProductions: [],
    });
  });

  it("keeps the state fields of a busy decision", async () => {
    const { ctx } = ctxWith(vi.fn(async () => envelope(BUSY_RUNNING)));
    expect(await readProductionGuard(ctx, "EXECMCPTMP403A", "Story403.PassTest", "class")).toEqual(BUSY_RUNNING);
  });

  it("a 404 (no guard route on this server) is undefined, so the run goes ahead as it did", async () => {
    const { ctx } = ctxWith(vi.fn(async (path: string) => {
      throw notFound(path);
    }));
    expect(await readProductionGuard(ctx, "USER", "A.B", "class")).toBeUndefined();
  });

  it("any other failure is thrown: HTTP 500, an HTTP 403, a connection error", async () => {
    for (const failure of [
      new IrisApiError(500, [], GUARD_PATH, "boom"),
      new IrisApiError(403, [], GUARD_PATH, "forbidden"),
      new IrisConnectionError("NETWORK_ERROR", "Connection refused", "Check that IRIS is running"),
    ]) {
      const { ctx } = ctxWith(vi.fn(async () => {
        throw failure;
      }));
      await expect(readProductionGuard(ctx, "USER", "A.B", "class")).rejects.toBe(failure);
    }
  });

  it("only an explicit proceed lets a run go ahead: a missing or unknown decision is busy", async () => {
    for (const result of [{}, { decision: "maybe" }, { decision: "busy" }, undefined]) {
      const { ctx } = ctxWith(vi.fn(async () => envelope(result)));
      const guard = await readProductionGuard(ctx, "USER", "A.B", "class");
      expect(guard?.decision, JSON.stringify(result)).toBe("busy");
      expect(guard?.namespace).toBe("USER");
      expect(guard?.testProductions).toEqual([]);
    }
  });
});

describe("productionBusyRefusal (Story 40.3)", () => {
  it("state read: names the production, its state and the tests, and says it was left untouched", () => {
    const result = productionBusyRefusal(BUSY_RUNNING);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "PRODUCTION_BUSY",
      namespace: "EXECMCPTMP403A",
      state: "Running",
      testProductions: TESTS,
      production: "Story403.Other",
    });
    expect(Object.keys(result.structuredContent as object)).toEqual([
      "code", "namespace", "state", "testProductions", "production",
    ]);
    expect((result.content[0] as { text: string }).text).toBe(
      "Production 'Story403.Other' is Running in namespace EXECMCPTMP403A, and it is not the production of the " +
        "TestProduction tests in this run (Story403.PassTest (Story403.Production)). %UnitTest.TestProduction stops " +
        "any other production before it starts its own, so nothing was run and 'Story403.Other' was left untouched. " +
        "Run the tests once it has stopped; if an interrupted test run left it running, stop it with " +
        "iris_production_control and run the tests again.",
    );
  });

  it("an unnamed production is '(unnamed)' in the text and \"\" in the field", () => {
    const result = productionBusyRefusal({ ...BUSY_RUNNING, production: "", state: "Troubled", stateCode: 4 });
    expect((result.structuredContent as { production: string }).production).toBe("");
    expect((result.content[0] as { text: string }).text).toContain("Production '(unnamed)' is Troubled in namespace");
    expect((result.content[0] as { text: string }).text).toContain("'(unnamed)' was left untouched");
  });

  it("lists every test of the run with its production, comma separated", () => {
    const result = productionBusyRefusal({
      ...BUSY_RUNNING,
      testProductions: [
        { class: "Story403.Mixed.ProdTest", production: "Story403.Production" },
        { class: "Story403.OtherTest", production: "Story403.Other" },
      ],
    });
    expect((result.content[0] as { text: string }).text).toContain(
      "(Story403.Mixed.ProdTest (Story403.Production), Story403.OtherTest (Story403.Other))",
    );
  });

  it("state unreadable: state Unknown, the error in the fields and the text, and no production field", () => {
    const result = productionBusyRefusal(BUSY_UNREADABLE);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "PRODUCTION_BUSY",
      namespace: "EXECMCPTMP403A",
      state: "Unknown",
      testProductions: TESTS,
      error: "The Ens runtime lock (Ens.Runtime) was not acquired within 5 seconds",
    });
    expect((result.content[0] as { text: string }).text).toBe(
      "The production state of namespace EXECMCPTMP403A could not be read (The Ens runtime lock (Ens.Runtime) was " +
        "not acquired within 5 seconds), so the TestProduction tests in this run (Story403.PassTest " +
        "(Story403.Production)) were not run: %UnitTest.TestProduction stops any other production before it " +
        "starts its own. Try again in a moment.",
    );
  });

  it("an unreadable state with no error text still refuses, with no error field", () => {
    const withoutError: ProductionGuardResult = { ...BUSY_UNREADABLE };
    delete withoutError.error;
    const result = productionBusyRefusal(withoutError);
    expect(result.structuredContent).not.toHaveProperty("error");
    expect((result.content[0] as { text: string }).text).toContain("could not be read (no reason was given)");
  });

  it("the code is in the refusal catalog", () => {
    expect(REFUSAL_CODES.PRODUCTION_BUSY).toBe("PRODUCTION_BUSY");
  });
});

describe("the tool descriptions carry the guard sentence (Story 40.3)", () => {
  it("names the code, the nothing-run and left-untouched effects, and that the guard needs the ExecuteMCPv2 service", () => {
    expect(TEST_PRODUCTION_GUARD_SENTENCE).toContain("PRODUCTION_BUSY");
    expect(TEST_PRODUCTION_GUARD_SENTENCE).toContain("nothing is run");
    expect(TEST_PRODUCTION_GUARD_SENTENCE).toContain("left untouched");
    expect(TEST_PRODUCTION_GUARD_SENTENCE).toContain("ExecuteMCPv2 service");
    expect(TEST_PRODUCTION_GUARD_SENTENCE).toContain("unguarded");
    for (const tool of [executeTestsTool, testCoverageTool]) {
      expect(tool.description, tool.name).toContain(TEST_PRODUCTION_GUARD_SENTENCE);
    }
  });
});

describe("iris_execute_tests and the guard (Story 40.3, matrix row 16)", () => {
  type Call = { method: "GET" | "POST"; path: string; body?: unknown };

  /** Mocked http for the handler: the guard answers through `guard`; the work queue completes at once. */
  function harness(guard: (path: string) => unknown, discovered: string[] = ["Story403.PassTest"]) {
    const calls: Call[] = [];
    const http = createMockHttp();
    http.get.mockImplementation(async (path: string) => {
      calls.push({ method: "GET", path });
      if (path.startsWith(`${GUARD_PATH}?`)) {
        const answer = guard(path);
        if (answer instanceof Error) throw answer;
        return envelope(answer);
      }
      if (path.startsWith("/api/executemcp/v2/global?")) return envelope({ value: "", defined: false });
      return envelope([{ class: "Story403.PassTest", method: "TestControl", status: 1, duration: 6, failures: [] }]);
    });
    http.post.mockImplementation(async (path: string, body?: unknown) => {
      calls.push({ method: "POST", path, body });
      if (path.endsWith("/work")) return envelope({ location: "job-9" });
      const query = String((body as { query?: string } | undefined)?.query ?? "");
      if (query.includes("%Dictionary.ClassDefinition")) return envelope({ content: discovered.map((Name) => ({ Name })) });
      return envelope({ content: [{ UnitTestRoot: "/tmp/ut" }] });
    });
    return { ctx: createMockCtx(http as unknown as IrisHttpClient), calls };
  }

  const proceed = (path: string) => ({
    decision: "proceed",
    namespace: new URLSearchParams(path.split("?")[1] ?? "").get("namespace"),
    testProductions: [],
  });

  /** The calls other than the guard read. */
  const withoutGuard = (calls: Call[]) => calls.filter((call) => !call.path.startsWith(GUARD_PATH));

  it("a 404 from the guard route: the run goes ahead, and the calls and the result are those of a proceed", async () => {
    const guarded = harness(proceed);
    const unguarded = harness((path) => notFound(path));
    const args = { target: "Story403.PassTest", level: "class" as const };
    const withProceed = await createExecuteTestsHandler()(args, guarded.ctx);
    const with404 = await createExecuteTestsHandler()(args, unguarded.ctx);

    expect(with404).toEqual(withProceed);
    expect(with404.isError).toBeUndefined();
    expect(with404.structuredContent).toMatchObject({ status: "completed", total: 1, passed: 1, failed: 0 });
    expect(unguarded.calls.filter((call) => call.path.startsWith(GUARD_PATH))).toHaveLength(1);
    expect(withoutGuard(unguarded.calls)).toEqual(withoutGuard(guarded.calls));
    // The pre-guard sequence: ensure the root, read the counter, queue, poll, read the counter.
    expect(withoutGuard(unguarded.calls).map((call) => `${call.method} ${call.path.replace(/\?.*$/, "")}`)).toEqual([
      "POST /api/atelier/v7/USER/action/query",
      "GET /api/executemcp/v2/global",
      "POST /api/atelier/v7/USER/work",
      "GET /api/atelier/v7/USER/work/job-9",
      "GET /api/executemcp/v2/global",
    ]);
  });

  it("HTTP 500 from the guard route: the existing 'Error executing tests' result, and /work is never POSTed", async () => {
    const h = harness((path) => new IrisApiError(500, [], path, "The guard failed."));
    const result = await createExecuteTestsHandler()({ target: "Story403.PassTest", level: "class" }, h.ctx);
    expect(result.isError).toBe(true);
    expect((result.content[0] as { text: string }).text).toContain("Error executing tests for 'Story403.PassTest': The guard failed.");
    expect(h.calls.map((call) => `${call.method} ${call.path.replace(/\?.*$/, "")}`)).toEqual([`GET ${GUARD_PATH}`]);
    expect(h.calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("busy: the PRODUCTION_BUSY refusal, and ensureUnitTestRoot, the counter read and /work are never called", async () => {
    const h = harness(() => BUSY_RUNNING);
    const result = await createExecuteTestsHandler()({ target: "Story403.PassTest", level: "class" }, h.ctx);
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "PRODUCTION_BUSY",
      namespace: "EXECMCPTMP403A",
      state: "Running",
      testProductions: TESTS,
      production: "Story403.Other",
    });
    expect(h.calls.map((call) => `${call.method} ${call.path.replace(/\?.*$/, "")}`)).toEqual([`GET ${GUARD_PATH}`]);
  });

  it("asks with the tool's target, level and resolved namespace, whatever the level", async () => {
    const method = harness(proceed);
    await createExecuteTestsHandler()({ target: "Story403.PassTest:TestControl", level: "method", namespace: "EXECMCPTMP403A" }, method.ctx);
    expect(method.calls[0]?.path).toBe(`${GUARD_PATH}?target=Story403.PassTest%3ATestControl&level=method&namespace=EXECMCPTMP403A`);

    const pkg = harness(proceed);
    await createExecuteTestsHandler()({ target: "Story403.Mixed", level: "package" }, pkg.ctx);
    // The tests array is built first (the package is discovered), then the guard is asked.
    expect(pkg.calls.map((call) => `${call.method} ${call.path.replace(/\?.*$/, "")}`).slice(0, 2)).toEqual([
      "POST /api/atelier/v7/USER/action/query",
      `GET ${GUARD_PATH}`,
    ]);
    expect(pkg.calls.find((call) => call.path.startsWith(GUARD_PATH))?.path).toBe(
      `${GUARD_PATH}?target=Story403.Mixed&level=package&namespace=USER`,
    );
  });

  it("a malformed method target and a package with no test class keep their results and never reach the guard", async () => {
    const malformed = harness(() => BUSY_RUNNING);
    const malformedResult = await createExecuteTestsHandler()({ target: "A.B:C:D", level: "method" }, malformed.ctx);
    expect(malformedResult.isError).toBe(true);
    expect((malformedResult.content[0] as { text: string }).text).toContain("Malformed method-level target");
    expect(malformed.calls).toEqual([]);

    const empty = harness(() => BUSY_RUNNING, []);
    const emptyResult = await createExecuteTestsHandler()({ target: "No.Such", level: "package" }, empty.ctx);
    expect((emptyResult.content[0] as { text: string }).text).toContain("No test classes found in package 'No.Such'");
    expect(empty.calls.some((call) => call.path.startsWith(GUARD_PATH))).toBe(false);
  });
});
