# Story 5.6: Rules, Transforms & REST API Tools

Status: done

## Story

As an integration engineer,
I want to view business rules, test data transformations, and manage REST APIs through MCP tools,
so that I can inspect and validate integration logic without the Management Portal.

## Acceptance Criteria

1. **AC1**: `iris.rule.list` returns all business rule classes in the namespace (FR78).
2. **AC2**: `iris.rule.get` returns the rule definition including conditions, actions, and routing logic (FR78).
3. **AC3**: `iris.transform.list` returns all data transformation classes in the namespace (FR79).
4. **AC4**: `iris.transform.test` executes a transformation against sample input and returns the output (FR79).
5. **AC5**: `iris.interop.rest` with action "create" creates a REST application from an OpenAPI spec (FR80).
6. **AC6**: `iris.interop.rest` with action "delete" removes a REST application (FR80).
7. **AC7**: `iris.interop.rest` with action "get" returns the OpenAPI spec for a REST application (FR80).
8. **AC8**: `iris.rule.list`, `iris.rule.get`, `iris.transform.list` annotated as `readOnlyHint: true`.
9. **AC9**: `iris.transform.test` annotated as `readOnlyHint: false` (executes code).
10. **AC10**: `iris.interop.rest` annotated as `destructiveHint: true` (can delete).
11. **AC11**: New routes added to Dispatch UrlMap and Interop.cls compiles.
12. **AC12**: Unit tests verify parameter validation, response parsing, and error handling.
13. **AC13**: `turbo build` succeeds and all tests pass.

## Tasks / Subtasks

- [x] Task 1: Add ObjectScript methods to Interop.cls (AC: 1-7, 11)
  - [x] Implement `RuleList()` class method — list business rule classes via SQL
  - [x] Implement `RuleGet()` class method — return rule definition/XML
  - [x] Implement `TransformList()` class method — list DTL transform classes via SQL
  - [x] Implement `TransformTest()` class method — execute a transform with sample input
  - [x] Implement `RestManage()` class method — create/delete/get REST applications
  - [x] Add routes to Dispatch.cls:
    - `GET /interop/rule` → `ExecuteMCPv2.REST.Interop:RuleList`
    - `GET /interop/rule/get` → `ExecuteMCPv2.REST.Interop:RuleGet`
    - `GET /interop/transform` → `ExecuteMCPv2.REST.Interop:TransformList`
    - `POST /interop/transform/test` → `ExecuteMCPv2.REST.Interop:TransformTest`
    - `POST /interop/rest` → `ExecuteMCPv2.REST.Interop:RestManage`

- [x] Task 2: Create TypeScript tools (AC: 1-10)
  - [x] Create `packages/iris-interop-mcp/src/tools/rule.ts`
  - [x] Implement `ruleListTool` — readOnlyHint: true, scope: NS
  - [x] Implement `ruleGetTool` — readOnlyHint: true, scope: NS
  - [x] Create `packages/iris-interop-mcp/src/tools/transform.ts`
  - [x] Implement `transformListTool` — readOnlyHint: true, scope: NS
  - [x] Implement `transformTestTool` — readOnlyHint: false, scope: NS
  - [x] Create `packages/iris-interop-mcp/src/tools/rest.ts`
  - [x] Implement `interopRestTool` — destructiveHint: true, scope: NS
  - [x] Update `src/tools/index.ts` to export all new tools

- [x] Task 3: Create unit tests (AC: 12)
  - [x] Create `packages/iris-interop-mcp/src/__tests__/rule.test.ts`
  - [x] Create `packages/iris-interop-mcp/src/__tests__/transform.test.ts`
  - [x] Create `packages/iris-interop-mcp/src/__tests__/rest.test.ts`
  - [x] Test each tool's parameter validation and response parsing
  - [x] Test error handling

- [x] Task 4: Final validation (AC: 13)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass

### Review Findings

- [x] [Review][Patch] Dead If/Else in RestManage `get` action — both branches identical, collapsed to single statement [Interop.cls:1587] — FIXED
- [x] [Review][Patch] Unused `%JSONExport()` call in TransformTest writes to device, could corrupt HTTP response — removed call, kept `%JSONExportToString` only [Interop.cls:1462] — FIXED
- [x] [Review][Patch] RuleGet doc comment referenced `:name` URL parameter instead of query parameter `name` — corrected documentation [Interop.cls:1258] — FIXED

## Dev Notes

### ObjectScript IRIS API Reference

**Business Rules (FR78):**
- List: SQL query `SELECT Name FROM %Dictionary.ClassDefinition WHERE super [ 'Ens.Rule.Definition' AND Abstract = 0`
  - Alternative: Check `Ens.Rule.RuleDefinition` superclass
- Get rule definition: Export as XML using `##class(%Compiler.UDL.TextServices).GetTextAsString(, pClassName, .tText)`
  - Or: `##class(Ens.Rule.RuleDefinition).%OpenId(pClassName)` and read properties
  - Simplest: Return class XData blocks which contain the rule XML

**Data Transformations (FR79):**
- List: SQL query `SELECT Name FROM %Dictionary.ClassDefinition WHERE super [ 'Ens.DataTransformDTL' AND Abstract = 0`
  - Or: `WHERE super [ 'Ens.DataTransform'`
- Test: `Set tSC = $ClassMethod(pClassName, "Transform", pInput, .pOutput)`
  - Input/output are message objects — for testing, create from JSON or pass class name + properties
  - Simpler approach: Use `##class(Ens.DataTransform).Transform(pInput, .pOutput)` pattern
  - Testing requires instantiating the source message class — may be complex for REST API

**REST API Management (FR80):**
- Create from OpenAPI spec: `Set tSC = ##class(%REST.API).CreateApplication(pAppName, pSpec)`
  - pSpec can be a %DynamicObject containing the OpenAPI JSON
- Delete: `Set tSC = ##class(%REST.API).DeleteApplication(pAppName)`
- Get spec: `Set tSC = ##class(%REST.API).GetApplication(pAppName, .pSpec)`
  - Returns the OpenAPI spec as a %DynamicObject
- Note: `%REST.API` may exist in newer IRIS versions only — research availability

**CRITICAL: Namespace handling:**
- All Ens.* classes and %Dictionary queries run in TARGET namespace
- %REST.API may run in the target namespace as well
- Use established SwitchNamespace pattern

### TypeScript Tool Pattern

- GET tools (rule.list, rule.get, transform.list): query params, readOnlyHint: true
- POST tools (transform.test, interop.rest): JSON body
- Follow existing patterns from production.ts and monitor.ts

### File Locations

| What | Path |
|------|------|
| Interop handler (extend) | `src/ExecuteMCPv2/REST/Interop.cls` |
| Dispatch (add routes) | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| New rule tools | `packages/iris-interop-mcp/src/tools/rule.ts` |
| New transform tools | `packages/iris-interop-mcp/src/tools/transform.ts` |
| New REST tools | `packages/iris-interop-mcp/src/tools/rest.ts` |
| Tools index (update) | `packages/iris-interop-mcp/src/tools/index.ts` |
| Tests | `packages/iris-interop-mcp/src/__tests__/rule.test.ts`, `transform.test.ts`, `rest.test.ts` |

### Previous Story Intelligence (Story 5.5)

- Interop.cls has 14 methods, 14 tools in index.ts
- 126 interop tests, 799 total
- Credential list verified NFR6 (no passwords)
- LookupTransfer builds XML manually — similar pattern may be needed for rule export
- SQL queries on %Dictionary.ClassDefinition with `super [` operator used in AdapterList (Story 5.4)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.6]
- [Source: src/ExecuteMCPv2/REST/Interop.cls]
- [Source: packages/iris-interop-mcp/src/tools/monitor.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- Interop.cls compilation error: `{}.%FromJSON(tJSONStr)` inside %Set call not allowed; fixed by using `##class(%DynamicObject).%FromJSON()` with temp variable
- Zod v4 API difference: `z.record(z.unknown())` requires two args in v4; fixed to `z.record(z.string(), z.unknown())`
- RuleGet route changed from `/interop/rule/:name` to `/interop/rule/get` with query param to handle dotted class names

### Completion Notes List

- Added 5 new ObjectScript methods to Interop.cls: RuleList, RuleGet, TransformList, TransformTest, RestManage
- Added 5 new routes to Dispatch.cls for the new methods
- Created 3 new TypeScript tool files: rule.ts (2 tools), transform.ts (2 tools), rest.ts (1 tool)
- Updated tools/index.ts to export all 19 tools (was 14)
- Created 3 new test files with 30 new tests (rule: 10, transform: 11, rest: 9)
- Updated index.test.ts counts from 14 to 19 and added new tool name assertions
- All ObjectScript classes compile successfully in HSCUSTOM namespace
- turbo build succeeds across all packages
- All 156 interop tests pass (was 126)

### File List

- `src/ExecuteMCPv2/REST/Interop.cls` (modified) — Added RuleList, RuleGet, TransformList, TransformTest, RestManage methods
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified) — Added 5 new routes for rules, transforms, REST API
- `packages/iris-interop-mcp/src/tools/rule.ts` (new) — ruleListTool, ruleGetTool
- `packages/iris-interop-mcp/src/tools/transform.ts` (new) — transformListTool, transformTestTool
- `packages/iris-interop-mcp/src/tools/rest.ts` (new) — interopRestTool
- `packages/iris-interop-mcp/src/tools/index.ts` (modified) — Added imports/exports for 5 new tools
- `packages/iris-interop-mcp/src/__tests__/rule.test.ts` (new) — 10 tests
- `packages/iris-interop-mcp/src/__tests__/transform.test.ts` (new) — 11 tests
- `packages/iris-interop-mcp/src/__tests__/rest.test.ts` (new) — 9 tests
- `packages/iris-interop-mcp/src/__tests__/index.test.ts` (modified) — Updated tool counts to 19

### Change Log

- 2026-04-06: Implemented Story 5.6 — Rules, Transforms & REST API Tools (5 new ObjectScript methods, 5 new TypeScript tools, 30 new tests)
