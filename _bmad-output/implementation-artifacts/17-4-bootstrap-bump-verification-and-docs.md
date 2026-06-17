# Story 17.4: BOOTSTRAP Verify + Live Verification + Documentation Rollup

**Status:** done

**Epic:** 17 — Interop & Dev Tools (`iris-interop-mcp` + `iris-dev-mcp`) — **CLOSER**

## Story

**As the** maintainer, **I want** the Epic-17 bootstrap verified idempotent, every new tool/enhancement live-verified, and all documentation rolled up, **so that** the epic ships consistent and the published surface is accurate.

## Acceptance Criteria

- **AC 17.4.1** — **Bootstrap idempotence (Rule #24 — NOT a deferred bump).** `BOOTSTRAP_VERSION` was moved incrementally per ObjectScript story (17.1 `fe972c4cb317`→`56f492db456d`→CR `8c748712e247`; 17.2 `8c748712e247`→`39dc932907cb`; 17.3 added nothing). This story VERIFIES `pnpm run gen:bootstrap` produces NO fresh diff (on-disk == embedded == version `39dc932907cb`) and `bootstrap.test.ts` is green. Do NOT introduce a new bump here. (If `gen:bootstrap` DOES produce a diff, that means a prior story's regen was stale — investigate and reconcile, recording the corrected hash.)
- **AC 17.4.2** — **Live-verify each tool/enhancement on HSCUSTOM** with safe calls (Rule #16): `iris_default_settings_manage` (list + a disposable set/get/delete round-trip); `iris_production_item` add/remove + arbitrary-setting (disposable production); `iris_sql_analyze` explain/stats/indexUsage/running (read-only). Record the evidence. (Note: the per-story lead smokes already did this; 17.4 is the consolidated confirmation pass.)
- **AC 17.4.3** — **Governance baseline frozen** verify: `pnpm run gen:governance-baseline:check` exit 0, `governance-baseline.ts` git-clean at `1e62c5ad5bf7` (141 keys). The Epic-17 new keys (`iris_default_settings_manage:{set,delete}`, `iris_production_item:{add,remove}`, `iris_sql_analyze:{explain,stats,indexUsage,running}`) live OUTSIDE the baseline, governed by `mutates`.
- **AC 17.4.4** — **Documentation rollup** (suite **96 → 98** tools; interop 19→20, dev 24→25; admin 26, ops 20, data 7 unchanged):
  - `packages/iris-interop-mcp/README.md` — add `iris_default_settings_manage` row + the `iris_production_item` add/remove/arbitrary-settings enhancement note; interop count → 20.
  - `packages/iris-dev-mcp/README.md` — add `iris_sql_analyze` row; dev count → 25.
  - `tool_support.md` — add the 2 new tool rows + the `iris_production_item` enhancement; roll up the per-server + suite totals (96→98).
  - `packages/iris-mcp-all/README.md` — suite 96→98 + per-server counts.
  - `README.md` (root) — suite 96→98 + the ASCII diagram counts.
  - `CHANGELOG.md` — new Epic-17 `### Added` (default-settings + sql-analyze) + `### Changed` (production_item enhancement) section.
  - `docs/migration-v1-v2.md` — suite 96→98 references.
  - `_bmad-output/planning-artifacts/architecture.md` — `96 tools` → `98 tools` (line 32) + any per-server count refs.
  - Counts must reconcile against the `index.test.ts` `toHaveLength` assertions (interop 20, dev 25, admin 26, ops 20, data 7 = 98).
- **AC 17.4.5** — Full monorepo `turbo run test`/`lint`/`build` green. Doc-only changes (+ verification) — no new tool code, no `BOOTSTRAP_VERSION` change, no `governance-baseline.ts` change.

## Tasks / Subtasks

- [x] **Task 1 (AC 17.4.1/17.4.3)** — Run `pnpm run gen:bootstrap` → confirm NO diff (version stays `39dc932907cb`); `bootstrap.test.ts` green. Run `pnpm run gen:governance-baseline:check` → exit 0, frozen `1e62c5ad5bf7`. Record both.
- [x] **Task 2 (AC 17.4.2)** — Consolidated live verification on HSCUSTOM (read-mostly; disposable targets only, cleaned up): default-settings round-trip; production-item add/remove + arbitrary setting on a disposable production; sql-analyze explain/stats/indexUsage/running read-only. Record evidence in the story.
- [x] **Task 3 (AC 17.4.4)** — Documentation rollup across all 8 surfaces above. Reconcile every count against `index.test.ts`. Suite 96→98.
- [x] **Task 4 (AC 17.4.5)** — Full monorepo `turbo run test`/`lint`/`build` green. Confirm `git diff` shows NO change to `bootstrap-classes.ts`/`BOOTSTRAP_VERSION`/`governance-baseline.ts`/`src/ExecuteMCPv2/**` (doc + verification only).

## Dev Notes

### This is the epic CLOSER — verify, don't bump (Rule #24)
The "one BOOTSTRAP_VERSION bump at the closing story" language in `epics.md` is SUPERSEDED by Rule #24 (per the Epic 16 retro carry-forward + Story 17.0). 17.1 and 17.2 already moved `BOOTSTRAP_VERSION` incrementally (it is a content hash). 17.4 VERIFIES idempotence — `gen:bootstrap` must produce no fresh diff. It does NOT introduce a deferred bump. Current value: `39dc932907cb`.

### Counts (reconcile against index.test.ts `toHaveLength`)
- interop **20** (was 19; +`iris_default_settings_manage`; `iris_production_item` enhanced in-place, no count change)
- dev **25** (was 24; +`iris_sql_analyze`)
- admin **26**, ops **20**, data **7** (unchanged)
- **Suite total: 98** (was 96). Epic 17 = 2 new tools + 1 enhancement.

### Doc surfaces (exact files)
`packages/iris-interop-mcp/README.md`, `packages/iris-dev-mcp/README.md`, `tool_support.md` (repo root), `packages/iris-mcp-all/README.md`, `README.md` (root, incl. ASCII diagram), `CHANGELOG.md`, `docs/migration-v1-v2.md`, `_bmad-output/planning-artifacts/architecture.md` (line 32 `96 tools`). Mirror the Epic-16 closer (Story 16.4) rollup pattern for structure/wording.

### Governance keys added this epic (for CHANGELOG accuracy)
- `iris_default_settings_manage:{set,delete}` — writes, default-disabled (list/get reads enabled).
- `iris_production_item:{add,remove}` — writes, default-disabled (existing enable/disable/get/set baseline-grandfathered).
- `iris_sql_analyze:{explain,stats,indexUsage,running}` — reads, default-enabled.
All OUTSIDE the frozen baseline `1e62c5ad5bf7` (governed by `mutates`).

### Live verification reference
Use `iris-dev-mcp` read tools + the deployed REST routes (per the per-story smokes). Disposable targets only (`ZZZ*` productions / `ZZZ*` default-settings tuples); clean up. The handlers are already deployed + compiled on HSCUSTOM from 17.1/17.2.

### Testing standards
No new automated tests required (doc + verification story). The existing suites (interop 219, dev 330, + governance + bootstrap) must stay green. If a doc count contradicts a test assertion, the TEST is the source of truth — fix the doc.

### References
- `epics.md:3627–3633` (Story 17.4 ACs)
- `17-0-api-probes.md` (determinations); per-story files 17.1/17.2/17.3
- `.claude/rules/project-rules.md` Rules #16, #18, #23, #24, #25; Story 16.4 (Epic-16 closer) as the rollup template

## Integration ACs

Not service-introducing (verification + documentation only). No consumers, no new surface.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Live verification driven against the deployed `/api/executemcp/v2` REST routes (HSCUSTOM) over HTTP with `curl` (`_SYSTEM:SYS`, port 52773) for the default-settings round-trip and the production-item add/remove flow (Rule #26 — direct REST exercises the ObjectScript handler's own guards; governance is enforced at the MCP/tool layer and is intentionally bypassed by a direct REST call). The `iris_sql_analyze` underlying SQL (`EXPLAIN`, `INFORMATION_SCHEMA.STATEMENTS`, `INFORMATION_SCHEMA.CURRENT_STATEMENTS`) was verified read-only via `iris_sql_execute` on HSCUSTOM (the tool is Atelier/SQL-only — no ObjectScript handler).

### Completion Notes List

**AC 17.4.1 — Bootstrap idempotence (Rule #24): PASS.** `pnpm run gen:bootstrap` regenerated `bootstrap-classes.ts` with NO change — `git diff packages/shared/src/bootstrap-classes.ts` is CLEAN (exit 0). `BOOTSTRAP_VERSION` stays `39dc932907cb` (13 classes; the embedded copy was already current from the per-story Epic-17 regens). `bootstrap.test.ts` green (41 tests). No fresh bump introduced. Per-story progression (recorded, not re-applied): `fe972c4cb317` → `56f492db456d` → `8c748712e247` (17.1 + CR) → `39dc932907cb` (17.2); 17.3 added no ObjectScript.

**AC 17.4.2 — Live verification (Rule #16): PASS.** All on HSCUSTOM; disposable `ZZZ*` targets only, all cleaned up (post-verify SQL confirmed 0 residual `ZZZ%` default-settings rows and 0 `ZZZStory174%` production classes). Evidence:
- `iris_default_settings_manage` round-trip via `POST /interop/defaultsettings`: `set` (ZZZTestProd||ZZZTestItem||ZZZ.Test.Host||ZZZSetting = "zzz-value-174") → HTTP 200; `get` → `found:true` with value+description+`deployable:false`; `delete` → `action:deleted`; `get` after delete → `found:false`. `list` (read) → HTTP 200 `{settings:[],count:0}`.
- `iris_production_item` add/remove on a disposable production: created `ZZZStory174.TestProduction` via `POST /interop/production` (create) → HTTP 200; `add` item `ZZZTestSvc` (className `EnsLib.File.PassthroughService`) with `settings:{comment, ArchivePath}` → HTTP 200 `{action:added, updatedSettings:["comment","ArchivePath"]}` (comment → `Ens.Config.Item` property; ArchivePath → arbitrary `Ens.Config.Setting`, confirming the Story 17.2 arbitrary-settings path); `remove` → HTTP 200 `{action:removed}` (FindItemByConfigName located the item via LoadFromClass, proving the add persisted it to the production class); deleted the production (cleanup) → HTTP 200. NOTE: `get` after add returned "Config item not found" — expected/consistent: `get` queries the `Ens_Config.Item` SQL extent which is only populated for a loaded/active production, while `add`/`remove` use the production class XData (SaveToClass) as the source of truth (documented Story 17.2 behavior). The successful `remove` is the authoritative confirmation the add persisted.
- `iris_sql_analyze` underlying SQL verified read-only via `iris_sql_execute` on HSCUSTOM: `EXPLAIN SELECT ...` (explain/indexUsage) → returns a `Plan` column with the query plan; `SELECT ... FROM INFORMATION_SCHEMA.STATEMENTS` (stats) → Hash/Statement/StatCount (1670 rows available); `SELECT * FROM INFORMATION_SCHEMA.CURRENT_STATEMENTS` (running) → the live executing statement row. All four actions' surfaces valid.

**AC 17.4.3 — Governance baseline frozen (Rule #23/#25): PASS.** `governance-baseline.ts` git-clean, `GOVERNANCE_BASELINE_HASH = 1e62c5ad5bf7` (141 keys). `pnpm run gen:governance-baseline:check` → exit 0 (frozen foundation 141 / live 190 / post-foundation new 49 allowed — the Epic-17 keys `iris_default_settings_manage:{set,delete}`, `iris_production_item:{add,remove}`, `iris_sql_analyze:{explain,stats,indexUsage,running}` are among the allowed post-foundation set). Bare `gen-governance-baseline.mjs` NOT run (Rule #25 footgun avoided).

**AC 17.4.4 — Docs rollup: PASS.** Counts re-derived from each package's `index.test.ts` `toHaveLength`: interop **20**, dev **25**, admin **26**, ops **20**, data **7** = **suite 98**. `iris_sql_analyze` is Atelier-backed (`POST /action/query`), so tool_support.md rollup: dev Atelier 18→19 + ExecuteMCPv2 6 = 25; interop ExecuteMCPv2 19→20; Total Atelier 18→19, ExecuteMCPv2 73→74, Other 5 → **98** (ExecuteMCPv2 column 6+26+20+20+2=74 ✓; 19+74+5=98 ✓); ExecuteMCPv2 share 74/98 ≈ 76%. Surfaces updated: root `README.md` (dev 24→25 + interop 19→20 rows + descriptions, suite 96→98, ASCII `(24)`→`(25)` `(19)`→`(20)`), `packages/iris-interop-mcp/README.md` (new `iris_default_settings_manage` row + production_item add/remove/arbitrary-settings row + 2 new `<details>` examples + add example, All 19→20), `packages/iris-dev-mcp/README.md` (new `iris_sql_analyze` SQL-Tools row + `<details>` example + intro "SQL analysis", All 24→25), `tool_support.md` (dev header (24)→(25) + row 25 sql_analyze + Mix 18→19 Atelier; interop header (19)→(20) + row 20 default_settings + production_item endpoint note + Mix 19→20; rollup table dev 18/6/24→19/6/25, interop 0/19/19→0/20/20, Total 18/73/5/96→19/74/5/98; dependency prose 18-of-24→19-of-25, 73-of-96/76%→74-of-98/76% ×2, placeholder 96-tool→98-tool), `packages/iris-mcp-all/README.md` (dev 24→25 + interop 19→20, suite 96→98), `docs/migration-v1-v2.md` (suite 96→98 ×2, dev 24→25, interop 19→20, +sql_analyze in additional-dev-tools list), `CHANGELOG.md` (new Epic-17 `### Added` [default-settings + sql-analyze] + `### Changed` [production_item enhancement] under the 2026-06-16 header), `_bmad-output/planning-artifacts/architecture.md` (suite 96→98 line 32 + ASCII tree dev `(24 tools)`→`(25 tools)` + interop `(19 tools)`→`(20 tools)`). Full-tree sweep confirms zero residual stale 96/19/24/73/70 counts in any count context (FR ranges like architecture.md line 35 "FR16-FR39, 24 FRs" left unchanged — structural FR count, not a tool count, per Story 16.4 discipline).

**AC 17.4.5 — Monorepo green: PASS.** `turbo run test` 12/12 (interop 219, dev 330 confirmed), `turbo run lint` 6/6, `turbo run build` 6/6 (tsc strict). Doc + verification only — `git status` confirms NO change to `bootstrap-classes.ts` / `BOOTSTRAP_VERSION` / `governance-baseline.ts` / `src/ExecuteMCPv2/**`; both generated artifacts re-confirmed git-clean after all gates.

### File List

- README.md (modified — dev 24→25 + interop 19→20 rows + descriptions, suite 96→98, ASCII diagram)
- packages/iris-interop-mcp/README.md (modified — new iris_default_settings_manage row + production_item add/remove/arbitrary-settings row + 2 new details examples, All 19→20)
- packages/iris-dev-mcp/README.md (modified — new iris_sql_analyze row + details example + intro, All 24→25)
- tool_support.md (modified — 2 new rows + production_item note + headers/Mix + rollup table + dependency prose + placeholder note, suite 96→98)
- packages/iris-mcp-all/README.md (modified — dev 24→25, interop 19→20, suite 96→98)
- docs/migration-v1-v2.md (modified — suite 96→98, dev 24→25, interop 19→20, +sql_analyze)
- CHANGELOG.md (modified — new 2026-06-16 Epic-17 Added + Changed sections)
- _bmad-output/planning-artifacts/architecture.md (modified — suite 96→98 + ASCII tree dev/interop counts)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — story status ready-for-dev → in-progress → review)
- _bmad-output/implementation-artifacts/17-4-bootstrap-bump-verification-and-docs.md (modified — task checkboxes, Dev Agent Record, status)

(No code, ObjectScript, or generated-artifact files changed. `bootstrap-classes.ts` regenerated but byte-for-byte unchanged at `39dc932907cb`; `governance-baseline.ts` git-clean at `1e62c5ad5bf7`.)

## Review Findings

**Code review (Epic-17 CLOSER, docs + verification only) — 2026-06-16 — CLEAN, no findings.**

Accuracy-focused review (Acceptance Auditor against story spec; Blind/Edge-Case layers N/A for a doc-count reconciliation). All ACs verified:

- **AC 17.4.4 count accuracy — PASS.** Every documented count reconciles against the live `index.test.ts` `toHaveLength` assertions (source of truth): interop **20**, dev **25**, admin **26**, ops **20**, data **7** = **98**. Confirmed all 8 published surfaces (root README incl. ASCII diagram, interop/dev/all READMEs, tool_support.md incl. rollup table + Mix lines + dependency prose, migration-v1-v2.md, architecture.md). Tree-wide grep for stale `96`/`(19)`/`(24)`/`73` in published docs: zero residual — remaining `96`/`19` hits are (a) prior-epic story artifacts (13-2, 16-4) and this story file [historical, correctly unchanged], (b) `tool_support.md` row-index `#19`/`#20` [indices not counts], (c) `docs/tool-annotation-audit.md` "(19 tools)" [dated 2026-04-07 point-in-time audit of the 85-tool era using dotted names; a frozen historical report, out of rollup scope — correctly unchanged]. `index.test.ts` suites run green (interop 14, dev 8).
- **CHANGELOG accuracy — PASS.** Epic-17 Added/Changed section correctly lists `iris_default_settings_manage` (list/get read, set/delete write), `iris_sql_analyze` (explain/stats/indexUsage/running, all read), and the `iris_production_item` add/remove + arbitrary-settings enhancement. Governance defaults verified against source `mutates` maps: defaultSettings set/delete=write + add/remove=write default-disabled; sql_analyze all=read default-enabled. README annotation hints cross-checked against source (`destructive` for default_settings; `readOnly, idempotent` for sql_analyze) — match.
- **AC 17.4.1/17.4.3 freeze — PASS.** `bootstrap-classes.ts` (`BOOTSTRAP_VERSION = 39dc932907cb`), `governance-baseline.ts` (`GOVERNANCE_BASELINE_HASH = 1e62c5ad5bf7`), and `src/ExecuteMCPv2/**` all git-clean (no change). `bootstrap.test.ts` green (47 incl. profiles-bootstrap). `gen:governance-baseline:check` exit 0 (frozen 141 / live 190 / 49 post-foundation allowed).
- **No code regression — PASS.** Change set is docs + bookkeeping only. Full `pnpm turbo run test` green — **12/12 tasks successful**.

No HIGH/MED/LOW findings. No auto-fixes required.

## Change Log

| Date | Change |
|---|---|
| 2026-06-16 | Story 17.4 created (lead, Epic 17 CLOSER). Verifies bootstrap idempotence (`39dc932907cb`, Rule #24 — NOT a deferred bump), consolidated live verification of all 3 Epic-17 tools/enhancements, frozen governance baseline (`1e62c5ad5bf7`), and docs rollup suite 96→98 (interop→20, dev→25) across 8 surfaces. Status → ready-for-dev. |
| 2026-06-16 | Story 17.4 code-reviewed (code-review, Epic-17 CLOSER). CLEAN — no findings. Counts reconciled vs `index.test.ts` `toHaveLength` (interop 20 / dev 25 / admin 26 / ops 20 / data 7 = 98) across all 8 published surfaces; zero stale 96/19/24/73 in published docs. CHANGELOG governance defaults verified against source `mutates` maps + annotation hints. Bootstrap (`39dc932907cb`) / governance-baseline (`1e62c5ad5bf7`) / `src/ExecuteMCPv2/**` git-clean; `bootstrap.test.ts` + `gen:governance-baseline:check` green/exit-0; full `turbo run test` 12/12. No auto-fixes required. |
| 2026-06-16 | Story 17.4 developed (dev-story). Bootstrap idempotent (`gen:bootstrap` no diff, `39dc932907cb`, bootstrap.test.ts 41 green). Governance baseline frozen (`--check` exit 0, `1e62c5ad5bf7` git-clean, 141 keys). Live-verified all 3 Epic-17 tools/enhancements on HSCUSTOM with disposable ZZZ targets (cleaned up): default-settings set/get/delete round-trip, production-item add/remove + arbitrary setting on disposable production, sql-analyze explain/stats/indexUsage/running SQL surfaces. Docs rollup suite 96→98 (interop 19→20, dev 24→25) across all 8 surfaces, counts reconciled vs index.test.ts. Full monorepo green (test 12/12, lint 6/6, build 6/6). No code/ObjectScript/bootstrap/baseline change. Status → review. |
