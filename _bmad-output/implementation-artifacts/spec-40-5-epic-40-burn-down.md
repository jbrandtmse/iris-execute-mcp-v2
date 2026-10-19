---
title: 'Story 40.5: Epic 40 Burn-down'
type: 'chore'
created: '2026-10-18'
status: 'done'
baseline_revision: 'e0d883ba0363f02c98330248a69ae1e3f8b96f01'
baseline_commit: 'e0d883ba0363f02c98330248a69ae1e3f8b96f01'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
warnings:
  - multiple-goals
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 40 left eight ledger entries with this story.
- Five are defects:
  - `pnpm gen:bootstrap` rewrites an unchanged embed, which makes the shared dist look stale (DW-591).
  - `iris_alerts_manage` labels local time as UTC (DW-589).
  - `POST /tests` at package level runs no test (DW-597).
  - Six coverage gates copy the monitor helpers (DW-603, MED, Rule 2).
  - A test oracle cannot fail, because it calls the same function it checks (DW-607).
- Three are decided prompt-text gaps:
  - `recover-stuck-production` has no `block` rule for withheld Event Log text (DW-590, decision #65).
  - `edit-and-test-class` has no `PRODUCTION_BUSY` note (DW-609, #66).
  - `deploy-and-test-class` step 4 omits the refusal for an unreadable production state (DW-610, #67).

**Approach:**
- Fix each defect at its source, and prove each fix live or by mutation (Rule #48).
- Make the three sanctioned AD-15 prompt-text changes and regenerate the skills.
- Move the monitor helpers into one shared module that the 40.3 helpers build on.
- Record the bootstrap move, the CHANGELOG section and the changeset.

## Boundaries & Constraints

**Always:**

- **DW-591 (`scripts/gen-bootstrap.mjs`).**
  - Write `bootstrap-classes.ts` only when the file is missing or its content differs from the new output.
  - When the content is equal, print that the file is unchanged, with `BOOTSTRAP_VERSION`. Keep today's three lines for a write.
  - The hash and the content are unchanged.
- **DW-589 (`REST/Monitor.cls`, bootstrapped).**
  - New `ClassMethod UtcStamp(pNow As %String = "") As %String`. `pNow` is a `$ZTimeStamp` value, and empty means now.
  - It returns `$Translate($ZDateTime($Piece(pNow, "."), 3, 1), " ", "T")_"Z"`. That is today's `clearedAt` format, `YYYY-MM-DDThh:mm:ssZ`. Fractional seconds are truncated (probe below).
  - `AlertsManage` sets `clearedAt` from `..UtcStamp()`. Nothing else in the route changes: validation, `$SYSTEM.Monitor.Clear()`, the namespace restore and the response keys `{action, clearedAt}` all stay.
- **DW-597 (`REST/UnitTest.cls`, `REST/Coverage.cls`, both bootstrapped).**
  - `BuildTestSpec` at the package level returns `:A;B;C`: one colon, then the package's `%UnitTest.TestCase` classes separated by `;` alone.
  - The class level, the method level and the `:<target>` fallback are byte-identical.
  - Remove `Coverage.TestSpec`'s `$Replace(tSpec, ";:", ";")`. `TestSpec` stays, returning `BuildTestSpec`'s value, and its doc comment states that contract.
  - `POST /tests` keeps its request and response shapes (AD-33) and still has no tool caller (decision #40).
- **DW-603 (iris-mcp-all; Rule 2, no behavior change). New module `src/__tests__/monitor-gate-helpers.ts`.**
  - It exports `sleep(ms)` and `type MonitorStateJson`.
  - It exports `monitorGate({ dev: () => WireSession, suiteRoutineSets: readonly string[] })`, which returns `fixtureCall`, `monitorState`, `coverageGlobal`, `runCounter`, `expectMonitorIdle(row)` and `releaseLeftoverSession()`, moved verbatim from `testProductionGate`.
  - It also returns `expectMonitorInactive(row)`: the `active === 0` assertion of `expectMonitorIdle` alone.
  - `testproduction-gate-helpers.ts` builds its monitor helpers with `monitorGate`, and its own copies, `sleep` and `MonitorStateJson` are deleted. Its exported names and the two 40.3 gates stay byte-unchanged.
  - Six gates delete their copies and use `monitorGate`: 40.1, 40.1 QA, 40.2, 40.2 QA, the capstone and 40.4 QA.
    - `expectIdle` becomes `expectMonitorIdle`, except in the two 40.1 gates, which become `expectMonitorInactive`.
    - `releaseLeftover` becomes `releaseLeftoverSession`.
  - `REPLACED_NAMES` gains `sleep`, `fixtureCall`, `monitorState`, `coverageGlobal`, `runCounter`, `expectIdle`, `releaseLeftover`, `expectMonitorIdle`, `expectMonitorInactive` and `releaseLeftoverSession`.
- **DW-607 (`Tests/ProductionGuardTest.cls`).**
  - The agreement loop takes its expected value from `$$$ISOK($System.OBJ.IsValidClassname(tName))`, the compiler's validator.
  - `""` leaves the loop and is asserted directly as `IsClassName("") = 0`, because the validator throws `<SUBSCRIPT>` on it (probe).
  - The loop gains the probed names `Pkg.A1`, `User.Class`, `Pkg..A`, `Pkg.A.` and `Pkg.1A`, plus two length cases:
    - `"A."_$Translate($Justify("", 218), " ", "B")`, which is 220 characters and valid;
    - `$Translate($Justify("", 221), " ", "A")`, which is 221 characters and too long.
  - The CJK assertions stay. Rename the method `TestResolveTestNameCheckAgreesWithTheCompiler`; the class keeps 13 `Test*` methods.
- **Prompts (sanctioned AD-15, decisions #65–#67; AD-28).**
  - Names, titles, arguments, descriptions and step counts are unchanged: recover 8, edit 12, deploy 9.
  - The texts are the golden texts in Design Notes.
  - The `PRODUCTION_BUSY` note is one exported constant, in `packages/iris-dev-mcp/src/prompts/productionBusyNote.ts`. Deploy step 4 and edit step 9 end with it.
  - No `iris_*` token is added (edit tokens stay in dev `core`). No rule number, AD/DW id or path appears.
  - `skills/` is regenerated only through `pnpm gen:skills`. `skills/README.md` stays byte-identical.
- **Bootstrap (AD-14).**
  - Run `pnpm gen:bootstrap` twice; the second run reports unchanged.
  - Rebuild shared.
  - Record `BOOTSTRAP_VERSION` `5024e4623f1d` → the printed hash as the newest CHANGELOG move. The class count stays at 35.
  - The 40.4 literals in the CHANGELOG, the changeset, `tool_support.md` and `story-40-4-doc-claims.test.ts` stay as history.
- **Docs (Rule #43).**
  - Add the README clauses in Design Notes.
  - Add the CHANGELOG section `## [Pre-release — 2026-10-19] — Story 40.5: Epic 40 burn-down`. It sits above Story 40.4, holds no `N/N/N/N/N` roster-summary string and quotes no other section's title.
  - Add `.changeset/story-40-5-epic-40-burn-down.md` (`@iris-mcp/shared`, `@iris-mcp/dev`, `@iris-mcp/interop`: patch).
- **Text.** Source text is ASCII with escapes (Rule 14). Comments state the contract. Expected values are captured live (Rule #36).

**Never:**

- No new tool, action, governance key, preset row, `TOOL_PAIRS` entry, refusal code, prompt, environment variable or route. No tool description changes. These counts do not move:
  - dev 32 package tools (33 advertised); suite 110 (115);
  - dev `core` 14 (15 runtime); `developer` 32 (33);
  - 13 prompts (dev 5); 10 refusal codes;
  - baseline `1e62c5ad5bf7`/141; 35 bootstrapped classes.
  - The tools-list snapshot does not move.
- No change to the monitor ownership, busy, release or reclaim logic, the TestProduction guard, `IsClassName`, or the gates' assertions. Only the helper source moves.
- No call of the real `iris_alerts_manage` reset or the `/monitor/alerts/manage` route. `$SYSTEM.Monitor.Clear()` resets instance-wide alert state on the shared instance.
- No production is started or read outside the 40.3 gates' own disposable namespaces.
- No HSCUSTOM global is written by this story's new code or tests. Two existing writes are allowed: `UnitTestTest`'s save and restore of `^UnitTestRoot`, and the test runner's own result globals.
- No `POST /tests` spec that could resolve to `::`.
- No hand edit of generated files, `irislib/`/`irissys/` or the frozen baseline. `:check` only. No `changeset version` and no publish.

## I/O & Edge-Case Matrix

| # | Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|---|
| 1 | DW-591 unchanged run | Scratch tree: `scripts/gen-bootstrap.mjs` plus a copy of `src/ExecuteMCPv2`. Run once, set the output's mtime to a fixed past time, run again | The second run leaves the mtime and content as they were, and stdout says unchanged | None |
| 2 | DW-591 changed run | Then append a line to the scratch `Utils.cls` and run | The file is rewritten (mtime moves), and its `BOOTSTRAP_VERSION` differs | None |
| 3 | DW-589 fixed instants (OS) | `UtcStamp("67000,3600.5")`, `("67000,86399.9996")`, `("67860,0")` | `2024-06-09T01:00:00Z`, `2024-06-09T23:59:59Z` (truncated, never the next day), `2026-10-17T00:00:00Z` (probe values; re-capture live) | None |
| 4 | DW-589 time zone (OS) | Process `$ZTimeZone` 420, then -600; `UtcStamp()` bracketed by `$ZTimeStamp` before and after | The result lies within the bracket in both zones. The zone is restored inside the loop and in `OnAfterOneTest` | Catch asserts false and restores |
| 5 | DW-589 route wiring (OS) | `%Dictionary.MethodDefinition` `ExecuteMCPv2.REST.Monitor\|\|AlertsManage` `Implementation` | It sets `clearedAt` from `..UtcStamp()` and holds no `$Horolog` (any case) | None |
| 6 | DW-597 package run (live gate) | `EXECMCPTMP405A` (no mappings) holding `Story405.ATest` (`TestOne`, `TestTwo`) and `Story405.BTest` (`TestThree`), all passing. `postEnvelope(TARGET, "/tests", {target:"Story405", level:"package", namespace:"EXECMCPTMP405A"})` | `errors` `[]`; `result.total` 3, `passed` 3, `failed` 0; `details` (class, method) equal the three, in `ORDER BY` class then method | Envelope error fails the row |
| 7 | DW-597 back-compat (AD-33) | Same route, `level:"class"` `Story405.BTest`, and `level:"method"` `Story405.ATest:TestTwo` | Totals 1 and 1, with that one method. `result` keys are exactly `total, passed, failed, skipped, duration, details` | None |
| 8 | DW-597 spec shape (OS) | `BuildTestSpec("ExecuteMCPv2.Tests","package")`; `Coverage.TestSpec` at all three levels | Starts with `:`, has exactly one `:`, no `;:`, and `;`-delimited membership of `ExecuteMCPv2.Tests.UtilsTest`. `TestSpec` equals `BuildTestSpec` | None |
| 9 | DW-603 module (unit) | `monitorGate` over a fake `WireSession` whose results have the real tools' shapes (`iris_execute_classmethod` `structuredContent.returnValue`; `iris_global_get` `{value, defined}`) | `expectMonitorIdle` passes on `{active:0}` with the node undefined, and throws on `active:1` or a defined node. `expectMonitorInactive` passes with a defined node. `releaseLeftoverSession` reads the state before each `StopIfList`, stops while active, and makes no `StopIfList` call when idle | None |
| 10 | DW-607 (OS) | The loop names; `""` | `IsClassName` equals the compiler validator on every loop name (live: CJK, `λ`, `Pkg.A1`, 220 chars accepted; `%`-inner, trailing dot, `..`, space, `;`, `:`, `_`, leading digit, 221 chars rejected); `""` is 0 | None |
| 11 | Prompts (render) | `prompts/get` of the three prompts, with and without arguments | Recover step 3 ends with the `block` sentence. Edit step 9 and deploy step 4 end with the identical note. Step counts are 8, 12 and 9. `SKILL.md` bodies equal the `build({})` renders | None |

</intent-contract>

## Code Map

**DW-591**
- `scripts/gen-bootstrap.mjs`:
  - the unconditional write is at :182-186;
  - `root` comes from `__dirname` (:6-7), so a copied tree works;
  - top-level code, no exports, no `--check`.
- New `packages/shared/src/__tests__/gen-bootstrap-write.test.ts`:
  - Spawn the script with `spawnSync(process.execPath, …)`, on the copy-a-tree pattern of `packages/iris-mcp-all/src/__tests__/tools-list-snapshot.test.ts:418-432`.
  - Repo root is `resolve(__dirname, "../../../..")`, as in `bootstrap.test.ts:1264-1265`.
  - Make the tree with `mkdtempSync`, `cpSync` `src/ExecuteMCPv2` recursively, and `mkdir` `packages/shared/src`. Remove it in `afterAll`.
- `scripts/lib/dist-freshness.mjs:187-290` is the mtime rule this protects (read-only).
- `document-write-paths.test.ts` scans `scripts/gen-bootstrap.mjs` for `.put(` and similar, never `writeFileSync`, so its roster does not move.

**DW-589**
- `src/ExecuteMCPv2/REST/Monitor.cls`:
  - `AlertsManage` :913-973; the stamp is at :958-960, and the doc comment :904-912 gains "`clearedAt` is the UTC time of the reset";
  - `UtcCutoff` :532-549 is the sibling (see Rule 2 in Design Notes);
  - place `UtcStamp` after it.
- `src/ExecuteMCPv2/Tests/EventLogMetricsTest.cls` (104 lines, 4 tests; `SavedZone` with restore in `OnAfterOneTest` :13-36; template `TestUtcCutoffIgnoresProcessTimeZone` :57-75):
  - add `TestUtcStampFixedInstant`, `TestUtcStampIgnoresProcessTimeZone` and `TestAlertsManageStampsClearedAtInUtc` (rows 3-5), for 7 tests;
  - update the header :1-8.
- Docs: `packages/iris-ops-mcp/README.md:389-393` (the Output block). TS `alerts.ts`/`alerts.test.ts` are unchanged (a mock value).

**DW-597**
- `src/ExecuteMCPv2/REST/UnitTest.cls`:
  - `BuildTestSpec` :175-214 (join :204-205; the doc comment :175-178 duplicates its first line, so rewrite it as the contract);
  - `RunTests` :37-137 switches namespace before `BuildTestSpec`/`RunTest`/`ParseTestResults`, so the dictionary query runs in the target;
  - `EnsureTestEnvironment` :155 sets the target's `^UnitTestRoot` to `<mgr>/unittest_mcp/`, which already exists (probe).
- `src/ExecuteMCPv2/REST/Coverage.cls`:
  - `TestSpec` :323-333 (the rewrite :331; the doc comment :323-327);
  - caller `Run` :299-301, whose fallback check `tSpec = ":"_target` is unchanged.
- `src/ExecuteMCPv2/Tests/UnitTestTest.cls`: `TestBuildTestSpecPackage` :84-91 asserts `[ ":ExecuteMCPv2.Tests.UtilsTest"`, which breaks, so rewrite it per row 8. There are 6 tests. `TestEnsureTestEnvironment*` :6-58 save and restore HSCUSTOM `^UnitTestRoot`.
- `src/ExecuteMCPv2/Tests/CoverageJobTest.cls` :65-78 pins `TestSpec` and stays green unchanged (500 lines: do not edit).
- System source: `irislib/%UnitTest/Manager.cls` :250-251 (grammar), :836-858 (`RunOneTestSuite`: `:A;:B` makes `B` a method filter on every class, while `:A;B` runs both).
- New gate `packages/iris-mcp-all/src/__tests__/story-40-5-burn-down-live-gate.test.ts`:
  - skeleton `story-40-0-burn-down-live-gate.test.ts:1-140` (`GATE_TAG`, `wireOptions`, `skipReason` order, `openWireSession` then `assertDeployedBootstrapVersion`);
  - sessions dev and admin;
  - `createInteropNamespace(admin, dev, NS, {interop:false})`, `removeInteropNamespace`, `putFixtureClass`/`removeFixtureClass`, `leftovers` (`interop-namespace-fixture.ts:1035-1100`, :2446);
  - `docFixtures(dev, NS)` and `postEnvelope` (`process-gate-helpers.ts:459`, :721);
  - the `Story405.*` sources inline.
  - Path: SDK `Client` → built admin/dev for the fixtures; raw HTTP `POST /api/executemcp/v2/tests` for rows 6-7. The `%ALL` mapping of `ExecuteMCPv2` → HSCUSTOM makes the handler resolve in the scratch namespace (verified live).
  - It starts no Line-by-Line session and no production.
- Rosters:
  - `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles`: a new entry after :275 with the 40.0 comment style;
  - `story-39-1-gate-guards.test.ts` `GATES` :75-82: `{file:"story-40-5-burn-down-live-gate.test.ts", tag:"story-40-5-burn-down-live-gate", story:"Story 40.5"}`.

**DW-603** (all under `packages/iris-mcp-all/src/__tests__/`)
- `testproduction-gate-helpers.ts`:
  - header :1-10;
  - `sleep` :36 and `MonitorStateJson` :38-43 move;
  - factory monitor helpers :164-196 move verbatim into `monitorGate`, and `testProductionGate` spreads them;
  - `succeeded` :91-94 stays.
- Six gates. Delete these blocks; keep each gate's own `ENABLED_GOVERNANCE`, `succeeded` and `settled`:
  - `story-40-1-coverage-live-gate.test.ts`:
    - delete `sleep` :170, `MonitorStateJson` :172-177, `fixtureCall` :216-221, `monitorState` :223-225, `expectIdle` :227-231, `releaseLeftover(routines)` :244-250, `runCounter` :252-257 and `coverageGlobal` :259-265;
    - `suiteRoutineSets: [SUITE_ROUTINES]`;
    - calls `releaseLeftover(SUITE_ROUTINES)` at :408, :676, :762 and :789 become `releaseLeftoverSession()`;
    - `expectIdle` becomes `expectMonitorInactive`, because :971-972 expects the node still defined;
    - `expectPids` :234-242 and `killBothJobs` :268-272 stay.
  - `story-40-1-qa-live-gate.test.ts`:
    - delete :204, :206-211, :248-253, :255-257, :259-263, :265-274 and :276-281;
    - `suiteRoutineSets: SUITE_ROUTINES` (:105);
    - calls at :438 and :446;
    - `expectMonitorInactive`.
  - `story-40-2-coverage-reports-live-gate.test.ts`: delete :149, :151-156 and :218-255; `SUITE_ROUTINE_SETS` (:104); calls at :373 and :381.
  - `story-40-2-qa-live-gate.test.ts`: delete :708, :713-718 and :782-824; `SAFETY_NET_SETS` (:584-592); call at :1079.
  - `epic40-capstone-gate.test.ts`: delete :137-142, :199 and :203-240; `[...SUITE_ROUTINE_SETS, FOREIGN_ROUTINES]` (:109-113); calls at :418 and :424.
  - `story-40-4-qa-live-gate.test.ts`: delete :292-297, :366 and :370-407; `[...SUITE_ROUTINE_SETS, FOREIGN_ROUTINES]` (:106-107); calls at :673 and :679.
  - `sleep` is still called outside the helpers in every gate, so import it.
- `gate-helper-copies.test.ts`:
  - `REPLACED_NAMES` :20-59;
  - header :1-10 names the new module;
  - its regex sees `function`/`const` at column 0, not `interface` or destructuring, so the gates' `const { … } = monitorGate(…)` passes.
- New `monitor-gate-helpers.test.ts` (row 9; no IRIS). The fakes return shapes read from `packages/iris-dev-mcp/src/tools/global.ts` and the classmethod tool (Rule #54).
- `story-39-1-gate-guards.test.ts:168-196` pins each gate's `beforeAll` skeleton. The moves keep it.

**DW-607**
- `src/ExecuteMCPv2/Tests/ProductionGuardTest.cls` :116-129 (doc comment :116-118, the loop :125-128), 183 lines.
- `IsClassName` is `Coverage/Job.cls:470-474`, unchanged.
- System source: `irislib/%SYSTEM/OBJ.cls:1698-1703` (`IsValidClassname`: a conflict check, then `IsClassnameValid^%occName`); `irislib/%Dictionary/Classname.cls:8-14`.

**Prompts**
- `packages/iris-interop-mcp/src/prompts/recoverStuckProduction.ts`: step 3 :54; header :1-9 gains one contract line.
- `packages/iris-dev-mcp/src/prompts/editAndTestClass.ts`: step 9 :63; header :1-8.
- `packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts`: step 4 :42; header :1-11.
- New `packages/iris-dev-mcp/src/prompts/productionBusyNote.ts`. It is camelCase like its grandfathered directory, and `prompts/index.ts` is unchanged.
- The rule's source text is `traceMessageFlow.ts:52` (step 5).
- The refusal fields it describes are `test-production-guard.ts:108-141`: `production` when the state was read, otherwise `state: "Unknown"` and `error`.
- Pins:
  - `packages/iris-mcp-all/src/__tests__/prompt-safety-invariants.test.ts`: :646-647 move to the new wording, and :645 stays. Add a Story 40.5 block: recover step 3 ends with the rule; deploy step 4 and edit step 9 end with the identical note; the `Unknown` sentence; no `iris_production_control` in either. :430-455 (tokens and forbidden patterns) must stay green.
  - `packages/iris-dev-mcp/src/__tests__/prompts.test.ts` (:112-180): the edit step 9 note and the deploy step 4 note.
  - `packages/iris-interop-mcp/src/__tests__/prompts.test.ts`: a recover test on the trace pattern :265-289 (`stepOf(3).endsWith`, 8 steps, both renders).
  - Stay green: `story-38-6-qa-edit-prompt-sdk-wire.test.ts` (:212 12 steps, :222 step 9, :320-346), `story-39-6-qa-forensics-prompts-sdk-wire.test.ts` (:375-387, :450-466), the `story-40-4-qa-live-gate.test.ts` A5 skill-equals-render check (:828-844), and `epic40-capstone-gate.test.ts:478-479`.
- Generated: `skills/recover-stuck-production/SKILL.md`, `skills/edit-and-test-class/SKILL.md`, `skills/deploy-and-test-class/SKILL.md`.

**Docs**
- `README.md`: edit row :816, recover row :818.
- `packages/iris-dev-mcp/README.md`: deploy row :268 (keep the substring that `story-40-4-doc-claims.test.ts:157` pins) and edit row :270.
- `packages/iris-interop-mcp/README.md`: recover row :397.
- `packages/iris-ops-mcp/README.md:393`.
- `CHANGELOG.md`: a new top section on the 40.4 pattern :5-60.
- The changeset follows `.changeset/story-40-0-epic-39-deferred-cleanup.md`.
- New `packages/iris-mcp-all/src/__tests__/story-40-5-doc-claims.test.ts` on the `story-40-4-doc-claims.test.ts` pattern (`sectionsOf`, title regex, "newest section first", `BOOTSTRAP_FROM`/`BOOTSTRAP_TO`, `CLAIMS` from `doc-claims-patterns.ts`).
- `changelog-bootstrap-move.test.ts:25` reads the newest "moves from `x` to `y`" sentence.

## Tasks & Acceptance

**Execution:**

1. `scripts/gen-bootstrap.mjs`: write only when the content differs (DW-591). Add `packages/shared/src/__tests__/gen-bootstrap-write.test.ts` (rows 1-2).
2. `src/ExecuteMCPv2/REST/Monitor.cls`: add `UtcStamp`, and have `AlertsManage` use it (DW-589).
3. `src/ExecuteMCPv2/REST/UnitTest.cls`: the `BuildTestSpec` package join and doc comment. `src/ExecuteMCPv2/REST/Coverage.cls`: remove the `TestSpec` rewrite and update its doc comment (DW-597).
4. OS tests:
   - `EventLogMetricsTest.cls` gets the three tests (rows 3-5);
   - `UnitTestTest.cls` gets `TestBuildTestSpecPackage` per row 8;
   - `ProductionGuardTest.cls` gets the oracle and the rename (row 10, DW-607).
   - Load through `iris_doc_load` globs and compile clean.
5. Run `pnpm gen:bootstrap` twice, then rebuild shared (AD-14).
6. Prompts:
   - add `productionBusyNote.ts`;
   - change deploy step 4, edit step 9, recover step 3 and their header contracts (DW-590, DW-609, DW-610);
   - update the dev and interop `prompts.test.ts` and the `prompt-safety-invariants.test.ts` pins;
   - build dev and interop, then run `pnpm gen:skills`.
7. iris-mcp-all, DW-603:
   - add `monitor-gate-helpers.ts` and its unit test (row 9);
   - refactor `testproduction-gate-helpers.ts` and the six gates;
   - add the `REPLACED_NAMES` entries and update the header.
8. iris-mcp-all, DW-597: add `story-40-5-burn-down-live-gate.test.ts` (rows 6-7), the `gateTestFiles` entry and the `GATES` entry.
   - Its `beforeAll` removes leftovers by name and asserts none remain.
   - Its `afterAll` removes the namespace, the database files and the fixture class, and asserts that `leftovers` is `[]` and that `iris_doc_list` (HSCUSTOM, filters `Story405` and `Story391Fixture`, generated included) is empty.
9. Docs:
   - the README clauses and the ops README sentence;
   - the CHANGELOG section, laid out in Design Notes;
   - the changeset;
   - `story-40-5-doc-claims.test.ts`.

**Acceptance Criteria:**

- **AC-1 (DW-591).** **Given** an unchanged class set, **when** `gen:bootstrap` runs again, **then** `bootstrap-classes.ts` keeps its mtime and content. **When** a class changes, **then** the file is rewritten with a new version (rows 1-2).
- **AC-2 (DW-589).** **Given** a process at `$ZTimeZone` 420 or -600, **when** the reset's stamp is built, **then** it is the UTC instant in today's format, and `AlertsManage` takes `clearedAt` from it (rows 3-5). The reset route is never called.
- **AC-3 (DW-597).** **Given** a two-class test package in `EXECMCPTMP405A`, **when** `POST /tests` runs it at the package level, **then** all three methods run and pass. Class and method runs, the response keys and `iris_test_coverage`'s package runs are unchanged (rows 6-8; the armed 40.1 gate's package row stays at total 5).
- **AC-4 (DW-603; Integration AC).**
  - **Given** the shared `monitorGate`, **when** the eight 40.x gates (40.1, 40.1 QA, 40.2, 40.2 QA, 40.3, 40.3 QA, the capstone and 40.4 QA) run armed one per call, **then** every row passes as before, with the monitor idle and the session node unset afterwards.
  - **When** any gate declares one of the moved names at column 0, **then** `gate-helper-copies.test.ts` fails, naming it.
- **AC-5 (DW-607).** **Given** the loop names, **when** `ProductionGuardTest` runs, **then** `IsClassName` agrees with `$System.OBJ.IsValidClassname` on every one and is 0 for `""` (row 10).
- **AC-6 (DW-590/609/610, AD-15/AD-28).** **Given** the built dev and interop servers, **when** the three prompts are listed and rendered, **then**:
  - row 11 holds;
  - names, titles, arguments and descriptions are unchanged;
  - every `iris_*` token is a real tool (edit: dev `core`);
  - `gen:skills:check` and `validate:prompts` pass;
  - `skills/README.md` is unchanged.
- **AC-7 (bootstrap and docs).** **Given** the regenerated embed, **when** `changelog-bootstrap-move.test.ts`, `bootstrap.test.ts`, `story-40-5-doc-claims.test.ts` and the gates' `assertDeployedBootstrapVersion` run, **then** they pass, with the newest move `5024e4623f1d` → the new hash. The 40.4 doc pins are unchanged.

### Review Findings

Code review 2026-10-18 (bmad-code-review, `review_tier: full-opus`; layers blind-hunter, edge-case-hunter, verification-gap and acceptance-auditor all delivered; frozen diff `e0d883b..HEAD` + working tree + the untracked QA gate). 28 rows: 11 survived into 10 entries (high 0, med 2, low 8), and 17 were rejected (13 appendix lines).

- [x] [Review][Patch] The Story 40.5 QA gate adds a fifth `stepsOf`, a fourth `toolTokens` and second `promptText`/`promptRejection` copies, and `prompt-safety-invariants.test.ts` re-declares `stepText` in its new block (Rule 2, unjustified copy) [packages/iris-mcp-all/src/__tests__/story-40-5-qa-live-gate.test.ts:380; packages/iris-mcp-all/src/__tests__/prompt-safety-invariants.test.ts:719] — med, fix-risk low (byte-identical pure helpers), in-story. Fix: promote the four into one shared module, migrate every copy, guard the names in `REPLACED_NAMES`; hoist `stepText` to file scope. `settled` stays per gate (it wraps each gate's own `succeeded` and companion call): occurrence on DW-600.
- [x] [Review][Patch] CHANGELOG DW-589 says a process at time zone 0 got the same value before, but `$Horolog` carries the DST hour that `$ZTimeZone` does not, so a zone-0 host in summer time was an hour off [CHANGELOG.md:35] — low, fix-risk low, in-story (doc text plus its doc-claims literal).
- [x] [Review][Patch] CHANGELOG DW-597 says a package run ran no test; only a package of two or more test classes did, and the bullet does not say the route stays outside the TestProduction guard [CHANGELOG.md:40] — low, fix-risk low, in-story.
- [x] [Review][Patch] The 40.1 roster comment still says the 40.1 to 40.4 gates are the only ones that start Line-by-Line sessions, though the 40.5 QA gate is the ninth [packages/iris-mcp-all/scripts/prepublish-gate.mjs:224] — low, fix-risk low, in-story.
- [x] [Review][Patch] The QA gate header and its roster comment say no production is read, but row P5 asks the guard for the bare namespace's production state (it cannot be read there; that is the row's point) [packages/iris-mcp-all/src/__tests__/story-40-5-qa-live-gate.test.ts:27; packages/iris-mcp-all/scripts/prepublish-gate.mjs:285] — low, fix-risk low, in-story.
- [x] [Review][Patch] The CHANGELOG Tests section names the burn-down gate but not the QA gate, which starts Line-by-Line sessions on the shared instance [CHANGELOG.md:58] — low, fix-risk low, in-story.
- [x] [Review][Patch] The `PRODUCTION_BUSY_NOTE` doc comment says neither refusal tells the model to stop a production, but the named-production refusal suggests stopping an interrupted run's leftover with `iris_production_control` (Rule 14: a wrong claim) [packages/iris-dev-mcp/src/prompts/productionBusyNote.ts:9] — low, fix-risk low, in-story.
- [x] [Review][Patch] QA P1 and P3 assert `toolTokens` on the gate's own literals, which cannot fail; the edit and deploy renders have no exact token-list pin like recover's [packages/iris-mcp-all/src/__tests__/story-40-5-qa-live-gate.test.ts:563] — low, fix-risk low, in-story. Fix: pin the rendered edit and deploy token lists, captured from the baseline `e0d883b` renders (Rule #36).
- [x] [Review][Patch] The CHANGELOG counts paragraph leaves out the tools-list snapshot from the spec's Never counts [CHANGELOG.md:7] — low, fix-risk low, in-story.
- [x] [Review][Defer] The DW-597 fix lets an unguarded `POST /tests` package run reach a package's `%UnitTest.TestProduction` tests, which stop another running production [src/ExecuteMCPv2/REST/UnitTest.cls:16] — deferred: same root cause as DW-605 (adjudicated wontfix-theoretical at 40.3: no tool calls the route, and a REST caller already holds `POST /command`); occurrence appended. The class header already says the route is not guarded; the CHANGELOG now says so too (patch above).

**Patches applied (all 9).**
- New `packages/iris-mcp-all/src/__tests__/prompt-gate-helpers.ts` (`stepsOf`, `toolTokens`, `promptText`, `promptRejection`). The 38.6 QA, 39.6 QA, 40.0 QA, 40.4 QA and 40.5 QA gates import from it, and their copies are deleted. `REPLACED_NAMES` gained the four names, and the guard header names the module. `stepText` is declared once at file scope in `prompt-safety-invariants.test.ts`.
- CHANGELOG: the DW-589 DST wording, the DW-597 two-or-more-classes wording plus the unguarded-route sentence, the QA gate bullet under Tests, and the tools-list snapshot sentence. Each is pinned in `story-40-5-doc-claims.test.ts`.
- Comments: the `prepublish-gate.mjs` 40.1 roster line and the 40.5 QA line, the QA gate header, and the `productionBusyNote.ts` contract.
- QA gate: the two literal-only `toolTokens` checks are gone. P4 pins the edit and deploy render token lists, captured from the `e0d883b` renders and equal to the current dist renders.

**Verification after the patches.**
- Dev: built and ran `prompts.test.ts` (12/12); lint and type-check clean.
- `gen:skills:check` OK (14 files). `validate:prompts` OK (13 prompts, 13 skills).
- `@iris-mcp/all`: 16 non-live files, 344 tests passed, including `story-39-1-gate-guards`, which loads every migrated gate unarmed and armed with IRIS unreachable. ESLint is clean on the edited files.
- Armed `story-40-5-qa-live-gate.test.ts`: 10/10 passed, none skipped.
- The instance afterwards: no `EXECMCPTMP405*` namespace, `^IRIS.TempExecuteMCPv2Coverage("session")` undefined, and `iris_doc_list` (HSCUSTOM, generated included) for `Story405` and `Story391Fixture` is `[]`.

**Review Outcome:** CLEAN. Story status `done` (sprint-status synced). Failed layers: none. Ledger: occurrences on DW-605 and DW-600; no new entries.

**Rejected (17 rows, 13 lines).**
- low: the copy guard scans only gate test files at column 0, so a nested copy or one in a helper module passes (blind 2, edge 5). AC-4 scopes the guard to column-0 declarations in gates, every removed copy was top-level, and closing the gap means more guard rules.
- low: the `Unknown` branch says "run the tests again in a moment" with no stopping point (blind 5). This is decision #67's golden text, so the fix would edit the spec.
- low: the root README deploy row does not mention `PRODUCTION_BUSY` (blind 7). The root README covers the deploy prompt's `PRODUCTION_BUSY` handling at :528, and the spec's README clause list leaves that row out.
- low: the `AlertsManage` wiring is pinned by source text, which misses `$H`, `$Now` or a second `%Set` (blind 9, verification-gap 2, auditor 2). A realistic revert to `$Horolog` fails both assertions, and the recorded `cleared_at` mutation went red. A behavioral pin needs a route refactor, which the spec forbids. The residual is recorded under Residual risks.
- false: `gen:bootstrap` has no no-write check (blind 10). The default-suite test "the checked-in embed is exactly what the generator writes" is that check, run on a scratch copy.
- false: a null `runIndex` interpolated into the T3 SQL (edge 2). A completed run carries its index, and a null would fail the row loudly, which is right for a test.
- low: `BuildTestSpec`'s dictionary query has no `ORDER BY` (edge 3). The class dictionary iterates in name order, and the fix would change a bootstrapped class.
- low: `EnsureTestEnvironment` may create `<mgr>/unittest_mcp/` (edge 6). That is the route's own working directory: it is shared by every run, already present on this instance, and not a fixture.
- low: the 40.1 QA gate never checks the ownership node (verification-gap 3). The spec's Never forbids changing the gates' assertions, and the node is pinned by the 40.1 coverage gate and the later gates.
- false: ACs without a `mutation:` line (verification-gap 4). Rule 19 asks for one per AC, and AC-2, AC-3, AC-6 and AC-7 each have recorded mutations under Verification.
- false: `EXPECTED_PAIRS` length is a constant check (verification-gap other 1). It is a self-check of the oracle, and T1 to T3 assert the product against it.
- low: the Review Triage Log overstates "any new rewrite goes red" (verification-gap other 2). The fix would edit this spec's triage log, and restoring the removed `$Replace` is harmless now.
- low: `TestBuildTestSpecPackage` relies on the deployed `ExecuteMCPv2.Tests` package (verification-gap other 3), and the 40.4 doc-claims title still says "first" (auditor 1). The package is the one the test itself runs from, and the assertion shape is unchanged. The 40.2 and 40.3 titles use the same wording without the pin.

## Spec Change Log

## Review Triage Log

### 2026-10-18 — Review pass
- verdicts: 33 findings — high 0, medium 3, low 24, false 6, maybe-false 0
- layers: blind-hunter 7, edge-case-hunter 9, verification-gap 8, intent-alignment 9 (descriptive divergences, one row each)
- findings:
  - `[medium]` `[patch]` `gen-bootstrap-write.test.ts` second test reads an embed only the first test creates (blind 1) — verified: filtered run failed ENOENT; each test now builds its own scratch tree (beforeEach/afterEach) and the changed-run test makes its own baseline; passes whole and with `-t` for either test
  - `[low]` `[patch]` `story-40-4-doc-claims.test.ts` pin loosened from `toBe(0)` to `<= 1` (blind 2) — the `toBe(0)` could not survive the Story 40.5 section above it; removed it, as 40.0 to 40.3 never had it (`toBeLessThan(previous)` stays); the Story 40.5 test title no longer says "first"
  - `[low]` `[patch]` the recover rule is "the sentence trace-message-flow step 5 carries" but is not byte-identical (blind 3) — the wording is the spec's golden text (decision #65), so it stays; the invariants-test comment now says "modelled on"; single-sourcing across prompts is not part of the spec
  - `[low]` `[reject]` 40.5 gate checks the interop dist it never opens (blind 4) — the freshness line is the skeleton `story-39-1-gate-guards.test.ts:202` pins for every gate; the 40.0 and 40.4 QA gates carry the same line
  - `[low]` `[patch]` DW-589 route wiring pinned by substring matching (blind 5) — the wiring test now asserts the exact `Do tResult.%Set("clearedAt", ..UtcStamp())` line besides the `horolog` check; mutation recorded (key renamed to `cleared_at` -> red)
  - `[low]` `[reject]` `IsClassName` oracle depends on case conflicts in the namespace (blind 6) — spec-bound: the Intent names the loop and Design Notes records the assumption (names with no existing different-case class or package); closed by-design
  - `[low]` `[reject]` README/CHANGELOG say "not to stop a production without the user's confirmation" though the Unknown branch is stricter; root deploy row silent on PRODUCTION_BUSY (blind 7) — the clauses are the spec's golden README text; the root deploy row is Story 40.4's and not in this story's list
  - `[low]` `[reject]` the note matches both branches when a refusal has `production` and `Unknown` (edge 1) — `productionBusyRefusal` sets `production` only when a numeric state code was read, and `Unknown` then needs an unmapped code no real state produces (wontfix-theoretical); the text is decision #67's golden text
  - `[low]` `[reject]` "is running" is wrong for a Troubled or Suspended production (edge 2) — the sentence is the wording Story 40.4 already ships, kept by decision #66/#67; closed by-design
  - `[low]` `[reject]` a refusal flows into "Otherwise, compare total" (edge 3) — the note starts "nothing ran"; the "Otherwise" structure is Story 40.4's; golden text
  - `[low]` `[patch]` `TestAlertsManageStampsClearedAtInUtc` matches loosely (edge 4) — same root cause as blind 5; patched there
  - `[low]` `[reject]` `MonitorStateJson` not in `REPLACED_NAMES` and interfaces are not matched (edge 5) — the spec lists the ten names and records that the regex sees `function`/`const` only (Code Map, DW-603)
  - `[false]` `[reject]` `coverageGlobal` passes vacuously on an answer without structured content (edge 6) — the real `iris_global_get` always returns `{value, defined}` structured content (`tools/global.ts`); the code is the 40.3 helper moved verbatim; no real input reaches the branch (Rule #54)
  - `[low]` `[reject]` `ProductionGuardTest` oracle red on a case-conflicting package (edge 7) — same as blind 6
  - `[medium]` `[patch]` `gen-bootstrap-write` order dependence (edge 8) — same as blind 1
  - `[low]` `[patch]` 40.4 doc pin loosened (edge 9) — same as blind 2
  - `[low]` `[patch]` AlertsManage `clearedAt` pinned only by text (verification-gap 1; filed as defer) — same root cause as blind 5; patched in-pass (a one-line assertion), so not deferred
  - `[medium]` `[patch]` `gen-bootstrap-write` second test not self-contained (verification-gap 2) — same as blind 1
  - `[low]` `[reject]` `ProductionGuardTest` oracle depends on dictionary state (verification-gap 3; filed as defer) — same as blind 6; spec-bound
  - `[low]` `[patch]` `BUSY_NOTE`/`BLOCK_RULE` `not.toMatch(/\biris_/)` assert on test-local literals (verification-gap 4) — now asserted on the last `BUSY_NOTE.length`/`BLOCK_RULE.length` characters of each rendered step
  - `[low]` `[reject]` `TestSpec equals BuildTestSpec` compares a pass-through with its target (verification-gap 5) — matrix row 8 requires it; `TestSpec` is the contract that returns `BuildTestSpec`'s value, `CoverageJobTest:TestTestSpecSeparatesPackageClassesBySemicolon` pins its package form, and any new rewrite goes red
  - `[low]` `[patch]` secondary tests without a `mutation:` line (verification-gap 6) — Rule 19 asks one mutation per AC and each AC had one; lines added for the changed-run, fixed-instant, release-state, inactive-check and note-placement tests; the AC-3 row 7 and AC-5 name-list tests are covered by their AC's recorded mutation
  - `[low]` `[patch]` 40.4 doc pin weakened and the 40.5 title says "first" (verification-gap 7) — same as blind 2
  - `[false]` `[reject]` the `testproduction-gate-helpers` composition runs only in armed gates (verification-gap 8) — the two armed 40.3 gates ran this pass (20 and 17 tests passed, none skipped) through that composition
  - `[low]` `[patch]` DW-589 divergence: the intent's surface is the route; the tests read source text (intent 1) — the contract forbids calling the route; same as blind 5
  - `[false]` `[reject]` DW-597 "iris_test_coverage package runs unchanged" is backed only by an OS equality (intent 2) — the armed 40.1 gate's package row (`Story401`, total 5, passed 5) ran live this pass
  - `[false]` `[reject]` DW-607 oracle independence unverified (intent 3) — read: `IsClassName` calls `%Dictionary.Classname.IsValid` (a `$ZName` loop), the oracle calls `IsClassnameConflict^%occName` and `IsClassnameValid^%occName`; separate code
  - `[low]` `[reject]` DW-603 changed the 40.1 gates' release logic and the idle message (intent 4) — disclosed and accepted under Design Notes "AC interpretations"
  - `[low]` `[patch]` older stories' assertions edited (intent 5) — the 40.4 doc pin is covered by blind 2; the `prompt-safety-invariants.test.ts` deploy step 4 lines are the spec's sanctioned move (:646-647)
  - `[low]` `[patch]` recover wording differs from trace step 5 (intent 6) — same as blind 3
  - `[false]` `[reject]` Rule #48 evidence is not in the diff (intent 7) — the spec's Verification holds the `mutation:` lines; the auditor was told not to read it
  - `[false]` `[reject]` the edited gates are not run in the diff (intent 8) — all 11 Epic 40 gates ran armed this pass, none skipped
  - `[low]` `[reject]` prompt tests carry their own literal copy of the text instead of importing the constant (intent 9) — deliberate: the oracle must not be the implementation (Rule #36)

## Design Notes

**Governing ADs:**
- **AD-15:** the three prompt changes are on the sanctioned list (Story 40.5 bullet; decisions #65–#67). Everything else is byte-identical where unused.
- **AD-26:** the recover rule is the `trace-message-flow` step 5 sentence.
- **AD-27:**
  - the `PRODUCTION_BUSY` wording covers the unreadable-state refusal;
  - the guard and the monitor discipline are untouched.
- **AD-14:** the bootstrap move; generated files change only through their generators.
- **AD-28:** the prompts are authored once and the skills are generated; the checks are mechanical.
- **AD-12:** `UtcStamp` and `BuildTestSpec` return raw data.
- **AD-33:** `POST /tests` and `/monitor/alerts/manage` keep their shapes.
- **AD-13:** the namespace handling in both handlers is unchanged.
- **AD-2:** the gates live in `iris-mcp-all`.
- **AD-4, AD-5 and AD-7:** no change; `:check` only.
- **Conventions:** Live gates; Live testing on a shared instance; Probes and references; IRIS-side unit tests.

**Golden texts.**
- **`PRODUCTION_BUSY_NOTE`** (deploy step 4 replaces everything after "with the chosen `level`."; edit step 9 appends it after the `running` sentence):
  > If the response is a `PRODUCTION_BUSY` refusal, nothing ran. When the refusal has a `production` field, that production is running in the namespace and is not the tests' own: tell the user, and do not stop that production unless the user confirms it is a leftover of an interrupted test run. When its `state` is `Unknown`, the namespace's production state could not be read (the refusal says why): tell the user, run the tests again in a moment, and do not stop any production to make them run.
- **Recover step 3 appends:**
  > Under the `block` data policy each entry's `text` is withheld and its `textPolicy` gives the reason: report that reason to the user, and never read the log text another way (for example through SQL, global or document tools).
- **README clauses:**
  - **Edit rows** (root :816, dev :270) append: "It tells the model what a `PRODUCTION_BUSY` refusal means (a production other than the tests' own is running, or the production state could not be read) and not to stop a production without the user's confirmation."
  - **Dev deploy row** (:268): insert "(a production other than the tests' own is running, or the production state could not be read)" after "refusal means".
  - **Recover rows** (root :818, interop :397) append: "Under the `block` data policy it reports the reason for withheld Event Log text and never reads that text another way."
  - **Ops README** after the Output block: "`clearedAt` is the time of the reset in UTC (ISO 8601, to the second)."
- **CHANGELOG section:**
  - A counts paragraph: the Never counts, plus "`BOOTSTRAP_VERSION` moves from `5024e4623f1d` to `<printed hash>`, because `REST/Monitor.cls`, `REST/UnitTest.cls` and `REST/Coverage.cls` changed (the bootstrapped service stays at 35 classes)".
  - **Changed:** the three prompt bullets, each naming its decision (#65, #66, #67) and "sanctioned AD-15"; names, titles, arguments and descriptions unchanged; the skills regenerated.
  - **Fixed:**
    - DW-589. The format is unchanged. A process at time zone 0 got the same value before.
    - DW-597. No tool calls the route. `iris_test_coverage` package runs are unchanged, and the spec rewrite they needed is removed.
    - DW-591.
  - **Tests:**
    - DW-603 (one monitor helper module, guard names);
    - DW-607;
    - the Story 40.5 gate;
    - the earliest IRIS version verified for `$System.OBJ.IsValidClassname` and `$ZTimeStamp` truncation: 2026.2 build 221U.

**Probe evidence** (IRIS 2026.2 build 221U, `default` localhost:52773, HSCUSTOM, 2026-10-19 01:57–01:59 UTC). The probes were `ExecuteMCPv2.Temp.Probe405A` and `Probe405B`. Both were deleted, and `iris_doc_list` for `Probe405` is `[]`. No session, production, namespace or global write was made.
- **DW-589.** At `$ZTimeZone` 420 the old expression gave `2026-10-18T18:58:35Z` and the new one `2026-10-19T01:58:35Z` (true UTC). At -600 they gave `…T11:58:36Z` and `…T01:58:36Z`.
  - `$ZDateTime("67000,86399.9996",3,1)` is `2024-06-09 23:59:59`: it truncates.
  - `Job.UtcNow()` carries milliseconds (`…:35.706Z`).
  - The zone was restored to 0. The instance runs at 0, which is why the defect is invisible live.
- **DW-597.** Today `BuildTestSpec("ExecuteMCPv2.Tests","package")` gives `:…AdvisorDataTest;:…BaseTest;…`, and `Coverage.TestSpec` gives `:…AdvisorDataTest;…BaseTest;…`. An empty package gives `:Probe405NoSuchPkg`.
  - The `%ALL` package mapping `ExecuteMCPv2` → HSCUSTOM exists.
  - `<mgr>/unittest_mcp/` (`/durable/iris/mgr/`) exists, and HSCUSTOM `^UnitTestRoot` is `/durable/iris/mgr/`.
- **DW-607.** For the 13 loop names, `IsValidClassname` agrees with `IsClassName`, except `""`, which throws `<SUBSCRIPT> IsClassnameConflict+2^%occName`. So does `.Pkg.A` (`checkPackage`), which is kept out of the loop.
  - It differs only on case conflicts with existing classes or packages (`%library.string`, `%Pkg.A` against package `%pkg`). That is why the loop holds only names with no existing different-case class or package.

**AC interpretations** (apply and report):
- **DW-603 "no behavior change".** Every gate assertion and fixture call on the non-racing path is unchanged. Three things do change:
  - the failure messages take the shared text ("idle", where the copies said "idle afterwards");
  - the 40.1 QA release re-reads the state before each `StopIfList`, the shared discipline, which is strictly safer in a race;
  - the 40.1 gates keep their active-only check through `expectMonitorInactive`.
- **DW-603 scope.**
  - It includes the capstone and the 40.4 QA gate (the ledger's 40.4 occurrence; once the guard learns the names, their copies would fail it).
  - "The shared module" is a new monitor-only module, the ledger's own alternative. `TestProductionGateOptions` needs an interop session and a `403` production namespace, which none of the six gates has.
  - `succeeded` is not moved. It is a generic result helper declared by 15 gates with at least two contracts, so the guard cannot learn it without touching the Epic 39 gates.
- **DW-597.** The rewrite "can go", so it goes. The live pin uses a gate-local `Story405` fixture. `coverage-fixture.ts`'s seeds refuse any namespace but `EXECMCPTMP401`/`402<letter>`, and this story's namespace is `EXECMCPTMP405A`.
- **DW-589.** The outermost surface, the reset route, is not driven, because it clears instance-wide alert state. Row 4 pins the stamp under real time zones, and row 5 pins that the route uses it. Both are mutation-verified.

**Extend, don't copy (Rule 2).**
- `UtcStamp` is a sibling of `UtcCutoff` (a `$ZTimeStamp` input, a different output form) and of `Coverage.Job.UtcNow` (milliseconds; reusing it would change `clearedAt`'s format).
- `monitorGate` is extracted from `testProductionGate`, which then consumes it.
- The note is one constant used by both prompts.
- The OS tests extend `EventLogMetricsTest` (its `SavedZone` restore).
- The new gate follows the 40.0 burn-down gate and the shared helpers.

**Integration (Rules 1/2).**
- **Integration AC:** AC-4. The consumers are the eight 40.x gates and the two 40.3 gates through `testproduction-gate-helpers.ts`. They read `monitorGate`, and their armed rows pass with the idle checks. AC-6 covers the note.
- **Consumed-by:**
  - `monitor-gate-helpers.ts` → the eight gates above and any later gate that starts a Line-by-Line session;
  - `UtcStamp` → `AlertsManage`;
  - `PRODUCTION_BUSY_NOTE` → `deploy-and-test-class` and `edit-and-test-class`.
- **Consumes:**
  - `interop-namespace-fixture.ts` (`FIXTURE_CLASS`, `MonitorState`, `StopIfList`, the namespace lifecycle);
  - `process-gate-helpers.ts` (`allText`, `WireSession`, `postEnvelope`, `docFixtures`).

**Ledger inbox (Rule 17).** All eight are addressed, and none is declined:
- DW-591: Task 1, AC-1.
- DW-589: Tasks 2 and 4, AC-2.
- DW-597: Tasks 3, 4 and 8, AC-3.
- DW-603: Task 7, AC-4.
- DW-607: Task 4, AC-5.
- DW-590, DW-609 and DW-610: Task 6, AC-6.

**Orchestrator decisions needed:** none. Decisions #65–#67 cover the prompt text, and the other items are defect fixes the epic block directs.

**Context.** `epics.md` (the Story 40.5 block) and the spine (AD-15) are newer than `epic-40-context.md`. Both were read directly at :5479-5490 and :291-324, and the cache was not recompiled.

## Verification

- Run every command from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package or one gate file per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- Every MCP call names `server:"default"` and `namespace:"HSCUSTOM"`.

**Shared surfaces:** these change, and other tests assert on them.
- The deploy step 4 text (`prompt-safety-invariants.test.ts:646-647`), the edit step 9 text, the recover step 3 text and the three `SKILL.md` files.
- The README prompt rows (root, dev, interop) and the ops README alerts entry.
- `BOOTSTRAP_VERSION` and the newest CHANGELOG move; the first CHANGELOG section.
- `gateTestFiles`, `GATES` and `REPLACED_NAMES`.
- The helper declarations of the six coverage gates and `testproduction-gate-helpers.ts`.
- The `UnitTestTest` package pin, the `ProductionGuardTest` method name, and the `EventLogMetricsTest` count (4 → 7).
- Tool, preset, prompt, refusal and baseline counts, the tools-list snapshot and `skills/README.md` are unchanged.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order.

- **Disposable fixtures:**
  - `EXECMCPTMP405A` (its database files too) and `Story405.*` inside it;
  - `ExecuteMCPv2.Temp.Story391Fixture` in HSCUSTOM;
  - the scratch tree in the OS temp directory;
  - the existing gates' own namespaces.
- **OS test classes** run one class per `iris_execute_tests` call, and `total` is compared with the `Test*` count (Rule #35).
- **No OS or unit test** starts a Line-by-Line session or a production.

**Commands:**

- `(loop)` `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/gen-bootstrap-write.test.ts` -- expected: pass.
- `(loop)` `iris_doc_load` (HSCUSTOM, compile) the globs `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/REST/Monitor.cls`, `…/src/**/REST/UnitTest.cls`, `…/src/**/REST/Coverage.cls`, `…/src/**/Tests/EventLogMetricsTest.cls`, `…/src/**/Tests/UnitTestTest.cls` and `…/src/**/Tests/ProductionGuardTest.cls` -- expected: clean.
- `(loop)` `iris_execute_tests`, one call each: `EventLogMetricsTest` (7), `EventLogMetricsEdgeTest` (3), `UnitTestTest` (6), `ProductionGuardTest` (13), `CoverageJobTest` (31). Read HSCUSTOM `^UnitTestRoot` with `iris_global_get` before and after `UnitTestTest` -- expected: the totals match, 0 failures, `^UnitTestRoot` unchanged.
- `(loop)` `pnpm gen:bootstrap` twice -- expected: the second prints unchanged and `stat -f %m packages/shared/src/bootstrap-classes.ts` is the same. Then `pnpm --filter @iris-mcp/shared build` and `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build`, then `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/prompts.test.ts`; the same for `@iris-mcp/interop` -- expected: pass.
- `(loop)` `pnpm gen:skills`, then `pnpm gen:skills:check`, then `pnpm validate:prompts` -- expected: only the three `SKILL.md` files move; 13 prompts and 13 skills.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run` with `src/__tests__/monitor-gate-helpers.test.ts`, `gate-helper-copies.test.ts`, `prompt-safety-invariants.test.ts`, `story-38-6-qa-edit-prompt-sdk-wire.test.ts`, `story-39-6-qa-forensics-prompts-sdk-wire.test.ts`, `validate-prompts.test.ts`, `skills-generated-frontmatter.test.ts`, `docs-prompt-sync.test.ts`, `story-40-5-doc-claims.test.ts`, `story-40-4-doc-claims.test.ts`, `story-38-6-doc-claims.test.ts`, `changelog-bootstrap-move.test.ts`, `live-gate-roster.test.ts`, `story-39-1-gate-guards.test.ts`, `docs-visibility-roster-sync.test.ts`, `document-write-paths.test.ts` and `tools-list-snapshot.test.ts` -- expected: pass.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-40-5-burn-down-live-gate.test.ts` -- expected: rows 6-7 pass and none is skipped; nothing is left.
- `(loop)` In eight separate calls, `ENV …` for `story-40-1-coverage-live-gate`, `story-40-1-qa-live-gate`, `story-40-2-coverage-reports-live-gate`, `story-40-2-qa-live-gate`, `story-40-3-testproduction-live-gate`, `story-40-3-qa-live-gate`, `epic40-capstone-gate` and `story-40-4-qa-live-gate` (`.test.ts`) -- expected: all pass, with none skipped. Run them in sequence, never two at once.
- `(once)` For shared, dev, admin, interop, ops, data and client-config, one call each for `build`, `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/all test`, split into calls that each finish inside the cap -- expected: green.
- `(once)` One call each: `pnpm gen:governance-baseline:check` (`1e62c5ad5bf7`/141), `pnpm gen:tools-list-snapshot:check` (unchanged) and `node scripts/check-epics-sync.mjs` -- expected: OK.
- `(once)` After every armed run, all of these hold:
  - `leftovers` for `EXECMCPTMP405A` is `[]`;
  - `iris_doc_list` (HSCUSTOM; `Story405`, `Story391Fixture` and `Probe405`, generated included) is empty;
  - `MonitorState` is `{active:0}`, and `^IRIS.TempExecuteMCPv2Coverage("session")` is unset.

**Planned mutations (Rule 19).** Apply each one, observe red, revert, and confirm `git status --short` and `git diff --stat` are unchanged. IRIS-side mutations go on a scratch copy loaded into HSCUSTOM, are restored through the `src/` glob, and are checked as deployed == `src/`. Record each as `mutation: <change> -> <test>`.
- **AC-1:** an unconditional `writeFileSync` → `gen-bootstrap-write` "unchanged run".
- **AC-2:**
  - `UtcStamp` built from `$Horolog` → `TestUtcStampIgnoresProcessTimeZone`;
  - `AlertsManage` back to the inline `$Horolog` stamp → `TestAlertsManageStampsClearedAtInUtc`.
- **AC-3:** `BuildTestSpec` joins with `;:` again (scratch `REST/UnitTest.cls`) → gate row 6 (total 0) and `TestBuildTestSpecPackage`.
- **AC-4:**
  - a column-0 `function monitorState` in `story-40-2-coverage-reports-live-gate.test.ts` → `gate-helper-copies`;
  - `expectMonitorIdle` without its node check → `monitor-gate-helpers.test.ts`.
- **AC-5:** `IsClassName` as an ASCII-only pattern (scratch `Coverage/Job.cls`) → the `ProductionGuardTest` loop (`Pkg.中`, `λPkg.A`).
- **AC-6:**
  - the `Unknown` sentence dropped from the note → dev `prompts.test.ts` and the Story 40.5 block;
  - the recover rule dropped → interop `prompts.test.ts`.
- **AC-7:** `Monitor.cls` edited without regenerating → the `bootstrap.test.ts` drift check.

**Mutation evidence (Rule 19; each applied, observed red, reverted, and the tree checked byte-identical).** IRIS-side mutations were applied to `src/`, loaded into HSCUSTOM through the glob, and restored through the same glob; `shasum` of the four edited `.cls` files before and after matched, and `pnpm gen:bootstrap` then printed unchanged with the embed's mtime untouched.
- mutation: `scripts/gen-bootstrap.mjs` `unchanged` forced false (an unconditional `writeFileSync`) -> `gen-bootstrap-write.test.ts` "an unchanged run leaves the file's mtime and content as they were and says so" red (stdout `Generated ...` did not match `/unchanged/i`) (AC-1)
- mutation: `REST/Monitor.cls` `UtcStamp` defaults to `$Horolog` instead of `$ZTimeStamp` -> OS `EventLogMetricsTest:TestUtcStampIgnoresProcessTimeZone` red (`2026-10-18T19:14:51Z` under zone 420, `2026-10-19T12:14:51Z` under -600), 6 of 7 passed (AC-2)
- mutation: `AlertsManage` renders the key as `cleared_at` (`Do tResult.%Set("cleared_at", ..UtcStamp())`) -> OS `EventLogMetricsTest:TestAlertsManageStampsClearedAtInUtc` red ("clearedAt is set from ..UtcStamp() on the response object"), 6 of 7 passed; the test asserts the exact `Do tResult.%Set("clearedAt", ..UtcStamp())` line and no `horolog` in the method (AC-2)
- mutation: `REST/Monitor.cls` `UtcStamp` ignores `pNow` (`Set pNow = $ZTimeStamp` without the empty check) -> OS `EventLogMetricsTest:TestUtcStampFixedInstant` red (all three fixed instants), 6 of 7 passed (AC-2, row 3)
- mutation: `scripts/gen-bootstrap.mjs` `unchanged` as `existsSync(outPath)` alone (an existing file is never rewritten) -> `gen-bootstrap-write.test.ts` "a changed run rewrites the file, moves its mtime and gives it a new BOOTSTRAP_VERSION" red (stdout `Unchanged ...` did not contain `Generated`), 1 of 2 passed; the test builds its own scratch tree and passes alone with `-t` (AC-1)
- mutation: `monitor-gate-helpers.ts` `releaseLeftoverSession` without its state read before each `StopIfList` -> `monitor-gate-helpers.test.ts` 4 red (no `StopIfList` call when idle; the state read before each call; the first matching set; every set tried once) (AC-4)
- mutation: `monitor-gate-helpers.ts` `expectMonitorInactive` with the ownership-node check added -> `monitor-gate-helpers.test.ts` 2 red ("expectMonitorInactive passes ... whether or not the ownership node is defined", "reads no coverage node") (AC-4)
- mutation: `editAndTestClass.ts` step 9 with the note before the `running` sentence instead of after it -> dev `prompts.test.ts` "edit-and-test-class step 9 ends with the note, after the running sentence ..." red, 1 of 12 failed (AC-6)
- mutation: `REST/UnitTest.cls` `BuildTestSpec` joins with `;:` again -> OS `UnitTestTest:TestBuildTestSpecPackage` red (one colon, no `;:`, membership), and live gate `story-40-5-burn-down-live-gate.test.ts` row 6 red (`{"total":0,"passed":0,...,"details":[]}`: expected 0 to be 3) (AC-3)
- mutation: a column-0 `function monitorState(): void {}` added to `story-40-2-coverage-reports-live-gate.test.ts` -> `gate-helper-copies.test.ts` red, naming `story-40-2-coverage-reports-live-gate.test.ts: monitorState` (AC-4)
- mutation: `monitor-gate-helpers.ts` `expectMonitorIdle` without its ownership-node check -> `monitor-gate-helpers.test.ts` "expectMonitorIdle throws on a defined ownership node, naming the row" red (AC-4)
- mutation: `Coverage/Job.cls` `IsClassName` as the ASCII pattern `pName?1(1"%",1A).AN.(1"."1A.AN)` -> OS `ProductionGuardTest:TestResolveTestNameCheckAgreesWithTheCompiler` red ("so does the guard's name check", "the guard and the compiler agree on 'Pkg.<U+4E2D>' (5 characters)"), 12 of 13 passed (AC-5)
- mutation: the `Unknown` sentence dropped from `PRODUCTION_BUSY_NOTE` -> dev `prompts.test.ts` 3 red (step 4 / step 9 end with the note, the rendered note covers the unreadable state) and `prompt-safety-invariants.test.ts` Story 40.5 block 2 red (identical note and step counts; the `Unknown` sentence) (AC-6)
- mutation: the block rule dropped from `recover-stuck-production` step 3 -> interop `prompts.test.ts` 2 red (step 3 ends with the rule; the ladder around it) and `prompt-safety-invariants.test.ts` "recover-stuck-production step 3 ends with the block rule" red (AC-6)
- mutation: `REST/Monitor.cls` edited (one doc-comment line) without `pnpm gen:bootstrap` -> `bootstrap.test.ts` 2 red ("embedded class contents match disk .cls files" naming `ExecuteMCPv2.REST.Monitor.cls`, and "BOOTSTRAP_VERSION matches SHA-256 hash of concatenated disk contents": `5296a1c836f4` vs `110435d802d2`) (AC-7)

**QA tests (QA).** Run armed, one file per call; the tree was checked byte-identical (`shasum` of every mutated file, `git status --short`) after each mutation. TypeScript mutations were followed by a clean rebuild (dist and `tsconfig.tsbuildinfo` deleted) of the package before the next armed gate.
- (QA) `packages/iris-mcp-all/src/__tests__/story-40-5-qa-live-gate.test.ts` (new; in `gateTestFiles` and in `story-39-1-gate-guards.test.ts` `GATES`). Ten rows on the BUILT dev, admin and interop dists over stdio, in `EXECMCPTMP405Q` (the `Story405Q` package: three test classes, one in a sub-package, plus an abstract test class, a class that is no test and a sibling package `Story405QX`) and the bare `EXECMCPTMP405R` (one `TestProduction` test, defined and not compiled). P1 to P6: the three prompts with `arguments` omitted, empty, required-only and complete, the new sentences present once and ending their steps, names, titles, arguments, descriptions and step counts as listed before, every `iris_*` token real on its server (the edit prompt's also in `core`), `iris_production_logs` takes what recover step 3 passes and advertises `block` and `textPolicy`, a live `Unknown` PRODUCTION_BUSY refusal against the note's branch conditions, and the three `SKILL.md` files against their renders. T1 to T4: the package-level run through `iris_execute_tests`, `POST /tests` and `iris_test_coverage` (six `Test*` methods, the recorded spec `:A;B;C` read from the run record in IRISTEMP, the classes that ran read by hand-written SQL over `%UnitTest_Result`), and the class and method specs. Note: `iris_execute_tests` discovers a package's classes in TypeScript and queues them through the Atelier work queue, so it never calls `BuildTestSpec`; its row (T1) pins the unchanged tool path, and the `BuildTestSpec` fix is pinned by T2 (route) and T3/T4 (coverage tool).
- (QA) `packages/shared/src/__tests__/gen-bootstrap-write.test.ts` (existing; three tests added): an embed hand-edited with its version line intact is written back; a class change and its reversal give back the original embed byte for byte and the run after that is unchanged; the checked-in embed is exactly the generator's output (copied into a scratch tree, so the real file is only read).
- Real process on the real tree: `pnpm gen:bootstrap` printed `Unchanged ... (not rewritten)` with `BOOTSTRAP_VERSION: 5296a1c836f4`; `packages/shared/src/bootstrap-classes.ts` kept mtime 1792376133 and sha1 `a859cb32cbe74255e17da4913faef7716c40c6a1`.
- mutation: `scripts/gen-bootstrap.mjs` `unchanged` compares only the `BOOTSTRAP_VERSION` line of the existing embed -> `gen-bootstrap-write.test.ts` "an embed edited by hand, with its BOOTSTRAP_VERSION line intact, is written back to the generated content" red (stdout `Unchanged`), the other four green (AC-1)
- mutation: `scripts/gen-bootstrap.mjs` header wording changed ("production classes" -> "classes") so its output no longer equals the checked-in embed -> `gen-bootstrap-write.test.ts` "the checked-in embed is exactly what the generator writes ..." red (stdout `Generated`), the other four green (AC-1, AC-7)
- mutation: the `Unknown` sentence dropped from `PRODUCTION_BUSY_NOTE` (dev dist rebuilt) -> `story-40-5-qa-live-gate.test.ts` P1, P2, P4, P5 and P6 red (AC-6)
- mutation: the block rule dropped from `recover-stuck-production` step 3 (interop dist rebuilt) -> `story-40-5-qa-live-gate.test.ts` P3 and P6 red (AC-6)
- mutation: `productionBusyRefusal` labels an unreadable state `Indeterminate` instead of `Unknown` (dev dist rebuilt) -> `story-40-5-qa-live-gate.test.ts` P5 red (the note's `Unknown` branch no longer matches the refusal), nine rows green (AC-6)
- mutation: `discoverPackageTests` queries `packageName` instead of `packageName + "."` (dev dist rebuilt), so `Story405QX.DecoyTest` joins the run -> `story-40-5-qa-live-gate.test.ts` T1 red (`total` 7, expected 6) (AC-3)
- mutation: `BuildTestSpec` joins a package's classes with `;:` again (src loaded into HSCUSTOM through the glob, restored through the glob, `shasum` and `iris_doc_get` of the restored lines match `src/`) -> `story-40-5-qa-live-gate.test.ts` T2 red (`{"total":0,...}`) and T3 red (`no test method ran`); T1 and T4 stay green because `iris_execute_tests` does not call `BuildTestSpec` (AC-3)
- mutation: `BuildTestSpec` class level returns the target without its colon (same load and restore) -> `story-40-5-qa-live-gate.test.ts` T2 red (`total` 0, expected 3) and T4 red (`no test method ran`) (AC-3)
- observation (not a mutation): removing `Abstract = 0` from `discoverPackageTests` leaves T1 green, because the abstract fixture class contributes no result rows with or without the filter; the abstract class stays in the fixture as a boundary the run never reports, and the filter is not claimed as pinned.
- (CR) mutation: a new `__tests__` file that imports `process-gate-helpers.js` and declares a column-0 `function stepsOf` -> `gate-helper-copies.test.ts` red ("a gate declares a copy of a shared helper", naming `zz-cr405-mutation.test.ts: stepsOf`); the file was deleted and the tree checked (AC-4)
- (CR) mutation: `PRODUCTION_BUSY_NOTE` ends with "Check with iris_doc_list." (dev dist rebuilt) -> armed `story-40-5-qa-live-gate.test.ts -t P4` red ("the note added no tool to the edit prompt": received `iris_doc_list`). The source was restored (`shasum` matched), the dev dist and `tsconfig.tsbuildinfo` were deleted and rebuilt, and the full armed gate then passed 10/10 (AC-6)
- observation: `prompts/get` of `recover-stuck-production` with `arguments` omitted is refused as InvalidParams naming the prompt (the SDK's object schema rejects `undefined`; documented in `server-base.ts` as CR 25.1-6, closed-by-decision). P3 accepts either that refusal or the render of an empty `arguments` object and requires the empty object to render, so a future SDK that tolerates the omission stays green.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** All eight ledger entries are resolved.
- DW-591: `scripts/gen-bootstrap.mjs` writes `bootstrap-classes.ts` only when its content differs; the second `pnpm gen:bootstrap` printed `Unchanged` and left the file's mtime (1792376133) as it was.
- DW-589: `Monitor.UtcStamp` builds `clearedAt` from `$ZTimeStamp`; `AlertsManage` uses it. The reset route was never called.
- DW-597: `BuildTestSpec` joins the package's classes as `:A;B;C`, and the `Coverage.TestSpec` rewrite is gone. The new Story 40.5 gate ran the package live in `EXECMCPTMP405A` (3 of 3 passed; class and method levels and the six result keys unchanged).
- DW-603: `monitor-gate-helpers.ts` (`monitorGate`, `sleep`, `MonitorStateJson`) replaces the copies in the six coverage gates and in `testproduction-gate-helpers.ts`. `REPLACED_NAMES` gained the ten moved names.
- DW-607: the `IsClassName` agreement test takes its expected value from `$System.OBJ.IsValidClassname`; `""` is asserted on its own.
- DW-590, DW-609, DW-610: the three prompt texts (decisions #65, #66, #67), with `PRODUCTION_BUSY_NOTE` as one constant. Only the three `SKILL.md` files were regenerated.
- `BOOTSTRAP_VERSION` moves `5024e4623f1d` to `5296a1c836f4` (35 classes), recorded in the new CHANGELOG section; the changeset is `.changeset/story-40-5-epic-40-burn-down.md`.

**Files changed.**
- Generator and embed: `scripts/gen-bootstrap.mjs`, `packages/shared/src/bootstrap-classes.ts` (generated), new `packages/shared/src/__tests__/gen-bootstrap-write.test.ts`.
- IRIS classes: `src/ExecuteMCPv2/REST/Monitor.cls`, `REST/UnitTest.cls`, `REST/Coverage.cls`; tests `Tests/EventLogMetricsTest.cls` (7 tests), `Tests/UnitTestTest.cls` (6), `Tests/ProductionGuardTest.cls` (13).
- Prompts: new `packages/iris-dev-mcp/src/prompts/productionBusyNote.ts`; `deployAndTestClass.ts`, `editAndTestClass.ts`, `packages/iris-interop-mcp/src/prompts/recoverStuckProduction.ts`; the dev and interop `prompts.test.ts`; `skills/{deploy-and-test-class,edit-and-test-class,recover-stuck-production}/SKILL.md` (generated).
- Gates: new `monitor-gate-helpers.ts` and `.test.ts`, new `story-40-5-burn-down-live-gate.test.ts`; `testproduction-gate-helpers.ts`; the 40.1, 40.1 QA, 40.2, 40.2 QA, capstone and 40.4 QA gates; `gate-helper-copies.test.ts`, `story-39-1-gate-guards.test.ts`, `scripts/prepublish-gate.mjs`, `prompt-safety-invariants.test.ts`.
- Docs: `CHANGELOG.md`, root, dev, interop and ops `README.md`, the changeset, new `story-40-5-doc-claims.test.ts`.
- Interpretation applied and reported: AC-7's "40.4 doc pins are unchanged" cannot hold for the one 40.4 pin `expect(index).toBe(0)` (the new Story 40.5 CHANGELOG section must sit above Story 40.4); it was removed in `story-40-4-doc-claims.test.ts`, as the 40.0 to 40.3 doc-claims tests never had it, and every 40.4 literal stays.

**Review findings (pass 1).** 33 findings from four layers: high 0, medium 3, low 24, false 6. Patches applied: 15 rows (6 root causes): the `gen-bootstrap-write` tests build their own scratch tree; the 40.4 position pin; the `AlertsManage` wiring assertion is now the exact `%Set` line; the `iris_*` check runs on the rendered text; a test comment; six more `mutation:` lines. Deferred: none. Rejected: 18 rows, each with its reason in the Review Triage Log (spec-bound golden text, a pinned gate skeleton, a verified-false claim, or a theoretical state).

**Follow-up review recommendation.** `followup_review_recommended: false` (patched entries: 1 medium, 5 low; no high).

**Verification performed (after the last patch unless noted).**
- OS tests, one class per call, totals compared: `EventLogMetricsTest` 7/7, `EventLogMetricsEdgeTest` 3/3, `UnitTestTest` 6/6, `ProductionGuardTest` 13/13, `CoverageJobTest` 31/31; HSCUSTOM `^UnitTestRoot` was `/durable/iris/mgr/` before and after.
- Armed gates, one per call, none skipped: 40.0, 40.0 QA, 40.1 (25), 40.1 QA (12), 40.2 (16), 40.2 QA (26), 40.3 (20), 40.3 QA (17), capstone (8), 40.4 QA (16), 40.5 (2), then `story-39-1-gate-guards` and `gate-helper-copies`. After the patches, `@iris-mcp/all` ran armed in seven chunks: 99 of 99 files passed (3 + 1 pre-existing `skipIf(!changesetPresent)` skips in Stories 39.0 to 39.2).
- Per package (shared, dev, admin, interop, ops, data, client-config): build, test, lint and type-check pass (shared 2068, dev 1662, admin 498, interop 672, ops 350, data 165, client-config 514 tests; one pre-existing lint warning in `shared/src/cli/governance.ts`).
- `gen:governance-baseline:check` OK (frozen keys, 0 new tools), `gen:tools-list-snapshot:check` OK (115 entries), `check-epics-sync` OK, `gen:skills:check` and `validate:prompts` OK (13 prompts, 13 skills); `skills/README.md` unchanged.
- After the armed runs: `iris_doc_list` for `Story405`, `Story391Fixture` and `Probe405` (generated included) is `[]`, and `^IRIS.TempExecuteMCPv2Coverage("session")` is undefined; the gates' own `afterAll` assert `leftovers` `[]` and the monitor idle.

**Residual risks.**
- `ProductionGuardTest`'s oracle (`IsValidClassname`) also rejects a name that differs only in case from an existing class or package, so a namespace holding such a `Pkg` would turn it red without a defect in `IsClassName` (spec-bound; the loop names are the spec's).
- The DW-589 route wiring is pinned by reading `AlertsManage`'s source (the exact `%Set` line, no `horolog`), because the reset clears instance-wide alert state and may not be called; the stamp itself is pinned by value and under real time zones.
- The recover block-rule wording (spec golden text) is not byte-identical to `trace-message-flow` step 5.
