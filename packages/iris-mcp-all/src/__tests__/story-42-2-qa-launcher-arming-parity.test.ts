/**
 * Story 42.2 (DW-627) QA - the launcher's local copy of the arming contract agrees with the shared helper.
 *
 * AD-2 keeps the VS Code extension self-contained, so `extensions/iris-mcp-launcher/src/__tests__/liveArming.ts` holds a
 * ~10-line copy of `@iris-mcp/shared/test-helpers/live-target`. Each side has its own table (`liveArming.test.ts`,
 * `live-arming-guard.test.ts`), and the two tables list different values, so a copy that drifted on a value only the other
 * table lists would stay green on both. This file runs one environment table through both and compares: whether the leg is
 * armed, the target it resolves, the inert target it falls back to, and the variables an armed leg is missing.
 *
 * Reads only the `env` it passes; no IRIS is contacted.
 */

import { describe, expect, it } from "vitest";
import { liveGateTarget as launcherGate } from "../../../../extensions/iris-mcp-launcher/src/__tests__/liveArming.js";
import { liveGateTarget as sharedGate } from "../../../shared/src/test-helpers/live-target.js";

type Env = Record<string, string | undefined>;

const FULL: Record<string, string> = {
  IRIS_HOST: "iris.example.test",
  IRIS_PORT: "4321",
  IRIS_USERNAME: "tester",
  IRIS_PASSWORD: "secret-pass",
  IRIS_NAMESPACE: "SCRATCH",
};

function without(env: Env, key: string): Env {
  const copy = { ...env };
  delete copy[key];
  return copy;
}

const ENVIRONMENTS: Array<[string, Env]> = [
  ["an empty environment", {}],
  ["IRIS_HOST alone", { IRIS_HOST: "iris.example.test" }],
  ["a complete target without IRIS_REQUIRE_LIVE", { ...FULL }],
  ...["0", "1", "2", "true", "TRUE", "True", "yes", "false", "", " 1", "1 ", "01", "1\n"].map(
    (value): [string, Env] => [`a complete target with IRIS_REQUIRE_LIVE=${JSON.stringify(value)}`, { ...FULL, IRIS_REQUIRE_LIVE: value }],
  ),
  ["IRIS_REQUIRE_LIVE=1 and no target", { IRIS_REQUIRE_LIVE: "1" }],
  ["IRIS_REQUIRE_LIVE=true and no target", { IRIS_REQUIRE_LIVE: "true" }],
  ...Object.keys(FULL).map((key): [string, Env] => [`IRIS_REQUIRE_LIVE=1 without ${key}`, without({ ...FULL, IRIS_REQUIRE_LIVE: "1" }, key)]),
  ["IRIS_REQUIRE_LIVE=1 with an empty password", { ...FULL, IRIS_REQUIRE_LIVE: "1", IRIS_PASSWORD: "" }],
  ["IRIS_REQUIRE_LIVE=1 with an undefined namespace and an empty password", { ...FULL, IRIS_REQUIRE_LIVE: "1", IRIS_NAMESPACE: undefined, IRIS_PASSWORD: "" }],
  ["IRIS_REQUIRE_LIVE=0 and no target", { IRIS_REQUIRE_LIVE: "0" }],
];

/** What an environment resolves to, as the part of the contract both sides share. */
function outcomeOf(resolve: () => { skipReason: string | undefined; target: { host: string; port: string | number; username: string; password: string; namespace: string } }) {
  try {
    const gate = resolve();
    return {
      kind: gate.skipReason === undefined ? "armed" : "unarmed",
      skipNamesArming: gate.skipReason === undefined ? undefined : gate.skipReason.includes("IRIS_REQUIRE_LIVE=1"),
      target: {
        host: gate.target.host,
        port: Number(gate.target.port),
        username: gate.target.username,
        password: gate.target.password,
        namespace: gate.target.namespace,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "throws", missing: /but (.+?) (?:is|are) not set/.exec(message)?.[1] ?? message };
  }
}

describe("the launcher's liveGateTarget and the shared liveGateTarget agree", () => {
  it("the table covers armed, unarmed and throwing environments (a table of one kind would compare nothing)", () => {
    const kinds = new Set(ENVIRONMENTS.map(([, env]) => outcomeOf(() => sharedGate(env)).kind));

    expect([...kinds].sort()).toEqual(["armed", "throws", "unarmed"]);
  });

  it.each(ENVIRONMENTS)("%s", (_label, env) => {
    expect(outcomeOf(() => launcherGate(env))).toEqual(outcomeOf(() => sharedGate(env)));
  });

  it("the two inert targets are the same host, and neither is a default IRIS port", () => {
    const launcher = launcherGate({});
    const shared = sharedGate({});

    expect(launcher.target.host).toBe(shared.target.host);
    expect(Number(launcher.target.port)).toBe(Number(shared.target.port));
    expect([52773, 1972]).not.toContain(launcher.target.port);
  });
});
