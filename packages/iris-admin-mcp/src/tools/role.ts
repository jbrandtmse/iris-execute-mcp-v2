/**
 * Role management tools for the IRIS Administration MCP server.
 *
 * Provides two tools for managing IRIS security roles via the custom REST endpoint:
 * - {@link roleManageTool} — Create, modify, or delete a security role
 * - {@link roleListTool} — List all security roles
 *
 * All tools call the custom REST service at `/api/executemcp/v2/security/role`.
 * Operations execute in %SYS namespace on the IRIS server.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.role.manage ───────────────────────────────────────────

export const roleManageTool: ToolDefinition = {
  name: "iris.role.manage",
  title: "Manage Role",
  description:
    "Create, modify, or delete an IRIS security role. For 'create', name is required. " +
    "For 'modify', only provided fields are updated. For 'delete', only the name is needed. " +
    "Resources are specified as comma-separated resource:permission pairs (e.g., 'MyDB:RW,MyApp:U').",
  inputSchema: z.object({
    action: z
      .enum(["create", "modify", "delete"])
      .describe("Action to perform on the role"),
    name: z
      .string()
      .describe("Role name (e.g., 'MyAppRole', '%Developer')"),
    description: z
      .string()
      .optional()
      .describe("Description of the role"),
    resources: z
      .string()
      .optional()
      .describe(
        "Comma-separated list of resource:permission pairs (e.g., 'MyDB:RW,MyApp:U')",
      ),
    grantedRoles: z
      .string()
      .optional()
      .describe(
        "Comma-separated list of roles granted to this role (e.g., '%Developer,%Operator')",
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
    const { action, name, description, resources, grantedRoles } = args as {
      action: string;
      name: string;
      description?: string;
      resources?: string;
      grantedRoles?: string;
    };

    const body: Record<string, string> = { action, name };
    if (description !== undefined) body.description = description;
    if (resources !== undefined) body.resources = resources;
    if (grantedRoles !== undefined) body.grantedRoles = grantedRoles;

    const path = `${BASE_URL}/security/role`;

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
              text: `Error managing role '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.role.list ─────────────────────────────────────────────

export const roleListTool: ToolDefinition = {
  name: "iris.role.list",
  title: "List Roles",
  description:
    "List all IRIS security roles with their description, resources, and granted roles.",
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

    const path = `${BASE_URL}/security/role`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as Array<{
        name: string;
        description: string;
        resources: string;
        grantedRoles: string;
      }>;
      const allRoles = Array.isArray(rawResult) ? rawResult : [];
      const { page, nextCursor } = ctx.paginate(allRoles, cursor);
      const result = {
        roles: page,
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
              text: `Error listing roles: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
