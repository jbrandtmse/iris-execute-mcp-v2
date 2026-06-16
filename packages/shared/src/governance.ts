/**
 * Tool governance policy engine (Epic 14 — architecture decisions D3, D4, D7).
 *
 * A *governance policy* enables or disables individual tool actions, with a
 * two-layer cascade — a `global` baseline plus per-`profiles` overrides — so an
 * operator can lock writes down globally and tune exceptions per environment.
 * This module is the policy ENGINE only: parsing, the default seed, the cascade,
 * and {@link getEffectivePolicy}. Enforcement (the call-time gate) is Story 14.4
 * and the advisory `iris-governance://{profile}` resource is Story 14.5; both
 * consume {@link getEffectivePolicy}.
 *
 * **Governance key model (D4).** A *key* identifies a governed action:
 * - `tool` — a single-operation tool with no `action` enum (e.g. `iris_user_get`).
 * - `tool:action` — one value of a multi-action tool's `action` enum
 *   (e.g. `iris_user_manage:create`).
 *
 * **Default seed (D3).** "Is this action new?" is answered by membership in the
 * generated baseline ({@link GOVERNANCE_BASELINE}), NOT a hand-maintained flag:
 * - in baseline ⇒ pre-existing ⇒ **enabled** (grandfathered).
 * - not in baseline ⇒ new ⇒ enabled if its {@link ToolDefinition.mutates} class
 *   is `read`, **disabled** if `write`. This makes newly-added mutating
 *   capability opt-in while guaranteeing no pre-existing action is disabled by
 *   default (the back-compat gate).
 *
 * **Cascade (D4).** `effective(key, profile) =
 *   profile.explicit(key) ?? global.explicit(key) ?? defaultSeed(key)`. The
 * nullish-coalescing is load-bearing: an explicit `false` override at either
 * layer is honored (it disables), never mistaken for "unset".
 *
 * **Parsing (D7).** {@link parseGovernanceConfig} reads `IRIS_GOVERNANCE`
 * centrally; malformed/wrong-shape JSON fails fast with an error naming the var
 * (mirroring the `IRIS_PROFILES` fail-fast in `profiles.ts`). Absent ⇒ empty
 * config ⇒ the seed governs everything ⇒ byte-for-byte today's behavior.
 */

import type { ToolDefinition } from "./tool-types.js";
import { GOVERNANCE_BASELINE } from "./governance-baseline.js";

/** Mutation class of a single action: reads vs. writes IRIS state. */
export type MutationClass = "read" | "write";

/**
 * A governance policy: a map of governance key → enabled boolean. Used for both
 * the `global` baseline layer and each per-profile override layer.
 */
export type GovernanceLayer = Record<string, boolean>;

/**
 * Parsed `IRIS_GOVERNANCE` configuration (architecture decision D7).
 *
 * Both layers are optional; an absent `IRIS_GOVERNANCE` yields `{}` (the seed
 * governs everything). `global` is the instance-wide baseline; `profiles` maps a
 * profile name to that profile's overrides.
 */
export interface GovernanceConfig {
  /** Instance-wide baseline overrides, keyed by governance key. */
  global?: GovernanceLayer;
  /** Per-profile overrides: profile name → that profile's key overrides. */
  profiles?: Record<string, GovernanceLayer>;
}

/**
 * A read-only lookup of governance key → mutation class, built from the
 * {@link ToolDefinition.mutates} metadata of NEW (governed) tools. Only keys
 * that carry `mutates` appear; pre-existing (grandfathered) keys are absent and
 * are handled by baseline membership instead.
 */
export type MutatesLookup = ReadonlyMap<string, MutationClass>;

/** Fail-fast helper: a clear error naming `IRIS_GOVERNANCE` (mirrors `profilesError`). */
function governanceError(detail: string): Error {
  return new Error(`IRIS_GOVERNANCE is invalid: ${detail}`);
}

/**
 * Reserved object keys that, used as a governance key or profile name, would
 * collide with the prototype chain. `JSON.parse` materializes them as own
 * properties, but a *plain-object* read (`obj[key]`) of `"constructor"` /
 * `"__proto__"` returns the inherited `Object.prototype` member — a truthy
 * NON-boolean that the `??` cascade would wrongly surface as an effective
 * policy. We reject them outright (D7 fail-fast) and additionally read every
 * layer via {@link ownBool} so an externally-constructed config (e.g. from
 * Story 14.4 / tests) is also safe.
 */
const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Read `key` from `layer` ONLY as an own boolean property; otherwise `undefined`.
 *
 * This is the cascade's guard against inherited prototype members: it never
 * returns `Object.prototype.constructor` (a function) or `Object.prototype`
 * (an object) for a key like `"constructor"`/`"__proto__"`, and it ignores any
 * non-boolean own value, so the `??` chain only ever sees `boolean | undefined`.
 */
function ownBool(
  layer: GovernanceLayer | undefined,
  key: string,
): boolean | undefined {
  if (layer === undefined) return undefined;
  if (!Object.prototype.hasOwnProperty.call(layer, key)) return undefined;
  const value = (layer as Record<string, unknown>)[key];
  return typeof value === "boolean" ? value : undefined;
}

/**
 * Validate one policy layer (`global` or a single profile's overrides): it must
 * be a JSON object of `key → boolean`. Throws (naming `IRIS_GOVERNANCE`) on any
 * non-boolean value so a typo like `"iris_x": "true"` fails fast rather than
 * silently coercing.
 */
function validateLayer(label: string, raw: unknown): GovernanceLayer {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw governanceError(
      `${label} must be a JSON object mapping "<tool|tool:action>" to true/false.`,
    );
  }
  // Null-prototype map: a stray reserved key (rejected below, but belt-and-braces)
  // becomes an own property rather than mutating the prototype.
  const layer: GovernanceLayer = Object.create(null) as GovernanceLayer;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "") {
      throw governanceError(`${label}: governance keys must be non-empty strings.`);
    }
    if (RESERVED_KEYS.has(key)) {
      throw governanceError(
        `${label}: "${key}" is a reserved key and cannot be used as a governance key.`,
      );
    }
    if (typeof value !== "boolean") {
      throw governanceError(
        `${label}: value for "${key}" must be a boolean (true/false). Received: ${JSON.stringify(value)}.`,
      );
    }
    layer[key] = value;
  }
  return layer;
}

/**
 * Parse the `IRIS_GOVERNANCE` environment variable into a {@link GovernanceConfig}
 * (architecture decision D7).
 *
 * Shape: `{ "global": { "<key>": true|false }, "profiles": { "<name>": { ... } } }`.
 * Both `global` and `profiles` are optional. Absent/empty `IRIS_GOVERNANCE` ⇒
 * `{}`. Malformed JSON, a non-object root, or a non-boolean value fails fast
 * with an error naming `IRIS_GOVERNANCE`.
 *
 * @param env - Environment map (defaults to `process.env`).
 * @returns The parsed config (`{}` when `IRIS_GOVERNANCE` is unset/empty).
 * @throws {Error} (naming `IRIS_GOVERNANCE`) on malformed/invalid input.
 */
export function parseGovernanceConfig(
  env: Record<string, string | undefined> = process.env,
): GovernanceConfig {
  const raw = env.IRIS_GOVERNANCE;
  if (raw === undefined || raw === "") {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    throw governanceError(`could not parse JSON (${reason}).`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw governanceError(
      'expected a JSON object, e.g. {"global":{"iris_x_manage:delete":false}}.',
    );
  }

  const root = parsed as Record<string, unknown>;
  const config: GovernanceConfig = {};

  if (root.global !== undefined) {
    config.global = validateLayer('"global"', root.global);
  }

  if (root.profiles !== undefined) {
    if (
      root.profiles === null ||
      typeof root.profiles !== "object" ||
      Array.isArray(root.profiles)
    ) {
      throw governanceError(
        '"profiles" must be a JSON object mapping a profile name to its overrides.',
      );
    }
    const profiles: Record<string, GovernanceLayer> = Object.create(
      null,
    ) as Record<string, GovernanceLayer>;
    for (const [name, layer] of Object.entries(
      root.profiles as Record<string, unknown>,
    )) {
      if (name === "") {
        throw governanceError("profile names must be non-empty strings.");
      }
      if (RESERVED_KEYS.has(name)) {
        throw governanceError(
          `"${name}" is a reserved key and cannot be used as a profile name.`,
        );
      }
      profiles[name] = validateLayer(`profile "${name}"`, layer);
    }
    config.profiles = profiles;
  }

  return config;
}

/**
 * Build a {@link MutatesLookup} from a set of tool definitions, flattening each
 * tool's {@link ToolDefinition.mutates} metadata into per-governance-key entries.
 *
 * - A scalar `mutates` (`'read' | 'write'`) maps the bare tool name.
 * - A `Record<action, class>` maps `tool:action` for each entry.
 * - Tools that omit `mutates` (every pre-existing tool) contribute nothing — they
 *   are grandfathered via baseline membership, not via this lookup.
 *
 * @param tools - Tool definitions to introspect (any iterable).
 * @returns A read-only key → mutation-class map for the NEW (governed) actions.
 */
export function buildMutatesLookup(
  tools: Iterable<ToolDefinition>,
): MutatesLookup {
  const lookup = new Map<string, MutationClass>();
  for (const tool of tools) {
    const m = tool.mutates;
    if (m === undefined) continue;
    if (typeof m === "string") {
      lookup.set(tool.name, m);
    } else {
      for (const [action, cls] of Object.entries(m)) {
        lookup.set(`${tool.name}:${action}`, cls);
      }
    }
  }
  return lookup;
}

/**
 * Compute the default-seed enablement for a single governance key (architecture
 * decision D3).
 *
 * - In the generated baseline ⇒ pre-existing ⇒ `true` (grandfathered enabled).
 * - Not in the baseline ⇒ new ⇒ `false` iff its {@link MutatesLookup} class is
 *   `'write'`, otherwise `true` (a new `read`, or an unknown/unclassified key,
 *   defaults to enabled).
 *
 * @param key           - The governance key (`tool` or `tool:action`).
 * @param mutatesLookup - Key → mutation class for new actions.
 * @param baseline      - The generated baseline set (defaults to {@link GOVERNANCE_BASELINE}).
 * @returns `true` if enabled by default, `false` if disabled by default.
 */
export function defaultSeed(
  key: string,
  mutatesLookup: MutatesLookup,
  baseline: ReadonlySet<string> = GOVERNANCE_BASELINE,
): boolean {
  if (baseline.has(key)) {
    return true;
  }
  // New action: disabled only when explicitly classified as a write/mutation.
  return mutatesLookup.get(key) === "write" ? false : true;
}

/**
 * Resolve the effective enablement of one governance key for one profile
 * (architecture decision D4 cascade).
 *
 * `effective = profile.explicit(key) ?? global.explicit(key) ?? defaultSeed(key)`.
 * Nullish-coalescing (`??`) is intentional: an explicit `false` at the profile or
 * global layer is honored as "disabled", never treated as "unset" (which `||`
 * would wrongly do).
 *
 * @param key           - The governance key.
 * @param profile       - The profile name whose overrides take top priority.
 * @param config        - Parsed {@link GovernanceConfig}.
 * @param mutatesLookup - Key → mutation class for new actions.
 * @param baseline      - The generated baseline set (defaults to {@link GOVERNANCE_BASELINE}).
 * @returns `true` if the action is enabled for the profile, else `false`.
 */
export function effective(
  key: string,
  profile: string,
  config: GovernanceConfig,
  mutatesLookup: MutatesLookup,
  baseline: ReadonlySet<string> = GOVERNANCE_BASELINE,
): boolean {
  // Resolve the profile's layer as an own property only — a `profile` named
  // after a prototype member (e.g. "constructor") must not read the inherited
  // member. Then read each layer via ownBool so the `??` cascade only ever sees
  // `boolean | undefined`, never a leaked non-boolean prototype value.
  const profileLayer =
    config.profiles !== undefined &&
    Object.prototype.hasOwnProperty.call(config.profiles, profile)
      ? config.profiles[profile]
      : undefined;
  return (
    ownBool(profileLayer, key) ??
    ownBool(config.global, key) ??
    defaultSeed(key, mutatesLookup, baseline)
  );
}

/**
 * Compute the full enabled/disabled policy map for a profile (architecture
 * decision D4) — the API consumed by Story 14.4 (call-time enforcement) and
 * Story 14.5 (the governance resource).
 *
 * Evaluates {@link effective} for every key in `allKeys` (which callers should
 * form as the union of the baseline and every registered tool/action key, so the
 * map covers both grandfathered and newly-added actions).
 *
 * @param profile        - The profile name.
 * @param config         - Parsed {@link GovernanceConfig}.
 * @param allKeys        - Every known governance key (baseline ∪ registered keys).
 * @param mutatesLookup  - Key → mutation class for new actions.
 * @param baseline       - The generated baseline set (defaults to {@link GOVERNANCE_BASELINE}).
 * @returns A `Record<key, boolean>` of effective enablement for the profile.
 */
export function getEffectivePolicy(
  profile: string,
  config: GovernanceConfig,
  allKeys: Iterable<string>,
  mutatesLookup: MutatesLookup,
  baseline: ReadonlySet<string> = GOVERNANCE_BASELINE,
): Record<string, boolean> {
  const policy: Record<string, boolean> = {};
  for (const key of allKeys) {
    // Use defineProperty so a key that collides with a prototype member (e.g.
    // "__proto__") is written as a real own enumerable property rather than
    // silently no-op'ing the assignment — preserving the 1-key-per-allKeys
    // invariant the enforcement layer (Story 14.4) relies on.
    Object.defineProperty(policy, key, {
      value: effective(key, profile, config, mutatesLookup, baseline),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return policy;
}
