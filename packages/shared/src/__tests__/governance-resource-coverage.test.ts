/**
 * Story 14.5 — Governance Discovery Resource & `resources` capability:
 * COMPLEMENTARY automated coverage (QA stage).
 *
 * This file deliberately does NOT duplicate `governance-resource.test.ts`
 * (the dev's 10 tests). It fills the gaps that suite leaves, all driven through
 * the REAL MCP SDK resource surface (`resources/list`, `resources/templates/list`,
 * `resources/read`) on the underlying `Server`'s registered request handlers,
 * with mocked `fetch` (no live IRIS):
 *
 *   1. resources/read of `iris-governance://{profile}` for a profile WITH an
 *      override that CASCADES over a global override — full-map cross-check vs
 *      `getEffectivePolicy("<that profile>")` (the dev's prod test only
 *      spot-checks one key, and does not exercise the global∩profile cascade).
 *   2. Per-key polarity in ONE map: a write-disabled key reads `false` while a
 *      read key reads `true`, in the same resource read.
 *   3. resources/list EXACT shape — uri + name + mimeType, and that the static
 *      governance resource is the ONLY governance entry in `resources/list`
 *      (the template does not leak into the static list).
 *   4. Unknown-profile read → the error is a structured `McpError` with code
 *      `InvalidParams` (-32602) — not merely a message match, and not a crash.
 *   5. A malformed `iris-governance://` URI (NO profile / empty authority) →
 *      clean structured rejection (the SDK matches neither the static resource
 *      nor the `{profile}` template), and the server stays usable afterwards.
 *   6. `governedKeys` union: a NEW single-op READ tool's bare key appears in the
 *      effective map enabled, AND the full baseline is still present alongside it.
 *   7. Dynamic tool set: after `addTools` of a governed tool the resource map
 *      gains its key (governedKeys rebuilt); after `removeTools` the key drops
 *      again while baseline keys persist.
 *
 * Harness mirrors `governance-resource.test.ts`: mocked `bootstrap`, a `fetchMock`
 * staging the default profile's startup HEAD (health) + GET (version), hermetic
 * env save/restore. Plain `*.test.ts` → runs in the DEFAULT `vitest run`
 * (the `*.integration.test.ts` suffix the vitest config excludes is reserved for
 * live-IRIS tests). TypeScript-only — no `BOOTSTRAP_VERSION` impact.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import type { BootstrapResult } from "../bootstrap.js";
// Import governance ENGINE values from their direct modules (not the `../index.js`
// barrel): the barrel transitively re-exports `server-base.js` → `bootstrap.js`,
// which would be evaluated during the hoisted `vi.mock` factory below — before
// `bootstrapSpy` is initialised. `governance.js` / `governance-baseline.js` have
// no such dependency, so importing from them directly is safe.
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import {
  getEffectivePolicy,
  parseGovernanceConfig,
  buildMutatesLookup,
} from "../governance.js";
import type { ToolDefinition } from "../tool-types.js";

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

const bootstrapSpy = vi.fn(async () => okBootstrap);
vi.mock("../bootstrap.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../bootstrap.js")>();
  return { ...actual, bootstrap: bootstrapSpy };
});

// Import AFTER vi.mock so server-base picks up the mocked bootstrap.
const { McpServerBase } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;

// ── Helpers ─────────────────────────────────────────────────────────

const GOV_DEFAULT_URI = "iris-governance://default";
const GOV_TEMPLATE_URI = "iris-governance://{profile}";

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
  return { name: "test-server", version: "1.0.0", tools, needsCustomRest };
}

/** A read echo tool with NO `mutates` — a grandfathered action. */
function makeEchoTool(name: string): ToolDefinition {
  return {
    name,
    title: "Echo",
    description: "Echo the resolved namespace.",
    inputSchema: z.object({ namespace: z.string().optional() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    handler: async (args, ctx) => {
      const a = args as Record<string, unknown>;
      const ns = ctx.resolveNamespace(a.namespace as string | undefined);
      return {
        content: [{ type: "text" as const, text: `ns=${ns}` }],
        structuredContent: { ns },
      };
    },
  };
}

/** A NEW single-op READ tool (scalar `mutates:"read"`) — seed-ENABLED (new read). */
function makeReadTool(name: string): ToolDefinition {
  return {
    name,
    title: "Governed read",
    description: "A NEW single-op read action (seed-enabled).",
    inputSchema: z.object({ q: z.string().optional() }),
    annotations: { readOnlyHint: true },
    scope: "NS",
    mutates: "read",
    handler: async () => ({
      content: [{ type: "text" as const, text: "read" }],
      structuredContent: { ok: true },
    }),
  };
}

/** A NEW single-op WRITE tool (scalar `mutates:"write"`) — seed-disabled. */
function makeWriteTool(name: string): ToolDefinition {
  return {
    name,
    title: "Governed write",
    description: "A NEW single-op write action (seed-disabled).",
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: false },
    scope: "NS",
    mutates: "write",
    handler: async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }),
  };
}

/**
 * Invoke a request handler registered on the underlying `Server` by method name
 * (e.g. "resources/read"). Drives the REAL SDK dispatch — including URI→template
 * matching for "resources/read" — exactly as a connected client would.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: any, method: string, params: unknown) {
  // server (McpServerBase) → .server (McpServer) → .server (Server).
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
  // Minimal RequestHandlerExtra stub — the governance resource callbacks ignore it.
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

/** Extract the first content block's text from a ReadResourceResult (strict-safe). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function firstContentText(result: any): string {
  const contents = result.contents as Array<{ text: string }>;
  const first = contents[0];
  if (!first) throw new Error("resources/read returned no contents");
  return first.text;
}

/** Parse the first content block of a ReadResourceResult as the policy map. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readPolicy(result: any): Record<string, boolean> {
  return JSON.parse(firstContentText(result)) as Record<string, boolean>;
}

/** Shared environment save/restore for hermetic runs. */
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

  return {
    setup,
    teardown,
    get fetchMock() {
      return fetchMock;
    },
  };
}

function stageDefaultStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }));
  fetchMock.mockResolvedValueOnce(versionResponse());
}

function setDefaultEnv(): void {
  process.env.IRIS_USERNAME = "u";
  process.env.IRIS_PASSWORD = "p";
  process.env.IRIS_HOST = "default.example.com";
  process.env.IRIS_NAMESPACE = "DEFAULTNS";
}

// ════════════════════════════════════════════════════════════════════
// 1. Per-profile read with the global∩profile cascade — full-map cross-check.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — per-profile read reflects the global+profile cascade (AC 14.5.3, full map)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a profile read = getEffectivePolicy(THAT profile): profile override layers over a different global override", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      stage: { host: "stage.example.com", namespace: "STAGENS" },
    });
    // Global disables a grandfathered read for EVERY profile; the stage profile
    // additionally re-enables a NEW write that is seed-disabled. The two layers
    // touch DIFFERENT keys, so the stage map must reflect BOTH simultaneously —
    // exercising the cascade the dev's single-key prod test does not.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
      profiles: { stage: { iris_new_write: true } },
    });
    stageDefaultStartup(env.fetchMock);

    const tools = [makeEchoTool("iris_doc_get"), makeWriteTool("iris_new_write")];
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    const stageResult = await callRequest(server, "resources/read", {
      uri: "iris-governance://stage",
    });
    const stagePolicy = readPolicy(stageResult);

    // Global override wins on iris_doc_get (no stage-specific override for it)…
    expect(stagePolicy.iris_doc_get).toBe(false);
    // …and the stage profile override flips the seed-disabled write to enabled.
    expect(stagePolicy.iris_new_write).toBe(true);

    // Full-map equivalence: the ENTIRE stage map equals getEffectivePolicy for
    // the SAME profile/config/keys — not just the two probed keys.
    const allKeys = new Set<string>(GOVERNANCE_BASELINE);
    allKeys.add("iris_new_write");
    const expected = getEffectivePolicy(
      "stage",
      parseGovernanceConfig({ IRIS_GOVERNANCE: process.env.IRIS_GOVERNANCE }),
      allKeys,
      buildMutatesLookup(tools),
    );
    expect(stagePolicy).toEqual(expected);

    // And the SAME server's default-profile map differs (the stage override is
    // not visible to default) — proving the read is genuinely per-profile.
    const defResult = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    const defPolicy = readPolicy(defResult);
    expect(defPolicy.iris_new_write).toBe(false); // default: still seed-disabled
    expect(defPolicy.iris_doc_get).toBe(false); // global override still applies
    expect(defPolicy).not.toEqual(stagePolicy);
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. Per-key polarity in a single write-disabled map: write false, read true.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — a write-disabled config shows that key false while reads stay true (AC 14.5.3)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("one resource read carries both polarities: the disabled write is false, a read action is true", async () => {
    setDefaultEnv();
    // Disable ONE write globally; leave reads alone.
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_governed_write: false },
    });
    stageDefaultStartup(env.fetchMock);

    const tools = [
      makeReadTool("iris_governed_read"),
      makeWriteTool("iris_governed_write"),
    ];
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    const result = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    const policy = readPolicy(result);

    // Disabled write → false in the very same map where…
    expect(policy.iris_governed_write).toBe(false);
    // …the new read action → true. (Mixed polarity within one read.)
    expect(policy.iris_governed_read).toBe(true);
    // And a representative grandfathered read is also true (untouched).
    expect(policy.iris_database_list).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. resources/list exact shape — uri + name + mimeType, single gov entry.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — resources/list and templates/list exact shapes (AC 14.5.2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("the static governance resource is the ONLY governance entry in resources/list, with uri+name+mimeType", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const result = await callRequest(server, "resources/list", {});
    const resources = result.resources as Array<{
      uri: string;
      name: string;
      mimeType?: string;
    }>;

    const govEntries = resources.filter((r) =>
      r.uri.startsWith("iris-governance://"),
    );
    // Exactly one STATIC governance resource is listed; the {profile} TEMPLATE
    // must NOT appear in the static list (it belongs to templates/list).
    expect(govEntries).toHaveLength(1);
    const entry = govEntries[0];
    if (!entry) throw new Error("expected the static governance resource");
    expect(entry.uri).toBe(GOV_DEFAULT_URI);
    expect(entry.name).toBe("iris-governance-default");
    expect(entry.mimeType).toBe("application/json");
    // The template URI (with the {profile} placeholder) is not a static entry.
    expect(resources.some((r) => r.uri === GOV_TEMPLATE_URI)).toBe(false);
  });

  it("templates/list carries exactly one governance template with name + uriTemplate + mimeType", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const result = await callRequest(server, "resources/templates/list", {});
    const templates = result.resourceTemplates as Array<{
      name: string;
      uriTemplate: string;
      mimeType?: string;
    }>;
    const govTemplates = templates.filter((t) =>
      t.uriTemplate.startsWith("iris-governance://"),
    );
    expect(govTemplates).toHaveLength(1);
    const tmpl = govTemplates[0];
    if (!tmpl) throw new Error("expected the governance template");
    expect(tmpl.uriTemplate).toBe(GOV_TEMPLATE_URI);
    expect(tmpl.name).toBe("iris-governance-profile");
    expect(tmpl.mimeType).toBe("application/json");
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. Unknown-profile read → McpError with code InvalidParams (not just text).
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — unknown-profile read surfaces McpError(InvalidParams) (AC 14.5.3)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("the rejection is an McpError whose code is InvalidParams (-32602), carrying the bad profile name", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com" },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    // Capture the thrown error to assert its STRUCTURE (instance + code), not
    // just a message regex (the dev's test asserts the message only).
    let caught: unknown;
    try {
      await callRequest(server, "resources/read", {
        uri: "iris-governance://ghost",
      });
    } catch (e: unknown) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);
    expect((caught as McpError).code).toBe(-32602);
    expect((caught as McpError).message).toMatch(/ghost/);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. Malformed `iris-governance://` (no profile) → clean rejection, no crash.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — a malformed iris-governance:// URI (no profile) is a clean error (AC 14.5.3)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("read of iris-governance:// (empty authority) rejects with McpError(InvalidParams); the server stays usable", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    // `iris-governance://` matches NEITHER the static `iris-governance://default`
    // resource NOR the `{profile}` template (the SDK UriTemplate yields no match
    // for an empty authority), so the SDK's own read dispatch raises a structured
    // "Resource ... not found" McpError(InvalidParams) — a clean error, not a crash.
    let caught: unknown;
    try {
      await callRequest(server, "resources/read", {
        uri: "iris-governance://",
      });
    } catch (e: unknown) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(McpError);
    expect((caught as McpError).code).toBe(ErrorCode.InvalidParams);

    // Server still healthy: a subsequent valid default read returns the map.
    const ok = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    expect((ok.contents as unknown[]).length).toBe(1);
    const policy = readPolicy(ok);
    expect(policy.iris_database_list).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. governedKeys union: a NEW single-op read tool's BARE key + full baseline.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — governedKeys union includes a registered single-op tool key + the full baseline (D4/D6)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a NEW single-op tool contributes its BARE name to the map, alongside every baseline key", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);

    const tools = [makeReadTool("iris_brand_new_read")];
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    const result = await callRequest(server, "resources/read", {
      uri: GOV_DEFAULT_URI,
    });
    const policy = readPolicy(result);

    // The new single-op tool's BARE key is present (no `:action` suffix) and,
    // being a NEW read, enabled by seed.
    expect("iris_brand_new_read" in policy).toBe(true);
    expect(policy.iris_brand_new_read).toBe(true);
    // No spurious `tool:action` key for a tool with no action enum.
    expect(
      Object.keys(policy).some((k) => k.startsWith("iris_brand_new_read:")),
    ).toBe(false);

    // The union still reports on the COMPLETE baseline — every baseline key is a
    // key in the effective map (the resource gives a suite-wide policy view).
    for (const key of GOVERNANCE_BASELINE) {
      expect(key in policy).toBe(true);
    }
    // The map size is baseline ∪ {the one new key} (the new key is not already
    // in the baseline, so it adds exactly one).
    expect(GOVERNANCE_BASELINE.has("iris_brand_new_read")).toBe(false);
    expect(Object.keys(policy).length).toBe(GOVERNANCE_BASELINE.size + 1);
  });
});

// ════════════════════════════════════════════════════════════════════
// 7. Dynamic tool set: governedKeys rebuilt on addTools / removeTools.
// ════════════════════════════════════════════════════════════════════

describe("Story 14.5 — the resource map tracks dynamic tool changes (governedKeys rebuilt) (D6)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("after addTools(governed) the read includes the new key; after removeTools it drops, baseline intact", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);

    // Start with no extra tools — the dynamically-added one is absent at first.
    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await server.start("stdio");

    const before = readPolicy(
      await callRequest(server, "resources/read", { uri: GOV_DEFAULT_URI }),
    );
    expect("iris_added_write" in before).toBe(false);

    // Add a governed write at runtime → governedKeys must rebuild (the seam the
    // dev's tests never exercise via the resource).
    server.addTools([makeWriteTool("iris_added_write")]);

    const afterAdd = readPolicy(
      await callRequest(server, "resources/read", { uri: GOV_DEFAULT_URI }),
    );
    expect("iris_added_write" in afterAdd).toBe(true);
    // New write, no override → seed-disabled → false.
    expect(afterAdd.iris_added_write).toBe(false);

    // Remove it again → the key drops back out, but baseline keys persist.
    server.removeTools(["iris_added_write"]);

    const afterRemove = readPolicy(
      await callRequest(server, "resources/read", { uri: GOV_DEFAULT_URI }),
    );
    expect("iris_added_write" in afterRemove).toBe(false);
    // Baseline is unaffected by removing a NON-baseline tool.
    expect(afterRemove.iris_database_list).toBe(true);
    expect(Object.keys(afterRemove)).toEqual(Object.keys(before));
  });
});
