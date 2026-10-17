---
title: 'Story 39.1: Message Header Search'
type: 'feature'
created: '2026-10-16'
status: 'done'
baseline_revision: 'aee1631db5e00d6bbb175dc966e80b08b89d3bac'
baseline_commit: 'aee1631db5e00d6bbb175dc966e80b08b89d3bac'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred:
  - summary: >-
      The executing path of resendFiltered (the TOP-n ID fetch that runs after guard f, then ResendBatch) is exercised by no test in this story's suite.
    evidence: |-
      The 20 replayed requests and every MessageResendTest method stop at guard d (more matches than the cap) or guard f (no production running); only MessageResendLiveTest reaches the fetch, and it starts a production in HSCUSTOM, which this story is forbidden to run. The statement was rewritten from literal SQL to tWhere/tParams, with the same construction as the sample statement the byte-identity rows do run, and a broken fetch fails safe (it resends nothing). Settle by running MessageResendLiveTest in a window the Lead approves, or by a smoke that starts a production in a disposable namespace.
    location: >-
      src/ExecuteMCPv2/REST/MessageResend.cls:567
    severity: medium
---

<intent-contract>

## Intent

**Problem:** An engineer cannot search Interoperability message headers without enabling a write. The only header search is the dry run of `iris_message_resend:resendFiltered`, and that key is a default-disabled write. The search also covers only item, status and window (G32).

**Approach:**
- Add the read tool `iris_message_search` (interop) with the `action` enum `headers` | `body` | `searchTable`, fixed now. `body` and `searchTable` return a `NOT_IMPLEMENTED` refusal until Stories 39.3 and 39.4.
- `headers` filters by window, item, source, target, status, session, body class and error flag. It returns paged header rows, never body data.
- Extract the filters-to-WHERE translation out of `resendFiltered` into one ObjectScript helper. The new route and `resendFiltered` both call it, and `resendFiltered`'s wire stays byte-identical.

## Boundaries & Constraints

**Always:**
- **No caller text in SQL text.**
  - The helper emits only fixed column names and `?`, and every value is bound.
  - The row cap is an integer the handler validated in range. Prefer `TOP ?`; interpolate only if the Task 0 probe shows `TOP ?` is unsupported, as `resendFiltered` does today.
- **Scope (AD-20).** `from` is required and `to` defaults to now. The window spans 0 to 7 days (orchestrator decision b), and IRIS refuses anything outside it before switching namespace or reading. There is no whole-namespace mode. `limit` (default 100, max 500) is an output cap, never timeout protection, and the description says so.
- **The helper's contract (AD-17).** It owns only the filters-to-WHERE translation. Each caller keeps its own required filters, window, caps, and its choice between refusing and truncating. `resendFiltered` keeps every guard, text and statement shape.
- **Timestamps.** Input is ISO 8601 with `Z` or an offset, and TS converts it to canonical UTC: whole seconds, plus `.fff` only when the millisecond part is non-zero, trailing zeros trimmed, the same form `Ens.DataType.UTC` `Normalize` stores. Output is `toISOString()` UTC with a `…Raw` sibling, and `""` (never a throw) when the value is empty or malformed.
- **The new handler** extends `REST.Base`, renders one envelope, and saves and restores `$NAMESPACE`, starting with the catch block (AD-11, AD-13). It runs its statements in Logical select mode (`%SelectMode=0`), so times stay UTC whatever the process default. Its validation texts name the parameter, never the value.
- **Documented defaults go out explicitly.** TS sends `to` and `limit` explicitly (Rule #10).
- **Results.** `structuredContent` comes with `content`. Interpretation lives in TS (AD-12): IRIS returns the raw `interopEnabled:false` signal (the `Health.cls:486-497` precedent), and TS reports `notApplicable`.
- **Classification and visibility.**
  - `mutates: { headers: "read", body: "read", searchTable: "read" }`, with no `defaultEnabled`.
  - Annotations: `readOnlyHint:true`, `destructiveHint:false`, `idempotentHint:true`, `openWorldHint:false`; `scope: "NS"`.
  - Presets: interop `core` include (10 package / 11 runtime) and `developer` include (23).
- **Live fixtures.**
  - All live work runs on `server:"default"`. Fixtures are synthetic: `Story391` names, timestamps on 2001-02-03 UTC, so a misrouted query can never match real traffic.
  - They live only in the disposable namespaces `EXECMCPTMP391A`, `EXECMCPTMP391B` and `EXECMCPTMP391C` and the HSCUSTOM class `ExecuteMCPv2.Temp.Story391Fixture`. All of them are removed, database files included, with nothing-left assertions (Verification).
- **Rule #16 / #47 probes.** Task 0 probes come first. If a Code Map claim proves wrong, correct the spec and record it.

**Never:**
- No change to `MessageTrace`/`iris_production_messages`, `PreviewOne`/`BodySummary` (Story 39.2 owns them) or the `resend`/`preview` actions.
- No PHI-policy work, no `TOOL_PAIRS` change (39.5), no prompt edit (39.6), and no `ipm/module.xml` edit (42.4).
- Headers never return `ErrorStatus` or `Description`: AD-26 names them as body-derived candidates for Story 39.2 to classify.
- No `%Library.EnsembleMgr.EnableNamespace` (orchestrator decision a). No security or service change on the shared instance. Never read HSCUSTOM's or another project's messages.
- No `mode` parameter. No raw SQL input. No `matchCount` (it would scan the whole window).
- Never run the bare governance-baseline generator, and never hand-edit `bootstrap-classes.ts`.
- Do not migrate the Epic 38 gates onto shared helpers (DW-561, Story 39.6).

## I/O & Edge-Case Matrix

The fixture **α** (namespace A) is about 12 headers. Together they cover:
- every filter dimension;
- rows exactly at `from` and at `to`, and a row outside the window;
- two rows with the same `TimeCreated`;
- a fractional-second time;
- an empty `TimeProcessed`, and a `CorrespondingMessageId`;
- a source name with literal `'`, `%`, `_` and `OR 1=1--`.

The fixture **β** (namespace B) is 3 headers with different items and sessions. Namespace C has no mappings.

**The oracle** is SQL written by hand and run through `atelierQuery` against the same namespace. Its order is `ORDER BY TimeCreated, ID`.

**A header row** has these fields:
- `id` (number), `sessionId` (number);
- `type` (`Request` | `Response` | `Terminate` | `Unknown`);
- `status` (the `StatusCodeToLabel` label, for example `Error`);
- `isError` (boolean);
- `sourceItem`, `targetItem`, `bodyClassName`, `bodyId` (strings);
- `timeCreated`, `timeCreatedRaw`, `timeProcessed`, `timeProcessedRaw`;
- `correspondingMessageId` (number or `null`).

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Window only | A; `from`/`to` covering α's day | The rows equal the oracle: ids, order and every field. Boundary rows are included and the outside row is not. | none |
| Each filter, and a combination | `item` (source or target), `source`, `target`, `status`, `sessionId`, `bodyClass`, `errorOnly:true` (`IsError=1`), and all of them ANDed | Each result equals its own oracle query | none |
| Hostile text | the odd source name searched exactly; `%`/`_` searched as names | That row only: equality, not `LIKE`. The values never reach SQL text. | none |
| Paging | `limit:3` over 7+ matches | Pages joined equal the oracle order, with no gap and no duplicate. The tie is broken by `ID`. Only a page that has `hasMore:true` carries `nextCursor`. | none |
| Defaults | `to` and `limit` omitted | The wire body carries `to` (now, UTC canonical) and `limit:100` | none |
| Offset input | `from:"2001-02-03T12:00:00+02:00"` | IRIS receives `2001-02-03T10:00:00Z` | none |
| Bad TS input | a naive, garbage or missing `from`; a malformed `cursor`; `limit` 0, 501 or 2.5 | `isError`, naming the parameter, not its value. No HTTP call. | Zod / handler |
| Bad direct-REST input | an unknown or missing `action`; a negative window, or one over 7 days; an unparseable time; `limit` out of range; an unknown status; a non-integer `sessionId` or `afterId`; `afterId` without `afterTimeCreated` | The envelope error is `result:{}`, named by parameter, and nothing is read | refusal |
| Not configured (Rule #41) | namespace C | Success: `notApplicable:true`, a `reason`, `rows:[]`, `hasMore:false` | none |
| Unknown namespace | `EXECMCPTMP391Z` | `isError` with the sanitized `SwitchNamespace` text | error |
| Second namespace (Rule #34) | the same filters against A and against B | α rows from A and β rows from B, each equal to its own oracle | none |
| Unbuilt actions | `body` or `searchTable` with a valid `from` | `refusalResult(NOT_IMPLEMENTED, …, {action, availableActions:["headers"]})`, no HTTP call, audit `outcome:"error"`, audit `action` = the action | refusal |
| Governance | `{"global":{"iris_message_search:headers":false}}` | `headers` gives `GOVERNANCE_DISABLED`. `body` still reaches `NOT_IMPLEMENTED`. The `read-only` preset leaves all three keys enabled. | denied |
| Resend wire (AD-17) | `resendFiltered` dry runs and guard refusals b–f over direct REST, against α | Each raw response body is byte-identical to the capture taken before the extraction | none |

</intent-contract>

## Code Map

**The probe record (AC-1; source read at baseline `34d59e0`).** `resendFiltered` (`src/ExecuteMCPv2/REST/MessageResend.cls:441-609`) works as follows.
- **Required.** `item` (:443) and `from` (:447).
- **Optional.**
  - `status`: default `"Errored"`, mapped by `StatusLabelToCode` (:25-39), which also accepts `Error`. 0 means unknown, which is refused (:455).
  - `to`: default `$ZDATETIME($ZTIMESTAMP,3)`, UTC (:463).
  - `maxMessages`: default 100, refused below 1 and above 500 (:489-502).
  - `dryRun`: default 1. `confirm`: default 0.
- **Timestamps.** `NormalizeTimestamp` (:57) changes `T` to a space, strips `Z`, and adds midnight to a bare date. `WindowDays` (:71) uses `$ZDATETIMEH(…,3)`; an unparseable value is refused (:466-472). The window is refused when negative (:475) and when over 7 days (:481).
- **Guards.** Guard e (execute without confirm) comes before the namespace switch (:512). Then come the switch (:519), the count (:525-536), and, on execute only, guard d (count over cap, :540) and guard f (`Ens.Director.IsProductionRunning`, :549). The fetch then uses `TOP <maxMessages>`, interpolated after the `+` coercion (:557).
- **The query.** Every statement shares one WHERE: `(SourceConfigName = ? OR TargetConfigName = ?) AND Status = ? AND TimeCreated >= ? AND TimeCreated <= ?`, with params item, item, code, from, to. The statements are the COUNT (:525), the fetch (:557) and the dry-run sample (`TOP 20 ID, SourceConfigName, TargetConfigName, Status, TimeCreated, SessionId … ORDER BY TimeCreated`, :580).
- **The dry-run result** (:597-607): `{action, dryRun, matchCount, sample[{id, sourceItem, targetItem, status (label), timeCreated (raw), sessionId}], item, status (as supplied), from, to (normalized), maxMessages}`.
- **The TS side** (`message-resend.ts`):
  - It omits undefined fields (:449-459).
  - Its local `odbcToIso` (:177-181) passes non-ODBC values through.
  - `STATUS_LABELS` (:47-57) is local.
  - The tool's annotations are destructive (:346-351), with `mutates` at :358-362.

**IRIS side**
- `src/ExecuteMCPv2/REST/MessageResend.cls`: reuse `StatusLabelToCode` (:25), `StatusCodeToLabel` (:43, which emits `Error`), `NormalizeTimestamp` (:57) and `WindowDays` (:71). Cross-handler calls have a precedent: `##class(ExecuteMCPv2.REST.Command).TeardownRedirect` at `REST/Sql.cls:110`.
- `src/ExecuteMCPv2/REST/Dispatch.cls`: the Epic 26 routes are at :118-120. The new route `POST /interop/message/search` (singular, like resend) goes after :120, under an `<!-- Epic 39 (Story 39.1) -->` comment. %CSP.REST matches whole URLs, so it conflicts with nothing.
- `src/ExecuteMCPv2/REST/Interop.cls:1359-1440` `MessageTrace` and `Diagram/Loader.cls:64-73` are the other header readers. Both are untouched; they show the `TOP cap+1` truncation idiom and the "dynamic `%SQL.Statement` only, never embedded SQL" rule (`Loader.cls:17-20`).
- `src/ExecuteMCPv2/REST/Health.cls:479-497`: the `interopEnabled:false` raw-signal precedent.
- `src/ExecuteMCPv2/Utils.cls`: `SwitchNamespace` (:50), `ValidateRequired` (:77), `SanitizeError` (:124) and `ReadRequestBody` (:1124).
- `irislib/Ens/MessageHeaderBase.cls`:
  - The properties are at :16-86. `TimeCreated` is `Ens.DataType.UTC`, and its stored values are UTC `yyyy-mm-dd hh:mm:ss.fff` (`$$$timeUTC`, `EnsUtil.inc:24`).
  - `UTC.cls:9-17` converts to *local* time in ODBC and Display modes, which is why the handler uses Logical mode.
  - `MessageStatus` codes 1-9 (`MessageStatus.cls:11-13`) and `MessageType` codes 1-3.
- `irislib/Ens/MessageHeader.cls`: the SQL table is `Ens.MessageHeader`, with no `SqlFieldName` overrides.
  - Indexes on `TimeCreated` (:14), `Status`, `SourceConfigName`, `TargetConfigName` and `MessageBodyClassName` (bitmaps), and `SessionId`. There is no index on `IsError`.
  - `ID` comes from `$Increment(^Ens.MessageHeaderD)`, so a fresh database numbers α from 1, which keeps the wire deterministic.
  - A plain `%New`+`%Save` does not set `TimeCreated` (`MessageResendTest.cls:82-85`). `NewRequestMessage` (:57-81) does.
- `src/ExecuteMCPv2/Tests/MessageResendTest.cls` has 12 `Test*` methods, among them `TestHttpGuardRefusals` (:328) and the dry-run rows (:368, :390). Its seed helpers (:60-102) are the `%New` pattern.
  - `MessageResendLiveTest.cls` is NOT run: it starts a production in HSCUSTOM and deletes `ID > ?`.

**Bootstrap**
- `scripts/gen-bootstrap.mjs:14-45` `classes[]` has 30 entries, `REST.MessageResend` at :34 and `REST.Dispatch` last at :44. The new class `REST/MessageSearch.cls` goes after :34.
- `packages/shared/src/__tests__/bootstrap.test.ts`:
  - the counts at :1027 and :1090, which go from 30 to 31;
  - the names at :1031-1062;
  - the base-before-extenders list at :1129-1146;
  - the `classPaths` roster at :1260-1291.
- `packages/shared/src/bootstrap-classes.ts:25`: `BOOTSTRAP_VERSION = "089f8f0a62b2"`.

**TypeScript, interop**
- `packages/iris-interop-mcp/src/tools/index.ts:62-85`: the 22-tool array. Imports go at :57-59, and the header comment at :1-13 holds the counts.
- `packages/iris-interop-mcp/src/tools/presets.ts:23-79`: `core.include` (9) and `developer.include` (22); the header comment at :8-13.
- The precedents:
  - the all-read `mutates` record of `iris_sql_analyze` (`packages/iris-dev-mcp/src/tools/sqlAnalyze.ts:500-518`);
  - `toStructured` and the error mapping in `message-resend.ts` (:162-170, :492-504).
- `packages/shared/src/refusals.ts:15-28` `REFUSAL_CODES` and `refusalResult` (:55-67). The call-site precedent is `iris-dev-mcp/src/tools/sql.ts:152-157`.
- `packages/shared/src/server-base.ts`:
  - the audit `action` is derived from the `action` argument (:1678, :1749-1762);
  - the governance key `tool:action` (:1221-1241);
  - only `GOVERNANCE_DISABLED` audits as `denied`; other refusals audit as `error` (:1769-1776);
  - `paginate` omits `nextCursor` when there are no more items (:297-303).
- Test helpers: `@iris-mcp/shared/test-helpers` (`packages/shared/src/__tests__/test-helpers.ts`) exports `makeEnvHarness`, `stageDefaultStartup` (:24), `callTool` (:40), `createMockHttp` (:57), `createMockCtx` (:81) and `envelope` (:118). The audit JSONL read pattern is in `packages/shared/src/__tests__/audit-interceptor.test.ts:104, :174-200`.

**Count and doc pins that move** (interop 22→23 package / 23→24 runtime; `core` 10→11 runtime; suite 107/112→108/113; `developer` totals 79/84→80/85; `core` totals 51/56→52/57)
- Interop package tests:
  - `index.test.ts` :24, :38, :46-48, :71, :80, plus the name list at :81-103;
  - `presets.test.ts:52-56`, including its title.
- `packages/shared/src/__tests__/pre-feature-tool-snapshot.ts` :19 and :86-109, checked by `iris-mcp-all/.../tool-visibility-snapshot-drift.test.ts` against shared's BUILT dist, so rebuild shared.
- `packages/shared/src/__tests__/tool-visibility-backcompat.test.ts:126`.
- `packages/iris-mcp-all/src/__tests__/docs-prompt-sync.test.ts` :119-138 (the literal `"107 tools"`), with `README.md:21` and `docs/migration-v1-v2.md:11,29`.
- `docs-visibility-roster-sync.test.ts` derives its values live from these doc rows:
  - root `README.md` :667-669 (roster), :687 (payload), and :691 (`Last re-measured at Story 39.1`, a format pinned by `story-38-6-doc-claims.test.ts:308-309`);
  - `packages/iris-mcp-all/README.md:45`;
  - interop `README.md:45`;
  - the FIRST `` `full` N/N/N/N/N `` in `CHANGELOG.md`, which is the Epic 30 section at :1083-1085 and is edited in place to "as of Story 39.1". The new 39.1 section must not contain that pattern.
- Not pinned, moved by precedent:
  - `README.md` :17, :675, :723 and :771 (diagram), plus a governance-defaults row after :542 (the `iris_sql_analyze` all-reads pattern);
  - `tool_support.md` :160 (`(22)`), a row after :185, :187 (Mix), a Story 39.1 note after :195, and :386, :389, :401 and :415;
  - interop `README.md`: a Production Monitoring row (:154-161), a `####` subsection with a `> **Governance default:**` line (the precedent is :167), and :851;
  - `packages/iris-mcp-all/README.md:27,31`;
  - `docs/epic-summary.md:3`.
- Not affected: `gen:skills:check` (it reads prompts only), `validate:prompts`, `check-epics-sync`, the frozen baseline, and the "8- to 15-tool" phrase. The universe key count goes from 207 to 210 and is not pinned.

**Live harness** (`packages/iris-mcp-all/src/__tests__/`)
- `process-gate-helpers.ts`:
  - `openWireSession`/`withWireSession` (:237, :279). An args `namespace` overrides the session's namespace (:270).
  - `atelierQuery(target, sql)` (:329). It builds its URL from `target.namespace` (:301), so `{...TARGET, namespace:"EXECMCPTMP391A"}` aims it at the scratch namespace.
  - Also `staleDistReason` (:41), `isIrisReachable` (:56), `irisTargetFromEnv` (:162), `connectionEnv` (:173), `shippedBootstrapVersion` (:361) and `assertDeployedBootstrapVersion` (:382).
- The precedents:
  - `epic38-capstone-gate.test.ts:148-280`: `putDoc`/`compileDoc` closures over one session, `iris_execute_classmethod` seeding, and the `beforeAll`/`afterAll` nothing-left checks;
  - `scripts/prepublish-gate.mjs:105-136`: the roster with a comment per entry; `DRIVEN_PACKAGES` already lists interop and admin;
  - `live-gate-roster.test.ts`: a file is armed if it matches `/process\.env\.IRIS_REQUIRE_LIVE\s*===/`.

**Namespace lifecycle** (read-only probe, 2026-10-16, IRIS 2026.2 build 221U, HEALTHSHARE feature enabled)
- **Governance.** `iris_server_profiles` shows these enabled by default, as frozen-baseline keys: `iris_database_manage:create`/`:delete`, `iris_namespace_manage:create`/`:delete`, `iris_mapping_manage:create`/`:delete`, `iris_doc_put`, `iris_doc_compile`, `iris_doc_delete` and `iris_execute_classmethod`.
- **Mappings.**
  - `iris_mapping_list` on HSCUSTOM: packages `Ens`, `EnsLib`, `EnsPortal` and `CSPX.Dashboard` → `ENSLIB`; routine `Ens*` → `ENSLIB`.
  - On `%ALL`: package `ExecuteMCPv2` → `HSCUSTOM`, so the Temp fixture class and the handlers resolve in any new namespace.
- **The manager directory** is `/durable/iris/mgr/` (`iris_database_list`).
- **Admin handlers.**
  - `iris_database_manage:create` requires `directory`, and calls `CreateDirectoryChain`, `SYS.Database.CreateDatabase` and `Config.Databases.Create` (`Config.cls:331-386`).
  - Its `delete` is config only (`Config.cls:437`). `IRIS.DAT` and the directory stay, so they need `SYS.Database.DeleteDatabase(dir)` (`irissys/SYS/Database.cls:619`) plus `%File.RemoveDirectoryTree`.
  - `iris_namespace_manage` has no interop flag (`Config.cls:100-148`).
- **`EnableNamespace`** (`irislib/%Library/EnsembleMgr.cls:1738`) has side effects beyond the namespace:
  - on this HealthShare instance it runs `EnableHealthShareNamespace` (:1816-1822);
  - it creates a portal application (:1825);
  - it grants SQL privileges (:1829);
  - it adds a role to the SHARED `/api/interop-editors` application (:1833, :2833-2841).

  Its mapping step alone (:2329-2369) is what makes `Ens.MessageHeader` visible.

## Tasks & Acceptance

**Execution** (in dependency order):

*Task 0: probes and the baseline capture, before any ObjectScript edit.*
1. **Probes (Rule #16; Verification step L).** Use a throwaway `EXECMCPTMP391P`, built and torn down by Verification steps L1–L5, and `ExecuteMCPv2.Temp.Story391Probe*` classes, deleted before return. Confirm each of these:
   - (a) A mapping-only namespace hosts `Ens.MessageHeader` `%Save` and SQL.
   - (b) `%ExecDirect(, sql, args...)` works with a local array.
   - (c) Whether `TOP ?` is supported.
   - (d) `$ZDATETIMEH` parses fractional seconds.
   - (e) Atelier's query select mode for `TimeCreated`/`Status`, and `$ZTIMEZONE`.
   - (f) `Config.Namespaces.Delete` removes the namespace's mappings.
   - (g) `SYS.Database.DeleteDatabase` needs no dismount.
   - (h) No `/csp/<ns>` application or `%DB_<ns>` resource is created.
   - (i) The deployed bootstrap version is `089f8f0a62b2`.

   Record each result under Verification. If (a) fails, HALT `blocked`, because it needs the Lead's `EnableNamespace` call.
2. `packages/iris-mcp-all/src/__tests__/interop-namespace-fixture.ts` (new; the harness the gate and Stories 39.3–39.6 use):
   - `createInteropNamespace(admin, dev, name, {interop})` and `removeInteropNamespace(admin, dev, name)`. The remove is idempotent and ignores what is already gone.
   - `seedHeaders(dev, name, set)` and `leftovers(dev, names)`.
   - `FIXTURE_CLASS_SOURCE`: the `ExecuteMCPv2.Temp.Story391Fixture` source. Its methods:
     - `ManagerDirectory`;
     - `Seed(pSet)`: α or β, synthetic, with an explicit `TimeCreated`, literal codes and no `$$$` macros;
     - `RemoveDatabaseFiles(pName)`: refuses any name not matching `1"EXECMCPTMP"1.N1U`, then `DeleteDatabase` and `RemoveDirectoryTree`, in `%SYS`;
     - `Leftovers(pNames)`: a JSON list of every remaining namespace, database config, mapping, `SYS.Database`, directory, `/csp/<ns>` application or `%DB_<ns>` resource.
   - The steps follow Verification step L.
3. `packages/iris-mcp-all/src/__tests__/process-gate-helpers.ts`:
   - add `executeMcpPost(target, path, body)`, returning `{status, text}`. It is the raw POST sibling of `atelierQuery` and reuses its auth.
   - add `docFixtures(session)`, returning `{putDoc, compileDoc, removeDoc}` built over one session (DW-561 progress; the existing gates are not migrated).
4. `packages/iris-mcp-all/src/__tests__/story-39-1-message-search-live-gate.test.ts` (new): write the `resendFiltered` request list and its capture row. The capture row `it.runIf(process.env.STORY_39_1_CAPTURE === "1")` writes `src/__tests__/fixtures/story-39-1-resend-baseline.json`: `{capturedWithBootstrapVersion, irisVersion, capturedAt, command, cases:[{name, body, status, text}]}`.
   - Requests: dry runs (status default, status `Completed`, `to` explicit), plus guards b (item, from), c (negative, over 7 days, unparseable), the status and `maxMessages` bounds, e, d (seeded over-cap) and f (no production running). Every one carries an explicit `to` on 2001-02-03.
   - Run the capture against α with the PRE-change classes deployed (Verification step C).

*Task 1: IRIS side.*
5. `src/ExecuteMCPv2/REST/MessageSearch.cls` (new, extends `ExecuteMCPv2.REST.Base`):
   - **`HeaderWhere(pFilters As %DynamicObject, Output pWhere As %String, Output pParams) As %Status`**: the shared helper.
     - Keys: `item`, `source`, `target`, `statusCode`, `fromNorm`, `toNorm`, `sessionId`, `bodyClass`, `errorOnly`.
     - Fixed fragment order: `(SourceConfigName = ? OR TargetConfigName = ?)`, `SourceConfigName = ?`, `TargetConfigName = ?`, `Status = ?`, `TimeCreated >= ?`, `TimeCreated <= ?`, `SessionId = ?`, `MessageBodyClassName = ?`, `IsError = 1`, joined with ` AND `.
     - `pParams` is the count, with `pParams(i)` the values. The helper never validates and never sees caps.
   - **`HeaderRow(pRS) As %DynamicObject`**: the matrix row shape, with type and status labels from `MessageResend`. Its select list never includes `ErrorStatus` or `Description`.
   - **`MessageSearch()`**, the handler:
     - Read the body.
     - Validate before the switch: `action` must be `headers`; `from` required; `to` defaults to the UTC now; `NormalizeTimestamp`/`WindowDays` with 0–7 days; status label; `sessionId`/`limit`/`afterId` with `?1.N` and range; `afterTimeCreated` and `afterId` together, with the time parseable; string filters at most 128 characters, `bodyClass` at most 220.
     - Switch namespace. If `'##class(%Dictionary.CompiledClass).%ExistsId("Ens.MessageHeader")`, restore and return `{action, interopEnabled:false, rows:[], hasMore:false, limit, from, to}`.
     - Otherwise prepare in Logical mode: `SELECT TOP <limit+1> <columns> FROM Ens.MessageHeader WHERE <HeaderWhere>[ AND (TimeCreated > ? OR (TimeCreated = ? AND ID > ?))] ORDER BY TimeCreated, ID`.
     - Return `{action, interopEnabled:true, rows, hasMore, limit, from, to}`.
6. `src/ExecuteMCPv2/REST/MessageResend.cls`: build the filter object in `resendFiltered`, call `HeaderWhere` once, and use `tWhere` with `tParams...` in its three statements. The guards, texts, `TOP` handling and order stay exactly as before.
7. `src/ExecuteMCPv2/REST/Dispatch.cls`: add `<Route Url="/interop/message/search" Method="POST" Call="ExecuteMCPv2.REST.MessageSearch:MessageSearch"/>`.
8. `scripts/gen-bootstrap.mjs`: add `REST/MessageSearch.cls` after `REST/MessageResend.cls`, then run `pnpm gen:bootstrap` and record `BOOTSTRAP_VERSION` from `089f8f0a62b2` to the new value. `packages/shared/src/__tests__/bootstrap.test.ts`: 31 entries in all four lists, with MessageSearch in the base-before-extenders list.
9. `src/ExecuteMCPv2/Tests/MessageSearchTest.cls` (new; data-free; at most 500 lines; not in the manifest). Its 5 methods:
   - `TestHeaderWhereResendFilterSet`: the exact current resend WHERE and parameter order.
   - `TestHeaderWhereEveryFilterOrder`.
   - `TestHeaderWhereNoCallerText`: hostile values only in `pParams`; `pWhere` equals the fixed text.
   - `TestHeaderWhereNoFilters`.
   - `TestHttpValidationRefusals`: every direct-REST refusal row over real HTTP (the `MessageResendTest` `%Net.HttpRequest` pattern). Each asserts that the text contains the parameter name and not the hostile value.

*Task 2: TypeScript.*
10. `packages/shared/src/refusals.ts`: add `NOT_IMPLEMENTED` with a doc line ("the requested action is declared but not available in this version"). `packages/shared/src/__tests__/refusals.test.ts`: the sorted list.
11. `packages/iris-interop-mcp/src/tools/message-resend.ts`: export `STATUS_LABELS`; nothing else changes.
12. `packages/iris-interop-mcp/src/tools/message-search.ts` (new): `messageSearchTool` with the Boundaries classification and annotations.
    - Input:
      - `action` (required);
      - `from` (required); `to`;
      - `item`, `source`, `target`;
      - `status` (`STATUS_LABELS`);
      - `sessionId` (positive integer);
      - `bodyClass`;
      - `errorOnly`;
      - `limit` (integer 1–500);
      - `cursor`;
      - `namespace`.
    - The description follows the tool-descriptions convention: what, when and returns; the default states; `IRIS_GOVERNANCE` per-action keys; the 7-day window; `limit` as an output cap with the ~60 s gateway risk; that `body`/`searchTable` are not yet available; `notApplicable`. It names no REST path.
    - Exports, for Stories 39.3–39.5: `HeaderRow` and `mapHeaderRow`; `utcToIso` (the strict converter, `""` on empty or malformed); `toCanonicalUtc` (input); and `encodeCursor`/`decodeCursor` (base64url JSON `{t: timeCreatedRaw, id}`, validated on decode).
    - `body`/`searchTable` return `NOT_IMPLEMENTED` before any HTTP call.
13. `packages/iris-interop-mcp/src/tools/index.ts` (append after `messageResendTool`, update the header counts) and `presets.ts` (`core.include` and `developer.include`, header comment).
14. Tests:
    - `packages/iris-interop-mcp/src/__tests__/message-search.test.ts` (new, mocked HTTP): the definition, the schema, the wire body (with fake timers for `to`), offset normalization, mapping (ISO, `Raw`, `""`, `null`), the cursor round-trip and malformed cursors, `notApplicable`, `NOT_IMPLEMENTED` with no call, and `IrisApiError`.
    - `message-search-governance.test.ts` (new, real `McpServerBase` through `makeEnvHarness`, `stageDefaultStartup`, `callTool`): the default-enabled keys, the governance row, the `read-only` preset, and audit entries carrying `action` and outcome.
    - Update `index.test.ts`, `presets.test.ts`, `pre-feature-tool-snapshot.ts` and `tool-visibility-backcompat.test.ts`.

*Task 3: the gate, docs and counts.*
15. Finish `story-39-1-message-search-live-gate.test.ts`.
    - It checks `IRIS_REQUIRE_LIVE` itself. It fails on a stale shared, dev, admin or interop dist, or an unreachable IRIS, when armed. Its `beforeAll` runs `assertDeployedBootstrapVersion`, removes leftovers by name, asserts nothing is left, creates A (interop, α), B (interop, β) and C (plain), and puts and compiles the fixture class. Its `afterAll` removes all three namespaces and the class, asserts nothing is left, and closes the sessions.
    - Rows:
      - every matrix row through the BUILT interop server, against its oracle;
      - the direct-REST validation rows through `executeMcpPost`;
      - the byte-identity rows, comparing every raw `text` with the fixture, plus the assertion `fixture.capturedWithBootstrapVersion === "089f8f0a62b2"` and `!== shippedBootstrapVersion()`.
    - Add it to `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles`, with a comment naming what it writes.
16. Docs (Rule #30/#43, minimal; Story 39.6 enriches):
    - every pinned and precedent surface in the Code Map count list;
    - the README payload rows equal to `pnpm measure:tools-payload` after rebuilding;
    - the CHANGELOG Epic 30 roster line becomes `full` 32/27/24/22/8, `core` 15/13/11/10/8, `developer` 32/11/24/10/8, "as of Story 39.1";
    - the new top section `## [Pre-release — 2026-10-16] — Story 39.1: Message header search` (Added, Changed: interop `core` 10 → 11 runtime and the `BOOTSTRAP_VERSION` move, Tests; no roster pattern);
    - `.changeset/story-39-1-message-header-search.md` (`@iris-mcp/shared` minor, `@iris-mcp/interop` minor);
    - `docs-prompt-sync.test.ts` "108 tools";
    - `packages/iris-mcp-all/src/__tests__/story-39-1-doc-claims.test.ts` (new), pinning the section by title, the bump map (`skipIf(!changesetPresent)`), and the `tool_support.md` row and default-state note.

**Acceptance Criteria:**
- AC-1 (39.1.1). Given the baseline source, when the Code Map probe record is checked against `MessageResend.cls` and `message-resend.ts`, then it states `resendFiltered`'s exact filters, query, caps and window rules. When Task 0 runs, its live results, and the earliest IRIS version they were verified on, are recorded under Verification.
- AC-2 (39.1.2, AD-17). Given the α fixture in a fresh namespace A, when the gate replays every captured `resendFiltered` request over direct REST against the post-change classes, then each raw response body equals its capture from `089f8f0a62b2`. Both `resendFiltered` and the new route get their WHERE only from `MessageSearch.HeaderWhere`, which never emits caller text. `BOOTSTRAP_VERSION` has moved, and both rosters list 31 classes.
- AC-3 (39.1.3). Given A, when `iris_message_search` `headers` runs through the built interop server with any filter set from the matrix, then the rows (ids, order and every field) equal the hand-written oracle. Pages join without gap or duplicate under the limit, and timestamps are UTC ISO with `…Raw`.
- AC-4 (39.1.4). Given the built interop server under default configuration, when `tools/list` and `iris_server_profiles` are read, then `iris_message_search` is listed with the stated annotations, and all three keys are enabled reads. Interop counts 23 package and 24 runtime tools, `core` 11 runtime and `developer` 24 runtime, and the docs state the default state.
- AC-5 (39.1.5; Rules #34, #36, #41). Given namespaces A, B and C, when the same search runs in each, then A and B each equal their own oracle and differ from each other, and C returns `notApplicable`, not an error.
- AC-6. Given the action `body` or `searchTable`, when it is called with a valid window, then the result is the `NOT_IMPLEMENTED` catalog refusal with no IRIS call, and the audit entry records that action with `outcome:"error"`.
- AC-7 (AD-15, AD-33). Given the delivered tree, when the suites run, then:
  - every pre-existing tool's `tools/list` entry is unchanged, and the only new name is `iris_message_search`;
  - every pre-existing route is unchanged on the wire;
  - `GOVERNANCE_BASELINE` stays `1e62c5ad5bf7`/141;
  - every count and doc pin in the Code Map list holds.

### Review Findings

Code review, 2026-10-16. Tier `full-opus`; all four layers delivered (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). 26 rows became 13 entries (high 0, medium 3, low 10): 9 patched, 4 ledgered, and 11 rows rejected. One entry is the reviewer's own Rule 2 check.

- [x] [Review][Patch] The new route's direct-REST guards had no default-suite row. A missing `from`, an over-length `item`/`source`/`target`/`bodyClass`, a non-string name, a non-boolean `errorOnly` and an unparseable `afterTimeCreated` were pinned only by the manually run OS class, and `afterTimeCreated` without `afterId` by nothing (medium; Verification Gap). Added 9 `ROUTE_CASES` rows; the armed gate passes 104. [packages/iris-mcp-all/src/__tests__/story-39-1-message-search-live-gate.test.ts:632]
- [x] [Review][Patch] AC-4's clause "the docs state the default state" had a pin but no `mutation:` line (low; Verification Gap, Acceptance Auditor). The mutation is recorded under Verification. AC-7's frozen-baseline clause is pinned by `pnpm gen:governance-baseline:check`, which reports OK. [packages/iris-mcp-all/src/__tests__/story-39-1-doc-claims.test.ts:119]
- [x] [Review][Patch] The interop README said `body`/`searchTable` refuse "once the window is valid", but only the `from`/`to` parse runs first (low; Blind Hunter, Acceptance Auditor). Reworded. The tool description's "(with a valid window)" is left as it is: it is true, and changing it would move the payload rows. [packages/iris-interop-mcp/README.md:221]
- [x] [Review][Patch] The name filters also ignore trailing blanks and tabs, as QA observed (low; Blind Hunter). Decided: the interop README, which is the option reference, says so. The tool description and the CHANGELOG need not, because the behavior only ever matches the intended name. [packages/iris-interop-mcp/README.md:221]
- [x] [Review][Patch] Two refusal labels claimed "nothing was read", which `result:{}` or absent `rows` cannot observe (low; Verification Gap). Relabeled. Validate-before-read stays pinned by the row "a bad from, sent with a namespace that cannot be switched to". [story-39-1-message-search-live-gate.test.ts:653, :1011; src/ExecuteMCPv2/Tests/MessageSearchTest.cls:200]
- [x] [Review][Patch] The changeset still called the `resendFiltered` wire "unchanged", without the replayed-path scope the CHANGELOG uses (low; Acceptance Auditor). [.changeset/story-39-1-message-header-search.md:13]
- [x] [Review][Patch] The README documented an `errorOnly` default of `false`, which the tool never sends (Rule #10; low; Acceptance Auditor). It now shows `—`, as every other filter does. [packages/iris-interop-mcp/README.md:216]
- [x] [Review][Patch] The `MessageSearchTest` refusal bodies named no namespace, so a regressed guard would have queried HSCUSTOM (low; Acceptance Auditor). `ValidBody()` now targets `EXECMCPTMP391Z`; the class passes 5 of 5. [src/ExecuteMCPv2/Tests/MessageSearchTest.cls:172]
- [x] [Review][Patch] The root README said `presets.ts` is "kept in lockstep" with feature-spec 11 §2.5, whose table lacks four tools (low; Blind Hunter). Reworded: `presets.ts` is the authoritative table. [README.md:673]
- [x] [Review][Defer] DW-572 (escalated, burndown). On the untuned `Ens.MessageHeader`, a name or status filter makes IRIS intersect the bitmaps over the whole history and test `TimeCreated` row by row (EXPLAIN cost 19075, against 103.84 for the window alone), so the window does not bound that scan (medium; Blind Hunter). Fix-risk is high: a plan hint trades against the shape of the data, and inside `HeaderWhere` it would also move `resendFiltered`'s tie order. [src/ExecuteMCPv2/REST/MessageSearch.cls:322]
- [x] [Review][Defer] DW-573 (routed, 39-6). No test in the project pins that pre-existing `tools/list` entries are unchanged (AC-7's first clause), because the payload sync compares counts only. The Review Triage Log's "held by `gen:governance-baseline:check`" names a check of keys, not entries (medium; Acceptance Auditor). [packages/iris-mcp-all/src/__tests__/docs-visibility-roster-sync.test.ts:170]
- [x] [Review][Defer] DW-574 (wontfix-accepted). A fifth local `toStructured` copy (Rule 2, weak reason). [packages/iris-interop-mcp/src/tools/message-search.ts:251]
- [x] [Review][Defer] DW-575 (routed, 39-2). `TypeLabel` duplicates `PreviewOne`'s `$Select`. It is a copy the spec forces, and 39.2 unifies it (Rule 2). [src/ExecuteMCPv2/REST/MessageResend.cls:229]

Relayed to the lead, because harvest dispositions are the lead's (Rule 15 (c)): DW-571 is a LOW owned by `burndown`, which Rule 15 forbids, and DW-570 has footprint `in-epic` with owner `burndown`, although 39-2 owns `MessageResend.cls`.

**Rejected** (11 rows):
- Blind Hunter: the performance budget is "logged, never asserted". False: the spine asks a story to check its budget, and Verification records the check. The scaling point is DW-572.
- Blind Hunter: the DW-571 and DW-570 dispositions (2 rows). These are lead bookkeeping, relayed above. The full-path `source` part is false, because the grammar's source is the spec file.
- Blind Hunter: the fixture's name guards disagree. False: `Seed` refuses with a text that names the 391 rule, and `seedHeaders` documents it.
- Blind Hunter and Edge Case Hunter: Windows path separators (2 rows). Low: this IRIS uses Unix paths, and on Windows the teardown fails loudly. reopen_if the gate runs against a Windows IRIS.
- Edge Case Hunter: a `%Next` fetch error ends a page early. Low: no realistic fetch error occurs on a local read, more than 30 handlers use the same form, and the fix adds a branch.
- Edge Case Hunter: non-canonical direct-REST timestamps. Low: only a direct caller can send them, because the tool sends canonical UTC, and the resend path does the same.
- Edge Case Hunter: an empty-string filter applies no filter. Low: this is the documented `HeaderWhere` contract, adjudicated in the review pass.
- Edge Case Hunter: the default `to` comes from the host clock. Spec-bound (Rule #10 and the Boundaries).
- Acceptance Auditor: AC-2 says the WHERE comes "only from `HeaderWhere`". False: Task 5 prescribes the keyset clause, which is fixed text with bound values.

## Spec Change Log

Implement pass, 2026-10-17. No Code Map claim proved wrong at Task 0. Amendments applied in place, none changing intent:
- **Fixture alpha holds 13 headers, not "about 12".** Header 13 is stored with a trailing-zero time (`2001-02-03 14:00:00.300`) and sits last on a page of 3, so the live paging row proves the cursor survives a stored form IRIS reads back as `.3`. `SEEDED_IDS.alpha` is `1..13`; the window-only result is 11 rows.
- **The Atelier `action/query` route renders a SQL NULL integer as `0`.** The gate's oracle therefore reads NULL-ness of `CorrespondingMessageId` from its own `IS NULL` column; the tool returns `null`.
- **`executeMcpPost` pins `Accept-Language: en-US,en;q=0.9`**, as `IrisHttpClient` does. Without it `fetch` sends `*`, IRIS resolves that to Arabic, and the captured `%Status` prefixes would not be reproducible (Rule #13).
- **Rule 2 dispositions.** `MessageSearchTest` carries its own `ResolvePort`/`PostJson` helpers: eight sibling OS test classes carry theirs, and a shared base would edit them. `TypeLabel` is defined in `MessageSearch` because `PreviewOne` (Story 39.2) must not change here; 39.2 can move it onto `TypeLabel`.
- **`HeaderWhere` initializes its fragment list with `""`.** Starting from `$ListBuild()` the join loop raised `<NULL VALUE>` (the list carried a null first element).

Review pass, 2026-10-16. Amendments applied in place, none changing intent:
- **The name filters (`item`, `source`, `target`, `bodyClass`) ignore case.** The Boundaries and the tool description said "exact match"; a live gate row showed the `%String` name properties use the default collation, so equality is case-insensitive. `%` and `_` stay ordinary characters. The description, the interop README and the CHANGELOG say so.
- **The direct-REST default `to` carries milliseconds** (`$ZDATETIME($ZTIMESTAMP, 3, 1, 3)`), so a header created in the current second is inside the window. The tool always sends `to` explicitly.
- **Paging guidance.** The cursor stays `{t, id}`. An omitted `to` is recomputed as now on each call, so the description and README tell callers to pass the same `from` and `to` on every page of a window near 7 days.
- **The `resendFiltered` byte-identity claim is scoped to what is replayed:** dry runs and guard refusals. The path that resends needs a running production and is covered by `MessageResendLiveTest` only (deferred; see the frontmatter).

## Review Triage Log

### 2026-10-16 — Review pass
- verdicts: 40 findings — high 0, medium 12, low 26, false 2, maybe-false 0
- findings:
  - `[medium]` `[patch]` Blind: the doc-claims test compared the CHANGELOG's historical `089f8f0a62b2 to <hash>` line with the live embed version, so Story 39.2's regeneration would turn the default suite red — fixed: both versions are pinned as literals, as Story 39.0's test does; mutation (CHANGELOG hash edited) is red.
  - `[medium]` `[defer]` Blind: the executing-path fetch statement of `resendFiltered` (`MessageResend.cls:567`) is run by no test — verified: the replayed requests and `MessageResendTest` stop at guard d or f, and only `MessageResendLiveTest` (starts a production in HSCUSTOM, forbidden here) reaches it; the statement has the construction of the sample statement the replay does run, and a break would fail safe; deferred, with the docs over-claim patched under the Intent row on the same subject.
  - `[low]` `[reject]` Blind: `%SelectMode = 0` is unproven and resend's statements keep the process default — probe (e): a REST process already starts Logical and `$ZTIMEZONE` is 0, so the property cannot vary on this shared instance; resend's default is the pre-existing REST default; reopen_if an instance with a non-zero `$ZTIMEZONE` is available.
  - `[medium]` `[patch]` Blind: paging with `to` omitted recomputes `to` per page, so a window near 7 days can be refused mid-paging — real; embedding `to` in the cursor changes the specified cursor shape, so the description and README now tell callers to pass the same `from` and `to` on every page.
  - `[low]` `[reject]` Blind: the gate hard-codes HSCUSTOM as the fixture home — the `%ALL` mapping of `ExecuteMCPv2` to HSCUSTOM is what makes the fixture class resolve in scratch namespaces and the environment rules fix the target; reopen_if the bootstrap namespace changes.
  - `[low]` `[patch]` Blind: `body`/`searchTable` reach `NOT_IMPLEMENTED` only after window validation — the behavior is spec-bound (matrix: "with a valid from", AC-6: "valid window"); the description and README now say "with a valid window".
  - `[medium]` `[patch]` Blind: "every filter is an exact match" is unverified — verified live: the name properties are `%String` with the default collation, so a lowercase source matches the same rows; gate rows added for source, item and body class (red under a `%EXACT` mutation) and the description, README and CHANGELOG now say the name filters ignore case.
  - `[low]` `[patch]` Blind: paging rows never exactly full, `TypeLabel` "Unknown" untested, helpers without direct tests — added the `limit 11` page and a page-count assertion (the first version of the row survived a "full page reports more" mutation, the strengthened one is red); the "Unknown" branch is unreachable for stored types 1 to 3 and the helpers are covered through the HTTP refusal rows, so those parts are rejected.
  - `[low]` `[patch]` Blind: `afterAll` stops at the first failed removal — each step now runs in its own guard and the failures are asserted at the end; mutation (namespace B not removed) is red.
  - `[low]` `[patch]` Blind: grammar "a **11-tool runtime roster**" — fixed to "an" in the interop README; the doc-claims substring is unchanged.
  - `[medium]` `[patch]` Edge: page 2 with `to` omitted recomputes `to` — same root cause as the paging row above; the same documentation fix.
  - `[low]` `[patch]` Edge: `body`/`searchTable` without `from` or with a malformed `from` get a window error — same root cause as the `NOT_IMPLEMENTED` ordering row above.
  - `[low]` `[reject]` Edge: the default `to` comes from the MCP host clock, not the IRIS clock — spec-bound (Rule #10: TS sends `to` explicitly); reopen_if a clock-skew report.
  - `[low]` `[patch]` Edge: the direct-REST default `to` (`$ZDATETIME($ZTIMESTAMP, 3)`) has no fraction, so a header created in the current second is excluded — verified live (the new gate row was red: `to` was `2026-10-17 02:15:01`); now `$ZDATETIME($ZTIMESTAMP, 3, 1, 3)`, row green, bootstrap regenerated.
  - `[low]` `[reject]` Edge: empty-string filters are silently dropped — the documented contract of `HeaderWhere` (an absent or empty key adds no fragment); matching an empty name is not a stated need and a `.min(1)` guard adds behavior; reopen_if a caller needs it.
  - `[low]` `[patch]` Edge: teardown stops at the first failure — same root cause as the `afterAll` row above.
  - `[medium]` `[patch]` Edge: the doc-claims test ties a historical CHANGELOG line to the live embed — same root cause as the first row.
  - `[medium]` `[patch]` Edge: the exact-match claim is imprecise (collation) — same root cause as the collation row above.
  - `[false]` `[reject]` Edge: `HeaderWhere` drops empty filters, so a blank filter could widen a destructive resend — `resendFiltered` requires `item` and `from`, maps `status` to a non-zero code and always has a normalized `to`, so the helper always receives five non-empty values; the byte-identity rows pin the five-parameter shape and a guard would be unreachable.
  - `[medium]` `[defer]` Gap: the `resendFiltered` fetch statement runs in no test — same root cause as the second row; the proposed fix (extract the fetch) moves the unverified part to its call site and adds a public method.
  - `[low]` `[patch]` Gap: nothing fails if `resendFiltered` stops using `HeaderWhere` — mutation run: `HeaderWhere` skipping the status fragment turns the byte-identity row red (and the status gate row), which shows resend consumes the helper; line written.
  - `[low]` `[patch]` Gap: validate-before-switch ordering is pinned by no test — route row added (a bad `from` sent with a namespace that cannot be switched to); mutation (switch moved before validation) is red on that row.
  - `[medium]` `[patch]` Gap: the fixture harness's name guards are exercised by no test — a default-suite unit test with stub sessions (10 tests) and a gate row for the OS-side refusals (using `EXECMCPTMP391`, which names no directory); mutations (widened regex; OS guard disabled) are red.
  - `[medium]` `[patch]` Gap: the "nothing left" oracle was never shown to detect a leftover — a positive control in `beforeAll`; mutations (`Leftovers` returns `[]`; namespace B not removed) are red.
  - `[medium]` `[patch]` Gap: the 39.1 gate's armed fail-closed path is unproven — `story-39-1-gate-guards.test.ts` runs the gate in child vitest processes against a closed port (unarmed skips with the reason, armed fails with "may not be skipped") and pins the source order of the freshness and version checks; mutation (throw disarmed) is red.
  - `[low]` `[reject]` Gap: `%SelectMode = 0` cannot be shown to matter — same root cause as the third row.
  - `[low]` `[patch]` Gap: the live defaults row cannot detect TS omitting `to`/`limit` — the pin is the unit test (exact `toHaveBeenCalledWith`); mutation (`limit` not sent) is red on 3 unit rows; line written.
  - `[false]` `[reject]` Gap: the route row "an unparseable to" with token `to` could match another message — if a hostile `to` were not rejected the response would be a success with no errors and the row's first assertion would fail; every window text names its parameters.
  - `[low]` `[reject]` Gap: the unknown-namespace row asserts only `isError` — the skip-`SwitchNamespace` mutation turns it red (recorded); a text assertion would pin IRIS's wording.
  - `[low]` `[reject]` Gap: the `toCanonicalUtc` trimming table restates the spec — the live cursor path (stored `.300` read back as `.3`, header 13) is a reality oracle for the trimmed form.
  - `[low]` `[patch]` Gap: ACs and sub-claims with no `mutation:` line — AC-2 rosters: the generator roster without `MessageSearch`, regenerated, is red on 6 `bootstrap.test.ts` rows; AC-7 tools array: the tool removed from the array is red on 6 interop rows; AC-1 is n/a; the baseline and "pre-existing entries unchanged" sub-claims have no code to mutate (the diff changes pre-existing tool code by one `export`) and are held by `gen:governance-baseline:check`.
  - `[low]` `[reject]` Gap: concurrent runs would collide on the fixed names — by design: fixed names plus this package's serial file execution (pinned by `epic38-gate-guards`) are the convention.
  - `[low]` `[reject]` Gap: the byte-identity baseline depends on an engine-defined tie order — captured on one recorded IRIS build; reopen_if the IRIS version changes and the row goes red without a code change.
  - `[low]` `[reject]` Gap: `HeaderWhere`'s `Catch` and the callers' `ISERR` branches are unreachable — defensive wrappers the project's try/catch convention requires; a public helper can be misused with a non-object.
  - `[low]` `[reject]` Intent: Logical select mode is asserted nowhere — same root cause as the third row.
  - `[low]` `[patch]` Intent: refusal ordering is a code-order property no test observes — same root cause as the validate-before-switch row.
  - `[medium]` `[patch]` Intent: the CHANGELOG and `tool_support.md` called the route's and the `resendFiltered` wire byte-identical though only dry runs and refusals are replayed — both reworded, the CHANGELOG now says the path that resends is covered by `MessageResendLiveTest` only, and `story-39-1-doc-claims` pins the wording; the test gap itself is the deferred row.
  - `[low]` `[patch]` Intent: `NOT_IMPLEMENTED` conditions — same root cause as the `NOT_IMPLEMENTED` ordering row above.
  - `[low]` `[patch]` Intent: the route's success path is never driven directly — gate row added: the route with `to` and `limit` omitted against namespace C (reads nothing).
  - `[low]` `[patch]` Intent: window bounds of 0 days and exactly 7 days are unpinned on the new route — live row added; mutation (`MAXWINDOWDAYS` 6) is red on it.

## Design Notes

**DECIDED (orchestrator decision #21, spec gate 2026-10-16, as recommended): mapping only.** Orchestrator decision (a): how to make the disposable namespace interop-enabled. Recommended: mapping only.**
- Create, with `iris_mapping_manage:create`, packages `Ens` and `EnsLib` and routine `Ens*` → `ENSLIB`, the same set HSCUSTOM maps. Do not call `%Library.EnsembleMgr.EnableNamespace`.
- **Why.** `EnableNamespace` runs the HealthShare namespace installer on this instance (`EnsembleMgr.cls:1816-1822`; the server reports the HEALTHSHARE feature). It also creates a portal application, grants SQL privileges, and adds `%EnsRole_InteropEditorsAPI` to the shared `/api/interop-editors` application (:1825-1838, :2833-2841). Those are security changes on a shared instance, which the environment rules forbid.
- Its own mapping step (:2329-2369) is all that makes `Ens.MessageHeader` visible. Task 0 (a) proves it live.

**DECIDED (orchestrator decision #22, spec gate 2026-10-16, as recommended): 7 days.** Orchestrator decision (b): the maximum window for `headers`. Recommended: 7 days.**
- It is `resendFiltered`'s bound over the same table, index and roughly 60 s gateway exposure, and the AC asks for a window that is "required, bounded".
- It can widen later with an additive change. The alternatives are 31 days, or a separate explicit whole-namespace opt-in; AD-20 allows one, and none is offered now.

**Plan-time interpretations** (apply and report):
- **I1.** "Source or target config item" means three filters: `item` (either side, `resendFiltered`'s meaning), `source` and `target`.
- **I2.** "Error-only" means `IsError = 1`. Status `Error` is the separate `status` filter.
- **I3.** "Paged, with a cap" means a keyset cursor over `(TimeCreated, ID)`, oldest first, with `limit` 100 by default and 500 at most. There is no total count.
- **I4.** "Byte-identical" means raw HTTP bodies equal a capture taken from the pre-change classes in a fresh namespace. Header ids are deterministic there. The fixture records the bootstrap version it was captured on, and a mechanical assertion proves the capture predates the change.
- **I5.** The second-namespace smoke is a default-suite gate row (A against B), not a manual step.
- **I6.** Output `status` keeps the existing `Error` label (`StatusCodeToLabel`), and input accepts `Errored`, the shared `STATUS_LABELS`. The description says so.

**Governing ADs.**
- **AD-26.** The binding AD. Filters are structured and bound. `headers` returns no body-derived text, and `ErrorStatus`/`Description` are left for Story 39.2's classification.
- **AD-17.** The shared-helper contract, and the refusal pin over direct REST.
- **AD-20.** The required window, and the output-cap wording.
- **AD-4.** The fixed three-action enum, per-action `mutates`, and four truthful annotations.
- **AD-7.** Both presets; no `TOOL_PAIRS` change. **AD-10.** The counts.
- **AD-11, AD-13.** The envelope, and namespace restore. **AD-12.** The thin handler, with `notApplicable` interpreted in TS.
- **AD-14.** The bootstrap regeneration and both rosters. **AD-15, AD-33.** Additive changes, and the byte-identical resend wire.
- **AD-19.** The derived audit `action`, and the closed `outcome` domain. **AD-1, AD-3.** `ctx.http` and `scope: "NS"`.
- **AD-5.** `:check` only. **AD-29.** Minor changesets.
- **Conventions:** Tool descriptions, Tool results, Refusals, Error text, REST routes, Live gates, Live testing on a shared instance, Probes, Performance budgets.

**Extend, don't copy (Rule 2).**
- `HeaderWhere` is the extraction itself.
- The new handler reuses `MessageResend`'s `StatusLabelToCode`, `StatusCodeToLabel`, `NormalizeTimestamp` and `WindowDays`.
- `STATUS_LABELS` is exported rather than copied, and refusals use `refusalResult`.
- `utcToIso` is a deliberate sibling of resend's local `odbcToIso`. The new contract returns `""` on malformed input (Rule #11), while resend's output must stay byte-identical (AD-15).
- `executeMcpPost` sits beside `atelierQuery` and reuses its auth.
- `docFixtures(session)` is the session-parameterized form of the capstone's closures, so this gate does not add a fifth copy. Moving the Epic 38 gates onto it stays with DW-561 in Story 39.6. For the lead: append `occurrence=39-1-message-header-search` to DW-561.

**Integration (Rules 1 and 2).**
- **Integration ACs:**
  - AC-3 and AC-5: the built interop server's `iris_message_search` reads the new route and `HeaderWhere`, and produces rows equal to the oracle.
  - AC-2: `resendFiltered` consumes `HeaderWhere`, with an identical wire.
- **Consumed-by:**
  - 39.3 and 39.4 add their actions to this tool and route, reusing the scope filters, `HeaderWhere`, `HeaderRow`/`mapHeaderRow`, the cursor and `NOT_IMPLEMENTED`'s removal.
  - 39.5 reads header ids from these rows and declares `TOOL_PAIRS`.
  - 39.6's capstone and Stories 39.3–39.5's gates reuse `interop-namespace-fixture.ts`.
  - 39.2 classifies `ErrorStatus`/`Description`.
- **Consumes:**
  - 39.0's `makeEnvHarness`, `stageDefaultStartup` and `callTool`;
  - the 38.x process-gate helpers;
  - `refusalResult`;
  - `MessageResend`'s helpers.

**Visibility (Rule #53).** Interop `core` goes to 11 runtime tools. Search is the entry of the everyday forensic loop (search → read → diagram), and it is the read-only way to find messages while resend stays disabled (L-4).

**Ledger inbox (Rule 17):** none.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- MCP calls name `server:"default"`. Their `namespace` is `HSCUSTOM`, or one of this story's own `EXECMCPTMP391*` namespaces.

**Step L: the namespace lifecycle.** Each step names the existing tool that does it, as probed on 2026-10-16. Where no tool exists, the fixture class does the step.
1. **Create the database.** Use `iris_database_manage:create` with `{name:"EXECMCPTMP391A", directory: ManagerDirectory()+"execmcptmp391a/"}`.
2. **Create the namespace.** Use `iris_namespace_manage:create`, with code and data both `EXECMCPTMP391A`.
3. **Make it interop-enabled** (A and B only). Use `iris_mapping_manage:create` for package `Ens`, package `EnsLib` and routine `Ens*`, each → `ENSLIB`.
4. **Seed.** Put and compile `ExecuteMCPv2.Temp.Story391Fixture` in HSCUSTOM (`iris_doc_put`, `iris_doc_compile`), then call `iris_execute_classmethod` `Seed` with `namespace:"EXECMCPTMP391A"`. The `%ALL` mapping makes the class resolve there.
5. **Tear down, in this order:**
   - (i) delete the mappings with `iris_mapping_manage:delete`;
   - (ii) delete the namespace with `iris_namespace_manage:delete`;
   - (iii) delete the database config with `iris_database_manage:delete`;
   - (iv) remove `IRIS.DAT` and the directory with `Story391Fixture.RemoveDatabaseFiles` (no tool removes files);
   - (v) delete the fixture class with `iris_doc_delete`.
6. **Nothing left.** `Leftovers(["EXECMCPTMP391A","EXECMCPTMP391B","EXECMCPTMP391C"])` returns `[]`. The namespace and database rosters (`iris_namespace_list`, `iris_database_list`) show none of the names, and `iris_doc_list` with the filter `Story391` (and `generated:true`) is empty.

Steps 1–6 also serve the Task 0 probe namespace `EXECMCPTMP391P`.

**Step C: capture** (once, before Task 1).
- Build shared, dev, admin and interop. Confirm the deployed version is `089f8f0a62b2` (Task 0 i).
- Run `ENV STORY_39_1_CAPTURE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-1-message-search-live-gate.test.ts -t capture`.
- Commit nothing; the lead commits. The fixture file is never edited by hand (Rule #36).

**Shared surfaces:** these change, and other tests assert on them.
- The interop tools array and both presets.
- `PRE_FEATURE_SNAPSHOTS`.
- The refusal catalog list.
- The bootstrap rosters and `BOOTSTRAP_VERSION`: every armed gate redeploys.
- The Dispatch routes.
- The README roster, payload, servers and governance tables; the interop and `iris-mcp-all` READMEs; the CHANGELOG roster line; the `docs-prompt-sync` literal; `tool_support.md`.
- The `iris-mcp-all` `gateTestFiles`.
- The governance key universe (+3; not pinned).

Standing criterion: every test added or changed passes on a fresh environment, in either order. The gate creates and removes all its own state. OS test classes run one class per `iris_execute_tests` call, and `total` is compared with the `Test*` count (Rule #35).

**Commands:**
- `(once)` First, build shared, then dev, admin, interop, ops, data and client-config, one command each. Run Task 0 and Step C.
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/refusals.test.ts src/__tests__/bootstrap.test.ts src/__tests__/tool-visibility-backcompat.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/interop build && pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/message-search.test.ts src/__tests__/message-search-governance.test.ts src/__tests__/message-resend.test.ts src/__tests__/message-resend-governance.test.ts src/__tests__/index.test.ts src/__tests__/presets.test.ts src/__tests__/presets.e2e.test.ts` -- expected: pass.
- `(loop)` `iris_doc_load` `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/MessageSearchTest.cls` (HSCUSTOM), then `iris_execute_tests` with `ExecuteMCPv2.Tests.MessageSearchTest` -- expected: total 5, 0 failed. Then, in a separate call, `ExecuteMCPv2.Tests.MessageResendTest` -- expected: total 12, 0 failed. Run each before Task 1 too, as a baseline.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-1-message-search-live-gate.test.ts` -- expected: pass armed, nothing left.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-1-doc-claims.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/docs-prompt-sync.test.ts src/__tests__/tool-visibility-snapshot-drift.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/story-38-6-doc-claims.test.ts` -- expected: pass.
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one command each: `build`, then `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism`, then `ENV pnpm --filter @iris-mcp/all test` -- expected: green, with the armed gates passing on the new `BOOTSTRAP_VERSION`.
- `(once)` `pnpm gen:bootstrap` run a second time -- expected: no diff. Also `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check`, `node scripts/check-epics-sync.mjs` and `pnpm measure:tools-payload` -- expected: OK, and the README rows equal the output.
- `(once)` Performance: record the first armed spawn's bootstrap time (under 60 s) and one `headers` call's time on A (under 2 s).
- `(once)` After every armed run, run Step L6, and for HSCUSTOM `iris_doc_list` filtered on `ExecuteMCPv2.Temp.Story391` -- expected: empty.

**Planned mutations (Rule 19).** For each: apply it, observe red, revert, rebuild any dist it touched, and confirm `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> -> <red test>`.

| AC | Mutation | Expected red |
|---|---|---|
| AC-2 | The `resendFiltered` sample's `ORDER BY TimeCreated` changed to `ORDER BY ID DESC` (redeploy) | the gate's byte-identity rows |
| AC-2 | `HeaderWhere` concatenates `item` into `pWhere` | `TestHeaderWhereNoCallerText`; the gate's hostile-text row |
| AC-3 | The `IsError = 1` fragment dropped; separately, the keyset clause dropped | the `errorOnly` oracle row; the paging row |
| AC-3 | `utcToIso` returns the raw value (interop rebuilt) | the gate's field-equality row; the `message-search` mapping rows |
| AC-4 | `headers: "write"`; separately, the tool removed from `core.include` | the governance default-enabled row; `presets.test.ts` and `docs-visibility-roster-sync` |
| AC-5 | The handler skips `SwitchNamespace` | the A-against-B row (the 2001 window keeps HSCUSTOM traffic out) |
| AC-5 | The `CompiledClass` check removed | the C `notApplicable` row |
| AC-6 | `body` routed to the headers path | the `NOT_IMPLEMENTED` rows (unit and governance) |
| AC-7 | The changeset bump changed; separately, `NOT_IMPLEMENTED` left out of the sorted list | `story-39-1-doc-claims`; `refusals.test.ts` |
| AC-1 | none: AC-1 is the probe record, and has no runtime behavior to mutate | n/a |

### Results (implement pass, 2026-10-17)

**Task 0 probes** (IRIS 2026.2, Build 221U; this is the earliest version they were verified on; scratch namespace `EXECMCPTMP391P`, removed):
- (a) A mapping-only namespace (`Ens`, `EnsLib`, routine `Ens*` to ENSLIB) hosts `Ens.MessageHeader`: `%ExistsId` is true, `%Save` returns OK with ID 1, SQL counts it. Without the mappings the class does not exist (namespace C).
- (b) `%ExecDirect(, sql, tParams...)` and `%Execute(tArgs...)` work with a local array whose top node is the count.
- (c) `TOP ?` is supported (prepared, executed with ORDER BY, returned the bound number of rows), so the handler binds it; nothing is interpolated.
- (d) `$ZDATETIMEH("2001-02-03 12:00:00.123", 3)` is `58473,43200.123`; whole seconds parse too.
- (e) A REST process starts with `%SelectMode` 0 (Logical); `$ZTIMEZONE` is 0, so Logical and ODBC modes cannot be told apart on this instance (the handler sets Logical explicitly). The Atelier `action/query` route returns Logical values (`Status` 8, the stored `TimeCreated`).
- (f) `Config.Namespaces.Delete` removes the namespace's mappings (none listed after the namespace delete, before any `iris_mapping_manage:delete`). The fixture still deletes them first, as Step L5 says.
- (g) `SYS.Database.DeleteDatabase` needs no dismount (the database was mounted; the call returned OK and the directory was then removable).
- (h) Creating the database and namespace made no `/csp/<ns>` application and no `%DB_<ns>` resource: `Leftovers` listed only the namespace, the database configuration, the three mappings, the `SYS.Database` and the directory.
- (i) The deployed `BOOTSTRAP_VERSION` was `089f8f0a62b2`.

**Step C.** The capture ran on `089f8f0a62b2` at 2026-10-17T01:26:31Z, 20 requests, IRIS 2026.2 (Build 221U): `STORY_39_1_CAPTURE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-1-message-search-live-gate.test.ts -t capture`. The fixture was written by the test, never edited. The byte-identity row is green on the post-change classes.

**`BOOTSTRAP_VERSION`: `089f8f0a62b2` to `6dcdd238c792`** (the implement pass reached `4171efadc9d5`; the review pass's default-`to` fix moved it once more); 31 classes in both rosters; a second `pnpm gen:bootstrap` produced no diff.

**Commands.** `OS` runs: `MessageResendTest` 12 of 12 before Task 1 and after it; `MessageSearchTest` 5 of 5. Builds of shared, dev, admin, interop, ops, data and client-config were clean, and `lint` and `type-check` passed for each. Tests: shared 1694, dev 1419 (armed, `--no-file-parallelism`), admin 498, interop 431, ops 350, data 165, client-config 514, `@iris-mcp/all` 606 passed and 1 skipped (the armed-by-env capture row). `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check` and `node scripts/check-epics-sync.mjs` are OK; `pnpm measure:tools-payload` equals the README rows.

**Performance.** The first armed run on the new version (31 classes deployed by the first built-server start) finished its whole gate in 12.1 s, so the bootstrap took well under the 60 s budget; later runs report `[PERF] bootstrap start 181 ms; one headers call on A 55 ms` (budget 2 s).

**Step L6 after every armed run:** the gate's `afterAll` asserts `Leftovers` is `[]` and the `Story391` document listing is empty; after the last run the namespace, database and `iris_doc_list` rosters (HSCUSTOM, `Story391`, generated included) hold nothing of this story.

**Mutations (Rule 19).** Each applied, observed red, reverted; `shasum` of every changed file identical to the pre-mutation snapshot, interop rebuilt after its mutations, and the IRIS classes reloaded from the reverted sources.
- mutation: the `resendFiltered` sample `ORDER BY TimeCreated` changed to `ORDER BY ID DESC` (reloaded into HSCUSTOM) -> `every resendFiltered request answers byte for byte` (case `dry run, default status`)
- mutation: `HeaderWhere` concatenates `item` into `pWhere` -> `TestHeaderWhereNoCallerText` (also `TestHeaderWhereEveryFilterOrder`, `TestHeaderWhereResendFilterSet`), and the gate rows `the odd item name matches its source and its target` and `a prefix of the odd name matches nothing`
- mutation: the `IsError = 1` fragment dropped -> gate row `errorOnly is the IsError flag, not the status`
- mutation: the keyset clause dropped (`If (tAfterNorm '= "") && 0`) -> gate rows `pages of 3 join ...` and `pages of 2 join ...`
- mutation: `utcToIso` returns the stored value (`if (value !== "") return value;`, interop rebuilt) -> `message-search.test.ts` `utcToIso` and `mapHeaderRow` rows, and the gate row `window only`
- mutation: `headers: "write"` -> `message-search-governance.test.ts` `enables all three keys under an empty IRIS_GOVERNANCE` (and 3 more) and `message-search.test.ts` `classifies all three actions as reads`
- mutation: `iris_message_search` moved from `core.include` to `core.exclude` (interop rebuilt) -> `presets.test.ts` `pins the exact roster sizes` and `includes iris_message_search in both presets`; `docs-visibility-roster-sync` (5 rows)
- mutation: the handler skips `SwitchNamespace` (`If 0 {`) -> gate rows `A and B each return their own rows`, `a namespace with no Interoperability mappings is notApplicable` and `a namespace that does not exist is an error`
- mutation: the `CompiledClass` check removed (`If 0 {`) -> gate row `a namespace with no Interoperability mappings is notApplicable, not an error`
- mutation: `body` routed to the headers path (`if (action === "searchTable")`) -> `message-search.test.ts` `body returns the NOT_IMPLEMENTED refusal and makes no HTTP call` and `message-search-governance.test.ts` `denies headers with GOVERNANCE_DISABLED ..., while body still reaches NOT_IMPLEMENTED`
- mutation: the changeset bump `"@iris-mcp/shared": patch` -> `story-39-1-doc-claims.test.ts` `the changeset bumps exactly shared minor and interop minor (AD-29)`
- mutation: `NOT_IMPLEMENTED` left out of the sorted list in `refusals.test.ts` -> `refusals.test.ts` `holds exactly the codes ...`

**Review-pass results (2026-10-16).** Commands run after the last patch: `MessageSearchTest` 5 of 5 and `MessageResendTest` 12 of 12 (one class per call); builds, `lint` and `type-check` clean for shared, dev, admin, interop, ops, data and client-config (one pre-existing `lint` warning in `shared/src/cli/governance.ts`, not this story's); tests: shared 1694, dev 1419 (armed, `--no-file-parallelism`; a default parallel run failed `doc-type-description-live-gate.test.ts`, which compares two live listings of the shared HSCUSTOM, and the file passed alone and in the serial run), admin 498, interop 431, ops 350, data 165, client-config 514, `@iris-mcp/all` 627 passed and 1 skipped (the capture row); `pnpm gen:bootstrap` a second time: no diff; `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check` and `node scripts/check-epics-sync.mjs`: OK; `pnpm measure:tools-payload`: the README interop row was re-measured after the description change (`44,701`/`25,759`) and equals the output. Performance: the first armed spawn on `6dcdd238c792` deployed 31 classes in 1314 ms (budget 60 s); one `headers` call on A took 54 ms (budget 2 s). Step L6 after the last armed run: `iris_namespace_list` and `iris_database_list` show no `EXECMCPTMP391*` name, and `iris_doc_list` (HSCUSTOM, `Story391` and `ExecuteMCPv2.Temp.`, generated included) is empty.

**Review-pass mutations (Rule 19).** Each applied, observed red, reverted; `shasum` of each changed file matched its pre-mutation snapshot, and the IRIS classes were reloaded from the reverted sources.
- mutation: the route's default `to` as it was, `$ZDATETIME($ZTIMESTAMP, 3)` (observed before the fix) -> gate row `route: leaving out to and limit answers with now, to the millisecond, and 100`
- mutation: the namespace switch moved above the input checks -> gate row `route: a bad from, sent with a namespace that cannot be switched to`
- mutation: `HeaderWhere` skips the status fragment -> gate rows `every resendFiltered request answers byte for byte ...` and `status Errored is status code 8` (resend consumes the helper)
- mutation: the `source` fragment as `%EXACT(SourceConfigName) = ?` -> gate row `a source name in another case matches the same rows`
- mutation: after the fetch loop, `hasMore` set whenever the page is full -> gate row `pages of 11 join ...` (red only with the page-count assertion; the first version survived it)
- mutation: `MAXWINDOWDAYS` 6 -> gate rows `accepts a window of no length and a window of exactly 7 days` and `route: a window over 7 days`
- mutation: fixture `Leftovers` returns `[]` -> the gate's `beforeAll` positive control (`the leftovers check sees EXECMCPTMP391A while it exists`)
- mutation: `afterAll` skips removing namespace B -> the gate's `afterAll` (`every teardown step completed`)
- mutation: fixture `RemoveDatabaseFiles` name guard disabled (`If 0`) -> gate row `the fixture class refuses a name that is not a scratch namespace, and runs nothing`
- mutation: `FIXTURE_NAME` widened to `/^EXECMCPTMP/` -> `interop-namespace-fixture.test.ts` (4 refusal rows)
- mutation: the gate's `IRIS_REQUIRE_LIVE` throw disarmed -> `story-39-1-gate-guards.test.ts` `armed, with IRIS not reachable ...`
- mutation: `limit` dropped from the wire body -> `message-search.test.ts` `sends to (now, canonical UTC) and limit 100 explicitly ...` (and 2 more)
- mutation: the CHANGELOG's `BOOTSTRAP_VERSION` edited -> `story-39-1-doc-claims.test.ts` `states the BOOTSTRAP_VERSION move ...`
- mutation: `MessageSearch` removed from the `gen-bootstrap.mjs` roster and regenerated -> `bootstrap.test.ts` (6 rows, among them `should contain exactly 31 classes`)
- mutation: `messageSearchTool` removed from the interop tools array -> `index.test.ts` and `presets.test.ts` (6 rows)

**QA pass (2026-10-16) (QA).** Gap analysis against the I/O matrix and AC-3, AC-5, AC-6: the implement and review passes left these without a pinning row, so they were added to `packages/iris-mcp-all/src/__tests__/story-39-1-message-search-live-gate.test.ts` (modified, `(QA)`; the gate was already listed in `scripts/prepublish-gate.mjs`, so no roster change): 35 rows through the BUILT interop server and raw HTTP, against the disposable namespaces A and B only (never a production, never HSCUSTOM's messages).
- Every status label reaches its code through the tool (8 rows, hand-written IDs from the seed; Errored was already covered), and the label `Error` is accepted over direct REST.
- Edge values accepted: `limit` 1 and 500, `errorOnly:false` (no filter), names of exactly 128 characters and a body class of exactly 220, `sessionId` at `Number.MAX_SAFE_INTEGER` (and 1e21 refused naming `sessionId`), and the calendar ends (1841, a leap day, 9999).
- Cursor with filters: filtered pages join to the oracle (item+errorOnly at one row per page, which splits the two headers with the same time; bodyClass; status), a cursor written by hand resumes after `(time, id)` exactly, and a cursor never widens the window below `from`.
- Tool-level window refusals through the built server (over 7 days by one second; negative), the `IrisApiError` mapping over the real wire.
- Exotic values (double quote, backslash, backslash-quote, line break, tab, leading space, accented/CJK/emoji text, brackets, statement terminator and comment, trailing and single-character wildcards) as `item`, `source`, `target` and `bodyClass`: a clean empty result, never an error; a hostile `namespace` is refused with no SQL in the answer.
- Whitespace after a name (observed with the oracle first): trailing blanks and tabs are ignored by the `%String` collation (the rows equal the same SQL equality), a trailing line break is not.
- AC-6 audit through the built dist: a spawned interop server with `IRIS_AUDIT_LOG` records `headers`/`ok`, `body`/`error`, `searchTable`/`error`.

Commands: the armed gate (`ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-1-message-search-live-gate.test.ts`) 95 passed, 1 skipped (the capture row); `MessageSearchTest` 5 of 5; `story-39-1-gate-guards`, `live-gate-roster`, `interop-namespace-fixture`, `story-39-1-doc-claims` 33 passed; eslint on the gate file clean; the gate file type-checks (the one `tsc` error is the pre-existing missing declaration for `dist-freshness.mjs` in `process-gate-helpers.ts`). The shared and leaf dists were rebuilt from clean (`rm -rf dist tsconfig.tsbuildinfo`) because the tree's `src/` mtimes were newer than the dists and `tsc` emits nothing for unchanged content. Step L6 after the last run: `iris_namespace_list` and `iris_database_list` show no `EXECMCPTMP391*` name, and `iris_doc_list` (HSCUSTOM, `Story391` and `ExecuteMCPv2.Temp.`, generated included) is empty.

Mutations (Rule 19). Each applied, observed red, reverted; `shasum` of `MessageSearch.cls` and `message-search.ts` equal to the pre-mutation snapshot after each revert, the class reloaded from the reverted source and `interop` clean-rebuilt after the TS pair; `git status --short` showed only the gate file.
- mutation: `Delivered` remapped to code 2 after `StatusLabelToCode` -> `status Delivered is status code 3`
- mutation: the label `Error` mapped to 0 (refused) -> `route: the label Error names status code 8, as Errored does`
- mutation: `tErrorOnly` set to 1 whenever the key is present -> `errorOnly false is no filter at all ...`
- mutation: `MAXLIMIT` 499 -> `limit 1 and limit 500 are both accepted ...` (every pre-existing row stayed green, so this edge had no other pin)
- mutation: `ReadString` `>` changed to `>=` -> `names of exactly 128 characters and a body class of exactly 220 are accepted ...`
- mutation: `fromNorm` left out of the filters when a cursor is given -> `a cursor never widens the window ...`
- mutation: the keyset clause `ID > ?` changed to `ID >= ?` -> `a cursor written by hand resumes after its (time, id) exactly ...` and the three `filtered pages join ...` rows (also the pre-existing paging rows)
- mutation: the `item` fragment built by interpolation instead of binding -> `a backslash before a quote in a name is a name ...` (also the pre-existing odd-name rows and the byte-identity row)
- mutation: a window starting in year 9999 refused -> `the ends of the calendar IRIS can hold are searched without an error`
- mutation: `ReadInteger` length guard 18 changed to 15 -> `a session ID at the largest safe integer matches nothing ...`
- mutation: `%EXACT(SourceConfigName) = ?` for `source` -> `blanks and tabs after a name are ignored ...` (also the pre-existing case row)
- mutation: the `IrisApiError` branch of `message-search.ts` returns `isError:false` -> `tool: a window one second over 7 days is refused ...`, `tool: a window that ends before it starts is refused ...` and `a hostile namespace is refused as a namespace ...`
- mutation: the `body`/`searchTable` refusal replaced by a plain success (interop rebuilt) -> `the audit trail of the built server names the action and the outcome` (also the pre-existing `NOT_IMPLEMENTED` rows)

**Code-review pass (2026-10-16).**
- Doc and roster tests: `story-39-1-doc-claims`, `docs-visibility-roster-sync`, `docs-prompt-sync`, `story-38-6-doc-claims`, `live-gate-roster` and `tool-visibility-snapshot-drift`, 81 passed.
- eslint on the gate file: clean.
- `MessageSearchTest`, reloaded: 5 of 5.
- The armed gate: 104 passed and 1 skipped (the capture row). `[PERF]`: bootstrap start 180 ms; one `headers` call on A 52 ms.
- Afterwards, `iris_namespace_list` and `iris_database_list` show no `EXECMCPTMP391*` name.
- `pnpm gen:governance-baseline:check`: OK. It is the pin for AC-7's frozen-baseline clause; the frozen file is never mutated.
- mutation: the Story 39.1 note in `tool_support.md` says "**disabled by default**" -> `story-39-1-doc-claims.test.ts` `the Story 39.1 note says all three keys are reads, enabled by default, and how to restrict one` (AC-4, the docs state the default state). Reverted; `shasum` identical.

**Residual risks.** (1) The executing path of `resendFiltered` is unverified here (deferred, frontmatter). (2) `%SelectMode = 0` cannot be shown to matter on an instance whose `$ZTIMEZONE` is 0; the line is explicit and pinned only by review. (3) The cursor at stored trailing-zero times is proven on the synthetic fixture only. (4) The review-pass patches (about 250 lines of test code and one IRIS expression) were verified by the mutations above but not re-reviewed by the adversarial layers.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** `iris_message_search` (interop, read-only) searches message headers over the new route `POST /interop/message/search`. Its `action` enum is `headers` | `body` | `searchTable`; `headers` takes a required window of at most 7 days plus item, source, target, status, session, body class and error-flag filters, and returns keyset-paged header rows (oldest first, `limit` 100 by default and 500 at most) with UTC ISO times and `...Raw` siblings. `body` and `searchTable` return the new `NOT_IMPLEMENTED` refusal with no IRIS call. A namespace without Interoperability returns `notApplicable`. The filters-to-WHERE translation moved out of `resendFiltered` into `MessageSearch.HeaderWhere`, which both handlers call; `resendFiltered`'s dry runs and refusals answer byte for byte as before. `BOOTSTRAP_VERSION` moved `089f8f0a62b2` to `6dcdd238c792` (31 classes). Interop is at 23 package tools (24 advertised), `core` 11 and `developer` 24; all three keys are reads, enabled by default.

**Files changed.**
- `src/ExecuteMCPv2/REST/MessageSearch.cls` (new): `HeaderWhere`, `HeaderRow`, and the `MessageSearch` handler.
- `src/ExecuteMCPv2/REST/MessageResend.cls`, `src/ExecuteMCPv2/REST/Dispatch.cls`: `resendFiltered` builds its WHERE from `HeaderWhere`; the new route.
- `src/ExecuteMCPv2/Tests/MessageSearchTest.cls` (new): 5 OS tests.
- `scripts/gen-bootstrap.mjs`, `packages/shared/src/bootstrap-classes.ts` (generated), `packages/shared/src/__tests__/bootstrap.test.ts`: the roster entry and the regenerated embed.
- `packages/shared/src/refusals.ts` and its test, `pre-feature-tool-snapshot.ts`, `tool-visibility-backcompat.test.ts`: `NOT_IMPLEMENTED` and the new tool name.
- `packages/iris-interop-mcp/src/tools/message-search.ts` (new), `index.ts`, `presets.ts`, `message-resend.ts` (`STATUS_LABELS` exported): the tool, its registration and both preset rows.
- `packages/iris-interop-mcp/src/__tests__/message-search.test.ts`, `message-search-governance.test.ts` (new), `index.test.ts`, `presets.test.ts`, `presets.e2e.test.ts`: unit, governance and count tests.
- `packages/iris-mcp-all/src/__tests__/interop-namespace-fixture.ts` (new harness), `interop-namespace-fixture.test.ts` (name-guard unit test), `story-39-1-message-search-live-gate.test.ts` (60 rows), `story-39-1-gate-guards.test.ts`, `story-39-1-doc-claims.test.ts`, `fixtures/story-39-1-resend-baseline.json`, `process-gate-helpers.ts` (`executeMcpPost`, `docFixtures`), `docs-prompt-sync.test.ts`, and `scripts/prepublish-gate.mjs` (gate listed).
- `README.md`, `packages/iris-interop-mcp/README.md`, `packages/iris-mcp-all/README.md`, `tool_support.md`, `CHANGELOG.md`, `docs/epic-summary.md`, `docs/migration-v1-v2.md`, `.changeset/story-39-1-message-header-search.md`: counts, the default state of the three keys, the new section and the bumps.

**Review findings.** 40 findings from four layers (high 0, medium 12, low 26, false 2): 25 rows patched (18 root causes; 7 medium), 2 rows deferred (1 entry), 13 rows rejected. Patches: the doc-claims version pin; paging guidance for an omitted `to`; the case-insensitivity of the name filters (docs and gate rows); the direct-REST default `to` with milliseconds; the `NOT_IMPLEMENTED` wording; the exactly-full page row; a per-step teardown; the fixture name-guard unit test and OS-refusal gate row; the leftovers positive control; the gate-guards test; the refusal-ordering, defaults, and window-bound rows; the docs over-claim about the resending path; and mutation lines for the resend-uses-helper, rosters and tools-array claims. Deferred: the executing path of `resendFiltered` (see the frontmatter). Rejected, each with its reason in the triage log: `%SelectMode` unprovable on a UTC instance (twice, plus the intent-layer repeat); the hard-coded HSCUSTOM fixture home; the host-clock default `to` (spec-bound); empty-string filters (documented `HeaderWhere` contract); empty-filter widening of a resend (unreachable); the vacuous-looking `to` token row (false); the unknown-namespace text assertion; the `toCanonicalUtc` table; concurrent-run collision (by design); the engine tie order of the byte-identity baseline; and `HeaderWhere`'s defensive branches.

**Follow-up review recommendation: true** (7 medium entries patched). The unverified risk: the review-pass patches (about 250 lines of default-suite test code, the gate rows, and the one-expression IRIS change that moved `BOOTSTRAP_VERSION` again) were verified by the mutations above but not re-reviewed by the adversarial layers.

**Verification performed.** The `## Verification` loop lines after every patch pass and the `(once)` lines once after the last patch, with the counts and mutation lines recorded under `### Results` and `Review-pass results`.

**Residual risks.** The executing path of `resendFiltered` is unverified here; `%SelectMode = 0` cannot be shown to matter while `$ZTIMEZONE` is 0; the cursor at stored trailing-zero times is proven on the synthetic fixture only.
