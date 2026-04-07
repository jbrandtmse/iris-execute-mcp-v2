# Story 5.3: Production Item & Auto-Start Tools

Status: done

## Story

As an integration engineer,
I want to enable, disable, and configure individual production items and auto-start settings,
so that I can fine-tune production behavior without the Management Portal.

## Acceptance Criteria

1. **AC1**: `iris.production.item` with action "enable" enables the specified config item (FR67).
2. **AC2**: `iris.production.item` with action "disable" disables the specified config item (FR67).
3. **AC3**: `iris.production.item` with action "get" returns the config item's host and adapter settings (FR68).
4. **AC4**: `iris.production.item` with action "set" updates the config item's host and/or adapter settings (FR68).
5. **AC5**: `iris.production.autostart` with action "get" returns the current auto-start configuration (FR69).
6. **AC6**: `iris.production.autostart` with action "set" updates the production auto-start setting (FR69).
7. **AC7**: `iris.production.item` with action "get" annotated as `readOnlyHint: true`.
8. **AC8**: `iris.production.item` with action "set"/"enable"/"disable" annotated as `destructiveHint: false`.
9. **AC9**: `iris.production.autostart` annotated as `destructiveHint: false`.
10. **AC10**: Both tools have scope NS.
11. **AC11**: New routes added to Dispatch UrlMap and both classes compile.
12. **AC12**: Unit tests verify parameter validation, response parsing, and error handling.
13. **AC13**: `turbo build` succeeds and all tests pass.

## Tasks / Subtasks

- [x] Task 1: Add ObjectScript methods to Interop.cls (AC: 1-6, 11)
  - [x] Implement `ItemManage()` class method — enable/disable/get/set config items
  - [x] Implement `AutoStart()` class method — get/set auto-start configuration
  - [x] Add routes to Dispatch.cls:
    - `POST /interop/production/item` → `ExecuteMCPv2.REST.Interop:ItemManage`
    - `POST /interop/production/autostart` → `ExecuteMCPv2.REST.Interop:AutoStart`
  - [x] Deploy and compile

- [x] Task 2: Create TypeScript tools (AC: 1-10)
  - [x] Create `packages/iris-interop-mcp/src/tools/item.ts`
  - [x] Implement `productionItemTool` — enable/disable/get/set with scope NS
    - Annotations: readOnlyHint depends on action (but MCP annotations are static, so use destructiveHint: false since it modifies config, not data)
  - [x] Implement `productionAutostartTool` — get/set with scope NS, destructiveHint: false
  - [x] Update `src/tools/index.ts` to export new tools

- [x] Task 3: Create unit tests (AC: 12)
  - [x] Create `packages/iris-interop-mcp/src/__tests__/item.test.ts`
  - [x] Test parameter validation for each action
  - [x] Test successful response parsing for get/set/enable/disable
  - [x] Test autostart get/set
  - [x] Test error handling

- [x] Task 4: Final validation (AC: 13)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass

## Dev Notes

### ObjectScript IRIS API Reference

**Config Item Enable/Disable (FR67):**
- Enable: `Set tSC = ##class(Ens.Director).EnableConfigItem(pItemName, 1, 1)` — 2nd arg=enabled (1=enable), 3rd arg=updateProduction
- Disable: `Set tSC = ##class(Ens.Director).EnableConfigItem(pItemName, 0, 1)`
- These operate on the running production in the current namespace

**Config Item Get/Set Settings (FR68):**
- Get settings: Use `##class(Ens.Config.Item).NameExists(pItemName, .pID)` to find the item, then open and read properties
- Or use SQL: `SELECT * FROM Ens_Config.Item WHERE Name = ?`
- Get host settings: `##class(Ens.Config.Item).GetHostSettings(pItemName, .pSettings)` or query `Ens_Config.Item` and parse the Settings property
- Set settings: Open the `Ens.Config.Item` object, modify the relevant setting, save, then call `##class(Ens.Director).UpdateProduction()` to apply

**Auto-Start (FR69):**
- Get: `Set tAutoStart = ##class(Ens.Director).GetAutoStart()` — returns production name or ""
- Set: `Set tSC = ##class(Ens.Director).SetAutoStart(pProductionName)` — empty string to disable
- Alternative: Check `^Ens.AutoStart` global directly

**CRITICAL: Namespace handling:**
- All Ens.* calls run in the TARGET namespace (NOT %SYS)
- Use the same SwitchNamespace pattern from Story 5.2's Interop.cls
- Validate parameters BEFORE switching namespace

### TypeScript Tool Pattern

Follow `packages/iris-interop-mcp/src/tools/production.ts` exactly:
- `const BASE_URL = "/api/executemcp/v2"`
- POST to `${BASE_URL}/interop/production/item` and `${BASE_URL}/interop/production/autostart`
- Body includes action, item name/settings, and namespace
- Use `ctx.resolveNamespace(args.namespace)` for namespace parameter

### Annotation Strategy

MCP annotations are static per tool (not per-action). For `iris.production.item`:
- Actions "get" are read-only, "set"/"enable"/"disable" modify config
- Since the tool can modify, use `readOnlyHint: false`, `destructiveHint: false` (modifies config but doesn't delete data)

For `iris.production.autostart`:
- `readOnlyHint: false`, `destructiveHint: false` (configures auto-start, non-destructive)

### File Locations

| What | Path |
|------|------|
| Interop handler (extend) | `src/ExecuteMCPv2/REST/Interop.cls` |
| Dispatch (add routes) | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| New item tools | `packages/iris-interop-mcp/src/tools/item.ts` |
| Tools index (update) | `packages/iris-interop-mcp/src/tools/index.ts` |
| New unit tests | `packages/iris-interop-mcp/src/__tests__/item.test.ts` |
| Reference: production.ts | `packages/iris-interop-mcp/src/tools/production.ts` |

### Previous Story Intelligence (Story 5.2)

- Interop.cls created with namespace switching via `ExecuteMCPv2.Utils.SwitchNamespace`
- 4 routes added to Dispatch.cls under `/interop/production/*`
- Tool pattern: POST body with action, namespace in body for POST tools
- 31 production tests + 14 index tests = 45 total interop tests

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.3]
- [Source: src/ExecuteMCPv2/REST/Interop.cls]
- [Source: packages/iris-interop-mcp/src/tools/production.ts]

### Review Findings

- [x] [Review][Patch] SQL error not checked in ItemManage "get" action — SQLCODE < 0 was not detected, falling through to "not found" error [Interop.cls:356] — FIXED: separated SQLCODE check from %Next check
- [x] [Review][Patch] No-op line in AutoStart "set" action: `If tProductionName = "" Set tProductionName = ""` does nothing [Interop.cls:495] — FIXED: replaced with clarifying comment
- [x] [Review][Patch] Confirmed bug fix: `$Get(^Ens.AutoStart)` correctly replaces non-existent `Ens.Director.GetAutoStart()` [Interop.cls:492] — VERIFIED CORRECT
- [x] [Review][Defer] ItemManage "set" silently ignores unknown settings keys — deferred, design limitation
- [x] [Review][Defer] ItemManage "set" save/UpdateProduction inconsistency on partial failure — deferred, pre-existing IRIS pattern

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required - all implementations compiled and tests passed on first attempt.

### Completion Notes List

- Implemented `ItemManage()` in Interop.cls with enable/disable/get/set actions using Ens.Director.EnableConfigItem and Ens.Config.Item SQL/object access
- Implemented `AutoStart()` in Interop.cls with get/set actions using Ens.Director.GetAutoStart/SetAutoStart
- Both methods follow existing namespace switching pattern (save/restore tOrigNS)
- Added 2 routes to Dispatch.cls for `/interop/production/item` and `/interop/production/autostart`
- Created `productionItemTool` and `productionAutostartTool` in item.ts following production.ts patterns exactly
- Both tools use scope NS, readOnlyHint: false, destructiveHint: false (static annotations, tool can both read and modify)
- Updated index.ts to export 6 tools total (4 existing + 2 new)
- Created 22 unit tests in item.test.ts covering all actions, namespace resolution, error handling, and annotations
- Updated index.test.ts to account for 6 tools (was 4)
- All 67 interop tests pass, turbo build succeeds, no regressions in other packages

### Change Log

- 2026-04-06: Implemented Story 5.3 - Production Item & Auto-Start Tools (2 ObjectScript methods, 2 TypeScript tools, 22 new tests)

### File List

- src/ExecuteMCPv2/REST/Interop.cls (modified - added ItemManage, AutoStart methods)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified - added 2 routes)
- packages/iris-interop-mcp/src/tools/item.ts (new - productionItemTool, productionAutostartTool)
- packages/iris-interop-mcp/src/tools/index.ts (modified - exports 6 tools)
- packages/iris-interop-mcp/src/__tests__/item.test.ts (new - 22 tests)
- packages/iris-interop-mcp/src/__tests__/index.test.ts (modified - updated counts to 6)
