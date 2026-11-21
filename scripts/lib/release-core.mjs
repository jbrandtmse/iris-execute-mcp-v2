// The pure core of the release (Story 42.5; AD-29, AD-14): constants, decisions and builders. `scripts/release.mjs`,
// `scripts/release-version.mjs` and `scripts/lib/release-checks.mjs` import it, and the release tests pin every function against
// the rows of the story's I/O matrix.
//
// CONTRACT
//   - Importing this module runs nothing, reads nothing and imports only `node:` builtins, so `ci-gate`, `rehearse` and `publish`
//     (which run on a runner with no `node_modules`) can load it.
//   - It never spawns a process, reads the environment of the process or touches the file system. Every decision takes its facts as
//     arguments and returns data; every builder returns text or an argv array and never runs it.
//   - Error text has the form `<what happened>. <what to do>.`
//   - The only strings that form a publish verb are the argv builders `npmPublishArgv`, `vsceArgv`, `ovsxArgv` and `ipmPushPlan`
//     (the release-workflow test finds a publish verb anywhere else in the repository's workflows and package scripts).

import { isDeepStrictEqual } from 'node:util';

// -- constants ----------------------------------------------------------------------------------------------

/** The npm publish order: each package follows its `workspace:*` dependencies (the release-workflow test holds this to the manifests). */
export const NPM_PUBLISH_ORDER = Object.freeze([
  '@iris-mcp/client-config',
  '@iris-mcp/shared',
  '@iris-mcp/admin',
  '@iris-mcp/data',
  '@iris-mcp/dev',
  '@iris-mcp/interop',
  '@iris-mcp/ops',
  '@iris-mcp/all',
]);

/** The channels a release publishes to, in order. A channel that is not enabled prints `skipped: not enabled (<enabledBy>)`. */
export const RELEASE_CHANNELS = Object.freeze([
  Object.freeze({ id: 'npm', enabled: true }),
  Object.freeze({ id: 'vscode-marketplace', enabled: true }),
  Object.freeze({ id: 'open-vsx', enabled: true }),
  Object.freeze({ id: 'ipm', enabled: false, enabledBy: 'Story 42.8' }),
]);

/** The GitHub environment that holds the release's secrets, and the one tag rule that may deploy to it. */
export const RELEASE_ENVIRONMENT = 'release';
export const RELEASE_TAG_PATTERN = 'v*';

/** The packaging repository the IPM registry reads (decision #76), its branch, and the registry's listing of the package. */
export const IPM_DIST_REPOSITORY = 'jbrandtmse/iris-execute-mcp-v2-ipm';
export const IPM_DIST_BRANCH = 'master';
export const IPM_MODULE = 'iris-execute-mcp-v2';
export const IPM_REGISTRY_PACKAGE_URL = `https://pm.community.intersystems.com/packages/${IPM_MODULE}`;

/** The branch a release tag must be on (decision #82): there is no maintenance-branch allowance. */
export const RELEASE_BRANCH = 'main';

/** The root scripts that check the tree: a `check` or `validate` word in the name. The release's `prepare` selects by it, and `ci-workflow.test.ts` scans the root scripts with it against CI's gate list. */
export const ROOT_CHECK_SCRIPT = /(^|:)(check|validate)(:|$)/;

/** What `npm view` prints when the registry does not hold the package or the version. */
export const NPM_NOT_FOUND = /\bE404\b|404 Not Found|is not in this registry/i;

/** Root check scripts (see {@link ROOT_CHECK_SCRIPT}) that the release does not run, each with its reason. */
export const RELEASE_CHECK_EXEMPTIONS = Object.freeze({
  'format:check': 'not a CI gate (exempted by ROOT_SCRIPT_EXEMPTIONS in ci-workflow.test.ts)',
});

/** The lowest npm that publishes with trusted publishing (OIDC). */
export const MIN_NPM_VERSION = '11.5.1';

/** The workflow whose green run on the tagged commit the release waits for. */
export const CI_WORKFLOW_PATH = '.github/workflows/ci.yml';

/** The extension's placeholder publisher: a channel that still carries it is not ready. */
export const PLACEHOLDER_PUBLISHER = 'TBD-at-publish-time';

/** The extension's changelog, whose first `## [` heading must name the release version. */
export const EXTENSION_CHANGELOG_PATH = 'extensions/iris-mcp-launcher/CHANGELOG.md';

/** What a CLI prints (after its own prefix) when `--skip-duplicate` found the version already on the store. */
const SKIPPED_DUPLICATE_SUFFIX = 'is already published. Skipping publish.';

/** The statuses a release report uses. */
export const STATUS = Object.freeze({
  published: 'published',
  alreadyPublished: 'already published',
  failed: 'failed',
  notAttempted: 'not attempted',
  skipped: 'skipped',
  wouldPublish: 'would publish',
  wouldBeAlreadyPublished: 'would be already published',
  ready: 'ready',
  notReady: 'not ready',
});

const SEMVER = /^\d+\.\d+\.\d+$/;

// -- versions -------------------------------------------------------------------------------------------------

/** Compare two `MAJOR.MINOR.PATCH` versions (extra text after the patch number is ignored): -1, 0 or 1; `NaN` when either is not one. */
export function compareVersions(left, right) {
  const parse = (text) => /^(\d+)\.(\d+)\.(\d+)/.exec(String(text))?.slice(1, 4).map(Number);
  const a = parse(left);
  const b = parse(right);
  if (a === undefined || b === undefined) return Number.NaN;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

/** What is wrong with the version of npm that will upload: it must be at least {@link MIN_NPM_VERSION}. Empty text means it is fine. */
export function npmVersionProblems(npmVersion) {
  const text = String(npmVersion).trim();
  if (!/^\d+\.\d+\.\d+/.test(text)) {
    return [`npm reported the version ${JSON.stringify(text)}, which is not a version number. Run the release on a runner with npm ${MIN_NPM_VERSION} or later.`];
  }
  return compareVersions(text, MIN_NPM_VERSION) < 0
    ? [`npm ${text} is older than ${MIN_NPM_VERSION}, the first version that publishes with trusted publishing. Run the release on Node 26.0.0, which bundles npm 11.12.1.`]
    : [];
}

// -- the mode ---------------------------------------------------------------------------------------------------

/**
 * Whether the run is a release: only a `push` of the tag `refs/tags/v<MAJOR.MINOR.PATCH>` is. Any other event or ref is a dry run,
 * and a tag push whose name starts with `v` but is not that shape is reported as `malformedTag` (the CI gate refuses it).
 *
 * @param {Record<string, string | undefined>} env
 * @returns {{ mode: 'release' | 'dry-run', version?: string, tag?: string, ref: string, sha: string, event: string, malformedTag?: string }}
 */
export function releaseMode(env) {
  const event = env.GITHUB_EVENT_NAME ?? '';
  const ref = env.GITHUB_REF ?? '';
  const sha = env.GITHUB_SHA ?? '';
  const tag = event === 'push' && ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : undefined;
  const match = tag === undefined ? null : /^v(\d+\.\d+\.\d+)$/.exec(tag);
  if (match !== null) return { mode: 'release', version: match[1], tag, ref, sha, event };
  return { mode: 'dry-run', ref, sha, event, ...(tag !== undefined && tag.startsWith('v') ? { malformedTag: tag } : {}) };
}

/**
 * What is wrong with the version state of the repository. A release (`mode: 'release'`) needs every `@iris-mcp/*` package at the
 * tag's version; a dry run (`mode: 'dry-run'`) needs one shared version. Both need a plain `MAJOR.MINOR.PATCH` (no prerelease) and no
 * pending changeset.
 *
 * @param {{ versions: ReadonlyArray<{ name: string, version: string }>, pending: readonly string[], tagVersion?: string }} state
 * @param {'release' | 'dry-run'} mode
 * @returns {string[]}
 */
export function versionProblems(state, mode) {
  const problems = [];
  const versions = state.versions ?? [];
  if (versions.length === 0) problems.push('no @iris-mcp package was found. Run the release from the repository root.');
  for (const { name, version } of versions) {
    if (!SEMVER.test(String(version))) {
      problems.push(`${name} is at ${JSON.stringify(version)}, which is not a plain MAJOR.MINOR.PATCH version. Release no prerelease or build tag; run pnpm run version.`);
    }
  }
  if (mode === 'release') {
    if (typeof state.tagVersion !== 'string' || !SEMVER.test(state.tagVersion)) {
      problems.push(`the tag version ${JSON.stringify(state.tagVersion)} is not MAJOR.MINOR.PATCH. Tag the release as v<MAJOR.MINOR.PATCH>.`);
    } else {
      for (const { name, version } of versions) {
        if (version !== state.tagVersion) problems.push(`${name} is at ${version}, but the tag is v${state.tagVersion}. Run pnpm run version, commit the result, and tag that commit.`);
      }
    }
  } else {
    const shared = new Set(versions.map((entry) => entry.version));
    if (shared.size > 1) {
      const listed = versions.map((entry) => `${entry.name}@${entry.version}`).join(', ');
      problems.push(`the packages are not at one shared version (${listed}). Run pnpm run version so that the fixed group moves them together.`);
    }
  }
  const pending = state.pending ?? [];
  if (pending.length > 0) {
    problems.push(`${pending.length} changeset(s) are still pending in .changeset/ (${pending.join(', ')}). Run pnpm run version to consume them, and commit the result.`);
  }
  return problems;
}

/**
 * What is wrong with a packed manifest: it must carry the version the tarball is released at, hold no `workspace:` specifier, name every
 * `@iris-mcp/*` dependency at that dependency's released version (`dependencyVersions[name]`, else `version`: a release puts every
 * package at one version), and have the `exports` the source publishes (`publishConfig.exports` when the source has it, else `exports`).
 *
 * @param {Record<string, any>} manifest - The `package.json` inside the tarball.
 * @param {Record<string, any>} sourceManifest - The package's `package.json` in the repository.
 * @param {string} version
 * @param {Record<string, string>} [dependencyVersions]
 * @returns {string[]}
 */
export function tarballProblems(manifest, sourceManifest, version, dependencyVersions = {}) {
  const name = String(manifest?.name ?? sourceManifest?.name ?? '(unnamed package)');
  const problems = [];
  if (manifest?.version !== version) problems.push(`${name}: the tarball is at version ${JSON.stringify(manifest?.version)}, not ${version}. Pack it again after pnpm run version.`);
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dependency, specifier] of Object.entries(manifest?.[field] ?? {})) {
      if (String(specifier).startsWith('workspace:')) {
        problems.push(`${name}: the tarball still holds ${dependency}@${specifier} in ${field}. Pack with pnpm, which rewrites workspace: specifiers.`);
      } else if (dependency.startsWith('@iris-mcp/') && specifier !== (dependencyVersions[dependency] ?? version)) {
        problems.push(`${name}: the tarball depends on ${dependency}@${specifier}, not ${dependencyVersions[dependency] ?? version}. Pack it again after pnpm run version.`);
      }
    }
  }
  const expected = sourceManifest?.publishConfig?.exports ?? sourceManifest?.exports;
  if (!isDeepStrictEqual(manifest?.exports, expected)) {
    problems.push(`${name}: the tarball's exports are ${JSON.stringify(manifest?.exports)}, not the source's ${sourceManifest?.publishConfig?.exports === undefined ? 'exports' : 'publishConfig.exports'} ${JSON.stringify(expected)}. Pack with pnpm, which applies publishConfig.`);
  }
  return problems;
}

// -- the CI gate ------------------------------------------------------------------------------------------------

/** Whether a workflow run's `path` is the workflow file (GitHub may append `@<ref>` to the path of a pull-request run). */
const isWorkflowRun = (run, workflowPath) => typeof run?.path === 'string' && (run.path === workflowPath || run.path.startsWith(`${workflowPath}@`));

/** The events whose run built the commit itself. A pull-request run has the pull request's head as `head_sha` but builds its merge ref. */
const COMMIT_EVENTS = Object.freeze(['push', 'workflow_dispatch']);

/**
 * What to do about the CI runs on a commit: `pass` when one `ci.yml` run on `sha`, started by a `push` or a `workflow_dispatch`,
 * completed with `success`; `red` when there are such runs, every one completed and none succeeded; otherwise `pending` (no such run
 * yet, or a run still going). A run of any other event, a pull request's above all, never counts.
 *
 * @param {ReadonlyArray<Record<string, any>>} runs - The `workflow_runs` of the GitHub API.
 * @param {string} sha
 * @param {string} [workflowPath]
 * @returns {{ decision: 'pass', run: Record<string, any> } | { decision: 'red' | 'pending', runs: Array<Record<string, any>> }}
 */
export function ciGateDecision(runs, sha, workflowPath = CI_WORKFLOW_PATH) {
  const mine = (runs ?? []).filter((run) => run?.head_sha === sha && COMMIT_EVENTS.includes(run?.event) && isWorkflowRun(run, workflowPath));
  const green = mine.find((run) => run.status === 'completed' && run.conclusion === 'success');
  if (green !== undefined) return { decision: 'pass', run: green };
  if (mine.length > 0 && mine.every((run) => run.status === 'completed')) return { decision: 'red', runs: mine };
  return { decision: 'pending', runs: mine };
}

/** One line per run for a report: its URL and its status or conclusion. */
export function describeRuns(runs) {
  return runs.map((run) => `${run.html_url ?? `run ${run.id}`}: ${run.status === 'completed' ? run.conclusion : run.status}`);
}

// -- main reachability ------------------------------------------------------------------------------------------

/** The GitHub compare statuses of `main...<sha>` that mean the commit is main itself or one of its ancestors. */
const ON_MAIN_STATUSES = Object.freeze(['identical', 'behind']);

/** The compare statuses that mean the commit has something `main` does not contain. */
const OFF_MAIN_STATUSES = Object.freeze(['ahead', 'diverged']);

/** The GitHub API URL that compares `main` with a commit (one commit per page: only the status is read). */
export function compareUrl(api, repo, sha) {
  return `${api}/repos/${repo}/compare/${RELEASE_BRANCH}...${sha}?per_page=1`;
}

/**
 * Whether a commit is on `main`, from the answer of {@link compareUrl}: `identical` and `behind` mean the commit is main or an ancestor
 * of it, `ahead` and `diverged` mean it is not, and anything else (a non-2xx answer, an error, a body without a known status) is
 * unreadable. Only `on-main` lets a tag run go on.
 *
 * @param {{ status: number, body?: any } | { error: string }} answer - What `githubGet` returned.
 * @param {string} sha
 * @returns {{ state: 'on-main' | 'off-main' | 'unreadable', status?: string, line: string, problem?: string }}
 */
export function mainReachability(answer, sha) {
  const unreadable = (why) => ({
    state: 'unreadable',
    line: `commit ${sha}: unreadable (${why})`,
    problem: `whether ${sha} is on ${RELEASE_BRANCH} could not be read (${why}). Check that the token may read the repository and that the commit was pushed, then run the release again.`,
  });
  if (typeof answer?.error === 'string') return unreadable(answer.error);
  if (typeof answer?.status !== 'number' || answer.status < 200 || answer.status >= 300) return unreadable(`HTTP ${answer?.status}`);
  const status = answer.body?.status;
  if (ON_MAIN_STATUSES.includes(status)) return { state: 'on-main', status, line: `commit ${sha} is on ${RELEASE_BRANCH} (compare: ${status})` };
  if (OFF_MAIN_STATUSES.includes(status)) {
    return {
      state: 'off-main',
      status,
      line: `commit ${sha} is not on ${RELEASE_BRANCH} (compare: ${status})`,
      problem: `${sha} is not on ${RELEASE_BRANCH} (compare ${RELEASE_BRANCH}...${sha}: ${status}). Merge it to ${RELEASE_BRANCH}, then tag the merged commit.`,
    };
  }
  return unreadable(`the answer holds no known status: ${JSON.stringify(status)}`);
}

// -- the environment guard --------------------------------------------------------------------------------------

/** The names of the required reviewers of an environment (a user's login or a team's slug). */
function reviewersOf(environment) {
  const rules = Array.isArray(environment?.protection_rules) ? environment.protection_rules : [];
  return rules
    .filter((rule) => rule?.type === 'required_reviewers')
    .flatMap((rule) => (Array.isArray(rule.reviewers) ? rule.reviewers : []))
    .map((entry) => entry?.reviewer?.login ?? entry?.reviewer?.slug ?? entry?.reviewer?.name)
    .filter((name) => typeof name === 'string');
}

/** The deployment rules of an environment, as `type:name` texts. */
function policyNames(policies) {
  const list = Array.isArray(policies?.branch_policies) ? policies.branch_policies : [];
  return list.map((policy) => `${policy?.type ?? 'branch'}:${policy?.name}`);
}

/**
 * What is wrong with the `release` environment: protected means at least one required reviewer, administrators cannot bypass, and the
 * deployment rules are exactly one tag rule `v*`.
 *
 * @param {Record<string, any> | undefined} environment - The body of `GET /repos/{o}/{r}/environments/release`.
 * @param {Record<string, any> | undefined} policies - The body of `GET .../environments/release/deployment-branch-policies`.
 * @returns {string[]}
 */
export function environmentProblems(environment, policies) {
  const problems = [];
  if (reviewersOf(environment).length === 0) {
    problems.push(`the ${RELEASE_ENVIRONMENT} environment has no required reviewer. Add one under Settings, Environments, ${RELEASE_ENVIRONMENT}.`);
  }
  if (environment?.can_admins_bypass !== false) {
    problems.push(`administrators can bypass the ${RELEASE_ENVIRONMENT} environment's protection. Turn off "Allow administrators to bypass configured protection rules".`);
  }
  const exact = isDeepStrictEqual(policyNames(policies), [`tag:${RELEASE_TAG_PATTERN}`]);
  if (environment?.deployment_branch_policy?.custom_branch_policies !== true || !exact) {
    const have = policyNames(policies);
    problems.push(
      `the deployment rules of the ${RELEASE_ENVIRONMENT} environment are ${have.length === 0 ? 'not restricted to selected rules' : have.join(', ')}, not exactly one tag rule ${RELEASE_TAG_PATTERN}. Select "Selected branches and tags" and add only the tag rule ${RELEASE_TAG_PATTERN}.`,
    );
  }
  return problems;
}

/** The warnings about a protected environment: "Prevent self-review" makes a solo maintainer's release unapprovable. */
export function environmentWarnings(environment) {
  const rules = Array.isArray(environment?.protection_rules) ? environment.protection_rules : [];
  return rules.some((rule) => rule?.type === 'required_reviewers' && rule.prevent_self_review === true)
    ? [`the ${RELEASE_ENVIRONMENT} environment prevents self-review, so a release by its only reviewer cannot be approved. Turn off "Prevent self-review" for a solo maintainer.`]
    : [];
}

/** The one-line summary of a protected environment. */
export function environmentSummary(environment, policies) {
  return `protected (required reviewers: ${reviewersOf(environment).join(', ')}; admin bypass ${environment?.can_admins_bypass === false ? 'off' : 'on'}; tags ${policyNames(policies).map((name) => name.replace(/^tag:/, '')).join(', ')})`;
}

// -- the publish refusals ---------------------------------------------------------------------------------------

/**
 * Why a real publish must be refused before any upload: it runs only for a `push` of the tag `v<manifest.version>`, on the sha (a
 * 40-hex commit) the manifest was prepared from, from a manifest prepared in release mode.
 *
 * @param {Record<string, string | undefined>} env
 * @param {{ version?: string, sha?: string, mode?: string }} manifest
 * @returns {string[]}
 */
export function publishRefusals(env, manifest) {
  const refusals = [];
  const event = env.GITHUB_EVENT_NAME ?? '';
  const ref = env.GITHUB_REF ?? '';
  if (event !== 'push') refusals.push(`the event is ${JSON.stringify(event)}, not push. Publish only from the push of a release tag.`);
  if (ref !== `refs/tags/v${manifest?.version}`) refusals.push(`the ref is ${JSON.stringify(ref)}, not refs/tags/v${manifest?.version}. Publish only from the tag of the prepared version.`);
  if (typeof manifest?.sha !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.sha)) {
    refusals.push(`the artifacts name the commit ${JSON.stringify(manifest?.sha)}, which is not a 40-hex commit sha. Prepare them again from the tag push.`);
  } else if ((env.GITHUB_SHA ?? '') !== manifest.sha) {
    refusals.push(`GITHUB_SHA is ${JSON.stringify(env.GITHUB_SHA ?? '')}, but the artifacts were prepared from ${JSON.stringify(manifest.sha)}. Prepare and publish the same commit.`);
  }
  if (manifest?.mode !== 'release') refusals.push(`the artifacts were prepared in ${JSON.stringify(manifest?.mode)} mode, not release. Prepare them from the tag push.`);
  return refusals;
}

// -- builders ---------------------------------------------------------------------------------------------------

/**
 * The `npm` arguments that upload one tarball: access public, provenance, no lifecycle script. `--dry-run` rehearses it; `userconfig`
 * names a file that holds the auth token (without it npm uses OIDC, which is trusted publishing).
 *
 * @param {string} tarball
 * @param {{ dryRun?: boolean, userconfig?: string }} [options]
 * @returns {string[]}
 */
export function npmPublishArgv(tarball, { dryRun = false, userconfig } = {}) {
  return [
    'publish',
    tarball,
    '--access',
    'public',
    '--provenance',
    '--ignore-scripts',
    ...(dryRun ? ['--dry-run'] : []),
    ...(userconfig === undefined ? [] : ['--userconfig', userconfig]),
  ];
}

/** The `npm` arguments that ask the registry for the version of a package: it prints the version when it is published. */
export function npmViewArgv(name, version) {
  return ['view', `${name}@${version}`, 'version'];
}

/** The `npm` arguments that read the version and the provenance attestation of one published package as JSON. */
export function npmViewJsonArgv(name, version) {
  return ['view', `${name}@${version}`, 'version', 'dist.attestations', '--json'];
}

/**
 * What is wrong with the registry's answer for `name@version` (the result of `npm view ... --json`): the version must be there, at that
 * version, with a provenance attestation. Empty means published with provenance.
 *
 * @param {string} name
 * @param {string} version
 * @param {{ status: number | null, stdout: string, stderr?: string, error?: Error }} viewed
 * @returns {string[]}
 */
export function registryProblems(name, version, viewed) {
  const item = `${name}@${version}`;
  if (viewed.status !== 0) {
    if (NPM_NOT_FOUND.test(`${viewed.stderr ?? ''}\n${viewed.stdout ?? ''}`)) {
      return [`${item}: not on the registry. Publish the release, or run verify again once the registry has propagated it.`];
    }
    return [`${item}: npm view failed (${viewed.error?.message ?? `exit ${viewed.status}`}). Check the network and the registry, then run verify again.`];
  }
  let answer;
  try {
    answer = JSON.parse(viewed.stdout);
  } catch {
    return [`${item}: npm view answered text that is not JSON. Run verify again, and check npm's version.`];
  }
  // With no attestation npm prints the bare version string; with one it prints an object that holds both fields.
  const found = typeof answer === 'string' ? answer : answer?.version;
  if (found !== version) return [`${item}: the registry answered the version ${JSON.stringify(found)}, not ${version}. Run verify again.`];
  const predicate = typeof answer === 'object' && answer !== null ? answer['dist.attestations']?.provenance?.predicateType : undefined;
  if (typeof predicate !== 'string' || !predicate.startsWith('https://slsa.dev/provenance/')) {
    return [`${item}: published without a provenance attestation. Publish through the release workflow, which signs with provenance.`];
  }
  return [];
}

/** The text of the 0600 userconfig that carries the npm token. A token with a control character could add a line, so it is refused. */
export function npmUserconfig(token) {
  const text = String(token);
  if (text === '' || /[\u0000-\u001f\u007f\s]/.test(text)) {
    throw new Error('NPM_TOKEN holds whitespace or a control character. Set it to the token alone.');
  }
  return `//registry.npmjs.org/:_authToken=${text}\n`;
}

/** The `vsce` arguments that publish a prebuilt vsix with trusted publishing (OIDC) and tolerate a version that is already there. */
export function vsceArgv(vsix) {
  return ['publish', '--packagePath', vsix, '--skip-duplicate', '--oidc'];
}

/**
 * The `ovsx` arguments that publish a prebuilt vsix and tolerate a version that is already there. With a token (`OVSX_PAT`, which `ovsx`
 * reads from its environment, never from argv) the token authenticates; without one the publish asks for trusted publishing.
 *
 * @param {string} vsix
 * @param {{ token?: boolean }} [options]
 */
export function ovsxArgv(vsix, { token = false } = {}) {
  return ['publish', vsix, '--skip-duplicate', ...(token ? [] : ['--trusted-publishing'])];
}

/** The Open VSX URL of a namespace: 200 when it exists, 404 when it does not. */
export function openVsxNamespaceUrl(publisher) {
  return `https://open-vsx.org/api/${encodeURIComponent(publisher)}`;
}

/**
 * The read-only URL that tells whether a store holds `publisher.name@version`. Open VSX answers its metadata (200, or 404). The Marketplace
 * answers the vsix itself, so the request asks for one byte ({@link storeLookupHeaders}); its HEAD answers 405.
 *
 * @param {'vscode-marketplace' | 'open-vsx'} store
 * @param {string} publisher
 * @param {string} name
 * @param {string} version
 */
export function storeLookupUrl(store, publisher, name, version) {
  const part = (text) => encodeURIComponent(text);
  if (store === 'open-vsx') return `https://open-vsx.org/api/${part(publisher)}/${part(name)}/${part(version)}`;
  if (store === 'vscode-marketplace') {
    return `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${part(publisher)}/vsextensions/${part(name)}/${part(version)}/vspackage`;
  }
  throw new Error(`${JSON.stringify(store)} is not an extension store. Use vscode-marketplace or open-vsx.`);
}

/** The request headers of a store lookup. */
export function storeLookupHeaders(store) {
  return store === 'vscode-marketplace' ? { Range: 'bytes=0-0', 'User-Agent': 'iris-mcp-release' } : { Accept: 'application/json', 'User-Agent': 'iris-mcp-release' };
}

/**
 * What a store's answer to {@link storeLookupUrl} means. `published` needs the store's own evidence: the Marketplace answers 200 (or 206,
 * the one-byte read) with the vsix itself (content type `application/vsix`), and Open VSX answers 200 with JSON whose `namespace`, `name`
 * and `version` are the ones asked for. A 404 is `absent` (the release then uploads, and the CLI asks the store again). Anything else is
 * `unknown`, which stops the release: another status, no status (the request failed or stalled), or a 200 that is not the store's answer
 * (a proxy or captive-portal page), because reading that as `published` would skip the upload and exit 0.
 *
 * @param {'vscode-marketplace' | 'open-vsx'} store
 * @param {{ status?: number, contentType?: string | null, body?: unknown }} answer `body` is the parsed JSON of an Open VSX 200, if it parsed
 * @param {{ publisher: string, name: string, version: string }} expected
 * @returns {{ outcome: 'published' | 'absent' | 'unknown', why?: string }}
 */
export function storeOutcome(store, answer, expected) {
  const { status } = answer;
  if (status === 404) return { outcome: 'absent' };
  // Only the Marketplace is asked for a range (one byte), so only its answer may be a 206.
  const found = status === 200 || (status === 206 && store === 'vscode-marketplace');
  if (!found) return { outcome: 'unknown', why: status === undefined ? 'no answer' : `HTTP ${status}` };
  const type = String(answer.contentType ?? '').trim();
  const notTheStore = (what) => ({ outcome: 'unknown', why: `HTTP ${status}, but ${what}, so it is not the store's answer` });
  if (store === 'vscode-marketplace') {
    return /^application\/vsix\s*(?:;|$)/i.test(type) ? { outcome: 'published' } : notTheStore(`the content type is ${type === '' ? 'missing' : type}, not application/vsix`);
  }
  if (!/^application\/json\s*(?:;|$)/i.test(type)) return notTheStore(`the answer is ${type === '' ? 'untyped' : type}, not JSON`);
  const body = /** @type {Record<string, unknown> | null | undefined} */ (answer.body);
  const named = body !== null && typeof body === 'object' && body.namespace === expected.publisher && body.name === expected.name && body.version === expected.version;
  return named ? { outcome: 'published' } : notTheStore(`its JSON does not name ${expected.publisher}.${expected.name}@${expected.version}`);
}

/** Whether a store CLI's output has a line that says `--skip-duplicate` found the version already published (an exit 0 that uploaded nothing). */
export function skippedDuplicate(stdout) {
  return String(stdout)
    .split('\n')
    .some((line) => line.trimEnd().endsWith(SKIPPED_DUPLICATE_SUFFIX));
}

/**
 * What is wrong with the extension's changelog for a release: its first `## [` heading must name `version`.
 *
 * @param {string} text
 * @param {string} version
 * @returns {string[]}
 */
export function extensionChangelogProblems(text, version) {
  const heading = /^## \[[^\n]*$/m.exec(String(text))?.[0].trimEnd();
  if (heading === undefined) {
    return [`${EXTENSION_CHANGELOG_PATH} has no \`## [\` heading. Add a section headed \`## [${version}]\`, which pnpm run version writes.`];
  }
  const named = /^## \[([^\]]*)\]/.exec(heading)?.[1];
  if (named === version) return [];
  return [`the first heading of ${EXTENSION_CHANGELOG_PATH} is \`${heading}\`, not \`## [${version}]\`. Run pnpm run version, which renames the \`## [Unreleased]\` heading, and commit the result.`];
}

/** The git identity of the commit the IPM channel makes. */
const GIT_IDENTITY = Object.freeze(['-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com']);

/**
 * The git steps that put the staged IPM tree on the packaging repository's `master` and tag it, with no force, in one atomic push.
 * `tree` is the staged directory; `clone` is the working copy the steps run in. An existing tag whose tree equals the staged one is
 * "already published". `lsRemoteArgv` reads the repository's `HEAD` and its symref, whose answer {@link ipmDefaultBranch} reads.
 *
 * @param {string} tree
 * @param {string} version
 * @param {string} sha
 * @param {{ url: string, clone: string }} target
 */
export function ipmPushPlan(tree, version, sha, { url, clone }) {
  const tag = `v${version}`;
  return {
    tree,
    clone,
    tag,
    branch: IPM_DIST_BRANCH,
    message: `${IPM_MODULE} ${version} from ${sha}`,
    cloneArgv: ['clone', '--quiet', url, clone],
    checkoutArgv: ['checkout', '--quiet', '-B', IPM_DIST_BRANCH],
    addArgv: ['add', '--all'],
    writeTreeArgv: ['write-tree'],
    tagTreeArgv: ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{tree}`],
    commitArgv: [...GIT_IDENTITY, 'commit', '--quiet', '-m', `${IPM_MODULE} ${version} from ${sha}`],
    tagArgv: [...GIT_IDENTITY, 'tag', '-a', tag, '-m', `${IPM_MODULE} ${version} from ${sha}`],
    pushArgv: ['push', '--atomic', 'origin', `HEAD:refs/heads/${IPM_DIST_BRANCH}`, `refs/tags/${tag}`],
    lsRemoteArgv: ['ls-remote', '--symref', url, 'HEAD'],
  };
}

/**
 * The default branch that the answer of `git ls-remote --symref <url> HEAD` names: the `<b>` of its `ref: refs/heads/<b>\tHEAD` line,
 * or `undefined` for an empty answer (an empty repository, which has no default branch yet).
 *
 * @param {string} stdout
 * @returns {string | undefined}
 */
export function ipmDefaultBranch(stdout) {
  return /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(String(stdout))?.[1];
}

/** Whether the registry's answer for the package lists `version` (`versions` holds every published version, `version` the newest). */
export function ipmRegistryListsVersion(body, version) {
  if (body === null || typeof body !== 'object') return false;
  return body.version === version || (Array.isArray(body.versions) && body.versions.includes(version));
}

/** The README of the packaging repository: what it is, where the source is, and how to install. It claims no endorsement (AD-28). */
export function ipmReadme(version) {
  return [
    `# ${IPM_MODULE}`,
    '',
    `Version ${version}. This repository is generated by the release workflow of the IRIS MCP Server Suite and holds the IPM package of the`,
    'server-side `ExecuteMCPv2` classes. Do not edit it by hand: the next release replaces its contents.',
    '',
    '- Source, issues and documentation: https://github.com/jbrandtmse/iris-execute-mcp-v2',
    '- Install, in the namespace that should host the REST service, with IPM 0.10 or later:',
    '',
    '```',
    `zpm "install ${IPM_MODULE}"`,
    '```',
    '',
    'This is an independent community project. It is not made, endorsed or supported by InterSystems.',
    '',
  ].join('\n');
}

/**
 * The text of a release report: one block per channel, one line per package or artifact with its status.
 *
 * @param {ReadonlyArray<{ channel: string, item: string, status: string, detail?: string }>} results
 * @returns {string}
 */
export function releaseReport(results) {
  const lines = ['Release report'];
  const channels = [...new Set(results.map((result) => result.channel))];
  for (const channel of channels) {
    lines.push(channel);
    for (const result of results.filter((entry) => entry.channel === channel)) {
      lines.push(`  ${result.item}: ${result.status}${result.detail === undefined || result.detail === '' ? '' : ` (${result.detail})`}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/** The text a disabled channel prints. */
export function skippedText(channel) {
  return `${STATUS.skipped}: not enabled (${channel.enabledBy})`;
}
