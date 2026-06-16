import { describe, it, expect } from "vitest";
import { z } from "zod";
import {
  parseGovernanceConfig,
  buildMutatesLookup,
  defaultSeed,
  effective,
  getEffectivePolicy,
} from "../governance.js";
import type { GovernanceConfig, MutatesLookup } from "../governance.js";
import { GOVERNANCE_BASELINE } from "../governance-baseline.js";
import type { ToolDefinition } from "../tool-types.js";

// ════════════════════════════════════════════════════════════════════
// QA complementary edge-case coverage — Story 14.3 (architecture D3/D4/D7).
//
// COMPLEMENTS packages/shared/src/__tests__/governance.test.ts (the dev's 41
// tests) — does NOT duplicate it. Every assertion here was confirmed against
// the real engine before being written. All fixtures are SYNTHETIC; the
// generated baseline (governance-baseline.ts) is treated as output-only
// (Rule #18) and is never mutated — the engine functions take a `baseline`
// argument, so synthetic baselines drive every cascade case.
//
// Gap areas targeted (from the QA brief):
//   1. parseGovernanceConfig edge cases not in the dev's set.
//   2. defaultSeed / cascade key-collision + baseline-vs-mutates precedence.
//   3. getEffectivePolicy 3-layer resolution over a baseline ∪ synthetic union.
//   4. buildMutatesLookup scalar / per-action / grandfathered / empty-record mix.
//   5. AC 14.3.7 back-compat proof restated independently (does not weaken
//      the dev's version).
//   6. Generator introspection contract: z.string() action ⇒ bare key,
//      empty enum ⇒ bare key (sane) — replicated on synthetic z schemas, NOT
//      by importing built dists (so this file never depends on a fresh build).
// ════════════════════════════════════════════════════════════════════

// ── Shared synthetic world ───────────────────────────────────────────
//
// Distinct from the dev's SYNTH_* fixtures on purpose (different key names),
// so the two files exercise independent invented surfaces.

/** A baseline holding a bare tool key AND a tool:action key for the SAME tool. */
const COLLISION_BASELINE: ReadonlySet<string> = new Set([
  "iris_dual", // the bare tool key (single-op form)
  "iris_dual:create", // a tool:action key on a tool that shares the bare name
]);

/** A `mutates` lookup that (wrongly, for the test) marks a baseline key as write. */
const MUTATES_WITH_BASELINE_WRITE: MutatesLookup = new Map<
  string,
  "read" | "write"
>([
  ["iris_dual", "write"], // SAME key is in COLLISION_BASELINE → baseline must win
  ["iris_brand_new:write", "write"], // genuinely new write
  ["iris_brand_new:read", "read"], // genuinely new read
]);

// ════════════════════════════════════════════════════════════════════
// 1. parseGovernanceConfig — edge cases beyond the dev's set.
// ════════════════════════════════════════════════════════════════════

describe("parseGovernanceConfig — additional edge cases", () => {
  it("treats a whitespace-only IRIS_GOVERNANCE as malformed (fails fast)", () => {
    // "" short-circuits to {} (dev covers that), but a non-empty blank string
    // is NOT empty → it reaches JSON.parse and must fail fast naming the var.
    expect(() =>
      parseGovernanceConfig({ IRIS_GOVERNANCE: "   " }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast when a JSON string literal is supplied as the root", () => {
    // A bare quoted string is valid JSON but the wrong shape (not an object).
    expect(() =>
      parseGovernanceConfig({ IRIS_GOVERNANCE: '"global"' }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast when the root is the JSON literal null", () => {
    expect(() =>
      parseGovernanceConfig({ IRIS_GOVERNANCE: "null" }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast when the root is the JSON literal true (boolean primitive)", () => {
    expect(() =>
      parseGovernanceConfig({ IRIS_GOVERNANCE: "true" }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("parses an empty JSON object to an empty config", () => {
    expect(parseGovernanceConfig({ IRIS_GOVERNANCE: "{}" })).toEqual({});
  });

  it("accepts `global` present while `profiles` is absent", () => {
    const cfg = parseGovernanceConfig({
      IRIS_GOVERNANCE: JSON.stringify({ global: { iris_a: true } }),
    });
    expect(cfg.global).toEqual({ iris_a: true });
    expect(cfg.profiles).toBeUndefined();
  });

  it("accepts `profiles` present while `global` is absent", () => {
    const cfg = parseGovernanceConfig({
      IRIS_GOVERNANCE: JSON.stringify({ profiles: { prod: { iris_a: true } } }),
    });
    expect(cfg.profiles?.prod).toEqual({ iris_a: true });
    expect(cfg.global).toBeUndefined();
  });

  it("ignores unrecognised top-level keys (only global/profiles are read)", () => {
    const cfg = parseGovernanceConfig({
      IRIS_GOVERNANCE: JSON.stringify({
        foo: 1,
        notAProfile: { x: true },
        global: { iris_a: true },
      }),
    });
    expect(cfg).toEqual({ global: { iris_a: true } });
  });

  it("fails fast when a layer value is null (null is not a boolean)", () => {
    expect(() =>
      parseGovernanceConfig({
        IRIS_GOVERNANCE: JSON.stringify({ global: { iris_a: null } }),
      }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast when a layer value is a number (1, not true)", () => {
    expect(() =>
      parseGovernanceConfig({
        IRIS_GOVERNANCE: JSON.stringify({ global: { iris_a: 1 } }),
      }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast on deeply-nested junk as a layer value (object, not boolean)", () => {
    expect(() =>
      parseGovernanceConfig({
        IRIS_GOVERNANCE: JSON.stringify({
          global: { iris_a: { nested: { deeper: true } } },
        }),
      }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("fails fast when a profile value is an array (not an object of booleans)", () => {
    expect(() =>
      parseGovernanceConfig({
        IRIS_GOVERNANCE: JSON.stringify({ profiles: { prod: [true, false] } }),
      }),
    ).toThrow(/IRIS_GOVERNANCE/);
  });

  it("accepts an empty global layer and an empty profile layer", () => {
    // {} for a layer is a valid object of zero key→bool entries.
    const cfg = parseGovernanceConfig({
      IRIS_GOVERNANCE: JSON.stringify({ global: {}, profiles: { prod: {} } }),
    });
    expect(cfg.global).toEqual({});
    expect(cfg.profiles?.prod).toEqual({});
  });

  it("returns a config whose absent layers are genuinely undefined (not {})", () => {
    // Distinguishes 'layer omitted' from 'layer present but empty' — the cascade
    // relies on optional chaining over these, so the distinction must hold.
    const cfg = parseGovernanceConfig({ IRIS_GOVERNANCE: "{}" });
    expect(cfg.global).toBeUndefined();
    expect(cfg.profiles).toBeUndefined();
  });
});

// ════════════════════════════════════════════════════════════════════
// CR-14.3-1 — Prototype-member key hardening (code-review regression).
//
// `__proto__` / `constructor` / `prototype` collide with the JS prototype
// chain. Before the fix, a layer read of such a key (`config.global?.[key]`)
// returned the inherited member (a function / object) — a truthy NON-boolean
// that the `??` cascade surfaced as an "effective policy", and a `__proto__`
// key in getEffectivePolicy's allKeys was silently dropped (length mismatch).
// The engine now (a) fails fast on a reserved governance key / profile name at
// parse time, and (b) reads every layer as an own-boolean-only property so the
// cascade can never leak a non-boolean. These tests pin that behaviour.
// ════════════════════════════════════════════════════════════════════

describe("prototype-member key hardening (CR-14.3-1)", () => {
  const emptyMutates: MutatesLookup = new Map();

  it.each(["__proto__", "constructor", "prototype"])(
    "parseGovernanceConfig fails fast (naming the var) on a reserved global key %s",
    (reserved) => {
      expect(() =>
        parseGovernanceConfig({
          IRIS_GOVERNANCE: JSON.stringify({ global: { [reserved]: false } }),
        }),
      ).toThrow(/IRIS_GOVERNANCE/);
    },
  );

  it.each(["__proto__", "constructor", "prototype"])(
    "parseGovernanceConfig fails fast on a reserved key inside a profile layer (%s)",
    (reserved) => {
      expect(() =>
        parseGovernanceConfig({
          IRIS_GOVERNANCE: JSON.stringify({
            profiles: { prod: { [reserved]: true } },
          }),
        }),
      ).toThrow(/IRIS_GOVERNANCE/);
    },
  );

  it.each(["__proto__", "constructor", "prototype"])(
    "parseGovernanceConfig fails fast on a reserved PROFILE name (%s)",
    (reserved) => {
      expect(() =>
        parseGovernanceConfig({
          IRIS_GOVERNANCE: JSON.stringify({
            profiles: { [reserved]: { iris_a: true } },
          }),
        }),
      ).toThrow(/IRIS_GOVERNANCE/);
    },
  );

  it("parsing a __proto__ key never pollutes Object.prototype", () => {
    try {
      parseGovernanceConfig({
        IRIS_GOVERNANCE: JSON.stringify({ global: { ["__proto__"]: true } }),
      });
    } catch {
      /* expected to throw — the point is no pollution side-effect */
    }
    // A freshly-created object must not have inherited an `iris`-ish property.
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("__proto__value");
  });

  it.each(["constructor", "__proto__", "prototype"])(
    "effective() returns a boolean (the seed), never an inherited member, for key %s",
    (reserved) => {
      // A directly-constructed config (as Story 14.4 / a caller might build)
      // with a populated global layer — the dangerous read path.
      const cfg: GovernanceConfig = { global: { iris_real: true } };
      const r = effective(reserved, "prod", cfg, emptyMutates, new Set());
      expect(typeof r).toBe("boolean");
      expect(r).toBe(true); // not in baseline, no mutates → read-default enabled
    },
  );

  it.each(["constructor", "__proto__", "prototype"])(
    "effective() reads a reserved PROFILE name safely (falls through to seed) for %s",
    (reserved) => {
      const cfg: GovernanceConfig = { global: { iris_real: true } };
      const r = effective("iris_x", reserved, cfg, emptyMutates, new Set());
      expect(typeof r).toBe("boolean");
      expect(r).toBe(true);
    },
  );

  it("getEffectivePolicy preserves its length invariant when allKeys contains __proto__", () => {
    const allKeys = ["iris_a", "__proto__", "constructor"];
    const policy = getEffectivePolicy(
      "prod",
      {},
      allKeys,
      emptyMutates,
      new Set(["iris_a"]),
    );
    // Every key is a real OWN enumerable property — no silent drop.
    expect(Object.keys(policy).length).toBe(3);
    expect(Object.prototype.hasOwnProperty.call(policy, "__proto__")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(policy, "constructor")).toBe(true);
    // And their values are plain booleans, not leaked prototype members.
    for (const k of allKeys) {
      expect(typeof (policy as Record<string, unknown>)[k]).toBe("boolean");
    }
  });

  it("an explicit own-`false` on a normal key still wins (fix did not regress the `??` cascade)", () => {
    const cfg: GovernanceConfig = {
      global: { iris_x: true },
      profiles: { prod: { iris_x: false } },
    };
    expect(effective("iris_x", "prod", cfg, emptyMutates, new Set(["iris_x"]))).toBe(
      false,
    );
  });
});

// ════════════════════════════════════════════════════════════════════
// 2. defaultSeed — baseline-vs-mutates precedence & key-collision sanity.
// ════════════════════════════════════════════════════════════════════

describe("defaultSeed — precedence and key-collision sanity", () => {
  it("baseline membership wins over a (conflicting) write classification", () => {
    // iris_dual is BOTH in the baseline AND marked write in the lookup. Baseline
    // membership is checked first, so the action stays enabled (grandfathered) —
    // a pre-existing capability is never disabled by a stray mutates entry.
    expect(
      defaultSeed("iris_dual", MUTATES_WITH_BASELINE_WRITE, COLLISION_BASELINE),
    ).toBe(true);
  });

  it("a bare tool key and its tool:action sibling resolve independently", () => {
    // 'iris_dual' and 'iris_dual:create' are DISTINCT governance keys; no
    // collision. Both are in the baseline here, so both seed-enable.
    expect(
      defaultSeed("iris_dual", MUTATES_WITH_BASELINE_WRITE, COLLISION_BASELINE),
    ).toBe(true);
    expect(
      defaultSeed(
        "iris_dual:create",
        MUTATES_WITH_BASELINE_WRITE,
        COLLISION_BASELINE,
      ),
    ).toBe(true);
  });

  it("a NOT-in-baseline action on a tool whose bare name IS in baseline is still NEW", () => {
    // 'iris_dual:delete' is absent from the baseline even though 'iris_dual' is
    // present — membership is by exact key. With no mutates entry it defaults to
    // read → enabled; the point is it is evaluated as NEW, not grandfathered.
    expect(
      defaultSeed(
        "iris_dual:delete",
        MUTATES_WITH_BASELINE_WRITE,
        COLLISION_BASELINE,
      ),
    ).toBe(true);
  });

  it("a new write that is NOT in the baseline is disabled by the seed", () => {
    expect(
      defaultSeed(
        "iris_brand_new:write",
        MUTATES_WITH_BASELINE_WRITE,
        COLLISION_BASELINE,
      ),
    ).toBe(false);
  });

  it("a new read that is NOT in the baseline is enabled by the seed", () => {
    expect(
      defaultSeed(
        "iris_brand_new:read",
        MUTATES_WITH_BASELINE_WRITE,
        COLLISION_BASELINE,
      ),
    ).toBe(true);
  });

  it("an empty mutates lookup means every non-baseline key fails open to enabled", () => {
    const empty: MutatesLookup = new Map();
    expect(defaultSeed("iris_unknown", empty, COLLISION_BASELINE)).toBe(true);
    expect(defaultSeed("iris_unknown:x", empty, COLLISION_BASELINE)).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 3. effective / getEffectivePolicy — full 3-layer over baseline ∪ synthetic.
// ════════════════════════════════════════════════════════════════════

describe("getEffectivePolicy — 3-layer resolution over a baseline ∪ new-key union", () => {
  // A single NEW write key, taken through ALL THREE layers in one scenario:
  //   seed: disabled (new write)  →  global: enabled  →  profile: disabled.
  // The most-specific layer (profile) must win at the end.
  const NEW_WRITE = "iris_brand_new:write";

  const mutates: MutatesLookup = new Map<string, "read" | "write">([
    [NEW_WRITE, "write"],
  ]);

  // The union a real caller forms: baseline keys ∪ the new key(s).
  const unionKeys = [...COLLISION_BASELINE, NEW_WRITE];

  it("layer 0 (seed only): the new write is disabled, baseline keys enabled", () => {
    const policy = getEffectivePolicy(
      "prod",
      {},
      unionKeys,
      mutates,
      COLLISION_BASELINE,
    );
    expect(policy[NEW_WRITE]).toBe(false); // seed disables a new write
    expect(policy["iris_dual"]).toBe(true); // grandfathered
    expect(policy["iris_dual:create"]).toBe(true); // grandfathered
  });

  it("layer 1 (global enable): global true lifts the new write to enabled", () => {
    const cfg: GovernanceConfig = { global: { [NEW_WRITE]: true } };
    const policy = getEffectivePolicy(
      "prod",
      cfg,
      unionKeys,
      mutates,
      COLLISION_BASELINE,
    );
    expect(policy[NEW_WRITE]).toBe(true);
  });

  it("layer 2 (profile disable over global enable): profile wins → disabled", () => {
    const cfg: GovernanceConfig = {
      global: { [NEW_WRITE]: true }, // globally enabled…
      profiles: { prod: { [NEW_WRITE]: false } }, // …but prod disables it
    };
    const prod = getEffectivePolicy(
      "prod",
      cfg,
      unionKeys,
      mutates,
      COLLISION_BASELINE,
    );
    const staging = getEffectivePolicy(
      "staging",
      cfg,
      unionKeys,
      mutates,
      COLLISION_BASELINE,
    );
    expect(prod[NEW_WRITE]).toBe(false); // profile override down wins
    expect(staging[NEW_WRITE]).toBe(true); // staging inherits global enable
  });

  it("the union map contains exactly the union keys (no spurious keys, no omissions)", () => {
    const policy = getEffectivePolicy(
      "prod",
      {},
      unionKeys,
      mutates,
      COLLISION_BASELINE,
    );
    expect(new Set(Object.keys(policy))).toEqual(new Set(unionKeys));
    expect(Object.keys(policy).length).toBe(unionKeys.length);
  });

  it("a duplicate key in allKeys collapses to a single (consistent) entry", () => {
    // getEffectivePolicy assigns into a plain object, so a repeated key is just
    // recomputed to the same value — no double counting, no inconsistency.
    const dupKeys = ["iris_dual", "iris_dual", NEW_WRITE];
    const policy = getEffectivePolicy(
      "prod",
      {},
      dupKeys,
      mutates,
      COLLISION_BASELINE,
    );
    expect(Object.keys(policy).sort()).toEqual([NEW_WRITE, "iris_dual"].sort());
    expect(policy["iris_dual"]).toBe(true);
  });

  it("getEffectivePolicy over an empty key set yields an empty map", () => {
    expect(getEffectivePolicy("prod", {}, [], mutates, COLLISION_BASELINE)).toEqual(
      {},
    );
  });
});

describe("effective — explicit-false honoured through all layers (`??` not `||`)", () => {
  const mutates: MutatesLookup = new Map();

  it("an explicit profile false beats an enabled GLOBAL and an enabled SEED", () => {
    const cfg: GovernanceConfig = {
      global: { iris_dual: true },
      profiles: { prod: { iris_dual: false } },
    };
    expect(
      effective("iris_dual", "prod", cfg, mutates, COLLISION_BASELINE),
    ).toBe(false);
  });

  it("an explicit global false beats an enabled SEED when the profile is silent", () => {
    const cfg: GovernanceConfig = { global: { iris_dual: false } };
    expect(
      effective("iris_dual", "prod", cfg, mutates, COLLISION_BASELINE),
    ).toBe(false);
  });

  it("an explicit profile false on a key the global never mentions still disables", () => {
    const cfg: GovernanceConfig = {
      profiles: { prod: { iris_dual: false } },
    };
    expect(
      effective("iris_dual", "prod", cfg, mutates, COLLISION_BASELINE),
    ).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 4. buildMutatesLookup — scalar / per-action / grandfathered / empty mix.
// ════════════════════════════════════════════════════════════════════

describe("buildMutatesLookup — mixed and degenerate inputs", () => {
  /** Minimal ToolDefinition stub; `mutates` set only when provided. */
  function stub(
    name: string,
    mutates?: ToolDefinition["mutates"],
  ): ToolDefinition {
    const def: ToolDefinition = {
      name,
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

  it("handles all three shapes together: scalar, per-action map, and grandfathered", () => {
    const lookup = buildMutatesLookup([
      stub("iris_scalar", "write"), // scalar → bare key
      stub("iris_map", { get: "read", drop: "write" }), // map → tool:action keys
      stub("iris_grandfathered"), // omitted → contributes nothing
    ]);
    expect(lookup.get("iris_scalar")).toBe("write");
    expect(lookup.get("iris_map:get")).toBe("read");
    expect(lookup.get("iris_map:drop")).toBe("write");
    expect(lookup.has("iris_grandfathered")).toBe(false);
    expect(lookup.size).toBe(3);
  });

  it("treats an empty per-action record as contributing zero keys (no crash)", () => {
    const lookup = buildMutatesLookup([stub("iris_empty_map", {})]);
    expect(lookup.size).toBe(0);
  });

  it("returns an empty lookup for an empty tool iterable", () => {
    expect(buildMutatesLookup([]).size).toBe(0);
  });

  it("accepts any iterable (e.g. a Set), not just an array", () => {
    const set = new Set([stub("iris_a", "read"), stub("iris_b", "write")]);
    const lookup = buildMutatesLookup(set);
    expect(lookup.get("iris_a")).toBe("read");
    expect(lookup.get("iris_b")).toBe("write");
    expect(lookup.size).toBe(2);
  });

  it("a later scalar tool with a duplicate name overwrites the earlier class", () => {
    // Last-writer-wins is the Map semantics; pin it so a future change is noticed.
    const lookup = buildMutatesLookup([
      stub("iris_dup", "read"),
      stub("iris_dup", "write"),
    ]);
    expect(lookup.get("iris_dup")).toBe("write");
    expect(lookup.size).toBe(1);
  });

  it("feeds straight into defaultSeed: a built lookup disables a new write key", () => {
    const lookup = buildMutatesLookup([stub("iris_writer", "write")]);
    // Not in the (synthetic) baseline, classified write → disabled by seed.
    expect(defaultSeed("iris_writer", lookup, new Set())).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════
// 5. AC 14.3.7 back-compat proof — restated INDEPENDENTLY.
//
// The dev proves it via getEffectivePolicy over the real baseline. This is an
// orthogonal restatement: for EVERY real baseline key, under the empty config,
// `effective` (the cascade entry point used by enforcement in 14.4) returns
// true — across multiple profile names. Does not weaken the dev's version;
// it pins the same guarantee through a different surface and call shape.
// ════════════════════════════════════════════════════════════════════

describe("AC 14.3.7 back-compat — independent restatement via effective()", () => {
  const emptyMutates: MutatesLookup = new Map();

  it("the real baseline is non-empty (guards against a vacuously-true proof)", () => {
    // If the baseline were ever empty, the all-enabled proofs would pass for the
    // wrong reason. Pin a sane lower bound (the dev's notes cite 141 keys).
    expect(GOVERNANCE_BASELINE.size).toBeGreaterThan(100);
  });

  it("effective(key, <any profile>, {}) === true for EVERY real baseline key", () => {
    const profiles = ["default", "prod", "staging", "a-profile-that-was-never-configured"];
    for (const key of GOVERNANCE_BASELINE) {
      for (const profile of profiles) {
        expect(
          effective(key, profile, {}, emptyMutates),
          `effective(${key}, ${profile}) must be enabled under empty config`,
        ).toBe(true);
      }
    }
  });

  it("a parsed-empty config (from an unset env) is equivalent to a literal {} here", () => {
    // Ties the parse path to the cascade path: parseGovernanceConfig({}) must be
    // usable directly as the empty config the back-compat proof relies on.
    const parsedEmpty = parseGovernanceConfig({});
    const sampleKey = [...GOVERNANCE_BASELINE][0];
    // The non-empty guard above means this is always present; assert for the
    // type-checker (and as an explicit precondition of the proof).
    expect(sampleKey).toBeDefined();
    expect(
      effective(sampleKey as string, "default", parsedEmpty, emptyMutates),
    ).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════
// 6. Generator introspection contract — on SYNTHETIC z schemas.
//
// Replicates the EXACT key-derivation logic from
// scripts/gen-governance-baseline.mjs (and the dev's drift test) — reading
// `inputSchema.shape.action.options` and guarding `Array.isArray && length>0`
// — but drives it with hand-built Zod schemas instead of importing built
// dists. This keeps the file independent of a fresh `pnpm turbo run build`
// (no file:// dist import here) while still pinning the contract that the
// generator depends on:
//   • action is a ZodEnum        → one `tool:value` key per option
//   • action is z.string()       → bare `tool` key (AC: NOT a ZodEnum)
//   • no action field            → bare `tool` key
//   • action is an empty enum    → bare `tool` key (handled sanely)
// ════════════════════════════════════════════════════════════════════

describe("generator introspection contract (synthetic schemas, no dist import)", () => {
  /** Verbatim derivation from gen-governance-baseline.mjs / the drift test. */
  function deriveKeys(
    tools: Array<{ name: string; inputSchema: { shape?: Record<string, unknown> } }>,
  ): Set<string> {
    const keys = new Set<string>();
    for (const tool of tools) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const action = (tool.inputSchema as any)?.shape?.action;
      const options = action?.options;
      if (Array.isArray(options) && options.length > 0) {
        for (const value of options) keys.add(`${tool.name}:${value}`);
      } else {
        keys.add(tool.name);
      }
    }
    return keys;
  }

  it("a ZodEnum action yields one tool:action key per enum option", () => {
    const keys = deriveKeys([
      { name: "iris_enum", inputSchema: z.object({ action: z.enum(["get", "set"]) }) },
    ]);
    expect([...keys].sort()).toEqual(["iris_enum:get", "iris_enum:set"]);
  });

  it("a z.string() action (NOT a ZodEnum) yields the BARE tool key", () => {
    // AC: an `action` that is not an enum must collapse to the single-op key —
    // .options is undefined for a ZodString, so the Array.isArray guard is false.
    const keys = deriveKeys([
      { name: "iris_str", inputSchema: z.object({ action: z.string() }) },
    ]);
    expect([...keys]).toEqual(["iris_str"]);
  });

  it("a tool with no action field yields the bare tool key", () => {
    const keys = deriveKeys([
      {
        name: "iris_single",
        inputSchema: z.object({ namespace: z.string().optional() }),
      },
    ]);
    expect([...keys]).toEqual(["iris_single"]);
  });

  it("an EMPTY enum yields the bare tool key (length-0 guard → sane single-op)", () => {
    // z.enum([]).options is [] — Array.isArray is true but length>0 is false,
    // so the generator emits the bare name rather than zero keys. Sane handling.
    const keys = deriveKeys([
      { name: "iris_empty", inputSchema: z.object({ action: z.enum([]) }) },
    ]);
    expect([...keys]).toEqual(["iris_empty"]);
  });

  it("a single-value enum still yields a tool:action key (length 1 passes the guard)", () => {
    const keys = deriveKeys([
      { name: "iris_one", inputSchema: z.object({ action: z.enum(["only"]) }) },
    ]);
    expect([...keys]).toEqual(["iris_one:only"]);
  });

  it("a mixed tool list derives the expected union of keys", () => {
    const keys = deriveKeys([
      { name: "iris_enum", inputSchema: z.object({ action: z.enum(["a", "b"]) }) },
      { name: "iris_str", inputSchema: z.object({ action: z.string() }) },
      { name: "iris_single", inputSchema: z.object({ x: z.number() }) },
      { name: "iris_empty", inputSchema: z.object({ action: z.enum([]) }) },
    ]);
    expect([...keys].sort()).toEqual([
      "iris_empty",
      "iris_enum:a",
      "iris_enum:b",
      "iris_single",
      "iris_str",
    ]);
  });

  it("derived single-op keys feed the seed exactly like a baseline entry", () => {
    // Closing the loop: a key the generator would emit, once in the baseline,
    // grandfathers to enabled — the contract the whole back-compat gate rests on.
    const derived = deriveKeys([
      { name: "iris_str", inputSchema: z.object({ action: z.string() }) },
    ]);
    const baseline = new Set(derived);
    expect(defaultSeed("iris_str", new Map(), baseline)).toBe(true);
  });
});
