/**
 * Tool visibility preset rosters for iris-interop-mcp (Epic 30, architecture
 * decision I2; Story 30.1). Transcribed EXACTLY from the product-owner-
 * approved spec §2.5 table (approved 2026-07-12 — "implement as written").
 *
 * `core` = the troubleshoot-a-production loop: status/summary/control, item
 * config, logs/queues/messages, trace diagram, resend. `iris_production_control`
 * keeps the MCP-instructions `recover` guidance intact under every preset.
 * 9 package tools = 10 runtime (+ `iris_server_profiles`).
 * `developer` = the full 22-tool interop server (all interop tools are
 * dev-relevant).
 *
 * `include ∪ exclude` MUST equal the package's full 22-tool set for both
 * presets — enforced at `McpServerBase` construction by `assertPresetCoverage`
 * (see `index.ts`) and at test time by `presets.test.ts`.
 *
 * [Source: research/feature-specs/11-tool-visibility-presets.md#2.5 "iris-interop-mcp"]
 */

import type { ToolPresetRosters } from "@iris-mcp/shared";

/** interop-mcp's `core`/`developer` visibility rosters (§2.5). */
export const toolPresets: ToolPresetRosters = {
  core: {
    include: [
      "iris_production_control",
      "iris_production_status",
      "iris_production_summary",
      "iris_production_item",
      "iris_production_logs",
      "iris_production_queues",
      "iris_production_messages",
      "iris_message_diagram",
      "iris_message_resend",
    ],
    exclude: [
      "iris_production_manage",
      "iris_production_autostart",
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
    ],
  },
  developer: {
    include: [
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
    exclude: [],
  },
};
