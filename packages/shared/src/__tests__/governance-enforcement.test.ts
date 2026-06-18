/**
 * Story 14.4 — Call-Time Governance Enforcement & Structured Denial Error.
 *
 * Exercises the enforcement GATE wired into `McpServerBase.handleToolCall`
 * (architecture decision D5 — the one chokepoint). The gate consumes the
 * Story 14.3 engine (`effective` / the cascade) and the Story 14.2 profile
 * resolution; this suite proves the integration ACs end-to-end through the
 * SDK-registered tool callback, with NO live IRIS:
 *
 *   AC 14.4.1 — every call passes through the gate (policy evaluated before the
 *               handler).
 *   AC 14.4.2 — a disabled action returns a structured `isError` (human text +
 *               machine-readable `{ code, action, server }`); the handler is
 *               NEVER called and the profile's connection is NOT established.
 *   AC 14.4.3 — enforcement is call-time: all tools stay advertised (asserted by
 *               proving a tool whose action is denied is still in tools/list).
 *   AC 14.4.4 — back-compat: with no IRIS_GOVERNANCE the gate is a pure
 *               pass-through; a representative existing action from EACH of the
 *               five servers resolves enabled.
 *   AC 14.4.5 — ordering (unknown `server` errors BEFORE the gate; a denied call
 *               does not health-check/bootstrap) + governance-key alignment with
 *               the generated baseline.
 *
 * Harness mirrors `server-param-integration.test.ts`: mocked `bootstrap`,
 * `fetchMock` for the default profile's startup HEAD (health) + GET (version),
 * a handler spy, and hermetic env save/restore. Discoverable by the default
 * `vitest run` suite (`*.test.ts`). TypeScript-only — no `BOOTSTRAP_VERSION`
 * impact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";

// A successful, no-op bootstrap result (REST service already current). Mirrors
// the shape used across the profile/server-param suites.
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
// The spy also lets us assert bootstrap was NOT attempted on a denied call.
const bootstrapSpy = vi.fn(async () => okBootstrap);
vi.mock("../bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bootstrap.js")>();
  return { ...actual, bootstrap: bootstrapSpy };
});

// Import AFTER vi.mock so server-base picks up the mocked bootstrap.
const { McpServerBase } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;
type ToolDefinition = import("../tool-types.js").ToolDefinition;

// ── Helpers ─────────────────────────────────────────────────────────

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
  return {
    name: "test-server",
    version: "1.0.0",
    tools,
    needsCustomRest,
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

/** True when the SDK still advertises a tool of this name (tools/list surface). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isAdvertised(server: any, name: string): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkTools = (server.server as any)._registeredTools;
  return !!sdkTools && name in sdkTools;
}

/**
 * A single-operation governed WRITE tool (scalar `mutates: "write"`, no `action`
 * enum). Its governance key is the bare tool name. Because it is NEW (not in the
 * baseline) and a write, it defaults DISABLED — perfect for asserting the seed +
 * the gate without needing IRIS_GOVERNANCE to disable it. The handler is a spy so
 * we can assert it is (not) invoked.
 */
function makeWriteTool(
  name: string,
  handlerSpy: ReturnType<typeof vi.fn>,
): ToolDefinition {
  return {
    name,
    title: "Governed write",
    description: "A NEW single-op write action (seed-disabled).",
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: "write",
    handler: handlerSpy,
  };
}

/** A read echo tool with NO `mutates` — stands in for a grandfathered action. */
function makeEchoTool(
  name: string,
  handlerSpy?: ReturnType<typeof vi.fn>,
): ToolDefinition {
  return {
    name,
    title: "Echo",
    description: "Echo the resolved namespace + client host.",
    inputSchema: z.object({ namespace: z.string().optional() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    handler:
      handlerSpy ??
      (async (args, ctx) => {
        const a = args as Record<string, unknown>;
        const ns = ctx.resolveNamespace(a.namespace as string | undefined);
        return {
          content: [{ type: "text" as const, text: `ns=${ns}` }],
          structuredContent: { ns, host: ctx.config.host },
        };
      }),
  };
}

/**
 * A multi-action tool whose name + action enum mirror a REAL baseline tool
 * (`iris_database_manage` with `create|modify|delete`). Used to prove the gate's
 * computed key (`tool:action`) aligns with a `GOVERNANCE_BASELINE` entry.
 */
function makeMultiActionTool(
  handlerSpy: ReturnType<typeof vi.fn>,
): ToolDefinition {
  return {
    name: "iris_database_manage",
    title: "Database manage (synthetic)",
    description: "Mirrors the real multi-action tool's name + action enum.",
    inputSchema: z.object({
      action: z.enum(["create", "modify", "delete"]),
      name: z.string(),
    }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    handler: handlerSpy,
  };
}

/**
 * Shared environment save/restore so each describe block runs hermetically and
 * never leaks IRIS_* / IRIS_PROFILES / IRIS_GOVERNANCE into sibling suites.
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
    // Clear inherited governance/profiles; each test sets what it needs.
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

/** Stage the default profile's startup HEAD (health) + GET (version) responses. */
function stageDefaultStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(versionResponse());
}

/** Set the baseline single-server env (default profile only). */
function setDefaultEnv(): void {
  process.env.IRIS_USERNAME = "u";
  process.env.IRIS_PASSWORD = "p";
  process.env.IRIS_HOST = "default.example.com";
  process.env.IRIS_NAMESPACE = "DEFAULTNS";
}

// ════════════════════════════════════════════════════════════════════
// AC 14.4.2 / 14.4.1 — a disabled (seed-disabled NEW write) action is denied.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 — denied action returns a structured error (handler + connection untouched)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a seed-disabled NEW write tool is denied with the structured code; handler NOT called", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWriteTool("iris_new_write", handlerSpy)]),
    );
    await server.start("stdio");
    const callsAfterStart = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_new_write", { value: "x" });

    // AC 14.4.2 — structured isError shape.
    expect(result.isError).toBe(true);
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0].type).toBe("text");
    // Human-readable text names the action + the server profile.
    expect(result.content[0].text).toBe(
      "action 'iris_new_write' is disabled by governance policy for server 'default'",
    );
    // Machine-readable structured data.
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_new_write",
      server: "default",
    });

    // The handler is NEVER invoked — the gate short-circuited before dispatch.
    expect(handlerSpy).not.toHaveBeenCalled();

    // No further fetch occurred for the denied call: the default profile was
    // established eagerly at start(); a denied call adds nothing (no extra
    // health-check). Bootstrap was never attempted for this call.
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);
    expect(bootstrapSpy).not.toHaveBeenCalled();
  });

  it("a denied call against a NON-DEFAULT profile does NOT establish that profile's connection", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWriteTool("iris_new_write", handlerSpy)], true),
    );
    await server.start("stdio");
    // The DEFAULT profile legitimately bootstraps at start() (needsCustomRest:
    // true). Clear the shared spy so the assertion below measures ONLY what the
    // denied prod call triggers — which must be nothing.
    bootstrapSpy.mockClear();

    // Any fetch to the prod host would be establishment (HEAD health / GET
    // version). The gate denies BEFORE getOrCreateClient, so there must be NONE.
    const result = await callTool(server, "iris_new_write", {
      server: "prod",
      value: "x",
    });

    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_new_write",
      server: "prod",
    });
    expect(handlerSpy).not.toHaveBeenCalled();

    // CRITICAL ordering proof: no establishment fetch to the prod host, and the
    // prod profile was never bootstrapped — the gate ran before establishment.
    const prodFetches = env.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("prod.example.com"),
    );
    expect(prodFetches.length).toBe(0);
    expect(bootstrapSpy).not.toHaveBeenCalled();
    // The prod client was never even created (no lingering un-established client).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = (server as any).clients;
    expect(registry.has("prod")).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.4.5 — same action allowed under a profile that re-enables it.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 — a profile can re-enable a globally/seed-disabled action", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("profile override `true` over a seed-disabled write → handler IS invoked", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    // prod re-enables the otherwise seed-disabled NEW write; default does not.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      profiles: { prod: { iris_new_write: true } },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWriteTool("iris_new_write", handlerSpy)]),
    );
    await server.start("stdio");

    // Establish prod up front (HEAD + GET) so the allowed call's handler runs.
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    await server.getOrCreateClient("prod", false);

    // Allowed under prod — handler runs.
    const allowed = await callTool(server, "iris_new_write", {
      server: "prod",
      value: "x",
    });
    expect(allowed.isError).toBeFalsy();
    expect(allowed.structuredContent).toEqual({ ok: true });
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // Still denied under the DEFAULT profile (override is prod-scoped).
    const denied = await callTool(server, "iris_new_write", { value: "x" });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      server: "default",
    });
    // Handler count unchanged — the default-profile call never reached it.
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("a global `false` on a grandfathered action denies it; a profile `true` re-enables it", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    // Disable a grandfathered read globally, but re-enable it for prod.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
      profiles: { prod: { iris_doc_get: true } },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get", handlerSpy)]),
    );
    await server.start("stdio");

    // Default profile: globally disabled → denied (no handler, no extra fetch).
    const callsAfterStart = env.fetchMock.mock.calls.length;
    const deniedDefault = await callTool(server, "iris_doc_get", {});
    expect(deniedDefault.isError).toBe(true);
    expect(deniedDefault.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_doc_get",
      server: "default",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
    expect(env.fetchMock.mock.calls.length).toBe(callsAfterStart);

    // prod re-enables → establish prod, then the handler runs.
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    await server.getOrCreateClient("prod", false);
    const allowedProd = await callTool(server, "iris_doc_get", { server: "prod" });
    expect(allowedProd.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.4.4 — back-compat: empty IRIS_GOVERNANCE ⇒ pure pass-through.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 — back-compat gate: empty IRIS_GOVERNANCE is a pure pass-through", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  // A representative EXISTING (grandfathered) read action from each of the five
  // servers. Each is in the 141-key baseline → must resolve enabled under an
  // empty config. If any were falsely denied it would be a release blocker.
  const REPRESENTATIVE_BY_SERVER: Record<string, string> = {
    "iris-dev": "iris_doc_get",
    "iris-admin": "iris_database_list",
    "iris-interop": "iris_production_status",
    "iris-ops": "iris_license_info",
    "iris-data": "iris_docdb_find",
  };

  it("every representative existing action (one per server) is allowed under empty config", async () => {
    // Sanity: each chosen key really is in the generated baseline (so this test
    // proves grandfathering, not a vacuous pass).
    for (const key of Object.values(REPRESENTATIVE_BY_SERVER)) {
      expect(GOVERNANCE_BASELINE.has(key), `${key} must be a baseline key`).toBe(
        true,
      );
    }

    setDefaultEnv();
    // No IRIS_GOVERNANCE set (env.setup deletes it) → governanceConfig = {}.
    stageDefaultStartup(env.fetchMock);

    const spies: Record<string, ReturnType<typeof vi.fn>> = {};
    const tools: ToolDefinition[] = [];
    for (const key of Object.values(REPRESENTATIVE_BY_SERVER)) {
      const spy = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "ran" }],
        structuredContent: { key },
      }));
      spies[key] = spy;
      tools.push(makeEchoTool(key, spy));
    }
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    for (const [srv, key] of Object.entries(REPRESENTATIVE_BY_SERVER)) {
      const result = await callTool(server, key, {});
      expect(result.isError, `${srv}/${key} must be allowed`).toBeFalsy();
      expect(result.structuredContent).toEqual({ key });
      expect(spies[key], `${srv}/${key} handler must run`).toHaveBeenCalledTimes(1);
    }
  });

  it("a multi-action existing tool's actions are all allowed under empty config", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    // iris_database_manage:create/modify/delete are all in the baseline.
    const server = new McpServerBase(
      makeServerOpts([makeMultiActionTool(handlerSpy)]),
    );
    await server.start("stdio");

    for (const action of ["create", "modify", "delete"]) {
      const result = await callTool(server, "iris_database_manage", {
        action,
        name: "X",
      });
      expect(result.isError, `${action} must be allowed`).toBeFalsy();
    }
    expect(handlerSpy).toHaveBeenCalledTimes(3);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.4.5 — ordering: unknown `server` errors BEFORE the gate.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 — gate ordering: profile resolution precedes enforcement", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("an unknown `server` surfaces the profile-resolution error, NOT a governance denial", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    // Disable the action everywhere so that, IF the gate ran before resolution,
    // we would see a GOVERNANCE_DISABLED error. We must instead see the
    // unknown-profile error — proving resolve-then-gate ordering.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_new_write: false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWriteTool("iris_new_write", handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_new_write", {
      server: "ghost",
      value: "x",
    });

    expect(result.isError).toBe(true);
    // It is the profile-resolution error (names the bad profile + valid names),
    // NOT a governance denial — resolution ran first.
    expect(result.content[0].text).toContain('Unknown server profile "ghost"');
    expect(result.content[0].text).toContain("default");
    expect(result.content[0].text).toContain("prod");
    // Crucially NOT the governance code — the gate never ran for an unknown server.
    expect(result.structuredContent).toBeUndefined();
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("Zod validation runs BEFORE the gate (invalid args error, not a governance denial)", async () => {
    setDefaultEnv();
    // Disable the multi-action tool's delete globally; then send an INVALID
    // action. Validation must fail first → "Invalid arguments", never a denial.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_database_manage:delete": false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([makeMultiActionTool(handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_database_manage", {
      action: "not_a_valid_action",
      name: "X",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Invalid arguments");
    expect(result.structuredContent).toBeUndefined();
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.4.5 — governance-key alignment with the generated baseline (D4).
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 — governance key computation aligns with GOVERNANCE_BASELINE (D4)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a multi-action tool's computed key is `tool:action` and matches a baseline entry", async () => {
    // The real baseline holds `iris_database_manage:delete`. We register a tool
    // with that exact name + action enum, disable that exact key via global
    // policy, invoke with action=delete, and assert the denial echoes that key.
    // The denial's `action` field IS the gate-computed key, so this proves both
    // (a) the gate computes `tool:action` for an enum-action tool, and (b) the
    // computed key equals the baseline entry (the cascade resolved against it).
    const BASELINE_KEY = "iris_database_manage:delete";
    expect(
      GOVERNANCE_BASELINE.has(BASELINE_KEY),
      `${BASELINE_KEY} must be in the generated baseline`,
    ).toBe(true);

    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { [BASELINE_KEY]: false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([makeMultiActionTool(handlerSpy)]),
    );
    await server.start("stdio");

    // delete is disabled → denied, and the key echoed equals the baseline key.
    const deletedResult = await callTool(server, "iris_database_manage", {
      action: "delete",
      name: "X",
    });
    expect(deletedResult.isError).toBe(true);
    expect(deletedResult.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: BASELINE_KEY, // gate-computed `tool:action` == baseline entry
      server: "default",
    });
    expect(handlerSpy).not.toHaveBeenCalled();

    // A DIFFERENT action on the same tool (create) is NOT disabled → allowed.
    // Proves the key carries the action discriminator (not the bare tool name).
    const createResult = await callTool(server, "iris_database_manage", {
      action: "create",
      name: "X",
    });
    expect(createResult.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("a single-operation tool's computed key is the bare tool name (no `:action`)", async () => {
    // Disabling the bare name denies the single-op tool; the denial echoes the
    // bare name (no colon), proving single-op key computation.
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get", handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_doc_get", {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_doc_get", // bare name — no `:action` suffix
      server: "default",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.4.3 — enforcement is call-time: denied tools stay advertised.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 — call-time enforcement keeps every tool advertised (AC 14.4.3)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a tool whose action is globally disabled is STILL listed in tools/list", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
    });
    stageDefaultStartup(env.fetchMock);

    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get")]),
    );
    await server.start("stdio");

    // The tool remains advertised even though every call to it would be denied —
    // enforcement is call-time, not advertise-time (the policy is per-profile and
    // cannot be evaluated at registration). toolCount + advertised registry both
    // still include it.
    expect(isAdvertised(server, "iris_doc_get")).toBe(true);
    expect(server.getToolNames()).toContain("iris_doc_get");
    // 1 package tool + the framework discovery tool (Epic 19, decision E1).
    expect(server.toolCount).toBe(2);

    // And the denial only happens at call time.
    const result = await callTool(server, "iris_doc_get", {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// D7 — malformed IRIS_GOVERNANCE fails fast at start() (naming the var).
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 — malformed IRIS_GOVERNANCE fails fast at start() (D7)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("start() throws (naming IRIS_GOVERNANCE) when the policy JSON is malformed", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = "{ not valid json";
    // The default profile's startup fetches are not reached — parse fails first.
    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get")]),
    );
    await expect(server.start("stdio")).rejects.toThrow(/IRIS_GOVERNANCE/);
  });

  it("start() throws when a governance value is non-boolean (typo guard)", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: "false" }, // quoted string, not a boolean
    });
    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get")]),
    );
    await expect(server.start("stdio")).rejects.toThrow(/IRIS_GOVERNANCE/);
  });
});

// ════════════════════════════════════════════════════════════════════
// Constructed-but-not-started safety: governanceConfig defaults to {}.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 — a constructed-but-not-started server has a safe empty policy", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("governanceConfig defaults to {} (pass-through) before start() parses the env", () => {
    // Even with a disabling IRIS_GOVERNANCE in the environment, the constructor
    // does NOT read it — the policy is parsed in start(). So a constructed server
    // holds the safe empty default until then.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
    });
    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get")]),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((server as any).governanceConfig).toEqual({});
  });
});
