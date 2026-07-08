/**
 * Tool definitions for the IRIS Operations & Monitoring MCP server.
 *
 * Exports all tool definitions to be registered with
 * {@link McpServerBase}. Stories 6.2-6.7 populate this array
 * with operations and monitoring tools.
 */

import type { ToolDefinition } from "@iris-mcp/shared";
import {
  metricsSystemTool,
  metricsAlertsTool,
  metricsInteropTool,
} from "./metrics.js";
import { alertsManageTool } from "./alerts.js";
import { healthCheckTool } from "./health.js";
import { jobsListTool, locksListTool } from "./jobs.js";
import { processManageTool } from "./process.js";
import {
  journalInfoTool,
  mirrorStatusTool,
  auditEventsTool,
} from "./system.js";
import {
  databaseCheckTool,
  licenseInfoTool,
  ecpStatusTool,
} from "./infrastructure.js";
import { databaseActionTool } from "./database.js";
import { backupManageTool } from "./backup.js";
import {
  taskManageTool,
  taskListTool,
  taskRunTool,
  taskHistoryTool,
} from "./task.js";
import { configManageTool } from "./config.js";

/** All tool definitions registered by the iris-ops-mcp server. */
export const tools: ToolDefinition[] = [
  metricsSystemTool,
  metricsAlertsTool,
  metricsInteropTool,
  alertsManageTool,
  jobsListTool,
  locksListTool,
  processManageTool,
  journalInfoTool,
  mirrorStatusTool,
  auditEventsTool,
  databaseCheckTool,
  databaseActionTool,
  backupManageTool,
  licenseInfoTool,
  ecpStatusTool,
  taskManageTool,
  taskListTool,
  taskRunTool,
  taskHistoryTool,
  configManageTool,
  healthCheckTool,
];
