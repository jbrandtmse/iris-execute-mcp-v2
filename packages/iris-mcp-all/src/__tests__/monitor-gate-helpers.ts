/**
 * The helpers every live gate that may start a Line-by-Line (coverage) session shares: the fixture-class calls, the monitor state, the
 * coverage service's IRISTEMP nodes and run counter, the monitor-idle checks, and the release of a session a failed row left behind.
 * A gate builds one set with {@link monitorGate} over its dev session and the routine sets its own coverage sessions may leave
 * behind; the session is read when a helper runs, because a gate opens it in `beforeAll`. The Story 40.3 helpers
 * (`testproduction-gate-helpers.ts`) build theirs with the same function.
 *
 * Nothing here starts a session or a production. The only call that stops a session is the fixture's `StopIfList`, which stops it
 * only when its process list is provably one of the routine sets given.
 */

import { expect } from "vitest";
import { allText, type WireSession } from "./process-gate-helpers.js";
import { FIXTURE_CLASS } from "./interop-namespace-fixture.js";

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The fixture's `MonitorState` answer. */
export interface MonitorStateJson {
  active: number;
  count: number;
  pids: string;
  routines: string[];
}

/** What a gate passes in: its dev session (read when a helper runs) and the routine sets its coverage sessions may leave behind. */
export interface MonitorGateOptions {
  dev: () => WireSession;
  /** The routines of the coverage sessions a row may leave behind, for the safety net. */
  suiteRoutineSets: readonly string[];
}

export interface MonitorGate {
  /** A class method of the fixture class, which lives in HSCUSTOM, and its string result. */
  fixtureCall(methodName: string, args?: unknown[]): Promise<string>;
  monitorState(): Promise<MonitorStateJson>;
  /** A node of the coverage service's IRISTEMP global, as `{value, defined}`. */
  coverageGlobal(subscripts: string): Promise<{ value: unknown; defined: boolean }>;
  /** The last run id the coverage service allocated, read from its IRISTEMP counter. */
  runCounter(): Promise<number>;
  /** The monitor is idle and no coverage ownership node is left. */
  expectMonitorIdle(row: string): Promise<void>;
  /** The monitor is idle: no Line-by-Line or PERFMON session is active. The ownership node is not checked. */
  expectMonitorInactive(row: string): Promise<void>;
  /** Stop a coverage session a failed row left behind: the fixture stops it only when it is provably one of the candidate sets. */
  releaseLeftoverSession(): Promise<void>;
}

/**
 * The monitor helpers of one gate.
 *
 * @param options - The gate's dev session and the routine sets its coverage sessions may leave behind.
 */
export function monitorGate(options: MonitorGateOptions): MonitorGate {
  const { suiteRoutineSets } = options;
  const dev = (): WireSession => options.dev();

  async function fixtureCall(methodName: string, args: unknown[] = []): Promise<string> {
    const result = await dev().call("iris_execute_classmethod", { namespace: "HSCUSTOM", className: FIXTURE_CLASS, methodName, args });
    expect(result.isError, allText(result)).toBeFalsy();
    return String(result.structuredContent?.["returnValue"] ?? "");
  }

  async function monitorState(): Promise<MonitorStateJson> {
    return JSON.parse(await fixtureCall("MonitorState")) as MonitorStateJson;
  }

  async function coverageGlobal(subscripts: string): Promise<{ value: unknown; defined: boolean }> {
    const result = await dev().call("iris_global_get", { namespace: "HSCUSTOM", global: "IRIS.TempExecuteMCPv2Coverage", subscripts });
    expect(result.isError, allText(result)).toBeFalsy();
    const content = result.structuredContent as { value?: unknown; defined?: boolean } | undefined;
    return { value: content?.value, defined: content?.defined === true };
  }

  async function runCounter(): Promise<number> {
    return Number((await coverageGlobal('"seq"')).value ?? 0);
  }

  async function expectMonitorInactive(row: string): Promise<void> {
    const state = await monitorState();
    expect(state.active, `${row}: the monitor is idle (process list "${state.pids}")`).toBe(0);
  }

  async function expectMonitorIdle(row: string): Promise<void> {
    await expectMonitorInactive(row);
    expect((await coverageGlobal('"session"')).defined, `${row}: no ownership node is left`).toBe(false);
  }

  async function releaseLeftoverSession(): Promise<void> {
    for (const routines of suiteRoutineSets) {
      if ((await monitorState()).active === 0) return;
      await fixtureCall("StopIfList", [routines]);
    }
  }

  return { fixtureCall, monitorState, coverageGlobal, runCounter, expectMonitorIdle, expectMonitorInactive, releaseLeftoverSession };
}
