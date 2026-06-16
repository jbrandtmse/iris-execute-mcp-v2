/**
 * Story 14.2 — `server` parameter across all tool schemas (architecture D2).
 *
 * Proves the central, framework-level injection of the optional `server`
 * profile-name parameter and its per-call consumption in `handleToolCall`:
 *
 * - AC 14.2.1 / 14.2.2: every registered tool's ADVERTISED input schema gains
 *   an optional `server` field with the exact prescribed description, injected
 *   centrally in `registerTool` (not hand-added per tool).
 * - AC 14.2.3 / 14.2.6: `server` selects the profile's client per call;
 *   concurrent mixed-profile calls stay isolated; unknown `server` → structured
 *   `isError` (not a crash).
 * - AC 14.2.4: omitting `server` → default profile → byte-for-byte today's
 *   behavior (back-compat gate).
 * - AC 14.2.5: `server` selects the instance; a per-call `namespace` still
 *   overrides the namespace within that profile (precedence; both combine).
 * - AC 14.2.7: `getOrCreateClient` coalesces concurrent first-touch
 *   establishment so bootstrap runs at most once per profile.
 * - AC 14.2.8: a non-default first-touch health-check failure destroys + drops
 *   the cached client so the next call retries cleanly.
 *
 * Provable WITHOUT a live IRIS server (vitest, mocked fetch + bootstrap spy).
 * No `BOOTSTRAP_VERSION` impact — TypeScript-only, all in `@iris-mcp/shared`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";

// The exact description text mandated by AC 14.2.1 — asserted verbatim so a
// drift in the framework constant fails the suite.
const SERVER_DESCRIPTION =
  "Named server profile to target for this call (from `IRIS_PROFILES`). Omit to use the default server.";

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

// Mock ONLY the `bootstrap` export so the at-most-once assertion is a clean
// call-count (mirrors profiles-bootstrap.test.ts). Every other real export is
// preserved so the shared barrel + server-base's other imports keep working.
const bootstrapSpy = vi.fn(async () => okBootstrap);
vi.mock("../bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bootstrap.js")>();
  return { ...actual, bootstrap: bootstrapSpy };
});

// Import AFTER vi.mock so server-base picks up the mocked bootstrap.
const { McpServerBase, withServerParam } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;
type ToolDefinition = import("../tool-types.js").ToolDefinition;
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

/**
 * A tool whose handler echoes the resolved namespace and the host of the
 * client it was handed — enough to prove profile selection + namespace
 * precedence + cross-profile isolation. It also fails if it ever receives a
 * `server` key in its args (D2 strip-before-handler guarantee).
 */
function makeEchoTool(name = "iris_doc_get"): ToolDefinition {
  return {
    name,
    title: "Echo",
    description: "Echo the resolved namespace + client host.",
    inputSchema: z.object({
      namespace: z.string().optional().describe("Target namespace"),
    }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    // Classify as a read (Story 15.0 AC 15.0.3): harmless on the default
    // baseline name `iris_doc_get` (baseline membership wins), and required for
    // the non-baseline variants (`iris_with_output`, `iris_added_later`) so the
    // registration assertion does not fire on these synthetic fixtures.
    mutates: "read",
    handler: async (args, ctx) => {
      const a = args as Record<string, unknown>;
      if ("server" in a) {
        // The framework MUST strip `server` before the handler runs (D2).
        return {
          content: [{ type: "text" as const, text: "LEAK: server reached handler" }],
          isError: true,
        };
      }
      const ns = ctx.resolveNamespace(a.namespace as string | undefined);
      // ctx.config is the resolved profile; expose its host so the test can
      // confirm which profile's client/config was selected.
      const host = ctx.config.host;
      return {
        content: [
          { type: "text" as const, text: `ns=${ns};host=${host}` },
        ],
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

/** Read the ADVERTISED (SDK-registered) input schema shape for a tool. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function advertisedShape(server: any, name: string): Record<string, unknown> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reg = (server.server as any)._registeredTools[name];
  return reg.inputSchema.shape as Record<string, unknown>;
}

// ── Tests ───────────────────────────────────────────────────────────

describe("Story 14.2 — central `server` parameter injection (D2)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("AC 14.2.1 / 14.2.2 — advertised schema gains optional `server`", () => {
    it("injects `server` into a registered tool's advertised input schema", () => {
      const server = new McpServerBase(makeServerOpts([makeEchoTool()]));
      const shape = advertisedShape(server, "iris_doc_get");
      expect(Object.keys(shape)).toContain("server");
      // Original field still present (extension, not replacement).
      expect(Object.keys(shape)).toContain("namespace");
    });

    it("the injected `server` field is optional with the exact prescribed description", () => {
      const server = new McpServerBase(makeServerOpts([makeEchoTool()]));
      const shape = advertisedShape(server, "iris_doc_get");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const serverField = shape.server as any;
      // Optional → safeParse of an object WITHOUT server succeeds against the
      // advertised schema; and the description matches AC 14.2.1 verbatim.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reg = (server.server as any)._registeredTools["iris_doc_get"];
      expect(reg.inputSchema.safeParse({}).success).toBe(true);
      expect(reg.inputSchema.safeParse({ server: "prod" }).success).toBe(true);
      // The description is carried on the Zod field (Zod v4 → `.description`).
      expect(serverField.description).toBe(SERVER_DESCRIPTION);
    });

    it("injects `server` centrally for a representative tool from EACH of the 5 servers", () => {
      // One real tool name per server (dev/admin/data/interop/ops). Proves the
      // shared mechanism gives every registered tool `server` regardless of the
      // tool's own schema — i.e. coverage is structural, not per-tool.
      const repNames = [
        "iris_doc_get", // @iris-mcp/dev
        "iris_user_get", // @iris-mcp/admin
        "iris_docdb_find", // @iris-mcp/data
        "iris_production_status", // @iris-mcp/interop
        "iris_metrics_system", // @iris-mcp/ops
      ];
      const server = new McpServerBase(
        makeServerOpts(repNames.map((n) => makeEchoTool(n))),
      );
      for (const n of repNames) {
        expect(Object.keys(advertisedShape(server, n))).toContain("server");
      }
    });

    it("does not add `server` to a tool's outputSchema", () => {
      const tool: ToolDefinition = {
        ...makeEchoTool("iris_with_output"),
        outputSchema: z.object({ ns: z.string(), host: z.string() }),
      };
      const server = new McpServerBase(makeServerOpts([tool]));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const reg = (server.server as any)._registeredTools["iris_with_output"];
      expect(Object.keys(reg.outputSchema.shape)).not.toContain("server");
      expect(Object.keys(reg.outputSchema.shape).sort()).toEqual(["host", "ns"]);
    });

    it("tools added at runtime via addTools() also inherit `server`", () => {
      const server = new McpServerBase(makeServerOpts([]));
      server.addTools([makeEchoTool("iris_added_later")]);
      expect(Object.keys(advertisedShape(server, "iris_added_later"))).toContain(
        "server",
      );
    });

    it("fails fast (does NOT silently clobber) when a tool declares its own reserved `server` field (CR F1)", () => {
      // A tool whose own schema declares `server` would have it silently replaced
      // by the framework field and then stripped before the handler — losing the
      // tool's argument. withServerParam must throw, naming the tool.
      const collidingSchema = z.object({ server: z.enum(["a", "b"]) });
      expect(() => withServerParam(collidingSchema, "iris_bad_tool")).toThrow(
        /reserved input field "server"/,
      );
      expect(() => withServerParam(collidingSchema, "iris_bad_tool")).toThrow(
        /iris_bad_tool/,
      );
      // And registration of such a tool throws too (the guard runs in registerTool).
      const badTool: ToolDefinition = {
        name: "iris_bad_tool",
        title: "Bad",
        description: "Declares a reserved server field.",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        inputSchema: collidingSchema as any,
        annotations: { readOnlyHint: true },
        scope: "NS",
        handler: async () => ({ content: [{ type: "text" as const, text: "x" }] }),
      };
      expect(() => new McpServerBase(makeServerOpts([badTool]))).toThrow(
        /reserved input field "server"/,
      );
    });
  });

  describe("per-call profile selection in handleToolCall", () => {
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

    beforeEach(() => {
      bootstrapSpy.mockClear();
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
      exitMock = vi
        .spyOn(process, "exit")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation((() => {}) as any);
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      exitMock.mockRestore();
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    /** Start a server with a default + a "prod" profile on distinct hosts. */
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

      // start(): default profile health check + negotiation.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());

      const server = new McpServerBase(makeServerOpts([makeEchoTool()]));
      await server.start("stdio");
      return { server };
    }

    it("AC 14.2.4 — omitting `server` routes to the default profile (back-compat)", async () => {
      // Injected config → single `default` profile (no IRIS_PROFILES).
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      const server = new McpServerBase(
        makeServerOpts([makeEchoTool()], makeConfig()),
      );
      await server.start("stdio");

      const callsAfterStart = fetchMock.mock.calls.length;
      const result = await callTool(server, "iris_doc_get", { name: "Foo.cls" });

      expect(result.isError).toBeFalsy();
      // Default profile namespace (HSCUSTOM) + default host (localhost).
      expect(result.structuredContent).toEqual({
        ns: "HSCUSTOM",
        host: "localhost",
      });
      // No re-establishment: the default client was made eagerly in start().
      expect(fetchMock.mock.calls.length).toBe(callsAfterStart);
    });

    it("missing extended schema fails fast with a structured internal error, not a silent default-profile mis-route (CR F5)", async () => {
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      const server = new McpServerBase(
        makeServerOpts([makeEchoTool()], makeConfig()),
      );
      await server.start("stdio");

      // Simulate the (currently-unreachable) broken invariant: the SDK callback
      // exists but the extended schema is gone. The handler MUST NOT fall back to
      // the unextended schema (which would strip `server` and silently route to
      // default); it must return a structured isError naming the tool.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (server as any).extendedSchemas.delete("iris_doc_get");
      const result = await callTool(server, "iris_doc_get", { server: "prod" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("iris_doc_get");
      expect(result.content[0].text).toContain("not fully registered");
    });

    it("AC 14.2.3 — `server:'prod'` selects the prod profile's client + namespace", async () => {
      const { server } = await startWithProfiles();

      // First touch of "prod": its own health check + negotiation.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());

      const result = await callTool(server, "iris_doc_get", { server: "prod" });
      expect(result.isError).toBeFalsy();
      // prod profile → its host + its namespace default.
      expect(result.structuredContent).toEqual({
        ns: "PRODNS",
        host: "prod.example.com",
      });

      // The prod health check went to prod's host (isolated client).
      const prodCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("prod.example.com"),
      );
      expect(prodCall).toBeDefined();
    });

    it("AC 14.2.5 — `namespace` overrides the namespace WITHIN the selected profile", async () => {
      const { server } = await startWithProfiles();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());

      // server picks prod (host prod.example.com); namespace override wins over
      // prod's PRODNS default.
      const result = await callTool(server, "iris_doc_get", {
        server: "prod",
        namespace: "OVERRIDE",
      });
      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({
        ns: "OVERRIDE",
        host: "prod.example.com",
      });
    });

    it("AC 14.2.6 — unknown `server` returns a structured isError naming valid profiles (no crash)", async () => {
      const { server } = await startWithProfiles();

      const result = await callTool(server, "iris_doc_get", { server: "nope" });
      expect(result.isError).toBe(true);
      const text = result.content[0].text as string;
      expect(text).toContain('Unknown server profile "nope"');
      // Lists the valid profile names so the client can correct the request.
      expect(text).toContain("default");
      expect(text).toContain("prod");
      // No establishment fetch was issued for the bad name.
      const badCall = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("nope"),
      );
      expect(badCall).toBeUndefined();
    });

    it("strips `server` before the handler (D2 — handler never sees it)", async () => {
      const { server } = await startWithProfiles();
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      // The echo tool returns isError if it ever sees a `server` key.
      const result = await callTool(server, "iris_doc_get", { server: "prod" });
      expect(result.isError).toBeFalsy();
      expect(result.content[0].text).not.toContain("LEAK");
    });

    it("AC 14.2.6 — concurrent mixed-profile calls stay isolated (no client/ns bleed)", async () => {
      const { server } = await startWithProfiles();

      // Establish prod once up front (deterministic — avoids interleaving the
      // prod establishment fetches with the default call below).
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      await server.getOrCreateClient("prod", false);

      // Now fire a default-profile call and a prod-profile call concurrently.
      const [defaultRes, prodRes] = await Promise.all([
        callTool(server, "iris_doc_get", {}),
        callTool(server, "iris_doc_get", { server: "prod" }),
      ]);

      expect(defaultRes.structuredContent).toEqual({
        ns: "DEFAULTNS",
        host: "default.example.com",
      });
      expect(prodRes.structuredContent).toEqual({
        ns: "PRODNS",
        host: "prod.example.com",
      });
    });
  });

  describe("AC 14.2.7 — concurrent first-touch establishment coalesces (bootstrap once)", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const originalFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let exitMock: any;
    const savedEnv = {
      IRIS_USERNAME: process.env.IRIS_USERNAME,
      IRIS_PASSWORD: process.env.IRIS_PASSWORD,
      IRIS_HOST: process.env.IRIS_HOST,
      IRIS_PROFILES: process.env.IRIS_PROFILES,
    };

    beforeEach(() => {
      bootstrapSpy.mockClear();
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
      exitMock = vi
        .spyOn(process, "exit")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation((() => {}) as any);
      process.env.IRIS_USERNAME = "u";
      process.env.IRIS_PASSWORD = "p";
      process.env.IRIS_HOST = "default.example.com";
      process.env.IRIS_PROFILES = JSON.stringify({
        other: { host: "other.example.com" },
      });
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      exitMock.mockRestore();
      vi.restoreAllMocks();
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    it("two simultaneous getOrCreateClient(other, true) share one establishment + bootstrap once", async () => {
      // start(): default profile (needsCustomRest=false → no default bootstrap).
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      const server = new McpServerBase(makeServerOpts([], undefined, false));
      await server.start("stdio");
      expect(bootstrapSpy).not.toHaveBeenCalled();

      // The first-touch of "other" needs ONE health check + ONE negotiation,
      // even though two callers race. Provide exactly one of each; if the race
      // caused a double-establishment, a fetch would be unmatched (→ undefined)
      // and the second negotiation would throw, which the assertions catch.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());

      const [a, b] = await Promise.all([
        server.getOrCreateClient("other", true),
        server.getOrCreateClient("other", true),
      ]);

      // Bootstrap attempted exactly once despite two concurrent first-touch calls.
      expect(bootstrapSpy).toHaveBeenCalledTimes(1);
      // Both callers got the SAME established client instance (shared establishment).
      expect(a.client).toBe(b.client);
      expect(a.atelierVersion).toBe(8);
      // Exactly one health check + one negotiation were issued for "other".
      const otherFetches = fetchMock.mock.calls.filter((c) =>
        String(c[0]).includes("other.example.com"),
      );
      expect(otherFetches.length).toBe(2); // HEAD health + GET negotiation
    });
  });

  describe("AC 14.2.8 — non-default first-touch health-check failure is retryable", () => {
    let fetchMock: ReturnType<typeof vi.fn>;
    const originalFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let exitMock: any;
    const savedEnv = {
      IRIS_USERNAME: process.env.IRIS_USERNAME,
      IRIS_PASSWORD: process.env.IRIS_PASSWORD,
      IRIS_HOST: process.env.IRIS_HOST,
      IRIS_PROFILES: process.env.IRIS_PROFILES,
    };

    beforeEach(() => {
      bootstrapSpy.mockClear();
      fetchMock = vi.fn();
      globalThis.fetch = fetchMock;
      exitMock = vi
        .spyOn(process, "exit")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .mockImplementation((() => {}) as any);
      process.env.IRIS_USERNAME = "u";
      process.env.IRIS_PASSWORD = "p";
      process.env.IRIS_HOST = "default.example.com";
      process.env.IRIS_PROFILES = JSON.stringify({
        other: { host: "other.example.com" },
      });
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      exitMock.mockRestore();
      vi.restoreAllMocks();
      for (const [k, v] of Object.entries(savedEnv)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });

    it("drops the un-established client on health-check failure, then a later call re-establishes cleanly", async () => {
      // start(): default profile establishes fine.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      const server = new McpServerBase(makeServerOpts([], undefined, false));
      await server.start("stdio");

      // First touch of "other": health check REJECTS → getOrCreateClient throws
      // and the cached client is dropped (retryable).
      fetchMock.mockRejectedValueOnce(new TypeError("Connection refused"));
      await expect(server.getOrCreateClient("other", false)).rejects.toThrow();

      // The registry no longer holds an "other" client (it was destroyed+dropped).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const registry = (server as any).clients;
      expect(registry.has("other")).toBe(false);

      // A retry now succeeds: health + negotiation succeed → established cleanly.
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      const retry = await server.getOrCreateClient("other", false);
      expect(retry.atelierVersion).toBe(8);
      expect(registry.has("other")).toBe(true);
    });

    it("surfaces a structured isError (not a throw) when a tool call hits a first-touch health failure", async () => {
      process.env.IRIS_NAMESPACE = "DEFAULTNS";
      fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
      fetchMock.mockResolvedValueOnce(versionResponse());
      const server = new McpServerBase(makeServerOpts([makeEchoTool()], undefined, false));
      await server.start("stdio");

      // "other" first-touch health check fails during the tool call.
      fetchMock.mockRejectedValueOnce(new TypeError("Connection refused"));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdkTools = (server.server as any)._registeredTools;
      const entry = sdkTools["iris_doc_get"];
      const callback = entry.callback ?? entry.handler ?? entry.cb;
      const result = await callback({ server: "other" });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('server profile "other"');
      delete process.env.IRIS_NAMESPACE;
    });
  });
});
