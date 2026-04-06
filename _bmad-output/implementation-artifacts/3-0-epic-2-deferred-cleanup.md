# Story 3.0: Epic 2 Deferred Cleanup

Status: done

## Story

As a developer,
I want the deferred cleanup items from Epic 2 resolved before starting Epic 3 feature work,
So that test infrastructure is DRY, pagination is available to tools, and Atelier API research is consolidated.

## Acceptance Criteria

1. **Given** duplicated test helpers across 6 test files in iris-dev-mcp
   **When** a shared test-helpers module is created
   **Then** `createMockHttp()`, `createMockCtx()`, and `envelope()` are defined once in `packages/iris-dev-mcp/src/__tests__/test-helpers.ts`
   **And** all 6 test files import from the shared module instead of defining their own copies
   **And** all existing unit tests still pass

2. **Given** `paginate()` exists on McpServerBase but is not accessible from tool handlers
   **When** pagination support is added to ToolContext
   **Then** tool handlers can call `ctx.paginate(items, cursor, pageSize?)` to paginate results
   **And** the existing `iris.doc.list` tool uses pagination for its results
   **And** the paginate function signature matches the existing McpServerBase.paginate() behavior

3. **Given** Atelier API endpoint research was repeated per-story in Epic 2
   **When** a consolidated Atelier API reference document is created
   **Then** the document lives at `_bmad-output/planning-artifacts/research/atelier-api-reference.md`
   **And** it catalogs all known endpoints with HTTP method, URL path, request/response format, and minimum API version
   **And** it includes source references to irislib/%Atelier and irislib/%Api packages

## Triage Table — Epic 2 Retro & Deferred Work

| Item | Source | Decision | Rationale |
|------|--------|----------|-----------|
| Extract shared test helpers | Retro MUST-INCLUDE #1 | **Include in 3.0** | Maintenance burden across 6 files |
| Add ctx.paginate() to ToolContext | Retro MUST-INCLUDE #2 | **Include in 3.0** | iris.doc.list returns unbounded results |
| Create Atelier API reference doc | Retro MUST-INCLUDE #3 | **Include in 3.0** | Accelerates Epic 3+ story dev |
| License field in package.json | deferred-work.md | Defer | Pre-publish concern, no impact now |
| Logger log-level filtering | deferred-work.md | Defer | Not in production use |
| destroy() abort in-flight requests | deferred-work.md | Defer | Edge case, no observed impact |
| Logger redaction/scrubbing | deferred-work.md | Defer | Low risk in dev tooling |
| negotiateVersion bare catch | deferred-work.md | Defer | Low impact, version defaults safely |
| atelierPath input validation | deferred-work.md | Defer | Atelier rejects invalid paths |
| requireMinVersion error metadata | deferred-work.md | Defer | Minor DX improvement |
| handleToolCall validation path test | deferred-work.md | Defer | Covered by Zod unit tests |
| encodeCursor NaN validation | deferred-work.md | Defer | Internal function, controlled inputs |
| addTools duplicate name handling | deferred-work.md | Defer | SDK throws on duplicate |
| resolveTransport() unit tests | deferred-work.md | Defer | Internal function, hard to isolate |
| Entry point bootstrap flow tests | deferred-work.md | Defer | Requires full startup mocking |
| Package exports field mismatch | deferred-work.md | Defer | Pre-existing from skeleton |
| Batch delete individual calls | deferred-work.md | Defer | Works correctly, optimization only |
| Document name input validation | deferred-work.md | Defer | Atelier rejects invalid names |
| metadataOnly + format silently ignores | deferred-work.md | Defer | Edge case, documented behavior |
| Client-side maxRows truncation | deferred-work.md | Defer | Optimization candidate |
| Duplicated body construction in xml_export | deferred-work.md | Defer | Minor DRY, 2 lines |
| Missing error propagation test for xml_export | deferred-work.md | Defer | Pattern covered in other tools |

## Tasks / Subtasks

- [x] Task 1: Extract shared test helpers (AC: #1)
  - [x] 1.1: Create `packages/iris-dev-mcp/src/__tests__/test-helpers.ts` with unified `createMockHttp()`, `createMockCtx(atelierVersion?)`, and `envelope(result, console?)`
  - [x] 1.2: Update `compile.test.ts` — remove local helpers, import from test-helpers
  - [x] 1.3: Update `doc.test.ts` — remove local helpers, import from test-helpers
  - [x] 1.4: Update `format.test.ts` — remove local helpers, import from test-helpers
  - [x] 1.5: Update `intelligence.test.ts` — remove local helpers, import from test-helpers
  - [x] 1.6: Update `server.test.ts` — remove local helpers, import from test-helpers
  - [x] 1.7: Update `sql.test.ts` — remove local helpers, import from test-helpers
  - [x] 1.8: Run `pnpm test` and verify all 235 tests pass (128 shared + 107 dev)

- [x] Task 2: Add paginate() to ToolContext (AC: #2)
  - [x] 2.1: Add `paginate` function to `ToolContext` interface in `packages/shared/src/tool-types.ts`
  - [x] 2.2: Update `buildToolContext()` in `packages/shared/src/server-base.ts` to include paginate method
  - [x] 2.3: Update `iris.doc.list` tool in `packages/iris-dev-mcp/src/tools/doc.ts` to use `ctx.paginate()` for results
  - [x] 2.4: Add unit tests for ToolContext pagination in `packages/shared/src/__tests__/server-base.test.ts`
  - [x] 2.5: Update mock `createMockCtx()` in test-helpers to include a mock `paginate` function
  - [x] 2.6: Run full test suite

- [x] Task 3: Create Atelier API reference document (AC: #3)
  - [x] 3.1: Catalog all endpoints from iris-dev-mcp tools (doc, compile, format, intelligence, sql, server)
  - [x] 3.2: Document HTTP method, URL pattern, request body format, response format, minimum API version for each
  - [x] 3.3: Add source references to irislib/%Atelier and irislib/%Api
  - [x] 3.4: Write to `_bmad-output/planning-artifacts/research/atelier-api-reference.md`

## Dev Notes

### Task 1: Test Helper Consolidation

**Current state:** 6 test files define nearly identical helpers with minor variations:
- `createMockHttp()` — identical across all 6 files
- `createMockCtx()` — 4 files use fixed `atelierVersion: 7`, 2 files accept optional parameter
- `envelope()` — `doc.test.ts` omits the `console` parameter, all others accept optional `console: string[]`

**Unified API for test-helpers.ts:**
```typescript
// Most permissive signatures — superset of all variations
export function createMockHttp() { ... }  // vi.fn() for get/put/delete/post/head
export function createMockCtx(http?, atelierVersion = 7) { ... }  // optional version param
export function envelope(result, console: string[] = []) { ... }  // always accept console
```

**Files to update:**
- `packages/iris-dev-mcp/src/__tests__/compile.test.ts` (lines 7-46)
- `packages/iris-dev-mcp/src/__tests__/doc.test.ts` (lines 8-55)
- `packages/iris-dev-mcp/src/__tests__/format.test.ts` (lines 7-46)
- `packages/iris-dev-mcp/src/__tests__/intelligence.test.ts` (lines 7-46)
- `packages/iris-dev-mcp/src/__tests__/server.test.ts` (lines 7-46)
- `packages/iris-dev-mcp/src/__tests__/sql.test.ts` (lines 8-47)

### Task 2: Pagination on ToolContext

**Current architecture:**
- `McpServerBase` has `paginate<T>(items, cursor, pageSize?)` at line 320 of server-base.ts
- `ToolContext` (tool-types.ts:73-91) has `resolveNamespace()`, `http`, `atelierVersion`, `config` — no paginate
- `createToolContext()` in server-base.ts builds ToolContext but doesn't include paginate

**Implementation approach:**
1. Add `paginate: <T>(items: T[], cursor?: string, pageSize?: number) => PaginateResult<T>` to ToolContext
2. In `createToolContext()`, bind the server's paginate method: `paginate: this.paginate.bind(this)`
3. In `iris.doc.list` handler, wrap the result array with `ctx.paginate(docs, args.cursor)` and return paginated content + nextCursor

**PaginateResult type** (already defined in server-base.ts):
```typescript
interface PaginateResult<T> { items: T[]; nextCursor?: string; }
```
Export PaginateResult from shared/index.ts if not already exported.

### Task 3: Atelier API Reference

Build from the endpoint catalog already identified in research. Include:
- All 17+ endpoints from iris-dev-mcp tools
- Source references: `irislib/%Atelier/REST.cls` (dispatch), `irislib/%Atelier/v7.cls` (v7 handler), `irislib/%Api/*.cls`
- Version requirements per endpoint
- Request/response body formats with examples

### Project Structure Notes

- All changes in `packages/shared/` and `packages/iris-dev-mcp/` — no new packages
- Test helpers stay in `__tests__/` directory (not exported from package)
- Reference doc goes in planning artifacts research folder (not source code)
- No changes to package.json dependencies needed

### References

- [Source: _bmad-output/implementation-artifacts/epic-2-retro-2026-04-05.md — Action Items]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — Full deferred list]
- [Source: packages/shared/src/server-base.ts#L320-L338 — paginate() implementation]
- [Source: packages/shared/src/tool-types.ts#L73-L91 — ToolContext interface]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None required — all tasks completed cleanly.

### Completion Notes List
- Task 1: Created shared test-helpers.ts with createMockHttp(), createMockCtx(), and envelope(). Replaced duplicated helpers in all 6 test files. Also fixed 11 pre-existing test failures caused by source code changes in commit 3039025 (server.ts trailing slash, intelligence.ts boolean params and result wrapping, sql.ts row object format).
- Task 2: Moved PaginateResult to tool-types.ts to avoid circular dependency. Added paginate() method to ToolContext interface and buildToolContext(). Updated iris.doc.list to return paginated `{ items, nextCursor }` structure with cursor parameter support. Added 6 new pagination tests in server-base.test.ts.
- Task 3: Created comprehensive Atelier API reference documenting 19 endpoints with HTTP method, URL pattern, request/response formats, min API version, and IRIS library source references.

### File List
- packages/iris-dev-mcp/src/__tests__/test-helpers.ts (new)
- packages/iris-dev-mcp/src/__tests__/compile.test.ts (modified)
- packages/iris-dev-mcp/src/__tests__/doc.test.ts (modified)
- packages/iris-dev-mcp/src/__tests__/format.test.ts (modified)
- packages/iris-dev-mcp/src/__tests__/intelligence.test.ts (modified)
- packages/iris-dev-mcp/src/__tests__/server.test.ts (modified)
- packages/iris-dev-mcp/src/__tests__/sql.test.ts (modified)
- packages/iris-dev-mcp/src/tools/doc.ts (modified)
- packages/shared/src/tool-types.ts (modified)
- packages/shared/src/server-base.ts (modified)
- packages/shared/src/index.ts (modified)
- packages/shared/src/__tests__/tool-types.test.ts (modified)
- packages/shared/src/__tests__/server-base.test.ts (modified)
- _bmad-output/planning-artifacts/research/atelier-api-reference.md (new)

### Review Findings
- [x] [Review][Patch] Missing JSDoc for `pageSize` param on `buildToolContext()` [packages/shared/src/server-base.ts:90] -- fixed
- [x] [Review][Defer] Mock paginate in test-helpers ignores cursor/pageSize args [packages/iris-dev-mcp/src/__tests__/test-helpers.ts:56] -- deferred, low priority
- [x] [Review][Defer] No integration test for doc.list cursor forwarding [packages/iris-dev-mcp/src/__tests__/doc.test.ts] -- deferred, covered by unit tests on both sides
- [x] [Review][Defer] Invalid cursor silently returns page 1 (pre-existing) [packages/shared/src/server-base.ts:decodeCursor] -- deferred, pre-existing

### Change Log
- 2026-04-06: Story 3.0 — Extracted shared test helpers, added ctx.paginate() to ToolContext, created Atelier API reference doc. Fixed 11 pre-existing test-source mismatches from commit 3039025.
- 2026-04-06: Code review — 1 patch applied (JSDoc), 3 deferred (low priority), 2 dismissed (noise). Status set to done.
