/**
 * Namespace management tools for the IRIS Administration MCP server.
 *
 * Provides two tools for managing IRIS namespaces via the custom REST endpoint:
 * - {@link namespaceManageTool} — Create, modify, or delete a namespace
 * - {@link namespaceListTool} — List all namespaces with DB associations
 *
 * All tools call the custom REST service at `/api/executemcp/v2/config/namespace`.
 * Operations execute in %SYS namespace on the IRIS server.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.namespace.manage ───────────────────────────────────────

export const namespaceManageTool: ToolDefinition = {
  name: "iris.namespace.manage",
  title: "Manage Namespace",
  description:
    "Create, modify, or delete an IRIS namespace. For 'create', codeDatabase and dataDatabase " +
    "are required. For 'modify', only provided fields are updated. For 'delete', only the name is needed.",
  inputSchema: z.object({
    action: z
      .enum(["create", "modify", "delete"])
      .describe("Action to perform on the namespace"),
    name: z
      .string()
      .describe("Namespace name (e.g., 'MYAPP', 'USER')"),
    codeDatabase: z
      .string()
      .optional()
      .describe("Code/routine database name (required for create)"),
    dataDatabase: z
      .string()
      .optional()
      .describe("Data/globals database name (required for create)"),
    library: z
      .string()
      .optional()
      .describe("Library database name (default: IRISLIB)"),
    tempGlobals: z
      .string()
      .optional()
      .describe("Temp globals database name (default: IRISTEMP)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "SYS",
  handler: async (args, ctx) => {
    const { action, name, codeDatabase, dataDatabase, library, tempGlobals } =
      args as {
        action: string;
        name: string;
        codeDatabase?: string;
        dataDatabase?: string;
        library?: string;
        tempGlobals?: string;
      };

    const body: Record<string, string> = { action, name };
    if (codeDatabase) body.codeDatabase = codeDatabase;
    if (dataDatabase) body.dataDatabase = dataDatabase;
    if (library) body.library = library;
    if (tempGlobals) body.tempGlobals = tempGlobals;

    const path = `${BASE_URL}/config/namespace`;

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
              text: `Error managing namespace '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.namespace.list ─────────────────────────────────────────

export const namespaceListTool: ToolDefinition = {
  name: "iris.namespace.list",
  title: "List Namespaces",
  description:
    "List all IRIS namespaces with their code and data database associations. " +
    "Returns namespace name, globals database, routines database, library, and temp globals database.",
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

    const path = `${BASE_URL}/config/namespace`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as Array<{
        name: string;
        globals: string;
        routines: string;
        library: string;
        tempGlobals: string;
      }>;
      const allNamespaces = Array.isArray(rawResult) ? rawResult : [];
      const { page, nextCursor } = ctx.paginate(allNamespaces, cursor);
      const result = {
        namespaces: page,
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
              text: `Error listing namespaces: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
