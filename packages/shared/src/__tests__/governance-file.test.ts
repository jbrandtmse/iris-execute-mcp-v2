/**
 * Story 32.0 — `IRIS_GOVERNANCE_FILE` loader, the 6-layer cascade, and
 * `configSource` surfacing (ACs 32.0.1 / 32.0.2 / 32.0.3).
 *
 * Two tiers:
 *
 * 1. UNIT — {@link loadGovernanceFile} fail-fast behavior, the cascade
 *    ordering matrix (env × file × preset), the Rule #19 unset-file no-op
 *    proof (resolved policy + denial attribution deep-equal), and the
 *    per-key {@link configSource} resolution. Synthetic baseline/mutates
 *    fixtures mirror governance.test.ts's world.
 *
 * 2. SERVER-LEVEL (Integration AC 32.0.3) — a REAL `McpServerBase` (mocked
 *    bootstrap + fetch, as in governance-resource.test.ts) started with a
 *    real temp governance file: the `iris-governance://` resource and the
 *    `iris_server_profiles` discovery view both report `configSource`, the
 *    ordering discriminator holds at the enforcement gate, denial
 *    attribution distinguishes file from preset, the Epic-30 hidden-tool
 *    key omission covers `configSource`, and a missing file fails startup.
 *
 * `node:fs` is mocked ONLY to wrap `readFileSync` in a spy that delegates to
 * the real implementation — so the "unset ⇒ ZERO filesystem access" proof
 * can count calls while every other test exercises the REAL filesystem and
 * the REAL Node/JSON error messages (Rule #36).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BootstrapResult } from "../bootstrap.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import {
  SERVER_DISCOVERY_TOOL_NAME,
  serverDiscoveryTool,
} from "../server-discovery.js";
import type { ToolDefinition } from "../tool-types.js";
import type {
  GovernanceConfig,
  GovernanceConfigSource,
  GovernanceLayer,
  MutatesLookup,
  MutationClass,
} from "../governance.js";

// ── Module mocks (hoisted; factories run lazily on first import) ──────

const realReadFileSync = (
  await vi.importActual<typeof import("node:fs")>("node:fs")
).readFileSync;
const readFileSyncSpy = vi.fn((path: string, encoding: BufferEncoding) =>
  realReadFileSync(path, encoding),
);
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: (path: string, encoding: BufferEncoding) =>
      readFileSyncSpy(path, encoding),
  };
});

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

// Import AFTER vi.mock so governance.ts/server-base pick up the mocks.
const {
  loadGovernanceFile,
  effective,
  hasExplicitOverride,
  getEffectivePolicy,
  configSource,
  getEffectiveConfigSources,
} = await import("../governance.js");
const { McpServerBase } = await import("../server-base.js");
type McpServerBaseOptions = import("../server-base.js").McpServerBaseOptions;

// ── Synthetic world (mirrors governance.test.ts) ──────────────────────

const SYNTH_BASELINE: ReadonlySet<string> = new Set([
  "iris_old_tool", // pre-existing single-op (grandfathered → seed true)
  "iris_old_manage:create", // pre-existing action (grandfathered → seed true)
]);

const SYNTH_MUTATES: MutatesLookup = new Map<string, MutationClass>([
  ["iris_new_tool:read", "read"], // new read → seed true
  ["iris_new_tool:write", "write"], // new write → seed false
]);

const SYNTH_ALL_KEYS = [
  "iris_old_tool",
  "iris_old_manage:create",
  "iris_new_tool:read",
  "iris_new_tool:write",
];

/** Frozen-baseline classifications for the presetSeed layer. */
const SYNTH_CLASSIFICATIONS: Readonly<Record<string, MutationClass>> = {
  iris_old_tool: "read",
  "iris_old_manage:create": "write",
};

const EMPTY_CONFIG: GovernanceConfig = {};

// ── Temp governance files ─────────────────────────────────────────────

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "iris-gov-file-"));
  readFileSyncSpy.mockClear();
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

/** Write a governance file into the temp dir and return its absolute path. */
function writeGovernanceFile(name: string, contents: string): string {
  const p = join(tempDir, name);
  writeFileSync(p, contents, "utf8");
  return p;
}

/** Capture the thrown error's message (fail-fast assertions read it once). */
function thrownMessage(fn: () => unknown): string {
  try {
    fn();
  } catch (e: unknown) {
    return e instanceof Error ? e.message : String(e);
  }
  throw new Error("expected the call to throw, but it returned");
}

// ════════════════════════════════════════════════════════════════════
// AC 32.0.1 — loadGovernanceFile.
// ════════════════════════════════════════════════════════════════════

describe("loadGovernanceFile (AC 32.0.1)", () => {
  it("unset var ⇒ undefined with ZERO filesystem access", () => {
    expect(loadGovernanceFile({})).toBeUndefined();
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it("empty-string var ⇒ undefined with ZERO filesystem access", () => {
    expect(loadGovernanceFile({ IRIS_GOVERNANCE_FILE: "" })).toBeUndefined();
    expect(readFileSyncSpy).not.toHaveBeenCalled();
  });

  it("missing file ⇒ fail-fast naming the var, the path, and the underlying error", () => {
    const missing = join(tempDir, "does-not-exist.json");
    const message = thrownMessage(() =>
      loadGovernanceFile({ IRIS_GOVERNANCE_FILE: missing }),
    );
    expect(message).toMatch(/^IRIS_GOVERNANCE_FILE is invalid: /);
    expect(message).toContain(missing);
    // The REAL Node fs error (captured live — Rule #36): ENOENT on every OS.
    expect(message).toContain("ENOENT");
  });

  it("malformed JSON ⇒ fail-fast naming the var + path + parse error, never echoing contents", () => {
    const p = writeGovernanceFile("malformed.json", "{ this is not json ");
    const message = thrownMessage(() =>
      loadGovernanceFile({ IRIS_GOVERNANCE_FILE: p }),
    );
    expect(message).toMatch(/^IRIS_GOVERNANCE_FILE is invalid: could not parse JSON/);
    expect(message).toContain(p);
    // Uniform no-echo discipline: the file's CONTENTS never appear.
    expect(message).not.toContain("this is not json");
  });

  it("a non-object root ⇒ fail-fast with the shared shape error", () => {
    const p = writeGovernanceFile("array.json", "[1,2,3]");
    const message = thrownMessage(() =>
      loadGovernanceFile({ IRIS_GOVERNANCE_FILE: p }),
    );
    expect(message).toMatch(/^IRIS_GOVERNANCE_FILE is invalid: /);
    expect(message).toContain("expected a JSON object");
    expect(message).toContain(p);
  });

  it("a non-boolean value ⇒ the SAME layer validation, naming IRIS_GOVERNANCE_FILE (not IRIS_GOVERNANCE)", () => {
    const p = writeGovernanceFile(
      "non-boolean.json",
      JSON.stringify({ global: { iris_x: "true" } }),
    );
    const message = thrownMessage(() =>
      loadGovernanceFile({ IRIS_GOVERNANCE_FILE: p }),
    );
    expect(message).toMatch(/^IRIS_GOVERNANCE_FILE is invalid: /);
    expect(message).toContain('"global": value for "iris_x" must be a boolean');
    expect(message).toContain(p);
  });

  it('a reserved key ("__proto__") in a file layer ⇒ reserved-key fail-fast', () => {
    // JSON.parse materializes "__proto__" as an OWN property, so this really
    // reaches validateLayer (not the prototype).
    const p = writeGovernanceFile(
      "reserved.json",
      '{"global":{"__proto__":true}}',
    );
    const message = thrownMessage(() =>
      loadGovernanceFile({ IRIS_GOVERNANCE_FILE: p }),
    );
    expect(message).toMatch(/^IRIS_GOVERNANCE_FILE is invalid: /);
    expect(message).toContain('"__proto__" is a reserved key');
    expect(message).toContain(p);
  });

  it('a reserved profile name ("constructor") ⇒ reserved-key fail-fast', () => {
    const p = writeGovernanceFile(
      "reserved-profile.json",
      '{"profiles":{"constructor":{"iris_x":true}}}',
    );
    const message = thrownMessage(() =>
      loadGovernanceFile({ IRIS_GOVERNANCE_FILE: p }),
    );
    expect(message).toContain('"constructor" is a reserved key');
    expect(message).toContain(p);
  });

  it("a valid file parses through the same shape validation (global + profiles layers)", () => {
    const p = writeGovernanceFile(
      "valid.json",
      JSON.stringify({
        global: { "iris_new_tool:write": true },
        profiles: { prod: { iris_old_tool: false } },
      }),
    );
    const config = loadGovernanceFile({ IRIS_GOVERNANCE_FILE: p });
    expect(config).toBeDefined();
    expect(config!.global!["iris_new_tool:write"]).toBe(true);
    expect(config!.profiles!["prod"]!["iris_old_tool"]).toBe(false);
    // Exactly one read of the named file happened.
    expect(readFileSyncSpy).toHaveBeenCalledTimes(1);
    expect(readFileSyncSpy).toHaveBeenCalledWith(p, "utf8");
  });

  it("an empty-object file parses to the empty config", () => {
    const p = writeGovernanceFile("empty.json", "{}");
    expect(loadGovernanceFile({ IRIS_GOVERNANCE_FILE: p })).toEqual({});
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 32.0.2 — the 6-layer cascade:
//   env.profile ?? env.global ?? file.profile ?? file.global
//   ?? presetSeed ?? defaultSeed
// ════════════════════════════════════════════════════════════════════

describe("cascade — 6-layer ordering (AC 32.0.2)", () => {
  it("env-true beats file-false (ALL env layers above ALL file layers)", () => {
    const env: GovernanceConfig = { global: { "iris_new_tool:write": true } };
    const file: GovernanceConfig = {
      profiles: { prod: { "iris_new_tool:write": false } },
    };
    expect(
      effective(
        "iris_new_tool:write",
        "prod",
        env,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        undefined,
        {},
        file,
      ),
    ).toBe(true);
  });

  it("ORDERING DISCRIMINATOR: global.env=false + profile.file=true ⇒ FALSE (env wins; the rejected interleaved ordering would yield true)", () => {
    const env: GovernanceConfig = { global: { iris_old_tool: false } };
    const file: GovernanceConfig = { profiles: { prod: { iris_old_tool: true } } };
    expect(
      effective(
        "iris_old_tool",
        "prod",
        env,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        undefined,
        {},
        file,
      ),
    ).toBe(false);
  });

  it("env-absent + file-false ⇒ false (the file layer is honored when env is silent)", () => {
    const file: GovernanceConfig = { global: { iris_old_tool: false } };
    expect(
      effective(
        "iris_old_tool",
        "prod",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        undefined,
        {},
        file,
      ),
    ).toBe(false);
  });

  it("file-true re-enables a seed-disabled write (file sits above the seeds)", () => {
    const file: GovernanceConfig = { global: { "iris_new_tool:write": true } };
    expect(
      effective(
        "iris_new_tool:write",
        "prod",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        undefined,
        {},
        file,
      ),
    ).toBe(true);
  });

  it("profile.env beats every lower layer (profile > global > file)", () => {
    const env: GovernanceConfig = {
      global: { iris_old_tool: false },
      profiles: { prod: { iris_old_tool: true } },
    };
    const file: GovernanceConfig = {
      global: { iris_old_tool: false },
      profiles: { prod: { iris_old_tool: false } },
    };
    expect(
      effective(
        "iris_old_tool",
        "prod",
        env,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        undefined,
        {},
        file,
      ),
    ).toBe(true);
  });

  it("profile.file beats global.file (file layers keep the profile>global shape)", () => {
    const file: GovernanceConfig = {
      global: { iris_old_tool: false },
      profiles: { prod: { iris_old_tool: true } },
    };
    expect(
      effective(
        "iris_old_tool",
        "prod",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        undefined,
        {},
        file,
      ),
    ).toBe(true);
  });

  it("file-false beats the read-only preset (explicit file above presetSeed)", () => {
    const file: GovernanceConfig = { global: { iris_old_tool: false } };
    expect(
      effective(
        "iris_old_tool", // a READ key — the read-only preset would enable it
        "prod",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        "read-only",
        SYNTH_CLASSIFICATIONS,
        file,
      ),
    ).toBe(false);
  });

  it("file-true on a WRITE key beats the read-only preset", () => {
    const file: GovernanceConfig = { global: { "iris_old_manage:create": true } };
    expect(
      effective(
        "iris_old_manage:create", // a WRITE key — the read-only preset would disable it
        "prod",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        "read-only",
        SYNTH_CLASSIFICATIONS,
        file,
      ),
    ).toBe(true);
  });

  it("the preset governs when both explicit channels are silent on the key", () => {
    const file: GovernanceConfig = { global: { iris_old_tool: false } }; // silent on the write key
    expect(
      effective(
        "iris_new_tool:write", // read-only preset disables this WRITE key
        "prod",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        "read-only",
        SYNTH_CLASSIFICATIONS,
        file,
      ),
    ).toBe(false);
  });

  it("prototype-collision discipline: an own 'constructor' profile layer in the FILE is honored; a non-own name never leaks inherited members", () => {
    const fileProfiles = Object.create(null) as Record<string, GovernanceLayer>;
    fileProfiles["constructor"] = { iris_old_tool: false };
    const file: GovernanceConfig = { profiles: fileProfiles };
    // The own "constructor" layer disables for that profile…
    expect(
      effective(
        "iris_old_tool",
        "constructor",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        undefined,
        {},
        file,
      ),
    ).toBe(false);
    // …while a profile named "toString" (an Object.prototype member, never an
    // own layer) inherits the seed rather than a leaked prototype value.
    expect(
      effective(
        "iris_old_tool",
        "toString",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
        undefined,
        {},
        file,
      ),
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 32.0.1 — Rule #19 no-op proof: with NO file, the resolved policy and
// the denial attribution are byte-for-byte the pre-Epic-32 behavior.
// ════════════════════════════════════════════════════════════════════

describe("Rule #19 — unset file is a mechanical no-op (AC 32.0.1 clarified scope)", () => {
  // A representative matrix of pre-existing env/preset configurations.
  const matrix: Array<{ label: string; config: GovernanceConfig; preset?: "read-only" | "full" }> = [
    { label: "empty config, no preset", config: {} },
    { label: "global-only", config: { global: { iris_old_tool: false, "iris_new_tool:write": true } } },
    { label: "profiles-only", config: { profiles: { prod: { iris_old_tool: false } } } },
    {
      label: "global+profiles",
      config: {
        global: { "iris_new_tool:write": true },
        profiles: { prod: { "iris_new_tool:write": false } },
      },
    },
    { label: "empty config, read-only preset", config: {}, preset: "read-only" },
    { label: "global override + full preset", config: { global: { "iris_old_manage:create": false } }, preset: "full" },
  ];
  const PROFILES = ["prod", "staging"];

  it("resolved POLICY deep-equals: explicit `undefined` fileConfig is identical to the omitted-arg (pre-feature) call", () => {
    for (const { config, preset } of matrix) {
      for (const profile of PROFILES) {
        const without = getEffectivePolicy(
          profile, config, SYNTH_ALL_KEYS, SYNTH_MUTATES, SYNTH_BASELINE,
          new Set(), preset, SYNTH_CLASSIFICATIONS,
        );
        const withUndefined = getEffectivePolicy(
          profile, config, SYNTH_ALL_KEYS, SYNTH_MUTATES, SYNTH_BASELINE,
          new Set(), preset, SYNTH_CLASSIFICATIONS, undefined,
        );
        expect(withUndefined).toEqual(without);
      }
    }
  });

  it("denial ATTRIBUTION deep-equals: hasExplicitOverride with explicit `undefined` fileConfig is identical to the omitted-arg call", () => {
    for (const { config } of matrix) {
      for (const profile of PROFILES) {
        for (const key of SYNTH_ALL_KEYS) {
          expect(hasExplicitOverride(key, profile, config, undefined)).toBe(
            hasExplicitOverride(key, profile, config),
          );
        }
      }
    }
  });

  it("oracle: the empty-config resolved policy is the hand-derived seed map (independent of the implementation)", () => {
    // Hand-derived from the documented seed semantics (NOT from running the
    // code): baseline keys ⇒ true; new read ⇒ true; new write ⇒ false.
    expect(
      getEffectivePolicy(
        "prod", EMPTY_CONFIG, SYNTH_ALL_KEYS, SYNTH_MUTATES, SYNTH_BASELINE,
        new Set(), undefined, SYNTH_CLASSIFICATIONS, undefined,
      ),
    ).toEqual({
      iris_old_tool: true,
      "iris_old_manage:create": true,
      "iris_new_tool:read": true,
      "iris_new_tool:write": false,
    });
  });

  it("configSource under no-file reports only env/preset/default — never 'file'", () => {
    const sources = getEffectiveConfigSources(
      "prod",
      { global: { iris_old_tool: false } },
      SYNTH_ALL_KEYS,
      SYNTH_MUTATES,
      "read-only",
      SYNTH_CLASSIFICATIONS,
      undefined,
    );
    expect(sources).toEqual({
      iris_old_tool: "env",
      "iris_old_manage:create": "preset",
      "iris_new_tool:read": "preset",
      "iris_new_tool:write": "preset",
    });
  });
});

// ════════════════════════════════════════════════════════════════════
// Denial attribution — a file-layer explicit value IS an explicit override
// (documented Story 32.0 decision): a file-caused denial must not be
// attributed to the preset.
// ════════════════════════════════════════════════════════════════════

describe("hasExplicitOverride — file-layer attribution (AC 32.0.1 constraint note)", () => {
  it("a file PROFILE-layer value counts as an explicit override", () => {
    const file: GovernanceConfig = { profiles: { prod: { iris_old_tool: false } } };
    expect(hasExplicitOverride("iris_old_tool", "prod", EMPTY_CONFIG, file)).toBe(true);
  });

  it("a file GLOBAL-layer value counts as an explicit override", () => {
    const file: GovernanceConfig = { global: { iris_old_tool: false } };
    expect(hasExplicitOverride("iris_old_tool", "prod", EMPTY_CONFIG, file)).toBe(true);
  });

  it("silent in BOTH channels ⇒ no explicit override", () => {
    const file: GovernanceConfig = { global: { iris_old_tool: false } };
    expect(hasExplicitOverride("iris_old_manage:create", "prod", EMPTY_CONFIG, file)).toBe(false);
  });

  it("a file value on one key does not manufacture an override for another profile's view", () => {
    const file: GovernanceConfig = { profiles: { prod: { iris_old_tool: false } } };
    expect(hasExplicitOverride("iris_old_tool", "staging", EMPTY_CONFIG, file)).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 32.0.3 — configSource resolution.
// ════════════════════════════════════════════════════════════════════

describe("configSource (AC 32.0.3)", () => {
  const KEY = "iris_old_tool";

  function resolve(
    env: GovernanceConfig,
    file: GovernanceConfig | undefined,
    preset?: "read-only" | "full",
  ): GovernanceConfigSource {
    return configSource(
      KEY, "prod", env, SYNTH_MUTATES, preset, SYNTH_CLASSIFICATIONS, file,
    );
  }

  it("env profile layer ⇒ 'env' even when the file also sets the key", () => {
    expect(
      resolve(
        { profiles: { prod: { [KEY]: true } } },
        { global: { [KEY]: false } },
      ),
    ).toBe("env");
  });

  it("env global layer ⇒ 'env' even when the file also sets the key", () => {
    expect(resolve({ global: { [KEY]: false } }, { global: { [KEY]: true } })).toBe("env");
  });

  it("env silent + file profile layer ⇒ 'file'", () => {
    expect(resolve({}, { profiles: { prod: { [KEY]: true } } })).toBe("file");
  });

  it("env silent + file global layer ⇒ 'file'", () => {
    expect(resolve({}, { global: { [KEY]: false } })).toBe("file");
  });

  it("both channels silent + read-only preset ⇒ 'preset'", () => {
    expect(resolve({}, undefined, "read-only")).toBe("preset");
  });

  it("both channels silent + full preset (pass-through) ⇒ 'default'", () => {
    expect(resolve({}, undefined, "full")).toBe("default");
  });

  it("both channels silent + no preset ⇒ 'default'", () => {
    expect(resolve({}, undefined)).toBe("default");
  });

  it("a file present but silent on the key does not report 'file'", () => {
    expect(resolve({}, { global: { "iris_new_tool:write": true } })).toBe("default");
  });

  it("getEffectiveConfigSources builds the per-key map (defineProperty collision discipline)", () => {
    const env: GovernanceConfig = { global: { iris_old_tool: false } };
    const file: GovernanceConfig = { global: { "iris_new_tool:write": true } };
    const keys = [...SYNTH_ALL_KEYS, "constructor"];
    const sources = getEffectiveConfigSources(
      "prod", env, keys, SYNTH_MUTATES, undefined, SYNTH_CLASSIFICATIONS, file,
    );
    expect(sources["iris_old_tool"]).toBe("env");
    expect(sources["iris_new_tool:write"]).toBe("file");
    expect(sources["iris_new_tool:read"]).toBe("default");
    // A key colliding with a prototype member is a real OWN property, not a
    // silent no-op (mirrors getEffectivePolicy's invariant).
    expect(Object.prototype.hasOwnProperty.call(sources, "constructor")).toBe(true);
    expect(sources["constructor"]).toBe("default");
  });
});

// ════════════════════════════════════════════════════════════════════
// Integration AC 32.0.3 — server-level: resource + discovery view report
// configSource; the file reaches the enforcement gate; hidden-tool key
// omission covers configSource; startup fail-fast.
// ════════════════════════════════════════════════════════════════════

function makeServerOpts(tools: ToolDefinition[]): McpServerBaseOptions {
  return { name: "test-server", version: "1.0.0", tools, needsCustomRest: false };
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

/** A NEW single-op write tool (scalar `mutates: "write"`) — seed-disabled. */
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
  if (!handler) throw new Error(`No request handler registered for "${method}"`);
  const extra = {
    signal: new AbortController().signal,
    sendNotification: async () => {},
    sendRequest: async () => ({}),
  };
  return handler({ method, params }, extra);
}

/** Read iris-governance://<profile> and parse the { policy, configSource } payload. */
async function readGovernancePayload(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: any,
  profile: string,
): Promise<{
  policy: Record<string, boolean>;
  configSource: Record<string, GovernanceConfigSource>;
}> {
  const result = await callRequest(server, "resources/read", {
    uri: `iris-governance://${profile}`,
  });
  const contents = result.contents as Array<{ text: string }>;
  const first = contents[0];
  if (!first) throw new Error("resources/read returned no contents");
  return JSON.parse(first.text) as {
    policy: Record<string, boolean>;
    configSource: Record<string, GovernanceConfigSource>;
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

const GOVERNANCE_ENV_VARS = [
  "IRIS_USERNAME",
  "IRIS_PASSWORD",
  "IRIS_HOST",
  "IRIS_NAMESPACE",
  "IRIS_PROFILES",
  "IRIS_GOVERNANCE",
  "IRIS_GOVERNANCE_FILE",
  "IRIS_GOVERNANCE_PRESET",
  "IRIS_TOOLS_PRESET",
  "IRIS_TOOLS_DISABLE",
  "IRIS_TOOLS_ENABLE",
] as const;

/** Shared environment save/restore for hermetic runs. */
function makeEnvHarness() {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let exitMock: any;
  const savedEnv: Record<string, string | undefined> = {};
  for (const k of GOVERNANCE_ENV_VARS) savedEnv[k] = process.env[k];

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
    for (const k of GOVERNANCE_ENV_VARS) delete process.env[k];
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

describe("Integration AC 32.0.3 — the file reaches the gate, the resource, and the discovery view", () => {
  const env = makeEnvHarness();
  beforeEach(env.setup);
  afterEach(env.teardown);

  it("resource payload: { policy, configSource } — env keys report 'env', file keys 'file', untouched keys 'default'", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
    });
    const filePath = writeGovernanceFile(
      "policy.json",
      JSON.stringify({ global: { iris_new_write: true } }),
    );
    process.env.IRIS_GOVERNANCE_FILE = filePath;
    stageDefaultStartup(env.fetchMock);

    const tools = [makeEchoTool("iris_doc_get"), makeWriteTool("iris_new_write")];
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    const payload = await readGovernancePayload(server, "default");
    // Additive shape: exactly the two fields.
    expect(Object.keys(payload).sort()).toEqual(["configSource", "policy"]);
    // The env layer resolved iris_doc_get (false), the FILE layer resolved
    // iris_new_write (true, over the disabled seed).
    expect(payload.policy["iris_doc_get"]).toBe(false);
    expect(payload.policy["iris_new_write"]).toBe(true);
    expect(payload.configSource["iris_doc_get"]).toBe("env");
    expect(payload.configSource["iris_new_write"]).toBe("file");
    // An untouched grandfathered baseline key reports the seed channel.
    expect(payload.policy["iris_user_get"]).toBe(true);
    expect(payload.configSource["iris_user_get"]).toBe("default");
    // Every policy key has a source and vice versa (1-key-per-key invariant).
    expect(Object.keys(payload.configSource).sort()).toEqual(
      Object.keys(payload.policy).sort(),
    );
  });

  it("discovery view agrees with the resource (same policy + same configSource map)", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
    });
    const filePath = writeGovernanceFile(
      "policy.json",
      JSON.stringify({ global: { iris_new_write: true } }),
    );
    process.env.IRIS_GOVERNANCE_FILE = filePath;
    stageDefaultStartup(env.fetchMock);

    const tools = [makeEchoTool("iris_doc_get"), makeWriteTool("iris_new_write")];
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    const discovery = result.structuredContent as {
      governance: {
        policy: Record<string, boolean>;
        configSource: Record<string, GovernanceConfigSource>;
      };
    };
    const payload = await readGovernancePayload(server, "default");
    expect(discovery.governance.policy).toEqual(payload.policy);
    expect(discovery.governance.configSource).toEqual(payload.configSource);
    expect(discovery.governance.configSource["iris_new_write"]).toBe("file");
  });

  it("ORDERING DISCRIMINATOR at the gate: env.global=false + file.profile=true ⇒ the call is DENIED (env wins)", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE = JSON.stringify({
      global: { iris_doc_get: false },
    });
    const filePath = writeGovernanceFile(
      "policy.json",
      JSON.stringify({ profiles: { default: { iris_doc_get: true } } }),
    );
    process.env.IRIS_GOVERNANCE_FILE = filePath;
    stageDefaultStartup(env.fetchMock);

    const server = new McpServerBase(
      makeServerOpts([makeEchoTool("iris_doc_get")]),
    );
    await server.start("stdio");

    const denied = await callTool(server, "iris_doc_get", {});
    expect(denied.isError).toBe(true);
    expect(
      (denied.structuredContent as Record<string, unknown>).code,
    ).toBe("GOVERNANCE_DISABLED");
  });

  it("a FILE-layer enable reaches the gate (the file enables a seed-disabled write)", async () => {
    setDefaultEnv();
    const filePath = writeGovernanceFile(
      "policy.json",
      JSON.stringify({ profiles: { default: { iris_new_write: true } } }),
    );
    process.env.IRIS_GOVERNANCE_FILE = filePath;
    stageDefaultStartup(env.fetchMock);

    const server = new McpServerBase(makeServerOpts([makeWriteTool("iris_new_write")]));
    await server.start("stdio");

    const ok = await callTool(server, "iris_new_write", {});
    expect(ok.isError).toBeFalsy();
    expect((ok.content as Array<{ text: string }>)[0]!.text).toBe("ran");
  });

  it("denial attribution: a FILE-layer explicit false is NOT attributed to the preset (no presetApplied)", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    const filePath = writeGovernanceFile(
      "policy.json",
      JSON.stringify({ global: { iris_new_write: false } }),
    );
    process.env.IRIS_GOVERNANCE_FILE = filePath;
    stageDefaultStartup(env.fetchMock);

    const server = new McpServerBase(makeServerOpts([makeWriteTool("iris_new_write")]));
    await server.start("stdio");

    const denied = await callTool(server, "iris_new_write", {});
    expect(denied.isError).toBe(true);
    const sc = denied.structuredContent as Record<string, unknown>;
    expect(sc.code).toBe("GOVERNANCE_DISABLED");
    // The file (not the read-only preset) caused this denial — truthful
    // attribution (hasExplicitOverride counts the file layer).
    expect(sc.presetApplied).toBeUndefined();
  });

  it("denial attribution control: with the preset ALONE causing the denial, presetApplied IS present", async () => {
    setDefaultEnv();
    process.env.IRIS_GOVERNANCE_PRESET = "read-only";
    stageDefaultStartup(env.fetchMock);

    const server = new McpServerBase(makeServerOpts([makeWriteTool("iris_new_write")]));
    await server.start("stdio");

    const denied = await callTool(server, "iris_new_write", {});
    const sc = denied.structuredContent as Record<string, unknown>;
    expect(sc.code).toBe("GOVERNANCE_DISABLED");
    expect(sc.presetApplied).toBe("read-only");
  });

  it("hidden-tool key omission covers configSource (Epic 30 unchanged): a hidden tool's key leaks through NEITHER field", async () => {
    setDefaultEnv();
    const filePath = writeGovernanceFile(
      "policy.json",
      JSON.stringify({ global: { iris_new_write: true } }),
    );
    process.env.IRIS_GOVERNANCE_FILE = filePath;
    process.env.IRIS_TOOLS_DISABLE = "iris_new_write";
    stageDefaultStartup(env.fetchMock);

    const tools = [makeEchoTool("iris_doc_get"), makeWriteTool("iris_new_write")];
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    const payload = await readGovernancePayload(server, "default");
    expect(
      Object.prototype.hasOwnProperty.call(payload.policy, "iris_new_write"),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(payload.configSource, "iris_new_write"),
    ).toBe(false);

    const result = await callTool(server, SERVER_DISCOVERY_TOOL_NAME, {});
    const discovery = result.structuredContent as {
      governance: {
        policy: Record<string, boolean>;
        configSource: Record<string, GovernanceConfigSource>;
      };
    };
    expect(
      Object.prototype.hasOwnProperty.call(discovery.governance.policy, "iris_new_write"),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(
        discovery.governance.configSource,
        "iris_new_write",
      ),
    ).toBe(false);
  });

  it("startup FAILS FAST when IRIS_GOVERNANCE_FILE points at a missing file (never silently permissive)", async () => {
    setDefaultEnv();
    const missing = join(tempDir, "missing.json");
    process.env.IRIS_GOVERNANCE_FILE = missing;

    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    try {
      await server.start("stdio");
      throw new Error("start() should have rejected");
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      expect(message).toMatch(/^IRIS_GOVERNANCE_FILE is invalid: /);
      expect(message).toContain(missing);
      expect(message).toContain("ENOENT");
    }
  });

  it("startup FAILS FAST on a malformed governance file", async () => {
    setDefaultEnv();
    const p = writeGovernanceFile("bad.json", "{ nope ");
    process.env.IRIS_GOVERNANCE_FILE = p;

    const server = new McpServerBase(makeServerOpts([makeEchoTool("iris_doc_get")]));
    await expect(server.start("stdio")).rejects.toThrow(
      /^IRIS_GOVERNANCE_FILE is invalid: could not parse JSON/,
    );
  });

  it("unset IRIS_GOVERNANCE_FILE ⇒ the resolved policy is byte-identical to the pre-feature baseline behavior (server-level Rule #19)", async () => {
    setDefaultEnv();
    stageDefaultStartup(env.fetchMock);

    const tools = [makeEchoTool("iris_doc_get"), makeWriteTool("iris_new_write")];
    const server = new McpServerBase(makeServerOpts(tools));
    await server.start("stdio");

    const payload = await readGovernancePayload(server, "default");
    // No file ⇒ no key reports 'file'; the seed-disabled write stays disabled.
    expect(payload.policy["iris_new_write"]).toBe(false);
    expect(payload.policy["iris_doc_get"]).toBe(true);
    for (const source of Object.values(payload.configSource)) {
      expect(source).not.toBe("file");
    }
    // The policy map is EXACTLY what getEffectivePolicy computes for an empty
    // config over the server's visible keys (the pre-feature behavior), given
    // the SAME mutatesLookup the server builds from its registered tools.
    const { buildMutatesLookup } = await import("../governance.js");
    const expected = getEffectivePolicy(
      "default",
      {},
      Object.keys(payload.policy),
      buildMutatesLookup([...tools, serverDiscoveryTool]),
      GOVERNANCE_BASELINE,
    );
    expect(payload.policy).toEqual(expected);
  });
});
