/**
 * Story 44.7 QA (DW-755, DW-759; Rules #19, #54, #59) - the gaps the build's tests leave in the compile check of `iris_doc_load`.
 *
 * Pinned here, beyond the single-failure paths in `load.test.ts`:
 *  - only the documents that were uploaded are compiled and checked (a failed upload is never asked about);
 *  - a mixed `.cls` + `.mac` upload: clean, and with both kinds unconfirmed (reported in upload order);
 *  - a check that cannot run for the routines (the exact text), and a compile that threw: no check request follows;
 *  - `compile: false` sends no compile and no check read; flags reach only the compile, the namespace override reaches the check.
 *
 * The fakes are the planning probes' captures (`compile-check-fakes.ts`, Rule #54). Mocked HTTP and file system, no IRIS.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { docLoadTool } from "../tools/load.js";
import { notFound } from "./conflict-fakes.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";
import { cleanCompileAnswer, fakeCompileAndCheck } from "./compile-check-fakes.js";
import { notConfirmedText } from "../tools/compile-check.js";

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  globSync: vi.fn(),
}));

import { readFileSync, globSync } from "node:fs";

const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockGlobSync = globSync as unknown as ReturnType<typeof vi.fn>;

type LoadResult = {
  total: number;
  uploaded: number;
  failed: number;
  compilationResult?: { success: boolean; documents: string[]; errors?: Array<{ document: string; error: string }>; console?: string[] };
};

describe("iris_doc_load: the compile check, gaps (Story 44.7 QA)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;
  /** The answer of every GET that is not a docnames read: each document is new, so the Storage guard finds nothing. */
  const documentsAreNew = async (path: string): Promise<never> => {
    throw notFound(path);
  };

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
    vi.clearAllMocks();
  });

  it("only the uploaded documents are compiled and checked: a file whose upload failed is never asked about", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Lost.cls", "c:/src/Kept.cls"]);
    mockReadFileSync.mockReturnValueOnce("Class Lost {}\n").mockReturnValueOnce("Class Kept {}\n");
    mockHttp.put.mockRejectedValueOnce(new Error("Server error")).mockResolvedValueOnce(envelope({ name: "Kept.cls" }));
    const calls = fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer(["Kept.cls"]), otherGet: documentsAreNew });

    const result = await docLoadTool.handler({ path: "c:/src/**/*.cls", compile: true }, ctx);

    const structured = result.structuredContent as LoadResult;
    expect(structured).toMatchObject({ total: 2, uploaded: 1, failed: 1 });
    expect(structured.compilationResult).toEqual({ success: true, documents: ["Kept.cls"] });
    expect(mockHttp.post).toHaveBeenCalledWith("/api/atelier/v7/USER/action/compile", ["Kept.cls"]);
    expect(calls.queryParameters).toEqual([["Kept"]]);
  });

  it("a clean mixed .cls and .mac upload: success, the pre-story keys only, and the check's reads are one query and one listing per kind", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Pkg/Ok.cls", "c:/src/Utils/Ok.mac"]);
    mockReadFileSync.mockReturnValueOnce("Class Pkg.Ok {}\n").mockReturnValueOnce("Write 1\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["Pkg.Ok.cls", "Utils.Ok.mac"]),
      catalog: [{ name: "Utils.Ok.mac" }],
      otherGet: documentsAreNew,
    });

    const result = await docLoadTool.handler({ path: "c:/src/**/*", compile: true }, ctx);

    expect((result.structuredContent as LoadResult).compilationResult).toEqual({
      success: true,
      documents: ["Pkg.Ok.cls", "Utils.Ok.mac"],
    });
    expect(calls.posts).toEqual(["/api/atelier/v7/USER/action/compile", "/api/atelier/v7/USER/action/query"]);
    expect(calls.gets).toEqual([
      "/api/atelier/v7/USER/docnames/CLS?filter=Pkg.",
      "/api/atelier/v7/USER/docnames/RTN?filter=Utils.",
    ]);
  });

  it("a class and a routine both unconfirmed are both named, in the order uploaded", async () => {
    // The routine is uploaded first, so a result that lists classes before routines is out of order.
    mockGlobSync.mockReturnValue(["c:/src/Utils/Bad.mac", "c:/src/Pkg/Bad.cls", "c:/src/Pkg/Ok.cls"]);
    mockReadFileSync
      .mockReturnValueOnce("Write 1\n")
      .mockReturnValueOnce("Class Pkg.Bad {}\n")
      .mockReturnValueOnce("Class Pkg.Ok {}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));
    fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["Utils.Bad.mac", "Pkg.Bad.cls", "Pkg.Ok.cls"]),
      broken: ["Pkg.Bad.cls", "Utils.Bad.mac"],
      catalog: [{ name: "Utils.Bad.mac" }],
      otherGet: documentsAreNew,
    });

    const result = await docLoadTool.handler({ path: "c:/src/**/*", compile: true }, ctx);

    expect(result.isError).toBeFalsy();
    const compilation = (result.structuredContent as LoadResult).compilationResult;
    expect(compilation?.success).toBe(false);
    expect(compilation?.errors).toEqual([
      { document: "Utils.Bad.mac", error: notConfirmedText("Utils.Bad.mac") },
      { document: "Pkg.Bad.cls", error: notConfirmedText("Pkg.Bad.cls") },
    ]);
  });

  it("a routine listing that cannot be read: compilationResult.success:false with the exact 'could not run' text, never a pass", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Utils/Ok.mac"]);
    mockReadFileSync.mockReturnValue("Write 1\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));
    fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["Utils.Ok.mac"]),
      routineListFails: new Error("ECONNRESET"),
      otherGet: documentsAreNew,
    });

    const result = await docLoadTool.handler({ path: "c:/src/**/*", compile: true }, ctx);

    expect(result.isError).toBeFalsy();
    expect((result.structuredContent as LoadResult).compilationResult).toEqual({
      success: false,
      documents: ["Utils.Ok.mac"],
      errors: [{ document: "*", error: "the check that every class compiled could not run: ECONNRESET" }],
    });
  });

  it("a compile that threw is reported as before and no check request follows it", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Test.cls"]);
    mockReadFileSync.mockReturnValue("Class Test {}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: new Error("IRIS reported errors for POST action/compile. Details: ERROR #5475"),
      otherGet: documentsAreNew,
    });

    const result = await docLoadTool.handler({ path: "c:/src/**/*.cls", compile: true }, ctx);

    expect((result.structuredContent as LoadResult).compilationResult).toEqual({
      success: false,
      documents: ["Test.cls"],
      errors: [{ document: "*", error: "IRIS reported errors for POST action/compile. Details: ERROR #5475" }],
    });
    expect(calls.posts).toEqual(["/api/atelier/v7/USER/action/compile"]);
    expect(calls.gets).toEqual([]);
  });

  it("compile: false sends no compile and no check read, and the result has no compilationResult", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Pkg/Ok.cls", "c:/src/Utils/Ok.mac"]);
    mockReadFileSync.mockReturnValueOnce("Class Pkg.Ok {}\n").mockReturnValueOnce("Write 1\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));
    const calls = fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer([]), otherGet: documentsAreNew });

    const result = await docLoadTool.handler({ path: "c:/src/**/*", compile: false }, ctx);

    expect(calls.posts).toEqual([]);
    expect(calls.gets).toEqual([]);
    expect(result.structuredContent as LoadResult).toMatchObject({ total: 2, uploaded: 2, failed: 0 });
    expect(result.structuredContent).not.toHaveProperty("compilationResult");
  });

  it("flags reach only the compile request, and the namespace override reaches every check request", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Pkg/Ok.cls"]);
    mockReadFileSync.mockReturnValue("Class Pkg.Ok {}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));
    const calls = fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer(["Pkg.Ok.cls"]), otherGet: documentsAreNew });

    await docLoadTool.handler({ path: "c:/src/**/*.cls", compile: true, flags: "ck", namespace: "HSCUSTOM" }, ctx);

    expect(calls.posts).toEqual([
      "/api/atelier/v7/HSCUSTOM/action/compile?flags=ck",
      "/api/atelier/v7/HSCUSTOM/action/query",
    ]);
    expect(calls.gets).toEqual(["/api/atelier/v7/HSCUSTOM/docnames/CLS?filter=Pkg."]);
  });
});
