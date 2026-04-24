import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  routineIntermediateTool,
  buildRoutineCandidates,
} from "../tools/routine.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── iris_routine_intermediate ───────────────────────────────────────

describe("iris_routine_intermediate", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("returns .1.int content on happy path (first-candidate hit)", async () => {
    const docContent = {
      name: "Ens.Director.1.int",
      cat: "RTN",
      content: [
        "ROUTINE Ens.Director [Type=INT]",
        "Start(pConfigName,pTimeout=10,pForceNew=0) public {",
        "  quit $$$OK",
        "}",
      ],
    };
    mockHttp.get.mockResolvedValue(envelope(docContent));

    const result = await routineIntermediateTool.handler(
      { name: "Ens.Director" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledTimes(1);
    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/Ens.Director.1.int",
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      name: "Ens.Director",
      resolvedDoc: "Ens.Director.1.int",
      namespace: "USER",
      content: docContent.content.join("\n"),
      candidatesTried: ["Ens.Director.1.int"],
    });
    // Text blob should contain the routine header for LLM readability
    expect(result.content[0]?.text).toContain("Ens.Director");
    expect(result.content[0]?.text).toContain("ROUTINE Ens.Director");
  });

  it("falls back to .int when .1.int is 404", async () => {
    const fallbackContent = {
      name: "Legacy.Routine.int",
      cat: "RTN",
      content: ["ROUTINE Legacy.Routine", " quit"],
    };
    mockHttp.get
      .mockRejectedValueOnce(
        new IrisApiError(404, [], "/api/atelier/v7/USER/doc/Legacy.Routine.1.int"),
      )
      .mockResolvedValueOnce(envelope(fallbackContent));

    const result = await routineIntermediateTool.handler(
      { name: "Legacy.Routine" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledTimes(2);
    expect(mockHttp.get).toHaveBeenNthCalledWith(
      1,
      "/api/atelier/v7/USER/doc/Legacy.Routine.1.int",
    );
    expect(mockHttp.get).toHaveBeenNthCalledWith(
      2,
      "/api/atelier/v7/USER/doc/Legacy.Routine.int",
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      name: "Legacy.Routine",
      resolvedDoc: "Legacy.Routine.int",
      namespace: "USER",
      content: fallbackContent.content.join("\n"),
      candidatesTried: ["Legacy.Routine.1.int", "Legacy.Routine.int"],
    });
  });

  it("returns isError with hint when all candidates 404", async () => {
    mockHttp.get
      .mockRejectedValueOnce(
        new IrisApiError(404, [], "/api/atelier/v7/USER/doc/Pkg.NotCompiled.1.int"),
      )
      .mockRejectedValueOnce(
        new IrisApiError(404, [], "/api/atelier/v7/USER/doc/Pkg.NotCompiled.int"),
      );

    const result = await routineIntermediateTool.handler(
      { name: "Pkg.NotCompiled" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledTimes(2);
    expect(result.isError).toBe(true);
    const structured = result.structuredContent as {
      name: string;
      namespace: string;
      candidatesTried: string[];
      hint: string;
    };
    expect(structured.name).toBe("Pkg.NotCompiled");
    expect(structured.namespace).toBe("USER");
    expect(structured.candidatesTried).toEqual([
      "Pkg.NotCompiled.1.int",
      "Pkg.NotCompiled.int",
    ]);
    expect(structured.hint).toContain("not be compiled");
    expect(structured.hint).toContain("iris_doc_compile");
  });

  it("fails fast on 401 without trying next candidate", async () => {
    mockHttp.get.mockRejectedValueOnce(
      new IrisApiError(401, [], "/api/atelier/v7/USER/doc/Ens.Director.1.int"),
    );

    const result = await routineIntermediateTool.handler(
      { name: "Ens.Director" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("401");
    const structured = result.structuredContent as { statusCode: number };
    expect(structured.statusCode).toBe(401);
  });

  it("fails fast on 403 without trying next candidate", async () => {
    mockHttp.get.mockRejectedValueOnce(
      new IrisApiError(403, [], "/api/atelier/v7/USER/doc/Ens.Director.1.int"),
    );

    const result = await routineIntermediateTool.handler(
      { name: "Ens.Director" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledTimes(1);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("403");
    const structured = result.structuredContent as { statusCode: number };
    expect(structured.statusCode).toBe(403);
  });

  it("re-throws non-404/401/403 IrisApiError (5xx)", async () => {
    mockHttp.get.mockRejectedValueOnce(
      new IrisApiError(500, [], "/api/atelier/v7/USER/doc/Broken.1.int"),
    );

    await expect(
      routineIntermediateTool.handler({ name: "Broken" }, ctx),
    ).rejects.toThrow(IrisApiError);
  });

  it("uses namespace override when provided", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({
        name: "ExecuteMCPv2.REST.Command.1.int",
        cat: "RTN",
        content: ["ROUTINE ExecuteMCPv2.REST.Command"],
      }),
    );

    const result = await routineIntermediateTool.handler(
      { name: "ExecuteMCPv2.REST.Command", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/doc/ExecuteMCPv2.REST.Command.1.int",
    );
    const structured = result.structuredContent as { namespace: string };
    expect(structured.namespace).toBe("HSCUSTOM");
  });

  it("strips .cls suffix (case-insensitive) before building candidates", () => {
    // Via buildRoutineCandidates directly — both forms must produce
    // identical candidate lists.
    expect(buildRoutineCandidates("Pkg.Class")).toEqual([
      "Pkg.Class.1.int",
      "Pkg.Class.int",
    ]);
    expect(buildRoutineCandidates("Pkg.Class.cls")).toEqual([
      "Pkg.Class.1.int",
      "Pkg.Class.int",
    ]);
    expect(buildRoutineCandidates("Pkg.Class.CLS")).toEqual([
      "Pkg.Class.1.int",
      "Pkg.Class.int",
    ]);
    expect(buildRoutineCandidates("  Pkg.Class.Cls  ")).toEqual([
      "Pkg.Class.1.int",
      "Pkg.Class.int",
    ]);
  });

  it("rejects path traversal names without making any HTTP call", async () => {
    const result = await routineIntermediateTool.handler(
      { name: "../Secret" },
      ctx,
    );

    expect(mockHttp.get).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("path traversal");
  });

  it("handles empty content array (compiled routine with no lines)", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ name: "Empty.Routine.1.int", cat: "RTN", content: [] }),
    );

    const result = await routineIntermediateTool.handler(
      { name: "Empty.Routine" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    const structured = result.structuredContent as {
      resolvedDoc: string;
      content: string;
      candidatesTried: string[];
    };
    expect(structured.resolvedDoc).toBe("Empty.Routine.1.int");
    expect(structured.content).toBe("");
    expect(structured.candidatesTried).toEqual(["Empty.Routine.1.int"]);
  });

  it("passes format query parameter when provided", async () => {
    mockHttp.get.mockResolvedValue(
      envelope({ name: "Ens.Director.1.int", cat: "RTN", content: ["x"] }),
    );

    await routineIntermediateTool.handler(
      { name: "Ens.Director", format: "xml" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/Ens.Director.1.int?format=xml",
    );
  });
});

// ── buildRoutineCandidates ──────────────────────────────────────────

describe("buildRoutineCandidates", () => {
  it("emits .1.int before .int", () => {
    expect(buildRoutineCandidates("Foo.Bar")).toEqual([
      "Foo.Bar.1.int",
      "Foo.Bar.int",
    ]);
  });

  it("handles system-class names", () => {
    expect(buildRoutineCandidates("%SYS.Task")).toEqual([
      "%SYS.Task.1.int",
      "%SYS.Task.int",
    ]);
  });
});
