# Changelog

All notable changes to the IRIS MCP Server Suite are documented in this file.

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
