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
  type LegacyScopeDef,
  type NativeDisableFlag,
  type PlatformPaths,
  type ScopeDef,
} from "./types.js";

export { ADAPTER_DATA_VERSION, CLIENT_ADAPTERS, CLIENT_DISPOSITIONS } from "./adapters.js";

export {
  adapterForScope,
  legacyAdapterView,
  resolveLegacyPath,
  resolvePathTemplate,
  resolveScopePath,
  resolveScopeCandidates,
} from "./paths.js";

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
  type LegacyFileStatus,
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
  type RecordFile,
  type StashRecord,
} from "./state.js";

export {
  apply,
  disable,
  enable,
  holdsLegacyReferences,
  isPreMoveStash,
  previewLegacyRemoval,
  remove,
  restore,
  sharedWriteVerdict,
  type EngineAction,
  type EngineOptions,
  type EngineResult,
  type LegacyPreview,
  type LegacyRemoval,
  type SharedWriteVerdict,
} from "./engine.js";

export {
  PRE_SHARING_WRITERS,
  dropPeerRecords,
  dropRemovedShared,
  fileOwner,
  ownedByOtherReason,
  peerClients,
  peersRecordingFile,
  sharedFileNote,
  sharedPeers,
  type SharedPeer,
} from "./shared-files.js";

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
  LINK_DETAILS,
  MANIFEST_PATH,
  emptyManifest,
  firstLinkOn,
  installerPayloads,
  loadPack,
  parseManifest,
  planPackChange,
  renderManifest,
  renderPlanPreview,
  type InstallerPayload,
  type LinkKind,
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
  CLAUDE_CODE_PLUGIN_ID,
  describePluginDetection,
  detectClaudeCodePlugin,
  type PluginDetection,
  type PluginDetectionHost,
} from "./claude-plugin-detect.js";

export {
  executePackPlan,
  preparePackChange,
  projectKey,
  readTextIfFile,
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
  IRIS_MCP_MAJOR,
  pinnedSpec,
  PKG_BY_SERVER,
  type EnvMode,
  type SynthesisOptions,
  type SynthesisProfile,
  type SynthesisResult,
} from "./synthesize.js";

export {
  ensureInputs,
  presentInputIds,
  VSCODE_PASSWORD_INPUT_ID,
  type EnsureInputsResult,
  type VscodeInput,
} from "./deprecated.js";
