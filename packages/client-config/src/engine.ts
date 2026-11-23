/**
 * `@iris-mcp/client-config` — the write engine (Epic 33, Story 33.1;
 * AC 33.1.1–33.1.4, Integration AC 33.1-I1).
 *
 * `apply` / `enable` / `disable` / `remove` / `restore` over the Story 33.0
 * read foundation. Every operation follows one pipeline:
 *
 *   resolve adapter + scope path → read the file (missing ⇒ empty-document
 *   for `apply`, absent-no-op for toggles) → OWNERSHIP check (AC 33.1.4,
 *   before any backup/write) → `diff()` renders the NativeEdit →
 *   `executeNativeEdit` executes EXACTLY that descriptor (AC 33.1-I1 — no
 *   edit is ever re-derived on the write path; `native: null` is a no-op) →
 *   `applyWrite` runs the universal safety protocol → state.json is updated
 *   (managed-entry ledger + stash records).
 *
 * Ownership (AC 33.1.4, spec §3.4): an operation refuses to modify any entry
 * whose name is outside the canonical iris-mcp namespace (EXACT match —
 * `iris-dev-mcp2` stays foreign) AND not recorded as manager-created in
 * state.json. An apply CREATING a not-yet-present non-canonical entry is the
 * act that makes it manager-created (recorded on success); an apply UPDATING
 * a present non-canonical entry requires the record up front.
 *
 * Shared files (AD-30): when two adapter scopes resolve to one file (a workspace
 * `.mcp.json` is Claude Code's and VS Code Copilot's project file), `apply` writes an
 * entry that another client owns only when it equals what this client would write
 * (adopted: no file edit, a ledger record) and refuses any other (see
 * `shared-files.ts`); `disable` and `remove` say that the other client reads the file.
 *
 * Legacy files: an adapter's `legacyScopes` (VS Code's old Local-harness `mcp.json`
 * files) are read-only sources. After a successful `apply` or `remove` the owned
 * entries leave them through the same write protocol, and never before the new
 * file's write has re-parsed clean.
 *
 * Results name paths and reasons only — never config content (spec §3.5.5).
 * Everything is injectable (fs, clock, stateDir, and — for the AC 33.1-I1
 * spy test — the diff/execute seams); no `process.*` reads.
 */

import { CLIENT_ADAPTERS } from "./adapters.js";
import { diff, renderNativeEntry, type DiffMechanism, type DiffOptions } from "./diff.js";
import { homeGuardReason, samePath } from "./home-guard.js";
import { adapterForScope, legacyAdapterView, resolveLegacyPath, resolveScopePath } from "./paths.js";
import { ownEntry, readConfigEntries, type RawEntry } from "./readers.js";
import {
  adoptOrConflict,
  type AdoptOrConflict,
  dropRemovedShared,
  otherOwners,
  ownerClients,
  peerClients,
  peersRecordingFile,
  PRE_SHARING_WRITERS,
  recordAdoptedOwners,
  sharedFileNote,
  sharedPeers,
  soleOwner,
  type SharedPeer,
} from "./shared-files.js";
import {
  addStash,
  dropStash,
  findStash,
  isManagerCreated,
  readState,
  recordManaged,
  resolveStateDir,
  writeState,
  type EngineHostContext,
  type ManagerState,
  type RecordFile,
} from "./state.js";
import { pinnedSpec } from "./synthesize.js";
import { CANONICAL_SERVERS, type CanonicalEntry, type CanonicalServerName, type ClientAdapter, type ClientScope } from "./types.js";
import {
  applyWrite,
  executeNativeEdit,
  restoreBackup,
  REAL_WRITE_FS,
  type WriteFs,
} from "./write.js";

export type EngineAction = "apply" | "enable" | "disable" | "remove" | "restore";

export interface EngineResult {
  ok: boolean;
  client: string;
  scope: ClientScope;
  action: EngineAction;
  /** Resolved config file path (null when the scope cannot be resolved). */
  path: string | null;
  /** The mechanism diff rendered (undefined for restore / early refusals). */
  mechanism?: DiffMechanism;
  /** True when the config file's bytes changed. */
  changed: boolean;
  backupPath?: string;
  /** True when a post-write parse failure auto-restored the prior state. */
  restored?: boolean;
  /** The adapter's restart hint, included after every successful write. */
  restartHint?: string;
  /** Failure reason — path + reason only, never file content. */
  reason?: string;
  /** Informational note on a successful no-op. */
  note?: string;
  /** Non-fatal problems (e.g. the config write succeeded but the state.json
   * update failed) — the operation still reports ok. */
  warnings?: string[];
  /** True when the entry was already in the shared file exactly as this client would write it: nothing was written and this client's record was added (Story 44.2). */
  adopted?: boolean;
  /** The other clients that read the same file and own the entry; present only on an adoption, a shared-file conflict, and a disable or remove that affects them (Story 44.2). */
  sharedWith?: string[];
  /** Says that other clients read the same file (a disable or remove of a shared entry; Story 44.2). */
  sharedNote?: string;
  /** Owned entries taken out of a read-only legacy file (the old VS Code mcp.json files), one record per file; present only when a legacy file held an owned entry or could not be read (Story 44.2). */
  legacy?: LegacyRemoval[];
}

/** The outcome of taking owned entries out of one legacy file. */
export interface LegacyRemoval {
  /** The legacy file. */
  path: string;
  /** False when the file could not be read, parsed or edited; the entries are then still in it. */
  ok: boolean;
  /** True when the file's bytes changed. */
  changed: boolean;
  /** The entry names taken out of the file. */
  removed: string[];
  backupPath?: string;
  /** True when a failed edit was rolled back to the backup. */
  restored?: boolean;
  reason?: string;
}

/** Injectable seams — production defaults are the real implementations; the
 * AC 33.1-I1 spy test injects recording wrappers; the sabotage test injects
 * an executor that produces unparseable content (a REACHABLE state — a
 * corrupting writer bug, Rule #54). */
export interface EngineOptions {
  fs?: WriteFs;
  now?: () => Date;
  diffFn?: typeof diff;
  executeFn?: typeof executeNativeEdit;
  /** apply only: mark the managed-entry record `contains-secret` (explicit
   * mode, AC 33.1.5). Default false. */
  containsSecret?: boolean;
}

interface Target {
  adapter: ClientAdapter;
  scope: ClientScope;
  path: string;
  stateDir: string;
  state: ManagerState;
  /** The other adapter scopes that resolve to the same file (empty for an unshared file). */
  peers: SharedPeer[];
  /** The config file the ledger calls concern: ownership records are kept per file. */
  at: RecordFile;
}

function fail(
  client: string,
  scope: ClientScope,
  action: EngineAction,
  path: string | null,
  reason: string,
  extra?: Partial<EngineResult>,
): EngineResult {
  return { ok: false, client, scope, action, path, changed: false, reason, ...extra };
}

function resolveTarget(
  ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  action: EngineAction,
  fs: WriteFs,
): Target | EngineResult {
  const adapter = CLIENT_ADAPTERS[client];
  if (!adapter) {
    const known = Object.keys(CLIENT_ADAPTERS).join(", ");
    return fail(client, scope, action, null, `unknown client "${client}" (known clients: ${known})`);
  }
  // Bind the predicate: injected fs implementations may be class instances
  // whose methods rely on `this` (the real fs surface uses arrows).
  const path = resolveScopePath(adapter, scope, ctx, (p) => fs.exists(p));
  if (path === null) {
    return fail(client, scope, action, null, `cannot resolve a ${scope}-scope config path for ${client} (project scope requires a projectDir)`);
  }
  if (scope === "project") {
    const refusal = homeGuardReason(adapter, ctx, (p) => fs.exists(p));
    if (refusal !== null) return fail(client, scope, action, path, refusal);
  }
  const stateDir = resolveStateDir(ctx);
  const state = readState(fs, stateDir, ctx.platform);
  if (!state.ok) {
    return fail(client, scope, action, path, state.error);
  }
  return {
    adapter: adapterForScope(adapter, scope),
    scope,
    path,
    stateDir,
    state: state.state,
    peers: sharedPeers(adapter, scope, ctx),
    at: { platform: ctx.platform, path },
  };
}

/** Exact-match namespace ownership (never prefix — `iris-dev-mcp2` is foreign). */
function isCanonicalName(name: string): boolean {
  return (CANONICAL_SERVERS as readonly string[]).includes(name);
}

/**
 * AC 33.1.4: refuse to modify an entry outside the iris-mcp namespace that is
 * not recorded manager-created. Fires BEFORE any backup/write. `present` is
 * whether the entry currently sits in the file: an apply CREATING a new
 * non-canonical entry is allowed (it becomes manager-created on success);
 * every other modification of an unmanaged foreign entry is refused.
 */
function ownershipRefusal(
  state: ManagerState,
  client: string,
  scope: ClientScope,
  name: string,
  present: boolean,
  at: RecordFile,
): string | null {
  if (isCanonicalName(name)) return null;
  if (isManagerCreated(state, client, scope, name, at)) return null;
  if (findStash(state, client, scope, name, at)) return null;
  if (!present) return null; // creation is how an entry becomes manager-created
  return (
    `refusing to modify "${name}": the name is outside the iris-mcp namespace ` +
    `(it is not one of ${CANONICAL_SERVERS.join(", ")}) and state.json does not record it as manager-created`
  );
}

/**
 * The shared-file verdict for writing `entry`: `null` when nothing is shared or the entry is not in the file or
 * this client owns it alone (a normal write), otherwise adopt-or-conflict (see shared-files.ts).
 */
function sharedVerdict(
  target: Target,
  existing: RawEntry | undefined,
  entry: CanonicalEntry,
): { verdict: AdoptOrConflict; sharedWith: string[] } | null {
  const { scope } = target;
  const client = target.adapter.id;
  if (existing === undefined || target.peers.length === 0) return null;
  if (soleOwner(target.state, client, scope, entry.name, target.peers, target.at)) return null;
  return {
    verdict: adoptOrConflict({
      existing,
      wouldWrite: renderNativeEntry(target.adapter, entry),
      path: target.path,
      name: entry.name,
      client,
      owners: ownerClients(target.state, client, scope, entry.name, target.peers, target.at),
    }),
    sharedWith: (() => {
      const others = otherOwners(target.state, client, scope, entry.name, target.peers, target.at);
      return others.length > 0 ? others : peerClients(target.peers);
    })(),
  };
}

/** What an apply of `entry` would do in a shared file, for the preview: the same verdict `apply` acts on. */
export type SharedWriteVerdict =
  | { kind: "none" }
  | { kind: "adopt"; path: string; sharedWith: string[] }
  | { kind: "conflict"; path: string; sharedWith: string[]; reason: string };

/**
 * Plan the shared-file side of an apply: `none` for an unshared file, an entry that is not in the file yet, or
 * one this client owns alone; `adopt` or `conflict` otherwise. Reads the file and the ledger, writes nothing.
 */
export function sharedWriteVerdict(
  ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  entry: CanonicalEntry,
  options: { fs?: WriteFs } = {},
): SharedWriteVerdict {
  const fs = options.fs ?? REAL_WRITE_FS;
  const target = resolveTarget(ctx, client, scope, "apply", fs);
  if ("action" in target) return { kind: "none" };
  const current = readCurrent(fs, target.path);
  if (!current.ok || current.content === null || current.content.trim() === "") return { kind: "none" };
  const parsed = readConfigEntries(target.adapter, current.content);
  const existing = parsed.ok ? ownEntry(parsed.entries, entry.name) : undefined;
  const shared = sharedVerdict(target, existing, entry);
  if (shared === null) return { kind: "none" };
  return shared.verdict.kind === "conflict"
    ? { kind: "conflict", path: target.path, sharedWith: shared.sharedWith, reason: shared.verdict.reason }
    : { kind: "adopt", path: target.path, sharedWith: shared.sharedWith };
}

/** True when a stashed or written entry holds `${env:...}`, `${input:...}` or `${command:...}` references (the old VS Code harness's syntax). */
export function holdsLegacyReferences(entry: unknown): boolean {
  return LEGACY_REFERENCE.test(JSON.stringify(entry));
}

/** Stashed or written references of the old VS Code harness, which the Copilot harness does not forward. */
const LEGACY_REFERENCE = /\$\{(?:env|input|command):/;

/**
 * True when a stash of an adapter with legacy files was taken from an old file: it holds old-harness references,
 * or the scope writes the `copilot` shape and the stash lacks its `type` and `tools` keys. Enabling such a stash
 * would write an entry the Copilot harness does not read as written; a fresh `apply` replaces it.
 */
export function isPreMoveStash(adapter: ClientAdapter, scope: ClientScope, entry: unknown): boolean {
  if (adapter.legacyScopes === undefined) return false;
  if (holdsLegacyReferences(entry)) return true;
  if (adapterForScope(adapter, scope).entryShape !== "copilot") return false;
  if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return true;
  const record = entry as Record<string, unknown>;
  return record.type === undefined || !Array.isArray(record.tools);
}

/** A successful disable or remove of an entry other clients also own says that they read the same file (AD-30, Story 44.2). */
function withSharedNote(result: EngineResult, target: Target, name: string): EngineResult {
  if (!result.ok || target.peers.length === 0) return result;
  const owners = otherOwners(target.state, target.adapter.id, result.scope, name, target.peers, target.at);
  // A client that never wrote the file before it was shared always names the file's other readers; a
  // pre-sharing writer stays byte-identical until another client records the entry.
  const others = owners.length > 0 || PRE_SHARING_WRITERS.includes(target.adapter.id) ? owners : peerClients(target.peers);
  if (others.length === 0) return result;
  return { ...result, sharedWith: others, sharedNote: sharedFileNote(target.path, others) };
}

function readCurrent(fs: WriteFs, path: string): { ok: true; content: string | null } | { ok: false; reason: string } {
  let exists = false;
  try {
    exists = fs.exists(path);
  } catch {
    exists = false;
  }
  if (!exists) return { ok: true, content: null };
  try {
    return { ok: true, content: fs.readFile(path) };
  } catch (err) {
    return { ok: false, reason: `could not read ${path}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** A stub canonical entry for enable/disable/remove — only `name` is ever
 * consumed on those paths (no entry text is rendered). */
function stubEntry(name: string): CanonicalEntry {
  return { name: name as CanonicalServerName, command: "", args: [] };
}

/** Persist a state update; failures degrade to a warning (the config write
 * already succeeded and is reported). */
function persistState(
  ctx: EngineHostContext,
  fs: WriteFs,
  stateDir: string,
  state: ManagerState,
  warnings: string[],
): void {
  try {
    writeState(fs, stateDir, ctx.platform, state);
  } catch (err) {
    warnings.push(
      `the config write succeeded but the state.json update failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

interface RunEditArgs {
  ctx: EngineHostContext;
  target: Target;
  scope: ClientScope;
  action: "apply" | "enable" | "disable" | "remove";
  diffAction: "apply" | "enable" | "disable" | "remove";
  entry: CanonicalEntry;
  content: string | null;
  diffOptions?: DiffOptions;
  containsSecret?: boolean;
  /** Update state.json after a successful write. */
  updateState?: (state: ManagerState) => ManagerState;
  /**
   * 33-1-R1: also run `updateState` when the diff renders already-in-state
   * (no config write). Default false — apply/disable keep their existing
   * "no write, no backup, no state change" no-op contract. `enable` sets
   * this true ONLY when a stash record actually exists to drop (a stash
   * client's entry can be present-in-file AND still stashed when an earlier
   * enable's config write succeeded but its state.json update failed — the
   * config-write-succeeded-but-writeState-failed warning path): without
   * this, the stale stash record survives a re-run enable forever (the
   * early no-op return never reached `updateState`).
   */
  updateStateOnNoop?: boolean;
  options: EngineOptions;
}

/** The shared pipeline: diff → execute EXACTLY the rendered edit → safety
 * write → state update. */
function runEdit(args: RunEditArgs): EngineResult {
  const { ctx, target, action, diffAction, entry, content, options } = args;
  const fs = options.fs ?? REAL_WRITE_FS;
  const now = options.now ?? (() => new Date());
  const diffFn = options.diffFn ?? diff;
  const executeFn = options.executeFn ?? executeNativeEdit;
  const warnings: string[] = [];

  const rendered = diffFn(content, entry, target.adapter, args.scope, diffAction, args.diffOptions);
  if (!rendered.ok) {
    return fail(target.adapter.id, args.scope, action, target.path, rendered.reason);
  }
  if (rendered.native === null) {
    // already-in-state: no write, no backup (idempotent). State normally
    // stays untouched too — except 33-1-R1's narrow opt-in (enable, only
    // when a stash record needs dropping): a config-only no-op there would
    // strand the stale stash forever.
    if (args.updateStateOnNoop && args.updateState) {
      persistState(ctx, fs, target.stateDir, args.updateState(target.state), warnings);
    }
    return {
      ok: true,
      client: target.adapter.id,
      scope: args.scope,
      action,
      path: target.path,
      mechanism: rendered.mechanism,
      changed: false,
      note: "already in the requested state",
      restartHint: target.adapter.restartHint,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  let newContent: string;
  try {
    newContent = executeFn(content ?? "", rendered.native);
  } catch (err) {
    return fail(
      target.adapter.id,
      args.scope,
      action,
      target.path,
      `could not execute the rendered edit for ${target.path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const written = applyWrite(target.path, content, newContent, {
    adapter: target.adapter,
    client: target.adapter.id,
    scope: args.scope,
    stateDir: target.stateDir,
    platform: ctx.platform,
    fs,
    now,
  });
  if (!written.ok) {
    return fail(target.adapter.id, args.scope, action, target.path, written.reason ?? "write failed", {
      ...(written.backupPath !== undefined ? { backupPath: written.backupPath } : {}),
      ...(written.restored !== undefined ? { restored: written.restored } : {}),
      mechanism: rendered.mechanism,
    });
  }

  if (args.updateState) {
    persistState(ctx, fs, target.stateDir, args.updateState(target.state), warnings);
  }

  return {
    ok: true,
    client: target.adapter.id,
    scope: args.scope,
    action,
    path: target.path,
    mechanism: rendered.mechanism,
    changed: true,
    ...(written.backupPath !== undefined ? { backupPath: written.backupPath } : {}),
    restartHint: target.adapter.restartHint,
    ...(warnings.length > 0 ? { warnings } : {}),
  };
}

/**
 * apply: write (add or update) an owned entry into one client's config.
 * `entry` is a canonical entry (see `synthesizeEntry`); `containsSecret`
 * marks explicit-mode entries in the ownership ledger.
 */
export function apply(
  ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  entry: CanonicalEntry,
  options: EngineOptions = {},
): EngineResult {
  const fs = options.fs ?? REAL_WRITE_FS;
  const target = resolveTarget(ctx, client, scope, "apply", fs);
  if ("action" in target) return target;
  const current = readCurrent(fs, target.path);
  if (!current.ok) return fail(client, scope, "apply", target.path, current.reason);

  // Ownership needs presence for non-canonical names (a present foreign
  // entry may never be clobbered; a new one becomes manager-created).
  let existing: RawEntry | undefined;
  if (current.content !== null && current.content.trim() !== "") {
    const parsed = readConfigEntries(target.adapter, current.content);
    if (parsed.ok) existing = ownEntry(parsed.entries, entry.name);
  }
  const present = existing !== undefined;
  const refusal = ownershipRefusal(target.state, client, scope, entry.name, present, target.at);
  if (refusal) return fail(client, scope, "apply", target.path, refusal);

  const now = options.now ?? (() => new Date());
  const containsSecret = options.containsSecret ?? false;
  // A stash recorded before the Copilot move is not enabled; the fresh entry replaces it.
  const record = (state: ManagerState): ManagerState => {
    const recorded = recordManaged(state, { client, scope, name: entry.name, containsSecret, at: target.at }, now());
    const stash = findStash(recorded, client, scope, entry.name, target.at);
    return stash !== undefined && isPreMoveStash(target.adapter, scope, stash.entry)
      ? dropStash(recorded, client, scope, entry.name, target.at)
      : recorded;
  };

  // A shared file: an entry this client does not own alone is adopted when it is exactly what this client would
  // write, and refused otherwise (AD-30). A name that is not in the file is created as ever.
  const shared = sharedVerdict(target, existing, entry);
  if (shared !== null) {
    const { verdict, sharedWith } = shared;
    if (verdict.kind === "conflict") return fail(client, scope, "apply", target.path, verdict.reason, { sharedWith });
    const warnings: string[] = [];
    persistState(ctx, fs, target.stateDir, record(recordAdoptedOwners(target.state, client, scope, entry.name, target.peers, target.at, now(), containsSecret)), warnings);
    const adopted: EngineResult = {
      ok: true,
      client,
      scope,
      action: "apply",
      path: target.path,
      changed: false,
      adopted: true,
      sharedWith,
      note: `adopted: ${target.path} already holds this entry exactly as ${client} would write it (shared with ${sharedWith.join(", ")}); nothing was written`,
      restartHint: target.adapter.restartHint,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
    return withLegacyRemoval(ctx, adopted, [entry.name], options);
  }

  const result = runEdit({
    ctx,
    target,
    scope,
    action: "apply",
    diffAction: "apply",
    entry,
    content: current.content,
    containsSecret,
    updateState: record,
    options,
  });
  return result.ok ? withLegacyRemoval(ctx, result, [entry.name], options) : result;
}

/** enable: re-activate an owned entry — native flag in place for flag
 * clients, splice the stashed entry back byte-exact for stash clients. */
export function enable(
  ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  name: string,
  options: EngineOptions = {},
): EngineResult {
  const fs = options.fs ?? REAL_WRITE_FS;
  const now = options.now ?? (() => new Date());
  const target = resolveTarget(ctx, client, scope, "enable", fs);
  if ("action" in target) return target;
  const current = readCurrent(fs, target.path);
  if (!current.ok) return fail(client, scope, "enable", target.path, current.reason);
  const stash = findStash(target.state, client, scope, name, target.at);
  if (stash !== undefined && isPreMoveStash(target.adapter, scope, stash.entry)) {
    return fail(
      client,
      scope,
      "enable",
      target.path,
      `refusing to enable "${name}": the stashed entry was recorded before ${client} moved to its Copilot files, so it holds \${env:...}, \${input:...} or \${command:...} references the Copilot harness does not forward, or lacks the type and tools keys of a Copilot user entry. ` +
        `The stash is kept; write a fresh entry with: npx -y -p ${pinnedSpec("@iris-mcp/client-config")} iris-mcp-clients apply --client ${client} --scope ${scope} --servers ${name}`,
    );
  }
  if (current.content === null) {
    return noopMissingFile(client, scope, "enable", target.path, target.adapter);
  }
  const refusal = ownershipRefusal(target.state, client, scope, name, true, target.at);
  if (refusal) return fail(client, scope, "enable", target.path, refusal);
  // In a shared file an enable records this client for the file, and an enable that adopts the other client's equal
  // entry also records that client's implied ownership, so neither client can later overwrite the entry unrefused.
  let adopting = false;
  if (stash !== undefined && target.peers.length > 0) {
    const parsed = readConfigEntries(target.adapter, current.content);
    const existing = parsed.ok ? ownEntry(parsed.entries, name) : undefined;
    if (existing !== undefined && !soleOwner(target.state, client, scope, name, target.peers, target.at)) {
      const verdict = adoptOrConflict({
        existing,
        wouldWrite: stash.entry,
        path: target.path,
        name,
        client,
        owners: ownerClients(target.state, client, scope, name, target.peers, target.at),
      });
      if (verdict.kind === "conflict") {
        return fail(client, scope, "enable", target.path, verdict.reason, {
          sharedWith: otherOwners(target.state, client, scope, name, target.peers, target.at),
        });
      }
      adopting = true;
    }
  }
  const diffOptions: DiffOptions | undefined = stash ? { nativeEntry: stash.entry } : undefined;
  if (!target.adapter.nativeDisableFlag && !stash) {
    // Stash client, entry absent, nothing stashed: distinguish "already
    // enabled" (present) from "nothing to enable" (absent, never stashed).
    const parsed = readConfigEntries(target.adapter, current.content);
    if (parsed.ok && ownEntry(parsed.entries, name) === undefined) {
      return fail(client, scope, "enable", target.path, `entry "${name}" is not present and no disabled entry is stashed; nothing to enable`);
    }
  }

  return runEdit({
    ctx,
    target,
    scope,
    action: "enable",
    diffAction: "enable",
    entry: stubEntry(name),
    content: current.content,
    ...(diffOptions !== undefined ? { diffOptions } : {}),
    updateState: (state) => {
      // The flag comes from this file's record (or one without a path), never from another project's.
      const prior = state.entries.find(
        (r) => r.client === client && r.scope === scope && r.name === name && (r.path === undefined || samePath(target.at.platform, r.path, target.at.path)),
      );
      const containsSecret = prior?.containsSecret ?? true;
      // In a shared file an enable that adopts, or puts the stash back, makes this client an owner of the entry for this
      // file, exactly as `apply` does. The other owners are worked out before this client's own record exists (see
      // `recordAdoptedOwners`), so a later different write by either client is refused.
      if (target.peers.length === 0 || (!adopting && stash === undefined)) return dropStash(state, client, scope, name, target.at);
      const owned = recordAdoptedOwners(state, client, scope, name, target.peers, target.at, now(), containsSecret);
      const next = dropStash(owned, client, scope, name, target.at);
      // A record already naming this file is left as it is.
      const recordedHere = next.entries.some(
        (r) => r.client === client && r.scope === scope && r.name === name && r.path !== undefined && samePath(target.at.platform, r.path, target.at.path),
      );
      return recordedHere ? next : recordManaged(next, { client, scope, name, containsSecret, at: target.at }, now());
    },
    // 33-1-R1: a no-op enable (entry already present in the file) still
    // must drop a STALE stash record when one exists — only fires when
    // `stash` was actually found above, so the common no-op (nothing
    // stashed) stays a true zero-write, zero-state-touch idempotent return.
    updateStateOnNoop: stash !== undefined,
    options: { ...options, now },
  });
}

/** disable: native flag in place for flag clients; stash the entry
 * byte-preserved into state.json + remove it from the file for stash
 * clients. */
export function disable(
  ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  name: string,
  options: EngineOptions = {},
): EngineResult {
  const fs = options.fs ?? REAL_WRITE_FS;
  const now = options.now ?? (() => new Date());
  const target = resolveTarget(ctx, client, scope, "disable", fs);
  if ("action" in target) return target;
  const current = readCurrent(fs, target.path);
  if (!current.ok) return fail(client, scope, "disable", target.path, current.reason);
  if (current.content === null) {
    return noopMissingFile(client, scope, "disable", target.path, target.adapter);
  }
  const refusal = ownershipRefusal(target.state, client, scope, name, true, target.at);
  if (refusal) return fail(client, scope, "disable", target.path, refusal);

  // For a stash client the entry is captured BEFORE the write: the parsed
  // native entry, exactly as it sat in the file (spec §3.4 stash shape).
  let stashEntry: RawEntry | undefined;
  if (!target.adapter.nativeDisableFlag) {
    const parsed = readConfigEntries(target.adapter, current.content);
    if (parsed.ok) stashEntry = ownEntry(parsed.entries, name);
  }

  const result = runEdit({
    ctx,
    target,
    scope,
    action: "disable",
    diffAction: "disable",
    entry: stubEntry(name),
    content: current.content,
    updateState: (state) =>
      stashEntry ? addStash(state, { client, scope, name, entry: stashEntry, at: target.at }, now()) : state,
    options: { ...options, now },
  });
  return withSharedNote(result, target, name);
}

/** remove: purge an owned entry from the file entirely (plus its stash and
 * ownership records). */
export function remove(
  ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  name: string,
  options: EngineOptions = {},
): EngineResult {
  const result = removeFromTarget(ctx, client, scope, name, options);
  return result.ok ? withLegacyRemoval(ctx, result, [name], options) : result;
}

function removeFromTarget(
  ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  name: string,
  options: EngineOptions,
): EngineResult {
  const fs = options.fs ?? REAL_WRITE_FS;
  const target = resolveTarget(ctx, client, scope, "remove", fs);
  if ("action" in target) return target;
  const current = readCurrent(fs, target.path);
  if (!current.ok) return fail(client, scope, "remove", target.path, current.reason);
  const refusal = ownershipRefusal(target.state, client, scope, name, true, target.at);
  if (refusal) return fail(client, scope, "remove", target.path, refusal);
  if (current.content === null) {
    // No file: nothing to remove from disk, but purge state records.
    const next = dropRemovedShared(target.state, client, scope, name, target.peers, target.at);
    const warnings: string[] = [];
    persistState(ctx, fs, target.stateDir, next, warnings);
    return withSharedNote(
      {
        ok: true,
        client,
        scope,
        action: "remove",
        path: target.path,
        changed: false,
        note: "config file does not exist; state records purged",
        ...(warnings.length > 0 ? { warnings } : {}),
      },
      target,
      name,
    );
  }

  // Entry absent from a parseable file (e.g. currently stashed after a
  // disable): diff would render already-in-state — but remove's contract
  // purges the stash + ownership records TOO. A retained stash would
  // resurrect the entry on a later enable (33.1 review HIGH, probe-verified:
  // apply → disable → remove → enable brought the "removed" server back).
  {
    const parsed = readConfigEntries(target.adapter, current.content);
    if (parsed.ok && ownEntry(parsed.entries, name) === undefined) {
      const next = dropRemovedShared(target.state, client, scope, name, target.peers, target.at);
      const warnings: string[] = [];
      persistState(ctx, fs, target.stateDir, next, warnings);
      return withSharedNote(
        {
          ok: true,
          client,
          scope,
          action: "remove",
          path: target.path,
          changed: false,
          note: "entry not present in the file; state records purged",
          ...(warnings.length > 0 ? { warnings } : {}),
        },
        target,
        name,
      );
    }
  }

  return withSharedNote(
    runEdit({
      ctx,
      target,
      scope,
      action: "remove",
      diffAction: "remove",
      entry: stubEntry(name),
      content: current.content,
      updateState: (state) => dropRemovedShared(state, client, scope, name, target.peers, target.at),
      options,
    }),
    target,
    name,
  );
}

/** restore: restore the latest (or a named) timestamped backup of one
 * client's config file. */
export function restore(
  ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  options: EngineOptions & { backup?: string } = {},
): EngineResult {
  const fs = options.fs ?? REAL_WRITE_FS;
  const target = resolveTarget(ctx, client, scope, "restore", fs);
  if ("action" in target) return target;
  const result = restoreBackup(target.path, {
    adapter: target.adapter,
    client: target.adapter.id,
    scope,
    stateDir: target.stateDir,
    platform: ctx.platform,
    ...(options.backup !== undefined ? { backup: options.backup } : {}),
    fs,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  if (!result.ok) {
    return fail(client, scope, "restore", target.path, result.reason ?? "restore failed", {
      ...(result.backupPath !== undefined ? { backupPath: result.backupPath } : {}),
      ...(result.restored !== undefined ? { restored: result.restored } : {}),
    });
  }
  // A restore rolls back the whole file, so in a shared file it names the other readers, as a disable or remove does:
  // always for a client that never wrote the file before it was shared, and for a pre-sharing writer once a peer has records.
  const recordingPeers = peerClients(peersRecordingFile(target.state, target.peers, target.at));
  const others = PRE_SHARING_WRITERS.includes(target.adapter.id) ? recordingPeers : peerClients(target.peers);
  return {
    ok: true,
    client,
    scope,
    action: "restore",
    path: target.path,
    changed: true,
    ...(result.backupPath !== undefined ? { backupPath: result.backupPath } : {}),
    restartHint: target.adapter.restartHint,
    note: `restored from ${result.restoredFrom ?? "backup"}`,
    ...(others.length > 0 ? { sharedWith: others, sharedNote: sharedFileNote(target.path, others) } : {}),
  };
}

// ════════════════════════════════════════════════════════════════════
// Legacy files (Story 44.2): the old VS Code Local-harness `mcp.json` files. They are read-only sources
// for status and doctor; the only write ever made to one is the removal of an owned entry, through the
// same protocol, after the new file's write has re-parsed clean.
// ════════════════════════════════════════════════════════════════════

/**
 * One existing legacy file of an adapter scope that an apply or remove of some names touches: either the owned
 * entries among those names that it holds, or why it cannot be read or parsed.
 */
type LegacyTarget =
  | { path: string; view: ClientAdapter; error: string; unparseable: boolean }
  | { path: string; view: ClientAdapter; content: string; present: string[] };

/**
 * The legacy files of one adapter scope that hold an owned entry among `names`, plus every one that cannot be read
 * or parsed. Owned in an old file means a canonical iris-mcp name: the only names the manager wrote there.
 */
function legacyTargets(ctx: EngineHostContext, adapter: ClientAdapter, scope: ClientScope, names: readonly string[], fs: WriteFs): LegacyTarget[] {
  const out: LegacyTarget[] = [];
  for (const def of adapter.legacyScopes ?? []) {
    if (def.scope !== scope) continue;
    const path = resolveLegacyPath(adapter, def, ctx);
    if (path === null) continue;
    let exists = false;
    try {
      exists = fs.exists(path);
    } catch {
      exists = false;
    }
    if (!exists) continue;
    const view = legacyAdapterView(adapter, def);
    let content: string;
    try {
      content = fs.readFile(path);
    } catch (err) {
      out.push({ path, view, error: `could not read ${path}: ${err instanceof Error ? err.message : String(err)}`, unparseable: false });
      continue;
    }
    const parsed = readConfigEntries(view, content);
    if (!parsed.ok) {
      out.push({ path, view, error: `${path} is unparseable (${parsed.error})`, unparseable: true });
      continue;
    }
    const present = names.filter((name) => isCanonicalName(name) && ownEntry(parsed.entries, name) !== undefined);
    if (present.length > 0) out.push({ path, view, content, present });
  }
  return out;
}

/** What `previewLegacyRemoval` says an apply or remove will take out of one legacy file. */
export interface LegacyPreview {
  path: string;
  /** The owned entry names the run removes from the file. */
  names: string[];
  /** The rendered removal diff (the same renderer as every other preview). */
  text: string;
  /** Set when the file could not be read or parsed: nothing can be removed from it. */
  error?: string;
}

/**
 * The pending removal of owned entries from the adapter's legacy files for one scope: for the preview an
 * `apply` prints. A file with no owned entry among `names` is not listed. Pure reads.
 */
export function previewLegacyRemoval(
  ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  names: readonly string[],
  options: { fs?: WriteFs } = {},
): LegacyPreview[] {
  const adapter = CLIENT_ADAPTERS[client];
  if (adapter?.legacyScopes === undefined) return [];
  const fs = options.fs ?? REAL_WRITE_FS;
  const previews: LegacyPreview[] = [];
  for (const file of legacyTargets(ctx, adapter, scope, names, fs)) {
    if ("error" in file) {
      previews.push({ path: file.path, names: [], text: "", error: file.error });
      continue;
    }
    let current = file.content;
    const texts: string[] = [];
    let error: string | undefined;
    for (const name of file.present) {
      const rendered = diff(current, stubEntry(name), file.view, scope, "remove");
      if (!rendered.ok || rendered.native === null) {
        error = rendered.ok ? `could not render the removal of "${name}"` : rendered.reason;
        break;
      }
      texts.push(rendered.text);
      try {
        current = executeNativeEdit(current, rendered.native);
      } catch (err) {
        error = `could not preview the removal of "${name}": ${err instanceof Error ? err.message : String(err)}`;
        break;
      }
    }
    previews.push({ path: file.path, names: file.present, text: texts.join("\n"), ...(error !== undefined ? { error } : {}) });
  }
  return previews;
}

/**
 * After a successful apply or remove of `names`, take the owned entries out of the adapter's legacy files for
 * that scope, each through the write protocol (validate, backup, edit, re-parse, restore on failure). The
 * caller's own write has already re-parsed clean, so a failure here leaves the new entry in place and the old
 * entry where it was; the record says which. The result is returned unchanged when no legacy file holds an
 * owned entry, so an adapter without legacy files (every one but `vscode`) is untouched.
 */
function withLegacyRemoval(
  ctx: EngineHostContext,
  result: EngineResult,
  names: readonly string[],
  options: EngineOptions,
): EngineResult {
  const adapter = CLIENT_ADAPTERS[result.client];
  if (adapter?.legacyScopes === undefined) return result;
  const fs = options.fs ?? REAL_WRITE_FS;
  const now = options.now ?? (() => new Date());
  const executeFn = options.executeFn ?? executeNativeEdit;
  const legacy: LegacyRemoval[] = [];
  for (const file of legacyTargets(ctx, adapter, result.scope, names, fs)) {
    if ("error" in file) {
      const reason = file.unparseable ? `${file.error}; the entry is still in the old file` : file.error;
      legacy.push({ path: file.path, ok: false, changed: false, removed: [], reason });
      continue;
    }
    const record: LegacyRemoval = { path: file.path, ok: true, changed: false, removed: [] };
    let current = file.content;
    for (const name of file.present) {
      const rendered = diff(current, stubEntry(name), file.view, result.scope, "remove");
      if (!rendered.ok || rendered.native === null) {
        record.ok = false;
        record.reason = `could not render the removal of "${name}" from ${file.path}${rendered.ok ? "" : `: ${rendered.reason}`}; it is still in the old file`;
        break;
      }
      let next: string;
      try {
        next = executeFn(current, rendered.native);
      } catch (err) {
        record.ok = false;
        record.reason = `could not execute the removal of "${name}" from ${file.path}: ${err instanceof Error ? err.message : String(err)}; it is still in the old file`;
        break;
      }
      const written = applyWrite(file.path, current, next, {
        adapter: file.view,
        client: `${adapter.id}-legacy`,
        scope: result.scope,
        stateDir: resolveStateDir(ctx),
        platform: ctx.platform,
        fs,
        now,
      });
      if (written.backupPath !== undefined) record.backupPath = written.backupPath;
      if (!written.ok) {
        record.ok = false;
        record.reason = `could not remove "${name}" from ${file.path}: ${written.reason ?? "write failed"}; it is still in the old file`;
        if (written.restored !== undefined) record.restored = written.restored;
        break;
      }
      current = next;
      record.removed.push(name);
      record.changed = true;
    }
    legacy.push(record);
  }
  if (legacy.length === 0) return result;
  const failures = legacy.filter((record) => !record.ok).map((record) => record.reason ?? `could not update ${record.path}`);
  return {
    ...result,
    legacy,
    ...(failures.length > 0 ? { warnings: [...(result.warnings ?? []), ...failures] } : {}),
  };
}

function noopMissingFile(
  client: string,
  scope: ClientScope,
  action: EngineAction,
  path: string,
  adapter: ClientAdapter,
): EngineResult {
  return {
    ok: true,
    client,
    scope,
    action,
    path,
    changed: false,
    note: `config file does not exist; nothing to ${action}`,
    restartHint: adapter.restartHint,
  };
}
