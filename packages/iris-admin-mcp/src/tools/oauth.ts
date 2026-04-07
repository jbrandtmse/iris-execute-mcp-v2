/**
 * OAuth2 configuration management tools for the IRIS Administration MCP server.
 *
 * Provides two tools for managing IRIS OAuth2 configurations via the custom REST endpoint:
 * - {@link oauthManageTool} — Create or delete OAuth2 server definitions and client
 *   registrations, or perform OpenID Connect discovery
 * - {@link oauthListTool} — List all OAuth2 server definitions and registered clients
 *
 * All tools call the custom REST service at `/api/executemcp/v2/security/oauth`.
 * Operations execute in %SYS namespace on the IRIS server.
 *
 * **CRITICAL**: Client secrets are NEVER included in any response (NFR6).
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.oauth.manage ──────────────────────────────────────────

export const oauthManageTool: ToolDefinition = {
  name: "iris.oauth.manage",
  title: "Manage OAuth2 Configuration",
  description:
    "Create or delete OAuth2 server definitions and client registrations, " +
    "or perform OpenID Connect discovery from an issuer URL. " +
    "For 'create' and 'delete', entity ('server' or 'client') is required. " +
    "For 'discover', only issuerURL is needed. " +
    "Client secrets are never returned in responses.",
  inputSchema: z.object({
    action: z
      .enum(["create", "delete", "discover"])
      .describe(
        "Action to perform: 'create' a server/client, 'delete' a server/client, or 'discover' OIDC endpoints",
      ),
    entity: z
      .enum(["server", "client"])
      .optional()
      .describe(
        "Entity type for create/delete actions: 'server' for OAuth2 server definition, 'client' for client registration",
      ),
    issuerURL: z
      .string()
      .optional()
      .describe(
        "Issuer URL for server creation or OIDC discovery (e.g., 'https://accounts.google.com')",
      ),
    name: z
      .string()
      .optional()
      .describe("Name of the server or client to delete"),
    serverName: z
      .string()
      .optional()
      .describe(
        "Name of the OAuth2 server definition to register the client against (required for client create)",
      ),
    clientName: z
      .string()
      .optional()
      .describe("Application name for the client registration (required for client create)"),
    redirectURIs: z
      .string()
      .optional()
      .describe("Redirect URI(s) for the client application"),
    grantTypes: z
      .string()
      .optional()
      .describe("Allowed grant types (e.g., 'authorization_code,refresh_token')"),
    clientType: z
      .string()
      .optional()
      .describe("Client type: 'public' or 'confidential'"),
    description: z
      .string()
      .optional()
      .describe("Description for the server or client"),
    supportedScopes: z
      .string()
      .optional()
      .describe("Supported scopes for server creation (e.g., 'openid profile email')"),
    accessTokenInterval: z
      .number()
      .optional()
      .describe("Access token lifetime in seconds (server create)"),
    authorizationCodeInterval: z
      .number()
      .optional()
      .describe("Authorization code lifetime in seconds (server create)"),
    refreshTokenInterval: z
      .number()
      .optional()
      .describe("Refresh token lifetime in seconds (server create)"),
    signingAlgorithm: z
      .string()
      .optional()
      .describe("Token signing algorithm (server create, e.g., 'RS256')"),
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
      entity,
      issuerURL,
      name,
      serverName,
      clientName,
      redirectURIs,
      grantTypes,
      clientType,
      description,
      supportedScopes,
      accessTokenInterval,
      authorizationCodeInterval,
      refreshTokenInterval,
      signingAlgorithm,
    } = args as {
      action: string;
      entity?: string;
      issuerURL?: string;
      name?: string;
      serverName?: string;
      clientName?: string;
      redirectURIs?: string;
      grantTypes?: string;
      clientType?: string;
      description?: string;
      supportedScopes?: string;
      accessTokenInterval?: number;
      authorizationCodeInterval?: number;
      refreshTokenInterval?: number;
      signingAlgorithm?: string;
    };

    const body: Record<string, unknown> = { action };
    if (entity !== undefined) body.entity = entity;
    if (issuerURL !== undefined) body.issuerURL = issuerURL;
    if (name !== undefined) body.name = name;
    if (serverName !== undefined) body.serverName = serverName;
    if (clientName !== undefined) body.clientName = clientName;
    if (redirectURIs !== undefined) body.redirectURIs = redirectURIs;
    if (grantTypes !== undefined) body.grantTypes = grantTypes;
    if (clientType !== undefined) body.clientType = clientType;
    if (description !== undefined) body.description = description;
    if (supportedScopes !== undefined) body.supportedScopes = supportedScopes;
    if (accessTokenInterval !== undefined)
      body.accessTokenInterval = accessTokenInterval;
    if (authorizationCodeInterval !== undefined)
      body.authorizationCodeInterval = authorizationCodeInterval;
    if (refreshTokenInterval !== undefined)
      body.refreshTokenInterval = refreshTokenInterval;
    if (signingAlgorithm !== undefined)
      body.signingAlgorithm = signingAlgorithm;

    const path = `${BASE_URL}/security/oauth`;

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
              text: `Error managing OAuth2 configuration: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.oauth.list ───────────────────────────────────────────

export const oauthListTool: ToolDefinition = {
  name: "iris.oauth.list",
  title: "List OAuth2 Configurations",
  description:
    "List all IRIS OAuth2 server definitions and registered client applications. " +
    "Returns server definitions (issuer endpoint, scopes, token lifetimes, signing algorithm) " +
    "and client registrations (application name, server, client ID, client type, redirect URL). " +
    "Client secrets are never included in the response.",
  inputSchema: z.object({
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
  handler: async (_args, ctx) => {
    const path = `${BASE_URL}/security/oauth`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as {
        servers?: Array<Record<string, unknown>>;
        clients?: Array<Record<string, unknown>>;
        serverCount?: number;
        clientCount?: number;
      };

      // The IRIS handler returns {servers, clients, serverCount, clientCount}
      const servers = Array.isArray(rawResult?.servers)
        ? rawResult.servers
        : [];
      const clients = Array.isArray(rawResult?.clients)
        ? rawResult.clients
        : [];

      // OAuth2 configs are returned as two separate collections (servers + clients).
      // Combined pagination would mix entity types in a single page, so we return
      // the full collections and omit cursor-based paging for this endpoint.
      const result = {
        servers: servers,
        clients: clients,
        serverCount: servers.length,
        clientCount: clients.length,
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
              text: `Error listing OAuth2 configurations: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
