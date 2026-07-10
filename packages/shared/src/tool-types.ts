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
 * A single argument accepted by a {@link PromptDefinition} (Story 25.0,
 * spec `03-skills-prompts-pack.md` §2).
 */
export interface PromptArgumentDefinition {
  /** Argument name — becomes a key in the `build(args)` record. */
  name: string;
  /** Human-readable description shown to the client (`prompts/list`). */
  description: string;
  /**
   * When true, `prompts/get` fails with a JSON-RPC `InvalidParams` error if
   * the argument is omitted (enforced by the MCP SDK's own args-schema
   * validation, not hand-rolled here).
   */
  required: boolean;
}

/**
 * Complete definition of an MCP **prompt** &mdash; a parameterized, named
 * workflow instruction discoverable via `prompts/list` and rendered via
 * `prompts/get` (Story 25.0, spec `03-skills-prompts-pack.md` §2).
 *
 * Each server package MAY provide an array of these to the
 * {@link McpServerBase} constructor via {@link McpServerBaseOptions.prompts},
 * mirroring how {@link ToolDefinition}s are supplied via `tools`. Unlike
 * tools, prompts carry NO `mutates` classification and are never subject to
 * the governance enforcement gate &mdash; they are static, client-rendered
 * text, not IRIS operations.
 *
 * Registering at least one prompt causes the MCP SDK to advertise the
 * `prompts` capability (`prompts: { listChanged: true }`) automatically; a
 * server with an empty/absent `prompts` array advertises NO `prompts`
 * capability at all, so back-compat is exact (Rule #19).
 */
export interface PromptDefinition {
  /** Unique prompt name (kebab-case), e.g. `"diagnose-stuck-production"`. */
  name: string;
  /** Human-readable title. */
  title: string;
  /** LLM-optimised description of what the prompt does. */
  description: string;
  /** Ordered list of arguments the prompt accepts (may be empty). */
  arguments: PromptArgumentDefinition[];
  /**
   * Render the prompt's user-role message text from the (SDK-validated)
   * arguments. Pure — no IRIS access, no side effects.
   *
   * Values are typed `string | undefined`, not `string`: an OPTIONAL argument
   * the client omits is absent from the validated `args` object (its value is
   * `undefined`), even though a REQUIRED argument is guaranteed present at
   * runtime by the SDK's args-schema validation. Authors must therefore handle
   * omitted optionals defensively (e.g. `args.detail ?? "default"`) — the type
   * enforces this so a `build` body cannot silently dereference an omitted
   * optional and throw at render time.
   */
  build(args: Record<string, string | undefined>): string;
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
  /**
   * Resolve a fully-established {@link IrisHttpClient} for a NAMED profile —
   * the framework primitive that lets one tool call talk to a SECOND IRIS
   * server profile, beyond the calling profile already available as
   * {@link http} (Story 27.0, Epic 27 "environment diff/promote" feature).
   *
   * Reuses the EXACT establishment path {@link http} itself went through
   * (health-check + Atelier-version negotiation + the one-time custom-REST
   * bootstrap) via the same per-profile client registry
   * ({@link ../profiles.js!ProfileClientRegistry} — architecture decision D1)
   * — NEVER a raw, un-bootstrapped client. This guarantees a custom-REST call
   * (e.g. `/dev/doc/hashes`) against the returned client succeeds even when
   * the target profile has never been the calling (`server`) profile before.
   *
   * Async because establishment is async (health-check + version negotiation
   * + bootstrap are all network calls) — a deliberate, documented divergence
   * from an illustrative synchronous signature sketch (Rule #47): callers
   * MUST `await` the returned Promise before issuing requests on the
   * resolved client.
   *
   * @param profileName - A registered profile name (from `IRIS_PROFILES`, or
   *   the reserved `"default"` profile).
   * @returns The named profile's established {@link IrisHttpClient}.
   * @throws `ProfileResolutionError` (from `./profiles.js`) when `profileName`
   *   is not a registered profile — the error message names every valid
   *   profile.
   */
  resolveProfileClient(profileName: string): Promise<IrisHttpClient>;
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
