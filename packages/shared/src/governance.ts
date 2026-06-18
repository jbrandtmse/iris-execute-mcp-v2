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
 * Read the `action` enum's `.options` array from a tool input-schema field,
 * peeling any `ZodOptional` / `ZodDefault` / `ZodNullable` wrappers first
 * (architecture decision D4; Story 15.0 AC 15.0.1).
 *
 * A bare `z.enum([...])` (and `.describe(...)`) exposes its values directly on
 * `.options` (Zod v4). But a wrapped enum — `z.enum([...]).optional()` →
 * `ZodOptional`, `.default(x)` → `ZodDefault`, `.nullable()` → `ZodNullable` —
 * exposes `.options === undefined`. Without unwrapping, a future tool that
 * declares `action: z.enum([...]).optional()` would collapse to the bare-tool
 * governance key instead of per-`tool:action` keys, silently downgrading
 * per-action governance to whole-tool governance (a fail-open for any per-action
 * deny an operator writes).
 *
 * **CRITICAL — lock-step (AC 15.0.1).** This logic is the SINGLE SOURCE OF TRUTH
 * for the GATE side (`computeGovernanceKey`, `rebuildGovernedKeys` in
 * `server-base.ts`). The build-time baseline generator
 * (`scripts/gen-governance-baseline.mjs`) is a separate `.mjs` that cannot import
 * this TS module (it imports built dists), so it REPLICATES this exact algorithm
 * with a "MUST mirror" comment. If you change the peel logic here, change it
 * there too, or the gate and the generated baseline will disagree and the
 * cascade will miss.
 *
 * Verified empirically against Zod 4.3.6: each wrapper exposes BOTH `.unwrap()`
 * and `._def.innerType` → the inner type; wrappers can nest
 * (`.describe(...).optional()`), so we peel iteratively (bounded) until an
 * `.options` array surfaces or no further inner type exists.
 *
 * @param actionField - The `inputSchema.shape.action` field (or `undefined`).
 * @returns The enum option array if the (unwrapped) field is a ZodEnum, else `undefined`.
 */
export function unwrapActionOptions(actionField: unknown): unknown[] | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let field: any = actionField;
  // Bounded peel: a realistic chain is at most a couple of wrappers; the cap
  // guards against a pathological/cyclic structure rather than expected input.
  for (let depth = 0; depth < 10 && field != null; depth++) {
    if (Array.isArray(field.options)) {
      return field.options as unknown[];
    }
    // Peel one wrapper layer. Both accessors resolve to the inner type on
    // ZodOptional/ZodDefault/ZodNullable; prefer `.unwrap()` and fall back to
    // `._def.innerType` so either Zod-internal shape is handled.
    const inner =
      typeof field.unwrap === "function"
        ? field.unwrap()
        : field._def?.innerType;
    if (inner == null || inner === field) {
      return undefined;
    }
    field = inner;
  }
  return undefined;
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
      // Validate the scalar class value (AC 15.0.4): `mutates` is erased at
      // runtime, so a typo like `"wite"` would otherwise be accepted and
      // silently classified as a read (enabled) by `defaultSeed`. Fail fast.
      assertMutationClass(m, tool.name);
      lookup.set(tool.name, m as MutationClass);
    } else {
      for (const [action, cls] of Object.entries(m)) {
        // Screen record-form action keys against the reserved set (AC 15.0.4),
        // mirroring the RESERVED_KEYS guard in `validateLayer` (CR-14.3-1). A
        // `__proto__` action key in a `mutates` map literal would already be
        // lost by `Object.entries` (it sets the prototype, not an own prop), so
        // a reserved key reaching here is a developer error worth surfacing.
        if (RESERVED_KEYS.has(action)) {
          throw new Error(
            `Tool "${tool.name}" declares a reserved \`mutates\` action key "${action}". ` +
              `Reserved keys (${[...RESERVED_KEYS].join(", ")}) cannot be used as action names.`,
          );
        }
        // Validate the per-action class value (AC 15.0.4).
        assertMutationClass(cls, `${tool.name}:${action}`);
        lookup.set(`${tool.name}:${action}`, cls as MutationClass);
      }
    }
  }
  return lookup;
}

/**
 * Throw a clear error if `value` is not exactly `"read"` or `"write"` (Story
 * 15.0 AC 15.0.4). Because the {@link ToolDefinition.mutates} type is erased at
 * runtime, an authoring typo would otherwise flow through unvalidated and be
 * treated as a read by {@link defaultSeed} — shipping a write enabled-by-default.
 *
 * @param value - The candidate mutation class (unknown at runtime).
 * @param keyLabel - The offending governance key, named in the error message.
 */
function assertMutationClass(
  value: unknown,
  keyLabel: string,
): asserts value is MutationClass {
  if (value !== "read" && value !== "write") {
    throw new Error(
      `Tool governance: \`mutates\` class for "${keyLabel}" must be exactly "read" or "write". ` +
        `Received: ${JSON.stringify(value)}.`,
    );
  }
}

/**
 * Assert that every governed (non-baseline) tool/action key carries a `mutates`
 * classification — the registration-time fail-fast safety net (Story 15.0 AC
 * 15.0.3). Catches "added a new write tool but forgot `mutates`", which would
 * otherwise let {@link defaultSeed} treat the unclassified key as a read and
 * ship the write ENABLED-by-default.
 *
 * A key is exempt when it is in the {@link GOVERNANCE_BASELINE} (pre-existing,
 * grandfathered) — those legitimately carry no `mutates`. Only a key that is
 * BOTH absent from the baseline AND absent from `mutatesLookup` is an error.
 *
 * **Dormant on today's surface (AC 15.0.7):** every current governance key is a
 * baseline member, so this never fires until Epic 15+ adds genuinely-new tools —
 * exactly when the safety net is wanted.
 *
 * @param allKeys - Every governance key the server knows (baseline ∪ registered keys).
 * @param mutatesLookup - Key → mutation class for new actions.
 * @param baseline - The generated baseline set (defaults to {@link GOVERNANCE_BASELINE}).
 * @throws {Error} naming the first unclassified non-baseline key.
 */
export function assertGovernanceClassification(
  allKeys: Iterable<string>,
  mutatesLookup: MutatesLookup,
  baseline: ReadonlySet<string> = GOVERNANCE_BASELINE,
): void {
  const unclassified: string[] = [];
  for (const key of allKeys) {
    if (baseline.has(key)) continue;
    if (mutatesLookup.has(key)) continue;
    unclassified.push(key);
  }
  if (unclassified.length > 0) {
    unclassified.sort();
    throw new Error(
      `Tool governance: ${unclassified.length} new (non-baseline) governance key(s) lack a ` +
        `\`mutates\` classification and would ship enabled-by-default: ` +
        `${unclassified.map((k) => `"${k}"`).join(", ")}. ` +
        `Declare \`mutates: "read" | "write"\` on the tool (or per-action), or regenerate the ` +
        `governance baseline if the key is genuinely pre-existing.`,
    );
  }
}

/**
 * Compute the default-seed enablement for a single governance key (architecture
 * decision D3).
 *
 * - In the generated baseline ⇒ pre-existing ⇒ `true` (grandfathered enabled).
 * - Not in the baseline ⇒ new ⇒ `false` iff its {@link MutatesLookup} class is
 *   `'write'`, otherwise `true` (a new `read` defaults to enabled).
 *
 * **Unclassified-key handling is defense-in-depth (Story 15.0 AC 15.0.3).** A
 * non-baseline key with NO `mutates` class still falls to the read-default
 * (`true`) here, but as of Story 15.0 that state is UNREACHABLE in a running
 * server: {@link assertGovernanceClassification} (invoked at registration) throws
 * on any non-baseline key lacking a classification, so a new tool — read OR
 * write — cannot ship unclassified. The fail-open-to-read branch below remains
 * only as a belt-and-braces default for direct/synthetic callers of this pure
 * function (e.g. unit tests).
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
