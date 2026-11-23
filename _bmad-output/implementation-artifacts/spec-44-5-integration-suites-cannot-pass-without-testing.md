---
title: 'Story 44.5: Integration Suites Cannot Pass Without Testing'
type: 'chore'
created: '2026-11-23'
status: 'done'
baseline_revision: '9a5767a35a2b76a7faa54b60036f43ada08d977b'
baseline_commit: '9a5767a35a2b76a7faa54b60036f43ada08d977b'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      iris_database_manage delete removes only the CPF entry: the database stays mounted and its IRIS.DAT stays on disk, so a second run of the admin integration test on one instance fails at create.
    evidence: |-
      Seen while hardening the admin database create (Story 44.5): with the literal directory mcpadmintestdata, a second run on the same instance fails at the create with "ERROR #60: the database must be dismounted". CI is unaffected (a fresh container per run). The test keeps the literal directory so the defect is not hidden; a unique suffix per run would hide it.
    location: >-
      packages/iris-admin-mcp (iris_database_manage delete); packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts
    severity: medium
---

<intent-contract>

## Intent

**Problem:** An armed CI suite reports "passed" for tests that tested nothing. 15 guard returns end a test early (`if (!created.production) return;`), and 33 `if (!result.isError …)` branches hold the only assertions or tolerate a failed create. The planning probe found that this hides real failures today: on the CI image, admin's database, namespace, mapping and OAuth creates all fail, and their verify tests pass because they assert nothing. The DocDB lifecycle and the IRIS-side DocDB record tests never run in CI (DW-726), and one shared test is order-dependent (DW-753).

**Approach:** Turn every one of the 48 sites into a hard assertion (or a loud skip), and fix the tests the hardening shows are wrong. Add a source check, `pnpm check:live-guards`, that refuses any new silent return or conditional-only outcome assertion in any armed file. It runs in the default suite and as a gates-job step. Let CI run the DocDB lifecycle by enabling `%Service_DocDB` on the throwaway after the Epic 35 F5 gate has run. Run the two IRIS-side DocDB test classes in the dev integration suite. Clear DW-753's shared map before each test.

## Boundaries & Constraints

**Always:**
- The scan scope is every file `coveredTestFiles()` returns (73 at baseline). The rules:
  - **G (guard return).** A `return` whose nearest enclosing function is a test callback (`it`/`test` and their `.each`/`.skipIf`/`.runIf`/`.concurrent` forms) is a finding. Allowlisted exceptions: (a) it returns a skip call (`<ctx>.skip()`, `skipTest(`, `skipLeg(`); (b) it is the only statement of an `if` whose condition calls an allowlisted skip helper (`skipIfReason`, `skipIf`, `coverageBlocked`); (c) the statement just before it in the same block is a skip call.
  - **C (conditional outcome).** An `if` inside a test callback whose condition reads `.isError` or `created.` is a finding unless its then-branch ends with a `throw` or a skip return.
  - Each allowlist entry carries a reason, and each allowlisted skip helper's definition must call a skip (pinned by a test).
- One logic module, shared by the CLI and the vitest test (Rule #45).
- Gates are proven red on the path they guard (Rule #59). Every pinning test has a `mutation:` line (Rule 19).
- Every added or changed test is hermetic, and passes on a fresh environment in either order. The exception is the pre-existing ordered lifecycle chains inside one `describe`, which now fail loudly when a step fails.
- Live proofs run only on throwaways on port 52792, which are removed afterwards. Never on the shared instance (`iris-community-edition`, 52773).

**Never:**
- No product code change: nothing under `packages/*/src` outside `__tests__`, no `src/ExecuteMCPv2/**` change except the test classes, no tool, governance key, description or bootstrap change, and no `gen:bootstrap`/`gen:ipm`.
- No silent pass: no allowlist entry that hides a product defect. A product defect found while hardening is reported in `deferred:` for the lead, never skipped quietly.
- No test toggles `%Service_DocDB`: only the CI throwaway step does.
- No new dependency. `typescript` is already a root devDependency (5.9.3).
- No changeset: no published file changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean tree | the 73 armed files after this story | `pnpm check:live-guards` prints `73 armed files, 0 findings` and exits 0 | none |
| Re-added guard (AC 44.5.3 proof) | `if (!created.production) return;` back in interop's "starts the test production" | exit 1. The output names `packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts:<line>` with rules G and C | the gates step fails |
| Tolerated create | `if (!result.isError) { created.x = true; }` in a test | rule C finding | the gates step fails |
| Unarmed opt-in | `if (skipReason) return testCtx.skip();`, `if (skipIfReason(r, ctx)) return;`, `{ ctx.skip(); return; }` | no finding | none |
| Hook or helper return | `if (skipReason) return;` in `beforeAll`; a value return in a helper function | no finding (out of scope: it reports no test outcome) | none |
| CI DocDB | throwaway job, service disabled at seed | F5 runs (prepublish-all) → step enables the service → integration-data runs all 12 tests, 0 skipped | the step exits 1 if the read-back is not `Enabled=1`; a skipped lifecycle test fails integration-data (empty allowlist) |

</intent-contract>

## Code Map

- `scripts/lib/ci-checks.mjs`:
  - `ROOT_GATE_SCRIPTS` (:268-278) is the gates job's root checks, in workflow order.
  - `DOCDB_REASON`/`DOCDB_SKIPS` (:181-205).
  - `buildLiveSuites()` (:150-245): 18 suites. The `allowedSkips` of `integration-data` is `DOCDB_SKIPS`; `prepublish-all` holds the 4 `CAPTURE_SKIPS`.
  - `SEEDED_SUITE_IDS` (:251): `prepublish-shared … prepublish-all, integration-shared, integration-admin, integration-data, integration-dev, integration-interop, integration-ops, process-gates, launcher-live`.
  - `coveredTestFiles()` (:257).
  - `buildDeclaredSteps()` (:280-340): `gates` appends `ROOT_GATE_SCRIPTS`; `throwaway` maps `SEEDED_SUITE_IDS` to `${HARNESS} exec … ci-live-suite.mjs <id>` with `if: IF_SEED`.
- `scripts/lib/live-gate-scan.mjs`: `REPO_ROOT`, `relativeToRepo`, `walk`, and the `LIVE_CAPABLE`/`ARMED_GATE` regexes. A new test whose fixture text holds `liveGateTarget(`, `resolveLiveTarget(`, `getIntegrationConfig(` or `process.env.IRIS_REQUIRE_LIVE ===` becomes "live-capable/armed" and fails `ci-workflow.test.ts`, so join such fixture text at run time, as `ci-workflow.test.ts:438-446` does.
- `scripts/check-epics-sync.mjs` -- the shape of a root CLI check (`isEntryPoint` from `scripts/lib/script-process.mjs`).
- `scripts/ci-live-suite.mjs` -- `classifyVitestReport` (:47-82): an unlisted skip or a stale allowlist entry fails a suite. Unchanged.
- `scripts/throwaway-iris.mjs` `sessionHarness` (:1117-1143): `session --state <f> --namespace %SYS --script <file>` exits with docker's status. `$SYSTEM.Process.Terminate(,N)` makes that status N (probed: 3 → `session-exit=3`).
- `.github/workflows/ci.yml` -- gates steps (:73-126; `epics sync check` at :113-114, then `launcher install`) and throwaway steps. The header comment (:1-36) describes the jobs.
- `packages/iris-mcp-all/src/__tests__/ci-workflow.test.ts`:
  - the Story 42.3 step-equality mutation table (`it.each` :119-147, e.g. the row "a dropped step (the epics-sync check)" :123);
  - the throwaway order test (:262-268);
  - the allowlist pins (:422-436: `toBe(13)`, integration-data `toBe(9)`);
  - the Rule #56 root-check-script test (:467-500);
  - the README tests (:540-566).
  - `ci-workflow-check.ts:119` produces "declared step is not in the workflow".
- `packages/iris-mcp-all/src/__tests__/ci-live-suite.test.ts:345-349` -- pins `integration-data` at 9 allowlisted skips.
- `packages/iris-mcp-all/src/__tests__/release-prepare.test.ts:51` -- `REAL_CHECKS`, the sorted root check scripts (used at :502, :514 and :561). `prepare` runs every root `check`/`validate` script (`ROOT_CHECK_SCRIPT`, `release-core.mjs:93`).
- The armed integration files and their sites (rules G and C, baseline lines):
  - `packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts`: C at :231 :243 :272 :281 :311 :323 :352 :361 :383 :392 :417 :430 :443 :478 :521 :562 :580 :598 (nested `if (structured.count > 0)` :603) :628 :637 :669 :690. The OAuth create also swallows `IrisApiError` 400/404/500 (:672-679), and the OAuth verify asserts only `>= 0` (:697-698).
  - `packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts`: G at :204 :219 :239 :388 :411 :430 :442 :448. C at :173 :190 :213 :227 :324 :348 :357 :382 :400 :422.
  - `packages/iris-ops-mcp/src/__tests__/ops.integration.test.ts`: C at :268 (it asserts afterwards at :281). G at :286 :298 :311 :328.
  - `packages/iris-data-mcp/src/__tests__/data.integration.test.ts`: G at :194 :212 :256 (`!insertedDocId`; the insert test asserts it at :188). The lifecycle `describe.skipIf(!IRIS_OK || !DOCDB_OK)` is at :86.
- `packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts:300-323` -- the "test execution tool" describe, which runs `UtilsTest` through `executeTestsTool`. It is the sibling the DW-726 leg extends.
- `src/ExecuteMCPv2/Tests/DocDbRegisterTest.cls` (5 `Test*` methods) and `DocDbRegisterNamespaceTest.cls` (3). The CI seed deploys them already (`ci-seed-throwaway.mjs` `SEED_DIRECTORIES`); nothing runs them.
- `packages/shared/src/__tests__/credentials-cli-real-keyring.test.ts` -- the module-level `fakeStore` (:26). Test 1 (:67) never clears it; test 2 clears it at :107.
- `packages/iris-mcp-all/src/__tests__/epic35-defect-gate.test.ts:428-466` -- F5 asserts the service is DISABLED, and skips (`skipLeg`) when it is enabled.
- Docs: `README.md:1163` (the CI paragraph: the DocDB allowlist sentence, and "a test that returns early without asserting is reported as passed, which the wrapper cannot see") and `:1157` (the `gates` bullet's list of checks); `CHANGELOG.md` (top section `[Unreleased] — Story 44.4`; the 42.3 claim at :355-356 is history and is not edited).

## Tasks & Acceptance

**Execution:**
- `scripts/lib/live-guard-scan.mjs` (new) -- export:
  - `scanSource(file, text)`, which returns `{file, line, rule: 'G'|'C', text}[]` and parses with `typescript` (`createSourceFile`, `ScriptKind.TS`);
  - `liveGuardFindings({ files = coveredTestFiles(), read })`;
  - `SKIP_CALLS` and `SKIP_HELPERS`, each entry `{ name, reason }`.

  The rules are as in Boundaries. Reuse `coveredTestFiles` (ci-checks) and `REPO_ROOT`/`relativeToRepo` (live-gate-scan); the reason it is not folded into `live-gate-scan.mjs` is in Design Notes. Contract header comment in the style of `ci-checks.mjs`.
- `scripts/check-live-guards.mjs` (new) -- `main(argv, deps)` prints each finding as `<file>:<line> <rule> <text>`, then a summary line, `<n> armed files, <k> findings`. Exit 1 on any finding, else 0. It runs only as the entry point (`isEntryPoint`).
- `package.json` (root) -- add `"check:live-guards": "node scripts/check-live-guards.mjs"`.
- `scripts/lib/ci-checks.mjs`:
  - append `'pnpm check:live-guards'` to `ROOT_GATE_SCRIPTS`;
  - delete `DOCDB_REASON`/`DOCDB_SKIPS` and give `integration-data` `allowedSkips: []`;
  - in `buildDeclaredSteps().throwaway`, put this step immediately before the `integration-data` suite step: `{ run: \`${HARNESS} session --state ${STATE_FILE} --namespace %SYS --script scripts/ci-enable-docdb-service.script\`, if: IF_SEED }`;
  - update the comments.
- `scripts/ci-enable-docdb-service.script` (new) -- ObjectScript for `iris session` in `%SYS`:
  - `Security.Services.Modify("%Service_DocDB", .p)` with `p("Enabled")=1`;
  - re-read it with `Get`;
  - write one marker line with the read-back;
  - `Do $SYSTEM.Process.Terminate(,1)` unless the status is OK and `Enabled=1`;
  - `Halt`.
- `.github/workflows/ci.yml` -- add the gates step `- name: live-guard check` / `run: pnpm check:live-guards` after `epics sync check`. Add the throwaway step `- name: enable %Service_DocDB` with the same `if:`, before the `integration-data` suite step. Update the header comment (the gates check list; the throwaway order and why: F5 needs the service disabled).
- `packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts`:
  - every create asserts `expect(result.isError, <text>).toBeFalsy()` before setting `created.*`;
  - every verify test asserts `isError` falsy and its `created.*` true unconditionally, then its existing checks (the webapp-filtered count becomes `>= 1`);
  - database create passes a `directory` that is a sibling of `USER`'s directory from `databaseListTool` (`<parent of USER dir>/mcpadmintestdata/`, using the listed separator; probed on Linux);
  - OAuth create passes `customizationRoles: "%DB_IRISSYS,%Manager"` and drops the `IrisApiError` swallow;
  - OAuth verify asserts that the created server is listed: `serverCount` `>= 1`, and the issuer `https://mcpadmintest.example.com` appears in the list's text (read the `servers` row shape from a live throwaway answer before choosing the field);
  - the `!oauthAvailable` `testContext.skip()` stays (a loud unlisted skip in CI, where OAuth is available).
- `packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts`:
  - each G guard becomes an `expect` on the precondition (`created.production`, `created.productionStarted`, `created.lookupEntry`, `exportResult.isError` falsy, `xml` non-empty);
  - each C branch becomes an unconditional `isError`-falsy assertion followed by its checks.
- `packages/iris-ops-mcp/src/__tests__/ops.integration.test.ts` -- assert `isError` falsy before extracting the id (:268). The four `createdTaskId === undefined` guards become `expect(createdTaskId, <text>).toBeDefined()`.
- `packages/iris-data-mcp/src/__tests__/data.integration.test.ts` -- the three `!insertedDocId` guards become `expect(insertedDocId, <text>).toBeTruthy()`. Header comment: CI runs the lifecycle.
- `packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts` -- in "test execution tool", add one `it` per DocDB class: `ExecuteMCPv2.Tests.DocDbRegisterTest` → `total` 5, `passed` 5, `failed` 0; `ExecuteMCPv2.Tests.DocDbRegisterNamespaceTest` → 3/3/0. Each asserts `isError` undefined and `status` `completed`.
- `packages/shared/src/__tests__/credentials-cli-real-keyring.test.ts` -- add `beforeEach(() => fakeStore.clear())` (import `beforeEach`); drop the now-redundant clear at :107.
- `packages/iris-mcp-all/src/__tests__/live-guard-check.test.ts` (new; header says what it pins) --
  - the real armed files have 0 findings, and the scanned list equals `coveredTestFiles()`;
  - in memory only, the real interop file with `if (!created.production) return;` inserted as the first statement of "starts the test production" → G and C findings at that line;
  - the same file with a create's assertion replaced by `if (!result.isError) { created.production = true; }` → a C finding;
  - a synthetic table: every allowed shape gives no finding, and every forbidden shape gives one (a bare data guard, a value return, a return inside a loop, an `isError` branch holding `expect`, a `created.` branch, a tolerated create);
  - every `SKIP_HELPERS` entry is defined in an armed file or an imported helper, and its body calls a skip;
  - every allowlist reason is more than 30 characters;
  - `main()` with an injected reader that serves the mutated interop text returns 1 and prints the file:line, and on the real tree returns 0.
- `packages/iris-mcp-all/src/__tests__/ci-workflow.test.ts`:
  - add the mutation row `["a dropped step (the live-guard check)", () => mutate(text, "      - name: live-guard check\n        run: pnpm check:live-guards\n", ""), /declared step is not in the workflow.*check:live-guards/]`;
  - in the throwaway-order test (:262), assert that the `ci-enable-docdb-service.script` step comes after the `prepublish-all` suite step and immediately before `integration-data`;
  - the allowlist pin becomes 4 entries, all `prepublish-all`;
  - the README test asserts that the section names `check:live-guards` and `%Service_DocDB`.
- `packages/iris-mcp-all/src/__tests__/ci-live-suite.test.ts:345-349` -- `integration-data` holds 0 entries, only `prepublish-all` has any, and the title drops "the nine DocDB lifecycle tests".
- `packages/iris-mcp-all/src/__tests__/release-prepare.test.ts:51` -- insert `"check:live-guards"` into `REAL_CHECKS` (sorted).
- `README.md` -- update the CI section:
  - the `gates` bullet names the live-guard check;
  - the `throwaway` bullet says the job enables `%Service_DocDB` after the prepublish suites, so the DocDB lifecycle runs;
  - the allowlist holds only the four capture legs;
  - replace "a test that returns early … cannot see" with what `pnpm check:live-guards` refuses.
- `CHANGELOG.md` -- a new top section `## [Unreleased] — Story 44.5: Integration Suites Cannot Pass Without Testing`:
  - Fixed: the silent passes, naming the admin create defects in the tests;
  - Changed: the CI DocDB step and the new gates step;
  - no package, tool or `BOOTSTRAP_VERSION` change.

**Acceptance Criteria:**
- Given the tree after this story, when the gates job runs `pnpm check:live-guards` and `pnpm --filter @iris-mcp/all test`, then both pass. When `if (!created.production) return;` is re-added to interop's "starts the test production" test, both fail, naming that file and line (AC 44.5.3, Rule #59, on the gates-job path).
- Given `ci.yml` without the `live-guard check` step, when `ci-workflow.test.ts` runs, then its new mutation row reports the dropped step (AC 44.5.3, the 42.3 step-equality self-test).
- Given a seeded `irishealth-community` 2026.2 throwaway (port 52792, `HSCUSTOM`), when F5, the enable step and `integration-admin`, `-data`, `-dev`, `-interop` and `-ops` run through `ci-live-suite.mjs` in CI order, then each suite passes with 0 unlisted skips. `integration-data` runs 12 of 12 (none skipped), and the dev DocDB legs report totals 5 and 3 with 0 failed (AC 44.5.2, AC 44.5.4, DW-726).
- Given `credentials-cli-real-keyring.test.ts`, when it runs with `--sequence.shuffle --sequence.seed=44` and in default order, then both runs pass (DW-753).
- Given the baseline `vitest list --json` lengths (Design Notes), when they are re-taken after the story, then every package except `@iris-mcp/all` and `@iris-mcp/shared` is unchanged, `@iris-mcp/shared` equals 2650 + 1 (the DW-753 default-order test), and `@iris-mcp/all` equals 6986 + 1 + the number of tests in `live-guard-check.test.ts` + the number of tests in the two `story-44-5-qa-*.test.ts` files (AC 44.5.5, Rule #19). [AMENDED 2026-11-23 — see the story change log]
- Given the README CI section and the new CHANGELOG section, when they are read, then neither claims that an early return is invisible to CI or that CI skips the DocDB lifecycle (AC 44.5.5).
- Given the story pushed by the lead, when CI runs on the `epic44` tip, then the run is green. The lead records its URL in this spec's Verification as the epic-done evidence (AC 44.5.4; lead-owned).

### Review Findings

Code review 2026-11-23 (`bmad-code-review`, full mode, frozen diff `9a5767a3..bd2e2e62` without the lead's commit `46491d25`). All four layers delivered (blind, edge-case, verification-gap, acceptance auditor); review outcome NORMAL. 18 entries after grouping: 0 high, 10 medium, 8 low. 16 patched, 2 deferred (1 new ledger entry, 1 already ledgered), 11 rejected.

- [x] [Review][Patch] Rule C read only the nearest function, so an outcome `if` inside `rows.forEach(...)` or `Promise.all(rows.map(...))` in a test was silent, against the spec's "inside a test callback" (QA a; auditor; blind) [scripts/lib/live-guard-scan.mjs `inTestBody`]
- [x] [Review][Patch] The scan missed `created?.x`, `created["x"]`, `result["isError"]`, a destructured `isError`, a tagged-template `it.each` and `it`/`test` imported from vitest under an alias, and the header did not list its remaining limits; README and CHANGELOG claimed more than the scan does (QA b; auditor; blind) [scripts/lib/live-guard-scan.mjs `OUTCOME_CONDITION`, `calleeRoot`, `testRootsOf`, header; README.md; CHANGELOG.md]
- [x] [Review][Patch] Any `<anything>.skip(...)` counted as a skip, so `rows.skip(); return;` hid a guard; now only a no-argument `skip()` on a parameter of a function around it (the test context) [scripts/lib/live-guard-scan.mjs `isSkipCall`]
- [x] [Review][Patch] `main()` passed with zero files (`0 armed files, 0 findings`, exit 0); it now exits 1 (QA c; auditor; Rule #59) [scripts/check-live-guards.mjs]
- [x] [Review][Patch] The CLI's exit code was never shown non-zero as a real process; a spawn test with a preload that serves the guard to the real entry point now asserts exit 1 and the file:line [packages/iris-mcp-all/src/__tests__/live-guard-check.test.ts]
- [x] [Review][Patch] The DocDB enable step failed open: a Modify that raises an error left `tModify` undefined, the If line raised `<UNDEFINED>` before its Terminate and the session exited 0 (proven live); the results now start at 0, and the failure path was proven end to end on a throwaway (exit 1) [scripts/ci-enable-docdb-service.script]
- [x] [Review][Patch] DW-753's `beforeEach` was pinned only by a manual shuffled run; a third test asserts an empty store and goes red in default order without it [packages/shared/src/__tests__/credentials-cli-real-keyring.test.ts]
- [x] [Review][Patch] Two converted tests asserted their precondition but not their own step: the ops task run now asserts `isError` falsy, the interop lookup re-import asserts `isError` falsy and `entryCount >= 1` (an import of XML with no entry also succeeds) [packages/iris-ops-mcp/src/__tests__/ops.integration.test.ts; packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts]
- [x] [Review][Patch] CHANGELOG said the four admin creates "create and delete cleanly", which DW-757 contradicts [CHANGELOG.md]
- [x] [Review][Patch] AC 44.5.5's count pin did not account for the QA tests (amended; see the change log) [this spec]
- [x] [Review][Patch] No `mutation:` line for the dropped-step row (AC 44.5.3), the README test (AC 44.5.5) or the count pin [this spec, Verification]
- [x] [Review][Patch] The admin header said "two creates" failed; four did, from two causes [packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts:17]
- [x] [Review][Patch] "every skip helper ... is allowlisted" passed vacuously if its regex matched nothing [packages/iris-mcp-all/src/__tests__/live-guard-check.test.ts]
- [x] [Review][Patch] The live-guard-check header claimed fixture text is joined at run time; it is not [packages/iris-mcp-all/src/__tests__/live-guard-check.test.ts:13]
- [x] [Review][Patch] The DOCDB_SKIPS check tested module exports only, though the baseline constants were never exported [packages/iris-mcp-all/src/__tests__/story-44-5-qa-docdb-enable-step.test.ts]
- [x] [Review][Patch] The argv builder split a temporary directory with a space into several arguments [packages/iris-mcp-all/src/__tests__/story-44-5-qa-docdb-enable-step.test.ts]
- [x] [Review][Defer] 12 pre-existing armed integration tests assert only `content[0]?.text` `toBeDefined` (admin 3, interop 9; the blind hunter's 13th, the ops task run, is patched above; DW-758's summary says 13) — deferred: pre-existing, untouched by this story and outside its 48-site grammar; DW-758, routed burndown
- [x] [Review][Defer] The database delete leaves the database mounted and `IRIS.DAT` on disk, so a rerun on one instance fails the create — deferred: product defect already ledgered as DW-757 (routed burndown); the CHANGELOG now says so

Rejected:
- `false` — a then-branch that ends in a bare skip call is not loud (auditor): vitest 2.1.9's `context.skip()` throws `PendingError` (`@vitest/runner` dist/index.js:57-59), so the test stops there.
- `false` — "gets config item settings" asserts nothing about its result (verification-gap): by design, it queries `NonExistentItem` and its title says an error is a valid answer; its precondition is now asserted.
- `low` — QA rows without their own `mutation:` line (auditor): Rule 19 asks for one observed mutation per AC's pinning test, and every AC has one.
- `low` — the QA argv test depends on a fixed temporary path not existing (verification-gap): no realistic collision; the fix adds state handling.
- `low` — CI runs the IRIS-side DocDB classes only with the service enabled (blind): the spec puts the legs in integration-dev after the enable step (decision #147); the implementation probe ran both classes in both states, and F5 covers the disabled refusal in prepublish-all.
- `low` — `lastIndexOf` of -1 in the directory builder (edge): USER's directory is absolute on every supported host; rejected at the first review too.
- `low` — the OAuth teardown deletes the singleton server configuration on an instance that already has one (edge): pre-existing teardown (baseline :182-183), unchanged here; integration suites run only on throwaways.
- `low` — user and web-app list verifies read only the first page (edge, two findings): pre-existing assertions (the baseline asserted them whenever the call succeeded), green on the CI image.
- `low` — the skip-helper definition oracle resolves imports and bodies by regex (edge, two findings): a test of a test; the real-tree scan catches a guard on an unlisted helper.

## Spec Change Log

- 2026-11-23 (code review, Rule 5 apply-and-report): AC 44.5.5's count pin restated so it counts every test the story added. Original: "every package except `@iris-mcp/all` is unchanged, and `@iris-mcp/all` equals 6986 + 1 + the number of tests in `live-guard-check.test.ts`". Amended: shared 2650 + 1 (the review's DW-753 default-order test) and `@iris-mcp/all` 6986 + 1 + `live-guard-check.test.ts` + the two QA files. Intent unchanged (no test dropped, every added test accounted for); measured 7170 = 6986 + 1 + 53 + 29 + 101 and shared 2651.
- 2026-11-23 (lead, spec gate, decision #147): DocDB-in-CI choice accepted (CI runs the lifecycle; enable step after `prepublish-all`, before `integration-data`). `epics.md` Story 44.5 gains the DW-726 and DW-753 bullets and the decision tag. Spine AD-29's CI rule names the live-guard check and the DocDB enable step. The admin create fixes (`directory`, `customizationRoles`) are test bugs fixed in-story (AC 44.5.4's own rule).

## Review Triage Log

### 2026-11-23 — Review pass
- verdicts: 21 rows (findings of the four layers grouped by shared root cause; each row names its members) — high 0, medium 3, low 14, false 4, maybe-false 0
- findings:
  - `[medium]` `patch` (verification-gap) the entry point of `check-live-guards.mjs` and the root script are run by no test — patched: a spawn test in `live-guard-check.test.ts` asserts exit 0 and the summary line on stdout; mutation observed red.
  - `[medium]` `patch` (verification-gap, edge-case E1) skip-helper exemption accepts `if (skipIfReason(...) || !id) return;` and a negated helper — patched: `isSkipHelperCall` requires the condition to be the helper call itself; two FORBIDDEN rows added; the real tree still has 0 findings.
  - `[low]` `patch` (verification-gap) `findIndex` of prepublish-all can be -1 and pass vacuously — patched with `toBeGreaterThan(-1)`.
  - `[low]` `patch` (verification-gap) missing `mutation:` lines for the allowlist pins — written (observed) in `## Verification`.
  - `[medium]` `defer` (blind B5, edge E4) `iris_database_manage delete` removes only the CPF entry (database stays mounted, `IRIS.DAT` stays), so a second admin integration run on one instance fails at create with ERROR #60 — product defect, in `deferred:`; not hidden by a unique suffix (spec keeps the literal directory).
  - `[low]` `reject` (blind B1, B2; edge E2, E3, E8; intent divergence 1) the scan has no rule for swallowed exceptions, `&&`/ternary-gated assertions or non-inline test callbacks — spec-bound: the spec classified the 8 catch clauses and 16 non-isError conditionals as out of the grammar, and the module header states the limits; no armed file uses those shapes for a create.
  - `[low]` `reject` (blind B3) allowlist-helper oracle regexes are weak — the helper-definition test pins every helper in use today, and a new shape is also caught by rule G itself; a stronger oracle is more than a direct fix.
  - `[false]` `reject` (blind B4) privileged roles in the OAuth fixture — the spec fixes `customizationRoles: "%DB_IRISSYS,%Manager"` and the throwaway is disposable.
  - `[low]` `reject` (blind B5 part, edge E5) `lastIndexOf` of -1 in the directory builder — USER's directory always has a separator on every supported host; no reachable failure.
  - `[low]` `reject` (blind B6, edge E7) DocDB counts 5 and 3 are literals — spec-mandated (AC 44.5.3 names the totals, Rule #35).
  - `[low]` `reject` (blind B7, edge E6) the enable step stays in effect for later suites — by design (spec Design Notes item 3); no later suite relies on the service being off, as the edge hunter confirmed by grep.
  - `[false]` `reject` (blind B8) pinning `integration-data` at 0 allowlisted skips weakens the check — the empty allowlist is what makes a skipped lifecycle test fail the suite; the throwaway run showed 12 of 12.
  - `[low]` `reject` (blind B9) the OAuth verify is a weak existence check — it asserts count and issuer text as the spec states; the create is asserted before it.
  - `[low]` `reject` (blind B10) redundant `toBeDefined` lines and `void argv` — cosmetic.
  - `[low]` `reject` (verification-gap) the enable script has no default-suite test host — only a throwaway can run it; the lead's CI run and the observed mutation are the evidence, and a skipped lifecycle test fails integration-data.
  - `[low]` `reject` (verification-gap) dev DocDB tests rely on classes the CI seed deploys — the seed is the documented precondition and a missing class fails loudly on the counts.
  - `[low]` `reject` (verification-gap) a leftover MCPADMINTEST object fails a create on a non-fresh instance — intended: a create must not be tolerated.
  - `[low]` `reject` (verification-gap) stale `Status:` line in `## Auto Run Result` — rewritten at finalize.
  - `[false]` `reject` (intent-alignment 2, 3, 5) live outcomes are not evidenced inside the diff — the throwaway run (admin 28/28, data 12/12, dev 33/33, interop 21/21, ops 18/18, F5 not skipped, enable step exit 0) is recorded in the Auto Run Result, and the lead owns the armed CI run.
  - `[low]` `reject` (intent-alignment 4) the test asserts more than 60 files read, not 73 — the test also pins that the scanned list equals `coveredTestFiles()`; the CLI prints the exact count.
  - `[false]` `reject` (intent-alignment 6) no shuffle-run test for DW-753 — the shuffled seed-44 run is an observed mutation, which a unit test cannot embed.

## Design Notes

**Governing ADs (Rule 6).** None is contradicted:
- **AD-29 (CI):** a new gate is registered in `ci-checks.mjs` and `ci.yml`, held by the self-test, and the armed suites keep the skip allowlist.
- **AD-15:** back-compat is pinned mechanically by the count pin.
- **AD-2:** the DocDB IRIS-side leg goes in the dev suite, because data must not import dev's tools.
- **Conventions:** Live gates; IRIS-side unit tests (compare `total`); Live testing on a shared instance (throwaway only).

**Probe results (2026-11-23; throwaway `irishealth-community:2026.2@sha256:462de1fb…` on 52792 in `HSCUSTOM`, seeded by `ci-seed-throwaway.mjs` (64 classes); removed afterwards: `docker ps -a --filter label=iris-mcp.owner=throwaway` is empty).**

1. **Inventory (Rule #56).** It is mechanical and exhaustive as of 2026-11-23 at `d634a597`. Source: `coveredTestFiles()` over `buildLiveSuites()`: 18 suites, 73 files. The four `plain` prepublish suites run only `verify-iris-reachable.mjs`. A TypeScript-AST tally of every `return` in test-callback scope (783):

   | Shape | Count | Disposition |
   |---|---|---|
   | returns a skip call | 604 | allowed (a skip is loud in CI) |
   | `if (skipIfReason(…)) return;` / `skipIf(…)` / `coverageBlocked(…)` | 79 / 10 / 2 | allowed; each helper skips (or throws when armed) |
   | `{ <skip call>; return; }` | 73 | allowed |
   | data guard | 15 | convert: data 3, interop 8, ops 4. Matches the epic and DW-684's `:204/:219/:239` |

   Rule C over test scope:
   - 33 `isError`/`created.` branches to convert (admin 22, interop 10, ops 1). These match the epic.
   - 7 interop `created.`-guard `if`s coincide with G sites.
   - 2 pass already: `doc-get-range-live-gate:408` throws when armed and skips otherwise; `epic35-defect-gate:314` throws.

   The live-gate files under `packages/iris-mcp-all` hold no data guard: every test-scope return there is skip-shaped.

   What is missing from the list, by design (classified, no finding):
   - 135 hook-scope returns, which report no test outcome;
   - 492 helper-function returns;
   - 18 imported helper modules and 6 `integration-setup.ts` files: no test callbacks, and every `isError` branch throws;
   - 8 `catch` clauses in tests: capture-then-assert, poll-loop break, or idempotent cleanup;
   - 16 non-`isError` conditional assertions: per-row oracles or version shapes, outside AC 44.5.1's grammar. `admin:603` is folded into the admin conversion. The residual is `tools.integration:372`, reopened if `structured.columns` is absent on the CI image.

   The release `prepare` job runs the same prepublish files armed.

2. **Silent passes are live today.** The scratch probe that recorded the `created` flags (reverted) showed:
   - integration-admin: `{database:false, namespace:false, mapping:false, resource…ssl:true, oauth:false}` with `oauthAvailable:true`, and 28/28 "passed";
   - integration-interop: everything created;
   - integration-ops: the task was created (the delete test resets the id).

   Causes, from direct tool calls:
   - `ERROR #5001: Parameter 'directory' is required for create action` (database). Namespace and mapping then fail on "Database MCPADMINTEST-DATA does not exist".
   - OAuth: `Property 'OAuth2.Server.Configuration::CustomizationRoles' required` (the tool's own description says it is required).

   With `directory: /usr/irissys/mgr/mcpadmintestdata/` (a sibling of USER's `/usr/irissys/mgr/user/`) and `customizationRoles: "%DB_IRISSYS,%Manager"`, all four create and delete cleanly. These are test defects, so they are fixed here (AC 44.5.4).

3. **DocDB decision (AC 44.5.4): CI runs the lifecycle.**
   - A fresh instance shows `%Service_DocDB` `Enabled=0`; integration-data gives 3 passed and 9 allowlisted skips.
   - After enabling the service: 12/12 passed, including `index` on a new property. The 9 entries were then reported stale.
   - F5 with the service enabled: `[SKIP] … %Service_DocDB is ENABLED`, which would be an unlisted skip in prepublish-all.
   - So the step goes after prepublish-all, which is the only other suite that touches DocDB, and immediately before integration-data.
   - `DocDbRegisterTest` (5/5) and `DocDbRegisterNamespaceTest` (3/3) pass with the service disabled and enabled, both through `DebugRunTestCase` and through `executeTestsTool` (`{"total":5,"passed":5,"failed":0,"status":"completed"}`, and 3/3/0).

   The choice is a session script rather than JS:
   - it needs no new code with its own tests, so the count pin holds;
   - it fails loudly through `Terminate` (probed);
   - a lifecycle skip still fails integration-data.

   The epic's "DOCDB_SKIPS names stay unchanged" is read as "the 9 test titles stay": the allowlist entries go, the titles do not change.
4. **The gate claims hold.** `allowedSkips` is `{file,test,reason}` per suite, and `ci-live-suite` fails an unlisted skip or a stale entry. The gates job is `DECLARED_STEPS.gates` plus `ROOT_GATE_SCRIPTS`. The 42.3 step-equality self-test is the `it.each` table in `ci-workflow.test.ts` (:119-147).

   Proving mutation: the AST dry-run of rules G and C over today's interop file flags `:204` under both rules. That is the same line the proof re-adds, so the check turns red on the gates path (`pnpm check:live-guards` runs from the repo root in the gates job).
5. **Corrections for the lead (Rule #42, apply-and-report; `epics.md` not edited):**
   - (a) admin's `oauthAvailable` skip is not allowlisted (integration-admin `allowedSkips` is `[]`), and it never skips in CI;
   - (b) the epic says 33 conditionals and 15 guards: confirmed exactly;
   - (c) admin's creates fail in CI today (item 2): the concrete DW-684 evidence;
   - (d) DW-726 and DW-753 are routed to this story but have no `- DW-n:` bullet under Story 44.5 in `epics.md` (Rule 17 1b).

**Why a new module, not `live-gate-scan.mjs` (Rule 2).** That module is imported by `ci-checks.mjs` and every live-gate scan. A rule that needs the TypeScript parser would load `typescript` into all of them. The new module reuses its helpers and `coveredTestFiles()`, and copies nothing. The CLI follows `check-epics-sync.mjs`, and the CI step reuses `throwaway-iris.mjs session` (Story 42.4's path).

**Root script, not a bare `node` step.** `check:live-guards` matches `ROOT_CHECK_SCRIPT`, so the Rule #56 test forces it into the gates job, and `prepare` runs it at release (DW-612 parity). The cost is `REAL_CHECKS`.

**Integration ACs, Consumes and Consumed-by (Rules 1/2).**
- The scan module is consumed by `scripts/check-live-guards.mjs` (the gates step and release `prepare`) and by `live-guard-check.test.ts` (the default suite). The first AC drives the consumer, the gates command, against the real tree.
- Consumes: `coveredTestFiles`, `REPO_ROOT`/`relativeToRepo`, `isEntryPoint`, `throwaway-iris.mjs session`, `executeTestsTool`.
- Consumed-by: no later story is planned. The Epic 44 burn-down inherits the gate.

**Story 44.4 handoff.** In CI run 45178755450 (head `5e8b32d0`, the 44.4 tip), the `throwaway` job finished with `success`. That job runs the five dev live gates that call `compileDocs`, armed, so no armed-suite failure from 44.4 was seen. The three launcher legs succeeded too. The three `gates` legs were still `in_progress` when this spec was written; the lead reads their result with `gh run view 45178755450`.

**Ledger inbox.**
- DW-726 is addressed by the DocDB step plus the dev leg (AC 3).
- DW-753 is addressed by the `beforeEach` (AC 4).
- DW-684 (dropped to an action item) is this story's charter.

## Verification

**Commands:**
- `pnpm check:live-guards` -- expected: exit 0, `73 armed files, 0 findings`.
- `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/live-guard-check.test.ts src/__tests__/ci-workflow.test.ts src/__tests__/ci-live-suite.test.ts src/__tests__/release-prepare.test.ts` (timeout 600000) -- expected: green.
- `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/credentials-cli-real-keyring.test.ts --sequence.shuffle --sequence.seed=44`, then the same run without the shuffle flags -- expected: 2/2 both times.
- `pnpm build && pnpm lint && pnpm type-check`, then each package's `pnpm --filter <pkg> test`, one package per call -- expected: green.
- `pnpm gen:governance-baseline:check`, `pnpm gen:ipm:check`, `pnpm gen:tools-list-snapshot:check` -- expected: unchanged.
- Count pin: `cd packages/<dir> && pnpm exec vitest list --json | node -e "…length"` for each package. Baseline at `d634a597`: shared 2650, client-config 1455, iris-admin-mcp 514, iris-data-mcp 205, iris-dev-mcp 1824, iris-interop-mcp 754, iris-ops-mcp 350, iris-mcp-all 6986.
- Throwaway (52792), in this order, each command in its own foreground call:
  1. `node scripts/throwaway-iris.mjs up --image <IRISHEALTH_COMMUNITY_IMAGE> --namespace HSCUSTOM --host-port 52792 --state <scratch>/tw.json`.
  2. `exec -- node scripts/ci-seed-throwaway.mjs`.
  3. `exec -- pnpm --filter @iris-mcp/all exec vitest run src/__tests__/epic35-defect-gate.test.ts -t F5` -- F5 passes, not skipped.
  4. `session --namespace %SYS --script scripts/ci-enable-docdb-service.script` -- exit 0.
  5. `exec -- node scripts/ci-live-suite.mjs integration-admin`, then `-data`, `-dev`, `-interop`, `-ops` -- 0 problems each.
  6. `down`, then `docker ps -a --filter label=iris-mcp.owner=throwaway` -- empty.

**Mutations (Rule 19; revert each, and `git status --short` is unchanged):**
- mutation: re-add `if (!created.production) return;` to interop "starts the test production" → `pnpm check:live-guards` exits 1 naming the line, and `live-guard-check.test.ts` "real armed files have 0 findings" goes red.
- mutation: restore one admin create to `if (!result.isError) { created.database = true; }` → `pnpm check:live-guards` exits 1 (rule C).
- mutation: drop `directory` from the admin database create → integration-admin on the throwaway fails at "creates a test database".
- mutation: comment out the `Modify` in `ci-enable-docdb-service.script` → the session exits 1, and integration-data reports 9 unlisted skips.
- mutation: move the DocDB step before the `prepublish-all` step in `buildDeclaredSteps` → the ci-workflow throwaway-order test goes red.
- mutation: flip one `$$$AssertTrue` in `DocDbRegisterTest.cls` (src; reseed the throwaway) → the dev DocDB leg reports failed > 0 and goes red.
- mutation: delete the new `beforeEach` → the shuffled seed-44 run fails the list assertion.
- mutation (review pass, observed): disable the `isEntryPoint` branch of `check-live-guards.mjs` → `live-guard-check.test.ts` "the root script `check:live-guards` runs the CLI as a real process" goes red (1 failed of 52); restored.
- mutation (review pass, observed): make `isSkipHelperCall` accept any condition → the new FORBIDDEN row "a data guard OR-ed with a skip helper" goes red, with the other G rows; restored.
- mutation (review pass, observed): give `integration-data` one `allowedSkips` entry in `ci-checks.mjs` → `ci-live-suite.test.ts` "holds the allowlisted skips of the registry: the four capture legs, and nothing else" and "every allowlisted skip names an existing file…" go red; restored.

**Code review (2026-11-23), observed; each reverted, the file byte-identical afterwards:**
- mutation (code review, observed): drop `'pnpm check:live-guards'` from `ROOT_GATE_SCRIPTS` → `ci-workflow.test.ts` "fails on a dropped step (the live-guard check), naming the difference" goes red (with six other rows), the AC 44.5.3 step-equality pin.
- mutation (code review, observed): put the old README sentence ("…which the wrapper cannot see") back in the CI section → `ci-workflow.test.ts` "the README documents the CI (Story 42.3) > states the images…" goes red (AC 44.5.5 docs).
- mutation (code review, observed): restore `OUTCOME_CONDITION` to `/\.isError\b|\bcreated\./` → 4 red; make `inTestBody` read only the nearest function → 4 red; let it climb through any function → 1 red; drop the tagged-template step of `calleeRoot` → 1 red; make `testRootsOf` return `TEST_ROOTS` only → 2 red; let `isSkipCall` accept `.skip(` on any receiver → 3 red; drop the zero-file guard of `main()` → 1 red (all `story-44-5-qa-scanner-shapes.test.ts`).
- mutation (code review, observed): drop `process.exitCode =` from the entry-point branch of `check-live-guards.mjs` → `live-guard-check.test.ts` "the CLI as a real process exits 1…" goes red; the in-process rows stay green.
- mutation (code review, observed, gates path): add `it("qa mutation", async () => { [r1].forEach((r) => { if (!r.isError) { expect(r).toBeDefined(); } }); });` to `ops.integration.test.ts` → `node scripts/check-live-guards.mjs` exits 1 naming `ops.integration.test.ts:106 C` (QA's false negative, now seen on the real tree).
- mutation (code review, observed): delete the `beforeEach` of `credentials-cli-real-keyring.test.ts` → the new "every test starts from an empty store" goes red in DEFAULT order; with it, 3/3 in default order and shuffled (seed 44).
- mutation (code review, observed): delete `Set (tModify,tGet)=0` from the enable script → `story-44-5-qa-docdb-enable-step.test.ts` "starts the two results at 0…" goes red. Live, on a throwaway (52792, `irishealth-community:2026.2@sha256:462de1fb…`, seeded): a copy whose Modify raises `<METHOD DOES NOT EXIST>` exits 0 without the line (the defect) and 1 with it; the real script exits 0 with `modify=1 get=1 Enabled=1`.
- mutation (code review, observed, live): the interop re-import given `xml: "<not-a-lookup-table/>"` → integration-interop fails at "re-imports the lookup table" (the import succeeds with `entryCount` 0, so the count assertion is what catches it); the ops task run given id `999999` → integration-ops 17/18. Unmutated: integration-interop 21/21, integration-ops 18/18, 0 unlisted skips. The throwaway was removed (`docker ps -a --filter label=iris-mcp.owner=throwaway` empty).
- count pin (AC 44.5.5, re-taken after the review): shared 2651, client-config 1455, iris-admin-mcp 514, iris-data-mcp 205, iris-dev-mcp 1824, iris-interop-mcp 754, iris-ops-mcp 350, iris-mcp-all 7170 = 6986 + 1 + 53 + 29 + 101.

**Shared surfaces:** `LIVE_SUITES['integration-data'].allowedSkips`, `ROOT_GATE_SCRIPTS`, `DECLARED_STEPS.gates`/`.throwaway`, the root `package.json` scripts (`REAL_CHECKS`), and the README CI section. Every test added or changed passes on a fresh environment, in either order (lifecycle chains excepted, as in Boundaries).

### QA

Two files added, both in the default suite of `@iris-mcp/all` (no live IRIS, hermetic, pass in default and `--sequence.shuffle --sequence.seed=44` order): `packages/iris-mcp-all/src/__tests__/story-44-5-qa-scanner-shapes.test.ts` (90 tests) and `packages/iris-mcp-all/src/__tests__/story-44-5-qa-docdb-enable-step.test.ts` (28 tests). `@iris-mcp/all` count after QA: 7039 + 118 = 7157.

Mutations (each applied to the production file, the new test observed red, then reverted with `git checkout --` and `git diff --quiet <file>` clean):
- mutation (QA, observed): `isTestCallback` accepts only arrow functions (drop `ts.isFunctionExpression`) in `live-guard-scan.mjs` -> 3 red (function expression, named function expression, generator).
- mutation (QA, observed): `enclosingFunction` climbs past a callback that is not a test callback -> 4 red (forEach and map returns, an isError `if` in a nested callback, and its blind-spot row).
- mutation (QA, observed): `endsLoudly` reads the first statement of the then-branch instead of the last -> 3 red ("a log, then a throw", a skip call last, "a throw that is not the last statement").
- mutation (QA, observed): `endsLoudly` returns true whenever the `if` has an `else` -> 1 red ("a non-loud then-branch, with the assertion in the else").
- mutation (QA, observed): `main()` of `check-live-guards.mjs` swallows a reader error (try/catch to no findings) -> 2 red (an unreadable file, a covered file missing on disk).
- mutation (QA, observed): `main()` exits 1 only for more than one finding -> 1 red ("one finding in one file is enough for exit 1").
- mutation (QA, observed): `DOCDB_ENABLE_BEFORE = 'integration-dev'` in `ci-checks.mjs` -> 3 red (the lifecycle suite is not immediately after the enable step; the real-ci.yml baseline; the "moved after integration-data" row).
- mutation (QA, observed): `DOCDB_ENABLE_BEFORE = 'prepublish-all'` -> 4 red (the F5-holding suite runs after the enable step, derived from the suites' own file lists; the lifecycle row; the baseline; the "before prepublish-all" row).
- mutation (QA, observed): `ROOT_GATE_SCRIPTS` puts `pnpm check:live-guards` before the epics-sync check -> 3 red (gates order, the baseline, the moved-step row).
- mutation (QA, observed): delete the `enable %Service_DocDB` step from `.github/workflows/ci.yml` -> 11 red (the parsed-workflow order test, the baseline and every mutation row that needs the block).
- mutation (QA, observed): `DOCDB_ENABLE_SCRIPT` names a file that is not on disk -> 15 red (the existence pin, the script pins, the argv run, the workflow rows).
- mutation (QA, observed): drop `--namespace %SYS` from the declared session step -> 7 red, including both argv-run rows (the CLI refuses the step before it reaches the state-file check).
- mutation (QA, observed): restore `export const DOCDB_SKIPS` in `ci-checks.mjs` -> 1 red (the allowlist is gone from the registry module).
- mutation (QA, observed): comment out the `Modify` line of `ci-enable-docdb-service.script` -> 1 red (Modify then Get).
- mutation (QA, observed): split the `Terminate` onto its own line (it would run unconditionally) -> 1 red (the failure line).
- mutation (QA, observed): delete the final `Halt` -> 1 red.
- mutation (QA, observed): add an `it` holding `forEach((r) => { if (!r.isError) {...} })` to `ops.integration.test.ts` -> the new "none of those shapes occurs in an armed file" test goes red naming `ops.integration.test.ts:297`, while `pnpm check:live-guards` still prints `73 armed files, 0 findings` (the scan false negative below, shown on the real tree).

Findings (production, none fixed here; the scanner and CLI are unchanged). Code review resolved both, see `### Review Findings`: the nested-callback scope, the condition forms, the tagged template and the vitest alias are findings now; a `switch` on an outcome and a variable-bound `it` stay documented limits; an empty file list exits 1.
- Scan false negatives, all latent (no armed file holds one; pinned by the new "latent" test, which walks a typed AST independent of the scan's regex). Not in the module header: `created?.x` and `created["x"]` (the pattern is `\bcreated\.`), `result["isError"]` and a destructured `isError`, a `switch` on an outcome, an outcome `if` inside a callback nested in a test (`forEach`, `Promise.all(rows.map(...))`; rule G scopes by the nearest function, and rule C does the same although the spec says "inside a test callback"), `it.each` over a tagged template, and `it`/`test` imported under an alias or bound to a variable. Documented in the header and pinned as such: `&&`/ternary-gated assertions and a non-inline callback.
- `main()` has no zero-file guard: `main([], { files: [] })` returns 0 and prints `0 armed files, 0 findings`. The default list cannot be empty today (`live-guard-check.test.ts` pins more than 60 files), so it is a latent weakness of the gate, not a defect of the shipped tree.

**Lead (post-push):** the armed CI run URL of the `epic44` tip goes here (AC 44.5.4).

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** Every one of the 48 silent-pass sites in the armed integration files is now a hard assertion (admin 22, interop 8 guards and 10 branches, ops 4 and 1, data 3). `pnpm check:live-guards` (`scripts/lib/live-guard-scan.mjs`, `scripts/check-live-guards.mjs`) refuses a guard return (rule G) or an `isError`/`created.` conditional outcome (rule C) in the 73 armed files. It runs as a gates step, as a release `prepare` check and in the default suite through `live-guard-check.test.ts`. CI now runs the DocDB lifecycle: `scripts/ci-enable-docdb-service.script` enables `%Service_DocDB` after `prepublish-all` and immediately before `integration-data`, and the nine DocDB allowlist entries are gone. The admin create defects were test bugs and are fixed (database `directory`, OAuth `customizationRoles`, no swallowed `IrisApiError`, OAuth verify asserts the server is listed). The dev integration suite runs `DocDbRegisterTest` (5) and `DocDbRegisterNamespaceTest` (3). DW-753's shared fake store is cleared before each test.

**Files changed.**
- `scripts/lib/live-guard-scan.mjs`, `scripts/check-live-guards.mjs` (new): the scan and its CLI. `package.json` adds `check:live-guards`.
- `scripts/ci-enable-docdb-service.script` (new), `scripts/lib/ci-checks.mjs`, `.github/workflows/ci.yml`: the enable step, the gates step, the empty `integration-data` allowlist.
- `packages/iris-{admin,interop,ops,data}-mcp/src/__tests__/*.integration.test.ts`: the 48 conversions and the admin fixes.
- `packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts`: the two DocDB IRIS-side legs.
- `packages/shared/src/__tests__/credentials-cli-real-keyring.test.ts`: `beforeEach` clear (DW-753).
- `packages/iris-mcp-all/src/__tests__/live-guard-check.test.ts` (new, 52 tests), `ci-workflow.test.ts`, `ci-live-suite.test.ts`, `release-prepare.test.ts`, `release-script-fixtures.ts` (adds the new root check to the fixture world; not in the spec's file list, required by `prepare`).
- `README.md`, `CHANGELOG.md`: CI section and the Story 44.5 entry.

**Review.** Four layers (blind, edge-case, verification-gap, intent-alignment); 21 triage rows: high 0, medium 3, low 14, false 4. Patched: a spawn test of the real CLI entry point and root script (medium); the skip-helper exemption now needs the condition to be the helper call itself, so `skipIfReason(...) || !id` is a finding (medium); the vacuous `findIndex` in the throwaway-order test; observed `mutation:` lines for the allowlist pins. Deferred: 1 (below). Rejected: the rest, each with its reason in the Review Triage Log.

**Deferred for the lead (product defect).** `iris_database_manage delete` removes only the CPF entry; the database stays mounted and `IRIS.DAT` stays on disk, so a second admin integration run on one instance fails at create (ERROR #60). CI is unaffected (fresh container). The test keeps the literal directory so the defect is not hidden.

**Follow-up review recommended: true.** Two medium findings were patched on this first pass (the scan's skip-helper rule and the new entry-point test); the unverified risk is that the tightened rule (b) reads a legitimate skip-helper shape as a finding that the 73 current files do not contain. The real tree scans at 0 findings after the change, so the risk is only for shapes added later.

**Verification performed.**
- `pnpm check:live-guards`: `73 armed files, 0 findings`.
- Full `@iris-mcp/all` suite on a closed port (IRIS_PORT=1, `IRIS_REQUIRE_LIVE` unset), 4 shards, each exit 0 (1719, 1642, 1523 and 1467 tests passed; the rest skipped without a live IRIS). Full `@iris-mcp/shared` suite 2650/2650; the keyring test passes shuffled (seed 44) and in default order, 2/2.
- `pnpm run lint`, `pnpm run type-check` green; `gen:governance-baseline:check`, `gen:ipm:check`, `node scripts/check-epics-sync.mjs` OK.
- `vitest list --json` counts: `@iris-mcp/all` 7039 = 6986 + 1 + 52; admin 514 (unchanged); the implementer verified the other packages unchanged.
- Throwaway (52792, `irishealth-community` 2026.2, seeded, CI order, run by the implementation pass): F5 passed (not skipped); enable step exit 0 with `Enabled=1`; integration-admin 28/28, -data 12/12 (0 skipped), -dev 33/33 (DocDB legs 5 and 3), -interop 21/21, -ops 18/18, 0 unlisted skips; torn down, `docker ps -a --filter label=iris-mcp.owner=throwaway` is empty.
- Mutations (Rule 19): all in `## Verification`; the implementation pass ran seven (guard re-added, tolerated create, dropped `directory`, enable `Modify` removed, DocDB step moved earlier, flipped DocDB assertion, `beforeEach` removed), and the review pass observed three more. Each was reverted.

**Residual risks.** The scan is syntactic: it does not follow helpers, `&&`/ternary-gated assertions or swallowed exceptions (documented in the module header). The armed CI run of the `epic44` tip is lead-owned. `_bmad-output/implementation-artifacts/cycle-log-epic-44.md` carries an uncommitted line written by the lead during this run; it is not part of this story's diff and was left untouched.
