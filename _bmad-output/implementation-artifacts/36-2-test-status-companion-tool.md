# Story 36.2: `iris_test_status` Companion — Re-attach, Read-by-Run-Index, Cancel (seam owner)

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As an **agent or developer whose `iris_execute_tests` call came back `status:"running"`** (or whose client abandoned a long call),
I want **a companion tool that re-attaches to that run by its handle — reporting it as still running, completed with its COMPLETE results, unfinished, or abandoned — and, when I explicitly enable it, cancels it**,
so that **I never have to re-submit a run to learn its outcome, never read a half-finished result table as a pass, and can stop a run I no longer want**.

## Context — why this story exists

Epic 36 fixes the first beta-feedback defect (`docs/bugs-2026-09-10.md`): `iris_execute_tests` reported a still-running unit-test job as a terminal failure, so callers re-submitted and created concurrent runs. **Story 36.1 (committed `7f286ea`)** fixed the contract side — a wait-budget expiry now returns `isError:false`, `status:"running"`, the Atelier `jobId`, the `%UnitTest.Result` `runIndex`, and a `hint` naming the re-attach routes. **This story ships the re-attach surface itself**: the epic's ONLY new tool (Constraint E-3), owning exactly the seam Story 36.1 documented (AC 36.1.10; 36.1 story "Seam for Story 36.2").

Architecture decision **L1** (`architecture.md`, "Long-Running Tool Calls Over Asynchronous Server Jobs") is binding: re-attach/read/cancel live on a SEPARATE companion tool — never as new `action`s on `iris_execute_tests` (that would rename its frozen governance key and trip the Rule #23 drift test) — with reads classified `read` and cancel classified `write`, default-disabled.

**Lead decisions in force (2026-09-10):** **L-2** — `iris_test_status` is `developer` include / `core` exclude, NOT paired in `TOOL_PAIRS` (`core` is at its 13-runtime-tool ceiling; 36.1's `hint` already names the manual route that works in `core`). **L-3** — changeset `@iris-mcp/dev` minor.

**AC 36.2.2 and AC 36.2.3 were amended in place at this story's creation (Rule #42)** because Story 36.1's recorded probes contradict two planning-time claims: the drain is DELTA (probe (d) — rows an earlier call already consumed never reappear, so "finished-but-undrained ⇒ the full envelope from the drain" is false), and a cancelled run stays at `$D(^UnitTest.Result(idx))=10` forever (probe (e) — so "`$D=10` ⇒ running" is false). Build on the amended text below; it is byte-identical to `epics.md`.

## Acceptance Criteria

Sourced verbatim from `_bmad-output/planning-artifacts/epics.md`, "### Story 36.2" (AC 36.2.2 / 36.2.3 as amended in place 2026-09-11).

1. **AC 36.2.1** - New tool `iris_test_status` on `@iris-mcp/dev` with `action: "poll" | "cancel"`, inputs `jobId?` (Atelier work id), `runIndex?` (`%UnitTest.Result` index), `namespace?`. Registration is complete in the SAME story: `mutates: "read"` for `poll`, `mutates: "write"` for `cancel` (default-DISABLED — no `defaultEnabled` marker; `annotations.destructiveHint` truthful); explicit disposition in BOTH `core` and `developer` in `presets.ts` per Lead decision L-2 (`developer` include / `core` exclude); `TOOL_PAIRS`: NOT paired (decision recorded in the story); `index.test.ts:23` and `presets.test.ts:56` pins 28→29; `iris-mcp-all` cross-server counts and annotation sweeps (#45) updated; `tool_support.md` row + per-server README entry stating BOTH default states mechanically from `mutates` (#30); the governance key derivation test confirms `iris_test_status:poll` / `iris_test_status:cancel` and that `iris_execute_tests` is untouched (E-1/E-2).
2. **AC 36.2.2** - **`poll` semantics, grounded in Story 36.1's recorded probes (b)–(f):** (i) `jobId` for a still-running job (`Retry-After` present) ⇒ 36.1's `status:"running"` shape built by the SAME shared `testRunEnvelope` (never a parallel builder), with handles — the queue node's `("unittest","id")` is read BEFORE any poll that could be terminal (the terminal poll kills the subtree, probe (b)) — and `partial` labelled for what it is: the drain is DELTA, carrying only rows no earlier poll delivered (probe (d)); (ii) `jobId` for a finished-but-undrained job ⇒ the terminal poll consumes the queue node (one-shot, documented) and the COMPLETED envelope is built from `%UnitTest_Result.*` by exact `InstanceIndex` (`runIndexSource:"result-table"`), NOT from the drained rows alone — an earlier call (normally 36.1's own `running` response) may already have drained some rows, which never reappear (probe (d)); if no run index is obtainable, the drained rows are returned with an explicit incompleteness note; (iii) `jobId` unknown / already consumed (Atelier 404) ⇒ fall back to `runIndex` when supplied, else a clear not-found result saying the job was already consumed or never existed and to pass `runIndex`; (iv) `runIndex` alone ⇒ `completed` via the SQL path when the run FINISHED (`TestInstance.DateTime` non-empty ⇔ `$D(^UnitTest.Result(idx))=11`, probe (f)); an UNFINISHED run ⇒ `status:"unfinished"` — the result table cannot distinguish still-running from cancelled/crashed (probe (e): a cancelled run stays at `$D=10` forever) — with a note to poll by `jobId` for an authoritative answer; interim rows appear only under `partial` and are NEVER reported as passes (mid-run `TestMethod` rows read `Status 1` before the method finishes — the trap the Story 36.1 review found in the manual SQL); (v) `jobId` whose queue node is gone AND whose run is unfinished ⇒ `status:"abandoned"` (no live Atelier job references it — cancelled, crashed, or its worker died); (vi) neither handle ⇒ validation error. `MAX()` is never used anywhere. The SQL-path completed envelope is shape- AND value-identical to 36.1's drain-path completed envelope for the same run (the `Test` prefix `fromAtelierMethodName` restores on the drain path equals the real method name on the SQL path) — pinned by a LIVE equality test. *(Amended in place 2026-09-11 at Story 36.2 creation, Rule #42: the planning text said a finished-but-undrained `jobId` yields "the full completed envelope" from the drain, and that `$D(...)=10` means "running" — contradicted by Story 36.1's recorded probes (d) (delta drain: earlier-drained rows never reappear) and (e) (a cancelled run stays at `$D=10` forever).)*
3. **AC 36.2.3** - **`cancel` semantics** follow probe (e) exactly — the story states what "cancelled" observably means on this instance (worker stopped / `%UnitTest_Result` row absent or partial) and returns that observation, never an assumed success. Governance-disabled by default; the live leg runs under an explicit `IRIS_GOVERNANCE` override and restores it. **Probe-first the HTTP route itself (#16):** Story 36.1's probe (e) cancelled through a direct `%Api.Atelier.v8:CancelAsync` wrapper, never over HTTP — confirm `DELETE /api/atelier/v{n}/{ns}/work/{id}` is routed and behaves identically before building on it. Cancelling a job that already FINISHED but was never drained discards the queue node without returning rows — read the node's run index BEFORE the `DELETE` and report that the results are preserved at that `InstanceIndex`. *(Amended in place 2026-09-11 at Story 36.2 creation, Rule #42/#16.)*
4. **AC 36.2.4** - **Live round-trip capstone (Rule #49 shape) in the DEFAULT suite (#21), armed like `epic35-defect-gate.test.ts`:** submit a disposable slow class via `iris_execute_tests` with `timeout: 5` ⇒ `running` + `jobId` + `runIndex` → `iris_test_status poll` by `jobId` while running ⇒ `running` → wait → `poll` ⇒ `completed`, whose `details` EQUAL the `%UnitTest_Result` SQL for that `InstanceIndex` (oracle from reality, #36) → the queue node is gone → `poll` by `runIndex` alone still returns the identical completed envelope (SQL path) → cancel leg on a second submission. Every leg is proven RED by breaking the thing it guards on the path it guards (Rule #59), with the path named. Second-instance smoke on `ocupilot-iris` (#34).
5. **AC 36.2.5** - **Docs rollup for the epic (#43 enriches, never first-documents):** `iris_execute_tests`'s `hint` and description now name the shipped companion; README/`tool_support.md`/CHANGELOG; the `docs/bugs-2026-09-10.md` record gains a "Resolved in Epic 36" footer; `check-epics-sync.mjs` reports 0 unexpected absences / 0 orphans for epics 1–36.
6. **AC 36.2.6** - Gates as AC 36.1.11, plus: `assertGovernanceClassification` and `assertPresetCoverage` pass at construction (they THROW on omission — a green construction is the proof); `gen:governance-baseline:check` exit 0 at the frozen hash (new keys are governed by `mutates`, never absorbed into the baseline — Rule #23); changeset (`@iris-mcp/dev` minor).

## Integration ACs

This story is the **consumer** of Story 36.1's seam: it MUST emit `running`/`completed` envelopes through 36.1's `testRunEnvelope` (AC 36.2.2 (i), the live equality test in (ii)/(iv), and the capstone in AC 36.2.4, which drives `iris_execute_tests` → `iris_test_status` end-to-end over real HTTP, is the integration proof). The new tool has no downstream consumer in this epic.

## Lead pre-story notes — verified facts to build on (do not re-derive; re-confirm cheaply where marked)

- **Story 36.1's probes (c)–(f)** are recorded verbatim in the 36.1 story, Dev Notes → "Probe results". Summary: (c) `GET /work/{id}` on an hours-stale ABANDONED, FINISHED job re-attaches (`$SYSTEM.WorkMgr.Attach` on the stale token works) and drains the full remaining set in ONE call, then kills the node; (d) a job abandoned mid-run, re-polled after completion, drains only the REMAINING rows — delta accounting survives any gap; (e) `CancelAsync` on a RUNNING job stops the worker — `SaveResult` never fires, `$D(^UnitTest.Result(idx))` stays `10` forever, a concurrent poller then gets HTTP 404 from `GET /work/{id}` (probe (e) used a direct classmethod wrapper — **re-confirm over HTTP `DELETE` before building on it**, AC 36.2.3); (f) `$D(^UnitTest.Result(idx))` is `10` mid-run and `11` after `SaveResult`.
- **Lead smoke of Story 36.1 (2026-09-11, built dist, both instances)** re-confirmed over real HTTP: the queue node's `("unittest","id")` equals the tool's `runIndex` (default run 57, `ocupilot-iris` run 307 with the reporter's own suites running concurrently); `GET /work/{jobId}` on a finished-but-abandoned job returns `retryafter` absent + its rows and leaves `{"value":"","defined":false}` at the node; and a `%UnitTest_Result.TestInstance` row is **visible from run START** with `Duration 0` and empty `DateTime` — "finished" means `DateTime` non-empty (equivalently `Duration > 0` / `$D=11`), never "row exists".
- **Reusable 36.1 building blocks** (`packages/iris-dev-mcp/src/tools/execute.ts`, currently module-private): `testRunEnvelope` (~L584 — the ONE builder for `completed`/`running`/`error`), `buildRunningHint` (~L367), `readGlobalNode` (~L273), `summarizeAtelierResults` (~L677), `fromAtelierMethodName` (~L238), `zeroResultGuardResponse` (~L518), the `TestClock` seam (~L150). **Export them or move them to a module both tools import — never copy them** (a second builder is how shapes drift).
- **The corrected manual re-attach SQL** lives in 36.1's `hint`/README (joins `TestMethod → TestCase → TestSuite → TestInstance` by `InstanceIndex` and returns an empty `FinishedAt` until the run finishes) — reuse that exact join for the SQL path; it was run verbatim live at the 36.1 review.
- **Fixture:** `ExecuteMCPv2.QAFixtures.LongRunningTest` (10 s `Hang`, deliberately outside `ExecuteMCPv2.Tests` and the bootstrap manifest) is deployed on the default HSCUSTOM instance and drives 36.1's live gate — reuse it for the capstone. `ocupilot-iris` does NOT have it: use disposable `ExecuteMCPv2.Temp.*` classes there, delete them after, and never touch OcuPilot's own classes, `%SYS.Task` rows, productions, or the reporter's ~21 queue entries.

## Tasks / Subtasks

- [x] **Task 1 — Probe-first (AC 36.2.2, 36.2.3)**
  - [x] `DELETE /api/atelier/v{n}/HSCUSTOM/work/{id}` over HTTP on a RUNNING job (fixture, default instance): status code, body, queue node after, `$D(^UnitTest.Result(idx))` after 15 s. And on a FINISHED-undrained job: confirm rows are discarded and the result table keeps the finished run. Record verbatim.
  - [x] Mid-run SQL: which `TestMethod`/`TestCase` rows exist while a method is still hanging, and with what `Status`/`Duration` — decide the rule that keeps interim rows out of pass counts.
  - [x] SQL-path vs drain-path equality on ONE finished run (method names, statuses, durations, failure messages, class-level error rows such as an `OnBeforeAllTests` failure): identify every field that could differ and how to normalize it truthfully.
- [x] **Task 2 — Shared building blocks (Integration AC)**
  - [x] Export (or move to a shared module in `packages/iris-dev-mcp/src/tools/`) the 36.1 helpers listed above; `iris_execute_tests` behavior and its tests stay byte-identical (Rule #19 — its suites pass unchanged).
  - [x] Extend `testRunEnvelope`'s `status` discriminator for `unfinished` / `abandoned` / `cancelled` (plus a not-found result) without changing the existing `completed`/`running`/`error` shapes.
- [x] **Task 3 — `iris_test_status` tool (AC 36.2.1, 36.2.2, 36.2.3)**
  - [x] New tool file (e.g. `packages/iris-dev-mcp/src/tools/test-status.ts`) with `action: "poll" | "cancel"`, `jobId?`, `runIndex?`, `namespace?`; `mutates: { poll: "read", cancel: "write" }`; truthful annotations (`destructiveHint: true` — `cancel` stops a running job; mirror `iris_env_promote`'s mixed-action precedent for the other hints and justify each); `scope: "NS"`.
  - [x] `poll`: implement cases (i)–(vi) of AC 36.2.2 exactly; queue-node read strictly BEFORE any potentially-terminal `GET /work`; complete results only from the SQL path by exact `InstanceIndex`; never `MAX()`.
  - [x] `cancel`: read the node's run index first, `DELETE /work/{id}`, then OBSERVE (`$D`/`TestInstance` state) and return what actually happened; finished-undrained ⇒ "results preserved at `InstanceIndex` N".
  - [x] Update 36.1's `buildRunningHint` from "forthcoming" to the shipped tool name (keep the `core`-available manual route in the hint — L-2 keeps `iris_test_status` out of `core`).
- [x] **Task 4 — Registration + counts (AC 36.2.1, 36.2.6)**
  - [x] Add to `packages/iris-dev-mcp/src/tools/index.ts`'s tool array; `presets.ts` — `developer.include` + `core.exclude` (and the header comment's "28-tool" count); record the `TOOL_PAIRS` NOT-paired decision (and why) in Dev Notes.
  - [x] Count pins 28→29: `index.test.ts:23`, `presets.test.ts:56`; then ENUMERATE every other count surface mechanically (grep `\b28\b`/`\b109\b`/`\b104\b` over READMEs, `tool_support.md`, `docs/`, `packages/iris-mcp-all/`) — known so far: `README.md:15/602/603/705`, `tool_support.md:25/382`, `packages/iris-mcp-all/README.md:25`, `packages/iris-dev-mcp/README.md:1337`, the `docs-visibility-roster-sync.test.ts` README-row parser. Derive each new figure (dev 29; suite full 110 / package-sum 105; developer-preset row) — never hand-author (#51).
  - [x] Governance: key-derivation test for `iris_test_status:poll`/`:cancel`; `cancel` default-disabled, `poll` enabled (verify via the governance seed, not by assertion alone); `iris_execute_tests` key untouched; `gen:governance-baseline:check` exit 0 (`:check` ONLY — never the bare generator).
- [x] **Task 5 — Tests (AC 36.2.2, 36.2.3, 36.2.4)**
  - [x] Unit: every AC 36.2.2 case (i)–(vi) + cancel outcomes with fakes that are REAL shapes (#54 — pin them to live captures from Task 1, including the Atelier 404 envelope and the `/global` `{value, defined}` shape).
  - [x] Live capstone in the DEFAULT suite, armed + skip-when-unavailable like `execute-tests-running-contract-epic-gate.test.ts` / `epic35-defect-gate.test.ts` (`IRIS_REQUIRE_LIVE` opt-in hard-fail): the AC 36.2.4 round trip, the SQL-vs-drain equality, and the cancel leg (governance override set in-test and restored). Each leg proven RED on its guarded path with the path named (Rule #59). Leave no queue node and no running job behind.
- [x] **Task 6 — Docs rollup + ledger + gates (AC 36.2.5, 36.2.6)**
  - [x] Tool description; dev README (tool table + detail block + the "all N tools accept namespace" line); `tool_support.md` row with BOTH default states (#30); root README counts; `packages/iris-mcp-all/README.md`; CHANGELOG; `iris_execute_tests` description + `hint` + the `deployAndTestClass.ts` prompt step now name the shipped companion (then `pnpm gen:skills`; `prompt-safety-invariants.test.ts` pins); the governance docs state how to enable `iris_test_status:cancel` (`IRIS_GOVERNANCE`). `docs/bugs-2026-09-10.md` gains a "Resolved in Epic 36" footer. Run every documented example.
  - [x] Ledger (APPEND-ONLY at EOF): `36-1-CR-3` (the manual route leaves each running job's queue node until something drains it — handed to this story by the 36.1 seam) → **RESOLVED** by `poll`-by-`jobId` with live evidence; Rule #51 recount with a `Check:` line. Any new row whose first cell is a bare ID of a TERMINAL item carries its bold terminal token.
  - [x] Gates: per-package standalone suites (`35-1-DEV-1` substitution recorded); tsc + eslint; `assertGovernanceClassification`/`assertPresetCoverage` green at construction; `gen:governance-baseline:check` exit 0; `gen:skills:check` no drift; `bootstrap-classes.ts` absent from the diff, `BOOTSTRAP_VERSION` `e1168c1ebe56`; `check-epics-sync.mjs` clean; changeset (`@iris-mcp/dev` minor).

## Dev Notes

### Envelope states this story adds (target shapes — refine names in review, keep the discriminator)

```jsonc
// poll by runIndex, run not finished (cannot tell running from cancelled/crashed)
{ "status": "unfinished", "runIndex": 61, "runIndexSource": "result-table",
  "partial": { /* interim rows only — never counted as passes */ },
  "note": "The result table shows this run has not finished. It may still be running, or it was cancelled/crashed. Poll by jobId for an authoritative answer." }
// poll by jobId: queue node gone AND run unfinished
{ "status": "abandoned", "jobId": "…", "runIndex": 61, "note": "No live Atelier job references this run (cancelled, crashed, or its worker died); its result row will never finalize." }
// cancel on a running job — the OBSERVATION, not an assumption
{ "status": "cancelled", "jobId": "…", "runIndex": 61, "observed": { "queueNode": "gone", "resultRow": "unfinished (never finalized)" } }
// cancel on a finished-but-undrained job
{ "status": "completed", "jobId": "…", "runIndex": 61, "note": "The job had already finished; cancelling discarded only its queue entry. Results are preserved — poll by runIndex 61." }
```

### Probe results (Task 1, recorded verbatim, 2026-09-11 — default HSCUSTOM instance, `_SYSTEM`, real HTTP via `curl`)

Disposable fixtures used and deleted+verified-absent afterward: `ExecuteMCPv2.Temp.Story362Probe` (`TestPass`/`TestFail`, 2 methods), `ExecuteMCPv2.Temp.Story362BadSetup` (`OnBeforeAllTests` failure). Permanent fixture `ExecuteMCPv2.QAFixtures.LongRunningTest` (10s `Hang`) reused for the timing-sensitive legs. Instance queue (`^IRIS.TempAtelierAsyncQueue`) confirmed empty before and after every probe.

- **HTTP `DELETE /work/{id}` on a genuinely RUNNING job** (job queued, `DELETE` issued ~1.1s later, well inside the 10s `Hang`): HTTP 200, empty body (`{}`); queue node (`("unittest","id")`) and root subtree both gone after; `$D(^UnitTest.Result(idx))` = `10` immediately AND still `10` twelve seconds later (well past when the run would have naturally finished) — the worker was genuinely stopped, `SaveResult` never ran. A subsequent `GET /work/{id}` on the same id returns HTTP 404. Reproduces 36.1's probe (e) — which used a direct classmethod wrapper — over the ACTUAL HTTP `DELETE` route, as AC 36.2.3 required.
- **HTTP `DELETE /work/{id}` on a FINISHED-but-undrained job** (DELETE issued ~13s after queueing — after the 10s `Hang` had already completed — with no intervening `GET`): HTTP 200, empty body (rows NOT returned by the DELETE); queue node gone after; `$D(^UnitTest.Result(idx))` = `11` (finished); a live SQL query against `%UnitTest_Result.TestMethod`/`TestInstance` for that exact `InstanceIndex` returns the FULL, intact result (method name, `Status 1`, `Duration` ≈10s). Confirms AC 36.2.3's claim exactly: cancelling a finished-but-undrained job discards only the queue entry; results are preserved and readable at that `InstanceIndex`.
- **Mid-run SQL** (re-confirms 36.1's own finding independently): while a `Hang`-based method is still executing, `%UnitTest_Result.TestInstance` already has a row (`DateTime ""`, `Duration 0`) and `%UnitTest_Result.TestMethod` already has a row reading `Status 1` (looks like "passed") with `Duration 0` — a row existing, and even reading `Status 1`, is NOT proof of "passed" or "finished". "Finished" is `TestInstance.DateTime` non-empty, full stop.
- **SQL-path vs. drain-path field-by-field equality** (2-method disposable fixture, one pass one fail): (1) **method name** — SQL's `TestMethod.Name` is ALREADY `Test`-prefixed (`"TestFail"`/`"TestPass"`); do NOT re-apply `fromAtelierMethodName` to a SQL-sourced name. (2) **status** — SQL `Status` (0/1) maps through the identical `{0:"failed",1:"passed",2:"skipped"}` table as the drain. (3) **duration — THE central finding**: SQL `TestMethod.Duration` is in SECONDS (the property's own class doc says so, confirmed independently by a `TestAssert` `LogMessage` row reading "Duration of execution: .000094 sec." matching the column exactly), while the Atelier drain's `duration` field (what `iris_execute_tests` already returns in `details[]`) is in MILLISECONDS — proven with an exact ×1000 on BOTH the sub-millisecond disposable fixture (drain `0.094`/`0.054` vs. SQL `0.000094`/`0.000054`) AND a real 10-second `Hang` (drain `10009.384` vs. SQL `10.009384`). **The SQL-path builder must multiply by 1000** to be value-identical to the drain path — this is the one normalization Task 1 exists to catch, and it is pinned by both a unit test and the live capstone's independent-oracle equality check. (4) **message** — the drain's failure message (`"AssertTrue: deliberate failure message for probe"`) is exactly `${TestAssert.Action}: ${TestAssert.Description}` for FAILED (`Status=0`) `TestAssert` rows ONLY, joined `"; "` — a passing method's own `LogMessage` housekeeping row (`Status=1`) must never leak into `message` (verified: the passing method's drain `message` is `""`, matching zero eligible `TestAssert` rows). (5) **class-level `OnBeforeAllTests` failures** (probed via the second disposable fixture) — the drain's class-level `error` (`"OnBeforeAllTests: ERROR #5001: deliberate setup failure for probe"`) is exactly `${TestCase.ErrorAction}:${TestCase.ErrorDescription}` (`TestCase.ErrorDescription` already carries its own leading space) — out of this story's core `poll`/`cancel` scope since `details` never carries class-level rows either way (`summarizeAtelierResults` only pushes `r.method !== undefined` rows), but confirms the mapping is sound if ever needed.
- **`abandoned` signature, reconfirmed live**: cancelling a mid-run job (via the real `DELETE` route) leaves the queue node gone, a subsequent `GET /work/{jobId}` returning HTTP 404, and `%UnitTest_Result.TestInstance` permanently unfinished — exactly the "queue node gone AND run unfinished" signature `poll` reports as `abandoned` when a DIFFERENT caller (one who did not itself request the cancellation) later asks about that `jobId`.

### Traps

- **Do not add actions to `iris_execute_tests`** (E-1 / L1 / Rule #23). The companion is a separate tool.
- **The drain is DELTA** (probe (d)). A completed envelope assembled from drained rows alone is silently incomplete whenever 36.1 already returned `running` with a partial drain — which is the NORMAL path into this tool. Completed results come from the SQL path by exact `InstanceIndex`.
- **The terminal poll kills the queue node** (probe (b)). Read `("unittest","id")` BEFORE any `GET /work` that could be terminal, or you lose the index for good.
- **A row existing ≠ finished; `Status 1` mid-run ≠ passed.** "Finished" is `TestInstance.DateTime` non-empty (`$D=11`).
- **A cancelled run looks unfinished forever** (probe (e)). Never report `running` from the result table alone.
- **`cancel` is a write**: `mutates` per action, default-disabled, no `defaultEnabled` marker (Rule #32 is for recovery tooling only), `destructiveHint` truthful.
- **Counts are derived, never hand-authored** (#51); enumeration of count/doc surfaces is a review question (#56) — grep, don't remember.
- **Rule #55** — file-writing tools only, never heredocs. **Epic 35 §3.1** — region-scoped edits; `git diff -U0` shows only intended hunks. **Epic 35 §3.3** — forced clean rebuild (delete `tsconfig.tsbuildinfo`) before any dist-level claim.
- **`ocupilot-iris` is the Project Lead's OcuPilot instance** — disposable `ExecuteMCPv2.Temp.*` only, deleted after; leave the reporter's queue entries alone.
- **Known adjacent, NOT in scope:** `36-1-CR-1` (`iris_execute_tests` still declares `idempotentHint: true`), `36-1-CR-2` (the wait budget bounds only when polling starts). Leave both deferred.

### Governance and visibility (Rules #28 / #30 / #31 / #53)

- Keys: `iris_test_status:poll` (read ⇒ default-enabled) and `iris_test_status:cancel` (write ⇒ default-DISABLED). New keys are governed by `mutates`, never added to the frozen baseline (`1e62c5ad5bf7`/141/201/60 stays byte-identical).
- Presets (L-2): `core.exclude`, `developer.include`. `TOOL_PAIRS`: NOT paired — a pair would force `iris_test_status` into `core` alongside `iris_execute_tests` (14 runtime tools, over the ceiling), and the `core` user already has the manual re-attach route in 36.1's `hint`. Record this in the story.
- A new tool in a package array moves the package-array length pins and the suite/advertised counts (+1 on the dev server only); `iris_server_profiles` is a framework tool and does not move (#31).

### Testing standards

- Vitest; follow `execute.test.ts` conventions (mocked `ctx.http`, REAL shapes). Standalone baselines at 36.1 close: dev 745 · shared 1334 · all 129. `execute-tests-running-contract-epic-gate.test.ts` is the arming/skip pattern to copy.
- Rule #59: every guard proven RED on the path it actually guards (unit AND the live capstone over real HTTP). Rule #48 mutation evidence recorded with counts.
- OS suite untouched (412 `Test*`); `ExecuteMCPv2.QAFixtures` is outside `ExecuteMCPv2.Tests` by design.

### Doc surfaces — enumerate exhaustively (#56)

| File | What changes |
|---|---|
| `packages/iris-dev-mcp/src/tools/test-status.ts` (new) | tool + action descriptions, default states, the delta/one-shot/unfinished/abandoned semantics |
| `packages/iris-dev-mcp/src/tools/execute.ts` | helper exports; `buildRunningHint` names the shipped tool; description names it |
| `packages/iris-dev-mcp/src/tools/index.ts`, `presets.ts` | registration; L-2 dispositions; header count |
| `packages/iris-dev-mcp/README.md` | tool table row; detail block; "all N tools accept `namespace`" (L1337); `iris_execute_tests` re-attach paragraph |
| `README.md` | package table (L15), preset rows (L602/L603), diagram (L705) |
| `tool_support.md` | `@iris-mcp/dev` heading count (L25), new row with both default states, suite rollup (L382) |
| `packages/iris-mcp-all/README.md` | package table (L25) |
| `packages/iris-mcp-all/src/__tests__/` | roster-sync / annotation-sweep expectations (#45) |
| `CHANGELOG.md`, `.changeset/*.md` | `@iris-mcp/dev` minor |
| `packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts` + `skills/deploy-and-test-class/SKILL.md` | re-attach step names the tool (regen via `pnpm gen:skills`) |
| governance docs (wherever `IRIS_GOVERNANCE` keys are listed) | how to enable `iris_test_status:cancel` |
| `docs/bugs-2026-09-10.md` | "Resolved in Epic 36" footer |
| `_bmad-output/implementation-artifacts/deferred-work.md` | `36-1-CR-3` → RESOLVED; recount |

### Project Structure Notes

- Pure TypeScript in `packages/iris-dev-mcp/` (+ tests, docs). Transport: Atelier `GET`/`DELETE /work/{id}` via `IrisHttpClient` (`delete<T>()` exists, `http-client.ts:98`), the ExecuteMCPv2 `/global` GET route for the queue node, and Atelier `action/query` for SQL — no new ObjectScript, so no `gen:bootstrap`, and `BOOTSTRAP_VERSION` stays `e1168c1ebe56`.

### Previous story intelligence — Stories 36.0 / 36.1

- **36.1 review lessons:** the manual SQL mid-run trap (rows read as passed before finishing); named server profiles must inherit any config the tool reads (`36-1-CR-B` — if this tool reads `ctx.config`, check `profiles.ts`); a transport error mid-poll must never lose the `jobId` (return it with the hint); one envelope builder, never two.
- **36.1 QA lesson:** a claimed trade-off ("rare edge case") was the common case once measured live — measure, don't estimate.
- **36.0 lead smoke:** a ledger row starting with a bare terminal ID and no bold token re-opens that item to a last-row parser — carry the token.
- **Rule #57:** reviews run `layers_mode=sequential_sync`, each layer with its own armed 20-minute timer (36.0 r2, 36.1 closed CLEAN that way).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 36.2] — ACs (36.2.2/36.2.3 amended in place 2026-09-11)
- [Source: _bmad-output/planning-artifacts/architecture.md#Long-Running Tool Calls Over Asynchronous Server Jobs] — decision L1
- [Source: _bmad-output/implementation-artifacts/36-1-execute-tests-running-contract-and-handles.md] — Dev Notes "Probe results" (c)–(f), "Seam for Story 36.2", Review Findings
- [Source: packages/iris-dev-mcp/src/tools/execute.ts] — `testRunEnvelope`, `buildRunningHint`, `readGlobalNode`, `summarizeAtelierResults`, `fromAtelierMethodName`, `TestClock`
- [Source: packages/iris-dev-mcp/src/tools/env-promote.ts] — mixed read/write `mutates` map precedent
- [Source: packages/shared/src/tool-types.ts:85-128] — `mutates` / `defaultEnabled` contract
- [Source: packages/iris-dev-mcp/src/__tests__/execute-tests-running-contract-epic-gate.test.ts] — live-gate arming pattern
- [Source: %Api.Atelier.v8.cls (IRISLIB)] — `PollAsync` :310, `CancelAsync` :444, `ExecuteAsyncRequest` :490 (run-index prediction :730), `UnitTestResultToJSON` :794
- [Source: .claude/rules/project-rules.md] — #16, #19, #21, #23, #28, #30, #31, #32, #36, #42, #45, #48, #51, #53, #54, #55, #56, #59

## Dev Agent Record

### Agent Model Used

claude-sonnet-5

### Debug Log References

- Task 1 live probes (HTTP `DELETE`/GET on running + finished-undrained jobs, mid-run SQL, SQL-vs-drain field equality) run directly against the default HSCUSTOM instance via `curl` + `iris_global_get`/`iris_sql_execute`/`iris_execute_command`; verbatim results recorded in Dev Notes → "Probe results (Task 1)". Disposable probe classes (`ExecuteMCPv2.Temp.Story362Probe`, `ExecuteMCPv2.Temp.Story362BadSetup`) deleted and absence verified (`iris_doc_delete` + `iris_doc_get metadataOnly`) before this story closed; queue (`^IRIS.TempAtelierAsyncQueue`) confirmed empty before/after.
- Live capstone (`test-status-epic-gate.test.ts`) run repeatedly against the default HSCUSTOM instance (forced clean rebuild each time per Epic 35 §3.3: `rm packages/{shared,iris-dev-mcp}/tsconfig.tsbuildinfo`). Mutation evidence recorded live: (1) removing the SQL-path's seconds→milliseconds `* 1000` normalization drove the capstone's SQL-oracle-equality assertion RED (`expected 10.006008 to be close to 10006.008`); restored byte-identical (`diff` confirmed), capstone green again. (2) Reordering `handleCancel` to read the queue node AFTER the `DELETE` (instead of before) drove 2 unit pins RED (`cancelling a RUNNING job` ordering assertion; `cancelling an already-gone job (DELETE 404)` fallback); restored byte-identical, 17/17 green. (3) Disabling the interim-row "provisional" guard in `buildInterimPartialFromSql` drove the `(iv) runIndex alone, UNFINISHED` pin RED (`partial.passed` 1 instead of 0); restored byte-identical, green.
- Second-instance smoke (Rule #34) run against `ocupilot-iris` (localhost:52774, HSCUSTOM) via a disposable Node script (`scratchpad/smoke-36-2-ocupilot.mjs`, deleted after) driving the BUILT dist directly (`createExecuteTestsHandler`, `testStatusTool.handler`) against a disposable fixture (`ExecuteMCPv2.Temp.Story362OcuSmoke`, deleted + verified absent after). All 5 legs (running → poll-while-running → poll-completed → poll-by-runIndex-alone → cancel-on-a-second-submission) passed; the instance's 21 pre-existing queue orphans (the reporter's own concurrent suites) were confirmed untouched before and after (count unchanged).
- `pnpm measure:tools-payload` re-run (mechanical, Rule #51) to derive the root README's payload table; `pnpm gen:governance-baseline:check` (`:check` only) confirmed 141 frozen / 203 live / 62 post-foundation, exit 0; `pnpm gen:skills` re-run after the `deployAndTestClass.ts` edit, then `pnpm gen:skills:check` confirmed no further drift; `node scripts/check-epics-sync.mjs` confirmed 0 genuine drift / 0 orphans across epics 1-36.

### Completion Notes List

- **Task 1 (probes) drove the design**, not the reverse: the SQL-vs-drain equality probe found that `%UnitTest_Result.TestMethod.Duration` is in SECONDS while the Atelier drain's `duration` field is in MILLISECONDS (exact ×1000, live-verified on both a sub-millisecond fixture and a real 10-second `Hang`) — without this normalization the SQL-path `completed` envelope would have been shape-identical but VALUE-wrong versus the drain path, silently failing AC 36.2.2's value-identity requirement. This is the single most load-bearing finding of the story.
- **Shared helpers reused, never copied** (Rule #52): `testRunEnvelope`, `buildRunningHint`, `readGlobalNode`, `summarizeAtelierResults`, `fromAtelierMethodName` exported from `execute.ts` (previously module-private) and imported directly by `test-status.ts` (same package, no new shared module needed). `iris_execute_tests`'s own behavior, output shapes, and full pre-existing test suite (`execute.test.ts`, 93 tests) pass BYTE-IDENTICAL and UNCHANGED.
- **`TestRunEnvelope`'s `running`/`completed` kinds extended additively**: `running`'s `elapsedMs`/`timeoutMs`/`target`/`level`/`namespace` made OPTIONAL (a one-shot re-attach poll has no wait-budget context to report and never fabricates one — Rule #54); `completed`'s `handles.jobId` made optional (a `runIndex`-alone resolution has no jobId) and gained an optional `note`. Three brand-new discriminator kinds added: `unfinished` (poll by `runIndex` alone, unfinished), `abandoned` (poll by `jobId`, queue gone + unfinished — the OBSERVER's perspective), `cancelled` (the ACTOR's own observation after a `cancel` call). `RunHandles.runIndexSource` widened to include `"result-table"`.
- **Interim (mid-run) rows are never counted as passes at the ROW level, not merely by nesting under `partial`**: `buildInterimPartialFromSql` treats any `TestMethod` row with `Duration === 0` as provisional (a live-verified signal that the row predates the method actually finishing), labels its `status` `"in-progress"` instead of trusting the raw `Status` value, and excludes it from `total`/`passed`/`failed`/`skipped` entirely (so those counts stay internally consistent: `total === passed+failed+skipped`) — a stricter reading of AC 36.2.2 (iv)'s "never reported as passes" than nesting alone would give.
- **`cancel`'s annotations decision** (mirroring `iris_env_promote`'s mixed-action precedent, per Task 3): unlike `iris_env_promote` (whose `execute` never deletes anything and so stays `destructiveHint:false`), `iris_test_status`'s `cancel` genuinely and irreversibly stops a run and prevents its result from ever finalizing, so `destructiveHint:true` is truthfully set at the tool level; `readOnlyHint:false` (mixed poll/cancel) and `idempotentHint:false` (repeated `cancel` calls do not repeat the same effect; `poll`'s own result changes over time for the same input by design).
- **`TOOL_PAIRS` NOT-paired decision** (Task 4, Lead decision L-2) was already recorded by the lead in this story's pre-existing Dev Notes ("Governance and visibility" section) at story-creation time; confirmed unchanged and correct during implementation — no edit needed there.
- **Live capstone (AC 36.2.4) drives the cancel leg through the REAL `McpServerBase` governance gate**, not a direct handler call — constructing an actual server with `IRIS_GOVERNANCE` set only in-process (never persisted): denied by default (verified the job was still running, untouched), then enabled via an explicit override and observed to actually stop the run (`%UnitTest_Result` never finalizing). This is a stronger proof than calling the handler directly (which would bypass governance entirely) and directly serves Rule #59.
- **Doc-count derivation surfaced surfaces beyond the story's own known list** (Rule #56): running `pnpm measure:tools-payload` also shifted the byte counts (not tool counts) for `@iris-mcp/admin`/`interop`/`ops`/`data` for reasons unrelated to this story (their source is untouched in this diff) — recorded as the current mechanical truth rather than left stale, and flagged as a residual, out-of-scope observation. The cross-package doc-sync test suite (`@iris-mcp/all`) additionally caught two count surfaces the story's own known-list had missed: `docs/migration-v1-v2.md`'s "104 tools" mentions, and `packages/shared/src/__tests__/pre-feature-tool-snapshot.ts` / `tool-visibility-backcompat.test.ts`'s hard-coded dev-package roster/count (both updated).
- **No config.ts / bootstrap change**: this story is pure TypeScript in `packages/iris-dev-mcp/`; no new environment variable, no ObjectScript handler change. `bootstrap-classes.ts` absent from the diff; `BOOTSTRAP_VERSION` unchanged (`e1168c1ebe56`).

### File List

- `packages/iris-dev-mcp/src/tools/test-status.ts` (new)
- `packages/iris-dev-mcp/src/tools/execute.ts` (modified — exported shared helpers, widened `RunHandles`/`TestRunEnvelope`, updated `buildRunningHint` + tool description)
- `packages/iris-dev-mcp/src/tools/index.ts` (modified — registered `testStatusTool`)
- `packages/iris-dev-mcp/src/tools/presets.ts` (modified — `developer.include`/`core.exclude` + header count)
- `packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts` (modified — step 5 names `iris_test_status`)
- `skills/deploy-and-test-class/SKILL.md` (generated — `pnpm gen:skills` regen from the prompt edit above)
- `packages/iris-dev-mcp/src/__tests__/test-status.test.ts` (new)
- `packages/iris-dev-mcp/src/__tests__/test-status-governance.test.ts` (new)
- `packages/iris-dev-mcp/src/__tests__/test-status-epic-gate.test.ts` (new)
- `packages/iris-dev-mcp/src/__tests__/index.test.ts` (modified — count pins 28→29, tool-name lists)
- `packages/iris-dev-mcp/src/__tests__/presets.test.ts` (modified — roster-size pins)
- `packages/shared/src/__tests__/pre-feature-tool-snapshot.ts` (modified — added `iris_test_status` to the dev roster)
- `packages/shared/src/__tests__/tool-visibility-backcompat.test.ts` (modified — dev snapshot length pin 28→29)
- `packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts` (modified — "104 tools" → "105 tools" pins, both root README and migration guide)
- `packages/iris-dev-mcp/README.md` (modified — tool table row, detail block, governance note, namespace-count line)
- `README.md` (modified — package table, preset roster table, measured payload table, prose tool counts)
- `packages/iris-mcp-all/README.md` (modified — package table, cross-server summary table)
- `tool_support.md` (modified — new row, per-server header count, API-count summary table, prose counts)
- `CHANGELOG.md` (modified — new Story 36.2 entry; Epic 30 roster-summary line counts updated)
- `docs/bugs-2026-09-10.md` (modified — "Resolved in Epic 36" footer)
- `docs/migration-v1-v2.md` (modified — tool count, found via the doc-sync test)
- `.changeset/test-status-companion-tool.md` (new — `@iris-mcp/dev` minor)
- `_bmad-output/implementation-artifacts/deferred-work.md` (modified — `36-1-CR-3` → RESOLVED, Rule #51 recount, append-only at EOF)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (modified — `36-2` status → `review`, `last_updated` entry)
- `_bmad-output/implementation-artifacts/36-2-test-status-companion-tool.md` (this file — Tasks checked, Dev Notes probe results, Dev Agent Record, Change Log, Status)
- Added/changed at the code review (see Code Review below): `src/ExecuteMCPv2/QAFixtures/DeltaDrainTest.cls` (new permanent QA fixture, outside the bootstrap manifest), `packages/iris-mcp-all/src/__tests__/test-status-governance-keys.test.ts` (new), `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` (both Epic 36 live gates armed), `docs/epic-summary.md` (stale count); plus review patches to `test-status.ts`, `execute.ts`, `deployAndTestClass.ts` (+ regenerated `SKILL.md`), the three new test files, `README.md`, `packages/iris-dev-mcp/README.md`, `tool_support.md`, `CHANGELOG.md`, the changeset, and `deferred-work.md` (append-only)

## QA Results

**Date:** 2026-09-11 · **Agent:** `bmad-qa-generate-e2e-tests` (claude-sonnet-5) · **Verdict: PASS** — every QA-focus property (delta-drain completeness, Duration units, the interim-row guard's scope, all six `poll` states, both `cancel` legs over real HTTP, governance defaults) reproduced LIVE against the default HSCUSTOM instance over the BUILT dist after a forced clean rebuild (`rm packages/{shared,iris-dev-mcp}/tsconfig.tsbuildinfo`; `turbo run build --force`). One LOW documentation-count finding (`36-2-QA-1`) was found and fixed directly in this pass (trivial, unambiguous, non-product-code). No product-code defect found; no rework requested.

### 1. Delta-drain completeness — the reason AC 36.2.2 was amended (Rule #42) — VERIFIED LIVE

Built a disposable fixture, `ExecuteMCPv2.Temp.Story362QADeltaDrain` (`Test001FastPass`, `Test002FastPass`, `Test003FastFail` — deliberate fail — plus `Test999SlowHang` (`Hang 8`), named so the fast methods sort/run first), deployed via `iris_doc_put`/`iris_doc_compile`, distinct from the dev's own single-method epic-gate fixture — this is the scenario AC 36.2.2 exists for: fast methods finish and get drained into `iris_execute_tests`'s own `partial` BEFORE the slow method finishes.

Live round trip (disposable Node script over the built dist, mirroring `test-status-epic-gate.test.ts`'s own pattern): `iris_execute_tests({target, level:"class", timeout:2})` returned `status:"running"` (jobId `83222935`, `runIndex 87`, `runIndexSource:"queue"`) with `partial` already containing all 3 fast methods (2 passed, 1 failed) — confirming `iris_execute_tests`'s own poll loop had already drained them before the 2 s wait budget expired. An IMMEDIATE `iris_test_status:poll` by the same `jobId` returned `status:"running"` again with an EMPTY `partial` (`total:0`) — proving the DELTA property: the already-drained fast-method rows were correctly NOT re-returned. After the 8 s `Hang` finished server-side, polling again returned `status:"completed"`, `runIndexSource:"result-table"`, with **all 4 methods present** (`Test001FastPass:passed`, `Test002FastPass:passed`, `Test003FastFail:failed`, `Test999SlowHang:passed`) — the completeness property holds: nothing that was drained earlier by a DIFFERENT caller (`iris_execute_tests`'s own poll loop) was lost from the final SQL-sourced envelope. A follow-up `poll` by `runIndex` alone (87, no `jobId`) returned an identical `details` array (byte-for-byte `JSON.stringify` equality). Cleanup: class deleted and absence verified (`iris_doc_get metadataOnly` → `exists:false`); both jobs' queue nodes confirmed drained (`iris_global_get` → `defined:false`).

**No completeness defect found — this is not a HIGH.** Permanent-test disposition (the QA brief's own either/or): a unit test with fakes pinned to the live capture ALREADY EXISTS and was not duplicated — `test-status.test.ts`'s `"(ii) jobId finished-but-undrained ⇒ completed built from %UnitTest_Result by EXACT InstanceIndex … NOT from the drained rows alone"` (this file, ~L174) stubs the Atelier drain to return exactly ONE stale row while the SQL fixture carries 2 real rows, and asserts the completed envelope has `total:2` and `details` is NOT the stale 1-row drain — i.e. it already pins "drain under-reports vs. SQL truth ⇒ SQL wins" with fakes pinned to this story's own Task 1 live captures (`METHOD_ROWS_FIXTURE`/`ASSERT_ROWS_FIXTURE`, sourced from probe run 62). The default-suite live capstone (`test-status-epic-gate.test.ts`) independently exercises the identical `buildCompletedSummaryFromSql` code path against real IRIS on every default-suite run (single-method case). This session's own live multi-method (3 fast + 1 slow) round trip is a STRICTLY HARDER live instance of the same property than the capstone's single-method case and it passed — recorded here as additional live evidence (Rule #54/#59) rather than as a third permanent test, since a third permanent test (a second multi-method disposable/permanent ObjectScript fixture wired into the default suite) would add ~8 s of live wall-clock per run for no incremental regression-detection value beyond what the existing unit pin + live capstone already cover for this exact code path.

### 2. Duration units — SQL seconds vs. drain milliseconds — VERIFIED LIVE, exact ×1000

Independent SQL oracle query (`iris_sql_execute`, the exact join `test-status.ts` uses, run directly by this QA session — not reusing the tool's own query) against `InstanceIndex 87`: `Test001FastPass 0.00006`, `Test002FastPass 0.000053`, `Test003FastFail 0.000086`, `Test999SlowHang 8.007687` (all SQL seconds). The `iris_test_status:poll` completed envelope for the SAME run reported `0.06`, `0.053`, `0.086`, `8007.687000000001` ms respectively — each **exactly** SQL-seconds × 1000 (floating-point noise only on the last digit of the slow method). The drain-path `partial` from `iris_execute_tests`'s own `running` response for the 3 fast methods (`0.06`, `0.053`, `0.086` ms) agrees with the SQL-path `completed` values field-for-field — confirming drain-path and SQL-path durations are the same unit and value for the same run. `iris_execute_tests`'s own completed-envelope shape/units were not touched by this story (confirmed: its full 93-test pre-existing suite passes unmodified, part of the dev package's 768/768 green run) — Rule #19 holds.

### 3. Interim guard scope (`Duration===0` ⇒ `"in-progress"`) — confirmed scoped to UNFINISHED runs only

Code reading confirms `buildCompletedSummaryFromSql` (the `completed`-path builder) has NO duration-based branching at all — every row's real `Status` is reported and counted unconditionally; the `duration===0` "provisional" guard exists ONLY in `buildInterimPartialFromSql` (the `unfinished`-path builder, used solely for poll-by-`runIndex`-alone on a run that has not finished). Live confirmation: in the delta-drain fixture above, `Test001FastPass` had a genuinely near-instant SQL `Duration` of `0.00006` s (60 μs) in a FINISHED run, and was correctly reported `status:"passed"` and counted in `total`/`passed` — never relabelled `"in-progress"` or dropped. (A query for any historical `%UnitTest_Result.TestMethod` row with `Duration = 0` on a FINISHED `TestInstance` returned zero rows on this instance — literal-zero durations do not appear to occur in practice on finished runs here; the near-instant case above is the practical edge and it is handled correctly.)

### 4. All six `poll` states — exercised live

Using the disposable script plus the permanent `ExecuteMCPv2.QAFixtures.LongRunningTest` fixture: **(vi) validation error** — `poll` with neither handle ⇒ `isError:true`, "requires at least one of…", zero HTTP calls issued before the error. **(iv) unfinished** — `poll` by `runIndex` alone while a run was genuinely still executing ⇒ `status:"unfinished"`, `runIndexSource:"result-table"`, `partial` carrying the interim row labelled `"in-progress"` and excluded from `total`/`passed` (both 0). **(v) abandoned** — after cancelling that same run (see §5), a DIFFERENT `poll` call on the SAME now-stale `jobId` (with the `runIndex` supplied as fallback) returned `status:"abandoned"` — never `"running"`, never a crash. **Re-confirmed 16 s later**: polling by `runIndex` alone still reported `"unfinished"` — the cancelled run never finalizes, exactly as AC 36.2.2/36.2.3 require. **(iii) not-found** — polling the SAME already-consumed `jobId` again with NO `runIndex` supplied returned a clear `isError:true` result naming the `jobId` and explicitly recommending `runIndex`. Confirmed: no code path in `test-status.ts` ever reports `"running"` from `%UnitTest_Result` alone (grepped `kind: "running"` call sites — both are inside `handlePoll`'s `jobId` branch, gated on the Atelier `Retry-After` header, never on a SQL/result-table read).

### 5. `cancel` over real HTTP — both legs verified live

**Running job:** cancelled a genuinely-executing `ExecuteMCPv2.QAFixtures.LongRunningTest` run (real `DELETE /work/{jobId}`, issued ~45 ms after the run-index was captured) ⇒ `status:"cancelled"`, `observed:{queueNode:"gone", resultRow:"unfinished (never finalized) — the worker was stopped before %UnitTest.Manager could save a result"}` — an OBSERVATION, never an assumption. Confirmed the run genuinely never finalizes: polled by `runIndex` again 16 s later (well past the 10 s `Hang`'s natural completion) — still `"unfinished"`. **Finished-but-undrained job:** submitted a second run, waited 10 s (past the `Hang`) WITHOUT draining it, then cancelled ⇒ `status:"completed"` with the note "the job had already finished; cancelling discarded only its queue entry. Results are preserved — poll by runIndex 89", `total:1`, `passed:1`, `duration:10010.831` ms — and the SQL row was independently confirmed intact via `runIndexSource:"result-table"`. **Governance:** confirmed via the dev package's own `test-status-governance.test.ts` (5/5 green, exercises the REAL `McpServerBase.handleToolCall` gate, not a mocked policy) and `test-status-epic-gate.test.ts` (the default-suite live capstone, which drives a `cancel` denial-then-enable round trip through the real gate against this same live instance) — both ran green as part of this session's own full dev-suite execution (768/768). Cross-checked `governance-baseline.ts` directly: `iris_test_status` is absent (0 hits), confirming both `poll`/`cancel` keys are non-baseline/post-foundation, governed purely by their `mutates` classification (poll read ⇒ enabled; cancel write ⇒ disabled) per Rule #28/#32 — no `defaultEnabled` marker present (correct; cancelling a run is not `iris_production_control:clean`-style recovery tooling).

### 6. Registration / counts (#51/#56) — one finding, fixed

Re-derived every count surface mechanically: `grep -n '\b28\b\|\b29\b\|\b104\b\|\b105\b\|\b109\b\|\b110\b'` across `README.md`, `tool_support.md`, `packages/iris-dev-mcp/README.md`, `packages/iris-mcp-all/README.md`, `docs/migration-v1-v2.md`. All figures the dev's own Task 4 rollup named (dev 29, suite 105/110, `developer` preset 77/82, `tool_support.md`'s Atelier/ExecuteMCPv2/Other breakdown 20/9/0=29) check out — **except one**: `README.md`'s `## The rosters` "In short" bullet for `@iris-mcp/dev` still read "the full **28**-tool server", two sections below a table (L602) that correctly says 29 — a leftover the Task 4 grep would have caught had it been re-run after all edits landed. No test covers this specific prose line (`docs-visibility-roster-sync.test.ts` parses the tables only). **Fixed directly in this pass** (trivial, unambiguous, non-product-code correction — the same treatment Story 36.1's QA gave the `34-5-R3` marker fix); re-grepped clean afterward (zero `28-tool` hits repo-wide in the doc surfaces above); `packages/iris-mcp-all` suite re-run post-fix, still 129/129. Ledgered as `36-2-QA-1` (LOW, opened-and-resolved in this same pass; `deferred-work.md` EOF, Rule #51 recount included — new state: 0 HIGH / 29 MEDIUM / 97 LOW = 126 open / 213 distinct / 87 terminal).

The `pnpm measure:tools-payload` byte-count drift the dev flagged for the four untouched packages (admin/interop/ops/data) was already recorded as a residual, out-of-scope observation in the Dev Agent Record — confirmed present as documented in the current `README.md` payload table; not re-ledgered (already recorded, per the QA brief's own instruction to ledger only if "not already recorded").

### 7. Standard gates

- Forced clean rebuild (`rm packages/{shared,iris-dev-mcp}/tsconfig.tsbuildinfo`; `pnpm turbo run build --force --filter @iris-mcp/shared --filter @iris-mcp/dev`) — clean, no tsc errors.
- Per-package standalone suites, post-rebuild: shared **1334/1334**, dev **768/768** (incl. the live `test-status-epic-gate.test.ts` capstone actually executing live, not skipped — confirmed by its HTTP log lines), all **129/129** (re-run twice: once pre-fix, once post-README-fix, both green).
- `pnpm gen:governance-baseline:check` (`:check` ONLY) — exit 0, frozen `1e62c5ad5bf7`/141 unchanged, 203 live / 62 post-foundation.
- `pnpm gen:skills:check` — OK, 12 generated files match source, no drift.
- `node scripts/check-epics-sync.mjs` — 0 genuine drift / 0 orphans / 0 duplicates across epics 1–36.
- `bootstrap-classes.ts` absent from `git status`/diff; `BOOTSTRAP_VERSION` unchanged at `e1168c1ebe56`.
- No `action` enum added to `iris_execute_tests` (confirmed: `executeTestsTool`'s `inputSchema` has no `action` field at all; grepped `execute.ts` for `z.enum` — the only enum in the file is `testStatusTool`'s own, in a different file).
- `TOOL_PAIRS` (`packages/shared/src/tool-visibility.ts`) confirmed byte-identical (`git diff` empty) — still only `["iris_env_diff", "iris_env_promote"]`, `iris_test_status` correctly NOT a member.
- `governance-baseline.ts` confirmed byte-identical (`git diff` empty).
- `tsc --noEmit` and `eslint src/` clean on `@iris-mcp/dev` and `@iris-mcp/shared` (one pre-existing, unrelated warning in `packages/shared/src/cli/governance.ts` — confirmed untouched by this story's diff, not a Story 36.2 finding).
- Instance cleanliness: disposable class `ExecuteMCPv2.Temp.Story362QADeltaDrain` deleted and absence verified; both ad hoc QA jobs' Atelier queue nodes confirmed drained (`defined:false`); disposable QA Node scripts deleted from `scratchpad/` after use (never committed, never left in the working tree).

### Escalation to lead

None required — no product-code defect found. `36-2-QA-1` was resolved directly in this pass (documentation-only).

## Code Review (2026-09-11)

### Review Findings

**Close record (Rule #57).** The frozen diff snapshot `review-diff-snapshot-36-2-test-status-companion-tool-20260911-060906.diff` (2643 lines, 25 files) was written before any layer launched. `iris-execute-mcp-v2.code-workspace` and `cycle-log-epic-36.md` were excluded as lead-owned. The story file itself was kept out of the snapshot, so the Blind Hunter stayed spec-blind; the Acceptance Auditor received it in full as the spec, with architecture decision L1 as its ADR.

`layers_mode=sequential_sync`: each layer was launched synchronously, one after another, with its own real armed 20-minute timer (a backgrounded `sleep 1200`, stopped on delivery). Each was told to deliver a possibly-partial, explicitly-marked payload before its bound.

| Layer | Delivered after | Findings |
|---|---|---|
| Blind Hunter | 466 s | 22 |
| Edge Case Hunter | 731 s | 16 |
| Acceptance Auditor | 516 s | 17, plus a "checked and clean" list |

All three delivered within their own 1200 s bound: `failed_layers` = none, `review_degraded = false`. The 55 raw findings deduplicated to 36: **25 patch (all applied), 1 defer (HIGH, pre-existing, ledgered), 10 dismissed, 0 decision-needed.**

**Lead-routed question — Rule #59 coverage of delta-drain completeness: the live gate was INADEQUATE, and this is now fixed (`36-2-CR-D`).** The single-method capstone could not fail on the property AC 36.2.2 was amended for. Mutation M1 (completion rebuilt from the terminal drain alone) left that test GREEN.

- [x] [Review][Patch] `36-2-CR-A` (HIGH; blind+edge) **`jobId` was spliced raw into the Atelier URL and the `/global` subscripts, so `cancel` could `DELETE` any Atelier route.**
  - `executeFetch` concatenates the path, and `fetch`'s URL parser resolves dot segments. Verified in Node: `work/../doc/MyApp.Foo.cls` becomes `/api/atelier/v8/HSCUSTOM/doc/MyApp.Foo.cls`. An enabled `cancel` would therefore delete a document, bypassing `iris_doc_delete`'s governance key.
  - The same string reached the `/global` subscript list of the default-enabled read `poll` (see `36-2-CR-1`).
  - Fix: `jobId` must match `^\d+$` in the input schema AND in both handlers, before any IRIS call. `%Api.Atelier.v8` `PollAsync`/`CancelAsync` take `pID As %Integer`. Unit fakes now use real all-digit ids (#54).
  - Mutation U4 → 2 no-HTTP pins RED.
  - [test-status.ts `JOB_ID_PATTERN`]
- [x] [Review][Patch] `36-2-CR-B` (HIGH; auditor+edge) **A finished run with NO method rows came back as a green `completed` with `total: 0` on the SQL path.**
  - For the same run (e.g. a failed `OnBeforeAllTests`), the drain path returns the AC 34.5.3/34.6.4 `isError: true` zero-result guard. AC 36.2.2's value identity failed exactly where a false green matters.
  - Fix: every SQL completion now goes through `completedFromResultTable`: runIndex-alone, terminal poll, 404 fallback, and cancel-on-finished. It returns the SAME guard, with the class-level reason read from `TestCase` and formatted exactly as the drain formats it (`UnitTestResultToJSON`'s class-row `error` → `summarizeAtelierResults`).
  - Unit pins use the Task 1 `Story362BadSetup` capture. Mutation U3 → 2 pins RED.
  - [test-status.ts `completedFromResultTable`]
- [x] [Review][Patch] `36-2-CR-C` (HIGH; auditor) **Neither Epic 36 live gate was armed.**
  - `IRIS_REQUIRE_LIVE` is set only by the prepublish gates. Neither `test-status-epic-gate.test.ts` nor Story 36.1's `execute-tests-running-contract-epic-gate.test.ts` was in any list. AC 36.2.4 requires "armed like `epic35-defect-gate.test.ts`"; Rule #59 names this exact failure: "an arming env var nothing sets".
  - Fix: both files added to `packages/iris-dev-mcp/scripts/prepublish-gate.mjs`.
  - Proven on the packaging path:
    - `node scripts/prepublish-gate.mjs` exit 0 (4 files, 31 tests, both Epic 36 gates executed live).
    - `IRIS_PORT=59999 node scripts/prepublish-gate.mjs` exit 1, with `IRIS_REQUIRE_LIVE is set …` from all four files.
  - The 36.1 gate's omission was a Story 36.1 miss of the same class, in the same file; it is fixed here.
  - [scripts/prepublish-gate.mjs]
- [x] [Review][Patch] `36-2-CR-D` (HIGH; auditor ×2 + the lead-routed question) **No default-suite LIVE test exercised delta-drain completeness, nor the drain-vs-SQL identity that AC 36.2.2 requires ("pinned by a LIVE equality test").**
  - The single-method fixture drains nothing into 36.1's `running` response, so a drain-only completion stays green (M1 above). Leg 4's "oracle" also re-applied the implementation's own ×1000.
  - Fix, part 1 — new permanent fixture `src/ExecuteMCPv2/QAFixtures/DeltaDrainTest.cls`:
    - Three fast methods (a pass, a deliberate assert failure, a deliberate thrown exception), then a 6 s slow pass.
    - Outside `ExecuteMCPv2.Tests` and outside the bootstrap manifest (Rule #39).
    - Deployed on the default HSCUSTOM instance via `iris_doc_load`.
  - Fix, part 2 — capstone **Test 2**: `iris_execute_tests` (timeout 3) must already have drained the three fast rows. The later `iris_test_status` `completed` must then carry all 4 methods, and its three fast rows must `toEqual` the drain-path rows exactly (name prefix, status, ms duration, both message kinds, order).
  - M1 → Test 2 RED (`expected 1 to be 4`). M2 (method-level error dropped) → Test 2 RED on the thrown-exception message.
  - `LongRunningTest.cls` is untouched.
  - [test-status-epic-gate.test.ts]
- [x] [Review][Patch] `36-2-CR-E` (HIGH; Rule 6 — ADR L1 (2); auditor) **With no run index obtainable, one DELTA drain was returned as `status: "completed"` with top-level counts.**
  - A consumer could take that for a final result. If 36.1's `running` response had already drained a failure, this terminal drain reads green.
  - The AC's "drained rows … with an explicit incompleteness note" does not prescribe the status, so L1 decides.
  - Fix: return the error kind (`isError: true`, top-level zeros), with the drained rows under `partial`, the handles, and the explanation.
  - Mutation U7 → RED.
  - [test-status.ts handlePoll]
- [x] [Review][Patch] `36-2-CR-F` (MEDIUM; blind+edge+auditor) **The terminal `jobId` poll emitted `completed` without checking that the run finished or even existed.**
  - A mis-predicted index (Atelier predicts it unlocked), or a worker that died before `SaveResult`, got interim `Status 1`/`Duration 0` rows counted as passes. An absent row gave `completed` with `total: 0`.
  - Fix: resolve through `resolveByRunIndex`:
    - finished ⇒ `completed`, or the zero-result guard;
    - unfinished ⇒ `abandoned`;
    - absent ⇒ error.
  - U6 → 2 pins RED. Live M6 showed the check reporting `abandoned` rather than a false `completed`.
  - [test-status.ts handlePoll]
- [x] [Review][Patch] `36-2-CR-G` (MEDIUM; blind+edge+auditor) **The SQL-path `message` dropped method-level errors.**
  - Live capture at this review (disposable `ExecuteMCPv2.Temp.CR362MsgProbe`, run 94, deleted after): a thrown exception's drain message is `ERROR #5035: General exception Name 'CR362Deliberate' …`. It comes from `TestMethod.ErrorAction`/`ErrorDescription`, with one leading space stripped, which is `UnitTestResultToJSON`'s own rule. The SQL path returned `""`.
  - Fix: a failed method's message is now the method-level error first, then its failed `TestAssert` rows in `Counter` order.
  - The unit pin is the verbatim run-94 drain rows. Live Test 2 pins the same thing against the drain path.
  - [test-status.ts buildCompletedSummaryFromSql]
- [x] [Review][Patch] `36-2-CR-H` (MEDIUM; blind+edge) **`Number(Duration) * 1000` is not value-identical to the drain's exact-decimal `Duration * 1000`.**
  - About 25% of 6-decimal values differ, including the QA's own live `8.007687` (→ `8007.687000000001`) and `0.00006` (→ `0.060000000000000005`).
  - Fix: `Math.round(seconds * 1e6) / 1000`. Scaling to integer microseconds is exact for `%Numeric(SCALE=6)`, followed by one correctly-rounded division. This gave 0 mismatches over all 2,000,001 values from 0 to 2 s.
  - Unit pin on the run-87 QA capture uses exact `toEqual`, not `toBeCloseTo`. U2 → RED.
  - [test-status.ts secondsToDrainMilliseconds]
- [x] [Review][Patch] `36-2-CR-I` (LOW; blind+edge) **`details` order was unspecified (no `ORDER BY`).**
  - Fix: `ORDER BY %EXACT(tc.Name), %EXACT(tm.Name)`, which is the drain's own `$ORDER` traversal (verified live).
  - Pinned by a unit test and by live Test 2's ordered equality.
  - [test-status.ts METHOD_ORDER]
- [x] [Review][Patch] `36-2-CR-J` (MEDIUM; blind+edge+auditor) **`cancel`'s "observation" was partly assumed, and the capstone check that should prove it could not fail.**
  - What was assumed:
    - `queueNode: "gone"` was a constant.
    - An absent row was reported as "unfinished (never finalized)".
    - The first line said "stopped." even with no run index.
    - The capstone checked "finished" immediately after cancelling a 10 s `Hang`. That passes whether or not the worker stopped.
  - Fixes:
    - The queue entry is re-read after the `DELETE`, via `requesttype`, which exists for every queued job.
    - The row is reported `unfinished` or `absent`, as found.
    - The first line reads "CANCEL ACCEPTED … Observed —".
    - Capstone Leg 7 waits past the run's natural finish (submission + 10 s + 4 s) and requires the run still unfinished.
  - Proofs:
    - M3a (DELETE skipped) → RED at the queue re-read.
    - M3b (same mutation, with the queue/row assertions disabled) → RED at the past-natural-finish check (`expected true to be false`). The check the review found vacuous now fails when the worker is not stopped.
    - U8 → RED.
  - [test-status.ts handleCancel; epic gate Leg 7]
- [x] [Review][Patch] `36-2-CR-K` (MEDIUM; blind+edge+auditor) **`cancel` rethrew non-404 failures and SQL errors that happen after a successful `DELETE`.**
  - Non-404 failures include HTTP 423 (another caller holds the job's lock), 500, and timeouts.
  - Rethrowing lost the `runIndex` read before the `DELETE`, and lost whether the `DELETE` took effect. That contradicts the Story 36.1 lesson: never lose the handle.
  - Fix: return an error envelope that keeps `jobId`/`runIndex` and says the outcome is unknown, with "poll before retrying". A post-`DELETE` SQL failure still returns the queue observation, with the row reported as `unknown`.
  - [test-status.ts handleCancel]
- [x] [Review][Patch] `36-2-CR-L` (MEDIUM; edge) **Polling or cancelling in a namespace other than the run's silently read a different run.**
  - `^IRIS.TempAtelierAsyncQueue` lives in IRISTEMP and is instance-wide. `PollAsync`/`CancelAsync` never check the URL namespace (confirmed by reading `%Api.Atelier.v8`). `%UnitTest_Result` is per-namespace. Yet the hint's suggested call omitted the namespace.
  - The mismatch can't be detected server-side, because the queue node stores no namespace.
  - Fix:
    - The `namespace` parameter now says it MUST be the run's own.
    - `buildRunningHint` takes the run's namespace and names it in the suggested call.
    - `iris_execute_tests`' description and the deploy-and-test prompt say the same. The skill was regenerated after a forced rebuild.
  - [execute.ts; test-status.ts; deployAndTestClass.ts]
- [x] [Review][Patch] `36-2-CR-M` (MEDIUM; edge) **Neither action checked that the `jobId` belongs to a unit-test job.**
  - A mistyped or foreign id (for example a VS Code compile or search job) would be drained, then consumed, by the read `poll`, or killed by `cancel`.
  - Fix: `requesttype` is read first. A defined value other than `unittest` is refused with no `GET` and no `DELETE`. This is best-effort: when the node is gone or `/global` is down, the call proceeds as before.
  - U5 → RED.
  - [test-status.ts refuseNonUnitTestJob]
- [x] [Review][Patch] `36-2-CR-N` (MEDIUM; blind+edge+auditor) **Three capstone legs were defective:**
  - Leg 2 "tolerated" `completed`. But that poll consumes the node, so Leg 3 (jobId only) would 404 into a 30 s timeout. AC 36.2.4 requires `running` there.
  - The AC's "the queue node is gone" step was never asserted.
  - The capstone used `timeout: 3`, where the AC says `timeout: 5`.
  - Fix: Leg 2 is strictly `running` (M6 → RED). Leg 5 asserts the node gone via `/global` (M4 → RED). `timeout` is now 5.
  - [epic gate Test 1]
- [x] [Review][Patch] `36-2-CR-O` (MEDIUM; blind+auditor) **The mutation evidence was incomplete and self-contradictory, and `36-1-CR-3`'s RESOLVED evidence cited assertions that did not exist.**
  - Fix:
    - Every capstone leg and every new unit guard is now mutation-proven (table below).
    - The capstone banner names each mutation and the leg it drives RED.
    - The hint tells manual-route users that one poll by `jobId` releases the queue entry.
    - The ledger has an appended `36-1-CR-3` correction row, carrying its bold terminal token.
  - [ledger; epic gate banner]
- [x] [Review][Patch] `36-2-CR-P` (MEDIUM; auditor+blind) **Three count surfaces were still stale, despite Task 4 being checked [x]:**
  - the `README.md:705` diagram still read `(28)` (a surface named in this story's own table);
  - `tool_support.md` still had `**Mix:** 19 Atelier`;
  - `docs/epic-summary.md:3` still said "104 tools … 109 advertised … has not moved since Epic 30".
  - Fixed to 29, 20 Atelier, and 105 (110), then re-grepped clean.
- [x] [Review][Patch] `36-2-CR-Q` (LOW; blind+edge) **An SQL failure after the terminal `GET` was reported as "the run may still be executing", and told the caller to re-poll a `jobId` Atelier had just consumed.** Separately, an SQL 404 was misrouted into the jobId-404 fallback.
  - Fix: only the `GET` sits inside the jobId `try`. An SQL-phase failure returns "finished … poll again with runIndex N", with the `runIndex` handle and the drained `partial`.
  - [test-status.ts handlePoll]
- [x] [Review][Patch] `36-2-CR-R` (LOW; auditor) **`tool_support.md` row 29 stated only `cancel`'s default**, while AC 36.2.1 / #30 require BOTH default states. Fix: added that `poll` is read and enabled by default. [tool_support.md]
- [x] [Review][Patch] `36-2-CR-S` (LOW; blind+auditor) **The hint sent `core`-preset users to a tool that is hidden from them.** Fix: it now points to the manual route, or to having the operator re-show the tool with `IRIS_TOOLS_ENABLE=iris_test_status`. The L-2 manual route itself is unchanged. [execute.ts buildRunningHint]
- [x] [Review][Patch] `36-2-CR-T` (LOW; blind+auditor) **Several claims were inaccurate:**
  - CHANGELOG and changeset said `iris_execute_tests` was "byte-for-byte unchanged", but its hint and description text changed.
  - README said "up to ~58% (dev)"; admin's saving is ~65%.
  - The payload prose credited the dev row's move to `iris_test_status`, which `core` excludes, and called the other rows' drift unrelated without giving a cause.
  - Root cause: the table was last measured at Story 30.2 (`9c57d84`). Byte counts are not test-pinned, and descriptions changed in Epics 31–36.
  - Fix: wording corrected. `pnpm measure:tools-payload` was re-run after a forced clean rebuild. The dev row is updated to the post-review values (70,119 / 29,293); the other four rows reproduce the committed table exactly.
  - [CHANGELOG.md, changeset, README.md]
- [x] [Review][Patch] `36-2-CR-U` (LOW; auditor) **There was no governance key-derivation test, which AC 36.2.1 requires.**
  - Fix: new `packages/iris-mcp-all/src/__tests__/test-status-governance-keys.test.ts` (Rule #45, runs over the built dists):
    - `deriveKeysForTool` yields exactly `iris_test_status:poll` and `:cancel`, both outside the frozen baseline.
    - `iris_execute_tests` yields its bare baseline key.
  - U9 (a third `action` value, rebuilt) → RED.
  - [new test]
- [x] [Review][Patch] `36-2-CR-V` (LOW; blind) **The unit ordering pin asserted only that `/global` was called, and the fake never consumed the node on a terminal `GET`.** A read placed after the `GET` therefore stayed green.
  - Fix: an `invocationCallOrder` pin, and a harness that kills the node on a terminal `GET` or a successful `DELETE`, the way `PollAsync`/`CancelAsync` do (#54).
  - U1 (read moved after the `GET`) now drives 6 pins RED; before this fix it drove 2.
  - [test-status.test.ts harness]
- [x] [Review][Patch] `36-2-CR-W` (LOW; blind) **`RunHandles`' doc comment said `"result-table"` is never attributed via the queue node**, which contradicts the jobId terminal path that AC 36.2.2 (ii) mandates. Doc corrected. [execute.ts RunHandles]
- [x] [Review][Patch] `36-2-CR-X` (LOW; blind) The description had the typo "for a authoritative answer". Fixed. [test-status.ts]
- [x] [Review][Patch] `36-2-CR-Y` (LOW; blind+edge) **The capstone started two `McpServerBase` instances and never stopped them.** Fix: `stop()` in `finally`. [epic gate]
- [x] [Review][Defer] `36-2-CR-1` (HIGH, pre-existing) **`/global`'s `BuildGlobalRef` lets subscripts inject ObjectScript: `iris_global_get` (read) executes caller code.** [src/ExecuteMCPv2/REST/Global.cls:219] — deferred, pre-existing.
  - Live-verified: a subscript `x"_$Increment(^CRProbe362Side)_"x` incremented a disposable global through `iris_global_get`; the global was killed afterwards.
  - This story's own vector is closed by `36-2-CR-A`.
  - Fixing the rest means changing a bootstrapped `.cls`, which is outside this pure-TS story.
  - Ledgered with rationale and a suggested resolution (Story 36.3's burn-down, or a dedicated fix).

**Dismissed (10):**
1. The queue read sat outside `try`. Not a problem: `readGlobalNode` never throws; it catches everything and returns `undefined`.
2. `poll` is classified `read` but drains. ADR L1 (4) classifies re-attach as READ, and the only rows it could take belong to an abandoned `iris_execute_tests` call nobody reads.
3. `abandoned` was inferred from a 404 when the caller supplied a mismatched `jobId`/`runIndex` pair. That is AC (v)'s specified behaviour applied to an input error, and the envelope echoes both handles.
4. The `Duration === 0` interim heuristic. It is a documented design choice that affects only the non-final `unfinished` partial, and QA found no finished `Duration 0` rows.
5. An unknown status is counted as skipped. This mirrors `summarizeAtelierResults`, so it keeps value identity, and it is unreachable: the `Status` VALUELIST is 0,1,2 (#54).
6. `runIndex` precedence and conflicting handles. Immaterial: the pre-read queue value is null on a 404, and the terminal path correctly prefers the job's own node.
7. `destructiveHint: true` on a mixed read/write tool. It is spec-mandated and follows the `iris_env_promote` precedent.
8. `needsCustomRest` and the unfinished result rows. `needsCustomRest` defaults to `false`, so there is no bootstrap side effect, and an unfinished row is inherent to proving `cancel`.
9. Cross-attribution through the predicted index. This is the documented InterSystems caveat, and the drain itself reads by the same predicted index.
10. The DELETE-404 fake with a live node. That state is reachable when a concurrent poller consumes the node between the pre-read and the `DELETE`.

**Mutation evidence (Rules #48/#59).** Each mutation was broken on the path it guards, and every restore was verified byte-identical (`test-status.ts` md5 `487b1d75cf084d8e8c68123102917e44`, gate file `86595a88b3a6ff3ec0f12ca71844ed7d`).

| # | Mutation (path) | Guard driven RED |
|---|---|---|
| M1 | SQL-path completion → the terminal drain's rows (live, armed) | Test 2 (`total` 1≠4). Test 1 stayed GREEN: the gap the lead asked about. |
| M2 | Method-level error dropped (live) | Test 2 drain-path equality (thrown-exception message) |
| M3a | Cancel `DELETE` skipped (live) | Leg 7 post-`DELETE` queue re-read ("still present") |
| M3b | M3a, with the observation asserts disabled (live) | Leg 7 past-natural-finish check (`expected true to be false`) |
| M4 | Finished run resolved from SQL without the terminal `GET` (live) | Leg 5 (queue node still defined) |
| M5 | `cancel` reclassified `mutates: "read"` (live, real governance gate) | Leg 7 denial |
| M6 | `Retry-After` ignored (live) | Leg 2 strictly `running` (got `abandoned`) |
| U1 | Queue read moved after the `GET` | 6 unit pins |
| U2 | IEEE `* 1000` | Run-87 exact-duration pin |
| U3 | Zero-result guard removed | 2 pins |
| U4 | Handler `jobId` validation removed | 2 no-HTTP pins |
| U5 | `requesttype` refusal removed | 1 pin |
| U6 | Terminal path skips the finished check | 2 pins |
| U7 | No-index path → top-level `completed` | 1 pin |
| U8 | Post-`DELETE` queue re-read hard-coded | 1 pin |
| U9 | Third `action` value (built dist) | `iris-mcp-all` key-derivation test |

**Post-patch verification:**
- **Build and suites.** Forced clean rebuild (`rm packages/*/tsconfig.tsbuildinfo`; `pnpm turbo run build --force`, exit 0). Standalone suites: shared **1334/1334**, dev **783/783** (768 + 15; the live gates executed, none skipped), all **130/130** (129 + 1). `execute.test.ts` is unmodified and green (Rule #19).
- **Lint and types.** Dev `tsc --noEmit` and `eslint src/` are clean, and the new `iris-mcp-all` test file lints clean. The package has one pre-existing error, in `epic35-defect-gate.test.ts:303`, not from this story.
- **Governance and generated artifacts.**
  - `gen:governance-baseline:check` (`:check` only) exit 0: frozen `1e62c5ad5bf7`/141, 203 live, 62 post-foundation (E-2).
  - E-1 holds: no `action` enum on `iris_execute_tests`.
  - `gen:skills:check` OK (12 files).
  - `check-epics-sync.mjs` exit 0.
  - `bootstrap-classes.ts` is absent from the diff and `BOOTSTRAP_VERSION` is still `e1168c1ebe56`.
  - `governance-baseline.ts` and `TOOL_PAIRS` are untouched.
- **Second-instance smoke (Rule #34).** Run on `ocupilot-iris` over the BUILT dist: **13/13 legs GREEN**.
  - Legs covered: delta-drain completeness, exact drain equality, the hint carrying the namespace, the queue node consumed, runIndex-alone identity, traversal refusal, and cancel observed past the natural finish.
  - Both disposable classes were deleted and verified absent.
  - The queue went from 22 entries to 23. The one new entry, `3882324:unittest:317`, is another client's job, allocated between our runs 316 and 318; neither of ours remains. The reporter's entries were untouched.
- **Default instance state.** The disposable probe and lister classes are deleted (`ExecuteMCPv2.Temp` is empty), the Atelier queue is empty, and the probe global is killed. `DeltaDrainTest` is deployed; `LongRunningTest` is untouched.

## Change Log

| Date | Change | Author |
|---|---|---|
| 2026-09-11 | Story created by the lead (`/bmad-create-story` inline, key adopted `36-2-test-status-companion-tool`). AC 36.2.2 and AC 36.2.3 amended in place in `epics.md` (Rule #42) — the drain is DELTA (36.1 probe (d)) and a cancelled run stays at `$D=10` forever (probe (e)), so the planning-time "full envelope from the drain" and "`$D=10` ⇒ running" claims were false; added `unfinished`/`abandoned` states, SQL-path-authoritative completion, and an HTTP-`DELETE` probe-first requirement. Lead pre-story notes carry 36.1's probes and the 36.1 lead-smoke confirmations (row visible from run start; abandoned finished jobs drain over HTTP). | Lead (claude-opus-5) |
| 2026-09-11 | Story implemented end-to-end: Task 1 live probes (HTTP `DELETE` on running/finished-undrained jobs, mid-run SQL, SQL-vs-drain field equality — found the seconds-vs-milliseconds `Duration` unit mismatch) → shared helpers exported from `execute.ts` and `TestRunEnvelope` extended additively (`unfinished`/`abandoned`/`cancelled`) → `iris_test_status` tool (`poll`/`cancel`) shipped, registered (`developer`-include/`core`-exclude, NOT a `TOOL_PAIRS` member), governed (2 new keys, `cancel` default-disabled) → unit tests (17) + governance tests (5) + a live default-suite capstone (round trip incl. a cancel leg through the REAL governance gate) + a disposable `ocupilot-iris` second-instance smoke, all green → docs rollup (dev/root/all-package READMEs, `tool_support.md`, CHANGELOG, `docs/bugs-2026-09-10.md` footer, `docs/migration-v1-v2.md`, `deployAndTestClass.ts` + regenerated skill), ledger (`36-1-CR-3` → RESOLVED), changeset. Gates green: dev 768/768, shared 1334/1334, all 129/129; `gen:governance-baseline:check` exit 0 (203 live/62 post-foundation); `gen:skills:check` clean; `check-epics-sync.mjs` clean; tsc/eslint clean; `BOOTSTRAP_VERSION` unmoved. Status → review. | claude-sonnet-5 |
| 2026-09-11 | Code review (`layers_mode=sequential_sync`: Blind 466 s, Edge 731 s, Auditor 516 s, each within its own armed 20-min bound; `review_degraded=false`, close kind CLEAN). 55 raw findings → 36: 25 patched, 1 deferred (`36-2-CR-1`, HIGH, pre-existing), 10 dismissed. The lead-routed Rule #59 question was answered "inadequate" and fixed: a new permanent `DeltaDrainTest` fixture plus capstone Test 2 prove delta-drain completeness and exact drain-vs-SQL identity live, and M1 shows the old single-method test stayed green. HIGHs fixed: `jobId` path traversal (`cancel` could `DELETE` any Atelier route); a green `total: 0` for zero-method runs, where the drain path returns the zero-result guard; neither Epic 36 live gate armed (both now in the dev prepublish gate, exit 0 armed / exit 1 fail-closed); no live delta-drain or equality test; a partial drain returned as final counts (ADR L1). MEDIUMs fixed: terminal finished check, method-level error messages, exact ms normalization, `cancel`'s observation and its vacuous live check (now observed past the natural finish), `cancel` error handles, namespace, foreign-job refusal, capstone legs, mutation-evidence and ledger accuracy, stale counts. 16 mutations proven RED; `ocupilot-iris` smoke 13/13. Ledger: `36-1-CR-3` evidence corrected, `36-2-CR-1` opened, giving 1 HIGH / 29 MEDIUM / 97 LOW = 127 open / 214 distinct / 87 terminal. Status → done. | Code review (claude-opus-5) |
