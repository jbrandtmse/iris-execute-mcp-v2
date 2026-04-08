/**
 * Production lifecycle tools for the IRIS Interoperability MCP server.
 *
 * Provides four tools for managing IRIS Interoperability productions:
 * - {@link productionManageTool} — Create or delete a production
 * - {@link productionControlTool} — Start, stop, restart, update, or recover
 * - {@link productionStatusTool} — Query production status with optional detail
 * - {@link productionSummaryTool} — Cross-namespace production summary
 *
 * All tools call the custom REST service at `/api/executemcp/v2/interop/production`.
 * Ens.* classes operate in the target namespace (not %SYS).
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris.production.manage ────────────���────────────────────────

export const productionManageTool: ToolDefinition = {
  name: "iris.production.manage",
  title: "Manage Production",
  description:
    "Create or delete an Interoperability production. For 'create', provides an empty " +
    "production class. For 'delete', the production must be stopped first. " +
    "Use iris.production.control to start/stop productions.",
  inputSchema: z.object({
    action: z
      .enum(["create", "delete"])
      .describe("Action to perform: 'create' a new production or 'delete' an existing one"),
    name: z
      .string()
      .describe("Fully qualified production class name (e.g., 'MyApp.Production')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace where the production lives (default: configured namespace)"),
  }),
  annotations: {
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, name, namespace } = args as {
      action: string;
      name: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, string> = { action, name, namespace: ns };
    const path = `${BASE_URL}/interop/production`;

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
              text: `Error managing production '${name}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.production.control ────────────────────────────────────

export const productionControlTool: ToolDefinition = {
  name: "iris.production.control",
  title: "Control Production",
  description:
    "Start, stop, restart, update, or recover an Interoperability production. " +
    "'start' and 'restart' require the production name. 'stop' halts the current production. " +
    "'update' applies configuration changes to a running production. " +
    "'recover' attempts to restart a troubled production.",
  inputSchema: z.object({
    action: z
      .enum(["start", "stop", "restart", "update", "recover"])
      .describe("Lifecycle action to perform on the production"),
    name: z
      .string()
      .optional()
      .describe("Production class name (required for start and restart)"),
    timeout: z
      .number()
      .optional()
      .describe("Seconds to wait for stop/restart (default: 120)"),
    force: z
      .boolean()
      .optional()
      .describe("Force stop/recover on timeout (default: false)"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }).refine(
    (data) => {
      if (data.action === "start" || data.action === "restart") {
        return !!data.name;
      }
      return true;
    },
    { message: "'name' is required for 'start' and 'restart' actions", path: ["name"] },
  ),
  annotations: {
    destructiveHint: false,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { action, name, timeout, force, namespace } = args as {
      action: string;
      name?: string;
      timeout?: number;
      force?: boolean;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, unknown> = { action, namespace: ns };
    if (name) body.name = name;
    if (timeout !== undefined) body.timeout = timeout;
    if (force !== undefined) body.force = force;

    const path = `${BASE_URL}/interop/production/control`;

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
              text: `Error controlling production: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.production.status ───────────���─────────────────────────

export const productionStatusTool: ToolDefinition = {
  name: "iris.production.status",
  title: "Production Status",
  description:
    "Get the current production status in a namespace. Returns production name, " +
    "state (Running/Stopped/Suspended/Troubled/NetworkStopped), and state code. " +
    "Set detail=true to include item-level status (name, class, enabled, adapter).",
  inputSchema: z.object({
    detail: z
      .boolean()
      .optional()
      .describe("Include item-level detail when true (default: false)"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace (default: configured namespace)"),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NS",
  handler: async (args, ctx) => {
    const { detail, namespace } = args as {
      detail?: boolean;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    if (detail) params.set("detail", "1");
    params.set("namespace", ns);

    const qs = params.toString();
    const path = `${BASE_URL}/interop/production/status${qs ? `?${qs}` : ""}`;

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
              text: `Error getting production status: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.production.summary ────────────────��───────────────────

export const productionSummaryTool: ToolDefinition = {
  name: "iris.production.summary",
  title: "Production Summary",
  description:
    "Get a cross-namespace summary of all Interoperability productions. " +
    "Iterates all namespaces and returns production name and state for each " +
    "namespace that has a configured production. No namespace parameter needed.",
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
  scope: "NONE",
  handler: async (args, ctx) => {
    const { cursor } = args as { cursor?: string };

    const path = `${BASE_URL}/interop/production/summary`;

    try {
      const response = await ctx.http.get(path);
      const rawResult = response.result as Array<{
        namespace: string;
        name: string;
        state: string;
        stateCode: number;
      }>;
      const allProductions = Array.isArray(rawResult) ? rawResult : [];
      const { page, nextCursor } = ctx.paginate(allProductions, cursor);
      const result = {
        productions: page,
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
              text: `Error getting production summary: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
