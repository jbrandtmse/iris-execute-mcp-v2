/**
 * System configuration tool for the IRIS Operations MCP server.
 *
 * Provides a single tool for managing IRIS system configuration:
 * - {@link configManageTool} — Get, set, or export system configuration
 *
 * All operations call the custom REST service at
 * `/api/executemcp/v2/system/config`.
 * Scope is NONE — the handler switches to %SYS internally.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.config.manage ─────────────────────────────────────

export const configManageTool: ToolDefinition = {
  name: "iris.config.manage",
  title: "Manage System Configuration",
  description:
    "View or modify IRIS system configuration parameters. " +
    "Actions: 'get' retrieves configuration for a section (config, startup, locale); " +
    "'set' modifies parameters (config section only, requires properties object); " +
    "'export' returns combined system info and configuration data.",
  inputSchema: z.object({
    action: z
      .enum(["get", "set", "export"])
      .describe("Action to perform: get, set, or export"),
    section: z
      .enum(["config", "startup", "locale"])
      .optional()
      .describe(
        "Configuration section (default: config). Used with get and set actions.",
      ),
    properties: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
      .optional()
      .describe(
        "Key-value pairs of configuration properties to set (required for set action)",
      ),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (args, ctx) => {
    const { action, section, properties } = args as {
      action: string;
      section?: string;
      properties?: Record<string, unknown>;
    };

    // Dynamic annotations based on action
    const isReadOnly = action === "get" || action === "export";

    const body: Record<string, unknown> = { action };
    if (section !== undefined) body.section = section;
    if (properties !== undefined) body.properties = properties;

    const path = `${BASE_URL}/system/config`;

    try {
      const response = await ctx.http.post(path, body);
      const result = response.result as Record<string, unknown>;

      const lines: string[] = [];

      if (action === "get") {
        const sectionName = (section ?? "config") as string;
        lines.push(`System Configuration — ${sectionName}:`);
        const props = result.properties as Record<string, unknown> | undefined;
        if (props && typeof props === "object") {
          for (const [key, value] of Object.entries(props)) {
            lines.push(`  ${key}: ${value}`);
          }
        }
      } else if (action === "set") {
        lines.push("Configuration Updated:");
        if (result.count !== undefined) {
          lines.push(`  Properties modified: ${result.count}`);
        }
        if (result.message) {
          lines.push(`  ${result.message}`);
        }
      } else if (action === "export") {
        lines.push("System Configuration Export:");
        const system = result.system as Record<string, unknown> | undefined;
        if (system) {
          lines.push("");
          lines.push("  System Info:");
          if (system.product) lines.push(`    Product: ${system.product}`);
          if (system.version) lines.push(`    Version: ${system.version}`);
          if (system.os) lines.push(`    OS: ${system.os}`);
          if (system.installDirectory) {
            lines.push(`    Install Directory: ${system.installDirectory}`);
          }
        }
        const config = result.config as Record<string, unknown> | undefined;
        if (config) {
          lines.push("");
          lines.push("  Configuration:");
          for (const [key, value] of Object.entries(config)) {
            lines.push(`    ${key}: ${value}`);
          }
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: result,
        _meta: isReadOnly ? { readOnly: true } : undefined,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing configuration: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
