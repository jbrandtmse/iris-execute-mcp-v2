/**
 * The Epic-30 pre-feature tool-name snapshot (Story 30.0, AC 30.0.4) —
 * extracted from `tool-visibility-backcompat.test.ts` into a plain data
 * module (Story 32.3, deferred item 30-0-3) so the SAME literal drives both:
 *
 *   1. the shared package's Rule #19 back-compat capstone
 *      (`tool-visibility-backcompat.test.ts` — proves the visibility filter
 *      is a no-op under empty env across five differently-sized tool sets),
 *      and
 *   2. the cross-package drift gate in `@iris-mcp/all`
 *      (`tool-visibility-snapshot-drift.test.ts` — proves this snapshot
 *      deep-equals each package's LIVE built-dist `tools` array, so the
 *      snapshot can never silently drift from the source it transcribes).
 *
 * Provenance: transcribed verbatim from the product-owner-approved spec
 * table (`research/feature-specs/11-tool-visibility-presets.md` §2.5, dated
 * 2026-07-12). Counts cross-checked against each package's own
 * `index.test.ts`: dev 28, admin 26, interop 22, ops 21, data 7. The
 * drift gate above is what makes this transcription SOURCE-DERIVED rather
 * than trusted (Rule #36): a package adding/removing/renaming a tool
 * without updating this module fails `@iris-mcp/all`'s default suite.
 */
export const PRE_FEATURE_SNAPSHOTS: Record<string, string[]> = {
  "iris-dev-mcp": [
    "iris_doc_get",
    "iris_doc_put",
    "iris_doc_delete",
    "iris_doc_list",
    "iris_doc_compile",
    "iris_doc_index",
    "iris_doc_search",
    "iris_macro_info",
    "iris_doc_convert",
    "iris_doc_xml_export",
    "iris_sql_execute",
    "iris_sql_analyze",
    "iris_server_info",
    "iris_server_namespace",
    "iris_global_get",
    "iris_global_set",
    "iris_global_kill",
    "iris_global_list",
    "iris_execute_command",
    "iris_execute_classmethod",
    "iris_execute_tests",
    "iris_doc_load",
    "iris_doc_export",
    "iris_package_list",
    "iris_routine_intermediate",
    "iris_loc_count",
    "iris_env_diff",
    "iris_env_promote",
  ],
  "iris-admin-mcp": [
    "iris_namespace_manage",
    "iris_namespace_list",
    "iris_database_manage",
    "iris_database_list",
    "iris_mapping_manage",
    "iris_mapping_list",
    "iris_user_manage",
    "iris_user_get",
    "iris_user_roles",
    "iris_user_password",
    "iris_role_manage",
    "iris_role_list",
    "iris_resource_manage",
    "iris_resource_list",
    "iris_permission_check",
    "iris_webapp_manage",
    "iris_webapp_get",
    "iris_webapp_list",
    "iris_ssl_manage",
    "iris_ssl_list",
    "iris_oauth_manage",
    "iris_oauth_list",
    "iris_service_manage",
    "iris_ldap_manage",
    "iris_x509_manage",
    "iris_audit_manage",
  ],
  "iris-interop-mcp": [
    "iris_production_manage",
    "iris_production_control",
    "iris_production_status",
    "iris_production_summary",
    "iris_production_item",
    "iris_production_autostart",
    "iris_production_logs",
    "iris_production_queues",
    "iris_production_messages",
    "iris_production_adapters",
    "iris_credential_manage",
    "iris_credential_list",
    "iris_lookup_manage",
    "iris_lookup_transfer",
    "iris_rule_list",
    "iris_rule_get",
    "iris_transform_list",
    "iris_transform_test",
    "iris_interop_rest",
    "iris_default_settings_manage",
    "iris_message_diagram",
    "iris_message_resend",
  ],
  "iris-ops-mcp": [
    "iris_metrics_system",
    "iris_metrics_alerts",
    "iris_metrics_interop",
    "iris_alerts_manage",
    "iris_jobs_list",
    "iris_locks_list",
    "iris_process_manage",
    "iris_journal_info",
    "iris_mirror_status",
    "iris_audit_events",
    "iris_database_check",
    "iris_database_action",
    "iris_backup_manage",
    "iris_license_info",
    "iris_ecp_status",
    "iris_task_manage",
    "iris_task_list",
    "iris_task_run",
    "iris_task_history",
    "iris_config_manage",
    "iris_health_check",
  ],
  "iris-data-mcp": [
    "iris_docdb_manage",
    "iris_docdb_document",
    "iris_docdb_find",
    "iris_docdb_property",
    "iris_analytics_mdx",
    "iris_analytics_cubes",
    "iris_rest_manage",
  ],
};
