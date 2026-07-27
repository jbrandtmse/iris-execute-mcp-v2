/**
 * Tool governance policy engine (Epic 14 — architecture decisions D3, D4, D7).
 *
 * A *governance policy* enables or disables individual tool actions, with a
 * layered cascade — `global` baselines plus per-`profiles` overrides from up
 * to two config channels (`IRIS_GOVERNANCE` env, then `IRIS_GOVERNANCE_FILE`)
 * over the preset/default seeds — so an operator can lock writes down
 * globally and tune exceptions per environment.
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
 * **Cascade (D4, extended by Epic 32 / AC 32.0.2).** `effective(key, profile) =
 *   env.profile(key) ?? env.global(key) ?? file.profile(key) ?? file.global(key)
 *   ?? presetSeed(key) ?? defaultSeed(key)` — ALL env layers sit above ALL file
 *   layers (no interleaving; Project Lead decision 2026-07-26: no pre-existing
 *   `IRIS_GOVERNANCE` setting may be overridden by a governance file introduced
 *   later). The nullish-coalescing is load-bearing: an explicit `false` override
 *   at any layer is honored (it disables), never mistaken for "unset".
 *
 * **File channel (Epic 32, Story 32.0, architecture decision J1).**
 * {@link loadGovernanceFile} reads a JSON file at the explicit operator-supplied
 * path in `IRIS_GOVERNANCE_FILE` — never discovered, never searched for (J1:
 * new config channels are explicit-path-only). It is validated by the SAME
 * layer validation as `IRIS_GOVERNANCE` (reserved-key rejection included) and
 * fails fast naming the var + the path. Unset ⇒ `undefined` with ZERO
 * filesystem access, and every cascade helper treats an absent file config as
 * the exact pre-Epic-32 behavior (the AC 32.0.1 back-compat gate).
 *
 * **Parsing (D7).** {@link parseGovernanceConfig} reads `IRIS_GOVERNANCE`
 * centrally; malformed/wrong-shape JSON fails fast with an error naming the var
 * (mirroring the `IRIS_PROFILES` fail-fast in `profiles.ts`). Absent ⇒ empty
 * config ⇒ the seed governs everything ⇒ byte-for-byte today's behavior.
 */

import { readFileSync } from "node:fs";
import type { ToolDefinition } from "./tool-types.js";
import { GOVERNANCE_BASELINE } from "./governance-baseline.js";

/** Mutation class of a single action: reads vs. writes IRIS state. */
export type MutationClass = "read" | "write";

/**
 * A governance safety preset (Story 24.1, spec 02 §2.2): `"read-only"` blocks
 * every write-classified action and enables every read-classified action;
 * `"full"` is an explicit alias for today's default (pass-through) behavior.
 * Sourced from `IRIS_GOVERNANCE_PRESET` via {@link parseGovernancePreset}.
 */
export type GovernancePreset = "read-only" | "full";

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
 * Fail-fast helper for the file channel (Epic 32, AC 32.0.1): names the var
 * AND the operator-supplied path (never the file's CONTENTS — a governance
 * file is not secret, but the not-echoing-inputs discipline is uniform).
 */
function governanceFileError(path: string, detail: string): Error {
  return new Error(`IRIS_GOVERNANCE_FILE is invalid: ${detail} (path: ${path})`);
}

/** Valid `IRIS_GOVERNANCE_PRESET` values, named in the fail-fast error message. */
const VALID_PRESETS: readonly GovernancePreset[] = ["read-only", "full"];

/** Fail-fast helper: a clear error naming `IRIS_GOVERNANCE_PRESET` (mirrors `profilesError`). */
function presetError(detail: string): Error {
  return new Error(`IRIS_GOVERNANCE_PRESET is invalid: ${detail}`);
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
 * Whether an `action` field carries a `.default(...)` wrapper anywhere in its
 * peel chain (CR 29.1-1, Story 29.3 burn-down).
 *
 * `computeGovernanceKey` reads `validatedArgs.action` (POST-Zod, so a Zod
 * `.default()` has already been applied when the caller omits `action`), but
 * `deriveAuditAction` (the audit-log action deriver) reads `rawArgs.action`
 * (PRE-Zod, the caller's literal args) for its OWN documented reasons (an
 * audited value should reflect what the caller actually sent, not a
 * schema-time substitution). For every SHIPPED tool this divergence is inert
 * — no shipped `action` field uses `.default()` (verified: every one is a
 * required `z.enum([...])`). If a FUTURE tool ever declares
 * `action: z.enum([...]).default("x")`, an omitted-`action` call would
 * govern on the DEFAULTED value (`tool:x`) while the audit log would record
 * `action: null` — a latent audit/governance divergence. This helper backs a
 * MECHANICAL cross-package pin test (`packages/iris-mcp-all`'s
 * `action-default-audit-pin.test.ts`) that asserts NO shipped tool across all
 * five server packages carries a `.default(...)`-wrapped `action` field —
 * catching the divergence the moment such a tool is added, rather than letting
 * it ship silently. (An earlier registration-time throw approach was rejected:
 * it broke Story 15.0's `iris_wrapped_manage` fixture, which deliberately
 * exercises `.default()`-wrapped action enums as a supported governance shape.)
 *
 * @param actionField - The `inputSchema.shape.action` field (or `undefined`).
 */
export function actionFieldHasDefault(actionField: unknown): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let field: any = actionField;
  for (let depth = 0; depth < 10 && field != null; depth++) {
    // Verified empirically against Zod 4.3.6: a `.default(...)` wrapper's
    // `_def.type === "default"` (Zod v4's internal discriminant is `_def.type`,
    // NOT the older `_def.typeName` convention); `field.constructor.name` is
    // `"ZodDefault"` as a belt-and-suspenders cross-check.
    if (field._def?.type === "default" || field.constructor?.name === "ZodDefault") {
      return true;
    }
    if (Array.isArray(field.options)) return false;
    const inner =
      typeof field.unwrap === "function" ? field.unwrap() : field._def?.innerType;
    if (inner == null || inner === field) return false;
    field = inner;
  }
  return false;
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
 *
 * Exported (Story 32.1) for the `iris-mcp-governance` CLI, which rejects the
 * same keys on WRITE commands with the same rule — single-sourced, so the
 * CLI can never drift from the parser on what is reserved.
 */
export const RESERVED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

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
 * be a JSON object of `key → boolean`. Throws on any non-boolean value so a
 * typo like `"iris_x": "true"` fails fast rather than silently coercing. The
 * thrown error is built by `fail` (defaults to {@link governanceError}, naming
 * `IRIS_GOVERNANCE`; the file channel passes a builder naming
 * `IRIS_GOVERNANCE_FILE` + the path instead).
 */
function validateLayer(
  label: string,
  raw: unknown,
  fail: (detail: string) => Error = governanceError,
): GovernanceLayer {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw fail(
      `${label} must be a JSON object mapping "<tool|tool:action>" to true/false.`,
    );
  }
  // Null-prototype map: a stray reserved key (rejected below, but belt-and-braces)
  // becomes an own property rather than mutating the prototype.
  const layer: GovernanceLayer = Object.create(null) as GovernanceLayer;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (key === "") {
      throw fail(`${label}: governance keys must be non-empty strings.`);
    }
    if (RESERVED_KEYS.has(key)) {
      throw fail(
        `${label}: "${key}" is a reserved key and cannot be used as a governance key.`,
      );
    }
    if (typeof value !== "boolean") {
      throw fail(
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

  return parseGovernanceRoot(parsed, governanceError);
}

/**
 * Validate an already-parsed JSON value as a {@link GovernanceConfig} root
 * object — the SHARED shape validation consumed by both the env channel
 * ({@link parseGovernanceConfig}) and the file channel ({@link
 * loadGovernanceFile}), so the two can never drift (AC 32.0.1: the file is
 * parsed by the SAME validation, reserved-key rejection included). `fail`
 * builds the thrown error, so each channel's messages name ITS OWN variable
 * (and, for the file, the path).
 */
function parseGovernanceRoot(
  parsed: unknown,
  fail: (detail: string) => Error,
): GovernanceConfig {
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw fail(
      'expected a JSON object, e.g. {"global":{"iris_x_manage:delete":false}}.',
    );
  }

  const root = parsed as Record<string, unknown>;
  const config: GovernanceConfig = {};

  if (root.global !== undefined) {
    config.global = validateLayer('"global"', root.global, fail);
  }

  if (root.profiles !== undefined) {
    if (
      root.profiles === null ||
      typeof root.profiles !== "object" ||
      Array.isArray(root.profiles)
    ) {
      throw fail(
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
        throw fail("profile names must be non-empty strings.");
      }
      if (RESERVED_KEYS.has(name)) {
        throw fail(
          `"${name}" is a reserved key and cannot be used as a profile name.`,
        );
      }
      profiles[name] = validateLayer(`profile "${name}"`, layer, fail);
    }
    config.profiles = profiles;
  }

  return config;
}

/**
 * Load the optional governance policy FILE referenced by
 * `IRIS_GOVERNANCE_FILE` (Epic 32, Story 32.0, AC 32.0.1; architecture
 * decision J1).
 *
 * The value is an EXPLICIT operator-supplied path — never discovered, never
 * searched for (J1: new config channels are explicit-path-only, so the
 * "untrusted repo injects config" class does not arise). A RELATIVE path
 * resolves against the server process's CWD, which the MCP *client* chooses —
 * operators should prefer absolute paths (documented in the READMEs). No
 * hot-reload in v1: the file is read once at startup; a change takes effect
 * on the next server restart.
 *
 * - Unset/empty ⇒ `undefined`, with **ZERO filesystem access** (the env check
 *   precedes any `fs` call — the AC 32.0.1 / 31.0-style "off touches ZERO
 *   filesystem" guarantee, proven by a readFileSync-spy test).
 * - Set ⇒ the file MUST exist, be readable, and contain valid JSON of the
 *   same shape as `IRIS_GOVERNANCE`: a missing/unreadable file, malformed
 *   JSON, or an invalid shape **fails fast** naming `IRIS_GOVERNANCE_FILE`,
 *   the path, and the underlying read/parse/validation error — never silently
 *   permissive (an operator who pointed at a policy file must never run
 *   ungoverned by mistake). File CONTENTS are never echoed in errors.
 *
 * The returned config occupies the TWO file layers of the cascade
 * (`env.profile ?? env.global ?? file.profile ?? file.global ?? presetSeed ??
 * defaultSeed`); see {@link effective}.
 *
 * @param env - Environment map (defaults to `process.env`).
 * @returns The parsed file config, or `undefined` when the var is unset/empty.
 * @throws {Error} (naming `IRIS_GOVERNANCE_FILE` + the path) on any failure.
 */
export function loadGovernanceFile(
  env: Record<string, string | undefined> = process.env,
): GovernanceConfig | undefined {
  const raw = env.IRIS_GOVERNANCE_FILE;
  if (raw === undefined || raw === "") {
    return undefined;
  }
  const fail = (detail: string): Error => governanceFileError(raw, detail);

  let text: string;
  try {
    text = readFileSync(raw, "utf8");
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    throw fail(`could not read the file (${reason}).`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e: unknown) {
    const reason = e instanceof Error ? e.message : String(e);
    throw fail(`could not parse JSON (${reason}).`);
  }

  return parseGovernanceRoot(parsed, fail);
}

/**
 * Parse the `IRIS_GOVERNANCE_PRESET` environment variable into a
 * {@link GovernancePreset} (Story 24.1, spec 02 §2.2).
 *
 * Mirrors the `IRIS_PROFILES` fail-fast style ({@link profilesError} in
 * `profiles.ts`): an unset/empty value returns `undefined` (no preset — the
 * cascade's `presetSeed` layer becomes a pure pass-through, so this is the
 * byte-for-byte back-compat state, Rule #19). Any value other than exactly
 * `"read-only"` or `"full"` **fails fast at startup**, naming the valid values
 * — a typo (e.g. `"read_only"`) must never silently fall through to "no
 * preset", which would run in full-access mode when the operator intended
 * read-only (a safety trap).
 *
 * @param env - Environment map (defaults to `process.env`).
 * @returns The parsed preset, or `undefined` when `IRIS_GOVERNANCE_PRESET` is unset/empty.
 * @throws {Error} (naming `IRIS_GOVERNANCE_PRESET`) on an unrecognized value.
 */
export function parseGovernancePreset(
  env: Record<string, string | undefined> = process.env,
): GovernancePreset | undefined {
  const raw = env.IRIS_GOVERNANCE_PRESET;
  if (raw === undefined || raw === "") {
    return undefined;
  }
  if (raw === "read-only" || raw === "full") {
    return raw;
  }
  throw presetError(
    `must be one of: ${VALID_PRESETS.join(", ")}. Received: ${JSON.stringify(raw)}.`,
  );
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
 * Build the set of governance keys that are `write` actions but should default
 * to **enabled** (Epic 20, architecture decision F2), from each tool's
 * {@link ToolDefinition.defaultEnabled} list.
 *
 * For every tool that declares `defaultEnabled: [action, ...]`, this collects
 * `tool.name:action` for each listed action. The result is threaded (optional,
 * default-empty) through {@link defaultSeed}; a `write` key present in the set
 * seeds to `true` rather than `false`.
 *
 * Reserved action names are rejected (mirroring the {@link buildMutatesLookup}
 * guard). A tool omitting `defaultEnabled` (every tool but the F2 opt-ins)
 * contributes nothing, so with no opt-in the returned set is empty and the seed
 * is byte-for-byte today's (Rule #19 back-compat gate).
 *
 * **Cross-validation (fail-fast).** Each listed action MUST be declared as a
 * `"write"` in the SAME tool's per-action {@link ToolDefinition.mutates} record.
 * `defaultEnabled` only makes sense for a per-action `write` (the marker's whole
 * job is to flip a `write` key's seed from disabled to enabled). Without this
 * check a typo or drift between the two lists (`defaultEnabled: ["clena"]` while
 * `mutates: { clean: "write" }`) would silently emit an inert `tool:clena` key —
 * matching no real write — leaving the intended write DEFAULT-DISABLED with no
 * error, quietly defeating the F2 opt-in (Story 20.0 review, findings #1/#2). We
 * therefore throw when the action is absent from `mutates`, is classified
 * `"read"`, or the tool uses the scalar `mutates` form (a scalar-write tool's
 * governance key is the bare tool name with no action, so an action-keyed
 * `defaultEnabled` cannot address it — the per-action form is required).
 *
 * @param tools - Tool definitions to introspect (any iterable).
 * @returns A read-only set of `tool:action` keys that are writes-but-enabled-by-default.
 * @throws {Error} If a `defaultEnabled` action is reserved, or is not a per-action
 *   `"write"` in the same tool's `mutates` map.
 */
export function buildDefaultEnabledWrites(
  tools: Iterable<ToolDefinition>,
): ReadonlySet<string> {
  const set = new Set<string>();
  for (const tool of tools) {
    const list = tool.defaultEnabled;
    if (list === undefined) continue;
    const m = tool.mutates;
    for (const action of list) {
      if (RESERVED_KEYS.has(action)) {
        throw new Error(
          `Tool "${tool.name}" declares a reserved \`defaultEnabled\` action key "${action}". ` +
            `Reserved keys (${[...RESERVED_KEYS].join(", ")}) cannot be used as action names.`,
        );
      }
      // Fail-fast: the action must be a per-action `write` in this tool's
      // `mutates`. A scalar `mutates` (or missing/read classification) means the
      // marker would be inert — surface it at registration instead of silently
      // shipping the write default-disabled.
      if (m === undefined || typeof m === "string") {
        throw new Error(
          `Tool "${tool.name}" lists \`defaultEnabled: ["${action}"]\` but does not declare a ` +
            `per-action \`mutates\` record. \`defaultEnabled\` requires \`mutates: { "${action}": "write" }\` ` +
            `on the same tool (a scalar \`mutates\` cannot be addressed by an action-keyed \`defaultEnabled\`).`,
        );
      }
      if (m[action] !== "write") {
        throw new Error(
          `Tool "${tool.name}" lists \`defaultEnabled: ["${action}"]\` but its \`mutates\` does not ` +
            `classify "${action}" as "write" (found ${m[action] === undefined ? "no entry" : `"${m[action]}"`}). ` +
            `\`defaultEnabled\` may only flip a truthful \`write\` action to enabled-by-default.`,
        );
      }
      set.add(`${tool.name}:${action}`);
    }
  }
  return set;
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
 * **"Write, default-enabled" override (Epic 20, decision F2).** A new `write` key
 * that is present in `defaultEnabledWrites` seeds to `true` instead of `false` —
 * the one lever to ship a truthful write enabled-by-default without touching the
 * frozen baseline. The parameter is OPTIONAL and DEFAULT-EMPTY: with the empty
 * set (no tool opts in) this function is byte-for-byte its pre-F2 behavior
 * (Rule #19 back-compat gate).
 *
 * @param key                - The governance key (`tool` or `tool:action`).
 * @param mutatesLookup      - Key → mutation class for new actions.
 * @param baseline           - The generated baseline set (defaults to {@link GOVERNANCE_BASELINE}).
 * @param defaultEnabledWrites - Write keys that should seed enabled (F2); default empty.
 * @returns `true` if enabled by default, `false` if disabled by default.
 */
export function defaultSeed(
  key: string,
  mutatesLookup: MutatesLookup,
  baseline: ReadonlySet<string> = GOVERNANCE_BASELINE,
  defaultEnabledWrites: ReadonlySet<string> = new Set(),
): boolean {
  if (baseline.has(key)) {
    return true;
  }
  // New action: disabled only when explicitly classified as a write/mutation…
  if (mutatesLookup.get(key) === "write") {
    // …unless it opts into "write, default-enabled" (F2): a truthful write that
    // ships enabled while an operator can still disable it via IRIS_GOVERNANCE.
    return defaultEnabledWrites.has(key);
  }
  return true;
}

/**
 * Compute the preset-layer enablement for a single governance key (Story
 * 24.1, spec 02 §2.2). Sits BETWEEN the explicit layers (env, then file —
 * Story 32.0) and {@link defaultSeed} in the cascade: `env.profile ??
 * env.global ?? file.profile ?? file.global ?? presetSeed(...) ??
 * defaultSeed(...)`.
 *
 * - `preset` is `undefined` or `"full"` ⇒ pass-through (`undefined` — falls
 *   through to {@link defaultSeed}). This is what makes an unset (or `"full"`)
 *   preset byte-for-byte today's behavior (Rule #19 back-compat gate).
 * - `preset === "read-only"` ⇒ resolve the key's read/write classification —
 *   `classifications` (typically `BASELINE_ACTION_CLASSIFICATIONS`, for a
 *   frozen-baseline key) takes priority, falling back to `mutatesLookup` (for a
 *   new post-baseline key) — then `"read"` ⇒ `true`, `"write"` ⇒ `false`.
 * - **`defaultEnabled` writes (Epic 20, F2) are STILL `false` under
 *   `"read-only"`** — this function never consults `defaultEnabledWrites`, so
 *   read-only truthfully overrides the F2 default-enable (Rule #32 note:
 *   "read-only means read-only").
 * - An unclassifiable key (present in neither `classifications` nor
 *   `mutatesLookup`) fails SAFE — treated as a write ⇒ `false`. This is
 *   unreachable in a running server (every non-baseline key is required to
 *   carry `mutates` by {@link assertGovernanceClassification}, and every
 *   baseline key is required to be in `classifications` by the Story 24.0
 *   completeness test), but the pure function never lets an unclassifiable key
 *   through read-only mode regardless.
 *
 * @param key             - The governance key (`tool` or `tool:action`).
 * @param preset          - The active preset, or `undefined` when none is set.
 * @param mutatesLookup   - Key → mutation class for new (post-baseline) actions.
 * @param classifications - Key → mutation class for frozen-baseline actions
 *   (typically `BASELINE_ACTION_CLASSIFICATIONS`); default empty for callers
 *   with no baseline keys to classify (e.g. synthetic test worlds).
 * @returns `true`/`false` when `preset === "read-only"`, else `undefined` (pass-through).
 */
export function presetSeed(
  key: string,
  preset: GovernancePreset | undefined,
  mutatesLookup: MutatesLookup,
  classifications: Readonly<Record<string, MutationClass>> = {},
): boolean | undefined {
  if (preset === undefined || preset === "full") {
    return undefined;
  }
  // preset === "read-only": resolve the class, failing safe (write) when
  // unclassifiable. `cls === "read"` is `false` for both "write" and
  // `undefined`, which is exactly the fail-safe behavior documented above.
  // `classifications` is a plain object, so read `key` as an OWN property only —
  // a governance key that collides with an `Object.prototype` member (e.g.
  // "constructor", "toString") must never resolve to an inherited value. This
  // mirrors the own-property discipline `ownBool` applies to the explicit
  // layers; a shadowed lookup would otherwise defeat the `?? mutatesLookup`
  // fallback and (fail-safe) block the key.
  const baselineCls = Object.prototype.hasOwnProperty.call(classifications, key)
    ? classifications[key]
    : undefined;
  const cls = baselineCls ?? mutatesLookup.get(key);
  return cls === "read";
}

/**
 * Resolve a profile's override layer from one config as an OWN property only —
 * a `profile` named after a prototype member (e.g. "constructor") must not
 * read the inherited member. Shared by {@link effective}, {@link
 * hasExplicitOverride}, and {@link configSource} so the env and file configs
 * get the identical treatment.
 */
function ownProfileLayer(
  config: GovernanceConfig | undefined,
  profile: string,
): GovernanceLayer | undefined {
  if (
    config === undefined ||
    config.profiles === undefined ||
    !Object.prototype.hasOwnProperty.call(config.profiles, profile)
  ) {
    return undefined;
  }
  return config.profiles[profile];
}

/**
 * Resolve the effective enablement of one governance key for one profile
 * (architecture decision D4 cascade; Story 24.1 extends it with the
 * `presetSeed` layer; Story 32.0 extends it with the two file layers).
 *
 * `effective = env.profile(key) ?? env.global(key) ?? file.profile(key) ??
 * file.global(key) ?? presetSeed(key) ?? defaultSeed(key)` — ALL env layers
 * above ALL file layers (AC 32.0.2; NOT interleaved per scope — Project Lead
 * decision 2026-07-26: no pre-existing `IRIS_GOVERNANCE` setting may be
 * overridden by a governance file introduced later). Nullish-coalescing
 * (`??`) is intentional: an explicit `false` at ANY layer is honored as
 * "disabled", never treated as "unset" (which `||` would wrongly do) — and it
 * is what lets an explicit override beat the preset too (AC 24.1.2/24.1.4).
 *
 * @param key                - The governance key.
 * @param profile            - The profile name whose overrides take top priority.
 * @param config             - Parsed {@link GovernanceConfig} (the ENV channel).
 * @param mutatesLookup      - Key → mutation class for new actions.
 * @param baseline           - The generated baseline set (defaults to {@link GOVERNANCE_BASELINE}).
 * @param defaultEnabledWrites - Write keys that seed enabled (F2); default empty.
 * @param preset             - Active {@link GovernancePreset} (Story 24.1); default `undefined` (none).
 * @param classifications    - Key → mutation class for frozen-baseline actions (Story 24.1); default empty.
 * @param fileConfig         - Parsed FILE channel ({@link loadGovernanceFile}); default
 *   `undefined` (no file) — byte-for-byte the pre-Epic-32 cascade (AC 32.0.1).
 * @returns `true` if the action is enabled for the profile, else `false`.
 */
export function effective(
  key: string,
  profile: string,
  config: GovernanceConfig,
  mutatesLookup: MutatesLookup,
  baseline: ReadonlySet<string> = GOVERNANCE_BASELINE,
  defaultEnabledWrites: ReadonlySet<string> = new Set(),
  preset?: GovernancePreset,
  classifications: Readonly<Record<string, MutationClass>> = {},
  fileConfig?: GovernanceConfig,
): boolean {
  // Read each layer via ownBool so the `??` cascade only ever sees
  // `boolean | undefined`, never a leaked non-boolean prototype value.
  return (
    ownBool(ownProfileLayer(config, profile), key) ??
    ownBool(config.global, key) ??
    ownBool(ownProfileLayer(fileConfig, profile), key) ??
    ownBool(fileConfig?.global, key) ??
    presetSeed(key, preset, mutatesLookup, classifications) ??
    defaultSeed(key, mutatesLookup, baseline, defaultEnabledWrites)
  );
}

/**
 * Whether an explicit override exists for `key` at ANY of the four explicit
 * layers — env profile, env global, file profile, file global (Story 24.1, AC
 * 24.1.4c; file layers added by Story 32.0) — used by the call-time
 * enforcement gate to distinguish "denied by an explicit `false`" from
 * "denied by the `presetSeed` layer", so a `GOVERNANCE_DISABLED` denial can
 * accurately attribute WHY the call was blocked (`presetApplied` is set only
 * for the latter).
 *
 * **File-layer attribution decision (Story 32.0, documented per the story's
 * Constraints):** a file-layer explicit value IS an explicit override — the
 * denial was operator-configured (via `IRIS_GOVERNANCE_FILE`), so a denial
 * that the file caused must NOT be attributed to the preset. With no file
 * (`fileConfig === undefined`) the result is byte-for-byte the pre-Epic-32
 * behavior (AC 32.0.1's attribution deep-equal constraint).
 *
 * @param key        - The governance key.
 * @param profile    - The profile name whose overrides take top priority.
 * @param config     - Parsed {@link GovernanceConfig} (the ENV channel).
 * @param fileConfig - Parsed FILE channel ({@link loadGovernanceFile}); default `undefined`.
 * @returns `true` when any explicit layer carries a boolean for `key`.
 */
export function hasExplicitOverride(
  key: string,
  profile: string,
  config: GovernanceConfig,
  fileConfig?: GovernanceConfig,
): boolean {
  return (
    ownBool(ownProfileLayer(config, profile), key) !== undefined ||
    ownBool(config.global, key) !== undefined ||
    ownBool(ownProfileLayer(fileConfig, profile), key) !== undefined ||
    ownBool(fileConfig?.global, key) !== undefined
  );
}

/**
 * Which configuration channel resolved a key's effective value (Epic 32,
 * Story 32.0, AC 32.0.3): the first cascade layer that carries the key —
 * `"env"` (either `IRIS_GOVERNANCE` layer), `"file"` (either
 * `IRIS_GOVERNANCE_FILE` layer), `"preset"` (the `presetSeed` layer — a
 * `read-only` preset resolves every key), or `"default"` (the seed). Emitted
 * unconditionally: with no file set, keys simply never report `"file"`.
 */
export type GovernanceConfigSource = "env" | "file" | "preset" | "default";

/**
 * Resolve the {@link GovernanceConfigSource} for one key — walks the SAME
 * cascade ordering as {@link effective} and reports which layer FIRST carries
 * the key (single-sourced with the cascade via {@link ownProfileLayer}/
 * {@link ownBool}/{@link presetSeed}, so source and value can never disagree
 * about ordering).
 *
 * @param key             - The governance key.
 * @param profile         - The profile name.
 * @param config          - Parsed {@link GovernanceConfig} (the ENV channel).
 * @param mutatesLookup   - Key → mutation class for new actions.
 * @param preset          - Active {@link GovernancePreset}; default `undefined` (none).
 * @param classifications - Key → mutation class for frozen-baseline actions; default empty.
 * @param fileConfig      - Parsed FILE channel; default `undefined` (no file).
 */
export function configSource(
  key: string,
  profile: string,
  config: GovernanceConfig,
  mutatesLookup: MutatesLookup,
  preset?: GovernancePreset,
  classifications: Readonly<Record<string, MutationClass>> = {},
  fileConfig?: GovernanceConfig,
): GovernanceConfigSource {
  if (
    ownBool(ownProfileLayer(config, profile), key) !== undefined ||
    ownBool(config.global, key) !== undefined
  ) {
    return "env";
  }
  if (
    fileConfig !== undefined &&
    (ownBool(ownProfileLayer(fileConfig, profile), key) !== undefined ||
      ownBool(fileConfig.global, key) !== undefined)
  ) {
    return "file";
  }
  if (presetSeed(key, preset, mutatesLookup, classifications) !== undefined) {
    return "preset";
  }
  return "default";
}

/**
 * Compute the per-key {@link GovernanceConfigSource} map for a profile over
 * `allKeys` (Epic 32, AC 32.0.3) — the sibling of {@link getEffectivePolicy},
 * consumed by the SAME surfaces (the `iris_server_profiles` governance view
 * and the `iris-governance://{profile}` resource) and by the Story 32.1 CLI.
 * Callers pass the SAME `governedKeys` they pass to `getEffectivePolicy`
 * (the Epic-30 `visibleGovernedKeys()` filter at the server surfaces), so the
 * source map inherits the hidden-tool key omission structurally.
 *
 * @param profile         - The profile name.
 * @param config          - Parsed {@link GovernanceConfig} (the ENV channel).
 * @param allKeys         - Every known governance key to report (already visibility-filtered).
 * @param mutatesLookup   - Key → mutation class for new actions.
 * @param preset          - Active {@link GovernancePreset}; default `undefined` (none).
 * @param classifications - Key → mutation class for frozen-baseline actions; default empty.
 * @param fileConfig      - Parsed FILE channel; default `undefined` (no file).
 * @returns A `Record<key, GovernanceConfigSource>` for the profile.
 */
export function getEffectiveConfigSources(
  profile: string,
  config: GovernanceConfig,
  allKeys: Iterable<string>,
  mutatesLookup: MutatesLookup,
  preset?: GovernancePreset,
  classifications: Readonly<Record<string, MutationClass>> = {},
  fileConfig?: GovernanceConfig,
): Record<string, GovernanceConfigSource> {
  const sources: Record<string, GovernanceConfigSource> = {};
  for (const key of allKeys) {
    // defineProperty, mirroring getEffectivePolicy: a key colliding with a
    // prototype member becomes a real own enumerable property (1-key-per-
    // allKeys invariant), never a silent no-op or prototype mutation.
    Object.defineProperty(sources, key, {
      value: configSource(
        key,
        profile,
        config,
        mutatesLookup,
        preset,
        classifications,
        fileConfig,
      ),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return sources;
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
 * @param config         - Parsed {@link GovernanceConfig} (the ENV channel).
 * @param allKeys        - Every known governance key (baseline ∪ registered keys).
 * @param mutatesLookup  - Key → mutation class for new actions.
 * @param baseline       - The generated baseline set (defaults to {@link GOVERNANCE_BASELINE}).
 * @param defaultEnabledWrites - Write keys that seed enabled (F2); default empty.
 * @param preset         - Active {@link GovernancePreset} (Story 24.1); default `undefined` (none).
 * @param classifications - Key → mutation class for frozen-baseline actions (Story 24.1); default empty.
 * @param fileConfig     - Parsed FILE channel ({@link loadGovernanceFile}); default
 *   `undefined` (no file) — byte-for-byte the pre-Epic-32 policy map (AC 32.0.1).
 * @returns A `Record<key, boolean>` of effective enablement for the profile.
 */
export function getEffectivePolicy(
  profile: string,
  config: GovernanceConfig,
  allKeys: Iterable<string>,
  mutatesLookup: MutatesLookup,
  baseline: ReadonlySet<string> = GOVERNANCE_BASELINE,
  defaultEnabledWrites: ReadonlySet<string> = new Set(),
  preset?: GovernancePreset,
  classifications: Readonly<Record<string, MutationClass>> = {},
  fileConfig?: GovernanceConfig,
): Record<string, boolean> {
  const policy: Record<string, boolean> = {};
  for (const key of allKeys) {
    // Use defineProperty so a key that collides with a prototype member (e.g.
    // "__proto__") is written as a real own enumerable property rather than
    // silently no-op'ing the assignment — preserving the 1-key-per-allKeys
    // invariant the enforcement layer (Story 14.4) relies on.
    Object.defineProperty(policy, key, {
      value: effective(
        key,
        profile,
        config,
        mutatesLookup,
        baseline,
        defaultEnabledWrites,
        preset,
        classifications,
        fileConfig,
      ),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return policy;
}
