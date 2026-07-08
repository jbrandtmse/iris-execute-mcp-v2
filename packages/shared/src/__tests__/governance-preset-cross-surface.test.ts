/**
 * Story 24.1 — QA cross-surface integration seams for `IRIS_GOVERNANCE_PRESET`
 * (spec 02 §2.2/§2.3), added ALONGSIDE `governance-preset.test.ts` (the dev's
 * capstones for AC 24.1.1/24.1.2/24.1.3/24.1.4).
 *
 * This file does NOT re-implement the two full-universe capstones or the pure
 * `presetSeed`/`effective` mechanics — those are already covered exhaustively.
 * It targets the seams a per-AC unit test can miss because each AC was proven
 * in isolation:
 *
 * 1. **All-three-call-site agreement** — the `iris-governance://{profile}`
 *    resource, the `iris_server_profiles` discovery tool, and the call-time
 *    enforcement gate must all agree on the SAME key in the SAME test run. A
 *    missed `getEffectivePolicy`/`effective` call site (one of server-base.ts's
 *    three, per Dev Notes ~543/~894/~940) would let one surface silently drift
 *    from the other two — e.g. a tool reported "enabled" while the gate still
 *    blocks it. Rule #21: default suite, not `*.integration.test.ts`.
 * 2. **Per-profile agreement** — the same three-way check for a NON-default
 *    profile with an explicit profile-layer override, proving the resource
 *    template (`iris-governance://<profile>`) and per-profile discovery agree,
 *    not just the static default resource.
 * 3. **Startup fail-fast through the REAL `start()` path** — the dev's
 *    `parseGovernancePreset` unit tests pin the pure function; this proves the
 *    constructed server actually calls it during `start()`, that the rejection
 *    surfaces before any IRIS connection is attempted (no health check, no
 *    `process.exit`), and that the message names both valid values.
 * 4. **`full` == unset byte-for-byte AT THE CALL BOUNDARY** — the dev's tests
 *    prove `full` vs unset agree on the discovery-reported POLICY MAP; this
 *    proves the actual `CallToolResult` (denial/allow `structuredContent`) is
 *    IDENTICAL between the two states for both a write and a read tool.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import { BASELINE_ACTION_CLASSIFICATIONS } from "../baseline-classifications.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";
import type { ServerDiscoveryResult } from "../server-discovery.js";
import type { MutatesLookup } from "../governance.js";
import type { ToolDefinition } from "../tool-types.js";

// A successful, no-op bootstrap result (REST service already current) — same
// fixture used by governance-preset.test.ts / governance-cross-server.test.ts.
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

// ── Helpers (mirror governance-preset.test.ts / governance-cross-server.test.ts) ──

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

function makeServerOpts(tools: ToolDefinition[]): McpServerBaseOptions {
  return { name: "test-server", version: "1.0.0", tools, needsCustomRest: false };
}

/** A NEW single-op READ tool (scalar `mutates: "read"`) — seed-enabled. */
function makeReadTool(name: string): ToolDefinition {
  return {
    name,
    title: "Read",
    description: "A NEW single-op read action.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true },
    scope: "NONE",
    mutates: "read",
    handler: async () => ({
      content: [{ type: "text" as const, text: "read" }],
      structuredContent: { ok: true },
    }),
  };
}

/** A NEW single-op WRITE tool (scalar `mutates: "write"`) — seed-disabled, no F2 opt-in. */
function makeWriteTool(name: string): ToolDefinition {
  return {
    name,
    title: "Write",
    description: "A NEW single-op write action (seed-disabled).",
    inputSchema: z.object({ value: z.string().optional() }),
    annotations: { readOnlyHint: false },
    scope: "NONE",
    mutates: "write",
    handler: async () => ({
      content: [{ type: "text" as const, text: "wrote" }],
      structuredContent: { ok: true },
    }),
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

/** Invoke a request handler on the underlying Server by method name (resources/read etc). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function callRequest(server: any, method: string, params: unknown) {
  const innerServer = server.server.server;
  const handlers = innerServer._requestHandlers as Map<
    string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (req: any, extra: any) => Promise<any>
  >;
  const handler = handlers.get(method);
  if (!handler) throw new Error(`No request handler for "${method}"`);
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

/** Read a governance resource URI and parse its JSON policy body. */
async function readGovernancePolicy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any,
  uri: string,
): Promise<Record<string, boolean>> {
  const result = await callRequest(server, "resources/read", { uri });
  const contents = result.contents as Array<{ text: string }>;
  return JSON.parse(contents[0]!.text) as Record<string, boolean>;
}

/** Parse the discovery tool's structured result from a CallToolResult. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function discoveryOf(result: any): ServerDiscoveryResult {
  return result.structuredContent as ServerDiscoveryResult;
}

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
    IRIS_GOVERNANCE_PRESET: process.env.IRIS_GOVERNANCE_PRESET,
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
    delete process.env.IRIS_GOVERNANCE_PRESET;
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
    get exitMock() {
      return exitMock;
    },
  };
}

function stageDefaultStartup(fetchMock: ReturnType<typeof vi.fn>): void {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 })); // HEAD health check
  fetchMock.mockResolvedValueOnce(versionResponse()); // GET version negotiation
}

function setDefaultEnv(): void {
  process.env.IRIS_USERNAME = "u";
  process.env.IRIS_PASSWORD = "p";
  process.env.IRIS_HOST = "default.example.com";
  process.env.IRIS_NAMESPACE = "DEFAULTNS";
}

// ════════════════════════════════════════════════════════════════════
// (1) All-three-call-site agreement under read-only: resource, discovery,
//     and the actual call-time gate decision must all agree — for the
//     DEFAULT profile, over the FULL registered key universe.
// ════════════════════════════════════════════════════════════════════

describe("Cross-surface agreement (default profile) — resource, discovery, gate", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("the resource policy and the discovery policy are byte-for-byte identical, and the gate's actual call outcome matches both, under read-only", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeReadTool("iris_new_read"), makeWriteTool("iris_new_write")]),
    );
    await server.start("stdio");

    const resourcePolicy = await readGovernancePolicy(server, "iris-governance://default");
    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    const discoveryPolicy = discovery.governance.policy!;

    // Surface 1 vs Surface 2: the resource and the discovery tool must report
    // the IDENTICAL map — not just agree on a hand-picked key — over the full
    // registered key universe (baseline ∪ this server's own keys).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const governedKeys: Set<string> = (server as any).governedKeys;
    expect(governedKeys.size).toBeGreaterThan(GOVERNANCE_BASELINE.size);
    expect(resourcePolicy).toEqual(discoveryPolicy);

    // Surface 3: the actual call-time gate decision for our two registered
    // tools must match what both surfaces reported.
    expect(resourcePolicy["iris_new_write"]).toBe(false);
    expect(resourcePolicy["iris_new_read"]).toBe(true);

    const deniedWrite = await callTool(server, "iris_new_write", { value: "x" });
    expect(deniedWrite.isError).toBe(true);
    expect(deniedWrite.structuredContent.code).toBe("GOVERNANCE_DISABLED");

    const allowedRead = await callTool(server, "iris_new_read", {});
    expect(allowedRead.isError).toBeFalsy();
    expect(allowedRead.structuredContent).toEqual({ ok: true });

    // A gate-vs-surfaces drift would show up as: surface says enabled but the
    // call is denied (or vice versa). Assert the correspondence explicitly.
    expect(deniedWrite.isError).toBe(!resourcePolicy["iris_new_write"]);
    expect(allowedRead.isError ?? false).toBe(!resourcePolicy["iris_new_read"]);
  });

  it("also agree when no preset is set (back-compat pass-through) — same three-way check", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeReadTool("iris_new_read"), makeWriteTool("iris_new_write")]),
    );
    await server.start("stdio");

    const resourcePolicy = await readGovernancePolicy(server, "iris-governance://default");
    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(resourcePolicy).toEqual(discovery.governance.policy);

    // Unset preset: new write is seed-disabled (no F2 opt-in), new read is
    // seed-enabled — the ordinary D3 default seed, unaffected by presetSeed.
    expect(resourcePolicy["iris_new_write"]).toBe(false);
    expect(resourcePolicy["iris_new_read"]).toBe(true);

    const deniedWrite = await callTool(server, "iris_new_write", { value: "x" });
    expect(deniedWrite.isError).toBe(true);
    expect(
      Object.prototype.hasOwnProperty.call(deniedWrite.structuredContent, "presetApplied"),
    ).toBe(false);

    const allowedRead = await callTool(server, "iris_new_read", {});
    expect(allowedRead.isError).toBeFalsy();
  });
});

// ════════════════════════════════════════════════════════════════════
// (2) Per-profile cross-surface agreement: the resource TEMPLATE
//     (iris-governance://<profile>), per-profile discovery, and the gate
//     for a call routed via `server: "<profile>"` must all agree — proving
//     the template resource (not just the static default resource) and the
//     per-profile discovery output are both preset+override-aware.
// ════════════════════════════════════════════════════════════════════

describe("Cross-surface agreement (non-default profile, explicit override) — resource template, discovery, gate", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("prod's resource template, prod's discovery policy, and a denied prod call all agree; default's all agree on the opposite (global re-enable, profile re-disable)", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_new_write: true }, // re-enable globally under read-only
      profiles: { prod: { iris_new_write: false } }, // prod re-disables it
    });
    stageDefaultStartup(env.fetchMock); // only the default profile connects in start()
    const server = new McpServerBase(makeServerOpts([makeWriteTool("iris_new_write")]));
    await server.start("stdio");

    // ── prod: resource template + discovery + gate must all say "blocked" ──
    const prodResourcePolicy = await readGovernancePolicy(server, "iris-governance://prod");
    const prodDiscovery = discoveryOf(
      await callTool(server, SERVER_DISCOVERY_TOOL_NAME, { profile: "prod" }),
    );
    expect(prodResourcePolicy).toEqual(prodDiscovery.governance.policy);
    expect(prodResourcePolicy["iris_new_write"]).toBe(false);

    // The gate decision for a call ROUTED to prod (via the framework `server`
    // param) must match — and since the call is denied, the gate never
    // attempts to establish prod's connection (no extra fetch needed).
    const prodDenied = await callTool(server, "iris_new_write", {
      value: "x",
      server: "prod",
    });
    expect(prodDenied.isError).toBe(true);
    expect(prodDenied.structuredContent).toMatchObject({
      code: "GOVERNANCE_DISABLED",
      action: "iris_new_write",
      server: "prod",
    });
    // Denied by the EXPLICIT profile override, not the preset.
    expect(
      Object.prototype.hasOwnProperty.call(prodDenied.structuredContent, "presetApplied"),
    ).toBe(false);

    // ── default: resource + discovery + gate must all say "allowed" (global re-enable) ──
    const defaultResourcePolicy = await readGovernancePolicy(server, "iris-governance://default");
    const defaultDiscovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(defaultResourcePolicy).toEqual(defaultDiscovery.governance.policy);
    expect(defaultResourcePolicy["iris_new_write"]).toBe(true);

    const defaultAllowed = await callTool(server, "iris_new_write", { value: "x" });
    expect(defaultAllowed.isError).toBeFalsy();
    expect(defaultAllowed.structuredContent).toEqual({ ok: true });
  });
});

// ════════════════════════════════════════════════════════════════════
// (3) Startup fail-fast through the REAL start() path: the constructed
//     server actually invokes parseGovernancePreset() during start(), the
//     rejection happens BEFORE any IRIS connection is attempted, and the
//     message names both valid values.
// ════════════════════════════════════════════════════════════════════

describe("Startup fail-fast via the real McpServerBase.start() path (AC 24.1.3)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("rejects start() with a message naming IRIS_GOVERNANCE_PRESET and both valid values, before any fetch or process.exit", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read_only"; // typo: underscore, not hyphen
    const server = new McpServerBase(makeServerOpts([makeReadTool("iris_new_read")]));

    await expect(server.start("stdio")).rejects.toThrow(/IRIS_GOVERNANCE_PRESET/);
    await expect(
      new McpServerBase(makeServerOpts([makeReadTool("iris_new_read2")])).start("stdio"),
    ).rejects.toThrow(/read-only/);

    // No health check (and therefore no fetch) was ever attempted — the fail-fast
    // happens before the default profile's client is established, mirroring the
    // existing IRIS_GOVERNANCE / IRIS_PROFILES fail-fast timing.
    expect(env.fetchMock).not.toHaveBeenCalled();
    // The startup failure surfaces as a REJECTED PROMISE, not a `process.exit`
    // (that path is reserved for a failed health check, which never runs here).
    expect(env.exitMock).not.toHaveBeenCalled();
  });

  it("naming both valid values applies to the SAME thrown error (not two different assertions on two different throws)", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "readOnly";
    const server = new McpServerBase(makeServerOpts([makeReadTool("iris_new_read")]));

    let caught: Error | undefined;
    try {
      await server.start("stdio");
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).toBeDefined();
    expect(caught!.message).toMatch(/IRIS_GOVERNANCE_PRESET/);
    expect(caught!.message).toMatch(/read-only/);
    expect(caught!.message).toMatch(/full/);
    expect(env.fetchMock).not.toHaveBeenCalled();
  });
});

// ════════════════════════════════════════════════════════════════════
// (4) 'full' == unset byte-for-byte AT THE CALL BOUNDARY: the actual
//     CallToolResult (structuredContent) for both a denied write and an
//     allowed read must be IDENTICAL between unset and preset:"full".
// ════════════════════════════════════════════════════════════════════

describe("'full' preset is a byte-for-byte pass-through at the call-time gate (AC 24.1.3)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("a denied write's structuredContent and an allowed read's structuredContent are identical whether preset is unset or 'full'", async () => {
    // Server A: preset unset.
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const serverUnset = new McpServerBase(
      makeServerOpts([makeReadTool("iris_new_read"), makeWriteTool("iris_new_write")]),
    );
    await serverUnset.start("stdio");
    const unsetDenied = await callTool(serverUnset, "iris_new_write", { value: "x" });
    const unsetAllowed = await callTool(serverUnset, "iris_new_read", {});

    // Server B: preset explicitly "full", fresh env + fresh fetch staging.
    process.env.IRIS_GOVERNANCE_PRESET = "full";
    stageDefaultStartup(env.fetchMock);
    const serverFull = new McpServerBase(
      makeServerOpts([makeReadTool("iris_new_read"), makeWriteTool("iris_new_write")]),
    );
    await serverFull.start("stdio");
    const fullDenied = await callTool(serverFull, "iris_new_write", { value: "x" });
    const fullAllowed = await callTool(serverFull, "iris_new_read", {});

    // Both denials/allowances must be byte-for-byte identical — including the
    // ABSENCE of `presetApplied` on both (a 'full' preset must never attribute
    // a denial to itself, matching the unset case exactly).
    expect(fullDenied.structuredContent).toEqual(unsetDenied.structuredContent);
    expect(fullDenied.isError).toBe(unsetDenied.isError);
    expect(fullAllowed.structuredContent).toEqual(unsetAllowed.structuredContent);
    expect(fullAllowed.isError).toBe(unsetAllowed.isError);

    expect(
      Object.prototype.hasOwnProperty.call(fullDenied.structuredContent, "presetApplied"),
    ).toBe(false);
  });

  it("discovery's reported policy is identical between unset and 'full' for the full registered key universe (including a mutatesLookup-classified key)", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const serverUnset = new McpServerBase(
      makeServerOpts([makeReadTool("iris_new_read"), makeWriteTool("iris_new_write")]),
    );
    await serverUnset.start("stdio");
    const unsetPolicy = discoveryOf(
      await callTool(serverUnset, SERVER_DISCOVERY_TOOL_NAME, {}),
    ).governance.policy!;

    process.env.IRIS_GOVERNANCE_PRESET = "full";
    stageDefaultStartup(env.fetchMock);
    const serverFull = new McpServerBase(
      makeServerOpts([makeReadTool("iris_new_read"), makeWriteTool("iris_new_write")]),
    );
    await serverFull.start("stdio");
    const fullPolicy = discoveryOf(
      await callTool(serverFull, SERVER_DISCOVERY_TOOL_NAME, {}),
    ).governance.policy!;

    expect(fullPolicy).toEqual(unsetPolicy);

    // Sanity: this really covers non-baseline (mutatesLookup-classified) keys,
    // not just baseline ones — a regression that special-cased "full" for
    // baseline keys only would still pass a baseline-only comparison.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mutatesLookup: MutatesLookup = (serverUnset as any).mutatesLookup;
    expect(mutatesLookup.has("iris_new_write")).toBe(true);
    expect(unsetPolicy["iris_new_write"]).toBe(fullPolicy["iris_new_write"]);
    // And a real baseline key stays grandfathered-enabled under both.
    const sampleBaselineKey = [...GOVERNANCE_BASELINE][0]!;
    expect(BASELINE_ACTION_CLASSIFICATIONS[sampleBaselineKey]).toBeDefined();
    expect(unsetPolicy[sampleBaselineKey]).toBe(true);
    expect(fullPolicy[sampleBaselineKey]).toBe(true);
  });
});
