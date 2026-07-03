/**
 * Story 20.0 AC 20.0.5 / 20.0.9 — governance proof for `iris_production_control:clean`.
 *
 * Story 20.0 ADDS a `clean` action to the EXISTING `iris_production_control`
 * tool. `clean` is a NEW post-foundation key (absent from the frozen
 * `governance-baseline.ts`, 1e62c5ad5bf7) that is truthfully `mutates: "write"`
 * but marked `defaultEnabled: ["clean"]` (Epic 20 decision F2), so it resolves
 * ENABLED under an empty `IRIS_GOVERNANCE` — unlike a plain new write, which
 * default-disables. The 5 EXISTING keys (start/stop/restart/update/recover) ARE
 * in the frozen baseline → grandfathered → always enabled (no `mutates`).
 *
 * This suite proves END-TO-END, through the REAL `McpServerBase.handleToolCall`
 * gate (NOT a mocked policy, NOT the pure engine in isolation), that:
 *
 *   - under EMPTY `IRIS_GOVERNANCE`, `clean` is ALLOWED (handler runs) via the
 *     F2 `defaultEnabled` marker — proving the mechanism is wired through the
 *     real server, not just the pure functions (AC 20.0.5a "representative real
 *     server").
 *   - the 5 grandfathered actions are ALLOWED (handler runs).
 *   - an explicit `IRIS_GOVERNANCE` `{global:{"iris_production_control:clean":false}}`
 *     DISABLES `clean` (the cascade honors explicit `false`).
 *
 * Mirrors `item-governance.test.ts`. Runs in the DEFAULT vitest suite
 * (`*.test.ts`, NOT `*.integration.test.ts`) — no live IRIS; the default
 * profile's startup HEAD/GET are stubbed via a fetch mock, and the tool handler
 * is replaced with a spy so invocation/non-invocation is observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { productionControlTool } from "../tools/production.js";

// ── Harness (mirrors item-governance.test.ts) ───────────────────────

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
    name: "@iris-mcp/interop",
    version: "0.0.0",
    tools,
    needsCustomRest: true,
  };
}

/**
 * Replace the real handler with a spy, preserving every governance-relevant
 * field (name, inputSchema with the `action` enum, `mutates`, `defaultEnabled`,
 * scope). The gate computes the governance key from `inputSchema.shape.action`
 * and evaluates `mutates` + `defaultEnabled`, so keeping the REAL schema +
 * classification is what makes this an end-to-end proof.
 */
function spiedTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...productionControlTool, handler: spy };
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

function stageDefaultStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(versionResponse());
}

// ════════════════════════════════════════════════════════════════════
// AC 20.0.5 — clean default-ENABLED via F2; grandfathered actions enabled;
// explicit false disables.
// ════════════════════════════════════════════════════════════════════

describe("iris_production_control:clean governance default (AC 20.0.5)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("under EMPTY IRIS_GOVERNANCE, `clean` is ALLOWED (handler runs) via defaultEnabled (F2)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "cleaned", killAppData: 0 },
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_production_control", {
      action: "clean",
    });

    expect(
      result.isError,
      "clean must be enabled by default via the F2 defaultEnabled marker",
    ).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("under EMPTY IRIS_GOVERNANCE, the 5 grandfathered actions are ALLOWED (handler runs)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "ok" },
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    let calls = 0;
    for (const spec of [
      { action: "start", name: "P.Prod" },
      { action: "stop" },
      { action: "restart", name: "P.Prod" },
      { action: "update" },
      { action: "recover" },
    ]) {
      const res = await callTool(server, "iris_production_control", spec);
      expect(res.isError, `${spec.action} must be allowed (baseline-grandfathered)`).toBeFalsy();
      calls += 1;
      expect(handlerSpy).toHaveBeenCalledTimes(calls);
    }
  });

  it("an explicit IRIS_GOVERNANCE false DISABLES `clean` (cascade honors explicit false)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_production_control:clean": false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_production_control", {
      action: "clean",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_production_control:clean",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});
