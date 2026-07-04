# Story 22.0: LOC Counter Library + Endpoint + Tool

Status: done

## Story

As a **developer**,
I want **a tool that counts lines of code in my namespace's ObjectScript documents — separating blank lines, comments, source code, and test code**,
so that **I can track codebase size, comment density, and test footprint without exporting source to disk**.

## Acceptance Criteria

Copied verbatim from `_bmad-output/planning-artifacts/epics.md` Epic 22 (lines 3830-3855). Decisions D1–D7 in `_bmad-output/planning-artifacts/research/technical-objectscript-loc-counter-2026-07-03.md` §8 are **binding**.

- **AC 22.0.1** — New ObjectScript LOC library under `src/ExecuteMCPv2/` (indicative decomposition: an enumerator/loader, a stateful line-classifier, and a callable facade `Count(pNamespace, pSpec, pOptions, Output pResult)`; dev finalizes class/method naming per project conventions, no underscores in method names). The library is callable independently of REST.
- **AC 22.0.2** — Enumeration via `%Library.RoutineMgr:StudioOpenDialog` with a **required caller-supplied document spec** (e.g. `ExecuteMCPv2.*.cls,*.mac`; decision D2 — whole-namespace requires an explicit `*` and the tool description documents the timeout risk), `Flat=1`, and `ShowGenerated=0` by default with an optional `includeGenerated` flag (decision D7 — generated `.int` double-counts its source `.cls`/`.mac`). Document types covered: CLS, MAC, INT, INC.
- **AC 22.0.3** — Source retrieval via `%Atelier.v1.Utils.TextServices.GetTextAsArray(pFullName, pFlags, .pTextArray)`, iterating the returned line array. **Rule #16 live-probe FIRST**: confirm `pFlags` semantics and storage-section inclusion via a disposable probe class before freezing the implementation; record findings in dev notes (fallbacks per research §3 if the probe surprises: `%Compiler.UDL.TextServices` for classes, `$system.OBJ.ExportUDL`).
- **AC 22.0.4** — Line classification at parity with the reference tool: blank = whitespace-only (CR-tolerant); comment markers as first non-whitespace token `//`, `///`, `;`, `#;`, `##;` (preprocessor directives `#Define`/`#Dim`/`#Include`/`#If...` etc. are CODE); `/* ... */` block comments stateful across lines including same-line open+close and text-after-`*/`; **string literals masked before marker detection** (ObjectScript `"..."` with `""` escape — markers inside strings never match); a line with code before an inline comment counts as code. XData/Storage block lines count as code (deliberate, documented carry-over).
- **AC 22.0.5** — Test bucketing (decision D3 — hybrid): file-level test classification via `$CLASSMETHOD(class,"%IsA","%UnitTest.TestCase")` (transitive — catches project-intermediate base classes the reference regex misses); method-level via `Test*` / `OnBeforeAllTests` / `OnAfterAllTests` / `OnBeforeOneTest` / `OnAfterOneTest` names inside non-test classes, scoped by brace-depth tracking over the masked line; `[ Language = python ]` method bodies resolved via `%Dictionary.CompiledMethod.Language` (not signature regex), within which leading `#` is a comment. Routines/includes are never test-bucketed by name alone (no directory heuristic exists in a namespace — a documented delta from the reference tool's `/tests/`-path rule).
- **AC 22.0.6** — New thin REST surface: Dispatch route + handler method (indicative: `GET /dev/loc?spec=<spec>&namespace=&includeGenerated=&topN=`) — validate → delegate to facade → render; namespace save/restore, `SanitizeError`, single-`RenderResponseBody` per path (Rule #7); no caret-globals in error text (Rule #33).
- **AC 22.0.7** — New tool `iris_loc_count` (name confirmed in dev) on `@iris-mcp/dev`: input `{ spec: string (required), namespace?: string, includeGenerated?: boolean, topN?: number (default 20, max 100), format?: "summary"|"csv" }` (+ framework `server`); `structuredContent` is an OBJECT: `{ filesParsed, totalLines, blankLines, sourceCodeLoc, sourceCommentLoc, testCodeLoc, testCommentLoc, codePct, sourceCodePct, testCodePct, commentPct, whitespacePct, topDocuments: [{name, type, totalLines, codeLoc, commentLoc, isTest}], truncatedTopN }` (decisions D4+D5); `content` text renders the reference tool's summary-table shape (or CSV rows when `format:"csv"`). Annotations `readOnlyHint:true, idempotentHint:true, openWorldHint:false`; wire-explicit defaults per Rule #10 (send documented defaults on the wire, never rely on server-side defaulting).
- **AC 22.0.8** — Governance: `mutates: "read"` (Rule #28 — mandatory even for reads) → default-enabled; new non-baseline key; frozen baseline `1e62c5ad5bf7` untouched (`gen:governance-baseline:check` exit 0, bare generator NOT run — Rule #25); `assertGovernanceClassification` passes; a governance test drives the real `handleToolCall` gate.
- **AC 22.0.9** — Back-compat (Rule #19, mechanical): no existing tool/schema/output modified; dev package tool count 25 → 26 (`index.test.ts` `toHaveLength` updated — normal package tool, not the Rule #31 framework split).
- **AC 22.0.10** — BOOTSTRAP_VERSION: add the new class(es) to the ordered `classes[]` array in `scripts/gen-bootstrap.mjs` (dependency order, before `REST/Dispatch.cls`; Test classes stay OUT), regenerate, record from→to hash (Rule #24); `bootstrap.test.ts` green; `bootstrap-classes.ts` not hand-edited (Rule #18).
- **AC 22.0.11** — Tests: ObjectScript `%UnitTest` classes `ExecuteMCPv2.Tests.Loc*Test` (≤~500 lines each, split by concern) with synthetic fixture sources covering: every comment syntax; `#Define`-is-code vs `#;`-is-comment; markers inside string literals (incl. `""` escapes) not matched; block comment spanning lines, same-line pair, and code-after-`*/`; python-method `#` comments; transitive `%UnitTest` inheritance through an intermediate base; `Test*` method inside a non-test class (brace-depth scoped); lifecycle methods; blank/CR-tolerance; bucket-sum === total invariant. Plus TS wrapper unit tests (mocked HTTP) and the governance + back-compat tests above. Rule #35: verify returned test totals match expected counts before trusting green.
- **AC 22.0.12** — Cross-verification sanity check: run the counter over the loaded `ExecuteMCPv2` package and compare against the reference bash tool run over `src/ExecuteMCPv2/` on disk; buckets need not match exactly (namespace UDL vs disk differences — storage sections, generated exclusions) but each delta is explained in dev notes. Unexplained deltas are defects.
- **AC 22.0.13** — Lead per-story smoke (Rules #22/#26 + **Rule #34 — cross-namespace**): live against HSCUSTOM AND at least one second namespace with different characteristics (e.g. SADEMO); verify the required-spec rejection (missing/empty `spec` refused cleanly), a scoped count returns plausible buckets summing to totalLines, `includeGenerated:true` visibly changes counts, and top-N is capped. If no second populated namespace is available, record that as explicit residual risk. *(Lead-executed after code review — NOT a dev task; dev's job is to make it passable.)*
- **AC 22.0.14** — Docs rollup (Rule #30): `packages/iris-dev-mcp/README.md` (tool section + example), root `README.md` + `packages/iris-mcp-all/README.md` (counts + mention), `tool_support.md` (new row; dev 25→26; totals +1), `docs/migration-v1-v2.md` count refresh, `CHANGELOG.md` entry. **Default-state callout: `iris_loc_count` is a read, enabled by default.** Counts cross-verified vs `index.test.ts`.

## Tasks / Subtasks

- [x] Task 1: Rule #16 live probes (AC: 22.0.3, 22.0.5) — DO THIS FIRST
  - [x] Create disposable probe class `ExecuteMCPv2.Temp.LocProbe` (on disk → `iris_doc_load` with glob → compile), probing:
    - `##class(%Atelier.v1.Utils.TextServices).GetTextAsArray(pFullName, pFlags, .arr)` — confirm signature/`pFlags` semantics; whether class output includes the `Storage` section; array shape (`arr(0)`=count, `arr(1..n)`=lines); behavior for `.mac`/`.int`/`.inc` names
    - `%ResultSet` on `"%RoutineMgr:StudioOpenDialog"` — confirm exact positional args (read `irislib/%Library/RoutineMgr.cls:1082-1114` for the query declaration + ROWSPEC first, per Rule #2), that a multi-part spec (`Pkg.*.cls,*.mac`) works, `Flat=1` output shape (Name column with type suffix), and `ShowGenerated=0` vs `1` difference (a generated `.int` appearing/disappearing)
    - `$CLASSMETHOD(cls,"%IsA","%UnitTest.TestCase")` on (a) a compiled test class, (b) a NON-compiled/nonexistent class (expect `<CLASS DOES NOT EXIST>` — wrap in Try/Catch, fall back to not-test), (c) whether legacy `%UnitTest.Case` lineage matters on this instance
    - `##class(%Dictionary.CompiledMethod).%OpenId(class_"||"_method).Language` — confirm IdKey shape and value (`"python"`/`"objectscript"`/`"cache"`) for a python-flagged method; behavior when the method is inherited/not found (fallback: treat as ObjectScript)
  - [x] Record ALL probe findings in Dev Agent Record → Completion Notes; delete the probe class from IRIS AND disk before finishing
- [x] Task 2: LOC library (AC: 22.0.1, 22.0.2, 22.0.3, 22.0.4, 22.0.5)
  - [x] `src/ExecuteMCPv2/Loc/Classifier.cls` — stateful line classifier, a **pure function of (line array + per-doc metadata)** so fixtures drive it without REST (see the state-machine spec in Dev Notes; port the reference AWK faithfully)
  - [x] `src/ExecuteMCPv2/Loc/Scanner.cls` (or dev's naming) — enumeration via StudioOpenDialog + source retrieval via GetTextAsArray + per-doc metadata lookups (`%IsA` test-class check, python-method map via `%Dictionary.CompiledMethod`)
  - [x] `src/ExecuteMCPv2/Loc/Generate.cls` (facade, mirrors `ExecuteMCPv2.Diagram.Generate`) — `ClassMethod Count(pNamespace As %String, pSpec As %String, pOptions As %DynamicObject, Output pResult As %DynamicObject) As %Status`; aggregates buckets + percentages + capped top-N largest documents (D5) + `truncatedTopN`
  - [x] Class/method names: NO underscores; `t`/`p` prefixes; try/catch; `$$$` macros; doc-comment banners
- [x] Task 3: REST endpoint (AC: 22.0.6)
  - [x] New handler `src/ExecuteMCPv2/REST/Loc.cls` — `ClassMethod LocCount()` reading query params (`spec` REQUIRED → reject missing/empty via Utils validation; `namespace` default current; `includeGenerated` default 0; `topN` default 20 clamp 1..100); explicit namespace save/restore (NO `New $NAMESPACE`; catch restores first); delegate to facade; single `RenderResponseBody` per path (Rule #7); `SanitizeError` on errors; no `^`-prefixed global names in any error text (Rule #33)
  - [x] Dispatch route in `src/ExecuteMCPv2/REST/Dispatch.cls`: `<Route Url="/dev/loc" Method="GET" Call="ExecuteMCPv2.REST.Loc:LocCount" />` (new `<!-- Dev tools -->` section; copy the GET-param pattern from `Interop:MessageDiagram`)
- [x] Task 4: ObjectScript tests (AC: 22.0.11)
  - [x] `src/ExecuteMCPv2/Tests/LocClassifierTest.cls` (+ split into `LocScannerTest`/`LocFacadeTest` as needed, each ≤~500 lines) — synthetic line-array fixtures for EVERY AC 22.0.4/22.0.5 case (full list in Dev Notes → Fixture matrix); bucket-sum===total invariant on every fixture
  - [x] Transitive-inheritance fixture: tiny `ExecuteMCPv2.Tests.LocFixtureBase.cls` (extends `%UnitTest.TestCase`, no `Test*` methods) + `ExecuteMCPv2.Tests.LocFixtureChild.cls` (extends the base) — assert the scanner classifies Child as a test class; fixtures live in Tests package (NOT in bootstrap)
  - [x] `%OnNew(initvalue)` + `##super(initvalue)` in every test class; deploy `src/**/*.cls` (Rule #17), compile, run per-class; Rule #35 — verify returned totals match the method count you wrote before trusting green
- [x] Task 5: TS tool (AC: 22.0.7, 22.0.8, 22.0.9)
  - [x] `packages/iris-dev-mcp/src/tools/loc.ts` — `locCountTool` (`name: "iris_loc_count"`), copy the wiring shape of `packages/iris-interop-mcp/src/tools/diagram.ts` (custom-REST GET + `URLSearchParams` + `ctx.resolveNamespace` + `IrisApiError` → `isError` envelope; non-IrisApiError rethrow); `BASE_URL = "/api/executemcp/v2"`; wire-explicit defaults (Rule #10): `includeGenerated ?? false`, `topN ?? 20`, `spec` always sent; `format` is CLIENT-side rendering only (summary table mirroring the reference tool's ASCII shape, or CSV `metric,value` rows) — NOT sent to the server; `structuredContent` = endpoint result object VERBATIM (object, never array); Zod: `.min(1)` on `spec`, `.int().min(1).max(100)` on `topN`, NO `.refine()`; `scope: "NS"`, `mutates: "read"`, annotations per AC
  - [x] Register in `packages/iris-dev-mcp/src/tools/index.ts` (25 → 26)
  - [x] Tool description MUST document: spec is required; whole-namespace requires explicit `*` and risks the ~60s gateway timeout (D2); generated documents excluded by default (D7)
- [x] Task 6: TS tests (AC: 22.0.8, 22.0.9, 22.0.11)
  - [x] `packages/iris-dev-mcp/src/__tests__/loc.test.ts` — mocked HTTP: URL/param assertions incl. wire-explicit defaults; summary + csv rendering; structuredContent-verbatim; IrisApiError envelope; spec-required client guard (reject empty/whitespace `spec` before HTTP — mirror `sqlAnalyze`'s `query.trim()` guard)
  - [x] `loc-governance.test.ts` — drives the REAL `McpServerBase.handleToolCall` gate (mirror `sqlAnalyze`/diagram governance tests): registration passes `assertGovernanceClassification`, read allowed by default
  - [x] `index.test.ts` `toHaveLength(25)` → 26 + `getToolNames()` update
- [x] Task 7: Bootstrap + baseline (AC: 22.0.10, 22.0.8)
  - [x] Add to `scripts/gen-bootstrap.mjs` `classes[]` in dependency order: the three `ExecuteMCPv2.Loc.*` entries AFTER the Diagram block / BEFORE the REST handlers; `ExecuteMCPv2.REST.Loc.cls` among the handlers; `Dispatch.cls` stays LAST; Tests + Temp classes stay OUT
  - [x] `pnpm run gen:bootstrap` — record BOOTSTRAP_VERSION from `c3cc801cfead` → (new) in Dev Agent Record + story; run again to confirm idempotent; `bootstrap.test.ts` green; NEVER hand-edit `bootstrap-classes.ts` (Rule #18)
  - [x] `pnpm run gen:governance-baseline:check` exit 0 (bare generator NOT run — Rule #25); frozen `governance-baseline.ts` git-clean
- [x] Task 8: Cross-verification (AC: 22.0.12)
  - [x] Run the deployed counter over the loaded `ExecuteMCPv2` package (spec `ExecuteMCPv2.*.cls`) and `bash ../ObjectScriptLOCCounter/cos_loc_counter.sh src/ExecuteMCPv2/` on disk; tabulate both; explain every delta (expected: storage-section lines, `Temp`/fixture presence differences, disk-only vs loaded docs, CRLF) in Dev Agent Record. Unexplained deltas are defects — fix before proceeding.
- [x] Task 9: Docs rollup (AC: 22.0.14)
  - [x] `packages/iris-dev-mcp/README.md` (tool table row + `<details>` example), root `README.md` + `packages/iris-mcp-all/README.md` (dev/suite counts +1 + ASCII diagram number), `tool_support.md` (new row, dev 25→26, suite totals +1), `docs/migration-v1-v2.md` counts, `CHANGELOG.md` entry; **state explicitly: read, enabled by default under IRIS_GOVERNANCE**; cross-verify all counts vs `index.test.ts`
- [x] Task 10: Full verification
  - [x] Full monorepo suite green (`pnpm test` across packages), lint + type-check clean; all OS test classes pass per-class (Rule #35); record final counts in Dev Agent Record

### Review Findings (code review, 2026-07-03)

**Verdict: APPROVED with 7 findings auto-fixed inline, 2 deferred, 9 dismissed. 0 HIGH from any layer.** Three-layer review (Blind Hunter diff-only / Edge Case Hunter live-probed / Acceptance Auditor spec-vs-diff) + reviewer's independent line-by-line AWK-parity audit, mechanical gates, and live-IRIS verification. AC-by-AC: **all 14 ACs MET** (AC 22.0.13 lead-executed post-review by design — endpoint verified smoke-passable incl. a SADEMO cross-namespace probe). **D1–D7: all CONFORM** (D1 namespace-only ✓, D2 required spec + documented timeout ✓, D3 hybrid %IsA + dictionary-python + brace-depth ✓, D4 object shape + format renderings ✓, D5 top-N capped/default 20/max 100 + truncatedTopN ✓, D6 `mutates:"read"` ✓, D7 ShowGenerated=0 + includeGenerated ✓).

Auto-fixed (checked = fix applied, redeployed, re-verified):

- [x] [Review][Patch] **CR 22.0-1 (MED, edge)** — `MaskStrings` diverged from the reference regex's leftmost-LONGEST semantics on a doubled-quote-at-EOL literal (`Set x = "/*abc""`): the greedy escape scan ran off the line, left the literal RAW, the exposed `/*` set `tInBlock=1`, and every following line in that document became comment (reference: 3 code / port-before-fix: 1 code + 2 comment — pinned by running `cos_loc_counter.sh` on the fixture). Fixed by recording the last `""` pair-start during the scan and backtracking the close there when unterminated (a truly close-less literal is still left raw — reference-verified via the `"unterminated /* here` fixture, 1 code + 1 comment). [src/ExecuteMCPv2/Loc/Classifier.cls:MaskStrings] + regression `LocClassifierTest:TestStringMaskBacktrackParity` + live endpoint probe on a scratch `.mac` (4 code / 0 comment post-fix).
- [x] [Review][Patch] **CR 22.0-2 (LOW, blind+edge)** — facade `topN < 1` fell back to the default 20 instead of the documented 1..100 clamp (REST layer clamps 0→1; facade-direct callers diverged). Fixed: present NUMERIC values clamp into 1..100; non-numeric junk still keeps the default (REST pre-rejects junk). [src/ExecuteMCPv2/Loc/Generate.cls] + regression `LocFacadeTest:TestTopNZeroClampsToOne`.
- [x] [Review][Patch] **CR 22.0-3 (LOW, blind)** — `BuildClassMetadata` never reset the ByRef `pPyMethods` accumulator (latent cross-document contamination for a looping caller reusing one array). Fixed: `Kill pPyMethods` on entry. [src/ExecuteMCPv2/Loc/Scanner.cls]
- [x] [Review][Patch] **CR 22.0-4 (LOW, edge + reviewer)** — two undocumented StudioOpenDialog spec semantics: (a) wildcard scans exclude `%`-prefixed system documents (hardcoded `SystemFiles=0`; explicit `%*` parts DO return them — live-probed); (b) an exact document name listed before an overlapping wildcard part can DROP documents (live-probed: `A.Generate.cls,A.Loc.*.cls` → 2 of 3; reversed order → 3 of 3 — native IRIS query behavior, not a port defect). Documented in the tool description, dev README example, and the tool_support.md Epic-22 note. [packages/iris-dev-mcp/src/tools/loc.ts + READMEs] + description assertions in loc.test.ts.
- [x] [Review][Patch] **CR 22.0-5 (LOW, blind)** — `EnumerateDocs` ignored `Next()`'s ByRef status; a mid-stream query error read as a silent end-of-results undercount. Fixed: `Next(.tSCNext)` + propagate. (Bare `Next()` is the suite-wide convention in pre-existing handlers — only the NEW code is fixed here.) [src/ExecuteMCPv2/Loc/Scanner.cls]
- [x] [Review][Patch] **CR 22.0-6 (LOW, edge)** — `renderSummaryTable`/`renderCsv` called `.toFixed(1)` unguarded; a malformed 200 envelope (missing numeric fields) would crash with TypeError instead of degrading. Fixed with an `fmtPct` guard (`Number(v ?? 0)`, byte-identical for well-formed values — matches diagram.ts's `?? []` posture). [packages/iris-dev-mcp/src/tools/loc.ts] + malformed-envelope regression in loc.test.ts.
- [x] [Review][Patch] **CR 22.0-7 (LOW, blind)** — the 4 new test classes declared `%OnNew(initvalue)` without the testing-rules default; aligned to `%OnNew(initvalue As %String = "")`. (The 8 pre-existing Epic-21 Diagram test classes share the no-default form — noted for the cleanup story, not changed here.) [src/ExecuteMCPv2/Tests/Loc*Test.cls]
- [x] [Review][Patch] **CR 22.0-8 (NIT, auditor + reviewer)** — record correction: the dev note's "51 post-foundation keys" is 52 on the current built dists (`iris_loc_count` confirmed present in `dist/tools/loc.js`; the dev's run predated the final rebuild). Gate result unchanged: `gen:governance-baseline:check` exit 0, frozen `1e62c5ad5bf7` intact.

Deferred (added to deferred-work.md):

- [x] [Review][Defer] **CR 22.0-D1 (LOW)** — `Generate.Count` aborts the whole scan when ONE document's `ScanDoc` errors (enumerate→retrieve TOCTOU: a doc deleted mid-scan kills a long run) — skip-and-report is a design change; deferred. [src/ExecuteMCPv2/Loc/Generate.cls]
- [x] [Review][Defer] **CR 22.0-D2 (LOW)** — optional enhancement to neutralize the StudioOpenDialog overlap-order quirk by enumerating spec parts individually and unioning names (behavior change to ratified D2 StudioOpenDialog semantics — needs a decision); deferred with the CR 22.0-4 documentation as the current mitigation. [src/ExecuteMCPv2/Loc/Scanner.cls]

Dismissed (9, with evidence): python-body brace corruption via `'{'`/`# }` (blind MED-1 — byte-identical in the reference AWK: it masks only double-quoted strings and strips only `//`/`/* */` before `track_braces`; parity is the ratified bar, and the real-corpus cross-verification matches exactly); `/* note */ Method TestFoo()` missed by scope detection (blind LOW-2 — the reference's anchored step-5 regex misses it identically); comma-space spec parts dropped (blind LOW-7 — eliminated by edge hunter's live probe, 2==2); legacy dotted-syntax `. ; text` counts as code (blind LOW-8 — reference-identical); blank lines inside `/* */` blocks count blank not comment (blind LOW-9 — reference step 1 precedes step 2, exact parity); REST double namespace-switch (blind obs — deliberate layering: early validation at REST + facade-independent switch; verified no-op composition); `namespace: ""` bypasses the profile default (edge LOW-C — inherited suite-wide convention, diagram.ts identical); story AC "copied verbatim" vs the italicized 22.0.13 lead-note annotation (auditor A1 — editorial); LocRestTest documented dev-credential fallback with `^UnitTestConfig` override (auditor A3 — accepted project convention for the local dev instance).

**Post-fix verification:** 7 changed classes redeployed + recompiled on HSCUSTOM (45/45, others up-to-date). OS tests (Rule #35 — totals matched written methods; `%UnitTest_Result.TestMethod` SQL used where the class-level report truncated on slow classes, same artifact QA documented): LocClassifierTest **23/23**, LocScannerTest **9/9**, LocFacadeTest **8/8** (SQL-verified), LocRestTest **10/10** (SQL-verified), UtilsTest canary 19/19. `BOOTSTRAP_VERSION` **`aaca90ddee7c` → `919124293f66`** (regen-only, second run byte-identical — idempotent; CHANGELOG updated to the final hash per the Rule #18 lesson). bootstrap.test.ts 41/41; full monorepo turbo **12/12 tasks, 1985 TS tests green** (dev 349→**351**, shared 551); lint 6/6; type-check 12/12; `gen:governance-baseline:check` exit 0 (52 post-foundation keys incl. `iris_loc_count`; frozen `1e62c5ad5bf7` untouched, git-clean). **AC 22.0.12 re-cross-verification post-fix (45 files incl. the new fixtures): all four code/comment buckets EXACT** (sourceCode 8690, sourceComment 2481, testCode 3250, testComment 742); total/blank +45 exactly (the probe-documented trailing-empty artifact). Live endpoint probes: missing-spec/junk rejections clean, includeGenerated 0→3 files, topN cap + truncatedTopN, SADEMO second-namespace invariant holds (244+2106+363=2713), CR 22.0-1 scratch-document probe fixed on the wire.

**Review-modified files:** src/ExecuteMCPv2/Loc/Classifier.cls, src/ExecuteMCPv2/Loc/Generate.cls, src/ExecuteMCPv2/Loc/Scanner.cls, src/ExecuteMCPv2/Tests/LocClassifierTest.cls (+1 test), src/ExecuteMCPv2/Tests/LocFacadeTest.cls (+1 test), src/ExecuteMCPv2/Tests/LocScannerTest.cls, src/ExecuteMCPv2/Tests/LocRestTest.cls, packages/iris-dev-mcp/src/tools/loc.ts, packages/iris-dev-mcp/src/__tests__/loc.test.ts (+2 tests), packages/iris-dev-mcp/README.md, tool_support.md, CHANGELOG.md, packages/shared/src/bootstrap-classes.ts (REGENERATED only).

## Dev Notes

### Binding sources — read before coding

1. `_bmad-output/planning-artifacts/research/technical-objectscript-loc-counter-2026-07-03.md` — **§§3-7 + D1-D7 are binding.** APIs verified against local `irislib/`: `StudioOpenDialog` at `irislib/%Library/RoutineMgr.cls:1082-1114`; `GetTextAsArray` at `irislib/%Atelier/v1/Utils/TextServices.cls:15` (delegates to `$$GetTextAsArray^%apiSRC` — hence the Task 1 probe). Fallbacks: `%Compiler.UDL.TextServices.GetTextAsString/AsStream/AsArray` (classes only, `irislib/%Compiler/UDL/TextServices.cls:98-227`), `$system.OBJ.ExportUDL`.
2. `../ObjectScriptLOCCounter/cos_loc_counter.sh` — reference implementation, stakeholder-owned, **MAY be read directly** (no Epic 21-style clean-room constraint). Its AWK state machine is the parity model; the exact semantics are transcribed below so you should rarely need it.
3. `_bmad-output/planning-artifacts/epics.md` Epic 22 (lines 3811-3856) + `sprint-change-proposal-2026-07-03.md`.

### Classifier state-machine spec (parity with reference AWK — port faithfully)

Per-line processing ORDER (each raw line lands in exactly ONE bucket — blank / sourceCode / sourceComment / testCode / testComment):

1. **Blank**: strip trailing CR first (`$Extract` check — CRLF tolerance), then whitespace-only (`^[ \t]*$`) → blank bucket, next line.
2. **Block-comment continuation** (if `inBlock`): find `*/`. Absent → comment, next. Present → `inBlock=0`, keep text AFTER the terminator; if that remainder is whitespace-only → comment, next; else **fall through and classify the remainder as a fresh line** (it may be code, a comment, or open a NEW block).
3. **Mask string literals** (BEFORE any marker detection): replace every `"([^"]|"")*"` with `""` — a manual char scan is more reliable than regex in ObjectScript (handles `""` escapes; the masked line keeps an empty-string token so code presence is preserved). Braces/markers inside literals must never match. Work on the masked copy `s` from here on.
4. **Leading single-line comment check** (on masked `s`, after stripping leading whitespace): `//` (covers `///`), `;`, `#;`, `##;` → comment, next. `#` alone is a comment ONLY inside a python method body (`mPy=1`). **`#Define`/`#Dim`/`#Include`/`#If...` are CODE** — only bare `#;`/`##;` match (`^##?;`).
5. **Method-scope detection** (only when NOT already inside a tracked method): masked line matches `^[ \t]*(ClassMethod|Method)[ \t]+`. If the class is NOT file-level test AND the method name matches `Test[A-Za-z0-9]*` or a lifecycle name (`OnBeforeAllTests|OnAfterAllTests|OnBeforeOneTest|OnAfterOneTest`) followed by `(` → enter test-method scope (`mTest=1`). Python: the reference regexed the signature's `[ Language = python ]`; **D3 upgrade — resolve python via `%Dictionary.CompiledMethod.Language` instead** (build a per-doc method→language map once per class; the signature line still triggers scope ENTRY, the dictionary decides `mPy`). The signature line itself is classified under the NEW state (a `Method TestFoo()` line counts as test code). Reset `mStarted=0, mDepth=0` on entry.
6. **Inline-comment strip, leftmost-first scan** (on masked `s`): loop — find first `//` and first `/*`; if `/*` comes first: complete same-line `/* ... */` pairs are EXCISED (splice, continue scanning); unterminated `/*` truncates the line and sets `entering=1` (block begins). If `//` comes first: truncate (rest of line dead). Exit loop when neither found. Set `inBlock=entering` after the loop.
7. **Final classification**: if the stripped masked line is now whitespace-empty → comment (e.g. a line that was only `/* opening` or `/* a */ // b`); else → code. Route to test vs source: `isTest || mTest` → test buckets; else source. (`mPy` alone does NOT make a line test — a python method in a non-test class is source.)
8. **Brace tracking** (AFTER classification, on the comment/string-stripped line, only when method scope active): `mDepth += countOpen; if any open seen → mStarted=1; mDepth -= countClose; if mStarted && mDepth<=0 → exit method scope` (the closing-brace line was already classified inside the method — desired: the brace belongs to the method).

**File-level test classification** (once per document, D3 upgrade): CLS docs → `Try { Set tIsTest = $CLASSMETHOD(tClass, "%IsA", "%UnitTest.TestCase") } Catch { Set tIsTest = 0 }` — transitive through intermediate bases; catch covers non-compiled/nonexistent classes (fall back to not-test; note it in the probe findings if StudioOpenDialog can return uncompiled CLS). The ENTIRE document is test-bucketed including `///` doc lines above the `Class` line (matches the reference grep pre-pass semantics — classification is per-document). MAC/INT/INC are NEVER file-level test (no directory heuristic in a namespace — **documented delta** from the reference's `/tests/`-path rule). The reference also matched legacy `%UnitTest.Case` — probe whether `%IsA("%UnitTest.TestCase")` covers it on this instance; if not, note the delta (do NOT add a second check without evidence).

**Aggregation invariant**: `blank + sourceCode + sourceComment + testCode + testComment === totalLines` per document AND in the aggregate — assert it in the facade (mirror the reference's END-block warning, but make it a hard error/status) and in every test fixture.

**Percentages** (D4, match reference CSV keys → camelCase): `codePct = 100*(sc+tc)/total`, `sourceCodePct = 100*sc/total`, `testCodePct = 100*tc/total`, `commentPct = 100*(scm+tcm)/total`, `whitespacePct = 100*blank/total`; all 0 when total=0; one decimal place in text rendering.

**Top-N** (D5): track per-document `{name, type, totalLines, codeLoc, commentLoc, isTest}` during the scan; sort by totalLines desc; cap at `topN` (default 20, max 100); `truncatedTopN = (docsScanned > topN)`.

### Wiring facts (verified against source this session)

- **`scripts/gen-bootstrap.mjs`**: explicit ordered `classes[]` array of `{name, path}` (verified lines 12-33) — Diagram block sits between `Setup.cls` and the REST handlers; insert `ExecuteMCPv2.Loc.*` after the Diagram block, the new `ExecuteMCPv2.REST.Loc.cls` among the handlers, `Dispatch.cls` LAST. Hash = SHA-256(concat, 12 hex); `BOOTSTRAPVERSION` placeholder swap in Setup.cls happens in-memory only. Current `BOOTSTRAP_VERSION = c3cc801cfead`.
- **`src/ExecuteMCPv2/REST/Dispatch.cls`**: UrlMap has per-domain sections (`/command`, `/global`, `/config/...`, `/interop/...`, `/monitor/...`); NO `/dev/*` section exists yet — add one. GET-with-query-params handler precedent: `Interop:MessageDiagram` (route line 115).
- **`packages/iris-dev-mcp/src/tools/index.ts`**: exactly 25 tools today (verified). The dev package ALREADY calls the custom REST service (`execute.ts`: `BASE_URL = "/api/executemcp/v2"`) — this is Pattern B, precedented in-package.
- **TS tool template**: `packages/iris-interop-mcp/src/tools/diagram.ts` is the closest shape (custom-REST GET, `URLSearchParams`, `ctx.resolveNamespace(namespace)`, Rule #10 wire-explicit defaults, `IrisApiError` → `isError` envelope, non-IrisApiError rethrow, structuredContent = endpoint object verbatim).
- **Tests package**: `src/ExecuteMCPv2/Tests/` (plural), classes named `<Area>Test.cls` (e.g. `DiagramWriterTest.cls`); new ones: `Loc*Test.cls`. Tests are deployed by `iris_doc_load src/**/*.cls` but stay OUT of the bootstrap array.
- **Governance**: `mutates: "read"` scalar on the tool definition — mandatory (Rule #28); new key `iris_loc_count` sits OUTSIDE frozen baseline `1e62c5ad5bf7` by design (Rule #23); verify with `pnpm run gen:governance-baseline:check` (exit 0) and NEVER run the bare generator (Rule #25 — it would regrow/overwrite the frozen file; if tripped, `git checkout -- packages/shared/src/governance-baseline.ts`).

### REST handler conventions (Rules #7/#8/#9/#15/#33 + project basics)

- Explicit `Set tOrigNS = $NAMESPACE` / `Set $NAMESPACE = tNS` / restore — **NEVER `New $NAMESPACE`**; catch block restores namespace FIRST line.
- Exactly ONE `RenderResponseBody` per request path — error flag + single dispatch after Try/Catch (Rule #7 pattern; copy from any modern handler, e.g. `Interop:MessageDiagram`).
- Propagate IRIS `%Status` failures through `##class(ExecuteMCPv2.Utils).SanitizeError(tSC)` (Rule #9); never name a global with a leading caret in error text (Rule #33).
- NEVER wrap a method call in `$Get()` (Rule #15). Query params on GET handlers come from `%request.Data("param",1)` — `$Get()` on that subscripted array IS fine (it's a multidim, not a method call).
- No argumented `Quit` inside Try/Catch; `Quit tSC` after; `t`/`p` prefixes; `$$$` triple-dollar macros; no underscores in method/parameter names; `%DynamicObject` keys with underscores need quotes (`pResult."files_parsed"` — avoid by using camelCase keys, which AC 22.0.7 already prescribes).
- Response field names are the AC 22.0.7 camelCase keys exactly — the TS layer passes the object through verbatim.

### Fixture matrix (AC 22.0.11 — every row becomes ≥1 test)

| # | Fixture | Expected |
|---|---|---|
| 1 | `//`, `///`, `;`, `#;`, `##;` leading (with/without indentation) | comment |
| 2 | `#Define X`, `#Dim y`, `#Include z`, `#If 1` | CODE |
| 3 | `Set x = "// not a comment"` / `Set y = "a"";"" b"` (`""` escape) | code (markers inside literals never match) |
| 4 | `/*` line, interior lines, `*/` line | all comment |
| 5 | `Set a=1 /* c */ Set b=2` (same-line pair) | code |
| 6 | `/* a */ Set x=1` (code after terminator) | code |
| 7 | `*/ trailing text` closing a block where remainder is code vs whitespace | code vs comment |
| 8 | `Set x=1 // trailing` | code |
| 9 | line that is ONLY `/* opening` or `/* a */ // b` | comment |
| 10 | python method body: `# comment` inside, `x = 1` inside | testable via metadata map: comment/code, source-bucketed when class not test |
| 11 | `LocFixtureChild` (extends `LocFixtureBase` extends `%UnitTest.TestCase`) | isTest=1 (transitive) |
| 12 | `Method TestSomething()` inside a NON-test class, lines inside braces, line after closing brace | test code inside; source after |
| 13 | lifecycle names (`OnBeforeAllTests` etc.) inside non-test class | test-method scope |
| 14 | blank lines: ``, `   `, `\t`, `  \r` | blank (CR-tolerant) |
| 15 | every fixture | bucket-sum === total invariant |

Keep the classifier pure — fixtures feed a local array + a metadata object (isTestClass, methodLanguage map); no REST, no live docs needed for rows 1-10/12-15.

### Deploy / compile / test loop (Epic 21-proven)

1. Write `.cls` on disk first (never create classes directly in IRIS).
2. `iris_doc_load` path=`c:/git/iris-execute-mcp-v2/src/**/*.cls` compile=true namespace=HSCUSTOM (Rule #17 — glob-prefixed ALWAYS; a bare path mis-maps the class name).
3. Or compile via `compile_objectscript_class`/`package` MCP tools.
4. `iris_execute_tests` per-class (`ExecuteMCPv2.Tests.LocClassifierTest` etc.); **Rule #35**: if returned `total` < the number of Test* methods you wrote, RERUN before trusting green — the tool returns early partial snapshots right after a fresh load/compile, reporting a subset as all-pass.
5. Self-debug via `^ClineDebug` global pattern if needed; clean up debug globals after.

### Previous-story intelligence (Epic 21, Stories 21.0/21.1)

- The Diagram library (`src/ExecuteMCPv2/Diagram/*.cls` + `Tests/Diagram*Test.cls`) is the architectural template: models → pipeline classes → `Generate.cls` facade → thin REST method on an existing/new handler → thin TS tool. Mirror it.
- Bootstrap regenerated 6× in Epic 21, idempotent every time — regen in THIS story, record from→to (`c3cc801cfead` → new), never defer (Rule #24).
- 3 post-close Epic 21 defects were all namespace/environment-shape (dedup id-masking, message-table boilerplate, per-worker locale) — hence AC 22.0.13's mandatory second namespace. For THIS tool the locale risk is low (numeric output), but error-path text flows through `SanitizeError` — keep messages locale-neutral and caret-free.
- `structuredContent` MUST be an object (never array); no `.refine()` on Zod schemas; tool names flat underscore only.
- QA/review found value in TS tests asserting the EXACT wire URL/params (catches Rule #10 drift) — do that in `loc.test.ts`.

### Project Structure Notes

- New files: `src/ExecuteMCPv2/Loc/{Classifier,Scanner,Generate}.cls` (names indicative — dev finalizes; no underscores), `src/ExecuteMCPv2/REST/Loc.cls`, `src/ExecuteMCPv2/Tests/Loc*Test.cls` + 2 fixture classes, `packages/iris-dev-mcp/src/tools/loc.ts`, `packages/iris-dev-mcp/src/__tests__/loc.test.ts` + `loc-governance.test.ts`.
- Modified: `src/ExecuteMCPv2/REST/Dispatch.cls` (route), `scripts/gen-bootstrap.mjs` (classes[]), `packages/shared/src/bootstrap-classes.ts` (REGENERATED only), `packages/iris-dev-mcp/src/tools/index.ts`, `packages/iris-dev-mcp/src/__tests__/index.test.ts`, docs per AC 22.0.14.
- NOT modified: `packages/shared/src/governance-baseline.ts` (frozen `1e62c5ad5bf7`), any existing tool/schema/handler output (Rule #19 — strictly additive).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-22 (lines 3811-3856)]
- [Source: _bmad-output/planning-artifacts/research/technical-objectscript-loc-counter-2026-07-03.md §§3-8 (binding D1-D7)]
- [Source: ../ObjectScriptLOCCounter/cos_loc_counter.sh (reference AWK state machine — parity model)]
- [Source: irislib/%Library/RoutineMgr.cls:1082-1114 (StudioOpenDialog query + ROWSPEC)]
- [Source: irislib/%Atelier/v1/Utils/TextServices.cls:15 (GetTextAsArray)]
- [Source: scripts/gen-bootstrap.mjs:12-33 (ordered classes[] — verified)]
- [Source: packages/iris-interop-mcp/src/tools/diagram.ts (TS wiring template — verified)]
- [Source: .claude/rules/project-rules.md Rules #7-#10, #15-#19, #22-#26, #28, #30, #33-#35]
- [Source: .claude/rules/iris-objectscript-basics.md + object-script-testing.md]

## Dev Agent Record

### Agent Model Used

claude-fable-5 (Claude Code dev-story agent)

### Debug Log References

### Completion Notes List

**Task 1 — Rule #16 probe findings (probe class `ExecuteMCPv2.Temp.LocProbe`, deleted from IRIS + disk after use):**

1. **`GetTextAsArray(pFullName, pFlags, .arr)`** — `arr(0)`=line count, `arr(1..n)`=lines, confirmed. `pFlags=0` returns UDL text (USE THIS); **`pFlags=1` returns the XML `<Export>` format** (192 lines of XML for the same class) — do not use. Class output at `pFlags=0` **INCLUDES the compiler-maintained `Storage Default` section** (probe class: 155 server lines incl. storage vs shorter disk source). Routine-type documents (`.mac`/`.int`/`.inc`) work through the same call and include a **first header line** `ROUTINE <name> [Type=INT,Generated]` / `[Type=INC]` etc. (same shape as on-disk exports from the VS Code ObjectScript extension — parity with the reference tool's input preserved). The returned array carries a **trailing empty element** at `arr(n)` (document text ends with a newline) → one extra blank line per document vs a disk `awk` scan. Probed against `.cls` (compiled + uncompiled), `.int` (generated), `.inc` (`Ensemble.inc`, mapped, 437 lines).
2. **`StudioOpenDialog`** — positional `Execute(Spec, Dir=1, OrderBy=1, SystemFiles=0, Flat=1, NotStudio=0, ShowGenerated)` confirmed against the irislib signature. Multi-part comma spec (`ExecuteMCPv2.Temp.*.cls,ExecuteMCPv2.Diagram.*.cls` → union, 8 rows) works. `Flat=1` Name column carries the full document name **including type suffix** (`X.cls`); `Type` column: 0=MAC, 1=INT, 2=INC, 4=CLS (bare `*` also returns HL7 schema docs `type=100`, CSP, etc. → scanner MUST filter to cls/mac/int/inc). `ShowGenerated=0` vs `1`: generated `ExecuteMCPv2.Temp.LocProbe.1.int` appears ONLY with `ShowGenerated=1` (D7 confirmed live). **Uncompiled classes ARE enumerated** (saved-document universe): `LocProbeUncompiled` (loaded, never compiled) appeared in the spec results. Scale check: bare `*` in HSCUSTOM = 9,725 rows (timeout risk per D2 is real; mapped Ens/HS docs are namespace-visible and count — D1 semantics).
3. **`$CLASSMETHOD(cls,"%IsA","%UnitTest.TestCase")`** — returns 1 for a compiled test class (`ExecuteMCPv2.Tests.UtilsTest`), 0 for non-test (`ExecuteMCPv2.Utils`), and **throws `<CLASS DOES NOT EXIST>`** for nonexistent AND for saved-but-uncompiled classes (probed both) → Try/Catch fallback to not-test is REQUIRED and covers the StudioOpenDialog-returns-uncompiled case. **`%UnitTest.Case` does NOT exist on this instance** (`%Dictionary.CompiledClass/ClassDefinition.%ExistsId` both 0) — legacy-lineage check would be dead code; documented delta, no second check added (per story guidance).
4. **`%Dictionary.CompiledMethod.%OpenId(class_"||"_method)`** — IdKey shape confirmed. `.Language` values on this instance: `"python"` for a `[ Language = python ]` method, **`"objectscript"`** (not `"cache"`) for ObjectScript methods. Nonexistent method → null oref (treat as ObjectScript). Inherited methods ARE present (flattened) with `.Origin` = defining class. **Map building via `%Dictionary.CompiledClass.%OpenId(cls).Methods` iteration works** (probe: 237 flattened methods, python filter found exactly `["PyProbe"]`) — chosen over SQL because `Language` is a reserved word in IRIS SQL (`SELECT ... Language` → SQLCODE -12; would need quoted `"Language"`).

**Tasks 2-4 — LOC library + REST endpoint + ObjectScript tests:**

- `ExecuteMCPv2.Loc.Classifier` — pure classifier (line array + `pIsTest` + `pPyMethods` map → five-bucket counts), faithful AWK port: CR-strip → blank → block-continuation (raw line) → string masking (manual char scan, `""` escapes, unterminated-literal regex parity) → leading markers (`//`/`;`/`#;`/`##;`; python `#` only when `mPy`) → method-scope detection (`Test[A-Za-z0-9_]*`/lifecycle + name-then-`(` check; python via the injected dictionary map per D3 — signature regex NOT used) → leftmost-first inline `//`//`/*` strip with same-line-pair excision → final classify → brace tracking on the comment/string-free text with `mStarted`/`mDepth` exit semantics. One deliberate parity choice: the test-name tail matches `[A-Za-z0-9_]*` (the reference AWK charset — the story spec's prose said `[A-Za-z0-9]*`; AWK parity wins per AC 22.0.4 "parity with the reference tool", and underscore method names are illegal in this project anyway).
- `ExecuteMCPv2.Loc.Scanner` — `EnumerateDocs` (positional `Execute(Spec,1,1,0,1,0,ShowGenerated)`, extension filter to cls/mac/int/inc — bare `*` also returns HL7/CSP types), `BuildClassMetadata` (`%IsA` in Try/Catch → not-test fallback; python map via CompiledClass.Methods), `ScanDoc` (GetTextAsArray pFlags=0 → metadata for CLS only → classify; MAC/INT/INC never file-level test — documented delta, no directory heuristic in a namespace).
- `ExecuteMCPv2.Loc.Generate.Count(pNamespace, pSpec, pOptions, .pResult)` — validates spec (required, D2), resolves `includeGenerated` (CR 21.1-A boolean-coercion pattern) + `topN` (default 20, cap 100), explicit namespace save/restore (catch restores first), aggregates buckets, enforces the bucket-sum===total invariant per doc AND aggregate as a HARD error, computes D4 percentages (1-decimal via `$Justify`), and emits the D5 top-N list (negative-subscript sort, insertion-order tiebreak) + `truncatedTopN`.
- `ExecuteMCPv2.REST.Loc:LocCount` + Dispatch route `GET /dev/loc` (new "Epic 22: Dev tools" section) — spec required via `Utils.ValidateRequired`; `includeGenerated` 0/1/true/false validation; `topN` digits-check then clamp 1..100; MessageDiagram-parity namespace switch; single `RenderResponseBody` per path; `SanitizeError` everywhere; no caret-globals in error text.
- **ObjectScript tests: 38 new, all green with totals matching methods written (Rule #35):** `LocClassifierTest` 22/22 (every fixture-matrix row incl. `""`-escape literals built via `$Char(34)`, block/inline comment interplay, python metadata-map bodies, brace-depth nesting, braces-in-strings/comments, `Testable`-matches/`MyTest`-doesn't edges, file-test suppression, CR tolerance, empty doc; bucket-sum invariant asserted in every fixture via the shared `AssertBuckets` helper), `LocScannerTest` 9/9 (**first run returned 6/9 — Rule #35 partial snapshot; rerun returned 9/9**; transitive `%IsA` via `LocFixtureBase`→`LocFixtureChild`, python map finds `PyHelper`, generated toggle live, missing-doc error), `LocFacadeTest` 7/7 (spec-required, aggregate shape + invariant + pct-sum≈100 + sorted top-N fields, topN cap + truncation, includeGenerated 0→3 files, zero-match zeros, explicit namespace, bad-namespace restore).
- Fixtures: `LocFixtureBase` (extends `%UnitTest.TestCase`, no Test* methods) + `LocFixtureChild` (extends the base; carries the embedded-python `PyHelper` so the map builder has a compiled fixture). Fixtures + tests stay OUT of the bootstrap array.

**Tasks 5-7 — TS tool + tests + bootstrap:**

- `packages/iris-dev-mcp/src/tools/loc.ts` (`iris_loc_count`) — diagram.ts wiring shape; wire-explicit `includeGenerated=false`/`topN=20` + trimmed `spec` always sent (Rule #10); `format` client-side only (`summary` = reference ASCII table byte-shape; `csv` = reference snake_case `metric,value` rows); `structuredContent` = endpoint object verbatim; whitespace-spec client guard before HTTP; `mutates: "read"` scalar; annotations readOnly/idempotent/closed-world; description documents required spec + explicit-`*` timeout risk (D2) + generated-exclusion default (D7). Registered in `tools/index.ts` (25 → 26, appended last before the framework tool).
- TS tests: `loc.test.ts` 14 tests (exact wire URL incl. defaults, explicit params, trim, no `format` on wire, whitespace-spec guard with zero HTTP calls, byte-exact summary table + CSV renderings, structuredContent verbatim, IrisApiError envelope, non-IrisApiError rethrow, Zod bounds) + `loc-governance.test.ts` 2 tests (real `handleToolCall` gate: read allowed under empty `IRIS_GOVERNANCE`; registration passes `assertGovernanceClassification`) + `index.test.ts` updated (26 package / 27 advertised / `getToolNames` order). Dev package total: **346 tests green**.
- **BOOTSTRAP_VERSION `c3cc801cfead` → `aaca90ddee7c`** (gen-bootstrap classes[] 20 → 24: `Loc.{Classifier,Scanner,Generate}` after the Diagram block, `REST.Loc` among handlers, `Dispatch` last; second run byte-identical — idempotent). `bootstrap.test.ts` updated for the 24-class shape (counts + name list + drift-check classPaths — test file, not the generated artifact) and green. `pnpm run gen:governance-baseline:check` **exit 0** (51 post-foundation keys allowed incl. `iris_loc_count`); frozen `governance-baseline.ts` git-clean; bare generator NOT run.

**Task 8 — Cross-verification (AC 22.0.12), namespace counter (live `GET /dev/loc`, spec `ExecuteMCPv2.*.cls`, HSCUSTOM) vs `bash cos_loc_counter.sh --csv src/ExecuteMCPv2/`:**

| metric | namespace | disk reference | delta | explanation |
|---|---:|---:|---:|---|
| filesParsed | 44 | 44 | 0 | identical document sets (all 44 disk .cls loaded) |
| totalLines | 16215 | 16171 | **+44** | GetTextAsArray returns a trailing empty array element per document (probe finding #1) → exactly +1 line × 44 docs |
| blankLines | 1413 | 1369 | **+44** | the same 44 trailing empties land in the blank bucket |
| sourceCodeLoc | 8677 | 8677 | 0 | **exact match** |
| sourceCommentLoc | 2463 | 2463 | 0 | **exact match** |
| testCodeLoc | 2997 | 2997 | 0 | **exact match** |
| testCommentLoc | 665 | 665 | 0 | **exact match** |
| codePct | 72.0 | 72.2 | -0.2 | same numerator, +44 denominator |
| sourceCodePct | 53.5 | 53.7 | -0.2 | ditto |
| testCodePct | 18.5 | 18.5 | 0 | rounding coincidence |
| commentPct | 19.3 | 19.3 | 0 | ditto |
| whitespacePct | 8.7 | 8.5 | +0.2 | +44 blanks |

Every code/comment bucket matches EXACTLY; the only deltas are the probe-documented +44 trailing-empty artifact and its percentage knock-on. No storage-section delta arose (no `%Persistent` class in the package — the compiler adds no storage to `%RegisteredObject`/`%Atelier.REST`/`%UnitTest.TestCase` subclasses). **Zero unexplained deltas.** The reference's `/tests/`-path rule and my `%IsA` classification agreed on the full test set (all `Tests/*` classes are TestCase subclasses directly or via `LocFixtureBase`; `LocFixtureChild` caught by path-rule on disk and transitive `%IsA` in-namespace).

Endpoint guard paths verified live over HTTP (lead-smoke readiness, AC 22.0.13 passable): missing `spec` → clean `ERROR #5001: Required parameter 'spec' is missing or empty`; `includeGenerated` false→0 files / true→3 files (438 lines) on the `.int` spec; junk `topN=abc` → clean rejection.

**Tasks 9-10 — docs + full verification:**

- Docs (AC 22.0.14): dev README (Code Metrics Tools table + governance callout "**read, enabled by default**" + `<details>` example + "All 26 tools"), root README (dev 26, suite **100 tools**, ASCII diagram `(26)`, governance-defaults table row "flat read tool — whole tool enabled"), iris-mcp-all README (26/100), `tool_support.md` (heading 26, row 26 `GET /dev/loc`, mix 19·7, Epic 22 governance-defaults note, rollup 26/27 + totals 100/105, ExecuteMCPv2-backed 75→76, dependency prose), `docs/migration-v1-v2.md` (100 ×2, dev 26), `CHANGELOG.md` (2026-07-03 Epic 22 entry with default-state callout + cross-verification result). Counts cross-verified vs `index.test.ts` (26 package = `toHaveLength(26)`; 27 advertised = `toolCount` 27; suite 100 package / 105 advertised).
- Full verification: monorepo `pnpm test` — **12/12 turbo tasks green** (shared 551, dev 346; one transient shared-suite failure under first-run parallel contention did not reproduce on direct rerun or the full turbo rerun); `pnpm lint` 6/6; `pnpm type-check` 12/12. One TS build fix during verification: `loc.test.ts` used the wrong `IrisApiError` constructor arity (message-first vs `(statusCode, errors, originalUrl, message?)`) — corrected. **All 18 ObjectScript test classes verified per-class (Rule #35): 192/192 green, totals matching the 192 `Method Test*` declarations exactly** (Command 16, DiagramCompressor 10, DiagramCorrelator 18, DiagramDedup 9, DiagramEpisodeEdge 3, DiagramEpisode 11, DiagramGenerate 11, DiagramLoader 11, DiagramWriter 13, Global 12, Mapping 9, MappingRoundTrip 1, Setup 5, UnitTest 6, Utils 19, LocClassifier 22, LocScanner 9, LocFacade 7). Package-level `iris_execute_tests` consistently returned a 36-44-row partial snapshot (Rule #35 in action — appears to cap the details page at the first ~3 classes alphabetically); per-class runs are authoritative.

### File List

**New:**
- src/ExecuteMCPv2/Loc/Classifier.cls
- src/ExecuteMCPv2/Loc/Scanner.cls
- src/ExecuteMCPv2/Loc/Generate.cls
- src/ExecuteMCPv2/REST/Loc.cls
- src/ExecuteMCPv2/Tests/LocClassifierTest.cls
- src/ExecuteMCPv2/Tests/LocScannerTest.cls
- src/ExecuteMCPv2/Tests/LocFacadeTest.cls
- src/ExecuteMCPv2/Tests/LocFixtureBase.cls
- src/ExecuteMCPv2/Tests/LocFixtureChild.cls
- packages/iris-dev-mcp/src/tools/loc.ts
- packages/iris-dev-mcp/src/__tests__/loc.test.ts
- packages/iris-dev-mcp/src/__tests__/loc-governance.test.ts

**Modified:**
- src/ExecuteMCPv2/REST/Dispatch.cls (Epic 22 Dev tools route)
- scripts/gen-bootstrap.mjs (classes[] 20 → 24)
- packages/shared/src/bootstrap-classes.ts (REGENERATED only — `c3cc801cfead` → `aaca90ddee7c`)
- packages/shared/src/__tests__/bootstrap.test.ts (24-class expectations + drift-check classPaths)
- packages/iris-dev-mcp/src/tools/index.ts (register iris_loc_count, 25 → 26)
- packages/iris-dev-mcp/src/__tests__/index.test.ts (26/27 + getToolNames)
- packages/iris-dev-mcp/README.md
- README.md
- packages/iris-mcp-all/README.md
- tool_support.md
- docs/migration-v1-v2.md
- CHANGELOG.md
- _bmad-output/implementation-artifacts/sprint-status.yaml (22-0 → review)
- _bmad-output/implementation-artifacts/22-0-loc-counter-tool.md (this file)

**Created and deleted (probe hygiene):**
- src/ExecuteMCPv2/Temp/LocProbe.cls (probe — deleted from IRIS and disk)
- src/ExecuteMCPv2/Temp/LocProbeUncompiled.cls (probe fixture — deleted from IRIS and disk)

## Change Log

- 2026-07-03 — Code review (3-layer + reviewer audit): 0 HIGH; 7 findings auto-fixed inline (CR 22.0-1 MED string-mask backtracking parity + 6 LOW), 2 deferred to deferred-work.md, 9 dismissed with evidence; +4 regression tests (2 OS, 2 TS); BOOTSTRAP_VERSION `aaca90ddee7c` → `919124293f66` (idempotent); post-fix cross-verification all four buckets EXACT at 45 files; all 14 ACs MET, D1–D7 conform. Status → done (lead per-story smoke AC 22.0.13 remains).
- 2026-07-03 — Story 22.0 implemented (Tasks 1-10): Rule #16 probes run and recorded; `ExecuteMCPv2.Loc.*` library + `REST.Loc` endpoint + `iris_loc_count` tool; 38 new ObjectScript tests + 16 new TS tests; BOOTSTRAP_VERSION `c3cc801cfead` → `aaca90ddee7c` (idempotent); governance baseline check exit 0 (frozen file untouched); AC 22.0.12 cross-verification — all code/comment buckets exactly matched the reference tool, +44 total/blank fully explained; docs rolled up with the read/enabled-by-default callout; full monorepo suite + lint + type-check green; 192/192 ObjectScript tests verified per-class. Status → review.
