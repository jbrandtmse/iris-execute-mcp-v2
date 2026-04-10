# Changelog

All notable changes to the IRIS MCP Server Suite are documented in this file.

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
