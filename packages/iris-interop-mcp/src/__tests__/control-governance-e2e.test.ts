/**
 * Story 20.0 AC 20.0.5 / 20.0.5a / 20.0.9 — F2 "write, default-enabled" proven
 * END-TO-END on a REAL, FULLY-POPULATED interop server (QA e2e / guardrail).
 *
 * The dev's `control-governance.test.ts` proves the gate for `clean` while
 * registering ONLY a single spied `productionControlTool`. That is necessary but
 * NOT sufficient for the two highest-value Epic-20 invariants, both of which only
 * emerge when the WHOLE interop surface is present and the framework surfaces are
 * driven for real:
 *
 *   1. NON-DRIFT (AC 20.0.5): the Epic-19 discovery tool (`iris_server_profiles`)
 *      and the D6 `iris-governance://` resource must report the SAME effective
 *      policy — because both consume the SAME `getEffectivePolicy` threaded with
 *      `defaultEnabledWrites`. We drive BOTH real SDK surfaces (a `tools/call` for
 *      the discovery tool and a `resources/read` for `iris-governance://default`)
 *      and assert `toEqual` on the two full policy maps for the same profile, with
 *      `iris_production_control:clean` enabled in both. A single-tool harness
 *      cannot exercise this (the resource + discovery tool are framework-wired on
 *      the base, over the WHOLE key universe).
 *
 *   2. NO-LEAK CAPSTONE (AC 20.0.5a): with the FULL interop tool set registered,
 *      the `defaultEnabled:["clean"]` marker must flip EXACTLY `clean` to enabled
 *      and leave EVERY OTHER new write default-disabled. This test would FAIL if
 *      the marker ever leaked to a sibling write (`iris_production_item:add`,
 *      `:remove`, `iris_default_settings_manage:set`, `:delete`). The dev's
 *      single-tool harness structurally cannot catch such a leak — those other
 *      write tools are not even registered there.
 *
 * Plus back-compat (AC 20.0.7): the 5 grandfathered `iris_production_control`
 * actions still resolve ENABLED, and the real gate still admits them (handler
 * runs) — proven against the full server, not just the pure engine.
 *
 * Harness mirrors the dev's `control-governance.test.ts` + `item-governance.test.ts`
 * (fetch mock for the default profile's startup HEAD/GET; the tool handler is a
 * spy so gate admittance/denial is observable; hermetic env). No live IRIS: the
 * gate short-circuits before any per-call HTTP, and an admitted call runs the
 * spied handler (never the real HTTP handler), so bootstrap is never reached on
 * the exercised paths. Runs in the DEFAULT vitest suite (`*.test.ts`, NOT
 * `*.integration.test.ts`) per Rule 8.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions, ToolDefinition } from "@iris-mcp/shared";
import { tools as interopTools } from "../tools/index.js";
import { productionControlTool } from "../tools/production.js";

// The framework discovery tool name + the governance key under test.
const DISCOVERY_TOOL = "iris_server_profiles";
const CLEAN_KEY = "iris_production_control:clean";
const GOV_DEFAULT_URI = "iris-governance://default";

// The five grandfathered (frozen-baseline) control actions — enabled always.
const GRANDFATHERED_KEYS = [
  "iris_production_control:start",
  "iris_production_control:stop",
  "iris_production_control:restart",
  "iris_production_control:update",
  "iris_production_control:recover",
];

// Sibling NEW writes on the interop surface that MUST stay default-disabled
// (they carry `mutates:"write"` but do NOT opt into `defaultEnabled`). If the
// F2 marker ever leaked to one of these, the no-leak sweep below would fail.
const OTHER_WRITE_KEYS = [
  "iris_production_item:add",
  "iris_production_item:remove",
  "iris_default_settings_manage:set",
  "iris_default_settings_manage:delete",
];

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

/** Stage the default profile's startup HEAD (health) + GET (version). */
function stageDefaultStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(versionResponse());
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

/**
 * Invoke a request handler registered on the underlying `Server` by method name
 * (e.g. "resources/read"). Drives the REAL SDK dispatch — including URI→resource
 * matching — exactly as a connected client would.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: any, method: string, params: unknown) {
  const innerServer = server.server.server;
  const handlers = innerServer._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No request handler registered for "${method}"`);
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

/** Parse the JSON policy map from a resources/read result's first content block. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readResourcePolicy(result: any): Record<string, boolean> {
  const contents = result.contents as Array<{ text: string }>;
  const first = contents[0];
  if (!first) throw new Error("resources/read returned no contents");
  return JSON.parse(first.text) as Record<string, boolean>;
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
 * The full real interop tool set, with `iris_production_control`'s handler
 * replaced by a spy so gate admittance/denial is observable WITHOUT a live HTTP
 * call. Every governance-relevant field (name, inputSchema with the `action`
 * enum, `mutates`, `defaultEnabled`, scope) is preserved on every tool, so the
 * gate/discovery/resource compute over the REAL key universe (all 20 tools).
 */
function fullInteropToolsWithControlSpy(
  spy: ReturnType<typeof vi.fn>,
): ToolDefinition[] {
  return interopTools.map((t) =>
    t.name === productionControlTool.name ? { ...t, handler: spy } : t,
  );
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

// ════════════════════════════════════════════════════════════════════
// AC 20.0.5 — NON-DRIFT: discovery tool policy == resource policy, both on the
// FULL interop server, with `clean` enabled in both.
// ════════════════════════════════════════════════════════════════════

describe("Story 20.0 e2e — discovery tool ↔ governance resource non-drift (AC 20.0.5)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("iris_server_profiles and iris-governance://default report the SAME policy, with clean enabled", async () => {
    stageDefaultStartup(env.fetchMock);

    const controlSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { action: "cleaned", killAppData: 0 },
    }));
    const server = new McpServerBase(
      makeServerOpts(fullInteropToolsWithControlSpy(controlSpy)),
    );
    await server.start("stdio");

    // (a) discovery tool → tools/call path (handleToolCall special-case).
    const discovery = await callTool(server, DISCOVERY_TOOL, {});
    expect(discovery.isError).toBeFalsy();
    const discoveryResult = discovery.structuredContent as {
      governance: { profile?: string; policy?: Record<string, boolean> };
    };
    expect(discoveryResult.governance.profile).toBe("default");
    const discoveryPolicy = discoveryResult.governance.policy;
    expect(discoveryPolicy).toBeDefined();

    // (b) governance resource → resources/read path.
    const resource = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    const resourcePolicy = readResourcePolicy(resource);

    // Non-drift: the two full maps must be byte-for-byte identical (they share
    // getEffectivePolicy threaded with the SAME defaultEnabledWrites).
    expect(discoveryPolicy).toEqual(resourcePolicy);

    // And the F2 fact both must agree on: clean is ENABLED by default.
    expect(discoveryPolicy![CLEAN_KEY]).toBe(true);
    expect(resourcePolicy[CLEAN_KEY]).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 20.0.5a — NO-LEAK CAPSTONE on the full server: exactly `clean` flips; every
// OTHER new write stays default-disabled.
// ════════════════════════════════════════════════════════════════════

describe("Story 20.0 e2e — defaultEnabled marker does not leak to sibling writes (AC 20.0.5a)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("on the full interop server, only clean is default-enabled; item add/remove + default-settings set/delete stay disabled", async () => {
    stageDefaultStartup(env.fetchMock);

    const server = new McpServerBase(
      makeServerOpts(fullInteropToolsWithControlSpy(vi.fn())),
    );
    await server.start("stdio");

    // Read the authoritative effective policy via the resource (the same map the
    // gate consumes). Assert the whole invariant against the REAL key universe.
    const resource = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    const policy = readResourcePolicy(resource);

    // The one opted-in write: enabled.
    expect(policy[CLEAN_KEY], "clean must be default-enabled (F2)").toBe(true);

    // Every OTHER new write on the interop surface: still default-disabled. A
    // marker leak (e.g. defaultEnabled listing the wrong action, or the set
    // being shared/mis-scoped) would flip one of these to true and fail here.
    for (const key of OTHER_WRITE_KEYS) {
      expect(
        policy[key],
        `${key} must remain default-disabled (defaultEnabled must NOT leak past clean)`,
      ).toBe(false);
    }

    // Grandfathered control actions: enabled as always.
    for (const key of GRANDFATHERED_KEYS) {
      expect(policy[key], `${key} must stay enabled (grandfathered)`).toBe(true);
    }

    // The framework discovery tool key is a read → enabled.
    expect(policy[DISCOVERY_TOOL]).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 20.0.5 / 20.0.7 — the real gate on the full server: clean admitted by
// default; a grandfathered action admitted; an explicit false disables clean.
// ════════════════════════════════════════════════════════════════════

describe("Story 20.0 e2e — real gate on the full interop server (AC 20.0.5 / 20.0.7)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("under EMPTY IRIS_GOVERNANCE, clean is ADMITTED (handler runs) and a grandfathered action is ADMITTED", async () => {
    stageDefaultStartup(env.fetchMock);

    const controlSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    const server = new McpServerBase(
      makeServerOpts(fullInteropToolsWithControlSpy(controlSpy)),
    );
    await server.start("stdio");

    // clean: enabled-by-default via F2 → gate admits → spied handler runs.
    const cleaned = await callTool(server, "iris_production_control", {
      action: "clean",
    });
    expect(cleaned.isError, "clean must be admitted by the gate (F2)").toBeFalsy();
    expect(controlSpy).toHaveBeenCalledTimes(1);

    // A grandfathered action (recover, no name required) also admitted.
    const recovered = await callTool(server, "iris_production_control", {
      action: "recover",
    });
    expect(recovered.isError, "recover must be admitted (grandfathered)").toBeFalsy();
    expect(controlSpy).toHaveBeenCalledTimes(2);
  });

  it("an explicit IRIS_GOVERNANCE false DISABLES clean on the full server (handler NEVER runs)", async () => {
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_production_control:clean": false },
    });
    stageDefaultStartup(env.fetchMock);

    const controlSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts(fullInteropToolsWithControlSpy(controlSpy)),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_production_control", {
      action: "clean",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: CLEAN_KEY,
    });
    expect(controlSpy).not.toHaveBeenCalled();

    // Back-compat under the SAME override: a grandfathered action is unaffected.
    const recovered = await callTool(server, "iris_production_control", {
      action: "recover",
    });
    expect(recovered.isError, "recover must stay enabled despite clean being disabled").toBeFalsy();
    expect(controlSpy).toHaveBeenCalledTimes(1);
  });
});
