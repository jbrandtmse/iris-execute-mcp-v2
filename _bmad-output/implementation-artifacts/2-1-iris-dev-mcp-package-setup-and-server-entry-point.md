# Story 2.1: iris-dev-mcp Package Setup & Server Entry Point

Status: done

## Story

As a developer,
I want the iris-dev-mcp package initialized with its entry point and connected to the shared infrastructure,
So that I can start registering and using development tools.

## Acceptance Criteria

1. **Given** the @iris-mcp/shared package from Epic 1 **When** the iris-dev-mcp package is created **Then** `packages/iris-dev-mcp/` contains `package.json` with name `@iris-mcp/dev` and dependency on `@iris-mcp/shared`
2. **Given** the package **When** `src/index.ts` is implemented **Then** it creates an `McpServerBase` instance and connects the configured transport (stdio or HTTP)
3. **Given** the package **When** `src/tools/index.ts` is created **Then** it exports an empty `ToolDefinition[]` array (ready for tools to be added in Stories 2.2-2.7)
4. **Given** the server **When** started with `node dist/index.js` **Then** it responds to `tools/list` with an empty tool list
5. **Given** the monorepo **When** `turbo build` runs **Then** shared builds first, then iris-dev-mcp without errors
6. **Given** all changes **When** `turbo build && turbo test && turbo lint` runs **Then** all commands succeed with zero errors

## Tasks / Subtasks

- [x] Task 1: Update package.json and tsconfig.json (AC: #1, #5)
  - [x] Verify `packages/iris-dev-mcp/package.json` has name `@iris-mcp/dev`, dependency on `@iris-mcp/shared: "workspace:*"`, and correct build/test/lint scripts
  - [x] Add `@modelcontextprotocol/sdk` dependency (needed for transport types if not inherited from shared)
  - [x] Verify `packages/iris-dev-mcp/tsconfig.json` extends `../../tsconfig.base.json` with project reference to `../shared`
  - [x] Add `bin` field to package.json pointing to `dist/index.js` for CLI execution
- [x] Task 2: Create src/tools/index.ts (AC: #3)
  - [x] Create `packages/iris-dev-mcp/src/tools/index.ts`
  - [x] Export an empty `ToolDefinition[]` array: `export const tools: ToolDefinition[] = [];`
  - [x] Import `ToolDefinition` from `@iris-mcp/shared`
- [x] Task 3: Implement src/index.ts entry point (AC: #2, #4)
  - [x] Import `McpServerBase` and related types from `@iris-mcp/shared`
  - [x] Import `tools` from `./tools/index.js`
  - [x] Read package version from package.json (use `createRequire` or import assertion)
  - [x] Create `McpServerBase` instance with: `name: "@iris-mcp/dev"`, `version: <from package.json>`, `tools: tools`
  - [x] Determine transport from env var or CLI arg (default: "stdio")
  - [x] Call `server.start(transport)` and handle errors with process.exit(1)
  - [x] Add shebang line `#!/usr/bin/env node` for CLI execution
- [x] Task 4: Add unit tests (AC: #4)
  - [x] Create `packages/iris-dev-mcp/src/__tests__/index.test.ts`
  - [x] Test: tools/index.ts exports an empty array
  - [x] Test: McpServerBase can be instantiated with the empty tools array (mock start)
  - [x] Create `packages/iris-dev-mcp/vitest.config.ts` (follow shared package pattern)
- [x] Task 5: Validate (AC: #5, #6)
  - [x] Run `turbo build` — shared builds first, then iris-dev-mcp succeeds
  - [x] Run `turbo test` — all tests pass (existing 119 + 7 new)
  - [x] Run `turbo lint` — no lint errors
  - [x] Verify `node packages/iris-dev-mcp/dist/index.js` starts (will fail without IRIS, but should show connection error, not crash)

### Review Findings

- [x] [Review][Patch] Silent fallback on invalid transport value -- added console.error warning for unrecognised MCP_TRANSPORT env var [packages/iris-dev-mcp/src/index.ts:38-42] -- **FIXED**
- [x] [Review][Defer] No unit tests for resolveTransport() function [packages/iris-dev-mcp/src/index.ts] -- deferred, test coverage improvement for future story
- [x] [Review][Defer] No unit tests for entry point bootstrap flow [packages/iris-dev-mcp/src/index.ts] -- deferred, requires significant mocking infrastructure
- [x] [Review][Defer] Package exports field advertises imports but entry point has no exports [packages/iris-dev-mcp/package.json] -- deferred, pre-existing from skeleton

## Dev Notes

### Key Files to Create/Modify

| File | Action |
|------|--------|
| `packages/iris-dev-mcp/package.json` | Modify — add bin field, verify deps |
| `packages/iris-dev-mcp/tsconfig.json` | Verify — already has shared reference |
| `packages/iris-dev-mcp/src/index.ts` | Rewrite — entry point with McpServerBase |
| `packages/iris-dev-mcp/src/tools/index.ts` | Create — empty tool array export |
| `packages/iris-dev-mcp/src/__tests__/index.test.ts` | Create — unit tests |
| `packages/iris-dev-mcp/vitest.config.ts` | Create — per-package vitest config |

### Architecture Compliance

**Entry Point Pattern (from architecture.md):**
```typescript
#!/usr/bin/env node
import { McpServerBase } from "@iris-mcp/shared";
import { tools } from "./tools/index.js";

const server = new McpServerBase({
  name: "@iris-mcp/dev",
  version: "0.0.0", // or read from package.json
  tools,
});

server.start().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

**McpServerBase Constructor (from packages/shared/src/server-base.ts):**
```typescript
interface McpServerBaseOptions {
  name: string;
  version: string;
  tools: ToolDefinition[];
  config?: IrisConnectionConfig;
}
```

**McpServerBase.start() sequence:**
1. loadConfig() from env vars
2. Create IrisHttpClient
3. checkHealth() — HEAD /api/atelier/
4. negotiateVersion() — GET /api/atelier/
5. Connect transport (stdio default)

**Tool directory structure for future stories:**
```
packages/iris-dev-mcp/src/tools/
  index.ts        ← Story 2.1 (empty array)
  doc.ts          ← Story 2.2-2.3 (9 tools)
  compile.ts      ← Story 2.4 (1 tool)
  intelligence.ts ← Story 2.5 (3 tools)
  format.ts       ← Story 2.6 (2 tools)
  sql.ts          ← Story 2.7 (1 tool)
  server.ts       ← Story 2.7 (2 tools)
  macro.ts        ← Story 2.5 (1 tool)
```

### Existing Package Skeleton

The package skeleton was created in Story 1.1:
- `package.json` already has `@iris-mcp/shared: "workspace:*"` dependency
- `tsconfig.json` already extends base with shared reference
- `src/index.ts` has placeholder `export {}` — needs full rewrite
- No `src/tools/` directory yet
- No vitest config yet

### Previous Story Intelligence

- Story 2.0 fixed outputSchema type, CSRF preflight, and headRequest refactoring — all in shared package
- 118 unit tests currently passing
- Build order: shared → iris-dev-mcp (turbo handles this via dependency graph)
- Per-package vitest.config.ts pattern established in Story 1.2 (see `packages/shared/vitest.config.ts`)

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Story 2.1 lines 503-518]
- [Source: _bmad-output/planning-artifacts/architecture.md — iris-dev-mcp structure]
- [Source: packages/shared/src/server-base.ts — McpServerBase class]
- [Source: packages/shared/src/tool-types.ts — ToolDefinition interface]
- [Source: packages/iris-dev-mcp/package.json — existing skeleton]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None required -- implementation was straightforward with no debugging needed.

### Completion Notes List
- Added `bin` field and `@modelcontextprotocol/sdk` dependency to package.json
- Created `src/tools/index.ts` exporting an empty `ToolDefinition[]` array
- Rewrote `src/index.ts` as a full MCP server entry point using `McpServerBase` from shared
- Entry point reads version from package.json via `createRequire`, resolves transport from CLI args or `MCP_TRANSPORT` env var (default: stdio)
- Created 7 unit tests covering tools export and McpServerBase instantiation with empty tools
- Created `vitest.config.ts` following the shared package pattern
- All 119 shared tests + 7 new iris-dev-mcp tests pass, zero lint errors, turbo build succeeds with correct dependency order
- Entry point runs and shows a clear configuration error when IRIS env vars are missing (graceful failure, not crash)

### Change Log
- 2026-04-05: Story 2.1 implementation complete -- package setup, entry point, tools stub, unit tests

### File List
- packages/iris-dev-mcp/package.json (modified -- added bin field, @modelcontextprotocol/sdk dep)
- packages/iris-dev-mcp/src/index.ts (rewritten -- full MCP server entry point)
- packages/iris-dev-mcp/src/tools/index.ts (created -- empty ToolDefinition[] export)
- packages/iris-dev-mcp/src/__tests__/index.test.ts (created -- 7 unit tests)
- packages/iris-dev-mcp/vitest.config.ts (created -- per-package vitest config)
