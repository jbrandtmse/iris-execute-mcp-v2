---
title: 'Story 39.4: Search Table Lookup'
type: 'feature'
created: '2026-10-17'
status: 'done'
baseline_revision: '0acd03c7d4d9049d5e93c1daff8702ffe85da0f8'
baseline_commit: '0acd03c7d4d9049d5e93c1daff8702ffe85da0f8'
review_loop_iteration: 0
followup_review_recommended: true
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

**Problem:** An engineer cannot find Interoperability messages by an indexed Search Table value, such as an HL7 medical record number (G34, the standard HL7 support query). The `searchTable` action of `iris_message_search` was declared in Story 39.1 and still answers `NOT_IMPLEMENTED`. The competitor's lookup resolves PropIds from `Ens_Config.SearchTableProp` but pastes caller input into generated code.

**Approach:**
- Implement the `searchTable` action (key `iris_message_search:searchTable`). It takes a required `searchTableClass` and the 39.3 `filters` grammar (1–10 `{property, op, value}`, AND), plus the 39.1 scope filters. It returns the same paged header rows as `headers` and `body`, never a Search Table value or body content.
- The IRIS handler that builds the statement validates everything. The class must be a compiled virtual-document Search Table class. Each `property` resolves, through IRIS's own `Ens.VDoc.SearchTableGenerator.getPropsList`, to a configured `Ens.Config.SearchTableProp` row, and is then a **bound PropId**, never text. Each operator maps from 39.3's closed `BodyOpSql`. Each value is normalized the way IRIS stores it for the property's `PropType` and is bound. The search table's name comes from the class dictionary.
- The statement reads the headers in the window first (`%INORDER`). Each filter is a correlated `EXISTS`/`NOT EXISTS` probe of the search table by the header's body ID.
- The policy applies as in 39.3: `dataPolicy.actions` adds `searchTable`. Under `block` the action is refused with `DATA_POLICY_BLOCKED` before any IRIS call. `filters` is already a `phiInputs` entry, so the Search Table values are redacted in the audit.
- A namespace with no `Ens.Config.SearchTableProp` row answers `notApplicable`.
- Prove it with a SQL oracle over the search table, a synthetic HL7 message found by its MRN, and an injection fuzz that drives the REST route directly.

## Boundaries & Constraints

**Always:**
- **No caller text in SQL text (AD-26).**
  - The statement holds only fixed text, the dictionary's delimited schema and table names of the search table's extent root, the fixed `''` literal, and `?` markers.
  - A property is bound as the integer `PropId` of its configured row and is never emitted. An operator is emitted only as `BodyOpSql`'s fragment or as one of the fixed clause shapes in Design Notes.
  - Every value, every PropId, the document class (the header predicate) and the page size are bound.
  - TypeScript validation is advisory. Every rule below is enforced IRIS-side, and the fuzz proves it over the route.
- **The input.**
  - `searchTableClass` is required on `searchTable`. It matches `^%?[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$` and is at most 220 characters before the dictionary is consulted. It must be a compiled class of exactly that name that is persistent, not abstract and `%Extends("Ens.VDoc.SearchTable")`. Its extent root (`Ens.VDoc.SearchTableGenerator.GetExtentSuperclass`) must have an SQL table. Its `DOCCLASS` parameter must name a compiled class.
  - `filters` is exactly 39.3's grammar, checked by the same `BodyFilterShape`: 1 to 10 objects of only `property`, `op` and `value`; `property` matches `^[A-Za-z][A-Za-z0-9]{0,127}$`; `op` is one of the ten 39.3 operators; and the `value` rules are 39.3's.
  - Each `property` must exactly (case-sensitively) equal the `Name` of a property that `getPropsList(searchTableClass)` returns. These are the properties the class or its Search Table superclasses define.
  - Each `op` must be allowed for the property's `PropType` (Design Notes).
  - `bodyClass` is optional on `searchTable`. When given, it must be the exact name of a compiled class that `%Extends` the Search Table's `DOCCLASS`, and it then replaces `DOCCLASS` as the header class predicate. Headers match `MessageBodyClassName` = that class through `HeaderWhere`.
  - The other 39.1 scope filters apply unchanged: the window (`from` required, `to` default now, 0–7 days), `item`, `source`, `target`, `status`, `sessionId`, `errorOnly`, `limit`, the cursor and `namespace`.
  - `searchTableClass` on `headers` or `body` is refused, on both sides, rather than ignored. `filters` remains refused on `headers`.
- **Validation order (AD-13).** Every shape rule runs before the namespace switch, and its text names the parameter (`searchTableClass`, `filters[2].op`), never the value. After the switch, these run in order:
  1. the 39.1 `interopEnabled:false` check;
  2. whether any `Ens.Config.SearchTableProp` row exists (if none, the result is `notApplicable`);
  3. the class;
  4. `bodyClass`;
  5. each filter's property, then its operator against the `PropType`.
- **Semantics (Design Notes, Clauses).** A message matches a value operator when it has at least one non-empty entry for the property whose stored value satisfies it. `ne` matches when it has no entry equal to the value. `isNull` matches when it has no non-empty entry, and `notNull` when it has at least one. Values are normalized per `PropType` exactly as `Ens.VDoc.SearchTableGenerator` stores them. A `String:CaseSensitive` property compares exactly (`%EXACT`); every other type compares through the column's collation.
- **Scope (AD-20, Rule #38).** The window bounds the work. The scan is header-first (`%INORDER`), and each filter probes the search table's `indexDocId` map by the header's body ID and the PropId. `limit` caps the output only.
- **Results (AD-26).**
  - Rows are exactly 39.1's header rows, selected from the header table only, paged by the same keyset and cursor.
  - A `searchTable` success (rows or `notApplicable`) carries `dataPolicy: {policy, redacted: 0, blocked: 0}`.
  - No response, content line, error text or log line echoes a filter value, a Search Table value or body content. A property refusal may list the class's configured property names, which are configuration and not values.
- **The policy (AD-26, AD-9, AD-3).** The handler reads `effectiveDataPolicy(ctx.config)` per call. Under `block`, `searchTable` returns `refusalResult(DATA_POLICY_BLOCKED, <fixed text>, {action:"searchTable", policy:"block"})`. That happens after the window parse and the action-key checks, and before every other searchTable check and any HTTP call.
- **Audit (AD-19).** `dataPolicy` becomes `{actions: ["body", "searchTable"], phiInputs: ["filters"]}`. So a searchTable entry carries `dataPolicy`, `params.filters` is `"[REDACTED]"` under `redact`, under `block` and for an unresolved profile, and a refusal audits as `outcome:"error"`.
- **IRIS side (AD-11, AD-12, AD-13, AD-14).**
  - Keep one envelope and pass text through `SanitizeError`.
  - A runtime SQL error of the lookup gives the fixed text `The Search Table lookup failed with SQLCODE <n>.`
  - `BodyFilterShape`, `BodyTable` and `BodyStatement` gain optional parameters. With their defaults, their text and behavior are byte-identical.
  - `MessageSearch.cls` is bootstrapped, so `pnpm gen:bootstrap` runs and `BOOTSTRAP_VERSION` moves `f7b0868c95d0` → new. The roster stays 31.
- **Back-compat (AD-15, AD-33).**
  - Every `headers` and `body` request in the capture list answers byte for byte as on `f7b0868c95d0`, pinned by a new capture. The 39.3 replay stays green.
  - The sanctioned text changes are excluded from the capture and named in the CHANGELOG:
    - the route's `action` refusal now lists `searchTable`;
    - the `filters`-on-`headers` refusal names both actions.
  - `resendFiltered` is untouched.
- **Live fixtures.** Fixtures are synthetic.
  - Every identifying value contains `SYNTHPHI394`, values that must survive contain `KEEPME394`, and times fall on 2001-02-03 UTC.
  - They live only in the disposable mapping-only namespaces `EXECMCPTMP394A`, `EXECMCPTMP394B` and `EXECMCPTMP394C` (the gate) and `EXECMCPTMP394P` (the Task 0 probes). They use the `Story394.*` classes compiled inside them, `Story393.Side`, and the HSCUSTOM fixture class `ExecuteMCPv2.Temp.Story391Fixture`. Search Table entries are made with `IndexDoc`; no production is started.
  - All of them are removed, with nothing-left assertions. Every IRIS MCP call names `server:"default"`.

**Never:**
- Never accept raw `WHERE` text, a PropId, a SQL column name, the search table's name or an operator outside the enum from the caller.
- Never interpolate a value, and never emit caller text as an identifier or a literal.
- Never return a `PropValue`, a body value, `ErrorStatus` or `Description`.
- No new tool, action, governance key, preset row, `TOOL_PAIRS` entry, `phiInputs` entry or prompt. No tool count moves. Annotations and `mutates` are unchanged.
- Never support `Ens.CustomSearchTable` subclasses, which have no `SearchTableProp` rows (Design Notes I2), and never follow batch `TopParentId` links (I7).
- No change to `resendFiltered`, the preview, `iris_production_messages`, or the `headers` and `body` behaviors beyond the two named texts.
- Never call `%Library.EnsembleMgr.EnableNamespace`. Never start a production. Never read HSCUSTOM's or another project's messages or Search Table entries.
- Never run the bare governance-baseline generator, and never hand-edit `bootstrap-classes.ts`.
- No document claims regulatory compliance.

## I/O & Edge-Case Matrix

**Fixture τ** (namespace A = `EXECMCPTMP394A`) is seeded by `Story394.Seed` (Design Notes). It has six HL7 messages m1–m6, indexed by `Story394.SearchTable` except m6, plus one `Ens.StringRequest` s1. It has eleven headers, all Request and status Completed unless noted. The source is `Story394.Source` and the target `Story394.Target`.

| Header | Body | `TimeCreated` (2001-02-03 UTC) | Note |
| --- | --- | --- | --- |
| 1 | m1 | 08:00:00 | |
| 2 | m2 | 08:00:01 | |
| 3 | m3 | 08:00:02 | status Error, `IsError` 1, target `Story394.Other` |
| 4, 5 | m4, m5 | 08:00:03 (both) | a tie broken by ID |
| 6 | m6 | 08:00:05 | not indexed |
| 7 | `Ens.StringRequest` s1 | 08:00:06 | its body ID equals m1's |
| 8 | `EnsLib.HL7.Message` 999 | 08:00:07 | dangling |
| 9 | `""` / `1` | 08:00:08 | literal body |
| 10 | m1 | 08:00:09 | Response, `CorrespondingMessageId` 1 |
| 11 | m1 | 2001-02-04 09:00:00 | outside the window |

The messages (PID is segment 2; PV1 follows):

| Msg | MSH-9 / MSH-10 | PID-1 | PID-2 | PID-3 | PID-5 | PID-6 |
| --- | --- | --- | --- | --- | --- | --- |
| m1 | `ADT^A01` / `Story394-CTL-a` | `0007` | `SYNTHPHI394-ALT-1` | `SYNTHPHI394-MRN-1` | `SYNTHPHI394^ONE` | empty |
| m2 | `ORU^R01` / `Story394-CTL-A` | `12` | | `SYNTHPHI394-MRN-2~SYNTHPHI394-MRN-1` | `SYNTHPHI394^TWO` | `KEEPME394-MOM` |
| m3 | `ADT^A08` / `Story394-CTL-3` | `3` | | `SYNTHPHI394-MRN-3` | | empty |
| m4, m5 | `ADT^A01` / `Story394-CTL-4`, `-5` | | | `SYNTHPHI394-MRN-4`, `-5` | | empty |
| m6 | `ADT^A01` / `Story394-CTL-6` | | | `SYNTHPHI394-MRN-6` | | |

The window **W** is `from:"2001-02-03T07:00:00Z"`, `to:"2001-02-03T09:00:00Z"`. "ST" means `searchTableClass:"EnsLib.HL7.SearchTable"`, and "ST4" means `"Story394.SearchTable"`.

Namespace B (`EXECMCPTMP394B`) compiles `Story394.SearchTableB`, which defines `AOnlyInB`, before any other Search Table work, so its PropIds differ from A's (`PatientID` is 5 in B, 4 in A; Task 0 (a) records them). B has two indexed messages, b1 (PID-3 `SYNTHPHI394-MRN-1`) and b2 (`SYNTHPHI394-MRN-B2`), and headers 1–2. Namespace C (`EXECMCPTMP394C`) has the interop mappings and nothing else: no Search Table and no message.

**The oracle** (Rule #36) is hand-written SQL over the search table with literals, run through `atelierQuery` in the same namespace. It resolves the PropId with its own join on `Ens_Config.SearchTableProp` by `ClassExtent` and `Name`, and uses `IN` / `NOT IN`, not the handler's `EXISTS`:

```sql
SELECT <header columns> FROM Ens.MessageHeader h
WHERE h.MessageBodyClassName = 'EnsLib.HL7.Message' AND <window>
  AND h.MessageBodyId [NOT] IN (SELECT s.DocId FROM EnsLib_HL7.SearchTable s, Ens_Config.SearchTableProp p
    WHERE p.ClassExtent = 'EnsLib.HL7.SearchTable' AND p.Name = '<name>' AND s.PropId = p.PropId AND <predicate on the stored form>)
ORDER BY h.TimeCreated, h.ID
```

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| MRN lookup (AC 39.4.4) | A, W, ST, `PatientID eq "SYNTHPHI394-MRN-1"` | Headers 1, 2 and 10, equal to the oracle. 2 matches by its second PID-3 repetition; 7 (ID collision) and 11 (outside W) never appear | none |
| Each op, each type | A, W, one filter per row: ST `PatientID` `contains "MRN-1"`, `startsWith "synthphi394-alt"`, `ne "SYNTHPHI394-MRN-1"`, `isNull`, `notNull`; ST `PatientName` `ge "synthphi394^t"`, `lt "SYNTHPHI394^P"`; ST `MSHControlID` `eq "Story394-CTL-a"`, `startsWith "Story394-CTL-"`, `startsWith "story394"`; ST `MSHTypeName` `eq "ADT_A01"`; ST4 `Story394Int` `eq "0007"`, `eq 7`, `ne 12`; ST4 `Story394Empty` `notNull`, `isNull` | Each equals its oracle (ids, order, every field). The facts that distinguish them: `contains` finds 1, 2 and 10 only because the value is lowercased like the stored one. `ne` excludes 2, since `NOT EXISTS` is used and not `<>`. `isNull PatientID` is 6 and 8. `MSHControlID eq` is 1 and 10, not 2, because the comparison is exact. `startsWith "story394"` matches nothing. `Story394Int "0007"` and `7` are both 1 and 10. `Story394Empty notNull` is 2 only, because the StoreNulls marker never counts | none |
| Combined | A, ST: `PatientID eq "SYNTHPHI394-MRN-1"` AND `MSHTypeName eq "ORU_R01"`; then ST `PatientID startsWith "synthphi394-mrn"` with `target:"Story394.Other"`, `errorOnly:true` | Header 2 only; then header 3 only; each equal to its oracle | none |
| bodyClass | A, ST `PatientID notNull` with `bodyClass` `EnsLib.HL7.Message`; `Ens.StringRequest`; `No.Such.Story394Class` | The first is the same as without `bodyClass`. The other two get an error naming `bodyClass`, which may name `DOCCLASS` | refusal |
| Paging | A, `limit:2`, ST `PatientID notNull` (1, 2, 3, 4, 5, 10) | Pages [1,2], [3,4], [5,10]. Joined they equal the oracle, the 4/5 tie is broken by ID, and only pages with `hasMore` carry `nextCursor` | none |
| Header rows only | every success above, through the tool and over the route | Raw response text holds no `SYNTHPHI394`, and the oracle shows the matched entries hold it (positive control) | none |
| Refused property | A: ST `Story394Int` (defined only by the subclass), `patientid`, `PropValue`, `DocId`, `NoSuch`; ST4 `Story394Int` `gt 5`, `contains "7"` | An error naming `filters[0].property`, listing the class's configured names (the five stock ones for ST), or naming `filters[0].op` for the Integer rows; never the value; nothing read | refusal |
| Refused class | A: `Ens.VDoc.SearchTable`, `Ens.VDoc.XMLSearchTable`, `Ens.CustomSearchTable`, `EnsLib.HL7.Message`, `enslib.hl7.searchtable`, `No.SYNTHPHI394` | An error naming `searchTableClass`, holding no `SYNTHPHI394` | refusal |
| Refused shape | route, namespace `EXECMCPTMP394Z` (missing). Every hostile string carries `SYNTHPHI394`. Cases: no `searchTableClass`; a `searchTableClass` with `'` or over 220 characters; no `filters`; `filters` `[]`, 11 items, `[5]`; an extra key; `property` `Pa tient`, 129 characters; `op` `EQ`, `like`; `eq` with no value; `isNull` with a value; value `""` or 1025 characters; `searchTableClass` on `headers` and on `body`; `filters` on `headers` | An error naming the parameter path, never the value, and no `SwitchNamespace` error (validation came first) | refusal |
| Injection fuzz | route, A: seeded corpus over the property, op and value slots (Design Notes) | 0 violations. `^Story393Side` stays undefined (the positive control first shows the probe can vary). Every value-slot result equals the TS oracle. Every refusal is expected and names its parameter. No response holds `SYNTHPHI394` | none |
| Second namespace (Rule #34) | A and B: ST `PatientID eq "SYNTHPHI394-MRN-1"`; `Story394.SearchTableB` `AOnlyInB notNull`; ST4 `Story394Int notNull` | Each equals its own oracle and they differ: A gives 1, 2, 10 and B gives 1. `Story394.SearchTableB` is refused in A, and `Story394.SearchTable` in B. The positive control: B's `PatientID` PropId ≠ A's, read from `Ens_Config.SearchTableProp` | refusal / none |
| Not configured (Rule #41) | C, a valid lookup; and C with `searchTableClass:"No.Such.Story394Class"` | Both `notApplicable:true` with the no-Search-Table reason, `rows:[]`, `hasMore:false` and `dataPolicy`. Configuration is checked before the class | none |
| No Interoperability | unit (mocked live shape): `interopEnabled:false` | `notApplicable:true` with the 39.1 reason and `dataPolicy` | none |
| Unknown namespace | `EXECMCPTMP394Z`, valid shape, under `redact` | `isError`, with the sanitized `SwitchNamespace` text (`<NAMESPACE>`) | error |
| `block` | `IRIS_DATA_POLICY=block`; and `IRIS_PROFILES={"tight":{"dataPolicy":"block"}}` with `callOn("tight")` | `{code:"DATA_POLICY_BLOCKED", action:"searchTable", policy:"block"}`, with no IRIS call (the same call aimed at `EXECMCPTMP394Z` is refused, not a namespace error). `headers` still runs, and the `default` profile of the `tight` session still runs `searchTable` | refusal |
| `redact` / `allow` | default; `IRIS_DATA_POLICY=allow` | The same rows. `dataPolicy` is `{policy:"redact"|"allow", redacted:0, blocked:0}`, and one trailing content line names the policy | none |
| Audit (AD-19) | `IRIS_AUDIT_LOG`, `IRIS_AUDIT_LOG_PARAMS=true`, `LOG_LEVEL=DEBUG`; searchTable calls under redact, block and allow | redact: `{action:"searchTable", outcome:"ok", dataPolicy:{policy:"redact",redacted:0,blocked:0}}`, `params.filters` `"[REDACTED]"`. block: `outcome:"error"`, policy `block`, filters redacted. allow: the filters are logged (positive control). Under redact and block, neither the file nor stderr nor any response holds `SYNTHPHI394` | none |
| Back-compat (AD-33) | the capture list (Design Notes), direct REST against A and C | Each raw text equals its capture from `f7b0868c95d0` | none |

</intent-contract>

## Code Map

**IRIS side**
- `src/ExecuteMCPv2/REST/MessageSearch.cls` (bootstrapped, 783 lines):
  - The class doc :1-23 names only `headers` and `body`; extend it.
  - `COLUMNS` :44, `HeaderWhere` :61 (already aliased), `AliasedColumns` :126, `BodyOpSql` :144 (reuse as is), `ReadString` :492, `ReadInteger` :507 and `HeaderRow` :466: reuse them.
  - `BodyFilterShape` :160-189: the `required` text at :166 says "for the body action"; add `pAction As %String = "body"`. `FilterShape` :193 is reused unchanged. `ReadFilterNumber` :249.
  - `BodyTable` :268-288: its refusal text names `bodyClass`; add `pParam As %String = "bodyClass"`.
  - `BodyStatement` :390-397 joins `<table> b`; add the no-body-table branch.
  - `MessageSearch()` :546-781:
    - the action check is at :562-565;
    - the headers-plus-`filters` refusal is at :566-569;
    - the reads are at :571-596 (add `searchTableClass`, max 220);
    - the body pre-switch block is at :651-663;
    - the switch is at :680-683;
    - the interop check is at :691-696;
    - the body after-switch block is at :700-707;
    - the statement and arguments are at :711-735;
    - the runtime texts are at :743-748 and :761-763;
    - the result is at :765-767.
- `src/ExecuteMCPv2/Utils.cls`: `SwitchNamespace` :50, `SanitizeError` :124, `ValidateRequired`.
- `src/ExecuteMCPv2/Tests/MessageSearchTest.cls:215-217`: sends `action:"searchTable"` expecting an `action` refusal. Change it to `bogus` (still 5 methods). `MessageBodySearchTest.cls` has 5 methods and pins `BodyStatement`'s body text, which must stay green.
- Read-only system sources (`irislib/`, by explicit path):
  - `Ens/Config/SearchTableProp.cls`: IdKey `(ClassExtent, Name)` :28. `PropId` :20 is assigned by `$Increment(^Ens.Config.SearchTablePropC(ClassExtent))` :92. `ClassDerivation` :26. `Name` MAXLEN 50.
  - `Ens/Config/SearchTablePropAttrs.cls`: `PropType` VALUELIST :12, `StoreNulls` :17, `IndexType`, `Unselective`.
  - `Ens/VDoc/SearchTable.cls`: `PropId` and `PropValue` `%String(MAXLEN=256, TRUNCATE=1)` with the default collation; indices `indexValue (PropId, PropValue, DocId)` IdKey and `indexDocId (DocId, PropId, PropValue)`. `Search()` uses `%startswith`. `getPropId` reads `Ens_Config.SearchTableProp` by `ClassExtent` and `Name`.
  - `Ens/SearchTableBase.cls`: `DocId` `%String(COLLATION="EXACT")`.
  - `Ens/VDoc/SearchTableGenerator.cls`:
    - `ValidateSearchTableProperties` :15 creates the rows and is run by compile and by `%Library.EnsembleMgr.deploySearchTables` (`irislib/%Library/EnsembleMgr.cls:3540-3578`).
    - The storage normalization is at :224-233 and :243-249.
    - `getPropsList(class, .props)` :306-335 returns `props(n)`, plus `,"PropId"`, `,"PropType"` and `,"IndexType"`, for the class and its Search Table superclasses only.
    - `getPropId` :337; `GetExtentSuperclass` :408.
  - `EnsPortal/MsgFilter/Assistant.cls:1542-1551` (the Message Viewer normalizes the query value the same way; functional reference only), :1597-1638 (its `IN` / `NOT IN` per-op shapes), and `GetSQLCondition` :1816.
  - `EnsLib/HL7/SearchTable.cls`: `DOCCLASS` `EnsLib.HL7.Message`, and the items `MSHTypeName` (Unselective), `MSHControlID` (`String:CaseSensitive`), `PatientID` (PID-2.1, each PID-3().1, PID-4().1), `PatientName` and `PatientAcct`.
  - The other stock VDoc tables, as of 2026-10-17: `EnsLib.EDI.{ASTM,EDIFACT,X12,XML}.SearchTable` and `EnsLib.XML.SearchTable` (DOCCLASS `Ens.StreamContainer`, inherited from the abstract `Ens.VDoc.XMLSearchTable`). `Ens.CustomSearchTable` (abstract, NoExtent) is a separate model.
- `scripts/gen-bootstrap.mjs:35` (MessageSearch; the roster is unchanged) and `packages/shared/src/bootstrap-classes.ts:25` (`f7b0868c95d0`).

**TypeScript**
- `packages/iris-interop-mcp/src/tools/message-search.ts` (641 lines):
  - The header doc :1-23 and :14-15 describe `searchTable` as declared.
  - `AVAILABLE_ACTIONS` :44 is used only by the `NOT_IMPLEMENTED` branch, so remove it. `BODY_FILTER_OPS` :50, `BodyFilter` :64, the limits :74-75, `BODY_BLOCKED_TEXT` :78, `SearchResult` :101-109.
  - The description is at :319-371, and the `action`, `bodyClass` and `filters` schema descriptions are at :373-422.
  - `mutates` :452 is unchanged. `dataPolicy` is at :459.
  - The handler: `NOT_IMPLEMENTED` :506-513; headers-plus-`filters` :515-517; `block` :522-528; body required :530-539; wire body :553-565; `dataPolicy` and the policy line :569-574; the `notApplicable` branch :583-600; success :602-625; `IrisApiError` :626-638.
- `packages/shared/src/server-base.ts`: `redactPhiInputs` :1732 is not action-gated, and `deriveAuditDataPolicy` :1754 is gated by `dataPolicy.actions`. So adding `searchTable` there is the whole audit change.
- `packages/shared/src/governance.ts:854-888` `assertDataPolicyDeclarations`: `actions` must be values of the `action` enum. `packages/shared/src/refusals.ts`: `NOT_IMPLEMENTED` :29 stays in the catalog; `DATA_POLICY_BLOCKED` :31.
- Tests that pin the old `searchTable` behavior (shared surfaces; update them):
  - `packages/iris-interop-mcp/src/__tests__/`:
    - `message-search.test.ts:96` (the description contains `NOT_IMPLEMENTED`) and :486-499;
    - `message-search-governance.test.ts:107-131` and :134-166 (use a searchTable call with no `searchTableClass`, a validation error, so the `["searchTable","error"]` audit tuple holds);
    - `message-search-body.test.ts:79-80` (the `dataPolicy` declaration) and its `'filters' applies only to the body action.` row.
  - `packages/iris-mcp-all/src/__tests__/`:
    - `story-39-1-message-search-live-gate.test.ts`:
      - the ROUTE_CASES row at :583 becomes searchTable without `searchTableClass`, with the token `searchTableClass`;
      - the describe at :655-664 becomes a valid lookup in its `NS_A`, which is `notApplicable` (no Search Table there);
      - the row at :701-713 becomes "searchTable still runs" with `notApplicable`;
      - the audit call at :992 omits `searchTableClass`, so the outcome stays `error`.
    - `story-39-3-body-search-live-gate.test.ts:1073-1078`: a valid lookup in its namespace A, which is `notApplicable`.
    - `story-39-3-qa-process.test.ts:322-334`: under `block`, `searchTable` is `DATA_POLICY_BLOCKED` with no route request.
  - `MessageSearchTest.cls:216`.
- `packages/iris-mcp-all/src/__tests__/data-policy-scope.ts:46-54` (the `iris_message_search` row; its reason ends "searchTable arrives in Story 39.4.") and `data-policy-scope.test.ts:83-86` (the exact governed list).

**Live harness** (`packages/iris-mcp-all/src/__tests__/`)
- `interop-namespace-fixture.ts`:
  - `FIXTURE_CLASS_SOURCE`: `Add` :71-89, `SaveHl7` :236-243 (an HL7 message, no header), `SaveString` :256.
  - `createInteropNamespace` :405 (package mappings `Ens` and `EnsLib` plus routine `Ens*` to ENSLIB; no globals mapped, so `^Ens.Config.SearchTableProp*` is local and empty), `removeInteropNamespace` :446, `assertFixtureName` :370, `putFixtureClass` :381, `removeFixtureClass` :392.
  - `STORY393_SIDE_SOURCE` :660-687 (reuse it in A), `STORY393_SEED_SOURCE` :688-791 (the guard and `AddHeader` pattern), `STORY393_DOCUMENTS` :804, `STORY393_IDS` :823.
  - `seedBodySearch` :836-875 (factor its put/compile/seed/check-IDs body into one private helper that both seeds call), `sideCount` :879, `resetSide` :884, `leftovers` :902.
- `process-gate-helpers.ts`: `openWireSession` :237 (`callOn`, `onStderr`), `atelierQuery` :334 (literal queries only), `executeMcpPost` :360, `docFixtures` :389, `shippedBootstrapVersion` :434, `assertDeployedBootstrapVersion` :455.
- `header-row-oracle.ts`: `oracleColumns` :31, `sqlLiteral` :46, `bodyJoinOracle` :54 (add a sibling), `expectedRow` :73.
- `doc-claims-patterns.ts`: `CLAIMS` :8 (import it for the compliance scan).
- Precedents:
  - `story-39-3-body-search-live-gate.test.ts`: `beforeAll` :183-225, `afterAll` :226-262, capture/replay :263-315, helpers :319-455, the route and refusal rows :623-778, the fuzz :780-958 (`FUZZ_TOKENS` :824 and `fuzzText` :830 are file-private: move them into a shared module), policy :1018-1083, audit :1084-1147;
  - `story-39-3-qa-live-gate.test.ts:460-533` (`planProblems` over `INFORMATION_SCHEMA.STATEMENTS`, Story393-specific).
- `story-39-1-gate-guards.test.ts`: `DRIVEN_PACKAGES` :28, `GATES` :31-35. `scripts/prepublish-gate.mjs` `gateTestFiles` :105-168 (the 39.x entries :139-167). `live-gate-roster.test.ts:29-57` requires every armed file in the roster.
- `packages/shared/src/__tests__/test-helpers.ts`: `mulberry32`.

**Docs**
- Root `README.md`:
  - :17 (the interop summary);
  - :485 (the `NOT_IMPLEMENTED` row: "today: `iris_message_search` action `searchTable`");
  - :486 (`DATA_POLICY_BLOCKED`);
  - :545 (the governance-defaults row; it ends "`searchTable` answers `NOT_IMPLEMENTED` until Story 39.4");
  - :688-694 (the payload table) and :696 (`Last re-measured at Story 39.3`);
  - :720 ("What it governs today").
- `packages/iris-interop-mcp/README.md`: :160, :201, :203 (keep the governance sentence pinned by `story-39-1-doc-claims.test.ts:162`), :221. `packages/iris-mcp-all/README.md:27`.
- `tool_support.md`: :204 (the 39.3 note; add a 39.4 note after it), :386 (the scope row), :422 (the last sentence of the section).
- `CHANGELOG.md`: the top section is Story 39.3 (:5). `.changeset/story-39-3-message-body-content-search.md` is the precedent.
- Doc pins that this story's text changes. Update each pin whose sentence changes, and keep every pin that still holds:
  - `story-39-3-doc-claims.test.ts`: :126-128, :132-136 (:136 "until Story 39.4"), :202-203;
  - `story-39-1-doc-claims.test.ts`: :117-122, :138-150 and :154 (the re-measured regex accepts any `39.\d+`).

## Tasks & Acceptance

**Execution** (in dependency order):

*Task 0: probes, the fixture extension and the capture, before any edit to `MessageSearch.cls`.*
1. **Probes (AC 39.4.1; Rules #16, #42).** Use `EXECMCPTMP394P`, built and removed with `createInteropNamespace`/`removeInteropNamespace`. Record each result under Verification, with the IRIS version.
   - (a) Compile the A sources there. Record:
     - every `Ens_Config.SearchTableProp` row (`ClassExtent`, `Name`, `PropId`, `PropType`, `StoreNulls`, `ClassDerivation`);
     - `getPropsList` for `EnsLib.HL7.SearchTable` (the five stock names) and for `Story394.SearchTable` (seven);
     - `GetExtentSuperclass` and `$Parameter(…,"DOCCLASS")` of both;
     - then compile the B source in a fresh order and record B's PropIds.
     - **If a subclass of `EnsLib.HL7.SearchTable` does not compile in a mapping-only namespace**, stop. Record the compile error and HALT the implement stage as `blocked` with that evidence, because the fixture design depends on it.
   - (b) Save m1 untyped (no DocType), run `Story394.SearchTable.IndexDoc(m1)`, and record its status and every stored `(PropId, PropValue, DocId)` row. Expect PatientID rows for PID-2 and PID-3 in lower case, `MSHControlID` exact, `MSHTypeName` `adt_a01`, `Story394Int` `7` and the `Story394Empty` marker. Record whether `PropValue = ''` is true and `<> ''` false for the marker. **If the stock PatientID item stores nothing for an untyped message**, add `Story394MRN` (`{2:3(1).1}`) to `Story394.SearchTable`, point the MRN rows at it, and record why.
   - (c) The normalization oracle. Compile a probe class `Story394.ProbeTypes Extends EnsLib.HL7.SearchTable` with one literal-expression item per PropType: `"MiXeD|Pipe"` for `String:CaseInsensitive` and for `String:CaseSensitive`, `"0007"` Integer, `"1.50"` Numeric, `"Yes"` Boolean, `"2001-02-03 08:00:00"` `DateTime:ODBC` and `"20010203080000"` `DateTime:HL7`. Index one message and record each stored value. These are the expected values of `TestSearchTableValue`.
   - (d) Bound-value semantics on `PropValue`, for `=`, `[`, `%STARTSWITH`, `<` and `<> ''`, with and without `%EXACT`: case (`story394-ctl-a` against `Story394-CTL-a`), trailing whitespace, and the marker. This records the plain-column behavior the `%EXACT` rule replaces.
   - (e) The Design Notes statement prepares and runs with `tArgs...`. `iris_sql_analyze` `explain` (namespace P, literals) shows the header `TimeCreated` range first, then a per-header subquery reading `indexDocId` "using the given S0.DocId and S0.PropId", and no search-table module "called once" (the planning-time HSCUSTOM plan is in Design Notes). **If the search table is read before the headers or once for all of them**, stop. Record the plan as a `deferred:` item and do not ship another statement shape without a spec amendment.
   - (f) `Ens.CustomSearchTable` `%Extends("Ens.VDoc.SearchTable")` is 0. `Ens.VDoc.XMLSearchTable` is not persistent. `EnsLib.XML.SearchTable` gives DOCCLASS `Ens.StreamContainer` and its extent root. A case variant of a class opens no `%Dictionary.CompiledClass`.
   - (g) The deployed `BOOTSTRAP_VERSION` is `f7b0868c95d0`.
2. `packages/iris-mcp-all/src/__tests__/interop-namespace-fixture.ts`: extend it; do not copy.
   - Add `STORY394_SEARCH_TABLE_SOURCE`, `STORY394_SEARCH_TABLE_B_SOURCE` and `STORY394_SEED_SOURCE` (Design Notes), `STORY394_IDS` and a `STORY394_DOCUMENTS` map (A: `Story393.Side`, `Story394.SearchTable`, `Story394.Seed`; B: `Story394.SearchTableB`, `Story394.Seed`).
   - Add `seedSearchTable(dev, name, set: "a" | "b")`. It shares one private put/compile/seed/check-IDs helper with `seedBodySearch`, whose behavior is unchanged.
3. `packages/iris-mcp-all/src/__tests__/fuzz-corpus.ts` (new): move `FUZZ_TOKENS` and `fuzzText(random, marker?: string)` out of the 39.3 gate, which imports them and passes its own marker. The 39.3 fuzz behaves exactly as before.
4. `packages/iris-mcp-all/src/__tests__/header-row-oracle.ts`: add `searchTableOracle(target, namespace, extentTable, classExtent, propName, windowSql, predicate, negate = false, extra = "")` beside `bodyJoinOracle`, with the SQL of the matrix oracle.
5. `packages/iris-mcp-all/src/__tests__/story-39-4-search-table-live-gate.test.ts` (new): the capture row `it.runIf(process.env.STORY_39_4_CAPTURE === "1")`.
   - It writes `fixtures/story-39-4-search-baseline.json` (`{capturedWithBootstrapVersion, irisVersion, capturedAt, command, cases:[{name, body, status, text}]}`) for the capture list against A and C.
   - Every other `describe` is `skipIf(CAPTURE)`. Run it on the pre-change classes and dists (Verification Step C).

*Task 1: IRIS side.*

6. `src/ExecuteMCPv2/REST/MessageSearch.cls`:
   - `BodyFilterShape(pFilters, pAction As %String = "body")`: the required text names `pAction`. With the default, every text is byte-identical.
   - `BodyTable(pClassName, Output pTable, pParam As %String = "bodyClass")`: the refusal names `pParam`. With the default, it is byte-identical.
   - `BodyStatement(pBodyTable, pWhere, pBodyWhere, pCursor)`: with an empty `pBodyTable` it emits `SELECT TOP ? <AliasedColumns h> FROM %INORDER Ens.MessageHeader h WHERE <pWhere> AND <pBodyWhere>[ keyset] ORDER BY h.TimeCreated, h.ID`. With a table, the text is byte-identical.
   - `SearchTableClass(pClassName, Output pTable, Output pDocClass) As %Status`: the class rule of Design Notes. `pTable` comes from `..BodyTable(<extent root>, .pTable, "searchTableClass")`.
   - `SearchTablesConfigured() As %Boolean`: fixed SQL `SELECT TOP 1 PropId FROM Ens_Config.SearchTableProp`. A SQL failure is an error status, never a silent `notApplicable`.
   - `SearchTableValue(pPropType, pValue) As %String`: the closed normalization table.
   - `SearchTableOpAllowed(pPropType, pOp) As %Boolean`.
   - `SearchTableClause(pIndex, pTable, pPropType, pOp) As %String`: the closed clause table, or `""` for an unknown op.
   - `SearchTableFilterWhere(pClassName, pTable, pFilters, Output pWhere, Output pParams) As %Status`:
     - it re-runs `BodyFilterShape(pFilters, "searchTable")`;
     - it calls `##class(Ens.VDoc.SearchTableGenerator).getPropsList(pClassName, .tProps)` once, and matches each `property` exactly;
     - a miss is refused, naming `filters[i].property` and listing the configured names (sorted, at most 50, then `and N more`);
     - a disallowed op is refused, naming `filters[i].op`;
     - it binds `PropId`, then `SearchTableValue(...)` when the clause has a value marker;
     - the clauses are joined with `" AND "`.
   - `MessageSearch()`:
     - `action` is `headers` | `body` | `searchTable` (text `must be one of: headers, body, searchTable`);
     - `filters` on `headers` gets `Parameter 'filters' applies only to the body and searchTable actions`;
     - `searchTableClass` is read (max 220) and refused on the other actions;
     - for `searchTable`, check, before the switch, that `searchTableClass` is present and has the class shape, that a given `bodyClass` has the same class shape, and run `BodyFilterShape(filters, "searchTable")`;
     - after the switch and the interop check, run `SearchTablesConfigured` (false gives `searchTablesConfigured:false`, no rows), then `SearchTableClass`, then `bodyClass` (`%Extends` the DOCCLASS), then `HeaderWhere(…, "h")` with `bodyClass` set to the header class, then `SearchTableFilterWhere`, then `BodyStatement("", …)`;
     - the arguments are the page size, the header parameters, the Search Table parameters, then the cursor;
     - both runtime-failure sites give `The Search Table lookup failed with SQLCODE <n>.`;
     - the result is `{action:"searchTable", interopEnabled, searchTablesConfigured, rows, hasMore, limit, from, to}`;
     - the `headers` and `body` paths are unchanged apart from the two named texts.
7. `src/ExecuteMCPv2/Tests/MessageSearchTableTest.cls` (new; data-free; at most 500 lines; not in the manifest). It has five methods:
   - `TestSearchTableValue`: each PropType against its Task 0 (c) value; a JSON number and a boolean; `|` becomes `+`.
   - `TestSearchTableOpAllowed`: the matrix of Design Notes.
   - `TestSearchTableClause`: each op's exact text (`EXISTS` / `NOT EXISTS`, the `<> ''` term, `%EXACT` only for `String:CaseSensitive`, `BodyOpSql`'s fragment), no value in the text, and `""` for `EQ`, `like` and a hostile string.
   - `TestSearchTableClassSystemClasses`, in HSCUSTOM, dictionary only:
     - `EnsLib.HL7.SearchTable` gives `"EnsLib_HL7"."SearchTable"` and DOCCLASS `EnsLib.HL7.Message`;
     - `EnsLib.XML.SearchTable` gives its root table and DOCCLASS `Ens.StreamContainer`;
     - `Ens.VDoc.SearchTable`, `Ens.VDoc.XMLSearchTable`, `Ens.CustomSearchTable`, `EnsLib.HL7.Message`, `No.Such.Story394Class` and `enslib.hl7.searchtable` are refused, naming `searchTableClass`.
   - `TestSearchTableStatementText`:
     - `BodyStatement("", …)` starts with `SELECT TOP ? h.ID, h.SessionId,` and holds `FROM %INORDER Ens.MessageHeader h WHERE`, with no `b.` and no select column from the search table;
     - `BodyStatement` with a table, and the default `BodyFilterShape` and `BodyTable` texts, equal their 39.3 texts;
     - the `searchTable` texts name their action or parameter.
8. `MessageSearchTest.cls:216`: `searchTable` → `bogus` (still 5 methods).
9. Run `pnpm gen:bootstrap`. Record `BOOTSTRAP_VERSION` `f7b0868c95d0` → new; the roster stays 31 (Rule #24).

*Task 2: TypeScript.*

10. `packages/iris-interop-mcp/src/tools/message-search.ts`:
    - Remove `AVAILABLE_ACTIONS` and the `NOT_IMPLEMENTED` branch.
    - Add `searchTableClass: z.string().max(220).optional()` to the schema, then update the `action`, `bodyClass` and `filters` descriptions. The `filters` node is unchanged (its `property` regex and value union stay).
    - `dataPolicy` becomes `{actions: ["body", "searchTable"], phiInputs: ["filters"]}`.
    - The handler, in order, extending the body branch rather than copying it:
      1. the `from`/`to` parse;
      2. `filters` on `headers` → `'filters' applies only to the body and searchTable actions.`; `searchTableClass` on `headers` or `body` → `'searchTableClass' applies only to the searchTable action.`;
      3. `block` on `body` → the existing refusal; on `searchTable` → `DATA_POLICY_BLOCKED` with `SEARCH_TABLE_BLOCKED_TEXT` (`The block data policy withholds message body data, and a Search Table lookup reveals values taken from message bodies, so the searchTable action is refused. Use the headers action, or ask the operator for a looser IRIS_DATA_POLICY for this profile.`);
      4. the required fields of `body`; for `searchTable`, `'searchTableClass' is required for the searchTable action: the exact name of a Search Table class, such as EnsLib.HL7.SearchTable.` and `'filters' is required for the searchTable action: 1 to 10 {property, op, value} conditions on its Search Table properties.`;
      5. the cursor;
      6. the wire body: the `headers` fields plus `searchTableClass` and `filters`, sent as given.
    - `SearchResult` gains `searchTablesConfigured?: boolean`. `searchTablesConfigured === false` gives `notApplicable: true` with `No Search Table is configured in namespace '<ns>': it has no Search Table properties (Ens.Config.SearchTableProp is empty), so there is nothing to look up. Compile or deploy a Search Table class there, or use the headers or body action.`
    - The searchTable outputs carry `dataPolicy` and the line `Data policy <policy>: header rows only; the searchTable action returns no Search Table or body values.` A no-match searchTable heading adds `A Search Table holds only the messages indexed when they were processed (or by BuildIndex), so no match does not prove that no message holds the value.` The `headers` and `body` outputs are byte-identical.
    - The description gives what, when and returns, and is exhaustive about the action. It covers:
      - the inputs;
      - the stock HL7 properties, with `PatientID` as PID-2, PID-3 and PID-4, so an MRN;
      - the clause semantics, including `ne`, `isNull` and multi-valued properties;
      - case per PropType;
      - the Integer/Numeric/Boolean op limit;
      - values stored truncated to 256 characters;
      - the document-class match and the `bodyClass` narrowing;
      - that custom Search Tables are unsupported;
      - `notApplicable`, and the property refusal that lists names;
      - the policy behavior and refusal code, and that matches still reveal what bodies hold;
      - the default state (read, enabled by default).

      It still covers the window, the output cap and the other actions, and names no REST path.
11. Tests:
    - `packages/iris-interop-mcp/src/__tests__/message-search-table.test.ts` (new, mocked HTTP; every fake reply has the live route's shape, Rule #54). It covers:
      - the wire body;
      - the required, misplaced-`searchTableClass` and headers-plus-`filters` rows;
      - `block` making no HTTP call, including under a per-profile `ctx.config`;
      - `dataPolicy` under redact and allow;
      - both `notApplicable` branches (`interopEnabled:false`; `searchTablesConfigured:false`);
      - the cursor and `IrisApiError`;
      - no filter value in `content` or in an error, for a hostile value.
    - Update the Code Map rows of `message-search.test.ts`, `message-search-governance.test.ts` and `message-search-body.test.ts`. The governance audit rows add a real-handler searchTable call under `redact` (staged envelope), asserting `params.filters:"[REDACTED]"` and `dataPolicy`.

*Task 3: the gate, scope, docs and counts.*

12. Finish `story-39-4-search-table-live-gate.test.ts`, on the 39.3 shape:
    - **`beforeAll`:**
      1. it fails on a stale shared, dev, admin or interop dist, or an unreachable IRIS, when armed;
      2. `assertDeployedBootstrapVersion`;
      3. it puts the fixture class, removes A/B/C by name and asserts nothing is left;
      4. it creates A, B and C (all interop), runs `seedSearchTable` for A (`a`) and B (`b`), and runs a positive leftovers control.
    - **`afterAll`:** each step in its own guard. It removes A/B/C, runs the leftovers check, removes the fixture class and the temp files, and checks that `iris_doc_list` (HSCUSTOM, generated included) shows no `Story391Fixture`, `Story393` or `Story394` document.
    - **Rows:**
      - every matrix row through the BUILT interop server (sessions: default, `allow`, `block`, `tight` profile, and audit with `onStderr`);
      - the route rows through `executeMcpPost`;
      - the oracle rows through `searchTableOracle`;
      - the fuzz (`fuzz-corpus.ts`, `mulberry32(394)`);
      - a plan row: after the route calls, every `SELECT TOP ? H.ID` statement of A in `INFORMATION_SCHEMA.STATEMENTS` that reads the search table has exactly the twelve header columns and `FROM %INORDER Ens.MessageHeader h WHERE`, and its plan reads the header maps before any `SearchTable` map, with each subquery "using the given S0.DocId and S0.PropId". The checker is shown to fail on malformed inputs;
      - the replay against the capture, asserting `capturedWithBootstrapVersion === "f7b0868c95d0"` and `!== shippedBootstrapVersion()`.
    - Add it to `scripts/prepublish-gate.mjs` `gateTestFiles` with a comment, and to `story-39-1-gate-guards.test.ts` `GATES` (driven packages unchanged).
13. Shared-surface updates: the Code Map rows of the 39.1 gate, the 39.3 gate, `story-39-3-qa-process.test.ts` and `MessageSearchTest.cls`.
14. Update the scope row in `data-policy-scope.ts`: `governedActions:["body","searchTable"]`.
    - The new reason: "The body and searchTable actions are under the policy: refused under block; under redact and allow they return header rows only. The headers action is not: for a header with no body class the body ID is the literal body value, so restrict iris_message_search:headers with its governance key."
    - `data-policy-scope.test.ts:83-86` gets `["iris_message_search",["body","searchTable"]]`.
    - Make the same change in `tool_support.md` (:386, :422).
15. Docs (Rules #30 and #43, minimal; 39.6 enriches):
    - every Code Map doc line, each stating the searchTable action's default state (read, enabled by default; refused under `block`), the `NOT_IMPLEMENTED` row (no tool returns it as of Story 39.4; it stays in the catalog), and the policy rows;
    - a `tool_support.md` Story 39.4 note: no count, key or default moves; `BOOTSTRAP_VERSION` from → to;
    - `CHANGELOG.md`, top section `## [Pre-release — 2026-10-17] — Story 39.4: Search Table lookup`:
      - Added: the action, and `searchTableClass`;
      - Changed: the route's action text, the `filters`-on-`headers` text, `searchTableClass` refused off its action, `NOT_IMPLEMENTED` no longer returned, `dataPolicy.actions`, and the bootstrap move;
      - then Tests;
      - it holds no `` `full` N/N/N/N/N `` pattern;
    - `.changeset/story-39-4-search-table-lookup.md` (`@iris-mcp/interop` minor, `@iris-mcp/shared` minor);
    - after rebuilding, the README payload rows equal `pnpm measure:tools-payload`, and :696 reads `Story 39.4`.
16. `packages/iris-mcp-all/src/__tests__/story-39-4-doc-claims.test.ts` (new) pins:
    - the CHANGELOG section, by title, with its two version literals;
    - the changeset bump map (`skipIf` absent);
    - the README `NOT_IMPLEMENTED`, `DATA_POLICY_BLOCKED` and governance rows naming the searchTable action and its default state;
    - the interop subsection;
    - the `tool_support.md` note and scope row;
    - that no new text claims compliance (import `CLAIMS`).

**Acceptance Criteria:**
- **AC-1 (39.4.2; AD-26, AD-12, AD-13).**
  - Given a lookup with any filter, when IRIS builds the statement, then it holds only fixed text, the dictionary's delimited extent table, `''` and `?`; every property is a bound PropId from the namespace's `SearchTableProp` rows; and every value is bound.
  - Given every refused-property, refused-class and refused-shape row, when it is sent to the route, then the error names the parameter and never the value, and a shape error comes before the namespace switch.
- **AC-2 (39.4.3, policy; AD-26, AD-19, AD-9).**
  - Given `redact` or `allow`, when the action runs, then it returns header rows equal to the oracle, with no Search Table or body value anywhere, and `dataPolicy` names the policy.
  - Given `block` (operator-wide or per profile), when it is called, then it returns `DATA_POLICY_BLOCKED` with no IRIS call.
  - Given `IRIS_AUDIT_LOG_PARAMS=true` under `redact` or `block`, when the action is called, then the audit logs `filters` as `"[REDACTED]"` with `dataPolicy`, and nothing logged or returned holds `SYNTHPHI394`.
- **AC-3 (AD-26; Rule #59).** Given the seeded corpus over the property, op and value slots, when the default-suite gate drives the REST route directly, then the side-effect, result, refusal and echo oracles record 0 violations. The gate is proven red against an interpolating handler.
- **AC-4 (39.4.3–39.4.4; Rules #36, #34, #41).**
  - Given fixture τ, when the MRN lookup and each oracle row run through the built interop server, then ids, order and every field equal the SQL oracle over the search table. The synthetic message is found by its MRN.
  - Given A and B, when the same requests run, then each equals its own oracle and they differ.
  - Given C, when a lookup runs, then the result is `notApplicable`.
- **AC-5 (Integration; Rules 1 and 2).** Given the gate's sessions, when the built interop server's `iris_message_search` `searchTable` runs against A, then it reads the route and produces the oracle's rows, and the built server's audit interceptor writes the redacted `filters` and the `dataPolicy` field from the tool's declaration.
- **AC-6 (AD-15, AD-33, AD-14, AD-5, AD-20).** Given the delivered tree, when the suites run, then:
  - every captured `headers` and `body` request answers byte for byte as on `f7b0868c95d0`, and the 39.3 replay still holds;
  - the 39.1, 39.2 and 39.3 gates (as updated) stay green;
  - the plan reads the window's headers before the search table;
  - `BOOTSTRAP_VERSION` has moved with the roster at 31;
  - `GOVERNANCE_BASELINE` stays `1e62c5ad5bf7`/141;
  - no tool count moves.
- **AC-7 (39.4.1; AD-26 scope; Rules #56, #30).**
  - Given the disposable namespace `EXECMCPTMP394P`, when the Task 0 probes run, then the `SearchTableProp` shape, the storage and normalization, and the statement plan are recorded under Verification with the IRIS version, and the competitor mapping is recorded under Design Notes.
  - Given the built dists, when the scope and doc-claims tests run, then `iris_message_search` is governed for `body` and `searchTable` in `data-policy-scope.ts` and `tool_support.md`, the docs state the searchTable action's default state and policy behavior, and none claims compliance.

### Review Findings

Code review (`/epic-cycle` code-review stage, 2026-10-17; review tier `full-opus`; all four layers delivered: Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). 24 raw findings, 13 entries after grouping (high 0, medium 4, low 9), 8 rejected. The security-critical constraints were checked against the code with the repository in view and hold. No caller text reaches the statement except as bound values, the dictionary-resolved extent table (`BodyTable(GetExtentSuperclass(...))`, delimited, `"` refused) and the alias `s<integer>`. The PropId and value are bound. `getPropsList` is called only with a class that `SearchTableClass` has proven exact, persistent, concrete and a subclass of `Ens.VDoc.SearchTable`, and it keys on the IRIS-written `ClassDerivation`. `SearchTableShape`, with the 256-character rule, runs at :935, before `SwitchNamespace` at :955. The fuzz is route-direct and recorded red. Rule 2 (production code): `SearchTableShape`, `SearchTableClause` and `SearchTableOpAllowed` reuse `BodyFilterShape`/`FilterShape`/`BodyOpSql`, `SearchTableClass` reuses `BodyTable`, and the TypeScript handler extends the body branch, so nothing is copied.

- [x] [Review][Patch] (medium) The QA HSCUSTOM row passed on a weaker branch whenever HSCUSTOM is configured: it relied on state it did not create (Rule 19 hermeticity, Rule #59), and its `else` branch could not show `notApplicable`. It is now skipped with the reason, and no lookup is sent into a configured HSCUSTOM [packages/iris-mcp-all/src/__tests__/story-39-4-qa-live-gate.test.ts:292]
- [x] [Review][Patch] (medium) The QA-process unresolved-profile row asserted on stderr before the server's lines for the call were read (Rule 19, it acted before ready). One `listTools` round trip now comes first, plus a capture control [packages/iris-mcp-all/src/__tests__/story-39-4-qa-process.test.ts:710]
- [x] [Review][Patch] (low) `SearchTablesConfigured` answered a fetch-time SQL failure (`%Next` returning 0 with `%SQLCODE` < 0) as "none configured", against Task 6 and its own doc comment. It now throws, the same check the main loop makes; `BOOTSTRAP_VERSION` `a6df36481aa9` → `b6ec56073e29` (31 classes) [src/ExecuteMCPv2/REST/MessageSearch.cls:480]
- [x] [Review][Patch] (low) The `ne` docs did not say that a never-indexed or dangling message matches (the gate's `PatientID ne` row expects headers 6 and 8). The description and the interop README now say so, with pins; the README payload row was re-measured (interop full 52,330, core 33,388) [packages/iris-interop-mcp/src/tools/message-search.ts:382]
- [x] [Review][Patch] (low) The Interoperability check before the Search Table configuration check (validation order 1 then 2) was never driven live; the No-Interoperability rows fake the reply. Added a tool row and a route row in the 39.3 gate's non-interop namespace C, proven red (mutation below) [packages/iris-mcp-all/src/__tests__/story-39-3-body-search-live-gate.test.ts:997]
- [x] [Review][Patch] (low) The plan row's `calls.length + 1` "statement for the built server's call" count could not fail in a full-file run: the tool's statement is the same text as an earlier route row's. The call and the `+1` were removed; the per-call fragment checks stand [packages/iris-mcp-all/src/__tests__/story-39-4-search-table-live-gate.test.ts:1287]
- [x] [Review][Patch] (low) The fuzz ran its op and value slots on `Story394.SearchTable`; the Design Notes name ST. `probe` now takes the class: ST4 for the property slot, ST for the op and value slots [packages/iris-mcp-all/src/__tests__/story-39-4-search-table-live-gate.test.ts:903]
- [x] [Review][Patch] (low) The CHANGELOG listed the `dataPolicy.actions` change under Added; Task 15 puts it under Changed. Moved [CHANGELOG.md:38]
- [x] [Review][Patch] (low) The `story-39-1-gate-guards` header named three gates while `GATES` lists five [packages/iris-mcp-all/src/__tests__/story-39-1-gate-guards.test.ts:2]
- [x] [Review][Defer] (medium, Rule 2) The live gates copy their helpers instead of sharing one set. The 39.4 gate's `route`/`RouteAnswer`, `succeeded`, `skip`, `interopSession` and `searchEntries` copy `story-39-3-body-search-live-gate.test.ts:112,122,350,380,1091`. `story-39-4-qa-live-gate.test.ts:201,215` copies `succeeded`/`route` again. `story-39-4-qa-process.test.ts:124,267,632` (`startStub`, `session`, `searchEntries`) copies `story-39-3-qa-process.test.ts:103,222` [packages/iris-mcp-all/src/__tests__/story-39-4-search-table-live-gate.test.ts] — deferred: the adjudicated root cause DW-561 (routed to `39-6-message-forensics-docs-prompt-and-capstone`, which promotes one helper set into `process-gate-helpers.ts` and moves the gates onto it). An occurrence and a note naming the 39.4 copies were appended. Fix-risk med (five armed gate files).
- [x] [Review][Defer] (medium) `searchTable` matches only headers whose body class is exactly `DOCCLASS`. Indexed bodies of a `DOCCLASS` subclass are left out, including from `ne` and `isNull`, unless `bodyClass` names that subclass. IRIS's own `SearchHeader` and the Message Viewer match subclasses [src/ExecuteMCPv2/REST/MessageSearch.cls:996] — deferred: DW-580 `by-design` (Design Notes I7 and Boundaries "it then replaces DOCCLASS"; documented in the description). It reopens only by spec amendment.
- [x] [Review][Defer] (low) No test drives `SearchTablesConfigured` to a SQL failure [src/ExecuteMCPv2/REST/MessageSearch.cls:474] — deferred: DW-581 `wontfix-accepted`. A failure inside an Interoperability namespace needs a privilege-limited user (no security changes on the shared instance) or a test seam. The review's order mutation showed a prepare-time failure (-30) surfacing as an error.
- [x] [Review][Defer] (low) AD-12's list of IRIS-side exceptions does not name value normalization (`SearchTableValue`) [src/ExecuteMCPv2/REST/MessageSearch.cls:489] — deferred: DW-582 `wontfix-accepted` (spec I4 records the basis: the PropType is read in the same handler, in one round trip; the spine wording is the lead's).

**Rejected:**
- `false`: the exact tool-count pin in `story-39-4-doc-claims.test.ts:227` "will break in 39.5". That red is the designed shared-surface signal: 39.5 updates every count pin, as it does the identical 39.1–39.3 pins, and the pin is how AC-6's "no tool count moves" is proven.
- `false`: "three AC pins have no `mutation:` line". Rule 19 scopes one demonstrated mutation per AC, and AC-2, AC-6 and AC-7 each carry recorded mutation lines (the `block` fall-through and `dataPolicy.actions`; the `BodyStatement`/`%INORDER` rows; the scope row and the default-state sentence).
- `low`: the PHI data-policy scope date (`as of 2026-10-16`) predates the 39.4 row. The date names the Rule #56 enumeration scan, which 39.4 (no new tool) did not redo. Moving it renames the section anchor that the README links and two Story 39.2 pins hold, and 39.5's new tool forces a re-scan anyway.
- `low`: an empty single-valued Integer, Numeric or Boolean item is stored as `0`, so `notNull` counts it. This is IRIS's own storage, and the Message Viewer answers the same. No stock Search Table has such a property, and refusing `isNull`/`notNull` there contradicts the Design Notes op matrix.
- `low`: X12 batch child entries are not matched through `TopParentId`. This is spec-bound: Never says "never follow batch `TopParentId` links (I7)".
- `low`: a non-Latin-1 value of about 220 to 256 characters can exceed the `indexDocId` subscript budget (SQLCODE -490). That is not a realistic Search Table lookup value, the error is a fixed text with no echo, and a byte budget adds a branch.
- Rejected (the fix is a spec edit): the Never line names only two changed texts, while the spec also requires `searchTableClass` to be refused on `headers` and `body`. The code follows the explicit Always rule and the CHANGELOG names it. The name was proven absent before 39.4, so no older request carries it (AD-33).
- `low`: the QA live gate uses a fifth disposable namespace, `EXECMCPTMP394Q`. It creates and removes it with nothing-left assertions (spine "Live testing on a shared instance": namespaces the story creates). Its HSCUSTOM part is the patched medium above.

## Spec Change Log

- **2026-10-17, implement stage (Rules #16, #42): three claims verified live and amended in place.**
  1. *I4, a long value.* The spec said the query value is not truncated and the docs state the storage truncation. Probe: an `eq`, `ne` or `startsWith` lookup by a value of about 440 characters or more fails at run time with SQLCODE -490 (the `indexDocId` subscript is too long); `contains` and the range operators run. So a Search Table value longer than 256 characters (all a Search Table stores) is refused naming `filters[i].value`, after the property and the operator of the same filter; I4 below says so. The Zod node and `BodyFilterShape` are unchanged (the shared grammar still allows 1024); the check is `SearchTableFilterWhere`'s, with `Parameter MAXSEARCHTABLEVALUE`.
  2. *I5, `%EXACT`.* The spec expected the plain `PropValue` column to ignore case. On this instance the column's default collation is EXACT, so `=`, `[` and `%STARTSWITH` already compare exactly and `%EXACT` changes no result here (Task 0 (d)). The clause table is kept (it is correct under a SQLUPPER default, and the unit test pins its text), but the matrix facts that distinguish `%EXACT` from the plain column (`MSHControlID eq`: header 2 appears without it) cannot be shown live on this instance.
  3. *`SearchTablesConfigured() As %Boolean`.* A boolean cannot carry the error status the spec asks for. The method keeps its signature and throws on a SQL failure, which the handler's Catch answers with an error, so a failure never reads as `notApplicable`.
- **2026-10-17, review pass (finding: the 256-character rule ran after the namespace switch).** Triggering findings: Blind Hunter, Edge Case Hunter and the intent auditor each filed that item 1 above put a pure shape rule after the switch, against AD-13 and the contract's "every shape rule runs before the namespace switch". Amended: item 1's check is now `SearchTableShape` (`BodyFilterShape` for `searchTable` plus the 256-character rule), called by the route before the switch and again by `SearchTableFilterWhere`; it runs before the property and the operator, so it names `filters[i].value` first. Known-bad state avoided: a 257-character value aimed at a namespace with no Search Table answered `notApplicable`, and at a missing namespace a `<NAMESPACE>` error. KEEP: the limit, its text, `Parameter MAXSEARCHTABLEVALUE`, and `BodyFilterShape` untouched so the `body` and `headers` behavior stays byte-identical.

## Review Triage Log

### 2026-10-17 — Review pass
- verdicts: 39 findings — high 0, medium 5, low 30, false 4, maybe-false 0
- findings:
  - `[low]` `[reject]` Blind Hunter: a non-numeric value on an Integer, Numeric or Boolean property becomes `0` (and `1E400` raises `<MAXNUMBER>` into the generic `filters could not be read` error) — the generator stores `+v\1` of a non-numeric source value as `0` too, so `eq "abc"` finds exactly the messages stored as `0` (spec I4: normalized exactly as stored); the overflow error is safe and echoes nothing; a refusal would depart from the stored form, no realistic custom property reaches it.
  - `[medium]` `[patch]` Blind Hunter: the 256-character value limit is enforced late (after the namespace switch and the `SearchTablesConfigured` check) and only IRIS-side, against the CHANGELOG's "every shape rule runs before the namespace switch" — verified: `SearchTableFilterWhere` held the check; a 300-character value aimed at a namespace with no Search Table answered `notApplicable`. Patched: `SearchTableShape` called before the switch (`MessageSearch.cls`), two refused-shape live rows aimed at the missing namespace, `MessageSearchTableTest` assertions; mutation recorded.
  - `[low]` `[reject]` Blind Hunter: the property grammar `^[A-Za-z][A-Za-z0-9]*$` is reused for `searchTable`, so a custom name with `_`, `.` or `-` is listed by the refusal but cannot be queried — decided in Design Notes I1 (every stock name is alphanumeric); `reopen_if` a real Search Table class uses another character.
  - `[low]` `[reject]` Blind Hunter: no `%UnitTest` covers the accepted path of `SearchTableFilterWhere` or the route-level refusals — Task 7 fixes the class's five data-free methods; the accepted path and every route refusal are pinned by the live gate against a hand-written oracle, listed in the prepublish gate; the route texts were tightened under the verification-gap row below.
  - `[low]` `[patch]` Blind Hunter: the op-refusal text of `SearchTableFilterWhere` holds an unreachable `$Select(tPropType = "": ...)` branch, and an empty PropType would not be lower-cased — the branch is dead (only Integer, Numeric and Boolean fail `SearchTableOpAllowed`): removed. An empty PropType is not reachable: the probe stored a property with no `PropType` attribute (`Story394Empty`) lower-cased, and `SearchTableValue` mirrors the generator's default for `""`.
  - `[low]` `[patch]` Blind Hunter: `SearchTableClass` collapses every failure into one text that omits the "exact name" rule — text now says "the exact, case-sensitive name"; `TestSearchTableClassSystemClasses` pins it.
  - `[low]` `[reject]` Blind Hunter: the live gate asserts wall-clock budgets on a shared instance — the budgets are the spec's own Verification (60 s first start, 2 s lookup) and the observed times (1.2 s, 0.1 s) leave a 20x margin or more; the same pattern is in the accepted 39.1 and 39.3 gates.
  - `[low]` `[patch]` Blind Hunter: the live gate's header comment lists two rows of about ten — the list now names every row group.
  - `[low]` `[patch]` Blind Hunter: `story-39-4-doc-claims.test.ts` pins `Last re-measured at Story 39.4` literally, which turns red when a later story re-measures — now a `Story 39.x` pattern with a floor of 4, as the 39.1 pin is.
  - `[low]` `[patch]` Blind Hunter: the CHANGELOG says every `headers` and `body` request answers byte for byte as before, but the capture omits the sanctioned changes and `searchTableClass` is now refused off its action — reworded to "every request in the capture list ... the requests changed above are the exceptions".
  - `[low]` `[reject]` Edge Case Hunter: same property-grammar finding as above (Edge Case Hunter filed it independently) — by-design, Design Notes I1.
  - `[medium]` `[patch]` Edge Case Hunter: a value of 257 to 1024 characters passes the pre-switch shape check — same root cause as the late 256 rule above (grouped).
  - `[low]` `[reject]` Edge Case Hunter: non-numeric or overflowing value on an Integer, Numeric or Boolean property — same as the first row: mirrors the stored form.
  - `[false]` `[reject]` Edge Case Hunter: a property whose PropType is empty would keep a mixed-case value though the text says default properties ignore case — disproved at the generator (`irislib/Ens/VDoc/SearchTableGenerator.cls`: only the four named types are changed, so `""` stores unchanged and `SearchTableValue` does the same), and every `SearchTableProp` row the probes read carried an explicit type, including a property declared with no `PropType` attribute.
  - `[low]` `[reject]` Edge Case Hunter: headers whose body class is a strict subclass of the document class are not matched when `bodyClass` is omitted — decided in Design Notes I7 (headers match the `DOCCLASS`; `bodyClass` replaces it) and stated in the tool description and both READMEs; `reopen_if` a deployment indexes subclass bodies through the base Search Table.
  - `[low]` `[reject]` Edge Case Hunter: many distinct statement shapes could bloat the statement cache — the shapes are a closed set (the clause kinds times the filter count of at most 10) and every value is a parameter; no realistic unbounded growth.
  - `[medium]` `[patch]` Edge Case Hunter: claim — "every shape rule runs before the namespace switch" (CHANGELOG and AC-1) is false for the 256-character rule — same root cause as the late 256 rule (grouped); the claim is now true.
  - `[low]` `[patch]` Edge Case Hunter: claim — the CHANGELOG says `BodyStatement` gains optional parameters, but its signature is unchanged and an empty body table now selects a table-less statement — reworded.
  - `[medium]` `[patch]` Verification Gap: the `bodyClass` "replaces the document class" behavior is never exercised with a class different from the document class — verified: deleting `Set tHeaderClass = tBodyClass` left every row green. Patched: fixture class `Story394.SubMessage` (a strict subclass no header carries), a live row expecting no rows for it, `BodyClassExtends` assertions over system classes in `TestSearchTableClassSystemClasses`; mutation recorded.
  - `[low]` `[reject]` Verification Gap: Numeric, Boolean and DateTime handling is pinned only by an `%UnitTest` class that no automated host runs — no `ExecuteMCPv2.Tests.*` class has a host (they run through `iris_execute_tests`, recorded 5/5 here), and no stock Search Table has such a property; pre-existing project convention. `reopen_if` a stock Search Table gains a Numeric or Boolean property.
  - `[low]` `[patch]` Verification Gap: the route-level refusal texts (`action` list, `filters` on `headers`, `searchTableClass` off its action, the default `body` text) are pinned by token only — tokens tightened to the exact text in the 39.1 gate, the 39.4 gate and `MessageSearchTest`, plus a body-without-filters route row; four mutations recorded.
  - `[low]` `[patch]` Verification Gap: the 50-name cap and `and N more` of `PropertyNames` are untested — assertions for 0, 50 and 51 names added to `TestSearchTableStatementText`.
  - `[low]` `[patch]` Verification Gap, other findings: the CHANGELOG back-compat sentence overstates the capture — same as the Blind Hunter row (grouped).
  - `[low]` `[patch]` Verification Gap, Rule 19: the "facts that tell the operators apart" row compares the gate's own constants and cannot fail on the code — removed; each operator row already asserts its hand-written ids against the oracle.
  - `[low]` `[patch]` Verification Gap, Rule 19: the unit row that checks no `searchTableClass` is sent on `headers` and `body` loops over calls with no count — `toHaveBeenCalledTimes(2)` added.
  - `[low]` `[reject]` Verification Gap, Rule 19: the `MSHControlID` rows cannot vary with `%EXACT` here — recorded in Spec Change Log item 2 (the column's collation is EXACT on this instance); the unit text and the plan row's per-call fragment pin `%EXACT`.
  - `[low]` `[reject]` Verification Gap, Rule 19: the plan checker's own meta-test sits behind the live skip guard, so an unarmed run never runs it — `story-39-1-gate-guards.test.ts` pins that an unarmed run of a live gate skips every test (removing the guard turned that guard test red), and every armed run, which the prepublish gate requires, executes it.
  - `[low]` `[reject]` Verification Gap, Rule 19: `MessageSearchTableTest` has no executed test host — same as the Numeric/Boolean row (project convention, run per class through `iris_execute_tests`).
  - `[low]` `[reject]` Verification Gap, Rule 19: `fuzz-corpus.ts`, `searchTableOracle` and the seeds execute only inside the armed gate — they are live-gate helpers; the gate is in `gateTestFiles` and guarded by `story-39-1-gate-guards` (Rule #59 live-gate convention).
  - `[low]` `[patch]` Verification Gap, Rule 19: pinning tests without a `mutation:` line (`bodyClass` narrowing, paging, the AND join, `searchTablesConfigured:false` in the tool, `searchTableClass` off its action, the Zod `.max(220)`, the policy line tail, the route texts) — twelve mutations applied (five on the route and the shape rule, three on the lookup, four on the tool), observed red and reverted, lines written under Verification.
  - `[low]` `[reject]` Verification Gap, Rule 19: the audit row reads stderr right after the audit entry returns — the pattern the accepted 39.3 gate uses; the file entries decide the audit assertions and a late stderr line cannot turn a present marker into a pass of the allow-policy positive control.
  - `[low]` `[reject]` Verification Gap, Rule 19: wall-clock budgets — same as the Blind Hunter budget row.
  - `[medium]` `[patch]` Intent Alignment: the 256-character cap is not in the contract and ran after the namespace switch — same root cause (grouped); the cap itself is the documented Spec Change Log item 1.
  - `[low]` `[reject]` Intent Alignment: every live lookup uses the HL7 extent and no lookup runs against an XML Search Table — the contract's fixtures and matrix are HL7; `EnsLib.XML.SearchTable` resolution is pinned over the dictionary; `reopen_if` a lookup on a non-HL7 table misbehaves.
  - `[low]` `[reject]` Intent Alignment: the full `searchTable` path of `MessageSearch()` has no `%UnitTest` — same as the Blind Hunter row (live gate is the pinning surface by Task 12).
  - `[false]` `[reject]` Intent Alignment: the route's `searchTablesConfigured` field is not named by the contract — Task 6 of the spec names it and the contract's `notApplicable` row is satisfied by it.
  - `[low]` `[reject]` Intent Alignment: the `INFORMATION_SCHEMA.STATEMENTS` plan check pins IRIS 2026.2 plan wording — Task 12 requires the plan row; a wording drift on a later IRIS version is the intended signal.
  - `[false]` `[reject]` Intent Alignment: step 5 of the validation order is evaluated per filter, not all properties first — the contract says "each filter's property, then its operator"; no test or rule contradicts per-filter order.
  - `[false]` `[reject]` Intent Alignment: earlier stories' gates and unit tests were edited — Task 13 and the Code Map name each of them.

## Design Notes

**Plan-time interpretations** (apply and report):
- **I1. The input reuses the 39.3 `filters` grammar.** It takes 1 to 10 AND conditions, and one condition is exactly AC 39.4.2's "a property name, a value and an operator". This reuses `BodyFilterShape`/`FilterShape`, the Zod node, `BODY_FILTER_OPS` and `phiInputs: ["filters"]`. So 39.4's "Search Table `value`" is already redacted, and no new `phiInputs` entry or top-level `value` key exists. The property shape stays `^[A-Za-z][A-Za-z0-9]*$`: every stock Search Table property name is alphanumeric (`irislib` scan, 2026-10-17). A custom name with other characters is refused, with `reopen_if` a real Search Table using one.
- **I2. Only virtual-document Search Tables.** AC 39.4.2 validates properties against `SearchTableProp` rows. `Ens.CustomSearchTable` subclasses have none (their properties are ordinary columns), so they are refused naming `searchTableClass`, and the description says so.
- **I3. The property resolves through `getPropsList(searchTableClass)`**, IRIS's own lister, which the Message Viewer also uses. It is not an extent-wide `getPropId`. So a property defined only by a subclass is not a property of the base class (the `Story394Int`-via-ST row).
- **I4. Value normalization mirrors storage**, from `SearchTableGenerator` :224-249. This is IRIS-side under AD-12 because the PropType is read in the same handler and no IRIS API exposes the normalization. Without it, `contains` on a case-insensitive property and `eq "0007"` on an Integer property could never match. The query value is not truncated; a value longer than 256 characters, all a Search Table stores, is refused naming `filters[i].value` (Spec Change Log, 2026-10-17). The docs state the storage truncation.
- **I5. `String:CaseSensitive` compares exactly (`%EXACT`).** This honors the documented PropType ("Normalize case for this property type when storing and querying"). The Message Viewer's plain `PropValue` uses the default collation; Task 0 (d) records that behavior, which on this instance is EXACT too (Spec Change Log, 2026-10-17).
- **I6. `ne`, `isNull` and `notNull` are defined over entries** (Clauses). This matches the Message Viewer's `NOT IN` for negative operators, which "allows exclusion of rows with multiple values where one value matches". A uniform `EXISTS … <> ?` would match m2 for `ne MRN-1` through its other identifier.
- **I7. Headers match the Search Table's `DOCCLASS`** (`h.MessageBodyClassName = ?`), because DocIds are IDs of the document extent (ID collision, header 7). `bodyClass` may narrow it to a subclass. Batch `TopParentId` association, which X12 tables can carry and the HL7 table does not, is not followed.
- **I8. Header-first for every operator (`%INORDER`)**, as in 39.3 (I8 there, AD-20). The planning-time EXPLAIN (below) shows that without it, or with `%NOFLATTEN`, IRIS may read every entry of the property once, a scan the window does not bound. An `eq` lookup driven from the search table would be faster on a busy namespace, but it is not window-bounded for the other operators. The header-scan cost stays with DW-572 (escalated, burn-down).
- **I9. Range operators, `contains` and `startsWith` are refused on Integer, Numeric and Boolean properties.** Their values are stored as text, so a range would compare `"10" < "9"`, and a substring of a normalized number is meaningless.
- **I10. `notApplicable` means "no `SearchTableProp` row in the namespace", and it is checked before the class.** It is a real state: HSCUSTOM, an Interoperability namespace on this instance, has 0 rows (probe 2026-10-17). A namespace that `EnableNamespace` set up gets rows for the stock tables through `deploySearchTables`, and our mapping-only scratch namespaces get none until a Search Table class is compiled.

**Clauses** (`SearchTableClause`; `<t>` is the extent table, `<i>` is the filter index; `<col>` is `%EXACT(s<i>.PropValue)` for `String:CaseSensitive`, else `s<i>.PropValue`):

| op | Clause | Parameters |
| --- | --- | --- |
| `eq lt le gt ge contains startsWith` | `EXISTS (SELECT 1 FROM <t> s<i> WHERE s<i>.DocId = h.MessageBodyId AND s<i>.PropId = ? AND s<i>.PropValue <> '' AND <col> <BodyOpSql(op)>)` | PropId, value |
| `ne` | `NOT EXISTS (SELECT 1 FROM <t> s<i> WHERE s<i>.DocId = h.MessageBodyId AND s<i>.PropId = ? AND <col> = ?)` | PropId, value |
| `notNull` | `EXISTS (SELECT 1 FROM <t> s<i> WHERE s<i>.DocId = h.MessageBodyId AND s<i>.PropId = ? AND s<i>.PropValue <> '')` | PropId |
| `isNull` | `NOT EXISTS (SELECT 1 FROM <t> s<i> WHERE s<i>.DocId = h.MessageBodyId AND s<i>.PropId = ? AND s<i>.PropValue <> '')` | PropId |

`''` is the StoreNulls empty marker (SQL's empty string), so it never matches a value operator or `notNull`.

**PropType** (`SearchTableValue`, then `$Replace(…, "|", "+")`; `SearchTableOpAllowed`):

| PropType | Value as bound | Ops |
| --- | --- | --- |
| `String:CaseInsensitive` (the default) | `$ZCVT(v, "L")` | all ten |
| `String:CaseSensitive`, `DateTime:ODBC`, `DateTime:HL7` | `v` | all ten |
| `Integer` | `+v\1` | `eq ne isNull notNull` |
| `Numeric` | `+v` | `eq ne isNull notNull` |
| `Boolean` | `$Case($ZCVT(v,"L"), "true":1, "yes":1, "on":1, :''v)` | `eq ne isNull notNull` |

An unknown PropType is treated as `String:CaseSensitive`, the generator's fallthrough.

**Search Table class** (`SearchTableClass`): it must meet all of these, or it is refused naming `searchTableClass` with a fixed text:
- `%Dictionary.CompiledClass` opens it, its `Name` equals the input, `ClassType` is `persistent`, it is not `Abstract`, and `%Extends("Ens.VDoc.SearchTable")` is 1;
- `GetExtentSuperclass` is not empty, and `BodyTable` of that root succeeds;
- `$Parameter(class, "DOCCLASS")` names a compiled class.

**The statement** (`BodyStatement("", …)`):
```
SELECT TOP ? h.ID, h.SessionId, …(COLUMNS, h.-qualified)
FROM %INORDER Ens.MessageHeader h
WHERE <HeaderWhere alias h, bodyClass = DOCCLASS or bodyClass> AND <clause 0> AND … AND <clause n>
  [AND (h.TimeCreated > ? OR (h.TimeCreated = ? AND h.ID > ?))]
ORDER BY h.TimeCreated, h.ID
```
Planning-time EXPLAIN (HSCUSTOM, plan only, no rows, `iris_sql_analyze`, IRIS 2026.2 build 221U, untuned):
- With `%INORDER`, the plan reads `Ens.MessageHeader(H).TimeCreated` with a range, intersects the `MessageBodyClassName` bitmap, and reads `IDKEY`. It then tests each `EXISTS`/`NOT EXISTS` "calling Subquery-…", each "Read index map EnsLib_HL7.SearchTable(S0).indexDocId, using the given S0.DocId and S0.PropId".
- With `%NOFLATTEN` and no `%INORDER`, the positive `EXISTS` became "Call Module-E once … Read master map EnsLib_HL7.SearchTable(S0).indexValue, using the given S0.PropId, and looping on S0.PropValue": the whole property, regardless of the window.
- `SELECT DISTINCT` over a join was rejected: its temp file holds `%SQLUPPER(SourceConfigName)`, etc., which would change the row values.

**Fixture sources** (compiled inside A or B).
- `Story394.SearchTable Extends EnsLib.HL7.SearchTable` (A). Its `XData SearchSpec [ XMLNamespace = "http://www.intersystems.com/EnsSearchTable" ]` adds `<Item DocType="" PropName="Story394Int" PropType="Integer">[PID:1]</Item>` and `<Item DocType="" PropName="Story394Empty" StoreNulls="true">{2:6}</Item>`. StoreNulls applies only to a non-list expression, hence `{2:6}`.
- `Story394.SearchTableB Extends EnsLib.HL7.SearchTable` (B) adds `<Item DocType="" PropName="AOnlyInB">{2:7}</Item>`. It is compiled before any other Search Table work in B.
- `Story394.Seed.Seed(pSet)`:
  - It is guarded to `$NAMESPACE ? 1"EXECMCPTMP394"1U` and refuses a namespace that already holds headers.
  - It builds each message's ER7 text (CR terminators; segments MSH, PID, PV1) from the matrix, saves it with `##class(ExecuteMCPv2.Temp.Story391Fixture).SaveHl7`, and indexes it with `$ClassMethod(<A: Story394.SearchTable | B: Story394.SearchTableB>, "IndexDoc", msg)` (A skips m6). A failed `IndexDoc` status is returned as `ERROR: …`.
  - s1 is `SaveString("SYNTHPHI394-MRN-1")`. Headers come through `Story391Fixture.Add`, with sessions 394000 + n.
  - It returns a JSON ID map. The gate asserts s1's ID equals m1's, the positive control of the collision row.
- `Story393.Side` (A, `STORY393_SIDE_SOURCE` as is) is the fuzz side-effect probe.

**The fuzz** (36.4/39.3 style; route-direct in A; one filter per request over W; `fuzz-corpus.ts` tokens; every random property and op input embeds `SYNTHPHI394`).
- **Property slot:** a fixed corpus plus 200 random names, with `op:"notNull"` and ST4. The corpus is the seven configured names, `patientid`, `PATIENTID`, `PropValue`, `PropId`, `DocId`, `ID` and `Name`. A name is expected to be accepted only when it is in the test's hand-written list, checked first against an `Ens_Config.SearchTableProp` read in A.
- **Op slot:** a fixed corpus plus 100 random ops, on ST `PatientID`. The corpus is `EQ`, `=`, `like`, `in`, `between`, `[`, `%STARTSWITH` and `eq OR Story393.Side_Bump()=1`.
- **Value slot:**
  - 300 random strings on ST `MSHControlID` (exact) with `eq`, `ne`, `contains` and `startsWith`. Half are copies or substrings of the five stored control IDs. The expected header ids come from TS evaluation over those stored values (with `|` mapped to `+`), mapped to τ's headers; `ne` is the complement over the HL7 headers in W (1, 2, 3, 4, 5, 6, 8, 10).
  - 100 random strings on ST `PatientID` with `contains` against the stored lowercased identifiers (the needle lowercased, `|` mapped to `+`).
- **Oracles:**
  - `sideCount` is 0 after the run, and the positive control (`SELECT Story393.Side_Bump()`, then `resetSide`) runs first;
  - results equal the expected ids;
  - refusal texts name `filters[0].property` or `filters[0].op`;
  - no raw response contains `SYNTHPHI394`.

  The test collects violations, prints the first five, and asserts the list is empty.

**The capture list** (raw REST, explicit `to`).
- `headers` against A:
  - W alone, and W with each of `bodyClass:"EnsLib.HL7.Message"`, `target:"Story394.Other"` and `errorOnly`;
  - `limit:2`, pages 1 and 2;
  - the refusals: no `from`, a window over 7 days, and `limit:0`.
- `body` against A: `EnsLib.HL7.Message` `RawContent contains "SYNTHPHI394-MRN-1"`, `bodyClass:"No.Such.Story394Class"`, `filters:[]`, and property `Nope`.
- Against C: `headers` W alone, and the same `body` search.
- Excluded, as the sanctioned changes: the `action` and `filters`-on-`headers` refusal texts.

**Competitor mapping** (AC 39.4.1; `research/competitive-…-2026-10-14/digests/teardown-r1-3-interop.md:31`, source [15]).
- Theirs takes `search_table{prop, value|value_like, class?, extent?}` (default extent `EnsLib.HL7.SearchTable`). It resolves PropIds from `Ens_Config.SearchTableProp`, JOINs the extent on `st.DocId = h.MessageBodyId`, and its errors list the searchable properties.
- Ours maps:
  - `class`/`extent` → `searchTableClass` (required; the extent root comes from the dictionary);
  - `prop` → `filters[].property`;
  - `value` → `eq`;
  - `value_like` → `contains` / `startsWith` (no wildcards).
- Ours adds AND conditions, `ne`, `isNull`/`notNull`, PropType normalization, an exact case-sensitive compare, the document-class predicate, a header-first plan, and bound values. The competitor builds generated code from the input. Property refusals list names, as theirs do.

**Extend, don't copy (Rule 2).**
- **Extended:**
  - `BodyFilterShape` (`pAction`), `BodyTable` (`pParam`), `BodyStatement` (no body table), `BodyOpSql`, `HeaderWhere`, `AliasedColumns`, `HeaderRow`, `ReadString`;
  - the handler's body branch (the policy gate, the required checks, the policy line), `refusalResult`, `effectiveDataPolicy`, the cursor and `mapHeaderRow`;
  - `seedBodySearch`, through a shared helper; `bodyJoinOracle` (a sibling, `searchTableOracle`, in the same module);
  - `FUZZ_TOKENS`/`fuzzText`, moved into `fuzz-corpus.ts`; `mulberry32`; `STORY393_SIDE_SOURCE`, `sideCount`/`resetSide`, `docFixtures`, `executeMcpPost`, `atelierQuery`, `openWireSession`;
  - `GATES` and `gateTestFiles`.
- **Siblings, with reasons:**
  - `MessageSearchTableTest` is a new class: `MessageBodySearchTest` plus five methods would pass ~500 lines.
  - The 39.4 plan checker is new: `planProblems` (39.3 QA) hard-codes `Story393.QaBody` and the body join, while this statement has no join and correlated subqueries.

**Integration (Rules 1 and 2).**
- **Integration ACs:** AC-5, plus the matrix's oracle, policy and audit rows, against the real instance.
- **Consumes:**
  - 39.1: the tool, route, `HeaderWhere`, `HeaderRow`, `COLUMNS`, the cursor and `interop-namespace-fixture.ts`;
  - 39.2: `DATA_POLICY_BLOCKED`, `effectiveDataPolicy`, `ToolDefinition.dataPolicy`, the audit plumbing and the scope table;
  - 39.3: `BodyOpSql`/`BODY_FILTER_OPS`, `BodyFilterShape`, `BodyTable`, `BodyStatement`, the `filters` schema, the block-refusal pattern, the fuzz harness and `header-row-oracle.ts`;
  - 39.0: the env harness.
- **Consumed-by:**
  - 39.5: header ids from lookup rows;
  - 39.6: capstone step 3 ("Search Table lookup finds it"), the new patient-lookup prompt, and the docs enrichment.

**Ledger inbox (Rule 17):** none (the slice for `39-4-search-table-lookup` is empty).

**Governing ADs.**
- **AD-26:** the binding AD: structured filters, IRIS-side validation, the closed operator enum, bound values, the route-direct fuzz, the policy and the scope row.
- **AD-12:** the IRIS-side exception for identifiers and operators the handler builds; normalization (I4) is part of building a correct statement in one round trip. **AD-20:** the window bound and header-first (I8).
- **AD-19:** `phiInputs`, `outcome` and no echo. **AD-9 and AD-3:** the per-profile policy through `ctx.config`.
- **AD-11 and AD-13:** the envelope, and validation before the switch. **AD-14:** the bootstrap move.
- **AD-15 and AD-33:** the capture pin and the additive route. **AD-4:** no new key; the annotations stay truthful.
- **AD-5:** `:check` only. **AD-29:** minor changesets.
- **Conventions:** Tool descriptions, Tool results (a new input name proven absent: `searchTableClass` has zero hits as of 2026-10-17), Refusals, Error text, Logging, Live gates, Live testing on a shared instance, Probes, Performance budgets.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- MCP calls name `server:"default"`, with namespace `HSCUSTOM` or one of this story's `EXECMCPTMP394*` namespaces.

**Step C: capture** (once, after Task 0 items 2–5 and before Task 1).
- Build shared, dev, admin and interop from the unchanged sources, and confirm the deployed version is `f7b0868c95d0`.
- Then run `ENV STORY_39_4_CAPTURE=1 pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-4-search-table-live-gate.test.ts -t capture`.
- The fixture is never edited by hand.

**Shared surfaces:** these change, and other tests assert on them.
- The `iris_message_search` description and schema (the payload rows), and its `dataPolicy` declaration.
- The searchTable / `NOT_IMPLEMENTED` rows of `message-search.test.ts`, `message-search-governance.test.ts`, `message-search-body.test.ts`, the 39.1 gate, the 39.3 gate, `story-39-3-qa-process.test.ts` and `MessageSearchTest`.
- The `filters`-on-`headers` texts.
- The scope table, its test and `tool_support.md`.
- The README refusal, policy and governance rows, and the 39.1/39.3 doc pins on them.
- `BOOTSTRAP_VERSION`: every armed gate redeploys.
- `gateTestFiles` and `story-39-1-gate-guards`; `fuzz-corpus.ts` (the 39.3 gate's fuzz).

Standing criterion: every test added or changed passes on a fresh environment, in either order.
- The gate creates and removes all its own state: `EXECMCPTMP394A`, `EXECMCPTMP394B` and `EXECMCPTMP394C`, the `Story394.*` and `Story393.Side` classes inside them, `^Story393Side`, `ExecuteMCPv2.Temp.Story391Fixture`, and the temp files. Task 0 uses `EXECMCPTMP394P`, which is removed.
- OS classes run one class per `iris_execute_tests` call, and `total` is compared with the `Test*` count (Rule #35).

**Commands:**
- `(once)` Build shared, then dev, admin, interop, ops, data and client-config, one command each. Run Task 0 and Step C.
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/bootstrap.test.ts src/__tests__/refusals.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/interop build && pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/message-search-table.test.ts src/__tests__/message-search-body.test.ts src/__tests__/message-search.test.ts src/__tests__/message-search-governance.test.ts src/__tests__/index.test.ts src/__tests__/presets.test.ts` -- expected: pass.
- `(loop)` Run each of these in its own call. First, after the first armed run deploys the new version, `iris_doc_load` `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/MessageSearchTableTest.cls` (HSCUSTOM). Then `iris_execute_tests`:
  - `ExecuteMCPv2.Tests.MessageSearchTableTest` -- expected: total 5, 0 failed;
  - `MessageBodySearchTest` -- expected: 5;
  - `MessageSearchTest` -- expected: 5;
  - `MessageResendTest` -- expected: 12;
  - `MessagePreviewPolicyTest` -- expected: 4.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-4-search-table-live-gate.test.ts` -- expected: pass armed, nothing left. Then, one per call, the 39.3 gate, the 39.3 QA live gate, the 39.1 gate and the 39.2 gate -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/data-policy-scope.test.ts src/__tests__/story-39-4-doc-claims.test.ts src/__tests__/story-39-3-doc-claims.test.ts src/__tests__/story-39-1-doc-claims.test.ts src/__tests__/story-39-2-doc-claims.test.ts src/__tests__/story-39-1-gate-guards.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/story-39-3-qa-process.test.ts` -- expected: pass.
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one command each: `build`, `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism`, then `ENV pnpm --filter @iris-mcp/all test` -- expected: green.
- `(once)` A second `pnpm gen:bootstrap` -- expected: no diff. Also `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check`, `node scripts/check-epics-sync.mjs` and `pnpm measure:tools-payload` -- expected: OK, and the README rows equal the output.
- `(once)` Performance: the first armed bootstrap (budget 60 s), one lookup of A over W (budget 2 s), and the fuzz's wall time (recorded).
- `(once)` After every armed run:
  - `leftovers` for the four `EXECMCPTMP394*` names is `[]`;
  - `iris_namespace_list` and `iris_database_list` show none of them;
  - `iris_doc_list` (HSCUSTOM, `Story393`, `Story394` and `ExecuteMCPv2.Temp.`, generated included) is empty.

**Planned mutations (Rule 19).** For each: apply it, observe red, revert, rebuild any dist and reload any class, and confirm that `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> -> <red test>`.

| AC | Mutation | Expected red |
|---|---|---|
| AC-1/AC-3 | `SearchTableFilterWhere` writes the value as a quoted literal instead of `?` (reloaded) | the fuzz (side-effect or result oracle); `TestSearchTableClause` |
| AC-1/AC-3 | an op outside the map passes through as written | the fuzz op slot; `TestSearchTableClause` |
| AC-1/AC-3 | the property resolution bypassed: the caller's text is bound as the PropId, or emitted as a literal | the fuzz property slot; the refused-property rows |
| AC-1 | the shape checks of `searchTable` called after the switch | the refused-shape rows (a namespace error appears instead) |
| AC-2 | `block` falls through to the HTTP call for `searchTable` | the unit no-call row; the live `EXECMCPTMP394Z` block row |
| AC-2 | `searchTable` dropped from `dataPolicy.actions` | the definition row; the audit rows (no `dataPolicy`) |
| AC-2 | a search-table column added to the select list | `TestSearchTableStatementText`; the plan row |
| AC-4 | `SearchTableValue` returns the value unchanged | the `contains "MRN-1"` row; `Story394Int "0007"`; `TestSearchTableValue` |
| AC-4 | `%EXACT` dropped for `String:CaseSensitive` | the `MSHControlID eq` row (header 2 appears) |
| AC-4 | the `<> ''` term dropped | the `Story394Empty notNull` row (headers 1, 3, 4, 5 and 10 appear) |
| AC-4 | `ne` as `EXISTS … <> ?` | the `PatientID ne` row (header 2 appears) |
| AC-4 | the document-class header predicate dropped | the MRN row (header 7 appears) |
| AC-4 | `getPropsList` replaced by an extent-wide `getPropId` | the `Story394Int`-via-ST refused-property row |
| AC-4 | `SearchTablesConfigured` skipped | the C rows (a class or property refusal instead) |
| AC-4 | `SwitchNamespace` skipped | the A-against-B row |
| AC-6 | `BodyStatement` emits the no-table form for a body table, or `BodyFilterShape`'s default text names searchTable | the 39.4 capture replay; the 39.3 replay; `MessageBodySearchTest` |
| AC-6 | `%INORDER` dropped from the no-table statement | the plan row (statement text); `TestSearchTableStatementText` |
| AC-7 | the scope row back to `["body"]` | `data-policy-scope.test.ts` |

### Implementation results (2026-10-17)

**Task 0 probes** (IRIS for UNIX (Ubuntu Server LTS for ARM64 Containers) 2026.2 (Build 221U) Fri Jun 26 2026 09:59:12 EDT; namespace `EXECMCPTMP394P`, built mapping-only like A and removed afterwards).
- **(a)** `Story394.SearchTable Extends EnsLib.HL7.SearchTable` compiles in a mapping-only namespace (no HALT).
  - `Ens_Config.SearchTableProp`, all rows `ClassExtent` `EnsLib.HL7.SearchTable`; PropIds are assigned in name order: `MSHControlID` 1 (`String:CaseSensitive`), `MSHTypeName` 2 (`String:CaseInsensitive`, Unselective), `PatientAcct` 3, `PatientID` 4, `PatientName` 5, `Story394Empty` 6 (`StoreNulls` true), `Story394Int` 7 (`Integer`). The five stock rows have `ClassDerivation` `EnsLib.HL7.SearchTable`; the two subclass rows `Story394.SearchTable~EnsLib.HL7.SearchTable`.
  - `getPropsList` of `EnsLib.HL7.SearchTable` gives the five stock names, and of `Story394.SearchTable` seven (the two subclass names first, then the five).
  - `GetExtentSuperclass` of both is `EnsLib.HL7.SearchTable`; `DOCCLASS` of both is `EnsLib.HL7.Message`; the extent root's table is `"EnsLib_HL7"."SearchTable"` (the subclass has its own SQL table, `Story394.SearchTable`, which the handler never uses).
  - B, `Story394.SearchTableB` compiled first in a clean extent: `AOnlyInB` 1, `MSHControlID` 2, `MSHTypeName` 3, `PatientAcct` 4, `PatientID` 5, `PatientName` 6, so B's `PatientID` PropId (5) differs from A's (4).
- **(b)** `IndexDoc` of the untyped m1 returns OK. The stored rows of m1: `MSHControlID` `Story394-CTL-a`, `MSHTypeName` `adt_a01`, `PatientID` `synthphi394-alt-1` and `synthphi394-mrn-1` (the stock item stores PID-2 and every PID-3 repetition of an untyped message, so no `Story394MRN` item was needed), `PatientName` `synthphi394^one`, `Story394Int` `7`, and `Story394Empty` the marker (`PropValue = ''` true, `<> ''` false, length 0). m2 stores `keepme394-mom` for `Story394Empty`. m6 is not indexed.
- **(c)** The stored form per PropType, from one literal item each: `String:CaseInsensitive` `MiXeD|Pipe` is `mixed+pipe`; `String:CaseSensitive` `MiXeD+Pipe`; `Integer` `0007` is `7`; `Numeric` `1.50` is `1.5`; `Boolean` `Yes` is `1`; `DateTime:ODBC` `2001-02-03 08:00:00` and `DateTime:HL7` `20010203080000` are unchanged. They are the expected values of `TestSearchTableValue`.
- **(d)** Bound-value semantics on `PropValue`: this instance's default collation for the column is EXACT. `=`, `[` and `%STARTSWITH` with a literal in another case match nothing (`story394-ctl-a` against `Story394-CTL-a`; `SYNTHPHI394-MRN-1` against the lower-cased entries), a trailing blank matters (`'Story394-CTL-a '` matches nothing), and `%EXACT(PropValue)` gives the same answers as the plain column. The marker: `PropValue = ''` is true and `<> ''` false; a bound empty-string parameter matches nothing; `PropValue < 'zzz'` matches the marker rows too (headers 1, 3, 4, 5 and 2), so the `<> ''` term is what keeps them out of a range operator (only header 2 with it).
- **(e)** The Design Notes statement prepares and runs (with literals in EXPLAIN, with `tArgs...` in the handler). `iris_sql_analyze` `explain` shows `Ens.MessageHeader(H).TimeCreated` read with a range, the `MessageBodyClassName` bitmap intersected, `IDKEY` read, then each `EXISTS` / `NOT EXISTS` as a "calling Subquery" that reads `EnsLib_HL7.SearchTable(S<n>).indexDocId`, "using the given S<n>.DocId, S<n>.PropId, and S<n>.PropValue" for `eq` and `ne` and "using the given S<n>.DocId and S<n>.PropId, and looping on S<n>.PropValue" for the other operators. No search-table module is "called once". Cost 24,805 untuned (one filter) and 7,304 (three filters and a cursor). No HALT.
- **(f)** `Ens.CustomSearchTable` `%Extends("Ens.VDoc.SearchTable")` is 0 (abstract, no extent root). `Ens.VDoc.XMLSearchTable` and `Ens.VDoc.SearchTable` are abstract with an empty `ClassType`. `EnsLib.XML.SearchTable` is its own extent root, `"EnsLib_XML"."SearchTable"`, with `DOCCLASS` `Ens.StreamContainer`. `enslib.hl7.searchtable` opens no `%Dictionary.CompiledClass`.
- **(g)** The deployed `BOOTSTRAP_VERSION` was `f7b0868c95d0` before any edit. Also found: a value of about 440 characters or more makes an `eq`, `ne` or `startsWith` lookup fail with SQLCODE -490 (Spec Change Log).

**Step C:** run on `f7b0868c95d0` with the unchanged classes and dists (`STORY_39_4_CAPTURE=1 ... -t capture`); `fixtures/story-39-4-search-baseline.json` holds 15 cases (`capturedAt` 2026-10-17T09:54:13Z). **`BOOTSTRAP_VERSION` `f7b0868c95d0` to `a6df36481aa9`** (31 classes; the implementation pass produced `757f389c62ae`, the review pass moved it once more; a second `pnpm gen:bootstrap` leaves no diff).

**Commands (all green):**
- OS classes in HSCUSTOM, one per call: `MessageSearchTableTest` 5/5, `MessageBodySearchTest` 5/5, `MessageSearchTest` 5/5, `MessageResendTest` 12/12, `MessagePreviewPolicyTest` 4/4.
- Armed gates, one per call: the 39.4 gate 81 passed and 1 skipped (the capture row), the 39.3 gate, the 39.3 QA gate, the 39.1 gate and the 39.2 gate. Then `ENV pnpm --filter @iris-mcp/all test`: 63 files, 1058 passed, 4 skipped; `ENV pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism`: 60 files, 1419 passed.
- `build`, `test`, `lint` and `type-check` for shared, dev, admin, interop, ops, data and client-config. The one non-green line: a plain `pnpm --filter @iris-mcp/dev test` failed `doc-type-description-live-gate` once (`*/cls` 12653 against 12654, the document count moved between its two reads on the shared instance) and passed alone and in the armed run.
- `gen:governance-baseline:check` OK (209 live keys, 68 post-foundation, none new here), `gen:skills:check` OK, `check-epics-sync.mjs` OK, `measure:tools-payload` (interop full 52,286, core 33,344; the README rows equal it and read "Last re-measured at Story 39.4").
- Performance: first armed bootstrap 1.2 s (budget 60 s), one lookup of A over W 104 to 110 ms (budget 2 s), the fuzz 775 requests in 5.4 s.
- Nothing left: `leftovers` for the four `EXECMCPTMP394*` names is `[]`; the namespace and database listings show none; `iris_doc_list` (HSCUSTOM, `Story39`, `ExecuteMCPv2.Temp.`, generated included) is empty.

**Mutations (Rule 19).** Each was applied, observed red, reverted (`md5` of the file equal to the saved copy, `git status --short` and `git diff --stat` unchanged), and the class reloaded or the dist rebuilt.
- AC-1/AC-3: mutation: `SearchTableFilterWhere` writes the value as a quoted literal instead of `?` -> the fuzz (44 violations) and the plan row red.
- AC-1/AC-3: mutation: an operator outside the map passes through (`BodyOpSql` default returns its argument) -> the fuzz op slot (188 violations), four refused-op rows, and `TestSearchTableClause`, `TestSearchTableOpAllowed` and `TestSearchTableStatementText` red.
- AC-1/AC-3: mutation: property resolution bypassed (the caller's text bound as the PropId) -> 34 live rows red: the refused-property rows, the fuzz property slot, every lookup row.
- AC-1: mutation: the searchTable shape checks run after the namespace switch -> the 23 refused-shape route rows red (the `<NAMESPACE>` error appears first).
- AC-1/AC-3: mutation: the value-length check removed -> the 256/257-character boundary row and the fuzz red.
- AC-2: mutation: `block` falls through to the HTTP call for `searchTable` -> four unit rows of `message-search-table.test.ts`, the governance audit row, three live rows (block session, `tight` profile, audit) and `story-39-3-qa-process.test.ts` red.
- AC-2: mutation: `searchTable` dropped from `dataPolicy.actions` -> the two definition rows, three governance audit rows, the live audit row and `data-policy-scope.test.ts` red.
- AC-2: mutation: a Search Table column added to the select list (a correlated scalar subquery) -> `TestSearchTableStatementText` and the live plan row red.
- AC-4: mutation: `SearchTableValue` returns the value unchanged -> ten live rows (the MRN row, `contains "MRN-1"`, `ne`, `PatientName lt`, `MSHTypeName`, `Story394Int "0007"`, the combined row, the second-namespace row and the two policy rows) and `TestSearchTableValue` red.
- AC-4: mutation: `%EXACT` dropped for `String:CaseSensitive` -> `TestSearchTableClause` and the live plan row (the per-call fragment) red. **The live `MSHControlID eq` row stays green**: the column's collation is EXACT here (Task 0 (d)), so header 2 does not appear; the spec's expected red is unattainable on this instance.
- AC-4: mutation: the `<> ''` term dropped -> the `Story394Empty notNull` and `isNull` rows, the header-rows-only row, the fuzz and the plan row red.
- AC-4: mutation: `ne` as `EXISTS ... <> ?` -> the `PatientID ne` and `Story394Int ne` rows, the fuzz and the plan row red.
- AC-4: mutation: the document-class header predicate dropped -> the MRN row (header 7 appears) and 18 more live rows red.
- AC-4: mutation: `getPropsList` replaced by an extent-wide read of `Ens_Config.SearchTableProp` -> the `Story394Int`-via-ST refused-property row, four sibling refused-property rows and the second-namespace subclass row red.
- AC-4: mutation: `SearchTablesConfigured` skipped -> the namespace C row red.
- AC-4: mutation: `SwitchNamespace` skipped -> 45 live rows red, the second-namespace rows among them.
- AC-5: mutation: the wire body omits `searchTableClass` -> two wire rows of `message-search-table.test.ts` and 30 live rows (the MRN row first) red.
- AC-6: mutation: `BodyStatement` emits the no-table form for a body table -> the 39.4 capture replay (SQLCODE -23), `TestBodyTableSystemClasses` of `MessageBodySearchTest` and 38 body rows of the 39.3 gate red. The 39.3 replay stays green: its baseline holds `headers` requests only.
- AC-6: mutation: `BodyFilterShape`'s default action names `searchTable` -> `TestSearchTableStatementText` red. Neither capture sends a body request without `filters`, so both replays stay green.
- AC-6: mutation: `%INORDER` dropped from the no-table statement -> the live plan row (statement text) and `TestSearchTableStatementText` red.
- AC-7: mutation: the scope row back to `["body"]` -> `data-policy-scope.test.ts` red.
- AC-7: mutation: the default-state sentence removed from the `tool_support.md` scope row, and the policy sentence from the interop README -> `story-39-4-doc-claims.test.ts` red (one row each).

**Final verification, after the review patches (the `(loop)` lines on the patched tree, the `(once)` lines once).**
- `shared` build and `bootstrap.test.ts` + `refusals.test.ts` 55 passed; `interop` build and its six listed files 209 passed.
- OS classes, one per call: `MessageSearchTableTest` 5/5, `MessageBodySearchTest` 5/5, `MessageSearchTest` 5/5, `MessageResendTest` 12/12, `MessagePreviewPolicyTest` 4/4.
- Armed gates, one per call: the 39.4 gate 84 passed and 1 skipped (the capture row), the 39.3 gate 92 and 1 skipped, the 39.3 QA gate 31, the 39.1 gate 103 and 1 skipped, the 39.2 gate 17 and 1 skipped. The scope, doc-claims, gate-guard, roster and 39.3 QA process files: 9 files, 176 passed.
- `build`, `test`, `lint` and `type-check` for shared, dev, admin, interop, ops, data and client-config: exit 0 for every command except a plain `pnpm --filter @iris-mcp/dev test`, which failed `doc-type-description-live-gate` once (`*/cls` 12654 against 12652: HSCUSTOM documents moved between the two reads, written by other sessions on the shared instance) and passed alone and in the next two runs. The one lint line is a pre-existing warning in `packages/shared/src/cli/governance.ts`. `ENV` dev `--no-file-parallelism` 60 files, 1419 passed; `ENV` all 63 files, 1061 passed, 4 skipped.
- A second `pnpm gen:bootstrap`: `BOOTSTRAP_VERSION` `a6df36481aa9` and the file's checksum unchanged. `gen:governance-baseline:check` OK (209 live keys, 68 post-foundation), `gen:skills:check` OK, `check-epics-sync.mjs` OK, `measure:tools-payload` equals the README rows (interop full 52,286, core 33,344).
- Performance: the first armed bootstrap that deployed `a6df36481aa9` took 1.2 s (budget 60 s); one lookup of A over W 103 to 110 ms (budget 2 s); the fuzz 775 requests in 5.4 s.
- Nothing left: `iris_namespace_list` and `iris_database_list` show no `EXECMCPTMP394*`; `iris_doc_list` (HSCUSTOM, `Story39` and `ExecuteMCPv2.Temp.`, generated included) is empty; the gate's `leftovers` check passed in every armed run.

**Review-pass mutations (Rule 19).** Each applied, observed red, reverted (`md5` of `MessageSearch.cls` and `message-search.ts` equal to their saved copies, `git diff --stat` unchanged), the class reloaded. The shape-check and `BodyFilterShape` rows of the implementation list above now read `SearchTableShape`.
- AC-1: mutation: the route calls `BodyFilterShape(tBodyFilters, "searchTable")` instead of `SearchTableShape`, so the 256-character rule runs only after the switch -> the live rows `route: a value of 257 characters ...` and `... in the second filter, with contains ...` red (a `<NAMESPACE>` error appears first).
- AC-1: mutation: `SearchTableShape` calls `BodyFilterShape(pFilters)` with no action name -> `route: no filters is refused naming 'filters' is required for the searchTable action` red.
- AC-1/AC-6: mutation: `BodyFilterShape`'s default action is `searchTable` -> `route: no filters on the body action keeps its own action name` red.
- AC-1/AC-6: mutation: the route's `action` text without `searchTable` -> `route: an unknown action lists all three` red.
- AC-1/AC-6: mutation: the route's `filters`-on-`headers` text says `body action` only, and the `searchTableClass` text is `is not allowed here` -> `route: filters on the headers action ...`, `route: searchTableClass on the headers action ...` and `... on the body action ...` red.
- AC-4: mutation: `Set tHeaderClass = tDocClass` (a given `bodyClass` no longer replaces the document class) -> `bodyClass EnsLib.HL7.Message equals the lookup without it, a subclass replaces the document class ...` red.
- AC-4: mutation: the clauses joined with `" OR "` -> `filters combine with AND, and with the header filters ...` and the live plan row red.
- AC-4: mutation: the keyset clause left out of the `searchTable` statement (`BodyStatement("", ..., 0)`) -> `pages of 2 join, in order, ...` red.
- AC-2/AC-4: mutation: the tool's `searchTablesConfigured === false` branch disabled -> `a namespace with no Search Table property is notApplicable with its own reason and the policy` (`message-search-table.test.ts`) red.
- AC-2/AC-6: mutation: the tool's refusal of `searchTableClass` off its action disabled -> the `searchTableClass on the headers action` and `on the body action` rows, `block still checks the misplaced searchTableClass ...` and `the block refusal and the validation errors hold none` red.
- AC-2: mutation: the policy line tail for `searchTable` replaced -> the `no policy on the config`, `redact`, `allow` and `an empty page` rows red.
- AC-5: mutation: the Zod `searchTableClass` bound `.max(220)` changed to `.max(221)` -> `declares the searchTableClass input as an optional string of at most 220 characters` red.

**QA stage (2026-10-17).** Gap analysis against the I/O matrix and ACs. Added two default-suite files and extended two rosters. Not duplicated: the header-first plan pin (the 39.4 gate's `planProblems` describe, with its checker meta-test and the real statements read from `INFORMATION_SCHEMA.STATEMENTS`, already present), the per-policy `block` / `redact` / `allow` / audit rows against real IRIS, and wildcard/hostile value semantics (the fuzz). Ledgered items DW-571, DW-572 and DW-579 not re-filed.
- (QA) `packages/iris-mcp-all/src/__tests__/story-39-4-qa-process.test.ts` (15 tests; the BUILT interop dist over stdio against a local listener, no IRIS): `block` (operator-wide, `tight` profile, governance file) refuses `searchTable` with the spec's fixed text and no `/api/executemcp/` request, whatever else is wrong; window and misplaced-parameter checks come first as validation errors; `body` keeps its own refusal; `redact` and `allow` send the lookup as given (class, filters of every JSON kind, every scope filter, the cursor position) and a padded reply comes out as the 14 header-row fields and the nine result fields only; both `notApplicable` answers hold no rows; an empty page names the policy and the index note; the audit file and the DEBUG log hold no Search Table value or (redact, block, unresolved profile) filter value; the `headers` audit entry has no `dataPolicy`.
- (QA) `packages/iris-mcp-all/src/__tests__/story-39-4-qa-live-gate.test.ts` (9 tests; armed, scratch namespace `EXECMCPTMP394Q` with fixture tau, removed with nothing-left assertions): HSCUSTOM (a real Interoperability namespace, read-only: an independent `COUNT(*)` of `Ens_Config.SearchTableProp` = 0 on this instance, then a valid and a nonexistent class are both `notApplicable`, and the route answers exactly `searchTablesConfigured:false`, `rows:[]`, with no class dictionary consulted); filters combine with AND on one multi-valued property (five oracle rows); every scope filter at once, one mismatch at a time, and pages of 2 under them.
- (QA) Rosters: both files added to `packages/iris-mcp-all/scripts/prepublish-gate.mjs` `gateTestFiles`; the live gate added to `story-39-1-gate-guards.test.ts` `GATES` (20 tests, was 16). Results: the four files (process 15, live 9, guards 20, roster 5) 49 passed; the live gate ran 6.8 to 7.7 s; `iris_namespace_list`, `iris_database_list` and `iris_doc_list` (HSCUSTOM, `Story39`, `ExecuteMCPv2.Temp.`, generated included) show nothing left.
- (QA) mutation: `block` applies to `body` only (`policy === "block" && action === "body"`) -> `story-39-4-qa-process.test.ts`: the fixed-refusal row, the `tight` profile row, the governance-file row and the audit row red (4).
- (QA) mutation: `mapHeaderRow` spreads the raw row (`...raw`) -> `story-39-4-qa-process.test.ts`: the `redact` and `allow` padded-reply rows and the audit row red (3).
- (QA) mutation: `dataPolicy.actions` is `["body"]` -> `story-39-4-qa-process.test.ts`: the audit row (no `dataPolicy` on the entry) red (1).
- (QA) mutation: the tool's `searchTablesConfigured === false` branch disabled -> `story-39-4-qa-process.test.ts`: the two `notApplicable` (no Search Table) rows, and `story-39-4-qa-live-gate.test.ts`: the HSCUSTOM row red (3).
- (QA) mutation: only the first filter reaches the wire (`filters.slice(0, 1)`) -> `story-39-4-qa-live-gate.test.ts`: four of the five AND rows red (the first, `eq MRN-2` AND `eq MRN-1`, stays green since both orders find header 2).
- (QA) mutation: `item` is not sent -> `story-39-4-qa-process.test.ts`: the wire-body row, and `story-39-4-qa-live-gate.test.ts`: the per-scope-filter row red (2).
- (QA) mutation: `afterId` is not sent with a cursor -> `story-39-4-qa-process.test.ts`: the wire-body row, and `story-39-4-qa-live-gate.test.ts`: the paged-under-scope row red (2).
- (QA) mutation: the `story-39-4-qa-process.test.ts` entry removed from `gateTestFiles` -> `live-gate-roster.test.ts` red (1).
- (QA) Each mutation was applied, observed red, reverted (`md5` of `message-search.ts` equal to the saved copy, `prepublish-gate.mjs` likewise; `git status --short` showed only the QA files) and `@iris-mcp/interop` rebuilt. All were TypeScript-side or roster mutations: no deployed `ExecuteMCPv2.REST` class was changed on the shared instance (the IRIS-side mutations for the same behaviors stay with the implement and review passes above).

**Code review stage (2026-10-17).** The review patches are listed under `### Review Findings`.
- `BOOTSTRAP_VERSION` `a6df36481aa9` → `b6ec56073e29` (31 classes; the `SearchTablesConfigured` fetch-time check). A second `pnpm gen:bootstrap` leaves the file's checksum unchanged. The version literal moved in `CHANGELOG.md`, `tool_support.md`, the changeset and `story-39-4-doc-claims.test.ts`. `gen:governance-baseline:check` OK (68 post-foundation keys).
- Unit: shared `bootstrap.test.ts` + `refusals.test.ts` 55 passed; the full shared suite 2,047 passed; the interop files listed above 209 passed; the full interop suite 556 passed; interop lint and type-check clean. `@iris-mcp/all`: the scope, doc-claims (39.1–39.4), roster, payload-sync and QA process files 175 passed; `story-39-1-gate-guards` 20 passed; eslint on the edited test files clean. `measure:tools-payload`: interop full 52,330, core 33,388, equal to the README row.
- Armed gates, one per call: the 39.4 gate deployed `b6ec56073e29` (first start 1.3 s), 84 passed and 1 skipped, with the fuzz at 775 requests in 5.2 s. The 39.4 QA live gate 9, the 39.3 gate 93 and 1 skipped (one new row), the 39.3 QA live gate 31, the 39.1 gate 103 and 1 skipped, and the 39.2 gate 17 and 1 skipped. Every gate's own nothing-left assertions passed.
- OS classes in HSCUSTOM, one per call: `MessageSearchTableTest` 5/5, `MessageBodySearchTest` 5/5 and `MessageSearchTest` 5/5 (each total equal to its `Test*` count).
- (CR) mutation: the Search Table configuration read moved ahead of the Interoperability check (`If tAction = "searchTable" Set tMutation = ..SearchTablesConfigured()` before the `Ens.MessageHeader` check, loaded into HSCUSTOM) -> the 39.3 gate's `searchTable there is notApplicable for no Interoperability too ...` red (`SQLCODE: -30 ... Table 'ENS_CONFIG.SEARCHTABLEPROP' not found`). The file was restored (md5 equal to the saved copy, `git status --short` unchanged), reloaded, and the row was green again.

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** The `searchTable` action of `iris_message_search` is built. IRIS side (`MessageSearch.cls`): the class rule, `SearchTablesConfigured`, `SearchTableValue`, `SearchTableOpAllowed`, `SearchTableClause`, `SearchTableShape` and `SearchTableFilterWhere` resolve a property through `getPropsList` to a bound PropId, map each operator from a closed table, bind every value and take the table from the class dictionary; the statement reads the headers first (`%INORDER`) with a correlated `EXISTS` / `NOT EXISTS` per filter. TypeScript side: the `NOT_IMPLEMENTED` branch is gone, `searchTableClass` is added, `dataPolicy.actions` is `["body", "searchTable"]`, `block` refuses with `DATA_POLICY_BLOCKED` before any IRIS call, and a namespace with no Search Table property answers `notApplicable`. `BOOTSTRAP_VERSION` `f7b0868c95d0` to `a6df36481aa9` (31 classes). The tool count, the governance baseline (`1e62c5ad5bf7`, 141) and every preset are unchanged.

**Files changed.**
- `src/ExecuteMCPv2/REST/MessageSearch.cls` (the action), `src/ExecuteMCPv2/Tests/MessageSearchTableTest.cls` (new, 5 methods), `src/ExecuteMCPv2/Tests/MessageSearchTest.cls` (action `bogus`, exact action text), `packages/shared/src/bootstrap-classes.ts` (regenerated).
- `packages/iris-interop-mcp/src/tools/message-search.ts` (the action, schema, policy, results, description) and its tests: `message-search-table.test.ts` (new), `message-search.test.ts`, `message-search-body.test.ts`, `message-search-governance.test.ts`.
- `packages/iris-mcp-all/src/__tests__/`: `story-39-4-search-table-live-gate.test.ts` and `story-39-4-doc-claims.test.ts` (new), `fuzz-corpus.ts` (new, moved out of the 39.3 gate), `fixtures/story-39-4-search-baseline.json` (the capture on `f7b0868c95d0`), `interop-namespace-fixture.ts`, `header-row-oracle.ts`, `data-policy-scope.ts` and its test, the 39.1 and 39.3 gates, `story-39-3-doc-claims.test.ts`, `story-39-3-qa-process.test.ts`, `story-39-1-gate-guards.test.ts`; `packages/iris-mcp-all/scripts/prepublish-gate.mjs`.
- Docs: `README.md`, `packages/iris-interop-mcp/README.md`, `packages/iris-mcp-all/README.md`, `tool_support.md`, `CHANGELOG.md`, `.changeset/story-39-4-search-table-lookup.md`.

**Review findings.** 39 findings across the four layers: high 0, medium 5 (two entries: the 256-character rule after the switch, filed by four layers as four rows; the unexercised `bodyClass` replacement), low 30, false 4. Patched (17 rows in 13 entries, including both medium entries): `SearchTableShape` runs the value-length rule before the switch; the `bodyClass` replacement has a live row with a fixture subclass and system-class assertions; route texts are pinned to the exact text; `PropertyNames` and the new shape method are asserted; a dead branch, the class-refusal text, the gate header, the re-measured pin, two CHANGELOG sentences and two test defects are corrected. Rejected with a recorded reason (22 rows): the non-numeric Integer value (mirrors the stored form), the property grammar (Design Notes I1), the subclass-header scope (I7), the OS class without an automated host (project convention), the `%EXACT` rows (Spec Change Log 2), the wall-clock budgets (the spec's own), the stderr read (the 39.3 pattern), the plan-checker meta-test behind the live guard (the gate-guard test pins it), and the descriptive intent-auditor notes. Deferred: none.

**Follow-up review recommendation: true.** Two medium entries were patched. The unverified risk: the patches themselves (`SearchTableShape` moving the value-length rule ahead of the namespace switch in a bootstrapped route class, and the `Story394.SubMessage` fixture) were read by no review layer; they are covered by the armed gate (84 passed), the OS classes and 12 recorded mutations, but not by an independent read. Patched counts by verdict: high 0, medium 2 entries.

**Verification.** See `## Verification`, "Final verification, after the review patches": all `(loop)` lines green on the patched tree, the `(once)` lines run once after the last patch (one non-green: a pre-existing flaky `doc-type-description-live-gate` count drift on the shared instance in a plain `dev test`, green alone and in the armed full runs); mutations for every pinning behavior recorded; no disposable namespace, database, class or global left.

**Residual risks.**
- `%EXACT` for `String:CaseSensitive` cannot be shown live on this instance (the column collation is EXACT); the unit text and the plan row pin it.
- Numeric, Boolean and DateTime normalization is pinned by the `%UnitTest` class only; no stock Search Table has such a property.
- After a repeat `pnpm gen:bootstrap` that writes identical content, delete `packages/shared/dist` and `tsconfig.tsbuildinfo` and rebuild, or the armed gates report a stale dist.
- The shared IRIS instance is written by other sessions: a document-count drift can turn the dev live gate above red once.
