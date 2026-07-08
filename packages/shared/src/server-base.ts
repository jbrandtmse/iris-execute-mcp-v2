/**
 * Base MCP server class for the IRIS MCP suite.
 *
 * Wraps the MCP SDK {@link McpServer} to add Zod-based argument validation,
 * namespace resolution, {@link ToolContext} creation, and IRIS health-check
 * orchestration. Each server package (iris-dev-mcp, iris-admin-mcp, etc.)
 * extends or instantiates this class with its own {@link ToolDefinition}
 * array.
 */

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult, ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ZodObject } from "zod";

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
  ProfileResolutionError,
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
import type { GovernanceConfig, GovernancePreset, MutatesLookup } from "./governance.js";
import {
  parseGovernanceConfig,
  parseGovernancePreset,
  buildMutatesLookup,
  buildDefaultEnabledWrites,
  unwrapActionOptions,
  assertGovernanceClassification,
  effective,
  getEffectivePolicy,
  presetSeed,
  hasExplicitOverride,
} from "./governance.js";
import { GOVERNANCE_BASELINE } from "./governance-baseline.js";
import { BASELINE_ACTION_CLASSIFICATIONS } from "./baseline-classifications.js";
import {
  SERVER_DISCOVERY_TOOL_NAME,
  SERVER_DISCOVERY_INSTRUCTIONS,
  serverDiscoveryTool,
  computeServerDiscovery,
} from "./server-discovery.js";

/** Default page size for tools/list pagination. */
const DEFAULT_PAGE_SIZE = 50;

/**
 * URI scheme for the advisory governance resource (Epic 14, architecture
 * decision D6). `iris-governance://default` is the static default/global-policy
 * resource (appears in `resources/list`); `iris-governance://{profile}` is the
 * per-profile template (appears in `resources/templates/list` and serves
 * `resources/read`). Both render the {@link getEffectivePolicy} map as JSON.
 *
 * The resource is ADVISORY ONLY (AC 14.5.4): it lets a client preview which
 * actions a profile permits, but the authoritative boundary is the call-time
 * enforcement gate in {@link McpServerBase.handleToolCall} (D5). No code path
 * depends on a client ever reading this resource.
 */
const GOVERNANCE_URI_SCHEME = "iris-governance";
/** Static resource name + URI for the default/global policy (D6). */
const GOVERNANCE_DEFAULT_RESOURCE_NAME = "iris-governance-default";
const GOVERNANCE_DEFAULT_URI = `${GOVERNANCE_URI_SCHEME}://${DEFAULT_PROFILE_NAME}`;
/** Template resource name + URI pattern for the per-profile policy (D6). */
const GOVERNANCE_TEMPLATE_RESOURCE_NAME = "iris-governance-profile";
const GOVERNANCE_TEMPLATE_URI = `${GOVERNANCE_URI_SCHEME}://{profile}`;

/**
 * The framework `server` parameter, injected into every tool's input schema at
 * registration (architecture decision D2). Defined once here so the description
 * is identical across all current and future tools and on all five servers, and
 * so future tools inherit it automatically — never hand-add it per tool.
 *
 * The value is the name of a profile from `IRIS_PROFILES`; omitting it selects
 * the reserved `default` profile (today's single-server behavior). The field is
 * optional, so adding it to a tool's advertised `inputSchema` is additive and
 * non-breaking per JSON-Schema/MCP semantics (the Epic 14 back-compat gate).
 */
const SERVER_PARAM_FIELD = {
  server: z
    .string()
    .optional()
    .describe(
      "Named server profile to target for this call (from `IRIS_PROFILES`). Omit to use the default server.",
    ),
} as const;

/**
 * Extend a tool's input schema with the shared {@link SERVER_PARAM_FIELD} so the
 * `server` parameter is advertised and validated centrally (architecture
 * decision D2). The returned schema is used both for the SDK-advertised
 * `inputSchema` (so clients see `server`) and for validation in
 * {@link McpServerBase.handleToolCall} (so Zod captures `server` instead of
 * stripping it as an unknown key).
 *
 * `server` is a name reserved by the framework (D2). If a tool's own input
 * schema already declares a `server` field, `.extend()` would silently replace
 * it and {@link McpServerBase.handleToolCall} would then strip it before the
 * handler — so the tool would silently lose its own argument. We fail fast at
 * registration instead, naming the offending tool, so the collision is caught
 * in development rather than mis-routing calls in production.
 *
 * @throws {Error} When `inputSchema` already declares a `server` field.
 */
export function withServerParam(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  inputSchema: ZodObject<any>,
  toolName?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ZodObject<any> {
  if (Object.prototype.hasOwnProperty.call(inputSchema.shape, "server")) {
    throw new Error(
      `Tool ${toolName ?? "(unknown)"} declares a reserved input field "server". ` +
        `"server" is injected centrally by the framework (architecture decision D2) ` +
        `to select the connection profile; a tool must not define its own "server" field. ` +
        `Rename the tool's parameter.`,
    );
  }
  return inputSchema.extend(SERVER_PARAM_FIELD);
}

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
   * Per-tool input schema extended with the shared `server` parameter (D2).
   * Keyed by tool name. {@link handleToolCall} validates against THIS schema
   * (not the tool's original `inputSchema`) so Zod captures `server` rather than
   * stripping it as an unknown key; `server` is then read and removed before the
   * handler is invoked, keeping handlers byte-for-byte unchanged.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly extendedSchemas: Map<string, ZodObject<any>> = new Map();
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
  /**
   * In-flight first-touch establishment Promises, keyed by profile name
   * (AC 14.2.7 — routed Story 14.1 CR MED #1). When a profile is being
   * established for the first time, its establishment Promise is cached here so
   * concurrent first-touch calls for the SAME profile await ONE shared
   * establishment (and so `attemptProfileBootstrap` runs at most once per
   * profile). The entry is cleared once establishment settles (success OR
   * failure) so a failed first touch is retryable.
   */
  private readonly establishing: Map<
    string,
    Promise<{ client: IrisHttpClient; atelierVersion: number }>
  > = new Map();
  /** Negotiated Atelier version for the default profile (unchanged back-compat field). */
  private atelierVersion = 1;

  /**
   * Parsed `IRIS_GOVERNANCE` policy (Epic 14, architecture decisions D5/D7).
   * Drives the call-time enforcement gate in {@link handleToolCall}.
   *
   * Defaults to `{}` (an empty config) so a server that is constructed but never
   * {@link start}ed — and the window before `start()` parses the env — is a SAFE
   * pass-through: under an empty config every baseline action resolves enabled
   * (the back-compat gate). {@link start} replaces this with the parsed
   * `IRIS_GOVERNANCE`, which fails fast (naming the var) on malformed input.
   */
  private governanceConfig: GovernanceConfig = {};
  /**
   * Active `IRIS_GOVERNANCE_PRESET` (Story 24.1, spec 02 §2.2), or `undefined`
   * when unset. Threaded (optional, default-`undefined`) into every
   * {@link getEffectivePolicy}/{@link effective} call site alongside
   * {@link BASELINE_ACTION_CLASSIFICATIONS}, so the resource, the enforcement
   * gate, and the discovery tool all agree on the preset's effect.
   *
   * Defaults to `undefined` (no preset) so a server constructed but not yet
   * {@link start}ed — and the window before `start()` parses the env — stays a
   * pure pass-through, exactly like {@link governanceConfig}'s default `{}`
   * (the back-compat gate). {@link start} replaces this with the parsed
   * `IRIS_GOVERNANCE_PRESET`, which fails fast (naming the var + valid values)
   * on an unrecognized value.
   */
  private preset: GovernancePreset | undefined = undefined;
  /**
   * Key → mutation-class lookup for the registered tools (architecture decision
   * D4), built from each {@link ToolDefinition.mutates}. Consumed by the gate's
   * {@link effective} call so a NEW write action defaults disabled and a NEW read
   * action defaults enabled. Built once in the constructor — the tool set is known
   * at construction — so the gate has it even before {@link start} (when the
   * empty `governanceConfig` already makes the gate a pass-through anyway).
   */
  private mutatesLookup: MutatesLookup = new Map();

  /**
   * "Write, default-enabled" key set (Epic 20, architecture decision F2), built
   * from each {@link ToolDefinition.defaultEnabled}. A `write` key in this set
   * seeds ENABLED under an empty `IRIS_GOVERNANCE` (instead of the default-disabled
   * seed a new write gets), while remaining truthfully `mutates: "write"`. Threaded
   * into {@link getEffectivePolicy} (the resource + discovery tool) and
   * {@link effective} (the call-time gate) so all three agree (no drift).
   *
   * Default-empty and rebuilt alongside {@link mutatesLookup} in
   * {@link rebuildMutatesLookup}: with no tool opting in, this is empty and the
   * governance seed is byte-for-byte today's (Rule #19 back-compat gate). An
   * operator can still disable a default-enabled write via an explicit
   * `IRIS_GOVERNANCE` `false` (the cascade honors explicit overrides).
   */
  private defaultEnabledWrites: ReadonlySet<string> = new Set();

  /**
   * Every governance key this server's advisory resource reports on (Epic 14,
   * architecture decisions D4/D6): the union of {@link GOVERNANCE_BASELINE} and
   * this server's own registered tool/action keys, computed with the SAME logic
   * as {@link computeGovernanceKey} / the baseline generator so the resource's
   * keys line up exactly with the enforcement gate's. Passed as `allKeys` to
   * {@link getEffectivePolicy} when the `iris-governance://{profile}` resource is
   * read. Rebuilt whenever the tool set changes ({@link rebuildGovernedKeys}).
   *
   * Including the full baseline (not just this server's keys) means the resource
   * reports a complete, consistent policy view across the suite — a client can
   * read any one server's resource and see the effective enablement of every
   * grandfathered action, plus this server's new actions.
   */
  private governedKeys: Set<string> = new Set();

  /** Page size for tools/list pagination. */
  readonly pageSize: number = DEFAULT_PAGE_SIZE;

  constructor(private readonly options: McpServerBaseOptions) {
    this.mcpServer = new McpServer(
      { name: options.name, version: options.version },
      {
        // `resources` is declared explicitly here per D6 so the `initialize`
        // result advertises it. The SDK ALSO calls registerCapabilities with the
        // identical `resources: { listChanged: true }` when registerResource runs
        // (mcp.js setResourceRequestHandlers); registerCapabilities merges, so the
        // two are idempotent and do not conflict. Declaring it up front guarantees
        // the capability is present even before any transport/registration timing.
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true },
        },
        // Server-level usage guidance (Epic 19, decision E1 / AC 19.0.5). Carried
        // into the `initialize` result by the SDK so capable clients surface it at
        // connect time; reinforces the call-first guidance also in the discovery
        // tool's own description. Generic across all five servers.
        instructions: SERVER_DISCOVERY_INSTRUCTIONS,
      },
    );

    if (options.config) {
      this.config = options.config;
    }

    // Register all initial tools
    for (const tool of options.tools) {
      this.registerTool(tool);
    }

    // Register the framework-provided discovery tool centrally (Epic 19,
    // decision E1) — wired here, exactly like the D2 `server`-param injection and
    // the D6 governance resource, so it appears on all five servers without any
    // per-package `tools/index.ts` wiring. It MUST go through registerTool (it
    // lives in `this.tools`) so rebuildGovernedKeys/rebuildMutatesLookup pick it
    // up and its `mutates: "read"` classification is enforced; its CALL is
    // special-cased in handleToolCall (it needs the profile/governance internals
    // and must not establish an IRIS connection). Registered before the rebuilds
    // below so its key/classification are reflected. Guard against a package that
    // already supplies a same-named tool (it must not — the name is reserved).
    if (this.tools.has(SERVER_DISCOVERY_TOOL_NAME)) {
      throw new Error(
        `Tool name "${SERVER_DISCOVERY_TOOL_NAME}" is reserved by the framework ` +
          `(the server & governance discovery tool, decision E1) and must not be ` +
          `declared by a server package.`,
      );
    }
    this.registerTool(serverDiscoveryTool);

    // Build the governance mutates lookup (D4) from the registered tools. The
    // tool set is fully known at construction, so this is cheap and lets the
    // enforcement gate classify NEW actions even before start() parses
    // IRIS_GOVERNANCE. (governanceConfig stays `{}` until start(), so the gate
    // is a pure pass-through in the meantime — see the field doc.) Built from the
    // live registry (not options.tools) so addTools/removeTools can rebuild it
    // and keep a dynamically-added governed tool's key classified.
    this.rebuildMutatesLookup();
    // Compute the governance key universe the advisory resource reports on (D6),
    // also from the live registry so addTools/removeTools keep it in sync.
    this.rebuildGovernedKeys();
    // Fail fast if a NEW (non-baseline) governed key lacks a `mutates` class
    // (AC 15.0.3). Dormant on today's all-baseline surface; the safety net for
    // Epic 15+ write tools. Runs after BOTH rebuilds so it reads current state.
    this.assertGovernanceClassified();

    // Register the advisory governance resource (D6): a static default-policy
    // resource + a per-profile template. Registered at construction (like tools)
    // so the resource handlers + the `resources` capability are wired before any
    // transport connects. The read callbacks close over `this`, so they read the
    // governance config / governed-key set as they are AT READ TIME — by which
    // point start() has parsed IRIS_GOVERNANCE. sendResourceListChanged() is a
    // no-op until a transport attaches, so this is safe pre-connect.
    this.registerGovernanceResource();
  }

  /**
   * Rebuild {@link mutatesLookup} from the live tool registry (architecture
   * decision D4). Called at construction and whenever the tool set changes
   * ({@link addTools} / {@link removeTools}) so a dynamically-added governed
   * tool's `mutates` metadata is reflected in the enforcement gate's seed.
   */
  private rebuildMutatesLookup(): void {
    this.mutatesLookup = buildMutatesLookup(this.tools.values());
    // Rebuild the "write, default-enabled" set (F2) from the same live registry,
    // so a dynamically-added tool declaring `defaultEnabled` is reflected in the
    // gate/resource/discovery seed alongside its `mutates` classification.
    this.defaultEnabledWrites = buildDefaultEnabledWrites(this.tools.values());
  }

  /**
   * Rebuild {@link governedKeys} (the advisory resource's key universe, D6) from
   * the live tool registry: the union of {@link GOVERNANCE_BASELINE} and every
   * registered tool/action key. Keys are computed with the SAME rule the gate
   * and the baseline generator use — `tool:action` for a tool whose input schema
   * declares an `action` ZodEnum (one key per enum value), the bare `tool` name
   * otherwise — so the resource's reported keys align exactly with the gate.
   * Called at construction and on every {@link addTools} / {@link removeTools}.
   */
  private rebuildGovernedKeys(): void {
    const keys = new Set<string>(GOVERNANCE_BASELINE);
    for (const tool of this.tools.values()) {
      // Use the SHARED unwrap helper (Story 15.0 AC 15.0.1) so this key universe
      // lines up exactly with computeGovernanceKey and the baseline generator —
      // including a future wrapped (`.optional()`/`.default()`/`.nullable()`)
      // action enum, which is peeled to its inner ZodEnum here too.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actionField = (tool.inputSchema as any)?.shape?.action;
      const options = unwrapActionOptions(actionField);
      if (Array.isArray(options) && options.length > 0) {
        for (const value of options) {
          keys.add(`${tool.name}:${String(value)}`);
        }
      } else {
        keys.add(tool.name);
      }
    }
    this.governedKeys = keys;
  }

  /**
   * Fail fast (Story 15.0 AC 15.0.3) if any governed key in this server's key
   * universe is NEW (absent from {@link GOVERNANCE_BASELINE}) yet carries no
   * `mutates` classification — which would otherwise let the default seed treat
   * it as a read and ship a write enabled-by-default. Catches "added a new write
   * tool but forgot `mutates`" at registration rather than silently mis-seeding.
   *
   * Dormant on today's surface: every current key is a baseline member, so this
   * only activates once Epic 15+ genuinely-new tools land. Called after every
   * {@link rebuildMutatesLookup} + {@link rebuildGovernedKeys} pair (construction
   * and dynamic add/remove) so the lookup and key universe it reads are current.
   */
  private assertGovernanceClassified(): void {
    assertGovernanceClassification(this.governedKeys, this.mutatesLookup);
  }

  // ── Advisory governance resource (D6) ──────────────────────────────

  /**
   * Compute the effective governance policy for a profile as a JSON-serialized
   * {@link ReadResourceResult} (architecture decision D6). Shared by the static
   * default resource and the per-profile template read callbacks.
   *
   * Resolves the profile name against the registry FIRST so an unknown profile
   * surfaces a structured {@link McpError} (mapped from {@link ProfileResolutionError})
   * rather than silently returning a default-shaped map or crashing the server.
   * The default profile always resolves (it is reserved), so the static
   * `iris-governance://default` resource never errors on resolution.
   *
   * @param profileName - The profile whose effective policy to report.
   * @param uri         - The resource URI (echoed into the result `contents`).
   * @throws {McpError} (InvalidParams) when `profileName` is not a registered profile.
   */
  private buildGovernancePolicyResult(
    profileName: string,
    uri: string,
  ): ReadResourceResult {
    // Resolve against the registry so an unknown profile is a clean resource
    // error. When the registry is not yet built (server constructed but not
    // start()ed), fall back to validating just the reserved default — the only
    // profile guaranteed to exist pre-start.
    if (this.profiles) {
      try {
        resolveProfile(this.profiles, profileName);
      } catch (error: unknown) {
        if (error instanceof ProfileResolutionError) {
          throw new McpError(ErrorCode.InvalidParams, error.message);
        }
        throw error;
      }
    } else if (profileName !== DEFAULT_PROFILE_NAME) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `Unknown server profile "${profileName}". The server is not yet initialised; only "${DEFAULT_PROFILE_NAME}" is available.`,
      );
    }

    const policy = getEffectivePolicy(
      profileName,
      this.governanceConfig,
      this.governedKeys,
      this.mutatesLookup,
      GOVERNANCE_BASELINE,
      this.defaultEnabledWrites,
      this.preset,
      BASELINE_ACTION_CLASSIFICATIONS,
    );

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(policy),
        },
      ],
    };
  }

  /**
   * Register the advisory governance resource (architecture decision D6 — the
   * minimal, single-resource-type provider; NOT a generalized ResourceDefinition
   * framework, which is deferred until a second resource exists). Two pieces:
   *
   * - A STATIC resource `iris-governance://default` for the default/global
   *   policy, so `resources/list` advertises a concrete entry.
   * - A `ResourceTemplate` `iris-governance://{profile}` for any profile, serving
   *   `resources/read` and listed under `resources/templates/list`. Its `list`
   *   callback is `undefined` (D6 minimal — the template is for parameterized
   *   read, not enumeration of every profile); the SDK requires the field to be
   *   passed explicitly even when undefined.
   *
   * Registering either resource auto-wires the SDK's `resources/list`,
   * `resources/templates/list`, and `resources/read` handlers and (re)advertises
   * the `resources` capability (already declared in the constructor).
   */
  private registerGovernanceResource(): void {
    // Static default/global policy resource → resources/list.
    this.mcpServer.registerResource(
      GOVERNANCE_DEFAULT_RESOURCE_NAME,
      GOVERNANCE_DEFAULT_URI,
      {
        title: "IRIS governance policy (default profile)",
        description:
          "Advisory: the effective enabled/disabled action map for the default " +
          "server profile. The call-time enforcement gate is authoritative; this " +
          "resource is a read-only preview.",
        mimeType: "application/json",
      },
      (uri: URL): ReadResourceResult =>
        this.buildGovernancePolicyResult(DEFAULT_PROFILE_NAME, uri.toString()),
    );

    // Per-profile policy template → resources/templates/list + resources/read.
    //
    // The `list` callback (Epic 19, decision E1 optional companion / AC 19.0.7)
    // enumerates one concrete `iris-governance://<profile>` resource per
    // configured profile, so resource-reading clients can ALSO discover the
    // profile roster (by name) via `resources/list` — closing the same
    // enumeration hole the discovery tool closes for tool-calling clients. It
    // reads `this.profiles` at CALL TIME (closure), so it reflects the registry
    // built in start(); before start() (`this.profiles` undefined) it lists just
    // the reserved default, mirroring buildGovernancePolicyResult's pre-start
    // fallback. Was previously `undefined` (D6 minimal); now provided.
    this.mcpServer.registerResource(
      GOVERNANCE_TEMPLATE_RESOURCE_NAME,
      new ResourceTemplate(GOVERNANCE_TEMPLATE_URI, {
        list: (): { resources: Array<{ uri: string; name: string }> } => {
          const names = this.profiles
            ? [...this.profiles.keys()]
            : [DEFAULT_PROFILE_NAME];
          return {
            resources: names.map((name) => ({
              uri: `${GOVERNANCE_URI_SCHEME}://${name}`,
              name: `${GOVERNANCE_TEMPLATE_RESOURCE_NAME}-${name}`,
              description: `Advisory governance policy for the "${name}" server profile.`,
              mimeType: "application/json",
            })),
          };
        },
      }),
      {
        title: "IRIS governance policy (per profile)",
        description:
          "Advisory: the effective enabled/disabled action map for a named " +
          "server profile (iris-governance://<profile>). The call-time " +
          "enforcement gate is authoritative; this resource is a read-only preview.",
        mimeType: "application/json",
      },
      (uri: URL, variables: Record<string, unknown>): ReadResourceResult => {
        // The URI template binds {profile}; it may surface as string | string[].
        const raw = variables.profile;
        const profileName = Array.isArray(raw) ? String(raw[0]) : String(raw);
        return this.buildGovernancePolicyResult(profileName, uri.toString());
      },
    );
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

    // Centrally inject the framework `server` parameter into the tool's input
    // schema (architecture decision D2). The EXTENDED schema is what we advertise
    // and what handleToolCall validates against; it is stored so the two stay in
    // lock-step. Injecting here (once, for every tool) — rather than hand-adding
    // `server` per tool — gives uniform coverage and makes future tools inherit
    // it for free. outputSchema is untouched (additive, back-compat).
    const extendedInputSchema = withServerParam(tool.inputSchema, tool.name);
    this.extendedSchemas.set(tool.name, extendedInputSchema);

    // The MCP SDK's registerTool accepts a ZodRawShapeCompat (Record<string, AnySchema>).
    // ZodObject.shape in Zod v4 gives us exactly that. Advertise the EXTENDED
    // shape so clients see the optional `server` field.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inputShape = extendedInputSchema.shape as any;

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
   * Compute the governance key for a call (architecture decision D4).
   *
   * - **Multi-action tool** — when the tool's input schema declares an `action`
   *   ZodEnum (i.e. `inputSchema.shape.action.options` is a non-empty array), the
   *   key is `tool:action`, reading the validated `action` value.
   * - **Single-operation tool** — otherwise the key is the bare tool name.
   *
   * This MUST mirror, exactly, how `scripts/gen-governance-baseline.mjs`
   * enumerated keys (`inputSchema.shape.action.options`, guarded by
   * `Array.isArray && length > 0`). Aligning the gate's runtime key with the
   * generated baseline's keys is what makes a governed action resolve against the
   * correct baseline / policy entry — if the gate computed `tool` while the
   * baseline holds `tool:action` (or vice-versa), the cascade would miss and the
   * effective policy would be wrong. The companion baseline-alignment test pins
   * this equivalence.
   *
   * @param tool          - The tool definition (its schema declares the `action` enum, if any).
   * @param validatedArgs - The Zod-validated args (with `server` already stripped).
   * @returns The governance key (`tool` or `tool:action`).
   */
  private computeGovernanceKey(
    tool: ToolDefinition,
    validatedArgs: Record<string, unknown>,
  ): string {
    // Read the schema's `action` field exactly as the generator does, via the
    // SHARED `unwrapActionOptions` helper (Story 15.0 AC 15.0.1) so the gate and
    // `scripts/gen-governance-baseline.mjs` stay in lock-step: a bare ZodEnum
    // exposes `.options` directly, and a wrapped enum (`.optional()`/`.default()`
    // /`.nullable()`) is peeled to its inner ZodEnum first. A ZodString / absent
    // field has no options, so the bare-tool branch is taken. Typed loosely
    // because the SDK schema shape is `ZodObject<any>`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actionField = (tool.inputSchema as any)?.shape?.action;
    const options = unwrapActionOptions(actionField);
    if (
      Array.isArray(options) &&
      options.length > 0 &&
      // AC 15.0.2 (generalized): only compose `tool:action` when the validated
      // `action` is an ACTUAL member of the (unwrapped) enum options — i.e. a key
      // the baseline generator could itself produce. A bare `action !== undefined`
      // guard caught the omitted/`undefined` case but NOT a `.nullable()` enum's
      // `null` (which built the never-matching `tool:null`) nor any other
      // non-member value; both would resolve through the seed instead of the
      // per-action policy — a per-action write deny silently bypassed (fail-open).
      // Membership keeps the gate key in lock-step with the generated baseline and
      // falls back to the bare-tool key for an absent/null/non-member action.
      options.includes(validatedArgs.action)
    ) {
      // Multi-action tool with a concrete, in-enum action value: the governance
      // key includes the chosen action.
      return `${tool.name}:${String(validatedArgs.action)}`;
    }
    return tool.name;
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
    // Validate arguments via Zod against the EXTENDED schema (the original
    // inputSchema + the framework `server` field). Validating against the
    // extended schema is what lets Zod capture `server`; parsing with the
    // unextended `tool.inputSchema` would strip `server` as an unknown key
    // before we could read it (architecture decision D2).
    //
    // The extended schema MUST exist: registerTool populates it for every tool
    // before the SDK callback can fire, and removeTools deletes the SDK callback
    // alongside the schema. If it is ever missing, falling back to the unextended
    // schema would SILENTLY strip `server` and mis-route the call to the default
    // profile — so we fail fast with a structured error instead.
    const extendedSchema = this.extendedSchemas.get(tool.name);
    if (!extendedSchema) {
      logger.error(
        `Tool ${tool.name}: missing extended input schema (internal invariant violated).`,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Internal error: tool "${tool.name}" is not fully registered (missing extended schema).`,
          },
        ],
        isError: true,
      };
    }
    const parseResult = extendedSchema.safeParse(rawArgs);
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

    // Separate the framework `server` parameter from the tool's own args, then
    // STRIP it so the handler never sees it (D2 — handlers stay byte-for-byte
    // unchanged). `server` is the only key the extended schema adds, so removing
    // it yields exactly the args the original inputSchema produced.
    const { server, ...validatedArgs } = parseResult.data as {
      server?: string;
    } & Record<string, unknown>;

    // Build tool context with namespace resolution
    if (!this.config || !this.clients || !this.profiles) {
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

    // Resolve the `server` profile name → profile (architecture decision D2).
    // Omitted/empty `server` resolves to the reserved `default` profile, whose
    // client + version were established eagerly in start() — byte-for-byte
    // today's behavior (the back-compat gate). An unknown profile name surfaces
    // a structured `isError` result (naming the bad profile + valid names)
    // rather than throwing out of the SDK handler.
    let profile: IrisProfile;
    try {
      profile = resolveProfile(this.profiles, server);
    } catch (error: unknown) {
      if (error instanceof ProfileResolutionError) {
        // The framework discovery tool is connection-agnostic (it reports
        // in-memory config and never connects), so the `server` arg is
        // irrelevant to it — its own `profile` arg selects which policy to
        // report. An unknown `server` therefore must NOT hard-fail the
        // "call discovery first to learn valid profile names" workflow
        // (CR 19.0-2): fall back to the reserved default profile and proceed.
        // The tool's own `profile` arg is still validated downstream.
        if (tool.name === SERVER_DISCOVERY_TOOL_NAME) {
          profile = resolveProfile(this.profiles, DEFAULT_PROFILE_NAME);
        } else {
          logger.warn(
            `Tool ${tool.name}: ${error.message}`,
          );
          return {
            content: [{ type: "text" as const, text: error.message }],
            isError: true,
          };
        }
      } else {
        throw error;
      }
    }

    // ── Governance enforcement gate (architecture decision D5) ─────────
    //
    // The ONE chokepoint. Ordering per D5: validate (Zod, above) → resolve
    // `server`→profile (above) → extract action + evaluate policy (here) →
    // deny-or-proceed → build context + invoke (below). It sits AFTER profile
    // resolution and BEFORE getOrCreateClient, so a denied call neither
    // establishes the profile's connection (no health-check / bootstrap) nor
    // reaches the handler — enforcement is uniform and un-bypassable across all
    // five servers from this single point.
    //
    // Enforcement is CALL-TIME by necessity (AC 14.4.3): the governing profile is
    // selected per-call via `server`, so per-profile policy cannot be evaluated at
    // advertise/registration time. Every tool therefore stays in `tools/list`
    // (advertise-time is untouched); the policy is applied here, when the target
    // profile is known.
    //
    // Back-compat (AC 14.4.4): with no IRIS_GOVERNANCE and no
    // IRIS_GOVERNANCE_PRESET, `governanceConfig` is `{}` and `this.preset` is
    // `undefined`, so `presetSeed` is a pure pass-through and every key in the
    // generated baseline resolves enabled — this gate is a pure pass-through,
    // today's behavior, byte-for-byte (Rule #19).
    const governanceKey = this.computeGovernanceKey(tool, validatedArgs);
    if (
      !effective(
        governanceKey,
        profile.name,
        this.governanceConfig,
        this.mutatesLookup,
        GOVERNANCE_BASELINE,
        this.defaultEnabledWrites,
        this.preset,
        BASELINE_ACTION_CLASSIFICATIONS,
      )
    ) {
      // Disabled action (AC 14.4.2): structured denial. Human-readable text +
      // a machine-readable code in structuredContent; the handler is NEVER
      // invoked and the connection is NOT established.
      //
      // AC 24.1.4c: attribute WHY the call was denied. `presetApplied` is set
      // ONLY when the `presetSeed` layer (not an explicit IRIS_GOVERNANCE
      // override at either layer) caused the denial — an explicit `false`
      // denial must NOT carry it, so operators can tell the two apart.
      const presetCaused =
        this.preset !== undefined &&
        !hasExplicitOverride(governanceKey, profile.name, this.governanceConfig) &&
        presetSeed(
          governanceKey,
          this.preset,
          this.mutatesLookup,
          BASELINE_ACTION_CLASSIFICATIONS,
        ) === false;
      logger.warn(
        `Tool ${tool.name}: action "${governanceKey}" denied by governance policy for profile "${profile.name}"` +
          (presetCaused ? ` (preset "${this.preset}").` : "."),
      );
      const structuredContent: Record<string, unknown> = {
        code: "GOVERNANCE_DISABLED",
        action: governanceKey,
        server: profile.name,
      };
      if (presetCaused) {
        structuredContent.presetApplied = this.preset;
      }
      return {
        content: [
          {
            type: "text" as const,
            text: `action '${governanceKey}' is disabled by governance policy for server '${profile.name}'`,
          },
        ],
        structuredContent,
        isError: true,
      };
    }

    // ── Discovery tool short-circuit (Epic 19, decision E1) ────────────
    //
    // The framework discovery tool reports IN-MEMORY config (the profile roster +
    // effective governance policy). It is handled HERE — after Zod validation,
    // `server` resolution, and the governance gate (so it is governed uniformly,
    // a no-op since it is `mutates: "read"` → enabled-by-default), but BEFORE
    // getOrCreateClient — for two reasons: (a) it needs the server-base internals
    // (`this.profiles`/`this.governanceConfig`/`this.governedKeys`/
    // `this.mutatesLookup`) the standard ToolContext does not expose, and (b) it
    // must NOT establish an IRIS connection (it works even when the target IRIS
    // is down). `this.profiles` is guaranteed defined by the "Server not
    // initialised" guard above. An unknown single `profile` arg surfaces a clean
    // structured error (ProfileResolutionError), not a thrown SDK error.
    if (tool.name === SERVER_DISCOVERY_TOOL_NAME) {
      try {
        const discovery = computeServerDiscovery(
          validatedArgs as { profile?: string; allProfiles?: boolean },
          this.profiles,
          this.governanceConfig,
          this.governedKeys,
          this.mutatesLookup,
          this.defaultEnabledWrites,
          this.preset,
          BASELINE_ACTION_CLASSIFICATIONS,
        );
        return {
          content: [
            { type: "text" as const, text: JSON.stringify(discovery, null, 2) },
          ],
          structuredContent: discovery as unknown as Record<string, unknown>,
        };
      } catch (error: unknown) {
        if (error instanceof ProfileResolutionError) {
          logger.warn(`Tool ${tool.name}: ${error.message}`);
          return {
            content: [{ type: "text" as const, text: error.message }],
            isError: true,
          };
        }
        throw error;
      }
    }

    // Get-or-create the resolved profile's client (health-check + version
    // negotiation on first touch of a non-default profile, then cached). The
    // default profile returns its eagerly-established client + version. Custom
    // REST servers pass needsCustomRest so the one-time per-profile bootstrap is
    // attempted on first custom-REST touch (D8). A first-touch failure surfaces
    // as a structured isError result, not a thrown error out of the SDK handler.
    let client: IrisHttpClient;
    let atelierVersion: number;
    try {
      ({ client, atelierVersion } = await this.getOrCreateClient(
        profile.name,
        this.options.needsCustomRest ?? false,
      ));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `Tool ${tool.name}: failed to establish profile "${profile.name}": ${message}`,
      );
      return {
        content: [
          {
            type: "text" as const,
            text: `Could not connect to server profile "${profile.name}": ${message}`,
          },
        ],
        isError: true,
      };
    }

    // Build context from the RESOLVED PROFILE so that namespace precedence
    // (AC 14.2.5) falls out naturally: resolveNamespace(override) returns
    // `override ?? profile.namespace`. `server` selects the instance/profile;
    // a per-call `namespace` still overrides the namespace within it.
    const ctx = buildToolContext(
      tool.scope,
      profile,
      client,
      atelierVersion,
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
    // Keep the governance mutates lookup in sync with the live tool set (D4) so
    // a newly-added governed tool's `mutates` classification is enforced.
    this.rebuildMutatesLookup();
    // Keep the advisory resource's key universe in sync too (D6), so a newly
    // added tool's keys appear in the effective-policy map.
    this.rebuildGovernedKeys();
    // Fail fast if a dynamically-added NEW governed key lacks a `mutates` class
    // (AC 15.0.3) — same safety net as construction.
    this.assertGovernanceClassified();
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
        // Drop the extended-schema entry too, so it does not leak after removal.
        this.extendedSchemas.delete(name);
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
      // Rebuild the governance mutates lookup so a removed governed tool's key
      // no longer carries a stale classification (D4).
      this.rebuildMutatesLookup();
      // Rebuild the advisory resource's key universe too (D6). Note baseline
      // keys remain (the resource always reports the full grandfathered set);
      // only this server's own non-baseline keys drop out.
      this.rebuildGovernedKeys();
      // Re-assert classification after removal (AC 15.0.3): removing a tool
      // cannot introduce an unclassified key, but keeping the call alongside the
      // rebuild pair makes the invariant uniform across every mutation path.
      this.assertGovernanceClassified();
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

    // Parse the governance policy centrally (architecture decisions D5/D7),
    // mirroring loadProfileRegistry(): read IRIS_GOVERNANCE once at startup.
    // parseGovernanceConfig fails fast (naming IRIS_GOVERNANCE) on malformed
    // input, so a misconfigured policy is caught at boot rather than mis-enforced
    // per call. Absent/empty IRIS_GOVERNANCE ⇒ `{}` ⇒ the enforcement gate is a
    // pure pass-through (every baseline action enabled — the back-compat gate).
    this.governanceConfig = parseGovernanceConfig();

    // Parse the governance safety preset (Story 24.1, spec 02 §2.2), mirroring
    // the IRIS_GOVERNANCE parse immediately above. parseGovernancePreset fails
    // fast (naming IRIS_GOVERNANCE_PRESET + the valid values) on an unrecognized
    // value, so a typo (e.g. "read_only") is caught at boot rather than silently
    // running full-access when the operator intended read-only. Absent/empty ⇒
    // `undefined` ⇒ the presetSeed layer is a pure pass-through (AC 24.1.1).
    this.preset = parseGovernancePreset();

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
   * - **Concurrency (AC 14.2.7):** the first-touch establishment Promise is
   *   cached per profile in {@link establishing}, so two concurrent first-touch
   *   calls for the same profile await ONE shared establishment and bootstrap is
   *   attempted at most once. The cache entry clears once establishment settles
   *   (success OR failure).
   * - **First-touch failure (AC 14.2.8):** on a non-default health-check
   *   rejection, the cached (un-established) client is `destroy()`-ed and
   *   dropped so the failure is retryable — the next call re-creates a fresh
   *   client and re-attempts establishment; no un-established client lingers.
   *
   * This method is the seam {@link handleToolCall} calls once it resolves the
   * per-call `server` parameter to a profile (architecture decision D2).
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
    const existingMeta = this.profileMeta.get(profile.name);

    // Fast path: the profile is already established AND no first-touch async
    // work is needed (either no bootstrap requested, or it was already
    // attempted). Returns synchronously — the default profile's hot path stays
    // byte-for-byte today's behavior. `getOrCreate` returns the cached client.
    if (existingMeta && (!needsBootstrap || existingMeta.bootstrapAttempted)) {
      return {
        client: this.clients.getOrCreate(profile.name),
        atelierVersion: existingMeta.atelierVersion,
      };
    }

    // Async work is needed: either first-touch establishment, or the first
    // custom-REST bootstrap of an already-established client. Coalesce through a
    // single in-flight Promise per profile so concurrent callers share one
    // establishment + at-most-once bootstrap (AC 14.2.7).
    const inFlight = this.establishing.get(profile.name);
    if (inFlight) {
      return inFlight;
    }

    const establishPromise = this.establishProfile(profile, needsBootstrap);
    this.establishing.set(profile.name, establishPromise);
    try {
      return await establishPromise;
    } finally {
      // Clear the in-flight entry once it settles (success OR failure) so a
      // failed first touch is retryable on the next call (AC 14.2.8).
      this.establishing.delete(profile.name);
    }
  }

  /**
   * Perform the async establishment work for a profile (health check +
   * version negotiation on first touch, plus the optional one-time bootstrap).
   * Always invoked through {@link getOrCreateClient}'s in-flight coalescing, so
   * it runs at most once concurrently per profile.
   *
   * On a non-default first-touch health-check failure, the cached client is
   * destroyed and dropped (AC 14.2.8) before the error is re-thrown, so no
   * un-established client lingers and the next call retries cleanly.
   */
  private async establishProfile(
    profile: IrisProfile,
    needsBootstrap: boolean,
  ): Promise<{ client: IrisHttpClient; atelierVersion: number }> {
    // clients/profiles are guaranteed defined by the getOrCreateClient guard.
    const registry = this.clients as ProfileClientRegistry;
    const client = registry.getOrCreate(profile.name);
    let meta = this.profileMeta.get(profile.name);

    // First touch (no meta yet): health check + version negotiation.
    if (!meta) {
      try {
        await checkHealth(client);
      } catch (error: unknown) {
        // Drop the un-established client so the failure is retryable; no session
        // was established on a failed health check, so there is nothing to leak
        // beyond the cached (unusable) client instance itself (AC 14.2.8).
        registry.drop(profile.name);
        throw error;
      }

      let atelierVersion: number;
      try {
        atelierVersion = await negotiateVersion(client);
      } catch {
        logger.warn(
          `Version negotiation failed for profile "${profile.name}", defaulting to v1`,
        );
        atelierVersion = 1;
      }

      meta = { atelierVersion, bootstrapAttempted: false };
      this.profileMeta.set(profile.name, meta);
    }

    // Optional one-time bootstrap (first custom-REST use of this profile).
    if (needsBootstrap && !meta.bootstrapAttempted) {
      await this.attemptProfileBootstrap(profile, client, meta.atelierVersion);
      meta.bootstrapAttempted = true;
    }

    return { client, atelierVersion: meta.atelierVersion };
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
