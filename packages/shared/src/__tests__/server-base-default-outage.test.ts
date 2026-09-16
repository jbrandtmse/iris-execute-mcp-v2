/**
 * Story 37.1 — default-profile outage must not take down the server
 * (architecture record M1, Epic 37: "a configuration error fails startup
 * fast; an unreachable peer never does" — amending D1). AC 37.1.4-37.1.7.
 *
 * `McpServerBase.start()` eagerly establishes the reserved `default` profile
 * (health check → version negotiation → optional bootstrap) as a WARM-UP,
 * never a startup gate. Before this story, a health-check rejection called
 * `process.exit(1)` before the transport ever connected (`server-base.
 * test.ts:558`, flipped in this story) — one unreachable instance took the
 * whole server down even when every OTHER registered profile was healthy.
 * This file proves the fix's four commitments (M1):
 *
 *  1. `start()` RESOLVES and the transport connects even when the default
 *     profile's health check rejects — with only `default` registered, and
 *     with other profiles also registered (AC 37.1.4).
 *  2. Other profiles serve calls normally throughout; a call against
 *     `default` while it is still unreachable returns the EXISTING
 *     structured `isError` envelope (`handleToolCall`'s
 *     `Could not connect to server profile "default": …`) — never a throw,
 *     never `process.exit` (AC 37.1.5).
 *  3. Once `default` becomes reachable, the NEXT call establishes it through
 *     the exact same lazy `getOrCreateClient`/`establishProfile` path every
 *     non-default profile already uses (Rule #47 — no new establishment
 *     logic), bootstrap included, attempted exactly once across the whole
 *     recovery, with concurrent first-touch calls coalescing into ONE
 *     establishment (AC 14.2.7 symmetry) (AC 37.1.5).
 *  4. The success path (a reachable default) is BYTE-FOR-BYTE unchanged: a
 *     `toEqual` pin of the exact startup fetch-call sequence (AC 37.1.6).
 *
 * Every fetch fake returns a shape the real `fetch`/Atelier API can actually
 * produce (Rule #54): a REJECTED `fetch` (`TypeError`) is what Node's
 * `fetch` throws on ECONNREFUSED (confirmed against a real closed-port run —
 * see the story's Dev Notes P3); a `HEAD` 200 + the version-negotiation JSON
 * are the real success shapes (`versionResponse()` below, matching
 * `server-base.test.ts`'s `versionResponse()`).
 *
 * The mock fetch below is URL/method-ROUTED (never a shared `mockResolvedValueOnce`
 * queue) so a rejected `HEAD` followed later by a successful `HEAD` for the
 * SAME profile never shifts a shared response queue out of order — the
 * lesson the story's Dev Notes call out from AC 36.1.7.
 *
 * Rule #59/#48 (gate proven RED on the path it guards): with the fix
 * reverted (the `:2026-2034` catch restored to `process.exit(1)`), 3 of the 5
 * tests below go RED — verified by hand during development (`git stash` the
 * fix, `vitest run` this file, confirm failures, `git stash pop` to restore).
 * Precisely: both "AC 37.1.4" tests (start() no longer resolves the way the
 * assertions expect — `exitMock` IS called) and AC 37.1.5's first test (the
 * pre-fix `process.exit(1)` mock is a no-op in tests, so execution falls
 * through past it, but the client is never DROPPED — `registry.has("default")`
 * is `true` where the test expects `false`, and the subsequent isError/
 * recovery assertions diverge). The remaining two tests do NOT go red and are
 * not claimed as RED-proof coverage: the "two concurrent calls" coalescing
 * test drives `getOrCreateClient` directly and exercises `establishProfile`'s
 * pre-existing (unchanged-by-this-story) lazy-establishment mechanism, which
 * P2 of the story's Dev Notes already established never special-cased
 * `default`; and the AC 37.1.6 toEqual pin drives the REACHABLE-default
 * success path, which this story leaves byte-for-byte unchanged by design —
 * it stays green on both the pre-fix and fixed code, as a back-compat pin
 * should. The guarded path proven RED is `McpServerBase.start()`'s
 * default-profile health-check catch, under a mocked-rejecting
 * `globalThis.fetch` — the exact call every real entry point
 * (`packages/*-mcp/src/index.ts`) makes via `server.start(transport)`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";

// Mock ONLY the `bootstrap` export (mirrors server-param.test.ts) so the
// at-most-once-across-recovery assertion is a clean call-count, while every
// other real export (used internally by server-base) keeps working.
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
const bootstrapSpy = vi.fn(
  async (
    _http: import("../http-client.js").IrisHttpClient,
    _config: import("../config.js").IrisConnectionConfig,
    _version: number,
  ) => okBootstrap,
);
vi.mock("../bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bootstrap.js")>();
  return { ...actual, bootstrap: bootstrapSpy };
});

// Import AFTER vi.mock so server-base picks up the mocked bootstrap.
const { McpServerBase } = await import("../server-base.js");
const { logger } = await import("../logger.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;
type ToolDefinition = import("../tool-types.js").ToolDefinition;
type IrisConnectionConfig = import("../config.js").IrisConnectionConfig;

// ── Helpers ─────────────────────────────────────────────────────────

const OTHER_HOST = "other.example.com";

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

/** Atelier version-negotiation response body (major 8) — a real success shape. */
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
 * A URL/method-ROUTED fetch fake (never a shared queue): requests to
 * `OTHER_HOST` always succeed (the "other" profile is always reachable in
 * these tests); requests to any other host succeed or reject per
 * `defaultReachable()`, evaluated fresh on EVERY call — so flipping the flag
 * mid-test changes behavior for the very next request, exactly like a real
 * instance coming back up. A rejection is a real `TypeError` (#54 — the shape
 * Node's `fetch` throws on ECONNREFUSED); a HEAD success is a bare 200; a GET
 * success is the real version-negotiation envelope.
 */
function makeRoutedFetch(defaultReachable: () => boolean): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url);
    const method = (init?.method ?? "GET").toUpperCase();
    const reachable = href.includes(OTHER_HOST) ? true : defaultReachable();
    if (!reachable) {
      throw new TypeError("Connection refused");
    }
    return method === "HEAD" ? new Response(null, { status: 200 }) : versionResponse();
  });
}

/**
 * A tool whose handler echoes the resolved namespace + client host — enough
 * to prove profile selection across the default-outage/recovery cycle. Fails
 * if it ever receives a `server` key (D2 strip-before-handler guarantee is
 * out of scope here but the check is cheap insurance). Named `iris_doc_get`
 * (a BASELINE governance key) so no `mutates` classification is required.
 */
function makeEchoTool(): ToolDefinition {
  return {
    name: "iris_doc_get",
    title: "Echo",
    description: "Echo the resolved namespace + client host.",
    inputSchema: z.object({
      namespace: z.string().optional().describe("Target namespace"),
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
      const host = ctx.config.host;
      return {
        content: [{ type: "text" as const, text: `ns=${ns};host=${host}` }],
        structuredContent: { ns, host },
      };
    },
  };
}

function makeServerOpts(
  tools: ToolDefinition[],
  config: IrisConnectionConfig,
  needsCustomRest = false,
): McpServerBaseOptions {
  return { name: "test-server", version: "1.0.0", tools, config, needsCustomRest };
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

// ── Tests ───────────────────────────────────────────────────────────

describe("server-base — default-profile outage degrades and recovers (Story 37.1, M1)", () => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv = { IRIS_PROFILES: process.env.IRIS_PROFILES };

  beforeEach(() => {
    bootstrapSpy.mockClear();
    exitMock = vi
      .spyOn(process, "exit")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((() => {}) as any);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  describe("AC 37.1.4 — startup survives a default-profile outage", () => {
    it("with ≥1 other profile registered: start() resolves, process.exit is NOT called, the transport connects, and the ERROR log names host:port + the continuation semantics", async () => {
      process.env.IRIS_PROFILES = JSON.stringify({ other: { host: OTHER_HOST } });
      const fetchMock = makeRoutedFetch(() => false); // default never reachable in this test
      globalThis.fetch = fetchMock;
      const errorSpy = vi.spyOn(logger, "error");
      const infoSpy = vi.spyOn(logger, "info");

      const server = new McpServerBase(makeServerOpts([], makeConfig()));
      await expect(server.start("stdio")).resolves.toBeUndefined();

      expect(exitMock).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalledWith("Connected via stdio transport");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to connect to IRIS at localhost:52773"),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Continuing startup without the "default" profile'),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("recover automatically"),
      );
    });

    it("with ONLY the default profile registered: the same non-fatal semantics apply (L-2)", async () => {
      delete process.env.IRIS_PROFILES;
      const fetchMock = makeRoutedFetch(() => false);
      globalThis.fetch = fetchMock;
      const errorSpy = vi.spyOn(logger, "error");
      const infoSpy = vi.spyOn(logger, "info");

      const server = new McpServerBase(makeServerOpts([], makeConfig()));
      await expect(server.start("stdio")).resolves.toBeUndefined();

      expect(exitMock).not.toHaveBeenCalled();
      // AC 37.1.4 says "the SAME assertion" as the multi-profile leg above, so
      // the single-server shape (the one the beta reporter actually hit) must
      // pin transport-connected and host:port too — added by the Story 37.1
      // code review, which found this leg was assertion-weaker than the AC
      // specifies: a regression that skipped the transport connect only when
      // IRIS_PROFILES is unset would have stayed green here.
      expect(infoSpy).toHaveBeenCalledWith("Connected via stdio transport");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to connect to IRIS at localhost:52773"),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Continuing startup without the "default" profile'),
      );
    });
  });

  describe("AC 37.1.5 — others serve; default degrades then recovers without restart", () => {
    it("a call on `other` succeeds while `default` is down; a call on `default` returns the existing isError envelope (no throw, no exit); default recovers on the next call with bootstrap attempted exactly once", async () => {
      process.env.IRIS_PROFILES = JSON.stringify({ other: { host: OTHER_HOST } });
      let defaultReachable = false;
      const fetchMock = makeRoutedFetch(() => defaultReachable);
      globalThis.fetch = fetchMock;

      // needsCustomRest: true so the recovery leg can prove bootstrap runs
      // exactly once across the whole outage->recovery cycle.
      const server = new McpServerBase(makeServerOpts([makeEchoTool()], makeConfig(), true));
      await server.start("stdio");
      expect(exitMock).not.toHaveBeenCalled();
      // The eager attempt failed: no startup bootstrap ran.
      expect(bootstrapSpy).not.toHaveBeenCalled();

      // The client was dropped (AC 14.2.8 symmetry) — no un-established
      // client lingers after the failed eager attempt.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registry = (server as any).clients;
      expect(registry.has("default")).toBe(false);

      // "other" serves normally — its own isolated first-touch establishment.
      const otherResult = await callTool(server, "iris_doc_get", { server: "other" });
      expect(otherResult.isError).toBeFalsy();
      expect(otherResult.structuredContent).toEqual({ ns: "HSCUSTOM", host: OTHER_HOST });

      // A call on `default` while it is STILL unreachable: the existing
      // structured isError envelope, never a throw out of the SDK handler.
      const stillDownResult = await callTool(server, "iris_doc_get", {});
      expect(stillDownResult.isError).toBe(true);
      expect(stillDownResult.content[0].text).toContain(
        'Could not connect to server profile "default"',
      );
      expect(exitMock).not.toHaveBeenCalled();
      // Retryable: still no lingering un-established client.
      expect(registry.has("default")).toBe(false);

      // The instance comes back — the NEXT call establishes it through the
      // same lazy path every non-default profile uses (health → negotiation
      // → one-time bootstrap), and the call succeeds.
      defaultReachable = true;
      const recoveredResult = await callTool(server, "iris_doc_get", {});
      expect(recoveredResult.isError).toBeFalsy();
      expect(recoveredResult.structuredContent).toEqual({ ns: "HSCUSTOM", host: "localhost" });
      expect(registry.has("default")).toBe(true);

      // Bootstrap ran exactly ONCE for the `default` profile across the whole
      // failed-eager → degraded → recovered cycle (never during the failed
      // attempts, exactly once on the successful establishment). `other`'s
      // own first-touch bootstrap (this server has `needsCustomRest: true`)
      // is a SEPARATE, expected call — filtered out by profile name so this
      // assertion is specific to the `default` recovery this AC is about.
      const defaultBootstrapCalls = bootstrapSpy.mock.calls.filter(
        (call) => (call[1] as { name?: string } | undefined)?.name === "default",
      );
      expect(defaultBootstrapCalls).toHaveLength(1);
      expect(bootstrapSpy).toHaveBeenCalledTimes(2); // one for "other", one for "default"

      // A second call after recovery reuses the established client — no
      // re-establishment, no second bootstrap for `default`.
      const secondCallsBefore = fetchMock.mock.calls.length;
      const again = await callTool(server, "iris_doc_get", {});
      expect(again.isError).toBeFalsy();
      expect(fetchMock.mock.calls.length).toBe(secondCallsBefore);
      expect(bootstrapSpy).toHaveBeenCalledTimes(2);
    });

    it("two concurrent first-touch calls on `default` after a failed eager attempt share ONE establishment + bootstrap once (AC 14.2.7 symmetry)", async () => {
      delete process.env.IRIS_PROFILES;
      let defaultReachable = false;
      const fetchMock = makeRoutedFetch(() => defaultReachable);
      globalThis.fetch = fetchMock;

      const server = new McpServerBase(makeServerOpts([], makeConfig(), true));
      await server.start("stdio");
      expect(bootstrapSpy).not.toHaveBeenCalled();

      defaultReachable = true;
      const callsBefore = fetchMock.mock.calls.length;
      const [a, b] = await Promise.all([
        server.getOrCreateClient("default", true),
        server.getOrCreateClient("default", true),
      ]);

      expect(bootstrapSpy).toHaveBeenCalledTimes(1);
      expect(a.client).toBe(b.client);
      expect(a.atelierVersion).toBe(8);
      // Exactly one HEAD + one GET were issued despite two concurrent
      // first-touch callers (coalesced through `establishing`).
      expect(fetchMock.mock.calls.length - callsBefore).toBe(2);
    });
  });

  describe("AC 37.1.6 — success path unchanged (Rule #19 mechanical proof)", () => {
    it("pins the exact startup fetch-call sequence when the default profile IS reachable", async () => {
      delete process.env.IRIS_PROFILES;
      const fetchMock = makeRoutedFetch(() => true);
      globalThis.fetch = fetchMock;

      const server = new McpServerBase(makeServerOpts([], makeConfig()));
      await server.start("stdio");

      const seq = fetchMock.mock.calls.map(
        (c) =>
          [String(c[0]), ((c[1] as RequestInit | undefined)?.method ?? "GET").toUpperCase()] as [
            string,
            string,
          ],
      );
      expect(seq).toEqual([
        ["http://localhost:52773/api/atelier/", "HEAD"],
        ["http://localhost:52773/api/atelier/", "GET"],
      ]);
      expect(exitMock).not.toHaveBeenCalled();
    });
  });
});
