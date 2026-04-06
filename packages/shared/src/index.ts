// @iris-mcp/shared — barrel export

export type { IrisConnectionConfig } from "./config.js";
export { loadConfig } from "./config.js";
export {
  IrisConnectionError,
  IrisApiError,
  McpProtocolError,
} from "./errors.js";
export { IrisHttpClient } from "./http-client.js";
export type { RequestOptions, AtelierEnvelope } from "./http-client.js";
export { logger } from "./logger.js";
export type { Logger } from "./logger.js";
export { checkHealth, ping } from "./health.js";
export {
  negotiateVersion,
  requireMinVersion,
  atelierPath,
} from "./atelier.js";
export type {
  ToolAnnotations,
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolScope,
} from "./tool-types.js";
export {
  McpServerBase,
  encodeCursor,
  decodeCursor,
  buildToolContext,
} from "./server-base.js";
export type { McpServerBaseOptions, PaginateResult } from "./server-base.js";
