/**
 * IRIS backup operations tool for the IRIS Operations MCP server.
 *
 * Provides {@link backupManageTool} — `iris_backup_manage` — a single
 * multi-action tool to run backups and freeze/thaw the instance via the custom
 * REST endpoint `POST /api/executemcp/v2/monitor/backup/manage` (backed by
 * `Backup.General` class methods in `%SYS`).
 *
 * **Actions.**
 * - `listHistory` (read): walk the `^SYS("BUHISTORY")` backup-history global.
 * - `run` (write): run a USER-DEFINED backup task BY NAME via
 *   `Backup.General.StartTask`. Live-probe (Story 16.3, Rule #16) confirmed there
 *   are NO predefined/shipped backup task names — the operator first defines the
 *   task (name + database list + type) in the Management Portal, and the backup
 *   TYPE is a property of that definition. So `run` takes a required `taskName`,
 *   and `backupType` is OPTIONAL/informational only (NOT used to select a task).
 * - `freeze` (write, destructive): `Backup.General.ExternalFreeze` quiesces ALL
 *   database writes instance-wide until a thaw — disruptive.
 * - `thaw` (write): `Backup.General.ExternalThaw` resumes writes after a freeze.
 *
 * **restore is DEFERRED / NOT supported** (Story 16.3 AC 16.3.3, Rule #16): IRIS
 * restore is interactive (`^DBREST` / `CLUMENU^JRNRESTO`) and not cleanly
 * scriptable via `Backup.General`. It is intentionally absent from the action
 * enum; the server also rejects an `action="restore"` with a clear message.
 *
 * **Governance (Story 16.3, frozen-foundation model).** All four action keys are
 * NEW post-foundation keys (absent from the frozen `governance-baseline.ts`).
 * `listHistory` is a read (enabled by default); `run`/`freeze`/`thaw` mutate and
 * are default-DISABLED until an operator opts in via `IRIS_GOVERNANCE`. The
 * `server` field is framework-injected (architecture decision D2), so it is not
 * declared on the schema.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_backup_manage ─────────────────────────────────────────

export const backupManageTool: ToolDefinition = {
  name: "iris_backup_manage",
  title: "Backup Management",
  description:
    "Run backups and freeze/thaw the IRIS instance via Backup.General (in %SYS), " +
    "or list backup history. The mutating actions (run/freeze/thaw) are opt-in " +
    "under tool governance and DISABLED by default until enabled via " +
    "IRIS_GOVERNANCE; listHistory is read-only and enabled by default. Actions:\n\n" +
    "- **listHistory** (read): list recent backups from the ^SYS(\"BUHISTORY\") " +
    "history global (most-recent-first), each with timestamp, type, status, " +
    "device, log file, and description.\n" +
    "- **run** (write): run a USER-DEFINED backup task BY NAME " +
    "(Backup.General.StartTask). Requires 'taskName' — the name of a backup task " +
    "the operator has already defined in the Management Portal (System Operation " +
    "> Backups). There are NO predefined/shipped task names. The backup TYPE " +
    "(full/incremental/cumulative) is a property of that task definition; the " +
    "optional 'backupType' field here is informational only and does NOT select " +
    "the task. Optional 'jobbackup' (boolean) runs the backup in a background job.\n" +
    "- **freeze** (write, destructive): quiesce ALL database writes instance-wide " +
    "for an external snapshot (Backup.General.ExternalFreeze). DISRUPTIVE — the " +
    "instance stops accepting writes until a thaw. Optional 'logFile' and " +
    "'description'.\n" +
    "- **thaw** (write): resume database writes after a freeze " +
    "(Backup.General.ExternalThaw). Optional 'logFile', 'username', 'password' " +
    "(must match what was passed to the freeze).\n\n" +
    "**restore is NOT supported via this tool.** IRIS restore is interactive " +
    "(^DBREST / CLUMENU^JRNRESTO) and not cleanly scriptable; use the IRIS restore " +
    "utility or the Management Portal restore instead. An action='restore' request " +
    "is rejected with a clear message rather than crashing.",
  inputSchema: z.object({
    action: z
      .enum(["run", "freeze", "thaw", "listHistory"])
      .describe("Backup action to perform"),
    taskName: z
      .string()
      .optional()
      .describe(
        "For 'run': the name of a user-defined backup task (defined in the " +
          "Management Portal). REQUIRED for 'run'. There are no predefined task names.",
      ),
    backupType: z
      .enum(["full", "incremental", "cumulative"])
      .optional()
      .describe(
        "For 'run': informational only — the backup type is a property of the " +
          "named task definition and is NOT used to select the task.",
      ),
    jobbackup: z
      .boolean()
      .optional()
      .describe(
        "For 'run': run the backup in a background job (default false = run in-process).",
      ),
    device: z
      .string()
      .optional()
      .describe("For 'run': optional output device override."),
    logFile: z
      .string()
      .optional()
      .describe("For 'freeze'/'thaw': optional log file path for freeze/thaw messages."),
    description: z
      .string()
      .optional()
      .describe("For 'freeze': optional descriptive text recorded with the freeze."),
    username: z
      .string()
      .optional()
      .describe(
        "For 'thaw': username matching the one passed to the freeze (optional).",
      ),
    password: z
      .string()
      .optional()
      .describe(
        "For 'thaw': password matching the one passed to the freeze (optional).",
      ),
    namespace: z
      .string()
      .optional()
      .describe(
        "Accepted but has NO EFFECT: backup operations are instance-wide / " +
          "%SYS-scoped (Backup.General runs in %SYS regardless of namespace), so " +
          "any value passed here is ignored. Retained for backward compatibility.",
      ),
  }),
  annotations: {
    // The tool can mutate; per-action read/write is realized through `mutates`
    // below. freeze quiesces all writes instance-wide → destructive at the tool
    // scope (MCP annotations are tool-scoped, not per-action). run is
    // non-idempotent (each call starts a new backup).
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NONE",
  // Governance classification (Story 15.0 strict contract): every action key is
  // classified because none are in the frozen Epic-14 baseline. listHistory is a
  // read (enabled by default); run/freeze/thaw MUTATE (default DISABLED).
  mutates: {
    run: "write",
    freeze: "write",
    thaw: "write",
    listHistory: "read",
  },
  handler: async (args, ctx) => {
    const {
      action,
      taskName,
      backupType,
      jobbackup,
      device,
      logFile,
      description,
      username,
      password,
      namespace,
    } = args as {
      action: "run" | "freeze" | "thaw" | "listHistory";
      taskName?: string;
      backupType?: "full" | "incremental" | "cumulative";
      jobbackup?: boolean;
      device?: string;
      logFile?: string;
      description?: string;
      username?: string;
      password?: string;
      namespace?: string;
    };

    // `run` requires taskName; reject early with a clear error rather than
    // relying solely on the server's validation.
    if (action === "run" && (taskName === undefined || taskName === "")) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              "Error: 'taskName' is required for the 'run' action (the name of a " +
              "user-defined backup task; there are no predefined task names).",
          },
        ],
        isError: true,
      };
    }

    const body: Record<string, unknown> = { action };
    if (action === "run") {
      body.taskName = taskName;
      if (backupType !== undefined) body.backupType = backupType;
      if (jobbackup !== undefined) body.jobbackup = jobbackup;
      if (device !== undefined && device !== "") body.device = device;
    }
    if (action === "freeze") {
      if (logFile !== undefined && logFile !== "") body.logFile = logFile;
      if (description !== undefined && description !== "") {
        body.description = description;
      }
    }
    if (action === "thaw") {
      if (logFile !== undefined && logFile !== "") body.logFile = logFile;
      if (username !== undefined && username !== "") body.username = username;
      if (password !== undefined && password !== "") body.password = password;
    }
    if (namespace !== undefined && namespace !== "") body.namespace = namespace;

    try {
      const path = `${BASE_URL}/monitor/backup/manage`;
      const response = await ctx.http.post(path, body);
      const result = response.result as {
        action: string;
        success?: number;
        taskName?: string;
        jobbackup?: number;
        backupType?: string;
        logFile?: string;
        count?: number;
        entries?: Array<{
          timestamp?: string;
          type?: string;
          status?: string;
          device?: string;
          logFile?: string;
          description?: string;
          list?: string;
        }>;
      };

      const lines: string[] = [];
      if (result.action === "listHistory") {
        const entries = result.entries ?? [];
        if (entries.length === 0) {
          lines.push("No backup history recorded.");
        } else {
          lines.push(`Backup history (${result.count ?? entries.length} entries):`);
          for (const e of entries) {
            lines.push(
              `  ${e.timestamp ?? "?"} | ${e.type ?? "?"} | ${e.status ?? "?"}` +
                (e.description ? ` | ${e.description}` : "") +
                (e.logFile ? ` | log: ${e.logFile}` : ""),
            );
          }
        }
      } else if (result.action === "run") {
        lines.push(`Backup task '${result.taskName ?? taskName ?? ""}' started: success`);
        if (result.jobbackup) lines.push("  (running in background job)");
      } else if (result.action === "freeze") {
        lines.push("System frozen (all database writes quiesced): success");
      } else if (result.action === "thaw") {
        lines.push("System thawed (database writes resumed): success");
      } else {
        lines.push(`Action '${result.action}': success`);
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
              text: `Error performing '${action}' backup operation: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
