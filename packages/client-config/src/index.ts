/**
 * `@iris-mcp/client-config` — public API (Epic 33, Story 33.0).
 *
 * Read-side, complete-shaped (Rule #52 seam): registry + detection +
 * native readers + status matrix + pure diff renderer. Story 33.1 (write
 * engine), 33.2 (`iris-mcp-clients` CLI) and 33.3 (extension UI) import
 * THESE functions from the built dist — never re-implement them.
 */

export {
  CANONICAL_SERVERS,
  type AdapterPlatform,
  type CanonicalEntry,
  type CanonicalServerName,
  type ClientAdapter,
  type ClientDisposition,
  type ClientScope,
  type ConfigFormat,
  type DetectionRule,
  type DisableSupport,
  type EntryShape,
  type EnvExpansion,
  type HostContext,
  type NativeDisableFlag,
  type PlatformPaths,
  type ScopeDef,
} from "./types.js";

export { ADAPTER_DATA_VERSION, CLIENT_ADAPTERS, CLIENT_DISPOSITIONS } from "./adapters.js";

export { resolvePathTemplate, resolveScopePath, resolveScopeCandidates } from "./paths.js";

export {
  detectClients,
  detectClients as detect,
  detectionProbes,
  REAL_DETECTION_FS,
  type ClientDetection,
  type DetectionFs,
  type DetectionProbe,
  type DetectionReport,
} from "./detect.js";

export {
  diagnoseConfigSurface,
  readConfigEntries,
  type ConfigSurfaceDiagnosis,
  type RawEntry,
  type ReadEntriesResult,
} from "./readers.js";

export {
  buildStatusMatrix,
  buildStatusMatrix as status,
  entryPresence,
  REAL_STATUS_FS,
  type ClientStatus,
  type ScopeFileState,
  type ScopeStatus,
  type ServerPresence,
  type ServerStatus,
  type StatusFs,
  type StatusReport,
} from "./status.js";

export {
  diff,
  findTomlEntryRegion,
  findTomlInsertLine,
  mergeUpdateEntry,
  renderNativeEntry,
  scanTomlStructure,
  serializeTomlEntry,
  type DiffAction,
  type DiffMechanism,
  type DiffOptions,
  type DiffResult,
  type JsoncNativeEdit,
  type NativeEdit,
  type TomlNativeEdit,
  type YamlNativeEdit,
} from "./diff.js";

export {
  applyWrite,
  backupDir,
  backupPathFor,
  executeNativeEdit,
  listBackups,
  restoreBackup,
  REAL_WRITE_FS,
  type ApplyWriteOptions,
  type RestoreOptions,
  type WriteFs,
  type WriteResult,
} from "./write.js";

export {
  addStash,
  dropManaged,
  dropStash,
  findStash,
  isManagerCreated,
  readState,
  recordManaged,
  resolveStateDir,
  stateFilePath,
  writeState,
  EMPTY_STATE,
  type EngineHostContext,
  type ManagedEntryRecord,
  type ManagerState,
  type ReadStateResult,
  type StashRecord,
} from "./state.js";

export {
  apply,
  disable,
  enable,
  ensureInputs,
  presentInputIds,
  remove,
  restore,
  type EngineAction,
  type EngineOptions,
  type EngineResult,
  type EnsureInputsResult,
} from "./engine.js";

export {
  CLAUDE_DESKTOP_REFUSAL,
  GENERIC_AGENTS_TARGET_ID,
  PACK_ROUTES,
  PACK_ROUTE_IDS,
  PACK_TARGETS,
  PACK_TARGETS_CHECKED_ON,
  packRouteFor,
  packTargetFor,
  type PackRoute,
  type PackRouteId,
  type PackRuleForm,
  type PackRuleTarget,
  type PackTarget,
} from "./pack-targets.js";

export {
  describeAmbiguousRuleBlock,
  hasUtf16Bom,
  locateRuleBlock,
  ruleBlockMarkers,
  ruleSectionProblem,
  withRuleBlock,
  withoutRuleBlock,
  type LineEndingAdded,
  type RuleBlockLocation,
  type RuleBlockMarkers,
  type RuleBlockRefusal,
  type WithRuleBlockResult,
  type WithoutRuleBlockResult,
} from "./rule-block.js";

export {
  DEFAULT_PACK_DIR,
  MANIFEST_PATH,
  emptyManifest,
  installerPayloads,
  loadPack,
  parseManifest,
  planPackChange,
  renderManifest,
  renderPlanPreview,
  type InstallerPayload,
  type LoadPackResult,
  type LoadedPack,
  type ManifestBlock,
  type ManifestFile,
  type PackAction,
  type PackChange,
  type PackManifest,
  type PackPlan,
  type PackRefusal,
  type PackRule,
  type PlanCounts,
  type PlanInput,
  type PlanItem,
  type PlanWrite,
  type ProjectView,
} from "./pack-plan.js";

export {
  executePackPlan,
  preparePackChange,
  projectKey,
  REAL_BYTES_FS,
  type BytesFs,
  type ExecuteOptions,
  type ExecuteResult,
  type PackContext,
  type PrepareOptions,
  type PrepareResult,
} from "./pack-apply.js";

export {
  synthesizeEntry,
  PKG_BY_SERVER,
  VSCODE_PASSWORD_INPUT_ID,
  type EnvMode,
  type SynthesisOptions,
  type SynthesisProfile,
  type SynthesisResult,
  type VscodeInput,
} from "./synthesize.js";
