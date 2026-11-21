/**
 * Story 42.5 (AC 42.5.1, 42.5.2, 42.5.4; AD-29, DW-387) -- the self-test that holds `.github/workflows/release.yml` equal to the
 * code-declared shape `scripts/lib/release-checks.mjs`, in both directions.
 *
 * `release-workflow-check.ts` holds the checks as one pure function over the workflow text. Here it runs over the real file, which must
 * have no problem, and over a mutation of the file for each defect the acceptance criteria name, which must each have one: a check that
 * no mutation can fail would be a green badge over a dead check (Rule #59). Every mutation first asserts that the text it replaces is in
 * the file, so a mutation cannot silently change nothing.
 *
 * The rest pins what the workflow cannot show on its own: the workflows directory holds exactly `ci.yml` and `release.yml`, only the
 * release workflow reads a secret, no `package.json` script holds a publish verb, only `release-core.mjs` forms a publish argv, the npm
 * publish order follows the `workspace:*` dependencies, and the channels are npm, then the Marketplace, Open VSX and IPM.
 *
 * Reads documents and calls pure functions: no docker, no IRIS, no network.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { parse } from "yaml";
import { PINNED_ACTIONS } from "../../../../scripts/lib/ci-checks.mjs";
import { publishablePackages } from "../../../../scripts/lib/ci-checks.mjs";
import {
  ARTIFACT_ACTIONS,
  PUBLISH_CONDITION,
  RELEASE_JOBS,
  RELEASE_NODE,
  RELEASE_TRIGGERS,
} from "../../../../scripts/lib/release-checks.mjs";
import { NPM_PUBLISH_ORDER, RELEASE_CHANNELS, npmVersionProblems } from "../../../../scripts/lib/release-core.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { parseArgs } from "../../../../scripts/release.mjs";
import { stripComments } from "../../../../scripts/lib/script-ts-import-scan.mjs";
import { RAW_VERB, releaseWorkflowProblems } from "./release-workflow-check";

const WORKFLOWS = path.join(REPO_ROOT, ".github", "workflows");
const text = readFileSync(path.join(WORKFLOWS, "release.yml"), "utf8");
const workflow = parse(text) as { on: Record<string, unknown>; permissions: unknown; jobs: Record<string, Record<string, any>> };

/** `text` with every occurrence of `from` replaced; a `from` that is not in the text is a mistake of the test. */
function mutate(source: string, from: string, to: string): string {
  const parts = source.split(from);
  if (parts.length < 2) throw new Error(`the mutation target is not in release.yml: ${from}`);
  return parts.join(to);
}

const CHECKOUT = "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0";
const DRY_RUN = "        run: node scripts/release.mjs publish --dry-run --artifacts ${{ runner.temp }}/release-artifacts\n";
/** The step that installs the store CLIs, which rehearse and publish both have. */
const INSTALL_STORE_CLIS = "      - name: install the store CLIs\n        run: npm ci --ignore-scripts\n        working-directory: extensions/iris-mcp-launcher\n";
const BARE_PUBLISH = "        run: node scripts/release.mjs publish --artifacts ${{ runner.temp }}/release-artifacts\n        env:\n";
const PUBLISH_IF = "    if: ${{ github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') }}\n";
const REHEARSE_HEAD = "    needs: [prepare]\n    runs-on: ubuntu-24.04\n    timeout-minutes: 20\n    permissions:\n      contents: read\n";
const RUN_NAME = "run-name: release ${{ github.ref_name }} ${{ github.sha }}\n";
const OUTSIDE_THE_JOBS = /the workflow level \(outside the jobs\) names a secret, github\.token or id-token/;

describe("AC 42.5.1: release.yml is the declaration", () => {
  it("the real release.yml has no problem", () => {
    expect(releaseWorkflowProblems(text)).toEqual([]);
  });

  it("runs the four jobs in order, on a v* tag, a release-dry-run/** branch and a manual dispatch, and on nothing else", () => {
    expect(Object.keys(workflow.jobs)).toEqual(["ci-gate", "prepare", "rehearse", "publish"]);
    expect(Object.keys(RELEASE_JOBS)).toEqual(["ci-gate", "prepare", "rehearse", "publish"]);
    expect(Object.keys(workflow.on).sort()).toEqual(["push", "workflow_dispatch"]);
    expect(workflow.on["push"]).toEqual({ tags: ["v*"], branches: ["release-dry-run/**"] });
    expect(workflow.on["push"]).toEqual(RELEASE_TRIGGERS.push);
    expect(workflow.permissions).toEqual({});
  });

  it("publish alone holds the environment, the OIDC permission and the secret, needs all three jobs, and runs only on a tag push", () => {
    const owners = (predicate: (job: Record<string, any>) => boolean): string[] => Object.entries(workflow.jobs).filter(([, job]) => predicate(job)).map(([name]) => name);
    expect(owners((job) => job["environment"] !== undefined)).toEqual(["publish"]);
    expect(owners((job) => job["permissions"]?.["id-token"] === "write")).toEqual(["publish"]);
    expect(owners((job) => JSON.stringify(job).includes("secrets."))).toEqual(["publish"]);
    expect(owners((job) => JSON.stringify(job).includes("github.token"))).toEqual(["ci-gate", "publish"]);
    expect(workflow.jobs["publish"]?.["environment"]).toBe("release");
    const publishSteps = workflow.jobs["publish"]?.["steps"] as Array<{ run?: string; env?: Record<string, string> }>;
    const publishEnv = publishSteps.find((step) => String(step.run ?? "").startsWith("node scripts/release.mjs publish"))?.env;
    expect(publishEnv, "the publish step holds each secret a channel reads, and nothing else (IPM has no upload, so no key)").toEqual({
      NPM_TOKEN: "${{ secrets.NPM_TOKEN }}",
      OVSX_PAT: "${{ secrets.OVSX_PAT }}",
      GITHUB_TOKEN: "${{ github.token }}",
    });
    expect([...(workflow.jobs["publish"]?.["needs"] as string[])].sort()).toEqual(["ci-gate", "prepare", "rehearse"]);
    expect(workflow.jobs["publish"]?.["if"]).toBe(PUBLISH_CONDITION);
    expect(workflow.jobs["publish"]?.["if"]).toBe("${{ github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') }}");
    expect(workflow.jobs["publish"]?.["permissions"]).toEqual({ actions: "read", contents: "read", "id-token": "write" });
    expect(workflow.jobs["ci-gate"]?.["permissions"]).toEqual({ actions: "read", contents: "read" });
  });

  it("no IPM secret, deploy key, pinned host key or ssh option is in release.yml, its declaration or the release script (decision #122), and a reintroduced secret is a problem of the check", () => {
    // Built from parts, so that this file holds none of the removed names (the removal is also checked by grep).
    const names = ["IPM_" + "DIST_DEPLOY_KEY", "known" + "_hosts", "GIT_SSH" + "_COMMAND", "Strict" + "HostKeyChecking", "ssh" + "-ed25519", "deploy" + "-key"];
    for (const file of [".github/workflows/release.yml", "scripts/lib/release-checks.mjs", "scripts/release.mjs", "scripts/lib/release-core.mjs"]) {
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      for (const name of names) expect(source, `${file}: ${name}`).not.toContain(name);
    }
    const reintroduced = mutate(text, "          OVSX_PAT: ${{ secrets.OVSX_PAT }}\n", `          OVSX_PAT: \${{ secrets.OVSX_PAT }}\n          ${names[0]}: \${{ secrets.${names[0]} }}\n`);
    const problems = releaseWorkflowProblems(reintroduced);
    expect(problems, "the declaration refuses a secret the publish step does not declare").not.toEqual([]);
    expect(problems.join("\n"), "and the problem names the reintroduced secret").toContain(names[0]);
  });

  it("the setup-node step of publish takes no registry-url, so npm's own authentication decides (OIDC or the token userconfig)", () => {
    for (const step of workflow.jobs["publish"]?.["steps"] as Array<Record<string, any>>) {
      if (typeof step["uses"] === "string" && step["uses"].startsWith("actions/setup-node@")) {
        expect(Object.keys(step["with"]).sort()).toEqual(["node-version", "package-manager-cache"]);
      }
    }
  });

  it("every setup-node step of a job that installs no pnpm switches the package-manager cache off (setup-node v5 would look for pnpm and fail); prepare installs pnpm first", () => {
    const setupNodes = (job: string): Array<Record<string, any>> => (workflow.jobs[job]?.["steps"] as Array<Record<string, any>>).filter((step) => String(step["uses"]).startsWith("actions/setup-node@"));
    for (const job of ["ci-gate", "rehearse", "publish"]) {
      const steps = workflow.jobs[job]?.["steps"] as Array<Record<string, any>>;
      expect(steps.some((step) => String(step["uses"]).startsWith("pnpm/action-setup@")), `${job} installs no pnpm`).toBe(false);
      expect(setupNodes(job)).toHaveLength(1);
      for (const step of setupNodes(job)) expect(step["with"]["package-manager-cache"], `${job}: package-manager-cache`).toBe(false);
    }
    const prepare = workflow.jobs["prepare"]?.["steps"] as Array<Record<string, any>>;
    const pnpmAt = prepare.findIndex((step) => String(step["uses"]).startsWith("pnpm/action-setup@"));
    const nodeAt = prepare.findIndex((step) => String(step["uses"]).startsWith("actions/setup-node@"));
    expect(pnpmAt).toBeGreaterThanOrEqual(0);
    expect(pnpmAt).toBeLessThan(nodeAt);
  });

  it("the Node versions: ci-gate and prepare on the floor, rehearse and publish on 26.0.0 (npm 11.12.1)", () => {
    expect(RELEASE_NODE).toEqual({ floor: "22.17.0", upload: "26.0.0" });
    const nodeOf = (job: string): unknown => (workflow.jobs[job]?.["steps"] as Array<Record<string, any>>).find((step) => String(step["uses"]).startsWith("actions/setup-node@"))?.["with"]?.["node-version"];
    expect(["ci-gate", "prepare", "rehearse", "publish"].map(nodeOf)).toEqual(["22.17.0", "22.17.0", "26.0.0", "26.0.0"]);
  });

  it("the refusal of an old npm names the Node that the upload jobs run, so a move of RELEASE_NODE.upload moves the advice with it", () => {
    expect(npmVersionProblems("11.4.0")).toHaveLength(1);
    expect(npmVersionProblems("11.4.0")[0]).toContain(`Run the release on Node ${RELEASE_NODE.upload}`);
  });

  it.each([
    ["rehearse given id-token: write", () => mutate(text, REHEARSE_HEAD, `${REHEARSE_HEAD}      id-token: write\n`), /job rehearse has permissions .*id-token|job rehearse has id-token permission/],
    ["publish without its push clause", () => mutate(text, PUBLISH_IF, "    if: ${{ startsWith(github.ref, 'refs/tags/v') }}\n"), /job publish has the condition/],
    ["publish without its condition", () => mutate(text, PUBLISH_IF, ""), /job publish has the condition undefined/],
    ["rehearse given the environment", () => mutate(text, REHEARSE_HEAD, `${REHEARSE_HEAD}    environment: release\n`), /job rehearse has an environment: only publish may/],
    ["publish without the environment", () => mutate(text, "    environment: release\n", ""), /job publish has environment undefined/],
    ["a secret read in rehearse", () => mutate(text, DRY_RUN, `${DRY_RUN}        env:\n          NPM_TOKEN: \${{ secrets.NPM_TOKEN }}\n`), /job rehearse reads a secret: only publish may/],
    ["a secret read in prepare", () => mutate(text, "        run: pnpm build\n", "        run: pnpm build\n        env:\n          T: ${{ secrets.NPM_TOKEN }}\n"), /job prepare reads a secret: only publish may/],
    ["github.token read in prepare", () => mutate(text, "        run: pnpm build\n", "        run: pnpm build\n        env:\n          T: ${{ github.token }}\n"), /job prepare reads github\.token: only ci-gate and publish may/],
    ["github.token read in rehearse", () => mutate(text, DRY_RUN, `${DRY_RUN}        env:\n          GITHUB_TOKEN: \${{ github.token }}\n`), /job rehearse reads github\.token/],
    // QA: a step's name is compared with nothing, so a secret named there in its bracket form must still be found.
    ["a secret in its bracket form in a step name of rehearse", () => mutate(text, "      - name: rehearse the upload\n", "      - name: rehearse the upload ${{ secrets['NPM_TOKEN'] }}\n"), /job rehearse reads a secret: only publish may/],
    ["github.token in its bracket form in a step name of prepare", () => mutate(text, "      - name: build\n", "      - name: build ${{ github['token'] }}\n"), /job prepare reads github\.token: only ci-gate and publish may/],
    ["a secret in its bracket form at the workflow level", () => mutate(text, RUN_NAME, "run-name: release ${{ secrets['NPM_TOKEN'] }}\n"), OUTSIDE_THE_JOBS],
    // `toJSON(secrets)` hands over every secret, and `toJSON(github)` the token, with neither a dot nor a bracket.
    ["every secret through toJSON(secrets) in a step name of rehearse", () => mutate(text, "      - name: rehearse the upload\n", "      - name: rehearse the upload ${{ toJSON(secrets) }}\n"), /job rehearse reads a secret: only publish may/],
    ["github.token through toJSON(github) in a step name of prepare", () => mutate(text, "      - name: build\n", "      - name: build ${{ toJSON(github) }}\n"), /job prepare reads github\.token: only ci-gate and publish may/],
    ["every secret through toJSON(secrets) at the workflow level", () => mutate(text, RUN_NAME, "run-name: release ${{ toJSON(secrets) }}\n"), OUTSIDE_THE_JOBS],
    ["publish needing only prepare", () => mutate(text, "    needs: [ci-gate, prepare, rehearse]\n", "    needs: [prepare]\n"), /job publish needs prepare, not ci-gate, prepare, rehearse|job publish needs prepare, not/],
    ["a pull_request trigger", () => mutate(text, "on:\n  push:\n", "on:\n  pull_request:\n  push:\n"), /the triggers are pull_request, push, workflow_dispatch|pull_request trigger/],
    ["a schedule trigger", () => mutate(text, "  workflow_dispatch: {}\n", "  workflow_dispatch: {}\n  schedule:\n    - cron: '0 0 * * *'\n"), /the triggers are push, schedule, workflow_dispatch|schedule trigger/],
    ["a workflow_run trigger", () => mutate(text, "  workflow_dispatch: {}\n", "  workflow_dispatch: {}\n  workflow_run:\n    workflows: [ci]\n"), /the triggers are push, workflow_dispatch, workflow_run|workflow_run/],
    ["a push trigger that also takes branches", () => mutate(text, '    branches: ["release-dry-run/**"]\n', '    branches: ["release-dry-run/**", "main"]\n'), /the push trigger is/],
    ["a push trigger without the tags", () => mutate(text, '    tags: ["v*"]\n', ""), /the push trigger is/],
    ["the dispatch dropped", () => mutate(text, "  workflow_dispatch: {}\n", ""), /the triggers are push, not push, workflow_dispatch/],
    ["a workflow-level permission", () => mutate(text, "permissions: {}\n", "permissions:\n  contents: read\n"), /the workflow permissions are/],
    ["a concurrency that cancels a started release", () => mutate(text, "cancel-in-progress: false", "cancel-in-progress: true"), /the concurrency is/],
    // QA: the ways a red job, a dry run or a branch push could still reach the publish job or its secrets (a status function in a condition lifts `needs`).
    ["publish given always() ahead of its tag test (a status function lifts needs, so a red job would still publish)", () => mutate(text, "if: ${{ github.event_name == 'push'", "if: ${{ always() && github.event_name == 'push'"), /job publish has the condition/],
    ["publish given failure() beside its tag test", () => mutate(text, "startsWith(github.ref, 'refs/tags/v') }}\n    environment", "startsWith(github.ref, 'refs/tags/v') || failure() }}\n    environment"), /job publish has the condition/],
    ["a step-level condition on the publish step", () => mutate(text, "      - name: publish\n", "      - name: publish\n        if: always()\n"), /sets if, which the declaration does not use/],
    ["a dispatch that takes inputs", () => mutate(text, "  workflow_dispatch: {}\n", "  workflow_dispatch:\n    inputs:\n      publish:\n        type: boolean\n"), /workflow_dispatch is/],
    ["a repository_dispatch trigger", () => mutate(text, "  workflow_dispatch: {}\n", "  workflow_dispatch: {}\n  repository_dispatch:\n    types: [release]\n"), /the triggers are push, repository_dispatch, workflow_dispatch/],
    ["a release trigger", () => mutate(text, "  workflow_dispatch: {}\n", "  workflow_dispatch: {}\n  release:\n    types: [published]\n"), /the triggers are push, release, workflow_dispatch/],
    ["the environment in its object form on rehearse", () => mutate(text, REHEARSE_HEAD, `${REHEARSE_HEAD}    environment:\n      name: release\n`), /job rehearse has an environment: only publish may/],
    ["write-all permissions on rehearse", () => mutate(text, REHEARSE_HEAD, "    needs: [prepare]\n    runs-on: ubuntu-24.04\n    timeout-minutes: 20\n    permissions: write-all\n"), /job rehearse has permissions "write-all"/],
    ["a reusable workflow in place of rehearse's body, with every secret inherited", () => mutate(text, "  rehearse:\n    name: rehearse\n", "  rehearse:\n    uses: ./.github/workflows/other.yml\n    secrets: inherit\n    name: rehearse\n"), /job rehearse sets uses, which the declaration does not use/],
    ["a bare publish in rehearse", () => mutate(text, DRY_RUN, "        run: node scripts/release.mjs publish --artifacts ${{ runner.temp }}/release-artifacts\n"), /job rehearse runs release\.mjs publish: only publish may/],
    ["a dry-run publish in the publish job", () => mutate(text, BARE_PUBLISH, "        run: node scripts/release.mjs publish --dry-run --artifacts ${{ runner.temp }}/release-artifacts\n        env:\n"), /job publish runs release\.mjs publish --dry-run: only rehearse may/],
    ["ci-gate run in prepare", () => mutate(text, "        run: pnpm build\n", "        run: pnpm build && node scripts/release.mjs ci-gate\n"), /job prepare runs release\.mjs ci-gate: only ci-gate may/],
    ["a release.mjs command that is not a command", () => mutate(text, "        run: pnpm build\n", "        run: pnpm build && node scripts/release.mjs verify\n"), /release\.mjs with a command that is not/],
    ["a raw npm publish", () => mutate(text, "        run: pnpm build\n", "        run: pnpm build && npm publish\n"), /raw publish, push or tag verb/],
    ["a raw pnpm publish", () => mutate(text, "        run: pnpm build\n", "        run: pnpm publish -r\n"), /raw publish, push or tag verb/],
    ["a raw changeset publish", () => mutate(text, "        run: pnpm build\n", "        run: pnpm exec changeset publish\n"), /raw publish, push or tag verb/],
    ["a raw git push", () => mutate(text, "        run: pnpm build\n", "        run: git push origin HEAD\n"), /raw publish, push or tag verb/],
    ["a raw git tag", () => mutate(text, "        run: pnpm build\n", "        run: git tag v1\n"), /raw publish, push or tag verb/],
    ["a raw vsce publish", () => mutate(text, "        run: pnpm build\n", "        run: npx vsce publish\n"), /raw publish, push or tag verb/],
    ["a raw ipm publish", () => mutate(text, "        run: pnpm build\n", "        run: ipm publish\n"), /raw publish, push or tag verb/],
    ["a raw gh release create", () => mutate(text, "        run: pnpm build\n", "        run: gh release create v1\n"), /raw publish, push or tag verb/],
    ["a release asset step", () => mutate(text, "        run: pnpm build\n", "        run: pnpm build\n      - uses: actions/upload-release-asset@v1\n"), /the workflow contains a release asset step/],
    ["a secret named at the workflow level", () => mutate(text, RUN_NAME, "run-name: release ${{ secrets.NPM_TOKEN }}\n"), OUTSIDE_THE_JOBS],
    ["github.token named at the workflow level", () => mutate(text, RUN_NAME, "run-name: release ${{ github.token }}\n"), OUTSIDE_THE_JOBS],
    ["id-token named at the workflow level", () => mutate(text, RUN_NAME, "run-name: release id-token\n"), OUTSIDE_THE_JOBS],
    ["continue-on-error", () => mutate(text, "    timeout-minutes: 90\n", "    timeout-minutes: 90\n    continue-on-error: true\n"), /continue-on-error|sets continue-on-error/],
    ["a || true", () => mutate(text, "        run: pnpm build\n", "        run: pnpm build || true\n"), /\|\| true/],
    ["npx -y", () => mutate(text, "        run: pnpm build\n", "        run: npx -y some-tool\n"), /npx -y/],
    ["@latest", () => mutate(text, "        run: pnpm build\n", "        run: npm i some-tool@latest\n"), /@latest/],
    ["an unpinned checkout", () => mutate(text, CHECKOUT, "actions/checkout@v5"), /not pinned to its registered commit/],
    ["a checkout pinned to another commit", () => mutate(text, "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0", "0000000000000000000000000000000000000000 # v5.1.0"), /not pinned to its registered commit/],
    ["an artifact action without its tag comment", () => mutate(text, " # v7.0.2", ""), /lacks its trailing tag comment/],
    ["an artifact action pinned to a tag", () => mutate(text, "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333 # v8.0.2", "actions/download-artifact@v8"), /not pinned to its registered commit/],
    ["an unregistered action", () => mutate(text, "actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2", "actions/cache@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2"), /not a registered action/],
    ["a checkout that keeps its credentials", () => mutate(text, "          persist-credentials: false\n", "          persist-credentials: true\n"), /step 1 is/],
    ["a checkout of another ref", () => mutate(text, "          persist-credentials: false\n", "          persist-credentials: false\n          ref: main\n"), /step 1 is/],
    ["a dropped step", () => mutate(text, "      - name: build\n        run: pnpm build\n", ""), /job prepare has 8 steps, the declaration has 9|job prepare: step/],
    ["an undeclared step", () => mutate(text, "      - name: build\n        run: pnpm build\n", "      - name: build\n        run: pnpm build\n      - name: extra\n        run: echo extra\n"), /job prepare has 10 steps, the declaration has 9/],
    ["a step moved", () => mutate(text, "      - name: install\n        run: pnpm install --frozen-lockfile\n      - name: build\n        run: pnpm build\n", "      - name: build\n        run: pnpm build\n      - name: install\n        run: pnpm install --frozen-lockfile\n"), /job prepare: step 4 is/],
    ["a changed working directory", () => mutate(text, "        working-directory: extensions/iris-mcp-launcher\n", "        working-directory: extensions\n"), /job prepare: step 6 is/],
    ["the upload that may find no file", () => mutate(text, "          if-no-files-found: error\n", "          if-no-files-found: warn\n"), /job prepare: step 9 is/],
    ["rehearse on another Node", () => mutate(text, 'node-version: "26.0.0"', 'node-version: "24.0.0"'), /job rehearse does not run on Node 26\.0\.0/],
    ["prepare on another Node", () => mutate(text, 'node-version: "22.17.0"\n          cache: pnpm', 'node-version: "24.0.0"\n          cache: pnpm'), /job prepare does not run on Node 22\.17\.0/],
    // A setup-node in a job with no pnpm, left on setup-node v5's default package-manager cache, fails looking for pnpm.
    ["ci-gate's setup-node without package-manager-cache: false", () => mutate(text, 'node-version: "22.17.0"\n          package-manager-cache: false\n', 'node-version: "22.17.0"\n'), /job ci-gate: step 2 is a setup-node with no pnpm installed before it and without package-manager-cache: false/],
    ["the setup-node of rehearse and of publish without package-manager-cache: false", () => mutate(text, 'node-version: "26.0.0"\n          package-manager-cache: false\n', 'node-version: "26.0.0"\n'), /job rehearse: step 2 is a setup-node with no pnpm[\s\S]*job publish: step 2 is a setup-node with no pnpm/],
    ["package-manager-cache: true on the setup-node of ci-gate", () => mutate(text, 'node-version: "22.17.0"\n          package-manager-cache: false\n', 'node-version: "22.17.0"\n          package-manager-cache: true\n'), /job ci-gate: step 2 is a setup-node with no pnpm installed before it/],
    ["prepare's setup-node ahead of its pnpm step", () => mutate(text, "      - uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0\n      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0\n", "      - uses: actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0\n      - uses: pnpm/action-setup@fc06bc1257f339d1d5d8b3a19a8cae5388b55320 # v4.4.0\n"), /job prepare: step 2 is a setup-node with no pnpm installed before it/],
    ["cache: pnpm on ci-gate's setup-node beside package-manager-cache: false", () => mutate(text, 'node-version: "22.17.0"\n          package-manager-cache: false\n', 'node-version: "22.17.0"\n          package-manager-cache: false\n          cache: pnpm\n'), /job ci-gate: step 2 is a setup-node with no pnpm installed before it and with cache: pnpm/],
    ["another runner", () => mutate(text, "runs-on: ubuntu-24.04\n    timeout-minutes: 20", "runs-on: ubuntu-latest\n    timeout-minutes: 20"), /job rehearse does not run on ubuntu-24\.04/],
    ["another budget", () => mutate(text, "timeout-minutes: 90", "timeout-minutes: 360"), /job prepare has timeout-minutes 360, not 90/],
    ["a job the declaration does not have", () => mutate(text, "  rehearse:\n    name: rehearse\n", "  extra:\n    name: extra\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo extra\n  rehearse:\n    name: rehearse\n"), /the jobs are ci-gate, prepare, extra, rehearse, publish/],
    ["a job with a strategy", () => mutate(text, "    timeout-minutes: 20\n", '    timeout-minutes: 20\n    strategy:\n      matrix:\n        node: ["22"]\n'), /sets a strategy, defaults or env|job rehearse sets strategy/],
    ["a job env", () => mutate(text, "    timeout-minutes: 20\n", "    timeout-minutes: 20\n    env:\n      A: b\n"), /sets a strategy, defaults or env|job rehearse sets env/],
    ["a step shell", () => mutate(text, "        run: pnpm build\n", '        run: pnpm build\n        shell: "true {0}"\n'), /sets shell/],
    // Story 42.7: the store CLIs are installed with no install script in the two jobs that run them, and `OVSX_PAT` is a secret of `publish` alone.
    ["the store CLI install dropped from rehearse and publish", () => mutate(text, INSTALL_STORE_CLIS, ""), /job rehearse has 4 steps, the declaration has 5[\s\S]*job publish has 4 steps, the declaration has 5/],
    ["the store CLI install run with its install scripts", () => mutate(text, "run: npm ci --ignore-scripts", "run: npm ci"), /job rehearse: step 4 is[\s\S]*job publish: step 4 is/],
    ["the store CLI install in another directory", () => mutate(text, "        working-directory: extensions/iris-mcp-launcher\n      - name: rehearse the upload", "      - name: rehearse the upload"), /job rehearse: step 4 is/],
    ["OVSX_PAT dropped from the publish step", () => mutate(text, "          OVSX_PAT: ${{ secrets.OVSX_PAT }}\n", ""), /job publish: step 5 is/],
    ["a VSCE_PAT secret passed to the publish step", () => mutate(text, "          OVSX_PAT: ${{ secrets.OVSX_PAT }}\n", "          OVSX_PAT: ${{ secrets.OVSX_PAT }}\n          VSCE_PAT: ${{ secrets.VSCE_PAT }}\n"), /job publish: step 5 is/],
    ["OVSX_PAT read in rehearse", () => mutate(text, DRY_RUN, `${DRY_RUN}        env:\n          OVSX_PAT: \${{ secrets.OVSX_PAT }}\n`), /job rehearse reads a secret: only publish may/],
    ["the prepare job without the artifact upload", () => mutate(text, "      - uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2\n        with:\n          name: release-artifacts\n          path: ${{ runner.temp }}/release-artifacts\n          if-no-files-found: error\n", ""), /job prepare has 8 steps/],
  ] as Array<[string, () => string, RegExp]>)("fails on %s", (_label, apply, expected) => {
    expect(releaseWorkflowProblems(apply()).join("\n")).toMatch(expected);
  });

  it("a word that only appears in a comment is not a finding", () => {
    expect(releaseWorkflowProblems(mutate(text, "name: release\n", "# secrets., continue-on-error, || true and npm publish are never used here\nname: release\n"))).toEqual([]);
  });

  it("the real file's rehearse job has no environment, no id-token permission and no secret (AC 42.5.4)", () => {
    const rehearse = workflow.jobs["rehearse"] as Record<string, any>;
    expect(rehearse["environment"]).toBeUndefined();
    expect(rehearse["permissions"]).toEqual({ contents: "read" });
    expect(JSON.stringify(rehearse)).not.toMatch(/secrets\.|github\.token|id-token/);
    const runs = (rehearse["steps"] as Array<Record<string, any>>).map((step) => step["run"]).filter((run) => typeof run === "string");
    expect(runs).toEqual(["npm ci --ignore-scripts", "node scripts/release.mjs publish --dry-run --artifacts ${{ runner.temp }}/release-artifacts"]);
  });
});

describe("AC 42.5.1: the run lines of the declaration are command lines that the release script accepts", () => {
  const TEMP = "/runner/temp";
  const ARTIFACTS = `${TEMP}/release-artifacts`;

  /** Each declared `node scripts/release.mjs ...` step, with `${{ runner.temp }}` replaced, split into the arguments the script gets. */
  const releaseRuns = Object.entries(RELEASE_JOBS as unknown as Record<string, { steps: Array<{ run?: string }> }>).flatMap(([job, declared]) =>
    declared.steps
      .filter((step) => step.run?.startsWith("node scripts/release.mjs"))
      .map((step) => ({ job, argv: (step.run as string).replace("node scripts/release.mjs", "").replaceAll("${{ runner.temp }}", TEMP).trim().split(/\s+/) })),
  );

  it("parseArgs accepts each with the command and options the job stands for: ci-gate none, prepare --out, rehearse --dry-run --artifacts, publish --artifacts", () => {
    expect(releaseRuns.map(({ job, argv }) => [job, parseArgs(argv)])).toEqual([
      ["ci-gate", { command: "ci-gate", options: {} }],
      ["prepare", { command: "prepare", options: { out: ARTIFACTS } }],
      ["rehearse", { command: "publish", options: { artifacts: ARTIFACTS, dryRun: true } }],
      ["publish", { command: "publish", options: { artifacts: ARTIFACTS, dryRun: false } }],
    ]);
  });

});

describe("AC 42.5.2: the repository holds no other way to publish", () => {
  const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

  /** An argv array literal that forms a publish, push or tag: the verb first, or a tool and its string arguments before it. */
  const ARGV_VERB =
    /\[\s*(?:['"`](?:npm|pnpm|yarn|vsce|ovsx|changeset|git)['"`]\s*,\s*(?:['"`][^'"`\n]*['"`]\s*,\s*)*)?['"`](?:publish|stage|unpublish|deprecate|dist-tag|push|tag)['"`]|\[\s*['"`]gh['"`]\s*,\s*(?:['"`][^'"`\n]*['"`]\s*,\s*)*['"`](?:release|secret|workflow)['"`]/;
  /** A command string handed to a process API, such as `execSync('npm publish x')`. */
  const STRING_COMMAND = /\b(?:execSync|exec|execFileSync|execFile|spawnSync|spawn)\s*\(\s*(['"`])((?:(?!\1)[^\n])*)\1/g;
  /** Whether a script's comment-free source forms a publish, push or tag outside an argv builder. */
  const formsPublishVerb = (source: string): boolean => {
    const code = stripComments(source);
    return ARGV_VERB.test(code) || [...code.matchAll(STRING_COMMAND)].some((match) => RAW_VERB.test(match[2] as string));
  };

  /** Every `package.json` of the repository's workspaces and its extension, with its scripts. */
  function manifests(): Array<{ file: string; scripts: Record<string, string> }> {
    const files = [
      "package.json",
      ...readdirSync(path.join(REPO_ROOT, "packages")).filter((dir) => existsSync(path.join(REPO_ROOT, "packages", dir, "package.json"))).map((dir) => `packages/${dir}/package.json`),
      ...readdirSync(path.join(REPO_ROOT, "extensions")).filter((dir) => existsSync(path.join(REPO_ROOT, "extensions", dir, "package.json"))).map((dir) => `extensions/${dir}/package.json`),
    ];
    return files.map((file) => ({ file, scripts: readJson<{ scripts?: Record<string, string> }>(path.join(REPO_ROOT, file)).scripts ?? {} }));
  }

  it(".github/workflows holds exactly ci.yml and release.yml, and no workflow but release.yml reads a secret", () => {
    const files = readdirSync(WORKFLOWS).sort();
    expect(files).toEqual(["ci.yml", "release.yml"]);
    expect(readFileSync(path.join(WORKFLOWS, "ci.yml"), "utf8").replace(/^\s*#.*$/gm, "")).not.toMatch(/secrets\./);
  });

  it("no package.json script holds a publish, push or tag verb (the workflow check's own detector)", () => {
    const found = manifests().flatMap(({ file, scripts }) => Object.entries(scripts).filter(([, command]) => RAW_VERB.test(command)).map(([name]) => `${file}: ${name}`));
    expect(found).toEqual([]);
    const root = manifests()[0]?.scripts ?? {};
    expect(root["release"]).toBe("node scripts/release.mjs");
    expect(root["version"]).toBe("node scripts/release-version.mjs");
  });

  it("the detector finds a publish verb in a script, with flags between the tool and the verb too", () => {
    for (const command of [
      "npm publish",
      "pnpm publish -r",
      "pnpm -r publish --access public",
      "pnpm --filter @iris-mcp/shared publish",
      "npm -w packages/shared publish",
      "npm --workspaces publish",
      "npm dist-tag add @iris-mcp/shared@1.0.0 latest",
      "npm trust github @iris-mcp/shared --file release.yml",
      "changeset publish",
      "pnpm exec changeset version",
      "vsce publish",
      "npx vsce publish",
      "ovsx publish x",
      "git push origin main",
      "git -C dist push",
      "git -c user.name=x push origin",
      "git tag v1",
      "gh release create v1",
      "gh secret set NPM_TOKEN",
      "npm stage publish",
      "pnpm build && npm publish",
    ]) {
      expect(RAW_VERB.test(command), command).toBe(true);
    }
    for (const command of ["node scripts/release.mjs publish --dry-run", "node scripts/prepublish-gate.mjs", "pnpm run prepublishOnly", "pnpm install --frozen-lockfile", "npm ci", "git status --porcelain", "git log --tags", "pnpm build && echo publish"]) {
      expect(RAW_VERB.test(command), command).toBe(false);
    }
  });

  it("only scripts/lib/release-core.mjs forms a publish argv: no other script writes one, as an argv array or as a command string", () => {
    const scriptsDir = path.join(REPO_ROOT, "scripts");
    const walk = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(directory, entry.name)) : entry.name.endsWith(".mjs") ? [path.join(directory, entry.name)] : []));
    // The one other array that starts with 'publish' is the list of IPM verbs the archive proof must never issue.
    const lists = [path.join("scripts", "lib", "release-core.mjs"), path.join("scripts", "lib", "ipm-archive.mjs")];
    const offenders = walk(scriptsDir)
      .filter((file) => !lists.includes(path.relative(REPO_ROOT, file)))
      .filter((file) => formsPublishVerb(readFileSync(file, "utf8")))
      .map((file) => path.relative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
    expect(readFileSync(path.join(scriptsDir, "lib", "ipm-archive.mjs"), "utf8")).toMatch(/FORBIDDEN_IPM_VERBS = Object\.freeze\(\['publish'/);
    expect(readFileSync(path.join(scriptsDir, "lib", "release-core.mjs"), "utf8")).toMatch(/\[\s*'publish'/);
  });

  it("the argv detector finds the shapes this repository spawns with, and not the ones it uses for other work", () => {
    for (const source of [
      "await deps.run(['npm', 'publish', tgz]);",
      'await runCaptured(["pnpm", "--filter", "x", "publish"]);',
      "spawnSync('git', ['push', 'origin', 'main']);",
      "run(['git', '-C', 'dist', 'tag', 'v1']);",
      "run(['gh', 'release', 'create', 'v1']);",
      "execSync('npm publish x.tgz');",
      "execSync(`git -C dist push`);",
      "const argv = ['publish', tarball];",
    ]) {
      expect(formsPublishVerb(source), source).toBe(true);
    }
    for (const source of [
      "await deps.run(['npm', ...npmPublishArgv(tarball)]);",
      "await deps.run(['git', 'status', '--porcelain']);",
      "spawnSync('git', ['rev-parse', 'HEAD']);",
      "say('npm publish failed (exit 1). Nothing after it is attempted.');",
      "// run(['npm', 'publish', tgz]) is what release-core builds",
      "execSync('git status --porcelain');",
    ]) {
      expect(formsPublishVerb(source), source).toBe(false);
    }
  });
});

describe("the npm publish order and the channels", () => {
  const packages = publishablePackages() as Array<{ dir: string; name: string }>;
  const manifestOf = (name: string): { dependencies?: Record<string, string> } =>
    JSON.parse(readFileSync(path.join(REPO_ROOT, "packages", (packages.find((entry) => entry.name === name) as { dir: string }).dir, "package.json"), "utf8")) as { dependencies?: Record<string, string> };

  it("NPM_PUBLISH_ORDER is exactly client-config, shared, admin, data, dev, interop, ops, all, and names the published packages", () => {
    expect([...NPM_PUBLISH_ORDER]).toEqual(["@iris-mcp/client-config", "@iris-mcp/shared", "@iris-mcp/admin", "@iris-mcp/data", "@iris-mcp/dev", "@iris-mcp/interop", "@iris-mcp/ops", "@iris-mcp/all"]);
    expect([...NPM_PUBLISH_ORDER].sort()).toEqual(packages.map((entry) => entry.name).sort());
  });

  it("every package follows its workspace:* dependencies", () => {
    NPM_PUBLISH_ORDER.forEach((name: string, index: number) => {
      const needed = Object.entries(manifestOf(name).dependencies ?? {}).filter(([dependency, specifier]) => dependency.startsWith("@iris-mcp/") && specifier.startsWith("workspace:")).map(([dependency]) => dependency);
      for (const dependency of needed) expect(NPM_PUBLISH_ORDER.indexOf(dependency), `${name} needs ${dependency} first`).toBeLessThan(index);
    });
    expect(NPM_PUBLISH_ORDER.indexOf("@iris-mcp/shared")).toBeLessThan(NPM_PUBLISH_ORDER.indexOf("@iris-mcp/admin"));
    expect(NPM_PUBLISH_ORDER[NPM_PUBLISH_ORDER.length - 1]).toBe("@iris-mcp/all");
  });

  it("a reordered list fails the dependency check (the detector can fail)", () => {
    const violations = (order: string[]): string[] =>
      order.flatMap((name, index) =>
        Object.entries(manifestOf(name).dependencies ?? {})
          .filter(([dependency, specifier]) => dependency.startsWith("@iris-mcp/") && specifier.startsWith("workspace:") && order.indexOf(dependency) > index)
          .map(([dependency]) => `${name} before ${dependency}`),
      );
    // Two permutations of the real list: admin and shared swapped, and the meta-package first.
    const swapped = ["@iris-mcp/client-config", "@iris-mcp/admin", "@iris-mcp/shared", "@iris-mcp/data", "@iris-mcp/dev", "@iris-mcp/interop", "@iris-mcp/ops", "@iris-mcp/all"];
    const allFirst = ["@iris-mcp/all", ...NPM_PUBLISH_ORDER.slice(0, NPM_PUBLISH_ORDER.length - 1)];
    for (const order of [swapped, allFirst]) expect([...order].sort(), "a permutation of the real list: no name twice, none dropped").toEqual([...NPM_PUBLISH_ORDER].sort());
    expect(violations([...NPM_PUBLISH_ORDER])).toEqual([]);
    expect(violations(swapped)).toEqual(["@iris-mcp/admin before @iris-mcp/shared"]);
    expect(violations(allFirst).sort()).toEqual(["admin", "data", "dev", "interop", "ops"].map((short) => `@iris-mcp/all before @iris-mcp/${short}`));
  });

  it("the channels are npm, the Marketplace, Open VSX, IPM and the MCP Registry last, and all five are enabled (Story 42.8)", () => {
    expect(RELEASE_CHANNELS.map((channel: { id: string }) => channel.id)).toEqual(["npm", "vscode-marketplace", "open-vsx", "ipm", "mcp-registry"]);
    expect(RELEASE_CHANNELS.map((channel: { enabled: boolean }) => channel.enabled)).toEqual([true, true, true, true, true]);
    expect(RELEASE_CHANNELS.map((channel: { enabledBy?: string }) => channel.enabledBy)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });

  it("the pins of the release workflow are the CI pins plus the two artifact actions, each a 40-hex commit", () => {
    for (const entry of [...PINNED_ACTIONS, ...ARTIFACT_ACTIONS] as Array<{ sha: string; tag: string }>) {
      expect(entry.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    }
    expect(ARTIFACT_ACTIONS.map((entry: { action: string }) => entry.action)).toEqual(["actions/upload-artifact", "actions/download-artifact"]);
  });
});
