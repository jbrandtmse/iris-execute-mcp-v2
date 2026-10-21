---
title: 'Story 42.11: Storage Guard on Every Document Write'
type: 'feature'
created: '2026-10-21'
status: 'done'
baseline_revision: '4e492cfdba193d08d323c03f36fae0f5f1b1d63f'
baseline_commit: '4e492cfdba193d08d323c03f36fae0f5f1b1d63f'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-42-context.md'
warnings:
  - oversized
deferred:
  - summary: >-
      The agent-facing prompts and skills (deploy-and-test-class, promote-environment-change and their skills-pack copies) do not mention the new STORAGE_DROPPED refusals or the allowStorageRegeneration override.
    evidence: |-
      The deploy-and-test-class loop handles compile errors only, so a file refused with STORAGE_DROPPED (a failures entry, not a compile error) can leave the loop testing against the stale server copy; only edit-and-test-class carries a "never use regenerateStorage unless asked" rule and only that prompt is pinned by prompt-safety-invariants. This story's intent excludes any prompt or skills-pack text change (frozen prompts/get bytes), so it was not changed here.
    location: >-
      packages/iris-dev-mcp/src/prompts/deployAndTestClass.ts, packages/iris-dev-mcp/src/prompts/promoteEnvironmentChange.ts, skills/deploy-and-test-class/SKILL.md
    severity: low
---

<intent-contract>

## Intent

**Problem:** The Story 38.3/38.4 Storage-drop guard covers only `iris_doc_put` and `iris_doc_edit`. `iris_doc_load`, the `iris_doc_xml_export` import and `iris_env_promote` `execute` can replace an existing class with text that lacks one of its Storage definitions, with no flag, and IRIS then generates new storage at the next compile, which can change how existing rows are read (DW-652; the exclusions DW-544/545/546). A live probe on 2026-10-21 confirmed this for the XML import.

**Approach:** Extend the one shared guard in `@iris-mcp/shared` (`storage-guard.ts`) to all three paths. By default, each path refuses a write that would drop a Storage definition the class has now, naming the definitions and the override. Each path gets an optional `allowStorageRegeneration` parameter. With it, the write goes ahead and the result names what was dropped. Each moved frozen golden byte is a sanctioned AD-15 ledger entry. Each path gets a live refusal pin on the shared instance, proven red by removing that path's guard.

## Boundaries & Constraints

**Always:**
- **One shared guard.**
  - Every name comparison goes through `storage-guard.ts`: exact, case-sensitive, a rename counts as a drop, and a content change is allowed.
  - Every refusal and drop field is built there. The identifier `droppedStorage` appears in non-comment code only in `storage-guard.ts` (`story-38-3-qa-doc-claims.test.ts:383-385`), and `STORAGE_DROPPED` is referenced only via `REFUSAL_CODES`.
- **Guarded documents.** Only `.cls` documents are guarded (`isClassDocument`). A new class (GET 404) is never refused.
- **Unchanged when nothing drops.** With no drop, and with the override unused, every write request and every result field is byte-identical to today, apart from the added GETs (AD-15).
  - The `iris_doc_load` default path still sends exactly one `?ignoreConflict=1` PUT per class it uploads (`story-38-7-qa-live-gate.test.ts:338-352` stays green unchanged).
  - The promote dialog `scope` and its result stay byte-identical (`story-43-3-qa-baseline.ts:184-204`).
- **Refusals change nothing.** A refusal is `isError: true` with `code: STORAGE_DROPPED`.
  - The XML import refuses before its one `action/xml/load` POST.
  - Promote refuses before the confirmation dialog and before any write in any domain.
  - `iris_doc_load` refuses per file and the other files continue.
- **Promote writes what it checked.** It PUTs exactly the source text its preflight checked (no second source GET for a class step). The dialog stays immediately before the first write, after every check (AD-34).
- **Classification and visibility unchanged.** Governance keys, `mutates`, `defaultEnabled`, annotations, presets and tool counts (110 package tools, 115 advertised) stay as they are. The baseline stays `1e62c5ad5bf7`/141; use `pnpm gen:governance-baseline:check` only.
- **Frozen goldens stay frozen.**
  - Each moved value is exactly one entry appended to `sdk-golden-sanctioned-changes.json`.
  - `tools-list-snapshot.json` is regenerated only with `pnpm gen:tools-list-snapshot --force` after rebuilding every package.
  - Texts come from Design Notes, and the test oracles are written from them.
- **Live tests.** They write only `ExecuteMCPv2.Temp.QaStory4211*` on `localhost:52773`/`HSCUSTOM`, create and remove their own fixtures, and leave no document or global behind.
- **Rule 14.** Write non-ASCII characters in code as escapes. Comments state the contract.

**Never:**
- No `action` enum change, new tool, new governance key, new refusal code, new preset row, and no confirmation gate on `iris_doc_load` or the import (AD-34's gated set stays six).
- No ObjectScript change (`BOOTSTRAP_VERSION` unchanged) and no change to the loader `scripts/lib/golden-sanctioned-changes.mjs` (no `add` op; Design Notes, decision 1).
- No change to `iris_doc_put` or `iris_doc_edit` behavior, texts or tests beyond the roster rows.
- No prompt or skills-pack text change. The refusal text carries the remedy, and prompt texts are frozen `prompts/get` bytes.
- No edit of the architecture spine by the implement stage; the lead writes the AD-24/AD-15 amendments (decision 5).
- Never publish or version anything: no `npm`/`pnpm`/`changeset publish`, `changeset version`, `vsce`/`ovsx publish`, `npm login` or `git tag`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Load, default (GET read) | Existing class `A.cls` has `Storage Default`; the file has none; `ignoreConflict` omitted | GET `doc/A.cls`, then no PUT for A. `failures[]` gets `{file, docName, error: <load text>, code: "STORAGE_DROPPED", droppedStorage: ["Default"]}`. Other files are uploaded; A is not compiled | A single-file call is `isError: true` (today's rule) |
| Load, `ignoreConflict: false` (409 read) | Same class and file | Unversioned PUT, then 409 (current text). The guard compares and the same failure entry follows; no second PUT | none |
| Load, override | `allowStorageRegeneration: true` on the same input | The PUT sequence is the one used without the guard. The result has `uploaded: 1`, and the additive `storageDrops: [{name: "A.cls", droppedStorage: ["Default"]}]` sits after `failed`/`failures`; the text names it | none |
| Load, nothing dropped | New class (GET 404); file keeps every name; `.mac`/CSP file | Requests and result as today; no `storageDrops` | none |
| Load, read fails | GET answers 500, or the document is unreadable or binary | That file fails with the error text and nothing is stored for it; the other files continue | none |
| Import, drop | `<Class name="A">` with no `<Storage name="Default">`; A has `Default` | One GET per `<Class>` and no POST. The refusal carries the import text and `{code, namespace, storageDrops: [{name: "A.cls", droppedStorage: ["Default"]}]}` | none |
| Import, override | Same input, `allowStorageRegeneration: true` | The POST is as today. `structuredContent` = the API result plus `storageDrops`, and a text block names the drops | none |
| Import, nothing dropped | No `<Class>`, or only new classes, or every name kept | One POST and an untouched `structuredContent`, as today | A GET error other than 404 throws; nothing is posted |
| Promote, drop | An allowlisted `putAndCompile` class step: the source copy lacks a target `Storage` | After the gates and the blank-namespace check, a GET-only preflight (versions, source, target). The refusal (promote text) carries `{code, source, target, storageDrops}`. No dialog, and no write in any domain | none |
| Promote, override | `allowStorageRegeneration: true` | The dialog `scope` gets the drops suffix. Each class is PUT with the preflight's source text. The result gets `storageDrops` (classes whose PUT succeeded) and a text line | Decline → `CONFIRMATION_DECLINED`; reads were made, no writes |
| Promote, nothing dropped | No class drop, non-class steps, or no documents steps | `scope`, `executed[]`, text and `structuredContent` as today. Non-class documents are still read in the batch | none |
| Promote, preflight read fails | Source has no content, or the target GET is not 404 | The failure is carried to that step at its turn: today's source message, or the target-read text. Earlier steps complete and later steps are skipped | none |
| Goldens | Eight ledger entries (Design Notes) | Frozen files are byte-unchanged; wire, cross-era and parity tests are green; snapshot `:check` is clean | An unregistered shape, or a properties entry that is not "old + one member before `server`", fails naming the id |
| Integration (live) | The real Atelier on `HSCUSTOM`, a compiled `ExecuteMCPv2.Temp.QaStory4211*` class with `Storage Default` | Each refused call leaves the class's `ts`, content and Storage lines unchanged. Each override leg leaves no Storage block | The gate is red when that path's guard is removed |

</intent-contract>

## Code Map

All paths are from the repo root. `D/` is `packages/iris-dev-mcp/src/`, and `T/` is `packages/iris-mcp-all/src/__tests__/`.

**Shared guard** — `packages/shared/src/storage-guard.ts`:
- `storageDefinitionNames` :38; `droppedStorageDefinitions` :50-60, whose name rule is extracted to `droppedStorageNames`; `storageDroppedRefusal` :76-95, whose text is extracted to `storageDroppedText`.
- `xmlStorageNames` :130-158 ignores class boundaries. Its tag scan (comments and CDATA skipped, `endOfTag`, `attributeValue`) is shared with the new `xmlClassStorageNames`.
- Exported at `packages/shared/src/index.ts:85-90`. `REFUSAL_CODES.STORAGE_DROPPED` is at `packages/shared/src/refusals.ts:19`, and `RefusalResult` at :47-54 fixes only `code`.
- Tests: `packages/shared/src/__tests__/storage-guard.test.ts`, with fixtures in `storage-guard-fixtures.ts`.

**`iris_doc_put` (the reference; its behavior does not change)** — `D/tools/doc.ts`:
- The 409 flow is :433-474. `currentDocument` (409 → `{content, ts}`) is :348-355 and is already imported by `load.ts:26`. `PUT_STORAGE_REMEDY` is :329-331, and the `allowStorageRegeneration` schema is :389-396.
- `readTextDocument` :95-102 plus `unreadableDocumentText` :105 are the GET reader that the new `currentClassLines` wraps (pattern: `doc-edit.ts:520-535`). `atelierDocRequest` is at `packages/shared/src/atelier.ts:205`.

**`iris_doc_load`** — `D/tools/load.ts`:
- `UploadFailure` :287-293. Schema :328-367: the `ignoreConflict` text :359-366 contains "unconditionally"; the new parameter goes after it.
- Per-file loop :422-526: identity check :449-463, path and query :465-471, PUT :477, the 409 retry :478-498, `refusal` :509-517. The result is :581-611.
- Its `put` count stays 2 (`T/document-write-paths.test.ts:88-94`).

**XML import** — `D/tools/format.ts`:
- Schema :112-148: `compile` uses `z.boolean()`; the new parameter goes after `namespace`.
- Import :197-271: lines :224, POST :226, and `structuredContent: response.result` :269.
- Live probe (2026-10-21, IRIS 2026.2 Build 221U): `action/xml/load` of an exported class with its `<Storage name="Default">` removed returned `imported: [<name>.cls]`, and `GET /doc` then showed no Storage block. An export is `<?xml…?><Export …><Class name="Pkg.X">…<Storage name="Default">…</Storage></Class></Export>`.

**`iris_env_promote`** — `D/tools/env-promote.ts`:
- `runDocumentsBatch` :820-921: source GET and fail-closed check :838-851, PUT `?ignoreConflict=1` :853-854.
- `promotionScope` :974-981 with `CONFIRMATION_STEP_LIMIT` :968. `ExecuteInput` :957-965.
- Blank-namespace check :1180-1185, then the dialog :1187-1193. Lazy `negotiateVersion` :1219-1220; it is a single GET (`packages/shared/src/atelier.ts:72-103`).
- The result is :1252-1264. Description :1340-1399: the 43.4 "HUMAN CONFIRMATION" paragraph is last, and paragraphs are separated by `"\n\n"`. Schema :1400-1456; the new parameter goes after `namespace`. Handler cast :1474-1483.
- `buildDocumentsSteps` :248-273: subjects can be any document type.
- The confirmation hash covers the zod-parsed args (`packages/shared/src/server-base.ts:2020,2070`), so do not give the new parameter a `.default()`.

**Rosters and claims:**
- `T/document-write-paths.test.ts`:
  - Header :10 "exhaustive as of 2026-10-15".
  - Roster :72-160 (three `excluded` entries :87-110).
  - Ledger-id rule :288-296. The guard-call check :298-307 requires the literals `droppedStorageDefinitions(` and `storageDroppedRefusal(`. The "three exclusions" check is :309-316.
- `T/story-38-3-qa-doc-claims.test.ts`:
  - :303-309: the CHANGELOG 38.3 section names DW-544/545/546 (historical; keep), and the roster contains them (changes).
  - :312-336: the README `- **Unguarded paths.**` item against `NAMED` (five tools) and the roster regex :332.
  - :372-385: the code and field owners.
- `T/story-43-3-confirmation-both-eras.test.ts:424-445`: `GATING_PARAMETERS` contains `allowStorageRegeneration`, and the tools that carry one must equal the keys of `NAMED`. Add `iris_doc_xml_export`, and update the `iris_doc_load` verdict.
- `T/story-38-7-doc-claims.test.ts:160-178`: the dev README `iris_doc_load` row and `tool_support.md` row 7.
- `T/story-42-10-doc-claims.test.ts:69` (the Annotations cells stay).
- Docs:
  - `packages/iris-dev-mcp/README.md`: rows `iris_doc_load` :150, `iris_doc_xml_export` :179, `iris_env_promote` :238; the "Storage guard" bullet :372-379 and the "Unguarded paths" bullet :380-384, inside the `iris_doc_put` details. Line :371 "No path sends an extra GET or HEAD" is about `iris_doc_put` and stays true.
  - Root `README.md`: bullet :474 and the `STORAGE_DROPPED` row :482 (3 cells, pinned by `story-38-6-doc-claims.test.ts:103-110`).
  - `tool_support.md`: rows :35 (7), :40 (12) and :56 (28); the per-story notes run from :202, with Story 42.10 at :226.
  - `CHANGELOG.md:5`: the top-section format; `entryOf` finds `## …Story 42.11:`.

**Goldens machinery** (no loader change):
- `T/fixtures/sdk-wire-golden.json`: dev `main` tools-list (line 41) has `iris_doc_xml_export` at index 9, `iris_doc_load` at 21 and `iris_env_promote` at 27; dev `core-preset` (line 261) has `iris_doc_load` at 11. Each `properties` object ends with the framework's `server`.
  - `story-43-1-sdk-wire-golden.test.ts:224-233` compares raw lines byte for byte, so key order matters.
  - The loader writes `structuredClone(new)` (`golden-sanctioned-changes.mjs:215`), so the key order of `new` is the emitted order.
  - The handler golden has no row that runs these tools; only governance denial rows exist.
- `T/story-43-4-sanctioned-golden-changes.test.ts`:
  - `Shape`/`SANCTIONS` :151-278 and `shapeProblems` :285-306.
  - The id lists `STORY_43_4_IDS`/`STORY_42_10_IDS` :46-85 and `STORIES` :88-91, the exact-order check :353-361, and `old` chains :363-373.
  - :433 `changes.slice(0, -1)` assumes the last entry is the 42.10 audit entry, so it must widen.
  - CHANGELOG pairs :530-558.
- `T/story-43-4-qa-sanctioned-wire.test.ts`:
  - The independent oracle is `SANCTIONED` :88-115, `FLIPPED` :120-134, and `sanctionedTool()` :154-172, which gets 42.11 after :166.
  - `markerCount` :186 and :279-283 counts "human confirmation", which the new sentences must never contain.
- `T/story-42-10-snapshot-ledger-parity.test.ts`: chains :99-119, and :167-168 lists multi-entry chains (the `iris_env_promote` description becomes one).
- `T/story-43-4-qa-gate-guards.test.ts:30-41`: register only a file that calls `readSanctionedGolden(`.

**Fakes to reuse:**
- `createMockHttp`/`createMockCtx` are in `packages/shared/src/__tests__/test-helpers.ts:84-151`; every method is a bare `vi.fn()`, and the dev package re-exports them from `D/__tests__/test-helpers.ts:8`.
- `D/__tests__/conflict-fakes.ts` has `conflict(path, result)` (a 409 `IrisApiError`) and `currentClass(lines, ts)`. A 404 is `new IrisApiError(404, [], path, "not found", null)` (`doc-edit.test.ts:1321`).
- `D/__tests__/doc-put-storage-guard.test.ts` has `existingClass()` :265-269 and the drop fixtures :225-234.
- `D/__tests__/env-promote-execute.test.ts` has `versionResponse` :49-51, `documentsDiff` :889-905, `recordedCalls`/`expectNoIrisCalls` :1708-1723, `firstCallOrder` :1637-1641, the confirm fakes :1622-1634 and `arrangeDocuments` :1760-1778.
- The wire fake `scripts/lib/fake-iris-listener.mjs` answers `Demo.Sample.cls` with 200 and no Storage, `Demo.Stored.cls` with `Storage Default` (:49-70), and 404 otherwise (:145-174).

**Tests that break (update them):**
- `D/__tests__/load.test.ts`:
  - :228, :448-458 and :472-481 (first-PUT query and 409 pins on the default path).
  - Every default-path `.cls` test whose `get` is not mocked: at least :699, :736, :822, :836, :873, :1097-1146 and :1175. A bare `vi.fn()` `get` returns `undefined`, so give each a 404 or a content mock.
  - :460-469 (`ignoreConflict` text).
- `D/__tests__/format.test.ts:146-179`: a `<Class>` with no GET mock; give it a 404.
- `D/__tests__/env-promote-execute.test.ts`:
  - :907-961, :963-1007, :1009-1058 and :1060-1108: the target `get` mock throws on a doc path, so add 404 or content answers.
  - :1110-1151: the carried source failure must keep its message.
  - :1805-1831: the dialog now comes after the preflight GETs and before the first write.
  - :2076-2090: a decline asserts no writes, not no calls.

**Live gate pattern:**
- `D/__tests__/doc-put-storage-guard-live-gate.test.ts`: arming :65-72, `beforeAll`/`afterAll` with the leftover checks :247-281, and fixtures, snapshot and `removeFixtures` :74-123 and :176-223. Helpers are in `D/__tests__/live-doc-helpers.ts`.
- Two-client promote legs: `D/__tests__/story-38-7-qa-live-gate.test.ts:357-465`.
- Roster: `packages/iris-dev-mcp/scripts/prepublish-gate.mjs:73-102`, checked by `T/live-gate-roster.test.ts`.

## Tasks & Acceptance

**Execution:**

*Shared guard (AC 42.11.1; Rule 2: extend `storage-guard.ts`):*
- `packages/shared/src/storage-guard.ts` — Add the following, each with a contract doc comment:
  - `droppedStorageNames(currentNames, keptNames)`: the rule `droppedStorageDefinitions` now delegates to.
  - `xmlClassStorageNames(lines)`: a `Map` from each `<Class name>` to its `<Storage name>`s in source order. It skips comments and CDATA, ignores non-`Class` elements, and is built on the same tag scan as `xmlStorageNames`.
  - `storageDroppedText`: the existing text, which `storageDroppedRefusal` now returns through.
  - `StorageDroppedDetail` + `storageDroppedDetail(dropped)` → `{code: REFUSAL_CODES.STORAGE_DROPPED, droppedStorage}`.
  - `StorageDrop` + `storageDrop(name, dropped)` → `{name, droppedStorage}`.
  - `describeStorageDrops(drops, limit?)`.
  - `storageDropsRefusal(opening, drops, remedy, fields)`.

  Export them from `packages/shared/src/index.ts`. The texts are in Design Notes. Why: one owner of the rule and the field names.
- `packages/shared/src/__tests__/storage-guard.test.ts` — Add cases for:
  - multi-class XML; a class without `<Storage>`; `<Storage>` inside CDATA or a comment; `<Routine>`/`<Project>` elements; an `<?xml?>` declaration;
  - the exact texts for one and several drops; `describeStorageDrops` with its limit.

  Existing cases stay green.
- `D/tools/doc.ts` — Add `currentClassLines(http, atelierVersion, namespace, name)`: `atelierDocRequest(GET doc/<name>)` → `readTextDocument`. It returns the lines, `undefined` on a 404, and throws an `Error` with `unreadableDocumentText` text for an unreadable or binary document; any other failure is rethrown. `iris_doc_put` stays unchanged. Why: one GET reader for load, import and promote.

*`iris_doc_load` (DW-652, DW-544):*
- `D/tools/load.ts`:
  - **Schema.** Add `allowStorageRegeneration: booleanParam.optional()` (text in Design Notes) after `ignoreConflict`. In the `ignoreConflict` text, replace "unconditionally" with "without a version check". Append the description sentence (Design Notes).
  - **Guard.** For a class file (identity check passed):
    - `ignoreConflict` true: call `currentClassLines` before the PUT.
    - `ignoreConflict` false: read the 409's `currentDocument` before the retry.
    - If drops exist and there is no override, push the failure `{file, docName, error: storageDroppedText(docName, ns, dropped, LOAD_STORAGE_REMEDY), ...storageDroppedDetail(dropped)}` and `continue`.
    - If the override is set and the save succeeds, collect `storageDrop(docName, dropped)`.
  - **Result.** Add `storageDrops` and its text sentence only when non-empty. The `UploadFailure` type takes its drop fields from `StorageDroppedDetail`.
  - Why: AC 42.11.1-2; the default-path PUT stays byte-identical.
- `D/__tests__/load-storage-guard.test.ts` (new) — Cover the five load matrix rows with exact texts and request sequences (GET then `?ignoreConflict=1` PUT; PUT → 409 → no second PUT). A refused file is not compiled. A mixed batch continues. Why: the matrix.
- `D/__tests__/load.test.ts` — Update the breaking pins from the Code Map: mock GET (404 for a new class), keep the expectations of every non-guard test, and pin the new `ignoreConflict` text. Why: Rule 19's shared surface.

*XML import (DW-652, DW-546):*
- `D/tools/format.ts`:
  - **Schema.** Add `allowStorageRegeneration: z.boolean().optional()` after `namespace`, and append the description sentence.
  - **Guard.** In `import`, after the empty-content check: run `xmlClassStorageNames(lines)`, then `currentClassLines` for each `<name>.cls`, then compare.
    - Drops without the override: return `storageDropsRefusal(IMPORT_OPENING, drops, IMPORT_STORAGE_REMEDY, {namespace: ns})` before the POST.
    - With the override: POST as today, then return `structuredContent` = `{...response.result, storageDrops}` plus a text block.
  - `export` and `list` are unchanged. Why: AC 42.11.1-2.
- `D/__tests__/format-storage-guard.test.ts` (new) — Cover the three import matrix rows (refusal with zero POSTs; the override; no class/new/kept is byte-identical; a 500 on the GET throws with no POST). `D/__tests__/format.test.ts:146-179`: add a 404 GET mock. Why: the matrix.

*`iris_env_promote` execute (DW-652, DW-545):*
- `D/tools/env-promote.ts`:
  - **Schema.** Add `allowStorageRegeneration: z.boolean().optional()` after `namespace`. Add it to `ExecuteInput` and the handler cast. Append the description paragraph.
  - **Preflight.** After :1185 and before the dialog, when an allowlisted `putAndCompile` step's subject is a class:
    - negotiate both Atelier versions (so the loop at :1219-1220 reuses them);
    - per class step, read the source with today's GET and fail-closed check (extract the source read from `runDocumentsBatch` so both use it), then read the target with `currentClassLines`;
    - record `{content, dropped}`, or `{error}` for a carried failure. Target-read failure text: `Could not read the target's copy of '<subject>' to check its Storage definitions: <error>. Nothing was written for this document.`
  - **Refusal.** Drops without the override: return `storageDropsRefusal(PROMOTE_OPENING, drops, PROMOTE_STORAGE_REMEDY, {source, target})` with `ProfileRef`s.
  - **Dialog.** With the override and drops, the `scope` is `promotionScope(...)` plus the drops suffix.
  - **Batch.** `runDocumentsBatch` takes the preflight map. A class step PUTs the recorded content, or fails with the carried error at its turn. Non-class steps GET as today. Collect `storageDrops` for class steps whose PUT succeeded, and add the field plus a rendered line only when non-empty.
  - Why: AC 42.11.1-2, AD-34 order, no TOCTOU on the source.
- `D/__tests__/env-promote-storage-guard.test.ts` (new) — Cover the four promote matrix rows:
  - the refusal (the confirm spy is never called; zero PUT/POST; no mapping write in a mixed plan);
  - the override (the exact `scope`; the PUT body equals the preflight's source text and no second source GET happens; `storageDrops`);
  - nothing dropped (byte-identical result);
  - a carried source or target failure;
  - a decline after the preflight (no writes).

  Also `D/__tests__/env-promote-execute.test.ts`: update the breaking tests from the Code Map. Why: the matrix.

*Rosters and claims (AC 42.11.3):*
- `T/document-write-paths.test.ts`:
  - The `load.ts`, `env-promote.ts` and `format.ts` entries become `guarded`, with no `ledger` and with reasons stating each read and refusal.
  - Add a `guard` member per guarded entry, naming the shared calls its source must contain (`doc.ts`/`doc-edit.ts`: `droppedStorageDefinitions(`, `storageDroppedRefusal(`; `load.ts`: `droppedStorageDefinitions(`, `storageDroppedDetail(`; `format.ts`: `xmlClassStorageNames(`, `storageDropsRefusal(`; `env-promote.ts`: `droppedStorageDefinitions(`, `storageDropsRefusal(`), and check them at :298-307.
  - Replace :309-316 with "no path is excluded" (the verdict stays in the vocabulary).
  - Change the dates :10 and :71 to "2026-10-21 (Story 42.11)".
  - Why: AD-24; Rule #56 (the scan's found set is unchanged).
- `T/story-38-3-qa-doc-claims.test.ts:303-336` — Keep the CHANGELOG half. The roster half asserts no `excluded` entry. Re-pin the README bullet `- **Document-write paths.**`, which names the five guarded tools, while `NAMED` keeps `iris_docdb_document` and `iris_global_set`. Why: the README rewrite.
- `T/story-43-3-confirmation-both-eras.test.ts:426-437` — Add `iris_doc_xml_export: "not gated, a candidate: allowStorageRegeneration (import)"`. `iris_doc_load` becomes `"not gated, a candidate: allowStorageRegeneration; ignoreConflict is a version-check override"`. `iris_env_promote` stays `gate: execute`. Why: the inventory test.
- `T/story-38-7-doc-claims.test.ts:160-178` — Re-pin the reworded `iris_doc_load` row and `tool_support.md` row 7. Why: doc rows.

*Goldens (decisions 1 and 3):*
- `T/fixtures/sdk-golden-sanctioned-changes.json` — Append the eight entries in Design Notes, in that order. Why: one entry per moved value.
- `T/story-43-4-sanctioned-golden-changes.test.ts`:
  - Add `STORY_42_11_IDS` and its length check.
  - Register two shapes: `S-42.11-storage-guard-schema` (count 4, `text: "none"`; the tool at the pointer is one of the three; `Object.keys(new)` = `Object.keys(old)` with `allowStorageRegeneration` inserted just before `server`; every other member is deep-equal, except `iris_doc_load`'s `ignoreConflict.description`, which equals the Design Notes text; the new member equals the Design Notes property) and `S-42.11-storage-guard-text` (count 4, append; `new` = `old` + the Design Notes separator and sentence).
  - Select the audit entry by id at :433, and add the two CHANGELOG pairs.
  - Why: the shape table is the precision check.
- `T/story-43-4-qa-sanctioned-wire.test.ts` — Add a spec-written 42.11 map (the three properties, the `ignoreConflict` text, and the four sentences with separators) applied in `sanctionedTool()` after the 43.4 sentence. Assert the frozen `properties` lack the member. Why: a second oracle that does not go through the loader.
- `T/story-42-10-snapshot-ledger-parity.test.ts:167-168` — Add the `iris_env_promote` description chain. Why: a new multi-entry chain.
- `T/fixtures/tools-list-snapshot.json` — After `pnpm --filter "./packages/*" build`, run `pnpm gen:tools-list-snapshot --force`. Never hand-edit it. Why: AD-14.

*Live gate (AC 42.11.3, Rule #59):*
- `D/__tests__/storage-guard-write-paths-live-gate.test.ts` (new) — Follow the `doc-put-storage-guard-live-gate.test.ts` pattern: in-process handlers, `buildToolContext`, armed by `IRIS_REQUIRE_LIVE`, and a skip otherwise.
  - Fixtures: `ExecuteMCPv2.Temp.QaStory4211Load`, `…Xml` and `…Prom` (`Extends %Persistent`, compiled, so `Storage Default`), plus a scratch directory under the OS temp directory.
  - Legs:
    - (1) Load, default: the refusal, with `ts`, content and Storage lines unchanged.
    - (2) Load, `ignoreConflict: false`: the refusal.
    - (3) Load, override: proceeds, `storageDrops`, and the stored class has no Storage block.
    - (4) Import of the tool's own export with `<Storage…>…</Storage>` removed: the refusal, class unchanged.
    - (5) Import, override: proceeds, no Storage.
    - (6) Promote: source and target clients on the same instance and namespace (as in `story-38-7-qa-live-gate.test.ts:357-465`). The source client's `get` for the fixture strips the Storage block from IRIS's real answer, which is a shape IRIS returns for a class saved without Storage. Result: the refusal, zero target PUT/POST, the target class unchanged.
    - (7) Promote, override: proceeds, `storageDrops`, no Storage on the target.
  - Before and after the run: no `QaStory4211` document or global.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` — Add the gate to `gateTestFiles`, with its fixture comment. Why: AD conventions (live gates).

*Docs and records (AD-15, Rule #43):*
- `packages/iris-dev-mcp/README.md`:
  - Rows :150, :179 and :238 get `allowStorageRegeneration?` with its default **false** and its effect. The `iris_doc_load` `ignoreConflict` cell says "without a version check".
  - The "Storage guard" bullet covers every path.
  - :380-384 becomes `- **Document-write paths.**`: the guard covers `iris_doc_put`, `iris_doc_edit` (action `apply`), `iris_doc_load`, the `iris_doc_xml_export` import and the `iris_env_promote` `execute` sync; the bootstrap, docdb and global sentences stay.
  - Update any details-section input list of the three tools.
- `README.md` — Extend bullet :474 to the three paths. The :482 "What to do" cell names `allowStorageRegeneration: true` on `iris_doc_put`, `iris_doc_load`, the `iris_doc_xml_export` import and `iris_env_promote` `execute`; keep 3 cells. If :677 claims that the gated descriptions are otherwise unchanged, scope it to Story 43.4 / 42.10.
- `tool_support.md` — Rows 7, 12 and 28 name the added GET reads. Add one Story 42.11 note: no tool count moves (110 package tools, 115 advertised); three paths are guarded; one parameter on each.
- `CHANGELOG.md` — A new top section `## [Pre-release — 2026-10-21] — Story 42.11: Storage Guard on Every Document Write` with `### Changed (AD-15 sanctioned)`:
  - the default refusal on each path (DW-652; wave-8 decisions #30 and #38);
  - `` `S-42.11-storage-guard-schema` `` and `` `S-42.11-storage-guard-text` ``;
  - DW-544/545/546 superseded;
  - 8 ledger entries with the goldens byte-unchanged; the snapshot regenerated;
  - no tool, key, refusal code or class added; the baseline unchanged; `BOOTSTRAP_VERSION` unchanged.
- `.changeset/story-42-11-storage-guard-on-every-document-write.md` — `minor` for `@iris-mcp/shared` and `@iris-mcp/dev` (a new parameter on three tools and new exports).
- `T/story-42-11-doc-claims.test.ts` (new) — Pin: the dev README rows contain `allowStorageRegeneration?`; the "Document-write paths" bullet names the five tools; the root README row; `tool_support.md` rows 7/12/28 and the note; the CHANGELOG section naming both sanctions and DW-652; the changeset bump map.

**Acceptance Criteria:**
- **AC 42.11.1 (default refusal).**
  - Given an existing class with `Storage Default`, when `iris_doc_load` (either `ignoreConflict`), the `iris_doc_xml_export` import or `iris_env_promote` `execute` would write text without it, then:
    - the write is refused with `STORAGE_DROPPED` and the exact Design Notes text naming `'Default'` and `allowStorageRegeneration`;
    - the class's `ts` and content are unchanged on the real instance;
    - `iris_doc_put` and `iris_doc_edit` behave as before.
- **AC 42.11.2 (override).**
  - Given the same input with `allowStorageRegeneration: true`, when each call runs, then the write proceeds and `structuredContent.storageDrops` equals `[{name: "<class>.cls", droppedStorage: ["Default"]}]`.
  - Given the default suite, when `pnpm gen:governance-baseline:check` runs, then it is clean, and no tool's `mutates`, governance key, annotation or preset changed.
- **AC 42.11.3 (rosters and live pins).**
  - Given the roster tests, when they run, then all five agent class-write paths are `guarded`, no path is `excluded`, and each guarded source contains its named shared-guard calls.
  - Given `IRIS_REQUIRE_LIVE=1`, when the new live gate runs, then all seven legs pass and leave no `QaStory4211` document or global. Each path's refusal leg goes red when that path's guard is removed (four mutations).
- **Goldens.** Given every package built, when the Epic 43 golden tests, the ledger and QA sanctioned-wire tests, the parity test and `pnpm gen:tools-list-snapshot:check` run, then all pass and both frozen goldens keep their SHA-256. In addition, `git diff` of the snapshot shows only `capturedAt`, the three new properties, the `iris_doc_load` `ignoreConflict` text and the four description sentences.

## Spec Change Log

## Review Triage Log

### 2026-10-21 — Review pass
- verdicts: 28 findings — high 0, medium 4, low 20, false 4, maybe-false 0
- findings:
  - `[low]` `[defer]` (blind 1) Agent prompts and skills (`deploy-and-test-class`, `promote-environment-change`) say nothing about the new `STORAGE_DROPPED` refusals — the intent's Never list excludes any prompt or skills-pack text change (frozen `prompts/get` bytes), so it is out of scope here; deferred to the docs re-certification (Story 42.9).
  - `[low]` `[reject]` (blind 2) A refused file in a mixed `iris_doc_load` batch reads as a near-success (`isError: false`) — spec-bound: the matrix makes a refusal a per-file `failures` entry with the other files continuing, exactly as `DOCUMENT_CONFLICT` already is; the result carries `failed`, `failures[].code` and the remedy.
  - `[false]` `[reject]` (blind 3) The root README confirmation section is stale for `iris_env_promote` — the preflight is "a check of the tool itself" that "runs first" (README "The order" bullet), the dialog still comes after the four gates and right before the first write, and "the same requests" for a client that cannot be asked compares with and without the dialog.
  - `[low]` `[patch]` (blind 4, edge 13, edge 16) The guard is check-then-write and the window is undocumented (load and import send an unconditional write after the read; on promote the read comes before the dialog and the mapping steps) — a sentence added to the dev README "Storage guard" bullet; a second target read at write time is out of design (AD-34 reads before the dialog; Design Notes decision 2 accepts the window).
  - `[low]` `[reject]` (blind 5) Read-failure texts differ and an unreadable class blocks even the override — spec-bound: the matrix says the file "fails with the error text" (load, import), the promote target-read text is given verbatim, and the read is needed to name `storageDrops`.
  - `[low]` `[reject]` (blind 6) The live gate has no leg that writes a genuinely new class or a class that keeps its Storage — the real 404 reading is the one `doc.ts` (`iris_doc_get`) has used since earlier epics, the unit rows pin both paths, and the spec fixes seven legs.
  - `[low]` `[patch]` (blind 7) The `xmlClassStorageNames` comment asserts how IRIS treats a class named twice, which no probe backs — the comment now states only the function's contract ("keeps the later element's names").
  - `[low]` `[patch]` (blind 8, edge 14, edge 15) One sequential GET per class (two per class step on promote) adds requests and Web Gateway timeout risk, undocumented — a sentence added to the dev README bullet; capping or concurrency would change the matrix's "one GET per `<Class>`".
  - `[low]` `[reject]` (blind 9) `allowStorageRegeneration` is `booleanParam` on `iris_doc_load` but `z.boolean()` on the import and promote — spec-bound: the schema of each tool is given in Tasks, follows that tool's own sibling parameters, and is pinned by the sanctioned wire entries.
  - `[low]` `[reject]` (blind 10) The refusal text and `storageDrops` list every dropped class while the dialog caps at ten — spec-bound: the `storageDropsRefusal` template lists every drop; a hundreds-of-classes refusal is rare.
  - `[medium]` `[patch]` (edge 11, edge 17) The dialog cuts a scope at 600 characters, so with ten realistic class steps the appended drops are lost and the person confirms blind (and the docs claim the dialog names the drops) — `promotionScope` now takes the drops suffix and lists fewer steps (`and N more`) until the whole scope fits 600 characters; with no drop it is byte-identical; the 12-class dialog row is re-derived (eight steps, 580 characters) and a long-names row added.
  - `[low]` `[reject]` (edge 12, verification-gap other 1) The import override names drops when the per-file status shows a failure — IRIS sets a non-empty status for a compile error on a class that was loaded, so it cannot tell a failed load from a failed compile; the line states what the XML omitted and the status text is surfaced beside it.
  - `[low]` `[patch]` (edge 13) see the entry of blind 4 (a promote target that changes after the preflight, for example through a mapping step of the same plan, is documented).
  - `[low]` `[patch]` (edge 14) see the entry of blind 8 (the import's sequential GETs).
  - `[low]` `[patch]` (edge 15) see the entry of blind 8 (the promote preflight's two GETs per class step).
  - `[low]` `[patch]` (edge 16) see the entry of blind 4 (the load's GET-to-PUT window).
  - `[medium]` `[patch]` (edge 17) see the entry of edge 11 (the claim that the dialog names the drops).
  - `[medium]` `[patch]` (verification-gap 1) No test varies the Atelier version per side on promote, so a swap in the preflight or the batch would silently disable the guard (a v7 target is read from a v8 route and a 404 reads as a new class) — a source v8, target v7 row added; the two swaps were applied and went red.
  - `[low]` `[patch]` (verification-gap 2) AC 42.11.2's pinning tests for the import result and the promote result had no `mutation:` line — the three mutations (import result, promote result, drop recorded before the PUT) were applied, went red and are recorded.
  - `[low]` `[reject]` (verification-gap other 1) see the entry of edge 12 (the import override result after a failed per-file status).
  - `[low]` `[patch]` (verification-gap other 2) The `format.ts` comment says `structuredContent` stays the untouched API result either way — replaced by the contract with the `storageDrops` exception.
  - `[low]` `[reject]` (intent D1) `tools/call` over the built server is not exercised by the new tests — spec-bound: the live gate is in-process handlers on the real Atelier (the doc-put precedent), the `tools/list` wire is covered by the ledger and goldens, and the existing 43.3 wire baselines cover the no-drop `tools/call`.
  - `[false]` `[reject]` (intent D2) The dialog is tested at the handler boundary, not the wire's two-round flow — on the wire each round re-runs the handler, so round two runs its own preflight and writes that text; nothing diverges.
  - `[false]` `[reject]` (intent D3) "Byte-identical apart from GETs" is not observable at the 43.3 wire baseline — the baseline records writes only and stayed green, and the request equality is pinned in the "nothing dropped" rows; the rewritten 43.3 handler rows are the spec's own "tests that break".
  - `[low]` `[reject]` (intent D4) The live promote legs are one instance playing both sides with a rewritten source read — spec-prescribed (Tasks, leg 6). Spec error recorded for the retro: the matrix row "Each override leg leaves no Storage block" cannot hold for promote, because `execute` compiles and the compile regenerates `Storage Default`; leg 7 asserts the true shape (no Storage in the PUT body, `storageDrops`, regenerated storage).
  - `[low]` `[reject]` (intent D5) Mutation evidence is at the handler path, not a wire gate — same as D1; the spec's Verification prescribes handler-path mutations.
  - `[medium]` `[patch]` (intent D6) The override text line is written out three times (`load.ts`, `format.ts`, `env-promote.ts`) and the `storageDrops` key by hand at three sites — the three copies of the one sentence now call `storageDropsNote` in `doc.ts` (internal to `@iris-mcp/dev`, next to `currentClassLines`; no new package export); the key name at each result stays, as the Tasks prescribe it.
  - `[false]` `[reject]` (intent D7) The diff edits the 38.3 and 38.7 doc-claims tests and the `iris_doc_put` README bullets, and the new gate has no `checkDistFresh` — the Tasks list those edits by name, and none of the sibling live gates calls `checkDistFresh`.

## Design Notes

**Governing ADs (Rule 6):**
- AD-24: the guard on every document-writing path; the exclusions removed (decision 5).
- AD-4: the override is a parameter, which is allowed because none of the three keys is a `defaultEnabled` write. Holders are only `iris_doc_edit:apply` and `iris_production_control:clean` (`doc-edit.ts:499`, `production.ts:197`); `iris_doc_load` and `iris_doc_xml_export:import` are frozen-baseline, so no `action` enum is possible; the parameter adds no new kind of side effect (it restores today's behavior); annotations are unchanged.
- AD-15: sanctioned default change, wave-8 decisions #30 and #38.
- AD-34: the preflight is a check before the dialog; the dialog is still immediately before the first write; the gated set is unchanged; precedent: `resendFiltered`'s read-only preflight.
- AD-17: a refusal changes nothing; halt on the first error.
- AD-18: the preflight reads are ungoverned reads; Gate 4 is unchanged.
- AD-19: audit unchanged.
- AD-2: cross-package checks live in `iris-mcp-all`.
- AD-14: generators only.
- Conventions: Frozen goldens, Refusals, Tool results, Tool descriptions, Live gates, Live testing on a shared instance.

**Rule 2 (extend, don't copy):**
- The new guard functions extend `storage-guard.ts`; `xmlClassStorageNames` shares `xmlStorageNames`' tag scan.
- `currentClassLines` wraps `readTextDocument`, the reader `iris_doc_get` and `iris_doc_edit` use.
- The load 409 read reuses `currentDocument`.
- Promote's source read is extracted from `runDocumentsBatch`, not copied.
- The new test files are siblings of `doc-put-storage-guard.test.ts`.
- The live gate copies the doc-put gate's skeleton, because each gate owns its fixtures (the precedent of four existing gates).

**Integration ACs:**
- The matrix row "Integration (live)": the consumers `iris_doc_load`, the import and `execute` read the shared guard and produce refusals on the real Atelier.
- **Consumes:** Story 38.3/38.4's guard (`storage-guard.ts`, the 409 read); Story 42.10's ledger machinery (no change).
- **Consumed-by:** Story 42.6 (publishes only with the dev live-gate roster green); Story 42.9 (re-certifies the docs).

**Texts.** The em dash is the existing `—`; write it as an escape in code.
- **New property, all three tools** (JSON in the key order of a frozen boolean sibling in the same row; the wire test confirms it): `{"description": <text>, "type": "boolean"}`.
  - `iris_doc_load`: "Boolean (true/false), default false. When false, a class file whose content drops one of the Storage definitions the class has now is refused (a failures entry with code STORAGE_DROPPED; nothing is stored for that file, and the other files continue); changing a Storage definition's content is allowed. When true, the file is uploaded, IRIS generates new storage at the next compile (which can change how existing rows are read), and the result's storageDrops names the dropped definitions. No effect on a new class or on other document types."
  - `iris_doc_xml_export`: "For action \"import\" only. Boolean (true/false), default false. When false, an import is refused (STORAGE_DROPPED, nothing loaded) if the XML of a class lacks one of the Storage definitions that class has now; changing a definition's content is allowed. When true, the import goes ahead, IRIS generates new storage at the next compile (which can change how existing rows are read), and the result's storageDrops names the dropped definitions. No effect on a new class or on other document types."
  - `iris_env_promote`: "For action 'execute' only. Boolean (true/false), default false. When false, 'execute' is refused before any write (STORAGE_DROPPED) if the source copy of a promoted class lacks one of the Storage definitions the target class has now; changing a definition's content is allowed. When true, the classes are promoted, IRIS generates new storage on the target at the next compile (which can change how existing rows are read), and the confirmation dialog and the result's storageDrops name the dropped definitions."
- **`iris_doc_load` `ignoreConflict`**: the frozen text with "overwrites its server copy unconditionally" changed to "overwrites its server copy without a version check". No other byte changes.
- **Description appends** (the separator, then the sentence):
  - `iris_doc_load` (main and core-preset), separator `" "`: "For an existing class, a file whose content drops one of the class's Storage definitions is refused and nothing is stored for that file (a failures entry with code STORAGE_DROPPED; the other files continue), because IRIS would generate new storage at the next compile, which can change how existing rows are read; allowStorageRegeneration (default false) lets it through, and the result names the dropped definitions."
  - `iris_doc_xml_export`, separator `" "`: "An import that would drop one of the Storage definitions a class has now (its XML lacks that definition) is refused with STORAGE_DROPPED and nothing is loaded, because IRIS would generate new storage at the next compile, which can change how existing rows are read; allowStorageRegeneration (default false) lets it through, and the result names the dropped definitions."
  - `iris_env_promote`, separator `"\n\n"`, after the 43.4 passage, which stays byte-identical: "STORAGE GUARD -- before the confirmation dialog and before any write, 'execute' reads the source and target copy of each class it would promote; if a source copy lacks one of the Storage definitions the target class has now, the whole execute is refused with STORAGE_DROPPED and nothing changes, because IRIS would generate new storage on the target at the next compile, which can change how existing rows are read. allowStorageRegeneration (default false) lets it through; the dialog and the result then name the dropped definitions."
- **Load failure `error`**: `storageDroppedText(docName, ns, dropped, LOAD_STORAGE_REMEDY)`, the existing template. `LOAD_STORAGE_REMEDY` = "Keep the Storage definitions in the file (read the class with iris_doc_get first), or pass allowStorageRegeneration: true to let IRIS regenerate the storage."
- **`storageDropsRefusal` text**: `<opening>: it drops <list> that <the class has|the classes have> now, and IRIS would generate new storage at the next compile, which can change how existing rows are read. <remedy>`.
  - `<list>` is each drop as `the Storage definition 'Default' of 'Pkg.A.cls'` or `the Storage definitions 'Default', 'Alt' of 'Pkg.B.cls'`, joined by `; `.
  - `structuredContent` = `{code, ...fields, storageDrops}`.
  - Import: `IMPORT_OPENING` = `The XML was not imported into namespace '<ns>' and nothing was stored`. `IMPORT_STORAGE_REMEDY` = "Keep each class's Storage elements in the XML (export the classes with iris_doc_xml_export first), or pass allowStorageRegeneration: true to let IRIS regenerate the storage."
  - Promote: `PROMOTE_OPENING` = `Promotion to server '<target>', namespace '<targetNs>' was not run and no changes were made`. `PROMOTE_STORAGE_REMEDY` = "Promote source copies that keep those Storage definitions, or pass allowStorageRegeneration: true to let IRIS regenerate the storage on the target."
- **`describeStorageDrops`**: `Pkg.A.cls ('Default'); Pkg.B.cls ('Default', 'Alt')`. With a limit, it lists the first `limit` documents, then `; and N more`.
  - The override text line (load, import, promote) is `Storage definitions dropped (allowStorageRegeneration; IRIS generates new storage at the next compile): <describeStorageDrops>.`
  - The promote dialog suffix is `; drops Storage definitions: <describeStorageDrops(drops, CONFIRMATION_STEP_LIMIT)>`, present only when there are drops.

**Ledger entries** (ids `42.11/<tail>/<tool>@dev-<session>`), in this order:
- `S-42.11-storage-guard-schema`, 4 entries: wire, `tools-list`, `replace`, pointer `/result/tools/<i>/inputSchema/properties`, for `iris_doc_load`@main (21), `iris_doc_load`@core-preset (11), `iris_doc_xml_export`@main (9) and `iris_env_promote`@main (27).
  - `old` is the frozen object. `new` is the same object with the new member inserted just before `server`, plus, for `iris_doc_load`, the corrected `ignoreConflict` text.
- `S-42.11-storage-guard-text`, 4 entries: `replace`, `appendOnly: true`, pointer `/result/tools/<i>/description`, for the same four.
  - The `iris_env_promote` entry's `old` is the `new` of `43.4/description/iris_env_promote@dev-main`.

**Decided at the spec gate (2026-10-21):** all six recommendations were accepted as written. They are wave-8 orchestrator decisions #43 (replace the whole `properties` object), #44 (a GET before the unchanged PUT), #45 (the description sentences and the "unconditionally" correction), #46 (DW-544, DW-545 and DW-546 resolved-by this story at its adjudication), #47 (the lead wrote the AD-24 and AD-15 amendments from the text below; `lint_spine.py` is clean) and #48 (a failed preflight read fails its step). The implement stage does not edit the spine.

**Orchestrator decisions needed (as planned):**
1. **Orchestrator decision needed: how the new parameter moves frozen `inputSchema` bytes — recommended: replace the whole parent `properties` object under its own sanction, with no loader `add` op, because:**
   - (a) `story-43-1-sdk-wire-golden.test.ts:233` compares raw lines byte for byte, and the framework's `server` member is last in every `properties`. An RFC 6902-style `add` would append after `server` and emit the wrong bytes, so it would need a positional-insert op.
   - (b) The loader and every ledger test already handle object `old`/`new` (the 43.4 governance-resource `remove`; `sameJson`; `restoreAt`).
   - (c) The spine convention asks for "the exact frozen value", which an `add` lacks.
   - (d) The shape table recovers the precision ("old + exactly one member before `server`").

   Alternative: an ordered `add` op (loader, schema, the undo/chain/parity logic, plus a convention amendment).
2. **Orchestrator decision needed: `iris_doc_load`'s read on the default (`ignoreConflict: true`) path — recommended: a GET before the unchanged `?ignoreConflict=1` PUT, rather than the handoff's copy of the 409 flow, because:**
   - It keeps the write sequence byte-identical, including Story 38.7's live pin "ONE unconditional `?ignoreConflict=1` PUT" (`story-38-7-qa-live-gate.test.ts:338-352`).
   - The guard then does not depend on Atelier refusing an unversioned PUT with a 409. That behavior was live-proven only on 2026.x, while the support claim is 2023.1+.
   - It shares one GET reader with the import and promote.

   The `ignoreConflict: false` path keeps the 409 read, already its version read. Cost: the unit fakes of the default path need a GET mock. The read-to-write window under `ignoreConflict: true` matches `iris_doc_put`'s.
3. **Orchestrator decision needed: also change tool text — recommended: yes, append one sentence to each description and correct `iris_doc_load`'s "unconditionally", because** a default refusal is behavior an agent should read before it hits one (the `iris_doc_put` precedent), and "unconditionally" becomes false. Cost: 4 more appendOnly entries; the correction rides inside the `properties` entry the shape table already checks. Alternative: parameter text only (4 entries, a stale `ignoreConflict` text).
4. **Orchestrator decision needed: the adjudication of DW-544, DW-545 and DW-546 (`wontfix-accepted`, owner `38-3`) — recommended: `resolved-by:42-11-storage-guard-on-every-document-write` at this story's `ledger_adjudicated`, because** the paths are now guarded and each `reopen_if` trigger is now prevented by the live-pinned refusal.
5. **Orchestrator decision needed: the spine amendments (Rule 20) — recommended: the lead writes them at the spec gate, because** the implement stage never edits planning artifacts.

   **AD-24**, `Storage guard` bullet, replacing its first two sub-bullets:

   > One shared Storage-drop guard in `@iris-mcp/shared` covers every agent path that can replace an existing class: `iris_doc_put`, `iris_doc_edit`, `iris_doc_load`, the `iris_doc_xml_export` import and the `iris_env_promote` `execute` sync (Story 42.11, DW-652, wave-8 decisions #30 and #38). By default each refuses, with `STORAGE_DROPPED` and nothing changed, a write that would drop a Storage definition the class has now.
   > - **Overrides.** `iris_doc_put`, `iris_doc_load`, the import and `execute` take the `allowStorageRegeneration` parameter. With it the write proceeds, and on the last three the result's `storageDrops` names what was dropped. `iris_doc_edit` uses its `regenerateStorage` action (AD-4).
   > - **Reads.** `iris_doc_load` reads each class with a GET before its `?ignoreConflict=1` PUT, or from the 409 when `ignoreConflict` is false. The import GETs each `<Class>` before its one `xml/load` POST and refuses the whole import. `execute` runs a GET-only preflight before its confirmation dialog and writes the source text it checked.
   > - Story 38.3 enumerates every document-writing path (Atelier PUT, `xml/load`, bootstrap PUT), exhaustive as of a named date (last 2026-10-21), and gives each a verdict. No agent path is excluded; the bootstrap PUT is not applicable (its classes have no Storage).

   Also amend the title tag to *(lands in Stories 38.2 to 38.4 and 42.11)*.

   **AD-15**, a sanctioned-list bullet:

   > **Story 42.11** (wave-8 decisions #30 and #38): the storage-drop refusal on `iris_doc_load`, the `iris_doc_xml_export` import and `iris_env_promote` `execute`, with the optional `allowStorageRegeneration` parameter on each. `S-42.11-storage-guard-schema` adds the parameter and drops "unconditionally" from `iris_doc_load`'s `ignoreConflict` text. `S-42.11-storage-guard-text` appends one sentence to each description (DW-652; DW-544, DW-545 and DW-546 superseded).

   Then run `lint_spine.py` clean.
6. **Orchestrator decision needed: a promote preflight read that fails — recommended: carry it to that step, which fails at its turn under halt-on-first-error, rather than refusing the whole execute, because** today's results for a missing or empty source document stay byte-identical (`env-promote-execute.test.ts:1110-1151`, `story-43-3-qa-hand-gates.test.ts:297-330`). Only a detected drop is a whole refusal, and nothing is written for the failed document either way.

**Rule #56 (completeness, 2026-10-21):**
- The roster scan finds no new write site: `load.ts` keeps 2 puts, `env-promote.ts` 1 put, `format.ts` 1 xmlLoad, and the GETs are not write patterns.
- Other write tools that touch classes are recorded outside the guard: production, item and CreateApplication are `not-applicable`; docdb and global are `not-a-document-write`.
- The arbitrary-code tools (`iris_execute_command`, `iris_execute_classmethod`, `iris_sql_execute` DDL) are governed by AD-25 and governance, not by a text guard, because the guard cannot see their writes.

**AC reinterpretations:**
- AC 42.11.2 "the result names the dropped definitions" means the additive `storageDrops` field plus a text line on the three new paths. `iris_doc_put`'s override result is unchanged ("each new path").
- AC 42.11.3 "a live refusal pin per path" means four refusal pins (`iris_doc_load` has two read sites) plus override legs.
- "Each new refusal is a sanctioned backward-compatibility change named in the CHANGELOG" means the CHANGELOG section names the behavior sanction (decisions #30 and #38) and both golden sanctions.

**Ledger inbox:** DW-652 → every task above and every matrix row. DW-544, DW-545 and DW-546 (context, terminal) → decision 4.

## Verification

Build after each source change. Before the snapshot or golden tests: `pnpm --filter "./packages/*" build` (timeout 600000). Run every command from `/Users/jbrandt/git/iris-execute-mcp-v2`, each in its own foreground call with `timeout: 600000`, with nothing re-submitted on a client timeout.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/storage-guard.test.ts src/__tests__/refusals.test.ts` — expected: green.
- `(loop)` `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/load-storage-guard.test.ts src/__tests__/format-storage-guard.test.ts src/__tests__/env-promote-storage-guard.test.ts src/__tests__/load.test.ts src/__tests__/format.test.ts src/__tests__/env-promote-execute.test.ts src/__tests__/doc-put-storage-guard.test.ts` — expected: green.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/document-write-paths.test.ts src/__tests__/story-38-3-qa-doc-claims.test.ts src/__tests__/story-38-7-doc-claims.test.ts src/__tests__/story-42-11-doc-claims.test.ts src/__tests__/story-43-3-confirmation-both-eras.test.ts src/__tests__/live-gate-roster.test.ts src/__tests__/story-38-6-doc-claims.test.ts src/__tests__/story-42-10-doc-claims.test.ts` — expected: green.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-4-sanctioned-golden-changes.test.ts src/__tests__/story-43-4-qa-sanctioned-wire.test.ts src/__tests__/story-43-4-qa-gate-guards.test.ts src/__tests__/story-42-10-snapshot-ledger-parity.test.ts src/__tests__/tools-list-snapshot.test.ts src/__tests__/story-43-1-sdk-wire-golden.test.ts src/__tests__/story-43-2-cross-era-pin.test.ts src/__tests__/story-43-1-qa-handler-golden.test.ts src/__tests__/epic43-capstone-gate.test.ts` — expected: green.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-43-3-qa-hand-gates.test.ts src/__tests__/story-43-3-qa-fallback.test.ts src/__tests__/story-43-3-qa-binding.test.ts` — expected: green (the no-drop promote output is unchanged).
- `(loop)` `pnpm gen:tools-list-snapshot:check` — expected: clean (115 entries).
- `(loop)` `bash /private/tmp/claude-501/-Users-jbrandt-git-iris-execute-mcp-v2/03eb9a39-2d9e-4087-85ac-363a9bb86d2a/scratchpad/live-run.sh @iris-mcp/dev src/__tests__/storage-guard-write-paths-live-gate.test.ts` (lead spec gate: the wrapper arms `IRIS_REQUIRE_LIVE=1` against `localhost:52773`/`HSCUSTOM` with the local `iris-dev` credentials, never echoed; rebuild `@iris-mcp/shared` and `@iris-mcp/dev` first) — expected: 7 legs pass; no `QaStory4211` leftovers. Run it alone in its call.
- `(loop)` the same env with `src/__tests__/story-38-7-qa-live-gate.test.ts`, then (a separate call) `src/__tests__/doc-put-storage-guard-live-gate.test.ts` — expected: green and unchanged.
- `(once)` `pnpm --filter <pkg> test` for each of `@iris-mcp/shared`, `dev`, `admin`, `data`, `interop`, `ops`, `client-config` and `all` (one call each; split `@iris-mcp/all` by file globs if it would pass 10 minutes) — expected: green.
- `(once)` `pnpm --filter <pkg> type-check` and `pnpm --filter <pkg> lint` for the 7 TypeScript packages — expected: green.
- `(once)` `pnpm gen:governance-baseline:check`, `pnpm gen:skills:check`, `pnpm gen:pack:check`, `pnpm check:provenance`, `pnpm validate:prompts` — expected: all clean.
- `(once)` `git diff --stat -- packages/iris-mcp-all/src/__tests__/fixtures/sdk-wire-golden.json packages/iris-mcp-all/src/__tests__/fixtures/sdk-handler-golden.json` — expected: empty.
- `(once)` `uv run --no-cache .claude/skills/bmad-architecture/scripts/lint_spine.py --workspace _bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14` — expected: clean, with the lead's amendments present (decision 5).

**Mutations to apply and record** (`mutation: <change> → <red test>`). Apply each to the real file and observe red on the path it guards. Then restore from a scratchpad copy, check with `cmp` that it is byte-identical, and confirm `git status --short` is unchanged. Rebuild the package when a gate or snapshot reads its dist.
- AC 42.11.1/3, the load GET read: skip the drop check on the `ignoreConflict: true` path → red: live leg (1) (the real class loses `Default`) and the matching `load-storage-guard.test.ts` row.
- The load 409 read: skip the check before the version-checked retry → red: live leg (2) and its unit row.
- The import: skip the pre-POST refusal → red: live leg (4) and its unit row.
- Promote: skip the preflight refusal → red: live leg (6) (the target class loses `Default`) and its unit row. Then make the batch re-GET the source instead of using the preflight text → red: the no-second-GET row.
- AC 42.11.2: drop `storageDrops` from the load result → red: the load override row and live leg (3).
- Rosters: put `verdict: "excluded"` back on `format.ts` → red: the no-exclusion row. Remove `storageDropsRefusal(` from the `env-promote.ts` source → red: the guard-call row.
- Goldens: move `allowStorageRegeneration` after `server` in one `new` → red: the schema shape row and the wire raw-line row. Delete one `S-42.11-storage-guard-text` entry → red: the ledger count row and the parity test.
- AC 42.11.2 (the classification is unchanged): set `iris_env_promote`'s `mutates.execute` to `"read"` (dev rebuilt) → red: the dev governance tests that refuse a default `execute` (`env-promote-governance.test.ts`; record which rows). Then add `.default(false)` to the new `iris_env_promote` parameter → red: `story-43-1-sdk-wire-golden.test.ts` (the emitted schema gains `default`) and `pnpm gen:tools-list-snapshot:check`.

**Mutation results (implement pass, 2026-10-21).** Each change was applied to the real file, run on the path it guards (the unit rows closed-port; the live legs through `live-run.sh`, one call each), then restored from a scratchpad copy; `cmp` confirmed every restored file byte-identical and `git status --short` was unchanged. Dev and shared `dist/` were deleted and rebuilt afterwards (a restored source is newer than its unchanged dist).
- mutation: `load.ts` GET read, `dropped = droppedStorageDefinitions(existing, lines)` → `dropped = []` → red: `load-storage-guard.test.ts` (6 rows: the four GET-read rows and two override rows) and live leg 1 (and leg 3, which lost `storageDrops`).
- mutation: `load.ts` 409 read, `dropped = droppedStorageDefinitions(current.content, lines)` → `dropped = []` → red: `load-storage-guard.test.ts` (the 409 refusal row and the `ignoreConflict: false` override row) and live leg 2.
- mutation: `format.ts` import refusal, `if (drops.length > 0 && …)` → `if (false && …)` → red: `format-storage-guard.test.ts` (4 rows) and live leg 4.
- mutation: `env-promote.ts` preflight refusal, `if (planned.length > 0 && …)` → `if (false && …)` → red: `env-promote-storage-guard.test.ts` (5 refusal rows) and live leg 6 (the target class was overwritten).
- mutation: `env-promote.ts` batch reads the source again instead of using the preflight text → red: `env-promote-storage-guard.test.ts` "writes the source text the preflight checked", `env-promote-execute.test.ts` "asks after the GET-only preflight" (the source's second document GET) and live leg 7 (two source GETs of the class).
- mutation: `load.ts` result drops `storageDrops` → red: `load-storage-guard.test.ts` (3 override rows) and live leg 3.
- mutation: `document-write-paths.test.ts` `format.ts` verdict back to `"excluded"` → red: "all five agent class-write paths are guarded, and no path is excluded", "only a guarded path names guard calls", "every entry has a reason, and each exclusion names its own ledger id", and the 38.3 README roster row.
- mutation: `storageDropsRefusal(` renamed out of the `env-promote.ts` source → red: `document-write-paths.test.ts` "every guarded path is found, and its source runs the shared guard calls that its entry names".
- mutation: ledger `new` of `42.11/storage-guard-schema/iris_doc_xml_export@dev-main` with `allowStorageRegeneration` after `server` → red: `story-43-4-sanctioned-golden-changes.test.ts` "every sanction is registered with a shape" and `story-43-1-sdk-wire-golden.test.ts` "tools-list: the raw response line is byte-identical to the golden" (iris-dev-mcp main).
- mutation: ledger entry `42.11/storage-guard-text/iris_doc_xml_export@dev-main` deleted → red: `story-43-4-sanctioned-golden-changes.test.ts` (the id-order, shape-count and per-tool rows) and `story-42-10-snapshot-ledger-parity.test.ts` (the parity and the three non-vacuity rows).
- mutation: `iris_env_promote` `mutates.execute` `"write"` → `"read"` (dev rebuilt) → red: `env-promote-governance.test.ts`, "under EMPTY IRIS_GOVERNANCE, `execute` is DENIED with GOVERNANCE_DISABLED; handler NOT called" and "an explicit IRIS_GOVERNANCE disable of `plan` overrides its read default-enable".
- mutation: `.default(false)` on the `iris_env_promote` parameter (dev rebuilt) → red: `story-43-1-sdk-wire-golden.test.ts` (the raw tools-list line and "the v2 client sees the golden result") and `pnpm gen:tools-list-snapshot:check` ("allowStorageRegeneration.default: snapshot (absent) / live false").
- mutation: `storage-guard.ts` `xmlClassStorageNames` no longer ends the class scope at `</Class>` → red: `storage-guard.test.ts` ("a Storage element outside a class does not count…" and "names are exact: a class named twice…").
- mutation: `storage-guard.ts` `describeStorageDrops` without the `; and N more` tail → red: `storage-guard.test.ts` "describeStorageDrops with a limit lists the first documents and then says how many more".
- mutation: `storage-guard.ts` `droppedStorageNames` compares case-insensitively → red: `storage-guard.test.ts` ("a rename is a drop, and names are case-sensitive" and "droppedStorageNames … compares exactly").
- mutation: `env-promote.ts` dialog scope without the drops suffix → red: `env-promote-storage-guard.test.ts` ("asks with the drops in the scope…" and "lists the first ten dropped documents in the dialog…").
- mutation: `env-promote.ts` target-read failure without its text → red: `env-promote-storage-guard.test.ts` ("a target read that fails…" and "an unreadable or binary target copy…").
- mutation: `doc.ts` `currentClassLines` maps HTTP 410, not 404, to `undefined` → red: 10 rows across `load-storage-guard.test.ts`, `format-storage-guard.test.ts` and `env-promote-storage-guard.test.ts` (every new-class row).
- mutation: dev README `iris_env_promote` row without `allowStorageRegeneration?` → red: `story-42-11-doc-claims.test.ts` "each of the three rows lists allowStorageRegeneration? …".
- mutation: CHANGELOG without the backticks around `S-42.11-storage-guard-text` → red: `story-43-4-sanctioned-golden-changes.test.ts` "each sanction id appears, in backticks…" and `story-42-11-doc-claims.test.ts` "has the sanctioned-change heading…".
- mutation: the new live gate removed from `prepublish-gate.mjs` `gateTestFiles` → red: `live-gate-roster.test.ts` "iris-dev-mcp: every armed test file is in … gateTestFiles".

**Mutation results (review pass, 2026-10-21).** Same procedure: applied to the real file, run closed-port, restored from a scratchpad copy, `cmp` byte-identical, `git status --short` unchanged.
- mutation: `env-promote.ts` `promotionScope` without the budget loop (the drops suffix is cut by the dialog again) → red: `env-promote-storage-guard.test.ts` "lists the first ten dropped documents in the dialog … so that the drops fit the dialog" and "long class names > the drops survive the dialog's cut".
- mutation: `env-promote.ts` preflight call passes the target version for the source read and the source version for the target read → red: `env-promote-storage-guard.test.ts` "reads and writes each side with the Atelier version that side negotiated: source v8, target v7".
- mutation: `env-promote.ts` batch call passes the two Atelier versions swapped → red: the same row (the PUT path is v8, not v7).
- mutation: `format.ts` import override result without `storageDrops` (AC 42.11.2, import) → red: `format-storage-guard.test.ts` "posts as today, and the result is the API result plus storageDrops …" and "with compile: true the load carries the compile flags and the drops are still named".
- mutation: `env-promote.ts` result without the `storageDrops` field (AC 42.11.2, promote) → red: `env-promote-storage-guard.test.ts` "the result adds storageDrops after summary …", "names a class in storageDrops only when its PUT succeeded" and the 12-class dialog row.
- mutation: `env-promote.ts` records a drop before its PUT succeeds → red: `env-promote-storage-guard.test.ts` "names a class in storageDrops only when its PUT succeeded".
- mutation: `doc.ts` `storageDropsNote` text "Storage definitions dropped" → "Storage definition dropped" → red: the load, import and promote override-text rows (one each).

**Shared surfaces:**
- `tools-list-snapshot.json`.
- `sdk-golden-sanctioned-changes.json` and its id lists, shape table and CHANGELOG pairs.
- The three tools' `inputSchema` and descriptions (golden tests; `load.test.ts:460-469`).
- `DOCUMENT_WRITE_PATHS`.
- The 38.3 doc-claims `NAMED` and the 43.3 `NAMED`.
- The dev README rows and the guard bullets, the root README bullet and the `STORAGE_DROPPED` row, `tool_support.md` rows 7/12/28 and the notes, and the `CHANGELOG.md` top section.
- The dev `prepublish-gate.mjs` roster.
- `iris_doc_load`'s per-file request sequence (a GET before each class PUT on the default path).
- `iris_env_promote` execute's call order (preflight GETs before the dialog; a decline makes reads only).

**Standing criterion:** every test added or changed passes on a fresh environment, in either order.

**IRIS:** only the live gate and the two existing live gates above touch IRIS (`localhost:52773`, `HSCUSTOM`; verify the target with `iris_server_info` first: IRIS 2026.2 Build 221U).
- They write only the disposable `ExecuteMCPv2.Temp.QaStory4211Load.cls`, `…QaStory4211Xml.cls` and `…QaStory4211Prom.cls` (and the existing gates' own `QaStory383*`/`QaStory387*`), and remove them. No data rows are inserted, so no data global is created.
- Run one test file per call and never re-submit one.
- The plan stage's probe (`ExecuteMCPv2.Temp.Probe4211Xml.cls`) was created, compiled, imported and deleted on 2026-10-21. Afterwards no document or global named `Probe4211` remained.

## Auto Run Result

Status: done
Blocking condition: none

**Plan stage (2026-10-21).** The plan halted after planning, as the invocation directed. The spec meets the READY FOR DEVELOPMENT standard.
- **Ledger inbox:** DW-652 is addressed by every task and every matrix row. DW-544, DW-545 and DW-546 are context: decision 4 recommends `resolved-by` this story.
- **Orchestrator decisions needed:** six, all in Design Notes.
  1. Replace the whole `properties` object; no loader `add` op.
  2. `iris_doc_load` reads each class with a GET on the default path.
  3. Append a description sentence to each tool and correct the `ignoreConflict` text.
  4. The DW-544/545/546 adjudication.
  5. The AD-24 and AD-15 spine amendments (drafted).
  6. A promote preflight read that fails is carried to its step.
- **Live probe:** run on `localhost:52773`/`HSCUSTOM` (IRIS 2026.2 Build 221U). An XML import without `<Storage>` drops the stored definition. The probe class was removed, and no leftovers remain.
- **Deferred:** none.

**Implement pass (2026-10-21).** The implementation, the tests, the rosters, the eight ledger entries, the regenerated snapshot, the docs, the changeset and the live gate; the mutation lines are under `## Verification`. Two points where the spec text and the live system differ (spec errors for the retro):
- Leg (7) cannot leave "no Storage on the target": `iris_env_promote` compiles each promoted class (`flags=cuk`), and the compile regenerates a `Storage Default` block. The live leg asserts what is true instead: the PUT body has no Storage, `storageDrops` names the drop, and the regenerated storage reads the properties in the new order. Legs (3) and (5) (no compile) do leave no Storage block.
- The snapshot holds the `full` preset (115 entries), so its diff shows three description sentences and three new properties, not four; the fourth is the `iris_doc_load` row of the dev `core-preset` session, which only the sanctioned wire golden (eight entries) holds.

**Review pass (2026-10-21).**
- **Summary of the change:** the one shared guard in `@iris-mcp/shared` now covers `iris_doc_load` (per file, after a GET of the class or the 409 read), the `iris_doc_xml_export` import (one GET per `<Class>`, the whole import refused before its one POST) and the `iris_env_promote` `execute` sync (a GET-only preflight before the dialog, refusal before any write, the source text checked is the text written). Each takes `allowStorageRegeneration` (default false; with it the result's `storageDrops` and a text line name what was dropped). Eight sanctioned ledger entries move the three `inputSchema`s and four descriptions; both frozen goldens are byte-unchanged and the snapshot is regenerated.
- **Files changed (33):** shared `storage-guard.ts` and `index.ts`; dev `doc.ts` (`currentClassLines`, `storageDropsNote`), `load.ts`, `format.ts`, `env-promote.ts`; three new dev unit suites and one live gate (`storage-guard-write-paths-live-gate.test.ts`, in `prepublish-gate.mjs`); updated dev tests; the `iris-mcp-all` roster, doc-claims, ledger, shape, oracle and parity tests, the 42.11 doc-claims test and its texts file; the sanctioned-change ledger and the regenerated snapshot; the dev and root READMEs, `tool_support.md`, `CHANGELOG.md`, the changeset; this spec.
- **Review findings:** 28 findings from four layers (high 0, medium 4, low 20, false 4). Patches applied, 3 medium and 5 low entries: the dialog scope keeps the drops visible within 600 characters; a mixed-Atelier-version promote test; the three-way duplicated override text line is one `storageDropsNote`; an unprobed claim removed from a comment; a stale comment replaced; three missing mutation lines written; the dev README says the read is once, sequential, and before the write. Deferred: 1 (prompts and skills text, excluded by the intent). Rejected with a recorded reason: 14 rows (spec-bound, theoretical or refuted; see the Review Triage Log; the patched rows are 13 and the deferred row is 1).
- **Follow-up review recommended:** true (three medium entries patched). The unverified risk: `promotionScope` repeats the dialog's 600-character cut as a local constant (`CONFIRMATION_SCOPE_LIMIT`), because the shared `confirmationMessage` does not export it; a change to the shared limit would not move it.
- **Verification performed:** every `(loop)` command after the last patch, and every `(once)` command after it, green: shared 2317, dev 1470 passed (314 skipped), admin 506, data 163, interop 751, ops 350, client-config 1015, all 3903 (2705 + 1198; 675 skipped), type-check and lint clean (the one `cli/governance.ts` warning pre-exists), governance baseline, skills, pack, provenance, prompts, snapshot checks and `lint_spine.py` (0 findings) clean, both frozen goldens `git diff` empty. Live on `localhost:52773`/`HSCUSTOM` (IRIS 2026.2 Build 221U) through the wrapper, one suite per call: the new gate 7 of 7, the 38.7 gate 8 of 8, the doc-put gate 114 of 114; no `QaStory` document or global remained (checked with the doc and global list tools after the runs).
- **Mutation evidence:** 28 mutation lines in `## Verification` (two blocks), each red on the path it guards and restored byte-identical.
- **Residual risks:** the guard is check-then-write (documented); the dev unit tests read `@iris-mcp/shared` through its dist, and a restored source is newer than an unchanged dist, so a package must be rebuilt from a deleted `dist/` and `tsconfig.tsbuildinfo` before the snapshot check; the matrix row "Each override leg leaves no Storage block" cannot hold for promote (spec error above); the live gate has no leg for a new class on the real Atelier.
- **Deferred:** 1 item in the frontmatter `deferred:` list.
