# Story 3.1: ObjectScript REST Dispatch & Utils Classes

Status: done

## Story

As a developer,
I want the IRIS-side REST service foundation with URL routing and shared utilities,
So that all custom REST handlers have a consistent base for request handling, namespace management, and response formatting.

## Acceptance Criteria

1. **Given** the ExecuteMCPv2 package on IRIS
   **When** ExecuteMCPv2.REST.Dispatch is created
   **Then** it extends %Atelier.REST and defines the UrlMap for Epic 3 REST endpoints only
   **And** initial routes map to handler classes: /command, /classmethod → Command, /tests → UnitTest, /global → Global
   **And** the URL prefix is /api/executemcp/v2/
   **And** the Dispatch class is designed to be extended in subsequent epics (Epics 4-7) as new handler classes are created

2. **Given** a request to any REST endpoint
   **When** the handler processes the request
   **Then** the response uses the Atelier-style three-part envelope ({status, console, result}) inherited from %Atelier.REST via RenderResponseBody()
   **And** errors are returned via StatusToJSON() converting %Status to structured error objects

3. **Given** the ExecuteMCPv2.Utils class
   **When** a handler needs to switch namespace
   **Then** Utils provides a namespace switch helper that saves current $NAMESPACE, switches to the target, and guarantees restore in both normal and error paths
   **And** Utils provides input validation helpers for common parameter types (string, integer, boolean, required fields) (NFR10)

4. **Given** any REST handler encountering an error
   **When** the error is returned to the caller
   **Then** internal IRIS details (stack traces, global references, $ZERROR) are stripped — only safe, actionable messages are returned (NFR11)

5. **And** the Dispatch class compiles successfully on IRIS
   **And** all ObjectScript follows the handler pattern: namespace save → try → work → RenderResponseBody → catch → RenderResponseBody → restore namespace

## Tasks / Subtasks

- [x] Task 1: Create ExecuteMCPv2.Utils class (AC: #3, #4)
  - [x] 1.1: Create `src/ExecuteMCPv2/Utils.cls` with class methods for:
    - `SwitchNamespace(pNamespace, Output pOriginal)` — saves $NAMESPACE to pOriginal, sets $NAMESPACE to pNamespace, returns %Status
    - `RestoreNamespace(pOriginal)` — restores $NAMESPACE to pOriginal
    - `ValidateRequired(pValue, pName)` — returns error %Status if value is empty
    - `ValidateString(pValue, pName, pMaxLen)` — validates string input, returns %Status
    - `ValidateInteger(pValue, pName)` — validates integer input, returns %Status
    - `ValidateBoolean(pValue, pName)` — validates boolean input (0/1/true/false), returns %Status
    - `SanitizeError(pStatus)` — strips $ZERROR, stack traces, global references from %Status error text; returns safe %Status
    - `ReadRequestBody(Output pBody)` — reads %request content, parses JSON into %DynamicObject, returns %Status
  - [x] 1.2: Compile on IRIS using compile_objectscript_class MCP tool

- [x] Task 2: Create ExecuteMCPv2.REST.Dispatch class (AC: #1, #2, #5)
  - [x] 2.1: Create `src/ExecuteMCPv2/REST/Dispatch.cls` extending %Atelier.REST
  - [x] 2.2: Define UrlMap XData block with routes:
    - `POST /command` → `ExecuteMCPv2.REST.Command:Execute`
    - `POST /classmethod` → `ExecuteMCPv2.REST.Command:ClassMethod`
    - `POST /tests` → `ExecuteMCPv2.REST.UnitTest:RunTests`
    - `GET /global` → `ExecuteMCPv2.REST.Global:GetGlobal`
    - `PUT /global` → `ExecuteMCPv2.REST.Global:SetGlobal`
    - `DELETE /global` → `ExecuteMCPv2.REST.Global:KillGlobal`
    - `GET /global/list` → `ExecuteMCPv2.REST.Global:ListGlobals`
  - [x] 2.3: Compile on IRIS using compile_objectscript_class MCP tool
  - [x] 2.4: Verify compilation succeeds (handler classes don't need to exist yet — routes just reference them)

- [x] Task 3: Create stub handler classes for compilation (AC: #5)
  - [x] 3.1: Create `src/ExecuteMCPv2/REST/Command.cls` extending %Atelier.REST with stub methods Execute() and ClassMethod() returning $$$OK
  - [x] 3.2: Create `src/ExecuteMCPv2/REST/UnitTest.cls` extending %Atelier.REST with stub method RunTests() returning $$$OK
  - [x] 3.3: Create `src/ExecuteMCPv2/REST/Global.cls` extending %Atelier.REST with stub methods GetGlobal(), SetGlobal(), KillGlobal(), ListGlobals() returning $$$OK
  - [x] 3.4: Compile all handler stubs on IRIS
  - [x] 3.5: Compile entire ExecuteMCPv2 package to verify cross-references resolve

- [x] Task 4: Verify end-to-end routing (AC: #1, #2)
  - [x] 4.1: Use iris-execute-mcp or iris-dev-mcp MCP tools to verify Dispatch class is accessible
  - [x] 4.2: Document verification results in completion notes

### Review Findings

- [x] [Review][Patch] SanitizeError infinite loop when caret is not a global/routine reference [src/ExecuteMCPv2/Utils.cls:95-121] -- FIXED: Added offset tracking to $Find loop and else-branch to advance past non-reference carets
- [x] [Review][Patch] ReadRequestBody crashes with INVALID OREF when %request.Content is undefined [src/ExecuteMCPv2/Utils.cls:137] -- FIXED: Added $IsObject($Get(%request.Content)) guard before accessing .Size
- [x] [Review][Defer] Stub handler catch blocks do not render error response body [src/ExecuteMCPv2/REST/Command.cls, UnitTest.cls, Global.cls] -- deferred, stubs will be replaced in Stories 3.2-3.4

## Dev Notes

### ObjectScript Class File Location

All ObjectScript files go in `src/ExecuteMCPv2/` directory structure mirroring the package hierarchy:
```
src/
  ExecuteMCPv2/
    Utils.cls
    REST/
      Dispatch.cls
      Command.cls      (stub — implemented in Story 3.3)
      UnitTest.cls     (stub — implemented in Story 3.4)
      Global.cls       (stub — implemented in Story 3.2)
```

### %Atelier.REST Base Class

The Dispatch class extends `%Atelier.REST` which provides:
- `RenderResponseBody()` — renders the three-part envelope `{ status: { errors: [] }, console: [], result: {} }`
- `StatusToJSON()` — converts %Status to structured error objects
- Built-in ETag/If-None-Match caching support
- CSP session/authentication handling

Source: `irislib/%Atelier/REST.cls`

### UrlMap XData Pattern

```objectscript
XData UrlMap [ XMLNamespace = "http://www.intersystems.com/urlmap" ]
{
<Routes>
  <Route Url="/command" Method="POST" Call="ExecuteMCPv2.REST.Command:Execute" />
  <Route Url="/classmethod" Method="POST" Call="ExecuteMCPv2.REST.Command:ClassMethod" />
  <Route Url="/tests" Method="POST" Call="ExecuteMCPv2.REST.UnitTest:RunTests" />
  <Route Url="/global" Method="GET" Call="ExecuteMCPv2.REST.Global:GetGlobal" />
  <Route Url="/global" Method="PUT" Call="ExecuteMCPv2.REST.Global:SetGlobal" />
  <Route Url="/global" Method="DELETE" Call="ExecuteMCPv2.REST.Global:KillGlobal" />
  <Route Url="/global/list" Method="GET" Call="ExecuteMCPv2.REST.Global:ListGlobals" />
</Routes>
}
```

**CRITICAL:** Routes use fully qualified class names with `:MethodName` syntax. The Call attribute references `Package.Class:Method`.

### Namespace Switch Pattern (Utils)

```objectscript
ClassMethod SwitchNamespace(pNamespace As %String, Output pOriginal As %String) As %Status
{
    Set tSC = $$$OK
    Try {
        Set pOriginal = $NAMESPACE
        Set $NAMESPACE = pNamespace
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

### Error Sanitization (NFR11)

The `SanitizeError()` method must strip:
- `$ZERROR` content (contains internal line references like `+5^MyRoutine`)
- Stack trace information
- Global node references (like `^MyGlobal("key")`)
- Replace with generic actionable messages like "An internal error occurred" or preserve only the high-level error code/description from %Status

Pattern: Use `$System.Status.GetErrorText(pStatus)` to get text, then regex/pattern-match to strip sensitive details.

### Handler Pattern (for stub classes)

Every handler method follows this pattern (stubs return minimal response):
```objectscript
ClassMethod Execute() As %Status
{
    Set tSC = $$$OK
    Try {
        ; Full implementation in Story 3.3
        Do ..RenderResponseBody({"result": "not implemented"})
    } Catch ex {
        Set tSC = ex.AsStatus()
    }
    Quit tSC
}
```

### Extensibility for Future Epics

The Dispatch UrlMap is designed to grow. Stories in Epics 4-7 will add routes like:
- `/config/:entity` → Config handler (Epic 4)
- `/production/:action` → Interoperability handler (Epic 5)
- `/system/:metric` → Ops handler (Epic 6)

The Dispatch class should have a clear comment block indicating where new routes are added.

### Previous Story Intelligence (Story 3.0)

- Shared test helpers now in `packages/iris-dev-mcp/src/__tests__/test-helpers.ts`
- ToolContext has `paginate()` method available
- PaginateResult type exported from shared package
- All 235 tests passing (128 shared + 107 dev)

### Compilation

Use the `compile_objectscript_class` MCP tool to compile each class. Use `compile_objectscript_package` for the full package verification. Specify namespace parameter (default: USER or the configured namespace).

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 3.1 acceptance criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md — REST service architecture, NFR10/11/20/21]
- [Source: _bmad-output/planning-artifacts/research/atelier-api-reference.md — Atelier endpoint patterns]
- [Source: irislib/%Atelier/REST.cls — Base class for Dispatch]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None required — all classes compiled and tests passed on first attempt after fixing test method signatures.

### Completion Notes List
- Task 1: Created ExecuteMCPv2.Utils with 8 class methods: SwitchNamespace, RestoreNamespace, ValidateRequired, ValidateString, ValidateInteger, ValidateBoolean, SanitizeError, ReadRequestBody. All compiled successfully on IRIS (USER namespace). Verified via execute_classmethod: ValidateRequired correctly rejects empty values, ValidateInteger rejects non-numeric input, ValidateBoolean rejects invalid values, SwitchNamespace captures and switches namespace, ValidateString enforces max length.
- Task 2: Created ExecuteMCPv2.REST.Dispatch extending %Atelier.REST with UrlMap XData defining 7 routes for Epic 3 endpoints. Includes commented placeholder routes for Epics 4-7. Compiled successfully on IRIS.
- Task 3: Created 3 stub handler classes (Command, UnitTest, Global) each extending %Atelier.REST with stub methods following the handler pattern (try/catch, RenderResponseBody). All compiled individually and full package compilation succeeded (5 classes, 0 errors).
- Task 4: Verified all classes accessible via MCP tools. Utils methods validated with direct classmethod calls. Package compilation confirmed all cross-references resolve.
- Tests: Created ExecuteMCPv2.Tests.UtilsTest with 17 unit tests covering all Utils methods. All 17 tests pass (0 failures, 0 errors, 8ms execution time). Tests cover success paths, error paths, edge cases (empty values, invalid types, max length exceeded, invalid namespace).
- Key decision: Test methods must return `As %Status` and `Quit $$$OK` to work with the DirectTestRunner framework used by execute_unit_tests.

### Change Log
- 2026-04-06: Story 3.1 implementation — created REST dispatch, utils, and stub handler classes with full unit test coverage.

### File List
- src/ExecuteMCPv2/Utils.cls (new)
- src/ExecuteMCPv2/REST/Dispatch.cls (new)
- src/ExecuteMCPv2/REST/Command.cls (new)
- src/ExecuteMCPv2/REST/UnitTest.cls (new)
- src/ExecuteMCPv2/REST/Global.cls (new)
- src/ExecuteMCPv2/Tests/UtilsTest.cls (new)
