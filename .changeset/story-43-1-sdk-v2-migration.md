---
"@iris-mcp/shared": patch
"@iris-mcp/dev": patch
"@iris-mcp/admin": patch
"@iris-mcp/interop": patch
"@iris-mcp/ops": patch
"@iris-mcp/data": patch
"@iris-mcp/all": patch
---

refactor: framework migration to the MCP SDK v2 (Story 43.1)

`@iris-mcp/shared` runs on `@modelcontextprotocol/server` 2.3.1, pinned exactly, and the v1 `@modelcontextprotocol/sdk` is removed from every package. The 2025-11-25 wire is unchanged: `McpServerBase` serves `tools/list`, `tools/call`, `prompts/get` and `resources/read` itself, so every tool entry, error text and resource read the golden covers is byte-identical to the v1 build, which a golden captured before the migration pins on all five servers. The suite stays at 115 tools, the governance baseline and `BOOTSTRAP_VERSION` do not move, and `pnpm audit --prod` drops from 71 advisories to 18.

Two behaviors change, and only these: a schema-invalid `tools/call` is now audited (one entry with `outcome` `error`, the raw key names and no `params`; DW-579), and a `prompts/get` that omits `arguments` renders like `{}` for a prompt whose arguments are all optional (DW-617).

One limit remains: the SDK writes the members of a `tools/call` result that carries both `isError` and `structuredContent` as `content`, `structuredContent`, `isError`, where the v1 wire listed `isError` before `structuredContent`. The JSON value is the same.
