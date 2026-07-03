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
  /** Unique tool name, e.g. `"iris_doc_get"`. */
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
  /**
   * Mutation classification for tool governance (Epic 14, architecture decision D4).
   *
   * Declares whether a tool's operations read or write IRIS state, so the
   * governance engine ({@link ../governance.js}) can apply the safe default
   * seed: new `read` actions enabled, new `write`/`change` actions disabled.
   *
   * Two forms, matching the governance-key model (`tool` vs `tool:action`):
   * - **Scalar** (`'read' | 'write'`) — a single-operation tool with no
   *   `action` enum. The governance key is the bare tool {@link name}.
   * - **Per-action map** (`Record<actionValue, 'read' | 'write'>`) — a
   *   multi-action tool whose `inputSchema` has an `action` enum. Each key is
   *   an enum value; the governance key is `name:action`.
   *
   * **Required for every NEW (non-baseline) tool; grandfathered tools omit it
   * (Story 15.0 AC 15.0.3).** Every tool/action key that is NOT a member of the
   * generated governance baseline (`governance-baseline.ts`) MUST declare
   * `mutates` — `'read'` or `'write'` (or a per-action map). A registration-time
   * assertion (`assertGovernanceClassification`, invoked from
   * {@link ./server-base.js | McpServerBase}) throws, naming the offending key,
   * if a non-baseline key reaches registration without a classification —
   * catching a forgotten classification for reads AND writes before it can
   * mis-seed the policy.
   *
   * Every tool that PREDATES governance is exempt: it omits `mutates` and is
   * treated as pre-existing (enabled) via baseline membership, NOT via this
   * field. Do NOT retro-classify existing (baseline) tools.
   */
  mutates?: "read" | "write" | Record<string, "read" | "write">;
  /**
   * "Write, default-enabled" governance override (Epic 20, architecture decision F2).
   *
   * A list of `action` values that are truthfully `write` (they still appear in
   * {@link mutates} as `"write"`, and `annotations.destructiveHint` stays honest)
   * yet should resolve to **enabled** under an empty `IRIS_GOVERNANCE`, instead of
   * the default-disabled seed a new write would otherwise get.
   *
   * This is the ONLY lever to ship a new write enabled-by-default WITHOUT
   * mislabelling it as a read and WITHOUT touching the frozen governance baseline
   * (`governance-baseline.ts`, `1e62c5ad5bf7` — Rule #23/#25). It feeds a
   * `defaultEnabledWrites` set threaded (optional, default-empty) through
   * {@link ../governance.js | defaultSeed/effective/getEffectivePolicy}; a write key
   * present in that set seeds to `true`.
   *
   * Strictly additive: with NO tool declaring `defaultEnabled` (the default-empty
   * set), the governance seed is byte-for-byte today's — every new write still
   * defaults to disabled (Rule #19). An operator can still disable a
   * default-enabled write via an explicit `IRIS_GOVERNANCE` `false` (the cascade
   * honors explicit overrides at either layer).
   *
   * Requires the per-action {@link mutates} record form: each listed action MUST
   * be declared `"write"` in the same tool's `mutates` map (`mutates: { clean:
   * "write" }` + `defaultEnabled: ["clean"]`, matching `iris_production_control:clean`,
   * the first user). `buildDefaultEnabledWrites` fail-fasts at registration if a
   * listed action is missing from `mutates`, classified `"read"`, or the tool uses
   * the scalar `mutates` form — a scalar-write tool's governance key is the bare
   * tool name with no action, so an action-keyed `defaultEnabled` cannot address it.
   */
  defaultEnabled?: string[];
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
