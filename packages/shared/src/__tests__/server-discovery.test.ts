/**
 * Story 19.0 — Server & Governance Discovery Tool (Epic 19, decision E1).
 *
 * Exercises the FRAMEWORK-PROVIDED discovery tool (`iris_server_profiles`) wired
 * centrally into `McpServerBase` (decision E1 — like the D2 `server`-param
 * injection and the D6 governance resource). Drives the REAL SDK tool callback
 * (the handleToolCall path, where the tool is special-cased before the IRIS
 * connection) with NO live IRIS. Mirrors the harness of
 * `governance-resource.test.ts`.
 *
 *   AC 19.0.1 — the tool is present on a constructed server WITHOUT any package
 *               tools/index.ts wiring (framework-provided).
 *   AC 19.0.2 — roster shape + the password-absence assertion (allow-list).
 *   AC 19.0.3 — effective policy via getEffectivePolicy; optional `profile`;
 *               `allProfiles`; unknown-profile → structured error.
 *   AC 19.0.4 — governance classification: registration does not throw; the new
 *               key is `mutates: "read"`; baseline untouched (separate check test).
 *   AC 19.0.5 — the MCP `instructions` field is set on the server base.
 *   AC 19.0.6 — back-compat: with no IRIS_PROFILES/IRIS_GOVERNANCE, exactly one
 *               `default` profile + the default-seed policy (all baseline enabled).
 *   AC 19.0.7 — the per-profile resource template `list` enumerates profiles.
 *   AC 19.0.8 — all of the above.
 *
 * Discoverable by the default `vitest run` suite (`*.test.ts`). TypeScript-only —
 * no BOOTSTRAP_VERSION impact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
// Import engine values from their direct modules (not the `../index.js` barrel):
// the barrel transitively re-exports server-base.js → bootstrap.js, which would
// be evaluated during the hoisted vi.mock factory before bootstrapSpy exists.
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import {
  getEffectivePolicy,
  parseGovernanceConfig,
  buildMutatesLookup,
} from "../governance.js";
import {
  SERVER_DISCOVERY_TOOL_NAME,
  SERVER_DISCOVERY_INSTRUCTIONS,
  serverDiscoveryTool,
} from "../server-discovery.js";
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

function makeServerOpts(
  tools: ToolDefinition[],
  needsCustomRest = false,
): McpServerBaseOptions {
  return { name: "test-server", version: "1.0.0", tools, needsCustomRest };
}

/** A read echo tool with NO `mutates` — a grandfathered action. */
function makeEchoTool(name: string): ToolDefinition {
  return {
    name,
    title: "Echo",
    description: "Echo the resolved namespace.",
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

/** Invoke a tool through the SDK-registered callback (the handleToolCall path). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

/** Invoke a request handler on the underlying Server by method name. */
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
// AC 19.0.1 — present on every server without per-package wiring.
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 — discovery tool is framework-provided (AC 19.0.1)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("the tool is registered on a server whose tools array does NOT contain it", () => {
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    expect(server.getToolNames()).toContain(SERVER_DISCOVERY_TOOL_NAME);
  });

  it("it is advertised through the SDK registry (callable as a tool)", () => {
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdkTools = (server.server as any)._registeredTools;
    expect(sdkTools[SERVER_DISCOVERY_TOOL_NAME]).toBeDefined();
  });

  it("a package supplying a same-named tool fails fast (reserved name)", () => {
    const collide = makeEchoTool(SERVER_DISCOVERY_TOOL_NAME);
    expect(() => new McpServerBase(makeServerOpts([collide]))).toThrow(
      /reserved by the framework/,
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 19.0.2 — roster shape + password-absence.
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 — profile roster + password redaction (AC 19.0.2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("roster entries carry the allow-listed non-secret fields and isDefault", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    const discovery = discoveryOf(result);
    expect(discovery.profiles).toHaveLength(1);
    const def = discovery.profiles[0]!;
    expect(def).toEqual({
      name: "default",
      isDefault: true,
      host: "default.example.com",
      port: 52773,
      username: "u",
      namespace: "DEFAULTNS",
      https: false,
      baseUrl: "http://default.example.com:52773",
      timeout: expect.any(Number),
    });
  });

  it("NO `password` key appears anywhere in the output — even under multi-profile IRIS_PROFILES", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", password: "anothersecret", namespace: "PRODNS" },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    const discovery = discoveryOf(result);
    expect(discovery.profiles.map((p) => p.name).sort()).toEqual(["default", "prod"]);
    // No roster entry has a `password` own key (the allow-list guarantee).
    for (const entry of discovery.profiles) {
      expect(Object.prototype.hasOwnProperty.call(entry, "password")).toBe(false);
    }
    // No roster entry serializes a "password" key (precise: the roster JSON, not
    // the governance map, which legitimately contains keys like
    // `iris_user_password:change`).
    const rosterJson = JSON.stringify(discovery.profiles);
    expect(rosterJson).not.toContain("password");
    // No secret VALUE leaks anywhere in the full serialized output.
    const text = (result.content as Array<{ text: string }>)[0]!.text;
    expect(text).not.toContain("supersecret");
    expect(text).not.toContain("anothersecret");
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 19.0.3 — effective policy (single + all-profiles), non-drift.
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 — effective governance policy (AC 19.0.3)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("single-profile policy toEqual getEffectivePolicy (non-drift with the D6 resource)", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_doc_get: false } });
    stageDefaultStartup(env.fetchMock);

    const tools = [makeEchoTool("iris_doc_get"), makeWriteTool("iris_new_write")];
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    const discovery = discoveryOf(result);
    expect(discovery.governance.profile).toBe("default");

    const allKeys = new Set<string>(GOVERNANCE_BASELINE);
    allKeys.add("iris_doc_get");
    allKeys.add("iris_new_write");
    allKeys.add(SERVER_DISCOVERY_TOOL_NAME);
    const expected = getEffectivePolicy(
      "default",
      parseGovernanceConfig({ IRIS_GOVERNANCE: process.env.IRIS_GOVERNANCE }),
      allKeys,
      buildMutatesLookup([...tools, serverDiscoveryTool]),
    );
    expect(discovery.governance.policy).toEqual(expected);
    // Sanity: the discovery tool's own key is enabled (read).
    expect(discovery.governance.policy![SERVER_DISCOVERY_TOOL_NAME]).toBe(true);
    // The globally-disabled grandfathered read is false.
    expect(discovery.governance.policy!.iris_doc_get).toBe(false);
  });

  it("optional `profile` arg selects the named profile's policy", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      profiles: { prod: { iris_new_write: true } },
    });
    stageDefaultStartup(env.fetchMock);

    const server = new McpServerBase(makeServerOpts([makeWriteTool("iris_new_write")]));
    await server.start("stdio");

    const prod = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, { profile: "prod" }));
    expect(prod.governance.profile).toBe("prod");
    expect(prod.governance.policy!.iris_new_write).toBe(true);

    const def = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(def.governance.policy!.iris_new_write).toBe(false);
  });

  it("`allProfiles: true` returns a per-profile policy map (no single policy)", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      profiles: { prod: { iris_new_write: true } },
    });
    stageDefaultStartup(env.fetchMock);

    const server = new McpServerBase(makeServerOpts([makeWriteTool("iris_new_write")]));
    await server.start("stdio");

    const result = discoveryOf(
      await callTool(server, SERVER_DISCOVERY_TOOL_NAME, { allProfiles: true }),
    );
    expect(result.governance.policy).toBeUndefined();
    expect(result.governance.profile).toBeUndefined();
    expect(Object.keys(result.governance.policies!).sort()).toEqual(["default", "prod"]);
    expect(result.governance.policies!.prod!.iris_new_write).toBe(true);
    expect(result.governance.policies!.default!.iris_new_write).toBe(false);
  });

  it("`allProfiles` map is collision-safe for a profile named `__proto__` (no silent loss / no prototype mutation)", async () => {
    // Regression (CR 19.0): the all-profiles map is built with Object.defineProperty
    // (mirroring getEffectivePolicy) so a profile whose name collides with a
    // prototype member becomes a real OWN enumerable property instead of silently
    // no-op'ing the assignment (or mutating Object.prototype).
    setDefaultEnv();
    // Build the JSON literally: `JSON.stringify({ __proto__: ... })` yields `{}`
    // because in an object literal `__proto__:` sets the prototype. A real client
    // could still send this raw JSON, so test against the literal string.
    process.env.IRIS_PROFILES =
      '{"__proto__":{"host":"evil.example.com","namespace":"EVILNS"}}';
    stageDefaultStartup(env.fetchMock);

    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const result = discoveryOf(
      await callTool(server, SERVER_DISCOVERY_TOOL_NAME, { allProfiles: true }),
    );
    // The `__proto__` profile is a real OWN key in the policies map, with a value.
    expect(
      Object.prototype.hasOwnProperty.call(result.governance.policies!, "__proto__"),
    ).toBe(true);
    expect(Object.keys(result.governance.policies!).sort()).toEqual([
      "__proto__",
      "default",
    ]);
    expect(result.governance.policies!["__proto__"]).toBeTypeOf("object");
    // Object.prototype was NOT polluted.
    expect(({} as Record<string, unknown>).host).toBeUndefined();
  });

  it("an unknown `profile` arg surfaces a structured error (server not crashed)", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, { profile: "ghost" });
    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toMatch(
      /Unknown server profile "ghost"/,
    );

    // The server still works afterward.
    const ok = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    expect(ok.isError).toBeFalsy();
  });

  it("works even when the connection is never established (no IRIS dependency)", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    // start() consumed the 2 staged fetches; no further fetch is staged. If the
    // discovery call tried to connect, fetchMock would reject/return undefined.
    const before = env.fetchMock.mock.calls.length;
    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    expect(result.isError).toBeFalsy();
    // No additional fetch was made by the discovery call.
    expect(env.fetchMock.mock.calls.length).toBe(before);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 19.0.4 — governance classification.
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 — governance classification (AC 19.0.4)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("the tool declares mutates: read and registration does not throw", () => {
    expect(serverDiscoveryTool.mutates).toBe("read");
    expect(() => new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]))).not.toThrow();
  });

  it("the discovery key is NOT a baseline member (a new key) yet classified", () => {
    expect(GOVERNANCE_BASELINE.has(SERVER_DISCOVERY_TOOL_NAME)).toBe(false);
    expect(buildMutatesLookup([serverDiscoveryTool]).get(SERVER_DISCOVERY_TOOL_NAME)).toBe(
      "read",
    );
  });

  it("an operator CAN disable the read tool via governance (gate still applies)", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { [SERVER_DISCOVERY_TOOL_NAME]: false },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: SERVER_DISCOVERY_TOOL_NAME,
      server: "default",
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 19.0.5 — MCP `instructions` field.
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 — MCP instructions field (AC 19.0.5)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("the server base sets the instructions field (carried into initialize)", () => {
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const instructions = (server.server.server as any)._instructions as string;
    expect(instructions).toBe(SERVER_DISCOVERY_INSTRUCTIONS);
    expect(instructions).toContain(SERVER_DISCOVERY_TOOL_NAME);
    expect(instructions.toLowerCase()).toContain("first");
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 19.0.6 — back-compat (mechanical proof).
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 — back-compat off-state (AC 19.0.6)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("no IRIS_PROFILES/IRIS_GOVERNANCE → one `default` profile + default-seed policy (all baseline enabled)", async () => {
    setDefaultEnv();
    // env.setup already deleted IRIS_PROFILES + IRIS_GOVERNANCE.
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    // Exactly one profile: default.
    expect(discovery.profiles).toHaveLength(1);
    expect(discovery.profiles[0]!.name).toBe("default");
    expect(discovery.profiles[0]!.isDefault).toBe(true);
    expect(discovery.defaultProfile).toBe("default");

    // Default-seed policy: EVERY baseline key resolves enabled.
    const policy = discovery.governance.policy!;
    for (const key of GOVERNANCE_BASELINE) {
      expect(policy[key]).toBe(true);
    }
    // The new read tool's own key is also enabled by default.
    expect(policy[SERVER_DISCOVERY_TOOL_NAME]).toBe(true);
  });

  it("does not change the existing tool set: an unrelated tool's schema/output is untouched", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const echo = makeEchoTool("iris_doc_get");
    const server = new McpServerBase(makeServerOpts([echo]));
    await server.start("stdio");

    // The echo tool still works exactly as before (no behavioral change).
    const echoResult = await callTool(server, "iris_doc_get", { namespace: "X" });
    expect(echoResult.isError).toBeFalsy();
    expect(echoResult.structuredContent).toMatchObject({ ns: "X" });

    // The discovery tool is additive: present, but the only NEW advertised name.
    const names = server.getToolNames().sort();
    expect(names).toEqual(["iris_doc_get", SERVER_DISCOVERY_TOOL_NAME].sort());
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 19.0.7 — resource template `list` enumerates profiles.
// ════════════════════════════════════════════════════════════════════

describe("Story 19.0 — governance resource list enumerates profiles (AC 19.0.7)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("resources/list includes one iris-governance://<profile> entry per configured profile", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const result = await callRequest(server, "resources/list", {});
    const uris = (result.resources as Array<{ uri: string }>).map((r) => r.uri);
    // The static default resource is still present (D6).
    expect(uris).toContain("iris-governance://default");
    // The template `list` callback enumerated each profile, including prod.
    expect(uris).toContain("iris-governance://prod");
  });
});

/** A NEW single-op write tool (scalar `mutates: "write"`) — seed-disabled. */
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
