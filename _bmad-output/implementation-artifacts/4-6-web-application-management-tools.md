# Story 4.6: Web Application Management Tools

Status: done

## Story

As an administrator,
I want to create, modify, delete, and list CSP/REST web applications through MCP tools,
So that I can configure web access to IRIS without the Management Portal.

## Acceptance Criteria

1. **AC1**: `iris.webapp.manage` tool supports create/modify/delete actions for web applications (FR55)
2. **AC2**: `iris.webapp.get` tool returns full web application properties (FR56)
3. **AC3**: `iris.webapp.list` tool returns all web applications, optionally filtered by namespace (FR57)
4. **AC4**: `iris.webapp.manage` is annotated as `destructiveHint: true`
5. **AC5**: `iris.webapp.get` and `iris.webapp.list` are annotated as `readOnlyHint: true`
6. **AC6**: `iris.webapp.list` has scope BOTH (accepts optional namespace for filtering)
7. **AC7**: Security.cls is extended with webapp handler methods
8. **AC8**: Dispatch UrlMap is extended with webapp routes
9. **AC9**: Unit tests with mocked HTTP verify parameter validation, response parsing, and error handling
10. **AC10**: `turbo build` and `turbo test` pass

## Tasks / Subtasks

- [x] Task 1: Extend `src/ExecuteMCPv2/REST/Security.cls` with webapp methods (AC: 7)
  - [x] Add `WebAppList()` — lists all web apps via `Security.Applications`, optional namespace filter from query param
  - [x] Add `WebAppGet(pName As %String)` — gets single web app by name
  - [x] Add `WebAppManage()` — reads JSON body, dispatches create/modify/delete via `Security.Applications`
  - [x] Follow existing handler pattern: try/catch, %SYS switch, validate inputs, sanitize errors

- [x] Task 2: Update `src/ExecuteMCPv2/REST/Dispatch.cls` UrlMap (AC: 8)
  - [x] Add `/security/webapp` GET → WebAppList, POST → WebAppManage
  - [x] Add `/security/webapp/:name` GET → WebAppGet (note: webapp names start with `/`, URL-encode the name param)

- [x] Task 3: Compile updated Security.cls and Dispatch.cls on IRIS

- [x] Task 4: Update `packages/shared/src/bootstrap-classes.ts`
  - [x] Update Security.cls and Dispatch.cls content

- [x] Task 5: Create TypeScript tools (AC: 1-6)
  - [x] Create `packages/iris-admin-mcp/src/tools/webapp.ts` with:
    - `iris.webapp.manage` — action: create|modify|delete, params: name, namespace, dispatchClass, authEnabled, description, etc. Scope: SYS, destructiveHint: true
    - `iris.webapp.get` — params: name (required). Scope: SYS, readOnlyHint: true
    - `iris.webapp.list` — params: namespace (optional filter). Scope: BOTH, readOnlyHint: true
  - [x] Wire tools into `packages/iris-admin-mcp/src/tools/index.ts`

- [x] Task 6: Write unit tests (AC: 9)
  - [x] Create `packages/iris-admin-mcp/src/__tests__/webapp.test.ts`
  - [x] Test: CRUD actions, get by name, list with/without namespace filter, error handling, annotations, scope

- [x] Task 7: Build and validate (AC: 10)

### Review Findings

- [x] [Review][Patch] Truthy guards on namespace/dispatchClass/matchRoles/cookiePath in webapp.ts handler prevent clearing fields to empty string on modify -- changed to `!== undefined` checks [packages/iris-admin-mcp/src/tools/webapp.ts] -- FIXED
- [x] [Review][Patch] Module doc comment in index.ts missing webapp mention [packages/iris-admin-mcp/src/tools/index.ts] -- FIXED
- [x] [Review][Defer] DRY violation: duplicated property-mapping in WebAppManage create/modify branches [src/ExecuteMCPv2/REST/Security.cls:916-949] -- deferred, pre-existing pattern

## Dev Notes

### IRIS Security.Applications API

```objectscript
// All require %SYS namespace
Set tSC = ##class(Security.Applications).Create(pName, .tProperties)
Set tSC = ##class(Security.Applications).Modify(pName, .tProperties)
Set tSC = ##class(Security.Applications).Delete(pName)
Set tSC = ##class(Security.Applications).Get(pName, .tProperties)
Set tExists = ##class(Security.Applications).Exists(pName)
// List: no built-in List method — iterate via SQL or global
```

### Security.Applications Key Properties
- `Name` — web app path (e.g., "/api/myapp")
- `NameSpace` — target namespace
- `DispatchClass` — REST dispatch class name
- `AutheEnabled` — authentication method bitmask (32=Password, 64=Kerberos)
- `IsNameSpaceDefault` — 0 or 1
- `Description` — web app description
- `CSPZENEnabled` — enable CSP/ZEN
- `Recurse` — enable subdirectory access
- `MatchRoles` — roles required to access
- `Resource` — resource required for access
- `Enabled` — 0 or 1
- `CookiePath` — cookie path

### Known Limitation: CSP Gateway

Per Epic 3 retro and README "Known Limitations" section: `Security.Applications.Create()` does not notify the CSP gateway. Web apps created programmatically require either:
1. Saving through the Management Portal (SMP)
2. Restarting the CSP gateway

Include this caveat in the tool's response when creating a web app.

### Web App Name Encoding

Web app names start with `/` (e.g., "/csp/user"). When passing as URL parameter, the name must be URL-encoded. The REST handler should decode the parameter.

### Scope Design

- `iris.webapp.manage` — SYS scope (web app config is system-level in %SYS)
- `iris.webapp.get` — SYS scope
- `iris.webapp.list` — BOTH scope (accepts optional namespace filter, but the operation itself queries %SYS)

### Key Files to Reference

| Reference | Path |
|-----------|------|
| Security handler | `src/ExecuteMCPv2/REST/Security.cls` (763 lines, extend here) |
| Dispatch routes | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| Tool pattern | `packages/iris-admin-mcp/src/tools/namespace.ts` |
| Test pattern | `packages/iris-admin-mcp/src/__tests__/namespace.test.ts` |
| Bootstrap | `packages/shared/src/bootstrap-classes.ts` |

### Previous Story Intelligence (Story 4.5)

- Security.cls now has 10 methods across user/role/resource/permission handlers
- 15 admin tools total, 139 admin tests, 482 total tests
- PermissionCheck aggregates permissions from all assigned roles

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.6 lines 1244-1275]
- [Source: src/ExecuteMCPv2/REST/Security.cls — handler pattern]
- [Source: README.md — Known Limitations section for CSP gateway]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Security.cls and Dispatch.cls compiled successfully on IRIS (USER namespace)
- turbo build: 7/7 tasks successful
- turbo test: 162 admin tests passed (23 new webapp tests), 192 dev tests passed, shared tests passed

### Completion Notes List
- Implemented 3 new ObjectScript handler methods in Security.cls: WebAppList, WebAppGet, WebAppManage
- WebAppList uses %SQL.Statement to query Security.Applications with optional namespace filter via query param
- WebAppGet uses Security.Applications.Get() with URL-decoding for webapp names containing '/'
- WebAppManage follows existing CRUD pattern with CSP gateway caveat in create response
- Added 3 webapp routes to Dispatch.cls UrlMap
- Created 3 TypeScript tools (webapp.ts): iris.webapp.manage (SYS, destructive), iris.webapp.get (SYS, readOnly), iris.webapp.list (BOTH, readOnly)
- Created 23 unit tests covering CRUD, get, list, namespace filtering, URL encoding, error handling, annotations, and scope
- Updated bootstrap-classes.ts with new Security.cls and Dispatch.cls content
- Updated index.test.ts tool count from 15 to 18 and added new tool name assertions

### File List
- src/ExecuteMCPv2/REST/Security.cls (modified - added WebAppList, WebAppGet, WebAppManage methods)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified - added 3 webapp routes)
- packages/iris-admin-mcp/src/tools/webapp.ts (new - 3 tool definitions)
- packages/iris-admin-mcp/src/tools/index.ts (modified - wired webapp tools)
- packages/iris-admin-mcp/src/__tests__/webapp.test.ts (new - 23 tests)
- packages/iris-admin-mcp/src/__tests__/index.test.ts (modified - updated tool count to 18, added webapp names)
- packages/shared/src/bootstrap-classes.ts (modified - updated Security.cls and Dispatch.cls content)

### Change Log
- 2026-04-06: Implemented Story 4.6 - Web Application Management Tools (3 IRIS handlers, 3 MCP tools, 23 tests)
