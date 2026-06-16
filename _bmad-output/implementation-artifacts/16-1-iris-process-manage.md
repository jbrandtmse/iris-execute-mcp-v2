# Story 16.1: `iris_process_manage` — Process Detail & Control

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **operator**,
I want **process detail and the ability to terminate/suspend/resume IRIS processes**,
so that **I can manage runaway or stuck processes** (extends the read-only `iris_jobs_list`).

## Acceptance Criteria

1. **AC 16.1.1** — New tool `iris_process_manage` in `@iris-mcp/ops`. Actions: `get` (process detail incl. stack/state/routine/namespace via `%SYS.ProcessQuery`), `terminate`, `suspend`, `resume` (via `SYS.Process`). `get` is read-only; the three control actions mutate and are **default-disabled** under governance.
2. **AC 16.1.2** — `terminate` carries `destructiveHint: true` (MCP annotation), and is classified `mutates: "write"`.
3. **AC 16.1.3** — Input: `action`, `pid`, `server` (optional — ops governance/profile param, follow the prevailing ops pattern), `namespace` (optional). Output: process detail (for `get`) or action result (for control actions).
4. **AC 16.1.4** — Guard against terminating/suspending the **calling process** and **critical system jobs** with a clear refusal (not a silent no-op or a crash). Use `%SYS.ProcessQuery.CanBeTerminated` / `CanBeSuspended` flags and a self-PID check (`$JOB`) as the basis. A refused control action changes nothing and returns an explanatory message.
5. **AC 16.1.5** — Unit tests (TS) covering each action + governance-defaults coverage (control actions disabled by default, `get` enabled), proven through the real `McpServerBase.handleToolCall` gate (mirror the existing `*-governance.test.ts` pattern). ObjectScript handler deployed + compiled clean on HSCUSTOM.
6. **AC 16.1.6 (bootstrap, Rule #24)** — Regenerate `packages/shared/src/bootstrap-classes.ts` via `pnpm gen:bootstrap` and record the `BOOTSTRAP_VERSION` move (from→to) IN THIS STORY (the ObjectScript handler change makes `bootstrap.test.ts` go red until regen — this is NOT deferred to Story 16.4; 16.4 only VERIFIES idempotence). Current version: `e5f4f6d88c56`.
7. **AC 16.1.7 (governance frozen, Rule #23)** — The new `iris_process_manage:*` keys are NEW post-foundation keys: they MUST be ABSENT from the frozen `governance-baseline.ts` (hash `1e62c5ad5bf7` / 141 keys, unchanged) and governed by `mutates` + `defaultSeed`. Do NOT run `gen:governance-baseline` (Rule #25); after the work, `node scripts/gen-governance-baseline.mjs --check` must exit 0 (frozen keys all retained; new process keys reported as allowed post-foundation). The one-directional `governance.test.ts` drift guard stays green.
8. **AC 16.1.8** — Strictly additive: `iris_jobs_list` and every other existing ops tool are byte-for-byte unchanged; ops tool count 17 → 18 (`index.test.ts` `toHaveLength(18)`). Deploy via glob-prefixed `iris_doc_load` (Rule #17).
9. **AC 16.1.9** — Full monorepo green: `pnpm build`, `pnpm test`, `pnpm lint`, `pnpm type-check`.

## Tasks / Subtasks

- [x] **Task 1 — ObjectScript handler (`ProcessManage` + `ProcessGet`) on `ExecuteMCPv2.REST.Monitor` (AC 16.1.1, 16.1.4)**
  - [x] Read `irissys/%SYS/ProcessQuery.cls` and `irissys/SYS/Process.cls` FIRST (Rule #2). Confirmed: `SYS.Process` control methods are **instance** methods (`Resume()`, `Suspend()`, `Terminate(SendError)`); `%SYS.ProcessQuery` exposes `CanBeTerminated`/`CanBeSuspended`/`State`/`Routine`/`NameSpace`/`UserName`/`Pid`/etc.
  - [x] `ProcessGet` (GET): opens `%SYS.ProcessQuery` for one PID; returns state/routine/namespace/user/counters + `canBeTerminated`/`canBeSuspended`/`canBeExamined`/`isCurrentProcess`. Stack/variable inspection intentionally NOT exposed (only via mailbox-message methods requiring target cooperation — documented in the method banner).
  - [x] `ProcessManage` (POST): body `{action, pid}`; opens `SYS.Process` by pid and calls the instance method; propagates the returned `%Status` via `SanitizeError` on failure (Rule #9).
  - [x] **Self/critical-process guard (AC 16.1.4):** refuses if `pid = $JOB` (any action) OR `CanBeTerminated`/`CanBeSuspended` is false for the action — returns `{action, pid, refused:true, reason}` (HTTP 200) BEFORE invoking any control method. Verified live (see Completion Notes).
  - [x] Namespace save/restore (`Set tOrigNS=$NAMESPACE` / `Set $NAMESPACE="%SYS"` / restore); NO `New $NAMESPACE`; restore is first line of every catch.
- [x] **Task 2 — Dispatch routes (AC 16.1.1)**
  - [x] Added to `Dispatch.cls` UrlMap: `GET /monitor/process` → `Monitor:ProcessGet` and `POST /monitor/process/manage` → `Monitor:ProcessManage` (after `/monitor/jobs`). No storage-section edits.
- [x] **Task 3 — TS tool `iris_process_manage` (AC 16.1.1–16.1.3)**
  - [x] New `packages/iris-ops-mcp/src/tools/process.ts` modelled on `jobs.ts` + `service.ts`. Action enum `["get","terminate","suspend","resume"]`; `mutates: { get:"read", terminate:"write", suspend:"write", resume:"write" }`; `annotations.destructiveHint: true`. `get` → `GET /monitor/process?pid=`; control → `POST /monitor/process/manage`.
  - [x] Registered in `packages/iris-ops-mcp/src/tools/index.ts` `tools[]`.
  - [x] `scope: "NONE"` (matches read sibling `jobs.ts`; process ops are %SYS-internal in the handler). `server` is framework-injected (D2) — not declared on the schema, matching `service.ts`. Optional `namespace` param accepted + forwarded.
- [x] **Task 4 — Tests (AC 16.1.5, 16.1.8)**
  - [x] `process.test.ts` (14 tests) — per-action unit tests (mock REST layer): `get` detail shape, each control POST body, self/critical refusal surfaced, pid coercion, error paths.
  - [x] `process-governance.test.ts` (4 tests) — real `handleToolCall` gate: control actions denied by default w/ `GOVERNANCE_DISABLED`, `get` enabled, per-action re-enable via `IRIS_GOVERNANCE`.
  - [x] Updated `index.test.ts`: `>=16`→`>=17`, `17`→`18` (toolCount + getToolNames length), added `iris_process_manage` to the name list.
- [x] **Task 5 — Deploy, bootstrap, verify (AC 16.1.6, 16.1.7, 16.1.8, 16.1.9)**
  - [x] Deployed Monitor.cls + Dispatch.cls via glob-prefixed `iris_doc_load` (Rule #17); compiled clean via `iris_doc_compile` (`ck`).
  - [x] `pnpm gen:bootstrap`; `BOOTSTRAP_VERSION` `e5f4f6d88c56` → `3a395abc1eba` (dev) → `d4e197ef5ffc` (after the code-review handler fixes); `bootstrap.test.ts` green.
  - [x] `node scripts/gen-governance-baseline.mjs --check` exits 0; frozen `governance-baseline.ts` git-clean (`1e62c5ad5bf7`).
  - [x] `pnpm build && pnpm test && pnpm lint && pnpm type-check` all green.

## Dev Notes

### IRIS API (verified live against sources — Rule #2/#16)
- **`SYS.Process`** (`irissys/SYS/Process.cls`) — INSTANCE class. Control methods are instance methods: `Resume() As %Status`, `Suspend() As %Status`, `Terminate(SendError As %Integer = 0) As %Status`. Open by PID: `Set tProc = ##class(SYS.Process).%OpenId(pid)` then `Set tSC = tProc.Suspend()` etc. (`%SYSTEM.Process.Terminate(pid, ExitStatus)` is a classmethod alternative for terminate only — prefer the `SYS.Process` instance path for uniformity across the three control actions.)
- **`%SYS.ProcessQuery`** (`irissys/%SYS/ProcessQuery.cls`) — the read/detail source (already used by `JobsList`). Useful columns: `Pid` (32), `State` (6), `Routine` (3), `NameSpace` (2), `UserName` (8), `CanBeSuspended` (21), `CanBeTerminated` (22), `ClientIPAddress`, `CommandsExecuted`, `GlobalReferences`, `CPUTime`, etc. Use `CanBeTerminated`/`CanBeSuspended` for the AC 16.1.4 guard.
- **Self-process guard:** `$JOB` is the calling process PID — refuse a control action targeting it.

### Existing patterns to mirror (do NOT reinvent — Rule: research-first)
- **Read handler:** `src/ExecuteMCPv2/REST/Monitor.cls:JobsList` (`%SQL.Statement.%ExecDirect` over `%SYS.ProcessQuery`, namespace save/restore, `RenderResponseBody`, `SanitizeError` in catch). [Source: src/ExecuteMCPv2/REST/Monitor.cls#L264-L305]
- **Governed write handler + dispatch:** `AlertsManage` + routes `/monitor/alerts/manage` (POST). [Source: src/ExecuteMCPv2/REST/Dispatch.cls#L129-L132]
- **TS governed write tool:** `packages/iris-admin-mcp/src/tools/service.ts` — action enum, `mutates` per-action map (read vs write), required-field validation, GET-by-query + POST-mutate split, `IrisApiError` handling. [Source: packages/iris-admin-mcp/src/tools/service.ts#L40-L180]
- **TS read tool (process-shaped):** `packages/iris-ops-mcp/src/tools/jobs.ts` (`iris_jobs_list`). [Source: packages/iris-ops-mcp/src/tools/jobs.ts]
- **Governance classification contract (Story 15.0 strict):** EVERY action key of a NEW tool must be classified in `mutates` (reads enabled, writes default-disabled). A forgotten classification throws at registration. `mutates?: "read" | "write" | Record<string,"read"|"write">` lives in `packages/shared/src/tool-types.ts:97`.

### Bootstrap (Rule #24 — per-story, NOT deferred)
Editing `Monitor.cls` + `Dispatch.cls` changes the hash-bootstrapped class set, so `bootstrap.test.ts` (on-disk == embedded == `BOOTSTRAP_VERSION`) goes red until you run `pnpm gen:bootstrap`. Regenerate and record the version move in THIS story. Both classes are already in the generator's class list (`scripts/gen-bootstrap.mjs`). Current `BOOTSTRAP_VERSION = "e5f4f6d88c56"`. Never hand-edit `bootstrap-classes.ts` (Rule #18).

### Governance frozen (Rule #23 / #25)
New `iris_process_manage:get|terminate|suspend|resume` keys must NOT be added to the frozen `governance-baseline.ts`. They are governed by `mutates` + `defaultSeed` (get→enabled, control→disabled). Verify with `node scripts/gen-governance-baseline.mjs --check` (the Story 16.0 tool — exit 0, frozen file untouched). Do NOT run the bare generator (it now refuses without `--force` — Story 16.0 footgun guard).

### Live smoke expectation (Rule #26 — lead gate, informs dev too)
The lead's per-story smoke will hit the live endpoint and assert (a) `get` returns detail for a safe PID, and (b) a **destructive/control action is REJECTED** for a guarded target (e.g. terminating the calling process / a critical job) — changing nothing. Build the handler so this guarded refusal is observable over real HTTP.

### Project Structure Notes
- ObjectScript: extend existing `ExecuteMCPv2.REST.Monitor` (do not create a new handler class unless size dictates — Monitor is the ops handler home). Routes in `Dispatch.cls`.
- TS: new `process.ts` in `packages/iris-ops-mcp/src/tools/`, registered in `index.ts`.
- No storage-section edits (compiler-managed). No `New $NAMESPACE` in REST handlers.

### References
- [Source: _bmad-output/planning-artifacts/epics.md#Story-16.1] — ACs + implementation notes (`%SYS.ProcessQuery` + `SYS.Process`; `$SYSTEM.Process.Terminate` semantics).
- [Source: .claude/rules/project-rules.md#2] — read IRIS class source before wrapping.
- [Source: .claude/rules/project-rules.md#3] — Config.* vs SYS.* vs Security.* (here SYS.Process = runtime control, %SYS.ProcessQuery = runtime state).
- [Source: .claude/rules/project-rules.md#23/#24/#25] — frozen baseline, per-story bootstrap regen, `--check`.
- [Source: .claude/rules/project-rules.md#26] — live-endpoint smoke asserts guarded rejection of destructive paths.
- [Source: .claude/rules/iris-objectscript-basics.md#Namespace-Switching-in-REST-Handlers] — save/restore, no `New $NAMESPACE`.

## Review Findings (code-review stage, 2026-06-16)

Reviewed via `/bmad-code-review` (Blind Hunter + Edge Case Hunter + Acceptance Auditor + a dedicated IRIS-source API verification pass). The IRIS-source pass confirmed **every** `%SYS.ProcessQuery` property and `SYS.Process` method name/casing/signature used by the handler matches the local source exactly (`irissys/%SYS/ProcessQuery.cls`, `irissys/SYS/Process.cls`) — no Rule #2 mismatch. Governance/bootstrap mechanical invariants all verified: frozen `governance-baseline.ts` git-clean (`1e62c5ad5bf7`); `gen-governance-baseline.mjs --check` exit 0; `bootstrap.test.ts` green; new tests in the DEFAULT vitest suite; strictly additive (ops 17→18, `iris_jobs_list` unchanged).

### Auto-fixed inline (3 MED handler-correctness findings — all in `ProcessManage`/`ProcessGet`, verified live over HTTP)

1. **Action enum substring-match + `Else`→`resume` fall-through (blind+edge, MED).** The enum guard used a delimiter-wrapped `[`-contains test (`'(",terminate,suspend,resume,"[(","_tAction_",")))`. A comma-injected value like `"suspend,resume"` PASSED that substring test, then — failing the exact `="terminate"` / `="suspend"` equality checks — routed to `tProc.Resume()` via the dispatch `Else` catch-all. Reachable only on a **direct REST** call (the Zod `z.enum` blocks it via the tool), but AC 16.1.4 + Rule #26 require the handler to be correct on a direct REST call (defense-in-depth). **Fix:** replaced the substring guard with exact `'= "terminate" && '= "suspend" && '= "resume"` membership, and made the control dispatch use an explicit `ElseIf tAction = "resume"` (no catch-all `Else`). Verified live: `{"action":"suspend,resume"}` now returns `Invalid action`.
2. **Guard fail-OPEN when `%SYS.ProcessQuery.%OpenId` fails (blind+edge, MED).** The critical-process guard ran only inside `If $IsObject(tQ)`; if the second open returned null (e.g. the process exited between `%ExistsId` and the guard), `tRefused` stayed 0 and control fell through to the unguarded control method. **Fix:** fail CLOSED — a non-object `tQ` now refuses with an explanatory reason and takes no control action.
3. **`pid` not coerced / raw-string vs numeric inconsistency (blind+edge, MED).** `%ExistsId(tPid)`/`%OpenId(tPid)` used the raw JSON string while the self-guard used `+tPid`, so a value like `" 01234"` could make the numeric self-guard and the string-keyed lookups disagree; `pid` was also only presence-validated (`ValidateRequired`), never numeric. **Fix:** added a `$ISVALIDNUM` + positive-integer gate, then `Set tPid = +tPid` once, in BOTH `ProcessGet` and `ProcessManage`, so every downstream use is the canonical numeric id. Verified live: `pid=abc` and `pid=-5` now rejected with `Invalid pid`.

Redeployed `Monitor.cls` + recompiled clean on HSCUSTOM; re-ran `pnpm gen:bootstrap`. **BOOTSTRAP_VERSION moved `3a395abc1eba` → `d4e197ef5ffc`** (this review's handler edits). Frozen baseline re-verified git-clean; `--check` exit 0; ops 186 + shared bootstrap 47 green; ops lint + shared type-check clean.

### Deferred (see `deferred-work.md` — Story 16.1 section)
- **CR 16.1-1 (LOW):** `namespace` param accepted-but-ignored by the handler (documented intentional; AC-compliant) — tighten description or drop the param.
- **CR 16.1-2 (LOW):** TOCTOU across the three live-state opens (now fails closed / benign; inherent to `SYS.Process`).
- **CR 16.1-3 (LOW):** `MemoryUsed` in `get` is a mailbox-message read (latency, not correctness).
- **CR 16.1-4 (LOW, dismissed):** self-guard protects `$JOB` worker, not the external client — correct/intended scope.

### Dismissed
- `resume` has no can-be-* guard — confirmed correct: IRIS exposes no `CanBeResumed` flag and resume has no critical-job hazard.
- TS types control-result fields as `number` while the wire sends JSON booleans — truthiness-tolerant, no runtime bug.
- Dispatch route slash convention (auditor) — false positive: all `/monitor/*` routes consistently use `/`; compiled clean.

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m] (Opus 4.8, 1M context)

### Debug Log References

- Live smoke (curl against deployed `/api/executemcp/v2/monitor/process*` on HSCUSTOM): `get` returned full detail for a real PID (CONTROL daemon 3736, `canBeTerminated:false`); `terminate` and `suspend` of that critical daemon both returned `refused:true` with a reason and the daemon stayed alive (state RUNW) — defense-in-depth guard confirmed over real HTTP (Rule #26). Nonexistent PIDs return a clean `ERROR #5001: Process N does not exist` envelope.

### Completion Notes List

- **BOOTSTRAP_VERSION (AC 16.1.6, Rule #24):** `e5f4f6d88c56` → `3a395abc1eba` (dev) → `d4e197ef5ffc` (final, after the code-review handler fixes — exact-match action validation, fail-closed guard, numeric pid coercion). Each ObjectScript edit regenerated the embedded copy per Rule #24; final on-disk hash is `d4e197ef5ffc`. `bootstrap.test.ts` (on-disk == embedded == version) green. `bootstrap-classes.ts` regenerated via `pnpm gen:bootstrap`, never hand-edited (Rule #18).
- **Governance (AC 16.1.7, Rule #23/#25):** the 4 new `iris_process_manage:{get,terminate,suspend,resume}` keys are post-foundation — ABSENT from the frozen `governance-baseline.ts` (hash `1e62c5ad5bf7`, 141 keys, git diff empty). `node scripts/gen-governance-baseline.mjs --check` exits 0 (live surface grew 166→170; frozen 141 all retained; one-directional). Did NOT run the bare generator. `get` defaults enabled (read); the three control actions default DISABLED (write) — proven through the real gate in `process-governance.test.ts`.
- **Additive (AC 16.1.8):** ops tool count 17 → 18; `iris_jobs_list` and all other ops tools byte-for-byte unchanged (only added a new tool + registration line). `process` is the read sibling's superset for one PID.
- **AC 16.1.4 guard:** enforced in the ObjectScript handler (`ProcessManage`) BEFORE any control method call — refuses `pid=$JOB` for any action, and `terminate`/`suspend` when `CanBeTerminated`/`CanBeSuspended` is false. Verified live (Debug Log). The `get` response also reports `isCurrentProcess` and the can-be-* flags so the TS layer can warn pre-emptively.
- **Design note (namespace param):** process inspection/control is %SYS-scoped in the handler; the optional `namespace` input is accepted and forwarded but has no effect on the system-wide process table (kept per AC 16.1.3, documented in the tool description as "usually omitted").
- **Full monorepo green:** `pnpm build` (6/6), `pnpm test` (12/12 turbo tasks; ops 177 incl. process 14 + process-governance 4; shared 504 incl. bootstrap 41), `pnpm lint` (6/6), `pnpm type-check` (12/12). No commit/push performed — left uncommitted for the lead's smoke gate.

### File List

- src/ExecuteMCPv2/REST/Monitor.cls (modified — added `ProcessGet` + `ProcessManage`)
- src/ExecuteMCPv2/REST/Dispatch.cls (modified — added 2 routes)
- packages/iris-ops-mcp/src/tools/process.ts (new)
- packages/iris-ops-mcp/src/tools/index.ts (modified — import + register)
- packages/iris-ops-mcp/src/__tests__/process.test.ts (new)
- packages/iris-ops-mcp/src/__tests__/process-governance.test.ts (new)
- packages/iris-ops-mcp/src/__tests__/index.test.ts (modified — tool count 17→18)
- packages/shared/src/bootstrap-classes.ts (regenerated — BOOTSTRAP_VERSION 3a395abc1eba)
