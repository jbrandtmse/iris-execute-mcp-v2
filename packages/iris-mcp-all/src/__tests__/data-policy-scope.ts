/**
 * The PHI data policy's scope (Story 39.2; AD-26): which tool of the suite the policy governs, which tools
 * can still return message-body data outside it, and which cannot, exhaustive as of
 * {@link DATA_POLICY_SCOPE_DATE}.
 *
 *  - `governed`: the tool declares `ToolDefinition.dataPolicy`, and the policy applies to the actions listed.
 *  - `residual`: the tool can return body or body-derived text and is not under the policy. An operator
 *    restricts it through its governance key (`IRIS_GOVERNANCE`, `IRIS_GOVERNANCE_FILE`) or tool visibility.
 *  - `notApplicable`: the tool returns no body or body-derived text.
 *
 * One row per tool name of the suite, the framework's `iris_server_profiles` included. A new tool adds its
 * row in the story that adds it, and `data-policy-scope.test.ts` fails until it does (Rule #56).
 * `tool_support.md` carries the same governed and residual rows for readers.
 */

/** The date the classification is exhaustive as of. */
export const DATA_POLICY_SCOPE_DATE = "2026-10-16";

export type DataPolicyScope = "governed" | "residual" | "notApplicable";

export interface DataPolicyScopeRow {
  scope: DataPolicyScope;
  /** For a governed row: the actions the policy governs (`ToolDefinition.dataPolicy.actions`). */
  governedActions?: readonly string[];
  /** One line: why the tool has this scope. */
  reason: string;
}

const residual = (reason: string): DataPolicyScopeRow => ({ scope: "residual", reason });

/** Rows for tools that share one reason. */
function notApplicable(reason: string, names: readonly string[]): Array<[string, DataPolicyScopeRow]> {
  return names.map((name) => [name, { scope: "notApplicable", reason }]);
}

export const DATA_POLICY_SCOPE: Readonly<Record<string, DataPolicyScopeRow>> = Object.fromEntries([
  [
    "iris_message_resend",
    {
      scope: "governed",
      governedActions: ["preview"],
      reason: "The preview's body summary is the one body-derived output; resend and resendFiltered return status texts only.",
    },
  ],

  ["iris_sql_execute", residual("Runs caller-supplied SQL, which can select message-body columns. Restrict it with its governance key or IRIS_SQL_READ_ONLY.")],
  ["iris_sql_query", residual("Runs caller-supplied SELECTs, which can select message-body columns. Restrict it with its governance key.")],
  ["iris_sql_analyze", residual("Returns plans and statistics for caller-supplied SQL, which can echo literals. Restrict it with its governance key.")],
  ["iris_global_get", residual("Reads any global node, message bodies included. Restrict it with its governance key.")],
  ["iris_execute_command", residual("Runs caller code whose output is unrestricted. Restrict it with its governance key.")],
  ["iris_execute_classmethod", residual("Calls any class method, whose result and output are unrestricted. Restrict it with its governance key.")],
  ["iris_execute_tests", residual("Returns the text of unit-test results, which can quote data. Restrict it with its governance key.")],
  ["iris_test_status", residual("Returns the text of unit-test results, which can quote data. Restrict it with its governance key.")],
  ["iris_doc_get", residual("Returns the source of a document, which can hold message text. Restrict it with its governance key.")],
  ["iris_doc_search", residual("Returns matching lines of document source, which can hold message text. Restrict it with its governance key.")],
  ["iris_doc_convert", residual("Returns document source, which can hold message text. Restrict it with its governance key.")],
  ["iris_doc_xml_export", residual("Returns document source as XML, which can hold message text. Restrict it with its governance key.")],
  ["iris_doc_export", residual("Writes document source to local files, which can hold message text. Restrict it with its governance key.")],
  ["iris_doc_edit", residual("Returns a unified diff and numbered excerpts of the edited document, which can hold message text. Restrict it with its governance key.")],
  ["iris_routine_intermediate", residual("Returns the compiled intermediate code of a routine, which can hold message text. Restrict it with its governance key.")],
  ["iris_lookup_manage", residual("Returns and sets lookup table values, which can hold identifying data. Restrict it with its governance key.")],
  ["iris_lookup_transfer", residual("Exports whole lookup tables, values included. Restrict it with its governance key.")],
  [
    "iris_production_messages",
    residual("Returns header columns; for a header with no body class the body ID is the literal body value. Restrict it with its governance key."),
  ],
  [
    "iris_message_search",
    residual(
      "The headers action returns header columns, and for a header with no body class the body ID is the literal body value; the body and searchTable actions arrive in Stories 39.3 and 39.4 and are governed from then on. Restrict it with its governance key.",
    ),
  ],
  ["iris_env_diff", residual("Compares configuration values across profiles, lookup values included. Restrict it with its governance key.")],
  ["iris_env_promote", residual("Copies configuration values across profiles, lookup values included. Restrict it with its governance key.")],
  [
    "iris_production_logs",
    residual("The Event Log text of an adapter or a parser can carry segment text. Restrict it with its governance key."),
  ],
  [
    "iris_message_diagram",
    residual("A header's sanitized ErrorStatus, which parser errors fill with segment text, appears in the diagram. Restrict it with its governance key."),
  ],
  ["iris_transform_test", residual("Returns the output of a transformation run on a caller-supplied message. Restrict it with its governance key.")],
  ["iris_docdb_document", residual("Returns the content of DocDB documents. Restrict it with its governance key.")],
  ["iris_docdb_find", residual("Returns the content of DocDB documents that match. Restrict it with its governance key.")],
  ["iris_analytics_mdx", residual("Returns the result data of an MDX query. Restrict it with its governance key.")],
  ["iris_audit_manage", residual("Returns audit configuration and event data, whose descriptions can carry request text. Restrict it with its governance key.")],
  ["iris_audit_events", residual("Returns audit events, whose descriptions can carry request text. Restrict it with its governance key.")],

  ...notApplicable("Returns metadata of documents, routines, packages or the server, or changes a document or global without returning its content.", [
    "iris_doc_put",
    "iris_doc_delete",
    "iris_doc_list",
    "iris_doc_compile",
    "iris_doc_index",
    "iris_doc_load",
    "iris_macro_info",
    "iris_server_info",
    "iris_server_namespace",
    "iris_global_set",
    "iris_global_kill",
    "iris_global_list",
    "iris_package_list",
    "iris_loc_count",
  ]),
  ...notApplicable("Administers namespaces, databases, mappings, users, roles, resources, web applications, SSL and OAuth configuration, and services; returns configuration records, never message data.", [
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
  ]),
  ...notApplicable("Manages or reports productions, items, queues, credentials, rules, transforms and settings; returns configuration and counts, never body or body-derived text.", [
    "iris_production_manage",
    "iris_production_control",
    "iris_production_status",
    "iris_production_summary",
    "iris_production_item",
    "iris_production_autostart",
    "iris_production_queues",
    "iris_production_adapters",
    "iris_credential_manage",
    "iris_credential_list",
    "iris_rule_list",
    "iris_rule_get",
    "iris_transform_list",
    "iris_interop_rest",
    "iris_default_settings_manage",
  ]),
  ...notApplicable("Reports metrics, jobs, locks, journals, mirrors, licenses, tasks, backups and configuration of the instance, never message data.", [
    "iris_metrics_system",
    "iris_metrics_alerts",
    "iris_metrics_interop",
    "iris_alerts_manage",
    "iris_jobs_list",
    "iris_locks_list",
    "iris_process_manage",
    "iris_journal_info",
    "iris_mirror_status",
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
  ]),
  ...notApplicable("Manages DocDB structure, analytics cubes or REST applications, and returns definitions, never record or message data.", [
    "iris_docdb_manage",
    "iris_docdb_property",
    "iris_analytics_cubes",
    "iris_rest_manage",
  ]),
  ...notApplicable("The framework's discovery tool reports profile metadata and the governance policy only.", ["iris_server_profiles"]),
] as Array<[string, DataPolicyScopeRow]>);
