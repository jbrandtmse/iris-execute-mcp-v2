/**
 * Story 15.2 AC 15.2.2 — governance real-gate proof for `iris_ldap_manage`.
 *
 * `iris_ldap_manage` is the second governed write tool in the suite. This suite
 * proves END-TO-END, through the REAL `McpServerBase.handleToolCall` gate (NOT a
 * mocked policy and NOT the pure governance engine in isolation), that:
 *
 *   - Under EMPTY `IRIS_GOVERNANCE`, each write action (`create`/`modify`/
 *     `delete`) is DENIED with the structured `GOVERNANCE_DISABLED` code keyed
 *     `iris_ldap_manage:<action>`, and the handler is NEVER invoked.
 *   - Under empty config, the read actions (`list`/`get`/`test`) are ALLOWED.
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
import { ldapManageTool } from "../tools/ldap.js";

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
function spiedLdapTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...ldapManageTool, handler: spy };
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
// AC 15.2.2 — writes default-disabled; reads (incl. test) default-enabled.
// ════════════════════════════════════════════════════════════════════

describe("iris_ldap_manage governance default (AC 15.2.2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("under EMPTY IRIS_GOVERNANCE, `create` is denied with GOVERNANCE_DISABLED; handler NOT called", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedLdapTool(handlerSpy)]));
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_ldap_manage", {
      action: "create",
      name: "conf",
      settings: { ldapBaseDN: "DC=x,DC=com" },
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_ldap_manage:create",
      server: "default",
    });
    expect(result.content[0].text).toContain("iris_ldap_manage:create");
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("under EMPTY IRIS_GOVERNANCE, `modify` and `delete` are likewise denied (all writes)", async () => {
    stageDefaultStartup(env.fetchMock);
    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(makeServerOpts([spiedLdapTool(handlerSpy)]));
    await server.start("stdio");

    for (const action of ["modify", "delete"]) {
      const result = await callTool(server, "iris_ldap_manage", {
        action,
        name: "conf",
        ...(action === "modify" ? { settings: { description: "x" } } : {}),
      });
      expect(result.isError, `${action} must be denied`).toBe(true);
      expect(result.structuredContent).toMatchObject({
        code: "GOVERNANCE_DISABLED",
        action: `iris_ldap_manage:${action}`,
      });
    }
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("under EMPTY IRIS_GOVERNANCE, the read actions `list`/`get`/`test` are ALLOWED (handler runs)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { configs: [], count: 0 },
    }));
    const server = new McpServerBase(makeServerOpts([spiedLdapTool(handlerSpy)]));
    await server.start("stdio");

    await callTool(server, "iris_ldap_manage", { action: "list" });
    await callTool(server, "iris_ldap_manage", { action: "get", name: "c" });
    await callTool(server, "iris_ldap_manage", { action: "test", name: "c" });

    // All three reads dispatched to the handler (none gated).
    expect(handlerSpy).toHaveBeenCalledTimes(3);
  });

  it("an explicit IRIS_GOVERNANCE enable of `create` FLIPS it; other writes stay denied", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_ldap_manage:create": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "created", success: true },
    }));
    const server = new McpServerBase(makeServerOpts([spiedLdapTool(handlerSpy)]));
    await server.start("stdio");

    const result = await callTool(server, "iris_ldap_manage", {
      action: "create",
      name: "conf",
      settings: { ldapBaseDN: "DC=x,DC=com" },
    });

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      action: "created",
      success: true,
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // `delete` was NOT enabled by the opt-in — proving per-action granularity.
    const denied = await callTool(server, "iris_ldap_manage", {
      action: "delete",
      name: "conf",
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_ldap_manage:delete",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});
