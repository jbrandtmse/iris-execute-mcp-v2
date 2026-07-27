/**
 * `@iris-mcp/client-config` — client × iris-mcp-server status matrix (Epic 33, Story 33.0).
 *
 * For every DETECTED client, parses each resolvable scope's config in its
 * native format and classifies every root-key entry:
 * - iris-mcp-owned (name in the canonical server set) → one matrix row:
 *   present-enabled | present-disabled | absent. Enabled/disabled comes from
 *   the adapter's nativeDisableFlag when it has one (Cline/Roo `disabled`,
 *   Goose `enabled`, Codex `enabled` — verified by the Story 33.1 live probe,
 *   absent key ⇒ enabled); otherwise present ⇒ enabled.
 * - foreign third-party → surfaced as NAMES ONLY (AC 33.0.4 + spec §3.5.5:
 *   never values — foreign entries may hold other products' secrets).
 *
 * A malformed file yields a per-scope `unparseable` status (never a crash);
 * undetected clients are excluded from the matrix but listed. This module
 * performs ZERO writes.
 */

import { readFileSync } from "node:fs";

import { ADAPTER_DATA_VERSION, CLIENT_ADAPTERS } from "./adapters.js";
import { detectClients, REAL_DETECTION_FS, type DetectionFs } from "./detect.js";
import { resolveScopePath } from "./paths.js";
import { readConfigEntries } from "./readers.js";
import {
  CANONICAL_SERVERS,
  type CanonicalServerName,
  type ClientAdapter,
  type ClientScope,
  type HostContext,
} from "./types.js";

/** Injectable read surface — structurally write-free. */
export interface StatusFs extends DetectionFs {
  readFile(path: string): string;
}

/** Default fs surface (real filesystem, exists + utf8 read only). */
export const REAL_STATUS_FS: StatusFs = {
  exists: REAL_DETECTION_FS.exists,
  readFile: (path) => readFileSync(path, "utf8"),
};

export type ServerPresence = "present-enabled" | "present-disabled" | "absent";

export interface ServerStatus {
  server: CanonicalServerName;
  state: ServerPresence;
}

export type ScopeFileState = "ok" | "missing" | "unparseable" | "unresolved";

export interface ScopeStatus {
  scope: ClientScope;
  path: string | null;
  file: ScopeFileState;
  /** Parse reason for `unparseable` (path + reason only — never content). */
  error?: string;
  /** All 6 canonical servers, in CANONICAL_SERVERS order. Empty when not ok. */
  servers: ServerStatus[];
  /** Foreign third-party entry NAMES, sorted. Names only — never values. */
  foreign: string[];
}

export interface ClientStatus {
  client: string;
  displayName: string;
  scopes: ScopeStatus[];
}

export interface StatusReport {
  adapterDataVersion: string;
  /** Detected clients with their per-scope matrices. */
  clients: ClientStatus[];
  /** Clients whose probes all missed (33.3 lists these collapsed). */
  undetected: { client: string; displayName: string }[];
}

/** Classify one parsed entry's enable state per the adapter's flag. */
export function entryPresence(
  adapter: ClientAdapter,
  entry: Record<string, unknown>,
): "present-enabled" | "present-disabled" {
  const flag = adapter.nativeDisableFlag;
  if (flag && entry[flag.key] === flag.disabledValue) return "present-disabled";
  return "present-enabled";
}

function isCanonicalServer(name: string): name is CanonicalServerName {
  return (CANONICAL_SERVERS as readonly string[]).includes(name);
}

/**
 * Build the client × iris-mcp-server matrix. Runs detection first; parses
 * only detected clients' existing config files. Never throws on missing or
 * malformed files.
 */
export function buildStatusMatrix(
  ctx: HostContext,
  fs: StatusFs = REAL_STATUS_FS,
  adapters: Readonly<Record<string, ClientAdapter>> = CLIENT_ADAPTERS,
): StatusReport {
  const detection = detectClients(ctx, fs, adapters);
  const clients: ClientStatus[] = [];
  const undetected: { client: string; displayName: string }[] = [];

  for (const detected of detection.clients) {
    const adapter = adapters[detected.client];
    if (!adapter) continue;
    if (!detected.detected) {
      undetected.push({ client: adapter.id, displayName: adapter.displayName });
      continue;
    }
    clients.push({
      client: adapter.id,
      displayName: adapter.displayName,
      scopes: adapter.scopes.map((scopeDef) => scopeStatus(adapter, scopeDef.scope, ctx, fs)),
    });
  }
  return { adapterDataVersion: ADAPTER_DATA_VERSION, clients, undetected };
}

function scopeStatus(
  adapter: ClientAdapter,
  scope: ClientScope,
  ctx: HostContext,
  fs: StatusFs,
): ScopeStatus {
  const path = resolveScopePath(adapter, scope, ctx, fs.exists);
  const empty: Pick<ScopeStatus, "servers" | "foreign"> = { servers: [], foreign: [] };
  if (path === null) {
    return { scope, path: null, file: "unresolved", ...empty };
  }
  let exists = false;
  try {
    exists = fs.exists(path);
  } catch {
    exists = false;
  }
  if (!exists) {
    return { scope, path, file: "missing", ...empty };
  }
  let content: string;
  try {
    content = fs.readFile(path);
  } catch (err) {
    return {
      scope,
      path,
      file: "unparseable",
      error: `could not read the file: ${err instanceof Error ? err.message : String(err)}`,
      ...empty,
    };
  }
  const parsed = readConfigEntries(adapter, content);
  if (!parsed.ok) {
    return { scope, path, file: "unparseable", error: parsed.error, ...empty };
  }
  const byServer = new Map<CanonicalServerName, ServerPresence>();
  const foreign: string[] = [];
  for (const [name, entry] of Object.entries(parsed.entries)) {
    if (isCanonicalServer(name)) {
      byServer.set(name, entryPresence(adapter, entry));
    } else {
      foreign.push(name);
    }
  }
  foreign.sort();
  const servers: ServerStatus[] = CANONICAL_SERVERS.map((server) => ({
    server,
    state: byServer.get(server) ?? "absent",
  }));
  return { scope, path, file: "ok", servers, foreign };
}
