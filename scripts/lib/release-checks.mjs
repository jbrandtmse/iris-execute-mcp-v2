// The code-declared shape of `.github/workflows/release.yml` (Story 42.5; AD-29): the jobs, their permissions, environment and
// conditions, and their ordered steps, in one place that the self-test imports.
// `packages/iris-mcp-all/src/__tests__/release-workflow.test.ts` holds the workflow equal to this module in both directions, so a
// job cannot gain the environment, the OIDC permission or a secret, and a step cannot be added or dropped, without the declaration.
//
// CONTRACT
//   - RELEASE_JOBS is `{ <job>: { needs, permissions, environment?, if?, node, timeoutMinutes, steps } }` in workflow order. A step is
//     `{ uses, with? }` (an action, pinned by the PINNED_ACTIONS and ARTIFACT_ACTIONS of this module) or `{ run, env?, workingDirectory? }`.
//     A key that is absent from a declaration is absent from the workflow.
//   - Only `publish` has `environment`, only `publish` has `id-token: write`, and `secrets.` appears only in `publish`; `github.token`
//     appears only in `ci-gate` and `publish`, which both hold `actions: read` for the CI and environment reads.
//   - RELEASE_TRIGGERS are the workflow's triggers: a push of a `v*` tag or of a `release-dry-run/**` branch, and a manual dispatch.
//   - PINS: every action is pinned by a 40-hex commit with its release tag in the trailing comment. The three actions CI uses come from
//     `ci-checks.mjs`; the two artifact actions are pinned here.
//   Importing this module runs nothing and writes nothing.

import { NODE_LEGS, PINNED_ACTIONS, RUNNER } from './ci-checks.mjs';

export { PINNED_ACTIONS, RUNNER };

/** The artifact actions of the release (re-verified with a read-only `gh api repos/<action>/git/ref/tags/<tag>`, 2026-10-22). */
export const ARTIFACT_ACTIONS = Object.freeze([
  Object.freeze({ action: 'actions/upload-artifact', sha: 'cf430e030ddbb5b0abf93d22962f4752f3646cd9', tag: 'v7.0.2' }),
  Object.freeze({ action: 'actions/download-artifact', sha: '9000827ccba6bdab643e8b6fd33ac0654aef8333', tag: 'v8.0.2' }),
]);

/** Every action the release workflow may use. */
export const RELEASE_ALLOWED_ACTIONS = Object.freeze([...PINNED_ACTIONS, ...ARTIFACT_ACTIONS]);

/** The Node of the checks and of the upload: the floor runs `ci-gate` and `prepare`; 26.0.0 (npm 11.12.1, at least 11.5.1) runs the rest. */
export const RELEASE_NODE = Object.freeze({ floor: NODE_LEGS[0], upload: '26.0.0' });

/** The `timeout-minutes` of each job. */
export const RELEASE_JOB_TIMEOUT_MINUTES = Object.freeze({ 'ci-gate': 200, prepare: 90, rehearse: 20, publish: 30 });

/** The host port of the seeded throwaway that `prepare` reserves; it is the live port of the CI registry. */
export const RELEASE_HOST_PORT = '52791';

/** The artifacts' name and directory. */
export const ARTIFACT_NAME = 'release-artifacts';
export const ARTIFACT_DIRECTORY = '${{ runner.temp }}/release-artifacts';

/** The condition of the publish job: only the push of a release tag publishes. */
export const PUBLISH_CONDITION = "${{ github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') }}";

/** The workflow's triggers. */
export const RELEASE_TRIGGERS = Object.freeze({ push: { tags: ['v*'], branches: ['release-dry-run/**'] }, workflow_dispatch: {} });

/** The concurrency of the workflow: one run per ref, and a started release is never cancelled. */
export const RELEASE_CONCURRENCY = Object.freeze({ group: 'release-${{ github.ref }}', 'cancel-in-progress': false });

const checkout = Object.freeze({ uses: 'actions/checkout', with: Object.freeze({ 'persist-credentials': false }) });
const setupNode = (version, extra = {}) => Object.freeze({ uses: 'actions/setup-node', with: Object.freeze({ 'node-version': version, ...extra }) });
const download = Object.freeze({ uses: 'actions/download-artifact', with: Object.freeze({ name: ARTIFACT_NAME, path: ARTIFACT_DIRECTORY }) });

/** The jobs of the workflow, in order (see the header). */
export const RELEASE_JOBS = Object.freeze({
  'ci-gate': Object.freeze({
    needs: [],
    permissions: Object.freeze({ actions: 'read', contents: 'read' }),
    node: RELEASE_NODE.floor,
    timeoutMinutes: RELEASE_JOB_TIMEOUT_MINUTES['ci-gate'],
    steps: Object.freeze([
      checkout,
      setupNode(RELEASE_NODE.floor),
      Object.freeze({ run: 'node scripts/release.mjs ci-gate', env: Object.freeze({ GITHUB_TOKEN: '${{ github.token }}' }) }),
    ]),
  }),
  prepare: Object.freeze({
    needs: ['ci-gate'],
    permissions: Object.freeze({ contents: 'read' }),
    node: RELEASE_NODE.floor,
    timeoutMinutes: RELEASE_JOB_TIMEOUT_MINUTES.prepare,
    steps: Object.freeze([
      checkout,
      Object.freeze({ uses: 'pnpm/action-setup', with: Object.freeze({}) }),
      setupNode(RELEASE_NODE.floor, { cache: 'pnpm' }),
      Object.freeze({ run: 'pnpm install --frozen-lockfile' }),
      Object.freeze({ run: 'pnpm build' }),
      Object.freeze({ run: 'npm ci', workingDirectory: 'extensions/iris-mcp-launcher' }),
      Object.freeze({ run: `sudo sysctl -w net.ipv4.ip_local_reserved_ports=${RELEASE_HOST_PORT}` }),
      Object.freeze({ run: `node scripts/release.mjs prepare --out ${ARTIFACT_DIRECTORY}` }),
      Object.freeze({ uses: 'actions/upload-artifact', with: Object.freeze({ name: ARTIFACT_NAME, path: ARTIFACT_DIRECTORY, 'if-no-files-found': 'error' }) }),
    ]),
  }),
  rehearse: Object.freeze({
    needs: ['prepare'],
    permissions: Object.freeze({ contents: 'read' }),
    node: RELEASE_NODE.upload,
    timeoutMinutes: RELEASE_JOB_TIMEOUT_MINUTES.rehearse,
    steps: Object.freeze([
      checkout,
      setupNode(RELEASE_NODE.upload),
      download,
      Object.freeze({ run: `node scripts/release.mjs publish --dry-run --artifacts ${ARTIFACT_DIRECTORY}` }),
    ]),
  }),
  publish: Object.freeze({
    needs: ['ci-gate', 'prepare', 'rehearse'],
    permissions: Object.freeze({ actions: 'read', contents: 'read', 'id-token': 'write' }),
    environment: 'release',
    if: PUBLISH_CONDITION,
    node: RELEASE_NODE.upload,
    timeoutMinutes: RELEASE_JOB_TIMEOUT_MINUTES.publish,
    steps: Object.freeze([
      checkout,
      setupNode(RELEASE_NODE.upload),
      download,
      Object.freeze({
        run: `node scripts/release.mjs publish --artifacts ${ARTIFACT_DIRECTORY}`,
        env: Object.freeze({ NPM_TOKEN: '${{ secrets.NPM_TOKEN }}', GITHUB_TOKEN: '${{ github.token }}' }),
      }),
    ]),
  }),
});
