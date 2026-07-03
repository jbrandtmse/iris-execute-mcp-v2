---
stepsCompleted: [1]
inputDocuments: ['../../../../ObjectScriptLOCCounter/cos_loc_counter.sh', '../../../../ObjectScriptLOCCounter/README.md']
workflowType: 'research'
lastStep: 1
research_type: 'technical'
research_topic: 'Native ObjectScript Lines-of-Code Counter tool for the iris-execute-mcp-v2 suite'
research_goals: 'Determine architecture and feasibility to reimplement the cos_loc_counter.sh reference bash/awk tool as a native ObjectScript MCP tool (iris_loc_count) under src/ExecuteMCPv2/, to feed a /bmad-correct-course change proposal'
user_name: 'Developer'
date: '2026-07-03'
web_research_enabled: true
source_verification: true
---

# Research Report: ObjectScript Lines-of-Code Counter — Native IRIS Tool

**Date:** 2026-07-03
**Author:** Mary (Business Analyst)
**Research Type:** Technical

---

## 1. Executive Summary

- The reference implementation (`../ObjectScriptLOCCounter/cos_loc_counter.sh`, ~280 lines of bash+AWK) scans a **git working-directory filesystem tree** for `.cls/.mac/.int/.inc` files and buckets every line into Blank / Source Code / Source Comment / Test Code / Test Comment using a stateful AWK parser.
- **The single biggest architectural decision** is that this new tool cannot simply port that model 1:1: every other dev-mcp tool (`iris_doc_list`, `iris_doc_get`, `iris_package_list`, `iris_doc_search`) treats **the connected IRIS namespace** — not a local git checkout — as the source of truth, because the MCP server and the IRIS backend are not guaranteed to share a filesystem. **Recommendation: target the IRIS namespace/package (compiled+loaded artifacts), not an arbitrary filesystem path**, for consistency with the rest of the suite. This is flagged as Decision D1 below and should be explicitly ratified in the correct-course.
- ObjectScript has native APIs that make several parts of the bash parser's heuristics **unnecessary or more robust** (all verified against local `irislib/` source per Rule #2): `%Library.RoutineMgr:StudioOpenDialog` for one-query enumeration of CLS/MAC/INT/INC with a `ShowGenerated=0` flag (avoiding double-counting compiler-generated `.int` — a hazard the filesystem tool never faced), `%Atelier.v1.Utils.TextServices.GetTextAsArray()` for source retrieval pre-split into a line array (any document type), `$CLASSMETHOD(class,"%IsA","%UnitTest.TestCase")` for transitive test-class detection (handles custom intermediate base classes the bash regex cannot), and `%Dictionary.CompiledMethod:Language` for exact per-method language detection (replacing the bash tool's `[ Language = python ]` regex). These are genuine upgrades over the reference, not just a port.
- **Performance/timeout is a real constraint**: default IRIS Web Gateway REST timeout is ~60s. A single unscoped "scan the whole namespace" call risks timing out on large codebases. Recommend package/class-filtered scope (mirroring `iris_doc_list`'s category/type filters) as the default usage pattern, not an afterthought.
- This is a **new ObjectScript REST handler + new TS tool** (Pattern B in the suite's existing two wiring patterns), requiring: a new `.cls` handler, a `Dispatch.cls` route, a `mutates: "read"` governance classification (mandatory even though read-only, per Rule #28), a `gen:bootstrap` regen, and a new `%UnitTest.TestCase` class under `src/ExecuteMCPv2/Tests/`.
- No existing ObjectScript utility class in this repo does file/source scanning or LOC-style analysis — this is net-new capability, not an extension of anything existing.

---

## 2. Reference Implementation Recap

`cos_loc_counter.sh` (POSIX bash + single-pass AWK, no external deps):

| Bucket | Rule |
|---|---|
| Blank | whitespace-only line (`^[ \t]*$`, tolerates `\r`) |
| Source Comment | leading (post-whitespace) `//`, `///`, `;`, `#;`/`##;` — NOT `#Define`/`#Dim`/`#IfDef` etc.; also `/* ... */` stateful across lines; also `#` inside `[ Language = python ]` method bodies |
| Source Code | everything else, non-test scope |
| Test Code / Test Comment | same rules, but inside a file-level `%UnitTest.TestCase`/`%UnitTest.Case` subclass (grep pre-pass, so leading `///` doc comments above `Class` line are also test-bucketed), a conventional `/tests/`, `/Tests/`, `/UnitTest/`, `/unit_tests/` directory, or a `Test*`/lifecycle-named (`OnBeforeAllTests` etc.) `Method`/`ClassMethod` inside an otherwise-non-test class, scoped via brace-depth tracking |

Output: ASCII table or `--csv`, with Code/Source/Test/Comment/Whitespace percentages. No package/directory filtering, no per-file breakdown, no JSON output, synchronous single-process execution assumed to run against a local checkout in seconds.

---

## 3. Critical Architecture Decision — Scan Target Model

The bash tool's mental model is "a directory of files on disk." The MCP suite's mental model (confirmed via all four existing dev-mcp doc tools) is "the class/routine dictionary of a connected IRIS namespace," reached over HTTP — the MCP server process has no guaranteed filesystem proximity to the IRIS instance it's driving.

**Recommendation:** `iris_loc_count` should enumerate and read source from the **IRIS namespace's dictionary**, not a filesystem path. The exact APIs were **verified against the local `irislib/` system-class exports** (per Rule #2 — read the IRIS source before wrapping), which corrected two Perplexity research claims:

- **Enumeration (all document types, one query)**: `%Library.RoutineMgr:StudioOpenDialog` — verified at `irislib/%Library/RoutineMgr.cls:1082-1114`. Takes a spec pattern (e.g. `MyPkg.*.cls,*.mac,*.inc`), covers CLS/MAC/INT/INC (and more) in a single query, supports `Flat=1`, a SQL `Filter` clause, and — critically — a **`ShowGenerated` flag**. `ShowGenerated=0` excludes items generated from other items (e.g. `.int` code produced by class compilation). This is the same query family the Atelier `docnames` endpoint is built on, and it resolves a hazard the filesystem-based reference tool never faced: in a namespace-resident scan, **generated `.int` routines would double-count LOC** already counted in their source `.cls`/`.mac`. Default should be `ShowGenerated=0` (see D7).
- **Source text retrieval (any document type, pre-split into lines)**: `%Atelier.v1.Utils.TextServices.GetTextAsArray(pFullName, pFlags, .pTextArray)` — verified at `irislib/%Atelier/v1/Utils/TextServices.cls:15`. Takes a full document name (class, routine, OR include file), returns the source as an integer-subscripted line array with the line count at subscript 0. This eliminates the stream/`ReadLine()` plumbing entirely — the parser can iterate `pTextArray(1)..pTextArray(n)` directly. (Fallbacks if ever needed: `%Compiler.UDL.TextServices.GetTextAsString/AsStream/AsArray` — classes only, verified at `irislib/%Compiler/UDL/TextServices.cls:98-227`; note the Perplexity result claiming `GetTextAsString` doesn't exist was **wrong** — it exists at line 170. `$system.OBJ.ExportUDL(name,.stream)` remains a further alternative.)
- **Live-probe caveat still applies** (Rule #16): `GetTextAsArray` delegates to `$$GetTextAsArray^%apiSRC`, so confirm behavior (especially `pFlags` semantics and storage-section inclusion) against the live instance via a disposable probe class before the story spec freezes the API choice.

This is a genuine scope change from the reference tool (namespace-scoped vs. filesystem-scoped) and should be presented as an explicit decision, not silently assumed, since it changes what "the codebase" means for this tool (only code that is loaded/compiled into the target namespace is visible — a stale or not-yet-loaded `.cls` on disk would not be counted). Given the whole suite already treats the namespace as ground truth, this is very likely the right call, but it's a real behavior difference worth calling out to the stakeholder.

---

## 4. Native ObjectScript Parsing Engine Design

### 4.1 Line iteration
Iterate the integer-subscripted line array returned by `%Atelier.v1.Utils.TextServices.GetTextAsArray` (`pTextArray(0)` = line count, `pTextArray(1)..(n)` = lines) — no stream handling needed. The per-line state machine below is source-agnostic either way.

### 4.2 String-literal stripping (must happen before comment-marker detection)
ObjectScript strings are `"..."` with `""` as the escaped-quote sequence. A manual character scan (mask string contents with spaces, preserving markers like `//` `/*` `;` `#;` from ever being detected inside a literal) is more reliable here than regex, per the researched guidance — this mirrors the bash tool's `gsub(/"([^"]|"")*"/, "\"\"", s)` step and should be ported faithfully.

### 4.3 Single-line comment / block-comment state machine
Direct port of the bash tool's logic is appropriate here — it's already correct and well-tested conceptually:
- Leading-token check via `%Regex.Matcher` (ICU regex, supports the same `^[ \t]*(//|;|#;|##;|///)` pattern) or manual `$Extract`/`$Piece` scanning.
- `#Define`/`#Dim`/`#IfDef`/etc. must NOT match as comments — only bare `#;`/`##;`.
- `/* ... */` stateful across lines: an `inBlockComment` flag, entered/exited per the bash tool's same-line-open-and-close handling.

### 4.4 Test detection — recommended upgrade over the reference

| Bash tool (text heuristic) | Native ObjectScript (introspection) | Why it's better |
|---|---|---|
| `grep -lE '^Class.*Extends.*%UnitTest\.(Test)?Case'` pre-pass | `$CLASSMETHOD(className, "%IsA", "%UnitTest.TestCase")` (or `%Dictionary.CompiledClass` open + walk `Super`) | Handles **transitive** inheritance through a project's own intermediate base class (e.g., `MyApp.Tests.BaseCase extends %UnitTest.TestCase`, then every concrete test `extends MyApp.Tests.BaseCase`) — the bash regex only matches a direct `Extends...%UnitTest` mention and would silently miss this common pattern. |
| Method signature regex for `Test*`/lifecycle names | Same name-prefix check (`Test*`, `OnBeforeAllTests`, etc.) — text-based check on the method name is fine and simple; no dictionary API adds value here beyond what regex already gives. | Parity is sufficient; no upgrade needed. |
| Method signature regex `\[.*Language[ \t]*=[ \t]*python.*\]` | `%Dictionary.CompiledMethod.%OpenId(className_"||"_methodName).Language` (or open the `%Dictionary.MethodDefinition`) | Exact, compiler-verified language classification instead of an attribute-clause regex that could be fooled by formatting variance (multi-line `[ ... ]` clauses, extra keywords). |

Recommendation: **keep the bash tool's brace-depth / method-boundary scanning** (still needed to know which raw source *lines* belong to which method for LOC purposes — the dictionary doesn't hand you line ranges), but **use the dictionary lookups to make the is-test-class / is-python-method *classification* decisions**, rather than re-deriving them from regex on the signature line. This is a one-time-per-class and one-lookup-per-method cost, cheap relative to the line-by-line scan itself.

### 4.5 XData / Storage sections
No special-casing — carry the bash tool's implicit behavior forward unchanged: braces and lines inside `XData`/`Storage` blocks are counted as ordinary source code (or source comment, if they happen to contain `//`-prefixed lines, which is rare and acceptable noise). This matches the Gemini research's own recommendation and avoids scope creep; note it as an explicit, deliberate carry-over rather than an oversight.

---

## 5. Suite Wiring Plan (confirmed via live repo exploration)

This is **Pattern B** (full ObjectScript REST round-trip), matching `iris_default_settings_manage`'s wiring shape:

1. **New ObjectScript handler** — e.g. `ExecuteMCPv2.REST.Quality.cls` (or `.Metrics.cls`) with a `ClassMethod LocCount()` following the namespace save/restore (Rule re: `%SYS` switching if needed — likely not needed here, stays in the target namespace), single-`RenderResponseBody`-per-request, and `SanitizeError`-wrapped error path conventions already established in every other handler (Rules #7–#9, #33).
2. **Dispatch route** — new `<Route Url="/dev/loccount" Method="POST" Call="ExecuteMCPv2.REST.Quality:LocCount" />` (or similar) in `src/ExecuteMCPv2/REST/Dispatch.cls`.
3. **New TS tool** — `packages/iris-dev-mcp/src/tools/loc.ts`, exporting `locCountTool` (`name: "iris_loc_count"`), added to `packages/iris-dev-mcp/src/tools/index.ts`'s `tools` array. Zod schema should take namespace + package-prefix/class-list filter (see §6), matching the `scope: "NS"` convention.
4. **Governance** — single `mutates: "read"` scalar classification on the tool definition (Rule #28: mandatory even for a pure read, or `assertGovernanceClassification` throws at registration). Resolves to default-ENABLED via `defaultSeed`. No changes needed to the frozen baseline (`packages/shared/src/governance-baseline.ts`, hash `1e62c5ad5bf7`) — this is a new key, expected to sit outside the frozen set per Rule #23.
5. **Bootstrap regen** — add the new `.cls` to `scripts/gen-bootstrap.mjs`'s ordered `classes[]` array (before `Dispatch.cls`, which must stay last), then run `gen:bootstrap` and record the `BOOTSTRAP_VERSION` from→to (Rule #24 — per-story regen, not deferred to a closing story).
6. **Test class** — `src/ExecuteMCPv2/Tests/QualityTest.cls` (or matching the chosen handler name), `%UnitTest.TestCase` subclass, `Method Test*` naming, `%OnNew` forwarding `initvalue` (project testing rules).
7. **TS tests** — `packages/iris-dev-mcp/src/__tests__/loc.test.ts` (unit, mocked `ctx.http`), optionally `loc-governance.test.ts` mirroring the `sqlAnalyze` precedent; update `index.test.ts`/`tools.integration.test.ts` tool-count assertions (this is a package-array tool, so the count DOES change, per the Rule #31 distinction between package tools and framework tools).

---

## 6. Performance & Scoping Design

Default IRIS Web Gateway "Server Response Timeout" is **60 seconds** by default; a synchronous REST handler that CPU-loops over an unscoped namespace risks a gateway timeout on any codebase of meaningful size (this repo's own `src/ExecuteMCPv2` tree alone is dozens of files; a customer's full `HSCUSTOM` namespace could be thousands).

**Recommendation:**
- Require or strongly default to a **package-prefix or explicit class/routine-list filter** (mirrors `iris_doc_list`'s category/type filtering), so a typical call scans tens-to-low-hundreds of documents, not an entire namespace.
- If a genuinely unscoped "whole namespace" scan is wanted as a feature, treat it as a stretch goal requiring either (a) a documented risk/timeout-tuning note, or (b) a background-job + status-polling pattern (the general IRIS best practice for long CPU-bound REST work) — do **not** silently attempt an unscoped scan synchronously as the MVP default.

---

## 7. Output Shape

The MCP tool's `structuredContent` must be a JSON **object**, not an array (established project convention — `structuredContent` must be object not array; no `.refine()` on Zod schemas). The bash tool's ASCII-table/CSV output are presentation formats layered on top of the same metrics — port the metrics object (`filesParsed`, `totalLines`, `blankLines`, `sourceCodeLoc`, `sourceCommentLoc`, `testCodeLoc`, `testCommentLoc`, plus derived percentages) as the tool's structured return, and optionally support a `format` param (`summary` default / `csv`) for human-readable rendering in the text content block, for parity with the reference tool's `--csv` flag.

**Scope-creep flag (not required for parity, worth deciding explicitly):** the bash tool only emits an aggregate total. A per-class/per-routine breakdown (to find the "largest" or most comment-sparse files) would be a natural and valuable addition given this tool now runs inside the same system as the code it's measuring, but it's an ADD, not a port — call this out as an optional stretch item so the correct-course scopes it deliberately rather than by omission.

---

## 8. Decisions (ratified by stakeholder, 2026-07-03)

D1, D2, and D5 were put to the stakeholder explicitly; D3, D4, D6, D7 carried the uncontroversial recommendation. **All seven are now RESOLVED** — the correct-course should treat them as settled inputs, not open questions.

| # | Decision | Resolution | Status |
|---|---|---|---|
| D1 | Scan target | **Namespace only** — enumerate via `StudioOpenDialog`, read via `GetTextAsArray`; consistent with every other dev-mcp tool. No filesystem-path mode. Code not loaded into the namespace is out of scope by design. | ✅ Stakeholder-ratified |
| D2 | Scope filter vs. 60s REST timeout | **Required scope filter** — caller must pass a package-prefix / doc-name spec (e.g. `ExecuteMCPv2.*.cls,*.mac`). Whole-namespace = caller passes `*` explicitly and accepts the risk (documented in the tool description). No background-job machinery in MVP. | ✅ Stakeholder-ratified |
| D3 | Test-class/test-method detection engine | **Hybrid**: keep line-level brace-depth scanning (needed for LOC bucketing), resolve is-test-class via `%IsA` and is-python-method via `%Dictionary.CompiledMethod.Language` — strict reliability upgrade over the bash regex | ✅ Resolved (default) |
| D4 | Output shape | Structured JSON object (aggregate metrics) as `structuredContent`; optional `format` param for CSV/summary text rendering, mirroring the bash tool's `--csv` | ✅ Resolved (default) |
| D5 | Per-document breakdown | **Aggregate + top-N breakdown** — aggregate totals plus an optional capped "top N largest documents" list (e.g. 20) in the response; cheap since the scan already iterates per-document, keeps response size bounded | ✅ Stakeholder-ratified |
| D6 | Governance classification | `mutates: "read"` (scalar; mandatory per Rule #28, resolves default-enabled) | ✅ Resolved (default) |
| D7 | Generated-code handling (`.int` from class/`.mac` compilation) | **Exclude by default** via `ShowGenerated=0`; optionally expose an `includeGenerated` param | ✅ Resolved (default) |

---

## 9. Sources

1. `../ObjectScriptLOCCounter/cos_loc_counter.sh` and `README.md` — reference implementation (local, read directly).
2. InterSystems docs — `%Stream.FileCharacter`, `%Stream.Object` (`ReadLine`/`AtEnd`): https://docs.intersystems.com/irislatest/csp/documatic/%25CSP.Documatic.cls?LIBRARY=%25SYS&CLASSNAME=%25Stream.FileCharacter
3. InterSystems docs — `%Regex.Matcher` (ICU regex): https://docs.intersystems.com/irisforhealthlatest/csp/documatic/%25CSP.Documatic.cls?LIBRARY=%25SYS&CLASSNAME=%25Regex.Matcher
4. InterSystems docs — pattern-match / `$MATCH` / `$LOCATE` regex forms: https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_regex , https://docs.intersystems.com/irislatest/csp/docbook/DocBook.UI.Page.cls?KEY=RCOS_fmatch
5. InterSystems docs — `%Library.Routine` (routine enumeration by namespace/type/prefix): https://docs.intersystems.com/irislatest/csp/documatic/%25CSP.Documatic.cls?LIBRARY=%25SYS&CLASSNAME=%25Library.Routine
6. Community — `$system.OBJ.Export`/`ExportUDL` usage for classes and routines: https://community.intersystems.com/post/hide-or-make-routines-binary
7. Community/docs — Web Gateway "Server Response Timeout" default (~60s) and long-running-request guidance: https://community.intersystems.com/post/description-each-timeout-value-can-be-set-default-parameter-web-gatewaycsp-gateway-management
8. Local repo exploration (this session) — `packages/iris-dev-mcp/src/tools/*.ts`, `packages/iris-interop-mcp/src/tools/defaultSettings.ts`, `src/ExecuteMCPv2/REST/Interop.cls`, `src/ExecuteMCPv2/REST/Dispatch.cls`, `packages/shared/src/governance.ts` & `governance-baseline.ts`, `scripts/gen-bootstrap.mjs`, `src/ExecuteMCPv2/Tests/*` — for the end-to-end tool-wiring pattern.
9. `.claude/rules/project-rules.md` — Rules #7–#9, #16, #18, #23–#25, #28, #31, #33 (namespace/error-handling conventions, live-probe-before-trust, generated-file discipline, frozen governance baseline, mandatory classification for reads, package-vs-framework tool counting, `SanitizeError` caret-stripping).
10. Local `irislib/` system-class source (verified per Rule #2, superseding conflicting Perplexity claims): `irislib/%Library/RoutineMgr.cls` (StudioOpenDialog query, ShowGenerated flag), `irislib/%Atelier/v1/Utils/TextServices.cls` (GetTextAsArray — any doc type, line-array output), `irislib/%Compiler/UDL/TextServices.cls` (GetTextAsString/AsStream/AsArray — classes only).

---

## Research Overview

This report was compiled via: (a) direct reading of the reference bash/AWK implementation and its README; (b) a live repo-exploration subagent tracing the exact end-to-end wiring of a comparable recent tool (`iris_default_settings_manage`) through TS tool definition → ObjectScript REST handler → Dispatch route → governance classification → bootstrap regeneration → test conventions; (c) three targeted Perplexity research queries covering native ObjectScript file/stream I/O and regex APIs, UDL source-export APIs, and routine enumeration APIs; and (d) a targeted query on IRIS REST request timeout behavior to surface the scoping/performance design constraint. No blocking ambiguities remain for a correct-course write-up, though several architecture decisions (§8) are explicitly flagged as needing stakeholder ratification rather than silent assumption, per this project's established research-to-course-correction pattern (see `mcp-tool-expansion-gap-analysis-2026-06-15.md` for the precedent format).
