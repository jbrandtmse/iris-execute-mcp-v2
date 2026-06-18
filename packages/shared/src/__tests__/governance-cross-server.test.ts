/**
 * Story 14.5 — AC 14.5.6: cross-server FOUNDATION integration test (the Epic-14
 * capstone). The single highest-value test of the multi-server foundation —
 * land it before declaring Epic 14 done.
 *
 * Exercises D1 (per-profile session isolation) and D5 (one enforcement
 * chokepoint, uniform across servers) END-TO-END across TWO `McpServerBase`
 * instances with two profiles each, under concurrency, with NO live IRIS
 * (mocked `fetch`). This is the cross-cutting risk the per-story unit suites
 * (e.g. AC 14.1.6 session isolation, AC 14.4.x enforcement) verify only in
 * isolation; here both servers run together.
 *
 * Hermetic + deterministic (mocked fetch, no network), so it lives in the
 * DEFAULT `vitest run` as a plain `*.test.ts` (the suite's `*.integration.test
 * .ts` suffix is reserved for live-IRIS tests, which the default run excludes —
 * this capstone must run by default, so it is NOT suffixed). TypeScript-only —
 * no `BOOTSTRAP_VERSION` impact.
 *
 * (a) PER-PROFILE SESSION ISOLATION (D1): each profile gets its OWN
 *     `IrisHttpClient`; a cookie/session established on profile A's client never
 *     appears on profile B's request headers — across both servers, under
 *     `Promise.all`. Proven by inspecting the `Cookie` header the mocked fetch
 *     receives per host.
 *
 * (b) UNIFORM GOVERNANCE ENFORCEMENT (D5): with the SAME `IRIS_GOVERNANCE`
 *     disabling a write action, BOTH servers reject that action at call time
 *     with the IDENTICAL structured denial (`code:"GOVERNANCE_DISABLED"`), while
 *     a read action passes on both. One shared chokepoint, enforced uniformly.
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
 * Returns the host it was routed to so the test can confirm profile selection,
 * and triggers an actual fetch so the test can inspect the request's `Cookie`
 * header (the heart of the D1 isolation assertion).
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
      // A GET carries the client's session cookie (if any) — exactly what we
      // inspect for cross-profile bleed.
      await ctx.http.get("/api/atelier/v1/%SYS/namespaces");
      return {
        content: [{ type: "text" as const, text: `host=${ctx.config.host}` }],
        structuredContent: { host: ctx.config.host },
      };
    },
  };
}

/**
 * A NEW single-op WRITE tool (scalar `mutates:"write"`). Being NEW + a write, it
 * is seed-disabled, but the capstone disables it EXPLICITLY via a global policy
 * to prove uniform global enforcement across both servers.
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

// ── SDK callback access ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  const entry = sdkTools[name];
  const callback = entry.callback ?? entry.handler ?? entry.cb;
  return callback(args);
}

// ── Host-aware fetch mock ───────────────────────────────────────────

/**
 * A fetch mock that:
 * - issues a UNIQUE `Set-Cookie` (CSPSESSIONID=<host-token>) on the FIRST
 *   response to each host, so each profile's client builds a host-specific
 *   session cookie;
 * - records every request's URL + `Cookie`/`Authorization` headers for later
 *   isolation assertions;
 * - returns a fresh version body for GET (single-use body) and an empty 200 for
 *   HEAD.
 */
function makeHostAwareFetch() {
  const calls: Array<{
    host: string;
    method: string;
    cookie: string | undefined;
    authorization: string | undefined;
  }> = [];
  const seenHosts = new Set<string>();

  const fetchMock = vi.fn(
    (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const u = new URL(url);
      const host = u.hostname;
      const method = (init?.method ?? "GET").toUpperCase();
      const headers = (init?.headers ?? {}) as Record<string, string>;
      calls.push({
        host,
        method,
        cookie: headers["Cookie"],
        authorization: headers["Authorization"],
      });

      const responseHeaders: Record<string, string> = {
        "Content-Type": "application/json",
      };
      // First response from a host sets a host-unique session cookie. Track the
      // cookie separately so it can be surfaced via getSetCookie() (see below).
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
      // environment: a `Set-Cookie` set via the Response constructor is NOT
      // reliably retrievable through `Headers.getSetCookie()` across the Node
      // range this package supports (engines.node >= 18; undici changed this
      // over its lifecycle). The production client reads cookies ONLY via
      // `response.headers.getSetCookie()` (http-client.ts), so without this
      // patch the per-profile cookie jars would stay empty on Node 18 and the
      // D1 isolation assertions would fail. Mirrors the convention used by every
      // other cookie-bearing mock in this package (http-client/health/profiles
      // tests).
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

/**
 * Construct + start a server whose default profile is `defaultHost` and which
 * has one extra profile `prodName`→`prodHost`. Establishes the prod profile up
 * front (deterministic) so per-call assertions don't race establishment.
 */
async function startServer(
  serverName: string,
  defaultHost: string,
  prodName: string,
  prodHost: string,
  tools: ToolDefinition[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  process.env.IRIS_USERNAME = "u";
  process.env.IRIS_PASSWORD = "p";
  process.env.IRIS_HOST = defaultHost;
  process.env.IRIS_NAMESPACE = "DEFAULTNS";
  process.env.IRIS_PROFILES = JSON.stringify({
    [prodName]: { host: prodHost, namespace: "PRODNS" },
  });

  const server = new McpServerBase(makeServerOpts(serverName, tools));
  await server.start("stdio"); // default profile: HEAD + GET
  await server.getOrCreateClient(prodName, false); // prod profile: HEAD + GET
  return server;
}

// ════════════════════════════════════════════════════════════════════
// (a) Per-profile session isolation across BOTH servers, under concurrency.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 AC 14.5.6(a) — per-profile session isolation across two servers (D1)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a cookie established on one profile never appears on another profile's requests (cross-server, concurrent)", async () => {
    const { fetchMock, calls } = makeHostAwareFetch();
    globalThis.fetch = fetchMock;

    // Server 1: default=s1d.example.com, prod=s1p.example.com.
    // Server 2: default=s2d.example.com, prod=s2p.example.com.
    // Four distinct hosts → four distinct clients → four distinct cookies.
    const server1 = await startServer(
      "server-1",
      "s1d.example.com",
      "prod",
      "s1p.example.com",
      [makeProbeReadTool()],
    );
    const server2 = await startServer(
      "server-2",
      "s2d.example.com",
      "prod",
      "s2p.example.com",
      [makeProbeReadTool()],
    );

    // Fire reads on BOTH profiles of BOTH servers concurrently. Each handler
    // performs a real (mocked) GET carrying its client's session cookie.
    const [r1d, r1p, r2d, r2p] = await Promise.all([
      callTool(server1, "iris_doc_get", {}), // server1 default
      callTool(server1, "iris_doc_get", { server: "prod" }), // server1 prod
      callTool(server2, "iris_doc_get", {}), // server2 default
      callTool(server2, "iris_doc_get", { server: "prod" }), // server2 prod
    ]);

    // Each call routed to ITS OWN host (proves profile selection + client).
    expect(r1d.structuredContent).toEqual({ host: "s1d.example.com" });
    expect(r1p.structuredContent).toEqual({ host: "s1p.example.com" });
    expect(r2d.structuredContent).toEqual({ host: "s2d.example.com" });
    expect(r2p.structuredContent).toEqual({ host: "s2p.example.com" });

    // ── The isolation proof ──────────────────────────────────────────
    // Group recorded requests by host. After each host's establishment HEAD set
    // a host-unique cookie, every subsequent request to that host must carry
    // ONLY that host's cookie — and NEVER any other host's cookie token.
    const hosts = [
      "s1d.example.com",
      "s1p.example.com",
      "s2d.example.com",
      "s2p.example.com",
    ];
    const ownToken = (h: string) => `CSPSESSIONID=sess-${h}`;

    for (const host of hosts) {
      const hostCalls = calls.filter((c) => c.host === host);
      // The first GET fired against this host (the version-negotiation GET during
      // establishment, whose preceding HEAD already set the host cookie): it must
      // carry this host's own cookie. Every later GET — including the tool
      // handler's — carries the same jar, asserted to bear no foreign token below.
      const getCall = hostCalls.find((c) => c.method === "GET");
      expect(getCall, `expected a GET to ${host}`).toBeDefined();
      expect(getCall?.cookie).toBe(ownToken(host));

      // …and NO request to this host may carry ANOTHER host's session token.
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

    // Structural isolation: every profile across both servers has its OWN client
    // instance — no client object is shared between any two profiles/servers.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c1d = (server1 as any).clients.getOrCreate("default");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c1p = (server1 as any).clients.getOrCreate("prod");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c2d = (server2 as any).clients.getOrCreate("default");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c2p = (server2 as any).clients.getOrCreate("prod");
    const clientSet = new Set([c1d, c1p, c2d, c2p]);
    expect(clientSet.size).toBe(4); // all four are distinct instances
  });
});

// ════════════════════════════════════════════════════════════════════
// (b) Uniform governance enforcement across BOTH servers (one chokepoint).
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 AC 14.5.6(b) — uniform governance enforcement across two servers (D5)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("the SAME IRIS_GOVERNANCE disabling a write denies it IDENTICALLY on both servers; reads pass on both", async () => {
    const { fetchMock } = makeHostAwareFetch();
    globalThis.fetch = fetchMock;

    // One shared policy: disable the write globally.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_shared_write: false },
    });

    const tools = () => [makeProbeReadTool(), makeWriteTool()];
    const server1 = await startServer(
      "server-1",
      "s1d.example.com",
      "prod",
      "s1p.example.com",
      tools(),
    );
    const server2 = await startServer(
      "server-2",
      "s2d.example.com",
      "prod",
      "s2p.example.com",
      tools(),
    );

    // The write is denied on BOTH servers, on BOTH the default and prod profiles,
    // concurrently — with the identical structured denial (modulo the `server`
    // field, which reflects the targeted profile).
    const [w1def, w1prod, w2def, w2prod] = await Promise.all([
      callTool(server1, "iris_shared_write", { value: "x" }),
      callTool(server1, "iris_shared_write", { server: "prod", value: "x" }),
      callTool(server2, "iris_shared_write", { value: "x" }),
      callTool(server2, "iris_shared_write", { server: "prod", value: "x" }),
    ]);

    for (const denial of [w1def, w2def]) {
      expect(denial.isError).toBe(true);
      expect(denial.structuredContent).toEqual({
        code: "GOVERNANCE_DISABLED",
        action: "iris_shared_write",
        server: "default",
      });
    }
    for (const denial of [w1prod, w2prod]) {
      expect(denial.isError).toBe(true);
      expect(denial.structuredContent).toEqual({
        code: "GOVERNANCE_DISABLED",
        action: "iris_shared_write",
        server: "prod",
      });
    }
    // The two servers' DEFAULT-profile denials are byte-identical structured
    // content — uniform enforcement, not two independent implementations.
    expect(w1def.structuredContent).toEqual(w2def.structuredContent);
    expect(w1def.content[0].text).toBe(w2def.content[0].text);

    // Reads PASS on both servers (the policy only disabled the write). Each is
    // routed to its own host, confirming the read path is unaffected.
    const [r1, r2] = await Promise.all([
      callTool(server1, "iris_doc_get", {}),
      callTool(server2, "iris_doc_get", {}),
    ]);
    expect(r1.isError).toBeFalsy();
    expect(r1.structuredContent).toEqual({ host: "s1d.example.com" });
    expect(r2.isError).toBeFalsy();
    expect(r2.structuredContent).toEqual({ host: "s2d.example.com" });
  });

  it("the advisory resource on BOTH servers reports the write as disabled — consistent with the gate", async () => {
    const { fetchMock } = makeHostAwareFetch();
    globalThis.fetch = fetchMock;

    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_shared_write: false },
    });

    const server1 = await startServer(
      "server-1",
      "s1d.example.com",
      "prod",
      "s1p.example.com",
      [makeProbeReadTool(), makeWriteTool()],
    );
    const server2 = await startServer(
      "server-2",
      "s2d.example.com",
      "prod",
      "s2p.example.com",
      [makeProbeReadTool(), makeWriteTool()],
    );

    // Read the advisory default-policy resource on each server via its registered
    // read handler (the static `iris-governance://default` resource).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async function readDefaultPolicy(server: any): Promise<Record<string, boolean>> {
      const handlers = server.server.server._requestHandlers as Map<
        string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (req: any, extra: any) => Promise<any>
      >;
      const handler = handlers.get("resources/read");
      if (!handler) throw new Error("no resources/read handler registered");
      const extra = {
        signal: new AbortController().signal,
        sendNotification: async () => {},
        sendRequest: async () => ({}),
      };
      const result = await handler(
        { method: "resources/read", params: { uri: "iris-governance://default" } },
        extra,
      );
      const contents = result.contents as Array<{ text: string }>;
      const first = contents[0];
      if (!first) throw new Error("resources/read returned no contents");
      return JSON.parse(first.text) as Record<string, boolean>;
    }

    const policy1 = await readDefaultPolicy(server1);
    const policy2 = await readDefaultPolicy(server2);

    // Both report the write disabled (advisory matches the gate's decision)…
    expect(policy1.iris_shared_write).toBe(false);
    expect(policy2.iris_shared_write).toBe(false);
    // …and the read enabled.
    expect(policy1.iris_doc_get).toBe(true);
    expect(policy2.iris_doc_get).toBe(true);
  });
});
