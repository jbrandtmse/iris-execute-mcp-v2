---
title: 'Story 45.6: Epic 45 Burn-down, IRIS Side'
type: 'bugfix'
created: '2026-11-26'
status: 'blocked'
review_loop_iteration: 0
followup_review_recommended: false
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

## Spec Change Log

## Review Triage Log

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

## Auto Run Result

Status: blocked
Blocking condition: intent gap. Owner decision #174's fallback fired: plan probe P3 shows IPM's install runs `Configure` and `ConfigureMapping` at `$TLEVEL=1`, so the ruled guard (`$TLEVEL>0`) would fail every IPM install (reproduced: `Configure FAILURE`). The two conditions the owner named both hold (bootstrap at 0, `iris_sql_query` at 1). The plan recommends guard R10 (`$TLEVEL>0` and a `%request` object), proven end to end in P4; the Planner rules (D1). Every other entry is planned and probed. On acceptance the lead applies A1, sets `status: ready-for-dev`, and dispatches.
