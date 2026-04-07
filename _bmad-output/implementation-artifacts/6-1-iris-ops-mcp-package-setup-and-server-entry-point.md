# Story 6.1: iris-ops-mcp Package Setup & Server Entry Point

Status: done

## Story

As an operations engineer,
I want the iris-ops-mcp package initialized and connected to the shared infrastructure,
so that I can start registering and using operations and monitoring tools.

## Acceptance Criteria

1. **AC1**: `packages/iris-ops-mcp/` contains `package.json` with name `@iris-mcp/ops`, version `0.0.1`, and dependency on `@iris-mcp/shared` (workspace:*), `@modelcontextprotocol/sdk` ^1.29.0, `zod` ^4.3.6.
2. **AC2**: `src/index.ts` creates an `McpServerBase` instance with `needsCustomRest: true` and connects via `resolveTransport` from `@iris-mcp/shared`.
3. **AC3**: `src/tools/index.ts` exports an empty `ToolDefinition[]` array.
4. **AC4**: `tsconfig.json` extends `../../tsconfig.base.json` with composite mode and project reference to shared.
5. **AC5**: The server starts successfully and responds to `tools/list` (returns empty array).
6. **AC6**: `turbo build` builds all packages without errors.
7. **AC7**: Unit tests verify server creation, transport resolution, and tool registration.

## Tasks / Subtasks

- [x] Task 1: Update package.json (AC: 1)
  - [x] Update existing `packages/iris-ops-mcp/package.json` to match iris-interop-mcp pattern
  - [x] Set version to `0.0.1`
  - [x] Add `bin` entry: `"iris-ops-mcp": "./dist/index.js"`
  - [x] Add missing dependencies: `@modelcontextprotocol/sdk` ^1.29.0, `zod` ^4.3.6
  - [x] Add `description`: "IRIS Operations & Monitoring MCP Server"

- [x] Task 2: Verify tsconfig.json (AC: 4)
  - [x] Verify existing `packages/iris-ops-mcp/tsconfig.json` is correct (already scaffolded)
  - [x] Must extend `../../tsconfig.base.json`, composite: true, reference `../shared`

- [x] Task 3: Create vitest.config.ts
  - [x] Create `packages/iris-ops-mcp/vitest.config.ts` matching iris-interop-mcp pattern
  - [x] Node environment, include `src/**/*.test.ts` and `src/__tests__/**/*.test.ts`
  - [x] Exclude integration tests (`*.integration.test.ts`)

- [x] Task 4: Create src/tools/index.ts (AC: 3)
  - [x] Create `packages/iris-ops-mcp/src/tools/index.ts`
  - [x] Export empty `ToolDefinition[]` array: `export const tools: ToolDefinition[] = [];`
  - [x] Import `ToolDefinition` from `@iris-mcp/shared`

- [x] Task 5: Replace src/index.ts (AC: 2)
  - [x] Replace placeholder `packages/iris-ops-mcp/src/index.ts` with full server entry point
  - [x] Use `createRequire(import.meta.url)` to read package.json version
  - [x] Import `McpServerBase`, `resolveTransport` from `@iris-mcp/shared`
  - [x] Import `tools` from `./tools/index.js`
  - [x] Create server: `new McpServerBase({ name: "@iris-mcp/ops", version: pkg.version, tools, needsCustomRest: true })`
  - [x] Resolve transport and start: `server.start(resolveTransport())`

- [x] Task 6: Create unit tests (AC: 7)
  - [x] Create `packages/iris-ops-mcp/src/__tests__/index.test.ts`
  - [x] Test tools array is initially empty
  - [x] Test server creation with correct name and version
  - [x] Test `needsCustomRest` is true
  - [x] Test resolveTransport defaults and --transport flag parsing
  - [x] Follow iris-interop-mcp test pattern exactly

- [x] Task 7: Install dependencies and validate (AC: 5, 6)
  - [x] Run `pnpm install` from root to link workspace dependencies
  - [x] Run `turbo build` — must succeed for all packages
  - [x] Run `turbo test` — all tests must pass including new package

## Dev Notes

### Existing Scaffold

The `packages/iris-ops-mcp/` directory was scaffolded in Epic 1. Current state:
- `package.json` — exists but missing `bin`, missing `@modelcontextprotocol/sdk` and `zod` deps, version `0.0.0`
- `tsconfig.json` — already correct (extends base, composite, references shared)
- `src/index.ts` — placeholder only (`export {};`), must be replaced

### Package Setup Pattern (replicate iris-interop-mcp exactly)

**package.json additions needed:**
```json
{
  "version": "0.0.1",
  "bin": { "iris-ops-mcp": "./dist/index.js" },
  "dependencies": {
    "@iris-mcp/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.3.6"
  }
}
```

**index.ts pattern (from iris-interop-mcp):**
```typescript
#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServerBase, resolveTransport } from "@iris-mcp/shared";
import { tools } from "./tools/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const server = new McpServerBase({
  name: "@iris-mcp/ops",
  version: pkg.version,
  tools,
  needsCustomRest: true,
});

const transport = resolveTransport();
server.start(transport).catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
```

**tools/index.ts pattern:**
```typescript
import type { ToolDefinition } from "@iris-mcp/shared";
export const tools: ToolDefinition[] = [];
```

### Key Rules

- `needsCustomRest: true` — ops tools will use the custom REST service for system management API calls
- Import `resolveTransport` from `@iris-mcp/shared` (moved there in Story 5.0), NOT from a local file
- Server name must be `"@iris-mcp/ops"` to match the package name
- Tools array starts empty; Stories 6.2–6.7 will populate it

### File Locations

| What | Path |
|------|------|
| Package to update | `packages/iris-ops-mcp/` |
| Reference package | `packages/iris-interop-mcp/` (most recent, use as template) |
| Shared imports | `packages/shared/src/index.ts` (McpServerBase, resolveTransport, ToolDefinition) |
| MCP config | `.mcp.json` (add iris-ops-mcp after story complete) |

### Testing Standards

- Vitest framework, `*.test.ts` files in `src/__tests__/`
- Test server instantiation, not full MCP protocol
- Follow iris-interop-mcp test patterns exactly
- `turbo build && turbo test` for final validation

### Previous Story Intelligence (Story 6.0)

- bootstrap-classes.ts regenerated with 9 handler classes — no changes needed for this story
- Shared package exports all needed: McpServerBase, resolveTransport, ToolDefinition
- All 3 existing MCP servers (dev, admin, interop) follow identical patterns

### References

- [Source: packages/iris-interop-mcp/package.json]
- [Source: packages/iris-interop-mcp/src/index.ts]
- [Source: packages/iris-interop-mcp/src/tools/index.ts]
- [Source: packages/iris-interop-mcp/tsconfig.json]
- [Source: _bmad-output/implementation-artifacts/5-1-iris-interop-mcp-package-setup-and-server-entry-point.md]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 6.1]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None needed -- all tasks completed cleanly on first attempt.

### Completion Notes List

- Task 1: Updated package.json with version 0.0.1, bin entry, @modelcontextprotocol/sdk and zod deps (description was already present)
- Task 2: Verified tsconfig.json already correct -- extends base, composite true, references shared
- Task 3: Created vitest.config.ts matching iris-interop-mcp pattern exactly
- Task 4: Created src/tools/index.ts exporting empty ToolDefinition[] array
- Task 5: Replaced placeholder src/index.ts with full McpServerBase entry point (needsCustomRest: true)
- Task 6: Created 13 unit tests covering tools array, server instantiation, and resolveTransport
- Task 7: pnpm install, turbo build (7/7 success), turbo test (13/13 new tests pass, 0 regressions across all packages with tests)
- Pre-existing: @iris-mcp/data and @iris-mcp/all fail with "no test files found" (not related to this story)

### Change Log

- 2026-04-07: Story 6.1 implemented -- iris-ops-mcp package setup and server entry point

### File List

- packages/iris-ops-mcp/package.json (modified)
- packages/iris-ops-mcp/vitest.config.ts (new)
- packages/iris-ops-mcp/src/index.ts (replaced)
- packages/iris-ops-mcp/src/tools/index.ts (new)
- packages/iris-ops-mcp/src/__tests__/index.test.ts (new)
