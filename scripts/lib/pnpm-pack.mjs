// `pnpm pack` of one workspace package, with its tarball extracted: the packer that publishing goes through. Only pnpm applies a
// package's `publishConfig` overrides (such as `exports`) and rewrites `workspace:*` dependencies to the exact version.
//
// Shared by the pack tests of `packages/iris-mcp-all` (through `src/__tests__/pack-fixture.ts`, which re-exports it) and by
// `scripts/ci-package-smoke.mjs`. Nothing is written outside the destination directory the caller names.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Run `command` with `args` in `cwd`, collecting its output. A `.cmd` shim needs a shell on Windows; `tar` does not.
 *
 * @returns {{ status: number | null, stdout: string, stderr: string }}
 */
function runTool(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, npm_config_update_notifier: 'false', NO_UPDATE_NOTIFIER: '1' },
    timeout: 120_000,
    shell: process.platform === 'win32' && command !== 'tar',
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

/** The forward-slash paths of every file under `root`, relative to it, sorted. */
function walkRelative(root, directory = '') {
  const found = [];
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const rel = directory === '' ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...walkRelative(root, rel));
    else found.push(rel);
  }
  return found.sort();
}

/**
 * Pack `packageDir` with `pnpm pack` into `destination`, and extract the tarball next to it.
 *
 * By default lifecycle scripts (`prepack`, `prepare`, `postpack`) are not run: the tarball is built from the dist the caller has
 * already checked is fresh, and no publish gate runs inside the default suite. With `ignoreScripts: false` they run, as they do
 * on the real packing path.
 *
 * @param {string} packageDir - Absolute path of the package directory.
 * @param {string} destination - A directory under `os.tmpdir()` that holds no other tarball (pnpm creates it when it is missing); the tarball goes in it, and `extracted/` holds its contents.
 * @param {{ ignoreScripts?: boolean }} [options]
 * @returns {{ tarball: string, bytes: number, root: string, files: string[], manifest: Record<string, unknown> }}
 *   The tarball path and size, the extracted `package/` directory, its files (forward-slash, sorted) and the packed `package.json`.
 */
export function pnpmPack(packageDir, destination, { ignoreScripts = true } = {}) {
  const args = [...(ignoreScripts ? ['--config.ignore-scripts=true'] : []), 'pack', '--pack-destination', destination];
  const packed = runTool('pnpm', args, packageDir);
  if (packed.status !== 0) throw new Error(`pnpm pack failed in ${packageDir}: ${packed.stderr || packed.stdout}`);
  const tarballs = readdirSync(destination).filter((name) => name.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`pnpm pack in ${packageDir} wrote ${tarballs.length} tarballs to ${destination}`);
  const tarball = join(destination, tarballs[0]);
  const extractDir = join(destination, 'extracted');
  mkdirSync(extractDir);
  const extracted = runTool('tar', ['-xzf', tarball, '-C', extractDir], destination);
  if (extracted.status !== 0) throw new Error(`tar could not extract ${tarball}: ${extracted.stderr}`);
  const root = join(extractDir, 'package');
  return {
    tarball,
    bytes: statSync(tarball).size,
    root,
    files: walkRelative(root),
    manifest: JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
  };
}
