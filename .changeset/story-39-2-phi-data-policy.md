---
"@iris-mcp/shared": minor
"@iris-mcp/interop": minor
---

feat(interop): PHI data policy over the message resend preview (Story 39.2)

A per-profile `dataPolicy` (`block`, `redact` or `allow`, default `redact`) is set by the `dataPolicy` field of an `IRIS_PROFILES` entry, the new `IRIS_DATA_POLICY` variable, or the `dataPolicy` section of the governance file, and is reported by `iris_server_profiles`. Under the default, the `iris_message_resend` preview no longer shows the first ~1 KB of a stream body: an HL7 v2 body keeps its class-name note and every other body is withheld with a reason (`IRIS_DATA_POLICY=allow` restores the previous output exactly). `@iris-mcp/shared` also gains the HL7 v2 redaction engine, the `DATA_POLICY_BLOCKED` refusal code, `ToolDefinition.dataPolicy` and the audit entry's `dataPolicy` field. `BOOTSTRAP_VERSION` moves `6dcdd238c792` to `d440a659ba1e`.
