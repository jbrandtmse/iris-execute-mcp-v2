---
title: 'Story 39.3: Message Body Content Search'
type: 'feature'
created: '2026-10-16'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/.claude/rules/iris-objectscript-basics.md'
  - '{project-root}/.claude/rules/object-script-testing.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred: []
---

<intent-contract>

## Intent

**Problem:** An engineer cannot find Interoperability messages by what their bodies hold (G33). The `body` action of `iris_message_search` was declared in Story 39.1 and still answers `NOT_IMPLEMENTED`, and the competitor's body search pastes caller input into generated code.

**Approach:**
- Implement the `body` action (key `iris_message_search:body`). It takes a required `bodyClass`, a structured `filters` list of `{property, op, value}` and the 39.1 scope filters, and returns the same paged header rows as `headers`, never body values.
- The IRIS handler that builds the statement validates everything: each property resolves through the class dictionary to its `SqlFieldName` and is written as a delimited identifier, each operator maps from a closed enum to a fixed SQL fragment, and every value is a bound parameter.
- The action is the first consumer of the 39.2 policy plumbing: `dataPolicy: {actions:["body"], phiInputs:["filters"]}`. Under `block` it is refused with `DATA_POLICY_BLOCKED` before any IRIS call. Under `redact` and `allow` it runs.
- Prove it with an injection fuzz that drives the REST route directly, in the default suite, against independent oracles, and with a hand-written JOIN oracle over synthetic fixtures.

## Boundaries & Constraints

**Always:**
- **No caller text in SQL text (AD-26).**
  - The statement holds only fixed text, the dictionary's table and column names (each delimited), and `?` markers.
  - A property is emitted as its compiled `SqlFieldName`, never as the caller's text. An operator is emitted as its fragment from one closed map, never as the caller's text.
  - Every value and the page size are bound. The body table name comes from the class dictionary.
  - TypeScript validation is advisory only. Every rule below is enforced IRIS-side, and the fuzz proves it over the route.
- **The input.**
  - `bodyClass` is required. It is the exact name of a compiled persistent class with an SQL table in the target namespace. Only headers whose `MessageBodyClassName` is that class match, so subclass bodies are not included.
  - `filters` is required: 1 to 10 objects, combined with AND. Each object holds only `property`, `op` and `value`.
  - `property` is the exact (case-sensitive) name of one property of `bodyClass`, matching `^[A-Za-z][A-Za-z0-9]{0,127}$` (`$Match` on the IRIS side). It must be searchable under the property-kind table (Design Notes).
  - `bodyClass` matches `^%?[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$` and is at most 220 characters before the dictionary is consulted.
  - `op` is one of `eq`, `ne`, `lt`, `le`, `gt`, `ge`, `contains`, `startsWith`, `isNull` or `notNull` (Design Notes table).
  - `value` is required for every op except `isNull` and `notNull`, where it must be absent or null. A value is a string of 1 to 1024 characters, a number or a boolean.
  - The 39.1 scope filters apply unchanged: the window (`from` required, `to` default now, 0–7 days), `item`, `source`, `target`, `status`, `sessionId`, `errorOnly`, `limit`, the cursor and `namespace`.
  - `filters` on the `headers` action is refused, on both sides, rather than silently ignored.
- **Validation order (AD-13).** Every shape rule runs before the namespace switch, and its text names the parameter (for example `filters[2].op`), never the value. After the switch, these run in order:
  1. the 39.1 `interopEnabled:false` check, which makes the namespace not applicable;
  2. the body table;
  3. the dictionary resolution of each filter.
- **Scope (AD-20, Rule #38).** The window bounds the work. The join is header-first: the header window and filters drive the scan, and each body row is read by its ID. `limit` caps the output only.
- **Results (AD-26).** Rows are exactly 39.1's header rows, selected from the header table only. Paging uses the same `(TimeCreated, ID)` keyset and cursor.
  - A body-action success (rows or `notApplicable`) also carries `dataPolicy: {policy, redacted: 0, blocked: 0}`.
  - No response, content line, error text or log line echoes a filter value or body content.
- **The policy (AD-26, AD-9, AD-3).** The handler reads `effectiveDataPolicy(ctx.config)` per call, so the policy follows the call's profile. Under `block`, the action returns `refusalResult(DATA_POLICY_BLOCKED, <fixed text>, {action:"body", policy:"block"})`. That happens after the `from`/`to` parse and before every other body check and any HTTP call. `headers` is not under the policy.
- **Audit (AD-19).** `filters` is declared in `phiInputs`, so under `IRIS_AUDIT_LOG_PARAMS` its whole value is logged as `"[REDACTED]"` under `redact`, under `block` and for an unresolved profile. A body call's entry carries `dataPolicy`, and a refusal audits as `outcome:"error"`.
- **IRIS side (AD-11, AD-12, AD-13, AD-14).** One envelope and `SanitizeError`, as today.
  - A prepare failure passes the sanitized status, which can hold only dictionary names and `?`.
  - A runtime SQL error of the body statement gives the fixed text `The body search failed with SQLCODE <n>.`
  - `HeaderWhere` gains an optional alias. With none, it emits exactly today's text.
  - `MessageSearch.cls` is bootstrapped, so `pnpm gen:bootstrap` runs and `BOOTSTRAP_VERSION` moves `d440a659ba1e` → new. The roster stays 31.
- **Back-compat (AD-15, AD-33).** A `headers` request answers byte for byte as before, pinned by a capture taken on `d440a659ba1e`. `resendFiltered` is untouched (the 39.1 replay stays green). `searchTable` still answers `NOT_IMPLEMENTED`, now with `availableActions: ["headers","body"]`.
- **Live fixtures.** Fixtures are synthetic.
  - Every body value that must never appear in a result contains `SYNTHPHI393`. Times fall on 2001-02-03 UTC.
  - They live only in the disposable mapping-only namespaces `EXECMCPTMP393A`, `EXECMCPTMP393B` and `EXECMCPTMP393C` (the gate) and `EXECMCPTMP393P` (the Task 0 probes). They use the `Story393.*` classes compiled inside them and the HSCUSTOM fixture class `ExecuteMCPv2.Temp.Story391Fixture`.
  - All of them are removed, with nothing-left assertions. Every IRIS MCP call names `server:"default"`.

**Never:**
- Never accept raw `WHERE` text, a SQL field name in place of a property name, a dotted or serial sub-property path, or an operator outside the enum.
- Never interpolate a value, and never emit caller text as an identifier.
- Never return a body value, a `bodyText`, or an `ErrorStatus` or `Description` column.
- No new tool, action, governance key, preset row, `TOOL_PAIRS` entry or prompt, so no tool count moves. Annotations and `mutates` are unchanged.
- No change to `resendFiltered`, the preview, `iris_production_messages` or `searchTable` beyond its `availableActions`.
- Never call `%Library.EnsembleMgr.EnableNamespace`. Never start a production. Never read HSCUSTOM's or another project's messages.
- Never run the bare governance-baseline generator, and never hand-edit `bootstrap-classes.ts`.
- No document claims regulatory compliance.

## I/O & Edge-Case Matrix

**Fixture σ** (namespace A = `EXECMCPTMP393A`) is seeded by `Story393.Seed` (Design Notes): six `Story393.Body` bodies, one `Story393.Other` and one HL7 message. It has twelve headers, all Request and status Completed unless noted.

| Header | Body class / ID | `TimeCreated` (2001-02-03 UTC) | Note |
| --- | --- | --- | --- |
| 1–2 | `Story393.Body` 1, 2 | 08:00:00, 08:00:01 | |
| 3 | `Story393.Body` 3 | 08:00:02 | status Error, `IsError` 1, target `Story393.Other` |
| 4, 5 | `Story393.Body` 4, 5 | 08:00:03 (both) | a tie broken by ID |
| 6 | `Story393.Body` 6 | 08:00:05 | |
| 7 | `Story393.Other` 1 | 08:00:06 | body ID collides with body 1 |
| 8 | `Story393.Body` 999 | 08:00:07 | dangling |
| 9 | `""` / `1` | 08:00:08 | literal body |
| 10 | `Story393.Body` 1 | 08:00:09 | Response, `CorrespondingMessageId` 1 |
| 11 | `EnsLib.HL7.Message` | 08:00:10 | ADT, PID-3 `SYNTHPHI393-MRN` |
| 12 | `Story393.Body` 6 | 2001-02-04 09:00:00 | outside the window |

The window **W** is `from:"2001-02-03T07:00:00Z"`, `to:"2001-02-03T09:00:00Z"`.

Namespace B (`EXECMCPTMP393B`) compiles a different `Story393.Body`: `Renamed` has `SqlFieldName` `RenamedB`, and it has `OnlyInB` and no `OnlyInA`. B has two bodies and headers 1–2. Namespace C (`EXECMCPTMP393C`) has no mappings.

**The oracle** (Rule #36) is a hand-written `SELECT h.ID FROM Ens.MessageHeader h JOIN <body table> b ON b.%ID = h.MessageBodyId WHERE h.MessageBodyClassName = '<class>' AND <window> AND <the predicate, written by hand with literals> ORDER BY h.TimeCreated, h.ID`. It is run through `atelierQuery` in the same namespace.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Each op, each kind | A, W, one filter per row: `eq`/`startsWith` `Code` `k1` forms; `contains` `Code` `ALPHA`; `eq` `Exact`; `lt`/`le`/`gt`/`ge` `Amount` 10; `ne` `Code` `K2`; `isNull` `Code`; `notNull` `Note`; `eq` `Flag` true; `eq` `Ref` 1; `eq` `Renamed` `R-one`; `eq` `Group` `g1`; `contains` `Computed` `C-K2` | Each result (ids, order, every field) equals its oracle. Distinguishing facts: `eq`/`startsWith` on `Code` ignore case (bodies 1 and 2, so headers 1, 2 and 10); `contains` respects case (header 2 only); `ne` never matches header 5 (NULL `Code`); header 7, 8, 9 and 12 never appear | none |
| HL7 body | A, `bodyClass:"EnsLib.HL7.Message"`, `RawContent contains "SYNTHPHI393-MRN"` | Header 11 only, equal to the oracle | none |
| Combined | A, two body filters plus `target:"Story393.Other"`, `errorOnly:true` | Header 3 only, equal to the oracle | none |
| ID collision | A, `Story393.Other` `Code eq "K1-alpha"`; then `Story393.Body` `Code eq "K1-alpha"` | Header 7 only; then never header 7 | none |
| Paging | A, `limit:2` over the 5+ matches of `Amount ge -5` | Pages joined equal the oracle, with no gap or duplicate; the 4/5 tie is broken by ID; only pages with `hasMore` carry `nextCursor` | none |
| Header rows only | every success above, through the tool and over the route | Raw response text holds no `SYNTHPHI393` (the oracle shows the matched bodies hold it: positive control) | none |
| Refused property | A: `code`, `RenamedField`, `Secret`, `Shown`, `Scratch`, `Tags`, `Props`, `Addr`, `OnlyInB`, `NoSuch`; `Note` with `contains` | Envelope error naming `filters[0].property` (or `filters[0].op` for the stream), never the value; nothing read | refusal |
| Refused class | A: `Story393.NoSuch`, `story393.body`, `Story393.Addr` (serial), `%Stream.GlobalCharacter` | Error naming `bodyClass` | refusal |
| Refused shape | route, namespace `EXECMCPTMP393Z` (missing); every hostile string carries `SYNTHPHI393`: no `bodyClass`; a `bodyClass` with `'`; no `filters`; `filters` `[]`, 11 items, a string, `[5]`; an extra key; `property` missing, `5`, `Co de`, `a"b`, 129 chars; `op` missing, `EQ`, `like`, `=`; `eq` with no value; `isNull` with a value; value `""`, 1025 chars, `{}`, `[]`; `filters` on `headers` | Error naming the parameter path, never the value. No `SwitchNamespace` error, so validation came first | refusal |
| Injection fuzz | route, A: seeded corpus over the property, op and value slots (Design Notes) | 0 violations: `^Story393Side` stays undefined (the positive control first shows the probe can vary), every value-slot result equals the TS oracle, every refusal is expected and names its parameter, and no response holds `SYNTHPHI393` | none |
| Second namespace (Rule #34) | the same requests against A and B: `OnlyInA`, `OnlyInB`, `Renamed eq "R-one"` | Each namespace equals its own oracle and they differ: `OnlyInA` refused in B, `OnlyInB` in A | refusal / none |
| Not configured (Rule #41) | C | `notApplicable:true`, `rows:[]`, `hasMore:false`, with `dataPolicy` | none |
| Unknown namespace | `EXECMCPTMP393Z`, valid shape, under `redact` | `isError`, with the sanitized `SwitchNamespace` text | error |
| `block` | `IRIS_DATA_POLICY=block`; and `IRIS_PROFILES={"tight":{"dataPolicy":"block"}}` with `callOn("tight")` | `{code:"DATA_POLICY_BLOCKED", action:"body", policy:"block"}` with no IRIS call: the same call aimed at `EXECMCPTMP393Z` is refused, not a namespace error. `headers` still runs. The `default` profile of the `tight` session still runs `body` | refusal |
| `redact` / `allow` | default; `IRIS_DATA_POLICY=allow` | The same rows; `dataPolicy` is `{policy:"redact"|"allow", redacted:0, blocked:0}`; one trailing content line names the policy | none |
| Audit (AD-19) | `IRIS_AUDIT_LOG`, `IRIS_AUDIT_LOG_PARAMS=true`, `LOG_LEVEL=DEBUG`; body calls under redact, block and allow, plus a Zod-invalid call whose `op` holds `SYNTHPHI393` | redact: `{action:"body", outcome:"ok", dataPolicy:{policy:"redact",redacted:0,blocked:0}}`, `params.filters` `"[REDACTED]"`. block: `outcome:"error"`, `dataPolicy` policy `block`, `params.filters` redacted. allow: the filters logged (positive control). Under redact and block, neither the file nor stderr nor any response holds `SYNTHPHI393` | none |
| `headers` back-compat (AD-33) | the capture list (Design Notes), direct REST against A and C | Each raw text equals its capture from `d440a659ba1e` | none |
| `searchTable` | valid window | `NOT_IMPLEMENTED`, `availableActions:["headers","body"]`, no IRIS call | refusal |

</intent-contract>

## Code Map

**IRIS side**
- `src/ExecuteMCPv2/REST/MessageSearch.cls` (bootstrapped):
  - `COLUMNS` (:30). Derive the `h.`-qualified select list from it; never add a second hand-written list.
  - `HeaderWhere` (:44-103): it emits bare column names. The body join needs them qualified, because `Ens.VDoc.Interface.TimeCreated` (`irislib/Ens/VDoc/Interface.cls:39`) and similar make bare names ambiguous.
  - `TypeLabel` (:106), `BodyKind` (:119) and `Hl7Text` (:143) are untouched.
  - `HeaderRow(pRS)` (:172-193) reads columns by name, so a select of `h.ID, …` still yields `ID`.
  - `ReadString` (:198) and `ReadInteger` (:213): reuse them.
  - `MessageSearch()` (:246-429):
    - the action check is at :259-265 (its text becomes `must be one of: headers, body`);
    - the reads are at :267-292;
    - `HeaderWhere` is called at :347-358, and the switch is at :360-363;
    - the `interopEnabled:false` branch is at :371-376;
    - the statement (`TOP ?`, keyset, `ORDER BY TimeCreated, ID`) is at :378-402;
    - the rows are at :404-415, and the single render at :417-428.
- `src/ExecuteMCPv2/Utils.cls`: `SwitchNamespace` (:50), `SanitizeError` (:124), `ReadRequestBody` (:1124).
- `src/ExecuteMCPv2/Tests/MessageSearchTest.cls` (5 methods, 288 lines): :215-217 sends `action:"body"` expecting an `action` refusal; change it to `searchTable`. Its HTTP helpers are `PostSearch`/`ValidBody`/`AssertRefused` (:150-200).
- Dictionary (`irislib/%Dictionary/`):
  - `CompiledClass.cls`: `ClassType` :30, `SqlSchemaName` :261, `SqlTableName` :264.
  - `CompiledProperty.cls`: `Calculated` :18, `Collection` :27, `MultiDimensional` :84, `Relationship` :111, `RuntimeType` :117, `SqlComputed` :135, `SqlFieldName` :141, `Transient` :153, `Type` :156. IDs are `Class||Property`; compare `.Name` exactly after opening.
- Real-class evidence for the data-free OS tests:
  - `irislib/EnsLib/HL7/Message.cls`: `RawContent` is SqlComputed, Transient, MAXLEN 10000 (:90); `Separators`, `FS`… are Transient or Calculated without SqlComputed, so they are not projected (:40-58).
  - `irislib/Ens/VDoc/Interface.cls:52`: `UserValues` is an array.
  - `irislib/Ens/StreamContainer.cls`: `Stream` is Calculated and Transient (:19); `StreamGC` is a stream (:27).
  - `irislib/Ens/StringRequest.cls`: `StringValue`.
  - `irislib/Ens/Rule/Rule.cls:18`: `RuleSet`, a parent relationship.
- `irislib/Ens/MessageHeaderBase.cls`: `MessageBodyClassName` is `%String(MAXLEN=220)` with the default collation (:67); `MessageBodyId` is `%String(COLLATION="EXACT")` (:70).
- `scripts/gen-bootstrap.mjs:35` (MessageSearch entry; the roster is unchanged) and `packages/shared/src/bootstrap-classes.ts:25` (`d440a659ba1e`).

**TypeScript**
- `packages/iris-interop-mcp/src/tools/message-search.ts`:
  - `AVAILABLE_ACTIONS` :32 and `SearchResult` :52-60;
  - the description :270-294 and the schema :295-332 (`bodyClass` max 220 :312);
  - `mutates` :342-346, unchanged;
  - the handler :347-488. Its `NOT_IMPLEMENTED` branch is at :392-399, the wire body at :411-424, the `structured`/`notApplicable` outputs (`action:"headers"` hard-coded) at :433-473, and the `IrisApiError` text at :474-487. `toStructured` is at :251.
- `packages/shared/src/server-base.ts`:
  - the Zod failure path (:1339-1360) returns and `logger.warn`s the issue messages, so a message that echoed an input would leak. The audit row pins that none does.
  - `redactPhiInputs` (:1732-1745) is not action-gated. `deriveAuditDataPolicy` (:1755-1775) is gated by `dataPolicy.actions`.
- `packages/shared/src/governance.ts:854-889` `assertDataPolicyDeclarations`: `actions` must be enum values, and `phiInputs` must be top-level schema keys.
- `packages/shared/src/refusals.ts` (`NOT_IMPLEMENTED` :29, `DATA_POLICY_BLOCKED` :31, `refusalResult`), `packages/shared/src/data-policy.ts` (`effectiveDataPolicy` :161, `DataPolicySummary` :187), `packages/shared/src/tool-types.ts:164` (`dataPolicy`). The precedent consumer is `message-resend.ts` (the preview branch).
- `packages/shared/src/__tests__/lines.test.ts:433-441`: a private `mulberry32`. Promote it to `packages/shared/src/__tests__/test-helpers.ts`.
- Tests that pin the old `body` behavior (shared surfaces):
  - `packages/iris-interop-mcp/src/__tests__/message-search.test.ts:486-494`;
  - `message-search-governance.test.ts:105-126` and :133-160;
  - `packages/iris-mcp-all/src/__tests__/story-39-1-message-search-live-gate.test.ts:620`, :692-699, :738-749 and :1016-1045;
  - `MessageSearchTest.cls:216`.
- `packages/iris-mcp-all/src/__tests__/data-policy-scope.ts:72-77` (the `iris_message_search` residual row) and `data-policy-scope.test.ts:83` (the exact governed list).

**Live harness** (`packages/iris-mcp-all/src/__tests__/`)
- `interop-namespace-fixture.ts`: `FIXTURE_CLASS_SOURCE` (:57-334; `Add` :67-85 and `SaveHl7` :232-239 are reused by `Story393.Seed`). Also `createInteropNamespace` :401, `removeInteropNamespace` :442, `leftovers` :582 and `assertFixtureName` :366, and the `STORY392_*` source-constant precedent (:546-571).
- `process-gate-helpers.ts`:
  - `openWireSession` :237 (`onStderr`, `callOn`);
  - `atelierQuery(target, query)` :334, which takes a literal query only, so the oracle writes literals;
  - `executeMcpPost` :360, `docFixtures(session, namespace)` :389;
  - `shippedBootstrapVersion` :434 and `assertDeployedBootstrapVersion` :455.
- Precedents:
  - the 39.1 gate: `beforeAll` :181-229, `afterAll` :231-259 (each step guarded), the capture and replay :262-313, `ROUTE_CASES` :600-660;
  - the 39.2 gate: `interopSession` :118-126, and the audit/stderr row :568-604;
  - `story-39-1-gate-guards.test.ts` (`GATE` :26, `DRIVEN_PACKAGES` :27, describes :91, :109);
  - the 36.4 fuzz style: `packages/iris-dev-mcp/src/__tests__/global-injection-epic-gate.test.ts:1-60`, with write-shaped payloads, a side-effect oracle and independent oracles.
- `packages/iris-mcp-all/scripts/prepublish-gate.mjs:139-152` holds the 39.x `gateTestFiles` entries.

**Docs**
- Root `README.md`:
  - :17 (the interop summary);
  - :485 (`NOT_IMPLEMENTED` row: "today: … `body` and `searchTable`");
  - :486 (the `DATA_POLICY_BLOCKED` row: keep the phrase "Returned from Story 39.3 on", pinned by `story-39-2-doc-claims.test.ts:150`, and replace "no tool returns it yet");
  - :545 (the governance-defaults row; keep the substrings that `story-39-1-doc-claims.test.ts:137-144` pins);
  - :696 (`Last re-measured at Story 39.x`);
  - :720 (the "What it governs today" paragraph; keep `no tool returns HL7 body text yet`, pinned by `story-39-2-doc-claims.test.ts:178`).
- `packages/iris-interop-mcp/README.md`: :160 (table row) and :199-221 (the subsection; keep the `> **Governance default:**` sentence and `at most **7 days**` that `story-39-1-doc-claims.test.ts:162-166` pins).
- `tool_support.md`: :202 (add a Story 39.3 note after it), :406 (the scope row) and :418 (the last sentence).
- `CHANGELOG.md`: the top section is Story 39.2. The new section must not contain the `` `full` N/N/N/N/N `` pattern.
- `.changeset/`.

## Tasks & Acceptance

**Execution** (in dependency order):

*Task 0: probes, the fixture extension and the capture, before any edit to `MessageSearch.cls`.*
1. **Probes (Rule #16).** Use `EXECMCPTMP393P`, built and removed with the 39.1 Step L lifecycle (`createInteropNamespace`/`removeInteropNamespace`), with the `Story393.*` sources compiled inside it. Record each result under Verification, with the IRIS version.
   - (a) The `%Dictionary.CompiledProperty` flags and `SqlFieldName` of every `Story393.Body` property, and `ClassType`/`SqlSchemaName`/`SqlTableName` of `Story393.Body`, `Story393.Addr`, `Story393.Other`, `%Stream.GlobalCharacter` and `EnsLib.HL7.Message`. Also what `%OpenId` does with a case variant of a class or property name, and that `Ens.Rule.Rule||RuleSet` is compiled in HSCUSTOM. If it is not, record another compiled one/parent relationship for the OS test.
   - (b) `INFORMATION_SCHEMA.COLUMNS` for the `Story393.Body` table agrees with the property-kind table.
   - (c) `Property Group As %String;` compiles with `SqlFieldName` `Group`; `"Group" = ?` prepares and bare `Group = ?` does not. **If it does not compile**, drop `Group` from the fixture, record why, and pin delimited emission only by `TestBodyFilterWhereSystemClasses`.
   - (d) The statement shape of Design Notes prepares and runs with `tArgs...` and returns the expected rows. `iris_sql_analyze` `explain` (namespace P, literals) shows `Ens.MessageHeader` read first with the body read by ID. **If `%INORDER` does not prepare**, use `%FIRSTTABLE h`, and record which.
   - (e) Bound-value semantics on a default-collation `%String` and an `EXACT` one, for `=`, `[` and `%STARTSWITH`. A stream column with `[ ?` fails with SQLCODE -313, while `IS NULL` works. `<> ?` never matches NULL.
   - (f) `SELECT Story393.Side_Bump() AS n` through Atelier `action/query` increments `^Story393Side`.
   - (g) The deployed `BOOTSTRAP_VERSION` is `d440a659ba1e`.
2. `packages/iris-mcp-all/src/__tests__/interop-namespace-fixture.ts`: extend it; do not copy.
   - Add the source constants `STORY393_ADDR_SOURCE`, `STORY393_OTHER_SOURCE`, `STORY393_BODY_A_SOURCE`, `STORY393_BODY_B_SOURCE`, `STORY393_SIDE_SOURCE` and `STORY393_SEED_SOURCE` (Design Notes), and `STORY393_EXACT_VALUES`.
   - Add `seedBodySearch(dev, name, set: "a" | "b")`. It puts and compiles the set's classes in `name` through `docFixtures(dev, name)`, in the order Addr, Other, Body, Side, Seed (B: Body, Seed). It calls `Story393.Seed.Seed(set, <exact values JSON>)` and checks the returned ID map. `FIXTURE_CLASS_SOURCE` is unchanged.
   - Add `sideCount(dev, name)` and `resetSide(dev, name)` (`Story393.Side.Count`/`Reset`).
3. `packages/iris-mcp-all/src/__tests__/story-39-3-body-search-live-gate.test.ts` (new): the capture row `it.runIf(process.env.STORY_39_3_CAPTURE === "1")`.
   - It writes `fixtures/story-39-3-search-baseline.json`: `{capturedWithBootstrapVersion, irisVersion, capturedAt, command, cases:[{name, body, status, text}]}`, for the capture list (Design Notes) against A and C.
   - Every other `describe` is `skipIf(CAPTURE)`. Run it on the pre-change classes and dists (Verification Step C).

*Task 1: IRIS side.*

4. `src/ExecuteMCPv2/REST/MessageSearch.cls`:
   - `HeaderWhere(pFilters, Output pWhere, Output pParams, pAlias As %String = "")`: with an alias, every column is written `<alias>.<column>`. With none, the text is byte-identical to today's.
   - `BodyOpSql(pOp) As %String`: the closed map of the operator table, and `""` for anything else.
   - `BodyFilterShape(pFilters) As %Status`: every shape rule of the Boundaries, run before the switch. Texts name `filters` or `filters[i].<key>`.
   - `BodyTable(pClassName, Output pTable) As %Status`: the body-class rule of Design Notes. `pTable` is `"<SqlSchemaName>"."<SqlTableName>"`.
   - `BodyFilterWhere(pClassName, pFilters, pAlias, Output pWhere, Output pParams) As %Status`: the property-kind table. It emits `<alias>."<SqlFieldName>" <fragment>`, with values only in `pParams`. A boolean is bound as 1 or 0.
   - `MessageSearch()`:
     - `action` is `headers` | `body`. A `filters` key on `headers` is refused.
     - For `body`, read `bodyClass` (required, a dotted class-name shape, at most 220) and `BodyFilterShape` before the switch.
     - After the switch and the interop check, call `BodyTable`, then `HeaderWhere(…, "h")` with `bodyClass` set to the class, then `BodyFilterWhere(…, "b")`.
     - Run the Design Notes statement and fill rows through `HeaderRow`. Its runtime-error text is the fixed one.
     - The result is `{action:"body", interopEnabled, rows, hasMore, limit, from, to}`. The `headers` path is unchanged.
5. `src/ExecuteMCPv2/Tests/MessageBodySearchTest.cls` (new; data-free; at most 500 lines; not in the manifest). It has five methods:
   - `TestHeaderWhereAlias`: the aliased text, and the unaliased text equal to the 39.1 text.
   - `TestBodyOpSqlClosedMap`: every op maps to its fragment; `EQ`, `like`, `=`, `""` and a hostile string map to `""`.
   - `TestBodyFilterShapeRefusals`: each shape row of the matrix. The text names the path and never the hostile value.
   - `TestBodyFilterWhereSystemClasses`, in HSCUSTOM, dictionary only:
     - `Ens.StringRequest` `StringValue` `eq` gives `b."StringValue" = ?`, with a hostile value only in `pParams`;
     - `EnsLib.HL7.Message` `RawContent` `contains` gives `[ ?`;
     - `Ens.StreamContainer` `StreamGC` `isNull` is accepted and `eq` refused, and `Stream` is refused;
     - `EnsLib.HL7.Message` `UserValues` and `Separators`, the Task 0 (a) relationship, and a case-variant name are all refused.
   - `TestBodyTableSystemClasses`: `EnsLib.HL7.Message` gives `"EnsLib_HL7"."Message"` (as probed); `Ens.StringRequest` is accepted; `%Stream.GlobalCharacter`, `No.Such.Story393Class` and a case variant are refused naming `bodyClass`.
6. `MessageSearchTest.cls:216`: `body` → `searchTable` (still 5 methods).
7. Run `pnpm gen:bootstrap`. Record `BOOTSTRAP_VERSION` `d440a659ba1e` → new; the roster stays 31 (Rule #24).

*Task 2: TypeScript.*

8. `packages/shared/src/__tests__/test-helpers.ts`: export `mulberry32(seed)`. `lines.test.ts` uses it, and its private copy is removed.
9. `packages/iris-interop-mcp/src/tools/message-search.ts`:
   - Export `BODY_FILTER_OPS`. `AVAILABLE_ACTIONS` becomes `["headers","body"]`.
   - Add `filters` to the schema: an array of 1–10 non-strict objects `{property: string 1–128 matching ^[A-Za-z][A-Za-z0-9]*$, op: enum, value?: string 1–1024 | number | boolean}`. Update the `action` and `bodyClass` descriptions. If a Zod issue message for any `filters` node would echo the input (the audit row's hostile `op` shows it), give that node a fixed message.
   - Add `dataPolicy: {actions: ["body"], phiInputs: ["filters"]}`.
   - The handler, in order:
     1. the `from`/`to` parse;
     2. `searchTable` → `NOT_IMPLEMENTED`;
     3. `headers` with `filters` → `'filters' applies only to the body action.`;
     4. `body` under `block` → `DATA_POLICY_BLOCKED` (`The block data policy withholds message body data, and a body search reveals what bodies hold, so the body action is refused. Use the headers action, or ask the operator for a looser IRIS_DATA_POLICY for this profile.`);
     5. `bodyClass`/`filters` required for `body`;
     6. the cursor;
     7. the wire body: the `headers` fields plus `bodyClass` and `filters`, sent as given.
   - The body output is `{action:"body", rows, hasMore, limit, …window, nextCursor?, dataPolicy}` (`notApplicable` likewise), plus one trailing content line, `Data policy <policy>: header rows only; the body action returns no body content.` No line names a filter value. The `headers` output is byte-identical.
   - The description gives what, when and returns: the filter grammar, the op table with its case semantics, the stream and collection rules, the policy behavior and refusal code, and the default state (read, enabled by default). It still covers the window, the output cap and `searchTable` `NOT_IMPLEMENTED`, and names no REST path.
10. Tests:
    - `packages/iris-interop-mcp/src/__tests__/message-search-body.test.ts` (new, mocked HTTP; every fake reply has the live route's shape, Rule #54). It covers:
      - the wire body;
      - the required, `headers`+`filters` and per-op Zod rows;
      - `block` making no HTTP call, including under a per-profile `ctx.config`;
      - `dataPolicy` under redact and allow, `notApplicable`, the cursor and `IrisApiError`;
      - no filter value in `content` or in an error, for a hostile value;
      - `searchTable`'s new `availableActions`.
    - Update `message-search.test.ts:486` (`searchTable` only). In `message-search-governance.test.ts`, the denial row uses `searchTable`, and the audit rows add a real-handler body call under `redact` (staged envelope) asserting `params.filters:"[REDACTED]"` and `dataPolicy`.

*Task 3: the gate, scope, docs and counts.*

11. Finish `story-39-3-body-search-live-gate.test.ts`, on the 39.1 shape:
    - **`beforeAll`:**
      1. it fails on a stale shared, dev, admin or interop dist, or an unreachable IRIS, when armed;
      2. `assertDeployedBootstrapVersion`;
      3. it puts the fixture class, removes A/B/C by name and asserts nothing is left;
      4. it creates A and B (interop) and C (plain), runs `seedBodySearch` for A (`a`) and B (`b`), and runs a positive leftovers control.
    - **`afterAll`:** each step in its own guard. It removes A/B/C, runs the leftovers check, removes the fixture class and the temp files, and checks that `iris_doc_list` (HSCUSTOM, generated included) shows no `Story391Fixture` or `Story393` document.
    - **Rows:**
      - every matrix row, through the BUILT interop server (sessions: default, `allow`, `block`, `tight` profile, and audit with `onStderr`);
      - the route rows through `executeMcpPost`;
      - the oracle rows through `atelierQuery`;
      - the fuzz;
      - the replay against the capture, asserting `capturedWithBootstrapVersion === "d440a659ba1e"` and `!== shippedBootstrapVersion()`.
    - Add it to `scripts/prepublish-gate.mjs` `gateTestFiles`, with a comment.
12. Shared-surface updates:
    - `story-39-1-message-search-live-gate.test.ts`: :620 and :692-749 use `searchTable` (with `availableActions:["headers","body"]`), and :1016-1045 checks `body` as `error` with a validation refusal.
    - `story-39-1-gate-guards.test.ts`: it iterates over both gates (39.1 and 39.3), with the 39.3 driven packages.
13. `data-policy-scope.ts`: `iris_message_search` becomes `governed`, `governedActions:["body"]`. Its reason: "The body action is under the policy: refused under block; under redact and allow it returns header rows only. The headers action is not: for a header with no body class the body ID is the literal body value, so restrict iris_message_search:headers with its governance key. searchTable arrives in Story 39.4." In `data-policy-scope.test.ts:83`, the governed list adds `["iris_message_search",["body"]]`. In `tool_support.md` (:406, :418), make the same change.
14. Docs (Rules #30 and #43, minimal; 39.6 enriches):
    - every Code Map doc line, each stating the body action's default state (read, enabled by default; refused under `block`);
    - a `tool_support.md` Story 39.3 note (no count, key or default moves; the `BOOTSTRAP_VERSION` from → to);
    - `CHANGELOG.md`, top section `## [Pre-release — 2026-10-16] — Story 39.3: Message body content search`. Added: the action, `DATA_POLICY_BLOCKED`'s first use. Changed: the route's action text, and `filters` refused on `headers`, `searchTable`'s `availableActions`, and the bootstrap move. Then Tests;
    - `.changeset/story-39-3-message-body-content-search.md` (`@iris-mcp/interop` minor, `@iris-mcp/shared` minor);
    - after rebuilding, the README payload rows equal `pnpm measure:tools-payload`, and :696 reads `Story 39.3`.
15. `packages/iris-mcp-all/src/__tests__/story-39-3-doc-claims.test.ts` (new) pins:
    - the CHANGELOG section, by title, with its two version literals;
    - the changeset bump map (`skipIf` absent);
    - the README `DATA_POLICY_BLOCKED` and governance rows naming the body action and its default state;
    - the interop subsection's body text and policy line;
    - the `tool_support.md` note and scope row;
    - that no new document text claims compliance (reuse the 39.2 `CLAIMS` patterns by import, or move them into a shared test module).

**Acceptance Criteria:**
- **AC-1 (39.3.1; AD-26, AD-12, AD-13).**
  - Given a body search with any filter, when IRIS builds the statement, then the statement holds only fixed text, delimited dictionary names and `?`, and every value is bound.
  - Given every refused-property, refused-class and refused-shape row, when it is sent to the route, then the envelope error names the parameter and never the value. A shape error comes before the namespace switch.
- **AC-2 (39.3.2; AD-26, AD-19, AD-9).**
  - Given `redact` or `allow`, when the body action runs, then it returns header rows equal to the oracle, with no body value anywhere in the response, and `dataPolicy` names the policy.
  - Given `block` (operator-wide or per profile), when the body action is called, then it returns `DATA_POLICY_BLOCKED` with no IRIS call.
  - Given `IRIS_AUDIT_LOG_PARAMS=true`, when it is called under `redact` or `block`, then the audit logs `filters` as `"[REDACTED]"` with `dataPolicy`, and nothing logged or returned holds `SYNTHPHI393`.
- **AC-3 (39.3.3; Rule #59).** Given the seeded corpus over the property, op and value slots, when the default-suite gate drives the REST route directly, then the side-effect, result, refusal and echo oracles record 0 violations. The gate is proven red against an interpolating handler.
- **AC-4 (39.3.4; Rules #36, #34, #41).**
  - Given fixture σ, when each oracle row runs through the built interop server, then ids, order and every field equal the hand-written JOIN.
  - Given A and B, when the same requests run, then each equals its own oracle and they differ.
  - Given C, when a body search runs, then the result is `notApplicable`.
- **AC-5 (Integration; Rules 1 and 2).** Given the gate's sessions, when the built interop server's `iris_message_search` `body` runs against A, then it reads the route and produces the oracle's rows. The built server's audit interceptor writes the redacted `filters` and the `dataPolicy` field from the tool's declaration.
- **AC-6 (AD-15, AD-33, AD-14, AD-5).** Given the delivered tree, when the suites run, then:
  - every captured `headers` request answers byte for byte as on `d440a659ba1e`;
  - the 39.1 gate, including its resend replay, and the 39.2 gate stay green;
  - `searchTable` still refuses;
  - `BOOTSTRAP_VERSION` has moved with the roster at 31;
  - `GOVERNANCE_BASELINE` stays `1e62c5ad5bf7`/141;
  - no tool count moves.
- **AC-7 (AD-26 scope; Rules #56, #30).** Given the built dists, when the scope and doc-claims tests run, then `iris_message_search` is governed for `body` in `data-policy-scope.ts` and `tool_support.md`, the docs state the body action's default state and policy behavior, and none claims compliance.

## Spec Change Log

## Review Triage Log

## Design Notes

**Plan-time interpretations** (apply and report):
- **I1. The operator set** is the table below. There is no `like`, `in` or `between`: `contains` and `startsWith` cover pattern needs without wildcard semantics, and every op is shared with Story 39.4's operator.
- **I2. Filters combine with AND, 1 to 10.** There is no OR.
- **I3. `property` is the exact property name, one level.** The SQL field name is never accepted, so a column renamed by `SqlFieldName` is searched by its property name. This keeps the dictionary the single resolver.
- **I4. `bodyClass` is exact, and headers match by `MessageBodyClassName = bodyClass`.** This is required for correctness: body IDs are per extent, so header 7 (`Story393.Other` 1) must never join `Story393.Body` 1.
- **I5. A stream property accepts only `isNull`/`notNull`.** IRIS SQL refuses other predicates on a stream field with SQLCODE -313 (docs.intersystems.com GSQL_blobs and RSQL_where; Task 0 (e) confirms). The handler refuses first, with a parameter text.
- **I6. `filters` on `headers` is refused, not ignored.** A silently dropped filter would return unfiltered forensic results. Before this story the key did not exist, and Zod stripped it.
- **I7. Every body-action success carries `dataPolicy`.** The action is new, so no back-compat pin forbids it (unlike the preview's `allow`, 39.2 I5). The audit reads it.
- **I8. Header-first join (`%INORDER`).** It keeps the window the bound on the scan whatever the body table's statistics (AD-20). DW-572, the header-side bitmap scan, is unchanged and stays with the burn-down.

**Operators** (`BodyOpSql`; one map, emitted after `<alias>."<SqlFieldName>"`):

| op | Fragment | Value | Semantics |
| --- | --- | --- | --- |
| `eq`, `ne` | `= ?`, `<> ?` | required | by the column's collation (a default `%String` ignores case); `ne` never matches NULL |
| `lt`, `le`, `gt`, `ge` | `< ?`, `<= ?`, `> ?`, `>= ?` | required | collation order |
| `contains` | `[ ?` | required | case-sensitive substring, whatever the collation; `%` and `_` are literal |
| `startsWith` | `%STARTSWITH ?` | required | prefix, by the column's collation |
| `isNull`, `notNull` | `IS NULL`, `IS NOT NULL` | absent or null | |

**Property kinds** (`BodyFilterWhere`, exhaustive over `%Dictionary.CompiledProperty` as of 2026-10-16). The first match decides:
1. no compiled property `<class>||<property>`, or its `Name` differs from `property` → refused;
2. `MultiDimensional` → refused;
3. `(Transient or Calculated) and not SqlComputed` → not projected, refused;
4. `Collection` is `list` or `array` → refused;
5. `Relationship` → refused;
6. the type extends `%Library.SerialObject` → refused;
7. the type extends `%Stream.Object` → `isNull`/`notNull` only;
8. `SqlFieldName` is empty or contains `"` → refused;
9. anything else (a data type, a SqlComputed property, a persistent reference, which projects the referenced ID) → every op.

**Body class** (`BodyTable`): it must hold all of these, or it is refused naming `bodyClass`:
- `%Dictionary.CompiledClass` opens it, and its `Name` equals `bodyClass`;
- `ClassType` is `persistent`;
- `SqlSchemaName` and `SqlTableName` are not empty and contain no `"`.

**The statement** (Task 0 (d) confirms; `%FIRSTTABLE h` is the fallback):
```
SELECT TOP ? h.ID, h.SessionId, …(COLUMNS, h.-qualified)
FROM %INORDER Ens.MessageHeader h, "<schema>"."<table>" b
WHERE h.MessageBodyId = b.%ID AND <HeaderWhere alias h, bodyClass set> AND <BodyFilterWhere alias b>
  [AND (h.TimeCreated > ? OR (h.TimeCreated = ? AND h.ID > ?))]
ORDER BY h.TimeCreated, h.ID
```

**Fixture sources** (compiled inside A, or B where noted).
- `Story393.Addr` extends `%SerialObject`, with `Street`.
- `Story393.Other` is persistent, with `Code`.
- `Story393.Side` has `ClassMethod Bump() As %Integer [ SqlProc ]` (`$Increment(^Story393Side)`), plus `Count()` and `Reset()`.
- `Story393.Body` extends `Ens.Request`.
  - In A: `Code` `%String(MAXLEN=64)`; `Exact` `%String(COLLATION="EXACT", MAXLEN=1024)`; `Amount` `%Integer`; `Flag` `%Boolean`; `Renamed` `[SqlFieldName = RenamedField]`; `Group` (Task 0 c); `Computed` `[Calculated, SqlComputed]` = `"C-"_Code`; `Ref` `Story393.Other`; `OnlyInA`.
  - Also in A: `Note` `%Stream.GlobalCharacter`; `Secret` `[Transient]`; `Shown` `[Calculated]` with a `ShownGet`; `Scratch` `[MultiDimensional]`; `Tags` list; `Props` array; `Addr` `Story393.Addr`.
  - In B: `Code`; `Renamed` `[SqlFieldName = RenamedB]`; `OnlyInB`.
- `Story393.Seed.Seed(pSet, pExactJson)`:
  - It is guarded to `$NAMESPACE ? 1"EXECMCPTMP393"1U`, and refuses a namespace that already holds headers.
  - It uses `$Property`/`$ClassMethod`, so it compiles in both namespaces.
  - It creates σ's bodies and headers through `##class(ExecuteMCPv2.Temp.Story391Fixture).Add`/`SaveHl7`, with explicit times and literal codes.
  - It returns a JSON ID map. Headers are numbered 1..12 in A and 1..2 in B.

The bodies in A:
- body 1: `Code` `K1-alpha`, `Amount` 10, `Flag` 1, `Renamed` `R-one`, `Group` `g1`, `Ref` 1, `OnlyInA` `a1`, `Note` `SYNTHPHI393 note`;
- body 2: `k1-ALPHA`, 20, 0, `R-two`;
- body 3: `K2`, -5, 1, `Ref` 1;
- body 4: `K2`, 0, `Note` `note 4`;
- body 5: NULL `Code`, 1000;
- body 6: `K3`, 15.

`Exact` takes `STORY393_EXACT_VALUES[i-1]`, a single TS source that the TS oracle also reads: `SYNTHPHI393-E1`, `synthphi393-e1`, `x' OR '1'='1 SYNTHPHI393-E3`, `50% _off [SYNTHPHI393] "q" \ ?`, `SYNTHPHI393-E5\ttab\r\nnl` and `é中 SYNTHPHI393-E6`, all as escapes.

**The fuzz** (36.4 style; route-direct in A; seed `393` through `mulberry32`; one filter per request over W). Every random property and op input embeds `SYNTHPHI393`, so the echo oracle can vary. The alphabet is: quotes, `--`, `/*`, `;`, parentheses, `,`, `?`, `%`, `_`, `[`, `]`, `\`, whitespace, CR, LF, tab, `é`, `||`, `=`, `<>`, `OR 1=1`, `UNION SELECT`, and the write-shaped token `Story393.Side_Bump()`.
- **Property slot:** a fixed corpus plus 200 random names, with `op:"isNull"`. The corpus is every fixture property, the case variants, `RenamedField`, `ID`, `%ID`, and `Code" = 1 OR Story393.Side_Bump() = 1 OR "Code`. A name is expected to be accepted only when it is in the test's own hand-written searchable list, checked against `INFORMATION_SCHEMA.COLUMNS` (Task 0 b).
- **Op slot:** a fixed corpus plus 100 random ops, on `Code`. The corpus is `EQ`, `=`, `like`, `in`, `between`, `[`, `%STARTSWITH` and `eq OR Story393.Side_Bump()=1`. An op is expected to be accepted only when it is in the test's own hand-written op list.
- **Value slot:** a fixed corpus plus 300 random strings, on `Exact`, with ops `eq`, `ne`, `contains` and `startsWith`. Half the strings are copies or substrings of stored values. The expected ids come from TS evaluation over `STORY393_EXACT_VALUES` (exact collation: `===`, `!==` non-null, `includes`, `startsWith`).
- **Oracles:**
  - `sideCount` is 0 after the run, and the positive control `SELECT Story393.Side_Bump()` then `resetSide` runs first;
  - results equal the expected ids;
  - refusal texts name `filters[0].property` or `filters[0].op`;
  - no raw response contains `SYNTHPHI393`.
  - The test collects violations and asserts the list is empty, printing the first five.

**The capture list** (`headers`, explicit `to`): against A, these are:
- W alone, and W with each of `source`, `target:"Story393.Other"`, `bodyClass:"Story393.Body"`, `errorOnly`, and `status:"Errored"`;
- `limit:2`, pages 1 and 2;
- the refusals: no `from`, a window over 7 days, `limit:0`, an unknown status and a non-integer `sessionId`.

Against C, it is W alone.

**Extend, don't copy (Rule 2).**
- **Extended:**
  - `HeaderWhere` (alias), `COLUMNS` (one list), `HeaderRow`, `ReadString`/`ReadInteger`;
  - `refusalResult`/`effectiveDataPolicy`;
  - `interop-namespace-fixture.ts` (sources and helpers beside `STORY392_*`), `Story391Fixture.Add`/`SaveHl7`;
  - `docFixtures`, `executeMcpPost`, `atelierQuery`, `openWireSession`;
  - `story-39-1-gate-guards.test.ts` (both gates);
  - `mulberry32`, promoted from `lines.test.ts`.
- **Siblings, with reasons:** `MessageBodySearchTest` is a new class beside `MessageSearchTest`. That class is 288 lines, and five more methods would pass the ~500-line rule.

**Integration (Rules 1 and 2).**
- **Integration ACs:** AC-5, plus the matrix's oracle, policy and audit rows, against the real instance.
- **Consumes:**
  - 39.1: the tool, route, `HeaderWhere`, `HeaderRow`, `COLUMNS`, the cursor and `interop-namespace-fixture.ts`;
  - 39.2: `DATA_POLICY_BLOCKED`, `effectiveDataPolicy`, `ToolDefinition.dataPolicy` (`actions`, `phiInputs`), the audit plumbing and the scope table;
  - 39.0: the env harness.
- **Consumed-by:**
  - 39.4: `BODY_FILTER_OPS`/`BodyOpSql` for its operator, the block-refusal pattern, `phiInputs` for `value`, the fuzz harness, and the scope row update;
  - 39.5: header ids from body rows;
  - 39.6: the capstone, the docs enrichment, and the `trace-message-flow` prompt.

**Ledger inbox (Rule 17):** none (the slice for `39-3-message-body-content-search` is empty).

**Governing ADs.**
- **AD-26:** the binding AD: structured filters, IRIS-side validation, delimited `SqlFieldName`s, the closed operator enum, bound values, the route-direct fuzz, the policy and the scope row.
- **AD-12:** its recorded IRIS-side exception for identifier and operator validation. **AD-20:** the window and the output cap.
- **AD-19:** `phiInputs`, `outcome`, and no echo. **AD-9 and AD-3:** the per-profile policy through `ctx.config`.
- **AD-11 and AD-13:** the envelope, and validation before the switch. **AD-14:** the bootstrap move.
- **AD-15 and AD-33:** the capture pin and the additive route. **AD-4:** no new key; the annotations stay truthful.
- **AD-5:** `:check` only. **AD-29:** minor changesets.
- **Conventions:** Tool descriptions, Tool results, Refusals, Error text, Logging, Live gates, Live testing on a shared instance, Probes, Performance budgets.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- MCP calls name `server:"default"`, with namespace `HSCUSTOM` or one of this story's `EXECMCPTMP393*` namespaces.

**Step C: capture** (once, after Task 0 items 2–3 and before Task 1).
- Build shared, dev, admin and interop from the unchanged sources, and confirm the deployed version is `d440a659ba1e`.
- Then run `ENV STORY_39_3_CAPTURE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-3-body-search-live-gate.test.ts -t capture`.
- The fixture is never edited by hand.

**Shared surfaces:** these change, and other tests assert on them.
- The `iris_message_search` description and schema (the payload rows).
- The `body`/`NOT_IMPLEMENTED` rows of `message-search.test.ts`, `message-search-governance.test.ts`, the 39.1 gate and `MessageSearchTest`.
- The scope table, its test and `tool_support.md`.
- The README refusal and governance rows (keep the 39.1 and 39.2 pinned substrings).
- `BOOTSTRAP_VERSION`: every armed gate redeploys.
- `gateTestFiles`, `story-39-1-gate-guards`, the `test-helpers` exports and `lines.test.ts`.

Standing criterion: every test added or changed passes on a fresh environment, in either order.
- The gate creates and removes all its own state: `EXECMCPTMP393A`, `EXECMCPTMP393B` and `EXECMCPTMP393C`, the `Story393.*` classes inside them, `^Story393Side`, `ExecuteMCPv2.Temp.Story391Fixture`, and the temp files. Task 0 uses `EXECMCPTMP393P`, which is removed.
- OS classes run one class per `iris_execute_tests` call, and `total` is compared with the `Test*` count (Rule #35).

**Commands:**
- `(once)` Build shared, then dev, admin, interop, ops, data and client-config, one command each. Run Task 0 and Step C.
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/lines.test.ts src/__tests__/bootstrap.test.ts src/__tests__/refusals.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/interop build && pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/message-search-body.test.ts src/__tests__/message-search.test.ts src/__tests__/message-search-governance.test.ts src/__tests__/index.test.ts src/__tests__/presets.test.ts` -- expected: pass.
- `(loop)` Run each of these in its own call. First, after the first armed run deploys the new version, `iris_doc_load` `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/MessageBodySearchTest.cls` (HSCUSTOM). Then `iris_execute_tests`:
  - `ExecuteMCPv2.Tests.MessageBodySearchTest` -- expected: total 5, 0 failed;
  - `MessageSearchTest` -- expected: 5;
  - `MessageResendTest` -- expected: 12;
  - `MessagePreviewPolicyTest` -- expected: 4.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-3-body-search-live-gate.test.ts` -- expected: pass armed, nothing left. Then, one per call, the 39.1 gate and the 39.2 gate -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/data-policy-scope.test.ts src/__tests__/story-39-3-doc-claims.test.ts src/__tests__/story-39-1-doc-claims.test.ts src/__tests__/story-39-2-doc-claims.test.ts src/__tests__/story-39-1-gate-guards.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/docs-visibility-roster-sync.test.ts` -- expected: pass.
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one command each: `build`, `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism`, then `ENV pnpm --filter @iris-mcp/all test` -- expected: green.
- `(once)` A second `pnpm gen:bootstrap` -- expected: no diff. Also `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check`, `node scripts/check-epics-sync.mjs` and `pnpm measure:tools-payload` -- expected: OK, and the README rows equal the output.
- `(once)` Performance: the first armed bootstrap (budget 60 s), one body search of A over W (budget 2 s), and the fuzz's wall time (recorded).
- `(once)` After every armed run:
  - `leftovers` for the four `EXECMCPTMP393*` names is `[]`;
  - `iris_namespace_list` and `iris_database_list` show none of them;
  - `iris_doc_list` (HSCUSTOM, `Story393` and `ExecuteMCPv2.Temp.`, generated included) is empty.

**Planned mutations (Rule 19).** For each: apply it, observe red, revert, rebuild any dist and reload any class, and confirm that `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> -> <red test>`.

| AC | Mutation | Expected red |
|---|---|---|
| AC-1/AC-3 | `BodyFilterWhere` writes the value as a quoted literal instead of `?` (reloaded) | the fuzz (side-effect or result oracle); `TestBodyFilterWhereSystemClasses` |
| AC-1/AC-3 | an op outside the map passes through as written | the fuzz op slot; `TestBodyOpSqlClosedMap` |
| AC-1/AC-3 | the shape check and dictionary resolution are bypassed for `property`, and the caller text is emitted delimited | the fuzz property slot; the Renamed oracle row |
| AC-1 | the identifier is emitted without delimiters | the `Group` row (or `TestBodyFilterWhereSystemClasses` under the Task 0 (c) fallback) |
| AC-1 | `BodyFilterShape` called after the switch | the refused-shape rows (a namespace error appears instead) |
| AC-2 | `block` falls through to the HTTP call | the unit no-call row; the live `EXECMCPTMP393Z` row |
| AC-2 | `phiInputs` dropped from the declaration | the audit rows (unit and live) |
| AC-2 | the select list includes `b.*` | the header-rows-only row (`SYNTHPHI393` appears) |
| AC-4 | the `MessageBodyClassName` fragment dropped from the body path | the ID-collision row |
| AC-4 | `SwitchNamespace` skipped | the A-against-B row |
| AC-6 | `HeaderWhere` aliases even when no alias is given | the capture replay; the 39.1 resend replay |
| AC-6 | `searchTable` routed to `body` | the `NOT_IMPLEMENTED` rows |
| AC-7 | the scope row back to `residual` | `data-policy-scope.test.ts` |

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
