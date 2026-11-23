---
title: 'Story 44.4: Bootstrap Compile Result Accuracy'
type: 'bugfix'
created: '2026-11-23'
status: 'ready-for-dev'
baseline_revision: 'b3706e8730ace4d73130ae8a2c533dd5e8933d90'
baseline_commit: 'b3706e8730ace4d73130ae8a2c533dd5e8933d90'
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

**Problem:** `bootstrap()` decides "compiled" from whether `POST action/compile` threw (`bootstrap.ts:877-878`, `:919-920`). The planning probe shows that this misses a failed class whenever the compile also writes a class's Storage: `General.Compile` then replaces the compile status, and IRIS answers HTTP 200 with no status error. When it does throw, IRIS's status names at most one error, so the report does not say which classes failed. The `unconfigured` branch registers the web app even after a failed compile, so the next start probes `current` and the failure is not reported again (DW-685). Three other consumers judge a compile by English console lines (Rule #13).

**Approach:** Add one shared check in `@iris-mcp/shared`. After an answered compile, two existing Atelier reads decide per class: an `action/query` over `%Dictionary.ClassDefinition` LEFT JOIN `%Dictionary.CompiledClass`, and `GET docnames/CLS?filter=` for IRIS's own `upd` flag. A class compiled only when it has a compiled row, no `ClassCompileError`, and `upd` true. Both bootstrap call sites, the CI seed, the live doc helpers and the bootstrap-guard seed use this check. A failed compile names the classes and stops the privileged steps on every branch.

## Boundaries & Constraints

**Always:**
- The check is the only success test for a compile in the four consumers. No consumer reads `console`, and no code parses or matches IRIS message text (Rule #13). IRIS's `status.errors[].error` text is passed through to a person as context, made one line with `oneLine(…, 300)`, and never decides anything.
- `compiled` is true only when the compile answered without a status error AND the check confirms every listed class. A compile that IRIS answered with a status error stays a failure even if the check is clean (that is today's behavior, kept).
- Error texts, exactly:
  - classes named: `Compile failed: <k> of <n> classes did not compile: <A>, <B>`. The names are class names without `.cls`, in list order. When IRIS sent status errors, append `. IRIS reported: <oneLine(texts joined " | ", 300)>`.
  - IRIS errors with a clean check: `Compile failed: IRIS reported errors: <oneLine(…, 300)>`.
  - the check's own requests fail: `Compile failed: the check that every class compiled could not run: <describeFailure(error)>`.
  - a compile request that fails without an Atelier answer (transport error, non-2xx): today's `Compile failed: <message>`, unchanged, and no check requests are sent.
- A failed or unverifiable compile stops the privileged steps (Configure, mapping, `^UnitTestRoot`) on all three writing branches (`missing`, `stale`, `unconfigured`): `configured`, `mapped` and `unitTestRootEnsured` stay false, and no request for them is sent. This changes the `unconfigured` branch (decision under Design Notes).
- Back-compat (AD-15, Rule #19): on a clean compile every `BootstrapResult` field is byte-identical to the pre-story capture. The only additions are the check's requests after each compile: 1 `action/query` plus 1 `docnames` GET per distinct top-level package (the roster has one). `current`, `newer`, `foreign`, `unknown` and IPM-owned runs send no new request. `compileClasses` keeps its signature and behavior.
- Fakes answer only shapes the planning probe captured (Rule #54, #36). The captures are under Design Notes; reuse them verbatim and never edit them to fit the code.
- Live checks run only on throwaways (`scripts/throwaway-iris.mjs`), never on the shared instance. Disposable classes are `ExecuteMCPv2.Temp.Story444*` and are deleted afterwards.

**Never:**
- No IRIS-side class change. `BOOTSTRAP_VERSION` stays `1.1.0+3.3e97060f5bc4`. No `gen:bootstrap`, no `gen:ipm` (`:check` only), no IPM tree change.
- No new tool, action, governance key, refusal code, tool description or schema change. No Frozen goldens entry and no tools-list snapshot change.
- No `POST action/index` (it returned 389 KB for the roster) and no `Setup` method.
- No check on the `current` path. That is the lead's call, recorded in `deferred`.
- No change to `iris_doc_compile` (recorded in `deferred`) or to `scripts/lib/fake-iris-listener.mjs`.

## I/O & Edge-Case Matrix

Each row uses the compile list a branch sends: the 35-class roster for bootstrap, or the caller's list for the other consumers. "Check" means the per-class verdict: row, error flag, `upd`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Clean compile | HTTP 200, no status error; every class has a row, no error, `upd` true | `compiled: true`; the `BootstrapResult` equals the pre-story capture; 2 more requests | none |
| Partial failure, Storage written | HTTP 200, `status.errors` `[]`, `result.content` lists the Storage-written class; X has `CompileError` 1 and `upd` true | `compiled: false`; `Compile failed: 1 of n classes did not compile: X` with no IRIS clause; privileged steps skipped | named, fail-closed |
| Partial failure, status error | HTTP 200, one status error (IRIS names only Y); X has an error flag, Y has no row | `compiled: false`; both X and Y named, in list order, plus `. IRIS reported: …` | named |
| All fail | every class flagged or rowless | every class named | named |
| Skipped dependant | D has an old row, no error flag, and `upd` false (its dependency failed) | D named | named |
| Rollback to identical content | a row and no error; timestamps differ, but `upd` true (hash match) | counts as compiled, not named | none |
| Unconfigured plus failure | probe `unconfigured`; the recompile fails | `compiled: false`; `configured`, `mapped` and `unitTestRootEnsured` false; no Configure, mapping or `^UnitTestRoot` request | stops |
| Compile request fails | transport error or non-2xx from `action/compile` | today's text and flags; no check requests | as today |
| Check cannot run | `action/query` or `docnames` fails | `compiled: false`; "could not run" text; privileged steps skipped | fail-closed |
| IRIS errors, check clean | status error; every class confirmed (not observed live; kept so that no status error is ever read as success, as today) | `compiled: false`; `Compile failed: IRIS reported errors: …` | as today |
| Localized console | the de-DE or ja-JP console captures, with or without a flagged class | the result depends only on the check (clean: true; flagged: false, named) | none |

</intent-contract>

## Code Map

- `packages/shared/src/bootstrap.ts` -- `oneLine` (:158), `describeFailure` (:164), `compileClasses` (:422-437; the sibling the new check extends), `bootstrap()` (:790-969): the `current` path (:829-845, unchanged), the `unconfigured` recompile (:869-887; it continues to Configure today), the `missing`/`stale` compile (:913-928; returns before the privileged steps today), the privileged tail (:930-966), `runPrivilegedSteps` (:522) and `ensureUnitTestRootStep` (:564).
- `packages/shared/src/index.ts:120-130` -- the bootstrap exports. Add the check and its report type.
- `packages/shared/src/http-client.ts:405-431` -- throws `IrisApiError` for a non-2xx answer, and for HTTP 200 with a non-empty `status.errors` (`statusCode` 200, `errors` the raw entries). That is how a status-error compile surfaces today.
- `packages/shared/src/errors.ts:33-78` -- `IrisApiError` (`statusCode`, `errors`, `formatIrisErrors`).
- `packages/shared/src/server-base.ts:2981-2994`, `:3241-3249` -- the two `bootstrap()` call sites (the default warm-up and the lazy profile). They log `Bootstrap completed with errors: <errors joined "; ">`. Unchanged; these are the operator-visible surface.
- `scripts/ci-seed-throwaway.mjs` -- `bootstrapProblems` (:104-113), `compileProblems` (:115-134; it matches `ERROR\s*#\d+` and `Compilation finished successfully`), the seed flow (:198-216; `compileClasses` then `compileProblems`).
- `packages/iris-dev-mcp/src/__tests__/live-doc-helpers.ts:107-125` -- `compileDocs` (requires the English `Compilation finished successfully`). It is called with `.cls` names only, by the five dev live gates (`doc-edit-`, `doc-put-storage-guard-`, `storage-guard-write-paths-`, `story-42-11-qa-`, `sql-safety-live-gate.test.ts`). The storage-guard fixtures are exactly where the compile writes Storage.
- `packages/iris-mcp-all/src/__tests__/bootstrap-guard-legs.ts` -- `failureOf` (:150-160; it matches console `ERROR #\d+`, which misses `خطأ #5373` when no `Accept-Language` is sent, as `atelierWrite` does), `seedInstance` compile (:198-202), `runServer` (:446), `SeedCompileError`.
- `packages/iris-mcp-all/src/__tests__/story-42-2-bootstrap-guard-live-gate.test.ts` -- the throwaway-armed gate. CI runs it on both community images (`scripts/lib/ci-checks.mjs:186-198`); `beforeAll` (:76-110) needs a fresh instance; the legs are at :112-130.
- `packages/iris-mcp-all/src/__tests__/stateful-fake-atelier.ts` -- the hooks `failCompile` and `compileConsole` (:28-38, :101-104; today both compile nothing, which is not what IRIS does), compile (:276-299), query (:184-227), `summarizeRequests` (:134-150; a `docnames` GET lands in `others`).
- Tests that pin the request sequence or the hooks:
  - `packages/shared/src/__tests__/bootstrap.test.ts`: `fetchMock` reply queues; each compile reply now needs the two check replies after it. `compileCount` :125, `compileClasses` :621-660, orchestration :736+, failures :1240-1320.
  - `packages/iris-mcp-all/src/__tests__/ci-seed-throwaway.test.ts`: :147-185 (`compileProblems`), :229-354 (seed on the fake; `failCompile`/`compileConsole` rows :301-340).
  - `packages/iris-mcp-all/src/__tests__/story-42-2-bootstrap-guard-orchestration.test.ts`: `summarizeRequests` pins :126-160, :229-258, :331-403. Its `writes` filter at :128 would count the check query as a write.
- Docs: `README.md:1061` (the unconfigured self-heal says "re-registers … then recompiles"), `packages/shared/README.md:62` (`bootstrap()`) and `:66` (`compileClasses()`), `CHANGELOG.md` (top section `[Unreleased] — Story 44.6`), `.changeset/story-44-3-confirmation-bound-to-the-scope-shown.md` (the pattern).
- Read-only evidence: `irislib/%Atelier/v1/Utils/General.cls:1299-1395` (the `CompileList` status is overwritten inside the updated-Storage loop), `irislib/%Api/Atelier/v1.cls:1576-1640` (every version v1-v8 routes to it), `:1675-1890` (`GetDocNames` sets `upd` from `%RoutineMgr.TS`), `irislib/%Library/RoutineMgr.cls:152-260` (`upd` for a class: the definition time equals the compiled `TimeCreated`, or the hash matches, and every routine's object is current), `irislib/%Dictionary/CompiledClass.cls:20-21` (`ClassCompileError`).

## Tasks & Acceptance

**Execution:**
1. `packages/iris-mcp-all/src/__tests__/story-44-4-compile-oracle.test.ts` (new), FIRST, before any source edit:
   - Capture the pre-story `BootstrapResult` of the built baseline dist against the stateful fake on `missing`, `stale` and `unconfigured`, each with a clean compile. Paste each capture into the test as a literal, with the capture command and the baseline revision in a comment.
   - Write the AC 44.4.5 red row: the fake answers the roster compile with the "Storage written" capture, flagging `ExecuteMCPv2.REST.Health`, and `compiled` is expected false. Against the baseline it is true: record that red run under Verification.
2. `stateful-fake-atelier.ts` -- the fake keeps per-class compile state: compiled from a doc `ts`, an error flag, and whether `upd` holds.
   - A clean compile compiles every listed class.
   - Replace `failCompile` and `compileConsole` with one hook, `compileFailure(names) => { failed: {name, kind: "routine" | "class"}[], shape: "status-errors" | "storage-written", console?: string[] } | undefined`. The listed classes that are not failed still compile, as IRIS does.
   - A `routine` failure keeps a row with the error flag and `upd` true. A `class` failure leaves no row on a first compile, and keeps the old row with the error flag and `upd` false when one existed.
   - `status-errors` answers HTTP 200 with ONE status error, in the captured `{error, code, domain, id, params}` shape, for the first failed class (as IRIS does in the all-fail case).
   - `storage-written` answers HTTP 200, `status.errors: []`, `summary: ""`, and a `result.content` entry for a Storage-written class in the captured shape.
   - Answer the check's SQL and `GET docnames/CLS?filter=` with the captured row and entry shapes.
   - Update the CONTRACT header. Every other reply stays byte-identical.
3. `packages/shared/src/bootstrap.ts`:
   - Add `compileAndVerify(http, config: Pick<IrisConnectionConfig, "namespace">, version, names = roster)` returning `{ notCompiled: string[]; irisErrors: string[]; envelope?: AtelierEnvelope<unknown> }`. It calls `compileClasses`. An `IrisApiError` with a 2xx `statusCode` is a compile that IRIS answered: keep its `errors[].error` texts and go on to the check. Rethrow anything else.
   - Add `verifyCompiled(http, namespace, version, names)`, exported. It refuses a name that does not end in `.cls`, and sends the SQL in Design Notes plus one `docnames/CLS?filter=<first segment>.` GET per distinct first segment.
   - Rewrite both compile sites to use it, with the Boundaries texts. On failure, return before the privileged steps on every branch. Log the success line only on a verified compile.
   - Update the doc comments: `bootstrap()` step 3, the `unconfigured` rationale (:861-868) and `compileClasses` ("the bootstrap flow ignores it" becomes "use `compileAndVerify` to judge it").
4. `packages/shared/src/index.ts` -- export `compileAndVerify`, `verifyCompiled` and `type CompileReport`.
5. `scripts/ci-seed-throwaway.mjs` -- the seed calls `compileAndVerify` from the dist. `compileProblems(report)` becomes a pure formatter over the report: one `did not compile: <name>` per class, plus each IRIS text as context, and no console reading. Update its doc comment and the header claim about `General.Compile`.
6. `live-doc-helpers.ts` -- `compileDocs` keeps its name, signature and return value (the console lines), and throws `compiling <names> did not finish successfully: <names not compiled>` from `compileAndVerify` instead of matching the console.
7. `bootstrap-guard-legs.ts` -- `seedInstance` judges its compile with `verifyCompiled` (via an `IrisHttpClient` built from the target) plus `status.errors`. `failureOf` stops reading console lines for every request (the other answers carry their failure in the HTTP status and `status.errors`).
8. Tests, mutation-recorded:
   - `story-44-4-compile-oracle.test.ts`: every Matrix row through `bootstrap()` (built shared dist against the stateful fake, both bootstrap call sites), `compileAndVerify` and `verifyCompiled`; the two localized captures; the unconfigured pin; the request-count pin (+2).
   - `bootstrap.test.ts`: add the two check replies after each compile reply (a helper beside `mockResponse`); no other expectation moves except the unconfigured test of a failed compile (now `configured: false`).
   - `ci-seed-throwaway.test.ts`: the `compileProblems` rows over reports; the seed rows use `compileFailure` (status-errors and storage-written) and name the class.
   - `story-42-2-bootstrap-guard-orchestration.test.ts`: the check's query and GET added to the pinned windows, and kept out of the `writes` filter.
9. `story-42-2-bootstrap-guard-live-gate.test.ts` -- a `describe("Story 44.4: the compile check on a throwaway")` after the legs, each test seeding and removing its own state:
   - (L1) `compileAndVerify` over `ExecuteMCPv2.Temp.Story444Good`, `Story444Broken` (its method body uses an undefined macro) and `Story444Store` (a `%Persistent` with no Storage section, so the compile writes it). Expect `notCompiled` to equal `["ExecuteMCPv2.Temp.Story444Broken.cls"]`, `irisErrors` `[]`, and the envelope's `result.content` to name `Story444Store`. Delete the three documents afterwards.
   - (L2) Seed the embed as current and configured. Delete the web app through the service's own route (`POST /api/executemcp/v2/security/webapp {"action":"delete","name":"/api/executemcp/v2"}`). PUT `ExecuteMCPv2.REST.Health.cls` with one appended method `Story444Broken` whose body uses an undefined macro. Run the dev server with `runServer`. Its stderr carries `Compile failed: 1 of 35 classes did not compile: ExecuteMCPv2.REST.Health`, and `Setup_IsConfigured()` answers false. Re-seed afterwards.
10. Docs:
    - `README.md:1061`: a failed recompile stops before re-registering and names the classes; the next start retries.
    - `packages/shared/README.md`: the `bootstrap()` entry (the dictionary check, the failure text, the unconfigured stop) and entries for `compileAndVerify` and `verifyCompiled`.
    - `CHANGELOG.md`: `## [Unreleased] — Story 44.4: Bootstrap Compile Result Accuracy` above the 44.6 section (em dash). "Fixed" names DW-685; "Changed" covers the unconfigured stop and the two extra requests.
    - `.changeset/story-44-4-bootstrap-compile-result-accuracy.md`: `@iris-mcp/shared` patch.

**Acceptance Criteria:**
- AC 44.4.1: Given the planning probe (Design Notes, "Probe findings"), when the implementer reads it, then the envelope fields for (a), (b) and (c) on Atelier v1-v8 of 2026.1, 2026.2 and IRIS for Health 2026.2 are recorded there, and Story 42.3's claim is settled: it is true only when the compile writes a class's Storage. No re-probe is needed. The captures are the fixtures' oracle.
- AC 44.4.2: Given a compile of any listed classes, when `compileAndVerify` returns, then `notCompiled` names exactly the classes without a compiled row, with `ClassCompileError` set, or with `upd` false, in list order, and no localized text is read. **Pinning gate (Rule #59; path: `bootstrap()`'s `missing`/`stale` call site → `compileAndVerify` → `verifyCompiled`, in the built shared dist against the stateful fake):** the "Storage written" row. Mutation: `verifyCompiled` returns `[]` → red.
- AC 44.4.3: Given a failed compile on each of the `missing`, `stale` and `unconfigured` branches, when `bootstrap()` returns, then `compiled` is false, `errors` holds the Boundaries text naming the classes, and no privileged-step request was sent. Mutations: drop the early return on the `unconfigured` branch → the unconfigured row goes red; take the names from `irisErrors` → the "status error" row (Y named) goes red.
- AC 44.4.4: Given the seed, `compileDocs` and `seedInstance`, when a listed class fails, then each names it from the check. A grep of the four consumers' source for `console` and `Compilation finished` finds no decision on console text. No Rule #13 residual remains for these `.cls` compiles.
- AC 44.4.5: Given the fake's "Storage written" and "status error" answers and the de-DE and ja-JP console captures, when the matrix rows run, then the results match the Matrix (red first, recorded). Given a throwaway on the current and the oldest community image, when L1 and L2 run armed, then both pass. Mutation: ignore the check → L1 and L2 go red.
- AC 44.4.6: Given a clean compile on `missing`, `stale` and `unconfigured`, when `bootstrap()` returns, then the result `toEqual`s the pre-story capture, and the fake records exactly 2 more requests per compile than the baseline (pinned). `BOOTSTRAP_VERSION` is unchanged (the drift test). Mutation: add a field to the clean-path result → red.
- Integration AC (Rules 1/2): Given the built dist, when `scripts/ci-seed-throwaway.mjs` seeds the fake with a failing fixture, then it exits 1 and its log names that class from the check. Given a throwaway, when the dev server boots on a broken roster class (L2), then its stderr warning names the class.
- DW-685 (action item `epic-42-retro-item-7-charter-a-story-in-the-next-planned-epic`): Given any compile the bootstrap runs, when IRIS answers HTTP 200 with a failure that is only in the console, or with a status that names only some of the failures, then `compiled` is false and every failing class is named from a signal that is not localized text (AC 44.4.2-44.4.5). The action item closes at the Epic 44 retrospective with the owner's confirmation.

- AC 44.4.7 *(lead amendment at the spec gate, wave-9 decision #145; was the first `deferred:` item)*: Given a `stale` (upgrade) bootstrap whose compile partly failed, when the NEXT start probes `current`, then that start also runs the same check (`verifyCompiled`, the two reads, no compile) over the roster and reports `compiled: false` with the failing classes named and the privileged steps skipped, instead of asserting `compiled: true` (`bootstrap.ts:829-845`). This is DW-685's own symptom on the next connect. The cost is recorded and pinned: exactly 2 extra requests on a clean `current` start (fake Atelier request count `toEqual` the baseline plus 2), and a clean `current` start's result `toEqual`s the pre-story capture. Mutation: skip the check on `current` -> the next-start row goes red. Live (Rule #48): on the throwaway, break a roster class, bootstrap (fails), bootstrap again -> the second start reports the class by name.

## Spec Change Log

- 2026-11-23 (lead, spec gate, decision #145): AC 44.4.7 added (the next-start `current` check, from the first `deferred:` item, now in scope); the `unconfigured` stop confirmed; the `iris_doc_compile` item harvested to the ledger as DW-754 (routed to the burn-down) and removed from `deferred:`.

## Review Triage Log

## Design Notes

**Governing ADs (Rule 6).**
- AD-14 "on failure": the check is the success test, and no localized text is read.
- AD-11: `status.errors` is still an error.
- AD-12: the interpretation lives in TypeScript; no IRIS-side change.
- AD-15: the clean path is byte-identical; failure-path values change.
- AD-2: the check lives in `@iris-mcp/shared`; consumers import it.
- Conventions: Live testing on a shared instance (throwaway only), Probes and references, Performance budgets.

No AC contradicts an AD.

**Probe findings (live, 2026-11-23; throwaways on port 52792, all removed; the 2026.1 image the session pulled was removed).** Images: `iris-community` 2026.2 Build 221U, `iris-community` 2026.1 Build 234U (the oldest), and `irishealth-community` 2026.2. Each offers Atelier `api: 8`, and v1-v8 all route `action/compile` to `%Atelier.v1.Utils.General.Compile`. The results were identical on every image and version:

| Case | HTTP | `status.errors` | `status.summary` | `result.content` | `console` |
|---|---|---|---|---|---|
| (a) all compile | 200 | `[]` | `""` | `[]` | `…Compilation finished successfully…` (localized) |
| (b) one fails, no Storage written | 200 | ONE entry `{error, code, domain, id, params}` | that error's text | `[]` | `ERROR…` lines (localized) |
| (b) one fails, the compile writes another class's Storage | 200 | `[]` | `""` | `[{name, status:"", content:[Storage…], db, ts, enc:false, flags:1}]` | the only place the failure shows |
| (c) all fail | 200 | ONE entry (Y's #5373; X's #5475 is missing) | that error's text | `[]` | localized |

- **42.3's claim:** true only when a class in the list has its Storage written (the `tUpdated` loop overwrites `tSC`). Otherwise the status survives, and `IrisHttpClient` throws on it, so today's bootstrap of the roster (no persistent class) already reports `compiled: false`. Verified live: the error was `Compile failed: IRIS reported errors … ERROR #5475 … ExecuteMCPv2.REST.Health …`. Real documents never carry `errors`.
- **DW-685's "reports compiled=true whatever"** is therefore wrong for today's roster at compile time. Where it is observed is the next start: live, the `unconfigured` branch configured anyway, and the following start answered `current`, `compiled: true`.
- **The locale is set per request.** With no `Accept-Language` header, IRIS answered in Arabic (`خطأ #5373`); `de-DE` and `ja-JP` give translated console lines. `Compilation finished successfully` appears only in English.

**Oracle choice (AC 44.4.2), from 11 scenarios run on each image:**

| Candidate | Misses |
|---|---|
| Envelope fields | The Storage-written partial failure; it also names one failure at most. |
| SQL row + `ClassCompileError` alone | A dependant skipped with its old row (no error flag). |
| Timestamps (`TimeCreated`/`TimeChanged` against the definition) | Wrongly fails a rollback to identical content, which the compiler treats as up to date by hash. |
| Atelier `upd` alone | Routine failures: `upd` stays true. |
| `upd` (docnames) + row + `ClassCompileError` | Nothing: all 11 scenarios correct on every image. |
| `action/index` | Also carries `upd`, but returned 389 KB for the roster (docnames: 4 KB). |
| A `Setup` method | Would bump `BOOTSTRAP_VERSION` and depends on the classes under test. |

A `%Developer`-only user can run both reads. The cost is about 55-75 ms (query) plus 20 ms (docnames) for 35 classes. The earliest IRIS verified is 2026.1 Build 234U.

**The check (exact).**
- SQL, one `?` per class name without `.cls`:
  `SELECT d.ID AS ID, CASE WHEN c.ID IS NULL THEN 0 ELSE 1 END AS Compiled, CASE WHEN c.ClassCompileError IS NULL OR c.ClassCompileError = '' THEN 0 ELSE 1 END AS CompileError FROM %Dictionary.ClassDefinition d LEFT JOIN %Dictionary.CompiledClass c ON c.ID = d.ID WHERE d.ID IN (?, …)`
  It answers rows like `{"ID":"X","Compiled":1,"CompileError":0}`; the values are JSON numbers.
- Docnames: `GET /api/atelier/v<N>/<ns>/docnames/CLS?filter=<first segment>.` answers entries `{"name":"X.cls","cat":"CLS","ts":"2026-11-23 10:20:27.782","upd":true,"db":"USER","gen":false}`. The filter is `LIKE '%…%'`, and mapped classes are included (`StudioOpenDialog` `Mapped` defaults to 1).
- A class counts as compiled only with a definition row, `Compiled` 1, `CompileError` 0, and a docnames entry with `upd === true`.

**Captured fixtures (reuse verbatim; source files escape non-ASCII, Rule 14).**
- Status error: `{"error":"ERROR #5475: Error compiling routine: User.P444X.  Errors:  User.P444X.cls\r\nERROR:  User.P444X.1(3) : MPP5610 : Referenced macro not defined: 'NoSuchMacro444'\r\n TEXT:   Quit $$$NoSuchMacro444 }","code":5475,"domain":"%ObjectErrors","id":"RoutineCompilationErrorWithInfo","params":["User.P444X","User.P444X.cls\r\nERROR:  User.P444X.1(3) : MPP5610 : Referenced macro not defined: &#39;NoSuchMacro444&#39;\r\n TEXT:   Quit $$$NoSuchMacro444 }","","","","",""]}` and `{"error":"ERROR #5373: Class 'User.NoSuchSuper444', used by 'User.P444Y:superclass', does not exist","code":5373,"domain":"%ObjectErrors","id":"PredecessorClassDoesNotExist","params":["User.NoSuchSuper444","User.P444Y:superclass","","","","",""]}`. Substitute the class names.
- Storage-written `result.content` entry: `{"name":"User.P444P.cls","status":"","content":["Storage Default","{",…],"db":"USER","ts":"2026-11-23 10:18:04.098","enc":false,"flags":1}`.
- de-DE console (Storage-written partial failure): `["","Kompilierung begonnen am 11/23/2026 10:18:04 mit Qualifizierern 'cuk'","Class User.P444A ist auf dem neuesten Stand.","Kompilieren von 2 Klassen","Kompilieren der Klasse User.P444X","Kompilieren der Klasse User.P444P","Kompilieren der Tabelle SQLUser.P444P","Kompilieren der Routine User.P444X.1","ERROR: User.P444X.cls","ERROR:  User.P444X.1(3) : MPP5610 : Referenzmakro nicht definiert: 'NoSuchMacro444'"," TEXT:   Quit $$$NoSuchMacro444 }","ERROR: User.P444X.cls(Hi+2) #1002: Invalid character in tag : '}' : Offset:26 [Hi+1^User.P444X.1]"," TEXT:   Quit $$$NoSuchMacro444 }","Kompilieren der Routine User.P444P.1","2 Fehler während der Kompilierung in 0.028s erkannt."]`
- ja-JP console (same compile): `["","11/23/2026 10:18:04 に修飾子 'cuk' でコンパイルを開始しました。","Class User.P444Aは最新状態です。",", 2 クラスをコンパイル中","クラスのコンパイル中 User.P444X","クラスのコンパイル中 User.P444P","テーブルのコンパイル中 SQLUser.P444P","ルーチンのコンパイル中 User.P444X.1","ERROR: User.P444X.cls","ERROR:  User.P444X.1(3) : MPP5610 : 参照マクロが定義されていません: 'NoSuchMacro444' "," TEXT:   Quit $$$NoSuchMacro444 }","ERROR: User.P444X.cls(Hi+2) #1002: Invalid character in tag : '}' : Offset:26 [Hi+1^User.P444X.1]"," TEXT:   Quit $$$NoSuchMacro444 }","ルーチンのコンパイル中 User.P444P.1","0.027s のコンパイル中に 2 エラーを検出しました。"]`
- Live clean-install `BootstrapResult` (2026.2, today's dist): `{"probeFound":false,"probeStatus":"missing","deployed":true,"compiled":true,"configured":true,"mapped":true,"unitTestRootEnsured":true,"errors":[],"unitTestRoot":"/usr/irissys/mgr/"}`.
- The raw captures of this session are in the scratchpad directory (`p444/out-*.json`, `signals-*.json`, `oracle-*.json`, `client-current.json`, `bootstrap*-current.json`).

**Unconfigured decision (AC 44.4.3: "keep or change, and pin").** Changed: a failed compile stops the privileged steps here too. Keeping the old behavior registered the web app, after which the next start probes `current`, reports `compiled: true` and never mentions the failure again (seen live). Stopping keeps the instance `unconfigured`, so every start recompiles and reports it until it is fixed. The cost: a broken class leaves the custom REST service unregistered rather than partly working. This also matches AC 44.4.3's "as a thrown compile does today" and the fail-safe direction (Rule #44).

**Corrections for the lead (Rule #42; `epics.md` not edited; apply-and-report tier).**
1. AC 44.4.1 / DW-685: the claim holds only when a class in the list has its Storage written. See Probe findings.
2. AC 44.4.2: the chosen check is two existing Atelier reads (`action/query` plus `docnames` `upd`), not `action/query` alone, because no SQL column carries the compiler's hash-based up-to-date test.
3. AC 44.4.4 lists two console consumers. There is a third: `bootstrap-guard-legs.ts` `failureOf`. It is included (Rule #56).
4. The anchors `bootstrap.ts:877-878` and `:919-920` are correct.

**For the lead (Rule 20 spine bookkeeping, at the story's bookkeeping commit).**
- AD-14 "on failure", as built: the check (dictionary row + `ClassCompileError` + Atelier `upd`, two reads after each compile), and the stop of the privileged steps after a failed compile on every writing branch, `unconfigured` included.
- AD-15: record whether the `unconfigured` stop needs a sanction entry. The output shape is unchanged; only failure-path values change.
- The two `deferred` items (the next-start `current` path; `iris_doc_compile`) are for harvest.

**Integration ACs, Consumes and Consumed-by (Rules 1/2).**
- `compileAndVerify`/`verifyCompiled` is a shared component. Its consumers in this story are `bootstrap()` (both call sites, surfaced by `server-base.ts`), `scripts/ci-seed-throwaway.mjs`, `live-doc-helpers.ts` `compileDocs` and `bootstrap-guard-legs.ts` `seedInstance`. The Integration AC drives the seed against the stateful fake and the dev server against a throwaway.
- Consumes: `compileClasses`, `atelierPath`, `IrisHttpClient`, `oneLine`/`describeFailure`.
- Consumed-by: Story 44.5, whose armed-suite inventory covers the seed, the live gates and the bootstrap-guard gate as this story leaves them.

**Extend, don't copy (Rule 2).**
- `compileAndVerify` extends `compileClasses`.
- The fake extends `stateful-fake-atelier.ts`; no new fake.
- `compileProblems` and `compileDocs` keep their names and delegate.
- The legs call `verifyCompiled` rather than copying the SQL.

**Ledger.** `LEDGER slice 44-4-bootstrap-compile-result-accuracy` is empty (`owned_ledger=0`). DW-685 arrives through the story text and the action item, and AC 44.4.2-44.4.5 address it.

## Verification

**Commands** (each in its own foreground call, `timeout: 600000`):
- (loop) `pnpm turbo run build --filter @iris-mcp/shared --filter @iris-mcp/dev` -- expected: success. The fake-based and seed tests load the built dist.
- (loop) `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts` -- expected: green.
- (loop) `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-44-4-compile-oracle.test.ts` -- expected: red on the baseline dist (AC 44.4.5 row, recorded below), green after.
- (loop) `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/ci-seed-throwaway.test.ts src/__tests__/story-42-2-bootstrap-guard-orchestration.test.ts` -- expected: green.
- (once) Live, on a throwaway only:
  - `node scripts/throwaway-iris.mjs run --image intersystems/iris-community:2026.2@sha256:cd2ebcab02d1ef80ec155def4418399f353d867162688c36a3705760e750bdaa --host-port 52792 -- pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-42-2-bootstrap-guard-live-gate.test.ts` -- expected: every leg, plus L1 and L2, green.
  - The same with `OLDEST_IRIS_COMMUNITY_IMAGE` (`intersystems/iris-community:2026.1@sha256:c57b65b2b454494091e7b3e49f6a53b3335f40adf475bcfcee0866083f35a7c2`). Remove that image afterwards if this session pulled it.
  - Use the host port the lead names if it is not 52792. Afterwards, `docker ps -a --filter label=iris-mcp.owner=throwaway` must list nothing this stage started. If a run would pass 10 minutes, add `-t "Story 44.4"`.
- (once) `pnpm turbo run build`; `pnpm --filter @iris-mcp/shared test`; `pnpm --filter @iris-mcp/dev test` (one call each) -- expected: green.
- (once) `pnpm --filter @iris-mcp/all test`, split by file into calls of about 8 minutes each (the 44.3 run took 1234 s whole) -- expected: green.
- (once) `pnpm gen:governance-baseline:check`, `pnpm run gen:tools-list-snapshot:check`, `pnpm run gen:ipm:check`, `pnpm run lint`, `pnpm run type-check` (one call each) -- expected: pass. The baseline stays `1e62c5ad5bf7`/141; the snapshot, the IPM tree and `BOOTSTRAP_VERSION` are unchanged.

**Red run (AC 44.4.5):** the implement stage runs the new file against the baseline dist before any source edit and records the command and the failing assertion here (expected: the Storage-written row answers `compiled: true`).

**Mutations (Rule 19; the implement stage writes each `mutation:` line after demonstrating it):**
- AC 44.4.2: `verifyCompiled` returns `[]` → the Storage-written rows go red, and L1 does when armed.
- AC 44.4.2: drop the `upd` condition → the skipped-dependant row goes red. Drop the `CompileError` condition → the routine-failure rows go red.
- AC 44.4.3: remove the early return on the `unconfigured` branch → the unconfigured row goes red. Take the names from `irisErrors` → the status-error row (Y named) goes red.
- AC 44.4.4: `compileProblems` reads the console again → the localized seed row goes red.
- AC 44.4.6: add a field to the clean-path result → the capture `toEqual` goes red. Drop one check request → the request-count pin goes red.

**Shared surfaces:**
- the stateful fake's compile hooks (`failCompile`/`compileConsole` → `compileFailure`) and its new query and docnames answers;
- the `summarizeRequests` windows (the check's query and its GET);
- the `bootstrap.test.ts` reply queues (+2 after each compile);
- `BootstrapResult.errors` text on a failed compile, and `configured`/`mapped`/`unitTestRootEnsured` after an `unconfigured` failure;
- the `compileProblems` input contract;
- the bootstrap-guard live gate file (the new describe);
- README :1061, the shared README, and the `CHANGELOG.md` `[Unreleased]` sections.

Standing criterion: every test added or changed passes on a fresh environment, in either order.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
