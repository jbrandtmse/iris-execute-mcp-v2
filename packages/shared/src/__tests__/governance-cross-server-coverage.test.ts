/**
 * Story 14.5 — AC 14.5.6 capstone HARDENING (QA stage): COMPLEMENTARY coverage
 * for the cross-server foundation that `governance-cross-server.test.ts` (the
 * dev's 3 tests) does not already assert. No duplication of the dev's 2-server
 * isolation / uniform-deny tests — these strengthen the capstone along axes the
 * dev left open:
 *
 *   (a) THREE-way per-profile session isolation (D1) on a SINGLE server: three
 *       profiles → three distinct clients → three host-unique cookies, none of
 *       which bleeds onto another profile's request, under `Promise.all`. The
 *       dev proves 2 profiles × 2 servers; a 3-profile fan-out on one server is a
 *       distinct, stronger isolation shape (n>2 within one registry).
 *
 *   (b) SYMMETRY of uniform enforcement (D5): the dev proves a globally-disabled
 *       write is DENIED identically on both servers. The complement: a profile
 *       that RE-ENABLES that same write is ALLOWED identically on both servers
 *       (and the still-default profile stays denied on both). Enforcement is
 *       uniform in BOTH directions — deny and re-allow — across servers.
 *
 *   (c) ADVISORY has ZERO enforcement side-effect across servers (AC 14.5.4):
 *       reading the resource on one server does not change the OTHER server's (or
 *       its own) call-time decision — the gate is the sole authority.
 *
 *   (d) BACK-COMPAT: a server that ALSO advertises `resources` still serves
 *       `tools/list` and a normal tool call unchanged — the `resources` addition
 *       is purely additive for tools-only clients.
 *
 * Hermetic + deterministic (mocked fetch, no network) → DEFAULT `vitest run` as a
 * plain `*.test.ts` (the `*.integration.test.ts` suffix the vitest config
 * excludes is reserved for live-IRIS variants; this capstone hardening must run
 * by default). TypeScript-only — no `BOOTSTRAP_VERSION` impact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import type { ToolDefinition } from "../tool-types.js";

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

const { McpServerBase } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;

// ── Tools ───────────────────────────────────────────────────────────

/**
 * A READ tool that performs a real (mocked) HTTP GET via the per-call client.
 * Returns the host it was routed to and triggers an actual fetch so the test can
 * inspect the request's `Cookie` header (the heart of the D1 isolation assertion).
 */
function makeProbeReadTool(name = "iris_doc_get"): ToolDefinition {
  return {
    name,
    title: "Probe read",
    description: "Reads via the per-call client (triggers a real HTTP GET).",
    inputSchema: z.object({ namespace: z.string().optional() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    handler: async (_args, ctx) => {
      await ctx.http.get("/api/atelier/v1/%SYS/namespaces");
      return {
        content: [{ type: "text" as const, text: `host=${ctx.config.host}` }],
        structuredContent: { host: ctx.config.host },
      };
    },
  };
}

/**
 * A NEW single-op WRITE tool (scalar `mutates:"write"`). Disabled GLOBALLY by
 * the capstone policy; a profile may RE-ENABLE it to prove uniform re-allow.
 */
function makeWriteTool(name = "iris_shared_write"): ToolDefinition {
  return {
    name,
    title: "Shared write",
    description: "A write action governed identically on both servers.",
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: "write",
    handler: async () => ({
      content: [{ type: "text" as const, text: "WROTE" }],
      structuredContent: { wrote: true },
    }),
  };
}

function makeServerOpts(
  name: string,
  tools: ToolDefinition[],
): McpServerBaseOptions {
  return { name, version: "1.0.0", tools, needsCustomRest: false };
}

// ── SDK callback / request-handler access ───────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

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

// ── Host-aware fetch mock (mirrors governance-cross-server.test.ts) ──

/**
 * A fetch mock that issues a UNIQUE `Set-Cookie` (CSPSESSIONID=<host-token>) on
 * the FIRST response to each host (so each profile's client builds a
 * host-specific session cookie), records every request's URL + `Cookie` header,
 * and returns a fresh version/list body for GET and an empty 200 for HEAD.
 */
function makeHostAwareFetch() {
  const calls: Array<{
    host: string;
    method: string;
    cookie: string | undefined;
  }> = [];
  const seenHosts = new Set<string>();

  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const u = new URL(url);
      const host = u.hostname;
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({ host, method, cookie: headers["Cookie"] });

      const responseHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      let hostCookie: string | undefined;
      if (!seenHosts.has(host)) {
        seenHosts.add(host);
        hostCookie = `CSPSESSIONID=sess-${host}; path=/`;
        responseHeaders["Set-Cookie"] = hostCookie;
      }

      const body =
        method === "HEAD"
          ? null
          : JSON.stringify({
              status: { errors: [] },
              console: [],
              result: { version: "8.0.0", content: [] },
            });
      const response = new Response(body, {
        status: 200,
        headers: responseHeaders,
      });
      // Patch getSetCookie for older supported Node versions / the test
      // environment: a constructor-set `Set-Cookie` is NOT reliably retrievable
      // through `Headers.getSetCookie()` across the supported Node range
      // (engines.node >= 18). The production client reads cookies ONLY via
      // `response.headers.getSetCookie()`, so without this patch the per-profile
      // cookie jars would stay empty on Node 18 and the D1 isolation assertions
      // would fail. Mirrors every other cookie-bearing mock in this package.
      if (hostCookie) {
        const original = response.headers.getSetCookie?.bind(response.headers);
        response.headers.getSetCookie = () => [
          ...(original?.() ?? []),
          hostCookie,
        ];
      }
      return Promise.resolve(response);
    },
  );

  return { fetchMock, calls };
}

// ── Env harness ─────────────────────────────────────────────────────

function makeEnvHarness() {
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
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
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

  return { setup, teardown };
}

// ════════════════════════════════════════════════════════════════════
// (a) THREE-way per-profile session isolation on a single server (D1).
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 AC 14.5.6(a) — three-way per-profile session isolation on one server (D1)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("three profiles → three distinct clients/cookies; no profile's session leaks onto another, concurrently", async () => {
    const { fetchMock, calls } = makeHostAwareFetch();
    globalThis.fetch = fetchMock;

    // One server, THREE profiles on three distinct hosts (default + prod + dr).
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "d.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "p.example.com", namespace: "PRODNS" },
      dr: { host: "r.example.com", namespace: "DRNS" },
    });

    const server = new McpServerBase(
      makeServerOpts("server-3way", [makeProbeReadTool()]),
    );
    await server.start("stdio"); // default established eagerly
    // Establish the two non-default profiles up front so per-call GETs don't race
    // establishment (each profile's host cookie is set by its establishment HEAD).
    await server.getOrCreateClient("prod", false);
    await server.getOrCreateClient("dr", false);

    // Fire reads on all THREE profiles concurrently.
    const [rd, rp, rr] = await Promise.all([
      callTool(server, "iris_doc_get", {}), // default
      callTool(server, "iris_doc_get", { server: "prod" }), // prod
      callTool(server, "iris_doc_get", { server: "dr" }), // dr
    ]);

    // Each call routed to its OWN host.
    expect(rd.structuredContent).toEqual({ host: "d.example.com" });
    expect(rp.structuredContent).toEqual({ host: "p.example.com" });
    expect(rr.structuredContent).toEqual({ host: "r.example.com" });

    // Isolation proof across all three hosts: each host's GET carries ONLY its
    // own session cookie and NEVER another host's token.
    const hosts = ["d.example.com", "p.example.com", "r.example.com"];
    const ownToken = (h: string) => `CSPSESSIONID=sess-${h}`;
    for (const host of hosts) {
      const hostCalls = calls.filter((c) => c.host === host);
      const getCall = hostCalls.find((c) => c.method === "GET");
      expect(getCall, `expected a GET to ${host}`).toBeDefined();
      expect(getCall?.cookie).toBe(ownToken(host));
      for (const other of hosts) {
        if (other === host) continue;
        for (const c of hostCalls) {
          expect(
            c.cookie?.includes(`sess-${other}`) ?? false,
            `request to ${host} leaked ${other}'s session cookie`,
          ).toBe(false);
        }
      }
    }

    // Structural: all three profiles hold distinct client instances.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cd = (server as any).clients.getOrCreate("default");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cp = (server as any).clients.getOrCreate("prod");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cr = (server as any).clients.getOrCreate("dr");
    expect(new Set([cd, cp, cr]).size).toBe(3);
  });
});

// ════════════════════════════════════════════════════════════════════
// (b) Symmetry: a profile that RE-ENABLES a globally-disabled write is allowed
//     identically on both servers; the default profile stays denied on both.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 AC 14.5.6(b) — uniform RE-ENABLE across two servers (D5 symmetry)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  /**
   * Construct + start a server whose default profile is `defaultHost` and which
   * has one extra `prod` profile; establish prod up front for determinism.
   */
  async function startServer(
    name: string,
    defaultHost: string,
    prodHost: string,
    tools: ToolDefinition[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = defaultHost;
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
    // NOTE: IRIS_PROFILES is set per-server here; IRIS_GOVERNANCE is set ONCE by
    // the test before constructing either server (parsed in each start()).
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: prodHost, namespace: "PRODNS" },
    });
    const server = new McpServerBase(makeServerOpts(name, tools));
    await server.start("stdio");
    await server.getOrCreateClient("prod", false);
    return server;
  }

  it("prod re-enables the globally-disabled write → ALLOWED on both servers; default stays DENIED on both", async () => {
    const { fetchMock } = makeHostAwareFetch();
    globalThis.fetch = fetchMock;

    // Disable the write GLOBALLY, but RE-ENABLE it for the prod profile. Same
    // single policy drives both servers.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_shared_write: false },
      profiles: { prod: { iris_shared_write: true } },
    });

    const tools = () => [makeProbeReadTool(), makeWriteTool()];
    const server1 = await startServer(
      "server-1",
      "s1d.example.com",
      "s1p.example.com",
      tools(),
    );
    const server2 = await startServer(
      "server-2",
      "s2d.example.com",
      "s2p.example.com",
      tools(),
    );

    const [w1prod, w2prod, w1def, w2def] = await Promise.all([
      callTool(server1, "iris_shared_write", { server: "prod", value: "x" }),
      callTool(server2, "iris_shared_write", { server: "prod", value: "x" }),
      callTool(server1, "iris_shared_write", { value: "x" }),
      callTool(server2, "iris_shared_write", { value: "x" }),
    ]);

    // prod re-enable: the write is ALLOWED (handler runs) on BOTH servers,
    // identically. The handler's structuredContent proves it actually executed
    // (no GOVERNANCE_DISABLED), uniformly across servers.
    for (const allowed of [w1prod, w2prod]) {
      expect(allowed.isError).toBeFalsy();
      expect(allowed.structuredContent).toEqual({ wrote: true });
      expect(allowed.content[0].text).toBe("WROTE");
    }
    expect(w1prod.structuredContent).toEqual(w2prod.structuredContent);

    // default profile: NO re-enable → still DENIED, identically on both servers.
    for (const denied of [w1def, w2def]) {
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toEqual({
        code: "GOVERNANCE_DISABLED",
        action: "iris_shared_write",
        server: "default",
      });
    }
    expect(w1def.structuredContent).toEqual(w2def.structuredContent);
  });
});

// ════════════════════════════════════════════════════════════════════
// (c) Advisory has zero enforcement side-effect across servers (AC 14.5.4).
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — reading the advisory resource has zero enforcement side-effect across servers (AC 14.5.4)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  async function startServer(
    name: string,
    defaultHost: string,
    tools: ToolDefinition[],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = defaultHost;
    process.env.IRIS_NAMESPACE = "DEFAULTNS";
    const server = new McpServerBase(makeServerOpts(name, tools));
    await server.start("stdio");
    return server;
  }

  it("reading server1's resource does NOT alter server2's (or server1's own) call-time decision", async () => {
    const { fetchMock } = makeHostAwareFetch();
    globalThis.fetch = fetchMock;

    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_shared_write: false },
    });

    const server1 = await startServer("server-1", "s1d.example.com", [
      makeProbeReadTool(),
      makeWriteTool(),
    ]);
    const server2 = await startServer("server-2", "s2d.example.com", [
      makeProbeReadTool(),
      makeWriteTool(),
    ]);

    // Read the advisory resource on server1 ONLY, repeatedly — a no-op for state.
    await callRequest(server1, "resources/read", {
      uri: "iris-governance://default",
    });
    await callRequest(server1, "resources/read", {
      uri: "iris-governance://default",
    });

    // server2 (whose resource was NEVER read) still denies the write…
    const w2 = await callTool(server2, "iris_shared_write", { value: "x" });
    expect(w2.isError).toBe(true);
    expect(w2.structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED" });

    // …and server1 (whose resource WAS read) denies it identically — the reads
    // changed nothing. Reads PASS on both (the policy only touched the write).
    const w1 = await callTool(server1, "iris_shared_write", { value: "x" });
    expect(w1.isError).toBe(true);
    expect(w1.structuredContent).toMatchObject({ code: "GOVERNANCE_DISABLED" });

    const r1 = await callTool(server1, "iris_doc_get", {});
    const r2 = await callTool(server2, "iris_doc_get", {});
    expect(r1.isError).toBeFalsy();
    expect(r2.isError).toBeFalsy();
  });
});

// ════════════════════════════════════════════════════════════════════
// (d) Back-compat: a resources-bearing server still serves tools/list + calls.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — adding `resources` is additive: tools/list and tool calls unchanged (back-compat)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a server with the governance resource still lists its tool via tools/list and runs it normally", async () => {
    const { fetchMock } = makeHostAwareFetch();
    globalThis.fetch = fetchMock;

    process.env.IRIS_USERNAME = "u";
    process.env.IRIS_PASSWORD = "p";
    process.env.IRIS_HOST = "bc.example.com";
    process.env.IRIS_NAMESPACE = "DEFAULTNS";

    const server = new McpServerBase(
      makeServerOpts("server-bc", [makeProbeReadTool("iris_doc_get")]),
    );
    await server.start("stdio");

    // tools/list still works and advertises the tool (the `resources` capability
    // did not disturb the tools surface a tools-only client relies on).
    const listed = await callRequest(server, "tools/list", {});
    const toolNames = (listed.tools as Array<{ name: string }>).map(
      (t) => t.name,
    );
    expect(toolNames).toContain("iris_doc_get");

    // A normal tool call still succeeds unchanged.
    const result = await callTool(server, "iris_doc_get", {});
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ host: "bc.example.com" });
  });
});
