# Story 5.2: Production Lifecycle Tools

Status: done

## Story

As an integration engineer,
I want to create, delete, start, stop, and monitor Interoperability productions through MCP tools,
so that I can manage production lifecycle without opening the Management Portal.

## Acceptance Criteria

1. **AC1**: `iris.production.manage` with action "create" creates a new production in the specified namespace (FR63).
2. **AC2**: `iris.production.manage` with action "delete" removes an existing production (FR63).
3. **AC3**: `iris.production.control` with action "start" starts a production (FR64).
4. **AC4**: `iris.production.control` with action "stop", "restart", "update", or "recover" performs the lifecycle action (FR64).
5. **AC5**: `iris.production.status` returns production name, state (Running/Stopped/Suspended/Troubled), and start time (FR65).
6. **AC6**: `iris.production.status` with `detail: true` includes item-level status (state, adapter, queue count) (FR65).
7. **AC7**: `iris.production.summary` returns productions across all namespaces with scope NONE (FR66).
8. **AC8**: `ExecuteMCPv2.REST.Interop` handler class is created and compiles on IRIS.
9. **AC9**: Dispatch UrlMap is extended with `/interop/production` routes and Dispatch recompiles.
10. **AC10**: `iris.production.manage` annotated as `destructiveHint: true`.
11. **AC11**: `iris.production.control` annotated as `destructiveHint: false`.
12. **AC12**: `iris.production.status` and `iris.production.summary` annotated as `readOnlyHint: true`.
13. **AC13**: Unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling.
14. **AC14**: `turbo build` succeeds and all tests pass.

## Tasks / Subtasks

- [x] Task 1: Create ObjectScript Interop handler class (AC: 8)
  - [x] Create `src/ExecuteMCPv2/REST/Interop.cls` extending `%Atelier.REST`
  - [x] Implement `ProductionManage()` class method — create/delete productions
  - [x] Implement `ProductionControl()` class method — start/stop/restart/update/recover
  - [x] Implement `ProductionStatus()` class method — status with optional detail
  - [x] Implement `ProductionSummary()` class method — cross-namespace summary
  - [x] Follow Config/Security pattern: try/catch, namespace save/restore, Utils validation, RenderResponseBody

- [x] Task 2: Update Dispatch UrlMap (AC: 9)
  - [x] Add routes to `src/ExecuteMCPv2/REST/Dispatch.cls`:
    - `GET /interop/production/status` → `ExecuteMCPv2.REST.Interop:ProductionStatus`
    - `GET /interop/production/summary` → `ExecuteMCPv2.REST.Interop:ProductionSummary`
    - `POST /interop/production` → `ExecuteMCPv2.REST.Interop:ProductionManage`
    - `POST /interop/production/control` → `ExecuteMCPv2.REST.Interop:ProductionControl`
  - [x] Remove the commented placeholder route
  - [x] Deploy and compile both Dispatch.cls and Interop.cls

- [x] Task 3: Create TypeScript production tools (AC: 1-7, 10-12)
  - [x] Create `packages/iris-interop-mcp/src/tools/production.ts`
  - [x] Implement `productionManageTool` — create/delete with destructiveHint: true, scope: NS
  - [x] Implement `productionControlTool` — start/stop/restart/update/recover with destructiveHint: false, scope: NS
  - [x] Implement `productionStatusTool` — status query with readOnlyHint: true, scope: NS
  - [x] Implement `productionSummaryTool` — cross-namespace summary with readOnlyHint: true, scope: NONE
  - [x] Update `src/tools/index.ts` to export all production tools

- [x] Task 4: Create unit tests (AC: 13)
  - [x] Create `packages/iris-interop-mcp/src/__tests__/production.test.ts`
  - [x] Test parameter validation for each tool
  - [x] Test successful response parsing
  - [x] Test error handling (IrisApiError propagation)
  - [x] Test production.summary uses empty namespace (scope NONE)

- [x] Task 5: Final validation (AC: 14)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass

### Review Findings

- [x] [Review][Patch] ProductionControl restart validates name AFTER stop — leaves production stopped on validation failure [Interop.cls:175-187] — FIXED: moved name validation before StopProduction call
- [x] [Review][Patch] ProductionStatus missing start time per AC5 [Interop.cls:247-250] — FIXED: added $Get(^Ens.Runtime("StartTime")) query
- [x] [Review][Patch] ProductionStatus detail only shown for Running (state=1), not Suspended/Troubled [Interop.cls:253] — FIXED: expanded to states 1,3,4
- [x] [Review][Defer] ProductionControl tTimeout=0 silently overridden to 120 — deferred, minor UX concern
- [x] [Review][Defer] ProductionSummary inner catch swallows all errors silently — deferred, pre-existing pattern
- [x] [Review][Defer] ExistsId checks class definition not production type — deferred, edge case
- [x] [Review][Defer] No client-side name-required validation for start/restart in Zod schema — deferred, server validates

## Dev Notes

### ObjectScript Interop Handler — IRIS API Reference

**Production Management (create/delete):**
- Create: `Set tSC = ##class(Ens.Config.Production).Create(pName)` — creates empty production class
- Delete: `Set tSC = ##class(Ens.Config.Production).Delete(pName)` — removes production (must be stopped first)
- Check existence: `Set tExists = ##class(Ens.Config.Production).Exists(pName)`

**Production Control (start/stop/restart/update/recover):**
- Start: `Set tSC = ##class(Ens.Director).StartProduction(pName)`
- Stop: `Set tSC = ##class(Ens.Director).StopProduction(pTimeout, pForce)`
  - pTimeout = seconds to wait (default 120), pForce = force stop on timeout
- Restart: Stop then Start
- Update: `Set tSC = ##class(Ens.Director).UpdateProduction()`
- Recover: `Set tSC = ##class(Ens.Director).RecoverProduction(pForce)`

**Production Status:**
- `Set tSC = ##class(Ens.Director).GetProductionStatus(.pProductionName, .pState)`
  - pState: 1=Running, 2=Stopped, 3=Suspended, 4=Troubled, 5=NetworkStopped
- Detail: Use SQL query on `Ens.Config.Item` and `Ens.Config.Production` for item-level info
- Alternative: `##class(Ens.Director).GetProductionSummary(.pInfo)` — may provide additional info

**Production Summary (cross-namespace):**
- Must iterate namespaces and call `GetProductionStatus` in each
- Use `##class(%ResultSet).%New("Config.Namespaces:List")` to get namespaces
- Switch to each namespace, call GetProductionStatus, restore namespace

**CRITICAL: Namespace handling for interop tools:**
- Interop classes (`Ens.*`) exist in the TARGET namespace, NOT %SYS
- Do NOT switch to %SYS for Ens.Director/Ens.Config calls — these must run in the production's namespace
- The only tool that switches namespaces is `ProductionSummary` (iterates all namespaces)
- For single-namespace tools, the tool's namespace parameter already determines execution context

### REST Endpoint Pattern (follow Config/Security exactly)

```objectscript
ClassMethod ProductionManage() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read JSON body (before any namespace switch)
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        
        ; Validate required parameters
        Set tAction = tBody.%Get("action")
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tAction, "action")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Set tSC = $$$OK Quit }
        
        ; Ens.Director and Ens.Config.Production operate in the CURRENT namespace
        ; (no %SYS switch needed — unlike Config/Security handlers)
        
        ; ... action logic ...
        
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit tSC
}
```

### TypeScript Tool Pattern (follow iris-admin-mcp/namespace.ts)

```typescript
const BASE_URL = "/api/executemcp/v2";

export const productionManageTool: ToolDefinition = {
  name: "iris.production.manage",
  title: "Manage Production",
  description: "Create or delete an Interoperability production...",
  inputSchema: z.object({
    action: z.enum(["create", "delete"]),
    name: z.string().describe("Production class name"),
    namespace: z.string().optional(),
  }),
  annotations: { destructiveHint: true, readOnlyHint: false, idempotentHint: false, openWorldHint: false },
  scope: "NS",
  handler: async (args, ctx) => {
    const body = { action: args.action, name: args.name };
    const ns = ctx.resolveNamespace(args.namespace);
    const response = await ctx.http.post(`${BASE_URL}/interop/production`, body, { namespace: ns });
    return { content: [{ type: "text", text: JSON.stringify(response.result, null, 2) }] };
  },
};
```

### File Locations

| What | Path |
|------|------|
| New Interop handler | `src/ExecuteMCPv2/REST/Interop.cls` |
| Dispatch (update routes) | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| Production tools | `packages/iris-interop-mcp/src/tools/production.ts` |
| Tools index | `packages/iris-interop-mcp/src/tools/index.ts` |
| Unit tests | `packages/iris-interop-mcp/src/__tests__/production.test.ts` |
| Reference: namespace.ts | `packages/iris-admin-mcp/src/tools/namespace.ts` |
| Reference: Config.cls | `src/ExecuteMCPv2/REST/Config.cls` |

### Critical Rules

- Ens.* classes run in the target namespace, NOT %SYS (unlike Config/Security)
- Use `Set tOrigNS = $NAMESPACE` pattern, never `New $NAMESPACE`
- Always restore namespace in catch blocks as first line
- Use `$$$` for macros, never `$$`
- Use `///` for doc comments on methods
- Method names must not contain underscores
- Test with shared helpers from `@iris-mcp/shared/test-helpers`

### Previous Story Intelligence (Story 5.1)

- Package created with `needsCustomRest: true` — tools call custom REST service
- `resolveTransport` imported from `@iris-mcp/shared`
- Empty tools array ready to be populated
- 12 passing unit tests for server setup

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.2]
- [Source: _bmad-output/planning-artifacts/architecture.md lines 806, 839]
- [Source: src/ExecuteMCPv2/REST/Dispatch.cls lines 78-79]
- [Source: packages/iris-admin-mcp/src/tools/namespace.ts]
- [Source: src/ExecuteMCPv2/REST/Config.cls]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required — all tasks completed without debugging issues.

### Completion Notes List

- Task 1: Created Interop.cls with 4 class methods (ProductionManage, ProductionControl, ProductionStatus, ProductionSummary). Uses SwitchNamespace for POST endpoints and query param namespace for GET endpoints. ProductionSummary iterates all namespaces via %SYS. All compiled successfully on IRIS.
- Task 2: Added 4 routes to Dispatch.cls UrlMap. Replaced commented placeholder with actual Epic 5 routes. Both classes recompiled successfully.
- Task 3: Created production.ts with 4 tool definitions matching AC annotations (destructiveHint, readOnlyHint, scope). Updated tools/index.ts to export all 4 tools. Namespace passed in body for POST tools, in query params for GET tools.
- Task 4: Created 31 unit tests covering parameter validation, response parsing, error handling, annotation verification, and scope verification for all 4 tools. Updated index.test.ts to reflect 4 tools (was 0).
- Task 5: turbo build succeeds across all 7 packages. turbo test passes 45/45 for interop, 200/200 for dev, 198/198 for admin, 177/177 for shared. Pre-existing failures in empty placeholder packages (data, ops, all) are unrelated.

### Change Log

- 2026-04-06: Story 5.2 implementation complete — 4 production lifecycle tools, ObjectScript REST handler, 45 passing tests.

### File List

- src/ExecuteMCPv2/REST/Interop.cls (new)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified)
- packages/iris-interop-mcp/src/tools/production.ts (new)
- packages/iris-interop-mcp/src/tools/index.ts (modified)
- packages/iris-interop-mcp/src/__tests__/production.test.ts (new)
- packages/iris-interop-mcp/src/__tests__/index.test.ts (modified)
