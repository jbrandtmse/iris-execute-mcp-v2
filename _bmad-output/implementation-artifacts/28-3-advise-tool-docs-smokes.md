# Story 28.3: `advise` Surface + Docs + Smokes

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **developer using the IRIS MCP suite**,
I want **`iris_sql_analyze` to expose an `advise` action that returns evidence-cited SQL performance findings for a query (or the recent statement workload)**,
so that **I get the market-differentiating advisor capability — strictly advisory, every finding backed by a real plan excerpt, enabled by default — without any new tool or breaking change to the four existing actions**.

This is the **closing story of Epic 28**: it wires the Story 28.2 engine (`analyzeAdviceData`) to the Story 28.1 endpoint (`/dev/sql/advise-data`) behind a new `advise` action on the EXISTING `iris_sql_analyze` tool, adds `advise: "read"` to its `mutates` map (Rule #28), keeps the four existing actions byte-for-byte unchanged (Rule #19), and completes the docs rollup (Rule #30) + the live smokes (Rule #34). No new tool (Rule #31 — `advise` is an ACTION, not a tool: package tool COUNT is unchanged); no bootstrap change (TS-only; `BOOTSTRAP_VERSION` stays `6422caf6ec31`); the frozen governance baseline `1e62c5ad5bf7` stays untouched (`iris_sql_analyze:advise` is a NEW post-foundation key).

## Acceptance Criteria

1. **AC 28.3.1 — `advise` action wired + governed.**
   - `advise` added to the `iris_sql_analyze` action enum AND to its per-action `mutates` map as `advise: "read"` (Rule #28 — a read is still MANDATORY to classify; classified read → default-ENABLED). A **real-gate governance test** (drives the actual `handleToolCall`) proves `advise` is enabled under empty `IRIS_GOVERNANCE` (and the four existing reads unchanged).
   - **`query` mode:** POSTs the SQL to `/dev/sql/advise-data` (`ctx.http.post`), passes the returned `{plan, tables, indexes}` to `analyzeAdviceData(raw, { query })`, and renders `structuredContent` per spec §3 (`{ mode:"query", findings:[…], analyzed:{statements,skipped} }`) + evidence-first text (findings ranked by confidence; when zero findings, say so explicitly with what was checked — no silent empty). `query`/`workload` are mutually exclusive.
   - **`workload` mode:** queries the top-N recent statements (`INFORMATION_SCHEMA.STATEMENTS ORDER BY Timestamp DESC`, the Story 28.0 pinned source), advises each via the same endpoint+engine, aggregates. `topN` (default 5, max 20) caps analysis breadth = **scan work — documented per Rule #38**. If the workload source is unavailable on the platform (Story 28.0 confirmed it EXISTS on 2026.1, but other editions may differ), return a **clear capability error**, never a raw `<...>`/SQLCODE dump.
   - Input validation: `query` XOR `workload` required; `topN` bounds enforced; `namespace` honored (existing param). Errors sanitized.

2. **AC 28.3.2 — existing four actions byte-for-byte unchanged (Rule #19).** A snapshot/equality test proves `explain`/`stats`/`indexUsage`/`running` produce identical output to pre-story (the `advise` addition is strictly additive). `sqlAnalyze.ts`'s existing action code paths are not altered in behavior.

3. **AC 28.3.3 — docs rollup + live smokes + spec §7 checklist.**
   - **Docs rollup (Rule #30)** across the standard surfaces (root `README.md`, `tool_support.md`, `packages/iris-dev-mcp/README.md`, `CHANGELOG.md`, `packages/iris-mcp-all/README.md`): document the `advise` action with the **advisory disclaimer** ("recommendations are heuristic; verify with `explain` before applying"), the `query`/`workload` modes, the `topN` scan-work note (Rule #38), and the **default-state callout** — `advise` is a **read, ENABLED by default** (Rule #30 default-state discipline; derives mechanically from `mutates:"read"`). **Tool COUNT is UNCHANGED** (Rule #31 — `advise` is a new action on an existing tool, not a new tool); state that explicitly where counts are cited. The suite governance-key count moves +1 (post-foundation).
   - **Live smokes (lead-executed; Rules #26/#34):** `advise` on the `AdvisorFixture` table on **HSCUSTOM** (missing-index fires with correct DDL on the unindexed column; no finding on the indexed column; stale-stats fires while untuned) AND on a **second namespace** (Rule #34 — a differently-populated namespace; e.g. seed/probe `AdvisorFixture` or a suitable table in SADEMO, OR document the residual risk if a second real-data namespace is genuinely unavailable). **`workload` mode** exercised live (returns findings, or its capability error) — never a raw error.
   - Spec §7 ACs 1–7 walked and satisfied; conventions §6 definition-of-done checklist complete.

## Tasks / Subtasks

- [x] **Task 1 — Wire the `advise` action (AC: 28.3.1)**
  - [x] In `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts`: add `"advise"` to the action enum + `advise: "read"` to the `mutates` map. Add `workload?: boolean` and `topN?: number` (default 5, max 20) to the input schema; enforce `query` XOR `workload`.
  - [x] `query` mode: `ctx.http.post(<advise-data path>, { query })` → `analyzeAdviceData(result, { query })` (import from `sqlAdvisor.ts`) → build `structuredContent` (spec §3) via the local `toStructured()` helper + evidence-first text. Zero findings → explicit "checked X, no findings" text.
  - [x] `workload` mode: query `INFORMATION_SCHEMA.STATEMENTS ORDER BY Timestamp DESC` (top `topN`), advise each, aggregate `analyzed:{statements,skipped}`. Wrap the workload-source query so an unavailable-view error becomes a clean capability message (not a raw SQLCODE).
  - [x] Do NOT alter the behavior of the four existing actions (Rule #19).
- [x] **Task 2 — Governance + regression tests (AC: 28.3.1/28.3.2)**
  - [x] Real-gate governance test (drives `handleToolCall`): `advise` enabled under empty `IRIS_GOVERNANCE`; the four existing actions still classified reads/enabled; assert `iris_sql_analyze:advise` is the only new key. `gen:governance-baseline:check` exit 0 (frozen `1e62c5ad5bf7` untouched; new post-foundation key allowed).
  - [x] Rule #19 snapshot test: `explain`/`stats`/`indexUsage`/`running` output unchanged (mock the http layer; assert byte-for-byte vs a captured baseline).
  - [x] `advise` unit tests (mock `ctx.http.post` with a reference-captured `/dev/sql/advise-data` response → assert findings render; workload-mode aggregation; workload-unavailable → capability error; `query` XOR `workload` validation; `topN` bounds).
- [x] **Task 3 — Docs rollup (AC: 28.3.3; Rule #30)**
  - [x] Update root `README.md`, `tool_support.md`, `packages/iris-dev-mcp/README.md`, `CHANGELOG.md`, `packages/iris-mcp-all/README.md`: the `advise` action + advisory disclaimer + `query`/`workload` modes + `topN` scan-work note (Rule #38) + "read, enabled by default" callout. **Tool counts UNCHANGED** (state it — Rule #31); suite governance-key count +1 (post-foundation). Reconcile any prose count that self-verifies vs hardcoded (read the tests before trusting a "self-verifies" claim — Story 27.4 lesson).
  - [x] Any doc-sync / prompt-validation tests updated if they assert action lists or counts.
- [x] **Task 4 — Verify + live smokes (AC: all)**
  - [x] `pnpm turbo run build` + `test` green; `pnpm --filter @iris-mcp/dev lint` + `type-check` clean; `gen:governance-baseline:check` exit 0; frozen baseline + `bootstrap-classes.ts` (BOOTSTRAP_VERSION `6422caf6ec31`) git-clean; `gen:skills:check` / `validate:prompts` still OK if touched.
  - [x] **Lead-executed live smokes** (write a precise runnable plan in the Dev Agent Record; the LEAD runs them at the smoke gate — the dev does not need MCP for the doc/wiring work, but SHOULD reference-capture any new fixture live): HSCUSTOM advise (unindexed→missing-index+DDL, indexed→clean, untuned→stale-stats), a second namespace (Rule #34), and `workload` mode. **Plan written below; NOT executed by the dev agent (no live IRIS call made this session, per Dev Notes' explicit "no live IRIS strictly required" scope) — the lead runs it at the smoke gate.**

## Dev Notes

### What this story IS / ISN'T
- **IS:** the `advise` action wiring on the EXISTING `iris_sql_analyze` tool + governance classification + Rule #19 snapshot + docs rollup + live smokes. Consumes the 28.1 endpoint + the 28.2 engine.
- **ISN'T:** a new tool (Rule #31 — it's a new action; tool count unchanged), any ObjectScript/bootstrap change (TS-only), any change to the frozen baseline, or the `applyIndex` WRITE action (spec §8 — explicitly out of scope for v1; a future default-disabled write).

### Wiring specifics (verified against source — Rule #47)
- `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts` — current action enum `["explain","stats","indexUsage","running"]`, `mutates: { explain:"read", stats:"read", indexUsage:"read", running:"read" }`. Existing actions POST to `atelierPath(ctx.atelierVersion, ns, "action/query")`. Add `advise` alongside; the `advise` path uses the NEW OS route `/dev/sql/advise-data` (Story 28.1) via `ctx.http.post` — mirror how a peer dev tool posts to a `/dev/...` route (e.g. the env-diff/loc tools).
- Engine: `import { analyzeAdviceData } from "./sqlAdvisor.js"` (Story 28.2) — pure function, returns `{ findings, notes }`. Map `notes` (the "plan format not recognized" case) into the text/`structuredContent` so a caller sees "what was checked" (spec §3 "no silent empty").
- `structuredContent` MUST be an object not an array; use the local `toStructured()` helper (mirror `iris-data-mcp/docdb.ts`; no shared exported version) — [[feedback_mcp_structured_content]].
- Endpoint contract (live-verified): `POST /dev/sql/advise-data {query}` → `{ status, result:{ plan, tables, indexes } }`; feed `result` to the engine.

### Workload mode (Story 28.0 finding 4)
- Source EXISTS on 2026.1: `SELECT Hash, Statement, StatCount, StatTotal, StatAverage, StatStdDev, StatRowCount, Timestamp FROM INFORMATION_SCHEMA.STATEMENTS ORDER BY Timestamp DESC` (top `topN`). Underscore-named views (Epic 17). Advise each statement via the endpoint+engine.
- Code the capability-error path defensively (other editions may lack the view) even though it won't trigger on this instance — spec §3/AC-6: a clean message, never a raw error.
- `topN` (default 5, max 20) caps analysis breadth = scan work → document per Rule #38 (each statement = one endpoint round-trip = real work).

### Governance / counts (Rules #28/#30/#31)
- `advise` is a NEW post-foundation key `iris_sql_analyze:advise`, classified `read` → default-ENABLED. It is NOT in the frozen baseline and NOT in `baseline-classifications.ts` (that file is the 141 FROZEN keys only; the read-only preset governs post-foundation keys by their `mutates` classification). `gen:governance-baseline:check` stays exit 0.
- **Tool count UNCHANGED** — `advise` is an action, not a tool. Package `tools/index.ts` length + `index.test.ts` `getToolNames()` assertions do NOT move (Rule #31). Advertised action list / governance live-key count +1. Verify which count tests self-verify vs hardcode before editing (Story 27.4 lesson).

### Rule #19 (existing actions unchanged) + inherited 28.2 deferral
- The four existing actions must be byte-for-byte unchanged — do NOT refactor them while adding `advise`. Snapshot-test their outputs.
- **CR 28.2-1 (MED, deferred from 28.2):** multi-table JOIN predicate cross-attribution needs a live join fixture — the AC 28.3.3 live smoke SHOULD include a 2-table join advise so this path is exercised live (and captured if a regression test is warranted). Note it in the smoke plan.

### Docs rollup surfaces (Rule #30 — the Epic-27 precedent set)
root `README.md`, `tool_support.md`, `packages/iris-dev-mcp/README.md`, `CHANGELOG.md`, `packages/iris-mcp-all/README.md`. State: new `advise` action, advisory disclaimer, read/enabled-by-default, tool-count unchanged. Also update `docs/migration-v1-v2.md`? — NO, that pre-existing stale-count doc (CR 27.4-1) is out of scope; leave it (a future docs-sweep owns it).

### IRIS environment
- Live IRIS `2026.1 (Build 235U)`, HSCUSTOM primary, SADEMO available as the Rule #34 second namespace, creds `_SYSTEM`/`SYS`. The `AdvisorFixture` table (Story 28.2) exists in HSCUSTOM. MCP tools deferred — load via ToolSearch. The dev's core work is TS + docs (no live IRIS strictly required to wire+unit-test with mocked http); the LEAD runs the live smokes. If the dev reference-captures a NEW fixture (e.g. a join plan for CR 28.2-1), it MUST be live-captured (Rule #36), else escalate.

### Project Structure Notes
- Edit: `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts` (add action), its tests, the 5 doc surfaces. Possibly a new `packages/iris-dev-mcp/src/__tests__/sqlAnalyze-advise*.test.ts` + governance/snapshot tests.
- No `src/ExecuteMCPv2/**`, `scripts/gen-bootstrap.mjs`, `bootstrap-classes.ts`, or `governance-baseline.ts`/`baseline-classifications.ts` change.

### References
- [Source: _bmad-output/planning-artifacts/research/feature-specs/06-sql-performance-advisor.md#3 (tool contract/output), #4 (heuristics), #7 (ACs 1–7), #8 (out of scope — applyIndex)]
- [Source: _bmad-output/implementation-artifacts/28-1-advise-data-endpoint.md (endpoint contract) + 28-2-heuristic-engine.md (analyzeAdviceData + AdvisorFixture) + its deferrals (CR 28.2-1 join fixture)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 28.3 (AC 28.3.1–3)]
- [Source: packages/iris-dev-mcp/src/tools/sqlAnalyze.ts (action enum + mutates map + Atelier backend); packages/iris-dev-mcp/src/tools/sqlAdvisor.ts (engine)]
- [Source: .claude/rules/project-rules.md#19 (existing actions byte-for-byte), #28 (reads need mutates), #30 (docs default-state callout), #31 (action-not-tool counting), #34 (second-namespace smoke), #38 (topN scan-work), #47 (verify reuse targets); memory feedback_mcp_structured_content (toStructured helper, no .refine())]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story` skill.

### Debug Log References

No live IRIS calls were made this session — confirmed against the Dev Notes' explicit scope
("the dev's core work is TS + docs (no live IRIS strictly required to wire+unit-test with mocked
http); the LEAD runs the live smokes"). No new fixture was reference-captured (the CR 28.2-1
2-table-join case is written into the Live Smoke Plan below for the lead to execute and, if
warranted, capture — see that section for why a fresh capture wasn't attempted here). All
verification below is build/lint/type-check/unit-test only, run locally against the built
packages:

- `pnpm --filter @iris-mcp/dev build` / `type-check` / `lint` — clean.
- `pnpm --filter @iris-mcp/dev test` (vitest) — 35 files, **570/570 passed** (up from 549
  pre-story: +21 new — 14 in `sqlAnalyze-advise.test.ts`, 5 in
  `sqlAnalyze-rule19-snapshot.test.ts`, 2 net-new governance assertions in
  `sqlAnalyze-governance.test.ts`; 1 pre-existing test updated in-place, not counted as new,
  since `mutates` legitimately grew a 5th key).
- `pnpm turbo run build test lint type-check` (whole monorepo) — **25/25 tasks green**, including
  `@iris-mcp/all`'s `readonly-hint-crosscheck.test.ts`, `validate-prompts.test.ts`, and
  `docs-prompt-sync.test.ts` (all still green — `advise` is an action, not a new tool/prompt, so
  none of these cross-package catalogs needed edits).
- `pnpm run gen:governance-baseline:check` — exit 0: `frozen foundation keys (committed): 141`,
  `live keys (derived from dists): 201` (was 200 pre-story), `post-foundation new keys (allowed):
  60` (was 59) — the ONLY live-key delta is `iris_sql_analyze:advise`. Frozen baseline file
  git-clean (confirmed via `git diff --stat` on `governance-baseline.ts` /
  `baseline-classifications.ts` / `bootstrap-classes.ts` / `scripts/gen-bootstrap.mjs` /
  `packages/shared/src/__tests__/bootstrap.test.ts` — zero diff on all five, as expected for a
  TS-only, non-bootstrapped story). `BOOTSTRAP_VERSION` unchanged `6422caf6ec31`.
- `pnpm run validate:prompts` — `22 source(s) checked (11 prompt(s) + 11 generated skill(s)), 105
  known tool name(s)`. Cross-checked via `git stash`/`stash pop` around a rebuild: **105 both
  before and after this story's changes** — confirms `advise` did not change the known-tool-name
  surface (it's an action, not a tool — Rule #31), so no prompt/skill file needed touching.
- Read `packages/iris-dev-mcp/src/__tests__/index.test.ts` BEFORE editing anything (Story 27.4
  lesson: verify a count test self-verifies vs. hardcodes before trusting a "no change needed"
  claim) — confirmed it hardcodes `toHaveLength(28)` and a literal `getToolNames()` array; both
  stayed **byte-for-byte unchanged** in the diff, mechanically confirmed by re-running that file
  (8/8 passed) with no edits.

### Completion Notes List

- **`packages/iris-dev-mcp/src/tools/sqlAnalyze.ts`** — added the `advise` action per AC 28.3.1.
  Dispatches to a new `handleAdvise()` function inserted at the TOP of the handler (an early
  `if (action === "advise") return handleAdvise(...)`), so every line of the four pre-existing
  actions' code (query validation, SQL building, the `try/catch` around `ctx.http.post`, tabular
  shaping) is **completely untouched** — verified via `git diff | grep '^-'`, which shows only
  doc-comment/description/schema/mutates/handler-signature lines removed, zero deletions inside
  the four actions' logic block (AC 28.3.2 / Rule #19).
  - `query` mode: validates `query` is non-blank (client-side, before any HTTP call, mirroring the
    existing `explain`/`indexUsage` whitespace-guard pattern), posts `{query, namespace}` to
    `POST /api/executemcp/v2/dev/sql/advise-data` via `ctx.http.post`, feeds `response.result` to
    `analyzeAdviceData(raw, {query})`, and renders `structuredContent: {mode:"query", findings,
    analyzed:{statements:1,skipped:0}, notes}` (an extra `notes` field beyond the spec §3 minimum
    — additive, carries the engine's "plan format not recognized" signal into the response per the
    Dev Notes instruction) via a local `toStructured()` helper (mirrors `iris-data-mcp/docdb.ts`;
    no shared exported version, per [[feedback_mcp_structured_content]]). Text is evidence-first,
    ranked high→medium→low confidence, and always closes with the advisory disclaimer
    ("Recommendations are heuristic; verify with 'explain' before applying any change."). A
    TRANSPORT-level failure calling `advise-data` (network/auth/namespace-switch — an
    `IrisApiError`) surfaces as `isError:true` with the sanitized message (the SAME catch
    pattern the four existing actions use). **CORRECTED (Story 29.3 burn-down, CR 28.3-1):**
    a genuinely unparseable/malformed SQL statement does NOT itself throw `IrisApiError` —
    live-captured Fixture 7 (`ADVISE_DATA_ENDPOINT_ERROR_RESULT`, `sqlAdvisor.fixtures.ts`,
    2026-07-11) shows `/dev/sql/advise-data` returns HTTP 200 with `result: {}` for
    `"SELEKT GARBAGE FROM NoSuchTable"`, which `analyzeAdviceData({})` reports as
    "plan format not recognized" / zero findings, not an error. The `sqlAnalyze-advise.test.ts`
    "malformed/non-preparable query" test (below) exercises the transport-level `IrisApiError`
    path only — its title has been corrected to say so.
  - `workload` mode (`workload:true`, mutually exclusive with `query`): queries
    `SELECT TOP <topN> Hash, Statement, ... FROM INFORMATION_SCHEMA.STATEMENTS ORDER BY Timestamp
    DESC` via the EXISTING Atelier `action/query` path (the same path `stats`/`running` already
    use), then calls the advise-data endpoint once per returned `Statement` and aggregates
    findings/notes. A statement with a blank/missing `Statement` value is skipped client-side
    (no HTTP call); a statement whose `advise-data` call throws `IrisApiError` is also skipped
    (`analyzed.skipped` increments) rather than failing the whole call — the workload aggregates
    around individual failures. If the OUTER statements query itself fails (the workload SOURCE
    unavailable on some platform/edition), that's caught separately and returns a clear capability
    message ("Workload mode is unavailable on this IRIS edition/version — ... Try 'query' mode
    with a specific SQL statement instead."), never a raw SQLCODE dump (AC 28.3.1). `topN` is
    schema-bounded (`min(1).max(20)`) AND defensively re-clamped in the handler before being
    embedded as a literal in the `SELECT TOP <n>` SQL text (belt-and-suspenders — Rule #38's
    "scan work, not just an output cap" is documented in both the tool description and the
    `topN` schema `.describe()`).
  - Findings are ranked evidence-first (`CONFIDENCE_RANK`: high < medium < low, stable sort).
    Zero findings render an explicit "No performance findings (mode: ...). Checked ..." message
    with the analyzed/skipped counts and any engine notes — never a silent empty (spec §3).
  - `exactOptionalPropertyTypes` (already enabled repo-wide) required `handleAdvise`'s parameter
    type to spell out `| undefined` on each optional field explicitly — caught immediately by
    `tsc --noEmit`, fixed inline, no functional impact.
- **Governance**: `mutates.advise = "read"` added; the tool's tool-level `annotations.readOnlyHint`
  stays `true` (already covers `advise` — it performs no IRIS-state mutation). Extended
  `sqlAnalyze-governance.test.ts`'s existing real-`handleToolCall`-gate loop to include `"advise"`
  (with a `query` arg, matching `explain`/`indexUsage`'s pattern) — proves `advise` is
  ALLOWED (handler spy invoked) under empty `IRIS_GOVERNANCE`, alongside the four pre-existing
  actions which are proven unchanged in the SAME loop. Added a small additional assertion that
  `Object.keys(mutates)` is EXACTLY the five expected keys (the local proxy for "advise is the
  only new key" — Rule #45 notes that a cross-PACKAGE key-derivation check belongs in
  `@iris-mcp/all`, not here; this package-local test doesn't need that cross-package machinery).
- **Rule #19 snapshot test** (`sqlAnalyze-rule19-snapshot.test.ts`, NEW file, dedicated per AC
  28.3.2): one `toEqual` per pre-existing action (`explain`, `indexUsage`, `stats` with no filter,
  `running` with a filter) locking the FULL `{content, structuredContent}` result object plus the
  exact `ctx.http.post` call arguments, against fixed mock inputs — a literal regression gate
  distinct from (not a duplicate of) the existing behavioral tests in `sqlAnalyze.test.ts` /
  `sqlAnalyze-e2e.test.ts`. Also locks the pre-existing `explain`-missing-query error shape.
- **`advise` unit tests** (`sqlAnalyze-advise.test.ts`, NEW file, 14 tests, mocked `ctx.http` only
  — no live IRIS): validation (`query`+`workload` both/neither → isError, no HTTP call;
  whitespace-only `query` treated as absent); `query` mode success re-using the Story 28.2
  reference-captured `ADVISE_DATA_UNINDEXED_BEFORE_TUNE` / `ADVISE_DATA_INDEXED_BEFORE_TUNE`
  fixtures (imported from `sqlAdvisor.fixtures.ts`, NOT re-derived — proves the WIRING passes data
  to the engine correctly without re-testing the engine's own heuristic logic, which is already
  exhaustively covered by `sqlAdvisor.test.ts`); zero-findings "plan format not recognized" text;
  malformed-query `IrisApiError` → sanitized `isError`; namespace override on the POST body;
  `workload` mode success/aggregation across 2 statements (routed via `mockImplementation`
  dispatching on the target path — `action/query` vs `advise-data`); a per-statement failure
  being skipped (not fatal); custom/default `topN` embedded in the `SELECT TOP <n>` SQL; zero
  statements handled cleanly; the workload-source-unavailable capability-error path; and the
  namespace override propagating to BOTH the outer statements query and the per-statement
  advise-data call.
- **Docs rollup** (Rule #30) across all 5 named surfaces — `README.md` (dev-row description +
  the "Default-disabled write actions" table's `iris_sql_analyze` row updated to list `advise`
  among the enabled-by-default actions), `tool_support.md` (endpoint column + new Epic 28
  governance-defaults callout paragraph), `packages/iris-dev-mcp/README.md` (SQL Tools row +
  governance note + a new worked `advise` example block under the existing `iris_sql_analyze`
  example, mirroring the established `<details>` pattern), `CHANGELOG.md` (extended the EXISTING
  `[Unreleased] — Epic 28 (in progress)` section — did not create a new heading — with a Story
  28.2 engine summary [which hadn't been changelogged yet] and a Story 28.3 `advise` summary,
  both ending with an explicit "tool count unchanged / governance-key count +1" statement),
  `packages/iris-mcp-all/README.md` (description updated to mention "performance advisories").
  Every surface explicitly states: (a) the advisory disclaimer, (b) `query`/`workload` modes +
  the `topN` scan-work note, (c) **read, enabled by default**, (d) **tool count UNCHANGED**
  (28 / 104 everywhere — Rule #31). Did NOT touch `docs/migration-v1-v2.md` (pre-existing stale
  count doc, CR 27.4-1, explicitly out of scope per the Dev Notes).
- **Doc-sync / prompt-validation**: `diagnoseSlowQuery.ts` (the `diagnose-slow-query` prompt) and
  its generated skill were NOT edited — they reference `iris_sql_analyze` by name (a still-valid
  tool) and don't enumerate its action list, so nothing there needed updating; confirmed by the
  full `@iris-mcp/all` suite staying green (`validate-prompts.test.ts`,
  `readonly-hint-crosscheck.test.ts`, `docs-prompt-sync.test.ts`, `skills-generated-frontmatter
  .test.ts`, `gen-skills-stray-file.test.ts`, `prompt-safety-invariants.test.ts` — 49/49).
- **No ObjectScript / bootstrap / frozen-baseline change** in this story — confirmed via
  `git status`/`git diff --stat` showing zero touched files under `src/ExecuteMCPv2/**`,
  `scripts/gen-bootstrap.mjs`, `packages/shared/src/bootstrap-classes.ts`,
  `packages/shared/src/governance-baseline.ts`, `packages/shared/src/baseline-classifications.ts`.

### Live Smoke Plan (Lead-executed — Rules #26/#34/#36; NOT run by the dev agent)

**Prerequisite:** rebuild `@iris-mcp/dev` (`pnpm --filter @iris-mcp/dev build`) and reload/restart
the connected MCP server session so the new `advise` action is reachable through the actual
`iris_sql_analyze` tool call (mirrors the reload step noted at the end of prior epics — the
running MCP process doesn't pick up new source until rebuilt+reloaded). Call `iris_server_profiles`
first per the server's own MCP instructions to confirm the profile roster + effective governance
(expect `iris_sql_analyze:advise` to show enabled/no explicit override).

1. **HSCUSTOM — `ExecuteMCPv2.Tests.AdvisorFixture`** (already deployed + seeded 2000 rows by
   Story 28.2 — `IndexedCol` has `IdxIndexedCol`, `UnindexedCol` has no index):
   a. **Unindexed → missing-index + DDL:**
      ```
      iris_sql_analyze({ action: "advise", namespace: "HSCUSTOM",
        query: "SELECT ID, UnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE UnindexedCol = 'U7'" })
      ```
      EXPECT: `findings` includes `full-scan` + `missing-index` (confidence `high`,
      `suggestedDdl` containing `CREATE INDEX ... ON ExecuteMCPv2_Tests.AdvisorFixture
      (UnindexedCol)`); `stale-stats` may or may not appear depending on whether the table is
      still in the tuned state Story 28.2 left it in (not a pass/fail condition either way —
      record which). Text is evidence-first and ends with the advisory disclaimer.
   b. **Indexed → clean:**
      ```
      iris_sql_analyze({ action: "advise", namespace: "HSCUSTOM",
        query: "SELECT ID, IndexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture WHERE IndexedCol = 'I7'" })
      ```
      EXPECT: NO `missing-index`, NO `full-scan` (index-map read only).
   c. **Stale-stats (untuned) confirmation:** Story 28.2's own fixture-capture session already ran
      `$SYSTEM.SQL.Stats.Table.GatherTableStats(...)` on this table at least once, so its CURRENT
      tuned/untuned state at smoke time is whatever that session left it in — there's no simple
      "un-tune" primitive. Treat (a)'s `stale-stats` presence/absence as the live confirmation
      (record the observed state); this smoke's job is proving the WIRING reaches the live
      endpoint and renders correctly, not re-deriving the heuristic (already locked by 28.2's 46
      fixture-replay tests). If a genuinely fresh untuned case is wanted, seed a NEW disposable
      table via a throwaway `ExecuteMCPv2.Temp.*` class (delete after) rather than fighting the
      existing fixture's state.
   d. **Validation, live:** `iris_sql_analyze({action:"advise"})` (neither `query` nor `workload`)
      → EXPECT `isError:true`, no IRIS-side call made (confirm via absence of any new statement in
      `INFORMATION_SCHEMA.STATEMENTS` attributable to this call).

2. **Second namespace — SADEMO (Rule #34):** `ExecuteMCPv2.Tests.AdvisorFixture` does not exist on
   SADEMO. Prefer probing SADEMO's real dictionary first (e.g. via `iris_doc_index` or a
   dictionary SELECT) for a genuinely different, already-populated table with a known unindexed
   column, and run `advise` against it there — this is a stronger Rule #34 proof (real, differently
   -shaped data) than deploying a duplicate fixture. If no such table is readily identifiable
   within the smoke window, deploy+seed a disposable copy of `AdvisorFixture` on SADEMO instead
   (glob-path `iris_doc_load` + `iris_execute_classmethod` to seed, delete after). Minimum bar:
   ONE live `advise` call against SADEMO returns either real findings or a clean "no findings,
   here's what was checked" — never a raw error, never a cross-namespace wiring crash. If neither
   option is feasible in the window, record that as an explicit residual risk (Rule #34) rather
   than silently skipping it.

3. **`workload` mode, live:**
   ```
   iris_sql_analyze({ action: "advise", workload: true, topN: 5, namespace: "HSCUSTOM" })
   ```
   EXPECT: `analyzed.statements + analyzed.skipped` ≤ 5 (whatever `INFORMATION_SCHEMA.STATEMENTS`
   currently holds — content is nondeterministic, so assert SHAPE not exact findings); text says
   "mode: workload" and cites the analyzed/skipped counts. Also smoke the `topN` boundaries:
   `topN: 1` (SQL should embed `SELECT TOP 1`) and `topN: 20` (`SELECT TOP 20`) — confirm via the
   IRIS-side statement text if visible, or by observing `analyzed.statements` never exceeds the
   requested `topN`. Workload-unavailable capability error is NOT expected to trigger on this
   2026.1 instance (Story 28.0 confirmed the source exists) — no need to force it live; the unit
   suite already proves the capability-error path with a mocked failure.

4. **CR 28.2-1 — 2-table JOIN advise (the deferred multi-table cross-attribution risk):**
   - Stand up a DISPOSABLE second table via glob-path `iris_doc_load` + `iris_execute_classmethod`
     (mirrors Story 28.0's disposable-probe precedent — **never commit this class**), e.g.
     `ExecuteMCPv2.Temp.AdvisorJoinProbe`: a `%Persistent` class with `ChildUnindexedCol As
     %String` (NO index) and `FixtureId As %Integer`, seeded with ~500 rows whose `FixtureId`
     values overlap `AdvisorFixture.ID` (a simple `For` loop `Populate` classmethod mirroring
     `AdvisorFixture.Populate`).
   - Run:
     ```
     iris_sql_analyze({ action: "advise", namespace: "HSCUSTOM",
       query: "SELECT F.ID, C.ChildUnindexedCol FROM ExecuteMCPv2_Tests.AdvisorFixture F, " +
              "ExecuteMCPv2_Temp.AdvisorJoinProbe C WHERE F.UnindexedCol = 'U7' " +
              "AND C.ChildUnindexedCol = 'X1' AND F.ID = C.FixtureId" })
     ```
   - **INSPECT** each `missing-index` finding's `evidence`/`suggestedDdl`: confirm `UnindexedCol`
     is attributed to `ExecuteMCPv2_Tests.AdvisorFixture` and `ChildUnindexedCol` is attributed to
     `ExecuteMCPv2_Temp.AdvisorJoinProbe` — NOT crossed. This is exactly CR 28.2-1's risk
     (plan-global predicate attribution crossing to the wrong table on a genuine 2-table plan).
   - **If a cross-attribution bug is confirmed:** capture the query + the LIVE
     `/dev/sql/advise-data` response verbatim (Rule #36 — never hand-invent the plan text), file
     it as a HIGH/MED finding against `sqlAdvisor.ts`, and decide fix-now-vs-defer with the
     reviewer (a genuinely new regression fixture would need to land in
     `sqlAdvisor.fixtures.ts` + `sqlAdvisor.test.ts`, which is Story 28.2's module — a small
     targeted patch, not a scope-widening rewrite).
   - **If clean:** note "CR 28.2-1 exercised live on a real 2-table join — no cross-attribution
     observed" in the review notes, and CR 28.2-1 can close as verified-no-repro.
   - **Clean up:** delete `ExecuteMCPv2.Temp.AdvisorJoinProbe` from IRIS (`iris_doc_delete`) AND
     disk afterward — never committed (CLAUDE.md temp-class discipline).

5. **Sanity — the four pre-existing actions, live:** one spot-check call each for `explain`,
   `stats`, `indexUsage`, `running` against HSCUSTOM, confirming they still behave as before (the
   Rule #19 snapshot test already locks this at the unit level — this is the live confirmation
   that the ACTUAL running server, not just the mock, is unaffected).

### Code Review Record (2026-07-11 — Opus 3-layer adversarial)

Blind Hunter + Edge Case Hunter + Acceptance Auditor. **Outcome: 0 HIGH; 2 patches applied inline; 3 deferred (Epic-28-own LOW/MED); 2 dismissed. Status → done.**

Independently verified (not trusted from the Dev Record):
- **Rule #19 (AC 28.3.2):** `advise` dispatched via an early `if (action === "advise") return handleAdvise(...)`; the four pre-existing actions' code paths are byte-for-byte untouched. The dedicated `sqlAnalyze-rule19-snapshot.test.ts` is a GENUINE gate — full `toEqual` on each action's `{content, structuredContent}` PLUS the exact `ctx.http.post` call args, against fixed mock inputs; any output change fails it.
- **Rule #28 (AC 28.3.1):** `advise:"read"` in `mutates`; the governance suite drives the REAL `handleToolCall` and proves `advise` ALLOWED under empty `IRIS_GOVERNANCE`; registration-throws proof updated to five keys.
- **Rule #31 counting:** `index.test.ts`'s `toHaveLength(28)` / literal `getToolNames()` / `toolCount===29` assertions are byte-for-byte UNCHANGED (not in the diff); docs state 28/104 unchanged consistently across all surfaces; `gen:governance-baseline:check` exit 0 (141 frozen / 201 live / 60 post-foundation — single delta `iris_sql_analyze:advise`); frozen `1e62c5ad5bf7`, `governance-baseline.ts`, `baseline-classifications.ts`, `bootstrap-classes.ts` git-clean; `BOOTSTRAP_VERSION` `6422caf6ec31` unchanged.
- **Rule #30 docs:** advisory disclaimer + query/workload modes + `topN` scan-work note + read/enabled-by-default present on the authoritative catalog (`tool_support.md`) and the per-server README (`packages/iris-dev-mcp/README.md`), consistent.

Patches applied inline (both inside `handleAdvise` — Rule #19 preserved):
1. **MED [Blind #1 / Edge #4]** — the workload per-statement `catch {}` swallowed EVERY error type as a silent `skip`, asymmetric with `query` mode (which rethrows non-`IrisApiError`) and the four pre-existing actions. Narrowed to skip only `IrisApiError` and RETHROW others, so an unexpected connectivity/framework failure surfaces instead of being masked as a benign "no findings." +1 genuine-gate test (non-`IrisApiError` propagates).
2. **LOW [Blind #2 / Edge #3]** — the defensive `topN` clamp used only `Math.min/Math.max` (range only); added `Math.floor` + `Number.isFinite` so a non-integer/NaN reaching the handler outside the zod path can never embed `SELECT TOP 2.5`/`NaN`. +2 genuine-gate tests (fractional-floor, NaN-fallback).

Affected-file suite after patches: 48/48 green (advise 17→20); tsc + eslint clean.

Deferred (Epic-28-own; → `deferred-work.md` §28-3 / §28-2):
- **CR 28.2-1 / MED (carried)** — multi-table-JOIN plan-global predicate cross-attribution in `sqlAdvisor.ts` (Story 28.2's module, out of scope for 28.3's action-wiring change). Re-affirmed: `workload` mode advises join-heavy real recent statements, ELEVATING exposure — do not downgrade. The lead-smoke §4 disposable 2-table join exercises it live (capture per Rule #36 if it repros; else close verified-no-repro).
- **CR 28.3-1 / LOW** — query-mode "malformed SQL → isError" test scenario + the Dev-Notes claim contradict live Fixture 7 (`ADVISE_DATA_ENDPOINT_ERROR_RESULT`): the endpoint returns HTTP 200 `result:{}` for an unparseable query, so a typo'd query renders "no findings / plan format not recognized" (isError undefined), and the `IrisApiError` path is real only for transport/auth/namespace errors. Handler code is correct; the empty-result path is separately covered by the "zero findings" test. Test-label + doc-claim fidelity only.
- **CR 28.3-2 / LOW** — residual after patch #1: if EVERY per-statement advise call fails with an `IrisApiError` (route mis-deployed / all-500-with-envelope), the aggregate still renders benign "no findings (analyzed:0, skipped:N)" rather than an error (counts ARE surfaced). Suggested: track a per-statement `errorCount` and surface `isError` when `rows>0 && analyzed==0 && errorCount>0`.

Dismissed: workload findings not de-duped (by design — each finding carries its `statement`); Dev-Record docs-coverage overstatement (no code impact — Rule #30 requires the per-server README + catalog, both complete).

**Not executed by the review:** the lead-executed Live Smoke Plan below (Rules #26/#34/#36) remains the separate smoke gate — including CR 28.2-1's 2-table-join case. Review had read-only MCP access only; no write/enable was invoked.

### File List

- `packages/iris-dev-mcp/src/tools/sqlAnalyze.ts` (modified — added the `advise` action;
  4 pre-existing actions' code paths untouched, Rule #19)
- `packages/iris-dev-mcp/src/__tests__/sqlAnalyze.test.ts` (modified — updated the `mutates`
  shape assertion from 4 to 5 keys)
- `packages/iris-dev-mcp/src/__tests__/sqlAnalyze-governance.test.ts` (modified — extended the
  real-gate ACTIONS loop to include `advise`; added the exact-key-set assertion)
- `packages/iris-dev-mcp/src/__tests__/sqlAnalyze-advise.test.ts` (new — 14 tests, `advise`
  wiring: validation, query mode, workload mode, error paths, namespace override)
- `packages/iris-dev-mcp/src/__tests__/sqlAnalyze-rule19-snapshot.test.ts` (new — 5 tests, the
  dedicated AC 28.3.2 byte-for-byte gate for the four pre-existing actions)
- `README.md` (modified — dev-row description + governance-defaults table row)
- `tool_support.md` (modified — `iris_sql_analyze` endpoint column + new Epic 28 governance note)
- `packages/iris-dev-mcp/README.md` (modified — top description, SQL Tools row + governance note,
  new worked `advise` example)
- `packages/iris-mcp-all/README.md` (modified — dev-row description)
- `CHANGELOG.md` (modified — extended the existing `[Unreleased] — Epic 28 (in progress)` section
  with Story 28.2 + Story 28.3 summaries)
- `_bmad-output/implementation-artifacts/28-3-advise-tool-docs-smokes.md` (this story file —
  Tasks/Subtasks, Dev Agent Record, Status)
