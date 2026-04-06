/**
 * Namespace mapping tools for the IRIS Administration MCP server.
 *
 * Provides two tools for managing global, routine, and package mappings
 * between IRIS namespaces via the custom REST endpoint:
 * - {@link mappingManageTool} — Create or delete a mapping
 * - {@link mappingListTool} — List all mappings of a given type for a namespace
 *
 * All tools call the custom REST service at `/api/executemcp/v2/config/mapping/:type`.
 * Operations execute in %SYS namespace on the IRIS server.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.mapping.manage ────────────────────────────────────────

export const mappingManageTool: ToolDefinition = {
  name: "iris.mapping.manage",
  title: "Manage Namespace Mapping",
  description:
    "Create or delete a global, routine, or package mapping between namespaces. " +
    "For 'create', database is required. For global mappings, optional collation, " +
    "lockDatabase, and subscript parameters are supported. Modification is done by delete + create.",
  inputSchema: z.object({
    action: z
      .enum(["create", "delete"])
      .describe("Action to perform on the mapping"),
    type: z
      .enum(["global", "routine", "package"])
      .describe("Type of mapping to manage"),
    namespace: z
      .string()
      .describe("Namespace to configure mappings for (e.g., 'USER')"),
    name: z
      .string()
      .describe(
        "Mapping name (global name, routine name, or package name)",
      ),
    database: z
      .string()
      .optional()
      .describe("Target database name (required for create)"),
    collation: z
      .string()
      .optional()
      .describe("Collation setting (global mappings only)"),
    lockDatabase: z
      .string()
      .optional()
      .describe("Lock database name (global mappings only)"),
    subscript: z
      .string()
      .optional()
      .describe("Subscript range for subscript-level mappings (global mappings only)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "SYS",
  handler: async (args, ctx) => {
    const {
      action,
      type,
      namespace,
      name,
      database,
      collation,
      lockDatabase,
      subscript,
    } = args as {
      action: string;
      type: string;
      namespace: string;
      name: string;
      database?: string;
      collation?: string;
      lockDatabase?: string;
      subscript?: string;
    };

    const body: Record<string, string> = { action, namespace, name };
    if (database) body.database = database;
    if (collation) body.collation = collation;
    if (lockDatabase) body.lockDatabase = lockDatabase;
    if (subscript) body.subscript = subscript;

    const path = `${BASE_URL}/config/mapping/${type}`;

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
              text: `Error managing ${type} mapping '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.mapping.list ──────────────────────────────────────────

export const mappingListTool: ToolDefinition = {
  name: "iris.mapping.list",
  title: "List Namespace Mappings",
  description:
    "List all global, routine, or package mappings for a given namespace. " +
    "Returns mapping name, type, namespace, database, and type-specific properties.",
  inputSchema: z.object({
    namespace: z
      .string()
      .describe("Namespace to list mappings for (e.g., 'USER')"),
    type: z
      .enum(["global", "routine", "package"])
      .describe("Type of mappings to list"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous response's nextCursor field"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "SYS",
  handler: async (args, ctx) => {
    const { namespace, type, cursor } = args as {
      namespace: string;
      type: string;
      cursor?: string;
    };

    const path = `${BASE_URL}/config/mapping/${type}?namespace=${encodeURIComponent(namespace)}`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as Array<{
        name: string;
        type: string;
        namespace: string;
        database: string;
        collation?: string;
        lockDatabase?: string;
        subscript?: string;
      }>;
      const allMappings = Array.isArray(rawResult) ? rawResult : [];
      const { page, nextCursor } = ctx.paginate(allMappings, cursor);
      const result = {
        mappings: page,
        count: page.length,
        ...(nextCursor ? { nextCursor } : {}),
      };
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
              text: `Error listing ${type} mappings: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
