---
title: 'Story 38.0: Epic 37 Deferred Cleanup'
type: 'chore'
created: '2026-10-15'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
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
- `(loop)` the iris-dev MCP tool `iris_execute_tests` with `level:"class"`, one call each: `ExecuteMCPv2.Tests.InteropHostGuardTest` (6), `InteropProductionDeleteTest` (3), `InteropItemCompositeKeyTest` (9), `SqlPrivilegeBoundTest` (7), `MessageResendTest` (11), `MessageResendLiveTest` (2) -- expected: `total` equals the count in brackets, 0 failed.
- `(once)` `pnpm --filter @iris-mcp/<pkg> build`, then `test`, `lint` and `type-check` where defined, one command per package: shared, dev, admin, interop, ops, data, client-config, then `pnpm --filter @iris-mcp/all test` -- expected: green. This is the accepted per-package substitute for the flaky parallel turbo run (35-1-DEV-1).
- `(once)` `npm --prefix /Users/jbrandt/git/iris-execute-mcp-v2/extensions/iris-mcp-launcher test` -- expected: green.
- `(once)` `pnpm gen:governance-baseline:check` -- expected: exit 0 at `1e62c5ad5bf7`/141.
- `(once)` `pnpm gen:bootstrap`, then `git -C /Users/jbrandt/git/iris-execute-mcp-v2 diff --stat`, then `pnpm gen:bootstrap` again -- expected: the second run changes nothing; record `BOOTSTRAP_VERSION` from/to.
- `(once)` `pnpm --filter @iris-mcp/dev exec node scripts/prepublish-gate.mjs` and `pnpm --filter @iris-mcp/data exec node scripts/prepublish-gate.mjs`, with `IRIS_HOST=localhost`, `IRIS_PORT=52773`, `IRIS_NAMESPACE=HSCUSTOM` and the `default` profile's credentials exported explicitly -- expected: exit 0. The dev run's gate files run sequentially.
- `(once)` `iris_execute_tests` with `target:"ExecuteMCPv2.Tests"`, `level:"package"` (poll `iris_test_status` until complete) -- expected: `total` equals `grep -rE '^Method Test[A-Za-z0-9]+\(' /Users/jbrandt/git/iris-execute-mcp-v2/src/ExecuteMCPv2/Tests/*.cls | wc -l`, which is 435 today and 442 when the tests above land; 0 failed (Rule #35, Rule #51).

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

**Shared surfaces:** these are what this story changes and other tests assert on:
- the `IRIS_NAMESPACE` default (`config.test.ts`, launcher `settings.test.ts`, `envContract.test.ts`);
- the `@iris-mcp/shared` index export list;
- `bootstrap-classes.ts` and `BOOTSTRAP_VERSION` (`bootstrap.test.ts` drift);
- the listPrivileges wire querystring (11 exact-path pins in 4 admin test files);
- the `iris_production_item` `get` response and the production `delete` response (interop mocks);
- the `MessageResendTest` method roster (grep for the two moved method names);
- the OS `Test*` total (435 → 442);
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

Status: ready-for-dev
Blocking condition: none
