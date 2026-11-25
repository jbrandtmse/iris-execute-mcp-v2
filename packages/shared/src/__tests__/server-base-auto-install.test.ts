/**
 * Story 45.2: the framework's side of the automatic install (AD-1, AD-8, AD-9, AD-14).
 *
 * Through the real `McpServerBase` with ONLY `bootstrap` mocked (so the profile resolution, the arming of
 * the client from the bootstrap result and the per-call refusal substitution are the real code): the
 * resolved setting reaches bootstrap per profile, a startup conflict or malformed value fails before any
 * request, a refused profile answers a custom-REST call with `IRIS_SIDE_NOT_INSTALLED` even when the
 * handler swallowed the error, Atelier-only calls keep working, the refusal is per profile, and `unknown`
 * with the install off is not refused.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import type { IrisConnectionConfig } from "../config.js";
import { makeEnvHarness } from "./env-harness.js";
import { auditLines } from "./test-helpers.js";

/**
 * The result the real bootstrap returns for a refused profile (Rule #54): only with the install off, and naming the channel the
 * resolution handed it in `config.autoInstallSource`.
 */
const refusedFor = (probeStatus: "missing" | "stale", config: IrisConnectionConfig): BootstrapResult => {
  if (config.autoInstall !== false || config.autoInstallSource === undefined) {
    throw new Error("the real bootstrap refuses only a profile whose install the resolution turned off");
  }
  return refusedShape(probeStatus, config.autoInstallSource);
};

/**
 * What the real bootstrap returns for an install-off profile whose probe read `unconfigured` (DW-772): the tools go on
 * (no `customRestRefused`), and the framework arms the refusal for an absent web application only.
 */
const unconfirmedFor = (config: IrisConnectionConfig): BootstrapResult => {
  if (config.autoInstall !== false || config.autoInstallSource === undefined) {
    throw new Error("the real bootstrap marks the web application unconfirmed only with the install off");
  }
  return {
    probeFound: true,
    probeStatus: "unconfigured",
    autoInstallOff: config.autoInstallSource,
    webAppUnconfirmed: true,
    deployed: false,
    compiled: false,
    configured: false,
    mapped: false,
    unitTestRootEnsured: false,
    errors: [],
  };
};

const refusedShape = (
  probeStatus: "missing" | "stale",
  source: NonNullable<BootstrapResult["autoInstallOff"]>,
): BootstrapResult => ({
  probeFound: probeStatus !== "missing",
  probeStatus,
  ...(probeStatus === "stale" ? { deployedVersion: "abcdef123456" } : {}),
  autoInstallOff: source,
  customRestRefused: true,
  deployed: false,
  compiled: false,
  configured: false,
  mapped: false,
  unitTestRootEnsured: false,
  errors: [],
});

const currentResult: BootstrapResult = {
  probeFound: true,
  probeStatus: "current",
  deployed: true,
  compiled: true,
  configured: true,
  mapped: true,
  unitTestRootEnsured: true,
  errors: [],
};

/** What the mocked bootstrap answers, by profile: set per test. */
let answer: (config: IrisConnectionConfig & { name?: string }) => BootstrapResult;
const bootstrapSpy = vi.fn(async (_http: unknown, config: IrisConnectionConfig) => answer(config));
vi.mock("../bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bootstrap.js")>();
  return { ...actual, bootstrap: bootstrapSpy };
});

const { McpServerBase } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;
type ToolDefinition = import("../tool-types.js").ToolDefinition;

const SECRET = "pw-NEVER-in-a-refusal-7Q";

function versionResponse(): Response {
  return new Response(JSON.stringify({ status: { errors: [] }, console: [], result: { version: "8.0.0" } }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function okResponse(): Response {
  return new Response(JSON.stringify({ status: { errors: [] }, console: [], result: {} }), {
    status: 200,
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "t" },
  });
}

/** The default profile's startup HEAD (health) + GET (version). */
function stageStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(versionResponse());
}

const opts = (tools: ToolDefinition[]): McpServerBaseOptions => ({
  name: "test-server",
  version: "1.0.0",
  tools,
  needsCustomRest: true,
});

/** A tool whose handler runs `body` with its context. */
function tool(name: string, body: NonNullable<ToolDefinition["handler"]>): ToolDefinition {
  return {
    name,
    title: name,
    description: "test tool",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: "read",
    handler: body,
  };
}

const text = (value: string) => ({ content: [{ type: "text" as const, text: value }] });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callTool(server: any, name: string, args: unknown = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const entry = (server.server as any)._registeredTools[name];
  return (entry.callback ?? entry.handler ?? entry.cb)(args);
}

/** The fetched paths since `from`. */
function paths(fetchMock: ReturnType<typeof vi.fn>, from = 0): string[] {
  return fetchMock.mock.calls.slice(from).map((c: unknown[]) => `${(c[1] as { method?: string }).method} ${String(c[0])}`);
}

const env = makeEnvHarness({ onSetup: () => bootstrapSpy.mockClear(), connection: "unset" });
beforeEach(() => {
  env.setup();
  process.env.IRIS_USERNAME = "u";
  process.env.IRIS_PASSWORD = SECRET;
  process.env.IRIS_HOST = "default.example.com";
  process.env.IRIS_NAMESPACE = "DEFAULTNS";
  answer = () => currentResult;
});
afterEach(env.teardown);

/** What bootstrap was given for the first call. */
function configArg(call = 0): IrisConnectionConfig & { name?: string } {
  return bootstrapSpy.mock.calls[call]![1] as IrisConnectionConfig & { name?: string };
}

describe("the resolved setting reaches bootstrap", () => {
  it("nothing set: the startup bootstrap gets this.config unchanged (no autoInstall field)", async () => {
    stageStartup(env.fetchMock);
    await new McpServerBase(opts([])).start("stdio");
    expect(configArg()).not.toHaveProperty("autoInstall");
    expect(configArg()).not.toHaveProperty("autoInstallSource");
  });

  it("IRIS_AUTO_INSTALL=true (no preset): identical to unset", async () => {
    process.env.IRIS_AUTO_INSTALL = "TRUE";
    stageStartup(env.fetchMock);
    await new McpServerBase(opts([])).start("stdio");
    expect(configArg()).not.toHaveProperty("autoInstall");
  });

  it.each([
    ["IRIS_GOVERNANCE_PRESET", { IRIS_GOVERNANCE_PRESET: "read-only" }],
    ["IRIS_AUTO_INSTALL", { IRIS_AUTO_INSTALL: "false" }],
    ["IRIS_AUTO_INSTALL", { IRIS_AUTO_INSTALL: "False", IRIS_GOVERNANCE_PRESET: "read-only" }],
    ["IRIS_PROFILES", { IRIS_PROFILES: JSON.stringify({ default: { autoInstall: false } }), IRIS_AUTO_INSTALL: "true" }],
  ] as const)("the startup bootstrap of default is told it is off by %s", async (source, vars) => {
    Object.assign(process.env, vars);
    stageStartup(env.fetchMock);
    await new McpServerBase(opts([])).start("stdio");
    expect(configArg()).toMatchObject({ autoInstall: false, autoInstallSource: source, host: "default.example.com", namespace: "DEFAULTNS" });
  });

  it("a lazy profile gets its own resolved value: p1 off (IRIS_PROFILES), p2 on", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({ p1: { host: "p1.example.com", autoInstall: false }, p2: { host: "p2.example.com" } });
    stageStartup(env.fetchMock);
    const server = new McpServerBase(opts([tool("iris_t", async () => text("ok"))]));
    await server.start("stdio");
    for (const profile of ["p1", "p2"]) {
      env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      env.fetchMock.mockResolvedValueOnce(versionResponse());
      await server.getOrCreateClient(profile, true);
    }
    const byName = new Map(bootstrapSpy.mock.calls.map((c) => [(c[1] as { name?: string }).name, c[1] as IrisConnectionConfig]));
    expect(byName.get("p1")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_PROFILES" });
    expect(byName.get("p2")).toMatchObject({ autoInstall: true, autoInstallSource: "default" });
  });
});

describe("startup fails fast, before any request to IRIS", () => {
  it.each([
    [{ IRIS_AUTO_INSTALL: "true", IRIS_GOVERNANCE_PRESET: "read-only" }, /IRIS_AUTO_INSTALL=true conflicts with IRIS_GOVERNANCE_PRESET=read-only/],
    [
      { IRIS_PROFILES: JSON.stringify({ p2: { autoInstall: true } }), IRIS_GOVERNANCE_PRESET: "read-only" },
      /IRIS_PROFILES profile "p2": "autoInstall": true conflicts with IRIS_GOVERNANCE_PRESET=read-only/,
    ],
    [{ IRIS_AUTO_INSTALL: "yes" }, /IRIS_AUTO_INSTALL must be "true" or "false". Received: "yes"/],
    [{ IRIS_PROFILES: JSON.stringify({ p2: { autoInstall: "true" } }) }, /profile "p2": "autoInstall" must be a boolean \(true\/false\)/],
  ] as const)("%j", async (vars, message) => {
    Object.assign(process.env, vars);
    await expect(new McpServerBase(opts([])).start("stdio")).rejects.toThrow(message);
    expect(env.fetchMock, "nothing was sent to IRIS").not.toHaveBeenCalled();
    expect(bootstrapSpy).not.toHaveBeenCalled();
  });

  it("an empty IRIS_AUTO_INSTALL is unset", async () => {
    process.env.IRIS_AUTO_INSTALL = "";
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    stageStartup(env.fetchMock);
    await new McpServerBase(opts([])).start("stdio");
    expect(configArg()).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_GOVERNANCE_PRESET" });
  });
});

describe("a refused profile (the install is off and the IRIS side is not installed)", () => {
  async function started(extra: ToolDefinition[]) {
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    answer = (config) => refusedFor("missing", config);
    stageStartup(env.fetchMock);
    const server = new McpServerBase(opts(extra));
    await server.start("stdio");
    return server;
  }

  it("answers a custom-REST call with IRIS_SIDE_NOT_INSTALLED and sends nothing to IRIS for it", async () => {
    const server = await started([tool("iris_custom", async (_a, ctx) => text(JSON.stringify(await ctx.http.get("/api/executemcp/v2/global"))))]);
    const before = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_custom");

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "IRIS_SIDE_NOT_INSTALLED",
      profile: "default",
      namespace: "DEFAULTNS",
      found: "missing",
      requiredVersion: expect.stringMatching(/^\d+\.\d+\.\d+\+\d+\.[0-9a-f]+$/),
      autoInstallSource: "IRIS_GOVERNANCE_PRESET",
    });
    expect(Object.keys(result.structuredContent)[0]).toBe("code");
    expect(result.content[0].text).toContain('The ExecuteMCPv2 service on IRIS is not available to server profile "default"');
    expect(paths(env.fetchMock, before), "zero requests for the call").toEqual([]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("replaces whatever a handler that swallowed the error returned", async () => {
    const server = await started([
      tool("iris_swallow", async (_a, ctx) => {
        try {
          await ctx.http.post("/api/executemcp/v2/command", { c: 1 });
        } catch {
          // a handler that carries on
        }
        return text("everything is fine");
      }),
    ]);
    const result = await callTool(server, "iris_swallow");
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("IRIS_SIDE_NOT_INSTALLED");
    expect(JSON.stringify(result)).not.toContain("everything is fine");
  });

  it("refuses every later request of the call: a mixed tool's Atelier calls are never sent", async () => {
    const server = await started([
      tool("iris_mixed", async (_a, ctx) => {
        try {
          await ctx.http.get("/api/executemcp/v2/unittest/guard");
        } catch {
          // swallowed, as a guard read that treats failure as "no guard"
        }
        await ctx.http.post("/api/atelier/v8/DEFAULTNS/action/query", { query: "SELECT ExecuteMCPv2.Setup_EnsureUnitTestRoot()" });
        await ctx.http.post("/api/atelier/v8/DEFAULTNS/work", {});
        return text("ran");
      }),
    ]);
    const before = env.fetchMock.mock.calls.length;
    const result = await callTool(server, "iris_mixed");
    expect(result.structuredContent.code).toBe("IRIS_SIDE_NOT_INSTALLED");
    expect(paths(env.fetchMock, before)).toEqual([]);
  });

  it("a handler that throws something else after the refusal still gets the refusal", async () => {
    const server = await started([
      tool("iris_throws", async (_a, ctx) => {
        await ctx.http.get("/api/executemcp/v2/x").catch(() => undefined);
        throw new Error("a later failure");
      }),
    ]);
    const result = await callTool(server, "iris_throws");
    expect(result.structuredContent.code).toBe("IRIS_SIDE_NOT_INSTALLED");
  });

  it("an Atelier-only tool works as today", async () => {
    const server = await started([
      tool("iris_atelier_only", async (_a, ctx) => {
        await ctx.http.get("/api/atelier/v8/DEFAULTNS/doc/X.cls");
        return text("atelier ok");
      }),
    ]);
    env.fetchMock.mockResolvedValueOnce(okResponse());
    const result = await callTool(server, "iris_atelier_only");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("atelier ok");
  });

  it("is per call: after a refused call, the next call starts clean", async () => {
    const server = await started([
      tool("iris_custom", async (_a, ctx) => text(JSON.stringify(await ctx.http.get("/api/executemcp/v2/x")))),
      tool("iris_atelier_only", async (_a, ctx) => {
        await ctx.http.get("/api/atelier/v8/DEFAULTNS/doc/X.cls");
        return text("atelier ok");
      }),
    ]);
    expect((await callTool(server, "iris_custom")).isError).toBe(true);
    env.fetchMock.mockResolvedValueOnce(okResponse());
    expect((await callTool(server, "iris_atelier_only")).isError).toBeFalsy();
  });

  it("the refusal is per profile: only p2 is refused, and the caller's own profile (default) is not", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({ p2: { host: "p2.example.com", autoInstall: false } });
    answer = (config) => (config.name === "p2" ? refusedFor("stale", config) : currentResult);
    stageStartup(env.fetchMock);
    const server = new McpServerBase(
      opts([
        tool("iris_cross", async (_a, ctx) => {
          // the caller's own profile first: not refused
          await ctx.http.get("/api/executemcp/v2/health");
          const other = await ctx.resolveProfileClient("p2");
          await other.get("/api/executemcp/v2/health");
          return text("unreachable");
        }),
        tool("iris_own", async (_a, ctx) => {
          await ctx.http.get("/api/executemcp/v2/health");
          return text("own ok");
        }),
      ]),
    );
    await server.start("stdio");
    // Everything after startup (p2's first touch included) is answered by route, not by order.
    env.fetchMock.mockImplementation(async (url: string, init: { method?: string }) => {
      if (init.method === "HEAD") return new Response(null, { status: 200 });
      if (String(url).endsWith("/api/atelier/")) return versionResponse();
      return okResponse();
    });

    const cross = await callTool(server, "iris_cross");
    expect(cross.structuredContent).toMatchObject({ code: "IRIS_SIDE_NOT_INSTALLED", profile: "p2", found: "stale", deployedVersion: "abcdef123456" });

    const own = await callTool(server, "iris_own");
    expect(own.isError).toBeFalsy();
    expect(own.content[0].text).toBe("own ok");
  });

  it("a lazy profile (not default) is armed through the same path: server selects p2", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({ p2: { host: "p2.example.com", autoInstall: false } });
    answer = (config) => (config.name === "p2" ? refusedFor("stale", config) : currentResult);
    stageStartup(env.fetchMock);
    const server = new McpServerBase(opts([tool("iris_custom", async (_a, ctx) => text(JSON.stringify(await ctx.http.get("/api/executemcp/v2/x"))))]));
    await server.start("stdio");
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    const result = await callTool(server, "iris_custom", { server: "p2" });
    expect(result.structuredContent).toMatchObject({ code: "IRIS_SIDE_NOT_INSTALLED", profile: "p2", found: "stale" });
    expect(configArg(1)).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_PROFILES" });
  });
});

describe("an install-off profile whose web application could not be confirmed (DW-772: a least-privilege account reads unconfigured)", () => {
  // The two 404 shapes are captured from a throwaway IRIS for Health 2026.2 (see http-client-side-refusal.test.ts).
  const GATEWAY_404 = "<HTML><HEAD>\n<TITLE>Not Found</TITLE>\n</HEAD><BODY>\n<H1>Not Found</H1>\nThe requested URL was not found on this server.\n</BODY></HTML>\n";
  const DISPATCH_404 = '{"status":{"errors":[],"summary":""},"console":[],"result":{}}';

  /** Startup with the read-only preset; `customRest` answers every custom-REST request. */
  async function started(customRest: () => Response, extra: ToolDefinition[]) {
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    answer = (config) => unconfirmedFor(config);
    stageStartup(env.fetchMock);
    const server = new McpServerBase(opts(extra));
    await server.start("stdio");
    env.fetchMock.mockImplementation(async (url: string, init: { method?: string }) => {
      if (String(url).includes("/api/executemcp/")) return customRest();
      if (init.method === "HEAD") return new Response(null, { status: 200 });
      return okResponse();
    });
    return server;
  }

  const custom = tool("iris_custom", async (_a, ctx) => text(JSON.stringify(await ctx.http.get("/api/executemcp/v2/config/namespace"))));

  it("the profile's custom-REST tool RUNS under the read-only preset: the request is sent and its answer returned", async () => {
    const server = await started(okResponse, [custom]);
    const before = env.fetchMock.mock.calls.length;
    const result = await callTool(server, "iris_custom");
    expect(result.isError).toBeFalsy();
    expect(paths(env.fetchMock, before).some((p) => p.includes("/api/executemcp/v2/config/namespace"))).toBe(true);
  });

  it("the web application's HTML 404 (really absent) answers IRIS_SIDE_NOT_INSTALLED with found=unconfigured", async () => {
    const server = await started(() => new Response(GATEWAY_404, { status: 404 }), [custom]);
    const result = await callTool(server, "iris_custom");
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "IRIS_SIDE_NOT_INSTALLED",
      profile: "default",
      found: "unconfigured",
      autoInstallSource: "IRIS_GOVERNANCE_PRESET",
    });
    expect(result.content[0].text).toContain('Do ##class(ExecuteMCPv2.Setup).Configure("DEFAULTNS")');
    expect(result.content[0].text).toContain("without the read-only preset");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("a dispatch 404 (the web application is installed, the route unknown) is NOT mapped: the handler's own error stands", async () => {
    const server = await started(() => new Response(DISPATCH_404, { status: 404 }), [
      tool("iris_custom", async (_a, ctx) => {
        try {
          await ctx.http.get("/api/executemcp/v2/no/such/route");
        } catch (error: unknown) {
          return text(`handler saw: ${(error as Error).name}`);
        }
        return text("no error");
      }),
    ]);
    const result = await callTool(server, "iris_custom");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("handler saw: IrisApiError");
  });

  it("an Atelier-only tool works as today", async () => {
    const server = await started(() => new Response(GATEWAY_404, { status: 404 }), [
      tool("iris_atelier", async (_a, ctx) => {
        await ctx.http.get("/api/atelier/v8/DEFAULTNS/doc/X.cls");
        return text("atelier ok");
      }),
    ]);
    const result = await callTool(server, "iris_atelier");
    expect(result.isError).toBeFalsy();
    expect(result.content[0].text).toBe("atelier ok");
  });

  it("a lazy profile (not default) is armed through the same path", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({ p2: { host: "p2.example.com", autoInstall: false } });
    answer = (config) => (config.name === "p2" ? unconfirmedFor(config) : currentResult);
    stageStartup(env.fetchMock);
    const server = new McpServerBase(opts([custom]));
    await server.start("stdio");
    env.fetchMock.mockImplementation(async (url: string, init: { method?: string }) => {
      if (String(url).includes("/api/executemcp/")) return new Response(GATEWAY_404, { status: 404 });
      if (init.method === "HEAD") return new Response(null, { status: 200 });
      if (String(url).endsWith("/api/atelier/")) return versionResponse();
      return okResponse();
    });
    const result = await callTool(server, "iris_custom", { server: "p2" });
    expect(result.structuredContent).toMatchObject({ code: "IRIS_SIDE_NOT_INSTALLED", profile: "p2", found: "unconfigured" });
  });
});

describe("the default profile whose start-time health check failed (the lazy path, not the inline startup bootstrap)", () => {
  /** A fetch that refuses the connection until `reachable.up` is set, then answers by route (never by order). */
  function unreachableUntil(reachable: { up: boolean }): void {
    env.fetchMock.mockImplementation(async (url: string, init: { method?: string }) => {
      if (!reachable.up) throw new TypeError("fetch failed");
      if (init.method === "HEAD") return new Response(null, { status: 200 });
      if (String(url).endsWith("/api/atelier/")) return versionResponse();
      return okResponse();
    });
  }

  it("is told its resolved setting and armed by the lazy establishment, then refuses a custom-REST call with nothing sent for it", async () => {
    process.env.IRIS_AUTO_INSTALL = "false";
    answer = (config) => refusedFor("missing", config);
    const reachable = { up: false };
    unreachableUntil(reachable);
    const server = new McpServerBase(opts([tool("iris_custom", async (_a, ctx) => text(JSON.stringify(await ctx.http.get("/api/executemcp/v2/x"))))]));
    await server.start("stdio");
    expect(bootstrapSpy, "the inline startup bootstrap did not run: the default profile was not established").not.toHaveBeenCalled();

    reachable.up = true;
    const before = env.fetchMock.mock.calls.length;
    const result = await callTool(server, "iris_custom");

    expect(bootstrapSpy).toHaveBeenCalledTimes(1);
    expect(configArg()).toMatchObject({ name: "default", autoInstall: false, autoInstallSource: "IRIS_AUTO_INSTALL" });
    expect(result.isError).toBe(true);
    // The channel the resolution handed bootstrap is the one the refusal names.
    expect(result.structuredContent).toMatchObject({ code: "IRIS_SIDE_NOT_INSTALLED", profile: "default", found: "missing", autoInstallSource: "IRIS_AUTO_INSTALL" });
    expect(paths(env.fetchMock, before).filter((p) => p.includes("/api/executemcp/")), "no request to the custom REST service").toEqual([]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("an Atelier-only call on that armed default profile still works", async () => {
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    answer = (config) => refusedFor("stale", config);
    const reachable = { up: false };
    unreachableUntil(reachable);
    const server = new McpServerBase(
      opts([
        tool("iris_custom", async (_a, ctx) => text(JSON.stringify(await ctx.http.get("/api/executemcp/v2/x")))),
        tool("iris_atelier_only", async (_a, ctx) => {
          await ctx.http.get("/api/atelier/v8/DEFAULTNS/doc/X.cls");
          return text("atelier ok");
        }),
      ]),
    );
    await server.start("stdio");
    reachable.up = true;
    expect((await callTool(server, "iris_custom")).structuredContent).toMatchObject({ code: "IRIS_SIDE_NOT_INSTALLED", found: "stale" });
    const atelier = await callTool(server, "iris_atelier_only");
    expect(atelier.isError).toBeFalsy();
    expect(atelier.content[0].text).toBe("atelier ok");
  });
});

describe("a profile that is not refused", () => {
  // The shapes the real bootstrap returns with the install off: `current` as bootstrap-auto-install.test.ts produces it, and `unknown`
  // with nothing deployed, flagged or compiled and the read failure named (Rule #54).
  const REAL_SHAPES: Record<"current" | "unknown", BootstrapResult> = {
    current: { ...currentResult, autoInstallOff: "IRIS_AUTO_INSTALL" },
    unknown: {
      probeFound: true,
      probeStatus: "unknown",
      readFailure: "the version query failed: IRIS returned HTTP 500 for POST /api/atelier/v8/DEFAULTNS/action/query, and the ExecuteMCPv2.Setup class exists",
      autoInstallOff: "IRIS_AUTO_INSTALL",
      deployed: false,
      compiled: false,
      configured: false,
      mapped: false,
      unitTestRootEnsured: false,
      errors: [],
    },
  };

  it.each(["current", "unknown"] as const)(
    "bootstrap result %s with the install off: custom-REST calls go out as today",
    async (probeStatus) => {
      process.env.IRIS_AUTO_INSTALL = "false";
      answer = () => REAL_SHAPES[probeStatus];
      stageStartup(env.fetchMock);
      const server = new McpServerBase(opts([tool("iris_custom", async (_a, ctx) => text(JSON.stringify(await ctx.http.get("/api/executemcp/v2/x"))))]));
      await server.start("stdio");
      env.fetchMock.mockResolvedValueOnce(okResponse());
      const before = env.fetchMock.mock.calls.length;
      const result = await callTool(server, "iris_custom");
      expect(result.isError).toBeFalsy();
      expect(paths(env.fetchMock, before)).toEqual(["GET http://default.example.com:52773/api/executemcp/v2/x"]);
    },
  );
});

describe("the audit entry of a refused call", () => {
  // Decision #160 (DW-769): the refusal can follow a handler's earlier Atelier calls, so it is audited as `error`, with its text.
  it("records outcome error, the refusal text, and never the password", async () => {
    const dir = mkdtempSync(join(tmpdir(), "iris-45-2-audit-"));
    const auditPath = join(dir, "audit.log");
    try {
      process.env.IRIS_AUDIT_LOG = auditPath;
      process.env.IRIS_GOVERNANCE_PRESET = "read-only";
      answer = (config) => refusedFor("missing", config);
      stageStartup(env.fetchMock);
      const server = new McpServerBase(opts([tool("iris_custom", async (_a, ctx) => text(JSON.stringify(await ctx.http.get("/api/executemcp/v2/x"))))]));
      await server.start("stdio");
      expect((await callTool(server, "iris_custom")).structuredContent.code).toBe("IRIS_SIDE_NOT_INSTALLED");
      const entry = (await auditLines(auditPath, 2)).find((line) => line.tool === "iris_custom");
      expect(entry?.outcome).toBe("error");
      expect(entry?.error).toContain('The ExecuteMCPv2 service on IRIS is not available to server profile "default"');
      expect(readFileSync(auditPath, "utf8")).not.toContain(SECRET);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("discovery", () => {
  it("each roster entry carries autoInstall and autoInstallSource, after dataPolicySource", async () => {
    process.env.IRIS_PROFILES = JSON.stringify({ p1: { host: "p1.example.com", autoInstall: false }, p2: { host: "p2.example.com" } });
    process.env.IRIS_AUTO_INSTALL = "true";
    stageStartup(env.fetchMock);
    const server = new McpServerBase(opts([]));
    await server.start("stdio");
    const result = await callTool(server, "iris_server_profiles", {});
    const roster = (result.structuredContent as { profiles: Array<Record<string, unknown>> }).profiles;
    const byName = new Map(roster.map((entry) => [entry.name, entry]));
    expect(byName.get("default")).toMatchObject({ autoInstall: true, autoInstallSource: "IRIS_AUTO_INSTALL" });
    expect(byName.get("p1")).toMatchObject({ autoInstall: false, autoInstallSource: "IRIS_PROFILES" });
    expect(byName.get("p2")).toMatchObject({ autoInstall: true, autoInstallSource: "IRIS_AUTO_INSTALL" });
    const keys = Object.keys(byName.get("p1") as object);
    expect(keys.indexOf("autoInstall")).toBe(keys.indexOf("dataPolicySource") + 1);
    expect(keys.indexOf("autoInstallSource")).toBe(keys.indexOf("dataPolicySource") + 2);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});
