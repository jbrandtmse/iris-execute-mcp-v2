---
title: 'Story 44.7: Epic 44 Burn-down'
type: 'bugfix'
created: '2026-11-23'
status: 'ready-for-dev'
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

**Problem:** Epic 44 left nine ledger entries with the burn-down owner. Each one needs a terminal disposition: resolved, closed with evidence, or closed by decision. The defects are: three DocDB tool defects (DW-723/724/725), a client-config dead end (DW-747), the Story 44.4 compile-check root cause in three dev tools (DW-754/755/756), a database delete that leaves the database mounted (DW-757), and 12 armed tests that cannot fail (DW-758).

**Approach:** Every entry was probed live on a throwaway on 2026-11-23 (Design Notes). Fix each defect that the probe confirmed, in the tool that has it. Close DW-756 with evidence, because the probe refuted it. Pin everything the entries do not name.

## Boundaries & Constraints

**Always:**
- Each entry ends with one disposition from the Design Notes table. The tally is counted mechanically (Rule #51).
- Every "resolved" code fix is proven live on a throwaway or mutation-verified, on the path it guards (Rules #48, #59). Each pinning test gets a `mutation:` line in `## Verification` (Rule 19).
- Reuse `verifyCompiled` from `@iris-mcp/shared`. Do not copy its SQL or its docnames logic.
- Every description or schema change is a Frozen goldens entry in `fixtures/sdk-golden-sanctioned-changes.json`, followed by `pnpm gen:tools-list-snapshot`, and is named in `CHANGELOG.md` with its sanction id (AD-15).
- The `Config.cls` change regenerates the embed with `pnpm run gen:bootstrap`. Record `BOOTSTRAP_VERSION` from `1.1.0+3.3e97060f5bc4` to `1.1.0+4.<hash>` (Rule #24).
- New or changed armed tests assert their outcome unconditionally and pass `pnpm check:live-guards`. They create and remove their own state.
- IRIS writes go only to a throwaway (`node scripts/throwaway-iris.mjs … --host-port 52792`), using disposable `ExecuteMCPv2.Temp.*` classes, DocDB names without underscores, and the `P747`/`QaStory447` prefixes.

**Never:**
- Add a new tool, action, governance key or refusal code. Tool, action and key counts stay the same. `GOVERNANCE_BASELINE` is checked with `:check` only.
- Make a refused client-config verb write anything. AD-30 says a refused verb writes nothing, legacy files included.
- Delete a database's `IRIS.DAT` or directory from `iris_database_manage`.
- Touch the shared IRIS (localhost:52773), run `gen:ipm`, run the bare governance generator, run `pnpm run version`, or publish.
- Edit the frozen golden JSONs, `bootstrap-classes.ts` by hand, `.claude/rules/*`, `irislib/` or `irissys/`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| docdb create, no path | `iris_docdb_property create` with `property: "category"` | `POST …/prop/<db>/category?type=<enc>&path=%24.category`. A document saved afterwards matches `find category = …` | IRIS errors as today |
| docdb create, path given | `path: "$.address.city"` | `&path=` carries `encodeURIComponent(path)` | -- |
| docdb index, existing | `index` on an existing property | One `GET …/prop/<db>/<p>`, no write. Result is the definition plus `indexed: true` and `created: false` | -- |
| docdb index, missing | `index` on a property that does not exist (GET answers #25541) | `POST …/prop/<db>/<p>?path=<enc>` with body `{ index: true }`. Result is the definition plus `indexed: true` and `created: true` | -- |
| docdb index, system name | `property` starts with `%` | isError: DocDB REST cannot index a system property. No request is sent | -- |
| docdb index, other GET error | the GET fails, e.g. with 822 | The same catch path as today, so the 822 translation still applies | unchanged |
| doc compile, partial failure | `[Bad.cls, Persistent.cls]`; HTTP 200 with no status error | `success: false`. `errors` names Bad, `document: "Bad.cls"`. Persistent is not named | -- |
| doc compile, wildcard | `doc: "Pkg.P*.cls"` | The pattern is expanded through `docnames` and the matches are checked | no match: nothing checked |
| doc compile, check fails | the check's own request throws | `success: false`, error `{document:"*", error:"the check that every class compiled could not run: …"}` | isError stays false |
| doc compile, clean / async / status error | -- | Result unchanged. The clean path adds the 2 check requests. Async sends no check. A status error still throws | unchanged |
| doc load compile | a load with a Storage-written partial failure | `compilationResult.success: false`, and `errors` names the failed class | -- |
| env-promote execute | the batch compile has a Storage-written partial failure | The first unconfirmed class step is `failed` with `compile error: …`, and later steps are `skipped` | check fails: the first step fails, the rest are skipped |
| database delete | an unused database | Config entry removed, the directory dismounted, `IRIS.DAT` kept. Reply `{"action":"deleted","name":…,"dismounted":true}` | -- |
| database delete, shared directory | another config entry names the same directory | Config entry removed, no dismount. Reply has `dismounted: false` and `dismountNote` | -- |
| database delete, in use / missing | in use by a namespace (#429), or no such name | Today's error envelope, byte-identical. Nothing changes | unchanged |
| doctor check 7 | a vscode project legacy entry whose shared `.mcp.json` entry Claude Code owns | The finding names a by-hand delete of the entry from the old file. The servers Claude Code does not own keep today's `apply` finding | unchanged otherwise |

</intent-contract>

## Code Map

- `packages/iris-data-mcp/src/tools/docdb.ts` -- `docdbManageTool` description `:393-402`. DW-725: the false clause is at `:396`. `docdbPropertyTool` is at `:835-950`: the schema at `:846-860`, `create` at `:883-912`, and `index` at `:915-918`, which POSTs `{ index: true }` and so re-creates the property. Reuse `hasErrorCode` (`:189`), `extractResult`/`toStructured` (`:132`, `:149`), `translateDocDbAccessDenied` (`:243`), and the existing `IRIS_ERROR_CODE_*` constants (`:171-177`). Add `25541` next to them.
- `irislib/%DocDB/Database.cls:384-478` -- `%CreateProperty`. A non-empty expression makes the property `SqlComputed` from `%Doc`; with none, the property is never populated. Every created property gets an index named after it (`findKey`/`createIndex`). `irislib/%Api/DocDB/v1.cls:355-374` -- `httpPostProperty` reads `type`, `path` and `unique` from the query. There is no route that only adds an index.
- `packages/iris-data-mcp/src/__tests__/docdb-register.test.ts:68-125` -- the AC 44.1.7 request-list pins. The `iris_docdb_property` create and index rows change, as sanctioned. Every other row stays.
- `packages/iris-data-mcp/src/__tests__/docdb.test.ts` (around `:530-630`, `:1100-1170`) -- the property unit tests to update.
- `packages/iris-data-mcp/src/__tests__/data.integration.test.ts:133-157, 232-245` -- the armed lifecycle. Step 3 indexes the missing `label`. Step 7's find asserts no match.
- `packages/iris-dev-mcp/src/tools/compile.ts:79-186` -- sync result parsing. It reads `result.content[].errors`, which IRIS never sends.
- `packages/iris-dev-mcp/src/tools/load.ts:596-641` -- `compilationResult`.
- `packages/iris-dev-mcp/src/tools/env-promote.ts:973-1009` -- `runDocumentsBatch` compile and the step verdicts.
- `packages/iris-dev-mcp/src/tools/format.ts:262-330` -- XML import with compile. No change (DW-756 is closed with evidence).
- `packages/shared/src/bootstrap.ts:496-536` -- `verifyCompiled(http, namespace, version, names)`. It takes `.cls` names only and throws on any other name. It returns the unconfirmed names in input order. It is exported from `packages/shared/src/index.ts:126`.
- `packages/iris-dev-mcp/src/__tests__/storage-guard-write-paths-live-gate.test.ts:420-470` -- the pattern for driving `iris_env_promote` live with two clients of one instance (`promoteCtx`, `documentsDiff`, `execute`).
- `packages/iris-dev-mcp/src/__tests__/live-doc-helpers.ts` -- `compileDocs`, plus the disposable-class helpers the dev live gates use.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs:79-120` -- `gateTestFiles`, the roster that a new dev live gate joins.
- `packages/iris-dev-mcp/src/__tests__/custom-rest.integration.test.ts:325-338` -- the `it.each` roster of IRIS-side test classes, with their counts.
- `src/ExecuteMCPv2/REST/Config.cls:436-443` -- the `delete` branch, which only calls `Config.Databases.Delete`. `create` (`:330-385`) builds `IRIS.DAT` with `SYS.Database.CreateDatabase`. `Monitor.cls:828` shows `SYS.Database.DismountDatabase` in use.
- `packages/iris-admin-mcp/src/tools/database.ts:20-30` -- the `iris_database_manage` description.
- `packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts:175-184` -- `testDatabaseDirectory`, a fixed `mcpadmintestdata` directory. Weak tests are at `:488-505` and `:529-540`.
- `packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts:176-182, 230-305, 450-476` -- the weak tests, plus the config-item test at `:230`.
- `packages/client-config/src/cli/clients.ts:1840-1880` -- doctor check 7. The `fix` text names `apply` unconditionally.
- `packages/client-config/src/engine.ts:248-302` -- `notOwnerRefusal` and `sharedWriteVerdict`. This is the one place that decides ownership. `shared-files.ts:120-142` is `fileOwner`. `status.ts:54-72` is `LegacyFileStatus`.
- `packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json` -- the templates are the `42.11/storage-guard-schema/*` entries (schema `properties` replace) and `44.1/docdb-manage-text/*`. `fixtures/tools-list-snapshot.json` is generated by `pnpm gen:tools-list-snapshot`.
- `scripts/check-live-guards.mjs` -- the Story 44.5 guard check.

## Tasks & Acceptance

**Execution (suggested order, one story):**
1. `packages/iris-interop-mcp/src/__tests__/interop.integration.test.ts`, `packages/iris-admin-mcp/src/__tests__/admin.integration.test.ts` -- DW-758. Make each of the 13 tests assert the probed outcome (Design Notes, DW-758 table): `isError` falsy plus a structured field, or the documented error. The auto-start test reads the original value, sets it to the test production, checks the change, restores the original, and checks the restore.
2. `packages/iris-data-mcp/src/tools/docdb.ts` -- DW-723/724/725:
   - add an optional `path` (string, min 1) to the `iris_docdb_property` schema;
   - `create` sends `&path=<encodeURIComponent(path ?? "$."+property)>`;
   - `index` works as the matrix says;
   - correct both descriptions (exact claims in the Design Notes).
   Update `docdb.test.ts` and the AC 44.1.7 pins in `docdb-register.test.ts`. Change only the property create and index rows.
3. `packages/iris-data-mcp/src/__tests__/data.integration.test.ts` -- step 3 indexes the existing `category` and asserts `created: false`, `indexed: true`. Add a leg that indexes a missing property and asserts `created: true`, then reads it back with a GET. Step 7's find asserts that the inserted document matches `category = test`.
4. `packages/iris-dev-mcp/src/tools/compile.ts`, `load.ts`, `env-promote.ts` -- DW-754/755:
   - after a sync compile that IRIS answered without a status error, call `verifyCompiled` on the class documents;
   - in `compile.ts`, first expand wildcard names (`*`, `?`) through `docnames` (Design Notes);
   - map each unconfirmed class to the failure each tool already uses;
   - add unit tests whose fakes return the captured shapes (Rule #54).
5. `packages/iris-dev-mcp/src/__tests__/compile-check-live-gate.test.ts` (new; add it to `gateTestFiles`) -- the legs are:
   - `iris_doc_compile` with a partial failure, and with a wildcard;
   - a clean compile, which is unchanged;
   - `iris_doc_load` with `compile: true`;
   - `iris_env_promote` execute;
   - the DW-756 evidence pin: an XML import with `compile: true` whose per-file status names the failing class.
   It writes only `ExecuteMCPv2.Temp.QaStory447*` and removes them before and after the run.
6. `src/ExecuteMCPv2/REST/Config.cls` -- DW-757. In `delete`:
   - read the directory (`Config.Databases.Get`) before `Delete`;
   - on success, dismount it with `SYS.Database.DismountDatabase` unless another `Config.Databases` entry names the same normalized directory;
   - add `dismounted` and, when it applies, `dismountNote` to the reply;
   - keep every error path byte-identical.
   Put the logic in a class method that a test can call. Then run `pnpm run gen:bootstrap` and record the version.
7. `src/ExecuteMCPv2/Tests/DatabaseDeleteTest.cls` (new, not bootstrapped) -- uses a disposable `P747DBT` database. The tests:
   - after delete, the directory is dismounted (`SYS.Database` `Mounted = 0`) and `IRIS.DAT` still exists;
   - a shared directory is not dismounted;
   - an in-use delete changes nothing.
   Cleanup uses `SYS.Database.DeleteDatabase`. Add the class and its count to the `custom-rest.integration.test.ts` roster.
8. `packages/iris-admin-mcp/src/tools/database.ts` and `src/__tests__/database.test.ts` -- correct the description, and pin that the additive reply fields pass through. In `admin.integration.test.ts`, assert that delete answers `dismounted: true`, and give `testDatabaseDirectory` a per-run unique leaf so that a second run on the same instance can create.
9. `packages/client-config/src/cli/clients.ts` -- DW-747. Check 7 splits each project-scope legacy file's servers by the engine's shared-file verdict (`sharedWriteVerdict`, or a name-only variant in `engine.ts` that reuses `notOwnerRefusal`):
   - refused servers get a by-hand-delete finding;
   - the others keep today's `apply` finding, byte-identical.
   Add tests to `vscode-copilot-targets.test.ts`.
10. `packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json`, `fixtures/tools-list-snapshot.json` -- add the sanctioned entries for every golden row that holds a changed description or `iris_docdb_property` `properties` (sanctions `S-44.7-docdb-property`, `S-44.7-docdb-manage-text`, `S-44.7-database-delete`). Then run `pnpm gen:tools-list-snapshot`.
11. Docs and release notes:
   - update `packages/iris-data-mcp/README.md` (`:145-148`, the property examples `:352-385`), `packages/iris-admin-mcp/README.md` (`:141`, `:311` section), `packages/iris-dev-mcp/README.md` (`:150`, `:163`) and `packages/client-config/README.md` (`:93`);
   - add the `CHANGELOG.md` section "Story 44.7: Epic 44 Burn-down", naming the three sanction ids;
   - add `.changeset/story-44-7-epic-44-burn-down.md` (patch: data, dev, admin, shared, client-config);
   - update any test that pins the changed README text (search `iris-mcp-all` for it, e.g. `story-44-1-doc-claims.test.ts`).

**Acceptance Criteria:**
- AC 44.7.1: Given the nine chartered entries, when the story closes, then the Design Notes disposition table gives each one exactly one terminal disposition, and the stated tally equals the mechanical count of the table's Disposition column (the command is in Verification). After the lead mirrors the table into the ledger, `LEDGER slice 44-7-epic-44-burn-down` reads empty.
- AC 44.7.2: Given the pre-story behaviour, when the default suite runs, then these pins hold with `toEqual` assertions against pre-story captures, and each fails on drift:
  - every DocDB request list and result other than `iris_docdb_property` create/index;
  - `iris_doc_compile` async mode (no check request) and the status-error throw;
  - `iris_doc_load` with `compile: false`, plus the clean `compilationResult`;
  - the clean `iris_env_promote` execute result;
  - the whole `iris_doc_xml_export` import request and result;
  - `iris_database_manage` create, modify and every delete error;
  - doctor check 7 when no server is refused;
  - client-config `apply`/`remove` refusals.
  `pnpm gen:governance-baseline:check` passes, and the tool, action and key counts are unchanged.
- AC DW-723: Given a DocDB database on a throwaway where `category` exists, when the armed lifecycle calls `iris_docdb_property index` for `category`, then the reply is not an error, carries `indexed: true, created: false`, and the tool made no POST. Given a missing property, `index` creates it and the reply carries `created: true`.
- AC DW-724: Given a property created by `iris_docdb_property create` without `path`, when a document is inserted and `iris_docdb_find` filters on that property, then the document is returned (live, armed lifecycle).
- AC DW-725: Given `tools/list`, when the data server lists `iris_docdb_manage`, then its description no longer claims `create` takes property definitions. The tools-list snapshot and the golden-ledger tests are green.
- AC DW-754: Given a throwaway, when `iris_doc_compile` compiles a class that fails together with a persistent class whose Storage the compile writes, then `success` is `false` and `errors` names exactly the failing class. The same holds when the list is a wildcard that matches both.
- AC DW-755: Given the same pair, when `iris_doc_load` loads them with `compile: true`, then `compilationResult.success` is `false` and names the failing class. When `iris_env_promote` executes them, the failing class's step is `failed` and no later step is `completed`.
- AC DW-756: Given an XML import with `compile: true` of a failing class plus a Storage-written class, when the live gate runs it, then the reply carries a "Per-file status" block that names the failing class (the evidence for closing the entry).
- AC DW-757: Given a disposable database on a throwaway, when `iris_database_manage delete` removes it, then `DatabaseDeleteTest` observes the directory dismounted with `IRIS.DAT` kept, and the reply carries `dismounted: true`. A database in use by a namespace is refused unchanged.
- AC DW-747: Given a project whose shared `.mcp.json` entry `iris-dev-mcp` Claude Code owns and whose `.vscode/mcp.json` still holds `iris-dev-mcp`, when `doctor` runs, then the `vscode-local-harness-entries` finding for that server names deleting the entry from the old file by hand, and it does not name `apply --client vscode`. No refused verb writes any file.
- AC DW-758: Given the armed admin and interop suites on a CI-image throwaway, when they run, then each of the 13 tests asserts `isError` and a structured outcome or the documented error. The weak-assertion scan (Verification) reports `hits=0`.

- DW-759 *(lead, spec gate, decision #151; was this plan's `deferred:` item)*: a failed routine in a compile that also writes a class's Storage reads as success in `iris_doc_compile`, `iris_doc_load` and `iris_env_promote`. Probe on the throwaway (a broken `ExecuteMCPv2.Temp` routine compiled together with a Storage-writing class) for an oracle that reads no console text (Rule #13). Candidates: the routine's `.obj`/`.int` generation state through an existing Atelier read, or `%Library.RoutineMgr`. If one exists and needs no new route or bootstrapped method, resolve it through the same shared check path, pinned by a mutation. Otherwise close it by decision: state the limit in `packages/iris-dev-mcp/README.md` (the compile tools' section) and in the CHANGELOG, and record the probe capture. Either way the disposition is terminal and counts in the AC 44.7.1 tally (now 10 entries).

## Spec Change Log

- 2026-11-23 (lead, spec gate, decision #151): the plan's `deferred:` routines item is harvested as DW-759 and taken into this story (cap 12; Rule 17: `burndown` ownership does not survive the gate), with a terminal disposition required. The spine was amended at the gate: AD-15 gets the three `S-44.7-*` sanctions, and AD-14 "on failure" gets the compile check in the three dev tools.

## Review Triage Log

## Design Notes

**Disposition table (AC 44.7.1; the lead mirrors one trailer line per row, Rule 17).**

| Entry | Disposition | Why |
|---|---|---|
| DW-723 | resolved | Probe: `index` on an existing property gives #5805. DocDB indexes every property when it creates it, and its REST API has no index-only route, so `index` reads and never re-creates. |
| DW-724 | resolved | Probe: a property with no path is never populated, while `path=cat2`, `$.cat3` and `$.nested.k` all match. The default `$.<property>` fixes it. IRIS does not backfill documents saved before the property existed: by design, stated in the description. |
| DW-725 | resolved | A text correction (recorded-correction replace) through the Frozen goldens. |
| DW-747 | resolved | The doctor now names a path that works: a by-hand delete of the unused old-file copy, because Copilot reads the shared `.mcp.json` entry. Refused verbs keep writing nothing (AD-30), so the CLI write is closed by design. |
| DW-754 | resolved | Probe A/E: `success: true` while `verifyCompiled` names the failing class. Fixed with `verifyCompiled`. |
| DW-755 | resolved | Probe F: the load reports success the same way. `env-promote.ts:980-1001` reads the same field. Fixed with `verifyCompiled`. |
| DW-756 | closed-with-evidence | Probes G and H: the XML load's per-file status carries `ERROR #5475` naming the failing class whether or not Storage was written, so the failure never reads as success. With two failures it names only the first, but `iris_doc_compile` (DW-754) names them all. |
| DW-757 | resolved | Probe: delete leaves the directory mounted with no config entry; a second create fails #60. Delete now dismounts it. `IRIS.DAT` is kept by design: deleting it is irreversible data loss, and the tool has no confirmation gate. A create at the same directory then fails #78 until the file is removed. The description says so. |
| DW-758 | resolved | All 13 tests assert the probed outcome. Thirteen, not twelve: the scan also found `gets config item settings` (`interop:230`), which asserts only a precondition plus `toBeDefined` (Rule #56). |

Tally: 8 resolved, 1 closed-with-evidence, 0 closed-by-decision. Ledger mapping: resolved becomes `status=resolved-by:44-7-epic-44-burn-down`. Closed-with-evidence becomes `status=dropped note=closed-with-evidence: probe 2026-11-23 xml/load per-file status names the failure`. DW-758 gets the note "13 tests incl. config-item (interop:230)".

**Probe captures** (2026-11-23, `irishealth-community:2026.2@sha256:462de1fb…`, HSCUSTOM, port 52792, seeded with `ci-seed-throwaway.mjs`, removed afterwards; raw output in the scratchpad: `p758.out`, `pdocdb.out`, `pdocdb2.out`, `pcompile.out`, `pxml2.out`).
- **DocDB.**
  - A property created without `path` gives `find category=test` → `[]`.
  - `path=cat2`, `path=%24.cat3` (`encodeURIComponent("$.cat3")`; IRIS decodes it) and `path=%24.nested.k` all match. A literal `$.c` also works.
  - A document inserted before the property is not returned until it is re-saved.
  - `GET …/prop/<db>/missingprop` gives HTTP 400 `ERROR #25541: DocDB Property 'missingprop' does not exist`. `find` on an unknown property gives 400 #25541.
  - POSTing the existing `cat3` with `{index:true}` gives 400 `ERROR #5805: ID key not unique for extent '%Dictionary.PropertyDefinition'`.
  - `%Dictionary.CompiledIndex` holds `IDKEY` (`%DocumentId`), one index per created property (`a`, `b`), and a `_Unique` index for `unique=1`. `%Doc` has none.
  - `GET …/db/<db>` answers `{"content":{"Name","Class":"ISC.DM.<db>","properties":[…]}}`.
- **Compile.**
  - (A) `[X fails, P persistent]` gives HTTP 200 and tool `success: true`; `verifyCompiled` gives `["…P747X.cls"]`.
  - (B) X alone gives `IrisApiError` 200 #5475, which the tool throws.
  - (C) A clean compile gives `success: true`, `verifyCompiled` → `[]`.
  - (D) `"ExecuteMCPv2.Temp.P747*.cls"` is accepted by `action/compile` and expanded by IRIS.
  - (E) `[X, P2, OK]` gives `success: true`.
  - (F) `iris_doc_load` compile gives `compilationResult.success: true`; `verifyCompiled` gives `["…P747LX.cls"]`.
  - (G) XML import `[XX fails, XP Storage]` gives per-file `status` "ERROR #5475 … P747XX". (H) XX alone gives the same.
  - With two failing classes plus a Storage class, the status names only XA, while `verifyCompiled` gives `[XA, XB]`.
- **Database.**
  - After create then delete: `config=0 sysdb=1 mounted=1 irisdat=1`. A second create gives `ERROR #60: the database must be dismounted`.
  - After `DismountDatabase`: `mounted=0`. A create at the same directory gives `ERROR #78: File already exists`.
  - `SYS.Database.DeleteDatabase` after the config delete leaves `sysdb=0 irisdat=0` and keeps the directory, and a re-create then succeeds.
  - `Config.Databases.Delete("USER")` gives `ERROR #429: Cannot delete database USER, in use by the following namespaces: USER`.
- **DW-758 outcomes** (the tool replies on the CI image):

| # | Test (file:line) | Reply | Assert |
|---|---|---|---|
| 1 | interop:176 status after create | `{name:"",state:"Stopped",stateCode:2}` | isError falsy; `state` is a string |
| 2 | interop:247 autostart get | `{action:"get",autoStart:"",enabled:false}` | isError falsy; `autoStart` string, `enabled` boolean |
| 3 | interop:256 autostart set | set gives `{autoStart:<prod>,enabled:true}`; the test's `enabled:false` is not a tool field | set to the test production, check it, restore the original, check the restore |
| 4-5 | interop:278/288 logs | `{entries:[{type:4,…}]}` | isError falsy; `entries` array; with `type:"Info"` every `type === 4` |
| 6 | interop:301 queues | `{queues:[…],count:3}` | isError falsy; `count === queues.length` |
| 7 | interop:450 rules | `{rules:[],count:0,total:0}` | isError falsy; `rules` array |
| 8 | interop:457 transforms | `{transforms:[…]}` | isError falsy; `transforms` array |
| 9 | interop:468 trace sessionId 1 | `{messages:[{sessionId:1,…}],count:1}` | isError falsy; every message has `sessionId === 1` |
| 10 | admin:488 validate | `{valid:true,policy:{…}}` | isError falsy; `valid === true` |
| 11 | admin:497 weak `a` | `{valid:false,message:"ERROR #845: …"}` | isError falsy; `valid === false`; message contains `845` |
| 12 | admin:529 `_SYSTEM` `%DB_USER` R | `{granted:true,reason:"target holds %All super-role"}` | isError falsy; `granted === true` |
| 13 | interop:230 config item `NonExistentItem` | isError true, text "… ERROR #5001: Config item 'NonExistentItem' not found" | `isError === true`; text contains `NonExistentItem` |

**Decisions.**
- *DocDB `index`.* It never creates on an existing property, so #5805 cannot happen. For a missing property it keeps today's behaviour (create plus the implicit index) and adds the path, which leaves the entry's unnamed path unchanged. A `%`-prefixed name is refused because its index state varies (`%DocumentId` has IDKEY, `%Doc` has none), so `indexed: true` would be false for some of them. `path` is ignored by `drop`, and by `index` on an existing property.
- *Description claims* (wording is the implementer's; these claims are required):
  - `iris_docdb_property`: `create` populates the property from `path` (default `$.<property>`, the top-level field of the same name); documents saved before the property exists are not populated until they are saved again; DocDB indexes every property it creates; `index` reports an existing property without writing and creates a missing one (`%String`, at `path`).
  - `iris_docdb_manage`: drop "with optional property definitions"; say `create` makes an empty database whose properties are defined with `iris_docdb_property`.
  - `iris_database_manage`: `delete` removes the configuration entry and dismounts the database (unless another configured database uses that directory); its `IRIS.DAT` and directory stay on disk, so a create at the same directory fails until the file is removed. Keep the existing background-work note.
- *Compile check mapping.* Only a sync compile that IRIS answered without a status error is checked; status-error and async paths are untouched.
  - Case-insensitive matching against unconfirmed names (as `verifyCompiled` does).
  - `compile.ts`: `success: false`; one `errors` entry per unconfirmed class, `{document, error: "<doc> did not compile: the class dictionary and IRIS's up-to-date flag do not confirm it (IRIS answered the compile without a status error; see console)"}`; summary "Compilation failed …"; `isError` false (the tool's existing contract).
  - `load.ts`: the same entries go into `compilationResult.errors` with `success: false`.
  - `env-promote.ts`: an unconfirmed class makes its step `failed` with `compile error: <same text>`, and the existing first-failure, rest-skipped loop applies.
  - A check that throws makes the compile a failure, never a pass.
- *Wildcard expansion* (`compile.ts` only; the other two tools pass concrete names). For each `.cls` name containing `*` or `?`:
  - `GET docnames/CLS?filter=<literal prefix before the first metacharacter>`, then keep the entries whose `name` matches the pattern as an anchored, case-insensitive regex (`*` is any run, `?` is one character, everything else escaped), skipping `gen: true`;
  - a name with a leading `'` is an exclusion, and its matches are removed;
  - non-class names (`.mac`/`.int`/`.inc`) are not checked (see `deferred`).
- *DW-757 dismount*:
  - Normalize both directories with `##class(%Library.File).NormalizeDirectory` before comparing them with every other `Config.Databases` entry (`Config.Databases:List` or `Get` per name).
  - Dismount only after `Delete` returned OK. A missing name still gets `Delete`'s own error: run `Get` only to read the directory, and fall through to `Delete` on failure.
  - A failed dismount is reported as `dismounted: false` with `dismountNote` (the `SanitizeError` text). The delete itself succeeded, so it is not an error.
  - The handler pattern is AD-12/AD-13 (save and restore `$NAMESPACE`, no `New $NAMESPACE`).
- *DW-747*: the finding is per legacy file. When no server is refused, it is byte-identical to today's. Otherwise the refused servers get their own finding with `entry` set, e.g. "`iris-dev-mcp` is still in `<old path>`; the workspace `.mcp.json` entry belongs to Claude Code (claude-code), which Copilot sessions also read, so this copy is unused. Delete the "iris-dev-mcp" entry from `<old path>` by hand: the CLI never changes an entry another client owns in the shared file." The by-hand wording follows check 6's home-directory precedent.

**Governing ADs (Rule 6).**
- AD-15: sanctions `S-44.7-docdb-property` (recorded correction plus an additive `path` field plus the create-default change), `S-44.7-docdb-manage-text` (recorded correction) and `S-44.7-database-delete` (recorded correction, additive reply fields, dismount); the clean paths are pinned.
- AD-14 / Rule #24: the embed is regenerated; there is no new bootstrapped class.
- AD-12 and AD-13: thin handler, explicit namespace save and restore.
- AD-11: one error envelope.
- AD-30: refused verbs write nothing; the fix is in the doctor.
- AD-2: the dev package imports `verifyCompiled` from shared; the IRIS-side test runs from the dev suite.
- AD-4/AD-5: no new key.
- No AC contradicts an AD.

**For the lead (Rule 20, at the story's bookkeeping commit).** Add the three sanction ids to AD-15's sanctioned list. Add to AD-14 "on failure": the compile check now also runs in `iris_doc_compile`, `iris_doc_load` and `iris_env_promote`. The `deferred` item (routines) is for harvest.

**Scope and order.** All of this fits one story, but it is wide: 5 packages, 1 IRIS class and its embed, goldens and docs. Build in the order of the Execution list. Steps 1-3, 4-5, 6-8 and 9 are independent, and step 10-11 closes them. If a pass runs out, checkpoint after a complete step. Never leave a description changed without its golden entry.

**Integration ACs, Consumes and Consumed-by (Rules 1 and 2).**
- No new service.
- Consumes: `verifyCompiled` (44.4), consumed by `iris_doc_compile`, `iris_doc_load` and `iris_env_promote`. The Integration ACs are DW-754/755, live on a throwaway.
- Consumed-by: none. This is the epic's last story.
- Extend, don't copy:
  - the three tools call `verifyCompiled` and keep their own compile POST, so the request bytes stay the same;
  - the wildcard helper lives in `compile.ts`, its only consumer;
  - doctor reuses the engine's ownership verdict;
  - the live gate reuses `storage-guard-write-paths-live-gate.test.ts`'s two-client promote pattern and `live-doc-helpers.ts`.

**Ledger.** The inbox is the nine chartered entries (`owned_ledger=9`), all addressed above. No entry was declined.

## Verification

**Commands:**
- `pnpm --filter @iris-mcp/data exec vitest run src/__tests__/docdb.test.ts src/__tests__/docdb-register.test.ts src/__tests__/docdb-register-qa.test.ts` (timeout 600000) -- expected: green.
- `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/compile.test.ts src/__tests__/load.test.ts src/__tests__/env-promote.test.ts src/__tests__/env-promote-qa.test.ts` (timeout 600000) -- expected: green.
- `pnpm --filter @iris-mcp/admin exec vitest run src/__tests__/database.test.ts` and `pnpm --filter @iris-mcp/client-config exec vitest run src/__tests__/vscode-copilot-targets.test.ts` -- expected: green.
- `pnpm run gen:bootstrap` then `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts` -- expected: green. A second `gen:bootstrap` reports "Unchanged".
- `pnpm gen:tools-list-snapshot` then `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/tools-list-snapshot.test.ts src/__tests__/story-43-1-sdk-wire-golden.test.ts src/__tests__/epic43-capstone-gate.test.ts` -- expected: green.
- `pnpm check:live-guards`, `pnpm gen:governance-baseline:check`, `pnpm gen:ipm:check`, `pnpm turbo run build`, lint, type-check -- expected: OK. Then the default suite, one package per call.
- Live, on one `up` throwaway (`node scripts/throwaway-iris.mjs up --image intersystems/irishealth-community:2026.2@sha256:462de1fb3597272fde0e03afad006af1b18b59c90f1c1fb5566c79b027a7af0a --namespace HSCUSTOM --host-port 52792 --state <scratch>/tw.json`; seed with `ci-seed-throwaway.mjs`; enable DocDB with `scripts/ci-enable-docdb-service.script`; `down` afterwards):
  - run `ci-live-suite.mjs` for `integration-admin`, `integration-interop`, `integration-data`, `integration-dev` and `prepublish-dev`, one per call;
  - run `integration-admin` twice on the same container (DW-757's second-run case);
  - expected: green, with no skip outside the allowlists.
- Weak-assertion scan (DW-758): for every file in `coveredTestFiles()` (`scripts/lib/ci-checks.mjs`), find each `it(` block whose `expect(` lines that mention a result or text are all `.text).toBeDefined()`. This is the planning scan, `scratchpad/scan-weak.mjs`; a copy can go in the spec's QA notes. Expected: `hits=0`.
- Tally (AC 44.7.1): `awk -F'|' '/^\| DW-/ {gsub(/ /,"",$3); n[$3]++} END {for (k in n) print k, n[k]}' _bmad-output/implementation-artifacts/spec-44-7-epic-44-burn-down.md` -- expected: `resolved 8`, `closed-with-evidence 1`.

**Shared surfaces:**
- the tools-list snapshot and the wire golden (3 descriptions, 1 schema);
- the AC 44.1.7 request lists;
- `gateTestFiles` and the live-gate roster test;
- the `custom-rest.integration.test.ts` IRIS-class roster;
- the `BOOTSTRAP_VERSION` embed;
- README text pinned by `iris-mcp-all` doc-claim tests;
- doctor findings pinned in client-config tests.

Every test added or changed must pass on a fresh environment, in either order.

**Mutations to apply and record** (one per AC; observe red, revert, confirm `git status --short` and `git diff --stat` are unchanged):
- DW-723: `index` POSTs unconditionally.
- DW-724: drop the default path.
- DW-725: revert the text.
- DW-754: skip `verifyCompiled` in `compile.ts`, and separately disable the wildcard expansion.
- DW-755: skip it in `load.ts`, and separately in `env-promote.ts`.
- DW-757: remove the dismount call.
- DW-747: always emit the `apply` fix.
- DW-758: make one probed tool answer `isError`, and its test goes red.
- AC 44.7.2: change one pinned byte per pin group.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none (halted after planning, as instructed)

- Planning probes ran on one throwaway: `iris-mcp-throwaway-19b9eadf2c9d`, image `irishealth-community:2026.2@sha256:462de1fb…`, port 52792, HSCUSTOM, seeded as CI does. It was removed with `down`, and `docker ps -a --filter label=iris-mcp.owner=throwaway` was empty afterwards. The shared instance was not touched.
- Dispositions: 8 resolved, 1 closed-with-evidence (DW-756). DW-758 grows from 12 to 13 tests (the config-item test, `interop:230`).
- One new low finding, for harvest, is in the frontmatter `deferred` list (routine failures in a Storage-written compile).
- The lead's Rule 20 bookkeeping, which adds the three `S-44.7-*` sanctions to AD-15 and extends AD-14 "on failure", is listed under Design Notes.
