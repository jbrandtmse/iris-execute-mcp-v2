/**
 * System metrics, alerts, and interoperability monitoring tools.
 *
 * Provides three read-only tools for IRIS system health monitoring:
 * - {@link metricsSystemTool} — System metrics in Prometheus text exposition format
 * - {@link metricsAlertsTool} — Active system alerts with severity and state
 * - {@link metricsInteropTool} — Interoperability volume and interface metrics
 *
 * All tools call the custom REST service at `/api/executemcp/v2/monitor`.
 * Scope is NONE — no namespace parameter needed for system-level tools
 * (interop tool optionally accepts namespace for single-namespace queries).
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── Prometheus text formatting helpers ────────────────────────

interface MetricEntry {
  name: string;
  help: string;
  type: string;
  value: number;
  labels?: Record<string, string>;
}

/**
 * Format a single metric entry as Prometheus text exposition lines.
 */
function formatPrometheusMetric(m: MetricEntry): string {
  const lines: string[] = [];
  lines.push(`# HELP ${m.name} ${m.help}`);
  lines.push(`# TYPE ${m.name} ${m.type}`);
  if (m.labels && Object.keys(m.labels).length > 0) {
    const labelStr = Object.entries(m.labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(",");
    lines.push(`${m.name}{${labelStr}} ${m.value}`);
  } else {
    lines.push(`${m.name} ${m.value}`);
  }
  return lines.join("\n");
}

// ── iris.metrics.system ───────────────────────────────────────

export const metricsSystemTool: ToolDefinition = {
  name: "iris.metrics.system",
  title: "System Metrics",
  description:
    "Returns IRIS system metrics in Prometheus text exposition format. " +
    "Includes process count, global references, routine commands, " +
    "uptime, and database sizes. No parameters required.",
  inputSchema: z.object({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (_args, ctx) => {
    const path = `${BASE_URL}/monitor/system`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        metrics: MetricEntry[];
        databases: Array<{
          name: string;
          directory: string;
          sizeMB: number;
          maxSizeMB: number;
        }>;
      };

      // Format metrics array as Prometheus text
      const lines: string[] = [];
      if (Array.isArray(result.metrics)) {
        for (const m of result.metrics) {
          lines.push(formatPrometheusMetric(m));
        }
      }

      // Add database size metrics
      if (Array.isArray(result.databases)) {
        lines.push(`# HELP iris_db_size_mb Database size in megabytes`);
        lines.push(`# TYPE iris_db_size_mb gauge`);
        for (const db of result.databases) {
          lines.push(`iris_db_size_mb{db="${db.name}"} ${db.sizeMB}`);
        }
        lines.push(`# HELP iris_db_max_size_mb Database max size in megabytes`);
        lines.push(`# TYPE iris_db_max_size_mb gauge`);
        for (const db of result.databases) {
          lines.push(`iris_db_max_size_mb{db="${db.name}"} ${db.maxSizeMB}`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving system metrics: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.metrics.alerts ───────────────────────────────────────

export const metricsAlertsTool: ToolDefinition = {
  name: "iris.metrics.alerts",
  title: "System Alerts",
  description:
    "Returns active IRIS system alerts. Each alert includes severity, " +
    "category, message, and index. Also returns the overall system state " +
    "(OK, Warning, Alert, Hung) and alert count. No parameters required.",
  inputSchema: z.object({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (_args, ctx) => {
    const path = `${BASE_URL}/monitor/alerts`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        state: number;
        stateText: string;
        alertCount: number;
        alerts: Array<{
          index: number;
          message: string;
          severity: string;
          category: string;
        }>;
        lastAlert: string;
      };

      // Format alerts for display
      const lines: string[] = [];
      lines.push(`System State: ${result.stateText} (${result.state})`);
      lines.push(`Alert Count: ${result.alertCount}`);
      if (result.lastAlert) {
        lines.push(`Last Alert: ${result.lastAlert}`);
      }
      if (Array.isArray(result.alerts) && result.alerts.length > 0) {
        lines.push("");
        lines.push("Active Alerts:");
        for (const alert of result.alerts) {
          lines.push(
            `  [${alert.severity}] ${alert.category}: ${alert.message}`,
          );
        }
      } else {
        lines.push("\nNo active alerts.");
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving system alerts: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris.metrics.interop ──────────────────────────────────────

export const metricsInteropTool: ToolDefinition = {
  name: "iris.metrics.interop",
  title: "Interoperability Metrics",
  description:
    "Returns interoperability volume and interface metrics including " +
    "message throughput, queue depths, error rates, and production status. " +
    "Without a namespace parameter, summarizes all namespaces with productions. " +
    "With a namespace, returns metrics for that namespace only.",
  inputSchema: z.object({
    namespace: z
      .string()
      .optional()
      .describe(
        "Target namespace for interop metrics (omit for cross-namespace summary)",
      ),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (args, ctx) => {
    const { namespace } = args as { namespace?: string };

    let path = `${BASE_URL}/monitor/interop`;
    if (namespace) {
      path += `?namespace=${encodeURIComponent(namespace)}`;
    }

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        namespaces: Array<{
          namespace: string;
          productionName: string;
          productionState: string;
          productionStateCode: number;
          queueDepth: number;
          errorCount24h: number;
          messageCount24h: number;
        }>;
        count: number;
      };

      // Format for display
      const lines: string[] = [];
      lines.push(`Interoperability Metrics (${result.count} namespace(s)):`);
      if (Array.isArray(result.namespaces)) {
        for (const ns of result.namespaces) {
          lines.push("");
          lines.push(`Namespace: ${ns.namespace}`);
          lines.push(`  Production: ${ns.productionName || "(none)"} [${ns.productionState}]`);
          lines.push(`  Queue Depth: ${ns.queueDepth}`);
          lines.push(`  Errors (24h): ${ns.errorCount24h}`);
          lines.push(`  Messages (24h): ${ns.messageCount24h}`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent: result,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error retrieving interop metrics: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
