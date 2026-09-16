/**
 * Story 37.1 QA coverage — gaps the dev-stage suite does not close.
 *
 * `packages/shared/src/__tests__/server-base-default-outage.test.ts` (5
 * tests) proves AC 37.1.4-37.1.7's four M1 commitments on the `"stdio"`
 * transport with a single profile shape. This file adds FIVE tests for
 * scenarios that survive a read of the fix (`server-base.ts` `start()`,
 * `getOrCreateClient`, `establishProfile`) but that no existing test —
 * neither the dev-stage file nor the pre-existing suite — actually drives:
 *
 *  1. `start("http")` under a FAILED default health check. The pre-existing
 *     `server-base.test.ts:584` ("should throw for HTTP transport") only
 *     drives the http branch with a HEALTHY default; the dev-stage outage
 *     file only drives `"stdio"`. No test combines the two, so a future
 *     regression that special-cased the non-fatal path to `"stdio"` only
 *     would ship silently.
 *  2. A failed default composed with an Epic 30 tool-visibility preset that
 *     hides a tool. Two independent constructor-time/start-time features
 *     that no existing test exercises together.
 *  3. `bootstrapAttempted` correctness on the RECOVERY path (not just the
 *     eager path the Dev Notes trap already calls out) for a
 *     `needsCustomRest: false` server — the dev-stage recovery test only
 *     covers `needsCustomRest: true`.
 *  4. Re-degradation AFTER a successful recovery: once `default` is
 *     established, `getOrCreateClient`'s fast path never re-checks health,
 *     so a later real network failure surfaces only through the generic
 *     per-call catch, never through the "Could not connect to server
 *     profile" envelope and never through `process.exit`. No existing test
 *     drives a full down → up → down cycle.
 *  5. The `establishing` coalescing map when the coalesced first-touch
 *     health check REJECTS for `default` specifically (after a failed eager
 *     attempt). `server-param-integration.test.ts:511` proves this shape
 *     for a NON-default profile ("other"); nothing proves it for `default`
 *     going through the path this story just changed.
 *
 * Rule #54 (fakes must be real shapes): every fetch fake below is the same
 * URL/method-routed `TypeError`-on-unreachable / 200-on-reachable shape the
 * dev-stage file already established as the real `fetch` behavior (its own
 * header comment cites the story's Dev Notes P3 closed-port capture).
 *
 * Rule #59 (gate proven RED on the path it guards) — verified empirically
 * 2026-09-16 by `git stash` on `server-base.ts`/`profiles.ts` (reinstating
 * the pre-story `process.exit(1)` health-check catch), `vitest run` this
 * file, then `git stash pop` to restore the fix:
 *
 *   - Gap 1 (http transport), Gap 2 (visibility preset), Gap 3
 *     (bootstrapAttempted recovery), and Gap 5 (coalesced reject) ALL go
 *     RED — each asserts `exitMock` was NOT called immediately after
 *     `server.start(...)` with the default unreachable, and the reverted
 *     code calls `process.exit(1)` (mocked to a no-op in this suite) right
 *     there, so every downstream assertion in those four tests diverges
 *     from the pre-fix behavior. 4 of 5 tests in this file are therefore
 *     genuine RED-proof coverage of the exact path
 *     `McpServerBase.start()`'s default-profile health-check catch — the
 *     same path the dev-stage file's own RED proof targets, exercised
 *     through different downstream mechanisms (http transport dispatch,
 *     tool-visibility composition, the recovery-path bootstrap flag, and
 *     the coalescing map) that the dev-stage file's own 5 tests do not
 *     drive.
 *   - Gap 4 (re-degradation after a successful recovery) does NOT go red:
 *     it deliberately starts with the default REACHABLE (so the eager
 *     attempt succeeds on both pre-fix and fixed code) and only then
 *     flips reachability for a later tool call — by design, proving a
 *     mechanism (`getOrCreateClient`'s post-establishment fast path never
 *     re-checks health) that this story's fix does not touch, per Rule
 *     #47/the story's own Dev Notes. It is a regression-guard pin on
 *     unchanged behavior, not a claim of RED-proof coverage for this
 *     story's fix.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";

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

// Import AFTER vi.mock so server-base picks up the mocked bootstrap (mirrors
// server-base-default-outage.test.ts).
const { McpServerBase } = await import("../server-base.js");
const { logger } = await import("../logger.js");
const { SERVER_DISCOVERY_TOOL_NAME } = await import("../server-discovery.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;
type ToolDefinition = import("../tool-types.js").ToolDefinition;
type IrisConnectionConfig = import("../config.js").IrisConnectionConfig;
type ToolPresetRosters = import("../tool-visibility.js").ToolPresetRosters;

// ── Helpers (mirror server-base-default-outage.test.ts's real-shape fakes) ──

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
 * URL/method-ROUTED fetch fake — never a shared response queue (the AC
 * 36.1.7 lesson). A rejection is a real `TypeError` (#54 — the shape Node's
 * `fetch` throws on ECONNREFUSED); a HEAD success is a bare 200; a non-HEAD
 * success is the real version-negotiation envelope, which also doubles as a
 * generic "the request succeeded" JSON body for the `ctx.http.get()` probe
 * tool used below (test 4) — a real Atelier envelope shape either way.
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
 * Health HEAD answers with a non-ok STATUS (IRIS replied and refused) while
 * any other request succeeds. The real shape behind `HEALTH_CHECK_FAILED`:
 * `headRequest` throws `IrisApiError` for a non-`ok` response, which
 * `checkHealth` re-wraps as an `IrisConnectionError`. Added by the Story 37.1
 * code review (fixture diversity over error CLASSES — Rule #58).
 */
function makeHeadStatusFetch(status: number): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    return method === "HEAD" ? new Response(null, { status }) : versionResponse();
  });
}

/**
 * Health HEAD rejects the way an aborted `fetch` really does — an `Error`
 * whose `name` is `"AbortError"`, which `http-client.ts` maps to the
 * `TIMEOUT` `IrisConnectionError`. Added by the Story 37.1 code review.
 */
function makeHeadAbortFetch(): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "HEAD") {
      const abort = new Error("This operation was aborted");
      abort.name = "AbortError";
      throw abort;
    }
    return versionResponse();
  });
}

/** Same echo tool as the dev-stage file: proves profile selection, never leaks `server` to the handler. */
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

/**
 * A tool whose handler performs REAL I/O via `ctx.http.get()` (not just
 * `ctx.config`/`ctx.resolveNamespace`) — needed for test 4, which must
 * distinguish "the cached client's own request fails" from "getOrCreateClient
 * re-establishes and fails" (only `ctx.http` traffic exercises the former).
 */
function makeHttpProbeTool(): ToolDefinition {
  return {
    name: "test-http-probe",
    title: "HTTP probe",
    description: "Issues a real GET through ctx.http to exercise post-establishment I/O failures.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    scope: "NONE",
    // Non-baseline synthetic fixture: must self-classify (Story 15.0 AC 15.0.3).
    mutates: "read",
    handler: async (_args, ctx) => {
      const envelope = await ctx.http.get("/api/atelier/");
      return {
        content: [{ type: "text" as const, text: "ok" }],
        structuredContent: { version: envelope.result },
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

describe("server-base — default-profile outage, QA coverage gaps (Story 37.1)", () => {
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv = {
    IRIS_PROFILES: process.env.IRIS_PROFILES,
    IRIS_TOOLS_PRESET: process.env.IRIS_TOOLS_PRESET,
  };

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

  describe('Gap 1 — start("http") after a failed default health check (existing tests only combine http+healthy or stdio+failed, never both)', () => {
    it("logs the health failure + continuation lines, never calls process.exit, then rejects with the existing not-implemented error", async () => {
      delete process.env.IRIS_PROFILES;
      const fetchMock = makeRoutedFetch(() => false);
      globalThis.fetch = fetchMock;
      const errorSpy = vi.spyOn(logger, "error");

      const server = new McpServerBase(makeServerOpts([], makeConfig()));

      await expect(server.start("http")).rejects.toThrow("HTTP transport not yet implemented");

      // The M1 non-fatal path ran (no exit) BEFORE the pre-existing
      // http-not-implemented throw — proving the fix is not accidentally
      // scoped to the stdio branch.
      expect(exitMock).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("IRIS health check failed"),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Continuing startup without the "default" profile'),
      );
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("HTTP transport is not yet fully implemented"),
      );
    });
  });

  describe("Gap 2 — a failed default composed with an Epic 30 tool-visibility preset (two independent features, never exercised together)", () => {
    it("a preset-hidden tool stays hidden, the connection-agnostic discovery tool still succeeds and reports the correct hidden count, and the still-visible tool degrades per M1 — all while `default` is unreachable", async () => {
      process.env.IRIS_TOOLS_PRESET = "core";
      delete process.env.IRIS_PROFILES;
      const fetchMock = makeRoutedFetch(() => false);
      globalThis.fetch = fetchMock;

      const visibleTool = makeEchoTool(); // "iris_doc_get"
      const hiddenToolName = "test-hidden-under-core";
      const hiddenTool: ToolDefinition = {
        name: hiddenToolName,
        title: "Hidden",
        description: "Hidden under the core preset; must never register or run.",
        inputSchema: z.object({}),
        annotations: { readOnlyHint: true },
        scope: "NONE",
        mutates: "read",
        handler: async () => ({
          content: [{ type: "text" as const, text: "should never run" }],
        }),
      };
      const toolPresets: ToolPresetRosters = {
        core: { include: ["iris_doc_get"], exclude: [hiddenToolName] },
        developer: { include: ["iris_doc_get", hiddenToolName], exclude: [] },
      };

      const server = new McpServerBase({
        name: "test-server",
        version: "1.0.0",
        tools: [visibleTool, hiddenTool],
        config: makeConfig(),
        toolPresets,
      });

      await expect(server.start("stdio")).resolves.toBeUndefined();
      expect(exitMock).not.toHaveBeenCalled();

      // The hidden tool never registered — a preset-time decision, unrelated
      // to (and unaffected by) the default-profile outage.
      expect(server.getToolNames()).not.toContain(hiddenToolName);
      expect(server.getToolNames()).toContain("iris_doc_get");

      // The discovery tool is connection-agnostic (P6): it still succeeds
      // and reports the correct visible/hidden counts even though `default`
      // never established.
      const discoveryResult = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
      expect(discoveryResult.isError).toBeFalsy();
      const parsed = JSON.parse(discoveryResult.content[0].text) as {
        toolVisibility: { preset: string; visibleTools: number; hiddenTools: number };
        profiles: Array<{ name: string; isDefault: boolean }>;
      };
      expect(parsed.toolVisibility).toEqual({ preset: "core", visibleTools: 2, hiddenTools: 1 });
      // The profile roster reports `default` regardless of reachability.
      expect(parsed.profiles.find((p) => p.name === "default")?.isDefault).toBe(true);

      // The still-visible tool degrades exactly per M1 while default is down.
      const echoResult = await callTool(server, "iris_doc_get", {});
      expect(echoResult.isError).toBe(true);
      expect(echoResult.content[0].text).toContain(
        'Could not connect to server profile "default"',
      );
    });
  });

  describe("Gap 3 — bootstrapAttempted on the RECOVERY path for a needsCustomRest:false server (dev-stage recovery test only covers needsCustomRest:true)", () => {
    it("bootstrap is never attempted across start, recovery, or subsequent calls, and profileMeta.bootstrapAttempted stays false", async () => {
      delete process.env.IRIS_PROFILES;
      let defaultReachable = false;
      const fetchMock = makeRoutedFetch(() => defaultReachable);
      globalThis.fetch = fetchMock;

      const server = new McpServerBase(makeServerOpts([makeEchoTool()], makeConfig(), false));
      await server.start("stdio");
      expect(exitMock).not.toHaveBeenCalled();
      expect(bootstrapSpy).not.toHaveBeenCalled();

      defaultReachable = true;
      const recovered = await callTool(server, "iris_doc_get", {});
      expect(recovered.isError).toBeFalsy();

      // Recovery went through establishProfile's first-touch path (health +
      // negotiation) but never attempted bootstrap: needsCustomRest is false,
      // so getOrCreateClient's needsBootstrap parameter is false throughout.
      expect(bootstrapSpy).not.toHaveBeenCalled();

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const profileMeta = (server as any).profileMeta as Map<
        string,
        { atelierVersion: number; bootstrapAttempted: boolean }
      >;
      const meta = profileMeta.get("default");
      expect(meta).toEqual({ atelierVersion: 8, bootstrapAttempted: false });

      // A further call still never attempts bootstrap (no hidden "first use
      // after recovery" bootstrap trigger).
      await callTool(server, "iris_doc_get", {});
      expect(bootstrapSpy).not.toHaveBeenCalled();
    });
  });

  describe("Gap 4 — re-degradation AFTER a successful recovery: no stray process.exit anywhere later in the cycle", () => {
    it("once `default` is established, a LATER real I/O failure during an actual tool call surfaces via the generic per-call catch (never the getOrCreateClient envelope, never process.exit, never a re-establishment attempt)", async () => {
      delete process.env.IRIS_PROFILES;
      let defaultReachable = true; // healthy at startup: the eager attempt succeeds this time.
      const fetchMock = makeRoutedFetch(() => defaultReachable);
      globalThis.fetch = fetchMock;

      const server = new McpServerBase(makeServerOpts([makeHttpProbeTool()], makeConfig()));
      await server.start("stdio");
      expect(exitMock).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registry = (server as any).clients;
      expect(registry.has("default")).toBe(true); // eager establishment succeeded

      // A normal call succeeds via the cached client.
      const ok = await callTool(server, "test-http-probe", {});
      expect(ok.isError).toBeFalsy();

      // The instance goes down AFTER a successful establishment. Because
      // profileMeta already has an entry for "default", getOrCreateClient's
      // FAST PATH returns the cached client WITHOUT re-checking health — the
      // failure can only surface from the handler's own I/O.
      defaultReachable = false;
      const errorSpy = vi.spyOn(logger, "error");
      const failed = await callTool(server, "test-http-probe", {});

      expect(failed.isError).toBe(true);
      // The GENERIC per-call catch (`content: "Tool error: ..."`, logged as
      // `Tool ${name} failed: ...`), never the getOrCreateClient "Could not
      // connect to server profile" envelope — proof that no re-establishment
      // (and no health re-check) was attempted for this already-established
      // profile.
      expect(failed.content[0].text).toContain("Tool error:");
      expect(failed.content[0].text).not.toContain("Could not connect to server profile");
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Tool test-http-probe failed"),
      );
      expect(exitMock).not.toHaveBeenCalled();
      // Post-establishment I/O failures do not perturb establishment
      // bookkeeping: the client is neither dropped nor re-queued.
      expect(registry.has("default")).toBe(true);

      // The instance comes back — normal per-request recovery, no special
      // M1 path involved (profileMeta never changed).
      defaultReachable = true;
      const again = await callTool(server, "test-http-probe", {});
      expect(again.isError).toBeFalsy();
    });
  });

  describe("Gap 5 — the `establishing` coalescing map for `default` when the coalesced first touch REJECTS (server-param-integration.test.ts:511 proves this shape only for a non-default profile)", () => {
    it("two concurrent calls on `default` while unreachable both receive the SAME isError envelope from ONE coalesced health check, and the map is cleaned up so a later call retries with a fresh check", async () => {
      delete process.env.IRIS_PROFILES;
      let defaultReachable = false;
      const fetchMock = makeRoutedFetch(() => defaultReachable);
      globalThis.fetch = fetchMock;

      const server = new McpServerBase(makeServerOpts([makeEchoTool()], makeConfig()));
      await server.start("stdio");
      expect(exitMock).not.toHaveBeenCalled();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registry = (server as any).clients;
      expect(registry.has("default")).toBe(false); // eager attempt failed, dropped

      const callsBefore = fetchMock.mock.calls.length;
      const [r1, r2] = await Promise.all([
        callTool(server, "iris_doc_get", {}),
        callTool(server, "iris_doc_get", {}),
      ]);

      expect(r1.isError).toBe(true);
      expect(r2.isError).toBe(true);
      expect(r1.content[0].text).toContain('Could not connect to server profile "default"');
      // Both concurrent callers observed the IDENTICAL envelope text — they
      // shared the ONE coalesced establishment/rejection, not two independent
      // ones with (possibly) different wording.
      expect(r2.content[0].text).toBe(r1.content[0].text);

      // Coalesced: exactly ONE HEAD was issued for the two concurrent
      // first-touch callers (not two).
      const headCallsDuringBurst = fetchMock.mock.calls
        .slice(callsBefore)
        .filter((c) => ((c[1] as RequestInit | undefined)?.method ?? "GET").toUpperCase() === "HEAD");
      expect(headCallsDuringBurst).toHaveLength(1);

      // The in-flight cache entry was cleared on rejection (getOrCreateClient's
      // finally runs on settle regardless of outcome) — mirrors the existing
      // non-default proof at server-param-integration.test.ts:539-540, now for
      // `default` specifically, after the M1 code path (a failed eager
      // start() attempt) put it in this state.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const establishing = (server as any).establishing as Map<string, unknown>;
      expect(establishing.has("default")).toBe(false);
      expect(registry.has("default")).toBe(false);

      // A later call retries with a FRESH health check (not a cached/stale
      // rejected promise) — exactly one new HEAD.
      const callsBeforeRetry = fetchMock.mock.calls.length;
      const r3 = await callTool(server, "iris_doc_get", {});
      expect(r3.isError).toBe(true);
      expect(fetchMock.mock.calls.length - callsBeforeRetry).toBe(1);

      // And once reachable, that same retry mechanism recovers normally.
      defaultReachable = true;
      const r4 = await callTool(server, "iris_doc_get", {});
      expect(r4.isError).toBeFalsy();
      expect(registry.has("default")).toBe(true);
    });
  });

  // ── Added by the Story 37.1 code review ──────────────────────────────
  //
  // Gap 6 (Rule #58 — fixture diversity applied to ERROR CLASSES). Every
  // fixture in the dev-stage file, this file's gaps 1-5, the flipped
  // `server-base.test.ts:558` pin AND the live gate (`127.0.0.1:9`) produces
  // exactly ONE failure shape through the changed catch: a `TypeError`, which
  // `http-client.ts:284` turns into an `IrisConnectionError` with code
  // `NETWORK_ERROR`. `checkHealth` can also reject with:
  //   - `TIMEOUT`  — an `AbortError` from the 5 s health-check deadline
  //     (`http-client.ts:277`), and
  //   - `HEALTH_CHECK_FAILED` — wrapping an `IrisApiError` when IRIS ANSWERED
  //     and refused: HTTP 401/403 (wrong `IRIS_PASSWORD`) or 404 (the
  //     `/api/atelier` web application disabled). `http-client.ts:451` throws
  //     it for any non-`ok` HEAD response.
  // The single-valued fixture set meant an implementation that mishandled
  // every non-`TypeError` health failure would stay green across all 12
  // new/flipped tests plus both live-gate legs. These two tests close that by
  // driving the real 401 and AbortError shapes through `start()`.
  describe("Gap 6 — non-TypeError health-check rejections (401 and timeout) take the same non-fatal path", () => {
    it("an HTTP 401 on the health HEAD (wrong password — IRIS answered and refused) degrades instead of exiting, and the continuation line names host:port", async () => {
      delete process.env.IRIS_PROFILES;
      // Real shape: a non-ok HEAD response. `headRequest` throws IrisApiError,
      // which checkHealth re-wraps as IrisConnectionError/HEALTH_CHECK_FAILED.
      const fetchMock = makeHeadStatusFetch(401);
      globalThis.fetch = fetchMock;
      const errorSpy = vi.spyOn(logger, "error");

      const server = new McpServerBase(makeServerOpts([makeEchoTool()], makeConfig()));
      await expect(server.start("stdio")).resolves.toBeUndefined();

      expect(exitMock).not.toHaveBeenCalled();
      // The wrapped 401 message does NOT carry host:port, so the continuation
      // line must — otherwise the only startup diagnostic names no instance.
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("HTTP 401"));
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          'Continuing startup without the "default" profile (localhost:52773)',
        ),
      );
      // A non-transient cause must not be described as self-healing only.
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("will NOT clear on its own"),
      );

      // Same degraded contract as the ECONNREFUSED path: dropped, no meta,
      // per-call isError envelope, no exit.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registry = (server as any).clients;
      expect(registry.has("default")).toBe(false);
      const result = await callTool(server, "iris_doc_get", {});
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain(
        'Could not connect to server profile "default"',
      );
      expect(exitMock).not.toHaveBeenCalled();
    });

    it("an AbortError (the 5s health-check deadline) also degrades instead of exiting", async () => {
      delete process.env.IRIS_PROFILES;
      // Real shape: `executeFetch`'s AbortController fires and `fetch` rejects
      // with a DOMException/Error named "AbortError" (http-client.ts:273-281).
      const fetchMock = makeHeadAbortFetch();
      globalThis.fetch = fetchMock;
      const errorSpy = vi.spyOn(logger, "error");

      const server = new McpServerBase(makeServerOpts([], makeConfig()));
      await expect(server.start("stdio")).resolves.toBeUndefined();

      expect(exitMock).not.toHaveBeenCalled();
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("timed out"));
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Continuing startup without the "default" profile'),
      );
    });
  });

  // Gap 7 (code review) — the degraded-path startup line itself. Nothing in
  // the dev-stage file, this file's gaps 1-5, or either live-gate leg asserts
  // it, so a refactor deleting it, or restoring the misleading
  // "...starting with Atelier API v1" the fix deliberately removed (story P5),
  // would keep every other test green.
  describe("Gap 7 — the degraded-path startup INFO line", () => {
    it('states the profile is not yet established and never prints a stale "Atelier API v1"', async () => {
      delete process.env.IRIS_PROFILES;
      const fetchMock = makeRoutedFetch(() => false);
      globalThis.fetch = fetchMock;
      const infoSpy = vi.spyOn(logger, "info");

      const server = new McpServerBase(makeServerOpts([], makeConfig()));
      await server.start("stdio");

      expect(infoSpy).toHaveBeenCalledWith(
        expect.stringContaining('"default" profile not yet established'),
      );
      expect(infoSpy).not.toHaveBeenCalledWith(
        expect.stringContaining("starting with Atelier API v"),
      );
      // ...and the transport still connected (the whole point of M1).
      expect(infoSpy).toHaveBeenCalledWith("Connected via stdio transport");
    });
  });
});
