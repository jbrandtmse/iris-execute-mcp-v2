/**
 * The PHI data policy (Story 39.2; architecture decisions AD-26, AD-9, AD-6 and AD-8).
 *
 * A per-profile `dataPolicy` governs every output that carries message-body data. It takes one of
 * three values, ordered by strictness: `block` (withhold every body), `redact` (the default; show a
 * body only in a form that cannot carry identifying data) and `allow` (show it as before).
 *
 * **Precedence.** For a profile P, the first value found wins:
 *  1. the `IRIS_PROFILES` entry of P, field `dataPolicy`;
 *  2. the operator variable `IRIS_DATA_POLICY`;
 *  3. the governance file's `dataPolicy.profiles.P`;
 *  4. the governance file's `dataPolicy.global`;
 *  5. `redact`.
 *
 * A value on the `default` entry applies to `default` only and is never inherited: a named profile
 * resolves its own value, falling to the next channel, never to the `default` entry's. Each profile
 * records which channel supplied its value ({@link DataPolicySource}).
 *
 * This module has no runtime dependency on the rest of the package (type-only imports), so the
 * configuration modules can import it without a cycle.
 */

import type { GovernanceConfig } from "./governance.js";

/** The three policy values, from the strictest to the loosest. */
export const DATA_POLICIES = ["block", "redact", "allow"] as const;

/** One of the {@link DATA_POLICIES}. */
export type DataPolicy = (typeof DATA_POLICIES)[number];

/** The policy a profile has when no channel names one. */
export const DEFAULT_DATA_POLICY: DataPolicy = "redact";

/** The channel that supplied a profile's {@link DataPolicy}. */
export type DataPolicySource =
  | "IRIS_PROFILES"
  | "IRIS_DATA_POLICY"
  | "IRIS_GOVERNANCE_FILE:profiles"
  | "IRIS_GOVERNANCE_FILE:global"
  | "default";

/** The kinds a message body can have; {@link BodyKind} is the classifier's vocabulary. */
export const BODY_KINDS = [
  "hl7v2",
  "xmlvdoc",
  "vdoc",
  "stream",
  "streamContainer",
  "persistent",
  "literal",
  "missing",
  "other",
] as const;

/** One of the {@link BODY_KINDS}, as `ExecuteMCPv2.REST.MessageSearch.BodyKind` returns it. */
export type BodyKind = (typeof BODY_KINDS)[number];

/** Whether `value` is one of the {@link BODY_KINDS}. */
export function isBodyKind(value: unknown): value is BodyKind {
  return typeof value === "string" && (BODY_KINDS as readonly string[]).includes(value);
}

/** Whether a body of kind `kind` can be redacted by the engine: only HL7 v2 (ER7) can. */
export function isRedactableBodyKind(kind: BodyKind): boolean {
  return kind === "hl7v2";
}

/** The operator variable that sets the policy for every profile that no `IRIS_PROFILES` entry sets. */
export const DATA_POLICY_ENV_VAR = "IRIS_DATA_POLICY";

/**
 * The longest HL7 v2 body, in characters, a body-text consumer asks IRIS for. A longer body is
 * withheld under `redact` (reason {@link BLOCK_REASONS.hl7TooLarge}).
 */
export const HL7_BODY_TEXT_MAX_CHARS = 65536;

/**
 * Parse one policy value, case-insensitively. Returns the lowercase policy, or `undefined` when
 * `raw` is not a string naming one.
 */
export function parseDataPolicyValue(raw: unknown): DataPolicy | undefined {
  if (typeof raw !== "string") return undefined;
  const lower = raw.toLowerCase();
  return (DATA_POLICIES as readonly string[]).includes(lower) ? (lower as DataPolicy) : undefined;
}

/**
 * Read the operator variable `IRIS_DATA_POLICY`.
 *
 * @param env - Environment map (defaults to `process.env`).
 * @returns The policy, or `undefined` when the variable is unset or empty.
 * @throws {Error} (naming `IRIS_DATA_POLICY`) when it is set to anything but `block`, `redact` or
 *   `allow`, in any letter case.
 */
export function parseOperatorDataPolicy(
  env: Record<string, string | undefined> = process.env,
): DataPolicy | undefined {
  const raw = env.IRIS_DATA_POLICY;
  if (raw === undefined || raw === "") return undefined;
  const policy = parseDataPolicyValue(raw);
  if (policy === undefined) {
    throw new Error(`${DATA_POLICY_ENV_VAR} must be "block", "redact" or "allow". Received: "${raw}".`);
  }
  return policy;
}

/** The part of a profile the resolution reads and writes. */
export interface DataPolicyCarrier {
  /** The profile's registered name. */
  name: string;
  /** The resolved policy, or, before resolution, the `IRIS_PROFILES` entry's value. */
  dataPolicy?: DataPolicy;
  /** The channel that supplied {@link dataPolicy}. */
  dataPolicySource?: DataPolicySource;
}

/**
 * Resolve the policy of one profile (see the module comment for the order). Only a value that
 * `IRIS_PROFILES` set on the profile itself counts as the profile's own: a value an earlier
 * resolution wrote from another channel is recomputed, so the function is idempotent.
 *
 * @param profile - The profile.
 * @param operator - The `IRIS_DATA_POLICY` value, when set.
 * @param fileConfig - The parsed governance file, when `IRIS_GOVERNANCE_FILE` is set.
 */
export function resolveDataPolicy(
  profile: DataPolicyCarrier,
  operator: DataPolicy | undefined,
  fileConfig: GovernanceConfig | undefined,
): { policy: DataPolicy; source: DataPolicySource } {
  if (profile.dataPolicySource === "IRIS_PROFILES" && profile.dataPolicy !== undefined) {
    return { policy: profile.dataPolicy, source: "IRIS_PROFILES" };
  }
  if (operator !== undefined) return { policy: operator, source: "IRIS_DATA_POLICY" };
  const section = fileConfig?.dataPolicy;
  const profiles = section?.profiles;
  if (profiles !== undefined && Object.prototype.hasOwnProperty.call(profiles, profile.name)) {
    const own = profiles[profile.name];
    if (own !== undefined) return { policy: own, source: "IRIS_GOVERNANCE_FILE:profiles" };
  }
  if (section?.global !== undefined) return { policy: section.global, source: "IRIS_GOVERNANCE_FILE:global" };
  return { policy: DEFAULT_DATA_POLICY, source: "default" };
}

/**
 * Resolve the policy of every profile in `registry` and replace each entry with
 * `{...profile, dataPolicy, dataPolicySource}`. The registry is changed in place.
 */
export function applyDataPolicies<P extends DataPolicyCarrier>(
  registry: Map<string, P>,
  operator: DataPolicy | undefined,
  fileConfig: GovernanceConfig | undefined,
): void {
  for (const [name, profile] of [...registry.entries()]) {
    const { policy, source } = resolveDataPolicy(profile, operator, fileConfig);
    registry.set(name, { ...profile, dataPolicy: policy, dataPolicySource: source });
  }
}

/** The policy that applies to a call: the profile's resolved one, `redact` when it has none. */
export function effectiveDataPolicy(config: { dataPolicy?: DataPolicy }): DataPolicy {
  return config.dataPolicy ?? DEFAULT_DATA_POLICY;
}

/** How strict a policy is: `block` 2, `redact` 1, `allow` 0. */
function strictness(policy: DataPolicy): number {
  return DATA_POLICIES.length - 1 - DATA_POLICIES.indexOf(policy);
}

/**
 * Combine the operator's policy with a policy a caller asked for. A caller can only tighten: the
 * stricter of the two applies, and `clamped` is `true` when the caller asked for a looser one.
 *
 * @param operator - The profile's effective policy.
 * @param requested - The caller's policy, when it names one.
 */
export function tightenDataPolicy(
  operator: DataPolicy,
  requested?: DataPolicy,
): { policy: DataPolicy; clamped: boolean } {
  if (requested === undefined) return { policy: operator, clamped: false };
  if (strictness(requested) > strictness(operator)) return { policy: requested, clamped: false };
  return { policy: operator, clamped: strictness(requested) < strictness(operator) };
}

/**
 * The raw-read and code-execution governance keys that `block` seeds disabled (Story 45.4; AD-6, decisions #169
 * and #172), declared once, in this order. Each key belongs to exactly one server of the suite.
 *
 * The set is exhaustive as of {@link DATA_POLICY_BLOCK_KEYS_AS_OF}. Its source is the PHI scope table of
 * `tool_support.md` plus the Rule #56 sweep of the 110 package tools. The tools it leaves out are residual
 * rows of that table, each with its reason. `iris_docdb_document:delete` is a write, but it returns the
 * document it deletes, so it reads a stored document. The other write tools that run code (compile, load,
 * production start, cube build, task run) are not in it: the `read-only` preset covers them.
 */
export const DATA_POLICY_BLOCK_KEYS: readonly string[] = Object.freeze([
  "iris_sql_query",
  "iris_sql_execute",
  "iris_global_get",
  "iris_global_list",
  "iris_execute_command",
  "iris_execute_classmethod",
  "iris_execute_tests",
  "iris_test_coverage",
  "iris_transform_test",
  "iris_docdb_document:get",
  "iris_docdb_document:delete",
  "iris_docdb_find",
]);

/** The date {@link DATA_POLICY_BLOCK_KEYS} is exhaustive as of. */
export const DATA_POLICY_BLOCK_KEYS_AS_OF = "2026-11-25";

/** {@link DATA_POLICY_BLOCK_KEYS} as a set. */
const BLOCK_KEY_SET: ReadonlySet<string> = new Set(DATA_POLICY_BLOCK_KEYS);

/**
 * The `block` seed of one governance key (Story 45.4; AD-6): `false` when the profile's policy is `block` and
 * `key` is in `blockKeys`, else `undefined` (pass-through to the next layer). Any other policy, or none, is
 * `undefined`, which is what keeps the cascade byte-identical under `redact`, `allow` and an unset policy.
 *
 * @param key - The governance key (`tool` or `tool:action`).
 * @param policy - The profile's resolved data policy; `undefined` when the caller has none.
 * @param blockKeys - The covered keys; defaults to {@link DATA_POLICY_BLOCK_KEYS}.
 */
export function dataPolicySeed(
  key: string,
  policy: DataPolicy | undefined,
  blockKeys: readonly string[] = DATA_POLICY_BLOCK_KEYS,
): false | undefined {
  if (policy !== "block") return undefined;
  const covered = blockKeys === DATA_POLICY_BLOCK_KEYS ? BLOCK_KEY_SET.has(key) : blockKeys.includes(key);
  return covered ? false : undefined;
}

/** One profile of the startup warning: its name and its resolved policy (the caller answers which keys are open). */
export interface DataPolicyWarningProfile {
  name: string;
  policy: DataPolicy;
}

/** The setting a `configSource` of `env` or `file` names in the startup warning. */
const RE_ENABLE_SOURCE_NAMES: Readonly<Record<string, string>> = Object.freeze({
  env: "IRIS_GOVERNANCE",
  file: "IRIS_GOVERNANCE_FILE",
});

/**
 * The text of the startup `[WARN]` line of Story 45.4 (AD-26), or `undefined` when no profile has a key to list.
 *
 * For each `redact` or `block` profile, in the order given, it lists the keys of `blockKeys` for which
 * `isCallable(profile, key)` is `true` (the caller answers: the tool is visible on this server and the key is
 * enabled for the profile). Under `block` such a key is enabled only by an explicit governance key, and each
 * such key is followed by the setting that re-enabled it (`from IRIS_GOVERNANCE` for a `configSource` of `env`,
 * `from IRIS_GOVERNANCE_FILE` for `file`), as `reEnabledBy` reports it. A profile under `allow` is never named.
 * Profiles with the same policy and the same list share one group, and the groups are written in the order of
 * their first profile. Keys are listed in declaration order and names are written with `JSON.stringify`.
 *
 * The wording depends on the policies named (decision #170 item 2, as the Planner amended it for #172):
 *  - only `redact` groups: the line says `redact` covers message bodies only, and offers `block` as a way out;
 *  - only `block` groups: it says an explicit governance key re-enabled the tools, never says `redact`, and
 *    says to remove those keys or set them to `false` in the setting named;
 *  - both: one line in which each group carries its own reason, with the `redact` ways out.
 *
 * The line never carries a value, and never offers `allow` as a way out: the ways out are the governance keys,
 * or `block` when a `redact` group is named.
 *
 * @param profiles - Every profile of the server, in registry order, with its resolved policy.
 * @param isCallable - Whether `key` is visible on this server and enabled for the profile named `profile`.
 * @param blockKeys - The covered keys; defaults to {@link DATA_POLICY_BLOCK_KEYS}.
 * @param reEnabledBy - The `configSource` of `key` for the profile named `profile` (`env` or `file` for a
 *   re-enabled key under `block`); asked only for the keys of a `block` group. Absent, no source is named.
 */
export function buildDataPolicyWarning(
  profiles: readonly DataPolicyWarningProfile[],
  isCallable: (profile: string, key: string) => boolean,
  blockKeys: readonly string[] = DATA_POLICY_BLOCK_KEYS,
  reEnabledBy?: (profile: string, key: string) => string | undefined,
): string | undefined {
  const groups = new Map<string, { policy: "redact" | "block"; names: string[]; items: string[] }>();
  for (const profile of profiles) {
    if (profile.policy === "allow") continue;
    const keys = blockKeys.filter((key) => isCallable(profile.name, key));
    if (keys.length === 0) continue;
    const policy = profile.policy;
    const items =
      policy === "block"
        ? keys.map((key) => {
            const source = reEnabledBy?.(profile.name, key);
            const setting = source === undefined ? undefined : RE_ENABLE_SOURCE_NAMES[source];
            return setting === undefined ? key : `${key} from ${setting}`;
          })
        : keys;
    const id = `${policy}|${items.join(",")}`;
    const group = groups.get(id);
    if (group === undefined) groups.set(id, { policy, names: [profile.name], items });
    else group.names.push(profile.name);
  }
  if (groups.size === 0) return undefined;
  const all = [...groups.values()];
  const hasRedact = all.some((group) => group.policy === "redact");
  const hasBlock = all.some((group) => group.policy === "block");
  const parts = all.map((group) => {
    const names = group.names.map((name) => JSON.stringify(name)).join(", ");
    const reason =
      group.policy === "block"
        ? "block, re-enabled by an explicit governance key"
        : hasBlock
          ? "redact, which covers message bodies only"
          : "redact";
    return `${group.names.length === 1 ? "profile" : "profiles"} ${names} (${reason}): ${group.items.join(", ")}`;
  });
  const lead = !hasBlock
    ? `Data policy: "redact" covers message bodies only, so these raw-read and code-execution tools are enabled and ` +
      `their results are not redacted or withheld: `
    : !hasRedact
      ? `Data policy: an explicit governance key re-enabled these raw-read and code-execution tools under "block", ` +
        `so their results are not withheld: `
      : `Data policy: these raw-read and code-execution tools are enabled, so their results are not redacted or ` +
        `withheld: `;
  const wayOut = hasRedact
    ? "To turn tools off, set their governance keys to false (IRIS_GOVERNANCE or IRIS_GOVERNANCE_FILE) or set " +
      "IRIS_DATA_POLICY=block."
    : "To turn them off again, remove those keys or set them to false in the setting named.";
  return `${lead}${parts.join("; ")}. ${wayOut} See "PHI data policy" in the README.`;
}

/** What a policy did over one request: the policy and how many bodies were shown redacted or withheld. */
export interface DataPolicySummary {
  policy: DataPolicy;
  redacted: number;
  blocked: number;
}

/** What a policy did to one body. */
export type BodyPolicyOutcome =
  | { outcome: "redacted"; redactedFields: number }
  | { outcome: "blocked"; reason: string }
  | { outcome: "none" };

/**
 * The fixed reasons a body is withheld. The resend preview uses {@link BLOCK_REASONS.blockPolicy}
 * and {@link BLOCK_REASONS.unredactableKind}; the others belong to the consumers of
 * `redactHl7`, which read a body's text.
 */
export const BLOCK_REASONS = {
  /** `block` withholds every body. */
  blockPolicy: (): string => "The block data policy withholds every message body.",
  /** The body kind has no redaction engine. */
  unredactableKind: (kind: BodyKind): string =>
    `A ${kind} body cannot be redacted reliably, so the redact data policy withholds it.`,
  /** The HL7 v2 text is longer than {@link HL7_BODY_TEXT_MAX_CHARS}. */
  hl7TooLarge: (): string =>
    `The HL7 v2 body is longer than ${HL7_BODY_TEXT_MAX_CHARS} characters, so the redact data policy withholds it.`,
  /** IRIS could not read the HL7 v2 text in full. */
  hl7Unreadable: (): string =>
    "The HL7 v2 body could not be read in full, so the redact data policy withholds it.",
  /** The redaction engine refused the text; `engineReason` is the engine's fixed reason. */
  hl7Unparseable: (engineReason: string): string =>
    `The HL7 v2 body could not be parsed (${engineReason}), so the redact data policy withholds it.`,
  /** `block` withholds an Event Log entry's text (`iris_production_logs`). */
  eventLogText: (): string =>
    "The block data policy withholds Event Log text, which can carry message content.",
  /** `block` withholds the text of an error warning in `iris_message_diagram`. */
  diagramErrorText: (): string =>
    "The block data policy withholds error text, which can carry message content.",
} as const;

/**
 * What a policy decides for one body before any text is read: `none` (the policy does not touch it), `blocked`
 * (withheld, with the fixed `reason`) or `redact` (the consumer redacts it, which only an HL7 v2 body allows).
 */
export type BodyPolicyPlan =
  | { outcome: "none" }
  | { outcome: "blocked"; reason: string }
  | { outcome: "redact" };

/**
 * The policy's decision for one body, from its kind and whether it can be read. The first rule that holds
 * decides:
 *  1. a body that is not available (`available` is `false`): `none`;
 *  2. policy `block`: `blocked` ({@link BLOCK_REASONS.blockPolicy});
 *  3. policy `redact`: `redact` for an `hl7v2` body, otherwise `blocked` ({@link BLOCK_REASONS.unredactableKind});
 *  4. policy `allow`: `none`.
 *
 * A kind outside the nine tokens is the consumer's to map (to `other`) before it calls this.
 *
 * @param kind - The body kind, from `ExecuteMCPv2.REST.MessageSearch.BodyKind`.
 * @param available - Whether the body can be read (a literal header value counts as available to a reader).
 * @param policy - The policy that applies to the call.
 */
export function decideBodyPolicy(kind: BodyKind, available: boolean, policy: DataPolicy): BodyPolicyPlan {
  if (!available) return { outcome: "none" };
  if (policy === "block") return { outcome: "blocked", reason: BLOCK_REASONS.blockPolicy() };
  if (policy === "redact") {
    return isRedactableBodyKind(kind)
      ? { outcome: "redact" }
      : { outcome: "blocked", reason: BLOCK_REASONS.unredactableKind(kind) };
  }
  return { outcome: "none" };
}
