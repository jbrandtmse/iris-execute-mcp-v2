---
title: 'Story 38.3: Storage Block Drop Guard'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_revision: '2e9114e99cb88240ed9e31d9b09f519fc014ee8c'
baseline_commit: '2e9114e99cb88240ed9e31d9b09f519fc014ee8c'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred:
  - summary: "The Storage scanner's ObjectScript brace count treats `;` as a comment start even inside an embedded &html< or &js< block, so CSS or JavaScript such as `.a {width:1px;}` hides the closing brace and the scanner loses sync for the rest of the class; on the current side a Storage definition after such a method is missed, so a drop of it is not refused (today's behavior, not a regression)"
    evidence: "Read-only sweep 2026-10-15 (IRIS 2026.2 build 221U): 2515 of 2516 %Dictionary.StorageDefinition parents match, the one mismatch is %SQL.Manager.UI (WizardStyle holds an &html< CSS block, scanner=[] vs dictionary=[Default]); probe `ClassMethod M() { &html<<style>.a {width:1px;}</style>> }` + Storage Default: IRIS reports Default, the scanner none. Spec Residual risk names embedded HTML. A fix would skip &html<...> and &js<...> by balanced angle brackets before the `;` and brace rules, and add the probe as an oracle fixture"
    location: 'packages/shared/src/storage-guard.ts:objectScriptBodyEnd'
    severity: low
    source: implement
  - summary: "A non-ObjectScript method body (Language = python, tsql, ...) ends only at a `}` in column 0 (spec rule 5), so a class whose members are indented (closing `    }`) or a Python string that holds a column-0 `}` line makes the scanner lose sync; on the proposed side that is a spurious STORAGE_DROPPED refusal (the override exists)"
    evidence: "Live probes 2026-10-15 (IRIS 2026.2 build 221U): indented members with a Python method closing `    }` then an indented Storage Default: IRIS reports Default, scanner=[]; a Python ''' string holding a column-0 `}` line: IRIS reports Default, scanner=[]. IRIS appears to count braces with Python string awareness instead. A fix would end the body at a `}`-only line indented like the opening `{`, and add both probes as fixtures"
    location: 'packages/shared/src/storage-guard.ts:foreignBodyEnd'
    severity: low
    source: implement
  - summary: "A few contrived headers and bodies where IRIS drops the Storage but the scanner still sees it (the proposed side then fails open): a `//` or `/* */` comment on the Class line, a header keyword string that holds both `{` and `[`, and a tsql trigger body holding `'{'`"
    evidence: "Live probes 2026-10-15 (IRIS 2026.2 build 221U): `Class X Extends %Persistent // plain` + `{` + Storage Default: IRIS reports none, scanner=[Default] (same for /* c */ and /* a { b */); `[ Description = \"a { and a [ in a string\" ]`: IRIS none, scanner Default (the same string with only `[`, only `]` or only `{` agrees); `Trigger Tl [ Language = tsql ] { PRINT '{' }`: IRIS none, scanner Default. None is a form IRIS exports; each needs a user to write it by hand"
    location: 'packages/shared/src/storage-guard.ts:headerBraceEnd'
    severity: low
    source: implement
  - summary: "The Storage scanner counts braces without string awareness inside a `[ ]` keyword value or a `( )` default and inside an XData body, and it never reports that it lost sync, so on the current side a Storage definition after such a member is missed (a drop of it is not refused; today's behavior) and on the proposed side a kept definition can read as dropped (a spurious refusal, with the override)"
    evidence: "Lead probes 2026-10-15 (IRIS 2026.2 build 221U, raw PUT, then deleted): a JSON XData body `{\"open\": \"use { to start\"}` followed by `Storage Default`: IRIS echoes Default, the scanner returns []; `Property Alpha As %String [ InitialExpression = {\"}\"} ];` followed by `Storage Default`: IRIS echoes Default, the scanner returns []. A fix would skip `\"` strings when counting braces for declaration values (and learn IRIS's XData rule), and report the scan as inconclusive when it reaches the end of the text inside a body so the guard can refuse instead of missing"
    location: 'packages/shared/src/storage-guard.ts:rawBodyEnd'
    severity: low
    source: review
---

<intent-contract>

## Intent

**Problem:** `iris_doc_put` replaces a whole class with whatever text it is given. When that text has no Storage block, IRIS drops the class's Storage definition. The next compile then generates new storage, which can silently change how existing rows are read (G5; reproduced live, see the probe record). The same tool also cannot update an existing document without `ignoreConflict` (DW-540), and its `metadataOnly` sibling reads a header IRIS never sends (DW-541).

**Approach:** Add one shared Storage-drop guard to `@iris-mcp/shared`: a UDL/XML scanner that names a class's Storage definitions, plus a function that returns the names the new text drops. It comes with the first refusal-code catalog. `iris_doc_put` first sends today's create request. For an existing document, Atelier refuses that request with HTTP 409 and returns the current document, so the guard's read costs no extra request. The tool then refuses a drop with `STORAGE_DROPPED`, unless `allowStorageRegeneration: true`. Otherwise it saves with `If-None-Match` set to the `ts` the 409 returned. Every document-writing path gets a recorded verdict, and a grep test pins the list.

## Boundaries & Constraints

**Always:**
- Names are compared exactly (case-sensitive). A rename is a drop; changing a definition's content is allowed. Only a `.cls` name (any case) is guarded.
- The scanner follows the probe-derived rules in the Tasks section. Only space and tab count as whitespace: a trailing `\r` inside an element is text, as it is for IRIS (probe G).
- A refusal is `isError: true`, writes nothing, and has `structuredContent.code` from the catalog. Error text has the form `<what happened>. <what to do about it>.`. Source text is ASCII (Rule 14), and comments state the contract.
- The first request ("P0" below) is exactly today's default request: `put(path, body)` with two arguments and no query. A 409 on the version-checked request ("Pv" below) is reported and never retried.
- Live checks name their target explicitly (the six `IRIS_*` variables). They write only the disposable `ExecuteMCPv2.Temp.QaStory383*` fixtures named under Verification, and remove those fixtures before and after the run: documents, compiled routines and data globals.

**Never:**
- No new tool, action or governance key. Do not change `mutates`, annotations, `TOOL_PAIRS`, any `presets.ts`, `governance-baseline.ts`, `bootstrap-classes.ts` or any `src/ExecuteMCPv2/**` class (`BOOTSTRAP_VERSION` stays `3af8ca401e7c`).
- Do not guard `iris_doc_load`, `iris_env_promote` `execute` or `iris_doc_xml_export` `import` (they get ledger verdicts instead). Do not change `iris_doc_get`'s no-range GET path, and do not fix DW-542 or DW-530.
- No line-splitting helper in this story (38.4 owns `\r?\n` splitting). No GET, and no HEAD, added to any put.
- No `changeset version`, no publish and no CI wiring (AD-29).

## I/O & Edge-Case Matrix

Request notation:
- **P0**: `put(<path>, body)`.
- **Pi**: `put(<path>?ignoreConflict=1, body)`.
- **Pv**: `put(<path>, body, {headers: {"If-None-Match": <ts>}})`.
- **E409**: an `IrisApiError` 409 whose `result` is the current document. It has the captured 9-key shape `{name, db, ts, upd, cat, status:"", enc:false, flags:0, content}`.
- "Today's" means the result and calls captured from the baseline tree.

Texts:
- **S** = `Document '<n>' was not saved in namespace '<ns>': the content drops <D> that the class has now, and IRIS would generate new storage at the next compile, which can change how existing rows are read. Nothing was stored. Keep the Storage definitions in the content (read the class with iris_doc_get first), or pass allowStorageRegeneration: true to let IRIS regenerate the storage.`
  - `<D>` is `the Storage definition 'A'`, or for several names `the Storage definitions 'A', 'B'` (in the order of the current source).
  - `structuredContent` is `{code:"STORAGE_DROPPED", name, namespace, droppedStorage}`.
- **C** = `Document '<n>' was not saved in namespace '<ns>': it changed on the server while this tool was saving it. Nothing was stored. Run iris_doc_put again to replace the current version.`
  - `structuredContent` is `{code:"DOCUMENT_CONFLICT", name, namespace}`.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| New class | `.cls` does not exist, no flags | P0 succeeds; today's result; one request | No error expected |
| New class, ignoreConflict | as above, `ignoreConflict:true` | P0 succeeds (no `ignoreConflict=1`); today's result; one request (interpretation 1) | No error expected |
| Both flags | `.cls`, `ignoreConflict` + `allowStorageRegeneration` | Pi only; today's calls and result, new or existing | No error expected |
| Existing class keeps storage | every current Storage name present | P0 returns E409, then Pv with the E409 `ts`, then success (DW-540) | No error expected |
| Keeps storage, ignoreConflict | as above, `ignoreConflict:true` | P0 returns E409, then Pi; the last call and the result equal today's | No error expected |
| Changed storage content | same names, different body | as the keeps-storage rows | No error expected |
| Drop | current {Default, Second}, new {Default}; or a rename Default to Main | P0 returns E409, then S with `droppedStorage` `['Second']` / `['Default']`; no further request | `isError: true` |
| Drop with override | `allowStorageRegeneration:true` | P0 returns E409, then Pv, then success | No error expected |
| Already absent | the current class has no Storage | allowed, as the keeps-storage row | No error expected |
| Decoys | the real block is removed; `// Storage Default`, `/* Storage X {...} */`, `///` and string mentions remain | S | `isError: true` |
| CRLF | string content with `\r\n` that keeps Storage | split as today; allowed | No error expected |
| CR elements | array elements ending in `\r` | S (IRIS would not parse the Storage member) | `isError: true` |
| XML content | XML export text; E409 echoes the current source in XML | names come from `<Storage name="...">` on both sides | as UDL |
| Non-class | `.mac`/`.inc`/other, new | P0; today's result | No error expected |
| Non-class existing | no flags | P0 returns E409, then Pv, then success (DW-540) | No error expected |
| Non-class, ignoreConflict | any | Pi; today's result; `allowStorageRegeneration` ignored | No error expected |
| Conflict | Pv rejected with 409 | C; exactly two requests | `isError: true` |
| Unreadable 409 | E409 whose `content` is not an array, `ts` is not a string, or `status` is non-empty | the original 409 is rethrown (today's `Tool error: IRIS returned HTTP 409 ...`); no second request | propagated |
| Other P0 error | 423, 500, network | propagated as today | propagated |
| Soft error | the last PUT returns 200 with a non-empty `result.status` | today's refusal text and shape | `isError: true` |

</intent-contract>

## Code Map

- `packages/iris-dev-mcp/src/tools/doc.ts`
  - `docPutTool` is at :291-382: the schema at :300-314, the BOM strip and split at :342-344, the single PUT at :353, and the soft-error refusal (`atelierDocStatusError`) at :358-370.
  - The `metadataOnly` HEAD branch is at :227-253, and the dead `Last-Modified` read at :231/:233 (DW-541).
  - Imports are at :13-24.
- `packages/shared/src/http-client.ts:90-96,392-407`
  - `put(path, body, {headers})` merges the headers.
  - A non-2xx response throws `IrisApiError` with `envelope.result` attached (`errors.ts:33-79`, `.result`).
- `packages/shared/src/atelier.ts:189` -- `atelierDocStatusError`, reused for the E409 `status` check.
- `packages/shared/src/lines.ts:45` -- `stripLeadingBomFromLines`, which the scanner applies to element 0. The barrel is at `packages/shared/src/index.ts:26-39`.
- `packages/shared/src/server-base.ts`
  - :1449 is the inline `code: "GOVERNANCE_DISABLED"` (the precedent).
  - :1740 reads that code in `deriveAuditOutcome`.
  - :1598-1605 renders a thrown handler error as `Tool error: <message>`.
- `packages/shared/src/bootstrap.ts:243-258` -- `deployClasses`: one PUT `?ignoreConflict=1` per entry of `BOOTSTRAP_CLASSES` (`bootstrap-classes.ts:32`, exported from `index.ts:68`), with the content `split("\n")`. No bootstrapped non-test class is persistent (grep).
- Tests:
  - `packages/iris-dev-mcp/src/__tests__/doc.test.ts` -- the put cases are at :185-370; four of them use two-argument `toHaveBeenCalledWith`, and :232-245 pins `Test.cls?ignoreConflict=1`. The `metadataOnly` fake with `Last-Modified` is at :103-127.
  - `doc-get-range.test.ts:163-178` pins `timestamp: undefined` with `toStrictEqual` (DW-541 occurrence).
  - `test-helpers.ts` provides `createMockHttp`, `createMockCtx` (Atelier v7, `USER`) and `envelope`. An example 409 fake is at `env-promote-execute.test.ts:983`.
- Live:
  - `live-doc-helpers.ts` provides `docPath`, `readStoredLines` and `removeStored`.
  - `doc-get-range-live-gate.test.ts:114-130` has local raw `putDoc`/`putStatusCode`, and its setup is at :40-106 (the sibling pattern).
  - The dev roster is at `scripts/prepublish-gate.mjs:73-85` (`gateTestFiles`).
- Source-scan siblings:
  - `packages/iris-mcp-all/src/__tests__/live-gate-roster.test.ts:12-40` reads the packages from disk.
  - `extensions/iris-mcp-launcher/src/__tests__/containment.test.ts:137-168` pins an exact call-site set.
- Write paths (plan inventory, 2026-10-15). There are six TS `.put(` sites:
  - `doc.ts:353`;
  - `load.ts:456`;
  - `env-promote.ts:869`;
  - `bootstrap.ts:253`;
  - `docdb.ts:476` (a DocDB JSON record);
  - `global.ts:142` (a global node).

  There is one `"action/xml/load"` site, at `format.ts:218`. In `src/ExecuteMCPv2/REST/Interop.cls`:
  - `%Dictionary.ClassDefinition`/`XDataDefinition` `%New()` at :97/:102 (production create);
  - `SaveToClass(` at :667, :677, :693, :695, :866 and :939;
  - `EnableConfigItem(` at :452 and :460;
  - `CreateApplication(` at :2330.

  No `OBJ.Load`, `ImportDir`, `SetTextFrom*` or `%Routine*).%New(` appears outside `Tests/`.
- Docs:
  - `packages/iris-dev-mcp/README.md:146` is the tool row, and `:339-361` is the put `<details>`.
  - In `CHANGELOG.md`, the newest section is at :5, in the form `## [Pre-release — <date>] — Story X.Y: ...`.
  - The changeset format follows `.changeset/story-38-2-line-range-document-read.md`.
  - The root `README.md:622-630` payload table is re-measured with `pnpm measure:tools-payload`.
- The dev package imports `@iris-mcp/shared` through `dist`, so rebuild shared before any dev test. Read-only: `presets.ts`, `governance-baseline.ts`, `bootstrap-classes.ts`, `src/ExecuteMCPv2/**`.

## Tasks & Acceptance

**Execution:**
- `packages/iris-dev-mcp/src/__tests__/doc-put-storage-guard.test.ts` (new) -- FIRST, on the unmodified tree, add the back-compat describe. -- AC-4.
  - Its fakes are real shapes from the probe record:
    - a 201 class create `{..., cat:"CLS", flags:1, content:["Storage Default","{","<Type>%Storage.Persistent</Type>","}",""]}`;
    - a routine create `{flags:0, content:[]}`;
    - E409 as in the matrix;
    - the 200 soft error from `doc.test.ts`.
  - It pins with `toEqual` the whole ToolResult and every `put`/`get`/`head` call for:
    - a new class (default, and `ignoreConflict`);
    - an existing class with `ignoreConflict` (one Pi);
    - a new `.mac`;
    - a `.mac` with `ignoreConflict`;
    - a BOM string;
    - the soft error.
  - Paste the values as literals and cite the capture command (Rule #36).
- `packages/shared/src/refusals.ts` (new) -- the catalog, with JSDoc stating its contract. -- AC-9.
  - `REFUSAL_CODES = {GOVERNANCE_DISABLED, STORAGE_DROPPED, DOCUMENT_CONFLICT}`, where each value equals its key.
  - `type RefusalCode`.
  - `refusalResult(code, text, fields)` returns `{content:[text], structuredContent:{code, ...fields}, isError:true}`.
  - `server-base.ts` :1449 and :1740 use `REFUSAL_CODES.GOVERNANCE_DISABLED`; the output stays byte-identical.
- `packages/shared/src/storage-guard.ts` (new) -- the guard. -- AC-2.
  - Exports:
    - `isClassDocument(name)`: true for `/\.cls$/i`.
    - `storageDefinitionNames(lines: readonly string[]): string[]`.
    - `droppedStorageDefinitions(current, proposed)`: the names in `current` that are absent from `proposed`, in `current` order.
    - `storageDroppedRefusal(name, namespace, dropped, remedy)`: S up to "Nothing was stored.", then the remedy, built with `refusalResult`.
  - Scanner rules (each from a probe). Strip one BOM from element 0.
    1. **XML or UDL.** The text is XML when its first non-blank element starts with `<`. Then the names are the `name` attribute of each `<Storage name="...">` outside `<!-- -->` comments and `<![CDATA[ ]]>` sections.
    2. **UDL class body.** In UDL, the class body opens at the first `{` after the line whose first word is `Class` (case-insensitive) that is not inside the header's `[ ... ]` keyword list. A `{` inside that list is a keyword value (`Owner = {%Developer}`), and its braces are counted to their match. Header `//` and `/* */` comments and `"` strings are skipped; with no class header the result is `[]`.
    3. **Member level.** At member level, skip:
       - space, tab and line ends;
       - `//` to the end of the line (this covers `///`);
       - `/* ... */` across lines;
       - any other character that starts no comment, member or `}` (for example a stray `;`).

       A `}` ends the class.
    4. **Member declarations.** A member is a keyword, then its declaration up to an unquoted `;` (no body) or `{` (body); `"..."` with `""` escapes is skipped. A `{` inside the declaration's `( )` formal list or `[ ]` keyword list is a value, not the body (`b = {1}`, `SqlComputeCode = {...}`), and its braces are counted to their match. The keyword `Storage`, in any case, with a body records the name that follows: `[%A-Za-z][A-Za-z0-9]*`, with only space, tab and line breaks between the keyword, the name and the `{`. So `Storage Default [ x ]` is not a definition (IRIS reports none), and a trailing `\r` is text.
    5. **Bodies.**
       - A member's language is the `Language = <lang>` keyword (any case, quoted or not) of its declaration's `[ ]` list; a formal parameter named `Language` sets nothing. With no such keyword, a `ClientMethod` is JavaScript, a `Trigger` is ObjectScript, and a `Method`/`ClassMethod` takes the class header's `Language` keyword, else ObjectScript (amended at code review, live probes; see the Spec Change Log).
       - An ObjectScript `Method`/`ClassMethod`/`ClientMethod`/`Trigger` (language `objectscript`/`cache`, or none) counts braces outside `"` strings, `//` and `;` comments (`;` covers `#;`), and `/* */`.
       - Any other method or trigger language ends at the first element that is `}` in column 0 followed only by spaces or tabs.
       - Every other body (XData, Storage, Query, ...) counts braces with no string or comment awareness.
- `packages/shared/src/index.ts` -- export the new symbols. -- AC-2, AC-9.
- `packages/shared/src/__tests__/refusals.test.ts`, `storage-guard.test.ts` (new) -- tests for the catalog and the guard. -- AC-2, AC-6, AC-9.
  - Catalog: the values are unique, each value equals its key, and every value matches `^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$`; `refusalResult` has the right shape.
  - Scanner fixtures (Rule #58), each with its expected names pinned from the live oracle run:
    - probes A, B, C, D, E, G and the XML of B;
    - compact `Class X Extends %Persistent {`;
    - 4-space-indented members;
    - a BOM;
    - a CRLF string split by `/\r?\n/`;
    - `<Storage name=` inside CDATA;
    - no class header;
    - `[]`.
  - `droppedStorageDefinitions`: the order, a rename, a content change, none to drop.
  - The bootstrap PUT verdict: every `.cls` in `BOOTSTRAP_CLASSES` has zero Storage definitions.
- `packages/iris-dev-mcp/src/tools/doc.ts` -- implement the matrix in `docPutTool`. -- AC-3, AC-7.
  - **Flow.** Choose the flow as follows:
    - If (not a class, or `allowStorageRegeneration`) and `ignoreConflict`, send Pi as today.
    - Otherwise send P0.
      - On E409, check that the current document is readable, else rethrow.
      - For a class without the override, an S result for `droppedStorageDefinitions(e.result.content, lines)` ends the call.
      - Then send Pi when `ignoreConflict`, else Pv. A 409 on Pv returns C.
    - Today's soft-error and success handling follow, applied to the final response.
  - **Schema.** Add `allowStorageRegeneration: booleanParam.optional()` with this description: "Boolean (true/false), default false. When false, a put to an existing class whose content drops one of the class's Storage definitions is refused and nothing is stored; changing a Storage definition's content is allowed. When true, the put goes ahead and IRIS generates new storage at the next compile, which can change how existing rows are read. No effect on a new class or on other document types."
  - **`ignoreConflict` description.** It becomes: "Boolean (true/false), default false. Not needed to replace an existing document: without it the tool reads the document's current version and saves only if it is still that version. When true, IRIS skips that version check."
  - **Tool description.** Append: "An existing document is saved only if it has not changed since this tool read its current version; ignoreConflict skips that check. For an existing class, a put whose content drops one of the class's Storage definitions is refused and nothing is stored, because IRIS would generate new storage at the next compile, which can change how existing rows are read; allowStorageRegeneration (default false) lets it through, and changing a Storage definition's content is always allowed."
  - **DW-541.** `metadataOnly` returns `{exists:true, name, etag}`.
- `packages/iris-dev-mcp/src/__tests__/doc-put-storage-guard.test.ts` -- cover every matrix row. -- AC-3, AC-7.
  - Exact texts and `toEqual` on `structuredContent`, call lists and call counts (refusal: one put; C: two; never three).
  - Description and parameter cases naming `allowStorageRegeneration`, "default false" and `If-None-Match` behavior.
- `packages/iris-dev-mcp/src/__tests__/doc.test.ts` -- update two tests deliberately. -- AC-7, AC-8.
  - :232-245: change the document to `Test.mac`. The `.cls` + `ignoreConflict` request is now P0, covered by the new file.
  - :103-127: the HEAD carries only `ETag`, and the expected result is `{exists, name, etag}`.
- `packages/iris-dev-mcp/src/__tests__/doc-get-range.test.ts:177` -- update the `structuredContent` pin to `{exists:true, name:"Test.Fixture.cls", etag: TS}`. The text pin :174 is unchanged. Note beside it: the always-undefined key is gone (DW-541), and the wire JSON is unchanged. -- AC-8.
- `packages/iris-dev-mcp/src/__tests__/live-doc-helpers.ts` -- extend the helpers. -- Rule 2.
  - Add raw helpers `putDocLines(client, version, ns, docName, lines, headers?)`, `putStatus(...)`, `compileDocs(client, version, ns, names)` and `runQuery(client, version, ns, sql)`.
  - Move 38.2's local `putDoc`/`putStatusCode` here and point that gate at them.
- `packages/iris-dev-mcp/src/__tests__/doc-put-storage-guard-live-gate.test.ts` (new) -- the live gate. -- AC-1, AC-2, AC-5, AC-7.
  - **Setup.** The sibling per-file setup, with its own `process.env.IRIS_REQUIRE_LIVE ===` comparison. `beforeAll` and `afterAll` clean up in this order:
    1. `%KillExtent()` on `QaStory383Guard`, through the `iris_execute_classmethod` handler;
    2. every global whose name starts `ExecuteMCPv` and contains `QaStory383` is killed through the `iris_global_list` and `iris_global_kill` handlers;
    3. `removeStored` on each fixture.

    Afterwards the gate asserts that `iris_doc_list` (with `generated: true`) and `iris_global_list` are empty for `QaStory383`.
  - **Guard** (the `Guard` fixture: persistent, `Alpha` then `Beta`, compiled, 2 rows inserted).
    - A put dropping its storage is S, both with no flags and with `ignoreConflict`. Afterwards the source, the `ts`, `SELECT COUNT(*)` = 2 and the Storage lines are unchanged.
    - A content change inside the Storage block is saved.
    - A default-mode put that keeps the storage saves, and the `ts` changes (DW-540).
    - The override, with the properties reordered, saves. The source then has no Storage; after compile, `SELECT` shows the values swapped (the AC 38.3.1 data-layout record).
  - **Other fixtures.**
    - `Multi`: Default + Second; dropping Second gives `['Second']`.
    - `NoStorage`: allowed.
    - The `.mac`: existing, default mode, saves.
    - CRLF string: allowed. CR elements: S. Decoys: S.
  - **Spy checks.** Spies on the real client prove that a new class and a new `.mac` make one PUT and no GET or HEAD, and that an existing class makes exactly P0 then Pv.
  - **Oracle.** For each unit scanner fixture, `Shape` is created by a raw PUT. `storageDefinitionNames(fixture)` must equal the names IRIS returns (the 201 `flags:1` content `^Storage (\S+)$`, or none). This also pins the 409 shape.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` -- add the gate to `gateTestFiles`, with a one-line comment naming its fixtures.
- Ledger (run from the repo root) -- the three verdict rows (AC-6). Record the printed ids.
  - `bash _bmad/scripts/ledger.sh _bmad-output/implementation-artifacts/deferred-work.md new "<summary>" "spec-38-3-storage-block-drop-guard.md" med med out-of-footprint "<evidence>" wontfix-accepted 38-3-storage-block-drop-guard implement "<note>"`, once for each row:
    - (a) `iris_doc_load` (`load.ts:447-456`, ignoreConflict on by default, no storage check), note `reopen_if=a class loses its Storage after iris_doc_load uploads a file without it (user report or ledger occurrence)`;
    - (b) `iris_env_promote execute` (`env-promote.ts:868-869`, `ignoreConflict=1`; a sync replaces the target's storage by design; plan-gated, default-disabled), note `reopen_if=promote execute replaces a target class that has Storage with a source copy that has none (report)`;
    - (c) `iris_doc_xml_export import` (`format.ts:218`; an export carries `<Storage>`), note `reopen_if=an XML import replaces a class that has Storage with a definition that has none (report)`. Row (c) is filed only if orchestrator decision 2 is accepted.
- `packages/iris-mcp-all/src/__tests__/document-write-paths.test.ts` (new) -- the grep test. -- AC-6.
  - **Roster.** `DOCUMENT_WRITE_PATHS` holds `{file, pattern, count, verdict, reason, ledger?}` entries.
    - The verdict is one of `guarded`, `excluded` (with a DW id), `not-applicable` or `not-a-document-write`.
    - The entries are, in order: the put (guarded); load, promote and xml/load (excluded); bootstrap (n/a: no storage, pinned by the shared test); docdb and global (not a document write); production create, SaveToClass, EnableConfigItem and CreateApplication (n/a: production or REST classes have no Storage).
  - **Scan.** It reads, from disk and in order:
    - `packages/*/src/**/*.ts` (not `__tests__`, `*.test.ts` or `bootstrap-classes.ts`);
    - `packages/*/scripts/**/*.mjs`;
    - `scripts/**/*.mjs`;
    - `extensions/*/src/**/*.ts` (not tests);
    - `src/ExecuteMCPv2/**/*.cls` (not `Tests/`).

    The patterns are `/\.put\(/g`, `/["'`]action\/xml\/load/g`, `/SaveToClass\(/g`, `/EnableConfigItem\(/g`, `/CreateApplication\(/g` and `/##class\(%Dictionary\.\w+Definition\)\.%New\(/g`. These patterns must find zero: `/\bOBJ\)?\.Load\w*\(/gi`, `/ImportDir/gi`, `/SetTextFrom(Array|Stream)/g` and `/##class\(%(Routine|RoutineMgr)\)\.%New\(/g`.
  - **Assertions.** The found (file, pattern, count) set equals the roster. A failure names the file and says how to add a verdict. A non-empty guard requires the put to be found.
  - **Counts.** The counts are pinned from the scan after implementation (Rule #51).
- `packages/iris-dev-mcp/README.md` -- the docs. -- AC-6 (Rule #43).
  - In the :146 row, add `allowStorageRegeneration?` (default: **false**) and change `ignoreConflict?` to "default: **false**; skips the version check".
  - In the :339-361 `<details>`, add the guard, a refusal example with `structuredContent`, the override, the DW-540 save and the unguarded paths.
- `CHANGELOG.md`, `.changeset/story-38-3-storage-block-drop-guard.md` (new) -- AD-15, AD-29.
  - The top section is `## [Pre-release — 2026-10-15] — Story 38.3: Storage block drop guard`.
  - `### Changed — safety: iris_doc_put refuses a put that drops a class's Storage definition (sanctioned, AD-15)` gives the code, the fields, the override, the reason, and that the request and the result are otherwise unchanged.
  - `### Fixed` covers DW-540 (an existing document saves without `ignoreConflict`; before, `HTTP 409`) and DW-541.
  - `### Added` lists the shared exports.
  - The changeset is `"@iris-mcp/shared": minor` and `"@iris-mcp/dev": minor`.
- `README.md:622-630` -- re-measure with `pnpm measure:tools-payload` and paste the numbers (Rule #51).

**Acceptance Criteria:**
- AC-1 (38.3.1): Given the probe record under Design Notes, when the live gate runs armed, then its pins hold:
  - the Storage UDL shape;
  - a put without Storage drops it and the compile regenerates it;
  - the reorder swaps existing rows;
  - E409 carries the current document.

  Auto Run Result records the IRIS version.
- AC-2 (38.3.2): Given every scanner fixture, when it is run through `storageDefinitionNames` and through IRIS, then the names are equal, and `droppedStorageDefinitions` returns exactly the dropped names.
- AC-3 (38.3.3): Given any matrix input, when `iris_doc_put` runs, then it returns the matrix outcome. A refusal writes nothing. No path sends a GET or HEAD, and a new document (class or not) makes exactly one request. The parameter's default is documented.
- AC-4 (38.3.4): Given the baseline literals, when the unchanged rows run, then their ToolResults and calls are `toEqual` to the literals. The ignoreConflict rows match interpretation 1, and `CHANGELOG.md` names the safety change under 38.3.
- AC-5 (38.3.5): Given the fixture with rows, when the gate runs, then:
  - a drop is refused, and the row count and the storage are unchanged;
  - the override saves;
  - the varied fixtures behave as in the matrix;
  - nothing named `QaStory383` remains (documents, routines, globals).
- AC-6 (38.3.6, AD-24): Given the tree, when the grep test runs, then every write path has a verdict. Adding a `.put(` call to a non-test source file turns it red. Rows (a) and (b), and (c) if accepted, exist with `reopen_if`. The README lists the guarded and unguarded paths.
- AC-7 (DW-540): Given an existing class or routine, when it is put with no flags, then it is saved with `If-None-Match` set to the E409 `ts`, live and in unit tests, and the `ignoreConflict` description is corrected.
- AC-8 (DW-541): Given `metadataOnly`, when it runs, then `structuredContent` is `{exists, name, etag}`, no fake sends `Last-Modified`, and the 38.2 pin is updated with its reason.
- AC-9: Given the catalog, when its test runs, then the codes are unique and well formed, and `GOVERNANCE_DISABLED` results are byte-identical.
- AC-10: Given the finished tree, when the gates run, then:
  - the per-package build, test, lint and type-check pass;
  - `:check` exits 0 at `1e62c5ad5bf7`/141;
  - dev has 29 tools;
  - there is no diff in `bootstrap-classes.ts`, `src/`, `presets.ts` or the baseline;
  - `droppedStorage` is absent from every other tool's output (grep).

### Review Findings

Code review 2026-10-15 (bmad-code-review, `review_tier: full-opus`). Four layers ran and delivered (Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor). Diff `2e9114e..HEAD` plus QA's working tree. There were 30 raw rows, which grouped into 20 entries: 11 patch, 4 defer, 5 rejected, 0 decision-needed. No high. The live probes ran on IRIS 2026.2 build 221U, `default`/HSCUSTOM, against `ExecuteMCPv2.Temp.QaStory383Shape`, which was deleted after each probe.

- [x] [Review][Patch] The scanner took "no `Language`" to mean ObjectScript, and IRIS disagrees. A `ClientMethod` is JavaScript, and a class header's `Language` keyword sets the default for `Method`/`ClassMethod`. Both were live-probed: IRIS reports `Default` where the scanner returned `[]`, so the guard failed open on both sides. A `Trigger` keeps ObjectScript, also probed. This is QA's in-story item, found by all four layers; the earlier triage's "maybe-false" Edge 3 was wrong. [packages/shared/src/storage-guard.ts:315]
  - Severity: med. Fix-risk: low (a default-language lookup, five live-pinned fixtures, 4 mutations red). Footprint: in-story. Spec: rule 5 amended in place, with a Spec Change Log entry.
- [x] [Review][Patch] `Language =` was read from the whole declaration, so `ClassMethod Greet(Language = "en")` was scanned as a foreign language. Live: IRIS reports `Default`, the scanner returned `[]`. It is now read from the `[ ]` keyword list only, as rule 5 says. [packages/shared/src/storage-guard.ts:335]
  - Severity: low. Fix-risk: low. Footprint: in-story. One fixture and one mutation.
- [x] [Review][Patch] The module comment, CHANGELOG and dev README overstated the scanner's fidelity. The comment said "fails safe" on the proposed side, but deferred item 3 shows that side can fail open, and none of the three said that a drop can go unrefused. The wording is corrected. [packages/shared/src/storage-guard.ts:15]
  - Severity: low. Fix-risk: low (prose only). Footprint: in-story.
- [x] [Review][Patch] The CHANGELOG's "Otherwise unchanged" bullet said an existing routine, include file or kept-Storage class gives "the result it was", which contradicts the DW-540 Fixed entry. It is reworded: the claim holds for new documents and `ignoreConflict: true`. [CHANGELOG.md:28]
  - Severity: low. Fix-risk: low. Footprint: in-story.
- [x] [Review][Patch] Two roster patterns had gaps: `%Library.RoutineMgr` `%New(` was not matched, and nothing caught `%Dictionary.*Definition` `%Open(`/`%OpenId(`. The forbidden pattern is widened, and a `dictionaryOpen` pattern is added (zero hits today). [packages/iris-mcp-all/src/__tests__/document-write-paths.test.ts:56]
  - Severity: low. Fix-risk: low. Footprint: in-story. 2 mutations red.
- [x] [Review][Patch] DW-547's `reopen_if` cited an implement-stage sweep that nothing in the repo runs. A trailer now restates it as an observable probe, a Storage loss or a red oracle fixture. [_bmad-output/implementation-artifacts/deferred-work.md]
  - Severity: low. Fix-risk: low. Footprint: in-story.
- [x] [Review][Patch] The `GOVERNANCE_DISABLED` byte-identical tests were not hermetic. `McpServerBase.start` also reads `IRIS_SERVER_MANAGER`, `IRIS_SM_*` and `IRIS_CREDENTIAL_HELPER`, and ambient `IRIS_SERVER_MANAGER=bogus` turned 2 of 8 red. All five are now cleared and restored. [packages/shared/src/__tests__/refusals.test.ts:131]
  - Severity: med (Rule 19 hermeticity). Fix-risk: low. Footprint: in-story. Mutation red.
- [x] [Review][Patch] The live check "a new class with ignoreConflict ... answers as the flagged request" compared two creates whose Storage echoes were both empty (fixture A). It now runs on fixture F and asserts the echo, and a handler mutation that blanks the echo turns it red. [packages/iris-dev-mcp/src/__tests__/doc-put-storage-guard-live-gate.test.ts:868]
  - Severity: low. Fix-risk: low. Footprint: in-story.
- [x] [Review][Patch] AC-1's `mutation:` line said no repo mutation applies. A fixture mutation was run on an armed live run, observed red and recorded under Verification. [_bmad-output/implementation-artifacts/spec-38-3-storage-block-drop-guard.md]
  - Severity: low. Fix-risk: low. Footprint: in-story (tracking).
- [x] [Review][Patch] The README unguarded-paths test claimed to follow the roster but checked only a hand list. It now derives the roster's `excluded` and `not-a-document-write` files from the roster source and requires them to equal the list. [packages/iris-mcp-all/src/__tests__/story-38-3-qa-doc-claims.test.ts:331]
  - Severity: low. Fix-risk: low. Footprint: in-story. Mutation red.
- [x] [Review][Patch] The back-compat header said that only "the two call lists" changed from the baseline capture. The existing-class row's 409 fake was added too, and the header now says so (Rule #36 provenance). [packages/iris-dev-mcp/src/__tests__/doc-put-storage-guard.test.ts:13]
  - Severity: low. Fix-risk: low. Footprint: in-story.
- [x] [Review][Defer] `iris_doc_load` with `ignoreConflict: false` sends an unversioned PUT, so every existing document gets 409 (the DW-540 defect, unfixed for load). [packages/iris-dev-mcp/src/tools/load.ts:449]
  - Deferred: pre-existing and out of footprint (the Never list excludes load). Filed as **DW-549**, `escalated owner=burndown`. Severity: med. Fix-risk: med (a behavior change, like decision #7).
- [x] [Review][Defer] The scanner loses sync on an ObjectScript JSON literal holding `\"` and on `&sql` with `'{'`. Live: IRIS reports `Default`, the scanner returns `[]`. [packages/shared/src/storage-guard.ts:objectScriptBodyEnd]
  - Deferred: the root cause is already adjudicated. Recorded as an occurrence on **DW-547**.
- [x] [Review][Defer] A one-line foreign body (`[ Language = python ] { return 1 }`) desyncs the column-0 rule. Live: IRIS reports `Default`, the scanner returns `[]`. The 409's current text desyncs the same way, so a drop can also pass, not only be over-refused. [packages/shared/src/storage-guard.ts:foreignBodyEnd]
  - Deferred: the root cause is already adjudicated. Recorded as an occurrence on **DW-548**, with `reopen_if` widened to cover the fail-open side.
- [x] [Review][Defer] This is my own Rule 2 check. Three `iris-mcp-all` repo-scan tests each carry a directory walker: `story-38-0-qa-doc-claims`, and the new `document-write-paths` and `story-38-3-qa-doc-claims`. Their skip sets differ, and no reason is stated. [packages/iris-mcp-all/src/__tests__/document-write-paths.test.ts:159]
  - Deferred: a LOW that is not a two-way door (it needs a shared helper across three files). Filed as **DW-550**, `wontfix-accepted` with `reopen_if`.

**Rejected:**
- `low`: the DW-540 default-put wording (that the version check reads as protecting the caller's copy, and that it should be Changed rather than Fixed). The two descriptions are prescribed verbatim by the Tasks section, and orchestrator decision #7 put the change under Fixed, so a fix would edit the spec (by-design).
- `low`: the write-path roster misses `iris_execute_command`/`classmethod` arbitrary code, the IPM install and the DocDB create/property endpoints. AD-24 scopes the enumeration to Atelier PUT, `xml/load` and the bootstrap PUT. These are user-supplied code, an external installer of this project's own classes, and IRIS-generated DocDB classes that are not source replacements. Extending the scope would edit the AD (by-design).
- `low`: `storageDroppedRefusal([])` builds a malformed text. The JSDoc requires at least one name, and the only caller (and 38.4's planned reuse) refuses only on `dropped.length > 0`, so a fix would only add a guard.
- `false`: DW-540 and DW-541 still showing `routed owner=38-3`. Closing them is the lead's `ledger_adjudicated` gate after `cr_complete` (Rule 17 (2)), not a code defect.
- `low`: the BOM fixture's names are not oracle-checked. IRIS refuses the raw BOM text, the stripped text is the plain one-Default layout that fixture F pins live, and the fix would add a BOM branch to the oracle loop.

## Spec Change Log

Spec errors found at implement time by the live oracle and the read-only sweep (project Rule #16: the spec's own claims about IRIS's parse were not all true). The scanner rules above were amended in place; each correction is pinned by a scanner fixture that IRIS itself reports names for.

- **Rule 2 (class body).** The first `{` after the `Class` line is not always the body's brace: a header keyword list can hold `{...}` values (`Owner = {%Developer}`). The literal rule found no Storage in 14 of the first 395 sampled system classes (a current-side miss is a missed drop). Amended: braces inside the header's `[ ... ]` list are skipped. Pinned by the fixture "braces in a keyword list and in a formal parameter default".
- **Rule 4 (declarations).** A `{` inside a member's `( )` formal list or `[ ]` keyword list (`Method M(t = {$$$NULLOREF})`, `SqlComputeCode = {...}`) is a value, not the body; the literal rule desynchronized on `Ens.Config.Production` and on `HS.HC.FHIRSQL.Data.Specification`. Amended. Pinned by the same fixture and by "formal parameter defaults in braces, a quoted brace in a body, a query body and an ObjectScript trigger".
- **Rule 4 (name terminators).** `Storage Default [ x ]` and `Storage Default [ Final ]` are not definitions in IRIS (the echo reports none), and `Storage` / `Default` / `{` on three lines is one (IRIS reads tokens, not lines). The rule "followed by space or tab, `[`, `{` or the end of the element" accepted the first two and refused the third. Amended: only space, tab and line breaks may separate the keyword, the name and the `{`.
- **Rule 5 (default language), code review 2026-10-15.** "No `Language` means ObjectScript" is wrong in two places, and the keyword was read from the whole declaration. Live probes (IRIS 2026.2 build 221U, `ExecuteMCPv2.Temp.QaStory383Shape`, deleted after each): a `ClientMethod` with no `Language` is JavaScript in any class; a class header `[ Language = python ]` (or `"python"`) makes an untagged `Method`/`ClassMethod` Python but leaves an untagged `Trigger` ObjectScript (also under `tsql`); a header string that says `Language = python` sets nothing; `ClassMethod Greet(Language = "en")` is ObjectScript. Each case had made `storageDefinitionNames` return `[]` where IRIS reports `Default`. Amended, and pinned by six oracle fixtures.
- **Sweep result after the amendments** (details in Auto Run Result): 2515 of 2516 `%Dictionary.StorageDefinition` parents match the dictionary; the one mismatch is the documented residual risk (`&html<` blocks), recorded in `deferred:`.

## Review Triage Log

### 2026-10-15 — Review pass
- verdicts: 33 findings — high 0, medium 3, low 24, false 5, maybe-false 1
- findings:
  - `[low]` `[defer]` Blind 1: the scanner misses a real current-side Storage after `&js<`/`&html<` blocks, a JSON XData string holding `{`, and `InitialExpression = {"}"}`; the non-ASCII and underscore names are not an exported form — lead probes (IRIS 2026.2) confirm the XData and `{"}"}` forms (IRIS echoes Default, scanner []); the `&html`/`&js` form is deferred item 1; the new forms are deferred item 4 (the fix is more than a direct correction, the current side fails open as today)
  - `[low]` `[reject]` Blind 2: the guard compares names, so a same-name Storage whose content is gutted passes — the intent contract (Always) allows changing a definition's content, and the fix would edit the spec; listed under residual risks
  - `[low]` `[reject]` Blind 3: the refusal for `\r`-ended elements says the content drops a definition it visibly holds — matrix row "CR elements" fixes the outcome to S with its exact text, and the override exists
  - `[low]` `[reject]` Blind 4: the Storage hazard is documented only under `iris_doc_put` — AC-6 asks for the guarded and unguarded paths in the README (done); changing the `iris_doc_load`, promote and export descriptions is outside this story's Never list
  - `[low]` `[reject]` Blind 5: `STORAGE_DROPPED` and `DOCUMENT_CONFLICT` audit as `error`, not `denied` — no spec row defines an audit outcome for tool-level refusals, `deriveAuditOutcome` is unchanged by design (byte-identical), and the old 409 also audited as `error`
  - `[low]` `[reject]` Blind 6: the roster test checks a ledger id by form, the guard by substring and counts by raw hits — removing the guard from `doc.ts` turns the guarded case red, a ledger lookup would make a test depend on the lead's file, and a comment evading the substring is contrived
  - `[false]` `[reject]` Blind 7: an unversioned PUT to an existing class might succeed on another Atelier version, skipping the guard — the `%Api.Atelier.v2` `PutDoc` source (inherited by v3-v8) answers 409 when no version token matches, and never reaches `SetTextFromArray`; the branch cannot be reached (Rule #54)
  - `[low]` `[reject]` Blind 8: the `DOCUMENT_CONFLICT` text says to run `iris_doc_put` again — text C is in the intent contract verbatim; 38.4 reuses the code, not this sentence
  - `[low]` `[reject]` Blind 9: the same warning appears in the tool and parameter descriptions — the three texts are prescribed by the Tasks section, and the root README payload table was re-measured
  - `[low]` `[patch]` Blind 10: the "compares across formats" test builds its inputs through a five-element tuple with dummy zeros — replaced by two named lookups in `storage-guard.test.ts` (the id-prefix lookups stay: a renamed id throws at load, never mis-selects silently)
  - `[low]` `[defer]` Edge 1: a body or string that runs to the end of the text hides later Storage on the current side — same family as Blind 1; recorded in deferred item 4 (report the scan as inconclusive)
  - `[low]` `[reject]` Edge 2: a `//` or `/* */` comment holding a quote or brace between a member's signature and its body desyncs the declaration scan — not a form IRIS exports, no sweep class needs it (2515 of 2516), and the fix adds a comment-aware declaration scan
  - `[maybe-false]` `[reject]` Edge 3: a class-level `Language` keyword changes the default method language — unverified; if true it needs a hand-written class-level keyword and is low
  - `[low]` `[reject]` Edge 4: a non-ASCII Storage name is not matched — the name rule `[%A-Za-z][A-Za-z0-9]*` is the probe-derived rule; not an exported form, and both sides are blind to it alike
  - `[low]` `[reject]` Edge 5: the `ignoreConflict` save is unversioned after the 409 read, so a compile between the two requests could add Storage — the matrix row "Keeps storage, ignoreConflict" fixes P0, 409, then Pi, and the window is two sequential requests
  - `[false]` `[reject]` Edge 6: a 409 whose `ts` is an empty string sends an empty `If-None-Match` — a 409 for an existing document carries its `ts` (nine-key shape pinned live); an empty `ts` only appears in the 200 soft error, which is another path (Rule #54)
  - `[false]` `[reject]` Edge 7: an XML document with several `Class` elements lets another class's Storage mask a drop — a `.cls` document holds one class; the PUT of several would not be a single class document
  - `[low]` `[patch]` Edge 8: the write-path patterns miss `put<T>(`, `SetTextFromString`/`SetTextFromFile` and `OBJ.Import` — `document-write-paths.test.ts` now matches `.put<...>(`, `SetTextFrom*` and `OBJ.(Load|Import)*`; three mutations demonstrated red and the scan counts are unchanged
  - `[low]` `[patch]` Edge 9: the roster reason for `doc.ts` says all four PUTs run the guard — reason text corrected (a non-class document and a class with `allowStorageRegeneration` are not guarded)
  - `[medium]` `[patch]` Verification-gap 1: the forbidden-construct pattern `SetTextFrom(Array|Stream)` misses `SetTextFromString` and `SetTextFromFile`, which IRIS has — widened to `SetTextFrom\w*` with a mutation line (same patch as Edge 8)
  - `[medium]` `[patch]` Verification-gap 2: "a routine ... is never scanned" cannot fail because its fake 409 has no class header — the fake now carries the Default-and-Second class text, the proposed text drops it, and the `.mac` still saves with Pv; mutation `isClassDocument` always true is red (3 tests)
  - `[medium]` `[patch]` Verification-gap 3: the governance-denial test depends on seven environment variables it does not clear — reproduced red with `IRIS_TOOLS_DISABLE=iris_new_write` (2 of 8); the harness now clears and restores all ten variables, and the same run is green
  - `[low]` `[patch]` Verification-gap 4: AC-1 and AC-10 have no `mutation:` line — a `mutation:` line states why none applies (AC-1 records IRIS's own answers; AC-10 is the gate commands)
  - `[low]` `[reject]` Verification-gap 5: the "nothing named QaStory383 remains" clause has no mutation — the pinning test for AC-5 (the live refusal) has recorded mutations, and the clause asserts live lists that the lead's `(once)` check repeats
  - `[low]` `[reject]` Verification-gap 6: the bootstrap verdict's second check was not mutation-run — disclosed in the spec; it needs a Storage block in a bootstrapped class, which the story may not edit, and the first check has a mutation
  - `[low]` `[reject]` Verification-gap 7: no test reads the ledger for rows (a), (b) and (c) — the rows were filed with `ledger.sh` and the diff carries DW-544, DW-545 and DW-546 with `reopen_if`; the roster pins their ids
  - `[low]` `[patch]` Verification-gap 8: the verdict-membership assertion cannot fail because `Verdict` is a closed type — the assertion was deleted and the test renamed
  - `[false]` `[reject]` Intent 1: DW-541 changes only an in-process key — the spec says the wire JSON and the text are unchanged and AC-8 pins `structuredContent`
  - `[false]` `[reject]` Intent 2: `server-base.ts` is changed outside `iris_doc_put` — the Tasks section directs `GOVERNANCE_DISABLED` to the catalog, pinned byte-identical by literals captured on the baseline
  - `[low]` `[reject]` Intent 3: the roster test is a source scan, not a ledger or tool-surface check — the spec describes a grep test over named patterns
  - `[low]` `[reject]` Intent 4: the live gate falls back to the default target when the variables are unset — the spec says to follow the sibling per-file setup, and the gate is armed only with `IRIS_REQUIRE_LIVE=1` and the six variables
  - `[low]` `[reject]` Intent 5: the 409 for an existing `.inc` is mocked only — the `PutDoc` 409 does not depend on the document type (source), `.cls` and `.mac` were confirmed live, and orchestrator decision 7 covers every type
  - `[low]` `[reject]` Intent 6: the whitespace and decoy cases of `storage-guard.test.ts` are not oracle fixtures of the live gate — the test header cites the capture (Rule #36), and the live oracle covers 15 fixtures

## Design Notes

**Governing ADs:**
- AD-24: the one shared guard, the enumeration with verdicts, and the grep test. Versions: Pv carries the token returned by the 409 read.
- AD-15: the storage-drop refusal is the sanctioned change; everything else is pinned.
- AD-4/AD-5: a frozen-baseline tool takes a parameter, never an `action` enum. The key, the annotations (the grandfathered `destructiveHint:false`) and the baseline are unchanged. AD-4's "override is an action" rule binds `defaultEnabled` holders (38.4), and `allowStorageRegeneration` restores today's behavior, adding no new side effect.
- AD-2: the guard lives in shared; the scan lives in `iris-mcp-all`.
- AD-12: the parse is done in TypeScript.
- AD-14: no bootstrap change.
- AD-29: minor changesets only.
- Conventions: Refusals (the catalog is born here), Error text, Tool descriptions, Tool results (the new field names `droppedStorage` and `code`), Live gates, Live testing on a shared instance, Probes and references (IRIS 2026.2 build 221U, Atelier v8).

**Probe record (plan stage, 2026-10-15, `default`/HSCUSTOM).** The fixtures were `ExecuteMCPv2.Temp.QaStory383Plan{A..G}.cls` and `...PlanR.mac`. All were removed: `iris_doc_list` (with `generated`) and `iris_global_list` for `QaStory383`/`383` return empty.
- **Storage shape.** Compiling A generated `Storage Default` / `{` / XML / `}` at column 0, with `<Type>%Storage.Persistent</Type>` and hashed globals `^ExecuteMCPvE4F.QaStory383PlB79D`/`I`/`S`. System classes show several definitions (for example `%SYS.Journal.SetKillRecord`, with 3), `%Storage.SQL` (`%CSP.Util.Performance`) and `%Storage.Serial`.
- **The drop and its consequence.** A `?ignoreConflict=1` put without Storage returned 200 with `content:[]`, and the source lost Storage. The rows still read correctly until the compile. After the compile, Storage was regenerated with Beta in slot 2 and Alpha in slot 3, and the rows read swapped (`Alpha:'beta-1'`). This is silent data corruption.
- **409.** A put with no header, or with a stale `If-None-Match`, to an existing document returns 409 plus `ETag` plus the full current document. The `%Api.Atelier.v2` `PutDoc` source (inherited unchanged by v3–v8) explains why:
  - on a hash mismatch it locks, sets 409, calls `GetTextAsArray` in the input's format (XML in, XML out), and unlocks;
  - it never calls `SetTextFromArray` or the source-control edit check;
  - a locked document is 423.

  `If-None-Match: <ts>` saves with 200. On a new document, `?ignoreConflict=1` gives the same 201 shape. A routine's 409 carries its text too. A successful class PUT returns only its Storage lines with `flags:1`, or `content:[]` when the class has none.
- **IRIS parse ground truth** (from the dictionary and the PUT echoes).
  - B: only Default and Second count; a block comment holding a whole Storage shape, `//`, `///`, a Parameter string, and a method string and comment do not.
  - C: XData with balanced braces around `Storage InXData`, and a column-0 `Storage ;` label, give no storage.
  - D: lowercase `storage` is accepted and canonicalized.
  - E: an unbalanced `"` in XData, Python's `'{'`, and ObjectScript `"}"` and `; }` all parse; Default is found.
  - G: elements ending in `\r` give no storage, and the body is mangled.
  - XML: storage is `<Storage name="...">`, and UDL comments sit in CDATA.
- **Cleanup.** `TRUNCATE TABLE` leaves the data global's root; `%KillExtent()` removes every data global.

**Plan-time interpretations (apply-and-report, Rule 5).**
1. **AC 38.3.4 "byte-identical fetch sequence".** For "creates a new class", this is exact with no flags. With `ignoreConflict`, the one request drops `ignoreConflict=1`: it has no effect on a new document, and the result is identical. The other reading, a GET first, would make new classes pay a read, contrary to AC 38.3.3. For "keeps its storage", the final request and the result are today's, preceded by one 409 request that writes nothing (the guard's read). With both flags, the whole sequence is identical.
2. **"Never pay the extra read".** No path adds a GET or HEAD. An existing class's read is IRIS's refusal of P0.
3. **AD-24's "a 409 is never retried".** P0 carries no token, so its 409 means "exists" and carries the current document. Pv's 409 is the conflict, and it is never retried.

**Orchestrator decisions — DECIDED at the spec gate on 2026-10-15, both as recommended (`orchestrator-decisions-wave-6.md` #7 and #8):**
- **#7.** DW-540 is a defect fix inside this story, covering every document type, under CHANGELOG "Fixed".
- **#8.** `iris_doc_xml_export` import is a third recorded AD-24 exclusion. File ledger row (c), as planned. The lead has written the spine AD-24 line (Rule 20).

The options and evidence considered at planning follow.

1. **Is DW-540's fix inside this story, and does it cover every document type?** An existing document saved with no flags now saves under the version check, where before it failed with HTTP 409. AC 38.3.4 says "the refusal is the only behavior change". Recommended: a defect fix in this story, for all types, recorded in the CHANGELOG under Fixed. Evidence:
   - The tool is documented as "Create or update".
   - AD-15's sanctioned list governs names, parameters, defaults and output shapes, and none of them changes.
   - The lead routed DW-540 into this story's ACs with this fix.
   - The token comes free from the 409 for every type.

   The alternative is classes only: non-class documents keep the 409, and the description says so.
2. **Should `iris_doc_xml_export` `import` be added as a third AD-24 recorded exclusion?** That means ledger row (c), plus a spine AD-24 line that the lead writes (Rule 20). Recommended: yes, because AD-24 requires a verdict for every path, and the existing exclusions carry reopen triggers.

**Seam (Rule #52).** 38.3 owns `storage-guard.ts`, `refusals.ts` and the put flow. 38.4 reuses `droppedStorageDefinitions`, `storageDroppedRefusal` (with its `regenerateStorage` remedy) and `DOCUMENT_CONFLICT` unchanged, and owns splitting `\r?\n`.

**Integration (Rules 1/2).** The consumer `iris_doc_put` reads `droppedStorageDefinitions` and `storageDroppedRefusal`, and produces the `STORAGE_DROPPED` refusal that the live gate observes on real IRIS (AC-5).
- Consumed-by:
  - `iris_doc_put` (this story);
  - 38.4 `iris_doc_edit` (the apply refusal, `regenerateStorage` and the conflict);
  - the 38.6 capstone.
- Consumes:
  - `atelierDocStatusError` and `stripLeadingBomFromLines` (38.0);
  - `live-doc-helpers.ts` (38.2).
- Extend, don't copy:
  - the catalog generalizes the inline `GOVERNANCE_DISABLED`;
  - the live helpers are extended in place;
  - the grep test follows the pattern of `containment.test.ts` and `live-gate-roster.test.ts`;
  - the gate setup stays per file, for roster detection (Rule #59).

**Ledger inbox.** DW-540 is addressed by the matrix "existing" rows, AC-7 and the `doc.ts` task. DW-541 is addressed by AC-8 and the `doc.test.ts` and `doc-get-range.test.ts` tasks. DW-542 and DW-530 are context only.

**Residual risk.** The scanner approximates IRIS's parser in a few places:
- `&sql` or embedded HTML holding an unbalanced `"` or brace;
- a SQL `'{'` in a Query body.

On the proposed side, a desync usually swallows members, so it fails safe (a refusal with an override). On the current side it could miss a drop. The live oracle and a read-only sweep bound this (the implement stage runs `storageDefinitionNames` over 100 or more `%Dictionary.StorageDefinition` parents and records how many match).

## Verification

Every command runs in the foreground with `timeout: 600000` from `/Users/jbrandt/git/iris-execute-mcp-v2`. IRIS is reached only through `default` (localhost:52773, HSCUSTOM).
- Live writes go only to `ExecuteMCPv2.Temp.QaStory383Guard.cls` (persistent, compiled, 2 rows; data removed with `%KillExtent()`), `...QaStory383Multi.cls`, `...QaStory383NoStorage.cls`, `...QaStory383Shape.cls` and `...QaStory383Rtn.mac`. Only `Guard` is compiled.
- There are no ObjectScript changes, so no OS %UnitTest runs.

**Shared surfaces:**
- the `iris_doc_put` schema and description (the root README payload table);
- the shared barrel;
- the dev `gateTestFiles` (`live-gate-roster.test.ts`);
- the `doc.test.ts` put and `metadataOnly` cases;
- `doc-get-range.test.ts:177`;
- `doc-get-range-live-gate.test.ts` (its helpers move);
- `server-base.ts`'s `GOVERNANCE_DISABLED` (the value is unchanged);
- the `CHANGELOG.md` top section (the 38.0/38.1/38.2 doc-claims tests locate their sections by regex).

Tool counts do not move. Standing criterion: every test added or changed passes on a fresh environment, in either order.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/storage-guard.test.ts src/__tests__/refusals.test.ts` -- expected: pass.
- `(loop)` `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc-put-storage-guard.test.ts src/__tests__/doc.test.ts src/__tests__/doc-get-range.test.ts` -- expected: pass.
- `(loop)` `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1 pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism src/__tests__/doc-put-storage-guard-live-gate.test.ts src/__tests__/doc-get-range-live-gate.test.ts src/__tests__/doc-put-bom-live-gate.test.ts` -- expected: all pass, none skipped.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/document-write-paths.test.ts src/__tests__/live-gate-roster.test.ts` -- expected: pass.
- `(once)` One command per package, each running `build`, then `test`, `lint` and `type-check` where defined. The packages are shared, dev, admin, interop, ops, data and client-config, followed by `pnpm --filter @iris-mcp/all test` (35-1-DEV-1). Expected: green.
- `(once)` `pnpm gen:governance-baseline:check` -- expected: exit 0 at `1e62c5ad5bf7`/141.
- `(once)` `git diff --stat 043f1e0a57959616f328490ce3d7a29dd4459270 -- packages/shared/src/bootstrap-classes.ts packages/shared/src/governance-baseline.ts src/ $(git ls-files 'packages/*/src/tools/presets.ts')` -- expected: empty.
- `(once)` `iris_doc_list` and `iris_global_list` (`server:"default"`, `namespace:"HSCUSTOM"`, filter `QaStory383`, docs with `generated:true`) -- expected: empty.

**Planned mutations (Rule 19).** For each one, apply it, observe red, revert, rebuild any dist it touched, and check that `git status --short` and `git diff --stat` are unchanged. Record each result as `mutation: ... -> ...`.

| AC | Mutation | Expected red |
|---|---|---|
| AC-2 | the scanner counts `//`-comment lines as members | the decoy unit case and the live oracle |
| AC-2 | `\r` treated as whitespace | the CR-element unit case, the oracle and the live CR refusal |
| AC-3 | the refusal path still sends Pv | "refusal: one put" and the live source/count unchanged |
| AC-3 | `allowStorageRegeneration` ignored | the override rows (unit and live) |
| AC-4 | P0 passes `{headers:{}}` | the back-compat pins and the two-argument `doc.test` pins |
| AC-5 | `droppedStorageDefinitions` returns `[]` | the live refusal (the row count stays) |
| AC-6 | a `.put(` line added to an ops tool | `document-write-paths` |
| AC-7 | Pv omits `If-None-Match` | the unit Pv pin and the live existing-class save (409) |
| AC-7 | Pv 409 retried | the C row (three puts) |
| AC-8 | the `Last-Modified` read restored | `doc-get-range:177` and `doc.test` `metadataOnly` |
| AC-9 | a duplicate catalog value | `refusals.test` |

**Mutation results (Rule 19).** Run on 2026-10-15 on the final tree, one at a time. Each mutation was applied, the red observed, and the file restored from a saved copy with an identical sha1. The shared, dev and ops dists were rebuilt (the ops dist needed a clean rebuild after the restore touched its source), and `git status --short` and `git diff --stat` matched the pre-mutation capture. The first mutation row of the plan, "the scanner counts `//`-comment lines as members", is not caught by the decoy case alone: a `// Storage X` line is followed by a bodyless member, so the name rule rejects it. The fixture "comments holding braces at member level" was added so that a `//` or `/* */` comment alone turns the unit case and the oracle red.
- mutation: AC-2 member-level `//` skipping removed from the UDL scan (the plan's mutation, taken literally) -> red: 1 shared unit fixture (comments holding braces) and, live, that fixture in both oracle tests (2 red); the decoy cases stay green
- mutation: AC-2 member-level `//` and `/* */` skipping both removed (all comment text counted as members) -> red: 3 shared unit fixtures (B, B decoys alone, comments holding braces) and, live, those 3 fixtures in both oracle tests (6 red)
- mutation: AC-2 `\r` treated as whitespace in the Storage name rule -> red: 3 shared unit cases (fixture G, the CRLF-split case, the name-terminator case), 1 dev unit (carriage-return elements refused), and live the Multi carriage-return refusal plus fixture G in both oracle tests (3 red)
- mutation: AC-3 the refusal path also sends Pv before it refuses -> red: 7 dev unit refusal cases, and live the Guard refusal with no flags and with ignoreConflict, the Multi refusal and the exact-request spy "a refused drop makes exactly one PUT" (4 red)
- mutation: AC-3 `allowStorageRegeneration` ignored -> red: 2 dev unit (the override, both flags), and live the Guard override, both flags and the Multi override (3 red)
- mutation: AC-4 P0 passes `{headers:{}}` -> red: 19 (the back-compat pins and matrix rows of `doc-put-storage-guard.test.ts`, and the 3 two-argument `toHaveBeenCalledWith` pins of `doc.test.ts`)
- mutation: AC-5 `droppedStorageDefinitions` returns `[]` -> red: 4 shared unit and 7 dev unit, and live the Guard refusal with no flags and with ignoreConflict and the Multi refusal (3 red; the put is saved, so the `isError` assertion fails first, before the row-count and source checks)
- mutation: AC-6 a `.put(` line added to an ops tool (`iris-ops-mcp/src/tools/alerts.ts`) -> red: `document-write-paths` "the found write paths equal the roster", whose diff names the file
- mutation: AC-7 Pv omits `If-None-Match` -> red: 6 dev unit, and live the default-mode class save, the routine save and the exact-request spy (3 red, each from HTTP 409 becoming `DOCUMENT_CONFLICT`)
- mutation: AC-7 a 409 on Pv is retried once -> red: 2 dev unit (the class and the routine conflict rows; the fake's third request succeeds, so the result and the request count both catch it)
- mutation: AC-8 the `Last-Modified` read restored -> red: the `doc-get-range.test.ts:177` pin and 2 `doc.test.ts` `metadataOnly` cases
- mutation: AC-9 the `DOCUMENT_CONFLICT` catalog value duplicates `STORAGE_DROPPED` -> red: 3 `refusals.test` cases (each value equals its key, the values are unique, the code-only shape)
- mutation: AC-9 `refusalResult` puts `code` after the fields -> red: 4 (the two `GOVERNANCE_DISABLED` byte-identical literals, the shape-order case, the `storageDroppedRefusal` field order)
- mutation: AC-2 the class body opens at the first `{` of the header (keyword-list braces not skipped) -> red: 2 shared unit, and live the fixture "braces in a keyword list and in a formal parameter default" in both oracle tests (2 red)
- mutation: AC-2 a `{` in a member declaration always opens its body (formal-list and keyword-list braces not skipped) -> red: 2 shared unit, and live the fixture "formal parameter defaults in braces, a quoted brace in a body, a query body and an ObjectScript trigger" in both oracle tests (2 red)
- mutation: AC-2 the Storage name rule back to "followed by space, tab, `[`, `{` or the end of the element" -> red: 1 shared unit (the name-terminator case)
- mutation: AC-6 (bootstrap verdict) `storageDefinitionNames` reports a name for every non-empty text -> red: the bootstrap PUT verdict case (the scanner check over `BOOTSTRAP_CLASSES`). Its second, independent check (no line starts with the Storage keyword) was not mutation-run, because that needs a Storage block in a bootstrapped class, which this story may not edit.
- mutation: AC-3 `isClassDocument` always true (non-class documents guarded; review pass, shared dist rebuilt) -> red: 3 dev unit (the `.mac` + `ignoreConflict` row, the "allowStorageRegeneration is ignored" row and "a non-class document is never scanned for Storage, even when its current text holds Storage definitions the new text lacks", whose fake 409 now carries a real class text with Storage)
- mutation: AC-6 a `client.put<Doc>(path, body);` line appended to `scripts/gen-bootstrap.mjs` (review pass) -> red: `document-write-paths` "the found write paths equal the roster"
- mutation: AC-6 a `lines.SetTextFromString(x)` line appended to `scripts/gen-bootstrap.mjs` (review pass) -> red: `document-write-paths` "no construct the roster does not model"
- mutation: AC-6 a `$SYSTEM.OBJ.Import(file)` line appended to `scripts/gen-bootstrap.mjs` (review pass) -> red: `document-write-paths` "no construct the roster does not model"
- mutation: AC-9 hermeticity, the governance-denial harness before the review pass clears only three of the ten variables `McpServerBase` reads (ambient `IRIS_TOOLS_DISABLE=iris_new_write`) -> red: 2 `refusals.test` cases; after the pass the same run, with `IRIS_TOOLS_DISABLE`, `IRIS_GOVERNANCE_FILE`, `IRIS_TOOLS_PRESET` and `IRIS_AUDIT_LOG` set in the environment, is green (8 of 8)
- mutation: AC-1 (code review, armed live run) `GUARD_REORDERED` made equal to `GUARD_SOURCE` (Alpha before Beta) in the live gate -> red: the AC-1 record "a PUT without a Storage block drops the class's Storage ... so the existing rows read swapped" (1 of 4 in the describe); restored byte-identical. AC-10 has no mutation by nature: it is the gate commands under Commands.
- mutation: AC-2 (code review) `ClientMethod` default removed from `defaultLanguage` -> red: shared unit fixture "a ClientMethod with no Language is JavaScript ..." (1)
- mutation: AC-2 (code review) the class header's `Language` ignored (`defaultLanguage` returns `undefined` for a method) -> red: the two "a class Language = python ..." fixtures, plain and quoted (2)
- mutation: AC-2 (code review) a `Trigger` takes the class `Language` -> red: fixture "a class Language = python leaves a trigger with no Language ObjectScript ..." (1)
- mutation: AC-2 (code review) `Language` read outside the `[ ]` keyword list (`inKeywordList` starts true) -> red: fixture "a formal parameter named Language sets no language ..." (1)
- mutation: AC-2 (code review) header strings kept in the keyword text -> red: fixture "a header string that mentions a Language sets none ..." (1). The six fixtures also pass the armed live oracle (12 tests: names and 409 shape), so their pins are IRIS's own answers (Rule #36).
- mutation: AC-9 hermeticity (code review) `IRIS_SERVER_MANAGER` removed from `CLEARED_ENV`, ambient `IRIS_SERVER_MANAGER=bogus` -> red: the 2 `GOVERNANCE_DISABLED` byte-identical cases (`McpServerBase.start` throws); with the list restored the same run, plus `IRIS_SM_SERVERS` and `IRIS_CREDENTIAL_HELPER` set, is 8 of 8 green
- mutation: AC-4 (code review, armed live run) the success result of `iris_doc_put` returns `content: []`, `flags: 0` -> red: live "a new class with ignoreConflict makes one PUT on the bare path, and IRIS answers it as it answers the request that carries the flag" (now on fixture F, whose Storage echo is compared); with fixture A both echoes were empty and this mutation stayed green
- mutation: AC-6 (code review) a temporary `src/ExecuteMCPv2/CrMutationProbe.cls` calling `##class(%Dictionary.ClassDefinition).%OpenId(` -> red: `document-write-paths` "the found write paths equal the roster"; the same file calling `##class(%Library.RoutineMgr).%New(` -> red: "no construct the roster does not model" (file deleted after)
- mutation: AC-6 (code review) the `iris_global_set` row removed from the QA test's `NAMED` list -> red: `story-38-3-qa-doc-claims` "names each path the write-path roster records ..." (the roster's unguarded entries are now read from the roster source)

**QA stage (2026-10-15, IRIS 2026.2 build 221U, `default`/HSCUSTOM, Rule 19).** Gap analysis by mutation: 46 mutants of `storage-guard.ts` and 15 of `doc.ts` were run one at a time against the implement-stage tests and then the new ones (each restored from a saved copy, `git status --short` and `git diff --stat` checked after every run). 29 of 61 were red before the QA tests, and 32 survived; the new tests close 25 of those 32, and the other 7 are equivalent or unreachable (listed last). Every survivor was either an assertion that could not fail, closed below, or an equivalent or unreachable mutant, listed last. Test files, all (QA):
- `packages/iris-mcp-all/src/__tests__/story-38-3-qa-doc-claims.test.ts` (QA, new): the README examples executed against the built handlers, the CHANGELOG quotes, the tool-table row, the unguarded paths, the code-literal and `droppedStorage` contracts, the changeset.
- `packages/shared/src/__tests__/storage-guard-fixtures.ts` (QA, +20 fixtures): each is a form that a spec rule names and no earlier fixture needed; `names` were pinned from live probes of the exact text before they were written (Rule #36), and the live oracle re-checks them on every armed run.
- `packages/iris-dev-mcp/src/__tests__/doc-put-storage-guard.test.ts` (QA, +4): a Pv failure that is not a 409 propagates (423, 500, network); a `.CLS` name is guarded.
- `packages/iris-dev-mcp/src/__tests__/doc-put-storage-guard-live-gate.test.ts` (QA, +4 real-wire tests, and 40 oracle tests through the new fixtures): the Conflict row on the real wire (another writer saves between P0 and Pv), the soft error on the version-checked save, a new class with `ignoreConflict` against the flagged request, and a drop under a `.CLS` name (IRIS answers a put to `Name.CLS` with the 409 of the same document as `Name.cls`).

Mutations demonstrated by QA for the new tests (red observed, restored, tree unchanged):
- mutation: AC-2 header string skipping off -> shared unit and live oracle "header keyword string holding a bracket"
- mutation: AC-2 header `//` comment skipping off; header block-comment skipping off -> "header continuation line: a // comment holding a brace"; "...a block comment holding a brace" (2 red)
- mutation: AC-2 block comment above the Class line not skipped -> "a block comment that holds a whole earlier class above the real one"
- mutation: AC-2 ObjectScript body `//` comment skipping off; block-comment skipping off -> "ObjectScript method comments holding closing braces" (2 red)
- mutation: AC-2 `Method` out of the ObjectScript method keywords; `ClientMethod` out of them -> "an instance Method holding a quoted closing brace"; "a javascript ClientMethod holding a quoted brace" (2 red)
- mutation: AC-2 member-declaration strings not skipped; nested braces of a declaration not skipped -> "strings holding a semicolon and a brace ..." (and the quoted-Language fixture); "a semicolon inside the braces of a keyword value" (live oracle red too) (2 red)
- mutation: AC-2 quoted `Language` value dropped; `Language` keyword case-sensitive; `cache` treated as foreign; `objectscript` treated as foreign; language value case-sensitive -> the five Language fixtures (5 red)
- mutation: AC-2 a stray member-level character stops the scan -> "stray semicolons between members" (live oracle red too, 4 tests)
- mutation: AC-2 Storage names without `%`; without digits -> "Storage names that start with a percent sign and hold a digit" (2 red)
- mutation: AC-2 Storage body counted with string awareness -> "Storage bodies that hold an unbalanced quote"
- mutation: AC-2 XML comment skipping off; CDATA skipping off -> the two XML fixtures with a `>` before the Storage-like text (live oracle red for the comment) (2 red)
- mutation: AC-2 `Class` keyword needs a space after it; leading blanks before `Class` not skipped -> the two tab fixtures (2 red)
- mutation: AC-3 any failure of Pv reported as DOCUMENT_CONFLICT -> unit "a failure of the version-checked save that is not a 409 propagates" (423 and 500 red)
- mutation: AC-3 a 409 on Pv rethrown instead of reported -> live "a change between the unversioned and the version-checked PUT is DOCUMENT_CONFLICT after exactly two PUTs"
- mutation: AC-3 the guard keyed on a lowercase `.cls` only -> unit "a drop under a .CLS name is refused" and live "a drop under an upper-case .CLS name is refused"
- mutation: AC-4 `ignoreConflict` always sent as Pi -> live "a new class with ignoreConflict makes one PUT on the bare path"
- mutation: AC-4 soft-error check off -> live "IRIS's refusal of text that is not a class, on the version-checked save"
- mutation: AC-6 and AC-9 the refusal remedy text changed (dev dist rebuilt) -> `story-38-3-qa-doc-claims` README refusal example and CHANGELOG quote (2 red); the README refusal text edited -> the README example
- mutation: AC-9 an inline `"DOCUMENT_CONFLICT"` literal in `doc.ts` -> "the refusal codes are quoted strings in refusals.ts only"
- mutation: AC-10 `droppedStorage` added to another output in `doc.ts` -> "droppedStorage is built in storage-guard.ts only"; the same key on the built conflict result -> "lists the structuredContent fields of STORAGE_DROPPED and DOCUMENT_CONFLICT"
- mutation: AC-6 the README tool row loses `allowStorageRegeneration?` -> "lists exactly the parameters of the built iris_doc_put schema" and "states the default of both flags"; the README names a tool that does not exist -> "names each path the write-path roster records"
- mutation: AD-29 the changeset bumps `@iris-mcp/dev` major -> "bumps @iris-mcp/shared and @iris-mcp/dev minor"

Survivors accepted, with the reason: skipString's doubled-quote escape (equivalent under brace counting: a doubled quote closes and reopens the string with nothing between); a `{` in a keyword list taken as a body, and a `;` counted inside brackets (equivalent for balanced text); XML tag scan not quote-aware and a leading tab before the XML declaration (IRIS refuses that text, probed; no fixture can exist); de-duplication of a repeated name in `current` (IRIS cannot hold two Storage definitions of one name, Rule #54); `currentDocument` accepting a 423 (IRIS answers a locked document with no document body, so the fake that would reach it cannot exist).

Known divergence found by the live oracle and not fixed here (QA writes tests, not source): IRIS reads a `ClientMethod` with no `Language` keyword as JavaScript and keeps it that way in the exported source, and `foreignBodyEnd` is reached only when a `Language` keyword is present, so `ClientMethod Js() As %String { if (1) { return 'x'; } }` followed by `Storage Default` makes `storageDefinitionNames` return `[]` where IRIS reports `Default`. Spec rule 5 says "no `Language`" means ObjectScript; that is wrong for `ClientMethod`. Effect: a drop is not refused for such a class (the guard fails open, today's behavior), on both sides of the comparison. Fixed at code review (rule 5 amended; see Review Findings).

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** `iris_doc_put` now sends today's create request first. For an existing document, Atelier's 409 carries the current document: a class whose new content drops a Storage definition is refused with `STORAGE_DROPPED` (override `allowStorageRegeneration`, default false), and any other put is saved once more with `If-None-Match` set to the 409's `ts` (DW-540; a 409 on that save is `DOCUMENT_CONFLICT`, never retried). `iris_doc_get` `metadataOnly` returns `{exists, name, etag}` (DW-541). `@iris-mcp/shared` gained the refusal-code catalog (`refusals.ts`) and the Storage-drop guard (`storage-guard.ts`); `iris-mcp-all` gained the write-path grep test; the three AD-24 exclusions are ledger rows DW-544, DW-545 and DW-546. `BOOTSTRAP_VERSION` is unchanged (`3af8ca401e7c`).

**Files changed.** `packages/shared/src/storage-guard.ts` (scanner and refusal builder), `packages/shared/src/refusals.ts` (catalog), `packages/shared/src/index.ts` and `packages/shared/package.json` (exports), `packages/shared/src/server-base.ts` (`GOVERNANCE_DISABLED` from the catalog, byte-identical), `packages/iris-dev-mcp/src/tools/doc.ts` (the put flow, schema, descriptions, DW-541), the unit tests (`refusals.test.ts`, `storage-guard.test.ts`, `storage-guard-fixtures.ts`, `doc-put-storage-guard.test.ts`, `document-write-paths.test.ts`, and the updated `doc.test.ts` and `doc-get-range.test.ts`), the live gate and helpers (`doc-put-storage-guard-live-gate.test.ts`, `live-doc-helpers.ts`, `doc-get-range-live-gate.test.ts`, `prepublish-gate.mjs`), and the docs (`CHANGELOG.md`, the changeset, the dev README, the root README payload table).

**Review (first pass, four layers).** 33 findings: high 0, medium 3, low 24, false 5, maybe-false 1. Patched (8 rows: 3 medium, 5 low): the three mediums (the forbidden-construct pattern missed `SetTextFromString` and `SetTextFromFile`; the "non-class is never scanned" test could not fail; the governance-denial test depended on ambient environment variables) and five lows (the roster patterns now also match `put<T>(` and `OBJ.Import*`, the `doc.ts` roster reason, a tautological verdict assertion, an obscure test destructure, and the `mutation:` lines for AC-1 and AC-10). Deferred (2 findings, one new frontmatter item): scanner desyncs on the current side (XData with a brace in a string, `InitialExpression = {"}"}`, no lost-sync detection), in addition to the three items the implement stage recorded. Rejected with the reason in the triage log: 23 (spec-bound text or behavior, theoretical or unreachable branches, contrived forms). Follow-up review recommendation: `false` (three medium patches, all test-only, each demonstrated red then green; no unverified risk remains).

**Verification after the review patches.** The four `(loop)` commands and every `(once)` command were re-run on the final tree: shared 72 files / 1450 tests, dev 51 / 1002, admin 498, interop 343, ops 350, data 165, client-config 514, all 30 / 279, with build, lint (one pre-existing shared warning in `cli/governance.ts`) and type-check green; the armed live loop ran 85 tests with none skipped; `pnpm gen:governance-baseline:check` is OK (frozen keys all present, 203 live); the protected-file diff against `043f1e0` is empty; `iris_doc_list` (with `generated`) and `iris_global_list` for `QaStory383` and `383` are empty.

**Residual risks.** The scanner approximates IRIS's parser (the four `deferred:` items); the current side fails open there, which is today's behavior. The guard compares names only, so a same-name Storage whose content is gutted passes, by the intent contract. Implement-stage note: the handoff subagent twice issued two test calls in one message; nothing interfered, and no git write was made by any subagent.

Implement-stage record (2026-10-15).

- **IRIS version (AC 38.3.1).** `IRIS for UNIX (Ubuntu Server LTS for ARM64 Containers) 2026.2 (Build 221U) Fri Jun 26 2026 09:59:12 EDT`, Atelier API v8, profile `default` (localhost:52773), namespace HSCUSTOM. Every live pin below was captured on it.
- **Live record (AC 38.3.1), pinned by the live gate.** A compile of the two-property persistent class generates `Storage Default` in the UDL shape (`Storage Default` / `{` / `<Data name="QaStory383GuardDefaultData">` with Values `%%CLASSNAME`, `Alpha`, `Beta` / the Data, Id and Index locations in hashed `^ExecuteMCPvE4F.QaStory383G4FC3*` globals / `<Type>%Storage.Persistent</Type>` / `}` at column 0). A put to the existing class with no `If-None-Match` is refused with HTTP 409 whose result has exactly the nine keys `name, db, ts, upd, cat, status, enc, flags, content`, with `status: ""`, the same `ts` as a GET and the same lines as a GET (XML in gives XML out, checked on every XML fixture). `If-None-Match: <ts>` saves with 200 and a stale `ts` gives 409. A put without a Storage block (reordered properties) returns `flags: 0, content: []`, the source has no Storage, the two rows still read as `alpha-1/beta-1` and `alpha-2/beta-2` until the compile, and after the compile the Storage is regenerated with `Beta` in value slot 2 and `Alpha` in slot 3 and the same rows read `{ID:1, Alpha:'beta-1', Beta:'alpha-1'}` and `{ID:2, Alpha:'beta-2', Beta:'alpha-2'}`.
- **Scan counts pinned (`document-write-paths.test.ts`, taken from the scan, Rule #51).** `iris-dev-mcp/src/tools/doc.ts` `.put(` x4 (guarded); `load.ts` `.put(` x1 (excluded, DW-544); `env-promote.ts` `.put(` x1 (excluded, DW-545); `format.ts` `"action/xml/load` x1 (excluded, DW-546); `shared/src/bootstrap.ts` `.put(` x1 (not applicable); `iris-data-mcp/src/tools/docdb.ts` `.put(` x1 and `iris-dev-mcp/src/tools/global.ts` `.put(` x1 (not document writes); `src/ExecuteMCPv2/REST/Interop.cls` `%Dictionary.*Definition` `%New(` x2, `SaveToClass(` x6, `EnableConfigItem(` x2, `CreateApplication(` x1 (not applicable). The patterns that must find zero (`OBJ.Load*`, `ImportDir`, `SetTextFromArray/Stream`, `%Routine`/`%RoutineMgr` `%New(`) found zero. The plan's hand count for `doc.ts` was 3; the scan counted 4 (the two `ignoreConflict` requests are separate call sites).
- **Read-only sweep (AC 38.3.2, Residual risk).** `storageDefinitionNames` over every `%Dictionary.StorageDefinition` parent in HSCUSTOM (the whole dictionary, not a sample): **2515 of 2516 parents match** the dictionary's names (2521 definitions, including the `%Storage.SQL`, `%Storage.Serial` and custom-storage types). The spec's literal rules matched 381 of the first 395 sampled parents; the amendments in the Spec Change Log took the sweep to 395 of 395, then 2519 of 2520 over the whole dictionary, and 2515 of 2516 on the final run (the dictionary had lost four of this stage's own early probe classes by then). The one mismatch is `%SQL.Manager.UI` (an `&html<` CSS block hides a closing brace; the scanner finds none where the dictionary has `Default`), filed in `deferred:`.
- **Scanner oracle (AC-2).** 15 fixtures PUT to IRIS (the plan probes A, B, C, D, E, F, G, the decoys of B alone and the XML of B, plus compact header, four-space indent, comments holding braces, keyword-list braces, formal-list braces and CDATA): the Storage names IRIS echoes equal the scanner's and the pinned names for every one, and the 409 for the next put has the nine-key shape. A BOM, a missing class header and an empty array are unit-only. Each hand-written UDL case of `storage-guard.test.ts` that IRIS can take was also run through it once and agrees (the XML attribute-quoting, BOM and blank-line cases are unit-only); the forms where IRIS and the scanner disagree (probed separately) are recorded in `deferred:`.
- **Ledger (AC 38.3.6).** Filed `wontfix-accepted` with `reopen_if`: **DW-544** (`iris_doc_load`), **DW-545** (`iris_env_promote` `execute`), **DW-546** (`iris_doc_xml_export` import, orchestrator decision 8). The grep test pins their ids.
- **Gates.** Per-package build, test, lint and type-check green: shared 72 files / 1450 tests, dev 51 / 1002, admin 498, interop 343, ops 350, data 165, client-config 514, all 30 files / 279 tests. The live loop (guard gate, 38.2 gate, BOM gate, armed, `--no-file-parallelism`) ran 85 tests with none skipped. `pnpm gen:governance-baseline:check` exits 0 at `1e62c5ad5bf7` / 141 frozen keys (203 live). The diff against `043f1e0` for `bootstrap-classes.ts`, `governance-baseline.ts`, `src/` and every `presets.ts` is empty; `BOOTSTRAP_VERSION` is unchanged at `3af8ca401e7c`. The dev server has 29 tools. `droppedStorage` appears in no other tool's output (grep: the field is built in `storage-guard.ts` only). `pnpm measure:tools-payload` re-measured: dev full and developer 73,186 bytes (was 72,072), dev core 32,360 (was 31,246); the other servers are unchanged.
- **Live fixtures.** Written only under `ExecuteMCPv2.Temp.QaStory383*` in HSCUSTOM. The Guard data was removed with `%KillExtent()`, then its data global, then the documents; `iris_doc_list` (with `generated: true`) and `iris_global_list` for `QaStory383` are empty after every run. Eight stray `QaStory383Plan*` documents that an early probe of this stage wrote (class text naming a different class than the document) were deleted at once.
- **Changed files outside the named tasks.** `packages/shared/package.json` gained the export `./test-helpers/storage-guard-fixtures` and `packages/shared/src/__tests__/storage-guard-fixtures.ts` is new, so the scanner fixtures are single-sourced between the shared unit test and the dev live oracle (Rule #2).
- **Residual risks.** The scanner approximates IRIS's parser where two forms differ (see `deferred:`): an `&html<` or `&js<` block whose `;` hides a brace (current side: a missed drop, today's behavior), non-ObjectScript bodies that end at a column-0 `}` only (proposed side: a spurious refusal with an override), and three contrived forms IRIS itself drops. No path adds a GET or HEAD.
