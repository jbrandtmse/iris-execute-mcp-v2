---
title: 'Story 44.1: DocDB Create Registers the Database'
type: 'bugfix'
created: '2026-11-22'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred:
  - summary: 'iris_docdb_property action=index on a property that already exists always fails with ERROR #5805'
    evidence: 'DocDB has no separate index operation: %DocDB.Database.%CreateProperty indexes every property implicitly (irislib/%DocDB/Database.cls:384-388), and httpPostProperty ignores the {index:true} body (irislib/%Api/DocDB/v1.cls:355-374), so index re-creates the property. Live 2026.2 throwaway: create prop then index the same prop -> HTTP 400 #5805 IDKeyNotUnique. The tool description says index "creates an index on a property". Fixing it changes the iris_docdb_property request bytes that AC 44.1.7 pins, so it is out of this story.'
    location: 'packages/iris-data-mcp/src/tools/docdb.ts:688-693'
    severity: 'med'
  - summary: 'A property created by iris_docdb_property never matches an iris_docdb_find filter'
    evidence: 'The tool sends no `path` query parameter, so %CreateProperty gets an empty expression and the property is never populated. Live 2026.2 throwaway: property `category` created without path, doc {category:"test"} inserted, find restriction ["category","test","="] -> content []; a property created with ?path=category matches. Only documents inserted after a property exists are populated (doc 1 not backfilled).'
    location: 'packages/iris-data-mcp/src/tools/docdb.ts:683-687'
    severity: 'med'
  - summary: 'The iris_docdb_manage description claims create takes "optional property definitions"; the schema has no such field'
    evidence: 'docdb.ts:266 vs the inputSchema at docdb.ts:271-284 (action, database, namespace only). AC 44.1.5 appends text only (Frozen goldens: append unless a recorded correction), so the false clause stays.'
    location: 'packages/iris-data-mcp/src/tools/docdb.ts:266'
    severity: 'low'
---

<intent-contract>

## Intent

**Problem:** `iris_docdb_manage create` makes a DocDB database but no `Security.DocDBs` record, and IRIS denies every other DocDB call on a database without a record with a raw `ERROR #822: Access Denied` (DW-688, high priority). A database made by 1.1.0 or earlier cannot even be dropped through the suite for the same reason.

**Approach:** after the DocDB create succeeds, `create` registers the record through a new thin IRIS-side route (`POST /security/docdb`, `$$Create^%SYS.DOCDB`). `create` on a database that exists without a record registers it (repair). The 822 translation checks the record through `GET /security/docdb` and names a missing record. No new tool, action or governance key.

## Boundaries & Constraints

**Always:**
- The registration is IRIS's own published API `$$Create^%SYS.DOCDB(name, namespace, .props)` with no properties (Enabled=1, no Resource). IRIS checks the privilege (`%DocDB_Admin:USE` or `%Admin_Secure:USE`, plus `%Service_DocDB` enabled). The handler does no privilege pre-check and no `$ROLES` change (AD-31).
- The handler validates input, then switches namespace with save/restore (never `New $NAMESPACE`). The catch block restores the namespace first. `Security.DocDBs` calls run in `%SYS` (AD-13). Errors pass through `SanitizeError`. Each request renders exactly one envelope (AD-11, Rule #7).
- The handler registers only a database that exists (`%DocDB.Database.xNExists` in the target namespace), because IRIS will happily write a record for a name with no database (probe P11).
- A registration failure is never silent. The text names the database, says whether it was created, carries the real error text, and says what to do.
- Pre-existing behavior stays byte-identical:
  - `list` and `drop` (requests and results);
  - the success-path and disabled-service request lists of `iris_docdb_document`, `iris_docdb_find` and `iris_docdb_property`.

  Only an 822 with the service enabled gains the record GET (AC 44.1.3). Create on a database that already has a record returns today's error text unchanged. The disabled-service 822 message is unchanged.
- Live DocDB checks run only on a throwaway started by `scripts/throwaway-iris.mjs` on host port 52792, with `%Service_DocDB` enabled there. Disposable DocDB names have no underscore.

**Never:**
- No new tool, action, input field or governance key. `GOVERNANCE_BASELINE` is checked with `:check` only. No visibility change.
- Never toggle `%Service_DocDB` (or any service) on the shared instance, and never write a DocDB record there.
- Never write a `Resource` on the record. Never call `Security.DocDBs.Create`/`Delete` directly.
- No change to `drop`: the REST DELETE already removes the record (probes P15, Y2, Y3).
- No hand edit of `bootstrap-classes.ts`, the tools-list snapshot or any frozen golden. No regeneration of the IPM tree (`ipm/`, `module.xml`, `preload/`).
- No fix of the deferred `index`/`find` defects (frontmatter `deferred:`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh create | `create` X; service on; X absent | DocDB POST (bytes unchanged) then `POST /api/executemcp/v2/security/docdb` `{action:"register",name:X,namespace:NS}`. Result is the DocDB definition plus `registered: true`; `isError` unset | none |
| Repair | `create` X; X exists (DocDB answers HTTP 409, `errors[].code` 25051) and has no record | register call; result `{database:X, namespace:NS, created:false, registered:true}` and text saying the existing database's record was registered | none |
| Already registered | `create` X; 25051; register answers `alreadyRegistered: true` | the original error, byte-identical: `Error managing DocDB database: <msg>` | `isError: true` |
| Register fails after create | DocDB POST ok; register throws (IrisApiError incl. 404 from an older deployed service, or a connection error) | `isError: true`; text says X WAS created in NS, its record was not registered, gives the real error text, and names both fixes (retry `create`, or Management Portal > System Administration > Security > Applications > Doc DB Applications); `structuredContent {database, namespace, created:true, registered:false}` | never thrown |
| Repair fails | 25051; register fails | same, with `created:false` and "already exists" wording | never thrown |
| Service disabled | any DocDB call; 822; service GET says disabled | unchanged Story 35.7 message; no record GET; create makes no register call | as today |
| Missing record | non-list call on X; 822; service enabled; record GET `{exists:true, registered:false}` | names the missing `Security.DocDBs` record for X in NS, says `create` with the same name registers it, plus the portal route and `Original error: <msg>` | `isError: true` |
| No such database | as above, record GET `{exists:false, registered:false}` | says no DocDB database X exists in NS, and to create it with `iris_docdb_manage create`, plus `Original error: <msg>` | `isError: true` |
| Record present / check fails | 822; service enabled; record GET says registered, or the GET fails or answers an unexpected shape | the original error passes through unchanged | never masks |
| Handler: not found | `register` X; no DocDB database X in NS | error envelope naming X and NS; no record written | `SanitizeError` |
| Handler: denied | caller lacks `%DocDB_Admin`; or the service is off | `Exists` answers 0 with status 822 (not 793) -> error envelope; `$$Create` answers 822 -> error envelope | real text, never `registered:false` |
| Drop refusal | `drop` of a name that does not exist | `{database, dropped:false}`; nothing changes (request bytes unchanged) | none |

</intent-contract>

## Code Map

- `packages/iris-data-mcp/src/tools/docdb.ts` -- the four DocDB tools. `translateDocDbAccessDenied` (:202-256) is the catch-path 822 translation, called by all four handlers (:353, :509, :592, :706). `docdbManageTool` create branch (:308-323), description (:263-270). `BASE_EXECUTEMCP_URL` (:48) is already imported for the service-state GET.
- `src/ExecuteMCPv2/REST/Security.cls` (3505 lines, bootstrapped) -- `ServiceList` (:2033-2096) and `ServiceManage` (:2111-) are the GET/POST sibling pair to extend, with the same save/restore, validate-first and single-render shape.
- `src/ExecuteMCPv2/REST/Dispatch.cls` -- UrlMap; `/security/service` routes at :84-85. The new routes go next to them.
- `src/ExecuteMCPv2/Utils.cls` -- `ReadRequestBody` (:1151), `ValidateRequired` (:77), `SanitizeError` (:131).
- `src/ExecuteMCPv2/Tests/AdvisorDataTest.cls` (:181-215) and `SqlPrivilegeBoundTest.cls` (:109-140) -- the `ResolvePort` + `%Net.HttpRequest` route-test pattern with a per-class `^UnitTestConfig` key.
- `scripts/gen-bootstrap.mjs` `classes[]` -- roster, unchanged (no new bootstrapped class). `packages/shared/src/bootstrap-classes.ts:34` `BOOTSTRAP_VERSION = "1.1.0+2.244fe8623c76"`; `scripts/bootstrap-sequence.json` `{"sequence": 2}`. Generated: regenerate with `pnpm run gen:bootstrap`, never hand-edit.
- `packages/iris-data-mcp/src/__tests__/docdb.test.ts` -- existing unit tests. Story 35.7 gate blocks start at :793. `makeLive822Error`, `SERVICE_*` helpers. The "passes the original error through unchanged when the service is enabled" tests now see a third call (the record GET); update their call-count assertions.
- `packages/iris-data-mcp/src/__tests__/data.integration.test.ts` (:74-258) -- the DocDB lifecycle. It has never run green: its index step indexes `category` right after creating it (#5805), and its ID extraction (:150-165) cannot read `_documentID`. Its 9 test names are the `DOCDB_SKIPS` allowlist, so keep every name.
- `packages/iris-data-mcp/src/__tests__/integration-setup.ts` (:78-98) -- `__DOCDB_AVAILABLE__` probe; unchanged (44.5 owns it).
- `scripts/lib/ci-checks.mjs:150-168` -- `DOCDB_REASON` / `DOCDB_SKIPS`. Narrow the reason; keep the names.
- `packages/iris-mcp-all/src/__tests__/fixtures/sdk-wire-golden.json` -- the only golden row holding the description: `/servers/iris-data-mcp/sessions/main/rows/1/line` (a `tools/list` line). `fixtures/sdk-golden-sanctioned-changes.json` -- add one entry, shaped like the `42.11/storage-guard-text/...` entries (`golden:"wire"`, `server:"iris-data-mcp"`, `session:"main"`, `label:"tools-list"`, `pointer:"/result/tools/<i>/description"`, `op:"replace"`, `appendOnly:true`). `fixtures/tools-list-snapshot.json` -- regenerate with `pnpm gen:tools-list-snapshot`.
- `packages/iris-mcp-all/src/__tests__/epic35-defect-gate.test.ts:454-466` -- F5 pins the disabled-service message; must stay green unchanged.
- `packages/iris-data-mcp/README.md` (:121-123, :148, :583, :595) and `tool_support.md` (:315, :491; :491 says the DocDB tools work "independently of your custom REST deployment", which `create` no longer does) -- docs. `CHANGELOG.md` (top section is `[1.1.0]`) and `.changeset/`.
- Read-only references: `irislib/%SYS/DOCDB.int`, `irissys/Security/DocDBs.cls`, `irislib/%Api/DocDB/v1.cls`, `irislib/%DocDB/Database.cls`, `irislib/Ens/Setting/Report/base.cls:629`, `irislib/%occErrors.inc:630-633,3946-3949`.

## Tasks & Acceptance

**Execution:**
- `packages/iris-data-mcp/src/__tests__/docdb-register.test.ts` (new) -- FIRST, before editing `docdb.ts`, write the AC 44.1.7 back-compat pins from the pre-story capture in Design Notes. They are `toEqual` on the recorded `[method, url, body?]` lists for `list`/`drop` and for every action of the other three tools, plus `toEqual` on `list`/`drop` results for a fixed fake response. Also the AD-33 route pin: the `<Route .../>` lines of `src/ExecuteMCPv2/REST/Dispatch.cls`, captured verbatim before editing, are still present byte-for-byte, and the only added lines are the two new routes. Then add the I/O-matrix tests. Fakes use the live-captured shapes from Design Notes (Rule #54).
- `src/ExecuteMCPv2/REST/Security.cls` -- add a `%request`-independent helper and two handlers. The helper is `DocDbRecord(pName, pNamespace, pRegister As %Boolean, Output pResult As %DynamicObject) As %Status`. It validates input, then: switch to `pNamespace` and check `##class(%DocDB.Database).xNExists(pName)`; switch to `%SYS` and call `##class(Security.DocDBs).Exists(pName, pNamespace, , .tSC)`. When that answers 0 and `tSC` is not code 793, it returns `tSC` (a denial). When `pRegister` is set and the database exists without a record, it calls `$$Create^%SYS.DOCDB(pName, pNamespace, .tProps)`, with `tProps` empty. When the database is missing, it refuses with an error. It restores the namespace on every path. `pResult` is `{name, namespace, exists, registered, alreadyRegistered}`. `DocDbGet()` is `GET /security/docdb?name=&namespace=` and `DocDbManage()` is `POST` `{action:"register", name, namespace}`; another action is an error. Mirror `ServiceList`/`ServiceManage`.
- `src/ExecuteMCPv2/REST/Dispatch.cls` -- add `GET /security/docdb` -> `ExecuteMCPv2.REST.Security:DocDbGet` and `POST /security/docdb` -> `:DocDbManage` after the `/security/service` routes. Additive only.
- `src/ExecuteMCPv2/Tests/DocDbRegisterTest.cls` (new; not in any roster) -- 5 `Test*` methods, under `<500` lines, `%OnNew(initvalue)` handled if overridden:
  - `TestStatusOfUnknownNameIsUnregistered`;
  - `TestRegisterRequiresName`;
  - `TestRegisterRefusesMissingDatabase` (no record afterwards);
  - `TestRegisterFollowsServiceState`: a disposable DB `MCPRegTestDb`. With the service enabled: register, then `$$CheckAccess^%SYS.DOCDB` is 1, then a second register reports `alreadyRegistered`, then `$system.DocDB.DropDatabase` leaves no record. With the service disabled: register answers 822 and leaves no record. Both branches assert;
  - `TestRouteGetRoundTrip`: `%Net.HttpRequest` GET of the deployed route, `^UnitTestConfig("DocDb",…)` port key.

  The fixture is dropped in both `OnBeforeOneTest` and `OnAfterOneTest` (the DocDB DB, plus the record via `$$Delete^%SYS.DOCDB`, which returns 1 when there is no record).
- `packages/iris-data-mcp/src/tools/docdb.ts` -- the create flow and repair per the matrix. The repair trigger is `errors[].code === 25051` (the numeric code, never message text). Extend `translateDocDbAccessDenied(ctx, error, target?: {database, namespace})`: after the service is confirmed enabled, and only when `target` is given, GET the record and choose the missing-record or no-such-database text. With no `target` (list), or on any failure, return `null` as today. Pass `target` from the document/find/property handlers and from manage create/drop. Append one sentence to the `iris_docdb_manage` description, e.g. "'create' also registers the database's Security.DocDBs record, which every other DocDB call requires, and on a database that exists without one it registers the missing record." Append only: no other byte of the description changes.
- `packages/shared/src/bootstrap-classes.ts`, `scripts/bootstrap-sequence.json` -- regenerate with `pnpm run gen:bootstrap`; record `BOOTSTRAP_VERSION` `1.1.0+2.244fe8623c76` -> `1.1.0+3.<hash>` in this spec.
- `packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json` -- one entry, sanction `S-44.1-docdb-manage-text`, story `44.1`; then `pnpm gen:tools-list-snapshot`.
- `packages/iris-data-mcp/src/__tests__/data.integration.test.ts` -- keep all 9 test names. The index test indexes a second, not-yet-created property (`label`). The ID is read from `_documentID`. The create test asserts `structuredContent.registered === true` and a live `GET /api/executemcp/v2/security/docdb` reports `registered:true`. The drop test asserts that GET reports `registered:false, exists:false`.
- `scripts/lib/ci-checks.mjs` -- narrow `DOCDB_REASON`: a fresh instance lacks only the enabled service, because `create` registers the record since Story 44.1, and the F5 gate needs the service disabled. Do not touch `DOCDB_SKIPS` names (44.5 owns the rest).
- `packages/iris-data-mcp/README.md`, `tool_support.md`, `CHANGELOG.md` (an `[Unreleased]` "Fixed" entry naming `S-44.1-docdb-manage-text`), `.changeset/<name>.md` (`@iris-mcp/data` and `@iris-mcp/shared` patch) -- the docs:
  - the prerequisites name the record;
  - what `create` now does, including repair of 1.1.0 databases (which also cannot be dropped until repaired, probe R4);
  - the record has no Resource;
  - registration needs the ExecuteMCPv2 service;
  - a troubleshooting row for 822 with the service enabled.

**Acceptance Criteria:**
- AC 44.1.1: Given the probe results in Design Notes, when the implement stage builds, then it builds on them. Any claim it finds wrong is added to the Design Notes probe results with its evidence, and reported in `## Auto Run Result` for the lead.
- AC 44.1.2: Given a throwaway with `%Service_DocDB` enabled, when `iris_docdb_manage create` runs on a new name, then one tool call leaves a database whose first `iris_docdb_property create` succeeds. And given a database made without a record, when `create` runs on its name, then the record is registered and the database becomes usable and droppable.
- AC 44.1.3: Given a registered database, when `drop` runs, then `GET /security/docdb` reports no record. And given the service is enabled and a database has no record, when a document/find/property call answers 822, then the text names the missing record, while the disabled-service text (F5 gate) is unchanged.
- AC 44.1.4: Given the edited `Security.cls`/`Dispatch.cls`, when the embed is regenerated, then the drift test passes, the version moves to sequence 3, and `DocDbRegisterTest` reports `total` 5 with no failure on the seeded throwaway in HSCUSTOM, once with `%Service_DocDB` enabled and once after disabling it there.
- AC 44.1.5: Given the docs and the description, when the default suite runs, then the tools-list snapshot, the sanctioned-change entry and the wire-golden tests are green, and the README, `tool_support.md`, CHANGELOG and changeset say what `create` now does.
- AC 44.1.6: Given a throwaway (service enabled, seeded), when `data.integration.test.ts` runs armed, then all 9 lifecycle tests pass with no record left. A second namespace (`USER`) create+property+drop through the tools passes, and USER's record is separate from HSCUSTOM's. With the register call removed from `docdb.ts` and the build re-run, the property test answers #822 (proven red). `drop` of a missing name returns `dropped:false` and `list` is unchanged.
- AC 44.1.7: Given the pre-story capture, when the back-compat pins run, then `list`, `drop` and the request lists of the other three tools are `toEqual` the capture.

## Spec Change Log

## Review Triage Log

## Design Notes

**Governing ADs (Rule 6).** AD-11 (one envelope, `SanitizeError`); AD-12 (thin handler: validate, switch, delegate, raw data; the existence check is input validation that keeps orphan records from being written); AD-13 (save/restore, `%SYS` for `Security.*`); AD-14 (embed regenerated, `BOOTSTRAP_VERSION` moves; no new bootstrapped class, so the rosters are unchanged; the IPM tree is not regenerated); AD-15 (append-only description change `S-44.1-docdb-manage-text` through Frozen goldens; additive output fields `registered`/`created`; pins against the pre-story capture); AD-31 (IRIS authorizes: `$$Create^%SYS.DOCDB` runs IRIS's own `CheckAdmin` and its internal `$roles` change is IRIS code, not the handler's); AD-33 (additive routes, pinned); AD-4/AD-5 (no new key; register runs inside `iris_docdb_manage:create`). Conventions: Error text, Refusals, Live gates, Frozen goldens, IRIS-side unit tests, Probes and references (earliest version verified: 2026.1 Build 234U), Live testing on a shared instance. No AC contradicts an AD. Spine bookkeeping for the lead (Rule 20): add `S-44.1-docdb-manage-text` to AD-15's sanctioned list.

**Integration ACs / Consumes (Rules 1/2).** No new shared service or module. The new IRIS route is consumed in this story by `iris_docdb_manage` (create, repair) and `translateDocDbAccessDenied` (all four tools). The Integration AC is AC 44.1.6, run against a real instance. Consumes: `/api/docdb/v1` (IRIS), `/api/executemcp/v2/security/service` (Story 35.7). Consumed-by: Story 44.5 (the `DOCDB_REASON` seam; it decides whether CI runs the lifecycle).

**Extend, don't copy (Rule 2).** `DocDbGet`/`DocDbManage` extend the `ServiceList`/`ServiceManage` pattern in the same class. The record check extends `translateDocDbAccessDenied`; it is not a second translator. The test class copies the `ResolvePort`/`%Net.HttpRequest` helper of `AdvisorDataTest`, as every route-test class does (~10 copies), each with its own `^UnitTestConfig` key. Unifying them is a cross-class refactor outside this story.

**Probe results (AC 44.1.1; 2026-11-22).** Throwaways: `irishealth-community:2026.2@sha256:462de1fb…` (IRIS for Health 2026.2 Build 221U, HSCUSTOM) and `iris-community:2026.1@sha256:c57b65b2…` (IRIS 2026.1 Build 234U, USER), both on 127.0.0.1:52792. Both were removed afterwards, along with the pulled 2026.1 image. On the shared instance, `%Service_DocDB` is disabled (read-only `iris_service_manage get`).

- *Signature.* `Create(Name,Namespace,Properties) Public` (`irislib/%SYS/DOCDB.int:89-100`). It is called as `$$Create^%SYS.DOCDB(name, ns, .props)` and returns a `%Status`.
  - Its first step is `$$CheckAdmin()` (:91), which needs `%DocDB_Admin:USE` or `%Admin_Secure:USE` (:53-61) and the service enabled with `%Service_DocDB:U` (:62-88). Otherwise it answers #822.
  - It then adds `%All` to `$roles`, runs `n $namespace s $namespace="%SYS"` itself and calls `Security.DocDBs.Create` (:93-96). It is a `%` routine, callable from any namespace, so no `%SYS` switch is needed for it.
  - `Delete(Name,Namespace)` (:101-119) returns 1 when no record exists.
- *Live checks (2026.2).*
  - P5: a database with no record makes `CheckAccess` answer 822; the audit carries 793.
  - P7/P8: `$$Create` returns 1, and `CheckAccess` is then 1. Q1: a lowercase namespace is stored uppercase.
  - P10: a duplicate answers 794, also for a case-variant name.
  - P11: IRIS writes a record for a name with no DocDB database (no validation).
  - P20/P21: `Ens.Setting.Report.base:629` passes `tProperties("resource")` (lowercase); `Security.DocDBs` ignores that key, so its record has no Resource. P18: an uppercase `Resource` with `%DB_HSCUSTOM` fails validation.
- *Privilege.*
  - L1-L5: a user with `%DocDB_Admin:U`, `%Service_DocDB:U`, `%DB_HSCUSTOM:RW`, `%DB_IRISSYS:R` and no `%All` can run `$$Create`, `Exists` in `%SYS`, the `List` query and `Delete`.
  - M1-M3: a user without `%DocDB_Admin` gets 822 from `Create`. `Exists` returns 0 with status 822, not 793, which is why the handler must check the code. `List` errors.
  - X1-X3, with the service disabled: `Exists` still works (793 when absent), and `$$Create` answers 822.
- *Other routes.* `%DocDB.Database.%CreateDatabase` / `$system.DocDB.CreateDatabase` and `httpPostDatabase` (`v1.cls:299-313`) never write a record. Their `resource` argument is only a database-class option. The portal writes records separately through `Security.DocDBs.Create` (`%CSP/UI/Portal/Applications/DocDB.cls:124`). No register variant exists.
- *Drop.* `httpDeleteDatabase` (`v1.cls:256-279`) runs `CheckAccess(...,"W")` before dropping. Live, the REST DELETE and `$system.DocDB.DropDatabase` both remove the record (P15, Y2, Y3, O6), so Story 42.3's claim holds. The REST DELETE of an unregistered database answers 822 (R4), and of a missing name `{dropped:false}` HTTP 200 (R5).
- *Existing (1.1.0) databases.* Property, get-database and drop each answer 822 (R2, R4, R7). Registering afterwards makes property and drop work (X6, Y1, Y2), so repair is safe. The `create` REST call on an existing database answers HTTP 409 with code 25051 (R3).
- *Version range.* The same behavior (822 without a record, `$$Create` fixes it, drop removes it) is verified on 2026.1 Build 234U (O3-O6) and 2026.2 Build 221U. **Residual risk:** 2023.1-2025.x are unverified, because their Community licence keys have expired (DW-686; `OLDEST_IRIS_COMMUNITY_IMAGE` is 2026.1). The routine's own comment (`verified 7/31/17`) suggests the API is older than 2023.1.
- *Golden.* One row holds the description (see the Code Map); `sdk-handler-golden.json` has none.

**Live-captured fake shapes (Rule #54).**
- 822, service on, no record: HTTP 500 `{"status":{"errors":[{"error":"ERROR #822: Access Denied","code":822,"domain":"%ObjectErrors","id":"AccessDenied"}],"summary":"ERROR #822: Access Denied"},"content":null}`.
- 25051: HTTP 409 `{"status":{"errors":[{"error":"ERROR #25051: Database 'probeC' is already defined in this namespace","code":25051,"domain":"%ObjectErrors","id":"DocumentDatabaseAlreadyExists","params":["probeC"]}],…},"content":null}`.
- Create: HTTP 201 `{"content":{"Name":"probeC","Class":"ISC.DM.probeC","properties":[…]}}`.
- Insert: `{"content":{"_documentID":"1","content":{…}}}`.

**Pre-story request capture (AC 44.1.7 oracle).** The capture command is `node /private/tmp/claude-501/-Users-jbrandt-git-iris-execute-mcp-v2/03eb9a39-2d9e-4087-85ac-363a9bb86d2a/scratchpad/p441/capture.mjs /Users/jbrandt/git/iris-execute-mcp-v2`. The scratch directory may be cleared; if it is, recreate the script from this description. It imports the built `packages/iris-data-mcp/dist/tools/docdb.js` at `docdb.ts` commit `05b26d92c6445c4fb20fbaeb438ad9ca55a8f8b1`, with a recording `http` fake whose every call returns `{result:{ok:true}}`, and `resolveNamespace = ns ?? "USER"`. The implement stage re-runs the same capture against the pre-edit dist and must get the same lines.
```
manage {action:list} -> [["GET","/api/docdb/v1/USER"]]; {action:list,namespace:HSCUSTOM} -> [["GET","/api/docdb/v1/HSCUSTOM"]]
manage {action:drop,database:MyDb} -> [["DELETE","/api/docdb/v1/USER/db/MyDb"]]; {drop,"My Db/x",HSCUSTOM} -> [["DELETE","/api/docdb/v1/HSCUSTOM/db/My%20Db%2Fx"]]
manage {action:create,database:MyDb} -> [["POST","/api/docdb/v1/USER/db/MyDb",{}]]   (pre-story; create gains the register call)
document insert {a:1} -> [["POST","/api/docdb/v1/USER/doc/MyDb/",{"a":1}]]; get 7 -> [["GET",".../doc/MyDb/7"]]; update 7 {a:2} -> [["PUT",".../doc/MyDb/7",{"a":2}]]; delete 7 -> [["DELETE",".../doc/MyDb/7"]]
find {age:{$gt:21},name:"x"} -> [["POST","/api/docdb/v1/USER/find/MyDb",{"restriction":[["age",21,">"],["name","x","="]]}]]; filter {} -> [["POST",".../find/MyDb",{}]]
property create p %Integer -> [["POST","/api/docdb/v1/USER/prop/MyDb/p?type=%Integer",{}]]; drop -> [["DELETE",".../prop/MyDb/p"]]; index -> [["POST",".../prop/MyDb/p",{"index":true}]]
```
(`...` = `/api/docdb/v1/USER`.)

**Corrections for the lead (Rule #42; the epic text is not edited here).**
1. AC 44.1.1: `Ens.Setting.Report.base` passes a lowercase `resource` key that `Security.DocDBs` ignores (P20/P21).
2. AC 44.1.6: the lifecycle's `index` step must index a property not yet created. DocDB indexes every property implicitly and has no separate index operation, so `index` after `create` on the same property answers #5805. That defect is deferred because fixing it changes the request bytes that AC 44.1.7 pins.
3. AC 44.1.3: `drop` already removes the record; no drop change is needed. A 1.1.0 database cannot be dropped until `create` repairs it (R4).
4. AC 44.1.4: no new bootstrapped class, so "joins both rosters" does not apply.
5. AC 44.1.5: the Frozen goldens change is exactly one entry.

**Safety note.** Repair re-registers a database whose record an operator deleted. IRIS allows that only to `%DocDB_Admin`/`%Admin_Secure` holders (AD-31), and `create` is the existing `iris_docdb_manage:create` key. A disabled record (`Enabled=0`) or one with a Resource already exists, so it is never touched (`alreadyRegistered`).

## Verification

**Commands:**
- (loop) `pnpm --filter @iris-mcp/data exec vitest run src/__tests__/docdb.test.ts src/__tests__/docdb-register.test.ts` (timeout 600000) -- expected: green.
- (loop) `pnpm run gen:bootstrap && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts` (timeout 600000) -- expected: green; the regen is idempotent on a second run.
- (loop) `pnpm turbo run build --filter @iris-mcp/data --filter @iris-mcp/shared && pnpm run gen:tools-list-snapshot:check` (timeout 600000) -- expected: no drift after the regenerate step.
- (loop) `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/tools-list-snapshot.test.ts src/__tests__/story-43-1-sdk-wire-golden.test.ts src/__tests__/epic43-capstone-gate.test.ts src/__tests__/basetest-rest-handlers.test.ts` (timeout 600000) -- expected: green.
- (loop) Throwaway proof, every step in its own foreground call:
  1. `perl -e 'alarm 580; exec @ARGV' node scripts/throwaway-iris.mjs up --image <IRISHEALTH_COMMUNITY_IMAGE> --namespace HSCUSTOM --host-port 52792 --state <scratch>/s.json`;
  2. `session` with a script enabling `%Service_DocDB`;
  3. `exec --state <f> -- node scripts/ci-seed-throwaway.mjs`;
  4. `exec --state <f> -- pnpm --filter @iris-mcp/data exec vitest run --config vitest.integration.config.ts src/__tests__/data.integration.test.ts`: expected 9/9 DocDB lifecycle passes, not skipped;
  5. curl `-u _SYSTEM:SYS` `POST http://127.0.0.1:52792/api/executemcp/v2/tests` `{"target":"ExecuteMCPv2.Tests.DocDbRegisterTest","level":"class","namespace":"HSCUSTOM"}`: expected total 5, failed 0;
  6. the USER second-namespace check;
  7. the red mutation (rebuild, re-run step 4's property test, restore, rebuild);
  8. `session` disabling `%Service_DocDB`, then step 5 again: expected total 5, failed 0;
  9. `down --state <f>`, on every exit path, then `docker ps -a --filter label=iris-mcp.owner=throwaway` shows none of yours.
- The shared instance is not used for this story's IRIS-side tests. No `iris_doc_load` of a bootstrapped class goes there: the `%ALL` mapping would hand other projects a mid-story class.
- (once) `pnpm turbo run build` (timeout 600000) -- expected: success.
- (once) `pnpm --filter @iris-mcp/shared test`, then `pnpm --filter @iris-mcp/data test` (one command each, timeout 600000) -- expected: green.
- (once) `pnpm --filter @iris-mcp/all test` (timeout 600000; if it does not finish, split it by test file into calls that each finish inside the cap) -- expected: green.
- (once) `pnpm gen:governance-baseline:check`, `pnpm run gen:ipm:check`, `pnpm run lint`, `pnpm run type-check` (one command each) -- expected: pass; the baseline is unchanged at `1e62c5ad5bf7`/141, and the IPM tree is unchanged.

**Mutations (Rule 19; the implement stage writes the `mutation:` lines):**
- AC 44.1.2: drop the register call from the create path -> the docdb-register "fresh create" test, and live, the lifecycle property test (#822).
- AC 44.1.2 repair: key the repair on any error instead of 25051 -> the "already registered returns the original error" test.
- AC 44.1.3: skip the record GET -> the "missing record" test.
- AC 44.1.4: remove the 793 check in `DocDbRecord` -> `TestRegisterFollowsServiceState` or a denial unit, on the throwaway.
- AC 44.1.7: change a docdb document URL -> the capture pin.
- AD-33: delete an existing Dispatch route -> the route pin.

**Shared surfaces:**
- `fixtures/tools-list-snapshot.json` (the `iris_docdb_manage` description);
- `fixtures/sdk-golden-sanctioned-changes.json` (+1 entry);
- `bootstrap-classes.ts` embed, `BOOTSTRAP_VERSION` and `scripts/bootstrap-sequence.json`;
- the Dispatch UrlMap route list (+2);
- `DOCDB_REASON` (the `DOCDB_SKIPS` names are unchanged, so the lifecycle test names must not change);
- the Story 35.7 enabled-service call counts in `docdb.test.ts` (2 -> 3);
- the `CHANGELOG.md` top section.

Standing criterion: every test added or changed passes on a fresh environment, in either order.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
