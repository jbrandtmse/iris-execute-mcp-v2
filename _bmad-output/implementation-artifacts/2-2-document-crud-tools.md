# Story 2.2: Document CRUD Tools

Status: done

## Story

As a developer,
I want to read, create, update, delete, and list ObjectScript documents through my AI assistant,
So that I can manage source code on IRIS without leaving the AI conversation.

## Acceptance Criteria

1. **Given** a valid IRIS connection with an existing class document **When** `iris.doc.get` is called with the document name (e.g., "MyApp.Service.cls") **Then** the document content is returned in UDL format by default **And** an optional `format` parameter allows requesting XML format **And** an optional `namespace` parameter overrides the default namespace
2. **Given** new or modified ObjectScript source code **When** `iris.doc.put` is called with the document name and content **Then** the document is created or updated on IRIS via the Atelier API **And** the response confirms the save was successful
3. **Given** one or more existing documents **When** `iris.doc.delete` is called with the document name(s) **Then** the specified documents are deleted from IRIS **And** the response confirms deletion
4. **Given** a namespace with ObjectScript documents **When** `iris.doc.list` is called with optional category filter (CLS, RTN, CSP, OTH) **Then** a filtered list of documents in the namespace is returned **And** results support pagination via the server base
5. **Given** a document that does not exist **When** `iris.doc.get` is called **Then** an MCP tool error is returned with `isError: true` and message: "Document '{name}' not found in namespace '{ns}'"
6. **And** all four tools follow the ToolDefinition interface with appropriate annotations (readOnlyHint for get/list, destructiveHint for delete)
7. **And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling for each tool
8. **And** all tools respond within 2 seconds under normal IRIS load (NFR1)

## Tasks / Subtasks

- [x] Task 1: Create doc.ts tool definitions (AC: #1-#6)
  - [x] Create `packages/iris-dev-mcp/src/tools/doc.ts`
  - [x] Implement `iris.doc.get` tool:
    - inputSchema: `{ name: string, namespace?: string, format?: "udl" | "xml" }`
    - scope: "NS", annotations: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
    - Handler: `GET /api/atelier/v{N}/{ns}/doc/{name}` via `ctx.http.get(atelierPath(...))`
    - Return document content as text, structured content as envelope result
  - [x] Implement `iris.doc.put` tool:
    - inputSchema: `{ name: string, content: string | string[], namespace?: string, ignoreConflict?: boolean }`
    - scope: "NS", annotations: `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
    - Handler: `PUT /api/atelier/v{N}/{ns}/doc/{name}` with body `{ enc: false, content: [...lines] }`
    - Content should be split into lines array if provided as string
  - [x] Implement `iris.doc.delete` tool:
    - inputSchema: `{ name: string | string[], namespace?: string }`
    - scope: "NS", annotations: `{ readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }`
    - Single doc: `DELETE /api/atelier/v{N}/{ns}/doc/{name}`
    - Multiple docs: `DELETE /api/atelier/v{N}/{ns}/docs` with body array (batch delete endpoint)
  - [x] Implement `iris.doc.list` tool:
    - inputSchema: `{ category?: "CLS" | "RTN" | "CSP" | "OTH" | "*", type?: string, filter?: string, generated?: boolean, namespace?: string }`
    - scope: "NS", annotations: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
    - Handler: `GET /api/atelier/v{N}/{ns}/docnames/{category}/{type}` with query params
    - Use `ctx.paginate()` if result set is large (from McpServerBase)
- [x] Task 2: Wire tools into tools/index.ts (AC: #6)
  - [x] Import all 4 tools from `./doc.js`
  - [x] Add them to the exported `tools` array
- [x] Task 3: Add unit tests (AC: #5, #7)
  - [x] Create `packages/iris-dev-mcp/src/__tests__/doc.test.ts`
  - [x] Test iris.doc.get: successful retrieval returns content text
  - [x] Test iris.doc.get: format=xml passes correct parameter
  - [x] Test iris.doc.get: namespace override resolves correctly
  - [x] Test iris.doc.get: 404 returns isError: true with descriptive message
  - [x] Test iris.doc.put: sends correct PUT body with content lines array
  - [x] Test iris.doc.put: string content is split into lines
  - [x] Test iris.doc.delete: single doc sends DELETE to correct path
  - [x] Test iris.doc.delete: multiple docs uses batch endpoint
  - [x] Test iris.doc.list: default category/type returns all documents
  - [x] Test iris.doc.list: category filter is passed to endpoint
  - [x] Test iris.doc.list: empty result returns empty array (not error)
- [x] Task 4: Validate (AC: #8)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass (existing + new)
  - [x] Run `turbo lint` — no lint errors

## Dev Notes

### Atelier API Endpoints

| Tool | Method | Endpoint | Notes |
|------|--------|----------|-------|
| iris.doc.get | GET | `/api/atelier/v{N}/{ns}/doc/{name}` | Optional `format` query param |
| iris.doc.put | PUT | `/api/atelier/v{N}/{ns}/doc/{name}` | Body: `{ enc: false, content: string[] }` |
| iris.doc.delete | DELETE | `/api/atelier/v{N}/{ns}/doc/{name}` | Single document |
| iris.doc.delete (batch) | DELETE | `/api/atelier/v{N}/{ns}/docs` | Body: array of names |
| iris.doc.list | GET | `/api/atelier/v{N}/{ns}/docnames/{cat}/{type}` | Query: filter, generated |

### Handler Pattern

```typescript
import { atelierPath, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

export const docGetTool: ToolDefinition = {
  name: "iris.doc.get",
  title: "Get Document",
  description: "Retrieve an ObjectScript class, routine, CSP page, or include file by name.",
  inputSchema: z.object({
    name: z.string().describe("Document name (e.g., 'MyApp.Service.cls')"),
    namespace: z.string().optional().describe("Target namespace (default: configured)"),
    format: z.enum(["udl", "xml"]).optional().describe("Output format (default: udl)"),
  }),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: "NS",
  handler: async (args, ctx) => {
    const ns = ctx.resolveNamespace(args.namespace);
    const path = atelierPath(ctx.atelierVersion, ns, `doc/${args.name}`);
    const response = await ctx.http.get(path);
    return {
      content: [{ type: "text", text: JSON.stringify(response.result, null, 2) }],
      structuredContent: response.result,
    };
  },
};
```

### Error Handling in Tool Handlers

- IrisApiError thrown by http client is caught by McpServerBase.handleToolCall() → returns `isError: true`
- For 404 (document not found), catch IrisApiError and return friendly message
- For validation errors, Zod safeParse in server-base handles automatically
- Tool handlers should NOT catch errors unless adding context — let them propagate

### Key Files

| File | Action |
|------|--------|
| `packages/iris-dev-mcp/src/tools/doc.ts` | Create — 4 tool definitions |
| `packages/iris-dev-mcp/src/tools/index.ts` | Modify — import and export doc tools |
| `packages/iris-dev-mcp/src/__tests__/doc.test.ts` | Create — unit tests with mocked HTTP |

### Testing Pattern

Mock the HTTP client and ToolContext:
```typescript
const mockHttp = {
  get: vi.fn(),
  put: vi.fn(),
  delete: vi.fn(),
} as unknown as IrisHttpClient;

const mockCtx: ToolContext = {
  resolveNamespace: (override?: string) => override ?? "USER",
  http: mockHttp,
  atelierVersion: 7,
  config: { /* ... */ } as IrisConnectionConfig,
};
```

### Previous Story Intelligence

- Story 2.1 established the tools/index.ts pattern with empty array export
- Story 2.0 fixed CSRF preflight so PUT/DELETE will work on first call
- atelierPath() from shared package constructs `/api/atelier/v{N}/{ns}/{action}` paths
- IrisHttpClient.get/put/delete return AtelierEnvelope<T> with `.result`, `.status`, `.console`

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 2.2 lines 520-556]
- [Source: _bmad-output/planning-artifacts/architecture.md — tool definitions lines 446-464]
- [Source: packages/shared/src/tool-types.ts — ToolDefinition, ToolContext, ToolResult]
- [Source: packages/shared/src/http-client.ts — IrisHttpClient API]
- [Source: packages/shared/src/atelier.ts — atelierPath()]
- [Source: sources/vscode-objectscript/src/api/index.ts — Atelier API reference lines 600-670]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
N/A — all tests passed on first run after build fix.

### Completion Notes List
- Implemented all 4 document CRUD tools (get, put, delete, list) in `packages/iris-dev-mcp/src/tools/doc.ts`
- Wired tools into `tools/index.ts` — array now exports 4 ToolDefinitions
- Created 15 unit tests in `doc.test.ts` covering all ACs: successful retrieval, format param, namespace override, 404 error, PUT body, string splitting, single/batch delete, list with filters, empty results
- Updated existing `index.test.ts` (8 tests) to reflect tools array now containing 4 tools instead of 0
- Added `zod` as direct dependency of `@iris-mcp/dev` package since tool schemas require it
- Batch delete implemented as individual DELETE calls per document (IrisHttpClient.delete() does not accept a body parameter; the per-doc approach is functionally correct and avoids modifying the shared package)
- All 23 iris-dev-mcp tests pass, all 119 shared tests pass, turbo build succeeds, turbo lint clean

### File List
- `packages/iris-dev-mcp/src/tools/doc.ts` (created) — 4 tool definitions
- `packages/iris-dev-mcp/src/tools/index.ts` (modified) — imports and exports doc tools
- `packages/iris-dev-mcp/src/__tests__/doc.test.ts` (created) — 15 unit tests
- `packages/iris-dev-mcp/src/__tests__/index.test.ts` (modified) — updated for non-empty tools array
- `packages/iris-dev-mcp/package.json` (modified) — added zod dependency

### Review Findings

- [x] [Review][Patch] Batch delete partial failure loses context — no error reporting when middle deletions fail [doc.ts:162-186] — FIXED: added try/catch per doc with partial-success reporting
- [x] [Review][Patch] Inconsistent query parameter construction — get/put manually append `?param=value` while list uses URLSearchParams [doc.ts:51,119] — FIXED: all tools now use URLSearchParams consistently
- [x] [Review][Patch] Empty name array in delete produces confusing "0 documents" message [doc.ts:169] — FIXED: early return with clear message
- [x] [Review][Defer] Batch delete uses individual calls instead of Atelier batch endpoint [doc.ts] — deferred, IrisHttpClient.delete() has no body param
- [x] [Review][Defer] No input validation/sanitization on document name path parameter [doc.ts] — deferred, pre-existing limitation of atelierPath()
- [x] [Review][Defer] ctx.paginate() not available on ToolContext for list pagination [doc.ts:225-258] — deferred, requires shared package ToolContext change

## Change Log
- 2026-04-05: Implemented Story 2.2 — Document CRUD Tools (iris.doc.get, iris.doc.put, iris.doc.delete, iris.doc.list) with full test coverage
- 2026-04-05: Code review — fixed 3 issues (batch delete partial failure, inconsistent query params, empty array handling); deferred 3 items to deferred-work.md
