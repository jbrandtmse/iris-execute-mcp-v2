/**
 * Story 14.1 — QA complementary coverage for D8 lazy per-profile bootstrap.
 *
 * ADDITIVE to the dev's `server-base.test.ts` per-profile registry suite,
 * which proves lazy establishment + isolation but does not pin the D8
 * "bootstrap attempted AT MOST ONCE per profile" contract. This file isolates
 * that contract by mocking the `bootstrap` orchestration (so the assertion is
 * a clean call-count, decoupled from the bootstrap internals / embedded hash)
 * and driving `getOrCreateClient` repeatedly.
 *
 * Mocking `../bootstrap.js` (the exact module `server-base.ts` imports from) is
 * an established project pattern (cf. `vi.mock("node:fs")` in iris-dev-mcp's
 * `load.test.ts`). The mock spreads the real module and overrides only
 * `bootstrap`, so the barrel's other bootstrap re-exports are unaffected.
 *
 * Provable WITHOUT a live IRIS server (vitest, mocked fetch + module spy).
 * No `BOOTSTRAP_VERSION` impact — TypeScript-only.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BootstrapResult } from "../bootstrap.js";

// A successful, no-op bootstrap result (REST service already current).
const okBootstrap: BootstrapResult = {
  probeFound: true,
  probeStatus: "current",
  deployed: true,
  compiled: true,
  configured: true,
  mapped: true,
  unitTestRootEnsured: true,
  errors: [],
};

// Mock ONLY the `bootstrap` export; keep every other real export intact so the
// shared barrel and server-base's other imports continue to work.
const bootstrapSpy = vi.fn(async () => okBootstrap);
vi.mock("../bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bootstrap.js")>();
  return { ...actual, bootstrap: bootstrapSpy };
});

// Import AFTER vi.mock so server-base picks up the mocked bootstrap.
const { McpServerBase } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;

// ── Helpers ─────────────────────────────────────────────────────────

/** Atelier version-negotiation response body (major 8). */
function versionResponse(): Response {
  return new Response(
    JSON.stringify({
      status: { errors: [] },
      console: [],
      result: { version: "8.0.0" },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeServerOpts(needsCustomRest = false): McpServerBaseOptions {
  return {
    name: "test-server",
    version: "1.0.0",
    tools: [],
    needsCustomRest,
  };
}

describe("D8 lazy per-profile bootstrap — attempted at most once (AC 14.1.7)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv = {
    IRIS_USERNAME: process.env.IRIS_USERNAME,
    IRIS_PASSWORD: process.env.IRIS_PASSWORD,
    IRIS_HOST: process.env.IRIS_HOST,
    IRIS_PROFILES: process.env.IRIS_PROFILES,
  };

  beforeEach(() => {
    bootstrapSpy.mockClear();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);

    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_PROFILES = JSON.stringify({
      other: { host: "other.example.com" },
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    exitMock.mockRestore();
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("bootstraps a non-default profile exactly once across repeated custom-REST calls", async () => {
    // start(): default profile health check + negotiation. needsCustomRest=false
    // so start() does NOT bootstrap the default profile — keeps the call count
    // attributable to the non-default lazy path only.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(makeServerOpts(false));
    await server.start("stdio");
    expect(bootstrapSpy).not.toHaveBeenCalled();

    // First custom-REST touch of "other": health + negotiation + bootstrap(once).
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    const r1 = await server.getOrCreateClient("other", true);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);

    // Second + third custom-REST touch: cached client, bootstrap NOT re-attempted.
    const r2 = await server.getOrCreateClient("other", true);
    const r3 = await server.getOrCreateClient("other", true);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);

    // Same cached client instance throughout (isolation + caching sanity).
    expect(r2.client).toBe(r1.client);
    expect(r3.client).toBe(r1.client);
  });

  it("bootstrap targets the profile's OWN config (its host), not the default", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    const server = new McpServerBase(makeServerOpts(false));
    await server.start("stdio");

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    await server.getOrCreateClient("other", true);

    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
    // bootstrap(client, profileConfig, version) — 2nd arg is the profile config.
    const [, profileConfig] = bootstrapSpy.mock.calls[0] as unknown as [
      unknown,
      { host: string; name: string },
      number,
    ];
    expect(profileConfig.host).toBe("other.example.com");
    expect(profileConfig.name).toBe("other");
  });

  it("an Atelier-only call (needsBootstrap=false) never attempts bootstrap", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    const server = new McpServerBase(makeServerOpts(false));
    await server.start("stdio");

    // Establish "other" via an Atelier-only path (no bootstrap).
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    await server.getOrCreateClient("other", false);
    expect(bootstrapSpy).not.toHaveBeenCalled();

    // A LATER custom-REST call on the same profile then bootstraps once
    // (first custom-REST use, even though the client already existed).
    await server.getOrCreateClient("other", true);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);

    // And a subsequent custom-REST call does not bootstrap again.
    await server.getOrCreateClient("other", true);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });

  it("bootstrap failure on a non-default profile does not throw (graceful, logged)", async () => {
    // The non-default client still establishes (health+negotiation succeed);
    // only bootstrap rejects. getOrCreateClient must resolve, not reject.
    bootstrapSpy.mockRejectedValueOnce(new Error("deploy blew up"));

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    const server = new McpServerBase(makeServerOpts(false));
    await server.start("stdio");

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    await expect(server.getOrCreateClient("other", true)).resolves.toBeDefined();
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);

    // Still marked attempted → not retried on the next custom-REST call.
    await server.getOrCreateClient("other", true);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });

  // Regression (code-review HIGH): start() must NOT pre-mark the default
  // profile as bootstrapAttempted when this server has needsCustomRest:false.
  // Otherwise a later first custom-REST use of the DEFAULT profile (the seam
  // Story 14.2 wires) would skip the default's bootstrap forever — the same
  // bug the non-default path avoids by seeding bootstrapAttempted:false.
  it("default profile's first custom-REST use bootstraps once when started with needsCustomRest:false", async () => {
    // needsCustomRest:false → start() does NOT bootstrap the default profile.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    const server = new McpServerBase(makeServerOpts(false));
    await server.start("stdio");
    expect(bootstrapSpy).not.toHaveBeenCalled();

    // First custom-REST touch of the DEFAULT profile: bootstrap must run once.
    // (Default client already established in start(), so no new health/version
    // fetches are needed — the existingMeta branch attempts bootstrap.)
    const r1 = await server.getOrCreateClient("default", true);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
    // Targets the default profile's own config.
    const [, profileConfig] = bootstrapSpy.mock.calls[0] as unknown as [
      unknown,
      { name: string },
      number,
    ];
    expect(profileConfig.name).toBe("default");

    // Subsequent custom-REST calls do not re-bootstrap the default.
    const r2 = await server.getOrCreateClient("default", true);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
    expect(r2.client).toBe(r1.client);
  });

  it("default profile is NOT re-bootstrapped on first getOrCreateClient when started with needsCustomRest:true", async () => {
    // needsCustomRest:true → start() bootstraps the default profile once.
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    fetchMock.mockResolvedValueOnce(versionResponse());
    const server = new McpServerBase(makeServerOpts(true));
    await server.start("stdio");
    expect(bootstrapSpy).toHaveBeenCalledTimes(1); // start()'s bootstrap

    // A custom-REST call on the default profile must NOT bootstrap again —
    // start() already did it (bootstrapAttempted seeded true for this server).
    await server.getOrCreateClient("default", true);
    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
  });
});
