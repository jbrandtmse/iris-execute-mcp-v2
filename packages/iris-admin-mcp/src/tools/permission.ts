/**
 * Permission check tool for the IRIS Administration MCP server.
 *
 * Provides a single tool for checking whether a user or role has specific
 * permissions on a resource:
 * - {@link permissionCheckTool} — Check permission for a user/role on a resource
 *
 * Calls the custom REST service at `/api/executemcp/v2/security/permission`.
 * Operations execute in %SYS namespace on the IRIS server.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.permission.check ──────────────────────────────────────

export const permissionCheckTool: ToolDefinition = {
  name: "iris.permission.check",
  title: "Check Permission",
  description:
    "Check whether an IRIS user or role has a specific permission on a resource. " +
    "Returns whether the permission is granted and the actual granted permission level. " +
    "The target is auto-detected as a user or role based on what exists in the system.",
  inputSchema: z.object({
    target: z
      .string()
      .describe(
        "Username or role name to check permissions for (e.g., '_SYSTEM', '%Developer')",
      ),
    resource: z
      .string()
      .describe("Resource name to check permissions on (e.g., '%DB_USER', '%Development')"),
    permission: z
      .string()
      .describe(
        "Permission to check (e.g., 'R', 'W', 'U', 'RW', 'RWU')",
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
    const { target, resource, permission } = args as {
      target: string;
      resource: string;
      permission: string;
    };

    const body = { target, resource, permission };
    const path = `${BASE_URL}/security/permission`;

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
              text: `Error checking permission for '${target}' on '${resource}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
