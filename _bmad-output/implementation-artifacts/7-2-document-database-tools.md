# Story 7.2: Document Database Tools

Status: done

## Story

As a data engineer,
I want to create document databases, manage documents, and query collections through MCP tools,
so that I can work with IRIS document storage without writing SQL or using the Management Portal.

## Acceptance Criteria

1. **AC1 (FR100)**: `iris.docdb.manage` with action "create" creates a document database; action "drop" drops it; action "list" lists all DocDB databases in the namespace.
2. **AC2 (FR101)**: `iris.docdb.document` with action "insert" inserts a document and returns its generated ID; "get" retrieves by ID; "update" updates by ID; "delete" deletes by ID.
3. **AC3 (FR102)**: `iris.docdb.find` queries documents with filter criteria supporting comparison operators ($eq, $lt, $gt, $ne, etc.) and returns matching documents.
4. **AC4 (FR103)**: `iris.docdb.property` with action "create" defines a property; "drop" removes it; "index" creates an index on a property.
5. **AC5**: `iris.docdb.manage` annotated as destructiveHint: true. `iris.docdb.find` annotated as readOnlyHint: true. All tools have scope NS.
6. **AC6**: All inputs validated via Zod schemas. Unit tests with mocked HTTP verify parameter validation, response parsing, and error handling for every tool.
7. **AC7**: `turbo build` and `turbo test` pass.

## Tasks / Subtasks

- [x] Task 1: Create docdb.ts with iris.docdb.manage tool (AC: 1, 5)
  - [x] Define `docdbManageTool` with actions: "list", "create", "drop"
  - [x] "list": GET `/api/docdb/v1/{namespace}` — returns array of database names
  - [x] "create": POST `/api/docdb/v1/{namespace}/db/{database}` with optional properties body
  - [x] "drop": DELETE `/api/docdb/v1/{namespace}/db/{database}`
  - [x] Annotations: destructiveHint: true (drop action)
  - [x] Scope: NS

- [x] Task 2: Add iris.docdb.document tool to docdb.ts (AC: 2, 5)
  - [x] Define `docdbDocumentTool` with actions: "insert", "get", "update", "delete"
  - [x] "insert": POST `/api/docdb/v1/{namespace}/doc/{database}/` with JSON body → returns ID
  - [x] "get": GET `/api/docdb/v1/{namespace}/doc/{database}/{id}`
  - [x] "update": PUT `/api/docdb/v1/{namespace}/doc/{database}/{id}` with JSON body
  - [x] "delete": DELETE `/api/docdb/v1/{namespace}/doc/{database}/{id}`
  - [x] Annotations: destructiveHint: true (delete action)
  - [x] Scope: NS

- [x] Task 3: Add iris.docdb.find tool to docdb.ts (AC: 3, 5)
  - [x] Define `docdbFindTool`
  - [x] POST `/api/docdb/v1/{namespace}/find/{database}` with filter body (JSON query)
  - [x] Filter supports comparison operators ($eq, $lt, $gt, $ne, $lte, $gte, etc.)
  - [x] Annotations: readOnlyHint: true
  - [x] Scope: NS

- [x] Task 4: Add iris.docdb.property tool to docdb.ts (AC: 4, 5)
  - [x] Define `docdbPropertyTool` with actions: "create", "drop", "index"
  - [x] "create": POST `/api/docdb/v1/{namespace}/prop/{database}/{property}` with type body
  - [x] "drop": DELETE `/api/docdb/v1/{namespace}/prop/{database}/{property}`
  - [x] "index": POST `/api/docdb/v1/{namespace}/prop/{database}/{property}` with index flag
  - [x] Annotations: destructiveHint: true (drop action)
  - [x] Scope: NS

- [x] Task 5: Wire tools into tools/index.ts (AC: 5)
  - [x] Import all 4 tools from `./docdb.js`
  - [x] Add to the tools array
  - [x] Update index.test.ts tool count and name checks

- [x] Task 6: Create unit tests (AC: 6)
  - [x] Create `packages/iris-data-mcp/src/__tests__/docdb.test.ts`
  - [x] Test each tool's handler with mocked ctx.http responses
  - [x] Test Zod validation (missing required fields, invalid actions)
  - [x] Test error handling (HTTP errors, IrisApiError)
  - [x] Test namespace resolution via ctx.resolveNamespace
  - [x] Follow iris-ops-mcp test patterns (mock ctx with http.get/post/put/delete)

- [x] Task 7: Validate (AC: 7)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests must pass

### Review Findings

- [x] [Review][Patch] Empty string ID could collide with insert endpoint URL — added `.min(1)` to Zod `id` schema [docdb.ts:166]
- [x] [Review][Patch] Empty string database/property creates malformed URLs — added `.min(1)` to Zod `database` and `property` schemas across all 4 tools [docdb.ts:60,163,307,377]

## Dev Notes

### CRITICAL: DocDB uses IRIS Built-in REST API, NOT Custom REST Service

Unlike ops/admin/interop tools that call `/api/executemcp/v2/...`, DocDB tools call IRIS's **built-in DocDB REST API** at `/api/docdb/v1/{namespace}/...`. This is similar to how iris-dev-mcp uses the Atelier API directly.

**No ObjectScript handler class is needed for DocDB operations.**

### DocDB API Endpoints (verified from IRIS docs)

| Operation | Method | Endpoint |
|-----------|--------|----------|
| List databases | GET | `/api/docdb/v1/{ns}` |
| Create database | POST | `/api/docdb/v1/{ns}/db/{db}` |
| Drop database | DELETE | `/api/docdb/v1/{ns}/db/{db}` |
| Insert document | POST | `/api/docdb/v1/{ns}/doc/{db}/` |
| Get document | GET | `/api/docdb/v1/{ns}/doc/{db}/{id}` |
| Update document | PUT | `/api/docdb/v1/{ns}/doc/{db}/{id}` |
| Delete document | DELETE | `/api/docdb/v1/{ns}/doc/{db}/{id}` |
| Find documents | POST | `/api/docdb/v1/{ns}/find/{db}` |
| Create property | POST | `/api/docdb/v1/{ns}/prop/{db}/{prop}` |
| Drop property | DELETE | `/api/docdb/v1/{ns}/prop/{db}/{prop}` |

### Namespace Handling

DocDB API puts the namespace directly in the URL path: `/api/docdb/v1/{namespace}/...`

Use `ctx.resolveNamespace(namespace)` to resolve the namespace, then embed it in the URL:
```typescript
const ns = ctx.resolveNamespace(namespace);
const path = `/api/docdb/v1/${encodeURIComponent(ns)}/db/${encodeURIComponent(database)}`;
```

### Tool Handler Pattern (follow iris-interop-mcp/credential.ts)

```typescript
const BASE_DOCDB_URL = "/api/docdb/v1";

handler: async (args, ctx) => {
  const { action, database, namespace } = args as { ... };
  const ns = ctx.resolveNamespace(namespace);
  
  let response;
  if (action === "list") {
    response = await ctx.http.get(`${BASE_DOCDB_URL}/${encodeURIComponent(ns)}`);
  } else if (action === "create") {
    response = await ctx.http.post(`${BASE_DOCDB_URL}/${encodeURIComponent(ns)}/db/${encodeURIComponent(database)}`, body);
  }
  // ...
  const result = response.result ?? response;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    structuredContent: result,
  };
};
```

### Response Envelope

The DocDB API may return responses differently from the custom REST service. The IRIS DocDB API returns JSON directly (not wrapped in the three-part Atelier envelope). Test with actual responses to determine the structure.

For `ctx.http.get()` and `ctx.http.post()`, the `IrisHttpClient` parses the JSON response. The `.result` property comes from the Atelier envelope — for DocDB responses that don't use this envelope, the parsed JSON may be at the top level of the response object.

**IMPORTANT:** The IrisHttpClient's `request()` method expects responses in the Atelier envelope format (`{status, console, result}`). If the DocDB API returns a different format, you may need to handle the raw response. Check how `IrisHttpClient.get()` and `IrisHttpClient.post()` parse responses and adjust accordingly.

### Unit Test Pattern (mock ctx)

```typescript
const createMockCtx = (mockResponse: unknown) => ({
  http: {
    get: vi.fn().mockResolvedValue(mockResponse),
    post: vi.fn().mockResolvedValue(mockResponse),
    put: vi.fn().mockResolvedValue(mockResponse),
    delete: vi.fn().mockResolvedValue(mockResponse),
  },
  resolveNamespace: vi.fn().mockReturnValue("HSCUSTOM"),
  paginate: vi.fn(),
});
```

### File Locations

| What | Path |
|------|------|
| New tool file | `packages/iris-data-mcp/src/tools/docdb.ts` |
| New test file | `packages/iris-data-mcp/src/__tests__/docdb.test.ts` |
| Wire into | `packages/iris-data-mcp/src/tools/index.ts` |
| Update | `packages/iris-data-mcp/src/__tests__/index.test.ts` |
| Reference | `packages/iris-interop-mcp/src/tools/credential.ts` (tool pattern) |
| Reference | `packages/iris-ops-mcp/src/__tests__/metrics.test.ts` (test pattern) |

### Previous Story Intelligence (Story 7.1)

- iris-data-mcp package is set up with empty tools array, 13 unit tests
- Server name: `@iris-mcp/data`, needsCustomRest: true
- index.test.ts currently checks for 0 tools — will need updating

### Critical Rules

- Do NOT create an ObjectScript handler class for DocDB — use the built-in IRIS DocDB API
- Do NOT add routes to Dispatch.cls for DocDB
- DO use `ctx.resolveNamespace()` and embed the namespace in the DocDB API URL path
- DO use `encodeURIComponent()` on namespace and database names in URL paths
- DO handle the DocDB API response format (may differ from Atelier envelope)

### References

- [Source: _bmad-output/planning-artifacts/research/technical-iris-mcp-v2-tools-research-2026-04-05.md#4.4 DocDB API]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.2]
- [Source: _bmad-output/planning-artifacts/architecture.md#Boundary 2]
- [Source: packages/iris-interop-mcp/src/tools/credential.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required — all tests passed on second build attempt after fixing z.record() and TS2532 issues.

### Completion Notes List

- Implemented 4 DocDB tools (manage, document, find, property) in docdb.ts calling the IRIS built-in DocDB REST API
- Added extractResult() helper to handle both Atelier envelope and plain JSON responses from DocDB API
- All tools use ctx.resolveNamespace() and encodeURIComponent() for URL-safe namespace/database/property names
- Input validation returns descriptive errors for missing required fields (database, id, document, type)
- Wired 4 tools into tools/index.ts, updated index.test.ts from 0 to 4 tool count
- Created 47 unit tests covering handler logic, validation, error handling, namespace resolution, and URL encoding
- Fixed z.record(z.unknown()) to z.record(z.string(), z.unknown()) for Zod compatibility
- turbo build: 7/7 successful; turbo test: 61/61 data tests pass, no regressions in other packages
- Pre-existing issue: @iris-mcp/all has no test files (not related to this story)

### File List

- packages/iris-data-mcp/src/tools/docdb.ts (new)
- packages/iris-data-mcp/src/tools/index.ts (modified)
- packages/iris-data-mcp/src/__tests__/docdb.test.ts (new)
- packages/iris-data-mcp/src/__tests__/index.test.ts (modified)
- _bmad-output/implementation-artifacts/7-2-document-database-tools.md (modified)

### Change Log

- 2026-04-07: Implemented Story 7.2 — 4 DocDB tools with 47 unit tests, all ACs satisfied
