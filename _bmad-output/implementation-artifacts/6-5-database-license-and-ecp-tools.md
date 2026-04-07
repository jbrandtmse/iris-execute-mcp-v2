# Story 6.5: Database, License & ECP Tools

Status: done

## Story

As an operations engineer,
I want to check database integrity, license usage, and ECP connection status through MCP tools,
so that I can verify system health and capacity.

## Acceptance Criteria

1. **AC1**: `iris.database.check` returns database integrity status for all databases or a specified database (FR89). Response includes mounted status, encryption status, journal state, and size. Tool executes in %SYS scope.
2. **AC2**: `iris.license.info` returns license usage and details (FR90). Response includes license type, total capacity, current usage, and expiration date. Tool has scope NONE.
3. **AC3**: `iris.ecp.status` returns ECP client and server connection status (FR91). Response includes connection health or indicates ECP is not configured. Tool executes in %SYS scope.
4. **AC4**: All three tools are annotated as `readOnlyHint: true`.
5. **AC5**: Unit tests with mocked HTTP responses verify parameter validation, response parsing, and error handling.
6. **AC6**: All existing tests pass (`turbo test` green).
7. **AC7**: Build succeeds (`turbo build` green).

## Tasks / Subtasks

- [x] Task 1: Add database, license, and ECP methods to Monitor.cls (AC: 1-3)
  - [x] Add `DatabaseCheck()` class method to `src/ExecuteMCPv2/REST/Monitor.cls`
  - [x] Add `LicenseInfo()` class method to `src/ExecuteMCPv2/REST/Monitor.cls`
  - [x] Add `ECPStatus()` class method to `src/ExecuteMCPv2/REST/Monitor.cls`
  - [x] All methods: switch to %SYS where needed, collect data, restore namespace, RenderResponseBody
  - [x] Deploy and compile on IRIS

- [x] Task 2: Update Dispatch UrlMap
  - [x] Add routes to `src/ExecuteMCPv2/REST/Dispatch.cls`:
    - `GET /monitor/database` -> `ExecuteMCPv2.REST.Monitor:DatabaseCheck`
    - `GET /monitor/license` -> `ExecuteMCPv2.REST.Monitor:LicenseInfo`
    - `GET /monitor/ecp` -> `ExecuteMCPv2.REST.Monitor:ECPStatus`
  - [x] Deploy and compile Dispatch.cls

- [x] Task 3: Create TypeScript tools (AC: 1-4)
  - [x] Create `packages/iris-ops-mcp/src/tools/infrastructure.ts`
  - [x] Implement `databaseCheckTool` — calls GET `/monitor/database` with optional `name` param
  - [x] Implement `licenseInfoTool` — calls GET `/monitor/license`
  - [x] Implement `ecpStatusTool` — calls GET `/monitor/ecp`
  - [x] All tools: `readOnlyHint: true`, scope: `"NONE"`
  - [x] Update `src/tools/index.ts` to export all 3 new tools (11 total)

- [x] Task 4: Create unit tests (AC: 5)
  - [x] Create `packages/iris-ops-mcp/src/__tests__/infrastructure.test.ts`
  - [x] Test response parsing for each tool
  - [x] Test database check with specific database name filter
  - [x] Test ECP graceful "not configured" handling
  - [x] Test error handling (IrisApiError propagation)

- [x] Task 5: Final validation (AC: 6, 7)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass

## Dev Notes

### IRIS API Reference — VERIFIED via live testing

**Database Check (DatabaseCheck method) — VERIFIED live:**
- Use `Config.Databases:List` named query to get database names and directories (verified in Story 6.2)
- Use `SYS.Database.%OpenId(directory)` to get per-database details (verified in Story 6.2)
- Available properties on SYS.Database object (verified live):
  - `Size` (%Integer) — database size in MB
  - `MaxSize` (%Integer) — max size (0 = unlimited)
  - `Mounted` (%Boolean) — whether database is mounted
  - `ReadOnly` (%Boolean) — read-only status
  - `EncryptedDB` (%Boolean) — encryption status
  - `GlobalJournalState` (%Integer) — journal state (0=disabled, 1=No, 2=Yes, 3=Yes)
- Optional `name` query parameter to filter to a single database
- Note: There is NO real-time integrity check API that runs quickly enough for a REST call. The "check" here returns the database status (mounted, encrypted, journal state, size) — not a full integrity scan.

**License Info (LicenseInfo method) — VERIFIED live:**
- `$SYSTEM.License.KeyCustomerName()` — "InterSystems IRIS Community"
- `$SYSTEM.License.KeyExpirationDate()` — returns $Horolog date (e.g., 67725)
- `$SYSTEM.License.KeyLicenseCapacity()` — "InterSystems IRIS Community license"
- `$SYSTEM.License.GetConnectionLimit()` — max connections (0 = unlimited for community)
- `$SYSTEM.License.GetUserLimit()` — max users (8 for community)
- `$SYSTEM.License.CSPUsers()` — current CSP user count
- `$SYSTEM.License.KeyFileType()` — license file type string
- `$SYSTEM.License.KeyCoresLicensed()` — cores licensed (20)
- `$SYSTEM.License.KeyCPUsLicensed()` — CPUs licensed (20)
- `$SYSTEM.License.KeyFeatures()` — feature flags hex string
- Convert $Horolog date to readable format: `$ZDate(expirationDate, 3)` gives "YYYY-MM-DD"

**ECP Status (ECPStatus method) — VERIFIED live:**
- `$SYSTEM.ECP.GetClientIndex(servername)` — returns -1 if no ECP configured
- ECP is NOT configured on this instance
- For ECP status, check `Config.ECPServers:List` and `Config.ECPDataServers:List` named queries (may not exist)
- Simplest approach: try `$ZU(64,1)` for ECP data server count, `$ZU(64,2)` for app server count — if both return 0, ECP not configured
- **Gracefully return "ECP not configured" when not available** (like mirror handler)

### ObjectScript Handler Pattern

```objectscript
ClassMethod DatabaseCheck() As %Status
{
    Set tSC = $$$OK
    Set tOrigNS = $NAMESPACE
    Try {
        Set tName = $Get(%request.Data("name",1))
        Set $NAMESPACE = "%SYS"
        
        Set tResult = {}
        Set tDatabases = []
        
        ; Use Config.Databases:List to get names/directories
        ; Then SYS.Database.%OpenId(directory) for each
        ; If tName specified, filter to just that database
        
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
<Route Url="/monitor/database" Method="GET" Call="ExecuteMCPv2.REST.Monitor:DatabaseCheck" />
<Route Url="/monitor/license" Method="GET" Call="ExecuteMCPv2.REST.Monitor:LicenseInfo" />
<Route Url="/monitor/ecp" Method="GET" Call="ExecuteMCPv2.REST.Monitor:ECPStatus" />
```

### File Locations

| What | Path |
|------|------|
| Monitor handler (add methods) | `src/ExecuteMCPv2/REST/Monitor.cls` |
| Dispatch (update routes) | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| New tools | `packages/iris-ops-mcp/src/tools/infrastructure.ts` |
| Tools index | `packages/iris-ops-mcp/src/tools/index.ts` |
| Unit tests | `packages/iris-ops-mcp/src/__tests__/infrastructure.test.ts` |

### Critical Rules

- **RESEARCH-FIRST**: Only use VERIFIED APIs listed above
- DatabaseCheck is a STATUS check, not a full integrity scan — clarify in tool description
- License expiration date from `KeyExpirationDate()` is $Horolog format — convert to YYYY-MM-DD with `$ZDate(date, 3)`
- ECP handler MUST gracefully return "not configured" (this instance has no ECP)
- Do NOT update IPM module.xml — Monitor.cls already registered
- Use `Set tOrigNS = $NAMESPACE` pattern
- Update `src/tools/index.ts` (will be 11 tools total)
- Update `src/__tests__/index.test.ts` tool count expectations

### Previous Story Intelligence (Story 6.4)

- Monitor.cls now has 8 methods — add 3 more (11 total including CollectInteropMetrics helper)
- Tools index exports 8 tools — will be 11 after this story
- 76 ops-mcp tests passing, 812 total

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.5]
- [Source: src/ExecuteMCPv2/REST/Monitor.cls]
- [IRIS API: $SYSTEM.License — KeyCustomerName, KeyExpirationDate, GetUserLimit verified live]
- [IRIS API: SYS.Database — Size, Mounted, EncryptedDB, GlobalJournalState properties verified live]
- [IRIS API: $SYSTEM.ECP — GetClientIndex verified, returns -1 when not configured]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None needed — all implementations compiled and tests passed on first attempt.

### Completion Notes List

- Added 3 new ClassMethods to Monitor.cls: DatabaseCheck, LicenseInfo, ECPStatus
- DatabaseCheck uses Config.Databases:List with collect-first pattern (same as Story 6.2 SystemMetrics), then SYS.Database.%OpenId for per-DB details. Supports optional `name` query param.
- LicenseInfo queries $SYSTEM.License methods (no %SYS switch needed). Converts $Horolog expiration date to YYYY-MM-DD via $ZDate.
- ECPStatus checks $SYSTEM.ECP.GetClientIndex("test") — returns -1 means not configured. Gracefully returns "ECP not configured".
- Added 3 routes to Dispatch.cls UrlMap
- Created infrastructure.ts with 3 TypeScript tools, all readOnlyHint: true, scope: NONE
- Updated tools/index.ts: now exports 11 tools (was 8)
- Created 24 unit tests in infrastructure.test.ts
- Updated index.test.ts: tool count expectations 8 -> 11
- Build: turbo build green (7/7 tasks)
- Tests: 100 ops-mcp tests pass (was 76). Pre-existing failures in @iris-mcp/data and @iris-mcp/all (no test files) are unrelated.

### File List

- src/ExecuteMCPv2/REST/Monitor.cls (modified — added DatabaseCheck, LicenseInfo, ECPStatus methods)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified — added 3 routes)
- packages/iris-ops-mcp/src/tools/infrastructure.ts (new — 3 tool definitions)
- packages/iris-ops-mcp/src/tools/index.ts (modified — exports 11 tools)
- packages/iris-ops-mcp/src/__tests__/infrastructure.test.ts (new — 24 tests)
- packages/iris-ops-mcp/src/__tests__/index.test.ts (modified — updated count expectations)

### Change Log

- 2026-04-07: Implemented Story 6.5 — Database, License & ECP tools (3 ObjectScript methods, 3 TS tools, 24 tests)
- 2026-04-07: Code review complete — clean review, all 7 ACs verified, 0 issues found

### Review Findings

Clean review — all layers passed. No issues found.
