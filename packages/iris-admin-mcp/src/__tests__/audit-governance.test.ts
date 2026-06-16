/**
 * Story 15.4 AC 15.4.2 — governance real-gate proof for `iris_audit_manage`.
 *
 * `iris_audit_manage` is the fourth (and broadest) governed write tool in the
 * suite. This suite proves END-TO-END, through the REAL
 * `McpServerBase.handleToolCall` gate (NOT a mocked policy and NOT the pure
 * governance engine in isolation), that:
 *
 *   - Under EMPTY `IRIS_GOVERNANCE`, each write action
 *     (`enable`/`disable`/`configureEvent`/`purge`/`export`) is DENIED with the
 *     structured `GOVERNANCE_DISABLED` code keyed `iris_audit_manage:<action>`,
 *     and the handler is NEVER invoked.
 *   - Under empty config, the read actions (`status`/`view`) are ALLOWED.
 *   - An explicit `IRIS_GOVERNANCE` enable of a write FLIPS just that one write.
 *
 * Runs in the DEFAULT vitest suite (`*.test.ts`, NOT `*.integration.test.ts`) —
 * no live IRIS; the default profile's startup HEAD/GET are stubbed via a fetch
 * mock, and the tool handler is replaced with a spy so we can assert
 * non-invocation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { auditManageTool } from "../tools/audit.js";

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
function spiedAuditTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...auditManageTool, handler: spy };
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
// AC 15.4.2 — writes default-disabled; reads default-enabled.
// ════════════════════════════════════════════════════════════════════

describe("iris_audit_manage governance default (AC 15.4.2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  const writeActions: Array<{ action: string; args: Record<string, unknown> }> =
    [
      { action: "enable", args: { action: "enable" } },
      { action: "disable", args: { action: "disable" } },
      {
        action: "configureEvent",
        args: {
          action: "configureEvent",
          source: "%System",
          type: "%Login",
          name: "Login",
          enabled: false,
        },
      },
      {
        action: "purge",
        args: { action: "purge", confirm: true, end: "2026-01-01 00:00:00" },
      },
      { action: "export", args: { action: "export", fileName: "dump.xml" } },
    ];

  for (const { action, args } of writeActions) {
    it(`under EMPTY IRIS_GOVERNANCE, '${action}' is denied with GOVERNANCE_DISABLED; handler NOT called`, async () => {
      stageDefaultStartup(env.fetchMock);

      const handlerSpy = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "should not run" }],
      }));
      const server = new McpServerBase(
        makeServerOpts([spiedAuditTool(handlerSpy)]),
      );
      await server.start("stdio");
      const callsAfterStart = env.fetchMock.mock.calls.length;

      const result = await callTool(server, "iris_audit_manage", args);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        code: "GOVERNANCE_DISABLED",
        action: `iris_audit_manage:${action}`,
        server: "default",
      });
      expect(result.content[0].text).toContain(`iris_audit_manage:${action}`);
      expect(handlerSpy).not.toHaveBeenCalled();
      // No further HTTP beyond startup — the handler (which would call HTTP)
      // never ran.
      expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
    });
  }

  it("under EMPTY IRIS_GOVERNANCE, the read actions `status`/`view` are ALLOWED (handler runs)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { auditEnabled: true, events: [] },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedAuditTool(handlerSpy)]),
    );
    await server.start("stdio");

    await callTool(server, "iris_audit_manage", { action: "status" });
    await callTool(server, "iris_audit_manage", { action: "view" });

    // Both reads dispatched to the handler (none gated).
    expect(handlerSpy).toHaveBeenCalledTimes(2);
  });

  it("an explicit IRIS_GOVERNANCE enable of `purge` FLIPS it; `export` stays denied", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_audit_manage:purge": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "purge", deleted: 3, success: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedAuditTool(handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_audit_manage", {
      action: "purge",
      confirm: true,
      end: "2026-01-01 00:00:00",
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      action: "purge",
      deleted: 3,
      success: true,
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // `export` was NOT enabled by the opt-in — proving per-action granularity.
    const denied = await callTool(server, "iris_audit_manage", {
      action: "export",
      fileName: "dump.xml",
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_audit_manage:export",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});
