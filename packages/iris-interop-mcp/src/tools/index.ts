/**
 * Tool definitions for the IRIS Interoperability MCP server.
 *
 * Exports all tool definitions to be registered with
 * {@link McpServerBase}. Stories 5.2-5.6 will populate this array
 * with production, business host, message, and settings tools.
 */

import type { ToolDefinition } from "@iris-mcp/shared";

/** All tool definitions registered by the iris-interop-mcp server. */
export const tools: ToolDefinition[] = [];
