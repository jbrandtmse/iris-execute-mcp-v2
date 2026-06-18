/**
 * Story 15.5 AC 15.5.2 — governance real-gate proof for the SQL-privilege
 * extension of `iris_resource_manage`.
 *
 * `iris_resource_manage` is the FIRST Epic-15 tool that EXTENDS a pre-existing
 * tool. Its original actions (`create`/`delete`/`modify`) are frozen Epic-14
 * GOVERNANCE_BASELINE members and stay grandfathered-ENABLED; the NEW SQL
 * actions are classified via `mutates`. This suite proves END-TO-END, through
 * the REAL `McpServerBase.handleToolCall` gate (NOT a mocked policy, NOT the
 * pure governance engine in isolation), that under EMPTY `IRIS_GOVERNANCE`:
 *
 *   - the new write actions (`grant`/`revoke`) are DENIED with the structured
 *     `GOVERNANCE_DISABLED` code keyed `iris_resource_manage:<action>`, and the
 *     handler is NEVER invoked;
 *   - the new read action (`listPrivileges`) is ALLOWED;
 *   - the PRE-EXISTING baseline actions (`create`/`delete`/`modify`) are STILL
 *     ALLOWED (baseline-grandfathered — the back-compat gate, AC 15.5.6);
 *   - an explicit `IRIS_GOVERNANCE` enable of `grant` flips just that one write.
 *
 * Runs in the DEFAULT vitest suite (`*.test.ts`, NOT `*.integration.test.ts`) —
 * no live IRIS; the default profile's startup HEAD/GET are stubbed via a fetch
 * mock, and the tool handler is replaced with a spy so we can assert
 * non-invocation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { resourceManageTool } from "../tools/resource.js";

// ── Harness ─────────────────────────────────────────────────────────

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
    name: "@iris-mcp/admin",
    version: "0.0.0",
    tools,
    needsCustomRest: false,
  };
}

/** Spy handler that preserves every governance-relevant field (name, schema, mutates, scope). */
function spiedResourceTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...resourceManageTool, handler: spy };
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
// AC 15.5.2 — new writes default-disabled; new read + baseline enabled.
// ════════════════════════════════════════════════════════════════════

describe("iris_resource_manage SQL-privilege governance default (AC 15.5.2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  const writeActions: Array<{ action: string; args: Record<string, unknown> }> =
    [
      {
        action: "grant",
        args: {
          action: "grant",
          target: "Sample.Person",
          privilege: "SELECT",
          grantee: "AppRole",
        },
      },
      {
        action: "revoke",
        args: {
          action: "revoke",
          target: "Sample.Person",
          privilege: "SELECT",
          grantee: "AppRole",
        },
      },
    ];

  for (const { action, args } of writeActions) {
    it(`under EMPTY IRIS_GOVERNANCE, '${action}' is denied with GOVERNANCE_DISABLED; handler NOT called`, async () => {
      stageDefaultStartup(env.fetchMock);

      const handlerSpy = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "should not run" }],
      }));
      const server = new McpServerBase(
        makeServerOpts([spiedResourceTool(handlerSpy)]),
      );
      await server.start("stdio");
      const callsAfterStart = env.fetchMock.mock.calls.length;

      const result = await callTool(server, "iris_resource_manage", args);

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toEqual({
        code: "GOVERNANCE_DISABLED",
        action: `iris_resource_manage:${action}`,
        server: "default",
      });
      expect(result.content[0].text).toContain(`iris_resource_manage:${action}`);
      expect(handlerSpy).not.toHaveBeenCalled();
      expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
    });
  }

  it("under EMPTY IRIS_GOVERNANCE, the new read `listPrivileges` is ALLOWED (handler runs)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { grantee: "AppRole", privileges: [], count: 0 },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedResourceTool(handlerSpy)]),
    );
    await server.start("stdio");

    await callTool(server, "iris_resource_manage", {
      action: "listPrivileges",
      grantee: "AppRole",
    });

    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("under EMPTY IRIS_GOVERNANCE, the BASELINE actions create/delete/modify STILL run (grandfathered — AC 15.5.6)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "ok" },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedResourceTool(handlerSpy)]),
    );
    await server.start("stdio");

    await callTool(server, "iris_resource_manage", {
      action: "create",
      name: "R1",
    });
    await callTool(server, "iris_resource_manage", {
      action: "modify",
      name: "R1",
    });
    await callTool(server, "iris_resource_manage", {
      action: "delete",
      name: "R1",
    });

    // All three pre-existing actions dispatched — none gated.
    expect(handlerSpy).toHaveBeenCalledTimes(3);
  });

  it("an explicit IRIS_GOVERNANCE enable of `grant` FLIPS it; `revoke` stays denied", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_resource_manage:grant": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "grant", success: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedResourceTool(handlerSpy)]),
    );
    await server.start("stdio");

    const granted = await callTool(server, "iris_resource_manage", {
      action: "grant",
      target: "Sample.Person",
      privilege: "SELECT",
      grantee: "AppRole",
    });
    expect(granted.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    const denied = await callTool(server, "iris_resource_manage", {
      action: "revoke",
      target: "Sample.Person",
      privilege: "SELECT",
      grantee: "AppRole",
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_resource_manage:revoke",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});
