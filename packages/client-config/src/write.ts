/**
 * `@iris-mcp/client-config` — write executors + the universal safety protocol
 * (Epic 33, Story 33.1; AC 33.1.1 + AC 33.1.2).
 *
 * Two layers:
 *
 * 1. `executeNativeEdit(content, native)` — the PURE executor for the
 *    `NativeEdit` descriptors Story 33.0's `diff()` renders (the Rule #52
 *    seam closing, AC 33.1-I1): jsonc-parser `applyEdits` for JSON/JSONC,
 *    text-level line splices bounded to owned `[<rootKey>.<name>]` tables for
 *    TOML, the `yaml` Document API for YAML. `native: null` returns the
 *    content byte-identical (the already-in-state no-op).
 *
 * 2. `applyWrite` — the 6-point universal safety protocol around every file
 *    mutation (spec §3.5): pre-parse validate (refuse before touching an
 *    already-unparseable file) → timestamped backup under
 *    `<stateDir>/backups/<client>/<scope>/<file>.<ts>` → write → re-read and
 *    re-parse → on post-write parse failure auto-restore the backup and
 *    report. `restoreBackup`/`listBackups` expose the backup surface.
 *
 * No config content is ever logged or returned in reasons (spec §3.5.5 —
 * foreign entries may hold third-party secrets): reasons name the path and
 * the parse reason only. Everything (fs surface, clock) is injectable; this
 * module never reads `process.*`.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { applyEdits } from "jsonc-parser";
import { parseDocument } from "yaml";

import { readConfigEntries } from "./readers.js";
import type { NativeEdit, TomlNativeEdit, YamlNativeEdit } from "./diff.js";
import type { AdapterPlatform, ClientAdapter, ClientScope } from "./types.js";

/** Injectable filesystem surface for the write engine. */
export interface WriteFs {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  /** Recursive mkdir (idempotent — no error when the directory exists). */
  mkdir(dir: string): void;
  remove(path: string): void;
  /** Entry names in a directory (throws when the directory does not exist). */
  listDir(dir: string): string[];
}

/** Default fs surface (the real filesystem). */
export const REAL_WRITE_FS: WriteFs = {
  exists: existsSync,
  readFile: (p) => readFileSync(p, "utf8"),
  writeFile: (p, content) => writeFileSync(p, content, "utf8"),
  mkdir: (dir) => mkdirSync(dir, { recursive: true }),
  remove: (p) => rmSync(p),
  listDir: (dir) => readdirSync(dir),
};

/** Join state-dir segments with the SIMULATED platform's path semantics
 * (the paths.ts discipline — never bare `path`). */
function joinFor(platform: AdapterPlatform, ...segments: string[]): string {
  const p = platform === "win32" ? path.win32 : path.posix;
  return p.join(...segments);
}

/** The result of one safety-protocol write. `reason` names the path and the
 * parse reason only — never file content. */
export interface WriteResult {
  ok: boolean;
  path: string;
  /** Absolute path of the timestamped backup taken before the write (absent
   * when the file did not exist beforehand — there was nothing to back up). */
  backupPath?: string;
  /** True when a post-write parse failure auto-restored the prior state. */
  restored?: boolean;
  reason?: string;
}

/**
 * Execute one rendered `NativeEdit` against `content`. Pure: no fs, no clock.
 * `native: null` (already-in-state) returns the content byte-identical.
 *
 * TOML splice mechanics (the write engine owns execution; the descriptor is
 * data): "insert" adds one separator blank line above the new block (none
 * for an empty document); "remove-region" drops the region lines and then
 * collapses exactly one adjacent blank line when the removal created a
 * blank/blank or blank/EOF or blank/header adjacency — making insert → remove
 * a byte-exact inverse (the AC 33.1.3 golden round-trip) without ever
 * touching a non-blank line.
 */
export function executeNativeEdit(content: string, native: NativeEdit | null): string {
  if (native === null) return content;
  switch (native.kind) {
    case "jsonc":
      return applyEdits(content, native.edits);
    case "toml-splice":
      return executeTomlSplice(content, native);
    case "yaml-cst":
      return executeYamlOp(content, native);
  }
}

function executeTomlSplice(content: string, edit: TomlNativeEdit): string {
  const lines = content.split("\n");
  switch (edit.op) {
    case "insert": {
      const block = (edit.insertText ?? "").split("\n");
      if (content.trim() === "") return block.join("\n") + "\n";
      const at = (edit.insertAfterLine ?? -1) + 1;
      lines.splice(at, 0, "", ...block);
      return lines.join("\n");
    }
    case "replace-region": {
      if (!edit.region) throw new Error("toml replace-region descriptor is missing its region");
      const count = edit.region.endLine - edit.region.startLine + 1;
      lines.splice(edit.region.startLine, count, ...(edit.insertText ?? "").split("\n"));
      return lines.join("\n");
    }
    case "remove-region": {
      if (!edit.region) throw new Error("toml remove-region descriptor is missing its region");
      const count = edit.region.endLine - edit.region.startLine + 1;
      lines.splice(edit.region.startLine, count);
      const at = edit.region.startLine;
      const before = lines[at - 1];
      const after = lines[at];
      if (
        before !== undefined &&
        before.trim() === "" &&
        (after === undefined || after.trim() === "" || /^\s*\[/.test(after))
      ) {
        lines.splice(at - 1, 1);
      }
      return lines.join("\n");
    }
    case "set-flag": {
      const flagLine = edit.insertText ?? "";
      if (edit.region) {
        lines.splice(edit.region.startLine, edit.region.endLine - edit.region.startLine + 1, flagLine);
      } else {
        const at = (edit.insertAfterLine ?? -1) + 1;
        lines.splice(at, 0, flagLine);
      }
      return lines.join("\n");
    }
    case "merge-update": {
      // AC 33.5.2 apply-update surgery: apply the disjoint line spans
      // BOTTOM-UP so earlier spans' line numbers stay valid. A span with
      // endLine < startLine is a pure insert at startLine.
      if (!edit.spans) throw new Error("toml merge-update descriptor is missing its spans");
      const ordered = [...edit.spans].sort((a, b) => b.startLine - a.startLine);
      for (const span of ordered) {
        const count = Math.max(0, span.endLine - span.startLine + 1);
        lines.splice(span.startLine, count, ...span.lines);
      }
      return lines.join("\n");
    }
  }
}

function executeYamlOp(content: string, edit: YamlNativeEdit): string {
  const doc = parseDocument(content);
  if (doc.errors.length > 0) {
    // Unreachable through the engine (diff parse-validates first); defensive
    // for direct executor consumers. Names the parse reason only.
    throw new Error(`cannot execute a YAML edit on an unparseable document: ${doc.errors[0]?.message ?? "unknown"}`);
  }
  if (edit.op === "delete") {
    doc.deleteIn(edit.path);
  } else if (edit.op === "merge-update") {
    // Story 33.5 QA: per-key sets — only changed keys are touched, so
    // comments and formatting on the entry's other lines survive (a
    // whole-entry set re-rendered the subtree and dropped interior comments).
    for (const op of edit.ops ?? []) {
      doc.setIn(op.path, doc.createNode(op.value));
    }
  } else {
    doc.setIn(edit.path, doc.createNode(edit.value));
  }
  return doc.toString();
}

export interface ApplyWriteOptions {
  adapter: ClientAdapter;
  client: string;
  scope: ClientScope;
  stateDir: string;
  platform: AdapterPlatform;
  fs?: WriteFs;
  /** Injectable clock (timestamped backups need deterministic tests). */
  now?: () => Date;
  /** INTERNAL — restoreBackup only: skip the pre-parse validation of the
   * CURRENT file. Restore is the disaster-recovery surface; it must be able
   * to overwrite a file too broken to parse (the broken bytes are still
   * backed up first, and the restored bytes are re-parsed after the write).
   * Never set for surgical edits (apply/enable/disable/remove), where an
   * unparseable file must stay a refusal. */
  skipPreParse?: boolean;
}

/** Filesystem-safe timestamp: ISO 8601 with `:` and `.` flattened (Windows). */
function stamp(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

/** The directory a scope's backups live in. */
export function backupDir(stateDir: string, client: string, scope: ClientScope, platform: AdapterPlatform): string {
  return joinFor(platform, stateDir, "backups", client, scope);
}

/** The backup path for one write: `<stateDir>/backups/<client>/<scope>/<basename>.<ts>`.
 * The `<scope>` segment extends spec §3.5's `<client>/<file>.<ts>` shape —
 * recorded deviation: Codex's user and project scopes share the basename
 * `config.toml`, so client-only bucketing would interleave two files'
 * backups. */
export function backupPathFor(
  stateDir: string,
  client: string,
  scope: ClientScope,
  filePath: string,
  platform: AdapterPlatform,
  now: Date,
): string {
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  return joinFor(platform, backupDir(stateDir, client, scope, platform), `${base}.${stamp(now)}`);
}

/**
 * The universal safety protocol around one config-file write (AC 33.1.2).
 * `content` is the file's current text (`null` = the file does not exist —
 * no backup is taken and an auto-restore deletes the written file).
 *
 * Never throws on I/O or parse failure: every failure is a typed
 * `{ok:false, reason}` result naming the path and reason only.
 */
export function applyWrite(
  path: string,
  content: string | null,
  newContent: string,
  options: ApplyWriteOptions,
): WriteResult {
  const fs = options.fs ?? REAL_WRITE_FS;
  const now = options.now ?? (() => new Date());

  // (1) Pre-parse validate — refuse before touching an already-unparseable
  // file (no backup, no write). Skipped ONLY by restoreBackup: restore is the
  // disaster-recovery surface, and refusing to restore over the broken file
  // it exists to recover would leave the user with no manager-side way back
  // (QA 33.1: confirmed live — restore refused with the file left broken).
  // The broken bytes are still backed up below before the good ones land.
  if (!options.skipPreParse && content !== null && content.trim() !== "") {
    const pre = readConfigEntries(options.adapter, content);
    if (!pre.ok) {
      return { ok: false, path, reason: `refusing to modify ${path}: the existing file is unparseable (${pre.error})` };
    }
  }

  // (2) Timestamped backup before every write (only when there is something
  // to back up).
  let backupPath: string | undefined;
  if (content !== null) {
    backupPath = backupPathFor(options.stateDir, options.client, options.scope, path, options.platform, now());
    try {
      fs.mkdir(backupDir(options.stateDir, options.client, options.scope, options.platform));
      fs.writeFile(backupPath, content);
    } catch (err) {
      return {
        ok: false,
        path,
        reason: `could not take a backup of ${path} before writing: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // (3) The write itself (parent directories created as needed — an apply
  // may create a brand-new config file).
  try {
    const parent = path.split(/[\\/]/).slice(0, -1).join("/");
    if (parent !== "") fs.mkdir(parent);
    fs.writeFile(path, newContent);
  } catch (err) {
    return { ok: false, path, ...(backupPath !== undefined ? { backupPath } : {}), reason: `write failed for ${path}: ${err instanceof Error ? err.message : String(err)}` };
  }

  // (4) Re-read and re-parse the WRITTEN bytes; (5) on parse failure
  // auto-restore the prior state and report (never leave a broken file).
  let written: string;
  try {
    written = fs.readFile(path);
  } catch (err) {
    return {
      ok: false,
      path,
      ...(backupPath !== undefined ? { backupPath } : {}),
      reason: `could not re-read ${path} after writing: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const post = readConfigEntries(options.adapter, written);
  if (!post.ok) {
    try {
      if (content !== null) {
        fs.writeFile(path, content);
      } else {
        fs.remove(path);
      }
    } catch (err) {
      return {
        ok: false,
        path,
        ...(backupPath !== undefined ? { backupPath } : {}),
        reason: `post-write parse failure on ${path} (${post.error}) AND the auto-restore failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    return {
      ok: false,
      path,
      ...(backupPath !== undefined ? { backupPath } : {}),
      restored: true,
      reason: `post-write parse failure on ${path} (${post.error}); the prior state was restored`,
    };
  }

  return { ok: true, path, ...(backupPath !== undefined ? { backupPath } : {}) };
}

export interface RestoreOptions {
  adapter: ClientAdapter;
  client: string;
  scope: ClientScope;
  stateDir: string;
  platform: AdapterPlatform;
  /** Restore this backup (basename, e.g. `config.toml.2026-07-27T14-03-22-123Z`);
   * default: the latest. */
  backup?: string;
  fs?: WriteFs;
  now?: () => Date;
}

/**
 * List the backups for one config file, oldest first (the ISO timestamp in
 * the filename sorts chronologically). Returns absolute paths.
 *
 * Only files matching the manager's own timestamped naming
 * `<basename>.<YYYY-MM-DD>T<HH-MM-SS-mmm>Z` count as backups: a stray file
 * sharing the basename prefix (e.g. `config.toml.zzz-notes`) must never be
 * picked as "the latest backup" — it sorts after every ISO stamp and would
 * otherwise be silently restored over the real config (QA 33.1: confirmed
 * live with a planted non-timestamp file).
 */
export function listBackups(path: string, options: RestoreOptions): string[] {
  const fs = options.fs ?? REAL_WRITE_FS;
  const dir = backupDir(options.stateDir, options.client, options.scope, options.platform);
  const base = path.split(/[\\/]/).pop() ?? path;
  const backupName = new RegExp(
    `^${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z$`,
  );
  let names: string[];
  try {
    names = fs.listDir(dir);
  } catch {
    return [];
  }
  return names
    .filter((name) => backupName.test(name))
    .sort()
    .map((name) => joinFor(options.platform, dir, name));
}

/**
 * Restore the latest (or a named) backup for one config file. The restore is
 * itself a safety-protocol write: the pre-restore file is backed up first
 * and the restored bytes are re-parsed. Refuses when no backup exists.
 *
 * Unlike every other write, restore does NOT pre-parse-validate the CURRENT
 * file: recovering a config too broken to parse is exactly what restore is
 * for (the broken bytes are still backed up before the overwrite).
 */
export function restoreBackup(path: string, options: RestoreOptions): WriteResult & { restoredFrom?: string } {
  const fs = options.fs ?? REAL_WRITE_FS;
  const candidates = listBackups(path, options);
  if (candidates.length === 0) {
    return { ok: false, path, reason: `no backups found for ${path}` };
  }
  let chosen: string | undefined;
  if (options.backup !== undefined) {
    chosen = candidates.find((candidate) => (candidate.split(/[\\/]/).pop() ?? candidate) === options.backup);
    if (!chosen) {
      return { ok: false, path, reason: `no backup named "${options.backup}" found for ${path}` };
    }
  } else {
    chosen = candidates[candidates.length - 1];
  }
  if (chosen === undefined) {
    return { ok: false, path, reason: `no backups found for ${path}` };
  }
  let content: string;
  try {
    content = fs.readFile(chosen);
  } catch (err) {
    return { ok: false, path, reason: `could not read the backup for ${path}: ${err instanceof Error ? err.message : String(err)}` };
  }
  let current: string | null;
  try {
    current = fs.exists(path) ? fs.readFile(path) : null;
  } catch (err) {
    // The restore surface never throws on I/O (33.1 review: an unreadable
    // CURRENT config — EACCES/EBUSY on the recovery path — escaped as an
    // exception instead of a typed refusal).
    return { ok: false, path, reason: `could not read the current ${path} before restoring: ${err instanceof Error ? err.message : String(err)}` };
  }
  const result = applyWrite(path, current, content, { ...options, skipPreParse: true });
  return { ...result, restoredFrom: chosen };
}
