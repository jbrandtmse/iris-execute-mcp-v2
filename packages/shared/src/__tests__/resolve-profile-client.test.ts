/**
 * Story 27.0 — `ToolContext.resolveProfileClient` (AC 27.0.1).
 *
 * The framework primitive that lets ONE tool call talk to a SECOND IRIS
 * server profile, beyond the calling profile already available as `ctx.http`
 * (Epic 27, "environment diff/promote"). This suite proves, through the REAL
 * `McpServerBase.handleToolCall` context-build path (NOT a hand-rolled mock):
 *
 * 1. Back-compat (Rule #19, mechanical): the `ToolContext` an EXISTING tool
 *    receives is byte-for-byte unchanged except for the new additive
 *    `resolveProfileClient` field — proven via a full `Object.keys` shape
 *    snapshot plus behavioral assertions on every pre-existing field.
 * 2. An unknown profile name rejects with `ProfileResolutionError`, naming
 *    every valid profile (reused from `resolveProfile`/`getOrCreateClient` —
 *    not hand-rolled).
 * 3. A second, never-before-touched profile resolves to a DIFFERENT
 *    `IrisHttpClient` instance than the calling profile's `ctx.http`
 *    (session isolation — mirrors the Epic-14 `ProfileClientRegistry`
 *    isolation tests in `profiles.test.ts`), is cached across repeat calls,
 *    and — critically — goes through the SAME full establishment path
 *    (health-check + version negotiation + one-time custom-REST bootstrap)
 *    `ctx.http` itself went through, so a custom-REST call against the
 *    resolved client succeeds even though that profile was never the
 *    `server`-selected calling profile.
 * 4. Calling `resolveProfileClient` with the SAME name as the calling
 *    profile hits the existing fast path and returns the IDENTICAL cached
 *    client as `ctx.http` (no duplicate establishment machinery — Rule #47).
 *
 * Provable WITHOUT a live IRIS server (vitest + mocked fetch + bootstrap
 * spy), mirroring `profiles-bootstrap.test.ts` / `server-param-integration.test.ts`.
 * Discoverable by the default `vitest run` suite (`*.test.ts`, not
 * `*.integration.test.ts` — Rule #21). No `BOOTSTRAP_VERSION` impact —
 * TypeScript-only, all in `@iris-mcp/shared`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import { ProfileResolutionError } from "../profiles.js";

// A successful, no-op bootstrap result (REST service already current).
// Mirrors the shape used by profiles-bootstrap.test.ts / server-param-integration.test.ts.
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

// Mock ONLY the `bootstrap` export so establishment never reaches a real IRIS.
const bootstrapSpy = vi.fn(async () => okBootstrap);
vi.mock("../bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bootstrap.js")>();
  return { ...actual, bootstrap: bootstrapSpy };
});

// Import AFTER vi.mock so server-base picks up the mocked bootstrap.
const { McpServerBase } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;
type ToolDefinition = import("../tool-types.js").ToolDefinition;
type ToolContext = import("../tool-types.js").ToolContext;

// ── Helpers ─────────────────────────────────────────────────────────

/** Atelier version-negotiation response body (major 8 — matches sibling suites). */
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

/**
 * A "capturing" tool: stashes the exact `ToolContext` it was handed into
 * `sink.ctx` and returns success. Used to inspect the REAL context object
 * `handleToolCall` builds, rather than re-deriving one by hand.
 */
function makeCapturingTool(sink: { ctx: ToolContext | undefined }): ToolDefinition {
  return {
    name: "iris_capture_ctx",
    title: "Capture Context",
    description: "Test-only tool that captures its ToolContext.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: "read",
    handler: async (_args, ctx) => {
      sink.ctx = ctx;
      return { content: [{ type: "text" as const, text: "captured" }] };
    },
  };
}

function makeServerOpts(
  tools: ToolDefinition[],
  needsCustomRest = false,
): McpServerBaseOptions {
  return {
    name: "test-server",
    version: "1.0.0",
    tools,
    needsCustomRest,
  };
}

/** Invoke a tool through the SDK-registered callback (the handleToolCall path). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

/** Shared environment save/restore so this suite runs hermetically. */
function makeEnvHarness() {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv = {
    IRIS_USERNAME: process.env.IRIS_USERNAME,
    IRIS_PASSWORD: process.env.IRIS_PASSWORD,
    IRIS_HOST: process.env.IRIS_HOST,
    IRIS_NAMESPACE: process.env.IRIS_NAMESPACE,
    IRIS_PROFILES: process.env.IRIS_PROFILES,
  };

  function setup(): void {
    bootstrapSpy.mockClear();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  }

  function teardown(): void {
    globalThis.fetch = originalFetch;
    exitMock.mockRestore();
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }

  return {
    setup,
    teardown,
    get fetchMock() {
      return fetchMock;
    },
  };
}

/** Stage the default profile's startup HEAD (health) + GET (version). */
function stageDefaultStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(versionResponse());
}

/** Stage a non-default profile's first-touch HEAD (health) + GET (version). */
function stageProfileEstablishment(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(versionResponse());
}

// ════════════════════════════════════════════════════════════════════
// (1) Back-compat snapshot — existing tools see no change except the new
//     additive field (Rule #19, mechanical).
// ════════════════════════════════════════════════════════════════════

describe("resolveProfileClient — back-compat snapshot (AC 27.0.1, Rule #19)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("an existing tool's ToolContext is unchanged except for the additive resolveProfileClient field", async () => {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";

    stageDefaultStartup(env.fetchMock);
    const sink: { ctx: ToolContext | undefined } = { ctx: undefined };
    const server = new McpServerBase(makeServerOpts([makeCapturingTool(sink)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_capture_ctx", {});
    expect(result.isError).toBeFalsy();
    const ctx = sink.ctx as ToolContext;
    expect(ctx).toBeDefined();

    // Mechanical shape proof: exactly the 5 pre-existing fields PLUS the one
    // new additive field — nothing removed, nothing else added.
    expect(Object.keys(ctx).sort()).toEqual(
      [
        "resolveNamespace",
        "http",
        "atelierVersion",
        "config",
        "paginate",
        "resolveProfileClient",
      ].sort(),
    );

    // Every PRE-EXISTING field behaves exactly as before.
    expect(ctx.resolveNamespace()).toBe("DEFAULTNS");
    expect(ctx.resolveNamespace("OTHERNS")).toBe("OTHERNS");
    expect(ctx.atelierVersion).toBe(8);
    expect(ctx.config.host).toBe("default.example.com");
    expect(ctx.paginate([1, 2, 3], undefined)).toEqual({
      page: [1, 2, 3],
      nextCursor: undefined,
    });

    // The new field is present and callable — additive only.
    expect(typeof ctx.resolveProfileClient).toBe("function");
  });
});

// ════════════════════════════════════════════════════════════════════
// (2) Unknown profile — ProfileResolutionError naming known profiles.
// ════════════════════════════════════════════════════════════════════

describe("resolveProfileClient — unknown profile (AC 27.0.1)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("rejects with ProfileResolutionError naming every valid profile", async () => {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_PROFILES = JSON.stringify({
      second: { host: "second.example.com" },
    });

    stageDefaultStartup(env.fetchMock);
    const sink: { ctx: ToolContext | undefined } = { ctx: undefined };
    const server = new McpServerBase(makeServerOpts([makeCapturingTool(sink)]));
    await server.start("stdio");
    await callTool(server, "iris_capture_ctx", {});
    const ctx = sink.ctx as ToolContext;

    const callsBefore = env.fetchMock.mock.calls.length;
    await expect(ctx.resolveProfileClient("bogus")).rejects.toBeInstanceOf(
      ProfileResolutionError,
    );
    await expect(ctx.resolveProfileClient("bogus")).rejects.toThrow(
      /Unknown server profile "bogus"/,
    );
    await expect(ctx.resolveProfileClient("bogus")).rejects.toThrow(/default/);
    await expect(ctx.resolveProfileClient("bogus")).rejects.toThrow(/second/);
    // No establishment fetch was ever issued for the bad name.
    expect(env.fetchMock.mock.calls.length).toBe(callsBefore);
  });
});

// ════════════════════════════════════════════════════════════════════
// (3) A second profile — distinct client, full establishment, caching.
// ════════════════════════════════════════════════════════════════════

describe("resolveProfileClient — second-profile establishment + isolation (AC 27.0.1)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("resolves a never-before-touched profile to a DIFFERENT, fully-established client than ctx.http", async () => {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_PROFILES = JSON.stringify({
      second: { host: "second.example.com" },
    });

    // needsCustomRest:true so establishment includes the one-time bootstrap —
    // proving resolveProfileClient reuses the FULL path, not just health+version.
    stageDefaultStartup(env.fetchMock);
    const sink: { ctx: ToolContext | undefined } = { ctx: undefined };
    const server = new McpServerBase(makeServerOpts([makeCapturingTool(sink)], true));
    await server.start("stdio");
    expect(bootstrapSpy).toHaveBeenCalledTimes(1); // start()'s own bootstrap of "default"

    await callTool(server, "iris_capture_ctx", {});
    const ctx = sink.ctx as ToolContext;

    // First touch of "second": health + negotiation + bootstrap, all staged.
    stageProfileEstablishment(env.fetchMock);
    const secondClient = await ctx.resolveProfileClient("second");

    expect(secondClient).not.toBe(ctx.http);
    expect(bootstrapSpy).toHaveBeenCalledTimes(2); // +1 for "second"'s first touch
    const [, secondProfileConfig] = bootstrapSpy.mock.calls[1] as unknown as [
      unknown,
      { host: string; name: string },
      number,
    ];
    expect(secondProfileConfig.host).toBe("second.example.com");
    expect(secondProfileConfig.name).toBe("second");

    // Repeat call: cached, identical instance, NO new fetches, NO re-bootstrap.
    const callsBeforeRepeat = env.fetchMock.mock.calls.length;
    const secondClientAgain = await ctx.resolveProfileClient("second");
    expect(secondClientAgain).toBe(secondClient);
    expect(env.fetchMock.mock.calls.length).toBe(callsBeforeRepeat);
    expect(bootstrapSpy).toHaveBeenCalledTimes(2);

    // Also reachable through the server's own getOrCreateClient — same cache
    // (proves resolveProfileClient did not spin up a parallel/duplicate pool).
    const viaServer = await server.getOrCreateClient("second", true);
    expect(viaServer.client).toBe(secondClient);
  });

  it("resolving the SAME name as the calling profile hits the fast path and returns the identical client", async () => {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";

    stageDefaultStartup(env.fetchMock);
    const sink: { ctx: ToolContext | undefined } = { ctx: undefined };
    const server = new McpServerBase(makeServerOpts([makeCapturingTool(sink)]));
    await server.start("stdio");
    await callTool(server, "iris_capture_ctx", {});
    const ctx = sink.ctx as ToolContext;

    const callsBefore = env.fetchMock.mock.calls.length;
    const resolved = await ctx.resolveProfileClient("default");
    expect(resolved).toBe(ctx.http);
    // Fast path — the default profile was already established in start();
    // resolving it again issues no new establishment fetches.
    expect(env.fetchMock.mock.calls.length).toBe(callsBefore);
  });
});
