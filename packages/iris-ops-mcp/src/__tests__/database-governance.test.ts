/**
 * Story 16.2 AC 16.2.5 — governance-defaults proof for `iris_database_action`.
 *
 * `iris_database_action` adds six MUTATING action keys to the iris-ops-mcp
 * server. They are NEW post-foundation keys (absent from the frozen
 * `governance-baseline.ts`), so the Story 15.0 `mutates`/default-seed machinery
 * governs them. Because EVERY action is a write, ALL six default DISABLED. This
 * suite proves END-TO-END, through the REAL `McpServerBase.handleToolCall` gate
 * (NOT a mocked policy, NOT the pure governance engine in isolation), that:
 *
 *   - Under EMPTY `IRIS_GOVERNANCE`, every action is DENIED with the structured
 *     `GOVERNANCE_DISABLED` code keyed `iris_database_action:<action>`, and the
 *     handler is NEVER invoked.
 *   - An explicit `IRIS_GOVERNANCE` enable of one action FLIPS just that action
 *     (per-action granularity).
 *
 * Mirrors the iris-ops `process-governance.test.ts` harness. Runs in the
 * DEFAULT vitest suite (`*.test.ts`, NOT `*.integration.test.ts`) — no live
 * IRIS; the default profile's startup HEAD/GET are stubbed via a fetch mock,
 * and the tool handler is replaced with a spy so non-invocation is observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { databaseActionTool } from "../tools/database.js";

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
    needsCustomRest: false,
  };
}

/**
 * Replace the real handler with a spy, preserving every governance-relevant
 * field (name, inputSchema with the `action` enum, `mutates`, scope). The gate
 * computes the governance key from `inputSchema.shape.action` and `mutates`, so
 * keeping the REAL schema + `mutates` is what makes this an end-to-end proof.
 */
function spiedDatabaseTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...databaseActionTool, handler: spy };
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

const DIR = "c:\\InterSystems\\IRIS\\mgr\\testdb\\";
const ALL_ACTIONS = [
  "mount",
  "dismount",
  "compact",
  "defragment",
  "truncate",
  "expandVolume",
] as const;

// ════════════════════════════════════════════════════════════════════
// AC 16.2.5 — every action default-disabled; opt-in flips one.
// ════════════════════════════════════════════════════════════════════

describe("iris_database_action governance default (AC 16.2.5)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("under EMPTY IRIS_GOVERNANCE, EVERY action is denied with GOVERNANCE_DISABLED; handler NOT called", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedDatabaseTool(handlerSpy)]),
    );
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    for (const action of ALL_ACTIONS) {
      const args: Record<string, unknown> = { action, directory: DIR };
      if (action === "expandVolume") args.newVolDir = "d:\\vol2\\";
      const result = await callTool(server, "iris_database_action", args);

      expect(result.isError, `${action} must be denied`).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: "GOVERNANCE_DISABLED",
        action: `iris_database_action:${action}`,
        server: "default",
      });
      expect(result.content[0].text).toContain(
        `iris_database_action:${action}`,
      );
    }
    expect(handlerSpy).not.toHaveBeenCalled();
    // No tool ever ran → no extra fetch beyond startup.
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("an explicit IRIS_GOVERNANCE enable of `compact` FLIPS just that action", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_database_action:compact": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "compact", directory: DIR, success: 1 },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedDatabaseTool(handlerSpy)]),
    );
    await server.start("stdio");

    const allowed = await callTool(server, "iris_database_action", {
      action: "compact",
      directory: DIR,
    });
    expect(allowed.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // `dismount` was NOT enabled by the opt-in, so it remains denied — proving
    // the per-action granularity.
    const denied = await callTool(server, "iris_database_action", {
      action: "dismount",
      directory: DIR,
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_database_action:dismount",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("an explicit enable of the DESTRUCTIVE `dismount` FLIPS just that action", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_database_action:dismount": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "dismount", directory: DIR, success: 1 },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedDatabaseTool(handlerSpy)]),
    );
    await server.start("stdio");

    // The destructive `dismount` was explicitly opted-in → it runs.
    const allowed = await callTool(server, "iris_database_action", {
      action: "dismount",
      directory: DIR,
    });
    expect(allowed.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // `truncate` (the other destructive verb) was NOT enabled → still denied,
    // proving the opt-in is per-action and does not blanket-enable destruction.
    const denied = await callTool(server, "iris_database_action", {
      action: "truncate",
      directory: DIR,
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_database_action:truncate",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});
