/**
 * SSL/TLS configuration management tools for the IRIS Administration MCP server.
 *
 * Provides two tools for managing IRIS SSL/TLS configurations via the custom REST endpoint:
 * - {@link sslManageTool} — Create, modify, or delete an SSL/TLS configuration
 * - {@link sslListTool} — List all SSL/TLS configurations
 *
 * All tools call the custom REST service at `/api/executemcp/v2/security/ssl`.
 * Operations execute in %SYS namespace on the IRIS server.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_ssl_manage ─────────────────────────────────────────────

export const sslManageTool: ToolDefinition = {
  name: "iris_ssl_manage",
  title: "Manage SSL/TLS Configuration",
  description:
    "Create, modify, or delete an IRIS SSL/TLS configuration. For 'create', " +
    "name is required. For 'modify', only provided fields are updated. " +
    "For 'delete', only the name is needed.",
  inputSchema: z.object({
    action: z
      .enum(["create", "modify", "delete"])
      .describe("Action to perform on the SSL/TLS configuration"),
    name: z
      .string()
      .max(64)
      .describe("SSL/TLS configuration name (case-sensitive, max 64 chars)"),
    description: z
      .string()
      .optional()
      .describe("Description of the SSL/TLS configuration"),
    certFile: z
      .string()
      .optional()
      .describe("Path to the certificate file on the IRIS server"),
    keyFile: z
      .string()
      .optional()
      .describe("Path to the private key file on the IRIS server"),
    caFile: z
      .string()
      .optional()
      .describe("Path to the CA certificate file on the IRIS server"),
    caPath: z
      .string()
      .optional()
      .describe("Path to the CA certificate directory on the IRIS server"),
    cipherList: z
      .string()
      .optional()
      .describe("Allowed cipher list for TLS connections"),
    tlsMinVersion: z
      .number()
      .optional()
      .describe("Minimum TLS version bit (4=TLS1.0, 8=TLS1.1, 16=TLS1.2, 32=TLS1.3)"),
    tlsMaxVersion: z
      .number()
      .optional()
      .describe("Maximum TLS version bit (4=TLS1.0, 8=TLS1.1, 16=TLS1.2, 32=TLS1.3)"),
    verifyPeer: z
      .number()
      .optional()
      .describe("Peer verification mode: 0=none, 1=require"),
    verifyDepth: z
      .number()
      .optional()
      .describe("Certificate chain verification depth"),
    type: z
      .number()
      .optional()
      .describe("Configuration type: 0=client, 1=server"),
    enabled: z
      .union([z.boolean(), z.number()])
      .optional()
      .describe("Whether the SSL/TLS configuration is enabled (1/true or 0/false)"),
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
      description,
      certFile,
      keyFile,
      caFile,
      caPath,
      cipherList,
      tlsMinVersion,
      tlsMaxVersion,
      verifyPeer,
      verifyDepth,
      type,
      enabled,
    } = args as {
      action: string;
      name: string;
      description?: string;
      certFile?: string;
      keyFile?: string;
      caFile?: string;
      caPath?: string;
      cipherList?: string;
      tlsMinVersion?: number;
      tlsMaxVersion?: number;
      verifyPeer?: number;
      verifyDepth?: number;
      type?: number;
      enabled?: boolean | number;
    };

    const body: Record<string, unknown> = { action, name };
    if (description !== undefined) body.description = description;
    if (certFile !== undefined) body.certFile = certFile;
    if (keyFile !== undefined) body.keyFile = keyFile;
    if (caFile !== undefined) body.caFile = caFile;
    if (caPath !== undefined) body.caPath = caPath;
    if (cipherList !== undefined) body.cipherList = cipherList;
    // Bug #6 (pre-release BREAKING, paired with Story 11.2 server-side break):
    // the deprecated `protocols` bitmask is replaced with separate
    // `tlsMinVersion` + `tlsMaxVersion` %Integer fields. Server rejects
    // `protocols` now — no compatibility shim.
    if (tlsMinVersion !== undefined) body.tlsMinVersion = tlsMinVersion;
    if (tlsMaxVersion !== undefined) body.tlsMaxVersion = tlsMaxVersion;
    if (verifyPeer !== undefined) body.verifyPeer = verifyPeer;
    if (verifyDepth !== undefined) body.verifyDepth = verifyDepth;
    if (type !== undefined) body.type = type;
    if (enabled !== undefined) body.enabled = enabled ? 1 : 0;

    const path = `${BASE_URL}/security/ssl`;

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
              text: `Error managing SSL/TLS configuration '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_ssl_list ──────────────────────────────────────────────

export const sslListTool: ToolDefinition = {
  name: "iris_ssl_list",
  title: "List SSL/TLS Configurations",
  description:
    "List all IRIS SSL/TLS configurations. Returns configuration name, " +
    "description, certificate paths, TLS min/max version bits " +
    "(tlsMinVersion, tlsMaxVersion; 4=TLS1.0, 8=TLS1.1, 16=TLS1.2, 32=TLS1.3), " +
    "verification settings, type (client/server), and enabled status.",
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
  handler: async (args, ctx) => {
    const { cursor } = args as { cursor?: string };

    const path = `${BASE_URL}/security/ssl`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as Array<Record<string, unknown>>;
      const allConfigs = Array.isArray(rawResult) ? rawResult : [];
      const { page, nextCursor } = ctx.paginate(allConfigs, cursor);
      const result = {
        sslConfigs: page,
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
              text: `Error listing SSL/TLS configurations: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
