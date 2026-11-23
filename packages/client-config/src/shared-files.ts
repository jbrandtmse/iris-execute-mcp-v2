/**
 * `@iris-mcp/client-config` - shared config files (Story 44.2; AD-30 "Shared files").
 *
 * Two adapter scopes can resolve to one file: a workspace-root `.mcp.json` is both Claude Code's and VS Code
 * Copilot's project file. An entry in such a file has AT MOST ONE owner, and nothing is ever adopted: the other
 * client is refused. The ledger records who wrote an entry, and each record carries the resolved config file it was
 * written to; only a record for THIS file counts, so a client's record for another project's `.mcp.json` owns nothing
 * here.
 *
 * The owner of a name in the file (`fileOwner`) is:
 * 1. the client with a manager-created record for this file; failing that,
 * 2. the client holding a stash of it for this file; failing that,
 * 3. for a canonical (iris-mcp) name only, the pre-sharing writer (`PRE_SHARING_WRITERS`, Claude Code): the file
 *    predates the ledger or the sharing, and AD-15 keeps a Claude-Code-only user's writes unrefused. A VS Code record
 *    without a path never makes VS Code an owner: it describes the old `.vscode/mcp.json`.
 *
 * `apply`, `disable`, `enable` and `remove` by a client that does not own an entry that is in the file are refused and
 * write nothing; a name that is not in the file is created (or put back from a stash) by whoever asks, and that client
 * then owns it. This module is pure: it reads the ledger and the resolved paths it is given and never touches a file.
 */

import { CLIENT_ADAPTERS } from "./adapters.js";
import { samePath } from "./home-guard.js";
import { resolveScopePath } from "./paths.js";
import { dropManaged, dropStash, type ManagerState, type RecordFile } from "./state.js";
import { pinnedSpec } from "./synthesize.js";
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
 * Who owns `name` in the shared file `at` (see the module header), or `null` when nobody does: an unrecorded entry
 * under a name outside the iris-mcp namespace. A manager record for the file decides first, then a stash of it, then
 * the pre-sharing writer for an iris-mcp name. When several clients hold a record of the same kind, the pre-sharing
 * writer is the owner, so the answer is always one client.
 */
export function fileOwner(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  peers: readonly SharedPeer[],
  at: RecordFile,
): string | null {
  const slots = [{ client, scope }, ...peers];
  const here = (record: LedgerRecord): boolean =>
    record.name === name &&
    record.path !== undefined &&
    samePath(at.platform, record.path, at.path) &&
    slots.some((slot) => slot.client === record.client && slot.scope === record.scope);
  const pools: ReadonlyArray<readonly LedgerRecord[]> = [state.entries, state.stashes];
  for (const pool of pools) {
    const holders = [...new Set(pool.filter(here).map((record) => record.client))];
    if (holders.length > 0) return holders.find((id) => PRE_SHARING_WRITERS.includes(id)) ?? holders[0] ?? null;
  }
  if (!(CANONICAL_SERVERS as readonly string[]).includes(name)) return null;
  return slots.map((slot) => slot.client).find((id) => PRE_SHARING_WRITERS.includes(id)) ?? null;
}

/** The fields of a ledger record (entry or stash) that ownership reads. */
interface LedgerRecord {
  client: string;
  scope: ClientScope;
  name: string;
  path?: string;
}

/**
 * The refusal for a client that does not own an entry of the shared file: names the file and the owner, says nothing
 * was written, and gives the way out (remove the entry with its owner, then write it with this client). It never
 * echoes an entry's content.
 */
export function ownedByOtherReason(args: {
  verb: "write" | "disable" | "enable" | "remove";
  path: string;
  name: string;
  client: string;
  owner: string;
}): string {
  const label = (id: string): string => (CLIENT_ADAPTERS[id] !== undefined ? `${CLIENT_ADAPTERS[id].displayName} (${id})` : id);
  return (
    `refusing to ${args.verb} "${args.name}" in ${args.path}: the entry belongs to ${label(args.owner)}. ` +
    `Claude Code and VS Code both read this workspace file, and one client never changes an entry the other owns, so nothing was written. ` +
    `To use ${args.client} for this server instead, remove the entry with its owner first: ` +
    `npx -y -p ${pinnedSpec("@iris-mcp/client-config")} iris-mcp-clients remove --client ${args.owner} --scope project --server ${args.name}, ` +
    `then apply it with ${args.client}.`
  );
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
  return dropPeerRecords(own, peers, name, at);
}

/**
 * The state after `client` creates `name` in the shared file `at`: the other clients' manager records of `name` for this
 * file describe an entry that is gone, so they leave. Their stashes stay: a stash is a disabled copy its owner can still
 * put back once this client's entry is removed.
 */
export function dropPeerRecords(state: ManagerState, peers: readonly SharedPeer[], name: string, at: RecordFile): ManagerState {
  return {
    ...state,
    entries: state.entries.filter(
      (r) =>
        !(
          r.name === name &&
          r.path !== undefined &&
          samePath(at.platform, r.path, at.path) &&
          peers.some((peer) => peer.client === r.client && peer.scope === r.scope)
        ),
    ),
  };
}

/** The sentence a disable or remove adds when other clients read the same file. */
export function sharedFileNote(path: string, clients: readonly string[]): string {
  const who = clients.map((id) => (CLIENT_ADAPTERS[id] !== undefined ? `${CLIENT_ADAPTERS[id].displayName} (${id})` : id)).join(", ");
  return `${path} is shared: ${who} read${clients.length === 1 ? "s" : ""} the same file, so this change also affects ${clients.length === 1 ? "it" : "them"}.`;
}
