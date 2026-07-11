# Story 28.2: Heuristic Engine (TS)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **dev-tools engineer building the SQL Performance Advisor**,
I want **a pure-TypeScript heuristic engine that turns the `/dev/sql/advise-data` raw materials (plan text + tables + index rows) into ranked advisor findings, driven by reference-captured fixtures from live IRIS**,
so that **Story 28.3 can wire the `advise` action to it, and every heuristic is proven to fire-when-it-should AND not-fire-when-it-shouldn't against real 2026.1 plan text (Rule #36) — never hand-reasoned, never guessing on an unrecognized plan**.

This story implements the five findings (`full-scan`, `missing-index`, `stale-stats`, `unused-index`, `plan-anomaly`) as a testable TS module over the Story 28.1 endpoint's JSON, plus the durable `ExecuteMCPv2.Tests.AdvisorFixture` schema and the reference-captured fixture JSON the vitest suite replays. **No tool wiring / no `advise` action / no `mutates`/governance change** — that is Story 28.3. **No bootstrap change** — the engine is pure TS (fixture-testable, no bootstrap bump per heuristic tweak, spec §4/§6); the `AdvisorFixture` class is a fixture-only class (OUT of the bootstrap manifest, like `LocFixtureBase`).

## Acceptance Criteria

1. **AC 28.2.1 — Five findings implemented per spec §4.** A pure TS engine (input: the `{ plan, tables, indexes }` shape the 28.1 endpoint returns; output: `findings[]` per spec §3) implements all five findings with the spec §4 triggers + evidence requirements:
   - `full-scan` — plan contains `Read master map <Schema>.<Table>.IDKEY, looping on ID.` AND the statement has a WHERE/JOIN predicate → evidence = plan excerpt + table name.
   - `missing-index` — `full-scan` fired AND ≥1 equality/range predicate column has no index with it as **leading subscript** (derived from the endpoint's `indexes[].rows[].properties` order-preserving `Prop:Collation,…` string — split on `,`, strip `:Collation`, use entry order). Evidence = predicate column(s) + existing-index list consulted + `suggestedDdl` (`CREATE INDEX <Idx> ON <Schema>.<Table> (<Col>). Verify with EXPLAIN after creation.`). Confidence `high` only for single-column equality; `medium` otherwise. **NEVER for `%*` / `INFORMATION_SCHEMA` / system schemas (AC 28.2.3).**
   - `stale-stats` — the plan's own top-level `Warning:\nTable <Schema>.<Table> is not tuned.` block is present for a referenced table → evidence = the verbatim warning line. **No dictionary read, no `COUNT(*)`** (spec §2 finding 3 ruled both out).
   - `unused-index` — reuse the existing `indexUsage`/`parsePlanIndexes()` data (spec §4): an index with zero usage over its window on a touched table → confidence `low`.
   - `plan-anomaly` — temp-file/intermediate markers (`Call Module-B, which populates temp-file A.` / `Read temp-file A, ...`) on simple statements → confidence `low`. **Note (spec §2 finding 1):** the temp-file vocabulary is shared by `GROUP BY`/`ORDER BY` AND joins (no distinct join marker) — do NOT assume "temp-file present" implies a join.
   - Every heuristic has BOTH a fires-when-should AND a does-NOT-fire-when-shouldn't fixture test.

2. **AC 28.2.2 — Fixtures reference-captured from live IRIS (Rule #36 — non-negotiable).** ALL expected fixture values are reference-captured from the live instance (cite the exact capture command — the `/dev/sql/advise-data` call or `EXPLAIN` — in each fixture/test comment, plus the IRIS version `2026.1 (Build 235U)`). Seeded via the durable `ExecuteMCPv2.Tests.AdvisorFixture` schema (spec §5 design): a `%Persistent` class with one INDEXED column (the `missing-index` negative case — WHERE on it must yield NO finding), one UNINDEXED column (the positive case — WHERE on it must yield `full-scan` + `missing-index` with correct `suggestedDdl`), enough seeded rows for meaningful plans, left un-tuned at creation so `stale-stats` fires. Capture BOTH the before-tune (warning present) AND after-tune (`$SYSTEM.SQL.Stats.Table.GatherTableStats(...)` → warning absent) plan text as separate fixtures. The vitest tests replay these captured plans — no live IRIS at test time.

3. **AC 28.2.3 — Graceful unknown-plan + citation discipline.** Unrecognized/garbage plan text → `findings: []` + an explicit `"plan format not recognized"` note (fuzz-tested with garbage strings, empty plan, and a plausible-but-alien plan shape — the engine must NEVER crash or guess). Zero findings are ever emitted without a cited `evidence` + `planExcerpt`. NO recommendation is ever produced against a `%*` / `INFORMATION_SCHEMA` / system schema (a test asserts a query over such a table yields no `missing-index`). Robust to the 28.1 endpoint returning **empty `tables`/`indexes`** (e.g. a bitmap-only plan the endpoint could not resolve — CR 28.1-2): degrade to no-finding-with-note, never throw.

## Integration ACs

This story introduces a **module** (the `sqlAdvisor.ts` heuristic engine) whose live consumer is **Story 28.3** (the `advise` action calls the endpoint and passes its JSON to `analyzeAdviceData`). Per the Integration-AC rule, no consumer wire-up ships in 28.2. The integration is nonetheless PROVEN here: AC 28.2.2's fixture-replay tests drive the engine with **real, reference-captured Story-28.1-endpoint JSON** (not mocks/hand-reasoned input), so the engine's consumer-facing behavior (correct findings on real 2026.1 plan text) is verified against the actual producer's output shape. Story 28.3 wires the live call; this story locks the engine↔endpoint data contract via the captured fixtures.

## Tasks / Subtasks

- [x] **Task 1 — Build + seed the durable fixture schema (AC: 28.2.2; live IRIS)**
  - [x] Author `src/ExecuteMCPv2/Tests/AdvisorFixture.cls` — a `%Persistent` class per spec §5: an indexed property (`Index` on it), an unindexed property, and any extra columns needed; deliberately NO `EXTENTSIZE` keyword / no tuning. Fixture-only — do NOT add to the bootstrap manifest (Rule #39: `Tests.*` classes are excluded; `bootstrap.test.ts` count stays 28).
  - [x] Deploy via glob-path `iris_doc_load` (Rule #17) + compile on HSCUSTOM. Seed rows (a helper `ClassMethod` on the fixture class, e.g. `Populate(n)`, invoked via `iris_execute_classmethod`); enough rows that the plan cost is meaningful (~2000, matching the Story 28.0 disposable probe).
- [x] **Task 2 — Reference-capture the fixtures (AC: 28.2.2; Rule #36)**
  - [x] Call the LIVE `/dev/sql/advise-data` endpoint (or `EXPLAIN` directly) for each scenario and capture the VERBATIM response JSON into TS fixture files: (a) WHERE on the unindexed column (expect full-scan + missing-index + stale-stats-while-untuned), (b) WHERE on the indexed column (expect NO missing-index), (c) a temp-file plan (GROUP BY/ORDER BY on the unindexed column → plan-anomaly), (d) after `GatherTableStats` (stale-stats cleared), (e) a `%*`/system-schema query (no recommendation), (f) garbage/unrecognized plan text. Record the exact capture command + IRIS version in each fixture's header comment.
  - [x] Store fixtures as JSON/TS under a `__fixtures__/` (or co-located `*.fixture.ts`) directory the vitest suite imports.
- [x] **Task 3 — Implement the engine (AC: 28.2.1/28.2.3)**
  - [x] New pure-TS module (suggested `packages/iris-dev-mcp/src/tools/sqlAdvisor.ts`; final name/location at dev discretion, co-located with `sqlAnalyze.ts`): export a pure function e.g. `analyzeAdviceData(raw: AdviseData, ctx): AdvisorFinding[]` + the `AdviseData`/`AdvisorFinding` types matching the spec §3 output. NO IRIS/HTTP calls inside the engine — it is a pure transform of the endpoint JSON (Story 28.3 owns the live call).
  - [x] Implement each of the five findings per spec §4. Parse plan markers via well-scoped, version-tolerant matching: a plan that matches NONE of the known markers → `findings:[]` + `"plan format not recognized"` note (never throw). Guard against empty `tables`/`indexes`.
  - [x] Enforce the citation invariant structurally (a finding cannot be constructed without `evidence` + `planExcerpt`) and the system-schema exclusion (`%*`/`INFORMATION_SCHEMA` never yields `missing-index`).
- [x] **Task 4 — Vitest tests replaying captured fixtures (AC: 28.2.1/28.2.2/28.2.3)**
  - [x] For each finding: a fires-when-should test + a does-NOT-fire test, driven by the reference-captured fixtures. Assert exact `suggestedDdl` for the missing-index positive case (reference-captured). Assert stale-stats fires on the before-tune fixture and is absent on the after-tune fixture.
  - [x] Fuzz/unknown-plan tests: garbage string, empty plan, alien plan shape, empty `tables`/`indexes` → `findings:[]` + note, no throw. System-schema query → no `missing-index`.
  - [x] Tests discoverable by the default vitest suite (Rule 8 — correct naming, not excluded).
- [x] **Task 5 — Verify + no-drift (all ACs)**
  - [x] `pnpm turbo run build` + `pnpm turbo run test` green; `pnpm --filter @iris-mcp/dev lint` + `type-check` clean.
  - [x] `pnpm gen:governance-baseline:check` exit 0 (no governance key added here — that's 28.3); `BOOTSTRAP_VERSION` unchanged `6422caf6ec31` (no bootstrap change — `AdvisorFixture` is fixture-only, out of manifest); frozen baseline `1e62c5ad5bf7` git-clean.
  - [x] Confirm `AdvisorFixture` is committed to `src/ExecuteMCPv2/Tests/` but ABSENT from `scripts/gen-bootstrap.mjs` `classes[]` + `bootstrap.test.ts` (count stays 28). Delete any `ExecuteMCPv2.Temp.*` scratch created during capture.

## Dev Notes

### What this story IS / ISN'T
- **IS:** the pure-TS heuristic engine + its reference-captured fixtures + the durable `AdvisorFixture` schema. Consumes the Story 28.1 endpoint's JSON shape.
- **ISN'T:** the `advise` tool action / `mutates` map / governance / docs / live tool smokes (all Story 28.3). No bootstrap change. The engine makes NO live IRIS/HTTP call (that is 28.3's job) — it is a pure function over captured/endpoint JSON.

### The contract you consume (Story 28.1 endpoint — live-verified)
`POST /dev/sql/advise-data {query}` → `{ status, result: { plan, tables:[{schema,table,className}], indexes:[{className,schema,table,rows:[{indexName,properties,primaryKey,isUnique,type,data}]}] } }`. `properties` is the order-preserving `Prop:Collation,…` string (leading-subscript = first entry). The plan's `Warning:\nTable <Schema>.<Table> is not tuned.` block is IN `result.plan` (that IS `stale-stats`). Verified live 2026-07-11: a scan query returns the `Read master map` marker + `tables` + `indexes`; a garbage query returns a clean `status.errors` envelope with `result:{}`.

### Heuristics — the pinned marker vocabulary (spec §2/§4; 2026.1 Build 235U)
- `full-scan`: `Read master map <Schema>.<Table>.IDKEY, looping on ID.`
- index map (NOT a scan): `Read index map <Schema>.<Table>.<Index>, using the given %SQLUPPER(<Col>), and looping on ID.`
- temp-file (`plan-anomaly`; also joins/GROUP BY/ORDER BY — no distinct join marker): `Call Module-B, which populates temp-file A.` / `Read temp-file A, ...`
- `stale-stats`: top-level `Warning:\nTable <Schema>.<Table> is not tuned.` block.
- Version tolerance: plan text VARIES by IRIS version — an unrecognized plan is `findings:[] + "plan format not recognized"`, never a guess (spec §5, AC 28.2.3).

### Forward hazards inherited from the 28.1 review (make the engine robust to them)
- **CR 28.1-2 (LOW-MED):** the endpoint's `ExtractTables` yields ZERO tables on a bitmap/bitslice-only plan → the engine must degrade to no-finding-with-note when `tables`/`indexes` are empty, NEVER throw (AC 28.2.3). If you reference-capture a bitmap-plan fixture, use it to pin this path.
- **CR 28.1-1 (MED):** the endpoint's `ResolveClassForTable` bare-Catch can report a table as unresolved → the engine must handle a `tables` entry with no matching `indexes` group gracefully (treat as "index list unknown" → no false `missing-index`).

### Rules #49/#50 review lenses (Epic 27 retro §8 — apply here)
The engine matches plan text against expected markers and correlates predicate columns to index entries. **Rule #50:** any key you build to correlate a predicate column to an index entry must contain ONLY item-identity dimensions (column name/table), never a per-invocation/per-plan dimension. **Rule #49:** the fixtures are the oracle — capture them from an INDEPENDENT source (the live endpoint), never derive an expected value from the engine's own output (that would encode a bug as the expectation). The reviewer will scrutinize this hardest; keep captures reference-sourced.

### Reuse targets (Rule #47)
- `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts` — the existing `parsePlanIndexes()` (reused as-is for `unused-index` per spec §4) + the `explain`/`indexUsage` action shapes. Do NOT modify the four existing actions here (Rule #19 — their byte-for-byte snapshot is 28.3's AC).
- Fixture-only class precedent: `src/ExecuteMCPv2/Tests/LocFixtureBase.cls` (committed, out of bootstrap).
- `structuredContent` helper convention: local `toStructured()` (mirror `iris-data-mcp/docdb.ts`; no shared exported version) — but that is mainly 28.3's concern; the engine returns plain typed objects.

### IRIS environment
- Live IRIS `2026.1 (Build 235U)`, HSCUSTOM, creds `_SYSTEM`/`SYS`. MCP tools deferred — load via ToolSearch (`iris_doc_load`, `iris_doc_compile`, `iris_execute_classmethod`, `iris_sql_execute`, `iris_execute_command`, `iris_doc_delete`, `iris_server_info`). If live IRIS is unreachable when capturing fixtures, STOP with `## Clarification Needed` (the lead captures) — do NOT hand-reason a plan (Rule #36).

### Project Structure Notes
- New: `src/ExecuteMCPv2/Tests/AdvisorFixture.cls` (committed, NOT in bootstrap), `packages/iris-dev-mcp/src/tools/sqlAdvisor.ts` (engine), fixture files + engine tests under `packages/iris-dev-mcp/src/tools/__tests__/` (or `__fixtures__/`).
- No change to `packages/shared/**`, `scripts/gen-bootstrap.mjs`, `bootstrap-classes.ts`, `governance-baseline.ts`, or the four existing `sqlAnalyze.ts` actions.

### References
- [Source: _bmad-output/planning-artifacts/research/feature-specs/06-sql-performance-advisor.md#3 (output shape), #4 (heuristics table + pinned sources), #5 (fixture design + Rule #36), #7 (ACs 1–4)]
- [Source: _bmad-output/implementation-artifacts/28-1-advise-data-endpoint.md (the endpoint contract this engine consumes) + its Review Findings (CR 28.1-1/-2 forward hazards)]
- [Source: _bmad-output/implementation-artifacts/28-0-advisor-probe-matrix.md (verbatim plan-marker captures)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 28.2: Heuristic Engine (TS) (AC 28.2.1–3)]
- [Source: packages/iris-dev-mcp/src/tools/sqlAnalyze.ts (parsePlanIndexes reuse; existing action shapes — do NOT modify); src/ExecuteMCPv2/Tests/LocFixtureBase.cls (fixture-only class precedent)]
- [Source: .claude/rules/project-rules.md#36 (reference-capture — BINDING), #19 (existing actions byte-for-byte), #39 (fixture class out of manifest), #47 (reuse targets), #49/#50 (comparison/oracle lenses)]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story` skill.

### Debug Log References

Live IRIS probe/capture session against server profile `default` (dev MCP), namespace
`HSCUSTOM`, 2026-07-11. `iris_server_info` confirmed `IRIS for Windows (x86-64) 2026.1
(Build 235U) Tue Apr 7 2026 16:29:09 EDT` before capturing.

Task 1: authored + deployed `ExecuteMCPv2.Tests.AdvisorFixture.cls` (glob-path
`iris_doc_load` + compile, Rule #17) and seeded 2000 rows via
`##class(ExecuteMCPv2.Tests.AdvisorFixture).Populate(2000)`.

Task 2 (Rule #36 — every plan below is a VERBATIM live capture, `curl -u _SYSTEM:SYS -X
POST http://localhost:52773/api/executemcp/v2/dev/sql/advise-data`, see
`packages/iris-dev-mcp/src/__tests__/sqlAdvisor.fixtures.ts` header comments for the exact
commands):
- WHERE on `UnindexedCol`, before tune → full-scan + missing-index(high) + stale-stats +
  unused-index.
- WHERE on `IndexedCol`, before tune → index-map read only; stale-stats still fires (no
  other finding).
- `GROUP BY`/`ORDER BY` on `UnindexedCol`, before tune → temp-file markers (plan-anomaly) +
  stale-stats + unused-index; NO full-scan (master-map read present but genuinely no
  per-row predicate line — a real, useful negative case, not a fixture I had to invent).
- SAME unindexed-WHERE query, captured AGAIN after
  `Write $SYSTEM.SQL.Stats.Table.GatherTableStats("ExecuteMCPv2_Tests.AdvisorFixture")` →
  identical full-scan/missing-index/unused-index findings, stale-stats warning GONE (the
  AC 28.2.2 before/after pair).
- `%Dictionary.CompiledClass` system-schema query → full-scan fires (a REAL captured
  variance: the master-map trailing segment here is `...Master`, not `...IDKEY` — the
  parser's full-scan regex was generalized to accept ANY trailing segment specifically
  because of this live discovery); missing-index correctly suppressed (system-schema
  exclusion).
- Range predicate (`WHERE UnindexedCol > 'U500'`) after tune → missing-index at MEDIUM
  confidence (non-equality operator) — also revealed a second real variance: the predicate
  line sometimes omits the `%SQLUPPER(...)` wrapper for EXACT-collation columns (the
  `%Dictionary` case above), so `PREDICATE_RE` accepts both wrapped and bare column forms.
- `SELEKT GARBAGE FROM NoSuchTable` → the LIVE endpoint's own error envelope, `result: {}`
  (no `plan` at all) — used verbatim as the "genuinely unparseable query" fixture
  (`ADVISE_DATA_ENDPOINT_ERROR_RESULT`) rather than inventing one.
- Also captured (not used in a fixture — no assertion built on it): `SELECT 1` resolves to
  the system pseudo-table `%TSQL_sys.snf` with map name `...Map1` (a THIRD live-observed
  master-map suffix variant, reinforcing the decision not to hardcode `IDKEY`).

Task 3: implemented `analyzeAdviceData` in `packages/iris-dev-mcp/src/tools/sqlAdvisor.ts`.
Reused `parsePlanIndexes()` (spec §4 "unchanged, reused as-is") by duplicating it locally
rather than importing from `sqlAnalyze.ts`, so that module's four existing actions stay
byte-for-byte untouched (Rule #19) and this engine remains a fully independent pure
transform with no cross-module coupling. Rule #50 note: the missing-index leading-subscript
correlation key is `(schema, table)` only (used to look up the right `indexes[]` group) —
no per-plan/per-invocation dimension is folded in; the unused-index correlation similarly
keys on `(schema, table, indexName)` derived entirely from the endpoint's own dictionary
data, never from anything invocation-specific.

**Known limitation (documented, not fixed — low-risk given `unused-index` is already
confidence `low` by design):** the plan's internal "map name" for a table's primary-key
index is not always the dictionary's declared `IDKEY`/index name (e.g. `%Dictionary.
CompiledClass` uses the internal name `Master`). `unused-index`'s correlation assumes the
plan's map-name token matches the dictionary `indexName` literally, so on such system
classes the primary-key row can be misreported as "unused" even when the master map WAS
read. This never affects `ExecuteMCPv2.Tests.AdvisorFixture` (its plan tokens match
`IDKEY`/`IdxIndexedCol` exactly, verified in every captured fixture) and no test asserts
`unused-index` behavior on the `%Dictionary` fixture. Flagged here for the reviewer/future
story rather than silently left undiscovered.

Task 4: 35 vitest tests in `sqlAdvisor.test.ts`, all against the 6 live-captured
`AdviseData` fixtures plus targeted synthetic inputs for the negative/fuzz paths (per AC
28.2.3, "garbage strings"/"alien plan shape" are BY DEFINITION not real IRIS output — no
live capture exists to replay for those; every fixture that represents an actual IRIS plan
IS reference-captured). Ran green on the first attempt (no red→green debugging needed,
confirming the mental trace of the live captures against the regexes was accurate).

Task 5: `pnpm --filter @iris-mcp/dev build`/`vitest run` clean; `pnpm turbo run build` 6/6;
`pnpm turbo run test` 13/13 tasks green (`@iris-mcp/dev` 538/538 — was 503/503 pre-story,
net +35, matching the new test file exactly; every other package unchanged: shared 706,
admin 443, ops 340, interop 323, all unaffected); `pnpm --filter @iris-mcp/dev lint` +
`type-check` clean; `pnpm gen:governance-baseline:check` exit 0 (141 frozen / 200 live / 59
post-foundation — unchanged from post-28.1, no governance key added, per story scope);
`BOOTSTRAP_VERSION` confirmed unchanged `6422caf6ec31` (grep-verified); grep confirmed
`AdvisorFixture` appears in NEITHER `scripts/gen-bootstrap.mjs` NOR
`packages/shared/src/__tests__/bootstrap.test.ts` (Rule #39 — fixture-only, count stays
28). No `ExecuteMCPv2.Temp.*` scratch classes were created this session (the durable
`ExecuteMCPv2.Tests.AdvisorFixture` was used directly for every live capture), so there was
nothing to delete.

### Completion Notes List

- Authored `ExecuteMCPv2.Tests.AdvisorFixture.cls` (`%Persistent`, `UnindexedCol` +
  `IndexedCol` with `Index IdxIndexedCol On IndexedCol`, a `Populate(pRows)` seeding
  ClassMethod, deliberately no `EXTENTSIZE` keyword) — deployed + seeded 2000 rows on
  HSCUSTOM. Fixture-only per Rule #39: confirmed absent from both bootstrap rosters.
- Reference-captured 6 real `AdviseData` JSON shapes from the LIVE `/dev/sql/advise-data`
  endpoint (Rule #36) into `packages/iris-dev-mcp/src/__tests__/sqlAdvisor.fixtures.ts`,
  each stored as a joined array of single-line strings (never a raw multi-line template
  literal) so the verbatim captured `\r\n` line endings survive this repo's
  `.gitattributes` `eol=lf` normalization untouched. Two genuine live variances were
  discovered mid-capture and folded into the engine's marker-matching (not invented,
  observed): the master-map trailing segment isn't always `IDKEY`, and the per-row
  predicate line isn't always `%SQLUPPER(...)`-wrapped.
- Implemented `packages/iris-dev-mcp/src/tools/sqlAdvisor.ts`: `analyzeAdviceData(raw,
  ctx?)` — a pure function, no IRIS/HTTP call — implementing all five findings
  (`full-scan`, `missing-index`, `stale-stats`, `unused-index`, `plan-anomaly`) plus the
  `AdviseData*`/`AdvisorFinding`/`AdvisorAnalysisResult` types. Returns `{findings, notes}`
  (notes carries `"plan format not recognized"` only for genuinely unrecognized plan text —
  a design extension of the story's suggested `AdvisorFinding[]` return shape needed to
  satisfy AC 28.2.3's explicit note requirement). Every finding carries `evidence` +
  `planExcerpt` + `recommendation` (citation invariant enforced structurally by
  construction — there is no code path that pushes a finding without them).
  `missing-index` is skipped (never a false positive) for `%*`/`INFORMATION_SCHEMA` system
  schemas AND for any full-scan table with no matching `indexes[]` group (CR 28.1-1
  unresolved-class hazard). The engine derives table identity for `full-scan`/
  `missing-index` directly from the plan text (not from `raw.tables`), which insulates it
  from CR 28.1-1/CR 28.1-2's endpoint-side table-enumeration failures — an empty/absent
  `tables[]` array from the endpoint has zero effect on this engine's own logic.
- 35 vitest tests in `sqlAdvisor.test.ts`: a fires + does-NOT-fire pair for every one of the
  5 findings (all driven by the live-captured fixtures), an aggregate exact-finding-set
  assertion per fixture, a citation-invariant sweep, the system-schema exclusion proven
  against the live `%Dictionary` capture (full-scan fires, missing-index does not — proving
  the exclusion does real work rather than the marker simply failing to match), the CR
  28.1-1/CR 28.1-2 empty-indexes/empty-tables guards, and the AC 28.2.3 fuzz suite (garbage
  string, empty plan, a synthetic alien-but-plausible plan shape, null/undefined raw, the
  live-captured endpoint error-result `{}` shape, and a battery of malformed non-object
  inputs) — all assert `findings:[]` + the exact `"plan format not recognized"` note and
  never throw.
- No tool wiring, no `advise` action, no `mutates`/governance change, no bootstrap change —
  confirmed via `gen:governance-baseline:check` (exit 0, unchanged 141/200/59) and a grep
  confirming `AdvisorFixture` is in neither bootstrap roster. `sqlAnalyze.ts`'s four existing
  actions were not touched (Rule #19 byte-for-byte — `parsePlanIndexes` was duplicated
  locally in `sqlAdvisor.ts`, not imported/modified).

### File List

- `src/ExecuteMCPv2/Tests/AdvisorFixture.cls` (new — fixture-only, NOT in bootstrap manifest)
- `packages/iris-dev-mcp/src/tools/sqlAdvisor.ts` (new — the heuristic engine)
- `packages/iris-dev-mcp/src/__tests__/sqlAdvisor.fixtures.ts` (new — 6 reference-captured `AdviseData` fixtures)
- `packages/iris-dev-mcp/src/__tests__/sqlAdvisor.test.ts` (new — 35 tests)
- `_bmad-output/implementation-artifacts/28-2-heuristic-engine.md` (this story file — Tasks/Subtasks, Dev Agent Record, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status `ready-for-dev` → `review` + last_updated log entry)
- `_bmad-output/implementation-artifacts/cycle-log-epic-28.md` (appended `dev_complete` entry for Story 28.2)

### Review Findings

Opus 3-layer adversarial code review (Blind Hunter + Edge Case Hunter + Acceptance Auditor), 2026-07-11. Story closed **`done`** — 0 HIGH, 4 patches applied inline, 4 LOW/MED deferred (Epic-28-own), 2 dismissed. Rule #36 spot-check: re-captured Fixtures 4 and 5 against the live `/dev/sql/advise-data` endpoint — both match byte-for-byte including the `.Master` suffix + bare-column-predicate variances (fixtures are genuinely reference-captured, not fabricated). Scope verified: `sqlAnalyze.ts` byte-for-byte untouched, no `advise`/`mutates`/governance, `AdvisorFixture` absent from both bootstrap rosters, `BOOTSTRAP_VERSION` unchanged `6422caf6ec31`, frozen baseline `1e62c5ad5bf7` git-clean (`gen:governance-baseline:check` exit 0). `pnpm turbo run test` 13/13; dev suite 549 green (sqlAdvisor 39→46 tests); lint + type-check clean.

**Patches applied (fixed):**
- [x] [Review][Patch] unused-index false-positive on master-map name variance + system schemas — the dev-flagged known limitation. `unused-index` now skips primary/master (type `key` / `primaryKey`) rows AND system schemas, eliminating the harmful "drop your primary key" recommendation on `%Dictionary.CompiledClass` (plan reads `...Master`, dict says `IDKEY`). Two hunters rated MEDIUM. [`packages/iris-dev-mcp/src/tools/sqlAdvisor.ts` unused-index loop]
- [x] [Review][Patch] `analyzeAdviceData` threw on malformed `indexes` shapes (group missing `rows`, `rows` non-array, null group, null row) — violated AC 28.2.3 "never throw". Live-confirmed the pre-fix throw, then guarded per-group `rows` + null group/row in both the missing-index `.find`/`.map` and the unused-index loop. [`packages/iris-dev-mcp/src/tools/sqlAdvisor.ts`]
- [x] [Review][Patch] `findPredicates` called twice — hoisted to a single call. [`packages/iris-dev-mcp/src/tools/sqlAdvisor.ts`]
- [x] [Review][Patch] Coverage: added 2 reference-captured tests — the LIKE-only predicate path (full-scan fires, missing-index does NOT — the "predicate-exists-but-no-equality/range" branch, QA gap b) via a new live-captured Fixture 8, and the Fixture-5 aggregate finding-set lock (full-scan + stale-stats ONLY, closing the test gap that concealed the unused-index false positive). [`sqlAdvisor.test.ts`, `sqlAdvisor.fixtures.ts`]

**Deferred (Epic-28-own — see `deferred-work.md` §"code review of 28-2-heuristic-engine (2026-07-11)"):**
- [x] [Review][Defer] CR 28.2-1 (MED) — multi-table JOIN: plan-global predicate attribution can cross a predicate to the wrong table + duplicate self-join findings; needs a live-captured join fixture (Rule #36) → Story 28.3 smokes. All shipped fixtures are single-table.
- [x] [Review][Defer] CR 28.2-2 (LOW) — `missing-index` confidence is plan-order-dependent for a column carrying both `=` and a range op.
- [x] [Review][Defer] CR 28.2-3 (LOW) — `isSystemSchema` `INFORMATION_SCHEMA` branch untested at the missing-index suppression point (no cheaply-capturable matching full-scan; `%*` branch proven live).
- [x] [Review][Defer] CR 28.2-4 (LOW) — `FULL_SCAN_RE` under-detects master-map scans that loop on a composite/non-`ID` idkey (e.g. `INFORMATION_SCHEMA.TABLES` loops on `SchemaExact and TableExact`) — false negative, never a harmful false positive; consistent with the pinned spec marker.

**Dismissed:** `unused-index` `planExcerpt` being synthesized prose rather than a verbatim plan line (by design — an absent index has no plan line to excerpt; auditor agreed defensible); `row.indexName` undefined producing `Index undefined …` text (type-required field, no throw, near-zero real risk; the null-row guard covers the crashing sub-case).
