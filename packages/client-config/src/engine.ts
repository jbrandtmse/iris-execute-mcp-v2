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
 * Results name paths and reasons only — never config content (spec §3.5.5).
 * Everything is injectable (fs, clock, stateDir, and — for the AC 33.1-I1
 * spy test — the diff/execute seams); no `process.*` reads.
 */

import { applyEdits, parse as parseJsonc, type ParseError } from "jsonc-parser";

import { CLIENT_ADAPTERS } from "./adapters.js";
import { diff, insertionEdits, type DiffMechanism, type DiffOptions } from "./diff.js";
import { resolveScopePath } from "./paths.js";
import { ownEntry, readConfigEntries, type RawEntry } from "./readers.js";
import type { VscodeInput } from "./synthesize.js";
import {
  addStash,
  dropManaged,
  dropStash,
  findStash,
  isManagerCreated,
  readState,
  recordManaged,
  resolveStateDir,
  writeState,
  type EngineHostContext,
  type ManagerState,
} from "./state.js";
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
  path: string;
  stateDir: string;
  state: ManagerState;
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
  const stateDir = resolveStateDir(ctx);
  const state = readState(fs, stateDir, ctx.platform);
  if (!state.ok) {
    return fail(client, scope, action, path, state.error);
  }
  return { adapter, path, stateDir, state: state.state };
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
): string | null {
  if (isCanonicalName(name)) return null;
  if (isManagerCreated(state, client, scope, name)) return null;
  if (findStash(state, client, scope, name)) return null;
  if (!present) return null; // creation is how an entry becomes manager-created
  return (
    `refusing to modify "${name}": the name is outside the iris-mcp namespace ` +
    `(it is not one of ${CANONICAL_SERVERS.join(", ")}) and state.json does not record it as manager-created`
  );
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
    // already-in-state: no write, no backup, no state change (idempotent).
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
  let present = false;
  if (current.content !== null && current.content.trim() !== "") {
    const parsed = readConfigEntries(target.adapter, current.content);
    if (parsed.ok) present = ownEntry(parsed.entries, entry.name) !== undefined;
  }
  const refusal = ownershipRefusal(target.state, client, scope, entry.name, present);
  if (refusal) return fail(client, scope, "apply", target.path, refusal);

  const now = options.now ?? (() => new Date());
  return runEdit({
    ctx,
    target,
    scope,
    action: "apply",
    diffAction: "apply",
    entry,
    content: current.content,
    containsSecret: options.containsSecret ?? false,
    updateState: (state) =>
      recordManaged(state, { client, scope, name: entry.name, containsSecret: options.containsSecret ?? false }, now()),
    options,
  });
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
  if (current.content === null) {
    return noopMissingFile(client, scope, "enable", target.path, target.adapter);
  }
  const refusal = ownershipRefusal(target.state, client, scope, name, true);
  if (refusal) return fail(client, scope, "enable", target.path, refusal);

  const stash = findStash(target.state, client, scope, name);
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
    updateState: (state) => dropStash(state, client, scope, name),
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
  const refusal = ownershipRefusal(target.state, client, scope, name, true);
  if (refusal) return fail(client, scope, "disable", target.path, refusal);

  // For a stash client the entry is captured BEFORE the write: the parsed
  // native entry, exactly as it sat in the file (spec §3.4 stash shape).
  let stashEntry: RawEntry | undefined;
  if (!target.adapter.nativeDisableFlag) {
    const parsed = readConfigEntries(target.adapter, current.content);
    if (parsed.ok) stashEntry = ownEntry(parsed.entries, name);
  }

  return runEdit({
    ctx,
    target,
    scope,
    action: "disable",
    diffAction: "disable",
    entry: stubEntry(name),
    content: current.content,
    updateState: (state) =>
      stashEntry ? addStash(state, { client, scope, name, entry: stashEntry }, now()) : state,
    options: { ...options, now },
  });
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
  const fs = options.fs ?? REAL_WRITE_FS;
  const target = resolveTarget(ctx, client, scope, "remove", fs);
  if ("action" in target) return target;
  const current = readCurrent(fs, target.path);
  if (!current.ok) return fail(client, scope, "remove", target.path, current.reason);
  const refusal = ownershipRefusal(target.state, client, scope, name, true);
  if (refusal) return fail(client, scope, "remove", target.path, refusal);
  if (current.content === null) {
    // No file: nothing to remove from disk, but purge state records.
    const next = dropStash(dropManaged(target.state, client, scope, name), client, scope, name);
    const warnings: string[] = [];
    persistState(ctx, fs, target.stateDir, next, warnings);
    return {
      ok: true,
      client,
      scope,
      action: "remove",
      path: target.path,
      changed: false,
      note: "config file does not exist; state records purged",
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  }

  // Entry absent from a parseable file (e.g. currently stashed after a
  // disable): diff would render already-in-state — but remove's contract
  // purges the stash + ownership records TOO. A retained stash would
  // resurrect the entry on a later enable (33.1 review HIGH, probe-verified:
  // apply → disable → remove → enable brought the "removed" server back).
  {
    const parsed = readConfigEntries(target.adapter, current.content);
    if (parsed.ok && ownEntry(parsed.entries, name) === undefined) {
      const next = dropStash(dropManaged(target.state, client, scope, name), client, scope, name);
      const warnings: string[] = [];
      persistState(ctx, fs, target.stateDir, next, warnings);
      return {
        ok: true,
        client,
        scope,
        action: "remove",
        path: target.path,
        changed: false,
        note: "entry not present in the file; state records purged",
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }
  }

  return runEdit({
    ctx,
    target,
    scope,
    action: "remove",
    diffAction: "remove",
    entry: stubEntry(name),
    content: current.content,
    updateState: (state) => dropStash(dropManaged(state, client, scope, name), client, scope, name),
    options,
  });
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

// ════════════════════════════════════════════════════════════════════
// VS Code native `inputs` merge (Story 33.2 — the seam 33.1's review
// assigned here: synthesizeEntry RETURNS the descriptor; THIS engine op is
// the only writer that merges it into the file's top-level `inputs` array).
// It is engine-side (never CLI-side, AC 33.2-I1) because it is format-aware
// edit logic, and it goes through the SAME applyWrite safety protocol as
// every other write.
// ════════════════════════════════════════════════════════════════════

export interface EnsureInputsResult {
  ok: boolean;
  client: string;
  scope: ClientScope;
  path: string | null;
  /** True when the config file's bytes changed. */
  changed: boolean;
  /** The input ids this call merged (empty when none were missing). */
  added: string[];
  backupPath?: string;
  restartHint?: string;
  reason?: string;
}

/**
 * The ids currently present in a JSON/JSONC document's top-level `inputs`
 * array. Typed boundary mirroring the readers' discipline: an unparseable
 * document (or a non-array `inputs` key) is `{ok:false}`, never a guess.
 */
export function presentInputIds(content: string): { ok: true; ids: string[] } | { ok: false; error: string } {
  if (content.trim() === "") return { ok: true, ids: [] };
  const errors: ParseError[] = [];
  let parsed: unknown;
  try {
    parsed = parseJsonc(content, errors, { allowTrailingComma: true, disallowComments: false });
  } catch (err) {
    return { ok: false, error: `JSON parser threw: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (errors.length > 0) {
    return { ok: false, error: `JSON parse error at offset ${errors[0]?.offset ?? 0}` };
  }
  if (parsed === undefined || parsed === null) return { ok: true, ids: [] };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "top-level JSON value is not an object" };
  }
  const inputs = (parsed as Record<string, unknown>).inputs;
  if (inputs === undefined) return { ok: true, ids: [] };
  if (!Array.isArray(inputs)) {
    return { ok: false, error: `the top-level "inputs" key is not an array` };
  }
  const ids: string[] = [];
  for (const item of inputs) {
    if (typeof item === "object" && item !== null) {
      const id = (item as { id?: unknown }).id;
      if (typeof id === "string") ids.push(id);
    }
  }
  return { ok: true, ids };
}

/**
 * Merge VS Code native `inputs` descriptors into one client's config file —
 * idempotently (a descriptor whose id is already present is left untouched,
 * so a user's customized prompt survives re-applies). Refuses for any
 * adapter whose env expansion is not `vscode` (native inputs are a VS Code
 * concept), and before touching an unparseable file. Every write is an
 * applyWrite safety-protocol write (backup + post-write re-parse).
 */
export function ensureInputs(
  ctx: EngineHostContext,
  client: string,
  scope: ClientScope,
  inputs: VscodeInput[],
  options: EngineOptions = {},
): EnsureInputsResult {
  const fs = options.fs ?? REAL_WRITE_FS;
  const failInputs = (path: string | null, reason: string): EnsureInputsResult => ({
    ok: false,
    client,
    scope,
    path,
    changed: false,
    added: [],
    reason,
  });
  const adapter = CLIENT_ADAPTERS[client];
  if (!adapter) {
    const known = Object.keys(CLIENT_ADAPTERS).join(", ");
    return failInputs(null, `unknown client "${client}" (known clients: ${known})`);
  }
  if (adapter.envExpansion !== "vscode") {
    return failInputs(null, `native inputs are a VS Code concept; ${client} (${adapter.envExpansion} expansion) does not use them`);
  }
  const path = resolveScopePath(adapter, scope, ctx, (p) => fs.exists(p));
  if (path === null) {
    return failInputs(null, `cannot resolve a ${scope}-scope config path for ${client} (project scope requires a projectDir)`);
  }
  const current = readCurrent(fs, path);
  if (!current.ok) return failInputs(path, current.reason);
  const content = current.content ?? "";
  const present = presentInputIds(content);
  if (!present.ok) {
    return failInputs(path, `refusing to modify ${path}: the existing file is unparseable (${present.error})`);
  }
  const missing = inputs.filter((input) => !present.ids.includes(input.id));
  if (missing.length === 0) {
    return {
      ok: true,
      client,
      scope,
      path,
      changed: false,
      added: [],
      restartHint: adapter.restartHint,
    };
  }

  // Append each missing descriptor at the end of the existing array (or
  // create the key) — sequential insert+applyEdits so every edit set is
  // computed against the content it actually targets. The insert is the
  // SURGICAL one (diff.ts): jsonc-parser's own modify() would re-render the
  // user's existing (foreign) input descriptors with hardcoded formatting
  // (the 33.2 lead-smoke byte-preservation defect).
  let next = content;
  for (const descriptor of missing) {
    const soFar = presentInputIds(next);
    const index = soFar.ok ? soFar.ids.length : 0;
    next = applyEdits(next, insertionEdits(next, ["inputs", index], descriptor));
  }

  const now = options.now ?? (() => new Date());
  const written = applyWrite(path, current.content, next, {
    adapter,
    client,
    scope,
    stateDir: resolveStateDir(ctx),
    platform: ctx.platform,
    fs,
    now,
  });
  if (!written.ok) {
    return {
      ...failInputs(path, written.reason ?? "write failed"),
      ...(written.backupPath !== undefined ? { backupPath: written.backupPath } : {}),
    };
  }
  return {
    ok: true,
    client,
    scope,
    path,
    changed: true,
    added: missing.map((input) => input.id),
    ...(written.backupPath !== undefined ? { backupPath: written.backupPath } : {}),
    restartHint: adapter.restartHint,
  };
}
