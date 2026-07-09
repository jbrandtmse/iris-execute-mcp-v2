/**
 * Tool definitions for the IRIS Interoperability MCP server.
 *
 * Exports all tool definitions to be registered with
 * {@link McpServerBase}. Includes production lifecycle tools
 * (manage, control, status, summary) from Story 5.2,
 * production item / auto-start tools from Story 5.3,
 * production monitoring tools (logs, queues, messages, adapters) from Story 5.4,
 * credential / lookup table tools from Story 5.5,
 * rules, transforms, and REST API tools from Story 5.6,
 * the message-trace sequence-diagram tool from Story 21.0,
 * and the message resend/replay tool from Story 26.2.
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
import {
  ruleListTool,
  ruleGetTool,
} from "./rule.js";
import {
  transformListTool,
  transformTestTool,
} from "./transform.js";
import {
  interopRestTool,
} from "./rest.js";
import {
  defaultSettingsManageTool,
} from "./defaultSettings.js";
import {
  messageDiagramTool,
} from "./diagram.js";
import {
  messageResendTool,
} from "./message-resend.js";

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
  ruleListTool,
  ruleGetTool,
  transformListTool,
  transformTestTool,
  interopRestTool,
  defaultSettingsManageTool,
  messageDiagramTool,
  messageResendTool,
];
