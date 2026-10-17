---
title: 'Story 39.5: Message Body Reader'
type: 'feature'
created: '2026-10-17'
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

**Problem:** An engineer who has found Interoperability messages (with `iris_message_search`, Stories 39.1–39.4) cannot read what they carry (G35). The competitor reads three body classes. Story 39.2 built the PHI policy, the body-kind classifier, `Hl7Text` and the HL7 v2 redaction engine, but no tool returns body text yet (decision #23). `Hl7Text` also serializes the whole message before it compares the size with its cap (DW-577).

**Approach:**
- Add the read tool `iris_message_body`. It takes 1 to 20 header IDs and returns, for each one, the body class and ID, the body kind and the body rendered by kind:
  - HL7 v2 as ER7;
  - an XML virtual document as XML;
  - a persistent object as JSON (`%JSONExportToStream` when the class extends `%JSON.Adaptor`, otherwise a property dump from the dictionary);
  - a stream or stream container as text;
  - anything else as its class and ID with a reason.
  
  Each shown text is cut at `maxChars` with `truncated`.
- Add a new IRIS route served by a new bootstrapped handler, `ExecuteMCPv2.REST.MessageBody`. TypeScript tells it which bodies it may read (`bodyRead`), from the policy:
  - `block`: none (`kind`);
  - `redact`: HL7 v2 only, complete or not at all (`hl7`);
  - `allow`: every renderable kind (`all`).
  
  So under `redact` no other body's content leaves IRIS.
- Apply the policy per body in TypeScript (AD-26):
  - HL7 v2 text goes complete and unsanitized through `redactHl7`. Sanitization and truncation come after redaction.
  - Every other kind is withheld under `redact`, and every body under `block`, each with one of the 39.2 block reasons.
  - A caller `dataPolicy` can only tighten the operator's policy (`tightenDataPolicy`), and a clamp is reported.
- Close DW-577. `MessageSearch.Hl7Size` sums the stored segment sizes of the message and its batch children without serializing anything, and `Hl7Text` refuses `tooLarge` from that sum before it serializes.
- Register the tool as a `TOOL_PAIRS` unit with `iris_message_search`, in interop `core` (12 runtime) and `developer`, as a read that is enabled by default, with a governed scope row.

## Boundaries & Constraints

**Always:**
- **The input (AC 39.5.1).**
  - `headerIds` is 1 to 20 positive integers, or strings of digits (the `iris_message_resend` `headerIdSchema`).
  - `maxChars` is an integer from 1 to 1048576, default 10000. It is the output cap, per body, on the text the tool returns.
  - `dataPolicy` is optional, one of `block`, `redact` or `allow`. It is tighten-only.
  - `namespace` is optional.
  - Items come back in request order, one per ID, duplicates included. A header that does not exist is `{id, found: false, error: "Header <id> not found"}`.
- **The IRIS route** (`POST /interop/message/body`; AD-11, AD-12, AD-13).
  - **Request:** `{headerIds, namespace?, bodyRead, bodyTextMaxChars}`.
    - `headerIds` is checked by `MessageResend.ValidateHeaderIds` with a new `pMax` of 20.
    - `bodyRead` is `kind` (the default when absent), `hl7` or `all`.
    - `bodyTextMaxChars` is 1 to 1048576, default 65536.
    - Every check runs before the namespace switch, and its text names the parameter.
  - **Interoperability check:** a namespace without `Ens.MessageHeader` answers `{interopEnabled: false, items: [], count: 0}`.
  - **Response:** `{interopEnabled: true, items, count}`. Each found item is `{id, found, bodyClassName, bodyId, bodyKind, bodyAvailable}`, plus:
    - `bodyText` and `bodyTextComplete`; or
    - `bodyTextOmitted`: `tooLarge`, `unreadable` or `noRenderer`.
  - **Which bodies it reads:**
    - `kind` reads none.
    - `hl7` reads only available `hl7v2` bodies, through `MessageResend.SetBodyDetail`'s `text` mode: the complete ER7 text, or `tooLarge`/`unreadable`.
    - `all` also reads every other available kind (Design Notes, Renderers), and the literal value of a `literal` header.
  - `bodyId` is left out for a `literal` header unless `bodyRead` is `all`.
  - A per-item failure gives a fixed text that holds no exception text.
- **Renderers (AC 39.5.2; Rule #56).** The list in Design Notes covers all nine `BodyKind` tokens. It is exhaustive as of 2026-10-17; its source is `MessageSearch.BodyKind` and the irislib 2026.2 build 221U class hierarchy.
  - An HL7 v2 body is shown only whole: IRIS never cuts one.
  - Other kinds may be read as a prefix of `bodyTextMaxChars` characters, which happens only under `all`, where nothing is redacted.
  - TypeScript cuts every shown text at `maxChars` and sets `truncated` when it cut the text or IRIS reported `bodyTextComplete: false`. It never splits a UTF-16 surrogate pair.
- **The wire per policy** (Rule #10: both fields are always sent).

  | Policy | `bodyRead` | `bodyTextMaxChars` |
  | --- | --- | --- |
  | `block` | `kind` | 65536 |
  | `redact` | `hl7` | `HL7_BODY_TEXT_MAX_CHARS` (65536) |
  | `allow` | `all` | `max(maxChars, 65536)` |

  The policy is `tightenDataPolicy(effectiveDataPolicy(ctx.config), input.dataPolicy).policy`, read on every call (AD-9, AD-3).
- **The policy per body (AD-26, AD-9).**
  - The decision is the shared `decideBodyPolicy(kind, available, policy)` in `data-policy.ts`, extracted from `applyPreviewBodyPolicy` rules 2 to 4 (Rule 2).
    - Not available gives `none`.
    - `block` gives `blocked` (`blockPolicy`).
    - `redact` gives `redact` for `hl7v2`, else `blocked` (`unredactableKind(kind)`).
    - `allow` gives `none`.
  - The body reader passes `available = bodyAvailable === true || kind === "literal"`.
  - A `bodyKind` outside the nine tokens is the kind `other`, and it is `blocked` under `redact` and `block`.
  - Under `redact`, an `hl7v2` item resolves as follows:
    - its `bodyText` goes to `redactHl7`;
    - an `ok` result gives `{outcome: "redacted", redactedFields}` with the redacted text;
    - a refusal gives `blocked` with `hl7Unparseable(<engine reason>)`;
    - `bodyTextOmitted: "tooLarge"` gives `hl7TooLarge`;
    - anything else gives `hl7Unreadable`.
  - Only these fields of an IRIS item are read: `id`, `found`, `error`, `bodyClassName`, `bodyId`, `bodyKind`, `bodyAvailable`, `bodyText`, `bodyTextComplete` and `bodyTextOmitted`. Under `redact` and `block`, a `bodyText` of any non-`hl7v2` item, and the `bodyId` of a `literal` item, are dropped, whatever IRIS sent.
- **Output.**
  - `structuredContent` is `{items, count, maxChars, dataPolicy: {policy, redacted, blocked}}`, plus `dataPolicyClamped: true` only when the caller's `dataPolicy` was looser.
  - Each found item is `{id, found: true, bodyClassName, bodyId, bodyKind, bodyPolicy}` plus one of:
    - `format` (`er7` | `xml` | `json` | `text`), `text` and `truncated`;
    - `notShown`, a fixed reason (Design Notes).
  - `content` is one text entry. Each item gives a heading line, `#<id> <bodyClassName> [<bodyKind>] <outcome>`, followed by its `text` or its `notShown` reason. Then comes `Data policy <policy>: <redacted> redacted, <blocked> withheld.`, then the clamp line (`The requested data policy <requested> is looser than the profile's <policy>, so <policy> applies.`) when there was a clamp.
  - Interoperability absent gives `notApplicable: true` with a reason, `items: []` and `dataPolicy`.
- **Sanitization (TypeScript, after redaction, before truncation).** CRLF and a lone CR become LF, so an ER7 segment is one line. Every other C0 control except TAB and LF, and DEL, becomes U+FFFD (authored as `"�"`, Rule 14).
- **No echo (AD-19).** Body content never reaches stderr or the audit file under any policy, `allow` included. No reason text echoes body content or a caller value. The tool declares `dataPolicy: {}` (governed, no actions, no `phiInputs`, since its inputs are not PHI-bearing), so every audit entry carries `dataPolicy` with the applied policy and counts. `outcome` stays `ok | error | denied`.
- **Governance and visibility (AC 39.5.4; AD-4, AD-7).**
  - The tool is `iris_message_body`: `scope: "NS"`, `mutates: "read"` (one key, enabled by default, unchanged under the `read-only` preset). Its annotations are `readOnlyHint: true`, `destructiveHint: false`, `idempotentHint: true` and `openWorldHint: false`.
  - `TOOL_PAIRS` gains `["iris_message_search", "iris_message_body"]`, and interop `core` and `developer` include it.
  - The counts become: interop 24 package / 25 advertised, `core` 11 package / 12 runtime (L-4: the everyday forensic loop of search, read and diagram), `developer` 25 runtime, and the suite 109 / 114.
  - The governance baseline stays `1e62c5ad5bf7`/141.
- **DW-577 (AD-20).**
  - `Hl7Size(pBodyClass, pBodyId, pLimit)` sums `EnsLib.HL7.Message.GetFullSize` over the message and, recursively, its batch children (fixed SQL `SELECT %ID FROM EnsLib_HL7.Message WHERE ParentId = ? OR ParentId %STARTSWITH ?`, with the arguments `id` and `id:`). It stops once the sum passes `pLimit` and returns 0 on failure.
  - `Hl7Text` opens the body as today, then returns `tooLarge` when `Hl7Size(…) > pMaxChars`, before `OutputToLibraryStream`. The existing post-serialization check stays.
- **IRIS side.**
  - `MessageBody.cls` extends `REST.Base`, renders one envelope, saves and restores `$NAMESPACE`, and passes text through `SanitizeError`.
  - `ValidateHeaderIds(pArr, Output pIds, pMax As %Integer = 100)`: with the default, its texts are byte-identical.
  - `Hl7Text`'s existing outcomes are unchanged for every body that fits.
  - `Dispatch.cls` adds one route.
  - `pnpm gen:bootstrap` runs. `BOOTSTRAP_VERSION` moves `b6ec56073e29` → new, and the roster goes 31 → 32 in both rosters (Rules #24, #39).
- **Back-compat (AD-15, AD-33).**
  - No existing route, tool definition, description, schema or output changes.
  - The preview's refactor onto `decideBodyPolicy` keeps every 39.2 unit and live row green unchanged.
  - The 39.1–39.4 captures replay byte for byte.
- **Live fixtures.** Fixtures are synthetic.
  - Every identifying value contains `SYNTHPHI`, values that must survive contain `KEEPME`, and times fall on 2001-02-03 UTC.
  - They live only in the disposable mapping-only namespaces `EXECMCPTMP395A`, `EXECMCPTMP395B` and `EXECMCPTMP395C` (the gate) and `EXECMCPTMP395P` (the Task 0 probes). They use the `Story395.*` classes compiled inside them and the HSCUSTOM fixture class `ExecuteMCPv2.Temp.Story391Fixture`. No production is started.
  - All of them are removed, with nothing-left assertions. Every IRIS MCP call names `server:"default"`.

**Never:**
- Never cut, sanitize or flatten an HL7 v2 text before `redactHl7`. Never pass any body through unredacted under `redact`.
- Never let IRIS read a non-HL7 body under `redact`, or any body under `block`.
- Never use `RawContent`, `%ZEN.Auxiliary.altJSONProvider` (`[Deprecated]`, Rule #4) or exception text in an item.
- No raw SQL, no caller text in a statement, and no `ErrorStatus` or `Description`.
- No change to `iris_message_search`, its route, `resendFiltered`, the preview's output, any other tool, any prompt, `STARTUP_ENV_VARS` or the refusal catalog. No new environment variable.
- Never call `%Library.EnsembleMgr.EnableNamespace`. Never start a production. Never read HSCUSTOM's or another project's messages.
- Never run the bare governance-baseline generator, and never hand-edit `bootstrap-classes.ts`.
- No document claims regulatory compliance.

## I/O & Edge-Case Matrix

**Fixture κ** (namespace A = `EXECMCPTMP395A`) is seeded by `Story395.Seed.Seed("a")` (Design Notes). It has headers 1–17, each a Request with status Completed, from `Story395.Source` to `Story395.Target`, `TimeCreated` 2001-02-03 11:00:01 + n s, session 395000 + n.

| H | Body | Kind | `allow` | `redact` (default) | `block` |
| --- | --- | --- | --- | --- | --- |
| 1 | HL7 `adt` (`Story391Fixture.Hl7Text`) | hl7v2 | `er7`, whole | redacted | blocked |
| 2 | HL7 `ack` | hl7v2 | `er7` | redacted | blocked |
| 3 | `%Stream.GlobalCharacter`, `StreamText` (1500 characters with CR, LF and TAB) | stream | `text` (CRLF → LF) | blocked (`stream`) | blocked |
| 4 | `Ens.StringRequest` `SYNTHPHI-STRING` | persistent | `json`, the dump `{"StringValue":"SYNTHPHI-STRING"}` | blocked (`persistent`) | blocked |
| 5 | `Ens.StreamContainer` `SYNTHPHI-CONTAINER` | streamContainer | `text` `SYNTHPHI-CONTAINER` | blocked | blocked |
| 6 | `Story395.Body.Missing` / `1` | missing | `notShown` (class not compiled) | none | none |
| 7 | `""` / `SYNTHPHI-LITERAL` | literal | `text` `SYNTHPHI-LITERAL`, with `bodyId` | blocked (`literal`), `bodyId` `""` | blocked, `bodyId` `""` |
| 8 | HL7 `alt` (separators `#!@$%`) | hl7v2 | `er7` | redacted, with its own separators | blocked |
| 9 | HL7 `big` (70,180 characters) | hl7v2 | default: `notShown` too large (65536); `maxChars:100000`: `er7` whole | blocked (`hl7TooLarge`) | blocked |
| 10 | `EnsLib.EDI.XML.Document` (`SYNTHPHI-XML-NAME`, `KEEPME-XML`) | xmlvdoc | `xml`, equal to the Task 0 (c) recording | blocked (`xmlvdoc`) | blocked |
| 11 | `Story395.JsonBody` (`SYNTHPHI-JSON-NAME`, `KEEPME-JSON`) | persistent | `json`, equal to the Task 0 (d) recording | blocked | blocked |
| 12 | `Story395.Plain` (dump rules) | persistent | `json` dump; no `SYNTHPHI-PRIVATE` and no `SYNTHPHI-NOTE` | blocked | blocked |
| 13 | HL7 `huge` (at least 2,000,000 characters; Task 0 b) | hl7v2 | `notShown` too large, even at `maxChars:1048576` | blocked (`hl7TooLarge`) | blocked |
| 14 | `EnsLib.HL7.Message` / `999999` (dangling) | hl7v2, unavailable | `notShown` (does not open) | none | none |
| 15 | HL7 `batchSmall` (FHS, BHS, two messages, BTS, FTS) | hl7v2 | `er7` whole | redacted | blocked |
| 16 | HL7 `batchLarge` (three children of about 30,000 characters each, over 65536 in total) | hl7v2 | default: too large; `maxChars:100000`: whole | blocked (`hl7TooLarge`) | blocked |
| 17 | `%Library.DynamicObject` / `1` | other, unavailable | `notShown` (does not open) | none | none |

The expected counts are:
- `redact`: `{redacted: 4, blocked: 10}` (1, 2, 8, 15; and 3, 4, 5, 7, 9, 10, 11, 12, 13, 16).
- `block`: `{redacted: 0, blocked: 14}`.
- `allow`: `{0, 0}`.

**The other namespaces:**
- **B** (`EXECMCPTMP395B`), `Seed("b")`, has two headers: 1 is an HL7 message holding `SYNTHPHI-B-MRN` and `KEEPME-B`, and 2 is `Ens.StringRequest` `SYNTHPHI-B-STRING`.
- **C** (`EXECMCPTMP395C`) has no Interoperability mappings.
- **Z** (`EXECMCPTMP395Z`) is never created.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Resolve (AC 39.5.1) | A, `allow`, `headerIds` 1–17 | 17 items in order. Each `bodyClassName`/`bodyId` equals the oracle `SELECT ID, MessageBodyClassName, MessageBodyId FROM Ens.MessageHeader` (`atelierQuery`, literals), and each `bodyKind` equals the κ column | none |
| Not found, duplicates | A, `[1, 999, 1]` | Items 1, `{id: 999, found: false, error: "Header 999 not found"}`, and 1 again | none |
| Bounds (tool) | `headerIds` `[]`, 21 IDs, `["0"]`, `[1.5]`; `maxChars` 0 or 1048577; `dataPolicy:"open"` | A validation error; no HTTP call | refusal |
| Renderers, `allow` (AC 39.5.2) | `IRIS_DATA_POLICY=allow`, A, 1–17 | As the κ `allow` column. The XML and JSON texts equal their recordings. The stream text equals `StreamText` with CRLF and CR turned to LF. `SYNTHPHI` appears (positive control) | none |
| Cap | `allow`: `maxChars:100`; then `maxChars:100000` | At 100, items 1, 3 and 10 have exactly 100 characters and `truncated: true`. At 100000, 9 and 16 are whole with `truncated: false`, and 13 is still too large | none |
| `redact` (AC 39.5.3, 39.5.5) | no setting; A, 1–17 | As the κ `redact` column, with `dataPolicy {redact, 4, 10}`. Item 1 keeps `KEEPME-GLUCOSE`, and item 8 starts `MSH#!@$%#`. `JSON.stringify(result)` (content and `structuredContent`) holds no `SYNTHPHI` | none |
| Redaction before truncation | unit: `redact`, `maxChars:5`, a complete ER7 reply; live: A item 1 | `outcome: "redacted"`; `text` is the first 5 characters of the redacted text, with `truncated: true` | none |
| IRIS parser oracle (Rule #36) | A items 1, 2, 8 and 15, `maxChars:65536`: the `allow` text and the `redact` text | `checkRedactedPositions(hl7Fields(allow), hl7Fields(redact), separatorCharacters(allow))` is `[]`, and every Safe Harbor position holds only `***` and separators | none |
| `block` | `IRIS_DATA_POLICY=block` | No `text` anywhere, `{block, 0, 14}`, and the wire `bodyRead:"kind"`. No `SYNTHPHI` | none |
| Tighten (AD-9) | operator `allow`, caller `redact`; operator `redact` (default), caller `allow`; operator `allow`, caller `block` | `redact` with no clamp; `redact` with `dataPolicyClamped: true` and the clamp line; `block` | none |
| Per profile | `IRIS_PROFILES={"loose":{"dataPolicy":"allow"}}`; `callOn("loose")` and the default session | `loose` shows `SYNTHPHI`; the default (`redact`) does not | none |
| Route, least exposure | raw REST, A, 1–17: `bodyRead` `kind`, `hl7` and `all` | `kind`: no `bodyText` key and no `SYNTHPHI` in the raw text. `hl7`: `bodyText` only on 1, 2, 8 and 15, `tooLarge` on 9, 13 and 16, and no `bodyId` on 7. The raw text holds none of `SYNTHPHI-S`, `SYNTHPHI-STRING`, `SYNTHPHI-CONTAINER`, `SYNTHPHI-LITERAL`, `SYNTHPHI-XML`, `SYNTHPHI-JSON` or `SYNTHPHI-PLAIN`. `all`: every renderable item has `bodyText` | none |
| Route refusals | raw REST, namespace Z: no `headerIds`; `[]`; 21 IDs; `["x"]`; `bodyRead` `raw`, `5` or `""`; `bodyTextMaxChars` 0, 1048577 or `"x"` | An envelope error naming the parameter, and no `<NAMESPACE>` error (validation came first) | refusal |
| Cap boundary | route `bodyRead:"hl7"`, A item 1, `bodyTextMaxChars` = its serialized length L, then L − 1 | complete `bodyText`; then `tooLarge` | none |
| DW-577, exact precheck | `Story395.Seed.Sizes("1,2,8,9,13,15,16")` | For each, `Hl7Size(…, 10^9)` equals the length `OutputToLibraryStream` writes | none |
| DW-577, work bound | `Story395.Seed.Timing(13, 65536)` | `result: "tooLarge"`, and `hl7TextMs × 4 < serializeMs` | none |
| Second namespace (Rule #34) | `allow`, header 1 in A and in B; header 2 in both | A's text holds `SYNTHPHI-MRN` and not `SYNTHPHI-B-MRN`; B's is the reverse. Header 2 is `hl7v2` in A and `persistent` in B | none |
| Not configured (Rule #41) | C, `[1]`; unit with `interopEnabled: false` | `notApplicable: true` with a reason, `items: []` and `dataPolicy` | none |
| Unknown namespace | Z, `[1]` | `isError`, with the sanitized `SwitchNamespace` text | error |
| Audit (AD-19) | `IRIS_AUDIT_LOG`, `IRIS_AUDIT_LOG_PARAMS=true`, `LOG_LEVEL=DEBUG`; A read under `redact`, `block` and `allow` | Each entry is `{tool: "iris_message_body", outcome: "ok", dataPolicy: <the response's counts>}`, and `params.headerIds` is logged. Under every policy, `allow` included, neither the file nor stderr holds `SYNTHPHI` | none |
| Governance | unit, real `McpServerBase`: default; then `IRIS_GOVERNANCE={"global":{"iris_message_body":false}}` | Enabled; then `GOVERNANCE_DISABLED`, with no HTTP call | denied |
| Visibility (AD-7) | the built interop server, under `core`, `developer` and `full` | `iris_message_body` and `iris_message_search` are both visible in every preset; `core` lists 12 tools | none |

</intent-contract>

## Code Map

**IRIS side**
- `src/ExecuteMCPv2/REST/MessageSearch.cls` (bootstrapped, 1102 lines):
  - `TypeLabel` :649 and `BodyKind` :662 are reused as they are.
  - `Hl7Text` :686-712 is changed: after the `%Extends` check (:695), `If ..Hl7Size(pBodyClass, pBodyId, pMaxChars) > pMaxChars { Set tResult = "tooLarge" Quit }`. Add `Hl7Size` beside it.
  - `ReadInteger` :756 and `ReadString` :741 are reused.
  - The interop check expression `##class(%Dictionary.CompiledClass).%ExistsId("Ens.MessageHeader")` :969 is reused.
- `src/ExecuteMCPv2/REST/MessageResend.cls` (bootstrapped):
  - `ValidateHeaderIds` :101-139 gains `pMax As %Integer = 100`; its two count texts interpolate `pMax`.
  - `BodyAvailable` :206 and `SetBodyDetail` :224-236 (`kind`/`text`) are reused as they are.
  - `BODYTEXTMAX` :22 is 1048576 and `BODYTEXTDEFAULT` :26 is 65536.
  - `PreviewOne` :268 and `MessageResendPreview` :335 are the handler-shape precedent; they are not changed.
- `src/ExecuteMCPv2/REST/MessageBody.cls` (new, bootstrapped). Its methods are `MessageBody()`, `BodyOne(pId, pBodyRead, pMaxChars)`, `ReadsText(pBodyRead, pKind)`, `RenderText(pKind, pObj, pMaxChars, Output pText, Output pComplete) As %String` (the omitted token or `""`), `ReadStreamText`, `XmlText`, `JsonText` and `PropertyDump(pObj) As %DynamicObject`.
- `src/ExecuteMCPv2/REST/Dispatch.cls:123`: after the search route, add `<Route Url="/interop/message/body" Method="POST" Call="ExecuteMCPv2.REST.MessageBody:MessageBody" />`.
- `src/ExecuteMCPv2/Tests/MessagePreviewPolicyTest.cls` (4 methods): `TestHl7TextUnreadable` :80 must stay green, because the precheck runs after the open.
- Read-only system sources (`irislib/`, by explicit path):
  - `EnsLib/HL7/Message.cls`:
    - `FullSize` :100-102 ("Size in bytes of the message content… assumes 1-byte segment terminators");
    - `GetFullSize(pMsgId)` :233-281 reads the stored segments only and skips the batch `DocsRef` holders, so it does not count children;
    - `ParentId` index :30, and children are found by `ParentId = id or %StartsWith id_":"` (:1886);
    - `OutputToLibraryStream` :1607;
    - `RawContent` is cut at 10000 (:90).
  - `EnsLib/EDI/XML/Document.cls`: `ImportFromString`, `OutputToLibraryStream(pLibStream, pFormat)` :864.
  - `Ens/StreamContainer.cls`: `Stream` (calculated) :19, `StreamGet` :53; the `Stream*` properties are `Internal`.
  - `Ens/Util/MessageBodyMethods.cls:73-104` (`OnShowJSONContents`): the Message Viewer uses `%JSONExportToStream` for a `%JSON.Adaptor` class, otherwise `%ZEN.Auxiliary.altJSONProvider.%ObjectToAET`, which is `[Deprecated]` (`%ZEN/Auxiliary/altJSONProvider.cls:64`). This is a functional reference only.
  - `Ens/StringRequest.cls`, `Ens/MessageBody.cls`: neither extends `%JSON.Adaptor`.
- `scripts/gen-bootstrap.mjs` `classes[]` :14-46: insert `src/ExecuteMCPv2/REST/MessageBody.cls` after MessageSearch (:35). `packages/shared/src/__tests__/bootstrap.test.ts` has the count of 31 at :1026-1027 and :1091, the expected names at :1031-1063, the base-before-extenders list at :1130-1148 and `classPaths` at :1262-1294. `packages/shared/src/bootstrap-classes.ts:25` holds `b6ec56073e29`.

**TypeScript**
- `packages/shared/src/data-policy.ts`: `isBodyKind` :59, `isRedactableBodyKind` :64, `HL7_BODY_TEXT_MAX_CHARS` :75, `effectiveDataPolicy` :161, `tightenDataPolicy` :177, `DataPolicySummary` :187, `BodyPolicyOutcome` :194, `BLOCK_REASONS` :204. Add `BodyPolicyPlan` and `decideBodyPolicy`, and keep the module's runtime-import-free contract (:19-21).
- `packages/shared/src/hl7-redaction.ts`: `redactHl7` :324 and `Hl7RedactionResult` :213. `packages/shared/src/index.ts` exports :47-80 (add `decideBodyPolicy` and `BodyPolicyPlan`).
- `packages/shared/src/tool-visibility.ts:303-318`: the `TOOL_PAIRS` JSDoc and list.
- `packages/iris-interop-mcp/src/tools/message-resend.ts`:
  - `headerIdSchema` :76 is private; export it.
  - `PREVIEW_HEADER_FIELDS` :236 is the allow-list precedent.
  - `applyPreviewBodyPolicy` :273-307: keep rule 1 (the unknown kind) and call `decideBodyPolicy` for rules 2 to 4. Its signature and outputs are unchanged.
- `packages/iris-interop-mcp/src/tools/message-search.ts`: the definition shape (`title`, description :337-420, schema, annotations :503-508, `scope` :509, `dataPolicy` :520) and the `IrisApiError` mapping :706-719 are the precedent; the file itself is unchanged. `BASE_URL` is `/api/executemcp/v2`.
- `packages/iris-interop-mcp/src/tools/index.ts`: the header comment :13 says 23; import and register `messageBodyTool` after `messageSearchTool`.
- `packages/iris-interop-mcp/src/tools/presets.ts`: the header :1-21 (10/11/23); `core.include` :36 and `developer.include` :80 (after `iris_message_search`).
- `packages/iris-mcp-all/src/__tests__/data-policy-scope.ts:37-54` (the rows; add the governed `iris_message_body` row with no `governedActions`) and `data-policy-scope.test.ts:83-86` (the exact governed list gains `["iris_message_body", undefined]` first).

**Tests that pin shared surfaces** (update each)
- interop:
  - `index.test.ts` :24 (23), :38/:46 titles, :48 (24), :71/:79, :80 (24) and :104 (add a `toContain`);
  - `presets.test.ts` :52-57 (core 10/13 → 11/13, developer 23/0 → 24/0) and :59-62 (add the same test for body). It has no `TOOL_PAIRS` test today: add one modelled on dev `presets.test.ts:77-103`;
  - `presets.e2e.test.ts` :9-13 (its header says interop owns no pair) and the :72 title (all 23).
- shared:
  - `tool-visibility.test.ts:356-380` (the exact `TOOL_PAIRS` `toEqual` at :368-373; add a `toContainEqual`);
  - `pre-feature-tool-snapshot.ts` :19 and :109 (the interop roster);
  - `tool-visibility-backcompat.test.ts` :123 and :126 (23 → 24);
  - `bootstrap.test.ts` (above).
- `packages/iris-mcp-all/src/__tests__/`:
  - `docs-prompt-sync.test.ts` :118, :123, :127, :136, :138 (108 → 109);
  - `story-39-1-doc-claims.test.ts` :106-113, :127-129, :170-174;
  - the Total-row pins at `story-39-2-doc-claims.test.ts:207-208`, `story-39-3-doc-claims.test.ts:234-235` and `story-39-4-doc-claims.test.ts:226-227` (83/108/113 → 84/109/114);
  - "no tool returns HL7 body text yet" at `story-39-2-doc-claims.test.ts:179` and `story-39-3-doc-claims.test.ts:165` (the sentence changes; repin it to the new sentence);
  - `story-39-1-message-search-live-gate.test.ts` :682, :686 (24 → 25), :697 and :707 (11 → 12);
  - `story-39-1-gate-guards.test.ts:32-38` `GATES`;
  - `packages/iris-mcp-all/scripts/prepublish-gate.mjs:105-185` `gateTestFiles`.
- The computed tests: `docs-visibility-roster-sync`, `tool-visibility-snapshot-drift`, `tool-visibility-non-drift`, `measure-tools-payload`, `live-gate-roster` and `default-enabled-holders` (unchanged: there is no `defaultEnabled` or `parent`). They go red until the docs below are updated.

**Live harness** (`packages/iris-mcp-all/src/__tests__/`)
- `interop-namespace-fixture.ts`:
  - `FIXTURE_CLASS_SOURCE` :65-342: `Add` :75, `Hl7Fields` :177 (its guard at :179 allows only `EXECMCPTMP392`: widen it to `1"EXECMCPTMP39"1(1"2",1"5")1U`), `Hl7Text` :193, `StreamText` :232, `SaveHl7` :240, `SaveStream` :250, `SaveString` :260, `SaveContainer` :269.
  - `createInteropNamespace` :409, `removeInteropNamespace` :450, `hl7Fields` :530 (update its doc line), `putCompileSeed` :1006 (private; reuse it), `leftovers` :1113.
- `process-gate-helpers.ts`: `staleDistReason` :41, `openWireSession` :237 (`callOn` :271, `onStderr`), `atelierQuery` :334, `executeMcpPost` :360, `docFixtures` :389, `shippedBootstrapVersion` :434, `assertDeployedBootstrapVersion` :455.
- `packages/shared/src/__tests__/hl7-redaction-fixtures.ts`: `checkRedactedPositions` :245, `separatorCharacters` :282. The `HL7_SAFE_HARBOR_FIELDS` sweep pattern is in `story-39-2-data-policy-live-gate.test.ts:607-672`.
- Precedent gates:
  - `story-39-2-data-policy-live-gate.test.ts`: `beforeAll` :137-172, `afterAll` :174-213, the profile row :523-551, audit :553-603;
  - `story-39-4-search-table-live-gate.test.ts`: the seed, rosters and replay.
  - Mock pattern: `message-resend-policy.test.ts:14,64-82` (`createMockCtx`, `createMockHttp`, `envelope`).

**Docs**
- Root `README.md`:
  - :17 (23), :21 (108), :91 (the `IRIS_DATA_POLICY` row);
  - after :545 (the governance-defaults row);
  - :668 (two pairs), :672-674 (the roster table), :680 (interop `core`/`developer`), :692 (the payload row), :696 (`Story 39.4`);
  - the PHI policy table :704-708;
  - :718 ("no tool takes a policy parameter yet") and :720 ("What it governs today", ending "no tool returns HL7 body text yet");
  - :758 (108-tool).
- `packages/iris-interop-mcp/README.md`: :45 (11/10, 24/23), the tool table after :160, a new `#### iris_message_body` subsection after the `iris_message_search` one, and :901 (23).
- `packages/iris-mcp-all/README.md`: :27, :31, :45. `packages/shared/README.md`: :87 (`TOOL_PAIRS`) and :92-94 (the data-policy exports).
- `docs/epic-summary.md:3`; `docs/migration-v1-v2.md` :11 and :29.
- `tool_support.md`:
  - :160 (Interoperability (23)), :186 (add row 24 after it), :188 (Mix);
  - the story notes :200-206 (add a 39.5 note; never write `` `interop` `` followed by a number before :430: the prompt-tally trap);
  - the scope table :385-420 (add the row) and :422/:424 (the closing sentences);
  - :442 (rollup) and :445 (Total).
- `CHANGELOG.md`:
  - a new top section (the top is Story 39.4 at :5);
  - the Epic 30 roster line :1293-1296 (`full` 32/27/24/22/8, `core` 15/13/11/10/8, `developer` 32/11/24/10/8, "as of Story 39.1"). `docs-visibility-roster-sync` reads the first `` `full` N/N/N/N/N `` match in the file, so the new section must not contain that pattern.
- `.changeset/story-39-4-search-table-lookup.md` is the precedent.

## Tasks & Acceptance

**Execution** (in dependency order):

*Task 0: probes, before any edit to an IRIS class.* Use `EXECMCPTMP395P`, built and removed with `createInteropNamespace`/`removeInteropNamespace`, and the probe class `Story395.Probe` compiled there. Record every result under Verification, with the IRIS version.
1. **(a) Sizes.** Save the `adt`, `ack`, `alt`, `big`, `huge`, `batchSmall` and `batchLarge` texts (Design Notes) with `Story391Fixture.SaveHl7`. For each, record:
   - `GetFullSize(id)` and the child `ParentId` values;
   - the probe's `Hl7Size` (the planned algorithm);
   - the length `OutputToLibraryStream` writes.

   **If `Hl7Size` exceeds the serialized length for any fixture**, stop. That would withhold a body that fits, so HALT the implement stage as `blocked` with the evidence. If it falls short for a shape, keep the post-serialization check, record the shape as a `deferred:` item, and amend the Sizes row in place (Rule #42).
2. **(b) The work bound.** On `huge`, take the minimum of three runs, with `$ZH`, of `OutputToLibraryStream` into `%Stream.TmpCharacter` (`serializeMs`) and of the probe `Hl7Size` (`sizeMs`). The ratio must be at least 8. If it is less, enlarge `huge` (at most 3,000,000 characters, under the 3,641,144 long-string limit) and measure again. If it is still less than 8, HALT `blocked` with the measurements.
3. **(c) XML.** `EnsLib.EDI.XML.Document.ImportFromString(<the XML text>, .tSC)`, `%Save`, then `OutputToLibraryStream`. Record the exact output: it is header 10's oracle.
4. **(d) JSON.** Compile `Story395.JsonBody`, save one, and record its exact `%JSONExportToStream` text: header 11's oracle.
5. **(e) Dump input.** Record the `%Dictionary.CompiledProperty` rows (Name, Type, Collection, Private, Internal, Calculated, Transient, MultiDimensional, SequenceNumber) of `Ens.StringRequest`, `Ens.StreamContainer` and `Story395.Plain`. Confirm the dump rules give the Design Notes JSON for headers 4 and 12, or amend those rows in place (Rule #42).
6. **(f) Batches.** `SaveHl7` of `batchSmall` and `batchLarge` returns the parent ID. The parent opens, and `OutputToLibraryStream` writes the whole batch, children included. Record the child count.
7. **(g)** A class compiled in P can call `ExecuteMCPv2.Temp.Story391Fixture`'s methods (the 39.4 precedent). The deployed `BOOTSTRAP_VERSION` is `b6ec56073e29`.

*Task 1: IRIS side.*

8. `src/ExecuteMCPv2/REST/MessageSearch.cls`: add `Hl7Size` (Boundaries, DW-577) and the precheck in `Hl7Text`. The doc comments state the contract: the sum stops at the limit, and children are included.
9. `src/ExecuteMCPv2/REST/MessageResend.cls`: `ValidateHeaderIds(pArr, Output pIds, pMax As %Integer = 100)`. With the default, it is byte-identical.
10. `src/ExecuteMCPv2/REST/MessageBody.cls` (new): the route of the Boundaries.
    - **`MessageBody()`** runs in order: `ReadRequestBody`, then `ValidateHeaderIds(…, 20)`, then `bodyRead` (an absent or null value is `kind`; anything other than the strings `kind`, `hl7` and `all` gives `Parameter 'bodyRead' must be kind, hl7 or all`), then `ReadInteger(body, "bodyTextMaxChars", 65536, 1, 1048576)`. Then `SwitchNamespace`, the interop check, and one `BodyOne` per ID, each with its own Try/Catch whose catch gives `{id, found: false, error: "Header <id> could not be read."}`. It restores the namespace, then renders once.
    - **`BodyOne`:**
      - `SELECT ID, MessageBodyClassName, MessageBodyId FROM Ens.MessageHeader WHERE ID = ?`;
      - not found gives `Header <id> not found`;
      - the item fields;
      - `SetBodyDetail(item, $Select(bodyRead = "kind": "kind", 1: "text"), max, …)`;
      - under `all`, the literal value (cut at `max`, with `bodyTextComplete`) for a `literal` header, and `RenderText` for every other available kind but `hl7v2`.
    - **`RenderText`** dispatches on the Design Notes renderer table. `vdoc` and `other` give `noRenderer` without opening anything, and every failure gives `unreadable`.
    - **`PropertyDump`** follows the dump rules.
11. `src/ExecuteMCPv2/REST/Dispatch.cls`: add the route.
12. `src/ExecuteMCPv2/Tests/MessageBodyTest.cls` (new; data-free, in HSCUSTOM; at most 500 lines; not in the manifest). It has four methods:
    - `TestReadsText`: the `bodyRead` × kind matrix;
    - `TestRenderNoRenderer`: `vdoc` and `other` give `noRenderer` when given `""` as the object;
    - `TestReadStreamText`: an unsaved `%Stream.TmpCharacter` of 30 characters at caps 10, 30 and 31, and an empty stream;
    - `TestPropertyDump`: an unsaved `Ens.StringRequest` gives `{"StringValue":"KEEPME-DUMP"}`, and an unsaved `Ens.StreamContainer` gives the Task 0 (e) property set, with no `Internal` stream property.
13. Run `pnpm gen:bootstrap`, after adding `MessageBody.cls` to `scripts/gen-bootstrap.mjs` after MessageSearch and to every `bootstrap.test.ts` roster (count 32). Record `BOOTSTRAP_VERSION` `b6ec56073e29` → new.

*Task 2: TypeScript.*

14. `packages/shared/src/data-policy.ts`: add `BodyPolicyPlan = {outcome: "none"} | {outcome: "blocked"; reason: string} | {outcome: "redact"}` and `decideBodyPolicy(kind, available, policy)` (Boundaries), with no runtime import. Export both from `index.ts`. In `packages/shared/src/__tests__/data-policy.test.ts`, add the full kind × available × policy table.
15. `packages/shared/src/tool-visibility.ts`: add `["iris_message_search", "iris_message_body"]` to `TOOL_PAIRS` and update the JSDoc. Update `tool-visibility.test.ts`.
16. `packages/iris-interop-mcp/src/tools/message-resend.ts`: export `headerIdSchema`. `applyPreviewBodyPolicy` delegates rules 2 to 4 to `decideBodyPolicy` (a `redact` plan becomes `redacted` with `redactedFields: 0` and the class note). Every existing preview test passes unchanged.
17. `packages/iris-interop-mcp/src/tools/message-body.ts` (new): `messageBodyTool`, plus the exported helpers `sanitizeBodyText`, `cutText` and `applyBodyReaderPolicy(items, policy, maxChars)`, which returns `{items, summary}`.
    - **The definition:** the name, the title "Read Interoperability Message Bodies", the schema, the annotations, `scope: "NS"`, `mutates: "read"` and `dataPolicy: {}`.
    - **The handler:**
      - the policy (tighten);
      - the wire table;
      - `ctx.http.post(\`${BASE_URL}/interop/message/body\`, …)`;
      - `interopEnabled: false` gives `notApplicable`;
      - `applyBodyReaderPolicy`;
      - the content lines;
      - an `IrisApiError` gives `isError` with `Error reading message bodies with iris_message_body: <message>`.
    - **The description** (what, when, returns; Conventions): read one to 20 messages' bodies by header ID, after `iris_message_search`. It covers:
      - the renderer list;
      - `maxChars` as an output cap, and that an XML or JSON body is serialized whole before it is cut;
      - that an HL7 v2 body is shown only whole, and how to read a longer one under `allow`;
      - the policy (`block`, `redact`, `allow`; HL7 v2 redacted by a reviewed keep-list; every other kind and an over-65536 HL7 body withheld under `redact`);
      - `dataPolicy` as tighten-only;
      - the per-body `bodyPolicy` and the `dataPolicy` counts;
      - that the policy reduces exposure and is not a compliance certification;
      - the default state: a read, enabled by default, `{"global":{"iris_message_body":false}}`.

      It names no REST path.
18. `packages/iris-interop-mcp/src/tools/index.ts` and `presets.ts`: register the tool, and add it to `core` and `developer`. The `presets.ts` header records `core` 11 package / 12 runtime and why the tool is everyday-loop (L-4, AD-7).
19. Tests (mocked HTTP; every fake reply has the live route's shape, Rule #54):
    - `packages/iris-interop-mcp/src/__tests__/message-body.test.ts` (new). It covers:
      - the definition and schema bounds;
      - the description claims;
      - the wire per policy and per tighten case;
      - every policy-table row (including an unknown kind, a version-skewed reply carrying `bodyText` on a stream or a `literal` `bodyId` under `redact`, an engine refusal, and `tooLarge`/`unreadable`);
      - redaction before truncation;
      - the sanitization rules and the surrogate-safe cut;
      - `notApplicable`;
      - not-found items;
      - `IrisApiError`;
      - no `SYNTHPHI` in any `redact` or `block` output.
    - `packages/iris-interop-mcp/src/__tests__/message-body-governance.test.ts` (new, the real `McpServerBase`, on the `message-search-governance.test.ts` pattern): enabled by default; denied by the operator key; the audit entry carries `dataPolicy` with the counts the response reported.
    - Update the interop `index.test.ts`, `presets.test.ts` (with the pairs test) and `presets.e2e.test.ts`, and the shared visibility tests.

*Task 3: the fixture, the gate and the rosters.*

20. `packages/iris-mcp-all/src/__tests__/interop-namespace-fixture.ts` (extend it; do not copy):
    - add `STORY395_SEED_SOURCE`, `STORY395_JSON_BODY_SOURCE`, `STORY395_PLAIN_SOURCE`, `STORY395_DOCUMENTS` (a: all three; b: the seed only) and `STORY395_IDS` (`a: {headers: "1,…,17"}`, `b: {headers: "1,2"}`);
    - add `seedBodyReader(dev, name, set)` through `putCompileSeed`;
    - widen the `Hl7Fields` guard and the `hl7Fields` doc.
21. `packages/iris-mcp-all/src/__tests__/story-39-5-body-reader-live-gate.test.ts` (new), on the 39.2 and 39.4 gate shape:
    - **`beforeAll`:**
      1. stale shared, dev, admin and interop dists fail it when armed, and so does an unreachable IRIS (the text `Story 39.5 live gate may not be skipped: …`, and the skip tag `[SKIP] story-39-5-body-reader-live-gate:`);
      2. `assertDeployedBootstrapVersion`;
      3. it puts the fixture class, removes A, B, C and P by name and asserts nothing is left;
      4. it creates A and B (interop) and C (no interop), seeds A (`a`) and B (`b`), and runs a positive leftovers control.
    - **`afterAll`:** each step in its own guard. It removes the namespaces, checks the leftovers, removes the fixture class and the temp files, and checks that `iris_doc_list` (HSCUSTOM, generated included) shows no `Story391Fixture` or `Story395` document.
    - **Rows:**
      - every matrix row through the BUILT interop server (the sessions: default, `IRIS_DATA_POLICY` `allow` and `block`, the `loose` profile, and audit with `onStderr`);
      - the route rows through `executeMcpPost`;
      - the DW-577 rows through `iris_execute_classmethod` in A;
      - the parser oracle through `hl7Fields`;
      - the performance budgets.
    - Add it to `prepublish-gate.mjs` `gateTestFiles` with a comment naming its namespaces, and to `story-39-1-gate-guards.test.ts` `GATES` (the driven packages are unchanged).
22. The shared-surface pins of the Code Map: the 39.1 gate counts, `docs-prompt-sync`, and the 39.1–39.4 doc-claims count and sentence pins.

*Task 4: scope, docs and counts.*

23. Scope:
    - `data-policy-scope.ts` gets the row `["iris_message_body", {scope: "governed", reason: "Returns message bodies under the policy: block withholds every body; redact shows an HL7 v2 body redacted by the reviewed keep-list and withholds every other body; allow shows bodies as stored."}]`, and `data-policy-scope.test.ts` gets the governed list.
    - `DATA_POLICY_SCOPE_DATE` and the anchor stay (Design Notes I9).
    - `tool_support.md` gets the same row (`governed`) and its closing sentences name the new tool.
24. Docs (Rules #30 and #43; 39.6 enriches):
    - every Code Map count line, the README governance-defaults row, the PHI policy table rows, the replaced "policy parameter" and "HL7 body text" sentences, the `IRIS_DATA_POLICY` row and the interop tool row and subsection. Each states the default state (a read, enabled by default) and the policy behavior;
    - a `tool_support.md` Story 39.5 note (counts, the new route, `BOOTSTRAP_VERSION` from → to, 32 classes, DW-577);
    - `CHANGELOG.md`, top section `## [Pre-release — 2026-10-17] — Story 39.5: Message body reader`:
      - Added: the tool, the route, `decideBodyPolicy` and the pair;
      - Changed: `Hl7Text`'s precheck, `ValidateHeaderIds` `pMax`, the bootstrap move and the counts;
      - then Tests;
      - no `` `full` N/N/N/N/N `` pattern;
    - the Epic 30 roster line, to the new counts and "as of Story 39.5", with the third pair;
    - `.changeset/story-39-5-message-body-reader.md` (`@iris-mcp/interop` minor, `@iris-mcp/shared` minor);
    - after rebuilding, the README payload rows equal `pnpm measure:tools-payload`, and :696 reads `Story 39.5`.
25. `packages/iris-mcp-all/src/__tests__/story-39-5-doc-claims.test.ts` (new) pins:
    - the CHANGELOG section, by title, with its version literals;
    - the changeset bump map (`skipIf` absent);
    - the README rows naming `iris_message_body` with its default state;
    - the interop subsection and the governance default;
    - the `tool_support.md` note, the API row and the scope row;
    - that no new text claims compliance (import `CLAIMS` from `doc-claims-patterns.ts`).

**Acceptance Criteria:**
- **AC-1 (39.5.1; AD-11, AD-13).**
  - Given 1 to 20 header IDs, when `iris_message_body` reads them, then each item's body class and ID equal the `Ens.MessageHeader` oracle, in request order, and a missing ID is `found: false` with `Header <id> not found`.
  - Given an unknown namespace, when a bad `headerIds`, `bodyRead` or `bodyTextMaxChars` is sent to the route, then the error names the parameter, and no namespace error appears.
- **AC-2 (39.5.2; Rule #56).**
  - Given fixture κ under `allow`, when it is read, then every kind renders as the exhaustive renderer table says: the XML and JSON texts equal their Task 0 recordings, and the dump follows the dump rules.
  - Given `maxChars` smaller than a shown text, when the body is read, then the text is cut at `maxChars` with `truncated: true`.
- **AC-3 (39.5.3; AD-26, AD-9).**
  - Given `redact` (the default), `block` or `allow`, when κ is read, then every item's `bodyPolicy` and the `dataPolicy` counts equal the κ table.
  - Given `redact`, when κ is read, then the raw route response holds no non-HL7 body content, and every HL7 text reaches `redactHl7` complete, before sanitization and truncation.
  - Given a caller `dataPolicy`, when the tool is called, then it only tightens, and a looser one sets `dataPolicyClamped: true`.
- **AC-4 (39.5.5; Rules #36, #59).**
  - Given `redact`, when κ is read through the built server, then no `SYNTHPHI` appears anywhere in the result, the `KEEPME` values survive, and IRIS's parser reads every kept position of each redacted HL7 body as in the original.
  - Given `allow` (operator or the `loose` profile), when κ is read, then the `SYNTHPHI` values appear.
  - Given a mutation that passes the HL7 text unredacted, when the `redact` sweep runs, then it goes red.
- **AC-5 (39.5.4; AD-4, AD-7, AD-5).** Given the built servers, when `tools/list` and the preset tests run, then:
  - `iris_message_body` has truthful read-only annotations, `mutates: "read"` (enabled by default) and `scope: "NS"`;
  - it is co-visible with `iris_message_search` in every preset;
  - interop is 24/25, `core` 12, `developer` 25 and the suite 109/114;
  - the baseline stays `1e62c5ad5bf7`/141.
- **AC-6 (DW-577; AD-20, Rule #59).** Given the huge HL7 body, when `Hl7Text` runs with the cap 65536, then it returns `tooLarge` in under a quarter of that body's serialization time, and `Hl7Size` equals the serialized length on every HL7 fixture, the two batches included.
- **AC-7 (Integration; Rules 1 and 2).**
  - Given the gate's sessions, when the built interop server's `iris_message_body` reads A, then it reads the new route, decides through `decideBodyPolicy` and redacts through `redactHl7`, and the built server's audit interceptor writes `dataPolicy` from the tool's declaration, with no `SYNTHPHI` in the audit file or stderr under any policy.
  - Given the preview, now on `decideBodyPolicy`, when the 39.2 unit and live preview rows run, then every one passes unchanged.
- **AC-8 (AD-15, AD-33, AD-14; Rules #34, #41).** Given the delivered tree, when the suites run, then:
  - the 39.1–39.4 captures replay byte for byte;
  - `MessageResendTest` (12), `MessagePreviewPolicyTest` (4), `MessageSearchTest` (5), `MessageBodySearchTest` (5) and `MessageSearchTableTest` (5) pass;
  - `BOOTSTRAP_VERSION` has moved with the roster at 32;
  - A and B give different bodies for header 1;
  - C answers `notApplicable`;
  - Z errors with the sanitized namespace text.
- **AC-9 (Rules #30, #43; AD-26 scope).** Given the built dists, when the scope and doc-claims tests run, then `iris_message_body` is a governed row in `data-policy-scope.ts` and `tool_support.md`, the docs state its default state and policy behavior, every count surface reads the new counts, and none claims compliance.

## Spec Change Log

## Review Triage Log

## Design Notes

**Plan-time interpretations** (apply and report):
- **I1. A new route, not the preview's `bodyDetail:"text"`.** 39.2 lists the preview route's text mode among 39.5's inputs. Rule #47 check: the preview route returns resend verdicts, takes up to 100 IDs and reads only HL7 text, so it cannot render XML, JSON or streams. 39.5 consumes the same machinery instead: `SetBodyDetail`'s `text` mode, `Hl7Text`, `BodyKind` and `BodyAvailable`, called by `MessageBody.BodyOne`.
- **I2. `bodyRead` makes least exposure hold IRIS-side.** Under `redact`, IRIS reads and sends HL7 text only. A stream, string, container, XML, JSON or literal value never leaves IRIS, so the TypeScript drop rule is a second line, not the only one (AD-26 "least exposure by default").
- **I3. HL7 v2 is shown whole or not at all, under every policy.** One read path keeps redaction on complete text. Under `allow`, the read cap is `max(maxChars, 65536)`, so a caller raises `maxChars` (up to 1048576) to read a longer message. Under `redact` the engine cap stays 65536 (`hl7TooLarge`). Other kinds are read as a prefix only under `allow`, where nothing is redacted, so AD-26's order ("truncation after redaction") is never at stake.
- **I4. The bounds.** The AC says only "bounded" and "a size cap", so these are plan-time choices:
  - at most 20 header IDs, since a session trace rarely exceeds that and 20 × 64 KB stays well inside the gateway budget;
  - `maxChars` defaults to 10000, so 20 bodies stay about 200,000 characters of context;
  - its maximum is 1048576, the route's existing `BODYTEXTMAX`.
- **I5. `vdoc` gets no renderer.** AC 39.5.2 lists the renderers, and "anything else → class and id only, with a reason" covers X12, EDIFACT, ASTM, ebXML and `EnsLib.REST.DynamicObjVDoc` (each has its own `OutputTo…` signature). `reopen_if`: a user asks to read a non-XML virtual document.
- **I6. Literal bodies.** For an empty body class, the header's body ID is the body.
  - Under `allow` it is shown as `text`.
  - Under `redact` and `block` it is `blocked` and `bodyId` is `""`.
  - The preview keeps 39.2's `none` for literal, because `decideBodyPolicy` takes `available` from the caller.
- **I7. The caller `dataPolicy` parameter** is the first consumer of `tightenDataPolicy` (39.2 I3). It is not a `phiInputs` entry, because a policy name is not PHI.
- **I8. `dataPolicy: {}`, with no actions,** because the tool is a single key. The audit records the applied (tightened) policy, since `deriveAuditDataPolicy` reads `structuredContent.dataPolicy.policy`.
- **I9. The scope date stays 2026-10-16.** `data-policy-scope.test.ts` fails until every tool has a row, which is the exhaustive mechanism (Rule #56). Moving the date would rename the anchor that the README links and two 39.2 pins hold. The `tool_support.md` 39.5 note dates the new row 2026-10-17.
- **I10. No fuzz.** No caller text reaches a statement: the header ID is bound, and property names in the dump come from the dictionary.
- **I11. DW-578** (context, owned by 39.2) is watched by the `redact` sweep over the live samples. A `SYNTHPHI` survivor in a kept segment line is its `reopen_if`, reported, not fixed here.

**Renderers** (exhaustive over `BodyKind`, as of 2026-10-17; source: `MessageSearch.BodyKind` :662 and irislib 2026.2 build 221U):

| Kind | Classes | `format` | How IRIS reads it under `all` |
| --- | --- | --- | --- |
| `hl7v2` | `EnsLib.HL7.Message` and subclasses | `er7` | `Hl7Text` (also under `hl7`): complete, or `tooLarge`/`unreadable` |
| `xmlvdoc` | `EnsLib.EDI.XML.Document` | `xml` | `OutputToLibraryStream` into `%Stream.TmpCharacter`, then up to the cap |
| `persistent` | any other `%Persistent`, e.g. `Ens.StringRequest`, `Ens.StringContainer` | `json` | `%JSONExportToStream` when `%Extends("%JSON.Adaptor")`, else `PropertyDump(obj).%ToJSON()`; up to the cap |
| `stream` | `%Stream.Object` | `text` | `Rewind`, then `Read` up to the cap; `bodyTextComplete` = `AtEnd` |
| `streamContainer` | `Ens.StreamContainer`, `EnsLib.HTTP.GenericMessage`, `Ens.MFT.StreamContainer` | `text` | its `Stream`, as for `stream` (a null stream gives `unreadable`) |
| `literal` | an empty class name | `text` | the header's body ID |
| `vdoc` | other `Ens.VDoc.Interface` documents | none | `noRenderer` |
| `other` | anything else | none | `noRenderer` (in practice it never opens) |
| `missing` | a class that is not compiled | none | not read |

**Dump rules** (`PropertyDump`). The properties come from `%Dictionary.CompiledProperty` of the object's class, ordered by `SequenceNumber` then `Name`. A property is skipped when it is `Private`, `Internal`, `Calculated`, `Transient` or `MultiDimensional`, or when its name starts with `%`. Each value is:
- a datatype: its logical value as a JSON string, `null` when `""`;
- a stream: `{"stream": <class>, "size": <Size>}`, never its content;
- an object: `{"class": <class>, "id": <%Id>}` when persistent, `{"class": <class>}` otherwise, `null` when unset;
- a list or array collection: `{"collection": "list"|"array", "count": <Count()>}`.

Expected (header 12, from `Story395.Plain.Make`):

```json
{"Name":"SYNTHPHI-PLAIN","Count":"7","Tags":{"collection":"list","count":1},"Note":{"stream":"%Stream.GlobalCharacter","size":13},"Ref":{"class":"Ens.StringRequest","id":"<s>"}}
```

`Secret` is private and `Temp` is transient, so neither appears; `<s>` is the seeded string body's ID.

**The `notShown` reasons** (fixed texts):
- **blocked:** the `bodyPolicy.reason`;
- **unavailable, missing:** "The body class is not compiled in this namespace, so the body cannot be read.";
- **unavailable, otherwise:** "The body does not open (it may have been purged), so it cannot be read.";
- **`noRenderer`:** "No renderer reads a `<kind>` body, so only its class and ID are shown.";
- **`tooLarge` under `allow`:** "The HL7 v2 body is longer than `<cap>` characters, so it is not shown; a larger maxChars (at most 1048576) reads it whole.";
- **`unreadable`:** "The body could not be read."

`<kind>` comes from the closed token list and `<cap>` is the number sent.

**Fixture sources** (compiled in A or B through `putCompileSeed`):
- **`Story395.Seed`.** It has three methods:
  - `Seed(pSet)` is guarded to `$NAMESPACE ? 1"EXECMCPTMP395"1U` and refuses a namespace with headers. It builds the κ bodies, saving them with the `Story391Fixture` helpers and with `ImportFromString`/`%Save` for XML. Headers go through `Story391Fixture.Add(395000 + n, 1, 9, 0, "Story395.Source", "Story395.Target", class, id, "2001-02-03 11:00:" + two-digit n)`. It returns `{"headers":"1,…,17"}`, or `{"headers":"1,2"}` for `b`.
  - `Sizes(pIds)` returns `[{id, precheck, serialized}]`.
  - `Timing(pId, pMax)` returns `{result, hl7TextMs, serializeMs}`, each the minimum of three `$ZH` runs.
- **The texts:**
  - `huge` is MSH, `PID|1||SYNTHPHI-MRN13`, then 40 OBX segments, each with an OBX-5 of 60,000 characters of `SYNTHPHI-HUGE `.
  - `batchSmall` is `FHS|^~\&|SYNTHPHI-FAPP`, `BHS|^~\&|SYNTHPHI-BAPP`, two MSH/PID messages (`SYNTHPHI-MRN15A`/`B`), `BTS|2` and `FTS|1`.
  - `batchLarge` has the same frame, with three messages each with an OBX-5 of 30,000 characters.
  - The XML is `<Patient><Name>SYNTHPHI-XML-NAME</Name><Code>KEEPME-XML</Code></Patient>`.
- **`Story395.JsonBody Extends (%Persistent, %JSON.Adaptor)`:** `Name` and `Code`.
- **`Story395.Plain Extends %Persistent`:**
  - `Name`, `Count As %Integer`, `Tags As list Of %String`, `Note As %Stream.GlobalCharacter` (`SYNTHPHI-NOTE`), `Ref As Ens.StringRequest`, `Secret As %String [ Private ]` (`SYNTHPHI-PRIVATE`) and `Temp As %String [ Transient ]`;
  - `ClassMethod Make(pRefId)` sets them all and saves.
- **B's message:** MSH, `PID|1||SYNTHPHI-B-MRN`, and `OBX|1|TX|B^KEEPME-B^L||SYNTHPHI-B-NOTE`.

**Extend, don't copy (Rule 2).**
- **Extended:**
  - `ValidateHeaderIds` (`pMax`), `SetBodyDetail`, `Hl7Text` (the precheck), `BodyKind`, `BodyAvailable`, `ReadInteger`, the interop check, and the handler shape of `MessageResendPreview`;
  - `applyPreviewBodyPolicy` → `decideBodyPolicy` (shared), `headerIdSchema` (exported), `BLOCK_REASONS`, `tightenDataPolicy`, `effectiveDataPolicy`, `redactHl7`, `TOOL_PAIRS`;
  - `putCompileSeed`, `Story391Fixture` (the `Hl7Fields` guard), `hl7Fields`, `checkRedactedPositions`, the gate helpers, `GATES` and `gateTestFiles`.
- **Siblings, with reasons:**
  - `MessageBody.cls` is a new class: `MessageSearch.cls` is already 1102 lines, and the body reader is its own route.
  - `structuredContent` is built as an object literal, so no `toStructured` copy is added.
  - `MessageBodyTest` is a new class, because the 39.2 policy test class is near its size and has another subject.
  - The live gate's local helpers stay file-private, because DW-561 (owned by 39.6) promotes one set into `process-gate-helpers.ts`.

**Integration (Rules 1 and 2).**
- **Integration ACs:** AC-7, plus the matrix's route, policy, audit and second-namespace rows, against the real instance.
- **Consumes:**
  - 39.1: `interop-namespace-fixture.ts` and `Story391Fixture`, `TypeLabel`, the gate helpers and the `notApplicable` pattern;
  - 39.2: `BodyKind`, `BodyAvailable`, `SetBodyDetail`, `Hl7Text`, `redactHl7`, `tightenDataPolicy`, `effectiveDataPolicy`, `BodyPolicyOutcome`, `BLOCK_REASONS` (all five), `HL7_BODY_TEXT_MAX_CHARS`, the audit plumbing, the scope table and `checkRedactedPositions`;
  - 39.3/39.4: `putCompileSeed`, the rosters and the gate shape.
- **Consumed-by:**
  - 39.6: capstone steps 4 and 5 (the body read under `redact` leaks no PHI, and under `allow` shows the value; proven red by disabling redaction), the `trace-message-flow` prompt (search, read, diagram), the patient-lookup prompt, and the docs enrichment;
  - the resend preview: `decideBodyPolicy`.

**Ledger inbox (Rule 17):**
- **DW-577:** addressed by Task 0 (a)–(b), items 8 and 21, the two DW-577 matrix rows, the cap-boundary row and AC-6.
- DW-578 is context, not owned (I11).

**Governing ADs.**
- **AD-26:** the binding AD: what redaction may read (whole HL7 text, then sanitization and truncation in TypeScript), body kind from `BodyKind`, unredactable kinds blocked under `redact`, least exposure (I2), the scope row, and no compliance claim.
- **AD-9:** tighten-only, and the clamp noted. **AD-3:** the policy through `ctx.config`.
- **AD-19:** the `dataPolicy` audit field, `outcome`, and no echo.
- **AD-4:** the key and its classification, with truthful annotations. **AD-7:** `TOOL_PAIRS`, the presets and the `core` size. **AD-5:** `:check` only. **AD-10:** no framework surface.
- **AD-11, AD-12 and AD-13:** the envelope, a thin handler (rendering is data gathering; sanitization and truncation stay in TypeScript), and validation before the switch.
- **AD-14:** the new class, both rosters, and the version move. **AD-15 and AD-33:** additive only, and the replays. **AD-20:** bounded IDs and the DW-577 work bound. **AD-29:** minor changesets.
- **Conventions:** Tool descriptions, Tool results (a new tool; `structuredContent` with `content`), Refusals (per-item outcomes inside a successful read), Error text, Logging, Live gates, Live testing on a shared instance, Probes, Performance budgets.

## Verification

Every command runs from `/Users/jbrandt/git/iris-execute-mcp-v2`, in the foreground, with `timeout: 600000`, one package per call.
- `ENV` is `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1`.
- MCP calls name `server:"default"`, with namespace `HSCUSTOM` or one of this story's `EXECMCPTMP395*` namespaces.

**Shared surfaces:** these change, and other tests assert on them.
- The interop tool list and counts: `index.test.ts`, `presets.test.ts`, `presets.e2e.test.ts`, `pre-feature-tool-snapshot.ts`, `tool-visibility-backcompat.test.ts`, the 39.1 gate counts, and the computed roster, payload and snapshot tests.
- `TOOL_PAIRS` (`tool-visibility.test.ts`, the per-package pair tests).
- The bootstrap roster and count, and `BOOTSTRAP_VERSION`: every armed gate redeploys.
- The scope table, its test and `tool_support.md`.
- The README, `tool_support.md` and CHANGELOG count and policy lines, and the 39.1–39.4 doc-claims and `docs-prompt-sync` pins on them.
- `applyPreviewBodyPolicy` internals (its tests stay unchanged).
- `Hl7Text` (the 39.2 text-mode rows).
- `ValidateHeaderIds` (`MessageResendTest`, the 39.1 replay).
- The `Hl7Fields` guard.
- `gateTestFiles` and `GATES`.

Standing criterion: every test added or changed passes on a fresh environment, in either order.
- The gate creates and removes all its own state: `EXECMCPTMP395A`, `EXECMCPTMP395B` and `EXECMCPTMP395C`, the `Story395.*` classes inside them, `ExecuteMCPv2.Temp.Story391Fixture`, and the temp files. Task 0 uses `EXECMCPTMP395P`, which is removed.
- OS classes run one class per `iris_execute_tests` call, and `total` is compared with the `Test*` count (Rule #35).

**Commands:**
- `(once)` Build shared, then dev, admin, interop, ops, data and client-config, one command each. Run Task 0.
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/data-policy.test.ts src/__tests__/tool-visibility.test.ts src/__tests__/tool-visibility-backcompat.test.ts src/__tests__/bootstrap.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/interop build && pnpm --filter @iris-mcp/interop exec vitest run src/__tests__/message-body.test.ts src/__tests__/message-body-governance.test.ts src/__tests__/message-resend-policy.test.ts src/__tests__/message-resend.test.ts src/__tests__/index.test.ts src/__tests__/presets.test.ts src/__tests__/presets.e2e.test.ts` -- expected: pass.
- `(loop)` Run each of these in its own call. First, after the first armed run deploys the new version, `iris_doc_load` `/Users/jbrandt/git/iris-execute-mcp-v2/src/**/MessageBodyTest.cls` (HSCUSTOM). Then `iris_execute_tests`:
  - `ExecuteMCPv2.Tests.MessageBodyTest` -- expected: total 4, 0 failed;
  - `MessagePreviewPolicyTest` -- expected: 4;
  - `MessageResendTest` -- expected: 12;
  - `MessageSearchTest` -- expected: 5.
- `(loop)` `ENV pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-39-5-body-reader-live-gate.test.ts` -- expected: pass armed, nothing left. Then, one per call, the 39.2 gate, the 39.1 gate, the 39.4 gate and the 39.3 gate -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/data-policy-scope.test.ts src/__tests__/story-39-5-doc-claims.test.ts src/__tests__/story-39-4-doc-claims.test.ts src/__tests__/story-39-3-doc-claims.test.ts src/__tests__/story-39-2-doc-claims.test.ts src/__tests__/story-39-1-doc-claims.test.ts src/__tests__/docs-prompt-sync.test.ts src/__tests__/docs-visibility-roster-sync.test.ts src/__tests__/tool-visibility-snapshot-drift.test.ts src/__tests__/tool-visibility-non-drift.test.ts src/__tests__/story-39-1-gate-guards.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/default-enabled-holders.test.ts` -- expected: pass.
- `(once)` For each of shared, dev, admin, interop, ops, data and client-config, one command each: `build`, `test`, `lint` and `type-check`. Then `ENV pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism`, then `ENV pnpm --filter @iris-mcp/all test` -- expected: green.
- `(once)` The remaining OS classes, one per call: `MessageBodySearchTest` (5) and `MessageSearchTableTest` (5).
- `(once)` A second `pnpm gen:bootstrap` -- expected: no diff. Also `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check`, `node scripts/check-epics-sync.mjs` and `pnpm measure:tools-payload` -- expected: OK, and the README rows equal the output.
- `(once)` Performance: the first armed bootstrap (budget 60 s), one `redact` read of A's 17 headers (budget 2 s), and the `Timing` row's numbers (recorded).
- `(once)` After every armed run:
  - `leftovers` for the four `EXECMCPTMP395*` names is `[]`;
  - `iris_namespace_list` and `iris_database_list` show none of them;
  - `iris_doc_list` (HSCUSTOM, `Story395` and `ExecuteMCPv2.Temp.`, generated included) is empty.

**Planned mutations (Rule 19).** For each: apply it, observe red, revert, rebuild any dist and reload any class, and confirm that `git status --short` and `git diff --stat` are unchanged. Record each as `mutation: <change> -> <red test>`.

| AC | Mutation | Expected red |
|---|---|---|
| AC-4 | under `redact`, `applyBodyReaderPolicy` returns the HL7 text unredacted | the `redact` sweep (live) and the unit no-`SYNTHPHI` row |
| AC-3 | `redact` sends `bodyRead:"all"` | the unit wire-per-policy row (the TypeScript drop rule keeps the live sweep green, which is the defense in depth I2 names) |
| AC-3 | `MessageBody.ReadsText` lets `hl7` read every kind (class reloaded) | the route `hl7` row (non-HL7 sentinels appear); `TestReadsText` |
| AC-3 | truncation runs before redaction | the unit `maxChars:5` row (blocked instead of redacted) |
| AC-3 | `tightenDataPolicy` bypassed (the caller's policy is used as given) | the tighten rows (`allow` loosens `redact`) |
| AC-3 | the literal `bodyId` kept under `redact` | the `redact` sweep (`SYNTHPHI-LITERAL`); the unit literal row |
| AC-6 | the precheck removed from `Hl7Text` | the DW-577 work-bound row |
| AC-6 | `Hl7Size` skips the children | the DW-577 exact row (15 and 16) and the `batchLarge` `redact` row |
| AC-6 | the precheck compares `>=` | the cap-boundary row |
| AC-2 | `PropertyDump` keeps `Private` or `Transient` properties | the header 12 row (`SYNTHPHI-PRIVATE`); `TestPropertyDump` |
| AC-2 | `cutText` ignores `maxChars` | the cap row |
| AC-1 | the route validates after `SwitchNamespace` | the route refusal rows (a namespace error appears) |
| AC-5 | the pair removed from `TOOL_PAIRS` | `tool-visibility.test.ts`; the interop pairs test |
| AC-5 | `iris_message_body` dropped from `core` | `presets.test.ts`; the visibility row |
| AC-7 | `dataPolicy` dropped from the definition | `message-body-governance.test.ts` (no audit `dataPolicy`); `data-policy-scope.test.ts` |
| AC-8 | `ValidateHeaderIds` texts use `pMax` without the default 100 | `MessageResendTest`; the 39.1 replay |
| AC-9 | the scope row removed | `data-policy-scope.test.ts` |

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
