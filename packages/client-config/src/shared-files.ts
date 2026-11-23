/**
 * `@iris-mcp/client-config` - shared config files (Story 44.2; AD-30 "Shared files").
 *
 * Two adapter scopes can resolve to one file: a workspace-root `.mcp.json` is both Claude Code's and VS Code
 * Copilot's project file. Entries in such a file are owned per server NAME, not per client, and the state
 * ledger is what records who wrote an entry. Each ledger record carries the resolved config file it was written
 * to, and only a record for THIS file counts: a client's record for another project's `.mcp.json` is not an owner
 * here.
 *
 * The rule, as the engine applies it to a write for client X under a name that is already present in the file:
 * - X owns the entry ALONE when its ledger records it and no other sharing client's does. For an adapter that
 *   wrote the file before it was shared (`PRE_SHARING_WRITERS`, Claude Code), an entry that no client records
 *   also counts: such a file predates the ledger or the sharing, and AD-15 forbids turning a Claude-Code-only
 *   user's re-apply into a refusal.
 * - Otherwise an entry equal, as a JSON value, to the one X would write is ADOPTED: X's record is added and
 *   nothing is written. An adoption never takes ownership away: a pre-sharing writer that owns the entry here
 *   without a record of it for this file gets one (`recordAdoptedOwners`).
 * - Any other entry is a CONFLICT that refuses the write.
 *
 * A name that is not in the file is created as ever. This module is pure: it reads the ledger and the resolved
 * paths it is given and never touches a file.
 */

import { CLIENT_ADAPTERS } from "./adapters.js";
import { samePath } from "./home-guard.js";
import { resolveScopePath } from "./paths.js";
import type { RawEntry } from "./readers.js";
import { dropManaged, dropStash, type ManagerState, type RecordFile } from "./state.js";
import { CANONICAL_SERVERS, type ClientAdapter, type ClientScope, type HostContext } from "./types.js";

/** One other adapter scope that resolves to the same file. */
export interface SharedPeer {
  client: string;
  scope: ClientScope;
}

/** Adapters that wrote the file before it was shared; their unrecorded canonical entries count as theirs. */
export const PRE_SHARING_WRITERS: readonly string[] = ["claude-code"];

/**
 * The adapters whose PROJECT scope is the shared workspace-root `.mcp.json`. The shared-file rule is defined for these
 * and nothing else: no other adapter, and no user scope, ever enters it, whatever the working directory (from the home
 * directory a client's user path and its own project path can resolve to one file, and that is not a share).
 */
export const SHARED_PROJECT_CLIENTS: readonly string[] = ["claude-code", "vscode"];

/**
 * The OTHER sharing clients' project scopes whose resolved path equals this one's, in registry order. Empty for any scope
 * that is not the project scope of a `SHARED_PROJECT_CLIENTS` adapter, and for a scope the context cannot resolve (a
 * project scope with no project directory). A client's own scopes are never its peers.
 */
export function sharedPeers(
  adapter: ClientAdapter,
  scope: ClientScope,
  ctx: HostContext,
  adapters: Readonly<Record<string, ClientAdapter>> = CLIENT_ADAPTERS,
): SharedPeer[] {
  if (scope !== "project" || !SHARED_PROJECT_CLIENTS.includes(adapter.id)) return [];
  const own = resolveScopePath(adapter, scope, ctx);
  if (own === null) return [];
  const peers: SharedPeer[] = [];
  for (const other of Object.values(adapters)) {
    if (other.id === adapter.id || !SHARED_PROJECT_CLIENTS.includes(other.id)) continue;
    const path = resolveScopePath(other, "project", ctx);
    if (path !== null && samePath(ctx.platform, own, path)) peers.push({ client: other.id, scope: "project" });
  }
  return peers;
}

/** The ids of the sharing clients, without repeats. */
export function peerClients(peers: readonly SharedPeer[]): string[] {
  return [...new Set(peers.map((peer) => peer.client))];
}

/**
 * The peers that hold any ledger record (manager-created or stash, whatever the name) for the file `at`. A record
 * without a path never counts, as in `recordingClients`.
 */
export function peersRecordingFile(state: ManagerState, peers: readonly SharedPeer[], at: RecordFile): SharedPeer[] {
  return peers.filter((peer) =>
    [...state.entries, ...state.stashes].some(
      (r) => r.client === peer.client && r.scope === peer.scope && r.path !== undefined && samePath(at.platform, r.path, at.path),
    ),
  );
}

/**
 * The clients among X and its peers whose ledger records `name` as manager-created or holds a stash of it for the
 * file `at`, without repeats. Ownership is per file:
 * - a record with a path counts only when that path is the file `at`, so a record of another project's `.mcp.json`
 *   never makes a client an owner here;
 * - a record without a path (written before paths were recorded) never counts for a peer, and counts for X itself
 *   only when the scope is not shared or X is a pre-sharing writer: it cannot be told apart from a record of an
 *   old, unshared file.
 */
export function recordingClients(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  peers: readonly SharedPeer[],
  at: RecordFile,
): string[] {
  const slots = [{ client, scope }, ...peers];
  const counts = (record: { client: string; scope: ClientScope; name: string; path?: string }): boolean => {
    if (record.name !== name || !slots.some((p) => p.client === record.client && p.scope === record.scope)) return false;
    if (record.path !== undefined) return samePath(at.platform, record.path, at.path);
    return record.client === client && (peers.length === 0 || PRE_SHARING_WRITERS.includes(client));
  };
  return [...new Set([...state.entries, ...state.stashes].filter(counts).map((record) => record.client))];
}

/**
 * Who owns `name` in the shared file `at`: every client (X and its peers) whose ledger records it or holds a stash
 * of it for that file; when none does, the pre-sharing writers among them are the implied owners, for a canonical
 * (iris-mcp) name only. An unrecorded entry under any other name is nobody's.
 */
export function ownerClients(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  peers: readonly SharedPeer[],
  at: RecordFile,
): string[] {
  const owners = recordingClients(state, client, scope, name, peers, at);
  if (owners.length > 0 || !(CANONICAL_SERVERS as readonly string[]).includes(name)) return owners;
  return [...new Set([client, ...peers.map((p) => p.client)])].filter((id) => PRE_SHARING_WRITERS.includes(id));
}

/** True when `client` is the only owner of `name` in the shared file (see the module header). */
export function soleOwner(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  peers: readonly SharedPeer[],
  at: RecordFile,
): boolean {
  const owners = ownerClients(state, client, scope, name, peers, at);
  return owners.length === 1 && owners[0] === client;
}

/** The other clients that own `name` in the shared file: the ones a write, disable or remove by `client` affects. */
export function otherOwners(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  peers: readonly SharedPeer[],
  at: RecordFile,
): string[] {
  return ownerClients(state, client, scope, name, peers, at).filter((id) => id !== client);
}

/**
 * The state after a client removes `name` from the shared file `at`: its own records and stash for the file go, and so
 * do the manager-created records of the other clients for the same file, which no longer describe an entry that is
 * there. Their stashes stay: a stash is a disabled copy the other client can still enable.
 */
export function dropRemovedShared(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  peers: readonly SharedPeer[],
  at: RecordFile,
): ManagerState {
  const own = dropStash(dropManaged(state, client, scope, name, at), client, scope, name, at);
  return peers.reduce(
    (next, peer) => ({
      ...next,
      entries: next.entries.filter(
        (r) => !(r.client === peer.client && r.scope === peer.scope && r.name === name && r.path !== undefined && samePath(at.platform, r.path, at.path)),
      ),
    }),
    own,
  );
}

/**
 * The state after `client` adopts `name` in the shared file `at`, before `client`'s own record is added: an adoption
 * never takes ownership away. Every owner that `ownerClients` names among the peers without a record of the name for
 * this file gets a manager record for this file. That happens only when no client records the name for the file, so the
 * owners are the implied ones, the pre-sharing writers (whatever their other records say: none, one without a path, or
 * one of another file). Without it, `client`'s new record would make `client` the sole owner, and a later different
 * write by `client` would overwrite the entry unrefused (AD-30). `containsSecret` is the adopted entry's, which is
 * exactly what `client` would write. The peer's other records stay as they are.
 */
export function recordAdoptedOwners(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  peers: readonly SharedPeer[],
  at: RecordFile,
  now: Date,
  containsSecret: boolean,
): ManagerState {
  const recorded = recordingClients(state, client, scope, name, peers, at);
  const owners = ownerClients(state, client, scope, name, peers, at);
  const iso = now.toISOString();
  const added: ManagerState["entries"] = peers
    .filter((peer) => owners.includes(peer.client) && !recorded.includes(peer.client))
    .map((peer) => ({ client: peer.client, scope: peer.scope, name, containsSecret, createdAt: iso, updatedAt: iso, path: at.path }));
  return added.length > 0 ? { ...state, entries: [...state.entries, ...added] } : state;
}

/** Deep equality of two JSON values, independent of object key order. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, index) => jsonEqual(item, b[index]));
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key) && jsonEqual(left[key], right[key]));
}

export type AdoptOrConflict = { kind: "adopt" } | { kind: "conflict"; reason: string };

/**
 * A write by a client that does not own `name` alone: adopt the entry when it equals what the client would
 * write, otherwise refuse. The reason names the file and the other owning clients, never an entry's content.
 */
export function adoptOrConflict(args: {
  existing: RawEntry;
  wouldWrite: RawEntry;
  path: string;
  name: string;
  client: string;
  owners: readonly string[];
}): AdoptOrConflict {
  if (jsonEqual(args.existing, args.wouldWrite)) return { kind: "adopt" };
  const others = args.owners.filter((id) => id !== args.client);
  const named = others.length > 0 ? others.join(", ") : "another client";
  return {
    kind: "conflict",
    reason:
      `refusing to write "${args.name}" to ${args.path}: the file is shared with ${named}, which owns an entry under that name ` +
      `that differs from what ${args.client} would write, so nothing was written. ` +
      `Both clients read the same file; make the entries match (same mode and connection settings) or remove the entry first.`,
  };
}

/** The sentence a disable or remove adds when other clients read the same file. */
export function sharedFileNote(path: string, clients: readonly string[]): string {
  const who = clients.map((id) => (CLIENT_ADAPTERS[id] !== undefined ? `${CLIENT_ADAPTERS[id].displayName} (${id})` : id)).join(", ");
  return `${path} is shared: ${who} read${clients.length === 1 ? "s" : ""} the same file, so this change also affects ${clients.length === 1 ? "it" : "them"}.`;
}
