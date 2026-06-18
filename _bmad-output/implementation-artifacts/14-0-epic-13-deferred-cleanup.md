# Story 14.0: Epic 13 Deferred Cleanup

Status: done

## Story

As a developer,
I want every open `deferred-work.md` item formally re-triaged against Epic 14's scope,
so that Epic 14 (Platform Foundation) begins with an explicit backlog state and no prior-epic lesson is silently forgotten.

## Context

Epic 13 (Post-Epic-12 Tooling Enhancements) completed 2026-04-23 with 2/2 stories. Its retrospective was **skipped** per user direction (commit `079ed17`), so there is no `epic-13-retro-*.md` to triage. Per the `/epic-cycle` retro-review gate, when the prior retro is absent but `deferred-work.md` carries open items, the gate runs off `deferred-work.md` rather than skipping.

This story is the **retro-review gate artifact** for Epic 14. It is a **triage record only** — no code is changed. Epic 14 is a strictly-additive Platform Foundation epic (multi-server profiles, governance cascade, MCP resources capability) whose "no breaking changes" guarantee is a release gate. None of the open `deferred-work.md` items intersect Epic 14's scope; all are LOW / INFO / cosmetic / "future hardening pass" items already triaged across Stories 7.0, 8.0, 9.0, and 12.0. The one genuinely-new item (Epic 13 CR 13.2 — `@iris-mcp/ops` tool-count drift in the docs) is a documentation inconsistency that **Story 14.6 (Documentation Rollup)** will naturally correct, so it is routed there rather than fixed here.

**Triage result**: **0 INCLUDE**, **all DEFER** (with the ops tool-count drift routed to Story 14.6). No actionable cleanup lands in Epic 14's foundation work; every item is explicitly carried forward with rationale.

## Acceptance Criteria

1. **AC 14.0.1** — [`deferred-work.md`](deferred-work.md) gains a `## Triaged via Story 14.0 (2026-06-15)` closure section that records the disposition (DEFER / ROUTE) of every open item, append-only (no prior entries rewritten or removed).
2. **AC 14.0.2** — The `@iris-mcp/ops` tool-count drift (CR 13.2) is explicitly routed to Story 14.6 (Documentation Rollup) in the triage record, so the Epic 14 docs-rollup story picks it up.
3. **AC 14.0.3** — No source code changes (no TypeScript, no ObjectScript). No `BOOTSTRAP_VERSION` bump. Only touched files: `_bmad-output/implementation-artifacts/deferred-work.md`, `sprint-status.yaml`, and this story file.
4. **AC 14.0.4** — Story 14.0 is committed separately from Story 14.1 to preserve per-story git history (epic-cycle Rule SC-3).

## Triage Table — Carried-forward items (retained open after Story 12.0)

| # | Source | Item | Decision | Rationale |
|---|---|---|---|---|
| 1 | Epic 11 retro #1 | Run pre-publish smoke test (Story 9.3 rerun) | **DEFER** (publishing checklist) | Belongs to the pre-publish session, not an additive foundation epic. |
| 2 | Epic 11 retro #3 | Update `/bmad-retrospective` skill to enforce Rules-codification step | **DEFER** | Skill-workflow automation; Rule #1 is self-enforcing. Low urgency. Not Epic 14 scope. |
| 3 | Epic 11 retro #6 | Generalize locale prefix-strip beyond EN/AR (FR, DE, …) | **DEFER** | LOW; HSCUSTOM is `enuw`. Future hardening pass. Not Epic 14 scope. |
| 4 | CR 10.1 | `generated` query param ignored on `/modified/{ts}` Atelier branch | **DEFER** | Pre-existing `doc.ts` inconsistency; fix spans two tools. Not Epic 14 scope. |
| 5 | CR 10.1 | Digit-prefixed "package" rows (e.g., `"2"`) | **DEFER** | Documented behavior with `category:"CLS"` workaround. Not worth synthetic bucketing. |
| 6 | CR 10.2 | `.manifest.json.tmp` cleanup on rename failure | **DEFER** | LOW; next run overwrites. |
| 7 | CR 10.2 | Weird doc-name edge cases in `docNameToFilePath` | **DEFER** | LOW; Atelier not observed to emit such names. |
| 8 | CR 11.3 | `%ResultSet.Close()` not closed on exception path — `Config.cls DatabaseList()` | **DEFER** | LOW; refcount-driven cleanup. Future Config-handler hardening pass. |
| 9 | CR 11.3 | `%ResultSet.Close()` not closed on exception path — `SystemConfig.cls` locale branch | **DEFER** | LOW; same shape as #8. |
| 10 | CR 11.1 | Prefix-strip only handles EN + AR; other locales double-wrap | **DEFER** | LOW for this project (`enuw`). Generalize via `DecomposeStatus` if multi-locale matters. |
| 11 | CR 11.1 | `Use tInitIO` without mnemonic clause — stale mnemonic binding | **DEFER** | Latent only; Epic 11 live verification confirmed current restore is sufficient. |
| 12 | Epic 8.x legacy | Duplicate `getIntegrationConfig` helpers; DRY env-var docs; missing `package.json` fields | **DEFER** (cosmetic / publishing checklist) | Unchanged from Story 9.0 / 12.0 closure. Retained without rework. |

## Triage Table — Epic 12 code-review deferrals (new since Story 12.0)

| # | Source | Item | Decision | Rationale |
|---|---|---|---|---|
| 13 | CR 12.1 | No test for `changePasswordOnNextLogin: false → 0` path | **DEFER** | LOW; trivial symmetric branch. Future test-hardening pass. Not Epic 14 scope. |
| 14 | CR 12.2 | `tTimeout=0` silently overridden to 120 | **DEFER** | LOW; pre-existing default behavior. No reported incidents. |
| 15 | CR 12.2 | CHANGELOG ordering — BUG-3 above BUG-1 in `### Fixed` | **DEFER** | Cosmetic; same block, no functional impact. |
| 16 | CR 12.2 | Test-count delta +2 vs AC-stated +3–4 | **DEFER** (INFO) | Coverage complete via pre-existing tests; discrepancy is in stated count only. |
| 17 | CR 12.3 | `ProductionSummary` hardcodes stateCode 2 / "Stopped" for never-started productions | **DEFER** | LOW; closest valid sentinel, matches live-verified behavior. |
| 18 | CR 12.3 | New create unit test partially duplicates pre-existing test | **DEFER** | LOW; harmless redundancy. |
| 19 | CR 12.3 | Delete running-check guards only state=1, not 4/5 | **DEFER** | LOW; pre-existing. Future hardening could extend the guard. |
| 20 | CR 12.3 | Orphaned `Ens.Config.Production` record without class definition | **DEFER** | LOW; edge case requiring external class deletion. |
| 21 | Live verify 12.4 | `iris_docdb_find` typed-property values not auto-extracted from `%Doc` | **DEFER** | LOW–MEDIUM; DocDB-specific property-population/indexing issue. Filter translation works; usable with empty filter. Independent of Epic 14 scope. |
| 22 | CR 12.4 | `buildDocDbRestriction` JSDoc says "console warning" but no `console.warn` | **DEFER** | LOW; behavior correct, JSDoc inaccurate. Docs-cleanup pass. |
| 23 | CR 12.4 | `Config.cls` create branch: no rollback if `Config.Databases.Create()` fails after `CreateDatabase()` | **DEFER** | LOW; unlikely scenario. Future Config-handler hardening pass. |
| 24 | CR 12.5 | `iris_oauth_manage` `supportedScopes` schema accepts only `string` | **DEFER** | LOW informational; intentional caller contract per AC 12.5.1. |
| 25 | CR 12.5 | `iris_rest_manage` `scope:"all"` dedup collapses identical/empty names | **DEFER** | LOW; IRIS REST apps always have unique non-empty path names. |
| 26 | Story 12.6 | Per-alert `clear` by index | **DEFER** (if demand) | IRIS exposes no API to remove individual `alerts.log` lines. Risky file I/O; out of scope. |
| 27 | Story 12.6 | Alert `acknowledge` | **DEFER** (if demand) | Not supported natively for system alerts; would require custom tracking table. Out of scope. |

## Triage Table — Epic 13 deferral

| # | Source | Item | Decision | Rationale |
|---|---|---|---|---|
| 28 | CR 13.2 | `@iris-mcp/ops` tool-count drift — section heading/Mix say 17, suite rollup/READMEs say 16 (`iris_alerts_manage` not propagated) | **ROUTE → Story 14.6** | Genuine docs inconsistency. Epic 14 ends with Story 14.6 (Documentation Rollup), which will reconcile suite/per-package tool counts. Fixing it there keeps Story 14.0 code-free and consolidates docs work. |

## Tasks / Subtasks

- [x] Task 1: Re-triage all open `deferred-work.md` items against Epic 14 scope (AC 14.0.1)
  - [x] Read `deferred-work.md` in full; identify open (non-closed) items post-Story-12.0.
  - [x] Classify each: all DEFER except CR 13.2 → ROUTE to Story 14.6.
- [x] Task 2: Append `## Triaged via Story 14.0 (2026-06-15)` closure section to `deferred-work.md` (AC 14.0.1, 14.0.2)
  - [x] DEFER items noted as open with rationale; CR 13.2 explicitly routed to Story 14.6. Append-only.
- [x] Task 3: Verify no source changes (AC 14.0.3)
  - [x] Only `deferred-work.md`, `sprint-status.yaml`, and this story file touched. No TS/ObjectScript, no bootstrap bump.

## Dev Notes

- This is a **lead-authored gate artifact**, not a dev-pipeline story. It carries no implementable ACs and does not pass through dev/qa/code-review/smoke. Authored directly (not via `/bmad-create-story`) because the create-story skill is epics.md-driven and Story 14.0 is a synthetic cleanup story absent from `epics.md` (auto-discover would target Story 14.1).
- User decision (2026-06-15): retro-review gate handled as **triage-record only, defer all** — keeps Epic 14 purely additive/foundation.
- The biggest open item (#21, `iris_docdb_find` typed-property population, LOW–MEDIUM) remains the strongest future-cleanup candidate but is DocDB-specific and unrelated to Epic 14's multi-server/governance foundation.

## Change Log

| Date | Change |
|---|---|
| 2026-06-15 | Story 14.0 authored as Epic 14 retro-review gate triage record; all 28 open deferred items DEFERred (CR 13.2 routed to Story 14.6). No code changes. |
