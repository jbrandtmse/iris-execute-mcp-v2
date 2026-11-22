/**
 * `@iris-mcp/client-config` - shared config files (Story 44.2; AD-30 "Shared files").
 *
 * Two adapter scopes can resolve to one file: a workspace-root `.mcp.json` is both Claude Code's and VS Code
 * Copilot's project file. Entries in such a file are owned per server NAME, not per client, and the state
 * ledger (keyed `(client, scope, name)`) is what records who wrote an entry.
 *
 * The rule, as the engine applies it to a write for client X under a name that is already present in the file:
 * - X owns the entry ALONE when its ledger records it and no other sharing client's does. For an adapter that
 *   wrote the file before it was shared (`PRE_SHARING_WRITERS`, Claude Code), an entry that no client records
 *   also counts: such a file predates the ledger or the sharing, and AD-15 forbids turning a Claude-Code-only
 *   user's re-apply into a refusal.
 * - Otherwise an entry equal, as a JSON value, to the one X would write is ADOPTED: X's record is added and
 *   nothing is written.
 * - Any other entry is a CONFLICT that refuses the write.
 *
 * A name that is not in the file is created as ever. This module is pure: it reads the ledger and the resolved
 * paths it is given and never touches a file.
 */

import { CLIENT_ADAPTERS } from "./adapters.js";
import { samePath } from "./home-guard.js";
import { resolveScopePath } from "./paths.js";
import type { RawEntry } from "./readers.js";
import { isManagerCreated, findStash, type ManagerState } from "./state.js";
import type { ClientAdapter, ClientScope, HostContext } from "./types.js";

/** One other adapter scope that resolves to the same file. */
export interface SharedPeer {
  client: string;
  scope: ClientScope;
}

/** Adapters that wrote the file before it was shared; their unrecorded canonical entries count as theirs. */
export const PRE_SHARING_WRITERS: readonly string[] = ["claude-code"];

/**
 * The OTHER adapter scopes whose resolved path equals this scope's, in registry order. Empty for a scope
 * nobody shares, and for a scope the context cannot resolve (a project scope with no project directory).
 */
export function sharedPeers(
  adapter: ClientAdapter,
  scope: ClientScope,
  ctx: HostContext,
  adapters: Readonly<Record<string, ClientAdapter>> = CLIENT_ADAPTERS,
): SharedPeer[] {
  const own = resolveScopePath(adapter, scope, ctx);
  if (own === null) return [];
  const peers: SharedPeer[] = [];
  for (const other of Object.values(adapters)) {
    for (const scopeDef of other.scopes) {
      if (other.id === adapter.id && scopeDef.scope === scope) continue;
      const path = resolveScopePath(other, scopeDef.scope, ctx);
      if (path !== null && samePath(ctx.platform, own, path)) peers.push({ client: other.id, scope: scopeDef.scope });
    }
  }
  return peers;
}

/** The ids of the sharing clients, without repeats. */
export function peerClients(peers: readonly SharedPeer[]): string[] {
  return [...new Set(peers.map((peer) => peer.client))];
}

/**
 * Who owns `name` in a shared file: every client (X and its peers) whose ledger records it or holds a stash of
 * it; when none does, the pre-sharing writers among them are the implied owners.
 */
export function ownerClients(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  peers: readonly SharedPeer[],
): string[] {
  const all: SharedPeer[] = [{ client, scope }, ...peers];
  const recorded = all
    .filter((p) => isManagerCreated(state, p.client, p.scope, name) || findStash(state, p.client, p.scope, name) !== undefined)
    .map((p) => p.client);
  const owners = [...new Set(recorded)];
  if (owners.length > 0) return owners;
  return [...new Set(all.map((p) => p.client))].filter((id) => PRE_SHARING_WRITERS.includes(id));
}

/** True when `client` is the only owner of `name` in the shared file (see the module header). */
export function soleOwner(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  peers: readonly SharedPeer[],
): boolean {
  const owners = ownerClients(state, client, scope, name, peers);
  return owners.length === 1 && owners[0] === client;
}

/** The other clients that own `name` in the shared file: the ones a write, disable or remove by `client` affects. */
export function otherOwners(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  peers: readonly SharedPeer[],
): string[] {
  return ownerClients(state, client, scope, name, peers).filter((id) => id !== client);
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
