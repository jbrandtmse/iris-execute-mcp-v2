/**
 * Alert management tool for IRIS system alerts.
 *
 * Provides the {@link alertsManageTool} tool for resetting the IRIS system
 * alert counter and state. Counterpart to `iris_metrics_alerts` (in metrics.ts).
 *
 * Scope note: Per-alert `clear` by index and `acknowledge` are NOT available —
 * IRIS has no native API for either. Both are deferred to Epic 13 if demand
 * materialises. See deferred-work.md for rationale.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_alerts_manage ────────────────────────────────────────

export const alertsManageTool: ToolDefinition = {
  name: "iris_alerts_manage",
  title: "Manage System Alerts",
  description:
    "Manages IRIS system alert state. Single supported action:\n\n" +
    "- **reset**: Calls `$SYSTEM.Monitor.Clear()` to reset the alert counter and " +
    "system state. The `alerts.log` file is NOT truncated — historical entries remain " +
    "on disk for audit. `iris_metrics_alerts` will re-populate active alerts on the " +
    "next poll if conditions persist.\n\n" +
    "Actions NOT available (deferred to Epic 13 — IRIS has no native API for either):\n" +
    "- `clear` (remove a specific alert by index)\n" +
    "- `acknowledge` (mark an alert as seen without clearing the counter)",
  inputSchema: z.object({
    action: z
      .enum(["reset"])
      .describe(
        "Action to perform. Only 'reset' is supported: calls $SYSTEM.Monitor.Clear() " +
          "to clear the alert counter and system state.",
      ),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (args, ctx) => {
    const { action } = args as { action: "reset" };

    const path = `${BASE_URL}/monitor/alerts/manage`;

    try {
      const response = await ctx.http.post(path, { action });
      const result = response.result as {
        action: string;
        clearedAt: string;
      };

      const lines: string[] = [];
      lines.push(`Action: ${result.action}`);
      lines.push(`Cleared At: ${result.clearedAt}`);
      lines.push(
        "Alert counter and system state reset. Historical alerts.log entries remain on disk.",
      );

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
              text: `Error managing alerts: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
