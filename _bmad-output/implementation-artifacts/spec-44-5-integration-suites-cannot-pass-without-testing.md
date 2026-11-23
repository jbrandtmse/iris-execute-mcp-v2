---
title: 'Story 44.5: Integration Suites Cannot Pass Without Testing'
type: 'chore'
created: '2026-11-23'
status: 'ready-for-dev'
baseline_revision: 'd634a597a4196521eacbc4437d413872e909b67e'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
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
- Given the baseline `vitest list --json` lengths (Design Notes), when they are re-taken after the story, then every package except `@iris-mcp/all` is unchanged, and `@iris-mcp/all` equals 6986 + 1 + the number of tests in `live-guard-check.test.ts` (AC 44.5.5, Rule #19).
- Given the README CI section and the new CHANGELOG section, when they are read, then neither claims that an early return is invisible to CI or that CI skips the DocDB lifecycle (AC 44.5.5).
- Given the story pushed by the lead, when CI runs on the `epic44` tip, then the run is green. The lead records its URL in this spec's Verification as the epic-done evidence (AC 44.5.4; lead-owned).

## Spec Change Log

- 2026-11-23 (lead, spec gate, decision #147): DocDB-in-CI choice accepted (CI runs the lifecycle; enable step after `prepublish-all`, before `integration-data`). `epics.md` Story 44.5 gains the DW-726 and DW-753 bullets and the decision tag. Spine AD-29's CI rule names the live-guard check and the DocDB enable step. The admin create fixes (`directory`, `customizationRoles`) are test bugs fixed in-story (AC 44.5.4's own rule).

## Review Triage Log

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

**Shared surfaces:** `LIVE_SUITES['integration-data'].allowedSkips`, `ROOT_GATE_SCRIPTS`, `DECLARED_STEPS.gates`/`.throwaway`, the root `package.json` scripts (`REAL_CHECKS`), and the README CI section. Every test added or changed passes on a fresh environment, in either order (lifecycle chains excepted, as in Boundaries).

**Lead (post-push):** the armed CI run URL of the `epic44` tip goes here (AC 44.5.4).

## Auto Run Result

Status: ready-for-dev
Blocking condition: none. The run halted after planning, as the invocation directed.
