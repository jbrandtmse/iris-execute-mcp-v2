/**
 * Global operation tools for the IRIS Development MCP server.
 *
 * Provides four tools for managing IRIS globals via the custom REST endpoint:
 * - {@link globalGetTool} — Read a global node value
 * - {@link globalSetTool} — Set a global node value (with verification)
 * - {@link globalKillTool} — Delete a global node or subtree
 * - {@link globalListTool} — List globals in a namespace
 *
 * All tools call the custom REST service at `/api/executemcp/v2/global`,
 * NOT the Atelier API. Namespace is passed as a query parameter or in
 * the request body.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.global.get ──────────────────────────────────────────────

export const globalGetTool: ToolDefinition = {
  name: "iris.global.get",
  title: "Get Global",
  description:
    "Read the value of an IRIS global node. Returns the value and whether the node is defined. " +
    "Supports multi-level subscripts passed as a comma-separated string.",
  inputSchema: z.object({
    global: z
      .string()
      .describe("Global name without the caret (e.g., 'MyGlobal', not '^MyGlobal')"),
    subscripts: z
      .string()
      .optional()
      .describe("Subscripts as a comma-separated string. Use quotes for string keys: '\"key1\",\"key2\"'. Use plain numbers for numeric keys: '1,2,3'. Leave empty for the root node."),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { global: globalName, subscripts, namespace } = args as {
      global: string;
      subscripts?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    const params = new URLSearchParams();
    params.set("global", globalName);
    if (subscripts) params.set("subscripts", subscripts);
    params.set("namespace", ns);

    const path = `${BASE_URL}/global?${params.toString()}`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result;
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text",
              text: `Error reading global '^${globalName}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.global.set ──────────────────────────────────────────────

export const globalSetTool: ToolDefinition = {
  name: "iris.global.set",
  title: "Set Global",
  description:
    "Set the value of an IRIS global node. The value is verified after writing " +
    "and the response includes a verification flag.",
  inputSchema: z.object({
    global: z
      .string()
      .describe("Global name without the caret (e.g., 'MyGlobal')"),
    value: z
      .string()
      .describe("Value to set at the global node"),
    subscripts: z
      .string()
      .optional()
      .describe("Subscripts as a comma-separated string. Use quotes for string keys: '\"key1\",\"key2\"'. Use plain numbers for numeric keys: '1,2,3'. Leave empty for the root node."),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { global: globalName, value, subscripts, namespace } = args as {
      global: string;
      value: string;
      subscripts?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    const body: Record<string, string> = {
      global: globalName,
      value,
      namespace: ns,
    };
    if (subscripts) body.subscripts = subscripts;

    const path = `${BASE_URL}/global`;

    try {
      const response = await ctx.http.put(path, body);
      const result = response.result;
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text",
              text: `Error setting global '^${globalName}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.global.kill ─────────────────────────────────────────────

export const globalKillTool: ToolDefinition = {
  name: "iris.global.kill",
  title: "Kill Global",
  description:
    "Delete an IRIS global node or entire subtree. Use with caution — " +
    "this permanently removes data.",
  inputSchema: z.object({
    global: z
      .string()
      .describe("Global name without the caret (e.g., 'MyGlobal')"),
    subscripts: z
      .string()
      .optional()
      .describe("Subscripts as a comma-separated string. Use quotes for string keys: '\"key1\",\"key2\"'. Use plain numbers for numeric keys: '1,2,3'. Leave empty for the root node."),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { global: globalName, subscripts, namespace } = args as {
      global: string;
      subscripts?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    const params = new URLSearchParams();
    params.set("global", globalName);
    if (subscripts) params.set("subscripts", subscripts);
    params.set("namespace", ns);

    const path = `${BASE_URL}/global?${params.toString()}`;

    try {
      const response = await ctx.http.delete(path);
      const result = response.result;
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text",
              text: `Error deleting global '^${globalName}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.global.list ─────────────────────────────────────────────

export const globalListTool: ToolDefinition = {
  name: "iris.global.list",
  title: "List Globals",
  description:
    "List globals in an IRIS namespace. Optionally filter by substring match on the global name.",
  inputSchema: z.object({
    filter: z
      .string()
      .optional()
      .describe("Substring filter on global names (e.g., 'Temp' matches 'TempData', 'MyTemp')"),
    cursor: z
      .string()
      .optional()
      .describe("Pagination cursor from a previous response's nextCursor field"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { filter, cursor, namespace } = args as {
      filter?: string;
      cursor?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    const params = new URLSearchParams();
    params.set("namespace", ns);
    if (filter) params.set("filter", filter);

    const path = `${BASE_URL}/global/list?${params.toString()}`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as { globals?: string[]; count?: number; filter?: string };
      const allGlobals: string[] = rawResult.globals ?? [];
      const { page, nextCursor } = ctx.paginate(allGlobals, cursor);
      const result = {
        globals: page,
        count: page.length,
        ...(rawResult.filter ? { filter: rawResult.filter } : {}),
        ...(nextCursor ? { nextCursor } : {}),
      };
      return {
        content: [
          { type: "text", text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text",
              text: `Error listing globals: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
