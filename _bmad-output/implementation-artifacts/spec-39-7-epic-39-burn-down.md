---
title: 'Story 39.7: Epic 39 Burn-Down'
type: 'bugfix'
created: '2026-10-17'
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
deferred:
  - summary: >-
      iris_metrics_interop's 24-hour error count (Monitor.cls) counts Event Log rows with Type = 3, which is Warning; Error is 2. The cutoff is local $Horolog, while TimeLogged is UTC.
    evidence: >-
      src/ExecuteMCPv2/REST/Monitor.cls:579 "WHERE Type = 3 AND TimeLogged > ?" with tCutoff = $ZDateTime($Horolog - 1, 3); irislib/Ens/DataType/LogType.cls:11-13 DISPLAYLIST ",Assert,Error,Warning,Info,Trace,Alert" VALUELIST ",1,2,3,4,5,6". Found while planning DW-576 (plan stage, 2026-10-17); source reading only.
    location: 'src/ExecuteMCPv2/REST/Monitor.cls:579'
    severity: 'med'
  - summary: >-
      The iris_production_logs type filter probably matches nothing: the EventLog handler binds the display name ("Error") to "Type = ?" in logical select mode, and Type is an integer (Ens.DataType.LogType, values 1 to 6).
    evidence: >-
      src/ExecuteMCPv2/REST/Interop.cls:1207 and :1225-1229 (tType from the query string, bound unchanged to %ExecDirect, select mode 0); irislib/Ens/DataType/LogType.cls:11-13. Source reading only, not probed live: probe it in a disposable namespace before fixing.
    location: 'src/ExecuteMCPv2/REST/Interop.cls:1225'
    severity: 'med'
---

<intent-contract>

## Intent

**Problem:** Epic 39 left five ledger entries that the decision sheet chose to fix now (orchestrator decisions #30–#32):
- **DW-569.** The shared HTTP client reports an HTTP 400 with an empty Atelier error list as an empty success.
- **DW-571.** A dev live gate compares two listings of the shared HSCUSTOM, so concurrent writes make it flake.
- **DW-572.** On an untuned table, `iris_message_search` with an item or status filter plans past its time window.
- **DW-576.** Under `block`, `iris_production_logs` and `iris_message_diagram` still show message-derived text.
- **DW-583.** Under `allow`, `iris_message_body` hides the text of a body held in a character-stream property, such as `HS.Message.XMLMessage` `ContentStream`.

**Approach:** One fix per entry. Each is proven live on the real surface or by mutation (Rule #48), and each behavior change is a sanctioned AD-15 change named in `CHANGELOG.md`.
- **The live proof.** One new default-suite gate, `story-39-7-burn-down-live-gate.test.ts`, drives the built servers against the disposable namespace `EXECMCPTMP397A`.
- **Unchanged paths.** Every path the entries do not name stays byte-identical, and a pin proves it.

## Boundaries & Constraints

**Always:**
- **DW-569 (`IrisHttpClient`, AD-1 / AD-11).**
  - **The rule.** Every non-2xx response throws `IrisApiError`, including an HTTP 400 whose `status.errors` is empty. The error carries `statusCode`, `errors: []`, `originalUrl` and the envelope `result`, with today's message form.
  - **Unchanged.** A 2xx response is handled exactly as today. That includes a 2xx with non-empty `status.errors`, which still throws.
  - **Kept results.** A legitimate empty result stays a success. The live probe in Design Notes shows that every valid no-result `action/search`, `getmacrodefinition` and `getmacrolocation` request answers 200.
  - **The one tool-level exception.** `iris_macro_info` with `document` omitted or empty keeps today's output byte-identical: `{name, definition: {}, location: {}}`. That is recommended decision OD-2, and the tool's own description advertises it.
- **DW-571.** The `iris_package_list` row of `doc-type-description-live-gate.test.ts` compares what cannot move under concurrent writes:
  - the outgoing request equals the wire read's request;
  - `totalDocs` equals the count of the very envelope the handler received.

  The gate stays in dev's `prepublish-gate.mjs` roster, and every other row keeps its assertion.
- **DW-572 (decision #30; AD-20).**
  - **The hint.** `MessageSearch` gains `Parameter HEADERHINT = "%IGNOREINDEX Ens.MessageHeader.Status,Ens.MessageHeader.SourceConfigName,Ens.MessageHeader.TargetConfigName"`.
  - **Where it goes.** It goes in the `headers` statement's FROM clause, which moves into a new `HeaderStatement` method. Per OD-1, it also goes in `BodyStatement`, written `FROM %INORDER <hint> Ens.MessageHeader h`.
  - **What stays.** `HeaderWhere`, `resendFiltered`'s statements, its `ORDER BY TimeCreated` and its tie order are unchanged. Rows and order are unchanged too: `ORDER BY TimeCreated, ID` stays.
  - **The measure.** Each plan reads the `Ens.MessageHeader.TimeCreated` index map with a range condition, and reads no bitmap index of `Status`, `SourceConfigName` or `TargetConfigName`.
- **DW-576 (decision #31).**
  - **Under `block` only.** `iris_production_logs` and `iris_message_diagram` declare `dataPolicy: {}`, and under `block` they withhold their message-derived text in TypeScript, with fixed reasons:
    - **Each log entry** loses `text` and gains `textPolicy: {outcome: "blocked", reason}`.
    - **Each diagram error warning** keeps its prefix, `Error on message <id>: `, and the rest becomes the reason. That applies in `warnings[]` and in every Mermaid `%% Error on message <id>: ` line.
    - **The result** carries `dataPolicy: {policy: "block", redacted: 0, blocked: N}`.
  - **Under `redact` and `allow`.** Both tools' success and error responses are byte-identical to today's, with no `dataPolicy` key. The audit falls back to the profile's policy with 0 counts.
- **DW-583 (decision #32).**
  - **The dump.** `MessageBody.PropertyDump(pObj, pMaxChars = 0, Output pComplete)` renders the text of each top-level character-stream property (`IsCharacter()`) as `{"stream", "size", "text"}`.
    - Text is read with `ReadStreamText` under one shared budget of `pMaxChars` characters across the dump, and `pComplete` is 0 when any stream was cut.
    - A binary stream stays `{stream, size}`.
    - With `pMaxChars = 0` (the default), the dump is today's.
  - **When it applies.** `JsonText` passes its cap. The dump is reached only under `bodyRead:"all"` (policy `allow`).
  - **Other policies.** `redact` withholds the body (IRIS never reads it), and `block` returns kind metadata only.
  - **Truncation.** It is reported as today: TypeScript's cut OR `bodyTextComplete: false`.
- **Shared mechanics.**
  - **Bootstrap.** `MessageSearch.cls` and `MessageBody.cls` change, so run `pnpm gen:bootstrap` once after both and record `BOOTSTRAP_VERSION` `2fd17b50a024` → new (Rule #24). Gates assert the deployed version.
  - **Descriptions.** These descriptions change: `iris_production_logs`, `iris_message_diagram`, `iris_message_body` and `iris_message_search`.
    - Run `pnpm gen:tools-list-snapshot --force` once, after the final build, with a CHANGELOG line naming the 4 re-pinned entries (decision #29).
    - Update the README payload rows to equal `pnpm measure:tools-payload`.
  - **Gate shape.** The new gate uses the 39.x shape:
    - its own `REQUIRE_LIVE` comparison;
    - the two literal dist-freshness lines;
    - `dev = await openWireSession(...)` followed by `await assertDeployedBootstrapVersion(REPO_ROOT, TARGET);`;
    - tag `story-39-7-burn-down-live-gate`;
    - the armed text `IRIS_REQUIRE_LIVE is set, so the Story 39.7 live gate may not be skipped: <reason>`;
    - a listing in `prepublish-gate.mjs` `gateTestFiles` and in `story-39-1-gate-guards.test.ts` `GATES` (`story: "Story 39.7"`);
    - helpers from `process-gate-helpers.ts` only.
- **Fixture ν.** It is synthetic and lives only in `EXECMCPTMP397A`.
  - **The namespace.** It is mapping-only: `Ens`/`EnsLib` → ENSLIB, routines `Ens*` → ENSLIB, plus package `HS` → HSLIB.
  - **Values.** Identifying values contain `SYNTHPHI397` and surviving values contain `KEEPME397`. Times fall on 2001-02-03 UTC.
  - **Production.** None is started.
  - **Lifecycle.** As in the 39.5 gate: remove leftovers and assert there are none, create, seed, run a positive control; then tear down each step separately and assert nothing is left.
- **Counts that do not move.** 109 package / 114 advertised tools, 13 prompts, interop `core` 12 runtime, baseline `1e62c5ad5bf7`/141 (`:check` only). No tool, action, key, preset row, `TOOL_PAIRS` entry, annotation, input schema or environment variable is added.
- **Text.** Source is ASCII, with escapes for anything else (Rule 14). Comments state the contract. Every live run names its target with the six `IRIS_*` variables and `IRIS_REQUIRE_LIVE=1`, and every MCP call names `server:"default"`.

**Never:**
- **No `HeaderWhere` change** and no `resendFiltered` statement change. No hint inside `HeaderWhere`.
- **No content sniffing (AD-26).** Withholding is by policy and by the tools' own fixed text templates, never by inspecting text.
- **Policy limits.** Logs and diagram are not redacted under `redact`. No body content reaches stderr, the audit file or an error text.
- **Shared instance.**
  - Never start a production.
  - Never call `EnableNamespace`.
  - Never read HSCUSTOM's or another project's messages or Event Log. The dev rows read only docnames, search and macro metadata in HSCUSTOM.
  - Never stop or reconfigure IRIS.
- **Generated and protected files.** No hand edit of `bootstrap-classes.ts`, the tools-list snapshot, `skills/` or `governance-baseline.ts`. Never run the bare governance-baseline generator.
- **Owned elsewhere.** DW-578 (accepted residual), DW-579 (Story 43.1), G31/G36/G37/G38, and the two `deferred:` items in the frontmatter.
- **Release.** No `changeset version`, no publish, no compliance claim in any document.

## I/O & Edge-Case Matrix

**Fixture ν** (`EXECMCPTMP397A`, `Story397.Seed.Seed()`). The headers come from `Story391Fixture.Add`, with times 2001-02-03 12:00:0n UTC:

| H | Session | Type / Status / IsError | Source → target | Body |
|---|---|---|---|---|
| 1 | 397001 | Request / Completed (9) / 0 | `Story397.Service` → `Story397.Router` | X1 `HS.Message.XMLMessage` |
| 2 | 397001 | Response / Completed / 0 | `Story397.Router` → `Story397.Service` | S1 `Story397.StreamBody` |
| 3 | 397002 | Request / Completed / 0 | `Story397.Service` → `Story397.Operation` | S2 `Story397.StreamBody` |
| 4 | 397002 | Response / Error (8) / 1 | `Story397.Operation` → `Story397.Service` | none (literal `""`) |

H4's `CorrespondingMessageId` is H3, and its `ErrorStatus` is `$$$ERROR($$$GeneralError,"SYNTHPHI397-ERR PID|1||SYNTHPHI397-MRN-D")`.

The bodies:
- **X1:** `Name` `KEEPME397-XML`, `ContentStream` `<Patient><Name>SYNTHPHI397-XML</Name><Code>KEEPME397-CODE</Code></Patient>`.
- **S1:**
  - `Name` `KEEPME397-S1`;
  - `Content` `<a>SYNTHPHI397-STREAM</a>` + CR LF + `line2` + `$C(1)` + `KEEPME397-TAIL`;
  - `Blob` (`%Stream.GlobalBinary`) the 16 bytes `SYNTHPHI397-BLOB`;
  - `Second` `KEEPME397-SECOND`.
- **S2:**
  - `Name` `KEEPME397-S2`;
  - `Content` 70,000 `x` characters followed by `SYNTHPHI397-LONG-END`;
  - `Blob` empty;
  - `Second` `SYNTHPHI397-SECOND-2`.

The Event Log rows (`Ens.Util.Log`, saved directly):
- **L1:** Type 2, `Story397.Operation`, session 397002, `SYNTHPHI397-LOG-1 PID|1||SYNTHPHI397-MRN-D`, source `Story397.Seed`/`Seed`.
- **L2:** Type 4, `Story397.Service`, no session, `KEEPME397-LOG-2 SYNTHPHI397-LOG-2`.

`Seed()` returns `{"headers":"1,2,3,4","logs":"1,2","xml":"1","stream":"1,2"}`. The window W is 2001-02-03T11:59:00Z to 12:01:00Z.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| DW-569 400 pair (dev gate, handlers) | `docListTool.handler({category:"CLS", type:"cls", filter:"%Library.Base"})`, then RTN/`cls` with `%occ` | Each rejects with `IrisApiError`, `statusCode` 400, `errors` `[]`; the plain-fetch control rows still read 400 | rejection |
| DW-569 400 pair (wire) | built dev over stdio, `iris_doc_list` CLS/`cls`, then RTN/`cls`, HSCUSTOM | `isError: true`; the text names `HTTP 400` and `docnames/CLS/cls` (respectively `RTN/cls`) | isError |
| DW-569 2xx unchanged (wire) | `iris_doc_list` CLS with filter `%Library.Base`; `iris_doc_search` `{query:"ZZZNOPE397", files:"ExecuteMCPv2.Utils.cls"}`; `iris_macro_info` `{name:"NOPEZZZ397", document:"%Library.Base.cls"}` | Not `isError`. Results: `%Library.Base.cls` listed, `{matches: []}`, and the raw Atelier POST `result` of each macro action | none |
| DW-569 empty query | `iris_doc_search {query:"", files:"ExecuteMCPv2.Utils.cls"}` | `isError: true`, naming HTTP 400. This was `{matches: []}` before; it is a CHANGELOG "Changed" line | isError |
| DW-569 macro, no document (OD-2) | `iris_macro_info {name:"OK"}`; control: plain POST `getmacrodefinition` with `docname:""` | Byte-identical to today's `{name:"OK", definition:{}, location:{}}`; the control reads HTTP 400 | none |
| DW-571 under churn | the `iris_package_list` row while a scratch script PUTs and DELETEs `ExecuteMCPv2.Temp.Story397Churn<n>.cls` in HSCUSTOM | New row: 3 of 3 runs green. The old count comparison, restored as a mutation: red in at least 1 of up to 5 runs | test failure (old) |
| DW-572 headers | default session, `headers` over W: item `Story397.Router` + status `Completed`; status only; source only; `bodyClass:"Story397.StreamBody"` + status + `errorOnly`; `sessionId:397001`; window only; a page after `nextCursor` | Rows equal `expectedRow` of the oracle. Afterwards every stored route `headers` statement in `EXECMCPTMP397A` `INFORMATION_SCHEMA.STATEMENTS` holds `%IGNOREINDEX`, and its plan passes `headerPlanProblems` (Design Notes) | none |
| DW-572 body (OD-1) | `body` on `Story397.StreamBody`, `[{property:"Name", op:"eq", value:"KEEPME397-S1"}]`, item + status | Rows equal the 39.3 `bodyJoinOracle`. The stored aliased statement holds `%INORDER %IGNOREINDEX`, its plan reads `Ens.MessageHeader(H).TimeCreated` with a range condition and no Status/Source/Target bitmap, and the header maps are read before the body | none |
| DW-576 logs, redact and allow | `iris_production_logs {namespace: A, count: 10}` on the default and allow sessions | `entries` deep-equal the Atelier SQL oracle over `Ens_Util.Log` (`ID DESC`, mapped as `Interop.cls:1263-1276` maps). There is no `dataPolicy` and no `textPolicy`, the two results are equal, and `SYNTHPHI397-LOG-1` appears (positive control) | none |
| DW-576 logs, block | the same call on the block session (`IRIS_DATA_POLICY=block`) | 2 entries. Each has no `text` and has `textPolicy {outcome:"blocked", reason: BLOCK_REASONS.eventLogText()}`, and its other fields equal the oracle. `dataPolicy {block,0,2}`. Neither `content` nor `structuredContent` holds `SYNTHPHI397` | none |
| DW-576 diagram, redact and allow | `iris_message_diagram {sessionIds:[397002], namespace: A}` | One warning is `Error on message <H4>: ...SYNTHPHI397-ERR...`; the Mermaid text holds it on a `%% ` line; there is no `dataPolicy`; redact and allow are equal | none |
| DW-576 diagram, block | the same call on the block session | That warning is exactly `Error on message <H4>: ` + `BLOCK_REASONS.diagramErrorText()`, and the Mermaid line is `<indent>%% ` + that warning. The Mermaid text with that line removed equals redact's with its line removed. `dataPolicy {block,0,1}`; no `SYNTHPHI397` anywhere | none |
| DW-576 audit and console | the audited block, redact and allow sessions | Log and diagram entries carry `dataPolicy` `{block,0,2}` / `{block,0,1}`, and `{redact,0,0}` / `{allow,0,0}`. No audit file and no stderr holds `SYNTHPHI397` | none |
| DW-583 allow | `iris_message_body {headerIds:[H1,H2,H3]}` under allow (default `maxChars`) | H1: `format:"json"`, `truncated:false`, parsed `ContentStream` = `{stream:"%Stream.GlobalCharacter", size, text:<X1 content>}`. H2: parsed `Content.text` equals the stored text (CR LF and U+0001 survive as JSON escapes), `item.text` holds no raw C0 character, `Blob` = `{stream:"%Stream.GlobalBinary", size:16}` with no `text`, and `Second.text` = `KEEPME397-SECOND`. H3: `truncated:true`, text length 10000, no `SYNTHPHI397-LONG-END` | none |
| DW-583 allow, larger cap | H3 with `maxChars: 100000` | `truncated:false`; the parsed `Content.text` ends with `SYNTHPHI397-LONG-END`, and `Second.text` = `SYNTHPHI397-SECOND-2` | none |
| DW-583 redact and block | H1–H3 under redact, then under block; and the raw route with `bodyRead:"hl7"` | redact: each body is blocked with `BLOCK_REASONS.unredactableKind("persistent")`, and the route returns no `bodyText`. block: kind only. Neither holds `SYNTHPHI397` | none |
| 39.5 pin amended | the 39.5 gate allow row, header 12 (`Story395.Plain`) | `"Note":{"stream":"%Stream.GlobalCharacter","size":13,"text":"SYNTHPHI-NOTE"}`, and the text contains `SYNTHPHI-NOTE`. The redact sentinel sweeps still hold | none |
| Gate unarmed / armed | a closed port (`story-39-1-gate-guards` nested run) | Every test skips with `[SKIP] story-39-7-burn-down-live-gate:`; armed, it fails with "Story 39.7 live gate may not be skipped" | skip / failure |

</intent-contract>

## Code Map

**DW-569: the client and the dev tools**
- `packages/shared/src/http-client.ts:387-408`: the non-2xx branch. The carve-out is `isEmptyResult400` at :394-396, and its comment at :388-391 goes. The error-envelope branch at :410-422 and the return at :424 stay. HEAD (:438-461) and 401 retry (:257-261) are unchanged.
- `packages/shared/src/errors.ts:61-67`: `IrisApiError(statusCode, errors, originalUrl, message?, result?)`.
- `packages/shared/src/__tests__/http-client.test.ts:756-908` (`error mapping`): add the rows. No existing row sends a 400 with `errors: []`.
- `packages/iris-dev-mcp/src/tools/intelligence.ts`:
  - `iris_doc_search` :169-175 has no catch, so an empty `query` becomes an error;
  - `iris_macro_info` :222-250 uses `Promise.all` on two POSTs. Add the OD-2 fallback: per call, catch an `IrisApiError` with `statusCode === 400`, `errors.length === 0` and `docname === ""`, and use `error.result`.
- `packages/iris-dev-mcp/src/__tests__/intelligence.test.ts`: mocked `ctx.http`. Add rows for the fallback, and for a 400 with a document, which still throws.
- `packages/iris-dev-mcp/src/__tests__/doc-type-description-live-gate.test.ts`:
  - the header :9-13 describes the carve-out, so rewrite it;
  - the `iris_package_list` row :169-185 compares counts of two full reads (DW-571); rewrite it with `vi.spyOn(ctx.http, "get")`;
  - the controls :204-214: add handler rejection rows next to them;
  - `vi` is not imported (:32).
- Spy precedent: `doc-edit-live-gate.test.ts:270`.
- The roster: `packages/iris-dev-mcp/scripts/prepublish-gate.mjs:99-101` (unchanged).
- Unaffected:
  - mocked CLS/`cls` calls at `doc.test.ts:493` and `packages.test.ts:278`;
  - `tools.integration.test.ts:320`, which already accepts a 400.

**DW-572: the statements**
- `src/ExecuteMCPv2/REST/MessageSearch.cls`:
  - `COLUMNS` :57;
  - `HeaderWhere` :74 (do not touch);
  - `BodyStatement` :407-419;
  - the inline `headers` statement :1077-1081 becomes `HeaderStatement(pWhere, pCursor)`, called at the same point;
  - arguments are bound at :1083-1097 (unchanged).
- `src/ExecuteMCPv2/REST/MessageResend.cls:606-671`: `resendFiltered`. Read only: it must stay byte-identical.
- OS pins:
  - `MessageSearchTest.cls` has 288 lines and 5 `Test*` methods. The `HeaderWhere` literals at :57-71 stay.
  - Moved by OD-1:
    - `MessageBodySearchTest.cls:259-266` (`TestBodyTableSystemClasses`, full literals);
    - `MessageSearchTableTest.cls:219,225,228,233` (`TestSearchTableStatementText`).
- TS plan checkers moved by OD-1:
  - `story-39-3-qa-live-gate.test.ts:437` (prefix) and :477 (meta-test literal);
  - `story-39-4-search-table-live-gate.test.ts:1169` and :1190.

  Each keeps its own checks and gains the hint in its literal.
- The response replays stay green: rows and order are unchanged.
  - `story-39-1-message-search-live-gate.test.ts:286` (resend);
  - `story-39-3-body-search-live-gate.test.ts:285`;
  - `story-39-4-search-table-live-gate.test.ts:312`.
- The plan-row mechanism to extend: `story-39-4-search-table-live-gate.test.ts:1166-1187` (`planProblems`) and :1220-1236. It reads `SELECT Statement, Plan FROM INFORMATION_SCHEMA.STATEMENTS`, and route statements are told apart by `SELECTTOP?H.ID,`; the unaliased `headers` statement is told apart by `SELECTTOP?ID,SESSIONID,`.
- `packages/iris-mcp-all/src/__tests__/header-row-oracle.ts`: `HEADER_COLUMNS` :52, `squash` :49, `expectedRow` :126, `bodyJoinOracle` :61. Add the export `headerPlanProblems` here.
- Docs advice "narrow the window or add filters":
  - the description in `packages/iris-interop-mcp/src/tools/message-search.ts:405-407`;
  - `packages/iris-interop-mcp/README.md:237`;
  - root `README.md:501`.

**DW-576: logs and diagram**
- `packages/iris-interop-mcp/src/tools/monitor.ts:22-96` (`productionLogsTool`):
  - no `mutates` (a baseline key) and no `dataPolicy`;
  - it returns `content` = `JSON.stringify(result, null, 2)` and `structuredContent: result` (:77-79);
  - the IrisApiError branch is :81-91.
- IRIS side, read only: `Interop.cls:1202-1285` `EventLog`. Its entry fields, in order: `id, timestamp, type, itemName, text, sourceClass?, sourceMethod?, sessionId?`.
- `packages/iris-interop-mcp/src/tools/diagram.ts`:
  - `DiagramEntry` :22-30, `renderDiagramText` :39-51;
  - the handler :113-163: `structuredContent: result` verbatim at :147, and the IrisApiError branch :148-160.
- IRIS template, read only:
  - `Correlator.cls:193-198` inserts `"Error on message "_id_": "_text`;
  - `Writer.cls:128-148` renders every warning as `<indent>%% ` + `SingleLine(warning)`;
  - `Generate.cls:201-232` gathers `warnings[]`.
- `packages/shared/src/data-policy.ts`:
  - `effectiveDataPolicy` :161-163;
  - `DataPolicySummary` :187-191;
  - `BodyPolicyOutcome` :194-197 (the shape `textPolicy` mirrors);
  - `BLOCK_REASONS` :204-219, which gains `eventLogText()` and `diagramErrorText()`.
- `packages/shared/src/tool-types.ts:149-167`: `dataPolicy` (with `actions` absent, the policy governs every call). `governance.ts:853-889`: `assertDataPolicyDeclarations`.
- `packages/shared/src/server-base.ts:1754-1775`: the audit derivation. When `structuredContent.dataPolicy` is absent it uses the profile's policy with 0 counts.
- Precedent for an error response: `message-body.ts:442-458` adds `dataPolicy` to its IrisApiError response.
- Tests:
  - `packages/iris-interop-mcp/src/__tests__/monitor.test.ts:14-115`;
  - `diagram.test.ts`: :109-118 pins `structuredContent` verbatim under the default ctx, and :120-136 the warnings;
  - `diagram-qa.test.ts`, `diagram-governance.test.ts`.
- Patterns:
  - `ctxWith(policy)`: `message-resend-policy.test.ts:68-77`;
  - audit-level `auditedCall`: `message-body-governance.test.ts:149-190`.
- The scope:
  - `packages/iris-mcp-all/src/__tests__/data-policy-scope.ts:91-98`: both rows `residual` today;
  - the date stays `DATA_POLICY_SCOPE_DATE` (:17);
  - `data-policy-scope.test.ts:72-88`: the hard-coded governed list gains both, sorted.
- `tool_support.md`: :419-420 (rows), :428 (`ErrorStatus` sentence), :430 (closing paragraph).

**DW-583: stream properties**
- `src/ExecuteMCPv2/REST/MessageBody.cls`:
  - `ReadStreamText` :62-100 (a bounded prefix read; it never throws);
  - `CutText` :41;
  - `JsonText` :128-152, whose PropertyDump branch :141-142 passes `pMaxChars` and folds the dump's `pComplete` into its own;
  - `PropertyDump` :165-209, with the stream branch :185-188 and the doc comment :154-164;
  - the class comment :11.
- `IsCharacter()` comes from `irislib/%Stream/Object.cls:69`.
- `BodyKind` (`MessageSearch.cls:662-678`) classifies `HS.Message.XMLMessage` as `persistent`.
- `packages/iris-interop-mcp/src/tools/message-body.ts`:
  - `bodyReadWire` :68-72 (allow = `all`, `max(maxChars, 65536)`);
  - `shown` :235-244 (sanitize, then cut);
  - the description :309-310 ("a stream is its class and size only"), :315 and :347.

  There is no TypeScript logic change.
- Pins that move:
  - `story-39-5-body-reader-live-gate.test.ts:505-514` (the allow row for header 12);
  - `story-39-5-doc-claims.test.ts:217`, which pins interop `README.md:283`.

  The redact sweeps `NON_HL7_SENTINELS` (:322-333, used at :619 and :776) stay.
- `MessageBodyTest.cls`: 166 lines, 4 `Test*` methods; `TestPropertyDump` is :139-164 (its one-argument calls stay valid).
- Fixtures: `interop-namespace-fixture.ts`.
  - The namespace helpers: `createInteropNamespace` :420-450, `removeInteropNamespace` :461-476, `INTEROP_PACKAGE_MAPPINGS` :67, `Leftovers` (in `FIXTURE_CLASS_SOURCE`) :316-345, `RemoveDatabaseFiles` :293.
  - The seeding helpers: `putCompileSeed` :1011, `Story391Fixture.Add` :79 (with `pProcessed`, `pCorresponding`), `seedBodyReader` :1366, and `STORY395_*` :1099-1353.

**Gate and docs**
- Gate templates:
  - `story-39-5-body-reader-live-gate.test.ts:345-412` (arming, sessions, namespace lifecycle), :414-448 (`afterAll`);
  - `epic39-capstone-gate.test.ts` (`openAuditedSession`, `teardownRecorder`);
  - `process-gate-helpers.ts` (`distEntry`, `skipTest`, `postEnvelope`, `pollAuditEntries`, `atelierScalar`, `irisClassMethod`).
- Rosters:
  - `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles`;
  - `story-39-1-gate-guards.test.ts:36-47` `GATES`, plus its completeness test;
  - `live-gate-roster.test.ts`.
- Docs anchors:
  - root `README.md`: :499 (logs and diagram "sit outside"), :501, :742 ("What it governs today.", one paragraph), :764 (audit list);
  - interop `README.md`: :52 (audit list), :58 (PHI section), :237, :283;
  - `tool_support.md:386-430`;
  - `docs/client-config/claude-code.md:282`, `claude-desktop.md:249`, `cursor.md:280`.
- Doc pins: `story-39-6-doc-claims.test.ts:253` pins the root audit list, so repin it to the new list.
- CHANGELOG: the top section is 39.6 (:5), and `story-39-6-doc-claims.test.ts:74-84` needs only 39.6 above 39.5.

## Tasks & Acceptance

**Execution** (in dependency order; build each touched package before running tests that read its dist):

1. **`packages/shared/src/http-client.ts`** (DW-569): remove the carve-out, so every `!response.ok` throws `IrisApiError(response.status, errors, path, <today's message>, envelope?.result)`.
   - `http-client.test.ts`:
     - 400, 404, 409 and 500 with `errors: []` reject with `statusCode`, `errors: []`, `originalUrl` and `result`;
     - 200, 201 and 202 (with `Location`) with `errors: []` resolve to the parsed envelope (`toEqual` the input);
     - a 200 with errors still throws.
2. **`packages/shared/src/data-policy.ts`**: add `BLOCK_REASONS.eventLogText()` and `BLOCK_REASONS.diagramErrorText()` with the exact texts in Design Notes, and export them (`index.ts` already re-exports `BLOCK_REASONS`). Pin both texts in the shared `data-policy` tests.
3. **`packages/iris-dev-mcp/src/tools/intelligence.ts`** (OD-2): add the `iris_macro_info` fallback for an empty `docname`, so the output is byte-identical. No description change.
   - `intelligence.test.ts`: the fallback gives today's output; a 400 with a document still yields an error; `Promise.all` order is kept.
4. **`packages/iris-dev-mcp/src/__tests__/doc-type-description-live-gate.test.ts`** (DW-569 and DW-571):
   - **Header.** Rewrite it to the new contract.
   - **New rows.** The CLS/`cls` and RTN/`cls` handler rows reject with `IrisApiError` 400.
   - **The `iris_package_list` row.** It spies `ctx.http.get`, asserts that the first call's path equals `atelierPath(version, IRIS_NAMESPACE, \`docnames/${category}/${type}\`)` with no query string (`packages.ts:186-198` adds one only for `generated`, which the row does not pass), and asserts that `totalDocs` equals the `result.content` length of that call's own resolved envelope (`mock.results[0].value`).
   - **Kept.** Every other row is unchanged.
5. **`src/ExecuteMCPv2/REST/MessageSearch.cls`** (DW-572):
   - add `Parameter HEADERHINT`;
   - add `HeaderStatement(pWhere As %String, pCursor As %Boolean = 0) As %String`, with today's text plus `FROM <HEADERHINT> Ens.MessageHeader`;
   - call it at :1077;
   - per OD-1, put `FROM %INORDER <HEADERHINT> Ens.MessageHeader h` in both `BodyStatement` branches;
   - give each a contract doc comment.
6. **`src/ExecuteMCPv2/REST/MessageBody.cls`** (DW-583): `PropertyDump(pObj, pMaxChars As %Integer = 0, Output pComplete As %Boolean)` follows the dump rule in Design Notes. `JsonText` passes `pMaxChars` and sets `pComplete` to 0 when either the cut or the dump is incomplete. Update the doc comments.
7. **OS tests.** Load each changed class with a glob path (`/Users/jbrandt/git/iris-execute-mcp-v2/src/**/MessageSearch.cls`, and likewise for the others; Rule #17).
   - `MessageSearchTest.cls`:
     - `TestHeaderStatementText` pins the plain and paged `HeaderStatement` literals, including the hint;
     - `TestHeaderHintIndexesExist` checks that `%Dictionary.CompiledIndex` holds `Ens.MessageHeader||Status`, `||SourceConfigName` and `||TargetConfigName`. That keeps a renamed index from making the hint a silent no-op.
   - The OD-1 literals in `MessageBodySearchTest.cls:259-266` and `MessageSearchTableTest.cls:219-233`.
   - New data-free fixture `src/ExecuteMCPv2/Tests/MessageBodyStreamFixture.cls` (`%RegisteredObject`: `Name`, `Content` `%Stream.GlobalCharacter`, `Blob` `%Stream.GlobalBinary`, `Second` `%Stream.GlobalCharacter`). It is not bootstrapped.
   - `MessageBodyTest.cls` `TestPropertyDumpStreams`, on unsaved objects:
     - text, size and `pComplete = 1` under a large cap;
     - a binary stream as `{stream, size}`;
     - budget 10: `Second.text` `""` and `pComplete = 0`;
     - `pMaxChars = 0`: today's JSON exactly;
     - an unsaved `HS.Message.XMLMessage` shows its `ContentStream` text;
     - `JsonText` reports `pComplete = 0` for a cut stream.

   Each class stays at or under about 500 lines.
8. **`pnpm gen:bootstrap`.** Record `BOOTSTRAP_VERSION` `2fd17b50a024` → new in `## Verification`.
9. **`packages/iris-interop-mcp/src/tools/monitor.ts`** (DW-576):
   - **Declaration.** `dataPolicy: {}`. Read the policy with `effectiveDataPolicy(ctx.config)`.
   - **Under `block`.** Every entry is rebuilt with `textPolicy` in place of `text`, keys otherwise in today's order, and the result is `{entries, count, dataPolicy: {policy:"block", redacted:0, blocked: entries.length}}`. `content` is the JSON of that result. An IrisApiError response keeps today's text and adds `structuredContent: {dataPolicy: {block,0,0}}`.
   - **Otherwise** the output is today's, unchanged.
   - **Description.** Add one sentence: "Under the block PHI data policy (IRIS_DATA_POLICY) each entry's text is withheld with a reason in textPolicy; under redact and allow it is shown unchanged."
10. **`packages/iris-interop-mcp/src/tools/diagram.ts`** (DW-576):
    - **Declaration.** `dataPolicy: {}`.
    - **Under `block`.** Rewrite each `warnings[]` string matching `/^(Error on message \d+: ).*$/s` to `$1` + the reason, and each Mermaid line matching `/^(\s*%% Error on message \d+: ).*$/gm` to `$1` + the reason. The structured content is the rewritten result plus `dataPolicy {block, 0, <warnings rewritten>}`, and `content` is rendered from the rewritten entries. An IrisApiError response adds `dataPolicy {block,0,0}`.
    - **Otherwise** the output is today's, unchanged.
    - **Description.** One sentence on `block`, as in Task 9.
11. **`packages/iris-interop-mcp/src/tools/message-body.ts` and `message-search.ts`**: the description edits in the Docs table, rows D9 and D10.
12. **Interop unit tests**, in the new `packages/iris-interop-mcp/src/__tests__/logs-diagram-policy.test.ts` (`monitor.test.ts` and `diagram.test.ts` stay unchanged and green):
    - under redact and allow, the output `toEqual` today's literal (AD-15 pin, no `dataPolicy` key);
    - under block: entries, reasons and counts;
    - the two Mermaid forms (arrow and loop indents);
    - a warning that is not an error warning is untouched;
    - the error-response `dataPolicy`;
    - an audit-level row per tool (`auditedCall` pattern): `{block,0,N}` / `{redact,0,0}`.
13. **`packages/iris-mcp-all/src/__tests__/data-policy-scope.ts`**: both rows become `governed` with the reasons in Design Notes, and the date stays. `data-policy-scope.test.ts:83-87` gains `["iris_message_diagram", undefined]` and `["iris_production_logs", undefined]`, sorted.
14. **`interop-namespace-fixture.ts`**:
    - `createInteropNamespace` options gain `hsLib?: boolean` (package `HS` → `HSLIB`);
    - `removeInteropNamespace` always deletes an `HS` mapping, unchecked and idempotent;
    - `Leftovers` also reports `package mapping <ns> HS`;
    - add `STORY397_STREAM_BODY_SOURCE` (`Story397.StreamBody`, `%Persistent`), `STORY397_SEED_SOURCE` (`Story397.Seed`, guarded to `EXECMCPTMP397<A-Z>`, refusing a namespace that holds headers; it builds fixture ν and saves `Ens.Util.Log` rows directly), `STORY397_DOCUMENTS`, `STORY397_IDS` and `seedBurnDown(dev, name)` through `putCompileSeed`;
    - add an `interop-namespace-fixture.test.ts` row for the `STORY397_IDS` shape.
15. **`header-row-oracle.ts`**: add `headerPlanProblems(statement, plan)`, which reports:
    - a missing `%IGNOREINDEX` with the three names;
    - no `Read index map Ens.MessageHeader(\(H\))?.TimeCreated, looping on (H\.)?TimeCreated \(with a range condition`;
    - any `bitmap index Ens.MessageHeader(\(H\))?.(Status|SourceConfigName|TargetConfigName)`.

    Then update the 39.3 QA and 39.4 checkers' literals (OD-1).
16. **`packages/iris-mcp-all/src/__tests__/story-39-7-burn-down-live-gate.test.ts`** (new): the 39.x header and arming, then:
    - **`beforeAll`:**
      1. arm;
      2. `dev`, then the version assert;
      3. `admin`;
      4. `putFixtureClass`;
      5. remove A and assert no leftovers;
      6. `createInteropNamespace(admin, dev, "EXECMCPTMP397A", {interop:true, hsLib:true})`;
      7. `seedBurnDown`;
      8. a positive leftovers control;
      9. the sessions: default redact with `openAuditedSession`, allow audited, block audited.
    - **Describes:** DW-569 wire rows, DW-572 rows plus the plan rows and a "checker can fail" meta-row on the Design Notes plan samples, DW-576 logs, diagram and audit, DW-583, all per the matrix.
    - **`afterAll`:** `teardownRecorder` (the namespace, `leftovers`, the fixture class, temp dirs, and an `iris_doc_list` of HSCUSTOM with generated documents included showing no `Story397` and no `Story391Fixture` document).
    - **Rosters:** add it to `prepublish-gate.mjs` `gateTestFiles`, with a two-line comment saying it drives the built dev, admin and interop servers and writes `EXECMCPTMP397A`, `Story397.*` and `ExecuteMCPv2.Temp.Story391Fixture`. Add it to `GATES`.
17. **`story-39-5-body-reader-live-gate.test.ts:505-514`**: the sanctioned amendment of the header-12 allow row (matrix row "39.5 pin amended").
18. **Docs**, per the Docs table:
    - repin `story-39-5-doc-claims.test.ts:217` and `story-39-6-doc-claims.test.ts:253`;
    - add `CHANGELOG.md` top section `## [Pre-release — 2026-10-17] — Story 39.7: Epic 39 burn-down` with `### Changed`, `### Fixed`, `### Documentation` and `### Tests`, including the 4 re-pinned snapshot entries and the bootstrap move. It holds no `(full|core|developer) N/N/N/N/N` string.
    - add `.changeset/story-39-7-epic-39-burn-down.md`: `"@iris-mcp/shared": minor`, `"@iris-mcp/dev": patch`, `"@iris-mcp/interop": minor`.
19. **`packages/iris-mcp-all/src/__tests__/story-39-7-doc-claims.test.ts`** (new; no IRIS) pins:
    - each Docs-table row by its anchor, with its default-state phrase ("a read, enabled by default");
    - the CHANGELOG title and its four headings;
    - the changeset map;
    - no `CLAIMS` / `REDACTED_TEXT_SHOWN` hit.
20. **After the final build of every package**: run `pnpm gen:tools-list-snapshot --force` once (only the 4 entries move, `--check` exits 0), then `pnpm measure:tools-payload`, and set the README payload rows to its output.
21. **This spec's `## Verification`**: record:
    - the commands and their results;
    - the EXPLAIN after-table on the deployed statements (`iris_sql_analyze` `explain`, HSCUSTOM, plan only);
    - every `mutation:` line;
    - the churn-run record;
    - the bootstrap move.

**Acceptance Criteria:**
- **AC-1 (DW-569; AD-1, AD-11).** Given the rebuilt shared and dev packages, when the dev gate's 400 rows and the 39.7 gate's DW-569 rows run armed, then CLS/`cls` and RTN/`cls` are errors naming HTTP 400 on both the handler and the MCP wire, and `iris_doc_search` with an empty query is an error.
- **AC-2 (DW-569 back-compat; AD-15).** Given the same tree, when `http-client.test.ts` and the 2xx wire rows run, then:
  - every 2xx response resolves exactly as before;
  - a no-result search, a known-document macro lookup and a CLS listing are successes equal to the raw Atelier result;
  - `iris_macro_info` with no document returns today's output byte for byte (OD-2).
- **AC-3 (DW-571).** Given scratch churn of `ExecuteMCPv2.Temp.Story397Churn*` documents in HSCUSTOM, when the dev gate runs 3 times under churn and the dev package runs 3 times in its default parallel mode, armed, then every run passes. Restoring the old count comparison goes red under churn.
- **AC-4 (DW-572; decision #30, AD-20).** Given the deployed classes, when the 39.7 gate's real `headers` calls (and, per OD-1, a `body` call) have run, then:
  - every stored route statement carries the hint and its plan passes `headerPlanProblems`;
  - every result equals the SQL oracle;
  - the 39.1 resend replay and the 39.3/39.4 response replays still pass byte for byte;
  - the recorded EXPLAIN after-table shows the TimeCreated range access path for item + status, status, source, body class + status + error-only, session and window-only shapes.
- **AC-5 (DW-576; decision #31, AD-26, AD-19).** Given the block, redact and allow sessions, when `iris_production_logs` and `iris_message_diagram` run on fixture ν, then:
  - under `block` no `SYNTHPHI397` reaches either result, and every withheld value carries its fixed reason and is counted in `dataPolicy`;
  - under `redact` and `allow` both results equal today's shape with the text shown;
  - the audit entries carry the policy and counts;
  - no audit file and no stderr holds `SYNTHPHI397`.
- **AC-6 (scope).** Given the rebuilt dists, when `data-policy-scope.test.ts` runs, then the governed rows equal the declaring tools, which are now five, and the `tool_support.md` table says `governed` for both, with the reasons saying "under block only".
- **AC-7 (DW-583; decision #32, AD-26).** Given fixture ν, when `iris_message_body` reads H1–H3 under each policy, then:
  - under `allow` each character stream's stored text appears, bounded by `maxChars`, with `truncated` true exactly when cut;
  - binary streams stay class and size;
  - under `redact` and `block` no `SYNTHPHI397` appears and IRIS returns no body text;
  - the amended 39.5 row passes.
- **AC-8 (docs; Rules #30, #43).** Given the finished docs, when `story-39-7-doc-claims.test.ts` and every existing doc-claims test run, then:
  - every Docs-table row states its default state;
  - the CHANGELOG section and the changeset are pinned;
  - no compliance claim appears.
- **AC-9 (back-compat and records; AD-14, AD-15, AD-5).** Given the finished tree, when the Verification commands run, then:
  - the tool, prompt, preset and baseline counts are unchanged;
  - `gen:tools-list-snapshot:check` passes with exactly 4 re-pinned entries;
  - `gen:bootstrap` is idempotent at the new version;
  - `check-epics-sync.mjs` prints OK;
  - every per-package build, test, lint and type-check passes;
  - nothing is left on the instance.
- **AC-10 (Integration; Rules 1/2).**
  - The built dev server (consumer of `IrisHttpClient`) turns the live 400 into `isError`.
  - The built interop server (consumer of `BLOCK_REASONS` and `PropertyDump` through the route) produces the matrix outputs.
  - The 39.7 gate (consumer of the `hsLib` fixture option) creates and removes `EXECMCPTMP397A` with no leftovers.

## Spec Change Log

## Review Triage Log

## Design Notes

**Orchestrator decisions: DECIDED at the spec gate, 2026-10-17, both as recommended (#34 = OD-1: the index hint covers the `body` and `searchTable` statements too; #35 = OD-2: `iris_macro_info` with no document keeps its empty result via the narrow fallback). The lead updated the spine (AD-26 residual note; AD-15 sanctioned list), Rule 20.** The planning text follows:
- **OD-1.** Orchestrator decision needed: should DW-572's hint also bound the `body` and `searchTable` statements (`BodyStatement`), and not only `headers`? — recommended: yes, because:
  - plan-time EXPLAIN shows the same pathology in both. Body search with item + status + body class plans `((BodyClass ∩ Status) ∩ (Source ∪ Target))` bitmaps with TimeCreated tested per row (cost 3,635.2), and searchTable likewise (4,268.2), while `%INORDER` fixes only the join order;
  - DW-572 carries an `occurrence=39-3` line;
  - decision #30 names `iris_message_search`, not only `headers`;
  - one constant serves both builders. With the 3-index hint, both plans read `Ens.MessageHeader(H).TimeCreated` with a range condition (cost 22,733 body, 3,798 searchTable), keep header-first and keep the `indexDocId` probe.

  The cost is pinned literals in 2 OS tests and 2 TS checkers. Without OD-1, drop the `BodyStatement` part of Task 5, the OD-1 parts of Tasks 7 and 15, and the body matrix row, and file the residual as a `deferred:` item.
- **OD-2.** Orchestrator decision needed: should `iris_macro_info` with `document` omitted keep returning today's empty result, now that every 400 throws? — recommended: yes, through a handler fallback limited to an empty `docname` and a 400 with no errors, because:
  - the live probe shows that Atelier answers `getmacrodefinition`/`getmacrolocation` with HTTP 400 and no errors exactly when `docname` is `""` (with any document, even a missing one, it answers 200);
  - the tool's `document` description advertises "without it, resolution returns empty";
  - the epic forbids a legitimate empty result becoming an error;
  - changing an advertised output needs an AD-15 decision.

  The alternative is an error naming `document`, plus a description change and a re-pin. Without OD-2, drop Task 3 and its matrix row, and the macro error becomes a CHANGELOG "Changed" line.

**AC interpretations** (apply and report):
- **R1 (DW-572, "measured by EXPLAIN").** The measure is the plan's access path, not its cost. On an untuned table the estimates rise once the plan is window-bounded: item + status goes from 19,075 to 130,109, and body class + status + error-only from 10,497 to 22,732. The unhinted estimate assumes a bitmap selectivity over a history it cannot see. The bounded property is "reads the TimeCreated range, no Status/Source/Target bitmap", which EXPLAIN shows directly.
- **R2 (DW-569, "no current 2xx path changes").** This is proven by the 2xx unit table, by the unchanged 2xx wire rows, and by a diff confined to the non-2xx branch. Two current non-2xx paths become visible:
  - an empty `iris_doc_search` query becomes an error, sanctioned by DW-569;
  - `iris_macro_info` with no document is kept as before (OD-2).
- **R3 (AD-19 error text for logs and diagram).** Both tools declare no PHI input (no `phiInputs`). Their error text keeps the established governed-tool form (`error.message`, as in `message-body.ts:442-458`), which can name configuration identifiers (namespace, item name, type, session IDs) but never body content. Under `block`, an error response also carries `dataPolicy {block,0,0}`.

**Probe evidence** (IRIS 2026.2 build 221U, Atelier v8, localhost:52773, 2026-10-17):
- **DW-569 (read-only curl, HSCUSTOM).**
  - `action/search` with no match answers 200 `result: []`, for every flag combination and with `files=*.zzz`.
  - `query=` (empty or absent) answers 400 with no errors.
  - A bad regex answers 200 with an `#8316` error, so it already throws.
  - `getmacrodefinition`/`getmacrolocation`: with `docname:""`, 400 with no errors (any macro). With any `docname`, existing or not, 200; an unknown macro gives `{definition: []}` and `{document: "", line: ""}`.
- **DW-583 and DW-576 (disposable `EXECMCPTMP397P`, mappings `Ens`/`EnsLib`/`Ens*` → ENSLIB and `HS` → HSLIB, torn down; `Leftovers` `[]`, probe class deleted, `iris_doc_list` `Story397` empty).**
  - **`HS.Message.XMLMessage`.** It is compiled and visible (package destination HSLIB). `%New`, `ContentStream.Write`, `%Save` and `%OpenId` work, and the data lands in the scratch database (`^HS.Message.XMLMessageD`). `ContentStream` is `%Stream.GlobalCharacter` with `IsCharacter()` 1. The class is persistent and not `%JSON.Adaptor`.
  - **Streams.** `%Stream.GlobalBinary.IsCharacter()` is 0.
  - **`Ens.Util.Log`.** `%New` plus `%Save` works, the data is local (`^Ens.Util.LogD` in the scratch database), and `iris_production_logs` on that namespace returned the seeded row.
  - **The `ExecuteMCPv2` package** is mapped to `%ALL` from HSCUSTOM, so the routes and Temp classes resolve in scratch namespaces.
- **DW-572.** EXPLAIN, plan only, in HSCUSTOM (`Ens.MessageHeader` untuned), with literals and with `?`. The `%IGNOREINDEX` hint uses the 3 names in one comma list; repeating the keyword is SQLCODE -1. An unknown index name is ignored silently, which is why `TestHeaderHintIndexesExist` exists.

| Shape (`headers`) | Before | After (3-index hint) |
|---|---|---|
| window only | TimeCreated range, 103.84 | identical, 103.84 |
| item + status | `Status ∩ (Source ∪ Target)` bitmaps, master map read per id, TimeCreated tested per row, 19,075 | TimeCreated range, per-row tests, 130,109 |
| status only | TimeCreated range, 1,037.2 | identical |
| item only | TimeCreated range, 12,742 | identical |
| source only | `Source ∩` a TimeCreated-range bitmap, 22,756 | TimeCreated range |
| body class + status + error-only | `BodyClass ∩ Status` bitmaps, TimeCreated per row, 10,497 | `BodyClass ∩` a TimeCreated-range bitmap, 22,732 |
| session + source + status | `SessionId ∩` a TimeCreated-range bitmap | identical shape, 24,039 |

`%ALLINDEX` was considered and rejected. It also bounds the plan (`(bitmaps) ∩ TimeCreated-range`, 22,781), but it turns today's streamed status-only plan into a full-window intersect-and-sort (90,864). With every bitmap ignored (4 names), a body search would lose the body-class bitmap and read every header in the window.

The plan samples for the meta-row (wording of build 221U):
- **GOOD:** `Read index map Ens.MessageHeader.TimeCreated, looping on TimeCreated (with a range condition) and ID.`
- **BAD:** `((bitmap index Ens.MessageHeader.Status) INTERSECT ((bitmap index Ens.MessageHeader.SourceConfigName) UNION (bitmap index Ens.MessageHeader.TargetConfigName)))`.

**DW-576 design.**
- **Reasons** (fixed, no input, no `;`, which the Mermaid writer would escape):
  - `eventLogText`: "The block data policy withholds Event Log text, which can carry message content."
  - `diagramErrorText`: "The block data policy withholds error text, which can carry message content."
- **Withholding happens in TypeScript.**
  - A newer server must withhold even against older deployed classes (DW-508), so a TypeScript rewrite is needed anyway, and one mechanism is enough.
  - The rewrite matches only the Correlator's own template prefix (`Correlator.cls:197`), never the content.
  - IRIS still computes `dedupOf` and loop merges on the real text. Two sessions that differ only in error text are therefore not marked duplicates: a one-bit signal, recorded as a residual in `tool_support.md`.
  - A non-error warning (unpaired, conflict, generation failure) is untouched.
- **Scope rows.**
  - **`iris_production_logs`:** governed — "Governed under block only: block withholds each entry's Event Log text with a reason. Under redact and allow the text is shown unchanged, because free text cannot be redacted reliably; restrict it with its governance key."
  - **`iris_message_diagram`:** governed — "Governed under block only: block withholds the sanitized ErrorStatus text in error warnings and the diagram with a reason. Under redact and allow it is shown unchanged; restrict it with its governance key."
  - `tool_support.md` adds "(governed under `block` only since 2026-10-17)". Its heading and date stay.

**DW-583 dump rule** (amends the 39.5 dump rules, "exhaustive as of 2026-10-17"). For each property that is dumped:
- a top-level stream property whose stream is a character stream (`IsCharacter()`), when `pMaxChars > 0`, is `{"stream": class, "size": Size, "text": <its first characters within the remaining budget>}`. The budget is `pMaxChars` shared across the dump, read with `ReadStreamText`. A spent budget gives `"text": ""`, and any cut or read failure sets `pComplete = 0`;
- a binary stream, or any stream when `pMaxChars = 0`, is `{"stream", "size"}`;
- a collection of streams stays `{collection, count}`, and nested objects are not walked.

`%ToJSON` escapes CR and C0 characters inside the JSON, so `item.text` holds no raw control character. TypeScript's sanitize-then-cut is unchanged. The shared budget keeps a body with several large streams under the string limit.

**Docs table** (Rule #30; each row states the default state at its point of use):

| # | Surface | Item |
|---|---|---|
| D1 | root `README.md:499` | logs and diagram: their text is withheld under `block`; under `redact` and `allow` they sit outside the policy (both reads, enabled by default) |
| D2 | root `README.md:501`, interop `README.md:237` | "narrow the window: a filter narrows the rows returned, not the window scanned" replaces "or add filters" |
| D3 | root `README.md:742` (one paragraph, start kept) | logs and diagram under `block`; character-stream text under `allow` |
| D4 | root `README.md:764`, interop `README.md:52` | the audit list gains `iris_production_logs` and `iris_message_diagram` (governed under `block`) |
| D5 | interop `README.md:58` | the PHI section sentence, as D1 |
| D6 | interop `README.md:283` | "a character stream shows its text and a binary stream its class and size" |
| D7 | `tool_support.md` | the two scope rows; the :428 and :430 sentences; a Story 39.7 note after the 39.6 note (5 fixes, no tool, key or count change, bootstrap move) |
| D8 | client config ×3 | the `IRIS_DATA_POLICY` row: `block` also withholds Event Log text and diagram error text |
| D9 | `message-body.ts` description | the stream clause as D6; the `maxChars` "serialized whole" wording becomes "a character stream is read only up to the read limit" |
| D10 | `message-search.ts:405-407` description | as D2 |
| D11 | `CHANGELOG.md`, changeset | Task 18 |

**Spine follow-up (lead, Rule 20).** After this story, the AD-26 bullet "In 39.2 the policy governs the resend preview only. `iris_production_logs` and `iris_message_diagram` are residual…" is stale, and AD-15's sanctioned-changes list lacks decisions #30–#32.

**Extend, don't copy (Rule 2).**
- **Extended:**
  - `HeaderStatement` is the sibling of `BodyStatement` and shares `HEADERHINT`;
  - `PropertyDump` reuses `ReadStreamText`;
  - logs and diagram reuse `effectiveDataPolicy`, `DataPolicySummary`, `BLOCK_REASONS` and the `BodyPolicyOutcome` shape;
  - `headerPlanProblems` sits in `header-row-oracle.ts` next to the oracle, while 39.4's `planProblems` stays local and Search-Table specific;
  - the fixture extends `createInteropNamespace`, `putCompileSeed` and `Story391Fixture.Add`;
  - the gate uses `process-gate-helpers.ts`.
- **New, with reasons:**
  - `Story397.Seed`: fixture ν's error header, log rows and stream bodies exist in no earlier seed;
  - `MessageBodyStreamFixture`: no data-free class has top-level character and binary streams.

**Integration (Rules 1/2).**
- **Integration ACs:** AC-10.
- **Consumes:**
  - 39.0's doc-type gate;
  - 39.1's `HeaderWhere`, `COLUMNS` and replays;
  - 39.2's policy plumbing and audit fallback;
  - 39.5's `MessageBody` route, `ReadStreamText` and `bodyReadWire`;
  - 39.6's `process-gate-helpers.ts`, `openAuditedSession`, `header-row-oracle.ts` and the snapshot.
- **Consumed-by:**
  - every tool of the suite (the client);
  - later gates (the `hsLib` option, `headerPlanProblems`);
  - Story 43.1, which keeps the client's non-2xx rule through the SDK v2 migration.

**Ledger inbox (Rule 17):**
- **DW-569:** Tasks 1, 3 and 4, AC-1 and AC-2, and 5 matrix rows.
- **DW-571:** Task 4, AC-3, and the churn row.
- **DW-572:** Tasks 5, 7 and 15, AC-4, and 2 rows.
- **DW-576:** Tasks 2, 9, 10, 12 and 13, AC-5 and AC-6, and 5 rows.
- **DW-583:** Tasks 6, 7 and 17, AC-7, and 4 rows.

**Governing ADs.**
- **AD-1 / AD-11:** one gateway; `IrisApiError` stays the error class.
- **AD-15:** sanctioned changes in the CHANGELOG, pins for everything else, and decision #29's re-pin.
- **AD-20:** the window bounds the scan; `limit` is an output cap.
- **AD-26:** policy semantics, no sniffing, least exposure, and the scope table.
- **AD-19:** audit counts; no PHI in the audit file or on stderr.
- **AD-12:** handlers stay thin; interpretation stays in TypeScript.
- **AD-13:** namespace save and restore are unchanged.
- **AD-14:** bootstrap regeneration.
- **AD-33:** routes are additive. `MessageBody` returns a superset under `all`; `kind` and `hl7` are unchanged.
- **AD-5:** `:check` only.
- **AD-2:** cross-package tests in `iris-mcp-all`.
- **AD-7:** no preset change.
- **AD-29:** changeset only.
- **Conventions:** Live gates, Live testing on a shared instance, Refusals (a per-item outcome inside a successful read), Error text, Logging.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- Every MCP call names `server:"default"` and the namespace `HSCUSTOM` or `EXECMCPTMP397A`.

**Shared surfaces:** these change, and other tests assert on them.
- The `IrisHttpClient` non-2xx contract, which every tool uses.
- `BLOCK_REASONS`.
- The data-policy scope rows and their hard-coded governed list, and the `tool_support.md` table.
- The tools-list snapshot (4 entries) and the README payload rows.
- `BOOTSTRAP_VERSION` and `bootstrap-classes.ts`.
- The `HeaderStatement` and `BodyStatement` texts: the OS statement tests and the 39.3 QA and 39.4 plan checkers.
- The `PropertyDump` signature and output (the 39.5 allow row).
- The `interop-namespace-fixture.ts` exports and `Leftovers`.
- `gateTestFiles` and `GATES`.
- The CHANGELOG's first section, and the doc-claims pins at `story-39-5-doc-claims.test.ts:217` and `story-39-6-doc-claims.test.ts:253`.

Standing criterion: every test added or changed passes on a fresh environment, in either order.
- **Disposable fixtures.**
  - `EXECMCPTMP397A`, with `Story397.*` inside it;
  - `ExecuteMCPv2.Temp.Story391Fixture` in HSCUSTOM;
  - the scratch-script churn documents `ExecuteMCPv2.Temp.Story397Churn*` in HSCUSTOM, deleted at the end;
  - the data-free OS fixture `ExecuteMCPv2.Tests.MessageBodyStreamFixture` (unsaved objects only).
- **Stateful OS test classes** run one class per `iris_execute_tests` call, waiting for completion, comparing `total` with the `Test*` count (Rule #35). Never re-submit on a client timeout; poll `iris_test_status`.
- **The churn script** is written with the Write tool into the scratchpad, never a heredoc (Rule #55), and deleted afterwards.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/http-client.test.ts src/__tests__/data-policy.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev build && pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/intelligence.test.ts` -- expected: pass.
- `(loop)` `ENV pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc-type-description-live-gate.test.ts` -- expected: every test passes, none skipped.
- `(loop)` `pnpm --filter @iris-mcp/interop build && pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/monitor.test.ts src/__tests__/diagram.test.ts src/__tests__/diagram-qa.test.ts src/__tests__/diagram-governance.test.ts src/__tests__/message-body.test.ts src/__tests__/message-search-body.test.ts src/__tests__/logs-diagram-policy.test.ts` -- expected: pass.
- `(loop)` `iris_execute_tests`, one call each, in this order:
  - `ExecuteMCPv2.Tests.MessageSearchTest` (7);
  - `ExecuteMCPv2.Tests.MessageBodyTest` (5);
  - `ExecuteMCPv2.Tests.MessageBodySearchTest` (5);
  - `ExecuteMCPv2.Tests.MessageSearchTableTest` (5).

  Expected: `total` equals the count and there are 0 failures.
- `(loop)` `pnpm gen:bootstrap`, then `git diff --stat packages/shared/src/bootstrap-classes.ts` -- expected: one moved version, idempotent on a second run.
- `(loop)` `pnpm gen:tools-list-snapshot:check` -- expected: OK, exit 0, after the one `--force`.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/data-policy-scope.test.ts src/__tests__/story-39-7-doc-claims.test.ts src/__tests__/story-39-6-doc-claims.test.ts src/__tests__/story-39-5-doc-claims.test.ts src/__tests__/story-39-2-doc-claims.test.ts src/__tests__/tools-list-snapshot.test.ts src/__tests__/gate-helper-copies.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/interop-namespace-fixture.test.ts src/__tests__/bootstrap-version-check.test.ts src/__tests__/process-gate-helpers.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-1-gate-guards.test.ts` -- expected: pass.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-7-burn-down-live-gate.test.ts` -- expected: every test passes, none skipped, nothing left.
- `(once)` Each affected gate armed, one per call: `story-39-1-message-search-live-gate`, `story-39-2-data-policy-live-gate`, `story-39-3-body-search-live-gate`, `story-39-3-qa-live-gate`, `story-39-4-search-table-live-gate`, `story-39-4-qa-live-gate`, `story-39-5-body-reader-live-gate`, `story-39-5-qa-live-gate` and `epic39-capstone-gate` -- expected: pass, with only the `it.runIf(CAPTURE)` rows skipped.
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one command each: `build`, `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/all test`, split into calls that each finish inside the cap as in 39.6 -- expected: green.
- `(once)` DW-571, in this order:
  - `ENV pnpm --filter @iris-mcp/dev test` three times, in the default parallel mode, one call each -- expected: 3 of 3 green;
  - the scratch churn script (Write tool, scratchpad), which runs the dev gate 3 times under churn -- expected: 3 of 3 green;
  - the old row restored as a mutation, up to 5 runs -- expected: at least 1 red.

  Afterwards `iris_doc_list` (HSCUSTOM, `Story397Churn`, generated included) is empty.
- `(once)` `pnpm gen:governance-baseline:check` (expected: exit 0, `1e62c5ad5bf7`/141), `node scripts/check-epics-sync.mjs` (expected: OK), `pnpm gen:skills:check` and `pnpm validate:prompts` (expected: clean, 13), and `pnpm measure:tools-payload` (expected: equal to the README rows) -- one call each.
- `(once)` After every armed run:
  - `leftovers` for `EXECMCPTMP397A` is `[]`;
  - `iris_namespace_list` and `iris_database_list` show no `EXECMCPTMP397A`;
  - `iris_doc_list` (HSCUSTOM, `Story397` and `ExecuteMCPv2.Temp.`, generated included) is empty.

**Planned mutations (Rule 19).** For each one: apply it, observe red, revert, rebuild or reload whatever it touched, and confirm that `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> -> <test that went red>`.
- AC-1: restore `isEmptyResult400` → the `http-client.test.ts` 400 row and the 39.7 gate's CLS/`cls` wire row.
- AC-2: throw on a 2xx with empty errors → the 2xx table row. Remove the OD-2 fallback → the gate's macro row.
- AC-3: restore the count comparison → red under churn (the run record).
- AC-4: drop `HEADERHINT` from `HeaderStatement` (reload and redeploy) → `TestHeaderStatementText` and the gate's plan row (record the path: SDK `Client` → built interop → route → `INFORMATION_SCHEMA.STATEMENTS`).
- AC-5: skip the block rewrite in `monitor.ts` → the gate's logs block row (on the wire). Add `dataPolicy` under redact → the AD-15 unit pin.
- AC-6: remove `dataPolicy` from `diagram.ts` → `data-policy-scope.test.ts`.
- AC-7: `JsonText` calls `PropertyDump(pObj)` without the cap → the gate's H1 allow row and `TestPropertyDumpStreams`.
- AC-8: drop "enabled by default" from D1 → `story-39-7-doc-claims`.

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
