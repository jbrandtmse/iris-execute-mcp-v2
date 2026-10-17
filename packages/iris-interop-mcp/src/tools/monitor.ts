/**
 * Production monitoring tools for the IRIS Interoperability MCP server.
 *
 * Provides four read-only tools for monitoring IRIS Interoperability productions:
 * - {@link productionLogsTool} — Query event log entries filtered by type, item, count
 * - {@link productionQueuesTool} — Return queue status for all production items
 * - {@link productionMessagesTool} — Trace message flow by session or header ID
 * - {@link productionAdaptersTool} — List available adapter types by category
 *
 * All tools call the custom REST service at `/api/executemcp/v2/interop/production`.
 * All tools are annotated with `readOnlyHint: true` and have scope NS.
 */

import {
  BLOCK_REASONS,
  IrisApiError,
  effectiveDataPolicy,
  type DataPolicySummary,
  type ToolDefinition,
} from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

/**
 * The Event Log result with every entry's `text` withheld (the `block` data policy): the entry is rebuilt with
 * the same keys in the same order, `text` replaced in place by `textPolicy {outcome: "blocked", reason}`. Every
 * other key of the result is kept, `dataPolicy` is added, and the withheld count is the number of entries.
 * Withholding is by policy and by the entry's own `text` key, never by looking at the text.
 */
function withholdLogText(result: unknown): Record<string, unknown> {
  const source =
    result !== null && typeof result === "object" && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : {};
  const rows = Array.isArray(source.entries) ? source.entries : [];
  const textPolicy = { outcome: "blocked" as const, reason: BLOCK_REASONS.eventLogText() };
  const entries = rows.map((row: unknown) => {
    const entry =
      row !== null && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : {};
    const rebuilt: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(entry)) {
      if (key === "text") rebuilt.textPolicy = textPolicy;
      else rebuilt[key] = value;
    }
    if (!Object.prototype.hasOwnProperty.call(rebuilt, "textPolicy")) rebuilt.textPolicy = textPolicy;
    return rebuilt;
  });
  const dataPolicy: DataPolicySummary = { policy: "block", redacted: 0, blocked: entries.length };
  return { ...source, entries, dataPolicy };
}

// ── iris_production_logs ─────────────────────────────────────

export const productionLogsTool: ToolDefinition = {
  name: "iris_production_logs",
  title: "Production Logs",
  description:
    "Query event log entries from an Interoperability production. Returns entries from " +
    "Ens_Util.Log with timestamp, type, item name, and message text. " +
    "Filter by log type (Info/Warning/Error/Trace/Assert/Alert), config item name, " +
    "and maximum row count. Under the block PHI data policy (IRIS_DATA_POLICY) each entry's text is " +
    "withheld with a reason in textPolicy; under redact and allow it is shown unchanged.",
  inputSchema: z.object({
    type: z
      .enum(["Info", "Warning", "Error", "Trace", "Assert", "Alert"])
      .optional()
      .describe("Filter by log type"),
    itemName: z
      .string()
      .optional()
      .describe("Filter by config item name (exact match)"),
    count: z
      .number()
      .optional()
      .describe("Maximum number of log entries to return (default: 100, max: 10000)"),
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
  // Story 39.7 (AD-26, decision #31): the policy governs every call, under `block` only. The audit entry
  // carries `dataPolicy` from the response's own counts; under redact and allow the response has none, so the
  // entry records the profile's policy with 0 counts.
  dataPolicy: {},
  handler: async (args, ctx) => {
    const { type, itemName, count, namespace } = args as {
      type?: string;
      itemName?: string;
      count?: number;
      namespace?: string;
    };

    const blocked = effectiveDataPolicy(ctx.config) === "block";
    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);
    if (type) params.set("type", type);
    if (itemName) params.set("itemName", itemName);
    if (count !== undefined) params.set("count", String(count));

    const path = `${BASE_URL}/interop/production/logs?${params}`;

    try {
      const response = await ctx.http.get(path);
      const result = blocked ? withholdLogText(response.result) : response.result;
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
              text: `Error querying production logs: ${error.message}`,
            },
          ],
          ...(blocked
            ? { structuredContent: { dataPolicy: { policy: "block", redacted: 0, blocked: 0 } } }
            : {}),
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_production_queues ───────────────────────────────────

export const productionQueuesTool: ToolDefinition = {
  name: "iris_production_queues",
  title: "Production Queues",
  description:
    "Return queue status for all production items including message queue count. " +
    "Shows the current number of messages queued for each config item in the production.",
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
    const { namespace } = args as { namespace?: string };

    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);

    const path = `${BASE_URL}/interop/production/queues?${params}`;

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
              text: `Error querying production queues: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_production_messages ─────────────────────────────────

export const productionMessagesTool: ToolDefinition = {
  name: "iris_production_messages",
  title: "Production Messages",
  description:
    "Trace message flow through a production by session ID or header ID. " +
    "At least one of sessionId or headerId is required. " +
    "Each message step includes source item, target item, message class, timestamp, " +
    "and status. Use sessionId to see all messages in a session, or headerId for a specific message.",
  inputSchema: z.object({
    sessionId: z
      .number()
      .optional()
      .describe("Session ID to trace (returns all messages in the session)"),
    headerId: z
      .number()
      .optional()
      .describe("Specific message header ID to look up"),
    count: z
      .number()
      .optional()
      .describe(
        "Maximum number of messages to return (default: 100, max: 10000)",
      ),
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
    const { sessionId, headerId, count, namespace } = args as {
      sessionId?: number;
      headerId?: number;
      count?: number;
      namespace?: string;
    };

    if (sessionId === undefined && headerId === undefined) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: at least one of 'sessionId' or 'headerId' is required",
          },
        ],
        isError: true,
      };
    }

    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);
    if (sessionId !== undefined) params.set("sessionId", String(sessionId));
    if (headerId !== undefined) params.set("headerId", String(headerId));
    if (count !== undefined) params.set("count", String(count));

    const path = `${BASE_URL}/interop/production/messages?${params}`;

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
              text: `Error tracing production messages: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_production_adapters ────────────────────────────────

export const productionAdaptersTool: ToolDefinition = {
  name: "iris_production_adapters",
  title: "Production Adapters",
  description:
    "List available Interoperability adapter types grouped by category (Inbound/Outbound). " +
    "Shows non-abstract adapter classes that extend Ens.InboundAdapter or Ens.OutboundAdapter. " +
    "Optionally filter by category.",
  inputSchema: z.object({
    category: z
      .enum(["inbound", "outbound"])
      .optional()
      .describe("Filter by adapter category (default: all categories)"),
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
    const { category, namespace } = args as {
      category?: string;
      namespace?: string;
    };

    const ns = ctx.resolveNamespace(namespace);
    const params = new URLSearchParams();
    params.set("namespace", ns);
    if (category) params.set("category", category);

    const path = `${BASE_URL}/interop/production/adapters?${params}`;

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
              text: `Error listing production adapters: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
