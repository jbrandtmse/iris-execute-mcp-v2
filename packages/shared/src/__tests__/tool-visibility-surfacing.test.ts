/**
 * Story 30.2 — Surfacing + Payload Measurement (Epic 30, architecture decision I1).
 *
 * Complements `tool-visibility.e2e.test.ts` (Story 30.0's wire-level coverage
 * of visibility itself) and `server-discovery.test.ts`/`server-discovery.e2e.test.ts`
 * (the pre-existing discovery-tool + D6 resource harness). This file proves
 * the NEW Story 30.2 surface:
 *
 *   AC 30.2.1 — `toolVisibility: { preset, visibleTools, hiddenTools }` is
 *               present on the discovery result under `full` (0 hidden),
 *               under `IRIS_TOOLS_PRESET=core` with a roster, and under an
 *               `IRIS_TOOLS_DISABLE`-driven config — and hidden tool NAMES
 *               never leak anywhere in the serialized output (counts only).
 *   AC 30.2.2 — a hidden tool's governance key (including a hidden tool's
 *               surviving BASELINE key) is ABSENT from BOTH the discovery
 *               tool's `governance.policy` map AND the live
 *               `iris-governance://{profile}` resource read under `core`,
 *               and PRESENT under `full` (the same tool, unhidden) — proving
 *               the omission is caused by visibility, not an unrelated gap.
 *               Also: an `IRIS_GOVERNANCE` key naming a hidden tool's action
 *               parses WITHOUT error (still legal/inert) and does not
 *               resurrect the key in either filtered report.
 *
 * The discovery TOOL CALL (unlike a resource read) goes through
 * `handleToolCall`'s "Server not initialised" guard, so — unlike
 * `tool-visibility.e2e.test.ts`, which never calls `start()` — these tests
 * use the mocked-bootstrap + fetchMock harness from `server-discovery.test.ts`
 * so `server.start("stdio")` completes without a live IRIS.
 *
 * No live IRIS. Discoverable by the default `vitest run` suite (plain
 * `*.test.ts`). TypeScript-only — no BOOTSTRAP_VERSION impact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";
import type { ServerDiscoveryResult } from "../server-discovery.js";
import type { ToolPresetRosters } from "../tool-visibility.js";
import type { ToolDefinition } from "../tool-types.js";

// A successful, no-op bootstrap result (REST service already current).
const okBootstrap: BootstrapResult = {
  probeFound: true,
  probeStatus: "current",
  deployed: true,
  compiled: true,
  configured: true,
  mapped: true,
  unitTestRootEnsured: true,
  errors: [],
};

const bootstrapSpy = vi.fn(async () => okBootstrap);
vi.mock("../bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bootstrap.js")>();
  return { ...actual, bootstrap: bootstrapSpy };
});

// Import AFTER vi.mock so server-base picks up the mocked bootstrap.
const { McpServerBase } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;

// ── Fixtures ────────────────────────────────────────────────────────

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

/** A grandfathered (baseline-style) read tool with NO `mutates` — no action enum. */
function makeEchoTool(name: string): ToolDefinition {
  return {
    name,
    title: "Echo",
    description: `Synthetic grandfathered read tool ${name}.`,
    inputSchema: z.object({ namespace: z.string().optional() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    handler: async (args, ctx) => {
      const a = args as Record<string, unknown>;
      const ns = ctx.resolveNamespace(a.namespace as string | undefined);
      return {
        content: [{ type: "text" as const, text: `ns=${ns}` }],
        structuredContent: { ns },
      };
    },
  };
}

/**
 * A grandfathered multi-action tool with NO `mutates` (its `action` key(s)
 * are baseline members already classified via BASELINE_ACTION_CLASSIFICATIONS,
 * so it does not need its own `mutates` to pass `assertGovernanceClassified`).
 */
function makeActionTool(name: string, actions: [string, ...string[]]): ToolDefinition {
  return {
    name,
    title: name,
    description: `Synthetic grandfathered action tool ${name}.`,
    inputSchema: z.object({ action: z.enum(actions) }),
    annotations: { readOnlyHint: false },
    scope: "NONE",
    handler: async () => ({
      content: [{ type: "text" as const, text: "ok" }],
      structuredContent: { ok: true },
    }),
  };
}

function makeServerOpts(
  tools: ToolDefinition[],
  toolPresets?: ToolPresetRosters,
): McpServerBaseOptions {
  return {
    name: "test-server",
    version: "1.0.0",
    tools,
    ...(toolPresets ? { toolPresets } : {}),
  };
}

/** Invoke a tool through the SDK-registered callback (the handleToolCall path). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

/** Invoke a request handler on the underlying Server by method name (real wire). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: any, method: string, params: unknown) {
  const innerServer = server.server.server;
  const handlers = innerServer._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No request handler for "${method}"`);
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

/** Read a governance resource URI and parse its JSON policy body. */
async function readGovernancePolicy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any,
  profile = "default",
): Promise<Record<string, boolean>> {
  const result = await callRequest(server, "resources/read", {
    uri: `iris-governance://${profile}`,
  });
  const contents = result.contents as Array<{ text: string }>;
  return JSON.parse(contents[0]!.text) as Record<string, boolean>;
}

/** Parse the discovery tool's structured result from a CallToolResult. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function discoveryOf(result: any): ServerDiscoveryResult {
  return result.structuredContent as ServerDiscoveryResult;
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
    IRIS_TOOLS_PRESET: process.env.IRIS_TOOLS_PRESET,
    IRIS_TOOLS_DISABLE: process.env.IRIS_TOOLS_DISABLE,
    IRIS_TOOLS_ENABLE: process.env.IRIS_TOOLS_ENABLE,
  };

  function setup(): void {
    bootstrapSpy.mockClear();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const key of Object.keys(savedEnv)) delete process.env[key];
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

function setDefaultEnv(): void {
  process.env.IRIS_USERNAME = "u";
  process.env.IRIS_PASSWORD = "supersecret";
  process.env.IRIS_HOST = "default.example.com";
  process.env.IRIS_NAMESPACE = "DEFAULTNS";
}

// ════════════════════════════════════════════════════════════════════
// AC 30.2.1 — `toolVisibility` block on the discovery result.
// ════════════════════════════════════════════════════════════════════

describe("Story 30.2 — toolVisibility block on iris_server_profiles (AC 30.2.1)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("present under the default (full) config: preset='full', hiddenTools=0", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get"), makeEchoTool("iris_global_get")]),
    );
    await server.start("stdio");

    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME));
    expect(discovery.toolVisibility).toEqual({
      preset: "full",
      visibleTools: 3, // 2 package tools + the reserved discovery tool
      hiddenTools: 0,
    });
  });

  it("under IRIS_TOOLS_PRESET=core with a roster hiding one tool: counts reflect it, and the hidden NAME never leaks", async () => {
    setDefaultEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    stageDefaultStartup(env.fetchMock);
    const rosters: ToolPresetRosters = {
      core: { include: ["iris_doc_get"], exclude: ["iris_global_get"] },
      developer: { include: ["iris_doc_get", "iris_global_get"], exclude: [] },
    };
    const server = new McpServerBase(
      makeServerOpts(
        [makeEchoTool("iris_doc_get"), makeEchoTool("iris_global_get")],
        rosters,
      ),
    );
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME);
    const discovery = discoveryOf(result);
    expect(discovery.toolVisibility).toEqual({
      preset: "core",
      visibleTools: 2, // iris_doc_get + the reserved discovery tool
      hiddenTools: 1, // iris_global_get
    });

    // Counts only — the hidden tool's NAME must never appear anywhere in the
    // full serialized discovery output (spec §2.6, AC 30.2.1).
    const fullText = (result.content as Array<{ text: string }>)[0]!.text;
    expect(fullText).not.toContain("iris_global_get");
    expect(JSON.stringify(discovery)).not.toContain("iris_global_get");
  });

  it("under an IRIS_TOOLS_DISABLE-driven config (no preset): counts reflect it, hidden NAME never leaks", async () => {
    setDefaultEnv();
    process.env.IRIS_TOOLS_DISABLE = "iris_global_get";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get"), makeEchoTool("iris_global_get")]),
    );
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME);
    const discovery = discoveryOf(result);
    expect(discovery.toolVisibility).toEqual({
      preset: "full",
      visibleTools: 2,
      hiddenTools: 1,
    });
    expect(JSON.stringify(discovery)).not.toContain("iris_global_get");
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 30.2.2 — governance report + resource omit hidden tools' keys.
// ════════════════════════════════════════════════════════════════════

describe("Story 30.2 — governance report + resource omit hidden tools' keys (AC 30.2.2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  // "iris_alerts_manage:reset" is a real frozen GOVERNANCE_BASELINE key —
  // proving the omission holds even for a baseline key that
  // `rebuildGovernedKeys`'s union with GOVERNANCE_BASELINE would otherwise
  // keep alive despite the tool never being registered.
  const HIDDEN_TOOL = "iris_alerts_manage";
  const HIDDEN_KEY = "iris_alerts_manage:reset";

  const rosters: ToolPresetRosters = {
    core: { include: [], exclude: [HIDDEN_TOOL] },
    developer: { include: [HIDDEN_TOOL], exclude: [] },
  };

  it("the discovery tool's governance.policy omits the hidden tool's baseline key under core, and includes it under full", async () => {
    expect(GOVERNANCE_BASELINE.has(HIDDEN_KEY)).toBe(true); // sanity: really is a baseline key

    // Server A: core preset — the tool is hidden.
    setDefaultEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    stageDefaultStartup(env.fetchMock);
    const hiddenServer = new McpServerBase(
      makeServerOpts([makeActionTool(HIDDEN_TOOL, ["reset"])], rosters),
    );
    await hiddenServer.start("stdio");
    const hiddenDiscovery = discoveryOf(
      await callTool(hiddenServer, SERVER_DISCOVERY_TOOL_NAME),
    );
    expect(
      Object.prototype.hasOwnProperty.call(hiddenDiscovery.governance.policy, HIDDEN_KEY),
    ).toBe(false);

    // Server B: SAME tool + SAME rosters, default (full) preset — visible.
    env.teardown();
    env.setup();
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const visibleServer = new McpServerBase(
      makeServerOpts([makeActionTool(HIDDEN_TOOL, ["reset"])], rosters),
    );
    await visibleServer.start("stdio");
    const visibleDiscovery = discoveryOf(
      await callTool(visibleServer, SERVER_DISCOVERY_TOOL_NAME),
    );
    expect(
      Object.prototype.hasOwnProperty.call(visibleDiscovery.governance.policy, HIDDEN_KEY),
    ).toBe(true);
  });

  it("the iris-governance://{profile} resource omits the same hidden tool's key under core", async () => {
    setDefaultEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeActionTool(HIDDEN_TOOL, ["reset"])], rosters),
    );
    await server.start("stdio");

    const policy = await readGovernancePolicy(server, "default");
    expect(Object.prototype.hasOwnProperty.call(policy, HIDDEN_KEY)).toBe(false);
  });

  it("an IRIS_GOVERNANCE key naming a hidden tool's action parses without error and does not resurrect the key in either filtered report", async () => {
    setDefaultEnv();
    process.env.IRIS_TOOLS_PRESET = "core";
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { [HIDDEN_KEY]: false },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeActionTool(HIDDEN_TOOL, ["reset"])], rosters),
    );

    // start() parses IRIS_GOVERNANCE — must not throw even though the key
    // names a tool this server hides.
    await expect(server.start("stdio")).resolves.toBeUndefined();

    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME));
    expect(
      Object.prototype.hasOwnProperty.call(discovery.governance.policy, HIDDEN_KEY),
    ).toBe(false);

    const policy = await readGovernancePolicy(server, "default");
    expect(Object.prototype.hasOwnProperty.call(policy, HIDDEN_KEY)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 30.2.1 — counts stay in sync across the dynamic addTools/removeTools
// paths (Story 30.2 review — Edge Case Hunter MEDIUM: toolVisibility counts
// were computed once at construction and drifted the moment the advertised
// tool set changed, breaking the visible+hidden invariant those paths keep
// for governance state).
// ════════════════════════════════════════════════════════════════════

describe("Story 30.2 — toolVisibility counts track addTools/removeTools (review regression)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  /** A NEW read tool (`mutates: "read"`) — passes classification without needing baseline membership. */
  function makeReadTool(name: string): ToolDefinition {
    return {
      name,
      title: name,
      description: `Synthetic new read tool ${name}.`,
      inputSchema: z.object({ namespace: z.string().optional() }),
      annotations: { readOnlyHint: true },
      scope: "NS",
      mutates: "read",
      handler: async () => ({
        content: [{ type: "text" as const, text: "ok" }],
        structuredContent: { ok: true },
      }),
    };
  }

  it("addTools of a VISIBLE tool bumps visibleTools; removeTools restores it", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get"), makeEchoTool("iris_global_get")]),
    );
    await server.start("stdio");

    // Construction baseline: 2 package + reserved discovery tool.
    let discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME));
    expect(discovery.toolVisibility).toEqual({
      preset: "full",
      visibleTools: 3,
      hiddenTools: 0,
    });

    // Add a visible tool → counts must follow (STALE before the fix).
    server.addTools([makeReadTool("iris_review_added_read")]);
    discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME));
    expect(discovery.toolVisibility).toEqual({
      preset: "full",
      visibleTools: 4,
      hiddenTools: 0,
    });

    // Remove it → counts must follow back.
    server.removeTools(["iris_review_added_read"]);
    discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME));
    expect(discovery.toolVisibility).toEqual({
      preset: "full",
      visibleTools: 3,
      hiddenTools: 0,
    });
  });

  it("addTools of a config-HIDDEN tool bumps hiddenTools (not visibleTools) and never leaks the name", async () => {
    setDefaultEnv();
    process.env.IRIS_TOOLS_DISABLE = "iris_review_hidden_add";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    // 1 package + reserved.
    let discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME));
    expect(discovery.toolVisibility).toEqual({
      preset: "full",
      visibleTools: 2,
      hiddenTools: 0,
    });

    // Add a tool the DISABLE config hides → visibleTools unchanged, hiddenTools
    // +1, and the hidden NAME must still never leak (counts only).
    server.addTools([makeReadTool("iris_review_hidden_add")]);
    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME);
    discovery = discoveryOf(result);
    expect(discovery.toolVisibility).toEqual({
      preset: "full",
      visibleTools: 2,
      hiddenTools: 1,
    });
    expect(JSON.stringify(discovery)).not.toContain("iris_review_hidden_add");
  });
});
