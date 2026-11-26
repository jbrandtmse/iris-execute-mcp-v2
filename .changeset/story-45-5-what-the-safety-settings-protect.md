---
"@iris-mcp/shared": minor
"@iris-mcp/admin": minor
"@iris-mcp/data": minor
"@iris-mcp/dev": minor
"@iris-mcp/interop": minor
"@iris-mcp/ops": minor
---

docs: the README says what the safety settings protect, and `SECURITY.md` narrows its scope (Story 45.5, GitHub issue #1 points 1, 2 and 4)

- The README section "What the safety settings protect" says that governance, the presets, the confirmation dialogs, the audit log, the data policy and the SQL safety settings guard the agent in the MCP process, not the IRIS account, and that the account's privileges are the boundary. It states the minimum account for the SQL tools on a split or mapped layout, names the five SQL-callable setup procedures and their residual, says that a SELECT can call a `SqlProc` method, and says what a least-privilege account gets with the automatic install on and off. The five server READMEs, the governance variable rows and the client-config pages link to it.
- `SECURITY.md` scope (a release note): getting past a control through the servers' tools is in scope; using the IRIS account directly, a finding that depends on giving the account more privileges than it needs, and a residual the README documents are out of scope. No email address is added.
- The last sentence of the startup data-policy warning (new in this release, under `S-45.4-block-raw-tools`) is now `See "What the safety settings protect" in the README.` It points to the new section.
- No tool, action, governance key, preset row, refusal code or input field is added or changed, and no IRIS-side class changes. An epic gate test runs the four issue points through the built servers.
