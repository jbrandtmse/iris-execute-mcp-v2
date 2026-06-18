# Story 16.3: `iris_backup_manage` — Backups

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator**,
I want **to run backups and freeze/thaw the system**,
so that **I can perform and audit backups via the agent**.

## ⚠️ Restore path — verify-first outcome (Rule #16, AC 16.3.3)

Pre-dev research against `irissys/Backup/General.cls` confirms **`restore` is NOT cleanly scriptable** via `Backup.General`. The class's own doc comments (L47–L65) say to "restore the database files using your external restore mechanism" and restore journals via the **interactive** `CLUMENU^JRNRESTO` routine / `^DBREST` utility — there is no `RestoreDatabase()`-style classmethod. **Decision: DEFER `restore`** to a follow-up (document the limitation in the tool description + a deferred-work.md entry), exactly as AC 16.3.3 directs — do NOT ship a half-working restore. This story implements `run` / `freeze` / `thaw` / `listHistory` only.

## ⚠️ Verified API map (Rule #2/#16, against `irissys/Backup/General.cls`)

| Action | API (verified) | mutates |
|---|---|---|
| `run` | `Backup.General.StartTask(taskname, jobbackup, quietflag, Device, IsTape)` (L235, `[Internal]` but the scriptable run path) — `taskname` is a **user-defined backup task** (stored in `^SYS("BUTASKS",taskname)`). **LIVE-PROBE OUTCOME (Rule #16, 2026-06-16):** there are NO predefined/shipped backup task names on a stock IRIS instance — `^SYS("BUTASKS")` is undefined and `%SYS.Task` has no backup-type task rows. The operator must first define a backup task (name + database list + type) in the Management Portal; `StartTask` then runs it BY NAME. The backup *type* (full/incremental/cumulative) is a property of that task definition, NOT a separate `StartTask` argument and NOT something we can map to a guessed shipped name. **Decision: `run` accepts a required `taskName` (the operator's defined task) and passes it to `StartTask`. `backupType` is kept only as an OPTIONAL informational/descriptive field (not used to pick the task).** | write |
| `freeze` | `Backup.General.ExternalFreeze(LogFile, Text, SwitchJournalFile, TimeOut, …)` (L165) — quiesces DB writes for an external snapshot | write |
| `thaw` | `Backup.General.ExternalThaw(LogFile, Username, Password)` (L192) | write |
| `listHistory` | read `^SYS("BUHISTORY", …)` (backup history global; see L366/L376) and/or `GetLastFullBackupInfo()` (L354) | read |

## Acceptance Criteria

1. **AC 16.3.1** — New tool `iris_backup_manage` in `@iris-mcp/ops`. Actions: `run` (full/incremental/cumulative), `freeze`, `thaw`, `listHistory`. `listHistory` is read-only (enabled by default); `run`/`freeze`/`thaw` mutate and are **default-disabled**. `restore` is DEFERRED (documented, not implemented — see verify-first note).
2. **AC 16.3.2** — Backed by `Backup.General` (`StartTask` / `ExternalFreeze` / `ExternalThaw`) + the `^SYS("BUHISTORY")` history global. NOT a fabricated API.
3. **AC 16.3.3** — **Restore deferred (Rule #16):** confirmed not cleanly scriptable via `Backup.General` (interactive `^DBREST`/`CLUMENU^JRNRESTO`). The tool description states restore is not supported via this tool and points to the IRIS restore utility; a deferred-work.md entry records the limitation + suggested follow-up.
4. **AC 16.3.4** — Input: `action`, `taskName` (**required for `run`** — the operator's user-defined backup task; live-probe confirmed there are no predefined task names, see API map), `backupType` (`full`/`incremental`/`cumulative`, OPTIONAL informational only — NOT used to select the task), `jobbackup` (optional boolean for `run`, default 0 = run in-process), optional `device`/`logFile`/`description`, `server` (framework-injected), `namespace` (optional). Output: backup result (run: task started/result + log file; freeze/thaw: status; listHistory: history entries with timestamp/type/file/description).
5. **AC 16.3.5** — Unit tests (TS) per action + governance-defaults coverage (run/freeze/thaw disabled by default, listHistory enabled, through the real `McpServerBase.handleToolCall` gate); `run` and `freeze` carry appropriate hints (`freeze` blocks updates → `destructiveHint`/non-idempotent as appropriate; `run` non-idempotent). ObjectScript handler deployed + compiled clean on HSCUSTOM.
6. **AC 16.3.6 (bootstrap, Rule #24)** — Regenerate `bootstrap-classes.ts` (`pnpm gen:bootstrap`) and record `BOOTSTRAP_VERSION` from→to IN THIS STORY. Predecessor after 16.2: `f8b3a9e9704c`.
7. **AC 16.3.7 (governance frozen, Rule #23/#25)** — New `iris_backup_manage:*` keys ABSENT from frozen `governance-baseline.ts` (`1e62c5ad5bf7` / 141 keys, git-clean); `node scripts/gen-governance-baseline.mjs --check` exit 0. Do NOT run the bare generator.
8. **AC 16.3.8** — Strictly additive: all existing ops tools byte-for-byte unchanged; ops count 19 → 20 (`index.test.ts` `toHaveLength(20)`). Deploy via glob-prefixed `iris_doc_load` (Rule #17), compile by full class name.
9. **AC 16.3.9** — Full monorepo green: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm type-check`.

## Tasks / Subtasks

- [x] **Task 1 — ObjectScript handler `BackupManage` on `ExecuteMCPv2.REST.Monitor` (AC 16.3.1–16.3.4)**
  - [x] Read `irissys/Backup/General.cls` FIRST (Rule #2) — confirmed `StartTask(taskname,jobbackup,quietflag,Device,IsTape)` (L235), `ExternalFreeze(LogFile,Text,SwitchJournalFile,TimeOut,...)` (L165), `ExternalThaw(LogFile,Username,Password)` (L192); `^SYS("BUHISTORY",hindex,subkey)` shape (hindex=date*1000000+time; subkeys TYPE/STATUS/DESC/DEVICE/LOG/LIST/Complete) confirmed via `irissys/DBACKB.int` SETHISTORY.
  - [x] **`run` task-name probe (Rule #16) — DONE 2026-06-16:** live-probed `%SYS.Task` (no backup-type tasks) + `^SYS("BUTASKS")` (undefined). OUTCOME: no predefined/shipped task names exist; `StartTask` runs a USER-DEFINED task BY NAME, and the type is a property of that definition. `run` therefore takes a required `taskName`; `backupType` is optional informational only (cannot be auto-mapped). Planning artifact amended (Rule #5).
  - [x] `BackupManage` (POST): body `{action, taskName, backupType, jobbackup, device, logFile, description, username, password}`; dispatch: `run`→`StartTask(taskName,...)`, `freeze`→`ExternalFreeze`, `thaw`→`ExternalThaw`, `listHistory`→read `^SYS("BUHISTORY")`. Propagate `%Status` via `SanitizeError` (Rule #9).
  - [x] **`restore` guard:** if `action="restore"` arrives (it's not in the enum, but defend on the server too), return a clear "restore is not supported via this tool — use the IRIS restore utility" message, not a crash.
  - [x] Namespace save/restore (`%SYS`); NO `New $NAMESPACE`; restore first line of catch.
- [x] **Task 2 — Dispatch route**
  - [x] Add `POST /monitor/backup/manage` → `Monitor:BackupManage` to `Dispatch.cls` UrlMap (beside the other `/monitor/*` routes). No storage edits.
- [x] **Task 3 — TS tool `iris_backup_manage`**
  - [x] New `packages/iris-ops-mcp/src/tools/backup.ts` modelled on `database.ts` (16.2). Action enum `["run","freeze","thaw","listHistory"]`; `mutates: { run:"write", freeze:"write", thaw:"write", listHistory:"read" }`; annotations reflect freeze/run as mutating/non-idempotent. POST `/monitor/backup/manage` for all actions (handler reads `action` from body). Document restore-deferred in the description.
  - [x] Required-field validation (`taskName` required for `run` — amended from `backupType` per live-probe, Rule #5/#16). Register in `index.ts` `tools[]`.
  - [x] `scope`/`server`/`namespace` consistent with `iris_process_manage`/`iris_database_action`.
- [x] **Task 4 — Tests (AC 16.3.5, 16.3.8)**
  - [x] `backup.test.ts` — per-action unit tests (mock REST): each action's request body/param passthrough; `run` requires `taskName`; `listHistory` result shape; restore-not-supported messaging; freeze/thaw status. (20 tests)
  - [x] `backup-governance.test.ts` — real-gate: `run`/`freeze`/`thaw` denied by default, `listHistory` enabled by default, per-action re-enable via `IRIS_GOVERNANCE`. (4 tests)
  - [x] Update `index.test.ts` `toHaveLength(19)` → `toHaveLength(20)` + name list.
- [x] **Task 5 — Deploy, bootstrap, verify (AC 16.3.6–16.3.9)**
  - [x] Deploy `Monitor.cls` + `Dispatch.cls` via glob-prefixed `iris_doc_load` (Rule #17); compiled explicitly by full class name — clean.
  - [x] `pnpm gen:bootstrap`; `BOOTSTRAP_VERSION` `f8b3a9e9704c` → `04984d638f8d` → `fe972c4cb317` (the second bump is the code-review hardening of `BackupManage` listHistory, 2026-06-16); `bootstrap.test.ts` green.
  - [x] `node scripts/gen-governance-baseline.mjs --check` exit 0; frozen baseline git-clean (`1e62c5ad5bf7`).
  - [x] `pnpm build && pnpm test && pnpm lint && pnpm type-check` green.

## Review Findings (code-review stage, 2026-06-16)

Three adversarial layers run (Blind Hunter, Edge Case Hunter, Acceptance Auditor inline against the spec). All HIGH-if-violated invariants from the stage brief verified PASS: API map correct against `irissys/Backup/General.cls` (`StartTask`/`ExternalFreeze(LogFile,Text,...)`/`ExternalThaw(LogFile,Username,Password)`), `^SYS("BUHISTORY")` `hindex = days*1000000+seconds` decode confirmed against IRIS source (General.cls:366-367 + DBACKB.int:38), `%Status` propagated via `SanitizeError` (Rule #9), restore defended server-side + deferred (Rule #16), run-taskName spec amendment in the planning artifact (Rule #5), namespace save/restore correct with catch-first-line and NO `New $NAMESPACE`, governance keys absent from frozen `governance-baseline.ts` (`--check` exit 0, git-clean), bootstrap green + not hand-edited, strictly additive (ops 19→20), new tests in the DEFAULT suite. Real-runtime evidence genuine: `backup-e2e.test.ts` drives the full registered-callback → `handleToolCall` gate → real handler → real `IrisHttpClient` (fetch-mocked only); `backup-governance.test.ts` drives the real gate (write actions denied by default, listHistory allowed).

- [x] [Review][Patch] listHistory aborts on a malformed/out-of-range BUHISTORY index — RESOLVED in review [src/ExecuteMCPv2/REST/Monitor.cls listHistory branch] — added a canonical-positive-integer subscript filter + a per-entry `Try/Catch` around `$ZDateTime`, so one corrupt node degrades to `timestamp:""` instead of failing the whole read. Redeployed + recompiled clean on HSCUSTOM; `gen:bootstrap` re-run (`04984d638f8d` → `fe972c4cb317`); bootstrap.test.ts green; frozen baseline git-clean + `--check` exit 0.
- [x] [Review][Defer] `device` param accepted + forwarded but ignored by the `run` StartTask call [src/ExecuteMCPv2/REST/Monitor.cls; packages/iris-ops-mcp/src/tools/backup.ts] — MED, "silently-ignored input"; same class as the deferred `namespace`/`backupType`-informational pattern. In deferred-work.md.
- [x] [Review][Defer] `thaw` password passthrough to `SanitizeError` — theoretical Rule #9 echo [src/ExecuteMCPv2/REST/Monitor.cls thaw branch] — LOW; no evidence `ExternalThaw` echoes the password; needs a maintenance-window live capture before any redaction. In deferred-work.md.
- [x] [Review][Defer] optional `namespace` forwarded but unread (%SYS-scoped) — LOW, mirrors CR 16.1-1 / CR 16.2-1 (pre-existing dev-recorded entry). In deferred-work.md.

Dismissed as noise: tool-scoped `destructiveHint:true` while listHistory is read (intentional + documented; per-action realized via `mutates`); unbounded-freeze footgun (governance default-disable + destructive hint + doc warning is the chosen control, AC-aligned); truncated error-message `...` (diff-elision artifact, real strings are complete).

## Dev Notes

### ⚠️ freeze/thaw are instance-wide and DISRUPTIVE — smoke carefully
`ExternalFreeze` quiesces ALL database writes on the instance until `ExternalThaw`. On the shared HSCUSTOM dev instance, an actual freeze can disrupt concurrent work. **Do NOT live-run an actual freeze during dev/QA.** The lead's live smoke will exercise the SAFE/read paths (`listHistory`) and assert the GOVERNED/guarded paths reject cleanly (e.g. `run` with a bad/missing `backupType` → clean error; the deferred `restore` → clear "not supported"), NOT perform a real freeze. If a freeze/thaw round-trip must ever be verified, it is a deliberate, announced, paired operation on a maintenance window — out of scope for the per-story smoke.

### IRIS API (verified against `irissys/Backup/General.cls` — Rule #2)
- `StartTask(taskname As %String, jobbackup As %Boolean = 0, quietflag As %Boolean = 1, Device As %String = "", IsTape As %String = "") As %Status` — runs a predefined backup task (probe exact task names live, Rule #16).
- `ExternalFreeze(LogFile, Text, SwitchJournalFile=1, TimeOut=10, Hibernate=0, Verbose=0, …) As %Status`.
- `ExternalThaw(LogFile, Username, Password) As %Status`.
- `GetLastFullBackupInfo() As %String` + `^SYS("BUHISTORY", time)` history global for `listHistory`.
- No scriptable restore (interactive `^DBREST`/`CLUMENU^JRNRESTO`) → `restore` deferred (AC 16.3.3).

### Patterns to mirror
- **Predecessor ops governed tools (this epic):** `iris_process_manage` (16.1) and `iris_database_action` (16.2) — copy `scope`/`server`/`namespace`, the `mutates` map shape, required-field validation, and the `*-governance.test.ts` real-gate pattern.
- **Handler home:** `ExecuteMCPv2.REST.Monitor` (+ Dispatch route), beside the other `/monitor/*` handlers.
- **Governance contract (Story 15.0):** every new action classified; here `listHistory`=read, the rest=write.

### Bootstrap / governance frozen (Rules #18/#23/#24/#25)
Per-story bootstrap regen (predecessor `f8b3a9e9704c`); never hand-edit `bootstrap-classes.ts`. New keys NOT in frozen `governance-baseline.ts` (`1e62c5ad5bf7`); verify via `node scripts/gen-governance-baseline.mjs --check`. Do NOT run the bare generator.

### Project Structure Notes
- ObjectScript: extend `ExecuteMCPv2.REST.Monitor`; route in `Dispatch.cls`. No storage edits. No `New $NAMESPACE`.
- TS: new `backup.ts` in `packages/iris-ops-mcp/src/tools/`, registered in `index.ts`.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-16.3] — ACs (restore verify-first explicitly anticipated).
- [Source: irissys/Backup/General.cls] — verified API + restore-not-scriptable confirmation.
- [Source: .claude/rules/project-rules.md#2/#9/#16/#23/#24/#25/#26].
- [Source: .claude/rules/iris-objectscript-basics.md#Namespace-Switching-in-REST-Handlers].
- [Source: packages/iris-ops-mcp/src/tools/database.ts] — predecessor governed ops tool (16.2).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context) — bmad-dev-story.

### Debug Log References

- Live IRIS probe (HSCUSTOM/%SYS, Rule #16): `%SYS.Task` enumerated (16 system tasks, NO backup-type tasks); `^SYS("BUTASKS")` undefined; `^SYS("BUHISTORY")` undefined; `Backup.General.GetLastFullBackupInfo()` returned the `$LB(0,"No information recorded about a full backup")` form. Conclusion: no predefined backup task names exist; `StartTask` runs a user-defined task by name; backup type is a property of the task definition.
- `^SYS("BUHISTORY")` subkey shape verified by source (`irissys/DBACKB.int` SETHISTORY): hindex=date*1000000+time; subkeys STATUS/DESC/DEVICE/TYPE/LOG/LIST/Complete.
- DANGER honored: NO real freeze/thaw was ever run live (instance-wide write quiesce on shared HSCUSTOM). freeze/thaw verified by code inspection + the governance gate only.

### Completion Notes List

- **Spec amendment (Rule #5 / #16):** live-probe found the story's `run` selector premise wrong — there are no shipped backup task names to map `backupType` onto. Amended the API map, AC 16.3.4, and Task 1 IN PLACE: `run` now takes a required `taskName`; `backupType` is optional informational only. Recorded in deferred-work.md for retro traceability.
- ObjectScript `BackupManage` added to `ExecuteMCPv2.REST.Monitor`: dispatch `run`→`StartTask`, `freeze`→`ExternalFreeze`, `thaw`→`ExternalThaw`, `listHistory`→reverse-`$Order` walk of `^SYS("BUHISTORY")` (skips the `0` index node; max 50 entries; hindex→`$ZDateTime(...,3)`). `restore` rejected with a clear not-supported message (defense in depth; restore deferred per AC 16.3.3). Namespace save/restore to `%SYS` with catch-first-line restore; NO `New $NAMESPACE`. `%Status` propagated via `SanitizeError` (Rule #9). Compiled clean on HSCUSTOM.
- Dispatch route `POST /monitor/backup/manage` added beside the other `/monitor/*` routes (no storage edits).
- TS tool `iris_backup_manage` added (modelled on `database.ts`): scope NONE, `mutates {run:write, freeze:write, thaw:write, listHistory:read}`, destructiveHint true (freeze quiesces all writes), non-idempotent. `restore` absent from the enum; restore-deferred documented in the description. `run` requires `taskName` (early client-side reject). Registered in `index.ts` (ops 19 → 20).
- Tests: `backup.test.ts` (20) + `backup-governance.test.ts` (4, real `McpServerBase.handleToolCall` gate) + `index.test.ts` updated to 20. ops package 236 tests green; full monorepo `pnpm test` 12/12 packages green (shared 504).
- Bootstrap (Rule #24): `pnpm gen:bootstrap` → `BOOTSTRAP_VERSION` **`f8b3a9e9704c` → `04984d638f8d`** (Monitor.cls + Dispatch.cls embedded); `bootstrap.test.ts` green; not hand-edited. **Code-review follow-up (2026-06-16):** the `BackupManage` listHistory loop was hardened (per-entry `$ZDateTime` guard + canonical-integer subscript filter) to resolve a HIGH robustness finding; redeployed + recompiled clean on HSCUSTOM and `pnpm gen:bootstrap` re-run → `04984d638f8d` → **`fe972c4cb317`**; `bootstrap.test.ts` still green (41); frozen `governance-baseline.ts` unchanged + `--check` exit 0.
- Governance (Rule #23/#25): frozen `governance-baseline.ts` (`1e62c5ad5bf7`, 141 keys) git-clean; `node scripts/gen-governance-baseline.mjs --check` exit 0 (live 176→180 keys, +4 backup keys all post-foundation). Bare generator NOT run.
- `pnpm build`, `pnpm test`, `pnpm lint` (6/6), `pnpm type-check` (12/12) all green.
- NOT staged/committed (lead stages after smoke gate). `.vscode/settings.json` not touched.

### File List

- `src/ExecuteMCPv2/REST/Monitor.cls` (modified — added `BackupManage` classmethod)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified — added `/monitor/backup/manage` route)
- `packages/iris-ops-mcp/src/tools/backup.ts` (new — `iris_backup_manage` tool)
- `packages/iris-ops-mcp/src/tools/index.ts` (modified — registered `backupManageTool`)
- `packages/iris-ops-mcp/src/__tests__/backup.test.ts` (new — 20 unit tests)
- `packages/iris-ops-mcp/src/__tests__/backup-governance.test.ts` (new — 4 real-gate tests)
- `packages/iris-ops-mcp/src/__tests__/index.test.ts` (modified — 19 → 20 + name)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — BOOTSTRAP_VERSION f8b3a9e9704c → 04984d638f8d)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — Story 16.3 restore-deferred + run task-name + namespace-ignored entries)
- `_bmad-output/implementation-artifacts/16-3-iris-backup-manage.md` (this story — spec amendment + Dev Agent Record)
