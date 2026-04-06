/**
 * Tool definitions for the IRIS Administration MCP server.
 *
 * Exports all tool definitions to be registered with
 * {@link McpServerBase}. Includes namespace, database, mapping,
 * user, role, resource, permission, and web application management
 * tools from Stories 4.2+.
 */

import type { ToolDefinition } from "@iris-mcp/shared";
import { namespaceManageTool, namespaceListTool } from "./namespace.js";
import { databaseManageTool, databaseListTool } from "./database.js";
import { mappingManageTool, mappingListTool } from "./mapping.js";
import {
  userManageTool,
  userGetTool,
  userRolesTool,
  userPasswordTool,
} from "./user.js";
import { roleManageTool, roleListTool } from "./role.js";
import { resourceManageTool, resourceListTool } from "./resource.js";
import { permissionCheckTool } from "./permission.js";
import {
  webappManageTool,
  webappGetTool,
  webappListTool,
} from "./webapp.js";
import { sslManageTool, sslListTool } from "./ssl.js";

/** All tool definitions registered by the iris-admin-mcp server. */
export const tools: ToolDefinition[] = [
  namespaceManageTool,
  namespaceListTool,
  databaseManageTool,
  databaseListTool,
  mappingManageTool,
  mappingListTool,
  userManageTool,
  userGetTool,
  userRolesTool,
  userPasswordTool,
  roleManageTool,
  roleListTool,
  resourceManageTool,
  resourceListTool,
  permissionCheckTool,
  webappManageTool,
  webappGetTool,
  webappListTool,
  sslManageTool,
  sslListTool,
];
