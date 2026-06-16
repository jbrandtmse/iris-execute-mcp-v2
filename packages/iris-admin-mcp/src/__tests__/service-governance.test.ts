/**
 * Story 15.1 AC 15.1.2 — the headline AI#3 verification.
 *
 * `iris_service_manage` is the FIRST real governed write tool in the suite and
 * the first consumer of Story 15.0's `mutates`/default-seed machinery. This
 * suite proves END-TO-END, through the REAL `McpServerBase.handleToolCall` gate
 * (NOT a mocked policy and NOT the pure governance engine in isolation), that:
 *
 *   - Under EMPTY `IRIS_GOVERNANCE`, a write action (`enable`) is DENIED with the
 *     structured `GOVERNANCE_DISABLED` code keyed `iris_service_manage:enable`,
 *     and the handler is NEVER invoked (no IRIS call escapes).
 *   - Under empty config, a read action (`list`) is ALLOWED (its handler runs).
 *   - An explicit `IRIS_GOVERNANCE` enable of the write FLIPS it to allowed.
 *
 * This is the AI#3 ("verify the `mutates:'write'` seed actually disables it by
 * default end-to-end") proof. It runs in the DEFAULT vitest suite (`*.test.ts`,
 * NOT `*.integration.test.ts`) — no live IRIS; the default profile's startup
 * HEAD/GET are stubbed via a fetch mock, and the tool handler is replaced with a
 * spy so we can assert non-invocation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { serviceManageTool } from "../tools/service.js";

// ── Harness ─────────────────────────────────────────────────────────

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

/** Invoke a tool through the SDK-registered callback (the handleToolCall path). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

function makeServerOpts(tools: ToolDefinition[]): McpServerBaseOptions {
  return {
    name: "@iris-mcp/admin",
    version: "0.0.0",
    // needsCustomRest:false so start() performs only the HEAD (health) + GET
    // (version) fetches and never reaches the bootstrap network path — keeping
    // this a pure governance-gate test with a minimal fetch stub.
    tools,
    needsCustomRest: false,
  };
}

/**
 * Replace the real handler with a spy, preserving every governance-relevant
 * field (name, inputSchema with the `action` enum, `mutates`, scope). The gate
 * computes the governance key from `inputSchema.shape.action` and `mutates`, so
 * keeping the REAL schema + `mutates` is what makes this an end-to-end proof
 * rather than a synthetic one.
 */
function spiedServiceTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...serviceManageTool, handler: spy };
}

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
    IRIS_GOVERNANCE: process.env.IRIS_GOVERNANCE,
  };

  function setup(): void {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    delete process.env.IRIS_GOVERNANCE;
    delete process.env.IRIS_PROFILES;
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
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

// ════════════════════════════════════════════════════════════════════
// AC 15.1.2 — writes default-disabled; reads default-enabled; opt-in flips.
// ════════════════════════════════════════════════════════════════════

describe("iris_service_manage governance default (AC 15.1.2 — AI#3 verification)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("under EMPTY IRIS_GOVERNANCE, `enable` is denied with GOVERNANCE_DISABLED; handler NOT called", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedServiceTool(handlerSpy)]),
    );
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_service_manage", {
      action: "enable",
      name: "%Service_Telnet",
    });

    // Structured denial keyed to the per-action governance key.
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_service_manage:enable",
      server: "default",
    });
    expect(result.content[0].text).toContain("iris_service_manage:enable");
    // The handler never ran — the gate short-circuited before dispatch, and no
    // additional IRIS fetch occurred for the denied call.
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("under EMPTY IRIS_GOVERNANCE, `disable` and `set` are likewise denied (all writes)", async () => {
    stageDefaultStartup(env.fetchMock);
    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedServiceTool(handlerSpy)]),
    );
    await server.start("stdio");

    for (const action of ["disable", "set"]) {
      const result = await callTool(server, "iris_service_manage", {
        action,
        name: "%Service_Telnet",
      });
      expect(result.isError, `${action} must be denied`).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: "GOVERNANCE_DISABLED",
        action: `iris_service_manage:${action}`,
      });
    }
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("under EMPTY IRIS_GOVERNANCE, the read action `list` is ALLOWED (handler runs)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { services: [], count: 0 },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedServiceTool(handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_service_manage", {
      action: "list",
    });

    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("an explicit IRIS_GOVERNANCE enable of the write FLIPS it to allowed", async () => {
    // Operator opts in: enable the seed-disabled write globally.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_service_manage:enable": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "enable", success: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedServiceTool(handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_service_manage", {
      action: "enable",
      name: "%Service_Telnet",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ action: "enable", success: true });
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // `disable` was NOT enabled by the opt-in, so it remains denied — proving the
    // per-action granularity (enabling one write key does not enable the others).
    const denied = await callTool(server, "iris_service_manage", {
      action: "disable",
      name: "%Service_Telnet",
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_service_manage:disable",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});
