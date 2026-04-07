# Story 6.6: Task Scheduling Tools

Status: done

## Story

As an operations engineer,
I want to create, manage, and execute scheduled tasks through MCP tools,
so that I can automate IRIS maintenance without the Management Portal.

## Acceptance Criteria

1. **AC1**: `iris.task.manage` with action "create" creates a new scheduled task on IRIS (FR92). Requires name, taskClass, and namespace.
2. **AC2**: `iris.task.manage` with action "modify" updates task configuration (FR92).
3. **AC3**: `iris.task.manage` with action "delete" removes a scheduled task (FR92).
4. **AC4**: `iris.task.list` returns all scheduled tasks with schedules, last run time, and next run time (FR93).
5. **AC5**: `iris.task.run` executes a task immediately (FR94). Response confirms execution was triggered.
6. **AC6**: `iris.task.history` returns task execution history including past run times, status, and duration (FR95).
7. **AC7**: `ExecuteMCPv2.REST.Task` handler class is created and compiles on IRIS.
8. **AC8**: All tools execute in %SYS scope.
9. **AC9**: `iris.task.manage` is annotated as `destructiveHint: true`.
10. **AC10**: `iris.task.list` and `iris.task.history` are annotated as `readOnlyHint: true`.
11. **AC11**: `iris.task.run` is annotated as `destructiveHint: false` (triggers execution, doesn't delete).
12. **AC12**: Unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling.
13. **AC13**: All existing tests pass (`turbo test` green).
14. **AC14**: Build succeeds (`turbo build` green).

## Tasks / Subtasks

- [x] Task 1: Create ObjectScript Task handler class (AC: 7)
  - [x] Create `src/ExecuteMCPv2/REST/Task.cls` extending `%Atelier.REST`
  - [x] Implement `TaskList()` class method — lists all tasks with details
  - [x] Implement `TaskManage()` class method — create/modify/delete tasks
  - [x] Implement `TaskRun()` class method — run a task immediately
  - [x] Implement `TaskHistory()` class method — get task execution history
  - [x] All methods: switch to %SYS, collect data, restore namespace, RenderResponseBody
  - [x] Deploy and compile on IRIS

- [x] Task 2: Update Dispatch UrlMap and IPM module
  - [x] Add routes to `src/ExecuteMCPv2/REST/Dispatch.cls`:
    - `GET /task/list` -> `ExecuteMCPv2.REST.Task:TaskList`
    - `POST /task/manage` -> `ExecuteMCPv2.REST.Task:TaskManage`
    - `POST /task/run` -> `ExecuteMCPv2.REST.Task:TaskRun`
    - `GET /task/history` -> `ExecuteMCPv2.REST.Task:TaskHistory`
  - [x] Add Task.cls to IPM `ipm/module.xml` resource list
  - [x] Deploy and compile Dispatch.cls

- [x] Task 3: Create TypeScript task tools (AC: 1-6, 8-11)
  - [x] Create `packages/iris-ops-mcp/src/tools/task.ts`
  - [x] Implement `taskManageTool` — POST `/task/manage`, destructiveHint: true
  - [x] Implement `taskListTool` — GET `/task/list`, readOnlyHint: true
  - [x] Implement `taskRunTool` — POST `/task/run`, destructiveHint: false
  - [x] Implement `taskHistoryTool` — GET `/task/history`, readOnlyHint: true
  - [x] All tools: scope: `"NONE"` (handler switches to %SYS internally)
  - [x] Update `src/tools/index.ts` to export all 4 new tools (15 total)

- [x] Task 4: Create unit tests (AC: 12)
  - [x] Create `packages/iris-ops-mcp/src/__tests__/task.test.ts`
  - [x] Test task.manage create/modify/delete actions
  - [x] Test task.list response parsing
  - [x] Test task.run with task ID
  - [x] Test task.history with task ID filter
  - [x] Test error handling (IrisApiError propagation)

- [x] Task 5: Final validation (AC: 13, 14)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass

## Dev Notes

### IRIS API Reference — VERIFIED via live testing

**Task List (TaskList method) — VERIFIED live:**
- `%SYS.Task:TaskListDetail` named query in %SYS namespace
- Columns (verified): `Task Name`, `Description`, `Task Type`, `Namespace`, `TaskClass`, `Batch Mode`, `Priority`, `Suspended`, `Reschedule on Start`, `Suspend on Error`, `Run Task`, `Run Interval`, `MirrorStatus`, `Next Scheduled Date`, `Next Scheduled Time`, `Start Date`, `End Date`, `Last Started`, `Last Finished`, `Last Status`, `Last Result`, `%ER Date`, `%ER Error #`, `ID`
- Execute with no args to get all tasks

**Task Manage (TaskManage method) — VERIFIED live:**
- Create: `Set task = ##class(%SYS.Task).%New()`, set properties, `task.%Save()`
- Key properties on `%SYS.Task` (verified via %OpenId):
  - `Name` (%String) — task name
  - `NameSpace` (%String) — target namespace
  - `TaskClass` (%String) — class to execute (e.g., "%SYS.Task.IntegrityCheck")
  - `Description` (%String) — description
  - `Suspended` (%Boolean) — whether suspended
- Modify: `Set task = ##class(%SYS.Task).%OpenId(id)`, update properties, `task.%Save()`
- Delete: `Set tSC = ##class(%SYS.Task).%DeleteId(id)`

**Task Run (TaskRun method) — VERIFIED live:**
- `##class(%SYS.Task).RunNow(taskId)` — returns %Status, triggers immediate execution
- Verified: `RunNow(1)` returns $$$OK on this instance

**Task History (TaskHistory method) — VERIFIED live:**
- `%SYS.Task.History:TaskHistoryDetail` named query
- Execute with task ID to filter: `tRS.Execute(taskId)`
- Columns (verified): `Last Start`, `Completed`, `Task Name`, `Status`, `Result`, `NameSpace`, `Routine`, `Pid`, `%ER Date`, `%ER Error #`, `Task`, `Username`, `LogDate`, `LogTime`

### ObjectScript Handler Pattern (NEW handler class)

```objectscript
/// REST handler for IRIS Task Scheduling operations.
Class ExecuteMCPv2.REST.Task Extends %Atelier.REST
{

/// List all scheduled tasks with details.
ClassMethod TaskList() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set $NAMESPACE = "%SYS"
        Set tResult = {}
        Set tTasks = []
        
        Set tRS = ##class(%ResultSet).%New("%SYS.Task:TaskListDetail")
        Set tSC2 = tRS.Execute()
        ; ... iterate and build JSON ...
        Do tRS.Close()
        
        Do tResult.%Set("tasks", tTasks)
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
<!-- Epic 6: Task Scheduling -->
<Route Url="/task/list" Method="GET" Call="ExecuteMCPv2.REST.Task:TaskList" />
<Route Url="/task/manage" Method="POST" Call="ExecuteMCPv2.REST.Task:TaskManage" />
<Route Url="/task/run" Method="POST" Call="ExecuteMCPv2.REST.Task:TaskRun" />
<Route Url="/task/history" Method="GET" Call="ExecuteMCPv2.REST.Task:TaskHistory" />
```

### File Locations

| What | Path |
|------|------|
| New Task handler | `src/ExecuteMCPv2/REST/Task.cls` |
| Dispatch (update routes) | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| IPM module | `ipm/module.xml` |
| New task tools | `packages/iris-ops-mcp/src/tools/task.ts` |
| Tools index | `packages/iris-ops-mcp/src/tools/index.ts` |
| Unit tests | `packages/iris-ops-mcp/src/__tests__/task.test.ts` |

### Critical Rules

- **NEW handler class** — This story creates `Task.cls` (unlike stories 6.2-6.5 which added methods to Monitor.cls)
- **Update IPM module.xml** — Add Task.cls in same story (per Epic 5 retro lesson)
- Use `Set tOrigNS = $NAMESPACE` pattern, never `New $NAMESPACE`
- Always restore namespace in catch blocks as first line
- Task create/modify requires %SYS namespace for %SYS.Task operations
- `RunNow(taskId)` is async — it triggers the task but doesn't wait for completion
- Update `src/tools/index.ts` (will be 15 tools total)
- Update `src/__tests__/index.test.ts` tool count expectations

### Previous Story Intelligence (Story 6.5)

- Monitor.cls has 11 methods — this story creates a NEW Task.cls handler
- Tools index exports 11 tools — will be 15 after this story
- 100 ops-mcp tests passing, ~850 total

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.6]
- [IRIS API: %SYS.Task — Name, NameSpace, TaskClass, Suspended properties verified live]
- [IRIS API: %SYS.Task:TaskListDetail — 24 columns verified live]
- [IRIS API: %SYS.Task.RunNow(id) — returns %Status, verified live]
- [IRIS API: %SYS.Task.History:TaskHistoryDetail — 14 columns verified live]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — clean implementation, no debugging required.

### Completion Notes List

- Created Task.cls ObjectScript handler with 4 methods (TaskList, TaskManage, TaskRun, TaskHistory) following established %SYS namespace switching pattern
- Added 4 routes to Dispatch.cls for task endpoints
- Added Task.cls to IPM module.xml resource list
- Created 4 TypeScript tool definitions with correct annotations (manage=destructiveHint:true, list/history=readOnlyHint:true, run=destructiveHint:false)
- All tools use scope "NONE" — handler switches to %SYS internally
- Updated tools index from 11 to 15 tools
- Created 33 unit tests covering all 4 tools (create/modify/delete actions, response parsing, error handling, query parameters)
- Updated index.test.ts expectations from 11 to 15 tools
- All 133 ops-mcp tests pass; turbo build green
- Pre-existing data-mcp/all test failures (no test files) unrelated to this story

### Review Findings

- [x] [Review][Defer] AC6 "duration" field not explicitly computed — lastStart/completed timestamps provide data for client-side derivation; computing duration server-side requires fragile IRIS date parsing [Task.cls, task.ts] — deferred, low risk
- [x] [Review][Defer] No schedule properties (TimePeriod, DailyStartTime, etc.) exposed in create action — reasonable MVP scope; %SYS.Task scheduling is complex — deferred, enhancement

### Change Log

- 2026-04-07: Story 6.6 implementation complete — 4 task scheduling tools with ObjectScript handler and 33 unit tests

### File List

- `src/ExecuteMCPv2/REST/Task.cls` (new) — ObjectScript REST handler for task scheduling
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified) — Added 4 task routes
- `ipm/module.xml` (modified) — Added Task.cls resource
- `packages/iris-ops-mcp/src/tools/task.ts` (new) — 4 TypeScript tool definitions
- `packages/iris-ops-mcp/src/tools/index.ts` (modified) — Export 4 new task tools (15 total)
- `packages/iris-ops-mcp/src/__tests__/task.test.ts` (new) — 33 unit tests
- `packages/iris-ops-mcp/src/__tests__/index.test.ts` (modified) — Updated tool count expectations to 15
