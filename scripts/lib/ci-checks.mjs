// The code-declared CI registry (AD-29): every check that `.github/workflows/ci.yml` runs, in one place that the scripts and
// the tests import. `packages/iris-mcp-all/src/__tests__/ci-workflow.test.ts` holds the workflow equal to this module in both
// directions, so a check cannot be added to one and not the other, and a step cannot be dropped silently.
//
// CONTRACT
//   - PINS. The Node legs, the runner image, the three pinned actions and the host ports CI publishes are constants here.
//   - DECLARED_STEPS. For each job, the ordered `run` steps of the workflow, duplicates kept, each as
//     `{ run, workingDirectory?, if?, id? }`. A step that has no `run:` (an action) is not listed.
//   - LIVE_SUITES. Every armed suite CI runs, by id, as `node scripts/ci-live-suite.mjs <id>`. A suite is
//     `{ kind, cwd, command, expectedFiles(), allowedSkips }`:
//       kind 'vitest'   a vitest run that gets the JSON reporter; its report is classified (nothing may skip unlisted);
//       kind 'harness'  the same, started through `scripts/throwaway-iris.mjs run`, which makes its own container;
//       kind 'plain'    a command whose exit code is the whole verdict (no vitest report).
//     `cwd` and every file name are relative to the repository root; `expectedFiles()` are the test files that must appear
//     in the report; `allowedSkips` are `{ file, test, reason }` entries naming a test that always skips, by its full name.
//   - CI_LIVE_EXEMPTIONS. Live-capable `*.test.ts` files that run in no armed suite, each with its reason.
//   The packages are listed by hand in `PACKAGE_DIRS`, which the self-test holds equal to the workspace, so a new package fails
//   the self-test until it is added there. What each package has (its scripts, its roster, its integration files) is read from
//   disk when this module is imported, so a new gate file changes the registry without anyone editing it.
//   Importing this module runs nothing and writes nothing.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { IRISHEALTH_COMMUNITY_IMAGE, IRIS_COMMUNITY_IMAGE, OLDEST_IRIS_COMMUNITY_IMAGE, parseCli } from '../throwaway-iris.mjs';
import { LAUNCHER_DIR, PACKAGES_DIR, REPO_ROOT, readRoster, relativeToRepo, walk } from './live-gate-scan.mjs';

// -- pins ---------------------------------------------------------------------------------------------------

/** The Node legs of the `gates` job: the floor of each even major (the floor is `engines.node` of every package). */
export const NODE_LEGS = Object.freeze(['22.17.0', '24.0.0', '26.0.0']);

/** The runner every job uses. */
export const RUNNER = 'ubuntu-24.04';

/** The actions the workflow may use: `<owner>/<repo>`, the commit its release tag points at, and that tag. */
export const PINNED_ACTIONS = Object.freeze([
  Object.freeze({ action: 'actions/checkout', sha: 'fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09', tag: 'v5.1.0' }),
  Object.freeze({ action: 'actions/setup-node', sha: 'a0853c24544627f65ddf259abe73b1d18a591444', tag: 'v5.0.0' }),
  Object.freeze({ action: 'pnpm/action-setup', sha: 'fc06bc1257f339d1d5d8b3a19a8cae5388b55320', tag: 'v4.4.0' }),
]);

/**
 * The host ports the throwaway containers publish on the loopback address: `guard` for the bootstrap-guard suites, `live`
 * for the seeded IRIS for Health container. The workflow reserves exactly these with `net.ipv4.ip_local_reserved_ports`,
 * which keeps the runner's ephemeral ports off them.
 */
export const CI_HOST_PORTS = Object.freeze({ guard: '52790', live: '52791' });

/** The namespace of the seeded IRIS for Health container, where the armed rosters run. */
export const LIVE_NAMESPACE = 'HSCUSTOM';

/** The `timeout-minutes` of each job. */
export const JOB_TIMEOUT_MINUTES = Object.freeze({ gates: 60, throwaway: 150, package: 30 });

/** The images the workflow and the suites may name: the harness's digest constants. */
export const CI_IMAGES = Object.freeze([IRIS_COMMUNITY_IMAGE, OLDEST_IRIS_COMMUNITY_IMAGE, IRISHEALTH_COMMUNITY_IMAGE]);

// -- the workspace -------------------------------------------------------------------------------------------

/** The directory names under `packages/` that are published, in the order the CI steps list them. A new package must be added here. */
export const PACKAGE_DIRS = Object.freeze([
  'shared',
  'client-config',
  'iris-admin-mcp',
  'iris-data-mcp',
  'iris-dev-mcp',
  'iris-interop-mcp',
  'iris-ops-mcp',
  'iris-mcp-all',
]);

/**
 * The published packages, in {@link PACKAGE_DIRS} order: directory, package name, the short name CI uses in suite ids
 * (`@iris-mcp/admin` is `admin`), and what the package has that CI runs.
 *
 * @returns {Array<{ dir: string, name: string, short: string, hasTest: boolean, prepublishOnly: string | undefined, hasGateScript: boolean, hasIntegrationConfig: boolean }>}
 */
export function publishablePackages() {
  return PACKAGE_DIRS.map((dir) => {
    const packageDir = path.join(PACKAGES_DIR, dir);
    const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
    return {
      dir,
      name: manifest.name,
      short: String(manifest.name).replace(/^@iris-mcp\//, ''),
      hasTest: typeof manifest.scripts?.test === 'string',
      prepublishOnly: manifest.scripts?.prepublishOnly,
      hasGateScript: existsSync(path.join(packageDir, 'scripts', 'prepublish-gate.mjs')),
      hasIntegrationConfig: existsSync(path.join(packageDir, 'vitest.integration.config.ts')),
    };
  });
}

/** The root `live:bootstrap-guard` script's command (what the harness runs), read from the root manifest. */
export function bootstrapGuardCommand() {
  const script = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8')).scripts?.['live:bootstrap-guard'];
  if (typeof script !== 'string') throw new Error('the root package.json has no live:bootstrap-guard script.');
  const parsed = parseCli(script.split(/\s+/).filter((token) => token !== '').slice(2));
  return parsed.command;
}

/** The bootstrap-guard gate file the root script runs, relative to the repository root. */
export function bootstrapGuardFile() {
  const command = bootstrapGuardCommand();
  return `packages/iris-mcp-all/${command[command.length - 1]}`;
}

/** The five process gates of `@iris-mcp/all`: armed by `IRIS_REQUIRE_LIVE`, on no package roster. */
export const PROCESS_GATE_FILES = Object.freeze(
  ['credentials-cli-process-gate', 'governance-file-process-gate', 'host-guard-process-gate', 'server-manager-precedence-gate', 'server-manager-process-gate'].map(
    (name) => `packages/iris-mcp-all/src/__tests__/${name}.test.ts`,
  ),
);

/** The launcher's two live files, armed by `IRIS_REQUIRE_LIVE`. */
export const LAUNCHER_LIVE_FILES = Object.freeze(
  ['governanceUiRoundTrip', 'localSpawnIntegration'].map((name) => `extensions/iris-mcp-launcher/src/__tests__/${name}.test.ts`),
);

/** The launcher's arming guard, which runs in the `gates` job: the guard that no live file connects when unarmed, and the helper's own test. */
export const LAUNCHER_GUARD_FILES = Object.freeze(['src/__tests__/live-arming-guard.test.ts', 'src/__tests__/liveArming.test.ts']);

/** The launcher directory, relative to the repository root. */
export const LAUNCHER_RELATIVE_DIR = relativeToRepo(LAUNCHER_DIR);

// -- the armed suites ----------------------------------------------------------------------------------------

/** The `reason` of a golden-capture leg: it runs only when the capture CLI sets its variable. */
const CAPTURE_REASON = 'runs only under the golden-capture CLI (its STORY_39_<n>_CAPTURE variable), never in a gate run';

/**
 * Tests that skip in every armed run, by full name. An entry that matches no skipped test of its suite fails the suite as
 * stale. An environmental skip (DocDB, a keyring, a container user) is never listed before a run shows it.
 */
const CAPTURE_SKIPS = [
  ['story-39-1-message-search-live-gate', 'Story 39.1: the resendFiltered wire (AD-17, AD-33) capture: replay the resendFiltered request list against A and write the baseline'],
  ['story-39-2-data-policy-live-gate', 'Story 39.2: the pre-change preview capture (AD-15, AD-33) capture: the legacy REST preview and the tool preview, before the change'],
  ['story-39-3-body-search-live-gate', 'Story 39.3: the headers wire is unchanged (AD-15, AD-33) capture: replay the headers request list against A and C and write the baseline'],
  ['story-39-4-search-table-live-gate', 'Story 39.4: the headers and body wire is unchanged (AD-15, AD-33) capture: replay the request list against A and C and write the baseline'],
].map(([file, test]) => Object.freeze({ file: `packages/iris-mcp-all/src/__tests__/${file}.test.ts`, test, reason: CAPTURE_REASON }));

/** The reporter options CI appends to a vitest run; the JSON report lands where `--outputFile.json` says. */
export function reporterArgs(reportFile) {
  return ['--reporter=default', '--reporter=json', `--outputFile.json=${reportFile}`];
}

/** The `*.integration.test.ts` files under a package's `src`, relative to the repository root, sorted. */
function integrationFiles(dir) {
  return walk(path.join(PACKAGES_DIR, dir, 'src'), ['.integration.test.ts']).map(relativeToRepo).sort();
}

function buildLiveSuites() {
  const suites = {};

  const guardCommand = bootstrapGuardCommand();
  const guardFile = () => [bootstrapGuardFile()];
  suites['bootstrap-guard'] = {
    kind: 'harness',
    cwd: '.',
    command: ['node', 'scripts/throwaway-iris.mjs', 'run', '--image', IRIS_COMMUNITY_IMAGE, '--host-port', CI_HOST_PORTS.guard, '--', ...guardCommand],
    expectedFiles: guardFile,
    allowedSkips: [],
  };
  suites['bootstrap-guard-oldest'] = {
    kind: 'harness',
    cwd: '.',
    command: ['node', 'scripts/throwaway-iris.mjs', 'run', '--image', OLDEST_IRIS_COMMUNITY_IMAGE, '--host-port', CI_HOST_PORTS.guard, '--', ...guardCommand],
    expectedFiles: guardFile,
    allowedSkips: [],
  };

  const packages = publishablePackages();
  for (const pkg of packages.filter((candidate) => candidate.prepublishOnly !== undefined)) {
    suites[`prepublish-${pkg.short}`] = {
      kind: pkg.hasGateScript ? 'vitest' : 'plain',
      cwd: `packages/${pkg.dir}`,
      command: ['pnpm', 'run', 'prepublishOnly'],
      expectedFiles: () => (pkg.hasGateScript ? readRoster(path.join(PACKAGES_DIR, pkg.dir)).map((file) => `packages/${pkg.dir}/${file}`) : []),
      allowedSkips: pkg.dir === 'iris-mcp-all' ? CAPTURE_SKIPS : [],
    };
  }

  for (const pkg of packages.filter((candidate) => candidate.hasIntegrationConfig)) {
    suites[`integration-${pkg.short}`] = {
      kind: 'vitest',
      cwd: `packages/${pkg.dir}`,
      command: ['pnpm', 'exec', 'vitest', 'run', '--config', 'vitest.integration.config.ts'],
      expectedFiles: () => integrationFiles(pkg.dir),
      allowedSkips: [],
    };
  }

  suites['process-gates'] = {
    kind: 'vitest',
    cwd: 'packages/iris-mcp-all',
    command: ['pnpm', 'exec', 'vitest', 'run', ...PROCESS_GATE_FILES.map((file) => file.replace('packages/iris-mcp-all/', ''))],
    expectedFiles: () => [...PROCESS_GATE_FILES],
    allowedSkips: [],
  };
  suites['launcher-live'] = {
    kind: 'vitest',
    cwd: LAUNCHER_RELATIVE_DIR,
    command: ['npx', '--no', '--', 'vitest', 'run', ...LAUNCHER_LIVE_FILES.map((file) => file.replace(`${LAUNCHER_RELATIVE_DIR}/`, ''))],
    expectedFiles: () => [...LAUNCHER_LIVE_FILES],
    allowedSkips: [],
  };
  return suites;
}

/** Every armed suite, by id. */
export const LIVE_SUITES = Object.freeze(buildLiveSuites());

/** The ids of the suites that run inside the seeded throwaway (everything but the two that make their own container), in workflow order. */
export const SEEDED_SUITE_IDS = Object.freeze(Object.keys(LIVE_SUITES).filter((id) => LIVE_SUITES[id].kind !== 'harness'));

/** The ids of the two bootstrap-guard suites, which start their own container. */
export const HARNESS_SUITE_IDS = Object.freeze(Object.keys(LIVE_SUITES).filter((id) => LIVE_SUITES[id].kind === 'harness'));

/** Every test file a suite expects in its report, relative to the repository root, sorted. */
export function coveredTestFiles() {
  return [...new Set(Object.values(LIVE_SUITES).flatMap((suite) => suite.expectedFiles()))].sort();
}

/**
 * Live-capable `*.test.ts` files that run in no armed suite: each is covered by the default suite or by the `gates` job, and
 * says why it needs no armed run. A live-capable file that is in neither a suite nor this list fails the self-test.
 *
 * @type {ReadonlyArray<{ file: string, reason: string }>}
 */
export const CI_LIVE_EXEMPTIONS = Object.freeze(
  [
    [
      'extensions/iris-mcp-launcher/src/__tests__/liveArming.test.ts',
      "the unit test of the launcher's arming helper; it runs in the gates job (the launcher guard step) and reaches no IRIS",
    ],
    [
      'packages/iris-mcp-all/src/__tests__/live-gate-roster.test.ts',
      'reads the package rosters from disk and runs in the default suite (the gates job); it names the arming helpers in a detector sample and reaches no IRIS',
    ],
    [
      'packages/iris-mcp-all/src/__tests__/story-39-1-gate-guards.test.ts',
      "pins that the Story 39.1 gate stays unarmed on a child run under the connect-refusing preload; it runs in the default suite (the gates job) and reaches no IRIS",
    ],
    [
      'packages/iris-mcp-all/src/__tests__/story-42-2-qa-throwaway-wiring.test.ts',
      "reads the harness and the throwaway gate and calls the harness's pure helpers; it runs in the default suite (the gates job) and runs no docker",
    ],
    [
      'packages/shared/src/__tests__/integration-config.test.ts',
      "the unit test of the integration-config helper; it runs in the default suite (the gates job) and reaches no IRIS",
    ],
  ].map(([file, reason]) => Object.freeze({ file, reason })),
);

// -- the workflow's steps ------------------------------------------------------------------------------------

const IF_SETUP = "${{ !cancelled() && steps.setup.outcome == 'success' }}";
const IF_UP = "${{ !cancelled() && steps.up.outcome == 'success' }}";
const IF_SEED = "${{ !cancelled() && steps.seed.outcome == 'success' }}";
const STATE_FILE = '${{ runner.temp }}/throwaway-live.json';
const HARNESS = 'node scripts/throwaway-iris.mjs';

/** The checks of the `gates` job that are npm scripts of the root, in order. */
const ROOT_GATE_SCRIPTS = Object.freeze([
  'pnpm gen:governance-baseline:check',
  'pnpm gen:skills:check',
  'pnpm gen:pack:check',
  'pnpm validate:prompts',
  'pnpm check:provenance',
  'pnpm gen:tools-list-snapshot:check',
  'node scripts/check-epics-sync.mjs',
]);

function buildDeclaredSteps() {
  const packages = publishablePackages();
  const launcher = { workingDirectory: LAUNCHER_RELATIVE_DIR };
  const gates = [
    { run: 'pnpm install --frozen-lockfile' },
    { run: 'pnpm build' },
    { run: 'pnpm lint' },
    { run: 'pnpm type-check' },
    ...packages.filter((pkg) => pkg.hasTest).map((pkg) => ({ run: `pnpm --filter ${pkg.name} test` })),
    ...ROOT_GATE_SCRIPTS.map((run) => ({ run })),
    { run: 'npm ci', ...launcher },
    { run: 'npm run type-check', ...launcher },
    { run: 'npm run build', ...launcher },
    { run: `npx --no -- vitest run ${LAUNCHER_GUARD_FILES.join(' ')}`, ...launcher },
  ];

  const throwaway = [
    { run: 'pnpm install --frozen-lockfile' },
    { run: 'pnpm build' },
    { run: 'npm ci', ...launcher },
    { run: 'cat /proc/sys/net/ipv4/ip_local_port_range' },
    { run: `sudo sysctl -w net.ipv4.ip_local_reserved_ports=${CI_HOST_PORTS.guard},${CI_HOST_PORTS.live}`, id: 'setup' },
    ...HARNESS_SUITE_IDS.map((id) => ({ run: `node scripts/ci-live-suite.mjs ${id}`, if: IF_SETUP })),
    {
      run: `${HARNESS} up --image ${IRISHEALTH_COMMUNITY_IMAGE} --namespace ${LIVE_NAMESPACE} --host-port ${CI_HOST_PORTS.live} --state ${STATE_FILE}`,
      id: 'up',
      if: IF_SETUP,
    },
    { run: `${HARNESS} exec --state ${STATE_FILE} -- node scripts/ci-seed-throwaway.mjs`, id: 'seed', if: IF_UP },
    ...SEEDED_SUITE_IDS.map((id) => ({ run: `${HARNESS} exec --state ${STATE_FILE} -- node scripts/ci-live-suite.mjs ${id}`, if: IF_SEED })),
    { run: `${HARNESS} logs --state ${STATE_FILE}`, if: '${{ failure() || cancelled() }}' },
    { run: `${HARNESS} down --state ${STATE_FILE}`, if: '${{ always() }}' },
  ];

  const packageJob = [{ run: 'pnpm install --frozen-lockfile' }, { run: 'pnpm build' }, { run: 'node scripts/ci-package-smoke.mjs' }];

  return { gates, throwaway, package: packageJob };
}

/** Per job, the ordered `run` steps of the workflow (see the header). */
export const DECLARED_STEPS = Object.freeze(buildDeclaredSteps());
