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

export { readConfigEntries, type RawEntry, type ReadEntriesResult } from "./readers.js";

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
  renderNativeEntry,
  serializeTomlEntry,
  type DiffAction,
  type DiffMechanism,
  type DiffResult,
  type JsoncNativeEdit,
  type NativeEdit,
  type TomlNativeEdit,
  type YamlNativeEdit,
} from "./diff.js";
