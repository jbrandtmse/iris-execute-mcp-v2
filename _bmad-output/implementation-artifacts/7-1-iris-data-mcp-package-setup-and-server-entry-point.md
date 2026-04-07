# Story 7.1: iris-data-mcp Package Setup & Server Entry Point

Status: done

## Story

As a data engineer,
I want the iris-data-mcp package initialized and connected to the shared infrastructure,
so that I can start registering and using data and analytics tools.

## Acceptance Criteria

1. **AC1**: `packages/iris-data-mcp/package.json` has name `@iris-mcp/data`, version `0.0.1`, `bin` entry, and dependencies on `@iris-mcp/shared` (workspace:*), `@modelcontextprotocol/sdk` ^1.29.0, `zod` ^4.3.6.
2. **AC2**: `src/index.ts` creates an `McpServerBase` instance with `needsCustomRest: true` and connects via `resolveTransport` from `@iris-mcp/shared`.
3. **AC3**: `src/tools/index.ts` exports an empty `ToolDefinition[]` array.
4. **AC4**: `tsconfig.json` extends `../../tsconfig.base.json` with composite mode and project reference to shared (already scaffolded — verify only).
5. **AC5**: The server starts successfully and responds to `tools/list` (returns empty array).
6. **AC6**: `turbo build` builds all packages without errors.
7. **AC7**: Unit tests verify server creation, transport resolution, and tool registration.

## Tasks / Subtasks

- [x] Task 1: Update package.json (AC: 1)
  - [x] Update existing `packages/iris-data-mcp/package.json`
  - [x] Set version to `0.0.1`
  - [x] Add `bin` entry: `"iris-data-mcp": "./dist/index.js"`
  - [x] Add missing dependencies: `@modelcontextprotocol/sdk` ^1.29.0, `zod` ^4.3.6
  - [x] Keep existing `description`: "IRIS Data & Analytics MCP Server"

- [x] Task 2: Verify tsconfig.json (AC: 4)
  - [x] Verify existing `packages/iris-data-mcp/tsconfig.json` is correct (already scaffolded in Epic 1)
  - [x] Must extend `../../tsconfig.base.json`, composite: true, reference `../shared`
  - [x] No changes expected

- [x] Task 3: Create vitest.config.ts
  - [x] Create `packages/iris-data-mcp/vitest.config.ts` matching iris-ops-mcp pattern
  - [x] Node environment, include `src/**/*.test.ts` and `src/__tests__/**/*.test.ts`
  - [x] Exclude integration tests (`*.integration.test.ts`)

- [x] Task 4: Create src/tools/index.ts (AC: 3)
  - [x] Create `packages/iris-data-mcp/src/tools/index.ts`
  - [x] Export empty `ToolDefinition[]` array: `export const tools: ToolDefinition[] = [];`
  - [x] Import `ToolDefinition` from `@iris-mcp/shared`

- [x] Task 5: Replace src/index.ts (AC: 2)
  - [x] Replace placeholder `packages/iris-data-mcp/src/index.ts` with full server entry point
  - [x] Use `createRequire(import.meta.url)` to read package.json version
  - [x] Import `McpServerBase`, `resolveTransport` from `@iris-mcp/shared`
  - [x] Import `tools` from `./tools/index.js`
  - [x] Server name: `"@iris-mcp/data"`
  - [x] Set `needsCustomRest: true`

- [x] Task 6: Create unit tests (AC: 7)
  - [x] Create `packages/iris-data-mcp/src/__tests__/index.test.ts`
  - [x] Test tools array is initially empty
  - [x] Test tools array is a ToolDefinition[] accepted by McpServerBaseOptions
  - [x] Test server creation with correct name and version
  - [x] Test `needsCustomRest` is true
  - [x] Test server exposes underlying MCP SDK server
  - [x] Test server returns empty tool names array
  - [x] Test nonexistent tool lookup returns undefined
  - [x] Test resolveTransport defaults and --transport flag parsing
  - [x] Follow iris-ops-mcp test pattern exactly

- [x] Task 7: Install dependencies and validate (AC: 5, 6)
  - [x] Run `pnpm install` from root to link workspace dependencies
  - [x] Run `turbo build` — must succeed for all packages
  - [x] Run `turbo test` — all tests must pass including new package

## Dev Notes

### Existing Scaffold

The `packages/iris-data-mcp/` directory was scaffolded in Epic 1. Current state:
- `package.json` — exists but missing `bin`, missing `@modelcontextprotocol/sdk` and `zod` deps, version `0.0.0`
- `tsconfig.json` — already correct (extends base, composite, references shared)
- `src/index.ts` — placeholder only (`export {};`), must be replaced

### Package Setup Pattern (replicate iris-ops-mcp exactly)

**package.json changes needed:**
```json
{
  "version": "0.0.1",
  "bin": { "iris-data-mcp": "./dist/index.js" },
  "dependencies": {
    "@iris-mcp/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.3.6"
  }
}
```

**index.ts pattern (from iris-ops-mcp — copy exactly, change name only):**
```typescript
#!/usr/bin/env node
import { createRequire } from "node:module";
import { McpServerBase, resolveTransport } from "@iris-mcp/shared";
import { tools } from "./tools/index.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

const server = new McpServerBase({
  name: "@iris-mcp/data",
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

**vitest.config.ts pattern (from iris-ops-mcp):**
```typescript
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/__tests__/**/*.test.ts"],
    exclude: ["src/**/*.integration.test.ts"],
  },
});
```

### Key Rules

- `needsCustomRest: true` — data tools will use the custom REST service for DocDB/DeepSee API calls
- Import `resolveTransport` from `@iris-mcp/shared` (NOT from a local file)
- Server name must be `"@iris-mcp/data"` to match the package name
- Tools array starts empty; Stories 7.2–7.4 will populate it
- For index.test.ts: tools array starts empty, so test for `tools.length === 0` and `server.toolCount === 0` (unlike iris-ops-mcp which has 16 tools)

### File Locations

| What | Path |
|------|------|
| Package to update | `packages/iris-data-mcp/` |
| Reference package | `packages/iris-ops-mcp/` (most recent, use as template) |
| Shared imports | `packages/shared/src/index.ts` (McpServerBase, resolveTransport, ToolDefinition) |
| MCP config | `.mcp.json` (add iris-data-mcp after story complete — handled by pipeline lead) |

### Testing Standards

- Vitest framework, `*.test.ts` files in `src/__tests__/`
- Test server instantiation, not full MCP protocol
- Follow iris-ops-mcp test patterns but adjust for 0 initial tools
- `turbo build && turbo test` for final validation

### Previous Story Intelligence (Story 7.0)

- bootstrap-classes.ts regenerated with 12 classes — no changes needed for this story
- Shared package exports all needed: McpServerBase, resolveTransport, ToolDefinition
- All 4 existing MCP servers (dev, admin, interop, ops) follow identical patterns
- iris-ops-mcp Story 6.1 is the best reference (most recent package setup)

### References

- [Source: packages/iris-ops-mcp/package.json]
- [Source: packages/iris-ops-mcp/src/index.ts]
- [Source: packages/iris-ops-mcp/src/tools/index.ts]
- [Source: packages/iris-ops-mcp/vitest.config.ts]
- [Source: packages/iris-ops-mcp/src/__tests__/index.test.ts]
- [Source: _bmad-output/implementation-artifacts/6-1-iris-ops-mcp-package-setup-and-server-entry-point.md]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.1]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None needed — all tasks completed without issues.

### Completion Notes List
- Task 1: Updated package.json with version 0.0.1, bin entry, and @modelcontextprotocol/sdk + zod dependencies
- Task 2: Verified tsconfig.json — already correct from Epic 1 scaffold (extends base, composite, references shared)
- Task 3: Created vitest.config.ts matching iris-ops-mcp pattern exactly
- Task 4: Created src/tools/index.ts exporting empty ToolDefinition[] array
- Task 5: Replaced placeholder src/index.ts with full McpServerBase entry point (name: @iris-mcp/data, needsCustomRest: true)
- Task 6: Created 13 unit tests covering tools array, server instantiation, and resolveTransport
- Task 7: pnpm install succeeded, turbo build succeeded (7/7 packages), iris-data-mcp tests pass (13/13). Note: @iris-mcp/all meta-package has pre-existing "no test files" failure unrelated to this story.

### Change Log
- 2026-04-07: Story 7.1 implementation complete — package setup, server entry point, tools index, vitest config, 13 unit tests

### File List
- packages/iris-data-mcp/package.json (modified)
- packages/iris-data-mcp/vitest.config.ts (new)
- packages/iris-data-mcp/src/index.ts (replaced)
- packages/iris-data-mcp/src/tools/index.ts (new)
- packages/iris-data-mcp/src/__tests__/index.test.ts (new)
