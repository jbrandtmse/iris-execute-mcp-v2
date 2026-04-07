# Story 6.4: Journal, Mirror & Audit Tools

Status: done

## Story

As an operations engineer,
I want to check journal status, mirror health, and audit logs through MCP tools,
so that I can verify data protection and compliance without the Management Portal.

## Acceptance Criteria

1. **AC1**: `iris.journal.info` returns journal file information including current journal file, directory, size, and available journal files (FR86). Tool executes in %SYS scope.
2. **AC2**: `iris.mirror.status` returns mirror configuration, membership, and synchronization status (FR87). Response includes member roles, sync status. Tool executes in %SYS scope.
3. **AC3**: `iris.audit.events` returns matching audit log events (FR88) with optional filters (time range, user, event type). Each event includes timestamp, user, event type, description, and source. Tool executes in %SYS scope.
4. **AC4**: All three tools are annotated as `readOnlyHint: true`.
5. **AC5**: All tools respond within 2 seconds (NFR1).
6. **AC6**: Unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling.
7. **AC7**: All existing tests pass (`turbo test` green).
8. **AC8**: Build succeeds (`turbo build` green).

## Tasks / Subtasks

- [x] Task 1: Add journal, mirror, and audit methods to Monitor.cls (AC: 1-3)
  - [x] Add `JournalInfo()` class method to `src/ExecuteMCPv2/REST/Monitor.cls`
  - [x] Add `MirrorStatus()` class method to `src/ExecuteMCPv2/REST/Monitor.cls`
  - [x] Add `AuditEvents()` class method to `src/ExecuteMCPv2/REST/Monitor.cls`
  - [x] All methods: switch to %SYS, collect data, restore namespace, RenderResponseBody
  - [x] Deploy and compile on IRIS

- [x] Task 2: Update Dispatch UrlMap
  - [x] Add routes to `src/ExecuteMCPv2/REST/Dispatch.cls`:
    - `GET /monitor/journal` -> `ExecuteMCPv2.REST.Monitor:JournalInfo`
    - `GET /monitor/mirror` -> `ExecuteMCPv2.REST.Monitor:MirrorStatus`
    - `GET /monitor/audit` -> `ExecuteMCPv2.REST.Monitor:AuditEvents`
  - [x] Deploy and compile Dispatch.cls

- [x] Task 3: Create TypeScript tools (AC: 1-4)
  - [x] Create `packages/iris-ops-mcp/src/tools/system.ts`
  - [x] Implement `journalInfoTool` — calls GET `/monitor/journal`
  - [x] Implement `mirrorStatusTool` — calls GET `/monitor/mirror`
  - [x] Implement `auditEventsTool` — calls GET `/monitor/audit` with optional query params
  - [x] All tools: `readOnlyHint: true`, scope: `"NONE"` (handler switches to %SYS internally)
  - [x] Update `src/tools/index.ts` to export all 3 new tools

- [x] Task 4: Create unit tests (AC: 6)
  - [x] Create `packages/iris-ops-mcp/src/__tests__/system.test.ts`
  - [x] Test response parsing for each tool
  - [x] Test audit tool with filters (beginDate, endDate, username, eventType)
  - [x] Test error handling (IrisApiError propagation)
  - [x] Test mirror tool graceful handling when mirroring not configured

- [x] Task 5: Final validation (AC: 7, 8)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass

## Dev Notes

### IRIS API Reference — VERIFIED via SQL on %Dictionary and live testing

**Journal Info (JournalInfo method) — VERIFIED live:**
- `##class(%SYS.Journal.System).GetCurrentFileName()` — returns current journal file path (e.g., `c:\intersystems\irishealth\mgr\journal\20260407.002`)
- `##class(%SYS.Journal.System).GetPrimaryDirectory()` — returns primary journal directory
- `##class(%SYS.Journal.System).GetAlternateDirectory()` — returns alternate journal directory
- `##class(%SYS.Journal.System).GetCurrentFileCount()` — returns file count
- `##class(%SYS.Journal.System).GetCurrentFileOffset()` — returns current offset
- `##class(%SYS.Journal.System).GetFreeSpace()` — returns free space
- `##class(%SYS.Journal.System).GetStateString()` — returns state as string
- `##class(%SYS.Journal.System).GetDefaults(.curdir, .altdir, .maxsize, .expqty, .prefix, .shortnam)` — gets journal defaults
- For journal file list: `##class(%SYS.Journal.File)` — may have query methods; alternatively, use `%SYS.Journal.History`

**Mirror Status (MirrorStatus method) — VERIFIED live:**
- `$SYSTEM.Mirror.IsMember()` — returns 0 (not a mirror member) or 1
- `$SYSTEM.Mirror.MirrorName()` — returns mirror name (empty if not mirrored)
- `$SYSTEM.Mirror.GetMemberType()` — returns "Not Member", "Primary", "Backup", "Async"
- `$SYSTEM.Mirror.IsPrimary()` — boolean
- `$SYSTEM.Mirror.IsBackup()` — boolean
- `$SYSTEM.Mirror.IsAsyncMember()` — boolean
- `$SYSTEM.Mirror.GetStatus(MirrorName)` — returns status string
- `$SYSTEM.Mirror.GetMemberStatus(MirrorName)` — returns $List with member info
- **NOTE**: This IRIS instance is NOT a mirror member (`IsMember()=0`). The handler must gracefully return "not configured" status.

**Audit Events (AuditEvents method) — VERIFIED live:**
- `%SYS.Audit:List` named query in %SYS
- Execute params: `(BeginDateTime, EndDateTime, EventSources, EventTypes, Events, Usernames, SystemIDs, Pids, Groups, Authentications, Flags, JSONSearch)`
- All params default to "*" (match all) or "" (no filter)
- DateTime format: `YYYY-MM-DD HH:MM:SS` or IRIS $Horolog format
- Columns (verified): `SystemID, AuditIndex, TimeStamp, EventSource, EventType, Event, Pid, SessionID, Username, Description, UTCTimeStamp, Group, JobNumber, Authentication, ClientExecutableName, ClientIPAddress, EventData, Namespace, Roles, RoutineSpec, UserInfo, JobId, Status, OSUsername, StartupClientIPAddress`
- Key columns for response: `TimeStamp`, `Username`, `EventSource`, `EventType`, `Event`, `Description`, `ClientIPAddress`, `Namespace`
- **IMPORTANT**: Limit results to prevent huge responses — use a maxRows parameter or default time range

### REST Endpoint Patterns

**Query parameters for audit endpoint:**
```
GET /monitor/audit?beginDate=2026-04-07&endDate=2026-04-08&username=_SYSTEM&eventType=*&maxRows=100
```

**Handler pattern (add to Monitor.cls):**
```objectscript
ClassMethod AuditEvents() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        ; Read query parameters
        Set tBeginDate = $Get(%request.Data("beginDate",1))
        Set tEndDate = $Get(%request.Data("endDate",1))
        Set tUsername = $Get(%request.Data("username",1), "*")
        Set tEventType = $Get(%request.Data("eventType",1), "*")
        Set tMaxRows = +$Get(%request.Data("maxRows",1), 100)
        If tMaxRows < 1 Set tMaxRows = 100
        If tMaxRows > 1000 Set tMaxRows = 1000
        
        Set $NAMESPACE = "%SYS"
        Set tRS = ##class(%ResultSet).%New("%SYS.Audit:List")
        Set tSC2 = tRS.Execute(tBeginDate, tEndDate, "*", tEventType, "*", tUsername)
        ; ... iterate up to tMaxRows ...
    }
    ...
}
```

### Dispatch Routes to Add

```xml
<Route Url="/monitor/journal" Method="GET" Call="ExecuteMCPv2.REST.Monitor:JournalInfo" />
<Route Url="/monitor/mirror" Method="GET" Call="ExecuteMCPv2.REST.Monitor:MirrorStatus" />
<Route Url="/monitor/audit" Method="GET" Call="ExecuteMCPv2.REST.Monitor:AuditEvents" />
```

### File Locations

| What | Path |
|------|------|
| Monitor handler (add methods) | `src/ExecuteMCPv2/REST/Monitor.cls` |
| Dispatch (update routes) | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| New tools | `packages/iris-ops-mcp/src/tools/system.ts` |
| Tools index | `packages/iris-ops-mcp/src/tools/index.ts` |
| Unit tests | `packages/iris-ops-mcp/src/__tests__/system.test.ts` |

### Critical Rules

- **RESEARCH-FIRST**: Only use VERIFIED APIs listed above
- Mirror status MUST handle "not configured" gracefully (this instance has IsMember()=0)
- Audit events MUST have maxRows limit (default 100, max 1000) to prevent huge responses
- Do NOT update IPM module.xml — Monitor.cls is already registered
- Use `Set tOrigNS = $NAMESPACE` pattern, never `New $NAMESPACE`
- Always restore namespace in catch blocks as first line
- Update `src/tools/index.ts` to register new tools (will be 8 total)
- Update `src/__tests__/index.test.ts` tool count expectations

### Testing Standards

- Vitest framework, `*.test.ts` files in `src/__tests__/`
- Mock HTTP responses using shared test helpers
- `turbo build && turbo test` for final validation

### Previous Story Intelligence (Story 6.3)

- Monitor.cls now has 5 methods (SystemMetrics, SystemAlerts, InteropMetrics, JobsList, LocksList) — add 3 more
- Tools index exports 5 tools — will be 8 after this story
- 53 ops-mcp tests passing, 789 total across all packages

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.4]
- [Source: src/ExecuteMCPv2/REST/Monitor.cls]
- [IRIS API: %SYS.Journal.System — GetCurrentFileName, GetPrimaryDirectory verified live]
- [IRIS API: $SYSTEM.Mirror — IsMember, MirrorName, GetMemberType verified live]
- [IRIS API: %SYS.Audit:List — named query, 25 columns verified live]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

- IRIS namespace discovery: EXECUTEMCPV2 namespace does not exist; classes deployed to HSCUSTOM per webapp config
- Both Monitor.cls and Dispatch.cls compiled successfully on IRIS HSCUSTOM namespace

### Completion Notes List

- Added 3 new ObjectScript class methods to Monitor.cls: JournalInfo(), MirrorStatus(), AuditEvents()
- JournalInfo uses %SYS.Journal.System verified class methods for all journal data
- MirrorStatus gracefully handles non-mirrored instances (IsMember()=0) with "Mirror not configured" response
- AuditEvents uses %SYS.Audit:List named query with maxRows limit (default 100, max 1000)
- All methods follow safe namespace switching pattern (Set tOrigNS, restore in catch)
- Added 3 dispatch routes for GET /monitor/journal, /monitor/mirror, /monitor/audit
- Created 3 TypeScript tools (journalInfoTool, mirrorStatusTool, auditEventsTool) all with readOnlyHint: true
- auditEventsTool accepts optional filters: beginDate, endDate, username, eventType, maxRows
- Updated tools index from 5 to 8 tools
- Created 23 unit tests covering response parsing, display formatting, filter params, error handling, mirror not-configured
- Updated index.test.ts tool count expectations from 5 to 8
- turbo build: all 7 packages succeed
- turbo test: 812 tests pass (76 ops-mcp, 182 shared, 200 dev, 198 admin, 156 interop) with zero regressions

### File List

- src/ExecuteMCPv2/REST/Monitor.cls (modified - added JournalInfo, MirrorStatus, AuditEvents methods)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified - added 3 routes)
- packages/iris-ops-mcp/src/tools/system.ts (new - 3 tool definitions)
- packages/iris-ops-mcp/src/tools/index.ts (modified - added 3 tool exports)
- packages/iris-ops-mcp/src/__tests__/system.test.ts (new - 23 tests)
- packages/iris-ops-mcp/src/__tests__/index.test.ts (modified - updated tool count to 8)

### Change Log

- 2026-04-07: Implemented Story 6.4 - Journal, Mirror & Audit Tools (3 IRIS methods, 3 TS tools, 23 tests)
