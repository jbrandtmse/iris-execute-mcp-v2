# Story 2.5: Code Intelligence Tools

Status: done

## Story

As a developer,
I want to inspect class structures, search across code, and look up macro definitions,
So that I can understand and navigate the IRIS codebase through my AI assistant.

## Acceptance Criteria

1. **Given** a class document name **When** `iris.doc.index` is called **Then** the class structure is returned including methods, properties, parameters, and superclasses **And** each member includes its type, signature, and relevant metadata
2. **Given** a search query (text or regex pattern) **When** `iris.doc.search` is called with the pattern **Then** matching documents and locations are returned **And** options for regex, wildcard, and case-sensitivity are supported **And** an optional namespace parameter scopes the search
3. **Given** a macro name **When** `iris.macro.info` is called **Then** the macro definition, source location, and expanded value are returned
4. **Given** a search with no results **When** `iris.doc.search` returns empty **Then** an empty result set is returned (not an error)
5. **And** all three tools are annotated as `readOnlyHint: true`
6. **And** responses complete within 2 seconds (NFR1)

## Tasks / Subtasks

- [x] Task 1: Implement iris.doc.index tool (AC: #1)
  - [x] Create `packages/iris-dev-mcp/src/tools/intelligence.ts`
  - [x] iris.doc.index definition:
    - inputSchema: `{ name: string, namespace?: string }`
    - scope: "NS", annotations: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
    - Handler: `POST /api/atelier/v{N}/{ns}/action/index` — Atelier returns class index/structure
    - Alternative: The Atelier `/action/index` endpoint may be more appropriate — research in vscode-objectscript sources
    - Return structured class members (methods, properties, parameters, superclasses)
- [x] Task 2: Implement iris.doc.search tool (AC: #2, #4)
  - [x] iris.doc.search definition:
    - inputSchema: `{ query: string, regex?: boolean, word?: boolean, case?: boolean, type?: string, namespace?: string, max?: number }`
    - scope: "NS", annotations: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
    - Handler: `GET /api/atelier/v{N}/{ns}/action/search` with search parameters (v2+ required)
    - Empty results return empty array, not error (AC #4)
    - Reference: vscode-objectscript search API in `sources/vscode-objectscript/src/api/index.ts`
- [x] Task 3: Implement iris.macro.info tool (AC: #3)
  - [x] Create in same intelligence.ts file
  - [x] iris.macro.info definition:
    - inputSchema: `{ name: string, document?: string, namespace?: string, includes?: string[] }`
    - scope: "NS", annotations: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
    - Handler: Atelier `action/getmacrodefinition` and `action/getmacrolocation` endpoints (v2+ required)
    - Return: macro definition text, source location (file + line), expanded value
- [x] Task 4: Wire tools into tools/index.ts
  - [x] Import all 3 tools and add to exported array
- [x] Task 5: Add unit tests
  - [x] Create `packages/iris-dev-mcp/src/__tests__/intelligence.test.ts`
  - [x] Test: iris.doc.index returns class structure with methods/properties/params
  - [x] Test: iris.doc.index on non-class document returns appropriate response
  - [x] Test: iris.doc.search with text query returns matches
  - [x] Test: iris.doc.search with regex option passes correct params
  - [x] Test: iris.doc.search with no results returns empty array
  - [x] Test: iris.macro.info returns definition and source location
  - [x] Test: all tools have readOnlyHint: true annotation
- [x] Task 6: Validate
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass
  - [x] Run `turbo lint` — no lint errors

## Dev Notes

### Atelier API Endpoints

Research these endpoints in `sources/vscode-objectscript/src/api/index.ts`:

| Tool | Method | Endpoint | Notes |
|------|--------|----------|-------|
| iris.doc.index | POST | `/api/atelier/v{N}/{ns}/action/index` | Body: `["ClassName.cls"]` — returns class structure |
| iris.doc.search | POST | `/api/atelier/v{N}/{ns}/action/search` | Body: search params with query, regex, word, case options |
| iris.macro.info | POST | `/api/atelier/v{N}/{ns}/action/getmacroexpansion` or similar | Check exact endpoint name |

From vscode-objectscript reference:
```typescript
// Index (class structure)
public actionIndex(docs: string[]): Promise<Atelier.Response<Atelier.IndexResult[]>> {
  return this.request(1, "POST", `${this.ns}/action/index`, docs);
}

// Search
public actionSearch(params: SearchParams): Promise<Atelier.Response<Atelier.SearchResult[]>> {
  return this.request(1, "POST", `${this.ns}/action/search`, null, params);
}
```

### Key Files

| File | Action |
|------|--------|
| `packages/iris-dev-mcp/src/tools/intelligence.ts` | Create — 3 tool definitions |
| `packages/iris-dev-mcp/src/tools/index.ts` | Modify — add intelligence tools |
| `packages/iris-dev-mcp/src/__tests__/intelligence.test.ts` | Create — unit tests |

### Previous Story Intelligence

- Story 2.2-2.4 established tool patterns: atelierPath(), URLSearchParams, error handling
- POST endpoints use ctx.http.post() with body and optional query params
- 163 tests currently passing (119 shared + 44 dev)
- Tool count will go from 5 to 8 after this story

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 2.5 lines 618-647]
- [Source: sources/vscode-objectscript/src/api/index.ts — actionIndex, actionSearch, macro endpoints]
- [Source: packages/iris-dev-mcp/src/tools/doc.ts — handler pattern reference]
- [Source: packages/iris-dev-mcp/src/tools/compile.ts — POST handler pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- No debug issues encountered. Clean implementation.

### Completion Notes List
- Implemented iris.doc.index using POST to `/action/index` (v1+), accepts document name array
- Implemented iris.doc.search using GET to `/action/search` with query params (v2+, uses requireMinVersion)
  - Key finding: vscode-objectscript source shows actionSearch is GET not POST (corrected from story spec)
  - Added full parameter support: query, regex, word, case, wild, files, sys, gen, max
  - Empty results return `[]` not error (AC #4)
- Implemented iris.macro.info using parallel calls to `getmacrodefinition` + `getmacrolocation` (v2+)
  - Both definition and location fetched concurrently via Promise.all for performance
- All 3 tools annotated with readOnlyHint: true (AC #5)
- Updated index.test.ts to reflect tool count increase from 5 to 8
- 20 new tests in intelligence.test.ts, 184 total tests passing (119 shared + 65 dev)
- Build, test, and lint all pass clean

### File List
- `packages/iris-dev-mcp/src/tools/intelligence.ts` (created) — 3 tool definitions
- `packages/iris-dev-mcp/src/tools/index.ts` (modified) — added intelligence tool imports and registrations
- `packages/iris-dev-mcp/src/__tests__/intelligence.test.ts` (created) — 20 unit tests
- `packages/iris-dev-mcp/src/__tests__/index.test.ts` (modified) — updated tool count from 5 to 8

### Change Log
- 2026-04-05: Implemented iris.doc.index, iris.doc.search, iris.macro.info tools with full test coverage
