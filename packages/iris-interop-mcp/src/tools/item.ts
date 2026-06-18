/**
 * Production item and auto-start tools for the IRIS Interoperability MCP server.
 *
 * Provides two tools for managing individual production config items and auto-start:
 * - {@link productionItemTool} — Enable, disable, get, or set config item settings
 * - {@link productionAutostartTool} — Get or set production auto-start configuration
 *
 * All tools call the custom REST service at `/api/executemcp/v2/interop/production`.
 * Ens.* classes operate in the target namespace (not %SYS).
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_production_item ──────────────────────────────────────

export const productionItemTool: ToolDefinition = {
  name: "iris_production_item",
  title: "Manage Production Item",
  description:
    "Add, remove, enable, disable, get settings, or set settings for an individual " +
    "Interoperability production config item. 'get' returns host and adapter settings. " +
    "'set' updates settings: the property keys poolSize, enabled, comment, category, " +
    "className map to Ens.Config.Item properties, and ANY OTHER key (e.g. " +
    "adapterClassName, or a host/adapter setting like FilePath, Charset) is routed to " +
    "an Ens.Config.Setting on the item (Target Adapter by default; pass " +
    "'<Name>@Host' / '<Name>@Adapter' to force the target). 'enable'/'disable' toggles " +
    "the item in the running production. 'add' creates a new item (requires 'className'; " +
    "Required Name+ClassName); 'remove' deletes it. For 'add'/'remove' the target " +
    "production defaults to the namespace's active production; pass 'production' " +
    "explicitly when there is no active production.\n\n" +
    "The mutating actions add/remove are opt-in under tool governance and are DISABLED " +
    "by default until enabled via IRIS_GOVERNANCE; enable/disable/get/set are " +
    "grandfathered (always available).\n\n" +
    "NOTE (visibility of a just-added item): 'add'/'remove' persist to the production " +
    "class definition (XData), while 'get'/'set' read the Ens.Config.Item SQL extent. " +
    "The extent is re-synced from the class only on the next add/remove (LoadFromClass). " +
    "So an item created by 'add' is NOT visible to an immediate 'get'/'set' until the " +
    "next add/remove (or a recompile) syncs the extent — this is an accepted IRIS " +
    "persistence-model split, not an error.",
  inputSchema: z.object({
    action: z
      .enum(["add", "remove", "enable", "disable", "get", "set"])
      .describe("Action to perform on the config item"),
    itemName: z
      .string()
      .describe("Name of the production config item (e.g., 'MyApp.Service.FileIn')"),
    className: z
      .string()
      .optional()
      .describe(
        "Host class name for the config item. Required for 'add' (the item's Ens.Config.Item.ClassName).",
      ),
    production: z
      .string()
      .optional()
      .describe(
        "Target production name for 'add'/'remove'. Defaults to the namespace's active production; required when no production is active. Ignored by enable/disable/get/set (those operate by itemName).",
      ),
    settings: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Settings object for 'add'/'set'. Property keys (poolSize, enabled, comment, category, className) map to Ens.Config.Item properties; any other key routes to an Ens.Config.Setting (Target Adapter by default; suffix a key with '@Host' or '@Adapter' to force the setting target).",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace. Defaults to the server's configured namespace; pass an explicit value to query a different namespace per call without changing the connection default."),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  // Governance (Story 17.2, frozen-foundation model): the existing
  // enable/disable/get/set keys are in the frozen baseline (1e62c5ad5bf7) →
  // grandfathered, so they are NOT declared here. The NEW add/remove keys are
  // absent from the baseline → they MUST be classified; both are writes →
  // default-DISABLED until an operator opts in via IRIS_GOVERNANCE.
  mutates: {
    add: "write",
    remove: "write",
  },
  handler: async (args, ctx) => {
    const { action, itemName, className, production, settings, namespace } = args as {
      action: string;
      itemName: string;
      className?: string;
      production?: string;
      settings?: Record<string, unknown>;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, unknown> = { action, itemName, namespace: ns };
    if (className !== undefined) body.className = className;
    if (production !== undefined) body.production = production;
    if (settings) body.settings = settings;

    const path = `${BASE_URL}/interop/production/item`;

    try {
      const response = await ctx.http.post(path, body);
      const result = response.result;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing config item '${itemName}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_production_autostart ─────────────────────────────────

export const productionAutostartTool: ToolDefinition = {
  name: "iris_production_autostart",
  title: "Manage Auto-Start",
  description:
    "Get or set the auto-start production configuration for a namespace. " +
    "'get' returns the current auto-start production name and enabled status. " +
    "'set' configures which production auto-starts; pass empty productionName to disable.",
  inputSchema: z.object({
    action: z
      .enum(["get", "set"])
      .describe("Action: 'get' current auto-start config or 'set' a new one"),
    productionName: z
      .string()
      .optional()
      .describe(
        "Production class name to auto-start (for 'set' action). Empty string disables auto-start.",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace. Defaults to the server's configured namespace; pass an explicit value to query a different namespace per call without changing the connection default."),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, productionName, namespace } = args as {
      action: string;
      productionName?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, unknown> = { action, namespace: ns };
    if (productionName !== undefined) body.productionName = productionName;

    const path = `${BASE_URL}/interop/production/autostart`;

    try {
      const response = await ctx.http.post(path, body);
      const result = response.result;
      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing auto-start: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
