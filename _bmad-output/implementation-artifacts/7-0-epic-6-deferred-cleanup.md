# Story 7.0: Epic 6 Deferred Cleanup

Status: done

## Story

As a developer,
I want all deferred work items from Epic 6 triaged and bootstrap-classes.ts regenerated to include Epic 6 handler classes before starting Epic 7 feature development,
so that iris-data-mcp and future packages can deploy all handler classes via bootstrap, and the deferred-work backlog is kept actionable.

## Acceptance Criteria

1. **AC1**: `bootstrap-classes.ts` is regenerated to include ALL current ObjectScript handler classes (12 total): Utils.cls, Setup.cls, Dispatch.cls, Global.cls, Command.cls, UnitTest.cls, Config.cls, Security.cls, Interop.cls, **Monitor.cls**, **Task.cls**, **SystemConfig.cls**. The `getBootstrapClasses()` function returns all classes in compilation order.
2. **AC2**: Aggressive triage of `deferred-work.md` — close all won't-fix items from Epics 1-4 as formally closed (not just kept open). Keep only genuinely actionable items. Add rationale for each closure.
3. **AC3**: All existing tests pass after changes (`turbo test` green).
4. **AC4**: Build succeeds (`turbo build` green).

## Triage Table — Epic 6 Retro Action Items

| # | Item | Decision | Rationale |
|---|------|----------|-----------|
| 1 | Regenerate bootstrap-classes.ts with Monitor.cls, Task.cls, SystemConfig.cls | **Include (AC1)** | Epic 6 added 3 handler classes not in bootstrap |
| 2 | Aggressive deferred-work.md triage | **Include (AC2)** | ~40+ items accumulated, most from Epics 1-4 will never be fixed |
| 3 | Lead-provided verified APIs | **Drop** | Process guidance, not code |
| 4 | Step 2.5 curl + MCP retest | **Drop** | Process guidance, not code |
| 5 | IPM module.xml in same story | **Drop** | Process guidance, not code |

## Triage Table — Deferred Work Items Closure Decisions

### Items to CLOSE as won't-fix (Epics 1-4)

| # | Item | Close Rationale |
|---|------|-----------------|
| 1 | No `license` field in package.json (1-1) | Pre-publish concern only; LICENSE file exists |
| 2 | Logger has no redaction/scrubbing (1-2) | Callers responsible; no production incidents |
| 3 | `negotiateVersion` bare catch defaults to v1 (1-3) | Functional for 6 epics; correct default behavior |
| 4 | `requireMinVersion` error metadata (1-3) | Cosmetic; no consumer impact |
| 5 | No integration test for `handleToolCall` validation (1-4) | Zod validation tested directly; MCP SDK layer tested |
| 6 | `addTools` duplicate name overwrites (1-4) | No runtime scenario for duplicates |
| 7 | Windows network timeout behavior (1-5) | No CI runners; works in practice |
| 8 | No unit tests for entry point bootstrap (2-1) | Would require mocking entire startup; not practical |
| 9 | Package `exports` field points to side-effect entry (2-1) | No external consumers |
| 10 | Batch delete individual calls (2-2) | Performance acceptable; Atelier batch endpoint not needed |
| 11 | `metadataOnly` + `format` silently ignored (2-3) | Documented behavior |
| 12 | No unit test for `metadataOnly` + namespace (2-3) | Covered by integration tests |
| 13 | Duplicated body construction in docXmlExportTool (2-6) | Low ROI extraction |
| 14 | Missing error propagation test for docXmlExport (2-6) | Low risk, covered by pattern |
| 15 | Client-side `maxRows` truncation (2-7) | Server-side limit not available via Atelier |
| 16 | Mock paginate function ignores cursor/pageSize (3-0) | Adequate for current tests |
| 17 | No integration test for doc.list pagination (3-0) | Low priority |
| 18 | BuildGlobalRef comma-in-subscript limitation (3-2) | Inherent limitation, documented |
| 19 | ByRef/Output parameter support (3-3) | Future enhancement |
| 20 | `./test-helpers` subpath points to raw TS (4-0) | Monorepo-only consumption; no external consumers |
| 21 | Invalid CLI transport silently ignored (4-1) | Console.error warning already added |
| 22 | Free space not in Config.Databases.Get (4-2) | IRIS API limitation |
| 23 | UserRoles no whitespace validation (4-4) | Low risk |
| 24 | GET matching wildcard route (4-4) | Cosmetic only |
| 25 | OAuth response passthrough (4-8) | IRIS backend handles correctly |
| 26 | probeCustomRest duck-typing (4-9, 5-7) | Functional; cosmetic |

### Items to KEEP open (Epics 5-6, genuinely actionable)

| # | Item | Keep Rationale |
|---|------|---------------|
| 1 | `pastEnd` flag not consumed (5-0) | Future consumer may use it |
| 2 | `ProductionControl` tTimeout=0 override (5-2) | Semantic edge case worth fixing |
| 3 | No integration tests for interopRest, ruleGet, transformTest (5-7) | Coverage gap |
| 4 | bootstrap-classes.ts not updated with Epic 6 (retro) | Fixed by AC1 of this story |
| 5 | gen-bootstrap.mjs: no npm script (6-0) | Low priority tooling |
| 6 | gen-bootstrap.mjs: no error handling (6-0) | Low priority tooling |
| 7 | Task duration not computed server-side (6-6) | Could improve UX |
| 8 | No schedule properties in task.manage create (6-6) | Future enhancement |
| 9 | No IRIS-side test for lock Owner dual-format (6-3) | Regression risk |
| 10 | Config tool hardcoded 11 properties (6-7) | Could be more complete |
| 11 | No SetConfig property name validation (6-7) | Defense-in-depth only |
| 12 | ExportConfig only includes config section (6-7) | Could include startup/locale |
| 13 | Duplicate getConfig/declare global in integration tests (6-8) | DRY opportunity |
| 14 | Task creation test unchecked `as` cast (6-8) | Low risk |

## Tasks / Subtasks

- [x] Task 1: Regenerate bootstrap-classes.ts (AC: 1)
  - [x] Run `node scripts/gen-bootstrap.mjs` to regenerate (script already reads all .cls files from src/ExecuteMCPv2/, excluding Tests/)
  - [x] Verify output includes 12 classes: Utils, Setup, Global, Command, UnitTest, Config, Security, Interop, Monitor, Task, SystemConfig, Dispatch
  - [x] Verify compilation order: Utils first, Setup second, handler classes in middle, Dispatch last
  - [x] Update `packages/shared/src/__tests__/bootstrap.test.ts` — change expected class count from 9 to 12, add presence checks for Monitor.cls, Task.cls, SystemConfig.cls

- [x] Task 2: Aggressive deferred-work.md triage (AC: 2)
  - [x] Read current deferred-work.md
  - [x] Remove all items from Epics 1-4 (26 items closed per triage table above)
  - [x] Keep 14 open items from Epics 5-6
  - [x] Add section header noting Epic 1-4 items were formally closed in Story 7.0
  - [x] Mark "bootstrap-classes.ts not updated" item as resolved by this story

- [x] Task 3: Final validation (AC: 3, 4)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests must pass

## Dev Notes

### Architecture Patterns

- **gen-bootstrap.mjs**: `scripts/gen-bootstrap.mjs` — Node.js script that reads all `.cls` files from `src/ExecuteMCPv2/` (excluding Tests/) and generates `packages/shared/src/bootstrap-classes.ts`. Run it, don't manually edit bootstrap-classes.ts.
- **Compilation order**: Utils (no deps) -> Setup (depends on Utils) -> handler classes (depend on Utils) -> Dispatch (last, references all handlers in UrlMap).
- **New Epic 6 classes**: Monitor.cls, Task.cls, SystemConfig.cls — all in `src/ExecuteMCPv2/REST/`. Follow same handler pattern.

### Source Files to Modify

| What | Path |
|------|------|
| Generator script | `scripts/gen-bootstrap.mjs` |
| Generated output | `packages/shared/src/bootstrap-classes.ts` |
| Bootstrap tests | `packages/shared/src/__tests__/bootstrap.test.ts` |
| Deferred work | `_bmad-output/implementation-artifacts/deferred-work.md` |

### Source Files to Read (for verification)

| What | Path |
|------|------|
| Monitor.cls | `src/ExecuteMCPv2/REST/Monitor.cls` |
| Task.cls | `src/ExecuteMCPv2/REST/Task.cls` |
| SystemConfig.cls | `src/ExecuteMCPv2/REST/SystemConfig.cls` |

### Previous Story Intelligence (Story 6.0)

- Used `node scripts/gen-bootstrap.mjs` successfully — script handles reading .cls files, escaping, and ordering
- Expected count went from 6 to 9 in Story 6.0; now going from 9 to 12
- bootstrap.test.ts has `getBootstrapClasses()` tests that check count and order
- deferred-work.md scrub pattern: remove resolved items, keep clean sections by epic

### Critical Rules

- Do NOT manually edit `bootstrap-classes.ts` — run the generator script
- Do NOT include test classes (Tests/*.cls) in bootstrap
- After running gen-bootstrap.mjs, verify the output file has all 12 classes
- Update test expectations from 9 to 12 classes
- When closing deferred items, keep a brief note that they were closed in Story 7.0

### References

- [Source: _bmad-output/implementation-artifacts/epic-6-retro-2026-04-07.md#Action Items]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md]
- [Source: packages/shared/src/bootstrap-classes.ts]
- [Source: scripts/gen-bootstrap.mjs]
- [Source: _bmad-output/implementation-artifacts/6-0-epic-5-deferred-cleanup.md]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None required — straightforward implementation with no debugging needed.

### Completion Notes List
- Task 1: Added Monitor.cls, Task.cls, SystemConfig.cls to gen-bootstrap.mjs class array (before Dispatch). Ran generator — output has 12 classes in correct compilation order. Updated bootstrap.test.ts: count 9->12, added 3 presence checks for new classes. All 23 bootstrap tests pass.
- Task 2: Rewrote deferred-work.md — removed all 26 Epic 1-4 items with formal closure note at top. Kept 14 open items from Epics 5-6. Bootstrap item resolved by AC1 of this story.
- Task 3: `turbo build` green (7/7 tasks). All 888 tests pass across 5 packages (shared: 185, dev: 200, admin: 198, interop: 156, ops: 149). Two packages (@iris-mcp/all, @iris-mcp/data) have pre-existing "no test files" exits — not caused by this story.

### File List
- scripts/gen-bootstrap.mjs (modified — added 3 Epic 6 class entries)
- packages/shared/src/bootstrap-classes.ts (regenerated — 12 classes, was 9)
- packages/shared/src/__tests__/bootstrap.test.ts (modified — updated counts, added 3 presence tests)
- _bmad-output/implementation-artifacts/deferred-work.md (rewritten — closed 26 items, kept 14)
- _bmad-output/implementation-artifacts/7-0-epic-6-deferred-cleanup.md (story file updates)
- _bmad-output/implementation-artifacts/sprint-status.yaml (status updates)

### Change Log
- 2026-04-07: Regenerated bootstrap-classes.ts with 12 classes (added Monitor, Task, SystemConfig from Epic 6). Closed 26 deferred-work items from Epics 1-4 as won't-fix. All tests green.
