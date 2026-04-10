/**
 * Integration tests for iris-ops-mcp tools against a real IRIS instance.
 *
 * These tests exercise every operations and monitoring tool end-to-end via
 * the custom ExecuteMCPv2 REST service. They are skipped automatically when
 * IRIS is not reachable (see integration-setup.ts).
 *
 * Read-only tools verify response structure and key fields.
 * The task lifecycle test creates a test task, verifies it, runs it,
 * checks history, and cleans up.
 * Config tests use get/export only (never set).
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import {
  IrisHttpClient,
  negotiateVersion,
  buildToolContext,
  type ToolContext,
  type IrisConnectionConfig,
} from "@iris-mcp/shared";
import { getIntegrationConfig } from "@iris-mcp/shared/test-helpers/integration-config";

import {
  metricsSystemTool,
  metricsAlertsTool,
  metricsInteropTool,
} from "../tools/metrics.js";
import { jobsListTool, locksListTool } from "../tools/jobs.js";
import {
  journalInfoTool,
  mirrorStatusTool,
  auditEventsTool,
} from "../tools/system.js";
import {
  databaseCheckTool,
  licenseInfoTool,
  ecpStatusTool,
} from "../tools/infrastructure.js";
import {
  taskManageTool,
  taskListTool,
  taskRunTool,
  taskHistoryTool,
} from "../tools/task.js";
import { configManageTool } from "../tools/config.js";

// ── Globals set by integration-setup.ts ──────────────────────────────

const IRIS_OK = globalThis.__IRIS_AVAILABLE__;
const REST_OK = globalThis.__CUSTOM_REST_AVAILABLE__;

// ── Test constants ────────────────────────────────────────────────────

const TEST_TASK_NAME = "MCPOpsTest_IntegrationTask";
const TEST_TASK_CLASS = "%SYS.Task.PurgeTaskHistory";

// ── Shared state ──────────────────────────────────────────────────────

let client: IrisHttpClient;
let config: IrisConnectionConfig;
let ctx: ToolContext;

/** Track the created task ID for cleanup. */
let createdTaskId: string | number | undefined;

// ── Setup / Teardown ─────────────────────────────────────────────────

/** Safely attempt a tool call, ignoring errors. */
async function safeCall(
  tool: { handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown> },
  args: Record<string, unknown>,
  toolCtx: ToolContext,
): Promise<void> {
  try {
    await tool.handler(args, toolCtx);
  } catch {
    // Ignore — resource may not exist
  }
}

describe.skipIf(!IRIS_OK || !REST_OK)("iris-ops-mcp integration", () => {
  beforeAll(async () => {
    config = getIntegrationConfig();
    client = new IrisHttpClient(config);
    const version = await negotiateVersion(client);
    ctx = buildToolContext("NONE", config, client, version);
  });

  afterAll(async () => {
    // Clean up the test task if created
    if (createdTaskId !== undefined) {
      await safeCall(
        taskManageTool,
        { action: "delete", id: createdTaskId },
        ctx,
      );
    }
    client?.destroy();
  });

  // ── 1. System Metrics (iris_metrics_system) ───────────────────────

  describe("iris_metrics_system", () => {
    it("returns system metrics", async () => {
      const result = await metricsSystemTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
      const text = result.content[0]?.text ?? "";
      // Prometheus-format metrics should contain HELP or TYPE lines
      expect(text.length).toBeGreaterThan(0);
    });
  });

  // ── 2. System Alerts (iris_metrics_alerts) ────────────────────────

  describe("iris_metrics_alerts", () => {
    it("returns alerts state", async () => {
      const result = await metricsAlertsTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 3. Interop Metrics (iris_metrics_interop) ─────────────────────

  describe("iris_metrics_interop", () => {
    it("returns interop metrics", async () => {
      const result = await metricsInteropTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 4. Jobs List (iris_jobs_list) ─────────────────────────────────

  describe("iris_jobs_list", () => {
    it("returns running jobs", async () => {
      const result = await jobsListTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 5. Locks List (iris_locks_list) ───────────────────────────────

  describe("iris_locks_list", () => {
    it("returns locks (possibly empty)", async () => {
      const result = await locksListTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 6. Journal Info (iris_journal_info) ───────────────────────────

  describe("iris_journal_info", () => {
    it("returns journal info", async () => {
      const result = await journalInfoTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 7. Mirror Status (iris_mirror_status) ─────────────────────────

  describe("iris_mirror_status", () => {
    it("returns mirror status (expect not configured)", async () => {
      const result = await mirrorStatusTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 8. Audit Events (iris_audit_events) ───────────────────────────

  describe("iris_audit_events", () => {
    it("returns audit events for a recent time range", async () => {
      const result = await auditEventsTool.handler({ count: 10 }, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 9. Database Check (iris_database_check) ──────────────────────

  describe("iris_database_check", () => {
    it("returns database status", async () => {
      const result = await databaseCheckTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 10. License Info (iris_license_info) ──────────────────────────

  describe("iris_license_info", () => {
    it("returns license details", async () => {
      const result = await licenseInfoTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 11. ECP Status (iris_ecp_status) ──────────────────────────────

  describe("iris_ecp_status", () => {
    it("returns ECP status (expect not configured)", async () => {
      const result = await ecpStatusTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 12. Config Manage — get (iris_config_manage) ──────────────────

  describe("iris_config_manage", () => {
    it("gets config section", async () => {
      const result = await configManageTool.handler(
        { action: "get", section: "config" },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });

    it("exports system configuration", async () => {
      const result = await configManageTool.handler(
        { action: "export" },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
    });
  });

  // ── 13. Task Lifecycle (create -> list -> run -> history -> delete) ─

  describe("task lifecycle", () => {
    it("creates a test task", async () => {
      const result = await taskManageTool.handler(
        {
          action: "create",
          name: TEST_TASK_NAME,
          taskClass: TEST_TASK_CLASS,
          namespace: "%SYS",
          description: "Integration test task — safe to delete",
          suspended: true,
        },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
      if (!result.isError) {
        // Extract task ID from response for cleanup
        const structured = result.structuredContent as { id?: string | number; taskId?: string | number } | undefined;
        createdTaskId = structured?.id ?? structured?.taskId;
        // If structuredContent didn't have it, try parsing from text
        if (createdTaskId === undefined) {
          const text = result.content[0]?.text ?? "";
          const idMatch = text.match(/(?:id|ID|Id)[:\s]*(\d+)/);
          if (idMatch) {
            createdTaskId = idMatch[1];
          }
        }
      }
      expect(result.isError).toBeFalsy();
      expect(createdTaskId).toBeDefined();
    });

    it("lists tasks and verifies test task exists", async () => {
      if (createdTaskId === undefined) return;

      const result = await taskListTool.handler({}, ctx);

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
      const text = result.content[0]?.text ?? "";
      // The test task should appear in the list
      expect(text).toContain(TEST_TASK_NAME);
    });

    it("runs the test task", async () => {
      if (createdTaskId === undefined) return;

      const result = await taskRunTool.handler(
        { id: createdTaskId },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
      // RunNow is async; it may succeed or report the task is running
      // Either way it should not be a hard error
    });

    it("checks task history after execution", async () => {
      if (createdTaskId === undefined) return;

      // Brief wait for async task execution
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const result = await taskHistoryTool.handler(
        { taskId: createdTaskId },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
      // History may or may not have entries depending on timing
      // The important thing is the endpoint responds without error
      expect(result.isError).toBeFalsy();
    });

    it("deletes the test task", async () => {
      if (createdTaskId === undefined) return;

      const result = await taskManageTool.handler(
        { action: "delete", id: createdTaskId },
        ctx,
      );

      expect(result.content[0]?.text).toBeDefined();
      expect(result.isError).toBeFalsy();
      // Mark as cleaned up so afterAll doesn't try again
      createdTaskId = undefined;
    });
  });
});
