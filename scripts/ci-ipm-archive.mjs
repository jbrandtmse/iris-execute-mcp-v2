#!/usr/bin/env node
// Builds the IPM archive of the ExecuteMCPv2 package from the generated embed, and proves that one archive installs, offline, on
// both IRIS editions (Story 42.4; AC 42.4.2, AC 42.4.4; DW-34, DW-674).
//
// USE
//   node scripts/ci-ipm-archive.mjs [--edition community|health]     (default: both editions)
//   CI runs it as the last step of the `ipm` job. It needs docker, the built `@iris-mcp/shared` (`pnpm build`) and a checked-in
//   `ipm/module.xml` that `pnpm gen:bootstrap` wrote from the same embed.
//
// CONTRACT
//   1. PREFLIGHT, before any container: the shared dist exports the embed, no embedded class still holds the `dev` placeholder, the
//      stamped markers are the embed's, and `ipm/module.xml` names the embed's module at the embed's semver (exit 2).
//   2. NOTHING IS FETCHED. All three containers run `--network none` (the harness starts them with it and re-inspects
//      `HostConfig.NetworkMode === "none"` and no published port before every session), IPM is imported from the copy every image
//      carries (`/usr/irissys/dist/install/misc/zpm.xml`), and `%IPM_Repo.Definition` is read after the import and after every
//      verb: it must hold 0 rows each time.
//   3. BUILD. The embed is staged (`stageModule`: `module.xml`, `src/cls/**`, `preload/src/cls/ExecuteMCPv2/InstallGuard.cls`) and
//      mounted read-only into a fresh `iris-community:2026.2` container (`USER`). There IPM runs `load -dev` and then `package`;
//      exactly one `.tgz` must appear in the emptied output directory, and it is copied out. The archive is read on the host: the
//      member set must equal the embed (35 classes, the guard, no test or fixture member), each member must equal the embed after
//      LF and trailing-whitespace normalization, and the manifest it carries must declare what `ipm/module.xml` declares.
//   4. INSTALL, community (`USER`): on a fresh container, three synthetic `ExecuteMCPv2.Setup` classes (marker newer, `dev`,
//      no `BOOTSTRAPVERSION`) are each loaded and the archive's `load` must FAIL with the install guard's text, leaving Setup's
//      marker as it was, no module in `list`, and no repository row; a synthetic older Setup then installs. The checks of the I/O
//      matrix follow: `list` names the module and version; exactly 36 compiled, up-to-date `ExecuteMCPv2.*` classes and none a
//      test or fixture class; `GetBootstrapVersion()` is `BOOTSTRAP_VERSION`; the web application has the install namespace,
//      `ExecuteMCPv2.REST.Dispatch`, `Enabled=1` and empty `MatchRoles`; `%ALL` maps the package; a GET of the application
//      from inside the container answers 200.
//   5. INSTALL, health (`HSCUSTOM`, `irishealth-community`): a fresh container with no Setup installs the same archive, and the
//      same checks hold.
//   6. PARITY. In each install container `ExecuteMCPv2.InstallGuard.Classify` is run over every case of the shared table
//      (`packages/shared/src/__tests__/fixtures/bootstrap-marker-parity-cases.json`) and three cases built from the embedded marker; each
//      answer must equal `classifyDeployedMarker` of the shared dist.
//   7. The only IPM verbs any session issues are `load`, `package` and `list` (`scripts/lib/ipm-archive.mjs`, `IPM_VERBS`). The script
//      has no `install`, `publish`, `repo`, `enable` or `update` anywhere, publishes nothing and reads no secret.
//   8. Every container is started and removed only through `scripts/throwaway-iris.mjs`; this script builds no docker argument. A
//      container is removed on every exit path, SIGINT and SIGTERM included, and so is the temporary directory. A failing
//      phase prints the container's log before the container is removed.
//
// EXIT CODES
//   0 passed; 1 a check failed (the message names the phase and the edition); 2 usage or a refusal (a bad option, a missing dist,
//   an embed that is not stamped); 3 docker is not on PATH; 4 a container did not start or become ready.
//
// IMPORT
//   Importing this module runs nothing. `runIpmArchive(options)` takes the environment, the repository root and the harness
//   dependencies as options.

import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  IRISHEALTH_COMMUNITY_IMAGE,
  IRIS_COMMUNITY_IMAGE,
  NETWORK_NONE,
  copyHarness,
  createTeardown,
  defaultDeps,
  downHarness,
  logsHarness,
  sessionHarness,
  upHarness,
} from './throwaway-iris.mjs';
import {
  GUARD_REFUSAL_TEXT,
  INSTALL_MOUNT,
  OUTPUT_DIRECTORY,
  STAGE_MOUNT,
  REST_APP,
  archiveNames,
  archiveProblems,
  deleteSetupScript,
  embedProblems,
  importIpmScript,
  installChecksScript,
  ipmCommandScript,
  listOutputScript,
  listedVersion,
  loadEmbed,
  loadSyntheticSetupScript,
  manifestDeclarations,
  manifestProblems,
  markerSemver,
  markerValue,
  outputDirectoryScript,
  parityProblems,
  parityScript,
  seedMarkers,
  setupStateScript,
  stageModule,
  synthesizedSetup,
} from './lib/ipm-archive.mjs';
import { REPO_ROOT } from './lib/live-gate-scan.mjs';
import { isEntryPoint } from './lib/script-process.mjs';

/** The editions the proof installs on: the image, the namespace the archive is installed into, and the label of the container. */
export const EDITIONS = Object.freeze({
  community: Object.freeze({ image: IRIS_COMMUNITY_IMAGE, namespace: 'USER' }),
  health: Object.freeze({ image: IRISHEALTH_COMMUNITY_IMAGE, namespace: 'HSCUSTOM' }),
});

/** The relative path of the shared case table. */
const PARITY_CASES_FILE = path.join('packages', 'shared', 'src', '__tests__', 'fixtures', 'bootstrap-marker-parity-cases.json');

/** The name of the archive inside the install directory. */
const ARCHIVE_NAME = 'iris-execute-mcp-v2.tgz';

/** A failed phase: the exit code and the message that names the phase and the edition. */
export class PhaseFailure extends Error {
  /** @param {string} phase @param {string} message @param {{ code?: number, edition?: string }} [options] */
  constructor(phase, message, { code = 1, edition } = {}) {
    super(`FAILED in the ${phase} phase${edition === undefined ? '' : ` (${edition})`}: ${message}`);
    this.name = 'PhaseFailure';
    this.code = code;
    this.phase = phase;
  }
}

/**
 * Parse the command line.
 *
 * @param {readonly string[]} argv
 * @returns {{ editions: Array<keyof typeof EDITIONS> }}
 */
export function parseArgs(argv) {
  const usage = 'usage: node scripts/ci-ipm-archive.mjs [--edition community|health]';
  if (argv.length === 0) return { editions: ['community', 'health'] };
  if (argv.length === 2 && argv[0] === '--edition' && Object.hasOwn(EDITIONS, argv[1])) return { editions: [argv[1]] };
  throw new PhaseFailure('usage', usage, { code: 2 });
}

/** The last `count` lines of a text. */
const tail = (text, count) => String(text).trimEnd().split('\n').slice(-count).join('\n');

/**
 * Prepare a run of the proof. `run()` resolves with the exit code (see the header); `cleanup()` removes every container and the
 * temporary directory this run still holds, and is idempotent and synchronous, for exit and signal handlers.
 *
 * @param {{
 *   editions?: Array<keyof typeof EDITIONS>,
 *   env?: Record<string, string | undefined>,
 *   repoRoot?: string,
 *   log?: (line: string) => void,
 *   harnessDeps?: ReturnType<typeof defaultDeps>,
 *   tmpRoot?: string,
 *   onContainer?: (container: { label: string, id: string, teardown: ReturnType<typeof createTeardown> }) => void,
 * }} [options]
 * @returns {{ run: () => Promise<number>, cleanup: () => void }}
 */
export function startRun(options = {}) {
  const env = options.env ?? process.env;
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const editions = options.editions ?? ['community', 'health'];
  const log = options.log ?? ((line) => process.stderr.write(`${line}\n`));
  const say = (line) => log(`ci-ipm-archive: ${line}`);
  const harnessDeps = options.harnessDeps ?? defaultDeps(env);

  /** Every container this run started and has not removed yet. */
  const containers = [];
  let root;
  let counter = 0;
  /** The last session's phase and output, for the failure report. */
  let lastSession = { phase: '', output: '' };

  const cleanup = () => {
    for (const container of containers) container.teardown.run();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  };

  // -- containers and sessions -----------------------------------------------------------

  async function startContainer({ label, image, namespace, mountDirectory, mountName, phase, edition }) {
    const stateFile = path.join(root, `${label}.json`);
    const teardown = createTeardown((args) => harnessDeps.docker(args, { timeoutMs: 120_000 }));
    // Registered before the harness starts the container: a signal while it waits for the container's session finds the teardown the
    // harness armed (the container's generated name) and removes the container.
    const container = { label, stateFile, namespace, id: undefined, name: undefined, teardown };
    containers.push(container);
    say(`[${phase}] starting ${label}: ${image.split('@')[0]}, namespace ${namespace}, --network ${NETWORK_NONE}`);
    const code = await upHarness(
      { image, namespace, network: NETWORK_NONE, mount: `${mountDirectory}:/opt/iris-mcp/${mountName}`, state: stateFile, env },
      harnessDeps,
      teardown,
    );
    if (code !== 0) {
      // The harness removed the container it failed to start.
      containers.splice(containers.indexOf(container), 1);
      throw new PhaseFailure(phase, `the ${label} container did not start (the harness exited ${code}).`, { code: [2, 3, 4].includes(code) ? code : 4, edition });
    }
    const state = JSON.parse(readFileSync(stateFile, 'utf8'));
    teardown.arm(state.id);
    container.id = state.id;
    container.name = state.name;
    options.onContainer?.({ label, id: state.id, teardown });
    if (state.network !== NETWORK_NONE || state.port !== undefined) {
      throw new PhaseFailure(phase, `the ${label} container does not run with --network ${NETWORK_NONE}: its state records ${JSON.stringify({ network: state.network, port: state.port })}.`, { code: 2, edition });
    }
    say(`[${phase}] ${label} is ${state.name}, running with no network`);
    return container;
  }

  async function removeContainer(container) {
    const code = await downHarness({ state: container.stateFile, env }, harnessDeps);
    if (code !== 0) {
      say(`the harness could not remove ${container.name} (exit ${code}); the exit handler tries again.`);
      return;
    }
    container.teardown.disarm();
    containers.splice(containers.indexOf(container), 1);
  }

  /** Pipe a script into the container's session; returns the output. A session that does not finish is a failure of `phase`. */
  async function session(container, script, phase, edition, namespace = container.namespace) {
    // The run is a chain of synchronous docker calls; yielding to the event loop here is what lets a SIGINT or SIGTERM handler run between them.
    await new Promise((resolve) => setImmediate(resolve));
    counter += 1;
    const scriptFile = path.join(root, `script-${counter}.mos`);
    writeFileSync(scriptFile, script, 'utf8');
    let output = '';
    const code = await sessionHarness({ state: container.stateFile, namespace, script: scriptFile, env }, { ...harnessDeps, out: (text) => (output += text) });
    lastSession = { phase, output };
    if (code !== 0) throw new PhaseFailure(phase, `the session on ${container.label} exited ${code}.`, { edition });
    return output;
  }

  const value = (output, name) => markerValue(output, name);
  const need = (condition, phase, edition, message) => {
    if (!condition) throw new PhaseFailure(phase, message, { edition });
  };

  /** The repository count of a session, which must be 0. */
  const noRepositories = (output, phase, edition, after) => {
    const rows = value(output, 'REPOSITORIES');
    need(rows === '0', phase, edition, `%IPM_Repo.Definition holds ${rows === undefined ? 'an unread number of' : rows} row(s) after ${after}; the proof requires 0 at every read, so that nothing it ran could reach a registry.`);
  };

  /** Import IPM from the image's offline copy and read the repository count. */
  async function importIpm(container, phase, edition) {
    const output = await session(container, importIpmScript(), phase, edition);
    need(value(output, 'IPM') === 'OK', phase, edition, `IPM did not import on ${container.label}: ${value(output, 'IPM') ?? tail(output, 10)}`);
    noRepositories(output, phase, edition, 'the IPM import');
    say(`[${phase}] IPM imported on ${container.label}; %IPM_Repo.Definition holds 0 rows`);
  }

  /** Run one IPM command; returns `{ outcome, output }` without judging the outcome. */
  async function ipm(container, command, phase, edition) {
    const output = await session(container, ipmCommandScript(command), phase, edition);
    noRepositories(output, phase, edition, `\`${command.split(' ')[0]}\``);
    return { outcome: value(output, 'COMMAND'), output };
  }

  // -- the phases ------------------------------------------------------------------------

  async function build(embed, directories) {
    const phase = 'build';
    stageModule(directories.stage, embed);
    say(`[${phase}] staged ${embed.classes.size + 1} classes and the manifest from the embed ${embed.marker} (not from src/)`);
    const container = await startContainer({ label: 'build', image: EDITIONS.community.image, namespace: 'USER', mountDirectory: directories.stage, mountName: 'stage', phase, edition: 'community' });
    await importIpm(container, phase, 'community');
    const loaded = await ipm(container, `load -dev ${STAGE_MOUNT}`, phase, 'community');
    need(loaded.outcome === 'OK', phase, 'community', `load -dev of the staged module did not succeed: ${loaded.outcome ?? tail(loaded.output, 20)}`);
    const cleared = await session(container, outputDirectoryScript(), phase, 'community');
    need(value(cleared, 'OUTDIR') === '1', phase, 'community', `the output directory ${OUTPUT_DIRECTORY} could not be emptied and created.`);
    const packaged = await ipm(container, `package ${embed.moduleName} -path ${OUTPUT_DIRECTORY}/${embed.moduleName}`, phase, 'community');
    need(packaged.outcome === 'OK', phase, 'community', `the package verb did not complete: ${packaged.outcome ?? tail(packaged.output, 20)}`);
    const listed = await session(container, listOutputScript(), phase, 'community');
    const archives = archiveNames(value(listed, 'FILES'));
    need(archives.length === 1, phase, 'community', `${OUTPUT_DIRECTORY} holds ${archives.length} archive(s) (${archives.join(', ')}); package must leave exactly one .tgz, because the file name is read back and never predicted.`);
    const copied = await copyHarness({ state: container.stateFile, from: `${OUTPUT_DIRECTORY}/${archives[0]}`, to: directories.archive, env }, harnessDeps);
    need(copied === 0, phase, 'community', `the archive could not be copied out of ${container.label} (exit ${copied}).`);
    chmodSync(directories.archive, 0o644);
    await removeContainer(container);
    say(`[${phase}] built ${archives[0]} (${readFileSync(directories.archive).length} bytes) and removed the build container`);
  }

  function checkArchive(embed, directories) {
    const phase = 'archive';
    const listing = spawnSync('tar', ['tzf', directories.archive], { encoding: 'utf8' });
    need(listing.status === 0, phase, undefined, `tar could not list the archive: ${listing.stderr ?? listing.error?.message}`);
    const members = listing.stdout.split('\n').filter((line) => line !== '');
    const extracted = spawnSync('tar', ['xzf', directories.archive, '-C', directories.extract], { encoding: 'utf8' });
    need(extracted.status === 0, phase, undefined, `tar could not extract the archive: ${extracted.stderr ?? extracted.error?.message}`);
    const problems = archiveProblems(members, directories.extract, embed);
    const archivedManifest = path.join(directories.extract, 'module.xml');
    if (existsSync(archivedManifest)) {
      problems.push(...manifestProblems(manifestDeclarations(embed.moduleXml), manifestDeclarations(readFileSync(archivedManifest, 'utf8'))));
    }
    need(problems.length === 0, phase, undefined, `the archive differs from the embed:\n  - ${problems.slice(0, 20).join('\n  - ')}`);
    const declared = manifestDeclarations(embed.moduleXml);
    say(`[${phase}] ${members.length} members: module.xml, ${embed.classes.size} classes equal to the embed, the preloaded guard, no test or fixture member; the manifest declares the same ${declared.resources.length} resources and ${declared.invokes.length} invokes as ipm/module.xml`);
  }

  /** Write the install directory: the archive, the synthetic Setup classes and the parity cases. */
  function prepareInstallDirectory(embed, directories) {
    mkdirSync(directories.install, { recursive: true, mode: 0o755 });
    copyFileSync(directories.archive, path.join(directories.install, ARCHIVE_NAME));
    const seeds = seedMarkers(embed.marker, embed.parse);
    for (const [leg, marker] of Object.entries(seeds)) {
      writeFileSync(path.join(directories.install, `setup-${leg}.cls`), synthesizedSetup(marker), 'utf8');
    }
    const fixture = JSON.parse(readFileSync(path.join(directories.repoRoot, PARITY_CASES_FILE), 'utf8'));
    const runtime = [
      { note: 'runtime: the embedded marker itself', deployed: embed.marker, embedded: embed.marker },
      { note: 'runtime: the older seed against the embedded marker', deployed: seeds.older, embedded: embed.marker },
      { note: 'runtime: the newer seed against the embedded marker', deployed: seeds.newer, embedded: embed.marker },
    ].map((entry) => ({ ...entry, expected: embed.classify(entry.deployed, entry.embedded) }));
    const cases = [...fixture, ...runtime];
    const text = JSON.stringify(cases, null, 2).replace(/[\u0080-\uFFFF]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    writeFileSync(path.join(directories.install, 'cases.json'), `${text}\n`, 'utf8');
    for (const entry of ['cases.json', ...Object.keys(seeds).map((leg) => `setup-${leg}.cls`), ARCHIVE_NAME]) chmodSync(path.join(directories.install, entry), 0o644);
    return { cases, seeds };
  }

  const archiveInContainer = `${INSTALL_MOUNT}/${ARCHIVE_NAME}`;

  /** One guard leg: seed a synthetic Setup, and the archive's `load` must be refused with nothing changed. */
  async function guardLeg(container, embed, leg, seedMarker, edition) {
    const phase = `guard-${leg}`;
    const seeded = await session(container, loadSyntheticSetupScript(`${INSTALL_MOUNT}/setup-${leg}.cls`), phase, edition);
    need(value(seeded, 'SYNTH') === 'OK', phase, edition, `the synthetic Setup could not be loaded: ${value(seeded, 'SYNTH') ?? tail(seeded, 10)}`);
    const before = value(await session(container, setupStateScript(), phase, edition), 'SETUP');
    need(before !== undefined && before.startsWith('compiled:'), phase, edition, `the synthetic Setup is not compiled (the namespace reports ${JSON.stringify(before)}).`);

    const loaded = await ipm(container, `load ${archiveInContainer}`, phase, edition);
    const failure = loaded.outcome ?? '';
    need(failure.startsWith('FAILED:'), phase, edition, `load of the archive over a Setup marked ${JSON.stringify(seedMarker)} succeeded or printed no outcome (${JSON.stringify(failure.slice(0, 200))}); the guard must refuse it.`);
    need(failure.includes(GUARD_REFUSAL_TEXT), phase, edition, `the load failed, but not with the install guard's text (${GUARD_REFUSAL_TEXT}): ${failure.slice(0, 400)}`);
    need(failure.includes(embed.marker), phase, edition, `the refusal does not name this package's marker ${embed.marker}: ${failure.slice(0, 400)}`);
    if (seedMarker !== null) need(failure.includes(seedMarker), phase, edition, `the refusal does not name the deployed marker ${seedMarker}: ${failure.slice(0, 400)}`);

    const state = await session(container, setupStateScript(), phase, edition);
    need(value(state, 'SETUP') === before, phase, edition, `Setup changed from ${JSON.stringify(before)} to ${JSON.stringify(value(state, 'SETUP'))}: a refused load must leave the deployment as it was.`);
    need(value(state, 'GUARD') === '0', phase, edition, 'the install guard class is still defined after the refusal, so the namespace would read as installed by IPM.');
    const listed = await ipm(container, 'list', phase, edition);
    need(listedVersion(listed.output, embed.moduleName) === undefined, phase, edition, `list shows ${embed.moduleName} after a refused install.`);

    const deleted = await session(container, deleteSetupScript(), phase, edition);
    need(value(deleted, 'DELETE') === 'OK', phase, edition, `the synthetic Setup could not be deleted: ${value(deleted, 'DELETE')}`);
    need(value(await session(container, setupStateScript(), phase, edition), 'SETUP') === 'absent', phase, edition, 'Setup is still defined after the synthetic class was deleted.');
    say(`[${phase}] the guard refused the load over ${seedMarker === null ? 'a Setup with no BOOTSTRAPVERSION' : JSON.stringify(seedMarker)}; Setup unchanged, no module listed, 0 repository rows`);
  }

  /** The install checks of the I/O matrix, after the archive was loaded. */
  async function installChecks(container, embed, edition, cases) {
    const phase = `install-${edition}`;
    const semver = markerSemver(embed.marker);
    const listed = await ipm(container, 'list', phase, edition);
    need(listedVersion(listed.output, embed.moduleName) === semver, phase, edition, `list names ${embed.moduleName} at ${JSON.stringify(listedVersion(listed.output, embed.moduleName))}, not ${semver}.`);
    const output = await session(container, installChecksScript(), phase, edition);
    // The classes of classes[] plus the preloaded guard.
    const expectedClasses = embed.classes.size + 1;
    need(value(output, 'COMPILED') === String(expectedClasses), phase, edition, `${value(output, 'COMPILED')} ExecuteMCPv2 classes are compiled and up to date, not ${expectedClasses} (the ${embed.classes.size} of classes[] and the guard).`);
    need(value(output, 'TESTCLASSES') === '0', phase, edition, `${value(output, 'TESTCLASSES')} compiled class(es) are test or fixture classes; the archive carries none.`);
    need(value(output, 'VERSION') === embed.marker, phase, edition, `GetBootstrapVersion() answers ${JSON.stringify(value(output, 'VERSION'))}, not ${embed.marker}.`);
    const expectedApp = `${container.namespace}|ExecuteMCPv2.REST.Dispatch|1|`;
    need(value(output, 'APP') === expectedApp, phase, edition, `the web application ${REST_APP} reads ${JSON.stringify(value(output, 'APP'))}, not ${JSON.stringify(expectedApp)} (namespace, dispatch class, enabled, no MatchRoles).`);
    need(value(output, 'MAPPED') === '1', phase, edition, 'the %ALL namespace does not map the ExecuteMCPv2 package.');
    need(value(output, 'HTTP') === '200', phase, edition, `a GET of ${REST_APP}/config/namespace from inside the container answered ${JSON.stringify(value(output, 'HTTP'))}, not 200.`);
    say(`[${phase}] list: ${embed.moduleName} ${semver}; ${expectedClasses} classes compiled (none a test or fixture); marker ${embed.marker}; ${REST_APP} in ${container.namespace} with no MatchRoles, %ALL mapped, GET answers 200`);

    const parity = await session(container, parityScript(`${INSTALL_MOUNT}/cases.json`), `parity-${edition}`, edition);
    const raw = value(parity, 'PARITY');
    need(raw !== undefined, `parity-${edition}`, edition, `the parity run printed no result: ${tail(parity, 10)}`);
    const results = raw.split(',').slice(0, -1);
    const problems = parityProblems(cases, results, embed.classify);
    need(problems.length === 0, `parity-${edition}`, edition, `InstallGuard.Classify and classifyDeployedMarker disagree on ${problems.length} case(s):\n  - ${problems.join('\n  - ')}`);
    say(`[parity-${edition}] ${cases.length}/${cases.length} cases agree between InstallGuard.Classify and classifyDeployedMarker`);
  }

  async function installCommunity(embed, directories, install) {
    const edition = 'community';
    const container = await startContainer({ label: 'install-community', image: EDITIONS.community.image, namespace: EDITIONS.community.namespace, mountDirectory: directories.install, mountName: 'install', phase: 'install-community', edition });
    await importIpm(container, 'install-community', edition);
    for (const leg of ['newer', 'dev', 'unknown']) await guardLeg(container, embed, leg, install.seeds[leg], edition);

    const seeded = await session(container, loadSyntheticSetupScript(`${INSTALL_MOUNT}/setup-older.cls`), 'install-community', edition);
    need(value(seeded, 'SYNTH') === 'OK', 'install-community', edition, `the older synthetic Setup could not be loaded: ${value(seeded, 'SYNTH')}`);
    const loaded = await ipm(container, `load ${archiveInContainer}`, 'install-community', edition);
    need(loaded.outcome === 'OK', 'install-community', edition, `load of the archive over an older Setup (${install.seeds.older}) did not succeed: ${loaded.outcome ?? tail(loaded.output, 20)}`);
    const state = await session(container, setupStateScript(), 'install-community', edition);
    need(value(state, 'SETUP') === `compiled:${embed.marker}`, 'install-community', edition, `Setup reads ${JSON.stringify(value(state, 'SETUP'))} after the upgrade, not compiled:${embed.marker}.`);
    say(`[install-community] the archive installed over an older Setup (${install.seeds.older}); marker now ${embed.marker}`);
    await installChecks(container, embed, edition, install.cases);
    await removeContainer(container);
  }

  async function installHealth(embed, directories, install) {
    const edition = 'health';
    const container = await startContainer({ label: 'install-health', image: EDITIONS.health.image, namespace: EDITIONS.health.namespace, mountDirectory: directories.install, mountName: 'install', phase: 'install-health', edition });
    await importIpm(container, 'install-health', edition);
    const before = await session(container, setupStateScript(), 'install-health', edition);
    need(value(before, 'SETUP') === 'absent', 'install-health', edition, `the fresh container already has a Setup class (${JSON.stringify(value(before, 'SETUP'))}).`);
    const loaded = await ipm(container, `load ${archiveInContainer}`, 'install-health', edition);
    need(loaded.outcome === 'OK', 'install-health', edition, `load of the archive on a fresh container did not succeed: ${loaded.outcome ?? tail(loaded.output, 20)}`);
    say(`[install-health] the archive installed on a fresh ${EDITIONS.health.image.split('@')[0]} in ${container.namespace}`);
    await installChecks(container, embed, edition, install.cases);
    await removeContainer(container);
  }

  // -- the run -----------------------------------------------------------------------------

  async function run() {
    let embed;
    try {
      embed = await loadEmbed(repoRoot);
      const problems = embedProblems(embed);
      if (problems.length > 0) throw new Error(problems.join(' '));
    } catch (error) {
      say(`refusing to run: ${error instanceof Error ? error.message : String(error)}`);
      return 2;
    }
    say(`[preflight] the embed ${embed.marker} is stamped, ipm/module.xml names ${embed.moduleName} ${markerSemver(embed.marker)}, and the editions to install are ${editions.join(' and ')}`);

    root = mkdtempSync(path.join(realpathSync(options.tmpRoot ?? tmpdir()), 'iris-mcp-ipm-'));
    const directories = {
      repoRoot,
      stage: path.join(root, 'stage'),
      install: path.join(root, 'install'),
      extract: path.join(root, 'extract'),
      archive: path.join(root, 'built', ARCHIVE_NAME),
    };
    for (const directory of [directories.stage, directories.extract, path.dirname(directories.archive)]) mkdirSync(directory, { recursive: true, mode: 0o755 });
    chmodSync(directories.stage, 0o755);

    try {
      await build(embed, directories);
      checkArchive(embed, directories);
      const install = prepareInstallDirectory(embed, directories);
      if (editions.includes('community')) await installCommunity(embed, directories, install);
      if (editions.includes('health')) await installHealth(embed, directories, install);
      say(`PASS: one archive of ${embed.moduleName} ${markerSemver(embed.marker)} was built on a no-network ${EDITIONS.community.image.split('@')[0]} and installed on ${editions.join(' and ')} with no network and 0 package-registry rows`);
      return 0;
    } catch (error) {
      if (!(error instanceof PhaseFailure)) throw error;
      say(error.message);
      if (lastSession.output !== '' && error.code === 1) say(`the last session (${lastSession.phase}) ended with:\n${tail(lastSession.output, 40)}`);
      for (const container of [...containers]) {
        await logsHarness({ state: container.stateFile, env }, harnessDeps);
      }
      return error.code;
    } finally {
      for (const container of [...containers]) await removeContainer(container).catch(() => undefined);
      cleanup();
    }
  }

  return { run, cleanup };
}

/** Run the proof and return the exit code (see the header). */
export async function runIpmArchive(options = {}) {
  return startRun(options).run();
}

/**
 * The entry point: parse the command line, install the cleanup on exit, INT and TERM, and run.
 *
 * @param {readonly string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<number>}
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`ci-ipm-archive: ${error.message}\n`);
    return 2;
  }
  const started = startRun({ editions: parsed.editions, env });
  process.once('exit', () => started.cleanup());
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    process.once(signal, () => {
      started.cleanup();
      process.exit(code);
    });
  }
  return started.run();
}

if (isEntryPoint(import.meta.url)) {
  main().then((code) => process.exit(code));
}
