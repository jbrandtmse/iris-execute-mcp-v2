/**
 * `@iris-mcp/client-config` - applies a skills-pack plan to a project (Story 41.6, AC 41.6.2; AD-30).
 *
 * `preparePackChange` builds the project view over a byte-level file system and plans the change.
 * `executePackPlan` writes it under the same protocol order as the MCP-entry writer (`applyWrite`), run-level:
 *
 *   1. re-read every planned path and refuse if any differs from the plan, or if a link now sits at or above one
 *      (nothing is written);
 *   2. create the missing directories;
 *   3. for each file to write: back up an existing file, write, re-read and compare (a block host is also
 *      re-located: exactly one block, equal to its section, and the bytes outside it as they were before);
 *   4. delete removed files, each with a backup first (the manifest too, when nothing is left to record);
 *   5. remove the recorded directories that are now empty;
 *   6. write the manifest last.
 *
 * On any failure every completed step is undone in reverse order (old bytes rewritten, created files and
 * directories removed) and the failure names the path and the cause, never file content.
 *
 * This is a sibling of `applyWrite`, not an extension of it: that writer decodes utf8 and re-parses an adapter's
 * config format, which would corrupt the bytes of a user's instructions file outside our block.
 *
 * Every path is derived from the injected context (`projectDir`, `homeDir`, `stateDir`) and written through the
 * injected `BytesFs`; this module reads no process state.
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import {
  firstLinkOn,
  isManagedDirPath,
  isManagedPath,
  isSafeRelativePath,
  loadPack,
  MANIFEST_PATH,
  planPackChange,
} from "./pack-plan.js";
import type { LinkKind, PackAction, PackPlan, ProjectView } from "./pack-plan.js";
import { locateRuleBlock } from "./rule-block.js";
import { resolveStateDir, type EngineHostContext } from "./state.js";
import { stamp } from "./write.js";

/** Injectable byte-level file system. Paths are absolute. */
export interface BytesFs {
  exists(path: string): boolean;
  isDirectory(path: string): boolean;
  readBytes(path: string): Buffer;
  writeBytes(path: string, bytes: Uint8Array): void;
  /** Recursive mkdir (idempotent). */
  mkdir(dir: string): void;
  /** Delete one file. */
  removeFile(path: string): void;
  /** Remove a directory only when it is empty; true when it was removed. */
  removeEmptyDir(dir: string): boolean;
  /** Entry names in a directory. */
  listDir(dir: string): string[];
  /**
   * What kind of link the path itself is, never following it: `symbolic`, `hard` (a file with a second hard
   * link), or `null` for a plain file, a plain directory or nothing at all.
   */
  linkKind(path: string): LinkKind | null;
}

/** The real file system. */
export const REAL_BYTES_FS: BytesFs = {
  exists: (p) => existsSync(p),
  linkKind: (p) => {
    let stats;
    try {
      stats = lstatSync(p);
    } catch {
      return null;
    }
    if (stats.isSymbolicLink()) return "symbolic";
    return stats.isFile() && stats.nlink > 1 ? "hard" : null;
  },
  isDirectory: (p) => {
    try {
      return statSync(p).isDirectory();
    } catch {
      return false;
    }
  },
  readBytes: (p) => readFileSync(p),
  writeBytes: (p, bytes) => writeFileSync(p, bytes),
  mkdir: (dir) => {
    mkdirSync(dir, { recursive: true });
  },
  removeFile: (p) => {
    unlinkSync(p);
  },
  removeEmptyDir: (dir) => {
    try {
      rmdirSync(dir);
      return true;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === "ENOTEMPTY" || code === "EEXIST" || code === "ENOENT") return false;
      throw error;
    }
  },
  listDir: (dir) => readdirSync(dir),
};

/** The host context the installer runs in: `projectDir` is required. */
export type PackContext = EngineHostContext;

function pathFor(ctx: PackContext) {
  return ctx.platform === "win32" ? path.win32 : path.posix;
}

function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * The key of a project in the backup tree: its sanitized directory name plus the first 12 hex digits of the
 * sha256 of its absolute path, so two projects with the same name never share backups.
 */
export function projectKey(ctx: PackContext, projectDir: string): string {
  const p = pathFor(ctx);
  const base = p.basename(projectDir).replace(/[^A-Za-z0-9._-]/g, "_");
  const name = base === "" || base === "." || base === ".." ? "project" : base;
  return `${name}-${sha256Hex(Buffer.from(projectDir, "utf8")).slice(0, 12)}`;
}

export interface PrepareOptions {
  action: PackAction;
  client: string;
  includeModified: boolean;
  fs?: BytesFs;
  /** The pack to install from (default: the one shipped in this package). */
  packDir?: string;
}

export type PrepareResult =
  | { ok: true; plan: PackPlan; project: string }
  | { ok: false; kind: "usage" | "failure"; message: string };

function absolute(ctx: PackContext, projectDir: string, rel: string): string {
  return pathFor(ctx).join(projectDir, ...rel.split("/"));
}

/**
 * Plan a change over the real project directory in `ctx.projectDir`.
 *
 * A usage problem (unknown client, a client with no route, a project that is not a directory) comes back as
 * `kind: "usage"`; an unusable pack, an invalid manifest or a path outside the installer's locations as
 * `kind: "failure"`.
 */
export function preparePackChange(ctx: PackContext, options: PrepareOptions): PrepareResult {
  const fs = options.fs ?? REAL_BYTES_FS;
  const projectDir = ctx.projectDir;
  if (projectDir === undefined || projectDir === "") {
    return { ok: false, kind: "usage", message: "no project directory is known; pass --project <dir>" };
  }
  if (!fs.isDirectory(projectDir)) {
    return { ok: false, kind: "usage", message: `the project ${projectDir} is not a directory` };
  }

  let pack;
  if (options.action === "install") {
    const loaded = loadPack(options.packDir);
    if (!loaded.ok) return { ok: false, kind: "failure", message: loaded.message };
    pack = loaded.pack;
  }

  const view: ProjectView = {
    read: (rel) => {
      if (!isSafeRelativePath(rel)) return null;
      const file = absolute(ctx, projectDir, rel);
      return fs.exists(file) && !fs.isDirectory(file) ? fs.readBytes(file) : null;
    },
    isDirectory: (rel) => isSafeRelativePath(rel) && fs.isDirectory(absolute(ctx, projectDir, rel)),
    listDir: (rel) => {
      if (!isSafeRelativePath(rel)) return null;
      const dir = absolute(ctx, projectDir, rel);
      return fs.isDirectory(dir) ? fs.listDir(dir) : null;
    },
    linkKind: (rel) => (isSafeRelativePath(rel) ? fs.linkKind(absolute(ctx, projectDir, rel)) : null),
  };

  let plan: ReturnType<typeof planPackChange>;
  try {
    plan = planPackChange({
      action: options.action,
      client: options.client,
      includeModified: options.includeModified,
      ...(pack !== undefined ? { pack } : {}),
      project: view,
    });
  } catch (error) {
    return { ok: false, kind: "failure", message: `could not read the project: ${describeError(error)}` };
  }
  if (!plan.ok) {
    const usage = plan.kind === "unknown-client" || plan.kind === "no-route";
    return { ok: false, kind: usage ? "usage" : "failure", message: plan.message };
  }

  // A conflict may name one of the installer's directories (a link in the way); it is reported, never written.
  const outside = [
    ...plan.items.filter((item) => !(item.change === "conflict" && isManagedDirPath(item.path))).map((item) => item.path),
    ...plan.writes.map((write) => write.rel),
    ...plan.observed.map((entry) => entry.rel).filter((rel) => !isSafeRelativePath(rel)),
  ].find((rel) => !isManagedPath(rel));
  if (outside !== undefined) {
    return { ok: false, kind: "failure", message: `refusing to touch ${outside}: it is outside the installer's locations` };
  }
  const outsideDir = [...plan.createDirs, ...plan.removeDirs].find((dir) => !isManagedDirPath(dir));
  if (outsideDir !== undefined) {
    return { ok: false, kind: "failure", message: `refusing to touch ${outsideDir}: it is outside the installer's locations` };
  }
  return { ok: true, plan, project: projectDir };
}

export interface ExecuteOptions {
  fs?: BytesFs;
  now?: () => Date;
}

export type ExecuteResult =
  | { ok: true; changed: number; backups: string[] }
  | {
      ok: false;
      /** The project-relative path the failure concerns. */
      path: string;
      reason: string;
      /** True when the failure is that a planned path changed after the preview. */
      changedSincePreview: boolean;
      /** True when every completed step was undone. */
      rolledBack: boolean;
    };

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `bytes` without the blocks of `stems`. */
function withoutBlocks(bytes: Buffer, stems: readonly string[]): Buffer {
  let rest = bytes;
  for (const stem of stems) {
    const at = locateRuleBlock(rest, stem);
    if (at.status === "one") rest = Buffer.concat([rest.subarray(0, at.start), rest.subarray(at.end)]);
  }
  return rest;
}

/**
 * True when the bytes of a host outside its blocks are what they were before the write, except that a last line
 * without a line ending may have been ended in LF or CRLF.
 */
function outsideBlocksKept(before: Buffer | null, written: Buffer, stems: readonly string[]): boolean {
  const kept = withoutBlocks(written, stems);
  const was = withoutBlocks(before ?? Buffer.alloc(0), stems);
  if (kept.equals(was)) return true;
  if (was.length === 0 || was[was.length - 1] === 0x0a) return false;
  return kept.equals(Buffer.concat([was, Buffer.from("\n")])) || kept.equals(Buffer.concat([was, Buffer.from("\r\n")]));
}

/**
 * Write a plan.
 *
 * @param ctx - The host context; `projectDir` is required, and `stateDir` (default: under `homeDir`) holds the backups.
 * @param plan - A plan from `preparePackChange`.
 * @param options - `fs` (default: the real file system) and `now` (the backup clock).
 */
export function executePackPlan(ctx: PackContext, plan: PackPlan, options: ExecuteOptions = {}): ExecuteResult {
  const fs = options.fs ?? REAL_BYTES_FS;
  const now = options.now ?? (() => new Date());
  const p = pathFor(ctx);
  const projectDir = ctx.projectDir ?? "";
  const abs = (rel: string): string => absolute(ctx, projectDir, rel);
  const fail = (rel: string, reason: string, extra: { changedSincePreview?: boolean; rolledBack?: boolean } = {}): ExecuteResult => ({
    ok: false,
    path: rel,
    reason,
    changedSincePreview: extra.changedSincePreview ?? false,
    rolledBack: extra.rolledBack ?? false,
  });

  if (projectDir === "") return fail("", "no project directory is known");
  if (plan.conflicts.length > 0) {
    return fail(plan.conflicts[0]?.path ?? "", "the plan has conflicts; nothing was written", { rolledBack: true });
  }

  // 1. Every planned path must still be what the preview saw.
  const readOrNull = (rel: string): Buffer | null => {
    const file = abs(rel);
    return fs.exists(file) && !fs.isDirectory(file) ? fs.readBytes(file) : null;
  };
  try {
    for (const entry of plan.observed) {
      const current = readOrNull(entry.rel);
      if ((current === null ? null : sha256Hex(current)) !== entry.sha256) {
        return fail(entry.rel, `${entry.rel} changed after the preview; nothing was written; re-run the command`, {
          changedSincePreview: true,
          rolledBack: true,
        });
      }
    }
    for (const dir of plan.createDirs) {
      if (fs.isDirectory(abs(dir))) {
        return fail(dir, `${dir} changed after the preview; nothing was written; re-run the command`, {
          changedSincePreview: true,
          rolledBack: true,
        });
      }
    }
    // A link that appeared at or above a planned path since the preview (a dangling one reads as absent above).
    const touched = [...plan.writes.map((write) => write.rel), ...plan.createDirs, ...plan.removeDirs, MANIFEST_PATH];
    for (const rel of touched) {
      if (firstLinkOn(rel, (prefix) => fs.linkKind(abs(prefix))) !== null) {
        return fail(rel, `${rel} changed after the preview; nothing was written; re-run the command`, {
          changedSincePreview: true,
          rolledBack: true,
        });
      }
    }
  } catch (error) {
    return fail("", `could not read the project before writing: ${describeError(error)}; nothing was written`, { rolledBack: true });
  }

  const undo: Array<{ rel: string; run: () => void }> = [];
  const backups: string[] = [];
  let stateDir: string | undefined;
  let current = "";

  const backup = (rel: string, bytes: Buffer): void => {
    stateDir ??= resolveStateDir(ctx);
    const base = p.join(stateDir, "backups", "skills-pack", projectKey(ctx, projectDir), ...rel.split("/"));
    const stampText = stamp(now());
    let target = `${base}.${stampText}`;
    let suffix = 1;
    while (fs.exists(target)) {
      target = `${base}.${stampText}-${suffix}`;
      suffix += 1;
    }
    fs.mkdir(p.dirname(target));
    fs.writeBytes(target, bytes);
    backups.push(target);
  };

  try {
    // 2. Directories.
    for (const dir of plan.createDirs) {
      current = dir;
      fs.mkdir(abs(dir));
      undo.push({ rel: dir, run: () => void fs.removeEmptyDir(abs(dir)) });
    }

    // 3. Files to write.
    for (const write of plan.writes) {
      if (write.after === null) continue;
      const after = write.after;
      current = write.rel;
      if (write.before !== null) backup(write.rel, write.before);
      undo.push({
        rel: write.rel,
        run: () => {
          if (write.before !== null) fs.writeBytes(abs(write.rel), write.before);
          else if (fs.exists(abs(write.rel))) fs.removeFile(abs(write.rel));
        },
      });
      fs.writeBytes(abs(write.rel), after);
      const written = fs.readBytes(abs(write.rel));
      if (!written.equals(after)) throw new Error("the bytes read back differ from the bytes written");
      const blocks = write.blocks ?? [];
      for (const block of blocks) {
        const located = locateRuleBlock(written, block.stem);
        if (located.status !== "one" || !written.subarray(located.start, located.end).equals(block.section)) {
          throw new Error(`the ${block.stem} block is not exactly one whole block after the write`);
        }
      }
      const stems = [...blocks.map((block) => block.stem), ...(write.removedBlocks ?? [])];
      if (blocks.length > 0 && !outsideBlocksKept(write.before, written, stems)) {
        throw new Error("the bytes outside the block changed");
      }
    }

    // 4. Files to delete. The manifest goes last among them when nothing is left to record, so that its
    //    directory is empty by the time directories are removed.
    for (const write of plan.writes) {
      if (write.after !== null || write.before === null) continue;
      const before = write.before;
      current = write.rel;
      backup(write.rel, before);
      fs.removeFile(abs(write.rel));
      undo.push({ rel: write.rel, run: () => fs.writeBytes(abs(write.rel), before) });
    }
    const manifestRel = MANIFEST_PATH;
    const before = plan.manifestBefore;
    const after = plan.manifestAfter;
    if (after === null && before !== null) {
      current = manifestRel;
      backup(manifestRel, before);
      fs.removeFile(abs(manifestRel));
      undo.push({ rel: manifestRel, run: () => fs.writeBytes(abs(manifestRel), before) });
    }

    // 5. Recorded directories that are now empty.
    for (const dir of plan.removeDirs) {
      current = dir;
      if (!fs.isDirectory(abs(dir))) continue;
      if (fs.removeEmptyDir(abs(dir))) undo.push({ rel: dir, run: () => fs.mkdir(abs(dir)) });
    }

    // 6. The manifest, written last.
    current = manifestRel;
    if (after !== null && (before === null || !after.equals(before))) {
      if (before !== null) backup(manifestRel, before);
      undo.push({
        rel: manifestRel,
        run: () => {
          if (before !== null) fs.writeBytes(abs(manifestRel), before);
          else if (fs.exists(abs(manifestRel))) fs.removeFile(abs(manifestRel));
        },
      });
      fs.writeBytes(abs(manifestRel), after);
      if (!fs.readBytes(abs(manifestRel)).equals(after)) throw new Error("the bytes read back differ from the bytes written");
    }
  } catch (error) {
    const reason = describeError(error);
    const failures: string[] = [];
    for (const step of undo.reverse()) {
      try {
        step.run();
      } catch (undoError) {
        failures.push(`${step.rel}: ${describeError(undoError)}`);
      }
    }
    const rolledBack = failures.length === 0;
    return fail(
      current,
      rolledBack
        ? `could not write ${current}: ${reason}; every change of this run was undone`
        : `could not write ${current}: ${reason}; it could not undo ${failures.join(", ")}`,
      { rolledBack },
    );
  }

  return { ok: true, changed: plan.changes, backups };
}
