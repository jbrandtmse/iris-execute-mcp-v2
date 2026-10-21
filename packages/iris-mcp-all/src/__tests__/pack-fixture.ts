/**
 * Shared fixtures for the skills-pack tests (`skills-pack.test.ts`, `pack-provenance.test.ts`,
 * `validate-prompts.test.ts`) and the skills-pack documentation tests: disposable temp roots, file placement, a real
 * `node` child process, the anchors of a Markdown file's headings, and a real `pnpm pack` (the packer that
 * publishing uses) with its tarball extracted.
 *
 * Every temp root is created under `os.tmpdir()` and removed by the test that made it.
 */

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseProvenanceRows } from "../../../../scripts/lib/provenance-core.mjs";
import { PACK_DIR } from "../../../../scripts/lib/skills-pack.mjs";

/** The repository root (this file is `packages/iris-mcp-all/src/__tests__/`, four levels down). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

/**
 * The committed pack files that the provenance rows of a notice name, read from the pack and keyed by their
 * pack-relative path. An in-memory input set for `checkProvenance` that carries the real notice must also carry these,
 * or each real row reports a pack file that is missing.
 */
export function committedRowFiles(notice: Uint8Array): Array<{ rel: string; bytes: Buffer }> {
  const { rows } = parseProvenanceRows(Buffer.from(notice).toString("utf8"));
  return rows.map(({ packFile }) => ({ rel: packFile, bytes: readFileSync(join(REPO_ROOT, PACK_DIR, packFile)) }));
}

/** A new empty directory under the OS temp directory. */
export function makeTempRoot(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

export function removeTempRoot(root: string): void {
  rmSync(root, { recursive: true, force: true });
}

/** Write `content` at `rel` under `root`, creating the directories. Strings are written as UTF-8. */
export function put(root: string, rel: string, content: string | Uint8Array): string {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

export interface NodeRun {
  status: number | null;
  stdout: string;
  stderr: string;
}

export interface NodeRunOptions {
  /** Variables added to the inherited environment. */
  env?: Record<string, string>;
  /** Milliseconds after which the child is killed; no limit when omitted. */
  timeout?: number;
}

/** The GitHub-style anchor of one heading's text, with `seen` numbering repeated headings (`-1`, `-2`, ...). */
function headingAnchor(heading: string, seen: Map<string, number>): string {
  const text = heading
    .replace(/<[^>]*>/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*~]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
  const count = seen.get(text) ?? 0;
  seen.set(text, count + 1);
  return count === 0 ? text : `${text}-${count}`;
}

/**
 * The GitHub-style anchors of every ATX heading of a Markdown text: letters, digits and marks of any script are kept,
 * other punctuation is dropped, each whitespace character becomes a hyphen, and a repeated heading gets `-1`, `-2`, ....
 * A `#` line inside fenced code is not a heading.
 */
export function markdownHeadingSlugs(text: string): Set<string> {
  const slugs = new Set<string>();
  const seen = new Map<string, number>();
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced) continue;
    const match = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (match !== null) slugs.add(headingAnchor(match[2] as string, seen));
  }
  return slugs;
}

/** Run `node <script> <args>` with `cwd` as the working directory, in a real child process. */
export function runNode(cwd: string, script: string, args: string[] = [], options: NodeRunOptions = {}): NodeRun {
  const result = spawnSync(process.execPath, [script, ...args], {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    timeout: options.timeout,
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** One package packed by `pnpm pack` and extracted: the tarball, its files and its packed manifest. */
export interface PnpmPack {
  /** Absolute path of the tarball. */
  tarball: string;
  /** Size of the tarball in bytes. */
  bytes: number;
  /** Absolute path of the extracted `package/` directory. */
  root: string;
  /** Forward-slash paths, relative to the package root, of every file in the tarball, sorted. */
  files: string[];
  /** The `package.json` that was packed (after `publishConfig` overrides). */
  manifest: Record<string, unknown>;
}

function runTool(command: string, args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_update_notifier: "false", NO_UPDATE_NOTIFIER: "1" },
    timeout: 120_000,
    shell: process.platform === "win32" && command !== "tar",
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function walkRelative(root: string, directory = ""): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const rel = directory === "" ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walkRelative(root, rel));
    else found.push(rel);
  }
  return found.sort();
}

/**
 * Pack `packageDir` with `pnpm pack` (the packer that publishing goes through: only pnpm applies `publishConfig` overrides such as
 * `exports`) into `destination`, and extract the tarball next to it. Nothing is written outside `destination`.
 *
 * @param packageDir - Absolute path of the package directory.
 * @param destination - A directory under `os.tmpdir()` that holds no other tarball (pnpm creates it when it is missing); the tarball goes in it, and `extracted/` holds its contents.
 */
export function pnpmPack(packageDir: string, destination: string): PnpmPack {
  const packed = runTool("pnpm", ["pack", "--pack-destination", destination], packageDir);
  if (packed.status !== 0) throw new Error(`pnpm pack failed in ${packageDir}: ${packed.stderr || packed.stdout}`);
  const tarballs = readdirSync(destination).filter((name) => name.endsWith(".tgz"));
  if (tarballs.length !== 1) throw new Error(`pnpm pack in ${packageDir} wrote ${tarballs.length} tarballs to ${destination}`);
  const tarball = join(destination, tarballs[0] as string);
  const extractDir = join(destination, "extracted");
  mkdirSync(extractDir);
  const extracted = runTool("tar", ["-xzf", tarball, "-C", extractDir], destination);
  if (extracted.status !== 0) throw new Error(`tar could not extract ${tarball}: ${extracted.stderr}`);
  const root = join(extractDir, "package");
  return {
    tarball,
    bytes: statSync(tarball).size,
    root,
    files: walkRelative(root),
    manifest: JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<string, unknown>,
  };
}
