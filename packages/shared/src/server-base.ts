/**
 * Base MCP server class for the IRIS MCP suite.
 *
 * Wraps the MCP SDK {@link McpServer} to add Zod-based argument validation,
 * namespace resolution, {@link ToolContext} creation, and IRIS health-check
 * orchestration. Each server package (iris-dev-mcp, iris-admin-mcp, etc.)
 * extends or instantiates this class with its own {@link ToolDefinition}
 * array.
 */

import { randomBytes, randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { dirname } from "node:path";

import {
  CLIENT_CAPABILITIES_META_KEY,
  McpServer,
  ProtocolErrorCode,
  ResourceTemplate,
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  isInputRequiredResult,
} from "@modelcontextprotocol/server";
import { StdioServerTransport, serveStdio } from "@modelcontextprotocol/server/stdio";
import type { StdioServerHandle } from "@modelcontextprotocol/server/stdio";
import type {
  CallToolResult,
  InputRequiredResult,
  ReadResourceResult,
  GetPromptResult,
  McpRequestContext,
  McpServerFactory,
  RegisteredTool,
  ServerContext,
  Variables,
} from "@modelcontextprotocol/server";
import { z } from "zod";
import type { ZodObject } from "zod";

import type { IrisConnectionConfig } from "./config.js";
import { loadConfig } from "./config.js";
import { IrisHttpClient, bindSignal } from "./http-client.js";
import { checkHealth } from "./health.js";
import { negotiateVersion } from "./atelier.js";
import { bootstrap } from "./bootstrap.js";
import { logger } from "./logger.js";
import type { AuditConfig, AuditConfirmation, AuditEntryInput, AuditOutcome } from "./audit.js";
import { AuditLogger, parseAuditConfig } from "./audit.js";
import type { ConfirmationState } from "./confirmation.js";
import {
  CANCELLED_CALL_TEXT,
  CONFIRMATION_INPUT_KEY,
  CONFIRMATION_PENDING,
  CONFIRMATION_SCHEMA,
  CONFIRMATION_STATE_TTL_SECONDS,
  ConfirmationNonces,
  UNANSWERED_CONFIRMATION_TEXT,
  auditConfirmationOf,
  classifyConfirmationResponse,
  confirmationDeclinedResult,
  confirmationMessage,
  contentHash,
  declaresFormElicitation,
  isConfirmationState,
} from "./confirmation.js";
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
  ConfirmationOutcome,
  ConfirmationRequest,
  ToolDefinition,
  ToolContext,
  ToolResult,
  ToolScope,
  PaginateResult,
  PromptDefinition,
} from "./tool-types.js";
import type { GovernanceConfig, GovernancePreset, MutatesLookup, ParentKeys } from "./governance.js";
import {
  parseGovernanceConfig,
  parseGovernancePreset,
  loadGovernanceFile,
  buildMutatesLookup,
  buildDefaultEnabledWrites,
  buildParentKeys,
  assertParentKeysKnown,
  inheritedParentDisable,
  unwrapActionOptions,
  assertGovernanceClassification,
  effective,
  getEffectivePolicy,
  getEffectiveConfigSources,
  presetSeed,
  hasExplicitOverride,
  unknownProfileWarnings,
  governanceKeysByTool,
  unmatchedGovernanceKeys,
  assertDataPolicyDeclarations,
} from "./governance.js";
import {
  applyDataPolicies,
  effectiveDataPolicy,
  parseDataPolicyValue,
  parseOperatorDataPolicy,
} from "./data-policy.js";
import type { DataPolicy, DataPolicySummary } from "./data-policy.js";
import { GOVERNANCE_BASELINE } from "./governance-baseline.js";
import { BASELINE_ACTION_CLASSIFICATIONS } from "./baseline-classifications.js";
import { REFUSAL_CODES, refusalResult } from "./refusals.js";
import {
  SERVER_DISCOVERY_TOOL_NAME,
  SERVER_DISCOVERY_INSTRUCTIONS,
  serverDiscoveryTool,
  computeServerDiscovery,
} from "./server-discovery.js";
import type { ToolPresetRosters, ToolPresetName, ToolVisibilityConfig } from "./tool-visibility.js";
import {
  parseToolVisibilityConfig,
  resolveVisibleTools,
  assertPresetCoverage,
} from "./tool-visibility.js";
import type { ListedTool } from "./sdk-wire-compat.js";
import {
  checkWireInput,
  checkWireOutput,
  listedTool,
  protocolError,
  toolErrorResult,
  v1ProtocolErrorText,
  wireInputSchema,
} from "./sdk-wire-compat.js";

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
  /**
   * Prompt definitions to register on startup (Story 25.0, spec
   * `03-skills-prompts-pack.md` §2). Optional and additive: an empty/absent
   * array registers no prompts, and the SDK's `prompts` capability is
   * advertised ONLY when at least one prompt is registered — so a server
   * with no prompts is byte-for-byte unchanged (Rule #19 back-compat gate).
   */
  prompts?: PromptDefinition[];
  /** IRIS connection configuration. When omitted, {@link loadConfig} is used. */
  config?: IrisConnectionConfig;
  /** When true, bootstrap the custom REST service on startup if not already deployed. */
  needsCustomRest?: boolean;
  /**
   * Package-owned tool-visibility preset rosters (Epic 30, architecture
   * decision I2). Optional: `packages/<pkg>/src/tools/presets.ts` exports a
   * {@link ToolPresetRosters} (`{ core: {include,exclude}; developer:
   * {include,exclude} }`), passed here by the package's `index.ts` — Story
   * 30.1 is the first wiring. Consumed by the constructor's tool-visibility
   * filter (`IRIS_TOOLS_PRESET`) via `resolveVisibleTools`, and validated at
   * construction by `assertPresetCoverage` (throws on an incomplete/
   * overlapping roster). Default: absent ⇒ every named preset behaves like
   * `"full"` (all tools visible) — a package that has not yet wired rosters
   * is unaffected by `IRIS_TOOLS_PRESET=core|developer`.
   */
  toolPresets?: ToolPresetRosters;
}

// PaginateResult is defined in tool-types.ts and re-exported from index.ts.
export type { PaginateResult } from "./tool-types.js";

/**
 * A registered prompt: what the framework's own `prompts/get` serves, and what the instance builder registers on
 * the SDK. `render` turns the arguments into the prompt's messages. For a prompt that declares arguments,
 * `argsSchema` is the object schema that checks `arguments`; a prompt that declares none has no schema and
 * ignores whatever `arguments` the request carries.
 */
interface PromptEntry {
  name: string;
  title: string;
  description: string;
  render: (args: Record<string, string | undefined>) => GetPromptResult;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  argsSchema: ZodObject<any> | undefined;
}

/** The SDK-visible metadata of a resource. */
interface ResourceInfo {
  title: string;
  description: string;
  mimeType: string;
}

/**
 * A resource: what the framework's own `resources/read` serves (one exact URI, or every URI a template matches),
 * and what the instance builder registers on the SDK.
 */
type ResourceReader =
  | { kind: "exact"; name: string; info: ResourceInfo; uri: string; read: (uri: URL) => ReadResourceResult }
  | {
      kind: "template";
      name: string;
      info: ResourceInfo;
      template: ResourceTemplate;
      read: (uri: URL, variables: Variables) => ReadResourceResult;
    };

/** The paths into `handleToolCall`: the SDK-registered callback (in-process), and the wire request. */
type ToolCallSource = "callback" | "wire";

/** The first protocol revision of the era that carries client capabilities in each request's envelope. */
const MODERN_PROTOCOL_VERSION = "2026-07-28";

/**
 * What a `tools/call` off the wire carries beyond its parameters: the SDK instance serving it and the request
 * context of this round (its abort signal, retry state and envelope), and what the round decided about a
 * confirmation. A context of a unit test may lack any member of `ctx`; every read of it allows that.
 */
interface WireCall {
  instance: McpServer;
  ctx: ServerContext;
  /** How the person answered, once this round has decided the call. */
  confirmation?: AuditConfirmation;
  /** The question this round asks, when it asks one: the handler's `ctx.confirm` returned the pending sentinel. */
  pending?: InputRequiredResult;
  /** The nonce of {@link pending}'s state. */
  pendingNonce?: string;
}

/** The members of a request context that a wire call reads. Each may be absent on the stub context of a test. */
interface RequestView {
  signal?: AbortSignal;
  envelope?: object;
  inputResponses?: Record<string, unknown>;
  requestState?: () => unknown;
}

/** The `mcpReq` of the request context of `wireCall`, or `undefined` when the context has none. */
function requestView(wireCall: WireCall): RequestView | undefined {
  return (wireCall.ctx as { mcpReq?: RequestView } | undefined)?.mcpReq;
}

/** A confirmation dialog that was put to the client and has no answer yet; it ends as one `unanswered` audit entry. */
interface PendingAsk {
  tool: ToolDefinition;
  args: unknown;
  start: number;
  expiresAt: number;
}

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
 * @param scope                  - Namespace scope of the tool.
 * @param config                 - IRIS connection config.
 * @param http                   - Shared HTTP client.
 * @param atelierVersion         - Negotiated Atelier version.
 * @param pageSize               - Default page size for pagination (default: {@link DEFAULT_PAGE_SIZE}).
 * @param resolveProfileClientImpl - Real implementation of
 *   {@link ToolContext.resolveProfileClient} (Story 27.0). {@link McpServerBase.handleToolCall}
 *   passes a closure over its own `getOrCreateClient`/profile registry here.
 *   Callers that build a context directly (unit/integration tests calling
 *   this factory without a live server) get a safe stub that rejects with a
 *   clear "not available in this context" error — never a silently
 *   un-established client.
 * @param governanceFileConfig - The STARTUP-SNAPSHOT parsed
 *   `IRIS_GOVERNANCE_FILE` config (Story 32.1, deferred item 32-0-1).
 *   {@link McpServerBase.handleToolCall} passes the snapshot loaded once in
 *   {@link McpServerBase.start}; direct callers omit it (`undefined` = no
 *   file = byte-for-byte the pre-Epic-32 behavior). Handlers read it via
 *   {@link ToolContext.governanceFileConfig} — never a per-call
 *   `loadGovernanceFile()`.
 */
export function buildToolContext(
  scope: ToolScope,
  config: IrisConnectionConfig,
  http: IrisHttpClient,
  atelierVersion: number,
  pageSize: number = DEFAULT_PAGE_SIZE,
  resolveProfileClientImpl?: (profileName: string) => Promise<IrisHttpClient>,
  governanceFileConfig?: GovernanceConfig,
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
    resolveProfileClient:
      resolveProfileClientImpl ??
      (async (profileName: string): Promise<IrisHttpClient> => {
        throw new Error(
          `resolveProfileClient("${profileName}") is not available: this ToolContext was built ` +
            `without a live profile registry (buildToolContext() called directly, outside ` +
            `McpServerBase.handleToolCall).`,
        );
      }),
    // Conditional spread (the buildRosterEntry discipline): a context built
    // without the snapshot carries NO key rather than an undefined-valued
    // one, so direct-caller shape is byte-for-byte pre-Story-32.1.
    ...(governanceFileConfig !== undefined ? { governanceFileConfig } : {}),
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
 * - stdio transport setup
 * - Startup orchestration: loadConfig &rarr; connect &rarr; health check &rarr; version negotiation
 */
export class McpServerBase {
  /**
   * The current SDK instance: the one built at construction until the stdio entry asks for another, then the
   * latest one it asked for.
   */
  private mcpServer: McpServer;
  /** Whether the instance built at construction has been handed to the stdio entry. */
  private constructionInstanceHandedOut = false;
  /** The open stdio serving handle, from {@link start} until {@link stop}. */
  private servingHandle: StdioServerHandle | undefined;
  /**
   * Mints and verifies the `requestState` of a confirmation dialog: HMAC-SHA256 under a key that lives as long as
   * this process, which over stdio serves every round of a call. A state minted by another process never verifies.
   */
  private readonly confirmationCodec = createRequestStateCodec<ConfirmationState>({
    key: randomBytes(32),
    ttlSeconds: CONFIRMATION_STATE_TTL_SECONDS,
  });
  /**
   * The nonces of the confirmation states that have decided a call, so a state is honored once. A nonce outlives
   * its state by two seconds, because the codec counts a state's expiry in whole seconds.
   */
  private readonly confirmationNonces = new ConfirmationNonces((CONFIRMATION_STATE_TTL_SECONDS + 2) * 1000);
  /** The dialogs put to a client that have no answer yet, by nonce. Filled only while auditing is on. */
  private readonly pendingAsks: Map<string, PendingAsk> = new Map();
  /** The timer that ends the pending asks whose state has expired. It never keeps the process alive. */
  private pendingAskTimer: ReturnType<typeof setTimeout> | undefined;
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
   * Per-tool schema for the wire validation of a `tools/call`: the fields of the extended input schema without
   * any refinement on the whole object (see {@link wireInputSchema}). Keyed by tool name, like
   * {@link extendedSchemas}.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private readonly wireSchemas: Map<string, ZodObject<any>> = new Map();
  /** The `tools/list` entry of each tool, built on first use. Keyed by tool name. */
  private readonly listedTools: Map<string, ListedTool> = new Map();
  /**
   * The SDK's handle on each tool of the current instance, so a removed tool leaves that instance's registry
   * through its public `remove()`.
   */
  private sdkTools: Map<string, RegisteredTool> = new Map();
  /** The registered prompts, by name, for the framework's own `prompts/get`. */
  private readonly promptEntries: Map<string, PromptEntry> = new Map();
  /** Every registered prompt, in registration order, for the instance builder. */
  private readonly promptRegistrations: PromptEntry[] = [];
  /** The registered resources, in registration order, for the framework's own `resources/read` and the instance builder. */
  private readonly resourceReaders: ResourceReader[] = [];
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
  /**
   * Negotiated Atelier version for the default profile (unchanged back-compat field).
   *
   * **Log-only — never a call-path source of truth (M1, Epic 37).** Every read
   * outside `start()` goes through `ToolContext.atelierVersion`, which comes
   * from `getOrCreateClient`'s RETURN VALUE (`profileMeta`, or
   * `establishProfile`'s own local). When `start()`'s eager attempt fails this
   * field keeps its `1` default and is never corrected on recovery, so a new
   * reader added here would silently talk v1 to a v8 instance. Read
   * `profileMeta` instead.
   */
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
   * Parsed `IRIS_GOVERNANCE_FILE` policy (Epic 32, Story 32.0, AC 32.0.1;
   * architecture decision J1), or `undefined` when the var is unset — the two
   * file layers of the cascade, strictly BELOW both env layers
   * (`env.profile ?? env.global ?? file.profile ?? file.global ??
   * inheritedDisable ?? presetSeed ?? defaultSeed`, AC 32.0.2).
   *
   * `undefined` is also the constructed-but-not-yet-{@link start}ed default —
   * every cascade helper treats an absent file config as byte-for-byte the
   * pre-Epic-32 behavior (the AC 32.0.1 back-compat gate). {@link start}
   * replaces this with {@link loadGovernanceFile}'s result: unset ⇒
   * `undefined` with ZERO filesystem access; set ⇒ the file MUST load and
   * validate or startup fails fast (naming the var + the path).
   */
  private governanceFileConfig: GovernanceConfig | undefined = undefined;
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
   * Audit logger (Epic 29, spec `07-observability-audit-log.md`), or
   * `undefined` when `IRIS_AUDIT_LOG` is unset (auditing OFF). `undefined` is
   * also the constructed-but-not-yet-{@link start}ed default, matching
   * {@link governanceConfig}'s `{}` and {@link preset}'s `undefined` defaults:
   * {@link handleToolCall} treats an `undefined` logger as a pure
   * pass-through with zero allocation on the hot path (Rule #19 back-compat
   * gate; AC 29.0.4). {@link start} constructs it from the parsed
   * `IRIS_AUDIT_LOG*` env vars, after failing fast if the target directory is
   * not writable.
   */
  private auditLogger: AuditLogger | undefined;
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
   * Child key to parent key map (Story 38.4, AD-4/AD-6), built from each
   * {@link ToolDefinition.parent}. A key whose parent is explicitly disabled seeds
   * disabled. Threaded into the resource, the discovery call and the call-time
   * gate so all three agree. Rebuilt alongside {@link mutatesLookup}; empty when no
   * registered tool declares a parent, in which case the governance cascade is
   * byte-for-byte the one without the inherited-disable step (Rule #19).
   */
  private parentKeys: ParentKeys = new Map();

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

  /**
   * Parsed `IRIS_TOOLS_PRESET`/`IRIS_TOOLS_DISABLE`/`IRIS_TOOLS_ENABLE`
   * configuration (Epic 30, architecture decision I1), parsed once in the
   * constructor (see the asymmetry note there, ~L459). Defaults to the
   * byte-for-byte pass-through state (`preset: "full"`, no disable/enable)
   * so {@link isToolVisible} is safe even if ever read before the
   * constructor's own parse runs (mirrors the other governance fields'
   * safe-default discipline).
   */
  private toolVisibilityConfig: ToolVisibilityConfig = {
    preset: "full",
    disable: [],
    enable: [],
  };

  /**
   * Resolved visibility summary (Epic 30), computed once at construction.
   * Feeds the startup log line AND (Story 30.2, AC 30.2.1) the
   * `toolVisibility` block on `iris_server_profiles`'s discovery result —
   * threaded verbatim into {@link computeServerDiscovery} at the discovery
   * short-circuit in `handleToolCall`. COUNTS ONLY; never expose the
   * underlying tool names from this field (see {@link hiddenToolNames}).
   */
  private toolVisibility: {
    preset: ToolPresetName;
    visibleCount: number;
    hiddenCount: number;
  } = { preset: "full", visibleCount: 0, hiddenCount: 0 };

  /**
   * Hidden-tool NAME set (Epic 30, AC 30.2.2), computed once at construction
   * alongside {@link toolVisibility} (`options.tools` minus the resolved
   * visible set). PRIVATE ONLY — used exclusively to filter this server's
   * advisory governance views via {@link visibleGovernedKeys}, so a hidden
   * tool's governance keys (including its surviving BASELINE keys — see
   * {@link rebuildGovernedKeys}'s union with `GOVERNANCE_BASELINE`) never
   * appear in the discovery report or the `iris-governance://` resource.
   * NEVER surfaced directly: AC 30.2.1's `toolVisibility` block discloses
   * hidden tool COUNTS only, never names.
   */
  private hiddenToolNames: Set<string> = new Set();

  /** Page size for tools/list pagination. */
  readonly pageSize: number = DEFAULT_PAGE_SIZE;

  constructor(private readonly options: McpServerBaseOptions) {
    if (options.config) {
      this.config = options.config;
    }

    // ── Tool visibility filter (Epic 30, architecture decisions I1/I2) ──
    //
    // Parsed HERE, in the constructor — NOT in start() — because tool
    // registration is itself constructor-time. This is a deliberate
    // ASYMMETRY with `IRIS_GOVERNANCE`/`IRIS_GOVERNANCE_PRESET`, which are
    // parsed in start() (governance is a CALL-TIME gate that can wait until
    // the profile registry exists there). A constructor throw here — an
    // unknown preset, a bare "*" wildcard, or a literal disable of the
    // reserved discovery tool — is still a clean startup crash, the same
    // operator UX as every other fail-fast path in this class.
    this.toolVisibilityConfig = parseToolVisibilityConfig();
    // Rot-proofing (Rule #53): a package's preset rosters must declare an
    // explicit include/exclude disposition for EVERY one of its tools. A
    // no-op when options.toolPresets is absent (Story 30.1 wires the first
    // rosters; until then every named preset behaves like "full").
    assertPresetCoverage(
      options.toolPresets,
      options.tools.map((tool) => tool.name),
    );
    const toolVisibilityResolution = resolveVisibleTools({
      toolNames: options.tools.map((tool) => tool.name),
      config: this.toolVisibilityConfig,
      rosters: options.toolPresets,
      reservedName: SERVER_DISCOVERY_TOOL_NAME,
    });
    for (const warning of toolVisibilityResolution.warnings) {
      logger.warn(`Tool visibility: ${warning}`);
    }
    const visiblePackageToolCount = options.tools.filter((tool) =>
      toolVisibilityResolution.visible.has(tool.name),
    ).length;
    this.toolVisibility = {
      preset: this.toolVisibilityConfig.preset,
      // AC 30.2.1: the reserved iris_server_profiles tool is ALWAYS visible
      // (registered outside options.tools) and is counted as visible here —
      // visibleCount + hiddenCount sums to options.tools.length + 1, matching
      // the real advertised tools/list count.
      visibleCount: visiblePackageToolCount + 1,
      hiddenCount: options.tools.length - visiblePackageToolCount,
    };
    // Hidden-tool NAME set (AC 30.2.2) — private, feeds visibleGovernedKeys()
    // only; never surfaced (see the field doc).
    this.hiddenToolNames = new Set(
      options.tools
        .map((tool) => tool.name)
        .filter((name) => !toolVisibilityResolution.visible.has(name)),
    );
    // Spec §2.2 (deferred item 30-0-4, burned down in Story 32.3): a config
    // that hides EVERY package tool leaves the server with only the reserved
    // discovery tool — almost certainly a misconfiguration — so startup says
    // so loudly. Distinct from the per-entry warnings above: those flag
    // individual suspect entries; this flags the aggregate outcome.
    if (options.tools.length > 0 && visiblePackageToolCount === 0) {
      logger.warn(
        `Tool visibility: the active config hides EVERY one of this server's ` +
          `${options.tools.length} package tool(s); only the reserved ` +
          `${SERVER_DISCOVERY_TOOL_NAME} discovery tool remains visible. ` +
          `If this is unintended, review IRIS_TOOLS_PRESET / IRIS_TOOLS_DISABLE / IRIS_TOOLS_ENABLE.`,
      );
    }
    logger.info(
      `Tool visibility: preset="${this.toolVisibility.preset}" ` +
        `visible=${this.toolVisibility.visibleCount} hidden=${this.toolVisibility.hiddenCount}` +
        (toolVisibilityResolution.warnings.length > 0
          ? ` warnings=${toolVisibilityResolution.warnings.length}`
          : ""),
    );

    // Register all initial tools — filtered to the visible subset (Epic 30).
    // A hidden tool never reaches registerTool: it is absent from the SDK
    // registry, from tools/list, and uncallable (the standard unknown-tool
    // result of the framework's tools/call). The governance rebuilds below
    // (rebuildMutatesLookup/rebuildGovernedKeys/assertGovernanceClassified)
    // read the live `this.tools` registry, which — because of this filter —
    // never contains a hidden tool's key: a hidden tool is invisible to
    // governance key derivation too (spec §2.3 step 3), by construction.
    for (const tool of options.tools) {
      if (toolVisibilityResolution.visible.has(tool.name)) {
        this.registerTool(tool);
      }
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

    // Record the advisory governance resource (D6): a static default-policy
    // resource + a per-profile template. Recorded at construction (like tools)
    // so the instance builder registers them before any transport connects. The
    // read callbacks close over `this`, so they read the governance config /
    // governed-key set as they are AT READ TIME, by which point start() has
    // parsed IRIS_GOVERNANCE.
    this.registerGovernanceResource();

    // Record prompts (Story 25.0, framework plumbing for the Agent Skills
    // Pack). Kept after tool/discovery registration and the governance
    // resource wiring because prompts are independent of the governance
    // machinery: they carry no `mutates` classification and must not perturb
    // the governed-key rebuilds above.
    //
    // CRITICAL back-compat (AC 25.0.1): `prompts` is deliberately NOT
    // pre-declared in the builder's `capabilities` object (unlike
    // `resources`, which IS pre-declared per D6). The MCP SDK's own
    // `registerPrompt` → `registerCapabilities({ prompts: { listChanged: true } })`
    // call is what advertises the capability, and it runs ONLY when
    // `registerPrompt` is actually called. So when `options.prompts` is
    // empty/absent, the builder never calls it, and the `prompts` key never
    // appears in the advertised `initialize` capabilities — a no-prompts
    // server is byte-for-byte unchanged (Rule #19).
    for (const prompt of options.prompts ?? []) {
      this.registerPrompt(prompt);
    }

    // Every SDK registration happens in the builder, so the instance built here and every instance built
    // later are complete by construction.
    this.mcpServer = this.buildMcpServer();
  }

  /**
   * Build one complete SDK instance from framework state: every tool in {@link tools} in insertion order, both
   * governance resources, every prompt in registration order, and the framework's own handlers last. The only
   * place SDK registration of the construction-time surface happens. {@link sdkTools} holds the handles of the
   * instance this returns.
   *
   * The framework's own handlers come last because the SDK installs its own handlers when the first tool,
   * resource or prompt is registered, and these replace them.
   */
  private buildMcpServer(): McpServer {
    const server = new McpServer(
      { name: this.options.name, version: this.options.version },
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
        // The SDK announces a change each time a tool is registered or removed; a call that changes
        // several tools in one turn (addTools, removeTools) announces it once.
        debouncedNotificationMethods: ["notifications/tools/list_changed"],
        // Multi-round-trip serving (AD-34), every knob explicit: on the 2025 era the SDK's shim puts the
        // confirmation dialog to the client and re-enters the handler with the answer. The SDK is given no
        // `requestState` hook: the confirmation verifies its own state in confirmOnWire.
        inputRequired: { legacyShim: true, maxRounds: 8, roundTimeoutMs: 600000 },
      },
    );
    // A dialog that is still unanswered when the connection ends gets its audit entry.
    server.server.onclose = () => this.flushPendingAsks();
    const handles = new Map<string, RegisteredTool>();
    for (const tool of this.tools.values()) {
      handles.set(tool.name, this.registerToolOn(server, tool));
    }
    for (const reader of this.resourceReaders) {
      this.registerResourceOn(server, reader);
    }
    for (const entry of this.promptRegistrations) {
      this.registerPromptOn(server, entry);
    }
    this.installWireHandlers(server);
    this.sdkTools = handles;
    return server;
  }

  /**
   * The factory the stdio entry calls for each instance it serves. The first call returns the instance built at
   * construction, so a caller that reads {@link server} sees the instance that serves; a later call (the stdio
   * entry rebuilds when a `server/discover` probe is followed by a 2025-era `initialize`) builds a fresh,
   * complete instance and makes it current. Each call writes one INFO line naming the era.
   */
  private readonly serverFactory: McpServerFactory = (context: McpRequestContext): McpServer => {
    logger.info(
      context.era === "modern"
        ? "Serving MCP protocol revision 2026-07-28 (server/discover)"
        : "Serving the 2025-era MCP handshake (initialize)",
    );
    if (!this.constructionInstanceHandedOut) {
      this.constructionInstanceHandedOut = true;
      return this.mcpServer;
    }
    this.mcpServer = this.buildMcpServer();
    return this.mcpServer;
  };

  /**
   * Serve `tools/list`, `tools/call`, `prompts/get` and `resources/read` on `server` from the framework's own
   * state, so the 2025-11-25 wire stays byte-identical (AD-15, AD-32). `prompts/get` is installed only when a
   * prompt is registered, because the SDK advertises the `prompts` capability only then.
   *
   * The handlers read {@link tools}, {@link promptEntries} and {@link resourceReaders} at request time, so a
   * tool added or removed later is served without reinstalling anything.
   */
  private installWireHandlers(server: McpServer): void {
    const sdkServer = server.server;
    sdkServer.setRequestHandler("tools/list", () => ({
      tools: [...this.tools.values()].map((tool) => this.listedToolOf(tool)),
    }));
    sdkServer.setRequestHandler("tools/call", (request, ctx) =>
      this.callToolFromWire(request.params, { instance: server, ctx }),
    );
    sdkServer.setRequestHandler("resources/read", (request) => this.readResourceFromWire(request.params.uri));
    if (this.promptEntries.size > 0) {
      sdkServer.setRequestHandler("prompts/get", (request) => this.getPromptFromWire(request.params));
    }
  }

  /** The `tools/list` entry of a registered tool, built once. */
  private listedToolOf(tool: ToolDefinition): ListedTool {
    const cached = this.listedTools.get(tool.name);
    if (cached) return cached;
    const extended = this.extendedSchemas.get(tool.name);
    if (!extended) {
      throw new Error(`Tool "${tool.name}" is not fully registered (missing extended schema).`);
    }
    const entry = listedTool(tool, extended);
    this.listedTools.set(tool.name, entry);
    return entry;
  }

  /**
   * A `tools/call` request off the wire. A name that is not registered, or is hidden, gets the in-band error
   * result for an unknown tool and nothing is audited (so a hidden name is never disclosed). Otherwise the
   * call runs through {@link handleToolCall} as a wire call, and a declared `outputSchema` is checked on
   * the way out. Anything that throws becomes an in-band error result.
   */
  private async callToolFromWire(
    params: {
      name: string;
      arguments?: Record<string, unknown> | undefined;
    },
    origin: { instance: McpServer; ctx: ServerContext },
  ): Promise<CallToolResult | InputRequiredResult> {
    const tool = this.tools.get(params.name);
    if (!tool) {
      return toolErrorResult(
        v1ProtocolErrorText(ProtocolErrorCode.InvalidParams, `Tool ${params.name} not found`),
      );
    }
    try {
      const result = await this.handleToolCall(tool, params.arguments, "wire", { ...origin });
      // A question for the client is not a tool result, so the declared output schema does not apply to it.
      if (isInputRequiredResult(result)) return result;
      const outputProblem = checkWireOutput(tool.name, tool, result);
      return outputProblem === undefined ? result : toolErrorResult(outputProblem);
    } catch (error: unknown) {
      return toolErrorResult(error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * A `prompts/get` request off the wire. `arguments` omitted counts as `{}`. A prompt that declares
   * arguments has them checked against its schema; a prompt that declares none ignores them.
   */
  private getPromptFromWire(params: {
    name: string;
    arguments?: Record<string, string> | undefined;
  }): GetPromptResult {
    const entry = this.promptEntries.get(params.name);
    if (!entry) {
      throw protocolError(ProtocolErrorCode.InvalidParams, `Prompt ${params.name} not found`);
    }
    if (entry.argsSchema === undefined) return entry.render({});
    const parsed = entry.argsSchema.safeParse(params.arguments ?? {});
    if (!parsed.success) {
      throw protocolError(
        ProtocolErrorCode.InvalidParams,
        `Invalid arguments for prompt ${params.name}: ${parsed.error.message}`,
      );
    }
    return entry.render(parsed.data as Record<string, string | undefined>);
  }

  /**
   * A `resources/read` request off the wire. An exact URI wins over a template, and the first template whose
   * pattern matches serves the rest.
   */
  private readResourceFromWire(rawUri: string): ReadResourceResult {
    const uri = new URL(rawUri);
    const text = uri.toString();
    for (const reader of this.resourceReaders) {
      if (reader.kind === "exact" && reader.uri === text) return reader.read(uri);
    }
    for (const reader of this.resourceReaders) {
      if (reader.kind !== "template") continue;
      const variables = reader.template.uriTemplate.match(text);
      if (variables) return reader.read(uri, variables);
    }
    throw protocolError(ProtocolErrorCode.InvalidParams, `Resource ${uri} not found`);
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
    // Rebuild the child-to-parent key map (AD-6) the same way. It fails fast on a
    // malformed `parent` declaration; whether the parent exists is checked in
    // assertGovernanceClassified, once the key universe is rebuilt.
    this.parentKeys = buildParentKeys(this.tools.values());
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
   * {@link governedKeys} filtered to drop every key belonging to a HIDDEN
   * tool (Epic 30, AC 30.2.2) — including a hidden tool's surviving BASELINE
   * (frozen) key, which `rebuildGovernedKeys`'s union with
   * `GOVERNANCE_BASELINE` keeps in {@link governedKeys} even though the
   * hidden tool itself was never registered. A key's "tool component" is the
   * substring before its first `:` (tool names never contain `:`, so a
   * bare-name key like `iris_doc_get` is its own tool component).
   *
   * This is the SINGLE shared filter consumed by BOTH advisory governance
   * surfaces — the discovery tool's `governance.policy`/`policies`
   * (via {@link computeServerDiscovery}, at the `handleToolCall` discovery
   * short-circuit) and the `iris-governance://{profile}` resource
   * ({@link buildGovernancePolicyResult}) — so the two cannot drift (mirrors
   * the existing shared {@link getEffectivePolicy} non-drift discipline).
   *
   * Report-only: `IRIS_GOVERNANCE` parsing/validation is UNCHANGED — a key
   * naming a hidden tool remains legal and inert in {@link governanceConfig};
   * only this REPORTED view omits it, so the agent's governance picture never
   * references a tool it cannot see.
   */
  private visibleGovernedKeys(): Set<string> {
    if (this.hiddenToolNames.size === 0) return this.governedKeys;
    const filtered = new Set<string>();
    for (const key of this.governedKeys) {
      const colonIndex = key.indexOf(":");
      const toolComponent =
        colonIndex === -1 ? key : key.slice(0, colonIndex);
      if (!this.hiddenToolNames.has(toolComponent)) {
        filtered.add(key);
      }
    }
    return filtered;
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
    // A `parent` must name a baseline key or a registered key (Story 38.4).
    assertParentKeysKnown(this.parentKeys, this.governedKeys);
    // A `dataPolicy` declaration must match its tool's actions and inputs (Story 39.2). A hidden
    // tool is checked too, so a bad declaration cannot wait for a preset change to surface.
    assertDataPolicyDeclarations([...this.options.tools, ...this.tools.values()]);
  }

  // ── Advisory governance resource (D6) ──────────────────────────────

  /**
   * Compute the effective governance policy for a profile as a JSON-serialized
   * {@link ReadResourceResult} (architecture decision D6). Shared by the static
   * default resource and the per-profile template read callbacks.
   *
   * Resolves the profile name against the registry FIRST so an unknown profile
   * surfaces a structured protocol error (mapped from {@link ProfileResolutionError})
   * rather than silently returning a default-shaped map or crashing the server.
   * The default profile always resolves (it is reserved), so the static
   * `iris-governance://default` resource never errors on resolution.
   *
   * @param profileName - The profile whose effective policy to report.
   * @param uri         - The resource URI (echoed into the result `contents`).
   * @throws {ProtocolError} (InvalidParams) when `profileName` is not a registered profile.
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
          throw protocolError(ProtocolErrorCode.InvalidParams, error.message);
        }
        throw error;
      }
    } else if (profileName !== DEFAULT_PROFILE_NAME) {
      throw protocolError(
        ProtocolErrorCode.InvalidParams,
        `Unknown server profile "${profileName}". The server is not yet initialised; only "${DEFAULT_PROFILE_NAME}" is available.`,
      );
    }

    const policy = getEffectivePolicy(
      profileName,
      this.governanceConfig,
      // AC 30.2.2: filtered so a hidden tool's key (incl. its surviving
      // baseline key) never appears in the resource's reported policy.
      this.visibleGovernedKeys(),
      this.mutatesLookup,
      GOVERNANCE_BASELINE,
      this.defaultEnabledWrites,
      this.preset,
      BASELINE_ACTION_CLASSIFICATIONS,
      this.governanceFileConfig,
      this.parentKeys,
    );

    // Story 32.0 (AC 32.0.3): report which channel resolved each key
    // (`env` | `file` | `parent` | `preset` | `default`) alongside the policy map -
    // emitted unconditionally (with no file set, keys report
    // env/preset/default). Built over the SAME visibleGovernedKeys() filter,
    // so the source map inherits the hidden-tool key omission structurally
    // (no hidden tool name can leak through `configSource`).
    const configSource = getEffectiveConfigSources(
      profileName,
      this.governanceConfig,
      this.visibleGovernedKeys(),
      this.mutatesLookup,
      this.preset,
      BASELINE_ACTION_CLASSIFICATIONS,
      this.governanceFileConfig,
      this.parentKeys,
    );

    return {
      contents: [
        {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ policy, configSource }),
        },
      ],
    };
  }

  /**
   * Record the advisory governance resource (architecture decision D6: the
   * minimal, single-resource-type provider; NOT a generalized ResourceDefinition
   * framework, which is deferred until a second resource exists). Two pieces:
   *
   * - A STATIC resource `iris-governance://default` for the default/global
   *   policy, so `resources/list` advertises a concrete entry.
   * - A `ResourceTemplate` `iris-governance://{profile}` for any profile, serving
   *   `resources/read` and listed under `resources/templates/list`. Its `list`
   *   callback enumerates the configured profiles.
   *
   * Both go into {@link resourceReaders}. The instance builder registers them on
   * each SDK instance ({@link registerResourceOn}), which auto-wires the SDK's
   * `resources/list` and `resources/templates/list` handlers and (re)advertises
   * the `resources` capability (already declared by the builder).
   * `resources/read` is served by {@link readResourceFromWire} from the same
   * read callbacks.
   */
  private registerGovernanceResource(): void {
    // Static default/global policy resource → resources/list.
    const readDefault = (uri: URL): ReadResourceResult =>
      this.buildGovernancePolicyResult(DEFAULT_PROFILE_NAME, uri.toString());
    this.resourceReaders.push({
      kind: "exact",
      name: GOVERNANCE_DEFAULT_RESOURCE_NAME,
      info: {
        title: "IRIS governance policy (default profile)",
        description:
          "Advisory: the effective enabled/disabled action map for the default " +
          "server profile. The call-time enforcement gate is authoritative; this " +
          "resource is a read-only preview.",
        mimeType: "application/json",
      },
      uri: GOVERNANCE_DEFAULT_URI,
      read: readDefault,
    });

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
    const profileTemplate = new ResourceTemplate(GOVERNANCE_TEMPLATE_URI, {
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
    });
    const readProfile = (uri: URL, variables: Variables): ReadResourceResult => {
      // The URI template binds {profile}; it may surface as string | string[].
      const raw = variables.profile;
      const profileName = Array.isArray(raw) ? String(raw[0]) : String(raw);
      return this.buildGovernancePolicyResult(profileName, uri.toString());
    };
    this.resourceReaders.push({
      kind: "template",
      name: GOVERNANCE_TEMPLATE_RESOURCE_NAME,
      info: {
        title: "IRIS governance policy (per profile)",
        description:
          "Advisory: the effective enabled/disabled action map for a named " +
          "server profile (iris-governance://<profile>). The call-time " +
          "enforcement gate is authoritative; this resource is a read-only preview.",
        mimeType: "application/json",
      },
      template: profileTemplate,
      read: readProfile,
    });
  }

  /** Register a recorded resource on one SDK instance. */
  private registerResourceOn(server: McpServer, reader: ResourceReader): void {
    if (reader.kind === "exact") {
      server.registerResource(reader.name, reader.uri, reader.info, reader.read);
    } else {
      server.registerResource(reader.name, reader.template, reader.info, reader.read);
    }
  }

  // ── Prompt registration (Story 25.0) ───────────────────────────────

  /**
   * Record a single prompt (Story 25.0, spec `03-skills-prompts-pack.md` section 2) for the framework's own
   * `prompts/get` ({@link getPromptFromWire}) and for the instance builder, which registers it on each SDK
   * instance ({@link registerPromptOn}).
   *
   * For a prompt WITH arguments, builds `z.object(argsShape)` from
   * {@link PromptDefinition.arguments}: each argument becomes
   * `z.string().describe(description)`, wrapped in `.optional()` when not
   * required, and it is passed as `argsSchema`, so the SDK advertises the
   * arguments in `prompts/list`. The same schema checks them on `prompts/get`.
   *
   * For a prompt with NO arguments, passes **no** `argsSchema` on purpose:
   * `prompts/list` then carries no `arguments` entry for it, and `prompts/get`
   * renders it whatever `arguments` the request holds.
   *
   * The render function turns `def.build(args)` into a single **user**-role
   * text message (spec section 2). A duplicate prompt name is caught by the SDK's own
   * `Prompt ${name} is already registered` guard when the builder registers it.
   */
  private registerPrompt(def: PromptDefinition): void {
    // Shared render: a single user-role text message (spec §2) from the
    // (SDK-validated) args. An optional argument the client omits is ABSENT
    // from `args` (value `undefined`), so the parameter type is
    // `Record<string, string | undefined>` — matching {@link PromptDefinition.build}
    // and forcing prompt authors (Story 25.1) to handle omitted optionals.
    //
    // CR 25.0-4 (resolved Story 26.4): `def.build(...)` is project-authored
    // (Story 25.1) but not immune to a future bug (e.g. dereferencing an
    // unexpected shape); a throw here used to surface to the client as an
    // opaque JSON-RPC `-32603 InternalError` with the raw message, unlike the
    // tool path's structured `isError` containment. Wrap it and rethrow as a
    // clean, prompt-named protocol error so a render bug is diagnosable without
    // leaking implementation detail differently than the rest of the framework.
    const render = (
      args: Record<string, string | undefined>,
    ): GetPromptResult => {
      let text: string;
      try {
        text = def.build(args);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw protocolError(
          ProtocolErrorCode.InternalError,
          `Prompt '${def.name}' failed to render: ${message}`,
        );
      }
      return {
        messages: [
          {
            role: "user" as const,
            content: { type: "text" as const, text },
          },
        ],
      };
    };

    // No-argument prompt: no argsSchema (see the doc comment above), and it
    // renders with an empty args object.
    if (def.arguments.length === 0) {
      this.recordPrompt({ name: def.name, title: def.title, description: def.description, render, argsSchema: undefined });
      return;
    }

    const argsShape: Record<string, z.ZodTypeAny> = {};
    for (const arg of def.arguments) {
      // CR 25.0-5 (resolved Story 26.4): fail fast on a duplicate argument
      // name within one PromptDefinition. Without this guard,
      // `argsShape[arg.name] = ...` silently last-wins — `prompts/list`
      // advertises only one entry and the other's `required`/`description`
      // is lost with no error, an author-side content mistake that would
      // otherwise ship silently.
      if (Object.prototype.hasOwnProperty.call(argsShape, arg.name)) {
        throw new Error(
          `Prompt '${def.name}' declares argument '${arg.name}' more than once — ` +
            `duplicate PromptDefinition.arguments entries are not allowed.`,
        );
      }
      // Order matters: `.describe()` must be the OUTERMOST call. Zod v4's
      // `.optional()` returns a NEW wrapper schema whose own `.description`
      // is empty even when the inner schema was `.describe()`d first, and the
      // description `prompts/list` advertises is the one on the schema the
      // object holds for that argument.
      const base: z.ZodTypeAny = arg.required ? z.string() : z.string().optional();
      argsShape[arg.name] = base.describe(arg.description);
    }

    // An omitted `arguments` counts as `{}` on `prompts/get`, so a prompt whose
    // arguments are all optional renders from it (see getPromptFromWire).
    const argsSchema = z.object(argsShape);
    this.recordPrompt({ name: def.name, title: def.title, description: def.description, render, argsSchema });
  }

  /** Keep a prompt for the framework's `prompts/get` (by name) and for the builder (in registration order). */
  private recordPrompt(entry: PromptEntry): void {
    this.promptEntries.set(entry.name, entry);
    this.promptRegistrations.push(entry);
  }

  /** Register a recorded prompt on one SDK instance. */
  private registerPromptOn(server: McpServer, entry: PromptEntry): void {
    if (entry.argsSchema === undefined) {
      server.registerPrompt(
        entry.name,
        { title: entry.title, description: entry.description },
        (): GetPromptResult => entry.render({}),
      );
      return;
    }
    server.registerPrompt(
      entry.name,
      {
        title: entry.title,
        description: entry.description,
        argsSchema: entry.argsSchema,
      },
      // The SDK's callback argument type from a Record<string, ZodTypeAny>
      // shape resolves to a loosely-typed record; `any` here mirrors the
      // `registerTool` callback pattern below.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (args: any): GetPromptResult => entry.render(args as Record<string, string | undefined>),
    );
  }

  // ── Tool registration ──────────────────────────────────────────────

  /**
   * Record a single tool in the framework's registry.
   *
   * Builds the extended input schema (a Zod object) that the SDK registration
   * ({@link registerToolOn}) advertises and that {@link handleToolCall} validates
   * against. Throws, with the SDK's own text, when the name is already registered.
   */
  private registerTool(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool ${tool.name} is already registered`);
    }

    // Centrally inject the framework `server` parameter into the tool's input
    // schema (architecture decision D2). The EXTENDED schema is what we advertise
    // and what handleToolCall validates against; it is stored so the two stay in
    // lock-step. Injecting here (once, for every tool) — rather than hand-adding
    // `server` per tool — gives uniform coverage and makes future tools inherit
    // it for free. outputSchema is untouched (additive, back-compat). It runs
    // before the registry is touched, so a tool that fails it is never recorded.
    const extendedInputSchema = withServerParam(tool.inputSchema, tool.name);
    this.tools.set(tool.name, tool);
    this.extendedSchemas.set(tool.name, extendedInputSchema);
    this.wireSchemas.set(tool.name, wireInputSchema(extendedInputSchema));
    this.listedTools.delete(tool.name);
  }

  /**
   * Register a recorded tool on one SDK instance.
   *
   * The SDK-registered callback is the in-process path to {@link handleToolCall}
   * (no wire request reaches it, because the framework serves `tools/call`
   * itself); the wire path validates the arguments first, in
   * {@link callToolFromWire}. Both validate independently to produce structured
   * error messages on failure.
   */
  private registerToolOn(server: McpServer, tool: ToolDefinition): RegisteredTool {
    const extendedInputSchema = this.extendedSchemas.get(tool.name);
    if (!extendedInputSchema) {
      throw new Error(`Tool "${tool.name}" is not fully registered (missing extended schema).`);
    }
    return server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: extendedInputSchema,
        ...(tool.outputSchema !== undefined && { outputSchema: tool.outputSchema }),
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
   * Handle a tool call (Epic 29, Story 29.0 — the audit interception point).
   *
   * This is a THIN wrapper around {@link dispatchToolCall}: when auditing is
   * OFF (`this.auditLogger` is `undefined`), it is a pure pass-through with no
   * extra allocation beyond the disabled-check — byte-for-byte today's
   * behavior (Rule #19 back-compat gate; AC 29.0.4). When auditing is ON, it
   * times the call, awaits the SAME single resolved {@link CallToolResult}
   * `dispatchToolCall` would have returned anyway, and records one audit
   * entry from it — every one of `dispatchToolCall`'s many return points
   * (Zod-fail, missing-schema, not-initialised, profile-resolution error,
   * governance denial, discovery short-circuit, client-establish failure,
   * handler success, handler throw) is captured uniformly this way, with zero
   * per-return-point changes. The audit write is enqueued (fire-and-forget)
   * and never awaited here — it must never slow or fail the tool call back to
   * the client (spec §5 ordering).
   *
   * `source` names the path in. A `"wire"` call comes from the framework's own
   * `tools/call` handler: the arguments are checked against the tool's wire
   * schema first, inside this wrapper (AD-3), so a schema-invalid call is
   * audited. A valid one continues with the PARSED arguments, which the audit
   * entry derives from; an invalid one returns the in-band error text without
   * running governance or the handler, and its entry carries the raw top-level
   * key names only, never `params`. The `"callback"` source is the
   * SDK-registered callback (in-process): the arguments go straight to
   * {@link dispatchToolCall}, whose own validation is step 1.
   *
   * A wire call also carries its {@link WireCall}: the request context of the round. Its abort signal reaches
   * the HTTP client of the call, and a call whose signal is aborted is audited `error` with
   * {@link CANCELLED_CALL_TEXT}. A call can take several rounds when it asks the person to confirm: a round
   * that asks returns the question and writes no entry, and the round that ends the call writes the one entry,
   * with the person's answer in `confirmation`. The in-process callback has no `wireCall`, so it never asks.
   */
  private async handleToolCall(
    tool: ToolDefinition,
    rawArgs: unknown,
    source?: "callback",
  ): Promise<CallToolResult>;
  private async handleToolCall(
    tool: ToolDefinition,
    rawArgs: unknown,
    source: "wire",
    wireCall?: WireCall,
  ): Promise<CallToolResult | InputRequiredResult>;
  private async handleToolCall(
    tool: ToolDefinition,
    rawArgs: unknown,
    source: ToolCallSource = "callback",
    wireCall?: WireCall,
  ): Promise<CallToolResult | InputRequiredResult> {
    const auditLogger = this.auditLogger;
    const start = auditLogger ? Date.now() : 0;
    let args = rawArgs;
    let result: CallToolResult | InputRequiredResult | undefined;
    if (source === "wire") {
      const wireSchema = this.wireSchemas.get(tool.name);
      if (wireSchema === undefined) {
        throw new Error(`Tool "${tool.name}" is not fully registered (missing wire schema).`);
      }
      const checked = checkWireInput(tool.name, wireSchema, rawArgs);
      if (checked.ok) args = checked.args;
      else result = toolErrorResult(checked.text);
    }
    const schemaInvalid = result !== undefined;
    result ??= await this.dispatchToolCall(tool, args, wireCall);
    // A call the client cancelled is audited `error`, never `ok`, whatever its handler went on to return. A
    // question it asked is never put to the client, so it ends here as that cancelled call, not as a pending ask.
    const cancelled = wireCall !== undefined && requestView(wireCall)?.signal?.aborted === true;
    if (cancelled && isInputRequiredResult(result)) result = toolErrorResult(CANCELLED_CALL_TEXT);
    // A question for the client ends no call: the round that ends it writes the entry (AD-19), and a dialog
    // nobody answers gets its entry from the pending-ask map.
    if (isInputRequiredResult(result)) {
      if (auditLogger && wireCall?.pendingNonce !== undefined) {
        this.recordPendingAsk(wireCall.pendingNonce, tool, args, start);
      }
      return result;
    }
    if (!auditLogger) return result;

    const durationMs = Date.now() - start;
    const audited = cancelled ? toolErrorResult(CANCELLED_CALL_TEXT) : result;
    // Fire-and-forget audit recording must NEVER throw into the tool path
    // (spec §5): the async file write is already swallowed inside the logger,
    // but the SYNCHRONOUS derivation + redaction walk + JSON serialization
    // here could in principle throw on a pathological args object (e.g. deep
    // nesting overflowing the recursive redact walk under
    // IRIS_AUDIT_LOG_PARAMS). Guard it so the tool result the client is owed
    // is returned regardless.
    try {
      this.recordAuditEntry(auditLogger, tool, args, audited, durationMs, schemaInvalid, wireCall?.confirmation);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`Audit entry recording failed; entry dropped: ${message}`);
    }
    return result;
  }

  /**
   * Validate arguments, build context, invoke handler. This is the body
   * {@link handleToolCall} used to be, before Story 29.0 renamed it to make
   * room for the audit-timing wrapper; its own logic (and every one of its
   * return points) is otherwise UNCHANGED.
   *
   * On Zod validation failure, returns a result with `isError: true`
   * containing the validation error details. The MCP SDK maps this to
   * the appropriate JSON-RPC error (-32602).
   */
  private async dispatchToolCall(
    tool: ToolDefinition,
    rawArgs: unknown,
    wireCall?: WireCall,
  ): Promise<CallToolResult | InputRequiredResult> {
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
    // today's behavior, byte-for-byte (Rule #19). Story 32.0: an unset
    // `IRIS_GOVERNANCE_FILE` leaves `this.governanceFileConfig === undefined`,
    // which the cascade treats as byte-for-byte its pre-Epic-32 behavior too
    // (AC 32.0.1).
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
        this.governanceFileConfig,
        this.parentKeys,
      )
    ) {
      // Disabled action (AC 14.4.2): structured denial. Human-readable text +
      // a machine-readable code in structuredContent; the handler is NEVER
      // invoked and the connection is NOT established.
      //
      // AC 24.1.4c: attribute WHY the call was denied. `presetApplied` is set
      // ONLY when the `presetSeed` layer (not an explicit override at ANY of
      // the four env/file explicit layers — Story 32.0) caused the denial —
      // an explicit `false` denial must NOT carry it, so operators can tell
      // the two apart. Story 38.4 (AD-6): a denial inherited from the key's
      // parent carries `inheritedFrom` instead, and never `presetApplied`.
      const explicitOverride = hasExplicitOverride(
        governanceKey,
        profile.name,
        this.governanceConfig,
        this.governanceFileConfig,
      );
      const inheritedFrom = explicitOverride
        ? undefined
        : inheritedParentDisable(
            governanceKey,
            profile.name,
            this.governanceConfig,
            this.parentKeys,
            this.governanceFileConfig,
          );
      const presetCaused =
        this.preset !== undefined &&
        !explicitOverride &&
        inheritedFrom === undefined &&
        presetSeed(
          governanceKey,
          this.preset,
          this.mutatesLookup,
          BASELINE_ACTION_CLASSIFICATIONS,
        ) === false;
      logger.warn(
        `Tool ${tool.name}: action "${governanceKey}" denied by governance policy for profile "${profile.name}"` +
          (presetCaused ? ` (preset "${this.preset}").` : ".") +
          (inheritedFrom !== undefined ? ` Inherited from "${inheritedFrom}".` : ""),
      );
      return refusalResult(
        REFUSAL_CODES.GOVERNANCE_DISABLED,
        `action '${governanceKey}' is disabled by governance policy for server '${profile.name}'` +
          (inheritedFrom !== undefined ? ` (inherited from '${inheritedFrom}')` : ""),
        {
          action: governanceKey,
          server: profile.name,
          ...(inheritedFrom !== undefined ? { inheritedFrom } : {}),
          ...(presetCaused ? { presetApplied: this.preset } : {}),
        },
      );
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
          // AC 30.2.2: filtered so a hidden tool's key never appears in the
          // discovery tool's reported policy (same helper the resource uses
          // — no drift).
          this.visibleGovernedKeys(),
          this.mutatesLookup,
          this.defaultEnabledWrites,
          this.preset,
          BASELINE_ACTION_CLASSIFICATIONS,
          this.toolVisibility,
          this.governanceFileConfig,
          this.parentKeys,
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
    // default profile normally returns its eagerly-established client +
    // version from start(); if that eager attempt found it unreachable (M1,
    // Epic 37 — non-fatal), start() dropped the client and this call takes
    // the SAME first-touch path a non-default profile always uses. Custom
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
    //
    // resolveProfileClient (Story 27.0, AC 27.0.1): a closure over THIS SAME
    // `getOrCreateClient` — the exact establishment path `client` above just
    // went through (health-check + Atelier-version negotiation + one-time
    // custom-REST bootstrap coalesced via the `establishing` in-flight map) —
    // reused for an ARBITRARY profile name a tool handler names at call time.
    // No separate/duplicated establishment logic (Rule #47): calling it with
    // the SAME name as `profile.name` just hits getOrCreateClient's existing
    // fast path and returns this identical cached `client`.
    const resolveProfileClientForCtx = async (
      targetProfileName: string,
    ): Promise<IrisHttpClient> => {
      const { client: resolvedClient } = await this.getOrCreateClient(
        targetProfileName,
        this.options.needsCustomRest ?? false,
      );
      return resolvedClient;
    };

    const baseCtx = buildToolContext(
      tool.scope,
      profile,
      client,
      atelierVersion,
      this.pageSize,
      resolveProfileClientForCtx,
      // Story 32.1 (32-0-1): the startup-snapshot file config, so a handler
      // whose governance check runs OUTSIDE the D5 gate (iris_env_promote's
      // Gate 4) reads the SAME frozen view as every other surface — never a
      // per-call file re-read (restart-only semantics, no hot-reload in v1).
      this.governanceFileConfig,
    );
    // A call off the wire gets the request's abort signal on its HTTP clients and the confirmation helper.
    const ctx =
      wireCall === undefined
        ? baseCtx
        : this.wireToolContext(baseCtx, tool, profile, parseResult.data, validatedArgs, wireCall);

    try {
      const result: ToolResult = await tool.handler(validatedArgs, ctx);
      // The handler asked for a confirmation: answer with the question, not with a tool result.
      if (result === CONFIRMATION_PENDING && wireCall?.pending !== undefined) return wireCall.pending;
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
      // A call the client cancelled has not failed: its audit entry says it was cancelled, and nothing is logged.
      if (wireCall === undefined || requestView(wireCall)?.signal?.aborted !== true) {
        logger.error(`Tool ${tool.name} failed: ${message}`);
      }
      return {
        content: [{ type: "text" as const, text: `Tool error: ${message}` }],
        isError: true,
      };
    }
  }

  // ── Wire call context and the confirmation dialog (AD-34, Story 43.3) ───

  /**
   * The context of a call off the wire: `base`, with the HTTP clients bound to the request's abort signal (so a
   * cancelled call aborts the IRIS request it has in flight and sends no further one) and the confirmation
   * helper. A request context without a signal leaves the clients as they are.
   */
  private wireToolContext(
    base: ToolContext,
    tool: ToolDefinition,
    profile: IrisProfile,
    parsedArgs: unknown,
    validatedArgs: Record<string, unknown>,
    wireCall: WireCall,
  ): ToolContext {
    const signal = requestView(wireCall)?.signal;
    const bind = (client: IrisHttpClient): IrisHttpClient =>
      signal === undefined ? client : bindSignal(client, signal);
    const actionKey = this.deriveAuditAction(tool, validatedArgs) ?? tool.name;
    const argsHash = (): string => contentHash({ tool: tool.name, profile: profile.name, args: parsedArgs });
    return {
      ...base,
      http: bind(base.http),
      resolveProfileClient: async (profileName: string) => bind(await base.resolveProfileClient(profileName)),
      confirm: (request) => this.confirmOnWire(tool, profile, actionKey, argsHash, request, wireCall),
    };
  }

  /**
   * The capabilities the calling client declared, read from the source of the era. On revision 2026-07-28 and
   * later that is the envelope of this request; before it, what the client declared at `initialize`. The
   * envelope is never read on a 2025-era connection, because a request's `_meta` can carry reserved keys there.
   */
  private clientCapabilitiesOf(wireCall: WireCall): unknown {
    const lowLevel = wireCall.instance.server;
    const version = lowLevel.getNegotiatedProtocolVersion();
    if (typeof version === "string" && version >= MODERN_PROTOCOL_VERSION) {
      const envelope = requestView(wireCall)?.envelope as Record<string, unknown> | undefined;
      return envelope?.[CLIENT_CAPABILITIES_META_KEY];
    }
    return lowLevel.getClientCapabilities();
  }

  /**
   * The state a retry echoed, when this process minted it for this very call: its MAC verifies, it has not
   * expired, and it was minted for this tool and these arguments. Anything else is no state.
   */
  private async echoedConfirmationState(
    tool: ToolDefinition,
    hash: string,
    wireCall: WireCall,
  ): Promise<ConfirmationState | undefined> {
    const raw = requestView(wireCall)?.requestState?.();
    if (typeof raw !== "string") return undefined;
    let state: unknown;
    try {
      state = await this.confirmationCodec.verify(raw, wireCall.ctx);
    } catch {
      return undefined;
    }
    return isConfirmationState(state) && state.tool === tool.name && state.hash === hash ? state : undefined;
  }

  /**
   * The helper behind {@link ToolContext.confirm} on a wire call. In order:
   *
   * 1. A retry that echoes a valid state of this call, whose nonce is unused, and carries an answer decides the
   *    call whatever its capabilities now say: the nonce is used, and an accept with `confirm: true` proceeds,
   *    while a decline, a dismissal and an unticked accept end the call with `CONFIRMATION_DECLINED`.
   * 2. A client that does not declare form elicitation is not asked: the call proceeds as it always did.
   * 3. A scope that resolves to `undefined` means there is nothing to ask: the call proceeds.
   * 4. Otherwise the question is minted: a state for this tool and these arguments, and a form request. The
   *    handler gets {@link CONFIRMATION_PENDING}, which {@link dispatchToolCall} swaps for the question.
   */
  private async confirmOnWire(
    tool: ToolDefinition,
    profile: IrisProfile,
    actionKey: string,
    argsHash: () => string,
    request: ConfirmationRequest,
    wireCall: WireCall,
  ): Promise<ConfirmationOutcome> {
    const hash = argsHash();
    const state = await this.echoedConfirmationState(tool, hash, wireCall);
    if (state !== undefined && !this.confirmationNonces.isUsed(state.nonce)) {
      const response = classifyConfirmationResponse(
        inputResponse(requestView(wireCall)?.inputResponses, CONFIRMATION_INPUT_KEY),
      );
      if (response !== "missing") {
        this.confirmationNonces.markUsed(state.nonce);
        this.pendingAsks.delete(state.nonce);
        wireCall.confirmation = auditConfirmationOf(response);
        if (response === "accepted") return { proceed: true };
        return {
          proceed: false,
          result: confirmationDeclinedResult(actionKey, request.operation, response),
        };
      }
      // A retry of this call with no answer: the call goes on below, asked again or not at all, so the ask it
      // echoes no longer ends as an entry of its own.
      this.pendingAsks.delete(state.nonce);
    }

    if (!declaresFormElicitation(this.clientCapabilitiesOf(wireCall))) return { proceed: true };

    const scope = typeof request.scope === "function" ? await request.scope() : request.scope;
    if (scope === undefined) return { proceed: true };

    const nonce = randomUUID();
    const requestState = await this.confirmationCodec.mint({ v: 1, tool: tool.name, hash, nonce });
    const message = confirmationMessage(
      { operation: request.operation, target: request.target, scope },
      { profile: profile.name, host: profile.host, port: profile.port },
    );
    wireCall.pending = inputRequired({
      inputRequests: {
        [CONFIRMATION_INPUT_KEY]: inputRequired.elicit({ message, requestedSchema: CONFIRMATION_SCHEMA }),
      },
      requestState,
    });
    wireCall.pendingNonce = nonce;
    return { proceed: false, result: CONFIRMATION_PENDING };
  }

  /** Remember a dialog put to the client, so it ends as one audit entry even when nobody answers. */
  private recordPendingAsk(nonce: string, tool: ToolDefinition, args: unknown, start: number): void {
    this.pendingAsks.set(nonce, {
      tool,
      args,
      start,
      expiresAt: Date.now() + CONFIRMATION_STATE_TTL_SECONDS * 1000,
    });
    this.schedulePendingSweep();
  }

  /** Arm the timer for the earliest expiry among the pending asks, unless it is armed or none is pending. */
  private schedulePendingSweep(): void {
    if (this.pendingAskTimer !== undefined || this.pendingAsks.size === 0) return;
    let earliest = Number.POSITIVE_INFINITY;
    for (const ask of this.pendingAsks.values()) earliest = Math.min(earliest, ask.expiresAt);
    this.pendingAskTimer = setTimeout(
      () => {
        this.pendingAskTimer = undefined;
        this.sweepPendingAsks(false);
        this.schedulePendingSweep();
      },
      Math.max(0, earliest - Date.now()),
    );
    this.pendingAskTimer.unref();
  }

  /**
   * Write the `unanswered` audit entry of each pending ask that has expired (or of every one, when `all`), and
   * forget it. Its nonce counts as used from then on, so an answer that arrives in the last second of the state's
   * life, which the codec counts in whole seconds, is asked again and never contradicts the entry. Never throws.
   */
  private sweepPendingAsks(all: boolean): void {
    const now = Date.now();
    for (const [nonce, ask] of this.pendingAsks) {
      if (!all && ask.expiresAt > now) continue;
      this.pendingAsks.delete(nonce);
      this.confirmationNonces.markUsed(nonce);
      const auditLogger = this.auditLogger;
      if (!auditLogger) continue;
      try {
        this.recordAuditEntry(
          auditLogger,
          ask.tool,
          ask.args,
          toolErrorResult(UNANSWERED_CONFIRMATION_TEXT),
          now - ask.start,
          false,
          "unanswered",
        );
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Audit entry recording failed; entry dropped: ${message}`);
      }
    }
  }

  /** End every pending ask now, as the connection ends or the server stops, and disarm the timer. */
  private flushPendingAsks(): void {
    if (this.pendingAskTimer !== undefined) {
      clearTimeout(this.pendingAskTimer);
      this.pendingAskTimer = undefined;
    }
    this.sweepPendingAsks(true);
  }

  // ── Audit entry derivation (Epic 29, Story 29.0) ────────────────────

  /**
   * Build and enqueue one audit entry from a resolved {@link dispatchToolCall}
   * result. Deliberately uses ONLY `rawArgs` (the pre-validation input passed
   * into {@link handleToolCall}) and the final {@link CallToolResult} — never
   * `dispatchToolCall`'s internal validated args, resolved profile object, or
   * governance key — so the SAME derivation applies uniformly no matter which
   * of `dispatchToolCall`'s many return points produced the result.
   *
   * Story 29.1 (AC 29.1.1) sharpens the `denied`/`error` fidelity here: a
   * `"denied"` outcome COPIES `denyReason` (`structuredContent.code`) and, when
   * present, `presetApplied` (`structuredContent.presetApplied`) straight from
   * the denial the client actually saw — never recomputed, so it can never
   * diverge from `dispatchToolCall`'s own `presetCaused` attribution
   * (`:~1194-1214`). An `"error"` outcome still carries only the sanitized
   * message text (never a stack/caret-global token). An `"ok"` outcome carries
   * neither field.
   *
   * `rawArgs` is the arguments of an in-process call or the PARSED arguments of
   * a valid wire call. For a schema-invalid wire call (`schemaInvalid`) it is
   * the raw `arguments` of the request: the entry lists the raw top-level key
   * names and carries neither `params` nor a `dataPolicy` summary, because the
   * values were refused before any policy ran and a refusal records no value
   * (AD-19).
   */
  private recordAuditEntry(
    auditLogger: AuditLogger,
    tool: ToolDefinition,
    rawArgs: unknown,
    result: CallToolResult,
    durationMs: number,
    schemaInvalid = false,
    confirmation?: AuditConfirmation,
  ): void {
    const argsRecord =
      rawArgs !== null && typeof rawArgs === "object"
        ? (rawArgs as Record<string, unknown>)
        : undefined;

    const profileName = this.deriveAuditProfileName(argsRecord);
    const outcome = this.deriveAuditOutcome(result);
    const resolvedProfile = this.profiles?.get(profileName);
    const profileSource = resolvedProfile?.source;
    const entryInput: AuditEntryInput = {
      tool: tool.name,
      action: this.deriveAuditAction(tool, argsRecord),
      profile: profileName,
      namespace: this.deriveAuditNamespace(argsRecord, profileName),
      outcome,
      durationMs,
      paramKeys: argsRecord
        ? Object.keys(argsRecord).filter((key) => key !== "server")
        : [],
    };
    if (!schemaInvalid) {
      entryInput.params = this.redactPhiInputs(tool, argsRecord, resolvedProfile);
      // Story 39.2 (AD-19): what the PHI data policy did over a governed call. Counts only; the
      // field never carries body content.
      const dataPolicy = this.deriveAuditDataPolicy(tool, argsRecord, resolvedProfile, result);
      if (dataPolicy !== undefined) entryInput.dataPolicy = dataPolicy;
    }
    // Story 31.3, AC 31.3.2: attribution ONLY — read straight from the
    // already-resolved profile's `source` field (same in-memory registry
    // lookup `deriveAuditNamespace` uses below), never fed into any
    // authorization decision.
    if (profileSource !== undefined) entryInput.profileSource = profileSource;
    if (outcome === "error") {
      const message = this.extractAuditErrorMessage(result);
      if (message !== undefined) entryInput.error = message;
    } else if (outcome === "denied") {
      const structured = result.structuredContent as
        | Record<string, unknown>
        | undefined;
      const denyReason = structured?.code;
      if (typeof denyReason === "string") entryInput.denyReason = denyReason;
      const presetApplied = structured?.presetApplied;
      if (typeof presetApplied === "string") {
        entryInput.presetApplied = presetApplied;
      }
    }
    // Story 43.3 (AD-19): the person's answer to the confirmation dialog, when the call was asked one.
    if (confirmation !== undefined) entryInput.confirmation = confirmation;
    auditLogger.log(entryInput);
  }

  /**
   * The audit `params` object: `argsRecord`, with the value of every input the tool declares in
   * `dataPolicy.phiInputs` replaced by `"[REDACTED]"` unless the call's profile resolved and its
   * policy is `allow`. The declaration decides, never the parameter's name. The input is not
   * mutated, and `paramKeys` still lists every key.
   */
  private redactPhiInputs(
    tool: ToolDefinition,
    argsRecord: Record<string, unknown> | undefined,
    profile: IrisProfile | undefined,
  ): Record<string, unknown> | undefined {
    const phiInputs = tool.dataPolicy?.phiInputs;
    if (argsRecord === undefined || phiInputs === undefined || phiInputs.length === 0) return argsRecord;
    if (profile !== undefined && effectiveDataPolicy(profile) === "allow") return argsRecord;
    const redacted: Record<string, unknown> = { ...argsRecord };
    for (const key of phiInputs) {
      if (Object.prototype.hasOwnProperty.call(redacted, key)) redacted[key] = "[REDACTED]";
    }
    return redacted;
  }

  /**
   * The `dataPolicy` audit field of a call, or `undefined` when it does not apply: the tool declares
   * no `dataPolicy`, or the call's action is not one it lists, or the profile did not resolve.
   * `policy` is the response's own `structuredContent.dataPolicy.policy` when that is a valid
   * policy, else the profile's effective policy; each count is the response's when it is a
   * non-negative integer, else 0.
   */
  private deriveAuditDataPolicy(
    tool: ToolDefinition,
    argsRecord: Record<string, unknown> | undefined,
    profile: IrisProfile | undefined,
    result: CallToolResult,
  ): DataPolicySummary | undefined {
    const declared = tool.dataPolicy;
    if (declared === undefined || profile === undefined) return undefined;
    if (declared.actions !== undefined) {
      const action = this.deriveAuditAction(tool, argsRecord);
      if (action === null || !declared.actions.includes(action)) return undefined;
    }
    const reported = (result.structuredContent as Record<string, unknown> | undefined)?.dataPolicy;
    const fields =
      reported !== null && typeof reported === "object" && !Array.isArray(reported)
        ? (reported as Record<string, unknown>)
        : {};
    const policy: DataPolicy = parseDataPolicyValue(fields.policy) ?? effectiveDataPolicy(profile);
    const count = (value: unknown): number =>
      typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;
    return { policy, redacted: count(fields.redacted), blocked: count(fields.blocked) };
  }

  /** `rawArgs.server` when present, else the reserved default profile name. */
  private deriveAuditProfileName(
    argsRecord: Record<string, unknown> | undefined,
  ): string {
    const value = argsRecord?.server;
    return typeof value === "string" && value.length > 0
      ? value
      : DEFAULT_PROFILE_NAME;
  }

  /**
   * `rawArgs.namespace` when present (per-call override), else the resolved
   * profile's default namespace read from the already-built, in-memory
   * profile registry. Basic derivation only (Dev Notes): never establishes a
   * connection just to learn a namespace — a denied call must not connect.
   */
  private deriveAuditNamespace(
    argsRecord: Record<string, unknown> | undefined,
    profileName: string,
  ): string {
    const override = argsRecord?.namespace;
    if (typeof override === "string" && override.length > 0) return override;
    return this.profiles?.get(profileName)?.namespace ?? "";
  }

  /**
   * `rawArgs.action` when — and ONLY when — the tool's input schema declares
   * an `action` field AND the raw value is an actual member of that field's
   * (unwrapped) enum options (Story 29.1, AC 29.1.2); `null` otherwise.
   *
   * Reuses {@link unwrapActionOptions} — the SAME enum-membership discipline
   * {@link computeGovernanceKey} applies (`:~965-979`) — so a tool with no
   * `action` field never over-reports a stray `action` key a caller happened
   * to pass, and a non-member value (e.g. a value Zod would itself reject)
   * likewise yields `null` rather than echoing an arbitrary string. Reads
   * `rawArgs` (pre-Zod) rather than `dispatchToolCall`'s validated args —
   * `server` aside, Zod does not rename `action`, so the schema check applies
   * identically to either shape.
   */
  private deriveAuditAction(
    tool: ToolDefinition,
    argsRecord: Record<string, unknown> | undefined,
  ): string | null {
    const value = argsRecord?.action;
    if (typeof value !== "string") return null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actionField = (tool.inputSchema as any)?.shape?.action;
    const options = unwrapActionOptions(actionField);
    if (Array.isArray(options) && options.length > 0 && options.includes(value)) {
      return value;
    }
    return null;
  }

  /**
   * Basic outcome derivation (Dev Notes "Scope seam"): `denied` when the
   * governance gate's structured code is present, `error` when the result is
   * flagged as an error, else `ok`.
   */
  private deriveAuditOutcome(result: CallToolResult): AuditOutcome {
    const structured = result.structuredContent as
      | Record<string, unknown>
      | undefined;
    if (structured?.code === REFUSAL_CODES.GOVERNANCE_DISABLED) return "denied";
    // A person refused before anything changed, which is what `denied` means for governance (AD-19).
    if (structured?.code === REFUSAL_CODES.CONFIRMATION_DECLINED) return "denied";
    if (result.isError) return "error";
    return "ok";
  }

  /** The result's first text content block, when present — the basic "sanitized message". */
  private extractAuditErrorMessage(result: CallToolResult): string | undefined {
    const first = result.content?.[0];
    if (first && first.type === "text" && typeof first.text === "string") {
      return first.text;
    }
    return undefined;
  }

  // ── Dynamic tool management (listChanged) ──────────────────────────

  /**
   * Decide whether a SINGLE tool name is visible under the server's already-
   * parsed {@link toolVisibilityConfig} (Epic 30) — the SAME resolution
   * {@link resolveVisibleTools} performs at construction, reused here so
   * {@link addTools} applies an IDENTICAL filter to a tool registered at
   * runtime (spec §2.3 step 5: a hidden tool added dynamically stays
   * hidden). The one-name call recomputes (and discards) warnings that were
   * already surfaced at startup — a negligible cost on this low-frequency
   * dynamic-add path — so the visibility DECISION has exactly one
   * implementation, never two.
   */
  private isToolVisible(name: string): boolean {
    return resolveVisibleTools({
      toolNames: [name],
      config: this.toolVisibilityConfig,
      rosters: this.options.toolPresets,
      reservedName: SERVER_DISCOVERY_TOOL_NAME,
    }).visible.has(name);
  }

  /**
   * Recompute the {@link toolVisibility} visible/hidden COUNTS (Epic 30, AC
   * 30.2.1) from live state after a dynamic {@link addTools}/{@link removeTools}
   * mutation. The construction-time counts drift the instant the advertised
   * tool set changes, so — matching the governance-state sync the dynamic paths
   * already perform ({@link rebuildMutatesLookup}/{@link rebuildGovernedKeys}) —
   * this keeps `iris_server_profiles`'s reported counts consistent with the real
   * `tools/list`. `preset` is immutable after construction (parsed once), so it
   * is preserved. `visibleCount` is the live registry size ({@link tools} — the
   * exact advertised set, INCLUDING the reserved discovery tool, so it equals
   * the construction formula `visiblePackageToolCount + 1`); `hiddenCount` is
   * the tracked hidden-name-set size ({@link hiddenToolNames}, maintained on
   * both dynamic paths).
   */
  private recomputeToolVisibilityCounts(): void {
    this.toolVisibility = {
      preset: this.toolVisibility.preset,
      visibleCount: this.tools.size,
      hiddenCount: this.hiddenToolNames.size,
    };
  }

  /**
   * Register additional tools at runtime and emit
   * `notifications/tools/list_changed`.
   *
   * Applies the SAME tool-visibility filter (Epic 30) as the constructor: a
   * tool hidden by `IRIS_TOOLS_PRESET`/`IRIS_TOOLS_DISABLE`/
   * `IRIS_TOOLS_ENABLE` is not registered even when added dynamically.
   *
   * Named-preset roster curation deliberately does NOT extend to dynamic
   * adds (RECORDED DECISION — deferred item 30-0-1, closed-by-decision in
   * Story 32.3): a dynamically-added name is in no package roster, so
   * `presetVisible` returns `undefined` and the documented resolution
   * cascade (`ENABLE > DISABLE > preset > default-visible`, spec §2.2)
   * leaves it visible. That is accepted because (1) this method has ZERO
   * production callers across the suite — it is a framework extension point
   * exercised by tests only (verified by grep 2026-07-26); (2)
   * `assertPresetCoverage` structurally forbids the real risk (a SHIPPED
   * roster naming a non-registered tool or missing a disposition); and (3)
   * defaulting unlisted dynamic adds to hidden would invent policy the
   * spec's cascade deliberately does not contain.
   */
  addTools(tools: ToolDefinition[]): void {
    // A `dataPolicy` declaration is checked for every added tool, hidden ones included: the registry
    // check in assertGovernanceClassified never sees a tool that config hides.
    assertDataPolicyDeclarations(tools);
    let registeredCount = 0;
    for (const tool of tools) {
      if (this.isToolVisible(tool.name)) {
        this.registerTool(tool);
        this.sdkTools.set(tool.name, this.registerToolOn(this.mcpServer, tool));
        registeredCount++;
      } else {
        // Track a dynamically-added-but-hidden tool (Epic 30, AC 30.2.2/30.2.1):
        // keeps both the `visibleGovernedKeys()` filter and the hidden COUNT
        // correct for tools hidden by config after construction.
        this.hiddenToolNames.add(tool.name);
      }
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
    // Keep the AC 30.2.1 visible/hidden counts in sync with the live tool set,
    // matching the governance-state sync above (Story 30.2 review).
    this.recomputeToolVisibilityCounts();
    this.mcpServer.sendToolListChanged();
    const hiddenCount = tools.length - registeredCount;
    logger.info(
      `Added ${registeredCount} tool(s) and notified clients` +
        (hiddenCount > 0
          ? ` (${hiddenCount} hidden by tool visibility config)`
          : ""),
    );
  }

  /**
   * Remove tools by name at runtime and emit
   * `notifications/tools/list_changed`.
   */
  removeTools(names: string[]): void {
    let removedCount = 0;
    let visibilityChanged = false;
    for (const name of names) {
      if (this.tools.delete(name)) {
        // Drop the schema and list-entry caches too, so they do not leak after removal.
        this.extendedSchemas.delete(name);
        this.wireSchemas.delete(name);
        this.listedTools.delete(name);
        // Remove from the SDK's registry through the handle `registerToolOn` returned, so the name can
        // be registered again. The SDK announces each removal; the debounce on the server (see
        // `buildMcpServer`) joins those announcements and the one below into a single notification.
        this.sdkTools.get(name)?.remove();
        this.sdkTools.delete(name);
        removedCount++;
        visibilityChanged = true;
      } else if (this.hiddenToolNames.delete(name)) {
        // Removing a tool this server offered but hid by config: it is no
        // longer part of this server's tool universe, so drop it from the
        // hidden COUNT (Epic 30, AC 30.2.1). No governance/listChanged work —
        // a hidden tool was never registered or advertised.
        visibilityChanged = true;
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
    if (visibilityChanged) {
      // Keep the AC 30.2.1 visible/hidden counts in sync with the live tool
      // set (Story 30.2 review), whether a visible tool was unregistered or a
      // hidden tool dropped from this server's universe.
      this.recomputeToolVisibilityCounts();
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
   * Start the MCP server and serve its stdio transport, in the 2025-11-25 era
   * or revision 2026-07-28 as the client's opening message chooses.
   *
   * Startup sequence:
   * 1. Load config + build the profile registry (if not provided)
   * 2. Eagerly create the default profile's {@link IrisHttpClient}
   * 3. Health check via `HEAD /api/atelier/`
   * 4. Negotiate Atelier API version
   * 5. Bootstrap custom REST service for the default profile (if needed)
   * 6. Serve the transport
   *
   * A call while stdio is already being served throws before it reads stdin.
   *
   * Non-default profiles (from `IRIS_PROFILES`) are NOT established here — they
   * are created lazily on first use via {@link getOrCreateClient} (architecture
   * decision D1/D8), so startup cost and behavior for single-server installs is
   * unchanged.
   *
   * **Default-profile reachability (architecture record M1, Epic 37):** step 3's
   * health check is a warm-up attempt, never a startup gate — a CONFIGURATION
   * error (missing credentials, malformed governance/audit settings) still fails
   * startup fast, but an unreachable `default` instance does not. When the
   * eager attempt fails, steps 4-5 and the `profileMeta` seed are skipped for
   * `default` this one time, the un-established client is dropped, and step 6
   * still runs — the server starts and serves every reachable profile. The
   * first subsequent call that targets `default` re-establishes it through the
   * same lazy {@link getOrCreateClient}/`establishProfile` path every
   * non-default profile already uses, recovering automatically with no
   * restart. See {@link getOrCreateClient} for that path.
   *
   * @param _transport - `"stdio"`, the only supported transport
   *   (`resolveTransport` rejects every other configured value). The
   *   parameter fixes the call shape `start(resolveTransport())`; the
   *   transport connected in the last startup step is always stdio.
   */
  async start(_transport: "stdio" = "stdio"): Promise<void> {
    this.assertNotServing();

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
        : await loadProfileRegistry();
    }
    this.clients = new ProfileClientRegistry(this.profiles);

    // Parse the governance policy centrally (architecture decisions D5/D7),
    // mirroring loadProfileRegistry(): read IRIS_GOVERNANCE once at startup.
    // parseGovernanceConfig fails fast (naming IRIS_GOVERNANCE) on malformed
    // input, so a misconfigured policy is caught at boot rather than mis-enforced
    // per call. Absent/empty IRIS_GOVERNANCE ⇒ `{}` ⇒ the enforcement gate is a
    // pure pass-through (every baseline action enabled — the back-compat gate).
    this.governanceConfig = parseGovernanceConfig();

    // Load the optional governance policy FILE (Epic 32, Story 32.0, AC
    // 32.0.1; architecture decision J1), mirroring the IRIS_GOVERNANCE parse
    // immediately above: read once at startup (no hot-reload in v1 — restart
    // semantics). Unset `IRIS_GOVERNANCE_FILE` ⇒ `undefined` with ZERO
    // filesystem access (the "off touches ZERO filesystem" guarantee); set ⇒
    // loadGovernanceFile fails fast (naming the var + the path) on a
    // missing/unreadable/malformed/invalid file — never silently permissive.
    // The file's layers sit strictly BELOW both env layers in the cascade
    // (AC 32.0.2), so a file introduced later can never override a
    // pre-existing IRIS_GOVERNANCE setting.
    this.governanceFileConfig = loadGovernanceFile();

    // Resolve every profile's PHI data policy (Story 39.2; AD-9, AD-26): the profile's
    // IRIS_PROFILES entry, then IRIS_DATA_POLICY, then the governance file's dataPolicy section, then
    // `redact`. A malformed IRIS_DATA_POLICY fails fast here, naming the variable. The registry holds
    // the resolved value of every profile from here on, so `ctx.config.dataPolicy` and the discovery
    // roster read the policy that applies.
    applyDataPolicies(this.profiles, parseOperatorDataPolicy(), this.governanceFileConfig);

    // A profile name under "profiles" that no configured profile carries only
    // warns (Story 38.7, DW-554): the parsers have no profile registry, and one
    // policy document may serve clients with different IRIS_PROFILES.
    //
    // A key inside a layer that names a tool this server registers (hidden tools
    // included: `this.options.tools` holds every package tool, `this.tools` the
    // visible ones plus the framework tool) but is none of that tool's keys also only
    // warns (Story 39.0, DW-565). A key whose tool this server does not register stays
    // silent: the same document serves the other servers, and a newer server may add
    // keys. `iris-mcp-governance check` reports keys no server of the suite has.
    const configuredProfiles = [...this.profiles.keys()];
    const governanceFileSource = `IRIS_GOVERNANCE_FILE (path: ${process.env.IRIS_GOVERNANCE_FILE})`;
    const registeredKeys = governanceKeysByTool([...this.options.tools, ...this.tools.values()]);
    for (const warning of [
      ...unknownProfileWarnings(this.governanceConfig, "IRIS_GOVERNANCE", configuredProfiles),
      ...unknownProfileWarnings(this.governanceFileConfig, governanceFileSource, configuredProfiles),
      ...unmatchedGovernanceKeys(this.governanceConfig, "IRIS_GOVERNANCE", registeredKeys, "server").map(
        (finding) => finding.message,
      ),
      ...unmatchedGovernanceKeys(this.governanceFileConfig, governanceFileSource, registeredKeys, "server").map(
        (finding) => finding.message,
      ),
    ]) {
      logger.warn(warning);
    }

    // Parse the governance safety preset (Story 24.1, spec 02 §2.2), mirroring
    // the IRIS_GOVERNANCE parse immediately above. parseGovernancePreset fails
    // fast (naming IRIS_GOVERNANCE_PRESET + the valid values) on an unrecognized
    // value, so a typo (e.g. "read_only") is caught at boot rather than silently
    // running full-access when the operator intended read-only. Absent/empty ⇒
    // `undefined` ⇒ the presetSeed layer is a pure pass-through (AC 24.1.1).
    this.preset = parseGovernancePreset();

    // Parse the audit-log configuration (Epic 29, spec `07-observability-
    // audit-log.md` §2), mirroring the governance parses immediately above.
    // Absent `IRIS_AUDIT_LOG` ⇒ `auditConfig` stays `undefined` ⇒
    // `this.auditLogger` stays `undefined` ⇒ handleToolCall is a pure
    // pass-through (Rule #19 back-compat gate; AC 29.0.4). A malformed
    // `IRIS_AUDIT_LOG_MAX_MB` fails fast, naming the var — mirrors the
    // `IRIS_SQL_MAX_ROWS` parse in config.ts.
    let auditConfig: AuditConfig | undefined;
    try {
      auditConfig = parseAuditConfig();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(`Audit log configuration error: ${message}`);
      process.exit(1);
      return; // Guard: prevent continued execution when process.exit is mocked
    }

    if (auditConfig) {
      // An operator who configured IRIS_AUDIT_LOG must not run unaudited
      // silently: fail fast at startup if the target file's directory is not
      // writable (spec §2), mirroring the health-check failure below.
      const auditDir = dirname(auditConfig.path);
      try {
        await access(auditDir, fsConstants.W_OK);
      } catch {
        logger.error(
          `IRIS_AUDIT_LOG directory is not writable: "${auditDir}". ` +
            `Set IRIS_AUDIT_LOG to a path whose directory this process can write to, or unset IRIS_AUDIT_LOG to disable auditing.`,
        );
        process.exit(1);
        return; // Guard: prevent continued execution when process.exit is mocked
      }
      this.auditLogger = new AuditLogger(
        auditConfig,
        this.options.name,
        this.options.version,
      );
    }

    // 2. Eagerly create the default profile's HTTP client (preserves today's
    //    bootstrap/health-check/negotiation for the default profile exactly
    //    on the success path).
    const defaultClient = this.clients.getOrCreate(DEFAULT_PROFILE_NAME);

    // 3. Health check (default profile). Architecture record M1 (Epic 37):
    //    a CONFIGURATION error still fails startup fast (the process.exit(1)
    //    calls above for audit config, and the loadConfig()/governance throws
    //    each entry point's `Fatal:` catch handles) — but an UNREACHABLE peer
    //    never does, the default profile included. On a health-check
    //    rejection: log it, log a continuation line, and drop the
    //    un-established client (the same disposal a non-default first-touch
    //    failure already gets — AC 14.2.8 symmetry) so the first call after
    //    startup re-establishes the profile through the exact same lazy path
    //    getOrCreateClient()/establishProfile() already use for every
    //    non-default profile (Rule #47 — no new establishment logic is added
    //    here). Negotiation, the startup bootstrap and the profileMeta seed
    //    are skipped for this request only; they run on that later first
    //    touch instead.
    let defaultEstablished = true;
    try {
      await checkHealth(defaultClient);
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      // `checkHealth` already prefixes the errors it wraps (the HTTP 401/403/404
      // path); a connection error it rethrows unwrapped carries no prefix.
      // Prefix only when missing so the line names the failure exactly once.
      const healthPrefix = "IRIS health check failed:";
      logger.error(
        message.startsWith(healthPrefix) ? message : `${healthPrefix} ${message}`,
      );
      // Name host:port on THIS line too (AC 37.1.4). `checkHealth` only carries
      // it on the NETWORK_ERROR/TIMEOUT variants; when the probe reached IRIS
      // and was refused (an IrisApiError for HTTP 401/403/404, which
      // checkHealth re-wraps as HEALTH_CHECK_FAILED) the message above names
      // neither host nor port — and after this story that startup log is the
      // ONLY diagnostic, because the process no longer exits.
      logger.error(
        `Continuing startup without the "${DEFAULT_PROFILE_NAME}" profile ` +
          `(${this.config.host}:${this.config.port}): tools targeting it will ` +
          `return a connection error until it is reachable, then recover automatically ` +
          `(no restart needed). If the cause is configuration rather than an outage ` +
          `(e.g. an HTTP 401/403/404 in the line above — wrong credentials, or the ` +
          `/api/atelier web application disabled), it will NOT clear on its own: fix ` +
          `the setting and restart.`,
      );
      this.clients.drop(DEFAULT_PROFILE_NAME);
      // Keep the "no metadata recorded for an unestablished default" invariant
      // true even when start() is re-entered after an earlier SUCCESSFUL start
      // (`clients` is rebuilt per start(), but `profileMeta` is readonly and
      // never cleared). Without this, the stale entry would send the next call
      // down getOrCreateClient's fast path and hand out a freshly constructed
      // client that was never health-checked, negotiated, or bootstrapped.
      // A no-op on a first start, where no entry exists yet.
      this.profileMeta.delete(DEFAULT_PROFILE_NAME);
      defaultEstablished = false;
    }

    if (defaultEstablished) {
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
    } else {
      // The default profile was not established: there is no negotiated
      // version to report (printing "Atelier API v1" here would be
      // misleading — P5), so state plainly that establishment is deferred to
      // first use, exactly like a non-default profile's lazy establishment.
      logger.info(
        `${this.options.name} v${this.options.version} starting; "${DEFAULT_PROFILE_NAME}" profile not yet established`,
      );
    }

    // 5. Serve stdio. `serveStdio` chooses the era of the connection from its opening message and takes an
    //    instance from the factory for it: the 2025-11-25 handshake or revision 2026-07-28 (Story 43.2).
    //    Both options are passed explicitly, so a 2025-era client is served as before.
    this.assertNotServing();
    this.servingHandle = serveStdio(this.serverFactory, {
      legacy: "serve",
      transport: new StdioServerTransport(),
    });
    logger.info("Connected via stdio transport");
  }

  /** Throws when stdio is already being served: a second `start()` must not attach to stdin again. */
  private assertNotServing(): void {
    if (this.servingHandle !== undefined) {
      throw new Error(
        `${this.options.name}: start() was called while the server is already serving stdio (re-entry). ` +
          `Call stop() first.`,
      );
    }
  }

  /**
   * Stop the server (Epic 29, Story 29.1, AC 29.1.3 — the audit shutdown-flush
   * seam). Closes the serving handle that {@link start} opened (the instance
   * the connection is pinned to, and the transport); when {@link start} was
   * never called, or the handle is already closed, it closes the current
   * instance instead (a safe no-op when nothing is connected). A confirmation dialog that is still unanswered
   * is written as its `unanswered` audit entry first. Then, when
   * auditing is ON, AWAITS {@link AuditLogger.shutdown}: it
   * enqueues the final `droppedEntries` line and drains the write queue, so
   * no entry enqueued up to this point is lost before the process exits.
   *
   * This is the concrete "server's stop path" the audit writer's `shutdown()`
   * was previously only ever CALLABLE from (Story 29.0 left it unwired); a
   * host (e.g. a signal handler in a server package's entry point) calls this
   * to shut down cleanly. Safe to call when auditing is off (`this.
   * auditLogger` is `undefined` — a pure no-op flush) and idempotent-safe to
   * call more than once (`AuditLogger.shutdown()` is documented safe to call
   * multiple times; closing an already-closed transport is a no-op too).
   */
  async stop(): Promise<void> {
    const handle = this.servingHandle;
    this.servingHandle = undefined;
    if (handle !== undefined) {
      // Closes the instance the connection is pinned to, and the transport.
      await handle.close();
    } else {
      await this.mcpServer.close();
    }
    // A dialog nobody answered gets its entry before the audit writer shuts down.
    this.flushPendingAsks();
    if (this.auditLogger) {
      await this.auditLogger.shutdown();
    }
  }

  // ── Per-profile client establishment (D1/D8) ───────────────────────

  /**
   * Get the established {@link IrisHttpClient} for a profile, creating and
   * establishing it lazily on first use (architecture decisions D1/D8).
   *
   * - **Default profile:** normally created and established eagerly in
   *   {@link start}; this method returns the cached client + negotiated
   *   version without re-establishing it (byte-for-byte today's behavior). If
   *   `start`'s eager health check instead found the default instance
   *   unreachable (architecture record M1, Epic 37 — non-fatal), no
   *   `profileMeta` entry exists for it, so this method falls through to the
   *   SAME first-touch establishment below that every non-default profile
   *   uses.
   * - **Non-default profile:** on first call, creates the profile's own client,
   *   runs the health check and Atelier-version negotiation, then caches the
   *   result so the one-time negotiation latency is paid at most once. A
   *   health-check failure is surfaced as a thrown error (NOT `process.exit`) —
   *   no profile's first-touch (or retry) failure is fatal to the running
   *   server; only a CONFIGURATION error at startup is (M1).
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
   * @throws {Error} When the profile's first-touch (or retry) health check
   *   fails — including `default` when {@link start}'s eager attempt failed
   *   (M1).
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
   * On a first-touch health-check failure (any profile, `default` included
   * when {@link start}'s eager attempt did not establish it — M1), the cached
   * client is destroyed and dropped (AC 14.2.8) before the error is
   * re-thrown, so no un-established client lingers and the next call retries
   * cleanly.
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

  /**
   * The underlying MCP SDK server instance, for advanced use cases: the instance built at construction until
   * the stdio entry asks the factory for another, then the latest one it built.
   */
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
