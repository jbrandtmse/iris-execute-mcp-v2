# Story 6.8: iris-ops-mcp Unit & Integration Tests

Status: done

## Story

As an operations engineer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all operations and monitoring tools,
so that I can verify parameter validation, response parsing, and end-to-end behavior.

## Acceptance Criteria

1. **AC1**: Integration tests against a real IRIS instance verify:
   - `iris.metrics.system` returns metrics
   - `iris.metrics.alerts` returns alerts (possibly empty)
   - `iris.metrics.interop` returns interop metrics
   - `iris.jobs.list` returns running jobs
   - `iris.locks.list` returns locks (possibly empty)
   - `iris.journal.info` returns journal info
   - `iris.mirror.status` returns mirror status (or "not configured")
   - `iris.audit.events` returns audit events for a recent time range
   - `iris.database.check` returns database status
   - `iris.license.info` returns license details
   - `iris.ecp.status` returns ECP status (or "not configured")
   - `iris.task.list` returns scheduled tasks
   - `iris.task.manage` creates a test task and `iris.task.list` confirms it exists
   - `iris.task.run` triggers the test task and `iris.task.history` shows execution
   - `iris.config.manage` retrieves a known config parameter
2. **AC2**: Each integration test cleans up any created resources (test tasks) after execution.
3. **AC3**: Integration tests do not modify system configuration parameters (read-only testing for config).
4. **AC4**: Integration tests are in `__tests__/*.integration.test.ts` files using Vitest.
5. **AC5**: All existing unit tests continue to pass (`turbo test` green).
6. **AC6**: Build succeeds (`turbo build` green).

## Tasks / Subtasks

- [x] Task 1: Create integration test setup file
  - [x] Create `packages/iris-ops-mcp/src/__tests__/integration-setup.ts`
  - [x] Copy pattern from `packages/iris-interop-mcp/src/__tests__/integration-setup.ts`
  - [x] Probe IRIS availability, Atelier version, and custom REST service
  - [x] Set `globalThis.__IRIS_AVAILABLE__`, `__ATELIER_VERSION__`, `__CUSTOM_REST_AVAILABLE__`

- [x] Task 2: Create integration test file
  - [x] Create `packages/iris-ops-mcp/src/__tests__/ops.integration.test.ts`
  - [x] Test all 16 tools against real IRIS
  - [x] Read-only tools: verify response structure and key fields
  - [x] Task lifecycle: create test task -> list (verify exists) -> run -> history (verify execution) -> delete
  - [x] Config: get only (no set in integration tests)
  - [x] Use `describe.skipIf(!REST_OK)` for custom REST tools
  - [x] Clean up test task in `afterAll`

- [x] Task 3: Update vitest config for integration tests
  - [x] Verify `packages/iris-ops-mcp/vitest.config.ts` excludes `*.integration.test.ts` from default `vitest run`
  - [x] Create or verify vitest integration config that includes integration tests with setup file

- [x] Task 4: Run integration tests
  - [x] Run integration tests against local IRIS: `npx vitest run --config packages/iris-ops-mcp/vitest.integration.config.ts`
  - [x] Verify all tests pass
  - [x] Fix any endpoint issues discovered

- [x] Task 5: Final validation (AC: 5, 6)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all unit tests pass (integration tests are separate)

## Dev Notes

### Integration Test Pattern (from iris-interop-mcp — replicate exactly)

**Setup file (`integration-setup.ts`):**
```typescript
import { IrisHttpClient, loadConfig, ping, negotiateVersion } from "@iris-mcp/shared";

declare global {
  var __IRIS_AVAILABLE__: boolean;
  var __ATELIER_VERSION__: number;
  var __CUSTOM_REST_AVAILABLE__: boolean;
}

// Probe IRIS, negotiate version, check custom REST service
// Set globals for describe.skipIf() usage
```

**Integration test file structure:**
```typescript
import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { IrisHttpClient, loadConfig, negotiateVersion, buildToolContext, type ToolContext } from "@iris-mcp/shared";
// Import tools from ../tools/*.js

const IRIS_OK = globalThis.__IRIS_AVAILABLE__;
const REST_OK = globalThis.__CUSTOM_REST_AVAILABLE__;

let client: IrisHttpClient;
let ctx: ToolContext;

beforeAll(async () => {
  const config = loadConfig({ ... });
  client = new IrisHttpClient(config);
  const version = await negotiateVersion(client);
  ctx = buildToolContext(client, version, config.namespace);
});

afterAll(async () => {
  // Clean up test resources
  client?.destroy();
});

describe.skipIf(!REST_OK)("iris-ops-mcp integration", () => {
  // Test each tool...
});
```

**Vitest integration config (`vitest.integration.config.ts`):**
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/__tests__/*.integration.test.ts"],
    setupFiles: ["src/__tests__/integration-setup.ts"],
    testTimeout: 30000,
  },
});
```

### Tool Test Categories

**Read-only tools (verify response structure):**
- `iris.metrics.system` — check metrics array exists, has items
- `iris.metrics.alerts` — check state field exists
- `iris.metrics.interop` — check namespaces array
- `iris.jobs.list` — check jobs array with pid fields
- `iris.locks.list` — check locks array (may be empty)
- `iris.journal.info` — check currentFile, primaryDirectory fields
- `iris.mirror.status` — check isMember field (expect false on this instance)
- `iris.audit.events` — check events array (use recent time range)
- `iris.database.check` — check databases array with mounted/size fields
- `iris.license.info` — check customerName, userLimit fields
- `iris.ecp.status` — check configured field (expect false)
- `iris.config.manage` get — check section, properties fields

**Lifecycle test (create -> verify -> run -> history -> cleanup):**
- `iris.task.manage` create — create test task "MCPOpsTest.Task"
- `iris.task.list` — verify test task appears in list
- `iris.task.run` — trigger test task execution
- `iris.task.history` — verify execution appears (may need brief wait)
- `iris.task.manage` delete — cleanup in afterAll

### File Locations

| What | Path |
|------|------|
| Integration setup | `packages/iris-ops-mcp/src/__tests__/integration-setup.ts` |
| Integration tests | `packages/iris-ops-mcp/src/__tests__/ops.integration.test.ts` |
| Vitest integration config | `packages/iris-ops-mcp/vitest.integration.config.ts` |
| Reference setup | `packages/iris-interop-mcp/src/__tests__/integration-setup.ts` |
| Reference tests | `packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts` |
| Existing vitest config | `packages/iris-ops-mcp/vitest.config.ts` |

### Critical Rules

- Integration tests MUST be in `*.integration.test.ts` files — excluded from `vitest run`
- NEVER modify system config in integration tests — get/export only
- ALWAYS clean up test tasks in afterAll (even on failure)
- Use `describe.skipIf(!REST_OK)` to skip gracefully when IRIS unavailable
- Test task class should be a simple existing class like `%SYS.Task.PurgeTaskHistory` (don't create custom classes)
- Give task operations brief delays if needed (RunNow is async)

### Previous Story Intelligence (Story 6.7)

- 16 tools in iris-ops-mcp, 149 unit tests passing
- All endpoints verified working via Step 2.5 across stories 6.2-6.7
- Monitor.cls has 11 methods, Task.cls has 4, SystemConfig.cls has 4

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.8]
- [Source: packages/iris-interop-mcp/src/__tests__/integration-setup.ts]
- [Source: packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts]
- [Source: packages/iris-ops-mcp/src/tools/index.ts] (16 tools to test)

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Initial REST probe used `/api/executemcp/v2/monitor/metrics` (404); fixed to `/api/executemcp/v2/monitor/system` which exists

### Completion Notes List

- Created integration-setup.ts following exact pattern from iris-interop-mcp, probing `/monitor/system` endpoint
- Created ops.integration.test.ts with 18 tests covering all 16 tools: 12 read-only structure tests + 2 config tests (get/export only) + 5 task lifecycle tests (create/list/run/history/delete) - cleanup in afterAll
- Created vitest.integration.config.ts matching iris-interop-mcp pattern
- Existing vitest.config.ts already excludes `*.integration.test.ts` from default runs
- All 18 integration tests pass against live IRIS
- All 149 unit tests continue to pass
- Build succeeds (7/7 turbo tasks)
- Task lifecycle uses `%SYS.Task.PurgeTaskHistory` class, creates task suspended, runs it, verifies history, deletes

### Review Findings

- [x] [Review][Defer] Duplicate `getConfig()` and `declare global` between setup and test files — deferred, pre-existing pattern from iris-interop-mcp
- [x] [Review][Defer] Unchecked `as` cast on `structuredContent` in task creation test — deferred, low risk

### File List

- `packages/iris-ops-mcp/src/__tests__/integration-setup.ts` (new)
- `packages/iris-ops-mcp/src/__tests__/ops.integration.test.ts` (new)
- `packages/iris-ops-mcp/vitest.integration.config.ts` (new)
- `_bmad-output/implementation-artifacts/6-8-iris-ops-mcp-unit-and-integration-tests.md` (modified)
