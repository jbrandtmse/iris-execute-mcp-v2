import { describe, it, expect, beforeEach } from "vitest";
import type { ToolContext } from "@iris-mcp/shared";
import { IrisApiError } from "@iris-mcp/shared";
import {
  docdbManageTool,
  docdbDocumentTool,
  docdbFindTool,
  docdbPropertyTool,
  buildDocDbRestriction,
} from "../tools/docdb.js";
import {
  createMockHttp,
  createMockCtx,
  envelope,
} from "@iris-mcp/shared/test-helpers";

// ── iris_docdb_manage ──────────────────────────────────────────

describe("iris_docdb_manage", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NS", () => {
    expect(docdbManageTool.scope).toBe("NS");
  });

  it("should have destructiveHint annotation", () => {
    expect(docdbManageTool.annotations.destructiveHint).toBe(true);
  });

  it("should list databases via GET", async () => {
    const dbList = ["TestDB", "MyDocDB"];
    mockHttp.get.mockResolvedValue(envelope(dbList));

    const result = await docdbManageTool.handler(
      { action: "list" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ items: dbList, count: 2 });
  });

  it("should list databases with custom namespace", async () => {
    const dbList = ["DB1"];
    mockHttp.get.mockResolvedValue(envelope(dbList));

    await docdbManageTool.handler(
      { action: "list", namespace: "HSCUSTOM" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/HSCUSTOM"),
    );
  });

  it("should create a database via POST", async () => {
    const created = { database: "NewDB", status: "created" };
    mockHttp.post.mockResolvedValue(envelope(created));

    const result = await docdbManageTool.handler(
      { action: "create", database: "NewDB" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/db/NewDB"),
      {},
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(created);
  });

  it("should return error when create is called without database", async () => {
    const result = await docdbManageTool.handler(
      { action: "create" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'database' is required");
  });

  it("should drop a database via DELETE", async () => {
    const dropped = { database: "OldDB", status: "dropped" };
    mockHttp.delete.mockResolvedValue(envelope(dropped));

    const result = await docdbManageTool.handler(
      { action: "drop", database: "OldDB" },
      ctx,
    );

    expect(mockHttp.delete).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/db/OldDB"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(dropped);
  });

  it("should return error when drop is called without database", async () => {
    const result = await docdbManageTool.handler(
      { action: "drop" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'database' is required");
  });

  it("should handle IrisApiError gracefully", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(500, [], "/api/docdb/v1/USER", "Internal error"),
    );

    const result = await docdbManageTool.handler(
      { action: "list" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error managing DocDB database");
  });

  it("should rethrow non-IrisApiError errors", async () => {
    mockHttp.get.mockRejectedValue(new Error("Network failure"));

    await expect(
      docdbManageTool.handler({ action: "list" }, ctx),
    ).rejects.toThrow("Network failure");
  });

  it("should encode special characters in namespace and database", async () => {
    mockHttp.post.mockResolvedValue(envelope({ status: "ok" }));

    await docdbManageTool.handler(
      { action: "create", database: "my db", namespace: "NS/special" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("NS/special")),
      {},
    );
  });

  it("should handle non-envelope DocDB response (no .result property)", async () => {
    // DocDB API may return plain JSON without Atelier envelope
    const plainResponse = ["DB1", "DB2"];
    mockHttp.get.mockResolvedValue(plainResponse);

    const result = await docdbManageTool.handler(
      { action: "list" },
      ctx,
    );

    expect(result.structuredContent).toEqual({ items: plainResponse, count: 2 });
  });
});

// ── iris_docdb_document ────────────────────────────────────────

describe("iris_docdb_document", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NS", () => {
    expect(docdbDocumentTool.scope).toBe("NS");
  });

  it("should have destructiveHint annotation", () => {
    expect(docdbDocumentTool.annotations.destructiveHint).toBe(true);
  });

  it("should insert a document via POST", async () => {
    const insertResult = { id: "1", status: "inserted" };
    mockHttp.post.mockResolvedValue(envelope(insertResult));

    const doc = { name: "Alice", age: 30 };
    const result = await docdbDocumentTool.handler(
      { action: "insert", database: "TestDB", document: doc },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/doc/TestDB/"),
      doc,
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(insertResult);
  });

  it("should return error when insert is called without document", async () => {
    const result = await docdbDocumentTool.handler(
      { action: "insert", database: "TestDB" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'document' is required");
  });

  it("should get a document via GET", async () => {
    const docData = { id: "42", name: "Bob", age: 25 };
    mockHttp.get.mockResolvedValue(envelope(docData));

    const result = await docdbDocumentTool.handler(
      { action: "get", database: "TestDB", id: "42" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/doc/TestDB/42"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(docData);
  });

  it("should return error when get is called without id", async () => {
    const result = await docdbDocumentTool.handler(
      { action: "get", database: "TestDB" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'id' is required");
  });

  it("should update a document via PUT", async () => {
    const updateResult = { id: "42", status: "updated" };
    mockHttp.put.mockResolvedValue(envelope(updateResult));

    const doc = { name: "Bob Updated", age: 26 };
    const result = await docdbDocumentTool.handler(
      { action: "update", database: "TestDB", id: "42", document: doc },
      ctx,
    );

    expect(mockHttp.put).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/doc/TestDB/42"),
      doc,
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(updateResult);
  });

  it("should return error when update is called without id", async () => {
    const result = await docdbDocumentTool.handler(
      { action: "update", database: "TestDB", document: { x: 1 } },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'id' is required");
  });

  it("should return error when update is called without document", async () => {
    const result = await docdbDocumentTool.handler(
      { action: "update", database: "TestDB", id: "42" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'document' is required");
  });

  it("should delete a document via DELETE", async () => {
    const deleteResult = { id: "42", status: "deleted" };
    mockHttp.delete.mockResolvedValue(envelope(deleteResult));

    const result = await docdbDocumentTool.handler(
      { action: "delete", database: "TestDB", id: "42" },
      ctx,
    );

    expect(mockHttp.delete).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/doc/TestDB/42"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(deleteResult);
  });

  it("should return error when delete is called without id", async () => {
    const result = await docdbDocumentTool.handler(
      { action: "delete", database: "TestDB" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'id' is required");
  });

  it("should handle IrisApiError gracefully", async () => {
    mockHttp.get.mockRejectedValue(
      new IrisApiError(404, [], "/api/docdb/v1/USER/doc/TestDB/99", "Not found"),
    );

    const result = await docdbDocumentTool.handler(
      { action: "get", database: "TestDB", id: "99" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error managing document");
  });

  it("should rethrow non-IrisApiError errors", async () => {
    mockHttp.post.mockRejectedValue(new Error("Unexpected"));

    await expect(
      docdbDocumentTool.handler(
        { action: "insert", database: "TestDB", document: { a: 1 } },
        ctx,
      ),
    ).rejects.toThrow("Unexpected");
  });

  it("should use resolveNamespace for document operations", async () => {
    mockHttp.get.mockResolvedValue(envelope({ id: "1" }));

    await docdbDocumentTool.handler(
      { action: "get", database: "MyDB", id: "1", namespace: "CUSTOM" },
      ctx,
    );

    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/CUSTOM/doc/MyDB/1"),
    );
  });
});

// ── iris_docdb_find ────────────────────────────────────────────

describe("iris_docdb_find", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NS", () => {
    expect(docdbFindTool.scope).toBe("NS");
  });

  it("should have readOnlyHint annotation", () => {
    expect(docdbFindTool.annotations.readOnlyHint).toBe(true);
  });

  it("should not have destructiveHint", () => {
    expect(docdbFindTool.annotations.destructiveHint).toBe(false);
  });

  it("should query documents via POST with filter translated to DocDB restriction", async () => {
    const docs = [
      { id: "1", name: "Alice", age: 30 },
      { id: "2", name: "Charlie", age: 35 },
    ];
    mockHttp.post.mockResolvedValue(envelope(docs));

    const filter = { age: { $gt: 21 } };
    const result = await docdbFindTool.handler(
      { database: "TestDB", filter },
      ctx,
    );

    // BUG-6 fix: filter must be wrapped as {restriction: ["age", 21, ">"]}
    // not sent as the raw MongoDB filter object
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/find/TestDB"),
      { restriction: ["age", 21, ">"] },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ items: docs, count: 2 });
  });

  it("should support $eq operator", async () => {
    mockHttp.post.mockResolvedValue(envelope([]));

    const filter = { status: { $eq: "active" } };
    await docdbFindTool.handler(
      { database: "TestDB", filter },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/find/TestDB"),
      { restriction: ["status", "active", "="] },
    );
  });

  it("should support $ne operator", async () => {
    mockHttp.post.mockResolvedValue(envelope([]));

    const filter = { status: { $ne: "deleted" } };
    await docdbFindTool.handler(
      { database: "TestDB", filter },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/find/TestDB"),
      { restriction: ["status", "deleted", "!="] },
    );
  });

  it("should support $lt and $lte operators", async () => {
    mockHttp.post.mockResolvedValue(envelope([]));

    const filter = { age: { $lt: 18 } };
    await docdbFindTool.handler(
      { database: "TestDB", filter },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      { restriction: ["age", 18, "<"] },
    );
  });

  it("should support $gt and $gte operators", async () => {
    mockHttp.post.mockResolvedValue(envelope([]));

    const filter = { age: { $gte: 21 } };
    await docdbFindTool.handler(
      { database: "TestDB", filter },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.any(String),
      { restriction: ["age", 21, ">="] },
    );
  });

  it("should handle IrisApiError gracefully", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(400, [], "/api/docdb/v1/USER/find/TestDB", "Bad filter"),
    );

    const result = await docdbFindTool.handler(
      { database: "TestDB", filter: { invalid: true } },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error querying documents");
  });

  it("should rethrow non-IrisApiError errors", async () => {
    mockHttp.post.mockRejectedValue(new Error("Connection lost"));

    await expect(
      docdbFindTool.handler(
        { database: "TestDB", filter: {} },
        ctx,
      ),
    ).rejects.toThrow("Connection lost");
  });

  it("should use resolveNamespace", async () => {
    mockHttp.post.mockResolvedValue(envelope([]));

    await docdbFindTool.handler(
      { database: "MyDB", filter: {}, namespace: "PROD" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/PROD/find/MyDB"),
      {},
    );
  });
});

// ── iris_docdb_property ────────────────────────────────────────

describe("iris_docdb_property", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("should have scope NS", () => {
    expect(docdbPropertyTool.scope).toBe("NS");
  });

  it("should have destructiveHint annotation", () => {
    expect(docdbPropertyTool.annotations.destructiveHint).toBe(true);
  });

  it("should create a property via POST with type as query parameter (BUG-5 fix)", async () => {
    const created = { property: "name", type: "%String", status: "created" };
    mockHttp.post.mockResolvedValue(envelope(created));

    const result = await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "name", type: "%String" },
      ctx,
    );

    // BUG-5 fix: type must be a URL query param, not in the JSON body.
    // The DocDB httpPostProperty handler reads $get(%request.Data("type",1),"%String")
    // which is the request query string, NOT the parsed JSON body.
    // NOTE: IRIS CSP does NOT URL-decode %XX in %request.Data, so the % in IRIS type
    // names ("%String", "%Integer") must be kept as a literal "%" in the URL — NOT as
    // "%25". We use split/join encoding: split on %, encode each part, rejoin with %.
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/prop/TestDB/name?type=%String"),
      {},
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(created);
  });

  it("should return error when create is called without type", async () => {
    const result = await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "name" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("'type' is required");
  });

  it("should drop a property via DELETE", async () => {
    const dropped = { property: "name", status: "dropped" };
    mockHttp.delete.mockResolvedValue(envelope(dropped));

    const result = await docdbPropertyTool.handler(
      { action: "drop", database: "TestDB", property: "name" },
      ctx,
    );

    expect(mockHttp.delete).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/prop/TestDB/name"),
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(dropped);
  });

  it("should create an index via POST with index flag", async () => {
    const indexed = { property: "age", indexed: true };
    mockHttp.post.mockResolvedValue(envelope(indexed));

    const result = await docdbPropertyTool.handler(
      { action: "index", database: "TestDB", property: "age" },
      ctx,
    );

    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/prop/TestDB/age"),
      { index: true },
    );
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual(indexed);
  });

  it("should handle IrisApiError gracefully", async () => {
    mockHttp.post.mockRejectedValue(
      new IrisApiError(500, [], "/api/docdb/v1/USER/prop/TestDB/name", "Server error"),
    );

    const result = await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "name", type: "%String" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("Error managing property 'name'");
  });

  it("should rethrow non-IrisApiError errors", async () => {
    mockHttp.delete.mockRejectedValue(new Error("Timeout"));

    await expect(
      docdbPropertyTool.handler(
        { action: "drop", database: "TestDB", property: "name" },
        ctx,
      ),
    ).rejects.toThrow("Timeout");
  });

  it("should use resolveNamespace", async () => {
    mockHttp.post.mockResolvedValue(envelope({ status: "ok" }));

    await docdbPropertyTool.handler(
      {
        action: "create",
        database: "MyDB",
        property: "email",
        type: "%String",
        namespace: "STAGING",
      },
      ctx,
    );

    // BUG-5 fix: type is a query param, not body
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/STAGING/prop/MyDB/email?type="),
      {},
    );
  });

  it("should encode special characters in property name", async () => {
    mockHttp.delete.mockResolvedValue(envelope({ status: "ok" }));

    await docdbPropertyTool.handler(
      { action: "drop", database: "TestDB", property: "my prop" },
      ctx,
    );

    expect(mockHttp.delete).toHaveBeenCalledWith(
      expect.stringContaining(encodeURIComponent("my prop")),
    );
  });

  it("property create forwards type as query param not body (BUG-5 regression guard)", async () => {
    // Verify the exact URL shape: type=%Integer must be in the URL query string.
    // If this ever reverts to body-based type, the DocDB server will silently
    // ignore it and default to %String (breaking typed property behaviour).
    mockHttp.post.mockResolvedValue(envelope({ Name: "age", Type: "%Integer" }));

    await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "age", type: "%Integer" },
      ctx,
    );

    const [calledUrl, calledBody] = mockHttp.post.mock.calls[0] as [string, unknown];
    expect(calledUrl).toContain("?type=");
    // IRIS CSP does NOT URL-decode %XX in %request.Data, so the % must be kept as
    // a literal % in the URL (not %25). The split/join encoding produces "%Integer"
    // not "%25Integer". Passing "%25Integer" causes IRIS to look for "%Library.25Integer".
    expect(calledUrl).toContain("type=%Integer");
    expect(calledUrl).not.toContain("type=%25Integer");
    // Body must be empty — not contain the type
    expect(calledBody).toEqual({});
    expect(JSON.stringify(calledBody)).not.toContain("Integer");
  });
});

// ── buildDocDbRestriction unit tests ──────────────────────────
// AC 12.4.7: "find translates $gt to WHERE clause" and "find combines multiple fields with AND"

describe("buildDocDbRestriction", () => {
  it("translates $gt to DocDB > operator", () => {
    const result = buildDocDbRestriction({ age: { $gt: 26 } });
    expect(result).toEqual(["age", 26, ">"]);
  });

  it("translates $eq to DocDB = operator", () => {
    const result = buildDocDbRestriction({ status: { $eq: "active" } });
    expect(result).toEqual(["status", "active", "="]);
  });

  it("translates $ne to DocDB != operator", () => {
    const result = buildDocDbRestriction({ status: { $ne: "deleted" } });
    expect(result).toEqual(["status", "deleted", "!="]);
  });

  it("translates $lt to DocDB < operator", () => {
    const result = buildDocDbRestriction({ score: { $lt: 50 } });
    expect(result).toEqual(["score", 50, "<"]);
  });

  it("translates $lte to DocDB <= operator", () => {
    const result = buildDocDbRestriction({ score: { $lte: 100 } });
    expect(result).toEqual(["score", 100, "<="]);
  });

  it("translates $gte to DocDB >= operator", () => {
    const result = buildDocDbRestriction({ age: { $gte: 18 } });
    expect(result).toEqual(["age", 18, ">="]);
  });

  it("combines multiple fields with AND (returns array of predicates)", () => {
    // Multiple fields: result is array of predicate arrays
    const result = buildDocDbRestriction({ age: { $gt: 26 }, name: { $eq: "Alice" } }) as unknown[][];
    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(2);
    // Each element is a predicate triple
    expect(result).toEqual(
      expect.arrayContaining([
        ["age", 26, ">"],
        ["name", "Alice", "="],
      ]),
    );
  });

  it("treats plain field equality as = predicate", () => {
    const result = buildDocDbRestriction({ name: "Bob" });
    expect(result).toEqual(["name", "Bob", "="]);
  });

  it("returns null for empty filter", () => {
    expect(buildDocDbRestriction({})).toBeNull();
  });
});

// ── Story 35.7: %Service_DocDB gate translation ──────────────
//
// Fixtures are pinned to the LIVE shapes captured 2026-08-19 (Rule #36/#54 —
// never hand-reasoned, never a state the real system cannot produce):
//
//   curl -i -u _SYSTEM:SYS http://localhost:52773/api/docdb/v1/USER
//   → HTTP 200 (NOT an error status) with body:
//   {"status":{"errors":[{"error":"ERROR #822: Access Denied","code":822,
//     "domain":"%ObjectErrors","id":"AccessDenied"}],
//     "summary":"ERROR #822: Access Denied"},"content":null}
//
// The shared HTTP client throws IrisApiError on the non-empty status.errors
// (http-client.ts) with statusCode 200 and the errors array intact.
// _SYSTEM holds %All and still receives 822 while the service is off, which
// proves 822 here is the service gate, not a privilege failure.
//
//   curl -u _SYSTEM:SYS \
//     "http://localhost:52773/api/executemcp/v2/security/service?name=%25Service_DocDB"
//   → result: {"name":"%Service_DocDB","enabled":false,
//     "description":"Controls Doc DB applications","autheEnabled":1024,
//     "clientSystems":""}

const LIVE_822_ERRORS = [
  {
    error: "ERROR #822: Access Denied",
    code: 822,
    domain: "%ObjectErrors",
    id: "AccessDenied",
  },
];

/** Build an IrisApiError exactly as http-client.ts's Atelier-level throw does. */
function makeLive822Error(path: string, method: string): IrisApiError {
  return new IrisApiError(
    200,
    LIVE_822_ERRORS,
    path,
    `IRIS reported errors for ${method} ${path}. Review the error details and correct the request.`,
  );
}

/** Live shape of the custom service-state route's result (captured 2026-08-19). */
const SERVICE_DISABLED_RESULT = {
  name: "%Service_DocDB",
  enabled: false,
  description: "Controls Doc DB applications",
  autheEnabled: 1024,
  clientSystems: "",
};
const SERVICE_ENABLED_RESULT = { ...SERVICE_DISABLED_RESULT, enabled: true };

const SERVICE_ROUTE_FRAGMENT = "/api/executemcp/v2/security/service";
const SERVICE_STATE_URL = `${SERVICE_ROUTE_FRAGMENT}?name=%25Service_DocDB`;

/** AC 35.7.3: every mandatory element of the actionable message. */
function expectActionableGateMessage(
  text: string,
  originalMessage: string,
): void {
  // Cause + live check
  expect(text).toContain("%Service_DocDB");
  expect(text).toContain("disabled by default on IRIS");
  expect(text).toContain("currently DISABLED");
  // Remedy route 1: Management Portal
  expect(text).toContain("System Administration > Security > Services");
  // Remedy route 2: the tool, WITH its governance catch and example override
  expect(text).toContain("iris_service_manage");
  expect(text).toContain('action="enable"');
  expect(text).toContain('{"global": {"iris_service_manage:enable": true}}');
  // The real 822 detail is preserved — pinned fail-capably (35.7 review):
  // the original wrapped message must survive verbatim in the "Original
  // error:" suffix, not just the helper's own hardcoded prefix.
  expect(text).toContain("ERROR #822: Access Denied");
  expect(text).toContain(`Original error: ${originalMessage}`);
}

describe("Story 35.7 — iris_docdb_manage service gate", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("translates a disabled-service 822 into an actionable error naming both remedy routes", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER", "GET");
    mockHttp.get.mockImplementation((url: string) =>
      url.includes(SERVICE_ROUTE_FRAGMENT)
        ? Promise.resolve(envelope(SERVICE_DISABLED_RESULT))
        : Promise.reject(err),
    );

    const result = await docdbManageTool.handler({ action: "list" }, ctx);

    expect(result.isError).toBe(true);
    expectActionableGateMessage(result.content[0]!.text, err.message);
    // BOTH calls happened: the DocDB call AND the service-state follow-up —
    // a translation that never checks the live state is the defect this
    // story exists to prevent.
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER"),
    );
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining(SERVICE_STATE_URL),
    );
    expect(mockHttp.get).toHaveBeenCalledTimes(2);
  });

  it("passes the original error through unchanged when the service is enabled (genuine privilege failure)", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER", "GET");
    mockHttp.get.mockImplementation((url: string) =>
      url.includes(SERVICE_ROUTE_FRAGMENT)
        ? Promise.resolve(envelope(SERVICE_ENABLED_RESULT))
        : Promise.reject(err),
    );

    const result = await docdbManageTool.handler({ action: "list" }, ctx);

    // Rule #19 back-compat: byte-identical to the pre-story error text.
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      `Error managing DocDB database: ${err.message}`,
    );
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining(SERVICE_STATE_URL),
    );
  });

  it("passes the original error through when the service-state check itself fails", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER", "GET");
    mockHttp.get.mockImplementation((url: string) =>
      url.includes(SERVICE_ROUTE_FRAGMENT)
        ? Promise.reject(new Error("connection refused"))
        : Promise.reject(err),
    );

    const result = await docdbManageTool.handler({ action: "list" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      `Error managing DocDB database: ${err.message}`,
    );
  });

  it("passes a non-822 IrisApiError through unchanged and never probes the service", async () => {
    const err = new IrisApiError(500, [
      {
        error: "ERROR #5002: ObjectScript error",
        code: 5002,
        domain: "%ObjectErrors",
        id: "5002",
      },
    ], "/api/docdb/v1/USER");
    mockHttp.get.mockRejectedValue(err);

    const result = await docdbManageTool.handler({ action: "list" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      `Error managing DocDB database: ${err.message}`,
    );
    // The DocDB call only — no service-state follow-up for non-822 errors.
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });

  it("never matches on message text: a string-form 'ERROR #822' entry passes through", async () => {
    // Locale-safety pin (Rules #8/#13): detection keys on the numeric code
    // only; a bare string carrying the 822 text must NOT trigger translation.
    const err = new IrisApiError(200, ["ERROR #822: Access Denied"], "/api/docdb/v1/USER");
    mockHttp.get.mockRejectedValue(err);

    const result = await docdbManageTool.handler({ action: "list" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      `Error managing DocDB database: ${err.message}`,
    );
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });

  it("passes through unchanged when errors is a non-array (shape the http client can produce)", async () => {
    // http-client.ts throws whenever envelope.status.errors.length > 0 — a
    // non-empty STRING satisfies that check and is passed through as-is, so
    // `errors` can be a non-array at runtime despite its unknown[] type
    // (the shared formatIrisErrors guards the same shape). The helper must
    // pass such an error through, never throw `.some is not a function` out
    // of the tool's catch path (35.7 review finding).
    const err = new IrisApiError(
      200,
      "ERROR #822: Access Denied" as unknown as unknown[],
      "/api/docdb/v1/USER",
    );
    mockHttp.get.mockRejectedValue(err);

    const result = await docdbManageTool.handler({ action: "list" }, ctx);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      `Error managing DocDB database: ${err.message}`,
    );
    // No service-state probe: a non-array errors carries no numeric code.
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });
});

describe("Story 35.7 — iris_docdb_document service gate", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("translates a disabled-service 822 into an actionable error", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER/doc/TestDB/42", "GET");
    mockHttp.get.mockImplementation((url: string) =>
      url.includes(SERVICE_ROUTE_FRAGMENT)
        ? Promise.resolve(envelope(SERVICE_DISABLED_RESULT))
        : Promise.reject(err),
    );

    const result = await docdbDocumentTool.handler(
      { action: "get", database: "TestDB", id: "42" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expectActionableGateMessage(result.content[0]!.text, err.message);
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/doc/TestDB/42"),
    );
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining(SERVICE_STATE_URL),
    );
    expect(mockHttp.get).toHaveBeenCalledTimes(2);
  });

  it("passes the original error through unchanged when the service is enabled", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER/doc/TestDB/42", "GET");
    mockHttp.get.mockImplementation((url: string) =>
      url.includes(SERVICE_ROUTE_FRAGMENT)
        ? Promise.resolve(envelope(SERVICE_ENABLED_RESULT))
        : Promise.reject(err),
    );

    const result = await docdbDocumentTool.handler(
      { action: "get", database: "TestDB", id: "42" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error managing document: ${err.message}`);
  });

  it("passes the original error through when the service-state check itself fails", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER/doc/TestDB/42", "GET");
    mockHttp.get.mockImplementation((url: string) =>
      url.includes(SERVICE_ROUTE_FRAGMENT)
        ? Promise.reject(new IrisApiError(500, [], "/api/executemcp/v2/security/service"))
        : Promise.reject(err),
    );

    const result = await docdbDocumentTool.handler(
      { action: "get", database: "TestDB", id: "42" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error managing document: ${err.message}`);
  });

  it("passes a non-822 IrisApiError through unchanged and never probes the service", async () => {
    const err = new IrisApiError(404, [], "/api/docdb/v1/USER/doc/TestDB/99", "Not found");
    mockHttp.get.mockRejectedValue(err);

    const result = await docdbDocumentTool.handler(
      { action: "get", database: "TestDB", id: "99" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error managing document: ${err.message}`);
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });
});

describe("Story 35.7 — iris_docdb_find service gate", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("translates a disabled-service 822 into an actionable error", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER/find/TestDB", "POST");
    mockHttp.post.mockRejectedValue(err);
    mockHttp.get.mockResolvedValue(envelope(SERVICE_DISABLED_RESULT));

    const result = await docdbFindTool.handler(
      { database: "TestDB", filter: { status: "active" } },
      ctx,
    );

    expect(result.isError).toBe(true);
    expectActionableGateMessage(result.content[0]!.text, err.message);
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/find/TestDB"),
      expect.anything(),
    );
    // The service-state GET is a SEPARATE call from the DocDB POST.
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining(SERVICE_STATE_URL),
    );
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });

  it("passes the original error through unchanged when the service is enabled", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER/find/TestDB", "POST");
    mockHttp.post.mockRejectedValue(err);
    mockHttp.get.mockResolvedValue(envelope(SERVICE_ENABLED_RESULT));

    const result = await docdbFindTool.handler(
      { database: "TestDB", filter: { status: "active" } },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error querying documents: ${err.message}`);
  });

  it("passes the original error through when the service-state check itself fails", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER/find/TestDB", "POST");
    mockHttp.post.mockRejectedValue(err);
    mockHttp.get.mockRejectedValue(new Error("timeout"));

    const result = await docdbFindTool.handler(
      { database: "TestDB", filter: { status: "active" } },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error querying documents: ${err.message}`);
  });

  it("passes a non-822 IrisApiError through unchanged and never probes the service", async () => {
    const err = new IrisApiError(400, [], "/api/docdb/v1/USER/find/TestDB", "Bad filter");
    mockHttp.post.mockRejectedValue(err);

    const result = await docdbFindTool.handler(
      { database: "TestDB", filter: { invalid: true } },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`Error querying documents: ${err.message}`);
    expect(mockHttp.get).not.toHaveBeenCalled();
  });
});

describe("Story 35.7 — iris_docdb_property service gate", () => {
  let mockHttp: ReturnType<typeof createMockHttp>;
  let ctx: ToolContext;

  beforeEach(() => {
    mockHttp = createMockHttp();
    ctx = createMockCtx(mockHttp);
  });

  it("translates a disabled-service 822 into an actionable error", async () => {
    const err = makeLive822Error(
      "/api/docdb/v1/USER/prop/TestDB/name?type=%String",
      "POST",
    );
    mockHttp.post.mockRejectedValue(err);
    mockHttp.get.mockResolvedValue(envelope(SERVICE_DISABLED_RESULT));

    const result = await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "name", type: "%String" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expectActionableGateMessage(result.content[0]!.text, err.message);
    expect(mockHttp.post).toHaveBeenCalledWith(
      expect.stringContaining("/api/docdb/v1/USER/prop/TestDB/name"),
      {},
    );
    expect(mockHttp.get).toHaveBeenCalledWith(
      expect.stringContaining(SERVICE_STATE_URL),
    );
    expect(mockHttp.get).toHaveBeenCalledTimes(1);
  });

  it("passes the original error through unchanged when the service is enabled", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER/prop/TestDB/name?type=%String", "POST");
    mockHttp.post.mockRejectedValue(err);
    mockHttp.get.mockResolvedValue(envelope(SERVICE_ENABLED_RESULT));

    const result = await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "name", type: "%String" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      `Error managing property 'name': ${err.message}`,
    );
  });

  it("passes the original error through when the service-state check itself fails", async () => {
    const err = makeLive822Error("/api/docdb/v1/USER/prop/TestDB/name?type=%String", "POST");
    mockHttp.post.mockRejectedValue(err);
    mockHttp.get.mockRejectedValue(new Error("DNS failure"));

    const result = await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "name", type: "%String" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      `Error managing property 'name': ${err.message}`,
    );
  });

  it("passes a non-822 IrisApiError through unchanged and never probes the service", async () => {
    const err = new IrisApiError(500, [], "/api/docdb/v1/USER/prop/TestDB/name", "Server error");
    mockHttp.post.mockRejectedValue(err);

    const result = await docdbPropertyTool.handler(
      { action: "create", database: "TestDB", property: "name", type: "%String" },
      ctx,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      `Error managing property 'name': ${err.message}`,
    );
    expect(mockHttp.get).not.toHaveBeenCalled();
  });
});
