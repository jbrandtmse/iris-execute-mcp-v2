---
title: 'Story 44.1: DocDB Create Registers the Database'
type: 'bugfix'
created: '2026-11-22'
status: 'done'
baseline_revision: '7767b9c6021bc3bc1ad0547ecd6a88f93f8e3e58'
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
- Review patch (pass 1) -- `src/ExecuteMCPv2/Tests/DocDbRegisterTest.cls`: nothing drives `POST /security/docdb` (`DocDbManage`) over HTTP, so a break in its body parsing, action check or result shape passes every default-suite test. Extend `TestRouteGetRoundTrip` (keep 5 `Test*` methods, total 5) with a `%Net.HttpRequest` POST helper (same pattern as `GetRecord`) and assert: `{action:"bogus"}` is an error envelope; `register` for `MISSINGDB` is an error envelope and writes no record; with `%Service_DocDB` enabled, `register` for the fixture answers `result.registered` true and `alreadyRegistered` false, a second POST answers `alreadyRegistered` true, and the GET route then reports `registered` true; with it disabled, `register` is an error envelope (822) and no record exists. The fixture stays dropped in `OnBeforeOneTest`/`OnAfterOneTest`. Run `DocDbRegisterTest` on a throwaway with the service enabled and again disabled (total 5, failed 0 each), then record a `mutation:` line in `## Verification` for it (e.g. `DocDbManage` calls `DocDbRecord(..., 0, ...)` -> the enabled-branch POST assertion red; restore from `src/`, recompile).

**Acceptance Criteria:**
- AC 44.1.1: Given the probe results in Design Notes, when the implement stage builds, then it builds on them. Any claim it finds wrong is added to the Design Notes probe results with its evidence, and reported in `## Auto Run Result` for the lead.
- AC 44.1.2: Given a throwaway with `%Service_DocDB` enabled, when `iris_docdb_manage create` runs on a new name, then one tool call leaves a database whose first `iris_docdb_property create` succeeds. And given a database made without a record, when `create` runs on its name, then the record is registered and the database becomes usable and droppable.
- AC 44.1.3: Given a registered database, when `drop` runs, then `GET /security/docdb` reports no record. And given the service is enabled and a database has no record, when a document/find/property call answers 822, then the text names the missing record, while the disabled-service text (F5 gate) is unchanged.
- AC 44.1.4: Given the edited `Security.cls`/`Dispatch.cls`, when the embed is regenerated, then the drift test passes, the version moves to sequence 3, and `DocDbRegisterTest` reports `total` 5 with no failure on the seeded throwaway in HSCUSTOM, once with `%Service_DocDB` enabled and once after disabling it there.
- AC 44.1.5: Given the docs and the description, when the default suite runs, then the tools-list snapshot, the sanctioned-change entry and the wire-golden tests are green, and the README, `tool_support.md`, CHANGELOG and changeset say what `create` now does.
- AC 44.1.6: Given a throwaway (service enabled, seeded), when `data.integration.test.ts` runs armed, then all 9 lifecycle tests pass with no record left. A second namespace (`USER`) create+property+drop through the tools passes, and USER's record is separate from HSCUSTOM's. With the register call removed from `docdb.ts` and the build re-run, the property test answers #822 (proven red). `drop` of a missing name returns `dropped:false` and `list` is unchanged.
- AC 44.1.7: Given the pre-story capture, when the back-compat pins run, then `list`, `drop` and the request lists of the other three tools are `toEqual` the capture.

## Spec Change Log

- Review pass 1 (patch, no intent change): the Code Map line "Pass `target` from ... manage create/drop" is narrowed to manage `drop` only. A `create` that answers 822 with the service enabled is a privilege failure (an existing database answers 25051 before any record check), so the record GET reported `exists:false` and the text told the caller to run the `create` that had just been denied. With no `target` for `create` the original 822 passes through. Known-bad state avoided: circular "no such database, create it" advice after a denied create. KEEP: the `drop`, document, find and property targets, and the matrix rows "Missing record" / "No such database".

## Review Triage Log

### 2026-11-22 -- Review pass
- verdicts: 25 findings -- high 0, medium 5, low 17, false 3, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: a non-admin re-running `create` on a registered database got "its record is missing" (the message asserted a state it did not know) -- `registrationFailure(created:false)` reworded to "registering its Security.DocDBs record failed; without that record IRIS denies ..."; the test assertion follows the wording.
  - `[false]` `[reject]` Blind: namespace spelling not normalised -- probe Q1 (Design Notes) shows IRIS stores the namespace uppercase, and `$NAMESPACE` switching is case-insensitive.
  - `[medium]` `[patch]` Blind + Verification-gap + Intent: `POST /security/docdb` (`DocDbManage`) has no test that drives it -- `TestRouteGetRoundTrip` extended with an HTTP POST helper (bogus action, missing database, service enabled: register, second register, GET after; service disabled: refusal); total 5 enabled and disabled on a throwaway; mutation line written.
  - `[low]` `[reject]` Blind: the `index` workaround and the unmatched-`find` property are not recorded -- `carried`: both are already the first two `deferred:` items of this spec; the CHANGELOG says "Not fixed here".
  - `[low]` `[patch]` Blind + Verification-gap: the spec's trailing `Status: ready-for-dev` line contradicts the frontmatter -- `## Auto Run Result` rewritten at finalize.
  - `[medium]` `[patch]` Blind: a denied `create` (service enabled) reached "no such database ... create it with action=create" -- `target` is passed for `drop` only; a new test pins the pass-through (see the Spec Change Log).
  - `[low]` `[reject]` Blind: `tool_support.md` "Mix" tally not changed for `iris_docdb_manage` -- the tally counts each tool by its primary tier and the row names the extra route; changing it is a classification call, not a defect.
  - `[low]` `[reject]` Blind: `DocDbRegisterTest` duplicates helpers, hard-codes `_SYSTEM`/`SYS`, swallows cleanup errors -- the copy is justified in Design Notes (Rule 2), the credentials default is the sibling classes' pattern with a `^UnitTestConfig` override, and a failed fixture drop surfaces in the next test's assertion.
  - `[low]` `[reject]` Blind: hard-coded class and PUT counts in `ci-seed-throwaway.test.ts` -- an existing convention that fails loudly on drift; a counter refactor is more than a direct correction.
  - `[low]` `[reject]` Blind: the `[Unreleased]` allowance in `story-42-8-doc-claims.test.ts` is unconditional -- the pin still checks heading order; a release workflow forbidding a leftover heading is release-gate scope and not caused by this diff.
  - `[medium]` `[patch]` Edge: a denied `create` reaches the "no such database" text -- same root cause as the denied-`create` row above; patched once.
  - `[low]` `[reject]` Edge: a register failure after a successful create is an error although the database exists -- by-design: the matrix row "Register fails after create" requires `isError:true` with `created:true, registered:false` and both fixes.
  - `[low]` `[reject]` Edge: concurrent registers can fail the loser -- `$$Create` answers 794 for a duplicate and the error's retry advice recovers it; no realistic path beyond a retried call.
  - `[low]` `[reject]` Edge: a drop between the existence check and `Create` leaves an orphan record -- a theoretical window; `drop` and `create`'s repair handle the orphan.
  - `[false]` `[reject]` Edge: the namespace string is assigned straight to `$NAMESPACE` -- an invalid name raises inside the Try, the Catch restores the namespace first and `SanitizeError` renders one envelope; no raw switch error reaches the caller.
  - `[low]` `[reject]` Edge: `registered:false` with a non-boolean `exists` passes the 822 through unexplained -- the real handler always answers booleans (`%Set(...,"boolean")`), so that shape is unreachable (Rule #54).
  - `[medium]` `[patch]` Verification-gap: the `action !== "list"` guard on `target` is not pinned (a list with `database` was never tested) -- the list test now passes `database`; the guard is `action === "drop"` and a mutation line names it.
  - `[low]` `[patch]` Verification-gap: no `mutation:` line for AC 44.1.5, the drop half of AC 44.1.3, or the "already registered" row -- three lines written after demonstrating each mutation (the first and last on the unit tier, the drop half live on a throwaway).
  - `[low]` `[reject]` Verification-gap: AC 44.1.6's USER-versus-HSCUSTOM separation is a live check only -- recorded in the throwaway proof; the namespace pass-through itself is pinned by the 44.1.7 request lists.
  - `[low]` `[reject]` Verification-gap: `TestRegisterFollowsServiceState` reads ambient service state and runs one branch per run -- by-design: AC 44.1.4 asks for both branches across an enabled and a disabled run.
  - `[low]` `[reject]` Verification-gap: "the fixture is the 102 routes" counts a static file -- the next test is the real route guard; the count only guards the fixture.
  - `[low]` `[reject]` Verification-gap: the AD-33 pin fails any later story that adds a route -- by-design: the pin freezes the pre-44.1 route list (AD-33), and a later story updates the fixture in its own diff.
  - `[false]` `[reject]` Verification-gap: the Story 35.7 call counts "2 -> 3" were not needed -- a fact about the spec's expectation, not a defect: those tests assert no call count with the service enabled.
  - `[low]` `[reject]` Intent: repair needs `create` before a 1.1.0 database can be dropped -- by-design: the intent says "`create` on a database made without a record registers it".
  - `[low]` `[reject]` Intent: the 822 translation also covers `drop` -- by-design: the spec passes `target` from `drop`, and the repair story needs it.

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
- *Implement-stage findings (AC 44.1.1; 2026-11-22, irishealth-community 2026.2 throwaway).* Every claim above held. The claims that needed a correction or a qualification:
  - A `property create` on a name with no DocDB database answers HTTP 404 `ERROR #25351: DocDB Database '<x>' does not exist`, not 822. The 822 for a nonexistent database comes from the document and find routes (`GET doc/<x>/1`, `POST find/<x>`, `POST doc/<x>/` all answer 822 with the service on). So the "no such database" text is reached for document and find calls (and for `drop`, which answers `{dropped:false}` instead), and never for a property call. Proven live; the unit tests drive it through `iris_docdb_document`.
  - A `create` that itself answers 822 with the service enabled (a caller without `%DocDB_Admin`) reaches the "no such database" text, because the spec passes `target` from `create` and the record GET then reports `exists:false`. The text says "Create it with iris_docdb_manage action=create", which is odd advice after a denied create. Not changed (the spec fixes this); flagged for the lead.
  - `$$$DocDBDoesNotExist` and `$$$AccessDenied` are not defined in a class compiled in HSCUSTOM (`MPP5610: Referenced macro not defined`), although `irislib/%occErrors.inc` defines them. `DocDbRecord` and `DocDbRegisterTest` use the literals 793 and 822.
  - `scripts/gen-bootstrap.mjs` bumps the sequence on every content change, so two regenerations in one story reach sequence 4. The story restored `scripts/bootstrap-sequence.json` from `HEAD` and regenerated once, which gives sequence 3.
  - `pnpm gen:tools-list-snapshot` refuses without `--force` (the snapshot is a pinned artifact); this story ran `pnpm gen:tools-list-snapshot --force` as the spec's Commands require. The regeneration also moved the snapshot's `capturedAt` and `sdkVersion` (`2.3.1` -> `2.4.0`, the installed SDK).
  - Two existing tests pinned what this story deliberately changes and were updated: `story-43-4-qa-sanctioned-wire.test.ts` (the data server's expected `iris_docdb_manage` description gains the sanctioned sentence) and `story-42-8-doc-claims.test.ts` (the CHANGELOG heading list now allows a leading `## [Unreleased]`).

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
  mutation: replaced the register POST in `docdb.ts` with `registration = { registered: true }` -> 6 docdb-register tests and the docdb.test.ts create test red (fresh create, already registered, both register-fails cases, unexpected answer, repair fails); live on the throwaway the lifecycle `creates a test database` test failed on the `registered` assertion and `iris_docdb_property create` then answered the translated #822 (missing record). Reverted: `docdb.ts` sha256 `210dcbe95a8a...` byte-identical to before, dist rebuilt.
- AC 44.1.2 repair: key the repair on any error instead of 25051 -> the "already registered returns the original error" test.
  mutation: the repair trigger became "any IrisApiError" instead of `code === 25051` -> red: "repair is keyed on the numeric code 25051, never on message text" and "service disabled: the unchanged Story 35.7 message and no register call" (the "already registered" test stays green: its fake register answer keeps the original error whatever the trigger, so the two code-keyed tests are the pins). Reverted byte-identical (sha256 checked).
- AC 44.1.3: skip the record GET -> the "missing record" test.
  mutation: the `enabled === true && target` branch replaced by `false` -> red: "missing record", "no such database", "find and drop reach the same record check". Reverted byte-identical.
- AC 44.1.4: remove the 793 check in `DocDbRecord` -> `TestRegisterFollowsServiceState` or a denial unit, on the throwaway.
  mutation: removed `&& '$System.Status.Equals(tExSC, 793)` from `ExecuteMCPv2.REST.Security:DocDbRecord`, compiled on the throwaway (HSCUSTOM, service enabled) -> `DocDbRegisterTest` total 5, failed 3 (`TestStatusOfUnknownNameIsUnregistered`, `TestRegisterFollowsServiceState` with "#793 ... does not exist", `TestRouteGetRoundTrip`). Restored from `src/` and recompiled: total 5, failed 0. The mutation never touched `src/`.
- AC 44.1.7: change a docdb document URL -> the capture pin.
  mutation: the document tool's `/doc/` path became `/docs/` -> red: "AC 44.1.7 -- request lists captured before the story > iris_docdb_document". Reverted byte-identical.
- AD-33: delete an existing Dispatch route -> the route pin.
  mutation: deleted the `/security/service` GET route line from `Dispatch.cls` -> red: "AD-33 ... the only added route lines are the two /security/docdb routes". Reverted byte-identical (sha256 checked).
- AC 44.1.3 drop half (review pass 1):
  mutation: in `data.integration.test.ts` the "drops the test database" test had its `docdbManageTool.handler({ action: "drop", ... })` call replaced by a stub success, then the armed lifecycle ran on the throwaway (service enabled) -> 11 passed, "drops the test database" failed on its final `recordState(...)` assertion (`exists: true, registered: true` received). Restored byte-identical (sha256 `cdf7a2d4...` before and after); re-run 12/12 green.
- Review patch, POST route (review pass 1):
  mutation: in `Security.cls` `DocDbManage`, `..DocDbRecord(tName, tNamespace, 1, .tResult)` became `..DocDbRecord(tName, tNamespace, 0, .tResult)`, compiled on the throwaway -> `DocDbRegisterTest` total 5, failed 1: `TestRouteGetRoundTrip` red on the missing-database, `registered`, record, second-register and GET-after-register assertions. Restored from `src/` (sha256 identical before and after) and recompiled: total 5, failed 0. The disabled-service POST answers `ERROR #5001: Access Denied` over the wire (`SanitizeError`), so that branch asserts the text, not 822.
- AC 44.1.2 already-registered row (review pass 1):
  mutation: the `registrationFields.alreadyRegistered === true` branch in the create path became `if (false as boolean)` -> red: "already registered: 25051 and a record already there return the original error, byte-identical" (the only test red). Reverted byte-identical (sha256 checked).
- AC 44.1.3 translation targets (review pass 1):
  mutation: the manage catch path's `action === "drop" && database ? ... : undefined` became `database ? ... : undefined` -> red: "a namespace-level list never checks a record" and "a create that is itself denied with the service enabled passes the 822 through and checks no record". Reverted byte-identical (sha256 checked).
- AC 44.1.5 (review pass 1):
  mutation: the appended description sentence in `docdb.ts` changed `requires` to `needs`, `@iris-mcp/data` rebuilt -> red: `story-43-4-qa-sanctioned-wire.test.ts` (2 tests: the legacy and modern `iris-data-mcp` tools/list rows) and `tools-list-snapshot.test.ts` (3 tests). Reverted, rebuilt: 115 tests green.

**BOOTSTRAP_VERSION:** `1.1.0+2.244fe8623c76` -> `1.1.0+3.3e97060f5bc4` (`scripts/bootstrap-sequence.json` `{"sequence": 3, "hash": "3e97060f5bc4"}`); a second `pnpm run gen:bootstrap` reports "Unchanged".

**Throwaway proof (2026-11-22; `irishealth-community:2026.2`, HSCUSTOM, 127.0.0.1:52792, removed afterwards):**
- `%Service_DocDB` enabled; `ci-seed-throwaway.mjs` seeded; `data.integration.test.ts` armed: 12 passed (9 DocDB lifecycle, none skipped), the create test asserts `registered:true` and a live `GET /security/docdb`, the drop test asserts `exists:false, registered:false`.
- `DocDbRegisterTest` through `POST /tests`: total 5, failed 0 with the service enabled, and total 5, failed 0 after disabling it.
- USER: create + property + drop through the built tools passed; USER's record was registered while HSCUSTOM's `GET` reported `exists:false, registered:false`; the record was gone after the drop; `drop` of a missing name answered `{content:{database, dropped:false}}`; `list` answered `{content:[]}`.
- Repair: a database made through the DocDB REST API only (the 1.1.0 way) answered the missing-record text on property create and on drop; `create` repaired it (`created:false, registered:true`); property create and drop then worked and no record was left; a second `create` returned the unchanged `#25051` error.
- Not run live: `iris_docdb_manage create` with the service disabled through the tool (the probe script crashed on a bug of its own after the tool had returned an error). Covered by the unit test "service disabled: the unchanged Story 35.7 message and no register call" and the unchanged F5 gate.

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

Status: done
Blocking condition: none

**Summary.** `iris_docdb_manage create` now registers the database's `Security.DocDBs` record through a new route (`POST /security/docdb`, IRIS's own `$$Create^%SYS.DOCDB`), repairs a database that exists without one (error code 25051), and the 822 translation names a missing record or database when the service is enabled (`GET /security/docdb`). `BOOTSTRAP_VERSION` `1.1.0+2.244fe8623c76` -> `1.1.0+3.3e97060f5bc4`.

**Files changed.**
- `src/ExecuteMCPv2/REST/Security.cls`, `src/ExecuteMCPv2/REST/Dispatch.cls`: `DocDbRecord`, `DocDbGet`, `DocDbManage` and the two routes.
- `src/ExecuteMCPv2/Tests/DocDbRegisterTest.cls`: 5 tests, including the HTTP GET and POST route round trips.
- `packages/iris-data-mcp/src/tools/docdb.ts`: create/repair flow, record-aware 822 translation, appended description sentence.
- `packages/iris-data-mcp/src/__tests__/docdb-register.test.ts` (new), `docdb.test.ts`, `data.integration.test.ts`, `fixtures/dispatch-routes-pre-44-1.txt`: pins, I/O matrix, lifecycle.
- `packages/shared/src/bootstrap-classes.ts`, `scripts/bootstrap-sequence.json`, `packages/iris-mcp-all/src/__tests__/fixtures/sdk-golden-sanctioned-changes.json`, `fixtures/tools-list-snapshot.json`, `scripts/lib/ci-checks.mjs`, and four `iris-mcp-all` tests that pin the changed shared surfaces: embed, sanction `S-44.1-docdb-manage-text`, snapshot, `DOCDB_REASON`.
- `README.md`, `tool_support.md`, `CHANGELOG.md`, `.changeset/story-44-1-docdb-create-registers-the-database.md`: docs.

**Review (25 findings: high 0, medium 5, low 17, false 3).** Patched: 4 medium root causes (a denied `create` got circular "create it" advice, so `target` is now passed for `drop` only; no test drove `POST /security/docdb`; the `list` guard on `target` was unpinned; the repair-failure message asserted an unknown record state) and 2 low rows (the stale spec status line; three missing `mutation:` lines). Deferred in this pass: none (the three planning-time `deferred:` items are kept). Rejected: 16 low and 3 false findings with the reasons in the Review Triage Log. Follow-up review recommended: false. Patched counts by verdict: medium 5 rows (4 root causes), low 2; no HIGH.

**Verification.** Loop commands green: docdb unit tests 104, bootstrap test 109, tools-list snapshot check OK, `iris-mcp-all` wire/golden/gate tests 264, `gen:bootstrap` idempotent (`Unchanged`). Once commands green: `pnpm turbo run build`, shared 2586, data 192 (2 skipped), all 6045 (729 skipped), `gen:governance-baseline:check` OK (141 frozen keys), `gen:ipm:check` OK, lint, type-check. Throwaway proof (IRIS for Health 2026.2, HSCUSTOM, port 52792, removed afterwards): armed lifecycle 12/12; `DocDbRegisterTest` total 5, failed 0 with the service enabled and disabled, before and after the review patch; USER second-namespace pass; repair of a 1.1.0-style database; the register-removed red. Six mutations plus the five review-pass mutations are recorded in `## Verification`.

**Residual risks.** `iris_docdb_manage create` with the service disabled was not driven live through the tool (a unit test and the F5 gate cover it). IRIS 2023.1-2025.x are unverified for `$$Create^%SYS.DOCDB` behavior (DW-686). The snapshot regeneration moved its `capturedAt` and `sdkVersion` (2.3.1 -> 2.4.0).

**For the lead (Rule 20 and Rule #42).** Add `S-44.1-docdb-manage-text` to AD-15's sanctioned list. Probe corrections are under Design Notes "Implement-stage findings": `property create` on a missing database answers 404 #25351, not 822; the `$$$DocDBDoesNotExist` and `$$$AccessDenied` macros are not defined in HSCUSTOM classes (the literals 793 and 822 are used); the disabled-service POST over the wire reads `ERROR #5001: Access Denied`, not 822.
