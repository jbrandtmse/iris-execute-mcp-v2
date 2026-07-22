/**
 * Tool visibility preset rosters for iris-dev-mcp (Epic 30, architecture
 * decision I2; Story 30.1). Transcribed EXACTLY from the product-owner-
 * approved spec §2.5 table (approved 2026-07-12 — "implement as written").
 *
 * `core` = the authoring loop (get/put/list/compile/load) + execution &
 * debug loop (command/classmethod/tests, global get/set/kill — kill stays
 * because the documented `^ClineDebug` debug pattern ends with a cleanup
 * kill) + SQL execute. 12 package tools = 13 runtime (+ `iris_server_profiles`).
 * `developer` = the full 28-tool dev server (all dev tools are dev-relevant).
 *
 * `include ∪ exclude` MUST equal the package's full 28-tool set for both
 * presets — enforced at `McpServerBase` construction by `assertPresetCoverage`
 * (see `index.ts`) and at test time by `presets.test.ts`.
 *
 * [Source: research/feature-specs/11-tool-visibility-presets.md#2.5 "iris-dev-mcp"]
 */

import type { ToolPresetRosters } from "@iris-mcp/shared";

/** dev-mcp's `core`/`developer` visibility rosters (§2.5). */
export const toolPresets: ToolPresetRosters = {
  core: {
    include: [
      "iris_doc_get",
      "iris_doc_put",
      "iris_doc_list",
      "iris_doc_compile",
      "iris_sql_execute",
      "iris_global_get",
      "iris_global_set",
      "iris_global_kill",
      "iris_execute_command",
      "iris_execute_classmethod",
      "iris_execute_tests",
      "iris_doc_load",
    ],
    exclude: [
      "iris_doc_delete",
      "iris_doc_index",
      "iris_doc_search",
      "iris_macro_info",
      "iris_doc_convert",
      "iris_doc_xml_export",
      "iris_sql_analyze",
      "iris_server_info",
      "iris_server_namespace",
      "iris_global_list",
      "iris_doc_export",
      "iris_package_list",
      "iris_routine_intermediate",
      "iris_loc_count",
      "iris_env_diff",
      "iris_env_promote",
    ],
  },
  developer: {
    include: [
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
    exclude: [],
  },
};
