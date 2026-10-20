/**
 * Shared helpers for the Story 41.1 QA tests (`story-41-1-qa-*.test.ts`): a disposable SCRATCH COPY of the
 * parts of the repository the skills-pack scripts read, and real `node` child processes run against it.
 *
 * The scripts under test resolve their repository root from their own location (`scripts/..`), so a copy of
 * `scripts/` inside a scratch root makes every script run against the scratch tree. Nothing in the real
 * working tree is written: the scratch root is created under `os.tmpdir()` and removed by the test that
 * made it.
 *
 * Tree comparisons use the walker below, not `listFilesRecursive` from the module under test, so the oracle
 * is independent of the implementation.
 */

import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { PACK_DIR, PACK_SOURCE_DIR, WORKFLOW_SKILLS_DIR } from "../../../../scripts/lib/skills-pack.mjs";
import { makeTempRoot, type NodeRun, removeTempRoot, REPO_ROOT, runNode } from "./pack-fixture";

/** The five server packages the prompt and tool catalogs import (their built `dist/`). */
export const SERVER_PACKAGE_DIRS = ["iris-admin-mcp", "iris-data-mcp", "iris-dev-mcp", "iris-interop-mcp", "iris-ops-mcp"];

/** Keeps npm from writing its log files or checking for updates when a script spawns it. */
export const QUIET_NPM_ENV = {
  npm_config_logs_max: "0",
  npm_config_update_notifier: "false",
  NO_UPDATE_NOTIFIER: "1",
};

export interface ScratchOptions {
  /**
   * Link the five server packages' real directories under `packages/`. The catalogs only READ their `dist/`
   * (`gen-skills --check`, `validate-prompts`); never run a writing script from such a root except
   * `gen-pack`, which writes only `packages/client-config/skills-pack/`.
   */
  serverPackages?: boolean;
  /** Copy client-config's real `package.json` and `dist/`, so npm's packer lists a real tarball. */
  clientConfigManifest?: boolean;
}

/** A new scratch repository: copies of `scripts/`, `skills/`, `skills-pack-src/` and the committed pack. */
export function makeScratchRepo(options: ScratchOptions = {}): string {
  const root = makeTempRoot("qa-41-1-scratch");
  const copy = (rel: string, recursive: boolean): void => {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    cpSync(join(REPO_ROOT, rel), join(root, rel), { recursive });
  };
  copy("scripts", true);
  for (const rel of [WORKFLOW_SKILLS_DIR, PACK_SOURCE_DIR, PACK_DIR]) copy(rel, true);
  if (options.clientConfigManifest) {
    copy("packages/client-config/package.json", false);
    copy("packages/client-config/dist", true);
  }
  if (options.serverPackages) {
    mkdirSync(join(root, "packages"), { recursive: true });
    for (const dir of SERVER_PACKAGE_DIRS) {
      symlinkSync(join(REPO_ROOT, "packages", dir), join(root, "packages", dir), "junction");
    }
  }
  return root;
}

/** Remove a scratch repository; the links to the real server packages are unlinked before anything else. */
export function removeScratchRepo(root: string): void {
  for (const dir of SERVER_PACKAGE_DIRS) {
    try {
      rmSync(join(root, "packages", dir), { force: true });
    } catch {
      // Not a link (or already gone): the recursive removal below handles it.
    }
  }
  removeTempRoot(root);
}

/** Every regular file under `dir`, as sorted POSIX paths relative to `dir`. Links are not followed. */
export function walkFiles(dir: string): string[] {
  const found: string[] = [];
  const visit = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.isDirectory()) visit(join(current, entry.name), `${prefix}${entry.name}/`);
      else if (entry.isFile()) found.push(`${prefix}${entry.name}`);
    }
  };
  visit(dir, "");
  return found.sort();
}

/** Every directory under `dir`, as sorted POSIX paths (with a trailing slash) relative to `dir`. */
function walkDirs(dir: string): string[] {
  const found: string[] = [];
  const visit = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      found.push(`${prefix}${entry.name}/`);
      visit(join(current, entry.name), `${prefix}${entry.name}/`);
    }
  };
  visit(dir, "");
  return found.sort();
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * A readable fingerprint of a tree: one line per directory and one per file with the sha256 of its bytes.
 * Two trees are byte-identical, empty directories included, exactly when their lines are equal.
 */
export function treeLines(dir: string): string[] {
  return [
    ...walkDirs(dir).map((rel) => `dir  ${rel}`),
    ...walkFiles(dir).map((rel) => `file ${rel} ${sha256(readFileSync(join(dir, rel)))}`),
  ].sort();
}

/** `runNode` with npm kept quiet (`QUIET_NPM_ENV`, then `env`) and a 120 s limit on the child. */
export function runScript(cwd: string, script: string, args: string[] = [], env: Record<string, string> = {}): NodeRun {
  return runNode(cwd, script, args, { env: { ...QUIET_NPM_ENV, ...env }, timeout: 120_000 });
}

/** The distinct rule tags of a `check-provenance` failure (`  - [rule] label: message`), sorted. */
export function problemRules(stderr: string): string[] {
  const rules = new Set<string>();
  for (const match of stderr.matchAll(/^\s+- \[([a-z-]+)\] /gm)) rules.add(match[1] ?? "");
  return [...rules].sort();
}

/** The distinct `rule label` pairs of a `check-provenance` failure (`  - [rule] label: message`), sorted. */
export function problemPairs(stderr: string): string[] {
  const pairs = new Set<string>();
  for (const match of stderr.matchAll(/^\s+- \[([a-z-]+)\] (.+?): /gm)) pairs.add(`${match[1]} ${match[2]}`);
  return [...pairs].sort();
}

/** The same bytes with every LF replaced by CRLF. */
export function toCrlf(bytes: Buffer): Buffer {
  return Buffer.from(bytes.toString("utf8").replace(/\n/g, "\r\n"), "utf8");
}

export const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** The same bytes with one byte in the middle changed. */
export function flipMiddleByte(bytes: Buffer): Buffer {
  const copy = Buffer.from(bytes);
  const index = Math.floor(copy.length / 2);
  copy.writeUInt8(copy.readUInt8(index) ^ 0x01, index);
  return copy;
}
