/**
 * Tool definitions for the IRIS Data & Analytics MCP server.
 *
 * Exports all tool definitions to be registered with
 * {@link McpServerBase}. Stories 7.2-7.4 populate this array
 * with data, analytics, and REST management tools.
 */

import type { ToolDefinition } from "@iris-mcp/shared";
import {
  docdbManageTool,
  docdbDocumentTool,
  docdbFindTool,
  docdbPropertyTool,
} from "./docdb.js";
import { analyticsMdxTool, analyticsCubesTool } from "./analytics.js";
import { restManageTool } from "./rest.js";

/** All tool definitions registered by the iris-data-mcp server. */
export const tools: ToolDefinition[] = [
  docdbManageTool,
  docdbDocumentTool,
  docdbFindTool,
  docdbPropertyTool,
  analyticsMdxTool,
  analyticsCubesTool,
  restManageTool,
];
