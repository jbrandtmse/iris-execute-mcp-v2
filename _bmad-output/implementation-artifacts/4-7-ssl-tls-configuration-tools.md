# Story 4.7: SSL/TLS Configuration Tools

Status: done

## Story

As an administrator,
I want to manage SSL/TLS configurations through MCP tools,
So that I can set up secure communications without the Management Portal.

## Acceptance Criteria

1. **AC1**: `iris.ssl.manage` tool supports create/modify/delete actions for SSL/TLS configurations (FR58)
2. **AC2**: `iris.ssl.list` tool returns all SSL/TLS configurations with details (certificate paths, enabled protocols, verification settings) (FR59)
3. **AC3**: `iris.ssl.manage` is annotated as `destructiveHint: true`
4. **AC4**: `iris.ssl.list` is annotated as `readOnlyHint: true`
5. **AC5**: Security.cls is extended with SSL handler methods (or included in existing handler)
6. **AC6**: Dispatch UrlMap is extended with SSL routes
7. **AC7**: Unit tests with mocked HTTP verify parameter validation, response parsing, and error handling
8. **AC8**: `turbo build` and `turbo test` pass

## Tasks / Subtasks

- [x] Task 1: Extend `src/ExecuteMCPv2/REST/Security.cls` with SSL methods (AC: 5)
  - [x] Add `SSLList()` — lists all SSL configs via `Security.SSLConfigs`
  - [x] Add `SSLManage()` — reads JSON body, dispatches create/modify/delete via `Security.SSLConfigs`
  - [x] Follow existing handler pattern: try/catch, %SYS switch, validate inputs, sanitize errors

- [x] Task 2: Update `src/ExecuteMCPv2/REST/Dispatch.cls` UrlMap (AC: 6)
  - [x] Add `/security/ssl` GET → SSLList, POST → SSLManage

- [x] Task 3: Compile updated Security.cls and Dispatch.cls on IRIS

- [x] Task 4: Update `packages/shared/src/bootstrap-classes.ts`
  - [x] Update Security.cls and Dispatch.cls content

- [x] Task 5: Create TypeScript tools (AC: 1-4)
  - [x] Create `packages/iris-admin-mcp/src/tools/ssl.ts` with:
    - `iris.ssl.manage` — action: create|modify|delete, params: name, certFile, keyFile, caFile, protocols, verifyPeer, etc. Scope: SYS, destructiveHint: true
    - `iris.ssl.list` — no required params. Scope: SYS, readOnlyHint: true
  - [x] Wire tools into `packages/iris-admin-mcp/src/tools/index.ts`

- [x] Task 6: Write unit tests (AC: 7)
  - [x] Create `packages/iris-admin-mcp/src/__tests__/ssl.test.ts`
  - [x] Test: CRUD actions, list response parsing, error handling, annotations

- [x] Task 7: Build and validate (AC: 8)

## Dev Notes

### IRIS Security.SSLConfigs API

```objectscript
// All require %SYS namespace
Set tSC = ##class(Security.SSLConfigs).Create(pName, .tProperties)
Set tSC = ##class(Security.SSLConfigs).Modify(pName, .tProperties)
Set tSC = ##class(Security.SSLConfigs).Delete(pName)
Set tSC = ##class(Security.SSLConfigs).Get(pName, .tProperties)
Set tExists = ##class(Security.SSLConfigs).Exists(pName)
// List: iterate via SQL or use Exists/Get pattern
```

### Security.SSLConfigs Key Properties
- `Name` — configuration name
- `Description` — description
- `CertificateFile` — path to certificate file
- `PrivateKeyFile` — path to private key file
- `CAFile` — path to CA certificate file
- `CAPath` — path to CA certificate directory
- `CipherList` — allowed ciphers
- `Protocols` — enabled TLS protocols bitmask
- `VerifyPeer` — peer verification mode (0=none, 1=require)
- `VerifyDepth` — certificate chain verification depth
- `Type` — 0=client, 1=server
- `Enabled` — 0 or 1

### Handler Pattern

Follow the exact same pattern used for WebAppManage/WebAppList in Story 4.6:
- `SSLList()` — SQL query to list all, return JSON array
- `SSLManage()` — read JSON body, dispatch create/modify/delete

### Key Files to Reference

| Reference | Path |
|-----------|------|
| Security handler | `src/ExecuteMCPv2/REST/Security.cls` (extend here) |
| Dispatch routes | `src/ExecuteMCPv2/REST/Dispatch.cls` |
| Tool pattern | `packages/iris-admin-mcp/src/tools/webapp.ts` (closest pattern) |
| Test pattern | `packages/iris-admin-mcp/src/__tests__/webapp.test.ts` |
| Bootstrap | `packages/shared/src/bootstrap-classes.ts` |

### Previous Story Intelligence (Story 4.6)

- Security.cls now has 13 methods, 18 admin tools total
- 162 admin tests, ~505 total tests
- WebAppList used SQL query pattern for listing — reuse for SSLList

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.7 lines 1277-1299]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Security.cls and Dispatch.cls compiled successfully on IRIS (73ms compilation time)
- %SYS namespace web application had access issues for SQL queries and doc retrieval, but did not block development since classes compile and deploy through USER namespace

### Completion Notes List
- Added SSLList() and SSLManage() methods to Security.cls following the exact WebAppList/WebAppManage pattern
- Added /security/ssl GET and POST routes to Dispatch.cls UrlMap
- Both ObjectScript classes compiled successfully on IRIS
- Created ssl.ts TypeScript tool file with iris.ssl.manage (destructiveHint: true, scope: SYS) and iris.ssl.list (readOnlyHint: true, scope: SYS)
- Wired SSL tools into tools/index.ts (admin tool count: 18 -> 20)
- Created comprehensive ssl.test.ts with 16 tests covering CRUD actions, optional properties, boolean-to-number conversion, error handling, annotations, and scope
- Updated index.test.ts to expect 20 tools and include iris.ssl.manage/iris.ssl.list name assertions
- Updated bootstrap-classes.ts with SSL methods and routes
- All 521 tests pass (178 admin, 192 dev, 151 shared)
- turbo build passes cleanly

### File List
- `src/ExecuteMCPv2/REST/Security.cls` (modified — added SSLList, SSLManage methods)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified — added SSL routes)
- `packages/iris-admin-mcp/src/tools/ssl.ts` (new — SSL tool definitions)
- `packages/iris-admin-mcp/src/tools/index.ts` (modified — wired SSL tools)
- `packages/iris-admin-mcp/src/__tests__/ssl.test.ts` (new — 16 SSL tests)
- `packages/iris-admin-mcp/src/__tests__/index.test.ts` (modified — updated tool count to 20)
- `packages/shared/src/bootstrap-classes.ts` (modified — added SSL methods and routes)

### Review Findings
- [x] [Review][Patch] Add `.max(64)` to `name` Zod schema to enforce documented max length [ssl.ts:33] — fixed
- [x] [Review][Dismiss] Duplicated property-extraction in SSLManage create/modify — matches existing WebAppManage pattern
- [x] [Review][Dismiss] No existence check before CRUD — matches existing pattern, IRIS API handles errors
- [x] [Review][Dismiss] No `iris.ssl.get` tool — not in story scope
- [x] [Review][Dismiss] `protocols` bitmask not range-validated — low risk, IRIS validates
- [x] [Review][Dismiss] No test for name max-length — descriptive constraint only

### Change Log
- 2026-04-06: Implemented Story 4.7 SSL/TLS Configuration Tools — added iris.ssl.manage and iris.ssl.list MCP tools with ObjectScript handlers, routes, tests, and bootstrap updates
- 2026-04-06: Code review complete — 1 patch applied (name max-length), 5 dismissed as noise, 0 deferred
