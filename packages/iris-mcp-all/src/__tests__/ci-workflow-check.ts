/**
 * The checks that hold `.github/workflows/ci.yml` equal to the code-declared registry (`scripts/lib/ci-checks.mjs`), as one pure
 * function over the workflow text, so the self-test (`ci-workflow.test.ts`) runs the same checks over the real file and over
 * mutations of it, and the mutations show each check can fail (Rule #59).
 *
 * `workflowProblems(text, context)` returns what is wrong with the text. Its checks, with the acceptance criterion each serves:
 *  - STEPS (42.3.1): per job, the `run` steps equal the registry's, in both directions, duplicates kept; the jobs are the registry's;
 *    the suite ids the workflow runs are the registry's.
 *  - PINS (42.3.4): every `uses:` is a registered action at its registered commit with its tag in a trailing comment; every job
 *    runs on the registered runner; every `intersystems/` image is one of the harness's digest constants; no `@latest`, no `npx -y`.
 *  - MATRIX (42.3.1): the Node legs are the registry's, the first is the `engines.node` floor of the root and of every package, the
 *    others rise by 2 from it, `gates` runs each leg (its setup-node uses `matrix.node`), and every other job uses the floor.
 *  - HYGIENE (42.3.4, 42.3.5), over the text without comments: no `continue-on-error`, `|| true`, secret, `pull_request_target`
 *    or publish, tag or push command; no job and no action step has an `if`; the permissions are exactly `contents: read` and no
 *    job widens them; the concurrency
 *    cancels except on main; the sysctl step reserves exactly the registry's host ports and none is refused; `logs` runs on
 *    `failure() || cancelled()` and `down` on `always()`; the jobs' timeouts are the registry's.
 *  - DW-443 (42.3.5): `package` needs `gates` and `throwaway`, and every package with a `prepublishOnly` has its suite step.
 */

import { parse } from "yaml";
import {
  CI_HOST_PORTS,
  CI_IMAGES,
  DECLARED_STEPS,
  JOB_TIMEOUT_MINUTES,
  LIVE_SUITES,
  NODE_LEGS,
  PINNED_ACTIONS,
  RUNNER,
} from "../../../../scripts/lib/ci-checks.mjs";
import { REFUSED_HOST_PORTS } from "../../../../scripts/throwaway-iris.mjs";

/** One package manifest, as the checks need it. */
export interface PackageFacts {
  dir: string;
  /** The short name suites use (`admin` for `@iris-mcp/admin`). */
  short: string;
  /** `engines.node`, as written. */
  enginesNode: string | undefined;
  /** The `prepublishOnly` script, when there is one. */
  prepublishOnly: string | undefined;
}

/** What the checks compare the workflow with. */
export interface WorkflowContext {
  /** The root manifest's `engines.node`. */
  rootEnginesNode: string | undefined;
  /** The root manifest's `packageManager`. */
  packageManager: string | undefined;
  /** Every `packages/*` manifest. */
  packages: PackageFacts[];
}

/** A step of the workflow, reduced to what the registry declares. */
interface DeclaredStep {
  run: string;
  workingDirectory?: string;
  if?: string;
  id?: string;
}

/** The text without YAML comments (a `#` at the start of a line or after whitespace, to the end of the line). */
export function stripComments(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(/(^|\s)#.*$/, "$1"))
    .join("\n");
}

/** The `run` steps of a job, reduced to the registry's shape and key order. */
function runStepsOf(job: { steps?: Array<Record<string, unknown>> }): DeclaredStep[] {
  return (job.steps ?? [])
    .filter((step) => typeof step["run"] === "string")
    .map((step) => ({
      run: step["run"] as string,
      ...(typeof step["working-directory"] === "string" ? { workingDirectory: step["working-directory"] } : {}),
      ...(typeof step["if"] === "string" ? { if: step["if"] } : {}),
      ...(typeof step["id"] === "string" ? { id: step["id"] } : {}),
    }));
}

const describeStep = (step: DeclaredStep | undefined): string => (step === undefined ? "(none)" : JSON.stringify(step));

/** Compare a job's steps with the declared ones: dropped and undeclared steps by name, then the first difference in order. */
function stepProblems(job: string, actual: DeclaredStep[], declared: readonly DeclaredStep[]): string[] {
  const problems: string[] = [];
  const key = (step: DeclaredStep): string => JSON.stringify([step.run, step.workingDirectory ?? "", step.if ?? "", step.id ?? ""]);
  const remaining = new Map<string, number>();
  for (const step of actual) remaining.set(key(step), (remaining.get(key(step)) ?? 0) + 1);
  for (const step of declared) {
    const left = remaining.get(key(step)) ?? 0;
    if (left === 0) problems.push(`${job}: the declared step is not in the workflow (dropped or changed): ${describeStep(step)}`);
    else remaining.set(key(step), left - 1);
  }
  const extra = new Map<string, number>();
  for (const step of declared) extra.set(key(step), (extra.get(key(step)) ?? 0) + 1);
  for (const step of actual) {
    const left = extra.get(key(step)) ?? 0;
    if (left === 0) problems.push(`${job}: the workflow has a step the registry does not declare: ${describeStep(step)}`);
    else extra.set(key(step), left - 1);
  }
  if (problems.length === 0) {
    const at = actual.findIndex((step, index) => key(step) !== key(declared[index] as DeclaredStep));
    if (at >= 0) problems.push(`${job}: step ${at + 1} is out of order: ${describeStep(actual[at])}, the registry declares ${describeStep(declared[at])}`);
  }
  return problems;
}

/** The numbers of a version such as `22.17.0` or `>=22.17.0`. */
function versionOf(text: string | undefined): string | undefined {
  return text === undefined ? undefined : /(\d+\.\d+\.\d+)/.exec(text)?.[1];
}

/** What is wrong with the workflow text. An empty list means it is the registry's workflow. */
export function workflowProblems(text: string, context: WorkflowContext): string[] {
  let workflow: Record<string, any>;
  try {
    workflow = parse(text) as Record<string, any>;
  } catch (error) {
    return [`ci.yml does not parse as YAML: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (workflow === null || typeof workflow !== "object" || typeof workflow["jobs"] !== "object") return ["ci.yml has no jobs."];
  const problems: string[] = [];
  const bare = stripComments(text);
  const jobs = workflow["jobs"] as Record<string, any>;

  // STEPS
  const declaredJobs = Object.keys(DECLARED_STEPS);
  if (JSON.stringify(Object.keys(jobs)) !== JSON.stringify(declaredJobs)) {
    problems.push(`the jobs are ${Object.keys(jobs).join(", ")}, the registry declares ${declaredJobs.join(", ")}`);
  }
  for (const job of declaredJobs) {
    if (jobs[job] === undefined) continue;
    problems.push(...stepProblems(job, runStepsOf(jobs[job]), (DECLARED_STEPS as Record<string, DeclaredStep[]>)[job] as DeclaredStep[]));
  }
  const usedSuites = [...(JSON.stringify(jobs["throwaway"] ?? {}).matchAll(/ci-live-suite\.mjs ([A-Za-z0-9-]+)/g))].map((match) => match[1] as string).sort();
  const registrySuites = Object.keys(LIVE_SUITES).sort();
  if (JSON.stringify(usedSuites) !== JSON.stringify(registrySuites)) {
    problems.push(`the suites the throwaway job runs (${usedSuites.join(", ")}) are not the registry's (${registrySuites.join(", ")})`);
  }

  // PINS
  const pinned = new Map(PINNED_ACTIONS.map((entry: { action: string; sha: string; tag: string }) => [entry.action, entry]));
  const usesLines = text.split("\n").filter((line) => /^\s*-?\s*uses:/.test(line));
  const usesInJobs = Object.values(jobs).flatMap((job) => ((job as { steps?: Array<{ uses?: string }> }).steps ?? []).filter((step) => step.uses !== undefined));
  if (usesLines.length !== usesInJobs.length) problems.push(`the text has ${usesLines.length} uses: lines but the jobs have ${usesInJobs.length} uses steps`);
  for (const line of usesLines) {
    const match = /^\s*-?\s*uses:\s*([^\s@#]+)@(\S+?)\s*(?:#\s*(\S+))?\s*$/.exec(line);
    if (match === null) {
      problems.push(`unpinned or unreadable uses: line: ${line.trim()}`);
      continue;
    }
    const [, action, ref, tag] = match as unknown as [string, string, string, string | undefined];
    const entry = pinned.get(action);
    if (entry === undefined) problems.push(`${action} is not a registered action`);
    else if (!/^[0-9a-f]{40}$/.test(ref) || ref !== entry.sha) problems.push(`${action} is not pinned to its registered commit ${entry.sha} (${line.trim()})`);
    else if (tag !== entry.tag) problems.push(`${action} lacks its trailing tag comment # ${entry.tag} (${line.trim()})`);
  }
  for (const [name, job] of Object.entries(jobs)) {
    if ((job as { "runs-on"?: unknown })["runs-on"] !== RUNNER) problems.push(`${name} does not run on ${RUNNER}`);
  }
  const images = [...bare.matchAll(/intersystems\/[A-Za-z0-9._-]+(?::[A-Za-z0-9._-]+)?(?:@sha256:[0-9a-f]{64})?/g)].map((match) => match[0]);
  for (const image of images) {
    if (!CI_IMAGES.includes(image)) problems.push(`image reference ${image} is not one of the harness's digest-pinned images`);
  }
  if (/@latest\b/.test(bare)) problems.push("the workflow names @latest");
  if (/\bnpx\s+(?:-y|--yes)\b/.test(bare)) problems.push("the workflow runs npx -y");
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(context.packageManager ?? "")) problems.push(`packageManager is ${JSON.stringify(context.packageManager)}, not an exact pnpm@x.y.z`);

  // MATRIX
  const matrix = jobs["gates"]?.strategy?.matrix?.node;
  if (JSON.stringify(matrix) !== JSON.stringify(NODE_LEGS)) problems.push(`the gates matrix is ${JSON.stringify(matrix)}, the registry's legs are ${JSON.stringify(NODE_LEGS)}`);
  const floor = NODE_LEGS[0] as string;
  const floors: Array<[string, string | undefined]> = [["the root manifest", context.rootEnginesNode], ...context.packages.map((pkg): [string, string | undefined] => [`packages/${pkg.dir}`, pkg.enginesNode])];
  for (const [owner, engines] of floors) {
    if (versionOf(engines) !== floor) problems.push(`${owner} declares engines.node ${JSON.stringify(engines)}, but the first Node leg is ${floor}`);
  }
  const majors = NODE_LEGS.map((leg: string) => Number(leg.split(".")[0]));
  NODE_LEGS.forEach((leg: string, index: number) => {
    if (index > 0 && leg !== `${majors[index]}.0.0`) problems.push(`leg ${leg} is not <even major>.0.0`);
    if (majors[index] !== (majors[0] as number) + 2 * index || (majors[index] as number) % 2 !== 0) problems.push(`leg ${leg} does not rise by 2 from the floor without a gap`);
  });
  const setupNodeOf = (job: string): { with?: Record<string, unknown> } | undefined =>
    (jobs[job]?.steps ?? []).find((step: { uses?: string }) => typeof step.uses === "string" && step.uses.startsWith("actions/setup-node@"));
  if (String(setupNodeOf("gates")?.with?.["node-version"]) !== "${{ matrix.node }}") {
    problems.push("gates does not run on its matrix leg: the node-version of its setup-node step is not ${{ matrix.node }}");
  }
  for (const name of ["throwaway", "package"]) {
    if (String(setupNodeOf(name)?.with?.["node-version"]) !== floor) problems.push(`${name} does not run on Node ${floor}`);
  }

  // HYGIENE
  for (const [pattern, what] of [
    [/continue-on-error/, "continue-on-error"],
    [/\|\|\s*true\b/, "|| true"],
    [/\bsecrets\b/, "a secrets reference"],
    [/pull_request_target/, "pull_request_target"],
    [/\b(?:npm|pnpm|yarn)\s+publish\b|\bchangeset\s+(?:publish|version)\b|\b(?:vsce|ovsx)\s+publish\b|\bnpm\s+login\b|\bgit\s+(?:push|tag)\b|\bgh\s+release\b|\bdocker\s+push\b/, "a publish, tag or push command"],
  ] as Array<[RegExp, string]>) {
    if (pattern.test(bare)) problems.push(`the workflow contains ${what}`);
  }
  if (JSON.stringify(workflow["permissions"]) !== JSON.stringify({ contents: "read" })) {
    problems.push(`permissions are ${JSON.stringify(workflow["permissions"])}, not exactly contents: read`);
  }
  for (const [name, job] of Object.entries(jobs)) {
    if ((job as { permissions?: unknown }).permissions !== undefined) problems.push(`job ${name} sets its own permissions`);
    if ((job as { if?: unknown }).if !== undefined) problems.push(`job ${name} has its own if: a condition can run it after a red job or skip it, and the registry declares none`);
    for (const step of (job as { steps?: Array<{ uses?: string; if?: unknown }> }).steps ?? []) {
      if (typeof step.uses === "string" && step.if !== undefined) problems.push(`job ${name}: the step ${step.uses} has an if: condition, and the registry declares none for an action`);
    }
  }
  const concurrency = workflow["concurrency"] as { group?: string; "cancel-in-progress"?: unknown } | undefined;
  if (concurrency === undefined) problems.push("the concurrency block is missing");
  else {
    if (!String(concurrency.group).includes("${{ github.ref }}")) problems.push("the concurrency group does not include github.ref");
    if (concurrency["cancel-in-progress"] !== "${{ github.ref != 'refs/heads/main' }}") {
      problems.push(`cancel-in-progress is ${JSON.stringify(concurrency["cancel-in-progress"])}, not an expression that spares refs/heads/main`);
    }
  }
  if (!String(workflow["run-name"]).includes("github.event.pull_request.head.sha || github.sha")) problems.push("run-name does not carry the head sha");
  const triggers = Object.keys(workflow["on"] ?? {}).sort();
  if (JSON.stringify(triggers) !== JSON.stringify(["pull_request", "push", "workflow_dispatch"])) problems.push(`the triggers are ${triggers.join(", ")}`);
  if (workflow["on"]?.push !== null && workflow["on"]?.push !== undefined) problems.push("the push trigger is filtered: every branch and tag must run");

  const sysctlSteps = (jobs["throwaway"]?.steps ?? []).filter((step: { run?: string }) => /\bsysctl\b/.test(step.run ?? ""));
  if (sysctlSteps.length !== 1) problems.push(`the throwaway job has ${sysctlSteps.length} sysctl steps, not 1`);
  else {
    const reserved = /net\.ipv4\.ip_local_reserved_ports=([0-9,]+)\s*$/.exec(sysctlSteps[0].run)?.[1]?.split(",").sort();
    const expected = Object.values(CI_HOST_PORTS as Record<string, string>).sort();
    if (JSON.stringify(reserved) !== JSON.stringify(expected)) problems.push(`the sysctl step reserves ${JSON.stringify(reserved)}, not exactly ${JSON.stringify(expected)}`);
    for (const port of reserved ?? []) {
      if ((REFUSED_HOST_PORTS as readonly string[]).includes(port)) problems.push(`the sysctl step reserves ${port}, which belongs to the shared IRIS instance`);
    }
  }
  const throwawaySteps: Array<{ run?: string; if?: string }> = jobs["throwaway"]?.steps ?? [];
  if (throwawaySteps.find((step) => /throwaway-iris\.mjs logs\b/.test(step.run ?? ""))?.if !== "${{ failure() || cancelled() }}") {
    problems.push("the logs step does not run on failure() || cancelled()");
  }
  if (throwawaySteps.find((step) => /throwaway-iris\.mjs down\b/.test(step.run ?? ""))?.if !== "${{ always() }}") {
    problems.push("the down step does not run on always()");
  }
  for (const [name, minutes] of Object.entries(JOB_TIMEOUT_MINUTES as Record<string, number>)) {
    if (jobs[name]?.["timeout-minutes"] !== minutes) problems.push(`${name} has timeout-minutes ${jobs[name]?.["timeout-minutes"]}, not ${minutes}`);
  }

  // DW-443
  const needs: string[] = Array.isArray(jobs["package"]?.needs) ? jobs["package"].needs : [jobs["package"]?.needs];
  for (const required of ["gates", "throwaway"]) {
    if (!needs.includes(required)) problems.push(`the package job does not need ${required}`);
  }
  const throwawayRuns = throwawaySteps.map((step) => step.run ?? "").join("\n");
  for (const pkg of context.packages.filter((candidate) => candidate.prepublishOnly !== undefined)) {
    if (!new RegExp(`ci-live-suite\\.mjs prepublish-${pkg.short}(\\s|$)`).test(throwawayRuns)) {
      problems.push(`packages/${pkg.dir} has a prepublishOnly but the workflow has no prepublish-${pkg.short} step`);
    }
  }
  return problems;
}
