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
    "Enable, disable, get settings, or set settings for an individual Interoperability " +
    "production config item. 'get' returns host and adapter settings. 'set' updates " +
    "settings like poolSize, enabled, comment, category, className, adapterClassName. " +
    "'enable'/'disable' toggles the item in the running production.",
  inputSchema: z.object({
    action: z
      .enum(["enable", "disable", "get", "set"])
      .describe("Action to perform on the config item"),
    itemName: z
      .string()
      .describe("Name of the production config item (e.g., 'MyApp.Service.FileIn')"),
    settings: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Settings object for 'set' action. Keys: poolSize, enabled, comment, category, className, adapterClassName",
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
    const { action, itemName, settings, namespace } = args as {
      action: string;
      itemName: string;
      settings?: Record<string, unknown>;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, unknown> = { action, itemName, namespace: ns };
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
