// The command line that the golden capture scripts share (Story 43.1; AD-15, AD-32; Rule #36).
//
// `scripts/capture-sdk-wire-golden.mjs` and `scripts/capture-sdk-handler-golden.mjs` each record one golden from the
// built dists of an oracle checkout. Both take the same flags and write the same header, so both run through
// `runGoldenCapture`; each script supplies only its own capture.
//
// CONTRACT
//   Flags: `--force` (overwrite an existing fixture), `--out <path>` (write there instead of the fixture),
//   `--dist-root <dir>` (capture the built dists of another checkout, for example a `git worktree` of the oracle
//   revision; defaults to this checkout unless the script requires it), `--baseline-revision <sha>` (record it as
//   `baselineRevision`; defaults to `git rev-parse HEAD` in the dist root).
//   The run REFUSES, exit 2 and nothing written, when the target exists without `--force`, when a dist of the dist
//   root is missing or older than its source, or on a bad flag. Exit 0 means written; an unexpected error exits 1.
//   The document is `capturedAt`, `baselineRevision`, `sdkPackage`, `sdkVersion`, `zodVersion`, `node`, the script's own
//   header members, `rowCount` and `servers`, in that order, as `serializeSnapshot` writes JSON.

import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';

import { inheritedGoldenEnv, installedSdk } from './sdk-wire-golden-core.mjs';
import { installedVersion, serializeSnapshot, staleDistMessage, staleDists } from './tools-list-snapshot-core.mjs';

/**
 * Parse the command line.
 *
 * @param {string[]} argv - The arguments after the script path.
 * @returns {{ force: boolean, out?: string, distRoot?: string, baselineRevision?: string } | { error: string }}
 */
export function parseCaptureArgs(argv) {
  const options = { force: false, out: undefined, distRoot: undefined, baselineRevision: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') options.force = true;
    else if (arg === '--out' || arg === '--dist-root' || arg === '--baseline-revision') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value.` };
      if (arg === '--out') options.out = value;
      else if (arg === '--dist-root') options.distRoot = value;
      else options.baselineRevision = value;
      i += 1;
    } else return { error: `Unknown argument ${arg}.` };
  }
  return options;
}

/**
 * Run one capture script and return its exit code.
 *
 * @param {object} spec
 * @param {string} spec.name - The script's name, for its messages.
 * @param {string} spec.root - Repository root of the checkout the script runs from, which holds the fixture.
 * @param {string} spec.relativePath - Repository-relative path of the fixture.
 * @param {boolean} spec.requireDistRoot - Whether `--dist-root` must be given.
 * @param {(context: { distRoot: string, baseEnv: Record<string, string> }) => Promise<{ header: object, servers: object, rowCount: number }>} spec.capture
 *   Runs the sessions against the built dists under `distRoot`; `header` holds the script's own header members.
 * @param {string[]} argv - The arguments after the script path.
 * @returns {Promise<number>}
 */
export async function runGoldenCapture({ name, root, relativePath, requireDistRoot, capture }, argv) {
  const options = parseCaptureArgs(argv);
  const error = options.error ?? (requireDistRoot && options.distRoot === undefined ? '--dist-root <the oracle checkout> is required.' : undefined);
  if (error !== undefined) {
    console.error(`${name}: ${error}`);
    return 2;
  }
  const distRoot = options.distRoot === undefined ? root : resolve(process.cwd(), options.distRoot);
  const target = options.out === undefined ? join(root, relativePath) : isAbsolute(options.out) ? options.out : resolve(process.cwd(), options.out);
  if (existsSync(target) && !options.force) {
    console.error(`${name}: ${target} already exists; the golden is captured once from the oracle build. Pass --force to replace it.`);
    return 2;
  }
  const stale = staleDists(distRoot);
  if (stale.length > 0) {
    console.error(staleDistMessage(stale));
    return 2;
  }

  const baselineRevision = options.baselineRevision ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: distRoot, encoding: 'utf-8' }).trim();
  const { header, servers, rowCount } = await capture({ distRoot, baseEnv: inheritedGoldenEnv(process.env) });
  const { sdkPackage, sdkVersion } = installedSdk(distRoot);
  const document = {
    capturedAt: new Date().toISOString(),
    baselineRevision,
    sdkPackage,
    sdkVersion,
    zodVersion: installedVersion(distRoot, 'zod'),
    node: process.version,
    ...header,
    rowCount,
    servers,
  };
  writeFileSync(target, serializeSnapshot(document));
  console.log(`${name}: wrote ${rowCount} rows for ${Object.keys(servers).length} servers from ${sdkPackage}@${sdkVersion} to ${target}`);
  return 0;
}

/**
 * Exit the process with the code a capture run settles on, or 1 (with the error) when it throws.
 *
 * @param {string} name - The script's name, for the error message.
 * @param {Promise<number>} run
 */
export function exitWithCaptureCode(name, run) {
  run.then(
    (code) => process.exit(code),
    (error) => {
      console.error(`${name}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
      process.exit(1);
    },
  );
}
