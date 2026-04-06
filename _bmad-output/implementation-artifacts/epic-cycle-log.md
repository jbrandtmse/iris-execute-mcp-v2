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
