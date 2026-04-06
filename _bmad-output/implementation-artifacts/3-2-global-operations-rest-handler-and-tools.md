# Story 3.2: Global Operations REST Handler & Tools

Status: done

## Story

As a developer,
I want to read, write, delete, and list globals through my AI assistant,
So that I can inspect and manipulate IRIS data structures without using the Terminal.

## Acceptance Criteria

1. **Given** a global name and optional subscripts
   **When** `iris.global.get` is called
   **Then** the value at the specified global node is returned via the custom REST endpoint GET /api/executemcp/v2/global (FR33)
   **And** complex subscript expressions are supported (multi-level, string subscripts)

2. **Given** a global name, subscripts, and a value
   **When** `iris.global.set` is called
   **Then** the global value is set via PUT /api/executemcp/v2/global (FR34)
   **And** the response includes automatic verification that the value was set correctly

3. **Given** a global name and optional subscripts
   **When** `iris.global.kill` is called
   **Then** the specified global node or subtree is deleted via DELETE /api/executemcp/v2/global (FR35)

4. **Given** a namespace
   **When** `iris.global.list` is called with an optional filter pattern
   **Then** a list of globals in the namespace is returned (FR36)

5. **Given** a global operation that would leave IRIS in an inconsistent state
   **When** an error occurs mid-operation
   **Then** the operation fails cleanly without partial state changes (NFR20)
   **And** the namespace is always restored to its original value (NFR21)

6. **And** the ExecuteMCPv2.REST.Global handler class is created and compiles on IRIS
   **And** the four iris.global.* tools are registered in iris-dev-mcp's tool registry (src/tools/global.ts exported via src/tools/index.ts)
   **And** iris.global.get and iris.global.list are annotated as readOnlyHint: true
   **And** iris.global.set is annotated as destructiveHint: false (creates/updates data)
   **And** iris.global.kill is annotated as destructiveHint: true
   **And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling
   **And** all tools respond within 2 seconds for read operations (NFR1)

## Tasks / Subtasks

- [x] Task 1: Implement ExecuteMCPv2.REST.Global handler (AC: #1-5)
  - [x] 1.1: Replace stub `GetGlobal()` with full implementation — read query params (global, subscripts, namespace), switch namespace, execute `$Get`, return value via RenderResponseBody
  - [x] 1.2: Replace stub `SetGlobal()` — read JSON body (global, subscripts, value, namespace), switch namespace, execute `Set`, verify with `$Get`, return result
  - [x] 1.3: Replace stub `KillGlobal()` — read query params/body (global, subscripts, namespace), switch namespace, execute `Kill`, return confirmation
  - [x] 1.4: Replace stub `ListGlobals()` — read query params (namespace, filter), switch namespace, iterate `$Order` on `^$GLOBAL`, return list
  - [x] 1.5: Add input validation using Utils.ValidateRequired/ValidateString for all methods
  - [x] 1.6: Add namespace switch/restore pattern using Utils.SwitchNamespace/RestoreNamespace in all methods
  - [x] 1.7: Add error sanitization using Utils.SanitizeError in all catch blocks
  - [x] 1.8: Compile on IRIS and verify all 4 methods work via execute_classmethod

- [x] Task 2: Create TypeScript tools (AC: #6)
  - [x] 2.1: Create `packages/iris-dev-mcp/src/tools/global.ts` with 4 tool definitions:
    - `iris.global.get` — GET /api/executemcp/v2/global?global=NAME&subscripts=...&namespace=...
    - `iris.global.set` — PUT /api/executemcp/v2/global with JSON body
    - `iris.global.kill` — DELETE /api/executemcp/v2/global?global=NAME&subscripts=...
    - `iris.global.list` — GET /api/executemcp/v2/global/list?namespace=...&filter=...
  - [x] 2.2: Add Zod input schemas with proper annotations (readOnlyHint, destructiveHint)
  - [x] 2.3: Wire tools into `packages/iris-dev-mcp/src/tools/index.ts`

- [x] Task 3: Unit tests for TypeScript tools (AC: #6)
  - [x] 3.1: Create `packages/iris-dev-mcp/src/__tests__/global.test.ts`
  - [x] 3.2: Test each tool: success response parsing, error handling, parameter validation, namespace forwarding
  - [x] 3.3: Use shared test helpers from `test-helpers.ts` (createMockHttp, createMockCtx, envelope)
  - [x] 3.4: Run `pnpm test` and verify all tests pass

- [x] Task 4: IRIS unit tests for Global handler (AC: #1-5)
  - [x] 4.1: Create `src/ExecuteMCPv2/Tests/GlobalTest.cls` with test methods for each operation
  - [x] 4.2: Test namespace switching, error handling, edge cases (missing global, complex subscripts)
  - [x] 4.3: Compile and run on IRIS via execute_unit_tests

## Dev Notes

### ObjectScript Implementation Pattern

Each method in Global.cls follows the handler pattern established in Story 3.1:

```objectscript
ClassMethod GetGlobal() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = ""
    Try {
        ; Read query parameters from %request
        Set tGlobal = $Get(%request.Data("global", 1))
        Set tSubscripts = $Get(%request.Data("subscripts", 1))
        Set tNamespace = $Get(%request.Data("namespace", 1))
        
        ; Validate inputs
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tGlobal, "global")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        
        ; Switch namespace if specified
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        }
        
        ; Build global reference and get value
        Set tRef = ..BuildGlobalRef(tGlobal, tSubscripts)
        Set tValue = $Get(@tRef)
        
        ; Return result
        Set tResult = {"value": (tValue), "defined": ($Data(@tRef) > 0)}
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    ; Always restore namespace
    If tOrigNS '= "" Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Quit tSC
}
```

### Subscript Handling

Subscripts are passed as a comma-separated string. The handler must parse them into proper global reference syntax:
- No subscripts: `^GlobalName`
- Single subscript: `^GlobalName("key1")`
- Multi-level: `^GlobalName("key1","key2","key3")`
- Numeric subscripts: `^GlobalName(1,2,3)` — detect numeric vs string

Consider adding a `BuildGlobalRef(pGlobal, pSubscripts)` private helper method.

### Global Reference Construction

Use `@` indirection operator to access globals dynamically:
```objectscript
Set tRef = "^"_tGlobal
; Add subscripts if present
If tSubscripts '= "" {
    Set tRef = tRef_"("_tSubscripts_")"
}
Set tValue = $Get(@tRef)
```

**CRITICAL:** Validate global name doesn't contain injection patterns. The global name should match `^?1A.AN` pattern (optional caret, then alphanumeric).

### ListGlobals Pattern

```objectscript
Set tGlobal = ""
Set tList = []
For {
    Set tGlobal = $Order(^$GLOBAL(tGlobal))
    Quit:tGlobal=""
    ; Apply filter if specified
    If (tFilter '= "") && (tGlobal '[ tFilter) Continue
    Do tList.%Push(tGlobal)
}
```

### TypeScript Tool Pattern

Follow the pattern from `doc.ts`. Each tool needs:
1. Zod input schema with `.describe()` on each field
2. Annotations object (readOnlyHint, destructiveHint, etc.)
3. Handler function `async (args, ctx) => { ... }`
4. Use `ctx.resolveNamespace(namespace)` for namespace
5. HTTP calls go to `/api/executemcp/v2/global` (NOT the Atelier path — this is the custom REST service)

**Custom REST base URL:** The tools call the custom REST service, not Atelier. The URL pattern is:
```typescript
const baseUrl = `/api/executemcp/v2`;
const response = await ctx.http.get(`${baseUrl}/global?global=${encodeURIComponent(name)}&subscripts=${encodeURIComponent(subscripts)}`);
```

**CRITICAL:** These tools use the custom REST endpoint, NOT atelierPath(). The URL does not include the Atelier version or namespace path segments. Namespace is passed as a query parameter or in the request body.

### Test Pattern

Use shared helpers from `test-helpers.ts`:
```typescript
import { createMockHttp, createMockCtx, envelope } from './test-helpers.js';
```

Test structure per tool:
- Success path: mock HTTP response, verify parsed result
- Error path: mock error response, verify isError flag
- Parameter forwarding: verify namespace passed correctly
- Input validation: verify required params enforced by Zod schema

### Previous Story Intelligence (Story 3.1)

- Utils class is at `src/ExecuteMCPv2/Utils.cls` with SwitchNamespace, RestoreNamespace, ValidateRequired, ValidateString, SanitizeError, ReadRequestBody
- Global.cls stub already exists at `src/ExecuteMCPv2/REST/Global.cls` — replace stub implementations
- Dispatch.cls routes already point to Global handler methods
- Test methods must return `As %Status` and `Quit $$$OK` for DirectTestRunner compatibility
- All 235 TypeScript tests + 17 IRIS unit tests currently passing

### Project Structure Notes

```
packages/iris-dev-mcp/src/tools/
  global.ts           (new — 4 tool definitions)
  index.ts            (modified — add global tool imports)
packages/iris-dev-mcp/src/__tests__/
  global.test.ts      (new — unit tests)
src/ExecuteMCPv2/REST/
  Global.cls          (modified — replace stubs with full implementation)
src/ExecuteMCPv2/Tests/
  GlobalTest.cls      (new — IRIS unit tests)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 3.2 acceptance criteria]
- [Source: src/ExecuteMCPv2/REST/Global.cls — Current stub implementation]
- [Source: src/ExecuteMCPv2/Utils.cls — Validation and namespace utilities]
- [Source: packages/iris-dev-mcp/src/tools/doc.ts — Tool definition pattern]
- [Source: packages/iris-dev-mcp/src/tools/index.ts — Tool registration]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Used ^ClineDebug to diagnose ObjectScript pattern matching bug in BuildGlobalRef numeric detection
- Original pattern `.1"-"1.N.1"."1.N` failed for single-digit numbers; replaced with `(tSub = (+tSub))` idiom

### Completion Notes List
- Replaced all 4 stub methods in Global.cls with full implementations following the handler pattern from Story 3.1
- Added BuildGlobalRef private helper for safe global reference construction with subscript parsing
- Added ValidateGlobalName private helper to prevent injection via global name validation
- Added BuildGlobalRefPublic/ValidateGlobalNamePublic wrappers for unit test access to private methods
- Created 4 TypeScript tool definitions (globalGetTool, globalSetTool, globalKillTool, globalListTool) calling custom REST endpoint
- All tools use /api/executemcp/v2/global (NOT Atelier API) with namespace as query param or body field
- Annotations: iris.global.get and iris.global.list have readOnlyHint: true; iris.global.kill has destructiveHint: true; iris.global.set has destructiveHint: false
- Updated index.ts tool count from 13 to 17
- Updated index.test.ts expectations for 17 tools
- 28 new TypeScript tests (global.test.ts): success paths, error handling, namespace forwarding, annotations, scope
- 12 new IRIS unit tests (GlobalTest.cls): BuildGlobalRef, ValidateGlobalName, set/get/kill/data operations, namespace switch/restore, $Order iteration
- All 263 TypeScript tests pass (135 dev + 128 shared), all 29 IRIS tests pass (12 new + 17 existing)

### File List
- src/ExecuteMCPv2/REST/Global.cls (modified - replaced stubs with full implementation)
- src/ExecuteMCPv2/Tests/GlobalTest.cls (new - 12 IRIS unit tests)
- packages/iris-dev-mcp/src/tools/global.ts (new - 4 tool definitions)
- packages/iris-dev-mcp/src/tools/index.ts (modified - added global tool imports and registration)
- packages/iris-dev-mcp/src/__tests__/global.test.ts (new - 28 TypeScript unit tests)
- packages/iris-dev-mcp/src/__tests__/index.test.ts (modified - updated tool count from 13 to 17)

### Review Findings
- [x] [Review][Patch] Misleading comment in ValidateGlobalName — comment said "letters and digits and dots" but pattern `.1"%"1A.AN` does not match dots; the `.` is the ObjectScript repeat operator [Global.cls:261] — FIXED: corrected comment
- [x] [Review][Defer] ListGlobals has no pagination or max-count safeguard [Global.cls:ListGlobals] — deferred, enhancement for future story
- [x] [Review][Defer] BuildGlobalRef comma-separated subscript parsing cannot handle values containing commas [Global.cls:BuildGlobalRef] — deferred, inherent format limitation

### Change Log
- 2026-04-06: Story 3.2 implementation complete — Global operations REST handler and TypeScript tools
- 2026-04-06: Code review complete — 1 patch applied (comment fix), 2 deferred, 2 dismissed as noise
