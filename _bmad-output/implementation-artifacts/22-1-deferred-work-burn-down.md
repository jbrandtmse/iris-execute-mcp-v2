# Story 22.1: Deferred-Work Ledger Burn-Down

Status: review

## Story

As a **maintainer**,
I want **every open deferred-work item driven to a terminal disposition**,
so that **the ledger that three consecutive epics re-deferred is finally cleared and future retro gates start from zero**.

## Acceptance Criteria

Copied verbatim from `_bmad-output/planning-artifacts/epics.md` Epic 22 (lines 3861-3869). The authoritative item list is the `deferred-work.md` "Epic 21 retrospective (2026-07-03)" note (line 566) + the "Epic 22 planned" note (line 595) — **do not re-triage from scratch.**

- **AC 22.1.1** — **Terminal disposition for every item; re-deferral is NOT an allowed outcome** (Epic 21 retro directive). Each of the 14 open ledger items + Epic 20 retro Action #2 lands in exactly one of: **resolved** (code/test/doc fix, merged), **closed-with-evidence** (live probe or measurement demonstrates no action needed — evidence recorded), or **closed-by-decision** (stakeholder explicitly accepts the behavior — decision recorded). A disposition table is recorded in the story file and mirrored into `deferred-work.md`.
- **AC 22.1.2** — Expected-resolve subset (code fixes, each strictly additive with tests): **CR 16.0-1** (extract the generator's key-derivation into a shared helper imported by both `gen-governance-baseline.mjs --check` and `governance.test.ts`); **CR 16.0-2** (unit test for the vanished-key exit-1 path against the extracted helper); **CR 16.2-2** (Zod `.min()`/`.max()` on `percentFull`/`targetSize`/`initialSize`); **CR 18.0-1 remaining half** (add is-valid-Ens-host check — e.g. `%IsA("Ens.Host")` + non-abstract — to the `add` className guard); **CR 20.0-1** (per-action honoring of `force`/`timeout` on `iris_production_control`: reject-with-clear-error or document, dev's call recorded); **CR 21.1-2** (Src=Dst self-call depth-stack guard + boundary fixture).
- **AC 22.1.3** — Verify-then-dispose subset (Rule #16 live probe/measurement first, then fix or close-with-evidence): **CR 18.0-2** (probe `(Production,Name)` index collation; fix only if case-sensitive-and-undesirable); **CR 16.3-device** (probe `StartTask` 4th `Device` arg; wire it or drop `device` from the schema); **CR 16.3-thaw-password** (freeze/thaw round-trip on a disposable target; add redaction only if the password is observed in error text); **CR 16.1-3** (measure `ProcessGet` latency; fix only if material); **CR 17.1-1** (live-HTTP `||`-delimiter rejection assertion — satisfiable inside this story's smoke); **CR 21.0-2** (correlator index maps OR a measured demonstration that default `maxRows=2000` keeps worst-case acceptable, with the cap documented).
- **AC 22.1.4** — **CR 21.1-1** (episode rule-A pairloop asymmetry): stakeholder decision point — either extend rule A to pairloops (unwind on `tEv.Req.Src`, fixtures for both groupings) or codify the composite-episode interpretation into proposal-§6.3 text; the choice is recorded and implemented/documented accordingly.
- **AC 22.1.5** — **AI#4** (`iris_backup_manage` restore): terminally closed as won't-fix (IRIS restore is interactive; no scriptable classmethod — re-verified once against current `irissys/Backup/General.cls`), with the handler's clear-rejection behavior confirmed still in place. **Epic 20 retro Action #2**: verify the running MCP servers carry the post-`7aca352` build (or rebuild+reload now); operational close recorded.
- **AC 22.1.6** — If any ObjectScript handler is modified, `bootstrap-classes.ts` regenerated + `BOOTSTRAP_VERSION` moved in this story (Rule #24), `bootstrap.test.ts` green; governance baseline stays frozen `1e62c5ad5bf7`, `gen:governance-baseline:check` exit 0 (Rules #23/#25); full monorepo suite green; lint + type-check clean.
- **AC 22.1.7** — `deferred-work.md` closes at **zero open carried items**. Only items newly surfaced by Epic 22's own code reviews may remain open, each explicitly listed in a fresh section. *(Currently open Epic-22-own items: CR 22.0-D1, CR 22.0-D2 from Story 22.0's review — these are permitted to remain; any new 22.1 review findings likewise.)*
- **AC 22.1.8** — Lead smoke (Rules #22/#26): live-HTTP assertions for the guarded-path items fixed here (at minimum: `||`-delimiter rejection per CR 17.1-1; abstract/`%`-class host `add` rejection per CR 18.0-1) — each rejection changes nothing server-side. *(Lead-executed after code review — dev's job is to make it passable.)*

## Ledger disposition plan (the 14 items + Epic 20 Action #2)

Each row starts with a PLANNED disposition; the dev confirms/updates it and records the final disposition + evidence in the Dev Agent Record AND mirrors it into `deferred-work.md` (AC 22.1.1). **Probe-first (Rule #16) before any fix whose API shape is asserted but unverified.**

| # | Item | AC | Planned disposition | Target |
|---|---|---|---|---|
| 1 | CR 16.0-1 generator/`governance.test.ts` key-derivation lock-step | 22.1.2 | **resolve** — extract shared key-derivation helper | `scripts/gen-governance-baseline.mjs` (unwrap+`${name}:${value}`, lines ~185-211) + `packages/shared/src/governance.ts` + `governance.test.ts` import it |
| 2 | CR 16.0-2 vanished-key `--check` exit-1 has no test | 22.1.2 | **resolve** — unit test against the extracted helper | `packages/shared/src/__tests__/governance-baseline-check.test.ts` (or sibling) |
| 3 | CR 16.1-3 `ProcessGet` `MemoryUsed` mailbox latency | 22.1.3 | **measure → likely close-with-evidence** | probe `Monitor:ProcessGet` latency; `packages/iris-ops-mcp/src/tools/process.ts` only if material |
| 4 | CR 16.2-2 no numeric range validation `percentFull`/`targetSize`/`initialSize` | 22.1.2 | **resolve** — Zod `.min()/.max()` | `packages/iris-ops-mcp/src/tools/database.ts` (`iris_database_action`) |
| 5 | CR 16.3-device `run` reads `device` but `StartTask` called without it | 22.1.3 | **probe → wire-or-drop** | probe `%SYS.Task:StartTask`/`RunNow` 4th arg vs `irissys/%SYS/Task.cls`; `packages/iris-ops-mcp/src/tools/*` task tool + `src/ExecuteMCPv2/REST/Task.cls` |
| 6 | CR 16.3-thaw-password theoretical `ExternalThaw` echo | 22.1.3 | **probe → close-with-evidence unless observed** | disposable freeze/thaw round-trip; add redaction only if password appears in error text |
| 7 | CR 17.1-1 `||` IdKey-delimiter guard has no automated test | 22.1.3 | **close-with-evidence via lead smoke** (AC 22.1.8) — guard already coded | `src/ExecuteMCPv2/REST/Interop.cls` DefaultSettings; assert rejection live |
| 8 | CR 18.0-1 remaining half: abstract/`%`-class host guard | 22.1.2 | **resolve** — add `%IsA("Ens.Host")` + non-abstract check | `src/ExecuteMCPv2/REST/Interop.cls` `ItemManage` add branch |
| 9 | CR 18.0-2 `add` dup-name relies on `FindItemByConfigName` collation | 22.1.3 | **probe `(Production,Name)` collation → fix only if case-sensitive-undesirable** | `src/ExecuteMCPv2/REST/Interop.cls` add branch |
| 10 | AI#4 `iris_backup_manage restore` scriptable path | 22.1.5 | **closed-with-evidence (won't-fix)** — re-verify no classmethod vs `irissys/Backup/General.cls`; confirm handler still rejects | `packages/iris-ops-mcp/src/tools/backup.ts` + `src/ExecuteMCPv2/REST/Monitor.cls` BackupManage |
| 11 | CR 20.0-1 `recover` forwards ignored `force`/`timeout` | 22.1.2 | **resolve** — dev's call: reject-with-clear-error for non-consuming actions OR document per-action; record the choice | `packages/iris-interop-mcp/src/tools/*production*control*.ts` |
| 12 | CR 21.0-2 correlator O(n²) no iteration bound | 22.1.3 | **measure → index maps OR close-with-evidence (documented cap)** | `src/ExecuteMCPv2/Diagram/Correlator.cls` |
| 13 | CR 21.1-1 episode rule-A pairloop asymmetry | 22.1.4 | **closed-by-decision OR resolve** — STAKEHOLDER DECISION (see Dev Notes — provided by lead) | `src/ExecuteMCPv2/Diagram/Compressor.cls` EpisodeCore + proposal §6.3 |
| 14 | CR 21.1-2 Src=Dst self-call depth-stack growth | 22.1.2 | **resolve** — self-call guard + boundary fixture | `src/ExecuteMCPv2/Diagram/Compressor.cls` + `src/ExecuteMCPv2/Tests/DiagramEpisode*Test.cls` |
| 15 | Epic 20 retro Action #2 rebuild+reload MCP servers (`7aca352`) | 22.1.5 | **operational close** — verify running servers carry post-`7aca352` build (or rebuild+reload); record | build/reload state |

**NOT in scope (leave open):** CR 22.0-D1, CR 22.0-D2 (Epic 22's own review — AC 22.1.7 permits). Any new Story 22.1 review findings likewise.

## Tasks / Subtasks

- [x] Task 1: CR 21.1-1 stakeholder decision (AC 22.1.4) — Option A applied FIRST: rule-A extended to pairloops in `Compressor.cls` `EpisodeCore` + symmetric-grouping fixture.
- [x] Task 2: Rule #16 probes for the verify-then-dispose subset (AC 22.1.3) — all done via a disposable `ExecuteMCPv2.Temp.Probe221` (deleted, IRIS + disk) + `irislib/`/`irissys/` source:
  - [x] CR 16.3-device: source `irissys/Backup/General.cls:235` — `StartTask(...,Device="",IsTape="")` 4th arg exists but is `[Internal]`+undocumented → retain+document-no-effect (not wired)
  - [x] CR 18.0-2: source `irislib/Ens/Config/Item.cls:150` — `Index Name On (Production As Exact, Name As Exact)` = case-sensitive; `FindItemByConfigName` exact match → guard already correct
  - [x] CR 16.3-thaw-password: source — `ExternalThaw` body is EMPTY (kernel-generated) → OS layer builds no password-bearing error; live freeze avoided (instance-wide disruptive)
  - [x] CR 16.1-3: live probe — `ProcessGet` MemoryUsed read = 4.8 ms/call (immaterial)
  - [x] CR 21.0-2: live probe — worst case 2000→0.136 s (fast), 10000→4.6 s (functional) → documented cap
  - [x] AI#4: probe — no `RestoreDatabase`/`Restore`/`RestoreTask`/`RestoreJournal`/`StartRestore` classmethod on `Backup.General`
  - [x] Recorded ALL probe findings in Dev Agent Record; probe class deleted (IRIS + disk)
- [x] Task 3: Code-fix subset (AC 22.1.2), each strictly additive + tested:
  - [x] CR 16.0-1: extracted shared `governance-baseline-derivation.ts` helper (imported by `gen-governance-baseline.mjs` + `governance.test.ts`); CR 16.0-2: vanished-key drift unit test added
  - [x] CR 16.2-2: Zod `.min()/.max()` bounds on `percentFull`/`targetSize`/`initialSize` (`database.ts`); no `.refine()`
  - [x] CR 18.0-1 remaining half: `$classmethod(cls,"%Extends","Ens.Host")` + non-abstract `%Dictionary.CompiledClass.Abstract` guard in `ItemManage` add branch; clean `SanitizeError`, no caret-globals
  - [x] CR 20.0-1: per-action documentation (dev's recorded choice — doc-only preserves the AC 20.0.7 back-compat gate byte-for-byte)
  - [x] CR 21.1-2: Src=Dst unpaired self-call push-guard in `Compressor.cls` + Src=Dst boundary fixture
- [x] Task 4: Verify-then-dispose fixes from Task 2 findings (AC 22.1.3) — CR 18.0-1 applied + live-confirmed; CR 16.1-3/16.3-thaw/16.3-device/18.0-2/21.0-2 closed-with-evidence
- [x] Task 5: AI#4 + Epic 20 Action #2 close (AC 22.1.5): live REST confirmed `restore` rejected with a clear message (won't-fix); running interop server registers `iris_production_control:clean` → post-`7aca352` build LIVE (operational close, no reload needed)
- [x] Task 6: Bootstrap + baseline (AC 22.1.6): `gen:bootstrap` re-run, `BOOTSTRAP_VERSION` `919124293f66` → `e931a96373f0` (idempotent second run, not hand-edited); `gen:governance-baseline:check` exit 0, frozen `1e62c5ad5bf7` git-clean, bare generator NOT run
- [x] Task 7: Ledger close (AC 22.1.1, 22.1.7): disposition table recorded here AND mirrored into `deferred-work.md`; all 14 items + Action #2 terminal (8 resolved / 6 closed-with-evidence / 1 operational-close, 0 re-deferred); only CR 22.0-D1/D2 remain open
- [x] Task 8: Full verification (AC 22.1.6): full monorepo `pnpm test` 12/12 green, lint 6/6, type-check 12/12 clean; all touched OS test classes pass per-class (Rule #35 — totals matched method counts)

## Dev Notes

### CR 21.1-1 STAKEHOLDER DECISION (AC 22.1.4) — DECIDED by the stakeholder 2026-07-04

**DECISION: (A) Extend rule A to pairloops — RESOLVE WITH CODE.** Disposition = **resolved**.

The stakeholder chose the symmetric-grouping fix over doc-only codification. Implement:
- In `src/ExecuteMCPv2/Diagram/Compressor.cls` `EpisodeCore`: extend rule A so an abandoned sync frame ALSO unwinds when the next unit is a `pairloop` — unwind on `tEv.Req.Src` (not only on `Kind="arrow"`), so the same semantic traffic gets the SAME episode grouping whether or not the pair tier collapsed it. After the fix: `[reqLost, singlePair]` and `[reqLost, pairloop]` both unwind the abandoned request and split into two episodes (symmetric).
- Add fixtures for BOTH groupings to `src/ExecuteMCPv2/Tests/DiagramEpisodeTest.cls` (or `DiagramEpisodeEdgeTest.cls`): the raw-single-pair grouping AND the pairloop grouping (incl. the repeated `[reqLost, PL]×3` shape from the CR 21.1-1 analysis) — assert the episode boundaries match between the two.
- Verify no regression to existing episode fixtures (they encode the current asymmetric grouping — update any that assumed the old pairloop-glues-composite behavior, and note the change in Dev Agent Record).
- This touches `Compressor.cls` → bootstrap bump in this story (Rule #24), and re-run the full Diagram OS test suite per-class (Rule #35).
- Faithful-rendering invariant still holds (Phase-2 pass-through preserves event order); the change only affects episode *grouping* of the abandoned-sync-then-pairloop shape.

### Authoritative item list & probe-first discipline

- The 14 items are enumerated in `deferred-work.md` line 566 (Epic 21 retro note) + line 595 (Epic 22 planned note). Full per-item detail (rationale, file pointers, suggested resolution) is in the individual "Deferred from: code review of story X" sections — READ each item's own entry before disposing it.
- **Rule #16 (probe before trusting):** several items' suggested resolutions embed unverified API claims — the `StartTask` `Device` arg (CR 16.3-device), the `(Production,Name)` index collation (CR 18.0-2), the `ExternalThaw` error-text echo (CR 16.3-thaw-password), and the no-scriptable-restore claim (AI#4). Probe each against live IRIS or `irislib/`/`irissys/` source (Rule #2) BEFORE coding or closing. Use disposable `ExecuteMCPv2.Temp.*` probe classes; delete them (IRIS + disk) before finishing.
- **Rule #35:** `iris_execute_tests` may return an early partial snapshot after a fresh load/compile — compare returned totals to the number of `Test*` methods and rerun per-class before trusting green.

### Constraints (all fixes)

- **Strictly additive (Rule #19):** no existing enabled action's success-output shape changes; no tool/schema removal. CR 20.0-1 in particular must NOT break the AC 20.0.7 back-compat gate — prefer input-validation or per-action docs over removing the `force`/`timeout` params.
- **Frozen governance baseline (Rules #23/#25):** `1e62c5ad5bf7` stays git-clean; `gen:governance-baseline:check` exit 0; NEVER run the bare `gen-governance-baseline.mjs` (it regrows/overwrites the frozen file — if tripped, `git checkout -- packages/shared/src/governance-baseline.ts`). CR 16.0-1's helper extraction touches the generator's key-derivation but must NOT change the emitted baseline content.
- **Bootstrap (Rule #24):** any ObjectScript class edit → `pnpm run gen:bootstrap`, move `BOOTSTRAP_VERSION` in THIS story (from `919124293f66`), `bootstrap.test.ts` green, idempotent second run, never hand-edit `bootstrap-classes.ts` (Rule #18). Batch OS edits to minimize churn but the version still moves in-story.
- **ObjectScript handler conventions:** namespace save/restore with NO `New $NAMESPACE` (catch restores first); single `RenderResponseBody` per path (Rule #7); `SanitizeError` for `%Status` propagation (Rule #9) with NO caret-prefixed global names in error text (Rule #33); no `$Get()` around a method call (Rule #15); no argumented `Quit` in Try/Catch; `t`/`p` prefixes; `$$$` macros; no method/param underscores.

### Precise pointers (verified this session)

- **CR 16.0-1/-2** — generator key-derivation at `scripts/gen-governance-baseline.mjs:185-211` (`unwrapActionOptions` + `addKey(\`${tool.name}:${value}\`)`); the governance runtime side is in `packages/shared/src/governance.ts` (5 files reference `computeGovernanceKey`-style logic: server-base.ts, governance.ts, and 3 `__tests__/governance-*.test.ts`). Extract ONE shared helper both import; the emitted 141-key frozen baseline content must be byte-identical after the refactor (verify with `gen:governance-baseline:check`).
- **CR 16.2-2** — `packages/iris-ops-mcp/src/tools/database.ts` (`iris_database_action` — `percentFull`/`targetSize`/`initialSize` params).
- **CR 16.1-3 / CR 16.3-device** — `packages/iris-ops-mcp/src/tools/process.ts` and the task tool; ObjectScript side `src/ExecuteMCPv2/REST/Monitor.cls` (ProcessGet) + `src/ExecuteMCPv2/REST/Task.cls` (task run).
- **CR 16.3-thaw-password / AI#4** — `packages/iris-ops-mcp/src/tools/backup.ts` + `src/ExecuteMCPv2/REST/Monitor.cls` BackupManage; IRIS source `irissys/%SYS/Backup/General.cls`.
- **CR 17.1-1 / CR 18.0-1 / CR 18.0-2** — `src/ExecuteMCPv2/REST/Interop.cls` (`DefaultSettingsManage` `||` guard; `ItemManage` add branch className/dup-name guards). Read `irislib/Ens/Config/Item.cls` for the `(Production,Name)` index + host-class validation options.
- **CR 20.0-1** — the `iris_production_control` tool (`packages/iris-interop-mcp/src/tools/` — the production control tool file) + `src/ExecuteMCPv2/REST/Interop.cls` ProductionControl (server-side `tForce`).
- **CR 21.0-2 / CR 21.1-1 / CR 21.1-2** — `src/ExecuteMCPv2/Diagram/Correlator.cls` (O(n²) pairing), `src/ExecuteMCPv2/Diagram/Compressor.cls` (`EpisodeCore` rule-A + Src=Dst frame push); fixtures in `src/ExecuteMCPv2/Tests/DiagramEpisodeTest.cls` / `DiagramEpisodeEdgeTest.cls` / `DiagramCorrelatorTest.cls`.

### Previous-story intelligence (Story 22.0, this epic)

- Story 22.0 committed `a1e4008`; `BOOTSTRAP_VERSION` currently `919124293f66`; frozen baseline `1e62c5ad5bf7` intact; `gen:governance-baseline:check` exit 0. Start from this state.
- Story 22.0's review added CR 22.0-D1/D2 to the ledger — leave them open (AC 22.1.7 permits Epic-22-own items).
- The `iris_execute_tests` class-report-truncation caveat bit repeatedly in 22.0 (Rule #35, new shape: the report truncates slow classes to the first 3 methods even when all pass) — verify via `%UnitTest_Result.TestMethod` SQL or per-method runs (target the method WITHOUT the `Test` prefix) when a class-level total looks short.

### Project Structure Notes

- Likely-touched (fix-dependent): `src/ExecuteMCPv2/REST/Interop.cls`, `src/ExecuteMCPv2/Diagram/Compressor.cls`, `src/ExecuteMCPv2/Diagram/Correlator.cls` (only if index-maps chosen), `src/ExecuteMCPv2/REST/Task.cls`/`Monitor.cls` (only if probes justify); `packages/iris-ops-mcp/src/tools/{database,process,backup}.ts`, `packages/iris-interop-mcp/src/tools/` production-control tool; a new shared governance key-derivation helper + its tests; `scripts/gen-governance-baseline.mjs`; `packages/shared/src/bootstrap-classes.ts` (REGEN only).
- ALWAYS: `_bmad-output/implementation-artifacts/deferred-work.md` (disposition mirror), this story file (disposition table).
- NEVER: `packages/shared/src/governance-baseline.ts` (frozen); any existing enabled-action output shape.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-22 Story 22.1 (lines 3857-3875)]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md lines 490-603 (per-item detail — authoritative)]
- [Source: scripts/gen-governance-baseline.mjs:185-217 (key-derivation to extract)]
- [Source: .claude/rules/project-rules.md Rules #7-#10, #15-#19, #23-#28, #33-#35; esp. #16 (probe-first), #24 (per-story bootstrap), #26 (destructive-path smoke rejection)]
- [Source: irislib/Ens/Config/Item.cls, irissys/%SYS/Task.cls, irissys/%SYS/Backup/General.cls (probe targets)]

## Dev Agent Record

### Agent Model Used

Claude Opus 4.8 (1M context) — `claude-opus-4-8[1m]`.

### Debug Log References

- **Rule #16 probe class** `ExecuteMCPv2.Temp.Probe221` (disposable) — deployed to HSCUSTOM, ran `HostGuardVerdict`/`IsAbstract`/`ProcessGetLatency`/`CorrelatorWorstCase`/`HasScriptableRestore`, then DELETED (IRIS + disk). Findings below.
- **Live REST guarded-path confirmations** (direct POST, bypassing governance per Rule #26 to exercise the ObjectScript handler guards): AI#4 restore-reject, CR 17.1-1 `||`-delimiter reject, CR 18.0-1 non-host + abstract add-reject (all `result:{}`, no write) + concrete-host control (passes guard, fails later at production-not-found).

### Completion Notes List

**Terminal disposition table for all 14 items + Epic 20 retro Action #2 is in `deferred-work.md`** under "Story 22.1 (2026-07-04) — DEFERRED-WORK LEDGER BURN-DOWN". Tally: **8 resolved · 6 closed-with-evidence · 1 operational-close · 0 re-deferred** (AC 22.1.1 honored).

**Rule #16 probe findings (recorded, probe class deleted):**
- CR 18.0-1 guard API verified: `Ens.BusinessService`→REJECT(abstract), `%Stream.GlobalCharacter`→REJECT(not Ens.Host), `EnsLib.File.PassthroughService`→ACCEPT, `Ens.Host`→REJECT(abstract). API = `$classmethod(cls,"%Extends","Ens.Host")` + `##class(%Dictionary.CompiledClass).%OpenId(cls).Abstract`.
- CR 16.1-3: `%SYS.ProcessQuery` MemoryUsed read = **4.8 ms/call** (10 iters) → immaterial.
- CR 21.0-2: `Correlate` worst case (all-unpaired Queue double-scan) **2000→0.136 s**, **10000→4.645 s** → default fast, documented cap.
- AI#4: `Backup.General` has **no** `RestoreDatabase`/`Restore`/`RestoreTask`/`RestoreJournal`/`StartRestore` classmethod.
- CR 16.3-device (source): `StartTask(...,Device="",IsTape="")` 4th arg is `[Internal]`+undocumented → retain+document-no-effect.
- CR 16.3-thaw-password (source): `ExternalThaw` body empty (kernel-generated) → no OS-layer password echo.
- CR 18.0-2 (source): `Index Name On (Production As Exact, Name As Exact)` = case-sensitive → guard already correct.

**Non-obvious decisions recorded:**
- **CR 21.1-1** — stakeholder Option A (code fix). A pairloop now unwinds an abandoned sync frame on `tEv.Req.Src`. Verified NO existing episode fixture assumed the old "pairloop-glues-composite" behavior (all 11 prior fixtures green), so none needed updating — the change only affects the abandoned-sync-then-pairloop shape (documented for the retro).
- **CR 20.0-1** — chose per-action DOCUMENTATION over reject/no-forward: a reject would change the silent-accept wire behavior for existing `{recover, force}` callers, risking the AC 20.0.7 back-compat gate; doc-only is byte-for-byte and makes the advertised contract accurate.
- **CR 16.3-device** — chose retain+document-no-effect over wire (unverified `[Internal]` arg, Rule #16) and over drop (a back-compat break per the Story 18.0 precedent for the sibling `namespace`/`device`-class params; an e2e test asserts `run` forwards `device`).
- **AI#4 minor note (out of scope):** the deployed restore-reject message names `^DBREST`/`CLUMENU^JRNRESTO`, which `SanitizeError` strips to `( / )` (a pre-existing Rule #33 cosmetic issue in `Monitor.cls`, NOT introduced here) — flagged for a future `Monitor.cls` touch; the rejection itself is functional.

**Verification:** BOOTSTRAP_VERSION `919124293f66` → **`e931a96373f0`** (Rule #24; idempotent second run byte-identical; regen-only, not hand-edited). Frozen governance baseline `1e62c5ad5bf7` git-clean; `gen:governance-baseline:check` exit 0 (141 frozen / 193 live / 52 post-foundation) — the CR 16.0-1 helper extraction left the emitted baseline byte-identical. Full monorepo `pnpm test` 12/12 tasks green (shared incl. new derivation test + refactored drift guard, ops 256, interop 270, admin 439, dev 351), lint 6/6, type-check 12/12. OS per-class (Rule #35): DiagramEpisodeTest 13/13, EpisodeEdge 3/3, Compressor 10/10, Correlator 18/18, Dedup 3/3, Generate 11/11.

### File List

**ObjectScript (edited on disk + deployed/compiled to HSCUSTOM):**
- `src/ExecuteMCPv2/Diagram/Compressor.cls` — CR 21.1-1 (pairloop rule-A unwind) + CR 21.1-2 (Src=Dst self-call push guard) in `EpisodeCore` + doc
- `src/ExecuteMCPv2/Diagram/Correlator.cls` — CR 21.0-2 documented-cap note (doc comment only)
- `src/ExecuteMCPv2/REST/Interop.cls` — CR 18.0-1 abstract/non-Ens.Host add guard
- `src/ExecuteMCPv2/Tests/DiagramEpisodeTest.cls` — `AddAbandonedGroup` helper + `TestAbandonedPairloopGroupsSymmetricWithRawPair` + `TestUnpairedSelfCallDoesNotGrowStack`
- `src/ExecuteMCPv2/Tests/DiagramEpisodeEdgeTest.cls` — *(QA stage)* `AddContinuedGroup` + `AddPairedSelfCallWrap` helpers + 3 adversarial fixtures (`TestAbandonedThenContinuedPairloopFormsCompositeEpisode` nest-branch complement, `TestPairedSelfCallStillPushesFrame`, `TestDeepSelfCallChainCollapsesAndIsolatesNextEpisode`)
- `src/ExecuteMCPv2/Tests/InteropHostGuardTest.cls` — *(QA stage, NEW)* 5-test OS regression pin of the CR 18.0-1 host/abstract/exists classification (`ClassifyHost` mirrors the handler's primitive order)

**TypeScript / generator:**
- `packages/shared/src/governance-baseline-derivation.ts` — NEW shared helper (CR 16.0-1)
- `packages/shared/src/__tests__/governance-baseline-derivation.test.ts` — NEW unit tests (CR 16.0-1/16.0-2)
- `packages/shared/src/__tests__/governance-derivation-lockstep.test.ts` — *(QA stage, NEW)* cross-check: shared helper ↔ generator CLI derive the identical live surface (CR 16.0-1)
- `packages/shared/src/__tests__/governance.test.ts` — CR 16.0-1 drift-guard uses shared helper; +30s timeout on the dist-import test
- `packages/shared/src/__tests__/governance-baseline-check.test.ts` — +30s timeouts on the `--check` CLI tests
- `packages/shared/src/bootstrap-classes.ts` — REGEN only (BOOTSTRAP_VERSION bump; Rule #18)
- `scripts/gen-governance-baseline.mjs` — CR 16.0-1 refactor (imports the shared derivation)
- `packages/iris-ops-mcp/src/tools/database.ts` — CR 16.2-2 Zod bounds
- `packages/iris-ops-mcp/src/tools/backup.ts` — CR 16.3-device `device` no-effect description
- `packages/iris-ops-mcp/src/__tests__/database.test.ts` — CR 16.2-2 bounds test
- `packages/iris-ops-mcp/src/__tests__/backup.test.ts` — CR 16.3-device description test
- `packages/iris-interop-mcp/src/tools/production.ts` — CR 20.0-1 per-action `timeout`/`force` docs
- `packages/iris-interop-mcp/src/__tests__/production.test.ts` — CR 20.0-1 doc test

**Ledger / story:**
- `_bmad-output/implementation-artifacts/deferred-work.md` — Story 22.1 closure section (all 15 dispositions)
- `_bmad-output/implementation-artifacts/22-1-deferred-work-burn-down.md` — this file (Tasks, Dev Agent Record, Change Log, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 22-1 → review

### Change Log

| Date | Change |
|------|--------|
| 2026-07-04 | Story 22.1 dev: 14 carried deferred items + Epic 20 retro Action #2 driven to terminal dispositions (8 resolved, 6 closed-with-evidence, 1 operational-close, 0 re-deferred). BOOTSTRAP_VERSION `919124293f66` → `e931a96373f0`; frozen baseline `1e62c5ad5bf7` unchanged. Status → review. |
| 2026-07-04 | Story 22.1 code review: 0 HIGH. 1 MED auto-resolved inline (ledger-hygiene — historical sections reconciled with superseding banners so the ledger genuinely closes at zero, AC 22.1.7). 1 LOW auto-resolved (doc staleness — File List + OS-totals note). 3 new LOW deferred to Epic-22-own section (CR 22.1-1 unreachable pairloop over-unwind; CR 22.1-2 dist/source skew; CR 22.1-3 pre-existing `Monitor.cls` restore-message caret-strip). Blind findings dismissed (refuted live). Disposition audit: all 14 items + Action #2 confirmed terminal. BOOTSTRAP_VERSION unchanged `e931a96373f0` (no ObjectScript changed by review). |

## Senior Developer Review (AI) — Code Review 2026-07-04

**Reviewer:** Code-review stage (Claude Opus 4.8 1M) · adversarial three-layer (Blind Hunter / Edge Case Hunter / Acceptance Auditor) + direct live-IRIS verification on HSCUSTOM.
**Outcome:** **APPROVE** — 0 HIGH, 1 MED (auto-resolved inline), 1 LOW doc (auto-resolved), 2 new LOW (deferred, AC-22.1.7-permitted). The burn-down is genuine: every one of the 14 carried items + Epic 20 Action #2 carries an accurate, terminal disposition.

### Disposition audit (the core deliverable) — VERDICT: all terminal, ledger truly at zero
Independently re-verified the non-trivial dispositions rather than trusting the record:
- **CR 18.0-1 (resolved)** — live HTTP POST to the REAL `ItemManage` handler (`/api/executemcp/v2/interop/production/item`, governance-bypassing per Rule #26): abstract `Ens.BusinessService` → rejected "abstract", non-host `%Stream.GlobalCharacter` → rejected "not an Ens.Host", concrete `EnsLib.File.PassthroughService` → passes guard then fails "Production not found" (proves order + no false-reject). All `result:{}` (no writes); messages carry no caret-globals (Rule #33 clean). Primitives confirmed live: `%Extends` is defined on `%Library.Base` (universal, never `<METHOD DOES NOT EXIST>`); `Ens.BusinessService`/`Ens.Host` Abstract=1, Passthrough service/operation Abstract=0.
- **CR 21.1-1 (resolved, Option A)** — re-ran `DiagramEpisodeTest` 13/13 + `DiagramEpisodeEdgeTest` 6/6 on the redeployed working tree. Symmetry confirmed: `TestAbandonedPairloopGroupsSymmetricWithRawPair` (split side) + the QA nest-branch complement pin both sides of the `tEv.Req.Src '= frameDest` branch. Pre-existing fixtures `AbandonedSyncRequestUnwind` + `NestedPairLoopInsideEpisode` stay green → no regression to the old grouping (dev's "no fixture assumed the old glue behavior" verified).
- **CR 21.1-2 (resolved)** — `TestPairedSelfCallStillPushesFrame` genuinely exercises the `PairId>0` exception (would go Count 8≠1 if the guard wrongly skipped paired self-calls); Edge Hunter confirmed all 4 (Src=Dst?, PairId=0?) combinations.
- **CR 16.0-1/16.0-2 (resolved)** — `gen:governance-baseline:check` exit 0, frozen 141-key baseline byte-identical + git-clean; shared tests force-run (not cached): `governance-baseline-derivation.test.ts` 13, `governance-derivation-lockstep.test.ts` (real CLI spawn) 1, `governance-baseline-check.test.ts` 4. Edge Hunter verified `deriveKeysForTool` is byte-behaviour-identical to the deleted inline logic.
- **CR 20.0-1 (resolved, docs)** — read the server `ProductionControl` handler: `tTimeout`/`tForce` consumed ONLY by `stop`/`restart` (`StopProduction(tTimeout,tForce)`); `start`/`update`/`recover`/`clean` never reference them → the per-action docs are TRUTHFUL and wire behavior is byte-for-byte unchanged (params still parsed).
- **Source-based closes (CR 16.3-device, CR 16.3-thaw-password, CR 18.0-2, AI#4)** — Acceptance Auditor independently confirmed each against `irissys`/`irislib` source (`ExternalThaw` empty body, `StartTask` `[Internal]`, no `Restore*` classmethod, `Index Name ... As Exact` case-sensitive).
- **CR 16.1-3, CR 21.0-2 (closed-with-evidence, measured)** — accepted as recorded (immaterial latency / documented cap).

### Findings
- **[MED — AUTO-RESOLVED] Ledger hygiene (AC 22.1.7).** The Story 22.1 closure section declared "zero open" but the historical gate/deferred sections still read "OPEN"/"carried"/"DEFER" for the same 14 items with no superseding marker — a grep for open work still hit them, undercutting the burn-down's core deliverable. **Fix:** added superseding banners to every historical section containing a now-terminal item (Epic 18 RE-DEFER/NEW, DEFER-AI#4, Epic 20 & 21 gates, the authoritative Epic 21 retro note, and the story 20.0/21.0/21.1 review sections) + struck-through the two "remain OPEN" status assertions, each back-referencing the closure table. `deferred-work.md`.
- **[LOW — AUTO-RESOLVED] Doc staleness.** File List omitted the QA-added `InteropHostGuardTest.cls`, `DiagramEpisodeEdgeTest.cls` edits, and `governance-derivation-lockstep.test.ts`; the ledger's OS-totals note said `DiagramEpisodeEdgeTest 3/3` (now 6/6) and "`Interop.cls` has no OS test class" (now pinned by `InteropHostGuardTest` 5/5). **Fix:** corrected both.
- **[LOW — DEFERRED as CR 22.1-1]** `EpisodeCore` pairloop rule-A leaves `tReqSrc=""` for a non-object `.Req` → over-unwind. UNREACHABLE by construction (pairloops always carry a real `.Req` — three-layer + construction-read consensus); `$IsObject` already prevents the only crash risk. One-line guard suggested for a future `Compressor.cls` touch (avoided a bootstrap re-roll right before the lead smoke for an unreachable path). See `deferred-work.md`.
- **[LOW — DEFERRED as CR 22.1-2]** CR 16.0-1 dist/source split: generator reads shared `dist`, drift test reads `src` — a stale dist after editing the derivation could re-open the lock-step gap. Maintenance-workflow; CI (`pnpm test` turbo-builds first) is protected. Suggested: `prebuild` on the `gen:*` scripts, or have the test import the dist. See `deferred-work.md`.
- **[LOW — DEFERRED as CR 22.1-3, pre-existing]** The `iris_backup_manage restore`-reject message (`Monitor.cls:BackupManage`) names `^DBREST`/`CLUMENU^JRNRESTO`; `SanitizeError` strips the carets (Rule #33), blanking them to `( / )`. Dev-flagged during AI#4 re-verification. **Assessed for in-scope fix → DEFER:** pre-existing + cosmetic (the rejection functions), and the one-line de-caret reword touches `Monitor.cls` → a bootstrap re-roll disproportionate to bundle immediately before the lead smoke. Fold into the next `Monitor.cls` touch (mirrors the Epic 20 `Ens.AppData` de-caret pattern). See `deferred-work.md`.
- **[DISMISSED]** Zod `.min/.max` back-compat (narrows only nonsensical inputs the server rejects anyway); `%Extends` throw risk (refuted — universal on `%Library.Base`); `deriveKeysForTool` parity (verified byte-identical + frozen hash unchanged).

### Verification totals
Full monorepo `pnpm test` green (shared 565, dev 351, interop 270, ops 256, admin 439; 12/12 turbo tasks); lint 6/6; type-check 12/12. OS per-class on HSCUSTOM (Rule #35, totals match method counts): DiagramEpisodeTest 13/13, DiagramEpisodeEdgeTest 6/6, InteropHostGuardTest 5/5. `gen:governance-baseline:check` exit 0 (141 frozen / 193 live / 52 post-foundation); frozen baseline `1e62c5ad5bf7` git-clean. `gen:bootstrap` idempotent — BOOTSTRAP_VERSION `e931a96373f0` unchanged by review (no ObjectScript modified; all auto-resolves were documentation-only).
