# Story 4.3: Namespace Mapping Tools

Status: done

## Story

As an administrator,
I want to create, delete, and list global, routine, and package mappings between namespaces,
So that I can configure cross-namespace data and code access.

## Acceptance Criteria

1. **AC1**: `iris.mapping.manage` tool supports create/delete actions for global, routine, and package mappings via custom REST endpoint (FR44)
2. **AC2**: `iris.mapping.list` tool returns all global, routine, and package mappings for a given namespace (FR45)
3. **AC3**: Both tools execute in %SYS scope (target namespace is a data parameter)
4. **AC4**: `iris.mapping.manage` is annotated as `destructiveHint: true`
5. **AC5**: `iris.mapping.list` is annotated as `readOnlyHint: true`
6. **AC6**: Config.cls is extended with mapping handler methods and Dispatch UrlMap updated
7. **AC7**: Unit tests with mocked HTTP verify parameter validation, response parsing, and error handling
8. **AC8**: `turbo build` and `turbo test` pass

## Tasks / Subtasks

- [x] Task 1: Extend `src/ExecuteMCPv2/REST/Config.cls` with mapping methods (AC: 6)
  - [x] Add `MappingList(pType As %String)` — calls Config.MapGlobals/MapRoutines/MapPackages based on type, returns all mappings for a namespace
  - [x] Add `MappingManage(pType As %String)` — reads JSON body, dispatches create/delete via Config.Map* classes
  - [x] Follow the NamespaceManage/NamespaceList pattern: try/catch, %SYS switch, validate inputs, sanitize errors
  - [x] Support types: "global", "routine", "package"

- [x] Task 2: Update `src/ExecuteMCPv2/REST/Dispatch.cls` UrlMap (AC: 6)
  - [x] Add route: `/config/mapping/:type` GET → `Config:MappingList`
  - [x] Add route: `/config/mapping/:type` POST → `Config:MappingManage`
  - [x] The `:type` parameter distinguishes global/routine/package

- [x] Task 3: Compile updated Config.cls and Dispatch.cls on IRIS
  - [x] Use iris-dev-mcp MCP tools to put and compile
  - [x] Verify compilation succeeds

- [x] Task 4: Update `packages/shared/src/bootstrap-classes.ts`
  - [x] Update `ExecuteMCPv2.REST.Config.cls` content with new mapping methods
  - [x] Update `ExecuteMCPv2.REST.Dispatch.cls` content with new routes

- [x] Task 5: Create TypeScript tools (AC: 1-5)
  - [x] Create `packages/iris-admin-mcp/src/tools/mapping.ts` with:
    - `iris.mapping.manage` — params: action (create|delete), type (global|routine|package), namespace, name, database, plus type-specific optional params. Scope: SYS, destructiveHint: true
    - `iris.mapping.list` — params: namespace, type (global|routine|package). Scope: SYS, readOnlyHint: true
  - [x] Wire tools into `packages/iris-admin-mcp/src/tools/index.ts`

- [x] Task 6: Write unit tests (AC: 7)
  - [x] Create `packages/iris-admin-mcp/src/__tests__/mapping.test.ts`
  - [x] Import test helpers from `@iris-mcp/shared/test-helpers`
  - [x] Test: action dispatch, type parameter routing, required params, error handling, annotations

- [x] Task 7: Build and validate (AC: 8)
  - [x] Run `turbo build` — all packages succeed
  - [x] Run `turbo test` — all tests pass

## Dev Notes

### IRIS Config Mapping Classes

```objectscript
// All require %SYS namespace
// Global mappings
Set tSC = ##class(Config.MapGlobals).Create(pNamespace, pName, .tProperties)
Set tSC = ##class(Config.MapGlobals).Delete(pNamespace, pName)
Set tSC = ##class(Config.MapGlobals).Get(pNamespace, pName, .tProperties)
Do ##class(Config.MapGlobals).List(pNamespace, .tList)

// Routine mappings — same API
Set tSC = ##class(Config.MapRoutines).Create(pNamespace, pName, .tProperties)
Set tSC = ##class(Config.MapRoutines).Delete(pNamespace, pName)

// Package mappings — same API
Set tSC = ##class(Config.MapPackages).Create(pNamespace, pName, .tProperties)
Set tSC = ##class(Config.MapPackages).Delete(pNamespace, pName)
```

### Config.MapGlobals Properties
- `Database` — target database name (required for create)
- `Collation` — collation setting
- `LockDatabase` — lock database name
- `Subscript` — subscript range (for subscript-level mappings)

### Config.MapRoutines Properties
- `Database` — target database name (required for create)

### Config.MapPackages Properties
- `Database` — target database name (required for create)

### Design Decision: 2 Tools Not 6

Use 2 tools with a `type` parameter rather than 6 separate tools (one per mapping type). This keeps the tool count manageable and mirrors the consistent API across Config.MapGlobals/MapRoutines/MapPackages.

### TypeScript Tool Pattern

```typescript
export const mappingManageTool: ToolDefinition = {
  name: 'iris.mapping.manage',
  title: 'Manage Namespace Mapping',
  description: 'Create or delete a global, routine, or package mapping between namespaces',
  inputSchema: z.object({
    action: z.enum(['create', 'delete']).describe('Action to perform'),
    type: z.enum(['global', 'routine', 'package']).describe('Type of mapping'),
    namespace: z.string().describe('Namespace to configure mappings for'),
    name: z.string().describe('Mapping name (global name, routine name, or package name)'),
    database: z.string().optional().describe('Target database name (required for create)'),
    // type-specific optional params
  }),
  annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  scope: 'SYS',
  handler: async (args, ctx) => { ... },
};
```

### Key Files to Reference

| Reference | Path |
|-----------|------|
| Config handler | `src/ExecuteMCPv2/REST/Config.cls` (add methods here) |
| Dispatch routes | `src/ExecuteMCPv2/REST/Dispatch.cls` (add routes) |
| Tool pattern | `packages/iris-admin-mcp/src/tools/namespace.ts` |
| Test pattern | `packages/iris-admin-mcp/src/__tests__/namespace.test.ts` |
| Bootstrap | `packages/shared/src/bootstrap-classes.ts` |

### Anti-Patterns to Avoid

- Do NOT create separate handler classes for mappings — extend Config.cls
- Do NOT create 6 tools — use 2 tools with `type` parameter
- Do NOT support "modify" action — mapping modification is done by delete + create
- Do NOT forget to update bootstrap-classes.ts with updated Config.cls and Dispatch.cls content

### Previous Story Intelligence (Story 4.2)

- Config.cls established with NamespaceList/NamespaceManage/DatabaseList/DatabaseManage
- Dispatch has `/config/namespace` and `/config/database` routes
- bootstrap-classes.ts has Config.cls with 318 lines — will grow with mapping methods
- 45 admin tests (15 namespace + 15 database + 15 index)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3 lines 1133-1155]
- [Source: src/ExecuteMCPv2/REST/Config.cls — existing handler]
- [Source: packages/iris-admin-mcp/src/tools/namespace.ts — tool pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None needed — compilation and all tests passed on first attempt.

### Completion Notes List
- Implemented MappingList and MappingManage class methods in Config.cls using $ClassMethod dynamic dispatch to support global/routine/package types with a single pair of methods
- MappingList accepts type as URL param and namespace as query param; MappingManage accepts type as URL param and action/namespace/name/database in JSON body
- Only create and delete actions are supported for mappings (no modify — per anti-pattern guidance, modification is done by delete + create)
- Global mappings support additional optional properties: collation, lockDatabase, subscript
- Added 2 routes to Dispatch.cls UrlMap for GET/POST on /config/mapping/:type
- Both classes compiled successfully on IRIS (57ms)
- Created mapping.ts with iris.mapping.manage (destructiveHint: true) and iris.mapping.list (readOnlyHint: true), both with scope: SYS
- Wired into tools/index.ts — admin server now registers 6 tools total
- Created 20 unit tests covering: all 3 mapping types (global/routine/package), create and delete actions, global-specific optional params, URL encoding for namespace query param, IrisApiError handling, non-API error propagation, annotation verification, scope verification, cursor param availability
- Updated index.test.ts to expect 6 tools instead of 4
- Updated bootstrap-classes.ts with full Config.cls and Dispatch.cls content including new methods and routes
- turbo build: 7/7 packages succeed; turbo test: admin (65 tests), shared (151 tests), dev (192 tests) all pass

### Review Findings

- [x] [Review][Patch] MappingList uses `Set tSC = $ClassMethod(tClassName, "List", ...)` but `Config.Map*.List` does not return %Status (existing NamespaceList uses `Do`). Fixed: changed to `Do $ClassMethod(...)` in Config.cls and bootstrap-classes.ts. [Config.cls:358, bootstrap-classes.ts:661]
- [x] [Review][Defer] `tProps` not killed between loop iterations in MappingList — properties from prior mapping could leak into next entry. Pre-existing pattern (NamespaceList has same issue). Deferred to deferred-work.md.

### File List
- src/ExecuteMCPv2/REST/Config.cls (modified — added MappingList, MappingManage methods)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified — added 2 mapping routes)
- packages/shared/src/bootstrap-classes.ts (modified — updated Config.cls and Dispatch.cls content)
- packages/iris-admin-mcp/src/tools/mapping.ts (new — iris.mapping.manage and iris.mapping.list tool definitions)
- packages/iris-admin-mcp/src/tools/index.ts (modified — added mapping tool imports and registrations)
- packages/iris-admin-mcp/src/__tests__/mapping.test.ts (new — 20 unit tests)
- packages/iris-admin-mcp/src/__tests__/index.test.ts (modified — updated tool count from 4 to 6)
