/**
 * Shared fixtures for the skills-pack tests (`skills-pack.test.ts`, `pack-provenance.test.ts`,
 * `validate-prompts.test.ts`): disposable temp roots, file placement, and a real `node` child process.
 *
 * Every temp root is created under `os.tmpdir()` and removed by the test that made it.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The repository root (this file is `packages/iris-mcp-all/src/__tests__/`, four levels down). */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

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

/** Run `node <script> <args>` with `cwd` as the working directory, in a real child process. */
export function runNode(cwd: string, script: string, args: string[] = []): NodeRun {
  const result = spawnSync(process.execPath, [script, ...args], { cwd, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}
