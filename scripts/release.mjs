#!/usr/bin/env node
// The release script (Story 42.5; AD-29, AD-14; DW-387, DW-675, DW-689): the only way anything is published. `.github/workflows/release.yml`
// runs it in four jobs, and `pnpm release` is an alias of `node scripts/release.mjs`.
//
// USE
//   node scripts/release.mjs ci-gate [--timeout-minutes <n>]       wait for a green ci.yml run on the commit, and check the environment
//   node scripts/release.mjs prepare --out <dir>                   run the checks and the gate set, then pack every artifact into <dir>
//   node scripts/release.mjs publish --artifacts <dir> --dry-run   rehearse the upload of <dir>
//   node scripts/release.mjs publish --artifacts <dir>             upload <dir>, channel by channel, in order
//   node scripts/release.mjs verify --version <x.y.z>              check the registry after a publish (read-only)
//
// CONTRACT
//   1. MODE. A run is a release only for a `push` of the tag `refs/tags/v<MAJOR.MINOR.PATCH>`; any other event or ref (a push to a
//      `release-dry-run/**` branch, a dispatch) is a dry run. `release-core.mjs` decides, and the manifest records it.
//   2. CI-GATE reads the `ci.yml` runs on GITHUB_SHA with GITHUB_TOKEN (GITHUB_API_URL, GITHUB_REPOSITORY) and polls every 60 s up to
//      the timeout. It passes on a completed `success` run that a `push` or a `workflow_dispatch` started (a pull request's run builds
//      its merge ref and never counts), exits 1 when every such run completed and none succeeded, when the timeout passes or when the
//      API fails or stalls for 30 s (it fails closed). It also reads the `release` environment: a tag run exits 1 unless the environment
//      is protected (a required reviewer, no administrator bypass, exactly one tag rule `v*`); a dry run prints one line about it.
//      A tag run is also refused unless the commit is on `main`: GET compare `main...<sha>` must answer `identical` or `behind`, and `ahead`,
//      `diverged`, any other status, a non-2xx answer, an error or a stall is a refusal. It runs after the environment guard and before the CI
//      poll, so a refused tag asks for no approval; a dry run prints one line about it. There is no maintenance-branch allowance.
//   3. PREPARE checks the version state (the extension's package.json and lock at the shared version in both modes; in release mode its CHANGELOG's
//      first `## [` heading naming the version, which a dry run reports as `a tag run would refuse`) and the generated files, runs every root script that checks the tree (the set CI's gates run, `gen:ipm:check` among them), runs every package's `prepublishOnly` ONCE through the throwaway harness
//      (`scripts/throwaway-iris.mjs exec ... node scripts/ci-live-suite.mjs prepublish-<short>`, which exports IRIS_REQUIRE_LIVE=1 and all
//      five IRIS_* variables), and only then packs: eight tarballs with `pnpm pack` (no lifecycle script) and the vsix,
//      with `release-manifest.json` (version, sha, mode, channels, files, sha256). The container is removed on every exit path.
//      The IPM tree is committed, not packed: a release refuses a tree whose marker is not `BOOTSTRAP_VERSION` (the version step did not run
//      on the final content), and a dry run notes the difference (`ipm: main carries <m1> for the registry; the next version step stamps <m2>`).
//   4. PUBLISH verifies the manifest's hashes and the version of npm, and that every path it would upload (each npm tarball, an enabled
//      channel's vsix) is one of those hash-verified files inside the artifacts directory; then uploads the exact tarballs: `npm publish <tgz> --access public
//      --provenance --ignore-scripts`, in NPM_PUBLISH_ORDER, then each enabled channel in order. A version already on the registry is
//      skipped. The first failure stops everything after it (a channel that throws is a failed channel), and the report names every
//      package and channel as published, already published, failed, not attempted or skipped. A real run refuses, with exit 2 and
//      before any upload, unless it is a `push` of `refs/tags/v<manifest.version>` on the manifest's sha with a manifest prepared in
//      release mode, and unless the environment guard passes again. `--dry-run` runs `npm publish --dry-run`, never reads NPM_TOKEN, and runs no `vsce`/`ovsx` publish, no
//      `git push` and no userconfig write; its store steps make read-only GETs only.
//      THE STORES (Story 42.7). Each store channel (the Marketplace, then Open VSX) asks the store, read-only, whether it holds the version:
//      published (the Marketplace's vsix, `application/vsix`; Open VSX's JSON naming the namespace, name and version) is `already
//      published` with no upload, absent (404) uploads with `--skip-duplicate` (a CLI line ending `is already published. Skipping
//      publish.` after an exit 0 is still `already published`), and a lookup that cannot be judged (another status, a 200 that is not
//      the store's answer, a network error, a 30 s stall) fails closed: nothing is uploaded to that store and nothing after it is attempted (the channels before it
//      have already run). Open VSX also needs its namespace (`GET https://open-vsx.org/api/<publisher>`, a 200 only when it is JSON):
//      absent is `skipped (not set up: ...)` (see NOT SET UP below).
//      The CLIs are the exact pins in the launcher's `node_modules/.bin`; `vsce publish --oidc` is trusted publishing, and `ovsx publish`
//      uses trusted publishing too unless OVSX_PAT is set (the first publish). In release mode the vsix must be at the manifest's version.
//      IPM (Story 42.8, decision #122). IPM has no upload, key or repository of its own: the registry reads the root `module.xml` of `main` and
//      serves a re-tar of GitHub's archive of `main`, when the owner presses Release on the Open Exchange listing. The channel reads the
//      registry (read-only): a version it lists is `already published` (`ready (would be already published)` in a rehearsal); any other
//      answer, and a registry that cannot be read, is a `manual step` (`ready (manual step after the tag: ...)` in a rehearsal). The
//      channel can neither fail nor block a run. Each manual step is a "Manual steps" block at the end of the report and a `::warning::`.
//      NOT SET UP (decision #121). A channel whose OWNER SETUP is missing is `skipped (not set up: <reason>)` in a rehearsal and in a
//      release, does not fail the run, and later channels still run, so that an npm-only release can go out. The only reason today is the
//      one the real service gives: the Open VSX namespace's 404 (owner step O1). Nothing else is one: an unreadable lookup, a network
//      failure, a hash mismatch, a missing CLI, the placeholder publisher, a failed upload, and anything on npm still fail the run, and
//      so does a channel that has a real problem beside an unset one. The Marketplace has no such reason: no public read-only signal tells
//      a missing publisher from a publisher that has published nothing yet (Story 42.8, DW-705). The IPM channel is not one: its owner step is
//      a `manual step`, never `skipped`, because every run needs it. The end of the run lists every skipped
//      channel with its reason, in the report (and so in the step summary) and as a `::warning::` annotation; running the release again
//      after the setup publishes them (npm and the other channels read `already published`).
//      THE MCP REGISTRY (Story 42.8). The channel is last and the registry is in preview, so it never blocks the others: in a rehearsal its
//      `not ready` is reported but the run does not exit non-zero for it (and the rehearsal reads it even when an earlier channel is not ready),
//      and in a release its failure fails the run only after every channel before it has run, with a rerun recovering it. It asks the registry
//      (read-only) about each of the five `server.json` listings first; an answer that cannot be judged posts nothing. For the absent ones it
//      downloads the pinned `mcp-publisher` (a sha256 pin; a mismatch is never run), waits (up to 5 minutes) for npm to serve each package
//      version, runs `login github-oidc` (no secret) and one `publish <server.json>` per listing, all with a temporary HOME that is removed on
//      every exit path. A failed publish is judged by a fresh lookup. The OIDC request variables reach that login only.
//   5. AUTH. NPM_TOKEN set: a 0600 temporary userconfig holds it and is passed as `--userconfig`; it is removed on every exit path and the
//      token is never printed. NPM_TOKEN empty: no userconfig, npm uses OIDC (trusted publishing). The token, GITHUB_TOKEN, VSCE_PAT and
//      OVSX_PAT are removed from the environment of every child process, and the job's OIDC request variables
//      (ACTIONS_ID_TOKEN_REQUEST_TOKEN and _URL) reach only `npm publish`, `vsce publish`, `ovsx publish` and `mcp-publisher login`. OVSX_PAT reaches only
//      `ovsx publish`, as an environment variable, never in argv. Every secret is redacted from every report line.
//   6. Each phase prints a line, and the report is appended to $GITHUB_STEP_SUMMARY when it is set.
//   7. SIGINT and SIGTERM kill the child processes that are running, run the cleanups and end the run with 130 or 143
//      (`installSignalHandlers`); the gate set's own handlers, registered later, forward the signal to its command and remove the container.
//   8. VERIFY is read-only: for every package of NPM_PUBLISH_ORDER, `npm view <name>@<v> version dist.attestations --json` must show the
//      version with a provenance attestation, each of the five servers must be listed on the MCP Registry at <v>, the IPM registry is
//      `pending` (never a failure) until it lists <v> and, once it does, the module in the archive it serves (the root `module.xml`, `ipm/src`
//      and `preload`) must equal `git archive v<v>` member for member and byte for byte (the local tag must exist), and `npx -y @iris-mcp/dev@1` must answer `initialize` with `serverInfo.version` <v> in a
//      clean temporary home, npm cache and working directory, against a closed local port. It prints one line per check, never publishes,
//      logs in or reaches IRIS, and removes its temporary directory on every exit path. It covers the `@1` major only.
//
// EXIT CODES
//   0 passed; 1 a check, a gate or an upload failed; 2 usage or a refusal; 3 docker is not on PATH; 4 the container did not start.
//
// IMPORT
//   Importing this module runs nothing. `ci-gate`, `rehearse` and `publish` run with no `node_modules`, so this file imports only `node:`
//   builtins, `lib/release-core.mjs` and `lib/script-process.mjs`; every module that `prepare` alone needs (the harness, the packer, the
//   smoke) is loaded by `import()` inside `prepare` (`verify` loads the raw stdio driver and the archive reader the same way). `ciGate`, `prepare`, `publish` and `verify` take every side effect as `deps`.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
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
  IPM_MANIFEST_RELATIVE,
  IPM_MODULE,
  IPM_REGISTRY_PACKAGE_URL,
  IPM_SOURCE_REPOSITORY,
  IPM_TREE_GUARD_RELATIVE,
  MARKETPLACE_RELATIVE,
  MCP_PUBLISHER,
  marketplaceUncheckedNote,
  NPM_NOT_FOUND,
  NPM_PUBLISH_ORDER,
  NPM_VISIBLE_POLL_MS,
  NPM_VISIBLE_TIMEOUT_MS,
  OPEN_EXCHANGE_LISTING_URL,
  PLACEHOLDER_PUBLISHER,
  PLUGIN_ENTRY_NAME,
  PLUGIN_MANIFEST_RELATIVE,
  RELEASE_CHANNELS,
  RELEASE_CHECK_EXEMPTIONS,
  RELEASE_ENVIRONMENT,
  ROOT_CHECK_SCRIPT,
  SERVER_JSON_DIRS,
  STATUS,
  ciGateDecision,
  compareUrl,
  describeRuns,
  environmentProblems,
  environmentSummary,
  environmentWarnings,
  extensionChangelogProblems,
  ipmArchiveUrl,
  ipmManualStepText,
  ipmNotListedReason,
  ipmRegistryListsVersion,
  ipmRehearsalDetail,
  ipmUnreadableReason,
  mainReachability,
  manualStepAnnotations,
  mcpPublisherArgv,
  mcpPublisherUrl,
  notSetUpAnnotations,
  notSetUpDetail,
  npmPublishArgv,
  npmUserconfig,
  npmVersionProblems,
  npmVersionUrl,
  npmViewArgv,
  npmViewJsonArgv,
  openVsxNamespaceUrl,
  ovsxArgv,
  publishRefusals,
  registryLookupUrl,
  registryOutcome,
  registryProblems,
  releaseMode,
  releaseReport,
  skippedDuplicate,
  skippedText,
  storeLookupHeaders,
  storeLookupUrl,
  storeOutcome,
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

/** The variables with which a publish CLI asks GitHub for the job's OIDC token (trusted publishing and provenance): only `npm publish`, `vsce publish` and `ovsx publish` get them. */
const OIDC_VARIABLES = Object.freeze(['ACTIONS_ID_TOKEN_REQUEST_TOKEN', 'ACTIONS_ID_TOKEN_REQUEST_URL']);

/** The variables that never reach a child process: each reaches only the code that needs it. */
const SECRET_VARIABLES = Object.freeze(['NPM_TOKEN', 'GITHUB_TOKEN', 'OVSX_PAT', 'VSCE_PAT', ...OIDC_VARIABLES]);

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
    loadWire: loadVerifyWire,
    loadArchive: loadVerifyArchive,
  };
}

/** The wire helpers only `verify` needs (the raw stdio driver and the closed-port settings), loaded when it needs them. */
async function loadVerifyWire(repoRoot = REPO_ROOT) {
  return import(pathToFileURL(path.join(repoRoot, 'scripts/lib/sdk-wire-golden-core.mjs')).href);
}

/** The modules only `prepare` needs, loaded when it needs them (a runner without `node_modules` never loads them). */
async function loadPrepareModules(repoRoot = REPO_ROOT) {
  const load = (relative) => import(pathToFileURL(path.join(repoRoot, relative)).href);
  const [harness, checks, pack, smoke] = await Promise.all([
    load('scripts/throwaway-iris.mjs'),
    load('scripts/lib/ci-checks.mjs'),
    load('scripts/lib/pnpm-pack.mjs'),
    load('scripts/ci-package-smoke.mjs'),
  ]);
  return { harness, checks, pack, smoke };
}

/** The archive reader only `verify` needs (the tgz parser and the archive comparison), loaded when it needs them. */
async function loadVerifyArchive(repoRoot = REPO_ROOT) {
  return import(pathToFileURL(path.join(repoRoot, 'scripts/lib/ipm-archive.mjs')).href);
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

/**
 * Ask GitHub whether the commit is on `main` (the compare of `main...<sha>`) and judge the answer.
 *
 * @returns {Promise<ReturnType<typeof mainReachability>>}
 */
export async function readMainReachability(deps, env, sha) {
  return mainReachability(await githubGet(deps, env, compareUrl(apiRoot(env), env.GITHUB_REPOSITORY, sha)), sha);
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
  const onMain = await readMainReachability(deps, env, info.sha);
  if (info.mode === 'release') {
    say(guard.line);
    say(onMain.line);
    const refusals = [];
    if (guard.state !== 'protected') refusals.push(`refusing the tag run: ${guard.problems.join(' ')} No later job runs.`);
    if (onMain.state !== 'on-main') refusals.push(`refusing the tag run: ${onMain.problem} No later job runs.`);
    if (refusals.length > 0) {
      for (const refusal of refusals) say(refusal);
      return 1;
    }
  } else {
    say(`${guard.line}${guard.state === 'protected' ? '' : '; a tag run stops here'}`);
    say(`${onMain.line}${onMain.state === 'on-main' ? '' : '; a tag run stops here'}`);
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
 * the shared version, the bootstrap marker, the version of the root `module.xml` and the marker the committed IPM tree stamps.
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
  const moduleFile = path.join(repoRoot, IPM_MANIFEST_RELATIVE);
  const moduleVersion = existsSync(moduleFile) ? /<Version>([^<]+)<\/Version>/.exec(readFileSync(moduleFile, 'utf8'))?.[1]?.trim() : undefined;
  // The marker the committed IPM tree stamps (its install guard), which the registry serves for the module's version.
  const guardFile = path.join(repoRoot, ...IPM_TREE_GUARD_RELATIVE.split('/'));
  const ipmTreeMarker = existsSync(guardFile) ? /^Parameter BOOTSTRAPVERSION = "([^"]*)";$/m.exec(readFileSync(guardFile, 'utf8'))?.[1] : undefined;
  const shared = found.get('@iris-mcp/shared');
  const extensionDir = path.join(repoRoot, LAUNCHER_RELATIVE);
  const readIf = (file, parse) => (existsSync(file) ? parse(readFileSync(file, 'utf8')) : undefined);
  const extension = {
    version: readIf(path.join(extensionDir, 'package.json'), (text) => JSON.parse(text).version),
    lockVersion: readIf(path.join(extensionDir, 'package-lock.json'), (text) => JSON.parse(text).version),
    lockRootVersion: readIf(path.join(extensionDir, 'package-lock.json'), (text) => JSON.parse(text).packages?.['']?.version),
    changelog: readIf(path.join(extensionDir, 'CHANGELOG.md'), (text) => text),
  };
  // The listings embed the version too (lockstep): the plugin manifest, the marketplace entry's ref and each server.json.
  const readJsonIf = (relative) => readIf(path.join(repoRoot, relative), (text) => JSON.parse(text));
  const marketplace = readJsonIf(MARKETPLACE_RELATIVE);
  const listings = {
    pluginVersion: readJsonIf(PLUGIN_MANIFEST_RELATIVE)?.version,
    marketplaceRef: marketplace?.plugins?.find?.((entry) => entry?.name === PLUGIN_ENTRY_NAME)?.source?.ref,
    servers: SERVER_JSON_DIRS.map((dir) => {
      const file = `packages/${dir}/server.json`;
      const listing = readJsonIf(file);
      return { file, version: listing?.version, packageVersion: listing?.packages?.[0]?.version };
    }),
  };
  return { packages, problems, pending, marker, moduleVersion, ipmTreeMarker, sharedVersion: shared?.manifest.version, extension, listings };
}

/**
 * What is wrong with the files that embed the version: the bootstrap marker's semver, the root `module.xml`, and the extension's
 * `package.json` and `package-lock.json` (both of its version fields) must equal the shared version. With `release: true` the IPM tree
 * must also stamp `BOOTSTRAP_VERSION` exactly: the registry serves `main`'s tree, so a release whose tree is older than the embed would
 * publish content that is not the release's (the version step regenerates the tree and the embed together).
 *
 * @param {Record<string, any>} facts
 * @param {{ release?: boolean }} [options]
 */
export function embeddedVersionProblems(facts, { release = false } = {}) {
  const problems = [];
  const markerSemver = facts.marker?.split('+')[0];
  if (markerSemver !== facts.sharedVersion) {
    problems.push(`BOOTSTRAP_VERSION is ${JSON.stringify(facts.marker)}, whose semver is not the shared version ${facts.sharedVersion}. Run pnpm run version, which regenerates it.`);
  }
  if (facts.moduleVersion !== facts.sharedVersion) {
    problems.push(`${IPM_MANIFEST_RELATIVE} is at ${JSON.stringify(facts.moduleVersion)}, not the shared version ${facts.sharedVersion}. Run pnpm run version, which regenerates it.`);
  }
  if (release && facts.ipmTreeMarker !== facts.marker) {
    problems.push(`the IPM tree stamps ${facts.ipmTreeMarker ?? 'no marker'}, the embed ${facts.marker}: the version step did not run on the final content. Run pnpm run version.`);
  }
  const extensionDir = LAUNCHER_RELATIVE.split(path.sep).join('/');
  const extension = facts.extension ?? {};
  for (const [file, version] of [
    [`${extensionDir}/package.json`, extension.version],
    [`${extensionDir}/package-lock.json (version)`, extension.lockVersion],
    [`${extensionDir}/package-lock.json (packages[""].version)`, extension.lockRootVersion],
  ]) {
    if (version !== facts.sharedVersion) problems.push(`${file} is at ${JSON.stringify(version)}, not the shared version ${facts.sharedVersion}. Run pnpm run version, which stamps it.`);
  }
  const listings = facts.listings ?? {};
  if (listings.pluginVersion !== facts.sharedVersion) {
    problems.push(`${PLUGIN_MANIFEST_RELATIVE} is at ${JSON.stringify(listings.pluginVersion)}, not the shared version ${facts.sharedVersion}. Run pnpm run version, which regenerates it.`);
  }
  if (listings.marketplaceRef !== `v${facts.sharedVersion}`) {
    problems.push(`${MARKETPLACE_RELATIVE} pins the ref ${JSON.stringify(listings.marketplaceRef)}, not the release tag v${facts.sharedVersion}. Run pnpm run version, which regenerates it.`);
  }
  for (const server of listings.servers ?? []) {
    for (const [field, version] of [['version', server.version], ['packages[0].version', server.packageVersion]]) {
      if (version !== facts.sharedVersion) problems.push(`${server.file} ${field} is ${JSON.stringify(version)}, not the shared version ${facts.sharedVersion}. Run pnpm run version, which regenerates it.`);
    }
  }
  if ((listings.servers ?? []).length !== SERVER_JSON_DIRS.length) {
    problems.push(`the server.json listings were not read (${(listings.servers ?? []).length} of ${SERVER_JSON_DIRS.length}). Run pnpm gen:listings.`);
  }
  return problems;
}

/**
 * The names of the root scripts that `prepare` runs: those with a `check` or `validate` word in the name (`ROOT_CHECK_SCRIPT`, the
 * pattern CI's own scan uses), less the exemptions and the lifecycle hooks. A hook is a name that starts with `pre` or `post` and
 * whose remainder is itself a script (`pregen:x:check` of `gen:x:check`); `prettier:check` is not one.
 */
export function releaseCheckScripts(scripts) {
  const isHook = (name) => {
    const hooked = /^(?:pre|post)(.+)$/.exec(name)?.[1];
    return hooked !== undefined && Object.hasOwn(scripts, hooked);
  };
  return Object.keys(scripts)
    .filter((name) => ROOT_CHECK_SCRIPT.test(name) && !isHook(name) && !(name in RELEASE_CHECK_EXEMPTIONS))
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

/**
 * The IPM channel's entry in the manifest: no files, because the tree is committed and the registry serves `main`. It records what the
 * owner's Release will publish: the module, the version and the marker the tree stamps.
 */
function ipmChannelDetail(facts, version, say) {
  say(`the IPM tree on main stamps ${facts.ipmTreeMarker}: the owner's Release on the Open Exchange listing publishes it (a manual step)`);
  return { module: IPM_MODULE, version, marker: facts.ipmTreeMarker, listing: OPEN_EXCHANGE_LISTING_URL, manual: true };
}

/**
 * The registry listings: the five `server.json` files copied, byte for byte, to `<out>/mcp-registry/<bin>.json` (the bin is the last
 * segment of the listing's `name`). Each must be at `version` and name its npm package at that version, so that what `publish` sends is
 * what the packages are.
 */
function stageRegistryListings({ repoRoot, out, version, say }) {
  const directory = path.join(out, 'mcp-registry');
  mkdirSync(directory, { recursive: true });
  const servers = [];
  for (const dir of SERVER_JSON_DIRS) {
    const source = path.join(repoRoot, 'packages', dir, 'server.json');
    const listing = readJson(source);
    const file = `mcp-registry/${String(listing.name).split('/').pop()}.json`;
    if (listing.version !== version || listing.packages?.[0]?.version !== version) {
      throw new Error(`packages/${dir}/server.json is at ${JSON.stringify(listing.version)} (package ${JSON.stringify(listing.packages?.[0]?.version)}), not ${version}. Run pnpm run version, which regenerates it.`);
    }
    copyFileSync(source, path.join(out, file));
    servers.push({ name: listing.name, version: listing.version, package: listing.packages[0].identifier, file });
  }
  say(`the MCP Registry listings: ${servers.length} server.json files at ${version}`);
  return { servers };
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
    ...extensionChangelogProblems(facts.extension.changelog ?? '', version),
  ];
  const blocking = [...embeddedVersionProblems(facts, { release: info.mode === 'release' })];
  if (info.mode === 'release') blocking.unshift(...versionIssues);
  else for (const issue of versionIssues) say(`a tag run would refuse: ${issue}`);
  if (info.mode !== 'release' && facts.ipmTreeMarker !== facts.marker) {
    say(`ipm: main carries ${facts.ipmTreeMarker ?? 'no marker'} for the registry; the next version step stamps ${facts.marker}`);
  }
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
    const ipm = ipmChannelDetail(facts, version, say);
    const registry = stageRegistryListings({ repoRoot, out: outDir, version, say });

    const channelDetails = {
      npm: { packages: packedPackages.map((entry) => ({ name: entry.name, version: entry.version, tarball: `npm/${path.basename(entry.tarball)}` })) },
      'vscode-marketplace': vsix,
      'open-vsx': vsix,
      ipm,
      'mcp-registry': registry,
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
 * entry is at the manifest's version. An enabled store channel uploads a listed `.vsix` (at the manifest's version in a release). The IPM
 * channel uploads nothing, so it lists no file. A channel that is not enabled uploads nothing, so its paths are not checked.
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
    if (detail === undefined) {
      if (channel.enabled && channel.id === 'mcp-registry') problems.push(`${channel.id}: the manifest has no ${channel.id} entry, so no server.json would be posted. Prepare the artifacts again.`);
      continue;
    }
    if (channel.id === 'ipm') {
      // The manual IPM step uploads nothing, so it names no file to check.
      continue;
    } else if (channel.id === 'mcp-registry') {
      const servers = Array.isArray(detail.servers) ? detail.servers : [];
      if (servers.length === 0) problems.push(`${channel.id}: the manifest lists no server.json. Prepare the artifacts again.`);
      for (const server of servers) {
        const item = `${server?.name}@${server?.version}`;
        if (!isContainedPath(server?.file) || !verified.has(server.file) || !server.file.endsWith('.json')) {
          problems.push(`${channel.id}: ${item}: its listing ${JSON.stringify(server?.file)} is not a hash-verified .json of ${MANIFEST_NAME}. Prepare the artifacts again.`);
        }
        if (manifest?.mode === 'release' && server?.version !== manifest.version) {
          problems.push(`${channel.id}: ${item} is not at the release version ${manifest.version}. Run pnpm run version, then prepare the artifacts again.`);
        }
      }
    } else {
      if (!isContainedPath(detail.file) || !verified.has(detail.file) || !detail.file.endsWith('.vsix')) {
        problems.push(`${channel.id}: its vsix ${JSON.stringify(detail.file)} is not a hash-verified .vsix of ${MANIFEST_NAME}. Prepare the artifacts again.`);
      }
      if (manifest?.mode === 'release' && detail.version !== manifest.version) {
        problems.push(`${channel.id}: its vsix is at ${JSON.stringify(detail.version)}, not the release version ${manifest.version}. Run pnpm run version, then prepare the artifacts again.`);
      }
    }
  }
  return problems;
}

/** Whether `npm view` said that the version is on the registry (`published`), is not (`absent`), or could not be judged (`unknown`). */
function viewOutcome(result, version) {
  if (result.status === 0 && result.stdout.trim() === version) return 'published';
  if (result.status !== 0 && NPM_NOT_FOUND.test(`${result.stderr}\n${result.stdout}`)) return 'absent';
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

/** The OIDC request variables of the job that are set: what a publish CLI needs to ask GitHub for its token. */
const oidcEnv = (env) => Object.fromEntries(OIDC_VARIABLES.filter((name) => typeof env[name] === 'string').map((name) => [name, env[name]]));

/**
 * The HTTP status and content type of a read-only GET, or `{ error }` when it failed or stalled. With `json`, an answer whose status is in
 * `jsonStatuses` (a 200 unless the caller says otherwise) and that says it is JSON has its body parsed into `body` (left out when it does
 * not parse); every other body is cancelled unread.
 */
async function readStatus(deps, url, headers, { json = false, jsonStatuses = [200] } = {}) {
  try {
    const response = await deps.fetch(url, { headers });
    const contentType = response.headers.get('content-type');
    if (json && jsonStatuses.includes(response.status) && /^application\/json\s*(?:;|$)/i.test(String(contentType ?? '').trim())) {
      try {
        return { status: response.status, contentType, body: await response.json() };
      } catch {
        return { status: response.status, contentType };
      }
    }
    try {
      await response.body?.cancel();
    } catch {
      // only the status and the content type are read
    }
    return { status: response.status, contentType };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** Ask a store (read-only) whether it holds `detail.name@version`: `{ outcome: 'published' | 'absent' | 'unknown', why? }`. */
async function storeLookup(deps, store, detail, version) {
  const answer = await readStatus(deps, storeLookupUrl(store, detail.publisher, detail.name, version), storeLookupHeaders(store), { json: store === 'open-vsx' });
  if (answer.error !== undefined) return { outcome: 'unknown', why: answer.error };
  return storeOutcome(store, answer, { publisher: detail.publisher, name: detail.name, version });
}

/** Ask Open VSX (read-only) whether the namespace exists: `{ state: 'present' | 'absent' | 'unknown', problem? }`. */
async function openVsxNamespaceState(deps, publisher) {
  const answer = await readStatus(deps, openVsxNamespaceUrl(publisher), { Accept: 'application/json', 'User-Agent': 'iris-mcp-release' }, { json: true, jsonStatuses: [200, 404] });
  const type = String(answer.contentType ?? '').trim();
  // Like a version lookup, a 200 is the namespace only when it is Open VSX's JSON, not a proxy or captive-portal page.
  if (answer.status === 200 && /^application\/json\s*(?:;|$)/i.test(type)) return { state: 'present' };
  // Absent (decision #121: a skip, not a failure) only on the store's own answer, read-only GET 2026-11-21: 404 `application/json`
  // `{"error":"Namespace not found: <name>"}`. Any other 404 (an HTML proxy page, or the JSON `"error":"Not Found"` Open VSX gives a path it
  // does not route) is not the namespace's answer, so it is unknown and fails the run.
  const body = /** @type {{ error?: unknown } | undefined} */ (answer.body);
  if (answer.status === 404 && body?.error === `Namespace not found: ${publisher}`) {
    return { state: 'absent', problem: `the Open VSX namespace ${publisher} does not exist. Create it once with npx ovsx create-namespace ${publisher} (owner step O1).` };
  }
  const why =
    answer.error ??
    (answer.status === 200
      ? `HTTP 200, but the answer is ${type === '' ? 'untyped' : type}, not JSON, so it is not the store's answer`
      : answer.status === 404
        ? `HTTP 404, but not Open VSX's "Namespace not found" answer, so it does not say the namespace is absent`
        : `HTTP ${answer.status}`);
  return { state: 'unknown', problem: `the Open VSX namespace ${publisher} could not be read (${why}). Check the network and open-vsx.org, then run the release again.` };
}

/** The sentence for a lookup that could not be judged: the release stops, because it cannot tell an upload from a duplicate. */
const lookupProblem = (store, item, why) => `could not ask ${store} whether ${item} is published (${why}). Nothing was uploaded to ${store}; check the network and the store, then run the release again.`;

/**
 * Rehearse (`--dry-run`) or perform the upload of a prepared artifacts directory (see the header).
 *
 * @param {{ artifacts: string, dryRun?: boolean, env: Record<string, string | undefined>, repoRoot?: string, channels?: typeof RELEASE_CHANNELS }} options
 * @param {ReturnType<typeof defaultDeps> & { cleanups?: ReturnType<typeof createCleanups> }} deps
 * @returns {Promise<number>}
 */
export async function publish(options, deps) {
  const summary = withSummary(deps, options.env, options.dryRun === true ? 'publish --dry-run' : 'publish');
  let reported = false;
  let code = 1;
  try {
    code = await runPublish(options, { ...summary.deps, reported: () => { reported = true; } });
    return code;
  } finally {
    if (!reported) summary.finish(code);
  }
}

async function runPublish({ artifacts, dryRun = false, env, repoRoot = REPO_ROOT, channels = RELEASE_CHANNELS }, deps) {
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
    const publishEnv = { ...npmEnv, ...oidcEnv(env) };
    secrets.push(env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, env.OVSX_PAT, env.VSCE_PAT);
    const quote = (text) => redact(text, secrets);

    // npm, in order; the first failure stops everything after it.
    let failed = false;
    let hardFailed = false;
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
        hardFailed = true;
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
        hardFailed = true;
        results.push({ channel: 'npm', item, status: STATUS.failed, detail: quote(npmFailureDetail(uploaded, 4)) });
        say(`${item}: npm publish failed (exit ${uploaded.status ?? 'none'}). Nothing after it is attempted. Fix the cause and run the release again: versions already on the registry are skipped.`);
      }
    }

    // The other channels, in order. The MCP Registry (in preview) is last and never blocks the others: in a rehearsal its `not ready` is
    // reported but does not fail the run, and a rehearsal still reads it when an earlier channel is `not ready` (read-only checks). In a
    // release its failed upload fails the run only after everything before it has run, and a rerun recovers it.
    let registryNotReady = false;
    for (const channel of channels.filter((entry) => entry.id !== 'npm')) {
      const detail = Array.isArray(manifest.channels) ? manifest.channels.find((entry) => entry.id === channel.id) : undefined;
      const item =
        channel.id === 'ipm'
          ? `${detail?.module ?? 'iris-execute-mcp-v2'}@${manifest.version}`
          : channel.id === 'mcp-registry'
            ? `${Array.isArray(detail?.servers) ? detail.servers.length : 0} servers@${manifest.version}`
            : `${detail?.name ?? 'iris-mcp-launcher'}@${detail?.version ?? '?'}`;
      if (!channel.enabled) {
        const readiness = dryRun && detail !== undefined ? await channelReadiness(channel, detail, { dir, env, deps, repoRoot, version: manifest.version }) : undefined;
        results.push({ channel: channel.id, item, status: skippedText(channel), ...(readiness === undefined ? {} : { detail: readiness }) });
        say(`${channel.id}: ${skippedText(channel)}${readiness === undefined ? '' : `; dry step: ${readiness}`}`);
        continue;
      }
      if (failed && !(dryRun && channel.id === 'mcp-registry' && !hardFailed)) {
        results.push({ channel: channel.id, item, status: STATUS.notAttempted });
        continue;
      }
      let outcome;
      try {
        outcome = await runChannel(channel, detail, { dir, env, deps, repoRoot, dryRun, cleanups, version: manifest.version, sha: manifest.sha, quote, secrets });
      } catch (error) {
        outcome = { status: STATUS.failed, detail: quote(error instanceof Error ? error.message : String(error)) };
      }
      if (Array.isArray(outcome.items)) {
        for (const entry of outcome.items) {
          results.push({ channel: channel.id, item: entry.item, status: entry.status, ...(entry.detail === undefined ? {} : { detail: entry.detail }) });
          say(`${channel.id}: ${entry.item}: ${entry.status}${entry.detail === undefined ? '' : ` (${entry.detail})`}`);
        }
      } else {
        results.push({
          channel: channel.id,
          item,
          status: outcome.status,
          ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
          ...(outcome.notSetUp === true ? { notSetUp: true } : {}),
          ...(outcome.manual === true ? { manual: true } : {}),
        });
        say(`${channel.id}: ${outcome.status}${outcome.detail === undefined ? '' : ` (${outcome.detail})`}`);
      }
      if (outcome.status === STATUS.failed) {
        failed = true;
        hardFailed = true;
      } else if (dryRun && outcome.status === STATUS.notReady) {
        if (channel.id === 'mcp-registry') registryNotReady = true;
        else failed = true;
      }
    }
    if (registryNotReady) say('mcp-registry is not ready, which does not stop the rehearsal: the registry is in preview and never blocks npm, the stores or IPM.');

    // A channel skipped as not set up is not a failure, so each one is also an annotation (a raw `::warning::` line) beside the report's block.
    for (const annotation of notSetUpAnnotations(results)) deps.log(annotation);
    // A manual step is the owner's to do after the run, so it is an annotation too; it never changes the exit code.
    for (const annotation of manualStepAnnotations(results)) deps.log(annotation);
    const report = releaseReport(results);
    deps.log(report);
    appendSummary(env, `### ${dryRun ? 'Rehearsal' : 'Publish'} ${manifest.version}\n\n\`\`\`\n${report}\`\`\``);
    deps.reported?.();
    return failed ? 1 : 0;
  } finally {
    cleanups.run();
  }
}

/** The dry step of a channel that is not enabled: what would stop it if it were. */
async function channelReadiness(channel, detail, ctx) {
  const outcome = await dryStep(channel, detail, ctx);
  if (outcome.status === STATUS.ready) return outcome.detail === undefined ? 'ready' : `ready (${outcome.detail})`;
  return `${STATUS.notReady}: ${outcome.detail}`;
}

/**
 * What a dry step says when it is not ready: `detail` is every reason, joined; `notSetUp` is true only when EVERY reason is a missing
 * owner setup (decision #121), so that a channel with a real problem beside an unset one stays `not ready` and fails the run.
 */
function notReadyOutcome(reasons) {
  return { status: STATUS.notReady, detail: reasons.map((reason) => reason.text).join('; '), notSetUp: reasons.every((reason) => reason.notSetUp === true) };
}

/**
 * Read-only checks of one channel. Returns `{ status: 'ready' }` or `{ status: 'not ready', detail, notSetUp }`. A reason is a missing
 * owner setup only where the real service says so: the Open VSX namespace's 404. Everything else (an unreadable lookup, a missing CLI,
 * the placeholder publisher) is a plain reason. The IPM channel is never `not ready`: it is the owner's manual step, or already listed.
 */
async function dryStep(channel, detail, { dir, env, deps, repoRoot, version, cleanups }) {
  if (channel.id === 'mcp-registry') return registryDryStep(detail, { dir, env, deps, version, cleanups });
  if (channel.id === 'ipm') {
    const outcome = await ipmOutcome(deps, version);
    return outcome.status === STATUS.alreadyPublished
      ? { status: STATUS.ready, detail: STATUS.wouldBeAlreadyPublished }
      : { status: STATUS.ready, detail: ipmRehearsalDetail(outcome.detail), manual: true };
  }
  const reasons = vsixReadiness(detail, repoRoot, channel.id === 'vscode-marketplace' ? 'vsce' : 'ovsx').reasons.map((text) => ({ text }));
  // The store reads need a real publisher: the placeholder names nothing a store could answer for.
  let lookup;
  if (typeof detail.publisher === 'string' && detail.publisher !== PLACEHOLDER_PUBLISHER) {
    const item = `${detail.name}@${detail.version}`;
    if (channel.id === 'open-vsx') {
      const namespace = await openVsxNamespaceState(deps, detail.publisher);
      if (namespace.state !== 'present') reasons.push({ text: namespace.problem, notSetUp: namespace.state === 'absent' });
    }
    lookup = await storeLookup(deps, channel.id, detail, detail.version);
    if (lookup.outcome === 'unknown') reasons.push({ text: lookupProblem(channel.id, item, lookup.why) });
  }
  if (reasons.length > 0) return notReadyOutcome(reasons);
  if (lookup?.outcome === 'published') return { status: STATUS.ready, detail: STATUS.wouldBeAlreadyPublished };
  const wouldPublish = `${STATUS.wouldPublish} ${detail.name}@${detail.version}`;
  // DW-705: the Marketplace's `ready` checks the version only; say so, so it is never read as "the publisher exists".
  return { status: STATUS.ready, detail: channel.id === 'vscode-marketplace' ? `${wouldPublish}; ${marketplaceUncheckedNote(detail.publisher)}` : wouldPublish };
}

/** Ask the IPM registry whether it lists the version: `{ listed, body }`, or `{ error }`. A 404 means the package is not registered yet. */
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
    return { listed: ipmRegistryListsVersion(body, version), body };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * What the IPM channel is for a run: `already published` when the registry lists the version, otherwise a `manual step` whose `detail`
 * says what the owner does (a registry that cannot be read is the same step, with that said). The channel has no upload, so it never fails.
 */
async function ipmOutcome(deps, version) {
  const registry = await ipmRegistryState(deps, version);
  if (registry.error === undefined && registry.listed) return { status: STATUS.alreadyPublished };
  const reason = registry.error === undefined ? ipmNotListedReason(version) : ipmUnreadableReason(version, registry.error);
  return { status: STATUS.manualStep, detail: ipmManualStepText(version, reason), manual: true };
}

// -- the MCP Registry channel ----------------------------------------------------------------------------------

/** The sentence for a registry lookup that could not be judged: nothing is posted, because a publish cannot be told from a duplicate. */
const registryLookupProblem = (item, why) =>
  `could not ask the MCP Registry whether ${item} is published (${why}). Nothing was posted to the MCP Registry; check the network and the registry, then run the release again.`;

/** Ask the MCP Registry (read-only) about one server listing: `{ outcome: 'published' | 'absent' | 'unknown', why? }`. */
async function registryLookup(deps, server, version) {
  const answer = await readStatus(deps, registryLookupUrl(server.name, version), { Accept: 'application/json', 'User-Agent': 'iris-mcp-release' }, { json: true });
  if (answer.error !== undefined) return { outcome: 'unknown', why: answer.error };
  return registryOutcome(answer, { name: server.name, version });
}

/**
 * Download the pinned `mcp-publisher` (a linux tarball), refuse it unless its sha256 is the pin, and extract it into `work`. Returns
 * `{ bin }`, or `{ problem }` (never run an unverified binary).
 */
async function fetchPublisher(deps, work, env) {
  const publisher = deps.mcpPublisher ?? MCP_PUBLISHER;
  let bytes;
  try {
    const response = await deps.fetch(mcpPublisherUrl(publisher), { headers: { 'User-Agent': 'iris-mcp-release' }, signal: AbortSignal.timeout(120_000) });
    if (response.status !== 200) return { problem: `the download of mcp-publisher ${publisher.version} answered HTTP ${response.status}. Check the network, then run the release again.` };
    bytes = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return { problem: `the download of mcp-publisher ${publisher.version} failed (${error instanceof Error ? error.message : String(error)}). Check the network, then run the release again.` };
  }
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== publisher.sha256) {
    return { problem: `the mcp-publisher download has the sha256 ${digest}, not the pinned ${publisher.sha256}. It was not run; check the pin in scripts/lib/release-core.mjs against the release's asset digest.` };
  }
  const archive = path.join(work, publisher.asset);
  writeFileSync(archive, bytes);
  const binDir = path.join(work, 'bin');
  mkdirSync(binDir, { recursive: true });
  const extracted = await deps.run(['tar', '-xzf', archive, '-C', binDir], { cwd: work, env: childEnv(env) });
  const bin = path.join(binDir, 'mcp-publisher');
  if (extracted.status !== 0 || !existsSync(bin)) {
    return { problem: `mcp-publisher could not be extracted (${extracted.error?.message ?? `exit ${extracted.status}`}${existsSync(bin) ? '' : ', and no mcp-publisher file resulted'}). Check that tar is installed, then run the release again.` };
  }
  return { bin };
}

/** The dry step of the registry channel: the pinned publisher verifies, every listing validates, and every lookup can be judged. */
async function registryDryStep(detail, { dir, env, deps, version, cleanups }) {
  const servers = Array.isArray(detail?.servers) ? detail.servers : [];
  if (servers.length === 0) return { status: STATUS.notReady, detail: 'the manifest lists no server.json. Prepare the artifacts again.' };
  const reasons = [];
  const lookups = [];
  for (const server of servers) {
    const lookup = await registryLookup(deps, server, version);
    lookups.push(lookup.outcome);
    if (lookup.outcome === 'unknown') reasons.push(registryLookupProblem(`${server.name}@${version}`, lookup.why));
  }
  const work = mkdtempSync(path.join(tmpdir(), 'release-registry-dry-'));
  cleanups?.add(() => rmSync(work, { recursive: true, force: true }));
  try {
    const fetched = await fetchPublisher(deps, work, env);
    if (fetched.problem !== undefined) {
      reasons.push(fetched.problem);
    } else {
      const home = path.join(work, 'home');
      mkdirSync(home, { recursive: true });
      for (const server of servers) {
        const validated = await deps.run([fetched.bin, ...mcpPublisherArgv('validate', path.join(dir, server.file))], { cwd: work, env: childEnv(env, { HOME: home, USERPROFILE: home }) });
        if (validated.status !== 0) reasons.push(`mcp-publisher validate rejected ${server.file}: ${tail(validated.stdout || validated.stderr || validated.error?.message, 4)} Fix the listing, run pnpm gen:listings, then prepare again.`);
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (reasons.length > 0) return { status: STATUS.notReady, detail: reasons.join('; ') };
  if (lookups.every((outcome) => outcome === 'published')) return { status: STATUS.ready, detail: STATUS.wouldBeAlreadyPublished };
  const absent = lookups.filter((outcome) => outcome === 'absent').length;
  return { status: STATUS.ready, detail: `${STATUS.wouldPublish} ${absent === servers.length ? '' : `${absent} of `}${servers.length} servers` };
}

/** Whether npm serves `name@version`, asked until it does or until `NPM_VISIBLE_TIMEOUT_MS` has passed (the MCP Registry refuses a version npm does not serve). */
async function npmServes(deps, name, version) {
  const deadline = deps.now() + NPM_VISIBLE_TIMEOUT_MS;
  for (;;) {
    const answer = await readStatus(deps, npmVersionUrl(name, version), { Accept: 'application/json', 'User-Agent': 'iris-mcp-release' });
    if (answer.status === 200) return true;
    if (deps.now() >= deadline) return false;
    await deps.sleep(NPM_VISIBLE_POLL_MS);
  }
}

/**
 * The MCP Registry channel: ask the registry about every listing first (an answer that cannot be judged posts nothing), then, for each
 * absent one, wait for npm to serve the version, log in with the job's OIDC token (no secret) and `publish` the listing. The publisher
 * runs with a temporary HOME that is removed on every exit path, so its login token never outlives the step. A failed publish is judged
 * by a fresh lookup: a listing that is there now is `already published` (a race), one that is not is `failed`.
 */
async function publishMcpRegistry(detail, { dir, env, deps, cleanups, version, quote }) {
  const servers = Array.isArray(detail?.servers) ? detail.servers : [];
  if (servers.length === 0) return { status: STATUS.failed, detail: 'the manifest lists no server.json. Prepare the artifacts again.' };
  const itemOf = (server) => `${server.name}@${version}`;
  const lookups = new Map();
  for (const server of servers) {
    const lookup = await registryLookup(deps, server, version);
    if (lookup.outcome === 'unknown') return { status: STATUS.failed, detail: registryLookupProblem(itemOf(server), lookup.why) };
    lookups.set(server.name, lookup.outcome);
  }
  const pending = servers.filter((server) => lookups.get(server.name) === 'absent');
  if (pending.length === 0) {
    return { status: STATUS.alreadyPublished, items: servers.map((server) => ({ item: itemOf(server), status: STATUS.alreadyPublished })) };
  }
  const work = mkdtempSync(path.join(tmpdir(), 'release-registry-'));
  cleanups.add(() => rmSync(work, { recursive: true, force: true }));
  try {
    const fetched = await fetchPublisher(deps, work, env);
    if (fetched.problem !== undefined) return { status: STATUS.failed, detail: `${fetched.problem} Nothing was posted to the MCP Registry.` };
    for (const server of pending) {
      if (!(await npmServes(deps, server.package, version))) {
        return { status: STATUS.failed, detail: `npm does not serve ${server.package}@${version} after ${NPM_VISIBLE_TIMEOUT_MS / 60_000} minutes, and the MCP Registry refuses a version npm does not serve. Nothing was posted; run the release again once npm serves it.` };
      }
    }
    const home = path.join(work, 'home');
    mkdirSync(home, { recursive: true });
    const withHome = { HOME: home, USERPROFILE: home };
    const loggedIn = await deps.run([fetched.bin, ...mcpPublisherArgv('login')], { cwd: work, env: childEnv(env, { ...withHome, ...oidcEnv(env) }) });
    if (loggedIn.status !== 0) {
      return { status: STATUS.failed, detail: `mcp-publisher login github-oidc failed (exit ${loggedIn.status ?? 'none'}): ${quote(tail(loggedIn.stderr || loggedIn.error?.message || loggedIn.stdout, 4))}. Nothing was posted; check that the job has id-token: write, then run the release again.` };
    }
    const items = [];
    let stopped = false;
    for (const server of servers) {
      const item = itemOf(server);
      if (lookups.get(server.name) === 'published') {
        items.push({ item, status: STATUS.alreadyPublished });
        continue;
      }
      if (stopped) {
        items.push({ item, status: STATUS.notAttempted });
        continue;
      }
      const posted = await deps.run([fetched.bin, ...mcpPublisherArgv('publish', path.join(dir, server.file))], { cwd: work, env: childEnv(env, withHome) });
      if (posted.status === 0) {
        items.push({ item, status: STATUS.published, detail: 'auth: oidc' });
        continue;
      }
      const again = await registryLookup(deps, server, version);
      if (again.outcome === 'published') {
        items.push({ item, status: STATUS.alreadyPublished });
        continue;
      }
      stopped = true;
      items.push({ item, status: STATUS.failed, detail: quote(tail(posted.stderr || posted.error?.message || posted.stdout, 4)) });
    }
    const failed = items.some((entry) => entry.status === STATUS.failed);
    const published = items.some((entry) => entry.status === STATUS.published);
    return { status: failed ? STATUS.failed : published ? STATUS.published : STATUS.alreadyPublished, items };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** The outcome of a channel whose owner setup is missing (decision #121): skipped, never a failure, and listed at the end of the run. */
const notSetUp = (reason) => ({ status: STATUS.skipped, detail: notSetUpDetail(reason), notSetUp: true });

/** Run one enabled channel: its dry step in a rehearsal, its upload otherwise. */
async function runChannel(channel, detail, ctx) {
  const { dir, env, deps, repoRoot, dryRun, cleanups, version, quote } = ctx;
  if (detail === undefined) return { status: STATUS.failed, detail: `the manifest has no ${channel.id} entry. Prepare the artifacts again.` };
  if (dryRun) {
    const dry = await dryStep(channel, detail, ctx);
    if (dry.status === STATUS.ready) return { status: STATUS.ready, ...(dry.detail === undefined ? {} : { detail: dry.detail }), ...(dry.manual === true ? { manual: true } : {}) };
    return dry.notSetUp === true ? notSetUp(dry.detail) : { status: STATUS.notReady, detail: dry.detail };
  }
  if (channel.id === 'mcp-registry') return publishMcpRegistry(detail, { dir, env, deps, cleanups, version, quote });
  if (channel.id === 'ipm') return ipmOutcome(deps, version);
  const cliName = channel.id === 'vscode-marketplace' ? 'vsce' : 'ovsx';
  const { cli, reasons } = vsixReadiness(detail, repoRoot, cliName);
  if (reasons.length > 0) return { status: STATUS.failed, detail: reasons.join('; ') };
  const vsix = path.join(dir, detail.file);
  const item = `${detail.name}@${detail.version}`;
  if (channel.id === 'open-vsx') {
    const namespace = await openVsxNamespaceState(deps, detail.publisher);
    if (namespace.state === 'absent') return notSetUp(namespace.problem);
    if (namespace.state !== 'present') return { status: STATUS.failed, detail: `${namespace.problem} Nothing was uploaded to open-vsx.` };
  }
  const lookup = await storeLookup(deps, channel.id, detail, detail.version);
  if (lookup.outcome === 'published') return { status: STATUS.alreadyPublished };
  if (lookup.outcome === 'unknown') return { status: STATUS.failed, detail: lookupProblem(channel.id, item, lookup.why) };
  // Each CLI gets the job's OIDC variables; only ovsx gets the token, in its environment (never its argv).
  const useToken = channel.id === 'open-vsx' && typeof env.OVSX_PAT === 'string' && env.OVSX_PAT !== '';
  const argv = [cli, ...(channel.id === 'vscode-marketplace' ? vsceArgv(vsix) : ovsxArgv(vsix, { token: useToken }))];
  const uploaded = await deps.run(argv, { cwd: path.join(repoRoot, LAUNCHER_RELATIVE), env: childEnv(env, { ...oidcEnv(env), ...(useToken ? { OVSX_PAT: env.OVSX_PAT } : {}) }) });
  if (uploaded.status !== 0) {
    const said = tail(uploaded.stderr || uploaded.error?.message || uploaded.stdout, 4);
    // A CLI that ends silently (a non-zero exit with no output) still says how it ended.
    return { status: STATUS.failed, detail: quote(said === '' ? `${cliName} ended with no output (exit ${uploaded.status ?? 'none'})` : said) };
  }
  // `--skip-duplicate` exits 0 for an upload and for a skip alike: the CLI's own line tells them apart.
  if (skippedDuplicate(uploaded.stdout)) return { status: STATUS.alreadyPublished };
  return { status: STATUS.published, detail: channel.id === 'open-vsx' && useToken ? 'auth: token' : 'auth: oidc' };
}

// -- verify ----------------------------------------------------------------------------------------------------

/** The arguments of the `npx` start `verify` makes: the pinned major (`npx-pin.test.ts` finds any other spelling), and the one major it covers. */
const VERIFY_NPX_ARGS = Object.freeze(['-y', '@iris-mcp/dev@1']);
const VERIFY_MAJOR = '1';

/** The client name `verify` reports; it asks for the wire driver's own protocol revision (`WIRE_ERA`). */
const VERIFY_CLIENT = 'release-verify';

/** The environment of `verify`'s children: the caller's, with no secret, IRIS_*, MCP_* or npm_config_* variable and no npm auth token, and with an empty home and cache. */
function verifyEnv(env, home, cache) {
  const copy = childEnv(env);
  for (const key of Object.keys(copy)) {
    const upper = key.toUpperCase();
    if (upper.startsWith('IRIS_') || upper.startsWith('MCP_') || upper.startsWith('NPM_CONFIG_') || upper === 'NODE_AUTH_TOKEN') delete copy[key];
  }
  return { ...copy, npm_config_update_notifier: 'false', HOME: home, USERPROFILE: home, npm_config_cache: cache };
}

/**
 * Check the registry after a publish (read-only): every package of `NPM_PUBLISH_ORDER` is on it at `version` with a provenance
 * attestation, and `npx -y @iris-mcp/dev@1` starts in a clean temporary home, cache and working directory (against a closed local port)
 * and answers `initialize` with that version. Prints one line per check; 0 when all pass, 1 when any fails, 2 for a usage error.
 *
 * @param {{ version: string, env: Record<string, string | undefined> }} options
 * @param {ReturnType<typeof defaultDeps> & { cleanups?: ReturnType<typeof createCleanups> }} deps
 * @returns {Promise<number>}
 */
export async function verify(options, deps) {
  const summary = withSummary(deps, options.env, 'verify');
  let code = 1;
  try {
    code = await runVerify(options, summary.deps);
    return code;
  } finally {
    summary.finish(code);
  }
}

/** The first `count` of a list of problems, with how many more there are. */
const firstOf = (items, count) => (items.length > count ? `${items.slice(0, count).join(' ')} (and ${items.length - count} more)` : items.join(' '));

/**
 * The IPM check of `verify`: `{ line, problem?, settled }`. `line` always prints. The registry not listing `version`, or not being
 * readable, is `pending` and no problem (the owner's Release may come days after the tag). Once it lists the version, the module in the
 * archive it serves (the registry's re-tar of GitHub's archive of `main` at the Release press) must equal `git archive v<version>`:
 * the root `module.xml` and every `ipm/src` and `preload` file, byte for byte, with a `module.xml` at `<Version>` `version`. The rest of
 * the archive is `main` at the press and is not compared; it reads as the whole archive's equality only when it does match. A differing
 * module, an unreadable download and a missing local tag are problems.
 */
async function verifyIpm(version, { deps, repoRoot, work, env }) {
  const label = `${IPM_SOURCE_REPOSITORY} on IPM`;
  const tag = `v${version}`;
  const state = await ipmRegistryState(deps, version);
  if (state.error !== undefined) return { line: `${label}: pending (could not read the registry: ${state.error}). Run verify again once the owner has pressed Release.`, settled: false };
  if (!state.listed) return { line: `${label}: pending (the registry does not list ${version} yet: the owner presses Release on the Open Exchange listing)`, settled: false };
  const failed = (problem) => ({ line: `${label}: ${version} is listed`, problem: `${label}: ${problem}`, settled: true });

  const url = ipmArchiveUrl(state.body, version);
  if (url === undefined) return failed(`the registry lists ${version} but its answer gives no archive address for it. Check ${IPM_REGISTRY_PACKAGE_URL}, then run verify again.`);
  const exists = await deps.run(['git', 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: repoRoot, env, timeoutMs: 120_000 });
  if (exists.status !== 0) return failed(`the local tag ${tag} is missing, so the served archive cannot be compared. Fetch the tags (git fetch --tags), then run verify again.`);
  const tagArchive = path.join(work, 'tag.tgz');
  const archived = await deps.run(['git', 'archive', '--format=tar.gz', `--output=${tagArchive}`, tag], { cwd: repoRoot, env, timeoutMs: 600_000 });
  if (archived.status !== 0) return failed(`git archive ${tag} failed (${archived.error?.message ?? `exit ${archived.status}`}). Run it in a git checkout that holds the tag.`);

  let served;
  try {
    const response = await deps.fetch(url, { headers: { 'User-Agent': 'iris-mcp-release' }, signal: AbortSignal.timeout(300_000) });
    if (response.status !== 200) return failed(`the registry's archive ${url} answered HTTP ${response.status}. Run verify again.`);
    served = Buffer.from(await response.arrayBuffer());
  } catch (error) {
    return failed(`the registry's archive ${url} could not be downloaded (${error instanceof Error ? error.message : String(error)}). Run verify again.`);
  }
  let differences;
  let wholeEqual = false;
  try {
    const { readTgz, archiveEqualityProblems, moduleMemberEntries } = await deps.loadArchive();
    const servedEntries = readTgz(served);
    const tagEntries = readTgz(readFileSync(tagArchive));
    const labels = { actual: "the registry's archive", expected: `git archive ${tag}` };
    differences = archiveEqualityProblems(moduleMemberEntries(servedEntries), moduleMemberEntries(tagEntries), labels);
    wholeEqual = archiveEqualityProblems(servedEntries, tagEntries, labels).length === 0;
    const manifest = servedEntries.find((entry) => entry.type === 'file' && entry.name.replace(/^(?:\.\/)+/, '') === IPM_MANIFEST_RELATIVE);
    const stamped = manifest === undefined ? undefined : /<Version>([^<]+)<\/Version>/.exec(Buffer.from(manifest.data).toString('utf8'))?.[1]?.trim();
    if (stamped !== version) differences.push(`its ${IPM_MANIFEST_RELATIVE} is at ${JSON.stringify(stamped)}, not ${version}.`);
  } catch (error) {
    return failed(`the registry's archive could not be read (${error instanceof Error ? error.message : String(error)}). Run verify again.`);
  }
  if (differences.length > 0) {
    return failed(`the module in the archive the registry serves for ${version} is not ${tag}'s: ${firstOf(differences, 3)} Press Release before another version commit reaches main, or ask the registry to republish.`);
  }
  if (!wholeEqual) return { line: `${label}: ok, the IPM registry serves ${version} and its module equals the tag's (the rest of the archive is main when the owner pressed Release)`, settled: true };
  return { line: `${label}: ok, the IPM registry serves ${version} and its archive equals the tag's`, settled: true };
}

async function runVerify({ version, env, repoRoot = REPO_ROOT }, deps) {
  const say = (line) => deps.log(`verify: ${line}`);
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) {
    say(`--version must be MAJOR.MINOR.PATCH. ${USAGE}`);
    return 2;
  }
  if (version.split('.')[0] !== VERIFY_MAJOR) {
    say(`verify launches the @${VERIFY_MAJOR} major. Update its pinned spec with the next major.`);
    return 2;
  }
  const work = mkdtempSync(path.join(tmpdir(), 'release-verify-'));
  const remove = () => rmSync(work, { recursive: true, force: true });
  deps.cleanups?.add(remove);
  try {
    const [home, cache, cwd] = ['home', 'cache', 'cwd'].map((name) => path.join(work, name));
    for (const directory of [home, cache, cwd]) mkdirSync(directory);
    const childEnvironment = verifyEnv(env, home, cache);
    const problems = [];
    for (const name of NPM_PUBLISH_ORDER) {
      const viewed = await deps.run(['npm', ...npmViewJsonArgv(name, version)], { cwd, env: childEnvironment, timeoutMs: 120_000 });
      const found = registryProblems(name, version, viewed);
      for (const problem of found) say(problem);
      if (found.length === 0) say(`${name}@${version}: ok, published with a provenance attestation`);
      problems.push(...found);
    }

    // The MCP Registry lists each server at the version (read-only).
    for (const dir of SERVER_JSON_DIRS) {
      const server = { name: `io.github.jbrandtmse/${dir}` };
      const lookup = await registryLookup(deps, server, version);
      const problem =
        lookup.outcome === 'published'
          ? undefined
          : lookup.outcome === 'absent'
            ? `${server.name}@${version}: not listed on the MCP Registry. Publish the release, or run verify again once the registry has it.`
            : `${server.name}@${version}: the MCP Registry could not be read (${lookup.why}). Check the network, then run verify again.`;
      if (problem === undefined) say(`${server.name}@${version}: ok, listed on the MCP Registry`);
      else {
        say(problem);
        problems.push(problem);
      }
    }
    // The IPM registry lists the version only after the owner's Release: `pending` until then (never a failure), then the archive it serves must be the tag's.
    const ipm = await verifyIpm(version, { deps, repoRoot, work, env: childEnvironment });
    say(ipm.line);
    if (ipm.problem !== undefined) {
      say(ipm.problem);
      problems.push(ipm.problem);
    }

    const spec = `npx ${VERIFY_NPX_ARGS.join(' ')}`;
    let wire;
    try {
      const { openRawWire, handshake, CLOSED_PORT_ENV, WIRE_ERA } = await deps.loadWire();
      wire = openRawWire({ command: 'npx', args: [...VERIFY_NPX_ARGS], cwd, env: { ...childEnvironment, ...CLOSED_PORT_ENV }, timeoutMs: 240_000 });
      const initialized = await handshake(wire, WIRE_ERA, VERIFY_CLIENT);
      const served = initialized.message?.result?.serverInfo?.version;
      if (served === version) {
        say(`${spec}: ok, initialize answered serverInfo.version ${served}`);
      } else {
        const problem = `${spec}: initialize answered serverInfo.version ${JSON.stringify(served)}, not ${version}. Check that the published @${VERIFY_MAJOR} line is ${version}; once a later ${VERIFY_MAJOR}.x is published, @${VERIFY_MAJOR} serves that one.`;
        say(problem);
        problems.push(problem);
      }
    } catch (error) {
      const problem = `${spec}: failed to start and answer initialize (${(error instanceof Error ? error.message : String(error)).split('\n')[0]}). Publish the release, then run verify again.`;
      say(problem);
      problems.push(problem);
    } finally {
      try {
        await wire?.close();
      } catch {
        // the answer is already judged; a close that fails changes no verdict
      }
    }

    say(
      problems.length === 0
        ? `${NPM_PUBLISH_ORDER.length} packages at ${version} with provenance, ${SERVER_JSON_DIRS.length} servers on the MCP Registry, IPM ${ipm.settled ? 'serving the tag' : 'pending the owner'}, and ${spec} starts`
        : `${problems.length} check(s) failed`,
    );
    return problems.length === 0 ? 0 : 1;
  } finally {
    remove();
  }
}

// -- the command line ------------------------------------------------------------------------------------------

const USAGE =
  'usage: node scripts/release.mjs ci-gate [--timeout-minutes <n>]\n' +
  '       node scripts/release.mjs prepare --out <dir>\n' +
  '       node scripts/release.mjs publish --artifacts <dir> [--dry-run]\n' +
  '       node scripts/release.mjs verify --version <MAJOR.MINOR.PATCH>';

/**
 * Parse the command line into `{ command, options }`; a bad line throws a {@link Refusal} that holds the usage. One leading `--` is
 * dropped, because `pnpm release -- <command>` hands the script a literal `--` (pnpm 9.15).
 *
 * @param {readonly string[]} argv
 */
export function parseArgs(argv) {
  const [command, ...rest] = argv[0] === '--' ? argv.slice(1) : argv;
  const allowed = { 'ci-gate': ['--timeout-minutes'], prepare: ['--out'], publish: ['--artifacts'], verify: ['--version'] }[command];
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
  if (command === 'verify' && values['--version'] === undefined) throw new Refusal(`verify needs --version. ${USAGE}`);
  if (command === 'verify' && !/^\d+\.\d+\.\d+$/.test(values['--version'])) throw new Refusal(`--version must be MAJOR.MINOR.PATCH. ${USAGE}`);
  const options = {};
  if (command === 'ci-gate' && values['--timeout-minutes'] !== undefined) {
    const minutes = Number(values['--timeout-minutes']);
    if (!Number.isFinite(minutes) || minutes <= 0) throw new Refusal(`--timeout-minutes must be a positive number. ${USAGE}`);
    options.timeoutMinutes = minutes;
  }
  if (command === 'prepare') options.out = values['--out'];
  if (command === 'publish') Object.assign(options, { artifacts: values['--artifacts'], dryRun });
  if (command === 'verify') options.version = values['--version'];
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
  if (command === 'verify') return verify({ env, ...options }, deps);
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
