/**
 * Story 42.2 (DW-627) QA - the integration-test config factory and availability probe, through which the eleven integration
 * files of families E reach IRIS: `getIntegrationConfig` (`../test-helpers/integration-config.ts`, re-exported by
 * `integration-helpers.ts`) and `isIrisAvailable`.
 *
 * Both are driven here with the environment of the test process and a stubbed `fetch`; no IRIS is contacted. They pin what
 * the migrated integration files rely on and no default-suite test reached before: an unarmed run gets the inert target
 * whatever the environment holds, an armed run gets exactly the five `IRIS_*` variables (a missing one throws, naming it),
 * `overrides` replace single settings, and `isIrisAvailable` makes no request unless armed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getIntegrationConfig } from "../test-helpers/integration-config.js";
import { UNARMED_LIVE_TARGET } from "../test-helpers/live-target.js";
import { getIntegrationConfig as helpersGetIntegrationConfig, isIrisAvailable } from "./integration-helpers.js";

const KEYS = [
  "IRIS_REQUIRE_LIVE",
  "IRIS_HOST",
  "IRIS_PORT",
  "IRIS_USERNAME",
  "IRIS_PASSWORD",
  "IRIS_NAMESPACE",
  "IRIS_HTTPS",
] as const;

const TARGET = {
  IRIS_HOST: "iris.example.test",
  IRIS_PORT: "4321",
  IRIS_USERNAME: "tester",
  IRIS_PASSWORD: "secret-pass",
  IRIS_NAMESPACE: "SCRATCH",
};

const saved: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of KEYS) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function setEnv(env: Record<string, string>): void {
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
}

describe("getIntegrationConfig", () => {
  it("unarmed, it is the inert target even when a complete target is in the environment (a set IRIS_HOST does not arm)", () => {
    setEnv(TARGET);

    const config = getIntegrationConfig();

    expect(config.host).toBe(UNARMED_LIVE_TARGET.host);
    expect(config.port).toBe(Number(UNARMED_LIVE_TARGET.port));
    expect(config.username).toBe(UNARMED_LIVE_TARGET.username);
    expect(config.namespace).toBe(UNARMED_LIVE_TARGET.namespace);
    expect(config.baseUrl).toBe(`http://${UNARMED_LIVE_TARGET.host}:${UNARMED_LIVE_TARGET.port}`);
  });

  it.each(["0", "yes", "TRUE", ""])("IRIS_REQUIRE_LIVE=%j does not arm it either", (value) => {
    setEnv({ ...TARGET, IRIS_REQUIRE_LIVE: value });

    expect(getIntegrationConfig().host).toBe(UNARMED_LIVE_TARGET.host);
  });

  it.each(["1", "true"])("armed by IRIS_REQUIRE_LIVE=%s, it is exactly the five IRIS_* variables, over http unless IRIS_HTTPS is true", (value) => {
    setEnv({ ...TARGET, IRIS_REQUIRE_LIVE: value });

    const config = getIntegrationConfig();

    expect(config.host).toBe("iris.example.test");
    expect(config.port).toBe(4321);
    expect(config.username).toBe("tester");
    expect(config.password).toBe("secret-pass");
    expect(config.namespace).toBe("SCRATCH");
    expect(config.https).toBe(false);
    expect(config.baseUrl).toBe("http://iris.example.test:4321");
  });

  it("armed with IRIS_HTTPS=true, it selects https", () => {
    setEnv({ ...TARGET, IRIS_REQUIRE_LIVE: "1", IRIS_HTTPS: "true" });

    const config = getIntegrationConfig();

    expect(config.https).toBe(true);
    expect(config.baseUrl).toBe("https://iris.example.test:4321");
  });

  it.each(Object.keys(TARGET))("armed without %s, it throws naming that variable, and falls back to no default instance", (missing) => {
    const env: Record<string, string> = { IRIS_REQUIRE_LIVE: "1", ...TARGET };
    delete env[missing];
    setEnv(env);

    expect(() => getIntegrationConfig()).toThrow(new RegExp(`but ${missing} is not set\\.`));
  });

  it("overrides replace single settings of the resolved target and leave the others", () => {
    setEnv({ ...TARGET, IRIS_REQUIRE_LIVE: "1" });

    const config = getIntegrationConfig({ IRIS_NAMESPACE: "OTHER", IRIS_USERNAME: "other-user" });

    expect(config.namespace).toBe("OTHER");
    expect(config.username).toBe("other-user");
    expect(config.host).toBe("iris.example.test");
    expect(config.port).toBe(4321);
    expect(config.password).toBe("secret-pass");
  });

  it("unarmed, an override still applies to the inert target and the host stays the inert one", () => {
    const config = getIntegrationConfig({ IRIS_NAMESPACE: "OTHER" });

    expect(config.namespace).toBe("OTHER");
    expect(config.host).toBe(UNARMED_LIVE_TARGET.host);
  });

  it("is the one function the integration helpers re-export", () => {
    expect(helpersGetIntegrationConfig).toBe(getIntegrationConfig);
  });
});

describe("isIrisAvailable", () => {
  it("unarmed, it answers false without making a request, whatever the environment holds", async () => {
    setEnv(TARGET);
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(isIrisAvailable()).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("armed, it pings the resolved target, and answers true when that target answers", async () => {
    setEnv({ ...TARGET, IRIS_REQUIRE_LIVE: "1" });
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(isIrisAvailable()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map((call) => String((call as unknown[])[0]));
    expect(urls.every((url) => url.startsWith("http://iris.example.test:4321/")), urls.join(", ")).toBe(true);
  });

  it("armed, it answers false when the target does not answer", async () => {
    setEnv({ ...TARGET, IRIS_REQUIRE_LIVE: "1" });
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    await expect(isIrisAvailable()).resolves.toBe(false);
  });

  it("armed with a variable missing, it throws instead of probing a default instance", async () => {
    setEnv({ IRIS_REQUIRE_LIVE: "1", IRIS_HOST: "iris.example.test" });
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(isIrisAvailable()).rejects.toThrow(/IRIS_PORT, IRIS_USERNAME, IRIS_PASSWORD, IRIS_NAMESPACE are not set/);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
