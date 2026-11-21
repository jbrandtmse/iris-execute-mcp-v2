/**
 * Pins the arming contract of `liveArming.ts`, the launcher's live-IRIS test gate: only `IRIS_REQUIRE_LIVE` set to exactly
 * `1` or `true` arms it (a set `IRIS_HOST` does not), unarmed it names an inert target and a skip reason, and armed it
 * requires all five target variables, throwing with the missing ones named. Pure: it reads only the `env` it is given.
 */
import { describe, expect, it } from "vitest";
import { liveGateTarget } from "./liveArming.js";

const FULL = {
  IRIS_HOST: "iris.example.test",
  IRIS_PORT: "1972",
  IRIS_USERNAME: "tester",
  IRIS_PASSWORD: "secret",
  IRIS_NAMESPACE: "SCRATCH",
};

describe("liveGateTarget", () => {
  it("is unarmed with an empty environment, naming a skip reason and an inert target", () => {
    const gate = liveGateTarget({});
    expect(gate.skipReason).toContain("IRIS_REQUIRE_LIVE=1");
    expect(gate.target.host).toBe("unarmed.invalid");
  });

  it("is not armed by IRIS_HOST alone, nor by a complete target without IRIS_REQUIRE_LIVE", () => {
    expect(liveGateTarget({ IRIS_HOST: "iris.example.test" }).skipReason).toBeDefined();
    expect(liveGateTarget({ ...FULL }).skipReason).toBeDefined();
    expect(liveGateTarget({ ...FULL }).target.host).toBe("unarmed.invalid");
  });

  it.each(["0", "yes", "TRUE", "", "2"])("is not armed by IRIS_REQUIRE_LIVE=%j", (value) => {
    expect(liveGateTarget({ ...FULL, IRIS_REQUIRE_LIVE: value }).skipReason).toBeDefined();
  });

  it("throws naming all five variables when armed with no target", () => {
    expect(() => liveGateTarget({ IRIS_REQUIRE_LIVE: "1" })).toThrow(
      /IRIS_HOST, IRIS_PORT, IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE are not set/,
    );
  });

  it("throws naming only the missing or empty variables when armed with part of a target", () => {
    expect(() => liveGateTarget({ ...FULL, IRIS_REQUIRE_LIVE: "true", IRIS_PASSWORD: undefined, IRIS_NAMESPACE: "" })).toThrow(
      /but IRIS_PASSWORD, IRIS_NAMESPACE are not set/,
    );
  });

  it.each(["1", "true"])("is armed by IRIS_REQUIRE_LIVE=%s with the five variables, and returns that target", (value) => {
    const gate = liveGateTarget({ ...FULL, IRIS_REQUIRE_LIVE: value });
    expect(gate.skipReason).toBeUndefined();
    expect(gate.target).toEqual({
      host: "iris.example.test",
      port: 1972,
      username: "tester",
      password: "secret",
      namespace: "SCRATCH",
    });
  });
});
