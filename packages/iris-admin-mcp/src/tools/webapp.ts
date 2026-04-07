/**
 * Web application management tools for the IRIS Administration MCP server.
 *
 * Provides three tools for managing IRIS CSP/REST web applications via the custom REST endpoint:
 * - {@link webappManageTool} — Create, modify, or delete a web application
 * - {@link webappGetTool} — Get a single web application by name
 * - {@link webappListTool} — List all web applications, optionally filtered by namespace
 *
 * All tools call the custom REST service at `/api/executemcp/v2/security/webapp`.
 * Operations execute in %SYS namespace on the IRIS server.
 *
 * NOTE: Security.Applications.Create() does NOT notify the CSP gateway.
 * Newly created web apps require saving through the Management Portal
 * or restarting the CSP gateway to become active.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.webapp.manage ─────────────────────────────────────────

export const webappManageTool: ToolDefinition = {
  name: "iris.webapp.manage",
  title: "Manage Web Application",
  description:
    "Create, modify, or delete an IRIS CSP/REST web application. For 'create', " +
    "name is required (must start with '/'). For 'modify', only provided fields " +
    "are updated. For 'delete', only the name is needed. " +
    "NOTE: Creating a web app does NOT notify the CSP gateway — save through " +
    "the Management Portal or restart the CSP gateway to activate.",
  inputSchema: z.object({
    action: z
      .enum(["create", "modify", "delete"])
      .describe("Action to perform on the web application"),
    name: z
      .string()
      .describe("Web application path (must start with '/', e.g., '/api/myapp')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace for the web application"),
    dispatchClass: z
      .string()
      .optional()
      .describe("REST dispatch class name (e.g., 'MyApp.REST.Dispatch')"),
    description: z
      .string()
      .optional()
      .describe("Description of the web application"),
    enabled: z
      .union([z.boolean(), z.number()])
      .optional()
      .describe("Whether the web application is enabled (1/true or 0/false)"),
    authEnabled: z
      .number()
      .optional()
      .describe("Authentication method bitmask (e.g., 32=Password, 64=Kerberos)"),
    isNameSpaceDefault: z
      .union([z.boolean(), z.number()])
      .optional()
      .describe("Whether this is the default app for the namespace (1/true or 0/false)"),
    cspZenEnabled: z
      .union([z.boolean(), z.number()])
      .optional()
      .describe("Enable CSP/ZEN support (1/true or 0/false)"),
    recurse: z
      .union([z.boolean(), z.number()])
      .optional()
      .describe("Enable subdirectory access (1/true or 0/false)"),
    matchRoles: z
      .string()
      .optional()
      .describe("Roles required to access the application (colon-separated)"),
    resource: z
      .string()
      .optional()
      .describe("Resource required for access"),
    cookiePath: z
      .string()
      .optional()
      .describe("Cookie path for the web application"),
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
      namespace,
      dispatchClass,
      description,
      enabled,
      authEnabled,
      isNameSpaceDefault,
      cspZenEnabled,
      recurse,
      matchRoles,
      resource,
      cookiePath,
    } = args as {
      action: string;
      name: string;
      namespace?: string;
      dispatchClass?: string;
      description?: string;
      enabled?: boolean | number;
      authEnabled?: number;
      isNameSpaceDefault?: boolean | number;
      cspZenEnabled?: boolean | number;
      recurse?: boolean | number;
      matchRoles?: string;
      resource?: string;
      cookiePath?: string;
    };

    const body: Record<string, unknown> = { action, name };
    if (namespace !== undefined) body.namespace = namespace;
    if (dispatchClass !== undefined) body.dispatchClass = dispatchClass;
    if (description !== undefined) body.description = description;
    if (enabled !== undefined) body.enabled = enabled ? 1 : 0;
    if (authEnabled !== undefined) body.authEnabled = authEnabled;
    if (isNameSpaceDefault !== undefined)
      body.isNameSpaceDefault = isNameSpaceDefault ? 1 : 0;
    if (cspZenEnabled !== undefined)
      body.cspZenEnabled = cspZenEnabled ? 1 : 0;
    if (recurse !== undefined) body.recurse = recurse ? 1 : 0;
    if (matchRoles !== undefined) body.matchRoles = matchRoles;
    if (resource !== undefined) body.resource = resource;
    if (cookiePath !== undefined) body.cookiePath = cookiePath;

    const path = `${BASE_URL}/security/webapp`;

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
              text: `Error managing web application '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.webapp.get ─────────────────────────────────────────────

export const webappGetTool: ToolDefinition = {
  name: "iris.webapp.get",
  title: "Get Web Application",
  description:
    "Get an IRIS CSP/REST web application by name. Returns all web application " +
    "properties including namespace, dispatch class, authentication settings, " +
    "and enabled status. Uses POST to avoid URL-encoding issues with forward " +
    "slashes in application paths.",
  inputSchema: z.object({
    name: z
      .string()
      .describe("Web application path (e.g., '/csp/user', '/api/myapp')"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "SYS",
  handler: async (args, ctx) => {
    const { name } = args as { name: string };

    const path = `${BASE_URL}/security/webapp/get`;

    try {
      const response = await ctx.http.post(path, { name });
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
              text: `Error getting web application '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.webapp.list ────────────────────────────────────────────

export const webappListTool: ToolDefinition = {
  name: "iris.webapp.list",
  title: "List Web Applications",
  description:
    "List all IRIS CSP/REST web applications. Optionally filter by namespace. " +
    "Returns web application name, namespace, dispatch class, enabled status, " +
    "and other configuration properties.",
  inputSchema: z.object({
    namespace: z
      .string()
      .optional()
      .describe("Filter web applications by target namespace (e.g., 'USER', 'HSLIB')"),
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
  scope: "BOTH",
  handler: async (args, ctx) => {
    const { namespace, cursor } = args as {
      namespace?: string;
      cursor?: string;
    };

    let path = `${BASE_URL}/security/webapp`;
    if (namespace) {
      path += `?namespace=${encodeURIComponent(namespace)}`;
    }

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as Array<Record<string, unknown>>;
      const allApps = Array.isArray(rawResult) ? rawResult : [];
      const { page, nextCursor } = ctx.paginate(allApps, cursor);
      const result = {
        webapps: page,
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
              text: `Error listing web applications: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
