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
import { NPM_PUBLISH_ORDER, RELEASE_CHANNELS } from "../../../../scripts/lib/release-core.mjs";
import { REPO_ROOT } from "../../../../scripts/lib/live-gate-scan.mjs";
import { parseArgs } from "../../../../scripts/release.mjs";
import { releaseWorkflowProblems } from "./release-workflow-check";

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
    expect([...(workflow.jobs["publish"]?.["needs"] as string[])].sort()).toEqual(["ci-gate", "prepare", "rehearse"]);
    expect(workflow.jobs["publish"]?.["if"]).toBe(PUBLISH_CONDITION);
    expect(workflow.jobs["publish"]?.["if"]).toBe("${{ github.event_name == 'push' && startsWith(github.ref, 'refs/tags/v') }}");
    expect(workflow.jobs["publish"]?.["permissions"]).toEqual({ actions: "read", contents: "read", "id-token": "write" });
    expect(workflow.jobs["ci-gate"]?.["permissions"]).toEqual({ actions: "read", contents: "read" });
  });

  it("the setup-node step of publish takes no registry-url, so npm's own authentication decides (OIDC or the token userconfig)", () => {
    for (const step of workflow.jobs["publish"]?.["steps"] as Array<Record<string, any>>) {
      if (typeof step["uses"] === "string" && step["uses"].startsWith("actions/setup-node@")) expect(Object.keys(step["with"])).toEqual(["node-version"]);
    }
  });

  it("the Node versions: ci-gate and prepare on the floor, rehearse and publish on 26.0.0 (npm 11.12.1)", () => {
    expect(RELEASE_NODE).toEqual({ floor: "22.17.0", upload: "26.0.0" });
    const nodeOf = (job: string): unknown => (workflow.jobs[job]?.["steps"] as Array<Record<string, any>>).find((step) => String(step["uses"]).startsWith("actions/setup-node@"))?.["with"]?.["node-version"];
    expect(["ci-gate", "prepare", "rehearse", "publish"].map(nodeOf)).toEqual(["22.17.0", "22.17.0", "26.0.0", "26.0.0"]);
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
    ["publish needing only prepare", () => mutate(text, "    needs: [ci-gate, prepare, rehearse]\n", "    needs: [prepare]\n"), /job publish needs prepare, not ci-gate, prepare, rehearse|job publish needs prepare, not/],
    ["a pull_request trigger", () => mutate(text, "on:\n  push:\n", "on:\n  pull_request:\n  push:\n"), /the triggers are pull_request, push, workflow_dispatch|pull_request trigger/],
    ["a schedule trigger", () => mutate(text, "  workflow_dispatch: {}\n", "  workflow_dispatch: {}\n  schedule:\n    - cron: '0 0 * * *'\n"), /the triggers are push, schedule, workflow_dispatch|schedule trigger/],
    ["a workflow_run trigger", () => mutate(text, "  workflow_dispatch: {}\n", "  workflow_dispatch: {}\n  workflow_run:\n    workflows: [ci]\n"), /the triggers are push, workflow_dispatch, workflow_run|workflow_run/],
    ["a push trigger that also takes branches", () => mutate(text, '    branches: ["release-dry-run/**"]\n', '    branches: ["release-dry-run/**", "main"]\n'), /the push trigger is/],
    ["a push trigger without the tags", () => mutate(text, '    tags: ["v*"]\n', ""), /the push trigger is/],
    ["the dispatch dropped", () => mutate(text, "  workflow_dispatch: {}\n", ""), /the triggers are push, not push, workflow_dispatch/],
    ["a workflow-level permission", () => mutate(text, "permissions: {}\n", "permissions:\n  contents: read\n"), /the workflow permissions are/],
    ["a concurrency that cancels a started release", () => mutate(text, "cancel-in-progress: false", "cancel-in-progress: true"), /the concurrency is/],
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
    ["another runner", () => mutate(text, "runs-on: ubuntu-24.04\n    timeout-minutes: 20", "runs-on: ubuntu-latest\n    timeout-minutes: 20"), /job rehearse does not run on ubuntu-24\.04/],
    ["another budget", () => mutate(text, "timeout-minutes: 90", "timeout-minutes: 360"), /job prepare has timeout-minutes 360, not 90/],
    ["a job the declaration does not have", () => mutate(text, "  rehearse:\n    name: rehearse\n", "  extra:\n    name: extra\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo extra\n  rehearse:\n    name: rehearse\n"), /the jobs are ci-gate, prepare, extra, rehearse, publish/],
    ["a job with a strategy", () => mutate(text, "    timeout-minutes: 20\n", '    timeout-minutes: 20\n    strategy:\n      matrix:\n        node: ["22"]\n'), /sets a strategy, defaults or env|job rehearse sets strategy/],
    ["a job env", () => mutate(text, "    timeout-minutes: 20\n", "    timeout-minutes: 20\n    env:\n      A: b\n"), /sets a strategy, defaults or env|job rehearse sets env/],
    ["a step shell", () => mutate(text, "        run: pnpm build\n", '        run: pnpm build\n        shell: "true {0}"\n'), /sets shell/],
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
    expect(runs).toEqual(["node scripts/release.mjs publish --dry-run --artifacts ${{ runner.temp }}/release-artifacts"]);
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
  const PUBLISH_VERB = /\b(?:npm|pnpm|yarn)\s+(?:publish|stage|deprecate|unpublish)\b|\bchangeset\s+(?:publish|version)\b|\b(?:vsce|ovsx)\s+publish\b|\bgit\s+(?:push|tag)\b|\bgh\s+release\b|\bnpm\s+(?:login|adduser)\b/;

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

  it("no package.json script holds a publish, push or tag verb", () => {
    const found = manifests().flatMap(({ file, scripts }) => Object.entries(scripts).filter(([, command]) => PUBLISH_VERB.test(command)).map(([name]) => `${file}: ${name}`));
    expect(found).toEqual([]);
    const root = manifests()[0]?.scripts ?? {};
    expect(root["release"]).toBe("node scripts/release.mjs");
    expect(root["version"]).toBe("node scripts/release-version.mjs");
  });

  it("the detector finds a publish verb in a script", () => {
    for (const command of ["npm publish", "pnpm publish -r", "changeset publish", "pnpm exec changeset version", "vsce publish", "ovsx publish x", "git push origin main", "git tag v1", "gh release create v1", "npm stage publish"]) {
      expect(PUBLISH_VERB.test(command), command).toBe(true);
    }
    expect(PUBLISH_VERB.test("node scripts/release.mjs publish --dry-run")).toBe(false);
    expect(PUBLISH_VERB.test("node scripts/prepublish-gate.mjs")).toBe(false);
  });

  it("only scripts/lib/release-core.mjs forms a publish argv: no other script writes an array that starts with 'publish'", () => {
    const scriptsDir = path.join(REPO_ROOT, "scripts");
    const walk = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(directory, entry.name)) : entry.name.endsWith(".mjs") ? [path.join(directory, entry.name)] : []));
    // The one other array that starts with 'publish' is the list of IPM verbs the archive proof must never issue.
    const lists = [path.join("scripts", "lib", "release-core.mjs"), path.join("scripts", "lib", "ipm-archive.mjs")];
    const offenders = walk(scriptsDir)
      .filter((file) => !lists.includes(path.relative(REPO_ROOT, file)))
      .filter((file) => /\[\s*['"]publish['"]/.test(readFileSync(file, "utf8")))
      .map((file) => path.relative(REPO_ROOT, file));
    expect(offenders).toEqual([]);
    expect(readFileSync(path.join(scriptsDir, "lib", "ipm-archive.mjs"), "utf8")).toMatch(/FORBIDDEN_IPM_VERBS = Object\.freeze\(\['publish'/);
    expect(readFileSync(path.join(scriptsDir, "lib", "release-core.mjs"), "utf8")).toMatch(/\[\s*'publish'/);
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

  it("the channels are npm, then the Marketplace, Open VSX and IPM; only npm is enabled, and each other names the story that enables it", () => {
    expect(RELEASE_CHANNELS.map((channel: { id: string }) => channel.id)).toEqual(["npm", "vscode-marketplace", "open-vsx", "ipm"]);
    expect(RELEASE_CHANNELS.map((channel: { enabled: boolean }) => channel.enabled)).toEqual([true, false, false, false]);
    expect(RELEASE_CHANNELS.map((channel: { enabledBy?: string }) => channel.enabledBy)).toEqual([undefined, "Story 42.7", "Story 42.7", "Story 42.8"]);
  });

  it("the pins of the release workflow are the CI pins plus the two artifact actions, each a 40-hex commit", () => {
    for (const entry of [...PINNED_ACTIONS, ...ARTIFACT_ACTIONS] as Array<{ sha: string; tag: string }>) {
      expect(entry.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(entry.tag).toMatch(/^v\d+\.\d+\.\d+$/);
    }
    expect(ARTIFACT_ACTIONS.map((entry: { action: string }) => entry.action)).toEqual(["actions/upload-artifact", "actions/download-artifact"]);
  });
});
