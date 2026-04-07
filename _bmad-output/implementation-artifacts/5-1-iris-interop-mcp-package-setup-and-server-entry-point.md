# Story 5.1: iris-interop-mcp Package Setup & Server Entry Point

Status: done

## Story

As an integration engineer,
I want the iris-interop-mcp package initialized and connected to the shared infrastructure,
so that I can start registering and using interoperability tools.

## Acceptance Criteria

1. **AC1**: `packages/iris-interop-mcp/` contains `package.json` with name `@iris-mcp/interop` and dependency on `@iris-mcp/shared` (workspace:*).
2. **AC2**: `src/index.ts` creates an `McpServerBase` instance with `needsCustomRest: true` and connects via `resolveTransport` from `@iris-mcp/shared`.
3. **AC3**: `src/tools/index.ts` exports an empty `ToolDefinition[]` array.
4. **AC4**: `tsconfig.json` extends `../../tsconfig.base.json` with composite mode and project reference to shared.
5. **AC5**: The server starts successfully and responds to `tools/list` (returns empty array).
6. **AC6**: `turbo build` builds all packages without errors.
7. **AC7**: Unit tests verify server creation, transport resolution, and tool registration.

## Tasks / Subtasks

- [x] Task 1: Create package.json (AC: 1)
  - [x] Create `packages/iris-interop-mcp/package.json` following iris-admin-mcp pattern exactly
  - [x] Name: `@iris-mcp/interop`, version: `0.0.1`
  - [x] Dependencies: `@iris-mcp/shared` (workspace:*), `@modelcontextprotocol/sdk` ^1.29.0, `zod` ^4.3.6
  - [x] Scripts: build (tsc), test (vitest run), lint, type-check
  - [x] Bin entry: `iris-interop-mcp` pointing to `dist/index.js`
  - [x] Exports: `./dist/index.js` for import/types/main

- [x] Task 2: Create tsconfig.json (AC: 4)
  - [x] Create `packages/iris-interop-mcp/tsconfig.json`
  - [x] Extend `../../tsconfig.base.json`, composite: true
  - [x] Project reference to `../shared`
  - [x] outDir: `./dist`, rootDir: `./src`

- [x] Task 3: Create vitest.config.ts
  - [x] Create `packages/iris-interop-mcp/vitest.config.ts`
  - [x] Node environment, include `src/**/*.test.ts` and `src/__tests__/**/*.test.ts`
  - [x] Exclude integration tests (`*.integration.test.ts`)

- [x] Task 4: Create src/tools/index.ts (AC: 3)
  - [x] Create `packages/iris-interop-mcp/src/tools/index.ts`
  - [x] Export empty `ToolDefinition[]` array: `export const tools: ToolDefinition[] = [];`
  - [x] Import `ToolDefinition` from `@iris-mcp/shared`

- [x] Task 5: Create src/index.ts (AC: 2)
  - [x] Create `packages/iris-interop-mcp/src/index.ts`
  - [x] Use `createRequire(import.meta.url)` to read package.json for name/version
  - [x] Import `McpServerBase`, `resolveTransport` from `@iris-mcp/shared`
  - [x] Import `tools` from `./tools/index.js`
  - [x] Create server: `new McpServerBase({ name, version, tools, needsCustomRest: true })`
  - [x] Resolve transport and start: `server.start(resolveTransport())`

- [x] Task 6: Create unit tests (AC: 7)
  - [x] Create `packages/iris-interop-mcp/src/__tests__/index.test.ts`
  - [x] Test server creation with correct name and version
  - [x] Test tools array is initially empty
  - [x] Test `needsCustomRest` is true
  - [x] Follow iris-admin-mcp test pattern

- [x] Task 7: Install dependencies and validate (AC: 5, 6)
  - [x] Run `pnpm install` from root to link workspace dependencies
  - [x] Run `turbo build` — must succeed for all packages
  - [x] Run `turbo test` — all tests must pass including new package

## Dev Notes

### Package Setup Pattern (from iris-admin-mcp — replicate exactly)

**package.json structure:**
```json
{
  "name": "@iris-mcp/interop",
  "version": "0.0.1",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "bin": { "iris-interop-mcp": "./dist/index.js" },
  "exports": {
    ".": { "import": "./dist/index.js", "types": "./dist/index.d.ts" }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "lint": "eslint src/",
    "type-check": "tsc --noEmit"
  },
  "dependencies": {
    "@iris-mcp/shared": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "zod": "^4.3.6"
  }
}
```

**index.ts pattern:**
```typescript
import { createRequire } from 'node:module';
import { McpServerBase, resolveTransport } from '@iris-mcp/shared';
import { tools } from './tools/index.js';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

const server = new McpServerBase({
  name: pkg.name,
  version: pkg.version,
  tools,
  needsCustomRest: true,
});

server.start(resolveTransport()).catch((err) => {
  console.error('Failed to start iris-interop-mcp:', err);
  process.exit(1);
});
```

### Key Differences from iris-admin-mcp

- **None architecturally** — this is the same pattern, different domain name
- `needsCustomRest: true` — interop tools will use the custom REST service for Ensemble/Interoperability API calls
- Tools array starts empty; Stories 5.2–5.6 will populate it

### File Locations

| What | Path |
|------|------|
| Reference package.json | `packages/iris-admin-mcp/package.json` |
| Reference index.ts | `packages/iris-admin-mcp/src/index.ts` |
| Reference tools/index.ts | `packages/iris-admin-mcp/src/tools/index.ts` |
| Reference tsconfig.json | `packages/iris-admin-mcp/tsconfig.json` |
| Reference vitest.config.ts | `packages/iris-admin-mcp/vitest.config.ts` |
| Shared imports | `packages/shared/src/index.ts` (McpServerBase, resolveTransport, ToolDefinition) |

### Testing Standards

- Vitest framework, `*.test.ts` files
- Use shared test helpers from `@iris-mcp/shared/test-helpers` if needed
- Test server instantiation, not full MCP protocol (that's integration testing)
- `turbo build && turbo test` for final validation

### Previous Story Intelligence (Story 5.0)

- `resolveTransport` now in `@iris-mcp/shared` (moved in Story 5.0) — import from there, NOT from a local transport.ts
- All shared exports available via `@iris-mcp/shared` barrel: McpServerBase, resolveTransport, ToolDefinition, LogLevel, etc.

### References

- [Source: packages/iris-admin-mcp/package.json]
- [Source: packages/iris-admin-mcp/src/index.ts]
- [Source: packages/iris-admin-mcp/src/tools/index.ts]
- [Source: packages/iris-admin-mcp/tsconfig.json]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 5.1]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None required -- implementation was straightforward.

### Completion Notes List

- Updated existing skeleton `package.json` to add bin entry, version 0.0.1, and missing dependencies (@modelcontextprotocol/sdk, zod)
- tsconfig.json was already correct from Story 5.0 skeleton -- no changes needed
- Created `vitest.config.ts` matching iris-admin-mcp pattern
- Created `src/tools/index.ts` exporting empty `ToolDefinition[]` array
- Replaced placeholder `src/index.ts` with full McpServerBase entry point using `needsCustomRest: true`
- Created 12 unit tests covering tools export, server instantiation, needsCustomRest, tool lookup, and resolveTransport
- `turbo build` succeeds for all 7 packages
- All 12 new tests pass; no regressions in other packages
- Pre-existing issue: `@iris-mcp/all` has no test files and its `vitest run` exits with code 1 (not caused by this story)

### File List

- packages/iris-interop-mcp/package.json (modified -- added bin, version, dependencies)
- packages/iris-interop-mcp/vitest.config.ts (new)
- packages/iris-interop-mcp/src/tools/index.ts (new)
- packages/iris-interop-mcp/src/index.ts (modified -- replaced placeholder with server entry point)
- packages/iris-interop-mcp/src/__tests__/index.test.ts (new)

### Review Findings

- [x] [Review][Patch] Missing `--transport http` (space-separated) test case for parity with iris-admin-mcp [src/__tests__/index.test.ts] -- FIXED: added test, now 13 tests pass

### Change Log

- 2026-04-06: Story 5.1 implemented -- iris-interop-mcp package setup with server entry point, empty tools array, and 12 unit tests
- 2026-04-06: Code review complete -- 1 LOW patch applied (added missing transport test case), 3 dismissed as noise, 0 deferred
