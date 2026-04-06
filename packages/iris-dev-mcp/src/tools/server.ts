/**
 * Server information tools for the IRIS Development MCP server.
 *
 * Provides two read-only tools for inspecting IRIS server state:
 * - {@link serverInfoTool} — Retrieve IRIS version, platform, and instance name
 * - {@link serverNamespaceTool} — Retrieve namespace details including databases and features
 *
 * These tools use the Atelier REST API via the shared {@link IrisHttpClient}.
 */

import { atelierPath, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

// ── iris.server.info ──────────────────────────────────────────────

export const serverInfoTool: ToolDefinition = {
  name: "iris.server.info",
  title: "Server Info",
  description:
    "Retrieve IRIS server information including version, platform, and instance name. " +
    "No namespace context is needed.",
  inputSchema: z.object({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (_args, ctx) => {
    // The root Atelier endpoint returns server info
    const response = await ctx.http.get("/api/atelier/");

    const result = response.result;
    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
    };
  },
};

// ── iris.server.namespace ─────────────────────────────────────────

export const serverNamespaceTool: ToolDefinition = {
  name: "iris.server.namespace",
  title: "Namespace Info",
  description:
    "Retrieve details about an IRIS namespace, including associated databases and enabled features.",
  inputSchema: z.object({
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { namespace } = args as { namespace?: string };

    const ns = ctx.resolveNamespace(namespace);
    // The namespace-level Atelier endpoint returns namespace details
    const path = atelierPath(ctx.atelierVersion, ns, "");

    const response = await ctx.http.get(path);

    const result = response.result;
    return {
      content: [
        { type: "text", text: JSON.stringify(result, null, 2) },
      ],
      structuredContent: result,
    };
  },
};
