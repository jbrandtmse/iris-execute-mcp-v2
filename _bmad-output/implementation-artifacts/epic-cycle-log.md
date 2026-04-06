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
