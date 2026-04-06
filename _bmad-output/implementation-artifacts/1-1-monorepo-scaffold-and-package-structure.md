# Story 1.1: Monorepo Scaffold & Package Structure

Status: done

## Story

As a developer,
I want a properly structured TypeScript monorepo with all package directories and build tooling configured,
So that I have a solid foundation to build all five MCP server packages on.

## Acceptance Criteria

1. **Given** a fresh clone of the repository **When** the monorepo is initialized **Then** the repo contains `packages/` directory with `shared/`, `iris-dev-mcp/`, `iris-admin-mcp/`, `iris-interop-mcp/`, `iris-ops-mcp/`, `iris-data-mcp/`, and `iris-mcp-all/` subdirectories
2. **Given** the monorepo is initialized **When** `turbo.json` is configured **Then** it defines `build`, `test`, `lint`, and `type-check` task pipelines with `shared` as a dependency of all server packages
3. **Given** the workspace config **When** `pnpm-workspace.yaml` is created **Then** it includes `packages/*`
4. **Given** the TypeScript config **When** `tsconfig.base.json` is created **Then** it targets ES2022 with module Node16, moduleResolution Node16, and strict mode enabled (including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`)
5. **Given** per-package TypeScript configs **When** each package's `tsconfig.json` is created **Then** it extends `../../tsconfig.base.json`
6. **Given** code quality config **When** ESLint and Prettier are configured **Then** ESLint has TypeScript rules at root and Prettier is configured at root
7. **Given** test config **When** Vitest is configured **Then** it is set as the test framework with native TypeScript/ESM support
8. **Given** versioning config **When** Changesets is configured **Then** `.changeset/config.json` enables synchronized versioning across all packages
9. **Given** environment docs **When** `.env.example` is created **Then** it documents `IRIS_HOST`, `IRIS_PORT`, `IRIS_USERNAME`, `IRIS_PASSWORD`, `IRIS_NAMESPACE`, `IRIS_HTTPS`
10. **Given** git config **When** `.gitignore` is updated **Then** it covers `node_modules`, `dist`, `.env`, and build artifacts
11. **Given** all config complete **When** `pnpm install` runs **Then** it succeeds without errors
12. **Given** all packages exist as skeletons **When** `turbo build` runs **Then** it completes without errors

## Tasks / Subtasks

- [x] Task 1: Initialize pnpm workspace and Turborepo (AC: #1, #2, #3)
  - [x] Create `pnpm-workspace.yaml` with `packages/*`
  - [x] Create root `package.json` with workspace scripts (`turbo build`, `turbo test`, `turbo lint`, `turbo type-check`) and devDependencies (turborepo, typescript, eslint, prettier, vitest, @changesets/cli)
  - [x] Create `turbo.json` with `build`, `test`, `lint`, `type-check` pipelines; `build` must have `shared` dependency for all server packages
- [x] Task 2: Configure TypeScript (AC: #4, #5)
  - [x] Create `tsconfig.base.json`: target ES2022, module Node16, moduleResolution Node16, strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true, declaration: true, declarationMap: true, sourceMap: true, outDir: dist, rootDir: src
  - [x] Create per-package `tsconfig.json` extending `../../tsconfig.base.json` with project references
- [x] Task 3: Configure code quality (AC: #6)
  - [x] Create `.eslintrc.js` (or `eslint.config.mjs` if using flat config) with TypeScript rules
  - [x] Create `.prettierrc` at root
- [x] Task 4: Configure Vitest (AC: #7)
  - [x] Add Vitest as root devDependency
  - [x] Configure per-package or root vitest.config.ts with TypeScript/ESM support
- [x] Task 5: Configure Changesets (AC: #8)
  - [x] Run `npx changeset init` or create `.changeset/config.json` manually
  - [x] Set synchronized versioning (fixed mode, all packages share version)
- [x] Task 6: Create package skeletons (AC: #1, #12)
  - [x] `packages/shared/` — `package.json` (name: `@iris-mcp/shared`), `src/index.ts` (empty barrel export), `tsconfig.json`
  - [x] `packages/iris-dev-mcp/` — `package.json` (name: `@iris-mcp/dev`, depends on `@iris-mcp/shared`), `src/index.ts`, `tsconfig.json`
  - [x] `packages/iris-admin-mcp/` — `package.json` (name: `@iris-mcp/admin`, depends on `@iris-mcp/shared`), `src/index.ts`, `tsconfig.json`
  - [x] `packages/iris-interop-mcp/` — `package.json` (name: `@iris-mcp/interop`, depends on `@iris-mcp/shared`), `src/index.ts`, `tsconfig.json`
  - [x] `packages/iris-ops-mcp/` — `package.json` (name: `@iris-mcp/ops`, depends on `@iris-mcp/shared`), `src/index.ts`, `tsconfig.json`
  - [x] `packages/iris-data-mcp/` — `package.json` (name: `@iris-mcp/data`, depends on `@iris-mcp/shared`), `src/index.ts`, `tsconfig.json`
  - [x] `packages/iris-mcp-all/` — `package.json` (name: `@iris-mcp/all`, depends on all 5 server packages), `src/index.ts`, `tsconfig.json`
- [x] Task 7: Environment and git config (AC: #9, #10)
  - [x] Create `.env.example` with `IRIS_HOST=localhost`, `IRIS_PORT=52773`, `IRIS_USERNAME=`, `IRIS_PASSWORD=`, `IRIS_NAMESPACE=HSCUSTOM`, `IRIS_HTTPS=false`
  - [x] Update `.gitignore` to include `node_modules/`, `dist/`, `.env`, `*.tsbuildinfo`
- [x] Task 8: Validate build (AC: #11, #12)
  - [x] Run `pnpm install` — must succeed
  - [x] Run `turbo build` — must succeed (skeletons produce empty dist)
  - [x] Run `turbo lint` — must succeed
  - [x] Run `turbo type-check` — must succeed

## Dev Notes

### Technical Stack (Exact Versions)
- **Node.js**: 18+ LTS (mandatory for native `fetch`)
- **TypeScript**: 5.0+ (strict mode)
- **pnpm**: 8+ (strict dependency hoisting)
- **Turborepo**: Latest via `create-turbo` or manual setup
- **Vitest**: Latest (native TS/ESM)
- **@changesets/cli**: Latest (synchronized/fixed versioning)
- **ESLint**: Latest with `@typescript-eslint/*` plugins
- **Prettier**: Latest

### Critical Constraints
- **No bundler needed** — tsc per package, Node.js server packages
- **pnpm workspaces** (not npm workspaces) — strict dependency hoisting prevents published package issues
- **All packages at `@iris-mcp/*` scope** — public npm packages
- **Shared must build first** — all server packages depend on `@iris-mcp/shared`
- **Logging**: Use `console.error()` only (stdout reserved for MCP protocol)
- **No native dependencies** — pure Node.js, no compiled modules

### File Naming Conventions
- TypeScript files: `kebab-case.ts` (e.g., `http-client.ts`, `server-base.ts`)
- TypeScript directories: `kebab-case/` (e.g., `tools/`, `__tests__/`)
- Exports: `PascalCase` for classes/types/interfaces, `camelCase` for functions/instances

### Skeleton Source Files
Each package's `src/index.ts` should export an empty placeholder or a comment indicating it will be populated in subsequent stories. The build must succeed even if these files are empty/minimal.

### Existing Repository Structure
The repo already contains:
- `src/` — IRIS-side ObjectScript classes (existing, do not modify)
- `sources/` — v1 reference codebases (READ-ONLY, never modify)
- `irislib/` — IRIS system library reference (READ-ONLY, never modify)
- `docs/` — Project documentation
- `_bmad/`, `_bmad-output/` — BMad planning artifacts (do not modify)
- `LICENSE` — MIT license (existing)
- `README.md` — Existing (under construction)

The `packages/` directory is **new** and must be created by this story.

### turbo.json Pipeline Configuration
```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**"]
    },
    "test": {
      "dependsOn": ["build"]
    },
    "lint": {},
    "type-check": {
      "dependsOn": ["^build"]
    }
  }
}
```
The `^build` dependency ensures shared builds before server packages.

### Changesets Fixed Mode Config
```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [["@iris-mcp/*"]],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

### .env.example Contents
```
IRIS_HOST=localhost
IRIS_PORT=52773
IRIS_USERNAME=_SYSTEM
IRIS_PASSWORD=
IRIS_NAMESPACE=HSCUSTOM
IRIS_HTTPS=false
```

### Project Structure Notes

- The `packages/` directory is the only new top-level directory
- Must coexist with existing `src/`, `sources/`, `irislib/`, `docs/` directories
- Root configs (`turbo.json`, `tsconfig.base.json`, `pnpm-workspace.yaml`, `.eslintrc.js`, `.prettierrc`) are all new files at project root
- The existing `package.json` (if any) at root may need to be replaced or extended with workspace configuration

### Anti-Patterns to Avoid
- Do NOT use npm workspaces — use pnpm workspaces
- Do NOT add a bundler (webpack, esbuild, etc.) — tsc is sufficient
- Do NOT create cross-package dependencies except to `@iris-mcp/shared`
- Do NOT hardcode IRIS URLs or credentials anywhere
- Do NOT use `console.log()` — use `console.error()` for logging
- Do NOT modify any files in `src/`, `sources/`, `irislib/`, or `_bmad*/` directories

### References

- [Source: _bmad-output/planning-artifacts/architecture.md - Technical Stack section]
- [Source: _bmad-output/planning-artifacts/architecture.md - Repository Structure section]
- [Source: _bmad-output/planning-artifacts/architecture.md - Build Tooling section]
- [Source: _bmad-output/planning-artifacts/prd.md - Package Structure section]
- [Source: _bmad-output/planning-artifacts/epics.md - Story 1.1 Acceptance Criteria]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
None required — all tasks completed successfully.

### Completion Notes List
- Created pnpm workspace monorepo with Turborepo orchestration (7 packages)
- Configured TypeScript 5.x with strict mode, ES2022 target, Node16 modules
- Used ESLint flat config (eslint.config.mjs) with typescript-eslint for ESLint v9 compatibility
- Configured Vitest at root level with TypeScript/ESM support
- Set up Changesets in fixed mode for synchronized versioning across @iris-mcp/* scope
- All 7 package skeletons created with proper workspace dependencies
- Added `composite: true` to all package tsconfig.json files to enable TypeScript project references
- All validation pipelines pass: pnpm install, turbo build, turbo lint, turbo type-check

### Change Log
- 2026-04-05: Story 1.1 implemented — monorepo scaffold with all 7 packages, build tooling, and code quality config

### File List
- package.json (new)
- pnpm-workspace.yaml (new)
- turbo.json (new)
- tsconfig.base.json (new)
- eslint.config.mjs (new)
- .prettierrc (new)
- vitest.config.ts (new)
- .env.example (new)
- .gitignore (modified)
- .changeset/config.json (new)
- .changeset/README.md (new)
- packages/shared/package.json (new)
- packages/shared/tsconfig.json (new)
- packages/shared/src/index.ts (new)
- packages/iris-dev-mcp/package.json (new)
- packages/iris-dev-mcp/tsconfig.json (new)
- packages/iris-dev-mcp/src/index.ts (new)
- packages/iris-admin-mcp/package.json (new)
- packages/iris-admin-mcp/tsconfig.json (new)
- packages/iris-admin-mcp/src/index.ts (new)
- packages/iris-interop-mcp/package.json (new)
- packages/iris-interop-mcp/tsconfig.json (new)
- packages/iris-interop-mcp/src/index.ts (new)
- packages/iris-ops-mcp/package.json (new)
- packages/iris-ops-mcp/tsconfig.json (new)
- packages/iris-ops-mcp/src/index.ts (new)
- packages/iris-data-mcp/package.json (new)
- packages/iris-data-mcp/tsconfig.json (new)
- packages/iris-data-mcp/src/index.ts (new)
- packages/iris-mcp-all/package.json (new)
- packages/iris-mcp-all/tsconfig.json (new)
- packages/iris-mcp-all/src/index.ts (new)

### Review Findings

- [x] [Review][Patch] Missing .prettierignore — format scripts would process non-project files (sources/, irislib/, pnpm-lock.yaml) [.prettierignore:new] — FIXED: created .prettierignore
- [x] [Review][Patch] ESLint no-console rule allows console.warn but architecture specifies console.error only [eslint.config.mjs:21] — FIXED: removed warn from allow list
- [x] [Review][Defer] No license field in package.json files [package.json] — deferred, pre-existing/pre-publish concern
