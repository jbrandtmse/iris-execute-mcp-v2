/**
 * Story 30.0 — AC 30.0.4: Rule #19 back-compat capstone (DEFAULT suite).
 *
 * "With no visibility env vars set, each of the 5 servers' registered
 * tool-name set deep-equals its pre-feature snapshot." This is the epic's
 * release gate (Rule #19): the tool-visibility filter added to the
 * `McpServerBase` constructor (`server-base.ts`, Epic 30, architecture
 * decision I1) must be a PURE NO-OP when no `IRIS_TOOLS_*` env var is set —
 * every tool a server registers today must still be registered tomorrow.
 *
 * **Why this lives here, and what it constructs.** `@iris-mcp/shared` cannot
 * depend on any of the five leaf server packages (`iris-dev-mcp`,
 * `iris-admin-mcp`, `iris-interop-mcp`, `iris-ops-mcp`, `iris-data-mcp`) —
 * every one of them already depends on `@iris-mcp/shared`, so the reverse
 * edge would be a real circular workspace dependency (Rule #45: cross-package
 * checks that genuinely need every package's live tool objects belong in
 * `@iris-mcp/all`, the one package that legitimately depends on all five). A
 * dist-path import trick would dodge the `package.json` cycle but not the
 * PRACTICAL one: this package's own self-check (`pnpm --filter @iris-mcp/shared
 * test`) must be green in complete isolation, and shared is the FOUNDATION
 * the five packages build against — nothing here can require their `dist/`
 * to already exist.
 *
 * So this capstone constructs five REAL `McpServerBase` instances — the same
 * class, same constructor, same filter code path every real server flows
 * through — seeded with each package's CURRENT tool-NAME roster, transcribed
 * verbatim from the product-owner-approved spec table (`research/feature-
 * specs/11-tool-visibility-presets.md` §2.5, dated 2026-07-12) rather than a
 * live import. This is a deliberate, narrower substitution for "import the
 * real tool objects": it is NOT a substitute for per-package tool-roster
 * accuracy (each package's OWN `src/__tests__/index.test.ts` already pins
 * its real `tools` array's exact length and content — untouched by this
 * story, Rule #31 — and constructs the SAME `McpServerBase` class against
 * its real array). It IS a genuine, mechanical regression proof for exactly
 * what Epic 30 adds: that the new constructor filter never drops a
 * registered tool when no visibility env var is set, across five
 * differently-sized, differently-named tool sets. A bug in the filter would
 * break BOTH this test AND every package's own `index.test.ts`
 * simultaneously, since both drive the identical filter code.
 *
 * Discoverable by the default `vitest run` suite (plain `*.test.ts`, NOT
 * `*.integration.test.ts`). No live IRIS: construction only, no `start()`.
 * TypeScript-only — no `BOOTSTRAP_VERSION` impact, no governance-baseline
 * touch (every synthetic tool below declares an explicit `mutates`
 * classification, so `assertGovernanceClassified` never needs baseline
 * membership for these non-baseline synthetic names).
 */

import { describe, it, expect } from "vitest";
import { z } from "zod";
import { McpServerBase } from "../server-base.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";
import type { ToolDefinition } from "../tool-types.js";

/** A minimal, representative read tool stub — visibility only cares about `name`. */
function makeTool(name: string): ToolDefinition {
  return {
    name,
    title: name,
    description: `Representative stub for ${name} (back-compat capstone).`,
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    scope: "NONE",
    mutates: "read",
    handler: async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }),
  };
}

/**
 * Each package's current tool-name roster, transcribed from the approved
 * spec table (11-tool-visibility-presets.md §2.5) — the pre-feature
 * snapshot this capstone protects. Counts cross-checked against each
 * package's own `index.test.ts` (`toHaveLength`/`toBeGreaterThanOrEqual`
 * assertions): dev 28, admin 26, interop 22, ops ≥20 (21 live), data 7.
 */
const PRE_FEATURE_SNAPSHOTS: Record<string, string[]> = {
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

describe("AC 30.0.4 — Rule #19 back-compat capstone: no visibility env vars ⇒ every server's tool set is unchanged", () => {
  const savedEnv = {
    IRIS_TOOLS_PRESET: process.env.IRIS_TOOLS_PRESET,
    IRIS_TOOLS_DISABLE: process.env.IRIS_TOOLS_DISABLE,
    IRIS_TOOLS_ENABLE: process.env.IRIS_TOOLS_ENABLE,
  };

  function ensureNoVisibilityEnv(): void {
    delete process.env.IRIS_TOOLS_PRESET;
    delete process.env.IRIS_TOOLS_DISABLE;
    delete process.env.IRIS_TOOLS_ENABLE;
  }

  function restoreEnv(): void {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  for (const [packageName, toolNames] of Object.entries(PRE_FEATURE_SNAPSHOTS)) {
    it(`${packageName}: registered tool-name set deep-equals its pre-feature snapshot (${toolNames.length} tools + the reserved discovery tool)`, () => {
      ensureNoVisibilityEnv();
      try {
        const server = new McpServerBase({
          name: `@iris-mcp/${packageName}`,
          version: "0.0.0",
          tools: toolNames.map(makeTool),
        });

        const actual = server.getToolNames().slice().sort();
        const expected = [...toolNames, SERVER_DISCOVERY_TOOL_NAME].sort();

        // The mechanical proof: NOT a subset/superset check — exact set
        // equality. A filter bug that drops (or spuriously adds) even one
        // tool under empty env fails this immediately.
        expect(actual).toEqual(expected);
      } finally {
        restoreEnv();
      }
    });
  }

  it("sanity: every package's snapshot count matches its documented pre-feature total (11-tool-visibility-presets.md §2.5)", () => {
    expect(PRE_FEATURE_SNAPSHOTS["iris-dev-mcp"]).toHaveLength(28);
    expect(PRE_FEATURE_SNAPSHOTS["iris-admin-mcp"]).toHaveLength(26);
    expect(PRE_FEATURE_SNAPSHOTS["iris-interop-mcp"]).toHaveLength(22);
    expect(PRE_FEATURE_SNAPSHOTS["iris-ops-mcp"]).toHaveLength(21);
    expect(PRE_FEATURE_SNAPSHOTS["iris-data-mcp"]).toHaveLength(7);
  });
});
