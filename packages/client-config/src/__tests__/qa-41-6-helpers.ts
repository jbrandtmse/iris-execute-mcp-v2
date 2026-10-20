/**
 * Story 41.6 QA - helpers shared by the `qa-41-6-*.test.ts` files.
 *
 * Everything runs the BUILT bin, `dist/cli/clients-cli.js`, as a real child process whose environment is built from
 * scratch: HOME, USERPROFILE and APPDATA are the sandbox's temp home, so nothing can resolve into the real home.
 * The expected bytes come from the pack directory read straight from disk (an independent oracle: no `loadPack`,
 * no `PACK_ROUTES`), and every path the routes write is a literal in the tests.
 *
 * `skills-cli-process.test.ts` uses the same runner and freshness guard: every suite that drives the built bin calls
 * `assertBinFresh` in its `beforeAll`, so a `dist/` older than `src/` fails loudly instead of testing old code.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, utimesSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import type { Sandbox } from "./pack-test-helpers.js";

export const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
export const REPO_ROOT = path.resolve(PACKAGE_ROOT, "..", "..");
export const BIN = path.join(PACKAGE_ROOT, "dist", "cli", "clients-cli.js");
export const PACK_ON_DISK = path.join(PACKAGE_ROOT, "skills-pack");

export const RULE_STEM = "iris-mcp-objectscript-pre-write";
export const NOTICE = "IRIS-MCP-THIRD-PARTY-NOTICES.md";
export const MANIFEST = ".iris-mcp/skills-pack.json";
export const ADAPTED = "Adapted from intersystems-community/iris-agentic-dev";

/** A generous bound for a test that spawns the bin several times. */
export const SPAWN_TEST_TIMEOUT = 180_000;

type CheckDistFresh = (pkgDir: string, pkgName: string) => { ok: boolean; reason?: string; skipped?: boolean };

/**
 * Fail with the rebuild remedy unless this package's `dist/` is built and newer than its `src/`. The check is the
 * shared `scripts/lib/dist-freshness.mjs`, loaded by path at run time, as `engine-e2e.test.ts` does.
 */
export async function assertBinFresh(): Promise<void> {
  const freshnessLib = path.join(REPO_ROOT, "scripts", "lib", "dist-freshness.mjs");
  const { checkDistFresh } = (await import(pathToFileURL(freshnessLib).href)) as { checkDistFresh: CheckDistFresh };
  const fresh = checkDistFresh(PACKAGE_ROOT, "@iris-mcp/client-config");
  if (!fresh.ok || fresh.skipped === true || !existsSync(BIN)) {
    throw new Error(
      `${fresh.reason ?? `${BIN} is not built.`} Run "pnpm --filter @iris-mcp/client-config build" and retry.`,
    );
  }
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Run the built bin with `cwd` (default: the sandbox project) and a from-scratch env rooted at the sandbox home. */
export function runBin(sandbox: Sandbox, args: string[], options: { cwd?: string } = {}): RunResult {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    cwd: options.cwd ?? sandbox.project,
    env: {
      PATH: process.env.PATH ?? "",
      PATHEXT: process.env.PATHEXT ?? "",
      SystemRoot: process.env.SystemRoot ?? "",
      windir: process.env.windir ?? "",
      TEMP: process.env.TEMP ?? "",
      TMP: process.env.TMP ?? "",
      TMPDIR: process.env.TMPDIR ?? "",
      HOME: sandbox.home,
      USERPROFILE: sandbox.home,
      APPDATA: path.join(sandbox.home, "AppData", "Roaming"),
    },
    encoding: "utf8",
    input: "",
    timeout: 90_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Every entry below `dir` keyed by its POSIX path: `file:<sha256>`, `dir`, or `link:<target>`. Links are NOT
 * followed, so a symlink shows as itself. With `modes`, a directory also carries its permission bits.
 */
export function lstatTree(dir: string, options: { modes?: boolean } = {}): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      const stat = lstatSync(full);
      if (stat.isSymbolicLink()) {
        out.set(rel, `link:${readlinkSync(full)}`);
      } else if (stat.isDirectory()) {
        out.set(rel, options.modes ? `dir:${(stat.mode & 0o777).toString(8)}` : "dir");
        walk(full, rel);
      } else {
        out.set(rel, `file:${sha256(readFileSync(full))}`);
      }
    }
  };
  walk(dir, "");
  return out;
}

/** `[key, value]` lines of a tree that differ between two snapshots, for a readable assertion message. */
export function treeDiff(before: Map<string, string>, after: Map<string, string>): string[] {
  const lines: string[] = [];
  for (const [key, value] of before) {
    if (!after.has(key)) lines.push(`removed ${key}`);
    else if (after.get(key) !== value) lines.push(`changed ${key}`);
  }
  for (const key of after.keys()) {
    if (!before.has(key)) lines.push(`added ${key}`);
  }
  return lines.sort();
}

/** Every regular file under the pack's `skills/` directory, as `[path below skills/, bytes]`, read straight from disk. */
export function packSkillFiles(): Array<[string, Buffer]> {
  const root = path.join(PACK_ON_DISK, "skills");
  const out: Array<[string, Buffer]> = [];
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else if (entry.isFile()) out.push([rel, readFileSync(path.join(current, entry.name))]);
    }
  };
  walk(root, "");
  return out;
}

export function packNotice(): Buffer {
  return readFileSync(path.join(PACK_ON_DISK, NOTICE));
}

/** The pack's three forms of the one rule, read from disk. */
export function packRuleForms(): { claudeCode: Buffer; cursor: Buffer; agentsMd: Buffer } {
  return {
    claudeCode: readFileSync(path.join(PACK_ON_DISK, "rules", "claude-code", `${RULE_STEM}.md`)),
    cursor: readFileSync(path.join(PACK_ON_DISK, "rules", "cursor", `${RULE_STEM}.mdc`)),
    agentsMd: readFileSync(path.join(PACK_ON_DISK, "rules", "agents-md", `${RULE_STEM}.md`)),
  };
}

/**
 * The files an install into an empty project writes for a skills directory: every pack skill file, and the pack's
 * notice beside each installed file that carries adapted content. Keyed by project-relative POSIX path.
 */
export function expectedSkillFiles(skillsDir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const notice = packNotice();
  for (const [rel, bytes] of packSkillFiles()) {
    out.set(`${skillsDir}/${rel}`, bytes);
    if (bytes.includes(ADAPTED)) {
      out.set(`${skillsDir}/${rel.split("/").slice(0, -1).join("/")}/${NOTICE}`, notice);
    }
  }
  return out;
}

/** Every regular file under `dir` as `[POSIX path, bytes]`; links are not followed. An absent `dir` holds none. */
export function filesUnder(dir: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  if (!existsSync(dir)) return out;
  const walk = (current: string, prefix: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(path.join(current, entry.name), rel);
      else if (entry.isFile()) out.set(rel, readFileSync(path.join(current, entry.name)));
    }
  };
  walk(dir, "");
  return out;
}

/** Where the installer keeps backups, below the sandbox home (the default state directory). */
export const BACKUP_ROOT = ".iris-mcp/client-manager/backups/skills-pack";

/** The files below the temp home that are NOT inside the backup directory (the installer writes nothing else there). */
export function filesOutsideBackups(home: string): string[] {
  return [...filesUnder(home).keys()].filter((key) => !key.startsWith(`${BACKUP_ROOT}/`)).sort();
}

/** The ancestor directories of a project-relative POSIX path, shallow first. */
export function ancestors(rel: string): string[] {
  const parts = rel.split("/").slice(0, -1);
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/** Every non-directory entry below `dir` with its mtime in ms; links are not followed. */
export function mtimes(dir: string): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (current: string, prefix: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const rel = prefix === "" ? name : `${prefix}/${name}`;
      if (lstatSync(full).isDirectory()) walk(full, rel);
      else out.set(rel, lstatSync(full).mtimeMs);
    }
  };
  walk(dir, "");
  return out;
}

/**
 * Set the mtime of every regular file below `dir` far in the past, so any later rewrite shows as a newer mtime, and
 * return `mtimes(dir)`. Links are neither followed nor changed.
 */
export function ageAllFiles(dir: string): Map<string, number> {
  const past = new Date("2001-01-01T00:00:00Z");
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = path.join(current, name);
      const stat = lstatSync(full);
      if (stat.isDirectory()) walk(full);
      else if (stat.isFile()) utimesSync(full, past, past);
    }
  };
  walk(dir);
  return mtimes(dir);
}

/** The bytes of every backup the installer took of the project-relative path `rel`, found below the temp home. */
export function backupsOf(home: string, rel: string): Buffer[] {
  const pattern = new RegExp(`^${BACKUP_ROOT.replace(/[.]/g, "\\.")}/[^/]+/${rel.replace(/[.]/g, "\\.")}\\.[0-9TZ-]+$`);
  return [...filesUnder(home)].filter(([key]) => pattern.test(key)).map(([, bytes]) => bytes);
}

/** True when the bin exists (the process suites run against `dist/`). */
export function binIsBuilt(): boolean {
  return existsSync(BIN);
}

/** The first non-empty line of a stream. */
export function firstLine(text: string): string {
  return text.split("\n").find((line) => line.trim() !== "") ?? "";
}
