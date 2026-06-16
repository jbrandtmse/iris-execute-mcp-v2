import { describe, it, expect } from "vitest";
import { resolve, dirname } from "path";
import { fileURLToPath, pathToFileURL } from "url";
import { createHash } from "crypto";
import {
  parseGovernanceConfig,
  buildMutatesLookup,
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
// Baseline drift guard (AC 14.3.7, Rule #18).
//
// The committed governance-baseline.ts MUST match a fresh generation from
// the live tool registries. Mirrors the bootstrap drift check: re-derive
// the baseline from the BUILT server dists (exactly as
// scripts/gen-governance-baseline.mjs does) and compare to the committed
// GOVERNANCE_BASELINE + hash. Fails with a clear "regenerate" message so a
// dev who adds a tool/action without regenerating is caught.
// ════════════════════════════════════════════════════════════════════

describe("governance baseline drift check", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  // packages/shared/src/__tests__/ → repo root is 4 levels up.
  const repoRoot = resolve(__dirname, "../../../..");

  // MUST stay in sync with scripts/gen-governance-baseline.mjs.
  const SERVER_PACKAGES = [
    "iris-dev-mcp",
    "iris-admin-mcp",
    "iris-interop-mcp",
    "iris-ops-mcp",
    "iris-data-mcp",
  ];

  const REGEN_HINT =
    "run `pnpm turbo run build && pnpm run gen:governance-baseline` and commit packages/shared/src/governance-baseline.ts";

  /** Re-derive the baseline keys from the built server dists. */
  async function deriveBaselineFromDists(): Promise<Set<string>> {
    const keys = new Set<string>();
    for (const pkg of SERVER_PACKAGES) {
      const distEntry = resolve(repoRoot, `packages/${pkg}/dist/tools/index.js`);
      const mod = await import(pathToFileURL(distEntry).href);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tools = mod.tools as any[];
      for (const tool of tools) {
        const options = tool.inputSchema?.shape?.action?.options;
        if (Array.isArray(options) && options.length > 0) {
          for (const value of options) keys.add(`${tool.name}:${value}`);
        } else {
          keys.add(tool.name);
        }
      }
    }
    return keys;
  }

  it("committed GOVERNANCE_BASELINE matches a fresh derivation from built dists", async () => {
    const fresh = await deriveBaselineFromDists();
    const committed = new Set(GOVERNANCE_BASELINE);

    const missing = [...fresh].filter((k) => !committed.has(k)).sort();
    const extra = [...committed].filter((k) => !fresh.has(k)).sort();

    expect(
      missing,
      `Governance baseline is STALE (missing keys present in tools but not committed) — ${REGEN_HINT}`,
    ).toEqual([]);
    expect(
      extra,
      `Governance baseline is STALE (committed keys no longer in tools) — ${REGEN_HINT}`,
    ).toEqual([]);
  });

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
      `GOVERNANCE_BASELINE_HASH drift — ${REGEN_HINT}`,
    ).toBe(expectedHash);
  });

  it("baseline keys are sorted (deterministic output for clean diffs)", () => {
    const arr = [...GOVERNANCE_BASELINE];
    const sorted = [...arr].sort();
    expect(arr).toEqual(sorted);
  });
});
