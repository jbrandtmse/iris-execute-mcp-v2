// ============================================================================
// capture-sdk-wire-golden.mjs - the SDK wire golden (Story 43.1; AD-15, AD-32; Rule #36).
//
// WHAT THE GOLDEN IS
//   packages/iris-mcp-all/src/__tests__/fixtures/sdk-wire-golden.json holds, for each of the five built
//   servers, the verbatim response line to every request in the exchange list of
//   scripts/lib/sdk-wire-golden-core.mjs, on the 2025-11-25 era. The default-suite test
//   packages/iris-mcp-all/src/__tests__/story-43-1-sdk-wire-golden.test.ts replays the same list
//   against the built servers and compares byte for byte.
//
// WHEN IT IS CAPTURED
//   Once, from the build that is the oracle: the tree BEFORE the MCP SDK migration edits anything.
//   The file is never edited by hand and never regenerated to match a newer build.
//
// USAGE
//   node scripts/capture-sdk-wire-golden.mjs
//       Captures from the built dists and writes the golden. REFUSES (exit 2, nothing written) when
//       the fixture already exists.
//   node scripts/capture-sdk-wire-golden.mjs --force
//       Overwrites an existing fixture. Legitimate only when the oracle itself is being replaced.
//   node scripts/capture-sdk-wire-golden.mjs --out <path>
//       Writes to <path> instead (used to check that two captures of one build are identical).
//   node scripts/capture-sdk-wire-golden.mjs --baseline-revision <sha>
//       Records <sha> as `baselineRevision`; defaults to `git rev-parse HEAD`.
//
//   Every server is started against 127.0.0.1:1, a closed local port, so no IRIS instance is reached.
//   Exit codes: 0 written; 1 unexpected error; 2 refusal, a stale or missing dist, or a bad flag.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  CLOSED_PORT_ENV,
  GOLDEN_PACKAGES,
  GOLDEN_RELATIVE_PATH,
  goldenSessions,
  inheritedGoldenEnv,
  installedSdk,
  runGoldenSession,
} from './lib/sdk-wire-golden-core.mjs';
import { serializeSnapshot, staleDistMessage, staleDists } from './lib/tools-list-snapshot-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Parse the command line; returns `{ force, out, baselineRevision }` or `{ error }`. */
function parseArgs(argv) {
  const options = { force: false, out: undefined, baselineRevision: undefined };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--force') options.force = true;
    else if (arg === '--out' || arg === '--baseline-revision') {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value.` };
      if (arg === '--out') options.out = value;
      else options.baselineRevision = value;
      i += 1;
    } else return { error: `Unknown argument ${arg}.` };
  }
  return options;
}

/** The installed version of a package the shared package resolves, read from its manifest. */
function installedVersion(dep) {
  return String(JSON.parse(readFileSync(join(ROOT, 'packages', 'shared', 'node_modules', dep, 'package.json'), 'utf-8')).version);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.error) {
    console.error(`capture-sdk-wire-golden: ${options.error}`);
    return 2;
  }
  const target = options.out === undefined ? join(ROOT, GOLDEN_RELATIVE_PATH) : isAbsolute(options.out) ? options.out : resolve(process.cwd(), options.out);
  if (existsSync(target) && !options.force) {
    console.error(`capture-sdk-wire-golden: ${target} already exists; the golden is captured once from the oracle build. Pass --force to replace it.`);
    return 2;
  }
  const stale = staleDists(ROOT);
  if (stale.length > 0) {
    console.error(staleDistMessage(stale));
    return 2;
  }

  const baselineRevision = options.baselineRevision ?? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf-8' }).trim();
  const baseEnv = inheritedGoldenEnv(process.env);
  const servers = {};
  let rowCount = 0;
  for (const pkg of GOLDEN_PACKAGES) {
    const entry = join(ROOT, 'packages', pkg, 'dist', 'index.js');
    const sessions = {};
    for (const session of goldenSessions(pkg)) {
      // One server process at a time: the rows of a session depend on nothing but that process.
      // eslint-disable-next-line no-await-in-loop
      const rows = await runGoldenSession({ entry, baseEnv, session });
      sessions[session.id] = { protocolVersion: session.protocolVersion, env: session.env, rows };
      rowCount += rows.length;
    }
    servers[pkg] = { sessions };
  }

  const { sdkPackage, sdkVersion } = installedSdk(ROOT);
  const document = {
    capturedAt: new Date().toISOString(),
    baselineRevision,
    sdkPackage,
    sdkVersion,
    zodVersion: installedVersion('zod'),
    node: process.version,
    closedPortEnv: CLOSED_PORT_ENV,
    rowCount,
    servers,
  };
  writeFileSync(target, serializeSnapshot(document));
  console.log(`capture-sdk-wire-golden: wrote ${rowCount} rows for ${GOLDEN_PACKAGES.length} servers from ${sdkPackage}@${sdkVersion} to ${target}`);
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`capture-sdk-wire-golden: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
    process.exit(1);
  },
);
