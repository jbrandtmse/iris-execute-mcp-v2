# Spec 06 — SQL Performance Advisor: `iris_sql_analyze` `advise` Action

**Server:** `@iris-mcp/dev` (extends existing tool) | **Priority:** 6 (signature feature) | **Effort:** ~4 stories
**Governance:** new action on existing tool — add `advise: "read"` to `iris_sql_analyze`'s
per-action `mutates` map (its four existing actions are already classified reads, Epic 17). No writes in v1.
**Prereqs:** none | **Read first:** [`00-conventions.md`](00-conventions.md),
`packages/iris-dev-mcp/src/tools/sqlAnalyze.ts` (the existing four actions). **CORRECTION
(Rule #47, Story 28.0 — live-verified 2026-07-11):** there is NO existing ObjectScript handler
behind `/dev/sql/analyze` to read — all four actions build SQL client-side and POST it through
the Atelier `action/query` endpoint (settled in `17-0-api-probes.md` Area 3; `Dispatch.cls` has
no `/sql` route). `/dev/sql/advise-data` (Story 28.1) is this tool family's FIRST OS handler.
Also read: `irislib/%SYSTEM/SQL*.cls`, `irislib/%Dictionary/CompiledIndex.cls` +
`CompiledStorage.cls` + `CompiledClass.cls`, project Rule #36 (reference-parity ground-truth
pinning — this spec's test discipline), Rule #47 (verify "reuse the existing X" claims before
building — this correction is itself an instance)

## 1. Objective

Turn the existing plan/stats primitives into an **advisor**: given a query (or the current
statement workload), return findings with evidence — the market-proven differentiator that
made Postgres MCP Pro the category leader. Strictly advisory: it recommends, cites evidence,
and never applies anything.

## 2. Story 0 — statistics & plan-marker probe (Rules #14/#16) — **DONE (Story 28.0, live-verified 2026-07-11)**

IRIS has **no native index advisor**; the advisor is heuristics over plan text + dictionary +
runtime stats. Captured live against `IRIS for Windows (x86-64) 2026.1 (Build 235U) Tue Apr 7
2026 16:29:09 EDT`, namespace `HSCUSTOM`, via a disposable `ExecuteMCPv2.Temp.AdvisorProbe` /
`AdvisorProbeChild` schema (2000 + 20 rows: one indexed column, one unindexed column, a join
key). All probe classes deleted from IRIS and disk at story close (Rule #14 CLAUDE.md
discipline). Full verbatim capture log lives in `28-0-advisor-probe-matrix.md`'s Dev Agent
Record. Findings:

1. **Plan markers (verbatim, via `EXPLAIN <query>` over `action/query` — the same call the
   existing `explain` action makes):**
   - **Full scan (master-map read):** `Read master map <Schema>.<Table>.IDKEY, looping on ID.`
   - **Index map read:** `Read index map <Schema>.<Table>.<IndexName>, using the given
     %SQLUPPER(<Col>), and looping on ID.` (followed by a master-map idkey lookup line — that's
     the normal covering-lookup step, not itself a scan marker).
   - **Temp-file / intermediate build** (`GROUP BY`/`ORDER BY` on an unindexed column):
     `Call Module-B, which populates temp-file A.` … `Read temp-file A, looping on
     %SQLUPPER(<Col>) and ID.`
   - **Join strategy** (2-table join, untuned child table): the join build reuses the SAME
     temp-file vocabulary (`Call Module-C once, which populates temp-file A.` … `Read temp-file
     A, using the given %SQLUPPER(<JoinKey>), and looping on P.ID.`) — IRIS has **no distinct
     "hash join" marker text**; joins and `GROUP BY`/`ORDER BY` share the temp-file phrasing. The
     `plan-anomaly` heuristic should treat "temp-file present" generically, not assume it implies
     a join.
   - **BONUS marker — `stale-stats`, free on the SAME `EXPLAIN` call:** a top-level
     `Warning:\nTable <Schema>.<Table> is not tuned.` block appears in the `<plan>` XML whenever
     ANY table referenced by the statement has never been tuned. This is dramatically simpler
     than the dictionary-based approach originally proposed in §4 (see finding 3) and needs no
     separate call.
2. **Index/dictionary surface — `%Dictionary.CompiledIndex` CONFIRMED (SQL-queryable):**
   ```sql
   SELECT parent AS ClassName, Name AS IndexName, Properties AS PropertyList,
          PrimaryKey, "_Unique" AS IsUnique, Type, Data
   FROM %Dictionary.CompiledIndex WHERE parent = ? ORDER BY Name
   ```
   - `parent` is the DOT-form class name (`ExecuteMCPv2.Temp.AdvisorProbe`), not the SQL table
     name — resolve via `%Dictionary.CompiledClass` (below).
   - `Properties` is a comma-separated, **order-preserving** `Property:Collation` list — live
     capture on `Ens.Config.Item`'s `Name` index: `"Production:Exact,Name:Exact"` (confirms the
     Rule #27 composite-index leading-subscript order `Production` then `Name`). This is the
     correct source for `missing-index`'s "leading subscript" check — split on `,`, strip the
     `:Collation` suffix per entry, in order.
   - `Data` lists non-key columns physically stored in the index (covering columns) — relevant
     for a future covering-index refinement, not required for v1.
   - **Class↔table mapping (CONFIRMED, both directions):**
     ```sql
     -- table name -> class name (advisor's usual direction: a plan/caller names a SQL table)
     SELECT Name FROM %Dictionary.CompiledClass WHERE SqlSchemaName = ? AND SqlTableName = ?
     -- class name -> table name (for constructing suggestedDdl)
     SELECT SqlSchemaName, SqlTableName FROM %Dictionary.CompiledClass WHERE Name = ?
     ```
3. **Tune-stats surface — CORRECTION (original §4 `stale-stats` row was WRONG; verified live):**
   `%Dictionary.CompiledStorage.ExtentSize` and `%Dictionary.CompiledStorageProperty.Selectivity`
   do **NOT** reflect live `TuneTable` results on this build. Live sequence: seeded 2000 rows →
   ran `$SYSTEM.SQL.Stats.Table.GatherTableStats("ExecuteMCPv2_Temp.AdvisorProbe")` (console
   confirmed `EXTENTSIZE: CURRENT = 100,000 → CALCULATED = 2,000`) → re-queried
   `%Dictionary.CompiledStorage.ExtentSize` for the SAME class → still `"100000"` (the untuned
   default sentinel) — even after an explicit `$SYSTEM.OBJ.Compile(...,"ck")` recompile, and even
   after calling `$SYSTEM.SQL.Stats.Table.SetExtentSize(...)` directly. `CompiledStorageProperty`
   never gained a row for the tuned table at all (0 rows both before AND after tuning). **These
   dictionary properties are declarative/compile-time only** (populated only by a hand-authored
   `EXTENTSIZE = n` keyword in a class's Storage XData source) — they are NOT a live tune-state
   surface on IRIS 2026.1.
   **The real, verified, zero-extra-call surface is the `EXPLAIN` plan's own `Warning: Table X is
   not tuned.` line (finding 1).** It disappears the moment `GatherTableStats` runs for that
   table (confirmed: `AdvisorProbe` dropped the warning after tuning; `AdvisorProbeChild`, left
   untuned, kept showing it — including in standalone, non-join queries).
   **Decision: `stale-stats` is driven ENTIRELY by this warning line**, sourced from the SAME
   `EXPLAIN` call already made for the plan-marker parse (finding 1) — no `%Dictionary`
   round-trip, no `SELECT COUNT(*)` (confirmed live: even `COUNT(*)` walks a full index/map —
   `EXPLAIN SELECT COUNT(*) FROM ...` plan reads `Read index map ...IdxIndexedCol, looping on
   %SQLUPPER(IndexedCol) and ID. ... Accumulate the count(rows).` — O(rows), not O(1); the
   original spec's "no full COUNT(*)" caution was directionally correct and is now moot once the
   warning-line approach is used).
   `%SYS.PTools.Stats` (also named in the original §2 item 3) is a DIFFERENT facility — manual
   Start/Stop code-block instrumentation, not table-tune metadata — ruled out.
4. **Statement-workload surface — RE-CONFIRMED (Epic 17 finding holds on 2026.1):**
   `INFORMATION_SCHEMA` table names are underscore-named; re-verified live:
   `SELECT TOP 1 * FROM INFORMATION_SCHEMA.CURRENTSTATEMENTS` → `SQLCODE -30 Table ... not
   found`; `INFORMATION_SCHEMA.CURRENT_STATEMENTS` (21 cols observed this session) and
   `INFORMATION_SCHEMA.STATEMENTS` (`Hash, Statement, StatCount, StatTotal, StatAverage,
   StatStdDev, StatRowCount, Timestamp` per the existing `stats` action) both work live.
   **Usable "top-N recent" orderings, both confirmed live:**
   - `ORDER BY Timestamp DESC` — true "most recently executed/prepared" (best matches
     `workload` mode's "recent" framing — **chosen default**).
   - `ORDER BY StatTotal DESC` — "heaviest cumulative cost" (a "worst offenders" framing).
   `STATEMENT_DAILY_STATS`/`STATEMENT_HOURLY_STATS` also exist (underscore-named, 7/8 cols) but
   are not needed for v1's simple top-N. **A usable workload source DOES exist on 2026.1 — no
   capability-error fallback is needed for `workload` mode on this instance** (Story 28.3 should
   still code the capability-error path defensively for other deployments/editions, per the
   original spec's caution, but it is not expected to trigger here).
5. Deliverable: this amended §4 heuristics table with pinned sources; probe classes deleted
   (confirmed: `git status` clean of any `src/ExecuteMCPv2/**` addition, `BOOTSTRAP_VERSION`
   unchanged, `gen:governance-baseline:check` exit 0).

### Rule #47 corrections (recorded per AC 28.0.3)
1. **No existing OS handler for `iris_sql_analyze`.** All four actions
   (`packages/iris-dev-mcp/src/tools/sqlAnalyze.ts`) build SQL and POST through
   `atelierPath(ctx.atelierVersion, ns, "action/query")`. `Dispatch.cls` has no `/sql` route.
   `/dev/sql/advise-data` (Story 28.1) is this tool family's FIRST ObjectScript handler — the
   header's former "read first: the ObjectScript handler behind `/dev/sql/analyze`" line is
   corrected above.
2. **Test package is `ExecuteMCPv2.Tests` (plural), not `ExecuteMCPv2.Test`.** §5's fixture name
   is corrected below to `ExecuteMCPv2.Tests.AdvisorFixture`.
3. **Probe/disposable classes use `ExecuteMCPv2.Temp.*`** (this story's `AdvisorProbe` /
   `AdvisorProbeChild`) and are deleted at story close — never committed (CLAUDE.md IRIS MCP
   Debugging rules).

## 3. Tool contract (delta to existing `iris_sql_analyze`)

New action `advise`:

| Param | Type | Notes |
|---|---|---|
| `action` | `"advise"` (added to enum) | |
| `query` | `string?` | The SQL to advise on. Mutually exclusive with `workload` |
| `workload` | `boolean?` | Advise on top recent statements instead of one query (availability per Story-0 finding; if unavailable on the platform, return a clear capability error) |
| `topN` | `number?` default 5, max 20 | Workload mode: how many statements to analyze. **This caps analysis breadth, which IS scan work — document per Rule #38** |
| `namespace` | existing param | |

**Output (`structuredContent`):**
```json
{ "mode": "query" | "workload",
  "findings": [ {
    "type": "full-scan" | "missing-index" | "stale-stats" | "unused-index" | "plan-anomaly",
    "confidence": "high" | "medium" | "low",
    "statement": "<the SQL>",
    "evidence": "Plan shows 'Read master map ...' over table X with WHERE on col Y; no index on Y (checked %Dictionary).",
    "recommendation": "Consider: CREATE INDEX YIdx ON TableX (Y). Verify with EXPLAIN after creation.",
    "suggestedDdl": "CREATE INDEX ...", // only for missing-index, else omitted
    "planExcerpt": "<relevant plan lines>" } ],
  "analyzed": { "statements": 1, "skipped": 0 } }
```

Text content: findings ranked by confidence, evidence-first. When no findings: say so
explicitly with what WAS checked (no silent empty).

## 4. Heuristics (pinned per Story 28.0 live probe — 2026-07-11)

| Finding | Trigger | Evidence requirements | Pinned source (Story 28.0) |
|---|---|---|---|
| `full-scan` | Plan contains the master-map-read marker `Read master map <Schema>.<Table>.IDKEY, looping on ID.` AND the statement has a WHERE/JOIN predicate | Plan excerpt + table name | `EXPLAIN <query>` via `action/query` (same call the existing `explain` action makes) |
| `missing-index` | `full-scan` fired AND ≥1 equality/range predicate column has no index containing it as leading subscript | Predicate column(s), existing-index list consulted, suggested DDL. Confidence `high` only for single-column equality; `medium` otherwise. **Never suggest for system classes (`%*`, `INFORMATION_SCHEMA`)** | `%Dictionary.CompiledIndex` (`parent`/`Name`/`Properties`/`Data`) for the index+column list, ordered by the `Properties` comma-list per entry; `%Dictionary.CompiledClass` (`SqlSchemaName`/`SqlTableName`/`Name`) for the table↔class mapping |
| `stale-stats` | The `EXPLAIN` plan's own `Warning:\nTable <Schema>.<Table> is not tuned.` line is present for a table the statement references | The verbatim warning line as evidence; no separate dictionary read or `COUNT(*)` (both ruled out — see §2 finding 3) | Same `EXPLAIN <query>` call as `full-scan`/`missing-index` — parse the top-level `Warning:` block, not a second endpoint call |
| `unused-index` | Reuse the existing `indexUsage` action's data: index with zero usage over its observation window on a table the workload touches | Usage counts; confidence `low` (observation windows lie) | `indexUsage`'s existing `parsePlanIndexes()` output (`packages/iris-dev-mcp/src/tools/sqlAnalyze.ts`) — unchanged, reused as-is |
| `plan-anomaly` | Temp-file/intermediate markers (`Call Module-B, which populates temp-file A.` / `Read temp-file A, ...`) on simple-looking statements — **note:** the temp-file vocabulary is shared by `GROUP BY`/`ORDER BY` AND joins (no distinct join marker exists — §2 finding 1); do not assume "temp-file present" implies a join | Plan excerpt; confidence `low` | Same `EXPLAIN <query>` call |

**Split confirmed (Story 28.0 did not change this design, only pinned its data sources):**
ObjectScript returns raw materials via one new consolidated route `POST /dev/sql/advise-data`
(plan text from the same `EXPLAIN` call used today, `%Dictionary.CompiledIndex` +
`%Dictionary.CompiledClass` rows for the target table(s) — **no separate tune-metadata payload
is needed**, since `stale-stats` is read directly off the plan's `Warning:` block); the heuristic
engine lives in TypeScript (testable with reference-captured fixture JSON, no bootstrap bump per
heuristic tweak).

## 5. Fixture & test discipline (Rule #36 — non-negotiable)

**CORRECTION (Rule #47, Story 28.0):** the fixture class is `ExecuteMCPv2.Tests.AdvisorFixture`
(package is plural `Tests`, matching `EnvSyncTest.cls`/`LocFixtureBase.cls` — NOT the singular
`ExecuteMCPv2.Test.AdvisorFixture` originally written here). It is a **fixture-only** class (like
`LocFixtureBase`) — it stays OUT of the bootstrap manifest.

**Design (recorded by Story 28.0; BUILT in Story 28.2 — Story 28.0 does not create it):**
a `%Persistent` class with:
- One column WITH an index (the negative case for `missing-index` — a WHERE on this column
  must yield NO finding).
- One column WITHOUT an index (the positive case for `missing-index` — a WHERE on this column
  must yield a `full-scan` + `missing-index` finding with a correct suggested `CREATE INDEX` DDL).
- Enough seeded rows that the plan/cost output is meaningful (Story 28.0's disposable probe used
  2000 rows on the equivalent shape — `ExecuteMCPv2.Temp.AdvisorProbe`/`AdvisorProbeChild`,
  deleted at story close).
- Deliberately left **un-tuned** at fixture-creation time so `stale-stats` fires (per §4, this
  is read straight off the `EXPLAIN` plan's `Warning: Table X is not tuned.` line — Story 28.2's
  fixture tests should capture BOTH the before-tune (warning present) and after-tune (warning
  absent, via `$SYSTEM.SQL.Stats.Table.GatherTableStats(...)`) plan text as separate
  reference-captured fixtures).

Fixture queries need KNOWN correct advice (missing index on the unindexed column; no finding on
the indexed lookup; stale stats before `TuneTable`, clean after). **Capture the actual plan text
from the live instance into TS test fixtures** — expected values must be reference-captured,
never hand-reasoned (Rule #36). The TS heuristic tests replay captured plans; the ObjectScript
tests verify the data endpoint shape. Document the IRIS version the plans were captured on
(**Story 28.0 captured on** `IRIS for Windows (x86-64) 2026.1 (Build 235U) Tue Apr 7 2026
16:29:09 EDT` — plan text varies by version; the parser must treat unrecognized plans as
`no findings + "plan format not recognized"`, never crash or guess).

## 6. Story breakdown

1. **Story 0 — probe (1):** §2. Amend spec.
2. **Story 1 — data endpoint (1):** `/dev/sql/advise-data` ObjectScript (plan text + index
   dictionary rows in one response — tune-staleness is read off the plan's own `Warning:` block,
   §2 finding 3, so no separate tune-metadata payload is needed) + unit tests + deploy/bootstrap.
3. **Story 2 — heuristic engine (1):** TS engine + captured-fixture tests (every heuristic:
   fires-when-should + does-NOT-fire-when-shouldn't) + graceful unknown-plan handling.
4. **Story 3 — tool surface + docs + smokes (1):** `advise` action wiring + `mutates` map
   update + governance test (new read enabled by default, Rule #28) + docs rollup (advisory
   disclaimer: "recommendations are heuristic; verify with explain before applying") + live
   smokes: fixture-table advise on HSCUSTOM AND a second namespace (Rule #34); workload mode
   (or its capability error) live.

## 7. Acceptance criteria

1. On the fixture set: `missing-index` fires with correct suggested DDL on the seeded case;
   NO finding on the properly-indexed case; `stale-stats` fires before tune and clears after.
   All expected values reference-captured (Rule #36) — cite the capture command in test comments.
2. Unrecognized plan text → `findings: []` + explicit "not recognized" note (fuzz with garbage).
3. Every finding carries evidence + plan excerpt; zero findings without citations.
4. No recommendations against `%*`/system schemas.
5. `advise` classified read + enabled by default; existing four actions' behavior byte-for-byte
   unchanged (snapshot test on their outputs — Rule #19).
6. Workload mode works on the live platform or fails with a clear capability message
   (per Story-0 finding) — never a raw error.
7. Docs rollup complete incl. the advisory disclaimer; conventions §6 checklist complete.

## 8. Out of scope (v1)

- `applyIndex` write action (future story; would be `write`, default-disabled).
- Cost-based ranking across findings; historical trend analysis.
- Frozen-plan management, parallel-query tuning, sharding advice.
