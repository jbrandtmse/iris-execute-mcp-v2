/**
 * Resource management tools for the IRIS Administration MCP server.
 *
 * Provides two tools for managing IRIS security resources via the custom REST endpoint:
 * - {@link resourceManageTool} — Create, modify, or delete a security resource
 * - {@link resourceListTool} — List all security resources
 *
 * All tools call the custom REST service at `/api/executemcp/v2/security/resource`.
 * Operations execute in %SYS namespace on the IRIS server.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_resource_manage ───────────────────────────────────────

export const resourceManageTool: ToolDefinition = {
  name: "iris_resource_manage",
  title: "Manage Resource",
  description:
    "Create, modify, or delete an IRIS security resource. For 'create', name is required. " +
    "For 'modify', only provided fields are updated. For 'delete', only the name is needed.",
  inputSchema: z.object({
    action: z
      .enum(["create", "modify", "delete"])
      .describe("Action to perform on the resource"),
    name: z
      .string()
      .describe("Resource name (e.g., 'MyDB', '%Development')"),
    description: z
      .string()
      .optional()
      .describe("Description of the resource"),
    publicPermission: z
      .string()
      .optional()
      .describe(
        "Default public permission for the resource (e.g., '', 'R', 'RW', 'RWU')",
      ),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "SYS",
  handler: async (args, ctx) => {
    const { action, name, description, publicPermission } = args as {
      action: string;
      name: string;
      description?: string;
      publicPermission?: string;
    };

    const body: Record<string, string> = { action, name };
    if (description !== undefined) body.description = description;
    if (publicPermission !== undefined) body.publicPermission = publicPermission;

    const path = `${BASE_URL}/security/resource`;

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
              text: `Error managing resource '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_resource_list ─────────────────────────────────────────

export const resourceListTool: ToolDefinition = {
  name: "iris_resource_list",
  title: "List Resources",
  description:
    "List all IRIS security resources with their description, public permission, and type.",
  inputSchema: z.object({
    cursor: z
      .string()
      .optional()
      .describe(
        "Pagination cursor from a previous response's nextCursor field",
      ),
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

    const path = `${BASE_URL}/security/resource`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as Array<{
        name: string;
        description: string;
        publicPermission: string;
        type: string;
      }>;
      const allResources = Array.isArray(rawResult) ? rawResult : [];
      const { page, nextCursor } = ctx.paginate(allResources, cursor);
      const result = {
        resources: page,
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
              text: `Error listing resources: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
