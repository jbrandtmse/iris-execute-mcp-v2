# Changelog

All notable changes to the IRIS MCP Server Suite are documented in this file.

## [Pre-release — 2026-04-20]

### Added — Epic 10: Namespace Browsing and Bulk Export Tools (iris-dev-mcp)

Two new `@iris-mcp/dev` tools let AI clients survey a namespace at package granularity and pull code to disk in bulk, without paging every document or dropping to raw SQL.

- **`iris_package_list`** ([`packages/iris-dev-mcp/src/tools/packages.ts`](packages/iris-dev-mcp/src/tools/packages.ts)) — Walks the Atelier `docnames` endpoint and aggregates client-side into package rollups at a configurable depth. Same filter surface as `iris_doc_list` (category, type, generated, `modifiedSince`), plus a `prefix` narrow, a `system` tri-state (`true | false | only`), and a 1000-row cap. Returns `{ packages[], count, totalDocs, truncated?, limit? }`. Use `iris_package_list` for a structural overview; use `iris_doc_list` for individual document names.
- **`iris_doc_export`** ([`packages/iris-dev-mcp/src/tools/export.ts`](packages/iris-dev-mcp/src/tools/export.ts)) — The inverse of `iris_doc_load`. Walks Atelier `docnames` with the same filter surface plus `generated` as a tri-state (`true | false | both`), then downloads each matching document via `GET /doc/{name}` with 4-way bounded concurrency. Dots-as-directories mapping: `EnsLib.HTTP.GenericService.cls` → `<destinationDir>/EnsLib/HTTP/GenericService.cls`. CSP paths with forward slashes are preserved. Writes a `manifest.json` recording every exported file and every skipped item with a reason and remediation hint. Resilient by default: per-file failures are collected into `skippedItems` rather than aborting; Windows long paths can be worked around with `useShortPaths: true` (short-path collisions are guarded via a shared-path reservation map to prevent silent overwrite); `continueDownloadOnTimeout: true` detaches the download loop from the MCP request's `AbortSignal` so client timeouts don't abandon the on-disk state. Inverse round-trip with `iris_doc_load` + `overwrite: ifDifferent` skips unchanged files for fast re-sync.

Both tools are TypeScript-only — no new `ExecuteMCPv2.*` classes, no `BOOTSTRAP_VERSION` change. **Upgrade path for existing installs**: `git pull && pnpm install && pnpm turbo run build` plus an MCP server restart. No ObjectScript redeploy.

Tool count in `@iris-mcp/dev`: 21 → 23. Suite total: 85 → 87.

## [Pre-release — 2026-04-19]

### Fixed — Manual MCP suite retest uncovered six defects

An end-to-end manual test pass exercised every tool in the five MCP servers against a live IRIS instance. Six defects were found and fixed; each is covered by unit tests and a live-server retest.

- **`IrisApiError` now surfaces `status.errors[]` detail** ([`packages/shared/src/errors.ts`](packages/shared/src/errors.ts)). Previously every tool that hit an Atelier error path returned a generic `"IRIS reported errors for POST /api/… Review the error details and correct the request."` message, with the actual `%Status` text stashed on `error.errors[]` but never formatted into `error.message`. The constructor now appends a `Details: …` suffix built from `error`/`message`/`summary` fields of each entry, so every tool that catches `IrisApiError` and surfaces `error.message` gets the real IRIS error for free. Verified end-to-end across the admin, data, and interop servers during retest — the DocDB 403 failures, for example, now say `Details: ERROR #800: Logins for Service %Service_DocDB are disabled` instead of a bare 403.
- **`iris_doc_load` no longer mangles doc names for literal file paths** ([`packages/iris-dev-mcp/src/tools/load.ts`](packages/iris-dev-mcp/src/tools/load.ts)). `extractBaseDir()` walks pattern segments until a glob metacharacter is found; when the pattern contained no metacharacter (a plain file path), it used to return the entire path — causing the filename itself to leak into the mapped IRIS document name (`c:.git.iris-execute-mcp-v2.MyClass.cls`). It now returns the parent directory for literal paths so a single-file upload produces a clean doc name (`MyClass.cls`). Test added in [`packages/iris-dev-mcp/src/__tests__/load.test.ts`](packages/iris-dev-mcp/src/__tests__/load.test.ts).
- **`iris_doc_search` now honours its documented case-insensitive default** ([`packages/iris-dev-mcp/src/tools/intelligence.ts`](packages/iris-dev-mcp/src/tools/intelligence.ts)). The tool documents `case: false` as the default, but the flag was only sent to the Atelier `action/search` endpoint when set explicitly — and the server's default turns out to be case-sensitive. The client now always sends `case`, `regex`, `word`, and `wild` explicitly so the tool's documented defaults are what IRIS sees. Retest confirmed `"classmethod"` and `"ClassMethod"` now return the same 16 matches by default; `case: true` narrows to 4.
- **`iris_task_history` is paginated** ([`src/ExecuteMCPv2/REST/Task.cls`](src/ExecuteMCPv2/REST/Task.cls), [`packages/iris-ops-mcp/src/tools/task.ts`](packages/iris-ops-mcp/src/tools/task.ts)). The endpoint returned every row `%SYS.Task.History:TaskHistoryDetail` produced — on the retest system that was 1,357 rows and 263 KB, which blew past the MCP token cap. The server now accepts an optional `maxRows` query parameter (default 100, capped at 1000), the tool exposes a matching `maxRows` input field, and the response carries new `total`, `maxRows`, and `truncated` fields so callers can tell when they've hit the cap.
- **`iris_transform_test` returns real output data for non-`%JSON.Adaptor` targets** ([`src/ExecuteMCPv2/REST/Interop.cls`](src/ExecuteMCPv2/REST/Interop.cls)). When a transform's target class didn't extend `%JSON.Adaptor`, the serializer stored the literal string `"Object does not support JSON serialization"` in `output.data` — looking suspiciously like a legitimate transform result. The handler now tries `%JSONExportToString` first and, on failure, falls back to reflecting public non-calculated non-relationship properties via `%Dictionary.CompiledProperty`. The response always carries a `serialization` field (`"json-adaptor"`, `"property-reflection"`, or `"scalar"`) so callers can distinguish modes; fallback mode also carries `propertyCount` and a `note` explaining the best-effort dump. Retest confirmed the DTL `Ens.SSH.InteractiveAuth.DTL` now returns real property values (`Responses`, `UseCredentialsPasswordAt`, `UseSFTPPassphraseCredentialsPasswordAt`) instead of the sentinel string.

### ObjectScript class changes

Two of the six fixes above required changes to the embedded `ExecuteMCPv2.*` classes:

- [`src/ExecuteMCPv2/REST/Task.cls`](src/ExecuteMCPv2/REST/Task.cls) — `TaskHistory()` now caps rows and emits `total`/`maxRows`/`truncated`.
- [`src/ExecuteMCPv2/REST/Interop.cls`](src/ExecuteMCPv2/REST/Interop.cls) — `TransformTest()` serializer overhauled per above.

The auto-upgrading bootstrap (see the 2026-04-10 entry below) picks these up without manual intervention — the class-content hash changed, so on next MCP server restart every existing install automatically redeploys and recompiles the handler classes. No operator action required.

### Known upstream defects surfaced (not fixed in this pass)

Now that `IrisApiError.message` carries real detail, two pre-existing defects became visible during retest. Both are tracked separately and not addressed here:

- `iris_resource_manage` / `iris_role_manage` with a `description` argument crash `Security.Resources.Create` / `Security.Roles.Create` with `<UNDEFINED>Create *Description`. Create without `description` still works. Root cause lives in how the REST handler passes properties into `Security.*.Create`.
- `iris_task_history` with a `taskId` argument does not filter — the returned rows still span all task IDs. The cap works correctly; only the filter is ineffective.

## [Pre-release — 2026-04-10]

### Added — Auto-upgrading ObjectScript handlers

The MCP server bootstrap now automatically redeploys the IRIS-side ObjectScript handler classes (`ExecuteMCPv2.*`) when the embedded class content differs from what's already deployed. This closes a long-standing deployment gap where a fix to a handler class would not reach an existing install without manual intervention.

### How it works

- Every `.cls` file change, followed by `npm run gen:bootstrap`, produces a new short SHA-256 hash (the `BOOTSTRAP_VERSION`).
- The hash is injected into the embedded copy of `ExecuteMCPv2.Setup.cls` at generation time. The disk copy keeps a `"dev"` placeholder for local development.
- At MCP server startup, the bootstrap calls `SELECT ExecuteMCPv2.Setup_GetBootstrapVersion()` via the Atelier SQL endpoint and compares the result against the embedded `BOOTSTRAP_VERSION`:
  - **match** → skip deployment entirely (existing fast-path behavior, preserved)
  - **mismatch** → log `"upgrading from <old> to <new>"`, redeploy all 13 handler classes, recompile; **skip** the one-time privileged webapp registration + package mapping (those don't need to rerun on a class-content upgrade and may not be permitted if the current user lacks `%Admin_Manage`)
  - **no such method** → treat as a fresh install (runs the full bootstrap, same as before). This is the one-shot upgrade path for users currently running a pre-version-stamp deployment — their old `Setup.cls` lacks `GetBootstrapVersion`, the SQL throws, and the full bootstrap replaces everything.

### Who is affected

- **Beta users running MCP server versions prior to this change** — on their next MCP server restart after pulling the new code, the probe will fail (old `Setup.cls` doesn't have `GetBootstrapVersion`), triggering a full bootstrap that upgrades every handler class to current. **No manual intervention required.** Previously, a fix to any `ExecuteMCPv2.*` handler would not reach existing installs because the bootstrap probe was a binary "is anything deployed" check.
- **Fresh installs** — unchanged. First run deploys everything, probe reports current, subsequent starts skip.
- **Developers editing `.cls` files** — a new unit test in `packages/shared/src/__tests__/bootstrap.test.ts` enforces the `gen:bootstrap` discipline: if you edit any `.cls` file and don't regenerate `bootstrap-classes.ts`, `turbo test` fails with an explicit instruction. This prevents the "forgot to run gen:bootstrap" class of bugs entirely.

### Cross-platform note

The hash computation and embedded class content are now CRLF→LF normalized in `gen-bootstrap.mjs`, so contributors on Windows (which often auto-converts to CRLF) and contributors on Linux/macOS (LF-native) compute identical hashes from identical source content. Without this normalization, the version stamp would silently differ across platforms even on unchanged files.

## [Pre-release breaking change — 2026-04-09]

### Changed
- **Tool names flattened from dotted notation to flat underscore notation** for Anthropic Messages API and Claude Desktop compatibility.
  - Example: `iris.doc.get` → `iris_doc_get`
  - All 85 tools across all 5 server packages were renamed.
  - Applies to every tool exposed by `@iris-mcp/dev`, `@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops`, and `@iris-mcp/data`.

### Why
The Anthropic Messages API `tools[].name` field uses the regex `^[a-zA-Z0-9_-]+$` and rejects tool names containing dots, even though the MCP specification permits them. Claude Desktop routes tool registrations through the Anthropic Messages API, so any dotted tool name fails registration with a "tool name not valid" error. Claude Code silently rewrote dots to underscores as part of its internal `mcp__{server}__{tool}` prefix, which is why the defect was invisible during the development of Epics 1–8.

### Who is affected
- **Claude Desktop users** — previously blocked by the registration error; this fix unblocks them.
- **Any MCP client routing through the Anthropic Messages API** — same as Claude Desktop.
- **Claude Code users** — unaffected. Claude Code was already rewriting dots to underscores internally, so existing prompts referencing `mcp__iris-dev-mcp__iris_doc_get` (the Claude-Code-rewritten form) will continue to work unchanged.

### Rationale and full change history
See [`_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09.md`](_bmad-output/planning-artifacts/sprint-change-proposal-2026-04-09.md).
