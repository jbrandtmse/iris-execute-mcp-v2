/**
 * Composite instance health check for the IRIS Operations MCP server.
 *
 * Provides {@link healthCheckTool} -- `iris_health_check` -- a single tool
 * call that gathers raw per-area health data from the custom REST endpoint
 * `GET/POST /api/executemcp/v2/monitor/health` (Story 23.1,
 * `ExecuteMCPv2.REST.Health:HealthCheck`) and turns it into an explained
 * verdict (`healthy` / `warning` / `critical`) with a per-area finding.
 *
 * Per architecture.md ADR H5 (server-side composition, TS-side
 * interpretation): the ObjectScript endpoint returns RAW values only --
 * every threshold, per-area level rule, and the overall verdict live here
 * in the pure {@link evaluate} function (exported for direct unit testing).
 * This keeps threshold changes free of a bootstrap bump.
 */

import { IrisApiError, type ToolDefinition } from "@iris-mcp/shared";
import { z } from "zod";

/** Base URL for the custom ExecuteMCPv2 REST service. */
const BASE_URL = "/api/executemcp/v2";

// ── Areas ───────────────────────────────────────────────────────

/**
 * The 9 health-check areas (spec §2). `memory` was DROPPED in Story 23.0
 * (no reliable instance-wide memory-health signal exists in IRIS) -- it is
 * NOT in this list and is NOT folded into `system` or any other area.
 */
const AREA_VALUES = [
  "system",
  "databases",
  "journal",
  "mirror",
  "locks",
  "license",
  "ecp",
  "alerts",
  "interop",
] as const;

export type Area = (typeof AREA_VALUES)[number];

/** Per-area finding severity. `notApplicable` never affects the verdict. */
export type Level = "ok" | "warning" | "critical" | "notApplicable" | "error";

/** Overall instance verdict -- always one of these three values. */
export type Verdict = "healthy" | "warning" | "critical";

/**
 * Severity ranking used to reduce N things (per-DB levels, or per-area
 * findings) down to a single "worst" value. `error` intentionally ranks
 * EQUAL to `warning` -- spec §2: "error counts as warning ... a probe
 * failing must not fake a critical instance verdict." `notApplicable`
 * ranks below `ok` and is excluded from "worst" selection entirely (a
 * reducer only considers it when NOTHING else is present).
 */
const SEVERITY_RANK: Record<Level, number> = {
  notApplicable: -1,
  ok: 0,
  warning: 1,
  error: 1,
  critical: 2,
};

/** Metric name shown on a finding, including the generic `error` case. */
const AREA_METRIC_NAMES: Record<Area, string> = {
  system: "processCount",
  databases: "dbFreePct",
  journal: "journalSpacePct",
  mirror: "mirrorStatus",
  locks: "lockTablePct",
  license: "licensePct",
  ecp: "ecpConfigured",
  alerts: "alertState",
  interop: "queueCount",
};

// ── Thresholds ──────────────────────────────────────────────────

/**
 * Threshold override schema (spec §2, all fields optional numbers). Every
 * threshold is applied INDEPENDENTLY -- no range/ordering validation, so an
 * inverted or extreme override (e.g. `journalPctCrit: 1`, per AC 23.2.2 #3)
 * is honored exactly as given.
 *
 * **Direction (Story 23.0 finding, spec §2):** `journalPctWarn`/`Crit`,
 * `licensePctWarn`/`Crit`, and `lockTablePctWarn`/`Crit` are all ASCENDING
 * ("% utilized/full AT-OR-ABOVE this % triggers" -- high is bad). Only
 * `dbFreePctWarn`/`Crit` are DESCENDING ("% free AT-OR-BELOW this %
 * triggers" -- low is bad, since the metric itself is a free-%).
 */
const thresholdsSchema = z.object({
  journalPctWarn: z
    .number()
    .optional()
    .describe("Journal % full ASCENDING warn threshold (default 80; triggers at-or-above)."),
  journalPctCrit: z
    .number()
    .optional()
    .describe("Journal % full ASCENDING critical threshold (default 92; triggers at-or-above)."),
  dbFreePctWarn: z
    .number()
    .optional()
    .describe(
      "Database % free DESCENDING warn threshold (default 10; triggers at-or-below -- low free space is bad).",
    ),
  dbFreePctCrit: z
    .number()
    .optional()
    .describe(
      "Database % free DESCENDING critical threshold (default 3; triggers at-or-below -- low free space is bad).",
    ),
  licensePctWarn: z
    .number()
    .optional()
    .describe("License % used ASCENDING warn threshold (default 80; triggers at-or-above)."),
  licensePctCrit: z
    .number()
    .optional()
    .describe("License % used ASCENDING critical threshold (default 95; triggers at-or-above)."),
  lockTablePctWarn: z
    .number()
    .optional()
    .describe("Lock table % utilized ASCENDING warn threshold (default 50; triggers at-or-above)."),
  lockTablePctCrit: z
    .number()
    .optional()
    .describe("Lock table % utilized ASCENDING critical threshold (default 85; triggers at-or-above)."),
});

export type ThresholdOverrides = z.infer<typeof thresholdsSchema>;

/**
 * Fully-resolved thresholds (every field required). Hand-declared rather
 * than `Required<ThresholdOverrides>` -- Zod's `.optional()` types the
 * VALUE as `number | undefined`, and `Required<T>` only strips the `?`
 * modifier from the KEY, not the `| undefined` already baked into the
 * value type, so the derived type would still be `number | undefined`.
 */
export interface Thresholds {
  journalPctWarn: number;
  journalPctCrit: number;
  dbFreePctWarn: number;
  dbFreePctCrit: number;
  licensePctWarn: number;
  licensePctCrit: number;
  lockTablePctWarn: number;
  lockTablePctCrit: number;
}

const DEFAULT_THRESHOLDS: Thresholds = {
  journalPctWarn: 80,
  journalPctCrit: 92,
  dbFreePctWarn: 10,
  dbFreePctCrit: 3,
  licensePctWarn: 80,
  licensePctCrit: 95,
  lockTablePctWarn: 50,
  lockTablePctCrit: 85,
};

/**
 * Merge partial overrides over the defaults, one field at a time. A key
 * that is present but literally `undefined` (possible from a hand-built
 * caller object, though Zod strips this case in practice) is treated the
 * same as an omitted key -- it keeps its default, per each threshold
 * applying independently (CR 23.0-6).
 *
 * A non-finite override (`NaN`/`Infinity`) is ALSO ignored (keeps the
 * default) rather than applied: applying e.g. a `NaN` critical threshold
 * would make every `value >= threshold` comparison false and silently
 * downgrade a genuinely-critical area. On the tool (wire) path `z.number()`
 * already rejects `NaN` and JSON cannot carry `NaN`/`Infinity`; this
 * `Number.isFinite` gate additionally protects a direct `evaluate()` caller
 * (the exported pure function is used in tests and by any future caller).
 */
function mergeThresholds(overrides: Partial<ThresholdOverrides>): Thresholds {
  const merged: Thresholds = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as Array<keyof Thresholds>) {
    const value = overrides[key];
    if (typeof value === "number" && Number.isFinite(value)) merged[key] = value;
  }
  return merged;
}

// ── Raw payload shapes (Health.cls, Story 23.1 -- pinned ground truth) ──

export interface RawSystem {
  globalReferences: number;
  routineCommands: number;
  uptimeSeconds: number;
  processCount: number;
}

export interface RawDatabaseEntry {
  name: string;
  directory?: string;
  size: number;
  maxSize: number;
  mounted: boolean | number;
  openFailed: boolean | number;
}

export interface RawJournal {
  currentFile?: string;
  primaryDirectory?: string;
  alternateDirectory?: string;
  fileCount?: number;
  currentOffset?: number;
  freeSpaceBytes?: number;
  state?: string;
  volumeFreeBytes: number;
  volumeTotalBytes: number;
}

export interface RawMirror {
  isMember: boolean | number;
  mirrorName?: string;
  memberType?: string;
  isPrimary?: boolean | number;
  isBackup?: boolean | number;
  isAsyncMember?: boolean | number;
  status?: string;
}

export interface RawLocks {
  available: number;
  usable: number;
  used: number;
}

export interface RawLicense {
  currentCSPUsers: number;
  userLimit: number;
  licenseCurrent?: number;
  licenseCurrentPct?: number;
}

export interface RawEcp {
  configured: boolean | number;
}

export interface RawAlerts {
  state: number;
  alertCount: number;
  messages?: string[];
  lastAlert?: string;
}

export interface RawInterop {
  interopEnabled: boolean | number;
  productionName?: string;
  productionStateCode?: number;
  queues?: Array<{ name: string; count: number }>;
  queueCount?: number;
}

/**
 * The endpoint's `result.areas` object -- only areas that were CHECKED and
 * did NOT error are present as keys (a failed area lands in `errors`
 * instead, per Story 23.1 AC 23.1.2).
 */
export interface RawAreas {
  system?: RawSystem;
  databases?: RawDatabaseEntry[];
  journal?: RawJournal;
  mirror?: RawMirror;
  locks?: RawLocks;
  license?: RawLicense;
  ecp?: RawEcp;
  alerts?: RawAlerts;
  interop?: RawInterop;
  [key: string]: unknown;
}

// ── Findings / verdict ──────────────────────────────────────────

export interface Finding {
  area: Area;
  level: Level;
  metric: string;
  value: number | string | null;
  threshold: number | null;
  explanation: string;
}

export interface EvaluateResult {
  verdict: Verdict;
  findings: Finding[];
  raw: RawAreas;
}

/** `true`/`1` -> true; everything else -> false. Health.cls emits real JSON booleans, but tolerate 0/1 too. */
function isTruthy(v: unknown): boolean {
  return v === true || v === 1;
}

/** Round to 2 decimal places (avoids float noise like 29.599999999999998). */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Per-area evaluators ─────────────────────────────────────────

function evaluateSystem(raw: RawSystem): Finding {
  return {
    area: "system",
    level: "ok",
    metric: "processCount",
    value: +raw.processCount,
    threshold: null,
    explanation:
      `Informational (no ok/warning threshold in v1, CR 23.0-3): ${raw.processCount} process(es), ` +
      `${raw.globalReferences} global reference(s), ${raw.routineCommands} routine command(s), ` +
      `uptime ${raw.uptimeSeconds}s.`,
  };
}

interface DbEval {
  name: string;
  level: Level;
  freePct: number | null;
}

function evaluateOneDatabase(db: RawDatabaseEntry, t: Thresholds): DbEval {
  if (isTruthy(db.openFailed)) {
    return { name: db.name, level: "error", freePct: null };
  }
  if (!(db.maxSize > 0) || !isTruthy(db.mounted)) {
    return { name: db.name, level: "notApplicable", freePct: null };
  }
  const freePct = round2(((db.maxSize - db.size) / db.maxSize) * 100);
  if (!Number.isFinite(freePct)) {
    // A non-numeric/absent size (the co-designed endpoint always emits real
    // numbers; this guards a direct evaluate() caller) yields a non-finite %,
    // which must degrade to notApplicable -- never a false "ok" hiding a full DB.
    return { name: db.name, level: "notApplicable", freePct: null };
  }
  let level: Level;
  if (freePct <= t.dbFreePctCrit) level = "critical";
  else if (freePct <= t.dbFreePctWarn) level = "warning";
  else level = "ok";
  return { name: db.name, level, freePct };
}

/**
 * Order two rank>=0 per-DB evals by "worse" for the CR 23.0-4 worst-DB
 * aggregation: higher severity rank first; at equal rank an `error` beats a
 * `warning` (an openFailed DB must be surfaced distinctly, not masked behind an
 * equal-rank warning); at the same level the lower freePct (nearer exhaustion)
 * wins so the NAMED database is the genuine worst. Deterministic regardless of
 * the endpoint's database array order.
 */
function isWorseDb(candidate: DbEval, current: DbEval): boolean {
  const rankCandidate = SEVERITY_RANK[candidate.level];
  const rankCurrent = SEVERITY_RANK[current.level];
  if (rankCandidate !== rankCurrent) return rankCandidate > rankCurrent;
  if (candidate.level === "error" && current.level !== "error") return true;
  if (candidate.level !== "error" && current.level === "error") return false;
  if (candidate.freePct !== null && current.freePct !== null) {
    return candidate.freePct < current.freePct;
  }
  return false;
}

function evaluateDatabases(raw: RawDatabaseEntry[] | undefined, t: Thresholds): Finding {
  const dbs = Array.isArray(raw) ? raw : [];
  if (dbs.length === 0) {
    return {
      area: "databases",
      level: "notApplicable",
      metric: "dbFreePct",
      value: null,
      threshold: null,
      explanation: "No databases were returned by the endpoint.",
    };
  }

  const evals = dbs.map((db) => evaluateOneDatabase(db, t));
  // Worst-DB selection (CR 23.0-4). notApplicable (rank < 0) is never chosen as
  // "worst"; ties are broken by isWorseDb (prefer `error` over an equal-rank
  // `warning`, then the lower freePct) so the surfaced level/name is stable and
  // an openFailed database is never masked behind a warning, independent of the
  // endpoint's array order.
  let worst: DbEval | undefined;
  for (const e of evals) {
    if (SEVERITY_RANK[e.level] < 0) continue;
    if (worst === undefined || isWorseDb(e, worst)) worst = e;
  }
  const notApplicableCount = evals.filter((e) => e.level === "notApplicable").length;

  if (!worst) {
    return {
      area: "databases",
      level: "notApplicable",
      metric: "dbFreePct",
      value: null,
      threshold: null,
      explanation:
        `All ${dbs.length} database(s) are notApplicable (unlimited maxSize or unmounted). ` +
        "v1 reports free-% health for maxSize-configured, mounted databases only (CR 23.0-1) " +
        "-- no disk-exhaustion signal for this instance from this area; see iris_database_check.",
    };
  }

  let threshold: number | null = null;
  if (worst.level === "critical") threshold = t.dbFreePctCrit;
  else if (worst.level === "warning" || worst.level === "ok") threshold = t.dbFreePctWarn;

  const explanation =
    worst.level === "error"
      ? `Database '${worst.name}' could not be opened for inspection (openFailed) -- investigate ` +
        `with iris_database_check. ${notApplicableCount} other database(s) notApplicable.`
      : `Worst database '${worst.name}' has ${worst.freePct}% free space (${worst.level} threshold ` +
        `${threshold}%). ${notApplicableCount} database(s) notApplicable (unlimited maxSize or unmounted).`;

  return {
    area: "databases",
    level: worst.level,
    metric: "dbFreePct",
    value: worst.freePct,
    threshold,
    explanation,
  };
}

function evaluateJournal(raw: RawJournal, t: Thresholds): Finding {
  const total = +raw.volumeTotalBytes;
  if (!(total > 0)) {
    return {
      area: "journal",
      level: "notApplicable",
      metric: "journalSpacePct",
      value: null,
      threshold: null,
      explanation: "Journal volume total size is unavailable (0 bytes) -- cannot compute % full.",
    };
  }
  const pctFull = round2(((total - +raw.volumeFreeBytes) / total) * 100);
  if (!Number.isFinite(pctFull)) {
    // A non-numeric/absent free-space value (the co-designed endpoint always
    // emits real numbers, and defaults a failed volume probe to free=0/total=0
    // => the total<=0 guard above; this guards a direct evaluate() caller) must
    // degrade to notApplicable -- never a false "ok" nor a false 100%-full "critical".
    return {
      area: "journal",
      level: "notApplicable",
      metric: "journalSpacePct",
      value: null,
      threshold: null,
      explanation: "Journal free-space value is unavailable or non-numeric -- cannot compute % full.",
    };
  }
  let level: Level;
  let threshold: number;
  if (pctFull >= t.journalPctCrit) {
    level = "critical";
    threshold = t.journalPctCrit;
  } else if (pctFull >= t.journalPctWarn) {
    level = "warning";
    threshold = t.journalPctWarn;
  } else {
    level = "ok";
    threshold = t.journalPctWarn;
  }
  return {
    area: "journal",
    level,
    metric: "journalSpacePct",
    value: pctFull,
    threshold,
    explanation:
      `Journal directory is ${pctFull}% full (${level} threshold ${threshold}%).` +
      (level !== "ok" ? " Purge or expand journal space." : ""),
  };
}

function evaluateMirror(raw: RawMirror): Finding {
  if (!isTruthy(raw.isMember)) {
    return {
      area: "mirror",
      level: "notApplicable",
      metric: "mirrorStatus",
      value: null,
      threshold: null,
      explanation: "Not a mirror member -- informational area, no health threshold in v1 (CR 23.0-3).",
    };
  }
  const value = raw.status ?? raw.memberType ?? "member";
  return {
    area: "mirror",
    level: "ok",
    metric: "mirrorStatus",
    value,
    threshold: null,
    explanation:
      `Mirror member (memberType=${raw.memberType ?? "unknown"}, isPrimary=${isTruthy(raw.isPrimary)}, ` +
      `isBackup=${isTruthy(raw.isBackup)}). Status: ${raw.status ?? "unknown"}. Informational only -- ` +
      "no ok/warning threshold in v1 (CR 23.0-3).",
  };
}

function evaluateLocks(raw: RawLocks, t: Thresholds): Finding {
  const denom = +raw.usable + +raw.used;
  if (!(denom > 0)) {
    return {
      area: "locks",
      level: "notApplicable",
      metric: "lockTablePct",
      value: null,
      threshold: null,
      explanation: "Lock table usable+used space is 0 -- cannot compute utilization %.",
    };
  }
  const pct = round2((+raw.used / denom) * 100);
  let level: Level;
  let threshold: number;
  if (pct >= t.lockTablePctCrit) {
    level = "critical";
    threshold = t.lockTablePctCrit;
  } else if (pct >= t.lockTablePctWarn) {
    level = "warning";
    threshold = t.lockTablePctWarn;
  } else {
    level = "ok";
    threshold = t.lockTablePctWarn;
  }
  return {
    area: "locks",
    level,
    metric: "lockTablePct",
    value: pct,
    threshold,
    explanation: `Lock table is ${pct}% utilized (${level} threshold ${threshold}%).`,
  };
}

function evaluateLicense(raw: RawLicense, t: Thresholds): Finding {
  let pct: number | null = null;
  let usedFallback = false;
  if (typeof raw.licenseCurrentPct === "number") {
    // Prefer the IRIS-authoritative dashboard figure (CR 23.0-2) -- it needs
    // no denominator and is correct for core-based/unlimited-user licenses.
    pct = raw.licenseCurrentPct;
  } else if (raw.userLimit > 0) {
    pct = (raw.currentCSPUsers / raw.userLimit) * 100;
    usedFallback = true;
  }

  if (pct === null || !Number.isFinite(pct)) {
    // pct===null: no usable source. !isFinite: a NaN slipped through (e.g. a
    // NaN licenseCurrentPct, since typeof NaN === "number", or a NaN fallback
    // ratio). Either way degrade to notApplicable -- never a false "ok".
    return {
      area: "license",
      level: "notApplicable",
      metric: "licensePct",
      value: null,
      threshold: null,
      explanation:
        "No user limit configured (core/unlimited-user license) and no authoritative usage " +
        "figure available -- cannot compute % used.",
    };
  }

  pct = round2(pct);
  let level: Level;
  let threshold: number;
  if (pct >= t.licensePctCrit) {
    level = "critical";
    threshold = t.licensePctCrit;
  } else if (pct >= t.licensePctWarn) {
    level = "warning";
    threshold = t.licensePctWarn;
  } else {
    level = "ok";
    threshold = t.licensePctWarn;
  }
  const source = usedFallback
    ? `${raw.currentCSPUsers}/${raw.userLimit} CSP users`
    : "IRIS-authoritative dashboard figure";
  return {
    area: "license",
    level,
    metric: "licensePct",
    value: pct,
    threshold,
    explanation: `License is ${pct}% used (${source}) -- ${level} threshold ${threshold}%.`,
  };
}

function evaluateEcp(raw: RawEcp): Finding {
  if (!isTruthy(raw.configured)) {
    return {
      area: "ecp",
      level: "notApplicable",
      metric: "ecpConfigured",
      value: null,
      threshold: null,
      explanation: "ECP is not configured -- informational area, no health threshold in v1 (CR 23.0-3).",
    };
  }
  return {
    area: "ecp",
    level: "ok",
    metric: "ecpConfigured",
    value: 1,
    threshold: null,
    explanation: "ECP is configured. Informational only -- no ok/warning threshold in v1 (CR 23.0-3).",
  };
}

function evaluateAlerts(raw: RawAlerts): Finding {
  const state = +raw.state;
  let level: Level;
  switch (state) {
    case -1:
      level = "critical";
      break;
    case 0:
      level = "ok";
      break;
    case 1:
    case 2:
      level = "warning";
      break;
    default:
      level = "warning";
      break;
  }
  const last = raw.lastAlert ? ` Last alert: ${raw.lastAlert}.` : "";
  return {
    area: "alerts",
    level,
    metric: "alertState",
    value: state,
    threshold: null,
    explanation: `System alert state is ${state} (${level}); alertCount=${raw.alertCount}.${last}`,
  };
}

function evaluateInterop(raw: RawInterop): Finding {
  if (!isTruthy(raw.interopEnabled)) {
    return {
      area: "interop",
      level: "notApplicable",
      metric: "queueCount",
      value: null,
      threshold: null,
      explanation:
        "No Interoperability (Ens) classes in this namespace -- informational area, no health " +
        "threshold in v1 (CR 23.0-3).",
    };
  }
  const queueCount = raw.queueCount ?? (Array.isArray(raw.queues) ? raw.queues.length : 0);
  return {
    area: "interop",
    level: "ok",
    metric: "queueCount",
    value: queueCount,
    threshold: null,
    explanation:
      `Production '${raw.productionName ?? "(unknown)"}' (stateCode ${raw.productionStateCode ?? "?"}), ` +
      `${queueCount} queue(s) -- informational only, no queue-depth threshold in v1 (CR 23.0-3).`,
  };
}

function evaluateOneArea(area: Area, raw: unknown, t: Thresholds): Finding {
  if (raw === undefined || raw === null) {
    return {
      area,
      level: "error",
      metric: AREA_METRIC_NAMES[area],
      value: null,
      threshold: null,
      explanation: "No data returned for this area.",
    };
  }
  switch (area) {
    case "system":
      return evaluateSystem(raw as RawSystem);
    case "databases":
      return evaluateDatabases(raw as RawDatabaseEntry[], t);
    case "journal":
      return evaluateJournal(raw as RawJournal, t);
    case "mirror":
      return evaluateMirror(raw as RawMirror);
    case "locks":
      return evaluateLocks(raw as RawLocks, t);
    case "license":
      return evaluateLicense(raw as RawLicense, t);
    case "ecp":
      return evaluateEcp(raw as RawEcp);
    case "alerts":
      return evaluateAlerts(raw as RawAlerts);
    case "interop":
      return evaluateInterop(raw as RawInterop);
  }
}

// ── Verdict engine (pure -- exported for direct unit testing) ───

/**
 * Turn the endpoint's raw `{areas, errors}` payload into a verdict + a
 * per-area finding for every CHECKED area (a "checked" area is one present
 * in `rawAreas` OR `errors` -- i.e. a subset request naturally yields a
 * subset of findings, per AC 23.2.2 #2).
 *
 * - `error` counts as `warning` severity for the verdict -- it NEVER
 *   escalates the verdict to `critical` on its own (spec §2).
 * - `notApplicable` findings never affect the verdict (spec §2 / AC 23.2.2 #4).
 * - Findings are always in canonical area order (spec §2's 9-area list),
 *   regardless of the raw payload's own key order.
 *
 * @param rawAreas   - `result.areas` from `GET/POST /monitor/health`.
 * @param errors     - `result.errors` from the same response (default `{}`).
 * @param thresholds - Partial threshold overrides merged over the spec §2 defaults.
 */
export function evaluate(
  rawAreas: RawAreas,
  errors: Record<string, string> = {},
  thresholds: Partial<ThresholdOverrides> = {},
): EvaluateResult {
  const t: Thresholds = mergeThresholds(thresholds);

  const checked = AREA_VALUES.filter(
    (a) =>
      Object.prototype.hasOwnProperty.call(rawAreas, a) ||
      Object.prototype.hasOwnProperty.call(errors, a),
  );

  const findings: Finding[] = checked.map((area) => {
    if (Object.prototype.hasOwnProperty.call(errors, area)) {
      return {
        area,
        level: "error",
        metric: AREA_METRIC_NAMES[area],
        value: null,
        threshold: null,
        explanation: errors[area] || "An internal error occurred.",
      };
    }
    return evaluateOneArea(area, rawAreas[area], t);
  });

  let worstRank = -1;
  for (const f of findings) {
    const rank = SEVERITY_RANK[f.level];
    if (rank > worstRank) worstRank = rank;
  }
  const verdict: Verdict = worstRank <= 0 ? "healthy" : worstRank === 1 ? "warning" : "critical";

  return { verdict, findings, raw: rawAreas };
}

// ── iris_health_check ────────────────────────────────────────────

export const healthCheckTool: ToolDefinition = {
  name: "iris_health_check",
  title: "Composite Health Check",
  description:
    "Runs a composite health check across up to 9 IRIS instance areas in ONE round-trip and " +
    "returns a structured verdict ('healthy' | 'warning' | 'critical') with a per-area finding " +
    "explaining WHY. This is the recommended FIRST call of any diagnostic session -- it " +
    "replaces 6+ separate calls (iris_metrics_system, iris_journal_info, iris_mirror_status, " +
    "iris_locks_list, iris_license_info, iris_database_check, iris_metrics_alerts, " +
    "iris_metrics_interop) with documented, overridable thresholds.\n\n" +
    "Areas (9): 'system', 'databases', 'journal', 'mirror', 'locks', 'license', 'ecp', " +
    "'alerts', 'interop'. NOTE: 'memory' is NOT a valid area -- it was REMOVED in Story 23.0 " +
    "(no reliable instance-wide memory-health signal exists in IRIS). It is dropped entirely, " +
    "NOT folded into 'system' or any other area, and passing it is rejected by this tool's " +
    "input schema.\n\n" +
    "Threshold-checked areas: 'journal' (% full, ASCENDING -- high is bad), 'databases' " +
    "(% free per configured-maxSize, mounted database, DESCENDING -- low is bad; unlimited-" +
    "maxSize or unmounted databases report 'notApplicable' -- v1 has no volume-level disk-" +
    "exhaustion signal for those; see iris_database_check), 'license' (% used, ASCENDING, " +
    "prefers the IRIS-authoritative dashboard figure over a CSP-user-count fallback), 'locks' " +
    "(% of lock table utilized, ASCENDING), 'alerts' (maps the numeric $SYSTEM.Monitor state: " +
    "-1 Hung=critical, 1 Warning/2 Alert=warning, 0 OK=ok). Informational areas (no ok/warning " +
    "threshold in v1 -- raw values only; always 'ok', or 'notApplicable' when not configured): " +
    "'system', 'mirror', 'ecp', 'interop'.\n\n" +
    "A failed probe for one area yields level:'error' for that area only (sanitized message in " +
    "'explanation') -- every other area stays intact, and an 'error' finding counts as " +
    "'warning' severity for the overall verdict (it NEVER escalates the verdict to 'critical' " +
    "by itself). 'notApplicable' findings (e.g. no mirror membership, no Interoperability " +
    "classes in this namespace) never affect the verdict.\n\n" +
    "Optional 'areas' restricts which areas are checked (omit, or pass [], for all 9). " +
    "Optional 'thresholds' overrides any subset of the defaults (journalPctWarn=80/Crit=92, " +
    "dbFreePctWarn=10/Crit=3, licensePctWarn=80/Crit=95, lockTablePctWarn=50/Crit=85) -- each " +
    "threshold applies independently, with no range/ordering validation (an inverted or " +
    "extreme override, e.g. journalPctCrit:1, is honored exactly as given). A finding's " +
    "'explanation' may NAME a fixing tool (e.g. iris_task_run for a journal purge task) but " +
    "never executes it.\n\n" +
    "This is a READ tool (mutates:'read') and is ENABLED BY DEFAULT under IRIS_GOVERNANCE.",
  inputSchema: z.object({
    areas: z
      .array(z.enum(AREA_VALUES))
      .optional()
      .describe(
        "Subset of health areas to check (default: all 9 -- 'system', 'databases', " +
          "'journal', 'mirror', 'locks', 'license', 'ecp', 'alerts', 'interop'). An empty " +
          "array ([]) is treated the same as omitting this parameter -- all 9 areas. " +
          "'memory' is NOT a valid value (removed in Story 23.0; see the tool description).",
      ),
    thresholds: thresholdsSchema
      .optional()
      .describe(
        "Override any subset of the default warning/critical thresholds (see the tool " +
          "description for defaults and direction). Fields not supplied keep their default.",
      ),
  }),
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  scope: "NONE",
  // Governance (Rule #28): `iris_health_check` is a NEW post-foundation key
  // (absent from the frozen governance-baseline.ts, 1e62c5ad5bf7) -- a pure
  // read, so it resolves ENABLED by default under an empty IRIS_GOVERNANCE.
  mutates: "read",
  handler: async (args, ctx) => {
    const { areas, thresholds } = args as {
      areas?: Area[];
      thresholds?: Partial<ThresholdOverrides>;
    };

    // CR 23.0-6: areas:[] is treated the same as "omitted" (all 9 areas) --
    // matches the endpoint's own default-to-all behavior for a blank filter.
    const effectiveAreas = areas && areas.length > 0 ? areas : undefined;

    let path = `${BASE_URL}/monitor/health`;
    if (effectiveAreas) {
      path += `?areas=${encodeURIComponent(effectiveAreas.join(","))}`;
    }

    try {
      const response = await ctx.http.get(path);
      const result = response.result as {
        areas?: RawAreas;
        errors?: Record<string, string>;
      };

      const { verdict, findings, raw } = evaluate(
        result.areas ?? {},
        result.errors ?? {},
        thresholds ?? {},
      );

      const structuredContent = {
        verdict,
        checkedAt: new Date().toISOString(),
        findings,
        raw,
      };

      const lines: string[] = [];
      lines.push(`Verdict: ${verdict.toUpperCase()}`);
      // "notApplicable" is a no-signal marker (never affects the verdict) --
      // it is excluded from the "non-ok" text lines the same way it is
      // excluded from verdict computation, so "All N areas healthy" reads
      // correctly even when some areas are notApplicable (e.g. no mirror
      // configured). Full detail (incl. notApplicable) is always in
      // structuredContent.findings.
      const actionable = findings.filter((f) => f.level !== "ok" && f.level !== "notApplicable");
      if (actionable.length === 0) {
        lines.push(`All ${findings.length} areas healthy.`);
      } else {
        for (const f of actionable) {
          lines.push(`[${f.level.toUpperCase()}] ${f.area}: ${f.explanation}`);
        }
      }

      return {
        content: [{ type: "text" as const, text: lines.join("\n") }],
        structuredContent,
      };
    } catch (error: unknown) {
      if (error instanceof IrisApiError) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error checking IRIS health: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
      throw error;
    }
  },
};
