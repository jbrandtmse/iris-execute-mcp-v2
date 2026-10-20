// ============================================================================
// capture-sdk-handler-golden.mjs - the SDK handler golden (Story 43.1 QA; AD-15, AD-32; Rule #36).
//
// WHAT THE GOLDEN IS
//   packages/iris-mcp-all/src/__tests__/fixtures/sdk-handler-golden.json holds, for each of the five built
//   servers run against the fake IRIS of scripts/lib/fake-iris-listener.mjs: the response line of each
//   tools/call in scripts/lib/sdk-handler-golden-core.mjs, the requests the server made to IRIS while it
//   answered, and the audit entries it wrote. The default-suite test
//   packages/iris-mcp-all/src/__tests__/story-43-1-qa-handler-golden.test.ts replays the same sessions
//   against the built servers.
//
// WHEN IT IS CAPTURED
//   Once, from the build that is the oracle: the tree BEFORE the MCP SDK migration (SDK v1). That tree does not
//   have this script, so run the script from the migrated tree and point --dist-root at the oracle build, for
//   example a `git worktree` of the baseline revision after `pnpm install --frozen-lockfile` and a build of
//   shared and the five servers. The file is never edited by hand and never regenerated from a newer build.
//
// USAGE (the command line of scripts/lib/golden-capture-cli.mjs; --dist-root is required here)
//   node scripts/capture-sdk-handler-golden.mjs --dist-root <oracle checkout> [--baseline-revision <sha>]
//       Writes the golden. REFUSES (exit 2, nothing written) when the fixture already exists.
//   node scripts/capture-sdk-handler-golden.mjs --dist-root <dir> --force
//       Overwrites an existing fixture. Legitimate only when the oracle itself is being replaced.
//   node scripts/capture-sdk-handler-golden.mjs --dist-root <dir> --out <path>
//       Writes to <path> instead (a second capture of one build, or a capture of the current build for comparison).
//
//   No IRIS instance is reached: every server talks to a listener on 127.0.0.1 inside this process.
//   Exit codes: 0 written; 1 unexpected error; 2 refusal, a stale or missing dist, or a bad flag.
// ============================================================================

import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { exitWithCaptureCode, runGoldenCapture } from './lib/golden-capture-cli.mjs';
import { GOLDEN_PACKAGES, HANDLER_GOLDEN_RELATIVE_PATH, readBootstrapVersion, runHandlerSession } from './lib/sdk-handler-golden-core.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** One handler session per server package, from the built dists under `distRoot`. */
async function capture({ distRoot, baseEnv }) {
  const bootstrapVersion = readBootstrapVersion(distRoot);
  const servers = {};
  let rowCount = 0;
  for (const pkg of GOLDEN_PACKAGES) {
    const entry = join(distRoot, 'packages', pkg, 'dist', 'index.js');
    // One server process at a time: a session depends on nothing but its own process and its own listener.
    // eslint-disable-next-line no-await-in-loop
    servers[pkg] = await runHandlerSession({ entry, baseEnv, pkg, bootstrapVersion });
    rowCount += servers[pkg].rows.length;
  }
  return { header: { bootstrapVersion }, servers, rowCount };
}

exitWithCaptureCode(
  'capture-sdk-handler-golden',
  runGoldenCapture(
    { name: 'capture-sdk-handler-golden', root: ROOT, relativePath: HANDLER_GOLDEN_RELATIVE_PATH, requireDistRoot: true, capture },
    process.argv.slice(2),
  ),
);
