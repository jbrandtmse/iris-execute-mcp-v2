/**
 * Analytics tools for the IRIS Data & Analytics MCP server.
 *
 * Provides two tools for IRIS DeepSee analytics:
 * - {@link analyticsMdxTool} — Execute MDX queries and return structured
 *   pivot-table results with axis labels and measure values
 * - {@link analyticsCubesTool} — List, build, or synchronize DeepSee cubes
 *
 * All tools call the custom ExecuteMCPv2 REST handler at
 * `/api/executemcp/v2/analytics/...`.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import { extractResult, toStructured } from "./docdb.js";

/** Base URL for the ExecuteMCPv2 custom REST API. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.analytics.mdx ────────────────────────────────────────

export const analyticsMdxTool: ToolDefinition = {
  name: "iris.analytics.mdx",
  title: "Execute MDX Query",
  description:
    "Execute an MDX query against IRIS DeepSee and return structured " +
    "pivot-table results with axis labels, measure values, and dimension " +
    "members. Returns columns, rows (each with label and values), " +
    "rowCount, and columnCount.",
  inputSchema: z.object({
    query: z
      .string()
      .min(1)
      .describe("MDX query string to execute"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { query, namespace } = args as {
      query: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    try {
      const response = await ctx.http.post(`${BASE_URL}/analytics/mdx`, {
        query,
        namespace: ns,
      });

      const result = extractResult(response);

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error executing MDX query: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.analytics.cubes ──────────────────────────────────────

export const analyticsCubesTool: ToolDefinition = {
  name: "iris.analytics.cubes",
  title: "Manage DeepSee Cubes",
  description:
    "List, build, or synchronize IRIS DeepSee cubes. " +
    "'list' returns all cubes with name, source class, last build time, and record count. " +
    "'build' triggers a full synchronous rebuild of a cube. " +
    "'sync' triggers an incremental synchronization of a cube.",
  inputSchema: z.object({
    action: z
      .enum(["list", "build", "sync"])
      .describe("Action to perform: 'list', 'build', or 'sync'"),
    cube: z
      .string()
      .min(1)
      .optional()
      .describe("Cube name (required for 'build' and 'sync')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: false,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, cube, namespace } = args as {
      action: string;
      cube?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    try {
      let response: unknown;

      if (action === "list") {
        const qp = encodeURIComponent(ns);
        response = await ctx.http.get(
          `${BASE_URL}/analytics/cubes?namespace=${qp}`,
        );
      } else {
        // build or sync
        if (!cube) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: 'cube' is required for '${action}' action`,
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.post(`${BASE_URL}/analytics/cubes`, {
          action,
          cube,
          namespace: ns,
        });
      }

      const result = extractResult(response);

      return {
        content: [
          { type: "text" as const, text: JSON.stringify(result, null, 2) },
        ],
        structuredContent: toStructured(result),
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error managing cubes: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
