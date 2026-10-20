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
// USAGE (the command line of scripts/lib/golden-capture-cli.mjs)
//   node scripts/capture-sdk-wire-golden.mjs
//       Captures from the built dists of this checkout and writes the golden. REFUSES (exit 2, nothing
//       written) when the fixture already exists.
//   node scripts/capture-sdk-wire-golden.mjs --force
//       Overwrites an existing fixture. Legitimate only when the oracle itself is being replaced.
//   node scripts/capture-sdk-wire-golden.mjs --dist-root <dir>
//       Captures from the built dists of another checkout, for example a `git worktree` of the oracle revision.
//   node scripts/capture-sdk-wire-golden.mjs --out <path>
//       Writes to <path> instead (used to check that two captures of one build are identical).
//   node scripts/capture-sdk-wire-golden.mjs --baseline-revision <sha>
//       Records <sha> as `baselineRevision`; defaults to `git rev-parse HEAD` in the dist root.
//
//   Every server is started against 127.0.0.1:1, a closed local port, so no IRIS instance is reached.
//   Exit codes: 0 written; 1 unexpected error; 2 refusal, a stale or missing dist, or a bad flag.
// ============================================================================

import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { exitWithCaptureCode, runGoldenCapture } from './lib/golden-capture-cli.mjs';
import { CLOSED_PORT_ENV, GOLDEN_PACKAGES, GOLDEN_RELATIVE_PATH, goldenSessions, runGoldenSession } from './lib/sdk-wire-golden-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every session of every server package, from the built dists under `distRoot`. */
async function capture({ distRoot, baseEnv }) {
  const servers = {};
  let rowCount = 0;
  for (const pkg of GOLDEN_PACKAGES) {
    const entry = join(distRoot, 'packages', pkg, 'dist', 'index.js');
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
  return { header: { closedPortEnv: CLOSED_PORT_ENV }, servers, rowCount };
}

exitWithCaptureCode(
  'capture-sdk-wire-golden',
  runGoldenCapture(
    { name: 'capture-sdk-wire-golden', root: ROOT, relativePath: GOLDEN_RELATIVE_PATH, requireDistRoot: false, capture },
    process.argv.slice(2),
  ),
);
