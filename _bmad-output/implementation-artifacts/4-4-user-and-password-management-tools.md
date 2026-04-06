# Story 4.4: User & Password Management Tools

Status: done

## Story

As an administrator,
I want to manage user accounts, assign roles, and handle passwords through MCP tools,
So that I can provision user access without the Management Portal.

## Acceptance Criteria

1. **AC1**: `iris.user.manage` tool supports create/modify/delete actions for user accounts (FR46)
2. **AC2**: `iris.user.get` tool returns user properties; with action "list" returns all users (FR47)
3. **AC3**: `iris.user.roles` tool supports add/remove actions for role assignment (FR48)
4. **AC4**: `iris.user.password` tool supports change and validate actions (FR49)
5. **AC5**: `ExecuteMCPv2.REST.Security` handler class is created and compiles on IRIS
6. **AC6**: Dispatch UrlMap is extended with `/security/user` routes
7. **AC7**: Passwords are never included in log output or error messages (NFR6)
8. **AC8**: `iris.user.manage` is annotated as `destructiveHint: true`
9. **AC9**: `iris.user.get` is annotated as `readOnlyHint: true`
10. **AC10**: All tools execute in %SYS scope
11. **AC11**: Unit tests with mocked HTTP verify parameter validation, response parsing, and error handling
12. **AC12**: `turbo build` and `turbo test` pass

## Tasks / Subtasks

- [x] Task 1: Create `src/ExecuteMCPv2/REST/Security.cls` (AC: 5, 7, 10)
  - [x] Extend `%Atelier.REST`
  - [x] Implement `UserList()` — lists all users via `Security.Users` class, returns properties
  - [x] Implement `UserGet()` — gets single user by name via `Security.Users.Get()`
  - [x] Implement `UserManage()` — reads JSON body, dispatches create/modify/delete via `Security.Users`
  - [x] Implement `UserRoles()` — reads JSON body, add/remove roles via `Security.Users.Modify()` updating Roles property
  - [x] Implement `UserPassword()` — reads JSON body, change password via `Security.Users.Modify()` or validate via `$SYSTEM.Security.ValidatePassword()`
  - [x] Follow Config.cls handler pattern: try/catch, `New $NAMESPACE` + `Set $NAMESPACE = "%SYS"`, validate inputs, sanitize errors, RenderResponseBody
  - [x] CRITICAL: Never include password values in error messages or response bodies (only success/failure status)

- [x] Task 2: Update `src/ExecuteMCPv2/REST/Dispatch.cls` UrlMap (AC: 6)
  - [x] Add routes for `/security/user` (GET → UserList, POST → UserManage)
  - [x] Add route for `/security/user/:name` (GET → UserGet)
  - [x] Add route for `/security/user/roles` (POST → UserRoles)
  - [x] Add route for `/security/user/password` (POST → UserPassword)

- [x] Task 3: Compile Security.cls and updated Dispatch.cls on IRIS
  - [x] Use iris-dev-mcp MCP tools to put and compile
  - [x] Verify compilation succeeds

- [x] Task 4: Update `packages/shared/src/bootstrap-classes.ts`
  - [x] Add `ExecuteMCPv2.REST.Security.cls` content to `BOOTSTRAP_CLASSES` map
  - [x] Update `ExecuteMCPv2.REST.Dispatch.cls` content with new routes

- [x] Task 5: Create TypeScript tools (AC: 1-4, 8, 9, 10)
  - [x] Create `packages/iris-admin-mcp/src/tools/user.ts` with:
    - `iris.user.manage` — action: create|modify|delete, params: name, password, fullName, roles, enabled, namespace, etc. Scope: SYS, destructiveHint: true
    - `iris.user.get` — params: name (optional, if omitted lists all). Scope: SYS, readOnlyHint: true
    - `iris.user.roles` — action: add|remove, params: username, role. Scope: SYS, destructiveHint: true
    - `iris.user.password` — action: change|validate, params: username, password. Scope: SYS, destructiveHint: true
  - [x] Wire tools into `packages/iris-admin-mcp/src/tools/index.ts`

- [x] Task 6: Write unit tests (AC: 11)
  - [x] Create `packages/iris-admin-mcp/src/__tests__/user.test.ts`
  - [x] Import test helpers from `@iris-mcp/shared/test-helpers`
  - [x] Test: all CRUD actions, role assignment, password change/validate, error handling, annotations
  - [x] Test: password values are NOT present in response content

- [x] Task 7: Build and validate (AC: 12)
  - [x] Run `turbo build` — all packages succeed
  - [x] Run `turbo test` — all tests pass

## Dev Notes

### IRIS Security.Users API

```objectscript
// All require %SYS namespace
Set tSC = ##class(Security.Users).Create(pName, .tProperties)
Set tSC = ##class(Security.Users).Modify(pName, .tProperties)
Set tSC = ##class(Security.Users).Delete(pName)
Set tSC = ##class(Security.Users).Get(pName, .tProperties)
// List: iterate via SQL or $Order on ^Security("UsersD")

// Password validation
Set tSC = $SYSTEM.Security.ValidatePassword(pPassword)
```

### Security.Users Properties
- `Name` — username
- `FullName` — display name
- `Password` — password (for create, hashed internally)
- `ChangePassword` — new password (for modify)
- `Roles` — comma-separated role list
- `Enabled` — 0 or 1
- `Namespace` — default namespace
- `Routine` — default routine
- `ExpirationDate` — account expiration
- `Comment` — user comment
- `ChangePasswordOnNextLogin` — force password change

### Password Security (NFR6)

- NEVER include password in response JSON
- NEVER include password in error messages
- On create: accept password in request body, pass to Security.Users.Create
- On change: accept new password in request body, pass to Security.Users.Modify with ChangePassword property
- On validate: accept candidate password, call $SYSTEM.Security.ValidatePassword, return pass/fail only

### Role Management Pattern

```objectscript
// Add role: get current roles, append new role, modify
Set tSC = ##class(Security.Users).Get(pUsername, .tProps)
Set tRoles = $Get(tProps("Roles"))
Set tProps("Roles") = tRoles _ "," _ pRole
Set tSC = ##class(Security.Users).Modify(pUsername, .tProps)

// Remove role: get current roles, remove from list, modify
```

### Key Files to Reference

| Reference | Path |
|-----------|------|
| Config handler pattern | `src/ExecuteMCPv2/REST/Config.cls` |
| Dispatch routes | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| Tool pattern | `packages/iris-admin-mcp/src/tools/namespace.ts` |
| Test pattern | `packages/iris-admin-mcp/src/__tests__/namespace.test.ts` |
| Bootstrap | `packages/shared/src/bootstrap-classes.ts` |

### Anti-Patterns to Avoid

- Do NOT echo passwords back in responses or errors
- Do NOT use `$SYSTEM.Security.ChangePassword()` — use `Security.Users.Modify()` with ChangePassword property instead (simpler API, same %SYS context)
- Do NOT create separate Security.cls files for roles/resources — Story 4.5 will extend this handler
- Do NOT forget `Set tSC = $$$OK` after `RenderResponseBody` in error paths

### Previous Story Intelligence (Story 4.3)

- Config.cls now has 6 methods (namespace, database, mapping handlers)
- Dispatch has 8 routes total
- 65 admin unit tests, 151 shared, 192 dev = 408 total
- Dynamic dispatch pattern via `$ClassMethod()` works well for type-parameterized methods

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4 lines 1157-1203]
- [Source: src/ExecuteMCPv2/REST/Config.cls — handler pattern]
- [Source: packages/iris-admin-mcp/src/tools/namespace.ts — tool pattern]

### Review Findings

- [x] [Review][Patch] Boolean property check uses `'= ""` which fails for 0/false values in ObjectScript — fixed with `%IsDefined()` [Security.cls:153,158,171,176 + bootstrap-classes.ts:958,963,976,981]
- [x] [Review][Defer] Password sanitization in UserPassword validate may be incomplete if IRIS reformats password in error text — deferred, pre-existing defense-in-depth pattern
- [x] [Review][Defer] UserRoles does not validate role is non-whitespace — deferred, relies on ValidateRequired implementation
- [x] [Review][Defer] GET /security/user/roles matches :name wildcard route — deferred, cosmetic since sub-resources are POST-only

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
N/A — No debug issues encountered. All classes compiled on first attempt.

### Completion Notes List
- Created Security.cls with 5 methods: UserList, UserGet, UserManage, UserRoles, UserPassword
- All methods follow Config.cls handler pattern: try/catch, New $NAMESPACE, %SYS switch, input validation, error sanitization
- Password values are never included in any response body or error message (NFR6 compliance)
- UserPassword validate action strips password from IRIS validation messages as additional safety
- UserRoles handles duplicate add and missing remove gracefully (returns success with message)
- Updated Dispatch.cls with 5 new routes under /security/user
- Added Security.cls to bootstrap-classes.ts (now 8 classes total)
- Created 4 TypeScript tools with proper annotations: destructiveHint for manage/roles/password, readOnlyHint for get
- 36 new unit tests covering CRUD, roles, password operations, error handling, annotations, and password-not-in-response assertions
- Updated existing index.test.ts (6 -> 10 tools) and bootstrap.test.ts (7 -> 8 classes)
- Total test counts: 101 admin, 151 shared, 192 dev = 444 total

### File List
- `src/ExecuteMCPv2/REST/Security.cls` (new)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified — 5 new routes)
- `packages/shared/src/bootstrap-classes.ts` (modified — Security.cls added, Dispatch routes updated)
- `packages/shared/src/__tests__/bootstrap.test.ts` (modified — count 7->8)
- `packages/iris-admin-mcp/src/tools/user.ts` (new)
- `packages/iris-admin-mcp/src/tools/index.ts` (modified — 4 user tools added)
- `packages/iris-admin-mcp/src/__tests__/user.test.ts` (new)
- `packages/iris-admin-mcp/src/__tests__/index.test.ts` (modified — count 6->10, tool names added)

### Change Log
- 2026-04-06: Implemented Story 4.4 — User & Password Management Tools. Created Security.cls handler, 5 Dispatch routes, 4 TypeScript tools, 36 unit tests. All builds and tests pass.
