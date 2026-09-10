# Sprint Change Proposal — 2026-09-10 (`iris_execute_tests` abandons long runs client-side)

**Trigger:** First beta-feedback defect — `bug-iris-execute-tests-timeout.md` (reported 2026-09-10 from the OcuPilot project against server profile `ocupilot-iris`, IRIS 2026.2 Build 221U, Atelier v8), analyzed live in this session
**Facilitator:** Mary (Business Analyst) → correct-course · **Project Lead:** Developer
**Mode:** Batch · **Scope classification:** **Moderate** (new epic with two implementation stories + the conventional gate story; PRD/architecture/epics/sprint-status updated; no MVP change, no rollback)
**Project Lead decisions taken during this session (2026-09-10):** home = **new Epic 36** (Epic 35 is closed, retro'd and merged to `main` as `60be515`); scope = **Tier 1 story now + Tier 2 companion-tool story planned as backlog**; mode = Batch.
**Approval:** APPROVED 2026-09-10 (Project Lead), with the §3 lead decisions resolved as recommended — **L-1** wave-5 feature branch (`feature/feature-wave-5-beta-feedback` off `main`, `epic36` off it); **L-2** `iris_test_status` = `developer` include / `core` exclude / NOT paired; **L-3** `@iris-mcp/dev` minor, `@iris-mcp/shared` patch. §4.1–§4.6 applied in-session (verified single-region hunks; `check-epics-sync.mjs` OK: 0 drift / 0 orphans); Story 36.1 file created with the session's live probe results as its lead pre-story probe section.

---

## 1. Issue Summary

`iris_execute_tests` (`@iris-mcp/dev`) fronts the Atelier asynchronous work queue (`POST /work` → `GET /work/{id}` until the `Retry-After` header disappears) with a **hard-coded 120-second client-side poll budget** ([`execute.ts:137`](../../packages/iris-dev-mcp/src/tools/execute.ts)). When a genuinely slow suite outlives that budget, the tool returns `Error: Test execution timed out` with `isError: true` and **no `structuredContent`** ([`execute.ts:393-398`](../../packages/iris-dev-mcp/src/tools/execute.ts)) — while the `%UnitTest.Manager` run continues server-side and completes normally minutes later. The Atelier job id captured at `execute.ts:328` is never returned, the `%UnitTest.Result` run index is never surfaced, and there is no `timeout` parameter. The failure therefore reads as terminal and as indistinguishable from "nothing ran", so the caller's only available move — re-submitting — produces genuinely concurrent runs of the same class against shared instance fixtures, corrupting "latest run" attribution and producing failures that look like product defects.

**Every observable in the report is confirmed** by source reading and live probes (Rule #16). Four findings sharpen or correct it:

1. **The evidence lines up exactly with a 120 s budget.** `%UnitTest.Result.TestInstance.DateTime` is documented (class doc comment) as *"the time when the UnitTest TestInstance finished running"*, and the run index is allocated at **start** (`%UnitTest.Manager.%OnNew` → `ReserveResultId` → `$i(^UnitTest.Result)`, `Manager.cls:1822/2833`). So run 242 started 15:56:36 (finish 16:04:36 − 480.5 s) → the client error fired ≈15:58:36 → run 243 was submitted at 15:58:49, thirteen seconds later. This also explains the reporter's "indices not in chronological order" observation (indices are start-ordered, `DateTime` is finish-ordered) and resolves the report's open question about `DateTime` semantics.
2. **The report's suggested model to mirror does not exist.** `iris_doc_compile`'s `async` mode ([`compile.ts:106-125`](../../packages/iris-dev-mcp/src/tools/compile.ts)) hits `/action/compile?async=1` and returns the raw envelope; it extracts no job id and there is no poll companion anywhere in the suite — its own description at `compile.ts:58` ("return a job ID for polling") is itself a latent doc bug. `/work` and the `retryafter` envelope field are used by exactly one tool in the repo: this one.
3. **This exact defect was already on the ledger.** `34-6-CR-20` (b) ([`deferred-work.md:2179`](../../_bmad-output/implementation-artifacts/deferred-work.md)), LOW, open at Rule #37 count 0, says verbatim: *"a timed-out run is precisely what an agent may misread as zero results."* It was sized as a bookkeeping nit; the beta incident shows it is a correctness defect on a verification surface.
4. **Re-attachment is structurally possible with the discarded handle.** `%Api.Atelier.v8:PollAsync` kills `^IRIS.TempAtelierAsyncQueue(id)` only on a poll that *observes* completion (`v8.cls:423`); an abandoned job's queue node persists, and the run index is stored at `^IRIS.TempAtelierAsyncQueue(id,"unittest","id")` (`v8.cls:730`). Verified live on `ocupilot-iris`/HSCUSTOM (2026-09-10): **10 orphaned unittest jobs** (run indices 203, 215, 234, 242, 245, 248, 249, 250, 253, 256), all finished (`$D(^UnitTest.Result(idx))=11`), and `iris_global_get IRIS.TempAtelierAsyncQueue(31797604,"unittest","id")` → `256` — i.e. **the run index is recoverable with a tool the suite already ships**, if only the job id were returned. The reporter is still being hit: runs 253 (600.8 s) and 256 (480.4 s) landed at 22:20–22:38, after the report was filed.

**Root cause (three layers, all ours):** (i) a synchronous façade over an async protocol with a frozen budget — `TEST_POLL_TIMEOUT` has been `120_000` since the `/work` rewrite (`82a5716`) and the 2026-07-08 fix `2ca6c3f` (accumulate every drain, finalize only when `Retry-After` is absent) made the loop correctly wait for completion, which is exactly what makes a fixed budget bite on slow suites; (ii) the handle is thrown away and expiry is rendered as a terminal error with no structured payload; (iii) no knob — `IRIS_TIMEOUT`/profile `timeout` govern per-request HTTP only ([`http-client.ts:54-56`](../../packages/shared/src/http-client.ts)) — and the description promises "reliable execution" while no doc anywhere mentions the budget (repo-wide grep for `120_000`/"two minutes" across docs: zero hits). Zero tests cover the timeout branch and the repo has no fake timers.

**Secondary hazards recorded, not fixed here:** (a) Atelier *predicts* the run index (`$G(^UnitTest.Result)+1`, `v8.cls:730`) milliseconds before `%UnitTest.Manager` allocates it, with no lock — two near-simultaneous submissions can make one job's poll read the *other's* results (InterSystems code; low probability; documented as a concurrency caveat). (b) `realRunTestSuites` kills the shared `^IRIS.Temp.UnitState` root at every run start (`Manager.cls:501`). (c) The shared HTTP client never retries on timeout/network/5xx (only one 401 re-auth retry, `http-client.ts:256-261`) — corroborating the report's "no evidence the tool retries".

**External constraint that shapes the fix (Research-First, verified 2026-09-10 — treat the per-client numbers as leads to re-verify for the beta client, Rule #16):** MCP clients impose their own `tools/call` ceilings. The TypeScript SDK client default `DEFAULT_REQUEST_TIMEOUT_MSEC` is **60,000 ms**; Cline defaults to 60 s (configurable), Cursor ≈60 s–2 min (configurable), VS Code Copilot agent mode ≈60 s and **not** configurable (feature request open); Claude Code exposes `MCP_TOOL_TIMEOUT` (ms) plus an idle timeout, and its honoring of `resetTimeoutOnProgress` is reported broken upstream. Consequence: merely raising the budget cannot be the fix — a 10-minute synchronous wait may be abandoned upstream on several clients — so the robust shape is **a non-error "running" result carrying durable handles + a re-attach surface**, with a caller-controllable budget as the convenience knob.

**Issue type:** Technical limitation discovered in beta use (pre-existing defect, first surfaced by a real slow suite; ledger-predicted).

---

## 2. Impact Analysis

### Epic Impact

- **Epic 35 (closed, merged `60be515`)** — untouched. Its gate (`epic35-defect-gate.test.ts`, AC 35.8.4) covers F1–F9 + 35.9 only and is not widened.
- **New Epic 36 — Beta Feedback Remediation: Long-Running Test Execution Fidelity.** Direct Adjustment: a new epic with the conventional `36.0` gate story, **Story 36.1** (Tier 1: running contract + handles + budget) and **Story 36.2** (Tier 2: `iris_test_status` companion — re-attach / read-by-run-index / cancel), seamed per Rule #52.
- No future epic becomes obsolete. Epic 35's retro follow-through items (#3 beta distribution — now in progress and producing this feedback; #4 npm publish post-beta; #5 re-evaluate `34-8-CR-1`) carry into 36.0's gate.

### Story Impact

- **New:** 36.0 (gate), 36.1, 36.2 — full ACs in §4.1.
- **No existing story is modified.** `34-6-CR-20` (b) is closed *by* 36.1 (disposition RESOLVED with Rule #51 tally), not by editing Story 34.6.

### Artifact Conflicts

- **PRD** — FR39 ("run unit tests … with structured results") is silent on long runs and handles; the Reliability NFR has the `iris_doc_load` "no misleading success" bullet (35.9) but no "no misleading *failure*" counterpart for async-backed operations. **Add FR143/FR144 + one Reliability bullet** (§4.3). The illustrative `iris_execute_tests` JSON at `prd.md:286-288` is already schematic/inaccurate (`package`, `results`) and is deliberately not touched.
- **Architecture** — no decision invalidated. A genuine new pattern is worth one dated decision record following the H1–K1 addendum convention: **L1 — async-job-fronting tools never convert their own wait budget into a terminal error** (§4.4). It also records, without deciding, that `McpServerBase` drops the SDK `extra` argument (`server-base.ts:1146-1149`) so progress notifications/abort are unavailable to handlers today — two existing `ctx.sendProgress`/`ctx.signal` probes in `export.ts:200-214/484-491` are permanent no-ops.
- **Epics** — new Epic 36 section appended after Epic 35 (§4.1).
- **`sprint-status.yaml`** — new Epic 36 block (§4.2). `check-epics-sync.mjs` must report the 36.0 key as expected-absent-class only if we do NOT pre-declare it; we DO pre-declare it (mirroring 35.0), so it must show as present-both-sides.
- **`_bmad/custom/branch-naming.yaml`** — ACTIVE-branch comment block updated (§4.5; comment-only, no schema field).
- **Bug record** — the untracked repo-root `bug-iris-execute-tests-timeout.md` moves to `docs/bugs-2026-09-10.md` (house convention: `docs/bugs-2026-08-14.md`, `docs/bugs-2026-08-17.md`) with an analysis addendum (§4.6).
- **UI/UX** — not applicable (backend MCP suite).
- **Other** — no CI/deploy/monitoring changes. `deferred-work.md` is NOT edited at proposal time (precedent: the 08-17 proposal left ledger edits to 35.0/35.9); 36.0 triages and 36.1 closes `34-6-CR-20` (b).

### Technical Impact

- **36.1 is pure TypeScript** in `packages/iris-dev-mcp/src/tools/execute.ts` (+ `compile.ts` one-line description fix, `packages/shared/src/config.ts` for the env var, tests, docs). No ObjectScript handler change → no bootstrap regen; `BOOTSTRAP_VERSION` stays `e1168c1ebe56`. **No governance surface change**: the tool has no `action` enum so its key is the bare `iris_execute_tests` (frozen baseline member, `governance-baseline.ts:88`; classified `write`, `baseline-classifications.ts:108-111`); an additive scalar `timeout` leaves the key untouched. **Trap named explicitly:** modelling re-attach as a new `action` on `iris_execute_tests` would move the key to `iris_execute_tests:run`/`:status`, remove the frozen key from the live surface and trip the one-directional Rule #23 drift test — forbidden.
- **36.2 adds ONE new tool** (`iris_test_status`) → `mutates` per action (#28), explicit disposition in BOTH `core` and `developer` (#53), `TOOL_PAIRS` decision, tool-count pins move (`index.test.ts:23` 28→29; `presets.test.ts:56` 28→29; cross-server counts in `iris-mcp-all`, #31/#45), docs with default state (#30). `core` is **already at its 13-runtime-tool ceiling** (12 package tools + `iris_server_profiles`) — see Lead Decision L-2 in §3.

---

## 3. Recommended Approach

**Selected: Option 1 — Direct Adjustment** (new epic, two seamed stories + gate). Option 2 (Rollback) — not applicable; nothing recent caused this (`2ca6c3f` is correct and stays). Option 3 (MVP Review) — not needed; FR39 stands, this is contract hardening.

**Why two stories, not one:** Tier 1 is small, TS-only, governance-neutral and removes the incentive to re-submit *today*; Tier 2 is the robust answer to client-side ceilings but carries a new-tool registration surface, three probes whose answers may reshape its design, and a preset decision. Rule #52: 36.1 ships the complete-shape skeleton and documents the seam; 36.2 closes exactly that seam and does not re-touch 36.1.

**Effort:** 36.1 Low-Medium · 36.2 Medium. **Risk:** Low (36.1 additive; back-compat mechanically pinned) / Medium (36.2 — WQM re-attach on a stale token is the one unverified claim; probe-first gates the design). **Timeline:** no impact on anything in flight — the beta continues on `main`; Epic 36 is the first post-beta-feedback epic.

**Lead decisions requested at approval (defaults recommended):**

- **L-1 — Branching.** Wave-4 has merged to `main`; `feature/feature-wave-4-classmethod-fidelity` is closed. Recommend cutting **`feature/feature-wave-5-beta-feedback`** off `main` and branching **`epic36`** off it (ticketless convention; `branch-naming.yaml` comment updated per §4.5). Alternative: `epic36` directly off `main` — but the epic-cycle's SC-1 expects a feature branch, and further beta-feedback epics would share wave-5.
- **L-2 — `iris_test_status` visibility (36.2).** `core` is at 13 runtime tools. Recommend: **`developer` include, `core` exclude, NOT paired in `TOOL_PAIRS`**, and 36.1's running-result `hint` names BOTH re-attach routes — the companion tool (developer/full presets) AND the manual route available in `core` today (`iris_global_get` on the queue node → run index → `iris_sql_execute` against `%UnitTest_Result.*` by `InstanceIndex`, never `MAX()`). Alternative: pair + include in `core` (14 runtime; document the ceiling exception). Per Rule #53 this is a product decision, re-flagged rather than settled by the analyst.
- **L-3 — Changeset level.** New param + new response fields + a `status` discriminator on the success envelope is feat-shaped → recommend **minor** for `@iris-mcp/dev` (the `34-6-CR-19` lesson), patch for `@iris-mcp/shared` (env var only). Pre-first-publish, so this only fixes the CHANGELOG narrative.

---

## 4. Detailed Change Proposals

### 4.1 — `epics.md` — append after line 4759 (Epic 35's `**Out of scope**` footer)

```markdown
## Epic 36: Beta Feedback Remediation — Long-Running Test Execution Fidelity (added 2026-09-10)

**Goal**: A long-running unit-test run is never reported as a terminal failure while it is still executing; every run returns its correlation handles (Atelier work-queue job id + `%UnitTest.Result` run index); the wait budget is caller-controllable; and a caller who did outlive the budget can re-attach to, read, or cancel the run by handle instead of re-submitting it.

**Context**: First beta-feedback defect (2026-09-10, OcuPilot project, profile `ocupilot-iris`, IRIS 2026.2 Build 221U). `iris_execute_tests` polls the Atelier `/work/{id}` endpoint under a hard-coded 120 s budget (`packages/iris-dev-mcp/src/tools/execute.ts:137`) and on expiry returns `Error: Test execution timed out` (`isError: true`, no `structuredContent`, `execute.ts:393-398`) while the `%UnitTest.Manager` run keeps executing and completes minutes later; the job id captured at `execute.ts:328` is discarded. The natural caller response — re-submit — produces concurrent runs of the same class against shared instance fixtures and corrupts `MAX(runIdx)`-style "latest run" attribution. Ledger item `34-6-CR-20` (b) predicted this verbatim ("a timed-out run is precisely what an agent may misread as zero results") and was sized LOW. Full evidence, root cause, live probes and corrections to the original report: `docs/bugs-2026-09-10.md` and `sprint-change-proposal-2026-09-10-execute-tests-long-run.md`. Live-verified facts every story below builds on: `%UnitTest.Result.TestInstance.DateTime` is the FINISH time and the run index is allocated at START (`%UnitTest.Manager.%OnNew` → `ReserveResultId` → `$i(^UnitTest.Result)`); `%Api.Atelier.v8:PollAsync` kills the queue node ONLY on a poll that observes completion, so an abandoned job's `^IRIS.TempAtelierAsyncQueue(id)` persists (10 orphans found on `ocupilot-iris`) and its run index sits at `^IRIS.TempAtelierAsyncQueue(id,"unittest","id")`, readable today via `iris_global_get` (verified: job `31797604` → `256`). MCP clients impose their own `tools/call` ceilings (TS SDK default 60 s; several clients 60 s–2 min, not all configurable), so raising the budget alone is NOT a fix — the running-result + re-attach shape is.

**Constraint E-1 (Story 36.1: no governance surface change)**: 36.1 adds NO new tool and NO new action key. `iris_execute_tests` has no `action` enum, so its governance key is the bare frozen-baseline member `iris_execute_tests` (`governance-baseline.ts:88`, classified `write`); every 36.1 change is an additive PARAMETER or additive RESPONSE FIELD on that key. Introducing an `action` enum on this tool is FORBIDDEN — it would rename the key (`iris_execute_tests:run`), remove a frozen key from the live surface, and trip the one-directional Rule #23 drift test. Tool counts do not move in 36.1 (#31).

**Constraint E-2 (frozen baseline untouched)**: `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141/201/60 for the whole epic. Verify with `gen:governance-baseline:check` ONLY; never run the bare generator (#23/#25). Story 36.2's new tool keys are governed by their `mutates` classification, never by baseline membership.

**Constraint E-3 (Story 36.2: one new tool, fully registered)**: `iris_test_status` is the epic's ONLY new tool. It carries `mutates` per action (#28: `poll` = read, default-enabled; `cancel` = write, default-disabled — no `defaultEnabled` marker), explicit `include`/`exclude` in BOTH `core` and `developer` presets of `packages/iris-dev-mcp/src/tools/presets.ts` in the same story (#53), a recorded `TOOL_PAIRS` decision, and docs stating its default state at the point of use (#30). Visibility disposition is Project Lead decision **L-2** in the change proposal (recommended: `developer` include / `core` exclude / not paired — `core` is already at its 13-runtime-tool ceiling).

**Branching (Rules SC-1 / SC-2)**: wave-4 merged to `main` (`60be515`, 2026-08-19). Epic 36 targets a NEW feature branch **`feature/feature-wave-5-beta-feedback`** cut off `main` (Project Lead decision **L-1**, 2026-09-10); branch **`epic36`** off it. Ticketless convention per `_bmad/custom/branch-naming.yaml` (`epic_pattern: epic{N}`, `ticket_required: false`); the ACTIVE marker comment in that file is updated to wave-5 in the same change.

### Story 36.0: Epic 35 Deferred Cleanup

> **Note for the epic-cycle lead:** this is the conventional retro-review gate story, keyed `36-0-epic-35-deferred-cleanup` to match the `{N}-0-epic-{N-1}-deferred-cleanup` pattern. It is pre-declared here (as Epic 35 did for 35.0) and is already present in `sprint-status.yaml` as `backlog`; **adopt that key rather than creating a second 36.0 entry.** Do not reword this heading.

- **AC 36.0.1** - Standard retro-review gate: read `epic-35-retro-2026-08-19.md` and confirm every action item is done, carried with an owner, or explicitly closed. Known state at planning time: the `epic35` → wave-4 → `main` merge is DONE (`60be515`); beta distribution (#3) is IN PROGRESS and is the channel that produced this epic's trigger; npm publish (#4) and the `34-8-CR-1` re-evaluation (#5) remain post-beta.
- **AC 36.0.2** - Confirm `main` at `9cfa7af` (or later) is the base and that Epic 35's commits are reachable from the new wave-5 feature branch before any Epic 36 code lands. If the L-1 branch decision was not executed, HALT and escalate.
- **AC 36.0.3** - Triage Epic 35's carried ledger (state after the Epic 35 retro: **0 HIGH / 26 MEDIUM / 95 LOW = 121 open** across 202 distinct items, 80 terminal). Record the Rule #37 consecutive-re-deferral count per batch — the `34-6-CR-10`…`-20` batch enters this triage at count **1** (re-deferred once by Story 35.0). `34-6-CR-20` (b) is NOT re-deferred: it is assigned to Story 36.1 for terminal disposition, and its severity is RAISED to MEDIUM by this epic's evidence (record the raise in the ledger with a Rule #51 recount).
- **AC 36.0.4** - Rule #57 machinery armed for every review in this epic: bounded-close, frozen-diff snapshot, delivery receipts. Epic 35 closed 9/9 non-degraded; hold that bar.
- **AC 36.0.5** - Suite baselines recorded for the epic (from the Epic 35 retro: OS 412 · shared 1326 · dev 712 · data 161 · interop 337 · admin 480 · all 129) and re-measured at pickup with per-package standalone runs (the `35-1-DEV-1` turbo-parallel flake is still environmental).

### Story 36.1: MEDIUM - `iris_execute_tests` Running-Result Contract, Correlation Handles, Caller-Controlled Wait Budget

**Added 2026-09-10 (correct-course, beta feedback).** Reported from the OcuPilot project's use of the deployed `iris-dev` server; analyzed live against `ocupilot-iris` (HSCUSTOM) and the default HSCUSTOM instance. Full evidence: `docs/bugs-2026-09-10.md`. **Pure TypeScript** — no ObjectScript handler change, so NO bootstrap regen; `BOOTSTRAP_VERSION` must NOT move (`e1168c1ebe56`). Prove that.

- **AC 36.1.1** - Root cause confirmed at `packages/iris-dev-mcp/src/tools/execute.ts:137` (`TEST_POLL_TIMEOUT = 120_000`, unchanged since the `/work` rewrite `82a5716`), `:328` (the `Location` job id is captured and never returned), `:359-391` (the poll loop — correct since `2ca6c3f`, keep its accumulate-every-drain shape byte-for-byte) and `:393-398` (expiry → `isError: true`, no `structuredContent`, no handle). Evidence alignment recorded: run 242 started 15:56:36 (finish − duration), the client error fired ≈15:58:36 (+120 s), and run 243 was re-submitted at 15:58:49.
- **AC 36.1.2** - Probe-first (#16), BEFORE coding, results recorded verbatim in Dev Notes (they also seed Story 36.2's design — Rule #52 seam): (a) **when** `^IRIS.TempAtelierAsyncQueue(id,"unittest","id")` becomes readable relative to the `POST /work` response — it is set inside the worker AFTER class load/compile (`%Api.Atelier.v8:730`), so the first poll may precede it; (b) whether the run index node is still readable on the poll that observes completion or already killed (`v8.cls:423` kills the whole `(id)` subtree on that poll) — this decides the capture strategy in AC 36.1.5; (c) `GET /work/{id}` on an ABANDONED, FINISHED job (use one of the 10 orphans on `ocupilot-iris` — note the GET consumes the node, one shot per job): does `$SYSTEM.WorkMgr.Attach` on the hours-stale token succeed and does the poll drain the full result? (d) `GET /work/{id}` on a job abandoned mid-run and re-polled after completion — does the remainder drain? (e) `DELETE /work/{id}` (`CancelAsync`) on a RUNNING unittest job — does the worker observably stop (`%UnitTest_Result` row absent/partial; `$D(^UnitTest.Result(idx))`)? (f) live-confirm `$D(^UnitTest.Result(idx))` = `10` while a run is executing and `11` after `SaveResult` (in-flight detection without touching the queue). (c)–(f) are 36.2's design inputs; 36.1 records them and builds nothing on them.
- **AC 36.1.3** - **Running-result contract.** On wait-budget expiry with a job that is still running (`Retry-After` still present on the last poll), the tool returns `isError: false` and a `structuredContent` whose top level is `{ status: "running", jobId, runIndex, runIndexSource, elapsedMs, timeoutMs, target, level, namespace, partial: { total, passed, failed, skipped, details }, hint }`. Counts appear ONLY under `partial` (clearly the drained-so-far subset — never a top-level `total` a consumer could mistake for a final count, the `2ca6c3f` under-report class). The `text` content leads with an unmistakable first line (e.g. `TEST RUN STILL EXECUTING — not finished, not failed. jobId=… runIndex=…. Do NOT re-submit.`) and `hint` names the re-attach routes: the Story 36.2 companion tool once it ships, and the route available TODAY in every preset — `iris_global_get` on `IRIS.TempAtelierAsyncQueue(<jobId>,"unittest","id")` for the run index, then `iris_sql_execute` against `%UnitTest_Result.TestInstance/TestCase/TestMethod/TestAssert` filtered by that `InstanceIndex` (never `MAX()`). `isError: false` follows the suite convention ratified at the Epic 35 retro (`35-6-CR-1`: partial/ongoing state lives in `structuredContent` without `isError`); the story's Dev Notes state this choice explicitly for review.
- **AC 36.1.4** - **`timeout` parameter (additive, E-1).** Optional positive number of SECONDS; explicit arg > operator env `IRIS_TEST_TIMEOUT` (seconds, parsed exactly like `IRIS_SQL_TIMEOUT` in `packages/shared/src/config.ts:155-169`, stored pre-converted) > default `120`. A documented hard upper cap (recommend `3600`) is clamped with an annotation in the response (the `IRIS_SQL_MAX_ROWS` `rowsCapped` precedent). The Zod description states plainly that MCP clients impose their own `tools/call` ceilings (TS SDK default 60 s; several clients 60 s–2 min, not all configurable) so a long synchronous wait may be abandoned upstream, and that the running result + re-attach is the robust route. Rule #59: prove the knob is NOT inert — `timeout: 1` against a slow class yields `status:"running"`; the default yields `status:"completed"` for a fast class; `IRIS_TEST_TIMEOUT` alone changes the observed budget.
- **AC 36.1.5** - **Handles on EVERY path.** The completed envelope gains additive `status: "completed"`, `jobId`, `runIndex`, `runIndexSource`; existing fields (`total`, `passed`, `failed`, `skipped`, `details`) stay byte-identical (Rule #19). `runIndex` capture strategy follows probe (a)/(b): read the queue node via the existing ExecuteMCPv2 `/global` GET route on each poll iteration until captured; if the run completed before capture (fast runs — the final poll kills the node), fall back to the `^UnitTest.Result` counter read BEFORE queueing vs AFTER completion — delta exactly 1 ⇒ `runIndex = after`, `runIndexSource: "counter"`; any other delta ⇒ `runIndex: null`, `runIndexSource: null` with a `runIndexNote` naming the ambiguity. NEVER derive it from `MAX(InstanceIndex)`. The zero-result guard envelope (`zeroResultGuardResponse`) also carries `jobId`/`runIndex` when known.
- **AC 36.1.6** - **Every early return carries `structuredContent`** — `no job ID` (`execute.ts:329-334`), the former `timed out` (now AC 36.1.3), and the `IrisApiError` catch — routed through ONE shared envelope helper so shapes cannot diverge (the `zeroResultGuardResponse` precedent). This closes ledger item **`34-6-CR-20` (b)** in full: disposition RESOLVED, ledger row updated with a Rule #51 mechanical recount.
- **AC 36.1.7** - **Tests.** Introduce a testability seam for the budget/clock (an injectable `now`/`sleep` or the first `vi.useFakeTimers` use in the repo — record which, and why) so the running branch is pinned WITHOUT burning wall-clock time. Pin the exact `running` envelope shape, the `timeout`/env/default precedence, the cap clamp, the counter-fallback for `runIndex` (delta 1 vs. delta >1 — both fakes must be shapes the real API returns, #54), and the shared-helper shape on all early returns. Rule #48/#59 mutation evidence: revert the running-result branch to the old terminal error → the pin goes RED; restore → GREEN. The three existing poll-loop tests (`execute.test.ts:1000/1044/1078`) pass UNCHANGED, and a `toEqual` pin of the pre-feature completed envelope minus the additive fields fails on any drift (Rule #19 mechanical proof).
- **AC 36.1.8** - **Live proof (#22/#26/#34) from the BUILT dist in a fresh Node process, on TWO genuinely different instances** — the default HSCUSTOM profile AND `ocupilot-iris` (the reporter's). Using a disposable `ExecuteMCPv2.Temp.*` test class with a deliberately slow method (`Hang`; delete before commit): `timeout: 5` ⇒ `status:"running"` with `jobId` and `runIndex`; `iris_global_get` on that `jobId`'s `"unittest","id"` node equals the reported `runIndex`; after the run finishes, `%UnitTest_Result.TestInstance` holds exactly that `InstanceIndex` with the expected duration (oracle from reality, #36) and NO second run was created; the SAME class with a sufficient budget ⇒ `status:"completed"` carrying the same handles. Mutation leg: with the fix reverted the same smoke reproduces the reporter's exact `Error: Test execution timed out`. Rule #59 statement names the guarded path for each leg (the tool layer over real HTTP — a curl below the TS layer does not count). Leave the instance at baseline; note in Dev Notes whether the smoke's own orphaned queue node was consumed or left (probe (c)).
- **AC 36.1.9** - **Docs (#43, self-documenting).** `iris_execute_tests`'s Zod `description` drops the "reliable execution" promise and states: the default budget, `timeout` + `IRIS_TEST_TIMEOUT`, the running contract and "do NOT re-submit", the re-attach routes, the client-ceiling caveat, and the concurrency caveat (same-class concurrent runs share instance fixtures AND Atelier predicts the run index before allocation — cross-attribution is possible). `packages/iris-dev-mcp/README.md` (table row `:215` + detail block `:1164-1200`), `tool_support.md:43`, and `CHANGELOG.md` updated; `packages/iris-mcp-all/README.md` checked with a recorded verdict (#56). `deployAndTestClass.ts` / `objectscriptReview.ts` prompts checked for test-execution guidance — if edited, `pnpm gen:skills` regenerates the skills (Rule #18) and `prompt-safety-invariants.test.ts` pins the wording. **Also** correct `iris_doc_compile`'s `async` description (`compile.ts:56-58`): it promises "a job ID for polling" that the tool does not return (`compile.ts:106-125`) — state what it actually returns. Run every documented example (35.5 lesson).
- **AC 36.1.10** - **Seam documented (Rule #52).** Dev Notes name exactly what Story 36.2 owns and 36.1 must NOT build: re-attach by `jobId` (`GET /work/{id}`), read-by-`runIndex` from `%UnitTest_Result`, `cancel` (`DELETE /work/{id}`), in-flight detection, and the `TOOL_PAIRS`/preset registration. 36.1's `hint` may reference the companion tool by name as forthcoming.
- **AC 36.1.11** - Gates: `pnpm turbo run build test lint type-check` green (per-package standalone runs acceptable per `35-1-DEV-1`, substitution recorded); `gen:governance-baseline:check` (`:check` ONLY) exit 0 at frozen `1e62c5ad5bf7`/141/201/60 (E-2); tool counts unmoved and no new action key (E-1, #31); `bootstrap-classes.ts` absent from the diff, `BOOTSTRAP_VERSION` stays `e1168c1ebe56`; changeset added (`@iris-mcp/dev` minor, `@iris-mcp/shared` patch — Lead decision L-3); Rule #35 count check on the OS suite unaffected (412 `Test*`).

### Story 36.2: `iris_test_status` Companion — Re-attach, Read-by-Run-Index, Cancel (seam owner)

**Backlog. Owns the seam named in AC 36.1.10; depends on 36.1's probes (c)–(f) — re-run any that is stale (#16).** This is the epic's ONLY new tool (Constraint E-3).

- **AC 36.2.1** - New tool `iris_test_status` on `@iris-mcp/dev` with `action: "poll" | "cancel"`, inputs `jobId?` (Atelier work id), `runIndex?` (`%UnitTest.Result` index), `namespace?`. Registration is complete in the SAME story: `mutates: "read"` for `poll`, `mutates: "write"` for `cancel` (default-DISABLED — no `defaultEnabled` marker; `annotations.destructiveHint` truthful); explicit disposition in BOTH `core` and `developer` in `presets.ts` per Lead decision L-2; `TOOL_PAIRS` decision recorded either way; `index.test.ts:23` and `presets.test.ts:56` pins 28→29; `iris-mcp-all` cross-server counts and annotation sweeps (#45) updated; `tool_support.md` row + per-server README entry stating BOTH default states mechanically from `mutates` (#30); the governance key derivation test confirms `iris_test_status:poll` / `iris_test_status:cancel` and that `iris_execute_tests` is untouched (E-1/E-2).
- **AC 36.2.2** - **`poll` semantics, grounded in the probes:** `jobId` for a finished-but-undrained job ⇒ the full completed envelope in EXACTLY 36.1's `status:"completed"` shape (and the queue node is consumed — documented as one-shot); `jobId` for a still-running job ⇒ 36.1's `status:"running"` shape (partial drain, handles); `jobId` unknown/already-drained WITH `runIndex` ⇒ completed envelope reconstructed from `%UnitTest_Result.*` by `InstanceIndex` (SQL path; identical shape; `runIndexSource:"result-table"`); `runIndex` whose `$D(^UnitTest.Result(idx))` is `10` ⇒ `status:"running"` with whatever `%UnitTest_Result` rows exist so far (in-flight detection is read-only; nothing is attached or consumed); neither handle ⇒ validation error. `MAX()` is never used anywhere.
- **AC 36.2.3** - **`cancel` semantics** follow probe (e) exactly — the story states what "cancelled" observably means on this instance (worker stopped / `%UnitTest_Result` row absent or partial) and returns that observation, never an assumed success. Governance-disabled by default; the live leg runs under an explicit `IRIS_GOVERNANCE` override and restores it.
- **AC 36.2.4** - **Live round-trip capstone (Rule #49 shape) in the DEFAULT suite (#21), armed like `epic35-defect-gate.test.ts`:** submit a disposable slow class via `iris_execute_tests` with `timeout: 5` ⇒ `running` + `jobId` + `runIndex` → `iris_test_status poll` by `jobId` while running ⇒ `running` → wait → `poll` ⇒ `completed`, whose `details` EQUAL the `%UnitTest_Result` SQL for that `InstanceIndex` (oracle from reality, #36) → the queue node is gone → `poll` by `runIndex` alone still returns the identical completed envelope (SQL path) → cancel leg on a second submission. Every leg is proven RED by breaking the thing it guards on the path it guards (Rule #59), with the path named. Second-instance smoke on `ocupilot-iris` (#34).
- **AC 36.2.5** - **Docs rollup for the epic (#43 enriches, never first-documents):** `iris_execute_tests`'s `hint` and description now name the shipped companion; README/`tool_support.md`/CHANGELOG; the `docs/bugs-2026-09-10.md` record gains a "Resolved in Epic 36" footer; `check-epics-sync.mjs` reports 0 unexpected absences / 0 orphans for epics 1–36.
- **AC 36.2.6** - Gates as AC 36.1.11, plus: `assertGovernanceClassification` and `assertPresetCoverage` pass at construction (they THROW on omission — a green construction is the proof); `gen:governance-baseline:check` exit 0 at the frozen hash (new keys are governed by `mutates`, never absorbed into the baseline — Rule #23); changeset (`@iris-mcp/dev` minor).

**Out of scope for Epic 36**: wiring the SDK `extra` argument (`signal`, `sendNotification`, `_meta.progressToken`) into `ToolContext` so long tool calls can emit `notifications/progress` — a `McpServerBase` change affecting all five servers, recorded as architecture note L1 and a ledger candidate, not a story; the InterSystems-side run-index prediction race (`%Api.Atelier.v8:730` vs `%UnitTest.Manager:2833`) — documented as a caveat only; the export tool's dead `ctx.signal`/`ctx.sendProgress` probes (`export.ts:200-214/484-491`) — ledger candidate; the npm publish (post-beta, Project Lead action).
```

### 4.2 — `sprint-status.yaml` — append after line 584 (`epic-35-retrospective: done`)

OLD (end of file, unchanged, for anchor):
```yaml
  35-9-doc-load-package-prefix-validation: done
  epic-35-retrospective: done
```

NEW (appended):
```yaml
  # Epic 36: Beta Feedback Remediation — long-running test execution fidelity
  # (trigger docs/bugs-2026-09-10.md, first beta-feedback defect;
  # sprint-change-proposal-2026-09-10-execute-tests-long-run.md).
  # iris_execute_tests converts its hard-coded 120s poll budget into a terminal
  # error while the %UnitTest run keeps executing; job id + run index discarded;
  # no timeout knob (ledger 34-6-CR-20(b) predicted it). 36.1 = running-result
  # contract + handles + caller budget (additive params/fields ONLY — no action
  # enum, E-1; pure TS, no BOOTSTRAP bump). 36.2 = iris_test_status companion
  # (the epic's ONLY new tool: mutates per action, both presets, L-2 decision;
  # counts +1). 36.0 RESERVED for the /epic-cycle retro-review gate (epic-35
  # retro exists; ledger carries 0H/26M/95L=121 open). Do NOT renumber.
  # Branch (L-1, 2026-09-10): cut feature/feature-wave-5-beta-feedback off main
  # (wave-4 merged 60be515); epic branch epic36 (ticketless convention — answer
  # the SC-1 prompt with this convention).
  epic-36: backlog
  36-0-epic-35-deferred-cleanup: backlog
  36-1-execute-tests-running-contract-and-handles: backlog
  36-2-test-status-companion-tool: backlog
  epic-36-retrospective: optional
```

### 4.3 — `prd.md`

**A. Functional Requirements — append after `- FR142`** (the current last FR):

```
- FR143: Developer can control the wait budget of a unit-test run (`iris_execute_tests` `timeout` parameter, operator default via `IRIS_TEST_TIMEOUT`) and, when a run outlives it, receives a distinct non-error "running" result carrying the run's correlation handles — the Atelier work-queue job id and the `%UnitTest.Result` run index — plus the partial results drained so far, instead of a terminal error; the same handles are returned on every completed run. (Epic 36, Story 36.1)
- FR144: Developer can re-attach to, read, or cancel a previously submitted unit-test run by its correlation handle through a companion read tool (`iris_test_status`: `poll` by job id or run index; `cancel`, write, default-disabled), so a run that outlived the caller's wait budget is never re-submitted to obtain its result. (Epic 36, Story 36.2)
```

**B. `### Reliability` NFR — insert after the `iris_doc_load` bullet (35.9), before the session-expiration bullet:**

```
- Tool operations that delegate to an asynchronous server-side job (e.g., `iris_execute_tests` over the Atelier work queue) must never report a still-running job as a terminal failure: expiry of the tool's own wait budget yields a distinct, non-error "running" result carrying the job's durable correlation handles, so the caller can re-attach rather than re-submit — a misleading failure is as harmful as a misleading success (Epic 36)
```

**Rationale:** mirrors the 35.9 "no misleading success" bullet with its "no misleading failure" twin; FR143/FR144 make the handles and the companion surface explicit requirements rather than implementation detail. FR39 is unchanged.

### 4.4 — `architecture.md` — new dated decision record after the K1 subsection (line ~481), before `## Implementation Patterns & Consistency Rules`

```markdown
### Long-Running Tool Calls Over Asynchronous Server Jobs (Epic 36 — added 2026-09-10)

Added via `sprint-change-proposal-2026-09-10-execute-tests-long-run.md`, triggered by `docs/bugs-2026-09-10.md` (the first beta-feedback defect). `iris_execute_tests` is the suite's only consumer of the Atelier asynchronous work queue (`POST /work` → `GET /work/{id}` until `Retry-After` disappears — each GET drains the results accumulated since the previous one). It wrapped that protocol in a synchronous tool call with a fixed 120 s client-side budget and, on expiry, discarded the job id and reported a terminal error while the server-side run continued — so the only move left to the caller (re-submitting) created concurrent runs against shared fixtures. Two facts make the correct shape unambiguous: the Atelier queue node and the `%UnitTest.Result` run index are DURABLE handles that outlive the caller (the node is killed only by a poll that observes completion), and MCP clients impose their own `tools/call` ceilings (TS SDK default 60 s; several clients 60 s–2 min, not all configurable), so no synchronous budget is safe on every client.

**L1 — A tool that fronts an asynchronous server-side job never converts its own wait budget into a terminal error; expiry yields a distinct non-error "running" result carrying the job's durable handles, and a companion read surface re-attaches by handle.** Concretely: (1) the tool's wait budget is a caller-controllable convenience (`timeout` param, operator env default), never the semantics of the call; (2) on expiry the tool returns `isError: false` with a top-level `status: "running"` discriminator, every handle it holds (job id, run index), and any partial results clearly labelled as partial — never a top-level count a consumer could mistake for a final one; (3) the same handles are returned on the completed path too, so correlation with server-side result tables never relies on `MAX()`-style "latest" heuristics; (4) re-attach/read/cancel live on a separate READ-classified companion tool (write actions such as cancel are separately classified and default-disabled), NOT as new `action`s on the original tool — an `action` enum added to a frozen-baseline tool renames its governance key and trips the one-directional drift test (Rule #23). *Rationale:* removes the incentive to re-submit (the actual damage vector), keeps the original tool's governance key stable, and works on every MCP client regardless of its ceiling. *Recorded, not decided:* `McpServerBase` currently discards the SDK's `extra` argument (`server-base.ts:1146-1149`), so `signal`/`sendNotification`/`_meta.progressToken` never reach `ToolContext`; wiring them would let long calls emit `notifications/progress` for clients that reset their timeout on progress. That is a base-class change across all five servers and is deferred until a client that honors it is a confirmed target. This is a single-pattern decision like K1 — recorded because it fixes the CONTRACT of an existing tool and defines the shape any future async-backed tool (compile, export, bulk operations) must follow.
```

### 4.5 — `_bmad/custom/branch-naming.yaml` — ACTIVE-branch comment block (comment-only; no schema field)

OLD:
```
# ── ACTIVE feature branch ────────────────────────────────────────────────────
#
# feature/feature-wave-4-classmethod-fidelity
#
# Two feature branches match feature_pattern, which would otherwise be an SC-7
# "multiple feature branches with similar names" stop. Epic 35 targets WAVE-4
# (Project Lead decision 2026-08-17): Epic 35 exists solely to make wave-4's
# content beta-ready, and wave-4 is the single branch intended to land on main
# afterward. wave-3 is closed. Branch epic35 off wave-4.
```

NEW:
```
# ── ACTIVE feature branch ────────────────────────────────────────────────────
#
# feature/feature-wave-5-beta-feedback
#
# wave-4 merged to main 2026-08-19 (60be515) and is closed; wave-3 is closed.
# Epic 36 (first beta-feedback epic) targets WAVE-5, cut off main (Project Lead
# decision L-1, 2026-09-10, sprint-change-proposal-2026-09-10-execute-tests-
# long-run.md). Three feature branches now match feature_pattern — this line
# resolves the SC-7 ambiguity: branch epic36 off wave-5.
```

Also append to the "Observed history" list: `#   feature/feature-wave-4-classmethod-fidelity   Epics 34-35  (merge 60be515)` replacing the existing wave-4 line (which names Epic 34 and merge `6fe1763` only).

### 4.6 — Bug record: move + addendum

- `mv bug-iris-execute-tests-timeout.md docs/bugs-2026-09-10.md` (the file is untracked, so `mv` + `git add`, not `git mv`). Content preserved byte-for-byte, then a section appended:

```markdown
## Analysis addendum (2026-09-10, correct-course session — Mary)

Confirmed by source reading and live probes; corrections to the report where noted.

- **Timeout precisely measured:** `TEST_POLL_TIMEOUT = 120_000` ms, `packages/iris-dev-mcp/src/tools/execute.ts:137`, unchanged since the `/work` rewrite. Evidence matches: run 242 started 15:56:36 → client error ≈15:58:36 → run 243 submitted 15:58:49.
- **`DateTime` is the FINISH time** (`%UnitTest.Result.TestInstance` class doc); the run index is allocated at START (`%UnitTest.Manager.%OnNew` → `ReserveResultId` → `$i(^UnitTest.Result)`). The "out of order" indices are therefore expected: start-ordered indices, finish-ordered timestamps.
- **No retry/fan-out exists** — confirmed (`http-client.ts:256-261`: one 401 re-auth retry only).
- **Correction — `iris_doc_compile` is not a model to mirror:** its `async` mode returns no job id and there is no poll companion (`compile.ts:106-125`); its description claiming otherwise is a doc bug fixed in Story 36.1.
- **Re-attach is possible:** the queue node survives abandonment (`%Api.Atelier.v8:PollAsync` kills it only on a poll that observes completion). 10 orphaned unittest jobs found on this instance (run indices 203, 215, 234, 242, 245, 248, 249, 250, 253, 256), all finished. Run index recoverable today: `iris_global_get IRIS.TempAtelierAsyncQueue(<jobId>,"unittest","id")` (job 31797604 → 256).
- **Ledger:** already predicted by `34-6-CR-20` (b) (LOW, open); raised to MEDIUM and closed by Story 36.1.
- **Concurrency caveat (InterSystems code, not fixed):** Atelier predicts the run index (`v8.cls:730`) before the Manager allocates it (`Manager.cls:2833`), unlocked — near-simultaneous submissions can cross-attribute results.
- **Disposition:** Epic 36 — Story 36.1 (running-result contract, handles, `timeout`), Story 36.2 (`iris_test_status` re-attach/read/cancel).
```

### 4.7 — Not changed at proposal time (by design)

- `deferred-work.md` — 36.0 triages (incl. the `34-6-CR-20` (b) severity raise) and 36.1 closes; Rule #51 recounts happen there.
- `docs/epic-summary.md` — the epic-cycle updates it at epic close.
- Code (`execute.ts`, `compile.ts`, `config.ts`, tests, READMEs, `tool_support.md`, `CHANGELOG.md`) — story work.

---

## 5. Implementation Handoff

**Scope classification: Moderate** — a new epic with backlog stories; PRD/architecture/epics/sprint-status/branch-naming edits; no MVP or architecture invalidation, no rollback.

- **Route to:** Product Owner / Scrum Master (accept Epic 36 and its three story keys into `sprint-status.yaml`; execute Lead decisions L-1/L-2/L-3), then Development via the normal `epic-cycle` / `bmad-create-story` → `bmad-dev-story` flow.
- **This correct-course session's own deliverable, upon approval:** apply §4.1–§4.6 exactly as shown; then create the Story 36.1 file (`_bmad-output/implementation-artifacts/36-1-execute-tests-running-contract-and-handles.md`) carrying this session's live probe results as its "Lead pre-story probe" section (the practice the Epic 35 retro credited for 35.5/35.9), so the dev agent starts from verified facts.
- **Success criteria:** the six artifacts updated exactly as shown; Epic 35's stories, gate, retro and `deferred-work.md` untouched; `sprint-status.yaml` gains exactly one epic block with three story keys + retro key; `check-epics-sync.mjs` reports 36.0/36.1/36.2 present on both sides; the bug record lives under `docs/` with its addendum.

---

## Appendix — Change Navigation Checklist (Step 2 record)

| # | Item | Status | Note |
|---|---|---|---|
| 1.1 | Triggering story | [N/A] | Beta-feedback defect, not a story; ledger precedent `34-6-CR-20` (b) |
| 1.2 | Problem statement | [x] | §1 |
| 1.3 | Evidence | [x] | §1 + `docs/bugs-2026-09-10.md` addendum; live probes on two instances |
| 2.1 | Current epic completable | [x] | Epic 35 closed; untouched |
| 2.2 | Epic-level changes | [x] | Add Epic 36 |
| 2.3 | Future epics | [x] | None affected |
| 2.4 | New epics needed | [x] | Epic 36 (this proposal) |
| 2.5 | Resequencing | [x] | None; first post-beta epic |
| 3.1 | PRD conflicts | [x] | FR143/FR144 + Reliability bullet (§4.3) |
| 3.2 | Architecture conflicts | [x] | L1 decision record (§4.4); `extra`-dropping noted, not decided |
| 3.3 | UI/UX | [N/A] | Backend suite |
| 3.4 | Other artifacts | [x] | sprint-status, branch-naming, bug record; no CI/deploy |
| 4.1 | Direct Adjustment | [x] Viable | Effort Low-Med / Med; Risk Low / Med — SELECTED |
| 4.2 | Rollback | [ ] Not viable | Nothing to revert; `2ca6c3f` stays |
| 4.3 | MVP Review | [ ] Not viable | FR39 stands |
| 4.4 | Path selected | [x] | Option 1 |
| 5.1–5.5 | Proposal components | [x] | §1–§5 |
| 6.1–6.2 | Review | [x] | This document |
| 6.3 | Explicit approval | [!] | Pending — Project Lead |
| 6.4 | `sprint-status.yaml` | [!] | §4.2, applied on approval |
| 6.5 | Handoff confirmed | [!] | §5, on approval |
