/**
 * Story 42.3 (AC 42.3.1, 42.3.4, 42.3.5; DW-443, DW-676) -- the self-test that holds `.github/workflows/ci.yml` equal to the
 * code-declared registry `scripts/lib/ci-checks.mjs` (AD-29), in both directions.
 *
 * `ci-workflow-check.ts` holds the checks as one pure function over the workflow text. Here it runs over the real file, which
 * must have no problem, and over a mutation of the file for each defect the acceptance criteria name, which must each have
 * one: a check that no mutation can fail would be a green badge over a dead check (Rule #59). Every mutation first asserts that
 * the text it replaces is in the file, so a mutation cannot silently change nothing.
 *
 * The rest pins what the workflow cannot show on its own: the registry's suites cover every roster script, integration config,
 * process gate and launcher live file; every live-capable test file is in a suite or in a reasoned exemption; every allowlisted
 * skip and exemption is real; the 42.1 checks are in the default suite; the README names the jobs and the legs.
 *
 * Reads documents and calls pure functions: no docker, no IRIS.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import vitestConfig from "../../vitest.config";
import {
  CI_IMAGES,
  CI_LIVE_EXEMPTIONS,
  DECLARED_STEPS,
  HARNESS_SUITE_IDS,
  LAUNCHER_LIVE_FILES,
  LIVE_SUITES,
  NODE_LEGS,
  PACKAGE_DIRS,
  PROCESS_GATE_FILES,
  coveredTestFiles,
  publishablePackages,
} from "../../../../scripts/lib/ci-checks.mjs";
import {
  IRISHEALTH_COMMUNITY_IMAGE,
  IRIS_COMMUNITY_IMAGE,
  OLDEST_IRIS_COMMUNITY_IMAGE,
  validateImage,
} from "../../../../scripts/throwaway-iris.mjs";
import {
  LIVE_CAPABLE,
  PACKAGES_DIR,
  REPO_ROOT,
  liveCapableTestFiles,
  readRoster,
  relativeToRepo,
  workspacePackageDirs,
} from "../../../../scripts/lib/live-gate-scan.mjs";
import { workflowProblems, type PackageFacts, type WorkflowContext } from "./ci-workflow-check";

const WORKFLOW = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");
const text = readFileSync(WORKFLOW, "utf8");

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

/** The facts about the repository the checks compare the workflow with, read from disk. */
function realContext(): WorkflowContext {
  const root = readJson<{ engines?: { node?: string }; packageManager?: string }>(path.join(REPO_ROOT, "package.json"));
  const packages: PackageFacts[] = workspacePackageDirs().map((dir: string) => {
    const manifest = readJson<{ name: string; engines?: { node?: string }; scripts?: Record<string, string> }>(path.join(PACKAGES_DIR, dir, "package.json"));
    return { dir, short: manifest.name.replace(/^@iris-mcp\//, ""), enginesNode: manifest.engines?.node, prepublishOnly: manifest.scripts?.prepublishOnly };
  });
  return { rootEnginesNode: root.engines?.node, packageManager: root.packageManager, packages };
}

const context = realContext();

/** `text` with the one occurrence of `from` replaced; a `from` that is not in the text is a mistake of the test. */
function mutate(source: string, from: string, to: string): string {
  const parts = source.split(from);
  if (parts.length < 2) throw new Error(`the mutation target is not in ci.yml: ${from}`);
  return parts.join(to);
}

/**
 * The `skipIf`/`runIf` calls of a test source whose condition reads a `let` binding of the file. Such a condition is evaluated
 * when the file is collected, before any hook can set the binding, so the test is decided before the run it depends on.
 */
function collectionTimeConditions(source: string): string[] {
  const lets = new Set([...source.matchAll(/\blet\s+([A-Za-z_$][\w$]*)/g)].map((match) => match[1] as string));
  const found: string[] = [];
  for (const call of source.matchAll(/\.(skipIf|runIf)\(/g)) {
    const start = (call.index as number) + call[0].length;
    let end = start;
    for (let depth = 1; end < source.length && depth > 0; end += 1) {
      if (source[end] === "(") depth += 1;
      else if (source[end] === ")") depth -= 1;
    }
    const condition = source.slice(start, end - 1).trim();
    const read = [...condition.matchAll(/[A-Za-z_$][\w$]*/g)].map((match) => match[0]).filter((name) => lets.has(name));
    if (read.length > 0) found.push(`${call[1]}(${condition}) reads let ${read.join(", ")}`);
  }
  return found;
}

/** The first checkout line of the file, which every job has. */
const CHECKOUT = "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0";

describe("AC 42.3.1: the workflow is the registry's workflow", () => {
  it("the real ci.yml has no problem", () => {
    expect(workflowProblems(text, context)).toEqual([]);
  });

  it("runs the three jobs, the gates job on exactly the three Node legs, and the package job after the other two", () => {
    expect(Object.keys(DECLARED_STEPS)).toEqual(["gates", "throwaway", "package"]);
    expect([...NODE_LEGS]).toEqual(["22.17.0", "24.0.0", "26.0.0"]);
    expect(workflowProblems(text, context).filter((problem) => /matrix|does not need/.test(problem))).toEqual([]);
    expect(workflowProblems(mutate(text, "needs: [gates, throwaway]", "needs: [gates]"), context).filter((problem) => /matrix|does not need/.test(problem))).toEqual(["the package job does not need throwaway"]);
  });

  it.each([
    ["a changed Node leg", () => mutate(text, '"22.17.0", "24.0.0", "26.0.0"', '"22.18.0", "24.0.0", "26.0.0"'), /gates matrix/],
    ["a Node leg dropped", () => mutate(text, '"22.17.0", "24.0.0", "26.0.0"', '"22.17.0", "24.0.0"'), /gates matrix/],
    ["a Node leg with a gap", () => mutate(text, '"26.0.0"]', '"28.0.0"]'), /gates matrix/],
    ["a dropped step (the epics-sync check)", () => mutate(text, "      - name: epics sync check\n        run: node scripts/check-epics-sync.mjs\n", ""), /declared step is not in the workflow.*check-epics-sync/],
    ["a dropped step (the lint)", () => mutate(text, "      - name: lint\n        run: pnpm lint\n", ""), /declared step is not in the workflow.*pnpm lint/],
    ["a dropped test step of one package", () => mutate(text, "      - name: test @iris-mcp/ops\n        run: pnpm --filter @iris-mcp/ops test\n", ""), /declared step is not in the workflow.*@iris-mcp\/ops test/],
    ["an undeclared step", () => mutate(text, "      - name: type-check\n        run: pnpm type-check\n", "      - name: type-check\n        run: pnpm type-check\n      - name: extra\n        run: echo extra\n"), /step the registry does not declare.*echo extra/],
    ["a step moved", () => mutate(text, "      - name: build\n        run: pnpm build\n      - name: lint\n        run: pnpm lint\n", "      - name: lint\n        run: pnpm lint\n      - name: build\n        run: pnpm build\n"), /out of order/],
    ["a changed working directory", () => mutate(text, "        run: npm run build\n        working-directory: extensions/iris-mcp-launcher\n", "        run: npm run build\n        working-directory: extensions\n"), /declared step is not in the workflow.*npm run build/],
    ["a step that lost its condition", () => mutate(text, "        if: \"${{ !cancelled() && steps.seed.outcome == 'success' }}\"\n        run: node scripts/throwaway-iris.mjs exec --state ${{ runner.temp }}/throwaway-live.json -- node scripts/ci-live-suite.mjs process-gates", "        run: node scripts/throwaway-iris.mjs exec --state ${{ runner.temp }}/throwaway-live.json -- node scripts/ci-live-suite.mjs process-gates"), /process-gates/],
    ["a suite the registry does not run", () => mutate(text, "ci-live-suite.mjs launcher-live", "ci-live-suite.mjs launcher-live-extra"), /suites the throwaway job runs/],
    ["a gates job that ignores its matrix leg", () => mutate(text, "node-version: ${{ matrix.node }}", 'node-version: "22.17.0"'), /gates does not run on its matrix leg/],
    [
      "a throwaway job on another Node",
      () => mutate(text, 'node-version: "22.17.0"\n          cache: pnpm\n      - name: install\n        run: pnpm install --frozen-lockfile\n      - name: build\n        run: pnpm build\n      - name: launcher install', 'node-version: "24.0.0"\n          cache: pnpm\n      - name: install\n        run: pnpm install --frozen-lockfile\n      - name: build\n        run: pnpm build\n      - name: launcher install'),
      /throwaway does not run on Node 22\.17\.0/,
    ],
    [
      "a package job on another Node",
      () => mutate(text, 'node-version: "22.17.0"\n          cache: pnpm\n      - name: install\n        run: pnpm install --frozen-lockfile\n      - name: build\n        run: pnpm build\n      - name: package smoke', 'node-version: "24.0.0"\n          cache: pnpm\n      - name: install\n        run: pnpm install --frozen-lockfile\n      - name: build\n        run: pnpm build\n      - name: package smoke'),
      /package does not run on Node 22\.17\.0/,
    ],
    ["a run-name without the head sha", () => mutate(text, "run-name: ci ${{ github.ref_name }} ${{ github.event.pull_request.head.sha || github.sha }}", "run-name: ci ${{ github.ref_name }}"), /run-name does not carry the head sha/],
    ["a job the registry does not declare", () => mutate(text, "  package:\n    name: package\n", "  extra:\n    name: extra\n    runs-on: ubuntu-24.04\n    steps:\n      - run: echo extra\n  package:\n    name: package\n"), /the jobs are gates, throwaway, extra, package/],
    ["a uses: line hidden in a run block", () => mutate(text, "        run: node scripts/ci-package-smoke.mjs\n", "        run: |\n          node scripts/ci-package-smoke.mjs\n          uses: evil/action@v1\n"), /uses: lines but the jobs have/],
  ] as Array<[string, () => string, RegExp]>)("fails on %s, naming the difference", (_label, apply, expected) => {
    expect(workflowProblems(apply(), context).join("\n")).toMatch(expected);
  });

  it("fails when the engines.node floor of the root, or of any package, moves off the first Node leg", () => {
    expect(workflowProblems(text, { ...context, rootEnginesNode: ">=22.18.0" }).join("\n")).toMatch(/root manifest declares engines\.node ">=22\.18\.0"/);
    const moved = context.packages.map((pkg, index) => (index === 0 ? { ...pkg, enginesNode: ">=20.0.0" } : pkg));
    expect(workflowProblems(text, { ...context, packages: moved }).join("\n")).toMatch(/engines\.node ">=20\.0\.0"/);
  });

  it("the first Node leg is the engines.node floor of the root and of every package, and every other job runs on it", () => {
    for (const engines of [context.rootEnginesNode, ...context.packages.map((pkg) => pkg.enginesNode)]) {
      expect(engines).toBe(`>=${NODE_LEGS[0]}`);
    }
    expect(context.packages.length).toBe(PACKAGE_DIRS.length);
    expect(NODE_LEGS.map((leg: string) => Number(leg.split(".")[0]))).toEqual([22, 24, 26]);
    expect(NODE_LEGS.slice(1).every((leg: string) => /^\d+\.0\.0$/.test(leg))).toBe(true);
  });

  it("the registry's packages are the repository's published packages", () => {
    expect([...PACKAGE_DIRS].sort()).toEqual(workspacePackageDirs().sort());
    expect(publishablePackages().map((pkg: { dir: string }) => pkg.dir)).toEqual([...PACKAGE_DIRS]);
  });
});

describe("AC 42.3.4: the pins and the hygiene of the workflow", () => {
  it.each([
    ["an unpinned uses: (a tag)", () => mutate(text, CHECKOUT, "actions/checkout@v5"), /not pinned to its registered commit/],
    ["a uses: pinned to another commit", () => mutate(text, "fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0", "0000000000000000000000000000000000000000 # v5.1.0"), /not pinned to its registered commit/],
    ["a pinned uses: without its tag comment", () => mutate(text, `${CHECKOUT}\n        with:`, "actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09\n        with:"), /lacks its trailing tag comment/],
    ["an action that is not registered", () => mutate(text, "actions/setup-node@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0", "actions/cache@a0853c24544627f65ddf259abe73b1d18a591444 # v5.0.0"), /not a registered action/],
    ["another runner", () => mutate(text, "runs-on: ubuntu-24.04\n    timeout-minutes: 60", "runs-on: ubuntu-latest\n    timeout-minutes: 60"), /does not run on ubuntu-24\.04/],
    ["continue-on-error", () => mutate(text, "    timeout-minutes: 60\n", "    timeout-minutes: 60\n    continue-on-error: true\n"), /continue-on-error/],
    ["a || true", () => mutate(text, "        run: pnpm lint\n", "        run: pnpm lint || true\n"), /\|\| true/],
    ["a secrets reference", () => mutate(text, "      - name: install\n        run: pnpm install --frozen-lockfile\n      - name: build", "      - name: install\n        env:\n          TOKEN: ${{ secrets.NPM_TOKEN }}\n        run: pnpm install --frozen-lockfile\n      - name: build"), /secrets reference/],
    ["pull_request_target", () => mutate(text, "  pull_request:\n", "  pull_request_target:\n"), /pull_request_target|triggers/],
    ["wider permissions", () => mutate(text, "permissions:\n  contents: read\n", "permissions:\n  contents: write\n"), /not exactly contents: read/],
    ["a permission added", () => mutate(text, "permissions:\n  contents: read\n", "permissions:\n  contents: read\n  id-token: write\n"), /not exactly contents: read/],
    ["a job that widens the permissions", () => mutate(text, "    timeout-minutes: 30\n", "    timeout-minutes: 30\n    permissions:\n      contents: write\n"), /sets its own permissions/],
    ["the concurrency block removed", () => mutate(text, "concurrency:\n  group: ci-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}\n  cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}\n", ""), /concurrency block is missing/],
    ["a concurrency group that every run on main shares", () => mutate(text, "group: ci-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}", "group: ci-${{ github.ref }}"), /concurrency group is "ci-\$\{\{ github\.ref \}\}".*run on main needs a group of its own/],
    ["a concurrency group per commit on every ref", () => mutate(text, "group: ci-${{ github.ref == 'refs/heads/main' && github.sha || github.ref }}", "group: ci-${{ github.sha }}"), /concurrency group is "ci-\$\{\{ github\.sha \}\}"/],
    ["a concurrency that also cancels main", () => mutate(text, "cancel-in-progress: ${{ github.ref != 'refs/heads/main' }}", "cancel-in-progress: true"), /cancel-in-progress/],
    ["the sysctl step removed", () => mutate(text, "      - name: reserve the host ports of the throwaway containers\n        id: setup\n        run: sudo sysctl -w net.ipv4.ip_local_reserved_ports=52790,52791\n", ""), /sysctl steps, not 1/],
    ["a sysctl step that reserves 52773", () => mutate(text, "ip_local_reserved_ports=52790,52791", "ip_local_reserved_ports=52773,52791"), /reserves .*52773|belongs to the shared IRIS instance/],
    ["a sysctl step that reserves another port", () => mutate(text, "ip_local_reserved_ports=52790,52791", "ip_local_reserved_ports=52790,52792"), /reserves/],
    ["a floating image tag", () => mutate(text, "intersystems/irishealth-community:2026.2@sha256:462de1fb3597272fde0e03afad006af1b18b59c90f1c1fb5566c79b027a7af0a", "intersystems/irishealth-community:2026.2"), /not one of the harness's digest-pinned images/],
    ["a package install at @latest", () => mutate(text, "run: node scripts/ci-package-smoke.mjs", "run: npm install some-tool@latest && node scripts/ci-package-smoke.mjs"), /@latest/],
    ["npx -y", () => mutate(text, "run: node scripts/ci-package-smoke.mjs", "run: npx -y some-tool && node scripts/ci-package-smoke.mjs"), /npx -y/],
    ["an npm publish step", () => mutate(text, "run: node scripts/ci-package-smoke.mjs", "run: npm publish"), /publish, tag or push command/],
    ["a git push step", () => mutate(text, "run: node scripts/ci-package-smoke.mjs", "run: git push origin HEAD"), /publish, tag or push command/],
    ["a filtered push trigger", () => mutate(text, "on:\n  push:\n", "on:\n  push:\n    branches: [main]\n"), /push trigger is filtered/],
    ["a longer timeout", () => mutate(text, "timeout-minutes: 150", "timeout-minutes: 360"), /throwaway has timeout-minutes 360/],
    ["a secret after a hash inside a quoted value", () => mutate(text, "        run: pnpm lint\n", "        run: pnpm lint\n      - name: note\n        run: 'echo \"a #${{ secrets.TOKEN }}\"'\n"), /secrets reference/],
    ["a workflow env", () => mutate(text, "permissions:\n  contents: read\n", "env:\n  CI: false\npermissions:\n  contents: read\n"), /the workflow sets env/],
    ["a job defaults that replaces the shell", () => mutate(text, "    timeout-minutes: 60\n", '    timeout-minutes: 60\n    defaults:\n      run:\n        shell: "true {0}"\n'), /job gates sets defaults/],
    ["a step shell", () => mutate(text, "        run: pnpm lint\n", '        run: pnpm lint\n        shell: "true {0}"\n'), /the step "pnpm lint" sets shell/],
    ["a matrix exclude that drops a leg", () => mutate(text, '        node: ["22.17.0", "24.0.0", "26.0.0"]\n', '        node: ["22.17.0", "24.0.0", "26.0.0"]\n        exclude:\n          - node: "26.0.0"\n'), /the gates matrix sets exclude/],
    ["another strategy setting", () => mutate(text, "      fail-fast: false\n", "      fail-fast: false\n      max-parallel: 1\n"), /the gates strategy sets max-parallel/],
    ["a strategy on another job", () => mutate(text, "    timeout-minutes: 30\n", '    timeout-minutes: 30\n    strategy:\n      matrix:\n        node: ["22.17.0"]\n'), /job package has a strategy/],
    ["a checkout of another ref", () => mutate(text, `${CHECKOUT}\n        with:\n          persist-credentials: false\n`, `${CHECKOUT}\n        with:\n          persist-credentials: false\n          ref: main\n`), /the inputs of actions\/checkout sets ref/],
  ] as Array<[string, () => string, RegExp]>)("fails on %s", (_label, apply, expected) => {
    expect(workflowProblems(apply(), context).join("\n")).toMatch(expected);
  });

  it("a hygiene token that only appears in a comment is not a finding", () => {
    expect(workflowProblems(mutate(text, "name: ci\n", "# secrets, continue-on-error and || true are never used, and nothing here runs npm publish\nname: ci\n"), context)).toEqual([]);
  });

  it("the registry and the harness agree on the images: every image the registry's commands name is one of the digest constants", () => {
    expect([...CI_IMAGES]).toEqual([IRIS_COMMUNITY_IMAGE, OLDEST_IRIS_COMMUNITY_IMAGE, IRISHEALTH_COMMUNITY_IMAGE]);
    for (const image of CI_IMAGES) expect(validateImage(image)).toBe(image);
    const named = JSON.stringify([LIVE_SUITES, DECLARED_STEPS]).match(/intersystems\/[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)?(?:@sha256:[0-9a-f]{64})?/g) ?? [];
    expect(named.length).toBeGreaterThan(0);
    for (const image of named) expect(CI_IMAGES, image).toContain(image);
  });

  it("the packageManager is an exact pnpm version, and the bootstrap-guard suites publish the guard host port", () => {
    expect(context.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/);
    for (const id of HARNESS_SUITE_IDS) {
      const command: string[] = LIVE_SUITES[id].command;
      expect(command[command.indexOf("--host-port") + 1], id).toBe("52790");
    }
  });
});

describe("AC 42.3.5 / DW-443: no tarball is built from a red commit, and every prepublishOnly is run", () => {
  it("fails when the package job does not need the throwaway job, or the gates job", () => {
    expect(workflowProblems(mutate(text, "needs: [gates, throwaway]", "needs: [gates]"), context).join("\n")).toMatch(/package job does not need throwaway/);
    expect(workflowProblems(mutate(text, "needs: [gates, throwaway]", "needs: [throwaway]"), context).join("\n")).toMatch(/package job does not need gates/);
    expect(workflowProblems(mutate(text, "    needs: [gates, throwaway]\n", ""), context).join("\n")).toMatch(/package job does not need/);
  });

  it("fails when a job has a condition of its own, which could run the package job after a red job, or skip a job", () => {
    expect(workflowProblems(mutate(text, "    needs: [gates, throwaway]\n", "    needs: [gates, throwaway]\n    if: ${{ always() }}\n"), context).join("\n")).toMatch(/job package has its own if/);
    expect(workflowProblems(mutate(text, "    name: throwaway\n", "    name: throwaway\n    if: ${{ github.event_name == 'push' }}\n"), context).join("\n")).toMatch(/job throwaway has its own if/);
    expect(workflowProblems(mutate(text, `${CHECKOUT}\n        with:`, `${CHECKOUT}\n        if: false\n        with:`), context).join("\n")).toMatch(/the step actions\/checkout@\S+ has an if: condition/);
  });

  it("fails when a package has a prepublishOnly that no suite step runs", () => {
    const extra: PackageFacts = { dir: "iris-new-mcp", short: "new", enginesNode: ">=22.17.0", prepublishOnly: "node scripts/prepublish-gate.mjs" };

    expect(workflowProblems(text, { ...context, packages: [...context.packages, extra] }).join("\n")).toMatch(/iris-new-mcp has a prepublishOnly but the workflow has no prepublish-new step/);
    expect(workflowProblems(mutate(text, "ci-live-suite.mjs prepublish-ops", "ci-live-suite.mjs prepublish-op"), context).join("\n")).toMatch(/prepublish-ops step/);
  });

  it("every package that has a prepublishOnly has its prepublish suite, as a vitest suite when it has a gate script", () => {
    for (const pkg of context.packages.filter((candidate) => candidate.prepublishOnly !== undefined)) {
      const suite = LIVE_SUITES[`prepublish-${pkg.short}`];
      expect(suite, `prepublish-${pkg.short}`).toBeDefined();
      expect(suite.command).toEqual(["pnpm", "run", "prepublishOnly"]);
      expect(suite.cwd).toBe(`packages/${pkg.dir}`);
      expect(suite.kind).toBe(existsSync(path.join(PACKAGES_DIR, pkg.dir, "scripts", "prepublish-gate.mjs")) ? "vitest" : "plain");
    }
    expect(Object.keys(LIVE_SUITES).filter((id) => id.startsWith("prepublish-")).length).toBe(8);
  });

  it("the throwaway job runs its logs on failure or cancel and its down on always, after the suites", () => {
    const runs = (DECLARED_STEPS.throwaway as Array<{ run: string; if?: string }>).map((step) => step.run);
    expect(runs.findIndex((run) => run.includes("throwaway-iris.mjs logs"))).toBeGreaterThan(runs.findIndex((run) => run.includes("ci-live-suite.mjs launcher-live")));
    expect(runs[runs.length - 1]).toContain("throwaway-iris.mjs down");
    expect(workflowProblems(mutate(text, '"${{ always() }}"', '"${{ success() }}"'), context).join("\n")).toMatch(/down step does not run on always/);
    expect(workflowProblems(mutate(text, '"${{ failure() || cancelled() }}"', '"${{ failure() }}"'), context).join("\n")).toMatch(/logs step does not run on failure/);
  });
});

describe("DW-676: every armed file runs in a suite, and a skip is never silent", () => {
  const covered = new Set<string>(coveredTestFiles());

  it("every package with scripts/prepublish-gate.mjs has a suite that expects its whole roster", () => {
    const withScript = workspacePackageDirs().filter((dir: string) => existsSync(path.join(PACKAGES_DIR, dir, "scripts", "prepublish-gate.mjs")));
    expect(withScript.length).toBeGreaterThanOrEqual(4);
    for (const dir of withScript) {
      const roster = readRoster(path.join(PACKAGES_DIR, dir));
      expect(roster.length, dir).toBeGreaterThan(0);
      const suites = Object.values(LIVE_SUITES) as Array<{ cwd: string; kind: string; expectedFiles: () => string[] }>;
      const suite = suites.find((candidate) => candidate.cwd === `packages/${dir}` && candidate.kind === "vitest" && candidate.expectedFiles().includes(`packages/${dir}/${roster[0]}`));
      expect(suite, `${dir} has a prepublish suite`).toBeDefined();
      expect((suite as { expectedFiles: () => string[] }).expectedFiles()).toEqual(roster.map((file: string) => `packages/${dir}/${file}`));
    }
  });

  it("every vitest.integration.config.ts has an integration suite that expects every *.integration.test.ts of its package", () => {
    const withConfig = workspacePackageDirs().filter((dir: string) => existsSync(path.join(PACKAGES_DIR, dir, "vitest.integration.config.ts")));
    expect(withConfig.length).toBe(6);
    for (const dir of withConfig) {
      const short = readJson<{ name: string }>(path.join(PACKAGES_DIR, dir, "package.json")).name.replace(/^@iris-mcp\//, "");
      const suite = LIVE_SUITES[`integration-${short}`];
      expect(suite, `integration-${short}`).toBeDefined();
      expect(suite.command.slice(-2)).toEqual(["--config", "vitest.integration.config.ts"]);
      const onDisk = (directory: string): string[] =>
        readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
          entry.isDirectory() ? onDisk(path.join(directory, entry.name)) : entry.name.endsWith(".integration.test.ts") ? [relativeToRepo(path.join(directory, entry.name))] : [],
        );
      expect(suite.expectedFiles(), dir).toEqual(onDisk(path.join(PACKAGES_DIR, dir, "src")).sort());
    }
  });

  it("the five process gates and the launcher's two live files are covered, and the bootstrap-guard gate is covered by both guard suites", () => {
    expect(PROCESS_GATE_FILES.length).toBe(5);
    expect(LAUNCHER_LIVE_FILES.length).toBe(2);
    for (const file of [...PROCESS_GATE_FILES, ...LAUNCHER_LIVE_FILES]) {
      expect(existsSync(path.join(REPO_ROOT, file)), file).toBe(true);
      expect(covered.has(file), file).toBe(true);
    }
    const guard = "packages/iris-mcp-all/src/__tests__/story-42-2-bootstrap-guard-live-gate.test.ts";
    expect(LIVE_SUITES["bootstrap-guard"].expectedFiles()).toEqual([guard]);
    expect(LIVE_SUITES["bootstrap-guard-oldest"].expectedFiles()).toEqual([guard]);
  });

  it("every live-capable test file is in a suite or in a reasoned exemption", () => {
    const exempt = new Set<string>(CI_LIVE_EXEMPTIONS.map((entry: { file: string }) => entry.file));
    const live: string[] = liveCapableTestFiles().map(relativeToRepo);
    expect(live.length).toBeGreaterThan(60);
    expect(live.filter((file) => !covered.has(file) && !exempt.has(file)), "live-capable files that no CI suite runs").toEqual([]);
  });

  it("every exemption names an existing live-capable file that no suite runs, with a reason", () => {
    const live = new Set<string>(liveCapableTestFiles().map(relativeToRepo));
    for (const { file, reason } of CI_LIVE_EXEMPTIONS as ReadonlyArray<{ file: string; reason: string }>) {
      expect(existsSync(path.join(REPO_ROOT, file)), `${file} exists`).toBe(true);
      expect(live.has(file), `${file} is still live-capable (else drop the exemption)`).toBe(true);
      expect(coveredTestFiles().includes(file), `${file} is now in a suite (else drop the exemption)`).toBe(false);
      expect(reason.trim().length, `${file} has a reason`).toBeGreaterThan(30);
    }
  });

  it("every allowlisted skip names an existing file, a test title that is in it, and a reason", () => {
    const entries = (Object.entries(LIVE_SUITES) as Array<[string, { expectedFiles: () => string[]; allowedSkips: Array<{ file: string; test: string; reason: string }> }]>).flatMap(([id, suite]) =>
      suite.allowedSkips.map((entry) => ({ id, suite, ...entry })),
    );
    expect(entries.length, "the 4 capture legs and the 9 DocDB lifecycle tests").toBe(13);
    expect(entries.filter(({ id }) => id === "integration-data").length, "the DocDB lifecycle of data.integration.test.ts, all of it").toBe(9);
    for (const { id, suite, file, test, reason } of entries) {
      expect(existsSync(path.join(REPO_ROOT, file)), `${id}: ${file} exists`).toBe(true);
      expect(suite.expectedFiles(), `${id}: ${file} is a file the suite runs`).toContain(file);
      expect(reason.trim().length, `${id}: ${test} has a reason`).toBeGreaterThan(30);
      const source = readFileSync(path.join(REPO_ROOT, file), "utf8");
      const titles = [...source.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((match) => match[1] as string);
      expect(titles.some((title) => test.endsWith(` ${title}`)), `${id}: no test of ${file} is titled the end of "${test}"`).toBe(true);
    }
  });

  it("a scratch file whose source resolves a live target is live-capable, and a finding while no suite runs it", () => {
    const exempt = new Set<string>(CI_LIVE_EXEMPTIONS.map((entry: { file: string }) => entry.file));
    const scratch = "packages/iris-mcp-all/src/__tests__/scratch-live-capable.test.ts";
    // Joined at run time, so that this file's own text does not hold the call the scan looks for.
    const sources: Record<string, string> = { [scratch]: ["const target = liveGateTarget", "(process.env);\n"].join("") };
    const read = (file: string): string => sources[file] ?? readFileSync(path.join(REPO_ROOT, file), "utf8");

    const live = [...liveCapableTestFiles().map(relativeToRepo), scratch].filter((file) => LIVE_CAPABLE.test(read(file)));
    expect(live.filter((file) => !covered.has(file) && !exempt.has(file))).toEqual([scratch]);
  });

  it("no armed file decides a skip at collection from a binding a hook sets: no skipIf or runIf condition reads a let (DW-681)", () => {
    const found = coveredTestFiles().flatMap((file: string) => collectionTimeConditions(readFileSync(path.join(REPO_ROOT, file), "utf8")).map((what) => `${file}: ${what}`));
    expect(found).toEqual([]);
  });

  it("the collection-time scan finds a skipIf whose condition reads a let that a hook sets, and passes a constant", () => {
    const source = 'let ready = false;\nbeforeAll(() => { ready = true; });\nit.skipIf(!ready)("leg", () => {});\nconst FIXED = true;\nit.runIf(FIXED)("other", () => {});\n';
    expect(collectionTimeConditions(source)).toEqual(["skipIf(!ready) reads let ready"]);
  });

  it("only the registry's suites skip nothing: no suite lists an allowlist entry for a file it does not expect", () => {
    for (const [id, suite] of Object.entries(LIVE_SUITES) as Array<[string, { kind: string; expectedFiles: () => string[]; allowedSkips: Array<{ file: string }> }]>) {
      if (suite.kind === "plain") expect(suite.expectedFiles(), id).toEqual([]);
      for (const entry of suite.allowedSkips) expect(suite.expectedFiles(), id).toContain(entry.file);
    }
  });
});

describe("Rule #56: every root script that checks the tree is a gates step or a reasoned exemption", () => {
  /** Root scripts that check the tree but are not gates, each with the reason. */
  const ROOT_SCRIPT_EXEMPTIONS: Record<string, string> = {
    "format:check": "prettier --check . does not pass on the tree today, so it is not a gate",
  };

  /** The names of the root scripts that check the tree (a `check` or `validate` word in the name, lifecycle hooks left out). */
  const checkScripts = (scripts: Record<string, string>): string[] =>
    Object.keys(scripts).filter((name) => /(^|:)(check|validate)(:|$)/.test(name) && !/^(pre|post)/.test(name));

  /** The check scripts that the gates job does not run and no exemption excuses. */
  const uncovered = (scripts: Record<string, string>): string[] => {
    const gateRuns = new Set((DECLARED_STEPS.gates as Array<{ run: string }>).map((step) => step.run));
    return checkScripts(scripts).filter((name) => !gateRuns.has(`pnpm ${name}`) && !(name in ROOT_SCRIPT_EXEMPTIONS));
  };

  const rootScripts = readJson<{ scripts: Record<string, string> }>(path.join(REPO_ROOT, "package.json")).scripts;

  it("finds no check script that the gates job leaves out", () => {
    expect(checkScripts(rootScripts).length, "the scan finds the gates").toBeGreaterThanOrEqual(7);
    expect(uncovered(rootScripts)).toEqual([]);
  });

  it("finds a new check script that no gates step runs", () => {
    expect(uncovered({ ...rootScripts, "check:new-gate": "node scripts/check-new-gate.mjs", "gen:thing:check": "node scripts/gen-thing.mjs --check" })).toEqual(["check:new-gate", "gen:thing:check"]);
  });

  it("every exemption names a script that still exists, with a reason", () => {
    for (const [name, reason] of Object.entries(ROOT_SCRIPT_EXEMPTIONS)) {
      expect(checkScripts(rootScripts), `${name} is a root check script`).toContain(name);
      expect(reason.trim().length, `${name} has a reason`).toBeGreaterThan(20);
    }
  });
});

describe("the 42.1 package checks run in the default suite of @iris-mcp/all (AC 42.3.1)", () => {
  /** A glob with `**` and `*`, as the vitest include and exclude lists use them. */
  function globToRegExp(glob: string): RegExp {
    const source = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*\//g, "\u0000")
      .replace(/\*\*/g, "\u0001")
      .replace(/\*/g, "[^/]*")
      .replace(/\u0000/g, "(?:.*/)?")
      .replace(/\u0001/g, ".*");
    return new RegExp(`^${source}$`);
  }

  const include = (vitestConfig as { test: { include: string[]; exclude: string[] } }).test.include;
  const exclude = (vitestConfig as { test: { include: string[]; exclude: string[] } }).test.exclude;
  const runs = (file: string): boolean => include.some((glob) => globToRegExp(glob).test(file)) && !exclude.some((glob) => globToRegExp(glob).test(file));

  it.each(["release-1-0-0-mechanism", "package-manifests", "published-tarballs", "npx-pin"])("%s.test.ts exists and is inside the include and outside the exclude", (name) => {
    const file = `src/__tests__/${name}.test.ts`;

    expect(existsSync(path.join(PACKAGES_DIR, "iris-mcp-all", file))).toBe(true);
    expect(runs(file), file).toBe(true);
  });

  // The checks that only the 22.17.0 and 24.0.0 legs of `gates` would otherwise catch: a script's `.ts` import, a link removed by `rmSync`.
  it.each(["script-ts-imports", "symlink-removal"])("%s.test.ts, a floor-leg check, exists and is inside the include and outside the exclude", (name) => {
    const file = `src/__tests__/${name}.test.ts`;

    expect(existsSync(path.join(PACKAGES_DIR, "iris-mcp-all", file))).toBe(true);
    expect(runs(file), file).toBe(true);
  });

  it("the include and exclude matcher tells the default suite from an integration file", () => {
    expect(runs("src/__tests__/anything.test.ts")).toBe(true);
    expect(runs("src/__tests__/anything.integration.test.ts")).toBe(false);
    expect(runs("scripts/anything.test.ts")).toBe(false);
  });
});

describe("the README documents the CI (Story 42.3)", () => {
  const readme = readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
  const section = /^### Continuous Integration$[\s\S]*?(?=^#{1,3} |(?![\s\S]))/m.exec(readme)?.[0] ?? "";

  it("has a Continuous Integration section under Contributing that names each job and every Node leg", () => {
    expect(section, "the README has a ### Continuous Integration section").not.toBe("");
    expect(readme.indexOf("## Contributing")).toBeGreaterThan(-1);
    expect(readme.indexOf("### Continuous Integration")).toBeGreaterThan(readme.indexOf("## Contributing"));
    for (const job of Object.keys(DECLARED_STEPS)) expect(section, job).toContain(`\`${job}\``);
    for (const leg of NODE_LEGS) expect(section, leg).toContain(leg);
  });

  it("states the images and namespaces, that the workflow is secret-free, the fail-on-skip rule and the guard's Docker need", () => {
    expect(section).toContain("iris-community");
    expect(section).toContain("irishealth-community");
    expect(section).toContain("HSCUSTOM");
    expect(section).toContain("USER");
    expect(section).toMatch(/secret-free/);
    expect(section).toMatch(/publishes, tags and releases nothing/);
    expect(section).toMatch(/skipped/);
    expect(section).toMatch(/allowedSkips/);
    expect(section).toMatch(/pnpm live:bootstrap-guard/);
    expect(section).toMatch(/Docker/);
    expect(section).toMatch(/removes its own container/);
  });
});
