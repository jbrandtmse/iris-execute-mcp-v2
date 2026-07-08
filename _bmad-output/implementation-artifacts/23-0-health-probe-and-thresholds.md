# Story 23.0: Health Probe & Threshold Research

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a **dev agent**,
I want **every `[PROBE]` marker in spec 01 §3 resolved against live IRIS / `irislib` source, and the default thresholds sanity-checked on the live instance**,
so that **Story 23.1 codes the `/monitor/health` endpoint against pinned, verified APIs instead of assumptions — no `<METHOD DOES NOT EXIST>` / wrong-property surprises mid-implementation.**

This is a **research / spec-amendment story** (spec §4 story 1). It produces **no production code and no vitest surface** — its deliverable is the amended binding spec `research/feature-specs/01-health-check.md` §3 table (every `[PROBE]` filled with the exact pinned property/method) plus the threshold cross-check evidence recorded in this story's Dev Agent Record. All exploration uses disposable `ExecuteMCPv2.Temp.*` probe classes that MUST be deleted before completion.

## Acceptance Criteria

- **AC 23.0.1** — Every `[PROBE]` row in spec 01 §3 is resolved by reading the **existing handler source** (`src/ExecuteMCPv2/REST/Monitor.cls`, `Config.cls`, `Interop.cls`) + `irislib`/`irissys` class source (Rules #2/#16), specifically:
  - **`locks`** — pin the exact source that exposes lock-**table utilization %** (spec hint: `SYS.Lock` or `%SYS.LockQuery`; verify which property/method actually reports table usage vs. lock count). Mirror whatever the existing locks handler already does.
  - **`memory`** — pin an **instance-wide** global-buffer / shared-memory source in the `SYS.Stats.*` family, OR conclude with evidence that no reliable instance-wide source exists and **fold `memory` into `system`** (dropping it as a separate area), per the spec's explicit escape clause. Rule #5: instance-wide samplers only, never per-process `$ZU`.
  - **Every remaining area** (`system`, `databases`, `journal`, `mirror`, `license`, `ecp`, `alerts`, `interop`) — confirm its data-access pattern mirrors the **existing handler exactly** (copy the system-class call; do NOT re-derive from docs). Record the exact method/property each area will read.
- **AC 23.0.2** — Default thresholds (spec §2 table: `journalPctWarn=80/Crit=92`, `dbFreePctWarn=10/Crit=3`, `licensePctWarn=80/Crit=95`, `lockTablePctWarn=50/Crit=85`) are cross-checked against the **live instance's** actual metric values (via the existing MCP ops tools / live probes) and Management-Portal-dashboard semantics; any deviation or unit mismatch (e.g., "free % vs. used %", "MB vs. blocks") is documented with rationale so 23.2's TS verdict engine applies them correctly.
- **AC 23.0.3** — Spec `research/feature-specs/01-health-check.md` §3 table is **amended in place** with the pinned properties/methods (no remaining `[PROBE]` markers; each area row names the concrete API). All disposable `ExecuteMCPv2.Temp.*` probe classes are **deleted** from the live instance (verify with `iris_doc_list` filter `ExecuteMCPv2.Temp*` → empty).

## Tasks / Subtasks

- [x] **Task 1 — Read the existing handlers (mirror-source discovery)** (AC: 23.0.1)
  - [x] Open `src/ExecuteMCPv2/REST/Monitor.cls` and locate the existing methods that back the ops tools: system metrics (`SYS.Stats.Global.Sample()` / `SYS.Stats.Routine.Sample()`), journal-info, mirror-status, locks-list, license-info, ECP-status, alerts (`$SYSTEM.Monitor`). Record each area's exact system-class call + the raw fields it reads.
  - [x] Open `src/ExecuteMCPv2/REST/Config.cls` `DatabaseList` — record the `Config.Databases` list + `SYS.Database.%OpenId(dir)` pattern and the exact Size/MaxSize fields used for the free-% math (mirror it; do NOT invent new math — Rule #3 Config vs SYS separation).
  - [x] Open `src/ExecuteMCPv2/REST/Interop.cls` production-queues logic — record how queue depth per item is read and the interop-enabled-namespace gate.
- [x] **Task 2 — Resolve the two `[PROBE]` rows against live IRIS** (AC: 23.0.1)
  - [x] `locks`: read `irislib`/`irissys` source for `SYS.Lock` / `%SYS.LockQuery`; build a disposable `ExecuteMCPv2.Temp.ProbeLocks` classmethod that returns candidate lock-table-utilization fields; compile + invoke via `iris_execute_classmethod`; confirm which property reports **table usage %** (or the numerator/denominator to compute it). Pin it.
  - [x] `memory`: read `irislib` `SYS.Stats.*` (global buffer / shared-memory) source; probe candidate instance-wide fields via a disposable `ExecuteMCPv2.Temp.ProbeMemory`; either pin a reliable instance-wide source OR record the evidence that none exists and recommend folding `memory` into `system`.
- [x] **Task 3 — Cross-check thresholds on the live instance** (AC: 23.0.2)
  - [x] For each threshold pair, fetch the live value via the existing ops MCP tools (or the pinned probe) and confirm the unit/direction matches the spec ("free space BELOW % triggers" for db/journal; "used %" for license/locks). Document actual live readings + any deviation.
- [x] **Task 4 — Amend the spec + clean up** (AC: 23.0.3)
  - [x] Edit `research/feature-specs/01-health-check.md` §3 table in place: replace every `[PROBE]` with the pinned API; add a one-line note per area naming the concrete method/property. If `memory` folds into `system`, mark it so in the table and the Areas-enum note.
  - [x] Delete all `ExecuteMCPv2.Temp.*` probe classes (`iris_doc_delete` or classmethod); verify `iris_doc_list` filter `ExecuteMCPv2.Temp*` returns empty.
  - [x] Record the full probe evidence (each pinned API + live threshold readings) in this story's **Completion Notes List**.

## Dev Notes

### What this story is (and is NOT)
- **IS:** live-IRIS API pinning + spec amendment. The output is a spec §3 table with zero `[PROBE]` markers and this story file's Dev Agent Record holding the evidence.
- **IS NOT:** any TypeScript, any new ObjectScript handler, any test file, any bootstrap change. Story 23.1 writes the endpoint; Story 23.2 writes the TS tool. If you find yourself editing `Monitor.cls` or a `.ts` file, STOP — that is out of scope for 23.0.

### Probe-first discipline (Rules #2 / #14 / #16 — mandatory)
- For every uncertain IRIS API: **read the class source first** in `irislib/` / `irissys/` (verify method exists, signature, ROWSPEC, `[Deprecated]` flags — Rules #2/#4), THEN confirm with a disposable `ExecuteMCPv2.Temp.*` probe class (compile → `iris_execute_classmethod` → inspect → **delete**). Do NOT trust web docs for IRIS-idiosyncratic APIs — prefer the live probe (Rule #14).
- `execute_classmethod` only works on **ClassMethods**. For instance methods, wrap in a temporary classmethod.
- Rule #5: system-wide counters come from `SYS.Stats.Global.Sample()` (RefLocal+RefPrivate+RefRemote) and `SYS.Stats.Routine.Sample().RtnCommands` — **never** `$ZU(190,...)` (per-process). The `memory` probe must find an instance-wide source in this same family or fold into `system`.

### The §3 probe table (from the binding spec — what to pin)
| Area | Mirror this existing source | Status to resolve |
|---|---|---|
| `system` | `Monitor.cls` metrics (`SYS.Stats.Global/Routine.Sample()`) | confirm exact fields |
| `databases` | `Config.cls` `DatabaseList` (`Config.Databases` + `SYS.Database.%OpenId`) | confirm free-% math fields; unmounted → `notApplicable` |
| `journal` | existing journal-info handler | confirm % full of journal dir |
| `mirror` | existing mirror-status handler | `notApplicable` when no mirror |
| `locks` | **`[PROBE]`** — `SYS.Lock` / `%SYS.LockQuery` | **PIN lock-table utilization %** |
| `license` | existing license handler (`$SYSTEM.License`) | confirm used/max % |
| `ecp` | existing ECP handler | `notApplicable` when no ECP |
| `alerts` | existing alerts handler (`$SYSTEM.Monitor` state) | count active; severity ≥ 2 ⇒ warning |
| `memory` | **`[PROBE]`** — `SYS.Stats.*` global-buffer/shared-mem | **PIN instance-wide source OR fold into `system`** |
| `interop` | `Interop.cls` production-queues | queue depth per item; interop-namespace gate else `notApplicable` |

### Design constraints for 23.1 that your pins must respect (so record them accordingly)
- ObjectScript stays **dumb**: it returns **raw per-area values** in one round-trip; thresholds→findings→verdict live in TS (23.2). So pin the RAW numerators/denominators (e.g., journal dir bytes used + total), not a pre-computed verdict.
- Per-area **Try/Catch isolation** in 23.1 means each area's probe must be independently callable — note any area whose read requires a namespace switch to `%SYS` (Rules #7 / iris-objectscript-basics "Namespace Switching in REST Handlers": save/restore, never `New $NAMESPACE`).
- `notApplicable` markers (no mirror / no ECP / non-interop namespace / unmounted db) must be **distinguishable from errors** — note how each area detects "not configured" cleanly.

### Live IRIS access
- HSCUSTOM namespace on `localhost:52773` via the `iris-execute-mcp` / `iris-dev-mcp` MCP tools (`iris_doc_get`, `iris_doc_list`, `iris_execute_classmethod`, `iris_doc_load`, `iris_doc_delete`). Default creds `_SYSTEM`/`SYS`. Live IRIS testing is confirmed working on this instance.
- If a spawned-agent MCP-tool-inventory gap blocks live probing, STOP with `## Clarification Needed` — the lead has session-level MCP access and can run the probes.

### Precedent
- Story 17.0 (`17-0-epic-16-deferred-cleanup.md` / `17-0-api-probes.md`) is the analogous pre-spec API-probe story — same "read source → probe → pin the spec → delete Temp classes" shape. Its discoveries (INFORMATION_SCHEMA underscore names; `AdapterClassName` is a read-only method) are the model for how to record a pinned-vs-assumed discrepancy.

### Project Structure Notes
- Deliverable files: **edit** `_bmad-output/planning-artifacts/research/feature-specs/01-health-check.md` (§3 table in place); **fill** the Dev Agent Record below. No source-tree files change in this story.
- No sprint-status story-key collision: this is `23-0-health-probe-and-thresholds` (a feature/research story, NOT a deferred-cleanup slot — Epic 23's deferred items were re-deferred at the kickoff retro-review gate).

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Epic-23 Story 23.0] — AC 23.0.1–23.0.3.
- [Source: _bmad-output/planning-artifacts/research/feature-specs/01-health-check.md#3-ObjectScript-work] — the `[PROBE]` table (authoritative to amend).
- [Source: _bmad-output/planning-artifacts/research/feature-specs/00-conventions.md#3] — ObjectScript handler + probe-first + deploy conventions.
- [Source: .claude/rules/project-rules.md] — Rules #2 (read IRIS source), #3 (Config/SYS/Security separation), #5 (instance-wide vs per-process counters), #14/#16 (live probe over web research), #4 (Deprecated properties).

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

Live probes on HSCUSTOM via disposable `ExecuteMCPv2.Temp.ProbeHealth` (compiled, invoked via
`iris_execute_classmethod`, deleted before completion — verified `iris_doc_list` filter
`ExecuteMCPv2.Temp*` returns empty):
- `ProbeLocks()`: `##class(SYS.Lock).GetLockSpaceInfo()` → `"305653680,305645056,6224"`, byte-identical
  to raw `$zu(156,6)` (`SameString=1`). `##class(SYS.Lock).GetMaxLockTableSize()` → `1099511562240`
  (= 1TB − 64KB, a theoretical ceiling, NOT real capacity — confirmed unusable as a denominator).
  Parsed: Available=305,653,680 Usable=305,645,056 Used=6,224; UtilizationPct
  = Used/(Usable+Used)*100 = **0.0020%**.
- `ProbeMemory()`: `##class(SYS.History.SharedMemoryData).Sample()` called directly →
  Allocated/Available/Used/SMTUsed/GSTUsed/TotalUsed all BLANK (only `TotalGSTSMTAllocated=1703936`
  populated). `##class(%ResultSet).%New("SYS.Stats.Buffer:Sample")` → one row (8192-byte pool):
  `Size=8192 NumSize=521088 Avail=519881 Interact=62602` (clean, live, non-Internal).
- `ProbeMemoryFull()` (the `%New→Sample→Finalise` dance `%Monitor.System.HistoryMemory.GetSample()`
  uses internally, no `%Save`): populated `Allocated=7471104 Available=2982542 Used=4488562
  TotalUsed=5508515` (Used+Available=Allocated exactly; ~60.08% used) — works, but only via the
  3-step `[Internal]`-flagged dance; direct `Sample()` alone (as above) leaves the byte fields blank.
- `ProbeDashboard()`: `##class(SYS.Stats.Dashboard).Sample()` →
  `DatabaseSpace=Normal JournalStatus=Normal JournalSpace=Normal LockTable=Normal WriteDaemon=Normal
  LicenseLimit=8 LicenseCurrent=0 LicenseCurrentPct=0 LicenseHighPct=13 SeriousAlerts=0
  ApplicationErrors=0 Processes=4`. Class doc comment: "contains all of the data that's available on
  the Dashboard in the System Management Portal" — no memory/buffer field present anywhere on it.
- `ProbeJournalSpace()`: `PrimaryDir=AlternateDir=C:\InterSystems\IRISHealth\mgr\journal\` (SameDir=1).
  Existing `%SYS.Journal.System.GetFreeSpace()` = `359769714688`. New
  `##class(%Library.File).GetDirectorySpace(PrimaryDir,.Free,.Total,0)` → `FreeBytes=359769714688`
  (byte-identical to the existing call) `TotalBytes=511067549696` → **FreePct=70.3957%** (29.6% full).
- Production MCP tool cross-checks (read-only, no state change): `iris_journal_info` →
  `freeSpaceBytes=359769628672` (matches probe within normal inter-call drift); `iris_license_info` →
  `userLimit=8, connectionLimit=0, currentCSPUsers=0` (connectionLimit=0 confirmed NOT a valid
  denominator — `$SYSTEM.License.GetConnectionLimit()` doc: "max connections PER USER... 0 means no
  limit has been set", unrelated to overall license capacity); `iris_locks_list` → 9 held locks
  (matches the ~0% utilization reading); `iris_metrics_system` + `iris_database_list` → **all 15
  databases report `maxSizeMB`/`maxSize`=0** (unlimited — SYS.Database.MaxSize doc: "0=unlimited
  (recommended)"); `iris_mirror_status` → `isMember=false`; `iris_ecp_status` → `configured=false`;
  `iris_metrics_alerts` → `state=0 ("OK")` with `alertCount=4`, all 4 alert entries individually
  tagged `severity:"OK"` (confirmed this is a copy of the handler's own `tStateText`, not a genuine
  per-alert severity — see `Monitor.cls:SystemAlerts()` line `Do tAlert.%Set("severity", tStateText)`);
  `iris_production_status` (HSCUSTOM) → `stateCode=2` ("Stopped"), `name=""`; `iris_production_queues`
  → `{"queues":[],"count":0}` (clean empty result, NOT an error — confirms `notApplicable` must gate
  on `GetProductionStatus()` erroring, not on "no production running").

### Completion Notes List

- **AC 23.0.1 (mirror-source discovery + two `[PROBE]` rows) — DONE.** All 8 pre-existing areas
  confirmed to mirror their exact existing handler methods (recorded per-area in the amended §3
  table with exact classmethod/property names). Two `[PROBE]` rows resolved:
  - **`locks` PINNED**: `##class(SYS.Lock).GetLockSpaceInfo()` (namespace `%SYS`) → CSV
    `"Available,Usable,Used"` bytes. Live-verified byte-identical to the raw `$zu(156,6)` call that
    InterSystems' own `%Monitor.System.LockTable` sensor (the shipped Lock Table health/alert class)
    uses internally; `UtilizationPct = Used/(Usable+Used)*100` is the exact formula that sensor uses.
    `GetMaxLockTableSize()` is explicitly rejected as the denominator (theoretical ~1TB ceiling, not
    real capacity — would read as permanently ~0%).
  - **`memory` DROPPED, folded into `system`** (spec's explicit escape clause exercised). Three
    candidates evaluated with live evidence (full detail in Debug Log References + spec §3): (1)
    `SYS.Stats.Dashboard` — InterSystems' own System Dashboard data source — has no memory/buffer
    field at all, evidencing IRIS has no standard "memory health" concept comparable to
    DatabaseSpace/JournalSpace/LockTable/WriteDaemon; (2) `SYS.Stats.Buffer:Sample` works cleanly
    (non-`[Internal]`) but reports LRU/cache-turnover mechanics where low availability is normal,
    healthy caching, not exhaustion — thresholding it would false-positive; (3)
    `SYS.History.SharedMemoryData.Sample()` does report genuine heap-used bytes but ONLY through a
    3-step `[Internal]`-flagged `%New→Sample→Finalise` dance (direct `Sample()` alone leaves the
    numeric fields blank, live-verified) — inconsistent with the single-classmethod-call shape of
    every other Rule #5 precedent (`SYS.Stats.Global`/`Routine`, neither `[Internal]`-flagged).
    Judgment: no reliable, uniform, non-Internal instance-wide source exists — fold into `system`,
    per spec's own escape clause. `system`'s existing raw payload is unchanged (no new fields added).
- **AC 23.0.2 (threshold cross-check) — DONE, with one substantive correction.** Found and fixed a
  **threshold-direction ambiguity** in spec §2: the shared parenthetical "(free space BELOW these %
  triggers)" read as applying to all four threshold pairs, but only `dbFreePctWarn`/`Crit` are
  genuinely descending (metric = free-%, low is bad). `journalPctWarn`/`Crit`,
  `licensePctWarn`/`Crit`, and `lockTablePctWarn`/`Crit` are all ascending (metric = used/full-%,
  high is bad) — matching their own §3 "% full" / "used/max %" / "utilization %" framing. Proved
  concretely with live data: this instance's journal is 29.6% full / 70.4% free (healthy). Read
  correctly ("% full ≥ 80 ⇒ warn"), that's healthy — no warning. Misread as "free% < 80 ⇒ warn", a
  perfectly healthy instance would incorrectly show "warning" (70.4 < 80). Spec §2 amended with an
  explicit direction-correction paragraph plus per-threshold directional notes in the §3 table.
  Additional threshold-relevant findings, all documented in the amended spec: `dbFreePct` is
  `notApplicable` for every database on this instance (all 15 have `MaxSize=0`, IRIS's own
  "recommended" unlimited setting — a likely-common case worth flagging, not a defect); `license`
  denominator must be `GetUserLimit()` (8), never `GetConnectionLimit()` (0 on this Community Edition
  instance — an unrelated per-user cap whose value would be a division-by-zero/nonsense denominator);
  `lockTablePctCrit=85` numerically equals InterSystems' own dashboard "Warning" threshold (their own
  "Troubled"/critical is 95%) — our defaults alert meaningfully earlier than the stock Management
  Portal, which is recorded as a deliberate-looking but stakeholder-confirmable design choice, not a
  bug; `alerts`' spec instruction "severity ≥ 2 ⇒ warning" cannot key off the existing handler's
  `alerts[].severity` field (a copy of the overall state text, not real per-alert data) — corrected
  to key off the numeric `state` field instead (live-verified `state=0` with a nonzero `alertCount`
  proves `alertCount` alone is not a reliable signal).
- **AC 23.0.3 (spec amendment + cleanup) — DONE.**
  `_bmad-output/planning-artifacts/research/feature-specs/01-health-check.md` amended in place: §2
  threshold direction corrected + Areas enum drops `memory` (with rationale pointer); §3 table
  every row pinned with the concrete classmethod/property (zero `[PROBE]` markers remain); §4 Story
  1 breakdown line marked DONE with an outcome summary. All `ExecuteMCPv2.Temp.*` probe classes
  deleted from HSCUSTOM; `iris_doc_list` filter `ExecuteMCPv2.Temp*` verified empty.
- **Namespace-switch note** (Dev Notes ask, "note any area whose read requires a namespace switch to
  %SYS"): `system`, `databases`, `journal`, `mirror`, `locks` (new pin), `ecp`, `alerts` all switch to
  `%SYS` in their existing/mirrored handler methods. **`license`'s existing handler
  (`Monitor.cls:LicenseInfo()`) does NOT switch namespace** — `$SYSTEM.License.*` calls work from any
  namespace as-is (an existing-codebase asymmetry, not something introduced here; 23.1 should mirror
  each area's own existing switch behavior exactly rather than assume a blanket "always switch"
  rule). `interop` does not switch to `%SYS` — it operates in the current/target namespace for
  `Ens.*` calls (mirrors `Interop.cls:QueueStatus()`).
- No production ObjectScript or TypeScript touched; no `BOOTSTRAP_VERSION` / `bootstrap-classes.ts`
  / `governance-baseline.ts` change (research/spec-amendment story, no source-tree edits — matches
  Dev Notes "IS NOT" list exactly). No automated tests added (correct outcome — there is no testable
  production surface in this story; Story 23.1 adds the `%UnitTest` coverage against these pins).

### File List

- `_bmad-output/planning-artifacts/research/feature-specs/01-health-check.md` (modified — §2
  threshold-direction correction + Areas enum update; §3 table fully pinned, zero `[PROBE]`
  markers remain; §4 Story 1 line marked DONE)
- `_bmad-output/implementation-artifacts/23-0-health-probe-and-thresholds.md` (modified — task
  checkboxes, Dev Agent Record, File List, Change Log, Status)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — `23-0-health-probe-and-thresholds` → in-progress → review)
- No `src/ExecuteMCPv2/` files changed (research-only story). Disposable
  `ExecuteMCPv2.Temp.ProbeHealth.cls` was loaded to HSCUSTOM for live probing and deleted before
  completion (never committed to the repo — written only to the session scratchpad directory
  outside the git tree).

## Change Log

| Date | Change |
|---|---|
| 2026-07-07 | Story 23.0 dev pass complete: every `[PROBE]` in spec 01-health-check.md §3 resolved (`locks` pinned to `SYS.Lock.GetLockSpaceInfo()`; `memory` dropped/folded into `system` with evidence); threshold-direction ambiguity found and corrected in §2 (journal/license/lockTable are ascending %-utilized, only dbFreePct is descending %-free); default thresholds cross-checked against live HSCUSTOM values and InterSystems' own `SYS.Stats.Dashboard`/`%Monitor.System.LockTable` semantics; all `ExecuteMCPv2.Temp.*` probe classes deleted and verified empty. Status: ready-for-dev → review. |
| 2026-07-07 | Code review (three-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor, plus live-IRIS pin re-verification). **All pins verified CORRECT** against handler source + live IRIS: `locks` formula `Used/(Usable+Used)` confirmed byte-for-byte against `%Monitor.System.LockTable.GetSample`; `GetLockSpaceInfo()`=`$zu(156,6)` (same=1); `GetMaxLockTableSize()`=1TB−64KB sentinel (denominator rejection justified); `GetUserLimit()`=8 vs `GetConnectionLimit()`=0 (correct denominator); `alerts` `severity`=stateText-copy confirmed (`Monitor.cls:168`); `memory`-drop confirmed (`SYS.Stats.Dashboard` has no memory field); `%Library.File.GetDirectorySpace` verified; Temp classes verified deleted (`iris_doc_list`→empty). ADR H5 (OS-raw/TS-judgment split) compliant. 9 spec clarifications auto-fixed inline; 6 downstream items deferred to 23.1/23.2 (deferred-work.md); 3 dismissed. 0 unresolved HIGH/MEDIUM. Status: review → done. |

## Review Findings (code review 2026-07-07)

**Verification result: pins CLEAN.** The deliverable's pin-correctness (the whole point of this research story) was adversarially verified against `irislib`/`Monitor.cls`/`Config.cls`/`Interop.cls` source AND live HSCUSTOM. Every area's pinned method/property exists and mirrors its handler; the `locks` denominator, the `memory` drop, all four threshold directions, the `license` denominator, and the `alerts` state-field correction are each confirmed correct. Zero `[PROBE]` markers remain in the §3 table; all `ExecuteMCPv2.Temp.*` probe classes verified deleted. The findings below are spec-clarity refinements (auto-fixed) and forward-looking 23.1/23.2 design considerations (deferred) — NOT pin errors.

**Patches applied (9 — auto-fixed inline in `01-health-check.md` per patch-handling option 1):**
- [x] [Review][Patch] `system` enum descriptor "global buffer" → "global reference" — `SYS.Stats.Global`=global *references*, not buffers; the buffer source was explicitly rejected for `memory`, so the stale descriptor mis-advertised the payload (MED) [§2 Areas enum]
- [x] [Review][Patch] `alerts` state→level mapping completed — `state=1` (Warning) was unmapped ⇒ an IRIS-flagged warning would read `ok`; disambiguated the `warning/critical` slash (Hung=-1⇒critical); verified `state` values via `Monitor.cls:145` (MED) [§3 alerts row]
- [x] [Review][Patch] `license` `userLimit=0` divide-by-zero guard added (⇒`notApplicable`, mirroring `databases` `maxSize>0`) + authoritative `SYS.Stats.Dashboard.LicenseCurrent(Pct)` pointer (MED) [§3 license row]
- [x] [Review][Patch] `interop` gate attribution corrected (the `GetProductionStatus` gate lives in sibling `Interop.cls:ProductionStatus()`/`Monitor.cls:544`, not `QueueStatus()`) + pinned that "no Ens classes" ⇒ `notApplicable` raw signal (NOT the per-area `error` catch), so §5 AC 4 holds (MED) [§3 interop row]
- [x] [Review][Patch] general `%`-denominator zero-guard note added — databases/license/locks/journal all ⇒ `notApplicable`, never divide-by-zero (LOW) [§3]
- [x] [Review][Patch] `dbFreePct` boundary prose "free space BELOW" → "AT-OR-BELOW" to match the pinned `value <= threshold` (LOW) [§2 direction correction]
- [x] [Review][Patch] `locks` — explained the intentionally-unused `Available` CSV field + pinned the denominator against the verified `%Monitor.System.LockTable.GetSample` formula (LOW) [§3 locks row]
- [x] [Review][Patch] §4 story numbering — annotated local "Story 2/3" = epic "Story 23.1/23.2" to prevent wrong-story pinning (LOW) [§4]
- [x] [Review][Patch] `memory` row relabeled "DROPPED — NOT an area" (evidence-only; don't regenerate the 9-area enum from the 10-row table) (LOW) [§3 memory row]

**Deferred (6 — forward-looking 23.1/23.2 design; logged in `deferred-work.md` under "code review of story-23.0"):**
- [x] [Review][Defer] `databases` space-health inert when `maxSize=0` (common) — consider volume-free-% via `GetDirectorySpace` like `journal` (MED, CR 23.0-1) — deferred to 23.1/23.2
- [x] [Review][Defer] `license` `CSPUsers()` numerator may under-count vs authoritative `LicenseCurrent` under load (MED, CR 23.0-2) — deferred to 23.1/23.2
- [x] [Review][Defer] no health-LEVEL criteria for applicable-but-unhealthy `mirror`/`ecp`/`interop`/`system` (MED, CR 23.0-3) — deferred to 23.2
- [x] [Review][Defer] `databases` per-DB → single-area finding aggregation rule unspecified (MED, CR 23.0-4) — deferred to 23.2
- [x] [Review][Defer] `databases` `%OpenId` open-failure indistinguishable from `notApplicable` — should be `error` (LOW, CR 23.0-5) — deferred to 23.1
- [x] [Review][Defer] 23.2 tool-input validation — dropped `memory` enum value / `areas:[]` / threshold override bounds+ordering (LOW, CR 23.0-6) — deferred to 23.2

**Dismissed (3):**
- Task-3's "(free space BELOW % triggers) for db/journal" instruction contradicts the direction correction — the task text was written PRE-discovery; the deliverable (§2 + Completion Notes) is authoritative and correct (handled elsewhere).
- "shared parenthetical read as applying to all four threshold pairs" in Completion Notes slightly overstates (the original annotated journal+dbFree) — cosmetic; the correction's conclusion is correct.
- Composite-handler per-area `%SYS` namespace restore (EH#9) — standard handler discipline (conventions §3 + Rule #7), already flagged in Dev Notes and substantially covered by the interop `notApplicable` patch.
