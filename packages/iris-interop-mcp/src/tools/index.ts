/**
 * Tool definitions for the IRIS Interoperability MCP server.
 *
 * Exports all tool definitions to be registered with
 * {@link McpServerBase}. Includes production lifecycle tools
 * (manage, control, status, summary) from Story 5.2,
 * production item / auto-start tools from Story 5.3,
 * production monitoring tools (logs, queues, messages, adapters) from Story 5.4,
 * and credential / lookup table tools from Story 5.5.
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
import {
  productionLogsTool,
  productionQueuesTool,
  productionMessagesTool,
  productionAdaptersTool,
} from "./monitor.js";
import {
  credentialManageTool,
  credentialListTool,
} from "./credential.js";
import {
  lookupManageTool,
  lookupTransferTool,
} from "./lookup.js";

/** All tool definitions registered by the iris-interop-mcp server. */
export const tools: ToolDefinition[] = [
  productionManageTool,
  productionControlTool,
  productionStatusTool,
  productionSummaryTool,
  productionItemTool,
  productionAutostartTool,
  productionLogsTool,
  productionQueuesTool,
  productionMessagesTool,
  productionAdaptersTool,
  credentialManageTool,
  credentialListTool,
  lookupManageTool,
  lookupTransferTool,
];
