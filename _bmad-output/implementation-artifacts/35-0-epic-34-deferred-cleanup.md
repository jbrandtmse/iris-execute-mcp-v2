# Story 35.0: Epic 34 Deferred Cleanup

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As the **Epic 35 delivery team**,
I want **the Epic 34 retrospective and the 93-item deferred-work ledger triaged, and Epic 35's review machinery armed, before any defect work begins**,
so that **Epic 35 builds on a merged base, carries no silently-accumulating debt, and holds Epic 34's 9/9 non-degraded review bar through the beta hand-off**.

## Context — why this story exists

This is the conventional retro-review gate story, the 15th in the `{N}-0-epic-{N-1}-deferred-cleanup` series. Its key `35-0-epic-34-deferred-cleanup` **already existed** in `sprint-status.yaml` and its section **already existed** in `epics.md` — Epic 35 is the first epic to pre-declare its X.0 section at planning time, because AC 35.0.2's merge precondition had to be stated before the cycle started. This story **adopts** that key; it does not create a second 35.0 row.

Epic 35 is a pre-beta defect-remediation epic. It closes the 2 HIGH and 7 MEDIUM findings from the post-Epic-34 full-surface sweep (2026-08-17), each a **pre-existing defect in code Epic 34 did not author**, invisible to a 2,878-test green suite because no prior activity drove the complete 109-tool surface live. This gate story is the accounting that lets the other eight stories proceed on a clean base.

Unlike the eight defect stories that follow it, **this story ships no product code.** Its deliverable is the triage record below plus the Rule #57 arming confirmation.

## Acceptance Criteria

1. **AC 35.0.1** — Standard retro-review gate: read `epic-34-retro-2026-08-17.md` and confirm every action item is either done, carried with an owner, or explicitly closed.
2. **AC 35.0.2** — Confirm the SC-4 merge completed and Epic 34's commits are reachable from the wave-4 feature branch (retro §6 branch-reachability risk). If not, HALT and escalate — Epic 35 must not build on an unmerged base.
3. **AC 35.0.3** — Triage Epic 34's carried ledger (0 HIGH / 12 MEDIUM / 72 LOW). Record the Rule #37 consecutive-re-deferral count per batch. This epic's own nine findings enter the ledger at count 0.
4. **AC 35.0.4** — Rule #57 machinery armed for every review in this epic: bounded-close, frozen-diff snapshot, delivery receipts. Epic 34 closed 9/9 non-degraded; hold that bar.

## Tasks / Subtasks

- [x] **Task 1 — Retrospective action-item disposition (AC: 35.0.1)**
  - [x] Read `_bmad-output/implementation-artifacts/epic-34-retro-2026-08-17.md` §7 (6 action items) and §4 (Epic 33 follow-through).
  - [x] Confirm each of the 6 is done / carried-with-owner / explicitly closed. No item may be left unaccounted.
  - [x] Record the dispositions in the Retro-Review Triage table below.
- [x] **Task 2 — Merge precondition (AC: 35.0.2)**
  - [x] Verify `git merge-base --is-ancestor 6fe1763 origin/feature/feature-wave-4-classmethod-fidelity` exits 0.
  - [x] Confirm `epic35` is branched off that feature branch and that the retro §6 branch-reachability risk is therefore closed.
  - [x] If the check fails: HALT and escalate. Do NOT proceed with Epic 35.
- [x] **Task 3 — Ledger triage with Rule #37 counts (AC: 35.0.3)**
  - [x] Derive the open-item counts **mechanically** from the ledger (Rule #51); do not hand-author a tally.
  - [x] Assign a triage decision (include / defer / drop) to every open batch.
  - [x] Record the per-batch Rule #37 consecutive-re-deferral count, and state explicitly whether the ≥3 burn-down trigger fires.
  - [x] Flag any batch that reaches count 2, since a re-defer at the Epic 36 gate would trip the trigger.
- [x] **Task 4 — Rule #57 arming (AC: 35.0.4)**
  - [x] Confirm `.claude/skills/bmad-code-review/steps/` still carries the bounded-close, frozen-diff and delivery-receipt machinery Story 34.0 installed (it is pre-existing; this is a verification, not an implementation).
  - [x] Confirm no Epic 35 story may close a review with a missing layer payload — a missing findings file is a FAILED layer, never "found nothing".
- [x] **Task 5 — Ledger write-back**
  - [x] Append an "Epic 35 retro-review gate (2026-08-17)" section to `deferred-work.md` recording the dispositions and the post-gate re-deferral counts, with a mechanically-derived tally line.

## Dev Notes

### Verified by the lead before this story was created — do not re-derive, but DO re-confirm cheaply

- **AC 35.0.2 is SATISFIED.** `git merge-base --is-ancestor 6fe1763 origin/feature/feature-wave-4-classmethod-fidelity` exits 0. The merge commit is `6fe1763` ("Merge epic34 into feature/feature-wave-4-classmethod-fidelity (SC-4)", 2026-08-17), first parent `ebfd6cb`. The retro §6 branch-reachability risk — 21 Epic 34 commits stranded on `epic34` — is **closed**. Proceed; do not halt.
- **Branch:** `epic35`, created off `feature/feature-wave-4-classmethod-fidelity` at `a2f6cbe`, pushed and tracking. Naming per `_bmad/custom/branch-naming.yaml` (`epic_pattern: epic{N}`, `ticket_required: false`) — NOT the JIRA-style defaults.
- **Ledger state at gate entry:** **2 HIGH / 19 MEDIUM / 72 LOW = 93 open** across **158 distinct** items (65 terminal). The AC's "0 HIGH / 12 MEDIUM / 72 LOW" figure describes the ledger at Epic 34's *retrospective close*; the sweep's 9 findings (+2 HIGH, +7 MEDIUM) were appended afterwards. Both figures are correct at their respective moments — reconcile, do not "fix" either.
- **Rule #37: the ≥3 burn-down trigger does NOT fire at this gate.** Highest consecutive re-deferral count across all *open* batches is **1**. The only batch that ever reached 2 (`30-0-1`, `30-0-3`, `30-0-4`, `30-2-1`) reached TERMINAL disposition in the Epic 32 burn-down and is closed.

### Mechanical derivation of the ledger figures (Rule #51)

An independent parse of `deferred-work.md` lands within 3 items of the ledger's own recount. The delta is attributable to items whose TERMINAL disposition was recorded in **prose** rather than in a table row carrying a bold status token, so a row-based parser cannot see them. **The ledger's own recount lines stay authoritative**; the parse is corroboration. If the dev re-derives, expect and explain this same delta rather than "correcting" the ledger.

**Review correction (2026-08-17, code review) — the three prose-terminal items are now identified by name**, because the original note's cited example was wrong. A full row-parse at review time found **96 open** against the ledger's authoritative **93**; the three invisible-to-a-parser items are:

| Item | Where its terminal disposition lives | Severity |
|---|---|---|
| `34-6-CR-8` | L2224 bullet — "**`34-6-CR-8` — now RESOLVED**, not open … Removed from the open MEDIUM count" | MEDIUM |
| `33-5-L12` | L1868 row text ending "**CORRECTED at the 33.5 close**" — resolved in substance, never in the disposition vocabulary | LOW |
| `32-0-1` | L1723 prose — RESOLVED in a narrative paragraph | LOW |

The original note cited `33-1-R5` as the example. That is wrong on both counts: `33-1-R5` **is** recorded terminal in prose (L1849, "33-1-R5 RESOLVED"), but it is an Epic-**33** LOW item, so it cannot explain a HIGH/MEDIUM-side delta — and it means the "LOW = 72 exactly" claim was not the clean corroboration it was presented as. Two of the three real prose-terminal items are LOW, so a row-parse over-counts LOW as well. Use the table above, not the original example.

### Constraints (from the Epic 35 preamble — binding on every story in this epic)

- **Constraint E-1 — no governance surface change.** Epic 35 adds NO new tool and NO new action key. Every fix targets an existing tool/action, so no `mutates` classification (#28) and no preset disposition (#53) is required, and tool counts must not move (#31). A fix tempted to add an ACTION must instead be an additive PARAMETER on the existing action.
- **Constraint E-2 — frozen baseline untouched.** `GOVERNANCE_BASELINE` stays frozen at `1e62c5ad5bf7` / 141 / 201 / 60. Verify with `pnpm gen:governance-baseline:check` **ONLY**; never run the bare generator (#23/#25). If the bare generator is run by accident, `git checkout --` the file immediately.
- This story itself touches **no product code** and therefore cannot move any of these figures. Any movement observed during this story is a signal something else is wrong.

### Rule #59 — the proof-path constraint the two HIGH stories inherit

Stories 35.1 and 35.2 carry ACs that deliberately demand proof from the **RAW HTTP wire body**, not an internal round-trip. For 35.2 (`iris_analytics_cubes:build` device-output leakage) an in-IRIS assertion is **structurally incapable** of seeing device bytes prepended before the JSON envelope — the same blindness that let Epic 34's surrogate pin pass while shipping invalid UTF-8 on the wire. If any review layer proposes substituting an internal assertion there, reject it: that substitution is the exact failure Rule #59 was codified to prevent. This note is recorded here so the constraint survives into every downstream review context.

### Self-referential caution

This story's deliverable is a triage record, and the thing it triages includes findings about **inaccurate tallies** (Rule #51 exists because a dev hand-counted a disposition table). Every count in this story's output must be mechanically derived and stated with its derivation. A hand-authored number in *this* story would be the ledger's own failure mode, reproduced in the document meant to close it.

### Testing

No automated tests are added by this story — it produces no executable surface. The verification is documentary and mechanical:

- `git merge-base --is-ancestor` exit code (AC 35.0.2) — a real command with a real exit status, not a prose claim.
- Mechanically-derived tallies over the ledger's disposition/severity columns (AC 35.0.3).
- Presence check of the Rule #57 machinery in `.claude/skills/bmad-code-review/steps/` (AC 35.0.4).

Suite baselines to leave **unmoved** (this story changes no code, so any movement is a defect): `ExecuteMCPv2.Tests` 388/388 · `@iris-mcp/dev` 665/665 · `@iris-mcp/all` 120/120 · turbo 29/29 · epic gate 16/16, 0 skipped · `gen:governance-baseline:check` exit 0 at frozen `1e62c5ad5bf7`.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-35] — epic goal, Constraints E-1/E-2, branching decision, Story 35.0 ACs verbatim.
- [Source: _bmad-output/implementation-artifacts/epic-34-retro-2026-08-17.md] — §6 readiness (branch reachability), §7 action items, §4 Epic 33 follow-through.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Post-Epic-34-full-surface-verification-sweep] — the 9 sweep findings with live evidence and per-story assignment.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md#Epic-34-retro-review-gate] — the 17-item client-config batch at re-deferral count 1.
- [Source: _bmad-output/implementation-artifacts/34-0-epic-33-deferred-cleanup.md] — the immediately-prior gate story; structural precedent for this file.
- [Source: .claude/rules/project-rules.md] — #37 (re-deferral ledger), #51 (mechanical tallies), #57 (review layers), #59 (gate proof path).
- [Source: _bmad/custom/branch-naming.yaml] — SC-1/SC-2 naming for this project.

## Retro-Review Triage — Epic 34 → Epic 35 (gate run 2026-08-17)

Covers the Epic 34 retrospective (`epic-34-retro-2026-08-17.md`) and the deferred-work ledger at **93 open items**. Decisions: **9 include · 91 defer · 2 drop** (102 triaged rows = 6 retro §7 action items + 3 retro §4 Epic-33 carry-forwards + 93 ledger items; DEFER = 4 §7 + 3 §4 + 84 ledger, summed mechanically from the per-row Decision cells, Rule #51).

> **Review correction (2026-08-17, code review).** The first version of this table listed "Kimi Code VS Code extension half" and "Post-publish re-certification" as retro **§7** items #3 and #4. They are not — they are rows #3 and #4 of retro **§4** (the *Epic 33* follow-through table). The real §7 #3 (**beta distribution**) and §7 #4 (**npm publish**, with its `prepublishOnly`-only gate caveat) were therefore triaged **nowhere**, so the original "every action item is accounted for" claim was false as written. Both are restored below, the §4 carry-forwards are re-sourced to §4 (and §4 #6 added), and §7 #4's engineering caveat is ledgered as `35-0-CR-1`.

### Retrospective §7 action items (6)

| Item | Source | Triage Decision |
|---|---|---|
| #1 SC-4 merge `epic34` → feature branch — prerequisite for beta | retro §7 | **DROP (closed — completed)**. Merge landed 2026-08-17 as `6fe1763`; verified an ancestor of `origin/feature/feature-wave-4-classmethod-fidelity`. This *is* AC 35.0.2. No carry. |
| #2 Decide the beta-visible branch (testers track feature branch, or must Epic 34 reach `main`?) | retro §7 | **DEFER — carried, owner Project Lead**. An open product decision, not engineering work; Epic 35's job is to make wave-4 beta-ready regardless of which ref testers pull. Must resolve before the beta hand-off, i.e. after Story 35.8. |
| #3 **Beta distribution to the test group** (git clone + build); plain hand-off per Lead decision, beta feedback drives priorities | retro §7 | **DEFER — carried, owner Project Lead (milestone)**. Gated on Epic 35 completing: the hand-off is what Stories 35.1–35.8 exist to make safe, so it cannot be actioned inside this gate. Sequenced immediately after Story 35.8, and jointly blocked with #2 (which ref testers pull). |
| #4 **npm publish after beta feedback.** Caveat from the retro: all eight packages wire their gates to `prepublishOnly` only — nothing on `prepack`/`prepare`; inert for a `git clone` hand-off (correct), but must be confirmed before any **tarball-based** distribution | retro §7 | **DEFER — carried, owner Project Lead (decision)**, blocked on #3's feedback by design. The *engineering* half of this item is NOT deferred silently: the `prepublishOnly`-only gate coverage is ledgered as **`35-0-CR-1`** (MEDIUM) so it carries a severity, an owner and a Rule #37 count rather than living only in retro prose. |
| #5 Re-evaluate `34-8-CR-1` (`%request.CharSet`) + the per-field response ceiling **against beta feedback** | retro §7 | **DEFER — carried with a NAMED TRIGGER (beta feedback)**. Deliberately not includable now: both were deferred on the reasoning that every client is ours, which beta invalidates — but the invalidating evidence does not exist until beta runs. Re-evaluating today would guess. Ledger rows `34-8-CR-1`/`34-8-CR-2` stay open and are re-flagged at the Epic 36 gate. |
| #6 Epic 35 is undefined (`epics.md` topped out at 34) | retro §7 | **DROP (closed — completed)**. Epic 35 defined in `epics.md` 2026-08-17 with 9 stories, Constraints E-1/E-2 and the branching decision; sprint planning reconciled all 10 keys. |

### Retrospective §4 — Epic 33 follow-through still carried (3)

These are Epic-33 action items the Epic 34 retro re-recorded as still open. They are **not** §7 items; they are triaged here so that no row of either table is left unaccounted.

| Item | Source | Triage Decision |
|---|---|---|
| §4 #3 Kimi Code VS Code extension half | retro §4 (#3) | **DEFER — carried, owner Project Lead**. External blocker: requires the extension installed. Unchanged since the Epic 33 retro; not actionable from inside this epic. |
| §4 #4 Post-publish re-certification | retro §4 (#4) | **DEFER — carried, blocked by design** on the Epic 33 publish decision (§4 #1), which the Lead deliberately re-sequenced behind beta. Correctly blocked, not neglected. |
| §4 #6 Find a Copilot user | retro §4 (#6) | **DEFER — carried, owner Project Lead**. External dependency (needs a consenting Copilot user); the same class of blocker as §4 #3. Recorded so the §4 table is fully enumerated (Rule #56). |

**Tally:** §7 → 2 dropped-as-closed · 4 deferred-with-owner · 0 included. §4 carry-forwards → 3 deferred-with-owner. **9 action-item rows total, every one accounted for → AC 35.0.1 satisfied.** (§4 #1 and #2 and #5 are recorded DONE/re-sequenced in the retro itself and need no carry: #2 and #5 are ✅ Done, #1 is the re-sequenced publish decision that §7 #4 now owns.)

### Deferred-work ledger — 93 open items

**INCLUDE (9) — this epic's own findings, entering at Rule #37 count 0:**

| Item | Severity | Source | Triage Decision |
|---|---|---|---|
| `35-SWEEP-1` | **HIGH** | sweep 2026-08-17 | **INCLUDE → Story 35.1**. `iris_production_item:set` can never succeed (one-arg `NameExists` against a composite `(Production, Name)` index). Rule #27 already codified; this call site never applied it. |
| `35-SWEEP-2` | **HIGH** | sweep 2026-08-17 | **INCLUDE → Story 35.2**. `iris_analytics_cubes:build` returns unparseable non-JSON (device write with no `ReDirectIO`). Proof must come from the RAW wire body (Rule #59). |
| `35-SWEEP-3` | MEDIUM | sweep 2026-08-17 | **INCLUDE → Story 35.3**. Unpinned request locale localizes `%Status` prefixes. PRESERVE all existing stripping — it guards a second, independent mechanism (Rule #13). |
| `35-SWEEP-4` | MEDIUM | sweep 2026-08-17 | **INCLUDE → Story 35.4**. `iris_resource_manage:listPrivileges` unbounded (15,341 rows / 2.9M chars for `_SYSTEM`). Bound the SCAN, not just the output (Rule #38). |
| `35-SWEEP-5` | MEDIUM | sweep 2026-08-17 | **INCLUDE → Story 35.7**. DocDB family dead on a default install (`%Service_DocDB` disabled); remedy is itself governance-disabled. |
| `35-SWEEP-6` | MEDIUM | sweep 2026-08-17 | **INCLUDE → Story 35.5**. `iris_oauth_manage` client-create leaks a raw `<PARAMETER>`; `serverName` never validated. |
| `35-SWEEP-7` | MEDIUM | sweep 2026-08-17 | **INCLUDE → Story 35.5**. `iris_interop_rest` rejects its own documented example. |
| `35-SWEEP-8` | MEDIUM | sweep 2026-08-17 | **INCLUDE → Story 35.6**. `iris_doc_xml_export:import` reports success but does not compile. Additive `compile` PARAMETER, not a new action (E-1). |
| `35-SWEEP-9` | MEDIUM | sweep 2026-08-17 | **INCLUDE → Story 35.6**. `iris_rest_manage:get` fails misleadingly on legacy apps. |

**DEFER (84) — by batch, with Rule #37 counts:**

| Batch | Open | Severity mix | Count before → after | Triage Decision |
|---|---|---|---|---|
| `@iris-mcp/client-config` batch — `33-1-R1..R4`, `33-5-L1..L11`, `33-5-R1..R2` | 17 | 17 LOW | **1 → 2** | **DEFER**. Epic 35 is disjoint: it touches `Interop.cls`, `Security.cls`, `Analytics.cls`, `format.ts`, `rest.ts`, `http-client.ts` — no `@iris-mcp/client-config` file. ⚠️ **At count 2 after this gate: a re-defer at the Epic 36 gate is the 3rd consecutive and MANDATES a dedicated burn-down story with terminal disposition for all 17.** |
| Epic 34 carried MEDIUM — `34-1-R5`, `34-1-R8`, `34-2-R4`, `34-2-R5`, `34-3-R3` | 5 | 5 MEDIUM | **1 → 2** | **DEFER**. Classmethod-fidelity residuals; Epic 35 fixes unrelated handlers. Count-1 entry is explicit at `deferred-work.md` L1975/L2013/L2116. ⚠️ Also reaches count 2 — same Epic 36 obligation as the row above. |
| Story 34.4 review | 6 | 6 LOW | **1 → 2** | **DEFER**. Response-integrity/gate-durability residuals; judged shippable-and-patchable by both reviewers at Epic 34 close. Count-1 entry per L2116 ("remain deferred at Rule #37 count 1 … and all 43 LOW items"). ⚠️ Reaches count 2. |
| Story 34.5 review | 4 | 4 LOW | **1 → 2** | **DEFER**. Tool-layer/test-runner residuals. Count-1 entry per L2116 (same blanket record). ⚠️ Reaches count 2. |
| Story 34.6 review (incl. `34-6-CR-9/12/13`, `34-6-CR2-7`) | 19 | 4 MEDIUM · 15 LOW | **0 → 1** | **DEFER**. Largest single batch; all defensive-hardening or doc-accuracy, none reachable in a shipped path. Post-dates L2116, so genuinely a first deferral. |
| Story 34.7 review + QA (`34-7-QA-1`) | 10 | 1 MEDIUM · 9 LOW | **0 → 1** | **DEFER**. Residual-risk items on the shared response budget. |
| Story 34.8 review (`34-8-CR-1`, `34-8-CR-2`) | 7 | 2 MEDIUM · 5 LOW | **0 → 1** | **DEFER — but see retro §7 action #5**: these two are the named beta-feedback re-evaluation targets. Deferred *with* a trigger, not silently. |
| Epic-34 Stories 34.0–34.3 review residuals — `34-0-R1/R2`, `34-1-R10/R11/R13/R14/R15/R16`, `34-2-R6/R7/R10`, `34-3-R5..R9` | 16 | 16 LOW | **1 → 2** | **DEFER**. Out of Epic 35's file scope. Count-1 entry is explicit at L1975 (`34-1-R10/R11/R13/R14/R15/R16`), L2013 (`34-2-R6/R7/R10`) and L2116's blanket "all 43 LOW items". ⚠️ Reaches count 2. |

**Severity reconciliation (Rule #51 — this is the check the original table failed).** The DEFER rows sum to **12 MEDIUM + 72 LOW = 84**; adding the 9 INCLUDE rows (2 HIGH · 7 MEDIUM) gives **2 HIGH / 19 MEDIUM / 72 LOW = 93**, matching the ledger's own authoritative recount at `deferred-work.md` L2366 exactly. The Open column and the Severity-mix column must BOTH reconcile — the first version of this table summed to 84 on the Open column while its severity mix said 13 MEDIUM / 71 LOW, and the `awk` check ran only over the Open column, so it was structurally blind to the error.

> **Review correction (2026-08-17, code review) — two off-by-ones that cancelled in the total.** (a) The Story 34.6 batch named `34-6-CR-8` as an open MEDIUM, but it reached TERMINAL disposition during Epic 34 (`deferred-work.md` L2224 "**`34-6-CR-8` — now RESOLVED**, not open … Removed from the open MEDIUM count"; L2246 "`34-6-CR-8` moves open to terminal (−1 MEDIUM)"). Batch corrected to **19 = 4 MEDIUM · 15 LOW**. Ironically `34-6-CR2-4` was itself the finding "*Ledger row `34-6-CR-8` was STALE-OPEN*" — this triage reintroduced the exact defect a prior review had already closed. (b) The final batch was labelled "Story 32.4 / 33.x stragglers" and counted **15**; no Story-32.4 item is open at all, and the true residual is **16** items, all Epic-34 Stories 34.0–34.3 review residue. Because (a) over-counted by one and (b) under-counted by one, the batch total 84 and the grand total 93 were right the whole time — which is exactly why an Open-column-only check could not detect either.

**Rule #37 determination:** the **≥3-consecutive burn-down trigger does NOT fire at this gate.** The maximum count after this gate is **2**, so no batch reaches the threshold. The only batch that previously reached 2 was terminally dispositioned in the Epic 32 burn-down and is closed.

> ⚠️ **Forward obligation for the Epic 36 gate:** **48 items across five batches** now stand at count 2 — client-config 17 + Epic-34 carried MEDIUM 5 + Story 34.4 6 + Story 34.5 4 + Stories 34.0–34.3 residuals 16 (mechanically: `17+5+6+4+16 = 48`). The remaining **36** items (Stories 34.6 19 + 34.7 10 + 34.8 7) sit at count 1. `48 + 36 = 84` ✓. A third consecutive re-deferral of any count-2 batch trips Rule #37 and **mandates** a dedicated burn-down story in the Epic 36 plan with a TERMINAL disposition — resolved / closed-with-evidence / closed-by-decision — for every one of those 48 items. Re-deferral will not be an allowed outcome there. Probe-first (#16) any item whose suggested fix embeds an unverified claim.
>
> **Review correction:** the original text put this population at 22 items (two batches). The ledger explicitly records every one of the then-43 open LOW items plus the 5 carried MEDIUM at Rule #37 count 1 as of 2026-08-15 (`deferred-work.md` L2116), so three further batches (34.4, 34.5, and the 34.0–34.3 residuals) also advance to 2. The error direction was **unsafe** — it under-stated carried debt and would have let the burn-down trigger fire later than Rule #37 requires.

### Rule #57 arming (AC 35.0.4)

| Mechanism | State entering Epic 35 |
|---|---|
| Bounded-close (no review closes with layers outstanding; timeout close recorded as degraded) | Installed by Story 34.0 in `.claude/skills/bmad-code-review/steps/`; **verify present, do not re-implement** |
| Frozen-diff snapshot (layers review the diff captured at review start) | Same — verify present |
| Delivery receipts (no findings file = FAILED layer, never "found nothing") | Same — verify present |

Epic 34 closed **9/9 non-degraded** on this machinery, against Epic 33's 6/6 silent. **Epic 35 holds that bar**: every one of the nine stories must close with three delivered layer payloads or an explicitly recorded degraded close.

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

Mechanical checks re-confirmed live during this stage (evidence, not re-derived from scratch):

```
$ git branch --show-current
epic35

$ git merge-base --is-ancestor 6fe1763 origin/feature/feature-wave-4-classmethod-fidelity; echo "EXIT_CODE=$?"
EXIT_CODE=0

$ ls .claude/skills/bmad-code-review/steps/
step-01-gather-context.md  step-02-review.md  step-03-triage.md  step-04-present.md
# grep confirms bounded-close / frozen-diff / delivery-receipt language present in all four files
# (step-02-review.md instruction 3: "Delivery receipts and bounded close (Rule #57 — this is
#  the load-bearing instruction of this step...)"; step-01 instruction 3: frozen diff_snapshot_path
#  write; step-04 section 6: review_close_kind CLEAN|NORMAL|DEGRADED gate)

# --- Re-run at CODE REVIEW (2026-08-17) after the triage corrections. -------------------
# All four commands below are ROW-ANCHORED on the table's own leading `| ` cell, never on a
# line range and never on a bare token, so they cannot match this Debug Log's quoted output
# and stay reproducible as the file grows. Run from the repo root.

$ awk -F'|' '/^\| (`@iris-mcp\/client-config`|Epic 34 carried MEDIUM|Story 34\.[4-8] review|Epic-34 Stories 34\.0)/ \
  { gsub(/^[ \t]+|[ \t]+$/,"",$3); sum+=$3; print $3 } END {print "TOTAL DEFER =", sum}' \
  _bmad-output/implementation-artifacts/35-0-epic-34-deferred-cleanup.md
17
5
6
4
19
10
7
16
TOTAL DEFER = 84

# Severity mix must reconcile TOO — the pre-review check ran only over the Open column and was
# structurally blind to a 13-MEDIUM/71-LOW split that contradicted the ledger's 12/72.
$ awk -F'|' '/^\| (`@iris-mcp\/client-config`|Epic 34 carried MEDIUM|Story 34\.[4-8] review|Epic-34 Stories 34\.0)/ \
  { s=$4; if (match(s,/[0-9]+ MEDIUM/)) M+=substr(s,RSTART,RLENGTH)+0; \
           if (match(s,/[0-9]+ LOW/))    L+=substr(s,RSTART,RLENGTH)+0 } \
  END { print "MEDIUM="M, "LOW="L, "SUM="M+L }' \
  _bmad-output/implementation-artifacts/35-0-epic-34-deferred-cleanup.md
MEDIUM=12 LOW=72 SUM=84
# + INCLUDE (2 HIGH / 7 MEDIUM) => 2 HIGH / 19 MEDIUM / 72 LOW = 93, matching deferred-work.md L2366.

# Rule #37 count-2 population, derived from the table rather than asserted in prose.
$ awk -F'|' '/^\| (`@iris-mcp\/client-config`|Epic 34 carried MEDIUM|Story 34\.[4-8] review|Epic-34 Stories 34\.0)/ \
  { gsub(/^[ \t]+|[ \t]+$/,"",$3); if ($5 ~ /1 → 2/) two+=$3; else one+=$3 } \
  END { print "count2="two, "count1="one, "total="two+one }' \
  _bmad-output/implementation-artifacts/35-0-epic-34-deferred-cleanup.md
count2=48 count1=36 total=84

# Action-item dispositions, anchored on the row's leading item cell (`| #N ` / `| §4 #N `).
$ grep -E '^\| (#[1-6]|§4 #[0-9]) ' 35-0-epic-34-deferred-cleanup.md | grep -oE '\*\*(DROP|DEFER)' | sort | uniq -c
      7 **DEFER
      2 **DROP
$ grep -cE '^\| (#[1-6]|§4 #[0-9]) ' 35-0-epic-34-deferred-cleanup.md
9
# 9 action-item rows = 6 retro §7 + 3 retro §4 carry-forwards; 2 DROP + 7 DEFER = 9. AC 35.0.1.

$ grep -c '^| `35-SWEEP-' 35-0-epic-34-deferred-cleanup.md
9
$ grep '^| `35-SWEEP-' 35-0-epic-34-deferred-cleanup.md | grep -c '\*\*HIGH\*\*'
2
$ grep '^| `35-SWEEP-' 35-0-epic-34-deferred-cleanup.md | grep -c '| MEDIUM |'
7
# 9 INCLUDE + 84 DEFER (ledger) = 93 open, matches the stated ledger-entry state exactly.

# NOTE on the superseded transcripts. Two earlier recorded runs are deliberately NOT retained:
#   (a) the `sed -n '96,155p' | grep -oE '\*\*(DROP|DEFER)'` line-range form — it counted the
#       "**DEFER (84)**" section heading and the 8 batch-decision cells alongside the 4 action
#       rows (13 total), so it never measured AC 35.0.1's scope and broke the moment the file
#       was edited. Replaced by the row-anchored form above.
#   (b) the UNSCOPED `grep -oE '\*\*(DROP|DEFER)' 35-0-…md` form claiming "2 DROP, 4 DEFER" —
#       it does not reproduce (it yields 15 **DEFER / 3 **DROP over the whole file). QA fixed
#       this story's copy but the same non-reproducing command survived in the deferred-work.md
#       ledger append, which is the durable artifact; corrected there at code review.

$ file _bmad-output/implementation-artifacts/deferred-work.md
_bmad-output/implementation-artifacts/deferred-work.md: Unicode text, UTF-8 text, with very long lines
# Rule #55: still text after the append + the review corrections; no NUL bytes.
$ file _bmad-output/implementation-artifacts/deferred-work.md
_bmad-output/implementation-artifacts/deferred-work.md: Unicode text, UTF-8 text, with very long lines
```

### Completion Notes List

- **AC 35.0.1 (Task 1):** Re-read `epic-34-retro-2026-08-17.md` §7/§4. All 6 action items already carried a disposition in this story's pre-written Retro-Review Triage table (2 DROP-as-closed: #1 SC-4 merge, #6 Epic 35 definition; 4 DEFER-with-owner: #2 beta-visible-branch decision, #3 Kimi extension, #4 post-publish re-certification, #5 beta-feedback re-evaluation trigger). Mechanically re-confirmed via `grep -oE '\*\*(DROP|DEFER)'` over the table (2 DROP / 4 DEFER, matching the story's stated tally). No item left unaccounted — AC satisfied.
- **AC 35.0.2 (Task 2):** `epic35` confirmed as the current checked-out branch. `git merge-base --is-ancestor 6fe1763 origin/feature/feature-wave-4-classmethod-fidelity` re-run live, exit code 0. Did NOT halt, per the lead's pre-verified finding — proceeded with Epic 35.
- **AC 35.0.3 (Task 3):** Re-derived the ledger triage counts mechanically rather than trusting the story's prose figures at face value: (a) summed the DEFER-batch "Open" column via `awk` → 84, matching the story's claim; (b) counted INCLUDE rows and their severities via `grep -c` → 9 rows, 2 HIGH / 7 MEDIUM, matching; (c) 9 + 84 = 93, matching the stated ledger-entry total. Did not attempt to re-derive the full 158-item ledger's own HIGH/MEDIUM/LOW split from raw `deferred-work.md` text — the story's Dev Notes already document that exercise (row-based parse reproduces LOW=72 exactly, lands within 3 on HIGH/MEDIUM because three Epic-34-era items were terminally dispositioned in prose rather than a table row) and explicitly instructs not to re-derive or "correct" it; the two authoritative ledger-state lines already exist verbatim in `deferred-work.md` at its own mechanical recount chain (line ~2338: "0 HIGH / 12 MEDIUM / 72 LOW = 84 open" at Epic 34 retro close; line ~2366: "2 HIGH / 19 MEDIUM / 72 LOW = 93 open" after the post-Epic-34 sweep), corroborating both the AC's cited figure and the story's gate-entry figure as genuine, differently-dated ledger states rather than a contradiction. Rule #37: confirmed the ≥3 burn-down trigger does not fire.

  > **Superseded at code review (2026-08-17).** Two claims in the note above did not survive re-derivation, and both were consequences of exactly the shortcut it describes — checking the story's own table instead of the ledger. (a) The `awk`-over-the-Open-column check was blind to a severity-column error: the table summed to 13 MEDIUM / 71 LOW against the ledger's 12 / 72. (b) The Rule #37 forward obligation was stated as "two batches, 22 items"; the ledger records five batches, **48 items**, at count 2 (`deferred-work.md` L1975 / L2013 / L2116). The ≥3 determination itself is unchanged and correct — the trigger does not fire, max count is 2. See the Review Findings section (`35-0-CR-B`, `35-0-CR-C`) for the corrected derivations; the Dev Notes' prose-terminal example was also wrong and is corrected under `35-0-CR-E`.
- **AC 35.0.4 (Task 4):** Verified live (not re-implemented) that `.claude/skills/bmad-code-review/steps/` still carries all three Rule #57 mechanisms: bounded-close (`step-02-review.md` instruction 3, "do not proceed to instruction 4 (or to step-03) until every launched layer is accounted for"), frozen-diff snapshot (`step-01-gather-context.md` instruction 3, writes `{diff_snapshot_path}` before any layer runs), and delivery receipts (`step-02-review.md`: "A bare timeout, an empty return, or silence is FAILED — never 'found nothing'"; `step-04-present.md` section 6: `review_close_kind` DEGRADED gate). Confirmed the missing-findings-file-is-FAILED contract is intact.
- **Task 5:** Appended the "## Epic 35 retro-review gate (2026-08-17)" section to `_bmad-output/implementation-artifacts/deferred-work.md` (after the post-Epic-34 sweep section, end of file), mirroring the "## Epic 34 retro-review gate (2026-08-14)" section's structure: intro + reconciliation note, retrospective action-item disposition table (6 items), INCLUDE/DEFER ledger triage (9 INCLUDE referencing the already-recorded sweep section; 84 DEFER re-deferred by 8 batches with before→after Rule #37 counts), a mechanically-derived disposition tally line, the Rule #37 determination, the Epic-36 forward-obligation warning (22 items across 2 batches at count 2 — **corrected at code review to 48 items across 5 batches**, see `35-0-CR-C`), an explicit "ledger state after this gate: unchanged" line (this story ships no product code), and a closing "Carried into the next retro-review gate" + Rule #37 watch line. Verified post-write via `git diff --stat` (50 insertions, 0 deletions) and `file` (still UTF-8 text, not corrupted) — Rule #55 compliance.
- No product code, tests, or governance surface touched (Constraints E-1/E-2 hold trivially — this story has no code path that could move `GOVERNANCE_BASELINE` or add a tool/action). `.vscode/settings.json` and `sprint-status.yaml` (beyond the skill's own status-transition write) were not touched.

### File List

- `_bmad-output/implementation-artifacts/deferred-work.md` (appended "Epic 35 retro-review gate (2026-08-17)" section; corrected at code review; new `35-0-CR-*` deferral section appended)
- `_bmad-output/implementation-artifacts/35-0-epic-34-deferred-cleanup.md` (this file — Tasks/Subtasks checked, Dev Agent Record filled in, Status updated, Review Findings added)
- `_bmad-output/implementation-artifacts/sprint-status.yaml` (status transitions `35-0` → `review`, `epic-35` → `in-progress`, plus the `last_updated` prose entry — written by the workflow, not hand-edited)

Not this story's files, changed in the same working tree by the lead: `_bmad-output/implementation-artifacts/cycle-log-epic-35.md` (lead-owned cycle log; untouched by dev, QA and code review).

## Review Findings (code review, 2026-08-17)

**Close kind: NORMAL (not degraded).** All three adversarial layers DELIVERED explicit findings payloads inside the 20-minute bounded-close window measured from a real armed clock (launch 16:52:30Z): Blind Hunter (13 findings), Edge Case Hunter (6), Acceptance Auditor (6). `failed_layers` empty, `review_degraded = false`. Rule #57 machinery exercised end-to-end on the story that arms it — frozen diff snapshot written before any layer launched, and every layer read that snapshot rather than the live tree.

Reviewed as a gate/triage story: no product code, no executable surface, so "no tests added" is the correct outcome and is not a finding.

### Resolved in review (patched here)

| # | Severity | Finding | Resolution |
|---|---|---|---|
| `35-0-CR-A` | **HIGH** | **AC 35.0.1 was false as written.** Triage rows #3/#4 cited `retro §7` but carried retro **§4** (Epic-33 follow-through) items. The real §7 #3 (beta distribution) and §7 #4 (npm publish, with its `prepublishOnly`-only gate caveat) were triaged nowhere — and the AC's own `grep` recount ran over the wrong six-row set, so it could not detect the substitution (Rule #56: a list wrong by omission passes every check written against it). | Split into a §7 table (6 rows) and a §4 carry-forward table (3 rows, incl. the previously-unlisted §4 #6 "Find a Copilot user"). §7 #4's engineering caveat ledgered as `35-0-CR-1`. Tally re-derived: 9 rows, 2 DROP / 7 DEFER. Applied to the story AND the ledger. |
| `35-0-CR-B` | **HIGH** | **The DEFER decomposition was not a decomposition.** Severity mix summed to 13 MEDIUM / 71 LOW against the ledger's authoritative 12 MEDIUM / 72 LOW for the same 84 items. Two off-by-ones cancelled in the total, which is exactly why the Open-column-only `awk` check stayed green: (a) `34-6-CR-8` counted as an open MEDIUM although it reached TERMINAL in Epic 34 (L2224/L2246) — reintroducing the very "stale-open" defect that `34-6-CR2-4` had already closed; (b) the last batch labelled "Story 32.4 / 33.x stragglers" and counted 15, when no Story-32.4 item is open at all and the true residual is 16 Epic-34 Stories 34.0–34.3 items. | 34.6 batch → **19 (4 MEDIUM · 15 LOW)**, `34-6-CR-8` dropped from its label. Final batch relabelled **"Epic-34 Stories 34.0–34.3 review residuals"** with its 16 IDs enumerated → **16 LOW**. New severity-reconciliation line + a severity-column `awk` added so the check can no longer be blind to this class. Corrected decomposition reconciles to 2 HIGH / 19 MEDIUM / 72 LOW = 93 **exactly**. |
| `35-0-CR-C` | **HIGH** | **Rule #37 count-2 population understated, in the unsafe direction.** Three batches were recorded `0 → 1` although the ledger explicitly records their items at count 1 already — L1975 (`34-1-R10/R11/R13/R14/R15/R16`), L2013 (`34-2-R6/R7/R10`) and L2116's blanket "remain deferred at Rule #37 count 1 … and all 43 LOW items" (2026-08-15, covering Story 34.4's 6 LOW and Story 34.5's 4 LOW too). The stated Epic 36 obligation of "22 items" would have let the burn-down trigger fire later than Rule #37 requires. | Batches 34.4, 34.5 and the 34.0–34.3 residuals corrected to **1 → 2**. Forward obligation restated as **48 items across five batches** (`17+5+6+4+16`), with 36 at count 1 (`48+36 = 84` ✓). **The ≥3 trigger still does NOT fire** — max count remains 2 — so Epic 35 correctly carries no burn-down story; only the Epic 36 forward obligation grows. |
| `35-0-CR-D` | MEDIUM | **Second instance of the non-reproducing-transcript class QA had already fixed once.** The ledger append recorded dispositions "mechanically confirmed via `grep -oE '\*\*(DROP\|DEFER)' 35-0-….md` → 2 DROP, 4 DEFER". Run verbatim it yields 15 `**DEFER` / 3 `**DROP`. QA scoped the *story's* copy and left the *ledger's* — the durable artifact — standing. | Both copies replaced with the row-anchored form (`grep -E '^\| (#[1-6]\|§4 #[0-9]) '`), which is self-match-proof and survives edits. All four Debug Log transcripts re-run and re-pinned from live output at review time (Rule #36). |
| `35-0-CR-E` | LOW | Dev Notes cited `33-1-R5` as the prose-terminal example explaining the parse delta. It is prose-terminal (L1849) but is an Epic-**33** LOW item, so it cannot explain a HIGH/MEDIUM-side delta, and it undercut the "LOW = 72 exactly" corroboration. | Replaced with the three actual prose-terminal items, named and located: `34-6-CR-8` (L2224), `33-5-L12` (L1868), `32-0-1` (L1723) — the exact 96-vs-93 delta a full row-parse produces. |
| `35-0-CR-F` | LOW | File List omitted `sprint-status.yaml`; triage intro claimed "88 defer … counted mechanically from the Decision column" when that column holds one cell per batch, not per item. | File List completed (with a note on the lead-owned cycle log); intro restated as 102 rows / 9 include / 91 defer / 2 drop with the derivation spelled out. |

### Dismissed (with evidence)

- **Blind Hunter — "the Epic-34-carried-MEDIUM batch's `1 → 2` is wrong; it should be `0 → 1` and the Epic 36 mandate is 17, not 22."** Refuted: `deferred-work.md` L1975 records `34-1-R5, R8, …` as **RE-DEFERRED (Rule #37 count 1)** in a mid-epic pass, and L2013/L2116 confirm it. The Blind layer is blind to the ledger by design, so it could not see this. The real correction runs in the **opposite** direction — see `35-0-CR-C`.
- **Blind Hunter — "the verification is circular; transcripts run against the story's own table, not the ledger."** Partly fair and now materially addressed by `35-0-CR-B`/`35-0-CR-C`, both of which were derived by re-deriving from `deferred-work.md` itself. The residual — that the story's table is the convenient parse surface — is inherent to a triage document; the new severity-reconciliation line ties it back to the ledger's authoritative recount, which is the non-circular anchor.
- **Edge Case Hunter — batch 8 is 17 items including `33-5-L12`.** `33-5-L12` is prose-terminal ("CORRECTED at the 33.5 close"), and treating it as open would make the client-config batch 18 and break the ledger's own 43-LOW checkpoint at L2116. 16 is correct; recorded in `35-0-CR-E` as one of the three prose-terminal items.
- **Blind Hunter — snapshot filename timestamp and `files=3 loc_added=55` omitting the story file.** Both concern `cycle-log-epic-35.md`, which is lead-owned and explicitly out of scope for dev, QA and review edits. Reported to the lead rather than patched.

### Deferred (ledgered)

| # | Severity | Finding | Where |
|---|---|---|---|
| `35-0-CR-1` | MEDIUM | **Publish-time gates are wired to `prepublishOnly` only — nothing on `prepack`/`prepare` — across all eight packages.** Inert for the planned `git clone` beta hand-off, but a tarball-based distribution (`npm pack`, CI artifact, vendored tgz) bypasses every gate silently, including the dist-freshness gate `34-6-CR-11` exists to enforce. Rule #59-shaped: a gate that does not run on the path in use. Recovered from retro §7 #4, whose engineering caveat this gate originally lost. | `deferred-work.md` → "Deferred from: code review of 35-0-epic-34-deferred-cleanup (2026-08-17)", Rule #37 count 0 |

### Noted and accepted (no change made, recorded so they are not silently dropped)

- **Blind Hunter — "AC 35.0.1's grep can never detect an omitted retro item."** Correct, and it is precisely how the `35-0-CR-A` omission survived. Partially mitigated: the recount now spans both source tables and reports a **row count** (9) alongside the token tally, so a missing row changes an observable number. It still cannot detect an item absent from the retro-side set; the durable fix is to count the retro's own `§7`/`§4` rows and assert equality, which belongs in the gate-story template rather than in this one instance. Flagged to the lead for the Epic 36 gate template.
- **Blind Hunter — "Rule #57 arming is a presence check never shown capable of failing" (Rule #59 shape).** Fair as a criticism of the Debug Log's evidence, and materially answered by this review itself: three layers were launched against a frozen snapshot, a real 20-minute clock was armed, and all three delivered explicit payloads — the mechanism was exercised end-to-end, not merely grepped for. That is the strongest available proof short of deliberately starving a layer, which would corrupt the review it is meant to certify.
- **Blind Hunter — "'ships no product code' explains why nothing is *resolved*, not why nothing is *closed-by-decision*."** A real observation about drift risk (a zero burn-down pre-excused at every code-free gate). It does not change this gate's outcome — the ≥3 trigger genuinely does not fire — but the Epic 36 gate now carries a 48-item count-2 obligation where "no code shipped" will **not** be an acceptable reason to re-defer, which is exactly the pressure the observation asks for.
- **Blind Hunter — undocumented derivations for `2,878 tests`, `109 tools`, `9/9 non-degraded`, `10 Epic 35 keys`.** These are context figures inherited from the Epic 34 retro and the sprint-planning log, not counts this gate produced or acts on. Left as-is rather than re-deriving Epic 34's numbers inside Epic 35's gate; the "10 keys" backstop wording belongs to the lead's sprint-planning entry.
- **Acceptance Auditor — "Task 3's first subtask tick was unearned"** (it says "derive from the ledger", the dev summed the story's own table). Accurate, and it is the mechanism by which `35-0-CR-B` and `35-0-CR-C` survived dev and QA. Now earned: both corrections were derived directly from `deferred-work.md`'s own recount chain (L1975 / L2013 / L2116 / L2224 / L2246 / L2338 / L2366), and the reconciliation is pinned in the table.
- **Blind Hunter — snapshot filename timestamp inversion, and `files=3 loc_added=55` omitting the 234-line story file.** Both concern `cycle-log-epic-35.md`, which is lead-owned; reported to the Project Lead, not patched here.

### Verified clean

- **AC 35.0.2** — `git merge-base --is-ancestor 6fe1763 origin/feature/feature-wave-4-classmethod-fidelity` re-run independently by two parties: **exit 0**. The epic's base is genuinely merged.
- **AC 35.0.4** — Rule #57 machinery confirmed by reading the step files, not the prose: frozen diff (`step-01` instr. 3), bounded close (`step-02` instr. 3, "do not proceed … until every launched layer is accounted for"), delivery receipts (`step-02`, "A bare timeout, an empty return, or silence is FAILED — never 'found nothing'"), `review_close_kind` DEGRADED gate (`step-04` §6). This review is itself the live proof.
- **Constraints E-1 / E-2** — the diff touches only four `_bmad-output/implementation-artifacts/` files; no product code, no tool, no action key, no generator run. Both hold trivially, as the story predicted.
- **Rule #55** — all changed files remain clean UTF-8 text with no NUL bytes; every edit made with file-writing tools, no heredocs.
- The 9 INCLUDE rows (2 HIGH / 7 MEDIUM), their story assignments against `epics.md`, and batches 1/2/6/7's open counts and severity mixes all verified item-by-item and correct.
