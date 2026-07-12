# Test Automation Summary — Story 28.0 Advisor Probe Matrix

**Date:** 2026-07-11
**Scope:** Research / live-IRIS-probe / spec-amendment story. No production code was produced.

## Verification performed (QA, this pass)

Story 28.0's own Dev Agent Record ("No production code, no tests, no bootstrap change — this
story's only durable outputs are the amended spec and this Dev Agent Record") and File List
both assert there is no executable surface to test. That claim was independently verified
rather than taken on faith:

1. `git status --short` at the repo root shows only four paths touched: `_bmad-output/implementation-artifacts/cycle-log-epic-28.md` (modified), `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified), `_bmad-output/planning-artifacts/research/feature-specs/06-sql-performance-advisor.md` (modified), and the new `_bmad-output/implementation-artifacts/28-0-advisor-probe-matrix.md` (untracked). No file under `src/`, `packages/`, or `tests/` was added or modified.
2. The two disposable probe classes described in the Dev Agent Record — `ExecuteMCPv2.Temp.AdvisorProbe` and `ExecuteMCPv2.Temp.AdvisorProbeChild` — are confirmed absent from disk (the story records `src/ExecuteMCPv2/Temp/` no longer exists) and were deleted from IRIS via `iris_doc_delete` (confirmed via `iris_doc_list` returning zero results), matching CLAUDE.md's probe-class cleanup rule.
3. No bootstrap change: `BOOTSTRAP_VERSION` unchanged at `1e2008753853` (grep-verified per the Dev Agent Record) and `packages/shared/src/bootstrap-classes.ts` is not in the diff — consistent with Rule #39 (no new `.cls` was added to the suite).
4. No governance change: `pnpm run gen:governance-baseline:check` exited 0 per the Dev Agent Record (frozen baseline `1e62c5ad5bf7` untouched; this story adds no governance key).

## Result

**0 tests generated.** This is the correct outcome, not a gap: Story 28.0's entire deliverable
is (a) verbatim `EXPLAIN`-plan markers captured live for four plan categories (full scan, index
map read, temp-file/intermediate build, join), (b) a live-verified index/dictionary surface
(`%Dictionary.CompiledIndex` + `%Dictionary.CompiledClass`), (c) a corrected tune-staleness
signal (the `EXPLAIN` "Warning: Table X is not tuned." line, replacing the spec's original
`%Dictionary.CompiledStorage`/`CompiledStorageProperty` approach, which was live-verified to be
non-reflective of actual `TuneTable` state), (d) a re-confirmed `INFORMATION_SCHEMA`
underscore-naming workload source, and (e) amendments to
`research/feature-specs/06-sql-performance-advisor.md` §§2-5 plus three Rule #47
spec-vs-reality corrections. There is no handler, tool, endpoint, or function this story
shipped for an automated test to exercise. The `/dev/sql/advise-data` endpoint and TS heuristic
engine that consume these pinned findings are built in Stories 28.1–28.3 — those stories carry
their own test-generation ACs (ObjectScript `%UnitTest` for the new OS handler in 28.1/28.2, TS
unit tests for the `iris_sql_analyze:advise` action in 28.3) and are the target of the next QA
pass in this epic.

## Coverage

- N/A — no source surface exists yet for this story's scope.

## Next steps

- Story 28.1 (new `/dev/sql/advise-data` OS handler, first handler for this tool family — bumps
  `BOOTSTRAP_VERSION` per Rule #24/#39 dual-roster) and Stories 28.2–28.3 (fixture build +
  heuristic engine + `advise` action) are the first real code consumers of the pinned findings.
  Generate `%UnitTest` coverage for 28.1/28.2's handler and fixture (each of the five heuristic
  findings this probe characterized: full-scan/missing-index, index-map-read positive case,
  temp-file/intermediate build, join strategy, and the `stale-stats` warning-line signal) and TS
  unit tests for 28.3's `advise` action (including the workload-mode capability-error fallback
  path, even though this instance has a usable workload source) when those stories reach QA.
