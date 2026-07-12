/**
 * Reference-captured fixtures for the Story 28.2 SQL Performance Advisor
 * heuristic engine (`../tools/sqlAdvisor.js`).
 *
 * **Rule #36 (BINDING) — every value below is a VERBATIM capture from live
 * IRIS, never hand-reasoned.** Captured against:
 *
 *   IRIS for Windows (x86-64) 2026.1 (Build 235U) Tue Apr 7 2026 16:29:09 EDT
 *   Namespace: HSCUSTOM
 *
 * Fixture schema: `ExecuteMCPv2.Tests.AdvisorFixture` (a `%Persistent` class —
 * see `src/ExecuteMCPv2/Tests/AdvisorFixture.cls`), seeded with 2000 rows via
 * `##class(ExecuteMCPv2.Tests.AdvisorFixture).Populate(2000)`
 * (`IndexedCol`="I<n>" [indexed via `IdxIndexedCol`], `UnindexedCol`="U<n>"
 * [no index]).
 *
 * Every plan below was captured by POSTing to the live Story 28.1 endpoint:
 *
 *   curl -u _SYSTEM:SYS -X POST \
 *     http://localhost:52773/api/executemcp/v2/dev/sql/advise-data \
 *     -H "Content-Type: application/json" \
 *     -d '{"query": "<QUERY>", "namespace": "HSCUSTOM"}'
 *
 * The exact `<QUERY>` for each fixture is documented on its constant. Plan
 * text is stored as an array of lines joined with an explicit `"\r\n"` (never
 * a raw multi-line template literal) so the verbatim CRLF captured from IRIS
 * survives this repo's `.gitattributes` `eol=lf` normalization untouched —
 * the normalization only touches the SOURCE FILE's own line breaks, not
 * escape sequences inside a string literal.
 */

import type { AdviseData, AdviseDataIndexGroup } from "../tools/sqlAdvisor.js";

/** Shared index-dictionary rows for `ExecuteMCPv2.Tests.AdvisorFixture`
 *  (identical across every fixture below — same table, same indexes;
 *  live-captured once, reused). */
const ADVISOR_FIXTURE_INDEXES: AdviseDataIndexGroup[] = [
  {
    className: "ExecuteMCPv2.Tests.AdvisorFixture",
    schema: "ExecuteMCPv2_Tests",
    table: "AdvisorFixture",
    rows: [
      { indexName: "IDKEY", properties: "", primaryKey: false, isUnique: false, type: "key", data: "" },
      {
        indexName: "IdxIndexedCol",
        properties: "IndexedCol",
        primaryKey: false,
        isUnique: false,
        type: "index",
        data: "",
      },
    ],
  },
];

const ADVISOR_FIXTURE_TABLES = [
  { schema: "ExecuteMCPv2_Tests", table: "AdvisorFixture", className: "ExecuteMCPv2.Tests.AdvisorFixture" },
];

// ── Fixture 1: WHERE on the UNindexed column, BEFORE tune ───────────
// Query: SELECT ID, UnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture
//        WHERE UnindexedCol = 'U7'
// Captured 2026-07-11, immediately after Populate(2000), before any
// GatherTableStats call. Expect: full-scan + missing-index (high, single-
// column equality) + stale-stats (warning present) + unused-index
// (IdxIndexedCol never referenced).
const PLAN_UNINDEXED_BEFORE_TUNE_LINES = [
  '<plans>',
  ' <plan>',
  '   SQL:',
  '    SELECT ID , UnindexedCol FROM ExecuteMCPv2_Tests . AdvisorFixture WHERE UnindexedCol = ? /*#OPTIONS {"DynamicSQL":1} */ /*#OPTIONS {"DynamicSQLTypeList":"1"} */',
  '   ',
  '   Warning:',
  '   Table ExecuteMCPv2_Tests.AdvisorFixture is not tuned.',
  '   ',
  '   Cost: 1173600',
  '   ',
  '   Module-FIRST:',
  '     Module-B:',
  '     Read master map ExecuteMCPv2_Tests.AdvisorFixture.IDKEY, looping on ID.',
  '     For each row:',
  '         Test the = condition on %SQLUPPER(UnindexedCol) and the NOT NULL condition on %SQLUPPER(UnindexedCol).',
  '         Output the row.',
  ' </plan>',
  '</plans>',
];

export const ADVISE_DATA_UNINDEXED_BEFORE_TUNE: AdviseData = {
  plan: PLAN_UNINDEXED_BEFORE_TUNE_LINES.join("\r\n"),
  tables: ADVISOR_FIXTURE_TABLES,
  indexes: ADVISOR_FIXTURE_INDEXES,
};

// ── Fixture 2: WHERE on the INDEXED column, BEFORE tune ──────────────
// Query: SELECT ID, IndexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture
//        WHERE IndexedCol = 'I7'
// Captured 2026-07-11 (same session as Fixture 1, still before tune).
// Expect: NO full-scan (index map read, not a master-map scan), NO
// missing-index, stale-stats fires (still untuned), NO unused-index (both
// IDKEY and IdxIndexedCol are referenced), NO plan-anomaly.
const PLAN_INDEXED_BEFORE_TUNE_LINES = [
  '<plans>',
  ' <plan>',
  '   SQL:',
  '    SELECT ID , IndexedCol FROM ExecuteMCPv2_Tests . AdvisorFixture WHERE IndexedCol = ? /*#OPTIONS {"DynamicSQL":1} */ /*#OPTIONS {"DynamicSQLTypeList":"1"} */',
  '   ',
  '   Warning:',
  '   Table ExecuteMCPv2_Tests.AdvisorFixture is not tuned.',
  '   ',
  '   Cost: 84200',
  '   ',
  '   Module-FIRST:',
  '     Module-B:',
  '     Read index map ExecuteMCPv2_Tests.AdvisorFixture.IdxIndexedCol, using the given %SQLUPPER(IndexedCol), and looping on ID.',
  '     For each row:',
  '         Read master map ExecuteMCPv2_Tests.AdvisorFixture.IDKEY, using the given idkey value.',
  '         Output the row.',
  ' </plan>',
  '</plans>',
];

export const ADVISE_DATA_INDEXED_BEFORE_TUNE: AdviseData = {
  plan: PLAN_INDEXED_BEFORE_TUNE_LINES.join("\r\n"),
  tables: ADVISOR_FIXTURE_TABLES,
  indexes: ADVISOR_FIXTURE_INDEXES,
};

// ── Fixture 3: GROUP BY/ORDER BY on the unindexed column, BEFORE tune ──
// Query: SELECT UnindexedCol, COUNT(*) FROM ExecuteMCPv2_Tests.AdvisorFixture
//        GROUP BY UnindexedCol ORDER BY UnindexedCol
// Captured 2026-07-11 (still before tune). Expect: plan-anomaly (temp-file
// markers), stale-stats fires, unused-index (IdxIndexedCol never
// referenced), NO full-scan (master-map read present but NO WHERE/JOIN
// predicate — no "Test the ... condition on" line at all).
const PLAN_GROUPBY_TEMPFILE_BEFORE_TUNE_LINES = [
  '<plans>',
  ' <plan>',
  '   SQL:',
  '    SELECT UnindexedCol , COUNT ( * ) FROM ExecuteMCPv2_Tests . AdvisorFixture GROUP BY UnindexedCol ORDER BY UnindexedCol /*#OPTIONS {"DynamicSQL":1} */',
  '   ',
  '   Warning:',
  '   Table ExecuteMCPv2_Tests.AdvisorFixture is not tuned.',
  '   ',
  '   Cost: 4495216',
  '   ',
  '   Module-FIRST:',
  '   Call Module-B, which populates temp-file B.',
  '     Module-B:',
  '     Read master map ExecuteMCPv2_Tests.AdvisorFixture.IDKEY, looping on ID.',
  '     For each row:',
  '           Module-C:',
  '           Check distinct values for %SQLUPPER(UnindexedCol) using temp-file B,',
  '               subscripted by %SQLUPPER(UnindexedCol).',
  '           For each distinct row:',
  '               Add a row to temp-file B, subscripted by %SQLUPPER(UnindexedCol),',
  '                   with no node data.',
  '         Update the accumulated count(rows) in temp-file B,',
  '             subscripted by %SQLUPPER(UnindexedCol)',
  '     Module-D:',
  '     Read temp-file B, looping on %SQLUPPER(UnindexedCol).',
  '     For each row:',
  '         Output the row.',
  ' </plan>',
  '</plans>',
];

export const ADVISE_DATA_GROUPBY_TEMPFILE_BEFORE_TUNE: AdviseData = {
  plan: PLAN_GROUPBY_TEMPFILE_BEFORE_TUNE_LINES.join("\r\n"),
  tables: ADVISOR_FIXTURE_TABLES,
  indexes: ADVISOR_FIXTURE_INDEXES,
};

// ── Fixture 4: WHERE on the UNindexed column, AFTER tune ─────────────
// SAME query as Fixture 1, captured 2026-07-11 AFTER running:
//   Write $SYSTEM.SQL.Stats.Table.GatherTableStats("ExecuteMCPv2_Tests.AdvisorFixture")
// Expect: full-scan + missing-index (high) + unused-index still fire; the
// stale-stats `Warning:` block is now ABSENT (this is the before/after pair
// AC 28.2.2 requires).
const PLAN_UNINDEXED_AFTER_TUNE_LINES = [
  '<plans>',
  ' <plan>',
  '   SQL:',
  '    SELECT ID , UnindexedCol FROM ExecuteMCPv2_Tests . AdvisorFixture WHERE UnindexedCol = ? /*#OPTIONS {"DynamicSQL":1} */ /*#OPTIONS {"DynamicSQLTypeList":"1"} */',
  '   ',
  '   Cost: 13000',
  '   ',
  '   Module-FIRST:',
  '     Module-B:',
  '     Read master map ExecuteMCPv2_Tests.AdvisorFixture.IDKEY, looping on ID.',
  '     For each row:',
  '         Test the = condition on %SQLUPPER(UnindexedCol) and the NOT NULL condition on %SQLUPPER(UnindexedCol).',
  '         Output the row.',
  ' </plan>',
  '</plans>',
];

export const ADVISE_DATA_UNINDEXED_AFTER_TUNE: AdviseData = {
  plan: PLAN_UNINDEXED_AFTER_TUNE_LINES.join("\r\n"),
  tables: ADVISOR_FIXTURE_TABLES,
  indexes: ADVISOR_FIXTURE_INDEXES,
};

// ── Fixture 5: system-schema query (%Dictionary.CompiledClass), AFTER
//    the AdvisorFixture tune (this table is untouched, so ITS OWN
//    stale-stats warning fires) ────────────────────────────────────────
// Query: SELECT Name FROM %Dictionary.CompiledClass
//        WHERE Description = 'ZZZNoSuchDescriptionZZZ'
// Captured 2026-07-11. Expect: full-scan fires (master-map marker present —
// note the map-name suffix here is "Master", NOT "IDKEY"; a real live
// variance the engine's marker regex must tolerate) + stale-stats fires;
// missing-index MUST NOT fire (schema "%Dictionary" is a system schema —
// AC 28.2.1/28.2.3 exclusion).
const PLAN_SYSTEM_SCHEMA_QUERY_LINES = [
  '<plans>',
  ' <plan>',
  '   SQL:',
  '    SELECT Name FROM %Dictionary . CompiledClass WHERE Description = ? /*#OPTIONS {"DynamicSQL":1} */ /*#OPTIONS {"DynamicSQLTypeList":"1"} */',
  '   ',
  '   Warning:',
  '   Table %Dictionary.CompiledClass is not tuned.',
  '   ',
  '   Cost: 20400200',
  '   ',
  '   Module-FIRST:',
  '     Module-B:',
  '     Read master map %Dictionary.CompiledClass.Master, looping on ID.',
  '     For each row:',
  '         Test the = condition on Description and the NOT NULL condition on Description.',
  '         Output the row.',
  ' </plan>',
  '</plans>',
];

export const ADVISE_DATA_SYSTEM_SCHEMA_QUERY: AdviseData = {
  plan: PLAN_SYSTEM_SCHEMA_QUERY_LINES.join("\r\n"),
  tables: [{ schema: "%Dictionary", table: "CompiledClass", className: "%Dictionary.CompiledClass" }],
  indexes: [
    {
      className: "%Dictionary.CompiledClass",
      schema: "%Dictionary",
      table: "CompiledClass",
      rows: [{ indexName: "IDKEY", properties: "Name", primaryKey: false, isUnique: false, type: "key", data: "" }],
    },
  ],
};

// ── Fixture 5.5 (CR 28.2-4 / CR 28.2-3, Story 29.3 burn-down): a COMPOSITE
//    (non-`ID`) IDKEY master-map full scan ─────────────────────────────
// Query: SELECT TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'
// Captured 2026-07-12 (IRIS for Windows (x86-64) 2026.1, namespace HSCUSTOM,
// `curl -u _SYSTEM:SYS -X POST http://localhost:52773/api/executemcp/v2/dev/sql/advise-data
//  -d '{"query":"SELECT TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = ''BASE TABLE''"}'`).
// `INFORMATION_SCHEMA.TABLES`'s IDKEY is a composite string key, so its
// master-map read loops on its OWN key columns ("SchemaExact and
// TableExact") instead of a bare "ID" — the pre-CR-28.2-4 `FULL_SCAN_RE`
// (anchored on `looping on [\w.]*ID\.`) did NOT match this line, a false
// NEGATIVE (CR 28.2-4). Expect: full-scan NOW fires (schema is
// INFORMATION_SCHEMA — a system schema, so missing-index/unused-index
// correctly do NOT fire regardless, per the existing CR 28.2-3
// investigation); this fixture also closes the CR 28.2-3 coverage gap.
const PLAN_INFORMATION_SCHEMA_COMPOSITE_IDKEY_LINES = [
  '<plans>',
  ' <plan>',
  '   SQL:',
  '    SELECT TABLE_TYPE FROM INFORMATION_SCHEMA . TABLES WHERE TABLE_TYPE = ? /*#OPTIONS {"DynamicSQL":1} */ /*#OPTIONS {"DynamicSQLTypeList":"1"} */',
  '   ',
  '   Warning:',
  '   Table INFORMATION_SCHEMA.TABLES is not tuned.',
  '   ',
  '   Cost: 3107000',
  '   ',
  '   Module-FIRST:',
  '     Module-B:',
  '     Read master map INFORMATION_SCHEMA.TABLES.Master, looping on SchemaExact and TableExact.',
  '     For each row:',
  '         Test the = condition on %SQLUPPER(TABLE_TYPE).',
  '         Output the row.',
  ' </plan>',
  '</plans>',
];

export const ADVISE_DATA_INFORMATION_SCHEMA_COMPOSITE_IDKEY: AdviseData = {
  plan: PLAN_INFORMATION_SCHEMA_COMPOSITE_IDKEY_LINES.join("\r\n"),
  tables: [{ schema: "INFORMATION_SCHEMA", table: "TABLES", className: "" }],
  indexes: [],
};

// ── Fixture 6: range predicate on the unindexed column, AFTER tune ───
// Query: SELECT ID, UnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture
//        WHERE UnindexedCol > 'U500'
// Captured 2026-07-11 (after tune — no stale-stats warning). Expect:
// full-scan + missing-index at MEDIUM confidence (range operator `>`, not
// equality — AC 28.2.1's confidence rule).
const PLAN_RANGE_PREDICATE_AFTER_TUNE_LINES = [
  '<plans>',
  ' <plan>',
  '   SQL:',
  '    SELECT ID , UnindexedCol FROM ExecuteMCPv2_Tests . AdvisorFixture WHERE UnindexedCol > ? /*#OPTIONS {"DynamicSQL":1} */ /*#OPTIONS {"DynamicSQLTypeList":"1"} */ /*#OPTIONS {"rtpc-utility":1} */ /*#OPTIONS {"rtpc-truth-value":["heCFqw8mm2^1"],"rtpc-range":["1^.625"]} */',
  '   ',
  '   Info:',
  '   This query plan was selected based on the runtime parameter values that led to:',
  '       Improved selectivity estimation of a > condition on UnindexedCol.',
  '       Boolean truth value of a NOT NULL condition on arg1.',
  '   ',
  '   Cost: 13000',
  '   ',
  '   Module-FIRST:',
  '     Module-B:',
  '     Read master map ExecuteMCPv2_Tests.AdvisorFixture.IDKEY, looping on ID.',
  '     For each row:',
  '         Test the > condition on %SQLUPPER(UnindexedCol).',
  '         Output the row.',
  ' </plan>',
  '</plans>',
];

export const ADVISE_DATA_RANGE_PREDICATE_AFTER_TUNE: AdviseData = {
  plan: PLAN_RANGE_PREDICATE_AFTER_TUNE_LINES.join("\r\n"),
  tables: ADVISOR_FIXTURE_TABLES,
  indexes: ADVISOR_FIXTURE_INDEXES,
};

// ── Fixture 7: a genuinely unparseable query — live error envelope ───
// Query: SELEKT GARBAGE FROM NoSuchTable
// Captured 2026-07-11. The live endpoint's OWN response when EXPLAIN cannot
// prepare the statement — `result` comes back as an empty object (`plan`/
// `tables`/`indexes` all absent). This is a REAL captured shape (not
// invented) that the engine must degrade gracefully on: no `plan` string at
// all.
export const ADVISE_DATA_ENDPOINT_ERROR_RESULT: AdviseData = {};

// ── Fixture 8: LIKE-only predicate on the unindexed column, after tune ──
// Query: SELECT ID, UnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture
//        WHERE UnindexedCol LIKE 'ZZZ%'
// Captured 2026-07-11 (after tune — no stale-stats warning). The predicate
// line carries ONLY %PATTERN / %STARTSWITH / NOT NULL operators — none of
// which is an equality/range op. Expect: full-scan fires (a WHERE predicate
// IS present, via NOT NULL) but missing-index does NOT fire (no equality or
// range predicate column to index) + unused-index (IdxIndexedCol never
// referenced). Added in Story 28.2 code review to cover the "predicate
// exists but no equality/range op" missing-index path (QA-flagged gap).
const PLAN_LIKE_PREDICATE_AFTER_TUNE_LINES = [
  '<plans>',
  ' <plan>',
  '   SQL:',
  '    SELECT ID , UnindexedCol FROM ExecuteMCPv2_Tests . AdvisorFixture WHERE UnindexedCol LIKE ? /*#OPTIONS {"DynamicSQL":1} */ /*#OPTIONS {"DynamicSQLTypeList":"1"} */ /*#OPTIONS {"rtpc-utility":1} */ /*#OPTIONS {"rtpc-truth-value":["heCFqw8mm2^1"],"rtpc-range":["2^.00001"]} */',
  '   ',
  '   Info:',
  '   This query plan was selected based on the runtime parameter values that led to:',
  '       Improved selectivity estimation of a %STARTSWITH condition on UnindexedCol.',
  '       Boolean truth value of a NOT NULL condition on arg1.',
  '   ',
  '   Cost: 13000',
  '   ',
  '   Module-FIRST:',
  '     Module-B:',
  '     Read master map ExecuteMCPv2_Tests.AdvisorFixture.IDKEY, looping on ID.',
  '     For each row:',
  '         Test the %PATTERN condition on %SQLUPPER(UnindexedCol), the %STARTSWITH condition on %SQLUPPER(UnindexedCol), and the NOT NULL condition on %SQLUPPER(UnindexedCol).',
  '         Output the row.',
  ' </plan>',
  '</plans>',
];

export const ADVISE_DATA_LIKE_PREDICATE_AFTER_TUNE: AdviseData = {
  plan: PLAN_LIKE_PREDICATE_AFTER_TUNE_LINES.join("\r\n"),
  tables: ADVISOR_FIXTURE_TABLES,
  indexes: ADVISOR_FIXTURE_INDEXES,
};

// ── Fixture 9 (CR 28.0-2, Story 29.3 burn-down): a correlated IN-subquery ──
// Query: SELECT ID FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE UnindexedCol
//        IN (SELECT UnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE
//        IndexedCol = 'I3')
// Captured 2026-07-12 (IRIS for Windows (x86-64) 2026.1, namespace HSCUSTOM).
// CR 28.0-2 asked whether a standalone subquery plan generalizes to the SAME
// temp-file/module vocabulary Story 28.0 pinned for joins/GROUP BY/ORDER BY,
// since it had never been separately captured. Confirmed here: the inner
// subquery drives an index-map read of IdxIndexedCol into a temp-file
// ("Call Module-C once, which populates temp-file A"), then the outer query
// reads that temp-file — the EXACT "Read index map"/"Call Module-X ...
// populates temp-file"/"Read temp-file" vocabulary the engine already
// recognizes (parsePlanIndexes/findTempFileMarkers). No new marker; the
// generalization claim holds.
const PLAN_CORRELATED_SUBQUERY_LINES = [
  '<plans>',
  ' <plan>',
  '   SQL:',
  '    SELECT ID FROM ExecuteMCPv2_Tests . AdvisorFixture WHERE UnindexedCol IN ( SELECT UnindexedCol FROM ExecuteMCPv2_Tests . AdvisorFixture WHERE IndexedCol = ? ) /*#OPTIONS {"DynamicSQL":1} */ /*#OPTIONS {"DynamicSQLTypeList":"1"} */',
  '   ',
  '   Cost: 22389',
  '   ',
  '   Module-FIRST:',
  '     Module-B:',
  '     Read master map ExecuteMCPv2_Tests.AdvisorFixture.IDKEY, looping on ID.',
  '     For each row:',
  '         Test the NOT NULL condition on %SQLUPPER(UnindexedCol).',
  '           Module-D:',
  '           Call Module-C once, which populates temp-file A.',
  '             Module-C:',
  '             Read index map ExecuteMCPv2_Tests.AdvisorFixture.IdxIndexedCol, using the given %SQLUPPER(IndexedCol), and looping on ID.',
  '             For each row:',
  '                 Read master map ExecuteMCPv2_Tests.AdvisorFixture.IDKEY, using the given idkey value.',
  '                 Add a row to temp-file A, subscripted by %SQLUPPER(UnindexedCol) and ID,',
  '                     with no node data.',
  '           Read temp-file A, using the given %SQLUPPER(UnindexedCol), and looping on ID.',
  '           For each row:',
  '               Output the row.',
  ' </plan>',
  '</plans>',
];

export const ADVISE_DATA_CORRELATED_SUBQUERY: AdviseData = {
  plan: PLAN_CORRELATED_SUBQUERY_LINES.join("\r\n"),
  tables: ADVISOR_FIXTURE_TABLES,
  indexes: ADVISOR_FIXTURE_INDEXES,
};
