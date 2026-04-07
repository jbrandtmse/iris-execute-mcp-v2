# Epic Cycle Log

## Epic 1: Shared Infrastructure & Developer Connection

### Story 1.1: Monorepo Scaffold & Package Structure
- **Status:** done
- **Commit:** 89a65cb
- **Files touched:** 37 files (all new except .gitignore modified)
  - Root configs: package.json, pnpm-workspace.yaml, turbo.json, tsconfig.base.json, eslint.config.mjs, .prettierrc, .prettierignore, vitest.config.ts, .env.example
  - Changesets: .changeset/config.json, .changeset/README.md
  - 7 package skeletons: packages/{shared,iris-dev-mcp,iris-admin-mcp,iris-interop-mcp,iris-ops-mcp,iris-data-mcp,iris-mcp-all}/{package.json,tsconfig.json,src/index.ts}
- **Key decisions:**
  - Used ESLint flat config (eslint.config.mjs) for ESLint v9 compatibility
  - Added `composite: true` to all package tsconfigs for project references
  - Changesets in fixed mode — all @iris-mcp/* packages share version
  - Only `console.error` allowed (stdout reserved for MCP protocol)
- **Review findings:**
  - MEDIUM: Added .prettierignore (auto-resolved)
  - LOW: Removed console.warn from ESLint allow list (auto-resolved)
  - LOW: Missing license field in package.json files (deferred to pre-publish)

### Story 1.2: HTTP Client, Configuration & Authentication
- **Status:** done
- **Commit:** 50f31db
- **Files touched:** 16 files
  - New modules: config.ts, errors.ts, logger.ts, http-client.ts
  - Tests: 4 test files (config, errors, logger, http-client) — 37 tests total
  - Modified: shared/package.json (added zod, @types/node), shared/index.ts (barrel exports)
  - Added: shared/vitest.config.ts (per-package vitest config)
- **Key decisions:**
  - Auth helpers inlined in http-client.ts (no separate auth.ts)
  - Native fetch only — no external HTTP libraries
  - Map-based cookie jar (IRIS uses single session cookie)
  - Per-package vitest.config.ts to fix turbo test discovery
- **Review findings:**
  - Code review passed with minor deferred items
  - Deferred: license fields, turbo test config for empty packages

### Story 1.3: Connection Health & Atelier Version Negotiation
- **Status:** done
- **Commit:** cc7cf2e
- **Files touched:** 11 files
  - New modules: health.ts, atelier.ts
  - New tests: health.test.ts (7 tests), atelier.test.ts (13 tests)
  - Modified: http-client.ts (added head() method), index.ts (exports), http-client.test.ts (6 new head tests)
- **Key decisions:**
  - Separate headRequest() engine in IrisHttpClient to avoid JSON parsing on HEAD
  - ping() in health module (not on client), returns boolean, never throws
  - requireMinVersion throws IrisApiError (API capability, not connection issue)
  - Version parsing extracts major from semver, caps at v8, defaults to v1
- **Review findings:**
  - Code review passed, deferred items logged

### Story 1.4: MCP Server Base & Tool Registration Framework
- **Status:** done
- **Commit:** c4ae838
- **Files touched:** 11 files
  - New modules: tool-types.ts, server-base.ts
  - New tests: tool-types.test.ts, server-base.test.ts — 112 total tests
  - Modified: shared/package.json (added @modelcontextprotocol/sdk), shared/index.ts (exports)
- **Key decisions:**
  - Used MCP SDK's McpServer (high-level API) rather than deprecated Server class
  - Zod v4 `.shape` property for passing input schemas to SDK's registerTool
  - Cursor-based pagination via base64-encoded JSON offset (50/page default)
  - stdio transport default, HTTP transport via StreamableHTTPServerTransport
  - Namespace resolution: NS/BOTH use override or config default, SYS always %SYS, NONE empty
- **Review findings:**
  - HIGH/MEDIUM auto-resolved, 4 LOW items deferred

### Story 1.5: Shared Package Integration Tests
- **Status:** done
- **Commit:** 0c453bc
- **Files touched:** 13 files
  - New: 4 integration test files, integration-helpers.ts, integration-setup.ts, vitest.integration.config.ts
  - Modified: vitest.config.ts (exclude integration), package.json (test:integration script)
- **Key decisions:**
  - IRIS availability detection via setupFiles (globalThis.__IRIS_AVAILABLE__) for synchronous describe.skipIf
  - Separate vitest.integration.config.ts keeps integration tests out of turbo test
  - Default credentials: _SYSTEM/SYS for local development
  - Error tests run unconditionally (no IRIS needed)
- **Review findings:**
  - 3 MEDIUM auto-resolved, 1 LOW deferred
- **Test totals:** 112 unit tests + 13 integration tests = 125 total

## Epic 2: IRIS Development Tools — Atelier API (iris-dev-mcp)

### Story 2.0: Epic 1 Deferred Cleanup
- **Status:** done
- **Commit:** d757dfb
- **Files touched:**
  - packages/shared/src/tool-types.ts — outputSchema type changed to ZodObject<any>
  - packages/shared/src/server-base.ts — registerTool passes outputSchema.shape to SDK
  - packages/shared/src/http-client.ts — added ensureCsrfToken(), extracted executeFetch(), refactored request()/headRequest()
  - packages/shared/src/__tests__/server-base.test.ts — 2 new outputSchema tests
  - packages/shared/src/__tests__/http-client.test.ts — 4 new CSRF preflight tests, 3 updated typed-method tests
  - packages/shared/src/__tests__/tool-types.test.ts — updated outputSchema test to use Zod
  - _bmad-output/implementation-artifacts/deferred-work.md — added code review deferred items
- **Key decisions:**
  - Used ZodObject<any> for outputSchema type (mirrors inputSchema pattern)
  - CSRF preflight uses HEAD to /api/atelier/ (lightweight, also establishes session)
  - executeFetch() returns raw Response for callers to handle body/headers
- **Issues resolved:** None required user input
- **Test totals:** 118 unit tests (6 new) + 13 integration tests = 131 total

### Story 2.1: iris-dev-mcp Package Setup & Server Entry Point
- **Status:** done
- **Commit:** b64b4ee
- **Files touched:**
  - packages/iris-dev-mcp/package.json — added bin field, @modelcontextprotocol/sdk dep
  - packages/iris-dev-mcp/src/index.ts — full MCP server entry point
  - packages/iris-dev-mcp/src/tools/index.ts — empty ToolDefinition[] export
  - packages/iris-dev-mcp/src/__tests__/index.test.ts — 7 unit tests
  - packages/iris-dev-mcp/vitest.config.ts — per-package vitest config
- **Key decisions:**
  - createRequire for ESM-safe package.json version reading
  - Transport from CLI args or MCP_TRANSPORT env var, default stdio
  - console.error warning on invalid transport value (review fix)
- **Review findings:** 1 MEDIUM auto-resolved (silent transport fallback), 3 LOW deferred
- **Test totals:** 126 unit tests (119 shared + 7 new) + 13 integration tests = 139 total

### Story 2.2: Document CRUD Tools
- **Status:** done
- **Commit:** fb4d7db
- **Files touched:**
  - packages/iris-dev-mcp/src/tools/doc.ts — 4 tool definitions (get, put, delete, list)
  - packages/iris-dev-mcp/src/tools/index.ts — wired doc tools
  - packages/iris-dev-mcp/src/__tests__/doc.test.ts — 18 unit tests (15 original + 3 review additions)
  - packages/iris-dev-mcp/src/__tests__/index.test.ts — updated for 4-tool array
  - packages/iris-dev-mcp/package.json — added zod dependency
- **Key decisions:**
  - Batch delete uses individual DELETE calls (IrisHttpClient.delete has no body param)
  - URLSearchParams for all query construction (review standardization)
  - Partial-failure handling for batch deletes (review fix)
- **Review findings:** 3 MEDIUM auto-resolved, 3 LOW deferred
- **Test totals:** 145 unit tests (119 shared + 26 dev) + 13 integration tests = 158 total

### Story 2.3: Document Metadata & Modified Tracking
- **Status:** done
- **Commit:** 0c5e475
- **Files touched:**
  - packages/shared/src/http-client.ts — head() returns HeadResponse now
  - packages/shared/src/index.ts — HeadResponse export
  - packages/iris-dev-mcp/src/tools/doc.ts — metadataOnly + modifiedSince params
  - packages/iris-dev-mcp/src/__tests__/doc.test.ts — 7 new tests
- **Key decisions:** HEAD for metadata, /modified/{timestamp} endpoint for modifiedSince
- **Review findings:** 1 MEDIUM auto-resolved (URL encoding), 2 LOW deferred
- **Test totals:** 152 unit tests + 13 integration tests = 165 total

### Story 2.4: Compilation Tools
- **Status:** done
- **Commit:** be5754f
- **Files touched:**
  - packages/iris-dev-mcp/src/tools/compile.ts — iris.doc.compile tool
  - packages/iris-dev-mcp/src/tools/index.ts — wired compile tool
  - packages/iris-dev-mcp/src/__tests__/compile.test.ts — 11 unit tests
  - packages/iris-dev-mcp/src/__tests__/index.test.ts — updated count
- **Key decisions:** Compilation errors return isError: false, async uses async=1 query param
- **Test totals:** 163 unit tests (119 shared + 44 dev) + 13 integration tests = 176 total

### Story 2.5: Code Intelligence Tools
- **Status:** done
- **Commit:** d8feb4f
- **Key decisions:** search is GET not POST (per vscode-objectscript), macro uses parallel Promise.all
- **Test totals:** 184 unit tests (119 shared + 65 dev) + 13 integration tests

### Story 2.6: Document Format & XML Tools
- **Status:** done
- **Commit:** 1d3ff1e
- **Key decisions:** convert reuses doc GET with format param, xml_export uses v7+ action endpoints
- **Test totals:** 199 unit tests (119 shared + 80 dev) + 13 integration tests

### Story 2.7: SQL Execution & Server Info
- **Status:** done
- **Commit:** 4a54a19
- **Key decisions:** maxRows default 1000 with .int().min(1) validation, server.info uses root endpoint
- **Test totals:** 220 unit tests (119 shared + 101 dev) + 13 integration tests

### Story 2.8: iris-dev-mcp Unit & Integration Tests
- **Status:** done
- **Commit:** 157aecb
- **Files touched:**
  - packages/iris-dev-mcp/src/__tests__/tools.integration.test.ts — 19 integration tests
  - packages/iris-dev-mcp/src/__tests__/integration-setup.ts — IRIS availability + version detection
  - packages/iris-dev-mcp/vitest.integration.config.ts — integration config
  - packages/shared/src/atelier.ts — fixed negotiateVersion to read content.api
  - packages/iris-dev-mcp/src/__tests__/doc.test.ts — 5 edge case tests added
  - packages/iris-dev-mcp/src/__tests__/sql.test.ts — 1 edge case test added
- **Key decisions:** Integration setup detects API version for skipIf gating, fixed negotiateVersion bug
- **Test totals:** 226 unit tests (119 shared + 107 dev) + 32 integration tests (13 shared + 19 dev) = 258 total

## Epic 3: Custom REST Service, Auto-Bootstrap & Execution Tools

### Story 3.0: Epic 2 Deferred Cleanup
- **Status:** done
- **Commit:** 2c3b246
- **Files touched:**
  - New: test-helpers.ts, atelier-api-reference.md
  - Modified: 6 test files (shared helpers), doc.ts (pagination), tool-types.ts + server-base.ts + index.ts (ToolContext.paginate), 2 shared test files, deferred-work.md, sprint-status.yaml
- **Key decisions:**
  - Moved PaginateResult to tool-types.ts to avoid circular dependency
  - iris.doc.list now returns `{ items, nextCursor }` paginated structure
  - Fixed 11 pre-existing test-source mismatches from commit 3039025
- **Review findings:** 1 MEDIUM auto-resolved (JSDoc), 3 LOW deferred
- **Test totals:** 235 tests (128 shared + 107 dev)

### Story 3.1: ObjectScript REST Dispatch & Utils Classes
- **Status:** done
- **Commit:** 0b3c517
- **Files touched:**
  - New: Utils.cls, REST/Dispatch.cls, REST/Command.cls (stub), REST/UnitTest.cls (stub), REST/Global.cls (stub), Tests/UtilsTest.cls
- **Key decisions:**
  - Dispatch extends %Atelier.REST for built-in envelope response format
  - Utils provides 8 class methods: SwitchNamespace, RestoreNamespace, ValidateRequired/String/Integer/Boolean, SanitizeError, ReadRequestBody
  - Stub handlers extend %Atelier.REST directly for independent RenderResponseBody access
  - Test methods require `As %Status` return type for DirectTestRunner compatibility
- **Review findings:** 2 HIGH auto-resolved (SanitizeError infinite loop, ReadRequestBody null safety), 1 LOW deferred
- **Test totals:** 17 IRIS unit tests + 235 TypeScript tests

### Story 3.2: Global Operations REST Handler & Tools
- **Status:** done
- **Commit:** 444cf6f
- **Files touched:**
  - Modified: REST/Global.cls (replaced stubs), tools/index.ts, __tests__/index.test.ts
  - New: tools/global.ts (4 tools), global.test.ts (28 tests), Tests/GlobalTest.cls (12 tests)
- **Key decisions:**
  - BuildGlobalRef helper for safe global reference construction with subscript parsing
  - ValidateGlobalName prevents injection via alphanumeric-only validation
  - Custom REST endpoint /api/executemcp/v2/global (not Atelier API)
  - Numeric subscript detection via `tSub = (+tSub)` idiom
- **Review findings:** Auto-resolved and deferred items logged
- **Test totals:** 29 IRIS unit tests + 263 TypeScript tests

### Story 3.3: ObjectScript Execution REST Handler & Tools
- **Status:** done
- **Commit:** b9cb467
- **Files touched:**
  - Modified: REST/Command.cls (replaced stubs), tools/index.ts, __tests__/index.test.ts
  - New: tools/execute.ts (2 tools), execute.test.ts (18 tests), Tests/CommandTest.cls (15 tests)
- **Key decisions:**
  - I/O capture via ##class(%Device).ReDirectIO(1) with label-based redirect tags (wstr/wchr/wnl/wff)
  - %ExecuteMCPOutput process-private variable for output accumulation
  - $ClassMethod() branching for 0-10 args (ObjectScript lacks spread/apply)
  - OREF return values serialized as "<Object:ClassName>" string
- **Review findings:** 2 MEDIUM auto-resolved (mnemonic restore in catch, OREF guard), 1 deferred (ByRef support)
- **Test totals:** 44 IRIS unit tests + 281 TypeScript tests

### Story 3.4: Unit Test Execution REST Handler & Tool
- **Status:** done
- **Commit:** 9aa2b4d
- **Files touched:**
  - Modified: REST/UnitTest.cls (full implementation), execute.ts, index.ts, execute.test.ts, index.test.ts (all done in 3.3)
  - New: Tests/UnitTestTest.cls (8 IRIS unit tests)
- **Key decisions:**
  - Story 3.3 dev agent proactively implemented most of 3.4 (TypeScript tool + tests + UnitTest.cls handler)
  - ^UnitTestRoot guard pattern from research doc, /noload/nodelete qualifiers
  - SQL-based result parsing from %UnitTest_Result tables
  - execute_unit_tests MCP tool hangs on RunTest() — IRIS test execution deferred to 3.7
- **Review findings:** Skipped formal review (code already reviewed as part of 3.3 scope)
- **Test totals:** 52 IRIS unit tests + 291 TypeScript tests

### Story 3.5: Setup Class & IPM Module
- **Status:** done
- **Commit:** (pending)
- **Files touched:**
  - New: Setup.cls, Tests/SetupTest.cls, ipm/module.xml
- **Key decisions:**
  - Configure() switches to %SYS using New $NAMESPACE for Security.Applications access
  - Web app: /api/executemcp, DispatchClass=ExecuteMCPv2.REST.Dispatch, AutheEnabled=64
  - Idempotent: create or update pattern, Uninstall is no-op if missing
  - IPM module references all 10 classes with Invoke of Setup.Configure post-install
- **Review findings:** Skipped formal review (simple class, verified via MCP)
- **Test totals:** 57 IRIS unit tests + 291 TypeScript tests

### Story 3.6: Auto-Bootstrap Flow
- **Status:** done
- **Commit:** (pending)
- **Files touched:**
  - New: bootstrap.ts, bootstrap-classes.ts, bootstrap.test.ts (15 tests)
  - Modified: server-base.ts (needsCustomRest option, bootstrap step 4.5), index.ts (exports), iris-dev-mcp/index.ts (needsCustomRest: true), Setup.cls (SqlProc)
- **Key decisions:**
  - Solved chicken-and-egg: use Atelier SQL to call Setup.Configure() as stored procedure (no custom REST needed)
  - Added [SqlProc] to Configure() and IsConfigured() in Setup.cls
  - Bootstrap is no-throw: errors captured in result.errors[], configure failure is non-fatal
  - needsCustomRest option on McpServerBaseOptions controls whether bootstrap runs
  - 6 production .cls files embedded as string literals in bootstrap-classes.ts
- **Test totals:** 57 IRIS unit tests + 306 TypeScript tests

### Epic 3 Preparation Note
- The research document `_bmad-output/planning-artifacts/research/technical-iris-unittest-framework-setup-2026-04-05.md` documents `^UnitTestRoot` global setup and `/noload/nodelete` qualifiers for `%UnitTest.Manager.RunTest()`. This was NOT needed for Epic 2 (Atelier API only) but MUST be consumed during Epic 3 story creation, specifically Story 3.4 (Unit Test Execution REST Handler & Tool) and the `ExecuteMCPv2.REST.UnitTest` handler.

## Epic 4: IRIS Administration (iris-admin-mcp)

### Story 4.0: Epic 3 Deferred Cleanup
- **Status:** done
- **Commit:** d5bd39e
- **Files touched:**
  - New: `packages/shared/src/zod-helpers.ts`, `packages/shared/src/__tests__/test-helpers.ts`
  - Modified: `packages/shared/src/index.ts`, `packages/shared/package.json`, `packages/iris-dev-mcp/src/tools/zod-helpers.ts`, `packages/iris-dev-mcp/src/__tests__/test-helpers.ts`, `packages/iris-dev-mcp/src/tools/global.ts`, `packages/iris-dev-mcp/src/__tests__/global.test.ts`, `README.md`
- **Key decisions:**
  - `booleanParam` moved to shared via re-export pattern (iris-dev-mcp re-exports from shared for backwards compat)
  - Test helpers moved to shared with subpath export `@iris-mcp/shared/test-helpers`
  - Global list pagination uses `ctx.paginate()` with default 50/page
  - Debug classes already absent from HSCUSTOM — no deletion needed
  - bootstrap-classes.ts already current (retro item dropped after verification)
- **Review findings:** Code review passed, deferred items logged
- **Test totals:** 151 shared + 197 dev = 348 total tests (5 new pagination tests)

### Story 4.1: iris-admin-mcp Package Setup & Server Entry Point
- **Status:** done
- **Commit:** 981dccb
- **Files touched:**
  - Modified: `packages/iris-admin-mcp/package.json`, `packages/iris-admin-mcp/src/index.ts`, `pnpm-lock.yaml`
  - New: `packages/iris-admin-mcp/src/transport.ts`, `packages/iris-admin-mcp/src/tools/index.ts`, `packages/iris-admin-mcp/vitest.config.ts`, `packages/iris-admin-mcp/src/__tests__/index.test.ts`
- **Key decisions:**
  - Extracted `resolveTransport()` into separate `transport.ts` module (improvement over iris-dev-mcp inlined pattern) for clean unit testing
  - `needsCustomRest: true` — admin tools use custom REST service for all operations
  - 14 unit tests covering transport resolution (7) and server creation (7)
- **Review findings:** 0 HIGH, 0 MEDIUM, 2 LOW deferred (resolveTransport duplication, silent invalid CLI transport)
- **Test totals:** 151 shared + 197 dev + 14 admin = 362 total tests

## Epic 5: Interoperability Management (iris-interop-mcp)

### Story 5.0: Epic 4 Deferred Cleanup
- **Status:** done
- **Commit:** 1d9ef78
- **Files touched:** 23 files (20 modified, 2 new, 1 renamed/moved)
  - Shared: logger.ts, http-client.ts, server-base.ts, atelier.ts, tool-types.ts, index.ts, transport.ts (new, moved from admin-mcp)
  - Dev: doc.ts, global.ts, index.ts
  - Admin: index.ts, transport.ts (deleted)
  - ObjectScript: Security.cls, Config.cls
  - Tests: logger.test.ts, http-client.test.ts, server-base.test.ts, atelier.test.ts, transport.test.ts (new), doc.test.ts, index.test.ts
  - Docs: deferred-work.md (scrubbed), 5-0 story file
- **Key decisions:**
  - LOG_LEVEL env var with LogLevel enum (ERROR=0, WARN=1, INFO=2, DEBUG=3)
  - AbortController Set tracking for in-flight request abort on destroy()
  - PermissionCheck now checks user's direct Resources property before role iteration
  - Kill tProps before each loop iteration in MappingList, NamespaceList, DatabaseList
  - Password sanitization uses progressive fragment stripping instead of simple $Replace
  - resolveTransport moved to @iris-mcp/shared, both packages import from there
  - BuildWebAppProps/BuildDatabaseProps helpers extracted to eliminate create/modify duplication
  - atelierPath validates version (positive integer), namespace/action (non-empty)
  - Document name validation rejects path traversal attempts (.. or leading /)
  - deferred-work.md scrubbed: resolved items removed, 14 items closed by this story
- **Live verification:** Security.cls and Config.cls compiled successfully. Mapping list, webapp list, namespace list all return correct JSON. PermissionCheck %All role limitation noted (pre-existing, not a regression).
- **Review findings:** No HIGH or MEDIUM issues found. All changes clean.

### Story 5.1: iris-interop-mcp Package Setup & Server Entry Point
- **Status:** done
- **Commit:** a6484cf
- **Files touched:** 5 files (2 modified, 3 new) + pnpm-lock.yaml
  - Modified: package.json, src/index.ts
  - New: vitest.config.ts, src/tools/index.ts, src/__tests__/index.test.ts
- **Key decisions:**
  - Package skeleton already existed from Story 5.0, updated rather than created from scratch
  - `needsCustomRest: true` — interop tools use custom REST service
  - 12 unit tests covering server creation, transport, tools export
- **Review findings:** No HIGH or MEDIUM issues. Clean implementation.

### Story 5.2: Production Lifecycle Tools
- **Status:** done
- **Commit:** 557d113
- **Files touched:** 6 files (3 new, 3 modified) + story/sprint files
  - New: REST/Interop.cls, tools/production.ts, production.test.ts
  - Modified: REST/Dispatch.cls (4 new routes), tools/index.ts, index.test.ts
- **Key decisions:**
  - Ens.* classes run in target namespace, NOT %SYS (unlike Config/Security)
  - ProductionSummary iterates all namespaces via %SYS with inner try/catch
  - 4 tools: manage (destructive), control (non-destructive), status (readOnly), summary (readOnly, NONE scope)
  - 31 unit tests + 14 existing = 45 total interop tests
- **Live verification:** Summary finds running OptiRAG production. Status returns correct state. Missing-param POSTs return clean errors.
- **Review findings:** No HIGH or MEDIUM issues.

### Story 5.3: Production Item & Auto-Start Tools
- **Status:** done
- **Commit:** e8c7a7e
- **Files touched:** 6 files (2 new, 4 modified)
  - New: tools/item.ts, item.test.ts
  - Modified: REST/Interop.cls (+ItemManage, AutoStart), REST/Dispatch.cls (+2 routes), tools/index.ts, index.test.ts
- **Key decisions:**
  - Auto-start reads `^Ens.AutoStart` global directly (GetAutoStart method doesn't exist)
  - ItemManage "get" uses SQL query on Ens_Config.Item
  - 22 new unit tests, 67 total interop tests
- **Bugs found & fixed:** GetAutoStart() doesn't exist → $Get(^Ens.AutoStart); SQL error handling improved
- **Review findings:** 1 MEDIUM patched (SQL error check), 2 LOW patched, 2 deferred

## Epic 6: Operations & Monitoring (iris-ops-mcp)

### Story 6.0: Epic 5 Deferred Cleanup
- **Status:** done
- **Commit:** 4a59fb3
- **Files touched:**
  - `packages/shared/src/bootstrap-classes.ts` — Regenerated with 9 classes (added Interop.cls)
  - `packages/shared/src/__tests__/bootstrap.test.ts` — Updated tests, added getBootstrapClasses tests
  - `packages/shared/src/index.ts` — Export updates
  - `scripts/gen-bootstrap.mjs` — New generator script
  - `_bmad-output/implementation-artifacts/deferred-work.md` — Scrubbed
- **Key decisions:** Created reusable gen-bootstrap.mjs script for future regeneration; compilation order: Utils, Setup, handlers, Dispatch last
- **Issues resolved:** Pre-existing test gap in bootstrap orchestration test (missing configurePackageMapping mock)
- **Review findings:** 2 LOW deferred (npm script entry, error handling in gen script)

### Story 6.1: iris-ops-mcp Package Setup & Server Entry Point
- **Status:** done
- **Commit:** 012fe9f
- **Files touched:**
  - `packages/iris-ops-mcp/package.json` — Updated: version 0.0.1, bin entry, deps
  - `packages/iris-ops-mcp/vitest.config.ts` — New: test config
  - `packages/iris-ops-mcp/src/index.ts` — Replaced: full McpServerBase entry point
  - `packages/iris-ops-mcp/src/tools/index.ts` — New: empty ToolDefinition[]
  - `packages/iris-ops-mcp/src/__tests__/index.test.ts` — New: 13 unit tests
  - `.mcp.json` — Added iris-ops-mcp server entry
- **Key decisions:** Replicated iris-interop-mcp pattern exactly; tsconfig.json already correct from scaffold
- **Issues resolved:** None — clean implementation
- **Review findings:** Zero findings across all three review layers

### Story 6.2: System Metrics & Alerts Tools
- **Status:** done
- **Commit:** 420a700
- **Files touched:**
  - `src/ExecuteMCPv2/REST/Monitor.cls` — New: SystemMetrics, SystemAlerts, InteropMetrics handlers
  - `src/ExecuteMCPv2/REST/Dispatch.cls` — Added 3 monitor routes
  - `ipm/module.xml` — Added Monitor.CLS resource
  - `packages/iris-ops-mcp/src/tools/metrics.ts` — New: 3 tool definitions
  - `packages/iris-ops-mcp/src/__tests__/metrics.test.ts` — New: 24 unit tests
- **Key decisions:** Used $ZU(190,0/1) for global/routine metrics (190,28/29 don't exist), Config.Databases:List + SYS.Database.%OpenId for DB sizes (SYS.Database SQL table doesn't exist)
- **Bugs found & fixed (Step 2.5):** $ZU(190,28/29) <FUNCTION> error, SYS.Database SQL table not found, databases array empty
- **Review findings:** 1 MEDIUM fixed (cross-namespace ResultSet iteration), 1 LOW fixed (stale descriptions)

### Story 6.3: Jobs & Locks Tools
- **Status:** done
- **Commit:** 919cf18
- **Files touched:**
  - `src/ExecuteMCPv2/REST/Monitor.cls` — Added JobsList, LocksList methods
  - `src/ExecuteMCPv2/REST/Dispatch.cls` — Added /monitor/jobs, /monitor/locks routes
  - `packages/iris-ops-mcp/src/tools/jobs.ts` — New: jobsListTool, locksListTool
  - `packages/iris-ops-mcp/src/__tests__/jobs.test.ts` — New: 16 unit tests
- **Key decisions:** %SYS.ProcessQuery via SQL for jobs, %SYS.LockQuery:List via ResultSet for locks, dual-format Owner parsing
- **Bugs found & fixed (Step 2.5):** Lock Owner field was plain PID not pipe-delimited — added dual-format parsing
- **Review findings:** 0 HIGH/MEDIUM, 2 LOW deferred (start time spec gap, no automated Owner parsing test)

### Story 6.4: Journal, Mirror & Audit Tools
- **Status:** done
- **Commit:** 5eca927
- **Files touched:**
  - `src/ExecuteMCPv2/REST/Monitor.cls` — Added JournalInfo, MirrorStatus, AuditEvents methods
  - `src/ExecuteMCPv2/REST/Dispatch.cls` — Added 3 routes
  - `packages/iris-ops-mcp/src/tools/system.ts` — New: 3 tool definitions
  - `packages/iris-ops-mcp/src/__tests__/system.test.ts` — New: 23 unit tests
- **Key decisions:** Mirror handler gracefully returns "not configured" for non-mirrored instances; audit has maxRows limit (100 default, 1000 max)
- **Bugs found & fixed (Step 2.5):** freeSpaceMB field renamed to freeSpaceBytes (GetFreeSpace returns bytes not MB), TS tool converts to GB for display
- **Review findings:** Clean — zero findings across all three layers

### Story 6.5: Database, License & ECP Tools
- **Status:** done
- **Commit:** fc72118
- **Files touched:**
  - `src/ExecuteMCPv2/REST/Monitor.cls` — Added DatabaseCheck, LicenseInfo, ECPStatus methods
  - `src/ExecuteMCPv2/REST/Dispatch.cls` — Added 3 routes
  - `packages/iris-ops-mcp/src/tools/infrastructure.ts` — New: 3 tool definitions
  - `packages/iris-ops-mcp/src/__tests__/infrastructure.test.ts` — New: 24 unit tests
- **Key decisions:** LicenseInfo doesn't need %SYS switch ($SYSTEM.License works anywhere); ECP gracefully returns "not configured"; database name filter supported
- **Bugs found & fixed (Step 2.5):** None — all endpoints worked correctly on first test
- **Review findings:** Clean — zero findings

### Story 6.6: Task Scheduling Tools
- **Status:** done
- **Commit:** f0b1d0f
- **Files touched:**
  - `src/ExecuteMCPv2/REST/Task.cls` — New handler: TaskList, TaskManage, TaskRun, TaskHistory
  - `src/ExecuteMCPv2/REST/Dispatch.cls` — Added 4 task routes
  - `ipm/module.xml` — Added Task.cls resource
  - `packages/iris-ops-mcp/src/tools/task.ts` — New: 4 tool definitions
  - `packages/iris-ops-mcp/src/__tests__/task.test.ts` — New: 33 unit tests
- **Key decisions:** New Task.cls handler class; RunNow is async; task ID accepts string or number
- **Bugs found & fixed (Step 2.5):** None
- **Review findings:** 2 LOW deferred

### Story 6.7: System Configuration Tools
- **Status:** done
- **Commit:** 45854d3
- **Files touched:**
  - `src/ExecuteMCPv2/REST/SystemConfig.cls` — New handler: ConfigManage, GetConfig, SetConfig, ExportConfig
  - `src/ExecuteMCPv2/REST/Dispatch.cls` — Added /system/config route
  - `ipm/module.xml` — Added SystemConfig.cls resource
  - `packages/iris-ops-mcp/src/tools/config.ts` — New: configManageTool
  - `packages/iris-ops-mcp/src/__tests__/config.test.ts` — New: 16 unit tests
- **Key decisions:** Config.config.Open() returns CPF path not %Status; locale section lists available locales via NLS.Locales:List
- **Bugs found & fixed (Step 2.5):** Config.config.Open() status check (CPF path not %Status), Config.NLS.Locales.Get("current") doesn't exist
- **Review findings:** 4 LOW deferred (dynamic annotations, hardcoded property list, no whitelist, export scope)

### Story 6.8: iris-ops-mcp Unit & Integration Tests
- **Status:** done
- **Commit:** 300d2bd
- **Files touched:**
  - `packages/iris-ops-mcp/src/__tests__/integration-setup.ts` — New: IRIS probe setup
  - `packages/iris-ops-mcp/src/__tests__/ops.integration.test.ts` — New: 18 integration tests
  - `packages/iris-ops-mcp/vitest.integration.config.ts` — New: integration config
- **Key decisions:** Probe uses /monitor/system endpoint; task lifecycle uses suspended %SYS.Task.PurgeTaskHistory; config tests read-only
- **Integration test results:** 18/18 passing (12 read-only + 2 config + 4 task lifecycle)
- **Review findings:** Clean — zero findings

## Epic 7: Data & Analytics (iris-data-mcp)

### Story 7.0: Epic 6 Deferred Cleanup
- **Status:** done
- **Commit:** fd8f6a5
- **Files touched:**
  - `scripts/gen-bootstrap.mjs` — Added Monitor.cls, Task.cls, SystemConfig.cls entries
  - `packages/shared/src/bootstrap-classes.ts` — Regenerated: 9→12 classes
  - `packages/shared/src/__tests__/bootstrap.test.ts` — Updated count, added 3 presence tests
  - `_bmad-output/implementation-artifacts/deferred-work.md` — Closed 26 items, kept 14
- **Key decisions:** Used gen-bootstrap.mjs generator (not manual edit); placed new classes before Dispatch in compilation order; formally closed all Epic 1-4 deferred items as won't-fix
- **Review findings:** Clean — zero findings

### Story 7.1: iris-data-mcp Package Setup & Server Entry Point
- **Status:** done
- **Commit:** 7ef8637
- **Files touched:**
  - `packages/iris-data-mcp/package.json` — Updated: version 0.0.1, bin entry, deps
  - `packages/iris-data-mcp/vitest.config.ts` — New: test config
  - `packages/iris-data-mcp/src/index.ts` — Replaced: full McpServerBase entry point
  - `packages/iris-data-mcp/src/tools/index.ts` — New: empty ToolDefinition[]
  - `packages/iris-data-mcp/src/__tests__/index.test.ts` — New: 13 unit tests
  - `.mcp.json` — Added iris-data-mcp server entry
- **Key decisions:** Replicated iris-ops-mcp pattern exactly; tsconfig.json already correct from scaffold; needsCustomRest: true for DocDB/DeepSee APIs
- **Review findings:** Clean — zero findings

### Story 7.2: Document Database Tools
- **Status:** done
- **Commit:** 03f21af
- **Files touched:**
  - `packages/iris-data-mcp/src/tools/docdb.ts` — New: 4 DocDB tools (manage, document, find, property)
  - `packages/iris-data-mcp/src/tools/index.ts` — Wired 4 tools
  - `packages/iris-data-mcp/src/__tests__/docdb.test.ts` — New: 47 unit tests
  - `packages/iris-data-mcp/src/__tests__/index.test.ts` — Updated tool count to 4
- **Key decisions:** Used IRIS built-in DocDB REST API (`/api/docdb/v1/`) instead of custom REST handler; extractResult() helper for Atelier/plain JSON response handling; namespace in URL path
- **Review findings:** 2 MEDIUM auto-resolved (added .min(1) to ID/database/property Zod strings to prevent empty string URL collisions)
