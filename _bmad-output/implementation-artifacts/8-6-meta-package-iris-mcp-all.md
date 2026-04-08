# Story 8.6: Meta-Package (@iris-mcp/all)

Status: done

## Story

As a user who wants all five servers,
I want a single package that installs everything,
so that I don't have to install and configure five packages individually.

## Acceptance Criteria

1. **AC1**: When a user runs `npm install -g @iris-mcp/all`, all five server packages are installed as dependencies.
2. **AC2**: The package.json lists all five servers as dependencies with synchronized version numbers.
3. **AC3**: The package has no source code of its own (pure meta-package).
4. **AC4**: The iris-mcp-all README explains the meta-package purpose and links to individual server documentation.
5. **AC5**: The README shows MCP client configuration for running all five servers.

## Tasks / Subtasks

- [x] Task 1: Finalize package.json (AC: 1, 2)
  - [x] Verify all 5 server packages are listed as dependencies (already done in skeleton)
  - [x] Remove `@iris-mcp/shared` from dependencies — end users don't need it directly
  - [x] Remove build/test/lint scripts — pure meta-package has no source code
  - [x] Remove `main`, `types`, `exports`, `files` fields — no dist to publish
  - [x] Ensure version numbers are synchronized (`workspace:*`)

- [x] Task 2: Clean up source files (AC: 3)
  - [x] Remove `src/index.ts` — meta-package has no source code
  - [x] Remove `tsconfig.json` — no TypeScript to compile
  - [x] Remove `dist/` directory if present
  - [x] Remove from Turbo build pipeline if needed (or let it no-op)

- [x] Task 3: Create README (AC: 4, 5)
  - [x] Create `packages/iris-mcp-all/README.md`
  - [x] Explain meta-package purpose
  - [x] Link to each individual server README
  - [x] Show MCP client configuration for running all five servers
  - [x] Link back to root README

## Dev Notes

### Current State

The package skeleton already exists at `packages/iris-mcp-all/` with:
- `package.json` — has all 5 server deps + shared (shared should be removed)
- `src/index.ts` — placeholder `export {}` (should be removed)
- `tsconfig.json` — has references (should be removed)
- `dist/` — compiled output (should be removed)

### What a Meta-Package Should Look Like

A pure meta-package only has:
- `package.json` with dependencies listing the sub-packages
- `README.md` explaining what it is
- Nothing else — no source code, no build step

### Package.json Target State

```json
{
  "name": "@iris-mcp/all",
  "version": "0.0.0",
  "description": "Meta-package that installs all five IRIS MCP server packages",
  "dependencies": {
    "@iris-mcp/dev": "workspace:*",
    "@iris-mcp/admin": "workspace:*",
    "@iris-mcp/interop": "workspace:*",
    "@iris-mcp/ops": "workspace:*",
    "@iris-mcp/data": "workspace:*"
  }
}
```

### Source Files to Modify

| What | Path |
|------|------|
| Package manifest | `packages/iris-mcp-all/package.json` |
| Remove placeholder | `packages/iris-mcp-all/src/index.ts` |
| Remove tsconfig | `packages/iris-mcp-all/tsconfig.json` |
| Remove dist | `packages/iris-mcp-all/dist/` |
| Create README | `packages/iris-mcp-all/README.md` |

### Critical Rules

- Do NOT leave any source code in the meta-package — it must be a pure dependency aggregator
- The `turbo build` pipeline may reference this package — ensure it still works after removing build scripts (turbo will skip packages without matching scripts)
- `turbo test` already fails with "no test files" for this package — that's expected and pre-existing
- Keep `"type": "module"` in package.json for consistency
- All 5 server deps must use `workspace:*` for monorepo versioning

### Previous Story Intelligence (Story 8.5)

- All 85 tools validated across 5 servers — the meta-package aggregates these
- `turbo build` runs 7/7 tasks — removing build from this package should reduce to 6/7 or turbo skips it
- The pre-existing "no test files" issue for this package will be resolved by removing the test script

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.6]
- [Source: packages/iris-mcp-all/package.json — current state]
- [Source: README.md — meta-package section references this]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

No debug issues encountered -- straightforward meta-package cleanup.

### Completion Notes List

- Task 1: Stripped package.json to pure meta-package -- removed @iris-mcp/shared dependency, build/test/lint scripts, main/types/exports/files fields. Kept "type": "module" for consistency. All 5 server deps use workspace:*.
- Task 2: Removed src/index.ts, tsconfig.json, tsconfig.tsbuildinfo, and dist/ directory. Turbo build now runs 6/6 tasks (correctly skips this package).
- Task 3: Created README.md with meta-package explanation, server table with tool counts, environment variable reference, full MCP client config for all 5 servers (Claude Code .mcp.json format), role-based selection guide, and links to all individual server READMEs plus root README.
- Verified turbo build passes (6 successful, 6 total) after changes.

### File List

- `packages/iris-mcp-all/package.json` (modified -- stripped to pure meta-package)
- `packages/iris-mcp-all/README.md` (created -- meta-package documentation)
- `packages/iris-mcp-all/src/index.ts` (deleted)
- `packages/iris-mcp-all/tsconfig.json` (deleted)
- `packages/iris-mcp-all/tsconfig.tsbuildinfo` (deleted)
- `packages/iris-mcp-all/dist/` (deleted -- directory and contents)

### Review Findings

- [x] [Review][Patch] Root README stale meta-package section: "Coming soon", incorrect `npx` command, inaccurate "re-exports" text [README.md:21-29] -- fixed during review
- [x] [Review][Defer] Missing `license` field in package.json [packages/iris-mcp-all/package.json] -- deferred, pre-existing (all packages may need license before publish)
- [x] [Review][Defer] Missing `repository`/`author`/`keywords` in package.json [packages/iris-mcp-all/package.json] -- deferred, pre-existing (publish-readiness concern)

### Change Log

- 2026-04-07: Implemented Story 8.6 -- converted iris-mcp-all from skeleton package to pure meta-package (no source code, no build step, dependencies-only package.json + README)
