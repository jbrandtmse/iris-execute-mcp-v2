/**
 * Story 44.7 QA (DW-754, DW-755, DW-759; Rules #19, #54, #59) - the gaps the build's own tests leave in the compile check of
 * `iris_doc_compile`, and in the helpers the three compiling tools share (`compile-check.ts`).
 *
 * The build pinned the single-failure paths. This file pins what they leave open:
 *  - the helpers' boundaries and their request counts (nothing to check means no request);
 *  - a class AND a routine both unconfirmed, reported in the order the caller gave, not classes first;
 *  - a wildcard that overlaps a concrete name (one check row, not two), a literal dot in the pattern, a pattern in another case,
 *    an exclusion that comes first, and an exclusion of a routine;
 *  - a wildcard of documents the check cannot judge (`.inc`) sends no listing at all;
 *  - an expansion that cannot be read fails the result, like a check that cannot run;
 *  - the namespace override reaches the check's requests, flags reach only the compile, and the clean result keeps its keys.
 *
 * The fakes are the planning probes' captures (`compile-check-fakes.ts`, Rule #54). Mocked HTTP only, no IRIS.
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { docCompileTool } from "../tools/compile.js";
import {
  checkCouldNotRunText,
  isCheckableClass,
  isCheckableRoutine,
  notConfirmedText,
  unconfirmedDocuments,
} from "../tools/compile-check.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";
import { cleanCompileAnswer, fakeCompileAndCheck } from "./compile-check-fakes.js";

type Structured = {
  success: boolean;
  errors?: Array<{ document: string; error: string }>;
  documents: string[];
};

describe("compile-check.ts: what counts as checkable", () => {
  it("a class or routine name needs a stem before the extension, in lower case", () => {
    expect(isCheckableClass("A.cls")).toBe(true);
    expect(isCheckableClass(".cls")).toBe(false);
    expect(isCheckableClass("A.mac")).toBe(false);
    expect(isCheckableClass("A.cls.mac")).toBe(false);
    expect(isCheckableRoutine("A.mac")).toBe(true);
    expect(isCheckableRoutine(".mac")).toBe(false);
    expect(isCheckableRoutine("A.int")).toBe(false);
    expect(isCheckableRoutine("A.inc")).toBe(false);
    expect(isCheckableRoutine("A.cls")).toBe(false);
  });

  it("the two texts are the ones the tools report, word for word", () => {
    expect(notConfirmedText("Pkg.C.cls")).toBe(
      "Pkg.C.cls did not compile: the class dictionary and IRIS's up-to-date flag do not confirm it (IRIS answered the compile without a status error; see console)",
    );
    expect(notConfirmedText("Pkg.R.mac")).toBe(
      "Pkg.R.mac did not compile: IRIS's up-to-date flag does not confirm it (IRIS answered the compile without a status error; see console)",
    );
    expect(checkCouldNotRunText(new Error("ECONNRESET"))).toBe("the check that every class compiled could not run: ECONNRESET");
    // A thrown value that is not an Error is still reported, never lost.
    expect(checkCouldNotRunText("boom")).toBe("the check that every class compiled could not run: boom");
  });
});

describe("compile-check.ts: unconfirmedDocuments", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;

  beforeEach(() => {
    mockHttp = createMockHttp();
  });

  it("sends no request when there is nothing it can judge: no names, or only .inc and .int", async () => {
    const calls = fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer([]) });

    expect(await unconfirmedDocuments(mockHttp, "USER", 7, [])).toEqual([]);
    expect(await unconfirmedDocuments(mockHttp, "USER", 7, ["A.inc", "B.int", "C.csp"])).toEqual([]);

    expect(calls.posts).toEqual([]);
    expect(calls.gets).toEqual([]);
  });

  it("returns the unconfirmed documents in the order given, classes and routines interleaved", async () => {
    fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      broken: ["B.Two.cls", "A.One.mac"],
      catalog: [{ name: "A.One.mac" }, { name: "A.Three.mac" }],
    });

    const named = await unconfirmedDocuments(mockHttp, "USER", 7, ["A.One.mac", "A.Three.mac", "B.Two.cls", "B.Four.cls"]);

    // The routine comes first because the caller named it first: the order is the caller's, not "classes, then routines".
    expect(named).toEqual(["A.One.mac", "B.Two.cls"]);
  });

  it("a routine-only list asks no dictionary question, and a class-only list reads no routines", async () => {
    const routines = fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer([]), catalog: [{ name: "P.R.mac" }] });
    await unconfirmedDocuments(mockHttp, "HSCUSTOM", 8, ["P.R.mac", "P.Skipped.inc"]);
    expect(routines.posts).toEqual([]);
    expect(routines.gets).toEqual(["/api/atelier/v8/HSCUSTOM/docnames/RTN?filter=P."]);

    const classes = fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer([]) });
    await unconfirmedDocuments(mockHttp, "HSCUSTOM", 8, ["P.C.cls", "Q.D.cls"]);
    expect(classes.posts).toEqual(["/api/atelier/v8/HSCUSTOM/action/query"]);
    expect(classes.queryParameters).toEqual([["P.C", "Q.D"]]);
    expect(classes.gets).toEqual([
      "/api/atelier/v8/HSCUSTOM/docnames/CLS?filter=P.",
      "/api/atelier/v8/HSCUSTOM/docnames/CLS?filter=Q.",
    ]);
  });
});

describe("iris_doc_compile: the compile check, gaps (Story 44.7 QA)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("a class and a routine both unconfirmed are both named, in the order the caller gave", async () => {
    fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["A.Bad.mac", "A.Ok.cls", "B.Bad.cls", "B.Ok.mac"]),
      broken: ["B.Bad.cls", "A.Bad.mac"],
      catalog: [{ name: "A.Bad.mac" }, { name: "B.Ok.mac" }],
    });

    // The routine is named first, so a result that lists classes before routines is out of order.
    const result = await docCompileTool.handler({ doc: ["A.Bad.mac", "A.Ok.cls", "B.Bad.cls", "B.Ok.mac"] }, ctx);

    expect(result.isError).toBe(false);
    const structured = result.structuredContent as Structured;
    expect(structured.success).toBe(false);
    expect(structured.errors).toEqual([
      { document: "A.Bad.mac", error: notConfirmedText("A.Bad.mac") },
      { document: "B.Bad.cls", error: notConfirmedText("B.Bad.cls") },
    ]);
    expect(result.content[0]?.text).toContain("with 2 error(s)");
  });

  it("a wildcard that overlaps a concrete name checks that class once", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      catalog: [{ name: "Pkg.A.cls" }, { name: "Pkg.B.cls" }],
    });

    await docCompileTool.handler({ doc: ["Pkg.A.cls", "Pkg.*.cls", "Pkg.A.cls"] }, ctx);

    expect(calls.queryParameters).toEqual([["Pkg.A", "Pkg.B"]]);
  });

  it("the dot of a pattern is a dot, not any character; the match ignores case", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      catalog: [
        { name: "PkgXPOne.cls" }, // 'Pkg.P*' must not match this: the '.' is literal
        { name: "Pkg.POne.cls" },
        { name: "PKG.PTwo.cls" }, // IRIS names are case-insensitive for the filter; the pattern is too
      ],
    });

    await docCompileTool.handler({ doc: "pkg.p*.cls" }, ctx);

    expect(calls.queryParameters).toEqual([["Pkg.POne", "PKG.PTwo"]]);
  });

  it("an exclusion given before the pattern still removes what it matches, and a routine can be excluded", async () => {
    const classes = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      catalog: [{ name: "Pkg.A.cls" }, { name: "Pkg.B.cls" }],
    });
    await docCompileTool.handler({ doc: ["'Pkg.B.cls", "Pkg.*.cls"] }, ctx);
    expect(classes.queryParameters).toEqual([["Pkg.A"]]);

    fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      broken: ["Pkg.RSkip.mac"],
      catalog: [{ name: "Pkg.RKeep.mac" }, { name: "Pkg.RSkip.mac" }],
    });
    const result = await docCompileTool.handler({ doc: ["Pkg.R*.mac", "'Pkg.RSkip.mac"] }, ctx);
    expect((result.structuredContent as Structured).success).toBe(true);
  });

  it("only an exclusion, or a wildcard of documents the check cannot judge, sends no listing and no check", async () => {
    const calls = fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer([]) });

    const onlyExclusion = await docCompileTool.handler({ doc: ["'Pkg.B.cls"] }, ctx);
    const includes = await docCompileTool.handler({ doc: "Pkg.*.inc" }, ctx);

    expect(calls.posts).toEqual([
      "/api/atelier/v7/USER/action/compile",
      "/api/atelier/v7/USER/action/compile",
    ]);
    expect(calls.gets).toEqual([]);
    expect((onlyExclusion.structuredContent as Structured).success).toBe(true);
    expect((includes.structuredContent as Structured).success).toBe(true);
  });

  it("an expansion that cannot be read is a check that cannot run: success:false, one '*' entry, isError false, no dictionary query", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer([]),
      routineListFails: new Error("ECONNRESET"),
    });

    const result = await docCompileTool.handler({ doc: "Pkg.R*.mac" }, ctx);

    expect(result.isError).toBe(false);
    expect((result.structuredContent as Structured).success).toBe(false);
    expect((result.structuredContent as Structured).errors).toEqual([
      { document: "*", error: "the check that every class compiled could not run: ECONNRESET" },
    ]);
    expect(calls.posts).toEqual(["/api/atelier/v7/USER/action/compile"]);
  });

  it("the namespace override reaches every check request, and flags reach only the compile", async () => {
    const calls = fakeCompileAndCheck(mockHttp, {
      compile: cleanCompileAnswer(["A.B.cls", "A.R.mac"]),
      catalog: [{ name: "A.R.mac" }],
    });

    await docCompileTool.handler({ doc: ["A.B.cls", "A.R.mac"], flags: "ck", namespace: "HSCUSTOM" }, ctx);

    expect(calls.posts).toEqual([
      "/api/atelier/v7/HSCUSTOM/action/compile?flags=ck",
      "/api/atelier/v7/HSCUSTOM/action/query",
    ]);
    expect(calls.gets).toEqual([
      "/api/atelier/v7/HSCUSTOM/docnames/CLS?filter=A.",
      "/api/atelier/v7/HSCUSTOM/docnames/RTN?filter=A.",
    ]);
  });

  it("a clean result keeps exactly its pre-story keys (no errors member), with and without console output", async () => {
    fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer(["Clean.cls"]) });
    const quiet = await docCompileTool.handler({ doc: "Clean.cls" }, ctx);
    expect(quiet.structuredContent).toEqual({
      success: true,
      documents: ["Clean.cls"],
      compilationTime: expect.stringMatching(/^\d+ms$/),
    });
    expect(quiet.content).toHaveLength(2);
    expect(quiet.content[0]?.text).toMatch(/^Successfully compiled Clean\.cls in \d+ms$/);
    expect(JSON.parse(quiet.content[1]?.text ?? "")).toEqual(quiet.structuredContent);

    fakeCompileAndCheck(mockHttp, { compile: cleanCompileAnswer(["Clean.cls"], ["Compiling class Clean"]) });
    const loud = await docCompileTool.handler({ doc: "Clean.cls" }, ctx);
    expect(loud.structuredContent).toEqual({
      success: true,
      documents: ["Clean.cls"],
      compilationTime: expect.stringMatching(/^\d+ms$/),
      console: ["Compiling class Clean"],
    });
  });

  it("a compile IRIS answered with an empty document list is checked by the names asked, not by what it listed", async () => {
    // Probe A: IRIS lists no per-document result when it has nothing to say; the check must still look at the named class.
    fakeCompileAndCheck(mockHttp, { compile: envelope({ content: [] }), broken: ["Quiet.Bad.cls"] });

    const result = await docCompileTool.handler({ doc: "Quiet.Bad.cls" }, ctx);

    expect((result.structuredContent as Structured).success).toBe(false);
    expect((result.structuredContent as Structured).errors?.map((e) => e.document)).toEqual(["Quiet.Bad.cls"]);
  });
});
