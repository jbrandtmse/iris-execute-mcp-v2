---
"@iris-mcp/client-config": minor
"@iris-mcp/shared": patch
"@iris-mcp/dev": patch
"@iris-mcp/admin": patch
"@iris-mcp/interop": patch
"@iris-mcp/ops": patch
"@iris-mcp/data": patch
"@iris-mcp/all": patch
---

Make the packages publishable and pin every `npx` spec to the major (Story 42.1).

- Every spec the suite writes, spawns or documents ends in `@1`: `@iris-mcp/client-config` exports `IRIS_MCP_MAJOR` and `pinnedSpec()`, `iris-mcp-clients apply` writes `["-y", "@iris-mcp/<pkg>@1"]`, and re-applying an entry that an earlier version wrote unpinned rewrites only its owned `args`. The documented clients CLI form is `npx -y -p @iris-mcp/client-config@1 iris-mcp-clients <command>` (the old form passed `iris-mcp-clients` to the CLI as an unknown command).
- Every package declares `engines.node >=22.17.0`, `@types/node` is major 22, and the registry metadata (`license`, `repository`, `author`, `homepage`, `bugs`, `keywords`, and `mcpName` on the five servers) is complete.
- `@iris-mcp/shared` publishes only its root export, and no tarball ships test helpers, source maps or a vitest peer declaration.
- `@iris-mcp/all` is documented as a meta-package with no command: a global install links nothing.
- The first release lands on `1.0.0` through a release changeset template kept outside `.changeset/`; no pending changeset declares a major.

No tool, action, governance key, annotation, description or environment variable is added or changed.
