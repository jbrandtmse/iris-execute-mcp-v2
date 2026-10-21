---
"@iris-mcp/shared": patch
"@iris-mcp/dev": patch
"@iris-mcp/admin": patch
"@iris-mcp/interop": patch
"@iris-mcp/ops": patch
"@iris-mcp/data": patch
---

feat: ask the person to confirm the destructive gates through elicitation (Story 43.3)

When the calling MCP client declares form elicitation, six gates show a confirmation form right before their first IRIS write: `iris_audit_manage` `purge`, `iris_env_promote` `execute`, `iris_production_control` `clean` with `killAppData: true`, `iris_message_resend` `resendFiltered` (to execute) and `resend`, and `iris_doc_edit` `regenerateStorage`. The dialog comes after every check of the tool and never replaces `confirm: true`. A decline, a dismissal or an accept without the tick ends the call with the new refusal code `CONFIRMATION_DECLINED` and changes nothing; the confirmation is bound to the tool, the server profile and the exact arguments, and can be used once. A client that does not declare form elicitation gets exactly the previous contract, and the 2025-11-25 wire is unchanged for it. No tool, action, governance key, preset row, annotation, description or environment variable is added or changed, and the suite stays at 115 tools with the governance baseline and `BOOTSTRAP_VERSION` unmoved.

The audit entry gains the additive field `confirmation` (`accepted`, `declined`, `cancelled`, `unconfirmed` or `unanswered`); a decline is `denied` with `denyReason` `CONFIRMATION_DECLINED`. A call the client cancels now aborts the IRIS request it has in flight and is audited `error` instead of `ok` (`RequestOptions.signal`, `IrisConnectionError` code `CANCELLED`). A Claude Code `Elicitation` hook can answer the dialog for the person; installing one that does is the user's choice and removes the person from the loop. The SDK's bundled validator carries fast-uri 3.1.0, whose advisories are unreachable here because the server never invokes the validator (DW-637).
