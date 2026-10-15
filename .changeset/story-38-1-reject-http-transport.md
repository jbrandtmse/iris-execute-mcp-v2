---
"@iris-mcp/shared": minor
"@iris-mcp/dev": patch
"@iris-mcp/admin": patch
"@iris-mcp/interop": patch
"@iris-mcp/ops": patch
"@iris-mcp/data": patch
---

fix: an MCP transport other than stdio is a startup configuration error (Story 38.1)

`@iris-mcp/shared` (minor): `resolveTransport()` returns `"stdio"` and throws a configuration error for every other
configured `MCP_TRANSPORT` or `--transport` value (`http` included; the match is exact and case-sensitive). A
non-`stdio` value used to be accepted, and the server then connected to IRIS and bootstrapped before throwing "HTTP
transport not yet implemented"; an unknown `MCP_TRANSPORT` value used to fall back to stdio with a warning. Startup with
no transport configured, or with `stdio`, is unchanged. The type of `McpServerBase.start()`'s parameter is narrowed to `"stdio"`.

`@iris-mcp/dev`, `@iris-mcp/admin`, `@iris-mcp/interop`, `@iris-mcp/ops`, `@iris-mcp/data` (patch): the entry point
routes the configuration error into its existing `Fatal:` handler, so the process prints the message and exits 1 before
any IRIS connection. Remove `MCP_TRANSPORT` / `--transport`, or set it to `stdio`.
