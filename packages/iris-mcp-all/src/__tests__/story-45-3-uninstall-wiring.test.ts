/**
 * Story 45.3 (AC 45.3.6; Rule #59) - the wiring of the uninstall round-trip gate, which no default-suite run exercises end to end (it needs
 * Docker and an IRIS image; CI's `uninstall-round-trip` suite and `pnpm live:uninstall-round-trip` run it).
 *
 * Left unpinned, the gate could be a dead check: a suite that the workflow never runs, a workflow step that does not hand the gate its state
 * file, a root script that names a renamed file, or an arming that nothing sets. Each is pinned here against the registry (`ci-checks.mjs`),
 * the workflow text and the gate's own source, with a mutation of the workflow for each defect that must fail the registry-vs-workflow check.
 *
 * Reads documents and calls pure functions: no docker, no IRIS.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CI_HOST_PORTS,
  DECLARED_STEPS,
  HARNESS_SUITE_IDS,
  LIVE_SUITES,
  OWN_CONTAINER_SUITE_IDS,
  SEEDED_SUITE_IDS,
  UNINSTALL_GATE_FILE,
  coveredTestFiles,
} from "../../../../scripts/lib/ci-checks.mjs";
import { NAMED_EXEMPTIONS, armedTestFiles, isNamedExemption, readRoster } from "../../../../scripts/lib/live-gate-scan.mjs";
import { IRISHEALTH_COMMUNITY_IMAGE, parseCli } from "../../../../scripts/throwaway-iris.mjs";
import { PACKAGES_DIR, REPO_ROOT, workspacePackageDirs } from "../../../../scripts/lib/live-gate-scan.mjs";
import { workflowProblems, type PackageFacts, type WorkflowContext } from "./ci-workflow-check";
import { throwawayGatePlan } from "./bootstrap-guard-legs.js";

const text = readFileSync(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
const gateSource = readFileSync(path.join(REPO_ROOT, UNINSTALL_GATE_FILE), "utf8");
const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;

function realContext(): WorkflowContext {
  const root = readJson<{ engines?: { node?: string }; packageManager?: string }>(path.join(REPO_ROOT, "package.json"));
  const packages: PackageFacts[] = workspacePackageDirs().map((dir: string) => {
    const manifest = readJson<{ name: string; engines?: { node?: string }; scripts?: Record<string, string> }>(path.join(PACKAGES_DIR, dir, "package.json"));
    return { dir, short: manifest.name.replace(/^@iris-mcp\//, ""), enginesNode: manifest.engines?.node, prepublishOnly: manifest.scripts?.prepublishOnly };
  });
  return { rootEnginesNode: root.engines?.node, packageManager: root.packageManager, packages };
}
const context = realContext();

/** `source` with the one occurrence of `from` replaced; it fails when `from` is not in the text exactly once, so a mutation cannot change nothing. */
function mutate(source: string, from: string, to: string): string {
  expect(source.split(from).length - 1, `the text to replace occurs once: ${from.slice(0, 70)}`).toBe(1);
  return source.replace(from, to);
}

const STATE = "${{ runner.temp }}/throwaway-uninstall.json";
const SUITE_STEP = `        run: THROWAWAY_STATE_FILE=${STATE} node scripts/throwaway-iris.mjs exec --state ${STATE} -- node scripts/ci-live-suite.mjs uninstall-round-trip\n`;
const UP_STEP = `--namespace USER --host-port 52790 --state ${STATE}\n`;

describe("the registry: the suite uninstall-round-trip", () => {
  const suite = LIVE_SUITES["uninstall-round-trip"] as {
    kind: string;
    cwd: string;
    command: string[];
    expectedFiles: () => string[];
    allowedSkips: unknown[];
  };

  it("is an own-container suite that runs the gate file with vitest and allows no skip", () => {
    expect(suite).toBeDefined();
    expect(suite.kind).toBe("own-container");
    expect(suite.cwd).toBe("packages/iris-mcp-all");
    expect(suite.command).toEqual(["pnpm", "exec", "vitest", "run", "src/__tests__/story-45-3-uninstall-round-trip-live-gate.test.ts"]);
    expect(suite.expectedFiles()).toEqual([UNINSTALL_GATE_FILE]);
    expect(existsSync(path.join(REPO_ROOT, UNINSTALL_GATE_FILE))).toBe(true);
    expect(suite.allowedSkips).toEqual([]);
  });

  it("is in neither the seeded rosters nor the bootstrap-guard harness suites, and the gate file is covered", () => {
    expect([...OWN_CONTAINER_SUITE_IDS]).toEqual(["uninstall-round-trip"]);
    expect([...SEEDED_SUITE_IDS]).not.toContain("uninstall-round-trip");
    expect([...HARNESS_SUITE_IDS]).not.toContain("uninstall-round-trip");
    expect(coveredTestFiles()).toContain(UNINSTALL_GATE_FILE);
  });

  it("the gate is an armed gate that sits on no package roster, by a named exemption", () => {
    const file = "src/__tests__/story-45-3-uninstall-round-trip-live-gate.test.ts";
    expect(armedTestFiles(path.join(PACKAGES_DIR, "iris-mcp-all"))).toContain(file);
    expect(readRoster(path.join(PACKAGES_DIR, "iris-mcp-all"))).not.toContain(file);
    expect(isNamedExemption("iris-mcp-all", file)).toBe(true);
    expect((NAMED_EXEMPTIONS as Array<{ file: string; reason: string }>).find((entry) => entry.file === file)?.reason).toContain("THROWAWAY_STATE_FILE");
  });
});

describe("the workflow: the four steps of the uninstall container, last in the throwaway job", () => {
  const steps = DECLARED_STEPS["throwaway"] as Array<{ run: string; if?: string; id?: string }>;
  const tail = steps.slice(-4);

  it("declares up on the guard port, the suite through exec with the state file in its environment, then logs and down", () => {
    expect(tail.map((step) => step.run)).toEqual([
      `node scripts/throwaway-iris.mjs up --image ${IRISHEALTH_COMMUNITY_IMAGE} --namespace USER --host-port ${CI_HOST_PORTS.guard} --state ${STATE}`,
      `THROWAWAY_STATE_FILE=${STATE} node scripts/throwaway-iris.mjs exec --state ${STATE} -- node scripts/ci-live-suite.mjs uninstall-round-trip`,
      `node scripts/throwaway-iris.mjs logs --state ${STATE}`,
      `node scripts/throwaway-iris.mjs down --state ${STATE}`,
    ]);
    expect(tail[0]?.id).toBe("uninstall");
    expect(tail[1]?.if).toContain("steps.uninstall.outcome == 'success'");
    expect(tail[2]?.if).toBe("${{ failure() || cancelled() }}");
    expect(tail[3]?.if).toBe("${{ always() }}");
  });

  it("the real ci.yml has the same steps (the workflow check holds it equal to the registry)", () => {
    expect(workflowProblems(text, context)).toEqual([]);
    expect(text).toContain(SUITE_STEP);
    expect(text).toContain(UP_STEP);
  });

  it.each([
    ["the suite step removed", () => mutate(text, SUITE_STEP, "        run: node scripts/ci-package-smoke.mjs\n"), /uninstall-round-trip|declared step is not in the workflow/],
    ["the state file not handed to the gate", () => mutate(text, SUITE_STEP, SUITE_STEP.replace(`THROWAWAY_STATE_FILE=${STATE} `, "")), /declared step is not in the workflow.*ci-live-suite\.mjs uninstall-round-trip/],
    ["the container started on another port", () => mutate(text, UP_STEP, UP_STEP.replace("52790", "52791")), /declared step is not in the workflow.*throwaway-uninstall/],
    ["the container started in HSCUSTOM", () => mutate(text, UP_STEP, UP_STEP.replace("--namespace USER", "--namespace HSCUSTOM")), /declared step is not in the workflow.*throwaway-uninstall/],
    ["a suite step that renames the suite", () => mutate(text, "ci-live-suite.mjs uninstall-round-trip", "ci-live-suite.mjs uninstall-round-trips"), /suites the throwaway job runs/],
  ] as Array<[string, () => string, RegExp]>)("fails on %s, naming the difference", (_label, apply, expected) => {
    expect(workflowProblems(apply(), context).join("\n")).toMatch(expected);
  });
});

describe("the root script and the gate's arming", () => {
  const script = readJson<{ scripts?: Record<string, string> }>(path.join(REPO_ROOT, "package.json")).scripts?.["live:uninstall-round-trip"] ?? "";

  it("the root script starts a throwaway on the pinned IRIS for Health image in USER, runs the gate through exec with the state file, and always removes the container", () => {
    expect(script).toContain(`node scripts/throwaway-iris.mjs up --image ${IRISHEALTH_COMMUNITY_IMAGE} --namespace USER --host-port 52792 --state "$S"`);
    expect(script).toContain('THROWAWAY_STATE_FILE="$S" node scripts/throwaway-iris.mjs exec --state "$S" -- pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-45-3-uninstall-round-trip-live-gate.test.ts');
    expect(script).toContain('R=$?; node scripts/throwaway-iris.mjs down --state "$S"; exit $R');
    expect(script, "the harness parses the up command").not.toBe("");
    const upArgs = /node scripts\/throwaway-iris\.mjs (up .*?--state "\$S")/.exec(script)?.[1]?.split(/\s+/).slice(1).map((token) => token.replace(/"\$S"/, "state.json")) ?? [];
    expect(parseCli(["up", ...upArgs]).image).toBe(IRISHEALTH_COMMUNITY_IMAGE);
  });

  it("the gate arms on the throwaway plan AND the state file, skips with a reason otherwise, and drives the terminal through the harness's session command", () => {
    expect(gateSource).toMatch(/^const PLAN = throwawayGatePlan\(process\.env\);$/m);
    expect(gateSource).toContain('process.env["THROWAWAY_STATE_FILE"]');
    expect(gateSource).toContain('"session", "--state", STATE_FILE, "--namespace", ns, "--script", file');
    expect(throwawayGatePlan({}).run, "without IRIS_THROWAWAY the plan does not run").toBe(false);
  });

  it("the gate never targets the shared instance: it validates the port, the host and the container before any write", () => {
    expect(gateSource).toContain("validateHostPort(target.port)");
    expect(gateSource).toContain("assertThrowawayInspect(");
    expect(gateSource).toContain("await assertNoExecuteMcpClasses(target)");
    expect(gateSource).not.toMatch(/52773|iris-community-edition/);
  });
});
