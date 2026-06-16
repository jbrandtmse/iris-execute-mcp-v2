/**
 * Base MCP server class for the IRIS MCP suite.
 *
 * Wraps the MCP SDK {@link McpServer} to add Zod-based argument validation,
 * namespace resolution, {@link ToolContext} creation, and IRIS health-check
 * orchestration. Each server package (iris-dev-mcp, iris-admin-mcp, etc.)
 * extends or instantiates this class with its own {@link ToolDefinition}
 * array.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { IrisConnectionConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { IrisHttpClient } from "./http-client.js";
import { checkHealth } from "./health.js";
import { negotiateVersion } from "./atelier.js";
import { bootstrap } from "./bootstrap.js";
import { logger } from "./logger.js";
import type { ProfileRegistry, IrisProfile } from "./profiles.js";
import {
  ProfileClientRegistry,
  buildProfileRegistry,
  loadProfileRegistry,
  resolveProfile,
  DEFAULT_PROFILE_NAME,
} from "./profiles.js";
import type {
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolScope,
  PaginateResult,
} from "./tool-types.js";

/** Default page size for tools/list pagination. */
const DEFAULT_PAGE_SIZE = 50;

/** Options accepted by the {@link McpServerBase} constructor. */
export interface McpServerBaseOptions {
  /** Human-readable server name. */
  name: string;
  /** Semver version string. */
  version: string;
  /** Tool definitions to register on startup. */
  tools: ToolDefinition[];
  /** IRIS connection configuration. When omitted, {@link loadConfig} is used. */
  config?: IrisConnectionConfig;
  /** When true, bootstrap the custom REST service on startup if not already deployed. */
  needsCustomRest?: boolean;
}

// PaginateResult is defined in tool-types.ts and re-exported from index.ts.
export type { PaginateResult } from "./tool-types.js";

/**
 * Encode a pagination cursor from an offset number.
 *
 * Cursor format: base64-encoded JSON `{ offset: N }`.
 *
 * @throws {Error} When offset is negative or NaN.
 */
export function encodeCursor(offset: number): string {
  if (Number.isNaN(offset) || offset < 0) {
    throw new Error(`encodeCursor: offset must be a non-negative number, got ${offset}`);
  }
  return Buffer.from(JSON.stringify({ offset })).toString("base64");
}

/**
 * Decode a pagination cursor back to an offset number.
 *
 * Returns `0` when the cursor is undefined or malformed.
 */
export function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(cursor, "base64").toString("utf-8"),
    );
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "offset" in parsed &&
      typeof (parsed as Record<string, unknown>).offset === "number"
    ) {
      const offset = (parsed as { offset: number }).offset;
      if (offset < 0 || Number.isNaN(offset)) return 0;
      return offset;
    }
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Build a {@link ToolContext} for a single tool call.
 *
 * Exported for unit testing of namespace resolution logic.
 *
 * @param scope           - Namespace scope of the tool.
 * @param config          - IRIS connection config.
 * @param http            - Shared HTTP client.
 * @param atelierVersion  - Negotiated Atelier version.
 * @param pageSize        - Default page size for pagination (default: {@link DEFAULT_PAGE_SIZE}).
 */
export function buildToolContext(
  scope: ToolScope,
  config: IrisConnectionConfig,
  http: IrisHttpClient,
  atelierVersion: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
): ToolContext {
  return {
    resolveNamespace(override?: string): string {
      switch (scope) {
        case "SYS":
          return "%SYS";
        case "NS":
        case "BOTH":
          return override ?? config.namespace;
        case "NONE":
          return "";
      }
    },
    http,
    atelierVersion,
    config,
    paginate<T>(items: T[], cursor?: string, size: number = pageSize): PaginateResult<T> {
      const offset = decodeCursor(cursor);
      if (cursor && offset >= items.length && items.length > 0) {
        return { page: [], nextCursor: undefined };
      }
      const page = items.slice(offset, offset + size);
      const nextOffset = offset + size;
      const nextCursor =
        nextOffset < items.length ? encodeCursor(nextOffset) : undefined;
      return { page, nextCursor };
    },
  };
}

/**
 * Reusable MCP server base for every IRIS MCP server package.
 *
 * Handles:
 * - Tool registration with the MCP SDK (with Zod &rarr; JSON Schema conversion)
 * - Argument validation via Zod `.safeParse()`
 * - Namespace resolution per tool scope
 * - Cursor-based pagination for `tools/list` (default 50 per page)
 * - `notifications/tools/list_changed` emission on add/remove
 * - stdio and HTTP transport setup
 * - Startup orchestration: loadConfig &rarr; connect &rarr; health check &rarr; version negotiation
 */
export class McpServerBase {
  private readonly mcpServer: McpServer;
  private readonly tools: Map<string, ToolDefinition> = new Map();
  /**
   * The default profile's connection config (the `IRIS_*`-derived config).
   * Retained under its original name so existing single-server behavior — and
   * the `handleToolCall` default path — is byte-for-byte unchanged.
   */
  private config: IrisConnectionConfig | undefined;
  /**
   * Profile registry (Epic 14, architecture decision D1/D7). Always contains
   * the reserved `default` profile; additional profiles come from `IRIS_PROFILES`.
   */
  private profiles: ProfileRegistry | undefined;
  /**
   * Per-profile {@link IrisHttpClient} registry (architecture decision D1).
   * Replaces the former single `this.http`: each profile gets its own client so
   * session/cookie/CSRF state never bleeds across profiles. The default
   * profile's client is created eagerly in {@link start}; non-default profiles
   * are created lazily on first {@link getOrCreateClient}.
   */
  private clients: ProfileClientRegistry | undefined;
  /**
   * Per-profile connection metadata: the negotiated Atelier version and whether
   * the one-time custom-REST bootstrap has been attempted (D8). Keyed by
   * profile name. The default profile's entry is populated eagerly in
   * {@link start}; non-default entries are populated on first touch.
   */
  private readonly profileMeta: Map<
    string,
    { atelierVersion: number; bootstrapAttempted: boolean }
  > = new Map();
  /** Negotiated Atelier version for the default profile (unchanged back-compat field). */
  private atelierVersion = 1;

  /** Page size for tools/list pagination. */
  readonly pageSize: number = DEFAULT_PAGE_SIZE;

  constructor(private readonly options: McpServerBaseOptions) {
    this.mcpServer = new McpServer(
      { name: options.name, version: options.version },
      { capabilities: { tools: { listChanged: true } } },
    );

    if (options.config) {
      this.config = options.config;
    }

    // Register all initial tools
    for (const tool of options.tools) {
      this.registerTool(tool);
    }
  }

  // ── Tool registration ──────────────────────────────────────────────

  /**
   * Register a single tool with the MCP SDK.
   *
   * Passes the Zod object schema's `.shape` to the SDK's `registerTool`,
   * which handles Zod v4 natively. Our handler performs independent Zod
   * validation to produce structured error messages on failure.
   */
  private registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);

    // The MCP SDK's registerTool accepts a ZodRawShapeCompat (Record<string, AnySchema>).
    // ZodObject.shape in Zod v4 gives us exactly that.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputShape = tool.inputSchema.shape as any;

    // Convert outputSchema Zod shape for the SDK (mirrors inputSchema pattern)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const outputShape = tool.outputSchema ? (tool.outputSchema.shape as any) : undefined;

    this.mcpServer.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: inputShape,
        ...(outputShape !== undefined && { outputSchema: outputShape }),
        annotations: {
          readOnlyHint: tool.annotations.readOnlyHint,
          destructiveHint: tool.annotations.destructiveHint,
          idempotentHint: tool.annotations.idempotentHint,
          openWorldHint: tool.annotations.openWorldHint,
        },
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      async (args: any): Promise<CallToolResult> => {
        return this.handleToolCall(tool, args);
      },
    );
  }

  /**
   * Handle a tool call: validate arguments, build context, invoke handler.
   *
   * On Zod validation failure, returns a result with `isError: true`
   * containing the validation error details. The MCP SDK maps this to
   * the appropriate JSON-RPC error (-32602).
   */
  private async handleToolCall(
    tool: ToolDefinition,
    rawArgs: unknown,
  ): Promise<CallToolResult> {
    // Validate arguments via Zod
    const parseResult = tool.inputSchema.safeParse(rawArgs);
    if (!parseResult.success) {
      const issues = parseResult.error.issues as Array<{
        path: PropertyKey[];
        message: string;
      }>;
      const errorMessage = issues
        .map((issue) => `${issue.path.map(String).join(".")}: ${issue.message}`)
        .join("; ");

      logger.warn(
        `Zod validation failed for tool ${tool.name}: ${errorMessage}`,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: `Invalid arguments: ${errorMessage}`,
          },
        ],
        isError: true,
      };
    }

    const validatedArgs = parseResult.data;

    // Build tool context with namespace resolution
    if (!this.config || !this.clients) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Server not initialised: IRIS connection not established.",
          },
        ],
        isError: true,
      };
    }

    // Resolve the DEFAULT profile's client. The default profile's client was
    // created (and health-checked / version-negotiated) eagerly in start(), so
    // this returns that same cached instance synchronously — byte-for-byte
    // today's behavior. Per-call `server`-parameter profile selection is
    // Story 14.2 (architecture decision D2); this story keeps handleToolCall on
    // the default profile only.
    const http = this.clients.getOrCreate(DEFAULT_PROFILE_NAME);

    const ctx = buildToolContext(
      tool.scope,
      this.config,
      http,
      this.atelierVersion,
    );

    try {
      const result: ToolResult = await tool.handler(validatedArgs, ctx);
      const callResult: CallToolResult = {
        content: result.content,
        isError: result.isError,
      };
      if (result.structuredContent !== undefined) {
        callResult.structuredContent = result.structuredContent as Record<
          string,
          unknown
        >;
      }
      return callResult;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      logger.error(`Tool ${tool.name} failed: ${message}`);
      return {
        content: [{ type: "text" as const, text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  }

  // ── Dynamic tool management (listChanged) ──────────────────────────

  /**
   * Register additional tools at runtime and emit
   * `notifications/tools/list_changed`.
   */
  addTools(tools: ToolDefinition[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
    this.mcpServer.sendToolListChanged();
    logger.info(`Added ${tools.length} tool(s) and notified clients`);
  }

  /**
   * Remove tools by name at runtime and emit
   * `notifications/tools/list_changed`.
   */
  removeTools(names: string[]): void {
    let removedCount = 0;
    for (const name of names) {
      if (this.tools.delete(name)) {
        // Remove from the SDK's internal registry so the tool is no
        // longer callable or listed.  The SDK does not expose a public
        // unregister API, so we delete from the internal map directly.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sdkTools = (this.mcpServer as any)._registeredTools;
        if (sdkTools && typeof sdkTools === "object" && name in sdkTools) {
          delete sdkTools[name];
        }
        removedCount++;
      }
    }
    if (removedCount > 0) {
      this.mcpServer.sendToolListChanged();
    }
    logger.info(`Removed ${removedCount} tool(s) and notified clients`);
  }

  // ── Pagination helpers ─────────────────────────────────────────────

  /**
   * Paginate an array of items with cursor-based pagination.
   *
   * Returns the page of items and a `nextCursor` (undefined when no
   * more pages exist).
   */
  paginate<T>(
    items: T[],
    cursor: string | undefined,
    pageSize: number = this.pageSize,
  ): PaginateResult<T> {
    const offset = decodeCursor(cursor);
    if (cursor && offset >= items.length && items.length > 0) {
      return { page: [], nextCursor: undefined };
    }
    const page = items.slice(offset, offset + pageSize);
    const nextOffset = offset + pageSize;
    const nextCursor =
      nextOffset < items.length ? encodeCursor(nextOffset) : undefined;
    return { page, nextCursor };
  }

  // ── Transport and startup ──────────────────────────────────────────

  /**
   * Start the MCP server with the specified transport.
   *
   * Startup sequence:
   * 1. Load config + build the profile registry (if not provided)
   * 2. Eagerly create the default profile's {@link IrisHttpClient}
   * 3. Health check via `HEAD /api/atelier/`
   * 4. Negotiate Atelier API version
   * 5. Bootstrap custom REST service for the default profile (if needed)
   * 6. Connect transport
   *
   * Non-default profiles (from `IRIS_PROFILES`) are NOT established here — they
   * are created lazily on first use via {@link getOrCreateClient} (architecture
   * decision D1/D8), so startup cost and behavior for single-server installs is
   * unchanged.
   *
   * @param transport - `"stdio"` (default) or `"http"`.
   */
  async start(transport: "stdio" | "http" = "stdio"): Promise<void> {
    // 1. Load config + build the profile registry.
    //    loadConfig is preserved for the default profile's config so existing
    //    single-server behavior is byte-for-byte unchanged.
    if (!this.config) {
      this.config = loadConfig();
    }
    if (!this.profiles) {
      // When a config was injected (e.g. tests), derive the registry from it so
      // the default profile reflects the injected config; otherwise read the
      // environment centrally (which also parses IRIS_PROFILES).
      this.profiles = this.options.config
        ? buildProfileRegistry(this.config)
        : loadProfileRegistry();
    }
    this.clients = new ProfileClientRegistry(this.profiles);

    // 2. Eagerly create the default profile's HTTP client (preserves today's
    //    bootstrap/health-check/negotiation for the default profile exactly).
    const defaultClient = this.clients.getOrCreate(DEFAULT_PROFILE_NAME);

    // 3. Health check (default profile). A failure here is fatal at startup,
    //    exactly as before — the default profile must be reachable.
    try {
      await checkHealth(defaultClient);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      logger.error(`IRIS health check failed: ${message}`);
      process.exit(1);
      return; // Guard: prevent continued execution when process.exit is mocked
    }

    // 4. Negotiate Atelier version (default profile).
    try {
      this.atelierVersion = await negotiateVersion(defaultClient);
    } catch {
      logger.warn("Version negotiation failed, defaulting to v1");
      this.atelierVersion = 1;
    }

    logger.info(
      `${this.options.name} v${this.options.version} starting with Atelier API v${this.atelierVersion}`,
    );

    // 4.5. Bootstrap custom REST service if needed (default profile).
    if (this.options.needsCustomRest) {
      try {
        const result = await bootstrap(
          defaultClient,
          this.config,
          this.atelierVersion,
        );
        if (result.errors.length > 0) {
          logger.warn(
            `Bootstrap completed with errors: ${result.errors.join("; ")}`,
          );
        }
        if (result.manualInstructions) {
          logger.warn(result.manualInstructions);
        }
      } catch (error: unknown) {
        const message =
          error instanceof Error ? error.message : String(error);
        logger.warn(
          `Bootstrap failed: ${message}. Custom REST tools may not work.`,
        );
      }
    }

    // Record the default profile's metadata (negotiated version + bootstrap
    // attempted) so getOrCreateClient short-circuits re-establishing it.
    // `bootstrapAttempted` reflects whether bootstrap ACTUALLY ran above —
    // it is true only when this server needs the custom-REST service. If it
    // were hard-coded true on a `needsCustomRest: false` server, a later
    // getOrCreateClient(DEFAULT_PROFILE_NAME, true) (the seam Story 14.2 wires)
    // would wrongly skip the default profile's first-use bootstrap, matching
    // the non-default path which seeds `bootstrapAttempted: false`.
    this.profileMeta.set(DEFAULT_PROFILE_NAME, {
      atelierVersion: this.atelierVersion,
      bootstrapAttempted: this.options.needsCustomRest === true,
    });

    // 5. Connect transport
    if (transport === "stdio") {
      const stdioTransport = new StdioServerTransport();
      await this.mcpServer.connect(stdioTransport);
      logger.info("Connected via stdio transport");
    } else {
      // HTTP transport — StreamableHTTPServerTransport requires
      // an HTTP server to be created externally. For now, log a
      // clear message; HTTP support will be fully wired in a
      // future story when server packages define their entry points.
      logger.error(
        "HTTP transport is not yet fully implemented. " +
          "Use stdio transport or implement HTTP setup in the server package.",
      );
      throw new Error("HTTP transport not yet implemented");
    }
  }

  // ── Per-profile client establishment (D1/D8) ───────────────────────

  /**
   * Get the established {@link IrisHttpClient} for a profile, creating and
   * establishing it lazily on first use (architecture decisions D1/D8).
   *
   * - **Default profile:** created and established eagerly in {@link start};
   *   this method returns the cached client + negotiated version without
   *   re-establishing it (byte-for-byte today's behavior).
   * - **Non-default profile:** on first call, creates the profile's own client,
   *   runs the health check and Atelier-version negotiation, then caches the
   *   result so the one-time negotiation latency is paid at most once. A
   *   health-check failure is surfaced as a thrown error (NOT `process.exit`) —
   *   only the default profile's startup failure is fatal.
   * - **Lazy bootstrap (D8):** when `needsBootstrap` is true (a custom-REST
   *   tool's first call against this profile), the existing auto-bootstrap flow
   *   is attempted once per profile. On failure it surfaces the existing
   *   structured remediation report as a warning rather than a silent no-op.
   *   Atelier-only tools pass `needsBootstrap: false` and never trigger it.
   *
   * NOTE (scope boundary with Story 14.2): this method is the seam 14.2 will
   * call from `handleToolCall` once the per-call `server` parameter is wired.
   * In this story, `handleToolCall` only ever resolves the default profile, so
   * behavior is unchanged; this method is exercised directly by unit tests.
   *
   * @param profileName    - A registered profile name.
   * @param needsBootstrap - Whether to attempt the one-time custom-REST bootstrap.
   * @returns The profile's established client and its negotiated Atelier version.
   * @throws {ProfileResolutionError} When `profileName` is not registered.
   * @throws {Error} When a non-default profile fails its health check.
   */
  async getOrCreateClient(
    profileName: string,
    needsBootstrap: boolean = this.options.needsCustomRest ?? false,
  ): Promise<{ client: IrisHttpClient; atelierVersion: number }> {
    if (!this.clients || !this.profiles) {
      throw new Error(
        "Server not initialised: profile registry not built. Call start() first.",
      );
    }

    const profile: IrisProfile = resolveProfile(this.profiles, profileName);
    const client = this.clients.getOrCreate(profile.name);
    const existingMeta = this.profileMeta.get(profile.name);

    // Already established (default profile, or a previously-touched profile).
    if (existingMeta) {
      // A custom-REST tool may be the FIRST custom-REST use of a profile whose
      // client was established by an Atelier-only call. Attempt bootstrap once.
      if (needsBootstrap && !existingMeta.bootstrapAttempted) {
        await this.attemptProfileBootstrap(profile, client, existingMeta.atelierVersion);
        existingMeta.bootstrapAttempted = true;
      }
      return { client, atelierVersion: existingMeta.atelierVersion };
    }

    // First touch of a non-default profile: health check + version negotiation.
    await checkHealth(client);

    let atelierVersion: number;
    try {
      atelierVersion = await negotiateVersion(client);
    } catch {
      logger.warn(
        `Version negotiation failed for profile "${profile.name}", defaulting to v1`,
      );
      atelierVersion = 1;
    }

    const meta = { atelierVersion, bootstrapAttempted: false };
    this.profileMeta.set(profile.name, meta);

    if (needsBootstrap) {
      await this.attemptProfileBootstrap(profile, client, atelierVersion);
      meta.bootstrapAttempted = true;
    }

    return { client, atelierVersion };
  }

  /**
   * Attempt the one-time custom-REST bootstrap for a profile (D8).
   *
   * Reuses the existing {@link bootstrap} orchestration. On failure it logs the
   * existing structured "which steps succeeded / failed + manual remediation"
   * report (never a silent no-op), matching the default profile's own startup
   * bootstrap behavior.
   */
  private async attemptProfileBootstrap(
    profile: IrisProfile,
    client: IrisHttpClient,
    atelierVersion: number,
  ): Promise<void> {
    try {
      const result = await bootstrap(client, profile, atelierVersion);
      if (result.errors.length > 0) {
        logger.warn(
          `Bootstrap for profile "${profile.name}" completed with errors: ${result.errors.join("; ")}`,
        );
      }
      if (result.manualInstructions) {
        logger.warn(result.manualInstructions);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Bootstrap failed for profile "${profile.name}": ${message}. Custom REST tools may not work against this profile.`,
      );
    }
  }

  // ── Accessors ──────────────────────────────────────────────────────

  /** The underlying MCP SDK server instance, for advanced use cases. */
  get server(): McpServer {
    return this.mcpServer;
  }

  /** Number of currently registered tools. */
  get toolCount(): number {
    return this.tools.size;
  }

  /** Retrieve a registered tool definition by name. */
  getTool(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  /** Get all registered tool names. */
  getToolNames(): string[] {
    return [...this.tools.keys()];
  }
}
