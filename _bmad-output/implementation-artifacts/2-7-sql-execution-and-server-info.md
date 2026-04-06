# Story 2.7: SQL Execution & Server Info

Status: done

## Story

As a developer,
I want to execute SQL queries and retrieve IRIS server information through MCP tools,
So that I can query data and understand my IRIS environment without leaving the AI conversation.

## Acceptance Criteria

1. **Given** a valid SQL query **When** `iris.sql.execute` is called with the query string **Then** the query is executed via the Atelier API and results are returned with column names and row data **And** parameterized inputs are supported to prevent SQL injection **And** a configurable row limit parameter prevents unbounded result sets (default reasonable limit)
2. **Given** a SQL query **When** execution begins **Then** first results are returned within 5 seconds (NFR3)
3. **Given** an invalid SQL query **When** `iris.sql.execute` is called **Then** an MCP tool error is returned with the SQL error message
4. **Given** a connected IRIS instance **When** `iris.server.info` is called **Then** server information is returned including IRIS version, platform, and instance name **And** the tool has scope NONE (no namespace context)
5. **Given** a namespace name **When** `iris.server.namespace` is called **Then** namespace details are returned including associated databases and enabled features **And** the tool has scope NS (accepts namespace parameter)
6. **And** iris.sql.execute is annotated as `readOnlyHint: false` (can execute INSERT/UPDATE/DELETE)
7. **And** iris.server.info and iris.server.namespace are annotated as `readOnlyHint: true`

## Tasks / Subtasks

- [x] Task 1: Implement iris.sql.execute tool (AC: #1, #2, #3, #6)
  - [x] Create `packages/iris-dev-mcp/src/tools/sql.ts`
  - [x] iris.sql.execute definition:
    - inputSchema: `{ query: string, parameters?: unknown[], maxRows?: number, namespace?: string }`
    - scope: "NS", annotations: `{ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }`
  - [x] Handler: `POST /api/atelier/v{N}/{ns}/action/query` with query and parameters
  - [x] Parse response: extract column names and row data into structured result
  - [x] Default maxRows to a reasonable limit (e.g., 100 or 1000)
  - [x] SQL errors return isError: true with the SQL error message
  - [x] Research exact Atelier SQL execution endpoint in vscode-objectscript
- [x] Task 2: Implement iris.server.info tool (AC: #4)
  - [x] Create `packages/iris-dev-mcp/src/tools/server.ts`
  - [x] iris.server.info definition:
    - inputSchema: `{}` (no parameters needed)
    - scope: "NONE", annotations: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
  - [x] Handler: `GET /api/atelier/` — the root Atelier endpoint returns server info
  - [x] Parse response: extract IRIS version, platform, instance name
- [x] Task 3: Implement iris.server.namespace tool (AC: #5)
  - [x] iris.server.namespace definition:
    - inputSchema: `{ namespace?: string }`
    - scope: "NS", annotations: `{ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }`
  - [x] Handler: `GET /api/atelier/v{N}/{ns}` — namespace-level Atelier endpoint
  - [x] Parse response: extract namespace details (databases, features, etc.)
- [x] Task 4: Wire tools into tools/index.ts
  - [x] Import all 3 tools and add to exported array (total: 13 tools)
- [x] Task 5: Add unit tests
  - [x] Create `packages/iris-dev-mcp/src/__tests__/sql.test.ts`
  - [x] Create `packages/iris-dev-mcp/src/__tests__/server.test.ts`
  - [x] Test: iris.sql.execute returns columns and rows
  - [x] Test: iris.sql.execute with parameters passes them correctly
  - [x] Test: iris.sql.execute with maxRows limits results
  - [x] Test: iris.sql.execute with invalid SQL returns isError: true
  - [x] Test: iris.server.info returns version/platform/instance
  - [x] Test: iris.server.info has scope NONE
  - [x] Test: iris.server.namespace returns namespace details
  - [x] Test: iris.server.namespace accepts namespace override
  - [x] Test: annotations are correct for each tool
- [x] Task 6: Validate
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass
  - [x] Run `turbo lint` — no lint errors

### Review Findings

- [x] [Review][Patch] Add `maxRows` input validation (`.int().min(1)`) to prevent zero/negative/float values [sql.ts:35-38] -- FIXED by reviewer
- [x] [Review][Defer] Client-side maxRows truncation fetches all rows before slicing; investigate server-side limiting [sql.ts:80-82] -- deferred, optimization concern
- [x] [Review][Defer] Test helper duplication across test files (createMockHttp, createMockCtx, envelope) -- deferred, pre-existing pattern from Story 2-4

## Dev Notes

### Atelier API Endpoints

| Tool | Method | Endpoint | Notes |
|------|--------|----------|-------|
| iris.sql.execute | POST | `/api/atelier/v{N}/{ns}/action/query` | Body: `{ query: string, parameters?: any[] }` |
| iris.server.info | GET | `/api/atelier/` | Root endpoint returns server version info |
| iris.server.namespace | GET | `/api/atelier/v{N}/{ns}` | Namespace-level info endpoint |

From vscode-objectscript reference:
```typescript
// SQL query execution
public actionQuery(query: string, parameters: string[]): Promise<Atelier.Response<Atelier.QueryResult>> {
  return this.request(1, "POST", `${this.ns}/action/query`, [], { query, parameters });
}

// Server info (root)
public serverInfo(): Promise<Atelier.Response<Atelier.ServerInfo>> {
  return this.request(0, "GET", "");
}
```

### SQL Response Format

The Atelier query response typically returns:
```json
{
  "result": {
    "content": [
      { "columns": ["ID", "Name", "DOB"], "rows": [[1, "Smith", "1990-01-01"], ...] }
    ]
  }
}
```

### Key Files

| File | Action |
|------|--------|
| `packages/iris-dev-mcp/src/tools/sql.ts` | Create — SQL execution tool |
| `packages/iris-dev-mcp/src/tools/server.ts` | Create — server info tools |
| `packages/iris-dev-mcp/src/tools/index.ts` | Modify — add sql and server tools |
| `packages/iris-dev-mcp/src/__tests__/sql.test.ts` | Create — SQL tests |
| `packages/iris-dev-mcp/src/__tests__/server.test.ts` | Create — server info tests |

### Previous Story Intelligence

- Stories 2.2-2.6 established tool patterns for all HTTP methods
- POST with body and query params used in compile.ts and intelligence.ts
- GET with no body used in doc.ts and intelligence.ts
- Scope "NONE" used for first time in iris.server.info — verify resolveNamespace("") works
- 199 tests currently passing (119 shared + 80 dev), 10 tools registered

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 2.7 lines 681-715]
- [Source: sources/vscode-objectscript/src/api/index.ts — actionQuery, serverInfo methods]
- [Source: packages/shared/src/tool-types.ts — ToolScope "NONE" definition]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
No debug issues encountered.

### Completion Notes List
- Implemented iris.sql.execute tool with POST to /api/atelier/v{N}/{ns}/action/query, parameterized queries, configurable maxRows (default 1000), and truncation reporting
- Implemented iris.server.info tool with GET to /api/atelier/ (scope NONE, no namespace concept)
- Implemented iris.server.namespace tool with GET to /api/atelier/v{N}/{ns}/ (scope NS)
- Wired all 3 tools into tools/index.ts (total: 13 tools)
- Added 11 unit tests for sql.test.ts covering: columns/rows, parameters, maxRows, default limit, SQL errors, namespace override, annotations, scope, error propagation, empty params, empty results
- Added 10 unit tests for server.test.ts covering: server info returns data, scope NONE, annotations, errors, no params required, namespace details, namespace override, scope NS, annotations, errors
- Updated index.test.ts to expect 13 tools and include all 3 new tool names
- All 101 dev tests pass (was 80), 119 shared tests pass, build and lint clean

### Change Log
- 2026-04-05: Implemented Story 2.7 — SQL execution and server info tools (3 tools, 21 new tests)

### File List
- packages/iris-dev-mcp/src/tools/sql.ts (created)
- packages/iris-dev-mcp/src/tools/server.ts (created)
- packages/iris-dev-mcp/src/tools/index.ts (modified)
- packages/iris-dev-mcp/src/__tests__/sql.test.ts (created)
- packages/iris-dev-mcp/src/__tests__/server.test.ts (created)
- packages/iris-dev-mcp/src/__tests__/index.test.ts (modified)
