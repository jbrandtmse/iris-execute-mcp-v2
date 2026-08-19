import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { docLoadTool, filePathToDocName, extractBaseDir, docNameToFilePath, extractDeclaredIdentity } from "../tools/load.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── Mock node:fs ──────────────────────────────────────────────────────

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(),
  globSync: vi.fn(),
}));

import { readFileSync, globSync } from "node:fs";

const mockReadFileSync = readFileSync as ReturnType<typeof vi.fn>;
const mockGlobSync = globSync as unknown as ReturnType<typeof vi.fn>;

// ── Helper functions ──────────────────────────────────────────────────

describe("filePathToDocName", () => {
  it("should convert a nested file path to a dotted IRIS document name", () => {
    expect(
      filePathToDocName("c:/projects/src/MyPkg/Sub/MyClass.cls", "c:/projects/src"),
    ).toBe("MyPkg.Sub.MyClass.cls");
  });

  it("should handle backslash paths", () => {
    expect(
      filePathToDocName("c:\\projects\\src\\MyPkg\\MyClass.cls", "c:\\projects\\src"),
    ).toBe("MyPkg.MyClass.cls");
  });

  it("should handle single-level paths", () => {
    expect(
      filePathToDocName("c:/src/MyClass.cls", "c:/src"),
    ).toBe("MyClass.cls");
  });

  it("should handle .mac extension", () => {
    expect(
      filePathToDocName("c:/src/Utils/Helper.mac", "c:/src"),
    ).toBe("Utils.Helper.mac");
  });

  it("should strip trailing slash from base directory", () => {
    expect(
      filePathToDocName("c:/src/Pkg/Cls.cls", "c:/src/"),
    ).toBe("Pkg.Cls.cls");
  });
});

describe("extractBaseDir", () => {
  it("should extract the directory prefix before the first glob metacharacter", () => {
    expect(extractBaseDir("c:/projects/src/**/*.cls")).toBe("c:/projects/src");
  });

  it("should handle backslash paths", () => {
    expect(extractBaseDir("c:\\projects\\src\\**\\*.cls")).toBe("c:/projects/src");
  });

  it("should return the parent directory when the pattern has no metacharacters", () => {
    expect(extractBaseDir("c:/projects/src/file.cls")).toBe("c:/projects/src");
  });

  it("should return the parent directory for a nested literal path", () => {
    expect(extractBaseDir("c:/projects/src/MyPkg/Sub/MyClass.cls")).toBe(
      "c:/projects/src/MyPkg/Sub",
    );
  });

  it("should handle question mark metacharacter", () => {
    expect(extractBaseDir("c:/src/?.cls")).toBe("c:/src");
  });

  it("should handle brace expansion metacharacter", () => {
    expect(extractBaseDir("c:/src/{a,b}.cls")).toBe("c:/src");
  });
});

describe("docNameToFilePath", () => {
  it("maps a dotted IRIS class name to a nested file path under baseDir", () => {
    expect(
      docNameToFilePath("EnsLib.HTTP.GenericService.cls", "C:/dev/exp"),
    ).toBe("C:/dev/exp/EnsLib/HTTP/GenericService.cls");
  });

  it("handles .mac extension", () => {
    expect(docNameToFilePath("MyApp.Utils.Helper.mac", "C:/dev/exp")).toBe(
      "C:/dev/exp/MyApp/Utils/Helper.mac",
    );
  });

  it("handles .inc extension", () => {
    expect(docNameToFilePath("My.Include.inc", "C:/dev/exp")).toBe(
      "C:/dev/exp/My/Include.inc",
    );
  });

  it("uses short paths to truncate directory segments to 8 chars", () => {
    expect(
      docNameToFilePath(
        "ReallyLongPackageNameHere.AnotherLongOne.Foo.cls",
        "C:/dev/exp",
        { useShortPaths: true },
      ),
    ).toBe("C:/dev/exp/ReallyLo/AnotherL/Foo.cls");
  });

  it("useShortPaths leaves short segments unchanged and never shortens filename", () => {
    // MyApp (<=8 chars) and Utils (<=8 chars) unchanged. Filename "Utils" is last-before-ext.
    expect(
      docNameToFilePath("MyApp.Utils.cls", "C:/dev/exp", { useShortPaths: true }),
    ).toBe("C:/dev/exp/MyApp/Utils.cls");
  });

  it("useShortPaths does not shorten the last (filename) segment even when long", () => {
    // First two segments shortened, filename kept intact.
    expect(
      docNameToFilePath(
        "ReallyLongPackageNameHere.VeryLongFilenameSegment.cls",
        "C:/dev/exp",
        { useShortPaths: true },
      ),
    ).toBe("C:/dev/exp/ReallyLo/VeryLongFilenameSegment.cls");
  });

  it("useShortPaths: false is a no-op", () => {
    expect(
      docNameToFilePath(
        "ReallyLongPackageNameHere.AnotherLongOne.Foo.cls",
        "C:/dev/exp",
      ),
    ).toBe("C:/dev/exp/ReallyLongPackageNameHere/AnotherLongOne/Foo.cls");
  });

  it("handles CSP paths by stripping leading slash and preserving forward slashes", () => {
    expect(docNameToFilePath("/csp/user/menu.csp", "C:/dev/exp")).toBe(
      "C:/dev/exp/csp/user/menu.csp",
    );
  });

  it("handles slash-style paths that do not start with a leading slash", () => {
    expect(docNameToFilePath("csp/user/menu.csp", "C:/dev/exp")).toBe(
      "C:/dev/exp/csp/user/menu.csp",
    );
  });

  it("returns baseDir joined with the name as-is when there is no extension", () => {
    expect(docNameToFilePath("NoExtension", "C:/dev/exp")).toBe(
      "C:/dev/exp/NoExtension",
    );
  });

  it("handles a top-level class name (one segment)", () => {
    expect(docNameToFilePath("Foo.cls", "C:/dev/exp")).toBe(
      "C:/dev/exp/Foo.cls",
    );
  });

  it("handles baseDir with trailing slash", () => {
    expect(docNameToFilePath("MyPkg.Thing.cls", "C:/dev/exp/")).toBe(
      "C:/dev/exp/MyPkg/Thing.cls",
    );
  });

  it("round-trips with filePathToDocName for dotted class names", () => {
    const docName = "MyPkg.Sub.MyClass.cls";
    const baseDir = "c:/projects/src";
    const localPath = docNameToFilePath(docName, baseDir);
    expect(localPath).toBe("c:/projects/src/MyPkg/Sub/MyClass.cls");
    expect(filePathToDocName(localPath, baseDir)).toBe(docName);
  });
});

// ── iris_doc_load tool ────────────────────────────────────────────────

describe("iris_doc_load", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
    vi.clearAllMocks();
  });

  it("should return empty result when no files match the glob pattern", async () => {
    mockGlobSync.mockReturnValue([]);

    const result = await docLoadTool.handler(
      { path: "c:/empty/**/*.cls" },
      ctx,
    );

    expect(result.structuredContent).toMatchObject({
      total: 0,
      uploaded: 0,
      failed: 0,
    });
    expect(result.content[0]?.text).toContain("No files matched");
  });

  it("should upload each matched file via PUT /doc with correct document names", async () => {
    mockGlobSync.mockReturnValue([
      "c:/src/MyPkg/ClassA.cls",
      "c:/src/MyPkg/Sub/ClassB.cls",
    ]);
    // Per-file content (Story 35.9 fixture correction): each file's content
    // truthfully declares ITS OWN class, as a real workspace would. The
    // original fixture returned ClassA's declaration for BOTH files, which
    // only passed because nothing cross-checked content against path.
    mockReadFileSync
      .mockReturnValueOnce("Class MyPkg.ClassA {}\n")
      .mockReturnValueOnce("Class MyPkg.Sub.ClassB {}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "test" }));

    const result = await docLoadTool.handler(
      { path: "c:/src/**/*.cls" },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledTimes(2);

    // First file: MyPkg.ClassA.cls
    const firstCallPath = mockHttp.put.mock.calls[0]?.[0] as string;
    expect(firstCallPath).toContain("doc/MyPkg.ClassA.cls");
    expect(firstCallPath).toContain("ignoreConflict=1");

    // Second file: MyPkg.Sub.ClassB.cls
    const secondCallPath = mockHttp.put.mock.calls[1]?.[0] as string;
    expect(secondCallPath).toContain("doc/MyPkg.Sub.ClassB.cls");

    expect(result.structuredContent).toMatchObject({
      total: 2,
      uploaded: 2,
      failed: 0,
    });
  });

  it("should compile uploaded documents when compile is true", async () => {
    mockGlobSync.mockReturnValue(["c:/src/MyClass.cls"]);
    mockReadFileSync.mockReturnValue("Class MyClass {}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "MyClass.cls" }));
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ name: "MyClass.cls", status: "OK", errors: [] }] }),
    );

    const result = await docLoadTool.handler(
      { path: "c:/src/**/*.cls", compile: true },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledTimes(1);
    const compilePath = mockHttp.post.mock.calls[0]?.[0] as string;
    expect(compilePath).toContain("action/compile");

    const compileBody = mockHttp.post.mock.calls[0]?.[1] as string[];
    expect(compileBody).toEqual(["MyClass.cls"]);

    const structured = result.structuredContent as { compilationResult: { success: boolean } };
    expect(structured.compilationResult.success).toBe(true);
  });

  it("should pass compilation flags when compile is true and flags are provided", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Test.cls"]);
    mockReadFileSync.mockReturnValue("Class Test {}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.cls" }));
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ name: "Test.cls", status: "OK", errors: [] }] }),
    );

    await docLoadTool.handler(
      { path: "c:/src/**/*.cls", compile: true, flags: "cku" },
      ctx,
    );

    const compilePath = mockHttp.post.mock.calls[0]?.[0] as string;
    expect(compilePath).toContain("flags=cku");
  });

  it("should continue uploading when one file fails and report all failures", async () => {
    mockGlobSync.mockReturnValue([
      "c:/src/Good.cls",
      "c:/src/Bad.cls",
      "c:/src/AlsoGood.cls",
    ]);
    mockReadFileSync.mockReturnValue("content\n");

    // First and third succeed, second fails
    mockHttp.put
      .mockResolvedValueOnce(envelope({ name: "Good.cls" }))
      .mockRejectedValueOnce(new Error("Upload failed: 500"))
      .mockResolvedValueOnce(envelope({ name: "AlsoGood.cls" }));

    const result = await docLoadTool.handler(
      { path: "c:/src/**/*.cls" },
      ctx,
    );

    const structured = result.structuredContent as {
      total: number;
      uploaded: number;
      failed: number;
      failures: Array<{ file: string; docName: string; error: string }>;
    };
    expect(structured.total).toBe(3);
    expect(structured.uploaded).toBe(2);
    expect(structured.failed).toBe(1);
    expect(structured.failures).toHaveLength(1);
    expect(structured.failures[0]?.docName).toBe("Bad.cls");
    expect(structured.failures[0]?.error).toContain("Upload failed: 500");
  });

  it("should respect ignoreConflict=false and omit the query parameter", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Test.cls"]);
    mockReadFileSync.mockReturnValue("content\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.cls" }));

    await docLoadTool.handler(
      { path: "c:/src/**/*.cls", ignoreConflict: false },
      ctx,
    );

    const callPath = mockHttp.put.mock.calls[0]?.[0] as string;
    expect(callPath).not.toContain("ignoreConflict");
  });

  it("should default ignoreConflict to true when not specified", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Test.cls"]);
    mockReadFileSync.mockReturnValue("content\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.cls" }));

    await docLoadTool.handler({ path: "c:/src/**/*.cls" }, ctx);

    const callPath = mockHttp.put.mock.calls[0]?.[0] as string;
    expect(callPath).toContain("ignoreConflict=1");
  });

  it("should use namespace override when provided", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Test.cls"]);
    mockReadFileSync.mockReturnValue("content\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.cls" }));

    await docLoadTool.handler(
      { path: "c:/src/**/*.cls", namespace: "HSCUSTOM" },
      ctx,
    );

    const callPath = mockHttp.put.mock.calls[0]?.[0] as string;
    expect(callPath).toContain("/HSCUSTOM/");
  });

  it("should not call compile endpoint when compile is false", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Test.cls"]);
    mockReadFileSync.mockReturnValue("content\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.cls" }));

    await docLoadTool.handler(
      { path: "c:/src/**/*.cls", compile: false },
      ctx,
    );

    expect(mockHttp.post).not.toHaveBeenCalled();
  });

  it("should not compile when all uploads fail", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Test.cls"]);
    mockReadFileSync.mockReturnValue("content\n");
    mockHttp.put.mockRejectedValue(new Error("Server error"));

    const result = await docLoadTool.handler(
      { path: "c:/src/**/*.cls", compile: true },
      ctx,
    );

    expect(mockHttp.post).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({
      total: 1,
      uploaded: 0,
      failed: 1,
    });
  });

  it("should handle compilation failure gracefully", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Test.cls"]);
    mockReadFileSync.mockReturnValue("content\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.cls" }));
    mockHttp.post.mockRejectedValue(new Error("Compile timeout"));

    const result = await docLoadTool.handler(
      { path: "c:/src/**/*.cls", compile: true },
      ctx,
    );

    const structured = result.structuredContent as {
      compilationResult: { success: boolean; errors: Array<{ error: string }> };
    };
    expect(structured.compilationResult.success).toBe(false);
    expect(structured.compilationResult.errors[0]?.error).toContain("Compile timeout");
  });

  it("should have correct tool annotations", () => {
    expect(docLoadTool.annotations).toEqual({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
  });

  it("should have scope NS", () => {
    expect(docLoadTool.scope).toBe("NS");
  });

  it("should send file content as array of lines in PUT body", async () => {
    mockGlobSync.mockReturnValue(["c:/src/Test.cls"]);
    mockReadFileSync.mockReturnValue("Line 1\nLine 2\nLine 3");
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.cls" }));

    await docLoadTool.handler({ path: "c:/src/**/*.cls" }, ctx);

    const putBody = mockHttp.put.mock.calls[0]?.[1] as { enc: boolean; content: string[] };
    expect(putBody.enc).toBe(false);
    expect(putBody.content).toEqual(["Line 1", "Line 2", "Line 3"]);
  });
});

// ── extractDeclaredIdentity (Story 35.9) ──────────────────────────────

describe("extractDeclaredIdentity", () => {
  it("parses a simple Class declaration", () => {
    expect(extractDeclaredIdentity(["Class MyPkg.MyClass", "{", "}"])).toBe("MyPkg.MyClass");
  });

  it("parses a Class declaration with Extends and keywords", () => {
    expect(
      extractDeclaredIdentity(["Class MyPkg.MyClass Extends %Persistent [ Abstract ]", "{", "}"]),
    ).toBe("MyPkg.MyClass");
  });

  it("is case-insensitive on the Class keyword", () => {
    expect(extractDeclaredIdentity(["class MyPkg.Lower", "{", "}"])).toBe("MyPkg.Lower");
    expect(extractDeclaredIdentity(["CLASS MyPkg.Upper", "{", "}"])).toBe("MyPkg.Upper");
  });

  it("parses %-prefixed class names", () => {
    expect(extractDeclaredIdentity(["Class %Library.Persistent", "{", "}"])).toBe("%Library.Persistent");
  });

  it("parses a ROUTINE declaration", () => {
    expect(extractDeclaredIdentity(["ROUTINE MyHelper", " Write \"hi\",!"])).toBe("MyHelper");
  });

  it("parses a generated .int ROUTINE with a dotted name and [Type=...] suffix", () => {
    expect(
      extractDeclaredIdentity(["ROUTINE MyPkg.MyClass.1 [Type=INT]", " ; generated"]),
    ).toBe("MyPkg.MyClass.1");
  });

  it("is case-insensitive on the ROUTINE keyword", () => {
    expect(extractDeclaredIdentity(["routine MyPkg.Lower", " q"])).toBe("MyPkg.Lower");
  });

  it("does not match indented lines (method bodies)", () => {
    expect(extractDeclaredIdentity(["{", " Class NotADeclaration", "}"])).toBeUndefined();
  });

  it("does not match comment lines", () => {
    expect(extractDeclaredIdentity(["; Class Commented", "/// Class DocComment"])).toBeUndefined();
  });

  it("does not match ClassMethod (requires whitespace after the keyword)", () => {
    expect(extractDeclaredIdentity(["ClassMethod Foo() {}", "}"])).toBeUndefined();
  });

  it("returns undefined for headerless content (.inc fragments, headerless .mac)", () => {
    expect(extractDeclaredIdentity(["#define Foo 1"])).toBeUndefined();
    expect(extractDeclaredIdentity([" Write \"hello\",!"])).toBeUndefined();
  });
});

// ── iris_doc_load identity cross-validation + baseDir (Story 35.9) ────

describe("iris_doc_load identity cross-validation (Story 35.9)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
    vi.clearAllMocks();
  });

  it("refuses the transcript's exact trap-glob repro, naming BOTH names and both remedies, uploading nothing", async () => {
    // The exact repro shape from docs/bugs-2026-08-17.md: package directory
    // as a literal segment immediately before a trailing *.cls wildcard.
    mockGlobSync.mockReturnValue([
      "c:/src/ClineTest/Wumpus.cls",
      "c:/src/ClineTest/WumpusCave.cls",
    ]);
    mockReadFileSync
      .mockReturnValueOnce("Class ClineTest.Wumpus\n{\n}\n")
      .mockReturnValueOnce("Class ClineTest.WumpusCave\n{\n}\n");

    const result = await docLoadTool.handler(
      { path: "c:/src/ClineTest/*.cls", compile: true },
      ctx,
    );

    // Nothing uploaded, nothing compiled.
    expect(mockHttp.put).not.toHaveBeenCalled();
    expect(mockHttp.post).not.toHaveBeenCalled();

    const structured = result.structuredContent as {
      total: number;
      uploaded: number;
      failed: number;
      failures: Array<{ file: string; docName: string; error: string }>;
    };
    expect(structured.total).toBe(2);
    expect(structured.uploaded).toBe(0);
    expect(structured.failed).toBe(2);
    expect(result.isError).toBe(true);

    const err0 = structured.failures[0]?.error ?? "";
    expect(err0).toContain("'Wumpus.cls'"); // path-derived name
    expect(err0).toContain("'ClineTest.Wumpus'"); // content-declared name
    expect(err0).toContain("c:/src/**/*.cls"); // corrected-glob remedy
    expect(err0).toContain("baseDir='c:/src'"); // baseDir remedy
    expect(structured.failures[0]?.file).toBe("c:/src/ClineTest/Wumpus.cls");

    const err1 = structured.failures[1]?.error ?? "";
    expect(err1).toContain("'WumpusCave.cls'");
    expect(err1).toContain("'ClineTest.WumpusCave'");
  });

  it("uploads with the exact qualified doc names when the corrected glob is used", async () => {
    mockGlobSync.mockReturnValue([
      "c:/src/ClineTest/Wumpus.cls",
      "c:/src/ClineTest/WumpusCave.cls",
    ]);
    mockReadFileSync
      .mockReturnValueOnce("Class ClineTest.Wumpus\n{\n}\n")
      .mockReturnValueOnce("Class ClineTest.WumpusCave\n{\n}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ name: "ClineTest.Wumpus.cls", status: "OK", errors: [] }] }),
    );

    const result = await docLoadTool.handler(
      { path: "c:/src/**/*.cls", compile: true },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledTimes(2);
    expect(mockHttp.put.mock.calls[0]?.[0]).toContain("doc/ClineTest.Wumpus.cls");
    expect(mockHttp.put.mock.calls[1]?.[0]).toContain("doc/ClineTest.WumpusCave.cls");

    // Byte-exact computed names pinned via the compile payload (Rule #19 —
    // the omitted-baseDir inference must produce exactly these names).
    const compileBody = mockHttp.post.mock.calls[0]?.[1] as string[];
    expect(compileBody).toEqual(["ClineTest.Wumpus.cls", "ClineTest.WumpusCave.cls"]);

    const structured = result.structuredContent as {
      uploaded: number;
      failed: number;
      compilationResult: { documents: string[] };
    };
    expect(structured.uploaded).toBe(2);
    expect(structured.failed).toBe(0);
    expect(structured.compilationResult.documents).toEqual([
      "ClineTest.Wumpus.cls",
      "ClineTest.WumpusCave.cls",
    ]);
  });

  it("honors an explicit baseDir verbatim instead of glob-shape inference (trap glob becomes correct)", async () => {
    mockGlobSync.mockReturnValue([
      "c:/src/ClineTest/Wumpus.cls",
      "c:/src/ClineTest/WumpusCave.cls",
    ]);
    mockReadFileSync
      .mockReturnValueOnce("Class ClineTest.Wumpus\n{\n}\n")
      .mockReturnValueOnce("Class ClineTest.WumpusCave\n{\n}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));

    const result = await docLoadTool.handler(
      { path: "c:/src/ClineTest/*.cls", baseDir: "c:/src" },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledTimes(2);
    expect(mockHttp.put.mock.calls[0]?.[0]).toContain("doc/ClineTest.Wumpus.cls");
    expect(mockHttp.put.mock.calls[1]?.[0]).toContain("doc/ClineTest.WumpusCave.cls");
    expect(result.structuredContent).toMatchObject({ total: 2, uploaded: 2, failed: 0 });
  });

  it("normalizes backslashes and a trailing slash in an explicit baseDir", async () => {
    mockGlobSync.mockReturnValue(["c:/src/ClineTest/Wumpus.cls"]);
    mockReadFileSync.mockReturnValue("Class ClineTest.Wumpus\n{\n}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));

    await docLoadTool.handler(
      { path: "c:/src/ClineTest/*.cls", baseDir: "c:\\src\\" },
      ctx,
    );

    expect(mockHttp.put.mock.calls[0]?.[0]).toContain("doc/ClineTest.Wumpus.cls");
  });

  it("still refuses on divergence when baseDir is supplied (defense-in-depth, not a bypass)", async () => {
    mockGlobSync.mockReturnValue(["c:/src/ClineTest/Wumpus.cls"]);
    mockReadFileSync.mockReturnValue("Class ClineTest.Wumpus\n{\n}\n");

    const result = await docLoadTool.handler(
      { path: "c:/src/ClineTest/*.cls", baseDir: "c:/src/ClineTest" },
      ctx,
    );

    expect(mockHttp.put).not.toHaveBeenCalled();
    const structured = result.structuredContent as {
      uploaded: number;
      failed: number;
      failures: Array<{ error: string }>;
    };
    expect(structured.uploaded).toBe(0);
    expect(structured.failed).toBe(1);
    expect(structured.failures[0]?.error).toContain("'Wumpus.cls'");
    expect(structured.failures[0]?.error).toContain("'ClineTest.Wumpus'");
  });

  it("refuses a case-only divergence (comparison is exact; IRIS preserves case)", async () => {
    mockGlobSync.mockReturnValue(["c:/src/ClineTest/Wumpus.cls"]);
    mockReadFileSync.mockReturnValue("Class clinetest.wumpus\n{\n}\n");

    const result = await docLoadTool.handler({ path: "c:/src/**/*.cls" }, ctx);

    expect(mockHttp.put).not.toHaveBeenCalled();
    const structured = result.structuredContent as {
      failed: number;
      failures: Array<{ error: string }>;
    };
    expect(structured.failed).toBe(1);
    expect(structured.failures[0]?.error).toContain("'ClineTest.Wumpus.cls'");
    expect(structured.failures[0]?.error).toContain("'clinetest.wumpus'");
  });

  it("refuses a swapped-package divergence (derived PkgA.Foo, declared PkgB.Foo)", async () => {
    mockGlobSync.mockReturnValue(["c:/src/PkgA/Foo.cls"]);
    mockReadFileSync.mockReturnValue("Class PkgB.Foo\n{\n}\n");

    const result = await docLoadTool.handler({ path: "c:/src/**/*.cls" }, ctx);

    expect(mockHttp.put).not.toHaveBeenCalled();
    const structured = result.structuredContent as {
      failed: number;
      failures: Array<{ error: string }>;
    };
    expect(structured.failed).toBe(1);
    expect(structured.failures[0]?.error).toContain("'PkgA.Foo.cls'");
    expect(structured.failures[0]?.error).toContain("'PkgB.Foo'");
  });

  it("uploads no-identity files with pure path-derived naming (.inc fragment, headerless .mac, CSP)", async () => {
    mockGlobSync.mockReturnValue([
      "c:/src/My/Include.inc",
      "c:/src/My/Headerless.mac",
      "c:/src/csp/user/menu.csp",
    ]);
    mockReadFileSync
      .mockReturnValueOnce("#define Foo 1\n")
      .mockReturnValueOnce(" Write \"hello\",!\n")
      .mockReturnValueOnce("<html><body>hi</body></html>\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));

    const result = await docLoadTool.handler({ path: "c:/src/**/*.*" }, ctx);

    expect(mockHttp.put).toHaveBeenCalledTimes(3);
    expect(mockHttp.put.mock.calls[0]?.[0]).toContain("doc/My.Include.inc");
    expect(mockHttp.put.mock.calls[1]?.[0]).toContain("doc/My.Headerless.mac");
    expect(mockHttp.put.mock.calls[2]?.[0]).toContain("doc/csp.user.menu.csp");
    expect(result.structuredContent).toMatchObject({ total: 3, uploaded: 3, failed: 0 });
  });

  it("uploads a generated .int whose ROUTINE name carries dots and a [Type=...] suffix", async () => {
    mockGlobSync.mockReturnValue(["c:/src/MyPkg/MyClass.1.int"]);
    mockReadFileSync.mockReturnValue("ROUTINE MyPkg.MyClass.1 [Type=INT]\n ; generated\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));

    const result = await docLoadTool.handler({ path: "c:/src/**/*.int" }, ctx);

    expect(mockHttp.put).toHaveBeenCalledTimes(1);
    expect(mockHttp.put.mock.calls[0]?.[0]).toContain("doc/MyPkg.MyClass.1.int");
    expect(result.structuredContent).toMatchObject({ uploaded: 1, failed: 0 });
  });

  it("refuses a mismatched .int routine", async () => {
    mockGlobSync.mockReturnValue(["c:/src/MyPkg/MyClass.1.int"]);
    mockReadFileSync.mockReturnValue("ROUTINE Other.Thing.1 [Type=INT]\n");

    const result = await docLoadTool.handler({ path: "c:/src/**/*.int" }, ctx);

    expect(mockHttp.put).not.toHaveBeenCalled();
    expect(result.structuredContent).toMatchObject({ uploaded: 0, failed: 1 });
  });

  it("refuses only the diverging file in a mixed batch and compiles only the uploaded one", async () => {
    // Correct glob (wildcard before the package dir); the second file's
    // CONTENT disagrees with its path (declares a different package).
    mockGlobSync.mockReturnValue([
      "c:/src/ClineTest/Good.cls",
      "c:/src/ClineTest/Wumpus.cls",
    ]);
    mockReadFileSync
      .mockReturnValueOnce("Class ClineTest.Good\n{\n}\n")
      .mockReturnValueOnce("Class Other.Wumpus\n{\n}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ name: "ClineTest.Good.cls", status: "OK", errors: [] }] }),
    );

    // Glob is correct; the refusal is content-driven (Other.Wumpus declared
    // where the path implies ClineTest.Wumpus), not glob-shape-driven.
    const result = await docLoadTool.handler(
      { path: "c:/src/**/*.cls", compile: true },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledTimes(1);
    expect(mockHttp.put.mock.calls[0]?.[0]).toContain("doc/ClineTest.Good.cls");
    // Refused files never reach compile (the User-fallback error stays dead).
    const compileBody = mockHttp.post.mock.calls[0]?.[1] as string[];
    expect(compileBody).toEqual(["ClineTest.Good.cls"]);

    const structured = result.structuredContent as {
      total: number;
      uploaded: number;
      failed: number;
      failures: Array<{ error: string }>;
    };
    expect(structured.total).toBe(2);
    expect(structured.uploaded).toBe(1);
    expect(structured.failed).toBe(1);
    expect(structured.failures[0]?.error).toContain("'ClineTest.Wumpus.cls'");
    // Partial refusal with at least one upload is NOT a tool-level error
    // (existing isError convention: failures>0 && uploaded===0).
    expect(result.isError).toBe(false);
  });

  it("omitted baseDir keeps byte-identical glob-shape inference (Rule #19 pin on actual computed names)", async () => {
    mockGlobSync.mockReturnValue([
      "c:/projects/src/MyPkg/Sub/Deep.cls",
      "c:/projects/src/Top.cls",
    ]);
    mockReadFileSync
      .mockReturnValueOnce("Class MyPkg.Sub.Deep\n{\n}\n")
      .mockReturnValueOnce("Class Top\n{\n}\n");
    mockHttp.put.mockResolvedValue(envelope({ name: "ok" }));
    mockHttp.post.mockResolvedValue(
      envelope({ content: [{ name: "x", status: "OK", errors: [] }] }),
    );

    const result = await docLoadTool.handler(
      { path: "c:/projects/src/**/*.cls", compile: true },
      ctx,
    );

    // Assert the ACTUAL computed names, not the absence of errors.
    const structured = result.structuredContent as {
      compilationResult: { documents: string[] };
    };
    expect(structured.compilationResult.documents).toEqual([
      "MyPkg.Sub.Deep.cls",
      "Top.cls",
    ]);
  });
});

// ── QA adversarial parser edges (Story 35.9, qa-35-9) ─────────────────

describe("extractDeclaredIdentity — QA adversarial edges", () => {
  it("finds the declaration past /// doc comments and a /* banner */ (real UDL shape)", () => {
    // A real Studio/VSCode-exported .cls commonly opens with a block banner
    // and /// doc lines before the Class line; the parser must scan past them.
    expect(
      extractDeclaredIdentity([
        "/* -------------------------------------------",
        " * banner comment mentioning Class Nothing.Real",
        " * ------------------------------------------- */",
        "/// Doc comment for the class.",
        "/// Another doc line.",
        "Class MyPkg.Banner Extends %Persistent",
        "{",
        "}",
      ]),
    ).toBe("MyPkg.Banner");
  });

  it("accepts a TAB between the keyword and the name", () => {
    expect(extractDeclaredIdentity(["Class\tMyPkg.Tabbed", "{", "}"])).toBe("MyPkg.Tabbed");
  });

  it("parses the declaration past a leading UTF-8 BOM (35-9-QA-1)", () => {
    // A BOM-bearing .cls opens with U+FEFF immediately before "Class";
    // without the strip the ^Class anchor never matches and the
    // cross-check is silently SKIPPED.
    expect(extractDeclaredIdentity(["﻿Class MyPkg.Bom", "{", "}"])).toBe("MyPkg.Bom");
    expect(extractDeclaredIdentity(["﻿ROUTINE MyRtn", " q"])).toBe("MyRtn");
  });
});

describe("iris_doc_load — review-added adversarial edges (Story 35.9 code review)", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
    vi.clearAllMocks();
  });

  it("refuses a BOM-bearing file under a trap glob instead of silently skipping the cross-check (35-9-QA-1)", async () => {
    mockGlobSync.mockReturnValue(["c:/src/ClineTest/Wumpus.cls"]);
    mockReadFileSync.mockReturnValue("﻿Class ClineTest.Wumpus\n{\n}\n");

    const result = await docLoadTool.handler(
      { path: "c:/src/ClineTest/*.cls", compile: true },
      ctx,
    );

    expect(mockHttp.put).not.toHaveBeenCalled();
    expect(mockHttp.post).not.toHaveBeenCalled();
    const structured = result.structuredContent as {
      uploaded: number;
      failed: number;
      failures: Array<{ error: string }>;
    };
    expect(structured.uploaded).toBe(0);
    expect(structured.failed).toBe(1);
    expect(result.isError).toBe(true);
    expect(structured.failures[0]?.error).toContain("'Wumpus.cls'");
    expect(structured.failures[0]?.error).toContain("'ClineTest.Wumpus'");
  });

  it("suggests the PROVABLY-correct base for a nested-package trap (not the base's one-level parent)", async () => {
    // Trap glob with a TWO-level package: 'c:/src/Pkg/Sub/*.cls' swallows
    // Pkg/Sub. The old parent-of-base computation would have suggested
    // 'c:/src/Pkg/**/*.cls' — itself still trap-shaped for Pkg.Sub classes.
    mockGlobSync.mockReturnValue(["c:/src/Pkg/Sub/Foo.cls"]);
    mockReadFileSync.mockReturnValue("Class Pkg.Sub.Foo\n{\n}\n");

    const result = await docLoadTool.handler({ path: "c:/src/Pkg/Sub/*.cls" }, ctx);

    expect(mockHttp.put).not.toHaveBeenCalled();
    const structured = result.structuredContent as {
      failures: Array<{ error: string }>;
    };
    const err = structured.failures[0]?.error ?? "";
    expect(err).toContain("c:/src/**/*.cls"); // provably-correct corrected glob
    expect(err).toContain("baseDir='c:/src'"); // provably-correct baseDir
    expect(err).not.toContain("c:/src/Pkg/**"); // the still-trap-shaped old suggestion
  });

  it("does NOT blame the glob shape for a content-driven mismatch (swapped package)", async () => {
    // Correct glob; the CONTENT disagrees with the path. The message must not
    // claim the base swallowed a package directory nor suggest a recomputed
    // base (for a correct glob the old code suggested garbage like 'c:/**').
    mockGlobSync.mockReturnValue(["c:/src/PkgA/Foo.cls"]);
    mockReadFileSync.mockReturnValue("Class PkgB.Foo\n{\n}\n");

    const result = await docLoadTool.handler({ path: "c:/src/**/*.cls" }, ctx);

    expect(mockHttp.put).not.toHaveBeenCalled();
    const structured = result.structuredContent as {
      failures: Array<{ error: string }>;
    };
    const err = structured.failures[0]?.error ?? "";
    expect(err).toContain("'PkgA.Foo.cls'");
    expect(err).toContain("'PkgB.Foo'");
    expect(err).not.toContain("swallowed the package directory");
    expect(err).toContain("fix the declaration or move the file");
    expect(err).toContain("baseDir");
  });
});

describe("iris_doc_load — QA adversarial edges", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
    vi.clearAllMocks();
  });

  it("a baseDir that does not match the glob's files replaces inference and is caught by the cross-check", async () => {
    // baseDir wins over glob-shape inference for NAME MAPPING (the glob alone
    // still decides WHICH files match). A baseDir that is not a prefix of the
    // matched file's path leaves the whole path in the derived doc name —
    // and the cross-check refuses it against the content declaration, so a
    // wrong baseDir cannot silently upload under a garbage dotted-path name.
    mockGlobSync.mockReturnValue(["c:/src/ClineTest/Wumpus.cls"]);
    mockReadFileSync.mockReturnValue("Class ClineTest.Wumpus\n{\n}\n");

    const result = await docLoadTool.handler(
      { path: "c:/src/ClineTest/*.cls", baseDir: "c:/elsewhere" },
      ctx,
    );

    expect(mockHttp.put).not.toHaveBeenCalled();
    const structured = result.structuredContent as {
      uploaded: number;
      failed: number;
      failures: Array<{ docName: string; error: string }>;
    };
    expect(structured.uploaded).toBe(0);
    expect(structured.failed).toBe(1);
    expect(structured.failures[0]?.docName).toBe("c:.src.ClineTest.Wumpus.cls");
    expect(structured.failures[0]?.error).toContain("'ClineTest.Wumpus'");
  });
});

// ── Rework iteration 1: BOM normalization + string-status failure ──────
//
// Lead smoke (2026-08-18) found two silent-drop legs the parse-side BOM fix
// did not close: (1) a BOM-bearing .cls under a CORRECT glob passed the
// cross-check but the uploaded content still carried the BOM, which the
// server rejects as ERROR #16021 (illegal header line) while storing
// NOTHING; (2) that per-doc error arrives as a string-typed `result.status`
// on an HTTP-200 PUT with an empty `status.errors` envelope, which the
// shared HTTP client never throws on (35-9-DEV-1) — so the loader counted
// the file as uploaded. Both envelope shapes below are LIVE CAPTURES from
// this instance (Atelier v8, HSCUSTOM, 2026-08-18) via a disposable
// IrisHttpClient probe (PUT /api/atelier/v8/HSCUSTOM/doc/<name>?ignoreConflict=1):
//   success: result.status === "" (plus populated db/ts fields)
//   BOM failure: result.status === 'ERROR #16021: Illegal Header Line: <U+FEFF>Class ProbeR359.Bom'
//     (the status text echoes the BOM'd first line) and the follow-up DELETE
//     404'd — the server had stored nothing.
// The fixture name/shape mirrors that capture verbatim (Rule #36/#54).

describe("iris_doc_load — BOM strip + string-status failure (Story 35.9 rework)", () => {
  const BOM = "﻿";

  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
    vi.clearAllMocks();
  });

  it("strips a leading UTF-8 BOM from the uploaded content (wire body carries no BOM)", async () => {
    mockGlobSync.mockReturnValue(["c:/src/MyPkg/Bom.cls"]);
    mockReadFileSync.mockReturnValue(BOM + "Class MyPkg.Bom\n{\n}\n");
    // Live-captured success envelope shape (see block comment above).
    mockHttp.put.mockResolvedValue(
      envelope({ name: "MyPkg.Bom.cls", db: "HSCUSTOM", ts: "2026-08-18 22:43:09.313", upd: false, cat: "CLS", status: "", enc: false, flags: 0, content: [] }),
    );

    const result = await docLoadTool.handler({ path: "c:/src/**/*.cls" }, ctx);

    expect(mockHttp.put).toHaveBeenCalledTimes(1);
    const putBody = mockHttp.put.mock.calls[0]?.[1] as { enc: boolean; content: string[] };
    // The wire body's first line is BOM-free; the rest is untouched
    // (trailing "" from the fixture's final newline).
    expect(putBody.content).toEqual(["Class MyPkg.Bom", "{", "}", ""]);
    expect(putBody.content[0]?.charCodeAt(0)).not.toBe(0xfeff);
    expect(result.structuredContent).toMatchObject({ total: 1, uploaded: 1, failed: 0 });
  });

  it("treats a non-empty string-typed result.status on the PUT response as an upload FAILURE (35-9-DEV-1)", async () => {
    mockGlobSync.mockReturnValue(["c:/src/ProbeR359/Bom.cls"]);
    // Identity cross-check passes (declaration matches the path); the failure
    // comes from the SERVER's per-doc status on an HTTP-200 response.
    mockReadFileSync.mockReturnValue("Class ProbeR359.Bom\n{\n}\n");
    // EXACT live-captured failure envelope (see block comment above): HTTP 200,
    // envelope.status.errors empty, per-doc error as a string result.status.
    mockHttp.put.mockResolvedValue(
      envelope({ name: "ProbeR359.Bom.cls", db: "", ts: "", cat: "CLS", enc: false, content: "", status: "ERROR #16021: Illegal Header Line: ﻿Class ProbeR359.Bom" }),
    );

    const result = await docLoadTool.handler(
      { path: "c:/src/**/*.cls", compile: true },
      ctx,
    );

    // The PUT was issued (HTTP-level success) but must NOT count as uploaded,
    // and the failed file must never reach compile.
    expect(mockHttp.put).toHaveBeenCalledTimes(1);
    expect(mockHttp.post).not.toHaveBeenCalled();
    const structured = result.structuredContent as {
      uploaded: number;
      failed: number;
      failures: Array<{ docName: string; error: string }>;
    };
    expect(structured.uploaded).toBe(0);
    expect(structured.failed).toBe(1);
    expect(structured.failures[0]?.docName).toBe("ProbeR359.Bom.cls");
    expect(structured.failures[0]?.error).toContain("ERROR #16021: Illegal Header Line");
    expect(result.isError).toBe(true);
  });

  it("counts a PUT whose result.status is an empty string as success (live-captured success shape)", async () => {
    // Pins the check against the REAL success shape so it cannot
    // false-positive: a successful PUT carries result.status === "".
    mockGlobSync.mockReturnValue(["c:/src/ProbeR359/Ok.cls"]);
    mockReadFileSync.mockReturnValue("Class ProbeR359.Ok\n{\n}\n");
    mockHttp.put.mockResolvedValue(
      envelope({ name: "ProbeR359.Ok.cls", db: "HSCUSTOM", ts: "2026-08-18 22:43:09.313", upd: false, cat: "CLS", status: "", enc: false, flags: 0, content: [] }),
    );

    const result = await docLoadTool.handler({ path: "c:/src/**/*.cls" }, ctx);

    expect(result.structuredContent).toMatchObject({ uploaded: 1, failed: 0 });
    expect(result.isError).toBeFalsy();
  });
});
