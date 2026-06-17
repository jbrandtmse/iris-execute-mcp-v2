/**
 * Story 17.2 AC 17.2.5 — governance-defaults proof for `iris_production_item`.
 *
 * Story 17.2 ADDS two mutating actions (`add`/`remove`) to the EXISTING
 * `iris_production_item` tool. Those two keys are NEW post-foundation keys
 * (absent from the frozen `governance-baseline.ts`, 1e62c5ad5bf7), so the
 * Story 15.0 `mutates`/default-seed machinery governs them. The four EXISTING
 * keys (`enable`/`disable`/`get`/`set`) ARE in the frozen baseline →
 * grandfathered → always enabled (they carry no `mutates`).
 *
 * This suite proves END-TO-END, through the REAL `McpServerBase.handleToolCall`
 * gate (NOT a mocked policy, NOT the pure governance engine in isolation), that
 * under EMPTY `IRIS_GOVERNANCE`:
 *
 *   - `add`/`remove` are DENIED with the structured `GOVERNANCE_DISABLED` code
 *     keyed `iris_production_item:<action>`, and the handler is NEVER invoked.
 *   - `enable`/`disable`/`get`/`set` are ALLOWED (handler runs) — baseline-grandfathered.
 *   - An explicit `IRIS_GOVERNANCE` enable of `add` FLIPS just that action.
 *
 * Mirrors `defaultSettings-governance.test.ts`. Runs in the DEFAULT vitest suite
 * (`*.test.ts`, NOT `*.integration.test.ts`) — no live IRIS; the default
 * profile's startup HEAD/GET are stubbed via a fetch mock, and the tool handler
 * is replaced with a spy so non-invocation is observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { productionItemTool } from "../tools/item.js";

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
    name: "@iris-mcp/interop",
    version: "0.0.0",
    tools,
    needsCustomRest: true,
  };
}

/**
 * Replace the real handler with a spy, preserving every governance-relevant
 * field (name, inputSchema with the `action` enum, `mutates`, scope). The gate
 * computes the governance key from `inputSchema.shape.action` and `mutates`, so
 * keeping the REAL schema + `mutates` is what makes this an end-to-end proof.
 */
function spiedTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...productionItemTool, handler: spy };
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
// AC 17.2.5 — add/remove default-disabled; enable/disable/get/set grandfathered.
// ════════════════════════════════════════════════════════════════════

describe("iris_production_item governance default (AC 17.2.5)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("under EMPTY IRIS_GOVERNANCE, `add` is denied with GOVERNANCE_DISABLED; handler NOT called", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_production_item", {
      action: "add",
      itemName: "X",
      className: "EnsLib.File.PassthroughService",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_production_item:add",
      server: "default",
    });
    expect(result.content[0].text).toContain("iris_production_item:add");
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("under EMPTY IRIS_GOVERNANCE, `remove` is likewise denied (write)", async () => {
    stageDefaultStartup(env.fetchMock);
    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_production_item", {
      action: "remove",
      itemName: "X",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_production_item:remove",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("under EMPTY IRIS_GOVERNANCE, the grandfathered enable/disable/get/set are ALLOWED (handler runs)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "ok", itemName: "X" },
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    let calls = 0;
    for (const action of ["enable", "disable", "get", "set"]) {
      const res = await callTool(server, "iris_production_item", {
        action,
        itemName: "X",
        ...(action === "set" ? { settings: { poolSize: 1 } } : {}),
      });
      expect(res.isError, `${action} must be allowed (baseline-grandfathered)`).toBeFalsy();
      calls += 1;
      expect(handlerSpy).toHaveBeenCalledTimes(calls);
    }
  });

  it("an explicit IRIS_GOVERNANCE enable of `add` FLIPS just that action (remove still denied)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_production_item:add": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "added", itemName: "X" },
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const allowed = await callTool(server, "iris_production_item", {
      action: "add",
      itemName: "X",
      className: "C",
    });
    expect(allowed.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    const denied = await callTool(server, "iris_production_item", {
      action: "remove",
      itemName: "X",
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_production_item:remove",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});
