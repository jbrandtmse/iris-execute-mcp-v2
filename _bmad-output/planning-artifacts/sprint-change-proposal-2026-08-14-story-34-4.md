# Sprint Change Proposal — Story 34.4 (Epic 34 re-open)

**Date:** 2026-08-14 · **Raised by:** Project Lead · **Facilitator:** Bob (Scrum Master) · **Mode:** Batch

> Distinct from `sprint-change-proposal-2026-08-14.md` (which created Epic 34). Filename follows the project's established `-story-N-M` convention.

---

## 1. Issue Summary

Epic 34 closed with all four stories `done` and the reported bug fixed and smoke-verified live. During the Project Lead's post-reload smoke review, three deferred MEDIUM ledger items were escalated as warranting resolution **before the epic merges**, rather than carrying to Epic 35.

**What triggered it:** the Lead asked for the MEDIUM list, and two items stood out as belonging to the same failure classes Epic 34 exists to close:

- **`34-2-R3`** — `RenderResponseBody`'s returned `%Status` is discarded. If `%ToJSON()` fails mid-stream, the handler ships a **truncated, invalid JSON body with HTTP 200 and no error signal** — byte-for-byte the same user-visible outcome as the bug this epic fixed.
- **`34-3-R4`** — AC 34.3.4's legs **(b) `Output`-param, (c) 20-arg, (d) second-namespace** live only in `custom-rest.integration.test.ts`, which no gate runs. The 34.3 review promoted only leg **(a)** (the three reproductions) into the default suite. So three-quarters of the epic's own acceptance criterion has exactly the zero-protection property that was rated **HIGH** for leg (a).

A third item was folded in during scoping as a same-shape sibling:

- **`34-3-R1`** — the `truncated` flag is computed and then discarded on every **error** response path, on both `/classmethod` and `/command`. Same defect shape as `34-2-R3` (an error path dropping information the caller needs) and the same code region.

**Honest severity framing (important, and corrected during analysis):** `34-2-R3` has **no reachable trigger today** — its known trigger (the `$Data=11` OREF case) was fixed at the root during the 34.2 review. This is **defense-in-depth against a repo-wide pattern**, not a live defect. It earns a story because (i) the consequence would be identical to the epic's headline bug, (ii) the pattern is shared by *every* handler in `ExecuteMCPv2.REST.*`, and (iii) this epic enlarged the payload surface more than any other change.

**Evidence:** `_bmad-output/implementation-artifacts/deferred-work.md`, items `34-2-R3`, `34-3-R1`, `34-3-R4` — each recorded with reproduction detail and a suggested resolution by the review layer that raised it.

---

## 2. Impact Analysis

### Epic impact
Epic 34 must **re-open**: `epic-34: done → in-progress`, plus a new `34-4` story key. Rule **SC-5** applies but requires no branch work — the `epic34` branch is **intact and unmerged**, so it is checked out as-is rather than recreated off the feature branch. Log `epic_branch_reopened`.

### Story impact
- **New Story 34.4.** No existing story is re-opened or re-touched — 34.0–34.3 stay `done` (the Rule #52 seam discipline: this closes a documented seam, it does not re-litigate finished work).
- No downstream story depends on this; Epic 34 has no successors in flight.

### Artifact conflicts
- `epics.md` — Epic 34 gains a Story 34.4 section. The existing AC 34.3.4 text stays as written (it was satisfied as specified); 34.4 adds the **durability** requirement its legs (b)/(c)/(d) lacked.
- `deferred-work.md` — the three items move to TERMINAL disposition on story close.
- `prd.md` / `architecture.md` — **no change**. This is hardening within FR142's existing surface; no new requirement, no architectural decision.
- No UX artifact exists for this project (MCP-server suite).

### Technical impact
- **Cross-handler blast radius.** The `34-2-R3` fix touches the shared response-render path used by every `ExecuteMCPv2.REST.*` handler, not just `Command.cls`. That is deliberate (the ledger's own suggested resolution says "apply across handlers"), but it makes Rule #19 back-compat proof the story's main risk, not the fix itself.
- **`Command.cls` is bootstrapped** → Rule #24 BOOTSTRAP_VERSION bump required if touched (current: `5ef2df119451`). **Constraint C-2** must be re-verified (single generated `.int`); the `TestCommandCompilesToSingleGeneratedRoutine` pin guards it.
- **No CI exists** (`.github/workflows` absent), so "no gate runs" means the local default suite is the only enforcement surface. The `34-3-R4` fix must therefore land in the **default** suite, not a new opt-in task nobody invokes.
- No new MCP tool, action, or governance key → Rules #28/#31/#53 untriggered; tool counts must not move. Frozen governance baseline untouched (#23/#25).

---

## 3. Recommended Approach

**Direct Adjustment** — add one story within the existing epic. No rollback, no MVP change.

Rejected alternatives:
- *Carry to Epic 35* — the Lead's explicit decision was to fix before merge; and `34-3-R4` in particular is cheapest to fix now, while the gate file the 34.3 review just built is fresh context.
- *Fold into a 34.3 re-open* — violates Rule #52 (34.3 is `done`; re-opening finished work to append scope is exactly the churn the seam discipline prevents).

**Effort:** small — one story, three well-characterized items, each with a suggested resolution already recorded by its raising review layer.
**Risk:** the cross-handler `34-2-R3` change is the only real risk; mitigated by a mandatory Rule #19 back-compat proof across every affected handler.
**Timeline:** delays the Epic 34 merge by one story cycle. The retrospective runs after 34.4 so it can include this course correction.

---

## 4. Detailed Change Proposals

### 4.1 `epics.md` — add Story 34.4 to Epic 34

**Section:** Epic 34 → Stories list

```
OLD:
- 34.3 TS tool surfacing + docs + live smokes (bug-report repros are the epic gate)

NEW:
- 34.3 TS tool surfacing + docs + live smokes (bug-report repros are the epic gate)
- 34.4 Response-path integrity + epic-gate durability (Epic 34 re-opened 2026-08-14
  per Rule SC-5; Project Lead escalation of ledger items 34-2-R3, 34-3-R1, 34-3-R4)
```

**Rationale:** records the re-open and its provenance in the planning artifact, so a reader of `epics.md` alone understands why the epic has a fifth story.

### 4.2 `epics.md` — new Story 34.4 section

```
### Story 34.4: Response-Path Integrity + Epic-Gate Durability

**As a** caller of the ExecuteMCPv2 REST handlers, **I want** a serialization failure
to be reported rather than silently shipped as a truncated 200, and the epic's own
acceptance legs to be enforced by a gate, **so that** the failure class Epic 34 closed
cannot reappear through the response-render path or go undetected by the suite.

**Acceptance Criteria**:
- **AC 34.4.1** (34-2-R3) — `RenderResponseBody`'s returned `%Status` is captured and
  acted on wherever it is called in `ExecuteMCPv2.REST.*`: on failure, emit a minimal
  PRE-VALIDATED error envelope instead of the failed payload. Applied across handlers,
  not only `Command.cls`. Rule #7 preserved: full I/O restore before render, exactly ONE
  RenderResponseBody per request, namespace restored before render on every path.
- **AC 34.4.2** (34-3-R1) — the `truncated` flag is surfaced on the ERROR envelope of
  BOTH `/classmethod` and `/command`, or the flag is explicitly documented as
  success-path-only at its point of use. Silent loss is not an allowed outcome.
- **AC 34.4.3** (34-3-R4) — AC 34.3.4 legs (b) Output-param, (c) 20-arg, (d)
  second-namespace are enforced by the DEFAULT test suite, alongside leg (a). They join
  the existing default-suite gate file (which already carries the fixture-existence
  probe and the IRIS_REQUIRE_LIVE opt-in); a new opt-in task that nothing invokes does
  NOT satisfy this AC — the repo has no CI, so the default suite is the only enforcement
  surface.
- **AC 34.4.4** — Rule #19 back-compat: every handler touched by AC 34.4.1 keeps its
  current success-path response byte-identical, proven mechanically per handler.
- **AC 34.4.5** — Rule #48: each fix carries mutation evidence (revert → red → restore
  byte-identically). AC 34.4.3's new gate legs must be shown RED under a real break.
- **AC 34.4.6** — If `Command.cls`/`Utils.cls` change: BOOTSTRAP_VERSION from→to recorded
  (Rule #24; current `5ef2df119451`), Constraint C-2 re-verified (single generated
  `.int`), governance baseline unchanged (#23/#25), tool counts unmoved (#31).
```

**Rationale:** each AC traces to exactly one escalated ledger item, with the two cross-cutting project rules (back-compat, mutation evidence) that the epic's own review history proved necessary.

### 4.3 `sprint-status.yaml`

```
OLD:
  epic-34: done
  ...
  34-3-ts-tool-docs-smokes: done

NEW:
  epic-34: in-progress
  ...
  34-3-ts-tool-docs-smokes: done
  34-4-response-integrity-gate-durability: backlog
```

**Rationale:** Rule SC-5 re-open. `epic-34-retrospective` stays `optional` — the retro runs after 34.4 so it can cover this correction.

### 4.4 `deferred-work.md`

Items `34-2-R3`, `34-3-R1`, `34-3-R4` annotated as **escalated to Story 34.4 (2026-08-14, Project Lead)**, moving from "deferred" to "in-flight", and reaching TERMINAL disposition when 34.4 closes. Their Rule #37 re-deferral counts stop advancing.

### 4.5 No change

`prd.md`, `architecture.md` — hardening within FR142's existing surface; no new requirement or architectural decision. Recorded here as checked-no-edit-needed (Rule #56 discipline: an audited "no change" is a finding, not an omission).

---

## 5. Implementation Handoff

**Scope classification: MODERATE** — backlog reorganization (epic re-open + new story) plus direct implementation. Not Minor, because it re-opens a closed epic and edits the planning artifact; not Major, because no requirement, architecture decision, or MVP boundary moves.

**Route to:** the `/epic-cycle` pipeline — Story 34.4 runs the standard create-story → dev → QA → code-review → lead-smoke → commit sequence on the existing `epic34` branch.

**Success criteria:**
1. All three escalated items at TERMINAL disposition in the ledger.
2. AC 34.4.3's new gate legs proven RED under a real break and GREEN restored (Rule #48).
3. Every touched handler's success path byte-identical (Rule #19).
4. Governance baseline and tool counts unmoved; C-2 intact if `Command.cls` changes.
5. Epic 34 returns to `done`, then the retrospective and the SC-4 merge gate proceed.

**Explicitly out of scope for 34.4:** the remaining open MEDIUMs (`34-1-R5`, `34-1-R8`, `34-2-R2`, `34-2-R4`, `34-2-R5`, `34-3-R2`, `34-3-R3`) and all LOW items stay in the ledger at Rule #37 count 1. The Lead considered and declined the size-cap items (`34-2-R2`/`34-3-R2`) as roughly doubling the story.
