# Sprint Change Proposal — 2026-07-03

**Trigger:** Stakeholder-initiated scope addition (new feature + retro-directive compliance)
**Author:** Mary (Business Analyst), correct-course session 2026-07-03
**Mode:** Batch review
**Status:** APPROVED 2026-07-03 — all §4 edits applied (note: §4.1 Epic List entry intentionally skipped; the Epic List index stops at Epic 9 by established precedent — Epics 10–21 have full sections only, and Epic 22 follows suit)

---

## 1. Issue Summary

Two independent triggers, deliberately combined into one epic:

**(a) New feature — ObjectScript LOC Counter tool.** The stakeholder owns a working reference implementation (`../ObjectScriptLOCCounter/cos_loc_counter.sh` — bash+AWK, scans a filesystem tree, buckets every line into Blank / Source Code / Source Comment / Test Code / Test Comment) and wants the capability reimplemented **natively in ObjectScript** under `src/ExecuteMCPv2/` and exposed as a new MCP tool on `@iris-mcp/dev`. Technical research is complete ([technical-objectscript-loc-counter-2026-07-03.md](./research/technical-objectscript-loc-counter-2026-07-03.md)) with **all seven architecture decisions (D1–D7) ratified by the stakeholder on 2026-07-03** — this proposal treats them as settled inputs.

**(b) Retro directive — deferred-work ledger must be worked, not re-deferred.** The Epic 21 retrospective closed with a firm Project Lead directive: after three consecutive feature epics (19 → 20 → 21) re-deferring the ledger at each retro-review gate, **the next epic planned WILL include the cleanup batch as in-scope work**. The ledger stands at **14 open items** (11 carried through Epics 18–20 gates + CR 21.0-2 / 21.1-1 / 21.1-2 from Epic 21's reviews) plus one operational carry-over (Epic 20 retro Action #2: rebuild+reload running MCP servers).

**Evidence:** `deferred-work.md` §"Epic 21 retrospective (2026-07-03) — ledger INCLUDED in next epic, not re-deferred"; project-rules.md Epic 21 audit note ("the Project Lead has directed that the next epic to be planned **include** this cleanup batch (not defer again)"); the completed LOC research document with its stakeholder-ratified decision table (§8).

---

## 2. Impact Analysis

### Epic impact
- **No in-flight epic is affected.** Epic 21's two stories and retrospective are complete (`21-0`, `21-1`, `epic-21-retrospective` all `done`). This change **adds Epic 22**; it modifies no existing epic's scope.
- **Housekeeping defect found during analysis:** `sprint-status.yaml` still shows `epic-21: in-progress` although all its stories and the retrospective are `done` and the epic-close commit (`77a6ff9`, "cycle close") exists. Fixed as part of this proposal's sprint-status update.
- **Epic 22 satisfies the standing retro-gate obligation.** Every retro-review gate since Epic 18 has routed the ledger to "a future dedicated cleanup epic." Epic 22's Story 22.1 **is** that destination; the Epic 22 kickoff retro-review gate should route carried items INTO Story 22.1 rather than re-deferring (there is no next deferral target — the directive forbids it).

### Story impact
- Two new stories: **22.0** (`iris_loc_count` feature — stakeholder chose LOC-first ordering) and **22.1** (deferred-work cleanup batch).
- No existing story requires modification.

### Artifact impact
| Artifact | Impact |
|---|---|
| `epics.md` | ADD: Epic 22 section (goal, scope, FRs, 2 stories with ACs) + Epic List entry |
| `prd.md` | ADD: FR130 under a new "Epic 22" heading in the FR addenda section |
| `sprint-status.yaml` | ADD: epic-22 + 22-0 + 22-1 + retrospective entries (backlog); FIX: `epic-21: in-progress` → `done` |
| `deferred-work.md` | ADD: routing note — the 14 open items + Epic 20 retro Action #2 are now in-scope for Story 22.1 (terminal disposition required) |
| `architecture.md` | No change now — the LOC library follows the Epic 21-established library-subpackage pattern (`ExecuteMCPv2.<Sub>.*` riding the existing bootstrap). Tool-count prose updates land with Story 22.0's docs rollup, per the Epic 15/21 precedent |
| UI/UX | N/A — no UI surface in this suite |
| CI/CD, generators | No structural change: `gen-bootstrap.mjs` gains the new class(es) in its ordered array (Rule #24); frozen governance baseline untouched (Rules #23/#25) |

### Technical impact (summary of ratified research)
- **Pattern B wiring** (full ObjectScript REST round trip): new library class(es) + thin handler + Dispatch route + TS tool + `mutates:"read"` + bootstrap regen + `%UnitTest` tests.
- **Verified IRIS APIs** (against local `irislib/` source per Rule #2): `%Library.RoutineMgr:StudioOpenDialog` for one-query enumeration with `ShowGenerated=0` (avoids double-counting compiler-generated `.int` — decision D7); `%Atelier.v1.Utils.TextServices.GetTextAsArray` for source retrieval pre-split into a line array (any document type). One Rule #16 live-probe remains (its `pFlags` semantics) before the story spec freezes.
- **Scoping constraint:** IRIS Web Gateway default REST timeout ≈ 60s → the tool takes a **required document-spec filter** (D2); whole-namespace = explicit `*` with documented risk.

---

## 3. Recommended Approach

**Direct Adjustment — add Epic 22 with two stories.** No rollback (nothing to revert) and no MVP review (the suite shipped its MVP long ago; this is post-publish enhancement flow, identical in shape to Epics 19/20/21 additions).

- **Effort:** Moderate. Story 22.0 is a well-researched, single-tool feature (comparable to Story 17.3 / 21.0 in size — parser library + endpoint + tool + tests). Story 22.1 is a bounded 15-item disposition batch, most items LOW severity with suggested resolutions already recorded.
- **Risk:** Low. All architecture decisions pre-ratified; APIs verified against `irislib/`; both stories strictly additive; frozen baseline untouched.
- **Timeline:** One epic-cycle. Stakeholder chose LOC-first ordering (22.0 → 22.1), accepting the noted risk that cleanup must not slip if the epic is cut short — mitigated by the directive making 22.1 non-optional.

---

## 4. Detailed Change Proposals

### 4.1 `epics.md` — Epic List addition

Append to the `## Epic List` section:

```markdown
### Epic 22: ObjectScript LOC Counter & Deferred-Work Cleanup (added 2026-07-03)
A developer can compute lines-of-code metrics (blank / source code / source comments / test code / test comments) for ObjectScript documents in a namespace via a new `iris_loc_count` read tool — a native-ObjectScript reimplementation of the stakeholder-owned reference LOC counter. The epic also executes the Epic 21 retro directive: every open deferred-work ledger item reaches a terminal disposition (resolved, closed-with-evidence, or closed-by-decision — no re-deferral).
**FRs covered:** FR130
**NFRs addressed:** NFR1, NFR9, NFR10, NFR11
```

### 4.2 `epics.md` — new Epic 22 section (appended after Epic 21)

```markdown
## Epic 22: ObjectScript LOC Counter & Deferred-Work Cleanup (added 2026-07-03)

**Goal**: Give developers namespace-resident lines-of-code metrics — blank / source code / source comment / test code / test comment buckets with percentages and a top-N largest-documents breakdown — through a single read tool (`iris_loc_count`, name confirmed in dev), reimplementing the stakeholder-owned reference tool (`../ObjectScriptLOCCounter/cos_loc_counter.sh`) natively in ObjectScript. AND burn down the deferred-work ledger per the Epic 21 retro directive: all 14 open items + the Epic 20 operational carry-over reach terminal disposition. See [sprint-change-proposal-2026-07-03.md](./sprint-change-proposal-2026-07-03.md); binding research + ratified decisions D1–D7 in [research/technical-objectscript-loc-counter-2026-07-03.md](./research/technical-objectscript-loc-counter-2026-07-03.md).

**Scope**: One new read tool on `@iris-mcp/dev` backed by a new ObjectScript LOC library under `src/ExecuteMCPv2/` (Epic 21-style library subpackage riding the existing bootstrap — no new package mappings, no new npm package) + thin REST endpoint on Dispatch. **Namespace-resident code only** (decision D1): enumeration via `%Library.RoutineMgr:StudioOpenDialog` (verified `irislib/%Library/RoutineMgr.cls:1082-1114`), source via `%Atelier.v1.Utils.TextServices.GetTextAsArray` (verified `irislib/%Atelier/v1/Utils/TextServices.cls:15`). **Required document-spec filter** (decision D2 — 60s gateway-timeout risk); generated documents excluded by default (decision D7). Reference tool consulted openly (stakeholder-owned, offered as reference — no clean-room constraint, unlike Epic 21 G2); parity is with its *classification semantics*, upgraded where ObjectScript introspection is strictly more reliable (decision D3). Story 22.1 executes the ledger cleanup. **BOOTSTRAP_VERSION bump in each ObjectScript-touching story** (Rule #24). **Strictly additive** — no existing tool/schema/output changes; new governance key `mutates:"read"` → default-enabled (Rule #28); frozen baseline `1e62c5ad5bf7` untouched (Rules #23/#25).

**Functional Requirements (new)**: FR130.

**Stories**:
- 22.0 LOC counter library + REST endpoint + `iris_loc_count` tool + bootstrap bump + docs rollup
- 22.1 Deferred-work ledger burn-down (14 items + Epic 20 retro Action #2 → terminal dispositions) + bootstrap bump if ObjectScript touched

**Out of scope (deferred)**:
- **Filesystem-path scan mode** — namespace-resident code only (D1); auditing an unloaded git checkout is the reference bash tool's job.
- **Background-job / async scan** — synchronous with required scoping (D2); revisit only if real timeout reports arrive.
- **Full per-document detail / pagination** — aggregate + capped top-N only (D5).
- **Embedded-SQL / XData / Storage language-aware sub-parsing** — those lines count as code (deliberate reference-tool carry-over).
- **Multi-namespace rollup in one call** — one namespace per call, consistent with the suite.

### Story 22.0: LOC Counter Library + Endpoint + Tool

**As a** developer, **I want** a tool that counts lines of code in my namespace's ObjectScript documents — separating blank lines, comments, source code, and test code — **so that** I can track codebase size, comment density, and test footprint without exporting source to disk.

**Acceptance Criteria**:
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
- **AC 22.0.13** — Lead per-story smoke (Rules #22/#26 + **Rule #34 — cross-namespace**): live against HSCUSTOM AND at least one second namespace with different characteristics (e.g. SADEMO); verify the required-spec rejection (missing/empty `spec` refused cleanly), a scoped count returns plausible buckets summing to totalLines, `includeGenerated:true` visibly changes counts, and top-N is capped. If no second populated namespace is available, record that as explicit residual risk.
- **AC 22.0.14** — Docs rollup (Rule #30): `packages/iris-dev-mcp/README.md` (tool section + example), root `README.md` + `packages/iris-mcp-all/README.md` (counts + mention), `tool_support.md` (new row; dev 25→26; totals +1), `docs/migration-v1-v2.md` count refresh, `CHANGELOG.md` entry. **Default-state callout: `iris_loc_count` is a read, enabled by default.** Counts cross-verified vs `index.test.ts`.

**Implementation Notes**:
- Read the research doc §§3–7 in full before implementation — the API choices, the D1–D7 decisions, and the reference-parity table are binding.
- The reference implementation `../ObjectScriptLOCCounter/cos_loc_counter.sh` MAY be consulted directly (stakeholder-owned and offered as reference — no Epic 21-style clean-room constraint); its AWK state machine is the parity model for AC 22.0.4's classifier.
- ObjectScript conventions: `t`/`p` prefixes, try/catch with `%Status`, no argumented QUIT inside try/catch, `%OnNew(initvalue)` in test classes, triple-`$$$` macros; classes on disk first, deploy via `iris_doc_load` with glob-prefixed paths (Rule #17: `src/**/*.cls`); compile via `compile_objectscript_*` tools.
- Per-document classification lookups (`%IsA`, `CompiledMethod.Language`) are once-per-class/method — cheap next to the line scan; do not regex the signature line for language.
- Keep the classifier a pure function of (line array + per-doc metadata) so fixtures drive it without REST.

### Story 22.1: Deferred-Work Ledger Burn-Down

**As a** maintainer, **I want** every open deferred-work item driven to a terminal disposition, **so that** the ledger that three consecutive epics re-deferred is finally cleared and future retro gates start from zero.

**Acceptance Criteria**:
- **AC 22.1.1** — **Terminal disposition for every item; re-deferral is NOT an allowed outcome** (Epic 21 retro directive). Each of the 14 open ledger items + Epic 20 retro Action #2 lands in exactly one of: **resolved** (code/test/doc fix, merged), **closed-with-evidence** (live probe or measurement demonstrates no action needed — evidence recorded), or **closed-by-decision** (stakeholder explicitly accepts the behavior — decision recorded). A disposition table is recorded in the story file and mirrored into `deferred-work.md`.
- **AC 22.1.2** — Expected-resolve subset (code fixes, each strictly additive with tests): **CR 16.0-1** (extract the generator's key-derivation into a shared helper imported by both `gen-governance-baseline.mjs --check` and `governance.test.ts`); **CR 16.0-2** (unit test for the vanished-key exit-1 path against the extracted helper); **CR 16.2-2** (Zod `.min()`/`.max()` on `percentFull`/`targetSize`/`initialSize`); **CR 18.0-1 remaining half** (add is-valid-Ens-host check — e.g. `%IsA("Ens.Host")` + non-abstract — to the `add` className guard); **CR 20.0-1** (per-action honoring of `force`/`timeout` on `iris_production_control`: reject-with-clear-error or document, dev's call recorded); **CR 21.1-2** (Src=Dst self-call depth-stack guard + boundary fixture).
- **AC 22.1.3** — Verify-then-dispose subset (Rule #16 live probe/measurement first, then fix or close-with-evidence): **CR 18.0-2** (probe `(Production,Name)` index collation; fix only if case-sensitive-and-undesirable); **CR 16.3-device** (probe `StartTask` 4th `Device` arg; wire it or drop `device` from the schema); **CR 16.3-thaw-password** (freeze/thaw round-trip on a disposable target; add redaction only if the password is observed in error text); **CR 16.1-3** (measure `ProcessGet` latency; fix only if material); **CR 17.1-1** (live-HTTP `||`-delimiter rejection assertion — satisfiable inside this story's smoke); **CR 21.0-2** (correlator index maps OR a measured demonstration that default `maxRows=2000` keeps worst-case acceptable, with the cap documented).
- **AC 22.1.4** — **CR 21.1-1** (episode rule-A pairloop asymmetry): stakeholder decision point — either extend rule A to pairloops (unwind on `tEv.Req.Src`, fixtures for both groupings) or codify the composite-episode interpretation into proposal-§6.3 text; the choice is recorded and implemented/documented accordingly.
- **AC 22.1.5** — **AI#4** (`iris_backup_manage` restore): terminally closed as won't-fix (IRIS restore is interactive; no scriptable classmethod — re-verified once against current `irissys/Backup/General.cls`), with the handler's clear-rejection behavior confirmed still in place. **Epic 20 retro Action #2**: verify the running MCP servers carry the post-`7aca352` build (or rebuild+reload now); operational close recorded.
- **AC 22.1.6** — If any ObjectScript handler is modified, `bootstrap-classes.ts` regenerated + `BOOTSTRAP_VERSION` moved in this story (Rule #24), `bootstrap.test.ts` green; governance baseline stays frozen `1e62c5ad5bf7`, `gen:governance-baseline:check` exit 0 (Rules #23/#25); full monorepo suite green; lint + type-check clean.
- **AC 22.1.7** — `deferred-work.md` closes at **zero open carried items**. Only items newly surfaced by Epic 22's own code reviews may remain open, each explicitly listed in a fresh section.
- **AC 22.1.8** — Lead smoke (Rules #22/#26): live-HTTP assertions for the guarded-path items fixed here (at minimum: `||`-delimiter rejection per CR 17.1-1; abstract/`%`-class host `add` rejection per CR 18.0-1) — each rejection changes nothing server-side.

**Implementation Notes**:
- Open the Epic 22 retro-review gate against the `deferred-work.md` "Epic 21 retrospective (2026-07-03)" note — the item list there is authoritative; do not re-triage from scratch.
- Probe-first discipline (Rule #16): several items' "suggested resolutions" embed unverified API claims (StartTask device arg, index collation, ExternalThaw error text) — probe before coding.
- Batch ObjectScript edits where sensible to minimize bootstrap churn, but the version still moves in-story per change (Rule #24 — no deferred bump).
- CR 21.1-1's decision point (AC 22.1.4) should be put to the stakeholder early in the story, not discovered at the end.
```

### 4.3 `prd.md` — FR addendum

Append after the FR129 block:

```markdown
**Epic 22 — ObjectScript LOC Counter & Deferred-Work Cleanup (added 2026-07-03)**
- FR130: Developer can compute lines-of-code metrics for the ObjectScript documents in a namespace via a new read tool (proposed name `iris_loc_count`) on `@iris-mcp/dev`. Input is a required document-spec filter (e.g. `MyPkg.*.cls,*.mac`; explicit `*` for whole-namespace with a documented timeout caveat), plus `namespace`, `includeGenerated` (default false — compiler-generated documents are excluded to avoid double-counting), `topN`, and `format` options. Every line of every matched document (CLS/MAC/INT/INC) is bucketed into exactly one of: blank, source code, source comment, test code, test comment — honoring all ObjectScript comment syntaxes (`//`, `///`, `;`, `#;`, `##;`, stateful `/* ... */`; preprocessor directives count as code; `#` comments inside `[ Language = python ]` method bodies), masking string literals before marker detection, and classifying test scope via transitive `%UnitTest.TestCase` inheritance plus `Test*`/lifecycle method-level detection. Output is aggregate metrics with percentages plus a capped top-N largest-documents breakdown (structured object + human-readable summary/CSV text). The counting engine is a native ObjectScript reimplementation of the stakeholder-owned reference tool (`../ObjectScriptLOCCounter/`), living under `src/ExecuteMCPv2/` and riding the existing bootstrap; the tool is classified `mutates: "read"` (enabled by default) and is strictly additive. See [sprint-change-proposal-2026-07-03.md](./sprint-change-proposal-2026-07-03.md).
```

### 4.4 `sprint-status.yaml` — status updates

```yaml
  # (fix) Epic 21 fully closed 2026-07-03 — all stories + retro done, cycle-close commit 77a6ff9
  epic-21: done            # was: in-progress

  # Epic 22: ObjectScript LOC Counter & Deferred-Work Cleanup (iris-dev-mcp + suite-wide hardening)
  # Added 2026-07-03 via bmad-correct-course. See sprint-change-proposal-2026-07-03.md.
  # 22.0: native-ObjectScript LOC counter (research: technical-objectscript-loc-counter-2026-07-03.md, decisions D1–D7 ratified).
  #       New LOC library under src/ExecuteMCPv2/ + thin REST endpoint + iris_loc_count on @iris-mcp/dev.
  #       ObjectScript touched → BOOTSTRAP_VERSION bump (Rule #24). New key mutates:read → default-enabled (Rule #28); baseline 1e62c5ad5bf7 untouched.
  # 22.1: deferred-work ledger burn-down — 14 items + Epic 20 retro Action #2 → TERMINAL dispositions (Epic 21 retro directive: no re-deferral).
  epic-22: backlog
  22-0-loc-counter-tool: backlog
  22-1-deferred-work-burn-down: backlog
  epic-22-retrospective: backlog
```

### 4.5 `deferred-work.md` — routing note

Append at the end:

```markdown
## Epic 22 planned (2026-07-03) — ledger routed to Story 22.1 for TERMINAL disposition

Per the Epic 21 retro directive, Epic 22 (sprint-change-proposal-2026-07-03.md) includes the ledger as in-scope work: **Story 22.1** must drive all 14 open items (CR 16.0-1, CR 16.0-2, CR 16.1-3, CR 16.2-2, CR 16.3-device, CR 16.3-thaw-password, CR 17.1-1, CR 18.0-1 remaining half, CR 18.0-2, AI#4, CR 20.0-1, CR 21.0-2, CR 21.1-1, CR 21.1-2) plus Epic 20 retro Action #2 to a terminal disposition — resolved, closed-with-evidence, or closed-by-decision. **Re-deferral is not an allowed outcome.** The Epic 22 retro-review gate opens against this note.
```

---

## 5. Implementation Handoff

**Scope classification: Moderate** — backlog reorganization (new epic + stories) executed through the established `/epic-cycle` machinery; no fundamental replan.

| Recipient | Responsibility |
|---|---|
| Analyst (this session, on approval) | Apply the §4 edits to `epics.md`, `prd.md`, `sprint-status.yaml`, `deferred-work.md` |
| Scrum Master / `/epic-cycle 22` | Story creation for 22.0/22.1 from the Epic 22 ACs; the kickoff retro-review gate routes ledger items INTO 22.1 (no re-defer) |
| Dev agent (per story) | Story 22.0: Rule #16 live-probe of `GetTextAsArray` `pFlags` BEFORE freezing the loader; Story 22.1: probe-first on the AC 22.1.3 items |
| Project Lead | Per-story smokes (Rules #22/#26/#34 — cross-namespace for 22.0); the CR 21.1-1 decision point (AC 22.1.4); final epic close |

**Success criteria:**
1. `iris_loc_count` live on `@iris-mcp/dev` (25→26 tools), buckets summing to totals, cross-verified against the reference tool per AC 22.0.12, docs rolled up with the default-state callout.
2. `deferred-work.md` at zero open carried items; every disposition evidenced.
3. Frozen baseline `1e62c5ad5bf7` untouched; bootstrap hash moved per ObjectScript-touching story; full monorepo green throughout.

---

## 6. Approval

- [x] Stakeholder approval to apply §4 edits — **approved 2026-07-03** (session verbal "yes"; edits applied same session: epics.md Epic 22 section, prd.md FR130, sprint-status.yaml epic-22 entries + epic-21 status fix, deferred-work.md routing note)
