/**
 * Story 15.0 — Governance action-classification hardening: END-TO-END coverage.
 *
 * The dev's `governance-edge.test.ts` and `server-base.test.ts` prove the Story
 * 15.0 pieces in ISOLATION — the `unwrapActionOptions` helper, the standalone
 * `assertGovernanceClassification`, `buildMutatesLookup` validation, and the
 * generator-guard logic (replicated on synthetic shapes). What no existing test
 * does is drive a WRAPPED action enum (`.optional()` / `.default()` /
 * `.nullable()`) through a REAL {@link McpServerBase} from registration all the
 * way to the call-time governance gate and the advisory resource — the actual
 * fail-open path Story 15.0 closes (`computeGovernanceKey` /
 * `rebuildGovernedKeys`, not a synthetic `deriveKeys` replica). And no test
 * fires the registration assertion through a real server construction with a
 * realistic, write-shaped (Story-15.1-style) unclassified fixture.
 *
 * This file COMPLEMENTS (does not duplicate) the dev's suites by exercising the
 * real public surfaces a consumer touches:
 *
 *   1. AC 15.0.1 — a wrapped (`.optional()`/`.default()`/`.nullable()`) action
 *      enum, registered on a live server, produces per-`tool:action` governance
 *      keys at the GATE: a per-action `false` policy DENIES exactly the named
 *      action and ALLOWS its sibling. Before the fix the gate collapsed to the
 *      bare key and the per-action deny never matched (fail-open) — proven here
 *      through the SDK callback, the same path a connected client drives.
 *   2. AC 15.0.1 — the SAME wrapped enum flows through `rebuildGovernedKeys` to
 *      the advisory `iris-governance://{profile}` resource: `resources/read`
 *      reports the per-action keys (with the per-action policy applied) and NOT
 *      the bare-tool key. Gate and resource therefore agree (lock-step).
 *   3. AC 15.0.2 — when the wrapped/optional action is ABSENT at call time, the
 *      gate falls back to the BARE-tool key, never building `tool:undefined`.
 *   4. AC 15.0.3 — the registration assertion FIRES through real
 *      `new McpServerBase(...)` construction (and `addTools`) for a realistic
 *      unclassified WRITE multi-action tool (the Story-15.1 shape), and is
 *      DORMANT for a correctly-classified one — the forward-looking safety net.
 *
 * Provable WITHOUT a live IRIS server (vitest + mocked fetch + bootstrap spy).
 * Discoverable by the default `vitest run` suite (`*.test.ts`, NOT
 * `*.integration.test.ts`, which the vitest config excludes). All fixtures are
 * SYNTHETIC and non-baseline (and so declare `mutates` per AC 15.0.3); none is
 * enumerated by the generator, so the 141-key baseline / hash is untouched.
 * TypeScript-only — no `BOOTSTRAP_VERSION` impact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";

// A successful, no-op bootstrap result (REST service already current). Mirrors
// the shape used across the profile / enforcement / resource suites.
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

// ── Helpers ─────────────────────────────────────────────────────────

/** Atelier version-negotiation response body (major 8 — matches the dev suites). */
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
  return { name: "test-server", version: "1.0.0", tools, needsCustomRest };
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
 * Invoke a request handler registered on the underlying `Server` by method name
 * (e.g. "resources/read"). Drives the REAL SDK dispatch — including URI→template
 * matching — exactly as a connected client would. Mirrors the helper in
 * `governance-resource.test.ts`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: any, method: string, params: unknown) {
  const innerServer = server.server.server;
  const handlers = innerServer._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get(method);
  if (!handler) {
    throw new Error(`No request handler registered for "${method}"`);
  }
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

/** Parse the first content block of a ReadResourceResult as the policy map. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readPolicy(result: any): Record<string, boolean> {
  const contents = result.contents as Array<{ text: string }>;
  const first = contents[0];
  if (!first) throw new Error("resources/read returned no contents");
  return JSON.parse(first.text) as Record<string, boolean>;
}

/**
 * A multi-action governed tool whose `action` enum is WRAPPED by one of
 * `.optional()` / `.default()` / `.nullable()` — the exact shape Story 15.0
 * hardens against. `read` is classified read, `wipe` is classified write, so the
 * tool satisfies the AC 15.0.3 registration assertion (every non-baseline
 * tool/action key declares `mutates`). Synthetic name + actions → NOT in the
 * generated baseline, so the per-action policy is what governs them.
 */
function makeWrappedActionTool(
  wrapper: "optional" | "default" | "nullable",
  handlerSpy: ReturnType<typeof vi.fn>,
  name = "iris_wrapped_manage",
): ToolDefinition {
  const bare = z.enum(["read", "wipe"]).describe("Operation");
  const action =
    wrapper === "optional"
      ? bare.optional()
      : wrapper === "default"
        ? bare.default("read")
        : bare.nullable();
  return {
    name,
    title: "Wrapped multi-action (synthetic)",
    description: "A NEW multi-action tool whose action enum is wrapped.",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: z.object({ action, name: z.string().optional() }) as any,
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: { read: "read", wipe: "write" },
    handler: handlerSpy,
  };
}

/** Shared environment save/restore for hermetic runs (no env leak across suites). */
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
// AC 15.0.1 — a WRAPPED action enum yields per-`tool:action` keys at the GATE
// of a real server. The pre-fix bug collapsed it to the bare key, so a
// per-action deny silently never matched. Each wrapper is driven end-to-end.
// ════════════════════════════════════════════════════════════════════

describe("Story 15.0 — wrapped action enum governs per-action through the live gate", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  // Run the SAME end-to-end assertion for all three Zod wrappers so a regression
  // in any single peel path (optional / default / nullable) is caught.
  const wrappers: Array<"optional" | "default" | "nullable"> = [
    "optional",
    "default",
    "nullable",
  ];

  it.each(wrappers)(
    "a `.%s()`-wrapped action enum: a per-action `wipe:false` denies wipe and allows read",
    async (wrapper) => {
      setDefaultEnv();
      // Disable EXACTLY the per-action key. If the gate collapsed a wrapped enum
      // to the bare `iris_wrapped_manage` key (the pre-fix bug), this per-action
      // override would never match → `wipe` would be (wrongly) allowed.
      process.env.IRIS_GOVERNANCE = JSON.stringify({
        global: { "iris_wrapped_manage:wipe": false },
      });
      stageDefaultStartup(env.fetchMock);

      const handlerSpy = vi.fn(async () => ({
        content: [{ type: "text" as const, text: "ran" }],
        structuredContent: { ok: true },
      }));
      const server = new McpServerBase(
        makeServerOpts([makeWrappedActionTool(wrapper, handlerSpy)]),
      );
      await server.start("stdio");

      // `wipe` is the disabled per-action key → DENIED with the per-action key in
      // the structured denial (proving the gate computed `tool:action`, not the
      // bare key).
      const denied = await callTool(server, "iris_wrapped_manage", {
        action: "wipe",
        name: "X",
      });
      expect(denied.isError).toBe(true);
      expect(denied.structuredContent).toEqual({
        code: "GOVERNANCE_DISABLED",
        action: "iris_wrapped_manage:wipe",
        server: "default",
      });
      expect(handlerSpy).not.toHaveBeenCalled();

      // The SIBLING action `read` is NOT disabled → ALLOWED, handler runs. This
      // is what proves the deny was per-action (not a whole-tool block).
      const allowed = await callTool(server, "iris_wrapped_manage", {
        action: "read",
        name: "X",
      });
      expect(allowed.isError).toBeFalsy();
      expect(allowed.structuredContent).toEqual({ ok: true });
      expect(handlerSpy).toHaveBeenCalledTimes(1);
    },
  );

  it("a bare-tool `false` does NOT match a wrapped multi-action tool (no accidental whole-tool block)", async () => {
    // The flip side of the lock-step: disabling the BARE key must NOT deny a
    // wrapped multi-action call, because the gate's key is `tool:action`. If the
    // gate wrongly collapsed to the bare key, this would deny — and the test
    // would fail. So this pins that the wrapped enum is NOT seen as single-op.
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_wrapped_manage: false }, // bare key — should be inert here
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWrappedActionTool("optional", handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_wrapped_manage", {
      action: "wipe",
      name: "X",
    });
    // wipe is a NEW write (seed-disabled by default) BUT the bare-key override is
    // irrelevant to the per-action key, so the seed still governs: wipe defaults
    // DISABLED. The denial must therefore carry the per-action key (not be a
    // whole-tool block keyed on the bare name).
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_wrapped_manage:wipe",
      server: "default",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 15.0.1 — the SAME wrapped enum flows to the advisory resource: the
// per-profile policy map reports per-action keys (with the per-action policy
// applied) and NOT the bare-tool key. Gate and resource agree (lock-step).
// ════════════════════════════════════════════════════════════════════

describe("Story 15.0 — wrapped action enum surfaces per-action keys in the advisory resource", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("resources/read reports `tool:read`/`tool:wipe` (policy applied) and no bare `tool` key", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_wrapped_manage:wipe": false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn();
    const server = new McpServerBase(
      makeServerOpts([makeWrappedActionTool("default", handlerSpy)]),
    );
    await server.start("stdio");

    // Drive the REAL SDK resources/read dispatch (URI→template match included).
    const result = await callRequest(server, "resources/read", {
      uri: "iris-governance://default",
    });
    const policy = readPolicy(result);

    // Per-action keys are present and reflect the policy: read enabled, wipe
    // disabled (global false). The bare-tool key must be ABSENT — the wrapped
    // enum was correctly peeled to per-action keys by rebuildGovernedKeys.
    expect(policy["iris_wrapped_manage:read"]).toBe(true);
    expect(policy["iris_wrapped_manage:wipe"]).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(policy, "iris_wrapped_manage"),
    ).toBe(false);
  });

  it("the resource policy and the gate decision agree for the same wrapped action (lock-step)", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_wrapped_manage:wipe": false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWrappedActionTool("nullable", handlerSpy)]),
    );
    await server.start("stdio");

    // Resource says wipe is disabled…
    const policy = readPolicy(
      await callRequest(server, "resources/read", {
        uri: "iris-governance://default",
      }),
    );
    expect(policy["iris_wrapped_manage:wipe"]).toBe(false);

    // …and the gate agrees: the actual wipe call is denied (same key).
    const denied = await callTool(server, "iris_wrapped_manage", {
      action: "wipe",
      name: "X",
    });
    expect(denied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_wrapped_manage:wipe",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 15.0.2 — undefined-action guard through the live gate: a wrapped/optional
// action absent at call time falls back to the BARE-tool key; `tool:undefined`
// is never built.
// ════════════════════════════════════════════════════════════════════

describe("Story 15.0 — absent wrapped action falls back to the bare-tool key (no tool:undefined)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("an `.optional()` action omitted at call time → bare-tool key governs (never `tool:undefined`)", async () => {
    setDefaultEnv();
    // Disable the BARE key. With the action omitted, the gate must fall back to
    // the bare key (AC 15.0.2) and therefore DENY here — and the denial must
    // carry the bare name, never the literal `iris_wrapped_manage:undefined`.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_wrapped_manage: false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWrappedActionTool("optional", handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_wrapped_manage", { name: "X" });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_wrapped_manage", // bare key — NOT `:undefined`
      server: "default",
    });
    // Belt-and-braces: the never-matching literal key was not built.
    expect(
      (result.structuredContent as { action: string }).action,
    ).not.toContain("undefined");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("the same tool WITH the action present still keys on `tool:action` (guard is action-presence only)", async () => {
    setDefaultEnv();
    // Disable the bare key only; the per-action `read` is NOT disabled. Sending
    // action=read must be ALLOWED — proving the bare-key fallback applies ONLY
    // when the action is absent, not whenever the bare key has a policy entry.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_wrapped_manage: false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWrappedActionTool("optional", handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_wrapped_manage", {
      action: "read",
      name: "X",
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({ ok: true });
    expect(handlerSpy).toHaveBeenCalledTimes(1);
  });

  // ── CR 15.0 regression — `.nullable()` enum, action: null → bare-key fallback ──
  //
  // The AC 15.0.2 guard originally tested `action !== undefined`, which let a
  // `.nullable()` action enum's explicit `null` build the never-matching key
  // `iris_wrapped_manage:null`. That key is in neither the per-action `mutates`
  // lookup nor the generated baseline, so it resolved through the seed → ENABLED,
  // silently BYPASSING any per-action `wipe:false` deny an operator wrote. The fix
  // composes `tool:action` only when the action is an actual enum member, so a
  // null action now falls back to the bare-tool key (the same as an absent one).
  it("a `.nullable()` action explicitly set to `null` → bare-tool key governs (never `tool:null`, no per-action bypass)", async () => {
    setDefaultEnv();
    // Disable the BARE key. Under the pre-fix bug, action:null built `tool:null`
    // which dodged this policy entirely → the call would (wrongly) be ALLOWED.
    // With the fix, action:null falls back to the bare key → DENIED here, and the
    // denial carries the bare name, never `iris_wrapped_manage:null`.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_wrapped_manage: false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWrappedActionTool("nullable", handlerSpy)]),
    );
    await server.start("stdio");

    const result = await callTool(server, "iris_wrapped_manage", {
      action: null,
      name: "X",
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_wrapped_manage", // bare key — NOT `:null`
      server: "default",
    });
    expect(
      (result.structuredContent as { action: string }).action,
    ).not.toContain("null");
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("a `.nullable()` action set to `null` does NOT bypass a per-action `wipe:false` deny", async () => {
    setDefaultEnv();
    // Operator denies the per-action `wipe`. A null action must NOT be a way to
    // sneak past it: null is not the `wipe` enum member, so it falls back to the
    // bare key (here seed-enabled, no bare policy) — the point is the null call is
    // NOT silently keyed on a phantom `:null` action that escapes governance.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { "iris_wrapped_manage:wipe": false },
    });
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }));
    const server = new McpServerBase(
      makeServerOpts([makeWrappedActionTool("nullable", handlerSpy)]),
    );
    await server.start("stdio");

    // A null action resolves to the bare key (seed-enabled), so it is allowed —
    // but it is the BARE key that governs, proving no `:null` per-action key was
    // built. The genuine `wipe` deny is unaffected and still blocks `action:wipe`.
    const nullCall = await callTool(server, "iris_wrapped_manage", {
      action: null,
      name: "X",
    });
    expect(nullCall.isError).toBeFalsy();

    const wipeCall = await callTool(server, "iris_wrapped_manage", {
      action: "wipe",
      name: "X",
    });
    expect(wipeCall.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_wrapped_manage:wipe",
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 15.0.3 — the registration assertion fires through REAL server construction
// for a realistic, write-shaped (Story-15.1-style) unclassified multi-action
// tool, and is dormant for a correctly-classified one.
// ════════════════════════════════════════════════════════════════════

describe("Story 15.0 — registration assertion fires for a realistic unclassified write tool", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  /**
   * The Story-15.1 shape: a NEW multi-action write tool (`create`/`delete`) that
   * looks exactly like `iris_service_manage` would — but FORGETS `mutates`. The
   * registration assertion must reject it (naming the offending per-action keys),
   * because an unclassified write would otherwise default to read ⇒ enabled.
   */
  function makeUnclassifiedWriteManager(name = "iris_service_manage"): ToolDefinition {
    return {
      name,
      title: "Service manage (synthetic, unclassified)",
      description: "A NEW write tool that forgot to declare `mutates`.",
      inputSchema: z.object({
        action: z.enum(["create", "delete"]).describe("Operation"),
        service: z.string().describe("Service name"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
      scope: "NS",
      // NOTE: `mutates` intentionally OMITTED — this is the developer mistake the
      // assertion catches.
      handler: async () => ({
        content: [{ type: "text" as const, text: "ran" }],
      }),
    };
  }

  it("THROWS at construction, naming the unclassified per-action key(s)", () => {
    expect(() => new McpServerBase(makeServerOpts([makeUnclassifiedWriteManager()]))).toThrow(
      /iris_service_manage:create|iris_service_manage:delete/,
    );
  });

  it("the thrown error lists BOTH unclassified actions (each per-action key is enumerated)", () => {
    let message = "";
    try {
      new McpServerBase(makeServerOpts([makeUnclassifiedWriteManager()]));
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toContain("iris_service_manage:create");
    expect(message).toContain("iris_service_manage:delete");
  });

  it("does NOT throw once the same tool declares per-action `mutates` (the fix)", () => {
    const classified: ToolDefinition = {
      ...makeUnclassifiedWriteManager(),
      mutates: { create: "write", delete: "write" },
    };
    expect(() => new McpServerBase(makeServerOpts([classified]))).not.toThrow();
  });

  it("THROWS even when only ONE of several actions is left unclassified (partial mutates map)", () => {
    // A per-action map that classifies `create` but FORGETS `delete`. The
    // assertion must still fire for the missing `delete` key — partial coverage
    // is not enough.
    const partiallyClassified: ToolDefinition = {
      ...makeUnclassifiedWriteManager(),
      mutates: { create: "write" }, // delete missing
    };
    expect(() => new McpServerBase(makeServerOpts([partiallyClassified]))).toThrow(
      /iris_service_manage:delete/,
    );
    // And it must NOT spuriously name the classified action.
    let message = "";
    try {
      new McpServerBase(makeServerOpts([partiallyClassified]));
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).not.toContain("iris_service_manage:create");
  });

  it("THROWS via addTools() for a dynamically-added unclassified write manager", () => {
    // The default-only server constructs fine (no tools); adding the unclassified
    // write tool at runtime must trip the same assertion.
    const server = new McpServerBase(makeServerOpts([]));
    expect(() =>
      server.addTools([makeUnclassifiedWriteManager("iris_added_unclassified_manage")]),
    ).toThrow(/iris_added_unclassified_manage:(create|delete)/);
  });

  it("a classified write manager registers cleanly and is then governed (seed-disabled) at the gate", async () => {
    // End-to-end closure: a correctly-classified NEW write manager registers
    // cleanly AND its write actions default DISABLED at the live gate (no
    // IRIS_GOVERNANCE needed) — the seed safety net the classification feeds.
    // Registered at construction (the SDK forbids registerTool/capabilities after
    // the transport connects, so addTools-after-start is out of scope here; the
    // addTools assertion path is covered by the throwing case above).
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);

    const handlerSpy = vi.fn(async () => ({
      content: [{ type: "text" as const, text: "ran" }],
    }));
    const classified: ToolDefinition = {
      ...makeUnclassifiedWriteManager("iris_classified_manage"),
      mutates: { create: "write", delete: "write" },
      handler: handlerSpy,
    };
    // Construction must not throw (it is classified) — the positive control for
    // the assertion firing on the unclassified variants above.
    const server = new McpServerBase(makeServerOpts([classified]));
    await server.start("stdio");

    const result = await callTool(server, "iris_classified_manage", {
      action: "create",
      service: "Svc",
    });
    // NEW write, not in baseline, no enabling policy → seed-disabled at the gate.
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_classified_manage:create",
      server: "default",
    });
    expect(handlerSpy).not.toHaveBeenCalled();
  });
});
