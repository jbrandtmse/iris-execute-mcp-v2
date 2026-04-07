/**
 * REST API management tools for the IRIS Interoperability MCP server.
 *
 * Provides a single tool for managing REST applications:
 * - {@link interopRestTool} — Create, delete, or get a REST application
 *
 * Calls the custom REST service at `/api/executemcp/v2/interop/rest`.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.interop.rest ──────────────────────────────────────────

export const interopRestTool: ToolDefinition = {
  name: "iris.interop.rest",
  title: "Manage REST Application",
  description:
    "Create, delete, or get a REST application. " +
    "'create' generates a REST application from an OpenAPI specification. " +
    "'delete' removes a REST application. " +
    "'get' returns the OpenAPI spec for an existing REST application.",
  inputSchema: z.object({
    action: z
      .enum(["create", "delete", "get"])
      .describe("Action to perform: 'create', 'delete', or 'get'"),
    name: z
      .string()
      .describe("REST application name (e.g., '/myapi')"),
    spec: z
      .unknown()
      .optional()
      .describe("OpenAPI specification as JSON object or string (required for 'create')"),
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
    const { action, name, spec, namespace } = args as {
      action: string;
      name: string;
      spec?: string | Record<string, unknown>;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, unknown> = { action, name, namespace: ns };
    if (spec !== undefined) body.spec = spec;

    const path = `${BASE_URL}/interop/rest`;

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
              text: `Error managing REST application '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
