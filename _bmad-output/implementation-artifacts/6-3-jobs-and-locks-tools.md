# Story 6.3: Jobs & Locks Tools

Status: done

## Story

As an operations engineer,
I want to list running IRIS jobs and system locks through MCP tools,
so that I can identify resource contention and long-running processes.

## Acceptance Criteria

1. **AC1**: `iris.jobs.list` returns all running IRIS jobs/processes (FR84). Each job includes process ID, routine, namespace, state, and start time. Tool has scope NONE.
2. **AC2**: `iris.locks.list` returns all current system locks (FR85). Each lock includes lock name, owner process ID, lock type, and lock count. Tool has scope NONE.
3. **AC3**: Both tools are annotated as `readOnlyHint: true`.
4. **AC4**: Both tools respond within 2 seconds (NFR1).
5. **AC5**: Unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling.
6. **AC6**: All existing tests pass (`turbo test` green).
7. **AC7**: Build succeeds (`turbo build` green).

## Tasks / Subtasks

- [x] Task 1: Add jobs and locks methods to Monitor.cls (AC: 1, 2)
  - [x] Add `JobsList()` class method to `src/ExecuteMCPv2/REST/Monitor.cls`
  - [x] Add `LocksList()` class method to `src/ExecuteMCPv2/REST/Monitor.cls`
  - [x] Both methods: switch to %SYS, collect data, restore namespace, RenderResponseBody
  - [x] Deploy and compile on IRIS

- [x] Task 2: Update Dispatch UrlMap
  - [x] Add routes to `src/ExecuteMCPv2/REST/Dispatch.cls`:
    - `GET /monitor/jobs` -> `ExecuteMCPv2.REST.Monitor:JobsList`
    - `GET /monitor/locks` -> `ExecuteMCPv2.REST.Monitor:LocksList`
  - [x] Deploy and compile Dispatch.cls

- [x] Task 3: Create TypeScript jobs/locks tools (AC: 1-3)
  - [x] Create `packages/iris-ops-mcp/src/tools/jobs.ts`
  - [x] Implement `jobsListTool` — calls GET `/monitor/jobs`, returns process list
  - [x] Implement `locksListTool` — calls GET `/monitor/locks`, returns lock list
  - [x] Both tools: `readOnlyHint: true`, scope: `"NONE"`
  - [x] Update `src/tools/index.ts` to export both tools

- [x] Task 4: Create unit tests (AC: 5)
  - [x] Create `packages/iris-ops-mcp/src/__tests__/jobs.test.ts`
  - [x] Test response parsing for each tool
  - [x] Test error handling (IrisApiError propagation)
  - [x] Test both tools use scope NONE

- [x] Task 5: Final validation (AC: 6, 7)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass

### Review Findings

- [x] [Review][Defer] AC1 mentions "start time" but %SYS.ProcessQuery has no start time column — deferred, spec imprecision vs IRIS API reality
- [x] [Review][Defer] No ObjectScript-side unit test for dual-format Owner parsing in LocksList — deferred, lead verified manually in Step 2.5

## Dev Notes

### IRIS API Reference — VERIFIED via SQL on %Dictionary and live testing

**Jobs List (JobsList method) — VERIFIED:**
- SQL on `%SYS.ProcessQuery` in %SYS namespace — this is a queryable SQL table
- Key columns (verified by running `SELECT TOP 5 * FROM %SYS.ProcessQuery`):
  - `Pid` (%Integer) — OS process ID
  - `NameSpace` (%String) — Current namespace
  - `Routine` (%String) — Current routine name
  - `State` (%String) — Process state (e.g., "RUNW", "READ", "HANG")
  - `UserName` (%String) — IRIS username
  - `ClientIPAddress` (%String) — Client IP
  - `JobType` (%Integer) — Job type code
  - `CommandsExecuted` (%Integer) — Commands executed
  - `GlobalReferences` (%Integer) — Global references made
  - `LinesExecuted` (%Integer) — Lines executed
  - `InTransaction` (%Boolean) — Whether in a transaction
  - `CPUTime` (%Integer) — CPU time used

**SQL query pattern:**
```sql
SELECT Pid, NameSpace, Routine, State, UserName, ClientIPAddress, 
       JobType, CommandsExecuted, GlobalReferences, InTransaction, CPUTime
FROM %SYS.ProcessQuery
ORDER BY Pid
```

**Locks List (LocksList method) — VERIFIED:**
- `%SYS.LockQuery:List` named query in %SYS namespace
- Columns (verified live): `DelKey`, `Owner`, `Mode`, `Flags`, `Counts`, `Sfn`, `LockString`, `FullReference`
- `Owner` contains pipe-delimited data like `|13792|X||1` — parse for PID and mode
- `FullReference` contains the lock reference (global name with subscripts)
- `Counts` contains the lock count

**Named query pattern:**
```objectscript
Set tRS = ##class(%ResultSet).%New("%SYS.LockQuery:List")
Set tSC = tRS.Execute()
While tRS.Next() {
    ; Use tRS.Get("Owner"), tRS.Get("FullReference"), tRS.Get("Counts"), tRS.Get("Mode")
}
```

### ObjectScript Handler Pattern (add to Monitor.cls)

```objectscript
/// Return running IRIS jobs/processes.
ClassMethod JobsList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tResult = {}
        Set tJobs = []
        
        Set tRS = ##class(%SQL.Statement).%ExecDirect(,
            "SELECT Pid, NameSpace, Routine, State, UserName, ClientIPAddress, "_
            "JobType, CommandsExecuted, GlobalReferences, InTransaction, CPUTime "_
            "FROM %SYS.ProcessQuery ORDER BY Pid")
        If $IsObject(tRS) {
            While tRS.%Next() {
                Set tJob = {}
                Do tJob.%Set("pid", +tRS.Pid, "number")
                Do tJob.%Set("namespace", tRS.NameSpace)
                ; ... etc ...
                Do tJobs.%Push(tJob)
            }
        }
        
        Do tResult.%Set("jobs", tJobs)
        Do tResult.%Set("count", tJobs.%Size(), "number")
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody($$$OK, , tResult)
    }
    Catch ex {
        Set $NAMESPACE = tOrigNS
        Do ..RenderResponseBody(##class(ExecuteMCPv2.Utils).SanitizeError(ex.AsStatus()))
        Set tSC = $$$OK
    }
    Quit $$$OK
}
```

### Dispatch Routes to Add

```xml
<Route Url="/monitor/jobs" Method="GET" Call="ExecuteMCPv2.REST.Monitor:JobsList" />
<Route Url="/monitor/locks" Method="GET" Call="ExecuteMCPv2.REST.Monitor:LocksList" />
```

### TypeScript Tool Pattern

```typescript
export const jobsListTool: ToolDefinition = {
  name: "iris.jobs.list",
  title: "List Jobs",
  description: "List all running IRIS jobs/processes with details...",
  inputSchema: z.object({}),
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  scope: "NONE",
  handler: async (args, ctx) => {
    const response = await ctx.http.get(`${BASE_URL}/monitor/jobs`);
    return { content: [{ type: "text", text: JSON.stringify(response.result, null, 2) }], structuredContent: response.result };
  },
};
```

### File Locations

| What | Path |
|------|------|
| Monitor handler (add methods) | `src/ExecuteMCPv2/REST/Monitor.cls` |
| Dispatch (update routes) | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| New jobs tools | `packages/iris-ops-mcp/src/tools/jobs.ts` |
| Tools index | `packages/iris-ops-mcp/src/tools/index.ts` |
| Unit tests | `packages/iris-ops-mcp/src/__tests__/jobs.test.ts` |
| Reference: metrics.ts | `packages/iris-ops-mcp/src/tools/metrics.ts` |

### Critical Rules

- **RESEARCH-FIRST**: Only use VERIFIED APIs listed above. `%SYS.ProcessQuery` is an SQL-queryable table in %SYS. `%SYS.LockQuery:List` is a named query using `%ResultSet`.
- Owner field in locks is pipe-delimited — parse carefully
- Do NOT add new handler classes — add methods to existing Monitor.cls
- Do NOT update IPM module.xml — Monitor.cls is already registered from Story 6.2
- Use `Set tOrigNS = $NAMESPACE` pattern, never `New $NAMESPACE`
- Always restore namespace in catch blocks as first line
- Update `src/tools/index.ts` to register the new tools
- Update `src/__tests__/index.test.ts` if tool count expectations exist

### Testing Standards

- Vitest framework, `*.test.ts` files in `src/__tests__/`
- Mock HTTP responses using shared test helpers
- `turbo build && turbo test` for final validation

### Previous Story Intelligence (Story 6.2)

- Monitor.cls exists with SystemMetrics, SystemAlerts, InteropMetrics methods — add JobsList and LocksList
- Tools index already exports 3 metrics tools — add 2 more
- index.test.ts expects 3 tools — update to 5
- 37 ops-mcp tests currently passing

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.3]
- [Source: src/ExecuteMCPv2/REST/Monitor.cls] (add methods here)
- [IRIS API: %SYS.ProcessQuery — SQL table verified with SELECT TOP 5]
- [IRIS API: %SYS.LockQuery:List — named query verified, columns: Owner, Mode, Counts, FullReference]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

No debug globals needed — all implementations compiled and tested successfully on first attempt.

### Completion Notes List

- Task 1: Added `JobsList()` and `LocksList()` class methods to Monitor.cls. JobsList queries `%SYS.ProcessQuery` SQL table for all process details (pid, namespace, routine, state, userName, clientIPAddress, jobType, commandsExecuted, globalReferences, inTransaction, cpuTime). LocksList uses `%SYS.LockQuery:List` named query via `%ResultSet`, parsing pipe-delimited Owner field for ownerPid. Both follow established namespace-switch pattern with safe restore in catch blocks.
- Task 2: Added two GET routes to Dispatch.cls UrlMap: `/monitor/jobs` -> `Monitor:JobsList`, `/monitor/locks` -> `Monitor:LocksList`. Both compiled successfully on IRIS (HSCUSTOM namespace).
- Task 3: Created `jobs.ts` with `jobsListTool` and `locksListTool`. Both tools have `readOnlyHint: true`, `scope: "NONE"`, and human-readable text formatting. Updated `index.ts` to export all 5 tools.
- Task 4: Created 16 unit tests in `jobs.test.ts` covering: scope NONE verification, readOnlyHint annotation, HTTP endpoint calls, response parsing/formatting, empty result handling, IrisApiError error handling, non-IrisApiError propagation, in-transaction indicator, multiple locks display.
- Task 5: `turbo build` green (7/7 packages). `turbo test` green for all packages with tests (53 ops-mcp tests, 789 total across all packages). Pre-existing failures in @iris-mcp/data and @iris-mcp/all (no test files) are unrelated.

### Change Log

- 2026-04-07: Implemented Story 6.3 — Jobs & Locks Tools (all 5 tasks complete)

### File List

- `src/ExecuteMCPv2/REST/Monitor.cls` (modified — added JobsList, LocksList methods)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified — added /monitor/jobs, /monitor/locks routes)
- `packages/iris-ops-mcp/src/tools/jobs.ts` (new — jobsListTool, locksListTool)
- `packages/iris-ops-mcp/src/tools/index.ts` (modified — exports 5 tools)
- `packages/iris-ops-mcp/src/__tests__/jobs.test.ts` (new — 16 tests)
- `packages/iris-ops-mcp/src/__tests__/index.test.ts` (modified — updated tool count expectations to 5)
