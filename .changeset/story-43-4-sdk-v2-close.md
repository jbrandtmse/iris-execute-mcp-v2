---
"@iris-mcp/shared": patch
"@iris-mcp/client-config": patch
"@iris-mcp/dev": patch
"@iris-mcp/admin": patch
"@iris-mcp/interop": patch
"@iris-mcp/ops": patch
"@iris-mcp/data": patch
---

feat: close Epic 43 (the MCP SDK v2 migration) with descriptions, a deduplicated governance resource, a corrected prompt, a capstone gate and the client docs (Story 43.4)

The descriptions of `iris_audit_manage`, `iris_env_promote`, `iris_production_control`, `iris_message_resend` and `iris_doc_edit` each gain one appended passage that names the confirmation dialog shown to a client that declares form elicitation, says that a decline or a dismissal returns `CONFIRMATION_DECLINED` with nothing changed, tells the agent not to repeat the call unless the person asks, and says that a client without elicitation is not asked; no existing description byte changes. `resources/list` now lists `iris-governance://default` once, because the per-profile resource template no longer lists the `default` profile that the static resource already names (DW-646). Steps 3 and 4 of the `resend-failed-messages` prompt now say that the executing call, not the preview, is refused over `maxMessages`, and that leaving `dryRun` out only previews again (DW-653); the prompt's name, title, description and arguments are unchanged, and the generated skill and the skills pack in `@iris-mcp/client-config` are regenerated.

The two frozen SDK v1 goldens stay byte-unchanged; each sanctioned change to bytes they hold is an entry of a ledger that the golden tests apply (DW-639). A default-suite capstone drives the built admin server through the real SDK client on `legacy`, a pinned `2026-07-28` and `auto`. The root README, `docs/client-config/README.md` and `docs/client-config/claude-code.md` document the protocol revisions, `MCP_PROTOCOL_NEGOTIATION=legacy`, the probe copy that an SDK v2 client starts (DW-641) and the dialog, as observed on Claude Code 2.1.296 and MCP Inspector CLI 2.9.0. No tool, action, governance key, preset row, annotation, refusal code or environment variable is added, and the suite stays at 115 tools with the governance baseline and `BOOTSTRAP_VERSION` unmoved.
