/**
 * Story 14.2 — `server` parameter dispatch: COMPLEMENTARY integration coverage.
 *
 * This file complements `server-param.test.ts` (the dev's AC 14.2.1–14.2.8
 * suite). It does NOT duplicate those tests; it exercises the central
 * `handleToolCall` dispatch path through gaps the primary suite leaves open:
 *
 * 1. `server` × `namespace` across ALL FOUR tool scopes (NS / SYS / BOTH /
 *    NONE) — proving SYS forces `%SYS` regardless of the selected profile and
 *    any `namespace` override, NONE ignores both, and NS/BOTH honor the
 *    override-then-profile precedence.
 * 2. `server` value edge cases: empty string and `undefined` both resolve to
 *    the default profile; a whitespace-only name is NOT treated as default and
 *    surfaces a structured unknown-profile error (resolveProfile only special-
 *    cases "" and undefined).
 * 3. THREE distinct non-default profiles selected concurrently — N-way client +
 *    namespace isolation (the primary suite proves 2-way).
 * 4. The in-flight establishment-Promise cache CLEARS on a REJECTED first-touch
 *    establishment, so a subsequent concurrent burst re-establishes cleanly
 *    (pairs with `ProfileClientRegistry.drop`).
 * 5. Additive-schema back-compat for a tool whose ORIGINAL input schema carries
 *    its own REQUIRED field: `server` is still injected + validated + stripped,
 *    and the required field is still enforced.
 * 6. Unknown-profile structured `isError` shape — the handler is NEVER invoked
 *    (proven via a spy), and the result is `{ content:[text], isError:true }`.
 *
 * Provable WITHOUT a live IRIS server (vitest + mocked fetch + bootstrap spy).
 * Discoverable by the default `vitest run` suite (`*.test.ts`, not
 * `*.integration.test.ts`). No `BOOTSTRAP_VERSION` impact — TypeScript-only,
 * all in `@iris-mcp/shared`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";

// A successful, no-op bootstrap result (REST service already current). Mirrors
// the shape used by server-param.test.ts / profiles-bootstrap.test.ts.
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
type ToolDefinition = import("../tool-types.js").ToolDefinition;
type ToolScope = import("../tool-types.js").ToolScope;
type IrisConnectionConfig = import("../config.js").IrisConnectionConfig;

// ── Helpers ─────────────────────────────────────────────────────────

function makeConfig(): IrisConnectionConfig {
  return {
    host: "localhost",
    port: 52773,
    username: "testuser",
    password: "testpass",
    namespace: "HSCUSTOM",
    https: false,
    baseUrl: "http://localhost:52773",
    timeout: 60_000,
  };
}

/** Atelier version-negotiation response body (major 8 — matches dev suite). */
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

/**
 * An echo tool with a CONFIGURABLE scope. Its handler echoes the resolved
 * namespace and the host of the client it was handed — enough to prove profile
 * selection + namespace resolution per scope + cross-profile isolation. It
 * fails loudly if it ever receives a `server` key (D2 strip-before-handler).
 */
function makeEchoTool(name = "iris_doc_get", scope: ToolScope = "NS"): ToolDefinition {
  return {
    name,
    title: "Echo",
    description: "Echo the resolved namespace + client host.",
    inputSchema: z.object({
      namespace: z.string().optional().describe("Target namespace"),
    }),
    annotations: { readOnlyHint: true },
    scope,
    handler: async (args, ctx) => {
      const a = args as Record<string, unknown>;
      if ("server" in a) {
        return {
          content: [{ type: "text" as const, text: "LEAK: server reached handler" }],
          isError: true,
        };
      }
      const ns = ctx.resolveNamespace(a.namespace as string | undefined);
      const host = ctx.config.host;
      return {
        content: [{ type: "text" as const, text: `ns=${ns};host=${host}` }],
        structuredContent: { ns, host },
      };
    },
  };
}

function makeServerOpts(
  tools: ToolDefinition[] = [],
  config?: IrisConnectionConfig,
  needsCustomRest = false,
): McpServerBaseOptions {
  const opts: McpServerBaseOptions = {
    name: "test-server",
    version: "1.0.0",
    tools,
    needsCustomRest,
  };
  if (config !== undefined) opts.config = config;
  return opts;
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
 * Shared environment save/restore so each describe block runs hermetically and
 * never leaks IRIS_* / IRIS_PROFILES into sibling suites.
 */
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

// ── (1) server × namespace across all four tool scopes ──────────────

describe("Story 14.2 (complementary) — `server` × `namespace` across all tool scopes", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  /**
   * Start a server exposing one echo tool per scope, with a default profile
   * plus a "prod" profile on a distinct host + namespace.
   */
  async function startWithScopedTools(): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server: any;
  }> {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });

    // start(): default profile health check + negotiation.
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());

    const server = new McpServerBase(
      makeServerOpts([
        makeEchoTool("iris_ns_tool", "NS"),
        makeEchoTool("iris_sys_tool", "SYS"),
        makeEchoTool("iris_both_tool", "BOTH"),
        makeEchoTool("iris_none_tool", "NONE"),
      ]),
    );
    await server.start("stdio");
    return { server };
  }

  /** Establish the prod profile once so per-call assertions don't race establishment. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function establishProd(server: any): Promise<void> {
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    await server.getOrCreateClient("prod", false);
  }

  it("SYS scope forces `%SYS` regardless of the selected profile AND any namespace override", async () => {
    const { server } = await startWithScopedTools();
    await establishProd(server);

    // prod profile + an explicit namespace override — SYS must ignore BOTH.
    const result = await callTool(server, "iris_sys_tool", {
      server: "prod",
      namespace: "SHOULDBEIGNORED",
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      ns: "%SYS",
      host: "prod.example.com", // client still came from the prod profile
    });
  });

  it("NONE scope resolves to empty namespace, ignoring both the profile namespace and an override", async () => {
    const { server } = await startWithScopedTools();
    await establishProd(server);

    const result = await callTool(server, "iris_none_tool", {
      server: "prod",
      namespace: "SHOULDBEIGNORED",
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      ns: "",
      host: "prod.example.com",
    });
  });

  it("BOTH scope honors a namespace override within the selected profile", async () => {
    const { server } = await startWithScopedTools();
    await establishProd(server);

    const overridden = await callTool(server, "iris_both_tool", {
      server: "prod",
      namespace: "OVERRIDENS",
    });
    expect(overridden.structuredContent).toEqual({
      ns: "OVERRIDENS",
      host: "prod.example.com",
    });
  });

  it("BOTH scope falls back to the selected profile's namespace when no override is given", async () => {
    const { server } = await startWithScopedTools();
    await establishProd(server);

    const fallback = await callTool(server, "iris_both_tool", { server: "prod" });
    expect(fallback.structuredContent).toEqual({
      ns: "PRODNS",
      host: "prod.example.com",
    });
  });

  it("NS scope: default profile (omitted `server`) + override resolves the override on the DEFAULT host", async () => {
    const { server } = await startWithScopedTools();

    // No `server` → default profile (host default.example.com), namespace
    // override wins over the default profile's DEFAULTNS.
    const result = await callTool(server, "iris_ns_tool", {
      namespace: "ADHOCNS",
    });
    expect(result.structuredContent).toEqual({
      ns: "ADHOCNS",
      host: "default.example.com",
    });
  });
});

// ── (2) `server` value edge cases: empty / undefined / whitespace ───

describe("Story 14.2 (complementary) — `server` value edge cases", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  /** Start with a default + "prod" profile (env path so IRIS_PROFILES parses). */
  async function startWithProfiles(): Promise<{
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server: any;
  }> {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    const server = new McpServerBase(makeServerOpts([makeEchoTool()]));
    await server.start("stdio");
    return { server };
  }

  it("empty-string `server` resolves to the default profile (same as omitted)", async () => {
    const { server } = await startWithProfiles();
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_doc_get", { server: "" });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      ns: "DEFAULTNS",
      host: "default.example.com",
    });
    // Default profile was established eagerly in start() → no extra fetches.
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });

  it("undefined `server` (absent key) resolves to the default profile", async () => {
    const { server } = await startWithProfiles();
    const result = await callTool(server, "iris_doc_get", {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      ns: "DEFAULTNS",
      host: "default.example.com",
    });
  });

  it("whitespace-only `server` is NOT treated as default — structured unknown-profile error", async () => {
    const { server } = await startWithProfiles();
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_doc_get", { server: "   " });
    expect(result.isError).toBe(true);
    const text = result.content[0].text as string;
    // The whitespace name is echoed back verbatim as the unknown profile.
    expect(text).toContain('Unknown server profile "   "');
    // Valid names are listed so the client can correct the request.
    expect(text).toContain("default");
    expect(text).toContain("prod");
    // No establishment fetch was issued for the bad name.
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
  });
});

// ── (3) three distinct non-default profiles concurrently (N-way) ────

describe("Story 14.2 (complementary) — N-way concurrent profile isolation", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("three distinct non-default profiles selected concurrently stay isolated (client + namespace)", async () => {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
    process.env.IRIS_PROFILES = JSON.stringify({
      alpha: { host: "alpha.example.com", namespace: "ALPHANS" },
      beta: { host: "beta.example.com", namespace: "BETANS" },
      gamma: { host: "gamma.example.com", namespace: "GAMMANS" },
    });

    // start(): default profile.
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    const server = new McpServerBase(makeServerOpts([makeEchoTool()]));
    await server.start("stdio");

    // Establish all three non-default profiles up front (deterministic — keeps
    // each profile's HEAD+GET pair from interleaving with the concurrent calls
    // under test). Each routes to its own host, proving client isolation.
    for (const _name of ["alpha", "beta", "gamma"]) {
      env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      env.fetchMock.mockResolvedValueOnce(versionResponse());
      await server.getOrCreateClient(_name, false);
    }

    // Fire all three profile calls + a default call concurrently.
    const [alpha, beta, gamma, def] = await Promise.all([
      callTool(server, "iris_doc_get", { server: "alpha" }),
      callTool(server, "iris_doc_get", { server: "beta" }),
      callTool(server, "iris_doc_get", { server: "gamma" }),
      callTool(server, "iris_doc_get", {}),
    ]);

    expect(alpha.structuredContent).toEqual({ ns: "ALPHANS", host: "alpha.example.com" });
    expect(beta.structuredContent).toEqual({ ns: "BETANS", host: "beta.example.com" });
    expect(gamma.structuredContent).toEqual({ ns: "GAMMANS", host: "gamma.example.com" });
    expect(def.structuredContent).toEqual({ ns: "DEFAULTNS", host: "default.example.com" });

    // Each profile's health check went to ITS OWN host — no cross-bleed.
    for (const host of [
      "alpha.example.com",
      "beta.example.com",
      "gamma.example.com",
    ]) {
      const hit = env.fetchMock.mock.calls.find((c) => String(c[0]).includes(host));
      expect(hit, `expected a fetch to ${host}`).toBeDefined();
    }
  });

  it("concurrent first-touch of three DIFFERENT profiles establishes each exactly once", async () => {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_PROFILES = JSON.stringify({
      alpha: { host: "alpha.example.com" },
      beta: { host: "beta.example.com" },
      gamma: { host: "gamma.example.com" },
    });

    // start(): default profile.
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    const server = new McpServerBase(makeServerOpts([], undefined, false));
    await server.start("stdio");

    // All non-default establishment fetches succeed. Use a per-CALL mock
    // implementation that returns a FRESH Response each time (a Response body is
    // single-use; a shared instance would be consumed by the first negotiation
    // and make later ones default to v1). A fresh GET response per call lets
    // every profile genuinely negotiate v8. HEAD (health) ignores the body, so a
    // 200 with no body satisfies it.
    env.fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "HEAD") {
        return Promise.resolve(new Response(null, { status: 200 }));
      }
      return Promise.resolve(versionResponse());
    });

    const [a, b, g] = await Promise.all([
      server.getOrCreateClient("alpha", false),
      server.getOrCreateClient("beta", false),
      server.getOrCreateClient("gamma", false),
    ]);

    // Distinct client instances — never the same client across profiles.
    expect(a.client).not.toBe(b.client);
    expect(b.client).not.toBe(g.client);
    expect(a.client).not.toBe(g.client);
    // Each profile genuinely negotiated v8 (no consumed-body fallback to v1).
    expect(a.atelierVersion).toBe(8);
    expect(b.atelierVersion).toBe(8);
    expect(g.atelierVersion).toBe(8);

    for (const host of [
      "alpha.example.com",
      "beta.example.com",
      "gamma.example.com",
    ]) {
      const hostFetches = env.fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes(host),
      );
      // Exactly HEAD (health) + GET (negotiation) — established once.
      expect(hostFetches.length, `${host} establishment fetch count`).toBe(2);
    }
  });
});

// ── (4) establishment-Promise cache clears on rejection → retryable ─

describe("Story 14.2 (complementary) — in-flight establishment cache clears on rejection", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a concurrent burst that all reject leaves no lingering in-flight entry; a later burst re-establishes", async () => {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_PROFILES = JSON.stringify({
      other: { host: "other.example.com" },
    });

    // start(): default profile establishes fine.
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    const server = new McpServerBase(makeServerOpts([], undefined, false));
    await server.start("stdio");

    // First touch of "other" health check REJECTS. Two concurrent callers share
    // the single in-flight establishment, so BOTH reject and the shared client
    // is dropped exactly once.
    env.fetchMock.mockRejectedValueOnce(new TypeError("Connection refused"));
    const results = await Promise.allSettled([
      server.getOrCreateClient("other", false),
      server.getOrCreateClient("other", false),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("rejected");

    // The in-flight cache entry was cleared (settled → finally deletes it) and
    // the un-established client was dropped.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const establishing = (server as any).establishing as Map<string, unknown>;
    expect(establishing.has("other")).toBe(false);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = (server as any).clients;
    expect(registry.has("other")).toBe(false);

    // A NEW concurrent burst now succeeds — proving the failure was retryable
    // and the cache did not pin the rejected promise. Exactly one fresh
    // establishment is shared by both retry callers.
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    const [r1, r2] = await Promise.all([
      server.getOrCreateClient("other", false),
      server.getOrCreateClient("other", false),
    ]);
    expect(r1.client).toBe(r2.client); // shared establishment on retry
    expect(r1.atelierVersion).toBe(8);
    expect(registry.has("other")).toBe(true);

    // Only one HEAD+GET pair for the successful retry establishment.
    const otherFetches = env.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("other.example.com"),
    );
    // 1 rejected HEAD (first burst) + 1 HEAD + 1 GET (retry) = 3 total.
    expect(otherFetches.length).toBe(3);
  });
});

// ── (5) additive-schema back-compat for a REQUIRED-field tool ───────

describe("Story 14.2 (complementary) — additive `server` on a tool with required fields", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  /** A tool whose ORIGINAL schema has its own REQUIRED field (`docName`). */
  function makeRequiredFieldTool(): ToolDefinition {
    return {
      name: "iris_required_field_tool",
      title: "Required-field tool",
      description: "Has a required docName; echoes it back.",
      inputSchema: z.object({
        docName: z.string().describe("Required document name"),
        namespace: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
      scope: "NS",
      handler: async (args, ctx) => {
        const a = args as Record<string, unknown>;
        if ("server" in a) {
          return {
            content: [{ type: "text" as const, text: "LEAK: server reached handler" }],
            isError: true,
          };
        }
        const ns = ctx.resolveNamespace(a.namespace as string | undefined);
        return {
          content: [{ type: "text" as const, text: `doc=${String(a.docName)};ns=${ns}` }],
          structuredContent: { docName: a.docName, ns, host: ctx.config.host },
        };
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function startWithRequiredFieldTool(): Promise<any> {
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    const server = new McpServerBase(
      makeServerOpts([makeRequiredFieldTool()], makeConfig()),
    );
    await server.start("stdio");
    return server;
  }

  it("advertises `server` AND keeps the original required field", () => {
    const server = new McpServerBase(makeServerOpts([makeRequiredFieldTool()]));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reg = (server.server as any)._registeredTools["iris_required_field_tool"];
    const keys = Object.keys(reg.inputSchema.shape);
    expect(keys).toContain("server");
    expect(keys).toContain("docName");
    // The required field is still required: an arg object omitting it fails,
    // even though it includes a valid `server`.
    expect(reg.inputSchema.safeParse({ server: "default" }).success).toBe(false);
    // Providing the required field (with or without server) validates.
    expect(reg.inputSchema.safeParse({ docName: "Foo.cls" }).success).toBe(true);
    expect(
      reg.inputSchema.safeParse({ docName: "Foo.cls", server: "default" }).success,
    ).toBe(true);
  });

  it("missing the required field returns a structured validation isError (handler not invoked)", async () => {
    const server = await startWithRequiredFieldTool();
    // `server` present but the required docName omitted → Zod validation fails.
    const result = await callTool(server, "iris_required_field_tool", {
      server: "default",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
    expect(result.content[0].text).toContain("docName");
  });

  it("strips `server` before the handler while passing the required field through", async () => {
    const server = await startWithRequiredFieldTool();
    const result = await callTool(server, "iris_required_field_tool", {
      docName: "Foo.cls",
      server: "default",
    });
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).not.toContain("LEAK");
    expect(result.structuredContent).toEqual({
      docName: "Foo.cls",
      ns: "HSCUSTOM",
      host: "localhost",
    });
  });
});

// ── (6) unknown-profile isError shape — handler never invoked ───────

describe("Story 14.2 (complementary) — unknown-profile structured error never reaches the handler", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("unknown `server` returns { content:[text], isError:true } and the handler is NEVER called", async () => {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "default.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());

    // A tool whose handler is a spy — if the gate works, it is never invoked.
    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const tool: ToolDefinition = {
      name: "iris_guarded_tool",
      title: "Guarded",
      description: "Handler must not run on an unknown profile.",
      inputSchema: z.object({ namespace: z.string().optional() }),
      annotations: { readOnlyHint: true },
      scope: "NS",
      handler: handlerSpy,
    };

    const server = new McpServerBase(makeServerOpts([tool]));
    await server.start("stdio");

    const result = await callTool(server, "iris_guarded_tool", { server: "ghost" });

    // Structured isError shape (per architecture D2 / D5: structured denial, no throw).
    expect(result.isError).toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
    expect(result.content[0].text).toContain('Unknown server profile "ghost"');
    // The error names valid profiles so the client can self-correct.
    expect(result.content[0].text).toContain("default");
    expect(result.content[0].text).toContain("prod");

    // The handler was never invoked — the gate short-circuited before dispatch.
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});
