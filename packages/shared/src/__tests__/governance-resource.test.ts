/**
 * Story 14.5 — Governance Discovery Resource & `resources` Capability.
 *
 * Exercises the advisory governance RESOURCE wired into `McpServerBase`
 * (architecture decision D6 — the minimal single-resource provider, NOT a
 * generalized framework). Drives the REAL MCP SDK resource surface through the
 * underlying `Server`'s registered request handlers (`resources/list`,
 * `resources/templates/list`, `resources/read`) with NO live IRIS:
 *
 *   AC 14.5.1 — the `resources` capability is advertised (the `initialize`
 *               result carries it; asserted via the underlying Server's
 *               getCapabilities(), which is exactly what _oninitialize returns).
 *   AC 14.5.2 — `resources/list` includes the static default policy resource;
 *               `resources/templates/list` exposes `iris-governance://{profile}`.
 *   AC 14.5.3 — `resources/read` of `iris-governance://{profile}` returns the
 *               effective policy map for that profile (cross-checked against
 *               getEffectivePolicy); an unknown profile → structured error.
 *   AC 14.5.4 — advisory: a client that NEVER reads the resource still gets
 *               correct call-time enforcement (the gate is authoritative).
 *   AC 14.5.5 — capability advertised, list/templates/read shapes, per-profile
 *               policy correctness, unknown-profile error (this file).
 *
 * Harness mirrors `governance-enforcement.test.ts` / `server-param-integration
 * .test.ts`: mocked `bootstrap`, `fetchMock` for the default profile's startup
 * HEAD (health) + GET (version), hermetic env save/restore. Discoverable by the
 * default `vitest run` suite (`*.test.ts`). TypeScript-only — no
 * `BOOTSTRAP_VERSION` impact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
// Import governance ENGINE values from their direct modules (not the `../index.js`
// barrel): the barrel transitively re-exports `server-base.js`, which imports
// `bootstrap.js`, and that import would be evaluated during the hoisted `vi.mock`
// factory below — before `bootstrapSpy` is initialized. `governance.js` /
// `governance-baseline.js` have no such dependency, so importing from them is safe.
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import {
  getEffectivePolicy,
  parseGovernanceConfig,
  buildMutatesLookup,
} from "../governance.js";
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

const GOV_DEFAULT_URI = "iris-governance://default";
const GOV_TEMPLATE_URI = "iris-governance://{profile}";

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
 * (e.g. "resources/list"). Drives the REAL SDK dispatch — including URI→template
 * matching for "resources/read" — exactly as a connected client would.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: any, method: string, params: unknown) {
  // server (McpServerBase) → .server (McpServer) → .server (Server).
  const innerServer = server.server.server;
  const handlers = innerServer._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get(method);
  if (!handler) {
    throw new Error(`No request handler registered for "${method}"`);
  }
  // Minimal RequestHandlerExtra stub — the governance resource callbacks ignore
  // it, and the (undefined) template list callback is never invoked.
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

/** The underlying Server's advertised capabilities (what _oninitialize returns). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function advertisedCapabilities(server: any): Record<string, unknown> {
  return server.server.server.getCapabilities();
}

/** Extract the first content block's text from a ReadResourceResult (strict-safe). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstContentText(result: any): string {
  const contents = result.contents as Array<{ text: string }>;
  const first = contents[0];
  if (!first) throw new Error("resources/read returned no contents");
  return first.text;
}

/** Parse the first content block of a ReadResourceResult as the policy map. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readPolicy(result: any): Record<string, boolean> {
  return JSON.parse(firstContentText(result)) as Record<string, boolean>;
}

/** Shared environment save/restore for hermetic runs. */
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
  process.env.IRIS_PASSWORD = "p";
  process.env.IRIS_HOST = "default.example.com";
  process.env.IRIS_NAMESPACE = "DEFAULTNS";
}

// ════════════════════════════════════════════════════════════════════
// AC 14.5.1 — the `resources` capability is advertised.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — `resources` capability advertised (AC 14.5.1)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a constructed server advertises BOTH tools and resources (pre-start)", () => {
    // The capability is declared in the constructor → available even before
    // start(). _oninitialize returns getCapabilities(), so this is exactly what
    // the initialize result carries.
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    const caps = advertisedCapabilities(server);
    expect(caps.resources).toBeDefined();
    expect(caps.resources).toMatchObject({ listChanged: true });
    // Additive — the pre-existing tools capability is still present.
    expect(caps.tools).toMatchObject({ listChanged: true });
  });

  it("the capability is still advertised after start() (SDK auto-registration does not clobber it)", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");
    const caps = advertisedCapabilities(server);
    expect(caps.resources).toMatchObject({ listChanged: true });
    expect(caps.tools).toMatchObject({ listChanged: true });
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.5.2 — resources/list + resources/templates/list.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — resources/list and resources/templates/list (AC 14.5.2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("resources/list includes the static default-policy resource", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const result = await callRequest(server, "resources/list", {});
    const resources = result.resources as Array<{ uri: string; name: string }>;
    const def = resources.find((r) => r.uri === GOV_DEFAULT_URI);
    expect(def, "default policy resource must be listed").toBeDefined();
    expect(def?.name).toBe("iris-governance-default");
  });

  it("resources/templates/list exposes the iris-governance://{profile} template", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const result = await callRequest(server, "resources/templates/list", {});
    const templates = result.resourceTemplates as Array<{
      name: string;
      uriTemplate: string;
    }>;
    const tmpl = templates.find((t) => t.uriTemplate === GOV_TEMPLATE_URI);
    expect(tmpl, "per-profile template must be listed").toBeDefined();
    expect(tmpl?.name).toBe("iris-governance-profile");
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.5.3 — resources/read of the per-profile policy + unknown-profile error.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — resources/read effective policy (AC 14.5.3)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("read of iris-governance://default returns the default profile's effective map (JSON)", async () => {
    setDefaultEnv();
    // Disable a grandfathered read globally so the map is non-trivial.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
    });
    stageDefaultStartup(env.fetchMock);

    const tools = [makeEchoTool("iris_doc_get"), makeWriteTool("iris_new_write")];
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    const result = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    const contents = result.contents as Array<{
      uri: string;
      mimeType: string;
      text: string;
    }>;
    expect(contents).toHaveLength(1);
    const block = contents[0];
    if (!block) throw new Error("resources/read returned no contents");
    expect(block.uri).toBe(GOV_DEFAULT_URI);
    expect(block.mimeType).toBe("application/json");

    const policy = JSON.parse(block.text) as Record<string, boolean>;
    // Globally disabled grandfathered read → false.
    expect(policy.iris_doc_get).toBe(false);
    // NEW write, no override → seed-disabled → false.
    expect(policy.iris_new_write).toBe(false);
    // The map covers the full baseline (a representative grandfathered key is
    // present and enabled).
    expect(policy.iris_database_list).toBe(true);

    // Cross-check the ENTIRE map against getEffectivePolicy with the same inputs.
    const allKeys = new Set<string>(GOVERNANCE_BASELINE);
    allKeys.add("iris_doc_get"); // already in baseline; harmless
    allKeys.add("iris_new_write"); // NEW key the server registered
    const expected = getEffectivePolicy(
      "default",
      parseGovernanceConfig({ IRIS_GOVERNANCE: process.env.IRIS_GOVERNANCE }),
      allKeys,
      buildMutatesLookup(tools),
    );
    expect(policy).toEqual(expected);
  });

  it("read of iris-governance://prod returns the PROD profile's effective map (profile override honored)", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    // A NEW write is seed-disabled everywhere; prod re-enables it.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      profiles: { prod: { iris_new_write: true } },
    });
    stageDefaultStartup(env.fetchMock);

    const tools = [makeWriteTool("iris_new_write")];
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    // prod: the override flips the seed-disabled write to enabled.
    const prodResult = await callRequest(server, "resources/read", {
      uri: "iris-governance://prod",
    });
    const prodPolicy = readPolicy(prodResult);
    expect(prodPolicy.iris_new_write).toBe(true);

    // default: no override → still seed-disabled. Proves per-profile distinction.
    const defResult = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    const defPolicy = readPolicy(defResult);
    expect(defPolicy.iris_new_write).toBe(false);
  });

  it("read of an unknown profile surfaces a structured error (server does not crash)", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com" },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    // The template matches any authority, so an unknown profile resolves the
    // template read callback → ProfileResolutionError → McpError (rejected).
    await expect(
      callRequest(server, "resources/read", { uri: "iris-governance://ghost" }),
    ).rejects.toThrow(/Unknown server profile "ghost"/);

    // The server is still fully usable after the failed read — a subsequent
    // valid read + a tool call both succeed (no crash / corrupted state).
    const ok = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    expect((ok.contents as unknown[]).length).toBe(1);
    const toolResult = await callTool(server, "iris_doc_get", {});
    expect(toolResult.isError).toBeFalsy();
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.5.4 — advisory: enforcement does not depend on reading the resource.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — the resource is advisory; the gate is authoritative (AC 14.5.4)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a client that NEVER reads the resource still gets the seed-disabled write denied at call time", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeWriteTool("iris_new_write")]),
    );
    await server.start("stdio");

    // No resources/read happens here — go straight to a tool call. The gate
    // (14.4) denies the seed-disabled NEW write regardless of the resource.
    const result = await callTool(server, "iris_new_write", { value: "x" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_new_write",
      server: "default",
    });
  });

  it("reading the resource does NOT change enforcement (read then call → same denial)", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeWriteTool("iris_new_write")]),
    );
    await server.start("stdio");

    // Read the advisory resource first (it reports the write as disabled)…
    const read = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    const policy = readPolicy(read);
    expect(policy.iris_new_write).toBe(false);

    // …and the actual call is STILL denied identically. The resource read had no
    // effect on the gate — it is purely advisory.
    const result = await callTool(server, "iris_new_write", { value: "x" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Multi-action key alignment: the resource map keys match the gate's keys.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — resource policy keys align with the gate (tool:action) (D4/D6)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a multi-action tool contributes `tool:action` keys to the effective map", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);

    // A NEW multi-action tool (not in the baseline) with mixed mutation classes.
    const tool: ToolDefinition = {
      name: "iris_new_manage",
      title: "New manage",
      description: "A NEW multi-action tool.",
      inputSchema: z.object({
        action: z.enum(["list", "create"]),
        name: z.string().optional(),
      }),
      annotations: { readOnlyHint: false },
      scope: "NS",
      mutates: { list: "read", create: "write" },
      handler: async () => ({
        content: [{ type: "text" as const, text: "ran" }],
      }),
    };
    const server = new McpServerBase(makeServerOpts([tool]));
    await server.start("stdio");

    const result = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    const policy = readPolicy(result);

    // Keys are `tool:action` (matching the gate's computeGovernanceKey).
    expect("iris_new_manage:list" in policy).toBe(true);
    expect("iris_new_manage:create" in policy).toBe(true);
    // No bare `iris_new_manage` key (it has an action enum).
    expect("iris_new_manage" in policy).toBe(false);
    // NEW read action → enabled by seed; NEW write action → disabled by seed.
    expect(policy["iris_new_manage:list"]).toBe(true);
    expect(policy["iris_new_manage:create"]).toBe(false);
  });
});
