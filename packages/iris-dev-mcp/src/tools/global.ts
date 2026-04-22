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

// ── iris_global_get ──────────────────────────────────────────────

export const globalGetTool: ToolDefinition = {
  name: "iris_global_get",
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

// ── iris_global_set ──────────────────────────────────────────────

export const globalSetTool: ToolDefinition = {
  name: "iris_global_set",
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

// ── iris_global_kill ─────────────────────────────────────────────

export const globalKillTool: ToolDefinition = {
  name: "iris_global_kill",
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

// ── iris_global_list ─────────────────────────────────────────────

export const globalListTool: ToolDefinition = {
  name: "iris_global_list",
  title: "List Globals",
  description:
    "List globals in an IRIS namespace. Optionally filter by a plain substring " +
    "match on the global name. Filter is case-insensitive by default (matches " +
    "`iris_doc_list` semantics); use caseSensitive:true for the prior behavior. " +
    "Filtering is client-side — all globals are fetched from the server, then " +
    "filtered locally. Large namespaces with thousands of globals may experience " +
    "slower responses when a filter is applied.",
  inputSchema: z.object({
    filter: z
      .string()
      .optional()
      .describe(
        "Case-insensitive plain substring filter on global names (default behavior). " +
        "Just pass the substring — no wildcards needed. Example: 'temp' matches " +
        "'TempData', 'MyTemp', 'IRIS.TempBuffer', and 'temp'. " +
        "Set caseSensitive:true to restore the former case-sensitive behavior.",
      ),
    caseSensitive: z
      .boolean()
      .optional()
      .default(false)
      .describe(
        "When true, the filter match is case-sensitive (legacy behavior). " +
        "Default is false (case-insensitive, matching iris_doc_list semantics).",
      ),
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
    const { filter, caseSensitive, cursor, namespace } = args as {
      filter?: string;
      caseSensitive?: boolean;
      cursor?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    const params = new URLSearchParams();
    params.set("namespace", ns);
    // FEAT-8: filter is applied client-side (case-insensitive by default).
    // When caseSensitive:false (default), do NOT send the filter to the server —
    // the server filter is case-sensitive and would pre-exclude case variants
    // (e.g., searching "temp" with a case-sensitive server drops "TempData" before
    // the client can include it in the case-insensitive match). We accept the full
    // list and apply the filter purely client-side in that case.
    // When caseSensitive:true, sending the filter to the server is safe and reduces
    // payload on large namespaces.
    if (filter && (caseSensitive ?? false)) params.set("filter", filter);

    const path = `${BASE_URL}/global/list?${params.toString()}`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as { globals?: string[]; count?: number; filter?: string };
      let allGlobals: string[] = rawResult.globals ?? [];

      // FEAT-8: client-side filter applied after server response.
      // When caseSensitive:true, perform exact substring match (legacy behavior).
      // When caseSensitive:false (default), lowercase both sides for case-insensitive match.
      // We always apply client-side to ensure consistent semantics regardless of
      // server-side filter behavior (server filter may differ in edge cases).
      if (filter) {
        if (caseSensitive ?? false) {
          // Case-sensitive: exact substring match
          allGlobals = allGlobals.filter((g) => g.includes(filter));
        } else {
          // Case-insensitive (default): lowercase both sides
          const lowerFilter = filter.toLowerCase();
          allGlobals = allGlobals.filter((g) => g.toLowerCase().includes(lowerFilter));
        }
      }

      const { page, nextCursor } = ctx.paginate(allGlobals, cursor);
      const result = {
        globals: page,
        count: page.length,
        ...(filter ? { filter } : {}),
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
