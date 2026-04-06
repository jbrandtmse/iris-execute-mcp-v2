# Story 3.3: ObjectScript Execution REST Handler & Tools

Status: done

## Story

As a developer,
I want to execute ObjectScript commands and call class methods through my AI assistant,
So that I can run code on IRIS directly from the AI conversation.

## Acceptance Criteria

1. **Given** a valid ObjectScript command string
   **When** `iris.execute.command` is called
   **Then** the command is executed on IRIS via POST /api/executemcp/v2/command (FR37)
   **And** captured I/O output (Write statements, error messages) is returned in the response

2. **Given** a class name, method name, and optional positional parameters
   **When** `iris.execute.classmethod` is called
   **Then** the class method is invoked on IRIS via POST /api/executemcp/v2/classmethod (FR38)
   **And** the return value is included in the response
   **And** output parameters are supported and returned

3. **Given** a command or classmethod call that fails
   **When** an ObjectScript error occurs
   **Then** the error is returned as a structured MCP tool error with an actionable message
   **And** internal IRIS error details ($ZERROR, stack traces) are not exposed (NFR11)

4. **Given** any execution request with a namespace parameter
   **When** the handler processes the request
   **Then** execution occurs in the specified namespace
   **And** the namespace is restored after execution, even on error (NFR21)

5. **And** the ExecuteMCPv2.REST.Command handler class is created and compiles on IRIS
   **And** both tools are registered in iris-dev-mcp's tool registry (src/tools/execute.ts)
   **And** both tools are annotated as readOnlyHint: false, destructiveHint: false (general-purpose execution)
   **And** unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling

## Tasks / Subtasks

- [x] Task 1: Implement ExecuteMCPv2.REST.Command handler (AC: #1-4)
  - [x] 1.1: Replace stub `Execute()` with full implementation — read JSON body (command, namespace), switch namespace, use `XECUTE` to run command with I/O capture via `##class(%Device).ReDirectIO(1)` with label-based redirect tags (wstr/wchr/wnl/wff), return output via RenderResponseBody
  - [x] 1.2: Replace stub `ClassMethod()` — read JSON body (className, methodName, args[], namespace), switch namespace, use `$ClassMethod()` to invoke with up to 10 positional args, capture return value, return via RenderResponseBody
  - [x] 1.3: Add input validation (command required, className/methodName required)
  - [x] 1.4: Add namespace switch/restore pattern and error sanitization
  - [x] 1.5: Compile on IRIS and verify via direct testing

- [x] Task 2: Create TypeScript tools (AC: #5)
  - [x] 2.1: Create `packages/iris-dev-mcp/src/tools/execute.ts` with 2 tool definitions:
    - `iris.execute.command` — POST /api/executemcp/v2/command with JSON body {command, namespace}
    - `iris.execute.classmethod` — POST /api/executemcp/v2/classmethod with JSON body {className, methodName, args, namespace}
  - [x] 2.2: Add Zod input schemas with annotations (readOnlyHint: false, destructiveHint: false)
  - [x] 2.3: Wire tools into `packages/iris-dev-mcp/src/tools/index.ts`

- [x] Task 3: Unit tests for TypeScript tools (AC: #5)
  - [x] 3.1: Create `packages/iris-dev-mcp/src/__tests__/execute.test.ts`
  - [x] 3.2: Test each tool: success response, error handling, parameter validation, namespace forwarding
  - [x] 3.3: Use shared test helpers from `test-helpers.ts`
  - [x] 3.4: Run `pnpm test` and verify all tests pass

- [x] Task 4: IRIS unit tests for Command handler (AC: #1-4)
  - [x] 4.1: Create `src/ExecuteMCPv2/Tests/CommandTest.cls` with tests for Execute and ClassMethod
  - [x] 4.2: Test I/O capture, error handling, namespace restore, argument passing
  - [x] 4.3: Compile and run on IRIS

## Dev Notes

### I/O Capture for Command Execution

The `Execute()` method must capture Write output from the executed command. Pattern:

```objectscript
ClassMethod Execute() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = ""
    Try {
        Set tSC = ##class(ExecuteMCPv2.Utils).ReadRequestBody(.tBody)
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        
        Set tCommand = tBody.command
        Set tNamespace = tBody.namespace
        
        ; Validate
        Set tSC = ##class(ExecuteMCPv2.Utils).ValidateRequired(tCommand, "command")
        If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        
        ; Switch namespace
        If tNamespace '= "" {
            Set tSC = ##class(ExecuteMCPv2.Utils).SwitchNamespace(tNamespace, .tOrigNS)
            If $$$ISERR(tSC) { Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC)) Quit }
        }
        
        ; Capture I/O output using %Stream.TmpCharacter and redirecting $IO
        Set tStream = ##class(%Stream.TmpCharacter).%New()
        Set tOldIO = $IO
        Use $IO::("^"_$ZName)  ; or use Open/Use pattern for output capture
        
        ; XECUTE the command
        XECUTE tCommand
        
        ; Read captured output
        ; ... restore $IO, read stream ...
        
        Set tResult = {"output": (tOutput)}
        Do ..RenderResponseBody($$$OK, , tResult)
    } Catch ex {
        Set tSC = ex.AsStatus()
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(tSC))
    }
    If tOrigNS '= "" Do ##class(ExecuteMCPv2.Utils).RestoreNamespace(tOrigNS)
    Quit tSC
}
```

**I/O Redirect approach:** Use `##class(%Device).ReDirectIO(1)` with `wstr`/`wchr`/`wnl`/`wff` redirect tags, or use the simpler `%IO.StringStream` approach. Research the best pattern for IRIS I/O redirection if uncertain — use Perplexity MCP.

### ClassMethod Invocation

Use `$ClassMethod(className, methodName, args...)` for dynamic invocation:

```objectscript
; Build argument list dynamically
If tArgs.%Size() = 0 {
    Set tReturn = $ClassMethod(tClassName, tMethodName)
} ElseIf tArgs.%Size() = 1 {
    Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0))
} ElseIf tArgs.%Size() = 2 {
    Set tReturn = $ClassMethod(tClassName, tMethodName, tArgs.%Get(0), tArgs.%Get(1))
}
; ... up to a reasonable max (e.g., 10 args)
```

**Note:** ObjectScript doesn't have spread/apply for dynamic arg count. You'll need to handle argument counts up to a reasonable maximum (10 args) with explicit branching, or use `XECUTE` to build a dynamic call string.

### TypeScript Tool Pattern

Follow the pattern from `global.ts`:
- `const BASE_URL = "/api/executemcp/v2";`
- POST body as JSON, NOT query params
- Response envelope: `{ status: { errors: [] }, console: [], result: { output: "..." } }`

```typescript
export const executeCommandTool: ToolDefinition = {
  name: "iris.execute.command",
  title: "Execute Command",
  description: "Execute an ObjectScript command on IRIS with captured I/O output.",
  inputSchema: z.object({
    command: z.string().describe("ObjectScript command to execute"),
    namespace: z.string().optional().describe("Target namespace"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => { ... }
};
```

### Previous Story Intelligence (Story 3.2)

- Global.cls provides the full handler pattern: namespace switch → try → work → RenderResponseBody → catch → SanitizeError → restore
- TypeScript tools use `BASE_URL = "/api/executemcp/v2"` constant
- Test helpers: `createMockHttp()`, `createMockCtx()`, `envelope()` from test-helpers.ts
- Tool count is now 19 (13 Atelier + 4 global + 2 execute) — updated from 17
- Current totals: 281 TypeScript tests + 44 IRIS unit tests

### Project Structure Notes

```
packages/iris-dev-mcp/src/tools/
  execute.ts            (new — 2 tool definitions)
  index.ts              (modified — add execute tool imports)
packages/iris-dev-mcp/src/__tests__/
  execute.test.ts       (new — unit tests)
  index.test.ts         (modified — updated tool count from 17 to 19)
src/ExecuteMCPv2/REST/
  Command.cls           (modified — replace stubs with full implementation)
src/ExecuteMCPv2/Tests/
  CommandTest.cls       (new — IRIS unit tests)
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 3.3 acceptance criteria]
- [Source: src/ExecuteMCPv2/REST/Command.cls — Current stub implementation]
- [Source: src/ExecuteMCPv2/REST/Global.cls — Handler pattern reference]
- [Source: packages/iris-dev-mcp/src/tools/global.ts — Tool definition pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Compiled ExecuteMCPv2.REST.Command.cls on IRIS (USER namespace) — success, 0 errors
- Compiled ExecuteMCPv2.Tests.CommandTest.cls on IRIS (USER namespace) — success, 0 errors
- Ran ExecuteMCPv2.Tests (all) — 44 passed, 0 failed, 0 errors
- Ran iris-dev-mcp TypeScript tests — 153 passed (9 test files)
- Ran shared TypeScript tests — 128 passed (8 test files)

### Completion Notes List
- Replaced Command.cls stubs with full implementations for Execute() and ClassMethod()
- I/O capture uses ##class(%Device).ReDirectIO(1) with label-based redirect tags (wstr/wchr/wnl/wff/wtab/rstr/rchr) following the %ZEN.Auxiliary.jsonProvider pattern from the IRIS standard library
- The Redirects() classmethod uses [ProcedureBlock = 0] to expose labels as mnemonic routine entry points
- Output is accumulated in process-private variable %ExecuteMCPOutput
- ClassMethod() supports 0-10 positional arguments via explicit $ClassMethod() branching (ObjectScript lacks spread/apply)
- Both handlers follow the Global.cls pattern: namespace switch -> try -> work -> RenderResponseBody -> catch -> SanitizeError -> restore
- TypeScript tools use POST (not GET) to /api/executemcp/v2/command and /classmethod
- Tool count increased from 17 to 19; index.test.ts updated accordingly
- 18 new TypeScript tests + 15 new IRIS unit tests added
- All tests green: 281 TS tests + 44 IRIS unit tests, zero regressions

### File List
- src/ExecuteMCPv2/REST/Command.cls (modified — stubs replaced with full implementation)
- src/ExecuteMCPv2/Tests/CommandTest.cls (new — 15 IRIS unit tests)
- packages/iris-dev-mcp/src/tools/execute.ts (new — 2 tool definitions)
- packages/iris-dev-mcp/src/tools/index.ts (modified — added execute tool imports, tool count 17→19)
- packages/iris-dev-mcp/src/__tests__/execute.test.ts (new — 18 TypeScript unit tests)
- packages/iris-dev-mcp/src/__tests__/index.test.ts (modified — updated tool count assertions from 17 to 19)

### Review Findings

- [x] [Review][Patch] Outer catch in Execute() does not restore mnemonic routine [Command.cls:79-88] — fixed: added Use tInitIO restore before ReDirectIO(0) in outer catch
- [x] [Review][Patch] OREF return value from ClassMethod() not guarded for JSON serialization [Command.cls:166-170] — fixed: added $IsObject guard, returns "<Object:ClassName>" for OREFs
- [x] [Review][Patch] %ExecuteMCPOutput process-private variable not cleaned up after use [Command.cls:75] — fixed: added Kill %ExecuteMCPOutput after reading value
- [x] [Review][Defer] AC2 output/ByRef parameters not supported in ClassMethod handler — deferred, requires complex dynamic ByRef handling in ObjectScript; return values work correctly

## Change Log
- 2026-04-06: Story 3.3 implementation complete — Command.cls Execute/ClassMethod handlers, TypeScript execute tools, all tests passing
- 2026-04-06: Code review — 3 patches applied (I/O restore, OREF guard, variable cleanup), 1 deferred (ByRef support), 2 dismissed
