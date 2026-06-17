/**
 * Story 17.3 AC 17.3.5 — governance-defaults proof for `iris_sql_analyze`.
 *
 * `iris_sql_analyze` adds four NEW post-foundation governance keys to the
 * iris-dev-mcp server (`iris_sql_analyze:{explain,stats,indexUsage,running}`),
 * none of which is in the frozen `governance-baseline.ts`. All four are reads
 * (`mutates: "read"`). This suite proves END-TO-END, through the REAL
 * `McpServerBase.handleToolCall` gate (NOT a mocked policy, NOT the pure
 * governance engine in isolation), that under EMPTY `IRIS_GOVERNANCE` every one
 * of the four read actions is ALLOWED (its handler runs) — i.e. reads
 * default-ENABLE via the Story 15.0 `defaultSeed`.
 *
 * Mirrors the iris-ops `process-governance.test.ts` harness. Runs in the DEFAULT
 * vitest suite (`*.test.ts`, NOT `*.integration.test.ts`) — no live IRIS; the
 * default profile's startup HEAD/GET are stubbed via a fetch mock, and the tool
 * handler is replaced with a spy so invocation is observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { sqlAnalyzeTool } from "../tools/sqlAnalyze.js";

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
 * field (name, inputSchema with the `action` enum, `mutates`, scope). The gate
 * computes the governance key from `inputSchema.shape.action` and `mutates`, so
 * keeping the REAL schema + `mutates` is what makes this an end-to-end proof.
 */
function spiedTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...sqlAnalyzeTool, handler: spy };
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
// AC 17.3.5 — all four read actions default-ENABLED under empty config.
// ════════════════════════════════════════════════════════════════════

describe("iris_sql_analyze governance default (AC 17.3.5)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  const ACTIONS = ["explain", "stats", "indexUsage", "running"] as const;

  for (const action of ACTIONS) {
    it(`under EMPTY IRIS_GOVERNANCE, '${action}' is ALLOWED (read default-enabled; handler runs)`, async () => {
      stageDefaultStartup(env.fetchMock);

      const handlerSpy = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "ran" }],
        structuredContent: { action },
      }));
      const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
      await server.start("stdio");

      const args =
        action === "explain" || action === "indexUsage"
          ? { action, query: "SELECT 1" }
          : { action };
      const result = await callTool(server, "iris_sql_analyze", args);

      expect(result.isError).toBeFalsy();
      expect(handlerSpy).toHaveBeenCalledTimes(1);
    });
  }

  it("registers without throwing (all four NEW keys carry a `mutates` class)", async () => {
    stageDefaultStartup(env.fetchMock);
    // Construction + start() runs assertGovernanceClassification; absence of a
    // throw here is the registration-time proof for the four non-baseline keys.
    const server = new McpServerBase(makeServerOpts([sqlAnalyzeTool]));
    await expect(server.start("stdio")).resolves.not.toThrow();
  });
});
