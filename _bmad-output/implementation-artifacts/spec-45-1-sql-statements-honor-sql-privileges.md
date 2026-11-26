---
title: 'Story 45.1: SQL Statements Honor SQL Privileges'
type: 'bugfix'
created: '2026-11-25'
status: 'done'
baseline_revision: 'bbe42006f5bb09e46732b4c295f3260ad8d68fe9'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-45-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: >-
      The live gate's `userExists` treats any IrisApiError as "user absent", so a teardown assertion could pass vacuously on a 401/500.
    evidence: |-
      sql-privileges-live-gate.test.ts userExists catches every IrisApiError and returns false; the status the Security route gives for a missing user was not probed. Throwaway-only.
    location: >-
      packages/iris-dev-mcp/src/__tests__/sql-privileges-live-gate.test.ts:165
    severity: low
  - summary: >-
      The default-suite privilege pin reads source text only; a bypass that keeps the literal 1 (for example a changed $Roles before Perform) is caught only by the armed live gate in CI.
    evidence: |-
      sql-privilege-mode.test.ts never executes the handler; the spec records that no ObjectScript test host exists for Sql.cls by Story 38.5 design.
    location: >-
      packages/iris-dev-mcp/src/__tests__/sql-privilege-mode.test.ts
    severity: low
---

<intent-contract>

## Intent

**Problem:** `ExecuteMCPv2.REST.Sql.Perform` prepares every statement with `%Prepare(.pQuery, 0)` (`src/ExecuteMCPv2/REST/Sql.cls:191`), which skips SQL privilege checking. An account with `%Development` and no SQL grants reads, writes and creates tables through `iris_sql_query` and `iris_sql_execute` (issue #1 point 4; reproduced live 2026-11-25, see Design Notes).

**Approach:** Prepare with privilege checking on (`checkPriv` 1, literal, no off-switch), so a statement the account has no grant for fails at prepare, before classification, with IRIS's SQLCODE and message through `SanitizeError`. Regenerate the bootstrap embed, prove refusal, grant, revoke and the destructive refusal live on a throwaway through the tool, and pin the mode in the default suite.

## Boundaries & Constraints

**Always:**
- `%Prepare(.pQuery, 1)` with a literal `1`. No parameter, request field, config key or environment variable reads or turns off privilege checking (AD-25).
- A prepare failure keeps today's error path: `tSC` from `%Prepare` returns to `Execute`, one render through `SanitizeError` (AD-11, Rules #7/#9). No new refusal code, no TS-side privilege pre-check (AD-31).
- For an account with `%All`, or with the grants a statement needs, every request and response is byte-identical (AD-15); only the refusal for an account without a grant is sanctioned (`S-45.1-sql-privileges`).
- Privilege principals (user, role, GRANT/REVOKE) are created ONLY on a throwaway (`IRIS_THROWAWAY` set by `scripts/throwaway-iris.mjs`), removed in setup and teardown; a live leg that would create one skips with its reason otherwise.
- Regenerate the embed in this story and record `BOOTSTRAP_VERSION` from `1.2.0+5.6cbac260e73f` to the new value (Rule #24). No class is added; rosters unchanged.

**Never:**
- No change to `packages/iris-dev-mcp/src/tools/sql.ts` behavior, tool descriptions, schemas, presets, governance keys or the tools-list snapshot.
- Do not touch Atelier `action/query` callers (bootstrap `Setup_*`, `sqlAnalyze`, `execute`, `unit-test-results`, `test-status`): they are not this route.
- Do not hand-load `Sql.cls` (or any bootstrapped class) into the shared instance (`localhost:52773`); no user, role, grant, compile or load there. IRIS-side proofs run on the throwaway.
- Never run `gen:ipm` (only `gen:ipm:check`), the bare governance-baseline generator, `changeset version` or `pnpm run version`; never edit `ipm/**`, `module.xml`, `preload/**` or frozen goldens.
- No blocking of SqlProc-in-SELECT, no `redact` filtering, no Atelier privilege change (epic out of scope).

## I/O & Edge-Case Matrix

Least-privilege account = role with `%Development:U` and the namespace database resource (`%DB_HSCUSTOM`), no `%All`, no SQL grant. All via the tool over the live route.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Ungranted SELECT | `iris_sql_query` and `iris_sql_execute` `SELECT ... FROM <fixture>` | tool error carrying `SQLCODE: -99` and `User <name> is not privileged for the operation`; no rows | isError result via existing `SQL error:` path |
| After GRANT SELECT | same calls | rows equal to the `_SYSTEM` `action/query` rows | none |
| After REVOKE | same calls | refused again (no privilege cache) | as ungranted |
| Destructive refusal | `iris_sql_execute` `INSERT` (no readOnly) | privilege error; fixture `COUNT(*)` (read as `_SYSTEM`) unchanged | as ungranted |
| Ordering: read-only | `iris_sql_execute` `INSERT` with `readOnly:true`; `iris_sql_query` with an UPDATE | privilege error, NOT `SQL_READ_ONLY`; count unchanged | as ungranted |
| Ordering: cap decline | `iris_sql_execute` `CALL` of the fixture's `Bump` SqlProc with `maxRowsAffected:0` | privilege error, NOT `SQL_ROWS_AFFECTED_CAP`/`capNotCountable`; nothing runs | as ungranted |
| SqlProc without EXECUTE | `iris_sql_query` `SELECT <fixture SqlProc>()` that increments a global | privilege error; the global unchanged | as ungranted |
| Atelier residual (pinned, unchanged) | same least-priv account, Atelier `action/query` `SELECT` of the ungranted table | rows returned (IRIS's API, documented by 45.5) | none |
| `%All` account | `_SYSTEM` runs the existing 38.5 gates | unchanged expectations pass | none |

</intent-contract>

## Code Map

- `src/ExecuteMCPv2/REST/Sql.cls` -- `Perform` :183-254; the one `%Prepare` at :191; class banner :1-40 ("Neither" bullet :20-21 says the statement runs "as the Atelier `action/query` route runs it": no longer true for privileges); `Execute` :45-75 renders one envelope via `SanitizeError`; `ReadControls` :118-160 reads exactly `query`, `namespace`, `readOnly`, `countOnly`, `maxRowsAffected`, `parameters`; `Decline` :259-266 runs after prepare, so a prepare failure precedes every decline.
- `irislib/%SQL/Statement.cls:513-519` -- `%Prepare(text, checkPriv=1, noAudit=0)`; `checkPriv` covers prepare-time checks only.
- `irislib/%Api/Atelier/v1.cls:691`, `v6.cls:236` -- `action/query` prepares with `checkPriv` 0 (read-only reference; out of scope).
- `packages/iris-dev-mcp/src/tools/sql.ts` -- the only production caller (`SQL_EXECUTE_PATH` :38, `runSql` :101, error path :258-260 `failure("SQL error: ...")`). Unchanged.
- Rule #56 re-enumeration (2026-11-25, `git grep "sql/execute"` over packages, extensions, scripts, src): production caller `sql.ts` only; plus `scripts/lib/fake-iris-listener.mjs:255` (test fake), `packages/iris-dev-mcp/scripts/prepublish-gate.mjs:98` (roster comment), tests, and `Dispatch.cls:192` (route). Every other server-built query uses `atelierPath(..., "action/query")`: `packages/shared/src/bootstrap.ts:188,371,520,720,752,776` (all `Setup_*` SqlProc calls), `packages/iris-dev-mcp/src/tools/{execute.ts:506,sqlAnalyze.ts:309,555,unit-test-results.ts:27,test-status.ts}`.
- `packages/shared/src/bootstrap-classes.ts:34` -- `BOOTSTRAP_VERSION = "1.2.0+5.6cbac260e73f"`; GENERATED by `pnpm run gen:bootstrap` (also writes `scripts/bootstrap-sequence.json`). `ipm/src/cls/ExecuteMCPv2/REST/Sql.cls` is the frozen release tree: do not touch.
- `packages/iris-dev-mcp/src/__tests__/sql-safety-live-gate.test.ts` -- sibling to extend in shape: arming via `liveGateTarget()` (`@iris-mcp/shared/test-helpers/live-target`), `loadConfig(liveConnectionEnv(...))` + `IrisHttpClient` + `buildToolContext` :331-356, fixtures via `live-doc-helpers.ts` (`putDocLines`, `compileDocs`, `removeStored`, `runQuery`).
- `scripts/throwaway-iris.mjs` -- `throwawayEnvProblems` / `assertThrowawayEnv` (exported pure helpers; precedent import from a test: `packages/iris-mcp-all/src/__tests__/bootstrap-guard-legs.ts`). `exec` sets `IRIS_THROWAWAY`, `IRIS_REQUIRE_LIVE=1`, `_SYSTEM`/`SYS`.
- `src/ExecuteMCPv2/REST/Security.cls` -- `POST /api/executemcp/v2/security/role` `{action:"create"|"delete", name, resources}` and `/security/user` `{action, name, password, roles}` (Dispatch :49, :56): how the gate creates/removes principals as `_SYSTEM`.
- `src/ExecuteMCPv2/REST/Config.cls:36,209` -- `GET /config/namespace` (`globals`) and `GET /config/database` (`resource`): derive the namespace database resource live instead of hard-coding `%DB_HSCUSTOM`.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs:79-121` -- `gateTestFiles`; `packages/iris-mcp-all/src/__tests__/live-gate-roster.test.ts` requires every armed file to be listed; `scripts/lib/ci-checks.mjs` derives the CI `prepublish-dev` suite (seeded throwaway, `HSCUSTOM`, `allowedSkips: []`) from that list.
- `src/ExecuteMCPv2/Tests/BaseTest.cls` -- the only ObjectScript test that covers `Sql.cls` (handler roster; 7 `Test*`). No `Sql` %UnitTest class exists by Story 38.5 design.
- `packages/iris-dev-mcp/README.md:181-200` -- SQL Tools section; `story-38-5-qa-doc-claims.test.ts` pins its table rows and examples (add a new blockquote; do not alter rows/examples).
- `CHANGELOG.md` top -- convention `## [Unreleased] - Story 45.1: ...`; `.changeset/story-44-1-*.md` (git history, commit `3d7e87850762b28627851bc66b93127b22d26195`) -- changeset shape.

## Tasks & Acceptance

**Execution:**
- `src/ExecuteMCPv2/REST/Sql.cls` -- change :191 to `Set tSC = tStmt.%Prepare(.pQuery, 1)`; update the banner (add a "SQL privileges" bullet: privileges are checked at prepare, nothing turns it off, a failure is the SQLCODE error envelope before any decline; reword the "Neither" bullet to "with no transaction from this handler") and the `Perform` doc comment. Contract-only comments (Rule 14). -- AC 45.1.2.
- `packages/shared/src/bootstrap-classes.ts`, `scripts/bootstrap-sequence.json` -- run `pnpm run gen:bootstrap`; record `BOOTSTRAP_VERSION` from → to in `## Verification`; re-run to confirm no diff. -- AC 45.1.5, Rule #24.
- `packages/iris-dev-mcp/src/__tests__/sql-privilege-mode.test.ts` (new, default suite, no IRIS) -- read `src/ExecuteMCPv2/REST/Sql.cls` and `BOOTSTRAP_CLASSES.get("ExecuteMCPv2.REST.Sql.cls")`; assert each holds exactly one `%Prepare(` call and it is `%Prepare(.pQuery, 1)`; assert `ReadControls` reads exactly the six control names above (no privilege/checkPriv control). -- AC 45.1.2, the default-suite pin of "no off-switch".
- `packages/iris-dev-mcp/src/__tests__/sql-privileges-live-gate.test.ts` (new armed gate) -- extend the `sql-safety-live-gate` shape: armed by `IRIS_REQUIRE_LIVE` (unreachable fails). Principal legs additionally require a harness-shaped `IRIS_THROWAWAY` (reuse `throwawayEnvProblems`); otherwise they skip with that reason before any principal or fixture is written. Setup as `_SYSTEM`: remove leftovers; PUT + compile `ExecuteMCPv2.Temp.QaStory451Priv.cls` (persistent `Name`/`Qty`, plus `ClassMethod Bump() As %Integer [ SqlProc ]` that `$Increment`s `^ExecuteMCPv2.QaStory451PrivC`, used by both the SqlProc row and the CALL row), seed 3 rows; create role `QaStory451Role` (`%Development:U,<namespace globals DB resource>:RW`, derived live) and user `QaStory451Lp` (random per-run password, role only). Build a second `ToolContext` with the least-privilege credentials. Drive every I/O Matrix row through `sqlQueryTool`/`sqlExecuteTool` handlers; GRANT/REVOKE as `_SYSTEM` through `action/query`. Teardown deletes user, role, class, data and counter global and asserts nothing named `QaStory451` remains. -- AC 45.1.3, 45.1.4.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` -- add the new gate to `gateTestFiles` with a one-line comment (what it writes; throwaway-only principals). -- Rule #59 (the CI `prepublish-dev` suite arms it).
- `packages/iris-dev-mcp/README.md` -- in "SQL Tools", add a blockquote "SQL privileges (Story 45.1)": both tools prepare with SQL privilege checking on, so the account needs SELECT (INSERT/UPDATE/DELETE for writes) on each table and EXECUTE on each SqlProc function or procedure it calls; a missing grant is an `SQL error` with SQLCODE -99 before any read-only or cap check; minimum account for the SQL tools: `%Development:U` plus the namespace database resource (`R` for reads); residual: IRIS's own Atelier `action/query` (used by other tools and reachable by the same account) prepares with checking off; the full trust model lands in Story 45.5. Default state: always on, no setting. -- AC 45.1.7.
- `CHANGELOG.md` -- `## [Unreleased] - Story 45.1: SQL Statements Honor SQL Privileges`, naming `S-45.1-sql-privileges`, the ordering change (every decline), the Atelier residual, and `BOOTSTRAP_VERSION` from → to. -- AC 45.1.7.
- `.changeset/story-45-1-sql-statements-honor-sql-privileges.md` -- `"@iris-mcp/dev": patch`, `"@iris-mcp/shared": patch` (the Planner raises to minor at release), same content in brief. -- AC 45.1.7.

**Acceptance Criteria:**
- Given the rebuilt embed deployed on a seeded throwaway, when the least-privilege account calls `iris_sql_query` and `iris_sql_execute` per the I/O Matrix, then each row's outcome holds and fixture counts and the SqlProc counter are unchanged on every refusal (AC 45.1.3, 45.1.4).
- Given `_SYSTEM` (`%All`) on the same throwaway, when `sql-safety-live-gate.test.ts` and `packages/iris-mcp-all/src/__tests__/story-38-5-qa-sql-wire-gate.test.ts` run, then they pass with `git diff` of both files empty (AC 45.1.6).
- Given the default suite, when `Sql.cls` or the embed prepares with anything but a literal `1`, or a privilege control is read, then `sql-privilege-mode.test.ts` fails (AC 45.1.2).
- Given `%Prepare(.pQuery, 1)` reverted to `0` and deployed on the throwaway, when the live gate runs through the tool over `/dev/sql/execute`, then its ungranted-refusal tests go red (AC 45.1.4 proven red; path named).
- Given the throwaway after seeding, when `ExecuteMCPv2.Tests.BaseTest` runs, then `total` is 7 and all pass (AC 45.1.5 as amended).
- Given the changed tree, when `pnpm gen:ipm:check`, `pnpm gen:governance-baseline:check` and `pnpm gen:tools-list-snapshot:check` run, then all pass unchanged.

### Review Findings

Code review 2026-11-25 (`bmad-code-review`, full mode, frozen diff `bbe42006..d6cac7c4` minus bookkeeping). Layers delivered: Blind Hunter (9), Edge Case Hunter (9, JSON), Verification Gap (3 gap blocks + other findings), Acceptance Auditor (5). Review outcome: CLEAN (no failed layer). 0 decision-needed, 7 patch, 2 defer, 12 rejected.

- [x] [Review][Patch] (medium) The README and changeset said a missing grant answers -99 before every read-only or cap check with no qualifier; IRIS checks GRANT and some DDL (CREATE INDEX) only at execution (AC 45.1.1 "states the difference exactly", AC 45.1.7) [packages/iris-dev-mcp/README.md:197, .changeset/story-45-1-sql-statements-honor-sql-privileges.md:9]
- [x] [Review][Patch] (medium) The README, CHANGELOG and changeset listed only table grants and EXECUTE; a statement also needs the SQL administrative privilege it uses (`%CREATE_TABLE`, `%NOTRIGGER` for TRUNCATE TABLE, `%NOJOURN`, per the probe record and the gate's `%NOJOURN` leg), so "byte-identical with the grants it needs" read as false for a table-granted account's `%NOJOURN` statement [README.md:197, CHANGELOG.md:35, changeset:10]
- [x] [Review][Patch] (low) The CHANGELOG and changeset said the account "could read, write and create tables through both tools"; `iris_sql_query` was always read-only [CHANGELOG.md:35, changeset:8]
- [x] [Review][Patch] (low) The live gate's comment claimed IRIS's default database resource is `%DB_<name>`; it is `%DB_%DEFAULT` (`irislib/%sySecurity.inc:95`), and the config route reports no resource at all, so the gate's value is a naming-convention guess that fails closed [packages/iris-dev-mcp/src/__tests__/sql-privileges-live-gate.test.ts:490]
- [x] [Review][Patch] (low) The README named only Atelier `action/query` as the residual; the same `%Development` account reads globals and runs ObjectScript through other tools (AD-31 trust model) [README.md:197]
- [x] [Review][Patch] (low) The root README back-compat bullet still promised unchanged SQL results with default settings; it now names the `S-45.1-sql-privileges` exception [README.md:741]
- [x] [Review][Patch] (low, Rule 19) The last AC (generator checks unchanged) had no `mutation:` line; recorded as closed by decision under `## Verification`
- [x] [Review][Defer] (medium) `/config/database` reports `resource: ""` for every database (Config.Databases has no Resource property; live read of the shared instance: 15 of 15 empty) [src/ExecuteMCPv2/REST/Config.cls:209] — deferred: out-of-footprint, pre-existing; ledger DW-765, routed owner=burndown
- [x] [Review][Defer] (medium, unverified) The minimum account (`%Development:U` plus the namespace's database resource) is proven only where globals, routines and the ExecuteMCPv2 classes share one database [README.md:197] — deferred: a split or mapped database layout probed on a throwaway would settle it; ledger DW-766, routed owner=45-5-what-the-safety-settings-protect

Rejected:
- Edge: the harness import or `throwawayEnvProblems` throwing leaves `skipReason` unset, so `afterAll` cleans up on a non-throwaway target (low): unlikely, the fix adds a guard, and the cleanup only deletes names the gate alone creates, each behind an existence check.
- Edge: a throwing `REVOKE EXECUTE` in `finally` skips the table REVOKE (low): throwaway only; the user holding the grant is deleted at teardown.
- Edge: a refused CREATE TABLE that regresses to success leaks hashed extent globals (low): reachable only when that test is already red.
- Edge: the `ReadControls` pin misses `%Get("x", default)` and `pBody.x` reads (low): any off-switch has to change the `%Prepare(.pQuery, 1)` literal, which is pinned exactly.
- Edge + Blind: the doc-claims "no setting" oracle is a denylist (low): same literal pin; the tools-list snapshot pins the schemas exactly.
- Edge: the gate header says nothing named QaStory451 is left, but grants are not checked (low): the grantee is deleted on a throwaway.
- Blind: the "no role widening" pin scans only `Sql.cls`, not Dispatch, Utils or the web app's MatchRoles (low): the armed live gate (CI, `allowedSkips: []`) goes red on any elevation; DW-764 by-design.
- Blind: no JOIN, subquery, `INSERT ... SELECT` or view legs (low): IRIS's own prepare-time check; new live legs are not a two-way door. wontfix-accepted, reopen_if a reported indirect-access bypass through `/dev/sql/execute`.
- Blind + Auditor: the env-var controls (`IRIS_SQL_READ_ONLY`, `IRIS_SQL_MAX_ROWS_AFFECTED`, `IRIS_SQL_MAX_ROWS`) are not driven as the least-privilege account (low): `sql.ts:128,130` sends them as the same `readOnly`/`maxRowsAffected` body fields the parameter legs cover, and `IRIS_SQL_MAX_ROWS` is a TypeScript post-fetch clamp; IRIS sees no different path.
- Blind: the spec's `deferred:` list and Auto Run Result are stale against QA's work (rule: a fix that edits the spec under review is rejected). DW-763 was fixed by QA and awaits the lead's adjudication.
- Gap: `story-45-1-doc-claims.test.ts` reads the built dist, so a stale local dist fails open (low): CI builds first, and `gen:tools-list-snapshot:check` pins the schemas.
- Gap: no live leg for a table-granted account's `%NOJOURN` statement (low): the docs now state the `%NOJOURN` privilege and the ungranted leg pins IRIS's text; a new live leg needs a throwaway cycle. wontfix-accepted, reopen_if an account with DELETE and `%NOJOURN` granted is refused by `/dev/sql/execute`.

## Spec Change Log

- 2026-11-25 (lead, spec gate, decision #157): the plan's three `epics.md` amendments were applied, each tagged. AC 45.1.1: the role holds the `%Development` resource. AC 45.1.3: the ordering change covers every refusal check. AC 45.1.5: `BaseTest` on the throwaway, plus the TypeScript live gate. The spine's AD-15 `S-45.1-sql-privileges` text and AD-25 "SQL privileges" bullet were amended to match.

## Review Triage Log

### 2026-11-25 — Review pass
- verdicts: 18 rows (a row groups findings from several layers that make the same claim) — high 0, medium 0, low 18, false 0, maybe-false 0; routes: patch 3, defer 2, reject 13
- findings:
  - `[low]` `[reject]` Blind-1 / Edge-2 / Gap-other: live gate skips green under `IRIS_REQUIRE_LIVE` against a non-throwaway IRIS — the spec orders exactly this ("principal legs skip with that reason" off a throwaway); CI `prepublish-dev` has `allowedSkips: []` and runs on the seeded throwaway, so a skip is red there. Spec-bound.
  - `[low]` `[reject]` Blind-2 / Gap-2: ordering outcomes for `countOnly` and `%NOJOURN` not pinned live — `Decline` needs the prepared statement type, so the order is structural; closing it needs new live legs (not a two-way door). `reopen_if`: a change moves `Decline` ahead of the prepare.
  - `[low]` `[reject]` Blind-3: `R`-only read path untested — the spec's probe record shows `R` suffices for SELECT through both read paths.
  - `[low]` `[reject]` Blind-4: `tool_support.md` and the root README back-compat bullet not updated — spec scopes docs to the dev README, CHANGELOG and changeset (Rule #43 minimum met); the closing rollup (Story 45.5) enriches. The root bullet speaks of fields returned, which is unchanged for a granted account.
  - `[low]` `[reject]` Blind-5: tool descriptions do not mention the privilege requirement — the spec's Never list forbids tool-description changes.
  - `[low]` `[patch]` Blind-6 / Edge-4 / Edge-5: `sql-privilege-mode.test.ts` passed vacuously for a renamed method and ignored `%ExecDirect`/`%PrepareClassQuery` — patched: non-empty body assertion, entry-point pattern; re-run green.
  - `[low]` `[reject]` Blind-7a: README/CHANGELOG cite Story 45.5, not yet shipped — it is a planned story of this epic (`epics.md`).
  - `[low]` `[patch]` Blind-7b: over-long reflowed line in the `Perform` doc comment — rewrapped; embed regenerated.
  - `[low]` `[defer]` Edge-1: `userExists` in the live gate treats any `IrisApiError` as "absent" — throwaway-only teardown assertion; the status the route gives for a missing user was not probed here (needs a live check before narrowing to 404).
  - `[low]` `[reject]` Edge-3: English/casing assertion in `expectPrivilegeError` — instance locale is `enuw` (Rule #13); the text is IRIS's SQL message and the throwaway is English.
  - `[low]` `[patch]` Edge-6 / Edge-7: "answers ahead of every decline" is overbroad for GRANT and some DDL (IRIS checks them at execution, per the probe record) — qualified in the `Sql.cls` banner and `Perform` comment (embed regenerated) and in the CHANGELOG; nothing runs either way.
  - `[low]` `[defer]` Gap-1: the default-suite pin reads source text only; a literal-1 bypass elsewhere is caught only by the armed live gate in CI — the spec's chosen design (no ObjectScript test host for `Sql.cls`).
  - `[low]` `[reject]` Gap-3: AC 45.1.2 second clause, 45.1.3 and 45.1.6 lacked `mutation:` lines — recorded under `## Verification` (the second-clause mutation was applied and observed red; 45.1.6 is closed by decision).
  - `[low]` `[reject]` Gap-4 / Gap-5: `REQUIRE_LIVE` accepts `"true"` while `throwawayEnvProblems` accepts only `"1"` — the harness always exports `1`; the mismatch only yields a skip reason, never a false pass.
  - `[low]` `[reject]` Gap-6: the Atelier residual leg goes red if IRIS closes the gap — that is its stated purpose.
  - `[low]` `[reject]` Gap-7: the embed-equality test needs a prior `pnpm build` — fails closed; same as `test-production-guard.test.ts`.
  - `[low]` `[reject]` Gap-8: README/CHANGELOG privilege claims pinned by no test — spec leaves `story-38-5-qa-doc-claims.test.ts` untouched by design.
  - `[low]` `[reject]` Intent-alignment: descriptive audit; reading 1 (statement-level) implemented, the Atelier residual (reading 3) is documented and deferred to Story 45.5 by the epic. No actionable finding.

## Design Notes

**Governing ADs:** AD-25 (SQL privileges rule, supersedes 38.5 parity), AD-31 (IRIS authorizes; errors via `SanitizeError`; trust model), AD-15 (`S-45.1-sql-privileges`), AD-14 (embed regen, IPM frozen), AD-11 (one envelope), AD-33 (route request shape unchanged).

**Probe record, AC 45.1.1** (throwaway `intersystems/irishealth-community:2026.2@sha256:462de1fb...af0a`, IRIS 2026.2, `HSCUSTOM` seeded with `1.2.0+5.6cbac260e73f`, 2026-11-25; container removed, `docker ps -a --filter label=iris-mcp.owner=throwaway` empty). Account `qa451lp`: one role, `%Development:U,%DB_HSCUSTOM:RW`; table `Qa451.Secret` (3 rows), function `Qa451.Fn()` (DDL, `LANGUAGE OBJECTSCRIPT`).

| Statement (ungranted) | `checkPriv` 1 (prepare) | `checkPriv` 0 (prepare, then execute) |
|---|---|---|
| SELECT, SELECT COUNT(*) | `ERROR #5540: SQLCODE: -99 Message: User qa451lp is not privileged for the operation` | OK; rows returned |
| INSERT / UPDATE / DELETE | same -99 | OK; ran (rowcount 1 / 3 / 1) |
| TRUNCATE TABLE | -99 `does not have %NOTRIGGER privileges` | OK; ran (rowcount -1) |
| SELECT `Qa451.Fn()`, CALL `Qa451.Fn()`, SELECT `ExecuteMCPv2.Setup_GetBootstrapVersion()` | -99 not privileged (EXECUTE needed) | OK; ran (42 / 0 / version) |
| CREATE TABLE | -99 `does not have %CREATE_TABLE privileges` | OK; table created |
| CREATE INDEX | -99 `%ALTER_TABLE` | prepared; execute -99 `required %ALTER privilege` |
| GRANT SELECT ... TO other | prepares | execute -112 `does not have required privileges to grant` (both) |

- After `GRANT SELECT ON Qa451.Secret`: SELECT prepares and returns rows; INSERT/UPDATE still -99. After `GRANT EXECUTE ON Qa451.Fn` (syntax `GRANT EXECUTE ON <schema>.<fn>`; `ON FUNCTION`/`ON PROCEDURE` are syntax errors): SELECT and CALL of it prepare and run. After `REVOKE`: refused at once (no cached privilege).
- **Execution-time checks with `checkPriv` 0:** only GRANT (-112) and the ALTER-type DDL tried (CREATE INDEX, -99) are checked at execution. SELECT, INSERT, UPDATE, DELETE, TRUNCATE, CALL, SqlProc functions and CREATE TABLE are not checked at all.
- **SqlProc:** with checking on, a SELECT calling a `SqlProc` needs EXECUTE. Through the suite's SQL tools this narrows issue #1 point 2 for a least-privilege account (45.5 says so); an `%All` account is unaffected.
- **Atelier `action/query`** as `qa451lp`: returns the ungranted rows and runs `Qa451.Fn()` without EXECUTE (unchanged after the route fix; C-1 residual for 45.5).
- **Route through the patched class** (`%Prepare(.pQuery)` loaded on the throwaway only): least-priv SELECT/INSERT/`readOnly` INSERT/SqlProc/CREATE TABLE answer `{"status":{"errors":[{"error":"ERROR #5001: SQLCODE: -99 Message: User qa451lp is not privileged for the operation",...}]},"result":{}}` (HTTP 200, the existing error envelope); a `readOnly` INSERT gives this instead of `outcome:"readOnly"`. `qa451all` (`%All`): six route bodies (SELECT, readOnly UPDATE, capped UPDATE overCap, countOnly, missing table -30, SqlProc SELECT) byte-identical before and after (`diff` empty). Row count stayed 3 after the refused INSERTs.
- **The account:** `%Development:U` (both `/api/executemcp/v2` and `/api/atelier` require it) plus the namespace database resource; `R` suffices for SELECT through both read paths (probed), `RW` for writes; then SQL grants per table/function.

**Amendments for the lead (epics.md, apply-and-report tier):**
1. AC 45.1.1 "`%Development` plus the database resources": `%Development` is a resource, not a role (the role is `%Developer`, which also grants `%DB_USER`, `%Service_*` and more). `Security.Users.Create` silently accepted the non-existent role name `%Development`, and that account could not log in (HTTP 401). Reword to "a role holding the `%Development` resource (`U`) and the namespace's database resource".
2. AC 45.1.5 "the `Sql.cls` ObjectScript tests": none exist (Story 38.5 chose the armed live gate, review items VG7/BH4). The ObjectScript test that covers `Sql.cls` is `ExecuteMCPv2.Tests.BaseTest` (7), run on the throwaway; the privilege proof needs a non-`%All` principal, which the shared instance forbids, so it is the TS live gate.
3. AC 45.1.3 / AD-15 `S-45.1-sql-privileges` / AD-25: the ordering change is wider than `SQL_READ_ONLY`: prepare precedes every decline, so an ungranted statement also answers the privilege error instead of `countOnly`, `capNotCountable` or `noJournal`. Nothing runs in any case. Same sanctioned scope ("the refusal for an account without a grant"); the text should say "any decline".

**Extend, don't copy (Rule 2):** the new gate extends `sql-safety-live-gate.test.ts`'s shape and `live-doc-helpers.ts`; throwaway detection reuses `throwawayEnvProblems`. No copied helpers.

**Integration ACs:** no new service. Consumes: the existing `/dev/sql/execute` route (exercised against a real instance). Consumed-by: Story 45.5 (capstone point 4 pins the privilege mode on the request path; README/`SECURITY.md` cite this probe record for the Atelier, execution-time and SqlProc residuals).

## Verification

Shared surfaces: the bootstrap embed and `BOOTSTRAP_VERSION` (`bootstrap.test.ts`, drift tests, seeded throwaway); the dev `gateTestFiles` roster (`live-gate-roster.test.ts`, `scripts/lib/ci-checks.mjs` `prepublish-dev`); the dev README SQL section (`story-38-5-qa-doc-claims.test.ts`); `CHANGELOG.md`. Every test added or changed passes on a fresh environment, in either order.

**Commands:**
- `pnpm run gen:bootstrap` twice -- expected: second run leaves `git diff --stat` unchanged; `BOOTSTRAP_VERSION` moved from `1.2.0+5.6cbac260e73f`.
- `pnpm build` then `pnpm --filter @iris-mcp/shared test` and `pnpm --filter @iris-mcp/dev test` -- expected: green, `sql-privilege-mode.test.ts` included.
- `IRIS_HOST=127.0.0.1 IRIS_PORT=1 pnpm --filter @iris-mcp/all test` -- expected: green (closed port).
- `pnpm gen:ipm:check`, `pnpm gen:governance-baseline:check`, `pnpm gen:tools-list-snapshot:check` -- expected: OK, no writes.
- Throwaway (state file in the scratchpad): `node scripts/throwaway-iris.mjs up --image intersystems/irishealth-community:2026.2@sha256:462de1fb3597272fde0e03afad006af1b18b59c90f1c1fb5566c79b027a7af0a --namespace HSCUSTOM --host-port 52792 --state <f>`; `... exec --state <f> -- node scripts/ci-seed-throwaway.mjs` (deploys the new embed); `... exec --state <f> -- pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism src/__tests__/sql-privileges-live-gate.test.ts src/__tests__/sql-safety-live-gate.test.ts`; `... exec --state <f> -- pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-38-5-qa-sql-wire-gate.test.ts`; BaseTest through `... session --state <f> --namespace HSCUSTOM --script <file>` calling `##class(%UnitTest.Manager).DebugRunTestCase("","ExecuteMCPv2.Tests.BaseTest")` and counting `%UnitTest_Result.TestMethod` rows of that run (expect 7, all passed); then `... down --state <f>` and `docker ps -a --filter label=iris-mcp.owner=throwaway` empty. One test file or class per call, foreground, `timeout: 600000`.

**Mutations (Rule 19), record each line here:**
- AC 45.1.2: `Sql.cls` `%Prepare(.pQuery, 1)` -> `0` -> `sql-privilege-mode.test.ts` red (default suite).
- AC 45.1.4: the same mutation PUT + compiled on the throwaway only (Atelier `PUT /doc` + `action/compile` as `_SYSTEM`) -> live gate ungranted-refusal tests red via the tool over `/dev/sql/execute`; redeploy the original and re-run green.
- AC 45.1.6: none needed beyond the 38.5 gates' own mutations; their expectation files are untouched.

Recorded results (Rule 19; `mutation: <change> -> <red>`):
- mutation: `Sql.cls` `%Prepare(.pQuery, 1)` -> `0` -> `sql-privilege-mode.test.ts` 2 of 8 red (the one-literal-`1` test and the embed-equals-tree test); restored. Path: default suite, no IRIS.
- mutation: a seventh control read added to `ReadControls` (`ReadFlag(pBody, "checkPriv", ...)`) -> `sql-privilege-mode.test.ts` "ReadControls reads exactly the six documented controls" and the embed-equals-tree test red; restored, `gen:bootstrap` Unchanged. Path: default suite.
- mutation: `%Prepare(.pQuery, 0)` PUT + compiled on the throwaway only (host 127.0.0.1:52792) -> `sql-privileges-live-gate.test.ts` 12 of 15 red through the tool over `/dev/sql/execute` (3 stayed green by design: fixture check, Atelier residual, `_SYSTEM`); original redeployed, 15 of 15 green. Path: the armed gate on a seeded throwaway.
- `BOOTSTRAP_VERSION` from `1.2.0+5.6cbac260e73f` to `1.2.0+8.5cedcac20ae9` (the live-gate run above was on `1.2.0+6.e7d03d3558ce`; the later changes are `Sql.cls` doc comments only and `gen:bootstrap` run twice reports Unchanged).

### QA (2026-11-25)

Scope: the story deliverable (`git diff --name-only bbe42006..ef50d990`). Live proofs on a digest-pinned throwaway (`intersystems/irishealth-community:2026.2@sha256:462de1fb...af0a`, 127.0.0.1:52792, seeded as CI seeds it, embed `1.2.0+8.5cedcac20ae9`); the shared instance (`localhost:52773`) was not touched. Mutations were applied, observed red, and reverted (`git diff` of the mutated file empty; `shasum -c` OK for the files restored from a copy).

Coverage added:
- `packages/iris-dev-mcp/src/__tests__/sql-privileges-live-gate.test.ts` (15 -> 17 tests): (a) a least-privilege account that HOLDS the grants still gets every control: `readOnly` and `countOnly` declines come from the handler (`SQL_READ_ONLY`, the countOnly text), a capped UPDATE commits within the cap and is rolled back over it and under `maxRowsAffected: 0` (the rollback runs as the non-`%All` account), a CALL under a cap is declined with the SqlProc not run (AC 45.1.3 "every caller still works with checks on", which only `_SYSTEM` covered before); (b) an ungranted `countOnly` UPDATE and an ungranted `DELETE %NOJOURN` under a cap get the privilege error (the CHANGELOG names both orderings; the review had logged them as not pinned live). Probe result for (b): IRIS answers the `%NOJOURN` statement with `SQLCODE: -99 ... User <name> does not have %NOJOURN privileges` (its own text, not "is not privileged for the operation"), still at prepare, still no tool refusal code.
- `packages/iris-dev-mcp/src/__tests__/sql-privilege-mode.test.ts` (8 -> 10 tests): no code line of `Sql.cls` or the embed widens the process's roles or user (`$Roles`, `$Username`, `$System.Security`, `Security.*`, role/login calls). This closes the part of the deferred "literal-1 bypass" item that a static pin can close; the rest stays with the armed gate.
- `packages/iris-mcp-all/src/__tests__/story-45-1-doc-claims.test.ts` (new, 10 tests, default suite): the README paragraph, the CHANGELOG section and the changeset (asserted only while the file exists), each claim with a non-document oracle where one exists (refusal codes read from `sql.ts`; "no setting" derived from the built tool schemas and the four `IRIS_SQL_*` variables `loadConfig` reads; "`%Development`" derived from both web applications in `Setup.cls`).
- DW-763 fixed: `live-principal-helpers.ts` `isMissingUserError` (new) + `live-principal-helpers.test.ts` (new, 5 tests) + `userExists` in the live gate now rethrows everything but the route's own absent answer.

DW-763 probe (throwaway, `_SYSTEM`, 2026-11-25): `GET /api/executemcp/v2/security/user/QaNoSuchUser451` answers HTTP **200** with an Atelier envelope `status.errors[0] = {"error":"<locale prefix> #5001: User QaNoSuchUser451 does not exist","code":5001,"domain":"%ObjectErrors","id":"GeneralError","params":[...]}` (the prefix here was Arabic: Rule #13). `http-client.ts` turns that into `IrisApiError(200, errors, ...)`. An existing user answers 200 with `result` and no errors; a wrong password answers 401 with an empty body (`IrisApiError(401, [], ...)`, a non-JSON-response error); an unknown route answers 404. So the old catch (any `IrisApiError` = absent) returned false for 401, 404 and 500 too. The fix accepts only `statusCode === 200` plus an `errors[].error` that contains `User <name> does not exist`.

Mutations (Rule #19/#59; `mutation: <change> -> <red>`; the path each guards is named):
- AC 45.1.1 (account shape): live gate role `%Development:U,<db resource>:RW` -> `<db resource>:RW` (no `%Development`) -> `beforeAll` throws "the least-privilege account QaStory451Lp cannot reach IRIS ... role or password was not accepted", 17 of 17 skipped/red (HTTP 401, as the probe record says); restored, 17 of 17 green. Path: armed gate on the throwaway.
- AC 45.1.2 (literal 1): `Sql.cls` `%Prepare(.pQuery, 1)` -> `0` -> `sql-privilege-mode.test.ts` 2 of 10 red (one-literal-1 test, embed-equals-tree). Path: default suite.
- AC 45.1.2 (bypass keeping the literal): `Set $Roles = "%All"` inserted before the `%SQL.Statement` is created -> the new "no code line widens the process's roles" test red for the tree (and embed-equals-tree red). Path: default suite.
- AC 45.1.3 / 45.1.4 (ungranted refusal, ordering, granted controls): `%Prepare(.pQuery, 0)` PUT + compiled on the throwaway only -> `sql-privileges-live-gate.test.ts` 14 of 17 red through the tool over `/dev/sql/execute` (the 3 green by design: fixture check, Atelier residual, `_SYSTEM`), including both new tests; original redeployed -> 17 of 17 green. Path: armed gate on a seeded throwaway.
- AC 45.1.3 (granted controls) and AC 45.1.6 (`%All` unchanged): `Decline` `If pReadOnly && (pType '= 1) Quit "readOnly"` -> `If 0 Quit "readOnly"`, deployed on the throwaway only -> the new granted-controls test red AND 6 `sql-safety-live-gate.test.ts` legs red as `_SYSTEM` (7 of 107 across both files; story-38-5 files untouched); restored -> 107 of 107 green, `story-38-5-qa-sql-wire-gate.test.ts` 28 of 28. Path: the `%All` account through the tool over the live route.
- AC 45.1.5 (embed regenerated): a comment line appended to `Sql.cls` with no `gen:bootstrap` -> `sql-privilege-mode.test.ts` embed-equals-tree red and `bootstrap.test.ts` "embedded class contents match disk .cls files" plus "the marker's hash is the SHA-256 hash of concatenated disk contents" red (2 of 109); restored. Path: default suite. `ExecuteMCPv2.Tests.BaseTest` on the throwaway: run 1, 7 passed of 7 (`BaseTest.cls` has 7 `Test*` methods, Rule #35).
- AC 45.1.7 (docs): `S-45.1-sql-privileges` renamed in `CHANGELOG.md` -> CHANGELOG test red; the README "Default state" sentence removed -> README test red; the `@iris-mcp/shared` bump removed from the changeset -> changeset test red; a new `env.IRIS_SQL_CHECK_PRIV` read added to `config.ts` -> "always on, with no setting" test red; each restored with `git checkout --`. With the changeset file absent the changeset test skips and 9 pass (the release step consumes the file). Path: default suite.
- DW-763: (1) `userExists` pointed at a route that 404s, with the NEW catch -> the gate fails in `beforeAll` (`IrisApiError: IRIS returned HTTP 404`, 17 skipped); (2) the same wrong route with the OLD catch -> 17 of 17 green (the vacuous pass DW-763 described, demonstrated); (3) `isMissingUserError` without its `statusCode !== 200` check -> `live-principal-helpers.test.ts` 1 of 5 red (the 401/403/404/500 case). Restored by file copy (`shasum -c` OK).

Code review (2026-11-25):
- mutation: the README's "This holds for the privileges IRIS checks at prepare ... applies first." sentence removed -> `story-45-1-doc-claims.test.ts` "states what the account needs ..." red (1 of 10); restored (`shasum -c` OK). Path: default suite.
- mutation: the changeset's prepare/execution qualifier removed -> the changeset test red (1 of 10); restored (`shasum -c` OK). Path: default suite.
- The last AC (`gen:ipm:check`, `gen:governance-baseline:check`, `gen:tools-list-snapshot:check` pass unchanged): no mutation, closed by decision. Each check was proven red by the story that owns it; this story changes no tool, IPM or governance surface, and mutating those generated files is forbidden here.

Doc claims checked against behavior: the CHANGELOG, README and changeset agree with the probe record and the live gate on the error text, the ordering, the minimum account and the default state. One qualification is missing from the README paragraph only: "A missing grant is an `SQL error` with `SQLCODE: -99` before any read-only or cap check" holds for the statements IRIS checks at prepare (SELECT, INSERT, UPDATE, DELETE, CALL and SqlProc calls, CREATE TABLE, TRUNCATE, `%NOJOURN`), not for GRANT or CREATE INDEX (checked at execution); the `Sql.cls` banner and the CHANGELOG already say so. Not edited here (README text is the story's deliverable); flagged for the lead.

Not done: no throwaway run of the `prepublish-dev` CI suite as a whole; `check:live-guards` and the roster test are in the default-suite results below. The dev live gate was last run on the final test file; `Sql.cls` on the throwaway was the working-tree file (identical to the embed), not the CI-seeded embed object.

## Auto Run Result

Status: done
Blocking condition: none.

Implementation pass (2026-11-25):
- **Change:** `Sql.cls` `Perform` prepares with `%Prepare(.pQuery, 1)` (literal, no off-switch); banner and `Perform` comments updated; embed regenerated, `BOOTSTRAP_VERSION` `1.2.0+5.6cbac260e73f` to `1.2.0+8.5cedcac20ae9` (`gen:bootstrap` run twice: Unchanged; `scripts/bootstrap-sequence.json` moved with it).
- **Files:** `src/ExecuteMCPv2/REST/Sql.cls`; `packages/shared/src/bootstrap-classes.ts`, `scripts/bootstrap-sequence.json` (generated); new `packages/iris-dev-mcp/src/__tests__/sql-privilege-mode.test.ts` (8 default-suite tests) and `sql-privileges-live-gate.test.ts` (15 armed tests, throwaway-only principals); `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` (roster); `packages/iris-dev-mcp/README.md`, `CHANGELOG.md`, `.changeset/story-45-1-sql-statements-honor-sql-privileges.md`.
- **Review:** 18 triage rows, all low: patches 3 (static-pin vacuity and entry points, comment rewrap, GRANT/DDL ordering qualifier), deferred 2 (see frontmatter `deferred:`), rejected 13 with reasons in the log. No high or medium.
- **Follow-up review recommended:** false (no high, no medium patched).
- **Verification:** throwaway (digest-pinned image, port 52792, seeded as CI): privilege gate 15/15, `sql-safety-live-gate` 90/90 and `story-38-5-qa-sql-wire-gate` 28/28 (files unchanged), `ExecuteMCPv2.Tests.BaseTest` 7/7 (7 `Test*` methods), `down` run, `docker ps -a --filter label=iris-mcp.owner=throwaway` empty. After the review patches (doc comments, tests, docs only): full `@iris-mcp/all` on the closed port 242 files, 6488 passed / 737 skipped; `@iris-mcp/dev` 1569 passed / 342 skipped; `@iris-mcp/shared` 2701 passed; lint, type-check, `check:live-guards` (75 armed, 0 findings), `gen:governance-baseline:check`, `gen:ipm:check`, `gen:tools-list-snapshot:check`, `check-epics-sync` all OK. Mutations recorded under `## Verification`.
- **Residual risks:** the live gate was last run on the pre-patch embed (`1.2.0+6.e7d03d3558ce`); the later embed changes are comments only. The Atelier `action/query` residual is pinned and left to Story 45.5. The live gate skips (green) under `IRIS_REQUIRE_LIVE` on a non-throwaway IRIS by spec; CI `allowedSkips: []` makes that red there.

Planning pass note: Halted after planning as directed. Probes for AC 45.1.1 ran on throwaway `iris-mcp-throwaway-372894a1e1b7` (127.0.0.1:52792), which was removed; no throwaway remains. The shared instance was not touched. Three epics.md amendments are recorded under Design Notes for the lead (the `%Development` resource-vs-role wording, the missing `Sql.cls` ObjectScript test host, and the ordering change covering every decline).
