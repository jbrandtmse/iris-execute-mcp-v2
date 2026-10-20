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

Two fixes change behavior: a schema-invalid `tools/call` is now audited (one entry with `outcome` `error`, the raw key names and no `params`; DW-579), and a `prompts/get` that omits `arguments` renders like `{}` for a prompt whose arguments are all optional (DW-617).

Three more changes are sanctioned under AD-15 (wave-8 decisions #4 and #6): `addTools` sends one `notifications/tools/list_changed` per call instead of one per tool plus one; a malformed `tools/call` request (no `params`, `name` missing or not a string, `arguments` not an object) is refused with `-32602` `Invalid tools/call request: …` where v1 answered `-32603`; and a `tools/call` that carries a `task` parameter runs as a plain call where v1 refused it with `-32603`. Only a client that breaks the request schema or ignores the capability list sends either request.
