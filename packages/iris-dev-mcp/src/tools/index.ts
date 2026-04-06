/**
 * Tool definitions for the IRIS Development MCP server.
 *
 * Initially exports an empty array; individual tool modules
 * (doc, compile, intelligence, format, sql, server, macro)
 * will be added in Stories 2.2 through 2.7.
 */

import type { ToolDefinition } from "@iris-mcp/shared";

/** All tool definitions registered by the iris-dev-mcp server. */
export const tools: ToolDefinition[] = [];
