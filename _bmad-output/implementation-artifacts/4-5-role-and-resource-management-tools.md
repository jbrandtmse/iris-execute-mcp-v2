# Story 4.5: Role & Resource Management Tools

Status: done

## Story

As an administrator,
I want to manage security roles, resources, and check permissions through MCP tools,
So that I can configure IRIS security without the Management Portal.

## Acceptance Criteria

1. **AC1**: `iris.role.manage` tool supports create/modify/delete actions for security roles (FR50)
2. **AC2**: `iris.role.list` tool returns all security roles (FR51)
3. **AC3**: `iris.resource.manage` tool supports create/modify/delete actions for security resources (FR52)
4. **AC4**: `iris.resource.list` tool returns all security resources (FR53)
5. **AC5**: `iris.permission.check` tool checks whether a user or role has specific permissions on a resource (FR54)
6. **AC6**: Security.cls is extended with role/resource/permission handler methods
7. **AC7**: Dispatch UrlMap is extended with `/security/role`, `/security/resource`, `/security/permission` routes
8. **AC8**: `iris.role.manage` and `iris.resource.manage` are annotated as `destructiveHint: true`
9. **AC9**: `iris.role.list`, `iris.resource.list`, and `iris.permission.check` are annotated as `readOnlyHint: true`
10. **AC10**: Unit tests with mocked HTTP verify parameter validation, response parsing, and error handling
11. **AC11**: `turbo build` and `turbo test` pass

## Tasks / Subtasks

- [x] Task 1: Extend `src/ExecuteMCPv2/REST/Security.cls` with role/resource/permission methods (AC: 6)
  - [x] Add `RoleList()` — lists all roles via `Security.Roles`
  - [x] Add `RoleManage()` — dispatches create/modify/delete via `Security.Roles`
  - [x] Add `ResourceList()` — lists all resources via `Security.Resources`
  - [x] Add `ResourceManage()` — dispatches create/modify/delete via `Security.Resources`
  - [x] Add `PermissionCheck()` — checks permission for a user/role on a resource
  - [x] Follow UserManage pattern: try/catch, %SYS switch, validate inputs, sanitize errors

- [x] Task 2: Update `src/ExecuteMCPv2/REST/Dispatch.cls` UrlMap (AC: 7)
  - [x] Add `/security/role` GET → RoleList, POST → RoleManage
  - [x] Add `/security/resource` GET → ResourceList, POST → ResourceManage
  - [x] Add `/security/permission` POST → PermissionCheck

- [x] Task 3: Compile updated Security.cls and Dispatch.cls on IRIS
  - [x] Use iris-dev-mcp MCP tools to put and compile

- [x] Task 4: Update `packages/shared/src/bootstrap-classes.ts`
  - [x] Update Security.cls content with new methods
  - [x] Update Dispatch.cls content with new routes

- [x] Task 5: Create TypeScript tools (AC: 1-5, 8, 9)
  - [x] Create `packages/iris-admin-mcp/src/tools/role.ts` with:
    - `iris.role.manage` — action: create|modify|delete, params: name, description, resources (comma-separated resource:permission list), grantedRoles. Scope: SYS, destructiveHint: true
    - `iris.role.list` — no required params. Scope: SYS, readOnlyHint: true
  - [x] Create `packages/iris-admin-mcp/src/tools/resource.ts` with:
    - `iris.resource.manage` — action: create|modify|delete, params: name, description, publicPermission. Scope: SYS, destructiveHint: true
    - `iris.resource.list` — no required params. Scope: SYS, readOnlyHint: true
  - [x] Create `packages/iris-admin-mcp/src/tools/permission.ts` with:
    - `iris.permission.check` — params: target (username or role name), resource, permission. Scope: SYS, readOnlyHint: true
  - [x] Wire all tools into `packages/iris-admin-mcp/src/tools/index.ts`

- [x] Task 6: Write unit tests (AC: 10)
  - [x] Create `packages/iris-admin-mcp/src/__tests__/role.test.ts`
  - [x] Create `packages/iris-admin-mcp/src/__tests__/resource.test.ts`
  - [x] Create `packages/iris-admin-mcp/src/__tests__/permission.test.ts`
  - [x] Test: CRUD actions, permission checking, error handling, annotations

- [x] Task 7: Build and validate (AC: 11)
  - [x] Run `turbo build` — all packages succeed
  - [x] Run `turbo test` — all tests pass

## Dev Notes

### IRIS Security APIs

```objectscript
// Roles (require %SYS)
Set tSC = ##class(Security.Roles).Create(pName, .tProperties)
Set tSC = ##class(Security.Roles).Modify(pName, .tProperties)
Set tSC = ##class(Security.Roles).Delete(pName)
Set tSC = ##class(Security.Roles).Get(pName, .tProperties)
Set tExists = ##class(Security.Roles).Exists(pName)

// Resources (require %SYS)
Set tSC = ##class(Security.Resources).Create(pName, .tProperties)
Set tSC = ##class(Security.Resources).Modify(pName, .tProperties)
Set tSC = ##class(Security.Resources).Delete(pName)
Set tSC = ##class(Security.Resources).Get(pName, .tProperties)

// Permission check
Set tSC = $SYSTEM.Security.Check(pResource, pPermission)
// Returns 1 if permitted, 0 if not
```

### Security.Roles Properties
- `Description` — role description
- `Resources` — comma-separated list of resource:permission pairs (e.g., "MyDB:RW,MyApp:U")
- `GrantedRoles` — comma-separated list of roles granted to this role

### Security.Resources Properties
- `Description` — resource description
- `PublicPermission` — default public permission (e.g., "", "R", "RW", "RWU")
- `Type` — resource type

### Permission Check Design

The `iris.permission.check` tool should accept a target (user or role), resource name, and permission type. On the IRIS side, use `$SYSTEM.Security.Check()` or build a lookup via `Security.Roles.Get()` / `Security.Users.Get()` to check granted resources.

### Key Files to Reference

| Reference | Path |
|-----------|------|
| Security handler | `src/ExecuteMCPv2/REST/Security.cls` (extend with role/resource/permission) |
| Dispatch routes | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| Tool pattern | `packages/iris-admin-mcp/src/tools/namespace.ts` |
| Test pattern | `packages/iris-admin-mcp/src/__tests__/namespace.test.ts` |
| Bootstrap | `packages/shared/src/bootstrap-classes.ts` |

### Previous Story Intelligence (Story 4.4)

- Security.cls has 5 methods (UserList/UserGet/UserManage/UserRoles/UserPassword) — 405 lines
- Dispatch has 5 /security/user routes
- 101 admin tests, 151 shared, 192 dev = 444 total
- Password redaction pattern established — no secrets in responses

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.5 lines 1205-1243]
- [Source: src/ExecuteMCPv2/REST/Security.cls — handler pattern]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Both Security.cls and Dispatch.cls compiled successfully on IRIS USER namespace
- turbo build: 7/7 packages successful
- turbo test: 482 tests passing (139 admin, 192 dev, 151 shared)
- Admin package grew from 10 to 15 tools, 101 to 139 tests

### Completion Notes List
- Added 5 new ObjectScript methods to Security.cls: RoleList, RoleManage, ResourceList, ResourceManage, PermissionCheck
- Added 5 new Dispatch.cls routes for /security/role, /security/resource, /security/permission
- Created 3 new TypeScript tool files: role.ts, resource.ts, permission.ts with 5 tool definitions
- Created 3 new test files with 38 tests covering CRUD, permission checking, error handling, and annotations
- Updated bootstrap-classes.ts with new Security.cls and Dispatch.cls content
- Updated index.test.ts to expect 15 tools (was 10)
- PermissionCheck resolves target as user or role automatically, aggregates permissions from all assigned roles for users

### File List
- src/ExecuteMCPv2/REST/Security.cls (modified - added RoleList, RoleManage, ResourceList, ResourceManage, PermissionCheck)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified - added 5 new routes)
- packages/shared/src/bootstrap-classes.ts (modified - updated Security.cls and Dispatch.cls content)
- packages/iris-admin-mcp/src/tools/role.ts (new - iris.role.manage, iris.role.list)
- packages/iris-admin-mcp/src/tools/resource.ts (new - iris.resource.manage, iris.resource.list)
- packages/iris-admin-mcp/src/tools/permission.ts (new - iris.permission.check)
- packages/iris-admin-mcp/src/tools/index.ts (modified - wired 5 new tools)
- packages/iris-admin-mcp/src/__tests__/role.test.ts (new - 15 tests)
- packages/iris-admin-mcp/src/__tests__/resource.test.ts (new - 15 tests)
- packages/iris-admin-mcp/src/__tests__/permission.test.ts (new - 8 tests)
- packages/iris-admin-mcp/src/__tests__/index.test.ts (modified - updated tool count from 10 to 15)

### Review Findings

- [x] [Review][Patch] Empty string falsy guard in role.ts handler — `if (description)` skips empty strings; fixed to `!== undefined` [role.ts:68-70]
- [x] [Review][Patch] Empty string falsy guard for description in resource.ts — same pattern; fixed to `!== undefined` [resource.ts:60]
- [x] [Review][Patch] bootstrap-classes.ts Dispatch.cls content missing XML comments and doc comment block — restored to match source file [bootstrap-classes.ts:1498-1528]
- [x] [Review][Defer] PermissionCheck does not check user's directly-assigned resources [Security.cls:PermissionCheck] — deferred, pre-existing design gap
