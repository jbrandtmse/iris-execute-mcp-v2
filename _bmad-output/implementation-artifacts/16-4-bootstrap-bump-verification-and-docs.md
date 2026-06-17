# Story 16.4: BOOTSTRAP Verification + Live Verification + Documentation Rollup

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **maintainer**,
I want **the Epic-16 bootstrap version confirmed idempotent, every new ops tool live-verified, and all docs/counts rolled up**,
so that **the suite ships consistent, accurate, and reproducible after the three new ops tools**.

## ⚠️ Rule #24 reinterpretation (read first)

epics.md AC 16.4.1 says "**single** `BOOTSTRAP_VERSION` bump at the closing story." Per **Rule #24**, that is incompatible with the content-hash drift test: each Epic-16 ObjectScript story ALREADY regenerated `bootstrap-classes.ts` and moved the version per-change (`e5f4f6d88c56` → `d4e197ef5ffc` [16.1] → `f8b3a9e9704c` [16.2] → `04984d638f8d` [16.3 dev] → **`fe972c4cb317`** [16.3 CR fix]). **This story does NOT introduce a fresh bump.** It VERIFIES idempotence: `pnpm gen:bootstrap` must produce **no diff** (the embedded copy already matches on-disk), and `bootstrap.test.ts` is green. The final Epic-16 `BOOTSTRAP_VERSION` is `fe972c4cb317`.

## Acceptance Criteria

1. **AC 16.4.1 (bootstrap idempotence, Rule #24)** — Run `pnpm gen:bootstrap`; confirm it produces **NO git diff** (embedded `bootstrap-classes.ts` already current at `BOOTSTRAP_VERSION = fe972c4cb317`, covering all Epic-16 Monitor.cls + Dispatch.cls changes). `bootstrap.test.ts` green (on-disk == embedded == version). Record the final version + the per-story progression in Completion Notes.
2. **AC 16.4.2 (live verification, Rule #5/#16/#26)** — Live-verify each new ops tool on HSCUSTOM via a SAFE call over real HTTP: `iris_process_manage get` (a safe PID), `iris_database_action` (a read-ish/guarded path — e.g. a guarded rejection, since all 6 actions mutate), `iris_backup_manage listHistory`. Confirm the destructive/control paths are still GUARDED (process terminate of a critical job refused; database action on an invalid dir refused; backup restore not-supported). **NEVER run a real freeze.** Capture evidence.
3. **AC 16.4.3 (docs rollup)** — Update every count/listing surface for ops 17 → 20 and suite 93 → 96 (dev 24 + admin 26 + interop 19 + ops 20 + data 7 = 96):
   - `README.md` — ops row 17 → 20 + domain description (add process control / database operations / backups); "**93 tools**" → "**96 tools**"; ASCII diagram if it carries ops/suite counts.
   - `packages/iris-ops-mcp/README.md` — add the 3 new tools (`iris_process_manage`, `iris_database_action`, `iris_backup_manage`) to the catalog with descriptions; ops count.
   - `packages/iris-mcp-all/README.md` — ops 17 → 20; suite 93 → 96.
   - `tool_support.md` — add the 3 new rows; roll up the ExecuteMCPv2-backed count (70 → 73) + suite total (93 → 96) + the derived percentage (73/96 ≈ 76%); Atelier 18 and Other 5 unchanged.
   - `docs/migration-v1-v2.md` — suite 93 → 96 (+ ops 17 → 20) at every occurrence.
   - `CHANGELOG.md` — new 2026-06-16 Epic-16 section: 3 new ops tools, governance-gated (write actions default-disabled), restore deferred, bootstrap `e5f4f6d88c56` → `fe972c4cb317`.
   - `_bmad-output/planning-artifacts/architecture.md` — ops `(17 tools)` → `(20 tools)` + suite total + ASCII tree + the pagination "max is N tools" note if ops now exceeds it (it doesn't — admin 26 is still max).
   - **Counts MUST reconcile**: per-server 24+26+19+17... wait, 24+26+19+20+7 = 96; tool_support rollup columns must also sum to 96.
4. **AC 16.4.4 (deploy, Rule #17)** — Confirm the Epic-16 ObjectScript is deployed + compiled on HSCUSTOM (it is, from 16.1–16.3); if any redeploy is needed, use glob-prefixed `iris_doc_load` + compile by full class name. No new ObjectScript in this story.
5. **AC 16.4.5 (governance frozen, Rule #23/#25)** — Frozen `governance-baseline.ts` unchanged (`1e62c5ad5bf7` / 141 keys, git-clean); `node scripts/gen-governance-baseline.mjs --check` exit 0 (now reporting the Epic-16 keys among the allowed post-foundation set). Do NOT run the bare generator. Confirm `gen:governance-baseline` was NOT run.
6. **AC 16.4.6** — Full monorepo green: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm type-check`. Doc-only changes (no code/ObjectScript change, so no bootstrap/baseline regen beyond the idempotence check).

## Tasks / Subtasks

- [x] **Task 1 — Bootstrap idempotence verify (AC 16.4.1)**
  - [x] `pnpm gen:bootstrap`; `git diff --exit-code packages/shared/src/bootstrap-classes.ts` (expect clean). Confirm `BOOTSTRAP_VERSION = fe972c4cb317`. `bootstrap.test.ts` green.
- [x] **Task 2 — Live verification (AC 16.4.2)**
  - [x] `iris_process_manage get <safe pid>` → detail; terminate of a critical job → refused.
  - [x] `iris_database_action` guarded path (e.g. dismount/truncate of a non-existent dir) → clean rejection.
  - [x] `iris_backup_manage listHistory` → success; `restore` → not-supported; `run` w/o taskName → rejected. NEVER a real freeze.
  - [x] Capture evidence in Completion Notes.
- [x] **Task 3 — Docs rollup (AC 16.4.3)**
  - [x] Update all surfaces listed in AC 16.4.3. Reconcile counts everywhere (suite 96; per-server 24/26/19/20/7; ExecuteMCPv2-backed 73, Atelier 18, Other 5).
  - [x] Cross-check the 3 new tools' actions + governance classifications against the actual Zod enums + `mutates` maps in `process.ts`/`database.ts`/`backup.ts`.
- [x] **Task 4 — Governance + monorepo green (AC 16.4.5, 16.4.6)**
  - [x] `node scripts/gen-governance-baseline.mjs --check` exit 0; frozen baseline git-clean. Confirm `gen:governance-baseline` NOT run.
  - [x] `pnpm build && pnpm test && pnpm lint && pnpm type-check` green.

## Dev Notes

### Bootstrap (Rule #24)
The per-story regen discipline means the embedded copy is ALREADY current. This story's job is to PROVE idempotence (`gen:bootstrap` → no diff), not to bump. If `gen:bootstrap` DOES produce a diff, that's a signal an earlier story's regen was missed — investigate and record, don't just commit the diff.

### Counts (verify against code, Rule #2-style)
- Per-server tool counts come from each package's `index.test.ts` `toHaveLength(...)`: dev 24, admin 26, interop 19, **ops 20**, data 7 → **suite 96**.
- ExecuteMCPv2-backed: the 3 new ops tools are all REST.Monitor-backed → ExecuteMCPv2 count 70 → 73; Atelier 18 unchanged; Other 5 unchanged → 73 + 18 + 5 = 96. Derived ExecuteMCPv2 share 73/96 ≈ 76%.
- Re-derive every number from the code/tests, not from prior prose (mirror Story 15.6's discipline — it caught a stale count in a secondary table that the diff-only layer couldn't see; audit ALL occurrences in each file, including secondary comparison tables).

### Live-verify safety
`iris_backup_manage freeze` quiesces the whole instance — NEVER run it live. Verify only read/guarded paths. Process-terminate must target a critical (non-terminable) job for the refusal assertion, never a real user process you intend to keep.

### Governance frozen (Rule #23/#25)
Do NOT run `gen:governance-baseline` (it refuses without `--force` now anyway — Story 16.0). Use `gen:governance-baseline:check` to confirm the frozen baseline holds and the Epic-16 keys are allowed post-foundation.

### Project Structure Notes
- Docs-only story (mirror of Story 15.6 / 14.6). No code or ObjectScript change expected. No bootstrap/baseline regen beyond the idempotence check.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-16.4] — ACs (AC 16.4.1 "single bump" reinterpreted per Rule #24).
- [Source: .claude/rules/project-rules.md#24] — bootstrap regen per-change; closer verifies idempotence.
- [Source: .claude/rules/project-rules.md#23/#25] — frozen baseline; `--check`.
- [Source: _bmad-output/implementation-artifacts/15-6-bootstrap-bump-verification-and-docs.md] — the analogous Epic-15 closer (docs rollup discipline, count reconciliation).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Live verification driven directly against the deployed `/api/executemcp/v2` REST routes (HSCUSTOM) over HTTP with `curl` (Rule #26 — direct REST smoke exercises the ObjectScript handler's OWN guards; governance is enforced at the MCP/tool layer and is intentionally bypassed by a direct REST call).

### Completion Notes List

**AC 16.4.1 — Bootstrap idempotence (Rule #24): PASS.** `pnpm gen:bootstrap` regenerated `bootstrap-classes.ts` with no change — `git diff --exit-code packages/shared/src/bootstrap-classes.ts` is CLEAN. `BOOTSTRAP_VERSION` stays `fe972c4cb317` (the embedded copy was already current from the per-story Epic-16 regens). `bootstrap.test.ts` green (47 shared-bootstrap tests passed). No fresh bump introduced. Per-story progression (recorded, not re-applied): `e5f4f6d88c56` → `d4e197ef5ffc` (16.1) → `f8b3a9e9704c` (16.2) → `04984d638f8d` (16.3 dev) → `fe972c4cb317` (16.3 CR fix).

**AC 16.4.2 — Live verification (Rules #5/#16/#26): PASS.** All over real HTTP on HSCUSTOM; NEVER ran a real `freeze`. Evidence:
- `GET /monitor/process?pid=3736` (CONTROL daemon) → HTTP 200, full detail; `canBeTerminated:false`, `canBeSuspended:false`.
- `POST /monitor/process/manage {action:"terminate",pid:"3736"}` → `{refused:true,reason:"Refused: process 3736 cannot be terminated (CanBeTerminated=0 - critical/protected system job)."}`. Critical-job guard effective.
- `POST /monitor/process?pid=abc` → rejected: "Invalid pid 'abc'. pid must be a positive integer." (positive-int gate).
- `POST /monitor/database/action {action:"dismount",directory:"/no/such/db/dir/"}` → clean SanitizeError envelope: ERROR #5001 "Database directory '/no/such/db/dir/' does not exist or is not a configured IRIS database." (no opaque crash).
- `POST /monitor/backup/manage {action:"listHistory"}` → HTTP 200 `{action:"listHistory",entries:[],count:0,success:true}`.
- `POST /monitor/backup/manage {action:"restore"}` → rejected: "Restore is not supported via this tool. …" (not-supported guard).
- `POST /monitor/backup/manage {action:"run"}` (no taskName) → rejected: "Required parameter 'taskName' is missing or empty".

**AC 16.4.3 — Docs rollup: PASS.** Counts re-derived from each package's `index.test.ts` `toHaveLength`: dev 24, admin 26, interop 19, **ops 20**, data 7 = **suite 96**. ExecuteMCPv2-backed 70 → **73** (all 3 new ops tools are REST.Monitor-backed), Atelier 18 unchanged, Other 5 unchanged → 73+18+5 = 96; ExecuteMCPv2 share 73/96 ≈ 76%. The 3 new tools' actions + `mutates` classifications verified against `process.ts` (get=read; terminate/suspend/resume=write), `database.ts` (all 6 actions=write), `backup.ts` (listHistory=read; run/freeze/thaw=write). Surfaces updated: `README.md` (ops row 17→20 + capabilities, suite 93→96, ASCII `(17)`→`(20)`), `packages/iris-ops-mcp/README.md` (3 new catalog rows + header domains), `packages/iris-mcp-all/README.md` (ops 17→20, suite 93→96), `tool_support.md` (3 new ops rows + header (17)→(20) + Mix 17→20 + rollup table ops 17→20 / ExecuteMCPv2 70→73 / Total 93→96 + dependency prose 70-of-93/75% → 73-of-96/76% in two places + placeholder-note 93-tool→96-tool secondary occurrence), `docs/migration-v1-v2.md` (suite 93→96 ×2 + ops 17→20), `CHANGELOG.md` (new Epic-16 `### Added` section under the 2026-06-16 header), `_bmad-output/planning-artifacts/architecture.md` (suite 93→96, ops tree `(17 tools)`→`(20 tools)`, ops file tree + 3 new tool entries FR121/122/123). The pagination "max is 26 tools" note left unchanged — admin 26 is still the largest server (ops 20 < 26). Full-tree sweep confirms zero residual stale 93/17/70 counts in any count context.

**AC 16.4.4 — Deploy (Rule #17): PASS.** All Epic-16 REST routes respond live on HSCUSTOM (verified in AC 16.4.2), confirming the ObjectScript is deployed + compiled. No redeploy needed; no new ObjectScript in this story.

**AC 16.4.5 — Governance frozen (Rules #23/#25): PASS.** `governance-baseline.ts` git-clean, hash `1e62c5ad5bf7`. `node scripts/gen-governance-baseline.mjs --check` → exit 0 (frozen foundation 141 / live 180 / post-foundation new 39 — the new Epic-16 keys are among the allowed post-foundation set). `gen:governance-baseline` (bare/write) NOT run.

**AC 16.4.6 — Monorepo green: PASS.** `pnpm build` 6/6; `pnpm test` 12/12 (shared 504, admin 439, dev 293, interop 171, data 120, ops 244); `pnpm lint` 6/6; `pnpm type-check` 12/12. Doc-only change — no code/ObjectScript change, so no bootstrap/baseline regen beyond the idempotence check; `bootstrap-classes.ts` and `governance-baseline.ts` both git-clean after all gates.

### File List

- README.md (modified — ops 17→20 row + capabilities, suite 93→96, ASCII diagram)
- packages/iris-ops-mcp/README.md (modified — 3 new tool catalog rows + header domain description)
- packages/iris-mcp-all/README.md (modified — ops 17→20, suite 93→96)
- tool_support.md (modified — 3 new ops rows + header/Mix + rollup table + dependency prose + placeholder note)
- docs/migration-v1-v2.md (modified — suite 93→96 ×2, ops 17→20)
- CHANGELOG.md (modified — new 2026-06-16 Epic-16 Added section)
- _bmad-output/planning-artifacts/architecture.md (modified — suite 93→96, ops tree count + new tool file entries)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified — story status ready-for-dev → in-progress → review)
- _bmad-output/implementation-artifacts/16-4-bootstrap-bump-verification-and-docs.md (modified — task checkboxes, Dev Agent Record, status)

(No code, ObjectScript, or generated-artifact files changed. `bootstrap-classes.ts` regenerated but byte-for-byte unchanged; `governance-baseline.ts` git-clean.)

### Review Findings

Code review (2026-06-16) — three adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor). **Clean review — all layers passed.** Zero findings. 0 decision-needed, 0 patch, 0 defer, 1 dismissed-as-noise.

**Verified against the code (not prose):**
- [x] [Review] Per-server counts reconcile — `index.test.ts` `toHaveLength`: dev 24, admin 26, interop 19, ops 20 (`names.toHaveLength(20)`), data 7 = **suite 96**. Matches every documented "96 tools" surface.
- [x] [Review] Rollup table sums — `tool_support.md` Total row `18 Atelier + 73 ExecuteMCPv2 + 5 Other = 96`; ExecuteMCPv2 column `6+26+19+20+2 = 73`; derived share `73/96 ≈ 76%`. All consistent.
- [x] [Review] No residual stale counts in published surfaces — exhaustive sweep of README.md, packages/iris-mcp-all/README.md, packages/iris-ops-mcp/README.md, tool_support.md, docs/migration-v1-v2.md, architecture.md: zero stale `93`/`(17)`/`70` in a count context. Dismissed false-positives: `architecture.md:402` "Epic 15–17 tools" (epic range), `architecture.md:830` "70% of tools" (iris-dev-mcp Atelier-reliance qualitative stat, not the ExecuteMCPv2 count), CHANGELOG historical `89 → 93` / `93 → 96` transitions, FR93/FR9x in planning artifacts.
- [x] [Review] 3 new tools' actions + governance classifications match code — `process.ts` enum `[get,terminate,suspend,resume]` mutates `get:read, terminate/suspend/resume:write`; `database.ts` enum `[mount,dismount,compact,defragment,truncate,expandVolume]` all `write`; `backup.ts` enum `[run,freeze,thaw,listHistory]` mutates `listHistory:read, run/freeze/thaw:write`, `restore` correctly absent from enum (documented not-supported). All match CHANGELOG + ops README descriptions.
- [x] [Review] Bootstrap idempotence (Rule #24) — `bootstrap-classes.ts` git-clean at `BOOTSTRAP_VERSION = fe972c4cb317`; no fresh bump introduced. CHANGELOG progression `e5f4f6d88c56 → fe972c4cb317` accurate.
- [x] [Review] Governance frozen (Rule #23/#25) — `governance-baseline.ts` git-clean at `GOVERNANCE_BASELINE_HASH = 1e62c5ad5bf7` (141 keys); `node scripts/gen-governance-baseline.mjs --check` exit 0 (frozen foundation 141 / live 180 / post-foundation new 39); bare generator NOT run.
- [x] [Review] All 3 new tools enumerated in every ops-listing surface — `packages/iris-ops-mcp/README.md` (20 tool rows incl. rows 18/19/20) and `tool_support.md` (rows 18/19/20); ops `index.test.ts` `toContain` all three.
