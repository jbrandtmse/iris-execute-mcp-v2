/**
 * Story 14.4 — Call-Time Governance Enforcement: COMPLEMENTARY coverage.
 *
 * Companion to `governance-enforcement.test.ts` (the dev's 14 integration
 * tests). This suite adds NON-DUPLICATIVE coverage of the enforcement gate
 * wired into `McpServerBase.handleToolCall` (architecture decision D5 — the one
 * chokepoint), targeting interactions the dev suite does not exercise:
 *
 *   - governance × `server` × `namespace`: a denied action on one profile is
 *     allowed on another, AND on the allowed path the per-call `namespace`
 *     override still wins (AC 14.2.5 precedence is undisturbed by the gate).
 *   - the FULL three-layer cascade THROUGH the real gate: a seed-disabled write
 *     enabled by `global:true` then re-disabled by `profiles.<p>:false` (the dev
 *     proved only seed→profile and global→profile two-layer paths).
 *   - per-action enforcement driven by the PROFILE layer: one action denied while
 *     another is allowed on the SAME tool / SAME profile, and the inverse on a
 *     second profile.
 *   - the denial envelope is EXACTLY `{ code, action, server }` + `isError:true`
 *     + a single non-empty `content[].text` — asserted as a strict invariant on a
 *     profile-scoped `tool:action` denial.
 *   - case / whitespace in `args.action`: a near-miss enum value is rejected by
 *     Zod (validation precedes the gate) — never silently allowed, never a
 *     governance denial.
 *   - concurrency: a denied call and an allowed call interleaved (`Promise.all`)
 *     stay independent — the gate has no shared mutable state across calls.
 *   - a denied non-default call leaves NO cached client AND NO in-flight
 *     establishment entry (gate-before-establishment, asserted via the client
 *     registry + the private `establishing` map + a host-scoped fetch filter).
 *   - back-compat strengthening: a NEW *read* tool (not in the baseline) resolves
 *     ENABLED under empty `IRIS_GOVERNANCE` (the seed's read branch through the
 *     gate — the dev proved grandfathered reads + new-write-disabled, not this).
 *
 * Harness mirrors `governance-enforcement.test.ts` / `server-param-integration
 * .test.ts`: mocked `bootstrap`, a `fetchMock` for the default profile's startup
 * HEAD (health) + GET (version), handler spies, and hermetic env save/restore.
 * Discoverable by the default `vitest run` suite (`*.test.ts`). TypeScript-only
 * — no `BOOTSTRAP_VERSION` impact, no generated-file edits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";

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

/**
 * A single-operation governed WRITE tool (scalar `mutates: "write"`, no `action`
 * enum). Its governance key is the bare tool name. Because it is NEW (not in the
 * baseline) and a write, it defaults DISABLED — exercises the seed + gate without
 * needing IRIS_GOVERNANCE to disable it.
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

/**
 * A NEW single-operation READ tool (`mutates: "read"`, NOT in the baseline). Its
 * governance key is the bare tool name; the seed for a new read is ENABLED — used
 * to prove the seed's read branch through the gate under empty governance.
 */
function makeNewReadTool(
  name: string,
  handlerSpy: ReturnType<typeof vi.fn>,
): ToolDefinition {
  return {
    name,
    title: "Governed read (new)",
    description: "A NEW single-op read action (seed-enabled).",
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: "read",
    handler: handlerSpy,
  };
}

/**
 * An echo tool with NO `mutates`, whose handler reflects the RESOLVED namespace
 * + host so a test can assert namespace precedence on the allowed path. Stands in
 * for a grandfathered action; the supplied name decides baseline membership.
 */
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
 * (`iris_database_manage` with `create|modify|delete`). Used to prove per-action
 * enforcement and key alignment with the generated baseline.
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

/** A two-profile env: the default + a `prod` profile with its own host/namespace. */
function setTwoProfileEnv(): void {
  setDefaultEnv();
  process.env.IRIS_PROFILES = JSON.stringify({
    prod: { host: "prod.example.com", namespace: "PRODNS" },
  });
}

// ════════════════════════════════════════════════════════════════════
// governance × server × namespace — a denial on one profile, allowed on
// another, with the per-call `namespace` override intact on the allowed path.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 (coverage) — governance × server × namespace interaction", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("denied on `default`, allowed on `prod`, and the `namespace` override still wins on prod", async () => {
    setTwoProfileEnv();
    // Grandfathered read disabled globally; re-enabled only for prod.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
      profiles: { prod: { iris_doc_get: true } },
    });
    stageDefaultStartup(env.fetchMock);

    // Real echo handler (no spy) so resolveNamespace runs and we can read it back.
    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get")]),
    );
    await server.start("stdio");

    // Default profile → globally disabled → denied (no namespace resolution at all).
    const denied = await callTool(server, "iris_doc_get", {
      namespace: "OVERRIDENS",
    });
    expect(denied.isError).toBe(true);
    expect(denied.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_doc_get",
      server: "default",
    });

    // Establish prod, then call it WITH a per-call namespace override.
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    await server.getOrCreateClient("prod", false);

    const allowed = await callTool(server, "iris_doc_get", {
      server: "prod",
      namespace: "OVERRIDENS",
    });
    expect(allowed.isError).toBeFalsy();
    // `server` selected the prod instance (host=prod.example.com); the per-call
    // `namespace` override still wins WITHIN it (AC 14.2.5) — the gate did not
    // disturb namespace precedence.
    expect(allowed.structuredContent).toEqual({
      ns: "OVERRIDENS",
      host: "prod.example.com",
    });
  });

  it("allowed on prod WITHOUT a namespace override falls back to the prod profile namespace", async () => {
    setTwoProfileEnv();
    // No governance → everything allowed; this isolates the namespace-default path.
    stageDefaultStartup(env.fetchMock);

    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get")]),
    );
    await server.start("stdio");

    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    await server.getOrCreateClient("prod", false);

    const res = await callTool(server, "iris_doc_get", { server: "prod" });
    expect(res.isError).toBeFalsy();
    // Namespace resolves to the prod profile's own namespace, not the default's.
    expect(res.structuredContent).toEqual({
      ns: "PRODNS",
      host: "prod.example.com",
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Full three-layer cascade THROUGH the gate: seed → global → profile.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 (coverage) — three-layer cascade resolved by the real gate", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("seed-disabled write, GLOBAL-enabled, then PROFILE-disabled → denied on that profile, allowed on default", async () => {
    setTwoProfileEnv();
    // Layer cascade for the NEW write `iris_new_write` (seed = DISABLED):
    //   global.true     → would enable everywhere…
    //   profiles.prod.false → …but prod explicitly re-disables it.
    // Effective: default = global(true) = ENABLED; prod = profile(false) = DISABLED.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_new_write: true },
      profiles: { prod: { iris_new_write: false } },
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

    // DEFAULT: global `true` lifts the seed-disable → ALLOWED (handler runs).
    const allowedDefault = await callTool(server, "iris_new_write", { value: "x" });
    expect(allowedDefault.isError).toBeFalsy();
    expect(allowedDefault.structuredContent).toEqual({ ok: true });
    expect(handlerSpy).toHaveBeenCalledTimes(1);

    // PROD: profile `false` overrides the global `true` → DENIED (handler unchanged).
    const deniedProd = await callTool(server, "iris_new_write", {
      server: "prod",
      value: "x",
    });
    expect(deniedProd.isError).toBe(true);
    expect(deniedProd.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_new_write",
      server: "prod",
    });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
    // The denied prod call must not have established prod (gate before connect).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((server as any).clients.has("prod")).toBe(false);
  });

  it("global `true` on a grandfathered read is a no-op (still allowed) — precedence sanity", async () => {
    setDefaultEnv();
    // Redundantly enabling a baseline-enabled read changes nothing observable.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: true },
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

    const res = await callTool(server, "iris_doc_get", {});
    expect(res.isError).toBeFalsy();
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// Per-action enforcement driven by the PROFILE layer (same tool, same
// profile: one action denied, another allowed; inverse on a second profile).
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 (coverage) — per-action enforcement via the profile layer", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("on prod: `delete` denied but `modify` allowed; on default both allowed", async () => {
    setTwoProfileEnv();
    // prod disables ONLY iris_database_manage:delete; modify/create stay enabled.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      profiles: { prod: { "iris_database_manage:delete": false } },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([makeMultiActionTool(handlerSpy)]),
    );
    await server.start("stdio");

    // Establish prod so allowed actions can reach the handler.
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    await server.getOrCreateClient("prod", false);

    // prod:delete → DENIED, key carries the action discriminator.
    const prodDelete = await callTool(server, "iris_database_manage", {
      server: "prod",
      action: "delete",
      name: "X",
    });
    expect(prodDelete.isError).toBe(true);
    expect(prodDelete.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_database_manage:delete",
      server: "prod",
    });

    // prod:modify → ALLOWED (a DIFFERENT action on the same tool/profile).
    const prodModify = await callTool(server, "iris_database_manage", {
      server: "prod",
      action: "modify",
      name: "X",
    });
    expect(prodModify.isError).toBeFalsy();

    // default:delete → ALLOWED (the deny was prod-scoped only).
    const defaultDelete = await callTool(server, "iris_database_manage", {
      action: "delete",
      name: "X",
    });
    expect(defaultDelete.isError).toBeFalsy();

    // Exactly the two allowed calls reached the handler (the denied one did not).
    expect(handlerSpy).toHaveBeenCalledTimes(2);
  });
});

// ════════════════════════════════════════════════════════════════════
// Strict denial-envelope invariant on a profile-scoped `tool:action` denial.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 (coverage) — denial envelope is exactly {code,action,server} + isError + non-empty text", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a profile-scoped tool:action denial has a single non-empty text item and no extra keys", async () => {
    setTwoProfileEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      profiles: { prod: { "iris_database_manage:delete": false } },
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
      server: "prod",
      action: "delete",
      name: "X",
    });

    // isError is exactly true.
    expect(result.isError).toBe(true);

    // content: a single text block, non-empty, naming both action + profile.
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe("text");
    expect(typeof result.content[0].text).toBe("string");
    expect(result.content[0].text.length).toBeGreaterThan(0);
    expect(result.content[0].text).toBe(
      "action 'iris_database_manage:delete' is disabled by governance policy for server 'prod'",
    );

    // structuredContent: EXACTLY these three keys, nothing more.
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_database_manage:delete",
      server: "prod",
    });
    expect(Object.keys(result.structuredContent).sort()).toEqual([
      "action",
      "code",
      "server",
    ]);

    expect(handlerSpy).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// Case / whitespace in `args.action`: Zod rejects (validation precedes the
// gate) — never a silent allow, never a governance denial.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 (coverage) — near-miss action values are rejected by validation, not the gate", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  // A whitespace-padded and a wrong-case variant of a real enum value: both must
  // fail Zod (the enum matches exact strings), so the gate never sees them and
  // the call is neither silently allowed nor reported as a governance denial.
  for (const badAction of [" delete ", "DELETE", "Delete", "delete\n"]) {
    it(`action ${JSON.stringify(badAction)} → "Invalid arguments" (no governance code, handler untouched)`, async () => {
      setDefaultEnv();
      // Disable delete globally so that, IF a near-miss leaked past validation to
      // the gate, we would see EITHER an allow (handler runs) or a denial — both
      // are wrong. The correct outcome is a validation error.
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
        action: badAction,
        name: "X",
      });

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain("Invalid arguments");
      // NOT a governance denial: no structured code leaked.
      expect(result.structuredContent).toBeUndefined();
      // And certainly not silently allowed.
      expect(handlerSpy).not.toHaveBeenCalled();
    });
  }
});

// ════════════════════════════════════════════════════════════════════
// Concurrency: an interleaved denied + allowed call stay independent.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 (coverage) — concurrent denied + allowed calls are independent", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("Promise.all of a denied default call and an allowed prod call resolves each on its own policy", async () => {
    setTwoProfileEnv();
    // delete disabled on default, allowed on prod (per-profile divergence).
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_database_manage:delete": false },
      profiles: { prod: { "iris_database_manage:delete": true } },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([makeMultiActionTool(handlerSpy)]),
    );
    await server.start("stdio");

    // Pre-establish prod so the allowed branch's handler can run deterministically.
    env.fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
    env.fetchMock.mockResolvedValueOnce(versionResponse());
    await server.getOrCreateClient("prod", false);

    // Fire both at once: default:delete (must DENY) + prod:delete (must ALLOW).
    const [deniedDefault, allowedProd] = await Promise.all([
      callTool(server, "iris_database_manage", { action: "delete", name: "X" }),
      callTool(server, "iris_database_manage", {
        server: "prod",
        action: "delete",
        name: "X",
      }),
    ]);

    expect(deniedDefault.isError).toBe(true);
    expect(deniedDefault.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_database_manage:delete",
      server: "default",
    });

    expect(allowedProd.isError).toBeFalsy();
    expect(allowedProd.structuredContent).toEqual({ ok: true });

    // Only the prod (allowed) call reached the handler — the gate kept the two
    // calls' policy decisions independent despite interleaving.
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });
});

// ════════════════════════════════════════════════════════════════════
// A denied non-default call leaves NO cached client AND NO in-flight entry.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 (coverage) — denial establishes nothing (no client, no in-flight promise)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("denying a never-touched prod profile creates no client, no establishing entry, no prod fetch", async () => {
    setTwoProfileEnv();
    // Disable the NEW write everywhere; prod has never been touched.
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
    bootstrapSpy.mockClear();
    const callsBefore = env.fetchMock.mock.calls.length;

    const result = await callTool(server, "iris_new_write", {
      server: "prod",
      value: "x",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      server: "prod",
    });
    expect(handlerSpy).not.toHaveBeenCalled();

    // No client was created for prod (gate ran before getOrCreateClient).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const registry = (server as any).clients;
    expect(registry.has("prod")).toBe(false);
    // No in-flight establishment promise was registered for prod either — the
    // gate denied before the establishment path could cache one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const establishing = (server as any).establishing as Map<string, unknown>;
    expect(establishing.has("prod")).toBe(false);
    // No bootstrap, and not a single fetch to the prod host.
    expect(bootstrapSpy).not.toHaveBeenCalled();
    const prodFetches = env.fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes("prod.example.com"),
    );
    expect(prodFetches.length).toBe(0);
    // No net-new fetch of any kind for the denied call.
    expect(env.fetchMock.mock.calls.length).toBe(callsBefore);
  });
});

// ════════════════════════════════════════════════════════════════════
// Back-compat strengthening: a NEW *read* tool is enabled under empty config.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.4 (coverage) — back-compat: a NEW read action is enabled by the seed under empty config", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a new (non-baseline) read tool is allowed and its handler runs under empty IRIS_GOVERNANCE", async () => {
    setDefaultEnv();
    // No IRIS_GOVERNANCE (env.setup deletes it) → governanceConfig = {}.
    stageDefaultStartup(env.fetchMock);

    const toolName = "iris_brand_new_read";
    // Guard: this is genuinely NOT a baseline key, so the test proves the seed's
    // new-read branch (enabled) — not grandfathering.
    expect(GOVERNANCE_BASELINE.has(toolName)).toBe(false);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([makeNewReadTool(toolName, handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, toolName, { value: "x" });
    // Allowed by the seed (new read ⇒ enabled), no governance denial leaked.
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ ok: true });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  it("the matching new WRITE tool is seed-DISABLED under the same empty config (contrast)", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);

    const toolName = "iris_brand_new_write";
    expect(GOVERNANCE_BASELINE.has(toolName)).toBe(false);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "should not run" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWriteTool(toolName, handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, toolName, { value: "x" });
    // Same empty config, opposite outcome — proves the seed's read/write split is
    // what differentiates them (not the absence of governance config).
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: toolName,
      server: "default",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});
