/**
 * `@iris-mcp/client-config` — the manager state file (Epic 33, Story 33.1;
 * AC 33.1.3 stash + AC 33.1.4 ownership).
 *
 * `<stateDir>/state.json` holds two rosters:
 *
 * - `entries`: manager-CREATED entries (`{client, scope, name, containsSecret,
 *   createdAt, updatedAt}`). This is the ownership ledger for AC 33.1.4: an
 *   entry whose name is outside the canonical iris-mcp namespace may only be
 *   modified when recorded here. Recorded on `apply`, dropped on `remove`.
 * - `stashes`: disabled stash-client entries (`{client, scope, name, entry,
 *   disabledAt}` — the spec §3.4 shape). `entry` is the PARSED native entry
 *   exactly as it sat in the client file, so enable splices the very entry
 *   back (native-only keys like Cline `autoApprove` survive). state.json
 *   never holds MORE secret than the client file already held (spec §3.4) —
 *   and mode server-manager/env-reference/governance-file entries hold none.
 *
 * The state file is the manager's OWN data (no foreign content), so unlike
 * client configs it is rewritten whole. A corrupt state file is a typed
 * error, never a guess.
 */

import path from "node:path";

import type { RawEntry } from "./readers.js";
import type { AdapterPlatform, ClientScope, HostContext } from "./types.js";
import type { WriteFs } from "./write.js";

/** One manager-created entry record (the ownership ledger). */
export interface ManagedEntryRecord {
  client: string;
  scope: ClientScope;
  name: string;
  /** True for `explicit`-mode entries carrying a literal IRIS_PASSWORD. */
  containsSecret: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One stashed (disabled) entry — the spec §3.4 shape. */
export interface StashRecord {
  client: string;
  scope: ClientScope;
  name: string;
  /** The parsed native entry exactly as it sat in the client file. */
  entry: RawEntry;
  disabledAt: string;
}

export interface ManagerState {
  version: 1;
  entries: ManagedEntryRecord[];
  stashes: StashRecord[];
}

export const EMPTY_STATE: ManagerState = { version: 1, entries: [], stashes: [] };

/** Host context for the write engine: HostContext + an optional state-dir
 * override (default `~/.iris-mcp/client-manager` resolved from homeDir). */
export interface EngineHostContext extends HostContext {
  stateDir?: string;
}

/** Resolve the manager state directory (injectable; never the real HOME in tests). */
export function resolveStateDir(ctx: EngineHostContext): string {
  if (ctx.stateDir !== undefined && ctx.stateDir !== "") return ctx.stateDir;
  const p = ctx.platform === "win32" ? path.win32 : path.posix;
  return p.join(ctx.homeDir, ".iris-mcp", "client-manager");
}

/** The state.json path for a state dir. */
export function stateFilePath(stateDir: string, platform: AdapterPlatform): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(stateDir, "state.json");
}

export type ReadStateResult = { ok: true; state: ManagerState } | { ok: false; error: string };

/**
 * Read the manager state. A missing file is a valid EMPTY state (first run).
 * An unparseable or wrongly-shaped file is a typed error — the manager never
 * guesses at its own ledger.
 */
export function readState(fs: WriteFs, stateDir: string, platform: AdapterPlatform): ReadStateResult {
  const file = stateFilePath(stateDir, platform);
  let exists = false;
  try {
    exists = fs.exists(file);
  } catch {
    exists = false;
  }
  if (!exists) return { ok: true, state: { version: 1, entries: [], stashes: [] } };
  let text: string;
  try {
    text = fs.readFile(file);
  } catch (err) {
    return { ok: false, error: `could not read the manager state file: ${err instanceof Error ? err.message : String(err)}` };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `the manager state file is unparseable: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !Array.isArray((parsed as ManagerState).entries) ||
    !Array.isArray((parsed as ManagerState).stashes)
  ) {
    return { ok: false, error: "the manager state file has an unexpected shape (expected {entries: [], stashes: []})" };
  }
  const state = parsed as ManagerState;
  return { ok: true, state: { version: 1, entries: state.entries, stashes: state.stashes } };
}

/** Persist the manager state (pretty JSON; the state dir is created as needed). */
export function writeState(fs: WriteFs, stateDir: string, platform: AdapterPlatform, state: ManagerState): void {
  fs.mkdir(stateDir);
  fs.writeFile(stateFilePath(stateDir, platform), JSON.stringify(state, null, 2) + "\n");
}

function sameSlot(client: string, scope: ClientScope, name: string) {
  return (record: { client: string; scope: ClientScope; name: string }) =>
    record.client === client && record.scope === scope && record.name === name;
}

/** AC 33.1.4 ownership: recorded manager-created? */
export function isManagerCreated(state: ManagerState, client: string, scope: ClientScope, name: string): boolean {
  return state.entries.some(sameSlot(client, scope, name));
}

/** Record (or refresh) a manager-created entry. Returns a NEW state (inputs
 * are not mutated). */
export function recordManaged(
  state: ManagerState,
  record: { client: string; scope: ClientScope; name: string; containsSecret: boolean },
  now: Date,
): ManagerState {
  const iso = now.toISOString();
  const entries = state.entries.filter((r) => !sameSlot(record.client, record.scope, record.name)(r));
  const existing = state.entries.find(sameSlot(record.client, record.scope, record.name));
  entries.push({
    client: record.client,
    scope: record.scope,
    name: record.name,
    containsSecret: record.containsSecret,
    createdAt: existing?.createdAt ?? iso,
    updatedAt: iso,
  });
  return { ...state, entries };
}

/** Drop a manager-created record (on remove). Returns a NEW state. */
export function dropManaged(state: ManagerState, client: string, scope: ClientScope, name: string): ManagerState {
  return { ...state, entries: state.entries.filter((r) => !sameSlot(client, scope, name)(r)) };
}

/** Find the stash record for one slot, if any. */
export function findStash(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
): StashRecord | undefined {
  return state.stashes.find(sameSlot(client, scope, name));
}

/** Add/replace a stash record (on disable). Returns a NEW state. */
export function addStash(
  state: ManagerState,
  record: { client: string; scope: ClientScope; name: string; entry: RawEntry },
  now: Date,
): ManagerState {
  const stashes = state.stashes.filter((r) => !sameSlot(record.client, record.scope, record.name)(r));
  stashes.push({
    client: record.client,
    scope: record.scope,
    name: record.name,
    entry: record.entry,
    disabledAt: now.toISOString(),
  });
  return { ...state, stashes };
}

/** Drop a stash record (on enable/remove). Returns a NEW state. */
export function dropStash(state: ManagerState, client: string, scope: ClientScope, name: string): ManagerState {
  return { ...state, stashes: state.stashes.filter((r) => !sameSlot(client, scope, name)(r)) };
}
