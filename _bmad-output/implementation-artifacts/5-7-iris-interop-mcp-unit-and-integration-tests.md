# Story 5.7: iris-interop-mcp Unit & Integration Tests

Status: done

## Story

As an integration engineer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all interoperability tools,
so that I can verify parameter validation, response parsing, and end-to-end behavior.

## Acceptance Criteria

1. **AC1**: Integration tests create a test production and confirm via `iris.production.status`.
2. **AC2**: Integration tests start and stop the test production via `iris.production.control`.
3. **AC3**: Integration tests retrieve config item settings via `iris.production.item`.
4. **AC4**: Integration tests get/set auto-start via `iris.production.autostart`.
5. **AC5**: Integration tests query event logs via `iris.production.logs`.
6. **AC6**: Integration tests query queue status via `iris.production.queues`.
7. **AC7**: Integration tests list adapters via `iris.production.adapters`.
8. **AC8**: Integration tests create a test credential and verify via `iris.credential.list`.
9. **AC9**: Integration tests set/get a lookup table entry via `iris.lookup.manage`.
10. **AC10**: Integration tests export and re-import a lookup table via `iris.lookup.transfer`.
11. **AC11**: Integration tests list rules and transforms (if any exist in test namespace).
12. **AC12**: Cleanup follows dependency order: stop production, remove credentials/lookups, delete production.
13. **AC13**: Integration tests are in `__tests__/*.integration.test.ts` using Vitest.
14. **AC14**: Unit tests for every tool exist in `__tests__/*.test.ts` (already completed in Stories 5.2-5.6).
15. **AC15**: `turbo build` succeeds and all tests pass.

## Tasks / Subtasks

- [x] Task 1: Create integration test setup (AC: 13)
  - [x] Create `packages/iris-interop-mcp/src/__tests__/integration-setup.ts`
  - [x] Probe IRIS availability, negotiate Atelier version, check custom REST service
  - [x] Export globals: `__IRIS_AVAILABLE__`, `__ATELIER_VERSION__`, `__CUSTOM_REST_AVAILABLE__`
  - [x] Follow iris-admin-mcp integration-setup.ts pattern exactly

- [x] Task 2: Create integration test file (AC: 1-12)
  - [x] Create `packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts`
  - [x] Import all tool definitions from respective tool modules
  - [x] Build shared `ToolContext` with real `IrisHttpClient`
  - [x] Test flow in dependency order:
    1. Create test production → verify status
    2. Start production → verify running
    3. Get config items → verify item details
    4. Get/set auto-start
    5. Query logs, queues, adapters
    6. Create credential → list to verify (no passwords)
    7. Set lookup entry → get to verify → export/import
    8. List rules and transforms (verify returns array, may be empty)
  - [x] Cleanup in reverse dependency order in afterAll:
    1. Delete lookup entries
    2. Delete credentials
    3. Stop production
    4. Delete production

- [x] Task 3: Update vitest.config.ts for integration tests
  - [x] Ensure integration tests are excluded from normal `vitest run`
  - [x] Create integration test config or test script that includes `*.integration.test.ts`

- [x] Task 4: Verify existing unit test coverage (AC: 14)
  - [x] Confirm unit tests exist for all 19 tools (from Stories 5.2-5.6)
  - [x] Run full test suite: `turbo test`

- [x] Task 5: Final validation (AC: 15)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all unit tests pass
  - [x] Run integration tests against real IRIS

## Dev Notes

### Integration Test Pattern (from iris-admin-mcp)

**Setup file** (`integration-setup.ts`):
- Probes IRIS with `ping()` and `negotiateVersion()`
- Probes custom REST with GET to `/api/executemcp/v2/config/namespace`
- Sets `globalThis.__IRIS_AVAILABLE__`, `__ATELIER_VERSION__`, `__CUSTOM_REST_AVAILABLE__`
- Tests use `describe.skipIf(!REST_OK)` to gracefully skip when IRIS unavailable

**Test file structure:**
```typescript
const IRIS_OK = globalThis.__IRIS_AVAILABLE__;
const REST_OK = globalThis.__CUSTOM_REST_AVAILABLE__;

let client: IrisHttpClient;
let ctx: ToolContext;

beforeAll(async () => {
  if (!REST_OK) return;
  const config = loadConfig({ ... });
  client = new IrisHttpClient(config);
  ctx = buildToolContext(client, config.namespace);
});

afterAll(async () => {
  if (!REST_OK) return;
  // Cleanup in reverse dependency order
  // ...
  client?.destroy();
});

describe.skipIf(!REST_OK)("Interop Integration", () => {
  // Tests in dependency order...
});
```

**Handler invocation pattern:**
```typescript
const result = await productionManageTool.handler(
  { action: "create", name: "Test.MCPIntegration" },
  ctx
);
expect(result.content[0].type).toBe("text");
const data = JSON.parse(result.content[0].text);
```

### Key Differences from Admin Integration Tests

- Interop tools operate in the TARGET namespace, not %SYS
- Production lifecycle has strict ordering: create → start → test → stop → delete
- Credentials and lookups must be cleaned up before production deletion
- Auto-start test should restore original value after test
- Some tools (rules, transforms) may return empty lists — that's OK for test namespace

### Test Resource Names

Use `MCPInteropTest` prefix:
- Production: `MCPInteropTest.TestProduction`
- Credential: `MCPInteropTestCred`
- Lookup table: `MCPInteropTestTable`
- Lookup key: `testKey`

### File Locations

| What | Path |
|------|------|
| Reference setup | `packages/iris-admin-mcp/src/__tests__/integration-setup.ts` |
| Reference tests | `packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts` |
| New setup | `packages/iris-interop-mcp/src/__tests__/integration-setup.ts` |
| New tests | `packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts` |
| Vitest config | `packages/iris-interop-mcp/vitest.config.ts` |
| All tool files | `packages/iris-interop-mcp/src/tools/*.ts` |
| Existing unit tests | `packages/iris-interop-mcp/src/__tests__/*.test.ts` |

### Previous Story Intelligence (Story 5.6)

- 19 tools total, 156 unit tests passing
- All ObjectScript compiles on IRIS
- Live verification passed for all endpoints
- Interop.cls has 19 class methods covering all domains

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.7]
- [Source: packages/iris-admin-mcp/src/__tests__/integration-setup.ts]
- [Source: packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None needed — all tests passed on first run.

### Completion Notes List

- Created integration-setup.ts following iris-admin-mcp pattern exactly (probes IRIS, Atelier version, custom REST)
- Created interop.integration.test.ts with 21 integration tests covering all 12 ACs
- Tests exercise full production lifecycle: create -> start -> status -> items -> autostart -> logs -> queues -> adapters -> credentials -> lookups -> transfer -> rules/transforms -> cleanup
- Cleanup runs in reverse dependency order (lookups -> credentials -> stop production -> delete production)
- Created vitest.integration.config.ts with 30s timeout, matching admin-mcp pattern
- Existing vitest.config.ts already excluded *.integration.test.ts from normal runs
- All 156 unit tests pass (9 test files, 19 tools covered)
- All 21 integration tests pass against real IRIS
- turbo build succeeds across all packages
- Credential list test verifies passwords are never exposed (AC8 NFR6 compliance)
- Rules and transforms tests accept empty results for test namespace (AC11)

### Review Findings

- [x] [Review][Patch] Remove unused imports (IrisApiError, ruleGetTool, transformTestTool, interopRestTool) [interop.integration.test.ts] -- FIXED
- [x] [Review][Defer] probeCustomRest uses duck-typing instead of instanceof IrisApiError [integration-setup.ts] -- deferred, pre-existing pattern
- [x] [Review][Defer] No integration tests for interopRestTool, ruleGetTool, transformTestTool -- deferred, not required by ACs

### Change Log

- 2026-04-06: Implemented Story 5.7 — integration test setup, 21 integration tests, vitest integration config

### File List

- packages/iris-interop-mcp/src/__tests__/integration-setup.ts (new)
- packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts (new)
- packages/iris-interop-mcp/vitest.integration.config.ts (new)
