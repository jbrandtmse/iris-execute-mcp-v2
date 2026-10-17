/**
 * Tool visibility preset rosters for iris-interop-mcp (Epic 30, architecture
 * decision I2; Story 30.1). Transcribed EXACTLY from the product-owner-
 * approved spec §2.5 table (approved 2026-07-12 — "implement as written").
 *
 * `core` = the troubleshoot-a-production loop: status/summary/control, item
 * config, logs/queues/messages, message search, trace diagram, resend.
 * `iris_production_control` keeps the MCP-instructions `recover` guidance
 * intact under every preset. `iris_message_search` (Story 39.1) joins `core`
 * as the entry of the everyday forensic loop (search, read, diagram): it is a
 * read, and the way to find messages while resend stays disabled.
 * `iris_message_body` (Story 39.5) joins it as the read step of that loop and is
 * declared with it in `TOOL_PAIRS`, so the two stay co-visible: reading what a
 * found message carried is the next call of every forensic session (L-4, AD-7).
 * `core` is 11 package tools = 12 runtime (+ `iris_server_profiles`), inside the
 * ~13 guideline, and no existing `core` row moved.
 * `developer` = the full 24-tool interop server (all interop tools are
 * dev-relevant).
 *
 * `include` plus `exclude` MUST equal the package's full 24-tool set for both
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
      "iris_message_search",
      "iris_message_body",
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
      "iris_message_search",
      "iris_message_body",
    ],
    exclude: [],
  },
};
