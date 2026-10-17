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
