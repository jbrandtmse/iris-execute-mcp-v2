/**
 * REST API management tools for the IRIS Data & Analytics MCP server.
 *
 * Provides one tool for managing IRIS REST API dispatch classes:
 * - {@link restManageTool} — List, get details, or delete REST applications
 *
 * All operations call the IRIS built-in Management API at
 * `/api/mgmnt/v2/{namespace}/...`. No custom ObjectScript handler
 * is required.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";
import { extractResult } from "./docdb.js";

/** Base URL for the IRIS Management REST API. */
const BASE_MGMNT_URL = "/api/mgmnt/v2";

// ── iris.rest.manage ──────────────────────────────────────────

export const restManageTool: ToolDefinition = {
  name: "iris.rest.manage",
  title: "Manage REST API",
  description:
    "List, get details, or delete REST API dispatch classes on IRIS. " +
    "'list' returns available REST applications and their URL maps in the namespace. " +
    "'get' returns REST application details (dispatch class, URL map, routes) for a named application. " +
    "'delete' removes a REST application.",
  inputSchema: z.object({
    action: z
      .enum(["list", "get", "delete"])
      .describe("Action to perform: 'list', 'get', or 'delete'"),
    application: z
      .string()
      .min(1)
      .optional()
      .describe(
        "REST application path (required for 'get' and 'delete', e.g., '/api/myapp')",
      ),
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
    const { action, application, namespace } = args as {
      action: string;
      application?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);

    try {
      let response: unknown;

      if (action === "list") {
        response = await ctx.http.get(
          `${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/`,
        );
      } else if (action === "get") {
        if (!application) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'application' is required for 'get' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.get(
          `${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/${encodeURIComponent(application)}`,
        );
      } else {
        // delete
        if (!application) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Error: 'application' is required for 'delete' action",
              },
            ],
            isError: true,
          };
        }
        response = await ctx.http.delete(
          `${BASE_MGMNT_URL}/${encodeURIComponent(ns)}/${encodeURIComponent(application)}`,
        );
      }

      const result = extractResult(response);
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
              text: `Error managing REST application: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
