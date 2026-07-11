# Story 28.0: Advisor Probe Matrix

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **dev-tools engineer building the SQL Performance Advisor**,
I want **every heuristic input (plan-text markers, index/dictionary surfaces, tune-stats surfaces, statement-workload availability) pinned VERBATIM against the live IRIS instance and the binding spec amended with the pinned sources**,
so that **Stories 28.1–28.3 build the `/dev/sql/advise-data` endpoint and the TS heuristic engine against real, version-documented IRIS behavior instead of extrapolated assumptions (Rules #14/#16/#36) — and no downstream story codes against a wrong API shape**.

This is a **MANDATORY live-probe story** (project Rules #14/#16). It produces NO production code and NO bootstrap change — its deliverables are (a) recorded probe findings, (b) an amended spec (`06-sql-performance-advisor.md` §4 + the corrections below), and (c) deleted probe classes. It is the first story of Epic 28 and the de-risking gate for the whole feature.

## Acceptance Criteria

1. **AC 28.0.1 — Plan markers cataloged VERBATIM.** Run the existing `explain` path against the fixture set (see Task 2) on live IRIS and record the EXACT plan-text marker strings for each of: full master-map read (table scan), index map read, temp-file / intermediate build, and subquery/join strategies. These strings become the parser's contract for Story 28.2. **The captured IRIS version is documented alongside** (current live: `IRIS for Windows (x86-64) 2026.1 (Build 235U)` — confirm live and record the exact build string; plan text varies by version — Rule #36).

2. **AC 28.0.2 — Dictionary + tune + workload surfaces pinned.**
   - **Index/dictionary surface:** pin how to enumerate a table's indices and their columns, and the class↔table mapping. The spec proposes `%Dictionary.CompiledIndex` — verify live (via SQL against `%Dictionary.CompiledIndex`/`%Dictionary.CompiledProperty` or object access) that you can list, for a given table, each index's name + the ordered column list (leading-subscript matters for the `missing-index` heuristic). Record the exact query/API.
   - **Tune-stats surface:** pin where TuneTable results live and how to read staleness. Check `%SYS.PTools` / `%SQL.Statement` metadata AND the existing `stats` action's source FIRST (it reads `INFORMATION_SCHEMA.STATEMENTS`) — prefer whatever surface the existing action already reads. Record how to obtain: `ExtentSize` (dictionary extent estimate), per-property selectivity, and last-tune timestamp/values. **Do NOT rely on full `SELECT COUNT(*)` for row counts** (spec §4 `stale-stats`: use the dictionary extent estimate, no full counts).
   - **Statement-workload availability:** pin what "top recent statements" data is actually queryable on this 2026.1 instance for `workload` mode. Re-verify the Epic-17 finding that `INFORMATION_SCHEMA` table names are **underscore-named** (`STATEMENTS`, `CURRENT_STATEMENTS`, `STATEMENT_DAILY_STATS`, `STATEMENT_HOURLY_STATS`, …) and record which view + ordering (`StatTotal`/`StatCount`/`Timestamp`) yields a usable "top-N recent" list — OR record that no usable workload source exists (so Story 28.3 returns a clean capability error, spec §3/AC-6).

3. **AC 28.0.3 — Spec amended + fixture design recorded + probe classes deleted.**
   - Spec `06-sql-performance-advisor.md` §4 heuristics table amended in place with the pinned real sources (which query/marker feeds each of the five findings).
   - The three spec-vs-reality **corrections below (Rule #47)** are recorded in the amended spec:
     - (a) `iris_sql_analyze` has **NO existing ObjectScript handler** — it is TS/SQL-only via the Atelier `action/query` endpoint (settled in `17-0-api-probes.md`). Spec §2 item-2 ("read first … the ObjectScript handler behind `/dev/sql/analyze`") is stale; `/dev/sql/advise-data` (Story 28.1) is the tool family's FIRST OS handler. Correct the spec's "read first" line.
     - (b) The test package convention is **`ExecuteMCPv2.Tests`** (plural), not `ExecuteMCPv2.Test`. The scratch fixture must be named **`ExecuteMCPv2.Tests.AdvisorFixture`** (matching `EnvSyncTest`/`LocFixtureBase`). Correct the spec §5 name.
     - (c) Probe/disposable classes use **`ExecuteMCPv2.Temp.*`** and are deleted at story end (CLAUDE.md testing rules).
   - `ExecuteMCPv2.Tests.AdvisorFixture` scratch-schema **design** recorded (a `%Persistent` class: known columns, ONE index on a chosen column, deliberately left un-tuned so `stale-stats` fires; an unindexed column for the `missing-index` positive case; the indexed column for the negative case). Design only — the fixture is BUILT in Story 28.2 (it seeds the captured-plan fixtures). Do NOT add it to the bootstrap manifest (fixture-only, like `LocFixtureBase`).
   - All `ExecuteMCPv2.Temp.*` probe classes are deleted from IRIS and from disk before story close; NO `.cls` is left added to the repo, NO `BOOTSTRAP_VERSION` change, frozen governance baseline untouched.

## Tasks / Subtasks

- [x] **Task 1 — Live-tool access + IRIS version pin (AC: 28.0.1)**
  - [x] Confirm live IRIS access via the dev MCP profile. Load the deferred MCP tools if needed (ToolSearch: `iris_server_info`, `iris_sql_execute`, `iris_execute_command`, `iris_doc_load`, `iris_execute_tests`, `iris_doc_list`, `iris_doc_delete`). If live IRIS cannot be reached after trying, STOP with `## Clarification Needed` (the lead runs the probe — this whole story is live work).
  - [x] `iris_server_info` → record the exact version/build string (expected `2026.1 (Build 235U)`). This is the "plans captured on" version for Rule #36.
- [x] **Task 2 — Seed a disposable probe schema + capture plan markers (AC: 28.0.1)**
  - [x] Create a disposable probe table (`ExecuteMCPv2.Temp.*` schema, or a scratch SQL table in a probe namespace) with: a column WITH an index, a column WITHOUT an index, and enough rows to make a scan meaningful. (This is the throwaway probe — the durable `AdvisorFixture` is designed in Task 5 and built in 28.2.)
  - [x] Run `EXPLAIN <query>` (via `iris_sql_execute` mirroring the tool's `explain` path — `atelierPath(…, "action/query")` with `query = "EXPLAIN " + sql`) for: (a) a WHERE on the UNindexed column (expect master-map/table scan), (b) a WHERE on the INDEXED column (expect index map read), (c) a query producing a temp-file/intermediate build (e.g. `ORDER BY`/`GROUP BY`/`DISTINCT` on an unindexed column or a join), (d) a 2-table join.
  - [x] Record the EXACT marker strings verbatim (e.g. the literal "Read master map …", "Read index map …", temp-file/subquery phrasings) into the probe-findings doc. These are the Story 28.2 parser contract.
- [x] **Task 3 — Pin the index/dictionary surface (AC: 28.0.2)**
  - [x] Verify live: for a given table, enumerate each index + its ordered columns via `%Dictionary.CompiledIndex` (SQL or object). Record the exact query and the row shape (index name, property/column list, leading subscript). Confirm the class↔table mapping approach.
  - [x] Read the relevant `irislib`/`irissys` class source to confirm method/query existence + ROWSPEC + `[Deprecated]` flags BEFORE trusting (Rules #2/#4/#16).
- [x] **Task 4 — Pin tune-stats + workload surfaces (AC: 28.0.2)**
  - [x] Pin the tune-staleness surface: `ExtentSize` (dictionary extent estimate), per-property selectivity, last-tune info. Record where each lives and the exact read (prefer what the existing `stats` action reads). Confirm the "no full COUNT(*)" estimate path.
  - [x] Re-verify the underscore-named `INFORMATION_SCHEMA` views on 2026.1: `SELECT TOP 1 * FROM INFORMATION_SCHEMA.STATEMENTS` etc. Record which view + ORDER BY gives a usable "top recent statements" list for `workload` mode — or record "no usable source → capability error" for Story 28.3.
- [x] **Task 5 — Amend spec + record fixture design + corrections (AC: 28.0.3)**
  - [x] Amend `06-sql-performance-advisor.md` §4 heuristics table in place with pinned real sources per finding.
  - [x] Record the three Rule #47 corrections (no OS handler; `Tests` plural; `Temp.*` probes) in the amended spec.
  - [x] Record the `ExecuteMCPv2.Tests.AdvisorFixture` scratch-schema DESIGN (columns, the one index, the deliberately-un-tuned state) — design only; built in 28.2.
  - [x] Write the consolidated probe-findings doc (either a dedicated `28-0-probe-findings.md` artifact or a "Probe Findings" section appended to this story's Dev Agent Record) capturing every verbatim marker, query, and version string.
- [x] **Task 6 — Cleanup (AC: 28.0.3)**
  - [x] Delete ALL `ExecuteMCPv2.Temp.*` probe classes from IRIS (`iris_doc_delete`) AND any probe `.cls`/scratch table from disk + IRIS. Confirm no `.cls` was added to the repo, `BOOTSTRAP_VERSION` unchanged (`1e2008753853`), `git status` clean of any `src/ExecuteMCPv2/**` addition.
  - [x] Run `gen:governance-baseline:check` → exit 0 (frozen baseline `1e62c5ad5bf7` untouched — this story adds no governance key).

## Dev Notes

### What this story IS and ISN'T
- **IS:** a live probe. Its outputs are recorded findings + an amended binding spec + deleted probe classes. Treat the probe like a scientific measurement — capture what IRIS *actually* emits, verbatim; do NOT hand-reason expected plan text (Rule #36 is binding for the whole epic and this story sets the ground truth).
- **ISN'T:** production code, a new `.cls` in the repo, a bootstrap change, a governance change, or the `advise` action itself. Those are Stories 28.1–28.3. Building the durable `AdvisorFixture` table is Story 28.2 (this story only DESIGNS it).

### Reuse targets & spec corrections (Rule #47 — verified against source by the story's research pass)
- **`iris_sql_analyze` is TS/SQL-only — NO existing ObjectScript handler.** File: [`packages/iris-dev-mcp/src/tools/sqlAnalyze.ts`](../../packages/iris-dev-mcp/src/tools/sqlAnalyze.ts). All four actions build SQL and POST it through the Atelier query endpoint: `const path = atelierPath(ctx.atelierVersion, ns, "action/query"); await ctx.http.post(path, { query: sql });`. `Dispatch.cls` has NO `/sql` route. The spec's §2 "read first: the ObjectScript handler behind `/dev/sql/analyze`" is **stale/wrong** — record this correction. `/dev/sql/advise-data` (Story 28.1) is this tool family's FIRST OS handler.
- **The four existing actions read:** `explain`/`indexUsage` → `EXPLAIN <query>`; `running` → `INFORMATION_SCHEMA.CURRENT_STATEMENTS`; `stats` → `SELECT Hash, Statement, StatCount, StatTotal, StatAverage, StatStdDev, StatRowCount, Timestamp FROM INFORMATION_SCHEMA.STATEMENTS`. `indexUsage` parses index tokens from plan text client-side (`parsePlanIndexes()` regex over `master map`/`index map`/`bitmap`/`map`). Quote the `mutates` map for continuity: `mutates: { explain: "read", stats: "read", indexUsage: "read", running: "read" }` — Story 28.3 adds `advise: "read"`.
- **Test package is `ExecuteMCPv2.Tests` (plural).** Existing patterns: [`src/ExecuteMCPv2/Tests/EnvSyncTest.cls`](../../src/ExecuteMCPv2/Tests/EnvSyncTest.cls) (a `%UnitTest.TestCase`, no `%OnNew` needed — no custom state), and the fixture-only [`src/ExecuteMCPv2/Tests/LocFixtureBase.cls`](../../src/ExecuteMCPv2/Tests/LocFixtureBase.cls) (deliberately OUT of the bootstrap manifest). The spec's `ExecuteMCPv2.Test.AdvisorFixture` (singular) should be `ExecuteMCPv2.Tests.AdvisorFixture` — record this correction. Fixture classes stay OUT of the bootstrap.
- **Probe classes use `ExecuteMCPv2.Temp.*`** and are deleted at story end (CLAUDE.md IRIS MCP Debugging rules).

### INFORMATION_SCHEMA underscore naming (Epic 17 finding — re-verify live)
Epic 17 probe (`17-0-api-probes.md`) found `INFORMATION_SCHEMA` table names are **underscore-named**: `CURRENT_STATEMENTS` (22 cols), `STATEMENTS` (33 cols), `STATEMENT_DAILY_STATS` (7 cols), `STATEMENT_HOURLY_STATS` (8 cols), `STATEMENT_CHILDREN`, `STATEMENT_LOCATIONS`, etc. The no-underscore names (`CURRENTSTATEMENTS`) return `SQLCODE -30 not found`. This is NOT in the durable rules file — only the Epic-17 artifact. Re-confirm on 2026.1 and pick the workload source from these.

### Live-tool access (ADR-aware)
This story is 100% live IRIS work. The dev MCP profile exposes `iris_server_info`, `iris_sql_execute`, `iris_execute_command`, `iris_doc_load`, `iris_doc_delete`, `iris_doc_list`, `iris_execute_tests`. They are deferred tools — load via ToolSearch (`select:iris_sql_execute,iris_execute_command,...`) if not already available. Always pass the `namespace` param (HSCUSTOM for the primary probe). If, after trying, live IRIS is unreachable from the dev-agent context (MCP inventory may not propagate to a subagent — CLAUDE.md ADR-Aware Execution), STOP with `## Clarification Needed` so the lead runs the probe directly (the lead has reliable session-level MCP access).

### Rule #36 capture discipline (BINDING for the epic)
Every plan-text string recorded here is REFERENCE-CAPTURED from live `EXPLAIN` output — never hand-reasoned. Document the exact capture command and the IRIS version next to each capture. Story 28.2's TS fixtures replay these captured plans; a hand-reasoned marker that happens to match a buggy parser would silently certify the bug (Rule #36).

### Rules #49/#50 as forward review lenses
The Epic 27 retro flagged Rules #49/#50 for any Epic-28 plan-comparison logic. This probe story has no comparison logic itself, but note for Stories 28.2/28.3: the heuristic engine compares plan text against expected markers — Rule #50 (a matching key holds only item-identity dimensions) and Rule #49 (build the oracle from an independent source, not the implementation) apply when that logic lands. Not blocking here; recorded for continuity.

### Bootstrap / baseline invariants (this story changes NONE of them)
- `BOOTSTRAP_VERSION` stays `1e2008753853` (defined [`packages/shared/src/bootstrap-classes.ts:25`](../../packages/shared/src/bootstrap-classes.ts#L25)). Story 28.1 bumps it when it adds the new `.cls` (Rule #24) and must update BOTH the `gen-bootstrap.mjs` `classes[]` array AND the `bootstrap.test.ts` roster + name list + count 27→28 (Rule #39 dual-roster) — recorded here so 28.1 is pre-warned.
- Frozen governance baseline `1e62c5ad5bf7` untouched; `gen:governance-baseline:check` exit 0.

### Project Structure Notes
- Amend in place: [`_bmad-output/planning-artifacts/research/feature-specs/06-sql-performance-advisor.md`](../planning-artifacts/research/feature-specs/06-sql-performance-advisor.md).
- Probe findings: record in this story's Dev Agent Record (and/or a `28-0-probe-findings.md` sibling artifact if lengthy).
- No changes under `packages/**` or `src/ExecuteMCPv2/**` are committed by this story.

### References
- [Source: _bmad-output/planning-artifacts/research/feature-specs/06-sql-performance-advisor.md#2 (Story 0 probe), #3 (tool contract), #4 (heuristics), #5 (fixture discipline), #7 (ACs)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 28.0: Advisor Probe Matrix (AC 28.0.1–3)]
- [Source: _bmad-output/planning-artifacts/research/feature-specs/00-conventions.md#3 (OS handler skeleton), #6 (definition of done)]
- [Source: _bmad-output/implementation-artifacts/17-0-api-probes.md#Area 3 (INFORMATION_SCHEMA underscore finding; iris_sql_analyze TS/SQL-only, no OS handler)]
- [Source: packages/iris-dev-mcp/src/tools/sqlAnalyze.ts (existing action enum, mutates map, Atelier query backend)]
- [Source: src/ExecuteMCPv2/Tests/EnvSyncTest.cls, src/ExecuteMCPv2/Tests/LocFixtureBase.cls (test-class + fixture-only patterns)]
- [Source: scripts/gen-bootstrap.mjs classes[], packages/shared/src/__tests__/bootstrap.test.ts (Rule #39 dual-roster; current 27 classes, BOOTSTRAP_VERSION 1e2008753853)]
- [Source: .claude/rules/project-rules.md#16 (verify spec claims via live probe), #36 (reference-capture), #39 (bootstrap dual-roster), #47 (verify "reuse the existing X"), #49/#50 (comparison-logic lenses)]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story` skill.

### Debug Log References

Live IRIS probe session against server profile `default` (dev MCP), namespace `HSCUSTOM`,
2026-07-11. No debug globals used (no ObjectScript handler code being debugged — this story
produces no production code). All findings below are direct captures from `iris_sql_execute` /
`iris_execute_command` responses.

### Completion Notes List

- Confirmed live IRIS: `IRIS for Windows (x86-64) 2026.1 (Build 235U) Tue Apr 7 2026 16:29:09 EDT`
  (matches the story's expected build) — recorded as the "plans captured on" version (Rule #36).
- Seeded a disposable probe schema `ExecuteMCPv2.Temp.AdvisorProbe` (2000 rows: `IndexedCol`
  [indexed], `UnindexedCol` [not indexed], `JoinKey`) + `ExecuteMCPv2.Temp.AdvisorProbeChild`
  (20 rows) and captured EXACT plan-text markers via `EXPLAIN <query>` for all four required
  categories (full scan, index map read, temp-file/intermediate build, join strategy) — see
  "Probe Findings" below and the amended spec §2 finding 1 for the verbatim strings.
- Verified `%Dictionary.CompiledIndex` (SQL-queryable: `parent`, `Name`, `Properties`,
  `PrimaryKey`, `_Unique`, `Type`, `Data`) as the index/dictionary surface; confirmed
  `Properties` is an order-preserving `Property:Collation` comma-list via a live capture on
  `Ens.Config.Item`'s composite `Name` index (`"Production:Exact,Name:Exact"` — confirms Rule #27's
  leading-subscript order). Confirmed the class↔table mapping via `%Dictionary.CompiledClass`
  (`SqlSchemaName`/`SqlTableName`/`Name`), both directions.
  Read `irislib/%Dictionary/CompiledIndex.cls` (source) before trusting the ROWSPEC/column names
  (Rules #2/#4/#16) — this caught a real mismatch: my first query guessed a `PropertyList` column
  name that does not exist (`SQLCODE -29 Field 'PROPERTYLIST' not found`); the actual property is
  `Properties`.
- **Key correction (spec-vs-reality, Rule #16/#42):** the original spec's `stale-stats` design
  (read `%Dictionary.CompiledStorage.ExtentSize` + `%Dictionary.CompiledStorageProperty.Selectivity`
  for tune staleness) does NOT work on this build — live-verified across four separate checks
  (post-`GatherTableStats`, post-recompile, post-`SetExtentSize`, and a check that
  `CompiledStorageProperty` gains zero rows even after tuning) that these dictionary properties
  are compile-time/declarative only and never reflect live `TuneTable` results. Discovered
  instead that the `EXPLAIN` plan's own `Warning: Table X is not tuned.` line is the real,
  free, zero-extra-call signal (present before tuning, gone after) — this simplifies the
  Story 28.1 data endpoint (no separate tune-metadata payload needed) and is recorded as a
  correction in the amended spec §2 finding 3 / §4 table.
- Re-confirmed the Epic-17 `INFORMATION_SCHEMA` underscore-naming finding still holds on 2026.1
  (`CURRENTSTATEMENTS` → `SQLCODE -30`; `CURRENT_STATEMENTS`/`STATEMENTS` work). Confirmed a
  usable `workload` data source EXISTS on this instance (`ORDER BY Timestamp DESC` for "most
  recent"; `ORDER BY StatTotal DESC` for "heaviest") — no capability-error fallback needed here,
  though Story 28.3 should still code that path defensively for other deployments.
- Amended `06-sql-performance-advisor.md` in place: header "Read first" line (Rule #47
  correction — no OS handler exists), §2 (Story 0 marked DONE with all live findings + the three
  Rule #47 corrections in a dedicated subsection), §3 (Story 1 blurb updated to drop the now-
  unneeded tune-metadata payload), §4 (heuristics table gained a "Pinned source" column + the
  `stale-stats` row corrected to the warning-line approach), §5 (fixture class renamed to
  `ExecuteMCPv2.Tests.AdvisorFixture`, plus the fixture's column/index/un-tuned design recorded
  for Story 28.2 to build).
- Cleanup: both `ExecuteMCPv2.Temp.AdvisorProbe(Child)` classes deleted from IRIS
  (`iris_doc_delete`, confirmed via `iris_doc_list` filter — zero results) and from disk (the
  `src/ExecuteMCPv2/Temp/` directory no longer exists). `git status` confirmed clean of any
  `src/ExecuteMCPv2/**` or `packages/**` addition. `BOOTSTRAP_VERSION` unchanged at
  `1e2008753853` (grep-verified). `pnpm run gen:governance-baseline:check` exited 0 (`141`
  frozen foundation keys / `200` live keys / `59` post-foundation new keys — all pre-existing;
  this story adds none).
- No production code, no tests, no bootstrap change — this story's only durable outputs are the
  amended spec and this Dev Agent Record.

### Probe Findings (verbatim captures — Rule #36)

**IRIS version:** `IRIS for Windows (x86-64) 2026.1 (Build 235U) Tue Apr 7 2026 16:29:09 EDT`
(namespace `HSCUSTOM`).

**Probe schema:** `ExecuteMCPv2.Temp.AdvisorProbe` (2000 rows; `UnindexedCol %String`,
`IndexedCol %String` [`Index IdxIndexedCol On IndexedCol`], `JoinKey %String`) and
`ExecuteMCPv2.Temp.AdvisorProbeChild` (20 rows; `ParentKey %String` [`Index IdxParentKey On
ParentKey`], `ChildVal %String`). Both deleted at story close.

1. **Full scan (WHERE on `UnindexedCol`):**
   `EXPLAIN SELECT ID, UnindexedCol FROM ExecuteMCPv2_Temp.AdvisorProbe WHERE UnindexedCol = 'U7'`
   →
   ```
   Read master map ExecuteMCPv2_Temp.AdvisorProbe.IDKEY, looping on ID.
   For each row:
       Test the = condition on %SQLUPPER(UnindexedCol) and the NOT NULL condition on %SQLUPPER(UnindexedCol).
       Output the row.
   ```

2. **Index map read (WHERE on `IndexedCol`):**
   `EXPLAIN SELECT ID, IndexedCol FROM ExecuteMCPv2_Temp.AdvisorProbe WHERE IndexedCol = 'I7'` →
   ```
   Read index map ExecuteMCPv2_Temp.AdvisorProbe.IdxIndexedCol, using the given %SQLUPPER(IndexedCol), and looping on ID.
   For each row:
       Read master map ExecuteMCPv2_Temp.AdvisorProbe.IDKEY, using the given idkey value.
       Output the row.
   ```

3. **Temp-file / intermediate build (`GROUP BY`/`ORDER BY` on `UnindexedCol`):**
   `EXPLAIN SELECT UnindexedCol, COUNT(*) FROM ExecuteMCPv2_Temp.AdvisorProbe GROUP BY
   UnindexedCol ORDER BY UnindexedCol` →
   ```
   Call Module-B, which populates temp-file A.
     Module-B:
     Read master map ExecuteMCPv2_Temp.AdvisorProbe.IDKEY, looping on ID.
     For each row:
         Add a row to temp-file A, subscripted by %SQLUPPER(UnindexedCol) and ID, with no node data.
   Read temp-file A, looping on %SQLUPPER(UnindexedCol) and ID.
   ```

4. **Join strategy (2-table join, untuned child):**
   `EXPLAIN SELECT p.ID, p.JoinKey, c.ChildVal FROM ExecuteMCPv2_Temp.AdvisorProbe p,
   ExecuteMCPv2_Temp.AdvisorProbeChild c WHERE p.JoinKey = c.ParentKey` →
   ```
   Warning:
   Table ExecuteMCPv2_Temp.AdvisorProbeChild is not tuned.

   Read master map ExecuteMCPv2_Temp.AdvisorProbeChild(C).IDKEY, looping on C.ID.
   For each row:
       Test the NOT NULL condition on %SQLUPPER(ParentKey).
         Call Module-C once, which populates temp-file A.
           Read master map ExecuteMCPv2_Temp.AdvisorProbe(P).IDKEY, looping on P.ID.
           For each row:
               Add a row to temp-file A, subscripted by %SQLUPPER(JoinKey) and P.ID, with node data of P.JoinKey.
         Read temp-file A, using the given %SQLUPPER(JoinKey), and looping on P.ID.
   ```
   (Confirms: no distinct "hash join" marker — joins reuse the temp-file vocabulary from
   finding 3.)

5. **`stale-stats` warning (bonus marker, same `EXPLAIN` call as findings 1/4):** the literal
   `Warning:\nTable ExecuteMCPv2_Temp.AdvisorProbeChild is not tuned.` block, reproduced
   standalone (non-join) too:
   `EXPLAIN SELECT ID, ChildVal FROM ExecuteMCPv2_Temp.AdvisorProbeChild WHERE ChildVal = 'V7'`
   → same `Warning: Table ... is not tuned.` block. After running
   `$SYSTEM.SQL.Stats.Table.GatherTableStats("ExecuteMCPv2_Temp.AdvisorProbe")` (console:
   `EXTENTSIZE: CURRENT = 100,000 → CALCULATED = 2,000`), re-running the join EXPLAIN showed the
   warning naming ONLY `AdvisorProbeChild` (left untuned) — `AdvisorProbe` (tuned) no longer
   triggered it.

6. **Dictionary surface (index + class↔table mapping), live-queried:**
   ```sql
   SELECT parent AS ClassName, Name AS IndexName, Properties AS PropertyList, PrimaryKey,
          "_Unique" AS IsUnique, Type, Data
   FROM %Dictionary.CompiledIndex WHERE parent = 'ExecuteMCPv2.Temp.AdvisorProbe' ORDER BY Name
   ```
   → `IDKEY` (key, `Properties=""`), `IdxIndexedCol` (index, `Properties="IndexedCol"`).
   Composite-index order-preservation confirmed on `Ens.Config.Item`'s `Name` index:
   `Properties = "Production:Exact,Name:Exact"`.
   Class↔table: `SELECT Name FROM %Dictionary.CompiledClass WHERE SqlSchemaName =
   'ExecuteMCPv2_Temp' AND SqlTableName = 'AdvisorProbe'` → `ExecuteMCPv2.Temp.AdvisorProbe`
   (and the reverse: `SELECT SqlSchemaName, SqlTableName FROM %Dictionary.CompiledClass WHERE
   Name = 'ExecuteMCPv2.Temp.AdvisorProbe'` → `ExecuteMCPv2_Temp` / `AdvisorProbe`).

7. **Tune-stats dictionary surface RULED OUT (live-verified non-reflective):**
   `SELECT parent, Name, ExtentSize FROM %Dictionary.CompiledStorage WHERE parent =
   'ExecuteMCPv2.Temp.AdvisorProbe'` → `ExtentSize = "100000"` (the default sentinel) —
   **unchanged** across: (a) before `GatherTableStats`, (b) after `GatherTableStats`
   (console confirmed CALCULATED=2,000), (c) after an explicit `$SYSTEM.OBJ.Compile(...,"ck")`
   recompile, (d) after an explicit `$SYSTEM.SQL.Stats.Table.SetExtentSize("ExecuteMCPv2_Temp",
   "AdvisorProbe", 2000)` call. `%Dictionary.CompiledStorageProperty` returned ZERO rows for
   `parent = 'ExecuteMCPv2.Temp.AdvisorProbe||Default'` both before and after tuning. Also
   confirmed `EXPLAIN SELECT COUNT(*) FROM ExecuteMCPv2_Temp.AdvisorProbe` still walks a full
   index map (`Read index map ...IdxIndexedCol, looping on %SQLUPPER(IndexedCol) and ID. ...
   Accumulate the count(rows).`) — i.e. `COUNT(*)` is O(rows), confirming the spec's original
   "no full COUNT(*)" caution was directionally right (now moot since the warning-line approach
   needs no row-count estimate at all).

8. **Workload / `INFORMATION_SCHEMA` re-verification:**
   `SELECT TOP 1 * FROM INFORMATION_SCHEMA.CURRENTSTATEMENTS` → `SQLCODE -30 Table
   'INFORMATION_SCHEMA.CURRENTSTATEMENTS' not found` (no-underscore form fails, as Epic 17 found).
   `SELECT TOP 3 Hash, Statement, StatCount, StatTotal, StatAverage, StatRowCount, Timestamp FROM
   INFORMATION_SCHEMA.STATEMENTS ORDER BY StatTotal DESC` → 3 rows returned successfully.
   `... ORDER BY Timestamp DESC` → 3 rows, most-recent-first (self-referentially included the
   probe's own just-run statements). `SELECT TOP 1 * FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS`
   → 21 columns, 1 row (a live executing statement). `SELECT TOP 2 * FROM
   INFORMATION_SCHEMA.STATEMENT_DAILY_STATS` → 7 columns, confirms existence (not required for
   v1's simple top-N).

### File List

- `_bmad-output/planning-artifacts/research/feature-specs/06-sql-performance-advisor.md` (amended in place — spec corrections + pinned heuristic sources)
- `_bmad-output/implementation-artifacts/28-0-advisor-probe-matrix.md` (this story file — Dev Agent Record + task checkboxes)

No files added under `src/ExecuteMCPv2/**` or `packages/**` (the disposable
`ExecuteMCPv2.Temp.AdvisorProbe(Child).cls` probe files were created, loaded, probed, and then
deleted from both IRIS and disk within this story — net zero repo change).

## Review Findings

Code review 2026-07-11 (bmad-code-review, Opus). Review target: uncommitted working tree
(spec amendment + this story's Dev Agent Record + QA test summary). **Verdict: probe integrity
CONFIRMED — clean review, 2 LOW forward-hazards deferred to Story 28.2.**

Verification done this pass (not taken on faith):
- **Rule #47 corrections all TRUE against the codebase:** (a) `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts` confirms NO ObjectScript handler — all four actions POST through `atelierPath(…, "action/query")`; the action enum, the `mutates` map, and the quoted `stats` column list all match verbatim. `src/ExecuteMCPv2/REST/Dispatch.cls` has NO `/sql` route (only `/security/sqlprivilege`). (b) The test package is `ExecuteMCPv2.Tests` (plural) — 25 classes under `src/ExecuteMCPv2/Tests/` incl. `EnvSyncTest.cls`/`LocFixtureBase.cls`. (c) `ExecuteMCPv2.Temp.*` probe convention correct; `src/ExecuteMCPv2/Temp/` does not exist.
- **No-drift invariant holds (hard AC 28.0.3):** `git status --short -- src/ packages/` is empty; `BOOTSTRAP_VERSION` unchanged at `1e2008753853`; frozen governance baseline `GOVERNANCE_BASELINE_HASH = "1e62c5ad5bf7"` untouched.
- **Rule #39 forward guidance for 28.1 accurate:** `bootstrap.test.ts` currently asserts `BOOTSTRAP_CLASSES.size === 27` and `classes.length === 27` with a last-element name check (`ExecuteMCPv2.REST.Dispatch.cls`); the `gen-bootstrap.mjs` `classes[]` array holds only REST classes (no test/fixture classes) — so 28.1 must edit both rosters (27→28) and insert the new class before `Dispatch`.
- **Load-bearing findings corroborated live (read-only, no drift):** independent `%Dictionary.CompiledIndex` query on `Ens.Config.Item` returned `Properties="Production:Exact,Name:Exact"` (order-preserving) — exactly as recorded; independent `EXPLAIN SELECT ID, Name FROM Ens_Config.Item WHERE Name='X'` emitted the verbatim `Read master map Ens_Config.Item.IDKEY, looping on ID.` marker plus a top-level `Warning:` block, corroborating both the plan-marker captures and the `Warning:`-block mechanism the `stale-stats` decision relies on. The `stale-stats` pivot (EXPLAIN `Warning: Table X is not tuned.` line replacing the non-reflective `%Dictionary.CompiledStorage.ExtentSize` approach) is documented with four distinct verification angles — the evidence is thick and specific, not hand-reasoned.

Findings:

- [x] [Review][Defer] `parsePlanIndexes()` conflates `temp-file` tokens with real index names — forward hazard for Story 28.2 [packages/iris-dev-mcp/src/tools/sqlAnalyze.ts:114] — deferred, forward-looking (28.0 ships no code)
- [x] [Review][Defer] AC 28.0.1 "subquery/join strategies": a standalone subquery plan was not separately captured (only a 2-table join) [28-0-advisor-probe-matrix.md Probe Findings §4] — deferred, forward-looking (plausibly subsumed by temp-file vocabulary; confirm in 28.2)
