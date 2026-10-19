/**
 * Story 15.1 AC 15.1.2 — `iris_service_manage` governance coverage gaps.
 *
 * Complementary to the dev's `service-governance.test.ts`, which proves (through
 * the REAL `McpServerBase.handleToolCall` gate, default suite): `enable` denied,
 * `disable`/`set` denied, `list` allowed, and a GLOBAL opt-in of `enable` flips
 * that one write while `disable` stays denied.
 *
 * This suite drives the SAME real gate to cover the points that suite did not:
 *
 *   - the SECOND read action, `get`, is NEVER gated under empty IRIS_GOVERNANCE
 *     (the dev proved only `list`). AC 15.1.2 says reads `:list|:get` both
 *     resolve enabled; this nails the `:get` half.
 *   - a GLOBAL opt-in of `set` (the settings-bearing write) flips `set` to
 *     allowed AND the handler receives the `settings` object intact — proving the
 *     gate passes through the full args (not just `action`/`name`) once allowed.
 *   - reads remain allowed EVEN WHEN a partial governance config is present that
 *     only toggles writes — a non-empty IRIS_GOVERNANCE does not accidentally
 *     gate the always-on reads.
 *
 * No live IRIS; the default profile's startup HEAD/GET are stubbed; the handler
 * is a spy so we can assert invocation/non-invocation and inspect the args the
 * gate forwarded. Default vitest suite (`*.test.ts`, NOT `.integration.test.ts`).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { makeEnvHarness } from "@iris-mcp/shared/test-helpers";
import { serviceManageTool } from "../tools/service.js";

// ── Harness (mirrors service-governance.test.ts) ────────────────────────

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

function spiedServiceTool(spy: ReturnType<typeof vi.fn>): ToolDefinition {
  return { ...serviceManageTool, handler: spy };
}

function stageDefaultStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(versionResponse());
}

// ════════════════════════════════════════════════════════════════════════

describe("iris_service_manage governance coverage (AC 15.1.2 gaps)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("under EMPTY IRIS_GOVERNANCE, the read action `get` is ALLOWED (handler runs)", async () => {
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { name: "%Service_CallIn", enabled: false },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedServiceTool(handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_service_manage", {
      action: "get",
      name: "%Service_CallIn",
    });

    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("a GLOBAL opt-in of `set` flips it to allowed and forwards `settings` intact", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_service_manage:set": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "set", success: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedServiceTool(handlerSpy)]),
    );
    await server.start("stdio");

    const settings = { enabled: false, autheEnabled: 32 };
    const result = await callTool(server, "iris_service_manage", {
      action: "set",
      name: "%Service_SQL",
      settings,
    });

    expect(result.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    // The gate forwarded the full args (incl. settings) to the now-allowed write.
    const [forwardedArgs] = handlerSpy.mock.calls[0] as unknown as [
      { action: string; name: string; settings: typeof settings },
    ];
    expect(forwardedArgs.action).toBe("set");
    expect(forwardedArgs.name).toBe("%Service_SQL");
    expect(forwardedArgs.settings).toEqual(settings);

    // `enable` was NOT opted in, so it stays denied (per-action granularity).
    const denied = await callTool(server, "iris_service_manage", {
      action: "enable",
      name: "%Service_SQL",
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_service_manage:enable",
    });
  });

  it("reads stay allowed even when a partial IRIS_GOVERNANCE only toggles a write", async () => {
    // A config that opts a single write in must not disturb the always-on reads.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_service_manage:disable": true },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { services: [], count: 0 },
    }));
    const server = new McpServerBase(
      makeServerOpts([spiedServiceTool(handlerSpy)]),
    );
    await server.start("stdio");

    for (const action of ["list", "get"]) {
      const result = await callTool(server, "iris_service_manage", {
        action,
        name: "%Service_CallIn",
      });
      expect(result.isError, `${action} must remain allowed`).toBeFalsy();
    }
    expect(handlerSpy).toHaveBeenCalledTimes(2);
  });
});
