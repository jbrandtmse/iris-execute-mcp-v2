import { describe, it, expect, beforeEach } from "vitest";
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

  // Atelier answers a HEAD with only `ETag` (the document's `ts`), never `Last-Modified`.
  it("should call HEAD and return exists/etag when metadataOnly=true", async () => {
    mockHttp.head.mockResolvedValue(
      headResponse(200, {
        "ETag": "2026-04-05 12:00:00.123",
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
    expect(result.structuredContent).toStrictEqual({
      exists: true,
      name: "MyApp.Service.cls",
      etag: "2026-04-05 12:00:00.123",
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

  it("should handle a missing ETag header in metadataOnly mode, and never report a timestamp", async () => {
    mockHttp.head.mockResolvedValue(headResponse(200, {}));

    const result = await docGetTool.handler(
      { name: "MyApp.Service.cls", metadataOnly: true },
      ctx,
    );

    expect(result.structuredContent).toEqual({
      exists: true,
      name: "MyApp.Service.cls",
    });
    expect(Object.keys(result.structuredContent as object)).not.toContain("timestamp");
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

  // A routine: a class put with ignoreConflict is sent without the flag first (doc-put-storage-guard.test.ts),
  // so the query-parameter pin needs a document type that is never guarded.
  it("should pass ignoreConflict as query parameter", async () => {
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.mac" }));

    await docPutTool.handler(
      { name: "Test.mac", content: ["// test"], ignoreConflict: true },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledWith(
      "/api/atelier/v7/USER/doc/Test.mac?ignoreConflict=1",
      { enc: false, content: ["// test"] },
    );
  });

  // Result shapes below were captured live on 2026-10-15 (IRIS 2026.2, Atelier
  // v8, HSCUSTOM) from `PUT .../doc/ExecuteMCPv2.Temp.Story380Bom.cls`: a
  // BOM-prefixed first line is refused with HTTP 200 / empty `status.errors`
  // and a string `result.status`; the same document without the BOM is
  // accepted with `result.status === ""`.
  const LIVE_REFUSED_RESULT = {
    name: "ExecuteMCPv2.Temp.Story380Bom.cls",
    db: "",
    ts: "",
    cat: "CLS",
    enc: false,
    content: "",
    status:
      "ERROR #16021: Illegal Header Line: \uFEFFClass ExecuteMCPv2.Temp.Story380Bom Extends %RegisteredObject",
  };
  const LIVE_ACCEPTED_RESULT = {
    name: "ExecuteMCPv2.Temp.Story380Bom.cls",
    db: "HSCUSTOM",
    ts: "2026-10-15 12:25:56.148",
    upd: false,
    cat: "CLS",
    status: "",
    enc: false,
    flags: 0,
    content: [],
  };

  it("strips a leading BOM from string content before the PUT", async () => {
    mockHttp.put.mockResolvedValue(envelope(LIVE_ACCEPTED_RESULT));

    await docPutTool.handler(
      { name: "Test.cls", content: "\uFEFFClass Test {\n}" },
      ctx,
    );

    const body = mockHttp.put.mock.calls[0]?.[1] as { content: string[] };
    expect(body.content).toEqual(["Class Test {", "}"]);
    expect(body.content[0]?.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("strips a leading BOM from array content without mutating the caller's array", async () => {
    mockHttp.put.mockResolvedValue(envelope(LIVE_ACCEPTED_RESULT));
    const callerLines = ["\uFEFFClass Test {", "}"];

    await docPutTool.handler({ name: "Test.cls", content: callerLines }, ctx);

    const body = mockHttp.put.mock.calls[0]?.[1] as { content: string[] };
    expect(body.content).toEqual(["Class Test {", "}"]);
    expect(callerLines).toEqual(["\uFEFFClass Test {", "}"]);
  });

  it("returns isError with the status text when IRIS refuses the document", async () => {
    mockHttp.put.mockResolvedValue(envelope(LIVE_REFUSED_RESULT));

    const result = await docPutTool.handler(
      { name: "ExecuteMCPv2.Temp.Story380Bom.cls", content: "Class X {}" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe(
      `Document 'ExecuteMCPv2.Temp.Story380Bom.cls' was not saved in namespace 'USER': ${LIVE_REFUSED_RESULT.status}. Nothing was stored; correct the document text and retry.`,
    );
    expect(result.content[0]?.text).not.toContain("saved successfully");
    expect(result.structuredContent).toEqual(LIVE_REFUSED_RESULT);
  });

  it("keeps the success response byte-identical when status is an empty string", async () => {
    mockHttp.put.mockResolvedValue(envelope(LIVE_ACCEPTED_RESULT));

    const result = await docPutTool.handler(
      { name: "ExecuteMCPv2.Temp.Story380Bom.cls", content: "Class X {}" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toEqual([
      {
        type: "text",
        text: "Document 'ExecuteMCPv2.Temp.Story380Bom.cls' saved successfully in namespace 'USER'.",
      },
    ]);
    expect(result.structuredContent).toEqual(LIVE_ACCEPTED_RESULT);
  });

  it("keeps the success response when the result carries no status field", async () => {
    mockHttp.put.mockResolvedValue(envelope({ name: "Test.cls" }));

    const result = await docPutTool.handler(
      { name: "Test.cls", content: "Class X {}" },
      ctx,
    );

    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(
      "Document 'Test.cls' saved successfully in namespace 'USER'.",
    );
  });

  it("description documents the BOM strip and the error returned for a refused write", () => {
    const desc = docPutTool.description ?? "";
    expect(desc).toContain("A leading byte-order mark is stripped from the content before it is sent");
    expect(desc).toContain("is returned as an error carrying IRIS's text; nothing is stored then");
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

  // modifiedSince is refused (Story 38.7, DW-528)

  it("refuses a non-empty modifiedSince with the unsupported text, no code and no HTTP request", async () => {
    const result = await docListTool.handler(
      { modifiedSince: "2026-04-05T00:00:00Z", namespace: "HSCUSTOM", generated: false, category: "CLS" },
      ctx,
    );

    expect(mockHttp.get).not.toHaveBeenCalled();
    expect(mockHttp.head).not.toHaveBeenCalled();
    expect(result).toStrictEqual({
      content: [
        {
          type: "text",
          text:
            "modifiedSince is not supported, so nothing was listed: IRIS has no way to list documents changed since a timestamp " +
            "(its change list works from a database hash). " +
            "Omit modifiedSince; to find recent changes, list the documents with iris_doc_list and compare each one's ts.",
        },
      ],
      isError: true,
    });
    expect(result.structuredContent).toBeUndefined();
  });

  it("an empty or absent modifiedSince is the unchanged docnames request", async () => {
    mockHttp.get.mockResolvedValue(envelope([]));

    await docListTool.handler({ modifiedSince: "", category: "CLS", generated: true }, ctx);
    await docListTool.handler({ category: "CLS", generated: true }, ctx);

    expect(mockHttp.get.mock.calls).toEqual([
      ["/api/atelier/v7/USER/docnames/CLS/*?generated=1"],
      ["/api/atelier/v7/USER/docnames/CLS/*?generated=1"],
    ]);
  });

  it("the modifiedSince description says the parameter is not supported and what to do instead", () => {
    const shape = docListTool.inputSchema.shape as Record<string, { description?: string }>;

    expect(shape.modifiedSince?.description).toBe(
      "Not supported: IRIS cannot filter documents by modification time, so a call that sets it is refused " +
        "and changes nothing; compare the ts of the documents iris_doc_list returns instead.",
    );
    expect(docListTool.description).not.toContain("modifiedSince");
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
