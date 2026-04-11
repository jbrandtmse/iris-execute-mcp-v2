/**
 * Credential management tools for the IRIS Interoperability MCP server.
 *
 * Provides two tools for managing Ensemble credentials:
 * - {@link credentialManageTool} — Create, update, or delete credentials
 * - {@link credentialListTool} — List credentials (never exposes passwords)
 *
 * All tools call the custom REST service at `/api/executemcp/v2/interop/credential`.
 * Passwords are write-only and never returned in any response (NFR6).
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_credential_manage ──────────────────────────────────────

export const credentialManageTool: ToolDefinition = {
  name: "iris_credential_manage",
  title: "Manage Credential",
  description:
    "Create, update, or delete an Ensemble credential. " +
    "'create' stores a new credential with ID, username, and password. " +
    "'update' modifies the username or password of an existing credential. " +
    "'delete' removes a credential by ID. Passwords are write-only and never returned.",
  inputSchema: z.object({
    action: z
      .enum(["create", "update", "delete"])
      .describe("Action to perform: 'create', 'update', or 'delete'"),
    id: z
      .string()
      .describe("Credential system name / ID (e.g., 'SMTP-Relay')"),
    username: z
      .string()
      .optional()
      .describe("Username for the credential (required for create, optional for update)"),
    password: z
      .string()
      .optional()
      .describe("Password for the credential (write-only, never returned)"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace. Defaults to the server's configured namespace; pass an explicit value to query a different namespace per call without changing the connection default."),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, id, username, password, namespace } = args as {
      action: string;
      id: string;
      username?: string;
      password?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, string> = { action, id, namespace: ns };
    if (username !== undefined) body.username = username;
    if (password !== undefined) body.password = password;

    const path = `${BASE_URL}/interop/credential`;

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
              text: `Error managing credential '${id}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_credential_list ────────────────────────────────────────

export const credentialListTool: ToolDefinition = {
  name: "iris_credential_list",
  title: "List Credentials",
  description:
    "List all stored Ensemble credentials with their IDs and usernames. " +
    "Passwords are never included in the response (NFR6 security requirement).",
  inputSchema: z.object({
    namespace: z
      .string()
      .optional()
      .describe("Target namespace. Defaults to the server's configured namespace; pass an explicit value to query a different namespace per call without changing the connection default."),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { namespace } = args as {
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);

    const path = `${BASE_URL}/interop/credential?${params}`;

    try {
      const response = await ctx.http.get(path);
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
              text: `Error listing credentials: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
