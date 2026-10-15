---
title: 'Story 38.3: Storage Block Drop Guard'
type: 'feature'
created: '2026-10-15'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred: []
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
    2. **UDL class body.** In UDL, the class body opens at the first `{` after the line whose first word is `Class` (case-insensitive). Header `//` and `/* */` comments and `"` strings are skipped; with no class header the result is `[]`.
    3. **Member level.** At member level, skip:
       - space, tab and line ends;
       - `//` to the end of the line (this covers `///`);
       - `/* ... */` across lines;
       - any other character that starts no comment, member or `}` (for example a stray `;`).

       A `}` ends the class.
    4. **Member declarations.** A member is a keyword, then its declaration up to an unquoted `;` (no body) or `{` (body); `"..."` with `""` escapes is skipped. The keyword `Storage`, in any case, with a body records the name that follows: `[%A-Za-z][A-Za-z0-9]*`, followed by space or tab, `[`, `{` or the end of the element.
    5. **Bodies.**
       - An ObjectScript `Method`/`ClassMethod`/`ClientMethod`/`Trigger` (no `Language`, or `objectscript`/`cache`) counts braces outside `"` strings, `//` and `;` comments (`;` covers `#;`), and `/* */`.
       - Any other method or trigger language, given by a `Language = <lang>` keyword (any case) in the declaration's `[ ]` list, ends at the first element that is `}` in column 0 followed only by spaces or tabs.
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

## Spec Change Log

## Review Triage Log

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

## Auto Run Result

Status: ready-for-dev
Blocking condition: none
