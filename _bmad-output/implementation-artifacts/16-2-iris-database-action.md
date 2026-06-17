# Story 16.2: `iris_database_action` — Database Operations

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator**,
I want **to mount/dismount and compact/defragment/truncate/expand databases**,
so that **I can run maintenance the admin create/delete tool doesn't cover**.

## ⚠️ Spec correction (Rule #16 — verify before trusting)

epics.md Story 16.2 names `%SYS.DatabaseCompact` and `%SYS.DatabaseDefragment` as backing classes. **Those classes do NOT exist** in this IRIS (`irissys/`). The real APIs are all **classmethods on `SYS.Database`** (verified against `irissys/SYS/Database.cls`):

| Action | API (verified) |
|---|---|
| `mount` | `SYS.Database.MountDatabase(Directory, readonly=0, cluster=0, mirrorcatchup=1)` (L813) |
| `dismount` | `SYS.Database.DismountDatabase(Directory)` (L619) |
| `compact` | `SYS.Database.CompactDatabase(Directory, PercentFull=90, .MbProcessed, .MbCompressed, Display=0, Device)` (L450) |
| `defragment` | `SYS.Database.Defragment(Directory)` (L829) |
| `truncate` | `SYS.Database.ReturnUnusedSpace(Directory, TargetSize=0, .ReturnSize)` (L925) — returns unused trailing space to the OS (shrinks the .DAT) |
| `expandVolume` | `SYS.Database.NewVolume(Directory, NewVolDir, InitialSize)` (L900) — adds a new volume to a multi-volume database. **Probe live (Rule #16)** to confirm exact semantics vs `ModifyVolumeDirectoryList` (L747) before committing; if `expandVolume` is not cleanly scriptable, DEFER it (like the 16.3 restore pattern) and document, rather than ship a half-working action. |

Flag this spec error in Completion Notes for the retro.

## Acceptance Criteria

1. **AC 16.2.1** — New tool `iris_database_action` in `@iris-mcp/ops`. Actions: `mount`, `dismount`, `compact`, `defragment`, `truncate`, `expandVolume` (the last subject to the Rule #16 probe above — defer with documentation if not cleanly scriptable). All actions MUTATE → all classified `mutates: "write"` → all default-disabled under governance.
2. **AC 16.2.2** — Backed by `SYS.Database` classmethods (see the corrected table above), NOT the non-existent `%SYS.DatabaseCompact`/`%SYS.DatabaseDefragment`. Config/SYS split per Rule #3: `SYS.Database` = runtime operations (mount state, compaction); `Config.Databases` = persistent config (already covered by the admin `iris_database_manage` create/modify/delete — do NOT duplicate).
3. **AC 16.2.3** — Input: `action`, `directory` (the database directory path — the SYS.Database APIs key on directory, not config name), action-specific params (`readonly` for mount; `percentFull` for compact; `targetSize` for truncate; `newVolDir`/`initialSize` for expandVolume), `server` (framework-injected, D2), `namespace` (optional, %SYS-scoped). Output: operation result/status (incl. compact's MbProcessed/MbCompressed, truncate's ReturnSize where applicable).
4. **AC 16.2.4** — `compact`/`defragment` (and `truncate` on a large DB) are **synchronous** `%Status`-returning classmethods (no native async/queue API exists). Run them synchronously and include a clear duration note in the tool description + response (these can take a while on large databases). Do NOT fabricate a started/queued status the API doesn't provide.
5. **AC 16.2.5** — Unit tests (TS) per action + governance-defaults coverage (all actions disabled by default, proven through the real `McpServerBase.handleToolCall` gate); `truncate` and `dismount` carry `destructiveHint: true`. ObjectScript handler deployed + compiled clean on HSCUSTOM.
6. **AC 16.2.6 (bootstrap, Rule #24)** — Regenerate `bootstrap-classes.ts` (`pnpm gen:bootstrap`) and record the `BOOTSTRAP_VERSION` from→to IN THIS STORY (handler edit reddens `bootstrap.test.ts` until regen; NOT deferred to 16.4). Predecessor value after 16.1: `d4e197ef5ffc`.
7. **AC 16.2.7 (governance frozen, Rule #23/#25)** — New `iris_database_action:*` keys ABSENT from frozen `governance-baseline.ts` (`1e62c5ad5bf7` / 141 keys, git-clean); governed by `mutates` + `defaultSeed`. `node scripts/gen-governance-baseline.mjs --check` exits 0. Do NOT run the bare generator (refuses without `--force`).
8. **AC 16.2.8** — Strictly additive: existing ops tools (incl. `iris_database_check`) AND admin `iris_database_manage` byte-for-byte unchanged; ops count 18 → 19 (`index.test.ts` `toHaveLength(19)`). Deploy via glob-prefixed `iris_doc_load` (Rule #17).
9. **AC 16.2.9** — Full monorepo green: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm type-check`.

## Tasks / Subtasks

- [x] **Task 1 — ObjectScript handler `DatabaseAction` on `ExecuteMCPv2.REST.Monitor` (AC 16.2.1–16.2.4)**
  - [x] Read `irissys/SYS/Database.cls` FIRST (Rule #2) — confirmed each classmethod signature in the corrected table (compact ByRef MbProcessed/MbCompressed; truncate ByRef ReturnSize).
  - [x] `DatabaseAction` (POST): body `{action, directory, ...params}`; dispatch to the matching `SYS.Database` classmethod; propagate the returned `%Status` via `SanitizeError` on failure (Rule #9); returns operation outputs (mbProcessed/mbCompressed for compact, returnSize for truncate, readonly for mount, newVolDir/initialSize for expandVolume).
  - [x] **expandVolume probe (Rule #16):** live-probed `SYS.CLS.IsMthd("SYS.Database","NewVolume")` = YES (all six methods exist). `NewVolume(Directory, NewVolDir, InitialSize)` is cleanly scriptable (3 simple params, returns %Status, no ByRef outputs) — IMPLEMENTED, not deferred. `ModifyVolumeDirectoryList` was the alternative but `NewVolume` matches the intended "add a volume to expand storage" semantics directly.
  - [x] **Guard:** `directory` required + existence checked via `##class(SYS.Database).%ExistsId(tDirectory)` before any action → clean error envelope, not an opaque `<...>` crash. Underlying API %Status (DB in use/locked/unmounted) propagated via SanitizeError. expandVolume also requires `newVolDir`.
  - [x] Namespace save/restore (`Set tOrigNS=$NAMESPACE`/`Set $NAMESPACE="%SYS"`/restore); NO `New $NAMESPACE`; restore as first line of catch.
- [x] **Task 2 — Dispatch route (AC 16.2.1)**
  - [x] Added `POST /monitor/database/action` → `Monitor:DatabaseAction` beside `GET /monitor/database` → `Monitor:DatabaseCheck`. No storage-section edits.
- [x] **Task 3 — TS tool `iris_database_action` (AC 16.2.1–16.2.4)**
  - [x] New `packages/iris-ops-mcp/src/tools/database.ts` modelled on `process.ts` (16.1) + `infrastructure.ts:databaseCheckTool`. Action enum `["mount","dismount","compact","defragment","truncate","expandVolume"]`; `mutates`: all `"write"`; `annotations.destructiveHint: true`. POST `/monitor/database/action`.
  - [x] Required-field validation (`directory` required for all; `newVolDir` required for expandVolume — both reject pre-flight without calling the server). Registered in `index.ts` `tools[]`.
  - [x] `scope:"NONE"`, `server` framework-injected (not on schema), optional `namespace` — consistent with `iris_process_manage`.
- [x] **Task 4 — Tests (AC 16.2.5, 16.2.8)**
  - [x] `database.test.ts` — 23 per-action unit tests (mock REST): each action's POST body + param passthrough; required-`directory` + required-`newVolDir` errors; compact mbProcessed/mbCompressed + truncate returnSize output fields; destructive annotation; namespace passthrough; server-rejection (invalid dir / DB-in-use) surfaced as isError.
  - [x] `database-governance.test.ts` — real-gate (handleToolCall), 3 tests: all 6 actions denied by default with GOVERNANCE_DISABLED; explicit enable of `compact` flips just that action; explicit enable of the destructive `dismount` flips just that action.
  - [x] Updated `index.test.ts` 18 → 19 (toolCount, getToolNames length) + name list + `toBeGreaterThanOrEqual(19)`.
- [x] **Task 5 — Deploy, bootstrap, verify (AC 16.2.6–16.2.9)**
  - [x] Deployed `Monitor.cls` + `Dispatch.cls` via glob-prefixed `iris_doc_load` (Rule #17); compiled explicitly by full class name (`ExecuteMCPv2.REST.Monitor.cls` + `ExecuteMCPv2.REST.Dispatch.cls`) — clean (0.122s).
  - [x] `pnpm gen:bootstrap`; `BOOTSTRAP_VERSION` `d4e197ef5ffc` → `f8b3a9e9704c`; `bootstrap.test.ts` green.
  - [x] `node scripts/gen-governance-baseline.mjs --check` exit 0 (141 frozen keys all present; 6 new keys among 29 allowed post-foundation); frozen `governance-baseline.ts` git-clean.
  - [x] `pnpm build && pnpm test && pnpm lint && pnpm type-check` all green.

## Dev Notes

### IRIS API (verified against `irissys/SYS/Database.cls` — Rule #2)
All operations are **classmethods on `SYS.Database`** (NOT the non-existent `%SYS.DatabaseCompact`/`%SYS.DatabaseDefragment` from the spec — see Spec correction). Signatures:
- `MountDatabase(Directory As %String, readonly As %Boolean = 0, cluster As %Boolean = 0, mirrorcatchup As %Boolean = 1) As %Status`
- `DismountDatabase(Directory As %String) As %Status`
- `CompactDatabase(Directory As %String, PercentFull As %Integer = 90, ByRef MbProcessed, ByRef MbCompressed, Display As %Boolean = 0, Device As %String) As %Status`
- `Defragment(Directory As %String) As %Status`
- `ReturnUnusedSpace(Directory As %String, TargetSize As %Integer = 0, ByRef ReturnSize) As %Status` (= truncate / shrink-to-OS)
- `NewVolume(Directory As %String, NewVolDir As %String, InitialSize As %Integer) As %Status` (= expandVolume candidate — probe per Rule #16)

These are SYNCHRONOUS — no async/queue. compact/defragment/truncate may run for a while on large DBs (AC 16.2.4: synchronous + duration note).

### Rule #3 — Config vs SYS separation (don't duplicate the admin tool)
`iris_database_action` is the SYS.Database RUNTIME-operations tool. It does NOT create/modify/delete database CONFIG — that's the admin `iris_database_manage` (Config.Databases + SYS.Database.CreateDatabase, Epic 11/12, in `Config.cls`). Keep them disjoint: this story is mount/dismount/compact/defragment/truncate/expandVolume only.

### Patterns to mirror
- **Read DB handler + route:** `Monitor:DatabaseCheck` at `GET /monitor/database` (`infrastructure.ts:databaseCheckTool`). Put the new action handler + `POST /monitor/database/action` beside it.
- **Governed write tool (action enum + per-action `mutates`):** `packages/iris-admin-mcp/src/tools/service.ts`.
- **Predecessor ops governed tool (this epic):** `iris_process_manage` (16.1, `packages/iris-ops-mcp/src/tools/process.ts`) — copy its `scope`/`server`/`namespace` decisions and its `*-governance.test.ts` real-gate pattern for consistency.
- **Governance contract (Story 15.0 strict):** every NEW action key classified in `mutates`; here ALL are `"write"` → all default-disabled.

### Bootstrap / governance frozen (Rules #18/#23/#24/#25)
Per-story bootstrap regen (predecessor `d4e197ef5ffc`); never hand-edit `bootstrap-classes.ts`. New keys must NOT enter the frozen `governance-baseline.ts` (`1e62c5ad5bf7`); verify with `node scripts/gen-governance-baseline.mjs --check` (Story 16.0 tool). Do NOT run the bare generator.

### Live smoke expectation (Rule #26 — lead gate)
The lead's smoke will hit the live endpoint and assert a **destructive path is safely handled on a disposable target** — e.g. create a throwaway test DB, dismount it (or attempt truncate), and/or assert a destructive action against an invalid/in-use directory is REJECTED with a clear error rather than corrupting anything. Build handlers so an invalid `directory` or in-use DB yields a clean refusal, not an opaque crash. NEVER run a destructive op against a real/system database.

### Project Structure Notes
- ObjectScript: extend `ExecuteMCPv2.REST.Monitor`; route in `Dispatch.cls`. No storage edits. No `New $NAMESPACE`.
- TS: new `database.ts` in `packages/iris-ops-mcp/src/tools/`, registered in `index.ts`.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-16.2] — ACs (note the `%SYS.DatabaseCompact`/`Defragment` class names are wrong — Rule #16 correction above).
- [Source: irissys/SYS/Database.cls] — verified classmethod signatures.
- [Source: .claude/rules/project-rules.md#2/#3/#9/#16/#23/#24/#25/#26].
- [Source: .claude/rules/iris-objectscript-basics.md#Namespace-Switching-in-REST-Handlers].
- [Source: packages/iris-ops-mcp/src/tools/process.ts] — predecessor governed ops tool (16.1).

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (dev-story stage, Epic 16 cycle).

### Debug Log References

- Live probe (Rule #16): `$SYSTEM.CLS.IsMthd("SYS.Database",<m>)` in %SYS confirmed all six methods exist — `NewVolume=YES | ReturnUnusedSpace=YES | CompactDatabase=YES | Defragment=YES | MountDatabase=YES | DismountDatabase=YES`.
- Compile: `ck` on `ExecuteMCPv2.REST.Monitor.cls` + `ExecuteMCPv2.REST.Dispatch.cls` — success in 0.122s.
- ops package tests: database.test.ts (23), database-governance.test.ts (3), index.test.ts (13) — all pass; full suite 12/12 packages green. (Counts corrected at code review — dev notes originally read 17/2.)

### Completion Notes List

- **Spec correction confirmed (Rule #16, flagged for retro):** epics.md Story 16.2 named `%SYS.DatabaseCompact` / `%SYS.DatabaseDefragment` — those classes do NOT exist. All six actions implemented against `SYS.Database` classmethods per the corrected story table, verified by live `$SYSTEM.CLS.IsMthd` probe + `irissys/SYS/Database.cls` source read.
- **expandVolume IMPLEMENTED (not deferred):** the Rule #16 probe showed `SYS.Database.NewVolume(Directory, NewVolDir, InitialSize)` is a real, cleanly scriptable classmethod (3 simple params, %Status return, no ByRef). It maps directly to "add a volume to expand storage," so it was wired up rather than deferred. `newVolDir` is required for that action (validated both TS-side pre-flight and in the handler after the directory-exists guard).
- **All 6 actions classified `mutates:"write"`** → all default-DISABLED under governance; new `iris_database_action:*` keys are absent from the frozen `governance-baseline.ts` (`1e62c5ad5bf7`, git-clean) and are governed via `mutates` + defaultSeed. `gen-governance-baseline.mjs --check` exit 0.
- **destructiveHint:true** at tool scope (dismount + truncate are the destructive verbs; MCP annotations are tool-scoped, not per-action — same pattern as `iris_process_manage`).
- **Clean refusal on bad directory:** handler checks `SYS.Database.%ExistsId(directory)` first → returns a sanitized error envelope, never an opaque `<...>`. Underlying API %Status (DB in use, locked, unmounted, insufficient space) is propagated via `SanitizeError` (Rule #9). This is what the lead's Rule #26 live smoke (destructive path safely rejected on a disposable/invalid target) should exercise against the deployed `POST /monitor/database/action`.
- **Strictly additive:** `iris_database_check` (ops) and admin `iris_database_manage` byte-for-byte unchanged; ops tool count 18 → 19.
- **Bootstrap (Rule #24, per-story):** `BOOTSTRAP_VERSION` moved `d4e197ef5ffc` → `f8b3a9e9704c` (Monitor.cls + Dispatch.cls edits). `bootstrap-classes.ts` regenerated via `pnpm gen:bootstrap` (never hand-edited).
- NOT committed (per dev-stage instruction — lead commits after smoke gate). `.vscode/settings.json` toggle was made by the deploy tool; left as-is for the lead.

### File List

- `src/ExecuteMCPv2/REST/Monitor.cls` (modified — new `DatabaseAction` classmethod)
- `src/ExecuteMCPv2/REST/Dispatch.cls` (modified — new `POST /monitor/database/action` route)
- `packages/iris-ops-mcp/src/tools/database.ts` (new — `iris_database_action` tool)
- `packages/iris-ops-mcp/src/tools/index.ts` (modified — import + register `databaseActionTool`)
- `packages/iris-ops-mcp/src/__tests__/database.test.ts` (new — 23 unit tests)
- `packages/iris-ops-mcp/src/__tests__/database-governance.test.ts` (new — 3 real-gate governance tests)
- `packages/iris-ops-mcp/src/__tests__/index.test.ts` (modified — 18 → 19)
- `packages/shared/src/bootstrap-classes.ts` (regenerated — `BOOTSTRAP_VERSION` `d4e197ef5ffc` → `f8b3a9e9704c`)

## Review Findings

Code review 2026-06-16 (3 layers: Blind Hunter, Edge Case Hunter, Acceptance Auditor). All 9 ACs PASS. No HIGH or MED code defects. All HIGH-if-violated invariants verified: six `SYS.Database` signatures match `irissys/SYS/Database.cls` exactly (arg count/order/ByRef); directory guarded via `%ExistsId` → clean SanitizeError envelope (Catch backstop, no opaque `<...>` crash); namespace save/restore correct with catch-first-line restore, no `New $NAMESPACE`; all 6 actions `mutates:"write"`; `iris_database_action:*` keys absent from frozen `governance-baseline.ts` (`1e62c5ad5bf7`, git-clean, `--check` exit 0); bootstrap `f8b3a9e9704c` (`bootstrap.test.ts` green, not hand-edited); strictly additive (ops 18→19, 212 tests green); no Config/SYS duplication (Rule #3). The governance test genuinely drives `McpServerBase.handleToolCall` with the real `mutates` map + schema.

- [x] [Review][Patch] Story doc test-count discrepancy corrected (17→23 unit, 2→3 governance) [16-2-iris-database-action.md Tasks/Debug Log/File List] — fixed during review.
- [x] [Review][Defer] `namespace` param accepted + forwarded on the wire but ignored server-side (handler hard-switches to `%SYS`) [packages/iris-ops-mcp/src/tools/database.ts:108-113,206; src/ExecuteMCPv2/REST/Monitor.cls DatabaseAction] — deferred, LOW. Identical to the already-deferred CR 16.1-1; database ops are genuinely %SYS-scoped (SYS.Database keys on directory), AC 16.2.3 lists `namespace` as optional with no mandated behavioral effect, description says "usually omitted" → AC-compliant.
- [x] [Review][Defer] No range validation on `percentFull` / `targetSize` / `initialSize` (Zod `z.number()` + bare `+%Get` coercion) [packages/iris-ops-mcp/src/tools/database.ts:90-107; src/ExecuteMCPv2/REST/Monitor.cls DatabaseAction] — deferred, LOW. Out-of-range values cannot corrupt or crash: each `SYS.Database` call returns `%Status` propagated via SanitizeError, with the Catch block as backstop → clean error envelope (the HIGH-if-violated guard invariant is met). Edge Case Hunter rated these HIGH on the assumption of an unguarded crash; downgraded after confirming the clean-envelope path.
- [x] [Review][Defer] ByRef outputs (`MbProcessed`/`MbCompressed`/`ReturnSize`) pre-init to 0, so a failed compact/truncate is indistinguishable from a no-op in the (un-rendered) result [src/ExecuteMCPv2/REST/Monitor.cls DatabaseAction] — deferred, LOW. On failure the error envelope is rendered instead of the result (success path never runs), so the caller never sees the zeroed counters; cosmetic only.

### Dismissed (noise / false positive)
- `percentFull` default-drift (Rule #10): FALSE POSITIVE — TS description says "default 90" and ObjectScript defaults `tPercentFull=90`; they match.
- "does not exist" message for a configured-but-unmounted DB: premise is wrong — `%ExistsId` is true for any configured DB, so `mount` on an unmounted DB passes the guard and runs; the message only fires for genuinely-unknown directories.
- `readonly` boolean coercion: works correctly (`+true`=1/`+false`=0; MountDatabase expects numeric 0/1).
- defragment/dismount returning no metric fields vs compact/truncate: correct — those APIs have no ByRef outputs.
- `success` reflects only `%Status` OK without state read-back: acceptable for these synchronous `%Status` APIs.
