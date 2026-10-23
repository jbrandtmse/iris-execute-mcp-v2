#!/usr/bin/env node
// The release script (Story 42.5; AD-29, AD-14; DW-387, DW-675, DW-689): the only way anything is published. `.github/workflows/release.yml`
// runs it in four jobs, and `pnpm release` is an alias of `node scripts/release.mjs`.
//
// USE
//   node scripts/release.mjs ci-gate [--timeout-minutes <n>]       wait for a green ci.yml run on the commit, and check the environment
//   node scripts/release.mjs prepare --out <dir>                   run the checks and the gate set, then pack every artifact into <dir>
//   node scripts/release.mjs publish --artifacts <dir> --dry-run   rehearse the upload of <dir>
//   node scripts/release.mjs publish --artifacts <dir>             upload <dir>, channel by channel, in order
//
// CONTRACT
//   1. MODE. A run is a release only for a `push` of the tag `refs/tags/v<MAJOR.MINOR.PATCH>`; any other event or ref (a push to a
//      `release-dry-run/**` branch, a dispatch) is a dry run. `release-core.mjs` decides, and the manifest records it.
//   2. CI-GATE reads the `ci.yml` runs on GITHUB_SHA with GITHUB_TOKEN (GITHUB_API_URL, GITHUB_REPOSITORY) and polls every 60 s up to
//      the timeout. It passes on a completed `success` run that a `push` or a `workflow_dispatch` started (a pull request's run builds
//      its merge ref and never counts), exits 1 when every such run completed and none succeeded, when the timeout passes or when the
//      API fails or stalls for 30 s (it fails closed). It also reads the `release` environment: a tag run exits 1 unless the environment
//      is protected (a required reviewer, no administrator bypass, exactly one tag rule `v*`); a dry run prints one line about it.
//   3. PREPARE checks the version state and the generated files, runs every package's `prepublishOnly` ONCE through the throwaway harness
//      (`scripts/throwaway-iris.mjs exec ... node scripts/ci-live-suite.mjs prepublish-<short>`, which exports IRIS_REQUIRE_LIVE=1 and all
//      five IRIS_* variables), and only then packs: eight tarballs with `pnpm pack` (no lifecycle script), the vsix, and the IPM tree,
//      with `release-manifest.json` (version, sha, mode, channels, files, sha256). The container is removed on every exit path.
//   4. PUBLISH verifies the manifest's hashes and the version of npm, and that every path it would upload (each npm tarball, an enabled
//      channel's vsix or IPM tree) is one of those hash-verified files inside the artifacts directory; then uploads the exact tarballs: `npm publish <tgz> --access public
//      --provenance --ignore-scripts`, in NPM_PUBLISH_ORDER, then each enabled channel in order. A version already on the registry is
//      skipped. The first failure stops everything after it (a channel that throws is a failed channel), and the report names every
//      package and channel as published, already published, failed, not attempted or skipped. A real run refuses, with exit 2 and
//      before any upload, unless it is a `push` of `refs/tags/v<manifest.version>` on the manifest's sha with a manifest prepared in
//      release mode, and unless the environment guard passes again. `--dry-run` runs `npm publish --dry-run`, never reads NPM_TOKEN, and runs no `vsce`/`ovsx` publish, no
//      `git push` and no userconfig write.
//   5. AUTH. NPM_TOKEN set: a 0600 temporary userconfig holds it and is passed as `--userconfig`; it is removed on every exit path and the
//      token is never printed. NPM_TOKEN empty: no userconfig, npm uses OIDC (trusted publishing). The token, GITHUB_TOKEN and the IPM
//      deploy key are removed from the environment of every child process, and the job's OIDC request variables
//      (ACTIONS_ID_TOKEN_REQUEST_TOKEN and _URL) reach only `npm publish`.
//   6. Each phase prints a line, and the report is appended to $GITHUB_STEP_SUMMARY when it is set.
//   7. SIGINT and SIGTERM kill the child processes that are running, run the cleanups and end the run with 130 or 143
//      (`installSignalHandlers`); the gate set's own handlers, registered later, forward the signal to its command and remove the container.
//
// EXIT CODES
//   0 passed; 1 a check, a gate or an upload failed; 2 usage or a refusal; 3 docker is not on PATH; 4 the container did not start.
//
// IMPORT
//   Importing this module runs nothing. `ci-gate`, `rehearse` and `publish` run with no `node_modules`, so this file imports only `node:`
//   builtins, `lib/release-core.mjs` and `lib/script-process.mjs`; every module that `prepare` alone needs (the harness, the packer, the
//   smoke, the IPM staging) is loaded by `import()` inside `prepare`. `ciGate`, `prepare` and `publish` take every side effect as `deps`.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  CI_WORKFLOW_PATH,
  IPM_DIST_BRANCH,
  IPM_DIST_REPOSITORY,
  IPM_REGISTRY_PACKAGE_URL,
  NPM_PUBLISH_ORDER,
  PLACEHOLDER_PUBLISHER,
  RELEASE_CHANNELS,
  RELEASE_CHECK_EXEMPTIONS,
  RELEASE_ENVIRONMENT,
  STATUS,
  ciGateDecision,
  describeRuns,
  environmentProblems,
  environmentSummary,
  environmentWarnings,
  ipmDefaultBranch,
  ipmPushPlan,
  ipmReadme,
  ipmRegistryListsVersion,
  npmPublishArgv,
  npmUserconfig,
  npmVersionProblems,
  npmViewArgv,
  ovsxArgv,
  publishRefusals,
  releaseMode,
  releaseReport,
  skippedText,
  tarballProblems,
  versionProblems,
  vsceArgv,
} from './lib/release-core.mjs';
import { isEntryPoint } from './lib/script-process.mjs';

/** The repository root: the parent of the directory that holds this script. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The manifest `prepare` writes into the artifacts directory, and `publish` reads. */
export const MANIFEST_NAME = 'release-manifest.json';

/** The extension the vsix and the stores' CLIs live in. */
const LAUNCHER_RELATIVE = path.join('extensions', 'iris-mcp-launcher');

/** The variables with which npm asks GitHub for the job's OIDC token (trusted publishing and provenance): only `npm publish` gets them. */
const OIDC_VARIABLES = Object.freeze(['ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL']);

/** The variables that never reach a child process: each reaches only the code that needs it. */
const SECRET_VARIABLES = Object.freeze(['NPM_TOKEN', 'GITHUB_TOKEN', 'IPM_DIST_DEPLOY_KEY', ...OIDC_VARIABLES]);

/** A usage error or a refusal that ends the run with exit code 2. */
export class Refusal extends Error {}

// -- small helpers -------------------------------------------------------------------------------------------------

/** The environment of a child process: the caller's, without the secret variables, with npm's update notice off. */
export function childEnv(env, extra = {}) {
  const copy = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string' && !SECRET_VARIABLES.includes(key)) copy[key] = value;
  }
  return { ...copy, npm_config_update_notifier: 'false', NO_UPDATE_NOTIFIER: '1', ...extra };
}

/** `text` with every secret in `secrets` replaced, so that a log line can never hold one. */
export function redact(text, secrets) {
  let result = String(text);
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 4) result = result.split(secret).join('***');
  }
  return result;
}

const sha256OfFile = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');

/** The forward-slash paths of every file under `root`, relative to it, sorted. */
export function listFiles(root, directory = '') {
  const found = [];
  for (const entry of readdirSync(path.join(root, directory), { withFileTypes: true })) {
    const relative = directory === '' ? entry.name : `${directory}/${entry.name}`;
    if (entry.isDirectory()) found.push(...listFiles(root, relative));
    else found.push(relative);
  }
  return found.sort();
}

/** The last `count` lines of a text, for a failure message. */
const tail = (text, count) => String(text).trimEnd().split('\n').slice(-count).join('\n');

/**
 * The failure detail of an npm call: the last `count` lines of its output, led by npm's `npm error code <CODE>` line when the tail does
 * not hold it (a stack-bearing failure ends in its stack and log path, far below the code).
 */
export function npmFailureDetail(result, count) {
  const text = String(result.stderr || result.error?.message || result.stdout);
  const last = tail(text, count);
  const code = /^npm error code \S+$/m.exec(text)?.[0];
  return code === undefined || last.includes(code) ? last : `${code}\n${last}`;
}

/** Append a report to the step summary of the run, when GitHub gave the run one. */
export function appendSummary(env, text) {
  if (typeof env.GITHUB_STEP_SUMMARY === 'string' && env.GITHUB_STEP_SUMMARY !== '') {
    try {
      appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`);
    } catch {
      // the summary is a courtesy; the log has the same lines
    }
  }
}

/** Cleanups that run once, in reverse order, on a normal end, a failure, a signal or process exit. */
export function createCleanups() {
  const steps = [];
  let done = false;
  return {
    add(step) {
      steps.push(step);
    },
    run() {
      if (done) return;
      done = true;
      for (const step of steps.splice(0).reverse()) {
        try {
          step();
        } catch {
          // a cleanup that fails must not stop the others
        }
      }
    },
  };
}

/** The child processes that `runCaptured` started and that are still running, so that a signal can reach them. */
const activeChildren = new Set();

/**
 * Run `argv` and collect its output. An executable that cannot start resolves with `status: null` and the `error`.
 *
 * @param {readonly string[]} argv
 * @param {{ cwd?: string, env?: Record<string, string>, input?: string, timeoutMs?: number }} [options]
 * @returns {Promise<{ status: number | null, stdout: string, stderr: string, error?: Error }>}
 */
export function runCaptured(argv, { cwd, env, input, timeoutMs = 1_800_000 } = {}) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve({ status: null, stdout: '', stderr: '', error });
      return;
    }
    activeChildren.add(child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      activeChildren.delete(child);
      resolve(result);
    };
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.stdin.on('error', () => undefined);
    child.once('error', (error) => finish({ status: null, stdout, stderr, error }));
    child.once('close', (code, signal) => finish({ status: code, stdout, stderr, ...(signal === null ? {} : { error: new Error(`ended by ${signal}`) }) }));
    child.stdin.end(input ?? '');
  });
}

/**
 * The real side effects of the three commands. A `fetch` that is given no `signal` is aborted after `fetchTimeoutMs`, so a stalled
 * connection fails (and `ci-gate` fails closed) instead of holding the job until its budget ends.
 *
 * @param {{ fetchTimeoutMs?: number }} [options]
 */
export function defaultDeps({ fetchTimeoutMs = 30_000 } = {}) {
  return {
    fetch: (url, init = {}) => fetch(url, init.signal ? init : { ...init, signal: AbortSignal.timeout(fetchTimeoutMs) }),
    run: runCaptured,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => process.stderr.write(`${line}\n`),
    loadModules: loadPrepareModules,
  };
}

/** The modules only `prepare` needs, loaded when it needs them (a runner without `node_modules` never loads them). */
async function loadPrepareModules(repoRoot = REPO_ROOT) {
  const load = (relative) => import(pathToFileURL(path.join(repoRoot, relative)).href);
  const [harness, checks, pack, smoke, ipm] = await Promise.all([
    load('scripts/throwaway-iris.mjs'),
    load('scripts/lib/ci-checks.mjs'),
    load('scripts/lib/pnpm-pack.mjs'),
    load('scripts/ci-package-smoke.mjs'),
    load('scripts/lib/ipm-archive.mjs'),
  ]);
  return { harness, checks, pack, smoke, ipm };
}

// -- GitHub ----------------------------------------------------------------------------------------------------

/** A GET of the GitHub API with the run's token: `{ status, body }`, or `{ error }` when the request could not be made. */
async function githubGet(deps, env, url) {
  try {
    const response = await deps.fetch(url, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'iris-mcp-release',
      },
    });
    let body;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    return { status: response.status, body };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

const apiRoot = (env) => (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/+$/, '');

/**
 * Read the `release` environment and judge it.
 *
 * @returns {Promise<{ state: 'protected' | 'unprotected' | 'missing' | 'unreadable', line: string, problems: string[], warnings: string[] }>}
 */
export async function readEnvironmentGuard(deps, env) {
  const base = `${apiRoot(env)}/repos/${env.GITHUB_REPOSITORY}/environments/${RELEASE_ENVIRONMENT}`;
  const unreadable = (why) => ({
    state: 'unreadable',
    line: `environment ${RELEASE_ENVIRONMENT}: unreadable (${why})`,
    problems: [`the ${RELEASE_ENVIRONMENT} environment could not be read (${why}). Check that the token may read it.`],
    warnings: [],
  });
  const environment = await githubGet(deps, env, base);
  if (environment.error !== undefined) return unreadable(environment.error);
  if (environment.status === 404) {
    return {
      state: 'missing',
      line: `environment ${RELEASE_ENVIRONMENT}: missing, or not readable with this token (HTTP 404)`,
      problems: [`the ${RELEASE_ENVIRONMENT} environment does not exist, or the token cannot read it. Create it under Settings, Environments.`],
      warnings: [],
    };
  }
  if (environment.status < 200 || environment.status >= 300) return unreadable(`HTTP ${environment.status}`);
  let policies = { branch_policies: [] };
  if (environment.body?.deployment_branch_policy?.custom_branch_policies === true) {
    const listed = await githubGet(deps, env, `${base}/deployment-branch-policies`);
    if (listed.error !== undefined) return unreadable(listed.error);
    if (listed.status < 200 || listed.status >= 300) return unreadable(`HTTP ${listed.status} for the deployment rules`);
    policies = listed.body;
  }
  const problems = environmentProblems(environment.body, policies);
  const warnings = environmentWarnings(environment.body);
  if (problems.length > 0) {
    return { state: 'unprotected', line: `environment ${RELEASE_ENVIRONMENT}: unprotected. ${problems.join(' ')}`, problems, warnings };
  }
  return { state: 'protected', line: `environment ${RELEASE_ENVIRONMENT}: ${environmentSummary(environment.body, policies)}`, problems, warnings };
}

// -- ci-gate ---------------------------------------------------------------------------------------------------

/** `deps` whose `log` also keeps every line, and a function that appends those lines to the step summary under `title`. */
function withSummary(deps, env, title) {
  const lines = [];
  return {
    deps: { ...deps, log: (line) => { lines.push(line); deps.log(line); } },
    finish: (code) => appendSummary(env, `### ${title} (exit ${code})\n\n\`\`\`\n${lines.join('\n')}\n\`\`\``),
  };
}

/**
 * Wait for a green `ci.yml` run on the commit, and check the `release` environment (see the header).
 *
 * @param {{ env: Record<string, string | undefined>, timeoutMinutes?: number, pollMs?: number }} options
 * @param {ReturnType<typeof defaultDeps>} deps
 * @returns {Promise<number>}
 */
export async function ciGate(options, deps) {
  const summary = withSummary(deps, options.env, 'ci-gate');
  let code = 1;
  try {
    code = await runCiGate(options, summary.deps);
    return code;
  } finally {
    summary.finish(code);
  }
}

async function runCiGate({ env, timeoutMinutes = 180, pollMs = 60_000 }, deps) {
  const say = (line) => deps.log(`ci-gate: ${line}`);
  const info = releaseMode(env);
  if (info.malformedTag !== undefined) {
    say(`the tag ${info.malformedTag} is not v<MAJOR.MINOR.PATCH>. Delete it and tag the release as v<MAJOR.MINOR.PATCH>.`);
    return 2;
  }
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPOSITORY || !info.sha) {
    say('GITHUB_TOKEN, GITHUB_REPOSITORY and GITHUB_SHA are required. Run ci-gate inside the release workflow.');
    return 2;
  }
  say(`${info.mode === 'release' ? `release v${info.version}` : 'dry run'} on ${info.sha}`);

  const guard = await readEnvironmentGuard(deps, env);
  for (const warning of guard.warnings) say(`warning: ${warning}`);
  if (info.mode === 'release') {
    say(guard.line);
    if (guard.state !== 'protected') {
      say(`refusing the tag run: ${guard.problems.join(' ')} No later job runs.`);
      return 1;
    }
  } else {
    say(`${guard.line}${guard.state === 'protected' ? '' : '; a tag run stops here'}`);
  }

  const runsUrl = `${apiRoot(env)}/repos/${env.GITHUB_REPOSITORY}/actions/runs?head_sha=${encodeURIComponent(info.sha)}&per_page=100`;
  const deadline = deps.now() + timeoutMinutes * 60_000;
  for (;;) {
    const listed = await githubGet(deps, env, runsUrl);
    if (listed.error !== undefined || listed.status < 200 || listed.status >= 300) {
      say(`the CI runs of ${info.sha} could not be read (${listed.error ?? `HTTP ${listed.status}`}). Fix the token or the API, and run the release again; it fails closed.`);
      return 1;
    }
    const decision = ciGateDecision(Array.isArray(listed.body?.workflow_runs) ? listed.body.workflow_runs : [], info.sha);
    if (decision.decision === 'pass') {
      say(`${CI_WORKFLOW_PATH} is green on ${info.sha}: ${decision.run.html_url}`);
      return 0;
    }
    if (decision.decision === 'red') {
      say(`every ${CI_WORKFLOW_PATH} run on ${info.sha} completed and none succeeded. Fix CI on this commit, then tag again.`);
      for (const line of describeRuns(decision.runs)) say(`  ${line}`);
      return 1;
    }
    if (deps.now() >= deadline) {
      say(`no green ${CI_WORKFLOW_PATH} run on ${info.sha} within ${timeoutMinutes} minutes. Wait for CI, then run the release again.`);
      return 1;
    }
    say(decision.runs.length === 0 ? `waiting: no ${CI_WORKFLOW_PATH} run on ${info.sha} yet` : `waiting: ${describeRuns(decision.runs).join('; ')}`);
    await deps.sleep(pollMs);
  }
}

// -- the facts of the repository -----------------------------------------------------------------------------------

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));

/**
 * The state of the repository that a release depends on: the packages in publish order with their manifests, the pending changesets,
 * the shared version, the bootstrap marker and the version of `ipm/module.xml`.
 *
 * @param {string} [repoRoot]
 */
export function readReleaseFacts(repoRoot = REPO_ROOT) {
  const problems = [];
  const found = new Map();
  const packagesDir = path.join(repoRoot, 'packages');
  for (const dir of readdirSync(packagesDir).sort()) {
    const file = path.join(packagesDir, dir, 'package.json');
    if (!existsSync(file)) continue;
    const manifest = readJson(file);
    if (manifest.private !== true && typeof manifest.name === 'string' && manifest.name.startsWith('@iris-mcp/')) found.set(manifest.name, { name: manifest.name, dir, manifest });
  }
  const packages = [];
  for (const name of NPM_PUBLISH_ORDER) {
    const entry = found.get(name);
    if (entry === undefined) problems.push(`${name} is in NPM_PUBLISH_ORDER but no packages/*/package.json names it. Fix scripts/lib/release-core.mjs.`);
    else packages.push({ ...entry, short: name.replace(/^@iris-mcp\//, ''), version: entry.manifest.version });
  }
  for (const name of found.keys()) {
    if (!NPM_PUBLISH_ORDER.includes(name)) problems.push(`${name} is published but missing from NPM_PUBLISH_ORDER. Add it after its workspace dependencies in scripts/lib/release-core.mjs.`);
  }
  const changesetDir = path.join(repoRoot, '.changeset');
  const pending = existsSync(changesetDir) ? readdirSync(changesetDir).filter((name) => name.endsWith('.md') && name !== 'README.md').sort() : [];
  const embedFile = path.join(repoRoot, 'packages', 'shared', 'src', 'bootstrap-classes.ts');
  const marker = existsSync(embedFile) ? /export const BOOTSTRAP_VERSION = "([^"]+)"/.exec(readFileSync(embedFile, 'utf8'))?.[1] : undefined;
  const moduleFile = path.join(repoRoot, 'ipm', 'module.xml');
  const moduleVersion = existsSync(moduleFile) ? /<Version>([^<]+)<\/Version>/.exec(readFileSync(moduleFile, 'utf8'))?.[1]?.trim() : undefined;
  const shared = found.get('@iris-mcp/shared');
  return { packages, problems, pending, marker, moduleVersion, sharedVersion: shared?.manifest.version };
}

/** What is wrong with the files that embed the version: the bootstrap marker's semver and `ipm/module.xml` must equal the shared version. */
export function embeddedVersionProblems(facts) {
  const problems = [];
  const markerSemver = facts.marker?.split('+')[0];
  if (markerSemver !== facts.sharedVersion) {
    problems.push(`BOOTSTRAP_VERSION is ${JSON.stringify(facts.marker)}, whose semver is not the shared version ${facts.sharedVersion}. Run pnpm run version, which regenerates it.`);
  }
  if (facts.moduleVersion !== facts.sharedVersion) {
    problems.push(`ipm/module.xml is at ${JSON.stringify(facts.moduleVersion)}, not the shared version ${facts.sharedVersion}. Run pnpm run version, which regenerates it.`);
  }
  return problems;
}

/**
 * The names of the root scripts that `prepare` runs: those that end in `:check`, less the exemptions and the lifecycle hooks. A hook is
 * a name that starts with `pre` or `post` and whose remainder is itself a script (`pregen:x:check` of `gen:x:check`); `prettier:check`
 * is not one.
 */
export function releaseCheckScripts(scripts) {
  const isHook = (name) => {
    const hooked = /^(?:pre|post)(.+)$/.exec(name)?.[1];
    return hooked !== undefined && Object.hasOwn(scripts, hooked);
  };
  return Object.keys(scripts)
    .filter((name) => name.endsWith(':check') && !isHook(name) && !(name in RELEASE_CHECK_EXEMPTIONS))
    .sort();
}

// -- prepare ---------------------------------------------------------------------------------------------------

/**
 * Start the seeded throwaway, run `commands` against it one after another through the harness's `exec`, and remove the container on
 * every exit path (a normal end, a failure, a signal, process exit). Returns the exit code: 0, the first failing command's code mapped to
 * 1, or the harness's own 2, 3 or 4.
 *
 * @param {{
 *   env: Record<string, string | undefined>,
 *   modules: { harness: any, checks: any },
 *   harnessDeps: any,
 *   stateFile: string,
 *   commands: ReadonlyArray<{ label: string, argv: string[] }>,
 *   log: (line: string) => void,
 *   proc?: Pick<NodeJS.Process, 'once' | 'off' | 'exit'>,
 * }} options
 * @returns {Promise<number>}
 */
export async function runGateSet({ env, modules, harnessDeps, stateFile, commands, log, proc = process }) {
  const { harness, checks } = modules;
  const teardown = harness.createTeardown((args) => harnessDeps.docker(args, { timeoutMs: 120_000 }));
  const handlers = [];
  const listen = (event, handler) => {
    proc.once(event, handler);
    handlers.push([event, handler]);
  };
  listen('exit', () => teardown.run());
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    listen(signal, () => {
      harnessDeps.killCommand?.(signal);
      teardown.run();
      proc.exit(code);
    });
  }
  const options = { env };
  try {
    const up = await harness.upHarness(
      { ...options, image: harness.IRISHEALTH_COMMUNITY_IMAGE, namespace: checks.LIVE_NAMESPACE, hostPort: checks.CI_HOST_PORTS.live, state: stateFile },
      harnessDeps,
      teardown,
    );
    if (up !== 0) return up;
    teardown.arm(JSON.parse(readFileSync(stateFile, 'utf8')).id);
    for (const { label, argv } of commands) {
      log(`gate set: ${label}`);
      const code = await harness.execHarness({ ...options, state: stateFile, command: argv }, harnessDeps);
      if (code !== 0) {
        log(`gate set: ${label} exited ${code}. The container is removed, and nothing is packed.`);
        return 1;
      }
    }
    return 0;
  } finally {
    const down = await harness.downHarness({ ...options, state: stateFile }, harnessDeps).catch(() => 1);
    if (down === 0) teardown.disarm();
    else teardown.run();
    for (const [event, handler] of handlers) proc.off(event, handler);
  }
}

/** The vsix of the extension: build, `npm run package`, and the listing of the files it holds. */
async function packVsix({ repoRoot, out, env, deps, say }) {
  const dir = path.join(repoRoot, LAUNCHER_RELATIVE);
  const manifest = readJson(path.join(dir, 'package.json'));
  const vsixDir = path.join(out, 'vsix');
  mkdirSync(vsixDir, { recursive: true });
  const built = await deps.run(['npm', 'run', 'build'], { cwd: dir, env });
  if (built.status !== 0) throw new Error(`the extension did not build (${built.error?.message ?? `exit ${built.status}`}): ${tail(built.stderr || built.stdout, 15)} Run npm ci in ${LAUNCHER_RELATIVE}, then build it.`);
  const packed = await deps.run(['npm', 'run', 'package', '--', '--out', `${vsixDir}${path.sep}`], { cwd: dir, env });
  if (packed.status !== 0) throw new Error(`the extension did not package (${packed.error?.message ?? `exit ${packed.status}`}): ${tail(packed.stderr || packed.stdout, 15)} Run npm run package in ${LAUNCHER_RELATIVE} and fix the error it names.`);
  const vsixes = readdirSync(vsixDir).filter((name) => name.endsWith('.vsix'));
  if (vsixes.length !== 1) throw new Error(`packaging the extension left ${vsixes.length} vsix files in ${vsixDir}, not one. Empty the directory and package again.`);
  const listing = await deps.run(['npm', 'exec', '--', 'vsce', 'ls'], { cwd: dir, env });
  if (listing.status !== 0) throw new Error(`vsce ls failed (${listing.error?.message ?? `exit ${listing.status}`}): ${tail(listing.stderr || listing.stdout, 10)} Run npm exec -- vsce ls in ${LAUNCHER_RELATIVE} and fix the error it names.`);
  const files = listing.stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  say(`the extension ${manifest.name}@${manifest.version} (publisher ${manifest.publisher}): ${vsixes[0]}, ${files.length} files`);
  return { file: `vsix/${vsixes[0]}`, name: manifest.name, version: manifest.version, publisher: manifest.publisher, files };
}

/** The IPM tree: the module staged from the built embed (never from `src/`), plus a generated README and the LICENSE. */
async function stageIpm({ repoRoot, out, version, modules, say }) {
  const embed = await modules.ipm.loadEmbed(repoRoot);
  const problems = modules.ipm.embedProblems(embed);
  if (problems.length > 0) throw new Error(`the IPM embed is not releasable: ${problems.join(' ')}`);
  const tree = path.join(out, 'ipm');
  mkdirSync(tree, { recursive: true });
  const staged = modules.ipm.stageModule(tree, embed);
  writeFileSync(path.join(tree, 'README.md'), ipmReadme(version), 'utf8');
  copyFileSync(path.join(repoRoot, 'LICENSE'), path.join(tree, 'LICENSE'));
  say(`the IPM tree: ${staged.files.length} files from the embed ${embed.marker}, plus README.md and LICENSE`);
  return { tree: 'ipm', module: embed.moduleName, version, marker: embed.marker, repository: IPM_DIST_REPOSITORY, branch: IPM_DIST_BRANCH };
}

/**
 * Check the repository, run the gate set once, and pack every artifact (see the header).
 *
 * @param {{ out: string, env: Record<string, string | undefined>, repoRoot?: string }} options
 * @param {ReturnType<typeof defaultDeps> & { cleanups?: ReturnType<typeof createCleanups>, harnessDeps?: any, proc?: any }} deps
 * @returns {Promise<number>}
 */
export async function prepare(options, deps) {
  const summary = withSummary(deps, options.env, 'prepare');
  let code = 1;
  try {
    code = await runPrepare(options, summary.deps);
    return code;
  } finally {
    summary.finish(code);
  }
}

async function runPrepare({ out, env, repoRoot = REPO_ROOT }, deps) {
  const say = (line) => deps.log(`prepare: ${line}`);
  if (typeof out !== 'string' || out === '') {
    say('--out <dir> is required. Pass the directory the artifacts go to.');
    return 2;
  }
  const outDir = path.resolve(out);
  if (existsSync(outDir) && readdirSync(outDir).length > 0) {
    say(`${outDir} is not empty. Pass an empty or new directory.`);
    return 2;
  }
  const info = releaseMode(env);
  if (!/^[0-9a-f]{40}$/.test(info.sha)) {
    say(`GITHUB_SHA is ${JSON.stringify(info.sha)}, not a commit. Run prepare inside the release workflow.`);
    return 2;
  }
  say(`${info.mode === 'release' ? `release v${info.version}` : 'dry run'} on ${info.sha}`);
  const cenv = childEnv(env);

  // 1. The version state and the files that embed the version.
  const facts = readReleaseFacts(repoRoot);
  const version = info.mode === 'release' ? info.version : facts.sharedVersion;
  const versionIssues = [
    ...facts.problems,
    ...versionProblems({ versions: facts.packages.map((entry) => ({ name: entry.name, version: entry.version })), pending: facts.pending, tagVersion: info.version }, info.mode),
  ];
  const blocking = [...embeddedVersionProblems(facts)];
  if (info.mode === 'release') blocking.unshift(...versionIssues);
  else for (const issue of versionIssues) say(`a tag run would refuse: ${issue}`);
  if (blocking.length > 0) {
    for (const issue of blocking) say(`problem: ${issue}`);
    return 1;
  }
  say(
    versionIssues.length === 0
      ? `version state: ${facts.packages.length} packages at ${version}, no pending changeset`
      : 'version state: a dry run goes on with the problems above; a tag run would stop here',
  );

  // 2. The generated files and the root checks.
  const problems = [];
  const generated = await deps.run(['pnpm', 'run', 'gen:bootstrap'], { cwd: repoRoot, env: cenv });
  if (generated.status !== 0) problems.push(`pnpm run gen:bootstrap failed (${generated.error?.message ?? `exit ${generated.status}`}): ${tail(generated.stderr || generated.stdout, 10)}`);
  const status = await deps.run(['git', 'status', '--porcelain'], { cwd: repoRoot, env: cenv });
  if (status.status !== 0) problems.push(`git status failed (${status.error?.message ?? `exit ${status.status}`}). Run prepare in a git checkout.`);
  else if (status.stdout.trim() !== '') problems.push(`pnpm run gen:bootstrap changed the tree (${tail(status.stdout, 5).split('\n').join('; ')}). Run it, review the result and commit it.`);
  const scripts = readJson(path.join(repoRoot, 'package.json')).scripts ?? {};
  for (const name of releaseCheckScripts(scripts)) {
    const checked = await deps.run(['pnpm', 'run', name], { cwd: repoRoot, env: cenv });
    if (checked.status !== 0) problems.push(`pnpm run ${name} failed (${checked.error?.message ?? `exit ${checked.status}`}): ${tail(checked.stderr || checked.stdout, 10)}`);
    else say(`${name}: ok`);
  }
  for (const [name, reason] of Object.entries(RELEASE_CHECK_EXEMPTIONS)) say(`${name}: not run, ${reason}`);
  if (problems.length > 0) {
    for (const issue of problems) say(`problem: ${issue}`);
    return 1;
  }

  // 3. The gate set: every prepublishOnly, once, armed on a seeded throwaway, before anything is packed.
  const modules = await deps.loadModules(repoRoot);
  const suiteIds = facts.packages.map((entry) => `prepublish-${entry.short}`);
  const unknown = suiteIds.filter((id) => !Object.hasOwn(modules.checks.LIVE_SUITES, id));
  if (unknown.length > 0) {
    say(`problem: the CI registry has no suite ${unknown.join(', ')}. Every package needs a prepublish suite in scripts/lib/ci-checks.mjs.`);
    return 1;
  }
  const stateRoot = mkdtempSync(path.join(tmpdir(), 'release-gate-set-'));
  try {
    const code = await runGateSet({
      env: cenv,
      modules,
      harnessDeps: deps.harnessDeps ?? modules.harness.defaultDeps(cenv),
      stateFile: path.join(stateRoot, 'throwaway.json'),
      commands: [
        { label: 'seed', argv: ['node', 'scripts/ci-seed-throwaway.mjs'] },
        ...suiteIds.map((id) => ({ label: id, argv: ['node', 'scripts/ci-live-suite.mjs', id] })),
      ],
      log: say,
      ...(deps.proc === undefined ? {} : { proc: deps.proc }),
    });
    if (code !== 0) return code;
  } finally {
    rmSync(stateRoot, { recursive: true, force: true });
  }
  say(`gate set: seed and ${suiteIds.length} prepublish suites passed, and the container is removed`);

  // 4. The artifacts.
  try {
    mkdirSync(path.join(outDir, 'npm'), { recursive: true });
    const work = mkdtempSync(path.join(tmpdir(), 'release-pack-'));
    const packedPackages = [];
    const packProblems = [];
    // A release puts every package at the tag's version; a dry run packs each package at the version it has today.
    const releasedAt = (entry) => (info.mode === 'release' ? info.version : entry.version);
    const dependencyVersions = Object.fromEntries(facts.packages.map((entry) => [entry.name, releasedAt(entry)]));
    try {
      for (const entry of facts.packages) {
        const packed = modules.pack.pnpmPack(path.join(repoRoot, 'packages', entry.dir), path.join(work, entry.short));
        packProblems.push(...tarballProblems(packed.manifest, entry.manifest, releasedAt(entry), dependencyVersions));
        const target = path.join(outDir, 'npm', path.basename(packed.tarball));
        copyFileSync(packed.tarball, target);
        packedPackages.push({ name: entry.name, version: releasedAt(entry), tarball: target, manifest: packed.manifest, files: packed.files, bytes: packed.bytes });
        say(`packed ${entry.name}@${releasedAt(entry)} (${packed.bytes} bytes)`);
      }
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
    if (packProblems.length > 0) {
      for (const issue of packProblems) say(`problem: ${issue}`);
      return 1;
    }
    const smoked = await modules.smoke.smokePackages({ repoRoot, tarballs: packedPackages, log: (line) => say(line) });
    if (smoked !== 0) {
      say('problem: the package smoke failed on the tarballs that would be published. Fix it before releasing.');
      return 1;
    }
    const vsix = await packVsix({ repoRoot, out: outDir, env: cenv, deps, say });
    const ipm = await stageIpm({ repoRoot, out: outDir, version, modules, say });

    const channelDetails = {
      npm: { packages: packedPackages.map((entry) => ({ name: entry.name, version: entry.version, tarball: `npm/${path.basename(entry.tarball)}` })) },
      'vscode-marketplace': vsix,
      'open-vsx': vsix,
      ipm,
    };
    const manifest = {
      schema: 1,
      version,
      sha: info.sha,
      mode: info.mode,
      event: info.event,
      ref: info.ref,
      channels: RELEASE_CHANNELS.map((channel) => ({ ...channel, ...channelDetails[channel.id] })),
      files: listFiles(outDir).map((file) => ({ path: file, bytes: statSync(path.join(outDir, file)).size, sha256: sha256OfFile(path.join(outDir, file)) })),
    };
    writeFileSync(path.join(outDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    say(`wrote ${MANIFEST_NAME}: version ${version}, ${manifest.files.length} files, mode ${info.mode}`);
    return 0;
  } catch (error) {
    say(`problem: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

// -- publish ---------------------------------------------------------------------------------------------------

/**
 * Whether `relative` names a file inside a directory, as `prepare` writes every path of its manifest: forward slashes, no empty, `.` or
 * `..` segment, not absolute, and no backslash or NUL.
 */
export function isContainedPath(relative) {
  return (
    typeof relative === 'string' &&
    relative !== '' &&
    !/[\\\0]/.test(relative) &&
    !relative.startsWith('/') &&
    !/^[A-Za-z]:/.test(relative) &&
    relative.split('/').every((segment) => segment !== '' && segment !== '.' && segment !== '..')
  );
}

/** The name `pnpm pack` gives the tarball of `name@version`: the scope without its `@`, a `-` in place of the `/`, then `-<version>.tgz`. */
export const packedTarballName = (name, version) => `${String(name).replace(/^@/, '').replace('/', '-')}-${version}.tgz`;

/**
 * What is wrong with the files in the artifacts directory: each listed file must be a path inside it and exist with its hash, and nothing
 * else may be there.
 */
export function artifactProblems(artifacts, manifest) {
  const problems = [];
  const listed = Array.isArray(manifest?.files) ? manifest.files : [];
  if (listed.length === 0) problems.push(`${MANIFEST_NAME} lists no file. Prepare the artifacts again.`);
  for (const entry of listed) {
    if (!isContainedPath(entry?.path)) {
      problems.push(`${MANIFEST_NAME} lists the file ${JSON.stringify(entry?.path)}, which is not a path inside the artifacts directory. Prepare the artifacts again.`);
      continue;
    }
    const file = path.join(artifacts, entry.path);
    if (!existsSync(file)) problems.push(`${entry.path} is listed in ${MANIFEST_NAME} but missing. Download the artifacts again.`);
    else if (sha256OfFile(file) !== entry.sha256) problems.push(`${entry.path} does not match its sha256 in ${MANIFEST_NAME}. Prepare the artifacts again; they changed after they were rehearsed.`);
  }
  const names = new Set(listed.map((entry) => entry?.path));
  for (const file of existsSync(artifacts) ? listFiles(artifacts) : []) {
    if (file !== MANIFEST_NAME && !names.has(file)) problems.push(`${file} is in the artifacts directory but not in ${MANIFEST_NAME}. Remove it, or prepare the artifacts again.`);
  }
  return problems;
}

/**
 * What is wrong with the paths a run would upload: each is one of the manifest's hash-verified files, inside the artifacts directory.
 * An npm entry's tarball is the one `pnpm pack` names for its package and version (so no two entries share one), and in a release every
 * entry is at the manifest's version. An enabled store channel uploads a listed `.vsix`; an enabled IPM channel pushes a listed directory that
 * holds `module.xml`. A channel that is not enabled uploads nothing, so its paths are not checked.
 *
 * @param {Record<string, any>} manifest
 * @param {ReadonlyArray<{ id: string, enabled: boolean }>} channels
 * @returns {string[]}
 */
export function uploadPathProblems(manifest, channels) {
  const problems = [];
  const verified = new Set((Array.isArray(manifest?.files) ? manifest.files : []).map((entry) => entry?.path).filter(isContainedPath));
  const detailOf = (id) => (Array.isArray(manifest?.channels) ? manifest.channels.find((entry) => entry?.id === id) : undefined);
  const npmPackages = Array.isArray(detailOf('npm')?.packages) ? detailOf('npm').packages : [];
  for (const entry of npmPackages) {
    const item = `${entry?.name}@${entry?.version}`;
    const tarball = entry?.tarball;
    if (!isContainedPath(tarball) || !verified.has(tarball)) {
      problems.push(`${item}: its tarball ${JSON.stringify(tarball)} is not a hash-verified file of ${MANIFEST_NAME}. Prepare the artifacts again.`);
    } else if (path.posix.basename(tarball) !== packedTarballName(entry.name, entry.version)) {
      problems.push(`${item}: its tarball ${tarball} is not ${packedTarballName(entry.name, entry.version)}, the one pnpm pack makes for it. Prepare the artifacts again.`);
    }
    if (manifest?.mode === 'release' && entry?.version !== manifest.version) problems.push(`${item} is not at the release version ${manifest.version}. Prepare the artifacts again.`);
  }
  for (const channel of channels) {
    const detail = channel.enabled && channel.id !== 'npm' ? detailOf(channel.id) : undefined;
    if (detail === undefined) continue;
    if (channel.id === 'ipm') {
      const tree = detail.tree ?? 'ipm';
      if (!isContainedPath(tree) || !verified.has(`${tree}/module.xml`)) {
        problems.push(`${channel.id}: its tree ${JSON.stringify(tree)} is not a directory of ${MANIFEST_NAME} that holds module.xml. Prepare the artifacts again.`);
      }
    } else if (!isContainedPath(detail.file) || !verified.has(detail.file) || !detail.file.endsWith('.vsix')) {
      problems.push(`${channel.id}: its vsix ${JSON.stringify(detail.file)} is not a hash-verified .vsix of ${MANIFEST_NAME}. Prepare the artifacts again.`);
    }
  }
  return problems;
}

/** Whether `npm view` said that the version is on the registry (`published`), is not (`absent`), or could not be judged (`unknown`). */
function viewOutcome(result, version) {
  if (result.status === 0 && result.stdout.trim() === version) return 'published';
  if (result.status !== 0 && /\bE404\b|404 Not Found|is not in this registry/i.test(`${result.stderr}\n${result.stdout}`)) return 'absent';
  return 'unknown';
}

/** The dry step of an extension channel: the publisher must not be the placeholder, and the CLI must be installed. */
function vsixReadiness(channel, repoRoot, cliName) {
  const reasons = [];
  if (channel.publisher === PLACEHOLDER_PUBLISHER || typeof channel.publisher !== 'string') reasons.push(`the publisher is ${channel.publisher ?? 'missing'}`);
  const cli = path.join(repoRoot, LAUNCHER_RELATIVE, 'node_modules', '.bin', cliName);
  if (!existsSync(cli)) reasons.push(`${cliName} is not installed in ${LAUNCHER_RELATIVE}/node_modules`);
  return { cli, reasons };
}

/**
 * Rehearse (`--dry-run`) or perform the upload of a prepared artifacts directory (see the header).
 *
 * @param {{ artifacts: string, dryRun?: boolean, env: Record<string, string | undefined>, repoRoot?: string, channels?: typeof RELEASE_CHANNELS }} options
 * @param {ReturnType<typeof defaultDeps> & { cleanups?: ReturnType<typeof createCleanups> }} deps
 * @returns {Promise<number>}
 */
export async function publish({ artifacts, dryRun = false, env, repoRoot = REPO_ROOT, channels = RELEASE_CHANNELS }, deps) {
  const say = (line) => deps.log(`publish${dryRun ? ' (dry run)' : ''}: ${line}`);
  const cleanups = deps.cleanups ?? createCleanups();
  const results = [];
  try {
    if (typeof artifacts !== 'string' || artifacts === '' || !existsSync(path.join(artifacts, MANIFEST_NAME))) {
      say(`cannot read ${MANIFEST_NAME} in ${JSON.stringify(artifacts)}. Pass --artifacts <the directory prepare wrote>.`);
      return 2;
    }
    const dir = path.resolve(artifacts);
    let manifest;
    try {
      manifest = readJson(path.join(dir, MANIFEST_NAME));
    } catch (error) {
      say(`${MANIFEST_NAME} is not valid JSON (${error instanceof Error ? error.message : String(error)}). Prepare the artifacts again.`);
      return 2;
    }

    // The refusals come first, before any upload. A dry run keeps the hash and npm checks with exit code 1.
    const refuseCode = dryRun ? 1 : 2;
    if (!dryRun) {
      const refusals = publishRefusals(env, manifest);
      if (refusals.length > 0) {
        for (const refusal of refusals) say(`refusing: ${refusal}`);
        return 2;
      }
    }
    const npmChannel = Array.isArray(manifest.channels) ? manifest.channels.find((entry) => entry.id === 'npm') : undefined;
    const npmPackages = Array.isArray(npmChannel?.packages) ? npmChannel.packages : [];
    const checks = [...artifactProblems(dir, manifest), ...uploadPathProblems(manifest, channels)];
    if (JSON.stringify(npmPackages.map((entry) => entry.name)) !== JSON.stringify(NPM_PUBLISH_ORDER)) {
      checks.push(`the manifest's packages are ${npmPackages.map((entry) => entry.name).join(', ')}, not ${NPM_PUBLISH_ORDER.join(', ')}. Prepare the artifacts again.`);
    }
    const npmVersion = await deps.run(['npm', '--version'], { cwd: dir, env: childEnv(env) });
    if (npmVersion.status !== 0) checks.push(`npm could not run (${npmVersion.error?.message ?? `exit ${npmVersion.status}`}). Install npm 11.5.1 or later.`);
    else checks.push(...npmVersionProblems(npmVersion.stdout));
    if (checks.length > 0) {
      for (const problem of checks) say(`${dryRun ? 'problem' : 'refusing'}: ${problem}`);
      return refuseCode;
    }
    say(`${npmPackages.length} packages at ${manifest.version}: hashes verified, npm ${npmVersion.stdout.trim()}`);

    if (!dryRun) {
      const guard = await readEnvironmentGuard(deps, env);
      if (guard.state !== 'protected') {
        say(`refusing: ${guard.line}. ${guard.problems.join(' ')}`);
        return 2;
      }
      say(guard.line);
    }

    // Auth: a token goes in a 0600 userconfig that is removed on every exit path; without one npm uses OIDC.
    let userconfig;
    const secrets = [];
    if (dryRun) {
      say('auth: none (dry run)');
    } else if (typeof env.NPM_TOKEN === 'string' && env.NPM_TOKEN !== '') {
      const keyDir = mkdtempSync(path.join(tmpdir(), 'release-npm-'));
      cleanups.add(() => rmSync(keyDir, { recursive: true, force: true }));
      userconfig = path.join(keyDir, 'npmrc');
      let text;
      try {
        text = npmUserconfig(env.NPM_TOKEN);
      } catch (error) {
        say(`refusing: ${error.message}`);
        return 2;
      }
      writeFileSync(userconfig, text, { encoding: 'utf8', mode: 0o600 });
      chmodSync(userconfig, 0o600);
      secrets.push(env.NPM_TOKEN);
      say('auth: token');
    } else {
      say('auth: oidc');
    }
    const npmEnv = childEnv(env);
    const publishEnv = { ...npmEnv, ...Object.fromEntries(OIDC_VARIABLES.filter((name) => typeof env[name] === 'string').map((name) => [name, env[name]])) };
    secrets.push(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
    const quote = (text) => redact(text, secrets);

    // npm, in order; the first failure stops everything after it.
    let failed = false;
    for (const entry of npmPackages) {
      const item = `${entry.name}@${entry.version}`;
      if (failed) {
        results.push({ channel: 'npm', item, status: STATUS.notAttempted });
        continue;
      }
      const viewed = await deps.run(['npm', ...npmViewArgv(entry.name, entry.version)], { cwd: dir, env: npmEnv });
      const outcome = viewOutcome(viewed, entry.version);
      if (outcome === 'published') {
        results.push({ channel: 'npm', item, status: dryRun ? STATUS.wouldBeAlreadyPublished : STATUS.alreadyPublished });
        say(`${item}: ${dryRun ? 'would be already published' : 'already published, skipped'}`);
        continue;
      }
      if (outcome === 'unknown') {
        failed = true;
        results.push({ channel: 'npm', item, status: STATUS.failed, detail: `could not ask the registry: ${quote(npmFailureDetail(viewed, 3))}` });
        say(`${item}: could not ask the registry whether it is published. Nothing after it is attempted.`);
        continue;
      }
      const uploaded = await deps.run(['npm', ...npmPublishArgv(path.join(dir, entry.tarball), { dryRun, ...(userconfig === undefined ? {} : { userconfig }) })], { cwd: dir, env: publishEnv });
      if (uploaded.status === 0) {
        results.push({ channel: 'npm', item, status: dryRun ? STATUS.wouldPublish : STATUS.published });
        say(`${item}: ${dryRun ? 'dry run ok' : 'published'}`);
      } else {
        failed = true;
        results.push({ channel: 'npm', item, status: STATUS.failed, detail: quote(npmFailureDetail(uploaded, 4)) });
        say(`${item}: npm publish failed (exit ${uploaded.status ?? 'none'}). Nothing after it is attempted. Fix the cause and run the release again: versions already on the registry are skipped.`);
      }
    }

    // The other channels, in order.
    for (const channel of channels.filter((entry) => entry.id !== 'npm')) {
      const detail = Array.isArray(manifest.channels) ? manifest.channels.find((entry) => entry.id === channel.id) : undefined;
      const item = channel.id === 'ipm' ? `${detail?.module ?? 'iris-execute-mcp-v2'}@${manifest.version}` : `${detail?.name ?? 'iris-mcp-launcher'}@${detail?.version ?? '?'}`;
      if (!channel.enabled) {
        const readiness = dryRun && detail !== undefined ? await channelReadiness(channel, detail, { dir, env, deps, repoRoot, version: manifest.version }) : undefined;
        results.push({ channel: channel.id, item, status: skippedText(channel), ...(readiness === undefined ? {} : { detail: readiness }) });
        say(`${channel.id}: ${skippedText(channel)}${readiness === undefined ? '' : `; dry step: ${readiness}`}`);
        continue;
      }
      if (failed) {
        results.push({ channel: channel.id, item, status: STATUS.notAttempted });
        continue;
      }
      let outcome;
      try {
        outcome = await runChannel(channel, detail, { dir, env, deps, repoRoot, dryRun, cleanups, version: manifest.version, sha: manifest.sha, quote });
      } catch (error) {
        outcome = { status: STATUS.failed, detail: quote(error instanceof Error ? error.message : String(error)) };
      }
      results.push({ channel: channel.id, item, status: outcome.status, ...(outcome.detail === undefined ? {} : { detail: outcome.detail }) });
      say(`${channel.id}: ${outcome.status}${outcome.detail === undefined ? '' : ` (${outcome.detail})`}`);
      if (outcome.status === STATUS.failed || (dryRun && outcome.status === STATUS.notReady)) failed = true;
    }

    const report = releaseReport(results);
    deps.log(report);
    appendSummary(env, `### ${dryRun ? 'Rehearsal' : 'Publish'} ${manifest.version}\n\n\`\`\`\n${report}\`\`\``);
    return failed ? 1 : 0;
  } finally {
    cleanups.run();
  }
}

/** The dry step of a channel that is not enabled: what would stop it if it were. */
async function channelReadiness(channel, detail, ctx) {
  const outcome = await dryStep(channel, detail, ctx);
  return outcome.status === STATUS.ready ? 'ready' : `${STATUS.notReady}: ${outcome.detail}`;
}

/** Read-only checks of one channel. Returns `{ status: 'ready' }` or `{ status: 'not ready', detail }`. */
async function dryStep(channel, detail, { dir, env, deps, repoRoot, version }) {
  if (channel.id === 'ipm') {
    const reasons = [];
    const listing = await ipmRegistryState(deps, version);
    if (listing.error !== undefined) reasons.push(`the registry could not be read (${listing.error})`);
    else if (listing.listed) reasons.push(`the registry already lists ${version}`);
    const url = `https://github.com/${IPM_DIST_REPOSITORY}.git`;
    const remote = await deps.run(['git', ...ipmPushPlan(path.join(dir, detail.tree ?? 'ipm'), version, '0'.repeat(40), { url, clone: dir }).lsRemoteArgv], { cwd: dir, env: childEnv(env, { GIT_TERMINAL_PROMPT: '0' }) });
    if (remote.status !== 0) {
      reasons.push(`the packaging repository ${IPM_DIST_REPOSITORY} is absent or not readable`);
    } else {
      const branch = ipmDefaultBranch(remote.stdout);
      if (branch !== undefined && branch !== IPM_DIST_BRANCH) reasons.push(`its default branch is ${branch}, not ${IPM_DIST_BRANCH}, and the registry reads the default branch`);
    }
    return reasons.length === 0 ? { status: STATUS.ready } : { status: STATUS.notReady, detail: reasons.join('; ') };
  }
  const { reasons } = vsixReadiness(detail, repoRoot, channel.id === 'vscode-marketplace' ? 'vsce' : 'ovsx');
  return reasons.length === 0 ? { status: STATUS.ready } : { status: STATUS.notReady, detail: reasons.join('; ') };
}

/** Ask the IPM registry whether it lists the version: `{ listed }`, or `{ error }`. A 404 means the package is not registered yet. */
async function ipmRegistryState(deps, version) {
  try {
    const response = await deps.fetch(IPM_REGISTRY_PACKAGE_URL, { headers: { Accept: 'application/json', 'User-Agent': 'iris-mcp-release' } });
    if (response.status === 404) return { listed: false };
    if (response.status < 200 || response.status >= 300) return { error: `HTTP ${response.status}` };
    let body;
    try {
      body = await response.json();
    } catch {
      return { error: 'the answer is not JSON' };
    }
    return { listed: ipmRegistryListsVersion(body, version) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Run one enabled channel: its dry step in a rehearsal, its upload otherwise. */
async function runChannel(channel, detail, ctx) {
  const { dir, env, deps, repoRoot, dryRun, cleanups, version, sha, quote } = ctx;
  if (detail === undefined) return { status: STATUS.failed, detail: `the manifest has no ${channel.id} entry. Prepare the artifacts again.` };
  if (dryRun) {
    const dry = await dryStep(channel, detail, ctx);
    return dry.status === STATUS.ready ? { status: STATUS.ready } : { status: STATUS.notReady, detail: dry.detail };
  }
  if (channel.id === 'ipm') return publishIpm(detail, { dir, env, deps, cleanups, version, sha, quote });
  const cliName = channel.id === 'vscode-marketplace' ? 'vsce' : 'ovsx';
  const { cli, reasons } = vsixReadiness(detail, repoRoot, cliName);
  if (reasons.length > 0) return { status: STATUS.failed, detail: reasons.join('; ') };
  const vsix = path.join(dir, detail.file);
  const argv = [cli, ...(channel.id === 'vscode-marketplace' ? vsceArgv(vsix) : ovsxArgv(vsix))];
  const uploaded = await deps.run(argv, { cwd: path.join(repoRoot, LAUNCHER_RELATIVE), env: childEnv(env) });
  return uploaded.status === 0 ? { status: STATUS.published } : { status: STATUS.failed, detail: quote(tail(uploaded.stderr || uploaded.error?.message || uploaded.stdout, 4)) };
}

/** The IPM channel: refuse a version the registry lists, push the staged tree to the packaging repository with the deploy key, and tag it. */
async function publishIpm(detail, { dir, env, deps, cleanups, version, sha, quote }) {
  const listing = await ipmRegistryState(deps, version);
  if (listing.error !== undefined) return { status: STATUS.failed, detail: `the registry could not be read (${listing.error}). Nothing was pushed.` };
  if (listing.listed) return { status: STATUS.failed, detail: `the IPM registry already lists ${version}. Release a new version; nothing was pushed.` };
  if (typeof env.IPM_DIST_DEPLOY_KEY !== 'string' || env.IPM_DIST_DEPLOY_KEY === '') {
    return { status: STATUS.failed, detail: "IPM_DIST_DEPLOY_KEY is not set. Add the deploy key as a release-environment secret, and to the publish step's env in release.yml and scripts/lib/release-checks.mjs." };
  }
  const work = mkdtempSync(path.join(tmpdir(), 'release-ipm-'));
  cleanups.add(() => rmSync(work, { recursive: true, force: true }));
  const keyFile = path.join(work, 'deploy-key');
  writeFileSync(keyFile, env.IPM_DIST_DEPLOY_KEY.endsWith('\n') ? env.IPM_DIST_DEPLOY_KEY : `${env.IPM_DIST_DEPLOY_KEY}\n`, { encoding: 'utf8', mode: 0o600 });
  chmodSync(keyFile, 0o600);
  const clone = path.join(work, 'repository');
  const tree = path.join(dir, detail.tree ?? 'ipm');
  const plan = ipmPushPlan(tree, version, sha, { url: `git@github.com:${IPM_DIST_REPOSITORY}.git`, clone });
  const gitEnv = childEnv(env, { GIT_SSH_COMMAND: `ssh -i ${keyFile} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`, GIT_TERMINAL_PROMPT: '0' });
  const git = (argv, cwd) => deps.run(['git', ...argv], { cwd, env: gitEnv });
  const failedAt = (step, result) => ({
    status: STATUS.failed,
    detail: `git ${step} failed (exit ${result.status ?? 'none'}): ${quote(tail(result.stderr || result.error?.message || result.stdout, 3))}. Fix the packaging repository or its deploy key, then run the release again.`,
  });

  const cloned = await git(plan.cloneArgv, work);
  if (cloned.status !== 0) return failedAt('clone', cloned);
  const branch = await git(plan.checkoutArgv, clone);
  if (branch.status !== 0) return failedAt('checkout', branch);
  for (const entry of readdirSync(clone)) {
    if (entry !== '.git') rmSync(path.join(clone, entry), { recursive: true, force: true });
  }
  cpSync(tree, clone, { recursive: true });
  const added = await git(plan.addArgv, clone);
  if (added.status !== 0) return failedAt('add', added);
  const written = await git(plan.writeTreeArgv, clone);
  if (written.status !== 0) return failedAt('write-tree', written);
  const existing = await git(plan.tagTreeArgv, clone);
  if (existing.status === 0) {
    if (existing.stdout.trim() === written.stdout.trim()) return { status: STATUS.alreadyPublished, detail: `${plan.tag} exists with this tree` };
    return { status: STATUS.failed, detail: `${plan.tag} exists on ${IPM_DIST_REPOSITORY} with a different tree. Release a new version.` };
  }
  const committed = await git(plan.commitArgv, clone);
  if (committed.status !== 0) return failedAt('commit', committed);
  const tagged = await git(plan.tagArgv, clone);
  if (tagged.status !== 0) return failedAt('tag', tagged);
  const pushed = await git(plan.pushArgv, clone);
  if (pushed.status !== 0) return failedAt('push', pushed);
  return { status: STATUS.published, detail: `${plan.tag} on ${IPM_DIST_REPOSITORY} ${plan.branch}` };
}

// -- the command line ------------------------------------------------------------------------------------------

const USAGE =
  'usage: node scripts/release.mjs ci-gate [--timeout-minutes <n>]\n' +
  '       node scripts/release.mjs prepare --out <dir>\n' +
  '       node scripts/release.mjs publish --artifacts <dir> [--dry-run]';

/**
 * Parse the command line into `{ command, options }`; a bad line throws a {@link Refusal} that holds the usage. One leading `--` is
 * dropped, because `pnpm release -- <command>` hands the script a literal `--` (pnpm 9.15).
 *
 * @param {readonly string[]} argv
 */
export function parseArgs(argv) {
  const [command, ...rest] = argv[0] === '--' ? argv.slice(1) : argv;
  const allowed = { 'ci-gate': ['--timeout-minutes'], prepare: ['--out'], publish: ['--artifacts'] }[command];
  if (allowed === undefined) throw new Refusal(`unknown command ${JSON.stringify(command)}. ${USAGE}`);
  const values = {};
  let dryRun = false;
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (command === 'publish' && flag === '--dry-run' && !dryRun) {
      dryRun = true;
    } else if (allowed.includes(flag) && index + 1 < rest.length && values[flag] === undefined) {
      values[flag] = rest[index + 1];
      index += 1;
    } else {
      throw new Refusal(`unknown argument ${JSON.stringify(flag)}. ${USAGE}`);
    }
  }
  if (command === 'prepare' && values['--out'] === undefined) throw new Refusal(`prepare needs --out. ${USAGE}`);
  if (command === 'publish' && values['--artifacts'] === undefined) throw new Refusal(`publish needs --artifacts. ${USAGE}`);
  const options = {};
  if (command === 'ci-gate' && values['--timeout-minutes'] !== undefined) {
    const minutes = Number(values['--timeout-minutes']);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Refusal(`--timeout-minutes must be a positive number. ${USAGE}`);
    options.timeoutMinutes = minutes;
  }
  if (command === 'prepare') options.out = values['--out'];
  if (command === 'publish') Object.assign(options, { artifacts: values['--artifacts'], dryRun });
  return { command, options };
}

/**
 * Install the cleanups on exit, SIGINT and SIGTERM. A signal kills the child processes that `runCaptured` started, runs the cleanups,
 * and exits with 130 or 143 from `setImmediate`, so that a listener registered later for the same signal (the gate set's, which
 * forwards the signal to its running command and removes the container) still runs before the process ends.
 *
 * @param {ReturnType<typeof createCleanups>} cleanups
 * @param {Pick<NodeJS.Process, 'once' | 'exit'>} [proc]
 */
export function installSignalHandlers(cleanups, proc = process) {
  proc.once('exit', () => cleanups.run());
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
    proc.once(signal, () => {
      for (const child of activeChildren) child.kill(signal);
      cleanups.run();
      setImmediate(() => proc.exit(code));
    });
  }
}

/**
 * The entry point: parse the command line, install the cleanup on exit, INT and TERM, and run the command.
 *
 * @param {readonly string[]} [argv]
 * @param {Record<string, string | undefined>} [env]
 * @returns {Promise<number>} The exit code.
 */
export async function main(argv = process.argv.slice(2), env = process.env) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`release: ${error.message}\n`);
    return 2;
  }
  const cleanups = createCleanups();
  const deps = { ...defaultDeps(), cleanups };
  installSignalHandlers(cleanups);
  const { command, options } = parsed;
  if (command === 'ci-gate') return ciGate({ env, ...options }, deps);
  if (command === 'prepare') {
    const out = path.resolve(options.out);
    process.chdir(REPO_ROOT);
    return prepare({ env, ...options, out }, deps);
  }
  return publish({ env, ...options }, deps);
}

if (isEntryPoint(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      process.stderr.write(`release: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exit(1);
    },
  );
}
