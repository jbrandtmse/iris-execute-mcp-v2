/**
 * Story 27.0 (AC 27.0.3, "Integration AC") — cross-profile WIRING capstone
 * for `iris_env_diff`.
 *
 * The dev-authored suites prove each HALF of Story 27.0 in isolation:
 *  - `env-diff.test.ts` drives the REAL `envDiffTool.handler` against a
 *    HAND-MOCKED `ctx.resolveProfileClient` (a `vi.fn()` that maps a profile
 *    name straight to its own mock `IrisHttpClient`) — it never exercises the
 *    real framework establishment path.
 *  - `resolve-profile-client.test.ts` drives the REAL `server-base.ts`
 *    `resolveProfileClient` wiring (health-check + version-negotiation +
 *    in-flight coalescing) against a DUMMY capturing tool — it never
 *    exercises `envDiffTool`'s own bucketing logic.
 *
 * Neither proves the SEAM the story's own "Integration AC" claims is
 * covered: that a real `McpServerBase`, resolving TWO distinct profiles
 * through the real establishment path, handing the REAL `envDiffTool`
 * handler two independently-routed `IrisHttpClient`s, produces a correct
 * documents-diff end-to-end — through the actual SDK `handleToolCall`
 * dispatch, with a fetch-LEVEL mock (not a `ctx.http`-level mock) standing in
 * for TWO separate IRIS hosts at once. This suite closes that gap (mirrors
 * the Epic-14 capstone shape, `governance-cross-server.test.ts` — Rule #21).
 *
 * Also exercises a real concurrency property unique to `iris_env_diff`'s
 * calling pattern: it resolves `source` and `target` via
 * `Promise.all([ctx.resolveProfileClient(source), ctx.resolveProfileClient(target)])`.
 * When `source === target` and that profile has NEVER been touched before,
 * this fires two concurrent `getOrCreateClient` calls for the same fresh
 * profile — proving `server-base.ts`'s in-flight-promise coalescing (AC
 * 14.2.7) collapses that into a SINGLE health-check + version-negotiation,
 * not two, is a genuine regression guard specific to this tool's shape.
 *
 * Hermetic (mocked `fetch`, no live IRIS, no bootstrap — `needsCustomRest:
 * false` keeps establishment to health+version only; the bootstrap path
 * itself is already proven in `resolve-profile-client.test.ts`). Runs in the
 * DEFAULT suite (`*.test.ts`, not `*.integration.test.ts` — Rule #21).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { McpServerBase } from "@iris-mcp/shared";
import type { McpServerBaseOptions } from "@iris-mcp/shared";
import { envDiffTool } from "../tools/env-diff.js";

// ── Response builders ────────────────────────────────────────────────

/** Atelier version-negotiation response body (major 8 — matches sibling suites). */
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

interface HashEntry {
  name: string;
  hash: string;
  timestamp?: string;
}

/** `/dev/doc/hashes`-shaped envelope response for one profile's fixture set. */
function docHashesResponse(entries: HashEntry[]): Response {
  return new Response(
    JSON.stringify({
      status: { errors: [] },
      console: [],
      result: {
        documents: entries.map((e) => ({
          name: e.name,
          hash: e.hash,
          timestamp: e.timestamp ?? "2026-01-01 00:00:00.000",
        })),
        count: entries.length,
      },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * A generic, order-independent, method+path-aware fetch mock standing in for
 * IRIS across MULTIPLE profiles/hosts simultaneously:
 *  - `HEAD` (any path) -> 200 empty, WITH an `X-CSRF-Token` response header
 *    (real IRIS returns one on every response — `extractCsrfToken` reads it
 *    off ANY response, not just a dedicated CSRF endpoint). This matters
 *    here specifically: the establishment health check is itself a HEAD, so
 *    it primes `this.csrfToken` before any POST runs, which is what real
 *    IRIS does and what makes the CSRF preflight in `ensureCsrfToken`
 *    (`http-client.ts`) a no-op after the first response — mirrors this, so
 *    the establishment-coalescing assertions below measure ONLY establishment
 *    traffic, not an artifact of an incomplete CSRF simulation.
 *  - `GET` (any path) -> the Atelier version-negotiation envelope (the only
 *    GETs this scenario issues are version negotiation; `envDiffTool` itself
 *    only ever POSTs).
 *  - `POST` to a path ending `/dev/doc/hashes` -> the per-HOST fixture from
 *    `hostResponses` (keyed by hostname), recording the call for assertions.
 *  - Anything else -> throws, so an unexpected wire call fails the test
 *    loudly instead of silently returning a misleading default response.
 */
function makeMultiProfileFetch(hostResponses: Record<string, HashEntry[]>) {
  const calls: Array<{ method: string; host: string; path: string }> = [];
  const postCalls: Array<{ host: string; body: Record<string, unknown> }> = [];

  const fetchMock = vi.fn(
    async (
      input: string | URL | Request,
      init?: RequestInit,
    ): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      const u = new URL(url);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, host: u.hostname, path: u.pathname });

      if (method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "X-CSRF-Token": "test-csrf-token" },
        });
      }
      if (method === "GET") return versionResponse();
      if (method === "POST" && u.pathname.endsWith("/dev/doc/hashes")) {
        const body = JSON.parse(
          (init?.body as string | undefined) ?? "{}",
        ) as Record<string, unknown>;
        postCalls.push({ host: u.hostname, body });
        return docHashesResponse(hostResponses[u.hostname] ?? []);
      }
      throw new Error(`Unexpected fetch in test: ${method} ${url}`);
    },
  );

  return { fetchMock, calls, postCalls };
}

// ── Harness ─────────────────────────────────────────────────────────

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

  return { setup, teardown };
}

function makeServerOpts(): McpServerBaseOptions {
  return {
    name: "@iris-mcp/dev",
    version: "0.0.0",
    tools: [envDiffTool],
    needsCustomRest: false,
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

interface DocumentsDiffSC {
  domains: {
    documents: {
      onlyInSource: string[];
      onlyInTarget: string[];
      differs: Array<{
        name: string;
        sourceHash: string;
        targetHash: string;
        sourceTs: string;
        targetTs: string;
      }>;
      identical: number;
    };
  };
  summary: { driftCount: number; identicalCount: number };
}

// ════════════════════════════════════════════════════════════════════

describe("iris_env_diff — cross-profile wiring capstone (Story 27.0, AC 27.0.3)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("buckets a real documents diff across TWO distinct, correctly-routed profile clients end-to-end", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({
      second: { host: "second.example.com" },
    });

    const { fetchMock, postCalls } = makeMultiProfileFetch({
      "default.example.com": [
        { name: "OnlyInSource.cls", hash: "AAAA" },
        { name: "Differs.cls", hash: "SOURCEHASH" },
        { name: "Same.cls", hash: "SAMEHASH" },
      ],
      "second.example.com": [
        { name: "OnlyInTarget.cls", hash: "BBBB" },
        { name: "Differs.cls", hash: "TARGETHASH" },
        { name: "Same.cls", hash: "SAMEHASH" },
      ],
    });
    globalThis.fetch = fetchMock;

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio");

    const result = await callTool(server, "iris_env_diff", {
      source: "default",
      target: "second",
      spec: "MyPkg.*.cls",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as DocumentsDiffSC;
    expect(sc.domains.documents.onlyInSource).toEqual(["OnlyInSource.cls"]);
    expect(sc.domains.documents.onlyInTarget).toEqual(["OnlyInTarget.cls"]);
    expect(sc.domains.documents.differs).toEqual([
      {
        name: "Differs.cls",
        sourceHash: "SOURCEHASH",
        targetHash: "TARGETHASH",
        sourceTs: "2026-01-01 00:00:00.000",
        targetTs: "2026-01-01 00:00:00.000",
      },
    ]);
    expect(sc.domains.documents.identical).toBe(1);
    expect(sc.summary.driftCount).toBe(3);
    expect(sc.summary.identicalCount).toBe(1);
    expect(result.content[0]?.text).toContain("Summary: 3 drifted, 1 identical.");

    // The wiring proof: each side's data came from ITS OWN host's client — no
    // cross-profile bleed. The tool's own bucketing test (env-diff.test.ts)
    // hand-substitutes ctx.resolveProfileClient, so it structurally cannot
    // catch a real establishment routing to the wrong host; this can.
    expect(postCalls).toHaveLength(2);
    const hosts = postCalls.map((c) => c.host).sort();
    expect(hosts).toEqual(["default.example.com", "second.example.com"]);
    for (const call of postCalls) {
      expect(call.body.spec).toBe("MyPkg.*.cls");
    }
  });

  it("refuses an unknown target profile end-to-end via the REAL ProfileResolutionError, naming valid profiles, issuing NO /dev/doc/hashes calls", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({
      second: { host: "second.example.com" },
    });
    const { fetchMock, postCalls } = makeMultiProfileFetch({});
    globalThis.fetch = fetchMock;

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio");

    const result = await callTool(server, "iris_env_diff", {
      source: "default",
      target: "bogus",
      spec: "MyPkg.*.cls",
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain("bogus");
    // ProfileResolutionError names every known profile — proves this is the
    // REAL error (thrown by resolveProfile inside server-base.ts), not a
    // stand-in, since the tool's own catch never fabricates profile names.
    expect(result.content[0]?.text).toContain("default");
    expect(result.content[0]?.text).toContain("second");
    expect(postCalls).toHaveLength(0);
  });

  it("diffing a fresh, never-before-touched profile against ITSELF coalesces establishment into a single health-check + version-negotiation, and still buckets correctly", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({
      second: { host: "second.example.com" },
    });
    const { fetchMock, calls, postCalls } = makeMultiProfileFetch({
      "second.example.com": [{ name: "A.cls", hash: "H1" }],
    });
    globalThis.fetch = fetchMock;

    const server = new McpServerBase(makeServerOpts());
    await server.start("stdio"); // establishes "default" only — "second" is untouched

    const result = await callTool(server, "iris_env_diff", {
      source: "second",
      target: "second",
      spec: "MyPkg.*.cls",
    });

    expect(result.isError).toBeFalsy();
    const sc = result.structuredContent as DocumentsDiffSC;
    expect(sc.domains.documents.identical).toBe(1);
    expect(sc.summary.driftCount).toBe(0);

    // Establishment coalescing: envDiffTool concurrently calls
    // resolveProfileClient("second") TWICE via Promise.all (once for
    // `source`, once for `target`). getOrCreateClient's in-flight-promise
    // sharing (AC 14.2.7) must collapse that into exactly ONE health check +
    // ONE version negotiation for "second.example.com" — not two. A
    // regression here would silently double every self-diff call's
    // establishment cost (and, against live IRIS, its latency).
    const secondCalls = calls.filter((c) => c.host === "second.example.com");
    expect(secondCalls.filter((c) => c.method === "HEAD")).toHaveLength(1);
    expect(secondCalls.filter((c) => c.method === "GET")).toHaveLength(1);

    // The data fetch itself is NOT coalesced/cached — each side of the diff
    // independently POSTs /dev/doc/hashes (both against the identical cached
    // client), so exactly two POSTs, both to the same host.
    expect(postCalls).toHaveLength(2);
    expect(postCalls.every((c) => c.host === "second.example.com")).toBe(true);
  });
});
