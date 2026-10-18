---
title: 'Story 40.3: TestProduction Runs'
type: 'feature'
created: '2026-10-18'
status: 'in-progress'
baseline_revision: '890f9db2290f74534a32f2b7697e578cb432324e'
baseline_commit: '890f9db2290f74534a32f2b7697e578cb432324e'
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

**Problem:** `iris_execute_tests` already runs `%UnitTest.TestProduction` tests, and a run silently stops any other production in the namespace: `%UnitTest.TestProduction` stops (and, if it will not stop, force-stops and cleans) whatever production is not stopped before it starts its own, and the tool still reports "passed" (plan probe). `iris_test_coverage` runs the same tests in its own runner, so it would do the same. On a shared instance that disturbs someone else's production.

**Approach:** One IRIS-side guard decides, under Ens's own production lifecycle lock, whether a run that includes a TestProduction test may go ahead: only when the namespace's production is stopped or is one those tests declare as their own. `iris_execute_tests` asks it through a new read route before it queues anything, and `iris_test_coverage`'s `Start` asks it before it allocates a run. Otherwise both tools refuse with a new code `PRODUCTION_BUSY`, naming the production, and change nothing. Runs with no TestProduction test are unchanged.

## Boundaries & Constraints

**Always:**

- **Which runs are guarded.** A run is guarded when any test class it will run is a `%UnitTest.TestProduction` subclass, at every level. A method-level run of such a class is guarded whatever the method, because a subclass method can call the private `StartProduction`.
  - **Class and method level.** The class is the target, or the part before the `:`, trimmed.
  - **Package level.** The classes are those that `SELECT Name FROM %Dictionary.ClassDefinition WHERE Name %STARTSWITH ? AND Abstract = 0 AND Name IN (SELECT Name FROM %Dictionary.ClassDefinitionQuery_SubclassOf('%UnitTest.TestProduction'))` returns for `<package>.`. These are the same predicates as the tool's own discovery (`execute.ts` `discoverPackageTests`), with the TestProduction root.
  - **Is a class a TestProduction test, and what is its production?**
    - On the `iris_execute_tests` path, when the class is compiled and `$System.OBJ.IsUpToDate` is true, the compiled class answers: `%Extends("%UnitTest.TestProduction")` and `$parameter(<class>,"PRODUCTION")`.
    - Otherwise its definition answers, because the Atelier queue compiles the definition before it runs (`v8.cls:706-713`). Follow the superclasses (`$$$defClassKeyGet(<class>,$$$cCLASSsuper)`, normalized with `$$$NormalizeClassnameByDef`) through their definitions, or through a superclass's compiled class when that superclass is compiled and up to date. It is a TestProduction test when the chain reaches `%UnitTest.TestProduction`. Visit at most 32 classes, each once.
    - Its production is the `PRODUCTION` default of the nearest class on that path whose definition sets it, or else the compiled superclass's `$parameter`.
    - On the coverage path, only the compiled class answers, because the runner never compiles (`/noload`).
    - A class that is neither compiled nor defined is not a TestProduction test.
  - **The run's own productions** are the `PRODUCTION` values of its TestProduction tests.
- **The decision (AD-27, AD-12: atomic, IRIS-side).** It lives in `ExecuteMCPv2.REST.UnitTest` and runs in the target namespace. It is the same function on both paths.
  - **No TestProduction test.** The result is `proceed`, with `testProductions: []`. No `Ens.*` class is called and no lock is taken.
  - **Otherwise:**
    - take `Lock +^Ens.Runtime:5` (Ens's own lifecycle lock), call `##class(Ens.Director).GetProductionStatus(.name, .state, 2)`, and release the lock;
    - every Ens call and the lock are inside one Try/Catch;
    - decide with the pure `GuardOutcome` (the table in Design Notes): `proceed` when the state is Stopped (`$ZAbs(state)=2`) or the name is one of the run's own productions, otherwise `busy`;
    - a lock that is not acquired, an error status or an exception is `busy` with `state` `Unknown` and an `error` text, sanitized.
  - **The state label** comes from `##class(ExecuteMCPv2.REST.Interop).StateName`, reused.
  - **The raw result** is `{decision, namespace, testProductions:[{class, production}], production?, state?, stateCode?, error?}`.
    - `production`, `state` and `stateCode` are present exactly when the state was read.
    - `testProductions` is sorted by class.
- **The new route (AD-11, AD-13, AD-33: additive).** `GET /dev/test/production?target=&level=&namespace=` is handled by `ExecuteMCPv2.REST.UnitTest:ProductionCheck`.
  - It validates `target` (required) and `level` (`package|class|method`) before any switch, switches namespace, restores it on every path, and renders once.
  - A namespace that cannot be switched to returns `proceed` with no TestProduction tests: nothing can run there, so the run then fails exactly as it does today.
  - Every other route is byte-identical.
- **`iris_execute_tests` (AD-15: a sanctioned change on a frozen key).**
  - **Where the check goes.** After the `tests` array is built (the malformed-target and zero-test results keep their precedence), and before `ensureUnitTestRoot`, the counter read and `POST /work`, the handler GETs the route with `target`, `level` and `namespace` sent explicitly (Rule #10).
  - **`busy`.** The handler returns `refusalResult(REFUSAL_CODES.PRODUCTION_BUSY, text, fields)` and makes no other call.
  - **A 404** (the route is absent: the IRIS-side classes predate this story, or the service is not deployed) means the run goes ahead exactly as it does today.
  - **Any other guard error** reaches the existing catch, so it is today's `Error executing tests for '<target>': …` result, and nothing is queued.
  - **Unchanged.** No action, parameter, key, classification or annotation changes (DW-498 belongs to 40.4). The description gains one guard sentence.
- **`iris_test_coverage`.** `REST.Coverage.Run`, already in the target namespace, calls the guard with compiled-only resolution after the routine checks and before `EnsureUnitTestRoot`.
  - On `busy` it returns `{outcome:"production-busy", …the raw fields}`, with no run id, no write and no session.
  - The TypeScript handler maps that outcome to the same `PRODUCTION_BUSY` refusal through the shared builder.
  - The description gains one guard sentence.
- **The refusal.** `PRODUCTION_BUSY` joins `REFUSAL_CODES` (9 → 10).
  - **Fields:** `{namespace, state, testProductions, production?, error?}`.
  - **Text:** as in Design Notes, in the `<what happened>. <what to do>.` form. It names the production and says it was left untouched.
  - **One builder** in the new `test-production-guard.ts` serves both tools.
- **Bootstrap (AD-14).** `REST/UnitTest.cls`, `REST/Dispatch.cls` and `REST/Coverage.cls` change.
  - Run `pnpm gen:bootstrap` once the classes are final, and a second time to prove it is idempotent.
  - Record `BOOTSTRAP_VERSION` `06b8b83fc319` → new in this story's CHANGELOG section. It stays at 35 classes.
  - Rebuild shared after any regeneration (DW-591).
- **Shared instance.**
  - Productions start only in the gate's disposable `EXECMCPTMP403A`: through TestProduction runs, or through `iris_production_control` for the foreign stand-in.
  - The gate stops every production it started. It uses no other namespace except the bare `EXECMCPTMP403B`.
  - The gate makes `EXECMCPTMP403A` production-enabled with the single node `^%SYS("Ensemble","InstalledNamespace","EXECMCPTMP403A")`, through new fixture methods. It kills that node before the namespace is removed (orchestrator decision 4).
  - No TestProduction subclass ever exists in HSCUSTOM or in any `ExecuteMCPv2.*` package. Even a misconfigured one stops a running production (Design Notes), and the OS tests run in HSCUSTOM.
- **Text.** Source is ASCII, written with escapes (Rule 14). Comments state the contract.

**Never:**

- No suite code ever starts, stops, updates, recovers or cleans a production. The guard only reads, under the lock. The gate's own fixture calls are the only exception, and only in `EXECMCPTMP403A`.
- No `%Library.EnsembleMgr.EnableNamespace`.
- No suite code holds `^Ens.Runtime` beyond the decision, or across test code. The one exception is test-only: the gate fixture's `HoldEnsRuntime`, in the scratch namespace, for row 13.
- No new tool, action, governance key, preset row or `TOOL_PAIRS` entry.
- No change to `iris_execute_tests`' annotations, to `POST /tests` (`RunTests`, which has no tool caller; only its class comment gains a sentence saying it is not guarded), or to 40.1/40.2's monitor busy decision, release or reclaim (the guard runs before `Launch`).
- The guard never reads the `Ens.Config.Item` extent (AD-22). The test's production comes from its class.
- No hand edit of generated files. The governance check runs as `:check` only. No `changeset version` and no publish.

## I/O & Edge-Case Matrix

**Fixtures.**

- **`EXECMCPTMP403A`** has interop mappings and the InstalledNamespace node. It holds:
  - `Story392.Operation` (`STORY392_OPERATION_SOURCE`, reused verbatim);
  - `Story403.Production`, whose one item is `Story403.Target`;
  - `Story403.Other` (item `Story403.OtherTarget`), the foreign stand-in;
  - TestProduction tests with `MAXWAIT = 3` and `MINRUN = 1`:
    - `PassTest` (`CheckResults` asserts true);
    - `FailTest` (asserts false, "fail fixture");
    - `ErrorTest` (`CheckResults` divides by zero);
    - `OtherTest` (`PRODUCTION` = `Story403.Other`);
    - `BadTest` (`PRODUCTION` = `Story403.Missing`);
    - `Mixed.ProdTest`;
  - plain tests: `PlainTest`, `Plain.OneTest` and `Mixed.PlainTest`.

  Every test except `OtherTest` and `BadTest` uses `Story403.Production`.
- **`EXECMCPTMP403B`** is bare and holds `Story403.PlainTest`.
- **"Other untouched"** means that `GET /interop/production/status?namespace=A` shows the same name, state and `startTime`, and that the processes `leftovers` lists for A are the same.
- **"Nothing ran"** means the `%UnitTest_Result.TestInstance` row count in A is unchanged (raw Atelier query).
- **The values** below are the plan probe's. The implement stage captures them live (Rule #36).
- **The calls** name `server:"default"`.

| # | Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|---|
| 1 | Pass fixture (AC 40.3.1, 40.3.3) | No production; `iris_execute_tests {target:"Story403.PassTest", level:"class", namespace:A}` | `completed`, total 1, passed 1, one detail `{class:"Story403.PassTest", method:"TestControl", status:"passed"}`. Afterwards: Stopped, and no `process`/`^%SYS(` entry for A in `leftovers` other than the InstalledNamespace node | None |
| 2 | Fail fixture | `Story403.FailTest` | `completed`, failed 1, message `AssertTrue: fail fixture`; Stopped afterwards | None |
| 3 | Guard, class level (AC 40.3.2) | `Story403.Other` started with `iris_production_control`; row 1's call | `isError:true`, `{code:"PRODUCTION_BUSY", namespace:A, production:"Story403.Other", state:"Running", testProductions:[{class:"Story403.PassTest", production:"Story403.Production"}]}`; nothing ran; Other untouched | Refusal text (Design Notes) |
| 4 | Method level | Other running; `Story403.PassTest:TestControl`, `level:"method"` | As row 3 | Refusal |
| 5 | Package level | Other running; `Story403.Mixed`, `level:"package"` | Refused; `testProductions` is only `Story403.Mixed.ProdTest` | Refusal |
| 6 | Non-TestProduction runs unchanged (AD-15) | Other running; `Story403.PlainTest` (class) and `Story403.Plain` (package); the same two calls captured first with no production | Each completes with `structuredContent` deep-equal to its no-production capture, apart from `jobId`, `runIndex` and durations; Other untouched | None |
| 7 | Misconfigured TestProduction | Other running; `Story403.BadTest` | Refused, `testProductions:[{class:"Story403.BadTest", production:"Story403.Missing"}]`; Other untouched | Refusal |
| 8 | The test's own leftover | No production; `ErrorTest`, then `PassTest` | `ErrorTest`: failed, `ERROR #5002: ObjectScript error: <DIVIDE>CheckResults+1^Story403.ErrorTest.1`, and `Story403.Production` is left Running. `PassTest` then passes, and the production is Stopped afterwards | None |
| 9 | Another test's leftover | No production; the row runs `ErrorTest` (leaving `Story403.Production` running), then `Story403.OtherTest` | Refused, naming `Story403.Production` (Running); the leftover is untouched; the gate then stops it | Refusal |
| 10 | Coverage path refused (Integration) | Other running; `iris_test_coverage {target:"Story403.PassTest", level:"class", classes:["Story403.PassTest"], namespace:A}`, enabled | The same `PRODUCTION_BUSY` fields; `^IRIS.TempExecuteMCPv2Coverage("seq")` unchanged; monitor idle, `("session")` unset; Other untouched | Refusal |
| 11 | Coverage path, own production | No production; row 10's call | `completed`, 1 passed, `coverage.complete:true`; Stopped afterwards; monitor idle | None |
| 12 | Raw route (AD-33) | `GET /api/executemcp/v2/dev/test/production` for `Story403.PlainTest` and for `Story403.PassTest` (class, A), with no production | `{decision:"proceed", namespace:A, testProductions:[]}` with no `stateCode`; then `{decision:"proceed", …, testProductions:[{…}], production:"", state:"Stopped", stateCode:2}` | None |
| 13 | State unreadable | The fixture holds `^Ens.Runtime` in A (`HoldEnsRuntime`, 10 s); row 1's call | `PRODUCTION_BUSY`, `state:"Unknown"`, `error` naming the lock; nothing ran; the holder is then released | Refusal |
| 14 | Uncompiled TestProduction class | Other running; `Story403.FreshTest` (`PRODUCTION` = `Story403.Production`) put but not compiled; class level | Refused (Atelier would compile and run it) | Refusal |
| 15 | Not-configured namespace (Rules #34, #41) | Bare B; `Story403.PlainTest` via the tool and the raw route | The tool completes; the route returns `proceed`, `testProductions:[]`, no `stateCode` | None |
| 16 | Guard failures (unit) | Mocked http: the guard GET answers 404; then 500; then `busy` | 404: the run proceeds and the calls and result are byte-identical to today. 500: `Error executing tests for '<target>': …`, and `/work` is never POSTed. `busy`: the refusal, and `ensureUnitTestRoot` and `/work` are never called | As stated |
| 17 | Coverage outcome (unit) | Mocked `Start` returns `production-busy` | The refusal; `Status` is never read | Refusal |

</intent-contract>

## Code Map

**Probe facts the implementation depends on** are in Design Notes ("Probe evidence"). Each one is load-bearing.

**IRIS side**
- `src/ExecuteMCPv2/REST/UnitTest.cls`. Add `ProductionCheck` (the HTTP entry), `ProductionGuard(pTarget, pLevel, pCompiles, Output pResult) As %Status`, `TestProductions(pTarget, pLevel, pCompiles) As %List` and the pure `GuardOutcome`.
  - The class comment (:1-15) gains the guard, and a note that `RunTests` (:26, unchanged) is not guarded.
  - `BuildTestSpec` (:168-204) is the package-query precedent; leave it unchanged.
- `src/ExecuteMCPv2/REST/Dispatch.cls`: add `<Route Url="/dev/test/production" Method="GET" Call="ExecuteMCPv2.REST.UnitTest:ProductionCheck" />` beside the coverage routes (:191-193). It stays last in the bootstrap.
- `src/ExecuteMCPv2/REST/Coverage.cls`:
  - in `Run` (:251-293), insert the guard after the line-cap check (:280-283) and before `EnsureUnitTestRoot` (:284);
  - add a `production-busy` outcome builder beside `BusyResult` (:412);
  - update the class comment (:1-19).
- Reuse:
  - `REST/Interop.cls` `StateName` (:24-27);
  - `Coverage/Job.cls` `IsClassName` (:467) for the class segment;
  - `ExecuteMCPv2.Utils` `SwitchNamespace` and `SanitizeError`.
- System source, read-only:
  - `irislib/%UnitTest/TestProduction.cls`: `StartProduction` (:819-880, the not-Stopped branch :828-842), `TestControl` (:909-946, `GoTo Stop` :913-914, `Stop` :928-929), `CheckEnvironment`/`CheckNamespace` (:776-783, :813-817) and `GetMacros` (:794-811);
  - `irislib/Ens/Director.cls`: `GetProductionStatus` (:532-597), and `^Ens.Runtime` taken at :34, :175, :237, :326, :701 and :1685;
  - `irislib/%Api/Atelier/v8.cls`: the unittest path (:599-750; it compiles at :706-713 and runs at :736);
  - `irislib/%occReference.inc`: `defClassKeyGet`, `defMemberKeyGet` and `comClassDefined`;
  - `irislib/%occKeyword.inc`: `cCLASSsuper` 60, `cCLASSparameter` "p" and `cPARAMdefault` 22;
  - `irislib/%occName.inc:55` `NormalizeClassnameByDef`;
  - `irislib/EnsConstants.inc:8-14` (the states).
- Tests: a new `src/ExecuteMCPv2/Tests/ProductionGuardTest.cls` (≤ 500 lines, test-only, out of the bootstrap). It defines no TestProduction class.

**TypeScript, shared** (`packages/shared/src/`)
- `refusals.ts:33-35`: add `PRODUCTION_BUSY` after `MONITOR_BUSY`.
- `__tests__/refusals.test.ts:45-56`: the catalog pin (+1, and its title).

**TypeScript, dev** (`packages/iris-dev-mcp/src/tools/`)
- New `test-production-guard.ts`:
  - `readProductionGuard(ctx, ns, target, level)`: the GET, with `undefined` on 404;
  - `productionBusyRefusal(guard)`: the one builder;
  - the `ProductionGuardResult` type.
- `execute.ts`:
  - the handler (:865-1206): insert the guard after the `tests` array is built (:946) and before `ensureUnitTestRoot` (:957); the existing catch (:1176-1204) handles other errors unchanged;
  - the description (:1211-1239), with one sentence added;
  - `BASE_URL` :23;
  - the discovery query (:501-505), whose predicates the IRIS package query mirrors.
- `test-coverage.ts`:
  - `StartResult` (:153-157) gains the `production-busy` outcome and its fields;
  - the handler branch goes at :878, beside `busyRefusal` (:822, unchanged);
  - the description gets one sentence after :955.
- Tests:
  - new `src/__tests__/test-production-guard.test.ts`;
  - `src/__tests__/execute.test.ts`: the `iris_execute_tests` `beforeEach` (:872-895) routes `GET /api/executemcp/v2/dev/test/production?` to its own mock, which answers `{decision:"proceed", namespace, testProductions:[]}` by default (mock plumbing only, as for `/global`; no test body changes);
  - the same plumbing in every other file that drives `createExecuteTestsHandler` with a mocked http (search for it; `execute-tests-running-contract-epic-gate.test.ts` is one);
  - `src/__tests__/test-coverage.test.ts`: matrix row 17.

**iris-mcp-all** (`packages/iris-mcp-all/`)
- `src/__tests__/interop-namespace-fixture.ts`. In `FIXTURE_CLASS_SOURCE` (:94), add:
  - `SetInstalledNamespace(pName)` and `ClearInstalledNamespace(pName)`. Both refuse a name that is not `1"EXECMCPTMP"1.N1U` or a namespace that does not exist (`Config.Namespaces`, in %SYS), and touch only that node;
  - `HoldEnsRuntime(pNamespace, pSeconds)`, `EnsRuntimeRun`, `EnsRuntimeHeld` and `ReleaseEnsRuntime`, following the `HoldMonitorLock` pattern (:516-560), JOBbed into the scratch namespace only, for at most 30 s.

  `Leftovers` already reports every `^%SYS("Ensemble",*,<ns>)`. Also reused from this file: `createInteropNamespace` :865, `removeInteropNamespace` :915 and `STORY392_OPERATION_SOURCE` :1019.
- `src/__tests__/interop-namespace-fixture.test.ts`: the method roster (:237-262 pattern) gains a Story 40.3 case pinning the new methods' guards.
- New `src/__tests__/testproduction-fixture.ts`: the `Story403` sources, `seedTestProductionFixture(dev, ns)` (put and compile through `putCompileSeed` or `docFixtures`), and `removeTestProductionNamespace`. The last one, when A exists, stops its production (`iris_production_control` stop, `force`), clears the node and calls `removeInteropNamespace`; it is idempotent, and is used before and after the run.
- New gate `src/__tests__/story-40-3-testproduction-live-gate.test.ts`:
  - templates: the 40.2 gate's shape and setup (:320-372); the 39.2 gate's production start and stop (:170-180, :673-720);
  - helpers from `process-gate-helpers.ts`: `atelierQuery`, `rawIrisRequest`, `assertDeployedBootstrapVersion` and `teardownRecorder`;
  - it opens the built dev (governance enabling `iris_test_coverage`), admin and interop dists.
- Rosters:
  - `scripts/prepublish-gate.mjs` `gateTestFiles` (:145-247), and the comments that count the gates that start Line-by-Line sessions: row 11 makes this gate the fifth;
  - `src/__tests__/story-39-1-gate-guards.test.ts` `GATES` (:74-77);
  - `live-gate-roster.test.ts`.
- New `src/__tests__/story-40-3-doc-claims.test.ts`, and the 40.1/40.2 doc-claims pins that the doc edits move.
- `src/__tests__/fixtures/tools-list-snapshot.json`, regenerated through `--force`.

**Docs**
- `packages/iris-dev-mcp/README.md`: the rows at :223 (`iris_execute_tests`) and :254 (`iris_test_coverage`), and the details at :1487 and :1788.
- `tool_support.md`: rows 15 (:43) and 32 (:60), the ExecuteMCPv2-dependence paragraph (:469; the guard needs the service, and without it the run is unguarded), and a Story 40.3 note after :220.
- Root `README.md`: the payload rows, equal to `pnpm measure:tools-payload`.
- `CHANGELOG.md`: a new top section.
- `.changeset/`: one new file.

## Tasks & Acceptance

**Execution:**

1. `src/ExecuteMCPv2/REST/UnitTest.cls`.
   - Implement `TestProductions`, `GuardOutcome`, `ProductionGuard` and `ProductionCheck` exactly as the Boundaries say: AD-13 save and restore, one render, and errors through `SanitizeError`.
   - Update the class comment.
2. `src/ExecuteMCPv2/REST/Dispatch.cls`: the route.
3. `src/ExecuteMCPv2/REST/Coverage.cls`: the guard call in `Run`, the `production-busy` outcome, and the comment.
4. `src/ExecuteMCPv2/Tests/ProductionGuardTest.cls`. Cover:
   - every row of the `GuardOutcome` table (Design Notes);
   - `TestProductions` in HSCUSTOM for `ExecuteMCPv2.Tests.UnitTestTest` (class), `ExecuteMCPv2.Tests.UnitTestTest:TestX` (method), a missing class and the `ExecuteMCPv2.Tests` package. All are empty, and the last pins that the project's test package holds no TestProduction subclass;
   - `ProductionGuard` on a plain target: `proceed` with no `stateCode`.

   It starts no production and defines no TestProduction class.
5. Run `pnpm gen:bootstrap` twice and record the move. Rebuild shared (DW-591).
6. `packages/shared/src/refusals.ts` and its test: `PRODUCTION_BUSY`.
7. `packages/iris-dev-mcp/src/tools/test-production-guard.ts` (new): the GET (query values URI-encoded), the 404 rule and the refusal builder.
8. `packages/iris-dev-mcp/src/tools/execute.ts`. Wire in the guard, and add the description sentence (Design Notes). Nothing else in the handler moves.
9. `packages/iris-dev-mcp/src/tools/test-coverage.ts`: the outcome, the branch and the sentence.
10. Dev tests:
    - `test-production-guard.test.ts`: the text and fields for each case, and the path and encoding;
    - matrix rows 16-17;
    - the mock plumbing in every `createExecuteTestsHandler` test file. Existing bodies and assertions stay unchanged; that is the AD-15 pin.
11. iris-mcp-all:
    - the fixture methods and their roster case;
    - `testproduction-fixture.ts`;
    - the gate, with matrix rows 1-15 each self-contained:
      - every row that starts a production ends with it Stopped;
      - row 11 follows the 40.x monitor discipline (idle before, idle after, `StopIfList` safety net with `Story403.PassTest.1`);
      - `afterAll` calls `removeTestProductionNamespace` for A, then removes B, and asserts `leftovers` for both is `[]`, `iris_doc_list` (HSCUSTOM, `Story391Fixture`, `Story403`, generated included) is empty, and the monitor is idle;
    - the rosters and the session-gate comments;
    - `story-40-3-doc-claims.test.ts`.
12. Docs and generated artifacts:
    - the README rows and details (the guard and the code; `iris_execute_tests` stays enabled; no new key);
    - `tool_support.md`;
    - the CHANGELOG section `## [Pre-release — 2026-10-18] — Story 40.3: TestProduction runs`: the guard on both tools, the code, the route, the bootstrap move, the snapshot regeneration (decision #29), the counts (unchanged; 10 refusal codes), the residuals (Design Notes), and the earliest IRIS version verified;
    - the changeset `.changeset/story-40-3-testproduction-runs.md` (`"@iris-mcp/dev": minor`, `"@iris-mcp/shared": patch`);
    - `pnpm gen:tools-list-snapshot --force` after every package is built, and the README payload rows.

**Acceptance Criteria:**

- **AC-1 (40.3.1, 40.3.3).** Given the built dev server and the `Story403` fixtures in `EXECMCPTMP403A` with no production running, when `iris_execute_tests` runs the pass and fail fixtures (rows 1-2), then each reports its live-captured result, and the namespace's production is Stopped with no production process left.
- **AC-2 (40.3.2).** Given `Story403.Other` running, when `iris_execute_tests` runs a TestProduction target at class, method or package level, a misconfigured one, another test's production or an uncompiled one (rows 3-5, 7, 9, 14), then each call is `PRODUCTION_BUSY` naming the running production, no test runs, and that production is left exactly as it was.
- **AC-3 (AD-15).** Given `Story403.Other` running, when plain tests run (row 6), then the results deep-equal the no-production captures. And given every pre-existing `iris_execute_tests` unit test with only the guard GET plumbed, when the suites run, then they pass unchanged, and the regenerated tools-list snapshot differs only in the `iris_execute_tests` and `iris_test_coverage` descriptions.
- **AC-4 (own production).** Given the test's own production left running (row 8), when the test runs, then it proceeds and passes, and the production is Stopped afterwards.
- **AC-5 (Integration AC).** Given the consumer `iris_test_coverage`, when it starts a TestProduction run while `Story403.Other` runs (row 10), then it reads the same IRIS-side decision and produces the same refusal, with no run allocated and the monitor idle. With no production running (row 11), the run completes.
- **AC-6 (fail-safe).** Given Ens's runtime lock held elsewhere (row 13), when a TestProduction run is asked for, then it is refused with `state:"Unknown"`.
- **AC-7 (route, not-configured).** Given rows 12 and 15, when the raw route and the tool run, then the shapes are as stated, and a run with no TestProduction test never reads Ens state.
- **AC-8 (guard failures).** Given rows 16-17, when the guard is absent or fails, then the run proceeds unchanged on a 404, and fails before queueing on any other error.
- **AC-9 (teardown).** Given every armed run, when the gate ends, then `leftovers` for A and B is `[]`, including the InstalledNamespace node. Neither namespace nor database is listed, and no `Story403` or fixture document remains in HSCUSTOM.
- **AC-10 (bootstrap).** Given `pnpm gen:bootstrap`, when it runs twice, then the second run changes nothing, and the gate's deployed-version assertion passes.

### Review Findings

Code review 2026-10-18 (`bmad-code-review`, four layers: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor; all delivered). 28 raw findings, grouped into 13 entries (2 high, 3 medium, 8 low), 7 rows rejected, plus one medium the reviewer found with the repository in view (Rule 2, DW-603). Each entry: severity / fix-risk / footprint / disposition. Every patch below was applied in the review pass; the evidence (mutations, armed runs) is under `## Verification`, "Mutation results (code review)" and "Verification run record (code review)".

- [x] [Review][Patch] **HIGH: a plain class- or method-level `iris_execute_tests` run fails in a namespace that cannot see the `ExecuteMCPv2` package** [src/ExecuteMCPv2/REST/UnitTest.cls:384] — high / fix-risk low (one visibility check before the guard, answered like the unswitchable branch) / in-story / patch. `ProductionCheck` switches to the target namespace and `ResolveTest` calls `##class(ExecuteMCPv2.Coverage.Job).IsClassName` for every class, plain ones included, so where the package is not mapped (the `%ALL` mapping is non-fatal in the bootstrap and absent after manual setup options 1 and 2, `bootstrap.ts:88-93`, `:377-378`) the route errors and every plain run ends as `Error executing tests`. Before this story such runs worked (the Atelier path needs no ExecuteMCPv2 class). Violates AD-15's Story 40.3 bullet ("a run with no TestProduction test ... behave[s] exactly as before"), so HIGH by Rule 6 (Edge Case Hunter + Acceptance Auditor). Fix: a namespace whose class dictionary lacks the guard's classes answers `proceed` with no TestProduction tests, as a namespace that cannot be switched to does (decision #56's rule that a server that cannot run the guard behaves as before), and the docs name the limit. Not reachable on this instance (`%ALL` maps the package into every namespace, `%SYS` included: probe `GET /dev/test/production?target=Security.Users&level=class&namespace=%SYS` answered `proceed`).
- [x] [Review][Patch] **HIGH: `iris_test_coverage` at `level:"package"` with a class target runs the class unguarded** [src/ExecuteMCPv2/REST/Coverage.cls:290] — high / fix-risk low / in-story / patch. `BuildTestSpec` falls back to `:<target>` when the package holds no test class (`UnitTest.cls:210`), so the runner runs that class, while the guard, asked at package level, lists only classes under `<target>.` and answers `proceed`; a TestProduction class run this way stops another production. Violates the spec's "a run is guarded when any test class it will run is a TestProduction subclass, at every level" and AD-27's busy check (Rule 6). The execute path is not affected (its discovery returns the zero-test result first) (Edge Case Hunter). Fix: when the coverage spec is that fallback, the guard is asked at class level; a new gate row pins it.
- [x] [Review][Patch] **MED: a stale class at package level escapes the coverage-path guard** [src/ExecuteMCPv2/REST/UnitTest.cls:515] — medium / fix-risk low / in-story / patch. Probe (2026-10-18, `ExecuteMCPv2.Temp.Probe403R` in HSCUSTOM, removed): `SubclassOf` follows the class definition (an uncompiled `Extends %UnitTest.TestCase` is listed; a compiled TestCase saved as `Extends %RegisteredObject` without a compile is not). The Atelier path compiles definitions, so it is consistent; the coverage runner runs compiled classes (`BuildTestSpec`: definitions with `Abstract = 0`, compiled `%Extends`), so a class compiled as a TestProduction test and saved afterwards without that superclass is run but not listed (Blind Hunter + Edge Case Hunter). Fix: on the compiled-only path the package candidates are the runner's own (`BuildTestSpec`'s query) and the compiled class decides each one; a new gate row pins it.
- [x] [Review][Patch] **MED: row 15b's "the lock was released" check cannot see a lock leaked by the process that serves it** [packages/iris-mcp-all/src/__tests__/interop-namespace-fixture.ts:879] — medium / fix-risk low / in-story / patch. `EnsRuntimeHeld` tries `Lock +^Ens.Runtime:0` in the calling CSP process; an IRIS lock is incremental per process, so if the pooled process that served the guard GET leaked the lock, the check reads it as free (Rule 19 / project rule #59: the oracle cannot fail on the path it guards) (Verification Gap + Acceptance Auditor). Fix: the check asks a freshly JOBbed probe process, which never holds the lock itself.
- [x] [Review][Patch] **MED: the QA gate is a near-copy of the main 40.3 gate's helpers, and its copy dropped the settled leftovers check and the hardened namespace helpers** [packages/iris-mcp-all/src/__tests__/story-40-3-qa-live-gate.test.ts:200; packages/iris-mcp-all/src/__tests__/story-40-3-testproduction-live-gate.test.ts:172] — medium / fix-risk med (two live gates re-run) / in-story / patch. About twenty helpers (`fixtureCall` to `withoutRunValues`) are repeated with only the namespace changed, with no stated reason (Rule 2); the QA gate also seeds and removes its namespace inline (bypassing `createTestProductionNamespace`/`removeTestProductionNamespace`, whose stop, clear, remove order is pinned) and reads `leftovers` once at teardown without the 10 s settle the main gate needs for a lingering work-queue worker (Rule 19 hermeticity). `runCounter` in the main gate is unused (Blind Hunter + Verification Gap). Fix: one shared helper module both gates use; the QA namespaces renamed `EXECMCPTMP403W`/`EXECMCPTMP403X` so they go through the fixture's helpers.
- [x] [Review][Patch] **LOW: `^Ens.Runtime` is not released when the error text itself throws inside `Catch exEns`** [src/ExecuteMCPv2/REST/UnitTest.cls:443] — low / fix-risk low / in-story / patch (two-way door). The release runs after the inner Try/Catch, and the catch body formats the text through `SanitizeError`; an exception there goes to the outer Catch, which never unlocks (Acceptance Auditor). Unreachable once the HIGH above keeps the guard out of namespaces without the package, but AD-27 says "always released": the release moves before the text is formatted, and the outer Catch releases a lock still held.
- [x] [Review][Patch] **LOW: the docs understate what happens to a running production whose name a test of the run declares** [packages/iris-dev-mcp/README.md:1689] — low / fix-risk low / in-story / patch. Lead question answered: this is the decision #58 / AC 40.3.2 limit, not a defect. Evidence: `StartProduction` stops any production that is not Stopped, the same-named one included, and when it will not stop within `MAXWAIT` force-stops it and calls `CleanProduction(1)`, which also deletes its persistent application data (`irislib/%UnitTest/TestProduction.cls:828-842`); `TestControl` stops it at the end. So a single test over its own running production already stops it; a run whose tests declare two productions only changes which test of the run does it (QA Q4). The spec fixes "the test's own" as the set of the run's `PRODUCTION` values. The docs said "stopped and restarted by the test"; they now say it is stopped by the run, possibly by another of its tests, may be force-stopped and cleaned with its application data, and is left Stopped (Blind Hunter + Acceptance Auditor).
- [x] [Review][Patch] **LOW: the dev README says a connection error ends with the usual `Error executing tests` result** [packages/iris-dev-mcp/README.md:1690] — low / fix-risk low / in-story / patch. `readProductionGuard` rethrows an `IrisConnectionError` and the handler's catch maps only `IrisApiError`, so the call ends with the framework's tool error, as a connection failure on `POST /work` did before (Edge Case Hunter). Docs corrected.
- [x] [Review][Patch] **LOW: the gate comments that count the gates starting Line-by-Line sessions omit the 40.3 QA gate** [packages/iris-mcp-all/src/__tests__/story-40-3-testproduction-live-gate.test.ts:26] — low / fix-risk low / in-story / patch. Also `story-40-1-coverage-live-gate.test.ts:34` and `story-40-2-coverage-reports-live-gate.test.ts:22` ("the Story 40.3 gate"); `prepublish-gate.mjs` was right (a `Shared surfaces:` entry) (Blind Hunter + Verification Gap).
- [x] [Review][Patch] **LOW: the envelope comment of `iris_execute_tests` still says every return goes through `testRunEnvelope`** [packages/iris-dev-mcp/src/tools/execute.ts:535] — low / fix-risk low / in-story / patch. The `PRODUCTION_BUSY` refusal is the spec's `refusalResult` shape, so the comment states the exception (Blind Hunter).
- [x] [Review][Patch] **LOW: three refusal-builder branches are pinned with no `mutation:` line** [packages/iris-dev-mcp/src/tools/test-production-guard.ts:117] — low / fix-risk low / in-story / patch (Rule 19 LOW closed in this pass): the `(unnamed)` substitution, the `, ` join and the `no reason was given` fallback (Verification Gap).
- [x] [Review][Patch] **LOW: the definition walk is pinned for one hop only; a short-name `Extends` and a definition-to-definition hop are not exercised** [packages/iris-mcp-all/src/__tests__/story-40-3-testproduction-live-gate.test.ts] — low / fix-risk low / in-story / patch (two-way door: one fixture pair and one row). Spec text: superclasses "normalized with `$$$NormalizeClassnameByDef`" (Acceptance Auditor).
- [x] [Review][Defer] **LOW: the changeset bumps `@iris-mcp/shared` by a patch for a new public `REFUSAL_CODES` key** [.changeset/story-40-3-testproduction-runs.md] — deferred: the same root cause as DW-394 (feat-shaped changes marked patch; routed to 42-1-pre-publish-package-fixes, which settles the bump policy), occurrence appended (Blind Hunter).
- [x] [Review][Defer] **MED: the Story 40.1 and 40.2 gates (four files) each still copy the instance-wide monitor helpers that `testproduction-gate-helpers.ts` now shares** [packages/iris-mcp-all/src/__tests__/story-40-1-coverage-live-gate.test.ts] — deferred: medium / fix-risk low / in-epic (files of finished stories, outside this story's diff apart from one comment line each) / `routed owner=burndown` as DW-603 (no later story of this epic owns those files). Found by the reviewer, not a layer (Rule 2).

**Rejected.**

- `low` (spec-bound, by-design): "Try again in a moment" is wrong advice when the state is unreadable for a permanent reason (no `Ens.Director` in the namespace, a privilege error), and it differs from the unswitchable-namespace `proceed` — the refusal text is the spec's (Design Notes); a TestProduction class cannot compile in a namespace without Ens, so such a run fails either way (Blind Hunter + Acceptance Auditor).
- `low`: `StatusText` is a third, narrower copy of the error-prefix strippers (`Utils.SanitizeError`, `Diagram.Loader.CleanStatusText`, `Coverage.Job.SafeText`), and the coverage guard-failure text keeps an inner `ERROR #n:` — the visible effect is a stacked word-code prefix in `error`, unlikely in use, and the coverage guard-failure branch is unreachable (implement-stage finding 5); a shared helper would couple the guard to the Diagram package (Blind Hunter + Acceptance Auditor).
- `false`: the 2 s read budget is unmeasured at package level — measured in this review: `GET /dev/test/production` at `level:"package"` in HSCUSTOM (a HealthShare namespace) for `HS`, `Ens`, `%UnitTest` and `ExecuteMCPv2.Tests`, three runs each, 8.5 to 13.3 ms (none holds a TestProduction subclass, so no call reached Ens) (Blind Hunter).
- `low`: on the definition path the production is taken along the branch that reaches TestProduction, not in member-inheritance order (a non-TestProduction mixin that sets `PRODUCTION`, or `Inheritance = right`) — needs an uncompiled multiple-inheritance test class whose mixin and base declare different productions, one of them running; the compiled path uses `$parameter` (Edge Case Hunter).
- `low` (fix edits the spec under review): the Auto Run Result still says coverage-path compiled-only resolution is "not pinned by a row" — QA Q5d now pins it with a recorded mutation; noted here instead (Verification Gap).

**Lead re-review of code review's HIGH patches (2026-10-18; scoped, read-only, on the frozen diff `cr-40-3/high-patches.diff` on `6c4617c`): NOT-CLEAN, 1 medium and 1 low.** Every `^Ens.Runtime` path was traced as released, and namespace restore holds (AD-13). Rework iteration 1 of 3 works exactly these two items, each with a demonstrated `mutation:` line (Rule 19).

- [x] [Review][Patch] **MED: `iris_test_coverage` runs a target whose class part is empty, unguarded** [src/ExecuteMCPv2/REST/Coverage.cls:162 `ValidateStart`; with UnitTest.cls:537-538 `TestProductions`; packages/iris-dev-mcp/src/tools/test-coverage.ts:1007 schema]. `":"` or `":TestControl"` passes validation. `BuildTestSpec` turns it into `"::"`, and with `/noload` and an empty test case `%UnitTest.Manager:RunOneTestSuite` runs every compiled, non-abstract TestCase class at the top of `^UnitTestRoot` (`irislib/%UnitTest/Manager.cls:841,876,920-921,961`). The guard takes `$Piece(target,":",1)`, which is empty, and answers `proceed`. With a developer-set root holding a TestProduction class there, a run stops another user's production, and force-stops and cleans it (deleting its application data) if it will not stop. **Fix:** reject an empty or blank class part in `ValidateStart`: `Parameter 'target' must start with a package or class name`. Also reject it in the TypeScript schema, as `iris_execute_tests` already does for its own target. Pin it in both places: the OS test, and a unit or gate row that starts nothing.
- [x] [Review][Patch] **LOW: the visibility check tests that the classes exist, not that the guard method exists** [src/ExecuteMCPv2/REST/UnitTest.cls:386]. In an unmapped namespace that holds its own older copy of the package (from 40.1 or 40.2), every `$$$comClassDefined` is true. The later `ProductionGuard` call would then fail, and a plain `iris_execute_tests` run would end in `Error executing tests`. **Fix:** also require `$$$comMemberDefined("ExecuteMCPv2.REST.UnitTest",$$$cCLASSmethod,"ProductionGuard")` (and any other method the guard calls that a 40.1 or 40.2 copy lacks), and pin it on the shipped embed as the visibility check already is.

Rework iteration 1 requirements for these two items (lead, 2026-10-18):

- The MED's pins start nothing. A request whose class part is empty or blank (`":"`, `":TestControl"`, a blank class segment) is refused before any session, run record or production action; the unit or gate row asserts the monitor idle and no run id allocated (`("seq")` unchanged). Never run a `"::"` spec on the shared instance: it would run every TestCase at the top of `^UnitTestRoot`.
- The IRIS classes change, so the bootstrap moves. Run `pnpm gen:bootstrap` once when the IRIS classes are final (a second run is a no-op), then record the final `BOOTSTRAP_VERSION` in this story's CHANGELOG bootstrap move, `tool_support.md`, the changeset and every pin that carries it (use the file-writing tools, no `sed`). DW-591: afterwards delete `packages/shared/dist` and `tsconfig.tsbuildinfo` and rebuild shared before any armed gate. If a schema or description change moves the tools-list snapshot, regenerate it with `--force` after every package build, and the README payload rows.
- End the pass with these armed (`ENV` under `## Verification`), none skipped: the Story 40.3 gate, the Story 40.3 QA gate and the four coverage gates (40.1, 40.1 QA, 40.2, 40.2 QA); plus every OS test class changed, one class per `iris_execute_tests` call, `total` compared with the `Test*` count (Rule #35).
- Each pinning test added or changed gets a demonstrated `mutation:` line under `## Verification` (Rule 19), under a new "Mutation results (rework 1)" heading.
- Shared instance: productions only in the gates' disposable `EXECMCPTMP40*` namespaces, all removed with `leftovers` `[]`; the Line-by-Line monitor is instance-wide, so idle before any coverage call, never stop a session the suite did not start, and `^IRIS.TempExecuteMCPv2Coverage("session")` unset afterwards. If a mutation loads a modified class into HSCUSTOM, restore it from `src/` immediately and confirm.

**Code review, rework 1 re-review (2026-10-18; `bmad-code-review` on the frozen diff `890f9db..HEAD`, review tier `full-opus`, four layers: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor; all delivered).** 15 raw rows (plus two the reviewer found with the repository in view: the `^` path, folded into the high, and `POST /tests`), grouped into 5 entries (1 high, 1 medium closed `wontfix-theoretical`, 3 low); 11 rows rejected. Every patch was applied in this pass; the evidence is under `## Verification`, "Mutation results (code review, rework 1 re-review)" and its run record.

Checklist from the previous round:

- **MED, empty class part in an `iris_test_coverage` target: fixed.** `ValidateStart` trims the target, then refuses an empty first `:` piece before any namespace switch (`Coverage.cls:168-170`), and the schema's `.refine(hasTargetName, ...)` refuses the same targets; pinned by the OS test `TestValidateStartRejectsAnEmptyClassPart`, the unit schema test and gate row Q5g (its error-text assertion goes red when the refusal moves after the class resolution; Run's fixed order puts resolution before the guard and the launch). On the coverage path no other `target`/`level` shape resolves to more classes than the guard inspects (decided from `irislib/%UnitTest/Manager.cls`): the target pattern `1.(1AN,1".",1"%",1"_",1":")` excludes `;`, `,`, `^`, `-`, `*` and path separators; every spec starts with `:`, so the suite is the root and the runner's classes are the target's class part (class and method level, a trailing `:` included) or the `%STARTSWITH <package>.` rows the guard also lists (package level; a package that is a prefix of another is excluded on both sides; the fallback is asked at class level); a leading or trailing dot, a `%`-prefixed name and `_ALL` run nothing more than the guard checks.
- **LOW, the visibility check requires `ProductionGuard`: fixed.** `$$$comMemberDefined("ExecuteMCPv2.REST.UnitTest",$$$cCLASSmethod,"ProductionGuard")` is on the check (`UnitTest.cls:389`), pinned on the shipped embed; `Coverage.Job.IsClassName` (Story 40.1), `Interop.StateName` (Story 38.0) and `Utils.SanitizeError` are in every copy that holds `Coverage.Job` (`git log -S`).

- [x] [Review][Patch] **HIGH: an `iris_execute_tests` method-level target whose method segment holds `;`, `,` or `^` runs classes the guard never inspected, or code that is not a test** [packages/iris-dev-mcp/src/tools/execute.ts:950] — high / fix-risk low (a TypeScript refusal before the guard read, the existing malformed-target result; no IRIS class, schema or description moves) / in-story / patch. The handler checked only the colon count and an empty class segment, and sent the method part to the work queue unchanged; the work queue writes `:<class>:Test<method>` into the `%UnitTest.Manager:RunTest` spec (`irislib/%Api/Atelier/v8.cls:698-736`), which splits the class part on `;` into more classes (`Manager.cls:845-873`), the spec on `,` into more specs (`:545`), and a spec on `^` into setup code it runs with `d @before` (`BeforeRunTest`, `:2787-2795`). The guard asks only about the class before `:` (`UnitTest.cls:540`), so `Story403.PlainTest:TestPlain;Story403.PassTest` was `proceed` and ran the TestProduction `PassTest` over a running `Story403.Other` (observed live under the mutation, QA Q2b), violating the Boundaries' "a run is guarded when any test class it will run is a TestProduction subclass" and AD-27's busy check (Rule 6). The same unvalidated segment let the default-enabled, read-classified tool run arbitrary classmethods through `^` (pre-existing since the method level existed; closed by the same fix). Fix: such a target is `Malformed method-level target '<target>': the method segment after ':' must be one method name, without ';', ',' or '^'.`, before the guard read and before anything is queued; a method segment with one method name is unchanged. Pinned by the unit test in `test-production-guard.test.ts` and QA gate row Q2b (Acceptance Auditor; the `^` path found by the reviewer). AD-15 reading for the lead: a value-level refusal of a malformed input, like Story 36.1's malformed-target checks; no name, parameter, default or output shape moves, but a plain-only `A:TestX;B` that used to run both classes is now refused.
- [x] [Review][Patch] **LOW: one paragraph of the dev README's `iris_execute_tests` limits was not re-wrapped** [packages/iris-dev-mcp/README.md:1688] — low / fix-risk low / in-story / patch (mechanical; the doc pins squash whitespace) (Blind Hunter).
- [x] [Review][Patch] **LOW: a "Not mutated" line under "Mutation results (rework 1)" contradicts the review-pass mutation of the `inEveryCopyOfItsClass` staleness assertion** [this spec, `## Verification`] — low / fix-risk low / in-story / patch (Rule 19 tracking line, corrected) (Verification Gap + Acceptance Auditor + Blind Hunter).
- [x] [Review][Defer] **LOW: spine AD-15's Story 40.3 bullet (decision #60) does not name the rework's older-copy case** [ARCHITECTURE-SPINE.md AD-15] — deferred: `wontfix-accepted` as DW-604 (the spine is lead-owned, Rule 20; the CHANGELOG, where AD-15's list is pruned at the Epic 42 retro, names it) (Blind Hunter).
- [x] [Review][Defer] **MED (theoretical): `POST /tests` (`RunTests`) passes its raw target into the same spec** [src/ExecuteMCPv2/REST/UnitTest.cls:37] — deferred: `wontfix-theoretical` as DW-605 (no tool calls the route, and a REST caller with web-application access already holds `POST /command`; real if a tool starts calling `RunTests`) (reviewer).

**Lead re-review of the round-2 HIGH patch (2026-10-18; scoped, read-only, frozen diff `cr-40-3/high2.diff` on `fb34472`): NOT-CLEAN, 1 high.** The method-segment character set (`;` `,` `^`) was confirmed complete from `irislib/%UnitTest/Manager.cls`; the class part is safe at package and class level. Rework iteration 2 of 3 works exactly this item, with a demonstrated `mutation:` line (Rule 19).

- [ ] [Review][Patch] **HIGH: at `level:"method"` the guard is asked about the raw target, but the queue gets a class name trimmed by JavaScript** [packages/iris-dev-mcp/src/tools/execute.ts:943/:955/:967]. JS `.trim()` strips CR, LF, VT, FF, U+FEFF, U+2028/2029, U+3000 and the other Unicode spaces. The IRIS guard strips only `$ZStrip(…,"<>W")`, which is tab, space and NBSP (`UnitTest.cls:367`, `:540`). With `{target:"Story403.PassTest\n:TestControl", level:"method"}`, the guard sees a name that `IsClassName` rejects, so it answers `proceed`. Then `{class:"Story403.PassTest", methods:["Control"]}` is queued, and `TestControl` stops (and may force-stop and clean) the other production. **Fix:** at method level, ask the guard about exactly what is queued: `<className>[:<methodName>]`, built from the same trimmed values that go into `tests`. Do not add a second normalization. Pin it with a unit row: `"Story403.PassTest\n:TestControl"` (and a leading `\r` and a trailing `\n` with no colon) produces the guard query for the queued class. Revert the fix and show the row go red. Run nothing of this on the shared instance: the unit row uses the mocked HTTP client.

**Rejected.**

- `maybe-false` (low if true): the member check rests on `..ProductionGuard(` being resolved again in the target namespace; if it is not, an older-copy namespace that could run the guard goes unguarded. Settled only by a namespace without the `%ALL` mapping that holds its own pre-40.3 copy; the lead's rework item asked for the check, and the outcome either way is decision #60's "behaves as before" (Blind Hunter; the previous pass's findings 3, 12 and 14).
- `low`: AD-33 is not reconciled with `Start` refusing `:` and `:TestSomething`. The request shape is unchanged (a value-level refusal of a hazardous value), the changeset and CHANGELOG state it, and the fix would edit the spec under review (Blind Hunter).
- `low`: `iris_test_coverage` in an older-copy namespace fails with a raw `<METHOD DOES NOT EXIST>` text. The docs' claim (an error, nothing started) holds; it is reachable only in an unmapped namespace with its own pre-40.3 copy, and the fix adds a branch (Blind Hunter).
- `low`: "every compiled test class under `^UnitTestRoot`" overstates `/norecursive` (top directory only). It errs on the side of caution for an input that is refused, `ValidateStart`'s own doc says "at the top", and correcting the bootstrapped `Coverage.cls` comment moves `BOOTSTRAP_VERSION` and re-arms six gates (Blind Hunter).
- `false`: the "Earlier passes" summary's `9ce1a489469d` is stale. That paragraph records the implement pass, which did move the embed to `9ce1a489469d` (Blind Hunter).
- `low` (fix edits the spec frontmatter, which this stage may not touch): `review_loop_iteration: 0` against the cycle log's 1 (Blind Hunter).
- `low`: a class part that is not a name (`.`, `%`, `_`) passes both checks and starts a session that tests nothing. That is the Story 40.1 behavior of any target naming a class that does not exist, and nothing broader than the guard checks runs (Edge Case Hunter).
- `low`: Q5g's instance-wide `("seq")` assertion would fail if another process started a coverage run meanwhile. That is the oracle row 10 and the rework requirement name; only this suite allocates coverage run ids, and the monitor-idle checks already make a concurrent coverage run a gate-level red (Edge Case Hunter).
- `low`: the `calledMethods` pin reads the source after `ClassMethod ProductionGuard(`, so a future helper placed above it would escape. Every guard helper is below it today, as in the round-1 `calledByGuard` slice; a call-graph walk is complexity for a hypothetical layout (Edge Case Hunter).
- `low` (by design, the previous pass's finding 10): Q5g's side-effect assertions cannot fail on their own, because a `"::"` spec may not run on the shared instance; its error-text assertion is the falsifiable pin (Verification Gap).
- `low` (spec-bound, the previous pass's findings 3, 12 and 14): the member check is pinned on the shipped embed only, as the lead's item says (Verification Gap).

## Spec Change Log

- **2026-10-18, lead spec gate.** Decisions #56 to #59 were taken as recommended. #56 adds that the `iris_execute_tests` and `iris_test_coverage` descriptions state the guard needs the ExecuteMCPv2 service, and that a run without it is unguarded. #59 is the shared-instance sign-off for the one IRISSYS node per disposable namespace. Spine amended (Rule 20): AD-27 (the TestProduction decision under `^Ens.Runtime`, with its residual window; the suite never stops a production), AD-15's sanctioned list (Story 40.3), and the "Live testing on a shared instance" convention (the InstalledNamespace node).
- **2026-10-18, lead, after the code review and the lead's scoped re-review.**
  - Decision #60 accepts code review's extension of #56: a namespace that cannot see the `ExecuteMCPv2` classes answers `proceed` unguarded, like the 404 rule. Spine AD-15's Story 40.3 bullet now names it.
  - The lead re-review was NOT-CLEAN (1 medium, 1 low), so rework iteration 1 works the two `[Review]` items above.
  - The QA section's namespace names (`EXECMCPTMP40W`/`40X`) record what QA ran. Code review later renamed them `EXECMCPTMP403W`/`403X`.
- **2026-10-18, lead, after the rework re-review and a second scoped re-review.**
  - Decision #61 sanctions refusing a malformed method segment (`;`, `,` or `^`) as an AD-15 change on the frozen `iris_execute_tests` key. Spine AD-15's Story 40.3 bullet names it.
  - The scoped re-review of that patch found one more HIGH (the trim mismatch), worked in rework iteration 2.

## Review Triage Log

### 2026-10-18 — Review pass
- verdicts: 39 findings — high 0, medium 6, low 26, false 7, maybe-false 0
- findings (Blind Hunter 1-10, Edge Case Hunter 11-17, Verification Gap 18-26, Intent Alignment 27-39):
  - `[low]` `[patch]` 1. A production already running under a name a test declares (a developer's own, or a concurrent run of the same test) is "own" and is stopped and restarted — verified: `GuardOutcome` proceeds on the name alone, as AC 40.3.2 and decision #58 say (Ens keeps no record of who started a production), so the code is spec-bound; the limits lists did not say it. Patched: the CHANGELOG known limits, the dev README limits and the `tool_support.md` note now state it, each pinned in `story-40-3-doc-claims.test.ts` (mutation line written).
  - `[low]` `[reject]` 2. A 404 from the guard route runs unguarded with no signal — spec-bound: row 16 requires the 404 run to be byte-identical to today, so an added field or warning would break it; the docs, the CHANGELOG and both tool descriptions state it.
  - `[low]` `[patch]` 3. Fail-open branches undocumented, and a non-404 guard failure blocks plain runs — verified: an unswitchable namespace answering `proceed` is spec text; the 32-class cap and a compiled class that cannot load under compiled-only resolution are not reachable by a real class (a 32-deep ancestry; the runner cannot run a class that cannot load); the non-404 failure fails every run, as the spec says, but the README and `tool_support.md` said only "unaffected". Patched: the README, CHANGELOG and `tool_support.md` limits state the non-404 failure.
  - `[medium]` `[patch]` 4. The definition-walk half of `ResolveTest` (an intermediate base, an inherited `PRODUCTION`, a stale compiled class) is never exercised positively — verified: every fixture extends the root, so the walk ends in one step. Patched: gate rows 14b (stale compiled class) and 14c (uncompiled child of a compiled abstract base) and the `Story403.StaleTest`/`BaseTest`/`InheritTest` sources; mutation lines written.
  - `[medium]` `[patch]` 5. The IRIS-side error branches have no test — verified for `Catch exEns` and `StatusText` (only the lock-timeout string was exercised); the outer `Catch` of `ProductionGuard` and the coverage guard-failure branch need `TestProductions` to throw, which the SQL and dictionary calls cannot be made to do. Patched: gate row 15b (a TestProduction test in the bare namespace B, where `Ens.Director` does not exist, is `PRODUCTION_BUSY` with `state: "Unknown"`, the exception text, and a free lock); the two unreachable branches stay untested by decision.
  - `[false]` `[reject]` 6. `state: "Unknown"` is ambiguous and `stateCode` is not in the refusal — the refusal fields are the spec's (`namespace, state, testProductions, production?, error?`); a read state 0 or 6 has `production`, an unreadable one has `error`, and the docs say which field tells them apart; the label is `StateName`, which the spec says to reuse.
  - `[low]` `[reject]` 7. The recovery text names `iris_production_control`, on the Interoperability server — the text is the spec's (Design Notes), and the same tool name is used by the other refusals and docs of this suite; not worth a wording change against the spec.
  - `[low]` `[reject]` 8. Defensive normalization in `readProductionGuard`, `productionBusyRefusal` and `guardFromStart` is reached by no real answer — kept: it makes a malformed 200 fail closed in a safety gate; no named harm.
  - `[low]` `[patch]` 9. The coverage-description pin was loosened to `executemcp\/` — verified: it let any class name through. Patched: `/executemcp(?!v2 service)/i` plus an exactly-one-mention assertion; mutation line written.
  - `[low]` `[reject]` 10. The CHANGELOG says the snapshot "differs only in those two descriptions" while `capturedAt` also moved — its entries differ only there; `capturedAt` is generator metadata. Cosmetic.
  - `[low]` `[patch]` 11. Same as 1 (concurrent runs of one TestProduction test) — carried: docs patched as in 1.
  - `[low]` `[reject]` 12. The 32-class cap reads as "not a test" — no real class has 32 distinct ancestors; the cap only stops a cyclic or runaway chain.
  - `[false]` `[reject]` 13. A read state 6 or a negative code is labelled "Unknown" with no `error` — the same as 6: `StateName` is the spec's label, the fields tell the cases apart.
  - `[low]` `[reject]` 14. The guard's wait (up to the 5 s lock and the 2 s status read) is outside the tool's wait budget — verified: the budget starts after the queue call, so the discovery, `ensureUnitTestRoot` and the counter read are already outside it today; the guard adds a bounded few seconds only when the lock is held, and the client ceiling is the caller's.
  - `[low]` `[reject]` 15. `removeTestProductionNamespace` cannot clear a node whose namespace is gone — the fixture refuses an absent namespace by spec; the teardown clears the node before it removes the namespace, so the state cannot arise in the gate's order.
  - `[low]` `[patch]` 16. "A run with no TestProduction test is unaffected" versus a non-404 guard failure — same as 3: docs patched.
  - `[low]` `[patch]` 17. Same as 9 — carried.
  - `[medium]` `[patch]` 18. `ResolveTest`'s definition path has no test beyond a direct never-compiled subclass — same as 4: gate rows 14b and 14c.
  - `[medium]` `[patch]` 19. The Ens exception and error-status branch and `StatusText` never run — same as 5: gate row 15b.
  - `[low]` `[patch]` 20. The "namespace cannot be switched to" branch of `ProductionCheck` has no test — verified. Patched: a raw route call for the absent scratch name `EXECMCPTMP403Z` in gate row 12; mutation line written.
  - `[low]` `[patch]` 21. "A method-level run is guarded whatever the method" is pinned only with `TestControl` — verified. Patched: a raw route call for `Story403.PassTest:TestNoSuchMethod` in gate row 12; mutation line written.
  - `[low]` `[reject]` 22. The compiled-only resolution on the coverage path is not pinned — the spec's planned mutation pins the execute path (row 14); a coverage row needs a whole run to leave the monitor idle, for an edge where a stale class is run by `/noload` anyway. Reopen if a coverage run is seen to be refused for a class that is not compiled.
  - `[low]` `[patch]` 23. The fixture methods' IRIS-side refusals are asserted only as source text — Patched: gate row 13b calls `SetInstalledNamespace`, `ClearInstalledNamespace` and `HoldEnsRuntime` with a non-scratch name and an absent scratch name (neither is a namespace, so a missing guard could not reach a node or a lock) and asserts the answers and that nothing was written; mutation line written.
  - `[low]` `[patch]` 24. Pinning tests with no `mutation:` line (AC-8 other-error, explicit proceed, malformed-target precedence, `GuardOutcome` foreign and empty name, refusal text, helper-name refusal) — verified. Patched: each mutation applied, observed red and reverted; the lines are in `## Verification`.
  - `[false]` `[reject]` 25. The OS `TestTestProductions*` tests assert only `""` — by design: the spec forbids a TestProduction class in HSCUSTOM, and the positive discovery is pinned by gate rows 5, 12, 14, 14b and 14c.
  - `[low]` `[patch]` 26. The loosened coverage-description pin — same as 9, carried.
  - `[medium]` `[patch]` 27. Intent-specified resolution (intermediate superclasses, nearest `PRODUCTION`, stale compiled class) untested — same as 4.
  - `[low]` `[reject]` 28. Coverage-path compiled-only resolution untested — same as 22.
  - `[low]` `[patch]` 29. The unswitchable-namespace branch untested — same as 20.
  - `[medium]` `[patch]` 30. Guard failures other than the lock timeout untested — same as 5.
  - `[false]` `[reject]` 31. The raw `production-busy` payload of `Start` is asserted nowhere — gate row 10 builds the refusal from that payload (state, production, testProductions, stateCode all come from it) and row 17 pins the mapping; a wrong raw field would turn row 10 red.
  - `[false]` `[reject]` 32. The gate's residue oracle ignores Atelier work-queue workers — the worker is the test runner, which lingers about a second; it is not a production process (implementation notes); the spec's "no process entry" is about production processes.
  - `[false]` `[reject]` 33. "Atomic" covers only the decision, not the test's own start — decision #57 and the CHANGELOG residuals say exactly this.
  - `[low]` `[patch]` 34. A same-named production is "run over" — same as 1: docs patched.
  - `[low]` `[reject]` 35. Row 16's "byte-identical to today" is compared inside the new build — the call sequence is the pre-change one, written out in the test, and the 86 existing `iris_execute_tests` tests keep their bodies and assertions (only the mock plumbing moved), which is the AD-15 pin.
  - `[low]` `[patch]` 36. The pre-existing coverage-description pin was relaxed — same as 9.
  - `[low]` `[reject]` 37. The 404 fail-open is pinned by mocks only — the unit row is the spec's row 16; the implementer's live probe of the real 404 shape is in the implementation notes.
  - `[false]` `[reject]` 38. "One guard sentence" holds two sentences — decision #56 requires the service-dependence statement; the pin names it.
  - `[low]` `[reject]` 39. `readProductionGuard` treats a non-explicit answer as busy, which the intent does not mention — same as 8.

### 2026-10-18 — Review pass (rework 1)
- verdicts: 19 findings — high 0, medium 0, low 19, false 0, maybe-false 0
- findings:
  - `[low]` `[patch]` 1. (Blind Hunter) `iris_test_coverage` has no member check, so in a namespace with its own earlier copy it is an error where `iris_execute_tests` goes ahead unguarded — real and by design (a guard error refuses, AC-6; `Run` catches the failed call and starts nothing; coverage in an unmapped namespace already failed at `ResolveRoutines`), but the docs implied coverage shares the unguarded limit; patched: the README coverage entry, the CHANGELOG limits bullet and the `tool_support.md` note now say it is refused with nothing started, each with a doc-claims pin and a recorded mutation.
  - `[low]` `[patch]` 2. (Blind Hunter) The `inEveryCopyOfItsClass` comment says "every build that has that class already has the method", false for `Interop.StateName` (Story 38.0 into a Story 5.2 class) — checked with `git log -S`; the true scope is "a copy that holds `Coverage.Job` is a Story 40.1 or later build"; patched: the comment states that.
  - `[low]` `[reject]` 3. (Blind Hunter) The older-copy branch has no behavioral test — spec-bound: the lead's fix item says to pin it on the shipped embed "as the visibility check already is", and the spec's "Not mutated" line records the live branch; the compiled `..ProductionGuard(` call resolves in the target namespace like the `##class` calls the first visibility check was written for.
  - `[low]` `[patch]` 4. (Blind Hunter) README grammar: "So does a namespace that holds ..." (a run goes unguarded, not a namespace) — patched, with the pin and a mutation.
  - `[low]` `[patch]` 5. (Blind Hunter) `hasTargetName` is exported with no importer, lacks `@returns`, and its message says "the part before any ':' is empty" for a no-colon blank target — patched: not exported, `@returns` added, message "it is empty or blank before any ':'"; the name stays (the JSDoc states the empty-target case).
  - `[low]` `[reject]` 6. (Blind Hunter) The rule is pinned asymmetrically (no `"A.B:"` control in the OS test) and the OS test sits in `ProductionGuardTest` — `CoverageJobTest` is at the ~500-line cap, so the placement is forced; a trailing-colon tightening is not part of this change.
  - `[low]` `[reject]` 7. (Blind Hunter) The docs say the runner reads an empty class part as "every compiled test class under `^UnitTestRoot`" without the precondition and without a capture — the sentence is true of `Manager.cls:920-961` (an empty test case lists the classes of the source directory the root names and runs the compiled TestCase classes); running `"::"` on the shared instance is barred, so source reading is the only oracle available.
  - `[low]` `[patch]` 8. (Edge Case Hunter) Same as 1: `Coverage.Run` has no visibility gate, so coverage errors where execute proceeds — docs patched.
  - `[low]` `[patch]` 9. (Edge Case Hunter) Same as 2: the `StateName` exemption claim — comment patched.
  - `[low]` `[reject]` 10. (Verification Gap) Q5g's "nothing started" assertions cannot fail on the defect they guard, because every request lists a class that does not exist — by design: the lead barred a `"::"` run on the shared instance; the error-text assertions are what go red (mutation recorded) and the OS test pins that the rule sits in `ValidateStart`, which `Run` calls first; the gate header says so.
  - `[low]` `[patch]` 11. (Verification Gap) The residue assertion ("a conjunction of those two macros only") and the staleness assertion of the new test have no `mutation:` line — patched: three mutations applied, red, reverted (`## Verification`, "Mutation results (rework 1, review pass)").
  - `[low]` `[reject]` 12. (Verification Gap) The member check is pinned only as source text, with the false branch never run, and the premise (the call re-resolves in the target namespace) is unverified — spec-bound as in 3; the premise is the one the lead's finding states, and the same mechanism the first visibility check and the HIGH it closed rely on.
  - `[low]` `[reject]` 13. (Verification Gap) No recorded mutation that makes a positive control (`"A.B:"`, an interior colon) fail — one demonstrated mutation per AC, and the controls keep the negative loops non-vacuous; not a missing pin.
  - `[low]` `[reject]` 14. (Intent Alignment) The older-copy branch has no behavioral test — same as 3.
  - `[low]` `[patch]` 15. (Intent Alignment) The hand-written list is literally false for `Interop.StateName` — same as 2.
  - `[low]` `[patch]` 16. (Intent Alignment) Coverage fails closed where execute proceeds — same as 1.
  - `[low]` `[reject]` 17. (Intent Alignment) The runner expansion of `"::"` is shown by no test or run — same as 7.
  - `[low]` `[reject]` 18. (Intent Alignment) The new refusal is a validation error, not `PRODUCTION_BUSY` — by design: a malformed target is input validation, and the lead's fix item fixes the text `Parameter 'target' must start with a package or class name`.
  - `[low]` `[reject]` 19. (Intent Alignment) A namespace where the guard cannot run answers `proceed` with no tests, indistinguishable on the wire from a genuine no-TestProduction answer — decisions #56 and #60 (the unswitchable-namespace rule, extended), not this change.

## Design Notes

**Orchestrator decisions needed** (the Lead's calls, delegated; this plan follows each recommendation):

1. **DECIDED (orchestrator decision #56, 2026-10-18, as recommended; the tool descriptions must also state that the guard needs the ExecuteMCPv2 service and that a run without it is unguarded). Where does the guard live? — recommended: one IRIS-side guard shared by both test-running tools.** `iris_execute_tests` asks a new read route before it queues: a refusal on the frozen key is a sanctioned AD-15 change, with no action, key, classification or annotation change. `iris_test_coverage`'s `Start` makes the same decision before any run id. The new code is `PRODUCTION_BUSY`. `POST /tests` stays unguarded and is documented. A 404 from the route goes ahead as today, and any other guard error fails the call as today's pre-queue errors do. The evidence:
   - **The hazard is real.** `iris_execute_tests` runs TestProduction tests today. With the stand-in `Story403.Other` running, a `PassTest` run reported passed while its log read "Trying to stop production 'Story403.Other'", and Other stayed stopped.
   - **Coverage would do the same.** Coverage's runner runs `RunTest` in its own process, so a coverage run would stop another production the same way.
   - **AD-4.** It forbids an `action` on the frozen key, and a new tool would leave the existing path unguarded.
   - **AD-12/AD-27.** They put the busy check IRIS-side.
   - **The 404 rule** keeps `tool_support.md`'s claim that unit tests work without the ExecuteMCPv2 service, and leaves every non-TestProduction run as it is.

   The alternatives:
   - (a) a new job-owned TestProduction tool, with `iris_execute_tests` refusing every TestProduction target: a larger AD-15 change, count churn and AD-7 rows;
   - (b) guard `iris_execute_tests` only: coverage keeps the hazard;
   - (c) a TypeScript check through `iris_production_status`: not IRIS-side and not under the lock, which violates AD-12/AD-27;
   - (d) fail closed on a 404: every `iris_execute_tests` call breaks on an instance whose IRIS-side classes are older.
2. **DECIDED (orchestrator decision #57, 2026-10-18, as recommended). What does "the busy check is atomic" (AD-27) mean here? — recommended: an atomic IRIS-side decision under Ens's own lifecycle lock, with the window to the test's own start recorded as a residual.**
   - **Why the lock.** `^Ens.Runtime` is taken by every `Ens.Director` start, stop, update, restart and recover (`Director.cls:34/175/237/326/701/1685`), so no production lifecycle change can interleave with the read-and-decide. Holding it in the deciding process does not block that process's own `GetProductionStatus` (probe).
   - **Why not more.** The suite never starts the production itself. `%UnitTest.TestProduction.TestControl` does, later, in another process (the Atelier worker or the coverage runner), after user hooks. Holding the lock until then is impossible on the Atelier path, because the worker is not the suite's. On the coverage path it would block every status read in the namespace for the length of the user's code: probe, while another process held the lock, `GetProductionStatus` waited out its timeout and returned `ErrCanNotAcquireRuntimeLock` with state 0.
   - **The alternative** (coverage path only): hold the lock from an in-runner re-check until TestProduction's "Invoking Ens.Director::StartProduction" assertion, through a `LogAssert` override. Rejected: it is a text-matched hook into a system class, and it blocks status reads during `OnBeforeProductionStart`.
   - **Spine.** The lead records this clause in AD-27 (Rule 20).
3. **DECIDED (orchestrator decision #58, 2026-10-18, as recommended). Does the suite release a production that a TestProduction run left behind (AD-27's "always released")? — recommended: no; the suite stops no production.**
   - **What is left behind.** An exception in a TestProduction hook leaves its production running, and so does a killed test process (both probed: Running, five `_Ensemble` jobs, the `RunningNamespace` node set).
   - **The test's own leftover.** The guard proceeds over the test's own production, because %UnitTest.TestProduction stops and restarts it itself (probe: `PassTest` passed over `ErrorTest`'s leftover).
   - **Any other production** is refused and named, with the recovery in the text (`iris_production_control` stop).
   - **Why no release.** Ens keeps no record of who started a production, so the guard cannot tell another test's leftover from a production someone started deliberately, and the suite holds no ownership record of it (AD-27: never touched). A cancelled or time-limited run behaves the same way, and the docs say so.
   - **The alternative:** suite ownership records on the coverage path, so that a later run stops a dead run's production. Rejected: new ownership machinery for a default-disabled path, and the Atelier path could not have it.
4. **DECIDED (orchestrator decision #59, 2026-10-18, as recommended; the fixture refuses any other name and the leftovers check covers the node). How does the disposable gate namespace become able to compile and run TestProduction tests? — recommended: the package mappings (decision #21) plus the single node `^%SYS("Ensemble","InstalledNamespace","EXECMCPTMP403A")`.** A fixture method that refuses any other name sets it, and teardown kills it before the namespace is removed; `leftovers` already reports any `^%SYS("Ensemble",*,<ns>)`. Never `EnableNamespace`. The evidence:
   - **Starting a production needs no enablement.** 39.2 did it in a mapping-only namespace, and so did this probe with `Story403.Other`.
   - **A TestProduction subclass will not compile without the node.** The `CheckEnvironment` generator fails with ERROR #5001 ("This class is only for use in Ensemble and HealthShare systems"; `TestProduction.cls:776-783`, `:813-817`), and `GetMacros` needs the node too (`:794-811`).
   - **The node must stay set for the whole gate.** The Atelier queue recompiles every test class before each run (`v8.cls:706-713`): probe, with the node killed after a good compile, the next run failed with the same compile error.
   - **Why not EnableNamespace.** On this HealthShare instance, `EnableNamespace` also enables the namespace for HealthShare, creates the Interoperability portal application, and adds SQL and database privileges to roles (security changes). On other instances it also creates two databases (`EnsembleMgr.cls:1738-1886`). `DisableNamespace` reverses only the `^%SYS` nodes (`:1892-1930`).
   - **Why a decision is needed.** It is one instance-level write (IRISSYS), scoped to a namespace the gate owns. It needs a decision because the environment rules forbid reconfiguring the shared instance.

**AC interpretations** (apply and report):

- **AC 40.3.1, "this story adds only the safety guard and the docs".** They do run (probe). "The guard" covers both suite paths that run tests, because coverage runs TestProduction tests too.
- **AC 40.3.2, "the test's own".** This is the set of `PRODUCTION` values of the run's TestProduction tests.
- **AC 40.3.2, "a production other than the test's own is running".** This means any state other than Stopped, and an unreadable state, because `StartProduction` stops anything not Stopped: a force-stop and `CleanProduction(1)` when it will not stop in `MAXWAIT` (`:828-842`). `TestControl` stops the namespace's production even when its own start failed (`:913-914`, `:928-929`), so a test whose `PRODUCTION` names no class is guarded too (row 7).
- **AC 40.3.3, "the namespace is removed afterwards".** This includes the InstalledNamespace node and every production process.

**Probe evidence** (IRIS 2026.2 build 221U, HealthShare enabled, `default` localhost:52773, 2026-10-18, about 13:50 to 14:01 instance time).

- **Fixtures.** `EXECMCPTMP403A` (with `Ens`/`EnsLib`/`Ens*` mapped to ENSLIB) held the `Story403` classes; their sources were the shapes in the fixture list, with `Story403.Operation` in place of `Story392.Operation`. `ExecuteMCPv2.Temp.Probe403A` in HSCUSTOM was the teardown helper. Every production was stopped by the probe. Afterwards `leftovers` was `[]`, the namespace and database lists showed neither, and `iris_doc_list Probe403` was empty. No HSCUSTOM global was written, and no Line-by-Line session was started.
- **Compiling.** Without the node, compiling `PassTest` failed with ERROR #5001 and #5490 (`CheckEnvironment`). With the node, it compiled.
- **Pass.** `iris_execute_tests` gave total 1, passed 1 (`TestControl`), 6.15 s, `runIndexSource:"queue"`.
  - The test ran in an Atelier WorkMgr worker (`_SYSTEM`). The production's jobs were five separate `_Ensemble` processes (`Ens.Queue.1`).
  - Afterwards: Stopped; no `^Ens.Runtime`, `^Ens.JobStatus` or `RunningNamespace` node, and no production process. Left behind: Event Log rows, one message header, `LastProduction`, and the two `Ens_Config.Item` rows from compiling the productions.
- **Fail.** Failed 1, `AssertTrue: fail fixture`, 6.04 s; Stopped afterwards.
- **Error.** Failed 1, `ERROR #5002: ObjectScript error: <DIVIDE>CheckResults+1^Story403.ErrorTest.1`, 5.02 s. The production was left Running.
- **Own leftover.** `PassTest` then passed in 7.05 s and left the production Stopped.
- **The hazard.** With `Story403.Other` running, `PassTest` passed, and its assertion log read: "Ensemble is not stopped", "Trying to stop production 'Story403.Other'", "Verifying Ensemble is now stopped". Other stayed stopped.
- **Killed.** `SlowTest` (`MINRUN` 90) ran in a JOBbed `RunTest`, and its test process was terminated. The production stayed Running with its five jobs, and the result row stayed unfinished.
- **The lock.** In the same process, holding `^Ens.Runtime`, `GetProductionStatus` returned OK (`Story403.Other`, 1) in 0 ms. While another process held it, `GetProductionStatus` with a 2 s timeout returned after 2,005 ms with `ErrCanNotAcquireRuntimeLock` and state 0, although `IsProductionRunning` (which takes no lock) still read 1.
- **Discovery.** `SubclassOf('%UnitTest.TestProduction')` lists indirect subclasses, and `SubclassOf('%UnitTest.TestCase')` includes TestProduction subclasses, so the tool's package discovery picks them up.

**`GuardOutcome` table** (`proceed` or `busy`):

| TestProduction tests | State read | State | Name in own set | Outcome |
|---|---|---|---|---|
| none | not asked | — | — | proceed |
| some | no (lock, error, exception) | Unknown | — | busy |
| some | yes | Stopped (2 or -2) | any | proceed |
| some | yes | any other | yes | proceed |
| some | yes | any other | no (including "") | busy |

**The refusal text** (`<p>` is the production, or `(unnamed)`; `<list>` is `Class (production)`, comma-separated):

- **State read:** `Production '<p>' is <State> in namespace <ns>, and it is not the production of the TestProduction tests in this run (<list>). %UnitTest.TestProduction stops any other production before it starts its own, so nothing was run and '<p>' was left untouched. Run the tests once it has stopped; if an interrupted test run left it running, stop it with iris_production_control and run the tests again.`
- **Unreadable:** `The production state of namespace <ns> could not be read (<error>), so the TestProduction tests in this run (<list>) were not run: %UnitTest.TestProduction stops any other production before it starts its own. Try again in a moment.`
- **The description sentence** (on both tools): `TestProduction guard: a run that includes a %UnitTest.TestProduction test is refused with code PRODUCTION_BUSY, and nothing is run, while a production other than those tests' own is running in the namespace (or its state cannot be read), because %UnitTest.TestProduction stops any other production before it starts its own; that production is left untouched.`

**Residual risks** (they go in the CHANGELOG and `tool_support.md`):

- the decision-to-start window (decision 2);
- a run whose guard route is absent (404) is unguarded;
- a production another process starts after the decision but before `TestControl` would still be stopped;
- a cancelled, killed or erroring TestProduction run leaves its production running;
- privileges were probed under `_SYSTEM` only.

**Extend, don't copy (Rule 2).**

- `StateName` is reused, not copied.
- `GuardOutcome` is a sibling of `Interop.DeleteBlockedByState`; it uses the same `$ZAbs(state)=2` Stopped rule, but its semantics differ.
- `productionBusyRefusal` is a sibling of `busyRefusal`: a different code and fields, and one builder shared by both tools.
- The package query mirrors `discoverPackageTests`'s predicates.
- The fixture methods follow `HoldMonitorLock`.
- `Story392.Operation` is reused verbatim.
- The gate follows the 40.2 and 39.2 gates.

**Integration (Rules 1/2).**

- **Integration AC:** AC-5 for `iris_test_coverage`, and AC-2 for `iris_execute_tests`. Each consumer reads the IRIS-side decision and produces the refusal over the real wire.
- **Consumes:**
  - Story 40.1's coverage `Start`/`Run` and the monitor discipline;
  - Story 39.1's `interop-namespace-fixture.ts`;
  - Story 39.2's production fixture;
  - `Interop.StateName`;
  - `process-gate-helpers.ts`.
- **Consumed-by:** Story 40.4, the docs rollup (the guard, its default and its residuals). Its `deploy-and-test-class` prompt step may tell agents what `PRODUCTION_BUSY` means; that is a sanctioned prompt-body change, which is 40.4's call.

**Ledger inbox (Rule 17):** none (`slice 40-3-testproduction-runs` is empty).

**Spine follow-up (lead, Rule 20).**

- **AD-27:** record decision 2's meaning of "atomic", decision 3 (the suite stops no production) and the residual window.
- **AD-15:** add a "Story 40.3" bullet to the sanctioned list (the `PRODUCTION_BUSY` refusal on `iris_execute_tests` and `iris_test_coverage`).
- **Conventions, "Live testing on a shared instance":** record decision 4's node for disposable namespaces, if it is taken.

**Governing ADs.**

- **AD-27:** the guard, its atomicity and leftovers.
- **AD-12:** the decision IRIS-side; text and labels in TypeScript.
- **AD-15:** the sanctioned refusal, and the unchanged runs pinned.
- **AD-4 and AD-5:** no action, key or classification change on the frozen key; `:check` only.
- **AD-16:** a refusal returns no handles, because nothing started.
- **AD-22:** the production comes from the test class, never the item extent.
- **AD-13:** the namespace restore.
- **AD-11:** one render, and `SanitizeError`.
- **AD-33:** an additive route and an additive outcome.
- **AD-14:** the bootstrap.
- **AD-7:** no visibility change.
- **AD-31:** IRIS's own privilege errors.
- **AD-2:** the gate in `iris-mcp-all`.
- **Conventions:** Refusals, Tool results, Error text, Live gates, Live testing on a shared instance, Probes and references (earliest version verified: IRIS 2026.2 build 221U, for `%UnitTest.TestProduction` and `Ens.Director:GetProductionStatus`), and Performance budgets.

**Implementation notes (implement stage).**

- **Raw result when the state is unreadable.** Following "`production`, `state` and `stateCode` are present exactly when the state was read", the raw route omits all three then and carries `error`; `productionBusyRefusal` fills `state: "Unknown"` in the refusal fields (matrix row 13). The coverage outcome `production-busy` carries the same raw fields.
- **`level` is required on the route** (`target` and `level` validated before any namespace switch, with the messages of `RunTests`); the tool always sends both.
- **A 404 is real.** Live probe: a route that does not exist answers HTTP 404 with an empty-errors envelope, which the shared client turns into `IrisApiError` 404 (Story 39.7), so `readProductionGuard`'s rule is the wire behavior and not only the mock's.
- **One pre-existing pin moved.** `test-coverage.test.ts` pinned the coverage description against `/\/api\/|\/dev\/|executemcp/i`; decision #56 requires the description to name "the ExecuteMCPv2 service", so the third alternative became `executemcp\/` (a REST path piece). `\/api\/` and `\/dev\/` still forbid every path.
- **Compiled answer with a fallback.** `ResolveTest` answers from the compiled class (`$ClassMethod ... %Extends`, `$Parameter`) and, when that class cannot be loaded and the run compiles first, falls back to its definition; a class compiled but not defined answers from the compiled class.
- **Gate processes.** The Atelier work-queue worker that ran a test stays in the namespace for about a second (`Routine` `%SYS.WorkQueueMgr`, state `EVTW`); it is the test runner, not a production process, so the gate's production-process reads leave workers out and give other transient processes up to 10 s. A production reports Running while its jobs are still starting, so the "untouched" comparison takes its first snapshot once two reads one second apart agree.
- **Observation, no route impact.** The first test run after `REST/UnitTest.cls` is recompiled reported 17 to 44 s for `ProductionGuardTest:TestProductionGuardPlainTarget`, while the guard calls inside it took 0.018 s (measured in the method, between `OnBeforeOneTest` and `OnAfterOneTest`) and a repeat run took 1.3 s. The time is in the unit-test framework's accounting after a recompile, not in the guard; the route time is 6 ms in the gate.
- **Fixture methods.** `SetInstalledNamespace` writes the node with an empty value (Ens sets the portal suffix there; the environment check only tests that the node exists); `ClearInstalledNamespace` refuses a namespace that no longer exists, so a node left behind by a crashed teardown is cleared by re-creating the namespace first (the AC-9 mutation did exactly that).

## Verification

- Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, and one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- MCP calls name `server:"default"` and the namespace `HSCUSTOM`, `EXECMCPTMP403A` or `EXECMCPTMP403B`.

**Shared surfaces:** these change, and other tests assert on them.

- `REFUSAL_CODES` (9 → 10) and its catalog pin.
- The descriptions of `iris_execute_tests` and `iris_test_coverage`, so the tools-list snapshot entries and the README payload rows.
- `iris_execute_tests`' HTTP call sequence, which needs the mock plumbing in every `createExecuteTestsHandler` test.
- The coverage `Start` outcomes.
- The Dispatch routes.
- `BOOTSTRAP_VERSION` and `bootstrap-classes.ts`.
- The `FIXTURE_CLASS_SOURCE` method roster.
- `gateTestFiles`, `GATES` and `live-gate-roster`, and the comments that count the gates that start sessions.
- The CHANGELOG first section, the dev README rows, the `tool_support.md` rows and notes, and the 40.1/40.2 doc-claims pins.
- Tool, preset, prompt and baseline counts are unchanged.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order.

- **Disposable fixtures:**
  - `EXECMCPTMP403A` (with its node) and `EXECMCPTMP403B`;
  - `ExecuteMCPv2.Temp.Story391Fixture` in HSCUSTOM.
- **OS test classes** run one class per `iris_execute_tests` call, and `total` is compared with the `Test*` count (Rule #35).
- **No OS or dev test** starts a production or a Line-by-Line session.

**Commands:**

- `(loop)` `iris_doc_load` into HSCUSTOM with the absolute globs `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/REST/UnitTest.cls`, `…/src/**/REST/Coverage.cls`, `…/src/**/REST/Dispatch.cls` and `…/src/**/Tests/ProductionGuardTest.cls`, then compile -- expected: clean.
- `(loop)` `iris_execute_tests` `ExecuteMCPv2.Tests.ProductionGuardTest`, then in separate calls `UnitTestTest`, `CoverageJobTest` and `CoverageSourceTest` -- expected: the totals equal the `Test*` counts, with 0 failures.
- `(loop)` `pnpm gen:bootstrap` twice, then `git diff --stat packages/shared/src/bootstrap-classes.ts` -- expected: one move, and the second run is idempotent; then rebuild shared.
- `(loop)` `pnpm --filter @iris-mcp/shared build`, then `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/refusals.test.ts src/__tests__/bootstrap.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build`, then `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/test-production-guard.test.ts src/__tests__/execute.test.ts src/__tests__/execute-tests-running-contract-epic-gate.test.ts src/__tests__/test-coverage.test.ts src/__tests__/test-status.test.ts src/__tests__/index.test.ts` -- expected: pass.
- `(loop)` Build admin, interop, ops and data, one call each; then `pnpm gen:tools-list-snapshot --force`, then `pnpm gen:tools-list-snapshot:check` -- expected: OK, with only the two entries differing.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-40-3-doc-claims.test.ts src/__tests__/story-40-2-doc-claims.test.ts src/__tests__/story-40-1-doc-claims.test.ts src/__tests__/tools-list-snapshot.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/story-39-1-gate-guards.test.ts src/__tests__/changelog-bootstrap-move.test.ts src/__tests__/interop-namespace-fixture.test.ts src/__tests__/data-policy-scope.test.ts` -- expected: pass.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-40-3-testproduction-live-gate.test.ts` -- expected: every row passes, none is skipped, no production runs, the monitor is idle, and nothing is left.
- `(loop)` In separate calls, `ENV … story-40-1-coverage-live-gate.test.ts`, `ENV … story-40-2-coverage-reports-live-gate.test.ts` and `ENV … story-39-2-data-policy-live-gate.test.ts` -- expected: pass (regression).
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one call each for `build`, `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/all test`, split into calls that each finish inside the cap -- expected: green.
- `(once)` One call each: `pnpm gen:governance-baseline:check` (`1e62c5ad5bf7`/141), `pnpm measure:tools-payload` (equal to the README rows) and `node scripts/check-epics-sync.mjs` -- expected: OK.
- `(once)` The raw route's time, for a plain target and for a TestProduction target with Other running -- expected: recorded here, both under the 2 s read budget.
- `(once)` After every armed run:
  - `leftovers` for A and B is `[]`, with no `^%SYS("Ensemble",*,…)` and no process;
  - neither namespace nor database is listed;
  - `iris_doc_list` (HSCUSTOM, `Story403` and `Story391Fixture`, generated included) is empty;
  - `MonitorState` is `{active:0}`

  -- expected: all hold.

**Planned mutations (Rule 19).** Apply each one, observe red, revert, and reload or rebuild what it touched. Confirm that `git status --short` and `git diff --stat` are unchanged, and record it as `mutation: <change> -> <test>`. A mutation that lets a run stop `Story403.Other` runs only with the gate's teardown in place.

- **AC-1:** `GuardOutcome` returns `busy` for state 2 → gate rows 1-2 and the OS table.
- **AC-2:** delete the guard call in `execute.ts` → rows 3-5, 7, 9 and 14 (Other is stopped).
- **AC-3:** drop the "no TestProduction test → proceed" short-circuit, so a run is refused whenever a production runs → row 6.
- **AC-4:** drop the own-production clause → row 8.
- **AC-5:** delete the guard call in `REST/Coverage.cls` (a scratch copy loaded into HSCUSTOM) → row 10.
- **AC-6:** proceed when the lock is not acquired → row 13.
- **AC-7:** compiled-only resolution on the `iris_execute_tests` path → row 14; and call Ens with no TestProduction test → rows 12 and 15 (`stateCode` appears).
- **AC-8:** fail closed on 404 → row 16.
- **AC-9:** skip `ClearInstalledNamespace` → the gate's `leftovers` assertion.
- **AC-10:** a comment edit in `UnitTest.cls` without `gen:bootstrap` → the `bootstrap.test.ts` drift check.

**Mutation results (Rule 19, implement stage).** Each IRIS-side mutation was applied to a scratch copy loaded into HSCUSTOM with `iris_doc_load` (the working tree's `.cls` files were never edited for it), run against the named test, then reverted by reloading the file from `src/` (the live classes equal `src/` again). Each TypeScript mutation was applied in `src/`, run, and reverted with `cmp` against a saved copy (byte-identical). The gate was run armed (`ENV` above) with its teardown in place; every mutation that lets a run stop `Story403.Other` ran with it.

- mutation: `GuardOutcome` returns `busy` for state 2 -> OS `ProductionGuardTest:TestGuardOutcomeStopped` red (3 assertions), and the gate: rows 1, 2, 8, 9, 11, 12 and 13 red (row 3 also failed on a start-up race in its "untouched" snapshot, which `settledSnapshot` then closed), reverted
- mutation: `ProductionGuard` reads the state even with no TestProduction test, and `GuardOutcome` drops its no-tests short-circuit -> OS `TestGuardOutcomeNoTests` and `TestProductionGuardPlainTarget` red; gate row 6 red ("Production 'Story403.Other' is Running ... (). nothing was run"), row 12 red (`stateCode` appears for a plain target), row 15 red (bare B: `<CLASS DOES NOT EXIST>ProductionGuard *Ens.Director`); reverted
- mutation: `GuardOutcome` never matches the run's own productions (`If pName '= ""` -> `If 0`) -> OS `TestGuardOutcomeOwnProduction` red, and gate row 8 red (PassTest refused over ErrorTest's own leftover); reverted
- mutation: `GuardOutcome` answers `proceed` when the state was not read -> OS `TestGuardOutcomeStateNotRead` red, and gate row 13 red (the run went ahead and passed twice); reverted
- mutation: `ProductionCheck` resolves compiled-only (`ProductionGuard(..., 0, ...)`) -> gate row 14 red (the uncompiled `FreshTest` ran and stopped Other); reverted
- mutation: the guard call deleted from `REST/Coverage.cls` `Run` (scratch copy: `tGuard` fixed to proceed) -> gate row 10 red ("Coverage run 1784 completed"), reverted
- mutation: the guard call deleted from `execute.ts` (`guard` fixed to `undefined`, dev rebuilt) -> gate rows 3, 4, 5, 7, 9, 14 red (and 10 and 13), reverted and rebuilt
- mutation: `readProductionGuard` fails closed on a 404 (returns a busy decision) -> `test-production-guard.test.ts` "a 404 ... is undefined" and "matrix row 16: a 404 from the guard route" red, reverted
- mutation: `removeTestProductionNamespace` skips `clearInstalledNamespace` -> `interop-namespace-fixture.test.ts` "the Story 40.3 teardown stops the production and clears the node ..." red, and the gate's teardown red ("every teardown step completed": the leftovers check lists `^%SYS("Ensemble","InstalledNamespace","EXECMCPTMP403A")`); the stale node was cleared through the fixture (a throwaway recovery test, removed), reverted
- mutation: a comment edit in `REST/UnitTest.cls` without `pnpm gen:bootstrap` -> `bootstrap.test.ts` "embedded class contents match disk .cls files" and "BOOTSTRAP_VERSION matches SHA-256 hash" red, reverted
- mutation: `PRODUCTION_BUSY` removed from `REFUSAL_CODES` -> `refusals.test.ts` catalog pin red, reverted
- mutation: the `production-busy` branch removed from `test-coverage.ts` -> `test-coverage.test.ts` "production-busy start ..." (both, matrix row 17) red, reverted
- mutation: the guard asked after `ensureUnitTestRoot` -> `test-production-guard.test.ts` rows 16 (404, 500, busy) and the call-order test red, reverted
- mutation: `encodeURIComponent` dropped from the guard's `target` -> `test-production-guard.test.ts` path/encoding tests (3) red, reverted
- mutation: the namespace-exists guard of `SetInstalledNamespace` and `ClearInstalledNamespace` replaced by `If 0` -> `interop-namespace-fixture.test.ts` "the Story 40.3 fixture methods ... keep their guard" red, reverted
- mutation: the Story 40.3 gate removed from `gateTestFiles` -> `live-gate-roster.test.ts` red; removed from `GATES` -> `story-39-1-gate-guards.test.ts` completeness red; reverted
- mutation: "The suite **never stops a production itself**" reworded in the dev README -> `story-40-3-doc-claims.test.ts` guard-section pin red, reverted
- mutation: the two tool descriptions without the guard sentence -> the tools-list snapshot check named exactly those two `description` differences before `--force` (and `tools-list-snapshot.test.ts` is the same comparison), then the snapshot was regenerated

**Mutation results (review pass, same method: IRIS-side from a scratch copy loaded into HSCUSTOM and reloaded from `src/`; TypeScript in `src/`, reverted with `cmp`).**

- mutation: `IsUpToDate` ignored (`Set tUseCompiled = 1`, a stale compiled class answers) -> gate row 14b red (the stale `StaleTest` was not refused), reverted
- mutation: the superclass's production not inherited (`Set pProduction = ""` in `ResolveTest`) -> gate row 14c red (`production: ""` instead of `Story403.Production`), reverted
- mutation: `ProductionCheck` answers `busy` for a namespace it cannot switch to -> gate row 12 red (the `EXECMCPTMP403Z` call), reverted
- mutation: a method-level run guarded only when the method is `TestControl` -> gate row 12 red (the `TestNoSuchMethod` call), reverted
- mutation: the `Catch exEns` handler drops the error text (`Set tError = ""`) -> gate row 15b red (the `error` text assertion), reverted. The lock-release assertion of row 15b is not mutated: dropping the unlock would leak `^Ens.Runtime` in a gateway job on the next gate's namespace directory
- mutation: an empty production name matches an empty own production (`If pName '= ""` -> `If 1`) -> OS `TestGuardOutcomeEmptyName` red, reverted
- mutation: `GuardOutcome` always `proceed` for a read state (`Quit "proceed"`) -> OS `TestGuardOutcomeForeignProduction` and `TestGuardOutcomeEmptyName` red, reverted
- mutation: `readProductionGuard` swallows every failure (returns `undefined` for a non-404 too) -> `test-production-guard.test.ts` "any other failure is thrown" and the HTTP 500 row-16 test red, reverted
- mutation: `readProductionGuard` treats an answer that is not `busy` as `proceed` -> `test-production-guard.test.ts` "only an explicit proceed lets a run go ahead" red, reverted
- mutation: the guard read made before the tests array is built (`execute.ts`) -> `test-production-guard.test.ts` rows 16 (404, busy), the target/level/namespace test and the malformed-target/empty-package precedence test red, reverted and dev rebuilt
- mutation: the refusal text says "left alone" for "left untouched" -> `test-production-guard.test.ts` refusal text tests and `test-coverage.test.ts` production-busy test red, reverted
- mutation: `assertTestProductionName` widened to `/^EXECMCPTMP/` -> `interop-namespace-fixture.test.ts` "the Story 40.3 fixture helpers refuse a name ..." red, reverted
- mutation: the coverage description names `ExecuteMCPv2.REST.Coverage` -> `test-coverage.test.ts` description pin (`executemcp(?!v2 service)`) red, reverted
- mutation: the dev README sentence "treated as that run's own and is stopped and restarted by the test, whoever started it" reworded -> `story-40-3-doc-claims.test.ts` guard-section pin red, reverted
- mutation: the name guard of `SetInstalledNamespace` (`If pName '? 1"EXECMCPTMP"1.N1U`) replaced by `If 0` -> gate row 13b red (the answer was `refused: namespace NOTASCRATCHNAME does not exist`, the existence guard having held), reverted

**Verification run record (implement stage, 2026-10-18, IRIS 2026.2 build 221U, `default` localhost:52773).**

- OS: `ProductionGuardTest` total 11 of 11 Test* methods passed; `UnitTestTest` 6 of 6; `CoverageJobTest` 31 of 31; `CoverageSourceTest` 13 of 13 (one class per call, totals equal the counts, Rule #35).
- `pnpm gen:bootstrap` twice: `BOOTSTRAP_VERSION` `06b8b83fc319` to `9ce1a489469d`, 35 classes, the second run byte-identical (`cmp`). Shared then rebuilt from scratch (dist and `tsconfig.tsbuildinfo` deleted, DW-591), then dev, admin, interop, ops, data, client-config and all.
- shared: `refusals.test.ts` and `bootstrap.test.ts` pass; full suite 80 files, 2066 tests. dev: the listed files pass; full suite 68 files, 1639 tests. admin 498, interop 670, ops 350, data 165, client-config 514 tests, and `build`, `lint` and `type-check` of every package green (shared's one pre-existing lint warning, an unused disable directive, is not from this story).
- all: `story-40-3-doc-claims`, `story-40-2-doc-claims`, `story-40-1-doc-claims`, `tools-list-snapshot`, `live-gate-roster`, `story-39-1-gate-guards`, `changelog-bootstrap-move`, `interop-namespace-fixture` (31 tests) and `data-policy-scope` pass; with the live `ENV` the 57 offline files (928 tests) and the 35 gate files pass in four calls: the Story 40.3 gate 15 of 15, none skipped; 40.1 gate 25; 40.1 QA 12; 40.2 gate 16; 40.2 QA 26; 39.2 gate 17 passed and its one design skip (`CAPTURE`); the other 29 gate files 148, 454 (three design skips) and 157 tests.
- `pnpm gen:governance-baseline:check`: 141 frozen keys all present (baseline files untouched). `pnpm measure:tools-payload` equals the README rows (dev 94,930 / 44,353 / 94,930 bytes). `node scripts/check-epics-sync.mjs`: OK. `pnpm gen:tools-list-snapshot:check`: OK after `--force`, which changed `capturedAt` and the two descriptions only.
- Raw route time (gate row 12, three runs: 6, 6, 6 ms; first run 6, 7, 7 ms): a plain target 6 ms, a TestProduction target with A Stopped 6 ms, with Other running 6 ms; each under the 2 s read budget.
- After every armed run: the gate's `afterAll` asserted `leftovers` for A and B `[]` (no namespace, database, mapping, process or InstalledNamespace node), `iris_doc_list` (HSCUSTOM, `Story403` and `Story391Fixture`, generated included) empty and the monitor idle; checked again by hand afterwards (no `EXECMCPTMP403*` namespace or database listed; no `Story403`, `Story391Fixture` or `Probe403` document).

**Verification run record (review pass, 2026-10-18, after the last patch).**

- OS, one class per call: `ProductionGuardTest` 11 of 11, `UnitTestTest` 6 of 6, `CoverageJobTest` 31 of 31, `CoverageSourceTest` 13 of 13. `pnpm gen:bootstrap` twice: `BOOTSTRAP_VERSION` stays `9ce1a489469d`, 35 classes, `bootstrap-classes.ts` byte-identical both times; shared then rebuilt from scratch.
- Armed (`ENV`): the Story 40.3 gate 19 of 19, none skipped (rows 1 to 15 plus 13b, 14b, 14c and 15b); 40.1 gate 25; 40.1 QA 12; 40.2 gate 16; 40.2 QA 26; 39.2 gate 17 passed and its one design skip. `@iris-mcp/all`: the 58 non-gate files (1,006 tests) and the 34 gate files, in four calls, all passed.
- `build`, `test`, `lint` and `type-check` of shared (2,066 tests; the one lint warning predates the story), dev (1,639), admin (498), interop (670), ops (350), data (165) and client-config (514) all exit 0. `pnpm gen:tools-list-snapshot:check` OK (115 entries). `pnpm gen:governance-baseline:check` OK (141 frozen keys present; baseline files untouched). `pnpm measure:tools-payload` equals the README rows. `node scripts/check-epics-sync.mjs` OK.
- Raw route time (gate row 12): 8 ms plain target, 7 ms TestProduction target with A Stopped, 6 ms with Other running; each under the 2 s read budget.
- After the armed runs: no `EXECMCPTMP403*` namespace or database is listed; `iris_doc_list` (HSCUSTOM, `Story403` and `Story391Fixture`, generated included) is empty; `^IRIS.TempExecuteMCPv2Coverage("session")` is unset; the gate's `afterAll` asserted `leftovers` for A and B `[]` (InstalledNamespace node included) and the monitor idle on every run, including the mutation runs.

**QA stage (2026-10-18; IRIS 2026.2 build 221U, `default` localhost:52773).** Gap analysis against the matrix and the ACs found the real-runtime pins below missing; the gate drives the built dev, admin and interop dists over stdio with the SDK client.

- Files (QA):
  - `packages/iris-mcp-all/src/__tests__/story-40-3-qa-live-gate.test.ts` (new, 12 tests, about 55 s armed): Q1a/Q1b plain runs unchanged and lock-free; Q2 spaced, missing-method and lower-case-namespace refusals, and a class name in another letter case; Q3a abstract base and prefix package, Q3b mixed package whole; Q4 own productions across a package; Q5a to Q5d the coverage path at every level, an unreadable state, a plain run, a stale compiled class; Q6a/Q6b the bare namespace. Namespaces `EXECMCPTMP40W` (with the one InstalledNamespace node) and `EXECMCPTMP40X`, both removed in `afterAll` with `leftovers` `[]`, the monitor idle and no `Story403`/`Story391Fixture` document in HSCUSTOM.
  - `packages/iris-mcp-all/scripts/prepublish-gate.mjs` (QA): the gate in `gateTestFiles`, and the session-gate comment.
  - `packages/iris-mcp-all/src/__tests__/story-39-1-gate-guards.test.ts` (QA): the gate in `GATES`.
- Values captured live (Rule #36): a plain run's keys `details, failed, jobId, passed, runIndex, runIndexSource, skipped, status, total` and detail keys `class, duration, message, method, status`; `Story403.Mix` as a package is `isError` with `{total:0, passed:0, failed:0, skipped:0, details:[], error:"No test classes found in package 'Story403.Mix'"}`; `story403.passtest` is `No tests found for 'story403.passtest' at level 'class'` (the work queue does not resolve another letter case, so the guard's exact-name lookup matches what runs); an absent namespace through the tool is `Error executing tests for 'Story403.PlainTest': IRIS returned HTTP 404 for POST /api/atelier/v8/EXECMCPTMP40Z/work ...` (not a refusal); the interop tool's `detail:true` status of a running `Story403.Other` has one item `Story403.OtherTarget`; the next coverage id is `Coverage run <n> was not found`.
- Observation, spec-bound (AC 40.3.2 "the test's own", decision #58): a package run whose tests declare two productions treats a running one of them as its own. The whole `Story403` package run with `Story403.Other` running proceeded (it holds `OtherTest`), ran all 9 tests and stopped Other; Q4 pins this on a two-test package.
- Run record: QA gate 12 of 12 (none skipped; also with `--sequence.shuffle`); the Story 40.3 gate 19 of 19 after the QA mutations; `live-gate-roster`, `story-40-1/2/3-doc-claims` 49 passed; the arming guard for the new gate (unarmed skip, armed "may not be skipped") and the `GATES` completeness check pass. Afterwards no `EXECMCPTMP40*` namespace or database is listed, `iris_doc_list` (HSCUSTOM, `Story40`, `Story391Fixture`, generated included) is empty, `("session")` is unset, and the live `ExecuteMCPv2.REST.UnitTest`, `Coverage` and `Dispatch` equal `src/`.
- mutation: `"guard": "proceed"` added to the completed result in `execute.ts` (dev rebuilt) -> QA `Q1a` red (the key-set pin); the Story 40.3 gate row 6 stayed green, reverted
- mutation: the guard call made ineffective in `execute.ts` (`guard` fixed to `undefined`, dev rebuilt) -> QA `Q1b`, `Q2`, `Q3a` and `Q5a` (its `iris_execute_tests` half) red, reverted
- mutation: `error` dropped from `guardFromStart` in `test-coverage.ts` -> QA `Q5b` red only, reverted
- mutation: the `production-busy` branch removed from `test-coverage.ts` -> QA `Q5a`, `Q5b` and `Q5d` red, reverted
- mutation: `ProductionGuard` reads the state also with no TestProduction test (`If tTests '= ""` -> `If 1`, scratch copy loaded into HSCUSTOM) -> QA `Q1b`, `Q3a` and `Q6a` red, reloaded from `src/`
- mutation: the class segment of `TestProductions` not trimmed (scratch copy) -> QA `Q2` red (the spaced target ran `PassTest` over Other), reloaded
- mutation: `Abstract = 0` dropped from the package query (scratch copy) -> QA `Q3a` red, reloaded
- mutation: the package prefix without the dot (`%Execute(pTarget)`, scratch copy) -> QA `Q3a` red (`Story403.Mix` listed `Story403.Mixed.ProdTest`), reloaded
- mutation: the own-production loop of `GuardOutcome` stops at the first test (`For tI = 1:1:1`, scratch copy) -> QA `Q4` red, reloaded
- mutation: `REST/Coverage.cls` asks `ProductionGuard` with `pCompiles` 1 (scratch copy) -> QA `Q5d` red (the stale class ran over Other), reloaded
- mutation: `CompiledAnswer` tests `%UnitTest.TestCase` instead of `%UnitTest.TestProduction` (scratch copy) -> QA `Q1a`, `Q1b`, `Q5c`, `Q6a` and `Q6b` red, reloaded
- mutation: the Stopped rule removed from `GuardOutcome` (scratch copy) -> QA `Q3b` red, reloaded
- mutation: the gate's `afterAll` skips removing `EXECMCPTMP40X` -> the gate's "every teardown step completed" red (the leftovers check lists the namespace); the namespace was removed by a throwaway recovery test (deleted), reverted
- mutation: the QA gate removed from `gateTestFiles` -> `live-gate-roster.test.ts` red; removed from `GATES` -> `story-39-1-gate-guards.test.ts` completeness red; reverted
- After the mutations `git status --short` and `git diff --stat` equal their pre-mutation capture, every mutated source is `cmp`-identical to its saved copy, and the dev dist was rebuilt from the restored source.

**Mutation results (code review, 2026-10-18).** IRIS-side mutations were made in scratch copies outside the repository, loaded into HSCUSTOM with `iris_doc_load`, and undone by reloading from `src/` (the live `REST/UnitTest`, `REST/Coverage` and `REST/Dispatch` were then compared with `src/` and equal it). TypeScript mutations were made in `src/` with the edit tool and reverted, `cmp`-identical to a saved copy.

- mutation: `ProductionCheck`'s visibility check without `$$$comClassDefined("ExecuteMCPv2.REST.Interop")` (in `src/`, `pnpm gen:bootstrap`, shared rebuilt; never loaded into IRIS) -> dev `test-production-guard.test.ts` "ProductionCheck asks the guard only behind a check that the guard's own class and every class it calls are defined there" red; reverted, the class and `bootstrap-classes.ts` `cmp`-identical, `BOOTSTRAP_VERSION` back to `3347b2f36ff2` (AC-3 / AD-15: the namespace that cannot see the package)
- mutation: `Coverage.Run` asks the guard at the request's level again (the package-fallback line removed, scratch copy) -> QA `Q5e` red ("Coverage run 2085 completed": the pre-patch code ran `Story403.PassTest` over `Story403.Other`), reloaded from `src/` (AC-5)
- mutation: the compiled-only package candidates limited to `SubclassOf('%UnitTest.TestProduction')` again (scratch copy) -> QA `Q5f` red ("Coverage run 2086 completed"), reloaded (AC-5)
- mutation: `$$$NormalizeClassnameByDef` removed from `ResolveTest` (scratch copy) -> QA `Q3c` red (the short-name walk was not resolved, so the run was not refused), reloaded (AC-2)
- mutation: the fixture's `EnsRuntimeHeld` asks from the serving process again (its pre-review body) -> gate row 15b red ("the check sees a lock held by the process that asks": expected "1", received "0"), reverted (AC-6; row 15b's lock-release oracle). The release itself is still not mutated: a dropped unlock would leak `^Ens.Runtime` in a pooled CSP process. What this mutation proves is that the oracle sees a lock held by the very process that asks, which is that leak.
- mutation: `(unnamed)` substitution dropped in `productionBusyRefusal` -> `test-production-guard.test.ts` "an unnamed production is '(unnamed)' ..." red, reverted
- mutation: the test list joined with `"; "` -> "lists every test of the run with its production, comma separated" red, reverted
- mutation: the `no reason was given` fallback made `""` -> "an unreadable state with no error text still refuses, with no error field" red, reverted
- Not mutated by decision: the `^Ens.Runtime` release moved before the error text is formatted (`ProductionGuard`), for the reason above; rows 13 and 15b run that path.

**Verification run record (code review, 2026-10-18, IRIS 2026.2 build 221U, `default` localhost:52773).**

- OS, one class per call: `ProductionGuardTest` 11 of 11, `UnitTestTest` 6 of 6, `CoverageJobTest` 31 of 31, `CoverageSourceTest` 13 of 13 (totals equal the `Test*` counts).
- `pnpm gen:bootstrap` twice: `BOOTSTRAP_VERSION` `9ce1a489469d` to `3347b2f36ff2`, 35 classes, the second run `cmp`-identical; shared rebuilt from scratch (dist and `tsconfig.tsbuildinfo` deleted, DW-591), then dev. The CHANGELOG, `tool_support.md`, the changeset and `story-40-3-doc-claims.test.ts` carry the new hash.
- shared 80 files, 2,066 tests (its one pre-existing lint warning); dev 68 files, 1,641 tests, `lint` and `type-check` clean; `@iris-mcp/all` 60 non-gate files, 1,035 tests.
- Armed, one gate per call: Story 40.3 gate 19 of 19; Story 40.3 QA gate 15 of 15 (Q3c, Q5e and Q5f new; its namespaces are now `EXECMCPTMP403W` and `EXECMCPTMP403X`); 40.1 gate 25; 40.1 QA 12; 40.2 gate 16; 40.2 QA 26; 39.2 gate 17 passed and its one design skip. The other gate files were not re-run: of their shared surfaces only the Story 40.3 methods of the fixture class changed, and every gate above compiled it.
- `pnpm gen:tools-list-snapshot:check` OK (115 entries, unchanged); `pnpm gen:governance-baseline:check` OK (141 frozen keys); `node scripts/check-epics-sync.mjs` OK.
- Guard route timing: gate row 12, 8 / 6 / 7 ms; package level in HSCUSTOM (`HS`, `Ens`, `%UnitTest`, `ExecuteMCPv2.Tests`; none holds a TestProduction subclass, so nothing reached Ens), 8.5 to 13.3 ms.
- Probes (read-only or disposable): `GET /dev/test/production` for plain targets in HSCUSTOM and `%SYS` (`proceed`; `%SYS` sees the package on this instance); `SubclassOf` against `ExecuteMCPv2.Temp.Probe403R` in HSCUSTOM (follows the definition), removed (`iris_doc_list Probe403` empty).
- Afterwards: no `EXECMCPTMP*` namespace or database is listed; `iris_doc_list` (HSCUSTOM, `Story403`, `Story391Fixture`, `Probe403`, generated included) is empty; `^IRIS.TempExecuteMCPv2Coverage("session")` is unset; the live `REST/UnitTest`, `REST/Coverage` and `REST/Dispatch` equal `src/`.

**Mutation results (rework 1, 2026-10-18).** The two open items were worked: the MED (an empty class part in an `iris_test_coverage` target) and the LOW (the visibility check requires the guard method). IRIS-side mutations were made in a scratch copy of `REST/Coverage.cls` outside the repository, loaded into HSCUSTOM with `iris_doc_load`, and undone by reloading `src/`; afterwards the live `REST/Coverage`, `REST/UnitTest`, `REST/Dispatch` and `Tests/ProductionGuardTest` were compared with `src/` and equal it. TypeScript, `.cls` and doc mutations were made in the working tree and restored from saved copies, `cmp`-identical (`git status --short` equals its pre-mutation capture). No request of the gate row can start a run under any mutation: each lists a class that does not exist, so a request the validation let through stops at "None of the listed classes has a measurable routine", before the guard and the launch (a `"::"` spec is never run).

- mutation: the empty-class-part rejection removed from `ValidateStart` (scratch copy loaded into HSCUSTOM) -> OS `ProductionGuardTest:TestValidateStartRejectsAnEmptyClassPart` red (11 of 12 pass), reloaded from `src/`
- mutation: the same live validation removed -> gate `story-40-3-qa-live-gate` Q5g red (`class ":": refused by the validation, before the class is resolved`: the route answered `ERROR #5001: None of the listed classes has a measurable routine ...`, nothing started), reloaded from `src/`. A gate run after a `BOOTSTRAP_VERSION` move redeploys every class when its dev session starts, which undoes a mutation loaded before it (the first attempt passed vacuously for that reason); the mutated copy was loaded again after that deploy
- mutation: `.refine(hasTargetName, ...)` removed from the `target` schema (dev rebuilt) -> `test-coverage.test.ts` "refuses a target whose package or class part is empty or blank ..." red (`":"` accepted), and gate Q5g red (the tool forwarded `":"` and IRIS refused it with `Error starting the coverage run`, not the schema's text), reverted and dev rebuilt
- mutation: the `target === ""` clause dropped from `hasTargetName` -> the same unit test red (an empty target must stay the service's own "required parameter" refusal, which the Story 40.1 QA gate pins), reverted
- mutation: `.trim()` dropped from `hasTargetName` -> the same unit test red (`"  :TestControl"` accepted), reverted
- mutation: `$$$comMemberDefined("ExecuteMCPv2.REST.UnitTest",$$$cCLASSmethod,"ProductionGuard")` removed from `ProductionCheck` (in `src/`, `pnpm gen:bootstrap`, shared rebuilt from scratch; never loaded into IRIS) -> `test-production-guard.test.ts` "the check also requires the guard method itself ..." red (`expected [] to deeply equal [ 'ExecuteMCPv2.REST.UnitTest.ProductionGuard' ]`), reverted: `UnitTest.cls` and `bootstrap-classes.ts` `cmp`-identical, `BOOTSTRAP_VERSION` back to `7f92a971b7e5`
- mutation: an unchecked cross-class call (`##class(ExecuteMCPv2.Coverage.Job).SafeText("")`) added to `ProductionGuard` (same method) -> the same test red (`a method the guard calls in another class that is neither checked nor in every copy of its class`), reverted
- mutation: `$$$comClassDefined("ExecuteMCPv2.REST.Interop")` removed from the same check (same method) -> `test-production-guard.test.ts` "ProductionCheck asks the guard only behind a check that the guard's own class and every class it calls are defined there" red (its rewritten parser), reverted
- mutation: the dev README, `tool_support.md`, CHANGELOG and changeset sentences reworded, in three rounds so that every new assertion fails on its own (the first new assertion of each test, then the second, then the third) -> `story-40-3-doc-claims.test.ts` red in each round: README `iris_test_coverage` entry (the empty-class-part rule and "the runner would read it as every compiled test class under `^UnitTestRoot`"), README `iris_execute_tests` limits (the namespace with its own earlier copy), the `tool_support.md` note (own earlier copy; `rejects a target`; the runner reading it as every test class), the CHANGELOG section (own earlier copy; the `refuses a target` entry; `rejected by the tool's schema`) and the changeset (`also rejects a target`); all four files restored, `cmp`-identical
- Not mutated: the visibility check's behavior in a live namespace that holds its own earlier copy of the package (no such namespace is built by the gates; the check is pinned on the shipped embed, as the class check is). The `inEveryCopyOfItsClass` list's staleness assertion was not mutated in this pass; the review pass below mutated it (embed `d9391430c93a`, red on that assertion).

**Verification run record (rework 1, 2026-10-18, IRIS 2026.2 build 221U, `default` localhost:52773).**

- OS, one class per call, totals equal the `Test*` counts (Rule #35): `ProductionGuardTest` 12 of 12 (11 and the new `TestValidateStartRejectsAnEmptyClassPart`), `UnitTestTest` 6 of 6, `CoverageJobTest` 31 of 31, `CoverageSourceTest` 13 of 13.
- `pnpm gen:bootstrap` run twice: `BOOTSTRAP_VERSION` `3347b2f36ff2` to `7f92a971b7e5`, 35 classes, the second run `cmp`-identical (an interim `cf6d41d5de87`, before the target check lost a redundant `$ZStrip`, was replaced). `packages/shared/dist` and `tsconfig.tsbuildinfo` deleted and shared rebuilt (DW-591), then dev, admin, interop, ops and data. The CHANGELOG bootstrap move, `tool_support.md`, the changeset and `story-40-3-doc-claims.test.ts` carry `7f92a971b7e5`.
- Unit: shared 80 files, 2,066 tests (its one lint warning predates the story); dev 68 files, 1,643 tests (two new: the target-schema test and the member-check pin), `lint` and `type-check` clean; admin 498, interop 670, ops 350, data 165, client-config 514; `@iris-mcp/all` 93 files, 1,824 passed and 4 design skips.
- Armed (`ENV`), one gate per call, none skipped: the Story 40.3 gate 19 of 19; the Story 40.3 QA gate 16 of 16 (Q5g new); 40.1 gate 25; 40.1 QA 12; 40.2 gate 16; 40.2 QA 26. One consequence of the schema change was found by the 40.1 QA gate: it pins the service's own text for an empty `target` (`""`), so the schema leaves `""` to the service and rejects only a non-empty target whose class part is blank. The tool-level refusal text on the wire is the SDK's (`MCP error -32602: Input validation error: Invalid arguments for tool iris_test_coverage ...`), which row Q5g asserts.
- `pnpm gen:governance-baseline:check` OK (141 frozen keys present); `pnpm gen:tools-list-snapshot:check` OK (115 entries unchanged: the `.refine` adds nothing to the advertised schema, so no `--force` and no README payload change); `pnpm measure:tools-payload` equals the README rows (dev 94,930 / 44,353 / 94,930 bytes); `node scripts/check-epics-sync.mjs` OK.
- Afterwards: no `EXECMCPTMP*` namespace or database is listed; `iris_doc_list` (HSCUSTOM, `Story403` and `Story391Fixture`, generated included) is empty; `^IRIS.TempExecuteMCPv2Coverage("session")` is unset; every gate's `afterAll` asserted `leftovers` `[]` for its namespaces and the monitor idle; the live `REST/Coverage`, `REST/UnitTest`, `REST/Dispatch` and `Tests/ProductionGuardTest` equal `src/`.

**Mutation results (rework 1, review pass).** `.cls` mutations were made in `src/`, the embed regenerated with `pnpm gen:bootstrap` and shared rebuilt; they were never loaded into IRIS. Doc mutations were made in the working tree. Everything was restored (the `.cls`, `bootstrap-classes.ts` and the three docs `cmp`-identical to saved copies; `git status --short` and `git diff --stat` equal their pre-mutation captures; the shared dist was rebuilt from scratch).

- mutation: ` && 1` appended to the `Set tGuarded = ...` line of `ProductionCheck` (embed `698d5377dd31`) -> `test-production-guard.test.ts` "ProductionCheck asks the guard only behind a check ..." red on "the check is a conjunction of those two macros only" (`expected '1' to be ''`), reverted
- mutation: the cross-class call `##class(ExecuteMCPv2.REST.Interop).StateName(` renamed `StateNameX(` in `ProductionGuard` (embed `61746853a567`) -> the member-check test "the check also requires the guard method itself ..." red on its filter ("a method the guard calls in another class that is neither checked nor in every copy of its class"), reverted
- mutation: that call replaced by its argument, so the guard no longer calls `StateName` (embed `d9391430c93a`) -> the same test red on its staleness assertion ("the listed methods are all called by the guard"), and the class-set test red, reverted
- mutation: the four new doc sentences reworded (the README `iris_test_coverage` entry, the README `iris_execute_tests` limits, the `tool_support.md` parenthesis, the CHANGELOG sentence) -> `story-40-3-doc-claims.test.ts` 4 tests red, one per new pin, restored

**Verification run record (rework 1, review pass, after the last patch).**

- Loop lines: the four classes reloaded from `src/` into HSCUSTOM (`up-to-date`, equal `src/`); OS, one class per call: `ProductionGuardTest` 12 of 12, `UnitTestTest` 6 of 6, `CoverageJobTest` 31 of 31, `CoverageSourceTest` 13 of 13. `pnpm gen:bootstrap` run again: `BOOTSTRAP_VERSION` stays `7f92a971b7e5`, `bootstrap-classes.ts` byte-identical; shared rebuilt from scratch. `pnpm gen:tools-list-snapshot:check` OK (115 entries, unchanged). The listed shared, dev and `@iris-mcp/all` offline files pass.
- Armed (`ENV`), one gate per call, none skipped: Story 40.3 gate 19 of 19; Story 40.3 QA gate 16 of 16 (Q5g included); 40.1 gate 25; 40.1 QA 12; 40.2 gate 16; 40.2 QA 26; 39.2 gate 17 passed and its one design skip.
- Once lines: `build`, `test`, `lint` and `type-check` of shared, dev (1,643 tests), admin (498), interop (670), ops (350), data (165), client-config (514) and `@iris-mcp/all` (93 files, 1,824 passed, 4 design skips) all exit 0 (shared's one lint warning predates the story). `pnpm gen:governance-baseline:check` OK (141 frozen keys); `pnpm measure:tools-payload` equals the README rows; `node scripts/check-epics-sync.mjs` OK. Raw route time (gate row 12): 7 ms plain target, 7 ms TestProduction target with A Stopped, 6 ms with Other running.
- Afterwards: no `EXECMCPTMP*` namespace is listed; `iris_doc_list` (HSCUSTOM, `Story40`, `Story391Fixture`, generated included) is empty; `^IRIS.TempExecuteMCPv2Coverage("session")` is unset; every gate's `afterAll` asserted `leftovers` `[]` and the monitor idle.

**Mutation results (code review, rework 1 re-review, 2026-10-18).** The `execute.ts` mutations were made in `src/` with the edit tool and undone by copying back a saved copy (`cmp`-identical; `git status --short` and `git diff --stat` equal their pre-mutation captures); the dev dist was then rebuilt from scratch (`dist` and `tsconfig.tsbuildinfo` deleted, the DW-591 quirk). Nothing was loaded into IRIS.

- mutation: the method-segment check of `execute.ts` made to match nothing (`/[;,^]/` -> `/[]/`) -> `test-production-guard.test.ts` "a method segment holding ';', ',' or '^' is malformed and reaches neither the guard nor the work queue ..." red (`Story403.PlainTest:X;Story403.PassTest`: `expected undefined to be true`), reverted (AC-2 / AD-27)
- mutation: the same check without `^` (`/[;,]/`) -> the same test red on `Story403.PlainTest:X^##class(Ens.Director).StopProduction()`, reverted
- mutation: the check made to match nothing again, dev rebuilt -> QA gate `Q2b` red, armed: the call completed with `total: 2`, `Story403.PassTest:TestControl` and `Story403.PlainTest:TestPlain` both passed, while `Story403.Other` ran in `EXECMCPTMP403W` (the TestProduction class the guard never inspected ran over it); the gate's teardown stopped and removed W; reverted and dev rebuilt from scratch (AC-2 / AD-27, on the built-dist stdio path the gate guards)
- mutation: the dev README sentence "So does a method segment that holds" reworded "with", and the CHANGELOG entry title's "method segment" reworded "method part" -> `story-40-3-doc-claims.test.ts` red twice ("the iris_execute_tests method-level validation names the method segment ..." and the CHANGELOG section test), both files restored `cmp`-identical, 15 of 15 again

**Verification run record (code review, rework 1 re-review, 2026-10-18, IRIS 2026.2 build 221U, `default` localhost:52773).**

- dev: `build`, then `test-production-guard.test.ts`, `execute.test.ts` and `execute-tests-running-contract-epic-gate.test.ts` 121 of 121; full dev suite 68 files, 1,644 tests (one new); `lint` and `type-check` clean.
- `@iris-mcp/all`: `story-40-3-doc-claims`, `story-40-2-doc-claims`, `story-40-1-doc-claims`, `changelog-bootstrap-move` and `tools-list-snapshot` 75 of 75 (the snapshot check OK: the handler change adds nothing to the advertised schema or descriptions, so no `--force` and no README payload change).
- Armed (`ENV`), one gate per call, none skipped: the Story 40.3 QA gate 17 of 17 (Q2b new), before and after the live mutation; the Story 40.3 gate 19 of 19. `BOOTSTRAP_VERSION` stays `7f92a971b7e5` (no IRIS class changed in this pass).
- Afterwards: no `EXECMCPTMP*` namespace is listed; `iris_doc_list` (HSCUSTOM, `Story40` and `Story391Fixture`, generated included) is empty; `^IRIS.TempExecuteMCPv2Coverage("session")` is unset; each gate's `afterAll` asserted `leftovers` `[]` and the monitor idle.

## Auto Run Result

Status: done
Blocking condition: none

**Rework 1 (2026-10-18; this pass only).**

- **Summary.** Both open items are closed. `iris_test_coverage` refuses a `target` whose package or class part is empty or blank (`":"`, `":TestControl"`, `"::"`), in `Coverage:ValidateStart` (`Parameter 'target' must start with a package or class name`) and in the tool's input schema; a bare empty `target` stays the service's own "required parameter" refusal. `ProductionCheck`'s visibility check also requires `$$$comMemberDefined("ExecuteMCPv2.REST.UnitTest",$$$cCLASSmethod,"ProductionGuard")`. `BOOTSTRAP_VERSION` moved `3347b2f36ff2` to `7f92a971b7e5` (35 classes); the tools-list snapshot and the README payload rows did not move.
- **Files changed.** IRIS: `src/ExecuteMCPv2/REST/Coverage.cls`, `REST/UnitTest.cls`, `Tests/ProductionGuardTest.cls` (+1 test, 12 in all), `packages/shared/src/bootstrap-classes.ts` (regenerated). TypeScript: `packages/iris-dev-mcp/src/tools/test-coverage.ts`; tests `test-coverage.test.ts`, `test-production-guard.test.ts`, the QA gate row Q5g and `story-40-3-doc-claims.test.ts`. Docs: the dev README, `tool_support.md`, `CHANGELOG.md` and the changeset.
- **Review findings.** 19 findings from four layers: high 0, medium 0, low 19, false 0 (counted from the triage log). Patches applied (9 rows, 5 root causes): the docs now say `iris_test_coverage` is refused, with nothing started, where the guard cannot run (it does not go ahead unguarded like `iris_execute_tests`); the `inEveryCopyOfItsClass` comment states its true scope; the README sentence grammar; `hasTargetName` no longer exported, with `@returns` and a message that fits a blank target with no colon; mutation lines for the residue and staleness assertions. Deferred: none. Rejected (10 rows, 6 reasons): spec-bound pins on the shipped embed (the older-copy branch), the lead's bar on running `"::"` (Q5g's assertions, the runner claim), the forced placement of the OS test, no recorded mutation for positive controls, a validation error rather than `PRODUCTION_BUSY`, and the `proceed` answer that decisions #56 and #60 define.
- **Follow-up review recommendation:** `false` (no high was patched; 9 low patches).
- **Verification.** See "Mutation results (rework 1)", "Verification run record (rework 1)" and the review-pass blocks in `## Verification`: OS 12, 6, 31 and 13 of the `Test*` counts; the Story 40.3 gate 19, its QA gate 16, the 40.1 gate 25, 40.1 QA 12, 40.2 16 and 40.2 QA 26 armed and none skipped; per-package `build`, `test`, `lint` and `type-check` green; governance `:check`, snapshot `:check`, payload and epics-sync OK; afterwards no `EXECMCPTMP*` namespace, no `Story403`/`Story391Fixture` document and `("session")` unset.
- **Residual risks.** The visibility check's false branch (a namespace with its own earlier copy) is pinned on the shipped embed only; no live namespace is built for it. The `"::"` hazard is established from `Manager.cls` source, not by a run, because a run would execute every test class at the root on a shared instance.

**Earlier passes (implement, review, QA; unchanged since 2026-10-18).**

**Summary.** `iris_execute_tests` and `iris_test_coverage` now ask one IRIS-side TestProduction guard, taken under Ens's lifecycle lock (`^Ens.Runtime`), before anything runs. A run that includes a `%UnitTest.TestProduction` test is refused with the new code `PRODUCTION_BUSY` while a production other than the tests' own runs in the namespace, or when the state cannot be read. Nothing is queued or run, and that production is left untouched. A run with no TestProduction test is unchanged, and a 404 from the new route (`GET /dev/test/production`) runs as before. `BOOTSTRAP_VERSION` moved `06b8b83fc319` to `9ce1a489469d` (35 classes). No tool, action, key or preset row was added, and `iris_execute_tests` and `iris_test_coverage` keep their default states (enabled, DEFAULT-DISABLED).

**Files changed.**
- IRIS: `src/ExecuteMCPv2/REST/UnitTest.cls` (the guard, the route entry, the pure `GuardOutcome`), `REST/Coverage.cls` (the guard call and the `production-busy` outcome), `REST/Dispatch.cls` (the route), `Tests/ProductionGuardTest.cls` (new, 11 tests); `packages/shared/src/bootstrap-classes.ts` (regenerated).
- TypeScript: `packages/shared/src/refusals.ts` (`PRODUCTION_BUSY`), `packages/iris-dev-mcp/src/tools/test-production-guard.ts` (new: the read, the 404 rule, the one refusal builder), `execute.ts` and `test-coverage.ts` (the wiring and the description sentence).
- Tests: `test-production-guard.test.ts` (new), the mock plumbing in `execute.test.ts`, the tightened description pin in `test-coverage.test.ts`, `refusals.test.ts`; in `@iris-mcp/all` the fixture methods and their roster case, `testproduction-fixture.ts`, the Story 40.3 gate (19 tests) and `story-40-3-doc-claims.test.ts`, the roster and session-gate comments, and the regenerated `tools-list-snapshot.json`.
- Docs: dev README, root README, shared README, `tool_support.md`, `CHANGELOG.md` (new top section) and `.changeset/story-40-3-testproduction-runs.md`.

**Review findings.** 39 findings from four layers: high 0, medium 6, low 26, false 7. Patches applied (20 rows, 6 root causes): gate rows 14b and 14c (the definition path of `ResolveTest`: a stale compiled class, an inherited `PRODUCTION`), row 15b (the exception branch of the guard, with the lock released), row 12 additions (an unswitchable namespace; a method-level run whatever the method), row 13b (the fixture methods refuse non-scratch names); the limits docs now say that a same-named running production is "run over" and that a non-404 guard failure fails every run; the coverage-description pin tightened to `executemcp(?!v2 service)`; 15 `mutation:` lines written in this pass for the new and the previously unrecorded pinning tests. Deferred: none. Rejected with reasons (19 rows): spec-bound behavior (the 404 run unguarded with no signal, the unswitchable-namespace `proceed`, the refusal fields and recovery text, a same-named production as "own"), unreachable or theoretical cases (the 32-class cap, a stranded node, the unreachable `ProductionGuard` outer Catch), documented residuals (the decision-to-start window, the residue oracle ignoring work-queue workers) and cosmetic items (`capturedAt`, two sentences in the guard sentence). Coverage-path compiled-only resolution (finding 22) is not pinned by a row; reopen if a coverage run is refused for a class that is not compiled.

**Follow-up review recommendation:** `true` (two medium root causes were patched: the definition path of `ResolveTest`, and the exception branch of the guard). Unverified risk: the patch-pass additions (gate rows 13b, 14b, 14c, 15b and the row 12 calls, the `Story403.StaleTest`/`BaseTest`/`InheritTest` sources, and the new limits text and doc pins) have been through mutation checks and an armed run, but not through an independent review layer.

**Verification.** See the two verification run records in `## Verification` and the mutation lines (33 entries from both passes: 18 from the implement pass and 15 from the review pass, each applied, observed red and reverted).

**Residual risks.** The window between the decision and the test's own start in another process; a run against a server without the guard route is unguarded; a production already running under a name a test declares is stopped and restarted by the test; a cancelled, killed or erroring TestProduction run leaves its production running; privileges verified under `_SYSTEM` only. `ProductionGuard` is live in HSCUSTOM on the shared instance (the spec's `iris_doc_load` loop).
