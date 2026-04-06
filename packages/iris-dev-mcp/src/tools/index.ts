/**
 * Tool definitions for the IRIS Development MCP server.
 *
 * Exports all tool definitions to be registered with
 * {@link McpServerBase}. Individual tool modules are imported
 * and combined into a single array.
 */

import type { ToolDefinition } from "@iris-mcp/shared";
import {
  docGetTool,
  docPutTool,
  docDeleteTool,
  docListTool,
} from "./doc.js";
import { docCompileTool } from "./compile.js";
import {
  docIndexTool,
  docSearchTool,
  macroInfoTool,
} from "./intelligence.js";
import { docConvertTool, docXmlExportTool } from "./format.js";
import { sqlExecuteTool } from "./sql.js";
import { serverInfoTool, serverNamespaceTool } from "./server.js";

/** All tool definitions registered by the iris-dev-mcp server. */
export const tools: ToolDefinition[] = [
  docGetTool,
  docPutTool,
  docDeleteTool,
  docListTool,
  docCompileTool,
  docIndexTool,
  docSearchTool,
  macroInfoTool,
  docConvertTool,
  docXmlExportTool,
  sqlExecuteTool,
  serverInfoTool,
  serverNamespaceTool,
];
