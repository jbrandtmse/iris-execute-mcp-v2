---
title: 'Story 45.6: Epic 45 Burn-down, IRIS Side'
type: 'bugfix'
created: '2026-11-26'
status: 'done'
baseline_revision: '681b68e618e553faace661db3e71237e4ac924ec'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
warnings: [oversized, multiple-goals]
deferred:
  - summary: >-
      The bootstrap's compile check reads Atelier docnames with a filter, and IRIS returns an empty filtered list to an account
      without SQL privileges, so a least-privilege account always gets "Compile failed: 35 of 35 classes did not compile" (and,
      with the install on and an unconfigured reading, a recompile that is never confirmed), even when every class is compiled.
    evidence: |-
      Plan probe 2026-11-26, IRIS for Health and IRIS Community 2026.2 Build 221U: as lp456 (%Development:U + namespace DB RW),
      GET docnames/CLS?filter=ExecuteMCPv2 answers 200 with 0 entries; unfiltered docnames/CLS lists all 35 ExecuteMCPv2 classes
      (as _SYSTEM does); GET doc/ExecuteMCPv2.Setup.cls answers upd:true; the dictionary query answers Compiled=1. Adding
      %DB_IRISLIB:R and %DB_IRISSYS:R does not help. The real bootstrap as lp456 reports compiled:false with all 35 named.
    location: >-
      packages/shared/src/bootstrap.ts (upToDateDocuments, verifyCompiled; the docnames filter read)
    severity: medium
  - summary: >-
      IsConfigured's Catch calls WebAppRegistered() while $NAMESPACE may still be %SYS (the switch succeeded and
      Security.Applications.Exists threw), where the ExecuteMCPv2 class resolves only through the %ALL mapping.
    evidence: |-
      Edge case hunter, review pass 2026-11-26; unverified. Settled by a probe as an account that can enter %SYS but
      cannot read Security.Applications; the lp456 probe in P5 failed at the switch itself, where the namespace never changes.
    location: >-
      src/ExecuteMCPv2/Setup.cls (IsConfigured, Catch)
    severity: medium (unverified)
  - summary: >-
      Code review 2026-11-26: TypeScript texts still describe the least-privilege behavior from before DW-773: the
      warnWebAppUnconfirmed warning says "The account may not be able to read %SYS", two bootstrap.ts comments say such an
      account reads unconfigured, and so does the header of bootstrap-auto-install.test.ts.
    evidence: |-
      After 45.6, IsConfigured answers for an account that cannot read the web application's definition in %SYS (throwaway
      probe: both account kinds read 1/0 with the web application present/absent), so an unconfigured reading means a failed
      lookup or an absent web application. This spec forbids TypeScript changes to bootstrap.ts.
    location: >-
      packages/shared/src/bootstrap.ts (warnWebAppUnconfirmed ~L993-1006, comments ~L1238 and ~L1343);
      packages/shared/src/__tests__/bootstrap-auto-install.test.ts (header)
    severity: low (route to 45-7-epic-45-burn-down-typescript-and-docs, which owns bootstrap.ts for DW-788/DW-790)
  - summary: >-
      Code review 2026-11-26 (from QA's ActivateAll finding): a Config.Namespaces.Create("%ALL") rolled back inside a transaction
      leaves IRIS with a namespace table that a namespace created afterwards cannot be entered through, until
      Config.Namespaces.ActivateAll(). The 45.6 guard closes this for iris_sql_query; an IPM install whose Configure phase creates
      %ALL and whose later phase fails (IPM rolls the install back) may hit the same state.
    evidence: |-
      QA 2026-11-26: the guard-removed route leg (ConfigureMapping run inside the route's rolled-back transaction) broke every
      later leg that creates a namespace until the teardown ran ActivateAll. The IPM half is unverified (pre-existing, not this
      story's change). Settle it with a probe IPM module whose Activate phase fails after a Configure phase that creates %ALL,
      then create a namespace and enter it.
    location: >-
      src/ExecuteMCPv2/Setup.cls (ConfigureMapping, Config.Namespaces.Create("%ALL")); the IPM install path
    severity: medium (unverified; pre-existing)
---

<intent-contract>

## Intent

**Problem:** Seven ledger entries owned by this burn-down touch the IRIS-side classes, their tests or the IPM generator: an admin agent on a read-only server can recreate `%ALL` and the `ExecuteMCPv2` mapping in `iris.cpf` through `iris_sql_query` (DW-786); `IsConfigured` reads `0` for every least-privilege account (DW-773); the uninstall report leaves a found `%ALL` without its command and ignores other namespaces' `^UnitTestRoot` once any record exists (DW-780); the bootstrap cannot compile `REST.Interop` in a namespace without interoperability (DW-787); the database list returns wrong `resource`, `readOnly` and `globalJournalState` values and modify fails on them (DW-765); `zpm uninstall` leaves the configuration (DW-774); and the `Setup` unit classes run in no suite (DW-778).

**Approach:** One `Setup.cls`/`Config.cls`/`Interop.cls` change set with one `BOOTSTRAP_VERSION` move, probed first on throwaways (Design Notes): a transaction guard scoped to web requests, a privilege-free web-application lookup in `IsConfigured`, two report-rule fixes, a compile-time type fix, the database fields read and written on `SYS.Database`, the two unit classes added to the CI roster, and DW-774 closed by decision. Every entry ends terminal.

## Boundaries & Constraints

**Always:**
- Terminal dispositions only (Rule #37); the planned table is under Design Notes and is counted mechanically (Rule #51).
- The `SqlProc` set of `Setup` stays exactly `Configure`, `ConfigureMapping`, `EnsureUnitTestRoot`, `GetBootstrapVersion`, `IsConfigured`, with unchanged signatures and return types; every new helper is a plain `ClassMethod` (no `SqlProc`).
- Edit only sources; regenerate the embed once with `pnpm run gen:bootstrap` and record `BOOTSTRAP_VERSION` `1.2.0+10.109d0129528f` → the new value (Rule #24). Before the first `.cls` edit, copy `src/ExecuteMCPv2/Setup.cls`, `packages/shared/src/bootstrap-classes.ts` and `scripts/bootstrap-sequence.json` to the scratchpad; restore them after every mutation run (Rules #48/#59) and confirm `git diff --stat` matches.
- Live proofs run only on `node scripts/throwaway-iris.mjs` (port 52792), `down` afterwards, and `docker ps -a --filter label=iris-mcp.owner=throwaway` prints only its header.
- Docs move in the same change as behavior (README 45.5 section, CHANGELOG, changeset), and every doc-claims pin that quotes a moved sentence follows.

**Never:**
- No new tool, action or governance key; no tools-list or golden-fixture change; `pnpm gen:governance-baseline:check` only.
- Never edit `bootstrap-classes.ts`, the IPM tree (`module.xml`, `ipm/src/**`, `preload/**`), `scripts/lib/ipm-tree.mjs`'s render, `irislib/`, `irissys/`, the ledger, `sprint-status.yaml` or `.claude/rules/*`.
- Never touch the shared IRIS at `localhost:52773` (no uninstall, user, role, grant or `%ALL` change there); never push.
- No TypeScript change to `bootstrap.ts`, `http-client.ts` or `server-base.ts` (the deferred compile-check finding and any `unconfigured` refusal restore belong to Story 45.7).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Guard, read-only route | `iris_sql_query` `SELECT ExecuteMCPv2.Setup_ConfigureMapping('NS')` as an admin; `%ALL` and the mapping absent | Row value is the error status whose text is `ConfigureMapping changed nothing: it was called inside a transaction during a web request, as iris_sql_query runs a SELECT. Run it in an IRIS terminal, or let the automatic install run it.`; `Config.Namespaces.Exists("%ALL")` and `Config.MapPackages.Exists` stay 0; `iris.cpf` gains nothing | Refusal is a returned `%Status`, never an exception |
| Guard, Configure | same route, `Setup_Configure('USER')` | Same text with `Configure`; the web application's namespace is unchanged | same |
| Guard, install paths | bootstrap via Atelier `action/query` (fresh, upgrade, self-heal); IPM `Configure`-phase invoke ($TLEVEL=1, no `%request`); terminal call | Run exactly as today | none |
| IsConfigured, admin | web app present / absent | `1` / `0`, as today | none |
| IsConfigured, least privilege | account without `%SYS` access; web app present / absent | `1` / `0` (CSP application lookup); the TS probe reads `current` | lookup failure → `0` |
| %ALL found | record says `all=found`, no `created` anywhere | `Left: %ALL (the install found it already there; an install by 1.2.0 or earlier that created it writes no record). To remove it by hand: in %SYS: Do ##class(Config.Namespaces).Delete("%ALL"). This deletes %ALL together with every mapping in it, so check what else is mapped there first` | never removed |
| ^UnitTestRoot, namespace without record | some namespace holds a record; namespace N holds none and `^UnitTestRoot` is set | `Left: ^UnitTestRoot (N) (no install record in N says the install set it (an install by 1.2.0 or earlier writes none)). To remove it by hand: in N: Kill ^UnitTestRoot` | never removed |
| ^UnitTestRoot, preset in a recorded namespace | N's record has no `unitTestRoot` node, value preset | Not reported (unchanged) | none |
| No record anywhere | 1.2.0 install | Lines byte-identical to today | none |
| Non-interop namespace | bootstrap into a namespace without `Ens.*` | All 35 classes compile; web app and mapping configured | interop routes against such a target namespace keep today's `<CLASS DOES NOT EXIST>` envelope |
| Database list | `GET /config/database` | `resource` = `SYS.Database.ResourceName`, `readOnly` = `SYS.Database.ReadOnly`, `globalJournalState` = `SYS.Database.GlobalJournalState`; other fields unchanged | DB that cannot be opened → `""`, `false`, `0` as today |
| Database create/modify | `resource`, `readOnly`, `globalJournalState` in the body | Applied on `SYS.Database` (create passes `Resource`/`GlobalJournalState` to `CreateDatabase`; modify and `readOnly` through `%OpenId`/`%Save`); `Config.Databases` gets only its own properties | IRIS's status text through `SanitizeError` |

</intent-contract>

## Code Map

- `src/ExecuteMCPv2/Setup.cls` -- `Configure` L63-120 and `ConfigureMapping` L727-776 (guard goes first, before `Set tSC`; argumented `Quit` outside `Try`); `IsConfigured` L780-791 (fallback in its `Catch`); `DecideAll` L480-502 (the `'pAnyCreated` branch L493-496 gains reason/manual); `DecideUnitTestRoot` L512-521 and its caller in `Uninstall` step 4 L338-357 (pass the namespace's own `tScan(tN,"hasRecord")` instead of `tAnyRecord`; reason text chosen by the caller so the no-record-anywhere text stays byte-identical); class doc L1-15, `Uninstall` doc L122-153.
- `src/ExecuteMCPv2/REST/Interop.cls` L1074 -- `ApplyArbitrarySetting(pItem As Ens.Config.Item, ...)`: the only compile-time `Ens` reference in the 35 bootstrapped classes (`grep -rn " As \(Ens\|EnsLib\|HS\)\." src/ExecuteMCPv2 | grep -v Tests`); becomes `%RegisteredObject`. Callers L719, L920 pass an `Ens.Config.Item`.
- `src/ExecuteMCPv2/REST/Config.cls` -- `DatabaseList` L166-221 (reads `Resource`/`ReadOnly`/`GlobalJournalState` from `Config.Databases.Get` L206-209; `tDBObj` is already open L193); `BuildDatabaseConfigProps` L237-245 (drop the three); `BuildDatabaseRuntimeProps` L255-260 and `ApplyRuntimeProps` L267-285 (extend: `ResourceName`, `ReadOnly`, `GlobalJournalState`); create L370-405 (`CreateDatabase` L383: pass `Resource` arg 5, `GlobalJournalState` arg 6); modify L407-449.
- `irissys/SYS/Database.cls` L270 `ResourceName`, L590 `CreateDatabase(Directory, Size, BlockSize, EncryptedDB, Resource, GlobalJournalState, ...)`; `irissys/Config/Databases.cls` properties L71-123 (no `Resource`, `ReadOnly`, `GlobalJournalState`) -- read-only evidence.
- `irislib/%SYSTEM/CSP.cls` L142-148 `GetAppName(url)` -- the lookup the fallback uses (returns `/api/executemcp/v2/` for a URL under the app when the URL starts with `/`, `""` when absent).
- `src/ExecuteMCPv2/Tests/SetupTest.cls` (7 tests; record save/restore L18-33 is the hermetic pattern to extend) and `src/ExecuteMCPv2/Tests/SetupUninstallTest.cls` (12 tests; `TestDecideAll` L102-127, `TestDecideUnitTestRoot` L129-140, `TestSqlProcSetIsExactlyTheFive` L11-25, `TestInstallMethodSignaturesUnchanged` L29-37).
- `packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts` L326-341 -- the `it.each` roster with totals (Rule #35) that CI's `integration-dev` suite runs on the seeded HSCUSTOM throwaway; `scripts/ci-seed-throwaway.mjs` L41 already seeds every `Tests` class.
- `packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts` -- live database legs (`integration-admin`); extend for DW-765.
- `packages/iris-mcp-all/src/__tests__/story-45-3-uninstall-round-trip-live-gate.test.ts` L385-465 (two `Left: %ALL (the install did not create it)` legs move), L467 (preset leg stays), L494 (no-record leg stays byte-identical).
- Doc pins to follow moved sentences: `packages/iris-mcp-all/src/__tests__/story-45-5-doc-claims.test.ts`, `qa-45-5-doc-oracles.test.ts`, `story-45-2-auto-install-orchestration.test.ts`, `story-45-3-doc-claims.test.ts` (L226 stays true), `epic45-capstone-gate.test.ts` (check only).
- `README.md` L406, L431 (uninstall report), L550 (read-only bullet: "an account that cannot read `%SYS` ... reads `unconfigured` too"), L933-935 (five procedures, residual "This release documents this and does not change it."), L943-948 (least privilege and the automatic install); `CHANGELOG.md` L13 ("This release documents it and changes no code."), L71 (45.3 IPM-upgrade sentence); `.changeset/` (new file, pattern of `story-45-5-...md`).
- Generated/locked, regenerate or leave: `packages/shared/src/bootstrap-classes.ts`, `scripts/bootstrap-sequence.json` (via `gen:bootstrap`); `scripts/gen-bootstrap.mjs` rosters unchanged (no new bootstrapped class).

## Tasks & Acceptance

**Execution:**
- `src/ExecuteMCPv2/Setup.cls` -- (DW-786) first lines of `Configure` and `ConfigureMapping`: `If ($TLevel > 0) && $IsObject($Get(%request)) Quit $$$ERROR($$$GeneralError, "<Name> changed nothing: ...")` with the matrix text; (DW-773) new plain `ClassMethod WebAppRegistered() As %Boolean` = `$System.CSP.GetAppName(..#WEBAPP_"/") = (..#WEBAPP_"/")` inside its own Try (0 on error), called from `IsConfigured`'s `Catch`; (DW-780) `DecideAll` found branch sets the matrix reason and the same `pManual` as the no-record branch, `Uninstall` step 4 passes the namespace's own record flag and picks the matrix reason text when another namespace holds a record; update the class/method doc comments (contract only, Rule 14).
- `src/ExecuteMCPv2/REST/Interop.cls` -- (DW-787) `pItem As %RegisteredObject`; doc line states the argument is an `Ens.Config.Item`.
- `src/ExecuteMCPv2/REST/Config.cls` -- (DW-765) list reads the three fields from `tDBObj`; create passes `Resource`/`GlobalJournalState` to `CreateDatabase` and applies `ReadOnly` after; modify routes the three through the `SYS.Database` path; `Config.Databases.Create/Modify` receive only `Directory`, `MountRequired`, `MountAtStartup`.
- `src/ExecuteMCPv2/Tests/SetupTest.cls` -- add: guard refuses inside `TSTART` with `New %request Set %request=##class(%CSP.Request).%New()` (web app namespace unchanged, status text asserted, `TROLLBACK` in all paths); guard passes inside `TSTART` without `%request` (`ConfigureMapping` on an existing mapping returns OK); `WebAppRegistered()` equals `IsConfigured()` after `Configure`.
- `src/ExecuteMCPv2/Tests/SetupUninstallTest.cls` -- update `TestDecideAll` (found branch carries the command) and `TestDecideUnitTestRoot` (per-namespace flag), keep the two back-compat pins.
- `packages/shared/src/bootstrap-classes.ts`, `scripts/bootstrap-sequence.json` -- regenerate once with `pnpm run gen:bootstrap`; record from→to.
- `packages/shared/src/__tests__/bootstrap-no-interop-types.test.ts` (new) -- over the embedded `BOOTSTRAP_CLASSES` source (doc comments stripped), no formal spec, return type or property type names an `Ens.`, `EnsLib.` or `HS.` class (DW-787 static pin).
- `packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts` -- (DW-778) add `ExecuteMCPv2.Tests.SetupTest` and `ExecuteMCPv2.Tests.SetupUninstallTest` to the roster; totals are `grep -c "^Method Test" <file>` after this story's edits, written as literals with that command in a comment.
- `packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts` -- (DW-765) list: `USER`'s `resource` is `%DB_USER` and `IRISLIB`'s `readOnly` is true; create a disposable database with `resource` and `globalJournalState`, read them back through the list, modify `resource`, delete it (self-contained, cleanup in `finally`).
- `packages/iris-mcp-all/src/__tests__/story-45-3-uninstall-round-trip-live-gate.test.ts` -- update the two found-`%ALL` legs to the new line, taking the expected text from a live run (Rule #36); add a leg: record in USER, a second namespace with `^UnitTestRoot` and no record is reported with its command.
- `README.md`, `CHANGELOG.md`, `.changeset/story-45-6-epic-45-burn-down-iris-side.md` -- residual bullet: the read-only path is refused and changes nothing, the direct-Atelier admin case stays "the account's privileges are the boundary"; both "This release documents…" sentences replaced; least-privilege text and the L550 sentence describe the new `current` reading and the remaining compile-check warning (deferred finding); uninstall report text (L406, L431, CHANGELOG L71); new 45.6 CHANGELOG section naming the sanctions, `BOOTSTRAP_VERSION` from→to and the DW-774 decision; changeset `minor`.
- Doc-claims tests listed in the Code Map -- update pins whose sentences moved; derive each pin from code where a pin already does.

**Acceptance Criteria:**
- Given the planned disposition table, when the lead counts its Disposition column mechanically, then 6 rows read `resolved` and 1 reads `closed by decision`, and each mirrors into the ledger (AC 45.6.1).
- Given a read-only dev server connected as an admin on a throwaway with `%ALL` and the mapping removed, when `iris_sql_query` runs `SELECT ExecuteMCPv2.Setup_ConfigureMapping('<ns>')` and then `SELECT ExecuteMCPv2.Setup_Configure('USER')`, then each answer carries the guard text, `Config.Namespaces.Exists("%ALL")` and `Config.MapPackages.Exists` stay 0, `iris.cpf` holds no `%ALL` line, and the web application's namespace is unchanged; and the same calls through Atelier `action/query` still run.
- Given the guard is in place, when the automatic install runs fresh, as an upgrade and as a self-heal, and when CI's `ipm` job installs the archive built from the embed on both editions, then each completes configured and mapped, and the `uninstall-round-trip` suite stays green.
- Given a least-privilege account (`%Development:U` plus `RW` on the namespace database) and an installed side, when a dev server starts with the install on and with it off, then the probe reads `current`, nothing is written, and no "could not confirm" warning is logged.
- Given a namespace that is not interoperability-enabled, when the bootstrap installs there, then all 35 classes compile and the web application and mapping are configured.
- Given `iris_database_list`, when it reads `USER` and `IRISLIB`, then `resource` is `%DB_USER`/`%DB_IRISLIB` and `IRISLIB`'s `readOnly` is true; and a create/modify with `resource` lands in `SYS.Database.ResourceName`.
- Given CI's `integration-dev` suite on the seeded throwaway, when it runs, then `SetupTest` and `SetupUninstallTest` complete with `total` equal to their `Test*` method counts and `failed` 0.
- Given no record anywhere, when the uninstall runs, then its lines are byte-identical to today (the L494 leg); and the SqlProc set and signatures pins pass unchanged (AC 45.6.2).

### Review Findings

Code review 2026-11-26 (follow-up review, `review_mode=full`, frozen diff `ee525237..b3bbaf91`). All four layers delivered (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor); `failed_layers` none. 36 rows (35 from the layers, 1 from the reviewer's own probe) → 15 entries: 1 high, 5 medium, 9 low; 10 rows rejected.

- [x] [Review][Patch] **HIGH: the Epic 45 capstone's armed least-privilege start leg still asserted the could-not-confirm warning that DW-773 removes**, so the epic-done gate would be red on its next armed `prepublish-all` run [packages/iris-mcp-all/src/__tests__/epic45-capstone-gate.test.ts:707] — now asserts no could-not-confirm line; header and the LP-hermetic title restated (that state now stands for a failed lookup). Armed on a seeded HSCUSTOM throwaway: 21/21.
- [x] [Review][Patch] **MED: `IsConfigured` still read 0 for an account that can enter `%SYS` but may not read `Security.Applications`** [src/ExecuteMCPv2/Setup.cls:IsConfigured] — reviewer probe: such an account (`%DB_IRISSYS:R`, the uninstall gate's `uninstalllp2` shape) gets `Exists`=0 with `ERROR #822: Access Denied`, no exception, so the fallback in the `Catch` never ran. The fallback now runs after the `Try`/`Catch` whenever `Exists` does not answer 1. Pinned by the least-privilege leg (both account kinds, present and absent) and a source pin in `qa-45-6-doc-oracles.test.ts`.
- [x] [Review][Patch] MED: `TestGuardRefusesInTransactionDuringWebRequest` removed the instance-wide mapping and restored it inline into the current namespace's database [src/ExecuteMCPv2/Tests/SetupTest.cls] — `RemoveMapping` saves the database, `RestoreMapping` puts it back as it was (asserted) and `OnAfterOneTest` restores it on any abort.
- [x] [Review][Patch] MED: that test's record assertion read the test namespace's record, which an unguarded call never writes (cannot fail) [src/ExecuteMCPv2/Tests/SetupTest.cls] — now compares `tOther`'s record before and inside the transaction (`RecordDump`).
- [x] [Review][Patch] MED: the DW-787 live leg had no non-interoperability precondition and no assertion for AC 5's second half [story-45-3-uninstall-round-trip-live-gate.test.ts] — asserts `Ens.Config.Item` is not compiled in `UNINSTALLNS`, then the web application (pointing at `UNINSTALLNS`), `%ALL` and the mapping.
- [x] [Review][Patch] MED: AC 3's upgrade and self-heal had no automated pin [story-45-3-uninstall-round-trip-live-gate.test.ts] — new leg: older-marker seed with the configuration removed → upgrade configures and maps; web application deleted → self-heal registers it.
- [x] [Review][Patch] LOW (lead directive, DW-789): `IsConfigured`'s `Catch` ran the fallback without restoring the namespace [src/ExecuteMCPv2/Setup.cls] — the namespace is restored first in the `Catch` and after `Exists`. Probed unreachable as a failure: with the restores removed and the `%ALL` mapping deleted, both least-privilege accounts still read 1 (one `.1` routine, so `..WebAppRegistered()` is a local call; the CSP lookup is instance-wide). Pinned by the source pin only.
- [x] [Review][Patch] LOW (lead directive): the CHANGELOG 45.2 section (two bullets) and the 45.2 changeset said such an account reads `unconfigured` even when the web application exists [CHANGELOG.md, .changeset/story-45-2-*.md] — reworded; consistency pin added in `qa-45-6-doc-oracles.test.ts`.
- [x] [Review][Patch] LOW: two checks of the real-route DW-786 leg were described as oracles [story-45-3-uninstall-round-trip-live-gate.test.ts] — the snapshot check IS an oracle (under a guard that runs and then refuses, HSCUSTOM sees the 35 classes through the recreated `%ALL` mapping); the web-application check is a side check; the `iris.cpf` count now runs first and its own red is recorded.
- [x] [Review][Patch] LOW: `mutation:` lines missing for AC 6's writes, AC 45.6.2 and AC 5's second half — run and recorded under `## Verification`.
- [x] [Review][Patch] LOW: README L550 did not name the remaining compile-check warning [README.md] — added.
- [x] [Review][Patch] LOW: an IPM install started from a web request (`zpm` through `iris_execute_command`) is refused, undocumented [README.md, CHANGELOG.md, changeset] — one sentence each.
- [x] [Review][Patch] LOW: the DW-765 create test never removed a leftover database of its fixed name [admin.integration.test.ts] — deleted before the create.
- [x] [Review][Defer] LOW: TypeScript texts still describe the old least-privilege behavior (`warnWebAppUnconfirmed`'s "may not be able to read %SYS", `bootstrap.ts` comments near L1238/L1343, the `bootstrap-auto-install.test.ts` header) [packages/shared/src/bootstrap.ts] — deferred: Story 45.7 owns `bootstrap.ts` (this spec forbids TypeScript changes there).
- [x] [Review][Lead] LOW: the spine has no `S-45.6-*` sanctions and no AD-14/AD-25/AD-31 text for the guard, the lookup or the compile-time rule [ARCHITECTURE-SPINE.md] — the lead's Rule 20 write (Design Notes D6 has the proposed text).

**Rejected.**
- Edge: a found `%ALL` holding foreign mappings is not listed — low; the manual text already says "check what else is mapped there first".
- Edge: an invalid `globalJournalState` reaches `CreateDatabase` unvalidated — false; probe: 7 → `ERROR #5794 … '%JournalState'`, 0 → default 2.
- Edge: `ReadOnly` with other properties in one `%Save` is refused — false; probe: `ReadOnly=1`+`ResourceName` and `ReadOnly=0`+`ResourceName` on a read-only database each save in one `%Save`.
- Edge / Blind / Gap: the static pin's regex misses `Include` lists, `DependsOn`, `CompileAfter`, `ForeignKey … References` — low; none of the 35 classes uses those keywords; `reopen_if` a bootstrapped class gains one.
- Blind: the per-namespace `^UnitTestRoot` rule reports namespaces the suite never touched — by-design (Design Notes D4; reported, never removed).
- Blind: `%ALL` and `^UnitTestRoot` treated differently after an IPM upgrade of 1.2.0 — by-design (D4 residual, in the README).
- Blind: `iris_database_manage` docs do not say IRIS refuses changes to a read-only database — low; IRIS's own text is returned, and the combined call works (probe above).
- Blind: spec bookkeeping (`status`, `baseline_revision`, files list, CHANGELOG lead-in) — rejected: a spec edit; `status: done` is the build contract, and `681b68e6` differs from `ee525237` by one cycle-log line.
- Gap: `tHasRequest`, `tLevelIn` and the IPM-upgrade leg's `REQUEST=0` are preconditions presented as assertions — low, cosmetic.
- Gap: `ApplyArbitrarySetting`'s caller path is untested after the type change — false; probe on the seeded HSCUSTOM throwaway: formal `pItem:%RegisteredObject`, insert, update in place and an `@Host` target on an `Ens.Config.Item` all apply (`COUNT=2 FILEPATH=/tmp/b/ HOST=1`).

## Spec Change Log

- 2026-11-26 (lead, spec gate, decisions #176 and #177; BINDING):
  - **D1 is R10, ruled by the Planner.** The guard refuses when `$TLEVEL>0` AND `$IsObject($Get(%request))`. Never reference a bare `%request`, so the IPM and terminal paths cannot hit `<UNDEFINED>`.
  - **A1–A4 are applied to `epics.md`.**
  - **D2–D7 are accepted as recommended:** DW-774 is closed `wontfix-accepted`, and the compile-check finding is DW-788, routed to 45.7.
  - **Planner conditions for DW-786:**
    1. **All three paths are pinned both ways (Rule #59):**
       - a read-only `iris_sql_query` call is refused, and `%ALL` and the mapping stay out of `iris.cpf` (and the same for `Configure`);
       - the Atelier bootstrap installs on a fresh install, an upgrade and a self-heal;
       - the IPM install succeeds.
       - **Mutation A:** drop the `%request` term, and the IPM leg goes red.
       - **Mutation B:** drop the `$TLEVEL` term, and the bootstrap leg goes red.
       - Restore every mutation byte-identically (`Setup.cls`, `bootstrap-classes.ts`, `bootstrap-sequence.json`, checked with `cmp`).
    2. **The IPM leg runs with the NEW classes.** On a throwaway, generate an IPM tree into a scratch directory (never the committed tree; `gen:ipm:check` stays green) and `zpm install` it. Record that in the spec. Also check whether the 1.3.0 release rehearsal installs through IPM from the freshly stamped tree (read `scripts/release*.mjs` and CI's `ipm` job), and report the answer to the lead.
    3. **The other code-running paths are named.** Under the read-only preset, `iris_execute_command` and `iris_execute_classmethod` are off. The lead confirmed this with the governance CLI (`universe`, source `preset`, `mutates: write`). Add one line to the 45.5 residual text saying so.
    4. **The refusal text** says the call came from a web request inside a transaction (as a read-only SQL query does), that nothing changed, and to run the configuration from an IRIS terminal, the automatic install or IPM.
  - **Other conditions:**
    - **DW-773:** update the 45.5 least-privilege text in the same change.
    - **DW-787:** show that an interop route still works on IRIS for Health.
    - **DW-765:** smoke a modify on a throwaway database only, with a least-privilege read as well.
  - **Status:** `blocked` → `ready-for-dev`.

## Review Triage Log

### 2026-11-26 — Review pass
- verdicts: 30 findings — high 0, medium 7, low 17, false 5, maybe-false 1 (a layer bullet that holds more than one claim is logged as one row per claim; the intent auditor's descriptive divergences are rows Intent-1 to Intent-6)
- findings:
  - `[medium]` `[patch]` Blind-2 / Gap-1 / Intent-1: no test sends the guarded SELECT through the real `iris_sql_query` route (the unit test fakes `%request`) — a route that stopped exposing `%request` would silently reopen DW-786. Patched: new leg in `story-45-3-uninstall-round-trip-live-gate.test.ts` (admin, built server's `iris_sql_query`, `%ALL` and mapping removed first, asserts the refusal text, `%ALL`/mapping/web application/classes unchanged and no `%ALL` line in `iris.cpf`). Mutation: both guards → `If 0` (regen) → that leg red, 1 failed of 20.
  - `[medium]` `[patch]` Blind-3 / Gap-2 / Intent-2: the `IsConfigured` fallback is never executed by a test (`TestWebAppRegisteredMatchesIsConfigured` runs privileged). Patched: the existing least-privilege leg now logs in as `uninstalllp1` (cannot read `%SYS`) and asserts `IsConfigured` is 1 with the web application and 0 after it is deleted. Mutation: fallback → `Set tResult = 0` (regen) → that leg red, 1 failed of 21.
  - `[medium]` `[patch]` Blind-5 (tests never send `readOnly`) / Gap-3 / Edge-7: the `readOnly` create path, the post-create apply and the `globalJournalState` modify are unpinned. Patched: `admin.integration.test.ts` creates with `readOnly: true`, modifies flags (`readOnly:false`, `globalJournalState:3`), then `resource` (IRIS refuses any change to a read-only volume, so the order matters). Mutation: `ApplyRuntimeProps` ReadOnly line removed → `create applied readOnly` red, 1 failed of 32.
  - `[medium]` `[patch]` Gap-4: `TestGuardRefusesInTransactionDuringWebRequest` read its state after `TROLLBACK` (cannot fail) and the mapping already existed (no-op). Patched: state read inside the transaction, other namespace chosen, mapping removed first and restored after, `WebAppNamespace` reads its web-app name before the namespace switch. Mutation: both guards removed, deployed to a throwaway → the test is red (run aborts after the unguarded `Configure` moved the web application).
  - `[medium]` `[patch]` Blind-8 / Gap-5b / Intent-4: no automated bootstrap into a namespace that is not interoperability-enabled. Patched: new leg builds `UNINSTALLNS`, runs the real bootstrap and asserts every embedded class is a compiled class. Mutation: `pItem As Ens.Config.Item` (regen) → that leg red, 1 failed of 21.
  - `[low]` `[patch]` Blind-7 / Gap-5a / Edge-4: the static pin regex missed `as ens.`, `list Of`, an `Extends` list and `Include`. Patched: case-insensitive, three alternatives, four new can-fail cases; 38 tests green.
  - `[low]` `[patch]` Gap-4b: the spec had prose mutations but no `mutation:` lines. Patched: lines added under `## Verification`.
  - `[maybe-false]` `[defer]` Edge-1: `IsConfigured`'s `Catch` runs with `$NAMESPACE` still `%SYS` when the switch succeeded and `Security.Applications.Exists` threw; `..WebAppRegistered()` may then not resolve. Deferred (medium, unverified): needs an account that can enter `%SYS` but cannot read `Security.Applications` (the `lp456` probe in P5 failed at the switch itself, where the namespace never changes).
  - `[low]` `[reject]` Blind-1: an IPM install run through `iris_execute_command` is a web request, so the guard refuses it. Real but narrow, and the refusal text says where to run it (an IRIS terminal or IPM from a terminal); the fix is not a direct correction. `reopen_if`: a field report of `zpm install` through a web call.
  - `[false]` `[reject]` Blind-3b: `$System.CSP.GetAppName` prefix matching could give a false 1. Plan probe P5: `/api/nosuchapp/` and `/api/executemcp/` return `""`, the registered application returns `/api/executemcp/v2/`, the deleted one `""`.
  - `[low]` `[reject]` Blind-4: `DatabaseList` reports `""`, `false`, `0` for a database that cannot be opened. Matrix row 65 states it ("as today"); not a change of this story.
  - `[low]` `[reject]` Blind-5b / Edge-5: a `ReadOnly` failure after a successful create leaves the database created. The create is followed by one `%Save` on a database just created; no realistic path reaches it, and the error text is returned.
  - `[false]` `[reject]` Blind-5c: `ReadOnly` versus `ReadOnlyMounted`. The tool field is the configured `ReadOnly` flag (matrix row 65); the integration test asserts it through create and modify.
  - `[low]` `[reject]` Blind-6: the admin test names `IRISLIB` and `USER`. Both are stock databases on every instance this suite runs on; the same file already relies on `USER`.
  - `[low]` `[reject]` Blind-9: the README quotes `35 of 35` and the CHANGELOG names no DW id for the unfixed warning. The count is the live message (probe P5), the finding is carried in `deferred` and owned by Story 45.7, and the README doc-claims test forbids ledger ids in the README.
  - `[false]` `[reject]` Blind-10a / Edge-3: the broader found-`%ALL` text and one `Left:` line per namespace without a record. Both are matrix rows 60 and 61 (D4), documented in the README and CHANGELOG; a `Left:` line never removes anything.
  - `[low]` `[reject]` Blind-10b: a stale test comment on `DecideUnitTestRoot("", "", 0)`. Read in context it still states the case (nothing recorded, nothing set) and is a direct wording choice only.
  - `[low]` `[reject]` Edge-2: two namespaces sharing one `^UnitTestRoot` report a global the same run already killed. Needs a shared global mapping plus a record in only one namespace; the report is a report and nothing is removed twice.
  - `[low]` `[reject]` Edge-6: `+` coercion of a non-numeric `globalJournalState` or `readOnly`. `SYS.Database` validates the property on `%Save` and returns the status text through `SanitizeError`; the same coercion is used for every numeric field of the route.
  - `[false]` `[reject]` Edge-8: the refusal text ends "or IPM" where the matrix says "the automatic install". Spec Change Log condition 4 requires the IPM wording; the matrix text predates it.
  - `[low]` `[reject]` Gap-6: the doc-claims tests pin README and CHANGELOG sentences. That is the project's documented pattern (Rule #30); the guard's pin matches the source line on purpose.
  - `[low]` `[reject]` Intent-3: the DW-765 integration test is skipped without a live IRIS. It is an armed `integration-admin` CI suite that ran 32 of 32 on a throwaway and went red under the mutation above.
  - `[low]` `[reject]` Intent-5: the DW-778 roster rows run only in `integration-dev`. That is the suite that owns custom-REST test classes; it ran 36 of 36 with totals 10 and 12, and the flipped-`DecideRecords` mutation turned its row red.
  - `[medium]` `[patch]` Gap-1b (same root cause as the first row): the capstone's `-99` leg refuses at prepare, so it never reaches the guard. Covered by the new route leg above.
  - `[medium]` `[patch]` Blind-2b (same root cause as the second row): `GetAppName` exact-equality comparison with the trailing slash was untested. Covered by the new least-privilege assertions.
  - `[low]` `[patch]` Edge-4b (same root cause as the regex row): `Include` of an Ens or HS include file. Covered by the widened regex.
  - `[low]` `[reject]` Gap-4c: the `$TLEVEL` term is pinned only by the bootstrap leg, not by a `SetupTest` test. Mutation B turns that leg red (17 of 18 failed); the unit run has no `%request` object in a level-0 call, so no unit test can see the term.
  - `[false]` `[reject]` Intent-6: the intent's expectations "live at the route" while the unit test is in-process. Answered by the route leg above; no further divergence.
  - `[low]` `[reject]` Blind-7b: the "can fail" cases test the regex on strings, not the embed. The embed is red under the recorded `Ens.Config.Item` mutation (1 failed of 38).
  - `[low]` `[reject]` Gap-6b: the guard pin matches an exact source line. Brittleness is the point of a source pin (it fails when the guard changes); the live leg is the behavior pin.

## Design Notes

**Planning context and ADs.** `epic-45-context.md` was stale against `epics.md` and was recompiled at step 01 (the lead commits it as bookkeeping). Governing ADs: AD-14 (bootstrap, IPM, install record; the spine's L267/L300 already say IPM runs inside a transaction), AD-15 (sanctions), AD-25 (read paths), AD-31 (trust model), AD-13 (namespace save/restore in `Config.cls`), AD-33 (the `/config/database` route stays wire-compatible: same fields, corrected values). No service is introduced (Rule 1). Extend, don't copy: `WebAppRegistered` is a sibling read beside `IsConfigured`; the database fields extend `BuildDatabaseRuntimeProps`/`ApplyRuntimeProps`.

**Planned dispositions (Rule #51: count the Disposition column).**

| Entry | Disposition | Evidence / proof | Mutation (path) |
|---|---|---|---|
| DW-786 | resolved | guard R10 (needs the Planner, D1); probes P1-P4 | delete the guard lines, regen, deploy → admin read-only leg recreates `%ALL` in `iris.cpf` (built dev `iris_sql_query` → `/dev/sql/execute` readOnly) |
| DW-773 | resolved | `WebAppRegistered` fallback; probe P5 | drop the fallback → least-privilege leg reads `unconfigured` and logs "could not confirm" (built dev startup → Atelier `SELECT Setup_IsConfigured()` as the LP account) |
| DW-780 | resolved | two report rules; `SetupUninstallTest` and round-trip legs | revert the found-branch `pManual` → `TestDecideAll` and the found legs red (`iris_execute_tests` on the seeded throwaway; terminal one-liner) |
| DW-787 | resolved | type fix; probe P6 on both editions | revert to `Ens.Config.Item` → static pin red and the non-interop bootstrap reports `Compile failed` (built shared embed → Atelier compile) |
| DW-765 | resolved | `SYS.Database` reads/writes; probe P7 | revert the list to `Config` props → `integration-admin` resource assertion red (`iris_database_list` → `GET /config/database`) |
| DW-774 | closed by decision | probe P8; reasons below (D5) | none |
| DW-778 | resolved | roster in `integration-dev`; probe P9 | flip `DecideRecords` in `Setup.cls`, deploy → the roster row fails `passed === total` (vitest → `iris_execute_tests` → Atelier `/work`) |

**Probes (2026-11-26).** Throwaways via `node scripts/throwaway-iris.mjs up --host-port 52792`: `iris-mcp-throwaway-fb982fd83ce3` from the pinned `irishealth-community:2026.2@sha256:462de1fb…` (`--namespace HSCUSTOM`, `--mount <scratch>/ipmprobe:/opt/iris-mcp/ipmprobe`), and `iris-mcp-throwaway-bbbe007851d2` from `iris-community:2026.2@sha256:cd2ebcab…` (`IRIS_COMMUNITY_IMAGE`, `--namespace USER`). Both report `IRIS for UNIX (Ubuntu Server LTS for ARM64 Containers) 2026.2 (Build 221U)`; IPM 0.10.5 was imported from `/usr/irissys/dist/install/misc/zpm.xml`. Each was removed with `down`; `docker ps -a --filter label=iris-mcp.owner=throwaway` then printed only its header. Scripts and full outputs: `<scratchpad>/p456/` (`make-dist.mjs` builds patched copies of the built shared dist; `run.mjs bootstrap|atelier|route|http|deploy|tests`; `out/*.txt`). Least-privilege account `lp456`: role `LPR456` = `%Development:U,%DB_HSCUSTOM:RW` (Health) / `%DB_USER:RW` (Community).
- **P1, $TLEVEL on the install paths (DW-786 condition 1).** A dist copy whose `Configure`/`ConfigureMapping` log `$TLevel` and refuse when it is above 0; real `bootstrap()` into HSCUSTOM: fresh `missing` → `TLProbe Configure|0`, `ConfigureMapping|0`, `{configured, mapped: true, errors: []}`; upgrade (marker 11 over 10, web app, mapping and `%ALL` deleted) → `stale`, both `|0`, green; self-heal (web app deleted) → `unconfigured`, both `|0`, green. Fresh into PLAIN (Health, Community): both `|0`. **Holds.**
- **P2, $TLEVEL on `iris_sql_query`'s path.** `SELECT ExecuteMCPv2_Temp.P456_Level()`: route `readOnly:true` → `1`; route without `readOnly` → `0`; Atelier → `0`. **Holds.**
- **P3, the IPM install (owner #174 fallback).** Probe module `probe-ipm-456` (`<Invoke>` at the default Configure phase): `zpm "load"` logs `Configure-default-v1|tlevel=1` on install, reload and upgrade. A module whose Configure invoke refuses when `$TLevel > 0`: `Configure FAILURE`, `Activate FAILURE`, `ERROR! Guarded Configure changed nothing…`, module not listed. **The IPM install runs `Configure`/`ConfigureMapping` inside IPM's transaction, so a plain `$TLEVEL>0` guard breaks every IPM install.** Caller frames are not a stable signal (`Generate+380^%SYS.DynamicStatement` on the route, `%sqlcq.HSCUSTOM.cls26.1` through Atelier, `Load+105^%apiOBJ` in IPM). `%request`: route `tlevel=1|request=1|app=/api/executemcp/v2/`, Atelier `tlevel=0|request=1|app=/api/atelier/`, IPM `tlevel=1|request=0`.
- **P4, guard R10 end to end (Health).** Real `Setup.cls` with `If ($TLevel > 0) && $IsObject($Get(%request))` loaded through IPM (`probe-ipm-456c`, invokes `Configure` and `ConfigureMapping`, web app, mapping and `%ALL` deleted first): `Configure SUCCESS`, log `Configure|1|irisowner|req=0`, `ConfigureMapping|1|irisowner|req=0`, web app, `%ALL`, mapping and `iris.cpf` lines present. Then `%ALL` and the mapping deleted; route `readOnly` `SELECT ExecuteMCPv2.Setup_ConfigureMapping('HSCUSTOM')` → row `"0 …ConfigureMapping changed nothing: it was called inside a transaction ($TLEVEL=1) during a web request…"` (the `%Status` in its internal form, not an SQLCODE); afterwards `%ALL exists=0 mapping exists=0`, no `%ALL` line in `iris.cpf`. The plain guard on `Configure('USER')` likewise left the web app at `HSCUSTOM`. Atelier `action/query` → `"1"`, mapping restored. Without the guard the same route call recreates `%ALL` in `iris.cpf` (Story 45.5 Probe B).
- **P5, DW-773.** As `lp456`: `Setup_IsConfigured()` → `false` with the web app present; `P456_SysExists()` → `ERR <PROTECT> /usr/irissys/mgr/`; `$System.CSP.GetAppName("/api/executemcp/v2/")` → `/api/executemcp/v2/` (present), `""` (deleted), `/api/executemcp/v2/` again after `Configure`, same for `_SYSTEM`; `/api/nosuchapp/` and `/api/executemcp/` → `""`. The candidate (today's read, then the lookup in `Catch`) → `_SYSTEM 1|sys`, `lp456 1|fallback:<PROTECT>`; deleted → `0|sys`, `0|fallback`; re-registered → `1`. Real bootstrap as `lp456`: today's classes → `unconfigured` and a recompile; with the candidate deployed → `current`, no write. Both readings then report `Compile failed: 35 of 35` (the `deferred` finding, also on Community USER).
- **P6, DW-787.** HEAD bootstrap into PLAIN (new database, not interoperability-enabled): Health and Community both → `Compile failed: 1 of 35 classes did not compile: ExecuteMCPv2.REST.Interop. IRIS reported: ERROR #5373: Class 'Ens.Config.Item', used by 'ExecuteMCPv2.REST.Interop:ApplyArbitrarySetting:FormalSpec', does not exist`. With only `pItem As %RegisteredObject` changed (package deleted first): `{compiled, configured, mapped: true, errors: []}` on both. From the web app in PLAIN: `interop/production/status?namespace=HSCUSTOM` (Health) / `USER` (Community) → 200 `Stopped`; `namespace=PLAIN` → today's `<CLASS DOES NOT EXIST>…Ens.Director` envelope. Cleaned with `Setup.Uninstall()` (all removed). Community `USER` is interoperability-enabled; HEAD installs there cleanly.
- **P7, DW-765 (Health, `%SYS`).** `Config.Databases.Get("USER")` keys: `ClusterMountMode Directory MountAtStartup MountRequired Server StreamLocation` only. `SYS.Database`: `USER ResourceName=%DB_USER ReadOnly=0 GlobalJournalState=3`, `IRISLIB %DB_IRISLIB ReadOnly=1 GlobalJournalState=2`. Route list: every row `"resource":""`, IRISLIB `"readOnly":false`, `"globalJournalState":0`. Route create `{resource:"%DB_HSCUSTOM", globalJournalState:3}` → `created`, but `ResourceName=%DB_%DEFAULT`; route modify `{resource}` → `ERROR #5001 … <PROPERTY DOES NOT EXIST>Modify *Resource,Config.Databases`. `SYS.Database.CreateDatabase(dir,1,,,"%DB_HSCUSTOM",2)` → `ResourceName=%DB_HSCUSTOM GJS=2`; `%OpenId`/`%Save` set `ResourceName`, `GlobalJournalState` and `ReadOnly` 1/0. A resource that does not exist is accepted as given (`%DB_NOSUCHRES`).
- **P8, DW-774 (IPM 0.10.5).** `zpm "uninstall probe-ipm-456"`: `Clean START → Unconfigure START/SUCCESS → Clean SUCCESS`; log `Unconfigure-Before-v2|tlevel=0|other=1|rec=1`, `Unconfigure-After-v2|tlevel=0|other=1|rec=1` (both run before IPM deletes the classes); no Unconfigure invoke runs on `load`, reload or upgrade.
- **P9, DW-778.** `SetupTest` and `SetupUninstallTest` deployed to HSCUSTOM (with the plain guard and the candidate) and run through the built `iris_execute_tests` handler: `completed total=7 passed=7 failed=0` and `total=12 passed=12 failed=0`; `Configure` ran at `$TLEVEL=0` under the runner.

**Decisions for the lead (the spec implements each recommendation; D1 blocks).**
- **D1 (Planner; owner #174 fallback, P3).** Guard R10: refuse when `$TLevel > 0` **and** `%request` is an object, which is `iris_sql_query`'s SELECT (and capped DML), never the bootstrap (`$TLEVEL` 0), IPM (no `%request`) or a terminal. Alternatives: R2, an IPM flag set by `InstallGuard.Check` at Initialize (a process-private global that outlives the install); R3, IPM invokes new non-`SqlProc` wrappers (a `module.xml` change, which turns CI's `gen:ipm:check` red until the version step, see D5). No pinned contract changes beyond the owner-sanctioned refusal: names, signatures, return types and the five stay; outside a web request inside a transaction the methods behave as today.
- **D2.** DW-773 changes no `SqlProc` contract: `IsConfigured` still returns `%Boolean` `1` iff the web app is registered; only an account that cannot read `%SYS` now gets the true answer instead of `0`. Decision #165's revert condition ("restore the `unconfigured` refusal once the probe can tell") is now met; recommendation: decide it in 45.7 (TypeScript), not here.
- **D3.** Harvest the `deferred` finding as a new entry, `routed owner=45-7-epic-45-burn-down-typescript-and-docs`: the fix is a fallback to the unfiltered `docnames` list or the per-document `upd` (P5). 45.6's README states the remaining warning.
- **D4.** DW-780 reads the Planner's "per namespace" as the namespace's own record flag (pure decision logic, a few lines; no probe needed). Trade-off: a namespace with no record and a user's `^UnitTestRoot` is now reported `Left:` with the command (never removed); the 1.2.0-set value in a namespace a later install recorded stays unmentioned and the README keeps that residual.
- **D5.** Close DW-774 by decision (`wontfix-accepted`, `reopen_if=` a field report that `zpm uninstall` alone was expected to remove the web application, or an IPM hook scoped to one namespace): `Setup.Uninstall()` is instance-wide (the one web application and `%ALL` mapping, other namespaces' bootstrapped copies), while `zpm uninstall` removes one namespace's module; a `module.xml` change makes `pnpm gen:ipm:check` (CI `gates`) red until the version step because `ipmTreeProblems` holds the committed manifest equal to the current render; the documented order (one-liner, then `zpm uninstall`) is complete.
- **D6.** Sanctions (AD-15): `S-45.6-setup-transaction-guard` (owner #174), `S-45.6-isconfigured-lookup`, `S-45.6-database-fields` (a recorded correction: values of existing fields, create/modify now apply them), `S-45.6-uninstall-report-text`. DW-787 changes no behavior in an interoperability namespace and needs none.
- **D7.** Changeset `minor` for the six packages (decision #160: one `1.3.0`; the story ships behavior changes).
- **Spine (Rule 20), proposed text for the lead:** AD-14 gains "`Configure` and `ConfigureMapping` refuse inside a transaction during a web request; `IsConfigured` falls back to the CSP application lookup; no bootstrapped class names an `Ens`/`EnsLib`/`HS` type at compile time"; AD-25 Read paths gains the guard; AD-31's residual sentence narrows to direct calls.

**Proposed `epics.md` amendments (the lead applies them).**
- **A1 (DW-786 bullet, pending D1).** Replace "`Configure` and `ConfigureMapping` refuse when called inside a transaction (`$TLEVEL>0`)." with "`Configure` and `ConfigureMapping` refuse when called inside a transaction during a web request (`$TLEVEL>0` and a `%request` object), which is how `iris_sql_query` runs a SELECT. IPM runs them inside its own transaction outside a web request (plan probe P3), so its install is not refused." and append to its probe bullet: "The IPM install's Configure phase runs at `$TLEVEL=1`."
- **A2 (DW-774 bullet).** After "This is a generator change only, because the stamped IPM tree still moves only at the version step (Rule #18)." insert "A generator change to `module.xml` also turns `pnpm gen:ipm:check` (CI) red until that step, because the check holds the committed manifest equal to the current render."
- **A3 (DW-765 bullet).** Replace "reports `resource` as empty for every database, because `Config.Databases` has no `Resource` property" with "reports `resource` empty, `readOnly` false and `globalJournalState` 0 for every database, because `Config.Databases` has none of these properties (they live on `SYS.Database`); create drops them and modify fails with `<PROPERTY DOES NOT EXIST>`".
- **A4 (DW-773 bullet).** Replace "With the install on, every connect recompiles and fails `Configure`." with "With the install on, every connect recompiles; on IRIS 2026.2 the compile check then names all 35 classes, because Atelier's filtered `docnames` list is empty for an account without SQL privileges, so `Configure` is never reached (plan probe P5)."

**Lead smoke (decision #166), on a throwaway.** Least-privilege leg: `lp` account as above with `IRIS_GOVERNANCE_PRESET=read-only`, then with the install on: probe `current`, zero write requests, no "could not confirm" line; `iris_sql_query` `SELECT ExecuteMCPv2.Setup_ConfigureMapping('<ns>')` → `SQLCODE -99`, nothing changes. Admin leg: the second AC with its mutation. Non-interop leg: a new namespace without interoperability installs 35/35. Database leg: list, create, modify, delete with read-back from `SYS.Database`.

## Verification

**Commands:**
- `pnpm run gen:bootstrap && git diff --stat packages/shared/src/bootstrap-classes.ts scripts/bootstrap-sequence.json` -- expected: one regen; `BOOTSTRAP_VERSION` `1.2.0+10.109d0129528f` → `1.2.0+11.<hash>`, recorded here.
- `pnpm build && pnpm test` -- expected: green; the new static pin runs in the default suite.
- `pnpm gen:governance-baseline:check && pnpm gen:ipm:check && pnpm gen:tools-list-snapshot:check` -- expected: OK (the IPM tree and tools list unchanged).
- Throwaway (52792): `node scripts/throwaway-iris.mjs exec --state <s> -- node scripts/ci-seed-throwaway.mjs`, then `... -- node scripts/ci-live-suite.mjs integration-dev`, `integration-admin`, and the `uninstall-round-trip` suite on its own container -- expected: green with the roster totals; `down` and the empty `docker ps` check after each.

**Manual checks:**
- `grep -n "\[ SqlProc \]" src/ExecuteMCPv2/Setup.cls` lists only the five methods; `git diff --stat` after each mutation restore is identical to before it.
- Shared surfaces: the `integration-dev` roster, the uninstall report lines, the README 45.5 section and its doc-claims pins, `BOOTSTRAP_VERSION`. Every test added or changed passes on a fresh environment, in either order.

**Results (2026-11-26, implement step; Rule 19).** `BOOTSTRAP_VERSION` `1.2.0+10.109d0129528f` → `1.2.0+11.6ef86aefc48e` (the sequence file was reset to the baseline before the final `pnpm run gen:bootstrap`, so the sequence is 11; a second run produces no diff). Every mutation edited the real source, ran `gen:bootstrap`, rebuilt the shared dist, and was restored by `cp` from scratchpad copies with `cmp` confirming `Setup.cls`, `bootstrap-classes.ts`, `bootstrap-sequence.json`, `Config.cls` and `Interop.cls` byte-identical. All containers were throwaways on 52792 (Health pinned digest, Community `IRIS_COMMUNITY_IMAGE`) or `--network none`, all removed.
- **IPM leg (DW-786 condition 2).** `node scripts/ci-ipm-archive.mjs --edition community` and `--edition health` (the script CI's `ipm` job runs): PASS on both. The module tree is staged from the NEW embed (`stageModule`, 36 classes, marker `1.2.0+11.6ef86aefc48e`) into a `mkdtemp` scratch directory, `package` builds the archive in a `--network none` container, and `load` installs it (Configure at `$TLEVEL=1`, no `%request`): configured, mapped, `GET` answers 200, 94/94 parity cases. The committed tree was never written (`pnpm gen:ipm:check` stays OK; the served leg installed `git archive HEAD`, the 1.2.0+5 release tree).
- **Mutation A** (drop the `%request` term, `If ($TLevel > 0) Quit ...`): `ci-ipm-archive --edition community` exits 1, `Configure FAILURE ... Configure changed nothing: it was called inside a transaction during a web request` (IPM path); `SetupTest.TestGuardPassesInTransactionWithoutWebRequest` red, 1 of 10 (`iris_execute_tests` on the Health throwaway).
- **Mutation B** (drop the `$TLEVEL` term, `If $IsObject($Get(%request)) Quit ...`): the real bootstrap into HSCUSTOM returns `configured: true, mapped: true, errors: []` but the web application, `%ALL` and the mapping are absent, because the bootstrap's `Setup_Configure` SELECT discards the returned status row (TypeScript, 45.7's area). The bootstrap leg is red in `pnpm live:uninstall-round-trip`: 17 failed, 1 passed of 18 (`packages/iris-mcp-all/src/__tests__/story-45-3-uninstall-round-trip-live-gate.test.ts`). `SetupTest` stays 10/10, because the `iris_execute_tests` job runs with no `%request`.
- **Guard deleted** (DW-786): after a fresh bootstrap and removal of `%ALL` and the mapping, the read-only `iris_sql_query` route (`/dev/sql/execute`, `readOnly:true`) `SELECT ExecuteMCPv2.Setup_ConfigureMapping('HSCUSTOM')` answers `1` and `iris.cpf` gains `%ALL=%DEFAULTDB` and `Package_ExecuteMCPv2=HSCUSTOM`. With the guard, the same call and `Setup_Configure('USER')` answer the refusal text, `iris.cpf` has no `%ALL` line, the web application stays in HSCUSTOM, `%ALL` and the mapping stay absent; Atelier `action/query` still returns `1` and restores the mapping; the route without `readOnly` runs the call as before. Fresh (`missing`), upgrade (`stale`, marker 10 over 11 with the web application, mapping and `%ALL` deleted) and self-heal (`unconfigured`) bootstraps all end configured and mapped.
- **DW-773.** As `lp456` (`%Development:U`, `RW` on HSCUSTOM): `Setup_IsConfigured()` `true`, the real bootstrap with the install on reads `current` and issues no PUT or compile (only the `Compile failed: 35 of 35` error of the deferred finding, DW-788), and 0 "could not confirm" lines. Mutation (fallback → `Set tResult = 0`, deployed through the bootstrap): `IsConfigured()` false, the probe reads `unconfigured` and logs `web application not registered — recompiling and running configuration steps`.
- **DW-780.** Mutation C1 (found-branch reverted): `SetupUninstallTest.TestDecideAll` red, 1 of 12 (`iris_execute_tests`), and `pnpm live:uninstall-round-trip` 2 failed, 17 passed of 19 (the two found-`%ALL` legs). Mutation C2 (caller back to `$Get(tAnyRecord)`): 1 failed, 18 passed (the new `^UnitTestRoot` leg). Final: 19 of 19 green.
- **DW-787.** Final embed into PLAIN (not interoperability-enabled) on Health and on Community: 35 of 35 compile, configured and mapped; `interop/production/status?namespace=HSCUSTOM` (Health) and `namespace=USER` (Community) answer 200 `Stopped`; `namespace=PLAIN` keeps today's `<CLASS DOES NOT EXIST>` envelope. Mutation (`pItem As Ens.Config.Item`): `bootstrap-no-interop-types.test.ts` 1 failed of 38 (the `Interop.cls` row), and the PLAIN bootstrap reports `Compile failed: 1 of 35 classes did not compile: ExecuteMCPv2.REST.Interop ... ERROR #5373`.
- **DW-765.** `integration-admin` on the Health throwaway: 32 of 32 green (the two new tests in `admin.integration.test.ts`: `USER` `%DB_USER`, `IRISLIB` `readOnly`, create with `resource` and `globalJournalState`, modify `resource`, delete in `finally`). Mutation (list back on `Config` props): 2 failed, 30 passed (`expected '' to be '%DB_USER'`). A least-privilege read (`%Development:U`, `%DB_HSCUSTOM:RW`, `%DB_IRISSYS:R`, `%DB_IRISLIB:R`) of `GET /config/database` returns the real `resource` (`%DB_IRISSYS`); without the two `R` grants it answers `<PROTECT>` (unchanged).
- **DW-778.** `ci-live-suite.mjs integration-dev` on the seeded Health throwaway: 36 tests passed, the two new rows (`SetupTest` 10, `SetupUninstallTest` 12). Mutation (`DecideRecords` flipped, deployed): the `SetupUninstallTest` row red (`expected 11 to be 12`).
- **Counts.** `@iris-mcp/shared` 98 files, 2941 passed; `@iris-mcp/dev` 84 files, 1578 passed, 344 skipped; `@iris-mcp/admin` 36 files, 518 passed, 8 skipped; the five touched `iris-mcp-all` doc and gate files 136 passed, 5 skipped (the full `@iris-mcp/all` suite is the lead's run). Lint, type-check, `check:live-guards` (79 armed files, 0 findings), `gen:governance-baseline:check`, `gen:ipm:check`, `gen:tools-list-snapshot:check` (115 entries) and `check-epics-sync.mjs`: green.

**Mutation lines (Rule 19; each restored by `cp` and checked with `cmp`, `gen:bootstrap` idempotent after).**
- mutation: drop the `%request` term of the guard (Mutation A) → `ci-ipm-archive --edition community` exits 1 and `SetupTest.TestGuardPassesInTransactionWithoutWebRequest` is red (1 of 10).
- mutation: drop the `$TLEVEL` term of the guard (Mutation B) → `story-45-3-uninstall-round-trip-live-gate.test.ts`, the bootstrap legs: 17 failed of 18.
- mutation: both guards → `If 0` (regen, `1.2.0+12.c391177a30cc`) → `story-45-3-uninstall-round-trip-live-gate.test.ts` leg "DW-786: SELECT ExecuteMCPv2.Setup_ConfigureMapping and Setup_Configure through the built server's iris_sql_query ...": 1 failed, 19 passed of 20.
- mutation: both guards → `If 0`, deployed to a throwaway → `SetupTest.TestGuardRefusesInTransactionDuringWebRequest` red (the run aborts with `<CLASS DOES NOT EXIST>` after the unguarded `Configure` moved the web application).
- mutation: `IsConfigured` fallback → `Set tResult = 0` (regen, `1.2.0+13.4507f03b77a0`) → the leg "least privilege: an account without %Admin_Manage refuses cleanly ...": 1 failed, 20 passed of 21.
- mutation: found-`%ALL` branch of `DecideAll` reverted → `SetupUninstallTest.TestDecideAll` (1 of 12) and the two found-`%ALL` legs of the round-trip gate (2 failed of 19).
- mutation: `DecideUnitTestRoot` caller back to `$Get(tAnyRecord)` → the "^UnitTestRoot in a namespace with no record of its own" leg: 1 failed of 19.
- mutation: `pItem As Ens.Config.Item` → `bootstrap-no-interop-types.test.ts` (1 of 38, the `Interop.cls` row), and, in the live gate, the leg "DW-787: the real bootstrap into a namespace that is not interoperability-enabled ...": 1 failed, 20 passed of 21 (regen `1.2.0+12.a085e88e011f`).
- mutation: list back on `Config.Databases` props → `admin.integration.test.ts`: 2 failed of 32; and `ApplyRuntimeProps` without the `ReadOnly` line (deployed to a throwaway) → "create applied readOnly": 1 failed, 31 passed of 32.
- mutation: `DecideRecords` flipped → the `SetupUninstallTest` row of `custom-rest.integration.test.ts` (11 vs 12).
- Code review (each restored by `cp` and checked with `cmp`; `gen:bootstrap` a no-op at `1.2.0+12.bd38d590c26e` after):
- mutation: `IsConfigured` back to the build's shape (fallback only in the `Catch`), with M2–M4 below in one build (`1.2.0+14.94d472382de1`), full gate on a USER throwaway → 5 failed, 18 passed of 23, each red leg its own mutation's: least privilege (`lp2 … expected configured '0' to be '1'`).
- mutation (M2): `ConfigureMapping` does its work and then returns the refusal text → the real-route DW-786 leg; re-run alone with the `iris.cpf` check first: `iris.cpf still holds no %ALL line: expected 2 to be 0`.
- mutation (M3): `pItem As Ens.Config.Item` → the DW-787 leg: `the bootstrap registered the web application: expected '0' to be '1'` (AC 5's second half).
- mutation (M4): the no-record reason `$Select` flipped (`Setup.cls` L369) → the no-record leg (AC 45.6.2's byte-identical lines) and the `^UnitTestRoot`-without-own-record leg.
- mutation (Mutation B on the new leg): guard without the `$TLEVEL` term (`1.2.0+13.869751f0df84`) → the upgrade and self-heal leg is red (the seed's own Atelier `Setup_Configure` is refused first: "did not register the web application").
- mutation (M5): `If 'tResult Set tResult = 0` (`1.2.0+13.373a1b0c09fb`, seeded HSCUSTOM throwaway) → `epic45-capstone-gate.test.ts` LP-armed start leg: 1 failed of 21 (one could-not-confirm line).
- mutation (M6, same build): `ConfigureMapping` guard removed → `SetupTest` row 9 of 10; `DebugRunTestCase` shows `inside the transaction a refused call left the install record of USER as it was` red, with the refusal and mapping assertions; `the mapping is put back` passed.
- mutation (M7a, same build): `CreateDatabase` argument 5 dropped → `admin.integration.test.ts` "applies resource…": `create applied the resource: expected '%DB_%DEFAULT' to be '%DB_USER'`.
- mutation (M7c): argument 6 dropped (`1.2.0+14.3ac5588d02be`) → `create applied the journal state: expected 3 to be 2`.
- mutation (M7b): `ApplyRuntimeProps`' `ResourceName` line dropped (`1.2.0+15.f2b6947a0c52`) → `modify applied the resource: expected '%DB_USER' to be '%DB_IRISLIB'`.
- mutation: `IsConfigured` back to the build's shape (`gen:bootstrap` only) → `qa-45-6-doc-oracles.test.ts` source pin red; the old 45.2 CHANGELOG sentence restored → the consistency pin red (2 failed of 7).
- not falsifiable (DW-789): the namespace restores in `IsConfigured` removed, `%ALL` mapping deleted → both least-privilege accounts still read 1 on a throwaway; the restore is defensive, pinned by the source pin.

**Code review pass (2026-11-26).** `BOOTSTRAP_VERSION` `1.2.0+11.6ef86aefc48e` → `1.2.0+12.bd38d590c26e` (one regen from the committed sequence; a second regen is a no-op), so the story moves it `1.2.0+10.109d0129528f` → `1.2.0+12.bd38d590c26e`. Live (all throwaways on 52792, each removed, `docker ps -a --filter label=iris-mcp.owner=throwaway` empty after): `pnpm live:uninstall-round-trip` 23/23; seeded HSCUSTOM: `epic45-capstone-gate.test.ts` armed 21/21, `integration-dev` 36/36 (SetupTest 10, SetupUninstallTest 12), `integration-admin` 33/33.

**Review pass (2026-11-26).** Added after the four review layers: the real-route DW-786 leg, the least-privilege `IsConfigured` assertions and the non-interop bootstrap leg in `story-45-3-uninstall-round-trip-live-gate.test.ts` (now 21 tests); `SetupTest.TestGuardRefusesInTransactionDuringWebRequest` rewritten to read inside the transaction (`SetupTest` stays 10 tests, 10 of 10 on the Health throwaway, `integration-dev` 36 of 36); `admin.integration.test.ts` readOnly and journal legs (`integration-admin` 32 of 32); the static pin widened; the `story-45-2-doc-claims.test.ts` needle that quoted the old least-privilege sentence now quotes the 1.3.0 text. `pnpm live:uninstall-round-trip` 21 of 21. Full `@iris-mcp/all` suite (closed port, after the last source change that the default suite can see): 255 files, 6742 passed, 763 skipped, 0 failed. `@iris-mcp/shared` 98 files, 2941 passed. Lint, type-check, `check:live-guards` (79 armed files, 0 findings), `gen:governance-baseline:check`, `gen:ipm:check`, `gen:tools-list-snapshot:check` (115 entries) and `check-epics-sync.mjs` green after the last edit. The one file edited after the full suite's final start, the round-trip gate test, is live-gated (it skips in the closed-port run) and was run through its own armed runs above; its six-file doc-and-gate subset was re-run unarmed afterwards (103 passed, 21 skipped).

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** Seven ledger entries, each ending terminal: DW-786, DW-773, DW-787, DW-765, DW-780 and DW-778 resolved, DW-774 closed by decision. `BOOTSTRAP_VERSION` `1.2.0+10.109d0129528f` → `1.2.0+11.6ef86aefc48e` (one move; a second `gen:bootstrap` is a no-op). Disposition table counted mechanically: 6 `resolved`, 1 `closed by decision`. Changeset `minor`. The SqlProc set is still the five.

**Files changed.** `src/ExecuteMCPv2/Setup.cls` (guard R10 in `Configure` and `ConfigureMapping`, `WebAppRegistered` and the `IsConfigured` fallback, found-`%ALL` reason and command, per-namespace `^UnitTestRoot` decision); `src/ExecuteMCPv2/REST/Config.cls` (`resource`, `readOnly`, `globalJournalState` read and written on `SYS.Database`); `src/ExecuteMCPv2/REST/Interop.cls` (`pItem As %RegisteredObject`); `src/ExecuteMCPv2/Tests/SetupTest.cls` and `SetupUninstallTest.cls`; `packages/shared/src/bootstrap-classes.ts` and `scripts/bootstrap-sequence.json` (generated); new `packages/shared/src/__tests__/bootstrap-no-interop-types.test.ts`; `packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts` (roster rows 10 and 12); `packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts`; `packages/iris-mcp-all/src/__tests__/` `story-45-3-uninstall-round-trip-live-gate`, `story-45-2-doc-claims`, `story-45-3-doc-claims`, `story-45-5-doc-claims`, `qa-45-5-doc-oracles`; `README.md`, `CHANGELOG.md`, `.changeset/story-45-6-epic-45-burn-down-iris-side.md`; this spec.

**Review findings.** 30 findings: 0 high, 7 medium, 17 low, 5 false, 1 maybe-false. Patched: 7 medium (route leg, least-privilege leg, readOnly and journal tests, the unit test that could not fail, the live non-interop leg, and two rows sharing those root causes) and 3 low (regex, mutation lines, `Include` case). Deferred: 1 (the `IsConfigured` `Catch` namespace, medium unverified). Rejected: 14 low and 5 false, each with its reason in the Review Triage Log.

**Follow-up review recommended: true.** Two or more medium entries were patched (7, all test-side). The unverified risk: the new live legs and the rewritten `SetupTest` test were written after the first review and have had no second adversarial read; they were proven by an armed run plus a mutation each.

**Verification.** See `## Verification` (Results, Mutation lines, Review pass). IPM leg: `ci-ipm-archive` passes on both editions with the NEW classes staged into a scratch directory (the committed tree is never written). 1.3.0 release rehearsal: it does NOT install through IPM from the freshly stamped tree itself; `scripts/release.mjs` only checks the tree's marker, the IPM channel is a manual step, and the install proof is CI's `ipm` job, which installs `git archive` of the checked-out commit, so it covers the stamped tree on the first CI run after the version step (the release requires that green run).

**Residual risks.** A direct Atelier `action/query` call is not a web request inside a transaction and is not refused (documented: the account's privileges are the boundary). An IPM install started through a web call (for example `iris_execute_command`) is refused by the guard. The bootstrap's TypeScript discards the status row `Setup_Configure` and `Setup_ConfigureMapping` return, so a refused or failed call reports `configured: true` (Story 45.7). DW-788, the compile-check warning for a least-privilege account, is not fixed and is documented as such.
