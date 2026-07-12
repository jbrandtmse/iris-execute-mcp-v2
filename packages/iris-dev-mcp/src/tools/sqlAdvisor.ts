/**
 * SQL Performance Advisor heuristic engine (Epic 28, Story 28.2).
 *
 * Pure TypeScript transform: given the raw materials the Story 28.1
 * ObjectScript endpoint `POST /dev/sql/advise-data` returns (verbatim
 * `EXPLAIN` plan text + the tables a statement references + each table's
 * `%Dictionary.CompiledIndex` rows), produce ranked advisor findings for the
 * five heuristics pinned in `06-sql-performance-advisor.md` §4: `full-scan`,
 * `missing-index`, `stale-stats`, `unused-index`, `plan-anomaly`.
 *
 * **This module makes NO IRIS/HTTP call.** Story 28.3 owns the live call to
 * `/dev/sql/advise-data` and wires {@link analyzeAdviceData} into the
 * `iris_sql_analyze` `advise` action — no tool/`mutates`/governance change
 * ships here (Integration-AC rule).
 *
 * **Marker vocabulary (Rule #36 — reference-captured, never hand-reasoned).**
 * Every plan-text pattern below is pinned by a VERBATIM live capture against
 * IRIS 2026.1 (Build 235U) — see `../__tests__/sqlAdvisor.fixtures.ts` for
 * the exact `curl` capture commands and full plan text. Two real cross-query
 * variances were captured and are deliberately tolerated here (never
 * invented — both are cited in the fixtures file):
 *   - the master-map trailing segment is NOT always `IDKEY` (`%Dictionary.
 *     CompiledClass` emits `...Master`; the system pseudo-table
 *     `%TSQL_sys.snf` emits `...Map1`) — the parser accepts ANY trailing
 *     segment, not just `IDKEY`.
 *   - the per-row predicate line is NOT always wrapped in `%SQLUPPER(...)`
 *     (an EXACT-collation column reports the bare column name instead).
 *
 * Plan text that matches NONE of the known structural markers (garbage,
 * empty, or an alien/future-version shape) degrades to `findings: []` + a
 * `"plan format not recognized"` note — this engine NEVER throws and NEVER
 * guesses at an unfamiliar plan shape (AC 28.2.3).
 */

// ── Types (the Story 28.1 endpoint's response shape, spec §3) ───────

/** One `%Dictionary.CompiledIndex` row for a table (Story 28.1 AC 28.1.1). */
export interface AdviseDataIndexRow {
  indexName: string;
  /** Verbatim, order-preserving `Prop:Collation,…` string; leading subscript = first entry. */
  properties: string;
  primaryKey?: boolean;
  isUnique?: boolean;
  type?: string;
  data?: string;
}

/** A table's index rows, grouped (Story 28.1 response shape). */
export interface AdviseDataIndexGroup {
  className: string;
  schema: string;
  table: string;
  rows: AdviseDataIndexRow[];
}

/** One `{schema, table, className}` entry the plan referenced. */
export interface AdviseDataTable {
  schema: string;
  table: string;
  className: string;
}

/** The `{ plan, tables, indexes }` shape returned by `POST /dev/sql/advise-data`. */
export interface AdviseData {
  plan?: string;
  tables?: AdviseDataTable[];
  indexes?: AdviseDataIndexGroup[];
}

/** Optional context the caller (Story 28.3) can supply to enrich findings. */
export interface AdvisorContext {
  /** The original SQL text being advised on; populates each finding's `statement`. */
  query?: string;
}

export type AdvisorFindingType =
  | "full-scan"
  | "missing-index"
  | "stale-stats"
  | "unused-index"
  | "plan-anomaly";

export type AdvisorConfidence = "high" | "medium" | "low";

/** One advisor finding (spec §3 output shape). */
export interface AdvisorFinding {
  type: AdvisorFindingType;
  confidence: AdvisorConfidence;
  statement: string;
  /** Citation: what evidence in the plan/dictionary data supports this finding. */
  evidence: string;
  recommendation: string;
  /** Only present for `missing-index`. */
  suggestedDdl?: string;
  /** The plan-text excerpt the finding was derived from — every finding carries one. */
  planExcerpt: string;
}

/** {@link analyzeAdviceData}'s return shape: findings plus explanatory notes
 *  (currently only used for the "plan format not recognized" case, AC 28.2.3). */
export interface AdvisorAnalysisResult {
  findings: AdvisorFinding[];
  notes: string[];
}

// ── Internal helpers ─────────────────────────────────────────────────

function isSystemSchema(schema: string): boolean {
  return schema.startsWith("%") || schema.toUpperCase() === "INFORMATION_SCHEMA";
}

/** Known IRIS EXPLAIN structural markers (Story 28.0 + Story 28.2 live
 *  captures). Presence of ANY marker means the text "looks like" a real IRIS
 *  plan; absence of ALL of them means the engine cannot interpret it. */
function looksLikeIrisPlan(planText: string): boolean {
  return (
    /Read master map /.test(planText) ||
    /Read index map /.test(planText) ||
    /Read temp-file /.test(planText) ||
    /which populates temp-file/.test(planText) ||
    /Warning:\r?\n\s*Table /.test(planText)
  );
}

interface FullScanMatch {
  schema: string;
  table: string;
  excerpt: string;
}

/**
 * Extract full-table-scan matches: `Read master map <Schema>.<Table>.<Map>,
 * looping on [alias.]ID.`. The trailing map-name segment is deliberately NOT
 * constrained to `IDKEY` (see module doc — real captures vary it), and an
 * optional parenthetical join alias between table and map name (e.g.
 * `Table(C).IDKEY`, Story 28.0's join capture) is tolerated.
 *
 * CR 28.2-4: the `looping on` clause is ALSO tolerant of a composite/non-`ID`
 * IDKEY, whose master-map read loops on its own key columns instead of a
 * bare `ID` (live-captured, 2026-07-11: `Read master map
 * INFORMATION_SCHEMA.TABLES.Master, looping on SchemaExact and
 * TableExact.` — a genuine full scan that the `ID`-only clause missed, a
 * false NEGATIVE, never a harmful false positive). `[\w.]+` matches the
 * first looping column, optionally repeated via `" and "` for additional
 * composite-key columns, always anchored on `Read master map` (never an
 * index-map read) and a trailing period.
 */
const FULL_SCAN_RE =
  /Read master map ([\w%]+)\.([\w%]+?)(?:\([A-Za-z0-9]+\))?\.[\w%]+, looping on [\w.]+(?: and [\w.]+)*\./g;

function findFullScans(planText: string): FullScanMatch[] {
  const matches: FullScanMatch[] = [];
  FULL_SCAN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = FULL_SCAN_RE.exec(planText)) !== null) {
    matches.push({ schema: m[1] ?? "", table: m[2] ?? "", excerpt: m[0] });
  }
  return matches;
}

/** Equality/range operators that count toward `missing-index`'s "predicate
 *  column" trigger (AC 28.2.1). `NOT NULL`/`IS NULL`/`LIKE`/`IN` are excluded
 *  — they're not the leading-subscript-equality/range shape the heuristic
 *  targets. */
const EQUALITY_RANGE_OPS = new Set(["=", "<>", "<=", ">=", "<", ">", "BETWEEN"]);

// Longest-alternative-first so e.g. "<=" is tried before the bare "<".
const OP_ALTERNATION = "NOT NULL|IS NOT NULL|IS NULL|BETWEEN|LIKE|IN|<>|<=|>=|=|<|>";

// A predicate line is `Test the <op> condition on %SQLUPPER(<Col>)` OR (a
// real live variance, EXACT-collation columns) `Test the <op> condition on
// <Col>` with no %SQLUPPER wrapper at all.
const PREDICATE_RE = new RegExp(
  `the (${OP_ALTERNATION}) condition on (?:%SQLUPPER\\(([\\w.%]+)\\)|([\\w.%]+))`,
  "gi",
);

interface PredicateMatch {
  op: string;
  column: string;
}

function findPredicates(planText: string): PredicateMatch[] {
  const matches: PredicateMatch[] = [];
  PREDICATE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PREDICATE_RE.exec(planText)) !== null) {
    const column = m[2] ?? m[3] ?? "";
    if (!column) continue;
    matches.push({ op: (m[1] ?? "").toUpperCase(), column });
  }
  return matches;
}

/** Leading-subscript column of an index's `Prop:Collation,…` properties
 *  string (order-preserving; split on `,`, strip `:Collation` per entry,
 *  first non-empty entry wins). Empty/undefined for a keyless index (bare
 *  `IDKEY`, `properties: ""`). */
function leadingColumn(properties: string): string | undefined {
  return properties
    .split(",")
    .map((p) => p.split(":")[0]?.trim())
    .find((c): c is string => !!c);
}

const STALE_STATS_RE = /Warning:\r?\n\s*Table ([\w%]+\.[\w%]+) is not tuned\./g;

interface StaleStatsMatch {
  table: string;
  excerpt: string;
}

function findStaleStatsWarnings(planText: string): StaleStatsMatch[] {
  const out: StaleStatsMatch[] = [];
  STALE_STATS_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STALE_STATS_RE.exec(planText)) !== null) {
    out.push({ table: m[1] ?? "", excerpt: m[0].trim() });
  }
  return out;
}

/** Temp-file / intermediate-build markers — shared by `GROUP BY`/`ORDER BY`
 *  AND joins (Story 28.0 finding: no distinct join marker exists, so
 *  "temp-file present" is treated generically, never as "this is a join"). */
const TEMP_FILE_RE =
  /Call Module-[A-Za-z0-9]+, which populates temp-file [A-Za-z0-9]+\.|Read temp-file [A-Za-z0-9]+, [^\n\r]*/g;

function findTempFileMarkers(planText: string): string[] {
  const out: string[] = [];
  TEMP_FILE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TEMP_FILE_RE.exec(planText)) !== null) {
    out.push(m[0].trim());
  }
  return out;
}

/**
 * Parse the maps/indexes named in an IRIS `EXPLAIN` plan text. Reused AS-IS
 * (spec §4 "unchanged, reused as-is") from
 * {@link "./sqlAnalyze.js".parsePlanIndexes} — duplicated locally rather than
 * imported so `sqlAnalyze.ts`'s four existing actions remain byte-for-byte
 * untouched (Rule #19) and this module stays a fully independent, pure
 * transform.
 */
function parsePlanIndexes(planText: string): string[] {
  const indexes: string[] = [];
  const seen = new Set<string>();
  const re = /\b(?:master map|index map|bitmap(?: index map)?|temp-file|map)\s+([A-Za-z%][\w.%]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(planText)) !== null) {
    const name = m[1];
    if (name && !seen.has(name)) {
      seen.add(name);
      indexes.push(name);
    }
  }
  return indexes;
}

// ── The engine ────────────────────────────────────────────────────────

/**
 * Analyze the Story 28.1 endpoint's raw materials and produce ranked advisor
 * findings. Pure function — no IRIS/HTTP call, never throws.
 */
export function analyzeAdviceData(
  raw: AdviseData | null | undefined,
  ctx: AdvisorContext = {},
): AdvisorAnalysisResult {
  const statement = ctx.query ?? "";
  const planText = typeof raw?.plan === "string" ? raw.plan : "";
  const indexGroups: AdviseDataIndexGroup[] = Array.isArray(raw?.indexes) ? raw.indexes : [];

  if (planText === "" || !looksLikeIrisPlan(planText)) {
    return { findings: [], notes: ["plan format not recognized"] };
  }

  const findings: AdvisorFinding[] = [];

  // ── full-scan + missing-index ──────────────────────────────────────
  const fullScans = findFullScans(planText);
  const predicates = findPredicates(planText);
  const predicateExists = predicates.length > 0;
  const equalityRangePredicates = predicates.filter((p) => EQUALITY_RANGE_OPS.has(p.op));

  for (const scan of fullScans) {
    // AC 28.2.1: full-scan requires the statement to carry a WHERE/JOIN
    // predicate — a bare master-map read with no predicate (e.g. a plain
    // GROUP BY/ORDER BY feeding a temp-file build) is not itself a finding.
    if (!predicateExists) continue;

    findings.push({
      type: "full-scan",
      confidence: "medium",
      statement,
      evidence:
        `Plan shows a full table scan (master-map read) over ${scan.schema}.${scan.table} ` +
        "with a per-row WHERE/JOIN predicate test — no index narrows the scan.",
      recommendation:
        "Review whether an index could avoid this full table scan; see the accompanying " +
        "missing-index finding (if any) for a suggested index.",
      planExcerpt: scan.excerpt,
    });

    // missing-index: never against a system schema (AC 28.2.1/28.2.3), and
    // only when we can resolve an index list for this exact table (CR
    // 28.1-1: an unresolved table means "index list unknown", not "no
    // index exists" — never guess a false positive).
    if (isSystemSchema(scan.schema)) continue;

    // Rule #50: the correlation key is (table identity, column name) ONLY —
    // schema+table identifies the table; nothing per-plan/per-invocation is
    // folded into this lookup.
    const group = indexGroups.find(
      (g) =>
        g != null &&
        (g.schema ?? "").toUpperCase() === scan.schema.toUpperCase() &&
        (g.table ?? "").toUpperCase() === scan.table.toUpperCase(),
    );
    if (!group) continue;
    // A resolved group whose `rows` isn't a proper array means the index list
    // could not be enumerated ("unknown"), NOT "no index exists" — never emit a
    // false missing-index for it, and never throw on the `.map` below (AC 28.2.3).
    if (!Array.isArray(group.rows)) continue;

    const leadingCols = new Set(
      group.rows
        .map((r) => leadingColumn(r?.properties ?? ""))
        .filter((c): c is string => !!c)
        .map((c) => c.toUpperCase()),
    );

    const missingPredicates = equalityRangePredicates.filter((p) => !leadingCols.has(p.column.toUpperCase()));
    if (missingPredicates.length === 0) continue;

    const uniqueMissingCols = Array.from(new Set(missingPredicates.map((p) => p.column)));
    const existingIndexList = group.rows.map((r) => r?.indexName ?? "(unnamed)").join(", ") || "(none)";
    const ddlTable = `${scan.schema}.${scan.table}`;
    const ddlName = "Idx" + uniqueMissingCols.join("");
    const suggestedDdl =
      `CREATE INDEX ${ddlName} ON ${ddlTable} (${uniqueMissingCols.join(", ")}). ` +
      "Verify with EXPLAIN after creation.";
    // CR 28.2-2: check EVERY missing predicate's operator, not just the
    // first one encountered in plan-text order. `WHERE col = ? AND col > ?`
    // on one unindexed column previously ranked `high`/`medium` purely by
    // which predicate the regex matched first — non-deterministic-feeling
    // for logically equivalent queries with the operators plan-text-reordered.
    // Deterministic per spec intent: `high` iff exactly one unique missing
    // column AND every predicate on it is `=`, else `medium`.
    const isSingleColumnEquality =
      uniqueMissingCols.length === 1 && missingPredicates.every((p) => p.op === "=");

    findings.push({
      type: "missing-index",
      confidence: isSingleColumnEquality ? "high" : "medium",
      statement,
      evidence:
        `Predicate column(s) ${uniqueMissingCols.join(", ")} on ${ddlTable} have no index with ` +
        `it as the leading subscript (existing indexes checked: ${existingIndexList}).`,
      recommendation: `Consider: ${suggestedDdl}`,
      suggestedDdl,
      planExcerpt: scan.excerpt,
    });
  }

  // ── stale-stats ───────────────────────────────────────────────────
  for (const w of findStaleStatsWarnings(planText)) {
    findings.push({
      type: "stale-stats",
      confidence: "low",
      statement,
      evidence: `The EXPLAIN plan reports that table statistics have never been gathered for ${w.table}.`,
      recommendation:
        `Run $SYSTEM.SQL.Stats.Table.GatherTableStats("${w.table}") to refresh statistics so ` +
        "the optimizer can choose better plans.",
      planExcerpt: w.excerpt,
    });
  }

  // ── plan-anomaly ──────────────────────────────────────────────────
  const tempFileMarkers = findTempFileMarkers(planText);
  if (tempFileMarkers.length > 0) {
    findings.push({
      type: "plan-anomaly",
      confidence: "low",
      statement,
      evidence:
        "Plan builds a temporary intermediate work file (shared vocabulary for GROUP BY/" +
        "ORDER BY and joins — presence alone does not confirm which).",
      recommendation:
        "Review whether an index could support this GROUP BY/ORDER BY/join and avoid the " +
        "temp-file build.",
      planExcerpt: tempFileMarkers.join(" "),
    });
  }

  // ── unused-index (reuses parsePlanIndexes, spec §4) ────────────────
  const referencedTokens = parsePlanIndexes(planText);
  const usedTokens = new Set(referencedTokens.map((t) => t.toUpperCase()));
  for (const group of indexGroups) {
    // Guard malformed groups (never throw — AC 28.2.3).
    if (!group || !Array.isArray(group.rows)) continue;
    // Never recommend dropping an index on a system schema (%* / INFORMATION_SCHEMA),
    // mirroring the missing-index exclusion.
    if (isSystemSchema(group.schema ?? "")) continue;
    for (const row of group.rows) {
      if (!row) continue;
      // The primary/master (IDKEY) map is the row storage itself, never a
      // droppable "unused index". It is also the exact row whose plan display
      // name varies (`...IDKEY` vs `...Master` vs `...Map1`) and so never
      // correlates against `parsePlanIndexes` tokens — excluding it removes the
      // harmful "drop your primary key" false positive on those variances.
      if ((row.type ?? "").toLowerCase() === "key" || row.primaryKey === true) continue;
      const token = `${group.schema}.${group.table}.${row.indexName}`.toUpperCase();
      if (usedTokens.has(token)) continue;

      findings.push({
        type: "unused-index",
        confidence: "low",
        statement,
        evidence:
          `Index ${row.indexName} on ${group.schema}.${group.table} is not referenced anywhere ` +
          `in this plan (indexes referenced: ${referencedTokens.join(", ") || "(none)"}).`,
        recommendation:
          `Index ${row.indexName} was not used by this query; if this holds across your real ` +
          "workload (observation windows can mislead), consider dropping it.",
        planExcerpt:
          referencedTokens.length > 0
            ? `Referenced in this plan: ${referencedTokens.join(", ")}`
            : "(no maps/indexes referenced anywhere in this plan)",
      });
    }
  }

  return { findings, notes: [] };
}
