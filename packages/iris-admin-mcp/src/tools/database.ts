/**
 * Database management tools for the IRIS Administration MCP server.
 *
 * Provides two tools for managing IRIS databases via the custom REST endpoint:
 * - {@link databaseManageTool} — Create, modify, or delete a database
 * - {@link databaseListTool} — List all databases with size, free space, and mount status
 *
 * All tools call the custom REST service at `/api/executemcp/v2/config/database`.
 * Operations execute in %SYS namespace on the IRIS server.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_database_manage ────────────────────────────────────────

export const databaseManageTool: ToolDefinition = {
  name: "iris_database_manage",
  title: "Manage Database",
  description:
    "Create, modify, or delete an IRIS database. For 'create', directory is required. " +
    "For 'modify', only provided fields are updated. For 'delete', only the name is needed. " +
    "Note: Deletion removes the database from the IRIS configuration but does NOT cancel " +
    "pending background work (e.g., extent-index rebuilds) that may have been scheduled " +
    "against the deleted directory. The IRIS console may log alerts for such operations " +
    "post-delete; these are informational and do not indicate tool failure.",
  inputSchema: z.object({
    action: z
      .enum(["create", "modify", "delete"])
      .describe("Action to perform on the database"),
    name: z
      .string()
      .describe("Database name (e.g., 'MYAPPDATA', 'USER')"),
    directory: z
      .string()
      .optional()
      .describe("Database directory path (required for create)"),
    size: z
      .number()
      .optional()
      .describe("Initial size in MB"),
    maxSize: z
      .number()
      .optional()
      .describe("Maximum size in MB (0 = unlimited)"),
    expansionSize: z
      .number()
      .optional()
      .describe("Growth increment in MB"),
    globalJournalState: z
      .number()
      .optional()
      .describe("Journal state for globals"),
    mountRequired: z
      .boolean()
      .optional()
      .describe("Whether mounting is required at startup"),
    mountAtStartup: z
      .boolean()
      .optional()
      .describe("Whether to auto-mount at startup"),
    readOnly: z
      .boolean()
      .optional()
      .describe("Whether database is read-only"),
    resource: z
      .string()
      .optional()
      .describe("Security resource for access control"),
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
      name,
      directory,
      size,
      maxSize,
      expansionSize,
      globalJournalState,
      mountRequired,
      mountAtStartup,
      readOnly,
      resource,
    } = args as {
      action: string;
      name: string;
      directory?: string;
      size?: number;
      maxSize?: number;
      expansionSize?: number;
      globalJournalState?: number;
      mountRequired?: boolean;
      mountAtStartup?: boolean;
      readOnly?: boolean;
      resource?: string;
    };

    const body: Record<string, unknown> = { action, name };
    if (directory !== undefined) body.directory = directory;
    if (size !== undefined) body.size = size;
    if (maxSize !== undefined) body.maxSize = maxSize;
    if (expansionSize !== undefined) body.expansionSize = expansionSize;
    if (globalJournalState !== undefined)
      body.globalJournalState = globalJournalState;
    if (mountRequired !== undefined) body.mountRequired = mountRequired;
    if (mountAtStartup !== undefined) body.mountAtStartup = mountAtStartup;
    if (readOnly !== undefined) body.readOnly = readOnly;
    if (resource !== undefined) body.resource = resource;

    const path = `${BASE_URL}/config/database`;

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
              text: `Error managing database '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_database_list ──────────────────────────────────────────

export const databaseListTool: ToolDefinition = {
  name: "iris_database_list",
  title: "List Databases",
  description:
    "List all IRIS databases with size, free space, and mount status. " +
    "Returns database name, directory, size, max size, expansion size, mount status, and other configuration.",
  inputSchema: z.object({
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
    const { cursor } = args as { cursor?: string };

    const path = `${BASE_URL}/config/database`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as Array<{
        name: string;
        directory: string;
        size: number;
        maxSize: number;
        expansionSize: number;
        globalJournalState: number;
        mountRequired: boolean;
        mountAtStartup: boolean;
        readOnly: boolean;
        resource: string;
      }>;
      const allDatabases = Array.isArray(rawResult) ? rawResult : [];
      const { page, nextCursor } = ctx.paginate(allDatabases, cursor);
      const result = {
        databases: page,
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
              text: `Error listing databases: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
