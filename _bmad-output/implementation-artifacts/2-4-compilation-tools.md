# Story 2.4: Compilation Tools

Status: done

## Story

As a developer,
I want to compile ObjectScript documents with detailed error feedback,
So that I can fix compilation issues directly through my AI assistant without switching to the Management Portal.

## Acceptance Criteria

1. **Given** one or more valid document names **When** `iris.doc.compile` is called with default flags **Then** synchronous compilation is performed via the Atelier API **And** the response includes success/failure status and compilation time
2. **Given** compilation flags (e.g., "ck", "cku") **When** `iris.doc.compile` is called with the flags parameter **Then** the specified flags are passed to the Atelier compilation endpoint
3. **Given** a large package or multiple documents **When** `iris.doc.compile` is called with an async option **Then** asynchronous compilation is queued and the response includes a job ID for polling completion status
4. **Given** source code with errors **When** compilation fails **Then** detailed compilation errors are returned including error message, source document, line number, and character position **And** the response uses `isError: false` (compilation completed, errors are in the result data)
5. **Given** a single class compilation **When** the compilation runs **Then** it completes within 30 seconds (NFR2)
6. **Given** a full package compilation **When** the compilation runs **Then** it completes within 120 seconds (NFR2)
7. **And** the tool is annotated as `readOnlyHint: false, destructiveHint: false, idempotentHint: true`
8. **And** unit tests with mocked HTTP responses verify compilation flag handling, async polling, and error parsing

## Tasks / Subtasks

- [x] Task 1: Implement iris.doc.compile tool (AC: #1, #2, #4, #7)
  - [x] Create `packages/iris-dev-mcp/src/tools/compile.ts`
  - [x] Implement `iris.doc.compile` tool definition:
    - inputSchema: `{ doc: string | string[], flags?: string, async?: boolean, namespace?: string }`
    - scope: "NS", annotations: `{ readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
  - [x] Synchronous compilation handler: `POST /api/atelier/v{N}/{ns}/action/compile` with body `[docName1, docName2, ...]` and query param `flags`
  - [x] Parse compilation response — extract status, errors with line/char positions, compilation time
  - [x] Compilation errors should return `isError: false` with errors in structured content (AC #4)
  - [x] Only return `isError: true` for transport/connection failures
- [x] Task 2: Implement async compilation mode (AC: #3)
  - [x] When `async: true`, use `POST /api/atelier/v{N}/{ns}/action/compile` with async query param
  - [x] Atelier async compile returns a job ID — return this to the caller
  - [x] Research the exact Atelier API pattern for async compilation and polling (check sources/vscode-objectscript)
  - [x] If async compile polling endpoint exists, consider a second handler mode or document the polling approach
- [x] Task 3: Wire tool into tools/index.ts
  - [x] Import compile tool from `./compile.js`
  - [x] Add to the exported tools array
- [x] Task 4: Add unit tests (AC: #8)
  - [x] Create `packages/iris-dev-mcp/src/__tests__/compile.test.ts`
  - [x] Test: successful compilation returns success status
  - [x] Test: compilation flags are passed to endpoint
  - [x] Test: multiple documents compiled in single request
  - [x] Test: compilation errors parsed with line/char positions, isError: false
  - [x] Test: async mode returns job ID
  - [x] Test: connection failure returns isError: true
- [x] Task 5: Validate (AC: #5, #6)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass
  - [x] Run `turbo lint` — no lint errors

## Dev Notes

### Atelier Compilation API

| Operation | Method | Endpoint | Notes |
|-----------|--------|----------|-------|
| Compile | POST | `/api/atelier/v{N}/{ns}/action/compile` | Body: `["Doc1.cls","Doc2.cls"]`, Query: `flags=ck` |

Reference from vscode-objectscript (`sources/vscode-objectscript/src/api/index.ts`):
```typescript
public compile(docs: string[], flags?: string): Promise<Atelier.Response> {
  return this.request(1, "POST", `${this.ns}/action/compile`, docs, { flags });
}
```

### Compilation Response Format

The Atelier compile endpoint returns the standard envelope. On compilation errors:
```json
{
  "status": { "errors": [], "summary": "" },
  "console": ["Compilation started..."],
  "result": {
    "content": [
      {
        "name": "MyClass.cls",
        "status": "ERROR",
        "errors": [
          { "error": "ERROR #5540: ...", "line": 15, "char": 1 }
        ]
      }
    ]
  }
}
```

### Key Pattern: Compilation Errors Are NOT Tool Errors

Per AC #4, compilation errors should be returned as successful tool results with the error details in structured content. Only transport/connection failures should set `isError: true`. This matches the architecture pattern where the tool successfully executed (compilation ran) but the compiled code had issues.

### Key Files

| File | Action |
|------|--------|
| `packages/iris-dev-mcp/src/tools/compile.ts` | Create — compile tool definition |
| `packages/iris-dev-mcp/src/tools/index.ts` | Modify — add compile tool |
| `packages/iris-dev-mcp/src/__tests__/compile.test.ts` | Create — unit tests |

### Previous Story Intelligence

- Story 2.2 established tool handler pattern in doc.ts with atelierPath(), URLSearchParams, and error handling
- Story 2.3 showed how to extend tool capabilities with optional params
- IrisHttpClient.post() sends body as JSON, returns AtelierEnvelope<T>
- 152 tests currently passing (119 shared + 33 dev)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 2.4 lines 581-617]
- [Source: sources/vscode-objectscript/src/api/index.ts — compile method]
- [Source: packages/shared/src/http-client.ts — post() method]
- [Source: packages/iris-dev-mcp/src/tools/doc.ts — handler pattern reference]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None needed — implementation was straightforward with no debugging required.

### Completion Notes List
- Implemented `iris.doc.compile` tool with sync and async compilation modes via Atelier REST API
- Sync mode: POSTs document names to `/api/atelier/v{N}/{ns}/action/compile`, parses per-document errors with line/char positions, measures compilation time
- Async mode: Adds `async=1` query param, returns the Atelier response (job/tracking info) for caller polling
- Compilation errors return `isError: false` per AC #4 — only transport failures throw/propagate
- Tool annotations: `readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false`
- 11 unit tests cover: success, flags, multi-doc, error parsing, async mode, connection failure, namespace override, timing, combined params, annotations, console output
- Updated existing index.test.ts to account for 5th tool (was 4)
- Fixed TypeScript `exactOptionalPropertyTypes` compatibility for optional line/char fields
- Build, tests (44 dev + 119 shared = 163 total), and lint all pass

### File List
- `packages/iris-dev-mcp/src/tools/compile.ts` — Created: compile tool definition and handler
- `packages/iris-dev-mcp/src/tools/index.ts` — Modified: added compile tool import and export
- `packages/iris-dev-mcp/src/__tests__/compile.test.ts` — Created: 11 unit tests for compile tool
- `packages/iris-dev-mcp/src/__tests__/index.test.ts` — Modified: updated tool count assertions from 4 to 5

### Review Findings
- [x] [Review][Patch] Empty doc array not guarded — added early return when doc is empty array [compile.ts:83-88] — FIXED
- [x] [Review][Patch] Async mode missing explicit `isError: false` — added `isError: false` to async return [compile.ts:113] — FIXED
- [x] [Review][Patch] Async mode includes console unconditionally — made console conditional like sync mode [compile.ts:104-106] — FIXED
- [x] [Review][Patch] Type mismatch: `CompileResultContent` used as generic for async response — broadened post type, added cast for sync path [compile.ts:95,123] — FIXED
- [x] [Review][Defer] Test helper duplication across compile.test.ts and doc.test.ts — deferred, pre-existing pattern

### Change Log
- 2026-04-05: Implemented Story 2.4 — Compilation Tools (iris.doc.compile tool with sync/async modes, error parsing, 11 unit tests)
- 2026-04-05: Code review — fixed 4 patch findings (empty array guard, async isError, async console, type safety); 1 deferred (test helper duplication)
