---
title: 'Story 40.4: Test Depth Docs, Prompt and Capstone'
type: 'feature'
created: '2026-10-18'
status: 'ready-for-dev'
baseline_revision: '8f3a00c61c6a42574359d5af40e0d37e9827658d'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
warnings:
  - oversized
  - multiple-goals
deferred: []
---

<intent-contract>

## Intent

**Problem:** Epic 40 shipped line coverage (`iris_test_coverage`, `iris_test_status` `coverageRunId`/`export`, `minCoverage`) and the TestProduction guard, but it has no epic capstone, no closing docs rollup and no agent workflow that offers coverage. `iris_execute_tests` still declares `readOnlyHint`/`idempotentHint` `true` against its `write` classification and its "do not re-submit" contract (DW-498). Two class-source mapping defects remain: a freshly compiled class whose methods hold only `#;`/`#dim` lines reads `not-up-to-date`, a false FAIL, and a stale class whose methods share a 31-character label reads as 0 lines with `line-rate="1"` (DW-601). An initializing `#dim` is dropped from class coverage (DW-602).

**Approach:**
- Fix the two mapping defects with raw data IRIS already has: the class's `$Data(^rMAP(<class>))` and each method's compiled `RtnLabel`. TypeScript keeps the stale rule (AD-12). Refine `IsDirective`.
- Correct the two hints.
- Wrap the three `iris_test_status` paths that can still throw.
- Add an optional coverage step and a `PRODUCTION_BUSY` sentence to the `deploy-and-test-class` prompt, and regenerate the skills.
- Roll up the docs.
- Add the Epic 40 capstone gate. It runs the built servers over the wire and is proven red by removing the IRIS-side monitor guard.

## Boundaries & Constraints

**Always:**

- **DW-601, IRIS side (`Coverage/Job.cls`, bootstrapped; AD-12 raw data).**
  - `SourceMap`'s class head on the mapped path becomes `$ListBuild(class, "", lineMap)`, where `lineMap` is `$Data(^rMAP(<class>))` read in the target namespace: 10 fresh, 0 after a documentation-only save (probe).
  - The `not-compiled` and `not-up-to-date` heads keep their two elements.
  - A method's `labelLine` is the line of its compiled label, `$$$comMemberKeyGet(class, $$$cCLASSmethod, name, $$$cMETHrtnlabel)` (`label^routine`), in that routine's INT text.
    - It is 0 when the value is not `label^routine` (an inlined constant gives `-2:Int:3`; a Python method has none), when the label is not found, or when the method's mapped `routine` is another routine.
    - The guessed shortened-name lookup and its `pShared` collision count are removed. `IndexLabels` keys labels by routine.
  - `REST/Coverage.cls` `BuildSources` emits `lineMap` (a number) only when the stored head has a third element. That is additive (AD-33); older run records are emitted unchanged.
- **DW-601, TypeScript (`coverage-report.ts`, AD-12 rule).** `SourceClassRaw` gains an optional `lineMap`. When it is present, the class is `not-up-to-date` exactly when `lineMap === 0` and some method with no `reason` and with `intLines` has `labelLine > 0`. When it is absent (an older record), today's shape rule (`lineMapIsGone`) runs unchanged. A class with only constant or Python methods stays without a reason.
- **DW-602 (`IsDirective`).** A `#dim` line (any letter case) that holds an `=` outside parentheses and string literals is not a preprocessor line, so `MapMethod` keeps `INTLine`'s line for it. It compiles to a `Set` at its own INT line (probe: leading, mid-body, nested, after four or six leading `#dim` lines, multi-variable, no type, `"a=b"` value). Every other directive stays 0, because the leading ones map onto other methods' code (probe).
- **DW-498 (`execute.ts`, sanctioned AD-15 annotation correction).** `readOnlyHint` and `idempotentHint` become `false`. The key, its classification, its description and the frozen baseline do not change. `destructiveHint` and `openWorldHint` stay `false` (orchestrator decision 2).
- **`iris_test_status` `structuredContent` (AC 40.4.3).** Every path that returns a result already sets it (Design Notes, evidence). The three `resolveByRunIndex` calls with no catch (`test-status.ts:270`, `:297`, `:412`) gain an `isIrisError` catch that returns `testRunEnvelope({kind:"error", ...})` with the handles the caller holds and the texts in Design Notes. A non-IRIS error still rethrows.
- **Prompt (AD-28; AD-15 prompt-body change, orchestrator decision 1).**
  - `deploy-and-test-class` keeps its name, title and arguments (`classOrPackage` only).
  - Its description gains one clause, and its body gains a `PRODUCTION_BUSY` sentence in step 4 and a new optional step 8 for coverage. The old step 8, Report, becomes step 9. Step 2 keeps its number.
  - The text is the golden text in Design Notes.
  - It names only dev-server tools and no repository path, rule number or AD id.
  - `skills/` is regenerated with `pnpm gen:skills`, never by hand.
- **Docs (Rule #30/#43: enrich, do not first-document).** Each default is stated where it is used:
  - `iris_test_coverage`: write, DEFAULT-DISABLED;
  - `iris_test_status:poll`: read, enabled;
  - `:cancel` and `:export`: write, DEFAULT-DISABLED;
  - `minCoverage` omitted means no verdict;
  - the enable recipe is `IRIS_GOVERNANCE`.

  Pinned sentences are edited only where they are wrong, and their pins move with them. The CHANGELOG section quotes no other section's title and holds no roster-summary string.
- **Capstone (Rule #21, AD-2 / Live gates convention).**
  - `packages/iris-mcp-all/src/__tests__/epic40-capstone-gate.test.ts`, in the default suite and in `gateTestFiles`, on the 40.x gate skeleton that `story-39-1-gate-guards.test.ts` checks.
  - It drives the built dev and admin dists (admin creates the namespace).
  - It writes only `EXECMCPTMP402C` (database files included), the `Story402.*` and `Story404.*` classes in it, a temporary directory, and `ExecuteMCPv2.Temp.Story391Fixture` in HSCUSTOM. It removes all of them and asserts that nothing is left.
  - It follows the 40.x monitor discipline: idle before each row, idle with no ownership node after each row, `StopIfList` as the safety net, and it never touches a session it did not start.
- **Bootstrap (AD-14).** Run `pnpm gen:bootstrap` twice (the second run must be idempotent) and rebuild shared. Record `BOOTSTRAP_VERSION` `845e95f6e726` → new in the CHANGELOG as the newest move. The class count stays at 35.
- **Text.** Source is ASCII, with escapes (Rule 14). Comments state the contract. Every value an expectation pins is captured live (Rule #36).

**Never:**

- No new tool, action, governance key, preset row, `TOOL_PAIRS` entry, refusal code, prompt, environment variable or route.
  - These counts do not move: dev 32 package tools (33 advertised); suite 110 (115); dev `core` 14 (15 runtime); `developer` 32 (33); 13 prompts (dev 5); 10 refusal codes; baseline `1e62c5ad5bf7`/141.
- No change to any tool description, so the tools-list snapshot moves only in `iris_execute_tests`' annotations.
- No change to the monitor ownership, busy, release or reclaim logic, or to the TestProduction guard. The red-proof mutation is a temporary scratch load, restored and verified.
- No suite code starts a production. The capstone runs no TestProduction test (orchestrator decision 3).
- No edit of `irislib/`/`irissys/`, of generated files by hand, or of the frozen baseline. The governance check is `:check` only. No `changeset version` and no publish.
- No HSCUSTOM global write, and no session, production or namespace that the story did not create.

## I/O & Edge-Case Matrix

**Fixtures.**

- **`EXECMCPTMP402C`** is created with `createInteropNamespace(admin, dev, name, {interop:false})`.
  - The 40.2 report fixture is seeded with `seedReportFixture`, used verbatim. Its seed accepts any `EXECMCPTMP402<letter>`.
  - A new `Story404` source-map fixture is seeded with `seedSourceMapFixture`:
    - `Story404.Dim`: initializing `#dim` lines, leading, mid-body, nested in a block, after four and after six leading non-initializing `#dim` lines, `#DIM` in capitals, multi-variable, no type, and a value holding `"a=b"`;
    - `Story404.Hooks`: methods whose bodies are only `#;` or non-initializing `#dim` lines;
    - `Story404.Long`: two methods whose names share their first 31 characters, plus a short one;
    - `Story404.Stale`: two methods sharing 31 characters, compiled and then saved with a documentation-only edit;
    - `Story404.FixtureTest`: calls every method of the four classes, and every test passes.
- **"Idle"** means `MonitorState` `{active:0}` and `^IRIS.TempExecuteMCPv2Coverage("session")` unset.
- **Values** marked *live* are captured by the implement stage (Rule #36). The others are pinned 40.2 constants (`STORY402_FIXTURE_SOURCE_VALUES`, `STORY402_LAYOUT_SOURCE_VALUES`).

| # | Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|---|
| 1 | Wire surfaces (capstone) | Built dev, with governance enabling `iris_test_coverage` and `iris_test_status:export`: `listTools`; `getPrompt({name:"deploy-and-test-class", arguments:{classOrPackage:"Story402.FixtureTest"}})` | `iris_execute_tests` annotations deep-equal `{readOnlyHint:false, destructiveHint:false, idempotentHint:false, openWorldHint:false}`. Both coverage tools are listed. The rendered text has step 8 with `iris_test_coverage`, `GOVERNANCE_DISABLED`, `MONITOR_BUSY`, `coverageRunId` and "do NOT re-submit", and step 4's `PRODUCTION_BUSY` sentence | None |
| 2 | Summary and verdict (capstone) | Idle; `iris_test_coverage {target:"Story402.FixtureTest", level:"class", classes:["Story402.Fixture","Story402.Layout"], minCoverage:50, namespace:C}` (a `running` result is polled by `coverageRunId`) | `completed`, `isError` false. Per-class `source` equals the 40.2 constants (generated covered count unpinned). `coverage.source` is `{executableLines:27, coveredLines:24, percent:88.89}`. `verdict` is `{minCoverage:50, overall:"pass", percent:88.89, classes:[Fixture pass 95.65, Layout pass 50]}`. Idle after | None |
| 3 | Re-attach (AD-16) | `iris_test_status {action:"poll", coverageRunId}` of row 2 | Its `coverage` deep-equals row 2's | None |
| 4 | Cobertura | `iris_test_status {action:"export", coverageRunId, outputPath:<tmp>/epic40.xml}` | `cobertura` is `{outputPath, bytes, classes:2, lines:27}`. `validateCobertura(file)` is `[]`. Its classes and lines read back equal row 2's summary | None |
| 5 | DW-602 (capstone) | `iris_test_coverage {target:"Story404.FixtureTest", level:"class", classes:["Story404.Dim","Story404.Hooks","Story404.Long","Story404.Stale"], minCoverage:50}` | Every initializing `#dim` line of `Story404.Dim` is an executable, covered class line at its own line. No other directive line is reported. Per-method values *live* | None |
| 6 | DW-601 fresh (Integration) | Row 5's run | `Story404.Hooks` has no `source.reason`, 0 executable class lines, and verdict `notApplicable`. Both long-name methods of `Story404.Long` report their lines (*live*); raw Status `labelLine`s are > 0 and distinct, and `lineMap` is 10 | None |
| 7 | DW-601 stale and the 31-character case | Row 5's run, then export | `Story404.Stale` is `source.reason:"not-up-to-date"`, verdict `fail`, `overall:"fail"`, and `isError` stays false. Its raw `lineMap` is 0. The exported file validates and has no `Story404.Stale` class element, so the stale class is never written as a 0-line class at `line-rate="1"` | None |
| 8 | Pre-started foreign session (AC 40.4.4) | Idle; fixture `StartForeign` returns `started:<pid>`; row 2's call | `isError:true`, `structuredContent` `{code:"MONITOR_BUSY", owner:"foreign", ...}`; text has "nothing was started" and "left untouched". The foreign session is still active with the same pids, and the `seq` counter is unchanged. `StopIfList` returns `stopped`; idle after | Refusal |
| 9 | Stale rule (unit) | `mapSources` records: `lineMap:10` with `[0]` and `labelLine:7`; `lineMap:0` with `labelLine:5`; `lineMap:0` with only `labelLine:0` or reasons; a record with no `lineMap` | No reason; `not-up-to-date`; no reason; today's rule (the existing tests unchanged) | None |
| 10 | Thrown status paths (unit) | Mocked SQL failing with `IrisApiError` 500: poll by `runIndex` alone; poll whose `GET /work` is 404 with a known index; cancel whose `DELETE` is 404 with a captured index | Each is `isError:true` with `structuredContent` `{error, ...handles}` and the Design Notes text; none rejects. A non-IRIS `Error` still rejects | Error envelope |
| 11 | Map raw data (OS) | Disposable `ExecuteMCPv2.Temp.Story404*` classes compiled in HSCUSTOM | Head `$lb(class,"",10)`, and `$lb(class,"",0)` after a documentation-only save. Exact distinct labels for the shared-prefix pair. 0 for an inlined constant. Every DW-602 shape maps at its own `Set`. `IsDirective` cases (Design Notes) | None |
| 12 | Hint cross-check (unit) | Every write-classified key: baseline, or post-foundation `mutates:"write"` | No owning tool declares `readOnlyHint:true` (no allowlist) | None |

</intent-contract>

## Code Map

**IRIS side** (bootstrapped; `scripts/gen-bootstrap.mjs:27` `Coverage/Job.cls`, `:48` `REST/Coverage.cls`)
- `src/ExecuteMCPv2/Coverage/Job.cls`:
  - `SourceMap` :631-677 (the doc comment at :599-630 states the head and `labelLine` contract, so rewrite it);
  - `IndexLabels` :697-707;
  - `LabelLine` :714-721 (signature change, `pShared` removed);
  - `IsDirective` :753-757;
  - `MapMethod` :761-795 (the `IsDirective` call :787, the `LabelLine` call :794);
  - the Finish path that stores `sources` :1057-1071 (unchanged; it merges the new head).
- `src/ExecuteMCPv2/REST/Coverage.cls` `BuildSources` :560-606: emit `lineMap`, and update its doc comment. `Launch` :349-420, with the `busy-foreign` branch at :369-372, is the red-proof site. It is not edited in source.
- System source, read-only:
  - `irislib/%occKeyword.inc:263` `cMETHrtnlabel 43`;
  - `irislib/%occReference.inc:116` `comMemberKeyGet`;
  - `irislib/%Library/RoutineMgr.cls:843-844` (the one IRIS consumer of `RtnLabel`);
  - `irislib/%Studio/Debugger.cls:944-961` (`INTLine` reads `^rMAP(name,"CLS","INT",...)`);
  - `irislib/%Library/Routine.cls:1245-1247` (`^rMAP` is the debug map).
- OS tests:
  - `src/ExecuteMCPv2/Tests/CoverageLabelTest.cls` (84 lines; new tests go here);
  - `CoverageSourceTest.cls` (494 lines: only the head pins at :43, :84, :91, :135 and `TestLabelLine` :176-198 change; keep it ≤ ~500);
  - `CoverageJobTest.cls` (500 lines, untouched, run for regression).

**TypeScript, dev** (`packages/iris-dev-mcp/src/`)
- `tools/coverage-report.ts`: `lineMapIsGone` :98-106 and its use at :146.
- `tools/test-coverage.ts`: `SourceClassRaw` :130-140 gains `lineMap?: number`, with its doc comment.
- `tools/execute.ts`: annotations :1299-1304.
- `tools/test-status.ts`: `resolveByRunIndex` :210-251; the uncaught calls at :270, :297 and :412. Precedent texts: :300 and :358-371 (poll), :416 (cancel).
- `prompts/deployAndTestClass.ts`: the whole file (43 lines), including its contract header comment.
- Tests:
  - `__tests__/coverage-report.test.ts` (the "line map is gone" block :319-405 stays and passes unchanged; add the `lineMap` cases);
  - `__tests__/test-status.test.ts` (row 10);
  - `__tests__/execute.test.ts:1608-1615` (the annotation pin and its title);
  - `__tests__/story402-run.ts` (a captured older record with no `lineMap`: leave it as is, since it pins the fallback).

**TypeScript, shared:** `packages/shared/src/__tests__/baseline-classifications-safety.test.ts`, the title at :94 and the header comment at :24-28 (assertions unchanged); `bootstrap-classes.ts`, regenerated.

**iris-mcp-all** (`packages/iris-mcp-all/`)
- New gate: `src/__tests__/epic40-capstone-gate.test.ts`.
  - Skeleton: `epic39-capstone-gate.test.ts:314-335`, with the 40.x governance env.
  - Row 8 template: `story-40-1-coverage-live-gate.test.ts:1017-1053`.
  - Rows 2 and 4 templates: `story-40-2-coverage-reports-live-gate.test.ts:419-461`, `:540-560` and `:693-736` (`coberturaClasses` :643).
  - Helpers: `process-gate-helpers.ts` (`openWireSession`, `assertDeployedBootstrapVersion`, `docFixtures`, `rawIrisRequest`, `skipTest`, `teardownRecorder`, `staleDistReason`, `allText`, `fixtureDocumentNames`) and `interop-namespace-fixture.ts` (`putFixtureClass`, `createInteropNamespace`, `removeInteropNamespace`, `leftovers`, and the fixture methods `MonitorState`, `StartForeign`, `StopIfList`).
  - `scripts/lib/cobertura-dtd.mjs` (`parseXml`, `validateCobertura`).
- `src/__tests__/coverage-fixture.ts`: add a Story 40.4 section with the `STORY404_*` sources, `STORY404_DOCUMENTS`, the documentation-only edit of `Story404.Stale`, the *live* expected values, and `seedSourceMapFixture(dev, name)`. It uses `assertCoverageFixtureName` and `docFixtures` put/compile; no seed class is needed. Update the header :1-13.
- `src/__tests__/interop-namespace-fixture.test.ts`: a case pinning that `seedSourceMapFixture` refuses a non-fixture name before any call (pattern :276-302).
- `src/__tests__/readonly-hint-crosscheck.test.ts`: a third `it` (row 12), on the derivation pattern at :100-130.
- `src/__tests__/prompt-safety-invariants.test.ts`:
  - :430-448: add `iris_test_coverage` to the deploy prompt's allowed set, plus the control `core.has("iris_test_coverage") === false`;
  - a Story 40.4 block pinning the step-8 and step-4 invariants. The forbidden patterns at :450-455 still apply.
- `src/__tests__/story-38-6-qa-edit-prompt-sdk-wire.test.ts`: :198-199 (arguments unchanged) and :282-296 (step 2) must stay green; :327-346 checks every deploy token against the dev `tools/list`.
- `src/__tests__/test-status-governance-keys.test.ts:114`: becomes `readOnlyHint: false`, with its message.
- `src/__tests__/story-40-3-doc-claims.test.ts`: :67 (the README annotations cell) and :184 and :236 (the "stays a read" wording).
- `src/__tests__/story-40-2-doc-claims.test.ts`: :98 and :218 (the `#dim` sentences).
- `src/__tests__/story-40-2-qa-live-gate.test.ts`: QA-15a :1877-1880 and any other raw-source deep-equal gains `lineMap` (search for `labelLine:`).
- Gates whose header or `gateTestFiles` comment says "the only gates that start Line-by-Line sessions" (prose only; no pin): the six 40.1–40.3 gates.
- Rosters:
  - `scripts/prepublish-gate.mjs` `gateTestFiles` :105-261: the capstone entry, with a comment naming it the seventh gate that starts sessions;
  - `src/__tests__/story-39-1-gate-guards.test.ts` `GATES` :52-81: `{file:"epic40-capstone-gate.test.ts", tag:"epic40-capstone-gate", story:"Epic 40 capstone"}`.
- New `src/__tests__/story-40-4-doc-claims.test.ts`, on the `story-39-6-doc-claims.test.ts` pattern.
- `src/__tests__/fixtures/tools-list-snapshot.json`: regenerated with `--force` (entry :2743).

**Generated and docs**
- `skills/deploy-and-test-class/SKILL.md` and `skills/README.md` (row :26), both through `pnpm gen:skills`.
- `packages/iris-dev-mcp/README.md`:
  - intro :3;
  - the `iris_execute_tests` row :223 (`readOnly, idempotent` becomes `--`);
  - the `iris_test_status` entry title :1708 and its intro :1710;
  - the coverage entry :1838-1967 (title, an at-a-glance defaults paragraph, the `minCoverage` default near :1947, the `#dim` sentence :1930, and a CI recipe);
  - the Prompts row :268.
- Root `README.md`: a new `### Test coverage (Epic 40)` between the forensics section (:490-508) and `### Worked example` (:510); the prompts row :794; the payload rows :710-722.
- `tool_support.md`: the "stays a read" wording at :222, and a Story 40.4 note after it.
- `CHANGELOG.md`: a new top section; the 40.2 `#dim` sentence at :105 and the 40.3 "stays a read" sentence at :32 are corrected in place.
- `.changeset/story-40-4-test-depth-docs-prompt-and-capstone.md`.

## Tasks & Acceptance

**Execution:**

1. `src/ExecuteMCPv2/Coverage/Job.cls`: make `SourceMap`, `IndexLabels`, `LabelLine`, `IsDirective` and `MapMethod` behave exactly as the Boundaries say (DW-601, DW-602), and rewrite their doc comments to state the new contract.
2. `src/ExecuteMCPv2/REST/Coverage.cls`: `BuildSources` emits `lineMap`; update its comment.
3. OS tests:
   - `CoverageLabelTest.cls` gains the `IsDirective` cases, the `lineMap` 10→0 test, the exact-label test (rewriting `TestSourceMapOfMethodsThatShareAShortenedName`) and the DW-602 shapes. Each compiles its own `ExecuteMCPv2.Temp.Story404*` class and deletes it in `OnAfterOneTest`.
   - `CoverageSourceTest.cls` gets its head pins and `TestLabelLine` updated.
   - Load and compile through `iris_doc_load` globs.
4. `pnpm gen:bootstrap` twice; then rebuild shared (DW-591).
5. `packages/iris-dev-mcp/src/tools/test-coverage.ts` and `coverage-report.ts`: `lineMap` and the stale rule. `coverage-report.test.ts`: matrix row 9.
6. `packages/iris-dev-mcp/src/tools/execute.ts`: the two hints. Move `execute.test.ts:1608-1615`, `test-status-governance-keys.test.ts:114`, and the `baseline-classifications-safety.test.ts` title and header.
7. `packages/iris-dev-mcp/src/tools/test-status.ts`: the three catches. `test-status.test.ts`: matrix row 10.
8. `packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts`: the golden text. Then `pnpm gen:skills`, `pnpm gen:skills:check` and `pnpm validate:prompts`. Update the prompt pins in `prompt-safety-invariants.test.ts`.
9. iris-mcp-all:
   - the `coverage-fixture.ts` Story 40.4 section and its fixture-test case;
   - the capstone gate, rows 1-8, each row self-contained. `afterAll` releases with `StopIfList` (the foreign and the suite routines), removes `EXECMCPTMP402C` and the fixture class, and asserts `leftovers` `[]`, `iris_doc_list` (HSCUSTOM, `Story391Fixture`, generated included) empty, and idle;
   - `readonly-hint-crosscheck.test.ts` row 12;
   - the rosters and the session-count comments;
   - the 40.2 QA raw pins.
10. Docs:
    - the dev README items (Code Map);
    - the root README `### Test coverage (Epic 40)` section: the loop, a Key / What it does / Default state table, the guards (with no new line starting `` | `MONITOR_BUSY` `` or `` | `PRODUCTION_BUSY` ``, and no "8- to 15-tool" text), the `minCoverage` default, the export path rules, the presets (`developer` shows both tools; `core` hides them), and the prompt bullet;
    - `tool_support.md`;
    - the CHANGELOG section `## [Pre-release — 2026-10-18] — Story 40.4: Test depth docs, prompt and capstone`. It holds: the counts paragraph (no tool count moves, with the counts in Never); the `BOOTSTRAP_VERSION` move; Changed (the DW-498 hints, sanctioned AD-15; the prompt, orchestrator decision 1); Fixed (DW-601, DW-602 and the status paths); Documentation; Tests (the capstone); the snapshot regeneration (decision #29); and the earliest version verified;
    - the changeset (`"@iris-mcp/dev": patch`, `"@iris-mcp/shared": patch`);
    - `story-40-4-doc-claims.test.ts`, plus the moved 40.2 and 40.3 pins.
11. Build every package. Then `pnpm gen:tools-list-snapshot --force` and `:check`; `pnpm measure:tools-payload`, with the README rows and "Last re-measured at Story 40.4" equal to it.

**Acceptance Criteria:**

- **AC-1 (40.4.1).**
  - **Given** the docs, **when** `story-40-4-doc-claims.test.ts` and the moved 40.1–40.3 pins run, **then**:
    - the dev README, the root README and `tool_support.md` state each default where it is used (coverage tool; poll, cancel and export keys; `minCoverage` omitted means no verdict; `iris_execute_tests` enabled and classified write) and the enable recipe;
    - the `#dim` sentence names the initializing exception;
    - the CHANGELOG section and the changeset exist as Task 10 says.
- **AC-2 (40.4.2).**
  - **Given** the built dev server, **when** `deploy-and-test-class` is listed and rendered (matrix row 1, the prompt pins, the SDK-wire test), **then**:
    - its name, title and arguments are unchanged, and step 2 is unchanged;
    - step 8 copes with a hidden tool, `GOVERNANCE_DISABLED`, `MONITOR_BUSY`, `PRODUCTION_BUSY` and `running`;
    - every `iris_*` token is a dev tool;
    - `gen:skills:check` and `validate:prompts` pass.
- **AC-3 (DW-498).**
  - **Given** the built servers, **when** `tools/list` is read (row 1, the regenerated snapshot) and row 12 runs, **then**:
    - `iris_execute_tests`' hints are `false`/`false`/`false`/`false`;
    - the snapshot differs only there;
    - no write-classified key's tool declares `readOnlyHint:true`;
    - `gen:governance-baseline:check` reports `1e62c5ad5bf7`/141.
- **AC-4 (40.4.3, structuredContent).**
  - **Given** row 10, **when** each path's SQL read fails, **then** the result is an error envelope with `structuredContent`, and every other path is unchanged (the existing `test-status*.test.ts` files pass).
- **AC-5 (40.4.4, capstone; Integration AC).**
  - **Given** the armed capstone, **when** it runs rows 1-8 against the built dists, **then** each row holds and nothing is left.
  - **Given** a scratch copy of `REST/Coverage.cls` without its `busy-foreign` branch loaded into HSCUSTOM, **when** row 8 runs, **then** it goes red: a run id is allocated and the run fails with `ERROR #6062`. The foreign session is still active, and is released by `StopIfList`. The class is restored and verified.
- **AC-6 (DW-601).**
  - **Given** rows 6, 7, 9 and 11, **when** the run and the unit tests execute, **then**:
    - a fresh directive-only class is not `not-up-to-date`;
    - a documentation-edited class is, including one whose methods share a 31-character label;
    - a constant/Python-only class is not;
    - an older record keeps today's rule.
- **AC-7 (DW-602).**
  - **Given** rows 5 and 11, **when** they run, **then** every initializing `#dim` is an executable class line at its own line, and every other directive line is 0.
- **AC-8 (AD-15 / AD-33 back-compat).**
  - **Given** the existing suites (`coverage-report`, `cobertura`, `test-coverage*`, `test-status*`, and the 40.1–40.3 gates and their QA gates, armed), **when** they run, **then**:
    - they pass, with only the pins listed under Shared surfaces moved;
    - the raw Status record of a run carries every earlier field, plus `lineMap` on mapped classes;
    - the 40.2 constants are reproduced both in `EXECMCPTMP402A` (the 40.2 gate) and in `EXECMCPTMP402C` (capstone row 2).
- **AC-9 (bootstrap).**
  - **Given** `pnpm gen:bootstrap`, **when** it runs twice, **then** the second run changes nothing, `changelog-bootstrap-move.test.ts` passes, and the gates' deployed-version assertions pass.

## Spec Change Log

- **2026-10-18, lead spec gate.** Decisions #62, #63 and #64 were taken as recommended. Spine amended (Rule 20):
  - AD-4's known divergences drop `iris_execute_tests` (DW-498 is corrected here);
  - the Deferred bullet on annotation divergences notes the closure;
  - AD-15's sanctioned list gains a Story 40.4 bullet (the annotation correction and the `deploy-and-test-class` prompt change).

## Review Triage Log

## Design Notes

**Orchestrator decisions needed** (the Lead's calls, delegated). This plan follows each recommendation.

1. **DECIDED (orchestrator decision #62, 2026-10-18, as recommended): sanction the `deploy-and-test-class` prompt change (AD-15 binds prompts; the sanctioned list does not name it) — recommended: yes.** The change:
   - a new optional step 8 for coverage, run only when the user asks;
   - a `PRODUCTION_BUSY` sentence in step 4;
   - one clause on the description;
   - no new argument, with name, title and arguments unchanged.

   Evidence:
   - AC 40.4.2 asks for the step.
   - The epic context says it must cope with a hidden or disabled coverage tool. `iris_test_coverage` is outside `core` and default-disabled.
   - Spec 40.3 left the `PRODUCTION_BUSY` sentence to 40.4.
   - Without the description clause, the generated skill's model-invocation description never mentions coverage, so a coverage request does not route to the skill.
   - A new argument would move the arguments pin (`story-38-6-qa…:198-199`) and add AD-15 surface for no gain: the skill form has no arguments.
   - Alternatives: (a) a `minCoverage` argument; (b) leave the description as it is.
   - Spine follow-up: AD-15's sanctioned list gains a Story 40.4 bullet.
2. **DECIDED (orchestrator decision #63, 2026-10-18, as recommended): the scope of the `iris_execute_tests` annotation correction — recommended: flip `readOnlyHint` and `idempotentHint` to `false` only; `destructiveHint` and `openWorldHint` stay `false`.** Evidence:
   - AC 40.4.3 and DW-498 name only those two hints.
   - Spine AD-4's known-divergence list names only `readOnlyHint` for this tool, and accepts `destructiveHint:false` for the code-running `iris_execute_command`.
   - The tool's own writes (result rows, `^UnitTestRoot`) are additive. What test code does is the user's code, the same reasoning that applies to `iris_execute_command`.
   - No runtime reads the hints. `server-base.ts:1185-1190` only passes them to the SDK, and the `read-only` preset uses classifications.
   - Alternative: `destructiveHint:true`, matching `iris_test_coverage`, because TestProduction tests stop and restart their own production. That is a wider AD-15 change and a new divergence line in AD-4.
   - Spine follow-up: AD-4's "Known divergences" drops the DW-498 item, and the Deferred bullet "Annotation divergences of existing tools" is updated.
3. **DECIDED (orchestrator decision #64, 2026-10-18, as recommended): does the capstone also cover the TestProduction guard? — recommended: no.** Evidence:
   - AC 40.4.4 names only the monitor refusal.
   - `PRODUCTION_BUSY` is already pinned end to end on the coverage path: 40.3 gate rows 10, 11 and 14d, and QA Q5a–d.
   - Every capstone `Start` still passes through `ProductionGuard` (`Coverage.cls:302`). A plain target proceeds without reading Ens state.
   - Covering it would need an interop-mapped namespace, the IRISSYS `InstalledNamespace` node, started productions on the shared instance, and about 6 s per run.
   - Alternative: a capstone leg in an `EXECMCPTMP403<letter>` namespace through `testproduction-fixture.ts`.

**AC interpretations** (apply and report):

- **AC 40.4.1, "the `coverage` option".** This is the separate tool `iris_test_coverage` (decision #39). "The Cobertura path" is `iris_test_status:export` with `outputPath` (decision #50). "The targets" is `minCoverage`. Each is already documented (Rule #43), so this story enriches: defaults at every point of use, the CI recipe, the `minCoverage` default, stale titles, and an Epic 40 section in the root README.
- **AC 40.4.2, "optional".** The step runs only on the user's request, and it says what to do when the tool is hidden or refused.
- **AC 40.4.3, "`iris_test_status` returns `structuredContent`".** Every returned path already does (evidence below). The research claim came from a text search for the word in `test-status.ts`. The three paths that can still throw get the envelope.
- **AC 40.4.4, "a pre-started monitor session".** This is the fixture's `StartForeign` session on its own disposable routine, so the refusal is `owner:"foreign"`. "Removing the guard" is the `busy-foreign` branch of `Launch`, the IRIS-side guard on the path the tool takes (Rule #59). It is safe: a second `Start` returns `ERROR #6062` (40.1 probe, spec 40.1 :750), the runner calls no `Stop` after a failed `Start` (`Runner.cls:37-41`, 40.1 row 12), and the supervisor stops only a session it proves is its own (`Job.cls` `ProveOwnSession`).
- **DW-601/602 change coverage values of `iris_test_coverage`.** That tool was added in this epic and has not been released (every section is Pre-release). This completes AC 40.2.1's mapping rule and is named under CHANGELOG "Fixed", not as an AD-15 sanction. The Status route only gains `lineMap`; `labelLine` and `intLines` values become exact (AD-33: a superset, with corrected raw values that only this suite reads).
- **Capstone namespace `EXECMCPTMP402C`.** The 40.2 report fixture is reused verbatim (Rule 2; the `coverage-fixture.ts` header already plans it for "the Epic 40 capstone"). Its seed and `assertCoverageFixtureName` accept only `EXECMCPTMP401`/`402<letter>`. A 404 name would change pinned seed source (`interop-namespace-fixture.test.ts:286`).

**Probe evidence** (IRIS 2026.2 build 221U, `default` localhost:52773, HSCUSTOM, 2026-10-18 22:20–22:33). The disposable classes were `ExecuteMCPv2.Temp.Probe404A`–`J`; all were deleted and no session was started.

- **Fresh directive-only class** (`Probe404B`: `OnHook` with `#;`, `Declared` with `#dim tX As %Integer`):
  - `$Data(^rMAP(class))=10`, `IsUpToDate` 1;
  - `RtnLabel` `OnHook^…B.1` (line 7) and `Declared^…B.1` (line 5);
  - the directive lines map, type 0, to INT lines 5 and 3, at or before the labels;
  - the deployed `SourceMap` gives `[0]` with labels 7 and 5, so the shipped TypeScript rule reads `not-up-to-date`. DW-601 is reproduced.
- **After a documentation-only save** (no compile), B, D, E and F give:
  - `IsUpToDate` 1, `$Data(^rMAP)=0`;
  - every `INTLine` of type 2;
  - `RtnLabel` and the INT text unchanged.
- **The other shapes:**
  - A constant/Python-only class (`E`) has `$Data(^rMAP)=0` even when freshly compiled, with `RtnLabel` `-2:Int:3` (inlined constant) and undefined (Python). A generator-only class (`G`) has 10, and `Gen^…G.1` at line 5.
  - An empty-body-only class (`F`) has 10 and `Empty^…F.1` at line 5. Expression and call methods (`H`) have 10 and labels.
  - A class mapped from another database (`Ens.Director`) shows its `^rMAP` from HSCUSTOM.
- **The 31-character case** (`Probe404D`):
  - `RtnLabel` `AVeryLongMethodNameThatExceedsT^…D.1` (line 5) and `AVeryLongMethodNameThatExceeds2^…D.1` (line 8);
  - the deployed map gives both `labelLine` 0;
  - after a documentation-only save, the deployed map reads every method 0 with `Empty`'s label 11, `[]`, so today's rule finds no proof. The class reads as 0 lines, which is the `line-rate="1"` residual.
- **DW-602** (`Probe404C`, `I`, `J`): every initializing `#dim` maps, type 0, to its own INT `Set`:
  - `#dim tSC As %Status = $$$OK` gives `Set tSC=1`;
  - `#dim tA, tB As %Integer = 0` gives `Set (tA, tB)=0`;
  - `#dim tN = 5`, `#dim tQ As %String = "a=b"` and `#DIM tN As %Integer = 7` all map to their own `Set`;
  - the same holds after four and after six leading `#dim` lines, after `#;`, and nested in an `If` block.

  The deployed map records them as 0, which reproduces DW-602. Non-initializing lines either are type 1 (mid-body) or map onto other code: the previous method's lines, the method's own `Set`, and even the next method's label line (`AfterSix` lines 4–6 give INT 10, 11 and 12). So the text rule must keep them 0.
- `#dim tS As %String(MAXLEN=5)` does not compile (`ERROR #1025`), so a parenthesized `=` cannot reach a map. The parentheses clause is robustness only.
- **Annotations.** A scratch script over the built dists found exactly one write-classified key (baseline or `mutates`) whose tool declares `readOnlyHint:true`: `iris_execute_tests`.

**`iris_test_status` `structuredContent` evidence.**

- Every `return` builds through `testRunEnvelope` (`execute.ts:653`, which sets `structuredContent` for all six kinds) or `coverageErrorResult`/`coverageRunEnvelope` (`test-coverage.ts:563-568`, :465-557).
- Existing pins include `test-status.test.ts:211, :245, :494, :785`, `test-status-export.test.ts:74`, and the live `test-status-epic-gate.test.ts:203`.
- The only results without it are thrown errors that `server-base.ts:1642-1649` turns into `Tool error: …`. `runSqlQuery` throws on an HTTP failure.

**Error texts** (row 10; the `<what happened>. <what to do>.` form):

- **Poll, `runIndex` alone:** `Reading the result of runIndex <n> from %UnitTest_Result failed: <message>. Poll again with runIndex <n>; do NOT re-submit the tests.` Handles: `{runIndex}`.
- **Poll, 404 fallback:** `Atelier no longer references jobId '<id>', and reading runIndex <n> from %UnitTest_Result failed: <message>. Do NOT re-submit — poll again with runIndex <n>.` Handles: `{jobId, runIndex, runIndexSource}`.
- **Cancel, 404 fallback:** `jobId '<id>' was already gone (HTTP 404) before this cancel could act, and reading runIndex <n> from %UnitTest_Result failed: <message>. Poll by runIndex <n> to observe the run.` Handles: the cancel's `handles`.

**`IsDirective` cases** (OS row 11):

| Returns 1 | Returns 0 |
|---|---|
| `#dim tX As %Integer` | `#dim tSC As %Status = $$$OK` |
| `#define …` | `  #DIM tN As %Integer = 7` |
| `#sqlcompile …` | `#dim tA, tB As %Integer = 0` |
| `#; c` | `#dim tN = 5` |
| `#dim tO As %DynamicObject` (no `=`) | `#dim tQ As %String = "a=b"` |
| `#define X(%a) (%a=1)` (not a `#dim`) | `##class(X).Y(1)` |

The existing 0 cases stay 0.

**Golden prompt text.**

- **Description:** `"Deploy an ObjectScript class or package to IRIS (iris_doc_load, glob-path form), fix compile errors, then run its unit tests (iris_execute_tests) with a total-count check and, when asked, measure their line coverage (iris_test_coverage)."`
- **Step 4** appends: `If the response is a \`PRODUCTION_BUSY\` refusal, nothing ran: a production other than the tests' own is running in the namespace, and the refusal names it. Tell the user, and do not stop that production unless the user confirms it is a leftover of an interrupted test run.`
- **New step 8:** `8. Optional — line coverage, only when the user asks how much of the code the tests cover or gives a coverage target, and once the tests pass: call \`iris_test_coverage\` with the same \`target\` and \`level\`, \`classes\` set to the classes the tests exercise (not the test classes; at most 50), and \`minCoverage\` set to the user's target when there is one. It runs the tests again under an instance-wide line monitor. If \`iris_test_coverage\` is not in your tool list, the tool-visibility preset hides it (it is outside \`core\`): tell the user it needs the \`developer\` or full preset (\`IRIS_TOOLS_PRESET\`), and report the results without coverage. If it is refused with \`GOVERNANCE_DISABLED\`, it is disabled by default because it starts an instance-wide monitor and runs test code: tell the user the operator can enable it through \`IRIS_GOVERNANCE\`, for example \`{"global":{"iris_test_coverage":true}}\`, report the results without coverage, and do not measure coverage another way. If it is refused with \`MONITOR_BUSY\`, another monitor session is running on the instance (its \`owner\` says whose) and nothing was started: tell the user, and never stop that session. If it is refused with \`PRODUCTION_BUSY\`, handle it as in step 4. If the response has \`status: "running"\`, do NOT re-submit: call \`iris_test_status\` with \`action: "poll"\` and the response's \`coverageRunId\` until it completes. Report each class's percent and uncovered line ranges and, with \`minCoverage\`, the verdict (a failing verdict is a result, not a tool error). For a Cobertura file, call \`iris_test_status\` with \`action: "export"\`, the \`coverageRunId\` and an absolute \`outputPath\` ending in \`.xml\` that the user chose (for example \`c:/path/to/coverage.xml\`); export is disabled by default too (\`iris_test_status:export\`), so handle a \`GOVERNANCE_DISABLED\` refusal the same way.`
- **Step 9** is the old step 8 (Report), with "and the coverage, when it was measured" added.

**Governing ADs:**

- **AD-27:** the guard is untouched, and the capstone is the refusal oracle.
- **AD-12:** the stale rule stays in TypeScript, over raw data IRIS gathers. `IsDirective` is the existing raw-data correction.
- **AD-15:** the hint correction is on the sanctioned list; the prompt needs decision 1; the unused-feature paths are pinned.
- **AD-4 and AD-5:** no key or classification change; `:check` only.
- **AD-16:** re-attach reproduces the summary (row 3), and export is the companion write.
- **AD-28:** the prompt is authored once, the skills are generated, and the checks are mechanical.
- **AD-33:** `lineMap` is additive.
- **AD-14:** the bootstrap move.
- **AD-7:** no preset change.
- **AD-2:** the capstone is in `iris-mcp-all`.
- **AD-11 and AD-13:** `SourceMap` keeps its namespace restore.
- **Conventions:** Live gates; Live testing on a shared instance; Tool results; Refusals; Error text; Probes and references (earliest version verified: IRIS 2026.2 build 221U for `$$$cMETHrtnlabel` and `^rMAP`).

**Extend, don't copy (Rule 2).**

- `seedSourceMapFixture` extends `coverage-fixture.ts`, beside `seedReportFixture`.
- The capstone follows the 40.1 row-10, 40.2 row-2/row-9 and 39.6 capstone patterns through the shared helpers. Copies of helper names fail `gate-helper-copies.test.ts`.
- Row 12 extends `readonly-hint-crosscheck.test.ts`.
- The three error catches reuse `testRunEnvelope` and the neighbouring texts.
- `LabelLine` and `IndexLabels` change in place.

**Integration (Rules 1/2).**

- **Integration AC:** AC-5 and AC-6. The consumer, `iris_test_coverage`/`iris_test_status` on the built dev dist, reads the Status route's new `lineMap` and labels. It reports a fresh directive-only class without `not-up-to-date` and leaves a stale class out of the Cobertura file.
- **Consumes:**
  - Stories 40.1–40.3: the coverage routes, the monitor discipline, the export and the guard;
  - `coverage-fixture.ts` and `interop-namespace-fixture.ts`;
  - `scripts/lib/cobertura-dtd.mjs`;
  - `process-gate-helpers.ts`.
- **Consumed-by:** the Epic 40 retrospective and the epic-done gate (Rule #21). No later story consumes `lineMap`.

**Ledger inbox (Rule 17):**

- **DW-498:** Task 6, AC-3, rows 1 and 12.
- **DW-601:** Tasks 1, 2, 3 and 5, AC-6, rows 6, 7, 9 and 11.
- **DW-602:** Tasks 1, 3 and 10 (the sentence), AC-7, rows 5 and 11.

All three are addressed. None is declined.

**Spine follow-up (lead, Rule 20):**

- AD-4's known divergences: drop the DW-498 item. With decision 2, nothing is added.
- The Deferred bullet on annotation divergences.
- AD-15's sanctioned list: a Story 40.4 bullet (decision 1).

**Residuals** (they go in the CHANGELOG known limits):

- A class compiled with no debug line map, if a compile qualifier allows one, would read `not-up-to-date`. That is the false-FAIL direction, never a false PASS.
- The earliest IRIS version verified for `RtnLabel` and `^rMAP` is 2026.2 build 221U only.

## Verification

- Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package or one gate file per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- MCP calls name `server:"default"` and `HSCUSTOM` or `EXECMCPTMP402C`.

**Shared surfaces:** these change, and other tests assert on them.

- The `iris_execute_tests` annotations: the tools-list snapshot, `execute.test.ts`, `test-status-governance-keys.test.ts`, the README annotations cell and payload rows.
- The deploy prompt's text and description: the prompt pins, `skills/`, `skills/README.md`, the README prompt rows.
- The `SourceMap` head and labels: the OS head pins, the 40.2 QA raw pins.
- `BOOTSTRAP_VERSION` and the CHANGELOG newest move.
- `gateTestFiles` and `GATES`, and the session-count comments.
- The 40.2/40.3 doc-claims sentences, and the CHANGELOG first section.
- Tool, preset, prompt, refusal and baseline counts are unchanged.

**Standing criterion:** every test added or changed passes on a fresh environment, in either order.

- **Disposable fixtures:**
  - `EXECMCPTMP402C`;
  - `ExecuteMCPv2.Temp.Story391Fixture` and `ExecuteMCPv2.Temp.Story404*` in HSCUSTOM;
  - a temporary directory.
- **OS test classes** run one class per `iris_execute_tests` call, and `total` is compared with the `Test*` count (Rule #35).
- **No OS or dev test** starts a Line-by-Line session or a production.

**Commands:**

- `(loop)` `iris_doc_load` into HSCUSTOM with the globs `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/Coverage/Job.cls`, `…/src/**/REST/Coverage.cls`, `…/src/**/Tests/CoverageLabelTest.cls` and `…/src/**/Tests/CoverageSourceTest.cls`, then compile -- expected: clean.
- `(loop)` `iris_execute_tests` `ExecuteMCPv2.Tests.CoverageLabelTest`, then in separate calls `CoverageSourceTest` and `CoverageJobTest` -- expected: the totals equal the `Test*` counts, with 0 failures.
- `(loop)` `pnpm gen:bootstrap` twice, then `git diff --stat packages/shared/src/bootstrap-classes.ts` -- expected: one move, and the second run is idempotent. Then `pnpm --filter @iris-mcp/shared build` and `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts src/__tests__/baseline-classifications-safety.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build`, then `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/coverage-report.test.ts src/__tests__/cobertura.test.ts src/__tests__/test-status.test.ts src/__tests__/test-status-export.test.ts src/__tests__/test-coverage.test.ts src/__tests__/execute.test.ts src/__tests__/prompts.test.ts` -- expected: pass.
- `(loop)` `pnpm gen:skills`, then `pnpm gen:skills:check` and `pnpm validate:prompts`, one call each -- expected: OK (13 prompts and 13 skills).
- `(loop)` Build admin, interop, ops and data, one call each. Then `pnpm gen:tools-list-snapshot --force` and `pnpm gen:tools-list-snapshot:check` -- expected: only the `iris_execute_tests` annotations differ.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run` with `src/__tests__/story-40-4-doc-claims.test.ts`, `story-40-3-doc-claims.test.ts`, `story-40-2-doc-claims.test.ts`, `story-40-1-doc-claims.test.ts`, `prompt-safety-invariants.test.ts`, `story-38-6-qa-edit-prompt-sdk-wire.test.ts`, `skills-generated-frontmatter.test.ts`, `validate-prompts.test.ts`, `docs-prompt-sync.test.ts`, `readonly-hint-crosscheck.test.ts`, `test-status-governance-keys.test.ts`, `tools-list-snapshot.test.ts`, `live-gate-roster.test.ts`, `story-39-1-gate-guards.test.ts`, `changelog-bootstrap-move.test.ts`, `interop-namespace-fixture.test.ts`, `gate-helper-copies.test.ts` and `docs-visibility-roster-sync.test.ts` -- expected: pass.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/epic40-capstone-gate.test.ts` -- expected: rows 1-8 pass, none skipped; idle; nothing left.
- `(loop)` In separate calls, `ENV …` for `story-40-2-coverage-reports-live-gate.test.ts`, `story-40-2-qa-live-gate.test.ts`, `story-40-1-coverage-live-gate.test.ts` and `story-40-3-testproduction-live-gate.test.ts` -- expected: pass (regression; 40.2 values reproduced).
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one call each for `build`, `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/all test`, split into calls that each finish inside the cap -- expected: green.
- `(once)` One call each: `pnpm gen:governance-baseline:check` (`1e62c5ad5bf7`/141), `pnpm measure:tools-payload` (equal to the README rows) and `node scripts/check-epics-sync.mjs` -- expected: OK.
- `(once)` After every armed run:
  - `leftovers` for `EXECMCPTMP402C` is `[]`;
  - the namespace and database are not listed;
  - `iris_doc_list` (HSCUSTOM, `Story391Fixture` and `Story404`, generated included) is empty;
  - `MonitorState` is `{active:0}` and the session node is unset

  -- expected: all hold.

**Planned mutations (Rule 19).** Apply each one, observe red, revert, and reload or rebuild what it touched. Confirm that `git status --short` and `git diff --stat` are unchanged, and record it as `mutation: <change> -> <test>`.

- **IRIS-side mutations** go on a scratch copy loaded into HSCUSTOM. Afterwards, reload from `src/` through the glob, compare `iris_doc_get` with the source, and re-run `assertDeployedBootstrapVersion`.
- **Built-dist mutations** are restored by rebuilding.

The mutations:

- **AC-1:** delete the `minCoverage` default sentence from the dev README → `story-40-4-doc-claims`.
- **AC-2:** drop the `GOVERNANCE_DISABLED` clause of step 8 → `prompt-safety-invariants` (Story 40.4 block), and capstone row 1 after a rebuild.
- **AC-3:** set `readOnlyHint: true` in `dist/tools/execute.js` → row 12 and capstone row 1.
- **AC-4:** remove the catch at `test-status.ts:270` → row 10.
- **AC-5:**
  - remove `Launch`'s `busy-foreign` branch → row 8: an allocated run, `ERROR #6062`, and the foreign session still active;
  - drop the DOCTYPE in `dist/tools/cobertura.js` → row 4;
  - shift a reported class line by one in `dist/tools/coverage-report.js` → row 2.
- **AC-6:**
  - make the TypeScript rule ignore `lineMap` → row 6 (`Story404.Hooks` `not-up-to-date`);
  - restore the guessed `LabelLine` (Job.cls) → rows 6 and 7 (Long's labels 0, and Stale not stale with `line-rate="1"`).
- **AC-7:** restore the old `IsDirective` (Job.cls) → row 5 and `CoverageLabelTest`.
- **AC-9:** edit `Job.cls` without regenerating → `bootstrap.test.ts` (drift).

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
