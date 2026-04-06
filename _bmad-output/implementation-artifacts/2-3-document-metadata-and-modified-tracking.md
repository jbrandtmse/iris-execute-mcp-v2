# Story 2.3: Document Metadata & Modified Tracking

Status: done

## Story

As a developer,
I want to check if a document exists and find documents that changed recently,
So that I can efficiently track modifications without downloading full document contents.

## Acceptance Criteria

1. **Given** an existing document name **When** `iris.doc.get` is called with a metadata-only option (e.g., `metadataOnly: true`) **Then** the response includes the document's existence status and last modification timestamp without transferring content (via HEAD on the Atelier /doc/ endpoint)
2. **Given** a timestamp **When** `iris.doc.list` is called with a `modifiedSince` filter parameter **Then** only documents modified since that timestamp are returned **And** an optional namespace parameter scopes the query
3. **Given** a document that does not exist **When** `iris.doc.get` is called with `metadataOnly: true` **Then** the response indicates the document does not exist without raising an error
4. **And** these capabilities are modes of existing tools (iris.doc.get and iris.doc.list), not separate tools — keeping iris-dev-mcp at exactly 20 tools per the PRD specification
5. **And** responses complete within 2 seconds (NFR1)
6. **And** unit tests verify metadata retrieval, modified-since filtering, and not-found handling

## Tasks / Subtasks

- [x] Task 1: Extend iris.doc.get with metadataOnly mode (AC: #1, #3)
  - [x] In `packages/iris-dev-mcp/src/tools/doc.ts`, add `metadataOnly: boolean` optional param to iris.doc.get inputSchema
  - [x] When `metadataOnly: true`, use `ctx.http.head()` on `/api/atelier/v{N}/{ns}/doc/{name}` instead of GET
  - [x] Extract `Last-Modified` or `ETag` headers from the HEAD response for timestamp info
  - [x] Return `{ exists: true, name, timestamp }` as structured content on success
  - [x] On 404, return `{ exists: false, name }` with `isError: false` (not an error — AC #3)
  - [x] Note: `IrisHttpClient.head()` currently returns `void` — may need to modify to return status/headers, or use `headRequest()` which returns `HeadResponse` with status and headers
- [x] Task 2: Extend iris.doc.list with modifiedSince filter (AC: #2)
  - [x] Add `modifiedSince: string` optional param to iris.doc.list inputSchema (ISO 8601 timestamp)
  - [x] Use the Atelier API endpoint for modified documents: `GET /api/atelier/v{N}/{ns}/modified/{timestamp}`
  - [x] When `modifiedSince` is provided, call the modified endpoint instead of docnames
  - [x] Return list of modified document names with their timestamps
- [x] Task 3: Add unit tests (AC: #6)
  - [x] Create or extend `packages/iris-dev-mcp/src/__tests__/doc.test.ts`
  - [x] Test: iris.doc.get with metadataOnly=true calls HEAD, returns exists/timestamp
  - [x] Test: iris.doc.get with metadataOnly=true on 404 returns exists=false, isError=false
  - [x] Test: iris.doc.get without metadataOnly still works as before (regression)
  - [x] Test: iris.doc.list with modifiedSince calls modified endpoint
  - [x] Test: iris.doc.list without modifiedSince still calls docnames (regression)
- [x] Task 4: Validate (AC: #5)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass
  - [x] Run `turbo lint` — no lint errors

## Dev Notes

### Atelier API Endpoints for Metadata

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| Document HEAD | HEAD | `/api/atelier/v{N}/{ns}/doc/{name}` | Returns headers only (Last-Modified, ETag) |
| Modified docs | GET | `/api/atelier/v{N}/{ns}/modified/{timestamp}` | Returns docs modified since timestamp |

### IrisHttpClient.head() Limitation

The current `head()` method in IrisHttpClient returns `void`. The underlying `headRequest()` method (refactored in Story 2.0) returns the raw Response via `executeFetch()`. Options:
1. **Preferred**: Use the http client's internal methods or add a `headWithResponse()` that returns status and headers
2. **Alternative**: Modify `head()` to return `{ status: number, headers: Headers }` — this is a breaking change but no consumers exist yet besides integration tests
3. Check if `executeFetch()` is accessible or if a new public method is needed

### Key Files

| File | Action |
|------|--------|
| `packages/iris-dev-mcp/src/tools/doc.ts` | Modify — extend get and list tools |
| `packages/iris-dev-mcp/src/__tests__/doc.test.ts` | Modify — add metadata/modified tests |
| `packages/shared/src/http-client.ts` | May need modification if head() needs to return headers |

### Previous Story Intelligence

- Story 2.2 established doc.ts with 4 tools and URLSearchParams pattern
- Story 2.0 refactored headRequest into executeFetch() — check if head() can be enhanced to return response metadata
- IrisHttpClient.head() at `packages/shared/src/http-client.ts` — currently returns `Promise<void>`
- HeadResponse type may already exist from Story 1.3 — check headRequest() return type

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 2.3 lines 557-580]
- [Source: packages/shared/src/http-client.ts — head() and headRequest() methods]
- [Source: packages/iris-dev-mcp/src/tools/doc.ts — existing tool definitions]
- [Source: sources/vscode-objectscript/src/api/index.ts — HEAD doc endpoint reference]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None — clean implementation with no debug cycles needed.

### Completion Notes List
- Modified `IrisHttpClient.head()` to return `HeadResponse` (status + headers) instead of `void`. This is a minor breaking change but no external consumers existed — only internal usage in `health.ts` and tests (both updated).
- Added `HeadResponse` type export to `@iris-mcp/shared` barrel.
- Extended `iris.doc.get` with `metadataOnly: boolean` optional param. When true, uses HEAD request to check document existence and extract Last-Modified/ETag headers without downloading content.
- On 404 with metadataOnly, returns `{ exists: false, name }` with `isError: false` (not an error condition per AC #3).
- Extended `iris.doc.list` with `modifiedSince: string` optional param. When provided, calls the Atelier `/modified/{timestamp}` endpoint instead of `/docnames/`.
- Added 7 new unit tests covering metadataOnly (success, 404, non-404 error, regression) and modifiedSince (success, namespace override, regression).
- Updated 1 existing head() test in http-client.test.ts to expect HeadResponse instead of undefined.
- All tools remain as modes of existing iris.doc.get and iris.doc.list — no new tools added (AC #4).
- Build, test (33 dev tests, 28 shared tests), and lint all pass.

### Review Findings
- [x] [Review][Patch] `modifiedSince` timestamp not URL-encoded in path — applied `encodeURIComponent()` to prevent malformed URLs from timestamps containing `+` timezone offsets [packages/iris-dev-mcp/src/tools/doc.ts:321]
- [x] [Review][Defer] `metadataOnly` + `format` silently ignores format param — deferred, low severity design choice [packages/iris-dev-mcp/src/tools/doc.ts:61]
- [x] [Review][Defer] No test for `metadataOnly` with namespace override — deferred, code path identical to non-metadata path [packages/iris-dev-mcp/src/__tests__/doc.test.ts]

### Change Log
- 2026-04-05: Implemented Story 2.3 — document metadata and modified tracking

### File List
- `packages/shared/src/http-client.ts` — Added HeadResponse type, changed head()/headRequest() to return HeadResponse
- `packages/shared/src/index.ts` — Added HeadResponse type export
- `packages/shared/src/__tests__/http-client.test.ts` — Updated head() test to expect HeadResponse
- `packages/iris-dev-mcp/src/tools/doc.ts` — Added metadataOnly param to docGetTool, modifiedSince param to docListTool
- `packages/iris-dev-mcp/src/__tests__/doc.test.ts` — Added 7 new tests for metadata and modified-since features
