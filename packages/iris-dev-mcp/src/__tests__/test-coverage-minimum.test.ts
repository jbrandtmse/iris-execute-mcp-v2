/**
 * Story 40.2 -- `iris_test_coverage` `minCoverage` (AC 40.2.4, matrix rows 4 and 16): the schema, the Start body, the verdict
 * in the result, and the companion reproducing the primary call's result (AC-3, AD-16). The run record is the live Status
 * record of the Story 40.2 oracle run (`story402-run.ts`); the live gate drives the same rows over the real wire.
 */

import { describe, it, expect } from "vitest";
import type { IrisHttpClient } from "@iris-mcp/shared";
import type { TestClock } from "../tools/execute.js";
import { createTestCoverageHandler, pollCoverageRun, testCoverageTool, type CoverageRun } from "../tools/test-coverage.js";
import { createMockCtx, createMockHttp, envelope } from "./test-helpers.js";
import { STORY402_RUN } from "./story402-run.js";

const clock: TestClock = { now: () => 0, sleep: async () => undefined };

/** Serve `record` for the start route, the run reads and the test-result queries (one passed test). */
function harness(record: CoverageRun) {
  const http = createMockHttp();
  const starts: unknown[] = [];
  http.post.mockImplementation(async (route: string, body?: unknown) => {
    if (route.endsWith("/dev/test/coverage")) {
      starts.push(body);
      return envelope({ ...record, outcome: "started" });
    }
    const query = String((body as { query?: string })?.query ?? "");
    if (query.includes("TestAssert")) return envelope({ content: [] });
    return envelope({
      content: [
        { ClassName: "Story402.FixtureTest", MethodName: "TestEveryMethod", Status: 1, Duration: 0.5, ErrorAction: "", ErrorDescription: "" },
      ],
    });
  });
  http.get.mockImplementation(async () => envelope(record));
  return { http, starts, ctx: createMockCtx(http as unknown as IrisHttpClient, 8) };
}

const ARGS = {
  target: "Story402.FixtureTest",
  level: "class" as const,
  classes: ["Story402.Fixture", "Story402.Layout", "Story402.Missing"],
  namespace: "EXECMCPTMP402A",
};

describe("iris_test_coverage minCoverage: the schema (matrix row 16)", () => {
  const schema = testCoverageTool.inputSchema;
  const base = { target: "A.B", level: "class", classes: ["A.B"] };

  it("takes a number from 0 to 100, and is optional", () => {
    expect(schema.safeParse(base).success).toBe(true);
    for (const value of [0, 100, 90, 79.995, 0.5]) expect(schema.safeParse({ ...base, minCoverage: value }).success, String(value)).toBe(true);
  });

  it("refuses -1, 101, a string, null, a boolean and NaN", () => {
    for (const value of [-1, 101, 100.5, "x", "90", null, true, Number.NaN]) {
      expect(schema.safeParse({ ...base, minCoverage: value }).success, String(value)).toBe(false);
    }
  });

  it("describes the target, the verdict, and that a failing verdict is not an error", () => {
    const description = String(schema.shape.minCoverage.description);
    expect(description).toContain("coverage.verdict");
    expect(description).toContain("never makes the result an error");
    expect(testCoverageTool.description).toContain("A failing verdict is still isError false");
  });
});

describe("iris_test_coverage minCoverage: the Start body", () => {
  it("is sent when given, and is absent otherwise, so a 40.1 request is byte-identical (AD-33)", async () => {
    const withMinimum = harness(STORY402_RUN);
    await createTestCoverageHandler(clock)({ ...ARGS, minCoverage: 90 }, withMinimum.ctx);
    expect(withMinimum.starts).toEqual([
      { target: "Story402.FixtureTest", level: "class", classes: ARGS.classes, namespace: "EXECMCPTMP402A", maxSeconds: 3600, maxLines: 200000, minCoverage: 90 },
    ]);

    const without = harness(STORY402_RUN);
    await createTestCoverageHandler(clock)(ARGS, without.ctx);
    expect(without.starts).toEqual([
      { target: "Story402.FixtureTest", level: "class", classes: ARGS.classes, namespace: "EXECMCPTMP402A", maxSeconds: 3600, maxLines: 200000 },
    ]);

    const zero = harness(STORY402_RUN);
    await createTestCoverageHandler(clock)({ ...ARGS, minCoverage: 0 }, zero.ctx);
    expect(zero.starts[0], "0 is a minimum, not an omission").toMatchObject({ minCoverage: 0 });
  });
});

describe("iris_test_coverage minCoverage: the result (matrix row 4) and the companion (AC-3)", () => {
  it("a failing verdict is isError false, names the failing classes, and carries the verdict in structuredContent", async () => {
    const h = harness(STORY402_RUN);
    const result = await createTestCoverageHandler(clock)({ ...ARGS, minCoverage: 90 }, h.ctx);
    expect(result.isError).toBeUndefined();
    const text = (result.content[0] as { text: string }).text.split("\n");
    expect(text[1]).toBe("Coverage target 90%: FAIL (88.89% overall); failing: Story402.Layout 50%, Story402.Missing (not-compiled)");
    const coverage = (result.structuredContent as { coverage: { verdict: { overall: string; classes: Array<Record<string, unknown>> } } }).coverage;
    expect(coverage.verdict.overall).toBe("fail");
    expect(coverage.verdict.classes).toEqual([
      { class: "Story402.Fixture", verdict: "pass", percent: 95.65 },
      { class: "Story402.Layout", verdict: "fail", percent: 50 },
      { class: "Story402.Missing", verdict: "fail", percent: null, reason: "not-compiled" },
    ]);
  });

  it("without minCoverage the result has no verdict and no target line, and the same class-source summary", async () => {
    const record: CoverageRun = { ...STORY402_RUN };
    delete record.minCoverage;
    const result = await createTestCoverageHandler(clock)(ARGS, harness(record).ctx);
    const coverage = (result.structuredContent as { coverage: Record<string, unknown> }).coverage;
    expect(coverage).not.toHaveProperty("verdict");
    expect(coverage).toHaveProperty("source");
    expect((result.content[0] as { text: string }).text).not.toContain("Coverage target");
  });

  it("the companion's poll by the handle alone deep-equals the primary call's structuredContent, verdict included, and a second poll equals the first", async () => {
    const h = harness(STORY402_RUN);
    const primary = await createTestCoverageHandler(clock)({ ...ARGS, minCoverage: 90 }, h.ctx);
    const first = await pollCoverageRun(h.ctx, { coverageRunId: "645" });
    const second = await pollCoverageRun(h.ctx, { coverageRunId: "645" });
    expect(first.structuredContent).toEqual(primary.structuredContent);
    expect(first.content).toEqual(primary.content);
    expect(second.structuredContent).toEqual(first.structuredContent);
    expect((first.structuredContent as { coverage: { verdict?: unknown } }).coverage.verdict).toBeDefined();
  });

  it("a Status record that omits minCoverage gives a poll with no verdict (what the stored minimum is for)", async () => {
    const record: CoverageRun = { ...STORY402_RUN };
    delete record.minCoverage;
    const polled = await pollCoverageRun(harness(record).ctx, { coverageRunId: "645" });
    expect((polled.structuredContent as { coverage: Record<string, unknown> }).coverage).not.toHaveProperty("verdict");
  });
});
