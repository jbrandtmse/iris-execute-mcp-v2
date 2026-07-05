import { describe, it, expect } from "vitest";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createHash } from "crypto";
import {
  parseGovernanceConfig,
  buildMutatesLookup,
  buildDefaultEnabledWrites,
  defaultSeed,
  effective,
  getEffectivePolicy,
} from "../governance.js";
import type { GovernanceConfig, MutatesLookup } from "../governance.js";
import {
  GOVERNANCE_BASELINE,
  GOVERNANCE_BASELINE_HASH,
} from "../governance-baseline.js";
import type { ToolDefinition } from "../tool-types.js";
// Shared key-derivation + drift constants (CR 16.0-1): the drift guard below now uses the
// SAME per-tool derivation the generator uses, so the two can never disagree.
import {
  deriveKeysForTool,
  SERVER_PACKAGES,
  VANISHED_HINT,
} from "../governance-baseline-derivation.js";

// ════════════════════════════════════════════════════════════════════
// Governance policy engine (Epic 14, Story 14.3 — architecture D3/D4/D7).
//
// PURE functions: no live IRIS, no mocked fetch. The cascade matrix is
// exercised with SYNTHETIC baseline + `mutates` fixtures (Epic 14 adds no
// real new actions — AC 14.3.5). The back-compat proof (AC 14.3.7) and the
// drift guard run against the REAL generated baseline / live tool registries.
// ════════════════════════════════════════════════════════════════════

// ── Synthetic fixtures for the cascade matrix (AC 14.3.5) ────────────
//
// A small invented world that stands in for "the tool surface": two
// pre-existing (grandfathered) keys and two NEW keys (one read, one write).
// Using a synthetic baseline keeps the cascade logic provable without
// depending on the real 141-key baseline or inventing classifications for
// existing tools (forbidden by the Epic-14 reality check).

const SYNTH_BASELINE: ReadonlySet<string> = new Set([
  "iris_old_tool", // pre-existing single-op (grandfathered)
  "iris_old_manage:create", // pre-existing action (grandfathered)
]);

/** New actions and their mutation classes (would arrive in Epics 15–17). */
const SYNTH_MUTATES: MutatesLookup = new Map<string, "read" | "write">([
  ["iris_new_tool:read", "read"], // new read action → seed enabled
  ["iris_new_tool:write", "write"], // new write action → seed disabled
]);

/** All keys in the synthetic world (baseline ∪ new). */
const SYNTH_ALL_KEYS = [
  "iris_old_tool",
  "iris_old_manage:create",
  "iris_new_tool:read",
  "iris_new_tool:write",
];

const EMPTY_CONFIG: GovernanceConfig = {};

// ── parseGovernanceConfig (AC 14.3.2, D7) ────────────────────────────

describe("parseGovernanceConfig", () => {
  it("returns an empty config when IRIS_GOVERNANCE is unset", () => {
    expect(parseGovernanceConfig({})).toEqual({});
  });

  it("returns an empty config when IRIS_GOVERNANCE is the empty string", () => {
    expect(parseGovernanceConfig({ IRIS_GOVERNANCE: "" })).toEqual({});
  });

  it("parses a global-only policy", () => {
    const cfg = parseGovernanceConfig({
      IRIS_GOVERNANCE: JSON.stringify({
        global: { "iris_x_manage:delete": false, iris_y: true },
      }),
    });
    expect(cfg).toEqual({
      global: { "iris_x_manage:delete": false, iris_y: true },
    });
  });

  it("parses a profiles-only policy", () => {
    const cfg = parseGovernanceConfig({
      IRIS_GOVERNANCE: JSON.stringify({
        profiles: { prod: { "iris_x_manage:delete": false } },
      }),
    });
    expect(cfg).toEqual({
      profiles: { prod: { "iris_x_manage:delete": false } },
    });
  });

  it("parses a combined global + profiles policy", () => {
    const cfg = parseGovernanceConfig({
      IRIS_GOVERNANCE: JSON.stringify({
        global: { iris_a: false },
        profiles: { prod: { iris_a: true }, staging: { iris_b: false } },
      }),
    });
    expect(cfg.global).toEqual({ iris_a: false });
    expect(cfg.profiles?.prod).toEqual({ iris_a: true });
    expect(cfg.profiles?.staging).toEqual({ iris_b: false });
  });

  it("preserves explicit false values (does not drop them)", () => {
    const cfg = parseGovernanceConfig({
      IRIS_GOVERNANCE: JSON.stringify({ global: { iris_a: false } }),
    });
    expect(cfg.global).toHaveProperty("iris_a", false);
  });

  // Fail-fast cases — every error message must name IRIS_GOVERNANCE.

  it("fails fast naming IRIS_GOVERNANCE on malformed JSON", () => {
    expect(() => parseGovernanceConfig({ IRIS_GOVERNANCE: "{ not json" })).toThrow(
      /IRIS_GOVERNANCE/,
    );
  });

  it("fails fast when the root is not a JSON object (array)", () => {
    expect(() =>
      parseGovernanceConfig({ IRIS_GOVERNANCE: "[1,2,3]" }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast when the root is a JSON primitive", () => {
    expect(() => parseGovernanceConfig({ IRIS_GOVERNANCE: "42" })).toThrow(
      /IRIS_GOVERNANCE/,
    );
  });

  it("fails fast when global is not an object", () => {
    expect(() =>
      parseGovernanceConfig({
        IRIS_GOVERNANCE: JSON.stringify({ global: [1, 2] }),
      }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast when profiles is not an object", () => {
    expect(() =>
      parseGovernanceConfig({
        IRIS_GOVERNANCE: JSON.stringify({ profiles: "nope" }),
      }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast when a single profile is not an object", () => {
    expect(() =>
      parseGovernanceConfig({
        IRIS_GOVERNANCE: JSON.stringify({ profiles: { prod: 5 } }),
      }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast (naming the var) when a global value is non-boolean", () => {
    // A common typo: a quoted "true" string instead of the boolean.
    expect(() =>
      parseGovernanceConfig({
        IRIS_GOVERNANCE: JSON.stringify({ global: { iris_a: "true" } }),
      }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast when a profile value is non-boolean", () => {
    expect(() =>
      parseGovernanceConfig({
        IRIS_GOVERNANCE: JSON.stringify({
          profiles: { prod: { iris_a: 1 } },
        }),
      }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });
});

// ── buildMutatesLookup (D4) ──────────────────────────────────────────

describe("buildMutatesLookup", () => {
  /**
   * Minimal ToolDefinition stub — only the fields the lookup reads. `mutates`
   * is set only when provided (omitted, not set to `undefined`, so the stub is
   * valid under `exactOptionalPropertyTypes`), mirroring how a grandfathered
   * tool simply has no `mutates` field.
   */
  function stub(
    name: string,
    mutates?: ToolDefinition["mutates"],
  ): ToolDefinition {
    const def: ToolDefinition = {
      name,
      // The remaining fields are required by the type but unused here.
      title: name,
      description: name,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      inputSchema: {} as any,
      annotations: {},
      scope: "NS",
      handler: async () => ({ content: [{ type: "text", text: "" }] }),
    };
    if (mutates !== undefined) def.mutates = mutates;
    return def;
  }

  it("ignores tools that omit mutates (grandfathered)", () => {
    const lookup = buildMutatesLookup([stub("iris_old")]);
    expect(lookup.size).toBe(0);
  });

  it("maps a scalar mutates to the bare tool name", () => {
    const lookup = buildMutatesLookup([
      stub("iris_single_read", "read"),
      stub("iris_single_write", "write"),
    ]);
    expect(lookup.get("iris_single_read")).toBe("read");
    expect(lookup.get("iris_single_write")).toBe("write");
    expect(lookup.size).toBe(2);
  });

  it("maps a per-action record to tool:action keys", () => {
    const lookup = buildMutatesLookup([
      stub("iris_multi", { get: "read", set: "write", drop: "write" }),
    ]);
    expect(lookup.get("iris_multi:get")).toBe("read");
    expect(lookup.get("iris_multi:set")).toBe("write");
    expect(lookup.get("iris_multi:drop")).toBe("write");
    expect(lookup.size).toBe(3);
  });

  it("flattens a mix of scalar and per-action tools", () => {
    const lookup = buildMutatesLookup([
      stub("iris_a", "read"),
      stub("iris_b", { create: "write" }),
      stub("iris_grandfathered"),
    ]);
    expect([...lookup.entries()].sort()).toEqual([
      ["iris_a", "read"],
      ["iris_b:create", "write"],
    ]);
  });
});

// ── defaultSeed (AC 14.3.3, D3) ──────────────────────────────────────

describe("defaultSeed", () => {
  it("enables a key present in the baseline (grandfathered)", () => {
    expect(defaultSeed("iris_old_tool", SYNTH_MUTATES, SYNTH_BASELINE)).toBe(
      true,
    );
    expect(
      defaultSeed("iris_old_manage:create", SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true);
  });

  it("enables a NEW read action", () => {
    expect(
      defaultSeed("iris_new_tool:read", SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true);
  });

  it("disables a NEW write action", () => {
    expect(
      defaultSeed("iris_new_tool:write", SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(false);
  });

  it("enables an unknown key with no mutates classification (fail-open to enabled)", () => {
    // Not in baseline, not in the mutates lookup → treated as a read → enabled.
    expect(
      defaultSeed("iris_unknown:thing", SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// effective() — the cascade matrix (AC 14.3.4, AC 14.3.5).
// effective = profile.explicit ?? global.explicit ?? defaultSeed
// ════════════════════════════════════════════════════════════════════

describe("effective cascade (AC 14.3.5 matrix)", () => {
  it("default-seed only: no config → seed governs every key", () => {
    expect(
      effective("iris_old_tool", "prod", EMPTY_CONFIG, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true); // grandfathered
    expect(
      effective("iris_new_tool:read", "prod", EMPTY_CONFIG, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true); // new read
    expect(
      effective("iris_new_tool:write", "prod", EMPTY_CONFIG, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(false); // new write
  });

  it("global-enable of a new write action overrides the disabled seed", () => {
    const cfg: GovernanceConfig = {
      global: { "iris_new_tool:write": true },
    };
    expect(
      effective("iris_new_tool:write", "prod", cfg, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true);
  });

  it("profile override DOWN: disables a globally/seed-enabled action", () => {
    const cfg: GovernanceConfig = {
      profiles: { prod: { iris_old_tool: false } },
    };
    // prod sees it disabled…
    expect(
      effective("iris_old_tool", "prod", cfg, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(false);
    // …but another profile still inherits the enabled seed.
    expect(
      effective("iris_old_tool", "staging", cfg, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true);
  });

  it("profile override UP: re-enables a globally-disabled action", () => {
    const cfg: GovernanceConfig = {
      global: { iris_old_tool: false },
      profiles: { prod: { iris_old_tool: true } },
    };
    // prod re-enables…
    expect(
      effective("iris_old_tool", "prod", cfg, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true);
    // …while staging inherits the global disable.
    expect(
      effective("iris_old_tool", "staging", cfg, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(false);
  });

  it("silent profile inherits the global layer", () => {
    const cfg: GovernanceConfig = {
      global: { "iris_new_tool:write": true },
      profiles: { staging: { iris_old_tool: false } }, // says nothing about the write key
    };
    // staging has overrides but none for this key → inherits global true.
    expect(
      effective("iris_new_tool:write", "staging", cfg, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true);
    // A profile with NO entry in `profiles` at all also inherits global.
    expect(
      effective("iris_new_tool:write", "absent-profile", cfg, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true);
  });

  it("unknown-action handling: falls through to the seed (enabled, read-default)", () => {
    expect(
      effective("iris_unknown:thing", "prod", EMPTY_CONFIG, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(true);
  });

  // ── Nullish-coalescing correctness (the load-bearing `??` vs `||`) ──

  it("honors an explicit profile `false` over a default-true (NOT treated as unset)", () => {
    const cfg: GovernanceConfig = {
      profiles: { prod: { iris_old_tool: false } },
    };
    // With `||`, false would be skipped and the enabled seed would win — wrong.
    // With `??`, the explicit false is honored.
    expect(
      effective("iris_old_tool", "prod", cfg, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(false);
  });

  it("honors an explicit global `false` over a default-true", () => {
    const cfg: GovernanceConfig = { global: { iris_old_tool: false } };
    expect(
      effective("iris_old_tool", "prod", cfg, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(false);
  });

  it("profile `false` wins even when global is `true` (top-of-cascade precedence)", () => {
    const cfg: GovernanceConfig = {
      global: { "iris_new_tool:write": true },
      profiles: { prod: { "iris_new_tool:write": false } },
    };
    expect(
      effective("iris_new_tool:write", "prod", cfg, SYNTH_MUTATES, SYNTH_BASELINE),
    ).toBe(false);
  });
});

// ── getEffectivePolicy (AC 14.3.6) ───────────────────────────────────

describe("getEffectivePolicy", () => {
  it("returns the full enabled/disabled map over all keys for a profile", () => {
    const policy = getEffectivePolicy(
      "prod",
      EMPTY_CONFIG,
      SYNTH_ALL_KEYS,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
    );
    expect(policy).toEqual({
      iris_old_tool: true,
      "iris_old_manage:create": true,
      "iris_new_tool:read": true,
      "iris_new_tool:write": false, // new write disabled by seed
    });
  });

  it("reflects per-profile overrides in the map", () => {
    const cfg: GovernanceConfig = {
      global: { "iris_new_tool:write": true },
      profiles: { prod: { iris_old_tool: false } },
    };
    const prod = getEffectivePolicy(
      "prod",
      cfg,
      SYNTH_ALL_KEYS,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
    );
    expect(prod["iris_old_tool"]).toBe(false); // profile override down
    expect(prod["iris_new_tool:write"]).toBe(true); // inherits global enable

    const staging = getEffectivePolicy(
      "staging",
      cfg,
      SYNTH_ALL_KEYS,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
    );
    expect(staging["iris_old_tool"]).toBe(true); // inherits enabled seed
    expect(staging["iris_new_tool:write"]).toBe(true); // inherits global enable
  });

  it("includes a key for every entry in allKeys (no omissions)", () => {
    const policy = getEffectivePolicy(
      "prod",
      EMPTY_CONFIG,
      SYNTH_ALL_KEYS,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
    );
    for (const key of SYNTH_ALL_KEYS) {
      expect(policy).toHaveProperty(key);
    }
    expect(Object.keys(policy).length).toBe(SYNTH_ALL_KEYS.length);
  });
});

// ════════════════════════════════════════════════════════════════════
// AC 14.3.7 — PROVABLE BACK-COMPAT (release-critical mechanical proof).
//
// Under an EMPTY IRIS_GOVERNANCE, EVERY key in the REAL generated baseline
// must resolve to ENABLED. This is the gate that proves "no existing
// capability is disabled by default" — the strictly-additive guarantee for
// the suite's live users.
// ════════════════════════════════════════════════════════════════════

describe("back-compat proof — empty IRIS_GOVERNANCE enables every baseline action (AC 14.3.7)", () => {
  it("parses empty IRIS_GOVERNANCE to an empty config", () => {
    expect(parseGovernanceConfig({})).toEqual({});
  });

  it("getEffectivePolicy(default) enables EVERY baseline key under empty config", () => {
    const config = parseGovernanceConfig({}); // empty
    // No mutates lookup is needed: every baseline key is grandfathered.
    const emptyMutates: MutatesLookup = new Map();
    const policy = getEffectivePolicy(
      "default",
      config,
      GOVERNANCE_BASELINE, // the REAL 141-key baseline
      emptyMutates,
      GOVERNANCE_BASELINE,
    );

    // Every baseline key present and enabled.
    expect(Object.keys(policy).length).toBe(GOVERNANCE_BASELINE.size);
    const disabled = Object.entries(policy)
      .filter(([, enabled]) => !enabled)
      .map(([key]) => key);
    expect(disabled).toEqual([]);
  });

  it("holds for an arbitrary non-default profile too (no IRIS_GOVERNANCE = identical for all profiles)", () => {
    const config = parseGovernanceConfig({});
    const emptyMutates: MutatesLookup = new Map();
    for (const profile of ["default", "prod", "any-other-profile"]) {
      const policy = getEffectivePolicy(
        profile,
        config,
        GOVERNANCE_BASELINE,
        emptyMutates,
        GOVERNANCE_BASELINE,
      );
      const allEnabled = Object.values(policy).every((v) => v === true);
      expect(allEnabled, `profile "${profile}" must enable every baseline key`).toBe(
        true,
      );
    }
  });

  it("each baseline key individually defaults to enabled (effective + seed)", () => {
    const emptyMutates: MutatesLookup = new Map();
    for (const key of GOVERNANCE_BASELINE) {
      expect(defaultSeed(key, emptyMutates), `seed(${key})`).toBe(true);
      expect(
        effective(key, "default", {}, emptyMutates),
        `effective(${key})`,
      ).toBe(true);
    }
  });
});

// ════════════════════════════════════════════════════════════════════
// Frozen-foundation baseline drift guard (AC 14.3.7 + Story 15.1 AC 15.1.7,
// Rule #18, Rule #20).
//
// GOVERNANCE_BASELINE is a FROZEN Epic-14 FOUNDATION snapshot (141 keys, hash
// 1e62c5ad5bf7), NOT a live mirror of every tool. The drift check is therefore
// ONE-DIRECTIONAL (architecture decision, lead 2026-06-16, frozen-foundation
// model):
//
//   - RETAINED — every committed FOUNDATION key must still exist in the live
//     derived surface. A vanished foundation key is a real regression (a
//     grandfathered action would lose its enabled-by-default guarantee), so the
//     `extra` (committed-but-no-longer-in-tools) assertion stays.
//   - REPLACED — the former `missing` assertion (live keys absent from the
//     committed baseline) is now an EXPLICIT ALLOWANCE: new post-foundation tool
//     keys (Epic 15+ tools, e.g. `iris_service_manage:enable`) are EXPECTED to
//     live outside the frozen baseline. They are governed by `mutates` +
//     defaultSeed (new write → disabled, new read → enabled), NOT by baseline
//     membership, so they must NOT be added to the frozen foundation.
//
// The hash-self-consistency test (baseline ↔ GOVERNANCE_BASELINE_HASH) and the
// sorted-keys test below are RETAINED unchanged.
// ════════════════════════════════════════════════════════════════════

describe("governance baseline drift check", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // packages/shared/src/__tests__/ → repo root is 4 levels up.
  const repoRoot = resolve(__dirname, "../../../..");

  // SERVER_PACKAGES and VANISHED_HINT are imported from the shared derivation module
  // (single source of truth with the generator — CR 16.0-1; also resolves the former
  // "SERVER_PACKAGES duplicated across generator + drift test, kept in sync by comment").

  /**
   * Re-derive the live governance keys from the built server dists using the SHARED
   * per-tool derivation ({@link deriveKeysForTool}) — the same one the generator uses — so
   * this drift guard and the CLI `--check` can never diverge on a wrapped/edge action
   * shape (CR 16.0-1, closing the former bare-`.options`-read lock-step gap).
   */
  async function deriveBaselineFromDists(): Promise<Set<string>> {
    const keys = new Set<string>();
    for (const pkg of SERVER_PACKAGES) {
      const distEntry = resolve(repoRoot, `packages/${pkg}/dist/tools/index.js`);
      const mod = await import(pathToFileURL(distEntry).href);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools = mod.tools as any[];
      for (const tool of tools) {
        for (const key of deriveKeysForTool(tool, pkg)) keys.add(key);
      }
    }
    return keys;
  }

  it("every FROZEN foundation key still exists in the live tool surface (one-directional)", async () => {
    const fresh = await deriveBaselineFromDists();
    const committed = new Set(GOVERNANCE_BASELINE);

    // RETAINED: a committed foundation key that no longer appears in the live
    // surface is a real regression — assert there are none.
    const vanished = [...committed].filter((k) => !fresh.has(k)).sort();
    expect(
      vanished,
      `Governance foundation is BROKEN (frozen foundation keys missing from live tools) — ${VANISHED_HINT}`,
    ).toEqual([]);

    // REPLACED (was the bidirectional `missing` assertion): live keys NOT in the
    // committed baseline are NEW post-foundation tool keys (Epic 15+). They are
    // EXPECTED to live outside the frozen foundation and are governed by
    // `mutates` + defaultSeed, not baseline membership. So we make NO assertion
    // that they appear in the baseline — only document the allowance here.
    const postFoundation = [...fresh].filter((k) => !committed.has(k)).sort();
    // (No assertion on `postFoundation`: it may legitimately be non-empty.)
    void postFoundation;
    // 30s timeout: this test dynamically imports all five built server dists (real module
    // I/O), which can exceed vitest's 5s default under the full parallel `pnpm test` turbo
    // load (it passes comfortably in isolation).
  }, 30000);

  it("committed GOVERNANCE_BASELINE_HASH matches the SHA-256 of the sorted baseline", () => {
    // Re-compute the hash with the same formula as gen-governance-baseline.mjs
    // from the COMMITTED set, so this also catches a hand-edited file whose
    // hash wasn't recomputed.
    const sorted = [...GOVERNANCE_BASELINE].sort();
    const hasher = createHash("sha256");
    for (const key of sorted) {
      hasher.update(key);
      hasher.update("\n");
    }
    const expectedHash = hasher.digest("hex").substring(0, 12);
    expect(
      GOVERNANCE_BASELINE_HASH,
      "GOVERNANCE_BASELINE_HASH drift — the committed frozen-foundation hash no longer " +
        "matches the SHA-256 of GOVERNANCE_BASELINE's sorted keys. The frozen foundation " +
        "must stay 1e62c5ad5bf7; do NOT hand-edit governance-baseline.ts (Rule #18).",
    ).toBe(expectedHash);
  });

  it("baseline keys are sorted (deterministic output for clean diffs)", () => {
    const arr = [...GOVERNANCE_BASELINE];
    const sorted = [...arr].sort();
    expect(arr).toEqual(sorted);
  });
});

// ════════════════════════════════════════════════════════════════════
// "Write, default-enabled" mechanism (Epic 20, architecture decision F2).
//
// A new orthogonal marker (`defaultEnabled`) lets a truthful `write` action
// seed to ENABLED without misclassifying it as a read and without touching
// the frozen baseline. Threaded as an OPTIONAL, DEFAULT-EMPTY param through
// defaultSeed/effective/getEffectivePolicy — empty set ⇒ byte-for-byte the
// pre-F2 seed (AC 20.0.5a back-compat gate).
// ════════════════════════════════════════════════════════════════════

/** A minimal ToolDefinition fixture for buildDefaultEnabledWrites. */
function fixtureTool(
  name: string,
  extra: Partial<ToolDefinition>,
): ToolDefinition {
  return {
    name,
    title: name,
    description: name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    inputSchema: {} as any,
    annotations: {},
    scope: "NS",
    handler: async () => ({ content: [{ type: "text", text: "" }] }),
    ...extra,
  };
}

describe("buildDefaultEnabledWrites (F2)", () => {
  it("returns an empty set when no tool declares defaultEnabled", () => {
    const set = buildDefaultEnabledWrites([
      fixtureTool("iris_a", { mutates: "read" }),
      fixtureTool("iris_b_manage", { mutates: { create: "write" } }),
    ]);
    expect(set.size).toBe(0);
  });

  it("collects tool:action keys for each declared defaultEnabled action", () => {
    const set = buildDefaultEnabledWrites([
      fixtureTool("iris_production_control", {
        mutates: { clean: "write" },
        defaultEnabled: ["clean"],
      }),
      fixtureTool("iris_multi", {
        mutates: { a: "write", b: "write" },
        defaultEnabled: ["a", "b"],
      }),
    ]);
    expect([...set].sort()).toEqual([
      "iris_multi:a",
      "iris_multi:b",
      "iris_production_control:clean",
    ]);
  });

  it("throws on a reserved defaultEnabled action key", () => {
    expect(() =>
      buildDefaultEnabledWrites([
        fixtureTool("iris_x", { defaultEnabled: ["__proto__"] }),
      ]),
    ).toThrow(/reserved/);
  });

  // Story 20.0 review (findings #1/#2): fail-fast cross-validation so a typo or
  // drift between `defaultEnabled` and `mutates` cannot silently ship the intended
  // write default-DISABLED (an inert `tool:action` key matching no real write).

  it("throws when a defaultEnabled action is absent from mutates (drift/typo)", () => {
    expect(() =>
      buildDefaultEnabledWrites([
        fixtureTool("iris_production_control", {
          mutates: { clean: "write" },
          defaultEnabled: ["clena"], // typo — not in mutates
        }),
      ]),
    ).toThrow(/does not\s+classify "clena" as "write"|no entry/);
  });

  it("throws when a defaultEnabled action is classified read, not write", () => {
    expect(() =>
      buildDefaultEnabledWrites([
        fixtureTool("iris_x", {
          mutates: { peek: "read" },
          defaultEnabled: ["peek"],
        }),
      ]),
    ).toThrow(/"write"/);
  });

  it("throws when defaultEnabled is used with a scalar mutates (unaddressable)", () => {
    expect(() =>
      buildDefaultEnabledWrites([
        fixtureTool("iris_scalar", {
          mutates: "write",
          defaultEnabled: ["go"],
        }),
      ]),
    ).toThrow(/per-action `mutates` record/);
  });

  it("throws when defaultEnabled is used with no mutates at all", () => {
    expect(() =>
      buildDefaultEnabledWrites([
        fixtureTool("iris_nomutates", { defaultEnabled: ["go"] }),
      ]),
    ).toThrow(/per-action `mutates` record/);
  });
});

describe("defaultSeed with defaultEnabledWrites (F2)", () => {
  const mutates: MutatesLookup = new Map<string, "read" | "write">([
    ["iris_production_control:clean", "write"],
    ["iris_other_manage:delete", "write"],
  ]);
  const baseline: ReadonlySet<string> = new Set();

  it("a write in the set seeds ENABLED", () => {
    const set = new Set(["iris_production_control:clean"]);
    expect(
      defaultSeed("iris_production_control:clean", mutates, baseline, set),
    ).toBe(true);
  });

  it("a write NOT in the set still seeds DISABLED", () => {
    const set = new Set(["iris_production_control:clean"]);
    expect(defaultSeed("iris_other_manage:delete", mutates, baseline, set)).toBe(
      false,
    );
  });

  it("empty set ⇒ byte-for-byte pre-F2 seed (writes disabled)", () => {
    // No 4th arg AND explicit empty set must both give the pre-F2 result.
    expect(defaultSeed("iris_production_control:clean", mutates, baseline)).toBe(
      false,
    );
    expect(
      defaultSeed(
        "iris_production_control:clean",
        mutates,
        baseline,
        new Set(),
      ),
    ).toBe(false);
  });

  it("the set never enables a NON-write (read stays enabled; not gated by the set)", () => {
    const readMutates: MutatesLookup = new Map([["iris_r:read", "read"]]);
    // A read key that is (nonsensically) in the set: it is already enabled as a
    // read, and the set only flips WRITES, so behavior is unchanged.
    expect(
      defaultSeed("iris_r:read", readMutates, baseline, new Set(["iris_r:read"])),
    ).toBe(true);
  });
});

describe("F2 back-compat: empty set is byte-for-byte across the cascade (AC 20.0.5a)", () => {
  it("effective() with empty set == effective() without the param", () => {
    for (const key of SYNTH_ALL_KEYS) {
      const withParam = effective(
        key,
        "default",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
        new Set(),
      );
      const without = effective(
        key,
        "default",
        EMPTY_CONFIG,
        SYNTH_MUTATES,
        SYNTH_BASELINE,
      );
      expect(withParam).toBe(without);
    }
  });

  it("getEffectivePolicy() with empty set deep-equals the no-param policy", () => {
    const withParam = getEffectivePolicy(
      "default",
      EMPTY_CONFIG,
      SYNTH_ALL_KEYS,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
      new Set(),
    );
    const without = getEffectivePolicy(
      "default",
      EMPTY_CONFIG,
      SYNTH_ALL_KEYS,
      SYNTH_MUTATES,
      SYNTH_BASELINE,
    );
    expect(withParam).toEqual(without);
    // And the synthetic new write is still DISABLED (nothing opted in).
    expect(withParam["iris_new_tool:write"]).toBe(false);
  });
});

describe("F2 all-other-writes-still-disabled sweep (AC 20.0.5a)", () => {
  // A synthetic world with THREE new writes; only ONE opts into defaultEnabled.
  const mutates: MutatesLookup = new Map<string, "read" | "write">([
    ["iris_p_control:clean", "write"],
    ["iris_p_item:add", "write"],
    ["iris_p_item:remove", "write"],
    ["iris_p_read:get", "read"],
  ]);
  const baseline: ReadonlySet<string> = new Set(["iris_grandfathered:go"]);
  const allKeys = [
    "iris_grandfathered:go",
    "iris_p_control:clean",
    "iris_p_item:add",
    "iris_p_item:remove",
    "iris_p_read:get",
  ];
  const defaultEnabledWrites = new Set(["iris_p_control:clean"]);

  it("exactly the opted-in write flips to enabled; every OTHER write stays disabled", () => {
    const policy = getEffectivePolicy(
      "default",
      EMPTY_CONFIG,
      allKeys,
      mutates,
      baseline,
      defaultEnabledWrites,
    );
    // The one opted-in write: enabled.
    expect(policy["iris_p_control:clean"]).toBe(true);
    // Every OTHER write: still disabled (the sweep).
    expect(policy["iris_p_item:add"]).toBe(false);
    expect(policy["iris_p_item:remove"]).toBe(false);
    // Grandfathered + reads: enabled as always.
    expect(policy["iris_grandfathered:go"]).toBe(true);
    expect(policy["iris_p_read:get"]).toBe(true);
  });

  it("an explicit false override still disables the opted-in write (cascade wins)", () => {
    const policy = getEffectivePolicy(
      "default",
      { global: { "iris_p_control:clean": false } },
      allKeys,
      mutates,
      baseline,
      defaultEnabledWrites,
    );
    expect(policy["iris_p_control:clean"]).toBe(false);
  });
});
