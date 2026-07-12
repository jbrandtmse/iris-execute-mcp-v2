# Story 28.1: `/dev/sql/advise-data` Endpoint

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **dev-tools engineer building the SQL Performance Advisor**,
I want **one consolidated ObjectScript route `POST /dev/sql/advise-data` that, for a given SQL statement, returns the `EXPLAIN` plan text AND the `%Dictionary.CompiledIndex`/`%Dictionary.CompiledClass` rows for the table(s) the statement references — in a single response**,
so that **the Story 28.2 TypeScript heuristic engine has all the raw materials (plan markers, the `Warning: not tuned` line, and the index/column lists for `missing-index`) from one round-trip, with no client-side dictionary calls, and Story 28.3 can call it live**.

This is the **FIRST ObjectScript handler for the `iris_sql_analyze` tool family** (the existing four actions are TS/SQL-only via the Atelier `action/query` endpoint — Story 28.0 Rule #47 correction). It is therefore a **new bootstrap contributor** → `BOOTSTRAP_VERSION` bumps in this story (Rule #24) and the new class must be added to BOTH hand-maintained bootstrap rosters (Rule #39). No TypeScript tool wiring here — the `advise` action + `mutates` map + governance land in Story 28.3.

## Acceptance Criteria

1. **AC 28.1.1 — Consolidated data route.** A new ObjectScript REST handler serves `POST /dev/sql/advise-data` and, given a JSON body `{ "query": "<sql>", "namespace"?: "<ns>" }`, returns ONE response containing:
   - **`plan`** — the verbatim `EXPLAIN <query>` plan text (the same plan the existing `explain` action surfaces, now produced server-side). The plan's top-level `Warning:\nTable <Schema>.<Table> is not tuned.` block, when present, is preserved verbatim in this text (that IS the `stale-stats` source — no separate tune payload, per spec §2 finding 3 / §4).
   - **`indexes`** — for each table the statement references (resolved from the plan's `<Schema>.<Table>` tokens and/or the statement), the `%Dictionary.CompiledIndex` rows: at minimum `{ className, indexName, properties (the verbatim order-preserving "Prop:Collation,…" string), data }`, plus the `%Dictionary.CompiledClass` `SqlSchemaName`/`SqlTableName`/`Name` mapping so the TS engine can build `suggestedDdl` and do the leading-subscript check. Group per table.
   - **`tables`** — the list of referenced `Schema.Table` (and resolved class) the handler enumerated, so the engine knows what WAS checked (supports the "no silent empty — say what was checked" contract, spec §3).
   - Handler follows conventions §3 exactly: `Set tSC = $$$OK`; Try/Catch with argumentless `Quit`; result var initialized before Try; **exactly ONE `RenderResponseBody` per request** via an error-flag + single-dispatch after the Try/Catch (Rule #7); error text through `##class(ExecuteMCPv2.Utils).SanitizeError(tSC)` (Rule #9) with NO `^`-caret-global names in the message (Rule #33); never wrap a method call in `$Get()` (Rule #15); before calling ANY IRIS system class, verify method/query existence + ROWSPEC + `[Deprecated]` against `irislib/` source (Rules #2/#4/#16).
   - **Namespace handling:** `EXPLAIN` + `%Dictionary.*` reads are namespace-LOCAL (per-namespace dictionary), so the reads run in the request/target namespace, NOT `%SYS`. If a `namespace` param is honored to target a different namespace, use explicit save/restore (`Set tOrigNS = $NAMESPACE` … restore before ANY error handling/render), never `New $NAMESPACE` (basics rule). Validate `query` non-empty BEFORE any namespace switch.
   - **Unrecognized / bad input:** a malformed or non-parseable `query` returns a clean sanitized error envelope (never a raw `<...>` dump); an empty/garbage plan still returns `plan` as whatever IRIS emitted (the TS engine, 28.2, owns "plan format not recognized" — the endpoint does not guess). A `query` that fails to prepare surfaces the IRIS error via `SanitizeError`.
   - `%UnitTest` shape coverage (`ExecuteMCPv2.Tests.AdvisorDataTest`, plural package): for a known table with a WHERE on an unindexed column → response has non-empty `plan` containing a `Read master map` marker + the `indexes` block lists the table's real indexes with the verbatim `Properties` string; for a garbage query → clean error, no crash; assert the single-`RenderResponseBody` / error-envelope shape. Run with the Rule #35 total-vs-expected count check.

2. **AC 28.1.2 — Deploy + bootstrap bump (Rules #24/#39/#18).**
   - New class deployed via glob-path `iris_doc_load` (Rule #17 — `c:/git/iris-execute-mcp-v2/src/**/*.cls`, never a bare path) + compiled clean on HSCUSTOM.
   - `pnpm run gen:bootstrap` regenerates `packages/shared/src/bootstrap-classes.ts` (NEVER hand-edit — Rule #18); the new class is added to the **ordered `classes[]` array in `scripts/gen-bootstrap.mjs`** in REST-class position (with the other `REST.*` classes, **before `REST/Dispatch.cls`** which stays last) AND to **`packages/shared/src/__tests__/bootstrap.test.ts`** in all three spots (the `classPaths` roster array, the expected-names list, and the class-count assertions **27 → 28**) — Rule #39 dual-roster.
   - `BOOTSTRAP_VERSION` moves in THIS story; record the from→to hashes (from `1e2008753853`) in the Dev Agent Record + CHANGELOG. `gen:bootstrap` is idempotent (second run byte-identical). `bootstrap.test.ts` green (on-disk == embedded == version).
   - Frozen governance baseline `1e62c5ad5bf7` UNTOUCHED — this story adds no governance key (the `advise` action/`mutates` entry is Story 28.3). `gen:governance-baseline:check` exit 0.

## Integration ACs

This story introduces a **service** (the `/dev/sql/advise-data` REST endpoint) with **no consumer in this story**. The first consumers are:
- **Story 28.2** — captures reference fixtures FROM this endpoint's live output (the plan + index JSON) to drive the TS heuristic engine (Rule #36). The endpoint's response SHAPE is locked by this story's `%UnitTest` + the AC 28.1.1 contract so 28.2's fixtures are stable.
- **Story 28.3** — the `advise` action calls this endpoint LIVE (`ctx.http.post("/dev/sql/advise-data", …)`) and feeds the raw materials to the engine.

Per the Integration-AC rule: **no consumer wire-up ships in 28.1**; the first live consumer is Story 28.3, and the fixture consumer is Story 28.2. The `%UnitTest` shape test (AC 28.1.1) is the producer-side contract lock that prevents a producer/consumer drift.

## Tasks / Subtasks

- [x] **Task 1 — Pin the server-side EXPLAIN API live (AC: 28.1.1; Rule #16)**
  - [x] Load the IRIS MCP tools (ToolSearch, dev profile). Determine the ObjectScript API that yields the SAME `EXPLAIN <query>` plan text the existing `explain` action gets via `action/query`. Candidates to verify against `irislib/%SYSTEM/SQL*.cls` + `irislib/%SQL/Statement.cls`: running `EXPLAIN <query>` via `%SQL.Statement`/dynamic SQL and reading the `Plan` column, or a `$SYSTEM.SQL` explain API. Confirm the plan text (incl. the `Warning: ... not tuned.` block) matches the Story 28.0 captures on 2026.1. Record the chosen API + a verbatim sample in the Dev Agent Record. Do a disposable `ExecuteMCPv2.Temp.*` probe if needed; delete it after.
  - [x] Confirm the table-extraction approach: parse `<Schema>.<Table>` tokens from the plan text (`Read master map <Schema>.<Table>.IDKEY`, `Read index map <Schema>.<Table>.<Index>`, temp-file lines) to determine which tables to enumerate indexes for. Handle multi-table (join) plans.
- [x] **Task 2 — Author the handler class (AC: 28.1.1)**
  - [x] Create `src/ExecuteMCPv2/REST/<HandlerName>.cls` (suggested `ExecuteMCPv2.REST.SqlAdvisor`; final name at dev discretion — keep it consistent across both bootstrap rosters). Implement the `advise-data` method per conventions §3 (Rule #7 single-render, Rule #9 SanitizeError, namespace-local reads, `%IsDefined`/`%Get` for body fields not `$Get()`).
  - [x] Read `query` from the JSON body via `##class(ExecuteMCPv2.Utils)` helpers used by peer handlers (e.g. `ReadRequestBody`/`ValidateRequired` — check `EnvSync.cls`/`Health.cls` for the exact peer pattern); reject empty `query` with a clean validation error before any work.
  - [x] Build the response `%DynamicObject`: `plan` (string), `indexes` (array grouped per table, each with className/indexName/properties/data), `tables` (array of the enumerated schema.table+class), via `%Dictionary.CompiledIndex` + `%Dictionary.CompiledClass` (the pinned queries in spec §2 finding 2). Escape underscore-named dynamic-object keys if any (basics rule).
  - [x] Register the route in `src/ExecuteMCPv2/REST/Dispatch.cls` UrlMap (`<Route Url="/dev/sql/advise-data" Method="POST" Call="..."/>` — mirror the existing `/dev/doc/hashes` (EnvSync) and `/dev/loc` route registrations).
- [x] **Task 3 — `%UnitTest` shape coverage (AC: 28.1.1)**
  - [x] `src/ExecuteMCPv2/Tests/AdvisorDataTest.cls` (plural `Tests` package; `%UnitTest.TestCase`, no `%OnNew` unless custom state). Cover: known-table unindexed-WHERE → `plan` has `Read master map` + `indexes` lists the real index with verbatim `Properties`; garbage query → clean SanitizeError envelope no crash; the single-render/error-flag path. Deploy + run with Rule #35 total-vs-expected count check (compare returned `total` to the number of `Test*` methods).
- [x] **Task 4 — Deploy loop + bootstrap dual-roster bump (AC: 28.1.2; Rules #17/#18/#24/#39)**
  - [x] `iris_doc_load` glob-path deploy + compile the new handler + test class on HSCUSTOM.
  - [x] Add the new handler class to `scripts/gen-bootstrap.mjs` `classes[]` (REST position, before `Dispatch.cls`) AND to `packages/shared/src/__tests__/bootstrap.test.ts` (roster array + names list + count 27→28). The `AdvisorDataTest`/any fixture class stays OUT of the bootstrap (test/fixture classes are excluded — Rule #39).
  - [x] `pnpm run gen:bootstrap`; record `BOOTSTRAP_VERSION` from→to; re-run to confirm idempotent (byte-identical). `pnpm --filter @iris-mcp/shared test` → `bootstrap.test.ts` green.
- [x] **Task 5 — Full verification + no-drift (AC: 28.1.1/28.1.2)**
  - [x] `pnpm turbo run build` + `pnpm turbo run test` green; `pnpm turbo run lint` + `type-check` clean.
  - [x] `pnpm gen:governance-baseline:check` exit 0 (frozen baseline `1e62c5ad5bf7` git-clean — no governance key added here).
  - [x] Delete any `ExecuteMCPv2.Temp.*` probe classes (IRIS + disk). CHANGELOG entry for the endpoint + bootstrap bump.

## Dev Notes

### What this story IS / ISN'T
- **IS:** a new ObjectScript REST endpoint + its `%UnitTest` + the bootstrap bump. It is a pure PRODUCER — no TS tool change, no `advise` action, no `mutates`/governance change.
- **ISN'T:** the TS heuristic engine (Story 28.2), the `advise` tool action / docs / smokes (Story 28.3), or the `ExecuteMCPv2.Tests.AdvisorFixture` durable fixture table (Story 28.2 builds that).

### The endpoint contract (from the Story 28.0 amended spec — read spec §2–§4 in full)
- **Plan text** = the verbatim `EXPLAIN <query>` output. The Story 28.0 captures (2026.1 Build 235U) are the ground truth: `full-scan` marker `Read master map <Schema>.<Table>.IDKEY, looping on ID.`; `index map` marker `Read index map <Schema>.<Table>.<IndexName>, using the given %SQLUPPER(<Col>), and looping on ID.`; temp-file `Call Module-B, which populates temp-file A.` / `Read temp-file A, ...`; and the `Warning:\nTable <Schema>.<Table> is not tuned.` block (the ONLY stale-stats source — do NOT add a dictionary tune read; §2 finding 3 proved `%Dictionary.CompiledStorage.ExtentSize` is declarative-only/dead on 2026.1).
- **Index rows** (spec §2 finding 2, live-confirmed queries):
  ```sql
  SELECT parent AS ClassName, Name AS IndexName, Properties AS PropertyList,
         PrimaryKey, "_Unique" AS IsUnique, Type, Data
  FROM %Dictionary.CompiledIndex WHERE parent = ? ORDER BY Name
  -- table -> class:
  SELECT Name FROM %Dictionary.CompiledClass WHERE SqlSchemaName = ? AND SqlTableName = ?
  -- class -> table (for suggestedDdl in 28.2):
  SELECT SqlSchemaName, SqlTableName FROM %Dictionary.CompiledClass WHERE Name = ?
  ```
  `Properties` is an order-preserving `Prop:Collation,…` string (e.g. `"Production:Exact,Name:Exact"`); the TS engine splits on `,`, strips `:Collation`, and uses entry order for the leading-subscript check. `parent` is the DOT class name, not the SQL table name.
- **No separate tune payload** — 28.2 reads `stale-stats` straight off the plan `Warning:` block that this endpoint already returns in `plan`.

### Reuse targets (Rule #47 — verify against source)
- Peer OS REST handlers for the conventions §3 pattern + `ExecuteMCPv2.Utils` body-reading helpers: `src/ExecuteMCPv2/REST/EnvSync.cls` (Story 27.0, `/dev/doc/hashes`), `src/ExecuteMCPv2/REST/Loc.cls` (`/dev/loc`), `src/ExecuteMCPv2/REST/Health.cls`. Mirror their `ReadRequestBody`/`ValidateRequired`/`RenderResponseBody`/`SanitizeError` usage and route registration in `Dispatch.cls`.
- The existing `explain` action's SQL is just `"EXPLAIN " + query` posted to `action/query` ([`packages/iris-dev-mcp/src/tools/sqlAnalyze.ts`](../../packages/iris-dev-mcp/src/tools/sqlAnalyze.ts)) — the server-side handler must produce the SAME plan text (verify live, Rule #16).

### Bootstrap dual-roster (Rule #39) — do NOT miss either list
- `scripts/gen-bootstrap.mjs` `classes[]` — hand-maintained ordered array (NOT a glob). Insert the new REST handler with the other `REST.*` classes, **before `REST/Dispatch.cls`** (last). Test/fixture classes are NOT in this array.
- `packages/shared/src/__tests__/bootstrap.test.ts` — hand-maintained roster: the `classPaths` array (~L1199), the expected-names list (~L1031), AND the count assertions "should contain exactly 27 classes" (~L1026) + `getBootstrapClasses` length (~L1085) → **27 → 28**.
- Miss either list → `bootstrap.test.ts` goes red. Current `BOOTSTRAP_VERSION` = `1e2008753853` ([`packages/shared/src/bootstrap-classes.ts:25`](../../packages/shared/src/bootstrap-classes.ts#L25)) — never hand-edit that file (Rule #18); run `gen:bootstrap` and record from→to.

### ObjectScript rules (from `.claude/rules/`)
- Abstract methods need bodies; class parameters/methods no underscores; `///` doc comments; NEVER edit Storage sections (compiler-maintained); compile via `iris_doc_load compile=true` or the compile MCP tool. QUIT-with-args forbidden in Try/Catch (init result before Try, argumentless `Quit`, return after). Triple-`$$$` macros. `%DynamicObject` underscore keys need quotes.

### IRIS environment
- Live IRIS is `2026.1 (Build 235U)`, HSCUSTOM primary. Default creds `_SYSTEM`/`SYS`. MCP tools are deferred — load via ToolSearch. If live IRIS is unreachable from the dev-agent context, STOP with `## Clarification Needed` (the lead deploys/probes).

### Project Structure Notes
- New: `src/ExecuteMCPv2/REST/<HandlerName>.cls`, `src/ExecuteMCPv2/Tests/AdvisorDataTest.cls`; edits to `src/ExecuteMCPv2/REST/Dispatch.cls`, `scripts/gen-bootstrap.mjs`, `packages/shared/src/__tests__/bootstrap.test.ts`, `packages/shared/src/bootstrap-classes.ts` (regenerated), `CHANGELOG.md`.
- No `packages/iris-dev-mcp/**` change in this story (the tool wiring is 28.3).

### References
- [Source: _bmad-output/planning-artifacts/research/feature-specs/06-sql-performance-advisor.md#2 (pinned plan markers + index/tune/workload surfaces), #4 (heuristics table + endpoint role), #6 (story 1 scope)]
- [Source: _bmad-output/implementation-artifacts/28-0-advisor-probe-matrix.md (Dev Agent Record — verbatim probe captures)]
- [Source: _bmad-output/planning-artifacts/research/feature-specs/00-conventions.md#3 (REST handler skeleton), #6 (definition of done)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 28.1: /dev/sql/advise-data Endpoint (AC 28.1.1–2)]
- [Source: src/ExecuteMCPv2/REST/EnvSync.cls, Loc.cls, Health.cls (peer handler + route + utils patterns); src/ExecuteMCPv2/REST/Dispatch.cls (UrlMap)]
- [Source: scripts/gen-bootstrap.mjs classes[]; packages/shared/src/__tests__/bootstrap.test.ts (Rule #39 dual-roster, 27→28); packages/shared/src/bootstrap-classes.ts:25 (BOOTSTRAP_VERSION 1e2008753853)]
- [Source: .claude/rules/project-rules.md#7 (single-render), #9 (SanitizeError propagation), #16 (live-probe the EXPLAIN API), #17 (glob-path load), #18 (never hand-edit generated bootstrap), #24 (bootstrap regen per change), #33 (no caret-globals in errors), #39 (bootstrap dual-roster), #47 (verify reuse targets); .claude/rules/iris-objectscript-basics.md (namespace save/restore, QUIT-in-Try/Catch); .claude/rules/object-script-testing.md (%UnitTest, Rule #35 count check)]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story` skill.

### Debug Log References

Live IRIS probe session against server profile `default` (dev MCP), namespace `HSCUSTOM`,
2026-07-11. No `ExecuteMCPv2.Temp.*` probe classes were created — the always-present
`Ens.Config.Item` system table (Story 28.0's own live-verification target) served as the
"known table" for every live check, so no probe-class cleanup was needed.

Task 1 live probe (Rule #16):
- `EXPLAIN SELECT ID, Name FROM Ens_Config.Item WHERE Name = 'X'` via `iris_sql_execute`
  (the same Atelier `action/query` path the existing `explain` action uses) and via
  `##class(%SQL.Statement).%ExecDirect(, "EXPLAIN "_query)` reading the first row's `Plan`
  column produced **byte-for-byte identical** plan text (verbatim `<plans>...</plans>` XML,
  including the collation-related `Warning:` block) — confirmed the chosen server-side API.
- `tRS.IndexName`/`tRS.PropertyList`/etc. dot-property access on the `%SQL.StatementResult`
  works exactly like the codebase's existing `tRS.cnt`/`tRS.Name` pattern (Health.cls) — no
  need for `.%Get(...)`.
- Confirmed `%SQL.Statement.%ExecDirect` does NOT throw on a prepare-time failure — it
  returns a negative `%SQLCODE` + `%Message` on the result object:
  `EXPLAIN SELEKT GARBAGE FROM NoSuchTable` → `SQLCODE -481 "EXPLAIN does not support the
  following SQL statement type: UNKNOWN"`; `EXPLAIN @@@ not valid sql at all ???` →
  `SQLCODE -481 "...statement type: @"`; a non-SQL-looking garbage string with `$$$` tokens
  → `SQLCODE -204` (macro-parse error). All three surfaced cleanly through `RunExplain` →
  `SanitizeError`, never a raw dump.
- **Corrected a wrong assumption before it shipped (Rule #16):** initially assumed
  `DELETE` would be an "EXPLAIN-unsupported statement type" test case. Live-verified
  `EXPLAIN DELETE FROM Ens_Config.Item WHERE ID = -999999` → `SQLCODE 0`, plan text
  returned (418 chars) — **EXPLAIN DOES support DELETE**. Swapped the test to use the
  genuinely-unrecognized `SELEKT GARBAGE FROM NoSuchTable` case instead.
- Confirmed the index/class dictionary queries from spec §2 finding 2 live against
  `Ens.Config.Item`: `%Dictionary.CompiledIndex` returned 3 rows (`AlertGroup` →
  `"Production:Exact,AlertGroups(ELEMENTS):Exact"`, `IDKEY` → `""`, `Name` →
  `"Production:Exact,Name:Exact"`); `%Dictionary.CompiledClass` round-tripped
  `Ens_Config`/`Item` ⇄ `Ens.Config.Item` in both directions.
- Table-extraction approach (Task 1 subtask 2): `ExtractTables` scans plan-text lines for
  `Read master map ` / `Read index map ` markers, takes the token up to the next comma,
  strips a parenthetical join alias (`Table(C).IDKEY` → `Table.IDKEY`), and splits on `.`
  for `{schema, table}` — deduplicated, first-seen order. Verified this correctly resolves
  BOTH tables of a 2-table join using the REFERENCE-CAPTURED verbatim plan text from Story
  28.0's Probe Finding #4 (Rule #36 — no fresh join-probe schema stood up for this story).
- **Pre-existing unrelated test failure confirmed NOT a regression:** `pnpm turbo run test`
  showed `@iris-mcp/all`'s `gen-skills-stray-file.test.ts` failing with drift in
  `skills/promote-environment-change/SKILL.md` + `skills/README.md`. Verified via
  `git stash` (temporarily hiding this story's changes) that `node scripts/gen-skills.mjs
  --check` fails identically on the committed HEAD (`af9cf7a`, Story 28.0) — this story
  touches nothing under `packages/iris-dev-mcp/src/prompts/`, `skills/`, or `gen-skills.mjs`,
  so the drift is pre-existing and out of this story's scope. Left untouched.

### Completion Notes List

- Authored `ExecuteMCPv2.REST.SqlAdvisor.cls` (`src/ExecuteMCPv2/REST/SqlAdvisor.cls`) — the
  FIRST ObjectScript handler for the `iris_sql_analyze` tool family. `AdviseData()` follows
  the EnvSync/Health single-render pattern exactly (Rule #7: result var init'd before Try,
  argumentless `Quit` in Try/Catch, error-flag + single dispatch after Try/Catch, namespace
  save/restore via `##class(ExecuteMCPv2.Utils).SwitchNamespace` — never `New $NAMESPACE`,
  `query` validated BEFORE any namespace switch per AC 28.1.1). `BuildAdviceData` is the
  `%request`-independent seam (mirrors `EnvSync:ComputeHashes`) — validates `query`, runs
  `RunExplain`, calls `ExtractTables`, then for each resolved table calls
  `ResolveClassForTable` + `IndexRowsForClass` and assembles the grouped `indexes` +
  `tables` response arrays. An unresolvable table token is still listed in `tables` with an
  empty `className` and contributes no `indexes` group (no silent empty, per spec §3).
- Response shape: `{ plan, tables: [{schema, table, className}], indexes: [{className,
  schema, table, rows: [{indexName, properties, primaryKey, isUnique, type, data}]}] }` —
  `properties` is the verbatim, un-reformatted `Prop:Collation,…` string from
  `%Dictionary.CompiledIndex` (the Story 28.2 `missing-index` leading-subscript source).
  `primaryKey`/`isUnique`/`type`/`data` were added beyond the AC's stated minimum
  (`className`/`indexName`/`properties`/`data`) since the spec's own pinned SQL (§2 finding
  2) already selects them — free forward-compatibility for Story 28.2/28.3, no extra call.
- `ExecuteMCPv2.Tests.AdvisorDataTest.cls` (13 `Test*` methods — QA added the 13th,
  `TestHttpBadNamespaceCleanErrorAndRecovery`, closing the namespace-switch-path gap; Section A direct-classmethod
  + Section B HTTP-envelope, mirroring `EnvSyncTest`'s two-section pattern): known-table
  unindexed-WHERE (`Ens_Config.Item.ClassName`, genuinely unindexed — verified via
  `%Dictionary.CompiledIndex` before choosing it) → `Read master map` marker + the real
  `Name`/`AlertGroup`/`IDKEY` indexes with verbatim `Properties`; garbage/unrecognized-type
  query → clean error, no crash; `ExtractTables` single-table + reference-captured join-plan
  cases; `ResolveClassForTable`/`IndexRowsForClass` direct tests; HTTP happy-path, missing
  -query rejection, and garbage-query rejection + follow-up-request-recovers (proves the
  single-render contract + no wedged worker state, mirroring EnvSyncTest's bad-namespace
  -recovery test). Deployed + ran via `iris_execute_tests` (class level): **13/13 passed**,
  `total:13` matching the actual method count in the file (Rule #35 count-check satisfied —
  not a partial snapshot). [Count reconciled from 12→13 during code review — the QA-added
  namespace test was not reflected in the original figure; re-verified 13/13 live at review.]
- Registered `POST /dev/sql/advise-data` → `ExecuteMCPv2.REST.SqlAdvisor:AdviseData` in
  `Dispatch.cls`'s `UrlMap`, in a new "Epic 28 (Story 28.1)" block after the Epic 27 routes.
- Bootstrap dual-roster (Rule #39): added `ExecuteMCPv2.REST.SqlAdvisor.cls` to
  `scripts/gen-bootstrap.mjs`'s `classes[]` (REST position, immediately before
  `Dispatch.cls`, which stays last) AND to `packages/shared/src/__tests__/bootstrap.test.ts`
  in all required spots — the 27→28 count assertion (`BOOTSTRAP_CLASSES.size` +
  `getBootstrapClasses().length`), the expected-names list, a new "should include
  SqlAdvisor.cls" `getBootstrapClasses` test (mirroring the per-class pattern already used
  for Health.cls/EnvSync.cls/etc.), and the `classPaths` drift-check roster.
  `ExecuteMCPv2.Tests.AdvisorDataTest.cls` stays OUT of both rosters (test class — Rule
  #39). `BOOTSTRAP_VERSION`: `1e2008753853` → `6422caf6ec31`; `pnpm run gen:bootstrap` run
  TWICE produced the identical hash both times (idempotent). `pnpm --filter @iris-mcp/shared
  test` → 706/706 passed (37 files), including `bootstrap.test.ts`'s drift-check tests.
- Full verification: `pnpm turbo run build` 6/6 green; `pnpm turbo run test` 12/13 tasks
  green (the 1 failing task, `@iris-mcp/all`, is the pre-existing unrelated `gen-skills`
  drift documented above — confirmed via `git stash` to reproduce identically on HEAD before
  this story's changes); `pnpm turbo run lint` 6/6 clean; `pnpm turbo run type-check` 12/12
  clean; `pnpm run gen:governance-baseline:check` exit 0 (141 frozen foundation keys / 200
  live keys / 59 post-foundation — unchanged, no governance key added in this story, per
  scope: the `advise` action/`mutates` entry is Story 28.3).
- No `ExecuteMCPv2.Temp.*` probe classes were created (the always-present `Ens.Config.Item`
  system table served every live-verification need), so there was nothing to delete from
  IRIS or disk. `git status` confirms no `src/ExecuteMCPv2/Temp/**` addition.
- CHANGELOG.md: added a new `[Unreleased] — Epic 28 (in progress)` entry at the top
  documenting the endpoint + the `BOOTSTRAP_VERSION` move; did not edit any prior entry.
- No `packages/iris-dev-mcp/**` change (the `advise` action / TS tool wiring is Story 28.3,
  per this story's explicit scope) and no governance/baseline change.

### File List

- `src/ExecuteMCPv2/REST/SqlAdvisor.cls` (new)
- `src/ExecuteMCPv2/Tests/AdvisorDataTest.cls` (new)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (added the `/dev/sql/advise-data` route)
- `scripts/gen-bootstrap.mjs` (added `ExecuteMCPv2.REST.SqlAdvisor.cls` to `classes[]`)
- `packages/shared/src/__tests__/bootstrap.test.ts` (Rule #39 dual-roster: count 27→28,
  expected-names list, new per-class test, `classPaths` drift-check roster)
- `packages/shared/src/bootstrap-classes.ts` (regenerated via `pnpm run gen:bootstrap`;
  `BOOTSTRAP_VERSION` `1e2008753853` → `6422caf6ec31`)
- `CHANGELOG.md` (new `[Unreleased]` Epic 28 entry)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status `ready-for-dev` →
  `review` + last_updated log entry)
- `_bmad-output/implementation-artifacts/cycle-log-epic-28.md` (appended `dev_complete`
  entry for Story 28.1)

## Review Findings

Opus 3-layer adversarial review (Blind Hunter + Edge Case Hunter + Acceptance Auditor),
2026-07-11, plus direct lead-review live verification (source read of all changed files +
conventions §3; live endpoint probe on HSCUSTOM confirming the EXPLAIN plan format
`Read master map Ens_Config.Item.IDKEY` and the `%Dictionary.CompiledIndex` ROWSPEC incl.
verbatim `Properties` `Production:Exact,Name:Exact`; live `iris_execute_tests` **13/13,
total:13** — Rule #35 count-check genuine, not a partial snapshot; `gen:bootstrap`
idempotent [md5-stable, `BOOTSTRAP_VERSION` `6422caf6ec31`]; `gen:governance-baseline:check`
exit 0 [frozen `1e62c5ad5bf7` untouched]; `bootstrap.test.ts` 44/44 green — Rule #39
dual-roster consistent).

**Outcome: 0 HIGH, 0 MED-that-blocks-shipping. 1 patch applied (doc-only), 4 deferred
(1 MED + 3 LOW, all Epic-28-own robustness/forward-hazard items, below Rule #37's ≥3
threshold), 5 dismissed.** No patch touched `SqlAdvisor.cls` — the on-disk handler and the
embedded `bootstrap-classes.ts` copy stay in sync (no redeploy / `gen:bootstrap` re-run
required). Blind Hunter explicitly confirmed the Rule #7 single-render dispatch is correct
on every success/error/exception path, `tCmdStatus` is always defined when `tErrored=1`, and
the namespace save/restore-before-render follows the established EnvSync pattern.

### Applied (patch)

- [x] [Review][Patch] Test-method count 12→13 reconciled in Dev Agent Record — QA added the
  13th (`TestHttpBadNamespaceCleanErrorAndRecovery`); re-verified 13/13 live at review.
  Doc-only, no code/redeploy. (Auditor #1, Edge/self)

### Deferred (to deferred-work.md — Epic-28-own, forward hazards / hardening; graceful today)

- [x] [Review][Defer] `ResolveClassForTable` bare `Catch` masks a genuine dictionary-query
  failure as "table not found" (MED) [SqlAdvisor.cls] — deferred; live-verified the resolve
  works on pinned IRIS 2026.1 (columns correct), so this is an observability/robustness
  hardening (distinguish `%SQLCODE<0` hard-error from no-match), not a shipping defect; the
  "correct fix" is a signature/error-propagation design choice, not an unambiguous one-liner.
- [x] [Review][Defer] `ExtractTables` returns zero tables for a bitmap/bitslice-only plan
  with no `Read master map`/`Read index map` line (LOW/MED, forward hazard for 28.2's
  `missing-index` completeness) [SqlAdvisor.cls] — deferred; plan returned verbatim so 28.2
  has the raw material; recognizing new markers requires a reference-captured bitmap plan
  (Rule #36), out of 28.1 scope. Pairs with CR 28.0-1.
- [x] [Review][Defer] `ExtractTables` mis-splits/never-resolves delimited/quoted/schema-less
  plan tokens (`"My.Schema"."Tbl"`, 2-part `Item.IDKEY`) (LOW) [SqlAdvisor.cls] — deferred;
  narrow/version-dependent, graceful (empty `className`, no crash); no live evidence IRIS
  2026.1 emits these for normal persistent-class tables.
- [x] [Review][Defer] Whitespace-only `namespace` body value drives a switch failure instead
  of defaulting to current (LOW) [SqlAdvisor.cls] — deferred; matches the EnvSync peer, clean
  error envelope, no crash; the tidy fix (`$ZStrip` `tNamespace` like `tQuery`) should be
  applied to EnvSync AND SqlAdvisor together in a hardening pass to keep the peers consistent.

### Dismissed (5)

- New source files absent from `git diff HEAD` (Auditor #2) — artifact of untracked-file diff;
  both files exist on disk, were reviewed directly, and their tests ran live 13/13. Staging is
  the committer's step; untracked files are the review target here.
- `RunExplain` zero-row → empty `plan` in a success envelope (Edge #1) — documented AC 28.1.1
  contract: the endpoint returns whatever IRIS emitted verbatim; the 28.2 TS engine owns
  "plan format not recognized," the endpoint does not guess.
- `SwitchNamespace` failure branch does not re-set `$NAMESPACE` (Blind #3) — safe: the switch
  is an atomic `Set $NAMESPACE` caught on failure, so `$NAMESPACE` is unchanged; matches the
  EnvSync peer.
- `"_Unique"` delimited-identifier column fragility (Blind #4) — live-verified: the exact
  spec-pinned query returns the correct `IsUnique` rows on IRIS 2026.1.
- No statement-type allowlist / non-string `query` coercion (Blind #5) — EXPLAIN does not
  execute the statement (not exploitable, reviewer concurs); a non-string oref `query` throws
  inside the Try and is caught → clean error envelope.
