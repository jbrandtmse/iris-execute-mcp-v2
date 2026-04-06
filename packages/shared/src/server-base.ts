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
import { logger } from "./logger.js";
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
}

// PaginateResult is defined in tool-types.ts and re-exported from index.ts.
export type { PaginateResult } from "./tool-types.js";

/**
 * Encode a pagination cursor from an offset number.
 *
 * Cursor format: base64-encoded JSON `{ offset: N }`.
 */
export function encodeCursor(offset: number): string {
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
      return (parsed as { offset: number }).offset;
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
  private config: IrisConnectionConfig | undefined;
  private http: IrisHttpClient | undefined;
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
    if (!this.config || !this.http) {
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

    const ctx = buildToolContext(
      tool.scope,
      this.config,
      this.http,
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
   * 1. Load config (if not provided)
   * 2. Create {@link IrisHttpClient}
   * 3. Health check via `HEAD /api/atelier/`
   * 4. Negotiate Atelier API version
   * 5. Connect transport
   *
   * @param transport - `"stdio"` (default) or `"http"`.
   */
  async start(transport: "stdio" | "http" = "stdio"): Promise<void> {
    // 1. Load config
    if (!this.config) {
      this.config = loadConfig();
    }

    // 2. Create HTTP client
    this.http = new IrisHttpClient(this.config);

    // 3. Health check
    try {
      await checkHealth(this.http);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      logger.error(`IRIS health check failed: ${message}`);
      process.exit(1);
      return; // Guard: prevent continued execution when process.exit is mocked
    }

    // 4. Negotiate Atelier version
    try {
      this.atelierVersion = await negotiateVersion(this.http);
    } catch {
      logger.warn("Version negotiation failed, defaulting to v1");
      this.atelierVersion = 1;
    }

    logger.info(
      `${this.options.name} v${this.options.version} starting with Atelier API v${this.atelierVersion}`,
    );

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
