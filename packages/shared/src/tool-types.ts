/**
 * Tool type definitions for the IRIS MCP server framework.
 *
 * Defines the core interfaces used to register tools with the
 * {@link McpServerBase} class: {@link ToolDefinition}, {@link ToolContext},
 * {@link ToolResult}, and {@link ToolAnnotations}.
 */

import type { ZodObject } from "zod";
import type { IrisHttpClient } from "./http-client.js";
import type { IrisConnectionConfig } from "./config.js";

/** Result shape from pagination helpers. */
export interface PaginateResult<T> {
  page: T[];
  nextCursor: string | undefined;
  /** True when the cursor offset was beyond the total number of items. */
  pastEnd?: boolean;
}

/**
 * Additional properties describing a tool to MCP clients.
 *
 * All properties are optional hints &mdash; they are not guaranteed
 * to be a faithful description of tool behaviour.
 */
export interface ToolAnnotations {
  /** When true, the tool does not modify any state. */
  readOnlyHint?: boolean;
  /** When true, the tool may perform destructive operations. */
  destructiveHint?: boolean;
  /** When true, repeated calls with the same arguments produce the same result. */
  idempotentHint?: boolean;
  /** When true, the tool may interact with the external world. */
  openWorldHint?: boolean;
}

/**
 * Namespace scope for a tool.
 *
 * - `NS`   &mdash; Namespace-scoped; respects the namespace parameter or config default.
 * - `SYS`  &mdash; Always executes in %SYS regardless of any namespace parameter.
 * - `BOTH` &mdash; Namespace-scoped but can also target %SYS; same resolution as NS.
 * - `NONE` &mdash; No namespace concept (e.g., server info tools).
 */
export type ToolScope = "NS" | "SYS" | "BOTH" | "NONE";

/**
 * Complete definition of a tool to be registered with the MCP server.
 *
 * Each server package provides an array of these to the
 * {@link McpServerBase} constructor.
 */
export interface ToolDefinition {
  /** Unique tool name, e.g. `"iris.doc.get"`. */
  name: string;
  /** Human-readable title. */
  title: string;
  /** LLM-optimised description of what the tool does. */
  description: string;
  /** Zod schema used for argument validation. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: ZodObject<any>;
  /** Optional Zod schema for structured output validation. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outputSchema?: ZodObject<any>;
  /** Annotation hints for clients. */
  annotations: ToolAnnotations;
  /** Namespace scope governing how namespace is resolved. */
  scope: ToolScope;
  /** Async handler invoked when the tool is called. */
  handler: (args: unknown, context: ToolContext) => Promise<ToolResult>;
}

/**
 * Context object passed to every tool handler.
 *
 * Provides access to the IRIS HTTP client, resolved namespace,
 * negotiated Atelier API version, and connection configuration.
 */
export interface ToolContext {
  /**
   * Resolve the effective namespace for the current tool call.
   *
   * - **NS / BOTH scopes:** returns the provided override, or falls
   *   back to the configured default namespace.
   * - **SYS scope:** always returns `"%SYS"`.
   * - **NONE scope:** returns an empty string (no namespace concept).
   *
   * @param override - Optional namespace provided by the caller.
   */
  resolveNamespace(override?: string): string;
  /** Shared HTTP client for communicating with IRIS. */
  http: IrisHttpClient;
  /** Negotiated Atelier API version (e.g. 7 or 8). */
  atelierVersion: number;
  /** Full connection configuration. */
  config: IrisConnectionConfig;
  /**
   * Paginate an array of items with cursor-based pagination.
   *
   * Returns the current page of items and a `nextCursor` (undefined when
   * no more pages exist).
   *
   * @param items    - Full array to paginate.
   * @param cursor   - Opaque cursor from a previous page (undefined for first page).
   * @param pageSize - Items per page (default: server default, typically 50).
   */
  paginate<T>(items: T[], cursor?: string, pageSize?: number): PaginateResult<T>;
}

/**
 * Standard return type from every tool handler.
 *
 * Always includes at least one `TextContent` entry in `content`.
 * Optionally includes `structuredContent` when the tool returns data.
 */
export interface ToolResult {
  /** One or more text content blocks (required by MCP spec). */
  content: Array<{ type: "text"; text: string }>;
  /** Optional structured data returned by the tool. */
  structuredContent?: unknown;
  /** Set to `true` only when the tool execution encountered an error. */
  isError?: boolean;
}
