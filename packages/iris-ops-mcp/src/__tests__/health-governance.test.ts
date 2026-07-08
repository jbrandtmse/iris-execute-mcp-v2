/**
 * Story 23.2 AC 23.2.2 #8 -- governance proof for `iris_health_check`.
 *
 * `iris_health_check` is a NEW post-foundation governance key (absent from
 * the frozen `governance-baseline.ts`, `1e62c5ad5bf7`). It is a FLAT tool
 * (no `action` enum), so its governance key is the bare tool name, and it
 * carries the mandatory scalar `mutates: "read"` classification (Rule #28)
 * -- reads seed ENABLED under the default governance cascade.
 *
 * This suite proves END-TO-END, through the REAL `McpServerBase.handleToolCall`
 * gate (NOT a mocked policy):
 *
 *   - under EMPTY `IRIS_GOVERNANCE` the tool is ALLOWED (handler runs) --
 *     the read classification seeds enabled;
 *   - an explicit `IRIS_GOVERNANCE {"global":{"iris_health_check":false}}`
 *     DISABLES it with the structured `GOVERNANCE_DISABLED` code and the
 *     handler is never invoked;
 *   - registration passes `assertGovernanceClassification` (constructing and
 *     starting the server with the real tool does not throw).
 *
 * Mirrors `iris-dev-mcp/src/__tests__/loc-governance.test.ts` and
 * `iris-interop-mcp/src/__tests__/diagram-governance.test.ts`. Runs in the
 * DEFAULT vitest suite (`*.test.ts`, NOT `*.integration.test.ts`) -- no live
 * IRIS; the default profile's startup HEAD/GET are stubbed via a fetch mock.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { healthCheckTool } from "../tools/health.js";

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
    name: "@iris-mcp/ops",
    version: "0.0.0",
    tools,
    needsCustomRest: true,
  };
}

/**
 * Replace the real handler with a spy, preserving every governance-relevant
 * field (name, inputSchema, scalar `mutates`, scope) so the real gate computes
 * the real flat key from the real definition -- an end-to-end proof.
 */
function spiedTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...healthCheckTool, handler: spy };
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
// AC 23.2.2 #8 -- read tool default-enabled; explicit governance disable honored.
// ════════════════════════════════════════════════════════════════════

describe("iris_health_check governance default (AC 23.2.2 #8)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("under EMPTY IRIS_GOVERNANCE, the tool is ALLOWED (read seeds enabled; handler runs)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { verdict: "healthy", checkedAt: "2026-07-08T00:00:00.000Z", findings: [], raw: {} },
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_health_check", {});

    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("an explicit IRIS_GOVERNANCE false DISABLES the tool (flat key, handler NOT called)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_health_check: false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_health_check", {});

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_health_check",
      server: "default",
    });
    expect(result.content[0].text).toContain("iris_health_check");
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("registration passes assertGovernanceClassification (real tool, no throw)", async () => {
    stageDefaultStartup(env.fetchMock);

    // The REAL tool definition (not a spy): constructing + starting the server
    // runs assertGovernanceClassification over the new non-baseline key.
    const server = new McpServerBase(makeServerOpts([healthCheckTool]));
    await expect(server.start("stdio")).resolves.not.toThrow();
    expect(server.getToolNames()).toContain("iris_health_check");
  });
});
