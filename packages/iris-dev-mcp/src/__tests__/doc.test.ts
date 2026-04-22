import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolContext, HeadResponse } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import { docGetTool, docPutTool, docDeleteTool, docListTool, validateDocName } from "../tools/doc.js";
import { createMockHttp, createMockCtx, envelope } from "./test-helpers.js";

// ── Local helpers ───────────────────────────────────────────────────

/** Create a mock HeadResponse with optional headers. */
function headResponse(
  status: number,
  headerEntries: Record<string, string> = {},
): HeadResponse {
  const headers = new Headers(headerEntries);
  return { status, headers };
}

// ── iris_doc_get ────────────────────────────────────────────────────

describe("iris_doc_get", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should retrieve document content as text", async () => {
    const docContent = {
      name: "MyApp.Service.cls",
      content: ["Class MyApp.Service {", "}"],
    };
    mockHttp.get.mockResolvedValue(envelope(docContent));

    const result = await docGetTool.handler(
      { name: "MyApp.Service.cls" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/MyApp.Service.cls",
    );
    expect(result.content[0]?.text).toContain("MyApp.Service.cls");
    expect(result.structuredContent).toEqual(docContent);
    expect(result.isError).toBeUndefined();
  });

  it("should pass format=xml as query parameter", async () => {
    mockHttp.get.mockResolvedValue(envelope({ name: "Test.cls", content: [] }));

    await docGetTool.handler(
      { name: "Test.cls", format: "xml" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/Test.cls?format=xml",
    );
  });

  it("should use namespace override when provided", async () => {
    mockHttp.get.mockResolvedValue(envelope({ name: "Test.cls", content: [] }));

    await docGetTool.handler(
      { name: "Test.cls", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/doc/Test.cls",
    );
  });

  it("should return isError: true with descriptive message on 404", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(404, [], "/api/atelier/v7/USER/doc/Missing.cls"),
    );

    const result = await docGetTool.handler(
      { name: "Missing.cls" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      "Document 'Missing.cls' not found in namespace 'USER'",
    );
  });

  it("should re-throw non-404 errors", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [], "/api/atelier/v7/USER/doc/Broken.cls"),
    );

    await expect(
      docGetTool.handler({ name: "Broken.cls" }, ctx),
    ).rejects.toThrow(IrisApiError);
  });

  // ── metadataOnly mode ───────────────────────────────────────────

  it("should call HEAD and return exists/timestamp when metadataOnly=true", async () => {
    mockHttp.head.mockResolvedValue(
      headResponse(200, {
        "Last-Modified": "Sat, 05 Apr 2026 12:00:00 GMT",
        "ETag": '"abc123"',
      }),
    );

    const result = await docGetTool.handler(
      { name: "MyApp.Service.cls", metadataOnly: true },
      ctx,
    );

    expect(mockHttp.head).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/MyApp.Service.cls",
    );
    expect(mockHttp.get).not.toHaveBeenCalled();
    expect(result.structuredContent).toEqual({
      exists: true,
      name: "MyApp.Service.cls",
      timestamp: "Sat, 05 Apr 2026 12:00:00 GMT",
      etag: '"abc123"',
    });
    expect(result.isError).toBeUndefined();
  });

  it("should return exists=false with isError=false on 404 when metadataOnly=true", async () => {
    mockHttp.head.mockRejectedValue(
      new IrisApiError(404, [], "/api/atelier/v7/USER/doc/Missing.cls"),
    );

    const result = await docGetTool.handler(
      { name: "Missing.cls", metadataOnly: true },
      ctx,
    );

    expect(result.structuredContent).toEqual({
      exists: false,
      name: "Missing.cls",
    });
    expect(result.isError).toBe(false);
  });

  it("should re-throw non-404 errors in metadataOnly mode", async () => {
    mockHttp.head.mockRejectedValue(
      new IrisApiError(500, [], "/api/atelier/v7/USER/doc/Broken.cls"),
    );

    await expect(
      docGetTool.handler({ name: "Broken.cls", metadataOnly: true }, ctx),
    ).rejects.toThrow(IrisApiError);
  });

  it("should handle missing Last-Modified and ETag headers in metadataOnly mode", async () => {
    mockHttp.head.mockResolvedValue(headResponse(200, {}));

    const result = await docGetTool.handler(
      { name: "MyApp.Service.cls", metadataOnly: true },
      ctx,
    );

    expect(result.structuredContent).toEqual({
      exists: true,
      name: "MyApp.Service.cls",
      timestamp: undefined,
      etag: undefined,
    });
  });

  it("should still use GET when metadataOnly is not set (regression)", async () => {
    const docContent = { name: "Test.cls", content: ["Class Test {}"] };
    mockHttp.get.mockResolvedValue(envelope(docContent));

    await docGetTool.handler({ name: "Test.cls" }, ctx);

    expect(mockHttp.get).toHaveBeenCalled();
    expect(mockHttp.head).not.toHaveBeenCalled();
  });
});

// ── iris_doc_put ────────────────────────────────────────────────────

describe("iris_doc_put", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send correct PUT body with content lines array", async () => {
    const lines = ["Class MyApp.Service {", "}"];
    mockHttp.put.mockResolvedValue(envelope({ name: "MyApp.Service.cls" }));

    const result = await docPutTool.handler(
      { name: "MyApp.Service.cls", content: lines },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/MyApp.Service.cls",
      { enc: false, content: lines },
    );
    expect(result.content[0]?.text).toContain("saved successfully");
    expect(result.isError).toBeUndefined();
  });

  it("should split string content into lines", async () => {
    const content = "Class MyApp.Service {\n  Property Name As %String;\n}";
    mockHttp.put.mockResolvedValue(envelope({ name: "MyApp.Service.cls" }));

    await docPutTool.handler(
      { name: "MyApp.Service.cls", content },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/MyApp.Service.cls",
      {
        enc: false,
        content: [
          "Class MyApp.Service {",
          "  Property Name As %String;",
          "}",
        ],
      },
    );
  });

  it("should pass ignoreConflict as query parameter", async () => {
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.cls" }));

    await docPutTool.handler(
      { name: "Test.cls", content: ["// test"], ignoreConflict: true },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/Test.cls?ignoreConflict=1",
      { enc: false, content: ["// test"] },
    );
  });

  it("should propagate connection errors", async () => {
    mockHttp.put.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      docPutTool.handler({ name: "Test.cls", content: "test" }, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should use namespace override when provided", async () => {
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.cls" }));

    await docPutTool.handler(
      { name: "Test.cls", content: "test", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledWith(
      "/api/atelier/v7/HSCUSTOM/doc/Test.cls",
      { enc: false, content: ["test"] },
    );
  });
});

// ── iris_doc_delete ─────────────────────────────────────────────────

describe("iris_doc_delete", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should send DELETE to correct path for single document", async () => {
    mockHttp.delete.mockResolvedValue(envelope(null));

    const result = await docDeleteTool.handler(
      { name: "MyApp.Service.cls" },
      ctx,
    );

    expect(mockHttp.delete).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/MyApp.Service.cls",
    );
    expect(result.content[0]?.text).toContain("deleted");
    expect(result.content[0]?.text).toContain("MyApp.Service.cls");
  });

  it("should delete each document individually for multiple docs", async () => {
    mockHttp.delete.mockResolvedValue(envelope(null));

    const names = ["One.cls", "Two.cls", "Three.cls"];
    const result = await docDeleteTool.handler({ name: names }, ctx);

    expect(mockHttp.delete).toHaveBeenCalledTimes(3);
    expect(mockHttp.delete).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/One.cls",
    );
    expect(mockHttp.delete).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/Two.cls",
    );
    expect(mockHttp.delete).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/Three.cls",
    );
    expect(result.content[0]?.text).toContain("3 document(s) deleted");
  });

  it("should report partial failure in batch delete", async () => {
    mockHttp.delete
      .mockResolvedValueOnce(envelope(null))
      .mockRejectedValueOnce(new IrisApiError(404, [], "/api/atelier/v7/USER/doc/Missing.cls"))
      .mockResolvedValueOnce(envelope(null));

    const names = ["One.cls", "Missing.cls", "Three.cls"];
    const result = await docDeleteTool.handler({ name: names }, ctx);

    expect(result.content[0]?.text).toContain("2 document(s) deleted");
    expect(result.content[0]?.text).toContain("1 document(s) failed");
    expect(result.content[0]?.text).toContain("Missing.cls");
    expect(result.isError).toBe(true);
  });

  it("should propagate errors for single-doc delete", async () => {
    mockHttp.delete.mockRejectedValue(
      new IrisApiError(500, [], "/api/atelier/v7/USER/doc/Broken.cls"),
    );

    await expect(
      docDeleteTool.handler({ name: "Broken.cls" }, ctx),
    ).rejects.toThrow(IrisApiError);
  });

  it("should handle empty name array gracefully", async () => {
    const result = await docDeleteTool.handler({ name: [] }, ctx);

    expect(mockHttp.delete).not.toHaveBeenCalled();
    expect(result.content[0]?.text).toBe("No documents specified for deletion.");
  });
});

// ── iris_doc_list ───────────────────────────────────────────────────

describe("iris_doc_list", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should return all documents with default category and type", async () => {
    const docs = [
      { name: "MyApp.Service.cls", cat: "CLS" },
      { name: "MyApp.Utils.cls", cat: "CLS" },
    ];
    mockHttp.get.mockResolvedValue(envelope(docs));

    const result = await docListTool.handler({}, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/docnames/*/*",
    );
    expect(result.structuredContent).toEqual({ items: docs });
    expect(result.isError).toBeUndefined();
  });

  it("should pass category filter to endpoint", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docListTool.handler({ category: "CLS" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/docnames/CLS/*",
    );
  });

  it("should pass type filter to endpoint", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docListTool.handler({ category: "CLS", type: "cls" }, ctx);

    expect(mockHttp.get).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/docnames/CLS/cls",
    );
  });

  it("should pass filter and generated query parameters", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docListTool.handler(
      { filter: "MyApp.*", generated: true },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("/docnames/*/");
    expect(calledPath).toContain("filter=MyApp.*");
    expect(calledPath).toContain("generated=1");
  });

  it("should return empty items for empty result (not error)", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    const result = await docListTool.handler({}, ctx);

    expect(result.structuredContent).toEqual({ items: [] });
    expect(result.isError).toBeUndefined();
  });

  // ── modifiedSince mode ──────────────────────────────────────────

  it("should call modified endpoint when modifiedSince is provided", async () => {
    const modifiedDocs = [
      { name: "MyApp.Updated.cls", ts: "2026-04-05T12:00:00Z" },
    ];
    mockHttp.get.mockResolvedValue(envelope(modifiedDocs));

    const result = await docListTool.handler(
      { modifiedSince: "2026-04-05T00:00:00Z" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      `/api/atelier/v7/USER/modified/${encodeURIComponent("2026-04-05T00:00:00Z")}`,
    );
    expect(result.structuredContent).toEqual({ items: modifiedDocs });
    expect(result.isError).toBeUndefined();
  });

  it("should use namespace override with modifiedSince", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docListTool.handler(
      { modifiedSince: "2026-04-01T00:00:00Z", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      `/api/atelier/v7/HSCUSTOM/modified/${encodeURIComponent("2026-04-01T00:00:00Z")}`,
    );
  });

  it("includes generated=0 on /modified/ branch when modifiedSince and generated:false are both set", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docListTool.handler(
      { modifiedSince: "2026-04-05T00:00:00Z", generated: false },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain(
      `/modified/${encodeURIComponent("2026-04-05T00:00:00Z")}`,
    );
    expect(calledPath).toContain("generated=0");
  });

  it("omits generated query param on /modified/ branch when generated is undefined", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docListTool.handler(
      { modifiedSince: "2026-04-05T00:00:00Z" },
      ctx,
    );

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain(
      `/modified/${encodeURIComponent("2026-04-05T00:00:00Z")}`,
    );
    expect(calledPath).not.toContain("generated=");
  });

  it("should pass generated=0 when generated is false", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docListTool.handler({ generated: false }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("generated=0");
  });

  it("should propagate connection errors", async () => {
    mockHttp.get.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      docListTool.handler({}, ctx),
    ).rejects.toThrow("ECONNREFUSED");
  });

  it("should still call docnames when modifiedSince is not set (regression)", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docListTool.handler({ category: "CLS" }, ctx);

    const calledPath = mockHttp.get.mock.calls[0]?.[0] as string;
    expect(calledPath).toContain("/docnames/");
    expect(calledPath).not.toContain("/modified/");
  });

  // ── Real Atelier envelope shape regression ──────────────────────
  // Production Atelier returns docnames as { result: { content: [...] } }
  // rather than { result: [...] }. The extractAtelierContentArray helper
  // in doc.ts must unwrap the content field. This test prevents the
  // "silently returns empty" bug found in 2026-04-10 smoke testing.

  it("should unwrap result.content for /docnames (real Atelier shape)", async () => {
    const docs = [
      { name: "MyApp.Service.cls", cat: "CLS", ts: "2026-04-05 12:00:00", db: "USER", upd: true, gen: false },
      { name: "MyApp.Utils.cls", cat: "CLS", ts: "2026-04-05 12:00:01", db: "USER", upd: true, gen: false },
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await docListTool.handler({ category: "CLS" }, ctx);

    expect(result.structuredContent).toEqual({ items: docs });
    expect(result.isError).toBeUndefined();
  });

  it("should unwrap result.content for /modified (real Atelier shape)", async () => {
    const docs = [
      { name: "MyApp.Updated.cls", ts: "2026-04-05T12:00:00Z" },
    ];
    mockHttp.get.mockResolvedValue(envelope({ content: docs }));

    const result = await docListTool.handler(
      { modifiedSince: "2026-04-05T00:00:00Z" },
      ctx,
    );

    expect(result.structuredContent).toEqual({ items: docs });
    expect(result.isError).toBeUndefined();
  });

  it("should return empty items when result.content is missing or empty", async () => {
    mockHttp.get.mockResolvedValue(envelope({ content: [] }));

    const result = await docListTool.handler({}, ctx);

    expect(result.structuredContent).toEqual({ items: [] });
    expect(result.isError).toBeUndefined();
  });
});

// ── validateDocName ──────────────────────────────────────────────────

describe("validateDocName", () => {
  it("should accept valid document names", () => {
    expect(validateDocName("MyApp.Service.cls")).toBeUndefined();
    expect(validateDocName("%UnitTest.TestCase.cls")).toBeUndefined();
    expect(validateDocName("User.cls")).toBeUndefined();
  });

  it("should reject names containing '..'", () => {
    const error = validateDocName("../../etc/passwd");
    expect(error).toBeDefined();
    expect(error).toContain("path traversal");
  });

  it("should reject names starting with '/'", () => {
    const error = validateDocName("/etc/passwd.cls");
    expect(error).toBeDefined();
    expect(error).toContain("must not start with '/'");
  });

  it("should reject names with embedded '..'", () => {
    const error = validateDocName("MyApp..Sneaky.cls");
    expect(error).toBeDefined();
    expect(error).toContain("path traversal");
  });
});

// ── Document name validation in tool handlers ────��───────────────────

describe("document name validation in handlers", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("docGetTool should reject path traversal names", async () => {
    const result = await docGetTool.handler(
      { name: "../../etc/passwd" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("path traversal");
    expect(mockHttp.get).not.toHaveBeenCalled();
  });

  it("docPutTool should reject path traversal names", async () => {
    const result = await docPutTool.handler(
      { name: "../sneaky.cls", content: "Class Sneaky {}" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("path traversal");
    expect(mockHttp.put).not.toHaveBeenCalled();
  });

  it("docDeleteTool should reject path traversal names", async () => {
    const result = await docDeleteTool.handler(
      { name: "../../etc/passwd" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("path traversal");
    expect(mockHttp.delete).not.toHaveBeenCalled();
  });

  it("docGetTool should reject names starting with /", async () => {
    const result = await docGetTool.handler(
      { name: "/absolute/path.cls" },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("must not start with '/'");
    expect(mockHttp.get).not.toHaveBeenCalled();
  });
});
