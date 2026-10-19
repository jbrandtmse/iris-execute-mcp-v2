/**
 * The helpers the two Story 40.3 live gates (`story-40-3-testproduction-live-gate.test.ts` and `story-40-3-qa-live-gate.test.ts`)
 * share: the fixture-class calls and the monitor checks (built with {@link monitorGate} from `monitor-gate-helpers.ts`, which the
 * coverage gates use too), the production oracle of the interop-mapped scratch namespace read by the raw
 * production status route, its production processes and residue, the settled leftovers check, and the calls and refusal checks of
 * `iris_execute_tests` / `iris_test_coverage` and the guard route. Each gate builds one set with {@link testProductionGate} over its
 * own scratch namespace; the sessions are read when a helper runs, because a gate opens them in `beforeAll`.
 *
 * Every production these helpers start or stop is in that scratch namespace (`EXECMCPTMP403<capital letter>`, the only names the
 * fixture's helpers accept), and the only call that stops a production is {@link TestProductionGate.stopAnyProduction}.
 */

import { expect } from "vitest";
import {
  allText,
  atelierQuery,
  rawIrisRequest,
  type IrisTarget,
  type WireSession,
  type WireToolResult,
} from "./process-gate-helpers.js";
import { leftovers } from "./interop-namespace-fixture.js";
import { monitorGate, sleep, type MonitorGate } from "./monitor-gate-helpers.js";
import { STORY403_OTHER } from "./testproduction-fixture.js";

export { sleep, type MonitorStateJson } from "./monitor-gate-helpers.js";

/** The guard route and the production status route, below the web port. */
export const GUARD_ROUTE = "/api/executemcp/v2/dev/test/production";
export const STATUS_ROUTE = "/api/executemcp/v2/interop/production/status";

/** The operator enables the coverage tool; the other tools are enabled by default. */
export const ENABLED_GOVERNANCE = JSON.stringify({ global: { iris_test_coverage: true } });

/** The InstalledNamespace node of a scratch namespace, which the leftovers check lists and the processes check ignores. */
export function installedNode(namespace: string): string {
  return `^%SYS("Ensemble","InstalledNamespace","${namespace}")`;
}

export interface ProductionStatusJson {
  name: string;
  state: string;
  stateCode: number;
  startTime?: string;
}

export interface TestDetail {
  class: string;
  method: string;
  status: string;
  duration?: number;
  message?: string;
}

export interface RunContent {
  status: string;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  details: TestDetail[];
  coverageRunId?: number;
  coverage?: { complete: boolean };
}

/** The raw guard route's `result`. */
export interface GuardRoute {
  decision: string;
  namespace: string;
  testProductions: Array<{ class: string; production: string }>;
  production?: string;
  state?: string;
  stateCode?: number;
  error?: string;
}

/** One raw guard route call: the HTTP status, the `result`, the time it took and the raw text. */
export interface GuardAnswer {
  status: number;
  result: GuardRoute;
  ms: number;
  text: string;
}

/** The structured content of a tool call that must not be an error. */
export function succeeded<T>(result: WireToolResult): T {
  expect(result.isError, allText(result)).toBeFalsy();
  return result.structuredContent as unknown as T;
}

/** A completed result with run-specific values removed, for comparing two runs of the same tests. */
export function withoutRunValues(content: unknown): unknown {
  return JSON.parse(JSON.stringify(content), (key, value) =>
    key === "jobId" || key === "runIndex" || key === "runIndexSource" || key === "runIndexNote" || key === "duration" ? undefined : value,
  );
}

/** What a gate passes in: its sessions (read when a helper runs), its target, its scratch namespace and its coverage routines. */
export interface TestProductionGateOptions {
  sessions: () => { dev: WireSession; interop: WireSession };
  target: IrisTarget;
  /** The interop-mapped scratch namespace whose production the helpers read, start and stop. */
  namespace: string;
  /** The routines of the coverage sessions a row may leave behind, for the safety net. */
  suiteRoutineSets: readonly string[];
}

export interface TestProductionGate extends MonitorGate {
  /** The production status of the scratch namespace, by the raw status route: the oracle for "Stopped" and "untouched". */
  productionStatus(): Promise<ProductionStatusJson>;
  /** Wait until the production reaches `state` (the start and stop calls return before the jobs have settled). */
  waitForState(state: string, seconds?: number): Promise<ProductionStatusJson>;
  /** Start `Story403.Other`, the foreign stand-in, and wait until it runs. */
  startOther(): Promise<void>;
  /** Stop whatever production the namespace runs (gracefully, then forced), and wait until it is Stopped. Safe when nothing runs. */
  stopAnyProduction(): Promise<void>;
  /** The production processes of the namespace: every process in it that is not an Atelier work queue worker. */
  processes(): Promise<string[]>;
  /** Production processes or Ensemble state of the namespace that remain, other than its InstalledNamespace node. */
  residue(): Promise<string[]>;
  /** Every leftover of `namespaces`, with the processes that were ending when they were read given up to 10 seconds to go. */
  settledLeftovers(namespaces: readonly string[]): Promise<string[]>;
  /** `read` once two reads one second apart agree (a production reports Running while its jobs are still starting). */
  settled<T>(read: () => Promise<T>): Promise<T>;
  /** `iris_execute_tests`, by default over the scratch namespace. */
  executeTests(target: string, level: "package" | "class" | "method", namespace?: string): Promise<WireToolResult>;
  /** `iris_test_coverage` measuring `classes`, by default over the scratch namespace. */
  coverageRun(target: string, level: "package" | "class" | "method", classes: string[], namespace?: string): Promise<WireToolResult>;
  /** The fields of a PRODUCTION_BUSY refusal in the scratch namespace that names a production it read. */
  busyFields(production: string, state: string, tests: Array<{ class: string; production: string }>): Record<string, unknown>;
  /** A refusal must be `isError` with exactly the expected structured content and a text that names the production. */
  expectRefusal(result: WireToolResult, expected: Record<string, unknown>, production: string): void;
  /** The raw guard route for a target, with its time. */
  rawGuard(target: string, level: string, namespace: string): Promise<GuardAnswer>;
}

/**
 * The helpers of one Story 40.3 gate over its interop-mapped scratch namespace.
 *
 * @param options - The gate's sessions, target, scratch namespace and coverage routines.
 */
export function testProductionGate(options: TestProductionGateOptions): TestProductionGate {
  const { target, namespace, suiteRoutineSets } = options;
  const node = installedNode(namespace);
  const dev = (): WireSession => options.sessions().dev;
  const interop = (): WireSession => options.sessions().interop;
  const monitor = monitorGate({ dev, suiteRoutineSets });

  async function productionStatus(): Promise<ProductionStatusJson> {
    const answer = await rawIrisRequest(target, `${STATUS_ROUTE}?namespace=${namespace}`, { method: "GET" });
    expect(answer.status, answer.text).toBe(200);
    return (answer.json as { result: ProductionStatusJson }).result;
  }

  async function waitForState(state: string, seconds = 30): Promise<ProductionStatusJson> {
    let status = await productionStatus();
    for (let waited = 0; status.state !== state && waited < seconds; waited++) {
      await sleep(1000);
      status = await productionStatus();
    }
    return status;
  }

  async function startOther(): Promise<void> {
    const started = await interop().call("iris_production_control", { action: "start", name: STORY403_OTHER, namespace });
    expect(started.isError, allText(started)).toBeFalsy();
    expect(await waitForState("Running"), "Story403.Other runs").toMatchObject({ name: STORY403_OTHER, state: "Running" });
  }

  async function stopAnyProduction(): Promise<void> {
    if ((await productionStatus()).state === "Stopped") return;
    await interop().call("iris_production_control", { action: "stop", namespace });
    if ((await waitForState("Stopped", 20)).state === "Stopped") return;
    await interop().call("iris_production_control", { action: "stop", force: true, namespace });
    expect((await waitForState("Stopped", 20)).state, "the production was stopped").toBe("Stopped");
  }

  /**
   * A work queue worker that ran a test stays in the namespace for about a second after the job ends, so it is the test runner and
   * not a production process; it is left out of the production processes.
   */
  async function workerPids(): Promise<Set<string>> {
    const rows = await atelierQuery(target, `SELECT Pid FROM %SYS.ProcessQuery WHERE NameSpace = '${namespace}' AND Routine = '%SYS.WorkQueueMgr'`);
    return new Set(rows.map((row) => String(row["Pid"])));
  }

  async function processes(): Promise<string[]> {
    const workers = await workerPids();
    return (await leftovers(dev(), [namespace]))
      .filter((entry) => entry.startsWith("process ") && !workers.has(entry.split(" ")[1] ?? ""))
      .sort();
  }

  /** A process that was ending when it was read (a coverage runner, a job of the production) is given up to 10 seconds to go. */
  async function residue(): Promise<string[]> {
    let remaining: string[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      const ensemble = (await leftovers(dev(), [namespace])).filter((entry) => entry.startsWith("^%SYS(") && entry !== node);
      remaining = [...(await processes()), ...ensemble];
      if (remaining.length === 0) return remaining;
      await sleep(1000);
    }
    return remaining;
  }

  async function settledLeftovers(namespaces: readonly string[]): Promise<string[]> {
    let listed: string[] = [];
    for (let attempt = 0; attempt < 10; attempt++) {
      listed = await leftovers(dev(), [...namespaces]);
      if (!listed.every((entry) => entry.startsWith("process "))) return listed;
      if (listed.length === 0) return listed;
      await sleep(1000);
    }
    return listed;
  }

  async function settled<T>(read: () => Promise<T>): Promise<T> {
    let previous = await read();
    for (let attempt = 0; attempt < 30; attempt++) {
      await sleep(1000);
      const current = await read();
      if (JSON.stringify(current) === JSON.stringify(previous)) return current;
      previous = current;
    }
    return previous;
  }

  function executeTests(testTarget: string, level: "package" | "class" | "method", inNamespace: string = namespace): Promise<WireToolResult> {
    return dev().call("iris_execute_tests", { target: testTarget, level, namespace: inNamespace });
  }

  function coverageRun(
    testTarget: string,
    level: "package" | "class" | "method",
    classes: string[],
    inNamespace: string = namespace,
  ): Promise<WireToolResult> {
    return dev().call("iris_test_coverage", { target: testTarget, level, classes, namespace: inNamespace });
  }

  function busyFields(production: string, state: string, tests: Array<{ class: string; production: string }>): Record<string, unknown> {
    return { code: "PRODUCTION_BUSY", namespace, state, testProductions: tests, production };
  }

  function expectRefusal(result: WireToolResult, expected: Record<string, unknown>, production: string): void {
    expect(result.isError, allText(result)).toBe(true);
    expect(result.structuredContent).toEqual(expected);
    const text = allText(result);
    expect(text).toContain(`Production '${production}' is ${String(expected["state"])} in namespace ${namespace}`);
    expect(text).toContain(`'${production}' was left untouched`);
    expect(text).toContain("iris_production_control");
  }

  async function rawGuard(testTarget: string, level: string, inNamespace: string): Promise<GuardAnswer> {
    const started = performance.now();
    const answer = await rawIrisRequest(
      target,
      `${GUARD_ROUTE}?target=${encodeURIComponent(testTarget)}&level=${level}&namespace=${inNamespace}`,
      { method: "GET" },
    );
    const ms = performance.now() - started;
    return { status: answer.status, result: (answer.json as { result: GuardRoute }).result, ms, text: answer.text };
  }

  return {
    ...monitor,
    productionStatus,
    waitForState,
    startOther,
    stopAnyProduction,
    processes,
    residue,
    settledLeftovers,
    settled,
    executeTests,
    coverageRun,
    busyFields,
    expectRefusal,
    rawGuard,
  };
}
