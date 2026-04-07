# Story 6.0: Epic 5 Deferred Cleanup

Status: done

## Story

As a developer,
I want all deferred work items from Epic 5 resolved and bootstrap-classes.ts regenerated before starting Epic 6 feature development,
so that iris-ops-mcp and future packages can reuse shared infrastructure, include all handler classes in bootstrap, and start from a clean foundation.

## Acceptance Criteria

1. **AC1**: `bootstrap-classes.ts` is regenerated to include ALL current ObjectScript handler classes: Utils.cls, Setup.cls, Dispatch.cls, Global.cls, Command.cls, UnitTest.cls, Config.cls, Security.cls, Interop.cls. Each class content is embedded as a string constant. The `getBootstrapClasses()` function returns all classes in compilation order.
2. **AC2**: Full scrub of `deferred-work.md` — mark all items resolved by Epic 5 as RESOLVED, triage remaining open items, add clear status annotations.
3. **AC3**: All existing tests pass after changes (`turbo test` green).
4. **AC4**: Build succeeds (`turbo build` green).

## Triage Table — Epic 5 Retro Action Items

| # | Item | Decision | Rationale |
|---|------|----------|-----------|
| 1 | Step 2.5 strengthened with MCP tool testing | **Drop** | Already implemented in epic-cycle.md |
| 2 | X.1 package setup must add to .mcp.json | **Drop** | Already implemented in epic-cycle.md |
| 3 | Regenerate bootstrap-classes.ts | **Include (AC1)** | Must include Interop.cls, updated Setup.cls with ConfigureMapping |
| 4 | Research IRIS APIs before implementation | **Drop** | Process guidance — embed in story context files |
| 5 | Update IPM module.xml in same story as handler classes | **Drop** | Process guidance — embed in story context files |
| 6 | Scrub deferred-work.md | **Include (AC2)** | 6 new items from Epic 5 code reviews need triage |
| 7 | Document %ALL namespace setup for existing installs | **Defer to Epic 8** | Documentation epic |

## Triage Table — Deferred Work Items from Epic 5

| # | Item | Decision | Rationale |
|---|------|----------|-----------|
| 1 | `pastEnd` flag not consumed by any tool handler | **Keep deferred** | No consumer yet, flag available for future use |
| 2 | `ProductionControl` tTimeout=0 silently overridden to 120 | **Keep deferred** | Low priority edge case |
| 3 | `ProductionSummary` inner catch swallows errors silently | **Keep deferred** | Low priority |
| 4 | `ProductionManage` uses %ExistsId (matches any class) | **Keep deferred** | Low priority |
| 5 | `productionControlTool` Zod: name optional for all actions | **Keep deferred** | Low priority |
| 6 | `ItemManage` "set" ignores unknown settings keys | **Keep deferred** | Low priority |
| 7 | `ItemManage` save/UpdateProduction sync risk | **Keep deferred** | IRIS pattern limitation |
| 8 | `LookupTransfer` import is additive/merge | **Keep deferred** | Document merge behavior |
| 9 | `CredentialManage` empty string ignored | **Keep deferred** | Edge case |

## Tasks / Subtasks

- [x] Task 1: Regenerate bootstrap-classes.ts (AC: 1)
  - [x] Read ALL `.cls` files from `src/ExecuteMCPv2/` (excluding Tests/ directory)
  - [x] Read current `packages/shared/src/bootstrap-classes.ts` to understand the existing format
  - [x] Regenerate with all handler classes in compilation order: Utils.cls, Setup.cls, Dispatch.cls, Global.cls, Command.cls, UnitTest.cls, Config.cls, Security.cls, Interop.cls
  - [x] Each class embedded as a string constant with proper escaping
  - [x] `getBootstrapClasses()` returns array in correct compilation order (Utils first, Dispatch last since it references handlers)
  - [x] Verify the regenerated file compiles: `turbo build`

- [x] Task 2: Scrub deferred-work.md (AC: 2)
  - [x] Read current deferred-work.md
  - [x] Items already marked RESOLVED remain marked
  - [x] Add RESOLVED annotations for any items fixed during Epic 5 that aren't yet marked
  - [x] Keep genuinely open items with clear status and epic source
  - [x] Remove resolved items from Epic 1-3 that clutter the file (they're historical)

- [x] Task 3: Final validation (AC: 3, 4)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests must pass
  - [x] Verify no regressions

### Review Findings

- [x] [Review][Patch] gen-bootstrap.mjs uses `import.meta.dirname` which requires Node 21.2+; incompatible with engines >=18.0.0 [scripts/gen-bootstrap.mjs:4] — FIXED: replaced with `fileURLToPath(import.meta.url)` + `dirname()` pattern
- [x] [Review][Patch] Open deferred-work item dropped during scrub: test-helpers subpath export from Story 4-0 [_bmad-output/implementation-artifacts/deferred-work.md] — FIXED: restored item under Epic 4 section
- [x] [Review][Patch] Stale comment "Deploy: 6 PUT responses" should reflect 9 classes [packages/shared/src/__tests__/bootstrap.test.ts:341] — FIXED: updated comment
- [x] [Review][Patch] `BootstrapClass` type and `getBootstrapClasses()` not re-exported from shared index.ts [packages/shared/src/index.ts] — FIXED: added re-exports
- [x] [Review][Defer] No npm script entry for gen-bootstrap.mjs — deferred, low priority tooling improvement
- [x] [Review][Defer] No error handling in gen-bootstrap.mjs for missing .cls files — deferred, low priority

## Dev Notes

### Architecture Patterns

- **bootstrap-classes.ts**: `packages/shared/src/bootstrap-classes.ts` — Contains string constants for each ObjectScript class, used by auto-bootstrap flow to deploy REST service to IRIS. Must include ALL non-test classes.
- **Compilation order matters**: Utils.cls has no dependencies, Setup.cls depends on Utils, handler classes depend on Utils, Dispatch.cls depends on all handlers (references them in UrlMap).
- **String escaping**: Backtick template literals with proper escaping of `$` and backtick characters in ObjectScript source.

### Source Files to Read

| What | Path |
|------|------|
| Current bootstrap-classes.ts | `packages/shared/src/bootstrap-classes.ts` |
| Utils.cls | `src/ExecuteMCPv2/Utils.cls` |
| Setup.cls | `src/ExecuteMCPv2/Setup.cls` |
| Dispatch.cls | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| Global.cls | `src/ExecuteMCPv2/REST/Global.cls` |
| Command.cls | `src/ExecuteMCPv2/REST/Command.cls` |
| UnitTest.cls | `src/ExecuteMCPv2/REST/UnitTest.cls` |
| Config.cls | `src/ExecuteMCPv2/REST/Config.cls` |
| Security.cls | `src/ExecuteMCPv2/REST/Security.cls` |
| Interop.cls | `src/ExecuteMCPv2/REST/Interop.cls` |
| deferred-work.md | `_bmad-output/implementation-artifacts/deferred-work.md` |

### Previous Story Intelligence (Story 5.0)

- Pattern: read all source files, embed as escaped string constants in bootstrap-classes.ts
- Compilation order: dependencies first (Utils), then handlers, then Dispatch last
- Test with `turbo build && turbo test`
- deferred-work.md scrub: mark RESOLVED with story reference, keep genuinely open items

### Critical Rules

- Do NOT include test classes (Tests/*.cls) in bootstrap-classes.ts — they are for development only
- Escape all `$` characters in ObjectScript source for JavaScript template literals
- Escape all backtick characters in ObjectScript source
- Maintain the existing function signature and return type of `getBootstrapClasses()`

### References

- [Source: _bmad-output/implementation-artifacts/epic-5-retro-2026-04-07.md#Action Items]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md]
- [Source: packages/shared/src/bootstrap-classes.ts]
- [Source: src/ExecuteMCPv2/]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required.

### Completion Notes List

- **Task 1**: Regenerated `bootstrap-classes.ts` with all 9 handler classes using a Node.js generator script (`scripts/gen-bootstrap.mjs`). Classes are in correct compilation order: Utils, Setup, Global, Command, UnitTest, Config, Security, Interop, Dispatch (last). Added `BootstrapClass` interface and `getBootstrapClasses()` function. Updated tests to expect 9 classes, added tests for `getBootstrapClasses()`, compilation order, and Interop.cls presence. Also fixed pre-existing test gap where bootstrap orchestration test was missing a mock for the `configurePackageMapping` step.
- **Task 2**: Scrubbed `deferred-work.md` — removed all resolved items from Epics 1-4 (were cluttering with strikethrough text), reorganized remaining open items by epic with clear section headers and story references. All 9 Epic 5 deferred items kept as open. Resolved items archived to git history.
- **Task 3**: `turbo build` succeeds (7/7). All tests pass for packages with test files (shared: 182, admin: 198, dev, interop). Pre-existing "no test files" exits in data/ops/all packages are unrelated.

### Change Log

- 2026-04-07: Story 6.0 implementation complete — bootstrap-classes.ts regenerated with 9 classes, deferred-work.md scrubbed

### File List

- `packages/shared/src/bootstrap-classes.ts` — Regenerated with 9 classes including Interop.cls, added getBootstrapClasses() function
- `packages/shared/src/__tests__/bootstrap.test.ts` — Updated to expect 9 classes, added getBootstrapClasses tests, fixed missing mapping mock
- `_bmad-output/implementation-artifacts/deferred-work.md` — Scrubbed: removed resolved items, reorganized by epic
- `_bmad-output/implementation-artifacts/6-0-epic-5-deferred-cleanup.md` — Story file updated with completion notes
- `scripts/gen-bootstrap.mjs` — New: Node.js generator script for bootstrap-classes.ts
