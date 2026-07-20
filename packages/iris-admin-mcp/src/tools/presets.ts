/**
 * Tool visibility preset rosters for iris-admin-mcp (Epic 30, architecture
 * decision I2; Story 30.1). Transcribed EXACTLY from the product-owner-
 * approved spec §2.5 table (approved 2026-07-12 — "implement as written").
 *
 * `core` = the everyday admin loop (namespaces, databases, users, webapps,
 * permission checks) — 12 package tools = 13 runtime (+ `iris_server_profiles`).
 * `developer` = only what devs self-serve (namespace/db/mapping/webapp
 * config) — no user/security administration — 10 package tools.
 *
 * `include ∪ exclude` MUST equal the package's full 26-tool set for both
 * presets — enforced at `McpServerBase` construction by `assertPresetCoverage`
 * (see `index.ts`) and at test time by `presets.test.ts`.
 *
 * [Source: research/feature-specs/11-tool-visibility-presets.md#2.5 "iris-admin-mcp"]
 */

import type { ToolPresetRosters } from "@iris-mcp/shared";

/** admin-mcp's `core`/`developer` visibility rosters (§2.5). */
export const toolPresets: ToolPresetRosters = {
  core: {
    include: [
      "iris_namespace_manage",
      "iris_namespace_list",
      "iris_database_manage",
      "iris_database_list",
      "iris_user_manage",
      "iris_user_get",
      "iris_user_roles",
      "iris_user_password",
      "iris_role_list",
      "iris_permission_check",
      "iris_webapp_manage",
      "iris_webapp_list",
    ],
    exclude: [
      "iris_mapping_manage",
      "iris_mapping_list",
      "iris_role_manage",
      "iris_resource_manage",
      "iris_resource_list",
      "iris_webapp_get",
      "iris_ssl_manage",
      "iris_ssl_list",
      "iris_oauth_manage",
      "iris_oauth_list",
      "iris_service_manage",
      "iris_ldap_manage",
      "iris_x509_manage",
      "iris_audit_manage",
    ],
  },
  developer: {
    include: [
      "iris_namespace_manage",
      "iris_namespace_list",
      "iris_database_manage",
      "iris_database_list",
      "iris_mapping_manage",
      "iris_mapping_list",
      "iris_permission_check",
      "iris_webapp_manage",
      "iris_webapp_get",
      "iris_webapp_list",
    ],
    exclude: [
      "iris_user_manage",
      "iris_user_get",
      "iris_user_roles",
      "iris_user_password",
      "iris_role_manage",
      "iris_role_list",
      "iris_resource_manage",
      "iris_resource_list",
      "iris_ssl_manage",
      "iris_ssl_list",
      "iris_oauth_manage",
      "iris_oauth_list",
      "iris_service_manage",
      "iris_ldap_manage",
      "iris_x509_manage",
      "iris_audit_manage",
    ],
  },
};
