---
title: 'Story 40.3: TestProduction Runs'
type: 'feature'
created: '2026-10-18'
status: 'done'
baseline_revision: '1f5fb1cd163e62b2ecdcd873c4648d67adae7145'
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

## Spec Change Log

- **2026-10-18, lead spec gate.** Decisions #56 to #59 were taken as recommended. #56 adds that the `iris_execute_tests` and `iris_test_coverage` descriptions state the guard needs the ExecuteMCPv2 service, and that a run without it is unguarded. #59 is the shared-instance sign-off for the one IRISSYS node per disposable namespace. Spine amended (Rule 20): AD-27 (the TestProduction decision under `^Ens.Runtime`, with its residual window; the suite never stops a production), AD-15's sanctioned list (Story 40.3), and the "Live testing on a shared instance" convention (the InstalledNamespace node).

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

## Auto Run Result

Status: done
Blocking condition: none

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
