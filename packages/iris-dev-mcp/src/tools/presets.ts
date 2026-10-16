/**
 * Tool visibility preset rosters for iris-dev-mcp (Epic 30, architecture
 * decision I2; Story 30.1). Transcribed from the product-owner-approved spec
 * section 2.5 table (approved 2026-07-12), extended by the stories named below.
 *
 * `core` = the authoring loop (get/edit/put/list/compile/load) + execution &
 * debug loop (command/classmethod/tests, global get/set/kill — kill stays
 * because the documented `^ClineDebug` debug pattern ends with a cleanup
 * kill) + SQL execute and SQL query. 14 package tools = 15 runtime (+ `iris_server_profiles`).
 * The target of about 13 runtime tools is a guideline, not a hard limit (L-4,
 * Project Lead decision 2026-10-14; AD-7).
 * `developer` = the full 31-tool dev server (all dev tools are dev-relevant).
 *
 * `include union exclude` MUST equal the package's full 31-tool set for both
 * presets — enforced at `McpServerBase` construction by `assertPresetCoverage`
 * (see `index.ts`) and at test time by `presets.test.ts`.
 *
 * `iris_sql_query` (Story 38.5): `core` and `developer` include. Querying is part
 * of the everyday debug loop, and under the `read-only` governance preset
 * `iris_sql_execute` is blocked, so a `core` setup would otherwise have no way to
 * query at all. It has no `TOOL_PAIRS` entry.
 *
 * `iris_doc_edit` (Story 38.4): `core` and `developer` include. It is in the
 * everyday authoring loop (a ranged `iris_doc_get`, then an edit, then
 * `iris_doc_compile`) and replaces whole-document `iris_doc_put` rewrites. It is
 * in `TOOL_PAIRS` with `iris_doc_get`, so the two stay co-visible.
 *
 * `iris_test_status` (Story 36.2, Lead decision L-2, 2026-09-10): `developer`
 * include / `core` exclude: the manual re-attach route (`iris_global_get` +
 * `iris_sql_execute`, named in `iris_execute_tests`' `hint`) already works in
 * `core` today. NOT in `TOOL_PAIRS` - pairing it with `iris_execute_tests`
 * would force it into `core` too.
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
      "iris_doc_edit",
      "iris_sql_query",
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
      "iris_test_status",
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
      "iris_test_status",
      "iris_doc_edit",
      "iris_sql_query",
    ],
    exclude: [],
  },
};
