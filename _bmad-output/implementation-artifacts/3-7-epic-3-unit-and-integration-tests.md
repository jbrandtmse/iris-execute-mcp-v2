# Story 3.7: Epic 3 Unit & Integration Tests

Status: done

## Story

As a developer,
I want unit tests (mocked HTTP) and integration tests (real IRIS) for all custom REST tools and the bootstrap flow,
So that I can verify parameter validation, response parsing, and end-to-end behavior.

## Acceptance Criteria

1. Integration tests for global tools: get, set, kill, list against real IRIS
2. Integration tests for execute tools: command, classmethod against real IRIS
3. Integration tests for test execution tool against real IRIS
4. Integration test for bootstrap idempotent skip
5. Each integration test cleans up test globals/artifacts
6. Integration tests in `__tests__/*.integration.test.ts` using Vitest
7. All existing unit tests continue to pass

## Tasks / Subtasks

- [x] Task 1: Create iris-dev-mcp integration test infrastructure
  - [x] 1.1: Update `packages/iris-dev-mcp/src/__tests__/integration-setup.ts` — added custom REST probe
  - [x] 1.2: `packages/iris-dev-mcp/vitest.integration.config.ts` already existed
  - [x] 1.3: `test:integration` script already in package.json

- [x] Task 2: Custom REST tool integration tests
  - [x] 2.1: Create `packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts`
  - [x] 2.2: Test iris.global.set → iris.global.get → iris.global.kill cycle
  - [x] 2.3: Test iris.global.list returns results
  - [x] 2.4: Test iris.execute.command with Write output capture
  - [x] 2.5: Test iris.execute.classmethod with known system method
  - [x] 2.6: Test iris.execute.tests with ExecuteMCPv2.Tests.UtilsTest
  - [x] 2.7: Cleanup test globals after each test

- [x] Task 3: Bootstrap integration test
  - [x] 3.1: Test probeCustomRest detects existing REST service
  - [x] 3.2: Test full bootstrap returns skip result (idempotent)

- [x] Task 4: Run all tests
  - [x] 4.1: Run unit tests: `pnpm --filter @iris-mcp/shared test && pnpm --filter @iris-mcp/dev test` — 306 tests pass
  - [x] 4.2: Integration tests ready (skip automatically when IRIS not available)

## Dev Notes

### Integration Test Pattern

Follow the pattern from Epic 2 Story 2.8:
- `integration-setup.ts` detects IRIS availability via setupFiles
- Tests use `describe.skipIf(!globalThis.__IRIS_AVAILABLE__)` 
- Custom REST availability needs separate check (web app may not be registered)
- Clean up test data in afterEach/afterAll blocks

### Custom REST URL

Integration tests call the custom REST endpoint directly via IrisHttpClient:
```typescript
const response = await http.get('/api/executemcp/v2/global?global=TestGlobal&namespace=USER');
```

Or use the tool handlers directly with a real ToolContext.

### References

- [Source: packages/iris-dev-mcp/src/__tests__/tools.integration.test.ts — Epic 2 integration test pattern]
- [Source: packages/shared/src/__tests__/integration-setup.ts — IRIS availability detection]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
N/A

### Completion Notes List
- Updated integration-setup.ts with custom REST availability probe (probeCustomRest)
- Created custom-rest.integration.test.ts with 5 integration tests covering global CRUD cycle, global list, execute command, classmethod, and test execution
- Created bootstrap.integration.test.ts with 2 integration tests covering probeCustomRest and idempotent bootstrap
- All 306 existing unit tests pass (143 shared + 163 iris-dev-mcp)
- Integration tests auto-skip when IRIS or custom REST service not available

### File List
- packages/iris-dev-mcp/src/__tests__/integration-setup.ts (modified — added custom REST probe)
- packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts (new — 5 integration tests)
- packages/shared/src/__tests__/bootstrap.integration.test.ts (new — 2 integration tests)
