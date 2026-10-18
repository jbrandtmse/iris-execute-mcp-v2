---
title: 'Story 40.1: Line Coverage Probe and Engine'
type: 'feature'
created: '2026-10-17'
status: 'in-review'
baseline_revision: '966f6ee65f72f01435007cf4018a512fabd0e5ff'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
warnings:
  - oversized
deferred: []
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
    - the active session's process list has exactly two entries, in order, each equal to the record's `runnerPid` and `pid` or `0` (an ended process);
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
  - **Afterwards, always, catch path included:**
    - it reads the `RtnLine` count of every line of every routine through the `%Monitor.System.LineByLine:Result` query. Row n is INT line n, and a routine that never ran returns no rows, so every count is 0 (probe);
    - it records the counts, or, when reading them fails, records that error as `readError` and never marks the counts as read (decision #48);
    - it calls `Stop` and records `released`.
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
- **Process scope.** No `Process` list other than `$ListBuild(<runner $JOB>, <its own supervisor's pid>)` (decision #45); never all processes and never another process.
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
   - `ResolveRoutines(pNS, pClasses, .pUnmeasured)`;
   - `BusyDecision(pMonitorActive, pSessionDefined, pOwnersAlive, pListMatches, pLiveRun)`, which returns `proceed|reclaim|clear-and-proceed|clear-busy-foreign|busy-suite|busy-foreign`;
   - `Skeleton(pNS, pRoutine)`;
   - record helpers (allocate, prune to 20, read, set status, liveness by lock);
   - `Supervise(pId)`, the job entry point.

   This class is the AD-27 job mechanics and returns raw data only.
2. `src/ExecuteMCPv2/Coverage/Runner.cls` (new, `Extends %UnitTest.Manager`). Implement `Run(pId)` (the job entry point), `OnBeforeAllTests` (records `manager.ResultId`, then returns `$$$OK`) and `ReadCounts`, exactly as the Boundaries say.
3. `src/ExecuteMCPv2/REST/Coverage.cls` (new, `Extends ExecuteMCPv2.REST.Base`). Implement `ValidateStart`, `Start`, `Status` and `Cancel`:
   - validation through `ValidateStart`, then the namespace switch with restore on every path (AD-13);
   - the busy decision and launch under the start lock;
   - the `outcome` result.
4. `src/ExecuteMCPv2/REST/Dispatch.cls`: add the three routes (AD-33: additive only).
5. `src/ExecuteMCPv2/REST/UnitTest.cls`: a class doc-comment-only change, saying that no MCP tool calls `POST /tests`. `iris_execute_tests` uses the Atelier work queue, and `iris_test_coverage` uses the coverage routes. The route stays for direct REST callers (AD-33). This addresses AC 40.1.2's "documented" and closes DW-453 with evidence (Design Notes).
6. `src/ExecuteMCPv2/Tests/CoverageFixture.cls` and `CoverageJobTest.cls` (new). The tests cover:
   - the `BusyDecision` table, all 7 rows;
   - `ResolveRoutines` for the fixture and a missing class (`not-compiled`);
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
      - `StopIfList(pRoutines)`: stops only when the active list is exactly `pRoutines`;
      - `TerminateCoverageProcess(pPid)`: refuses unless `pPid` is the `pid` or `runnerPid` in `^IRIS.TempExecuteMCPv2Coverage("session")` and `ExecuteMCPv2.Coverage.Job.MayTerminate` is true for that role, checked immediately before the call (decision #41).
    - Mirror any roster test of the fixture's methods.
18. `packages/iris-mcp-all/src/__tests__/story-40-1-coverage-live-gate.test.ts` (new).
    - **Shape.** The 40.0 gate shape, with its own `REQUIRE_LIVE`, the shared, dev, admin and interop freshness lines, `assertDeployedBootstrapVersion` straight after `openWireSession`, the tag `story-40-1-coverage-live-gate`, and the armed text `IRIS_REQUIRE_LIVE is set, so the Story 40.1 live gate may not be skipped: <reason>`.
    - **Rows.** Matrix rows 1-11, 13 and 14, run in order. Every row ends with an idle assertion. `afterAll` calls `StopIfList("Story401.Fixture.1")` and `StopIfList("ExecuteMCPv2.Temp.Story391Fixture.1")` as a safety net, removes A and B and the fixture class, and asserts that leftovers are `[]`.
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

## Spec Change Log

- **2026-10-17, lead spec gate.** Decisions #39 to #44 were taken as recommended. Decision #41 adds `Job.MayTerminate` (Boundaries: Supervisor, Never, Task 17), so a PID reused after its process died is never terminated. Spine AD-27 and AD-16 are amended (Rule 20).
- **2026-10-17, lead, after the implement stage's `intent gap` (G1).** Decisions #45 to #48 answer its four questions:
  - #45: the runner's session lists the runner and its own supervisor (Runner clause; Never "Process scope"; Design Notes probe note corrected). Spine AD-27 amended.
  - #46: `Finish` keeps the full routine-name proof, because the supervisor is listed. Reclaim by an unlisted request process uses the strict process-list and routine-count proof in Boundaries, with its residual recorded.
  - #47: matrix row 9 terminates `pid` first, then the runner.
  - #48: a run whose counts could not be read, or whose session could not be stopped, ends `failed` with `counts-unreadable` or `release-failed` and is never silent; `readError` is returned.

  The saved patch `spec-40-1-line-coverage-probe-and-engine-attempt-1.patch` (md5 `ac1f6cf6bb2e93ab112fb94b6110691e`) is re-applied cleanly to the working tree, then removed from `_bmad-output` (it is not committed), and the spec resumes at review (`in-review`). The review's `patch` rows, and its `bad_spec` rows now covered by #48, are worked in that pass.

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
- **Failed:** `isError:true`, `{status:"failed", coverageRunId, runIndex, namespace, pid, runnerPid, error, partial?, coverage?}`.
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
- `(loop)` `iris_doc_load` into HSCUSTOM, each path an absolute glob (Rule #17): `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Coverage/*.cls`, `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/REST/Coverage.cls`, `…/src/**/REST/Dispatch.cls`, `…/src/**/REST/UnitTest.cls`, `…/src/**/Tests/CoverageFixture.cls` and `…/src/**/Tests/CoverageJobTest.cls`; then compile -- expected: clean.
- `(loop)` `iris_execute_tests` `ExecuteMCPv2.Tests.CoverageJobTest`, then, in a separate call, `ExecuteMCPv2.Tests.UnitTestTest` -- expected: totals equal the `Test*` counts, with 0 failures.
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

**Implementation results (Rule 19, recorded by the implement stage 2026-10-17).** Each mutation was applied, observed red, reverted (the file's md5 or `git diff --stat` checked against the pre-mutation copy), and the touched IRIS class reloaded or the touched package rebuilt. After every session-capable mutation the monitor was checked idle (`$ZU(84,8)` = 0) and a leaked session, where one remained, was stopped by hand after proving it was this story's. The unmutated state was then re-run green.
- `mutation: isExecutableSkeleton counts C:else (28 -> 29 lines) -> test-coverage.test.ts "isExecutableSkeleton ... counting else would add the else lines", the two "routineCoverage against the matrix row 1 oracle" rows, and gate row 1`
- `mutation: busy-foreign branch dropped from the decision -> gate row 10 (the runner's Start fails and the result is failed, not a refusal)`
- `mutation: the supervisor's release removed -> gate row 8 (the afterAll safety net stopped the leftover session; monitor idle afterwards)`
- `mutation: BusyDecision refuses any defined session as busy-suite (owner liveness ignored) -> CoverageJobTest:TestBusyDecisionTable rows 2, 3 and 4 (reclaim, clear-busy-foreign, clear-and-proceed) and gate row 9 ("A coverage run is already active ... nothing was started"); the monitor was already idle afterwards (the gate's afterAll stopped the session), and the stale session node was cleared by the next unmutated run; reverted, CoverageJobTest 25/25`
- `mutation: pollCoverageRun/resultForRun reads the completed summary from the profile namespace instead of run.namespace -> test-coverage.test.ts "poll reads the test summary in the record's namespace, not the profile's", and gate rows 1 and "rows 5 and 6" (total 412 and 30 instead of 4 and 1; row 1 also reads the wrong namespace, so it goes red as well as row 6)`
- `mutation: mutates "write" -> "read" on iris_test_coverage -> test-coverage.test.ts "is the governed write the Boundaries describe" and test-status-governance-keys.test.ts "derives the one key iris_test_coverage, classified write ..."`
- `mutation: METHOD_ORDER " ORDER BY %EXACT(tc.Name), %EXACT(tm.Name)" -> " ORDER BY tc.Name, tm.Name" -> test-status.test.ts "value identity with the DRAIN path, run 94 ..."`
- `mutation: the UnitTest.cls "No MCP tool calls POST /tests" comment deleted -> story-40-1-doc-claims "ExecuteMCPv2.REST.UnitTest documents that no MCP tool calls POST /tests ..."`
- `mutation: a comment line added to the bootstrapped Coverage/Job.cls without gen:bootstrap -> bootstrap.test.ts "embedded class contents match disk .cls files" and "BOOTSTRAP_VERSION matches SHA-256 hash of concatenated disk contents"`. `assertDeployedBootstrapVersion` has no separately reproducible red path here: the gate's deployed-version check compares the deployed stamp with the embedded constant, and the drift test above already fails first.

**Bootstrap timing.** The deployed `ExecuteMCPv2.Setup` in HSCUSTOM was reloaded from disk (`BOOTSTRAPVERSION` = `dev`, so stale), and the armed gate then opened the dev server: `[INFO] story-40-1-coverage-live-gate: the dev server opened (startup bootstrap included) in 1.5 s` (35 classes redeployed; `GetBootstrapVersion()` read `10af536e8fbd` afterwards). Well under the 60 s bound. 13 of 13 gate rows passed, none skipped.

**Findings the lead should know.**
- `.gitignore` carried `coverage/`, which (`core.ignorecase=true`) also ignored the new package directory `src/ExecuteMCPv2/Coverage/`, so `Job.cls` and `Runner.cls` would not have been committed. A `!src/ExecuteMCPv2/Coverage/` negation was added right after the rule; `git status` now lists the directory as untracked.
- The shared tools-list payload rows were re-measured at the end and still match the README (dev `33 / 89,340 / ~22,335`, core `15 / 43,878 / ~10,970`); `pnpm gen:tools-list-snapshot:check` reports 115 entries unchanged.

## Auto Run Result

Status: blocked
Blocking condition: intent gap

**Implement pass 1 (2026-10-17).** The implementation was complete and passed every `## Verification` command (`CoverageJobTest` 25/25, `UnitTestTest` 6/6, shared 105 and dev 238 targeted tests, the 13-file `iris-mcp-all` group 193 tests, `gen:bootstrap` idempotent at 35 classes, armed live gate 13/13, nine mutations red and reverted). Review then found that the contract cannot be met as written. The code was reverted and the attempted change is saved as `_bmad-output/implementation-artifacts/spec-40-1-line-coverage-probe-and-engine-attempt-1.patch` (55 files, md5 `ac1f6cf6bb2e93ab112fb94b6110691e`, applies cleanly to `966f6ee` with `git apply`; the generated `bootstrap-classes.ts` and tools-list snapshot are in it). Nothing was committed.

**The unresolved questions are the four listed at the end of the Review Triage Log** (group G1, inside `<intent-contract>`):
1. Allow the runner's session to be scoped to `$ListBuild($JOB, supervisorPid)`. A live mutation on 2026-10-17 (runner-only list) turned 7 of 13 gate rows red, because only a process in the session's list can read its routine names and line counts, so the supervisor cannot read a killed runner's counts (matrix rows 7 and 8).
2. Decide whether the release and reclaim identity proof may be "process list plus routine count" (names are unreadable from a new request process), including the residual case where `PidsMatch` accepts an ended (`0`) process entry.
3. Matrix row 9: terminate `pid` first, then `runnerPid`.
4. (Design Notes, not the contract) what a completed run reports when its counts cannot be read or its session cannot be released.

Recommended re-dispatch: amend the contract and AD-27 (Rule 20), `git apply` the patch, set `status: in-review` and re-run the review step. The triage rows marked `patch` (21) are small fixes for the review step's patch handling once the patch is applied. The `bad_spec` rows (5) all hang on question 4 and need that Design Notes decision first.

**Left behind on the shared instance.** The monitor is idle (`$ZU(84,8)` = 0), `^IRIS.TempExecuteMCPv2Coverage("session")` is unset, `EXECMCPTMP401A`/`B` and every `Story401`/`ExecuteMCPv2.Temp.` class are gone. HSCUSTOM still holds the additive attempt: `ExecuteMCPv2.Coverage.Job`, `Runner`, `REST.Coverage`, the three `Tests.Coverage*` classes, the three routes in the deployed `Dispatch`, and the stamp `10af536e8fbd`. The next bootstrap against the reverted tree (`08b8adeaadc6`) redeploys the 32 original classes and drops the routes. Package dists were last built from the attempted tree and must be rebuilt after the patch is applied or reverted.

The plan stage halted after planning, as instructed. The live probes ran on the shared instance (`default`, IRIS 2026.2 build 221U). Before every session they confirmed the monitor was idle, and they stopped every session they started. They created and removed `EXECMCPTMP401A` (leftovers `[]`) and deleted the probe classes `ExecuteMCPv2.Temp.Probe401A`–`M`. The monitor was idle when the stage finished. Six orchestrator decisions are listed under Design Notes.
