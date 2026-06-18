/**
 * Story 19.0 — Server & Governance Discovery Tool: END-TO-END (Epic 19, E1).
 *
 * Complements the dev's unit-level `server-discovery.test.ts` by driving the
 * tool over the REAL MCP wire surfaces a connected client uses, on a
 * REPRESENTATIVE server (a realistic multi-tool set, not a single echo tool):
 *
 *   - `tools/list` (the actual SDK request handler) advertises
 *     `iris_server_profiles` alongside the package tools, with no per-package
 *     wiring (AC 19.0.1 / 19.0.5 surfacing).
 *   - `tools/call` returns the roster (password-absent, multi-profile) and the
 *     effective policy map (AC 19.0.2 / 19.0.3).
 *   - **Non-drift, end-to-end:** the discovery tool's policy `toEqual`s what the
 *     LIVE D6 governance resource (`resources/read iris-governance://<profile>`)
 *     returns for the SAME profile — the strongest reading of "tool and resource
 *     cannot drift" (AC 19.0.3), cross-checked against the real resource rather
 *     than re-deriving via getEffectivePolicy.
 *   - `profile` arg + `allProfiles` flag select correctly, each cross-checked
 *     against the corresponding per-profile resource read (AC 19.0.3).
 *   - default-only back-compat through the wire (AC 19.0.6).
 *   - the governance gate denies the tool ONLY when an operator explicitly
 *     disables it (AC 19.0.4).
 *
 * No live IRIS: discovery reports in-memory config and never connects. Harness
 * mirrors `server-discovery.test.ts` / `governance-resource.test.ts` (mocked
 * bootstrap, fetchMock for the default profile's startup, hermetic env).
 * Discoverable by the default `vitest run` suite (plain `*.test.ts`, NOT
 * `*.integration.test.ts`). TypeScript-only — no BOOTSTRAP_VERSION impact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";
import type { ServerDiscoveryResult } from "../server-discovery.js";
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

// Mock ONLY the `bootstrap` export so establishment never reaches a real IRIS.
const bootstrapSpy = vi.fn(async () => okBootstrap);
vi.mock("../bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bootstrap.js")>();
  return { ...actual, bootstrap: bootstrapSpy };
});

// Import AFTER vi.mock so server-base picks up the mocked bootstrap.
const { McpServerBase } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;

// ── Helpers ─────────────────────────────────────────────────────────

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

function makeServerOpts(tools: ToolDefinition[]): McpServerBaseOptions {
  return { name: "iris-dev-mcp", version: "1.0.0", tools, needsCustomRest: false };
}

/** A read echo tool with NO `mutates` — a grandfathered (baseline-style) read. */
function makeReadTool(name: string): ToolDefinition {
  return {
    name,
    title: "Read tool",
    description: "Read the resolved namespace.",
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

/** A NEW single-op write tool (`mutates: "write"`) — seed-disabled by default. */
function makeWriteTool(name: string): ToolDefinition {
  return {
    name,
    title: "Governed write",
    description: "A NEW single-op write action (seed-disabled).",
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: "write",
    handler: async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }),
  };
}

/**
 * A realistic "representative server" tool set: a couple of grandfathered reads
 * plus a NEW governed write — i.e. what a real package's tools/index.ts exports,
 * minus the framework discovery tool (which must appear anyway).
 */
function representativeTools(): ToolDefinition[] {
  return [
    makeReadTool("iris_doc_get"),
    makeReadTool("iris_global_get"),
    makeWriteTool("iris_new_write"),
  ];
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

/** Invoke a request handler on the underlying Server by method (real wire). */
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

/** Parse the discovery tool's structured result from a CallToolResult. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function discoveryOf(result: any): ServerDiscoveryResult {
  return result.structuredContent as ServerDiscoveryResult;
}

/** The policy map the LIVE D6 resource returns for a given profile (wire read). */
async function resourcePolicy(
  server: unknown,
  profile: string,
): Promise<Record<string, boolean>> {
  const result = await callRequest(server, "resources/read", {
    uri: `iris-governance://${profile}`,
  });
  const contents = result.contents as Array<{ text: string }>;
  const first = contents[0];
  if (!first) throw new Error("resources/read returned no contents");
  return JSON.parse(first.text) as Record<string, boolean>;
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
    bootstrapSpy.mockClear();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock;
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.IRIS_GOVERNANCE;
    delete process.env.IRIS_PROFILES;
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
// E2E-1 — advertised on a representative server via the real tools/list wire.
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 E2E — advertised via tools/list on a representative server", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("tools/list returns the discovery tool alongside the package tools", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    const result = await callRequest(server, "tools/list", {});
    const names = (result.tools as Array<{ name: string }>).map((t) => t.name);
    // The framework tool is present without being in the package tools array…
    expect(names).toContain(SERVER_DISCOVERY_TOOL_NAME);
    // …alongside the representative package tools.
    expect(names).toEqual(
      expect.arrayContaining([
        "iris_doc_get",
        "iris_global_get",
        "iris_new_write",
        SERVER_DISCOVERY_TOOL_NAME,
      ]),
    );
  });

  it("the advertised discovery tool is read-only and carries call-first guidance", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    const result = await callRequest(server, "tools/list", {});
    const tool = (
      result.tools as Array<{
        name: string;
        description?: string;
        annotations?: { readOnlyHint?: boolean };
      }>
    ).find((t) => t.name === SERVER_DISCOVERY_TOOL_NAME);
    expect(tool, "discovery tool must be advertised").toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
    expect(tool?.description?.toUpperCase()).toContain("CALL THIS FIRST");
  });
});

// ════════════════════════════════════════════════════════════════════
// E2E-2 — a real tool call returns roster (password-absent) + policy.
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 E2E — tool call returns roster + policy (multi-profile)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("roster lists every configured profile and NEVER serializes a password", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: {
        host: "prod.example.com",
        password: "prodsecret",
        namespace: "PRODNS",
        https: true,
      },
      staging: {
        host: "staging.example.com",
        password: "stagingsecret",
        namespace: "STAGINGNS",
      },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    const discovery = discoveryOf(result);

    expect(discovery.profiles.map((p) => p.name).sort()).toEqual([
      "default",
      "prod",
      "staging",
    ]);
    expect(discovery.defaultProfile).toBe("default");
    expect(discovery.profiles.find((p) => p.isDefault)?.name).toBe("default");

    // Allow-list guarantee: no entry has a `password` own key.
    for (const entry of discovery.profiles) {
      expect(Object.prototype.hasOwnProperty.call(entry, "password")).toBe(false);
    }
    // No secret value (from ANY profile) leaks in the full serialized output.
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).not.toContain("supersecret");
    expect(text).not.toContain("prodsecret");
    expect(text).not.toContain("stagingsecret");
    // The roster JSON itself never serializes the literal key "password".
    expect(JSON.stringify(discovery.profiles)).not.toContain("password");
  });

  it("the result also carries the governance policy map for the default profile", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    const discovery = discoveryOf(
      await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}),
    );
    expect(discovery.governance.profile).toBe("default");
    expect(discovery.governance.policy).toBeDefined();
    // Read tools enabled, the NEW write seed-disabled, discovery itself enabled.
    expect(discovery.governance.policy!.iris_doc_get).toBe(true);
    expect(discovery.governance.policy!.iris_new_write).toBe(false);
    expect(discovery.governance.policy![SERVER_DISCOVERY_TOOL_NAME]).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// E2E-3 — NON-DRIFT against the LIVE D6 resource (the real wire promise).
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 E2E — policy is byte-identical to the live D6 resource read", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("default policy toEqual the resources/read of iris-governance://default", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    const discovery = discoveryOf(
      await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}),
    );
    const fromResource = await resourcePolicy(server, "default");

    // The tool's policy is exactly what the D6 resource serves — no drift.
    expect(discovery.governance.policy).toEqual(fromResource);
    // And the override took effect on both surfaces identically.
    expect(discovery.governance.policy!.iris_doc_get).toBe(false);
    expect(fromResource.iris_doc_get).toBe(false);
  });

  it("per-profile (`profile` arg) toEqual the per-profile resource read", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    // prod re-enables a seed-disabled NEW write; default leaves it disabled.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      profiles: { prod: { iris_new_write: true } },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    const prodTool = discoveryOf(
      await callTool(server, SERVER_DISCOVERY_TOOL_NAME, { profile: "prod" }),
    );
    expect(prodTool.governance.profile).toBe("prod");
    expect(prodTool.governance.policy).toEqual(await resourcePolicy(server, "prod"));
    expect(prodTool.governance.policy!.iris_new_write).toBe(true);

    const defTool = discoveryOf(
      await callTool(server, SERVER_DISCOVERY_TOOL_NAME, { profile: "default" }),
    );
    expect(defTool.governance.policy).toEqual(
      await resourcePolicy(server, "default"),
    );
    expect(defTool.governance.policy!.iris_new_write).toBe(false);
  });

  it("`allProfiles: true` map matches the per-profile resource reads for each profile", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      profiles: { prod: { iris_new_write: true } },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    const all = discoveryOf(
      await callTool(server, SERVER_DISCOVERY_TOOL_NAME, { allProfiles: true }),
    );
    // No single policy in all-profiles mode.
    expect(all.governance.policy).toBeUndefined();
    expect(all.governance.profile).toBeUndefined();
    expect(Object.keys(all.governance.policies!).sort()).toEqual([
      "default",
      "prod",
    ]);

    // Each per-profile map equals that profile's live resource read.
    for (const name of ["default", "prod"]) {
      expect(all.governance.policies![name]).toEqual(
        await resourcePolicy(server, name),
      );
    }
    expect(all.governance.policies!.prod!.iris_new_write).toBe(true);
    expect(all.governance.policies!.default!.iris_new_write).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// E2E-4 — default-only back-compat through the wire.
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 E2E — back-compat off-state through the wire", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("no IRIS_PROFILES/IRIS_GOVERNANCE → one default profile, every policy entry enabled", async () => {
    setDefaultEnv();
    // env.setup already deleted IRIS_PROFILES + IRIS_GOVERNANCE.
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    const discovery = discoveryOf(
      await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}),
    );
    expect(discovery.profiles).toHaveLength(1);
    expect(discovery.profiles[0]!.name).toBe("default");

    // Under the empty-config seed, the only seed-disabled entry is the NEW write;
    // every grandfathered/read entry (including discovery) is enabled.
    const policy = discovery.governance.policy!;
    expect(policy.iris_doc_get).toBe(true);
    expect(policy.iris_global_get).toBe(true);
    expect(policy[SERVER_DISCOVERY_TOOL_NAME]).toBe(true);
    expect(policy.iris_new_write).toBe(false); // NEW write → seed-disabled

    // And the wire still serves the same map (no drift in the off-state either).
    expect(policy).toEqual(await resourcePolicy(server, "default"));
  });

  it("package tools still behave exactly as before (additive — discovery is the only new name)", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    // A pre-existing read tool is unchanged.
    const echo = await callTool(server, "iris_doc_get", { namespace: "X" });
    expect(echo.isError).toBeFalsy();
    expect(echo.structuredContent).toMatchObject({ ns: "X" });

    // Advertised surface = the package tools + exactly one new framework name.
    const names = server.getToolNames().sort();
    expect(names).toEqual(
      ["iris_doc_get", "iris_global_get", "iris_new_write", SERVER_DISCOVERY_TOOL_NAME].sort(),
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// E2E-5 — governance gate denies the tool ONLY when explicitly disabled.
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 E2E — governance gate over the discovery tool", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("enabled by default (read) — a plain call succeeds", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    expect(result.isError).toBeFalsy();
    expect(discoveryOf(result).profiles).toHaveLength(1);
  });

  it("an operator who explicitly disables it gets a GOVERNANCE_DISABLED denial", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { [SERVER_DISCOVERY_TOOL_NAME]: false },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(representativeTools()));
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: SERVER_DISCOVERY_TOOL_NAME,
      server: "default",
    });
    // The denial is consistent with what the policy map advertises for the key.
    // (The resource read still works — only the discovery tool's CALL is gated.)
    const policy = await resourcePolicy(server, "default");
    expect(policy[SERVER_DISCOVERY_TOOL_NAME]).toBe(false);
  });
});
