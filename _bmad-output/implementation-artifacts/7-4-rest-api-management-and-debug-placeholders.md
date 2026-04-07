# Story 7.4: REST API Management & Debug Placeholders

Status: done

## Story

As a data engineer,
I want to view and manage REST API dispatch classes on IRIS and have placeholder tools for future debugging capabilities,
so that I can inspect REST services and know that debug features are planned for a future release.

## Acceptance Criteria

1. **AC1**: `iris.rest.manage` with action "list" returns available REST API dispatch classes and their URL maps in the namespace.
2. **AC2**: `iris.rest.manage` with action "get" returns REST application details (dispatch class, URL map, routes) for a named application.
3. **AC3**: `iris.rest.manage` with action "delete" removes a REST application.
4. **AC4**: `iris.rest.manage` is annotated as destructiveHint: true (can delete). Scope: NS.
5. **AC5**: `debug.ts` placeholder file exists with code comment indicating iris.debug.session and iris.debug.terminal are deferred to post-MVP (FR106-FR107) and will require WebSocket transport. These tools are NOT registered or listed.
6. **AC6**: Unit tests with mocked HTTP verify parameter validation, response parsing, and error handling.
7. **AC7**: `turbo build` and `turbo test` pass.

## Tasks / Subtasks

- [x] Task 1: Create rest.ts with iris.rest.manage tool (AC: 1, 2, 3, 4)
  - [x] Create `packages/iris-data-mcp/src/tools/rest.ts`
  - [x] Define `restManageTool` with actions: "list", "get", "delete"
  - [x] "list": GET `/api/mgmnt/v2/{namespace}/` — returns list of REST applications
  - [x] "get": GET `/api/mgmnt/v2/{namespace}/{application}` — returns OpenAPI spec / details
  - [x] "delete": DELETE `/api/mgmnt/v2/{namespace}/{application}` — removes REST application
  - [x] Annotations: destructiveHint: true (delete action)
  - [x] Scope: NS
  - [x] Use `ctx.resolveNamespace()` and embed namespace in URL path
  - [x] Reuse `extractResult()` pattern from docdb.ts for response handling

- [x] Task 2: Create debug.ts placeholder (AC: 5)
  - [x] Create `packages/iris-data-mcp/src/tools/debug.ts`
  - [x] Add code comment explaining FR106 (iris.debug.session) and FR107 (iris.debug.terminal) are deferred to post-MVP
  - [x] Comment should note these tools will require WebSocket transport
  - [x] Export nothing (no tool definitions) — do NOT register any tools
  - [x] File is a placeholder only

- [x] Task 3: Wire tools into tools/index.ts (AC: 4)
  - [x] Import restManageTool from `./rest.js`
  - [x] Add to tools array (now 7 total: 4 docdb + 2 analytics + 1 rest)
  - [x] Do NOT import from debug.ts (placeholder only)
  - [x] Update index.test.ts tool count and name checks

- [x] Task 4: Create unit tests (AC: 6)
  - [x] Create `packages/iris-data-mcp/src/__tests__/rest.test.ts`
  - [x] Test list action with mocked response
  - [x] Test get action with mocked response (OpenAPI spec)
  - [x] Test delete action with mocked response
  - [x] Test Zod validation (missing application for get/delete, invalid action)
  - [x] Test error handling (HTTP errors)
  - [x] Test namespace resolution

- [x] Task 5: Validate (AC: 7)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests must pass

## Dev Notes

### IRIS Management API Endpoints (built-in, no custom handler needed)

| Operation | Method | Endpoint |
|-----------|--------|----------|
| List REST apps in namespace | GET | `/api/mgmnt/v2/{namespace}/` |
| Get REST app details/OpenAPI | GET | `/api/mgmnt/v2/{namespace}/{application}` |
| Delete REST app | DELETE | `/api/mgmnt/v2/{namespace}/{application}` |

**No ObjectScript handler class is needed** — the Management API is built into IRIS, similar to the DocDB API used in Story 7.2.

### Namespace Handling

Same pattern as DocDB tools: namespace goes directly in the URL path.
```typescript
const ns = ctx.resolveNamespace(namespace);
const path = `/api/mgmnt/v2/${encodeURIComponent(ns)}/`;
```

### Response Handling

Use the `extractResult()` helper function from docdb.ts (or duplicate it in rest.ts). The Management API may return responses without the Atelier envelope wrapper.

### Tool Handler Pattern

```typescript
const BASE_MGMNT_URL = "/api/mgmnt/v2";

handler: async (args, ctx) => {
  const { action, application, namespace } = args as { ... };
  const ns = ctx.resolveNamespace(namespace);
  
  let response;
  if (action === "list") {
    response = await ctx.http.get(`${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/`);
  } else if (action === "get") {
    response = await ctx.http.get(`${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/${encodeURIComponent(application)}`);
  } else if (action === "delete") {
    response = await ctx.http.delete(`${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/${encodeURIComponent(application)}`);
  }
  // ...
};
```

### Debug Placeholder Pattern

```typescript
/**
 * Debug tools placeholder for future post-MVP implementation.
 *
 * FR106: iris.debug.session — Interactive ObjectScript debug sessions
 * FR107: iris.debug.terminal — IRIS terminal via WebSocket
 *
 * These tools are deferred to post-MVP and will require WebSocket
 * transport support (not available in current MCP stdio/HTTP transports).
 *
 * When implemented, these tools will be added to the tools array in
 * tools/index.ts and registered with the MCP server.
 */

// No exports — placeholder only
```

### File Locations

| What | Path |
|------|------|
| New REST tool file | `packages/iris-data-mcp/src/tools/rest.ts` |
| New debug placeholder | `packages/iris-data-mcp/src/tools/debug.ts` |
| New test file | `packages/iris-data-mcp/src/__tests__/rest.test.ts` |
| Wire into | `packages/iris-data-mcp/src/tools/index.ts` |
| Update | `packages/iris-data-mcp/src/__tests__/index.test.ts` |
| Reference | `packages/iris-data-mcp/src/tools/docdb.ts` (extractResult pattern) |

### Previous Story Intelligence (Story 7.3)

- 6 tools currently registered (4 docdb + 2 analytics)
- extractResult() helper established in docdb.ts for non-Atelier envelope responses
- index.test.ts checks tool count and tool names

### Critical Rules

- Do NOT create an ObjectScript handler — use IRIS built-in Management API
- Do NOT register debug tools — placeholder file only
- DO use `encodeURIComponent()` on namespace and application names
- The `application` parameter for get/delete should accept REST application paths (e.g., "/api/myapp")
- Use `.min(1)` on string Zod schemas per code review lesson from Story 7.2

### References

- [Source: _bmad-output/planning-artifacts/research/technical-iris-mcp-v2-tools-research-2026-04-05.md#4.2 Management API]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.4]
- [Source: packages/iris-data-mcp/src/tools/docdb.ts (extractResult pattern)]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
No debug issues encountered.

### Completion Notes List
- Created `rest.ts` with `restManageTool` supporting list/get/delete actions against IRIS Management API at `/api/mgmnt/v2/`
- Created `debug.ts` placeholder with FR106/FR107 deferred notes (no exports, not registered)
- Wired `restManageTool` into `tools/index.ts` (now 7 tools total)
- Updated `index.test.ts` with new tool count (7) and name checks for `iris.rest.manage`
- Created 16 unit tests in `rest.test.ts` covering: list/get/delete actions, parameter validation, namespace resolution, URI encoding, error handling (IrisApiError + non-IRIS errors), non-envelope responses
- All 100 iris-data-mcp tests pass; `turbo build` succeeds across all packages
- Reused `extractResult()` from docdb.ts (imported, not duplicated) following analytics.ts pattern
- Used `.min(1)` on string Zod schemas per Story 7.2 code review lesson

### File List
- `packages/iris-data-mcp/src/tools/rest.ts` (new)
- `packages/iris-data-mcp/src/tools/debug.ts` (new)
- `packages/iris-data-mcp/src/__tests__/rest.test.ts` (new)
- `packages/iris-data-mcp/src/tools/index.ts` (modified)
- `packages/iris-data-mcp/src/__tests__/index.test.ts` (modified)

### Review Findings
- [x] [Review][Patch] Stale test description says "6 tools" instead of "7 tools" [index.test.ts:49] — fixed
- [x] [Review][Defer] `encodeURIComponent()` on application paths encodes forward slashes — deferred, requires live IRIS testing to verify Management API behavior

### Change Log
- 2026-04-07: Code review passed — 1 patch auto-fixed, 1 item deferred
- 2026-04-07: Implemented Story 7.4 — REST API management tool + debug placeholder + 16 unit tests
