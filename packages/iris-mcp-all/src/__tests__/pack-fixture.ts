/**
 * Shared fixtures for the skills-pack tests (`skills-pack.test.ts`, `pack-provenance.test.ts`,
 * `validate-prompts.test.ts`) and the skills-pack documentation tests: disposable temp roots, file placement, a real
 * `node` child process, the anchors of a Markdown file's headings, and a real `pnpm pack` (the packer that
 * publishing uses) with its tarball extracted.
 *
 * Every temp root is created under `os.tmpdir()` and removed by the test that made it.
 */

import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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

/**
 * Remove a symbolic link or junction itself, never what it points at; a path that is not a link is left alone and a missing path is
 * a no-op. `rmSync` without `recursive` is not a way to do this: Node 24.0.0 refuses a link to a directory ("Path is a directory"),
 * where Node 22 and 26 remove it.
 */
export function removeLink(linkPath: string): void {
  if (lstatSync(linkPath, { throwIfNoEntry: false })?.isSymbolicLink()) unlinkSync(linkPath);
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

/**
 * Pack `packageDir` with `pnpm pack` (the packer that publishing goes through: only pnpm applies `publishConfig` overrides such as
 * `exports`) into `destination`, and extract the tarball next to it. The implementation is `scripts/lib/pnpm-pack.mjs`, shared with
 * `scripts/ci-package-smoke.mjs`; lifecycle scripts are not run here, as with the `npm pack --ignore-scripts` siblings.
 */
export { pnpmPack } from "../../../../scripts/lib/pnpm-pack.mjs";

/**
 * Give the extracted `pack` a `node_modules` that holds exactly what a registry install of it would: each declared
 * `dependencies` entry (taken from the repository's install of `packages/<dir>`), each installed optional dependency, and
 * `workspaceLinks` in place of the `@iris-mcp/*` packages. A dependency the repository has not installed is an error naming it.
 *
 * @param pack - A package packed and extracted by {@link pnpmPack}.
 * @param dir - The package's directory name under `packages/`.
 * @param workspaceLinks - Absolute directories to link in for `@iris-mcp/*` dependencies, keyed by package name.
 */
export function installDeclaredDependencies(pack: PnpmPack, dir: string, workspaceLinks: Record<string, string>): void {
  const manifest = pack.manifest as { dependencies?: Record<string, string>; optionalDependencies?: Record<string, string> };
  const link = (name: string, to: string): void => {
    const destination = join(pack.root, "node_modules", name);
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(to, destination, "junction");
  };
  for (const name of Object.keys(manifest.dependencies ?? {})) {
    const workspace = workspaceLinks[name];
    if (workspace !== undefined) {
      link(name, workspace);
      continue;
    }
    const installed = join(REPO_ROOT, "packages", dir, "node_modules", name);
    if (!existsSync(installed)) throw new Error(`${String(pack.manifest["name"])} declares ${name}, which packages/${dir}/node_modules does not hold`);
    link(name, realpathSync(installed));
  }
  for (const name of Object.keys(manifest.optionalDependencies ?? {})) {
    const installed = join(REPO_ROOT, "packages", dir, "node_modules", name);
    if (existsSync(installed)) link(name, realpathSync(installed));
  }
}
