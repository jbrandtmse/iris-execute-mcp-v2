# Story 5.5: Credential & Lookup Table Tools

Status: done

## Story

As an integration engineer,
I want to manage Ensemble credentials and lookup tables through MCP tools,
so that I can configure integration settings without the Management Portal.

## Acceptance Criteria

1. **AC1**: `iris.credential.manage` with action "create" stores a new Ensemble credential (FR74).
2. **AC2**: `iris.credential.manage` with action "update" or "delete" updates or removes a credential (FR74).
3. **AC3**: `iris.credential.list` returns stored credentials with IDs and usernames, never passwords (FR75, NFR6).
4. **AC4**: `iris.lookup.manage` with action "set" creates or updates a lookup table entry (FR76).
5. **AC5**: `iris.lookup.manage` with action "get" returns the value for a key (FR76).
6. **AC6**: `iris.lookup.manage` with action "delete" removes a lookup table entry (FR76).
7. **AC7**: `iris.lookup.transfer` with action "export" exports a lookup table in XML format (FR77).
8. **AC8**: `iris.lookup.transfer` with action "import" imports a lookup table from XML (FR77).
9. **AC9**: Credential passwords never appear in list responses or error messages (NFR6).
10. **AC10**: `iris.credential.manage` and `iris.lookup.manage` annotated as `destructiveHint: true`.
11. **AC11**: `iris.credential.list` annotated as `readOnlyHint: true`.
12. **AC12**: New routes added to Dispatch UrlMap and Interop.cls compiles.
13. **AC13**: Unit tests verify parameter validation, response parsing, error handling, and password exclusion.
14. **AC14**: `turbo build` succeeds and all tests pass.

## Tasks / Subtasks

- [x] Task 1: Add ObjectScript methods to Interop.cls (AC: 1-9, 12)
  - [x] Implement `CredentialManage()` class method — create/update/delete credentials
  - [x] Implement `CredentialList()` class method — list credentials WITHOUT passwords
  - [x] Implement `LookupManage()` class method — get/set/delete lookup table entries
  - [x] Implement `LookupTransfer()` class method — export/import lookup tables as XML
  - [x] Add routes to Dispatch.cls:
    - `GET /interop/credential` → `ExecuteMCPv2.REST.Interop:CredentialList`
    - `POST /interop/credential` → `ExecuteMCPv2.REST.Interop:CredentialManage`
    - `POST /interop/lookup` → `ExecuteMCPv2.REST.Interop:LookupManage`
    - `POST /interop/lookup/transfer` → `ExecuteMCPv2.REST.Interop:LookupTransfer`

- [x] Task 2: Create TypeScript tools (AC: 1-11)
  - [x] Create `packages/iris-interop-mcp/src/tools/credential.ts`
  - [x] Implement `credentialManageTool` — create/update/delete, destructiveHint: true, scope: NS
  - [x] Implement `credentialListTool` — readOnlyHint: true, scope: NS
  - [x] Create `packages/iris-interop-mcp/src/tools/lookup.ts`
  - [x] Implement `lookupManageTool` — get/set/delete, destructiveHint: true, scope: NS
  - [x] Implement `lookupTransferTool` — export/import, destructiveHint: true, scope: NS
  - [x] Update `src/tools/index.ts` to export all 4 new tools

- [x] Task 3: Create unit tests (AC: 13)
  - [x] Create `packages/iris-interop-mcp/src/__tests__/credential.test.ts`
  - [x] Create `packages/iris-interop-mcp/src/__tests__/lookup.test.ts`
  - [x] Test credential password exclusion from list responses
  - [x] Test each tool's parameter validation and response parsing
  - [x] Test error handling

- [x] Task 4: Final validation (AC: 14)
  - [x] Run `turbo build` — must succeed
  - [x] Run `turbo test` — all tests pass

## Dev Notes

### ObjectScript IRIS API Reference

**Credentials (Ens.Config.Credentials):**
- Create/Update: `Set tCred = ##class(Ens.Config.Credentials).%New()` or `%OpenId(pID)`
  - Properties: `SystemName` (ID), `Username`, `Password`
  - Save: `Set tSC = tCred.%Save()`
- Delete: `Set tSC = ##class(Ens.Config.Credentials).%DeleteId(pID)`
- List: SQL query `SELECT SystemName, Username FROM Ens_Config.Credentials ORDER BY SystemName`
  - **CRITICAL: Never include Password column in SELECT** (NFR6)
- Check existence: `##class(Ens.Config.Credentials).%ExistsId(pID)`

**Lookup Tables (Ens.Util.LookupTable):**
- Get: `Set tValue = ##class(Ens.Util.LookupTable).%GetValue(pTableName, pKey)`
  - Alternative: `$Get(^Ens.LookupTable(pTableName, pKey))`
- Set: `Set tSC = ##class(Ens.Util.LookupTable).%SetValue(pTableName, pKey, pValue)`
  - Alternative: `Set ^Ens.LookupTable(pTableName, pKey) = pValue`
- Delete: `Kill ^Ens.LookupTable(pTableName, pKey)`
- List tables: Iterate `$Order(^Ens.LookupTable(tTable))` for table names
- Export: `Set tSC = ##class(Ens.Util.LookupTable).%Export(pFileName)` — exports to file
  - Alternative: Build XML manually from global data
- Import: `Set tSC = ##class(Ens.Util.LookupTable).%Import(pFileName)` — imports from file
  - For in-memory XML: Use temp file or stream approach

**CRITICAL: Namespace handling:**
- Ens.Config.Credentials and Ens.Util.LookupTable operate in the TARGET namespace
- Use SwitchNamespace pattern from existing Interop.cls methods
- Validate parameters BEFORE switching namespace

### Security (NFR6)

- Never return password in credential list or error responses
- Never log password values
- Password should only be written, never read back
- Follow the same pattern as iris-admin-mcp password handling (progressive fragment stripping from Story 5.0)

### TypeScript Tool Pattern

Follow existing `packages/iris-interop-mcp/src/tools/production.ts` pattern:
- POST tools: body with action, namespace in body
- GET tools: query params for namespace
- `const BASE_URL = "/api/executemcp/v2"`

### File Locations

| What | Path |
|------|------|
| Interop handler (extend) | `src/ExecuteMCPv2/REST/Interop.cls` |
| Dispatch (add routes) | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| New credential tools | `packages/iris-interop-mcp/src/tools/credential.ts` |
| New lookup tools | `packages/iris-interop-mcp/src/tools/lookup.ts` |
| Tools index (update) | `packages/iris-interop-mcp/src/tools/index.ts` |
| New tests | `packages/iris-interop-mcp/src/__tests__/credential.test.ts`, `lookup.test.ts` |

### Previous Story Intelligence (Story 5.4)

- Interop.cls has 10 methods now, 10 tools in tools/index.ts
- GET endpoints use query params; POST endpoints use JSON body
- Ens.Queue is NOT a SQL table — use named queries or global access
- SQL error checking with `tRS.%SQLCODE < 0` pattern established
- 97 interop tests passing, 672 total

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.5]
- [Source: src/ExecuteMCPv2/REST/Interop.cls]
- [Source: packages/iris-interop-mcp/src/tools/production.ts]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required - all ObjectScript classes compiled successfully on first attempt.

### Completion Notes List

- Implemented 4 new ObjectScript methods in Interop.cls: CredentialManage, CredentialList, LookupManage, LookupTransfer
- All methods follow established namespace switching pattern with tOrigNS save/restore
- CredentialList uses SQL SELECT on SystemName and Username only -- Password column is never queried (NFR6)
- CredentialManage validates parameters before namespace switch; supports create/update/delete
- LookupManage uses direct ^Ens.LookupTable global access for get/set/delete
- LookupTransfer builds XML manually for export; parses XML with string extraction for import
- Created 4 TypeScript tool definitions with proper annotations (destructiveHint/readOnlyHint)
- Created 29 unit tests (14 credential + 15 lookup) covering metadata, parameter passing, error handling, and password exclusion
- Updated index.test.ts counts from 10 to 14 tools with assertions for all 4 new tool names
- Total interop tests: 126 passing; total project tests: 799 passing; no regressions

### Review Findings

- [x] [Review][Patch] Dead `%XML.Reader` code in LookupTransfer import [Interop.cls:1267-1286] -- FIXED: removed dead code, kept only string-based parser
- [x] [Review][Patch] XML import parser assumes key-before-value attribute order [Interop.cls:1297-1306] -- FIXED: extract each entry as fragment, search attributes independently within fragment
- [x] [Review][Patch] LookupManage "set" rejects empty string values via ValidateRequired [Interop.cls:1154] -- FIXED: replaced ValidateRequired with %IsDefined check to allow empty string values
- [x] [Review][Defer] XML import is additive/merge, not full replacement [Interop.cls] -- deferred, design choice
- [x] [Review][Defer] CredentialManage update ignores empty string password/username [Interop.cls] -- deferred, pre-existing pattern

### Change Log

- 2026-04-06: Implemented Story 5.5 - Credential and Lookup Table Tools (4 ObjectScript methods, 4 TypeScript tools, 29 new tests)

### File List

- src/ExecuteMCPv2/REST/Interop.cls (modified - added CredentialManage, CredentialList, LookupManage, LookupTransfer methods)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified - added 4 new routes)
- packages/iris-interop-mcp/src/tools/credential.ts (new - credentialManageTool, credentialListTool)
- packages/iris-interop-mcp/src/tools/lookup.ts (new - lookupManageTool, lookupTransferTool)
- packages/iris-interop-mcp/src/tools/index.ts (modified - exports 14 tools)
- packages/iris-interop-mcp/src/__tests__/credential.test.ts (new - 14 tests)
- packages/iris-interop-mcp/src/__tests__/lookup.test.ts (new - 15 tests)
- packages/iris-interop-mcp/src/__tests__/index.test.ts (modified - updated counts to 14, added new tool assertions)
