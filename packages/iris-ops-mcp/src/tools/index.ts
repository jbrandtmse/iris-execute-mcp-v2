/**
 * Tool definitions for the IRIS Operations & Monitoring MCP server.
 *
 * Exports all tool definitions to be registered with
 * {@link McpServerBase}. Starts empty; Stories 6.2-6.7 will
 * populate this array with operations and monitoring tools.
 */

import type { ToolDefinition } from "@iris-mcp/shared";

/** All tool definitions registered by the iris-ops-mcp server. */
export const tools: ToolDefinition[] = [];
