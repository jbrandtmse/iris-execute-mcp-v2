---
title: 'Story 40.1: Line Coverage Probe and Engine'
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_revision: 'e8720c73dba174bab820680b3b014072488fd770'
baseline_commit: '966f6ee65f72f01435007cf4018a512fabd0e5ff'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
warnings:
  - oversized
deferred:
  - summary: >-
      The runner reads the line counts right after RunTest with no readiness check, so a suite fast enough to finish
      before the monitor's short start-up delay could read zero counts and report 0% as a complete result.
    evidence: |-
      Claim from reading only (first review pass, Blind). Every gate run, including the 4-test oracle suite of about
      1 s, reads the right counts, and ResultExecute returns zero rows without an error when a routine name is not
      found, so a premature read would be silent. Would be medium. A probe that starts a session and reads the same
      process's counts at once would settle it.
    location: >-
      src/ExecuteMCPv2/Coverage/Runner.cls:ReadCounts
    severity: medium (unverified)
  - summary: >-
      The Status route builds one nested pair per counted line and per command line of the whole run and returns it
      on every read of a terminal run, and the 200,000-line cap and the 20-run retention were sized from the
      SyntaxColor and Result timings, not measured on the Status path.
    evidence: |-
      Claim from reading only (resumed review pass, Blind). The gate fixture has 48 lines. A run at the cap could build
      millions of dynamic-object nodes per poll and keep up to 20 such records in IRISTEMP. Would be medium. Measuring
      the Status call (time, response bytes, process memory) for a routine of about 200,000 lines would settle it.
    location: >-
      src/ExecuteMCPv2/REST/Coverage.cls:BuildRoutines
    severity: medium (unverified)
  - summary: >-
      ExecuteMCPv2.REST.UnitTest:BuildTestSpec joins the classes of a package as ":A;:B", which RunTest reads as class A
      with a method named B, so POST /tests with level package runs no test.
    evidence: |-
      Found by the verification-gap review of this story and captured live: a package run of Story401 through the
      coverage tool reported 0 tests until REST.Coverage.TestSpec rewrote the spec as ":A;B" (then 5 tests ran). No MCP
      tool calls POST /tests (its class comment now says so), and the existing UnitTestTest pins only the string
      shape, so the defect is pre-existing and was not fixed in BuildTestSpec itself, which the Boundaries keep unchanged.
    location: >-
      src/ExecuteMCPv2/REST/UnitTest.cls:BuildTestSpec
    severity: low
---

<intent-contract>

## Intent

**Problem:** A developer can run `%UnitTest` tests but cannot see which lines they execute. `%Monitor.System.LineByLine` is one monitor for the whole instance, which other projects share, and neither existing way of running tests can own it. The plan-stage probes (Design Notes) show three things. A session counts only the process that called `Start`. The Atelier work queue runs tests in a worker process that the suite cannot instrument. `POST /tests` runs inside a single HTTP request.

**Approach:** Add `iris_test_coverage`, a new governed tool that is `write` and disabled by default. It starts a coverage run on a new custom route family. IRIS-side, a supervisor job launches a runner process. The runner starts a session scoped to itself, runs the tests, records each line's count and stops its own session. The supervisor enforces cancel and a time limit, and releases any session the runner left behind. TypeScript decides which INT lines are executable, from a token skeleton IRIS records for each line, and returns per-routine coverage. A run that outlives the wait budget follows AD-16: the tool returns `status:"running"`, and the caller re-attaches through `iris_test_status` with the new `coverageRunId`.

## Boundaries & Constraints

**Always:**

- **Routes (AD-11, AD-33: additive only).** `Dispatch.cls` gains three routes in its `/dev` group, all handled by the new `ExecuteMCPv2.REST.Coverage` (extends `REST.Base`):
  - `POST /dev/test/coverage` → `Start`;
  - `GET /dev/test/coverage` → `Status` (query `id`);
  - `POST /dev/test/coverage/cancel` → `Cancel` (body `{id}`).

  Every existing route stays byte-identical.
- **New bootstrapped classes (AD-14, Rules #24/#39).**
  - `ExecuteMCPv2.Coverage.Job`, a library: the supervisor, the run record, routine resolution, the busy decision and the token skeleton.
  - `ExecuteMCPv2.Coverage.Runner Extends %UnitTest.Manager`: the runner entry point, the `OnBeforeAllTests` override and the count read.
  - `ExecuteMCPv2.REST.Coverage`.

  Both libraries go after the `Loc.*` entries in `classes[]`, and the handler goes before `REST/Dispatch`, which stays last. Run `pnpm gen:bootstrap` once and record `BOOTSTRAP_VERSION` `08b8adeaadc6` → new in this story's CHANGELOG section. The bootstrap count goes from 32 to 35.
- **The `Start` request.** The body is `target` (required), `level` (`package|class|method`, required), `classes` (1 to 50 valid class names, de-duplicated, order kept), `namespace` (optional), `maxSeconds` (integer 1 to 3600, required) and `maxLines` (integer ≥ 1, required). TypeScript always sends `maxSeconds: 3600` and `maxLines: 200000` (Rule #10).
  - Validation runs before the namespace switch (AD-13).
  - Every error goes through `SanitizeError`, and there is one render (AD-11, Rule #7).
- **Work in the target namespace.**
  - The test spec is `##class(ExecuteMCPv2.REST.UnitTest).BuildTestSpec(target, level)`, unchanged.
  - `^UnitTestRoot` is ensured through `##class(ExecuteMCPv2.Setup).EnsureUnitTestRoot()`, the step `iris_execute_tests` already takes.
  - **Routine resolution.** For each class, take n = 1 … `$$$comClassKeyGet(<class>,$$$cCLASSroutinecount)` and the routine `$$$nameClassRoutineNameGet(<class>,n)` (`%occName.inc`; it is `$ZU(135,23,<class>)_"."_n`). A routine counts only if it has object code (`^rOBJ`) and kept INT source (`^ROUTINE(<rtn>,0,0)`). The `.0` method-generator routine is never measured.
  - **Unmeasured classes.** A class is reported in `unmeasured` with one of three reasons: `not-compiled`; `no-routines` (no `.n` routine with object code); or `no-int-source` (a routine lacks kept source).
  - **Before any session starts:** more than `maxLines` measured INT lines in total, or no measured routine at all, is an error, and nothing is started.
- **The busy check and launch are atomic, IRIS-side (AD-12, AD-27).**
  - **The start lock.** They run under `Lock +^IRIS.TempExecuteMCPv2Coverage("start"):15`, which is released on every path. A lock timeout is the `busy-suite` outcome, with no run fields.
  - **Monitor state.** `$ZU(84,8)` is read only inside a single helper, `MonitorActive()`; it is the same test `%Monitor.System.LineByLine.Start` uses. The active routine list comes from `GetRoutineCount()` and `GetRoutineName(n)`.
  - **The decision.** `ExecuteMCPv2.Coverage.Job.BusyDecision(...)` is a pure function implementing the decision table (matrix rows 9 to 11).
  - **The reclaim identity proof (decision #46).** A new request process is not in the session's process list, so it cannot read the routine names. Its `pListMatches` is true only when all of these hold:
    - the `("session")` node exists;
    - both owner locks of that run are free;
    - the active session's process list holds only the run's scoped processes that are still alive, in the order IRIS reports them (ascending PID), or `0` when none is alive: so one or two entries, each the record's `runnerPid`, its `pid` or `0`, with no repeat (lead amendment 2026-10-17, from the live capture in the resumed implement pass; with both owner locks free this reads `0`);
    - the active routine count equals the record's routine count.

    Otherwise the session is foreign: refused and left alone. The residual case is a foreign session whose listed processes have all ended, with the same routine count, started after the suite's own session was stopped by someone else. It is recorded under Design Notes: no live process can read such a session's data, so stopping it loses nothing anyone can read.
  - **Run ids.** Only a decision that proceeds (`proceed`, `reclaim` or `clear-and-proceed`) allocates a run id (`$Increment`).
  - **Validation.** Request validation is one class method, `ExecuteMCPv2.REST.Coverage.ValidateStart(pBody, .pParams) As %Status`. The handler and `CoverageJobTest` share it.
  - **Launch.** The handler JOBs `##class(ExecuteMCPv2.Coverage.Job).Supervise(id)` from the home namespace; a JOB that does not start within 10 s marks the record `failed`. The handler then waits up to 15 s for the record to leave `starting`, and returns `{outcome:"started", …}`, `{outcome:"busy", owner:"suite"|"foreign", …}` or `{outcome:"failed", error}`. A run still `starting` after the wait is returned as started and is then polled.
- **The run record.** It lives in `^IRIS.TempExecuteMCPv2Coverage`, which is IRISTEMP: instance-wide and visible from a freshly created namespace (probe).
  - **The `("session")` node** exists while a suite session may be active. Its value is `$ListBuild(coverageRunId, pid, runnerPid, startedAt, $ListBuild(<routine>, …))`, where `pid` is the supervisor's and `startedAt` is UTC ISO 8601 with `Z`, taken from `$ZTimeStamp`.
  - **Liveness.** The supervisor holds `("owner",id,"supervisor")` and the runner holds `("owner",id,"runner")` for their whole lives. IRIS releases a dead process's lock (probe). A lock that can be taken with timeout 0 is dead, and is released at once.
  - **Retention.** At most 20 run records are kept. A start prunes the oldest terminal records, and never a non-terminal record whose supervisor is alive.
- **Supervisor (`Job.Supervise`).**
  - **Start-up.** It holds its owner lock, JOBs `##class(ExecuteMCPv2.Coverage.Runner).Run(id)`, and sets status `running` once the runner reports its session started. If the runner's `Start` failed, it sets `failed` with that error.
  - **Watching.** It then checks at least every 100 ms that the runner is alive, the cancel flag, and elapsed time against `maxSeconds`.
  - **Cancel or time limit.** It calls `$SYSTEM.Process.Terminate(runnerPid)`, waits for the runner to exit, and sets status `cancelled` with reason `cancel` or `time-limit`.
  - **Process identity before any `Terminate` (decision #41).** A PID can be reused once its process dies, and this is a shared instance. So every `Terminate` call site, here and in the gate fixture's `TerminateCoverageProcess`, calls `ExecuteMCPv2.Coverage.Job.MayTerminate(pId, pRole, pPid) As %Boolean` immediately before it and terminates only when it is true.
    - It is true only when `pPid` equals the record's PID for `pRole` (`supervisor` or `runner`) and that role's owner lock `("owner",id,pRole)` cannot be taken with timeout 0, so the process holding it is still the suite's own.
    - When it is false, nothing is terminated. The runner is already gone, so the flow continues as if it had exited.
  - **Release.** Once the runner has gone, the supervisor reads the counts and stops the session itself (`releasedBy: "supervisor"`) only when all three hold:
    - the record shows the runner started the session and did not release it;
    - `MonitorActive()` is true;
    - the active routine list equals this run's list. The supervisor is in the session's process list, so it can read the names (decision #46); it keeps this full proof.

    Otherwise it stops nothing.
  - **A completed run that lost its counts or its release (decision #48).** Neither case may be silent.
    - If the counts could not be read (by the runner, or by the supervisor after the runner died), the terminal status is `failed` with `reason: "counts-unreadable"` and the IRIS text in `error`.
    - If the session could not be stopped, the terminal status is `failed` with `reason: "release-failed"`, and `error` says that a suite-owned Line-by-Line session is still active and that the next coverage run reclaims it.
    - In both cases the result is `isError:true` and still carries the test summary and any coverage that was read. `readError` is returned by `Status`, never only stored.
  - **Finishing.** After the session is released, it builds the token skeleton of every measured routine. It then writes the terminal status, kills `("session")`, releases its lock and halts.
  - **A runner that ended early.** If the runner ended before RunTest returned and no cancel or time limit applied, the status is `failed` with the error `The test process ended before the tests finished.`
- **Runner (`Runner.Run`).**
  - **Its session.** It holds its owner lock, switches to the target namespace, and calls `##class(%Monitor.System.LineByLine).Start(<routines>, $ListBuild("RtnLine"), $ListBuild($JOB, <supervisor pid>))`. This is the only `Start` in the suite.
    - **Why two processes (decision #45).** Only a process in a session's list can read its routine names and line counts (re-proved live in the implement stage: with `$ListBuild($JOB)` alone the supervisor cannot read a killed runner's counts, and 7 of 13 gate rows go red). So the list is exactly the runner and its own supervisor: two suite-owned processes, never all processes and never another project's. The supervisor runs only `ExecuteMCPv2.Coverage.*` code, so its lines are counted only if a caller lists those classes.
    - On an error it records the IRIS text and exits WITHOUT `Stop`.
    - On success it writes `("session")` and `started`.
  - **The tests.** It runs `..RunTest(<spec>, "/noload/nodelete/norecursive", .tUser)` with `tUser("ExecuteMCPv2CoverageRun") = id`. Its `OnBeforeAllTests` override records `manager.ResultId` as the run's `runIndex` before any test runs (probe).
  - **Afterwards, always, catch path included,** but only once it has proved that the active session is still its own: process-scoped, listing exactly its supervisor and itself, with this run's routine names (review HIGH 1, made complete in rework iteration 1). Without that proof it reads and stops nothing, and the supervisor's `Finish` reports what it finds. With it:
    - it reads the `RtnLine` count of every line of every routine through the `%Monitor.System.LineByLine:Result` query. Row n is INT line n, and a routine that never ran returns no rows, so every count is 0 (probe);
    - it records the counts, or, when reading them fails, records that error as `readError` and never marks the counts as read (decision #48);
    - it calls `Stop` and records `released`.
  - **One releaser at a time.** The runner's release and the supervisor's release in `Finish` both run under one suite lock, `^IRIS.TempExecuteMCPv2Coverage("owner",id,"release")`, and re-read `sessionReleased` and `hasCounts` under it. Each holds `^%SYS("MON-HOLD")` (with a timeout) from its identity check through `Stop`, so no other `Start` or `Stop` can land in between. A timeout stops nothing; the supervisor then reports `release-failed`.
  - **No cancel handling.** The runner never reads the cancel flag.
- **The token skeleton is raw data (AD-12).**
  - **Tokens.** For each INT line, `%Library.SyntaxColorReader.FromCode(<INT source>, "INT", "A", .tReader)` gives the line's tokens in order. A `Label` token becomes `L`, a `Command` token `C:<text in lower case>`, and a `Brace` token `{` or `}`. Every other token is dropped, and the rest are joined with single spaces.
  - **Lines without a command** are left out entirely. IRIS classifies nothing.
- **The `Status` route.**
  - **Result.** `{coverageRunId, status, namespace, target, level, pid, runnerPid, startedAt, finishedAt, runIndex, reason?, error?, releasedBy?, cancelRequested, supervisorAlive, runnerAlive, unmeasured, reclaimed?, routines?}`. `releasedBy` is `runner` or `supervisor`.
  - **`routines`** is present only on a terminal record that has counts. Each entry is `{class, routine, lines, hits:[[line,count]…] (count>0 only), skeleton:[[line,"…"]…]}`.
  - **Status values.** `status` is the recorded `starting|running|completed|cancelled|failed|abandoned`. A non-terminal record whose supervisor and runner are both dead is reported as `abandoned`; this is an observation only, and the record is not changed.
  - **Unknown ids.** An unknown id is an error: `Coverage run <id> was not found. Only the 20 most recent runs are kept, and runs do not survive an instance restart.`
  - It never starts, stops or terminates anything.
- **The `Cancel` route** sets the cancel flag on a non-terminal record, then returns the record. It never terminates or stops anything (AD-27: a cancel only signals the job).
- **`POST /tests` (AC 40.1.2, DW-453).** The class doc comment of `UnitTest.cls` says that no MCP tool calls this route, and names the paths the tools use instead. The `RunTests` code is byte-identical.
- **The `iris_test_coverage` tool definition** (new file `packages/iris-dev-mcp/src/tools/test-coverage.ts`):
  - **Basics.** Title `Test Coverage`; `scope:"NS"`; `mutates:"write"`, with no `defaultEnabled` and no `parent`.
  - **Annotations.** `{readOnlyHint:false, destructiveHint:true, idempotentHint:false, openWorldHint:false}`. It prunes its own older run records and runs test code.
  - **Input.** `target` (string), `level` (`package|class|method`, both mirroring `iris_execute_tests`), `classes` (an array of 1 to 50 class names, no wildcards), `timeout?` (seconds, through `resolveTestTimeout`: `IRIS_TEST_TIMEOUT`, 120 s default, a 3600 s cap and `timeoutCapped`) and `namespace?`.
- **The `iris_test_coverage` description** leads with what the tool does, when to use it and what it returns. It then states:
  - the default state, DEFAULT-DISABLED, with the recipe `IRIS_GOVERNANCE={"global":{"iris_test_coverage":true}}`;
  - the operator control `IRIS_TEST_TIMEOUT`;
  - the shared-instance guard: one run at a time instance-wide, and a refusal with `MONITOR_BUSY` while any Line-by-Line or PERFMON session runs;
  - that only the process running the tests is measured, so code in processes the tests start is not counted;
  - INT-line coverage of the listed classes' routines;
  - re-attach through `iris_test_status` with `coverageRunId`, and never re-submit.

  It never names a REST path.
- **Handler flow (`createTestCoverageHandler(clock)`, reusing `TestClock`).**
  1. Resolve the namespace and the budget.
  2. POST `Start`.
  3. Map `busy` to `refusalResult(REFUSAL_CODES.MONITOR_BUSY, text, {owner, …})` (matrix rows 10 and 11), and `failed` to `isError:true`.
  4. Poll `Status` every `TEST_POLL_INTERVAL` until the run is terminal or the budget is spent.
  5. Build the result with `coverageRunEnvelope`.
- **Coverage arithmetic and the executable rule (TypeScript, exported pure functions).**
  - **`isExecutableSkeleton(skel)`** applies the table in Design Notes. A line with no skeleton is not executable.
  - **Covered lines** are the executable lines with a count above 0.
  - **Counted but not executable.** A line the monitor counts that the rule does not call executable, such as a loop's closing `}`, is ignored.
  - **`percent`** is `round(covered / executable × 10000) / 100`, or `null` when there are no executable lines.
  - **Line lists** are inclusive `[start, end]` ranges, in ascending order.
- **Result shapes** (`coverageRunEnvelope`; Design Notes). The test summary comes from `%UnitTest_Result` by `runIndex`, in the run's namespace, through the SQL helpers moved into `unit-test-results.ts`:
  - completed: `buildCompletedSummaryFromSql`;
  - other statuses: `buildInterimPartialFromSql`;
  - no `runIndex`: zeros.

  `iris_execute_tests`' zero-result rule applies: a completed run in which no test method ran is `isError:true`, with the class-level reason in `error`, and its coverage is still included.
- **Companion (AD-16).** `iris_test_status` gains an optional `coverageRunId` (all digits). With it:
  - `poll` reads `Status` once and returns the same envelopes;
  - `cancel` POSTs `Cancel`, then reads `Status` up to 10 times, 500 ms apart, and reports what it observed.
  - `coverageRunId` combined with `jobId` or `runIndex` is a validation error. So is a `namespace` that differs from the record's: the error names both namespaces.

  Its keys and `mutates` are unchanged. Its description gains one sentence about coverage runs.
- **Governance and visibility (AD-4, AD-7, Rules #28/#53).**
  - The key `iris_test_coverage` is classified `write`, is disabled by default, and is not in the frozen baseline.
  - `presets.ts`: `core` excludes it (core stays at 14 package / 15 runtime tools); `developer` includes it (32 package tools).
  - `TOOL_PAIRS` gains `["iris_test_coverage", "iris_test_status"]`; no `core` row moves.
  - `REFUSAL_CODES` gains `MONITOR_BUSY`, used only through `REFUSAL_CODES.MONITOR_BUSY`.
  - `data-policy-scope.ts` gains a `residual` row with the same wording as its two siblings.
- **Counts that move.**
  - dev: 31 → 32 package tools, 32 → 33 advertised;
  - suite: 109 → 110 package tools, 114 → 115 advertised;
  - prompts: 13, unchanged.

  Every doc and test that pins an old count moves (Code Map list). The tools-list snapshot is regenerated with `--force` and named in the CHANGELOG (decision #29).
- **The shared instance.** Oracles come only from `EXECMCPTMP401A` and `EXECMCPTMP401B` (no interop, created and removed by the gate).
  - Only the iris-mcp-all live gate starts Line-by-Line sessions in this story; that package runs its files serially. No dev-package test and no OS test class starts a session, because dev runs its files in parallel.
  - The gate starts every row with the monitor idle. If a foreign session is active when it starts, an armed gate fails and names that session, which it leaves alone; an unarmed gate skips.
- **Text.** Source is ASCII, with escapes (Rule 14). Comments state the contract. Every live call names its target with `server:"default"` and the `IRIS_*` variables.

**Never:**

- **Foreign sessions.** Never stop, pause, clear or reconfigure a session the suite did not start: refuse and leave it.
- **No monitor control from the client side.** TypeScript never calls a monitor API, and the `Status` and `Cancel` routes never call `Start`, `Stop` or `Terminate` (AD-27).
- **Process scope.** No `Process` list other than `$ListBuild(<runner $JOB>, <its own supervisor's pid>)` (decision #45); never all processes and never another process. The single test-only exception is decision #49: the gate fixture's `StartForeignAll` starts an all-processes session to stand in for a foreign one. It does so only on a disposable `Story401` or `ExecuteMCPv2.Temp.*` routine that nobody else runs, only with the monitor idle, and stops it in that row's own cleanup, with the monitor idle afterwards.
- **No unproven `Terminate`.** Never call `$SYSTEM.Process.Terminate` on a PID unless `MayTerminate` returned true for it immediately before. An OS test pins `MayTerminate` false for a free owner lock and for a PID that differs from the record's; it never terminates anything.
- **Monitor calls.** No `Pause`, `Resume` or `Clear`, and no `$ZU(84,…)` call outside `MonitorActive()`.
- **`iris_execute_tests`.** No change to `iris_execute_tests`: no `action`, parameter, behavior or annotation (it is a frozen key; DW-498 belongs to 40.4).
- **40.2's scope.** No class-source mapping, no per-class or per-method aggregation, no Cobertura and no `minCoverage`.
- **Other files.** No change to the `RunTests` code; no edit to `ipm/module.xml` (stale since Story 7.3, and generated in 42.4); no production start; no `EnableNamespace`.
- **Generated files.** No hand edit of generated files; run only the governance `:check`.
- **Release.** No `changeset version` and no publish.

## I/O & Edge-Case Matrix

The oracle values come from the plan-stage probe (Design Notes); the implement stage re-captures them on the exact gate fixture (Rule #36). "Idle after" means `MonitorActive()` is 0 once the call has returned. Rows 3 and 5 to 13 use `classes:["Story401.Fixture"]`, `namespace:"EXECMCPTMP401A"` and, where a slow run is named, `target:"Story401.SlowTest"` with `level:"class"` and `^Story401Hang` set in A to the stated seconds, unless the row says otherwise.

| # | Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|---|
| 1 | Oracle run (AC 40.1.5) | `{target:"Story401.FixtureTest", level:"class", classes:["Story401.Fixture","Story401.Missing"], namespace:"EXECMCPTMP401A"}`, key enabled | `status:"completed"`; 4 tests, 4 passed. `coverage.complete:true`, and `coverage.classes[0].routines[0]` is `{routine:"Story401.Fixture.1", lines:48, executableLines:28, coveredLines:20, percent:71.43, executableRanges:[[6,10],[12,12],[14,14],[16,18],[20,20],[22,23],[25,25],[27,27],[29,29],[31,33],[36,38],[40,42],[44,44],[47,48]], coveredRanges:[[6,7],[9,10],[12,12],[14,14],[20,20],[22,22],[25,25],[29,29],[31,33],[36,38],[40,42],[44,44]]}`. `unmeasured:[{class:"Story401.Missing", reason:"not-compiled"}]`. Idle after. | None |
| 2 | Not-configured namespace (Rules #34, #41) | Same call with `namespace:"EXECMCPTMP401B"` (no `Story401` classes) | `isError:true`: no measured routine; nothing started, and no run id allocated | Error text names the namespace |
| 3 | Line cap (route guard) | Raw `POST /dev/test/coverage` with `target:"Story401.FixtureTest"`, `level:"class"`, `maxSeconds:3600`, `maxLines:10` | Error; nothing started | `Coverage of 48 INT lines exceeds the limit of 10. …` |
| 4 | Bad input | `classes:[]`, 51 classes, a bad `level` (zod); raw route `maxSeconds:0` | Validation error; nothing started | Clear error |
| 5 | Budget expiry (AD-16) | `Story401.SlowTest` (hang 3 s), `timeout:1` | `isError:false`, `status:"running"`, with `coverageRunId`, `pid`, `runnerPid`, `runIndex` (or null), `partial`, and a `hint` naming `iris_test_status`. The run then completes: `coveredLines:4`, `percent:14.29`, `coveredRanges:[[40,42],[44,44]]`. Idle after. | None |
| 6 | Companion reproduces the result | Row 5's `coverageRunId` via `iris_test_status {action:"poll", coverageRunId}` until completed, then once more; and one poll of row 1's `coverageRunId`. Every poll goes through the session's `raw` call, so no `namespace` is sent: the handle alone is enough. | Row 5's completed poll carries row 5's coverage values (`coveredLines:4`, `percent:14.29`, `coveredRanges:[[40,42],[44,44]]`, 1 test passed), and the second poll deep-equals the first. The poll of row 1's run deep-equals row 1's own `structuredContent`. | None |
| 7 | Cancel mid-run (killed mid-flight) | SlowTest hang 20 s, then `iris_test_status {action:"cancel", coverageRunId}` (key enabled) | Observed `status:"cancelled"`, `reason:"cancel"`, `coverage.complete:false`, with the SumTo lines covered (counts survive the runner's death; probe). Idle after. | None |
| 8 | Runner killed from outside | SlowTest hang 20 s; the gate terminates `runnerPid` | Poll: `status:"failed"`, `error:"The test process ended before the tests finished."`, `coverage.complete:false`. The raw `Status` route shows `releasedBy:"supervisor"`. Idle after. | `isError:true` |
| 9 | Both processes killed, then reclaimed | SlowTest hang 20 s; the gate terminates `pid` (the supervisor) and then the runner (decision #47: in the other order the supervisor's 100 ms watch releases the session before the second kill) | The session stays active (probe: termination is not trappable). Poll: `status:"abandoned"`. The next row-1 call completes with `reclaimed:{coverageRunId:<old>, pid:<old>}`. Idle after. | None |
| 10 | Foreign session active | The fixture starts a session on `ExecuteMCPv2.Temp.Story391Fixture.1`, in its own process | `MONITOR_BUSY`, `owner:"foreign"`, `isError:true`. The session is still active with the same routine list. The next started run's `coverageRunId` is the previous one + 1, so none was allocated. | Text says nothing was started and the session was left untouched |
| 11 | Suite run active | A second call while row 7's run is running | `MONITOR_BUSY`, `owner:"suite"`, with the running run's `coverageRunId`, `pid`, `startedAt` and `namespace`. The running run is unaffected. | Text names `iris_test_status` poll |
| 12 | Foreign `Start` wins the race | The runner's `Start` returns `ERROR #6062` | `status:"failed"` with that text; no `Stop` is called and nothing is changed | `isError:true` (unit tests plus review; it cannot be timed live) |
| 13 | Time limit (route guard) | Raw `Start` with `maxSeconds:2`, hang 20 s | Status `cancelled`, reason `time-limit`. Idle after. | None |
| 14 | Default governance | Plain session, no override | `GOVERNANCE_DISABLED` refusal; no route is called | Refusal |
| 15 | Old `iris_test_status` calls | Every existing `jobId`/`runIndex` call | Byte-identical to today (the existing tests, unchanged) | Unchanged |
| 16 | Bad companion arguments | `coverageRunId` with `jobId`; an unknown id; a namespace other than the record's | Validation error; not-found error; namespace error naming both namespaces | `isError:true` |

</intent-contract>

## Code Map

**Probe facts the implementation depends on.** These are in Design Notes, and each one is load-bearing.

**IRIS side: new classes**
- `src/ExecuteMCPv2/Coverage/Job.cls`, `src/ExecuteMCPv2/Coverage/Runner.cls`, `src/ExecuteMCPv2/REST/Coverage.cls`.
- Templates:
  - `REST/Sql.cls`: a `/dev` handler that returns an `outcome` field which TypeScript maps to refusals;
  - `REST/Monitor.cls:1053`: `%SYS.ProcessQuery` in `%SYS`; liveness here uses locks instead;
  - `Setup.cls:200`: `EnsureUnitTestRoot`;
  - `REST/UnitTest.cls:164`: `BuildTestSpec`, called and never copied.
- System source:
  - `irislib/%Monitor/System/LineByLine.cls`: `Start` :38, `Stop` :165, `GetRoutineCount` :144, `GetRoutineName` :153, `Result` :329;
  - `irislib/%UnitTest/Manager.cls`: `RunTest` :386, `realRunTestSuites` :489 (`..%New()` builds the subclass; `OnBeforeAllTests` is called at :610), `ResultId` :231 (reserved in `%OnNew`, :1822);
  - `irislib/%Library/SyntaxColorReader.cls`: `FromCode` :39, `NextLine` :101;
  - `irislib/%Library/RoutineMgr.cls`: `getRoutinesFromClass` :955, which skips `.0`;
  - `irislib/%occKeyword.inc`: `cCLASSroutinecount` 49, `cCLASSroutines` 50;
  - `irislib/%SYSTEM/Process.cls`: `Terminate` :1755.
- `src/ExecuteMCPv2/REST/Dispatch.cls`: the `/dev` group is at :178-188; `/tests` is at :31.
- `src/ExecuteMCPv2/REST/UnitTest.cls`: the class doc comment is at :1-12; the DW-453 site at :75-100 is not edited.

**IRIS side: tests**
- New `src/ExecuteMCPv2/Tests/CoverageJobTest.cls` (`%UnitTest.TestCase`, ≤ 500 lines) and the fixture `src/ExecuteMCPv2/Tests/CoverageFixture.cls`. The fixture is test-only and stays out of the bootstrap. Its body is the same as `Story401.Fixture`.
- Template for the shape and the `^UnitTestRoot` guard: `Tests/UnitTestTest.cls`.
- No test starts a session.

**Bootstrap**
- `scripts/gen-bootstrap.mjs` `classes[]` is at :14-47 (`Dispatch` is last, at :46).
- `packages/shared/src/__tests__/bootstrap.test.ts`:
  - the counts `toBe(32)` at :1027 and :1092;
  - `expected` at :1031-1064;
  - the list of classes that extend Base at :1131-1150;
  - `classPaths` at :1264-1297.
- `packages/shared/src/bootstrap-classes.ts` is generated; `BOOTSTRAP_VERSION` is at :25.
- `changelog-bootstrap-move.test.ts` reads this story's CHANGELOG move.

**TypeScript: dev**
- `packages/iris-dev-mcp/src/tools/execute.ts`:
  - export `TestClock` (:150), `realClock`, `TEST_POLL_INTERVAL` (:164) and `resolveTestTimeout` (:337), with no behavior change;
  - reuse the types `PartialSnapshot` and `TestDetail` (:546-555);
  - `testRunEnvelope` (:646) is the sibling to `coverageRunEnvelope`;
  - `BASE_URL` is at :23.
- `packages/iris-dev-mcp/src/tools/test-status.ts`:
  - move `runSqlQuery` :100, `METHOD_JOIN`/`METHOD_ORDER`/`STATUS_MAP` :115-125, `str` :127, `secondsToDrainMilliseconds` :138, `readTestInstanceStatus` :145, `buildCompletedSummaryFromSql` :168, `readClassLevelErrors` :234 and `buildInterimPartialFromSql` :289 into the new `unit-test-results.ts`, verbatim and exported, and import them back;
  - the schema and description are at :692-790; the handler is at :779.
- `packages/iris-dev-mcp/src/tools/index.ts:48-80`: append `testCoverageTool` last.
- `packages/iris-dev-mcp/src/tools/presets.ts`: the banner at :9-32; `core` exclude :58-76; `developer` include :79-111.
- Dev tests:
  - `src/__tests__/index.test.ts` :23 (31), :25-61, :84 (32), :93-129;
  - `src/__tests__/presets.test.ts` :54-61;
  - `test-status.test.ts` and `test-status-governance.test.ts`, both unchanged and green.

**TypeScript: shared**
- `packages/shared/src/refusals.ts:15-32`, with `__tests__/refusals.test.ts:45-57`.
- `packages/shared/src/tool-visibility.ts:317` (`TOOL_PAIRS`) and its doc comment, with `__tests__/tool-visibility.test.ts:373-378`.
- `__tests__/pre-feature-tool-snapshot.ts:25-56` and `tool-visibility-backcompat.test.ts:124`, which are forced by `iris-mcp-all/.../tool-visibility-snapshot-drift.test.ts`.

**iris-mcp-all**
- **The gate template** is `src/__tests__/story-40-0-burn-down-live-gate.test.ts`: header :1-30, imports, `beforeAll`/`afterAll`.
- **Helpers:**
  - `process-gate-helpers.ts`: `openWireSession` :265 (pass `IRIS_GOVERNANCE` in `extraEnv`), `rawIrisRequest` :421, `executeMcpPost` :390, `assertDeployedBootstrapVersion` :525, `skipTest` :555, `teardownRecorder` :577, `staleDistReason` :46;
  - `interop-namespace-fixture.ts`: `createInteropNamespace(admin, dev, name, {interop:false})` :436, `removeInteropNamespace` :486, `leftovers` :1847, `putCompileSeed` :1042 (export it), and `FIXTURE_CLASS_SOURCE` :88, which gains the monitor helper methods.
- **New files:** `src/__tests__/coverage-fixture.ts` (the `Story401` sources and seed helpers), `story-40-1-coverage-live-gate.test.ts` and `story-40-1-doc-claims.test.ts`.
- **Rosters:**
  - `scripts/prepublish-gate.mjs:105-222` (`gateTestFiles`);
  - `story-39-1-gate-guards.test.ts` `GATES` :35-64 (no `extraDriven`);
  - `live-gate-roster.test.ts`.
- **The data-policy row:** `data-policy-scope.ts:86-87` and `tool_support.md:394-408`. `DATA_POLICY_SCOPE_DATE`, pinned at `data-policy-scope.test.ts:52`, and the `tool_support.md` header move together to `2026-10-17`.
- **The snapshot:** `fixtures/tools-list-snapshot.json`, through `pnpm gen:tools-list-snapshot --force` after every package is built.
- **Count pins:**
  - `story-39-6-qa-snapshot-cli.test.ts` (114 and `new tools (allowed): 0`; 114 appears at l.148, 195-198, 235, 278, 304, 312 and 322);
  - `tools-list-snapshot.test.ts` :51 and :141;
  - `docs-prompt-sync.test.ts` :127 and :138 ("109 tools");
  - `story-39-1/2/3/4/5-doc-claims.test.ts` (the Total row);
  - `story-39-5-doc-claims.test.ts:161-162`;
  - `docs-visibility-roster-sync.test.ts`, which also reads the README payload and roster tables and the CHANGELOG line `` `full` 32/27/25/22/8 … (as of Story 39.5) `` at `CHANGELOG.md:1582`.

**Docs**
- `packages/iris-dev-mcp/README.md`:
  - :49 (developer 32);
  - the tool tables at :217-248 (add a row and a `> **Governance defaults:**` line);
  - :1757 ("All 31 tools");
  - one short `<details>` entry for the new tool.
- `tool_support.md`:
  - :25 (31 → 32);
  - row 32 after :57 (default state in the Endpoint cell);
  - :59 (Mix);
  - :448-463 (the rollup, the Total row and the dev prose);
  - the PHI table.
- Root `README.md`: :15, :21, :694-698, :712-718 (rows equal to `pnpm measure:tools-payload`) and :829.
- `packages/iris-mcp-all/README.md`: :31 and :43.
- `docs/migration-v1-v2.md`: :11 and :29.
- `CHANGELOG.md`: a new top section; also update the `as of Story 39.5` roster line.
- `.changeset/`: one new file, with `"@iris-mcp/dev": minor` and `"@iris-mcp/shared": patch`.

## Tasks & Acceptance

**Execution:**

1. `src/ExecuteMCPv2/Coverage/Job.cls` (new). Implement:
   - `MonitorActive()` and `ActiveRoutines()`;
   - `ResolveRoutines(pNS, pClasses, .pUnmeasured, .pTotalLines, .pError)`, where `pError` is IRIS's text when resolving failed;
   - `BusyDecision(pMonitorActive, pSessionDefined, pOwnersAlive, pListMatches, pLiveRun)`, which returns `proceed|reclaim|clear-and-proceed|clear-busy-foreign|busy-suite|busy-foreign`;
   - `PidsMatch` and `SessionMatches`, the reclaim identity proof of an unlisted request process, and `ProveOwnSession`, the supervisor's routine-name proof;
   - `Skeleton(pNS, pRoutine)`;
   - record helpers (allocate, prune to 20, read, set status, liveness by lock);
   - `Supervise(pId)`, the job entry point, and `Finish(pId, ...)`, which ends a run `failed` with `counts-unreadable` or `release-failed` when it lost its counts or its release (decision #48).

   This class is the AD-27 job mechanics and returns raw data only.
2. `src/ExecuteMCPv2/Coverage/Runner.cls` (new, `Extends %UnitTest.Manager`). Implement `Run(pId)` (the job entry point), `OnBeforeAllTests` (records `manager.ResultId`, then returns `$$$OK`) and `ReadCounts`, exactly as the Boundaries say.
3. `src/ExecuteMCPv2/REST/Coverage.cls` (new, `Extends ExecuteMCPv2.REST.Base`). Implement `ValidateStart`, `Start`, `Status` and `Cancel`:
   - validation through `ValidateStart`, then the namespace switch with restore on every path (AD-13);
   - the busy decision and launch under the start lock;
   - the `outcome` result.
4. `src/ExecuteMCPv2/REST/Dispatch.cls`: add the three routes (AD-33: additive only).
5. `src/ExecuteMCPv2/REST/UnitTest.cls`: a class doc-comment-only change, saying that no MCP tool calls `POST /tests`. `iris_execute_tests` uses the Atelier work queue, and `iris_test_coverage` uses the coverage routes. The route stays for direct REST callers (AD-33). This addresses AC 40.1.2's "documented" and closes DW-453 with evidence (Design Notes).
6. `src/ExecuteMCPv2/Tests/CoverageFixture.cls`, `CoverageFixtureEmpty.cls` (a class with no method, so it compiles no routine) and `CoverageJobTest.cls` (new). The tests cover:
   - the `BusyDecision` table, all 7 rows;
   - `PidsMatch` over the process lists IRIS really reports (the suite's processes still alive, ascending, or `0`);
   - `ProveOwnSession` refusing a run the session node does not name, and `ReadRun` for a malformed and an unknown id;
   - `MayTerminate` true only for the PID the record names while a helper job holds the role's owner lock, and false for a different PID, a free lock and an ended process;
   - `Prune` with its default limit, and `TestSpec` (the package-level separator, see the Spec Change Log);
   - `ResolveRoutines` for the fixture and a missing class (`not-compiled`), and for a namespace that cannot be entered (IRIS's text in `pError`, the namespace restored);
   - `Skeleton` strings for fixture lines 5, 6, 9, 11, 14, 21, 26, 35, 37 and 41, and the absence of lines 1-4, 13, 34, 43 and 46 (values in Design Notes);
   - the validation errors of `ExecuteMCPv2.REST.Coverage.ValidateStart`: a missing `target`, a bad `level`, empty or 51 `classes`, an invalid class name, and `maxSeconds` 0 and 3601.
7. `scripts/gen-bootstrap.mjs` and `packages/shared/src/__tests__/bootstrap.test.ts`: both rosters (Rule #39); then `pnpm gen:bootstrap`. Record the version move.
8. `packages/shared/src/refusals.ts` (`MONITOR_BUSY`) and `refusals.test.ts`.
9. `packages/shared/src/tool-visibility.ts` (`TOOL_PAIRS`) and `tool-visibility.test.ts`; then `pre-feature-tool-snapshot.ts` and `tool-visibility-backcompat.test.ts` (dev 32).
10. `packages/iris-dev-mcp/src/tools/unit-test-results.ts` (new): the verbatim move. `test-status.ts` imports from it, and its tests stay green unchanged.
11. `packages/iris-dev-mcp/src/tools/execute.ts`: the exports only.
12. `packages/iris-dev-mcp/src/tools/test-coverage.ts` (new): `testCoverageTool`, `createTestCoverageHandler`, `coverageRunEnvelope`, `isExecutableSkeleton`, `toRanges`, `routineCoverage`, `pollCoverageRun` and `cancelCoverageRun`.
13. `packages/iris-dev-mcp/src/tools/test-status.ts`: `coverageRunId` (schema, the one-sentence description addition, routing, and the combination and namespace errors).
14. `packages/iris-dev-mcp/src/tools/index.ts` and `presets.ts` (rows and banner); update `index.test.ts` and `presets.test.ts`.
15. `packages/iris-dev-mcp/src/__tests__/test-coverage.test.ts` (new). With a fake clock and a mocked `http`, it covers:
    - the executable-rule table;
    - `toRanges` and the percent edges (null, rounding);
    - `routineCoverage` against the row-1 oracle data;
    - every envelope shape and its first text line;
    - the busy and failed mappings, matrix rows 2-4, 10-12 and 14;
    - budget expiry;
    - the tool's name, annotations, `mutates`, schema bounds and the description phrases;
    - in `test-status.test.ts`, the `coverageRunId` poll, cancel and row-16 cases.
16. `packages/iris-mcp-all/src/__tests__/data-policy-scope.ts`: add the row. Move `DATA_POLICY_SCOPE_DATE` and the `tool_support.md` PHI table header to `2026-10-17`, and add the PHI table row. Also extend `packages/iris-mcp-all/src/__tests__/test-status-governance-keys.test.ts` with the AC-6 pins: `deriveKeysForTool` gives `["iris_test_coverage"]`, `mutates` is `"write"`, `defaultEnabled` is undefined, and the key is not in the baseline. The existing `iris_test_status` and `iris_execute_tests` pins stay unchanged.
17. `packages/iris-mcp-all/src/__tests__/coverage-fixture.ts` (new); export `putCompileSeed`.
    - Add to `FIXTURE_CLASS_SOURCE`:
      - `MonitorState()`: JSON `{active, routines}`, read only;
      - `StartForeign()`: refuses unless the monitor is idle, then starts a session on `ExecuteMCPv2.Temp.Story391Fixture.1` scoped to its own process;
      - `StopIfList(pRoutines)`: stops only when the active list is exactly `pRoutines`, proved by name equality where this process can read the names and otherwise as a reclaiming request does (the recorded foreign start, or the session node, or the newest run record when the node is gone: process list and routine count);
      - `TerminateCoverageProcess(pPid)`: refuses unless `pPid` is the `pid` or `runnerPid` in `^IRIS.TempExecuteMCPv2Coverage("session")` and `ExecuteMCPv2.Coverage.Job.MayTerminate` is true for that role, checked immediately before the call (decision #41);
      - the decoy for the `MayTerminate` row: `StartDecoy()` (a job that holds a lock and ends by itself when asked), `DecoyAlive()`, `StopDecoy()` and `PointRunnerAtDecoy(pId, pPid)`, which never terminate anything;
      - the failure injections for decision #48: `HoldMonitorLock(pSeconds)`, `MonitorLockHeld()` and `ReleaseMonitorLock()` hold the monitor's own lock `^%SYS("MON-HOLD")` (for 30 seconds at most) while the suite's session is active, so that `Stop` fails; `CorruptRoutines(pId)` makes a running run's counts unreadable;
      - the retention helpers: `SeedRunRecords(pCount)`, `RunRecordCount()` and `ClearFakeRuns()`.
    - Mirror any roster test of the fixture's methods.
18. `packages/iris-mcp-all/src/__tests__/story-40-1-coverage-live-gate.test.ts` (new).
    - **Shape.** The 40.0 gate shape, with its own `REQUIRE_LIVE`, the shared, dev, admin and interop freshness lines, `assertDeployedBootstrapVersion` straight after `openWireSession`, the tag `story-40-1-coverage-live-gate`, and the armed text `IRIS_REQUIRE_LIVE is set, so the Story 40.1 live gate may not be skipped: <reason>`.
    - **Rows.** Matrix rows 1-11, 13 and 14, each self-contained (it sets its own hang and reads its own counters, so it passes alone), plus rows the matrix does not list: the `MayTerminate` decoy row (a cancel of a run whose record names another process terminates nothing: the decoy stays alive and the run finishes its tests), the decision #48 rows `counts-unreadable` and `release-failed`, `clear-busy-foreign` and `clear-and-proceed` (a stale session node never lets the suite touch a foreign session), `retention` (a start prunes the run records to 20), `levels` (`level` method and package), and a target that names no test class. Every row ends with an idle assertion. `afterEach` and `afterAll` call the fixture's `StopIfList` as a safety net, `afterAll` also removes A and B and the fixture class, and asserts that leftovers are `[]`.
    - **Rosters.** List it in `prepublish-gate.mjs` and `GATES`.
19. `packages/iris-mcp-all/src/__tests__/story-40-1-doc-claims.test.ts` (new). It pins:
    - the dev README row and `> **Governance defaults:**` line (DEFAULT-DISABLED, the enable recipe);
    - `tool_support.md` row 32, which names the default state, IRIS 2026.2 build 221U as the earliest version verified, and that only the test process is measured;
    - the CHANGELOG section (counts and the snapshot regeneration);
    - the `UnitTest.cls` doc-comment sentence.
20. Count pins, snapshot and docs:
    - every pin in the Code Map list moves to the new counts;
    - run `pnpm gen:tools-list-snapshot --force`;
    - the README payload rows equal `measure:tools-payload`;
    - the CHANGELOG section is `## [Pre-release — 2026-10-17] — Story 40.1: Line coverage probe and engine`. It states the counts, the default state, the `BOOTSTRAP_VERSION` move, the snapshot regeneration and the additive `coverageRunId`, and updates the `as of Story 39.5` roster line to Story 40.1 (`full` 33/27/25/22/8, `core` 15/13/12/10/8, `developer` 33/11/25/10/8);
    - write the changeset.

**Acceptance Criteria:**

- **AC-1 (40.1.5).** Given the built dev server over the wire with `iris_test_coverage` enabled and the `Story401` fixture in `EXECMCPTMP401A`, when matrix rows 1 and 2 run, then their outputs equal the matrix exactly, and the monitor is idle afterwards.
- **AC-2 (40.1.4, "pre-started foreign session").** Given a session started by the fixture in its own process, when `iris_test_coverage` is called, then it is refused with `MONITOR_BUSY` `owner:"foreign"`, that session is still active with its own routine list, and no run id was allocated (row 10).
- **AC-3 (40.1.4, "killed mid-flight").** Given a running coverage run, when the client budget expires (row 5), when it is cancelled (row 7), or when its test process is terminated (row 8), then in each case no monitor session is active once the run has reached its terminal status, and the run reports what it observed.
- **AC-4 (40.1.4, ownership and reclaim).** Given a run whose supervisor and runner were both terminated, when it is polled and then a new run starts, then the poll reports `abandoned` and the new run completes with `reclaimed` naming the dead run. The monitor is idle afterwards (row 9). A live suite run is refused, never reclaimed (row 11).
- **AC-5 (AD-16, Integration AC).** Given row 5's `running` result and row 1's completed result, when the consumer `iris_test_status` polls each by `coverageRunId` alone, then it produces the completed envelope with row 5's coverage values, and it reproduces row 1's `structuredContent` deep-equal (row 6).
- **AC-6 (40.1.3, governance and visibility).** Given the default configuration, when `iris_test_coverage` is called, then it is refused with `GOVERNANCE_DISABLED` (row 14). `deriveKeysForTool` gives `["iris_test_coverage"]`, classified `write` and absent from the baseline. `core` excludes it and `developer` includes it. `TOOL_PAIRS` holds the pair. The annotations equal the Boundaries.
- **AC-7 (AD-15, back-compatibility).** Given every existing `iris_execute_tests` and `iris_test_status` test, unchanged, when the dev suite runs, then they pass. The regenerated tools-list snapshot differs from the old one only in the new tool's entry and in `iris_test_status`'s new property and description.
- **AC-8 (40.1.2, 40.1.1).** Given the shipped classes and docs, when the doc-claims test reads them, then `UnitTest.cls` documents that no tool calls `POST /tests`, and `tool_support.md` records the earliest IRIS version verified and the process scope.
- **AC-9 (bootstrap).** Given `pnpm gen:bootstrap`, when it runs twice, then the second run changes nothing. The gate's deployed-version assertion passes, and a fresh bootstrap of the 35 classes completes in under 60 s (measured and recorded in Verification).

### Review Findings

Code review (`/bmad-code-review`, 2026-10-17, `review_tier: full-opus`): four layers (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor) on the frozen diff `966f6ee..` plus the working tree and QA's untracked files (67 files). Every layer delivered. 46 raw rows grouped into 12 root-cause entries (high 2, medium 5, low 5); all 12 patched in this pass and verified live; 0 decision-needed; 1 occurrence appended to an existing ledger entry (DW-595); 14 rows rejected (appendix). `BOOTSTRAP_VERSION` moves again, `4ac115159db0` -> `bdaff1eec1fa` (the story's move is now `08b8adeaadc6` -> `bdaff1eec1fa`; CHANGELOG, `tool_support.md`, the changeset and `story-40-1-doc-claims.test.ts` follow).

- [x] [Review][Patch] **HIGH: the runner stopped whatever session was active when its tests ended, with no proof the session was its own** [src/ExecuteMCPv2/Coverage/Runner.cls:StopOwnSession] - Blind+Edge+Auditor. `LineByLine.Stop()` has no owner check (`irislib/%Monitor/System/LineByLine.cls:165`). When the supervisor has already finished (test code that runs an argumentless `Lock` drops the runner's owner lock, as `%UnitTest.Manager:WipeNamespace` itself does; or a cancelled runner outlives the 60 s wait), or someone else stopped the suite's session and started theirs, the runner's late `ReadCounts` killed the finished record's hits and its `Stop` stopped the newer suite run's or a foreign session (AD-27, Never "Foreign sessions"); a session that ended under it also read as 0% complete (`ResultExecute` returns zero rows for an unfound routine). Fix: `StopOwnSession` reads and stops nothing unless `Job.ListsProcess($Job)` (the active, process-scoped session lists the runner); the supervisor's `Finish` then reports what it found. Reproduced live: with the guard removed, the new gate row's fixture session was stopped (`expected +0 to be 1`). fix-risk: med (bootstrapped safety path; covered by the new gate row and all 23 rows green). The readiness half of the zero-count read stays with DW-595 (occurrence appended, owner 40-2).
- [x] [Review][Patch] **HIGH: the reclaim proof trusted the process list of an all-processes or paused session** [src/ExecuteMCPv2/Coverage/Job.cls:MonitorActive] - Auditor (unverified), settled by a disposable probe (`ExecuteMCPv2.Temp.Probe401R`, deleted; monitor idle before and after): in all-processes mode (`$ZU(84,1)=1`) `$ZU(84,10,2)` returned the previous scoped session's list. So a foreign all-processes session started after a suite session reads as the suite's dead list (`0`), and a stale node with the same routine count is `reclaim`, which stops the foreign session; decision #46's residual argument ("no live process can read it") does not hold for that mode. Fix: `MonitorActive` returns the list only for a process-scoped session (`ScopedPids`, mode 2, as IRIS's own `Pause` reads it), so such a session is `clear-busy-foreign` and never stopped. fix-risk: low (row 9's reclaim and every row still green).
- [x] [Review][Patch] **MED: the INT line numbers are off by one from the document the description says to read them in** (QA finding a) [packages/iris-dev-mcp/src/tools/test-coverage.ts:description] - Blind+Gap+Auditor, confirmed live (`iris_doc_get ExecuteMCPv2.Tests.CoverageFixture.1.int` has 49 lines, line 1 the `ROUTINE` header). The description, dev README, CHANGELOG and changeset now say INT line n is document line n+1. Snapshot regenerated (`--force`: only this entry's description moved) and the README payload rows re-measured (dev `33 / 90,149 / ~22,537`). fix-risk: low.
- [x] [Review][Patch] **MED: the retention row asserted the newest fake record, so it passed only with 19 or more older real records** [packages/iris-mcp-all/src/__tests__/story-40-1-coverage-live-gate.test.ts:retention] - Gap+Auditor. `SeedRunRecords` writes -1001..-1025 and `Prune` deletes from -1025; on a fresh instance the row reaches 17 real records and goes red. Now asserts -1025 is gone and exactly 20 records remain. fix-risk: low.
- [x] [Review][Patch] **MED: `TestPruneDefaultKeepsTheTwentyMostRecentRuns` deleted real run records of the shared instance** [src/ExecuteMCPv2/Tests/CoverageJobTest.cls] - Blind+Edge+Gap+Auditor (Rule 19). With 20 real records present a default-limit `Prune` deletes past the 25 fakes. Replaced by `TestPruneDefaultLimitIsTwentyRuns` (pins `MAXRUNS`); the default wiring is pinned by the gate's retention row (exactly 20). fix-risk: low.
- [x] [Review][Patch] **MED: the QA gate's MONITOR_BUSY row relied on a 6 s hang outlasting a server start and five calls** [packages/iris-mcp-all/src/__tests__/story-40-1-qa-live-gate.test.ts] - Gap (Rule 19). Hang raised to 15 s. fix-risk: low.
- [x] [Review][Patch] **MED: the supervisor's routine-name proof (`ProveOwnSession`'s `ListsEqual`) had no test** [packages/iris-mcp-all/src/__tests__/story-40-1-coverage-live-gate.test.ts] - Gap. New fixture fault injection `RenameRoutineList` (roster test updated) and gate row "release-failed by the routine-name proof": the session is left running, the run ends `failed`/`release-failed`, the node is kept and the next run reclaims it. fix-risk: low.
- [x] [Review][Patch] **LOW: the description did not say the companion's cancel is its own DEFAULT-DISABLED key** (QA finding b) [packages/iris-dev-mcp/src/tools/test-coverage.ts:description] - Blind+Gap+Auditor (Rule #30). The description, dev README and changeset name `iris_test_status:cancel` and its recipe.
- [x] [Review][Patch] **LOW: "only the process that runs the tests is measured" left out the supervisor, which is in the session's list** [Runner.cls, Job.cls, test-coverage.ts, README, tool_support.md, CHANGELOG, changeset] - Blind. Each now says the suite's own supervisor is also listed and runs only the suite's own classes; the Runner, Job and `tool_support.md` note no longer claim it adds no counts.
- [x] [Review][Patch] **LOW: compiler-generated code counts as INT lines and no user document said so** [test-coverage.ts, packages/iris-dev-mcp/README.md] - Blind. One sentence each; 40.2's class-source mapping owns dropping those lines.
- [x] [Review][Patch] **LOW: stale or unpinned claims in comments and a row title** [prepublish-gate.mjs, story-40-1-coverage-live-gate.test.ts header and `clear-and-proceed` title, tools-list-snapshot.test.ts `ENTRY_FLOOR`] - Blind+Gap+Auditor. Both 40.1 gates start sessions; the `clear-and-proceed` title no longer claims a node check it cannot observe.
- [x] [Review][Patch] **LOW: the recorded `CoverageJobTest` total (29 of 29) was stale** [Auto Run Result] - Edge+Gap+Auditor (Rule #35). Re-run after this pass: 31 of 31 (the class now has 31 `Test*` methods).
- [x] [Review][Defer] **The runner's read of its own session with no readiness check (the timing half of the zero-count read)** [Runner.cls:ReadCounts] - deferred: occurrence on DW-595 (routed owner 40-2-coverage-reports-and-targets, probe first).

**Lead re-review of the two HIGH patches (2026-10-18, scoped, read-only, frozen diff `cr-40-1/high-patches.diff` on `da6d495`): NOT-CLEAN, 1 medium and 5 low.** Rework iteration 1 of 3 works exactly these items. Each pinning test it adds or changes gets a demonstrated `mutation:` line.

- [x] [Review][Patch] **MED: patch 2's mode check is never exercised by a real all-processes session** [src/ExecuteMCPv2/Coverage/Job.cls:43 `MonitorActive`; CoverageJobTest.cls:51]. Reverting `:43` to read `$ZU(84,10,2)` in every mode leaves every test green, and patch 1's `ListsProcess` depends on that wiring. Fix (decision #49): add the fixture method `StartForeignAll` (`Start(<disposable routine>, $ListBuild("RtnLine"), "")`, only with the monitor idle) and a gate row:
  1. a suite run's supervisor and runner are both dead, and the suite session has been stopped through `StopIfList`;
  2. `StartForeignAll` starts its session;
  3. `iris_test_coverage` is called. It must be refused `MONITOR_BUSY` `owner:"foreign"`, and the all-processes session must still be active.

  The row stops that session in its own cleanup and asserts the monitor is idle. `mutation:` revert `:43` -> this row red.
- [x] [Review][Patch] **LOW: check-then-stop is not atomic between the two releasers** [Runner.cls:73-81; Job.cls:631-652]. Implement the Boundaries "One releaser at a time" bullet: one suite release lock, re-reading `sessionReleased`/`hasCounts` under it, and `^%SYS("MON-HOLD")` held with a timeout from the identity check through `Stop`.
- [x] [Review][Patch] **LOW: being listed is the runner's whole proof** [Job.cls:64-68 used at Runner.cls:73]. Before reading and stopping, the runner also requires `PidsMatch(<pids>, supervisorPid, $Job)` and the routine names to equal the run's (`ListsEqual(routineList, ActiveRoutines())`). The runner is in its own session's list, so it can read the names.
- [x] [Review][Patch] **LOW: `ProveOwnSession` ignores the session mode** [Job.cls:590-612]. Require `ListsProcess($Job)` (process-scoped, listing the supervisor) first.
- [x] [Review][Patch] **LOW: `clear-busy-foreign` kills the ownership record even when the process list cannot disprove it** [REST/Coverage.cls:331-335 with Job.cls:57]. Kill `("session")` only when the active session is process-scoped (mode 2) and its list disproves the record. Otherwise refuse as foreign and keep the node; `clear-and-proceed` removes it once the monitor is idle. A suite session paused by someone else then stays reclaimable instead of becoming an orphan.
- [x] [Review][Patch] **LOW: a test comment claims a paused-mode probe that was never run** [CoverageJobTest.cls:50]. Reword it: only all-processes mode was probed, and paused (mode 0) is read from `LineByLine.cls:249`.

Execution notes for this rework pass (lead, 2026-10-18); they bind how the six items above are worked:
- **Scope.** Only the six items above, the Boundaries text they cite (Runner "Afterwards, always"; "One releaser at a time"; Never "Process scope" with decision #49), and the tests, fixture methods and docs they force. Do not re-derive or widen the rest of the story.
- **The `StartForeignAll` row (decision #49, test-only).** It starts a REAL all-processes Line-by-Line session in one gate row, only on a disposable `Story401` or `ExecuteMCPv2.Temp.*` routine that nobody else runs, only with the monitor idle (it refuses otherwise), stops it in the row's own cleanup (`finally`/`afterEach`), and asserts the monitor idle afterwards. Product code's process scope does not change.
- **`^%SYS("MON-HOLD")`** is IRIS's own Start/Stop serialization lock. Take it only with a timeout, only around the identity check through `Stop`, release it on every path; a timeout stops nothing.
- **Mutation lines (Rule 19).** Every pinning test added or changed gets a `mutation:` line in `## Verification`, demonstrated red then reverted. The MED's mutation: revert `Job.cls` `MonitorActive` to read `$ZU(84,10,2)` in every mode, and the new row goes red.
- **Shared instance.** LineByLine is an instance-wide monitor on an instance other projects use. Before any session start the monitor must be idle; if a session this story did not start is active, never stop, pause, clear or reconfigure it, stop and report it. Every session you start is released on every path; verify the monitor idle and `^IRIS.TempExecuteMCPv2Coverage("session")` unset after each run and before you return. Never terminate a process the suite did not start. Fixtures live only in the disposable namespaces `EXECMCPTMP401A` / `EXECMCPTMP401B` plus `ExecuteMCPv2.Temp.*` / `Story401*` classes; leftovers `[]`. No production start, no `EnableNamespace`, never stop or restart IRIS, never read another project's data, never write any HSCUSTOM global (including `^ClineDebug`).
- **Bootstrap.** Job.cls, Runner.cls and REST/Coverage.cls are bootstrapped: run `pnpm gen:bootstrap` ONCE when the IRIS classes are final (current `BOOTSTRAP_VERSION` `bdaff1eec1fa`); the story's CHANGELOG bootstrap move ends at the new version, and `tool_support.md`, the changeset and `story-40-1-doc-claims.test.ts` follow if they pin it. DW-591 quirk: afterwards delete `packages/shared/dist` and `tsconfig.tsbuildinfo` and rebuild shared before an armed gate; rebuild every dist before anything reads it.
- **Gates at the end.** The armed 40.1 gate and the armed 40.1 QA gate both pass, none skipped; `CoverageJobTest` runs as one class per `iris_execute_tests` call and its `total` is compared with the class's `Test*` count (Rule #35).

Verification of this pass: `CoverageJobTest` 31/31; the armed 40.1 gate 23/23 (the dev server opened in 1.4 s with the 35 classes redeployed at `bdaff1eec1fa`); the armed QA gate 12/12; `@iris-mcp/all` default suite 86 files (1670 passed, 4 skipped by their own conditions); dev 62 files / 1527, lint and type-check clean; shared bootstrap, refusals and visibility tests; `gen:bootstrap` idempotent; `gen:tools-list-snapshot:check` OK (115); governance `:check` OK (`1e62c5ad5bf7`/141). Afterwards the monitor was idle, `^IRIS.TempExecuteMCPv2Coverage("session")` unset, and no `ExecuteMCPv2.Temp.` or `Story401` document left in HSCUSTOM.

Rejected (14 rows):
- Concurrent exclusive lock probes can read a dead owner as alive (Blind) - `wontfix-theoretical`: a microsecond window whose harmful case also needs a reused PID; real if a false `MONITOR_BUSY` suite or a wrong terminate is observed.
- `RunTest`'s status is ignored (Edge) - low, already adjudicated in the implement review; the zero-result rule reports the class-level reason.
- A failed `Skeleton` is skipped silently (Edge) - low, already adjudicated; needs the routine's source removed mid-run.
- An INT line over 32,000 characters (Edge) - `wontfix-theoretical`, re-sighting.
- The session ends between `Finish`'s check and `ProveOwnSession`, so `release-failed` is claimed for a gone session (Edge) - low race, the claim is safe (the next start clears the node); fix adds a branch.
- A `coverageRunId` reused after an instance restart (Edge) - `by-design` (decisions #4/#42, AD-16 handle lifetime).
- A start POST that blocks longer than a low HTTP timeout (Edge) - low; a retry's `MONITOR_BUSY` refusal carries the run's handle.
- Run-id counter assertions break if someone else starts a coverage run during the gate (Edge) - theoretical; the gate already fails on any foreign session.
- `HoldMonitorLock`'s holder taking the lock after the call returned refused (Edge) - `wontfix-theoretical`; real if a JOB takes over 5 s to start.
- The contract still says `BuildTestSpec` is used unchanged (Auditor) - the fix is a spec edit; recorded in the Spec Change Log (re-sighting of DW-597), and the rewrite is correct for every shape.
- `PidsMatch` accepts orders and `0` placements IRIS never reports (Auditor) - `wontfix-theoretical`; a reclaim only ever sees `0`.
- DW-453 still routed to this story (Auditor) - not a code finding; the lead's `ledger_adjudicated` stage (Design Notes give the recommended terminal state).
- `HoldMonitorLock` does not check the active session is the suite's (Auditor) - theoretical; a foreign session makes `startSlow` fail first.
- The runner killed between its node write and `sessionStarted` (Auditor) - re-sighting of the earlier `wontfix-theoretical`.
- Partial rejections: the Edge row on the 60 s wait keeps only its safety half (fixed by the first HIGH), and the Blind row's spec-text item is a spec edit.

## Spec Change Log

- **2026-10-18, lead, rework iteration 1 after the scoped re-review of code review's two HIGH patches (NOT-CLEAN, 1 medium and 5 low).** Changes:
  - The Runner clause now states the identity proof that gates its read and `Stop`, and the "One releaser at a time" rule.
  - Never "Process scope" gains the test-only all-processes exception (decision #49).
  - Spine AD-27 now says a session's process list proves ownership only when the session is process-scoped.
  - The six `[Review]` items under Tasks & Acceptance are the whole rework.

- **2026-10-18, implement stage, rework iteration 1 (apply and report; the intent-contract text is not edited).**
  - The identity proof of the runner is `Job.ProofFailure`: the session is process-scoped, its list names the caller, `PidsMatch` accepts it (the list holds only alive processes, so an ended supervisor is absent), every routine name is readable, and the names equal the run's. `ProveOwnSession` asks the same proof, a superset of the routine-name equality the Boundaries name.
  - Probed on this build (disposable class, monitor idle before and after): in all-processes mode `$ZUtil(84,10,2)` read the starting process, then other processes, and never the previous scoped session's list; every process read the routine name. The `MonitorActive` revert is therefore red through the process-list and node assertions of the all-processes row, not through a reclaim.
  - "One releaser at a time": the release lock waits 10 s and `^%SYS("MON-HOLD")` 5 s (parameters of `Job`). A timeout stops and reads nothing, so a `release-failed` run whose lock timed out carries no coverage. The wait for readable routine names (`AwaitNamesReadable`, 15 s at most) runs before the locks are taken.
  - `clear-busy-foreign` keeps the ownership node unless the active session is scoped to listed processes and its list does not match the node (`SessionDisproved`); a session of all processes or a paused one keeps it, and `clear-and-proceed` removes it once the monitor is idle.
- **2026-10-17, lead spec gate.** Decisions #39 to #44 were taken as recommended. Decision #41 adds `Job.MayTerminate` (Boundaries: Supervisor, Never, Task 17), so a PID reused after its process died is never terminated. Spine AD-27 and AD-16 are amended (Rule 20).
- **2026-10-17, lead, after the implement stage's `intent gap` (G1).** Decisions #45 to #48 answer its four questions:
  - #45: the runner's session lists the runner and its own supervisor (Runner clause; Never "Process scope"; Design Notes probe note corrected). Spine AD-27 amended.
  - #46: `Finish` keeps the full routine-name proof, because the supervisor is listed. Reclaim by an unlisted request process uses the strict process-list and routine-count proof in Boundaries, with its residual recorded.
  - #47: matrix row 9 terminates `pid` first, then the runner.
  - #48: a run whose counts could not be read, or whose session could not be stopped, ends `failed` with `counts-unreadable` or `release-failed` and is never silent; `readError` is returned.

  The saved patch `spec-40-1-line-coverage-probe-and-engine-attempt-1.patch` (md5 `ac1f6cf6bb2e93ab112fb94b6110691e`) is re-applied cleanly to the working tree, then removed from `_bmad-output` (it is not committed), and the spec resumes at review (`in-review`). The review's `patch` rows, and its `bad_spec` rows now covered by #48, are worked in that pass.
- **2026-10-17, implement stage (resumed pass), reality correction to decision #46's reclaim proof (apply and report; the intent-contract text is not edited).** The Boundaries' reclaim proof says the process list has "exactly two entries, in order, each equal to the record's `runnerPid` and `pid` or `0`". Captured live on the gate fixture (Design Notes, "The process list"), IRIS lists only the scoped processes still alive, in ascending PID order, and reads `0` when none is: so no list of two entries ever occurs for a session whose two owners are dead, and the literal proof made every reclaim `clear-busy-foreign` (the first resumed run stranded a suite session with no ownership record: row 9's reclaim killed the node, and rows 10, 11, 13 and 14 were refused as foreign). `PidsMatch` now accepts one or two entries, each the runner's PID, the supervisor's PID or `0`, with no repeat; a reclaim requires both owner locks free, so it sees `0`. The proof is no weaker than #46 intended: the same node, owner-lock, routine-count and process-list conditions, and the same recorded residual. The lead should amend the Boundaries sentence in the contract to say "the scoped processes still alive, or `0`".
- **2026-10-17, implement stage, the verification-gap review found `level:"package"` runs no test (apply and report).** The Boundaries say the test spec is `BuildTestSpec(target, level)`, unchanged. Captured live (a package run of `Story401` reported 0 tests, and a comma between the specs ran only the first class), RunTest reads one spec as `suite:class[:method];class[:method];...` and runs a directory once, so the `:A;:B` that `BuildTestSpec` returns at the package level means class A with a method named B. `BuildTestSpec` itself is untouched; `REST.Coverage.TestSpec` drops the colon after each semicolon at the package level (`:A;B`), which ran both test classes (5 tests) in the gate. The same defect sits in `POST /tests` (no tool calls it); it is deferred in the spec frontmatter.
- **2026-10-17, implement stage, `bad_spec` row "the supervisor's `Terminate` call site is not pinned to `MayTerminate`".** Fixed by a gate row with a decoy (Task 18). The supervisor terminates the PID it started itself (`$ZChild`), never one read back from the record; `MayTerminate` compares it with the record, so a record pointed at another process makes the guard false. The row therefore proves two things at once: the decoy (the gate's own process, which ends itself when asked) stays alive, and the run, whose runner was not terminated, finishes its tests instead of ending `cancelled`.

## Review Triage Log

### 2026-10-17 — Review pass
- attempted change saved as `_bmad-output/implementation-artifacts/spec-40-1-line-coverage-probe-and-engine-attempt-1.patch` (55 files, `git apply` from the baseline `966f6ee`; the spec file is not in it); code reverted after triage because of the `intent_gap` entries.
- generated files `packages/shared/src/bootstrap-classes.ts` and `packages/iris-mcp-all/src/__tests__/fixtures/tools-list-snapshot.json` were left out of the reviewed diff; the drift test, the second `gen:bootstrap` (md5 unchanged), and `gen:tools-list-snapshot:check` (only the new entry and `iris_test_status` differ) cover them.
- verdicts: 56 findings — high 2, medium 16, low 30, false 5, maybe-false 3 (counted mechanically from the rows below; layers Blind 11, Edge 20, Gap 13, Intent 12; routes intent_gap 6, bad_spec 5, patch 21, defer 1, reject 23)
- findings:
  - `[medium]` `[bad_spec]` Blind: a completed run can silently lose its counts (`Runner.StopOwnSession` drops the `%Status` of `ReadCounts`, then sets `sessionReleased`, so `Finish` never retries) — verified in `Runner.cls:63-69`; the contract and Design Notes say nothing about a completed run whose counts are unreadable (group G2).
  - `[low]` `[patch]` Blind: the refusal-code table in the root `README.md` (lines 478-486) has no `MONITOR_BUSY` row — verified by grep.
  - `[low]` `[patch]` Blind: prose dates left at 2026-10-16 after the PHI scope table moved to 2026-10-17, dead `tool_support.md` anchors (lines 204-210), `docs/epic-summary.md` still says 109/114 — verified by grep.
  - `[medium]` `[patch]` Blind: `ResolveRoutines` discards the exception and `Run` then reports "None of the listed classes has a measurable routine ()" — verified; a privilege or namespace error loses IRIS's own text (R3, AD-31). Smallest fix: put the exception text in `pUnmeasured`.
  - `[low]` `[patch]` Blind: class names are matched exact-case and un-normalized and the description never says so — verified (`$$$comClassDefined`); fix is a description sentence.
  - `[maybe-false]` `[defer]` Blind: the runner reads counts with no readiness check — claim from reading only; would be medium if a fast suite reads before the monitor's "short delay" and returns 0%. Settled by a probe that starts a session and reads in the same process at once.
  - `[low]` `[patch]` Blind: `BuildRun` can report a finished run as `abandoned` (status read before the two lock probes; the supervisor completes between them) — verified in `Coverage.cls:413-418`; window is microseconds; fix is re-reading the status after the probes.
  - `[low]` `[patch]` Blind: test title "the production export uses the real clock and the same schema" asserts only `typeof handler` — verified, `test-coverage.test.ts:679`.
  - `[medium]` `[patch]` Blind: gate rows depend on earlier rows (row 11 on row 10's `nextRunId`, rows 8/9/11/13 on row 7's hang) and `fifty` holds 51 entries — verified; Rule 19 hermeticity. Same root as the verification-gap row on row coupling.
  - `[low]` `[reject]` Blind: `Job.SafeText` strips only the English `ERROR #` prefix and duplicates `Utils.SanitizeError`'s stripper — real but only on a localized instance (this one is `enuw`) and the fix adds branches.
  - `[low]` `[patch]` Blind: hygiene — `tStartTimedOut` never read, redundant `(tReason '= "") ||` guard, `//` comments between methods in `CoverageJobTest.cls` — verified; direct deletions.
  - `[medium]` `[bad_spec]` Edge: `StopOwnSession` ignores the `ReadCounts` status (`Runner.cls:63-69`) — same root as the first row (G2).
  - `[medium]` `[bad_spec]` Edge: `readError` is written in three places and never returned by `BuildRun` (`Coverage.cls:411-470`) — verified; same root (G2).
  - `[medium]` `[bad_spec]` Edge: a completed run whose session could not be released carries `error` text that the TypeScript completed envelope drops (`test-coverage.ts:395-415`), so a leaked monitor session is silent — verified in `Finish` and `coverageRunEnvelope`; same root (G2).
  - `[low]` `[reject]` Edge: the runner calls `Stop` unconditionally (`Runner.cls:71`) so it could stop a newer session if the supervisor released first — the contract says "always calls Stop"; needs test code that drops the runner's lock; `wontfix-theoretical`, would become real if a supervisor-before-runner release path exists.
  - `[low]` `[reject]` Edge: liveness by lock is defeated by test code that releases all locks (`Job.cls:174-181`) — the contract chose lock liveness (`by-design`).
  - `[low]` `[reject]` Edge: `RunTest`'s returned `%Status` is ignored (`Runner.cls:49`) — the TypeScript zero-result rule reports the class-level reason; fix adds a branch.
  - `[low]` `[reject]` Edge: a failed `Skeleton` for one routine is skipped silently (`Job.cls:610-615`) — not met in practice, fix adds a branch.
  - `[medium]` `[patch]` Edge: `ResolveRoutines` swallows an exception (`Job.cls:357-361`) — same root as the Blind row (`ResolveRoutines` discards the exception).
  - `[maybe-false]` `[reject]` Edge: a routine recompiled between resolution and `Start` reads as zero (`Runner.cls:36`) — whether `Start` skips a missing routine is unknown; if true it is low (a race inside one request).
  - `[low]` `[patch]` Edge: `Launch`'s `reclaim` path marks a terminal run `abandoned` (`Coverage.cls:319-327`), unlike `clear-and-proceed`, which checks `IsTerminal` — verified; reachable only when `Stop` failed earlier; add the guard.
  - `[low]` `[reject]` Edge: `AwaitStart` ignores cancel and a short time limit for up to 120 s (`Job.cls:533-557`) — the contract starts watching once `running`; the start phase is milliseconds in practice.
  - `[low]` `[reject]` Edge: the IRISTEMP counter restarts at 1 after an instance restart, so a stale `coverageRunId` can name a newer run (`Coverage.cls:335`) — decision #4 accepts that handles do not survive a restart and the not-found text says so (`by-design`).
  - `[low]` `[patch]` Edge: class given without package or in another letter case is reported `not-compiled` (`Job.cls:330`) — same root as the Blind class-name row.
  - `[low]` `[reject]` Edge: an exception in `Supervise` after the runner started leaves the runner unmonitored (`Job.cls:522-526`) — needs `<PROTECT>`, `<STORE>` or a lock error in a few globals; `wontfix-theoretical`.
  - `[low]` `[patch]` Edge: `tool_support.md:395` still says "as of 2026-10-16" — same root as the Blind date row.
  - `[low]` `[patch]` Edge: `docs/epic-summary.md:3` still says 109/114 — same root as the Blind date row.
  - `[low]` `[reject]` Edge: `Finish` keeps the session node and the session when `Stop` fails (`Job.cls:590-638`) — documented design so a later run can reclaim; the silent reporting is the G2 row.
  - `[false]` `[reject]` Edge: a poll does not reproduce a primary result that carried `timeoutCapped` (`test-coverage.ts:407`) — Design Notes say `timeoutCapped` is added only by the primary call; matrix row 6 compares unclamped results.
  - `[maybe-false]` `[reject]` Edge: `CollectCounts` records nothing when names stay unreadable for 15 s (`Job.cls:564-579`) — low confidence; with the supervisor in the session's list the names read within the delay in every gate run; if true it is low.
  - `[medium]` `[intent_gap]` Edge: `StopIfList` in the gate fixture stops on a PID or session-node match without comparing the active routine list when names are unreadable (`interop-namespace-fixture.ts:398-421`) — verified in the diff; same root as the process-list rows (G1): the contract's name-equality identity cannot be read by a process outside the session's list.
  - `[medium]` `[patch]` Gap: the runner's own release is unpinned — row 1 never reads `releasedBy`, and deleting `StopOwnSession` leaves every gate row green because the supervisor releases instead — verified; assert `releasedBy:"runner"` in row 1. The failed-`Start` half is row 12, which the matrix pins as "unit tests plus review" (`by-design`).
  - `[medium]` `[bad_spec]` Gap: the supervisor's `Terminate` call site is not pinned to `MayTerminate` — an unconditional `Terminate` keeps every row green; verified (rows use a valid PID). Fix needs a decoy-process gate row.
  - `[low]` `[reject]` Gap: `Launch`'s `clear-busy-foreign` / `clear-and-proceed` outcomes and the default retention of 20 are not exercised through `Launch` — rare states; the decision function is pinned for all 7 rows; `wontfix-accepted`, `reopen_if` a retention or stale-node defect is reported.
  - `[medium]` `[patch]` Gap: `ReadRun` (unknown and malformed ids) is exercised only through mocked TypeScript — verified (no OS test, no gate row 16); add `TestReadRunUnknownAndMalformedId` to `CoverageJobTest`.
  - `[low]` `[reject]` Gap: nothing checks that bootstrapped class paths are tracked by git — process gap, the `.gitignore` negation fixes this instance; `wontfix-accepted`, `reopen_if` a bootstrapped class is again missing from a commit.
  - `[medium]` `[patch]` Gap: assertions that cannot fail — `test-coverage.test.ts:679`, `:258-260` (the test adds the else line itself), gate `:497` and `:548` conditional on optional data, `CoverageJobTest.cls:125`, and the "no executable INT lines" text unasserted — verified in the diff; Rule 19.
  - `[medium]` `[patch]` Gap: gate rows are not self-contained (rows 6b, 8, 9, 11, 13 read state set by earlier rows) — same root as the Blind coupling row.
  - `[low]` `[reject]` Gap: sub-claims inside AC-3, AC-4, AC-6 and AC-9 have no mutation of their own — Rule 19 asks one demonstrated mutation per AC, and each AC has one.
  - `[high]` `[intent_gap]` Gap: the runner starts its session with `$ListBuild($Job, tSupervisorPid)`, against the Runner clause and the Never "Process scope" clause — verified live (G1): with `$ListBuild($Job)` only, 7 of 13 gate rows go red (row 7 stays `running`: the supervisor cannot read the session's counts, and rows 8 to 14 cascade); the Design Notes probe note says the counts stay readable after the runner dies, which holds only for a process in the session's list.
  - `[low]` `[patch]` Gap: dead `tool_support.md` anchors and stale prose after the date move — same root as the Blind date row.
  - `[low]` `[patch]` Gap: `docs/epic-summary.md` count — same root as the Blind date row.
  - `[low]` `[patch]` Gap: `IRIS_TEST_TIMEOUT` is documented as `iris_execute_tests`-only at `README.md:90` and `iris-dev-mcp/README.md:199`, though it also sets this tool's budget — verified by grep.
  - `[low]` `[reject]` Gap: `Supervise`, `Finish`, `CollectCounts`, `AwaitStart`, `Runner.Run` and `Launch` run only in the live gate — the established pattern (armed gate).
  - `[high]` `[intent_gap]` Intent: same as the process-list row (G1) — Runner `Start` list and the Never "Process scope" clause.
  - `[medium]` `[intent_gap]` Intent: the release condition in `Job.Finish` is process list plus routine count, not the contract's "active routine list equals this run's list" — a process outside the list cannot read the names, so the contract's identity proof is unreachable in `Finish` before counts are read and in every reclaim by a new request process (G1).
  - `[medium]` `[intent_gap]` Intent: `PidsMatch` accepts `0` entries (an ended scoped process), so a stale suite node plus a foreign session scoped to ended processes with the same routine count reads as `reclaim` and would be stopped — verified in `Job.cls:81-98`; reachable only after the suite's session was stopped by someone else; it weakens the "a session without a suite ownership record is never touched" rule (G1).
  - `[false]` `[reject]` Intent: `BusyDecision` has six outcomes, adding `clear-busy-foreign` — Task 1 and the Design Notes table list it.
  - `[low]` `[reject]` Intent: `Prune` also deletes a non-terminal record whose supervisor is dead — the contract forbids only a record whose supervisor is alive; the oldest go first beyond 20 runs.
  - `[low]` `[patch]` Intent: literal U+2014 in `test-coverage.ts` (`EM_DASH`) and literal non-ASCII in new test files (`story-40-1-doc-claims.test.ts` 5 lines, `test-coverage.test.ts` 1) — verified by grep; Rule 14, use `\u` escapes. The literals in the moved `unit-test-results.ts` text are verbatim and pre-existing.
  - `[false]` `[reject]` Intent: `cancelCoverageRun` does one `GET` before the `POST` — needed for the namespace-mismatch error before anything is signalled; no clause forbids it.
  - `[false]` `[reject]` Intent: an `abandoned` run gets the zero summary without the interim SQL read — the contract's abandoned shape has no summary.
  - `[low]` `[reject]` Intent: the gate checks the monitor idle once in `beforeAll` and the OS fixture lives in the home namespace — each row ends with an idle assertion; the OS fixture is Task 6.
  - `[medium]` `[intent_gap]` Intent: matrix row 9 terminates the runner and then `pid`; the gate terminates `pid` first — with the runner killed first the supervisor's 100 ms watch releases the session before the second kill, so the row's end state is unreachable in that order (G1).
  - `[low]` `[reject]` Intent: routes byte-identical, start-time structure, lock-timeout path and row 12's IRIS half have no direct test — covered by the additive diff, the armed gate, and the matrix's "unit tests plus review".
  - `[false]` `[reject]` Intent: additions the contract does not mention (`.gitignore` negation, `ValidateStart` target check, changeset, date move, case-insensitive namespace compare) — each is needed or forced by a Task.

  **intent_gap questions for the lead (G1; the code passes every Verification command):**
  1. A Line-by-Line session counts only its listed processes, and only a listed process can read the session's routine names and line counts (re-proved live on 2026-10-17: with `Start(..., $ListBuild($Job))` the armed gate goes 6 passed and 7 failed of 13, and row 7 stays `running`). May the runner's session be scoped to `$ListBuild($JOB, supervisorPid)`, i.e. two processes the suite owns, never all processes and never another project's? The Runner clause, the Never "Process scope" clause and AD-27 need that sentence.
  2. The release and reclaim identity proof in the contract (active routine list equals this run's list) cannot be read by a process outside the list. The implementation proves identity by process list plus routine count, with `0` accepted for an ended process. Is that proof acceptable on a shared instance, given the residual case in the `PidsMatch` row, or does the lead want a stronger proof?
  3. Matrix row 9 should say the gate terminates `pid` and then `runnerPid`.
  4. (bad_spec, outside the contract) what a completed run reports when its counts cannot be read or its session cannot be released: `failed` with the reason, or `completed` plus a `note`.

### 2026-10-17 — Review pass (resumed pass, after decisions #45 to #48)
- the first entry's open routes were worked before this pass's layers ran, on the applied tree:
  - its 6 `intent_gap` rows by decisions #45 to #48 (the runner's process list, the supervisor's routine-name proof in `Finish`, the reclaim proof as corrected by the live capture in the Spec Change Log, matrix row 9's order, the gate fixture's `StopIfList`);
  - its 5 `bad_spec` rows by decision #48 (`StopOwnSession` and `Finish` record `readError` and end the run `failed` with `counts-unreadable` or `release-failed`; `Status` returns `readError`; the envelope carries `reason`, `readError`, the summary and the coverage) and the `Terminate` call-site row by the decoy gate row;
  - its 21 `patch` rows (README refusal row, stale dates and anchors, `ResolveRoutines` error text, class-name wording, `BuildRun` status re-read, the `typeof handler` test, gate row coupling and `fifty`, hygiene, the reclaim `IsTerminal` guard, `releasedBy:"runner"` in row 1, the `ReadRun` test, the cannot-fail assertions, `IRIS_TEST_TIMEOUT` documentation, the literal non-ASCII bytes);
  - its `defer` row is carried into the frontmatter `deferred:` list.
- layers: Blind, Edge, Verification-gap and Intent-alignment, on the frozen diff of 54 files (the two generated files left out). Their findings are the rows below.
- verdicts: 38 findings — high 0, medium 9, low 28, false 0, maybe-false 1 (counted mechanically from the rows below; layers Blind 9, Edge 8, Gap 13, Intent 8; routes intent_gap 0, bad_spec 0, patch 23, defer 1, reject 14)
- findings:
  - `[low]` `[patch]` Blind: `README.md` says dev `89,340 -> 43,878` under a table row of `89,533` — verified by `measure:tools-payload`; the prose now reads the measured `89,756` (the figures moved again with the INT-source sentence).
  - `[low]` `[patch]` Blind: the root README's "Default-disabled write actions" table has no `iris_test_coverage` row — verified; a row was added (the `iris_test_status:cancel` omission predates this story and is not touched).
  - `[low]` `[patch]` Blind: the Story 39.5 note in `tool_support.md` says "the table's own date stays 2026-10-16" under a table now dated 2026-10-17 — verified; reworded as history.
  - `[medium]` `[patch]` Blind: the `IRIS_TEST_TIMEOUT` precedence of `iris_test_coverage` is untested and `config.ts` still calls it `iris_execute_tests`-only — verified (a handler that ignores it kept every test green); three handler tests were added (explicit beats config, config applies, 120 s default) and the comment and table row in `config.ts` name both tools.
  - `[medium]` `[patch]` Blind: the handle is a JSON number in results and an all-digits string in `iris_test_status`, and the busy text quotes it nowhere — verified (`safeParse({coverageRunId: 9})` fails); the busy refusal text now quotes it as the running hint does. The schema stays an all-digits string: accepting a number would widen the public surface the Boundaries fix.
  - `[medium]` `[patch]` Blind: a `target` that names no test class has no test or live row — verified live: the run completes with 0 tests and `isError:true` ("no test method ran", every line uncovered); a gate row pins it.
  - `[low]` `[patch]` Blind: the `iris_test_status` field descriptions still read as if every call needs a `jobId` or `runIndex` — verified; the one sentence the tool description gained now says cancel needs no `jobId` and `namespace` is optional (the property descriptions stay, so the snapshot differs only in the entry the AC allows).
  - `[low]` `[patch]` Blind: the line ranges are INT line numbers and no document says how to read the INT source — verified live that `iris_doc_get` on `<routine>.int` returns the numbered INT; one sentence was added to the tool description and the README.
  - `[maybe-false]` `[defer]` Blind: the 200,000-line cap and the 20-run retention were not measured on the Status path — whether a run at the cap makes a `Status` read too slow or too large is not known; deferred as medium (unverified), settled by measuring the Status call at about 200,000 lines.
  - `[low]` `[reject]` Edge: `Supervise` discards the result of `Terminate` and waits 60 s for a runner that did not end — needs a process the suite started to refuse `Terminate`; `wontfix-theoretical`, real if a suite-started process can be unterminable.
  - `[low]` `[reject]` Edge: an INT line of more than 32,000 characters would be read in pieces and shift the skeleton's line numbers — no class this suite measures generates such a line; `wontfix-theoretical`, real if one does.
  - `[low]` `[patch]` Edge: a runner killed or failing after `Start` returns but before its record writes leaves a session with no ownership record — the exception variant is real (a failed node write skipped `StopOwnSession`) and `tStarted` is now set the moment `Start` succeeds; the microsecond kill window is `wontfix-theoretical`.
  - `[low]` `[patch]` Edge: `ResolveRoutines` calls `SafeText` in its `Catch` before restoring `$NAMESPACE` (AD-13 says first) — verified; the restore is now the first line.
  - `[low]` `[patch]` Edge: new lines of `test-status.test.ts` carry literal U+2500 and U+2014 — verified by grep; now ASCII and a `—` escape.
  - `[low]` `[patch]` Edge: `CoverageJobTest.OnAfterOneTest` declares three formals and the base class passes one — verified in `%UnitTest.TestCase`; the signature is now `(testname)`.
  - `[low]` `[patch]` Edge: the README payload prose and table disagree — same root as the first Blind row, fixed once.
  - `[low]` `[patch]` Edge: the header of `docs-prompt-sync.test.ts` still names the "109 tools" claim the test no longer asserts — verified; now "110 tools".
  - `[medium]` `[patch]` Gap: `level:"package"` and `level:"method"` are never run live — verified live and a real defect: a package run reported 0 tests, because RunTest reads `:A;:B` as class A with a method B and runs a directory once; `REST.Coverage.TestSpec` now drops the colon after each semicolon, a gate row runs both levels (5 tests; 1 test covering the SumTo lines) and an OS test pins the spec. `BuildTestSpec` itself is unchanged and its `POST /tests` defect is in `deferred:`.
  - `[medium]` `[patch]` Gap: the timeout precedence is untested — same root as the fourth Blind row, fixed once.
  - `[medium]` `[patch]` Gap: `clear-busy-foreign` and `clear-and-proceed` of `Launch` are covered only as decision-table rows — verified; two gate rows were added (a foreign session with a stale node stays untouched and the node is cleared; an idle monitor with a stale node clears it, records the dead run `abandoned` and reclaims nothing).
  - `[medium]` `[patch]` Gap: the 20-run retention has no test — verified; an OS test calls `Prune` with its default limit, and a gate row seeds 25 finished records and asserts a start leaves at most 20.
  - `[low]` `[patch]` Gap: `TestResolveRoutinesReasons` needs `CoverageFixtureEmpty`, which the Verification load list does not load — verified; the load list and Task 6 name it (the fix is to the verification commands, not to the intent).
  - `[low]` `[reject]` Gap: AC-9's second pin (`assertDeployedBootstrapVersion`) has no red path of its own — the Verification section records why (it compares the stamp the drift test already pins); `wontfix-accepted`, `reopen_if` the deployed-version check can fail independently of the drift test.
  - `[medium]` `[patch]` Gap: new test groups carry no `mutation:` line — the groups that pin a Boundaries clause now have one (`Prune`, the skeleton and `LineSkeleton`, `ValidateStart`, `MayTerminate`, the `coverageRunId` group of `test-status.test.ts`); `ListsEqual`, `IsClassName`, `SafeText`, `UtcNow` and `IsTerminal` pin helpers, not an acceptance criterion.
  - `[medium]` `[patch]` Gap: the unit fixtures give `coverageRunId` and `runIndex` the same value and the SQL mock ignores its parameters — verified (swapping them passed); `runIndex` is now 12 in the fixtures and the SQL parameters are asserted, with a mutation line.
  - `[low]` `[reject]` Gap: the seed check in `interop-namespace-fixture.test.ts` compares a stubbed return with its own literal — the compile order and call arguments it also pins discriminate, and it copies its siblings' pattern.
  - `[low]` `[reject]` Gap: `refusedOrRejected` in gate row 4 counts any thrown error as a refusal — the schema rules themselves are pinned by the unit `safeParse` test and the route's `maxSeconds` error is asserted by text.
  - `[low]` `[reject]` Gap: gate `runIndex === null || typeof ... === "number"` fails only for `undefined` — that is the property (the field is present, null or a number).
  - `[low]` `[patch]` Gap: the Story 39.5 note contradicts its table — same root as the third Blind row, fixed once.
  - `[low]` `[reject]` Gap: the fixture holds `^%SYS("MON-HOLD")` for up to 30 s on the shared instance — it holds it only while the suite's own session is active (nobody else can start one then), it is bounded and released by the row; `wontfix-accepted`, `reopen_if` another project reports a Line-by-Line `Stop` that failed with MonitorInUse during a gate.
  - `[low]` `[reject]` Intent: the reclaim proof is looser than the contract's literal "exactly two entries, in order" — the literal list never occurs (live capture in the Spec Change Log); the fix is to edit the intent contract, which this build does not edit, so the lead amends the sentence.
  - `[low]` `[reject]` Intent: `Prune` also removes a dead non-terminal record, and the supervisor's clock starts at its own start — the first carries the earlier pass's row, and no clause fixes the second.
  - `[low]` `[reject]` Intent: row 12's IRIS half (a failed `Start` calls no `Stop`) has no test — the matrix says "unit tests plus review; it cannot be timed live", and the TypeScript mapping is tested.
  - `[low]` `[reject]` Intent: row 3's cap message is exercised only by the live gate — the gate row asserts the exact text, and `ResolveRoutines` is tested for the line total.
  - `[low]` `[reject]` Intent: row 16's two halves are tested separately and the gate does not run it — the unit tests cover the TypeScript errors and `CoverageJobTest` the IRIS text; the matrix puts row 16 at the unit tier (Task 15).
  - `[low]` `[reject]` Intent: the IRIS job engine is reached only by the live gate — the established armed-gate pattern; no OS test may start a session (Boundaries).
  - `[low]` `[reject]` Intent: the `.gitignore` negation, the changeset, the exports and the loosened 39.x doc-claims regexes have no anchor in the contract — each is needed by a Task, and the regexes now accept "Story 39 or 40" where the count or the re-measure moved.
  - `[low]` `[patch]` Intent: the README payload prose and table disagree — same root as the first Blind row, fixed once.

### 2026-10-18 — Review pass (rework iteration 1: Blind, Edge, Verification-gap, Intent-alignment on the frozen diff `e8720c7..` without the generated embed and this spec)
- verdicts: 31 findings — high 0, medium 0, low 30, false 1, maybe-false 0
- findings:
  - `[low]` `[patch]` Blind: the swap gate row cleans up through `StopIfList(FOREIGN_ROUTINES)`, which proves a session only when the fixture process can read its routine names (a session started by test code has no fixture marker, and the node holds the suite's routines) — verified by reading `StopIfList`: the row stayed green live, but only through the readable path. `SwapTest` now records its pid as the fixture's foreign session, so the foreign-marker proof applies whether or not the names are readable.
  - `[low]` `[patch]` Blind: `tool_support.md` still says the runner stops its session "only while that session still lists it" — verified, the paragraph carried only the hash swap. Rewritten to the proof and the one-at-a-time locks.
  - `[low]` `[patch]` Blind: the dev README says the counts are absent only when the monitor's own lock could not be taken, but a release-lock timeout reads nothing as well — verified in `TakeReleaseLocks`; the sentence now says "a release lock, the run's own or the monitor's". CHANGELOG carries no such sentence.
  - `[low]` `[reject]` Blind: `Finish` ends `release-failed` on a release-lock timeout without re-checking `sessionReleased` — `wontfix-accepted`: the only reachable case is a runner still inside its release after the supervisor's 60 s wait plus the 10 s lock wait, where a re-check would still read "not released" and so changes nothing; before this pass the two releasers raced instead. `reopen_if` a run ends `release-failed` with `releasedBy: "runner"` in its record.
  - `[low]` `[reject]` Blind: nothing tests the re-read of `sessionReleased`/`hasCounts` under the lock — `wontfix-accepted`: the interleaving (the other releaser finishing between the pre-check and the lock) cannot be forced deterministically, and an extracted pure decision would pin the helper, not the wiring; the lock mechanics themselves are pinned (the Finish and Runner lock mutations go red in the gate, `TakeReleaseLocks` in `CoverageReleaseTest`). Same root as the Gap row. `reopen_if` a false `release-failed` is seen on a run whose runner released the session.
  - `[low]` `[patch]` Blind: `CoverageReleaseTest` holds the instance-wide `^%SYS("MON-HOLD")` from a helper job for up to 10 s, which other projects' Line-by-Line calls wait only 3 s for — verified; the helper's ceiling is now 3 s (the tests need under 2 s) and its comment says why. The assertions can only fail falsely if another process touches the lock in that window.
  - `[low]` `[patch]` Blind: the `Job.cls` class header still describes the pre-rework release and omits the `("owner",id,"release")` lock — verified; the header now describes the proof and the two locks and says the release lock is not a liveness lock (`OwnerAlive` takes only the role it is given).
  - `[low]` `[patch]` Blind: the `ScopedPids` comment states the paused-mode behavior as fact although it was not probed — reworded to say it is read from the `Pause` source.
  - `[low]` `[reject]` Blind: the `foreignAll` tier of `StopIfList` is the weakest identity check of the fixture — `wontfix-theoretical`: it is the fixture's own test-only marker, set only by `StartForeignAll` with the monitor idle on the fixture's own routine and killed whenever `StopIfList` sees the monitor idle; a stale marker needs the session to end unseen and a foreign single-routine all-processes session to appear during the same gate run.
  - `[low]` `[patch]` Edge: the swap row's cleanup refuses when the names are unreadable — same root as the first Blind row.
  - `[low]` `[reject]` Edge: a release-lock timeout while the runner still holds the lock mid-read ends the run `release-failed` — same root as the fourth Blind row.
  - `[low]` `[reject]` Edge: the runner's release phase (15 s wait plus the read under the locks) can outlast the supervisor's 60 s wait on a very large run — same root as the fourth Blind row; the false failure needs an after-phase over 70 s, and the read's time at the 200,000-line cap is unmeasured (the same unmeasured size as the deferred `Status` payload row), so this is recorded as a residual risk, not a measured bound. `reopen_if` a run ends `release-failed` with `releasedBy: "runner"` in its record.
  - `[low]` `[reject]` Edge: the `foreignAll` branch proves by record, an empty list and a routine count — same root as the last Blind row.
  - `[low]` `[reject]` Edge: keeping the stale ownership node while a foreign all-processes or paused session is active lets a later foreign scoped session with dead processes and the same routine count be reclaimed — `by-design`: the lead's item says to refuse as foreign and keep the node, and the case is the residual decision #46 records (a scoped foreign session whose processes are all dead and whose count matches reads as reclaimable); the node is removed as soon as any start sees the monitor idle.
  - `[low]` `[patch]` Edge: `CoverageReleaseTest` holds the shared monitor lock for seconds — same root as the sixth Blind row.
  - `[false]` `[reject]` Edge (claim): a reader may trust an exact-list guarantee in `StopIfList` that its `foreignAll` branch does not give — the doc comment names each proof, including that the all-processes tier matches the recorded start and the routine count, so no exact-list guarantee is claimed there.
  - `[low]` `[patch]` Edge (claim): `tool_support.md` understates the release proof — same root as the second Blind row.
  - `[low]` `[reject]` Gap: the re-read under the release lock is pinned by no test — same root as the fifth Blind row.
  - `[low]` `[reject]` Gap: `AwaitNamesReadable` has no test or mutation — the mutation was run: both calls removed, the armed gate 25 of 25 green (recorded in Verification), so the wait is not observable with a 4-test suite on this build; `wontfix-accepted`, `reopen_if` a run reports `releasedBy: "supervisor"` or a name-readability `release-failed` on a fast suite (DW-595 covers the readiness half and is routed to 40-2).
  - `[low]` `[reject]` Gap: no automated path runs `CoverageReleaseTest` — `by-design`: every class under `src/ExecuteMCPv2/Tests` runs through `iris_execute_tests` (Rule #35), and the Verification loop now lists this one.
  - `[low]` `[patch]` Gap (other): the swap row's cleanup depends on name readability — same root as the first Blind row.
  - `[low]` `[patch]` Gap (other): `TestAllNamed`, the `NodeMatches` half of its test, and `ProofFailure`'s not-scoped and `AllNamed` clauses had no `mutation:` line — the four mutations were run on scratch copies and are recorded in Verification (Rule 19).
  - `[low]` `[patch]` Gap (other): the lock tests depend on the shared monitor lock being free — same root as the sixth Blind row (a false red only, never a false green).
  - `[low]` `[patch]` Gap (other): `tool_support.md` is stale — same root as the second Blind row.
  - `[low]` `[patch]` Intent: `tool_support.md:218` still states the pre-rework runner condition — same root as the second Blind row.
  - `[low]` `[patch]` Intent: the test comment cites `LineByLine.cls:249` for the list copy, which is line 248 — now `:248-249`.
  - `[low]` `[reject]` Intent: the first three calls of `StopOwnSession` sit outside its `Try` — `wontfix-theoretical`: they read process state or wait on a lock that cannot throw, none holds a lock when it fails, and `Run` wraps the call.
  - `[low]` `[reject]` Intent: `Launch`'s `reclaim` branch calls `Stop` outside the release locks — `wontfix-theoretical`: it runs only with both owners dead, so no second releaser exists, and the window is the microsecond one the earlier pass closed as theoretical; the Boundaries bullet binds the runner and the supervisor.
  - `[low]` `[reject]` Intent: no live row has test code swap in an all-processes session, so the all-processes row exercises only the request path — out of the item's scope: the MED asks for the request-path refusal, and the release path's mode check is pinned by the scoped swap row and the lock-drop row.
  - `[low]` `[reject]` Intent: the row's `pids: ""` assertion reads the helper's mapping, and the mode-1 probe claim is pinned by no committed test — the helper is the only reading the product makes, `TestScopedPidsTrustsOnlyAScopedSession` pins the mapping, and the row's red under the `:43` revert shows the wiring.
  - `[low]` `[reject]` Intent: the `StopIfList` all-processes tier proves identity by a marker, an empty list and a count — same root as the last Blind row.

## Design Notes

**Orchestrator decisions** (decided at the spec gate on 2026-10-17 as decisions #39 to #44 in `orchestrator-decisions-wave-6.md`; all six as recommended, with #41 adding the `MayTerminate` identity check before any `Terminate`):

1. **Surface and governance (AC 40.1.3).** Recommended: a new tool `iris_test_coverage`, `mutates:"write"` and disabled by default, with annotations `readOnly:false, destructive:true, idempotent:false, openWorld:false`.
   - **Visibility.** `core` excludes it and `developer` includes it. It joins `TOOL_PAIRS` with `iris_test_status`.
   - **The companion.** `iris_test_status` is the companion through an additive optional `coverageRunId`. Its keys stay `poll` (read) and `cancel` (write, disabled by default).
   - **Why.**
     - AD-4: a monitor that runs instance-wide is a new side effect, and `iris_execute_tests` is a frozen key.
     - AD-16: the running result can be resolved only through the companion.
     - AD-7: when in doubt, exclude from `core`. Pairing two tools that are both outside `core` moves no `core` row.
   - **Destructive.** The hint is true because the tool deletes its own oldest run records and runs arbitrary test code.
2. **Execution path (AC 40.1.2).** Recommended: a new job-owned route family, `/dev/test/coverage`, rather than either path the AC names.
   - **Why not the Atelier work queue.** Its `QueueAsync` (`irislib/%Api/Atelier/v8.cls:233-273`) runs `%UnitTest.Manager.RunTest` in a WorkMgr worker. The suite cannot run code in that worker, and the probe shows a session counts only the process that called `Start`. A process that already existed was not counted, even in all-processes mode.
   - **Why not `POST /tests`.** It runs synchronously in the CSP request process. Its life is one HTTP request of at most 60 s, so it has no re-attach path (AD-16), and the monitor's lifetime would be tied to a client request (AD-27).
   - **What happens to `POST /tests`.** It stays as it is and is documented as having no tool caller (Task 5). The Atelier queue keeps its caller.
3. **Ownership split under AD-27.** Recommended: two processes, a runner and a supervisor.
   - **The runner** is the one job that starts, runs and stops its own session (AD-27's rule, to the letter).
   - **The supervisor** is the run's durable owner process. It turns cancel and the time limit into terminating the runner, and it releases a session that a dead runner left behind.
   - **Reclaim.** A later run reclaims a session only when both processes are dead.
   - **Probe evidence.**
     - `$SYSTEM.Process.Terminate` is not trappable: the `Catch` did not run and the session stayed active. So the process that runs the tests cannot be the only releaser.
     - The counts survive the runner's death, but only a process in the session's process list can read them or the routine names (corrected in the implement stage; decision #45 lists the supervisor).
     - `Stop` works from another process.
   - **The alternative** is one job that runs the tests itself. It has no cancel, and a hung test would hold the instance-wide monitor until someone kills the job.
4. **Run storage.** Recommended: IRISTEMP (`^IRIS.TempExecuteMCPv2Coverage`), keeping the 20 most recent runs.
   - **Why.** It is visible from every namespace, so the owner record and its locks are instance-wide, like the monitor. It is not journaled, and it never writes to the user's database. It has the monitor's lifetime and the same lifetime as the Atelier queue that `iris_test_status` already relies on.
   - **Cost.** A handle does not survive an instance restart, and the not-found error says so.
   - **The alternative** is a journaled global in the home namespace.
5. **The executable-line definition** (what users see as the denominator). Recommended: the empirical rule below, applied in TypeScript to an IRIS token skeleton.
   - **Why.** The live counts show that the monitor never counts these lines: label lines, `Try`, own-line `Catch`, `} Else {` and `Do {`. Excluding them keeps `covered ⊆ executable`.
   - **Differences from the TestCoverage tool.**
     - It counts `ElseIf`, which the probe shows the monitor counts; TestCoverage drops every `else*`.
     - It does not mark the line before a `Catch`.
   - **Why TypeScript.** Keeping the rule there (AD-12) means a later tweak, for example after 40.2's fixture diversity, does not move the bootstrap.
6. **Limits** (no caller knob in 40.1):
   - at most 50 classes per run;
   - at most 200,000 measured INT lines;
   - a server-side run limit of 3600 s, matching `iris_execute_tests`' cap.

   The limits are sized from the probe. SyntaxColor took 2.4 s for 63,988 lines, and the monitor allocates shared memory for each line.

**Decisions #45 to #48** (after the implement stage's `intent gap`; they amend the Boundaries and spine AD-27):
- **#45, the session's process list** is the runner and its own supervisor, never all processes. Only a listed process can read a session's routine names and counts, and the supervisor must read a killed runner's.
- **#46, the identity proofs.** The supervisor (`Finish`) proves the active session is its run's by routine-name equality (`ProveOwnSession`). A request process that is not in the list cannot read the names, so it proves a session reclaimable by the session node, both owner locks free, the process list (`PidsMatch`) and the routine count. The residual is a foreign session whose listed processes have all ended, with the same routine count, started after the suite's own session was stopped by someone else: no live process can read it, so stopping it loses nothing anyone can read.
- **#47, matrix row 9** terminates the supervisor first, then the runner.
- **#48, a run never ends silent.** `counts-unreadable` and `release-failed` end a run `failed` (`isError:true`) with the test summary, any coverage read, the IRIS text in `error`, and `readError` from `Status`.

**AC interpretations** (apply and report):
- **R1 ("a run killed mid-flight leaves no monitor running").** Three paths are proven: the client stops waiting, a cancel, and the test process killed (rows 5, 7, 8). Killing both processes leaves a session that is suite-owned and dead until the next run reclaims it (row 9). That is AD-27's reclaim clause, and probe G showed termination cannot be trapped.
- **R2 (overhead).** The overhead is measured per monitored line, in the monitored process only. No other process is monitored.
- **R3 (privileges).** Privileges were verified under `_SYSTEM` (`%All`) only. A low-privilege account was not probed, because creating one is a security change on the shared instance; this is a residual risk. A privilege failure surfaces IRIS's own text (AD-31). Read from source:
  - `Start` and `Stop` take `Lock ^%SYS("MON-HOLD")`;
  - `$SYSTEM.Process.Terminate` is used only on the suite's own runner.
- **R4 (`.1` … `.N`).**
  - **How they are enumerated.** Through `RoutineCount` and `$ZU(135,23,cls)`, cross-checked against compiled key 50.
  - **The `.0` routine.** It is the method generator, which runs at compile time and has no INT source, so it is excluded.
  - **Methods with no INT code.** A method that only returns a constant compiles to no INT code (`OneLine` is absent from the fixture's INT), so 40.2 must report it as not measurable.
  - **The split.** A class spills into `.2` at about 64,000 INT lines.
- **R5 (output scope).** Coverage is per routine, grouped by class, with no class or method totals. Totals belong to 40.2's aggregation (Rule #52 seam).

**Probe evidence.** The probes ran on IRIS 2026.2 build 221U, Atelier v8, `default` localhost:52773, on 2026-10-18 around 00:27 to 00:45 UTC.
- The disposable `EXECMCPTMP401A` was created and removed. Probes `ExecuteMCPv2.Temp.Probe401A`–`M` were deleted. Leftovers were `[]` and `iris_doc_list` for `Probe401` was empty.
- The monitor was idle before every session and after the last one. Each session was stopped by the probe that started it.
- **Before the probes:** `$ZU(84,8)` was 0, and `$ZU(84,1)` raised `<FUNCTION>` while idle.

What the probes found:
- **Starting.** `Start(routines, $lb("RtnLine"), $lb($J))` returned OK. A second `Start` returned `ERROR #6062: The Monitor is already running`.
- **Process scope.**
  - The starting process was counted.
  - A child process that existed before `Start` was not counted, whether its own PID was in the list or all processes were enabled. A child started after `Start` was not counted when only the starting process was in the list (children do not inherit monitoring).
  - Only a child started after `Start` in all-processes mode was counted, and that mode was rejected for scoping.
  - A runner process that starts its own session and then runs `RunTest` is counted.
- **Ownership.**
  - A JOB'd process inherits `$USERNAME` and `$ROLES` (`_SYSTEM`/`%All`) and the namespace, and its principal device is `/dev/null`.
  - `Terminate` returned 1, the `Catch` did not run, and the session stayed active.
  - The owner lock was free after the process died, and `Stop` from another process returned OK.
  - The counts were still readable after the runner was killed: `40:1,41:1,42:3,43:3,44:1`.
- **Results.**
  - Row n is INT line n, and row 1 is the routine's header comment.
  - A routine that never executed returns 0 rows.
  - `ExecuteMCPv2` is mapped to `%ALL`, so a `%UnitTest.Manager` subclass works from the scratch namespace. `OnBeforeAllTests` saw `manager.ResultId` = 6, its own class name, `userparam` and the namespace.
  - `RunTest` without `^UnitTestRoot` ran no test: the root suite failed.
  - `TestInstance.UserFields` holds the run key. The SQL table `TestInstance_UserFields` does not exist.
- **The process list (implement stage, pass 2, live on the gate fixture, 2026-10-17).** `$ZUtil(84,10,2)` reports the scoped processes that are still alive, space separated and in ascending order of process id (not the order `Start` was given); an ended process leaves the list, and a list with no live process reads `0`. For the supervisor `1127955` and the runner `1127956` it read `1127955 1127956`, then `1127956` once the supervisor was killed, then `0` once the runner was killed. So `PidsMatch` accepts one or two entries, each the runner's PID, the supervisor's PID or `0`, with no repeat, and a reclaim (both owner locks free) sees `0`. This corrects the Boundaries' wording "exactly two entries, in order ... or `0`", which no list IRIS reports can satisfy; the proof keeps its substance and its recorded residual.
- **Cost.**
  - `SumTo(200000)` took 3.3 ms without the monitor and 8.7 ms with it (about 2.6×).
  - On a class of 1,500 methods, `.1` had 63,988 lines and `.2` had 8,020.
  - `Start` took 9 to 12 ms, and reading `Result` for 63,988 rows took 186 ms.
  - SyntaxColor took 2.4 s for 63,988 lines and 8 ms for 48. `Stop` took about 1 s with large routines.

**Oracle fixture** (`EXECMCPTMP401A`). The INT line numbers depend on this exact source, so use it verbatim. It is the probe source with the package renamed. `ExecuteMCPv2.Tests.CoverageFixture` (Task 6) uses the same body under its own class name.

```objectscript
/// Synthetic coverage oracle fixture (Story 40.1).
Class Story401.Fixture
{

ClassMethod Classify(pN As %Integer) As %String
{
    Set tResult = ""
    If pN < 0 {
        Set tResult = "negative"
    } ElseIf pN = 0 {
        Set tResult = "zero"
    } Else {
        Set tResult = "positive"
    }
    Quit tResult
}

ClassMethod SumTo(pN As %Integer) As %Integer
{
    Set tSum = 0
    For tI = 1:1:pN {
        Set tSum = tSum + tI
    }
    Quit tSum
}

ClassMethod Guarded(pFail As %Boolean) As %String
{
    Set tOut = "start"
    Try {
        If pFail {
            Throw ##class(%Exception.General).%New("ProbeFail")
        }
        Set tOut = "ok"
    } Catch ex {
        Set tOut = "caught"
    }
    Quit tOut
}

ClassMethod Unused() As %String
{
    // a comment line
    Set tX = 1
    Quit tX
}

ClassMethod Loop(pN As %Integer) As %Integer
{
    Set tI = 0
    While tI < pN {
        Set tI = tI + 1
    }
    Do {
        Set tI = tI - 1
    } While tI > 0
    Quit tI
}

ClassMethod OneLine() As %Integer
{
    Quit 42
}

ClassMethod Exercise() As %Status
{
    Do ..Classify(5)
    Do ..SumTo(3)
    Quit $$$OK
}

}
```

- **`Story401.FixtureTest Extends %UnitTest.TestCase`** has four methods:
  - `TestClassify` asserts `Classify(5)="positive"` and `Classify(0)="zero"`;
  - `TestSumTo` asserts `SumTo(3)=6`;
  - `TestGuarded` asserts `Guarded(0)="ok"`;
  - `TestLoop` asserts `Loop(2)=0`.
- **`Story401.SlowTest Extends %UnitTest.TestCase`** has one method, `TestSlow`: it asserts `SumTo(3)=6`, then runs `Hang +$Get(^Story401Hang, 3)`, then asserts true.
- **Skeleton strings of this INT routine** (for Task 6):
  - line 5 `L C:methodimpl {`;
  - line 6 `C:set`;
  - line 9 `} C:elseif {`;
  - line 11 `} C:else {`;
  - line 14 `C:quit }`;
  - line 21 `C:try {`;
  - line 26 `} C:catch {`;
  - line 35 `C:do {`;
  - line 37 `} C:while`;
  - line 41 `C:for {`.

  Lines 1-4 and 46 (comments) and 13, 34 and 43 (a lone `}`) have no skeleton entry.

The captured counts were `6:2,7:2,9:2,10:1,12:1,14:2,20:1,22:1,25:1,26:1,29:1,31:1,32:1,33:2,34:2,36:2,37:2,38:1,40:1,41:1,42:3,43:3,44:1`, over 48 INT lines. Lines 26, 34 and 43 are counted but not executable. The classes in `Probe401` were renamed to `Story401`: the header lines keep their count, and the method labels are sorted, so the line numbers are unchanged. The implement stage re-captures these values, and a mismatch is investigated, never edited to match.

**Executable rule.** These are the skeleton strings the probe saw. A `→ false` line is never counted by the monitor.

| Skeleton | Executable | Note |
|---|---|---|
| `L C:methodimpl {`, `L C:methodimpl`, `L C:public {` | false | Label keywords are `methodimpl`, `public` and `private`, right after `L` |
| `L C:methodimpl { C:new`, `L C:n` | true | Code on a label line (embedded-SQL helpers) |
| `C:set`, `C:quit }`, `C:if {`, `} C:elseif {`, `C:for {`, `C:while {`, `} C:while`, `C:do`, `C:throw`, `C:continue`, `C:return }`, `C:if C:set`, `C:e C:s` | true | Includes the legacy line `e  s x=0` |
| `C:try {`, `} C:catch {`, `C:catch {`, `} C:else {`, `C:e`, `C:do {`, `C:d {` | false | `try`/`catch`/`else`/`e`, and `do`/`d` followed by `{` |
| `C:try { C:d } C:catch { C:if { C:d L } C:else { C:throw } }` | true | The first token that counts, `d` (not followed by `{`), decides |

At INT level, code the compiler generates counts as part of the routine; 40.2 drops lines that have no class source. Examples are embedded-SQL helper labels such as the unreached `q` and `%sqllistUCQ`.

**Result shapes.**
- **Completed**, `structuredContent`: `{total, passed, failed, skipped, details, status:"completed", coverageRunId, runIndex, namespace, target, level, pid, runnerPid, startedAt, finishedAt, coverage:{complete, classes:[{class, routines:[{routine, lines, executableLines, coveredLines, percent, executableRanges, coveredRanges}]}], unmeasured:[{class, reason}]}, reclaimed?}`. `timeoutCapped` is added only by the primary call, and only when true.
- **Running:** `{status:"running", coverageRunId, runIndex, namespace, target, level, pid, runnerPid, startedAt, elapsedMs?, timeoutMs?, timeoutCapped?, partial, hint}`. The first text line is `COVERAGE RUN STILL EXECUTING — not finished, not failed. coverageRunId=<id>. Do NOT re-submit.`
- **Cancelled:** `isError:false`, `{status:"cancelled", …, reason, partial, coverage:{complete:false, …}}`.
- **Failed:** `isError:true`, `{status:"failed", coverageRunId, runIndex, namespace, pid, runnerPid, error, reason?, readError?, partial?, coverage?}`. `reason` is `counts-unreadable` or `release-failed` (decision #48); `partial` is the test summary and `coverage` the coverage that was read, when there is any.
- **Abandoned:** `isError:false`, `{status:"abandoned", coverageRunId, runIndex, namespace, note}`.
- **The text form is compact:** one status line, then one line per routine, for example `Story401.Fixture.1: 20 of 28 executable INT lines covered (71.43%); uncovered 8, 16-18, 23, 27, 47-48`, then `Not measured: …`. No JSON dump.
- **Refusal text:**
  - `suite`: `A coverage run is already active on this instance (coverageRunId=<id>, process <pid>, started <startedAt>); nothing was started. Wait for it with iris_test_status and try again.`
  - `foreign`: `Another Line-by-Line or PERFMON monitor session is active on this instance and was not started by this suite; nothing was started and that session was left untouched. Try again once it has ended.`

**Busy decision table** (`BusyDecision`, Task 1):

| Session node | Owners alive | Monitor active | List matches | Live non-terminal run | Decision |
|---|---|---|---|---|---|
| set | yes | any | any | any | `busy-suite` (with the session's fields) |
| set | no | yes | yes | any | `reclaim`: Stop, mark that run `abandoned`, set `reclaimed`, proceed |
| set | no | yes | no | any | `clear-busy-foreign`: kill the stale node and refuse as foreign |
| set | no | no | any | any | `clear-and-proceed`: mark that run `abandoned` if it is not terminal |
| unset | n/a | any | any | yes | `busy-suite` (with that run's fields) |
| unset | n/a | yes | any | no | `busy-foreign` |
| unset | n/a | no | any | no | `proceed` |

**Extend, don't copy (Rule 2).**
- **`coverageRunEnvelope` is a sibling of `testRunEnvelope`, not an extension of it.** Every one of `testRunEnvelope`'s `running`, `abandoned` and `cancelled` kinds is keyed by the Atelier `jobId`, and their first lines and `buildRunningHint` name it. A coverage branch would touch every kind and move bytes that are pinned. The sibling reuses `PartialSnapshot`, `TestDetail`, `resolveTestTimeout`, `TestClock` and the moved SQL helpers.
- **The SQL helpers move into `unit-test-results.ts`**, so that `test-status.ts` and `test-coverage.ts` share them without an import cycle.
- **IRIS-side reuse.** The IRIS side calls `BuildTestSpec` and `EnsureUnitTestRoot`; it does not copy them.
- **The gate** extends the 40.0 shape, and reuses `interop-namespace-fixture.ts` (`createInteropNamespace` with `interop:false`, the newly exported `putCompileSeed`, and `leftovers`) and its fixture class.

**Integration (Rules 1/2).**
- **Integration AC:** AC-5. The consumer `iris_test_status` reads the coverage record and produces the completed envelope.
- **Consumes:**
  - Story 36.1: `resolveTestTimeout` and the envelope types;
  - Story 36.2: the `%UnitTest_Result` SQL helpers;
  - Epic 3: `REST.UnitTest.BuildTestSpec`;
  - `Setup.EnsureUnitTestRoot`;
  - Story 39.1: `interop-namespace-fixture.ts`;
  - Story 39.6: `process-gate-helpers.ts`.
- **Consumed-by:**
  - Story 40.2, which maps the per-routine `hits` and `skeleton` and the run record's routines to class source, aggregates them, writes Cobertura and adds `minCoverage`. It extends the `coverage` object additively.
  - Story 40.3, which uses the `MONITOR_BUSY` pattern and the refusal catalog for its production busy guard.
  - Story 40.4, which adds the docs, the prompt's coverage step (the tool may be hidden or disabled) and the capstone. The capstone reuses `coverage-fixture.ts` and the foreign-session fixture methods.

**Ledger inbox (Rule 17).**
- **Declined DW-453:** closed with evidence. AC 40.1.2 does not choose `POST /tests`. The coverage path never calls `RunTests`: its runner runs `RunTest` in a JOB'd process whose principal device is `/dev/null` (probe M). `POST /tests` keeps no tool caller, and is documented as such in Task 5.
  - **Recommended terminal state:** `wontfix-accepted`.
  - **`reopen_if`:** a tool caller is added for `POST /tests`, or a direct caller reports a dropped or truncated response body from it.

**Spine follow-up (lead, Rule 20).**
- **AD-27:** record the runner/supervisor split from decision 3, and that a session counts only the process that started it. This binds 40.3 and every future monitor.
- **AD-16 (or a Conventions row):** record that coverage handles live in IRISTEMP and do not survive an instance restart, if decision 4 is accepted.
- **No AD-12 exception is needed.** IRIS returns raw counts and skeletons, and the busy check is AD-12's existing AD-27 exception.

**Governing ADs.**
- **AD-27:** ownership, the busy check, reclaim and the fixtures.
- **AD-16:** the `running` result, the companion, the pair and handles that reproduce the result.
- **AD-4:** the key, `mutates`, annotations and the frozen tool.
- **AD-7:** presets and the pair.
- **AD-14:** the bootstrap and both rosters.
- **AD-12:** raw data IRIS-side, the rule and the arithmetic in TypeScript.
- **AD-11, AD-13:** the envelope and namespace restore.
- **AD-33:** additive routes.
- **AD-15:** back-compatibility pins, and the snapshot regenerated with `--force` (decision #29).
- **AD-20:** the required `classes` scope and the line cap.
- **AD-31:** IRIS's own privilege errors.
- **AD-2:** the cross-package gate in `iris-mcp-all`.
- **AD-5:** `:check` only.
- **Conventions:** Tool results, Refusals, Error text, Live gates, Probes and references (earliest version verified: IRIS 2026.2 build 221U for `%Monitor.System.LineByLine`, `%UnitTest.Manager` hooks and `%Library.SyntaxColorReader`), Live testing on a shared instance, Performance budgets.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- MCP calls name `server:"default"` and one of the namespaces `HSCUSTOM`, `EXECMCPTMP401A` or `EXECMCPTMP401B`.

**Shared surfaces:** these change, and other tests assert on them.
- The dev tool array, its order and its counts (31 → 32 package, 32 → 33 advertised).
- The suite counts (109/114 → 110/115).
- Preset rosters (`core` exclude 17 → 18; `developer` 31 → 32) and the presets banner.
- `TOOL_PAIRS` (3 → 4).
- `REFUSAL_CODES` (8 → 9).
- The bootstrap rosters and count (32 → 35), `BOOTSTRAP_VERSION` and `bootstrap-classes.ts`.
- The tools-list snapshot (`entryCount` 115, and the `iris_test_status` entry).
- `pre-feature-tool-snapshot.ts`.
- The `data-policy-scope.ts` rows and date, and the `tool_support.md` PHI table.
- `gateTestFiles`, `GATES` and `live-gate-roster`.
- The `interop-namespace-fixture.ts` exports and its fixture-class methods.
- The README payload and roster tables, the dev README counts, `tool_support.md` counts and rows, and the CHANGELOG first section and the line `as of Story 39.5`.
- Every count pin listed in the Code Map.

Standing criterion: every test added or changed passes on a fresh environment, in either order.
- **Disposable fixtures:**
  - `EXECMCPTMP401A`, holding `Story401.Fixture`, `Story401.FixtureTest` and `Story401.SlowTest`;
  - `EXECMCPTMP401B`, which is empty;
  - `ExecuteMCPv2.Temp.Story391Fixture` in HSCUSTOM.
- **OS test classes** run one class per `iris_execute_tests` call, and `total` is compared with the class's `Test*` count (Rule #35). Never re-submit after a client timeout; poll `iris_test_status`.
- **Sessions.** No dev-package test and no OS test starts a session, and the gate checks the monitor is idle before it starts.

**Commands:**
- `(loop)` `iris_doc_load` into HSCUSTOM, each path an absolute glob (Rule #17): `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Coverage/*.cls`, `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/REST/Coverage.cls`, `…/src/**/REST/Dispatch.cls`, `…/src/**/REST/UnitTest.cls`, and `…/src/**/Tests/Coverage*.cls` (the fixture `CoverageFixture`, the empty class `CoverageFixtureEmpty` that `TestResolveRoutinesReasons` needs, and `CoverageJobTest`); then compile -- expected: clean.
- `(loop)` `iris_execute_tests` `ExecuteMCPv2.Tests.CoverageJobTest`, then, in a separate call, `ExecuteMCPv2.Tests.CoverageReleaseTest`, then, in a separate call, `ExecuteMCPv2.Tests.UnitTestTest` -- expected: totals equal the `Test*` counts, with 0 failures.
- `(loop)` `pnpm gen:bootstrap` twice, then `git diff --stat packages/shared/src/bootstrap-classes.ts` -- expected: one move, and the second run is idempotent.
- `(loop)` `pnpm --filter @iris-mcp/shared build`, then `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/refusals.test.ts src/__tests__/tool-visibility.test.ts src/__tests__/tool-visibility-backcompat.test.ts src/__tests__/bootstrap.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build`, then `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/test-coverage.test.ts src/__tests__/test-status.test.ts src/__tests__/test-status-governance.test.ts src/__tests__/execute.test.ts src/__tests__/index.test.ts src/__tests__/presets.test.ts` -- expected: pass.
- `(loop)` Build admin, interop, ops and data, one call each, then `pnpm gen:tools-list-snapshot --force`, then `pnpm gen:tools-list-snapshot:check` -- expected: OK, with only the two entries differing.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-40-1-doc-claims.test.ts src/__tests__/data-policy-scope.test.ts src/__tests__/tools-list-snapshot.test.ts src/__tests__/story-39-6-qa-snapshot-cli.test.ts src/__tests__/docs-prompt-sync.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/tool-visibility-snapshot-drift.test.ts src/__tests__/test-status-governance-keys.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/story-39-1-gate-guards.test.ts src/__tests__/changelog-bootstrap-move.test.ts src/__tests__/gate-helper-copies.test.ts src/__tests__/interop-namespace-fixture.test.ts` -- expected: pass.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-40-1-coverage-live-gate.test.ts` -- expected: every row passes, none is skipped, the monitor is idle and nothing is left.
- `(loop)` `ENV pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/test-status-epic-gate.test.ts`, then the same for `src/__tests__/execute-tests-running-contract-epic-gate.test.ts` -- expected: pass (the moved helpers).
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one command each: `build`, `test`, `lint` and `type-check`. Then run `ENV pnpm --filter @iris-mcp/all test`, split into calls that each finish inside the cap -- expected: green.
- `(once)` One call each: `pnpm gen:governance-baseline:check` (exit 0, `1e62c5ad5bf7`/141), `pnpm measure:tools-payload` (equal to the README rows) and `node scripts/check-epics-sync.mjs` (OK).
- `(once)` Measure the bootstrap of 35 classes against an armed gate (deployed-version log timing) -- expected: under 60 s; record the figure here.
- `(once)` After every armed run:
  - `MonitorState` is `{active:0}`;
  - leftovers for A and B are `[]`;
  - `iris_namespace_list` and `iris_database_list` show neither namespace;
  - `iris_doc_list` (HSCUSTOM, `Story401`, `Story391Fixture`, `ExecuteMCPv2.Temp.`, generated included) is empty;
  - `iris_global_get` `IRIS.TempExecuteMCPv2Coverage` `"session"` is undefined.

**Planned mutations (Rule 19).** Apply each one, observe red, revert, then reload or rebuild what it touched. Confirm that `git status --short` and `git diff --stat` are unchanged, and record it as `mutation: <change> -> <test that went red>`. A mutation that could leave a session behind runs only with the gate's `afterAll` safety net in place, and is followed by the idle check.
- **AC-1:** make `isExecutableSkeleton` count `C:else` → the `test-coverage.test.ts` rule table and gate row 1 (29 executable lines).
- **AC-2:** drop the `busy-foreign` branch → gate row 10. The runner's `Start` then fails with 6062, so the result is `failed` and not a refusal; nothing is harmed.
- **AC-3:** remove the supervisor's release → gate row 8. The `afterAll` safety net stops the leftover session through `StopIfList`.
- **AC-4:** make `BusyDecision` refuse a dead-owner session → `CoverageJobTest` table row 2 and gate row 9.
- **AC-5:** make `pollCoverageRun` read the test summary from the caller's `namespace` default instead of the record's namespace → gate row 6 (row 1's reproduction differs: zero tests).
- **AC-6:** change `mutates` to `"read"` → `test-coverage.test.ts` and `test-status-governance-keys`/AC-6 rows.
- **AC-7:** change the moved `METHOD_ORDER` → the existing `test-status.test.ts`.
- **AC-8:** delete the `UnitTest.cls` doc sentence → `story-40-1-doc-claims`.
- **AC-9:** skip `gen:bootstrap` after a class edit → `bootstrap.test.ts` drift check and `assertDeployedBootstrapVersion`.

**Implementation results (Rule 19, recorded by the implement stage, resumed pass, 2026-10-17).** Each mutation was applied (an IRIS class through a scratch copy loaded into HSCUSTOM, so the tree stayed byte-identical, md5 checked; TypeScript in place with a backup compared by md5), observed red, reverted, and the touched IRIS class reloaded or the touched package rebuilt. After every session-capable mutation the monitor was checked idle (`MonitorActive` = 0) and `^IRIS.TempExecuteMCPv2Coverage("session")` unset. The unmutated state was then re-run green. Before the first fix of this pass one armed run stranded a suite session (the `PidsMatch` finding in the Spec Change Log); it was stopped by hand once the run record (supervisor 1127787 and runner 1127788 dead, session started and never released, routine list `Story401.Fixture.1`, started inside that gate run) proved it was this gate's.
- `mutation: "else" removed from NEVER_COUNTED in isExecutableSkeleton (28 -> 29 lines) -> test-coverage.test.ts "} C:else {" -> false, "the oracle skeleton has 28 executable lines because an else line is never counted", "routineCoverage against the matrix row 1 oracle" (two rows), the completed-envelope row and the release-failed envelope row`
- `mutation: Launch allocates a run id ($Increment) in its busy-foreign branch -> gate row 10 ("no run id was allocated": expected 107 to be 106)`
- `mutation: the supervisor's release block skipped in Finish -> gate row 8 (status and counts differ from the runner-ended result; the stranded session was stopped by the afterEach safety net through the newest run record, monitor idle afterwards)`
- `mutation: the runner's StopOwnSession never called -> gate row 1 ("the runner stopped its own session": received supervisor)`
- `mutation: BusyDecision refuses any defined session as busy-suite (owner liveness ignored) -> CoverageJobTest:TestBusyDecisionTable rows 2, 3 and 4 (reclaim, clear-busy-foreign, clear-and-proceed) and gate row 9 ("A coverage run is already active ... nothing was started"); the afterEach safety net left the monitor idle`
- `mutation: PidsMatch never rejects a foreign process (its foreign-PID condition replaced by 0) -> CoverageJobTest:TestPidsMatchIsTheSuiteProcessesStillAliveOrZero (a second entry that is a foreign process, a first entry that is a foreign process, only a foreign process)`
- `mutation: the MayTerminate condition removed from the supervisor's Terminate call -> gate "the MayTerminate decoy" row (expected cancelled to be completed: the real runner was terminated)`
- `mutation: the release-failed override removed from Finish -> gate "release-failed" row (the run ends completed; coverage run did not reach failed within 120000 ms)`
- `mutation: the counts-unreadable override removed from Finish -> gate "counts-unreadable" row (the run ends completed; did not reach failed within 90000 ms)`
- `mutation: Runner.StopOwnSession ignores the %Status of ReadCounts -> gate "counts-unreadable" row (readError is "The monitor session ended before its line counts were read.", not IRIS's <LIST> text)`
- `mutation: REST.Coverage.BuildRun leaves readError out -> gate "counts-unreadable" row (readError undefined)`
- `mutation: Launch's reclaim branch marks a finished run abandoned (the IsTerminal guard removed) -> gate "release-failed" row ("reclaiming a finished run's session leaves its status alone": received abandoned)`
- `mutation: Job.ResolveRoutines leaves pError empty -> CoverageJobTest:TestResolveRoutinesReportsANamespaceErrorAndRestores ("the error text is returned")`
- `mutation: REST.Coverage.ReadRun skips the RunExists check -> CoverageJobTest:TestReadRunRejectsUnknownAndMalformedIds (an unknown id is an error, the three message parts)`
- `mutation: coverageRunEnvelope drops reason and readError from the failed envelope -> test-coverage.test.ts "failed with counts-unreadable", "failed with release-failed" and "a poll of a failed run with a reason returns the same result the primary call returns"`
- `mutation: coverageTextLines drops the "no executable INT lines" branch -> test-coverage.test.ts "a measured routine without an executable line is reported as such in the text"`
- `mutation: the class-name sentence deleted from the tool description -> test-coverage.test.ts "the description leads with what it does ..."`
- `mutation: testCoverageTool.handler replaced by a stub -> test-coverage.test.ts "the exported tool runs the handler on the real clock ..."`
- `mutation: pollCoverageRun reads the completed summary in the profile namespace instead of the record's -> gate "row 6 (the second half)" (total 412 instead of 4) and gate "rows 5 and 6" (total 412 instead of 1)`
- `mutation: TestSpec leaves the package spec as BuildTestSpec returns it (":A;:B") -> CoverageJobTest:TestTestSpecSeparatesPackageClassesBySemicolon (three assertions) and gate "levels" (a package run of 0 tests: "no test method ran")`
- `mutation: TestSpec makes a method-level spec run the whole class -> gate "levels" (total 4 instead of 1)`
- `mutation: Launch's clear-busy-foreign branch also stops the active session -> gate "clear-busy-foreign" ("the foreign session is still active": received 0)`
- `mutation: Launch's clear-and-proceed branch does not mark the dead run abandoned -> gate "clear-and-proceed" (recorded running, not abandoned)`
- `mutation: Launch no longer calls Prune -> gate "retention" ("20 records after it": expected 48 to be 20)` (re-applied in code review, after the row's assertions moved to -1025 and exactly 20)
- `mutation: Job.MAXRUNS 20 -> 200 -> CoverageJobTest:TestPruneDefaultLimitIsTwentyRuns ("the default limit is the 20 most recent runs") and TestReadRunRejectsUnknownAndMalformedIds ("and how many runs are kept")` (code review: the test replaced TestPruneDefaultKeepsTheTwentyMostRecentRuns, which pruned real records)
- `mutation: MayTerminate no longer compares the PID with the record's -> CoverageJobTest:TestMayTerminateIsTrueOnlyForTheProcessHoldingTheRecordedRole ("a PID that differs from the record's, the lock still held")`
- `mutation: MayTerminate returns true without the owner-lock check -> the same test ("the supervisor's lock is free although the PID matches its record" and "the process has ended and released its lock")`
- `mutation: LineSkeleton keeps a skeleton for a line with no command -> CoverageJobTest:TestLineSkeletonFromTokens and TestSkeletonHasNoEntryForCommentsAndLoneBraces (lines 13, 34 and 43)`
- `mutation: ValidateStart accepts maxSeconds 0 -> CoverageJobTest:TestValidateStartChecksMaxSecondsAndMaxLines ("maxSeconds 0")`
- `mutation: resolveTestTimeout(timeout, undefined) in the handler (IRIS_TEST_TIMEOUT ignored) -> test-coverage.test.ts "timeout precedence: IRIS_TEST_TIMEOUT applies when no timeout argument is given"`
- `mutation: the test summary read by coverageRunId instead of runIndex -> test-coverage.test.ts "sends the documented limits ...", "poll reads the test summary in the record's namespace, not the profile's" and test-status.test.ts "poll with coverageRunId alone returns the coverage result ..." (the run's runIndex is 12 and its coverageRunId 9 in the fixtures)`
- `mutation: the busy refusal text names coverageRunId without quotes -> test-coverage.test.ts "busy, owner suite: MONITOR_BUSY ..."`
- `mutation: the coverageRunId branch of iris_test_status skipped -> the five tests of test-status.test.ts "iris_test_status - coverageRunId (Story 40.1)"`
- `mutation: the zero-result rule skipped in resultForRun -> gate "a target that names no test class" (the run is reported as 0 tests with no error)`
- The next four pinning tests (AC-6 to AC-9) are unchanged by the resumed pass, so their first-pass lines stand:
- `mutation: mutates "write" -> "read" on iris_test_coverage -> test-coverage.test.ts "is the governed write the Boundaries describe" and test-status-governance-keys.test.ts "derives the one key iris_test_coverage, classified write ..."`
- `mutation: METHOD_ORDER " ORDER BY %EXACT(tc.Name), %EXACT(tm.Name)" -> " ORDER BY tc.Name, tm.Name" -> test-status.test.ts "value identity with the DRAIN path, run 94 ..."`
- `mutation: the UnitTest.cls "No MCP tool calls POST /tests" comment deleted -> story-40-1-doc-claims "ExecuteMCPv2.REST.UnitTest documents that no MCP tool calls POST /tests ..."`
- `mutation: a comment line added to the bootstrapped Coverage/Job.cls without gen:bootstrap -> bootstrap.test.ts "embedded class contents match disk .cls files" and "BOOTSTRAP_VERSION matches SHA-256 hash of concatenated disk contents"`. `assertDeployedBootstrapVersion` has no separately reproducible red path here: the gate's deployed-version check compares the deployed stamp with the embedded constant, and the drift test above already fails first.

**Bootstrap timing.** The deployed `ExecuteMCPv2.Setup` in HSCUSTOM was reloaded from disk (`BOOTSTRAPVERSION` = `dev`, so stale), and the armed gate then opened the dev server: `[INFO] story-40-1-coverage-live-gate: the dev server opened (startup bootstrap included) in 1.5 s` (35 classes redeployed; `GetBootstrapVersion()` read `10af536e8fbd` afterwards). Well under the 60 s bound. In the resumed pass the stamp moved to `4ac115159db0` and each armed run after a move opened the dev server in 1.4 s with the 35 classes redeployed. The gate has 21 rows: matrix rows 1 to 11, 13 and 14, plus the `MayTerminate` decoy, `counts-unreadable`, `release-failed`, `clear-busy-foreign`, `clear-and-proceed`, `retention`, `levels` (method and package) and the unknown target. All 21 pass in one run (71 s), and rows 7, 8, 10, 11, 13 and the decoy each pass alone.

**Findings the lead should know.**
- `.gitignore` carried `coverage/`, which (`core.ignorecase=true`) also ignored the new package directory `src/ExecuteMCPv2/Coverage/`, so `Job.cls` and `Runner.cls` would not have been committed. A `!src/ExecuteMCPv2/Coverage/` negation was added right after the rule; `git status` now lists the directory as untracked.
- The tools-list payload rows were re-measured after the description gained the class-name sentence: dev `33 / 89,756 / ~22,439` (full and developer), core `15 / 43,878 / ~10,970` (unchanged); the README rows equal `pnpm measure:tools-payload`, and `pnpm gen:tools-list-snapshot:check` reports 115 entries unchanged after `--force`.
- The reclaim proof of decision #46 was corrected against the live process-list format (Spec Change Log). The lead should amend the contract sentence.

**QA stage (Rule 19), 2026-10-17.** Gap analysis of the matrix and the ACs against the implement stage's gate. The gate is a second file because the first holds 21 rows on one dev server process; this one drives several built dev server PROCESSES at once over stdio with the real SDK `Client`.
- (QA) `packages/iris-mcp-all/src/__tests__/story-40-1-qa-live-gate.test.ts` (12 rows, ~28 s armed, run serially after the 40.1 gate; also listed in `scripts/prepublish-gate.mjs` `gateTestFiles` and in `story-39-1-gate-guards.test.ts` `GATES`). Command: `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-40-1-qa-live-gate.test.ts`. Fixtures: `EXECMCPTMP40S` (`Story401.*` oracle classes, `Story401Q.Empty`), `EXECMCPTMP40T` (`Story401Q.Tiny`, `Story401Q.TinyTest`), both without Interoperability, and `ExecuteMCPv2.Temp.Story391Fixture`; all removed, leftovers `[]`. Passes alone, twice shuffled, and serially after the 40.1 gate (33 tests).
- (QA) Corrections to the QA brief, verified live: a default (`full` preset) dev server LISTS `iris_test_coverage` (33 tools, annotations as the Boundaries say) and refuses the call with `GOVERNANCE_DISABLED`; the `core` preset (15 tools) is what hides it, and an enabled-by-recipe `core` server still answers `Tool iris_test_coverage not found`; `developer` lists it and refuses it. The rows pin these three, not "absent by default".
- (QA) Rows and what each pins: default/core/developer listing and refusal (AC-6, row 14); the documented recipe alone runs the oracle (20 of 28, 71.43%), checked against the INT source read through the raw Atelier route, a default-governance second process reproducing the result deep-equal, and the recipe not enabling `iris_test_status:cancel` (AC-1, AC-5); a run re-attached by a fresh process after the starting process was closed (AD-16); `MONITOR_BUSY` from another process for any arguments and namespace, a refused cancel not signalling the run, and the run completing with its own counts (AC-4, row 11); every schema rule of `classes`/`level`/`timeout`/`target` as the built server words it; the 50-name boundary, an absent class, a wrong-case class, a class with no routine, another namespace's class, an empty target, a missing namespace; de-duplication and order; `level:"method"` with an existing and an absent method; a second namespace with different classes (100% by hand from its INT source); `coverageRunId` with `jobId`/`runIndex`, an unknown, a malformed and a mismatched namespace against a real record (row 16).
- `mutation: core preset includes iris_test_coverage (moved from exclude to include in presets.ts) -> QA gate "the core preset hides iris_test_coverage even when the recipe enables it" (core does not list the coverage tool)`
- `mutation: mutates "write" -> "read" on iris_test_coverage -> QA gate "a default dev server lists iris_test_coverage ... refuses the call as GOVERNANCE_DISABLED" (the default call ran a real coverage run: isError undefined)`
- `mutation: resultForRun reads the completed summary in another namespace -> QA gate "the oracle run completes with 20 of 28 lines" and "the starting server process is closed while the run executes" (no test method ran, runIndex read in the wrong namespace)`
- `mutation: "else" removed from NEVER_COUNTED in isExecutableSkeleton -> QA gate "the oracle run completes with 20 of 28 lines" and "classes are de-duplicated with the order kept" (29 executable lines)`
- `mutation: busyRefusal leaves the namespace field out -> QA gate "a second server process is refused as MONITOR_BUSY owner suite" (the structured refusal differs)`
- `mutation: CLASS_NAME_PATTERN accepts a * in a segment -> QA gate "the schema layer rejects every malformed argument" (a trailing wildcard reaches the route instead of the schema)`
- `mutation: the zero-result rule disabled in resultForRun (total === 0 -> total < 0) -> QA gate "level method: ... a method that does not exist" (reported as 0 tests with no error)`
- `mutation: namespaceMismatch never reports a mismatch -> QA gate "iris_test_status with coverageRunId refuses what cannot name a run" (the namespace error is missing)`
- `mutation: the handler waits 100 times its budget (deadline = startTime + timeoutMs * 100) -> QA gate "the starting server process is closed while the run executes" and "a second server process is refused as MONITOR_BUSY" (the budget did not expire: completed, not running)`
- Each mutation was applied to the TypeScript source, the dev dist rebuilt, the targeted rows run armed and seen red, then reverted by Edit and the dist rebuilt; `md5` of `test-coverage.ts`, `presets.ts` and `test-status.ts` equals the value taken before the first mutation, and `git status --short` shows only the QA files. The monitor was idle and `("session")` unset after every run (a row that failed mid-run was stopped by the gate's `afterEach` through `StopIfList`).
- (code review, 2026-10-17) Mutations of this review's patches, each applied to a scratch copy loaded into HSCUSTOM (the tree byte-identical, md5 checked) or to the TypeScript source with an md5-checked backup, observed red, reverted, and the real classes reloaded; the monitor was idle and `("session")` unset afterwards:
- `mutation: Runner.StopOwnSession's ListsProcess($Job) guard removed -> gate "a test that releases every lock of its process" ("the test process did not stop the session started after its own": expected +0 to be 1)`
- `mutation: ProveOwnSession's routine-list check replaced by If 0 -> gate "release-failed by the routine-name proof" (no reason release-failed: the supervisor stopped the session)`
- `mutation: Job.ScopedPids returns the list in every mode -> CoverageJobTest:TestScopedPidsTrustsOnlyAScopedSession (four assertions)`
- `mutation: the description's cancel-key and INT-offset sentences changed -> test-coverage.test.ts "the description leads with what it does and states the default state, the operator control, the guard and the process scope"`
- (QA) Finding, pinned by the gate and not fixed here: the monitor's INT line n is line n + 1 of the document `iris_doc_get` and `iris_routine_intermediate` return for `<routine>.int`, because document line 1 is the `ROUTINE <name> [Type=INT,Generated]` header (the tool's `lines` is the document's line count minus 1). The tool description and the dev README say "read it with `iris_doc_get` on `<routine>.int`" without the offset, so a client that reads document line 8 for "uncovered 8" gets `If pN < 0 {`, not `Set tResult = "negative"`.

**Rework iteration 1 (Rule 19), 2026-10-18.** Mutations of this pass's pinning tests. Each was applied to a scratch copy of the IRIS class loaded into HSCUSTOM (the tree byte-identical, md5 checked) or to the TypeScript source with an md5-checked backup, observed red, reverted, and the real classes reloaded. The monitor was idle, `("session")` unset and `^%SYS("MON-HOLD")` free afterwards.
- `mutation: Job.MonitorActive reads $ZUtil(84,10,2) in every mode (the revert of the ScopedPids call at Job.cls:43) -> gate "all-processes foreign session (decision #49)" ("a session of all processes has no scoped process list, so the suite reads none": expected '1114' to be ''). On this build the revert alone does not turn the decision into a reclaim: the list of an all-processes session reads the starting process and then others, never the dead pair, so the refusal and "still active" assertions stay green and the pids and node assertions go red`
- `mutation: Launch's clear-busy-foreign branch kills the ownership node whatever the session's mode (SessionDisproved bypassed) -> gate "all-processes foreign session (decision #49)" ("the ownership node is kept": expected false to be true); the scoped "clear-busy-foreign" row stays green`
- `mutation: NodeDisproved no longer requires a process list of the session's own -> CoverageReleaseTest:TestNodeMatchesAndNodeDisproved ("a session with no list of its own disproves nothing: the node is kept")`
- `mutation: ProofFailure no longer requires the process list to name the caller -> CoverageReleaseTest:TestProofFailureNamesWhatDoesNotProveASession ("a list with no live process does not list this one", "a list that names only the other process")`
- `mutation: ProofFailure drops the PidsMatch check -> the same test ("a list with a foreign process", "the same process twice")`
- `mutation: ProofFailure drops the routine-name equality -> the same test ("another routine", "one routine more"), gate "a session that test code started in place of the suite's" (the run ends completed: the test process read and stopped the other session) and gate "release-failed by the routine-name proof"`
- `mutation: the runner's StopOwnSession no longer asks RunnerOwnsSession -> gate "a session that test code started in place of the suite's" (the run ends completed); the lock-drop row stays green, because its ListsProcess guard turns that session away first`
- `mutation: ProveOwnSession no longer asks ProofFailure -> gate "release-failed by the routine-name proof" and gate "a session that test code started in place of the suite's"`
- `mutation: the supervisor's Finish no longer takes the release locks -> gate "release-failed: a session whose release cannot take the monitor's own lock" (the error carries IRIS's ERROR #6060, not the lock text)`
- `mutation: the runner's StopOwnSession no longer takes the release locks -> the same gate row ("nothing is read from a session that was not locked for its release": the run carries coverage)`
- `mutation: TakeReleaseLocks does not let go of the release lock when the monitor lock times out -> CoverageReleaseTest:TestTakeReleaseLocksLetsGoOfTheReleaseLockWhenTheMonitorLockTimesOut ("the release lock was let go again")`
- `mutation: TakeReleaseLocks takes another lock in place of ^%SYS("MON-HOLD") -> CoverageReleaseTest:TestTakeReleaseLocksHoldsBothLocksUntilDropped and ...LetsGoOfTheReleaseLockWhenTheMonitorLockTimesOut`
- `mutation: TakeReleaseLocks takes another lock in place of the release lock -> CoverageReleaseTest:TestTakeReleaseLocksHoldsBothLocksUntilDropped, ...HoldsNothingWhenTheReleaseLockTimesOut and ...LetsGoOfTheReleaseLockWhenTheMonitorLockTimesOut`
- `mutation: StartForeignAll without its monitor-idle check -> interop-namespace-fixture.test.ts "the all-processes foreign session (decision #49) starts only with the monitor idle, only on the fixture's own routine, and is the one Start in the fixture class without a process list"`
- (code review of rework 1, 2026-10-18) Mutations of the pinning tests the review found without a line, each applied to a scratch copy of `Job.cls` loaded into HSCUSTOM (the tree byte-identical, the real class reloaded afterwards), observed red by `CoverageReleaseTest`, and reverted:
- `mutation: AllNamed returns 1 for every list -> CoverageReleaseTest:TestAllNamed ("one name is not", "no routine at all") and TestProofFailureNamesWhatDoesNotProveASession ("a name this process cannot read", "no routine at all")`
- `mutation: NodeMatches drops its PidsMatch check -> CoverageReleaseTest:TestNodeMatchesAndNodeDisproved ("a foreign process", "no process list", "a scoped session of a foreign process disproves it")`
- `mutation: ProofFailure drops its not-scoped clause (empty process list) -> CoverageReleaseTest:TestProofFailureNamesWhatDoesNotProveASession ("an empty list is a session of all processes or a paused one")`
- `mutation: ProofFailure drops its AllNamed clause -> CoverageReleaseTest:TestProofFailureNamesWhatDoesNotProveASession ("a name this process cannot read", "no routine at all")`
- Mutation run that stayed green (recorded, not pinned): both `AwaitNamesReadable` calls removed (`Runner.StopOwnSession` and `Job.Finish`), scratch copies of both classes loaded, the armed 40.1 gate run -> 25 of 25 passed, so no row observes the wait: on this build the monitor makes the names readable within the 4-test oracle suite's run, and no fixture can delay it. The wait only makes the proofs reachable sooner on a faster suite (DW-595, routed to 40-2).
- Not pinned by a mutation: the re-read of `sessionReleased` and `hasCounts` under the release lock (it closes a race between the two releasers that no deterministic test can force), and the reworded comments, the doc edits and the swap row's cleanup marker (which only makes its cleanup independent of whether the fixture process can read the routine names).

## Auto Run Result

Status: done
Blocking condition: none

**Rework iteration 1 (2026-10-18).** The six open `[Review][Patch]` items of "Lead re-review of the two HIGH patches" were worked, and nothing else. `BOOTSTRAP_VERSION` moves `bdaff1eec1fa` -> `4dd596fa2a0c` (35 classes; `gen:bootstrap` twice, idempotent; the CHANGELOG, `tool_support.md`, the changeset and `story-40-1-doc-claims.test.ts` follow; the story's move is now `08b8adeaadc6` -> `4dd596fa2a0c`). A four-layer review (Blind, Edge, Verification-gap, Intent-alignment) ran on the frozen diff of this pass; the lead's re-review follows.

- **MED, the all-processes row.** Fixture `StartForeignAll` (monitor idle, the fixture's own routine only, recorded for `StopIfList`) and the gate row "all-processes foreign session (decision #49)": refused `MONITOR_BUSY` foreign, still active, no scoped process list, node kept, then the next start clears it and completes. The row stops the session itself and asserts the monitor idle.
- **Release locks.** `Job.TakeReleaseLocks` / `DropReleaseLocks`: the run's release lock (10 s), then `^%SYS("MON-HOLD")` (5 s), held from the identity proof through `Stop`, by the runner and by `Finish`; a timeout stops and reads nothing, and the run ends `release-failed`. Under the locks each re-reads `sessionReleased` and `hasCounts`. The `release-failed` gate row now asserts no coverage and the lock text.
- **Proofs.** `Job.ProofFailure` (process-scoped, lists the caller, `PidsMatch`, every name readable, names equal the run's): the runner asks it through `RunnerOwnsSession`, `ProveOwnSession` asks it too. New gate row "a session that test code started in place of the suite's" pins the runner's wiring.
- **Node.** `Launch` kills the ownership node in `clear-busy-foreign` only when `SessionDisproved` (a scoped list that does not match).
- **Test comment** reworded; `Job.ScopedPids` comment reworded to what the probe saw.
- **Review findings.** 31 findings (high 0, medium 0, low 30, false 1): 15 rows patched in 8 entries, 0 deferred, 16 rejected with the reasons in the triage log (15 low, 1 false). Patched: the swap row's cleanup now records the fixture's foreign marker (`SwapTest`), `tool_support.md` and the dev README describe the proof and the two locks, the `Job.cls` header and the `ScopedPids` comment, `CoverageReleaseTest`'s monitor-lock hold is capped at 3 s (the monitor lock is the one other projects wait 3 s for), the `LineByLine.cls:248-249` citation, and four missing `mutation:` lines (run and recorded). Rejected in substance: the re-read under the release lock is unpinned (no deterministic interleaving), `AwaitNamesReadable` is unobservable (its removal left the armed gate 25 of 25 green), the `foreignAll` fixture tier, the kept stale node (the lead's own item), `Launch`'s reclaim `Stop` outside the locks.
- **Follow-up review recommendation: false.** This follow-up pass patched no high; patched counts by verdict: low 15 rows (8 entries).
- **Verification.** `CoverageJobTest` 31 of 31, `CoverageReleaseTest` 6 of 6 and `UnitTestTest` 6 of 6 (their `Test*` counts, one class per call); the armed 40.1 gate 25 of 25 (the dev server opened in 1.5 s with the 35 classes redeployed) and the armed QA gate 12 of 12, none skipped; the two armed dev epic gates; `@iris-mcp/all` armed in six calls, 86 files (54 + 13 + 3 + 7 + 7 + the two 40.1 gates), 4 tests skipped by their own conditions; shared 2066, dev 1527, admin 498, interop 670, ops 350, data 165 and client-config 514 tests with build, lint (one pre-existing shared warning) and type-check clean; `gen:bootstrap` idempotent; governance `:check` OK, `gen:tools-list-snapshot:check` OK (115 entries), `check-epics-sync` OK, the README payload rows equal `measure:tools-payload`. Mutations: 14 from the implement pass plus 4 from the review, each red then reverted; the AwaitNamesReadable removal stayed green and is recorded as such. The monitor was idle, `("session")` unset and `^%SYS("MON-HOLD")` free after every run; no `EXECMCPTMP40*` namespace or database, `ExecuteMCPv2.Temp.`, `Story391Fixture` or `Story401` document is left in HSCUSTOM.
- **Residual risks.** A runner whose release phase outlasts the supervisor's 60 s wait plus the 10 s lock wait is reported `release-failed` though it releases the session (needs a release phase over 70 s); a foreign scoped session whose processes are all dead and whose routine count matches the stale node stays reclaimable (decision #46's residual, now with a longer node life while an all-processes or paused foreign session is active); `CoverageReleaseTest` still takes `^%SYS("MON-HOLD")` for under 2 s per lock test on the shared instance.
- **For the lead.** (1) The `:43` revert is red through the pids and node assertions, not through reclaim (see the first mutation line). (2) A `release-failed` run whose lock timed out carries no coverage, unlike the previous pass. (3) The supervisor's proof now also uses `PidsMatch`, a superset of what the item asked. (4) `CoverageJobTest.cls` is at 500 lines, so the new unit tests are in `CoverageReleaseTest.cls`. (5) `Launch`'s `reclaim` branch still calls `Stop` outside the release locks; it runs only when both owners are dead.
