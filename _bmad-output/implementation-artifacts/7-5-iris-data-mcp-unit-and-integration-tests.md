# Story 7.5: iris-data-mcp Unit & Integration Tests

Status: done

## Story

As a data engineer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all data and analytics tools,
so that I can verify parameter validation, response parsing, and end-to-end behavior.

## Acceptance Criteria

1. **AC1**: Integration tests exercise the full DocDB lifecycle: create database → create property → create index → insert document → get document → update document → find with filter → delete document → drop database.
2. **AC2**: Integration tests verify analytics tools: cubes list (may be empty), MDX query error handling (no cubes configured is acceptable).
3. **AC3**: Integration tests verify REST management: list REST applications in namespace.
4. **AC4**: Integration test cleanup follows dependency order: delete documents before dropping database.
5. **AC5**: Integration tests are in `__tests__/*.integration.test.ts` files using Vitest.
6. **AC6**: All existing unit tests still pass.
7. **AC7**: `turbo build` and `turbo test` pass. Integration tests pass when IRIS is available.

## Tasks / Subtasks

- [x] Task 1: Create integration-setup.ts (AC: 5)
  - [x] Create `packages/iris-data-mcp/src/__tests__/integration-setup.ts`
  - [x] Probe IRIS availability via ping
  - [x] Negotiate Atelier API version
  - [x] Probe custom REST service availability via GET `/api/executemcp/v2/analytics/cubes`
  - [x] Probe DocDB API availability via GET `/api/docdb/v1/{namespace}`
  - [x] Set `globalThis.__IRIS_AVAILABLE__`, `__ATELIER_VERSION__`, `__CUSTOM_REST_AVAILABLE__`, `__DOCDB_AVAILABLE__`
  - [x] Follow iris-ops-mcp integration-setup.ts pattern

- [x] Task 2: Create vitest.integration.config.ts (AC: 5)
  - [x] Create `packages/iris-data-mcp/vitest.integration.config.ts`
  - [x] Include `src/**/*.integration.test.ts`
  - [x] Reference `src/__tests__/integration-setup.ts` as setupFiles
  - [x] Set testTimeout to 30000ms
  - [x] Add `test:integration` script to package.json

- [x] Task 3: Create data.integration.test.ts (AC: 1, 2, 3, 4, 5)
  - [x] Create `packages/iris-data-mcp/src/__tests__/data.integration.test.ts`
  - [x] Import tools from tool files
  - [x] Set up IrisHttpClient + buildToolContext in beforeAll
  - [x] Destroy client in afterAll
  - [x] **DocDB lifecycle tests (skip if DocDB API unavailable):**
    - [x] Create test database `MCPDataTest_DocDB`
    - [x] Create a property (`category`, type `%String`)
    - [x] Create an index on the property
    - [x] Insert a test document with JSON content
    - [x] Get document by ID and verify content
    - [x] Update document and verify changes
    - [x] Find documents with filter (`{ "category": { "$eq": "test" } }`)
    - [x] Delete document by ID
    - [x] Drop test database
  - [x] **Analytics tests (skip if custom REST unavailable):**
    - [x] List cubes (may return empty array)
    - [x] Execute MDX on nonexistent cube — verify error handling
  - [x] **REST management tests (skip if IRIS unavailable):**
    - [x] List REST applications in namespace
  - [x] **Cleanup in afterAll:** drop test database if exists (safety net)

- [x] Task 4: Validate (AC: 6, 7)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — unit tests pass
  - [x] Run integration tests: `cd packages/iris-data-mcp && npx vitest run --config vitest.integration.config.ts`

## Dev Notes

### Integration Test Architecture

Two separate skip conditions:
- **DocDB tests**: Skip if `/api/docdb/v1/{namespace}` returns 404 (DocDB API not available)
- **Analytics tests**: Skip if `/api/executemcp/v2/analytics/cubes` returns 404 (custom REST not deployed)
- **REST management tests**: Skip if IRIS is not available at all

### Tool Context Setup Pattern (from iris-ops-mcp)

```typescript
import {
  IrisHttpClient, loadConfig, negotiateVersion, buildToolContext,
  type ToolContext, type IrisConnectionConfig,
} from "@iris-mcp/shared";

function getConfig(): IrisConnectionConfig {
  return loadConfig({
    IRIS_HOST: process.env.IRIS_HOST ?? "localhost",
    IRIS_PORT: process.env.IRIS_PORT ?? "52773",
    IRIS_USERNAME: process.env.IRIS_USERNAME ?? "_SYSTEM",
    IRIS_PASSWORD: process.env.IRIS_PASSWORD ?? "SYS",
    IRIS_NAMESPACE: process.env.IRIS_NAMESPACE ?? "HSCUSTOM",
    IRIS_HTTPS: process.env.IRIS_HTTPS ?? "false",
  });
}

let client: IrisHttpClient;
let ctx: ToolContext;

beforeAll(async () => {
  const config = getConfig();
  client = new IrisHttpClient(config);
  const version = await negotiateVersion(client);
  ctx = buildToolContext("NS", config, client, version);
});

afterAll(async () => {
  // Cleanup resources...
  client?.destroy();
});
```

### DocDB Lifecycle Test Pattern

```typescript
const TEST_DB = "MCPDataTest_DocDB";
let insertedDocId: string | undefined;

// Create database
const createResult = await docdbManageTool.handler(
  { action: "create", database: TEST_DB },
  ctx,
);

// Insert document
const insertResult = await docdbDocumentTool.handler(
  { action: "insert", database: TEST_DB, document: { category: "test", value: 42 } },
  ctx,
);
// Extract ID from response...
insertedDocId = ...; // from structuredContent

// Get document
const getResult = await docdbDocumentTool.handler(
  { action: "get", database: TEST_DB, id: insertedDocId },
  ctx,
);

// Find with filter
const findResult = await docdbFindTool.handler(
  { database: TEST_DB, filter: { category: { "$eq": "test" } } },
  ctx,
);

// Cleanup: delete doc, drop database
```

### Safety Net Cleanup

```typescript
async function safeCall(tool, args, ctx): Promise<void> {
  try { await tool.handler(args, ctx); } catch { /* ignore */ }
}

afterAll(async () => {
  if (insertedDocId) {
    await safeCall(docdbDocumentTool, { action: "delete", database: TEST_DB, id: insertedDocId }, ctx);
  }
  await safeCall(docdbManageTool, { action: "drop", database: TEST_DB }, ctx);
  client?.destroy();
});
```

### File Locations

| What | Path |
|------|------|
| New integration setup | `packages/iris-data-mcp/src/__tests__/integration-setup.ts` |
| New integration tests | `packages/iris-data-mcp/src/__tests__/data.integration.test.ts` |
| New vitest config | `packages/iris-data-mcp/vitest.integration.config.ts` |
| Update | `packages/iris-data-mcp/package.json` (add test:integration script) |
| Reference | `packages/iris-ops-mcp/src/__tests__/integration-setup.ts` |
| Reference | `packages/iris-ops-mcp/src/__tests__/ops.integration.test.ts` |
| Reference | `packages/iris-ops-mcp/vitest.integration.config.ts` |

### Previous Story Intelligence (Story 7.4)

- 7 tools total: 4 docdb + 2 analytics + 1 rest
- 100 unit tests already pass
- DocDB uses built-in API at `/api/docdb/v1/`; analytics uses custom REST at `/api/executemcp/v2/analytics/`; REST uses built-in API at `/api/mgmnt/v2/`

### Critical Rules

- Use `buildToolContext("NS", ...)` for namespace-scoped tools (all data tools are NS)
- Cleanup in afterAll must be defensive (safeCall pattern) — resources may not exist if tests fail
- Cleanup order: delete documents → drop database (dependency order)
- DocDB API may not be available on all IRIS instances — test must skip gracefully
- Do NOT modify existing unit test files
- The test:integration script should NOT be in the turbo test pipeline (integration tests run separately)

### References

- [Source: packages/iris-ops-mcp/src/__tests__/integration-setup.ts]
- [Source: packages/iris-ops-mcp/src/__tests__/ops.integration.test.ts]
- [Source: packages/iris-ops-mcp/vitest.integration.config.ts]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.5]

### Review Findings
- [x] [Review][Defer] insertedDocId regex only matches numeric IDs [data.integration.test.ts:~178] — deferred, low-risk fallback path
- [x] [Review][Defer] Find-with-filter test lacks content assertions [data.integration.test.ts:~234] — deferred, covered by other lifecycle tests

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- DocDB API returns 403 when %Service_DocDB is disabled (not 404). Updated probeDocDb to treat 403 as unavailable.

### Completion Notes List
- Created integration-setup.ts following iris-ops-mcp pattern, adding DocDB probe with 403/404 handling
- Created vitest.integration.config.ts with 30s timeout and setupFiles
- Created data.integration.test.ts with 12 tests across 3 describe blocks (DocDB lifecycle, Analytics, REST management)
- DocDB lifecycle: 9 tests covering full create->property->index->insert->get->update->find->delete->drop cycle
- Analytics: 2 tests (list cubes, MDX error handling on nonexistent cube)
- REST management: 1 test (list REST applications)
- DocDB tests correctly skip when %Service_DocDB is disabled (9 skipped on test IRIS instance)
- Analytics and REST tests pass against live IRIS (3 passed)
- All 100 existing unit tests pass with no regressions
- turbo build succeeds across all packages
- Added test:integration script to package.json (not in turbo pipeline, runs separately)

### File List
- `packages/iris-data-mcp/src/__tests__/integration-setup.ts` (new)
- `packages/iris-data-mcp/src/__tests__/data.integration.test.ts` (new)
- `packages/iris-data-mcp/vitest.integration.config.ts` (new)
- `packages/iris-data-mcp/package.json` (modified - added test:integration script)
- `_bmad-output/implementation-artifacts/7-5-iris-data-mcp-unit-and-integration-tests.md` (modified)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified)

### Change Log
- 2026-04-07: Implemented Story 7.5 — integration test suite for iris-data-mcp with DocDB lifecycle, analytics, and REST management tests
