import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { docCompileTool } from "../tools/compile.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";
import { cleanCompileAnswer, fakeCompileAndCheck } from "./compile-check-fakes.js";
import { checkCouldNotRunText, notConfirmedText } from "../tools/compile-check.js";

// ── iris_doc_compile ───────────────────────────────────────────────

describe("iris_doc_compile", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should compile a single document successfully and return success status", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["MyApp.Service.cls"], ["Compilation started..."]),
    });

    const result = await docCompileTool.handler(
      { doc: "MyApp.Service.cls" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/compile",
      ["MyApp.Service.cls"],
    );
    expect(result.structuredContent).toMatchObject({
      success: true,
      documents: ["MyApp.Service.cls"],
    });
    expect(result.isError).toBe(false);
    expect(result.content[0]?.text).toContain("Successfully compiled");
    // Story 44.7: the clean path adds exactly the check's two reads (the dictionary query, then docnames).
    expect(calls.posts).toEqual([
      "/api/atelier/v7/USER/action/compile",
      "/api/atelier/v7/USER/action/query",
    ]);
    expect(calls.gets).toEqual(["/api/atelier/v7/USER/docnames/CLS?filter=MyApp."]);
    expect(calls.queryParameters).toEqual([["MyApp.Service"]]);
    expect(result.structuredContent).not.toHaveProperty("errors");
  });

  it("should pass compilation flags to endpoint as query parameter", async () => {
    fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer(["Test.cls"]) });

    await docCompileTool.handler(
      { doc: "Test.cls", flags: "cku" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/compile?flags=cku",
      ["Test.cls"],
    );
  });

  it("should compile multiple documents in a single request", async () => {
    const docs = ["One.cls", "Two.cls", "Three.cls"];
    fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer(docs) });

    const result = await docCompileTool.handler({ doc: docs }, ctx);

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/compile",
      docs,
    );
    expect(result.structuredContent).toMatchObject({
      success: true,
      documents: docs,
    });
  });

  it("should return compilation errors with line/char positions and isError: false", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({
        content: [
          {
            name: "Bad.cls",
            status: "ERROR",
            errors: [
              { error: "ERROR #5540: Expected '}' but found EOF", line: 15, char: 1 },
              { error: "ERROR #5541: Missing semicolon", line: 20, char: 5 },
            ],
          },
        ],
      }),
    );

    const result = await docCompileTool.handler(
      { doc: "Bad.cls" },
      ctx,
    );

    // Per AC #4: compilation errors use isError: false
    expect(result.isError).toBe(false);

    const structured = result.structuredContent as {
      success: boolean;
      errors: Array<{ document: string; error: string; line?: number; char?: number }>;
    };
    expect(structured.success).toBe(false);
    expect(structured.errors).toHaveLength(2);
    expect(structured.errors[0]).toEqual({
      document: "Bad.cls",
      error: "ERROR #5540: Expected '}' but found EOF",
      line: 15,
      char: 1,
    });
    expect(structured.errors[1]).toEqual({
      document: "Bad.cls",
      error: "ERROR #5541: Missing semicolon",
      line: 20,
      char: 5,
    });
    expect(result.content[0]?.text).toContain("Compilation failed");
  });

  it("should return job ID when async mode is enabled", async () => {
    const asyncResult = { trackingId: "job-12345" };
    mockHttp.post.mockResolvedValue(
      envelope(asyncResult, ["Async compilation queued"]),
    );

    const result = await docCompileTool.handler(
      { doc: ["Large.pkg.cls"], async: true },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/action/compile?async=1",
      ["Large.pkg.cls"],
    );
    const structured = result.structuredContent as { mode: string; response: unknown };
    expect(structured.mode).toBe("async");
    expect(structured.response).toEqual(asyncResult);
  });

  it("should propagate connection failures as thrown errors", async () => {
    mockHttp.post.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      docCompileTool.handler({ doc: "Test.cls" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should use namespace override when provided", async () => {
    const calls = fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer(["Test.cls"]) });

    await docCompileTool.handler(
      { doc: "Test.cls", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/action/compile",
      ["Test.cls"],
    );
    // The check reads the same namespace the compile ran in.
    expect(calls.posts).toEqual([
      "/api/atelier/v7/HSCUSTOM/action/compile",
      "/api/atelier/v7/HSCUSTOM/action/query",
    ]);
    expect(calls.gets).toEqual(["/api/atelier/v7/HSCUSTOM/docnames/CLS?filter=Test."]);
  });

  it("should include compilationTime in result", async () => {
    fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer(["Test.cls"]) });

    const result = await docCompileTool.handler(
      { doc: "Test.cls" },
      ctx,
    );

    const structured = result.structuredContent as { compilationTime: string };
    expect(structured.compilationTime).toMatch(/^\d+ms$/);
  });

  it("should pass both flags and async as query parameters", async () => {
    mockHttp.post.mockResolvedValue(
      envelope({ trackingId: "job-99" }),
    );

    await docCompileTool.handler(
      { doc: "Test.cls", flags: "ck", async: true },
      ctx,
    );

    const calledPath = mockHttp.post.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("flags=ck");
    expect(calledPath).toContain("async=1");
  });

  it("should have correct tool annotations", () => {
    expect(docCompileTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should return early with a message when doc is an empty array", async () => {
    const result = await docCompileTool.handler({ doc: [] }, ctx);

    expect(mockHttp.post).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toBe("No documents specified for compilation.");
    expect(result.isError).toBe(false);
  });

  it("should include console output when present in sync mode", async () => {
    fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["Test.cls"], ["Compilation started on Test.cls", "Compilation successful"]),
    });

    const result = await docCompileTool.handler(
      { doc: "Test.cls" },
      ctx,
    );

    const structured = result.structuredContent as { console: string[] };
    expect(structured.console).toEqual([
      "Compilation started on Test.cls",
      "Compilation successful",
    ]);
  });
});

// ── Story 44.7: the compile check (DW-754) ─────────────────────────
//
// Probe A (2026-11-23): [X fails, P persistent] answers HTTP 200 with no status error and no per-document error, and
// `verifyCompiled` names X. The fakes (compile-check-fakes.ts) return the captured row and docnames shapes.

describe("iris_doc_compile: the compile check (Story 44.7, DW-754)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  type Structured = {
    success: boolean;
    errors?: Array<{ document: string; error: string }>;
    documents: string[];
  };

  it("a partial failure with no error listed is success:false and names exactly the failing class", async () => {
    fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["Bad.cls", "Persistent.cls"], ["Compiling 2 classes"]),
      broken: ["Bad.cls"],
    });

    const result = await docCompileTool.handler({ doc: ["Bad.cls", "Persistent.cls"] }, ctx);

    expect(result.isError).toBe(false);
    const structured = result.structuredContent as Structured;
    expect(structured.success).toBe(false);
    expect(structured.errors).toEqual([{ document: "Bad.cls", error: notConfirmedText("Bad.cls") }]);
    expect(result.content[0]?.text).toContain("Compilation failed for Bad.cls, Persistent.cls with 1 error(s)");
  });

  it("names every failing class when several fail, in the order given", async () => {
    fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["A.cls", "B.cls", "C.cls"]),
      broken: ["C.cls", "A.cls"],
    });

    const result = await docCompileTool.handler({ doc: ["A.cls", "B.cls", "C.cls"] }, ctx);

    expect((result.structuredContent as Structured).errors?.map((e) => e.document)).toEqual(["A.cls", "C.cls"]);
  });

  it("a wildcard is expanded through docnames and the matches are checked", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      broken: ["Pkg.PBad.cls"],
      catalog: [
        { name: "Pkg.PBad.cls" },
        { name: "Pkg.PGood.cls" },
        { name: "Pkg.Other.cls" }, // the filter is a "name contains" read; the whole name must match the pattern
        { name: "Pkg.PGenerated.cls", gen: true }, // generated documents are skipped
        { name: "Pkg.PSub.Nested.cls" }, // '*' matches a run, dots included
        { name: "Other.Pkg.PBad.cls" }, // "contains" returns it, the anchored pattern does not
      ],
    });

    const result = await docCompileTool.handler({ doc: "Pkg.P*.cls" }, ctx);

    expect(calls.gets[0]).toBe("/api/atelier/v7/USER/docnames/CLS?filter=Pkg.P");
    expect(calls.queryParameters).toEqual([["Pkg.PBad", "Pkg.PGood", "Pkg.PSub.Nested"]]);
    const structured = result.structuredContent as Structured;
    expect(structured.success).toBe(false);
    expect(structured.errors).toEqual([{ document: "Pkg.PBad.cls", error: notConfirmedText("Pkg.PBad.cls") }]);
    // The compile request itself is unchanged: IRIS expands the pattern.
    expect(mockHttp.post).toHaveBeenCalledWith("/api/atelier/v7/USER/action/compile", ["Pkg.P*.cls"]);
  });

  it("'?' matches one character, and a leading wildcard lists without a filter", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      catalog: [{ name: "Pkg.A1.cls" }, { name: "Pkg.A22.cls" }, { name: "Pkg.B1.cls" }],
    });

    await docCompileTool.handler({ doc: "Pkg.A?.cls" }, ctx);
    expect(calls.queryParameters).toEqual([["Pkg.A1"]]);

    calls.gets.length = 0;
    await docCompileTool.handler({ doc: "*.A1.cls" }, ctx);
    expect(calls.gets[0]).toBe("/api/atelier/v7/USER/docnames/CLS");
  });

  it("a wildcard that matches nothing checks nothing and the result stays a success", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      catalog: [{ name: "Other.X.cls" }],
    });

    const result = await docCompileTool.handler({ doc: "Pkg.P*.cls" }, ctx);

    expect(calls.posts).toEqual(["/api/atelier/v7/USER/action/compile"]);
    expect(calls.gets).toHaveLength(1); // the expansion only
    expect((result.structuredContent as Structured).success).toBe(true);
  });

  it("a name with a leading quote is an exclusion: what it matches is not checked", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      catalog: [{ name: "Pkg.A.cls" }, { name: "Pkg.B.cls" }, { name: "Pkg.C.cls" }],
    });

    await docCompileTool.handler({ doc: ["Pkg.*.cls", "'Pkg.B.cls"] }, ctx);

    expect(calls.queryParameters).toEqual([["Pkg.A", "Pkg.C"]]);
  });

  it("documents the check cannot judge (.inc, .int) are not checked: no check request is sent for them", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: envelope({ content: [{ name: "Rtn.int", status: "", errors: [] }] }),
    });

    const result = await docCompileTool.handler({ doc: ["Rtn.int", "Inc.inc"] }, ctx);

    expect(calls.posts).toEqual(["/api/atelier/v7/USER/action/compile"]);
    expect(calls.gets).toEqual([]);
    expect((result.structuredContent as Structured).success).toBe(true);
  });

  // DW-759 (probe 2026-11-23): [bad.mac, ok.mac, Pers.cls] answers HTTP 200 and success:true; docnames/RTN lists bad.mac upd false.
  it("a failed .mac routine in a compile that wrote a class's Storage is success:false and names exactly that routine", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["Pkg.Bad.mac", "Pkg.Ok.mac", "Pkg.Pers.cls"], ["Compiling routine : Pkg.Bad.mac", "ERROR: ..."]),
      broken: ["Pkg.Bad.mac"],
      catalog: [{ name: "Pkg.Bad.mac" }, { name: "Pkg.Ok.mac" }],
    });

    const result = await docCompileTool.handler({ doc: ["Pkg.Bad.mac", "Pkg.Ok.mac", "Pkg.Pers.cls"] }, ctx);

    expect(result.isError).toBe(false);
    const structured = result.structuredContent as Structured;
    expect(structured.success).toBe(false);
    expect(structured.errors).toEqual([{ document: "Pkg.Bad.mac", error: notConfirmedText("Pkg.Bad.mac") }]);
    expect(structured.errors?.[0]?.error).toBe(
      "Pkg.Bad.mac did not compile: IRIS's up-to-date flag does not confirm it (IRIS answered the compile without a status error; see console)",
    );
    // The class is checked as before (one dictionary query, one CLS read), and the routine by one RTN read.
    expect(calls.queryParameters).toEqual([["Pkg.Pers"]]);
    expect(calls.gets).toEqual([
      "/api/atelier/v7/USER/docnames/CLS?filter=Pkg.",
      "/api/atelier/v7/USER/docnames/RTN?filter=Pkg.",
    ]);
  });

  it("a .mac wildcard is expanded through docnames/RTN, and an .inc or .int it does not name is left alone", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      broken: ["Pkg.RBad.mac"],
      catalog: [{ name: "Pkg.RBad.mac" }, { name: "Pkg.ROk.mac" }, { name: "Pkg.RInc.inc" }, { name: "Pkg.RInt.int" }],
    });

    const result = await docCompileTool.handler({ doc: "Pkg.R*.mac" }, ctx);

    expect(calls.gets[0]).toBe("/api/atelier/v7/USER/docnames/RTN?filter=Pkg.R");
    expect(calls.queryParameters).toEqual([]);
    expect((result.structuredContent as Structured).errors).toEqual([{ document: "Pkg.RBad.mac", error: notConfirmedText("Pkg.RBad.mac") }]);
  });

  it("a routine listing that cannot be read is a check that cannot run: success:false, never a pass", async () => {
    fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["Pkg.Ok.mac"]),
      catalog: [{ name: "Pkg.Ok.mac" }],
      routineListFails: new Error("ECONNRESET"),
    });

    const result = await docCompileTool.handler({ doc: "Pkg.Ok.mac" }, ctx);

    expect((result.structuredContent as Structured).success).toBe(false);
    expect((result.structuredContent as Structured).errors).toEqual([{ document: "*", error: checkCouldNotRunText(new Error("ECONNRESET")) }]);
  });

  it("errors the compile already listed are reported as before, with no check request", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: envelope({
        content: [{ name: "Bad.cls", status: "ERROR", errors: [{ error: "ERROR #5540: Expected '}' but found EOF", line: 15, char: 1 }] }],
      }),
    });

    const result = await docCompileTool.handler({ doc: "Bad.cls" }, ctx);

    expect(calls.posts).toEqual(["/api/atelier/v7/USER/action/compile"]);
    expect(calls.gets).toEqual([]);
    expect((result.structuredContent as Structured).errors).toEqual([
      { document: "Bad.cls", error: "ERROR #5540: Expected '}' but found EOF", line: 15, char: 1 },
    ]);
  });

  it("a check that cannot run is success:false with one '*' entry, and isError stays false", async () => {
    fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["Test.cls"]),
      queryFails: new Error("ECONNRESET"),
    });

    const result = await docCompileTool.handler({ doc: "Test.cls" }, ctx);

    expect(result.isError).toBe(false);
    const structured = result.structuredContent as Structured;
    expect(structured.success).toBe(false);
    expect(structured.errors).toEqual([
      { document: "*", error: checkCouldNotRunText(new Error("ECONNRESET")) },
    ]);
    expect(structured.errors?.[0]?.error).toBe("the check that every class compiled could not run: ECONNRESET");
  });

  it("async mode sends no check request (Story 44.7 pin)", async () => {
    const calls = fakeCompileAndCheck(mockHttp, { compile: envelope({ trackingId: "job-1" }, ["queued"]) });

    const result = await docCompileTool.handler({ doc: ["Large.pkg.cls"], async: true }, ctx);

    expect(calls.posts).toEqual(["/api/atelier/v7/USER/action/compile?async=1"]);
    expect(calls.gets).toEqual([]);
    expect(result.structuredContent).toEqual({
      mode: "async",
      docs: ["Large.pkg.cls"],
      response: { trackingId: "job-1" },
      console: ["queued"],
    });
  });

  it("a status error still throws, and no check request follows it (Story 44.7 pin)", async () => {
    const statusError = new Error("IRIS reported errors for POST action/compile. Details: ERROR #5475");
    const calls = fakeCompileAndCheck(mockHttp, { compile: statusError });

    await expect(docCompileTool.handler({ doc: "X.cls" }, ctx)).rejects.toThrow("ERROR #5475");
    expect(calls.posts).toEqual(["/api/atelier/v7/USER/action/compile"]);
    expect(calls.gets).toEqual([]);
  });
});
