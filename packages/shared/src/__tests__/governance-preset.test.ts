/**
 * Story 24.1 — Governance Safety Preset Engine & Surfacing (`IRIS_GOVERNANCE_PRESET`).
 *
 * Exercises the new `presetSeed` cascade layer inserted between the explicit
 * `IRIS_GOVERNANCE` layers and `defaultSeed` (spec 02 §2.2):
 *
 *   effective = profile.explicit(key) ?? global.explicit(key) ??
 *               presetSeed(key) ?? defaultSeed(key)
 *
 * and its surfacing (spec 02 §2.3): the discovery tool's `preset` field, the
 * `iris-governance://{profile}` resource, and the `GOVERNANCE_DISABLED`
 * denial's optional `presetApplied` field.
 *
 *   AC 24.1.1 — cascade + back-compat capstone: unset preset is byte-for-byte
 *               today's behavior (the optional-default-param threading proof).
 *   AC 24.1.2 — read-only capstone over the FULL key universe: every write
 *               false (baseline + new-tool + defaultEnabled writes), every
 *               read true; explicit overrides beat the preset at both layers.
 *   AC 24.1.3 — startup validation: an unknown preset fails fast naming the
 *               valid values; `full` behaves as pass-through (== unset).
 *   AC 24.1.4 — surfacing: discovery tool `preset` field, resource reflection,
 *               `presetApplied` on a preset-caused denial (absent otherwise).
 *
 * Discoverable by the default `vitest run` suite (Rule #21) — BOTH capstones
 * (AC 24.1.1, AC 24.1.2) run here as plain `*.test.ts`, never
 * `*.integration.test.ts`. TypeScript-only — no BOOTSTRAP_VERSION impact
 * (never touches `governance-baseline.ts`, Rule #23/#25).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import type { BootstrapResult } from "../bootstrap.js";
import {
  parseGovernancePreset,
  presetSeed,
  effective,
  getEffectivePolicy,
} from "../governance.js";
import type { GovernanceConfig, MutatesLookup } from "../governance.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import { BASELINE_ACTION_CLASSIFICATIONS } from "../baseline-classifications.js";
import { SERVER_DISCOVERY_TOOL_NAME } from "../server-discovery.js";
import type { ServerDiscoveryResult } from "../server-discovery.js";
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

// ── Helpers (mirror governance-cross-server.test.ts / server-discovery.test.ts) ──

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

/**
 * Mirrors the REAL `iris_production_control:clean` tool: a multi-action write
 * tool where `clean` opts into "write, default-enabled" (Epic 20 F2). Used to
 * pin the read-only-overrides-F2 case named explicitly by AC 24.1.2/Rule #32.
 */
function makeProductionControlTool(): ToolDefinition {
  return {
    name: "iris_production_control",
    title: "Production control (synthetic)",
    description: "Mirrors the real defaultEnabled write action iris_production_control:clean.",
    inputSchema: z.object({ action: z.enum(["clean", "restart"]) }),
    annotations: { readOnlyHint: false, destructiveHint: true },
    scope: "NONE",
    mutates: { clean: "write", restart: "write" },
    defaultEnabled: ["clean"],
    handler: async () => ({
      content: [{ type: "text" as const, text: "ran" }],
      structuredContent: { ok: true },
    }),
  };
}

function makeCapstoneTools(): ToolDefinition[] {
  return [makeReadTool("iris_new_read"), makeWriteTool("iris_new_write"), makeProductionControlTool()];
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

/** Invoke a request handler on the underlying Server by method name. */
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
// AC 24.1.3 — parseGovernancePreset startup validation.
// ════════════════════════════════════════════════════════════════════

describe("parseGovernancePreset (AC 24.1.3)", () => {
  it("returns undefined when IRIS_GOVERNANCE_PRESET is unset", () => {
    expect(parseGovernancePreset({})).toBeUndefined();
  });

  it("returns undefined when it is the empty string", () => {
    expect(parseGovernancePreset({ IRIS_GOVERNANCE_PRESET: "" })).toBeUndefined();
  });

  it("parses 'read-only'", () => {
    expect(parseGovernancePreset({ IRIS_GOVERNANCE_PRESET: "read-only" })).toBe(
      "read-only",
    );
  });

  it("parses 'full'", () => {
    expect(parseGovernancePreset({ IRIS_GOVERNANCE_PRESET: "full" })).toBe("full");
  });

  it("fails fast naming IRIS_GOVERNANCE_PRESET on an unrecognized value", () => {
    expect(() =>
      parseGovernancePreset({ IRIS_GOVERNANCE_PRESET: "read_only" }),
    ).toThrow(/IRIS_GOVERNANCE_PRESET/);
  });

  it("the fail-fast message names BOTH valid values", () => {
    expect(() =>
      parseGovernancePreset({ IRIS_GOVERNANCE_PRESET: "readonly" }),
    ).toThrow(/read-only/);
    expect(() =>
      parseGovernancePreset({ IRIS_GOVERNANCE_PRESET: "readonly" }),
    ).toThrow(/full/);
  });

  it("is case-sensitive (rejects 'Read-Only')", () => {
    expect(() =>
      parseGovernancePreset({ IRIS_GOVERNANCE_PRESET: "Read-Only" }),
    ).toThrow(/IRIS_GOVERNANCE_PRESET/);
  });

  it("rejects an empty-ish typo like 'read-only ' (trailing space)", () => {
    expect(() =>
      parseGovernancePreset({ IRIS_GOVERNANCE_PRESET: "read-only " }),
    ).toThrow(/IRIS_GOVERNANCE_PRESET/);
  });
});

// ════════════════════════════════════════════════════════════════════
// presetSeed — the pure cascade-layer function (AC 24.1.2 mechanics).
// ════════════════════════════════════════════════════════════════════

describe("presetSeed", () => {
  const mutates: MutatesLookup = new Map<string, "read" | "write">([
    ["iris_new:read", "read"],
    ["iris_new:write", "write"],
  ]);
  const classifications = {
    "iris_base:read": "read" as const,
    "iris_base:write": "write" as const,
  };

  it("returns undefined (pass-through) when preset is undefined", () => {
    expect(
      presetSeed("iris_new:write", undefined, mutates, classifications),
    ).toBeUndefined();
  });

  it("returns undefined (pass-through) when preset is 'full'", () => {
    expect(presetSeed("iris_new:write", "full", mutates, classifications)).toBeUndefined();
    expect(presetSeed("iris_base:write", "full", mutates, classifications)).toBeUndefined();
  });

  it("read-only: a baseline-classified read resolves true", () => {
    expect(presetSeed("iris_base:read", "read-only", mutates, classifications)).toBe(
      true,
    );
  });

  it("read-only: a baseline-classified write resolves false", () => {
    expect(presetSeed("iris_base:write", "read-only", mutates, classifications)).toBe(
      false,
    );
  });

  it("read-only: falls back to mutatesLookup for a non-baseline key", () => {
    expect(presetSeed("iris_new:read", "read-only", mutates, classifications)).toBe(true);
    expect(presetSeed("iris_new:write", "read-only", mutates, classifications)).toBe(
      false,
    );
  });

  it("classifications take priority over mutatesLookup when both list a key", () => {
    const conflicting: MutatesLookup = new Map([["iris_base:write", "read"]]);
    expect(presetSeed("iris_base:write", "read-only", conflicting, classifications)).toBe(
      false,
    );
  });

  it("read-only: an unclassifiable key fails SAFE to false", () => {
    expect(presetSeed("iris_unknown:thing", "read-only", new Map(), {})).toBe(false);
  });

  it("classifications defaults to empty when omitted", () => {
    expect(presetSeed("iris_new:write", "read-only", mutates)).toBe(false);
    expect(presetSeed("iris_new:read", "read-only", mutates)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// effective() / getEffectivePolicy() preset threading (synthetic cascade
// matrix, mirroring the F2 test style in governance.test.ts).
// ════════════════════════════════════════════════════════════════════

describe("effective()/getEffectivePolicy() preset threading (AC 24.1.1, 24.1.2)", () => {
  const SYNTH_BASELINE: ReadonlySet<string> = new Set(["iris_old_tool"]);
  const SYNTH_MUTATES: MutatesLookup = new Map<string, "read" | "write">([
    ["iris_new_tool:read", "read"],
    ["iris_new_tool:write", "write"],
  ]);
  const SYNTH_CLASSIFICATIONS = { iris_old_tool: "read" as const };
  const SYNTH_ALL_KEYS = ["iris_old_tool", "iris_new_tool:read", "iris_new_tool:write"];
  const EMPTY_CONFIG: GovernanceConfig = {};

  it("back-compat: effective() with preset omitted == effective() with preset explicitly undefined", () => {
    for (const key of SYNTH_ALL_KEYS) {
      const omitted = effective(key, "default", EMPTY_CONFIG, SYNTH_MUTATES, SYNTH_BASELINE);
      const explicit = effective(
        key,
        "default",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        undefined,
        SYNTH_CLASSIFICATIONS,
      );
      expect(explicit, key).toBe(omitted);
    }
  });

  it("getEffectivePolicy(): preset undefined deep-equals the no-preset-param policy", () => {
    const withParams = getEffectivePolicy(
      "default",
      EMPTY_CONFIG,
      SYNTH_ALL_KEYS,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
      new Set(),
      undefined,
      SYNTH_CLASSIFICATIONS,
    );
    const without = getEffectivePolicy(
      "default",
      EMPTY_CONFIG,
      SYNTH_ALL_KEYS,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
    );
    expect(withParams).toEqual(without);
  });

  it("read-only: write false, read true across the cascade", () => {
    const policy = getEffectivePolicy(
      "default",
      EMPTY_CONFIG,
      SYNTH_ALL_KEYS,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
      new Set(),
      "read-only",
      SYNTH_CLASSIFICATIONS,
    );
    expect(policy["iris_old_tool"]).toBe(true); // baseline classified read
    expect(policy["iris_new_tool:read"]).toBe(true);
    expect(policy["iris_new_tool:write"]).toBe(false);
  });

  it("read-only + defaultEnabledWrites: the write STILL resolves false (F2 does not re-enable under read-only)", () => {
    const defaultEnabledWrites = new Set(["iris_new_tool:write"]);
    // Sanity: with NO preset, defaultEnabledWrites WOULD enable it (existing F2 behavior).
    const noPreset = effective(
      "iris_new_tool:write",
      "default",
      EMPTY_CONFIG,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
      defaultEnabledWrites,
    );
    expect(noPreset).toBe(true);
    // Under read-only, it is blocked regardless (Rule #32 — read-only overrides F2).
    const readOnly = effective(
      "iris_new_tool:write",
      "default",
      EMPTY_CONFIG,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
      defaultEnabledWrites,
      "read-only",
      SYNTH_CLASSIFICATIONS,
    );
    expect(readOnly).toBe(false);
  });

  it("explicit global override beats the preset (re-enables a write under read-only)", () => {
    const cfg: GovernanceConfig = { global: { "iris_new_tool:write": true } };
    expect(
      effective(
        "iris_new_tool:write",
        "default",
        cfg,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        "read-only",
        SYNTH_CLASSIFICATIONS,
      ),
    ).toBe(true);
  });

  it("explicit profile override beats both the global override and the preset", () => {
    const cfg: GovernanceConfig = {
      global: { "iris_new_tool:write": true },
      profiles: { prod: { "iris_new_tool:write": false } },
    };
    expect(
      effective(
        "iris_new_tool:write",
        "prod",
        cfg,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        "read-only",
        SYNTH_CLASSIFICATIONS,
      ),
    ).toBe(false);
    // Another profile without its own override inherits the global re-enable.
    expect(
      effective(
        "iris_new_tool:write",
        "staging",
        cfg,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        "read-only",
        SYNTH_CLASSIFICATIONS,
      ),
    ).toBe(true);
  });

  it("an explicit override can also DISABLE a preset-enabled read", () => {
    const cfg: GovernanceConfig = { global: { iris_old_tool: false } };
    expect(
      effective(
        "iris_old_tool",
        "default",
        cfg,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        "read-only",
        SYNTH_CLASSIFICATIONS,
      ),
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 24.1.1 — back-compat capstone over the REAL frozen-baseline map.
// ════════════════════════════════════════════════════════════════════

describe("AC 24.1.1 — back-compat capstone over the REAL BASELINE_ACTION_CLASSIFICATIONS", () => {
  it("presetSeed(key, undefined, ...) is undefined for EVERY real baseline key", () => {
    const emptyMutates: MutatesLookup = new Map();
    for (const key of Object.keys(BASELINE_ACTION_CLASSIFICATIONS)) {
      expect(
        presetSeed(key, undefined, emptyMutates, BASELINE_ACTION_CLASSIFICATIONS),
        `presetSeed(${key})`,
      ).toBeUndefined();
    }
  });

  it("effective(key) with preset/classifications supplied == effective(key) with them omitted, for EVERY real baseline key (mechanical proof)", () => {
    const emptyMutates: MutatesLookup = new Map();
    for (const key of GOVERNANCE_BASELINE) {
      const omitted = effective(key, "default", {}, emptyMutates, GOVERNANCE_BASELINE);
      const withParams = effective(
        key,
        "default",
        {},
        emptyMutates,
        GOVERNANCE_BASELINE,
        new Set(),
        undefined,
        BASELINE_ACTION_CLASSIFICATIONS,
      );
      expect(withParams, `effective(${key})`).toBe(omitted);
      expect(withParams, `effective(${key}) must stay enabled (grandfathered)`).toBe(
        true,
      );
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 24.1.2 — read-only capstone over the REAL frozen-baseline map (full
// universe, not a sample).
// ════════════════════════════════════════════════════════════════════

describe("AC 24.1.2 — read-only capstone over the REAL BASELINE_ACTION_CLASSIFICATIONS (full universe)", () => {
  it("every real baseline key's read-only resolution matches its actual classification, zero exceptions", () => {
    const emptyMutates: MutatesLookup = new Map();
    const keys = Object.keys(BASELINE_ACTION_CLASSIFICATIONS);
    // Completeness sanity (also enforced independently by Story 24.0's own test).
    expect(keys.length).toBe(GOVERNANCE_BASELINE.size);

    let readCount = 0;
    let writeCount = 0;
    for (const key of keys) {
      const cls = BASELINE_ACTION_CLASSIFICATIONS[key];
      const resolved = effective(
        key,
        "default",
        {},
        emptyMutates,
        GOVERNANCE_BASELINE,
        new Set(),
        "read-only",
        BASELINE_ACTION_CLASSIFICATIONS,
      );
      expect(resolved, `${key} (classified ${cls})`).toBe(cls === "read");
      if (cls === "read") readCount++;
      else writeCount++;
    }
    // Guard against a vacuously-passing loop: the real universe has both classes.
    expect(readCount).toBeGreaterThan(0);
    expect(writeCount).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════
// Constructed-server capstones (AC 24.1.1 + 24.1.2 "on a constructed server",
// over the FULL registered key universe: baseline ∪ registered tool keys).
// ════════════════════════════════════════════════════════════════════

describe("Constructed-server capstone — unset preset is byte-for-byte (AC 24.1.1)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("the unset-preset policy deep-equals the policy computed with preset/classifications omitted entirely, over the full key universe", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(makeCapstoneTools()));
    await server.start("stdio");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = server as any;
    expect(s.preset).toBeUndefined();

    const withParamsOmitted = getEffectivePolicy(
      "default",
      s.governanceConfig,
      s.governedKeys,
      s.mutatesLookup,
      GOVERNANCE_BASELINE,
      s.defaultEnabledWrites,
    );
    const withParamsExplicit = getEffectivePolicy(
      "default",
      s.governanceConfig,
      s.governedKeys,
      s.mutatesLookup,
      GOVERNANCE_BASELINE,
      s.defaultEnabledWrites,
      s.preset,
      BASELINE_ACTION_CLASSIFICATIONS,
    );
    expect(withParamsExplicit).toEqual(withParamsOmitted);
    // Sanity: this really is the full universe (baseline + this server's own keys).
    expect(Object.keys(withParamsExplicit).length).toBeGreaterThan(GOVERNANCE_BASELINE.size);

    // Non-drift: the discovery tool reports the IDENTICAL policy.
    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(discovery.governance.policy).toEqual(withParamsOmitted);
    expect(discovery.preset).toBeNull();
  });
});

describe("Constructed-server capstone — read-only over the full registered key universe (AC 24.1.2)", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("every write key resolves false, every read key resolves true — including a defaultEnabled write and the framework discovery tool", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(makeCapstoneTools()));
    await server.start("stdio");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s = server as any;
    expect(s.preset).toBe("read-only");

    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(discovery.preset).toBe("read-only");
    const policy = discovery.governance.policy!;

    // Iterate the FULL registered key universe (baseline ∪ this server's keys) —
    // not a hand-picked sample.
    const governedKeys: Set<string> = s.governedKeys;
    expect(governedKeys.size).toBeGreaterThan(GOVERNANCE_BASELINE.size);
    for (const key of governedKeys) {
      const cls =
        BASELINE_ACTION_CLASSIFICATIONS[key] ?? (s.mutatesLookup as MutatesLookup).get(key);
      expect(cls, `no classification for ${key}`).toBeDefined();
      expect(policy[key], `policy[${key}] (class=${cls})`).toBe(cls === "read");
    }

    // Explicit pins named by AC 24.1.2.
    expect(policy["iris_production_control:clean"]).toBe(false); // defaultEnabled write, still blocked
    expect(policy["iris_new_write"]).toBe(false);
    expect(policy["iris_new_read"]).toBe(true);
    expect(policy[SERVER_DISCOVERY_TOOL_NAME]).toBe(true); // framework read tool stays enabled
  });

  it("explicit global override re-enables one write under read-only; other writes stay blocked", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_new_write: true } });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(makeCapstoneTools()));
    await server.start("stdio");

    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(discovery.governance.policy!.iris_new_write).toBe(true);
    expect(discovery.governance.policy!["iris_production_control:clean"]).toBe(false);
  });

  it("explicit profile override wins over both the global override and the preset", async () => {
    setDefaultEnv();
    process.env.IRIS_PROFILES = JSON.stringify({
      prod: { host: "prod.example.com", namespace: "PRODNS" },
    });
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_new_write: true },
      profiles: { prod: { iris_new_write: false } },
    });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts(makeCapstoneTools()));
    await server.start("stdio");

    // Discovery is connection-agnostic — no need to establish the prod profile.
    const def = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(def.governance.policy!.iris_new_write).toBe(true); // global re-enable

    const prod = discoveryOf(
      await callTool(server, SERVER_DISCOVERY_TOOL_NAME, { profile: "prod" }),
    );
    expect(prod.governance.policy!.iris_new_write).toBe(false); // profile override wins
  });

  it("the discovery tool's reported policy matches the gate's actual call-time decision", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeReadTool("iris_new_read"), makeWriteTool("iris_new_write")]),
    );
    await server.start("stdio");

    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(discovery.governance.policy!.iris_new_write).toBe(false);
    expect(discovery.governance.policy!.iris_new_read).toBe(true);

    const deniedWrite = await callTool(server, "iris_new_write", { value: "x" });
    expect(deniedWrite.isError).toBe(true);
    expect(deniedWrite.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_new_write",
      server: "default",
      presetApplied: "read-only",
    });

    const allowedRead = await callTool(server, "iris_new_read", {});
    expect(allowedRead.isError).toBeFalsy();
    expect(allowedRead.structuredContent).toEqual({ ok: true });
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 24.1.4a — discovery tool `preset` field.
// ════════════════════════════════════════════════════════════════════

describe("AC 24.1.4a — discovery tool preset field", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("reports null when IRIS_GOVERNANCE_PRESET is unset", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeReadTool("iris_new_read")]));
    await server.start("stdio");

    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(discovery.preset).toBeNull();
  });

  it("reports 'read-only' when set", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeReadTool("iris_new_read")]));
    await server.start("stdio");

    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(discovery.preset).toBe("read-only");
  });

  it("reports 'full' when explicitly set, behaving as pass-through (matches unset for a defaultEnabled write)", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "full";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeProductionControlTool()]));
    await server.start("stdio");

    const discovery = discoveryOf(await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {}));
    expect(discovery.preset).toBe("full");
    // A defaultEnabled write is ENABLED under "full" — the exact case that
    // would DIFFER under "read-only" (false), proving full == pass-through.
    expect(discovery.governance.policy!["iris_production_control:clean"]).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 24.1.4b — the governance resource reflects the preset.
// ════════════════════════════════════════════════════════════════════

describe("AC 24.1.4b — governance resource reflects the preset", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("iris-governance://default reports a write key disabled and a read key enabled under read-only", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(
      makeServerOpts([makeWriteTool("iris_new_write"), makeReadTool("iris_new_read")]),
    );
    await server.start("stdio");

    const result = await callRequest(server, "resources/read", {
      uri: "iris-governance://default",
    });
    const contents = result.contents as Array<{ text: string }>;
    const policy = JSON.parse(contents[0]!.text) as Record<string, boolean>;
    expect(policy.iris_new_write).toBe(false);
    expect(policy.iris_new_read).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 24.1.4c — `presetApplied` on the GOVERNANCE_DISABLED denial.
// ════════════════════════════════════════════════════════════════════

describe("AC 24.1.4c — presetApplied denial attribution", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("presetApplied is ABSENT entirely when no preset is set (unset-preset back-compat)", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeWriteTool("iris_new_write")]));
    await server.start("stdio");

    const denial = await callTool(server, "iris_new_write", { value: "x" });
    expect(denial.isError).toBe(true);
    expect(denial.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_new_write",
      server: "default",
    });
  });

  it("presetApplied IS present when the preset (not an explicit override) caused the denial", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeWriteTool("iris_new_write")]));
    await server.start("stdio");

    const denial = await callTool(server, "iris_new_write", { value: "x" });
    expect(denial.isError).toBe(true);
    expect(denial.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_new_write",
      server: "default",
      presetApplied: "read-only",
    });
  });

  it("presetApplied is ABSENT when an explicit IRIS_GOVERNANCE:false override causes the denial under read-only", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    // This key would otherwise resolve ENABLED under read-only (it is a read) —
    // the explicit override, not the preset, is what denies it here.
    process.env.IRIS_GOVERNANCE = JSON.stringify({ global: { iris_new_read: false } });
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeReadTool("iris_new_read")]));
    await server.start("stdio");

    const denial = await callTool(server, "iris_new_read", {});
    expect(denial.isError).toBe(true);
    expect(denial.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_new_read",
      server: "default",
    });
    expect(
      Object.prototype.hasOwnProperty.call(denial.structuredContent, "presetApplied"),
    ).toBe(false);
  });

  it("presetApplied is ABSENT when preset is 'full' (pass-through, never attributed)", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "full";
    stageDefaultStartup(env.fetchMock);
    const server = new McpServerBase(makeServerOpts([makeWriteTool("iris_new_write")]));
    await server.start("stdio");

    // Seed-disabled (new write, no F2 opt-in) — denied by defaultSeed, not the preset.
    const denial = await callTool(server, "iris_new_write", { value: "x" });
    expect(denial.isError).toBe(true);
    expect(denial.structuredContent).toEqual({
      code: "GOVERNANCE_DISABLED",
      action: "iris_new_write",
      server: "default",
    });
  });
});
