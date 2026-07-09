// @iris-mcp/shared — barrel export

export { booleanParam } from "./zod-helpers.js";
export { isArgProvided, argOrPlaceholder } from "./prompt-helpers.js";
export type { IrisConnectionConfig } from "./config.js";
export { loadConfig } from "./config.js";
export {
  DEFAULT_PROFILE_NAME,
  ProfileResolutionError,
  ProfileClientRegistry,
  buildProfileRegistry,
  loadProfileRegistry,
  resolveProfile,
} from "./profiles.js";
export type { IrisProfile, ProfileRegistry } from "./profiles.js";
export {
  IrisConnectionError,
  IrisApiError,
  McpProtocolError,
} from "./errors.js";
export { IrisHttpClient } from "./http-client.js";
export type { RequestOptions, AtelierEnvelope, HeadResponse } from "./http-client.js";
export { logger, LogLevel, parseLogLevel } from "./logger.js";
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
  PaginateResult,
  PromptDefinition,
  PromptArgumentDefinition,
} from "./tool-types.js";
export {
  McpServerBase,
  encodeCursor,
  decodeCursor,
  buildToolContext,
} from "./server-base.js";
export type { McpServerBaseOptions } from "./server-base.js";
export {
  bootstrap,
  probeCustomRest,
  deployClasses,
  compileClasses,
  configureWebApp,
  configurePackageMapping,
  ensureUnitTestRoot,
  MANUAL_INSTRUCTIONS,
} from "./bootstrap.js";
export type { BootstrapResult } from "./bootstrap.js";
export { BOOTSTRAP_CLASSES, getBootstrapClasses } from "./bootstrap-classes.js";
export type { BootstrapClass } from "./bootstrap-classes.js";
export { resolveTransport } from "./transport.js";
export {
  GOVERNANCE_BASELINE,
  GOVERNANCE_BASELINE_HASH,
} from "./governance-baseline.js";
export {
  parseGovernanceConfig,
  buildMutatesLookup,
  buildDefaultEnabledWrites,
  unwrapActionOptions,
  assertGovernanceClassification,
  defaultSeed,
  effective,
  getEffectivePolicy,
} from "./governance.js";
export type {
  MutationClass,
  GovernanceLayer,
  GovernanceConfig,
  MutatesLookup,
} from "./governance.js";
export {
  SERVER_DISCOVERY_TOOL_NAME,
  SERVER_DISCOVERY_INSTRUCTIONS,
  serverDiscoveryTool,
  serverDiscoveryInputSchema,
  buildRoster,
  buildRosterEntry,
  computeServerDiscovery,
} from "./server-discovery.js";
export type {
  ProfileRosterEntry,
  ServerDiscoveryResult,
} from "./server-discovery.js";
