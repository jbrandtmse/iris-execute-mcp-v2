---
title: 'Story 38.2: Line-Range Document Read'
type: 'feature'
created: '2026-10-15'
status: 'done'
baseline_revision: '8fae074ba9870f32d1f0555e3b977138db4f80d8'
baseline_commit: '8fae074ba9870f32d1f0555e3b977138db4f80d8'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings:
  - oversized
deferred:
  - summary: "iris_doc_put without ignoreConflict gets HTTP 409 for every EXISTING document, so it can only create documents; its ignoreConflict description ('overwrite even when the server copy is newer') is wrong"
    evidence: "Live probe 2026-10-15 (IRIS 2026.2 build 221U, Atelier v8): a second iris_doc_put to ExecuteMCPv2.Temp.QaStory382Probe.cls returned 'IRIS returned HTTP 409'; %Api.Atelier.v2 PutDoc saves only when the doc is new or HTTP_IF_NONE_MATCH equals TS(), and the tool never sends that header (bootstrap.ts:233-241 documents the same 409)"
    location: 'packages/iris-dev-mcp/src/tools/doc.ts:193'
    severity: med
    source: plan
  - summary: "iris_doc_get metadataOnly reads a Last-Modified header that Atelier never sends, so `timestamp` is always absent; the unit test fakes the header (Rule #54)"
    evidence: "Atelier v1-v8 and %Atelier.REST set only ETag (= ts), never Last-Modified (plan-time source read 2026-10-15); live metadataOnly returns {exists,name,etag} only; doc.test.ts:103-127 fakes Last-Modified. This story corrects the description only; the dead read and its fake are unchanged"
    location: 'packages/iris-dev-mcp/src/tools/doc.ts:116'
    severity: low
    source: plan
---

<intent-contract>

## Intent

**Problem:** `iris_doc_get` returns only whole documents (G1). An agent working on a large class must pull the entire text to see a few lines. There is also no numbering that a later line edit (Story 38.4 `iris_doc_edit`) can address, and no version token for that edit to send.

**Approach:** Add optional `startLine` and `endLine` (1-based, inclusive) to `iris_doc_get`. A ranged read still fetches the whole document with the same Atelier `GET`, and then slices it in TypeScript. The numbering, the BOM handling for reads and the numbered-text format are defined once, by extending the `@iris-mcp/shared` line utility (`lines.ts`). The ranged response carries the numbered lines, `totalLines` and the document's `ts` version token. With neither parameter, the request and the response are byte-identical to today.

## Boundaries & Constraints

**Always:**
- Line N is element N-1 of the `content` array that Atelier's `GET /doc` returns, after one leading BOM is removed from element 0. The trailing empty element that Atelier adds to class UDL counts as a line. Nothing splits or joins elements. Ranges apply only to UDL text (`format` omitted or `"udl"`, and `enc: false`).
- All range-argument checks that do not need the document run before any HTTP request. A range error is `isError: true` with exactly the matrix text, and never an empty success. Error text follows `<what happened>. <what to do about it>.`.
- The new numeric parameters follow the `maxRows` convention (`sql.ts:44-49`): `z.coerce.number().int().min(1).optional()`. An invalid value is refused by the framework's own `Invalid arguments: ...` result.
- Source text is ASCII. Write non-ASCII characters in test fixtures as escapes (`\u00e9`, `\u2014`, `\uFEFF`). Comments state the contract, never the history.
- The live gate touches only the disposable fixtures named under Verification, removes them before and after, and names its target explicitly through the six `IRIS_*` variables.

**Never:**
- Never change the no-range code path: the GET path, the full-read text and `structuredContent`, the `metadataOnly` HEAD path and the 404 path stay as they are.
- No new tool, action or governance key, and no change to `mutates`, annotations, any `presets.ts`, `TOOL_PAIRS`, `governance-baseline.ts`, `bootstrap-classes.ts` or any `src/ExecuteMCPv2/**` class. The `iris_doc_get`/`iris_doc_edit` pair belongs to 38.4.
- No second line-utility module, and no splitting or joining helper for `expected`/`text` (38.4 owns that; see the seam in Design Notes). No refusal-code catalog (38.3 or 38.4 creates it).
- No `changeset version`, no publish, no CI wiring (AD-29).

## I/O & Edge-Case Matrix

Fixture: an 11-element class `C` (`content` ends with `"}", ""`), so `totalLines` is 11. The exact texts, where `<n>`, `<ns>`, `<s>`, `<e>`, `<t>` and `<ts>` are the requested name, namespace, effective start and end, totalLines and the result's `ts`:
- **H** (text header): `Document '<n>' in namespace '<ns>': lines <s>-<e> of <t> (ts <ts>)`
- **M1**: `startLine and endLine cannot be combined with metadataOnly. Omit metadataOnly to read lines, or omit startLine and endLine to read only the metadata.`
- **M2**: `Line ranges apply only to UDL text, not to format "xml". Omit format (or pass "udl") to read a line range.`
- **M3**: `startLine <s> is after endLine <e>. Pass a startLine that is less than or equal to endLine.`
- **M4**: `startLine <s> is past the end of document '<n>', which has <t> lines. Pass a startLine from 1 to <t>, or omit startLine and endLine to read the whole document.`
- **M5**: `Document '<n>' is a binary document, and line ranges apply only to text. Omit startLine and endLine to read it whole.`
- **M6**: `Document '<n>' could not be read in namespace '<ns>': <reason>. Check the document name and namespace, then retry.` Here `<reason>` is the `result.status` text, or `IRIS returned no line content` when `content` is not an array.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| No range | neither parameter (any `format`, `metadataOnly`) | exactly today's request and result | today's handling |
| Both bounds | `startLine:3, endLine:5` | one GET on today's path; text = H + `\n` + lines 3-5 numbered; `structuredContent` = `{name, ts, startLine:3, endLine:5, totalLines:11, lines:[...3 items]}` | No error expected |
| Start only | `startLine:10` | endLine 11 (the last line); lines 10-11 | No error expected |
| End only | `endLine:2` | startLine 1; lines 1-2 | No error expected |
| Clamped end | `startLine:9, endLine:9999` | endLine 11; lines 9-11 | No error expected |
| Single / first / last line | `1-1`; `11-11` | one line; line 11 of a class is `""` | No error expected |
| Explicit UDL | `format:"udl", startLine:1` | path carries `?format=udl` (as today); ranged result | No error expected |
| Start past end | `startLine:12` | M4 with `<t>` = 11, after the GET | `isError: true` |
| Start after end | `startLine:5, endLine:3` | M3; no HTTP request | `isError: true` |
| Range + metadataOnly | `metadataOnly:true, endLine:5` | M1; no HEAD and no GET | `isError: true` |
| Range + XML | `format:"xml", startLine:1` | M2; no request | `isError: true` |
| Bad number | `startLine` `0`, `-1`, `1.5` or `"abc"`; `"12"` | the framework's `Invalid arguments: startLine: ...` and no handler call; `"12"` is coerced to 12 | `isError: true` |
| Binary | result `enc: true` | M5 | `isError: true` |
| Unreadable | result `status` non-empty (Atelier soft-error shape: `content: ""`) | M6 with the status text | `isError: true` |
| Missing | 404 with a range | today's `Document '<n>' not found in namespace '<ns>'` | `isError: true` |
| Server error | non-404 with a range | rethrown (as today) | propagated |

</intent-contract>

## Code Map

- `packages/shared/src/lines.ts:1-44` -- the AD-24 line utility, seeded by 38.0. It holds `stripLeadingBom` and `stripLeadingBomFromLines`, and is extended in place (its header already says later stories extend it). Barrel export at `packages/shared/src/index.ts:32`. Tests are in `packages/shared/src/__tests__/lines.test.ts`, which includes a barrel-export case.
- `packages/shared/src/atelier.ts:173-191` -- `atelierDocStatusError(result)` returns a non-empty string `result.status`, else `undefined`. Its JSDoc covers `PUT /doc` only; the GET soft-error shape (`content: ""`, `status: <text>`) has the same field. Tests are in `__tests__/atelier-doc-status.test.ts`.
- `packages/iris-dev-mcp/src/tools/doc.ts:57-169` -- `docGetTool`.
  - Description :60-64. Schema :65-82; `booleanParam` comes from `./zod-helpers.js`.
  - `metadataOnly` HEAD branch :112-138: it reads `Last-Modified`, which IRIS never sends, and `ETag`.
  - GET :140-153 returns `JSON.stringify(response.result, null, 2)` and `structuredContent: response.result`. The 404 branch is at :154-167.
  - Imports :13-20.
- `packages/iris-dev-mcp/src/tools/sql.ts:44-49` -- the integer-parameter convention (`z.coerce.number().int().min(1).optional()`).
- `packages/shared/src/server-base.ts:1303-1326` -- a zod failure returns `isError` `Invalid arguments: <path>: <message>` without calling the handler.
- `packages/shared/src/http-client.ts:19-24,75-96` -- `get()` returns the envelope without headers. `put(path, body, {headers})` can send `If-None-Match`, and a 409 throws `IrisApiError` with `statusCode` 409.
- `packages/iris-dev-mcp/src/__tests__/doc.test.ts:20-181` -- the existing `iris_doc_get` unit tests use `createMockHttp`, `createMockCtx` (Atelier v7, namespace `USER`) and `envelope` from `./test-helpers.js`. They stay unmodified.
- `packages/iris-dev-mcp/src/__tests__/doc-put-bom-live-gate.test.ts` -- the sibling live gate.
  - Its setup is at :40-106: an explicit target with sibling defaults (localhost:52773, `_SYSTEM`, HSCUSTOM), plus `ping`, `negotiateVersion`, `buildToolContext` and skip-unless-armed.
  - Its doc helpers `docPath`, `readStoredLines` and `removeStored` are at :58-81.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs:73-82` -- `gateTestFiles`. `packages/iris-mcp-all/src/__tests__/live-gate-roster.test.ts` treats a `*.test.ts` as armed only when the file itself matches `process\.env\.IRIS_REQUIRE_LIVE\s*===`, and requires it to be listed.
- The dev package imports `@iris-mcp/shared` through its `dist` (`packages/shared/package.json` exports). Rebuild shared after editing `lines.ts` or `atelier.ts`, before any dev test.
- `packages/iris-dev-mcp/src/tools/loc.ts:33-42` -- `iris_loc_count`'s per-document `totalLines`. On the IRIS side it is `pLines(0)` of `%Atelier.v1.Utils.TextServices:GetTextAsArray(doc, 0)` (`src/ExecuteMCPv2/Loc/Scanner.cls:109`, `Classifier.cls:55-57`), the same line array that Atelier GET serves.
- Docs:
  - `packages/iris-dev-mcp/README.md:145` is the tool-table row, and `:262-282` is the `iris_doc_get` example (its `ts` at :279 is shown in ISO form, but the real format is `2026-09-01 04:29:37.877`).
  - In `CHANGELOG.md`, the newest section is at :5, in the form `## [Pre-release — <date>] — Story X.Y: ...`.
  - For the changeset format, see `.changeset/story-38-1-reject-http-transport.md`.
- Read-only: `packages/*/src/tools/presets.ts`, `packages/shared/src/governance-baseline.ts`, `packages/shared/src/bootstrap-classes.ts` (`BOOTSTRAP_VERSION` unchanged), `src/ExecuteMCPv2/**`, `packages/iris-dev-mcp/src/__tests__/doc.test.ts`.

## Tasks & Acceptance

**Execution:**
- `packages/iris-dev-mcp/src/__tests__/doc-get-range.test.ts` (new) -- FIRST, before any source edit, add the back-compat describe and run it on the unmodified tree. Its fakes are real Atelier shapes:
  - the 9-key GET result `{name, db, ts, upd, cat, status:"", enc:false, flags:0, content}`, with a class `content` ending in `"}", ""`;
  - an XML result;
  - a HEAD carrying only `ETag`;
  - a 404.

  For each no-range input (default, `format:"udl"`, `format:"xml"`, `metadataOnly` present, `metadataOnly` 404, GET 404), it pins with `toEqual` the whole returned ToolResult and the `get`/`head` call arguments. Paste the captured values as literals and cite the capture command in the file header (Rule #36). -- AC-4.
- `packages/shared/src/lines.ts` -- add three functions, with JSDoc stating each contract, and export them from `index.ts`. -- AC-2, AC-3.
  - `documentLines(content: readonly string[]): string[]`: a fresh copy, with one leading BOM removed from element 0 via `stripLeadingBomFromLines`. The input is never mutated.
  - `linesInRange(lines: readonly string[], startLine: number, endLine: number): string[]`: lines startLine..endLine, 1-based and inclusive. The caller passes a valid range.
  - `formatNumberedLines(lines: readonly string[], firstLineNumber: number): string`: each line is `String(n).padStart(6) + "\t" + text` (the `cat -n` layout), joined with `"\n"`, with no trailing newline. Also export `NUMBERED_LINE_WIDTH = 6`.
- `packages/shared/src/__tests__/lines.test.ts` -- cover the three functions:
  - BOM only on element 0; a fresh copy; no mutation; an empty array;
  - 1-based slices (first, last, single, full);
  - the exact numbered text, including an empty line (`"     5\t"`), a tab-led line, a 7-digit number, and a start offset;
  - the barrel exports.
- `packages/shared/src/atelier.ts:173-186` -- widen the `atelierDocStatusError` JSDoc to any Atelier `/doc` result (a PUT refusal, or a GET soft error). The code is unchanged. -- Rule 2.
- `packages/iris-dev-mcp/src/tools/doc.ts` -- implement the matrix in `docGetTool`. -- AC-2, AC-3, AC-6.
  - **Pre-request checks.** The range checks M1, M2 and M3 run before any request.
  - **After the GET, when a range is given.** Run M6 (`atelierDocStatusError`, or non-array `content`), then M5 (`enc === true`), then M4. Clamp `endLine` to `totalLines`. Build H, a newline, and `formatNumberedLines(linesInRange(documentLines(content), s, e), s)`, plus the `structuredContent` `{name, ts, startLine, endLine, totalLines, lines}` (`name` is the requested name; `ts` is `result.ts`).
  - **No range.** The path reaches today's code unchanged.
  - **Schema.** Add these parameters:
    - `startLine`: "First line to return, 1-based and inclusive (default: 1 when only endLine is given). Line 1 is the first element of the document's line array; a class's last line is often empty. Not allowed with metadataOnly or format xml."
    - `endLine`: "Last line to return, 1-based and inclusive (default: the last line when only startLine is given). A value past the end is clamped to the last line."
  - **Description.** It becomes: "Retrieve an ObjectScript class, routine, CSP page, or include file by name. Pass startLine and/or endLine (1-based, inclusive) to read part of a UDL text document: use a range for large classes, and to read the exact lines before changing them with `iris_doc_edit`, which uses the same line numbers. A ranged read returns the lines numbered (`cat -n` layout: the number right-aligned in 6 columns, a tab, then the line exactly), plus totalLines and the document's version timestamp `ts`; an endLine past the end is clamped to the last line. Use metadataOnly to check existence and get the version timestamp (`etag`) without downloading content. To pull many documents at once, see `iris_doc_export`. To fetch the macro-expanded compiled intermediate of a class by its bare name, see `iris_routine_intermediate`."
- `packages/iris-dev-mcp/src/__tests__/doc-get-range.test.ts` -- add the range describe. -- AC-2, AC-3, AC-6.
  - Cover every remaining matrix row, with exact texts and `toEqual` on `structuredContent`, and `get`/`head` not called for M1, M2 and M3.
  - Schema cases through `docGetTool.inputSchema.safeParse`.
  - A case asserting that the description names `startLine`, `endLine`, `totalLines`, `ts` and `iris_doc_edit`.
- `packages/iris-dev-mcp/src/__tests__/live-doc-helpers.ts` (new, not a test file) -- move `docPath`, `readStoredLines` and `removeStored` out of `doc-put-bom-live-gate.test.ts`, parameterised by `(client, version, namespace, docName)`. Point that file at them, keeping its arming comparison and its behavior. -- Rule 2.
- `packages/iris-dev-mcp/src/__tests__/doc-get-range-live-gate.test.ts` (new) -- the live oracle. It uses the sibling's per-file setup, with its own `process.env.IRIS_REQUIRE_LIVE ===` comparison: it skips when IRIS is unreachable, and fails when armed. -- AC-1, AC-5.
  - **Fixtures (`beforeAll`, raw `client.put`, leftovers removed first; `afterAll` removes them).**
    - `ExecuteMCPv2.Temp.QaStory382Range.cls`, generated deterministically:
      - a `///` line, the `Class ... Extends %RegisteredObject` header and `{`;
      - 80 `ClassMethod Mnnn() As %String` blocks, each with a doc line holding `\u00e9` and `\u2014`, a tab-led `Set` with trailing spaces, a 4-space-led `Quit`, `}` and a blank line;
      - the closing `}`.
    - `ExecuteMCPv2.Temp.QaStory382Range.mac`: the header `ROUTINE ExecuteMCPv2.Temp.QaStory382Range [Type=MAC]` and about 30 lines.
  - **Oracle.** One no-range `docGetTool` read gives the reference `content`. Assert `totalLines > 500`. Then, for these ranged reads, the returned `lines` equal `content.slice(s-1, e)`, and every numbered text line splits at its first TAB into the number and that exact line:
    - line 1, the last line, line 250;
    - 1-50, a middle window and the end window;
    - `startLine` only and `endLine` only;
    - the clamped `endLine: 100000`;
    - 100-line windows stepping over the whole document.
  - **Pins (captured from the live run and pasted).** For the class: `totalLines`, line 1, the last line (`""`) and line 250. For the routine: `totalLines`, line 1 (`ROUTINE ExecuteMCPv2.Temp.QaStory382Range`, with the type dropped) and the last line.
  - **AD-24 version-token record**, on its own `ExecuteMCPv2.Temp.QaStory382Token.cls`, created and removed per test:
    - the ranged `ts` equals the full read's `ts` and the `metadataOnly` `etag`;
    - a PUT with no `If-None-Match` and no `ignoreConflict` throws 409, and the full read afterwards is unchanged;
    - a PUT with `If-None-Match: <ts>` and changed content (one added comment line) is accepted (`result.status` `""`), and a re-read shows the new content and a different `ts` (the control);
    - a PUT with the old `ts` throws 409.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` -- add `"src/__tests__/doc-get-range-live-gate.test.ts"` to `gateTestFiles`, with a one-line comment naming its fixtures. -- Live gates convention.
- `packages/iris-dev-mcp/README.md` -- update the docs. -- AC-6 (Rule #43).
  - Add `startLine?` and `endLine?` to the :145 row.
  - Add a `<details>` example, "iris_doc_get with a line range", after :282. It shows the input, the text form (H plus numbered lines), the `structuredContent`, when to use it, and the errors.
  - Correct the :279 `ts` value to the real `YYYY-MM-DD HH:MM:SS.fff` form.
- `CHANGELOG.md`, `.changeset/story-38-2-line-range-document-read.md` (new) -- AC-6, AD-29.
  - The CHANGELOG gets a new top section, `## [Pre-release — 2026-10-15] — Story 38.2: Line-range document read`, with `### Added — iris_doc_get reads a line range (@iris-mcp/dev, @iris-mcp/shared; G1)`. It states:
    - the parameters, the numbering and the clamp;
    - the numbered format, the response fields and the `ts` token;
    - the errors;
    - that the request and the result are unchanged without the parameters;
    - the new `lines.ts` exports.
  - The changeset is `"@iris-mcp/shared": minor` and `"@iris-mcp/dev": minor`.

**Acceptance Criteria:**
- AC-1 (38.2.1): Given the plan-time probe record under Design Notes, when the live gate runs against the default instance, then its pins hold:
  - the class trailing `""`;
  - the routine header line with no trailing `""`;
  - `ts` equal to the ETag;
  - a 409 on a PUT with no header.

  The implement stage records the run, with the IRIS version, under Auto Run Result.
- AC-2 (38.2.2): Given any range input in the matrix, when `iris_doc_get` runs, then it returns the matrix outcome. Every error row is `isError: true` with the exact text, and the pre-request rows make no HTTP call.
- AC-3 (38.2.3): Given a valid range, when it is read, then the text is H, a newline and the `formatNumberedLines` output, and `structuredContent` equals `{name, ts, startLine, endLine, totalLines, lines}` with the effective bounds.
- AC-4 (38.2.4): Given no range parameter, when `iris_doc_get` runs in any mode, then the ToolResult and the HTTP calls equal the literals captured from the baseline tree (`toEqual`).
- AC-5 (38.2.5): Given the disposable fixtures over 500 lines (class) and routine, when the live gate runs armed, then every ranged read equals the matching slice of the live full read, and the boundary pins captured live hold.
- AC-6 (38.2.6): Given the finished tree, when the description, the README, the CHANGELOG and the changeset are read, then they explain when to use a range (large classes, and a read before `iris_doc_edit`), the format, the clamp and the errors. The description test passes.
- AC-7: Given the finished tree, when the gates run, then:
  - every per-package build, test, lint and type-check passes;
  - governance `:check` exits 0 at `1e62c5ad5bf7`/141;
  - the tool, action and key counts are unchanged (dev 29);
  - `bootstrap-classes.ts`, `src/`, every `presets.ts` and the baseline file have no diff;
  - no `ExecuteMCPv2.Temp.QaStory382*` document remains.

## Spec Change Log

## Review Triage Log

### 2026-10-15 — Review pass
- verdicts: 25 findings — high 0, medium 0, low 20, false 5, maybe-false 0
- findings:
  - `[low]` `[reject]` (blind) Empty `content` array (`totalLines` 0) yields the M4 text "from 1 to 0", unpinned — a real but unobserved state (a probe of 669 live documents found no empty array); the fix adds a branch and a message outside the matrix text, so it is not worth it. reopen_if: a live document is observed returning `content: []`.
  - `[low]` `[patch]` (blind) The M6 unit fakes spread the class result (populated `ts`, `upd`, `flags`, invented status text) and the live gate has no soft-error read — verified live with `iris_doc_get` on an invalid name (`ts:""`, `cat:"OTH"`, no `upd`/`flags`, `ERROR #16006`). Patched: the unit fake is now that captured shape, and a read-only live-gate case pins M6 against real IRIS. The M5 `enc:true` shape stays source-derived (spec Design Notes) because no binary document is available to read read-only.
  - `[low]` `[patch]` (blind) CHANGELOG "every ranged read" overstated the fixed sample the gate performs, and the `iris_loc_count` parity was stated for any document though verified once, for a class. Patched: the CHANGELOG states the sample, and both documents say "class".
  - `[low]` `[patch]` (blind) The README full-read example for `MyApp.Service.cls` had no trailing empty element while the ranged example counted one. Patched: the full-read example ends with `""`, and the note points at it.
  - `[low]` `[reject]` (blind) The description, README, CHANGELOG and changeset name `iris_doc_edit`, which is not in the tree — AC 38.2.6 and Design Notes interpretation 5 require the reference (the epic ships as one branch with Story 38.4). reopen_if: 38.4 registers the tool under a different name.
  - `[low]` `[reject]` (blind) The tool description does not say a range still fetches the whole document, and `endLine` omits the metadataOnly/xml restriction — the spec fixes the exact description and parameter text; the README states the cost, and M1/M2 carry the restriction. Spec-bound.
  - `[low]` `[reject]` (blind) The `metadataOnly` parameter description fix is untested and the code still returns `timestamp` — documentation text only, and the dead read is already the second `deferred:` item.
  - `[low]` `[patch]` (blind) The `lines.ts` header said nothing splits or joins elements, while `formatNumberedLines` joins its output. Patched: the header says "the elements of that array".
  - `[low]` `[patch]` (edge) The framework's `Invalid arguments: startLine: ...` text is not what a client sees over the SDK transport (the SDK validates first: `Invalid arguments for tool iris_doc_get: ...`), so the README/CHANGELOG quote was inaccurate. Patched: both say "an `Invalid arguments` error that names the parameter".
  - `[low]` `[reject]` (edge) Same empty-array root cause as the first blind finding — rejected with it.
  - `[low]` `[patch]` (verification-gap) `metadataOnly: false` with a range was never tested (the M1 check is `if (metadataOnly)`). Patched: unit case added; mutation `!== undefined` turns it red.
  - `[low]` `[patch]` (verification-gap) The M5-before-M4 order was not pinned. Patched: unit case added with `enc:true` and a `startLine` past the chunk count; mutation (M5 only when `startLine` is within range) turns it red.
  - `[low]` `[reject]` (verification-gap) No check that the `iris_doc_edit` reference resolves — spec-bound (AC 38.2.6, interpretation 5); the registration is Story 38.4's own scope. reopen_if: as for the blind finding on the same reference.
  - `[low]` `[patch]` (verification-gap) The `iris_loc_count` equality is documented but was observed once. Grouped with the CHANGELOG finding above: the documents now claim it for a class only, which is what the spec's one-time live confirmation covered.
  - `[low]` `[patch]` (verification-gap) Several AC-1/AC-2/AC-4 pinning tests had no recorded mutation (live routine pins, `ts` equality, If-None-Match accepted and old-ts 409, M5, M6, schema, HEAD and 404 pins). Rule 19 is per AC and each AC already had a line; the additional mutations were run anyway and recorded under Verification.
  - `[low]` `[reject]` (verification-gap) Rule #54 fakes: BOM elements on reads and the M6 non-array shape have no live producer — AD-24 and the matrix require both branches; the M6 soft-error fake is now the live-captured shape.
  - `[low]` `[reject]` (verification-gap) Empty `content` array gives the M4 text and is unpinned — same root cause as the first blind finding.
  - `[false]` `[reject]` (verification-gap) `live-doc-helpers.ts` has no test host of its own — both live gates execute every helper, and both ran armed and passed (23 tests); the reviewer filed no defect.
  - `[low]` `[reject]` (verification-gap) Fixed fixture names would collide under two concurrent runs on one instance — the sibling gate has the same property and the live gates run with `--no-file-parallelism` on a shared instance.
  - `[low]` `[patch]` (intent-alignment, D1) The "Bad number" row's framework text and "no handler call" were tested only through the raw `inputSchema`. Patched with `doc-get-range-framework.test.ts`, which drives the registered callback through the real `McpServerBase` (a per-file harness copy, as `loc-e2e.test.ts` and its siblings do); mutation `startLine` `.min(0)` turns it red.
  - `[false]` `[reject]` (intent-alignment, D2) "Byte-identical" is pinned at the handler, not the advertised schema — the contract's no-range path is the handler path, and the description and parameter additions are mandated by the spec's Tasks.
  - `[low]` `[reject]` (intent-alignment, D3) The live gate defaults its target to localhost:52773 / HSCUSTOM when the `IRIS_*` variables are unset — the Code Map prescribes the sibling's explicit target with sibling defaults; writes stay on the three named disposable documents.
  - `[false]` `[reject]` (intent-alignment, D4) The slice oracle compares two reads of one endpoint — the pinned literals (566 and 30 lines, line 1, line 250, last lines) are the independent numbering anchor, and the `iris_loc_count` parity point is handled above.
  - `[false]` `[reject]` (intent-alignment, D5) The version-token record uses raw `client.put` — the spec's Tasks say raw `client.put` because `iris_doc_put` cannot send `If-None-Match` (first `deferred:` item).
  - `[false]` `[reject]` (intent-alignment, D6) `doc-put-bom-live-gate.test.ts` was refactored onto the shared helpers — the spec mandates the extraction, its 6 tests pass armed, and the CHANGELOG's "existing tests are unmodified" is about the `iris_doc_get` tests (`doc.test.ts` has no diff).

## Design Notes

**Governing architecture decisions:**
- AD-24: one shared line utility (numbering into the `GET /doc` `content` array, BOM handling, one numbered-text format); a ranged read returns the version token; ranges only on UDL text; this story records the no-header PUT behavior.
- AD-15: the no-range path is pinned mechanically. The change is additive (optional inputs and new output fields only when used), so no sanctioned change is needed.
- AD-4, AD-5 and AD-10: the read key `iris_doc_get` is unchanged, no key is added, and the baseline stays frozen.
- AD-7: visibility is unchanged. The `TOOL_PAIRS` pair lands in 38.4.
- AD-2: the utility lives in `@iris-mcp/shared`, which dev depends on.
- AD-14: no bootstrap change. AD-29: minor changesets only.
- Conventions:
  - Tool descriptions;
  - Tool results: `structuredContent`; a field keeps its meaning;
  - Refusals; Error text;
  - Live gates; Live testing on a shared instance;
  - Probes and references (verified on IRIS 2026.2 build 221U, Atelier v8);
  - Performance budgets: a ranged read is the same single GET as a full read.

**Probe record (AC-1).** These were read-only GETs, plus disposable PUTs and one DELETE on `ExecuteMCPv2.Temp.QaStory382Probe.{cls,mac}`, all on `default`/HSCUSTOM, 2026-10-15. The fixtures were removed, and `iris_doc_list` for `ExecuteMCPv2.Temp` returned `[]`.
- **The result shape.** A successful GET result has 9 keys: `name`, `db`, `ts`, `upd`, `cat`, `status:""`, `enc`, `flags` and `content`. `content` is an array of line strings. No element held `\r`, `\n` or a U+FEFF. Atelier offers no range parameter; the GET query parameters are only `binary`, `format` and `storageOnly`.
- **Classes.** UDL ends with a trailing `""`, so `Diagram.Event.cls` has 54 elements for 53 newline-terminated lines. Atelier regenerates class UDL on write: a 9-line PUT came back as 11 lines, with a blank line inserted before the closing `}` and a trailing `""`. Method bodies are verbatim, including tabs, trailing spaces and 4-space indentation.
- **Routines.** Element 0 is a header with no trailing `""`:
  - `.mac` has `ROUTINE <name>` (the PUT's `[Type=MAC]` is dropped);
  - `.inc` has `ROUTINE %occStatus [Type=INC]`;
  - a generated `.int` has `ROUTINE <name> [Type=INT,Generated]`.
- **XML.** `format:"xml"` returns a line array of XML that starts `<?xml ...` and has no trailing `""`.
- **Binary and soft errors.** Per the `%Api.Atelier.v4` `GetDoc` source, `enc: true` means base64 chunks (a binary type, or `?binary=1`). A soft error has `content: ""` (a string) and a non-empty `status`.
- **Versions.**
  - HEAD returns only `ETag`, the raw `ts` string, with no `Last-Modified` and no body.
  - GET sets the same `ETag`.
  - `%Api.Atelier.v2` `PutDoc` saves only when the document is new or `HTTP_IF_NONE_MATCH` equals `TS()`; `ignoreConflict=1` skips the check.
  - **Missing header:** a second PUT to an existing document with no `If-None-Match` returned **HTTP 409** live and wrote nothing (`etag` unchanged). So 38.4 must send `If-None-Match: <ts>` exactly as the ranged read returns it.
- **`metadataOnly` with a range.** HEAD has no body, so the combination cannot produce lines and is refused before any request (M1).

**Plan-time interpretations (apply-and-report, Rule 5).**
1. **"Every ranged read equals the slice" (38.2.5)** means every read the gate performs. That is a fixed set: the boundaries, the windows, the one-sided reads, the clamped read, and 100-line windows covering every line. All n² ranges are not read.
2. **"A live class over 500 lines"** is a disposable synthetic class that the gate creates, per the shared-instance fixture convention. So the live-captured pins stay stable, where they would drift against project classes that later stories edit. A disposable routine adds the second document type, because the trailing-`""` rule differs (Rule #34's second environment here is the document type; the output does not depend on namespace).
3. **Range errors carry no `structuredContent.code`.** They are argument errors, like the framework's `Invalid arguments`, and not refusals of a guarded write. M4 states `totalLines`, which is the value a caller needs. The code catalog is born with the first refusal (38.3/38.4).
4. **The version token is `ts`.** It is Atelier's own field, with the same meaning in the full read and in `iris_doc_list` items. **`totalLines` keeps `iris_loc_count`'s meaning**: both count the `GetTextAsArray` line array, so the trailing `""` is counted. The implement stage confirms that live once. While the fixture exists, `iris_loc_count` scoped to `ExecuteMCPv2.Temp.QaStory382Range.cls` gives `totalLines` equal to the ranged read's; record it under Auto Run Result. `startLine`, `endLine` and `lines` appear in no tool output today (only inside client-config's internal `diff.ts`).
5. **The description names `iris_doc_edit` before 38.4 lands**, as AC 38.2.6 requires. The epic ships as one branch, with no publish in between, and 38.4 makes the reference resolve.
6. **The `metadataOnly` description now names `etag`**, because IRIS never sends `Last-Modified`. The code is unchanged and its dead read is recorded as deferred.

**Seam (Rule #52).** 38.2 owns:
- the numbering (`documentLines`, `linesInRange`);
- read-side BOM handling;
- the numbered format (`formatNumberedLines`, `NUMBERED_LINE_WIDTH`);
- the `ts` token.

38.4 extends the same `lines.ts` with splitting on `\r?\n` and joining with `\n` for `expected` and `text`. When it does, the two existing `split(/\r?\n/)` sites (`doc.ts:226`, `load.ts:418`) move to that helper. It reuses the numbering and the token unchanged.

**Integration ACs and linkage (Rules 1/2).** Consumer `iris_doc_get` reads `documentLines`, `linesInRange` and `formatNumberedLines`, and produces the numbered text and `structuredContent` that the live gate observes against real IRIS (AC-3, AC-5).
- Consumed-by:
  - `iris_doc_get` (this story);
  - Story 38.4 `iris_doc_edit` (its `expected` checks use `linesInRange` over `documentLines`, its excerpts use `formatNumberedLines`, and its PUT sends `ts` as `If-None-Match`);
  - Story 38.6's prompt (ranged read → edit).
- Consumes: `stripLeadingBomFromLines` and `atelierDocStatusError` (38.0).

**Extend, don't copy (Rule 2).**
- `lines.ts` is extended in place; there is no second module.
- `atelierDocStatusError` is reused for the GET soft error.
- The integer parameters copy the `maxRows` schema convention.
- The live gate's doc helpers are extracted to `live-doc-helpers.ts`, which both gates use. The setup block stays per file because `live-gate-roster.test.ts` detects arming by the comparison inside each `*.test.ts` (moving it would hide the gate from the roster, Rule #59).

**Ledger inbox:** none was routed to this story (`ledger.sh slice 38-2-line-range-document-read` is empty). Two plan findings are recorded under `deferred:` for the lead's harvest:
- The `iris_doc_put` 409 finding is in-epic: 38.3 rewrites the put path, and 38.4 adds `If-None-Match`.
- The `metadataOnly` dead read is in-story and low.

No orchestrator decision is needed.

## Verification

Every command runs in the foreground with `timeout: 600000` from `/Users/jbrandt/git/iris-execute-mcp-v2`. IRIS is reached only through `default` (localhost:52773, HSCUSTOM, IRIS 2026.2 build 221U). The only writes are the disposable `ExecuteMCPv2.Temp.QaStory382Range.cls`, `ExecuteMCPv2.Temp.QaStory382Range.mac` and `ExecuteMCPv2.Temp.QaStory382Token.cls`. They are never compiled, and are removed before and after use. No ObjectScript changes, so no OS %UnitTest class runs.

**Shared surfaces:**
- the `iris_doc_get` advertised schema and description (no test asserts its property list; `index.test.ts` checks the name only);
- the `@iris-mcp/shared` barrel (`lines.test.ts`);
- the dev `gateTestFiles` list (`live-gate-roster.test.ts`, `prepublish-gate-sequential.test.ts`; neither counts entries);
- `doc-put-bom-live-gate.test.ts`, whose helpers move;
- the `CHANGELOG.md` top section (`story-38-0/38-1-qa-doc-claims` locate their sections by regex).

Tool counts do not move. Standing criterion: every test added or changed passes on a fresh environment, in either order.

**Commands:**
- `(loop)` `pnpm --filter @iris-mcp/shared build && pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/lines.test.ts src/__tests__/atelier-doc-status.test.ts` -- expected: all pass.
- `(loop)` `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/doc-get-range.test.ts src/__tests__/doc.test.ts` -- expected: all pass; `doc.test.ts` unmodified.
- `(loop)` `IRIS_HOST=localhost IRIS_PORT=52773 IRIS_NAMESPACE=HSCUSTOM IRIS_USERNAME=_SYSTEM IRIS_PASSWORD=SYS IRIS_HTTPS=false IRIS_REQUIRE_LIVE=1 pnpm --filter @iris-mcp/dev exec vitest run --no-file-parallelism src/__tests__/doc-get-range-live-gate.test.ts src/__tests__/doc-put-bom-live-gate.test.ts` -- expected: all pass, none skipped.
- `(loop)` `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/live-gate-roster.test.ts` -- expected: pass.
- `(once)` For each package, one command per package: `pnpm --filter @iris-mcp/<pkg> build`, then `test`, `lint` and `type-check` where defined. The packages are shared, dev, admin, interop, ops, data and client-config, followed by `pnpm --filter @iris-mcp/all test` -- expected: green. This is the per-package substitute for the flaky parallel turbo run (35-1-DEV-1).
- `(once)` `pnpm gen:governance-baseline:check` -- expected: exit 0 at `1e62c5ad5bf7`/141.
- `(once)` `git diff --stat 7d685770ddd6590a48e671dbc3bb417bfdf0c054 -- packages/shared/src/bootstrap-classes.ts packages/shared/src/governance-baseline.ts src/ packages/iris-dev-mcp/src/__tests__/doc.test.ts $(git ls-files 'packages/*/src/tools/presets.ts')` -- expected: empty.
- `(once)` `iris_doc_list` (`server:"default"`, `namespace:"HSCUSTOM"`, `filter:"ExecuteMCPv2.Temp.QaStory382"`, `generated:true`) -- expected: `{"items":[]}`.

**Planned mutations (Rule 19; record each as `mutation: ... -> ...` when it is run).** Revert each one, rebuild any dist it touched, and confirm that `git status --short` and `git diff --stat` are unchanged.

| AC | Mutation | Expected red |
|---|---|---|
| AC-2 | `linesInRange` slices `(startLine, endLine)` (off by one) | `lines.test` slices, the range unit rows, and the live oracle |
| AC-2 | the clamp removed (`endLine` used as given) | the clamped-end unit row and the live clamped read |
| AC-2 | the M1 check moved after the `metadataOnly` branch | the range + `metadataOnly` row (a HEAD is called) |
| AC-2 | M4 returns `lines: []` without `isError` | the start-past-end row |
| AC-3 | `NUMBERED_LINE_WIDTH` set to 5 | `lines.test` exact text and the handler text `toEqual` |
| AC-4 | the no-range path adds `totalLines` to `structuredContent` | the back-compat pins |
| AC-5 | `documentLines` drops a trailing `""` | the live class `totalLines` and last-line pins (the routine pins stay green) |
| AC-1 | the gate's no-header PUT sends `If-None-Match: <ts>` | the 409 record case |
| AC-6 | `iris_doc_edit` removed from the description | the description case |

AC-7 is a roll-up of gate commands and has no mutation of its own.

**Mutation results (Rule 19, run 2026-10-15 on the final tests).** Each mutation was applied, run, reverted, and the reverted files were checked byte-identical (`shasum -c`); `@iris-mcp/shared` was rebuilt after every shared-side mutation and revert.
- mutation: `linesInRange` sliced `(startLine, endLine)` (off by one) -> `lines.test` `linesInRange` slices (5 red); `doc-get-range.test` valid-range rows (10 red); live gate pins and every class and routine oracle read (red)
- mutation: the clamp removed (`lastLine = endLine ?? totalLines`) -> `doc-get-range.test` "an endLine past the end is clamped" (1 red); live gate class one-sided/clamped read, class 100-line windows, routine clamped read (3 red)
- mutation: the M1 check moved after the `metadataOnly` HEAD branch -> `doc-get-range.test` "M1: a range with metadataOnly is refused before any request" and "M1 comes before M2" (2 red; the HEAD is called)
- mutation: M4 returns `lines: []` as a success -> `doc-get-range.test` "M4: a startLine past the end ... is an error, not an empty success" (1 red); live gate "a startLine past the last line is refused with the live totalLines" (1 red)
- mutation: `NUMBERED_LINE_WIDTH` set to 5 -> `lines.test` `formatNumberedLines` (5 red, the width pin included); `doc-get-range.test` valid-range text rows (8 red)
- mutation: the no-range path adds `totalLines: 0` to `structuredContent` -> `doc-get-range.test` back-compat pins "default read", "format udl", "format xml", "metadataOnly false" (4 red) and the unmodified `doc.test` "should retrieve document content as text" (1 red)
- mutation: `documentLines` drops a trailing `""` -> `lines.test` `documentLines` (2 red); live gate class pins, class oracle reads and the past-end read (6 red) while the routine pins and routine oracle reads stay green (10 passed)
- mutation: the gate's no-header PUT sends `If-None-Match: <ts>` -> live gate "a PUT with no If-None-Match and no ignoreConflict is refused with HTTP 409" (1 red: "the PUT ... was accepted; a refusal was expected")
- mutation: `iris_doc_edit` removed from the description -> `doc-get-range.test` description case (1 red)
- mutation (extra): the M2 and M3 pre-request checks removed -> `doc-get-range.test` "M2: a range with format xml is refused before any request" and "M3: startLine after endLine is refused before any request" (2 red)
- mutation (extra): `documentLines` no longer strips the BOM -> `lines.test` "removes one BOM from element 0 only ..." (1 red) and `doc-get-range.test` "removes one leading BOM from line 1" (1 red)

**Review-pass mutations (Rule 19, run 2026-10-15 after the review patches).** Each applied, run, reverted and checked byte-identical (`shasum -c` of `doc.ts` and the live gate; `git status --short` unchanged).
- mutation: the M1 check keyed on `metadataOnly !== undefined` -> `doc-get-range.test` "an explicit metadataOnly false with a range is an ordinary ranged read" (1 red)
- mutation: M5 applied only when `startLine` is within the chunk count (M4 before M5) -> `doc-get-range.test` "M5 comes before M4" (1 red)
- mutation: the M6 check disabled -> `doc-get-range.test` the two M6 cases and "M6 comes before M5" (3 red); live gate "a document IRIS cannot read comes back as the live soft-error shape" (1 red)
- mutation: `structuredContent.ts` set to `""` -> `doc-get-range.test` (7 red); live gate class and routine oracle reads and "the ranged ts equals the full read's ts and the metadataOnly etag" (7 red)
- mutation: the HEAD result gains a `totalLines` field (200 and 404) -> `doc-get-range.test` back-compat "metadataOnly true: one HEAD ..." and "the HEAD is a 404" (2 red)
- mutation: the not-found text changed to "was not found in namespace" -> `doc-get-range.test` "the GET is a 404" and "a 404 with a range is today's not-found text" (2 red)
- mutation: `startLine` schema `.min(0)` -> `doc-get-range-framework.test` "startLine = 0 is refused with the framework's Invalid arguments result" (1 red) and `doc-get-range.test` "rejects startLine = 0" (1 red)
- mutation: the live routine fixture gains a trailing `""` -> live gate "a routine's element 0 is the ROUTINE header ... no trailing empty element" and "pins the routine's totalLines ..." (2 red)
- mutation: the live PUT with `If-None-Match` sends a stale ts, and the old-ts PUT sends the current ts -> live gate "a PUT carrying If-None-Match: <ts> is accepted ..." and "a PUT carrying the old ts ... is refused with HTTP 409" (2 red)

## Auto Run Result

Status: done
Blocking condition: none

**Summary.** `iris_doc_get` takes optional `startLine` and `endLine` (1-based, inclusive) and returns the numbered lines (the `cat -n` layout), `totalLines` and the document's `ts`; errors M1 to M6 follow the matrix; the no-range path is unchanged and pinned as literals. `@iris-mcp/shared` `lines.ts` gains `documentLines`, `linesInRange`, `formatNumberedLines` and `NUMBERED_LINE_WIDTH`. `BOOTSTRAP_VERSION` is unchanged.

**Files changed.**
- `packages/shared/src/lines.ts`, `index.ts`, `atelier.ts` -- the three line functions and the constant, the barrel export, and the widened `atelierDocStatusError` JSDoc (code unchanged).
- `packages/iris-dev-mcp/src/tools/doc.ts` -- the range schema, description and handler.
- `packages/shared/src/__tests__/lines.test.ts`, `packages/iris-dev-mcp/src/__tests__/doc-get-range.test.ts`, `doc-get-range-framework.test.ts` (review pass), `doc-get-range-live-gate.test.ts`, `live-doc-helpers.ts`, `doc-put-bom-live-gate.test.ts` -- unit, framework-path and live tests; the shared doc helpers.
- `packages/iris-dev-mcp/scripts/prepublish-gate.mjs` -- the live gate joins `gateTestFiles`.
- `packages/iris-dev-mcp/README.md`, `CHANGELOG.md`, `.changeset/story-38-2-line-range-document-read.md` -- docs (shared and dev minor).

**Review.** First pass: 25 findings from four layers (high 0, medium 0, low 20, false 5, maybe-false 0), tallied mechanically from the triage log. Patches applied: 10 (all low): a live-captured M6 fake plus a read-only live soft-error case, the `metadataOnly: false` and M5-before-M4 unit cases, the framework-path test for the "Bad number" row, doc wording (the Invalid-arguments text, the loc_count claim limited to a class, the gate-sample wording, a consistent README example), the `lines.ts` header, and nine extra mutation lines. Deferred: none new (the two plan-time `deferred:` items stand). Rejected: 15, each with its reason in the triage log (empty-array M4 text, the not-yet-existing `iris_doc_edit` reference, spec-fixed description text, the sibling-default live target, and the false findings).

**Follow-up review recommendation:** `false` (no high patched; no two medium patched; patched counts: high 0, medium 0, low 10).

**Residual risks.** The M5 (`enc: true`) shape is source-derived, not read from a live binary document. An empty `content` array would give the M4 text "from 1 to 0" (not observed on IRIS). The `iris_doc_get` description names `iris_doc_edit`, which Story 38.4 registers.

**Implementation run record (2026-10-15).** `BOOTSTRAP_VERSION` is unchanged (no `src/ExecuteMCPv2/**` or `bootstrap-classes.ts` change).
- **AC-1 / AC-5 live run.** Target: `default` profile, localhost:52773, HSCUSTOM, IRIS for UNIX (Ubuntu Server LTS for ARM64 Containers) 2026.2 (Build 221U) Fri Jun 26 2026 09:59:12 EDT, Atelier v8. The loop command (`IRIS_REQUIRE_LIVE=1`, the six `IRIS_*` variables set explicitly, `--no-file-parallelism`) ran `doc-get-range-live-gate.test.ts` (16 passed) and `doc-put-bom-live-gate.test.ts` (6 passed), none skipped. Live facts proven: the class `content` ends with `"}", ""` and no element holds `\r`, `\n` or U+FEFF; the routine's element 0 is `ROUTINE ExecuteMCPv2.Temp.QaStory382Range` (type dropped) with no trailing `""`; the ranged `ts` equals the full read's `ts` and the `metadataOnly` `etag` (`YYYY-MM-DD HH:MM:SS.fff`); a PUT to an existing document with no `If-None-Match` and no `ignoreConflict` is HTTP 409 and the document is unchanged; `If-None-Match: <ts>` is accepted (new content, new `ts`); the old `ts` after another write is HTTP 409. Pins captured live: class `totalLines` 566, line 1 `/// Disposable fixture for the Story 38.2 live gate; never compiled.`, line 250 `/// Method 036: ...`, last line `""`; routine `totalLines` 30, line 1 the `ROUTINE` header, last line `Label29 ; routine line 29 ...`.
- **`iris_loc_count` cross-check (interpretation 4).** With the class fixture present, `iris_loc_count` with `spec: ExecuteMCPv2.Temp.QaStory382Range.cls` returned `totalLines` 566 (`filesParsed` 1), equal to the ranged read's `totalLines` 566, so the trailing `""` is counted by both. Probed once with a temporary test that was removed afterwards.
- **(once) sweep, per package, re-run after the review patches (build, test, lint, type-check; all exit 0).** shared 70 files / 1402 tests; dev 49 / 895; admin 35 / 498; interop 22 / 343; ops 20 / 350; data 9 / 165; client-config 21 / 514; `@iris-mcp/all` 28 / 264. The live loop command after the patches: `doc-get-range-live-gate.test.ts` 17 passed (the soft-error case added) and `doc-put-bom-live-gate.test.ts` 6 passed, none skipped; `iris_doc_list` for `ExecuteMCPv2.Temp.QaStory382` returned `{"items":[]}` after the mutation runs and again after the sweep. `live-gate-roster.test.ts` passes (the new gate is in `gateTestFiles`). Lint: 0 errors; the shared package reports one pre-existing unused-`eslint-disable` warning in a file this story does not touch.
- **Governance and frozen files.** `pnpm gen:governance-baseline:check` exit 0 (141 frozen keys, hash `1e62c5ad5bf7`, `governance-baseline.ts` unmodified). `git diff --stat 7d685770... -- bootstrap-classes.ts governance-baseline.ts src/ doc.test.ts presets.ts` is empty. Tool, action and key counts are unchanged (no tool, action, annotation or preset edit).
- **Cleanup.** `iris_doc_list` (`default`, HSCUSTOM, `filter: ExecuteMCPv2.Temp.QaStory382`, `generated: true`) returned `{"items":[]}` before the first write and after the last run.
- **Notes for review.** (1) The `metadataOnly` parameter description was also corrected to say `etag` (it still said "Last-Modified timestamp"), alongside the tool description the spec names; no code changed. (2) An empty `content` array (`totalLines` 0) gets the M4 text with "from 1 to 0"; Atelier was not observed returning an empty array for a document, so the matrix text is kept exactly. (3) The AD-24 gate tests PUT with raw `client.put`, not through `iris_doc_put`, because `iris_doc_put` cannot send `If-None-Match` (recorded in `deferred:`).
