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
import type { ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

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

/** Extract the leading `type` segment from a `type::namespace::name` mapping key (env-diff.ts `mappingKey`). */
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
    const subject = `${type}::${str(raw.namespace)}::${str(raw.name)}`;
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
    "(source -> target), or (Story 27.3) execute an allowlisted subset of that " +
    "plan. Actions:\n\n" +
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
    "canonical/key-sorted JSON) that Story 27.3's 'execute' will use to detect " +
    "and refuse a stale plan (one generated from a diff that has since " +
    "changed).\n" +
    "- **execute** (write, DEFAULT-DISABLED): ships in Story 27.3. Will run " +
    "ONLY allowlisted plan step indices, in plan order, halt-on-first-error, " +
    "after verifying the plan hash still matches the diff. Calling it now " +
    "returns a clear refusal naming Story 27.3.\n\n" +
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
      .describe("Action to perform: 'plan' (read) or 'execute' (write, default-disabled; ships in Story 27.3)."),
    source: z
      .string()
      .min(1)
      .describe(
        "Source profile name -- should match the 'source' used to produce 'diff' (from a prior iris_env_diff call).",
      ),
    target: z
      .string()
      .min(1)
      .describe(
        "Target profile name -- should match the 'target' used to produce 'diff'. 'execute' (Story 27.3) writes ONLY to this profile.",
      ),
    diff: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "A prior iris_env_diff 'structuredContent' result. REQUIRED for action 'plan'. Not used by 'execute' " +
          "(which consumes 'plan' instead, Story 27.3).",
      ),
    plan: z
      .record(z.string(), z.unknown())
      .optional()
      .describe(
        "A prior 'plan' action's structuredContent result. Required for action 'execute' (Story 27.3, not yet implemented).",
      ),
    steps: z
      .array(z.number().int().positive())
      .optional()
      .describe(
        "Allowlist of 1-based plan step indices to execute. Required for action 'execute' (Story 27.3, not yet implemented).",
      ),
    confirm: z
      .boolean()
      .optional()
      .describe("Must be true to execute. Required for action 'execute' (Story 27.3, not yet implemented)."),
    namespace: z
      .string()
      .optional()
      .describe(
        "Namespace override applied to 'execute' writes (Story 27.3, not yet implemented). Not used by 'plan'.",
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
  handler: async (args, _ctx) => {
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
      return {
        content: [
          {
            type: "text" as const,
            text:
              "iris_env_promote:execute ships in Story 27.3 -- not yet implemented. " +
              "Use action 'plan' to generate a promotion plan from a prior iris_env_diff result.",
          },
        ],
        isError: true,
      };
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
