/**
 * Lookup table management tools for the IRIS Interoperability MCP server.
 *
 * Provides two tools for managing Ensemble lookup tables:
 * - {@link lookupManageTool} — Get, set, or delete lookup table entries
 * - {@link lookupTransferTool} — Export or import lookup tables as XML
 *
 * All tools call the custom REST service at `/api/executemcp/v2/interop/lookup`.
 * Lookup table entries are stored in the ^Ens.LookupTable global.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_lookup_manage ──────────────────────────────────────────

export const lookupManageTool: ToolDefinition = {
  name: "iris_lookup_manage",
  title: "Manage Lookup Table",
  description:
    "Get, set, or delete an entry in an Ensemble lookup table. " +
    "'get' returns the value for a key (and whether it exists). " +
    "'set' creates or updates a key-value pair. " +
    "'delete' removes a key from the table.",
  inputSchema: z.object({
    action: z
      .enum(["get", "set", "delete"])
      .describe("Action to perform: 'get', 'set', or 'delete'"),
    tableName: z
      .string()
      .describe("Lookup table name"),
    key: z
      .string()
      .describe("Key within the lookup table"),
    value: z
      .string()
      .optional()
      .describe("Value to set (required for 'set' action)"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, tableName, key, value, namespace } = args as {
      action: string;
      tableName: string;
      key: string;
      value?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, string> = { action, tableName, key, namespace: ns };
    if (value !== undefined) body.value = value;

    const path = `${BASE_URL}/interop/lookup`;

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
              text: `Error managing lookup table '${tableName}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_lookup_transfer ────────────────────────────────────────

export const lookupTransferTool: ToolDefinition = {
  name: "iris_lookup_transfer",
  title: "Transfer Lookup Table",
  description:
    "Export or import an Ensemble lookup table in XML format. " +
    "'export' returns the full table as XML with all key-value entries. " +
    "'import' parses XML and sets entries in the lookup table.",
  inputSchema: z.object({
    action: z
      .enum(["export", "import"])
      .describe("Action: 'export' table to XML or 'import' XML into table"),
    tableName: z
      .string()
      .describe("Lookup table name"),
    xml: z
      .string()
      .optional()
      .describe("XML content to import (required for 'import' action)"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, tableName, xml, namespace } = args as {
      action: string;
      tableName: string;
      xml?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, string> = { action, tableName, namespace: ns };
    if (xml !== undefined) body.xml = xml;

    const path = `${BASE_URL}/interop/lookup/transfer`;

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
              text: `Error transferring lookup table '${tableName}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
