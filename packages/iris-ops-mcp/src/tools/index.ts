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
import { jobsListTool, locksListTool } from "./jobs.js";

/** All tool definitions registered by the iris-ops-mcp server. */
export const tools: ToolDefinition[] = [
  metricsSystemTool,
  metricsAlertsTool,
  metricsInteropTool,
  jobsListTool,
  locksListTool,
];
