/**
 * Story 26.2 AC 26.2.2 — governance-defaults proof for `iris_message_resend`.
 *
 * `iris_message_resend`'s three action keys (`preview`, `resend`,
 * `resendFiltered`) are NEW post-foundation keys (absent from the frozen
 * `governance-baseline.ts`, Rule #23), so the Story 15.0 `mutates`/default-seed
 * machinery governs them. This suite proves END-TO-END, through the REAL
 * `McpServerBase.handleToolCall` gate (NOT a mocked policy, NOT the pure
 * governance engine in isolation), that:
 *
 *   - Under EMPTY `IRIS_GOVERNANCE`, each write action (`resend`/
 *     `resendFiltered`) is DENIED with the structured `GOVERNANCE_DISABLED`
 *     code keyed `iris_message_resend:<action>`, and the handler is NEVER
 *     invoked.
 *   - Under empty config, the read action (`preview`) is ALLOWED (handler
 *     runs).
 *   - An explicit `IRIS_GOVERNANCE` enable of one write FLIPS just that
 *     action (per-action granularity — the sibling write stays denied).
 *
 * Mirrors `defaultSettings-governance.test.ts` (Story 17.1) and the iris-ops
 * `process-governance.test.ts` harness. Runs in the DEFAULT vitest suite
 * (`*.test.ts`, NOT `*.integration.test.ts`) — no live IRIS; the default
 * profile's startup HEAD/GET are stubbed via a fetch mock, and the tool
 * handler is replaced with a spy so non-invocation is observable.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { messageResendTool } from "../tools/message-resend.js";

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
 * field (name, inputSchema with the `action` enum, `mutates`, scope). The
 * gate computes the governance key from `inputSchema.shape.action` and
 * `mutates`, so keeping the REAL schema + `mutates` is what makes this an
 * end-to-end proof.
 */
function spiedTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...messageResendTool, handler: spy };
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
// AC 26.2.2 — write actions default-disabled; preview default-enabled; opt-in flips.
// ════════════════════════════════════════════════════════════════════

describe("iris_message_resend governance default (AC 26.2.2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("under EMPTY IRIS_GOVERNANCE, `resend` is denied with GOVERNANCE_DISABLED; handler NOT called", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_message_resend", {
      action: "resend",
      headerIds: [1],
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_message_resend:resend",
      server: "default",
    });
    expect(result.content[0].text).toContain("iris_message_resend:resend");
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("under EMPTY IRIS_GOVERNANCE, `resendFiltered` is likewise denied (write)", async () => {
    stageDefaultStartup(env.fetchMock);
    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_message_resend", {
      action: "resendFiltered",
      item: "MyApp.Service",
      from: "2026-07-01",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_message_resend:resendFiltered",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("under EMPTY IRIS_GOVERNANCE, the read action `preview` is ALLOWED (handler runs)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { headers: [], count: 0 },
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_message_resend", {
      action: "preview",
      headerIds: [1],
    });
    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("an explicit IRIS_GOVERNANCE enable of `resend` FLIPS just that action (resendFiltered still denied)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_message_resend:resend": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "resend", results: [], summary: { total: 0, succeeded: 0, failed: 0 } },
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_message_resend", {
      action: "resend",
      headerIds: [1],
    });

    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // `resendFiltered` was NOT enabled by the opt-in, so it remains denied —
    // proving the per-action granularity.
    const denied = await callTool(server, "iris_message_resend", {
      action: "resendFiltered",
      item: "MyApp.Service",
      from: "2026-07-01",
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_message_resend:resendFiltered",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("an explicit IRIS_GOVERNANCE enable of `resendFiltered` FLIPS just that action (resend still denied)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_message_resend:resendFiltered": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "resendFiltered", dryRun: true, matchCount: 0, sample: [] },
    }));
    const server = new McpServerBase(makeServerOpts([spiedTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_message_resend", {
      action: "resendFiltered",
      item: "MyApp.Service",
      from: "2026-07-01",
    });
    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    const denied = await callTool(server, "iris_message_resend", {
      action: "resend",
      headerIds: [1],
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_message_resend:resend",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});
