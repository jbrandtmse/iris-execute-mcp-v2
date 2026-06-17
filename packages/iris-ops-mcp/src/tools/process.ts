/**
 * IRIS process detail & control tool for the IRIS Operations MCP server.
 *
 * Provides {@link processManageTool} — `iris_process_manage` — a single
 * multi-action tool to inspect one IRIS process and to terminate / suspend /
 * resume it, via the custom REST endpoints `GET /api/executemcp/v2/monitor/process`
 * and `POST /api/executemcp/v2/monitor/process/manage` (backed by
 * `%SYS.ProcessQuery` for detail and `SYS.Process` for control).
 *
 * Companion to the read-only `iris_jobs_list` (jobs.ts): that tool lists every
 * process; this one drills into one PID and adds the control verbs.
 *
 * **Governance (Story 16.1, frozen-foundation model).** The four action keys are
 * NEW post-foundation keys (absent from the frozen `governance-baseline.ts`), so
 * EVERY action is classified in `mutates`: `get` is a read (enabled by default),
 * while `terminate` / `suspend` / `resume` are writes that the governance layer
 * default-DISABLES until an operator opts in via `IRIS_GOVERNANCE`. The `server`
 * field is framework-injected (architecture decision D2), so it is not declared
 * on the schema.
 *
 * **Self / critical-process guard.** A control action against the calling process
 * ($JOB) or a process whose `CanBeTerminated`/`CanBeSuspended` flag is false is
 * REFUSED by the ObjectScript handler itself (defense in depth) — the server
 * returns `{action, pid, refused:true, reason}` and changes nothing.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_process_manage ────────────────────────────────────────

export const processManageTool: ToolDefinition = {
  name: "iris_process_manage",
  title: "Manage IRIS Process",
  description:
    "Inspect and control a single IRIS process by PID (extends the read-only " +
    "iris_jobs_list with detail + lifecycle control). Actions:\n\n" +
    "- **get** (read): full detail for one process — state, routine, namespace, " +
    "user, client IP, resource counters, and the canBeTerminated/canBeSuspended " +
    "flags. Requires 'pid'.\n" +
    "- **terminate** (write, destructive): kill the process (SYS.Process.Terminate). " +
    "Requires 'pid'.\n" +
    "- **suspend** (write): pause the process (SYS.Process.Suspend). Requires 'pid'.\n" +
    "- **resume** (write): resume a suspended process (SYS.Process.Resume). " +
    "Requires 'pid'.\n\n" +
    "The mutating actions (terminate/suspend/resume) are opt-in under tool " +
    "governance and are DISABLED by default until enabled via IRIS_GOVERNANCE. " +
    "A control action targeting the calling process, or a critical/protected " +
    "system job (CanBeTerminated/CanBeSuspended = 0), is REFUSED by the server " +
    "and changes nothing (the result carries refused:true with a reason).",
  inputSchema: z.object({
    action: z
      .enum(["get", "terminate", "suspend", "resume"])
      .describe("Action to perform on the process"),
    pid: z
      .union([z.string(), z.number()])
      .describe("Process ID (PID) to inspect or control (required)"),
    namespace: z
      .string()
      .optional()
      .describe(
        "Namespace override (optional; process operations are %SYS-scoped, so " +
          "this is usually omitted)",
      ),
  }),
  annotations: {
    // Tool can mutate (terminate/suspend/resume); per-action read/write is
    // realized through `mutates` below. `terminate` is the destructive action,
    // so the tool carries destructiveHint at the tool scope (MCP annotations are
    // tool-scoped, not per-action).
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NONE",
  // Governance classification (Story 15.0 strict contract): EVERY action key is
  // classified because none are in the frozen Epic-14 baseline. The read defaults
  // enabled; the writes default DISABLED (opt-in via IRIS_GOVERNANCE).
  mutates: {
    get: "read",
    terminate: "write",
    suspend: "write",
    resume: "write",
  },
  handler: async (args, ctx) => {
    const { action, pid, namespace } = args as {
      action: "get" | "terminate" | "suspend" | "resume";
      pid: string | number;
      namespace?: string;
    };

    const pidStr = String(pid);

    try {
      if (action === "get") {
        let getPath = `${BASE_URL}/monitor/process?pid=${encodeURIComponent(pidStr)}`;
        if (namespace !== undefined && namespace !== "") {
          getPath += `&namespace=${encodeURIComponent(namespace)}`;
        }
        const response = await ctx.http.get(getPath);
        const result = response.result as {
          pid: number;
          namespace: string;
          routine: string;
          state: string;
          userName: string;
          clientIPAddress: string;
          device: string;
          jobType: number;
          commandsExecuted: number;
          globalReferences: number;
          inTransaction: number;
          cpuTime: number;
          memoryUsedKB: number;
          priority: number;
          roles: string;
          canBeTerminated: number;
          canBeSuspended: number;
          canBeExamined: number;
          isCurrentProcess: number;
        };

        const lines: string[] = [];
        lines.push(`Process ${result.pid}:`);
        lines.push(`  Namespace: ${result.namespace || "(none)"}`);
        lines.push(`  Routine: ${result.routine || "(idle)"}`);
        lines.push(`  State: ${result.state}`);
        lines.push(`  User: ${result.userName || "(system)"}`);
        if (result.clientIPAddress) {
          lines.push(`  Client IP: ${result.clientIPAddress}`);
        }
        lines.push(
          `  Commands: ${result.commandsExecuted} | Globals: ${result.globalReferences} | CPU: ${result.cpuTime}`,
        );
        if (result.inTransaction) {
          lines.push(`  ** In Transaction **`);
        }
        lines.push(
          `  Can be terminated: ${result.canBeTerminated ? "yes" : "no"} | ` +
            `Can be suspended: ${result.canBeSuspended ? "yes" : "no"}`,
        );
        if (result.isCurrentProcess) {
          lines.push(
            `  ** This is the calling process — control actions will be refused **`,
          );
        }

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          structuredContent: result,
        };
      }

      // terminate / suspend / resume — POST a control request.
      const body: Record<string, unknown> = { action, pid: pidStr };
      if (namespace !== undefined && namespace !== "") body.namespace = namespace;

      const path = `${BASE_URL}/monitor/process/manage`;
      const response = await ctx.http.post(path, body);
      const result = response.result as {
        action: string;
        pid: number;
        refused: number;
        reason?: string;
        success?: number;
      };

      const lines: string[] = [];
      if (result.refused) {
        lines.push(`Action '${result.action}' on process ${result.pid}: REFUSED`);
        if (result.reason) lines.push(`  ${result.reason}`);
      } else {
        lines.push(`Action '${result.action}' on process ${result.pid}: success`);
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
              text: `Error performing '${action}' on process ${pidStr}: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
