/**
 * The checks that hold `.github/workflows/release.yml` equal to the code-declared shape (`scripts/lib/release-checks.mjs`), as one pure
 * function over the workflow text, so the self-test (`release-workflow.test.ts`) runs the same checks over the real file and over a
 * mutation of it for each defect, and the mutations show each check can fail (Rule #59).
 *
 * `releaseWorkflowProblems(text)` returns what is wrong with the text. A sibling of `ci-workflow-check.ts`, not a widening of it:
 * `workflowProblems` bans secrets, publish and artifacts outright, which is right for `ci.yml`. This one reuses its exported
 * `actionPinProblems` and `stripComments`. Its checks, with the acceptance criterion each serves:
 *  - TRIGGERS (42.5.1): exactly a push of `v*` tags and of `release-dry-run/**` branches, and a manual dispatch; no `pull_request*`,
 *    `workflow_run` or `schedule`; `permissions: {}` at the top; a concurrency group per ref that never cancels a started release.
 *  - JOBS (42.5.1): the jobs, their runner, timeout, `needs`, permissions, environment, condition and ordered steps (an action with its
 *    inputs, or a command with its environment and directory) are the declaration's, in both directions.
 *  - EXCLUSIVITY (42.5.1, 42.5.4): `environment`, `id-token: write` and `secrets.` occur in the `publish` job only; `github.token` occurs
 *    in `ci-gate` and `publish` only. So `rehearse` has no environment, no OIDC permission and no secret.
 *  - CALLS (42.5.1, 42.5.4): `release.mjs ci-gate` runs only in `ci-gate`, `prepare` only in `prepare`, `publish --dry-run` only in
 *    `rehearse`, and a `publish` without `--dry-run` only in `publish`.
 *  - PINS and HYGIENE (42.5.2): every `uses:` is a registered action at its registered commit with its tag in a trailing comment; no
 *    `continue-on-error`, `|| true`, `npx -y`, `@latest`, `pull_request_target` and no raw publish, push or tag verb in any `run:`.
 */

import { parse } from "yaml";
import {
  RELEASE_ALLOWED_ACTIONS,
  RELEASE_CONCURRENCY,
  RELEASE_JOBS,
  RELEASE_TRIGGERS,
  RUNNER,
} from "../../../../scripts/lib/release-checks.mjs";
import { actionPinProblems, stripComments } from "./ci-workflow-check";

/** The keys the declaration uses, at each level. */
const WORKFLOW_KEYS = ["name", "run-name", "on", "permissions", "concurrency", "jobs"];
const JOB_KEYS = ["name", "runs-on", "timeout-minutes", "needs", "permissions", "environment", "if", "steps"];
const RUN_STEP_KEYS = ["name", "run", "env", "working-directory"];
const ACTION_STEP_KEYS = ["name", "uses", "with"];

/** A step of the workflow, reduced to what the declaration states. */
interface NormalizedStep {
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  env?: Record<string, unknown>;
  workingDirectory?: string;
}

/** A declared step in the same shape. */
interface DeclaredReleaseStep {
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  env?: Record<string, unknown>;
  workingDirectory?: string;
}

/** A value with its object keys in sorted order, so that two values with the same content compare equal as text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/** A workflow step reduced to the declaration's shape. */
function normalize(step: Record<string, any>): NormalizedStep {
  if (typeof step["uses"] === "string") {
    return { uses: (step["uses"] as string).split("@")[0] as string, with: (step["with"] as Record<string, unknown> | undefined) ?? {} };
  }
  return {
    run: step["run"] as string,
    ...(step["env"] === undefined ? {} : { env: step["env"] as Record<string, unknown> }),
    ...(step["working-directory"] === undefined ? {} : { workingDirectory: step["working-directory"] as string }),
  };
}

/** A declared step reduced to the same shape (an action's inputs default to none). */
function declaredShape(step: DeclaredReleaseStep): NormalizedStep {
  return step.uses === undefined ? (step as NormalizedStep) : { uses: step.uses, with: step.with ?? {} };
}

/** Whether a `run:` text holds a raw publish, push or tag verb. */
const RAW_VERB =
  /\b(?:npm|pnpm|yarn)\s+(?:publish|stage|login|adduser|deprecate|unpublish|access|token)\b|\bchangeset\s+(?:publish|version)\b|\b(?:vsce|ovsx)\s+publish\b|\bgit\s+(?:push|tag)\b|\bgh\s+(?:release|secret|workflow)\b|\bdocker\s+push\b|\b(?:zpm|ipm)[ \t]+["']?(?:publish|install|repo|enable|update)\b/;

/** What is wrong with the workflow text. An empty list means it is the declared release workflow. */
export function releaseWorkflowProblems(text: string): string[] {
  let workflow: Record<string, any>;
  try {
    workflow = parse(text) as Record<string, any>;
  } catch (error) {
    return [`release.yml does not parse as YAML: ${error instanceof Error ? error.message : String(error)}`];
  }
  if (workflow === null || typeof workflow !== "object" || typeof workflow["jobs"] !== "object") return ["release.yml has no jobs."];
  const problems: string[] = [];
  const jobs = workflow["jobs"] as Record<string, any>;
  const declared = RELEASE_JOBS as Record<string, any>;

  // KEYS
  const unknownKeys = (where: string, value: unknown, allowed: readonly string[]): void => {
    if (value === null || typeof value !== "object") return;
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key)) problems.push(`${where} sets ${key}, which the declaration does not use`);
    }
  };
  unknownKeys("the workflow", workflow, WORKFLOW_KEYS);
  for (const [name, job] of Object.entries(jobs)) {
    unknownKeys(`job ${name}`, job, JOB_KEYS);
    if (job?.strategy !== undefined || job?.defaults !== undefined || job?.env !== undefined) problems.push(`job ${name} sets a strategy, defaults or env, which the declaration does not use`);
    for (const step of (job?.steps ?? []) as Array<Record<string, any>>) {
      const isAction = typeof step?.["uses"] === "string";
      unknownKeys(`job ${name}: the step ${isAction ? step["uses"] : JSON.stringify(step?.["run"])}`, step, isAction ? ACTION_STEP_KEYS : RUN_STEP_KEYS);
    }
  }

  // TRIGGERS
  const triggers = Object.keys(workflow["on"] ?? {}).sort();
  if (canonical(triggers) !== canonical(Object.keys(RELEASE_TRIGGERS).sort())) problems.push(`the triggers are ${triggers.join(", ")}, not ${Object.keys(RELEASE_TRIGGERS).sort().join(", ")}`);
  if (canonical(workflow["on"]?.["push"]) !== canonical((RELEASE_TRIGGERS as Record<string, unknown>)["push"])) {
    problems.push(`the push trigger is ${JSON.stringify(workflow["on"]?.["push"])}, not ${JSON.stringify((RELEASE_TRIGGERS as Record<string, unknown>)["push"])}`);
  }
  const dispatch = workflow["on"]?.["workflow_dispatch"];
  if (dispatch !== null && canonical(dispatch) !== canonical({})) problems.push(`workflow_dispatch is ${JSON.stringify(dispatch)}, not an empty trigger`);
  if (canonical(workflow["permissions"]) !== canonical({})) problems.push(`the workflow permissions are ${JSON.stringify(workflow["permissions"])}, not {}: each job names its own`);
  if (canonical(workflow["concurrency"]) !== canonical(RELEASE_CONCURRENCY)) {
    problems.push(`the concurrency is ${JSON.stringify(workflow["concurrency"])}, not ${JSON.stringify(RELEASE_CONCURRENCY)}: one run per ref, and a started release is never cancelled`);
  }

  // JOBS
  const names = Object.keys(jobs);
  if (canonical(names) !== canonical(Object.keys(declared))) problems.push(`the jobs are ${names.join(", ")}, the declaration has ${Object.keys(declared).join(", ")}`);
  for (const [name, expected] of Object.entries(declared)) {
    const job = jobs[name];
    if (job === undefined) continue;
    if (job["runs-on"] !== RUNNER) problems.push(`job ${name} does not run on ${RUNNER}`);
    if (job["timeout-minutes"] !== expected.timeoutMinutes) problems.push(`job ${name} has timeout-minutes ${job["timeout-minutes"]}, not ${expected.timeoutMinutes}`);
    const needs = job["needs"] === undefined ? [] : Array.isArray(job["needs"]) ? job["needs"] : [job["needs"]];
    if (canonical([...needs].sort()) !== canonical([...expected.needs].sort())) problems.push(`job ${name} needs ${needs.join(", ") || "nothing"}, not ${expected.needs.join(", ") || "nothing"}`);
    if (canonical(job["permissions"]) !== canonical(expected.permissions)) problems.push(`job ${name} has permissions ${JSON.stringify(job["permissions"])}, not ${JSON.stringify(expected.permissions)}`);
    if (job["environment"] !== expected.environment) problems.push(`job ${name} has environment ${JSON.stringify(job["environment"])}, not ${JSON.stringify(expected.environment)}`);
    if (job["if"] !== expected.if) problems.push(`job ${name} has the condition ${JSON.stringify(job["if"])}, not ${JSON.stringify(expected.if)}`);
    const actual = ((job["steps"] ?? []) as Array<Record<string, any>>).map(normalize);
    const wanted = (expected.steps as DeclaredReleaseStep[]).map(declaredShape);
    if (actual.length !== wanted.length) problems.push(`job ${name} has ${actual.length} steps, the declaration has ${wanted.length}`);
    wanted.forEach((step, index) => {
      if (actual[index] !== undefined && canonical(actual[index]) !== canonical(step)) {
        problems.push(`job ${name}: step ${index + 1} is ${JSON.stringify(actual[index])}, the declaration has ${JSON.stringify(step)}`);
      }
    });
    const setupNode = actual.find((step) => step.uses === "actions/setup-node");
    if (String(setupNode?.with?.["node-version"]) !== expected.node) problems.push(`job ${name} does not run on Node ${expected.node}`);
  }

  // EXCLUSIVITY: what only `publish` may hold.
  const holds = (value: unknown, pattern: RegExp): boolean => pattern.test(JSON.stringify(value) ?? "");
  for (const [name, job] of Object.entries(jobs)) {
    if (name !== "publish") {
      if (job?.environment !== undefined) problems.push(`job ${name} has an environment: only publish may`);
      if (job?.permissions?.["id-token"] !== undefined) problems.push(`job ${name} has id-token permission: only publish may`);
      if (holds(job, /secrets\./)) problems.push(`job ${name} reads a secret: only publish may`);
    }
    if (name !== "publish" && name !== "ci-gate" && holds(job, /github\.token/)) problems.push(`job ${name} reads github.token: only ci-gate and publish may`);
  }
  const outside = { ...workflow, jobs: undefined };
  if (holds(outside, /secrets\.|github\.token|id-token/)) problems.push("the workflow level (outside the jobs) names a secret, github.token or id-token");

  // CALLS: which job runs which command of the release script.
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of (job?.steps ?? []) as Array<Record<string, any>>) {
      if (typeof step?.["run"] !== "string") continue;
      for (const call of (step["run"] as string).matchAll(/scripts\/release\.mjs\s+(ci-gate|prepare|publish)\b([^\n]*)/g)) {
        const command = call[1] as string;
        const dry = /--dry-run\b/.test(call[2] as string);
        const owner = command === "publish" ? (dry ? "rehearse" : "publish") : command;
        if (name !== owner) problems.push(`job ${name} runs release.mjs ${command}${dry ? " --dry-run" : ""}: only ${owner} may`);
      }
      if (/release\.mjs/.test(step["run"] as string) && !/scripts\/release\.mjs\s+(?:ci-gate|prepare|publish)\b/.test(step["run"] as string)) {
        problems.push(`job ${name} runs release.mjs with a command that is not ci-gate, prepare or publish`);
      }
    }
  }

  // PINS
  const usesLines = text.split("\n").filter((line) => /^\s*-?\s*uses:/.test(line));
  const usesInJobs = Object.values(jobs).flatMap((job) => ((job as { steps?: Array<{ uses?: string }> }).steps ?? []).filter((step) => step.uses !== undefined));
  if (usesLines.length !== usesInJobs.length) problems.push(`the text has ${usesLines.length} uses: lines but the jobs have ${usesInJobs.length} uses steps`);
  problems.push(...actionPinProblems(usesLines, RELEASE_ALLOWED_ACTIONS));

  // HYGIENE
  const bare = `${stripComments(text)}\n${JSON.stringify(workflow)}`;
  for (const [pattern, what] of [
    [/continue-on-error/, "continue-on-error"],
    [/\|\|\s*true\b/, "|| true"],
    [/pull_request/, "a pull_request trigger"],
    [/workflow_run|schedule:|"schedule"/, "a workflow_run or schedule trigger"],
    [/@latest\b/, "@latest"],
    [/\bnpx\s+(?:-y|--yes)\b/, "npx -y"],
    [/upload-release-asset|gh-release|softprops/, "a release asset step"],
  ] as Array<[RegExp, string]>) {
    if (pattern.test(bare)) problems.push(`the workflow contains ${what}`);
  }
  for (const [name, job] of Object.entries(jobs)) {
    for (const step of (job?.steps ?? []) as Array<Record<string, any>>) {
      if (typeof step?.["run"] === "string" && RAW_VERB.test(step["run"] as string)) problems.push(`job ${name}: a run step holds a raw publish, push or tag verb: ${(step["run"] as string).slice(0, 80)}`);
    }
  }
  return problems;
}
