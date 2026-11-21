// The process plumbing the CI scripts share (`throwaway-iris.mjs`, `ci-live-suite.mjs`, `ci-seed-throwaway.mjs`,
// `ci-package-smoke.mjs`).
//
// CONTRACT
//   - `isEntryPoint(moduleUrl)` is true only when the module whose `import.meta.url` is `moduleUrl` is the script this process
//     was started with (`node <file>`, through any symlink). An import of the module is never its entry point.
//   - `spawnInherited(argv, options)` runs `argv` with the parent's stdio and resolves with its exit code: the command's own
//     code, 128 + n when a signal ended it, 127 when it could not start (the reason is written to stderr under `label`).
//     `onChild` receives the child process as soon as it is spawned, so the caller can forward a signal to it.
//   Importing this module runs nothing.

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { pathToFileURL } from 'node:url';

/**
 * Whether the module whose `import.meta.url` is `moduleUrl` is the script this process was started with.
 *
 * @param {string} moduleUrl
 * @returns {boolean}
 */
export function isEntryPoint(moduleUrl) {
  if (process.argv[1] === undefined) return false;
  try {
    return moduleUrl === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch {
    return false;
  }
}

/**
 * Run `argv` with the parent's stdio and resolve with its exit code (see the header).
 *
 * @param {readonly string[]} argv
 * @param {{ label: string, env: Record<string, string | undefined>, cwd?: string, onChild?: (child: import('node:child_process').ChildProcess) => void }} options
 * @returns {Promise<number>}
 */
export function spawnInherited(argv, { label, env, cwd, onChild }) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: 'inherit' });
    onChild?.(child);
    child.once('error', (error) => {
      process.stderr.write(`${label}: could not run ${argv[0]}: ${error.message}\n`);
      resolve(127);
    });
    child.once('close', (code, signal) => resolve(code ?? 128 + (osConstants.signals[signal] ?? 1)));
  });
}
