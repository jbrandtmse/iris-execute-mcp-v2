/**
 * Story 44.7 QA (DW-755, DW-759; Rules #19, #54, #59) - the gaps the build's tests leave in the compile check of
 * `iris_env_promote` `execute`.
 *
 * Pinned here, beyond the single-failure paths in `env-promote-execute.test.ts`:
 *  - the check reads the TARGET (its client, its namespace, its Atelier version), never the source;
 *  - only the allowlisted steps are checked, and documents the check cannot judge (`.inc`, `.int`) send no check request;
 *  - a class and a routine both unconfirmed: the first step in plan order fails, the other is `skipped`, never a second `failed`;
 *  - a routine-only check that cannot run fails the first step with the exact text, and no later step completes.
 *
 * The fakes are the planning probes' captures (`compile-check-fakes.ts`, Rule #54). Mocked HTTP only, no IRIS.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { ProfileResolutionError } from "@iris-mcp/shared";
import { envPromoteTool } from "../tools/env-promote.js";
import { notFound } from "./conflict-fakes.js";
import { cleanCompileAnswer, fakeCompileAndCheck, type CompileCheckFake } from "./compile-check-fakes.js";
import { checkCouldNotRunText, notConfirmedText } from "../tools/compile-check.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

interface ExecutedStepSC {
  index: number;
  subject: string;
  status: "completed" | "failed" | "skipped";
  error?: string;
}
interface ExecuteResultSC {
  executed: ExecutedStepSC[];
  summary: { completed: number; failed: number; skipped: number };
}
interface PlanResultSC {
  planHash: string;
  steps: Array<{ index: number; subject: string }>;
}

const versionResponse = (): unknown => envelope({ content: { api: 8 } });

function documentsDiff(onlyInSource: string[]): Record<string, unknown> {
  return {
    source: { profile: "source", namespace: "HSCUSTOM" },
    target: { profile: "target", namespace: "SADEMO" },
    domains: { documents: { onlyInSource, onlyInTarget: [], differs: [], identical: 0 } },
    summary: { driftCount: onlyInSource.length, identicalCount: 0 },
  };
}

async function buildPlan(diff: Record<string, unknown>): Promise<PlanResultSC> {
  const result = await envPromoteTool.handler({ action: "plan", source: "source", target: "target", diff }, createMockCtx());
  return result.structuredContent as unknown as PlanResultSC;
}

describe("iris_env_promote execute: the compile check, gaps (Story 44.7 QA)", () => {
  let sourceHttp: ReturnType<typeof createMockHttp>;
  let targetHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    sourceHttp = createMockHttp("HSCUSTOM");
    targetHttp = createMockHttp("SADEMO");
    ctx = createMockCtx(sourceHttp);
    ctx.resolveProfileClient = vi.fn(async (name: string) => {
      if (name === "source") return sourceHttp;
      if (name === "target") return targetHttp;
      throw new ProfileResolutionError(name, ["default", "source", "target"]);
    });
  });

  /** Arrange the source (it serves every document) and the target (the check's fake) for a documents-only promote. */
  function arrange(names: string[], fake: Omit<CompileCheckFake, "compile" | "otherGet"> & { compile?: unknown }) {
    sourceHttp.get.mockImplementation(async (path: string) => {
      if (path === "/api/atelier/") return versionResponse();
      const doc = names.find((name) => path.includes(`doc/${name}`));
      if (doc !== undefined) return envelope({ name: doc, content: ["ROUTINE x", " quit"] });
      throw new Error(`unexpected sourceHttp.get ${path}`);
    });
    targetHttp.put.mockResolvedValue(envelope({}));
    return fakeCompileAndCheck(targetHttp, {
      compile: cleanCompileAnswer(names),
      ...fake,
      otherGet: async (path: string) => {
        if (path === "/api/atelier/") return versionResponse();
        if (path.includes("/doc/")) throw notFound(path);
        throw new Error(`unexpected targetHttp.get ${path}`);
      },
    });
  }

  async function execute(names: string[], pick?: (plan: PlanResultSC) => number[]) {
    const diff = documentsDiff(names);
    const plan = await buildPlan(diff);
    const steps = pick ? pick(plan) : plan.steps.map((step) => step.index);
    const result = await envPromoteTool.handler(
      { action: "execute", source: "source", target: "target", diff, plan, steps, confirm: true },
      ctx,
    );
    return { result, plan, sc: result.structuredContent as unknown as ExecuteResultSC };
  }

  it("the check reads the target client, its namespace and its Atelier version, and never the source", async () => {
    const calls = arrange(["Pkg.Ok.cls", "Utils.Ok.mac"], { catalog: [{ name: "Utils.Ok.mac" }] });

    const { result, sc } = await execute(["Pkg.Ok.cls", "Utils.Ok.mac"]);

    expect(result.isError).toBeFalsy();
    expect(sc.summary).toEqual({ completed: 2, failed: 0, skipped: 0 });
    expect(calls.posts).toEqual(["/api/atelier/v8/SADEMO/action/compile?flags=cuk", "/api/atelier/v8/SADEMO/action/query"]);
    expect(calls.gets).toEqual([
      "/api/atelier/v8/SADEMO/docnames/CLS?filter=Pkg.",
      "/api/atelier/v8/SADEMO/docnames/RTN?filter=Utils.",
    ]);
    expect(sourceHttp.post).not.toHaveBeenCalled();
    expect(sourceHttp.get.mock.calls.every((call) => !(call[0] as string).includes("docnames"))).toBe(true);
  });

  it("only the allowlisted steps are compiled and checked", async () => {
    const calls = arrange(["A.One.cls", "B.Two.cls"], {});

    const { sc } = await execute(["A.One.cls", "B.Two.cls"], (plan) => [plan.steps.find((step) => step.subject === "B.Two.cls")?.index ?? -1]);

    expect(sc.executed.map((step) => step.subject)).toEqual(["B.Two.cls"]);
    expect(calls.queryParameters).toEqual([["B.Two"]]);
    expect(targetHttp.post).toHaveBeenCalledWith(expect.stringContaining("action/compile"), ["B.Two.cls"]);
  });

  it("include files and .int routines are promoted without a check request", async () => {
    const calls = arrange(["Lib.Macros.inc", "Lib.Gen.int"], {});

    const { result, sc } = await execute(["Lib.Macros.inc", "Lib.Gen.int"]);

    expect(result.isError).toBeFalsy();
    expect(sc.summary).toEqual({ completed: 2, failed: 0, skipped: 0 });
    expect(calls.posts).toEqual(["/api/atelier/v8/SADEMO/action/compile?flags=cuk"]);
    expect(calls.gets).toEqual([]);
  });

  it("a class and a routine both unconfirmed: the first step in plan order fails, the other is skipped, not a second failure", async () => {
    arrange(["Aaa.Rtn.mac", "Zzz.Cls.cls"], { broken: ["Aaa.Rtn.mac", "Zzz.Cls.cls"], catalog: [{ name: "Aaa.Rtn.mac" }] });

    const { result, plan, sc } = await execute(["Aaa.Rtn.mac", "Zzz.Cls.cls"]);

    expect(result.isError).toBe(true);
    const first = plan.steps[0]?.subject as string;
    const second = plan.steps[1]?.subject as string;
    const bySubject = new Map(sc.executed.map((step) => [step.subject, step]));
    expect(bySubject.get(first)?.status).toBe("failed");
    expect(bySubject.get(first)?.error).toBe(`compile error: ${notConfirmedText(first)}`);
    expect(bySubject.get(second)?.status).toBe("skipped");
    expect(bySubject.get(second)?.error).toBeUndefined();
    expect(sc.summary).toEqual({ completed: 0, failed: 1, skipped: 1 });
  });

  it("a routine-only check that cannot run fails the first step with the exact text and completes none", async () => {
    arrange(["Aaa.One.mac", "Bbb.Two.mac"], {
      routineListFails: new Error("ECONNRESET"),
      catalog: [{ name: "Aaa.One.mac" }, { name: "Bbb.Two.mac" }],
    });

    const { result, plan, sc } = await execute(["Aaa.One.mac", "Bbb.Two.mac"]);

    expect(result.isError).toBe(true);
    const bySubject = new Map(sc.executed.map((step) => [step.subject, step]));
    const first = plan.steps[0]?.subject as string;
    expect(bySubject.get(first)?.status).toBe("failed");
    expect(bySubject.get(first)?.error).toBe(checkCouldNotRunText(new Error("ECONNRESET")));
    expect(bySubject.get(first)?.error).toBe("the check that every class compiled could not run: ECONNRESET");
    expect(sc.summary).toEqual({ completed: 0, failed: 1, skipped: 1 });
  });
});
