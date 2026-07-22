/**
 * Tool visibility preset rosters for iris-ops-mcp (Epic 30, architecture
 * decision I2; Story 30.1). Transcribed EXACTLY from the product-owner-
 * approved spec §2.5 table (approved 2026-07-12 — "implement as written").
 *
 * `core` = monitoring-persona basics (health, system metrics, alert metrics,
 * jobs/locks/processes, tasks, license). `developer` = the runtime debugging
 * slice (interop metrics + task history for their own scheduled jobs; no
 * backup/mirror/ECP/config surface). Both are 9 package tools = 10 runtime
 * (+ `iris_server_profiles`).
 *
 * `include ∪ exclude` MUST equal the package's full 21-tool set for both
 * presets — enforced at `McpServerBase` construction by `assertPresetCoverage`
 * (see `index.ts`) and at test time by `presets.test.ts`.
 *
 * [Source: research/feature-specs/11-tool-visibility-presets.md#2.5 "iris-ops-mcp"]
 */

import type { ToolPresetRosters } from "@iris-mcp/shared";

/** ops-mcp's `core`/`developer` visibility rosters (§2.5). */
export const toolPresets: ToolPresetRosters = {
  core: {
    include: [
      "iris_metrics_system",
      "iris_metrics_alerts",
      "iris_jobs_list",
      "iris_locks_list",
      "iris_process_manage",
      "iris_license_info",
      "iris_task_list",
      "iris_task_run",
      "iris_health_check",
    ],
    exclude: [
      "iris_metrics_interop",
      "iris_alerts_manage",
      "iris_journal_info",
      "iris_mirror_status",
      "iris_audit_events",
      "iris_database_check",
      "iris_database_action",
      "iris_backup_manage",
      "iris_ecp_status",
      "iris_task_manage",
      "iris_task_history",
      "iris_config_manage",
    ],
  },
  developer: {
    include: [
      "iris_metrics_system",
      "iris_metrics_interop",
      "iris_jobs_list",
      "iris_locks_list",
      "iris_process_manage",
      "iris_task_list",
      "iris_task_run",
      "iris_task_history",
      "iris_health_check",
    ],
    exclude: [
      "iris_metrics_alerts",
      "iris_alerts_manage",
      "iris_journal_info",
      "iris_mirror_status",
      "iris_audit_events",
      "iris_database_check",
      "iris_database_action",
      "iris_backup_manage",
      "iris_license_info",
      "iris_ecp_status",
      "iris_task_manage",
      "iris_config_manage",
    ],
  },
};
