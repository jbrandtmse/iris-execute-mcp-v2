/**
 * Jobs and locks monitoring tools.
 *
 * Provides two read-only tools for IRIS process and lock monitoring:
 * - {@link jobsListTool} — List all running IRIS jobs/processes
 * - {@link locksListTool} — List all current system locks
 *
 * Both tools call the custom REST service at `/api/executemcp/v2/monitor`.
 * Scope is NONE — no namespace parameter needed for system-level tools.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_jobs_list ───────────────────────────────────────────

export const jobsListTool: ToolDefinition = {
  name: "iris_jobs_list",
  title: "List Jobs",
  description:
    "List all running IRIS jobs/processes. Each job includes process ID, " +
    "namespace, routine, state, username, client IP, job type, commands " +
    "executed, global references, transaction status, and CPU time. " +
    "No parameters required.",
  inputSchema: z.object({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (_args, ctx) => {
    const path = `${BASE_URL}/monitor/jobs`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        jobs: Array<{
          pid: number;
          namespace: string;
          routine: string;
          state: string;
          userName: string;
          clientIPAddress: string;
          jobType: number;
          commandsExecuted: number;
          globalReferences: number;
          inTransaction: number;
          cpuTime: number;
        }>;
        count: number;
      };

      // Format jobs for display
      const lines: string[] = [];
      lines.push(`IRIS Jobs (${result.count} process(es)):`);
      if (Array.isArray(result.jobs)) {
        for (const job of result.jobs) {
          lines.push("");
          lines.push(`PID: ${job.pid}`);
          lines.push(`  Namespace: ${job.namespace || "(none)"}`);
          lines.push(`  Routine: ${job.routine || "(idle)"}`);
          lines.push(`  State: ${job.state}`);
          lines.push(`  User: ${job.userName || "(system)"}`);
          if (job.clientIPAddress) {
            lines.push(`  Client IP: ${job.clientIPAddress}`);
          }
          lines.push(`  Commands: ${job.commandsExecuted} | Globals: ${job.globalReferences} | CPU: ${job.cpuTime}`);
          if (job.inTransaction) {
            lines.push(`  ** In Transaction **`);
          }
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
              text: `Error retrieving jobs list: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};

// ── iris_locks_list ──────────────────────────────────────────

export const locksListTool: ToolDefinition = {
  name: "iris_locks_list",
  title: "List Locks",
  description:
    "List all current IRIS system locks. Each lock includes lock name " +
    "(full reference), owner process ID, raw owner string, lock mode, " +
    "flags, and lock count. No parameters required.",
  inputSchema: z.object({}),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  handler: async (_args, ctx) => {
    const path = `${BASE_URL}/monitor/locks`;

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        locks: Array<{
          lockName: string;
          ownerPid: number;
          owner: string;
          mode: string;
          flags: string;
          counts: string;
        }>;
        count: number;
      };

      // Format locks for display
      const lines: string[] = [];
      lines.push(`IRIS Locks (${result.count} lock(s)):`);
      if (Array.isArray(result.locks) && result.locks.length > 0) {
        for (const lock of result.locks) {
          lines.push("");
          lines.push(`Lock: ${lock.lockName}`);
          lines.push(`  Owner PID: ${lock.ownerPid}`);
          lines.push(`  Mode: ${lock.mode}`);
          lines.push(`  Counts: ${lock.counts}`);
          if (lock.flags) {
            lines.push(`  Flags: ${lock.flags}`);
          }
        }
      } else {
        lines.push("\nNo active locks.");
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
              text: `Error retrieving locks list: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
