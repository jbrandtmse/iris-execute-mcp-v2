/**
 * Cross-profile environment promotion planner for the IRIS Development MCP
 * server (Epic 27, Story 27.2 — builds on the Story 27.0/27.1 `iris_env_diff`
 * tool).
 *
 * Provides {@link envPromoteTool} — `iris_env_promote` — with two actions:
 *
 * - **plan** (read, enabled by default): a PURE TRANSFORM of a prior
 *   `iris_env_diff` `structuredContent` result (passed as `diff`) into an
 *   ORDERED promotion plan — a numbered list of steps plus a set of
 *   informational warnings. No IRIS connection is made (`scope: "NONE"`);
 *   the transform is deterministic and fully unit-testable with fixtures.
 * - **execute** (write, DEFAULT-DISABLED): ships in Story 27.3. Registered
 *   here (governance-classified) so the tool's key set is stable across both
 *   stories; calling it now returns a clear "ships in Story 27.3" refusal.
 *
 * **Ordering (dependency order, AC 27.2.1):** steps are grouped by domain in
 * EXACTLY this order — `mappings` (target needs the right global/routine/
 * package DB mappings before code lands) → `documents` (put+compile, batched)
 * → `defaultSettings` (SDS — config the code reads) → `webapps` →
 * `config` (instance-wide CPF, last). Within a domain, steps are sorted by
 * `subject` for a deterministic sub-order.
 *
 * **Safety invariants (spec `05-env-diff-promotion.md` §4/§7 — load-bearing
 * for the whole promote feature):**
 * - `onlyInTarget` diff entries become `warnings`, NEVER steps. **No
 *   delete/remove operation exists anywhere in any plan, in this or any
 *   future version** — the #1 safety promise of the promote feature.
 * - Direction is always `"sourceToTarget"` — promote source's state onto
 *   target. No bidirectional/reverse steps.
 * - A credential-redacted System Default Settings value (the `1e2008753853`-
 *   era `[REDACTED]` / `[REDACTED:differs]` markers from Story 27.1) survives
 *   into the plan's `detail` text unchanged — the plaintext never appears in
 *   plan output, because it was never in the input `diff` to begin with.
 *
 * **Plan hash (AC 27.2.3):** {@link computePlanHash} — a SHA-256 hex digest
 * of a canonical, key-sorted JSON serialization of the input `diff` —
 * embedded as `planHash` in the plan output. Deterministic (same diff → same
 * hash) and sensitive (any diff change → a different hash). This is the
 * stale-plan-protection input Story 27.3's `execute` will re-derive and
 * compare against `plan.planHash` before running any step — exported so 27.3
 * can reuse the EXACT same algorithm rather than reimplementing it.
 *
 * Read-only `plan` (`mutates: { plan: "read", execute: "write" }` — Rule
 * #28, mandatory even for a read), `scope: "NONE"` (profiles are explicit
 * `source`/`target` params, matching `iris_env_diff`'s convention).
 * `execute` is a real environment-mutating write and — per Rule #32 — is
 * deliberately NOT `defaultEnabled` (promotion is not a recovery-of-last-
 * resort action like `iris_production_control:clean`).
 */

import { createHash } from "node:crypto";
import type {
  ToolDefinition,
  ToolContext,
  ToolResult,
  IrisHttpClient,
  MutatesLookup,
} from "@iris-mcp/shared";
import {
  IrisApiError,
  ProfileResolutionError,
  atelierPath,
  negotiateVersion,
  parseGovernanceConfig,
  parseGovernancePreset,
  effective,
  GOVERNANCE_BASELINE,
  BASELINE_ACTION_CLASSIFICATIONS,
} from "@iris-mcp/shared";
import { z } from "zod";
import {
  fetchMappings,
  fetchDefaultSettings,
  fetchWebapps,
  fetchConfig,
  type MappingEntry,
  type SdsEntry,
  type WebAppEntry,
  type ConfigProperties,
} from "./env-diff.js";

/** Base URL for the custom ExecuteMCPv2 REST service (mirrors env-diff.ts / sibling tools). */
const BASE_URL = "/api/executemcp/v2";

/** Domains a plan may cover, in the FIXED dependency order (AC 27.2.1). */
const PLAN_DOMAIN_ORDER = [
  "mappings",
  "documents",
  "defaultSettings",
  "webapps",
  "config",
] as const;
type PromoteDomain = (typeof PLAN_DOMAIN_ORDER)[number];

/** Per-domain write verb (AC 27.2.1 Task 2) — aligned with the write endpoint 27.3's `execute` will call. */
type PlanOperation =
  | "createMapping"
  | "updateMapping"
  | "putAndCompile"
  | "setDefaultSetting"
  | "modifyWebApp"
  | "setConfig";

/** A step BEFORE the global 1-based `index`/`domain`/`direction` are attached (internal). */
interface RawStep {
  operation: PlanOperation;
  subject: string;
  detail: string;
}

/** One ordered, actionable promotion step (AC 27.2.1). */
interface PlanStep {
  index: number;
  domain: PromoteDomain;
  operation: PlanOperation;
  subject: string;
  detail: string;
  direction: "sourceToTarget";
}

/** An informational warning — an item that exists on the target only (AC 27.2.2). NEVER a step. */
interface PlanWarning {
  domain: PromoteDomain;
  subject: string;
  detail: string;
}

interface ProfileRef {
  profile: string;
  namespace: string;
}

interface PlanResult {
  source: ProfileRef;
  target: ProfileRef;
  planHash: string;
  steps: PlanStep[];
  warnings: PlanWarning[];
  summary: { stepCount: number; warningCount: number };
}

// ── generic helpers (defensive against a loosely-typed, caller-supplied `diff`) ──

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Coerce to an array of `T`, defensively — a non-array (malformed input) yields `[]`. */
function arr<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** Coerce to a string, defensively — `null`/`undefined` become `""`. */
function str(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return String(value);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isPlainObject(value) ? value : undefined;
}

/**
 * Coerce to an array of PLAIN-OBJECT records, defensively dropping any
 * non-object element (`null`, a nested array, a scalar). Keeps the per-domain
 * builders TOTAL on a loosely-typed, caller-supplied `diff`: a `null`/malformed
 * element in a record bucket (e.g. `differs: [null]`) is skipped rather than
 * dereferenced (which would throw before the `str()`/`asRecord()` coercions run
 * and degrade the clean validation refusal into a generic "Tool error").
 */
function records(value: unknown): Record<string, unknown>[] {
  return arr<unknown>(value).filter(isPlainObject);
}

/**
 * Locale-INDEPENDENT subject comparator (code-unit order). Sub-ordering within
 * a domain must be deterministic across environments/ICU versions (AC 27.2.1);
 * `String.prototype.localeCompare` with no locale is ICU/host-dependent.
 */
function bySubject(a: { subject: string }, b: { subject: string }): number {
  return a.subject < b.subject ? -1 : a.subject > b.subject ? 1 : 0;
}

/** First `12` hex chars + ellipsis, or `"?"` for a missing/non-string hash (mirrors `env-diff.ts` rendering). */
function shortHash(value: unknown): string {
  const s = str(value);
  return s.length > 0 ? `${s.slice(0, 12)}...` : "?";
}

/**
 * Extract the leading `type` segment from a `type::name` mapping key
 * (env-diff.ts `mappingKey`, cycle-2 HIGH fix, 2026-07-11: the key no longer
 * embeds a per-side `namespace` segment — see `mappingKey`'s doc comment).
 */
function mappingTypeFromKey(key: string): string {
  const idx = key.indexOf("::");
  const type = idx === -1 ? "" : key.slice(0, idx);
  return type.length > 0 ? type : "mapping";
}

/** Stable per-item key for a System Default Settings row (Rule #29 delimiter, mirrors `env-diff.ts` `sdsKey`). */
function sdsSubject(raw: Record<string, unknown>): string {
  return `${str(raw.production)}||${str(raw.item)}||${str(raw.hostClass)}||${str(raw.setting)}`;
}

/** Uniform warning text for every domain's `onlyInTarget` bucket (AC 27.2.2). */
const WARNING_DETAIL = "exists on target only -- not promoted, not deleted";

// ── per-domain step/warning builders ────────────────────────────────

type DomainBuildResult = { steps: RawStep[]; warnings: PlanWarning[] };

function buildMappingsSteps(domain: Record<string, unknown> | undefined): DomainBuildResult {
  const steps: RawStep[] = [];
  const warnings: PlanWarning[] = [];

  for (const key of arr<string>(domain?.onlyInSource)) {
    const subject = str(key);
    const type = mappingTypeFromKey(subject);
    steps.push({
      operation: "createMapping",
      subject,
      detail: `create ${type} mapping (exists on source only)`,
    });
  }
  for (const raw of records(domain?.differs)) {
    const type = str(raw.type) || "mapping";
    // Cycle-2 HIGH fix (2026-07-11): subject is `type::name` only, matching
    // env-diff.ts's `mappingKey` -- `raw.namespace` is per-side display info
    // (see `MappingDiffEntry`), never part of the identity key.
    const subject = `${type}::${str(raw.name)}`;
    steps.push({
      operation: "updateMapping",
      subject,
      detail: `update ${type} mapping value (source differs from target)`,
    });
  }
  for (const key of arr<string>(domain?.onlyInTarget)) {
    warnings.push({ domain: "mappings", subject: str(key), detail: WARNING_DETAIL });
  }

  return { steps, warnings };
}

function buildDocumentsSteps(domain: Record<string, unknown> | undefined): DomainBuildResult {
  const steps: RawStep[] = [];
  const warnings: PlanWarning[] = [];

  for (const name of arr<string>(domain?.onlyInSource)) {
    steps.push({
      operation: "putAndCompile",
      subject: str(name),
      detail: "put and compile (new on target, batched put+compile)",
    });
  }
  for (const raw of records(domain?.differs)) {
    const sourceShort = shortHash(raw.sourceHash);
    const targetShort = shortHash(raw.targetHash);
    steps.push({
      operation: "putAndCompile",
      subject: str(raw.name),
      detail: `put and compile (hash ${sourceShort} -> ${targetShort}, batched put+compile)`,
    });
  }
  for (const name of arr<string>(domain?.onlyInTarget)) {
    warnings.push({ domain: "documents", subject: str(name), detail: WARNING_DETAIL });
  }

  return { steps, warnings };
}

function buildDefaultSettingsSteps(domain: Record<string, unknown> | undefined): DomainBuildResult {
  const steps: RawStep[] = [];
  const warnings: PlanWarning[] = [];

  for (const raw of records(domain?.onlyInSource)) {
    steps.push({
      operation: "setDefaultSetting",
      subject: sdsSubject(raw),
      detail: `create setting (value: ${str(raw.value)})`,
    });
  }
  for (const raw of records(domain?.differs)) {
    // A credential-ish setting carries `redacted` (e.g. "[REDACTED:differs]")
    // and OMITS sourceValue/targetValue entirely (Story 27.1) -- the marker
    // is carried through verbatim; the plaintext is never referenced because
    // it was never present in the input to begin with.
    // Fail CLOSED: ANY present `redacted` marker (Story 27.1 sets the string
    // "[REDACTED:differs]" and omits sourceValue/targetValue) means the raw
    // value fields must NEVER be read -- even if a malformed diff carried a
    // non-string marker alongside stray raw values, the plaintext branch stays
    // unreachable.
    const isRedacted = raw.redacted !== undefined && raw.redacted !== null;
    const detail = isRedacted
      ? `update value ${str(raw.redacted)}`
      : `update value ('${str(raw.sourceValue)}' -> '${str(raw.targetValue)}')`;
    steps.push({
      operation: "setDefaultSetting",
      subject: sdsSubject(raw),
      detail,
    });
  }
  for (const raw of records(domain?.onlyInTarget)) {
    warnings.push({ domain: "defaultSettings", subject: sdsSubject(raw), detail: WARNING_DETAIL });
  }

  return { steps, warnings };
}

function buildWebappsSteps(domain: Record<string, unknown> | undefined): DomainBuildResult {
  const steps: RawStep[] = [];
  const warnings: PlanWarning[] = [];

  for (const name of arr<string>(domain?.onlyInSource)) {
    steps.push({
      operation: "modifyWebApp",
      subject: str(name),
      detail: "create web application (exists on source only)",
    });
  }
  for (const raw of records(domain?.differs)) {
    steps.push({
      operation: "modifyWebApp",
      subject: str(raw.name),
      detail: "update web application properties (source differs from target)",
    });
  }
  for (const name of arr<string>(domain?.onlyInTarget)) {
    warnings.push({ domain: "webapps", subject: str(name), detail: WARNING_DETAIL });
  }

  return { steps, warnings };
}

function buildConfigSteps(domain: Record<string, unknown> | undefined): DomainBuildResult {
  const steps: RawStep[] = [];
  const warnings: PlanWarning[] = [];

  for (const key of arr<string>(domain?.onlyInSource)) {
    steps.push({
      operation: "setConfig",
      subject: str(key),
      detail: "set config property (exists on source only)",
    });
  }
  for (const raw of records(domain?.differs)) {
    steps.push({
      operation: "setConfig",
      subject: str(raw.key),
      detail: `set config property ('${str(raw.sourceValue)}' -> '${str(raw.targetValue)}')`,
    });
  }
  for (const key of arr<string>(domain?.onlyInTarget)) {
    warnings.push({ domain: "config", subject: str(key), detail: WARNING_DETAIL });
  }

  return { steps, warnings };
}

const DOMAIN_BUILDERS: Record<
  PromoteDomain,
  (domain: Record<string, unknown> | undefined) => DomainBuildResult
> = {
  mappings: buildMappingsSteps,
  documents: buildDocumentsSteps,
  defaultSettings: buildDefaultSettingsSteps,
  webapps: buildWebappsSteps,
  config: buildConfigSteps,
};

/**
 * Transform a validated `diff` object into the ordered step list + warnings
 * (AC 27.2.1/27.2.2). Domains ABSENT from `diff.domains` (not requested, or
 * an errored domain per Story 27.1's per-domain isolation) contribute NO
 * steps/warnings -- the per-domain builder receives `undefined` and returns
 * empty arrays.
 */
function buildPlan(diff: Record<string, unknown>): { steps: PlanStep[]; warnings: PlanWarning[] } {
  const domains = asRecord(diff.domains) ?? {};
  const steps: PlanStep[] = [];
  const warnings: PlanWarning[] = [];
  let index = 0;

  for (const domainName of PLAN_DOMAIN_ORDER) {
    const builder = DOMAIN_BUILDERS[domainName];
    const built = builder(asRecord(domains[domainName]));

    // Deterministic sub-order within a domain (AC 27.2.1 Task 2): sort by
    // subject, code-unit (locale-independent) so the order is reproducible
    // across environments.
    built.steps.sort(bySubject);
    for (const step of built.steps) {
      index += 1;
      steps.push({
        index,
        domain: domainName,
        operation: step.operation,
        subject: step.subject,
        detail: step.detail,
        direction: "sourceToTarget",
      });
    }

    built.warnings.sort(bySubject);
    warnings.push(...built.warnings);
  }

  return { steps, warnings };
}

// ── plan content hash (AC 27.2.3) ───────────────────────────────────

/** Recursively sort object keys (arrays keep their order -- only object keys are sorted). */
function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (isPlainObject(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeysDeep(value[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Compute a stable content hash of a `diff` object: SHA-256 hex of a
 * canonical, key-sorted JSON serialization -- deterministic regardless of the
 * input's own key order, and sensitive to any value change. Exported so
 * Story 27.3's `execute` can re-derive the SAME hash from the diff it is
 * given and compare against `plan.planHash` (stale-plan protection) without
 * reimplementing the algorithm.
 */
export function computePlanHash(diff: unknown): string {
  const canonical = JSON.stringify(sortKeysDeep(diff));
  return createHash("sha256").update(canonical).digest("hex");
}

// ══════════════════════════════════════════════════════════════════
// execute (Story 27.3) — gates + per-step write dispatch (AC 27.3.1/27.3.2)
// ══════════════════════════════════════════════════════════════════

// ── execute: caller-supplied `plan` parsing ─────────────────────────

/** The complete, closed set of write verbs `buildPlan` can emit (mirrors AC 27.2.1 Task 2). */
const KNOWN_PLAN_OPERATIONS: ReadonlySet<string> = new Set<string>([
  "createMapping",
  "updateMapping",
  "putAndCompile",
  "setDefaultSetting",
  "modifyWebApp",
  "setConfig",
]);

/** A `plan.steps` entry, defensively parsed back out of the caller-supplied `plan` object. */
interface ExecPlanStep {
  index: number;
  domain: PromoteDomain;
  operation: PlanOperation;
  subject: string;
}

/**
 * Defensively parse `plan.steps` (a loosely-typed, caller-supplied array) back
 * into {@link ExecPlanStep} entries. Returns `undefined` on ANY malformed
 * element -- `execute` surfaces that as a clean validation refusal rather than
 * crashing on a corrupted/hand-edited `plan` argument.
 */
function parseExecPlanSteps(raw: unknown): ExecPlanStep[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const parsed: ExecPlanStep[] = [];
  for (const entry of raw) {
    if (!isPlainObject(entry)) return undefined;
    const { index, domain, operation, subject } = entry;
    if (typeof index !== "number" || !Number.isInteger(index) || index <= 0) return undefined;
    if (typeof domain !== "string" || !(PLAN_DOMAIN_ORDER as readonly string[]).includes(domain)) {
      return undefined;
    }
    if (typeof operation !== "string" || !KNOWN_PLAN_OPERATIONS.has(operation)) return undefined;
    if (typeof subject !== "string" || subject.length === 0) return undefined;
    parsed.push({
      index,
      domain: domain as PromoteDomain,
      operation: operation as PlanOperation,
      subject,
    });
  }
  return parsed;
}

/** A parsed, validated `plan` argument -- the minimum shape `execute`'s gates need. */
interface ExecPlan {
  planHash: string;
  steps: ExecPlanStep[];
}

/** Returns the parsed {@link ExecPlan}, or an error message string if `plan` is missing/malformed. */
function parseExecPlanArg(plan: unknown): ExecPlan | string {
  if (!isPlainObject(plan)) {
    return "'plan' must be a JSON object -- pass the structuredContent from a prior iris_env_promote 'plan' call.";
  }
  if (typeof plan.planHash !== "string" || plan.planHash.length === 0) {
    return "'plan' is missing a 'planHash' string -- pass the structuredContent from a prior iris_env_promote 'plan' call.";
  }
  const steps = parseExecPlanSteps(plan.steps);
  if (!steps) {
    return "'plan' is missing a valid 'steps' array -- pass the structuredContent from a prior iris_env_promote 'plan' call.";
  }
  return { planHash: plan.planHash, steps };
}

// ── execute: Gate 4 (target-profile governance) ─────────────────────

/**
 * Local write-family classification (Gate 4). Mirrors the real per-action
 * classification at `packages/iris-interop-mcp/src/tools/defaultSettings.ts`
 * (`mutates.set: "write"`) for the ONE post-foundation key -- it is NOT in
 * `GOVERNANCE_BASELINE`, so `defaultSeed`'s baseline short-circuit can't
 * classify it and this local map must supply it. The other 5 keys are
 * ALREADY frozen-baseline members (classified in
 * `BASELINE_ACTION_CLASSIFICATIONS`) -- listed here too for
 * self-documentation of the exact write-family this gate protects.
 */
const EXECUTE_WRITE_FAMILY: MutatesLookup = new Map<string, "read" | "write">([
  ["iris_doc_put", "write"],
  ["iris_doc_compile", "write"],
  ["iris_mapping_manage:create", "write"],
  ["iris_webapp_manage:modify", "write"],
  ["iris_config_manage:set", "write"],
  ["iris_default_settings_manage:set", "write"],
]);

/** The governance key(s) whose EFFECTIVE policy on the target profile gate one plan operation (Gate 4). */
function writeFamilyKeysForOperation(operation: PlanOperation): string[] {
  switch (operation) {
    case "createMapping":
      return ["iris_mapping_manage:create"];
    case "updateMapping":
      // delete + create (Config.cls has no update) -- BOTH must be enabled.
      return ["iris_mapping_manage:delete", "iris_mapping_manage:create"];
    case "putAndCompile":
      return ["iris_doc_put", "iris_doc_compile"];
    case "setDefaultSetting":
      return ["iris_default_settings_manage:set"];
    case "modifyWebApp":
      return ["iris_webapp_manage:modify"];
    case "setConfig":
      return ["iris_config_manage:set"];
  }
}

// ── execute: subject parsing (mappings / defaultSettings) ───────────

/**
 * Parse a mappings `type::name` subject (env-diff.ts `mappingKey`, cycle-2
 * HIGH fix, 2026-07-11: the key no longer embeds a per-side `namespace`
 * segment -- it never did carry identity, only which side happened to
 * resolve it). Writes always target the freshly-resolved TARGET namespace at
 * execute time, resolved independently of anything embedded in the subject.
 */
function parseMappingSubject(subject: string): { type: string; name: string } | undefined {
  const sep = subject.indexOf("::");
  if (sep === -1) return undefined;
  const type = subject.slice(0, sep);
  const name = subject.slice(sep + 2);
  if (type.length === 0 || name.length === 0) return undefined;
  return { type, name };
}

/** Parse a defaultSettings `production||item||hostClass||setting` subject (Rule #29 delimiter). */
function parseSdsSubject(
  subject: string,
): { production: string; item: string; hostClass: string; setting: string } | undefined {
  const parts = subject.split("||");
  if (parts.length !== 4) return undefined;
  const [production, item, hostClass, setting] = parts as [string, string, string, string];
  return { production, item, hostClass, setting };
}

// ── execute: per-domain write dispatch (AC 27.3.1) ───────────────────

/** Build the `POST /config/mapping/{type}` create body from a re-fetched source entry. */
function mappingCreateBody(targetNs: string, name: string, entry: MappingEntry): Record<string, unknown> {
  const body: Record<string, unknown> = {
    action: "create",
    namespace: targetNs,
    name,
    database: entry.database,
  };
  if (entry.collation !== undefined) body.collation = entry.collation;
  if (entry.lockDatabase !== undefined) body.lockDatabase = entry.lockDatabase;
  return body;
}

async function dispatchCreateMapping(
  step: ExecPlanStep,
  sourceClient: IrisHttpClient,
  targetClient: IrisHttpClient,
  srcNs: string,
  targetNs: string,
): Promise<void> {
  const parsed = parseMappingSubject(step.subject);
  if (!parsed) throw new Error(`Malformed mapping subject '${step.subject}'.`);
  const { type, name } = parsed;
  const sourceMappings = await fetchMappings(sourceClient, srcNs);
  // Cycle-2 HIGH fix (2026-07-11): fetchMappings/mappingKey key by `(type,
  // name)` only now -- srcNs must NOT be interpolated into the lookup key.
  const entry: MappingEntry | undefined = sourceMappings.get(`${type}::${name}`);
  if (!entry) {
    throw new Error(
      `Mapping '${name}' (type '${type}') not found on source profile in namespace '${srcNs}' -- ` +
        "it may have changed since the plan was generated.",
    );
  }
  await targetClient.post(`${BASE_URL}/config/mapping/${type}`, mappingCreateBody(targetNs, name, entry));
}

async function dispatchUpdateMapping(
  step: ExecPlanStep,
  sourceClient: IrisHttpClient,
  targetClient: IrisHttpClient,
  srcNs: string,
  targetNs: string,
): Promise<void> {
  const parsed = parseMappingSubject(step.subject);
  if (!parsed) throw new Error(`Malformed mapping subject '${step.subject}'.`);
  const { type, name } = parsed;
  const sourceMappings = await fetchMappings(sourceClient, srcNs);
  // Cycle-2 HIGH fix (2026-07-11): fetchMappings/mappingKey key by `(type,
  // name)` only now -- srcNs must NOT be interpolated into the lookup key.
  const entry: MappingEntry | undefined = sourceMappings.get(`${type}::${name}`);
  if (!entry) {
    throw new Error(
      `Mapping '${name}' (type '${type}') not found on source profile in namespace '${srcNs}' -- ` +
        "it may have changed since the plan was generated.",
    );
  }
  // Config.cls has no update -- delete then create (mirrors iris_mapping_manage's
  // documented behavior). This is a REPLACE of a mapping the source ALSO has --
  // never a removal of a target-only item (no delete/remove ever targets an
  // `onlyInTarget` entry -- those are warnings only, never steps).
  await targetClient.post(`${BASE_URL}/config/mapping/${type}`, {
    action: "delete",
    namespace: targetNs,
    name,
  });
  await targetClient.post(`${BASE_URL}/config/mapping/${type}`, mappingCreateBody(targetNs, name, entry));
}

/**
 * Redact `value` from an error `message` before it can surface in a per-step
 * `error` (which IS rendered in this tool's output). `IrisApiError.message` is
 * built from IRIS's RESPONSE text, not the request body, but a validation error
 * could echo the submitted value -- so a re-fetched credential System Default
 * Settings value must be scrubbed from any error on the write path (Rule #9;
 * defends the story's "a credential value never appears in this tool's output"
 * invariant on the FAILURE path, not just success). The min-length gate avoids
 * corrupting a message that merely contains a SHORT value as an incidental
 * substring; real credential values (tokens/passwords) clear it comfortably.
 * Literal (non-regex) replace via split/join.
 */
function scrubValueFromError(message: string, value: unknown): string {
  if (typeof value !== "string" || value.length < 6) return message;
  return message.split(value).join("[REDACTED]");
}

async function dispatchSetDefaultSetting(
  step: ExecPlanStep,
  sourceClient: IrisHttpClient,
  targetClient: IrisHttpClient,
  srcNs: string,
  targetNs: string,
): Promise<void> {
  const parsed = parseSdsSubject(step.subject);
  if (!parsed) throw new Error(`Malformed defaultSettings subject '${step.subject}'.`);
  const { production, item, hostClass, setting } = parsed;
  const sourceSettings = await fetchDefaultSettings(sourceClient, srcNs);
  const entry: SdsEntry | undefined = sourceSettings.get(`${production}||${item}||${hostClass}||${setting}`);
  if (!entry) {
    throw new Error(
      `Default setting '${production}/${item}/${hostClass}/${setting}' not found on source profile ` +
        `in namespace '${srcNs}' -- it may have changed since the plan was generated.`,
    );
  }
  // The re-fetched value (possibly a credential) is forwarded to the write
  // body ONLY -- it is never assigned anywhere `executed`/rendering reads.
  const body: Record<string, unknown> = {
    action: "set",
    namespace: targetNs,
    production,
    item,
    hostClass,
    setting,
    value: entry.value,
  };
  if (entry.description !== undefined) body.description = entry.description;
  if (entry.deployable !== undefined) body.deployable = entry.deployable;
  try {
    await targetClient.post(`${BASE_URL}/interop/defaultsettings`, body);
  } catch (error: unknown) {
    // Scrub the just-written (possibly credential) value from ANY error before
    // it propagates to the per-step `error` field (Rule #9) -- the success path
    // never renders the value, and the failure path must not either.
    throw new Error(scrubValueFromError(error instanceof Error ? error.message : String(error), entry.value));
  }
}

async function dispatchModifyWebApp(
  step: ExecPlanStep,
  sourceClient: IrisHttpClient,
  targetClient: IrisHttpClient,
): Promise<void> {
  const name = step.subject;
  const sourceWebapps = await fetchWebapps(sourceClient);
  const entry: WebAppEntry | undefined = sourceWebapps.get(name);
  if (!entry) {
    throw new Error(
      `Web application '${name}' not found on source profile -- it may have changed since the plan was generated.`,
    );
  }
  // The curated subset from Story 27.1 -- do NOT push cookiePath/resource
  // (instance-specific paths, excluded from the compared value subset).
  const body: Record<string, unknown> = {
    action: "modify",
    name,
    dispatchClass: entry.dispatchClass,
    enabled: entry.enabled ? 1 : 0,
    authEnabled: entry.authEnabled,
    isNameSpaceDefault: entry.isNameSpaceDefault ? 1 : 0,
    cspZenEnabled: entry.cspZenEnabled ? 1 : 0,
    recurse: entry.recurse ? 1 : 0,
    matchRoles: entry.matchRoles,
    namespace: entry.namespace,
  };
  await targetClient.post(`${BASE_URL}/security/webapp`, body);
}

async function dispatchSetConfig(
  step: ExecPlanStep,
  sourceClient: IrisHttpClient,
  targetClient: IrisHttpClient,
): Promise<void> {
  const key = step.subject;
  const sourceConfig: ConfigProperties = await fetchConfig(sourceClient);
  if (!Object.prototype.hasOwnProperty.call(sourceConfig, key)) {
    throw new Error(
      `Config property '${key}' not found on source profile -- it may have changed since the plan was generated.`,
    );
  }
  const value = (sourceConfig as unknown as Record<string, unknown>)[key];
  await targetClient.post(`${BASE_URL}/system/config`, {
    action: "set",
    section: "config",
    properties: { [key]: value },
  });
}

/** Dispatch one NON-document step (documents are handled separately, batched -- see {@link runDocumentsBatch}). */
async function dispatchSingleStep(
  step: ExecPlanStep,
  sourceClient: IrisHttpClient,
  targetClient: IrisHttpClient,
  srcNs: string,
  targetNs: string,
): Promise<void> {
  switch (step.operation) {
    case "createMapping":
      return dispatchCreateMapping(step, sourceClient, targetClient, srcNs, targetNs);
    case "updateMapping":
      return dispatchUpdateMapping(step, sourceClient, targetClient, srcNs, targetNs);
    case "setDefaultSetting":
      return dispatchSetDefaultSetting(step, sourceClient, targetClient, srcNs, targetNs);
    case "modifyWebApp":
      return dispatchModifyWebApp(step, sourceClient, targetClient);
    case "setConfig":
      return dispatchSetConfig(step, sourceClient, targetClient);
    case "putAndCompile":
      // Never reached -- the caller routes contiguous `putAndCompile` runs to
      // runDocumentsBatch instead. Surfacing a throw (rather than silently
      // no-op'ing) would catch a future routing regression loudly.
      throw new Error(`Internal error: 'putAndCompile' step ${step.index} reached dispatchSingleStep.`);
  }
}

// ── execute: documents batch (put sequential, compile ONE batched call) ──

/** One finalized per-step execution result (AC 27.3.1). */
interface ExecutedStep {
  index: number;
  domain: PromoteDomain;
  operation: PlanOperation;
  subject: string;
  status: "completed" | "failed" | "skipped";
  error?: string;
}

function stepMeta(step: ExecPlanStep): Pick<ExecutedStep, "index" | "domain" | "operation" | "subject"> {
  return { index: step.index, domain: step.domain, operation: step.operation, subject: step.subject };
}
function completedEntry(step: ExecPlanStep): ExecutedStep {
  return { ...stepMeta(step), status: "completed" };
}
function skippedEntry(step: ExecPlanStep): ExecutedStep {
  return { ...stepMeta(step), status: "skipped" };
}
function failedEntry(step: ExecPlanStep, error: string): ExecutedStep {
  return { ...stepMeta(step), status: "failed", error };
}

/** Shape of one Atelier `action/compile` per-document result entry (mirrors compile.ts). */
interface CompileDocResult {
  name: string;
  errors?: Array<{ error: string }>;
}

/**
 * Execute a CONTIGUOUS run of allowlisted `putAndCompile` steps: GET (source)
 * + PUT (target) each doc SEQUENTIALLY, halting immediately on the first
 * put/get failure (no compile is attempted for a batch with any failure --
 * halt-on-first-error means no further writes at all, and compile is a
 * write); then, if every put succeeded, ONE batched `POST /action/compile`
 * for the whole batch (mirrors `load.ts:286,309`). Docs that succeeded their
 * PUT but never got compiled (because a LATER doc's put failed first) are
 * reported "skipped" -- their write is incomplete without compilation, so
 * "completed" would misrepresent the outcome.
 *
 * Pushes a finalized {@link ExecutedStep} for EVERY step in `batch`, in
 * INDEX order, and returns whether the batch ended in a failure (halting
 * subsequent steps/domains in the caller's loop).
 */
async function runDocumentsBatch(
  batch: ExecPlanStep[],
  executed: ExecutedStep[],
  sourceClient: IrisHttpClient,
  targetClient: IrisHttpClient,
  srcNs: string,
  targetNs: string,
  sourceAtelierVersion: number,
  targetAtelierVersion: number,
): Promise<boolean> {
  const putOk: ExecPlanStep[] = [];
  let putFailedAt = -1;
  let putFailedMessage = "";

  for (let idx = 0; idx < batch.length; idx++) {
    const step = batch[idx] as ExecPlanStep;
    try {
      const encodedName = encodeURIComponent(step.subject);
      const getPath = atelierPath(sourceAtelierVersion, srcNs, `doc/${encodedName}`);
      const getResp = await sourceClient.get<{ content?: unknown }>(getPath);
      if (!Array.isArray(getResp.result?.content)) {
        // Fail CLOSED rather than PUT `[]` (which would blank + recompile the
        // target document -- a destructive write the tool must never perform on
        // an anomalous/absent source response). A genuinely-missing source doc
        // already 404s and throws above; this guards the 200-without-content
        // shape (proxy/anomaly), preserving the "never destroy target state"
        // promise.
        throw new Error(
          `Source returned no document content for '${step.subject}' -- refusing to overwrite the ` +
            "target document with empty content.",
        );
      }
      const content = getResp.result.content as string[];
      const putPath = `${atelierPath(targetAtelierVersion, targetNs, `doc/${encodedName}`)}?ignoreConflict=1`;
      await targetClient.put(putPath, { enc: false, content });
      putOk.push(step);
    } catch (error: unknown) {
      putFailedAt = idx;
      putFailedMessage = error instanceof Error ? error.message : String(error);
      break;
    }
  }

  if (putFailedAt !== -1) {
    for (let idx = 0; idx < batch.length; idx++) {
      const step = batch[idx] as ExecPlanStep;
      if (idx < putFailedAt) executed.push(skippedEntry(step));
      else if (idx === putFailedAt) executed.push(failedEntry(step, putFailedMessage));
      else executed.push(skippedEntry(step));
    }
    return true;
  }

  if (putOk.length === 0) {
    return false;
  }

  try {
    const compilePath = `${atelierPath(targetAtelierVersion, targetNs, "action/compile")}?flags=cuk`;
    const compileResp = await targetClient.post<{ content?: CompileDocResult[] }>(
      compilePath,
      putOk.map((s) => s.subject),
    );
    const docResults = compileResp.result?.content ?? [];
    const errorsByName = new Map<string, string>();
    for (const docResult of docResults) {
      if (docResult.errors && docResult.errors.length > 0) {
        errorsByName.set(docResult.name, docResult.errors.map((e) => e.error).join("; "));
      }
    }
    let sawFailure = false;
    for (const step of putOk) {
      if (sawFailure) {
        executed.push(skippedEntry(step));
        continue;
      }
      const err = errorsByName.get(step.subject);
      if (err) {
        executed.push(failedEntry(step, `compile error: ${err}`));
        sawFailure = true;
      } else {
        executed.push(completedEntry(step));
      }
    }
    return sawFailure;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const [first, ...rest] = putOk;
    if (first) executed.push(failedEntry(first, message));
    for (const step of rest) executed.push(skippedEntry(step));
    return true;
  }
}

// ── execute: rendering ────────────────────────────────────────────────

function renderExecuteResult(result: {
  source: ProfileRef;
  target: ProfileRef;
  planHash: string;
  executed: ExecutedStep[];
  summary: { completed: number; failed: number; skipped: number };
}): string {
  const lines: string[] = [
    `Promotion execute: source='${result.source.profile}' (${result.source.namespace}) -> ` +
      `target='${result.target.profile}' (${result.target.namespace})`,
    `Plan hash: ${result.planHash}`,
    "",
    `Executed steps (${result.executed.length}):`,
  ];
  if (result.executed.length === 0) {
    lines.push("  (none)");
  } else {
    for (const e of result.executed) {
      const suffix = e.error ? ` -- ${e.error}` : "";
      lines.push(`  ${e.index}. [${e.domain}] ${e.operation} ${e.subject} -- ${e.status.toUpperCase()}${suffix}`);
    }
  }
  lines.push("");
  lines.push(
    `Summary: ${result.summary.completed} completed, ${result.summary.failed} failed, ` +
      `${result.summary.skipped} skipped. No item that exists only on the target was ever removed.`,
  );
  return lines.join("\n");
}

// ── execute: gates + orchestration (AC 27.3.1/27.3.2) ────────────────

interface ExecuteInput {
  source: string;
  target: string;
  diff?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  steps?: number[];
  confirm?: boolean;
  namespace?: string;
}

/**
 * `execute` -- run an ALLOWLISTED subset of a prior `plan`'s steps against
 * `target`, behind the four refuse-before-any-write gates (AC 27.3.2), then
 * dispatch each allowlisted step in plan order with halt-on-first-error (AC
 * 27.3.1). See the module doc comment and Story 27.3 Dev Notes for the full
 * design rationale.
 */
async function executeAction(input: ExecuteInput, ctx: ToolContext): Promise<ToolResult> {
  // Gate 1 -- confirm:true required (Epic 20 double-gate pattern: the
  // governance default-disable is the OUTER gate; confirm is the INNER
  // intent gate).
  if (input.confirm !== true) {
    return validationError("Gate 1 (confirm): 'confirm' must be true to execute. No changes were made.");
  }

  // 'plan' is required and must be shaped like a genuine prior 'plan' output
  // -- a prerequisite for Gates 2-4 below.
  if (input.plan === undefined) {
    return validationError(
      "'plan' is required for action 'execute' (pass the structuredContent from a prior " +
        "iris_env_promote 'plan' call). No changes were made.",
    );
  }
  const parsedPlan = parseExecPlanArg(input.plan);
  if (typeof parsedPlan === "string") {
    return validationError(`${parsedPlan} No changes were made.`);
  }

  // Gate 2 -- steps allowlist required + non-empty + in-range.
  if (!Array.isArray(input.steps) || input.steps.length === 0) {
    return validationError(
      "Gate 2 (steps allowlist): 'steps' (a non-empty array of plan step indices) is required " +
        "for action 'execute'. No changes were made.",
    );
  }
  const planIndices = new Set(parsedPlan.steps.map((s) => s.index));
  const outOfRange = input.steps.filter((i) => !planIndices.has(i));
  if (outOfRange.length > 0) {
    return validationError(
      "Gate 2 (steps allowlist): 'steps' contains index/indices not present in 'plan.steps': " +
        `${outOfRange.join(", ")}. No changes were made.`,
    );
  }

  // Gate 3 -- plan-hash freshness (stale-plan protection). 'diff' is
  // REQUIRED for 'execute' too -- the SAME diff that produced 'plan' -- so
  // the tool can re-derive the hash and detect a plan generated from data
  // that has since changed.
  if (input.diff === undefined) {
    return validationError(
      "Gate 3 (plan-hash freshness): 'diff' is required for action 'execute' too -- pass the SAME " +
        "'diff' that produced 'plan' so the plan's freshness can be verified. No changes were made.",
    );
  }
  const diffShapeError = validateDiffShape(input.diff);
  if (diffShapeError) {
    return validationError(`${diffShapeError} No changes were made.`);
  }
  const recomputedHash = computePlanHash(input.diff);
  if (recomputedHash !== parsedPlan.planHash) {
    return validationError(
      "Gate 3 (plan-hash freshness): stale plan -- regenerate the plan from the current diff " +
        "('diff' no longer matches 'plan.planHash'). No changes were made.",
    );
  }

  // Gate 3b -- plan/diff STEP consistency. The hash proves 'diff' is the one
  // that produced 'plan', but NOT (on its own) that 'plan.steps' were derived
  // from 'diff' -- both are caller-supplied, so a hand-edited plan could keep a
  // valid diff+hash yet carry steps whose subjects point at source items
  // OUTSIDE the reviewed diff. Re-derive the authoritative steps from 'diff'
  // and require the supplied plan's steps to match them exactly (identity
  // fields + order). A no-op for a genuine caller (whose 'plan' IS
  // buildPlan('diff')); a hard refuse-before-any-write for a tampered/reordered
  // one. Pure transform -- no IRIS connection, mutates nothing.
  const authoritativeSteps = buildPlan(input.diff).steps;
  const stepsMatchDiff =
    authoritativeSteps.length === parsedPlan.steps.length &&
    authoritativeSteps.every((a, i) => {
      const p = parsedPlan.steps[i];
      return (
        p !== undefined &&
        p.index === a.index &&
        p.domain === a.domain &&
        p.operation === a.operation &&
        p.subject === a.subject
      );
    });
  if (!stepsMatchDiff) {
    return validationError(
      "Gate 3 (plan/diff consistency): 'plan.steps' do not match the steps derived from 'diff' -- " +
        "the plan appears hand-edited or was generated from a different diff. Regenerate the plan from " +
        "the current diff. No changes were made.",
    );
  }

  // Gate 3c -- diff/profile match (wrong-instance write guard, CR 27.2-2 routed
  // to 27.3). 'execute' WRITES to 'target', so a diff/plan produced for a
  // DIFFERENT source->target pair must never be applied to the wrong instance
  // (e.g. a diff reviewed as dev->staging executed against dev->PROD). Only
  // enforced when the diff carries a profile ref (a genuine iris_env_diff result
  // always does) -- a POSITIVE mismatch refuses; a missing ref does not.
  const diffSourceProfile = str(asRecord(input.diff.source)?.profile);
  const diffTargetProfile = str(asRecord(input.diff.target)?.profile);
  if (diffSourceProfile.length > 0 && diffSourceProfile !== input.source) {
    return validationError(
      `Gate 3 (diff/profile match): 'diff' was generated for source '${diffSourceProfile}', but 'source' ` +
        `is '${input.source}'. Regenerate the diff/plan for the intended source. No changes were made.`,
    );
  }
  if (diffTargetProfile.length > 0 && diffTargetProfile !== input.target) {
    return validationError(
      `Gate 3 (diff/profile match): 'diff' was generated for target '${diffTargetProfile}', but 'target' ` +
        `is '${input.target}'. Refusing to execute a plan against a DIFFERENT target than it was reviewed ` +
        "for. Regenerate the diff/plan for the intended target. No changes were made.",
    );
  }

  // Steps filtered to the allowlist, preserving plan order (parsedPlan.steps
  // already mirrors the original plan's ordered array).
  const allowedIndices = new Set(input.steps);
  const orderedAllowed = parsedPlan.steps.filter((s) => allowedIndices.has(s.index));

  // Gate 4 -- TARGET-PROFILE governance. Pure env reads + the shared
  // governance engine -- NO IRIS connection is made for this gate, so a
  // denial here mutates nothing and costs no network round-trip.
  const governanceConfig = parseGovernanceConfig();
  const preset = parseGovernancePreset();
  const checkedKeys = new Set<string>();
  for (const step of orderedAllowed) {
    for (const key of writeFamilyKeysForOperation(step.operation)) {
      if (checkedKeys.has(key)) continue;
      checkedKeys.add(key);
      const enabled = effective(
        key,
        input.target,
        governanceConfig,
        EXECUTE_WRITE_FAMILY,
        GOVERNANCE_BASELINE,
        new Set<string>(),
        preset,
        BASELINE_ACTION_CLASSIFICATIONS,
      );
      if (!enabled) {
        return validationError(
          `Gate 4 (target-profile governance): target profile '${input.target}' governance disables ` +
            `${key} -- execution refused. No changes were made.`,
        );
      }
    }
  }

  // All 4 gates passed -- NOW resolve both profile clients and dispatch.
  let sourceClient: IrisHttpClient;
  let targetClient: IrisHttpClient;
  try {
    [sourceClient, targetClient] = await Promise.all([
      ctx.resolveProfileClient(input.source),
      ctx.resolveProfileClient(input.target),
    ]);
  } catch (error: unknown) {
    if (error instanceof ProfileResolutionError) {
      return validationError(error.message);
    }
    if (error instanceof IrisApiError) {
      return validationError(
        `Error resolving profiles (source='${input.source}', target='${input.target}'): ${error.message}`,
      );
    }
    throw error;
  }

  const namespaceOverride = input.namespace?.trim() || undefined;
  const srcNs = namespaceOverride ?? sourceClient.namespace;
  const targetNs = namespaceOverride ?? targetClient.namespace;

  const executed: ExecutedStep[] = [];
  let halted = false;
  let sourceAtelierVersion: number | undefined;
  let targetAtelierVersion: number | undefined;

  let i = 0;
  while (i < orderedAllowed.length) {
    const step = orderedAllowed[i] as ExecPlanStep;

    if (halted) {
      executed.push(skippedEntry(step));
      i++;
      continue;
    }

    if (step.operation === "putAndCompile") {
      // Collect the CONTIGUOUS run of putAndCompile steps starting here (the
      // plan is domain-grouped, so allowlisted `documents` steps are always
      // contiguous within the allowed/ordered list).
      const batch: ExecPlanStep[] = [];
      while (i < orderedAllowed.length && (orderedAllowed[i] as ExecPlanStep).operation === "putAndCompile") {
        batch.push(orderedAllowed[i] as ExecPlanStep);
        i++;
      }
      if (sourceAtelierVersion === undefined) sourceAtelierVersion = await negotiateVersion(sourceClient);
      if (targetAtelierVersion === undefined) targetAtelierVersion = await negotiateVersion(targetClient);
      const batchHalted = await runDocumentsBatch(
        batch,
        executed,
        sourceClient,
        targetClient,
        srcNs,
        targetNs,
        sourceAtelierVersion,
        targetAtelierVersion,
      );
      if (batchHalted) halted = true;
      continue;
    }

    try {
      await dispatchSingleStep(step, sourceClient, targetClient, srcNs, targetNs);
      executed.push(completedEntry(step));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      executed.push(failedEntry(step, message));
      halted = true;
    }
    i++;
  }

  const summary = {
    completed: executed.filter((e) => e.status === "completed").length,
    failed: executed.filter((e) => e.status === "failed").length,
    skipped: executed.filter((e) => e.status === "skipped").length,
  };

  const result = {
    source: { profile: input.source, namespace: srcNs },
    target: { profile: input.target, namespace: targetNs },
    planHash: parsedPlan.planHash,
    executed,
    summary,
  };

  return {
    content: [{ type: "text" as const, text: renderExecuteResult(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
    ...(summary.failed > 0 ? { isError: true } : {}),
  };
}

// ── diff shape validation ───────────────────────────────────────────

/** Returns an error message if `diff` doesn't look like a genuine `iris_env_diff` result, else `undefined`. */
function validateDiffShape(diff: unknown): string | undefined {
  if (!isPlainObject(diff)) {
    return "'diff' must be a JSON object -- pass the structuredContent from a prior iris_env_diff call.";
  }
  if (!isPlainObject(diff.domains)) {
    return "'diff' is missing a 'domains' object -- pass the structuredContent from a prior iris_env_diff call.";
  }
  if (!isPlainObject(diff.source) || !isPlainObject(diff.target)) {
    return "'diff' is missing 'source'/'target' profile references -- pass the structuredContent from a prior iris_env_diff call.";
  }
  return undefined;
}

// ── rendering ────────────────────────────────────────────────────────

function renderPlan(result: PlanResult, skippedDomains: string[]): string {
  const lines: string[] = [
    `Promotion plan: source='${result.source.profile}' (${result.source.namespace}) -> ` +
      `target='${result.target.profile}' (${result.target.namespace})`,
    `Plan hash: ${result.planHash}`,
  ];
  if (skippedDomains.length > 0) {
    lines.push(
      `Skipped domain(s) (the diff reported an error for these -- not planned): ${skippedDomains.join(", ")}`,
    );
  }
  lines.push("");
  lines.push(
    `Steps (${result.steps.length}, ordered mappings -> documents -> defaultSettings -> ` +
      "webapps -> config, direction sourceToTarget):",
  );
  if (result.steps.length === 0) {
    lines.push("  (none)");
  } else {
    for (const step of result.steps) {
      lines.push(`  ${step.index}. [${step.domain}] ${step.operation} ${step.subject} -- ${step.detail}`);
    }
  }
  lines.push("");
  lines.push(
    `Warnings (${result.warnings.length}, items that exist on the TARGET only -- ` +
      "NEVER promoted, NEVER deleted):",
  );
  if (result.warnings.length === 0) {
    lines.push("  (none)");
  } else {
    for (const warning of result.warnings) {
      lines.push(`  [${warning.domain}] ${warning.subject} -- ${warning.detail}`);
    }
  }
  lines.push("");
  lines.push(
    `Summary: ${result.summary.stepCount} step(s), ${result.summary.warningCount} warning(s). ` +
      "No delete/remove operation exists in this or any plan.",
  );
  return lines.join("\n");
}

function validationError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

// ── iris_env_promote ─────────────────────────────────────────────────

export const envPromoteTool: ToolDefinition = {
  name: "iris_env_promote",
  title: "Promote Environment Changes (Plan / Execute)",
  description:
    "Turn a prior iris_env_diff result into an ordered, reviewable promotion PLAN " +
    "(source -> target), or EXECUTE an allowlisted subset of that plan against " +
    "'target'. Actions:\n\n" +
    "- **plan** (read, enabled by default): a PURE TRANSFORM of a prior " +
    "iris_env_diff 'structuredContent' result -- pass it as 'diff'. No IRIS " +
    "connection is made; the result is deterministic and idempotent given the " +
    "same diff. Steps are grouped by domain in DEPENDENCY ORDER: mappings -> " +
    "documents (put+compile, batched) -> defaultSettings -> webapps -> config; " +
    "within a domain, steps are ordered by subject. Each step is " +
    "{index, domain, operation, subject, detail, direction:'sourceToTarget'}. " +
    "Every 'onlyInTarget' item from the diff (something exists on the target " +
    "only) is emitted as a WARNING, never a step -- NO delete/remove operation " +
    "exists anywhere in any plan, in this or any future version. A credential-" +
    "redacted value from the diff (e.g. '[REDACTED:differs]') survives into the " +
    "plan's 'detail' text unchanged -- the plaintext never appears in plan " +
    "output. The plan embeds a 'planHash' (SHA-256 of the source diff, " +
    "canonical/key-sorted JSON) that 'execute' uses to detect and refuse a " +
    "stale plan (one generated from a diff that has since changed).\n" +
    "- **execute** (write, DEFAULT-DISABLED): run ONLY the allowlisted 'steps' " +
    "indices from 'plan', IN PLAN ORDER, against 'target' -- behind FOUR " +
    "refuse-before-any-write gates, each mutating NOTHING on failure: " +
    "(1) 'confirm' must be true; (2) 'steps' must be a non-empty array whose " +
    "every index exists in 'plan.steps' (out-of-range indices are refused); " +
    "(3) plan-hash freshness -- pass the SAME 'diff' that produced 'plan'; if " +
    "it no longer hashes to 'plan.planHash' the plan is STALE and execution is " +
    "refused (regenerate the plan first); (4) the TARGET profile's OWN " +
    "governance policy must enable every write family used by the allowlisted " +
    "steps (e.g. iris_config_manage:set, iris_doc_put/iris_doc_compile, " +
    "iris_mapping_manage:create[/:delete for an update], " +
    "iris_default_settings_manage:set, iris_webapp_manage:modify) -- a " +
    "disabled key refuses execution NAMING that key, which is what stops a " +
    "caller on an unrestricted profile from writing into a governance-locked " +
    "target. Once all four gates pass, steps run IN PLAN ORDER and HALT ON " +
    "THE FIRST FAILURE: that step is 'failed', every step after it is " +
    "'skipped' (never attempted), every step before it is 'completed' -- a " +
    "partial apply is always reported, never hidden (per-step " +
    "{index,domain,operation,subject,status,error?} in the 'executed' array). " +
    "EVERY write RE-FETCHES the CURRENT value from 'source' live at execute " +
    "time (the plan carries no write data -- it is a spec, not a data " +
    "snapshot); a credential System Default Settings value is re-fetched live " +
    "and forwarded to 'target' WITHOUT ever appearing in this tool's output. " +
    "'documents' steps are PUT sequentially (source -> target) then COMPILED " +
    "in ONE batched call. 'execute' NEVER deletes a target-only item in any " +
    "version -- the ONLY delete it ever issues is the intra-'updateMapping' " +
    "delete+create REPLACE of a mapping 'source' also has.\n\n" +
    "GOVERNANCE -- 'execute' is a default-disabled write (a real environment-" +
    "mutating action, NOT a recovery-of-last-resort like " +
    "iris_production_control:clean). Enable via IRIS_GOVERNANCE, e.g.:\n" +
    '{"global": {"iris_env_promote:execute": true}}\n\n' +
    "SAFETY -- direction is always sourceToTarget (promote source's state onto " +
    "target); nothing on the target is EVER deleted by this tool, in any " +
    "action, in any version.",
  inputSchema: z.object({
    action: z
      .enum(["plan", "execute"])
      .describe("Action to perform: 'plan' (read) or 'execute' (write, default-disabled; behind 4 gates -- see description)."),
    source: z
      .string()
      .min(1)
      .describe(
        "Source profile name -- should match the 'source' used to produce 'diff' (from a prior iris_env_diff call). " +
          "'execute' re-fetches the CURRENT value from this profile live, for every allowlisted step.",
      ),
    target: z
      .string()
      .min(1)
      .describe(
        "Target profile name -- should match the 'target' used to produce 'diff'. 'execute' writes ONLY to this " +
          "profile, and Gate 4 evaluates governance against THIS profile's policy.",
      ),
    diff: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "A prior iris_env_diff 'structuredContent' result. REQUIRED for BOTH actions: for 'plan' it is transformed " +
          "into steps; for 'execute' it is RE-HASHED and compared against 'plan.planHash' (Gate 3, stale-plan " +
          "protection) -- pass the SAME 'diff' that produced 'plan'.",
      ),
    plan: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "Required for action 'execute': a prior 'plan' action's structuredContent result. Its 'planHash' is " +
          "verified (Gate 3) against a fresh hash of 'diff' before any step runs, and its 'steps' array is the " +
          "allowlist-checked, ordered source of truth for what 'steps' may reference.",
      ),
    steps: z
      .array(z.number().int().positive())
      .optional()
      .describe(
        "Required for action 'execute' (Gate 2): a non-empty allowlist of 1-based 'plan.steps' indices to run. " +
          "Every index must exist in 'plan.steps' or execution is refused naming the out-of-range index/indices.",
      ),
    confirm: z
      .boolean()
      .optional()
      .describe(
        "Required (must be true) for action 'execute' (Gate 1) -- the inner intent gate, on top of the outer " +
          "governance default-disable that already gates the whole 'execute' action.",
      ),
    namespace: z
      .string()
      .optional()
      .describe(
        "Namespace override applied to BOTH 'source' and 'target' resolution for 'execute' writes (mirrors " +
          "iris_env_diff's 'namespace' convention). Omit to use each profile's own configured default namespace " +
          "independently. Not used by 'plan' (namespaces come from the diff/plan content instead).",
      ),
  }),
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false,
  },
  scope: "NONE",
  // Governance (Rules #28/#32): both action keys are NEW/post-foundation
  // (absent from the frozen governance-baseline.ts) -- both MUST be
  // classified. `execute` is truthfully "write" and deliberately does NOT
  // use `defaultEnabled` -- promotion is a real environment-mutating write,
  // not a recovery-of-last-resort action.
  mutates: {
    plan: "read",
    execute: "write",
  },
  handler: async (args, ctx) => {
    const input = args as {
      action: "plan" | "execute";
      source: string;
      target: string;
      diff?: Record<string, unknown>;
      plan?: Record<string, unknown>;
      steps?: number[];
      confirm?: boolean;
      namespace?: string;
    };

    if (input.action === "execute") {
      return executeAction(input, ctx);
    }

    // action === "plan" -- cross-field validation in the handler (not
    // `.refine()`, which breaks MCP JSON-schema emission -- message-resend
    // precedent): `plan` requires `diff`.
    if (input.diff === undefined) {
      return validationError(
        "'diff' is required for action 'plan' (pass the structuredContent from a prior iris_env_diff call).",
      );
    }
    const shapeError = validateDiffShape(input.diff);
    if (shapeError) {
      return validationError(shapeError);
    }

    const diff = input.diff;
    const { steps, warnings } = buildPlan(diff);
    const planHash = computePlanHash(diff);

    const diffSource = diff.source as Record<string, unknown>;
    const diffTarget = diff.target as Record<string, unknown>;
    const source: ProfileRef = {
      profile: str(diffSource.profile) || input.source,
      namespace: str(diffSource.namespace),
    };
    const target: ProfileRef = {
      profile: str(diffTarget.profile) || input.target,
      namespace: str(diffTarget.namespace),
    };

    const errorsObj = asRecord(diff.errors) ?? {};
    const skippedDomains = PLAN_DOMAIN_ORDER.filter((d) => errorsObj[d] !== undefined);

    const result: PlanResult = {
      source,
      target,
      planHash,
      steps,
      warnings,
      summary: { stepCount: steps.length, warningCount: warnings.length },
    };

    return {
      content: [{ type: "text" as const, text: renderPlan(result, skippedDomains) }],
      structuredContent: result as unknown as Record<string, unknown>,
    };
  },
};
