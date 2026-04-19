import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { docLoadTool, filePathToDocName, extractBaseDir } from "../tools/load.js";
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
    mockReadFileSync.mockReturnValue("Class MyPkg.ClassA {}\n");
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
