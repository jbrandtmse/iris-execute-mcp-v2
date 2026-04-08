# Story 8.1: Suite-Level README & Architecture Overview

Status: done

## Story

As a potential user,
I want a clear README that explains what IRIS MCP v2 is, which servers to install, and how to get started,
so that I can quickly understand the project and begin using it.

## Acceptance Criteria

1. **AC1**: The root `README.md` includes an overview of the 5-server suite architecture and the problem it solves.
2. **AC2**: A table listing all 5 servers with their domain, tool count, and package name:
   - @iris-mcp/dev — Development (21 tools)
   - @iris-mcp/admin — Administration (22 tools)
   - @iris-mcp/interop — Interoperability (19 tools)
   - @iris-mcp/ops — Operations & Monitoring (16 tools)
   - @iris-mcp/data — Data & Analytics (7 tools)
3. **AC3**: Guidance on which server(s) to install based on user role (developer, admin, integration engineer, ops, data analyst).
4. **AC4**: A quick-start section showing installation and MCP client configuration for the most common setup (iris-dev-mcp).
5. **AC5**: Links to each per-package README for detailed tool references.
6. **AC6**: A note about the @iris-mcp/all meta-package for installing everything.
7. **AC7**: Prerequisites listed: Node.js 18+, IRIS 2023.1+, web port access.

## Tasks / Subtasks

- [x] Task 1: Create root README.md (AC: 1-7)
  - [x] Project title and tagline describing the MCP server suite for InterSystems IRIS
  - [x] Overview section: what IRIS MCP v2 is, why it exists (AI assistants need structured access to IRIS), 5-server architecture
  - [x] Server table with columns: Package, Domain, Tools, Description
  - [x] "Which Server Do I Need?" section with role-based guidance
  - [x] Quick Start section: install @iris-mcp/dev, set env vars, configure Claude Desktop/Claude Code
  - [x] Prerequisites section: Node.js 18+, InterSystems IRIS 2023.1+, IRIS web port (default 52773) accessible
  - [x] Links to per-package READMEs (packages/iris-dev-mcp/README.md, etc.) — note: these don't exist yet, will be created in Story 8.2
  - [x] @iris-mcp/all meta-package note — will be created in Story 8.6
  - [x] License and contributing info (brief)

### Review Findings

- [x] [Review][Patch] Add credential security note to config examples [README.md:107] -- resolved: added note after first JSON example
- [x] [Review][Patch] Meta-package link text references internal "Story 8.6" jargon [README.md:29] -- resolved: changed to user-friendly "meta-package README" text
- [x] [Review][Patch] Meta-package section implies @iris-mcp/all is available now [README.md:22-27] -- resolved: added "Once released" and "Coming soon" qualifiers
- [x] [Review][Defer] Per-package README links are dead until Story 8.2 creates them -- deferred, pre-existing by design

## Dev Notes

### Architecture Context

The project is a TypeScript monorepo (pnpm + Turborepo) with 7 packages:
- `packages/shared` (@iris-mcp/shared) — Internal dependency, not installed by users. Contains IrisHttpClient, McpServerBase, error classes, config, bootstrap.
- `packages/iris-dev-mcp` (@iris-mcp/dev) — 21 tools for ObjectScript document CRUD, compilation, SQL, globals, code execution
- `packages/iris-admin-mcp` (@iris-mcp/admin) — 22 tools for namespace, database, user, role, resource, webapp, SSL, OAuth management
- `packages/iris-interop-mcp` (@iris-mcp/interop) — 19 tools for Ensemble/Interoperability production lifecycle, credentials, lookups, rules, transforms
- `packages/iris-ops-mcp` (@iris-mcp/ops) — 16 tools for system metrics, jobs, locks, journals, mirrors, audit, database integrity, licensing, ECP, tasks, config
- `packages/iris-data-mcp` (@iris-mcp/data) — 7 tools for DocDB document database, DeepSee analytics (MDX/cubes), REST API management
- `packages/iris-mcp-all` (@iris-mcp/all) — Meta-package (Story 8.6, doesn't exist yet as functional package)

### Connection Architecture

All servers connect to IRIS via HTTP(S) to the IRIS web port (default 52773). They use:
- Atelier REST API (built-in to IRIS) for document/code operations
- Custom REST dispatch service (`ExecuteMCPv2.REST.Dispatch`) for execution, globals, security, interop, analytics
- Built-in IRIS REST APIs: `/api/docdb/v1/` (DocDB), `/api/mgmnt/v2/` (REST management)

Authentication: Basic Auth with session cookie reuse and CSRF token handling.

### Environment Variables

All servers use the same env vars:
- `IRIS_HOST` (default: localhost)
- `IRIS_PORT` (default: 52773)
- `IRIS_USERNAME` (default: _SYSTEM)
- `IRIS_PASSWORD` (required)
- `IRIS_NAMESPACE` (default: USER)
- `IRIS_HTTPS` (default: false)

### MCP Protocol

Servers support stdio and Streamable HTTP transport. MCP spec v2025-11-25. All tools provide `structuredContent` + text `content`. Tool annotations: readOnlyHint, destructiveHint, idempotentHint, openWorldHint.

### Source Files

| What | Path |
|------|------|
| Root README (create) | `README.md` |
| Package names reference | `packages/*/package.json` |
| Tool definitions | `packages/*/src/tools/index.ts` |
| Shared public API | `packages/shared/src/index.ts` |
| .mcp.json (config example) | `.mcp.json` |

### Previous Story Intelligence (Story 8.0)

- Story 8.0 was cleanup only — no README work
- No root README.md currently exists (only v1 READMEs in `sources/` directory)
- Per-package READMEs also don't exist yet (Story 8.2)
- The v1 packages in `sources/iris-execute-mcp/` and `sources/mcp-server-iris/` have their own READMEs for migration reference

### Critical Rules

- Do NOT create per-package READMEs — that is Story 8.2
- Do NOT create the meta-package — that is Story 8.6
- Link to per-package READMEs using relative paths even though files don't exist yet
- Use accurate tool counts: dev=21, admin=22, interop=19, ops=16, data=7, total=85
- Keep the README practical and user-focused, not developer-focused
- Include a `.mcp.json` configuration example for Claude Code (the most common client)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 8.1]
- [Source: packages/*/src/tools/index.ts — tool counts]
- [Source: packages/shared/src/index.ts — public API]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.6 (1M context)

### Debug Log References

None — documentation-only story, no debugging required.

### Completion Notes List

- Created comprehensive root README.md replacing the placeholder "under construction" stub
- README includes: project tagline, 5-server architecture overview, server table (85 tools across 5 servers), role-based guidance table, prerequisites, quick-start with Claude Code and Claude Desktop configuration examples, architecture diagram (ASCII), per-package documentation links, meta-package note, known limitations (preserved from original), license, and contributing section
- All 7 acceptance criteria satisfied
- Per-package README links use relative paths to files that will be created in Story 8.2
- Meta-package section references @iris-mcp/all which will be completed in Story 8.6
- Tool counts verified against story spec: dev=21, admin=22, interop=19, ops=16, data=7, total=85

### Implementation Plan

Single task: Replace placeholder README.md with full suite-level documentation covering all 7 ACs. No code changes, no tests beyond content validation.

### File List

- README.md (modified — replaced placeholder with full suite-level README)

### Change Log

- 2026-04-07: Created root README.md with suite overview, server table, role guidance, quick start, architecture diagram, and per-package links (Story 8.1, all ACs)
