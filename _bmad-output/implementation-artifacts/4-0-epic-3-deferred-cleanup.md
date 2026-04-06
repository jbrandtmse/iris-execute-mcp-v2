# Story 4.0: Epic 3 Deferred Cleanup

Status: done

## Story

As a developer,
I want all deferred work items from Epic 3 resolved before starting Epic 4 feature development,
so that iris-admin-mcp and future packages can reuse shared helpers, avoid known pitfalls, and start from a clean foundation.

## Acceptance Criteria

1. **AC1**: `booleanParam` Zod preprocessor is exported from `@iris-mcp/shared` and iris-dev-mcp imports it from there (not its own local copy).
2. **AC2**: Shared test helpers (`createMockHttp`, `createMockCtx`, `envelope`) are exported from `@iris-mcp/shared` test utilities and iris-dev-mcp imports them from there.
3. **AC3**: `iris.global.list` tool supports cursor-based pagination via `ctx.paginate()` with a `cursor` parameter.
4. **AC4**: Debug/temporary classes are removed from HSCUSTOM namespace on IRIS (`ExecuteMCPv2.Tests.WebAppCheck`, `WebAppCheck2`–`WebAppCheck5`, `HttpProbe`, `DebugRunner`, `ResultCheck`).
5. **AC5**: README (or a setup doc) documents that web apps created via `Security.Applications.Create()` must be saved through SMP or gateway restarted for CSP gateway recognition.
6. **AC6**: All existing tests pass after changes (`turbo test` green).
7. **AC7**: Build succeeds (`turbo build` green).

## Triage Table — Epic 3 Retro Action Items

| # | Item | Decision | Rationale |
|---|------|----------|-----------|
| 1 | Regenerate bootstrap-classes.ts | **Drop** | Already current — verified ReadRequestBody uses GetMimeData, AutheEnabled=32 |
| 2 | Document web app gateway registration | **Include (AC5)** | Prevents user confusion during bootstrap |
| 3 | Move booleanParam to @iris-mcp/shared | **Include (AC1)** | iris-admin-mcp tools will need it |
| 4 | Clean up debug classes on IRIS | **Include (AC4)** | Remove test debris from HSCUSTOM |
| 5 | Move shared test helpers to @iris-mcp/shared | **Include (AC2)** | All server packages need these |
| 6 | Add pagination to ListGlobals | **Include (AC3)** | Production safety for large namespaces |
| 7 | Add live smoke test to epic-cycle | **Defer** | Nice-to-have, doesn't block Epic 4 |

## Deferred-work.md Items

All existing items in deferred-work.md are low-priority edge cases. None block Epic 4. Explicitly deferred:
- Log-level filtering, in-flight abort, credential redaction (Story 1.2)
- Version negotiation error detail, atelierPath validation, requireMinVersion sentinel (Story 1.3)
- Cursor validation, handleToolCall integration test, duplicate tool guard (Story 1.4)
- Windows timeout behavior (Story 1.5)
- resolveTransport tests, entry point bootstrap tests, empty exports (Story 2.1)
- Batch delete, document name validation (Story 2.2)
- metadataOnly+format interaction, metadataOnly+namespace test (Story 2.3)
- XML export body duplication, error propagation test (Story 2.6)
- Server-side maxRows (Story 2.7)
- Mock paginate fidelity, doc.list cursor integration test, corrupted cursor (Story 3.0)
- ByRef parameter support (Story 3.3)

## Tasks / Subtasks

- [x] Task 1: Move `booleanParam` to `@iris-mcp/shared` (AC: 1)
  - [x] Create `packages/shared/src/zod-helpers.ts` with `booleanParam` export
  - [x] Export from `packages/shared/src/index.ts` barrel
  - [x] Update `packages/iris-dev-mcp/src/tools/zod-helpers.ts` to re-export from shared (or remove and update imports)
  - [x] Update all iris-dev-mcp tool files that import booleanParam to use new path
  - [x] Verify build and tests pass

- [x] Task 2: Move shared test helpers to `@iris-mcp/shared` (AC: 2)
  - [x] Create `packages/shared/src/__tests__/test-helpers.ts` with `createMockHttp`, `createMockCtx`, `envelope`
  - [x] Export from a test-helpers barrel or directly
  - [x] Update `packages/iris-dev-mcp/src/__tests__/test-helpers.ts` to re-export from shared
  - [x] Verify all iris-dev-mcp tests still pass

- [x] Task 3: Add pagination to `iris.global.list` (AC: 3)
  - [x] Add `cursor` parameter to globalListTool schema
  - [x] Wire `ctx.paginate()` in the handler to paginate the results array
  - [x] Update unit tests to verify pagination behavior
  - [x] Default page size: 50 (consistent with other tools)

- [x] Task 4: Clean up debug classes on IRIS (AC: 4)
  - [x] Use iris-dev-mcp `iris.doc.delete` tool or MCP to remove debug classes from HSCUSTOM
  - [x] Verify classes are gone

- [x] Task 5: Document web app gateway registration (AC: 5)
  - [x] Add a "Known Limitations" or "Post-Bootstrap Setup" section to the project README or a setup guide
  - [x] Explain: `Security.Applications.Create()` does not notify CSP gateway; must save via SMP or restart gateway

- [x] Task 6: Final validation (AC: 6, 7)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests must pass
  - [x] Verify no regressions in iris-dev-mcp tools

## Dev Notes

### Architecture Patterns

- **Shared package barrel**: `packages/shared/src/index.ts` is the public API. All new exports must be added here.
- **Zod helpers pattern**: `booleanParam` uses `z.preprocess()` to coerce string `"true"`/`"false"` to boolean. See `packages/iris-dev-mcp/src/tools/zod-helpers.ts:17-26`.
- **Test helpers pattern**: `createMockHttp` returns a partial `IrisHttpClient` with `vi.fn()` stubs. `createMockCtx` returns a `ToolContext` mock. `envelope` wraps data in `AtelierEnvelope<T>`. See `packages/iris-dev-mcp/src/__tests__/test-helpers.ts`.
- **Pagination pattern**: Use `ctx.paginate(allItems, cursor, pageSize)` which returns `{ items, nextCursor }`. See `packages/shared/src/server-base.ts` for implementation.

### File Locations

| What | Current Location | Target Location |
|------|-----------------|-----------------|
| booleanParam | `packages/iris-dev-mcp/src/tools/zod-helpers.ts` | `packages/shared/src/zod-helpers.ts` |
| Test helpers | `packages/iris-dev-mcp/src/__tests__/test-helpers.ts` | `packages/shared/src/__tests__/test-helpers.ts` |
| Global list tool | `packages/iris-dev-mcp/src/tools/global.ts` | Same file, add pagination |
| README | `README.md` (root) | Same file, add section |

### Testing Standards

- Vitest framework, `*.test.ts` files
- Mock HTTP responses, don't hit real IRIS in unit tests
- Test pagination with cursor forwarding

### Previous Story Intelligence (Story 3.9)

- Continue-on-error pattern used for bulk operations
- Node.js `fs.globSync` for file discovery (Node 22+)
- Exported helpers for testability
- `turbo build && turbo test` for validation

### References

- [Source: _bmad-output/implementation-artifacts/epic-3-retro-2026-04-06.md#Action Items]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md]
- [Source: packages/iris-dev-mcp/src/tools/zod-helpers.ts]
- [Source: packages/iris-dev-mcp/src/__tests__/test-helpers.ts]
- [Source: packages/iris-dev-mcp/src/tools/global.ts]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None required -- all tasks completed without debugging.

### Completion Notes List
- Task 1: Created `packages/shared/src/zod-helpers.ts` with `booleanParam` Zod preprocessor. Added barrel export in `packages/shared/src/index.ts`. Updated `packages/iris-dev-mcp/src/tools/zod-helpers.ts` to re-export from shared (backwards-compatible). All 4 consumer files (load.ts, doc.ts, compile.ts, intelligence.ts) continue to import via the local re-export.
- Task 2: Created `packages/shared/src/__tests__/test-helpers.ts` with `createMockHttp`, `createMockCtx`, `envelope`. Added subpath export `@iris-mcp/shared/test-helpers` in package.json. Updated `packages/iris-dev-mcp/src/__tests__/test-helpers.ts` to re-export from shared. All 192 dev tests pass.
- Task 3: Added `cursor` parameter to `globalListTool` input schema. Wired `ctx.paginate()` in handler to paginate the globals array. Added 5 new unit tests covering pagination (cursor forwarding, last page, filter preservation, schema shape). Default page size is 50 via `ctx.paginate()`.
- Task 4: Verified all debug classes (`ExecuteMCPv2.Tests.WebAppCheck`, `WebAppCheck2-5`, `HttpProbe`, `DebugRunner`, `ResultCheck`) are already absent from HSCUSTOM namespace. No deletion needed.
- Task 5: Added "Known Limitations" section to README.md documenting that `Security.Applications.Create()` does not notify CSP Gateway and explaining the two workarounds (SMP save or gateway restart).
- Task 6: `turbo build` succeeds (7/7 tasks). `turbo test` passes for shared (151 tests) and dev (192 tests). No regressions.

### Change Log
- 2026-04-06: Story 4.0 implementation complete. Moved booleanParam and test helpers to shared package, added pagination to global.list, verified debug classes removed, documented gateway limitation.

### Review Findings
- [x] [Review][Patch] vitest not declared as peerDependency for shared test-helpers subpath export [packages/shared/package.json] — FIXED: added vitest as optional peerDependency
- [x] [Review][Defer] Test-helpers subpath export points to source TS, not dist output [packages/shared/package.json] — deferred, pre-existing architectural choice
- [x] [Review][Defer] Client-side pagination in iris.global.list re-fetches all globals per page [packages/iris-dev-mcp/src/tools/global.ts] — deferred, server-side pagination needed
- [x] [Review][Defer] decodeCursor beyond array bounds returns empty page silently [packages/shared/src/server-base.ts] — deferred, pre-existing

### File List
- `packages/shared/src/zod-helpers.ts` (new)
- `packages/shared/src/index.ts` (modified)
- `packages/shared/package.json` (modified)
- `packages/shared/src/__tests__/test-helpers.ts` (new)
- `packages/iris-dev-mcp/src/tools/zod-helpers.ts` (modified)
- `packages/iris-dev-mcp/src/__tests__/test-helpers.ts` (modified)
- `packages/iris-dev-mcp/src/tools/global.ts` (modified)
- `packages/iris-dev-mcp/src/__tests__/global.test.ts` (modified)
- `README.md` (modified)
