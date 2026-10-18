---
title: 'Story 40.2: Coverage Reports and Targets'
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_revision: '4da459e838dad43e5bbbe3fb14bd0b4b07f4c5a2'
baseline_commit: '4da459e838dad43e5bbbe3fb14bd0b4b07f4c5a2'
review_loop_iteration: 0
followup_review_recommended: true
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

**Problem:** `iris_test_coverage` (Story 40.1) reports coverage in INT lines only. A developer needs coverage on the class source they edit: per class and per method, with the uncovered line ranges, a Cobertura XML file that CI tools read, and a `minCoverage` target with a pass/fail verdict.

**Approach:** At the end of a run, the IRIS side records raw data that maps class-source lines to INT lines, using `%Studio.Debugger:INTLine` per method body line. TypeScript then builds the class and method summary and the verdict on every result (AD-12). The minimum is stored with the run, so the companion `iris_test_status` reproduces the summary and the verdict from the handle alone (AD-16). Cobertura is written by a new companion write action, `iris_test_status` `action:"export"`, which takes an explicit `outputPath` and is default-disabled. Story 40.1's ledger items DW-596 and DW-598 are closed here, and DW-595 was closed with evidence at planning.

## Boundaries & Constraints

**Always:**

- **The mapping (AC 40.2.1).** This is the rule the plan-stage probe found (Design Notes). A line counts as class source only when it is a body line of a method that the class itself defines with ObjectScript code (CodeMode `code`, `expression` or `call`). Its INT line comes from `%Studio.Debugger:INTLine("<class>.CLS", <method>, <offset>, …)`, where offset k = 1 … n is the k-th body line. Only `returntype` 0 counts: returntype 1 means "no INT line here, here is the next mapped line", and 2 means "no mapping". Either way, that body line has no INT line.
  - **Line numbers.** Class line numbers are those of the class document as `iris_doc_get` returns `<class>.cls`. IRIS stores a class in its own layout: one blank line between members, signatures on one line, a blank line after the class `{`. So an uploaded file in another layout can number its lines differently. In the stored layout the declaration line D is followed by `{` on D+1, and body offset k is document line D+1+k.
  - **Executable and covered.** A class line is executable when its INT line's skeleton is executable under 40.1's `isExecutableSkeleton`, unchanged. It is covered when that INT line's count is above 0. Its `hits` is that count.
  - **Generated code.** An executable INT line that no class line maps to is *generated*: code the compiler generated (`%NormalizeObject`, property methods, the output of method generators, embedded-SQL helper labels, the label line's `New`, the unreached `q`). It is reported per class as a count only, never as source lines.
  - **Methods without a class-source mapping.** A method whose CodeMode is `objectgenerator` or `generator` has reason `generator` (its body runs at compile time, and the INT code it generates counts as generated). A method whose Language is not ObjectScript has reason `not-objectscript`. A method whose declaration, `{` line or `}` line (at D+2+n) is not where the layout says has reason `layout`.
  - **Classes without one.** A class whose definition changed after it was compiled (`$System.OBJ.IsUpToDate` false) gets no class-source result: `source.reason: "not-up-to-date"`. Its INT coverage is unchanged.
- **Raw data on the IRIS side (AD-12).** The supervisor's `Finish` captures the mapping right after the token skeleton, in the run's namespace, with the namespace restored (AD-13). It uses a new `Job.SourceMap` beside `Job.Skeleton`, and keeps it in the run record.
  - **Per class:** `{class, reason?, methods:[{name, line, routine, intLines:[…]} | {name, line, reason}]}`. `line` is D, or null when it cannot be found. `intLines[k-1]` is the INT line of body offset k, or 0 when that line has none.
  - **The `Status` route** returns this as `sources`, an additive top-level array. It is present exactly when `routines` is present.
  - Every judgment (executable, covered, generated, percent, verdict) is made in TypeScript.
- **`minCoverage` (AC 40.2.4).**
  - **Where it lives.** It is optional on `iris_test_coverage`: a number from 0 to 100. It goes in the `Start` body, where `ValidateStart` checks the same range, and is stored as `("run",id,"minCoverage")`. `Status` returns it when set. Without it the result carries no verdict, and nothing else changes.
  - **The verdict** is `coverage.verdict = {minCoverage, overall, percent, classes:[{class, verdict, percent, reason?}]}`. It is on `completed` results only.
  - **Per class:**
    - `pass` when the class-source ratio, unrounded, is at least the minimum;
    - `fail` below it;
    - `notApplicable` when the class has 0 executable class lines;
    - `fail` with a `reason` when a listed class has no class-source result (unmeasured, or `not-up-to-date`).
  - **Overall** is `pass` when the unrounded aggregate over every class with a source result is at least the minimum and no class has `fail` with a reason. Otherwise it is `fail`. When no class has an executable class line and none failed with a reason, it is `notApplicable`.
  - **No tool error.** The verdict never sets `isError`: a completed run with a failing verdict is `isError:false`.
- **The summary (AC 40.2.2).** It appears on every envelope that carries `coverage`, from the primary call and from `poll` alike:
  - **Per class:** each `coverage.classes[i]` gains `source: {executableLines, coveredLines, percent, executableRanges, coveredRanges, uncoveredRanges, methods:[{method, line, executableLines, coveredLines, percent, uncoveredRanges, reason?}], generated:{executableLines, coveredLines}}`, or `source: {reason}`. The methods are listed in the order the class document declares them.
  - **Overall:** `coverage.source = {executableLines, coveredLines, percent}` is the total over the classes with a source result.
  - **Arithmetic.** `percent` and the ranges reuse 40.1's `percentOf` and `toRanges`.
  - **The text:**
    1. the status line;
    2. when there is a verdict, `Coverage target <min>%: PASS|FAIL (<percent>% overall)`, plus `; failing: <class> <percent>%|(<reason>), …`;
    3. per class, `<class>: <c> of <e> class lines covered (<p>%); uncovered <ranges>`, followed by one indented line, `  <method>: <c> of <e> (<p>%); uncovered <ranges>`, for each method that has an uncovered line;
    4. then 40.1's per-routine INT lines and the `Not measured:` line, both unchanged.
  - **Back-compatibility.** When `Status` returns no `sources`, for example from an older IRIS-side class, the result is exactly 40.1's shape and text. Every field that existed before 40.2 keeps its value (AD-15).
- **Cobertura through the companion (AC 40.2.3, AD-16).** `iris_test_status` gains `action:"export"`.
  - **Governance.** Its key `iris_test_status:export` is `mutates:"write"`, with no `defaultEnabled`, so it is DEFAULT-DISABLED.
  - **Arguments.** It requires `coverageRunId` and `outputPath`. `sourceRoot` and `namespace` are optional, and `namespace` is checked against the run's, as for `poll`. Passing `jobId` or `runIndex`, or `outputPath` or `sourceRoot` with `poll` or `cancel`, is a validation error. So is a missing `outputPath`.
  - **What it writes.** Only a `completed` run whose `coverage.complete` is true and that has `sources`. For any other run it is `isError:true`, the error names the status, and nothing is written.
  - **The path.** `outputPath` goes through `iris_doc_export`'s guard, moved to `local-path.ts` and called with the label `outputPath`. It must be absolute, contain no `..` segment, and end in `.xml` (any case). A bad path is an error, and nothing is sent or written.
  - **The write.** The parent directory is created recursively, and the file is written to a temporary sibling, then renamed. An existing file is overwritten.
  - **The result** is the `poll` result plus `cobertura:{outputPath:<resolved absolute>, bytes, classes, lines}` and one text line: `Cobertura XML written to <path> (<bytes> bytes).`
  - **Annotations.** `iris_test_status` keeps its annotations: `readOnlyHint:false`, `destructiveHint:true` and `idempotentHint:false` already cover overwriting a file. `iris_test_coverage` takes no path and writes no file.
- **The Cobertura document** (built in TypeScript, and deterministic for a given run):
  - **Validity.** It validates against the pinned `coverage-04.dtd` (Design Notes, decision 3). It starts `<?xml version="1.0" ?>`, then `<!DOCTYPE coverage SYSTEM "https://raw.githubusercontent.com/cobertura/web/master/htdocs/xml/coverage-04.dtd">`.
  - **`<coverage>`** has `line-rate`, `lines-covered`, `lines-valid`, `branch-rate="0"`, `branches-covered="0"`, `branches-valid="0"`, `complexity="0"`, `version="iris-mcp-dev <@iris-mcp/dev version>"` and `timestamp=<finishedAt in epoch milliseconds>`.
  - **`<sources><source>`** holds `sourceRoot` when it is given; otherwise the `<sources>` element is left out.
  - **`<package>`.** There is one per class package, in first-seen order.
  - **`<class>`** has `name` (the class) and `filename`. The filename is the path `iris_doc_export` gives the class relative to its `destinationDir` (`docNameToFilePath`), for example `Story402/Fixture.cls`. Each class has `<methods>`: one `<method name signature="" line-rate branch-rate="0">`, with its `<lines>`, per mapped method that has an executable class line, and no method `complexity`. It then has `<lines>`: one `<line number hits/>` per executable class line, in ascending order.
  - **Rates** are `covered/valid` rounded to 4 decimal places. They are written without trailing zeros, and as `1` when nothing is valid.
  - **What is left out.** Generated INT lines, classes without a source result, and unmeasured classes.
  - **Escaping.** Names and the source root are XML-escaped.
- **DW-598 (shared-instance safety, AD-27).** Right after a successful `Start`, before `RunTest`, the runner compares the routines the session loaded (`GetRoutineCount` and the names, which the starting process can read at once; probe) with the run's list. On a mismatch:
  - the run ends `failed`, and `error` names the routines that were not loaded and says that no test was run;
  - no test runs;
  - the runner stops its own session at once, under the release locks, only after proving it is the run's (scoped, listing exactly its pair, every name readable, and every name in the run's list);
  - nothing is left active, the `("session")` node is unset, and the next run starts normally.

  If that `Stop` fails, the ownership node and `routineList` are first rewritten to the list the session actually loaded. The supervisor's release, or failing that the next start's reclaim, can then prove the session and stop it, so the session is never orphaned. A run whose session nobody could stop ends `release-failed`, as in 40.1. Every other path of 40.1's runner and supervisor is unchanged.
- **AD-33 / AD-15.** `Start` accepts every 40.1 request unchanged, and `Status` returns a superset. Every existing `iris_test_status` `jobId`/`runIndex` path, and `iris_execute_tests`, stay byte-identical.
- **Bootstrap (AD-14).** `Job.cls`, `Runner.cls` and `REST/Coverage.cls` change, so run `pnpm gen:bootstrap` once the IRIS classes are final, and record `BOOTSTRAP_VERSION` `14a4cba6504a` → new in this story's CHANGELOG section. It stays at 35 classes, because no class is added to the bootstrap.
- **Text.** Source is ASCII, written with escapes (Rule 14), and comments state the contract.
- **Shared instance.**
  - Only the iris-mcp-all live gates start Line-by-Line sessions. That package runs its files serially. No dev-package test and no OS test class starts a session.
  - The gate starts each row with the monitor idle. When a session it did not start is active, the armed gate fails and names it, and the session is left alone.
  - Fixtures live only in the disposable `EXECMCPTMP402A`, which has no Interoperability and is created and removed by the gate, in `ExecuteMCPv2.Temp.Story391Fixture`, and in the gate's own temporary directory. Leftovers are `[]`.

**Never:**

- No file write on `iris_test_coverage` or on `poll`. No `minCoverage` on the companion. No new tool, preset row, `TOOL_PAIRS` entry or refusal code. No change to `iris_execute_tests`.
- Never fetch anything at test time. No DTD file is vendored and no third-party text is copied into the repo (decision #52): the validator encodes the pinned DTD's content model as its own data.
- No change to the 40.1 executable rule, to the per-routine INT fields, to the busy decision, or to the release and reclaim proofs (Rule #52 seam). The only exception is the DW-598 branch.
- No monitor call outside the runner and supervisor paths 40.1 defines. `Status` and `export` never start, stop or terminate anything.
- No copied reference code: the community TestCoverage tool is prior art only (AD-12).
- No hand-edit of generated files. The governance check runs as `:check` only. No `changeset version` and no publish.

## I/O & Edge-Case Matrix

**Fixtures.**

- **The classes.** The rows use `EXECMCPTMP402A`, holding:
  - `Story402.Fixture`, uploaded with exactly the text in Design Notes;
  - `Story402.Layout`, uploaded in a non-canonical layout;
  - `Story402.Gone`;
  - the tests `Story402.FixtureTest` and `Story402.SlowTest`, which hangs `^Story402Hang` seconds.
- **The oracle values** are captured live by the implement stage (Rule #36). The plan-stage predictions in Design Notes are for orientation only: a mismatch is investigated, never edited to match.
- **The calls** name `server:"default"`.

| # | Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|---|
| 1 | Summary oracle (AC 40.2.1, 40.2.2) | `iris_test_coverage {target:"Story402.FixtureTest", level:"class", classes:["Story402.Fixture","Story402.Layout","Story402.Missing"], namespace:"EXECMCPTMP402A"}` | `completed`. The `coverage.classes[i].source` of Fixture and Layout deep-equals the captured oracle. Generated `coveredLines` is not pinned: the embedded-SQL helper runs only on the first execution after a compile. `coverage.source` equals the totals. The text lines are as in the Boundaries. The 40.1 fields of `routines` are unchanged. `Story402.Missing` is `not-compiled`. Idle afterwards. | None |
| 2 | The mapping points at the right lines | Row 1's result, and the class documents read by raw Atelier `GET /doc` (never the tool) | Every uncovered and covered line number names the statement the oracle expects. For example, Fixture's only uncovered line is `Quit "error"` in `Macro`. A `#define` line, a continuation line of a multi-line statement, a lone `}` and a comment line are never executable. `Generated` has reason `generator`; `Constant` has 0 executable lines (it has no INT code); `Py` is `not-objectscript`. | None |
| 3 | Non-canonical layout (Rule #58) | `Story402.Layout`, uploaded with extra blank lines, a multi-line signature, tab indentation and no blank line between members | Its line numbers are those of the document `iris_doc_get` returns, not of the uploaded text. The row asserts that the two numberings differ for at least one reported line. | None |
| 4 | Verdict fail, no tool error (AC 40.2.4) | Row 1's call with `minCoverage: 90` | `isError:false`, `verdict.overall:"fail"`. Fixture `pass`; Layout `fail`; Missing `fail` with `reason:"not-compiled"`. A `FAIL` text line names Layout and Missing. | None |
| 5 | Verdict pass at the boundary | `classes:["Story402.Fixture","Story402.Layout"]` and `minCoverage` equal to Layout's exact percent | Layout `pass` (the ratio is equal); `overall:"pass"` | None |
| 6 | Unrounded comparison | `minCoverage` set to the aggregate percent rounded up at the 2nd decimal, when it is not exact | `overall:"fail"`, although the displayed `percent` rounds to the minimum | None |
| 7 | Companion reproduces (AD-16, Integration) | `iris_test_status {action:"poll", coverageRunId}` for rows 1 and 4, by handle only | The `structuredContent` deep-equals the primary call's, including `source` and `verdict`. A second poll is equal. | None |
| 8 | Export disabled by default | `action:"export"` under default governance | `GOVERNANCE_DISABLED` on `iris_test_status:export`; no file | Refusal |
| 9 | Export writes Cobertura (AC 40.2.3) | Enabled; row 1's handle; `outputPath:"<tmp>/x/y/coverage.xml"` (the parents do not exist) | The file exists and validates against the pinned DTD's content model (`cobertura-dtd.mjs`). Parsed back, its packages, classes, methods, line numbers and hits equal row 1's `source` data. `filename="Story402/Fixture.cls"`; no `<sources>`. The result is the poll result plus `cobertura`. | None |
| 10 | Export again with a source root | The same handle, another path, `sourceRoot:"src"` | Identical bytes, except `<sources><source>src</source></sources>`. A third export to the first path overwrites it with identical bytes. | None |
| 11 | Export of a run that is not complete | A `running` SlowTest run (hang 20 s), then the same run after a cancel | `isError:true`, text naming the status, no file; the run is unaffected | Error |
| 12 | Bad `outputPath` | Relative; with a `..` segment; ending `.txt`; missing; together with `jobId` | Validation error naming `outputPath` (or the combination); nothing sent to IRIS, no file | Error |
| 13 | DW-598: routine gone before `Start` | `classes:["Story402.Fixture","Story402.Gone"]`. A fixture job holds the predicted run's runner owner lock for about 5 s, and `Story402.Gone`'s compiled routine is deleted while the runner waits | `failed`, `isError:true`; `error` names `Story402.Gone.1` and says no test ran; `runIndex` null. Idle at once, `("session")` unset. The next row-1-style call completes with no `reclaimed`. | Error |
| 14 | DW-596: a read at the cap | A synthetic terminal run record of 200,000 INT lines over 4 routines, with hits, skeletons and a source map, seeded by a fixture method and removed afterwards | `iris_test_status poll` returns within 2 s with the summary computed. The implement stage records the `Status` time, bytes and process memory in Verification. | None |
| 15 | Back-compat | Every existing `iris_test_status` and `iris_execute_tests` test, and 40.1's dev tests whose mocked Status has no `sources` | Unchanged and green; 40.1's text and shapes stay byte-identical without `sources` | Unchanged |
| 16 | Bad `minCoverage` | `-1`, `101`, `"x"` (zod); raw `Start` with `minCoverage:101` | Validation error; nothing started | Error |

</intent-contract>

## Code Map

**Probe facts the implementation depends on** are in Design Notes ("Probe evidence"). Each one is load-bearing.

**IRIS side**
- `src/ExecuteMCPv2/Coverage/Job.cls`:
  - `Skeleton` :525 is the sibling of the new `SourceMap` (the same namespace switch and restore);
  - `CreateRun` :401 (store `minCoverage`);
  - `Finish` :738: the skeleton block :791-799 is where the source map is captured;
  - `ProofFailure` :142, `TakeReleaseLocks`/`DropReleaseLocks` :187-211 and `ListsEqual` :264 are reused by DW-598;
  - the class doc comment :1-31.
- `src/ExecuteMCPv2/Coverage/Runner.cls`: `Run`, where `Start` is at :37 and the session-node writes at :42-45, is where the DW-598 check goes; `StopOwnSession` :77 is the release pattern to reuse.
- `src/ExecuteMCPv2/REST/Coverage.cls`:
  - `ValidateStart` :143 and `ReadInteger` :219 (a decimal reader is needed for `minCoverage`);
  - `Launch` :307 and `CreateRun`;
  - `BuildRun` :434, with `BuildRoutines` :499 as the sibling of `BuildSources`;
  - the doc comment :1-19.
- System source:
  - `irislib/%Studio/Debugger.cls`: `INTLine` :879 (the returntypes are in its doc comment) and `SourceLine` :973 (rejected; Design Notes);
  - `irislib/%Atelier/v1/Utils/TextServices.cls:15` `GetTextAsArray`;
  - `irislib/%SYSTEM/OBJ.cls:1717` `IsUpToDate`;
  - `irislib/%occKeyword.inc`: `cMETHcodemode` 25, `cMETHimplementation` 30, `cMETHlanguage` 32;
  - `irislib/%Monitor/System/LineByLine.cls:56-70` (`Start` silently skips a routine with no object code).
- Tests: new `src/ExecuteMCPv2/Tests/CoverageSourceTest.cls` (≤ 500 lines) and the fixture `CoverageSourceFixture.cls`. Both are test-only and out of the bootstrap. `CoverageJobTest.cls` is at 500 lines, so do not grow it. Use `Tests/CoverageReleaseTest.cls` as the template.
- Bootstrap: `scripts/gen-bootstrap.mjs` needs no roster change. `packages/shared/src/bootstrap-classes.ts:25` `BOOTSTRAP_VERSION` is generated.

**TypeScript, dev** (`packages/iris-dev-mcp/src/tools/`)
- `test-coverage.ts`:
  - `CoverageRun` :79 (gains `minCoverage?` and `sources?`);
  - `buildCoverageSection` :235 and `coverageTextLines` :274;
  - `coverageRunEnvelope` :353 (completed :397);
  - `resultForRun` :505 and `pollCoverageRun` :564;
  - the Start POST body :682;
  - the description :742 and `inputSchema` :772;
  - `isExecutableSkeleton` :129, `toRanges` :155 and `percentOf` :175, which are reused unchanged.
- `test-status.ts`:
  - the description :502-533;
  - the schema :534-574;
  - `mutates` :597;
  - the handler routing :601-626 (the `coverageRunId` branch :609).
- `export.ts`: `validateDestinationDir` :168 and `assertInsideRoot` :189 move to the new `local-path.ts`. The `destinationDir` message texts stay byte-identical.
- `load.ts:247` `docNameToFilePath` gives the Cobertura `filename`.
- New files: `coverage-report.ts` (the pure summary, totals, verdict and text helpers), `cobertura.ts` (`buildCoberturaXml`, `writeCoberturaFile`) and `local-path.ts`.
- Tests:
  - `src/__tests__/test-coverage.test.ts`, whose mocks without `sources` stay byte-identical (matrix row 15);
  - `test-status.test.ts` and `test-status-governance.test.ts` (keys :78-190);
  - `export.test.ts`, unchanged and green.

**Repo-level test utility**
- New `scripts/lib/cobertura-dtd.mjs`, the DTD validator. It holds the pinned DTD's content model as its own data (decision #52); no DTD file is vendored, and the script is not in any package's `files`.
- The precedent for tests importing `scripts/lib` is `iris-mcp-all/src/__tests__/data-policy-scope.test.ts:20`.

**iris-mcp-all** (`packages/iris-mcp-all/`)
- `src/__tests__/coverage-fixture.ts`: the name guard :22 `/^EXECMCPTMP401[A-Z]$/` widens to 401 or 402. Add the `Story402` sources and seed helpers beside `STORY401_*` (:31-235).
- `src/__tests__/interop-namespace-fixture.ts`:
  - `FIXTURE_CLASS_SOURCE` :88; the monitor helpers are at :369-640;
  - `HoldMonitorLock` :510 is the template for the new `HoldRunnerLock`;
  - `SeedRunRecords` :565 and `ClearFakeRuns` :585 are the templates for `SeedLargeRun` and `ClearLargeRun`;
  - add the routine-deletion helper there;
  - update the roster test of its methods.
- Template gate: `src/__tests__/story-40-1-coverage-live-gate.test.ts`. Its header :34 and `scripts/prepublish-gate.mjs:224` both say the 40.1 gates are the only gates that start sessions; correct both. The helpers come from `process-gate-helpers.ts`.
- Rosters: `scripts/prepublish-gate.mjs` `gateTestFiles` :227-233; `src/__tests__/story-39-1-gate-guards.test.ts` `GATES` :74-75; `live-gate-roster.test.ts`.
- Pins this story moves:
  - `test-status-governance-keys.test.ts` :45-49 and :99-100 (two keys → three);
  - `story-40-1-doc-claims.test.ts`: :67 and :82 (the argument lists) and :85 ("adds no action and changes neither key");
  - `fixtures/tools-list-snapshot.json`, through `--force`;
  - `changelog-bootstrap-move.test.ts`, which reads the newest move.

**Docs**
- `packages/iris-dev-mcp/README.md`: the rows :246, :248, :254 and :256, and the `<details>` entries :1658 and :1760.
- `tool_support.md`: the rows :57 and :60, and the governance note :218 (add a Story 40.2 note).
- Root `README.md`: the payload rows, equal to `pnpm measure:tools-payload`.
- `CHANGELOG.md`: a new top section.
- `.changeset/`: one new file.

## Tasks & Acceptance

**Execution:**

1. `src/ExecuteMCPv2/Coverage/Job.cls`. Add `SourceMap(pNamespace, pClass, Output pMap) As %Status`, a pure helper `LoadedRoutinesFailure(pRunList As %List, pLoaded As %List) As %String` (empty when equal, otherwise the text naming the routines that were not loaded), `minCoverage` in `CreateRun`, and the source-map capture in `Finish`. Update the class comment. This is AD-12 raw data, beside `Skeleton`.
2. `src/ExecuteMCPv2/Coverage/Runner.cls`. Implement the DW-598 branch exactly as the Boundaries say, reusing `LoadedRoutinesFailure`, `ProofFailure` (against the list the session loaded) and the release locks, so the observable outcomes hold.
3. `src/ExecuteMCPv2/REST/Coverage.cls`.
   - Optional `minCoverage` in `ValidateStart` (a number from 0 to 100; JSON null means absent), passed through `Launch` to `CreateRun`.
   - `BuildRun` adds `minCoverage` and `sources` (from `BuildSources`). AD-33: additive only.
4. `src/ExecuteMCPv2/Tests/CoverageSourceFixture.cls`, whose body is `Story402.Fixture` under its own name, and `CoverageSourceTest.cls`. Cover:
   - `SourceMap` on the fixture (every method's `line`, `reason` and `intLines`, as captured live);
   - a class that is not up to date;
   - `ValidateStart` for `minCoverage`: absent, 0, 100, 100.5, -1, 101 and a string;
   - `LoadedRoutinesFailure`: equal lists, one missing, and order ignored.
   - No test starts a session.
5. Run `pnpm gen:bootstrap` twice (the second run is idempotent) and record the version move.
6. `packages/iris-dev-mcp/src/tools/local-path.ts` (new). Move the two guards out of `export.ts`; `validateLocalPath(value, label)` returns today's `destinationDir` texts for the label `destinationDir`. `export.ts` imports them, and `export.test.ts` stays unchanged and green.
7. `packages/iris-dev-mcp/src/tools/coverage-report.ts` (new). Implement `classSourceCoverage`, `coverageTotals`, `coverageVerdict` and the text helpers, as pure functions over `CoverageRun`.
8. `packages/iris-dev-mcp/src/tools/cobertura.ts` (new). `buildCoberturaXml(run, coverage, {sourceRoot?, version})` is deterministic. `writeCoberturaFile(outputPath, xml)` uses the path guard, then mkdir, a temporary file and a rename.
9. `packages/iris-dev-mcp/src/tools/test-coverage.ts`.
   - Extend `CoverageRun`, `buildCoverageSection` and the text (they extend; they do not fork).
   - Add `minCoverage` to the schema and the Start body, sent only when given.
   - Add `exportCoverageRun(ctx, args)`.
   - The description adds the summary, the line numbering (the document `iris_doc_get` returns, in IRIS's layout), the generated-code count, `minCoverage`, and export through `iris_test_status` with its DEFAULT-DISABLED recipe. It names no REST path.
10. `packages/iris-dev-mcp/src/tools/test-status.ts`.
    - `action` gains `export`; add `outputPath` and `sourceRoot`.
    - `mutates` is `{poll:"read", cancel:"write", export:"write"}`.
    - Add the routing and the combination errors, and the description sentence: the export rules, DEFAULT-DISABLED, the recipe, overwrite, completed runs only.
11. `scripts/lib/cobertura-dtd.mjs` (new; decision #52, the plan's alternative (a)).
    - **No vendored file.** It encodes the content model of the pinned copy (`cobertura/web` `htdocs/xml/coverage-04.dtd` @ `f0366e5e2cf18f111cbd61fc34ef720a6584ba02`, sha256 `61fbbc0a…52d06`, cited in its header) as its own data: each element's allowed children in sequence, its attributes with required/optional, and whether it may hold text. No DTD text and no comment or notice from it is copied.
    - It checks a document for: the declared root, declared elements only, required and undeclared attributes, child sequences against the content model, and text only where the model allows it.
    - Its unit test pins the encoded model against a hand-checked list and goes red on a dropped required attribute or a misplaced child.
    - Its header records the provenance (URL, commit, sha256, date).
12. Dev tests (new):
    - `src/__tests__/coverage-report.test.ts`: the mapping rule on fixtures built from the probe data (every reason; returntype 1 and 2; a `call` CodeMode; generated lines), the verdict table (rows 4-6 by hand values), and the text;
    - `src/__tests__/cobertura.test.ts`: the golden `src/__tests__/fixtures/cobertura/story402-oracle.xml` byte-equal; DTD-valid through `cobertura-dtd.mjs`; parsed back equal; the rates, escaping and `sourceRoot`; and the validator rejecting each mutation listed in Verification;
    - `src/__tests__/test-status-export.test.ts`: matrix rows 8, 11 and 12 with a mocked `http` and a temporary directory.
    - Update `test-status-governance.test.ts`: `export` is denied by default and flipped by an explicit enable.
13. iris-mcp-all:
    - `test-status-governance-keys.test.ts` (three keys; `export` is `write` and not in the baseline);
    - `coverage-fixture.ts` and `interop-namespace-fixture.ts` (the helpers listed in the Code Map, with the roster test);
    - the new gate `src/__tests__/story-40-2-coverage-reports-live-gate.test.ts`, with matrix rows 1-14 each self-contained and each ending with the idle and `("session")`-unset assertions. `afterEach` and `afterAll` call `StopIfList`; `afterAll` removes `EXECMCPTMP402A`, the temporary directory and any large fake record, and asserts the leftovers are `[]`;
    - the rosters; the corrected comments about which gates start sessions;
    - the new `src/__tests__/story-40-2-doc-claims.test.ts`, which pins the README rows, the export default state and recipe, `tool_support.md`, the CHANGELOG section with its bootstrap move and snapshot line, and the DTD pin;
    - the moved 40.1 doc pins.
14. Docs and generated artifacts.
    - Docs:
      - the dev README rows and details: the new arguments, the export key DEFAULT-DISABLED with its recipe `IRIS_GOVERNANCE={"global":{"iris_test_status:export":true}}`, the line-number note, and the verdict rule;
      - `tool_support.md`: rows 29 and 32, and a Story 40.2 governance note.
    - CHANGELOG section `## [Pre-release — 2026-10-18] — Story 40.2: Coverage reports and targets`: the new key, the bootstrap move, the snapshot regeneration (decision #29), the additive `minCoverage`/`sources`, DW-598, and the counts (unchanged).
    - Changeset `.changeset/story-40-2-coverage-reports-and-targets.md`, with `"@iris-mcp/dev": minor` and `"@iris-mcp/shared": patch`.
    - Generated artifacts: `pnpm gen:tools-list-snapshot --force` after every package is built, and the README payload rows equal to `pnpm measure:tools-payload`.

**Acceptance Criteria:**

- **AC-1 (40.2.1, 40.2.2).** Given the built dev server over the wire, with `iris_test_coverage` enabled and the `Story402` fixtures in `EXECMCPTMP402A`, when matrix rows 1-3 run, then the summary equals the live-captured oracle exactly, every reported line number names the statement the raw class document shows at that line, and the monitor is idle afterwards.
- **AC-2 (40.2.4).** Given rows 4-6, when `minCoverage` is passed, then the verdicts are as the matrix says, the comparison is unrounded, and a failing verdict leaves `isError:false`.
- **AC-3 (AD-16, Integration AC).** Given the completed results of rows 1 and 4, when the consumer `iris_test_status` polls each by `coverageRunId` alone, then it produces `structuredContent` deep-equal to the primary call's, including `source` and `verdict` (row 7).
- **AC-4 (40.2.3).** Given row 1's run and `iris_test_status:export` enabled, when it exports, then the file at the resolved `outputPath` validates against the pinned DTD, and parsed back equals the summary. A second export is byte-identical, and the unit golden file matches byte for byte (rows 9-10).
- **AC-5 (governance, AD-4).** Given default governance, when `export` is called, then it is refused with `GOVERNANCE_DISABLED` and no file exists (row 8). `deriveKeysForTool(iris_test_status)` is `[poll, cancel, export]`, `export` is classified `write` and is not in the baseline, and the annotations of both tools are unchanged.
- **AC-6 (export guards).** Given rows 11-12, when an export targets a run that is not complete, or a bad path, then it is `isError:true`, nothing is written, and for a bad path nothing is sent to IRIS.
- **AC-7 (DW-598).** Given row 13, when a measured routine disappears before the runner's `Start`, then the run ends `failed`, naming the routine, with no test run. The monitor is idle with `("session")` unset as soon as the run is terminal, and the next run completes with no `reclaimed`.
- **AC-8 (DW-596).** Given row 14's synthetic 200,000-line record, when it is polled, then the result returns within 2 s, and the measured `Status` time, bytes and memory are recorded in Verification.
- **AC-9 (AD-15, AD-33).** Given every pre-existing `iris_test_status`, `iris_execute_tests` and 40.1 test, when the suites run, then they pass. 40.1's expectations hold with the new keys removed, and the regenerated tools-list snapshot differs only in the `iris_test_coverage` and `iris_test_status` entries.
- **AC-10 (bootstrap).** Given `pnpm gen:bootstrap`, when it runs twice, then the second run changes nothing, and the gate's deployed-version assertion passes.

**Review items (review pass 1, 2026-10-18).** Each is a verified finding of the review layers; fix each with the smallest change that does the job, add the test it names, and write its `mutation:` line in `## Verification` (Rule 19). The IRIS classes `Job.cls` and `Runner.cls` change in items 1 and 2, so `pnpm gen:bootstrap` runs once more at the end (twice for idempotence), with the DW-591 quirk and every dist rebuilt, and the story's CHANGELOG bootstrap move and the spec's bootstrap note are updated to the final `BOOTSTRAP_VERSION` (the move stays `14a4cba6504a` -> final).

- [x] [Review] 1. **A session with zero routines is never proven, so the runner cannot stop it (DW-598, AD-27).** `%Monitor.System.LineByLine:Start` (`irislib/%Monitor/System/LineByLine.cls:40-110`) checks the routine count only when the list is empty, so a list whose routines ALL lack object code starts an active, scoped session that monitors zero routines. `Job.ProofFailure` calls `AllNamed(pActive)`, which is 0 for an empty list, so `Runner.LoadedAsListed` can neither prove nor stop it; the run ends with the instance-wide monitor left active (a single-class run whose only routine disappears before `Start`). Fix inside the DW-598 branch only: factor the first three checks of `ProofFailure` (scoped; lists this process; `PidsMatch`) into a new `Job.SessionScopeFailure(pPids, pSelfPid, pSupervisorPid, pRunnerPid)` that `ProofFailure` calls with exactly the same texts (40.1's `CoverageReleaseTest` stays green and unedited), and in `LoadedAsListed` prove a session that reports zero routines by `SessionScopeFailure(...) = ""` alone (there is nothing to read or compare), then `Stop` as today. Tests: OS tests in `CoverageSourceTest` (the texts of `SessionScopeFailure`, and `ProofFailure` still returning the same texts), and a live row 13b in `story-40-2-coverage-reports-live-gate.test.ts` built like row 13 with `classes:["Story402.Gone"]`, pinning: `failed`, `error` names `Story402.Gone.1` and says no test ran, idle and `("session")` unset as soon as the run is terminal, `releasedBy` is `runner`, and the next run completes with no `reclaimed`. Mutation: restore the `AllNamed`-only proof for the empty case -> row 13b red. A leftover session this causes is cleared only by the gate's safety net or by the next normal start's reclaim, never by a direct `Stop`, and the monitor is verified idle at the end.
- [x] [Review] 2. **The DW-598 not-stopped fallback has no executing test.** Extract the fallback of `LoadedAsListed` (the `If 'tStopped` block: rewrite `routineList`, rewrite the session node to the loaded list when it names the run, set `sessionStarted`, set `startError` to the failure text plus ` No test was run.`) into a public class method `Runner.RecordUnstoppedSession(pId, pLoaded, pText)` with the same statements in the same order, called from `LoadedAsListed`. Add OS tests in `CoverageSourceTest` on a fake run id above every real id (record removed afterwards; never overwrite a `("session")` node that names another run, and never write a session node a real run owns): the `routineList`, `sessionStarted` and `startError` values, and that a session node naming another run is left untouched. Mutation: delete the `routineList` rewrite -> the new test red.
- [x] [Review] 3. **`export` writes an empty document when no class has a class-source result.** In `exportCoverageRun` (`test-coverage.ts`), refuse (`isError:true`, nothing written, the run unaffected) when the built document has 0 classes (a run with `sources: []`, or whose classes are all `not-up-to-date` or `unavailable`): a file with `lines-valid="0"` and `line-rate="1"` reads as 100% covered to a CI tool. The text names the reason (no class has a class-source result) and tells the caller to recompile the classes and run the tests again. Tests in `test-status-export.test.ts`: `sources: []`; all classes with `source.reason`; nothing written in both. Mention the refusal in the dev README export paragraph (not in a tool description, so the tools-list snapshot does not move).
- [x] [Review] 4. **The refusal advice says "wait" for terminal runs.** For a status other than `starting` or `running`, the `export` refusal says the run cannot be exported and the tests must be run again (no "Wait for it" advice). Test: `failed`, `cancelled` and `abandoned` texts do not contain `Wait for it`; `running` still does.
- [x] [Review] 5. **Cobertura `hits` is pinned only at 0 and 1.** In `cobertura.test.ts`, build the document from a variant of the oracle run in which one covered class line has an INT count of 7, and assert `hits="7"` in both the `<method>` and the class `<lines>` blocks. Mutation: write `hits > 0 ? 1 : 0` -> red.
- [x] [Review] 6. **The `destinationDir` messages are claimed byte-identical but pinned by substring.** New `packages/iris-dev-mcp/src/__tests__/local-path.test.ts` with the exact strings captured from the baseline (`git show 4da459e838dad43e5bbbe3fb14bd0b4b07f4c5a2:packages/iris-dev-mcp/src/tools/export.ts`) for the empty, `..` and relative cases of `validateLocalPath(value, "destinationDir")` and for the `assertInsideRoot` refusal with its default label, plus the `outputPath` label. Mutation: change the default `label` of `assertInsideRoot` -> red.
- [x] [Review] 7. **The handler-level "could not be written" result is untested.** One case in `test-status-export.test.ts`: `outputPath` under a regular file (created in the test's temp directory) -> `isError:true`, the text names `could not be written`, nothing is written. Mutation: remove the inner `try/catch` in `exportCoverageRun` -> red.
- [x] [Review] 8. **Rule 14: literal non-ASCII in code.** Replace the literal characters in string and regex literals with escapes: `"→"` (`ARROW`), the em dashes in `CHANGELOG_TITLE` and the governance-note expectation in `story-40-2-doc-claims.test.ts`, and the em dash in the new `export` sentence of the `test-status.ts` description (`"—"` gives the same text, so the tools-list snapshot does not move; run `pnpm gen:tools-list-snapshot:check`). Banner comments are left as the file's convention.
- [x] [Review] 9. **Docs and comments.**
  - `coverage-fixture.ts`: the comment that points to `story402-oracle.ts` names the real sources (`story402-run.ts` and `fixtures/cobertura/story402-oracle.xml`).
  - `source.reason` has three values (`not-up-to-date`, `not-compiled` when the class has no compiled definition at the end of the run, and `unavailable` when its map could not be built): list all three in the `SourceClassRaw.reason` comment, the dev README and the CHANGELOG section (not in a tool description).
  - Root `README.md` default-disabled table: add a `dev` row for `iris_test_status` (`cancel` from Story 40.1 and `export` from Story 40.2 are default-disabled; `poll` is enabled), in the table's style.
  - Dev README export paragraph: state that CI tools lay the reported line numbers over the repository's own `.cls` files, so those files must be in the layout IRIS stores (for example as `iris_doc_export` writes them), or the numbers can be offset.
  - `CoverageSourceTest.cls`: the `LoadedRoutinesFailure` description sits above `TestRewrittenOwnershipLetsTheSessionBeProven`; move it above `TestLoadedRoutinesFailure`.
  - Run `story-40-2-doc-claims.test.ts` after the doc edits and keep its pins truthful.
- [x] [Review] 10. **A 40.1 assertion was weakened.** In `story-40-1-coverage-live-gate.test.ts` (row 1), the check `lines.slice(1, -2).every(...)` passes when there are no class-source lines. Also assert that `lines[1]` matches `/^Story401\.Fixture: \d+ of \d+ class lines covered \(/`.
- [x] [Review] 11. **Rule 19 closure.** Write a `mutation:` line (apply, observe red, revert to a byte-identical tree, reload or rebuild what it touched) for each of: the byte-identical re-export and `timestamp` (use `Date.now()` instead of `finishedAt` -> the golden and determinism tests red); the not-complete refusal (remove the `status !== "completed"` branch -> `test-status-export.test.ts` red); `minCoverage` bounds (remove `.max(100)` from the schema -> `test-coverage-minimum.test.ts` red, and the `ValidateStart` upper bound in `REST/Coverage.cls` -> `CoverageSourceTest:TestValidateStartMinCoverage` red); `cobertura-dtd.mjs` (the required-attribute check removed, the child-sequence check removed, the DOCTYPE/root check removed, each -> a named `cobertura-dtd.test.ts` case red); the items above. One line per mutation, recorded next to the existing ones.

## Spec Change Log

- **2026-10-18, lead spec gate.** Decisions #50, #51 and #53 were taken as recommended. Decision #52 takes alternative (a) instead of vendoring the DTD: `cobertura-dtd.mjs` encodes the pinned copy's content model, and no third-party file or text is committed (Tasks 11, Never, matrix row 9, Verification). Spine AD-16 now names the companion's `export` action as the coverage file write (Rule 20).

## Review Triage Log

### 2026-10-18 — Review pass
- verdicts: 41 findings — high 1, medium 7, low 30, false 3, maybe-false 0
- findings:
  - Blind Hunter:
    - `[low]` `[reject]` `minCoverage` fails open against an older IRIS-side class (no verdict, no warning) — reachable only when the IRIS classes and the package version disagree (AD-14 redeploys on a version mismatch); the contract fixes the no-`sources` shape as exactly 40.1's, and the fix adds a Start-time check and a new error path. Noted as a residual risk.
    - `[medium]` `[patch]` `export` writes an empty document (`lines-valid="0"`, `line-rate="1"`) when no class has a class-source result — confirmed by the probe of a `sources: []` record and reachable with all classes `not-up-to-date`; fixed by Review item 3 (refuse when the document has 0 classes, tests, README sentence).
    - `[low]` `[patch]` the refusal for a terminal non-completed run says "Wait for it" — real for `failed`, `cancelled`, `abandoned`; fixed by Review item 4 (advice only for `starting` and `running`).
    - `[medium]` `[patch]` `LoadedAsListed` can fail a healthy run on a slow monitor, and its fallback has no end-to-end test — the slow-monitor half is contradicted by the plan-stage probe (DW-595: the starting process reads the names with a 0 ms wait, and the failure is loud and safe), the untested fallback is real; fixed by Review item 2 (`RecordUnstoppedSession` extracted, OS tests).
    - `[low]` `[patch]` Rule 14: literal non-ASCII characters in code (`"→"`, em dashes in a regex and strings, one in the `test-status.ts` description) — fixed by Review item 8 (escapes; the snapshot did not move).
    - `[low]` `[patch]` a comment names `story402-oracle.ts`, which does not exist — fixed by Review item 9.
    - `[low]` `[patch]` `source.reason` values `not-compiled` and `unavailable` undocumented — fixed by Review item 9 (type comment, dev README, CHANGELOG).
    - `[low]` `[patch]` the root README default-disabled table has no `iris_test_status` row — fixed by Review item 9.
    - `[low]` `[patch]` the export docs omit that CI tools need local `.cls` files in IRIS's stored layout — fixed by Review item 9 (dev README).
    - `[low]` `[reject]` the verdict has under-documented semantics (overall `PASS` while a class fails, excluded methods, rounding) — all contract-defined (decision #53); excluded methods carry their `reason` in `source.methods`; closed by-design.
  - Edge Case Hunter:
    - `[medium]` `[patch]` export of an all-reason or empty run writes an empty file — same root cause as the second Blind Hunter finding; fixed by Review item 3.
    - `[low]` `[reject]` `sourceRoot` containing U+FFFE or U+FFFF makes the file not well-formed — theoretical; a caller-supplied label that nobody can produce by accident.
    - `[low]` `[reject]` two exports to the same path within one millisecond of one process share a temporary name — needs two parallel exports of one path in the same millisecond; the loser gets a clear error.
    - `[low]` `[reject]` `19999 of 20000` rounds to `line-rate` 1 — the contract says "rounded to 4 decimal places"; closed by-design.
    - `[low]` `[reject]` `AwaitNamesReadable(3)` and the pre-lock `tLoaded` — DW-595 evidence (names readable at once in the starting process); the failure is loud and a later start reclaims the session.
    - `[low]` `[reject]` `sessionStarted` is set one statement before `startError` — a one-statement window in a double-fault path costing only the generic error text; swapping the two would let the supervisor's `Finish` skip the release, which is worse.
    - `[false]` `[reject]` `SourceMap` has no time bound in `Finish` — the plan probe measured about 4 microseconds per `INTLine` call, bounded by the class source of a run capped at 200,000 INT lines.
    - `[false]` `[reject]` a method's INT routine can be absent from `run.routines` — `ResolveRoutines` (`Job.cls:496-505`) lists every `Class.N` routine that has object code, and `INTLine` maps only compiled code.
    - `[low]` `[reject]` a Status record from before the upgrade polls as `sources: []`, not as exactly 40.1's text — the class-source lines say `unavailable`, which is honest; the export consequence is closed by Review item 3.
    - `[high]` `[patch]` a run whose listed routines all lack object code starts a session that monitors zero routines, which `ProofFailure` (`AllNamed` is 0 for an empty list) can never prove, so the runner leaves the instance-wide monitor active — confirmed in `irislib/%Monitor/System/LineByLine.cls:40-110` (the count is checked only for an empty list); fixed by Review item 1 (`SessionScopeFailure`, live row 13b, mutation recorded).
    - `[low]` `[reject]` the DW-596 record is smaller than a real one — it has the plan-stage probe's shape (180,000 skeleton entries, 4.8 MB), and the `Finish`-time map pass is not on the read path.
  - Verification Gap:
    - `[medium]` `[patch]` Cobertura `hits` is pinned only at 0 and 1 — a `hits > 0 ? 1 : 0` mutation survived; fixed by Review item 5 (a count of 7 in both blocks).
    - `[medium]` `[patch]` the DW-598 not-stopped branch has no executing test — fixed by Review item 2 (public `RecordUnstoppedSession` with OS tests on a fake run id; a live lock-timeout fault injection is not added, see residual risks).
    - `[medium]` `[patch]` a pre-upgrade completed record reaches the code as `sources: []` and exports an empty file — the export consequence is fixed by Review item 3 with tests for `sources: []`; the poll text for such a record is accepted (see the Edge Case Hunter row).
    - `[low]` `[patch]` the `destinationDir` messages are byte-identical by claim but pinned by substring — fixed by Review item 6 (`local-path.test.ts`, strings captured from the baseline).
    - `[low]` `[patch]` the handler-level "could not be written" result is untested — fixed by Review item 7.
    - `[low]` `[patch]` Rule 19: several pinning tests had no `mutation:` line — fixed by Review item 11 (21 lines recorded in the review pass).
    - `[low]` `[patch]` a changed 40.1 assertion (`lines.slice(1, -2).every`) passes with no class-source lines — fixed by Review item 10.
    - `[low]` `[reject]` the determinism assertion builds twice in one millisecond — the golden assertion is the pin; the item-11 mutation (`Date.now()`) also moved the test to two fake clocks.
    - `[low]` `[reject]` `TestSourceMapOfTheFixture` needs the fixture class loaded first — it fails loudly when it is missing.
    - `[low]` `[patch]` the `LoadedRoutinesFailure` doc comment sits above the wrong test — fixed by Review item 9.
  - Intent Alignment Auditor:
    - `[low]` `[reject]` the class-line numbering lives in IRIS's stored document, not in the developer's file — stated by the contract, documented in the tool description, README and CHANGELOG; the export caveat is added by Review item 9.
    - `[low]` `[reject]` `CodeMode = call` has no real fixture — the contract lists it and the mapping treats it like any other mapped method; unit-level only, noted as a residual risk.
    - `[medium]` `[patch]` the DW-598 failure branches (lock not taken, proof failing, `Stop` failing, every routine missing) are untested — the every-routine-missing case is Review item 1, the fallback glue is Review item 2; the lock-timeout and `Stop`-failure faults are not injected live.
    - `[low]` `[reject]` the back-compat proof builds the no-`sources` shape by deleting keys — the unmodified 40.1 mock records in `test-coverage.test.ts` also run without `sources`, and the pin was mutation-verified.
    - `[low]` `[reject]` the DTD check is the encoded model, with `xmllint` recorded as prose — decision #52; the `(once)` cross-check was re-run on the final tree (golden exit 0, one `hits` removed exit 3).
    - `[low]` `[reject]` `export` also refuses a completed run in which no test method ran — a stricter fail-safe than the contract's three conditions, with no user harm; flagged to the lead in the run report.
    - `[false]` `[reject]` the diff adds fixtures outside the contract's list — Task 4 names `CoverageSourceFixture`, and `ExecuteMCPv2.Temp.*` classes are permitted by the environment rules; all are removed by their tests.
    - `[low]` `[reject]` the gate checks the monitor idle at the start of the run and at the end of every row, not at the start of every row — a foreign session between rows makes the next `Start` refuse with `MONITOR_BUSY` and is never stopped (`StopIfList` proves candidates only).
    - `[low]` `[patch]` literal non-ASCII in three files — same root cause as the Rule 14 row; fixed by Review item 8.
    - `[low]` `[reject]` open wording (the `NOT APPLICABLE` target line, `sourceRoot` checks, two body lines on one INT line) — informational; follows from the contract.

## Design Notes

**Orchestrator decisions needed** (the Lead's calls, delegated; planned around the recommendation):

1. **DECIDED (orchestrator decision #50, 2026-10-18, as recommended).** **Where do the summary, `minCoverage` and `outputPath` live, and does this change `iris_test_status`'s governance or annotations?** Recommended:
   - the summary on every result of both tools;
   - `minCoverage` on `iris_test_coverage` only, stored with the run;
   - `outputPath` only on a new companion write action, `iris_test_status:export` (write, DEFAULT-DISABLED);
   - no annotation change on either tool.

   Why:
   - AD-16 says "Every result a completed run returns can be reproduced by the companion from the durable handles alone" and "A companion that writes a local file takes an explicit `outputPath`". So the minimum must be durable (the run record), and the file write belongs to the companion.
   - AD-4: "a parameter that adds a new kind of side effect to an existing key (… a local file write) counts as a new operation" and goes on a governed companion key. `outputPath` on the existing `iris_test_coverage` key would need a recorded Lead exception. A local write to any absolute path is also a risk an operator may want to grant separately from running coverage.
   - A run that outlives the wait budget can produce its file only through the companion anyway.
   - `iris_test_status` already declares `readOnlyHint:false`, `destructiveHint:true` and `idempotentHint:false`, so the new action makes no hint untrue.
   - It is not a frozen-baseline tool. "The enum is fixed in the tool's first story" (AD-4) comes from the spine review's M7, about a `mode` discriminator becoming an `action` key mid-epic, which renames keys; adding a value adds one key and renames none.

   Alternatives:
   - (a) also accept `outputPath` on `iris_test_coverage`, which saves one call but needs that recorded AD-4 exception;
   - (b) `outputPath` on `poll` (rejected: a file write on a read key that is enabled by default);
   - (c) a separate new tool (needless count churn).
2. **DECIDED (orchestrator decision #51, 2026-10-18, as recommended): the Cobertura content conventions.** Recommended:
   - `filename` in `iris_doc_export`'s layout (`Pkg/Sub/Cls.cls`);
   - an optional `sourceRoot` that becomes the one `<source>` (GitLab and Jenkins resolve `filename` through `<sources>`), with `<sources>` left out otherwise;
   - rates to 4 decimal places, and `1` when nothing is valid (Cobertura's and coverage.py's convention);
   - `branch-rate="0"` and `complexity="0"`, because branches are not measured;
   - `timestamp` from the run's `finishedAt`, so every export of a run is byte-identical;
   - export only `completed` runs with complete coverage (a cancelled run's partial counts would mislead a CI gate);
   - overwrite an existing file (CI re-runs);
   - require `.xml`, a cheap guard against overwriting an unrelated file.

   Alternative: no `sourceRoot` (callers then post-process the paths).
3. **DECIDED (orchestrator decision #52, 2026-10-18): pin the published 2013 copy and emit `<method>` without `complexity`, as recommended; but vendor NO file. Take alternative (a): `cobertura-dtd.mjs` encodes the content model as its own data. The repository that publishes the copy declares no licence and its sibling copy is GPL-2.0, so no third-party text enters the repo. The one-time xmllint cross-check uses a scratchpad download checked against the sha256 pin.** The plan's original question follows: which DTD is "the Cobertura DTD", and how to validate without fetching.
   - **The two copies.** Two files named `coverage-04.dtd` exist, and they are mutually exclusive on one attribute:
     - `cobertura/web` `htdocs/xml/coverage-04.dtd` at commit `f0366e5e2cf18f111cbd61fc34ef720a6584ba02` (2013-05-22), 2,030 bytes, sha256 `61fbbc0a260337fe9ad59bd671b52e5f2677978a41e1e5bb7ae594fa01252d06`. This is the published copy, and the URL coverage.py's DOCTYPE names. It declares no `method@complexity`.
     - `cobertura/cobertura` `cobertura/src/test/resources/dtds/coverage-04.dtd` at commit `e5eea8679ebce047ec6ccdfdbf6cf2c14b376875` (2014-09-16), 2,162 bytes, sha256 `e467cb8252e20feb794fc2dedfbea7b4957921669c758f0282d525df88897917`. It REQUIRES `method@complexity`.
   - **The xmllint evidence.** Run with libxml2 20913, `--nonet --dtdvalid`, on a sample: a method without `complexity` is valid against the first and invalid against the second, and the reverse holds with it.
   - **Recommended:**
     - pin the published 2013 copy, which matches the DOCTYPE the file names;
     - emit `<method>` elements without `complexity`;
     - vendor the DTD verbatim as a test-only file under `scripts/lib/cobertura/`, which no package publishes. It keeps its own ISO 8879 copy notice; the provenance goes in `cobertura-dtd.mjs`'s header, and a sha256 pin test guards it;
     - validate with an in-repo validator that reads that DTD's declarations;
     - cross-check once with the host's `xmllint` (the Verification step `(once)`).
   - **Licence.** The `cobertura/web` repository declares no licence (the GitHub API reports none). `cobertura/cobertura` is GPL-2.0. The file's only notice is the ISO 8879 permission. Vendoring third-party text is the decision asked for here.
   - **Alternatives:**
     - (a) transcribe the content model into test data (no file vendored, but it is a transcription, not the DTD);
     - (b) a devDependency such as `xmllint-wasm` (a new third-party dependency);
     - (c) emit an empty `<methods/>` (valid against both copies; loses the per-method data in the file).
4. **DECIDED (orchestrator decision #53, 2026-10-18, as recommended): the verdict semantics.** Recommended:
   - per class, `pass` or `fail` against the unrounded ratio, and `notApplicable` with 0 executable class lines;
   - a listed class with no class-source result (unmeasured or not up to date) is `fail` with a reason, and makes `overall` fail;
   - `overall` is the unrounded aggregate over the classes with a source result;
   - the verdict is on `completed` results only, and never changes `isError`.

   Why: a CI gate must not pass on code it never measured, or on a rounded 79.995 %.

   Alternative: unmeasured classes `notApplicable`, and `overall` = every class passes.

**AC interpretations** (apply and report):
- **AC 40.2.1, "using the mapping the probe found".** 40.1's probe recorded no class-source mapping. This plan's probe found it (below), and the implement stage re-verifies it on the gate fixture.
- **AC 40.2.3, "following the path conventions of `iris_doc_export`".** This is read as the `outputPath` guard (absolute, no `..`, the same helper) and the `filename` layout of exported files.
- **AC 40.2.2, "uncovered line ranges".** These are class-document line ranges. The INT ranges stay in `routines`.

**Probe evidence** (IRIS 2026.2 build 221U, `default`, 2026-10-18 about 07:45 to 08:00 UTC).
- **The fixtures.** The probes used `ExecuteMCPv2.Temp.Probe402A/B/M/R/S/T` in HSCUSTOM, all deleted afterwards (`iris_doc_list` for `Probe402`, generated included, returned `[]`).
- **Shared-instance checks.** The monitor was idle before every session and afterwards, `^IRIS.TempExecuteMCPv2Coverage("session")` was unset, and the fake record was removed. Every session was scoped to the probing process, on a disposable routine, and stopped inside the same call.
- **Forward mapping (`SourceLine`, per INT line) is rejected.**
  - The last line of `TwoOnOne` (INT 67, `Quit tA + tB + pN }`, executed) came back unmapped: `^rMAP` holds an end-of-method marker there because generated methods follow it.
  - The never-run ` q` mapped to `Sql`'s closing `}`.
  - The `%0dsqlA` helper, which runs only on the first execution after a compile, mapped to the `&sql` line.
- **Reverse mapping (`INTLine`, per method body line) is used.** It gives exactly one INT line per body line:
  - `TwoOnOne` offset 2 → INT 67; `Sql` offset 2 → 53 (the `try` line); `Macro` offset 5 (`#define`) → returntype 1; a blank body line → returntype 1; `Constant` (`Quit 42`) and a Python method → returntype 2 for every offset; offset 0 → the INT line of offset 1 (ignored).
  - Each body offset k is document line D+1+k. This was checked on 11 methods (`Plain` D=22 → 24 and 25; `Macro` D=28 → 30-36; `MultiLine` D=39 → 41-48; `Sql` D=51 → 53-56), and on a non-canonical upload whose stored text was renumbered.
  - The implementation line counts from the dictionary match the bodies: `Macro` 7, `Sql` 4, `Spaced` 3, `Generated` 3 (objectgenerator).
  - `INTLine` and `SourceLine` cost about 4 µs per call.
- **IRIS normalizes the class text.** It inserted a blank line after `{`, collapsed 3 blank lines to 1, inserted a missing blank line between members, joined a two-line signature, and turned `ClassMethod   Spaced` into `ClassMethod Spaced`. Method bodies were kept verbatim: tabs, blank lines and comments.
- **Counts under a session** (all methods called once). The executed lines were INT 18-19, 21, 23-24, 26, 28, 31-33, 35, 38, 40, 42, 44-45, 47-50, 53-55, 57-64 and 66-67. They show:
  - only the first line of a multi-line statement is counted;
  - continuation lines, lone `}` lines and comment lines have no skeleton entry;
  - the label line with the embedded-SQL `New` (INT 49) runs, and it is generated.
- **DW-595.** Three rounds each started a session for the probing process, ran fixture code at once, and read the counts at once. Every round read `44:1,45:1` with the routine name readable at once (a 0 ms wait), and a second call read `44:2,45:2`. So there is no start-up delay for the process that starts the session.
- **DW-598.** `Start($lb(<routine>,"…Probe402Gone.1"), …)` returned OK, `GetRoutineCount()` was 1, and the routine with no object code was skipped silently.
- **DW-596.** A synthetic terminal record of 200,000 lines (4 routines, 180,000 skeleton entries, 100,000 hits) gave:
  - `BuildRun(id,1)`: 392 ms and 72.9 MB of process memory;
  - JSON: 4,192,108 bytes, serialized in 20 ms;
  - HTTP `GET` `Status`: 0.47 to 0.50 s for 4,192,168 bytes;
  - Node `JSON.parse`: 20 ms.

  This instance's per-process memory limit is effectively unlimited (`$ZStorage` 2147483647 KB).

**Plan-stage predictions** for `Story402.Fixture` (Probe402A's body, with a one-line header comment), for orientation only:

| Method | Executable class lines | Covered |
|---|---|---|
| `ScoreSet` | 13, 14 | both |
| `LabelGet` | 19 | yes |
| `Plain` | 24, 25 | both |
| `Macro` | 30, 31, 33, 35, 36 | all but 31 |
| `MultiLine` | 41, 44, 46, 48 | all |
| `Sql` | 53-56 | all |
| `Generated` | `generator` | — |
| `Expr` | 68 | yes |
| `Constant` | 0 lines | — |
| `Comments` | 81, 82 | both |
| `TwoOnOne` | 87, 88 | both |

- **Class totals.** 22 of 23 executable lines are covered (95.65 %). There are 23 executable generated INT lines.
- **`Story402.Layout`** (the Probe402B upload): `Spaced` 9 and 11, `Gap` 21 and `Inst` 26. Calling only `Spaced` gives 2 of 4 (50 %).

**`Story402.Fixture` source** (upload exactly; the class line numbers depend on it):

```objectscript
Include %occStatus

/// Synthetic coverage-report fixture (Story 40.2).
Class Story402.Fixture Extends %RegisteredObject
{

Property Score As %Integer;

Property Label As %String [ Calculated ];

Method ScoreSet(pValue As %Integer) As %Status
{
    Set i%Score = pValue * 2
    Quit $$$OK
}

Method LabelGet() As %String
{
    Quit "L"_..Score
}

ClassMethod Plain(pN As %Integer) As %Integer
{
    Set tX = pN + 1
    Quit tX
}

ClassMethod Macro(pSC As %Status) As %String
{
    If $$$ISERR(pSC) {
        Quit "error"
    }
    $$$ThrowOnError(pSC)
    #define Twice(%x) ((%x)*2)
    Set tY = $$$Twice(3)
    Quit "ok"
}

ClassMethod MultiLine(pA As %Integer) As %List
{
    Set tList = $ListBuild(pA,
        pA + 1,
        pA + 2)
    If (pA > 0) &&
        (pA < 10) {
        Set tList = tList_$ListBuild(0)
    }
    Quit tList
}

ClassMethod Sql(pName As %String) As %Integer
{
    Set tCount = 0
    &sql(SELECT COUNT(*) INTO :tCount FROM %Dictionary.ClassDefinition WHERE Name = :pName)
    If SQLCODE < 0 Quit -1
    Quit tCount
}

ClassMethod Generated() As %Integer [ CodeMode = objectgenerator ]
{
    Do %code.WriteLine(" Set tGen = 1")
    Do %code.WriteLine(" Quit tGen")
    Quit $$$OK
}

ClassMethod Expr(pN As %Integer) As %Integer [ CodeMode = expression ]
{
pN * 3
}

ClassMethod Constant() As %Integer
{
    Quit 42
}

ClassMethod Comments() As %Integer
{
    // a comment
    /* block
       comment */
    Set tY = 1 ; trailing
    Quit tY
}

ClassMethod TwoOnOne(pN As %Integer) As %Integer
{
    Set tA = 1  Set tB = 2
    Quit tA + tB + pN
}

}
```

- **`Story402.Layout`** is uploaded in this non-canonical text. Note the doc comment directly after `{`, the three extra spaces, the tab body, the missing blank lines and the two-line signature:

  ```objectscript
  /// Synthetic non-canonical layout (Story 40.2).
  Class Story402.Layout
  {
  /// doc one
  /// doc two
  ClassMethod   Spaced(pN As %Integer) As %Integer
  {
  	Set tX = pN	; tab indented

  	Quit tX
  }
  ClassMethod NoBlank() As %Integer
  {
   Quit 1
  }



  ClassMethod Gap(pA As %Integer,
      pB As %Integer) As %Integer
  {
      Quit pA + pB
  }

  Method Inst() As %Integer [ Private ]
  {
      Quit ..Gap(1, 2)
  }

  ClassMethod Py() As %Integer [ Language = python ]
  {
      return 7
  }
  }
  ```

- **`Story402.FixtureTest`** calls every `Story402.Fixture` method once, with the same arguments the probe used (`Macro(1)`, `MultiLine(5)`, `Sql("Story402.Fixture")`, `Expr(2)`, `TwoOnOne(1)`, plus an instance that sets `Score` and reads `Label`), and calls `Story402.Layout.Spaced(1)`.
- **`Story402.Gone`** has one method.
- **`Story402.SlowTest`** asserts once, then hangs `^Story402Hang` seconds.

**Ledger inbox (Rule 17).**
- **Declined DW-595.** Closed with evidence: the plan-stage probe (above) read the right counts with no wait in the process that started the session, and the runner is that process; 40.1's `levels` gate row already covers a one-method run. Recommended terminal state: `wontfix-theoretical`, real if a completed run reads count 0 for an INT line its tests executed.
- **DW-596** is addressed by matrix row 14, AC-8 and a Verification measure: close with evidence. The existing encoding measured 0.5 s and 4.2 MB per terminal read at the cap, inside the 2 s read budget. 40.2's addition is compact: one flat number array per method, about one number per body line. Recommended terminal state: `wontfix-accepted`, `reopen_if` a terminal `Status` read at the cap exceeds 2 s or fails with `<STORE>`.
- **DW-598** is addressed by Task 2, matrix row 13 and AC-7. Recommended terminal state: `resolved-by:40-2-coverage-reports-and-targets`.

**Extend, don't copy (Rule 2).**
- `Job.SourceMap` is a sibling of `Job.Skeleton`, using the same switch and restore pattern.
- `BuildSources` is a sibling of `BuildRoutines`.
- `coverageRunEnvelope`, `buildCoverageSection` and `coverageTextLines` are extended, not forked.
- `percentOf`, `toRanges` and `isExecutableSkeleton` are reused unchanged.
- The path guard is moved, not copied.
- `docNameToFilePath` is reused.
- `HoldRunnerLock`, `SeedLargeRun` and `ClearLargeRun` follow `HoldMonitorLock` and `SeedRunRecords`.
- The 40.2 gate follows the 40.1 gate shape and its helpers.

**Integration (Rules 1/2).**
- **The Integration AC** is AC-3: the consumer `iris_test_status` reads the run record that `iris_test_coverage` started and produces the identical summary and verdict. Its `export` produces the Cobertura file.
- **Consumes:**
  - Story 40.1's run record, routes, envelope, fixtures and release locks;
  - the `iris_doc_export` path guard;
  - `load.ts` `docNameToFilePath`;
  - `process-gate-helpers.ts` and `interop-namespace-fixture.ts`.
- **Consumed-by:**
  - Story 40.4: the docs, the optional coverage step of the `deploy-and-test-class` prompt (the tool or the export key may be hidden or disabled), and the capstone ("a valid Cobertura file"), which reuses `cobertura-dtd.mjs` and the `Story402` fixtures.
  - Story 40.3 reuses nothing new from this story.

**Residual risks.**
- A class split into `.2` was not probed live (`INTLine` returns the routine name).
- Trigger and `SqlComputeCode` bodies count as generated.
- An instance configured with a low per-process memory limit (DW-596's figures).
- Privileges were probed under `_SYSTEM` only.

**Spine (Rule 20, the lead's).** If decision 1 is taken as recommended, AD-16 could note that the coverage file write is the companion action `iris_test_status:export`. No AD conflicts with this plan.

**Governing ADs.**
- **AD-12:** raw source map on the IRIS side; the rule, the summary, the verdict and Cobertura in TypeScript.
- **AD-16:** the summary and verdict from the handle; the file from the companion with an explicit `outputPath`.
- **AD-4:** the new `write` key; the annotations unchanged; no file write on an existing key.
- **AD-27:** the DW-598 branch; no new monitor control.
- **AD-33 and AD-15:** an additive `Start`/`Status`, and back-compatibility pins.
- **AD-14:** bootstrap.
- **AD-13:** the namespace restore.
- **AD-11:** one render, and errors through `SanitizeError`.
- **AD-20:** the 200,000-line cap unchanged.
- **AD-7:** no visibility change.
- **AD-2:** cross-package gates in `iris-mcp-all`.
- **AD-5:** `:check` only.
- **Conventions:** Local file output; Tool results; Error text; Live gates; Probes and references (earliest version verified: IRIS 2026.2 build 221U for `%Studio.Debugger:INTLine`, `GetTextAsArray` and `IsUpToDate`); Live testing on a shared instance; Performance budgets.

## Verification

- Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, and one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- MCP calls name `server:"default"` and the namespace `HSCUSTOM` or `EXECMCPTMP402A`.

**Shared surfaces:** these change, and other tests assert on them.
- `iris_test_status`'s schema: the `action` enum, the new properties and the description.
- `iris_test_coverage`'s schema (`minCoverage`) and its description.
- The tools-list snapshot (those two entries).
- The README payload rows.
- The `iris_test_status` governance keys (2 → 3).
- The coverage result shape and its text (new fields and lines).
- The `Status` route response (a superset).
- `BOOTSTRAP_VERSION` and `bootstrap-classes.ts`.
- The `export.ts` guard location.
- The `FIXTURE_CLASS_SOURCE` method roster and the `coverage-fixture.ts` name guard.
- `gateTestFiles`, `GATES` and `live-gate-roster`.
- The 40.1 doc-claims pins, the dev README rows, the `tool_support.md` rows and note, and the CHANGELOG first section.
- The comments that name which gates start sessions.
- Tool, preset and baseline counts are unchanged.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order.
- **Disposable fixtures:**
  - `EXECMCPTMP402A` (the `Story402` classes);
  - `ExecuteMCPv2.Temp.Story391Fixture` in HSCUSTOM;
  - the gate's temporary directory;
  - the large fake record.
- **OS test classes** run one class per `iris_execute_tests` call, and `total` is compared with the `Test*` count (Rule #35).
- **Sessions.** No dev or OS test starts a session.

**Commands:**
- `(loop)` `iris_doc_load` into HSCUSTOM with the absolute globs `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Coverage/*.cls`, `…/src/**/REST/Coverage.cls` and `…/src/**/Tests/CoverageSource*.cls`, then compile -- expected: clean.
- `(loop)` `iris_execute_tests` `ExecuteMCPv2.Tests.CoverageSourceTest`, then in separate calls `CoverageJobTest` and `CoverageReleaseTest` -- expected: the totals equal the `Test*` counts, with 0 failures.
- `(loop)` `pnpm gen:bootstrap` twice, then `git diff --stat packages/shared/src/bootstrap-classes.ts` -- expected: one move, and the second run is idempotent.
- `(loop)` `pnpm --filter @iris-mcp/shared build`, then `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build`, then `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/coverage-report.test.ts src/__tests__/cobertura.test.ts src/__tests__/test-status-export.test.ts src/__tests__/test-coverage.test.ts src/__tests__/test-status.test.ts src/__tests__/test-status-governance.test.ts src/__tests__/export.test.ts src/__tests__/index.test.ts` -- expected: pass.
- `(loop)` Build admin, interop, ops and data, one call each; then `pnpm gen:tools-list-snapshot --force`, then `pnpm gen:tools-list-snapshot:check` -- expected: OK, with only the two entries differing.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-40-2-doc-claims.test.ts src/__tests__/story-40-1-doc-claims.test.ts src/__tests__/test-status-governance-keys.test.ts src/__tests__/tools-list-snapshot.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/story-39-1-gate-guards.test.ts src/__tests__/changelog-bootstrap-move.test.ts src/__tests__/interop-namespace-fixture.test.ts src/__tests__/data-policy-scope.test.ts` -- expected: pass.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-40-2-coverage-reports-live-gate.test.ts` -- expected: every row passes, none is skipped, the monitor is idle and nothing is left.
- `(loop)` In separate calls, `ENV … story-40-1-coverage-live-gate.test.ts` and `ENV … story-40-1-qa-live-gate.test.ts` -- expected: pass (regression).
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one call each for `build`, `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/all test`, split into calls that each finish inside the cap -- expected: green.
- `(once)` One call each: `pnpm gen:governance-baseline:check` (`1e62c5ad5bf7`/141), `pnpm measure:tools-payload` (equal to the README rows) and `node scripts/check-epics-sync.mjs` -- expected: OK.
- `(once)` Download the pinned DTD copy into the session scratchpad, never into the repo, and check its sha256 against the pin. Then `xmllint --noout --nonet --dtdvalid <scratchpad>/coverage-04.dtd <the gate's written file>` exits 0, and the same command on a copy with one `hits` attribute removed exits non-zero -- expected: both recorded here, agreeing with `cobertura-dtd.mjs` (decision #52).
- `(once)` The DW-596 measure: the `Status` time, response bytes and process memory for the 200,000-line synthetic record with `sources`, measured over HTTP and inside IRIS -- expected: recorded here, the read under 2 s.
- `(once)` After every armed run: `MonitorState` is `{active:0}`; `("session")` is unset; leftovers for `EXECMCPTMP402A` are `[]`; neither the namespace nor its database is listed; `iris_doc_list` (HSCUSTOM, `Story402`, `Story391Fixture`, `ExecuteMCPv2.Temp.`, generated included) is empty; no large fake record remains.

**Planned mutations (Rule 19).** Apply each one, observe red, revert, and reload or rebuild what it touched. Confirm that `git status --short` and `git diff --stat` are unchanged, and record it as `mutation: <change> -> <test>`. Run a mutation that could leave a session behind only with the gate's safety net in place, followed by the idle check.
- **AC-1:** offset k mapped to line D+k (off by one) → `coverage-report.test.ts` and gate rows 1-2.
- **AC-2:** compare the rounded percent → row 6 and the verdict unit table.
- **AC-3:** omit `minCoverage` from `Status` → gate row 7 (the poll has no verdict).
- **AC-4:** emit `complexity` on `<method>` → the `cobertura.test.ts` DTD check and gate row 9.
- **AC-5:** `export: "read"` → `test-status-governance-keys` and `test-status-governance`.
- **AC-6:** skip the `.xml` check → `test-status-export.test.ts`, row 12.
- **AC-7:** remove the DW-598 count check → gate row 13. The safety net stops the leftover session.
- **AC-8:** a `Hang 3` in `BuildSources` (a scratch copy loaded into HSCUSTOM) → gate row 14 ("returns within 2 s").
- **AC-9:** emit `source` with an empty `sources` → the 40.1 dev text pins.
- **AC-10:** a comment edit in `Job.cls` without `gen:bootstrap` → the `bootstrap.test.ts` drift check.

### Implement-stage results (2026-10-18)

**Bootstrap (AC-10).** `BOOTSTRAP_VERSION` moved `14a4cba6504a` → `3a3b4cf76502` (35 classes, unchanged; `Job.cls`, `Runner.cls` and `REST/Coverage.cls` changed; this is the final value, after review pass 1 changed `Job.cls` and `Runner.cls` again). `pnpm gen:bootstrap` was run twice after the IRIS classes were final: the second run produced a byte-identical `bootstrap-classes.ts` (`cmp` clean). `packages/shared/dist` and the `tsbuildinfo` were deleted before the rebuild of shared and then of every dist. The live gate's deployed-version assertion passed on the final build.

**Mutations (Rule 19).** Each was applied, observed red, reverted to a byte-identical file (`shasum -a 256` before and after, recorded in the session scratchpad), and the touched class or dist reloaded or rebuilt.
- mutation: class line = `D+1+offset` instead of `D+2+offset` in `mapClass` (coverage-report.ts) -> `coverage-report.test.ts` (6 mapping and text tests) and `cobertura.test.ts` (3 tests) red, 11 failures in all; live gate rows 1 and 2 red on the rebuilt dist (the executable lines read `[12, 13, 18, ...]`).
- mutation: `meetsMinimum` compares the rounded `percentOf` instead of the exact fraction -> `coverage-report.test.ts` (`meetsMinimum` and the row 6 verdict test) red; live gate row 6 red (`'pass'` where `'fail'` is expected).
- mutation: the Status route omits `minCoverage` from `BuildRun` (REST/Coverage.cls loaded into HSCUSTOM) -> live gate rows 4 and 7 red (`verdict` undefined; "the verdict is there exactly when a minimum was given").
- mutation: `<method ... complexity="0">` emitted in `buildCoberturaXml` -> `cobertura.test.ts` (golden, DTD validity, parsed-back and escaping tests) and `test-status-export.test.ts` red, 7 failures; live gate row 9 red (the validator reports 12 problems).
- mutation: `mutates.export` = `"read"` -> `test-status-governance.test.ts`, `test-status.test.ts`, `test-status-export.test.ts` (5 failures) and `test-status-governance-keys.test.ts` (iris-mcp-all) red.
- mutation: `validateOutputPath` without the `.xml` check -> `test-status-export.test.ts` and `cobertura.test.ts` red (3 failures); live gate row 12 red ("not .xml").
- mutation: `Runner.Run` without the `LoadedAsListed` call (REST classes loaded into HSCUSTOM) -> live gate row 13 red (the run does not fail with the routine named). The leftover session was one the run could not release (its routine list names a routine the session lacks); the gate's `afterEach` could not prove it (a non-clean outcome, as the mutation predicts), the monitor read idle afterwards, and the stale ownership node was cleared by the next run's start. Nothing of this story's was left active.
- mutation: `Hang 3` at the top of `BuildSources` (REST/Coverage.cls loaded into HSCUSTOM) -> live gate row 14 red (`iris_test_status poll returned in 3767 ms: expected 3767 to be less than 2000`).
- mutation: `buildCoverageSection` without its `run.sources === undefined` early return (a `source` emitted for a record with no `sources`) -> `coverage-report.test.ts` (3 back-compatibility tests) and the 40.1 pins in `test-coverage.test.ts` (2 tests) red.
- mutation: a comment edit in `Job.cls` without `gen:bootstrap` -> `bootstrap.test.ts` red (the embedded-content and `BOOTSTRAP_VERSION` drift checks).
- mutation: `LoadedRoutinesFailure` compares the two lists in order (`pRunList = pLoaded`) -> `CoverageSourceTest:TestLoadedRoutinesFailure` red ("the order is ignored").
- mutation: `INTLine` called with offset `tK + 1` in `MapMethod` -> `CoverageSourceTest:TestSourceMapOfTheFixture` red (10 assertions).
- mutation: the Status route without `sources` (the `BuildRun` line removed, REST/Coverage.cls loaded into HSCUSTOM) -> live gate row 1 red ("Story402.Fixture has a class-source result").
- mutation: an extra field (`extraField`) in the Status record -> the AD-33 key-set pin of live gate rows 1 and 4 red ("the raw Status record: the 40.1 keys plus sources ...").

**DW-596 measure (row 14, AC-8).** A synthetic completed run of 200,000 INT lines over 4 routines (180,000 skeleton entries, 100,000 counted lines, a source map of 180,000 body lines, `minCoverage` 50), seeded by `SeedLargeRun` and removed by `ClearLargeRun`: `GET Status` over HTTP 621 to 623 ms and 4,827,980 bytes; `iris_test_status poll` 727 to 734 ms; inside IRIS `BuildRun` 0.46 s, `BuildRun` plus JSON serialization 0.48 s, 4,827,920 bytes, process memory growth 62,794 KB (`$STORAGE` before and after). The summary was computed (180,000 executable class lines, 100,000 covered, 55.56 %, verdict `pass`). All under the 2 s budget. (Story 40.1's record without `sources`: 4,192,108 bytes, 0.47 to 0.50 s.)

**DTD cross-check (decision #52).** `coverage-04.dtd` at `cobertura/web` commit `f0366e5e2cf18f111cbd61fc34ef720a6584ba02` was downloaded into the session scratchpad only; its sha256 is `61fbbc0a260337fe9ad59bd671b52e5f2677978a41e1e5bb7ae594fa01252d06` (2,030 bytes), equal to the pin. A file written by a live `iris_test_status` export (with `sourceRoot`) passes `xmllint --noout --nonet --dtdvalid` with exit 0, and the same file with one `hits` attribute removed exits 3 (`Element line does not carry attribute hits`); `scripts/lib/cobertura-dtd.mjs` agrees on both (no problems; "the required attribute hits is missing"). The unit golden `story402-oracle.xml` also passes xmllint with exit 0 (and exits 3 with its `hits="0"` attributes removed). No DTD file is in the repository (`story-40-2-doc-claims.test.ts` walks `scripts`, `packages`, `src` and `docs`).

**Counts and runs.** OS tests, one class per call: `CoverageSourceTest` 7 of 7 (7 `Test*` methods), `CoverageJobTest` 31 of 31 (31), `CoverageReleaseTest` 6 of 6 (6); the totals equal the `Test*` counts (Rule #35). Dev: 66 files, 1,592 tests; shared 2,066; admin 498; interop 670; ops 350; data 165; client-config 514; each with build, lint and type-check clean (shared lint carries one pre-existing warning in `cli/governance.ts`). `@iris-mcp/all`: all 89 test files green, run in groups under the cap with `IRIS_REQUIRE_LIVE=1` (49 + 22 + 3 + 6 + 6 + the three coverage gates), with the 40.2 gate at 15 of 15, the 40.1 coverage gate at 25 of 25 and the 40.1 QA gate at 12 of 12 on the final build. `pnpm gen:governance-baseline:check` OK (`1e62c5ad5bf7`, 141 frozen keys, 71 post-foundation keys live), `pnpm gen:tools-list-snapshot:check` OK (115 entries, regenerated with `--force`; only the `iris_test_coverage` and `iris_test_status` entries changed), `node scripts/check-epics-sync.mjs` OK, and `pnpm measure:tools-payload` equals the README row (`@iris-mcp/dev` full and developer 93,633 bytes, core unchanged at 43,878).

**After the last armed run.** `MonitorState` `{active:0}`, `("session")` unset, `EXECMCPTMP402A` leftovers `[]` (asserted by each gate teardown), `iris_doc_list` for `Story402` and `ExecuteMCPv2.Temp.` (generated included) in HSCUSTOM empty, the large fake record `990000001` absent, and no `^IRIS.TempStory391Fixture` node.

### Review pass 1 results

**Bootstrap.** `BOOTSTRAP_VERSION` moved `ebe218846a57` → `3a3b4cf76502` (the story's move is `14a4cba6504a` → `3a3b4cf76502`; 35 classes, unchanged), because items 1 and 2 changed `Job.cls` and `Runner.cls`. `pnpm gen:bootstrap` ran twice and the second run is byte-identical (`cmp` clean); `packages/shared/dist` and `tsconfig.tsbuildinfo` were deleted and shared rebuilt, then dev, admin, interop, ops and data. The CHANGELOG, `tool_support.md`, the changeset and the `story-40-2-doc-claims.test.ts` literal carry the final value, and so does the "Bootstrap (AC-10)" note above. The live gate's deployed-version assertion passed on the final build. `bootstrap.test.ts` 47 of 47.

**What changed.**
- Item 1: `Job.SessionScopeFailure` (the scope checks of `ProofFailure`, same texts); `Runner.LoadedAsListed` proves a session that reports no routine by that scope alone. Row 13b is new in the live gate, sharing the hold/delete/release sequence with row 13 in `runWithGoneRoutineDeleted`. Its recompile of `Story402.Gone` is forced (`flags: "ck"`, because the default `cuk` skips an up-to-date class whose object code an earlier row deleted), and the helper no longer asserts that the runner lock is free after the release (the runner takes it for its whole life, so a slow run read as a lock failure and hid the row's own assertions). The gate's safety net gained the empty routine set, which the fixture proves by the ownership node's process list and routine count, so a zero-routine leftover is stopped by it.
- Item 2: `Runner.RecordUnstoppedSession(pId, pLoaded, pText)` holds the unstopped fallback, called from `LoadedAsListed`; `startError` is still written last.
- `CoverageSourceTest` (361 lines, 10 `Test*` methods) gains `TestSessionScopeFailure`, `TestRecordUnstoppedSessionRewritesTheRunAndItsNode` and `TestRecordUnstoppedSessionLeavesAnotherRunsNode` (fake run 990000003; the session node is written only while none exists, and removed again).
- Items 3 and 4: `exportCoverageRun` refuses a document of 0 classes, and says "Wait for it" only for `starting` and `running`. Item 5: a `hits="7"` case in `cobertura.test.ts`, and the determinism test now runs under two different fake clocks. Item 6: new `local-path.test.ts`. Item 7: the "could not be written" case. Item 8: the escapes. Item 9: the docs and pins (the dev README, the CHANGELOG section, the root README table row, and `story-40-2-doc-claims.test.ts`). Item 10: the `lines[1]` assertion.

**Mutations (Rule 19).** Each was applied, observed red, reverted to a byte-identical file (`shasum -a 256` before and after, or `cmp` against a backup in the session scratchpad), and the touched class reloaded or dist rebuilt.
- mutation: `Runner.LoadedAsListed` proves a session that monitors no routine with `ProofFailure` (the `AllNamed`-only proof) instead of `SessionScopeFailure` (Runner.cls loaded into HSCUSTOM) -> live gate row 13b red (`row 13b, as soon as the run is terminal: the monitor is idle afterwards (process list "0"): expected 1 to be +0`). The leftover session was stopped by the gate's safety net (the empty set, proven by the ownership node); the ownership node it left was reported by `afterAll` and cleared by the next start's `clear-and-proceed`. Nothing was stopped by hand. (A first attempt went red earlier, at the helper's lock assertion; that is why the assertion was removed.)
- mutation: delete the `routineList` rewrite in `Runner.RecordUnstoppedSession` -> `CoverageSourceTest:TestRecordUnstoppedSessionRewritesTheRunAndItsNode` and `:TestRecordUnstoppedSessionLeavesAnotherRunsNode` red (2 of 10).
- mutation: remove the `document.classes === 0` refusal in `exportCoverageRun` -> `test-status-export.test.ts` "a completed run in which no class has a class-source result is refused" red.
- mutation: the not-complete refusal always says "Wait for it" -> `test-status-export.test.ts` "a cancelled run, a failed run and an abandoned run: ... never to wait" red.
- mutation: write `hits > 0 ? 1 : 0` in `buildCoberturaXml` -> `cobertura.test.ts` "writes the INT count as hits, not a 0 or 1" red, and only that test (the golden's counts are 0 and 1).
- mutation: `assertInsideRoot`'s default `label` = "outputPath" -> `local-path.test.ts` (2 tests) red; `export.test.ts` stays green, which is the substring-pin gap the new file closes.
- mutation: the inner catch around `writeCoberturaFile` rethrows (the inner try/catch removed in effect) -> `test-status-export.test.ts` "a path the file system cannot write" red.
- mutation: the em dash of the `export` description sentence written as "-" -> `pnpm gen:tools-list-snapshot:check` red (`iris_test_status.description differs at $.description (character 2993)`); restored, dev rebuilt, the check is OK again (115 entries, snapshot unchanged).
- mutation: `unavailable` removed from the dev README source-reason sentence -> `story-40-2-doc-claims.test.ts` "has the coverage detail paragraphs" red.
- mutation: `**no class has a class-source result**` changed in the dev README export paragraph -> `story-40-2-doc-claims.test.ts` "has the export section of the iris_test_status detail entry" red.
- mutation: the dev README line-layout sentence removed -> `story-40-2-doc-claims.test.ts` "has the export section of the iris_test_status detail entry" red.
- mutation: the root README `iris_test_status` default-disabled row removed -> `story-40-2-doc-claims.test.ts` "lists iris_test_status in the root README's default-disabled table" red.
- mutation: `unavailable` removed from the CHANGELOG section -> `story-40-2-doc-claims.test.ts` "states the unchanged counts, the new key ..." red.
- mutation: `coverageTextLines` pushes no class-source lines (dev rebuilt) -> `story-40-1-coverage-live-gate.test.ts` row 1 red at `lines[1]` ("the class-source lines start right after the status line"); the old `lines.slice(1, -2).every(...)` assertion passes on that text.
- mutation: `Date.now()` instead of the run's `finishedAt` in `buildCoberturaXml` -> `cobertura.test.ts` (golden, "is deterministic ... whatever the clock says", the `hits="7"` case and the source-root case) and `test-status-export.test.ts` (golden, "a second export is byte-identical") red, 6 failures. (The old determinism test built twice inside one millisecond and stayed green under this mutation, so it was rewritten to build under two fake clocks.)
- mutation: remove the `run.status !== "completed"` branch of `exportCoverageRun` -> `test-status-export.test.ts` "a running run ..." and "a cancelled run, a failed run and an abandoned run ..." red.
- mutation: remove `.max(100)` from the `minCoverage` schema -> `test-coverage-minimum.test.ts` "refuses -1, 101, a string, null, a boolean and NaN" red.
- mutation: remove the `> 100` bound from `ValidateStart` (REST/Coverage.cls loaded into HSCUSTOM) -> `CoverageSourceTest:TestValidateStartMinCoverage` red (the four assertions for 100.5 and 101).
- mutation: `cobertura-dtd.mjs` without the required-attribute check -> `cobertura-dtd.test.ts` "rejects a dropped required attribute (hits)" and "(timestamp)" red.
- mutation: `cobertura-dtd.mjs` without the child-sequence check -> `cobertura-dtd.test.ts` "rejects a child out of order (lines before methods)", "a missing required child (class without lines)" and "a repeated single child (two <packages>)" red.
- mutation: `cobertura-dtd.mjs` without the DOCTYPE and root checks -> `cobertura-dtd.test.ts` "rejects no DOCTYPE", "a DOCTYPE that names another DTD" and "a wrong root" red.

**Counts and runs (final build).** OS tests, one class per call: `CoverageSourceTest` 10 of 10 (10 `Test*` methods), `CoverageJobTest` 31 of 31 (31), `CoverageReleaseTest` 6 of 6 (6); every file at or under 500 lines (`CoverageJobTest` stays at 500, unedited). Dev: 67 files, 1,603 tests (`local-path.test.ts` is new, 8 tests); lint and type-check clean. The `@iris-mcp/all` pin files (doc claims for 40.1 and 40.2, governance keys, snapshot, roster, gate guards, bootstrap move, fixture roster, scope, DTD): 11 files, 212 tests. `pnpm gen:tools-list-snapshot:check` OK (115 entries, nothing regenerated). Live: the 40.2 gate 16 of 16 (rows 1 to 14, 13b and 16), with the DW-596 read unchanged (Status over HTTP 615 ms, 4,827,980 bytes; `iris_test_status poll` 723 ms; inside IRIS build and serialize 0.474 s, process memory growth 62,794 KB), and the 40.1 coverage gate 25 of 25 on the strengthened row 1.

**After the last armed run.** `MonitorActive` 0, `("session")` unset, `EXECMCPTMP402A` leftovers `[]` (asserted by the gate teardown), `iris_doc_list` for `Story402` and `ExecuteMCPv2.Temp.` (generated included) in HSCUSTOM empty, fake run 990000003 absent.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** `iris_test_coverage` and `iris_test_status` now report coverage per class and per method over the class document's lines (`coverage.classes[].source`, `coverage.source`, the generated-code count), with an optional `minCoverage` verdict (`coverage.verdict`, unrounded, never an `isError`), reproduced from the handle alone by `iris_test_status poll`. `iris_test_status` gains `action:"export"` (key `iris_test_status:export`, `write`, DEFAULT-DISABLED, outside the frozen baseline): it writes the Cobertura XML of a completed run to an absolute `.xml` `outputPath` through the shared path guard. The IRIS side records the class-source map (`Job.SourceMap`, Status `sources`, `minCoverage`), and the runner now compares the routines its session loaded with the run's list before any test (DW-598), proving and stopping its own session at once (a session that monitors no routine is proven by its process scope). DW-596 is closed with evidence (Status read at the 200,000-line cap: about 0.62 s, 4.8 MB, 62.8 MB of process memory). `BOOTSTRAP_VERSION` `14a4cba6504a` -> `3a3b4cf76502` (35 classes).

**Files changed.**
- IRIS: `src/ExecuteMCPv2/Coverage/Job.cls` (`SourceMap`, `SessionScopeFailure`, `LoadedRoutinesFailure`, `WithRoutineList`, the `Finish` capture, `minCoverage`), `Coverage/Runner.cls` (`LoadedAsListed`, `RecordUnstoppedSession`), `REST/Coverage.cls` (`minCoverage`, `BuildSources`), new `Tests/CoverageSourceFixture.cls` and `Tests/CoverageSourceTest.cls`.
- Dev package: new `tools/local-path.ts`, `tools/coverage-report.ts`, `tools/cobertura.ts`; changed `tools/test-coverage.ts`, `tools/test-status.ts`, `tools/export.ts` (guard moved); new tests `coverage-report`, `cobertura`, `test-status-export`, `test-coverage-minimum`, `local-path`, the fixture `story402-run.ts` and the golden `fixtures/cobertura/story402-oracle.xml`; changed `test-coverage`, `test-status` and `test-status-governance` tests.
- Suite: new `scripts/lib/cobertura-dtd.mjs` (the DTD content model as own data; no DTD file in the repo), new `story-40-2-coverage-reports-live-gate.test.ts` (rows 1-14 and 13b, 16), `story-40-2-doc-claims.test.ts`, `cobertura-dtd.test.ts`; changed `coverage-fixture.ts`, `interop-namespace-fixture.ts` (+ its test), the 40.1 gates and doc pins, `test-status-governance-keys.test.ts`, `story-39-1-gate-guards.test.ts`, `prepublish-gate.mjs`, the tools-list snapshot (two entries), `bootstrap-classes.ts` (generated).
- Docs: dev README, root README (payload rows, default-disabled table), `tool_support.md`, `CHANGELOG.md`, `.changeset/story-40-2-coverage-reports-and-targets.md`.

**Review.** One review pass, 41 findings (high 1, medium 7, low 30, false 3), triaged in `## Review Triage Log`: 20 rows patched (11 Review items, all done), 21 rejected with recorded reasons, 0 deferred, no intent gap, no bad_spec. Patched entries by verdict: high 1 (a session that monitors zero routines could not be proven or stopped by the runner, leaving the instance-wide monitor active), medium 3 groups (the unstopped-fallback glue untested; export of an empty document; Cobertura `hits` pinned only at 0 and 1), plus the lows (exact `destinationDir` strings, write-failure result, Rule 14 escapes, docs, Rule 19 mutation lines, a weakened 40.1 assertion).

**Follow-up review recommendation: `true`.** A first pass patched a `high`. The specific unverified risk: the new zero-routine proof branch in `Runner.LoadedAsListed` (`Job.SessionScopeFailure`, a refactor of the 40.1 `ProofFailure`) and the `RecordUnstoppedSession` extraction were exercised by one live row (13b), OS unit tests and recorded mutations, but the lock-timeout and `Stop`-failure faults of the not-stopped branch are not injected live, and `Job.cls` and `Runner.cls` (so `BOOTSTRAP_VERSION`) moved a second time after the first review.

**Verification performed (final tree, the lead's own runs).** OS tests, one class per call: `CoverageSourceTest` 10 of 10, `CoverageJobTest` 31 of 31, `CoverageReleaseTest` 6 of 6 (totals equal the `Test*` counts). `gen:bootstrap` twice: second run byte-identical. Per package build, test, lint and type-check clean for shared (2,066 tests; one pre-existing lint warning), dev (67 files, 1,603), admin (498), interop (670), ops (350), data (165), client-config (514). `@iris-mcp/all`: all 89 test files pass armed (`IRIS_REQUIRE_LIVE=1`), in groups under the cap, with the 40.2 gate at 16 of 16, the 40.1 coverage gate 25 of 25 and the 40.1 QA gate 12 of 12 on the final build. `pnpm gen:governance-baseline:check` OK (`1e62c5ad5bf7`, 141 frozen keys), `pnpm gen:tools-list-snapshot:check` OK (115 entries; only the `iris_test_coverage` and `iris_test_status` entries and `capturedAt` differ from the baseline), `pnpm measure:tools-payload` equals the README rows, `node scripts/check-epics-sync.mjs` OK. `xmllint --dtdvalid` against the pinned DTD (sha256 `61fbbc0a…52d06` checked, held only in the session scratchpad): the golden file exits 0 and the same file with one `hits` removed exits 3, and `cobertura-dtd.mjs` agrees on both. DW-596 at 200,000 INT lines (the last gate run): Status over HTTP 617 ms and 4,827,980 bytes, `iris_test_status poll` 731 ms, inside IRIS 0.468 s to build and 62,794 KB of process memory. After the last armed run: the monitor idle, `("session")` unset, no `Story402` or `ExecuteMCPv2.Temp.` document, no `^IRIS.TempStory391Fixture` node, fake runs 990000001 and 990000003 absent. The matrix rows 1-16 each have a test that ran and passed (rows 1-14 and 16 in the gate, row 15 in the pre-existing suites, rows 8, 11, 12 also in `test-status-export.test.ts`); 35 mutation lines (14 from the implement stage, 21 from review pass 1) are recorded in `## Verification`.

**Calls beyond the contract, for the lead to confirm.**
- A class whose map cannot be built gets `source.reason:"unavailable"`.
- `export` also refuses a completed run in which no test method ran, and a completed run in which no class has a class-source result (an empty file would read as 100% to a CI tool).
- The DW-598 not-stopped fallback runs on every non-clean stop (no lock in time, no proof, `Stop` failed), not only on a failed `Stop`.
- An overall `notApplicable` verdict prints `NOT APPLICABLE (no executable class lines)`.
- Existing pins moved: the `mutates` pins, the 40.1 doc-claims argument lists, and four assertions of the 40.1 QA gate and two of the 40.1 coverage gate now strip the class-source lines or `source` keys before comparing, so they still pin the 40.1 shape.

**Residual risks.**
- `minCoverage` against an IRIS-side class older than this story is ignored (no verdict, no warning); AD-14 redeploys the classes on a version mismatch.
- The lock-timeout and `Stop`-failure faults of the DW-598 fallback are pinned by OS unit tests of the glue and of the proof helpers, not by a live fault injection.
- A class split into a `.2` routine and `CodeMode = call` methods were not probed live; Trigger and `SqlComputeCode` bodies count as generated.
- A retained pre-upgrade run record polls as `source.reason:"unavailable"` for every class (and cannot be exported).
- Privileges were probed under `_SYSTEM` only.
- Rule #55 slips by the implementation subagent (one Python edit of `test-coverage.ts`, one `sed` of the final bootstrap hash) were verified by `git diff --stat` and a text check; the final tree is text and green.
