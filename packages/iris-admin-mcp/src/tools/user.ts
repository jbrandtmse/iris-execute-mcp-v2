/**
 * User and password management tools for the IRIS Administration MCP server.
 *
 * Provides four tools for managing IRIS user accounts via the custom REST endpoint:
 * - {@link userManageTool} — Create, modify, or delete a user account
 * - {@link userGetTool} — Get a single user or list all users
 * - {@link userRolesTool} — Add or remove roles from a user
 * - {@link userPasswordTool} — Change or validate a password
 *
 * All tools call the custom REST service at `/api/executemcp/v2/security/user`.
 * Operations execute in %SYS namespace on the IRIS server.
 *
 * CRITICAL: Password values are never included in log output or error messages (NFR6).
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_user_manage ───────────────────────────────────────────

export const userManageTool: ToolDefinition = {
  name: "iris_user_manage",
  title: "Manage User",
  description:
    "Create, modify, or delete an IRIS user account. For 'create', name and password are " +
    "required. For 'modify', only provided fields are updated. For 'delete', only the name is needed. " +
    "Passwords are never returned in responses.",
  inputSchema: z.object({
    action: z
      .enum(["create", "modify", "delete"])
      .describe("Action to perform on the user account"),
    name: z
      .string()
      .describe("Username for the account"),
    password: z
      .string()
      .optional()
      .describe("Password (required for create, never returned in responses)"),
    fullName: z
      .string()
      .optional()
      .describe("Display name for the user"),
    roles: z
      .string()
      .optional()
      .describe("Comma-separated list of roles to assign"),
    enabled: z
      .union([z.boolean(), z.number()])
      .optional()
      .describe("Whether the account is enabled (1/true or 0/false)"),
    namespace: z
      .string()
      .optional()
      .describe("Default namespace for the user"),
    routine: z
      .string()
      .optional()
      .describe("Default routine for the user"),
    comment: z
      .string()
      .optional()
      .describe("Comment/description for the user account"),
    expirationDate: z
      .string()
      .optional()
      .describe("Account expiration date"),
    changePasswordOnNextLogin: z
      .union([z.boolean(), z.number()])
      .optional()
      .describe("Force password change on next login (1/true or 0/false)"),
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
      password,
      fullName,
      roles,
      enabled,
      namespace,
      routine,
      comment,
      expirationDate,
      changePasswordOnNextLogin,
    } = args as {
      action: string;
      name: string;
      password?: string;
      fullName?: string;
      roles?: string;
      enabled?: boolean | number;
      namespace?: string;
      routine?: string;
      comment?: string;
      expirationDate?: string;
      changePasswordOnNextLogin?: boolean | number;
    };

    const body: Record<string, unknown> = { action, name };
    if (password) body.password = password;
    if (fullName) body.fullName = fullName;
    if (roles) body.roles = roles;
    if (enabled !== undefined) body.enabled = enabled ? 1 : 0;
    if (namespace) body.namespace = namespace;
    if (routine) body.routine = routine;
    if (comment) body.comment = comment;
    if (expirationDate) body.expirationDate = expirationDate;
    if (changePasswordOnNextLogin !== undefined)
      body.changePasswordOnNextLogin = changePasswordOnNextLogin ? 1 : 0;

    const path = `${BASE_URL}/security/user`;

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
              text: `Error managing user '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_user_get ──────────────────────────────────────────────

export const userGetTool: ToolDefinition = {
  name: "iris_user_get",
  title: "Get User",
  description:
    "Get an IRIS user account by name, or list all users when name is omitted. " +
    "Returns user properties including roles, namespace, and enabled status. " +
    "Passwords are never included in the response.",
  inputSchema: z.object({
    name: z
      .string()
      .optional()
      .describe("Username to retrieve. If omitted, lists all users."),
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
    const { name, cursor } = args as { name?: string; cursor?: string };

    try {
      if (name) {
        // Get single user
        const path = `${BASE_URL}/security/user/${encodeURIComponent(name)}`;
        const response = await ctx.http.get(path);
        const result = response.result;
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          structuredContent: result,
        };
      } else {
        // List all users
        const path = `${BASE_URL}/security/user`;
        const response = await ctx.http.get(path);
        const rawResult = response.result as Array<Record<string, unknown>>;
        const allUsers = Array.isArray(rawResult) ? rawResult : [];
        const { page, nextCursor } = ctx.paginate(allUsers, cursor);
        const result = {
          users: page,
          count: page.length,
          ...(nextCursor ? { nextCursor } : {}),
        };
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(result, null, 2) },
          ],
          structuredContent: result,
        };
      }
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: name
                ? `Error getting user '${name}': ${error.message}`
                : `Error listing users: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_user_roles ────────────────────────────────────────────

export const userRolesTool: ToolDefinition = {
  name: "iris_user_roles",
  title: "Manage User Roles",
  description:
    "Add or remove a role from an IRIS user account. Returns the updated role list " +
    "after the operation.",
  inputSchema: z.object({
    action: z
      .enum(["add", "remove"])
      .describe("Action to perform: add or remove a role"),
    username: z
      .string()
      .describe("Username to modify roles for"),
    role: z
      .string()
      .describe("Role name to add or remove (e.g., '%All', '%Developer')"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "SYS",
  handler: async (args, ctx) => {
    const { action, username, role } = args as {
      action: string;
      username: string;
      role: string;
    };

    const body = { action, username, role };
    const path = `${BASE_URL}/security/user/roles`;

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
              text: `Error managing roles for user '${username}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_user_password ─────────────────────────────────────────

export const userPasswordTool: ToolDefinition = {
  name: "iris_user_password",
  title: "Manage User Password",
  description:
    "Change a user's password or validate a candidate password against IRIS password rules. " +
    "For 'change', username and password are required. Optional changePasswordOnNextLogin boolean " +
    "forces the user to change their password at next login (sets the ChangePassword flag alongside " +
    "the new password in the same Security.Users.Modify() call). " +
    "For 'validate', only password is needed; the response includes the active password policy " +
    "(policy.minLength and policy.pattern) so callers can see what rules are being enforced. " +
    "Passwords are never included in responses.",
  inputSchema: z.object({
    action: z
      .enum(["change", "validate"])
      .describe("Action: 'change' to set a new password, 'validate' to check password rules"),
    username: z
      .string()
      .optional()
      .describe("Username whose password to change (required for 'change' action)"),
    password: z
      .string()
      .describe("New password to set or candidate password to validate"),
    changePasswordOnNextLogin: z
      .boolean()
      .optional()
      .describe(
        "When true, force the user to change their password on next login " +
          "(sets Security.Users.ChangePassword flag alongside the new password). " +
          "Only valid for 'change' action. Default: leave existing flag unchanged.",
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
    const { action, username, password, changePasswordOnNextLogin } = args as {
      action: string;
      username?: string;
      password: string;
      changePasswordOnNextLogin?: boolean;
    };

    const body: Record<string, unknown> = { action, password };
    if (username) body.username = username;
    if (changePasswordOnNextLogin !== undefined)
      body.changePasswordOnNextLogin = changePasswordOnNextLogin ? 1 : 0;

    const path = `${BASE_URL}/security/user/password`;

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
              text: `Error with password operation: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
