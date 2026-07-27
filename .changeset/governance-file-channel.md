---
"@iris-mcp/shared": patch
"@iris-mcp/dev": patch
---

feat(governance): `IRIS_GOVERNANCE_FILE` — load policy from a JSON file shared across MCP clients

A new optional environment variable `IRIS_GOVERNANCE_FILE` points at a JSON file of exactly the same shape as `IRIS_GOVERNANCE` (`{"global": {...}, "profiles": {...}}`, booleans only), so one governance policy is portable across every MCP client (any client can pass a plain env string) while the servers remain the sole enforcement authority. The file contributes two cascade layers strictly **below** both `IRIS_GOVERNANCE` env layers (`env.profile ?? env.global ?? file.profile ?? file.global ?? preset ?? default seed`), so a file introduced later can never override a pre-existing inline policy.

**Default state: unset ⇒ inert** — no file is ever read (zero filesystem access) and the resolved policy is byte-for-byte the pre-feature behavior. The path is explicit-only (never discovered; a relative path resolves against the server process's CWD — prefer absolute), read once at startup (restart semantics, no hot-reload in v1), and a missing/unreadable/malformed/invalid file fails startup fast naming the var, the path, and the underlying error — never silently permissive.

`iris_server_profiles` and the `iris-governance://<profile>` resource now report a `configSource` per key (`env` | `file` | `preset` | `default`) — an additive field emitted unconditionally (the resource payload grew from a bare policy map to `{ policy, configSource }`; the hidden-tool key omission applies to it identically). `iris_env_promote`'s Gate 4 (target-profile governance) evaluates the same file-augmented cascade, so a write-family key disabled only in the file is honored there too.
