---
title: 'Story 38.0: Epic 37 Deferred Cleanup'
type: 'chore'
created: '2026-10-15'
status: 'done'
baseline_revision: '1bc5af654861ab63d7f0c5179f2a1f0c7563356c'
baseline_commit: '1bc5af654861ab63d7f0c5179f2a1f0c7563356c'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - multiple-goals
  - oversized
deferred:
  - summary: "iris_doc_export modifiedSince branch also drops category and type, yet filtersApplied still reports them as applied"
    evidence: "export.ts:387-403 (plan-time read 2026-10-15): the /modified path adds no category/type filter; filtersApplied echoes all three"
    location: 'packages/iris-dev-mcp/src/tools/export.ts:387'
    severity: low
    source: plan
  - summary: "iris_env_promote execute writes target documents without inspecting the per-document Atelier result.status (same blind spot as DW-485)"
    evidence: "env-promote.ts:869 awaits targetClient.put(putPath, {enc:false, content}) and never reads result.status (plan-time read 2026-10-15)"
    location: 'packages/iris-dev-mcp/src/tools/env-promote.ts:869'
    severity: med
    source: plan
  - summary: "iris_doc_list, iris_doc_export and iris_package_list build GET /modified/<timestamp>, which IRIS answers with HTTP 405: Atelier's /modified route is POST-only (POST /modified/CLS with a database-hash body), so modifiedSince cannot work on this instance"
    evidence: "DW-527 live probe 2026-10-15, IRIS 2026.2, Atelier v8, HSCUSTOM: iris_doc_list modifiedSince with generated true and false both returned HTTP 405; curl GET /modified/<ts>[?generated=0|1] -> 405 and OPTIONS -> ALLOW: POST,OPTIONS; %Api.Atelier.v1 route '/:namespace/modified/:type' is Method POST (type CLS only, body a JSON array of {dbname,dbhash}) and reads +%request.Get('generated'); POST /modified/CLS?generated=1 listed 13460 docs (815 gen:true) against 12645 (0 gen:true) with generated=0"
    location: 'packages/iris-dev-mcp/src/tools/doc.ts:451'
    severity: med
    source: implement
  - summary: >-
      The production-delete state guard (DW-54) is pinned only at its predicate and message
      (DeleteBlockedByState, StateName, DeleteBlockedMessage), not at the ProductionManage handler that wires
      them: no test drives a refusal of a current, non-Stopped production through the deployed route.
    evidence: |-
      Review pass 2026-10-15 (blind-hunter, verification-gap, intent-alignment all filed it). The three real-HTTP
      InteropProductionDeleteTest cases (orphan row, created-then-deleted, nonexistent) never see a current production
      in a non-Stopped state, because HSCUSTOM has none and the spec's fixtures are never started; the wiring
      (argument order into DeleteBlockedByState, the guard running before both delete paths) is pinned by nothing, so a
      swapped argument or a moved guard keeps every test green. Starting a disposable production on the shared
      instance would leave ^Ens.Runtime pointing at a deleted production, so it was not done. What would settle it: a
      seam that takes an injected current name and state (a classmethod that does "status, predicate, message" and is
      called by the handler), or an operator-approved disposable production started and stopped in a scratch namespace.
      Fix-risk is high (shared-instance state), so this is for the lead's decision, not a story-local patch.
    location: 'src/ExecuteMCPv2/REST/Interop.cls:122'
    severity: medium
    source: review
  - summary: >-
      The VS Code launcher's full test suite is red on this macOS host at the story's baseline: 5 tests in 3 files
      plus 2 files that cannot load.
    evidence: |-
      Verified twice (implement pass and review pass) by running `npm --prefix extensions/iris-mcp-launcher test` with
      the launcher's settings.ts, package.json and three test files restored to HEAD: the same failures appear.
      clientsEngine (2) and governanceEngine (2) assert Windows-style `C:\git\...` developmentRepoPath resolution,
      constants.test.ts and credentials.test.ts cannot load `@intersystems-community/intersystems-servermanager`
      (absent from the extension's node_modules), and clientsActivationFlow 33-3-3 times out after 60 s waiting for
      "the re-toggled roster to persist". None touches the namespace default this story changes; settings.test.ts,
      envContract.test.ts and packaging.test.ts pass. The spec's (once) launcher line expected green and could not be
      met on this host.
    location: 'extensions/iris-mcp-launcher/src/__tests__'
    severity: medium
    source: review
---

<intent-contract>

## Intent

**Problem:** 27 ledger entries routed to this story (the Rule #37 drain inherited from Epics 36 and 37) are real defects or doc lies: `iris_doc_put` reports success when IRIS stored nothing, `iris_doc_export` ignores `generated` on its `modifiedSince` branch, the `IRIS_NAMESPACE` code default (`HSCUSTOM`) contradicts every documented table (`USER`), the dist-freshness and live gates can pass on stale or incomplete builds, several suite tests are red or flaky on this macOS host, and four ObjectScript handler paths misbehave (unguarded redirect restore, unforwarded/unvalidated `listPrivileges` input, an anonymous `get`, an unsafe and orphan-blind production delete).

**Approach:** Fix each entry at its source with a pinning test that is proven red by a named mutation, verify every IRIS-touching fix live against disposable `ExecuteMCPv2.Temp.*` fixtures in `HSCUSTOM` on the `default` profile (Rule #48), regenerate the bootstrap embed for the three changed handlers (Rule #24), and record the user-visible changes in `CHANGELOG.md` plus one changeset.

## Boundaries & Constraints

**Always:**
- Every IRIS call names `server: "default"` (localhost:52773) and `namespace: "HSCUSTOM"` explicitly. Other configured profiles (`ocupilot-slot-a/b/c`, ports 52774/52775/52778) belong to another project: never target them.
- Never stop or restart the shared IRIS instance. IRIS writes go only to disposable `ExecuteMCPv2.Temp.*` artifacts (listed under Verification), the project's existing `ExecuteMCPv2.Tests.*` fixtures, and the project's own class deployment (the changed `ExecuteMCPv2.REST.*` handlers and `ExecuteMCPv2.Tests.*` test classes); every fixture is removed or restored afterwards.
- Changed REST handlers keep AD-11/AD-13 discipline: input validated before any `%SYS` switch, `$NAMESPACE` restored on every exit (including the new orphan-delete path), errors through `ExecuteMCPv2.Utils.SanitizeError`, exactly one render per request.
- Custom REST route changes are additive (AD-33): `get` gains `production`, orphan `delete` gains `orphanRemoved`, `sqlprivilege` honors `system`; every older request shape is still accepted.
- Non-ASCII characters in source are written as escapes (`﻿`), never literal bytes (skill Rule 14).
- `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7`/141 and is checked with `pnpm gen:governance-baseline:check` only. No tool, action, or governance key is added; tool counts do not move.
- `BOOTSTRAP_VERSION` moves from `2159ec9e6f69` to a recorded new value in this story, and a second `pnpm gen:bootstrap` produces no diff.

**Never:**
- No `$$$AssertSkipped` (the project runner counts it as a failure) and no `$Get()` around a method call (Rule #15).
- No `LoadFromClass` on the orphan-production path: the class no longer exists (Rule #27).
- No changes to `iris_env_promote`, to the `category`/`type` filters of the export `modifiedSince` branch, or to the shared `./test-helpers` exports (DW-506 belongs to AC 42.1.3). The two discoveries are recorded in frontmatter `deferred:` for the lead.
- No `changeset version`, no publish, no CI wiring (AD-29).
- No running of any destructive call against a production, role, or document that is not one of the listed disposable fixtures.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| doc_put BOM (DW-485) | `content` string or array whose first character is U+FEFF | PUT body line 1 has no BOM; caller's array is not mutated; success text unchanged | No error expected |
| doc_put IRIS refusal (DW-485) | Atelier PUT `result.status` is a non-empty string | `isError: true`, text `Document '<name>' was not saved in namespace '<ns>': <status>. ...`, `structuredContent` = `response.result` | Status text passed through unchanged |
| doc_put normal (DW-485) | `result.status` is `""` or absent | Byte-identical to today (`Document '...' saved successfully in namespace '...'.`) | No error expected |
| export modifiedSince (DW-527) | `modifiedSince` set; `generated` omitted / `"true"` / `"both"` | `/modified/<ts>` query has `generated=0` / `generated=1` / no `generated` (same mapping as the docnames branch) | No error expected |
| delete Running/Suspended/Troubled/NetworkStopped/Unknown (DW-54) | named production is the namespace's current production, state not 2 or -2 | Refused, nothing deleted; Running keeps its exact message `Production '<n>' is running; stop it before deleting`; other states name the state from the existing state map | IRIS error envelope (existing refusal shape) |
| delete stopped or non-current (DW-54) | state 2/-2, or current production is a different one | Deleted as today | No error expected |
| delete orphan (DW-55) | class absent, `Ens.Config.Production` row present | Row (and its items) removed via `Ens.Config.Production.%DeleteId`; response `{"action":"deleted","name":...,"orphanRemoved":true}` | %DeleteId failure surfaces through SanitizeError |
| delete nonexistent (DW-55) | neither class nor row exists | Unchanged message `Production '<n>' does not exist`; nothing changes | Existing error |
| item get, production omitted (DW-450) | `itemName` only | Response adds `production` (the row's production name); all other fields unchanged | No error expected |
| listPrivileges system (DW-470) | `system` true / false / omitted | Querystring carries `system=1` / `system=0` / `system=0` (documented default sent explicitly) | No error expected |
| listPrivileges malformed target (DW-473) | `NoDotHere`, `S.`, `.T`, `.` | Clear validation error: `Parameter 'target' must be 'schema.table' for listPrivileges (got '<target>'). Omit target for an object-level listing.`; no raw `<SUBSCRIPT>` 500 | Rendered before any `$Piece`/catalog query |
| listPrivileges multi-dot (DW-473) | `A.B.C` | Unchanged graceful empty result (live-verified pin stays) | No error expected |
| checkDistFresh files (DW-413) | `files` has `dist`, `dist/`, `./dist`, `dist/**` (negations ignored) | Treated as dist-shipping; checked | — |
| checkDistFresh failures (DW-414..417) | malformed/missing package.json, unreadable entry, dangling or directory symlink under `src/`, dist mtime > now + 60 s, declared `main`/`bin`/`exports` target under `dist/` missing | `{ok:false, reason}` naming the cause; never throws; a symlinked file is followed; targets outside `dist/` are not checked | Returned, not thrown |
| verify-iris-reachable fallback (DW-388) | any of IRIS_HOST/PORT/USERNAME/PASSWORD/NAMESPACE/HTTPS unset, `CI` unset | One loud `[WARN]` line on stderr naming every defaulted variable; then proceeds as today | — |
| verify-iris-reachable under CI (DW-388) | any of the six unset, `CI` set to a value other than `""`, `0`, `false` | Exit 1 naming the variables, before the dist check and before any network call | Fail closed |

</intent-contract>

## Code Map

- `packages/iris-dev-mcp/src/tools/doc.ts:211-231` -- `docPutTool` handler: `lines` split at :212, PUT at :220-221, unconditional success at :223-231 (DW-485).
- `packages/iris-dev-mcp/src/tools/load.ts:412-413,463-471` -- inline BOM strip and string-`status` failure check to extract and reuse (DW-485).
- `packages/shared/src/atelier.ts` -- Atelier helpers (`atelierPath`); home for the new `atelierDocStatusError(result)`.
- `packages/shared/src/lines.ts` (new) -- `stripLeadingBom(text)`: the seed of AD-24's line utility that 38.2 extends. Export both helpers from `packages/shared/src/index.ts`.
- `packages/iris-dev-mcp/src/tools/export.ts:387-413` -- `filtersApplied` :387-394; modifiedSince branch :398-403 (no params); docnames branch :404-413 with the `generated` mapping (DW-527). `doc.ts:412` and `packages.ts:203-205` already send `generated` on `/modified`.
- `packages/shared/src/config.ts:82,131` -- JSDoc default row and `env.IRIS_NAMESPACE ?? "HSCUSTOM"` (DW-469); `packages/shared/src/__tests__/config.test.ts:34` pins it.
- `extensions/iris-mcp-launcher/` (own npm project, not in the pnpm workspace) -- `src/settings.ts:22` `DEFAULT_NAMESPACE`, `package.json:98-99` setting default plus parity claim, `README.md:301`, `CHANGELOG.md` (`## [0.1.0] — Unreleased`), `src/__tests__/envContract.test.ts:120-127` (cross-checks loadConfig's default), `src/__tests__/settings.test.ts:20,130,176`.
- `.env.example:5` -- `IRIS_NAMESPACE=HSCUSTOM` example.
- `scripts/lib/dist-freshness.mjs:45-50,62-64,72-76` -- `newestMtimeMs` (isDirectory/isFile only), JSDoc, `checkDistFresh(pkgDir, pkgName)` with exact `files.includes('dist')` (DW-413..417). Test: `packages/iris-mcp-all/src/__tests__/dist-freshness.test.ts` (8 tests; the :181 case sets dist mtime 1 s ahead). Callers: `scripts/verify-iris-reachable.mjs:77`, `packages/{iris-dev-mcp,iris-data-mcp,iris-mcp-all}/scripts/prepublish-gate.mjs`.
- `packages/iris-mcp-all/src/__tests__/epic37-default-outage-gate.test.ts:235-236,287-288` and `epic35-defect-gate.test.ts:168,179` -- `existsSync` dist checks to replace (DW-524). In the epic37 gate the check sits after `if (skipReason)`.
- `scripts/verify-iris-reachable.mjs:115-122` -- six `??` local-dev fallbacks (DW-388); top-level await, not importable.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs:81` -- `["exec","vitest","run",...gateTestFiles]` (DW-511). Gates: `packages/iris-dev-mcp/src/__tests__/execute-tests-running-contract-epic-gate.test.ts:200` and `test-status-epic-gate.test.ts:247,397` (assertions without the work response). Vitest 2.1.9 supports `--no-file-parallelism`.
- `packages/iris-dev-mcp/src/__tests__/request-body-utf8-decode.test.ts:305` -- `if (skipReason)` vs siblings :256,:279,:339 (DW-490).
- `packages/client-config/src/__tests__/certification-process.test.ts:76` -- `mkdtempSync(path.join(tmpdir(), prefix))` (DW-495, red on every macOS run).
- `packages/client-config/src/__tests__/engine-e2e.test.ts:472-485` -- "restore by NAME across a chain"; imports the built dist (:71); `EngineOptions.now` exists (`engine.ts:90`) (DW-496).
- `src/ExecuteMCPv2/REST/Interop.cls:94-125` -- delete: class-existence check :96, state guard :105-106 (`tState = 1` only), class delete :119; state map :313. `:438-474` -- item `get` SELECT and response (DW-54, DW-55, DW-450).
- `src/ExecuteMCPv2/REST/Security.cls:3349-3390` -- `SqlPrivilegeList`: `system` read at :3356, unvalidated `$Piece` split at :3382-3385 (DW-473).
- `src/ExecuteMCPv2/REST/Analytics.cls:272-274,320-327` -- build-path restore and catch-path restore (DW-455); reuse `src/ExecuteMCPv2/REST/Command.cls:45` `TeardownRedirect(pInitIO, pNull)` (public ClassMethod, already called cross-class by `ClassMethodEdgeTest`).
- `packages/iris-admin-mcp/src/tools/resource.ts:96,153-156,273-280` -- description inviting "a schema"; `target` describe; listPrivileges querystring (DW-470, DW-473). Exact-path pins: `resource-listprivileges-bound.test.ts` (3, incl. :198), `resource-listprivileges-superuser-coverage.test.ts` (5, incl. the :339 mocked `<SUBSCRIPT>` 500), `resource-sqlpriv-coverage.test.ts` (1), `resource.test.ts` (2).
- `packages/iris-interop-mcp/src/tools/item.ts:30-31,36-38,70` -- enable/disable and get description text (DW-458, DW-450); `production.ts:27` delete description. Tests: `item.test.ts` (:74, :466, description pins :222-240), `production.test.ts:48`.
- `packages/iris-interop-mcp/README.md:146,411-435,864-877` -- tool row, `get` example, Common Errors (row :871 is stale).
- `packages/shared/src/health.ts:4-5,42,51-53` and `packages/shared/src/server-base.ts:2071` -- DW-514 comments; DW-523 prefix. Pins: `server-base.test.ts:582`, `server-base-default-outage-coverage.test.ts:304` (the 401 "Gap 6" case near :544-560), `epic37-default-outage-gate.test.ts:269,313`.
- `README.md:541` -- connection-error claim (DW-520). `packages/iris-data-mcp/src/tools/docdb.ts:83` vs :105 (DW-57). `CHANGELOG.md:236` and `.changeset/execute-response-ceiling-and-gate-hardening.md:14` (DW-384); real marker `src/ExecuteMCPv2/Utils.cls:306`.
- `src/ExecuteMCPv2/Tests/` -- `InteropHostGuardTest.cls` (93 lines, 5 tests, pure-predicate style), `InteropItemCompositeKeyTest.cls` (454 lines, 8 tests, fixtures `ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd`/`Prod2`, `PostJson` helper :165), `SqlPrivilegeBoundTest.cls` (253 lines, 5 tests, `GetPrivileges` helper :129), `MessageResendTest.cls` (545 lines, 13 tests; real-resend methods :420 and :483 use no class helpers). Mechanical `Test*` count today: 435 in 41 files.
- `packages/shared/src/bootstrap-classes.ts:25` (`BOOTSTRAP_VERSION = "2159ec9e6f69"`, generated), `scripts/gen-bootstrap.mjs:14-43` (Security :32, Interop :33, Analytics :41), drift tests `packages/shared/src/__tests__/bootstrap.test.ts:1301,1325`. No `gen:bootstrap:check` exists.
- `CHANGELOG.md` top -- newest-first `## [Pre-release — <date>] — Story X.Y: …` with `### Changed —` / `### Fixed —` subheadings; `.changeset/config.json` fixed group, double-quoted frontmatter.

## Tasks & Acceptance

**Execution:**
- `scripts/lib/dist-freshness.mjs` -- normalize `files` entries (strip `./`, trailing `/`, `/**`; ignore `!` negations); wrap every fs and JSON step so the function returns `{ok:false, reason}` and never throws (missing package.json included), and rewrite the JSDoc to say so; follow a symlinked file with `statSync`, fail closed on a dangling or directory symlink; accept an optional third argument `{ now }` and fail closed when any dist mtime exceeds `now + 60_000`; collect `main`, `module`, `bin` (string or map) and every string leaf of `exports` (recursing into conditions) that resolves under `dist/`, and fail closed naming the field and target when one is missing -- DW-413, DW-414, DW-415, DW-416, DW-417.
- `packages/iris-mcp-all/src/__tests__/dist-freshness.test.ts` -- add one case per item above (variants accepted, malformed package.json, symlink followed / dangling refused, future mtime, missing `bin` target, outside-dist export ignored) -- pins AC-5.
- `packages/iris-mcp-all/src/__tests__/epic37-default-outage-gate.test.ts`, `epic35-defect-gate.test.ts` -- replace the `existsSync` dist checks with `checkDistFresh(pkgDir, pkgName)` inside `beforeAll`, ahead of the reachability probe; a stale result throws when `IRIS_REQUIRE_LIVE` is armed and skips with the reason otherwise (the same disposition as a missing dist today) -- DW-524.
- `scripts/lib/iris-target.mjs` (new), `scripts/verify-iris-reachable.mjs` -- pure `resolveIrisTarget(env)` returning `{ env, defaulted, ciRefusal }` (fallback values unchanged, `IRIS_NAMESPACE` fallback stays `HSCUSTOM`); the script calls it first, prints one `[WARN]` stderr line naming every defaulted variable, and exits 1 with the names when `CI` is truthy, before the dist check, the shared import, and any network call -- DW-388.
- `packages/iris-mcp-all/src/__tests__/verify-iris-reachable-target.test.ts` (new) -- unit cases for `resolveIrisTarget` plus one process test spawning the script with `CI=1` and all six variables removed (expects exit 1, the names on stderr, completion well under 10 s; never spawn the warn path) -- pins AC-7.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` -- insert `--no-file-parallelism` after `run`; `execute-tests-running-contract-epic-gate.test.ts`, `test-status-epic-gate.test.ts` -- record the last Atelier `work/` response by wrapping the gate client's `get`, and pass it (JSON) as the message of the `running.isError` and `status === "running"` expectations -- DW-511.
- `packages/iris-dev-mcp/src/__tests__/request-body-utf8-decode.test.ts:305` -- `if (skipReason || fixtureSkipReason)` with the sibling comment -- DW-490.
- `packages/client-config/src/__tests__/certification-process.test.ts` -- `mkTmp` uses `realpathSync(tmpdir())` -- DW-495.
- `packages/client-config/src/__tests__/engine-e2e.test.ts` -- first run the probe (the chain test looped 10 times, results recorded under Auto Run Result); if a failure reproduces, fix its root cause; otherwise contain: pass a strictly increasing injected `now` to every `apply`/`disable`/`restore` in the chain tests and assert `checkDistFresh` for the client-config package in `beforeAll` (failing with a "run pnpm --filter @iris-mcp/client-config build" reason) -- DW-496.
- `packages/shared/src/lines.ts` (new), `packages/shared/src/atelier.ts`, `packages/shared/src/index.ts` -- `stripLeadingBom(text)` and `atelierDocStatusError(result): string | undefined` (non-empty string `status` → that text); unit tests `packages/shared/src/__tests__/lines.test.ts`, `packages/shared/src/__tests__/atelier-doc-status.test.ts` -- DW-485 groundwork.
- `packages/iris-dev-mcp/src/tools/doc.ts`, `packages/iris-dev-mcp/src/tools/load.ts` -- `doc_put` strips the BOM (copying, never mutating, a caller array) and returns `isError` with the status text when `atelierDocStatusError` reports one; `load.ts` switches its inline copies to the two shared helpers with identical behavior; tests in `doc.test.ts` (BOM string, BOM array, non-empty status, `status: ""`) whose status fixture is the shape captured live from a disposable `ExecuteMCPv2.Temp.Story380Bom.cls` put (Rule #54) -- DW-485.
- `packages/iris-dev-mcp/src/tools/export.ts` -- probe first (Rule #16): take a UTC timestamp, then put and compile the disposable `ExecuteMCPv2.Temp.Story380Bom.cls`, then call `iris_doc_list` with that `modifiedSince`, `generated` true and then false (`server:"default"`, `namespace:"HSCUSTOM"`; `iris_doc_list` already forwards `generated` on `/modified`, `doc.ts:409-413`), recording whether the class's generated routine appears only with `true`; then build the same `generated` parameter on the `/modified` branch as on the docnames branch; `export.test.ts` asserts `generated=0` (default), `=1`, and absent for `"both"` on the modified path. If the probe shows `/modified` ignores `generated`, or no generated document appears either way, keep the forwarding, record the evidence under Auto Run Result, and add a `deferred:` item -- DW-527.
- `packages/shared/src/config.ts`, `packages/shared/src/__tests__/config.test.ts`, `.env.example` -- default and JSDoc to `USER`; pin updated; example becomes `USER` with a one-line HealthShare note; `extensions/iris-mcp-launcher/src/settings.ts`, `package.json`, `README.md`, `CHANGELOG.md`, `src/__tests__/settings.test.ts`, `src/__tests__/envContract.test.ts` -- launcher default follows to `USER` (its documented parity contract), pins updated, launcher CHANGELOG `### Changed` entry -- DW-469.
- `src/ExecuteMCPv2/REST/Interop.cls` -- public `ClassMethod DeleteBlockedByState(pTarget As %String, pCurrentName As %String, pState As %Integer) As %Boolean` (true when `pCurrentName = pTarget` and `$ZAbs(pState) '= 2`) used by the delete guard, which now runs before either delete path; message per the matrix; orphan path deletes the `Ens.Config.Production` row and adds `orphanRemoved`; item `get` selects `Production` and always sets `production` -- DW-54, DW-55, DW-450.
- `src/ExecuteMCPv2/REST/Security.cls` -- validate `target` (contains a `.`, non-empty first piece, non-empty remainder) before the `$Piece` split and before any `%SYS` work, with the matrix message -- DW-473.
- `src/ExecuteMCPv2/REST/Analytics.cls` -- replace both restore sequences with `Do ##class(ExecuteMCPv2.REST.Command).TeardownRedirect(tInitIO, tNull)` (catch path: `$Get(tInitIO)`, `$Get(tNull)` inside `If tRedirected`) -- DW-455.
- `packages/iris-admin-mcp/src/tools/resource.ts` + its four test files -- optional `system` via the shared `booleanParam` helper, documented default `false`; querystring always carries `system=1` or `system=0`; update the 11 exact-path pins; the description limits "a schema" targets to grant/revoke and says listPrivileges takes `schema.table`; the :339 mock is re-pinned to the live-captured validation error -- DW-470, DW-473.
- `packages/iris-interop-mcp/src/tools/item.ts`, `production.ts`, `item.test.ts`, `production.test.ts`, `packages/iris-interop-mcp/README.md` -- enable/disable description states that items whose host class no longer resolves are skipped and the repair is `set` with `settings.className`; `get` documents `production`; delete description names the refused states and orphan cleanup; README row, `get` example, Common Errors (fix :871, add the unresolvable-host row); description-pin test and mock updates -- DW-458, DW-450, DW-54, DW-55.
- `src/ExecuteMCPv2/Tests/InteropHostGuardTest.cls` -- `TestDeleteBlockedByState` over states 0-6, -2, and a name mismatch -- pins DW-54.
- `src/ExecuteMCPv2/Tests/InteropProductionDeleteTest.cls` (new) -- real-HTTP tests: orphan row removed with `orphanRemoved`; a disposable production created through the `create` action then deleted (class and row gone); nonexistent name refused with nothing changed; `OnAfterOneTest` removes every `ExecuteMCPv2.Temp.Story380*` class and row -- pins DW-55 and the DW-54 normal path.
- `src/ExecuteMCPv2/Tests/InteropItemCompositeKeyTest.cls` -- `TestGetOmittedProductionEchoesProduction`: the echoed `production` is PROD1 or PROD2 and agrees with a production-scoped `get` of that production -- pins DW-450.
- `src/ExecuteMCPv2/Tests/SqlPrivilegeBoundTest.cls` -- malformed targets (`NoDotHere`, `S.`, `.T`) return the validation error and no 500; `system=1` is accepted, with its expectation pinned from a live capture -- pins DW-473, DW-470 route.
- `src/ExecuteMCPv2/Tests/MessageResendTest.cls`, `src/ExecuteMCPv2/Tests/MessageResendLiveTest.cls` (new) -- move the two real-resend methods into the new class; each starts with a guard that, when `SessionAgent.Sample.Production` or `SessionAgent.Sample.BS.OrderIngest` is not a compiled class, logs `$$$LogMessage("SKIP: ...")` and returns `$$$OK` -- DW-492.
- `packages/shared/src/bootstrap-classes.ts` -- regenerate with `pnpm gen:bootstrap` after the three handler edits; record from/to under Auto Run Result -- Rule #24.
- Deployment (no file) -- load and compile `Interop.cls`, `Security.cls`, `Analytics.cls`, then each changed or new test class, one `iris_doc_load` per class (glob-prefixed paths, `server:"default"`, `namespace:"HSCUSTOM"`, `compile:true`); confirm each fix with `iris_doc_get` before its live check -- prerequisite for the OS tests and the live gates.
- `packages/shared/src/health.ts`, `packages/shared/src/server-base.ts` + the two shared pins -- comments describe `ping()` as a general availability probe; server-base prefixes `IRIS health check failed:` only when the message does not already start with it; tighten `server-base.test.ts:582` and `server-base-default-outage-coverage.test.ts:304` to exactly once and add the 401 case asserting exactly once -- DW-514, DW-523.
- `README.md:541`, `packages/iris-data-mcp/src/tools/docdb.ts:83`, `CHANGELOG.md:236`, `.changeset/execute-response-ceiling-and-gate-hardening.md:14` -- scope the claim to unreachable-at-startup and state that a mid-session outage surfaces as `Tool error: …` with the connection message; "silently skipped"; byRef/returnValue markers carry `ceiling=<N>` and are detected by the `[IRIS-MCP-TRUNCATED` prefix -- DW-520, DW-57, DW-384.
- `CHANGELOG.md`, `.changeset/story-38-0-epic-37-deferred-cleanup.md` (new) -- a `## [Pre-release — 2026-10-15] — Story 38.0: Epic 37 deferred cleanup` section: `### Changed —` for DW-469, DW-54 and DW-527; `### Fixed —` for the rest of the user-visible fixes; changeset `"@iris-mcp/shared": minor`, `"@iris-mcp/dev"`, `"@iris-mcp/admin"`, `"@iris-mcp/interop"`: patch -- AD-15, AD-29.

**Acceptance Criteria:**
- AC-1 (DW-485): Given content with a leading BOM or an Atelier response with a non-empty `result.status`, when `iris_doc_put` runs, then the BOM never reaches the wire and a refused write returns `isError: true` with the status text, while an accepted write keeps today's response byte-identical; and `iris_doc_load` keeps its existing behavior through the same shared helpers.
- AC-2 (DW-527): Given `modifiedSince`, when `iris_doc_export` runs, then `generated` reaches `/modified` with the docnames mapping, and the live probe result is recorded.
- AC-3 (DW-469): Given `IRIS_NAMESPACE` unset, when `loadConfig` runs, then the namespace is `USER`; the launcher's advertised default is `USER` and its envContract cross-check passes against the rebuilt shared dist; every helper and script that defaults the namespace already names `HSCUSTOM` explicitly; `CHANGELOG.md` and the launcher CHANGELOG record it under Changed.
- AC-4 (DW-490, DW-492, DW-495, DW-496, DW-511): Given this macOS host, when the per-package suites and the OS classes run, then the utf8 key test skips with the fixture reason when the fixture is absent, the real-resend methods log a SKIP and pass when the SessionAgent classes are absent, the certification drift test passes, the engine-e2e chain test passes 10 of 10 loops with the probe result recorded, and the dev prepublish gate runs its files sequentially and any failure message carries the last work response.
- AC-5 (DW-413..417): Given each matrix input, when `checkDistFresh` runs, then it returns the matrix result and never throws.
- AC-6 (DW-524): Given `IRIS_REQUIRE_LIVE=1` and a `src/` file newer than its dist, when the epic35 or epic37 gate file runs, then it fails naming the stale package before any IRIS call.
- AC-7 (DW-388): Given unset IRIS variables, when `verify-iris-reachable.mjs` runs, then it warns naming them, and with `CI` set it exits 1 naming them without touching the network; the local loop with variables set is unchanged.
- AC-8 (DW-455): Given the deployed `Analytics` handler, when the analytics wire gate builds a nonexistent cube, then the raw wire body is parseable JSON with no device text, through `TeardownRedirect` on both restore paths.
- AC-9 (DW-470, DW-473): Given `listPrivileges`, when `system` is true or omitted, then the route receives `system=1` or `system=0`; when the target is malformed, then the caller gets the validation message instead of a raw `<SUBSCRIPT>` 500, and `A.B.C` still returns the graceful empty result.
- AC-10 (DW-450): Given a `get` without `production`, when it resolves an item, then the response names the production it read; with `production`, the response gains the same field and nothing else changes.
- AC-11 (DW-54, DW-55): Given a delete, when the named production is current and not Stopped, then it is refused and nothing changes; when only an orphan `Ens.Config.Production` row exists, then the row is removed and `orphanRemoved: true` is returned; stopped and non-current productions delete as today.
- AC-12 (DW-523): Given a health check failing with HTTP 401 or with a network error, when startup logs it, then `IRIS health check failed:` appears exactly once.
- AC-13 (DW-384, DW-458, DW-514, DW-520, DW-57): Given the edited docs and comments, when they are read, then each states the behavior the code has (verified by the grep checks under Verification and the DW-458 description-pin test).
- AC-14 (AC 38.0.8): Given the finished tree, when the gates run, then every per-package build, test, lint and type-check passes; governance `:check` exits 0 at `1e62c5ad5bf7`/141; package tool-count tests are unchanged; `BOOTSTRAP_VERSION` from/to is recorded and a second `gen:bootstrap` leaves no diff; the changeset exists; and the OS package run's `total` equals the mechanical `Test*` count.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass
- verdicts: 53 findings — high 0, medium 12, low 38, false 3, maybe-false 0
- findings:
  - `[low]` `[patch]` BH1 "additive" sentence in CHANGELOG and changeset contradicts the stricter delete guard and the 500-to-200 validation change — CHANGELOG and changeset reworded: older request shapes keep working and only response fields are added; the behavior changes are listed below it.
  - `[low]` `[reject]` BH2 `StateName` names state 6 (ShardWorkerProhibited) and mirror-backup states "Unknown" — the spec says the message names the state "from the existing state map" (1-5, the same map `iris_production_status` reports); the refusal itself is correct for every state, and adding branches would also change the status tool's output; reopen_if a ShardWorkerProhibited or mirror-backup member is refused and the text confuses an operator.
  - `[low]` `[reject]` BH3 guard fails open when `GetProductionStatus` errors — spec-bound ("a GetProductionStatus error keeps today's behavior", Plan-time interpretations) and the pre-change code behaved the same; the error is a 10 s runtime-lock timeout while a production is transitioning.
  - `[low]` `[reject]` BH4 "stop it before deleting" is the wrong remedy for Troubled/NetworkStopped (`recover` first) — the I/O matrix fixes the message text; stopping is a valid next step and the server instructions already steer wedged productions to `recover`.
  - `[medium]` `[defer]` BH5 no test drives the delete refusal through the route — real: the handler wiring (argument order, guard before both delete paths) is pinned by nothing; the fix needs a production started on the shared instance (excluded by the spec's fixtures, leaves `^Ens.Runtime` pointing at a deleted production) or a new seam; recorded as the fourth `deferred:` item for the lead.
  - `[medium]` `[defer]` BH6 `modifiedSince` still advertised as working in the `iris_doc_list`, `iris_doc_export` and `iris_package_list` descriptions and the dev README — pre-existing and the same root cause as the third `deferred:` item (the GET route answers 405); the description fix belongs with the route fix.
  - `[low]` `[patch]` BH7 `iris_doc_put` description and README omit the BOM strip and the new error result — one sentence added to the `doc.ts` description and the dev README, plus a `doc.test` description pin (mutation recorded).
  - `[low]` `[patch]` BH8 stale `Interop.cls` comment says `get` output is unchanged legacy and byte-identical — comment now says the unfiltered query is kept and the response always names the row's production; bootstrap regenerated.
  - `[medium]` `[patch]` BH9 `normalizeFilesEntry` misses `dist/*`, `dist/**/*` and `./dist/**/*`, so such a package is skipped and the gate fails open — regex now strips a trailing `/**`, `/*` or `/**/*`; three `files` cases added to `dist-freshness.test.ts`; mutation recorded.
  - `[low]` `[reject]` BH10 `MessageResendLiveTest` records a skip as a pass — spec-bound: `$$$AssertSkipped` is counted as a failure by the project runner, so the spec chose `$$$LogMessage("SKIP: ...")` plus `$$$OK` for DW-492; the resend behavior itself gains hermetic coverage through VG2's patch.
  - `[low]` `[patch]` BH11 the new dist-freshness cases assume POSIX (chmod 000, symlinks) — the unreadable-directory case now also skips on `win32`, and the symlink describe is `skipIf(win32)`.
  - `[medium]` `[patch]` ECH1 same root as BH9 (`dist/**/*` and `dist/*` spellings skip the check) — see BH9.
  - `[low]` `[reject]` ECH2 same as BH3 (guard fails open on a status error).
  - `[low]` `[reject]` ECH3 same as BH2 (`StateName` and states 6 and negative).
  - `[low]` `[reject]` ECH4 `Ens.Director` is now called before the existence check, so a delete in a namespace without Interoperability could answer a class error instead of "does not exist" — the Ens classes are mapped to every namespace on current IRIS and a status error skips the guard; only the wording of a refusal for a name that cannot exist is at stake.
  - `[low]` `[reject]` ECH5 a non-empty `result.status` other than `#16021` may be benign — the matrix row defines any non-empty string status as a refusal, and `iris_doc_load` has applied the same rule since it was captured live.
  - `[low]` `[reject]` ECH6 a caret in a malformed `target` is stripped from the echoed text by `SanitizeError` (Rule #33) — a caret is never a valid table name, and the refusal still fires; cosmetic.
  - `[low]` `[patch]` ECH7 a rebuild cannot clear a stale dist when file content is unchanged (a `touch`, or a regenerated identical file), so the "run build" remedy never helps — the STALE reason now ends with the remedy (delete `dist/` and `tsconfig.tsbuildinfo`, then rebuild); the existing stale case pins the text; mutation recorded.
  - `[low]` `[reject]` ECH8 `collectDeclaredTargets` omits `types`, `typings` and `browser` — the spec enumerates `main`, `module`, `bin` and `exports` (Rule #56, as of 2026-10-15) and every package repeats its `types` file under `exports["."].types`, which is checked; reopen_if a package declares a top-level-only `types` file.
  - `[medium]` `[patch]` ECH9 CHANGELOG claim "every `files` spelling of `dist`" is false for `dist/*` and `dist/**/*` — made true by the BH9 patch.
  - `[low]` `[reject]` ECH10 CHANGELOG claim that delete refuses any non-Stopped state and names it — covered by the BH2 and BH3 rejections; the claim holds for every state the existing map names and for every status that returns OK.
  - `[low]` `[patch]` ECH11 stale `HSCUSTOM` default in a `clients.ts` comment, and the stale `Interop.cls` get comment — `clients.ts` comment now reads `localhost/52773/USER/false`; the `Interop.cls` comment is the BH8 patch.
  - `[low]` `[patch]` ECH12 changeset lacks the cube-build fix the CHANGELOG lists — a paragraph added; no `@iris-mcp/data` entry because the suite packages are a fixed version group and the fix ships through the shared bootstrap embed.
  - `[medium]` `[defer]` VG1 the delete state guard is verified only at its predicate, not at the handler that wires it — same root as BH5, recorded in the fourth `deferred:` item.
  - `[medium]` `[patch]` VG2 the real-resend tests now pass with zero assertions on an instance without `SessionAgent.*`, leaving `ResendBatch` unexecuted there — `MessageResendTest:TestResendBatchReportsEveryNonexistentHeader` added (hermetic, no production, writes nothing); mutation (stop at the first failure) turned it red; `MessageResendTest` is now 12 tests and the package total 443.
  - `[low]` `[patch]` VG3 the launcher's real default lives in `package.json` and no test ties it to `readSettings` — `packaging.test` pin added next to the packages-default check; mutation (default back to `HSCUSTOM`) turned it red.
  - `[medium]` `[patch]` VG4 the `[WARN]` print of `verify-iris-reachable.mjs` is untested — spawn test added that points the target at a port it just released (no real instance contacted) and asserts exactly one WARN line naming only `IRIS_NAMESPACE, IRIS_HTTPS`; mutation turned it red; the file header comment updated.
  - `[low]` `[reject]` VG5 the DW-496 stepping clock has no red proof — probe run: a constant clock leaves `engine-e2e` 24 of 24 green (the backup-name disambiguation in `write.ts` absorbs same-millisecond stamps), so the clock is belt-and-braces and the pinned mechanism is the `checkDistFresh` assertion, whose mutation is recorded; a flake cannot be proven red deterministically; recorded honestly under Verification.
  - `[low]` `[patch]` VG6 `--no-file-parallelism` is pinned by no test — `prepublish-gate-sequential.test.ts` reads the script's `vitestArgs`; mutation (flag removed) turned it red; the `test-status-epic-gate` wrapper also mutation-verified live.
  - `[low]` `[patch]` VG7 (Rule 19 audit) AC-13 description pins, the launcher default, the DW-496 clock, the DW-511 flag and the WARN branch had no `mutation:` line — each demonstrated and recorded under Verification (description pins: four mutations; the others by the patches above); the AC-8 outer-catch restore is VG8 and the AC-11 wiring is VG1.
  - `[low]` `[reject]` VG8 the outer-catch `TeardownRedirect` in `Analytics.cls` is unreachable — pre-existing belt-and-braces mirroring `Command.cls`; no input reaches it and the pinned AC-8 path (build restore) is mutation-verified.
  - `[low]` `[patch]` VG9 Windows host dependence of the new dist-freshness cases — same root as BH11, fixed there.
  - `[low]` `[reject]` VG10 `MessageResendLiveTest` waits a fixed `Hang 2` and sweeps `DELETE ... WHERE ID > ?` — verbatim move of pre-existing methods that run only where the SessionAgent fixtures exist; the story moves them without changing them.
  - `[low]` `[reject]` VG11 `TestSystemOneIsAccepted` depends on the instance's `%Developer` privileges — the relation (system=1 lists more than system=0) is what the live capture pinned and every IRIS instance's `%Developer` holds system privileges.
  - `[low]` `[reject]` VG12 the `elapsedMs < 5000` assertion is load-dependent — loose by design (the script's own probe timeout is 10 s) and the spec asks for "well under 10 s".
  - `[low]` `[reject]` VG13 two redundant assertions (`toContain` implied by the preceding one, a charCode check implied by `toEqual`) — harmless and cannot mislead.
  - `[low]` `[reject]` VG14 the DW-527 forwarding is pinned only against a mock because the route answers 405 — documented limitation in the CHANGELOG and the third `deferred:` item.
  - `[low]` `[reject]` VG15 same as ECH8 (`types`/`typings` enumeration).
  - `[medium]` `[patch]` VG16 `StateName` is a third copy of the five-state list next to the two in `Interop.cls` (Rule 2, "extend, don't copy") — both existing sites now call `..StateName(...)`; status route read live (`state: "Stopped"`); bootstrap regenerated.
  - `[low]` `[reject]` VG17 `bootstrap.ts` `deployClasses` ignores `result.status` on its PUT — unverified and unreachable for generated embed content (no BOM); reopen_if a bootstrap deploy reports success while a handler class is missing.
  - `[medium]` `[defer]` IA1 `modifiedSince` expectation lives on a branch that does not run live (405) — pre-existing, same as the third `deferred:` item and BH6.
  - `[medium]` `[defer]` IA2 DW-54 expectation lives at the route and the tests sit on the helpers — same root as BH5 and VG1, fourth `deferred:` item.
  - `[low]` `[reject]` IA3 the orphan test creates a bare row, so "and its items" rests on IRIS's `%DeleteId`, not a test — the behavior is IRIS's own (live probe recorded under Auto Run Result) and the matrix mentions items parenthetically.
  - `[low]` `[reject]` IA4 no test targets the `Analytics` teardown — the existing analytics wire gate covers it and its mutation (build-path call deleted, redeployed) turned it red; delegation versus an inline copy is behavior-equivalent.
  - `[false]` `[reject]` IA5 no route change was made for `system` — the route already read `system` (`Security.cls`); the matrix's additive-route line is met by the TypeScript forwarding plus `TestSystemOneIsAccepted`, which exercises the route over HTTP.
  - `[false]` `[reject]` IA6 `get` adds `production` always, a superset of the "omitted" row — the matrix row says the response adds `production`; README, description and tests state "always".
  - `[low]` `[reject]` IA7 DW-485 is pinned at the tool handler with mocked HTTP, not through the built dist — the result shapes are live captures (Rule #54) and the built-dist smoke is the lead's per-story step (Rules #22, #26).
  - `[low]` `[patch]` IA8 the `clients.ts` comment still names `HSCUSTOM` as the runtime default — same as ECH11.
  - `[medium]` `[patch]` IA9 the DW-388 `[WARN]` stderr line is asserted only through `defaulted` — same as VG4.
  - `[low]` `[reject]` IA10 no committed test turns the epic35/epic37 gates red on a stale dist — the gate files are the tests; the stale-package path was proven red by touching a `src/` file and running the gate armed (Rule #59), recorded under Verification.
  - `[low]` `[reject]` IA11 host-specific real-resend tests report a pass when skipped — same as BH10.
  - `[low]` `[patch]` IA12 `--no-file-parallelism` is not pinned — same as VG6.
  - `[false]` `[reject]` IA13 bootstrap idempotence is not demonstrable from the diff — demonstrated by the final `gen:bootstrap` double run (same `shasum`, `BOOTSTRAP_VERSION` `3af8ca401e7c`).

## Design Notes

**Governing architecture decisions:** AD-1 (scripts reach IRIS only through the shared `IrisHttpClient`), AD-2 (cross-package checks stay in `scripts/` and `packages/iris-mcp-all`; client-config's test may import `scripts/lib`), AD-4 and AD-5 (no new key, frozen baseline, `:check` only), AD-8 (DW-520 and DW-523 describe its failure semantics), AD-9 (DW-469 changes a configuration default; DW-388 must never let a default loosen CI), AD-10 (counts unchanged), AD-11 (one envelope, `SanitizeError`, error-text shape), AD-12 (target validation is an IRIS-side identifier check, a recorded exception), AD-13 (namespace restore on the new orphan path), AD-14 (bootstrap regen), AD-15 (additive fields; the default change is sanctioned by orchestrator decision #5 in `orchestrator-decisions-wave-6.md`, made under the Lead's delegation; DW-54's stricter refusal and DW-527's `generated=0` align code with documented behavior; all three are named in `CHANGELOG.md`), AD-22 (orphan delete without `LoadFromClass`), AD-24 (BOM handling lives in `@iris-mcp/shared`), AD-29 (patch/minor changesets only), AD-31 (no privilege pre-check), AD-33 (additive routes). Conventions bound: Tool results (documented defaults sent explicitly), Refusals (existing IRIS-side refusal shapes are grandfathered; no new `structuredContent.code`), Error text, Logging (`console.error` with `[WARN]`), Live testing on a shared instance, IRIS-side unit tests. Lead note (Rule 20): AD-15's sanctioned-change list does not yet name the `IRIS_NAMESPACE` default.

**Integration ACs and linkage.**
- `stripLeadingBom` (`lines.ts`) and `atelierDocStatusError` (`atelier.ts`). Consumes: none. Consumed-by:
  - `iris_doc_put` and `iris_doc_load` in this story (AC-1, exercised through the tool handlers);
  - Story 38.2, which grows `lines.ts` into AD-24's line utility rather than starting a second module;
  - Stories 38.3 and 38.4, on the write path.
- `resolveIrisTarget` (`scripts/lib/iris-target.mjs`). Consumed-by: `verify-iris-reachable.mjs`, through the AC-7 process test.
- `checkDistFresh`. New consumers: the epic35 and epic37 gates (AC-6) and engine-e2e.
- `DeleteBlockedByState`. Consumed-by: the delete route, through AC-11's real-HTTP test.

**Extend, don't copy (Rule 2).**
- DW-455 calls Command's public `TeardownRedirect` cross-class rather than copying it. `UnitTest.cls` has a different shape (mnemonic restore, no null device) and stays out of scope.
- DW-485 extracts load.ts's inline BOM strip and status check into the shared helpers, and load.ts uses them. The older inline BOM copies in `server-manager-source.ts:531`, `cli/credentials.ts:391` and `client-config/readers.ts:460,539` are pre-existing and untouched.
- `InteropProductionDeleteTest` copies the roughly 25-line per-class `PostJson`/`ResolvePort` helper of `InteropItemCompositeKeyTest`. No shared OS test base exists, and both candidate classes are near or over the 500-line limit. Per-class helpers are the established OS-test pattern.
- DW-492 moves methods; it does not copy them. `MessageResendTest` is 545 lines, over the 500-line rule.

**Plan-time interpretations (apply-and-report tier, Rule 5).**
- **DW-523.** Logging the message as-is would delete the only prefix on the network-error path, which four pins rely on. The fix therefore adds the prefix only when it is missing. "Both test pins updated" becomes the two shared pins, tightened to exactly once.
- **DW-417.** Only targets under `dist/` are checked. `@iris-mcp/shared` also exports `./test-helpers` from `src/`; that is DW-506, which AC 42.1.3 owns.
- **DW-469.** The launcher follows the new default. Its `package.json:98-99` promises parity with `loadConfig()`, and `envContract.test.ts` exists to catch exactly this divergence. To reverse, keep the launcher on `HSCUSTOM` and reword its parity claim.
- **DW-470.** `system=0` is sent when the parameter is omitted. Both Rule #10 and the Tool-results convention require the documented default on the wire, so the 11 exact-path pins move.
- **DW-473.** "Malformed" means no dot, or an empty schema or table piece. `A.B.C` keeps its live-verified graceful result.
- **DW-54.** "Non-Stopped" means every state other than 2 and -2 (a mirror backup's Stopped), including Unknown, Suspended and ShardWorkerProhibited. The guard is meaningful only when the named production is the namespace's current production, because `GetProductionStatus` reports nothing else. A `GetProductionStatus` error keeps today's behavior.
- **DW-496.** At plan time the test did not reproduce in about 1,230 runs (10 isolated, 10 whole-file, 10 full-suite, and 1,200 stress runs). The leading hypothesis is a stale or swapped dist, hence the containment.
- **DW-388.** All six fallbacks count, and under CI any one of them refuses. `CI` counts as set unless it is unset, `""`, `0` or `false`, case-insensitive.

**Ledger inbox (all 27 addressed, none declined).**

| Entry | Covered by |
|---|---|
| DW-485 | AC-1 |
| DW-527 | AC-2 |
| DW-469 | AC-3 |
| DW-490, DW-492, DW-495, DW-496, DW-511 | AC-4 |
| DW-413, DW-414, DW-415, DW-416, DW-417 | AC-5 |
| DW-524 | AC-6 |
| DW-388 | AC-7 |
| DW-455 | AC-8 |
| DW-470, DW-473 | AC-9 |
| DW-450 | AC-10 |
| DW-54, DW-55 | AC-11 |
| DW-523 | AC-12 |
| DW-384, DW-458, DW-514, DW-520, DW-57 | AC-13 |

**Gotchas.**
- **Deploying changed handlers.** Run `iris_doc_load` once per class with a glob-prefixed path (Rule #17), for example `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/REST/Interop.cls`, with `compile:true`, `server:"default"`, `namespace:"HSCUSTOM"`. Load test classes the same way through `src/**/Tests/<Name>.cls`.
- **Stale classes from older embeds (DW-508).** A new server process built from an older embed can redeploy old classes. Before each live check, confirm the fix is present with `iris_doc_get`.
- **Rebuild shared before downstream tests.** Its dist and client-config's are stale by mtime today, so rebuild shared before any downstream test.
- **`system` as a number.** `+"true"` is 0, so `system` must go on the wire as `1` or `0`.
- **Error text.** Strip one `ERROR #N:` prefix before re-wrapping (Rule #8), and name no global with a caret in sanitized text (Rule #33).

**X.0 triage table** (Epic 38 gate, 2026-10-15). It covers Epic 37 (no retrospective; no open action items) and the Rule #37 drain carried from Epics 36 and 37: all 126 `burndown`-owned ledger entries. Each row's evidence, and the `reopen_if` of every `wontfix-accepted` row, is in that entry's `by=x0` trailer (`ledger.sh show DW-n`) and in `epic-38-x0-triage-2026-10-15.tsv`. DW-527 was filed new at this gate and is owned by this story.

| Item | Source | Disposition |
|---|---|---|
| DW-2 | ledger | terminal:wontfix-accepted |
| DW-28 | ledger | terminal:wontfix-accepted |
| DW-36 | ledger | resolved-by:10-6-typescript-docs-cleanup-post-retro-polish |
| DW-38 | ledger | terminal:wontfix-accepted |
| DW-39 | ledger | terminal:wontfix-theoretical |
| DW-40 | ledger | terminal:wontfix-theoretical |
| DW-41 | ledger | terminal:wontfix-theoretical |
| DW-44 | ledger | resolved-by:34-2-handler-capture-byref-markers-20-arg-ladder |
| DW-49 | ledger | terminal:wontfix-theoretical |
| DW-50 | ledger | terminal:wontfix-theoretical |
| DW-53 | ledger | terminal:wontfix-theoretical |
| DW-54 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-55 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-56 | ledger | terminal:wontfix-accepted |
| DW-57 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-59 | ledger | terminal:wontfix-theoretical |
| DW-61 | ledger | terminal:wontfix-accepted |
| DW-62 | ledger | terminal:wontfix-accepted |
| DW-66 | ledger | terminal:wontfix-accepted |
| DW-69 | ledger | terminal:wontfix-theoretical |
| DW-70 | ledger | terminal:wontfix-theoretical |
| DW-71 | ledger | terminal:wontfix-theoretical |
| DW-72 | ledger | terminal:wontfix-accepted |
| DW-84 | ledger | resolved-by:15-1-iris_service_manage-iris-service-configuration |
| DW-86 | ledger | terminal:wontfix-theoretical |
| DW-87 | ledger | terminal:wontfix-theoretical |
| DW-88 | ledger | terminal:wontfix-theoretical |
| DW-90 | ledger | terminal:wontfix-theoretical |
| DW-91 | ledger | terminal:wontfix-theoretical |
| DW-93 | ledger | terminal:wontfix-accepted |
| DW-94 | ledger | terminal:wontfix-theoretical |
| DW-95 | ledger | terminal:wontfix-accepted |
| DW-100 | ledger | terminal:wontfix-accepted |
| DW-101 | ledger | terminal:wontfix-theoretical |
| DW-103 | ledger | terminal:wontfix-theoretical |
| DW-104 | ledger | terminal:wontfix-theoretical |
| DW-128 | ledger | resolved-by:35-1-high-iris_production_item-set-composite-key-resolution |
| DW-161 | ledger | terminal:by-design |
| DW-199 | ledger | terminal:wontfix-theoretical |
| DW-384 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-388 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-390 | ledger | terminal:wontfix-theoretical |
| DW-391 | ledger | terminal:wontfix-accepted |
| DW-392 | ledger | terminal:wontfix-theoretical |
| DW-393 | ledger | terminal:wontfix-theoretical |
| DW-402 | ledger | terminal:wontfix-accepted |
| DW-403 | ledger | terminal:wontfix-theoretical |
| DW-404 | ledger | terminal:wontfix-theoretical |
| DW-405 | ledger | terminal:wontfix-theoretical |
| DW-406 | ledger | terminal:wontfix-accepted |
| DW-407 | ledger | terminal:wontfix-theoretical |
| DW-408 | ledger | terminal:wontfix-theoretical |
| DW-409 | ledger | terminal:wontfix-theoretical |
| DW-410 | ledger | terminal:wontfix-theoretical |
| DW-411 | ledger | terminal:wontfix-accepted |
| DW-412 | ledger | terminal:wontfix-theoretical |
| DW-413 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-414 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-415 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-416 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-417 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-419 | ledger | terminal:wontfix-accepted |
| DW-420 | ledger | terminal:by-design |
| DW-421 | ledger | terminal:wontfix-accepted |
| DW-422 | ledger | terminal:wontfix-theoretical |
| DW-423 | ledger | terminal:wontfix-theoretical |
| DW-424 | ledger | terminal:wontfix-theoretical |
| DW-425 | ledger | terminal:wontfix-accepted |
| DW-426 | ledger | terminal:wontfix-accepted |
| DW-427 | ledger | terminal:wontfix-theoretical |
| DW-440 | ledger | own:42-9-install-docs-and-client-re-certification |
| DW-442 | ledger | own:42-9-install-docs-and-client-re-certification |
| DW-444 | ledger | terminal:wontfix-accepted |
| DW-446 | ledger | terminal:wontfix-accepted |
| DW-447 | ledger | terminal:by-design |
| DW-448 | ledger | terminal:wontfix-accepted |
| DW-449 | ledger | terminal:by-design |
| DW-450 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-451 | ledger | terminal:wontfix-accepted |
| DW-452 | ledger | terminal:wontfix-theoretical |
| DW-453 | ledger | own:40-1-line-coverage-probe-and-engine |
| DW-454 | ledger | terminal:wontfix-accepted |
| DW-455 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-456 | ledger | terminal:wontfix-accepted |
| DW-457 | ledger | terminal:wontfix-accepted |
| DW-458 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-459 | ledger | terminal:wontfix-accepted |
| DW-460 | ledger | terminal:wontfix-theoretical |
| DW-461 | ledger | terminal:wontfix-theoretical |
| DW-462 | ledger | terminal:wontfix-accepted |
| DW-463 | ledger | terminal:wontfix-theoretical |
| DW-465 | ledger | terminal:dropped |
| DW-467 | ledger | terminal:wontfix-accepted |
| DW-469 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-470 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-471 | ledger | terminal:wontfix-theoretical |
| DW-472 | ledger | terminal:by-design |
| DW-473 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-475 | ledger | terminal:by-design |
| DW-476 | ledger | resolved-by:38-0-epic-37-deferred-cleanup |
| DW-481 | ledger | terminal:wontfix-accepted |
| DW-485 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-486 | ledger | terminal:dropped |
| DW-490 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-492 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-495 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-496 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-497 | ledger | terminal:wontfix-accepted |
| DW-498 | ledger | own:40-4-test-depth-docs-prompt-and-capstone |
| DW-503 | ledger | terminal:wontfix-accepted |
| DW-509 | ledger | terminal:wontfix-theoretical |
| DW-510 | ledger | terminal:wontfix-accepted |
| DW-511 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-512 | ledger | terminal:wontfix-accepted |
| DW-513 | ledger | terminal:wontfix-accepted |
| DW-514 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-515 | ledger | terminal:by-design |
| DW-516 | ledger | terminal:wontfix-accepted |
| DW-517 | ledger | terminal:by-design |
| DW-518 | ledger | own:42-2-bootstrap-downgrade-guard |
| DW-519 | ledger | terminal:wontfix-accepted |
| DW-520 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-523 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-524 | ledger | own:38-0-epic-37-deferred-cleanup |
| DW-525 | ledger | terminal:wontfix-accepted |
| DW-526 | ledger | terminal:by-design |

## Verification

Runtime target for every IRIS call is `server:"default"` (localhost:52773). Confirm it with `iris_server_info` before the first live step. Use `namespace:"HSCUSTOM"` on every call. Stateful OS test classes run one class per tool call, wait for completion, and are never batched in one message. A client-side timeout is never re-submitted; poll with `iris_test_status`. Every command below runs in the foreground with `timeout: 600000`.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/config.test.ts src/__tests__/lines.test.ts src/__tests__/atelier-doc-status.test.ts src/__tests__/server-base.test.ts src/__tests__/server-base-default-outage-coverage.test.ts src/__tests__/bootstrap.test.ts` -- expected: all pass.
- `(loop)` `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc.test.ts src/__tests__/load.test.ts src/__tests__/export.test.ts src/__tests__/request-body-utf8-decode.test.ts` -- expected: all pass.
- `(loop)` `pnpm --filter @iris-mcp/admin exec vitest run src/__tests__/resource.test.ts src/__tests__/resource-listprivileges-bound.test.ts src/__tests__/resource-listprivileges-superuser-coverage.test.ts src/__tests__/resource-sqlpriv-coverage.test.ts` -- expected: all pass.
- `(loop)` `pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/item.test.ts src/__tests__/production.test.ts` -- expected: all pass.
- `(loop)` `pnpm --filter @iris-mcp/client-config build && pnpm --filter @iris-mcp/client-config exec vitest run src/__tests__/certification-process.test.ts src/__tests__/engine-e2e.test.ts` -- expected: all pass.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/dist-freshness.test.ts src/__tests__/verify-iris-reachable-target.test.ts src/__tests__/epic35-defect-gate.test.ts src/__tests__/epic37-default-outage-gate.test.ts` -- expected: all pass or skip with a stated reason (unarmed).
- `(loop)` `npm --prefix /Users/jbrandt/git/iris-execute-mcp-v2/extensions/iris-mcp-launcher test -- src/__tests__/settings.test.ts src/__tests__/envContract.test.ts` -- expected: all pass, envContract oracle available.
- `(loop)` the iris-dev MCP tool `iris_execute_tests` with `level:"class"`, one call each: `ExecuteMCPv2.Tests.InteropHostGuardTest` (6), `InteropProductionDeleteTest` (3), `InteropItemCompositeKeyTest` (9), `SqlPrivilegeBoundTest` (7), `MessageResendTest` (12), `MessageResendLiveTest` (2) -- expected: `total` equals the count in brackets, 0 failed.
- `(once)` `pnpm --filter @iris-mcp/<pkg> build`, then `test`, `lint` and `type-check` where defined, one command per package: shared, dev, admin, interop, ops, data, client-config, then `pnpm --filter @iris-mcp/all test` -- expected: green. This is the accepted per-package substitute for the flaky parallel turbo run (35-1-DEV-1).
- `(once)` `npm --prefix /Users/jbrandt/git/iris-execute-mcp-v2/extensions/iris-mcp-launcher test` -- expected: green.
- `(once)` `pnpm gen:governance-baseline:check` -- expected: exit 0 at `1e62c5ad5bf7`/141.
- `(once)` `pnpm gen:bootstrap`, then `git -C /Users/jbrandt/git/iris-execute-mcp-v2 diff --stat`, then `pnpm gen:bootstrap` again -- expected: the second run changes nothing; record `BOOTSTRAP_VERSION` from/to.
- `(once)` `pnpm --filter @iris-mcp/dev exec node scripts/prepublish-gate.mjs` and `pnpm --filter @iris-mcp/data exec node scripts/prepublish-gate.mjs`, with `IRIS_HOST=localhost`, `IRIS_PORT=52773`, `IRIS_NAMESPACE=HSCUSTOM` and the `default` profile's credentials exported explicitly -- expected: exit 0. The dev run's gate files run sequentially.
- `(once)` `iris_execute_tests` with `target:"ExecuteMCPv2.Tests"`, `level:"package"` (poll `iris_test_status` until complete) -- expected: `total` equals `grep -rE '^Method Test[A-Za-z0-9]+\(' /Users/jbrandt/git/iris-execute-mcp-v2/src/ExecuteMCPv2/Tests/*.cls | wc -l`, which is 435 today and 443 when the tests above land; 0 failed (Rule #35, Rule #51).

**Disposable fixtures (destructive checks).** All in `HSCUSTOM`:
- `ExecuteMCPv2.Temp.Story380Orphan`: an orphan `Ens.Config.Production` row with no class (DW-55).
- `ExecuteMCPv2.Temp.Story380Prod`: a production created through the `create` action and never started (DW-54 normal path).
- `ExecuteMCPv2.Temp.Story380Missing`: never created; used for the refusal with nothing changed.
- `ExecuteMCPv2.Temp.Story380Bom.cls`: used for the BOM and status live capture (DW-485).
- The existing checked-in `ExecuteMCPv2.Tests.InteropCompositeKeyFixtureProd`/`Prod2`, restored by their class (DW-450).
- `SqlPrivilegeBoundTest`'s own disposable grants, with targets `NoDotHere`, `S.` and `.T` (DW-470, DW-473).
- The nonexistent cube `ZZ_STORY_35_2_NO_SUCH_CUBE` (DW-455).

Closing check: `iris_doc_list` with prefix `ExecuteMCPv2.Temp.` and `SELECT Name FROM Ens_Config.Production WHERE Name %STARTSWITH 'ExecuteMCPv2.Temp.'` both return nothing.

**Planned mutations (Rule 19; record each as `mutation: … → …` here when run).** Revert each mutation and confirm `git status --short` and `git diff --stat` are unchanged.

| AC | Mutation | Expected red |
|---|---|---|
| AC-1 | drop the status check | doc.test non-empty-status case |
| AC-2 | drop `generated` on the modified branch | export.test modified-branch case |
| AC-3 | default back to `HSCUSTOM` | config.test and envContract |
| AC-4 | DW-495 realpath removed | certification drift test |
| AC-4 | DW-492 guard removed (the SessionAgent classes are absent from `HSCUSTOM`, checked 2026-10-15) | `MessageResendLiveTest` fails on the missing class; with the guard it logs SKIP and passes |
| AC-4 | DW-490 guard reverted while `fixtureSkipReason` is set | utf8 key test fails instead of skipping |
| AC-4 | DW-511: invert the `running.isError` expectation temporarily | the failure text contains the recorded work response |
| AC-5 | each guard removed in turn | its dist-freshness case |
| AC-6 | `touch` one `src/` file, run the gate armed | stale-package failure, then rebuild; this is the path the gate guards (Rule #59) |
| AC-7 | CI branch removed | process test |
| AC-8 | delete the build-path `TeardownRedirect` call and redeploy | analytics wire gate red; then restore and redeploy |
| AC-9 | drop `system` forwarding, then drop the target validation and redeploy | bound wire test; SqlPrivilegeBoundTest malformed case |
| AC-10 | drop `production` from the get response | InteropItemCompositeKeyTest new case |
| AC-11 | revert the predicate to `pState = 1` | TestDeleteBlockedByState |
| AC-11 | drop the orphan branch | InteropProductionDeleteTest orphan case |
| AC-12 | unconditional prefix | the new 401 exactly-once case |

**Mutation results (Rule #19, run 2026-10-15).** Each mutation was reverted afterwards and the file confirmed byte-identical (`cmp`/`diff` against a copy taken before the mutation; for the three bootstrapped handlers also the same `shasum` as before, then redeployed with `compile:true`):
- mutation: AC-1 `doc.ts` status check dropped (`if (false && refusal !== undefined)`) -> `doc.test` "returns isError with the status text when IRIS refuses the document" red (1 failed, 47 passed)
- mutation: AC-1 `doc.ts` BOM strip skipped (string and array paths) -> `doc.test` "strips a leading BOM from string content before the PUT" and "strips a leading BOM from array content without mutating the caller's array" red (2 failed, 46 passed)
- mutation: AC-2 `export.ts` `generated` dropped on the `/modified` branch (`queryString && !modifiedSince`) -> `export.test` "modifiedSince with the default generated sends generated=0 on /modified" and "modifiedSince with generated 'true' sends generated=1 on /modified" red (2 failed, 27 passed)
- mutation: AC-3 `loadConfig` default back to `HSCUSTOM` (shared rebuilt) -> `config.test` "should apply defaults for optional fields" and "should leave sqlMaxRows/sqlTimeoutMs undefined ..." red, and launcher `envContract` "the namespace default the extension advertises is the one the consumer would have used anyway" red (shared rebuilt again after the revert, 8 of 8 green)
- mutation: AC-4 DW-495 `realpathSync` removed from `mkTmp` -> `certification-process` "QA 33.4: doctor config-drift edges (process level) > drift at PROJECT scope ..." red (1 failed, 24 passed)
- mutation: AC-4 DW-492 both `MessageResendLiveTest` guards replaced by `If 0 {`, class redeployed -> `TestRealResendAgainstScratchProduction` and `TestResendBatchContinuesPastBadHeader` both failed ("Scratch production starts => ERROR <Ens>ErrInvalidProduction"; "<CLASS DOES NOT EXIST> ... SessionAgent.Sample.BS.OrderIngest"); restored and redeployed: 2 of 2 pass, each logging `SKIP: SessionAgent.Sample.Production is not a compiled class in namespace HSCUSTOM` (read back from `%UnitTest_Result.TestAssert`)
- mutation: AC-4 DW-490 guard reverted to `if (skipReason)` with `FIXTURE` pointed at a class absent from HSCUSTOM (so `fixtureSkipReason` is set) -> "a non-ASCII JSON KEY elsewhere in the request body ..." failed ("expected true to be undefined"); with the guard in place the same run skipped it
- mutation: AC-4 DW-511 `running.isError` expectation inverted in `execute-tests-running-contract-epic-gate.test.ts` -> red with the message `running.isError; last Atelier work/ response: {"status":{"errors":[],"summary":""},"console":[],"result":[],"retryafter":"3"}: expected false to be true`
- mutation: AC-5 `normalizeFilesEntry` returning the raw entry -> dist-freshness `files ["dist/"]`, `["./dist"]`, `["dist/**"]` cases red (3)
- mutation: AC-5 symlink branch disabled (`if (false && entry.isSymbolicLink())`) -> "follows a symlinked file", "fails closed on a dangling symlink", "fails closed on a symlink to a directory" red (3)
- mutation: AC-5 future-mtime guard disabled -> "fails closed when a dist file is dated more than 60 s after the injected now" red (1)
- mutation: AC-5 declared-target loop emptied -> the four `module` / `bin` map / string `bin` / nested `exports` missing-target cases red (4)
- mutation: AC-5 outside-`dist/` targets examined (the `continue` removed) -> "ignores an `exports` target outside dist/" red (1)
- mutation: AC-5 never-throws wrapper rethrows -> seven "never throw" cases red (malformed, missing and non-object `package.json`, `src` not a directory, unreadable subdirectory, dangling symlink, directory symlink)
- mutation: AC-5 missing or malformed `package.json` returned as skipped -> "returns ok:false naming the cause for a malformed package.json" and "returns ok:false for a missing package.json" red (2)
- mutation: AC-6 `touch packages/iris-interop-mcp/src/tools/item.ts`, epic35 gate run armed (`IRIS_REQUIRE_LIVE=1`) -> `beforeAll` threw "IRIS_REQUIRE_LIVE is set, so the Epic 35 defect gate may not be skipped: iris-interop-mcp's src/ has been modified more recently than its dist/ ... STALE" with all 9 legs not run; likewise epic37 after `touch packages/iris-ops-mcp/src/index.ts`; unarmed, each leg skipped logging the same reason; both dists then rebuilt clean (a `touch` leaves content unchanged, so `tsc` skips emit until `dist/` and `tsconfig.tsbuildinfo` are removed) and the armed run was green again (11 of 11)
- mutation: AC-7 `defaulted.length > 0 && isCi(env)` replaced by `false && isCi(env)` -> six CI unit cases and the spawned-process case red (7 failed, 13 passed)
- mutation: AC-8 build-path `TeardownRedirect` call deleted from `Analytics.cls` and redeployed -> `analytics-cubes-wire-gate` "the raw wire body for a build against a nonexistent cube is valid, parseable JSON ..." red ("expected '' to be '{'"); restored and redeployed: 2 of 2 green
- mutation: AC-9 `system` forwarding removed from `resource.ts` -> 11 admin tests red (the 7 updated exact-path pins plus the 4 new `system` cases)
- mutation: AC-9 target validation disabled in `Security.cls` (`If 0 && (tTarget ...`) and redeployed -> `SqlPrivilegeBoundTest:TestMalformedTargetsReturnValidationError` red for `NoDotHere`, `S.` and `.T` (each returned `ERROR #5001: ObjectScript error: <SUBSCRIPT>SQLUserColumnPrivsExecute`, the pre-fix text); the other 6 tests stayed green
- mutation: AC-10 `production` dropped from the `get` response in `Interop.cls` and redeployed -> `InteropItemCompositeKeyTest:TestGetOmittedProductionEchoesProduction` red ("the echoed production is one of the two fixture productions (got: )"); the other 8 stayed green
- mutation: AC-11 predicate reverted to `pState = 1` -> `InteropHostGuardTest:TestDeleteBlockedByState` red for states 0, 3, 4, 5 and 6 (the other 5 tests green)
- mutation: AC-11 refusal text (Matrix Test Audit addition: `DeleteBlockedMessage` extracted from the handler so the Running and named-state texts are pinned without starting a production) Running special case disabled (`If 0 Quit ...`) and redeployed -> `InteropHostGuardTest:TestDeleteBlockedByState` red ("Running keeps its exact refusal text"); reverted (`cmp` identical), redeployed, 6 of 6 green; `BOOTSTRAP_VERSION` regenerated to `3af8ca401e7c`
- mutation: AC-11 orphan branch disabled (`ElseIf 0 && ...`) -> `InteropProductionDeleteTest:TestDeleteOrphanRowRemoved` red (`Production '...Story380Orphan' does not exist`); the other 2 stayed green
- mutation: AC-12 unconditional prefix in `server-base.ts` -> `server-base-default-outage-coverage` "an HTTP 401 on the health HEAD ..." red (1 failed, 63 passed); the network-error pin stays green by design (an unprefixed message gets exactly one prefix either way)
- mutation: DW-496 containment, `touch packages/client-config/src/engine.ts` -> `engine-e2e` `beforeAll` failed with "... STALE ... Run "pnpm --filter @iris-mcp/client-config build" and retry." (24 skipped); after a clean rebuild 24 of 24 pass
- mutation (review pass): AC-5 `normalizeFilesEntry` reverted to strip only a trailing `/**` -> dist-freshness `files ["dist/*"]`, `["dist/**/*"]` and `["./dist/**/*"]` cases red (3); the stale-reason remedy text for a rebuild that emits nothing removed (`tsconfig.tsbuildinfo` -> `tsconfig.x`) -> "fails closed when src/ has been modified more recently than dist/" red (1)
- mutation (review pass): AC-3 launcher `package.json` `irisMcpLauncher.namespace` default back to `HSCUSTOM` -> launcher `packaging.test` "namespace default EXACTLY matches the default readSettings falls back to" red ("expected 'HSCUSTOM' to be 'USER'"); every other launcher test stayed green before the new pin existed
- mutation (review pass): AC-7 the `[WARN]` print disabled (`if (false) {` for the defaulted-variables block) -> `verify-iris-reachable-target` "warns on stderr, naming exactly the variables left unset, when CI is not set" red ("expected [] to have a length of 1"); the spawned process targets 127.0.0.1 on a port it just released, so no real instance is contacted
- mutation (review pass): AC-4 DW-511 sequencing, `--no-file-parallelism` removed from `prepublish-gate.mjs` -> `prepublish-gate-sequential.test` red; and the `test-status-epic-gate` wrapper (`status !== "running"` expectation flipped to `"completed"`, gate run armed with the six IRIS variables exported) -> red with `last Atelier work/ response: {"status":{"errors":[],"summary":""},"console":[],"result":[],"retryafter":"3"}` in the message
- mutation (review pass): AC-4 DW-496 stepping clock replaced by a constant clock (client-config rebuilt so the tests ran) -> engine-e2e stayed 24 of 24 green. The stepping clock is therefore belt-and-braces (the backup-name disambiguation in `write.ts` already absorbs same-millisecond stamps); the pinned mechanism of this containment is the `checkDistFresh` assertion in `beforeAll`, whose mutation is recorded above
- mutation (review pass): AC-13/AC-10/AC-11 description pins -> `item.ts` "skipped by enable/disable" reworded to "ignored by enable/disable" -> `item.test` DW-458 pin red (1); `item.ts` "always names the 'production'..." reworded -> `item.test` DW-450 pin red (1); `production.ts` "returns orphanRemoved: true" reworded -> `production.test` DW-54/DW-55 description pin red (1); `doc.ts` "is returned as an error carrying IRIS's text; nothing is stored then" replaced by "is reported as saved" -> `doc.test` "description documents the BOM strip and the error returned for a refused write" red (1)
- mutation (review pass): AC-4 DW-492 follow-on, hermetic `MessageResendTest:TestResendBatchReportsEveryNonexistentHeader` (no production needed): `ResendBatch` made to stop at the first failed header (`If 'tItem.%Get("ok") { Quit }`) and redeployed -> the new test red ("one result entry per header: the batch did not stop at the first failure"); reverted (`cmp` identical), redeployed, `MessageResendTest` 12 of 12 green

**Live captures the pins were taken from (2026-10-15, IRIS 2026.2, Atelier v8, `default` / `HSCUSTOM`).**
- Atelier `PUT /doc/ExecuteMCPv2.Temp.Story380Bom.cls`: a first line starting with U+FEFF returned HTTP 200, empty `status.errors` and `result` `{name, db:"", ts:"", cat:"CLS", enc:false, content:"", status:"ERROR #16021: Illegal Header Line: <U+FEFF>Class ExecuteMCPv2.Temp.Story380Bom Extends %RegisteredObject"}` (nothing stored: `HEAD` 404); the same document without the BOM returned `result` `{name, db:"HSCUSTOM", ts, upd:false, cat:"CLS", status:"", enc:false, flags:0, content:[]}`.
- `GET .../sqlprivilege?grantee=_SYSTEM&target=<T>`: `NoDotHere`, `S.`, `.T` and `.` each returned HTTP 200 with one `status.errors` entry `ERROR #5001: Parameter 'target' must be 'schema.table' for listPrivileges (got '<T>'). Omit target for an object-level listing.` and `result:{}`; `A.B.C` returned `{grantee, target:"A.B.C", level:"column", privileges:[], count:0}` with no error.
- `GET .../sqlprivilege?grantee=%25Developer&maxRows=1000`: `system=0` and no `system` returned 11 rows, `system=1` returned 576; `system=true` behaves as 0; at the default cap `system=1` returned 100 rows with `rowsCapped:true`.
- Disposable probe class (deleted): `$ZAbs(-2)` is 2; an `Ens.Config.Production` row with no class is created by `%New()`/`Name`/`%Save()` and removed by `%DeleteId` (which also deletes its items); `Ens.Director:GetProductionStatus` in HSCUSTOM reported no current production (`""`) and state 2, so no Running production exists to refuse against and none was started.

**Not driven on the wire.** A delete of a production in state Running, Suspended, Troubled or NetworkStopped needs the target to be the namespace's current production in that state; no production was started (the fixtures are never started), so the refusal message for those states is pinned only through `DeleteBlockedByState`/`StateName` (`TestDeleteBlockedByState`) and the AC-11 predicate mutation, not by a live refusal.

**Shared surfaces:** these are what this story changes and other tests assert on:
- the `IRIS_NAMESPACE` default (`config.test.ts`, launcher `settings.test.ts`, `envContract.test.ts`);
- the `@iris-mcp/shared` index export list;
- `bootstrap-classes.ts` and `BOOTSTRAP_VERSION` (`bootstrap.test.ts` drift);
- the listPrivileges wire querystring (11 exact-path pins in 4 admin test files);
- the `iris_production_item` `get` response and the production `delete` response (interop mocks);
- the `MessageResendTest` method roster (grep for the two moved method names);
- the OS `Test*` total (435 → 443);
- the `CHANGELOG.md` head, where `docs-visibility-roster-sync.test.ts` reads the Epic 30 roster line, which must stay untouched;
- the doc_put success text (pinned at `tools.integration.test.ts:129` and `doc.test.ts:207`, unchanged).

Package tool counts are unchanged.

Standing criterion: every test added or changed passes on a fresh environment, in either order.

**Manual checks:**
- `grep -rn "IRIS health check failed: IRIS health check failed" /Users/jbrandt/git/iris-execute-mcp-v2/packages --include=*.ts` returns nothing outside tests.
- `grep -n "Story 1.4\|monitoring loop" packages/shared/src/health.ts` returns nothing.
- `grep -n "console warning" packages/iris-data-mcp/src/tools/docdb.ts` returns nothing.
- `grep -n "ceiling=32768chars" CHANGELOG.md .changeset/execute-response-ceiling-and-gate-hardening.md` lines also state `ceiling=<N>` and the `[IRIS-MCP-TRUNCATED` prefix.
- `README.md:541` names unreachable-at-startup and `Tool error:`.
- `grep -rn "IRIS_NAMESPACE ??" /Users/jbrandt/git/iris-execute-mcp-v2/packages /Users/jbrandt/git/iris-execute-mcp-v2/scripts --include=*.ts --include=*.mjs` -- every hit outside `config.ts` names an explicit fallback (AC-3).

## Auto Run Result

Status: done
Blocking condition: none

**Summary of the implemented change.** All 27 ledger entries routed to this story were addressed and every acceptance criterion has a pinning test proven red by a named mutation (see `## Verification`). `iris_doc_put` strips a leading BOM and reports a refused write as an error (shared helpers `stripLeadingBom` and `atelierDocStatusError`, reused by `iris_doc_load`); `iris_doc_export` forwards `generated` on `modifiedSince`; `IRIS_NAMESPACE` defaults to `USER` in `loadConfig`, `.env.example` and the VS Code launcher; `checkDistFresh` is hardened and used by the epic35/epic37 gates and `engine-e2e`; `verify-iris-reachable.mjs` warns on, and under CI refuses, defaulted variables; the dev prepublish gate runs sequentially and prints the last `work/` response on a running-state failure; `listPrivileges` forwards `system` and validates `target`; `iris_production_item get` names its production; `iris_production_manage delete` refuses a non-Stopped current production and removes orphan rows; the cube-build redirect restore goes through `TeardownRedirect`; the startup health-check failure is logged with its prefix once; and the doc claims of DW-384, DW-458, DW-514, DW-520 and DW-57 were corrected. `BOOTSTRAP_VERSION` moved `2159ec9e6f69` -> `3af8ca401e7c` (regenerated three times: implement pass, Matrix Test Audit, review patches).

**Files changed.**
- Shared (`packages/shared/src`): `lines.ts` (new, `stripLeadingBom`), `atelier.ts` (`atelierDocStatusError`), `index.ts` (exports), `config.ts` (`USER` default), `health.ts` (comments), `server-base.ts` (prefix once), `bootstrap-classes.ts` (regenerated); tests `lines.test.ts`, `atelier-doc-status.test.ts` (new), `config.test.ts`, `server-base.test.ts`, `server-base-default-outage-coverage.test.ts`.
- Dev (`packages/iris-dev-mcp`): `src/tools/doc.ts` (BOM strip, refusal as error, description), `src/tools/load.ts` (shared helpers), `src/tools/export.ts` (`generated` on `/modified`), `scripts/prepublish-gate.mjs` (sequential), `README.md`; tests `doc.test.ts`, `export.test.ts`, `request-body-utf8-decode.test.ts`, `execute-tests-running-contract-epic-gate.test.ts`, `test-status-epic-gate.test.ts`, `prepublish-gate-sequential.test.ts` (new).
- Admin (`packages/iris-admin-mcp`): `src/tools/resource.ts` (`system`, description), `README.md`, four `resource*` test files.
- Interop (`packages/iris-interop-mcp`): `src/tools/item.ts`, `src/tools/production.ts` (descriptions), `README.md`, `item.test.ts`, `production.test.ts`.
- Data and client-config: `packages/iris-data-mcp/src/tools/docdb.ts` (comment), `packages/client-config/src/cli/clients.ts` (comment), `certification-process.test.ts` (realpath), `engine-e2e.test.ts` (stepping clock, freshness assertion).
- Scripts and cross-package tests: `scripts/lib/dist-freshness.mjs` (hardened), `scripts/lib/iris-target.mjs` (new), `scripts/verify-iris-reachable.mjs`; `packages/iris-mcp-all/src/__tests__/` `dist-freshness.test.ts`, `verify-iris-reachable-target.test.ts` (new), `epic35-defect-gate.test.ts`, `epic37-default-outage-gate.test.ts`.
- ObjectScript (`src/ExecuteMCPv2`): `REST/Interop.cls` (`DeleteBlockedByState`, `StateName`, `DeleteBlockedMessage`, delete guard and orphan path, `get` `production`), `REST/Security.cls` (`target` validation), `REST/Analytics.cls` (`TeardownRedirect`); tests `InteropHostGuardTest`, `InteropItemCompositeKeyTest`, `SqlPrivilegeBoundTest`, `MessageResendTest` (changed), `InteropProductionDeleteTest`, `MessageResendLiveTest` (new).
- Launcher (`extensions/iris-mcp-launcher`): `src/settings.ts`, `package.json`, `README.md`, `CHANGELOG.md`, `settings.test.ts`, `envContract.test.ts`, `packaging.test.ts`.
- Docs and release: `CHANGELOG.md`, `.changeset/story-38-0-epic-37-deferred-cleanup.md` (new), `.changeset/execute-response-ceiling-and-gate-hardening.md`, `README.md`, `.env.example`, `tool_support.md`.

**Review findings breakdown (pass 1, 2026-10-15, four layers).** 53 findings: high 0, medium 12, low 38, false 3. Patches applied: 20 rows over 13 root causes (7 medium rows over 4 medium entries: the `files` glob spellings of the freshness check, the hermetic `ResendBatch` test, the `[WARN]` spawn test, and the `StateName` reuse; the rest low): documentation and comment corrections, Windows guards on the new freshness cases, the stale-dist remedy text, a launcher `package.json` default pin, a sequencing pin for the dev gate, and the missing `mutation:` lines. Deferred: 5 rows in 2 entries, recorded as the third and fourth `deferred:` items (the `modifiedSince` route and its descriptions; the unwired delete-guard test); the fifth item (the launcher's macOS failures) comes from verification, not from a finding. Rejected: 28 rows (25 low, 3 false), each with its reason in `## Review Triage Log`.

**Follow-up review recommended: true.** Four medium entries were patched after the review layers returned, so no layer has seen them: the new `files` normalization regex in `scripts/lib/dist-freshness.mjs`, the `StateName` refactor of two existing `Interop.cls` call sites (the production-summary site was not exercised live), the new spawn test, and the new `ResendBatch` test. Each carries a recorded mutation, and the OS package and every per-package suite were re-run green after the patches.

**Verification performed.** Per-section details follow and in `## Verification`. After the last patch: every `(loop)` command re-run green (shared 162, dev 161, admin 82, interop 97, client-config 49, all 67 across the four named files with the live gates executing, launcher settings and envContract 33; the six OS classes were run one per call and the whole package after the final deploy); `(once)`: per-package build, test, lint and type-check green for shared, dev, admin, interop, ops, data, client-config and all; the full launcher suite red for baseline reasons only (fifth `deferred:` item); `pnpm gen:governance-baseline:check` exit 0; `pnpm gen:bootstrap` twice with the same `shasum`; dev and data `prepublish-gate.mjs` exit 0 after a clean rebuild of shared; the full `ExecuteMCPv2.Tests` package run 443 of 443; closing check clean.

**DW-527 live probe (AC-2).** Timestamp `2026-10-15T12:26:38Z`, then `ExecuteMCPv2.Temp.Story380Bom.cls` put and compiled in HSCUSTOM on `default` (its generated routine `...Story380Bom.1`), then `iris_doc_list` with `modifiedSince` and `generated` `true` then `false`: both calls failed with `IRIS returned HTTP 405 for GET /api/atelier/v8/HSCUSTOM/modified/<ts>?generated=1` (and `=0`). So no generated document appears either way, and the "keep the forwarding, record the evidence, add a `deferred:` item" branch applies. Cause (read from the `%Api.Atelier.v1` source via the doc API, not assumed): the route is `/:namespace/modified/:type` with `Method="POST"`, `OPTIONS` answers `ALLOW: POST,OPTIONS`, `type` must be `CLS` and the body is a JSON array of `{dbname, dbhash}`; the handler does read `+%request.Get("generated")`, and `POST /modified/CLS?generated=1` with `[{"dbname":"HSCUSTOM","dbhash":""}]` listed 13,460 documents (815 with `gen:true`) against 12,645 (none generated) with `generated=0`. The forwarding is therefore implemented as specified (`generated=0` / `=1` / absent for `both`, pinned in `export.test.ts`) and recorded in `CHANGELOG.md` with the known limitation; the underlying `modifiedSince` defect (`iris_doc_list`, `iris_doc_export`, `iris_package_list` all build the 405 route) is the third `deferred:` item in the frontmatter.

**DW-496 probe (AC-4).** The `restore by NAME across a chain` test ran 10 of 10 green in isolation (`-t`, fresh vitest process each loop) before any change, and the whole `engine-e2e.test.ts` (24 tests) ran 10 of 10 green after the containment (stepping clock threaded through the five chain tests that read backups back, plus the `checkDistFresh` assertion in `beforeAll`). No failure reproduced, so the containment path was taken; its mutation is recorded above. Review-pass probe: with a constant clock in place of the stepping clock the suite also stays 24 of 24 green, so the clock is belt-and-braces and the `checkDistFresh` assertion is the pinned mechanism. Editing any file under `packages/client-config/src/` (the compiled tests included) makes that `beforeAll` fail until the package is rebuilt, by design of the containment.

**BOOTSTRAP_VERSION (AC-14).** `2159ec9e6f69` -> `3af8ca401e7c` (`pnpm gen:bootstrap`, three handlers changed: `Interop.cls`, `Security.cls`, `Analytics.cls`). A second `pnpm gen:bootstrap` printed the same version and left `packages/shared/src/bootstrap-classes.ts` byte-identical (same `shasum`); `bootstrap.test.ts` 46 of 46 green.

**OS test totals (AC-14).** `iris_execute_tests` `ExecuteMCPv2.Tests`, `level:"package"`, `default`/`HSCUSTOM`: `total` 443, 443 passed, 0 failed, 0 skipped (re-run after the review patches, jobId 41690034); the mechanical count `grep -rE '^Method Test[A-Za-z0-9]+\(' src/ExecuteMCPv2/Tests/*.cls | wc -l` is 443 (was 435; +1 `TestDeleteBlockedByState`, +3 `InteropProductionDeleteTest`, +1 `TestGetOmittedProductionEchoesProduction`, +2 `SqlPrivilegeBoundTest`; `MessageResendTest` 13 -> 12 (two live methods moved out, one hermetic `TestResendBatchReportsEveryNonexistentHeader` added in review) and `MessageResendLiveTest` +2). One class per call: `InteropHostGuardTest` 6/6, `InteropProductionDeleteTest` 3/3, `InteropItemCompositeKeyTest` 9/9, `SqlPrivilegeBoundTest` 7/7, `MessageResendTest` 12/12, `MessageResendLiveTest` 2/2 (both log SKIP). Closing check: `iris_doc_list` filter `ExecuteMCPv2.Temp.` (generated included) returned `{"items":[]}` and `SELECT Name FROM Ens_Config.Production WHERE Name %STARTSWITH 'ExecuteMCPv2.Temp.'` returned 0 rows (the `Story380Bom` and probe classes were already gone: `InteropProductionDeleteTest` removes every `ExecuteMCPv2.Temp.Story380*` class and row around each test).

**Other gates (AC-14).** Per package (build, then lint, type-check, test): shared 1361 tests / 69 files, dev 817 / 45 (green both under the package's default `test` script and with `--no-file-parallelism`), admin 490 / 34, interop 341 / 22, ops 348 / 20, data 161 / 8, client-config 514 / 21, all 180 / 22 (the epic35 and epic37 live gates ran, 11 of 11, none skipped); lint 0 errors (one pre-existing warning in `packages/shared/src/cli/governance.ts`), type-check clean. `pnpm gen:governance-baseline:check` exit 0 (141 frozen keys, all still live; the frozen hash `1e62c5ad5bf7` is unchanged in `governance-baseline.ts`, which is untouched). `prepublish-gate.mjs` for dev (5 files, 52 tests, sequential) and data (2 tests) exit 0 with `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=<default profile> IRIS_NAMESPACE=HSCUSTOM` exported. `verify-iris-reachable.mjs` driven in three modes: all six variables set (exit 0, no `[WARN]`), none set and `CI` unset (one `[WARN]` naming all six, then exit 0), none set and `CI=true` (exit 1 naming all six, before the dist check). Launcher: `settings.test.ts` and `envContract.test.ts` 33 of 33 green (oracle available); the full launcher suite is NOT green on this host and not because of this story: 4 tests in `clientsEngine`/`governanceEngine` (Windows-style `C:\git\...` paths), `constants.test.ts` and `credentials.test.ts` (cannot load `@intersystems-community/intersystems-servermanager`, absent from the extension's `node_modules`) and `clientsActivationFlow` 33-3-3 (times out at "the re-toggled roster to persist") fail identically with the launcher's `settings.ts` and both test files temporarily restored to `HEAD` (reproduced in the review pass with `package.json`, `settings.ts` and the three launcher test files at `HEAD`: the same 5 tests and 2 unloadable files; the files were restored byte-identical) - recorded as the fifth `deferred:` item.

**Residual risks.** (1) The delete refusal for a Running/Suspended/Troubled/NetworkStopped current production is pinned by the predicate and message tests and mutations only, not by a live refusal or at the handler wiring (fourth `deferred:` item). (2) The `modifiedSince` enumeration of `iris_doc_list`/`iris_doc_export`/`iris_package_list` is broken on this instance independent of `generated`, and their descriptions still present it as working (third `deferred:` item). (3) DW-508 remains open: a server process built from an older embed can redeploy older `Interop`/`Security`/`Analytics` over the deployed ones, so re-confirm with `iris_doc_get` before relying on the live results. (4) `checkDistFresh` is mtime-based and `tsc` skips emit when content is unchanged, so a `touch`ed `src/` file, or a regenerated identical file such as the `gen:bootstrap` idempotence run, keeps a package stale until its `dist/` and `tsconfig.tsbuildinfo` are removed and it is rebuilt; the STALE reason now says so, and the prepublish gates were run after such a clean rebuild of `@iris-mcp/shared`. (5) The launcher's full suite is red on this macOS host at baseline (fifth `deferred:` item). (6) The `StateName` reuse at the production-summary site (`Interop.cls`, the cross-namespace loop) was not exercised live, because the summary tool reads every namespace and has no namespace knob (this story's runtime rule is `HSCUSTOM` only); it is the same expression as the status site, which was read live (`state: "Stopped"`), and the class compiles and its helper is unit-pinned. (7) `StateName` reports state 6 (ShardWorkerProhibited) and the mirror-backup states as `Unknown`, as the existing status map always has.
