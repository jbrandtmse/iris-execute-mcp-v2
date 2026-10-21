---
"@iris-mcp/shared": patch
"@iris-mcp/dev": patch
"@iris-mcp/admin": patch
"@iris-mcp/interop": patch
"@iris-mcp/ops": patch
---

fix: correct three tool-surface truths before 1.0 (Story 42.10)

- DW-560: 13 existing tools now declare `destructiveHint: true`, because each can delete or irreversibly overwrite state: `iris_doc_put`, `iris_sql_execute`, `iris_global_set`, `iris_execute_command`, `iris_execute_classmethod`, `iris_doc_load`, `iris_doc_export`, `iris_env_promote`, `iris_service_manage`, `iris_ldap_manage`, `iris_x509_manage`, `iris_production_item` and `iris_task_run`. Their other hints, names, schemas, governance keys and classifications are unchanged. A client that honors `destructiveHint` may now ask for approval before these calls, including six tools of the dev `core` preset (`iris_doc_put`, `iris_doc_load`, `iris_sql_execute`, `iris_execute_command`, `iris_execute_classmethod` and `iris_global_set`).
- DW-662: the `iris_message_resend` description and its `maxMessages` and `confirm` texts now say that `dryRun: false` without `confirm: true` is refused (a preview without `confirm` is not), that leaving out `dryRun` previews, and that an executing call over the `maxMessages` cap is refused while a preview reports the full count. The tool's behavior is unchanged.
- DW-654: the audit entry of a `SYS`-scoped tool records `namespace: "%SYS"`, where it recorded the call's `namespace` argument or the profile's default; when the call has a non-empty `namespace` argument, the new additive field `targetNamespace` records it, whatever `IRIS_AUDIT_LOG_PARAMS` says (DW-667). The entries of `NS`, `BOTH` and `NONE` tools are unchanged and never carry `targetNamespace`.

The two frozen SDK goldens stay byte-unchanged: each corrected value is one entry of the sanctioned-change ledger. No tool, action, governance key, preset row, input-schema key or ObjectScript class is added or changed, and the governance baseline stays `1e62c5ad5bf7` (141 keys).
