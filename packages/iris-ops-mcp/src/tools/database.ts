/**
 * IRIS database maintenance tool for the IRIS Operations MCP server.
 *
 * Provides {@link databaseActionTool} — `iris_database_action` — a single
 * multi-action tool to run RUNTIME database-maintenance operations
 * (mount / dismount / compact / defragment / truncate / expandVolume) via the
 * custom REST endpoint `POST /api/executemcp/v2/monitor/database/action`
 * (backed by `SYS.Database` class methods in `%SYS`).
 *
 * Companion to the read-only `iris_database_check` (infrastructure.ts), which
 * reports each database's status; this tool performs the maintenance verbs.
 *
 * **Config vs SYS separation (Rule #3).** This tool covers `SYS.Database`
 * RUNTIME operations only. Database CONFIG (create / modify / delete, backed by
 * `Config.Databases`) lives in the admin `iris_database_manage` tool — the two
 * are intentionally disjoint and must not duplicate one another.
 *
 * **Governance (Story 16.2, frozen-foundation model).** All six action keys are
 * NEW post-foundation keys (absent from the frozen `governance-baseline.ts`),
 * and EVERY action MUTATES, so each is classified `mutates: "write"` and the
 * governance layer default-DISABLES all of them until an operator opts in via
 * `IRIS_GOVERNANCE`. The `server` field is framework-injected (architecture
 * decision D2), so it is not declared on the schema.
 *
 * **Synchronous, no async/queue.** IRIS exposes no async/queue API for these
 * operations; `compact` / `defragment` / `truncate` block until they finish and
 * can take a while on large databases. The handler does NOT fabricate a
 * started/queued status.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── iris_database_action ───────────────────────────────────────

export const databaseActionTool: ToolDefinition = {
  name: "iris_database_action",
  title: "Database Maintenance Action",
  description:
    "Run a runtime database-maintenance operation via SYS.Database (in %SYS). " +
    "This is the runtime-operations companion to the read-only iris_database_check " +
    "and is disjoint from the admin iris_database_manage (which handles database " +
    "CONFIG: create/modify/delete). All actions key on the database DIRECTORY path " +
    "(not the config name) and are MUTATING — they are opt-in under tool governance " +
    "and DISABLED by default until enabled via IRIS_GOVERNANCE. Actions:\n\n" +
    "- **mount** (write): mount a database (SYS.Database.MountDatabase). Optional " +
    "'readonly' (boolean) mounts it read-only. Requires 'directory'.\n" +
    "- **dismount** (write, destructive): take a database offline " +
    "(SYS.Database.DismountDatabase). Requires 'directory'.\n" +
    "- **compact** (write): compact globals to reclaim space within the .DAT " +
    "(SYS.Database.CompactDatabase). Optional 'percentFull' (default 90). Returns " +
    "mbProcessed/mbCompressed. Requires 'directory'.\n" +
    "- **defragment** (write): rearrange global blocks into contiguous sequence " +
    "(SYS.Database.Defragment). Requires 'directory'.\n" +
    "- **truncate** (write, destructive): return trailing unused space to the OS, " +
    "shrinking the .DAT (SYS.Database.ReturnUnusedSpace). Optional 'targetSize' MB " +
    "(default 0 = return all free trailing space). Returns returnSize. Requires " +
    "'directory'.\n" +
    "- **expandVolume** (write): add a new volume to a multi-volume database " +
    "(SYS.Database.NewVolume). Requires 'directory', 'newVolDir', and optional " +
    "'initialSize' (MB).\n\n" +
    "These operations are SYNCHRONOUS — IRIS has no async/queue API for them. " +
    "compact/defragment/truncate can run for a while on large databases and the " +
    "request blocks until they complete. A missing/unknown 'directory' (or a DB " +
    "that is in use, locked, or unmounted) is rejected with a clear error rather " +
    "than corrupting anything.",
  inputSchema: z.object({
    action: z
      .enum([
        "mount",
        "dismount",
        "compact",
        "defragment",
        "truncate",
        "expandVolume",
      ])
      .describe("Database maintenance action to perform"),
    directory: z
      .string()
      .describe(
        "Database directory path (the SYS.Database key — NOT the config name). Required.",
      ),
    readonly: z
      .boolean()
      .optional()
      .describe("For 'mount': mount the database read-only (default false)"),
    percentFull: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("For 'compact': target percent full for data blocks, 1-100 (default 90)"),
    targetSize: z
      .number()
      .min(0)
      .optional()
      .describe(
        "For 'truncate': desired resulting .DAT size in MB, non-negative (default 0 = return all trailing free space)",
      ),
    newVolDir: z
      .string()
      .optional()
      .describe("For 'expandVolume': directory for the new volume (required for expandVolume)"),
    initialSize: z
      .number()
      .min(1)
      .optional()
      .describe("For 'expandVolume': initial size of the new volume in MB (positive)"),
    namespace: z
      .string()
      .optional()
      .describe(
        "Accepted but has NO EFFECT: database maintenance is %SYS-scoped " +
          "(SYS.Database keys on the directory path and runs in %SYS regardless " +
          "of namespace), so any value passed here is ignored. Retained for " +
          "backward compatibility.",
      ),
  }),
  annotations: {
    // The tool can mutate; per-action read/write is realized through `mutates`
    // below (here ALL actions are writes). dismount and truncate are the
    // destructive ones, so the tool carries destructiveHint at the tool scope
    // (MCP annotations are tool-scoped, not per-action).
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NONE",
  // Governance classification (Story 15.0 strict contract): EVERY action key is
  // classified because none are in the frozen Epic-14 baseline. ALL actions
  // MUTATE, so every one defaults DISABLED (opt-in via IRIS_GOVERNANCE).
  mutates: {
    mount: "write",
    dismount: "write",
    compact: "write",
    defragment: "write",
    truncate: "write",
    expandVolume: "write",
  },
  handler: async (args, ctx) => {
    const {
      action,
      directory,
      readonly,
      percentFull,
      targetSize,
      newVolDir,
      initialSize,
      namespace,
    } = args as {
      action:
        | "mount"
        | "dismount"
        | "compact"
        | "defragment"
        | "truncate"
        | "expandVolume";
      directory: string;
      readonly?: boolean;
      percentFull?: number;
      targetSize?: number;
      newVolDir?: string;
      initialSize?: number;
      namespace?: string;
    };

    // `directory` is required for every action; reject early with a clear error
    // rather than relying solely on the server's validation.
    if (directory === undefined || directory === "") {
      return {
        content: [
          {
            type: "text" as const,
            text: `Error: 'directory' is required for the '${action}' action (the database directory path).`,
          },
        ],
        isError: true,
      };
    }

    // expandVolume additionally requires newVolDir.
    if (
      action === "expandVolume" &&
      (newVolDir === undefined || newVolDir === "")
    ) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Error: the 'expandVolume' action requires 'newVolDir' (the directory for the new volume).",
          },
        ],
        isError: true,
      };
    }

    const body: Record<string, unknown> = { action, directory };
    if (action === "mount" && readonly !== undefined) body.readonly = readonly;
    if (action === "compact" && percentFull !== undefined) {
      body.percentFull = percentFull;
    }
    if (action === "truncate" && targetSize !== undefined) {
      body.targetSize = targetSize;
    }
    if (action === "expandVolume") {
      body.newVolDir = newVolDir;
      if (initialSize !== undefined) body.initialSize = initialSize;
    }
    if (namespace !== undefined && namespace !== "") body.namespace = namespace;

    try {
      const path = `${BASE_URL}/monitor/database/action`;
      const response = await ctx.http.post(path, body);
      const result = response.result as {
        action: string;
        directory: string;
        success?: number;
        readonly?: number;
        percentFull?: number;
        mbProcessed?: number;
        mbCompressed?: number;
        targetSize?: number;
        returnSize?: number;
        newVolDir?: string;
        initialSize?: number;
      };

      const lines: string[] = [];
      lines.push(
        `Action '${result.action}' on database '${result.directory}': success`,
      );
      if (result.action === "compact") {
        lines.push(
          `  MB processed: ${result.mbProcessed ?? 0} | MB after compaction: ${result.mbCompressed ?? 0}`,
        );
      } else if (result.action === "truncate") {
        lines.push(`  New size: ${result.returnSize ?? 0} MB`);
      } else if (result.action === "expandVolume") {
        lines.push(
          `  New volume directory: ${result.newVolDir ?? newVolDir ?? ""}`,
        );
      } else if (result.action === "mount") {
        lines.push(`  Read-only: ${result.readonly ? "yes" : "no"}`);
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
              text: `Error performing '${action}' on database '${directory}': ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
