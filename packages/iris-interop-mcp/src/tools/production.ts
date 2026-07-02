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

// ── iris_production_manage ────────────���────────────────────────

export const productionManageTool: ToolDefinition = {
  name: "iris_production_manage",
  title: "Manage Production",
  description:
    "Create or delete an Interoperability production. For 'create', provides an empty " +
    "production class. For 'delete', the production must be stopped first. " +
    "Use iris_production_control to start/stop productions.",
  inputSchema: z.object({
    action: z
      .enum(["create", "delete"])
      .describe("Action to perform: 'create' a new production or 'delete' an existing one"),
    name: z
      .string()
      .min(1, "Production name must not be empty")
      .describe("Fully qualified production class name (e.g., 'MyApp.Production')"),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace where the production lives. Defaults to the server's configured namespace; pass an explicit value to manage a production in a different namespace per call without changing the connection default."),
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

// ── iris_production_control ────────────────────────────────────

export const productionControlTool: ToolDefinition = {
  name: "iris_production_control",
  title: "Control Production",
  description:
    "Start, stop, restart, update, recover, or clean an Interoperability production. " +
    "'start' and 'restart' require the production name. 'stop' halts the current production. " +
    "'update' applies configuration changes to a running production. " +
    "'recover' attempts to restart a troubled production. " +
    "'clean' clears a STOPPED production's stale runtime state (queues, job-status, " +
    "suspended messages) to unwedge a production that 'recover' cannot fix. " +
    "For a troubled production, prefer 'recover' first; use 'clean' only as a LAST RESORT " +
    "when 'recover' does not resolve the problem. By default 'clean' touches only transient " +
    "runtime state; set killAppData:true (with confirm:true) to ALSO wipe persistent " +
    "^Ens.AppData business state.\n\n" +
    "The 'clean' action is a write but is ENABLED by default under tool governance " +
    "(like the grandfathered lifecycle actions); an operator can disable it via an " +
    "explicit IRIS_GOVERNANCE override.",
  inputSchema: z.object({
    action: z
      .enum(["start", "stop", "restart", "update", "recover", "clean"])
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
      .describe("Force stop on timeout (default: false)"),
    killAppData: z
      .boolean()
      .optional()
      .describe(
        "(clean only) When true, ALSO wipe the persistent ^Ens.AppData business " +
          "state — HL7 sequence numbers, file/FTP done-file tables (wiping these " +
          "causes re-ingestion of already-processed files → DUPLICATE messages), " +
          "and RecordMap/X12 batch + control-number state. DESTRUCTIVE and " +
          "irreversible; requires confirm:true. When false/omitted, only transient " +
          "runtime state is cleared (default: false).",
      ),
    confirm: z
      .boolean()
      .optional()
      .describe(
        "(clean only) Must be true to permit a killAppData persistent wipe. " +
          "killAppData:true without confirm:true is refused and changes nothing.",
      ),
    namespace: z
      .string()
      .optional()
      .describe("Target namespace. Defaults to the server's configured namespace; pass an explicit value to query a different namespace per call without changing the connection default."),
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
    destructiveHint: true,
    readOnlyHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NS",
  // Governance (Epic 20, decision F2 — frozen-foundation model): the 5 existing
  // lifecycle actions (start/stop/restart/update/recover) are in the frozen
  // baseline (1e62c5ad5bf7) → grandfathered, so they are NOT declared here. The
  // NEW 'clean' key is absent from the baseline → it MUST be classified; it is a
  // write (destructiveHint stays true). But unlike the item add/remove writes,
  // 'clean' ships ENABLED by default via `defaultEnabled` — a recovery operation
  // an operator expects available — while remaining truthfully `mutates: "write"`.
  // An operator can still disable it via an explicit IRIS_GOVERNANCE false.
  mutates: {
    clean: "write",
  },
  defaultEnabled: ["clean"],
  handler: async (args, ctx) => {
    const { action, name, timeout, force, killAppData, confirm, namespace } = args as {
      action: string;
      name?: string;
      timeout?: number;
      force?: boolean;
      killAppData?: boolean;
      confirm?: boolean;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const body: Record<string, unknown> = { action, namespace: ns };
    if (name) body.name = name;
    if (timeout !== undefined) body.timeout = timeout;
    if (force !== undefined) body.force = force;
    if (killAppData !== undefined) body.killAppData = killAppData;
    if (confirm !== undefined) body.confirm = confirm;

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

// ── iris_production_status ───────────���─────────────────────────

export const productionStatusTool: ToolDefinition = {
  name: "iris_production_status",
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

// ── iris_production_summary ────────────────��───────────────────

export const productionSummaryTool: ToolDefinition = {
  name: "iris_production_summary",
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
