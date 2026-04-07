/**
 * Tool definitions for the IRIS Interoperability MCP server.
 *
 * Exports all tool definitions to be registered with
 * {@link McpServerBase}. Includes production lifecycle tools
 * (manage, control, status, summary) from Story 5.2 and
 * production item / auto-start tools from Story 5.3.
 */

import type { ToolDefinition } from "@iris-mcp/shared";
import {
  productionManageTool,
  productionControlTool,
  productionStatusTool,
  productionSummaryTool,
} from "./production.js";
import {
  productionItemTool,
  productionAutostartTool,
} from "./item.js";

/** All tool definitions registered by the iris-interop-mcp server. */
export const tools: ToolDefinition[] = [
  productionManageTool,
  productionControlTool,
  productionStatusTool,
  productionSummaryTool,
  productionItemTool,
  productionAutostartTool,
];
