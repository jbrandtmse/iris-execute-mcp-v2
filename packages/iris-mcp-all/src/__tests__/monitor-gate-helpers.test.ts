/**
 * Story 40.5 (DW-603): the shared monitor helpers of the live gates, over a fake dev session. No IRIS.
 *
 * The fake answers the two tools the helpers call with the shapes the real tools return, read from
 * `packages/iris-dev-mcp/src/tools/global.ts` (`iris_global_get`: the node's `{value, defined}` as the structured
 * content) and captured from the live `iris_execute_classmethod` (`structuredContent.returnValue`, a string, beside
 * `argCount`, `output` and the truncation flags). `MonitorState` answers the JSON the fixture class builds, and an
 * undefined node answers `{value: "", defined: false}` (captured live, IRIS 2026.2 build 221U).
 */

import { describe, it, expect } from "vitest";
import type { WireSession, WireToolResult } from "./process-gate-helpers.js";
import { FIXTURE_CLASS } from "./interop-namespace-fixture.js";
import { monitorGate, sleep, type MonitorStateJson } from "./monitor-gate-helpers.js";

const COVERAGE_GLOBAL = "IRIS.TempExecuteMCPv2Coverage";

/** What the fake instance holds: the monitor's state, the coverage service's nodes and the routine sets a StopIfList can stop. */
interface FakeInstance {
  monitor: MonitorStateJson;
  /** Subscripts (as the gate writes them) of the coverage nodes that are defined, with their values. */
  nodes: Record<string, string>;
  /** The routine sets the fixture proves to be the active session's. */
  stoppable: string[];
  /** Every call the helpers made, in order: `MonitorState`, `StopIfList:<routines>` or `global:<subscripts>`. */
  calls: string[];
  /** The next call fails, as an `isError` tool result. */
  failNext: boolean;
}

function idleMonitor(): MonitorStateJson {
  return { active: 0, count: 0, pids: "", routines: [] };
}

function activeMonitor(): MonitorStateJson {
  return { active: 1, count: 1, pids: "123", routines: ["Story405.Fixture.1"] };
}

function newInstance(overrides: Partial<FakeInstance> = {}): FakeInstance {
  return { monitor: idleMonitor(), nodes: {}, stoppable: [], calls: [], failNext: false, ...overrides };
}

function classMethodResult(returnValue: string): WireToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ returnValue }) }],
    structuredContent: { returnValue, argCount: 0, output: "", byRefValues: {}, truncated: false, byRefTruncated: false, returnValueTruncated: false },
  };
}

/** A dev session over `instance`: the two tools the helpers call, answered with the real tools' shapes. */
function fakeDev(instance: FakeInstance): WireSession {
  const call = async (name: string, args: Record<string, unknown>): Promise<WireToolResult> => {
    if (instance.failNext) {
      instance.failNext = false;
      return { isError: true, content: [{ type: "text", text: "the call failed" }] };
    }
    if (name === "iris_execute_classmethod") {
      expect(args["namespace"]).toBe("HSCUSTOM");
      expect(args["className"]).toBe(FIXTURE_CLASS);
      if (args["methodName"] === "MonitorState") {
        instance.calls.push("MonitorState");
        return classMethodResult(JSON.stringify(instance.monitor));
      }
      if (args["methodName"] === "StopIfList") {
        const routines = String((args["args"] as unknown[])[0]);
        instance.calls.push(`StopIfList:${routines}`);
        if (instance.monitor.active === 0) return classMethodResult("idle");
        if (!instance.stoppable.includes(routines)) return classMethodResult("refused: not provably the suite's session");
        instance.monitor = idleMonitor();
        return classMethodResult("stopped");
      }
      return classMethodResult("");
    }
    if (name === "iris_global_get") {
      expect(args["namespace"]).toBe("HSCUSTOM");
      expect(args["global"]).toBe(COVERAGE_GLOBAL);
      const subscripts = String(args["subscripts"]);
      instance.calls.push(`global:${subscripts}`);
      const value = instance.nodes[subscripts];
      const structuredContent = value === undefined ? { value: "", defined: false } : { value, defined: true };
      return { content: [{ type: "text", text: JSON.stringify(structuredContent, null, 2) }], structuredContent };
    }
    throw new Error(`the fake dev session was asked for ${name}`);
  };
  const unused = async (): Promise<never> => {
    throw new Error("the monitor helpers use only call()");
  };
  return { call, callOn: unused, raw: unused, listTools: unused, listPrompts: unused, getPrompt: unused, close: async () => undefined } as unknown as WireSession;
}

function gateOver(instance: FakeInstance, suiteRoutineSets: readonly string[] = []): ReturnType<typeof monitorGate> {
  return monitorGate({ dev: () => fakeDev(instance), suiteRoutineSets });
}

describe("monitorGate: the calls and the counter", () => {
  it("fixtureCall returns the fixture method's string result and fails the row on an isError result", async () => {
    const instance = newInstance();
    const gate = gateOver(instance);
    expect(await gate.fixtureCall("StopIfList", ["A"])).toBe("idle");
    instance.failNext = true;
    await expect(gate.fixtureCall("MonitorState")).rejects.toThrow(/the call failed/);
  });

  it("monitorState parses the fixture's JSON, coverageGlobal reads {value, defined} and runCounter reads the seq node", async () => {
    const instance = newInstance({ monitor: activeMonitor(), nodes: { '"seq"': "41" } });
    const gate = gateOver(instance);
    expect(await gate.monitorState()).toEqual(activeMonitor());
    expect(await gate.coverageGlobal('"seq"')).toEqual({ value: "41", defined: true });
    expect(await gate.coverageGlobal('"session"')).toEqual({ value: "", defined: false });
    expect(await gate.runCounter()).toBe(41);
    expect(instance.calls.filter((entry) => entry === 'global:"seq"')).toHaveLength(2);
  });

  it("runCounter is 0 while the coverage service has allocated no run", async () => {
    expect(await gateOver(newInstance()).runCounter()).toBe(0);
  });

  it("reads the session when a helper runs, not when the gate is built (a gate opens its session in beforeAll)", async () => {
    let session: WireSession | undefined;
    const gate = monitorGate({
      dev: () => {
        if (!session) throw new Error("the dev session is not open yet");
        return session;
      },
      suiteRoutineSets: [],
    });
    await expect(gate.monitorState()).rejects.toThrow(/not open yet/);
    session = fakeDev(newInstance());
    expect((await gate.monitorState()).active).toBe(0);
  });
});

describe("monitorGate: the idle checks", () => {
  it("expectMonitorIdle passes on an idle monitor with the ownership node undefined", async () => {
    await expect(gateOver(newInstance()).expectMonitorIdle("row")).resolves.toBeUndefined();
  });

  it("expectMonitorIdle throws on an active monitor, naming the row and the process list", async () => {
    const gate = gateOver(newInstance({ monitor: activeMonitor() }));
    await expect(gate.expectMonitorIdle("row 7")).rejects.toThrow(/row 7: the monitor is idle \(process list "123"\)/);
  });

  it("expectMonitorIdle throws on a defined ownership node, naming the row", async () => {
    const gate = gateOver(newInstance({ nodes: { '"session"': "run 3" } }));
    await expect(gate.expectMonitorIdle("row 8")).rejects.toThrow(/row 8: no ownership node is left/);
  });

  it("expectMonitorInactive passes on an idle monitor whether or not the ownership node is defined, and throws on an active one", async () => {
    await expect(gateOver(newInstance({ nodes: { '"session"': "run 3" } })).expectMonitorInactive("row 9")).resolves.toBeUndefined();
    await expect(gateOver(newInstance()).expectMonitorInactive("row 9")).resolves.toBeUndefined();
    await expect(gateOver(newInstance({ monitor: activeMonitor() })).expectMonitorInactive("row 9")).rejects.toThrow(/row 9: the monitor is idle \(process list "123"\)/);
  });

  it("expectMonitorInactive reads no coverage node", async () => {
    const instance = newInstance({ nodes: { '"session"': "run 3" } });
    await gateOver(instance).expectMonitorInactive("row 9");
    expect(instance.calls).toEqual(["MonitorState"]);
  });
});

describe("monitorGate: releasing a session a failed row left behind", () => {
  it("makes no StopIfList call when the monitor is idle", async () => {
    const instance = newInstance();
    await gateOver(instance, ["A", "B"]).releaseLeftoverSession();
    expect(instance.calls).toEqual(["MonitorState"]);
  });

  it("reads the state before each StopIfList and stops reading once the session is stopped", async () => {
    const instance = newInstance({ monitor: activeMonitor(), stoppable: ["B"] });
    await gateOver(instance, ["A", "B", "C"]).releaseLeftoverSession();
    expect(instance.calls).toEqual(["MonitorState", "StopIfList:A", "MonitorState", "StopIfList:B", "MonitorState"]);
    expect(instance.monitor.active).toBe(0);
  });

  it("stops at the first set that matches and tries no later set", async () => {
    const instance = newInstance({ monitor: activeMonitor(), stoppable: ["A", "B"] });
    await gateOver(instance, ["A", "B"]).releaseLeftoverSession();
    expect(instance.calls).toEqual(["MonitorState", "StopIfList:A", "MonitorState"]);
  });

  it("leaves a session no set proves alone, having tried every set once", async () => {
    const instance = newInstance({ monitor: activeMonitor(), stoppable: [] });
    await gateOver(instance, ["A", "B"]).releaseLeftoverSession();
    expect(instance.calls).toEqual(["MonitorState", "StopIfList:A", "MonitorState", "StopIfList:B"]);
    expect(instance.monitor.active).toBe(1);
  });
});

describe("sleep", () => {
  it("resolves after the delay", async () => {
    const started = Date.now();
    await sleep(20);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);
  });
});
