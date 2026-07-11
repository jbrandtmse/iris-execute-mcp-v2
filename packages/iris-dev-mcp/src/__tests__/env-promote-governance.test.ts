/**
 * Story 27.2 — governance-defaults proof for `iris_env_promote`.
 *
 * `iris_env_promote` adds TWO new post-foundation governance keys to the
 * iris-dev-mcp server (`iris_env_promote:plan`, `iris_env_promote:execute`),
 * both absent from the frozen `governance-baseline.ts` (`1e62c5ad5bf7`). This
 * suite proves END-TO-END, through the REAL `McpServerBase.handleToolCall`
 * gate (NOT a mocked policy), that:
 *
 *   - Under EMPTY `IRIS_GOVERNANCE`, `plan` (read) is ALLOWED (handler runs).
 *   - Under EMPTY `IRIS_GOVERNANCE`, `execute` (write) is DENIED with the
 *     structured `GOVERNANCE_DISABLED` code keyed `iris_env_promote:execute`,
 *     and the handler is NEVER invoked (Rule #32 -- deliberately NOT
 *     `defaultEnabled`, unlike `iris_production_control:clean`).
 *   - An explicit `IRIS_GOVERNANCE` enable of `execute` flips just that
 *     action (per-action granularity); `plan` stays enabled independently.
 *   - An explicit `IRIS_GOVERNANCE` disable of `plan` can still override its
 *     read default-enable.
 *
 * Mirrors `env-diff-governance.test.ts` and `message-resend-governance.test.ts`.
 * Runs in the DEFAULT vitest suite (Rule #21) -- no live IRIS; the default
 * profile's startup HEAD/GET are stubbed via a fetch mock, and the tool
 * handler is replaced with a spy so invocation/non-invocation is observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { envPromoteTool } from "../tools/env-promote.js";

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
    name: "@iris-mcp/dev",
    version: "0.0.0",
    tools,
    needsCustomRest: false,
  };
}

/**
 * Replace the real handler with a spy, preserving every governance-relevant
 * field (name, inputSchema with the `action` enum, `mutates`, scope). The
 * gate computes the governance key from `inputSchema.shape.action` and
 * `mutates`, so keeping the REAL schema + `mutates` is what makes this an
 * end-to-end proof.
 */
function spiedTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...envPromoteTool, handler: spy };
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
// Story 27.2 governance defaults — `plan` read/enabled, `execute` write/disabled.
// ════════════════════════════════════════════════════════════════════

describe("iris_env_promote governance default (Story 27.2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("under EMPTY IRIS_GOVERNANCE, `plan` is ALLOWED (read default-enabled; handler runs)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { steps: [], warnings: [], summary: { stepCount: 0, warningCount: 0 } },
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_env_promote", {
      action: "plan",
      source: "default",
      target: "default",
      diff: {},
    });

    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("under EMPTY IRIS_GOVERNANCE, `execute` is DENIED with GOVERNANCE_DISABLED; handler NOT called", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_env_promote", {
      action: "execute",
      source: "default",
      target: "default",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_env_promote:execute",
      server: "default",
    });
    expect(result.content[0].text).toContain("iris_env_promote:execute");
    expect(handlerSpy).not.toHaveBeenCalled();
    // No IRIS traffic beyond the profile's own startup handshake — a denied
    // call must not reach the network.
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("registers without throwing (both NEW keys carry a per-action `mutates` class)", async () => {
    stageDefaultStartup(env.fetchMock);
    // Construction + start() runs assertGovernanceClassification; absence of a
    // throw here is the registration-time proof for both non-baseline keys.
    const server = new McpServerBase(makeServerOpts([envPromoteTool]));
    await expect(server.start("stdio")).resolves.not.toThrow();
  });

  it("an explicit IRIS_GOVERNANCE enable of `execute` FLIPS just that action (per-action granularity)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_env_promote:execute": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_env_promote", {
      action: "execute",
      source: "default",
      target: "default",
    });
    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // `plan` was never touched by the opt-in — it stays enabled on its own
    // (read) default, proving per-action independence.
    const planResult = await callTool(server, "iris_env_promote", {
      action: "plan",
      source: "default",
      target: "default",
      diff: {},
    });
    expect(planResult.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(2);
  });

  it("an explicit IRIS_GOVERNANCE disable of `plan` overrides its read default-enable", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_env_promote:plan": false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_env_promote", {
      action: "plan",
      source: "default",
      target: "default",
      diff: {},
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_env_promote:plan",
    });
    expect(handlerSpy).not.toHaveBeenCalled();

    // `execute` remains independently denied (its own default, untouched by this override).
    const executeResult = await callTool(server, "iris_env_promote", {
      action: "execute",
      source: "default",
      target: "default",
    });
    expect(executeResult.isError).toBe(true);
    expect(executeResult.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_env_promote:execute",
    });
  });
});
