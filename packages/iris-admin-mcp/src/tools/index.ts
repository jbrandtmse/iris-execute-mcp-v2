/**
 * Tool definitions for the IRIS Administration MCP server.
 *
 * Exports all tool definitions to be registered with
 * {@link McpServerBase}. Includes namespace and database
 * management tools from Stories 4.2+.
 */

import type { ToolDefinition } from "@iris-mcp/shared";
import { namespaceManageTool, namespaceListTool } from "./namespace.js";
import { databaseManageTool, databaseListTool } from "./database.js";
import { mappingManageTool, mappingListTool } from "./mapping.js";

/** All tool definitions registered by the iris-admin-mcp server. */
export const tools: ToolDefinition[] = [
  namespaceManageTool,
  namespaceListTool,
  databaseManageTool,
  databaseListTool,
  mappingManageTool,
  mappingListTool,
];
