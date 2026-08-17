# Story 34.0: Epic 33 Deferred Cleanup — Rule #57 Review-Layer Discipline

Status: done

<!-- Created by the /epic-cycle retro-review gate (2026-08-14) from the Epic 33 retrospective + deferred-work.md. Triage table at the bottom of this file. -->

## Story

As a **pipeline lead running Epic 34's reviews**,
I want **the `bmad-code-review` skill to enforce bounded-close, frozen-diff, and delivery receipts**,
so that **a review can no longer close green on silent layers and then receive real HIGH findings after commit — the failure mode that hit 6/6 Epic-33 stories and shipped 2 HIGHs + 4 MEDIUMs past close.**

## Context — why this story exists

The Epic 33 retrospective's headline decision (§3.1, action item #5) was: **adopt all three remedies, codified as Rule #57**, and wire them into **the next epic's review spawn**. Epic 34 is that next epic, and its first review (Story 34.1) runs immediately after this story. If this story does not land first, Epic 34's reviews inherit the exact defect the retro closed.

Evidence from the Epic 33 retro:
- **6/6 stories** closed review with all three layers silent (Epic-32's RECORDE-AND-OBSERVE trigger fired on every story).
- Layers returned **post-commit** with ~50 findings; lead triage found **~40% stale** (they had reviewed a mutated tree) and **2 live HIGHs + 4 live MEDIUMs**, which required a gate-created cleanup story (33.5) to resolve.
- Retro takeaway #1: *"A layer that returns late is not a layer that worked… 'the net catches it eventually' is a cost center, not a control. Rule #57 makes the timing the control."*

**Scope boundary:** this story changes the **review skill's layer handling only**. It does NOT re-open any Epic 33 product code, and it does NOT touch the 17 carried `@iris-mcp/client-config` LOW ledger items (all re-deferred at triage — see the table at the bottom; Rule #37 permits it, this is their first deferral).

## Acceptance Criteria

- **AC 34.0.1 — Delivery receipts.** `steps/step-02-review.md` distinguishes a **failed** layer from a layer that **found nothing**. A layer counts as delivered ONLY when it returns an explicit findings payload — including an explicit *empty-findings* payload for a genuine clean result. Absence of a payload (no return, timeout, empty string, unparseable output) is recorded as **FAILED** in `{failed_layers}`, never as "found nothing". The step file states this distinction in terms a subsequent LLM run cannot collapse back into the old permissive reading.

- **AC 34.0.2 — Frozen diff.** The diff the layers review is captured as a **snapshot at review start** and the layers read that snapshot, so a late-returning layer's findings can never be stale against a tree that has since been patched. `{diff_output}` is persisted to a snapshot file under `{implementation_artifacts}` (name it deterministically per review, e.g. keyed by `{story_key}`), written in `step-01` after `{diff_output}` is constructed and non-empty; `step-02` passes the **snapshot** to every layer. `step-01`'s "Do not modify any files. This step is read-only." rule is amended to sanction exactly this one write (the rule exists to stop the review mutating the code under review — the amendment must say so, not just delete the constraint).

- **AC 34.0.3 — Bounded close.** A review MUST NOT reach `{new_status}` = `done` while any layer is outstanding. `step-02` blocks on layer return up to a **hard, documented timeout** (state the value explicitly in the step file). On timeout, the layer goes to `{failed_layers}` and the close is recorded as **DEGRADED** — a first-class, named outcome, not the normal path. `step-04-present.md` §6's status rule is amended so a degraded review cannot silently produce `done`: the degraded state is surfaced in the presented summary AND written into the story file's review record, so the lead sees it at the smoke/commit gate.

- **AC 34.0.4 — Degraded close is visible downstream.** The `cr_complete` evidence a lead reads (the skill's final summary and the story file's Review Findings section) names which layers failed and that the close was degraded. A reader of the story file alone can tell a degraded close from a clean one without re-running anything.

- **AC 34.0.5 — Back-compat (Rule #19).** The all-layers-return path behaves exactly as today: same triage buckets, same patch-application flow, same `done`/`in-progress` decision, same sprint-status sync. The only behavioral deltas are on the failure/timeout/empty paths. State this explicitly in the changed step files so a future editor does not "simplify" the happy path.

- **AC 34.0.6 — Ledger + rules hygiene.** `deferred-work.md` records the 17 carried Epic-33 LOW items as **re-deferred at the Epic 34 retro-review gate (first re-deferral, Rule #37 count = 1)** with the gate date, so the next epic's gate sees an accurate consecutive-deferral count. `project-rules.md` Rule #57 gains a one-line pointer that it is now **implemented** in the review skill (the rule text itself does not change; it is already correct). Do NOT renumber or add rules — next new rule stays **#59**.

## Tasks / Subtasks

- [x] **Task 1 — Delivery receipts** (AC: 34.0.1)
  - [x] Rewrite `steps/step-02-review.md` instruction 3 to define delivered-vs-failed on payload presence, with the empty-findings payload as the ONLY way to report a clean layer.
  - [x] Make the layer prompts in instruction 2 require the explicit empty-findings payload when a layer finds nothing (all three roles: Blind Hunter, Edge Case Hunter, Acceptance Auditor).
- [x] **Task 2 — Frozen diff** (AC: 34.0.2)
  - [x] In `step-01-gather-context.md` instruction 3, persist `{diff_output}` to a deterministic snapshot path after the non-empty check; add the snapshot path as a runtime variable in the step's frontmatter.
  - [x] Amend step-01's read-only RULE to sanction the snapshot write, stating the rule's actual intent (no mutation of the code under review).
  - [x] In `step-02-review.md`, pass the snapshot to all three layers.
- [x] **Task 3 — Bounded close** (AC: 34.0.3, 34.0.4)
  - [x] Add the blocking-with-hard-timeout behavior to `step-02-review.md`; state the timeout value.
  - [x] Introduce the DEGRADED outcome and thread it to `step-03-triage.md` (its instruction 5/6 already warn on `{failed_layers}` — extend, don't duplicate) and `step-04-present.md` §6.
  - [x] Amend `step-04-present.md` §6 so a degraded review's status decision and presented summary both carry the degraded marker, and it lands in the story file's review record.
- [x] **Task 4 — Back-compat statement** (AC: 34.0.5)
  - [x] Add the explicit "happy path unchanged" note to the changed step files.
- [x] **Task 5 — Ledger + rules** (AC: 34.0.6)
  - [x] Append the re-deferral record for the 17 items to `deferred-work.md` (see triage table below for the exact tag list).
  - [x] Add the one-line "implemented in `.claude/skills/bmad-code-review/steps/`" pointer to Rule #57 in `.claude/rules/project-rules.md`.

## Dev Notes

### Exact seams — verified live on the current tree (2026-08-14)

Do not go hunting; these are the four files and the precise lines that carry today's behavior:

| Seam | File | Current text (the defect) |
|---|---|---|
| Receipts + bounded close | `.claude/skills/bmad-code-review/steps/step-02-review.md` **instruction 3** | *"If any subagent fails, times out, or returns empty results, append the layer name to `{failed_layers}` (comma-separated) and proceed with findings from the remaining layers."* — conflates failed/timeout/empty, and **proceeds** rather than blocking. This one sentence is the whole Rule #57 defect. |
| Frozen diff (capture) | `.claude/skills/bmad-code-review/steps/step-01-gather-context.md` **instruction 3** | `{diff_output}` is built in memory only; frontmatter declares `diff_output: ''  # set at runtime`. Step RULE says *"Do not modify any files. This step is read-only."* |
| Frozen diff (consumption) | `.claude/skills/bmad-code-review/steps/step-02-review.md` **instruction 2** | All three layers receive `{diff_output}` (the live in-memory value). |
| Degraded close | `.claude/skills/bmad-code-review/steps/step-04-present.md` **§6** (lines ~86-108) | *"If all `decision-needed` and `patch` findings were resolved … AND no unresolved HIGH/MEDIUM issues remain: set `{new_status}` = `done`."* — `{failed_layers}` is **not** a term in this decision, so a review with three dead layers and zero findings closes `done`. |

Related existing behavior to **extend, not duplicate**: `step-03-triage.md` instruction 5 already reports failed layers and already warns that a zero-finding review with non-empty `{failed_layers}` "may be incomplete". That warning is the right instinct but it is advisory only — it does not stop step-04 from writing `done`. Rule #57's bounded-close is what makes it binding.

### Rule #57 verbatim (the spec for this story)

From `.claude/rules/project-rules.md`:

> **#57 — Review layers: bounded-close, frozen diff, delivery receipts.** … Rule: (a) BOUNDED-CLOSE — a review may not close while its layers are outstanding: the lead blocks on layer return or a hard documented timeout, and a timeout close is recorded as degraded, not normal; (b) FROZEN-DIFF — layers review a frozen diff snapshot captured at review start, so a late return can never be stale against a patched tree; (c) DELIVERY RECEIPTS — no findings file = the layer FAILED, never "found nothing"; "found nothing" requires an explicit empty-findings payload.

The rule text is already correct and **must not be edited** beyond the AC 34.0.6 implemented-pointer line.

### Constraints and anti-patterns

- **These are prompt/instruction files, not code.** The deliverable is unambiguous instruction text that a future LLM run cannot re-collapse into the permissive reading. Precision of wording IS the implementation. Do not add code, scripts, or tests that "enforce" the skill — the skill is executed by an LLM reading the step files.
- **No test suite applies here.** `.claude/skills/**` is outside the pnpm workspace (`pnpm-workspace.yaml` globs `packages/*` only). Do NOT add vitest files for this story, and do NOT expect `turbo run test` to cover it. QA's tier for this story is a **reading/consistency check** across the four step files (see Testing below), not a code test.
- **Do not touch `packages/**` or `src/ExecuteMCPv2/**`.** This story is skill-file-only plus two doc files (`deferred-work.md`, `project-rules.md`). Any diff outside those is out of scope.
- **Do not renumber rules.** `project-rules.md` is at 58; next new rule is #59. This story adds NO new rule.
- **Rule #55** — do not generate any of these file edits through a shell heredoc; use the file-editing tools directly.
- **Keep `project-rules.md` lean** (Rule #1 + the lead's standing preference): the Rule #57 addition is ONE line, not a narrative of this story.

### Self-referential caution

This story edits the very skill that will review this story. The review of Story 34.0 itself will run through `bmad-code-review` — most likely already carrying these edits, since the skill is re-read per spawn. That is intended (the retro asked for it to be live for Epic 34's reviews) but it means: **if the edits are wrong, the review that would catch them is the one running on them.** Be conservative — the bounded-close timeout must be a real, finite, documented value, and the degraded path must not be able to deadlock a review. A review that can never close is a worse failure than one that closes degraded.

### Testing

No automated tier exists for skill files. Verification for this story is:
1. **Consistency read** across all four step files: every variable introduced (`{failed_layers}`, the snapshot path, the degraded marker) is declared in the frontmatter of the step that sets it and consumed with the same name where it is read. A dangling variable name is the most likely defect class here.
2. **Sequence read**: step-01 → 02 → 03 → 04 still form a coherent, non-contradictory instruction chain; no step tells the runner to do something a later step forbids.
3. **Negative read**: confirm the happy path (all three layers deliver) reads identically in effect to the pre-change text (AC 34.0.5).

### References

- [Source: `_bmad-output/implementation-artifacts/epic-33-retro-2026-07-28.md#3.1`] — the 6/6 silent-layer pattern and the ADOPT-ALL-THREE disposition
- [Source: `_bmad-output/implementation-artifacts/epic-33-retro-2026-07-28.md#7`] — action item #5, owner "Lead / pipeline", type "process"
- [Source: `.claude/rules/project-rules.md#57`] — the rule text this story implements
- [Source: `.claude/rules/project-rules.md#37`] — re-deferral counting for the carried ledger items
- [Source: `.claude/skills/bmad-code-review/steps/step-01-gather-context.md`, `step-02-review.md`, `step-03-triage.md`, `step-04-present.md`] — the four seams

---

## Retro-Review Triage — Epic 33 → Epic 34 (gate run 2026-08-14)

Sources: `epic-33-retro-2026-07-28.md` (action items §7) and `deferred-work.md` (unresolved ledger rows, counted mechanically per Rule #51 — **44** distinct tags, 17 unresolved). Recount at review (Rule #51): 44 distinct ledger tags total = 25 Epic-32 (all terminal via Story 32.4 + the 32-0-1/32-2-U1 closures) + 19 Epic-33, of which 33-1-R5 (RESOLVED in Story 33.2) and 33-5-L12 (CORRECTED at the 33.5 close) are closed, leaving **17 open** — the 17 re-deferred below. The "43" in the pre-review draft was off by one; the load-bearing 17 was correct.

### Retrospective action items

| Item | Source | Triage Decision |
|---|---|---|
| #1 Publish decision for `@iris-mcp/*` (carried from Epic 31 phase-2) | retro §7 | **DEFER — Project Lead decision, not implementable.** Surfaced to the lead at the Epic 34 merge gate. Does not block Epic 34 (ObjectScript handler + dev-tool scope needs no publish). |
| #2 AC 33.3.4 GUI smoke | retro §7 | **DROP — already ✅ DONE 2026-07-28** (full 7-step pass recorded in the 33-3 story). |
| #3 Kimi Code VS Code extension half of AC 33.4.4 | retro §7 | **DEFER — Project Lead manual verification**, requires installing a third-party extension. Not pipeline work; orthogonal to Epic 34. |
| #4 Post-publish re-certification | retro §7 | **DEFER — blocked on #1.** Cannot start until the publish decision lands. |
| #5 **Rule #57 implementation** into the next epic's review spawn | retro §7 | **INCLUDE — this story.** Epic 34 IS the next epic; its first review runs immediately after. Highest-value carried item and the only one that is both actionable and time-critical. |
| #6 Find a Copilot user (carried from Epic 31) | retro §7 | **DEFER — external dependency**, no Copilot user on the project. Residual risk, unchanged. |

### Deferred-work ledger — 17 unresolved items, all LOW

All 17 are in `@iris-mcp/client-config` (Epic 33's package), entirely orthogonal to Epic 34's scope (`ExecuteMCPv2.REST.Command` ObjectScript handler + the `iris_execute_classmethod` TS tool in `@iris-mcp/dev`). Per Rule #37 every one is on its **first** deferral, so re-deferral is a valid disposition; the epic's own scope note in `epics.md` anticipates exactly this. Pulling them in would convert this story into an unrelated Epic-33 maintenance batch.

| Item | Source | Triage Decision |
|---|---|---|
| 33-1-R1 Stale stash record survives an already-in-state enable no-op | deferred-work.md | **DEFER** (first re-deferral) |
| 33-1-R2 CRLF TOML `set-flag` splices LF-only lines | deferred-work.md | **DEFER** — pair with 33-5-R1 (same root cause; fix as one terminator-aware line model) |
| 33-1-R3 Comments inside a manager-owned JSONC entry not stash-round-tripped | deferred-work.md | **DEFER** |
| 33-1-R4 Backup names collide within the same millisecond | deferred-work.md | **DEFER** |
| 33-5-L1 Native-flag strict-equality (`disabled: 1` reads enabled) | deferred-work.md | **DEFER** |
| 33-5-L2 Tests shipped in dist | deferred-work.md | **DEFER** — suite-wide convention decision, not a per-package fix |
| 33-5-L3 Proof-surface gaps: spy coverage, marker sweep | deferred-work.md | **DEFER** |
| 33-5-L4 Shareable pin forces codex `shareable: true` | deferred-work.md | **DEFER** |
| 33-5-L5 Duplicate JSON keys: first-vs-last wins | deferred-work.md | **DEFER** |
| 33-5-L6 Non-object canonical value invisible | deferred-work.md | **DEFER** |
| 33-5-L7 appDir platform-completeness pin | deferred-work.md | **DEFER** |
| 33-5-L8 TOML top-not-object branch unreachable | deferred-work.md | **DEFER** — Rule #54-adjacent; decide at the next `readers.ts` touch |
| 33-5-L9 certify: rung-2 unexercised; flags Set-as-map; excerpt truncation; `--skip-agent` | deferred-work.md | **DEFER** |
| 33-5-L10 certify: no mutual exclusion; timedOut unconsumed; dangling symlink | deferred-work.md | **DEFER** |
| 33-5-L11 doctor `$$` false positive; walkEntry recursion | deferred-work.md | **DEFER** |
| 33-5-R1 TOML merge-update splices LF-only lines into a CRLF file | deferred-work.md | **DEFER** — pair with 33-1-R2 |
| 33-5-R2 merge-update drops comments on CHANGED managed lines / env table | deferred-work.md | **DEFER** |

**Tally (mechanical, Rule #51): 23 items triaged — 1 include, 21 defer, 1 drop.**

**Rule #37 watch:** all 17 ledger items are now at **1 consecutive re-deferral**. A dedicated burn-down story becomes mandatory at 3.

---

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via bmad-dev-story.

### Debug Log References

None — prompt/instruction-text edits only, no code executed.

### Completion Notes List

- **AC 34.0.1 (delivery receipts):** `step-02-review.md` instruction 3 rewritten as the load-bearing DELIVERED-vs-FAILED definition: DELIVERED requires an explicit findings payload (findings OR an explicit empty-findings statement); FAILED covers error/crash, empty/unparseable return, and timeout — a bare timeout or silence is explicitly never "found nothing". Instruction 2 now requires every layer invocation (Blind Hunter, Edge Case Hunter, Acceptance Auditor) to demand an explicit empty-findings payload when clean.
- **AC 34.0.2 (frozen diff):** `step-01-gather-context.md` instruction 3 gained a snapshot-write sub-step after the non-empty check, writing `{diff_output}` verbatim to `{diff_snapshot_path}` (`{implementation_artifacts}/review-diff-snapshot-{key}.diff`, keyed by `{story_key}` or a UTC timestamp fallback); `diff_snapshot_path` added to step-01 frontmatter. The read-only RULE was amended to sanction exactly this one write, stating the rule's real intent (no mutation of the code under review) rather than being silently weakened. `step-02-review.md` instruction 2 now passes the frozen snapshot to all three layers instead of the live `{diff_output}`.
- **AC 34.0.3 / 34.0.4 (bounded close, degraded visibility):** `step-02-review.md` instruction 3 adds a hard, documented **20-minute-per-layer timeout**, blocks step-03 until every launched layer is DELIVERED or FAILED-by-timeout, and sets `{review_degraded}` (frontmatter-declared) once every layer is accounted for. `step-03-triage.md` instructions 5/6 extended (not duplicated) to pass `{review_degraded}` through unchanged and to stop a zero-findings result from reading as a clean pass when degraded. `step-04-present.md` gained a degraded-first gate in section 6 (`{review_degraded}` = true ⇒ `{new_status}` can never be `done`, `{review_close_kind}` = `DEGRADED`), a `{review_close_kind}` frontmatter variable, and DEGRADED surfacing in three places: the story file's `### Review Findings` subsection (section 2), the presented summary (section 3), and the completion summary block (section 6) — satisfying "a reader of the story file alone can tell a degraded close from a clean one".
- **AC 34.0.5 (back-compat):** each changed step file carries an explicit back-compat sentence tied to its own instruction (step-01 instruction 3, step-02 instruction 3, step-03's trailing note, step-04 section 6's "Otherwise" branch) stating the happy path is unchanged when every layer delivers. The self-referential concern (this story's own review runs through these edited steps) was addressed by keeping the timeout finite (20 min/layer, not unbounded) and ensuring the degraded path always resolves to `in-progress` rather than deadlocking.
- **AC 34.0.6 (ledger + rules hygiene):** `deferred-work.md` gained a new `## Epic 34 retro-review gate (2026-08-14)` section recording all 17 carried `@iris-mcp/client-config` LOW items (33-1-R1..R4, 33-5-L1..L11, 33-5-R1..R2) as RE-DEFERRED at Rule #37 count 1, with a mechanical disposition tally (Rule #51) and the Epic-33-retro action-item disposition summary. `project-rules.md` Rule #57 gained exactly one appended sentence — "Implemented in `.claude/skills/bmad-code-review/steps/` (Story 34.0)." — no other text changed, no renumbering; next new rule stays #59.
- **Consistency/sequence read (story's own verification tier, since no automated tier applies to `.claude/skills/**`):** re-read all four step files after editing — every introduced variable (`diff_snapshot_path`, `review_degraded`, `review_close_kind`) is declared in the frontmatter of the step that sets it and consumed by name, unchanged, downstream (matching the existing `failed_layers` convention of declare-once-at-source); step-01 → 02 → 03 → 04 forms a coherent chain with no step contradicting a later one; the happy path (all three layers deliver) reads identically in effect to the pre-change text.
- Scope respected: only the four step files plus `deferred-work.md`, `project-rules.md`, and this story's own tracking files (story file, `sprint-status.yaml`) were touched. No `packages/**` or `src/ExecuteMCPv2/**` changes; no vitest added (`.claude/skills/**` is outside the pnpm workspace per `pnpm-workspace.yaml`).
- Changes left UNCOMMITTED for the lead's per-story smoke gate + commit, per repo convention.

### File List

- `.claude/skills/bmad-code-review/steps/step-01-gather-context.md`
- `.claude/skills/bmad-code-review/steps/step-02-review.md`
- `.claude/skills/bmad-code-review/steps/step-03-triage.md`
- `.claude/skills/bmad-code-review/steps/step-04-present.md`
- `.claude/rules/project-rules.md`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`
- `_bmad-output/implementation-artifacts/34-0-epic-33-deferred-cleanup.md` (this file — Status, Tasks/Subtasks, Dev Agent Record)

### Review Findings (2026-08-14, bmad-code-review — full 3-layer pass)

**Review outcome: CLEAN (not degraded).** All three layers — Blind Hunter, Edge Case Hunter, Acceptance Auditor — DELIVERED an explicit findings payload inside the 20-minute hard window (~3.5 / ~4.3 / ~4.6 min). `{failed_layers}` empty, `{review_degraded}` = `false`. This is the first review since Epic 32 in which every launched layer delivered before close, and it is live evidence that the bounded-close gate this story introduces does not deadlock: the gate held, then released normally.

**Self-referential note:** this review executed the very step files under review, already carrying the change. The frozen-diff snapshot, the delivery-receipt classification, and the bounded-close gate were all exercised for real, not simulated.

2 HIGH / 6 MEDIUM / 3 LOW raised; 2 HIGH + 6 MEDIUM + 1 LOW patched in-review, 2 LOW deferred, 0 decision-needed.

- [x] [Review][Patch] **HIGH — Clean-review shortcut bypassed the only story-file DEGRADED write** [.claude/skills/bmad-code-review/steps/step-04-present.md:19] — section 1's zero-findings shortcut jumped straight to section 6, and section 2 was the ONLY place that writes the `⚠ DEGRADED REVIEW` marker into the story file. Because silent layers produce zero findings, the most probable degraded outcome (the exact Epic-33 6/6 scenario) left the story file showing only `Status: in-progress`, indistinguishable from an ordinary in-progress close — violating AC 34.0.4's "a reader of the story file alone can tell". Found independently by the Acceptance Auditor and the reviewer-direct pass. **Fixed:** section 1 now carries an explicit exception requiring section 2's degraded write before proceeding, with a zero-findings placeholder line.
- [x] [Review][Patch] **HIGH — Blind Hunter's own skill contradicts AC 34.0.1** [.claude/skills/bmad-review-adversarial-general/SKILL.md:36] — that skill still reads `HALT if zero findings — this is suspicious, re-analyze or ask for guidance`, while step-02 only *referenced* the empty-findings requirement for this role ("appended to its brief") instead of embedding it as it did for the Acceptance Auditor. A genuinely clean Blind Hunter therefore halts, delivers no payload, and is recorded FAILED — manufacturing a **false** DEGRADED close and eroding trust in the gate as fast as a missed one. **Fixed:** step-02 instruction 2 now defines an EMPTY-FINDINGS CLAUSE to be pasted verbatim into every layer's brief, containing an explicit override of any skill-level halt-on-zero-findings condition, plus a note on why the override is load-bearing.
- [x] [Review][Patch] **MEDIUM — Snapshot filename collided on re-review, defeating FROZEN-DIFF** [.claude/skills/bmad-code-review/steps/step-01-gather-context.md:45] — the path was keyed on `{story_key}` alone. A DEGRADED close routes to `in-progress` and step-04 §7 offers "Re-run code review", so a second run of the same story is an ordinary path — and it overwrote the first run's snapshot in place, so a still-outstanding layer that re-reads the path would silently review the NEW diff, defeating the guarantee in exactly the late-return case it exists for. **Fixed:** the path now carries a per-run UTC timestamp (`-{run}`), with the rationale stated so it is not "simplified" away.
- [x] [Review][Patch] **MEDIUM — Snapshot artifact had no cleanup and was not excluded from version control** [.claude/skills/bmad-code-review/steps/step-01-gather-context.md:45] — a 126 KB `.diff` landed untracked in `_bmad-output/implementation-artifacts/` with no disposal instruction anywhere in steps 01-04. Since the lead commits the tree after the smoke gate, review scratch would have been committed; it would also be swept into a later review's own diff. **Fixed:** `.gitignore` now excludes `review-diff-snapshot-*.diff` (verified with `git check-ignore`; the file no longer appears in `git status`), plus a retention note in step-01 and a disposal subsection in step-04 §6.
- [x] [Review][Patch] **MEDIUM — Manual-paste fallback bypassed the bounded-close gate entirely** [.claude/skills/bmad-code-review/steps/step-02-review.md:20] — "resume from this point and proceed to step 3" is ambiguous between *instruction 3* (the new gate) and *step-03-triage.md*; under the latter reading `{review_degraded}` is never set, so a paste-back review in which the user ran only one layer closes `done` with no degraded marker — the Rule #57 defect surviving intact in a branch this project has demonstrably used. **Fixed:** disambiguated to "instruction 3 of this step file" with the consequence spelled out, plus per-role DELIVERED/FAILED classification for pasted payloads and an explicit carve-out so the human round-trip is not falsely timed out.
- [x] [Review][Patch] **MEDIUM — No handling for a payload arriving after FAILED-by-timeout** [.claude/skills/bmad-code-review/steps/step-02-review.md:31] — the design bounds the wait but never says what to do when a timed-out layer eventually returns, which is precisely the Epic-33 incident. Raised by the Edge Case Hunter; confirmed by grep (no discard/reopen/late path anywhere in steps 01-04). **Fixed:** late arrivals are triaged against the CURRENT tree, do not retroactively un-degrade the close, and route to the story file or the deferred-work ledger flagged as post-close.
- [x] [Review][Patch] **MEDIUM — The 20-minute timeout named no execution mechanism** [.claude/skills/bmad-code-review/steps/step-02-review.md:35] — all three layers flagged this, two rating it HIGH/unenforceable. Downgraded to MEDIUM on evidence: this run enforced it for real with a backgrounded 20-minute timer racing async layer-completion notifications, so it *is* enforceable — but the step file left it unspecified, risking a nominal "I waited" with no clock behind it. **Fixed:** step-02 now names a concrete mechanism, warns against estimating elapsed time internally, and requires a DEGRADED close if no timer mechanism is available rather than claiming an unenforced bound.
- [x] [Review][Patch] **MEDIUM — "MUST NOT reach done" stated as absolute while its enforcing section is skippable** [.claude/skills/bmad-code-review/steps/step-04-present.md:13] — section 6 opens "Skip this section if `{spec_file}` is not set", so the invariant's enforcement vanishes in `no-spec` mode while the RULES bullet acknowledged no precondition. Verified harmless (that path sets no `{new_status}` at all, so `done` stays unreachable) but imprecise in a file whose stated goal is to be uncollapsible. **Fixed:** the bullet now states the precondition and that `no-spec` mode has no durable degraded surface.
- [x] [Review][Patch] **LOW — Hand-authored tally off by one (Rule #51)** [_bmad-output/implementation-artifacts/34-0-epic-33-deferred-cleanup.md:112] — the triage header claimed "43 distinct tags"; mechanical recount gives **44** (25 Epic-32 + 19 Epic-33). The load-bearing 17-open figure was independently re-derived and is **correct** (19 Epic-33 tags minus 33-1-R5, resolved in Story 33.2, and 33-5-L12, corrected at the 33.5 close). **Fixed:** corrected to 44 with the derivation recorded inline.
- [x] [Review][Defer] **LOW — `{review_degraded}`/`{failed_layers}` have no durable persistence during the wait window** [.claude/skills/bmad-code-review/steps/step-02-review.md:2] — deferred, inherent to LLM-executed prompt state; see `deferred-work.md`.
- [x] [Review][Defer] **LOW — `{story_key}` is never discovered on the invocation-text branch** [.claude/skills/bmad-code-review/steps/step-01-gather-context.md:26] — deferred, pre-existing; see `deferred-work.md`.

**Verified and NOT defects.** The bounded close cannot deadlock — the timeout is finite and forcing, so every layer reaches a terminal classification and the review always reaches a terminal status. There is no path on which `{review_degraded}` = `true` yet `{new_status}` = `done`. AC 34.0.5 back-compat holds against the pre-change text: the `done`/`in-progress` bullets are reproduced character-for-character behind an `Otherwise` branch that fires only when nothing changed. Rule #57's addition is exactly one appended sentence with no renumbering (rules 1-58 all present, "next new rule #59" intact, Rule #1 lean). No `packages/**` or `src/ExecuteMCPv2/**` contact; no vitest expected or added (`pnpm-workspace.yaml` globs `packages/*` only, confirming `.claude/skills/**` is outside the workspace). No NUL bytes or binary corruption in any edited file (Rule #55). `sprint-status.yaml` still parses (239 keys). The Rule #54 reachability lens was applied to every new branch — DEGRADED, FAILED-by-timeout, FAILED-by-empty-return and CLEAN/NORMAL are all producible by a real run; no unreachable branch was introduced.
