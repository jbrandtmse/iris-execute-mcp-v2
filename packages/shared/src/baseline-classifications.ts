// DO NOT hand-sync with governance-baseline.ts — the completeness test enforces
// exact key-set parity.
/**
 * Hand-curated read/write classification for every key in the FROZEN Epic-14
 * foundation baseline ({@link GOVERNANCE_BASELINE}, 141 keys, hash
 * `1e62c5ad5bf7`). New (post-foundation) tools carry their own `mutates`
 * metadata (see {@link ToolDefinition.mutates} in `tool-types.ts`), but the
 * 141 grandfathered baseline keys do NOT — they were enabled purely by
 * baseline *membership* (Rule #23), with no read/write class recorded until
 * now.
 *
 * This map fills exactly that gap so the Epic-24 `read-only` governance
 * preset (Story 24.1) can resolve a truthful verdict for every governance
 * key, not just the post-foundation ones. **This file has no consumer yet**
 * — Story 24.1's `presetSeed` is the first reader.
 *
 * Curation method (Story 24.0, AC 24.0.2): every key classified `write`
 * where IRIS state is created/modified/deleted or code is executed; every
 * key classified `read` only where it is a pure query. When in doubt,
 * `write` (fail-safe — a false `write` only over-restricts read-only mode,
 * a false `read` would let a mutation through it). Every `read` key whose
 * verb is not on the obvious-read allowlist (list/get/view/status/check/
 * history/listHistory/explain/stats/summary/info/find/search/adapters/
 * queues/messages/logs) carries an inline `// read: <why>` justification
 * comment; a few judgment-call `write` keys carry an explanatory comment
 * too, for reviewability. Classifications were cross-checked against each
 * tool's own MCP `annotations.readOnlyHint`/`destructiveHint` and, for the
 * OAuth2 discovery and password-validate cases, the underlying ObjectScript /
 * IRIS class source (`src/ExecuteMCPv2/REST/Security.cls` and the
 * `%SYS.OAuth2.Registration` system class).
 *
 * See [research/feature-specs/02-governance-presets.md] §2.1 for the spec
 * this file implements, and `.claude/rules/project-rules.md` Rule #20
 * (generated/enforced baseline over an existing capability) and Rule #23
 * (frozen foundation — this file must NEVER cause `governance-baseline.ts`
 * to be edited or regenerated).
 */

import type { MutationClass } from "./governance.js";

/**
 * Every frozen-baseline governance key mapped to its truthful read/write
 * classification. Key set MUST equal {@link GOVERNANCE_BASELINE} exactly —
 * enforced by `__tests__/baseline-classifications.test.ts`. Keys are sorted
 * to mirror `governance-baseline.ts` for reviewable diffs.
 */
export const BASELINE_ACTION_CLASSIFICATIONS: Record<string, MutationClass> = {
  "iris_alerts_manage:reset": "write",
  "iris_analytics_cubes:build": "write",
  "iris_analytics_cubes:list": "read",
  "iris_analytics_cubes:sync": "write",
  // read: executes a read-only MDX query against a DeepSee cube; the tool's
  // own annotations mark it readOnlyHint: true and it issues no cube mutation.
  "iris_analytics_mdx": "read",
  // read: queries audit log records; no mutation.
  "iris_audit_events": "read",
  // read: returns combined system info + config data (isReadOnly branch in
  // config.ts); writes nothing, unlike the 'set' action on the same tool.
  "iris_config_manage:export": "read",
  "iris_config_manage:get": "read",
  "iris_config_manage:set": "write",
  "iris_credential_list": "read",
  "iris_credential_manage:create": "write",
  "iris_credential_manage:delete": "write",
  "iris_credential_manage:update": "write",
  "iris_database_check": "read",
  "iris_database_list": "read",
  "iris_database_manage:create": "write",
  "iris_database_manage:delete": "write",
  "iris_database_manage:modify": "write",
  "iris_doc_compile": "write",
  // read: retrieves a document via Atelier GET with a `?format=` query param
  // (UDL<->XML view conversion); no document mutation.
  "iris_doc_convert": "read",
  "iris_doc_delete": "write",
  // write: bulk-downloads documents to a caller-specified local directory
  // (path-traversal-sensitive; the tool's own annotations mark it
  // readOnlyHint: false). No IRIS-state mutation occurs, but the local-disk
  // write surface is treated conservatively per the fail-safe rule.
  "iris_doc_export": "write",
  "iris_doc_get": "read",
  // read: retrieves class structure (methods/properties/parameters) via the
  // Atelier index action; annotations mark it readOnlyHint: true.
  "iris_doc_index": "read",
  "iris_doc_list": "read",
  "iris_doc_load": "write",
  "iris_doc_put": "write",
  "iris_doc_search": "read",
  // read: packages the requested documents as XML and returns them in the
  // response; no document mutation (contrast with the 'import' action below).
  "iris_doc_xml_export:export": "read",
  "iris_doc_xml_export:import": "write",
  "iris_doc_xml_export:list": "read",
  "iris_docdb_document:delete": "write",
  "iris_docdb_document:get": "read",
  "iris_docdb_document:insert": "write",
  "iris_docdb_document:update": "write",
  "iris_docdb_find": "read",
  "iris_docdb_manage:create": "write",
  "iris_docdb_manage:drop": "write",
  "iris_docdb_manage:list": "read",
  "iris_docdb_property:create": "write",
  "iris_docdb_property:drop": "write",
  "iris_docdb_property:index": "write",
  "iris_ecp_status": "read",
  "iris_execute_classmethod": "write",
  "iris_execute_command": "write",
  // write: runs real ObjectScript unit-test methods (setup/teardown code can
  // mutate IRIS state) via the Atelier async work queue — this is code
  // execution, not a dry run.
  "iris_execute_tests": "write",
  "iris_global_get": "read",
  "iris_global_kill": "write",
  "iris_global_list": "read",
  "iris_global_set": "write",
  "iris_interop_rest:create": "write",
  "iris_interop_rest:delete": "write",
  "iris_interop_rest:get": "read",
  "iris_jobs_list": "read",
  "iris_journal_info": "read",
  "iris_license_info": "read",
  "iris_locks_list": "read",
  "iris_lookup_manage:delete": "write",
  "iris_lookup_manage:get": "read",
  "iris_lookup_manage:set": "write",
  // read: returns the lookup table as XML in the response; no table mutation
  // (contrast with the 'import' action below).
  "iris_lookup_transfer:export": "read",
  "iris_lookup_transfer:import": "write",
  "iris_macro_info": "read",
  "iris_mapping_list": "read",
  "iris_mapping_manage:create": "write",
  "iris_mapping_manage:delete": "write",
  // read: queries active alert state; no mutation.
  "iris_metrics_alerts": "read",
  // read: queries interoperability metrics; no mutation.
  "iris_metrics_interop": "read",
  // read: queries system metrics; no mutation.
  "iris_metrics_system": "read",
  "iris_mirror_status": "read",
  "iris_namespace_list": "read",
  "iris_namespace_manage:create": "write",
  "iris_namespace_manage:delete": "write",
  "iris_namespace_manage:modify": "write",
  "iris_oauth_list": "read",
  "iris_oauth_manage:create": "write",
  "iris_oauth_manage:delete": "write",
  // write: `%SYS.OAuth2.Registration.Discover()` PERSISTS server metadata — it
  // opens (or %New's) an OAuth2.ServerDefinition for the issuer and, inside a
  // committed Tstart/Tcommit transaction, %DeleteId's the existing metadata row
  // and calls RefreshJWKS (irislib/%SYS/OAuth2/Registration.cls:11 class-doc
  // "The Discover method saves the server metadata"; body lines 33-51). The
  // mutation happens IRIS-side on any successful re-discover regardless of how
  // the REST handler captures the output. Fail-safe write per AC 24.0.2 — a
  // false read would let this run under the read-only preset.
  // (CR 24.0: corrected from an earlier `read` classification that verified only
  // the REST wrapper, not the persisting IRIS system method.)
  "iris_oauth_manage:discover": "write",
  "iris_package_list": "read",
  "iris_permission_check": "read",
  "iris_production_adapters": "read",
  "iris_production_autostart:get": "read",
  "iris_production_autostart:set": "write",
  "iris_production_control:recover": "write",
  "iris_production_control:restart": "write",
  "iris_production_control:start": "write",
  "iris_production_control:stop": "write",
  "iris_production_control:update": "write",
  "iris_production_item:disable": "write",
  "iris_production_item:enable": "write",
  "iris_production_item:get": "read",
  "iris_production_item:set": "write",
  "iris_production_logs": "read",
  "iris_production_manage:create": "write",
  "iris_production_manage:delete": "write",
  "iris_production_messages": "read",
  "iris_production_queues": "read",
  "iris_production_status": "read",
  "iris_production_summary": "read",
  "iris_resource_list": "read",
  "iris_resource_manage:create": "write",
  "iris_resource_manage:delete": "write",
  "iris_resource_manage:modify": "write",
  "iris_rest_manage:delete": "write",
  "iris_rest_manage:get": "read",
  "iris_rest_manage:list": "read",
  "iris_role_list": "read",
  "iris_role_manage:create": "write",
  "iris_role_manage:delete": "write",
  "iris_role_manage:modify": "write",
  // read: fetches a document/routine's compiled intermediate representation
  // via Atelier GET; no mutation.
  "iris_routine_intermediate": "read",
  "iris_rule_get": "read",
  "iris_rule_list": "read",
  "iris_server_info": "read",
  // read: retrieves namespace details (databases, enabled features) via
  // Atelier GET; annotations mark it readOnlyHint: true.
  "iris_server_namespace": "read",
  // write: SELECT-only is NOT guaranteed — the tool accepts arbitrary SQL and
  // its own annotations mark it readOnlyHint: false (DML/DDL is possible).
  // Fail-safe classification per AC 24.0.2's explicit instruction to flag
  // this key.
  "iris_sql_execute": "write",
  "iris_ssl_list": "read",
  "iris_ssl_manage:create": "write",
  "iris_ssl_manage:delete": "write",
  "iris_ssl_manage:modify": "write",
  "iris_task_history": "read",
  "iris_task_list": "read",
  "iris_task_manage:create": "write",
  "iris_task_manage:delete": "write",
  "iris_task_manage:modify": "write",
  "iris_task_run": "write",
  "iris_transform_list": "read",
  // write: executes the caller-named compiled DTL `Transform()` method
  // (src/ExecuteMCPv2/REST/Interop.cls — `$ClassMethod(class, "Transform", ...)`).
  // A DTL may embed `<code>`/`<sql>`/`<assign>` with side effects, so this is
  // arbitrary code execution, not a guaranteed pure dry-run; the tool's own
  // annotations mark it `readOnlyHint: false`. Fail-safe write per AC 24.0.2 —
  // parallels `iris_execute_tests`/`iris_execute_classmethod` (also code
  // execution → write). NOTE: this DIVERGES from AC 24.0.2's "test (read-only
  // dry-run)" example, which incorrectly assumes DTL test is side-effect-free;
  // flagged in code review (CR 24.0) as a spec correction for lead ratification.
  "iris_transform_test": "write",
  "iris_user_get": "read",
  "iris_user_manage:create": "write",
  "iris_user_manage:delete": "write",
  "iris_user_manage:modify": "write",
  "iris_user_password:change": "write",
  // read: calls `$SYSTEM.Security.ValidatePassword()` against the active
  // password policy and returns pass/fail + policy metadata; never persists
  // or changes the candidate password (verified against
  // src/ExecuteMCPv2/REST/Security.cls:500-543).
  "iris_user_password:validate": "read",
  "iris_user_roles:add": "write",
  "iris_user_roles:remove": "write",
  "iris_webapp_get": "read",
  "iris_webapp_list": "read",
  "iris_webapp_manage:create": "write",
  "iris_webapp_manage:delete": "write",
  "iris_webapp_manage:modify": "write",
};
