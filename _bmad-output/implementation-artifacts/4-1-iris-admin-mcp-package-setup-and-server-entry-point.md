# Story 4.1: iris-admin-mcp Package Setup & Server Entry Point

Status: done

## Story

As an administrator,
I want the iris-admin-mcp package initialized and connected to the shared infrastructure,
So that I can start registering and using administration tools.

## Acceptance Criteria

1. **AC1**: `packages/iris-admin-mcp/` contains `package.json` with name `@iris-mcp/admin` and dependency on `@iris-mcp/shared`
2. **AC2**: `src/index.ts` creates an `McpServerBase` instance with `needsCustomRest: true` and connects the configured transport (stdio or HTTP)
3. **AC3**: `src/tools/index.ts` exports an empty `ToolDefinition[]` array (ready for tools to be added in Stories 4.2–4.8)
4. **AC4**: `tsconfig.json` extends the base config with project reference to shared
5. **AC5**: The server starts successfully and responds to `tools/list` with an empty tool list
6. **AC6**: `turbo build` builds all packages without errors
7. **AC7**: Unit tests exist for the entry point (transport resolution, server creation)

## Tasks / Subtasks

- [x] Task 1: Update `packages/iris-admin-mcp/package.json` (AC: 1)
  - [x] Set name to `@iris-mcp/admin`
  - [x] Add `bin` field: `"iris-admin-mcp": "./dist/index.js"`
  - [x] Add dependencies: `@iris-mcp/shared` (workspace:*), `@modelcontextprotocol/sdk` ^1.29.0, `zod` ^4.3.6
  - [x] Add scripts: build (tsc), test (vitest run), lint (eslint)
  - [x] Set `type: "module"`, add exports field

- [x] Task 2: Update `packages/iris-admin-mcp/tsconfig.json` (AC: 4)
  - [x] Extend `../../tsconfig.base.json`
  - [x] Set `composite: true`, `outDir: "dist"`, `rootDir: "src"`
  - [x] Add project reference to `../shared`

- [x] Task 3: Create `packages/iris-admin-mcp/src/tools/index.ts` (AC: 3)
  - [x] Export `tools: ToolDefinition[]` as empty array
  - [x] Import `ToolDefinition` from `@iris-mcp/shared`

- [x] Task 4: Implement `packages/iris-admin-mcp/src/index.ts` (AC: 2, 5)
  - [x] Follow the iris-dev-mcp pattern exactly:
    - `createRequire` for reading package.json version
    - `resolveTransport()` from CLI args / `MCP_TRANSPORT` env var / default stdio
    - Create `McpServerBase` with `name: "@iris-mcp/admin"`, `version`, `tools`, `needsCustomRest: true`
    - Call `server.start(transport)`
  - [x] `needsCustomRest: true` is CRITICAL — admin tools use the custom REST service, not just Atelier API

- [x] Task 5: Create `packages/iris-admin-mcp/vitest.config.ts`
  - [x] Per-package vitest config (same pattern as iris-dev-mcp)

- [x] Task 6: Write unit tests `packages/iris-admin-mcp/src/__tests__/index.test.ts` (AC: 7)
  - [x] Test resolveTransport() with CLI args, env var, and default
  - [x] Test tool array is empty
  - [x] Follow iris-dev-mcp/__tests__/index.test.ts pattern

- [x] Task 7: Build and validate (AC: 6)
  - [x] Run `turbo build` — all packages must succeed
  - [x] Run `turbo test` — all tests must pass

### Review Findings

- [x] [Review][Defer] resolveTransport() duplicated across iris-dev-mcp and iris-admin-mcp [transport.ts] -- deferred, pre-existing pattern
- [x] [Review][Defer] Invalid CLI --transport values silently ignored without warning [transport.ts] -- deferred, pre-existing pattern from iris-dev-mcp

## Dev Notes

### Pattern to Follow

Mirror `packages/iris-dev-mcp/` exactly. The iris-admin-mcp entry point is structurally identical to iris-dev-mcp, with two differences:
1. Server name: `@iris-mcp/admin` (not `@iris-mcp/dev`)
2. `needsCustomRest: true` — admin tools rely on the custom REST service for all operations (Security.*, Config.* IRIS class access)

### Key Files to Reference

| Reference | Path |
|-----------|------|
| Entry point pattern | `packages/iris-dev-mcp/src/index.ts` |
| Package.json pattern | `packages/iris-dev-mcp/package.json` |
| tsconfig pattern | `packages/iris-dev-mcp/tsconfig.json` |
| Tools barrel pattern | `packages/iris-dev-mcp/src/tools/index.ts` |
| Unit test pattern | `packages/iris-dev-mcp/src/__tests__/index.test.ts` |
| vitest config | `packages/iris-dev-mcp/vitest.config.ts` |
| Current scaffold | `packages/iris-admin-mcp/src/index.ts` (empty placeholder) |

### Architecture Context — Epic 4 Overview

- **9 stories** covering namespaces, databases, mappings, users, roles, resources, web apps, SSL, OAuth2
- All admin tools call the **custom REST service** at `/api/executemcp/v2/config/*` and `/api/executemcp/v2/security/*`
- New REST handler classes needed in Stories 4.2–4.8: `Config.cls`, `Security.cls`, `WebApp.cls`, `SSL.cls`, `OAuth.cls`
- Most tools have **SYS scope** (execute in %SYS namespace)
- Tools follow manage/list/get pattern with `action` parameter for CRUD

### Anti-Patterns to Avoid

- Do NOT add any tools yet — tools come in Stories 4.2–4.8
- Do NOT create ObjectScript classes yet — those come with the tools
- Do NOT add test infrastructure for integration tests — that's Story 4.9
- Do NOT duplicate resolveTransport logic — copy the exact pattern from iris-dev-mcp

### Previous Story Intelligence (Story 4.0)

- `booleanParam` is now in `@iris-mcp/shared` — available for import when tools are added
- Test helpers (`createMockHttp`, `createMockCtx`, `envelope`) are in `@iris-mcp/shared/test-helpers`
- 348 total tests (151 shared + 197 dev) — establish baseline before adding admin tests

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.1 lines 1072-1087]
- [Source: packages/iris-dev-mcp/src/index.ts]
- [Source: packages/iris-dev-mcp/package.json]
- [Source: packages/iris-admin-mcp/src/index.ts (current empty placeholder)]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None required — straightforward scaffold story.

### Completion Notes List
- Mirrored iris-dev-mcp entry point pattern with server name `@iris-mcp/admin` and `needsCustomRest: true`
- Extracted `resolveTransport()` into a separate `transport.ts` module to enable clean unit testing without triggering side-effect server startup
- 14 unit tests covering: tools array (3 tests), McpServerBase instantiation (4 tests), resolveTransport (7 tests covering CLI args, env var, defaults, precedence, and invalid values)
- `turbo build` passes all 7 packages; `turbo test` passes all packages with tests (ops-mcp has pre-existing "no test files" failure unrelated to this story)

### Change Log
- 2026-04-06: Story 4.1 implemented — iris-admin-mcp package setup and server entry point

### File List
- packages/iris-admin-mcp/package.json (modified — added bin, dependencies, scripts)
- packages/iris-admin-mcp/tsconfig.json (unchanged — already had correct config)
- packages/iris-admin-mcp/src/index.ts (modified — full entry point implementation)
- packages/iris-admin-mcp/src/transport.ts (new — resolveTransport function)
- packages/iris-admin-mcp/src/tools/index.ts (new — empty ToolDefinition[] export)
- packages/iris-admin-mcp/vitest.config.ts (new — per-package vitest config)
- packages/iris-admin-mcp/src/__tests__/index.test.ts (new — 14 unit tests)
