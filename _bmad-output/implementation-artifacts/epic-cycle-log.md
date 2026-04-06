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

### Epic 3 Preparation Note
- The research document `_bmad-output/planning-artifacts/research/technical-iris-unittest-framework-setup-2026-04-05.md` documents `^UnitTestRoot` global setup and `/noload/nodelete` qualifiers for `%UnitTest.Manager.RunTest()`. This was NOT needed for Epic 2 (Atelier API only) but MUST be consumed during Epic 3 story creation, specifically Story 3.4 (Unit Test Execution REST Handler & Tool) and the `ExecuteMCPv2.REST.UnitTest` handler.
