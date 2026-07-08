---
description: Run the BMAD Method epic development cycle for one or more epics
---

You are executing the BMAD Method development implementation cycle for one or more epics. Stories run sequentially by default; independent stories within the same epic may be processed as a parallel batch — see "Smart Parallelism" below.

**Epic range:** $ARGUMENTS (e.g., `1-3` for Epics 1 through 3, `2` for a single epic). If empty, prompt the user for the range.

## Pre-flight Runtime Check

Uses the standard `Agent` tool to spawn pipeline-stage subagents and the `Skill` tool for lead-side skill invocations. No experimental flag required.

If `Agent` is a deferred tool, load its schema via `ToolSearch` with `"select:Agent"` before first use. If `Agent` is unavailable, halt and surface to the user.

## Task Sequence

**Per Epic (setup, executed once per epic before any stories):**

1. **Lead** verifies a clean working tree across the parent repo and every submodule listed in `.gitmodules`; halts on dirty state.
2. **Lead** determines per-repo resume mode (see "Resume Semantics").
3. For repos in FRESH mode: **Lead** verifies (or creates with user authorization) the feature branch per Rule SC-1, then verifies (or creates) the epic branch `{TICKET}-epic{N}` per Rule SC-2.
4. **Lead** checks every affected repo out to `{TICKET}-epic{N}` and logs `epic_branch_checked_out`.
5. **Lead** executes `/bmad-sprint-planning` directly.
6. If a previous epic's retrospective or `deferred-work.md` has unresolved items, **Lead** reviews them, triages, and creates Story X.0 via `/bmad-create-story` (see "Retrospective Review & Story X.0 Creation").

**Per Story (executed once per story in the epic):**

1. **Lead** executes `/bmad-create-story` directly (no agent — prevents race-ahead), passing the explicit story ID; never let the skill self-select the "next" story.
2. Agent: `/bmad-dev-story` (explicit story file path in the spawn prompt).
3. **Lead** executes any ADR-tooled AC verifications (see "ADR-Aware Execution").
4. Agent: `/bmad-qa-generate-e2e-tests` (scope pre-answered to this story's deliverable).
5. Agent: `/bmad-code-review`. If the review leaves the story `in-progress` (unresolved high/medium findings), run the Rework Loop (max 3 iterations) before proceeding.
6. **Lead** performs per-story smoke (see "Per-Story Smoke").
7. **Lead** commits and pushes — **only to the epic branch** in every affected repo, never to main/master/develop (Rule SC-3 + SC-6).

**End of Epic (executed once per epic after all stories):**

1. **Lead** sets `epic-{N}: done` in `sprint-status.yaml` — the one status transition the skills never write (see "Status Ownership") — and logs `epic_status_done`.
2. **Lead** pauses: "Run a retrospective?" If yes, execute `/bmad-retrospective` fully interactive — the human-in-the-middle exception; see "Retrospective Per Epic".
3. **Lead** pauses: "Merge `{TICKET}-epic{N}` into the feature branch and delete the epic branch (local + remote)?" — per Rule SC-4. If yes, execute the merge in each affected repo (submodules-first, parent last).

## Execution Guidelines

Each pipeline-stage task is delegated via the `Agent` tool. Lead-side skills (sprint planning, story creation, retrospective) are invoked directly via the `Skill` tool. If a stage-agent's return is missing closing-summary sections, the lead extracts the file list from `git status --short` against the story's `Files to Modify` table — this is normal extraction.

`/bmad-code-review` triages findings into **decision-needed / patch / defer / dismiss** buckets at **low / medium / high** severity. Under `/epic-cycle` the review agent applies every patch-bucket finding and resolves decision-needed items using best judgment plus the BMAD skill rules; only a genuine user-preference or spec-contradiction question comes back as `## Clarification Needed`. The BMAD skills must be invoked via `Skill`; don't skip steps. `/bmad-retrospective` is the one deliberate human-in-the-middle exception to the autonomous loop — it MUST run in interactive mode, and every one of its elicitation stops must reach the user.

## Permission Mode (Critical)

All `Agent` tool calls must include `mode: "bypassPermissions"`. Without it the subagent prompts for every file edit and bash command and the pipeline stalls. `bypassPermissions` does NOT auto-answer `AskUserQuestion` — that tool always elicits the human. Therefore `/bmad-retrospective` is lead-only (spawned subagents cannot reliably surface their elicitation). Run unattended cycles only in a trusted/isolated environment; where the harness offers the `auto` permission mode with a configured environment, that is an acceptable safer substitute.

Pipeline-stage subagents must be spawned **synchronously** — never backgrounded. A backgrounded subagent never hands control back in an unattended run and the pipeline stalls (this is why `bmad-dev-auto` mandates synchronous subagent calls). Parallel batches are still synchronous: N `Agent` calls in ONE message resolve together.

## Model Strategy (Critical for cost + quality)

The pipeline runs **efficient implementer + expensive reviewer**: a Sonnet-tier model writes code and tests; an Opus-tier model reviews them. This also satisfies BMAD's own guidance that code review should run in "fresh context, ideally different LLM" than the implementer.

Per-skill model pinning ("skill optimization" — writing `model:` into each SKILL.md's frontmatter) is an **optional, per-project** pass: upstream BMAD v6 ships no `model:` frontmatter, the field is not an officially documented SKILL.md field, and some projects deliberately skip the pass. `/epic-cycle` must behave identically either way, so the command carries the default stage→model map itself:

| Stage | Skill | Model | Why |
| --- | --- | --- | --- |
| Dev | `/bmad-dev-story` | `sonnet` | Near-Opus coding quality; the Opus-authored story spec and the Opus review layer carry the hard judgment |
| QA | `/bmad-qa-generate-e2e-tests` | `sonnet` | Bounded test implementation |
| Code review | `/bmad-code-review` | `opus` | Adversarial quality gate. The skill instructs its internal review subagents (Blind Hunter, Edge Case Hunter, Acceptance Auditor) to "run at the same model capability as the current session" — the model passed on this spawn propagates to the parallel reviewers, so review MUST NOT run on a lighter model than the implementation. |

On an **unpinned** project the map is the operative source. On a **pinned** project frontmatter resolves first and normally agrees with the map; if a pin disagrees, the pin wins — treat it as a deliberate project re-pin (never "correct" it), and the `model=` telemetry records what actually ran either way.

Lead-run gate skills (sprint planning, story creation, retrospective, ADR verifications, smoke) execute inline on the lead's model — run the lead on an Opus-tier model so story creation, the highest-leverage context-fusion step, gets maximum judgment.

## Skill Tool Invocation (Critical)

All BMAD skills must be invoked via the **`Skill` tool**, not interpreted inline. Agent spawn prompts must explicitly state: "use the `Skill` tool to invoke /bmad-dev-story" (or the relevant skill). Without this directive, agents may try to execute skill logic themselves.

## Agent Invocation Pattern (Required)

Each pipeline-stage subagent is a single `Agent` tool call. The `Agent` tool returns the agent's final assistant message as its result — that is the completion signal. No separate envelope, no team membership, no shutdown handshake.

For each pipeline stage, the lead:

1. **Resolves the stage's model.** Resolution order: (a) if the stage skill's YAML frontmatter — `.claude/skills/<skill-name>/SKILL.md`, or the plugin-namespaced install path — declares a `model:` field (e.g. `opus` / `sonnet` / `haiku`), that wins (a project may have re-pinned a skill); (b) otherwise use the Model Strategy map above (dev → `sonnet`, qa → `sonnet`, code-review → `opus`); (c) for a stage not in the map, omit the parameter and let the sub-agent inherit the lead's model. Read the actual frontmatter — do not assume. On a vanilla BMAD install (b) is the operative source (upstream v6.10 ships no `model:` frontmatter); projects that ran a model-pinning pass over their skills resolve via (a), and the pins normally agree with the map.
2. **Spawns** the subagent via `Agent` with:
   - `subagent_type: "general-purpose"` (or a specialized type if configured)
   - `model: <the model resolved in step 1>` — pass this so the stage runs on the model the pipeline intends, NOT the lead's inherited model. Omit the parameter only when step 1 resolved nothing (stage not in the map and no frontmatter declaration).
   - `mode: "bypassPermissions"`
   - `description: <3-5 word task description>`
   - `prompt: <full task — see Spawn Prompt Skeleton below>`
3. **Reads** the returned message for closing-summary sections (`## Files Modified`, `## Tests Added`, `## Decisions`, `## Issues Encountered`).
4. **Falls back** to `git status --short` filtered against the story's `Files to Modify` table if closing sections are missing.
5. **Records** the stage in the cycle log, setting `model=<the model the sub-agent actually ran on>` (the resolved skill model, or the inherited lead model when none was declared) per the telemetry spec.
6. **Proceeds** to the next stage. No shutdown step.

**Lead-run gate skills run on the lead's model.** `/bmad-sprint-planning`, `/bmad-create-story`, and `/bmad-retrospective` are invoked by the lead directly via the `Skill` tool (not spawned as sub-agents), so they execute in the lead's context and their frontmatter `model:` is NOT applied — there is no per-skill model switch for inline lead execution. This is by design (these gates must stay lead-side; see "Lead Creates Story Files" and "Retrospective Per Epic"). A project that specifically wants a gate skill to run on its declared lighter/heavier model would have to delegate that gate to a sub-agent, trading away the lead-side guarantee — not recommended. Honoring `model:` therefore applies to the spawned pipeline stages (dev / qa / code-review) only.

### Spawn Prompt Skeleton

Every Agent spawn prompt must include, in this order:

1. The literal marker `**Epic Cycle Stage: <stage-name> for Story <id>**`.
2. The story file path (captured at story creation).
3. The list of files modified by upstream stages (for QA: dev's `## Files Modified`; for code review: dev's + QA's combined list).
4. The project's ADR registry path (typically `docs/adr/`) as factual context.
5. The directive: `Use the Skill tool to invoke /<bmad-skill-name>.`
6. The stage-specific rule block (see below) — including its **pre-answered checkpoints**: every interactive menu/halt the skill will hit, with the chosen option, so the agent never waits on input that cannot arrive (Rule 9).
7. The closing-summary directive — quote the section names inline so the agent has them at hand.
8. Skill-specific context.

### Stage-specific rule blocks (copy into spawn prompts)

**Dev spawn — append:**

```text
Implement ONLY the story file at the path above. Do NOT select a different story from sprint-status.yaml, even if it lists an earlier `ready-for-dev` entry. The skill's own status writes are correct — it moves the story `ready-for-dev → in-progress → review` and syncs sprint-status.yaml itself; do not duplicate those writes out-of-band.

Rules for this stage (from skill-rules.md):

- Rule 5 (NFR tripwire): halt and amend the planning artifact in place; do NOT work around with code comments + deferred-work.md.
- Rule 6 (ADRs): consult the ADR registry for any architectural or methodology decisions referenced in this story's ACs/Dev Notes. Match implementation to ADR commitments.
- Rule 9 (menus): the skill's own HALT conditions — a new dependency beyond the story spec, 3 consecutive implementation failures, missing required configuration, ambiguous task requirements — are Clarification Needed cases; emit the section and stop.

🚫 Do NOT `git commit` or `git push`. Leave ALL changes uncommitted in the working tree — the lead commits (submodules-first) after the per-story smoke gate. The v6 `bmad-dev-story` skill is git-read-only (it records `baseline_commit` only), but keep the prohibition explicit: an agent improvising outside the skill has auto-committed mid-pipeline before (Epic 3 Story 3.2), and this directive prevents the double-commit.

End your final message with these sections, in order:

## Files Modified
- <full path from repo root>
(or "(none)")

## Tests Added
- <full path from repo root>
(or "(none)")

## Decisions
- <one-line summary of non-obvious choice>
(or "(none)")

## Issues Encountered
- <one-line summary of issue surfaced or resolved>
(or "(none)")

If you cannot make confident progress for ANY reason — ambiguous ACs, missing prerequisite, user-preference choice, environment failure, or anything risking a stated constraint — STOP and end with a "## Clarification Needed" section instead. Do not guess; do not soldier on.
```

**QA spawn — append:**

```text
Pre-answered checkpoint (Rule 9): the skill's first step asks what to test — answer: the deliverable of Story <id>, i.e. the files listed above. Do not ask; do not broaden scope to unrelated features. If the project has no test framework yet, choose the stack-appropriate default, record the choice in ## Decisions, and proceed.

Rules for this stage (from skill-rules.md):

- Rule 8 (test discoverability): generated tests MUST be discoverable by the project's default test suite — (a) correct naming convention, (b) not excluded by ignore files, (c) not tagged in a way that opts them out of the default run.

🚫 Do NOT `git commit` or `git push`. Leave ALL changes uncommitted in the working tree — the lead commits after the per-story smoke gate.

End your final message with these sections, in order:

## Files Modified
- <full path from repo root>
(or "(none)")

## Tests Added
- <full path from repo root>
(or "(none)")

## Decisions
- <one-line summary>
(or "(none)")

## Issues Encountered
- <one-line summary>
(or "(none)")

If you cannot make confident progress — same halt + Clarification Needed protocol as the dev block.
```

**Code-review spawn — append:**

```text
Pre-answered checkpoints (Rule 9 — the skill halts at each of these; take the answer below and continue, do not wait for a human):

1. Step-01 context checkpoint ("confirm before reviewing") → confirmed. The review target is Story <id>, story key `<story-key>`; the diff is the uncommitted working tree (`git diff HEAD` plus untracked files). Set {story_key} explicitly so the skill's sprint-status sync works.
2. Decision-needed findings → resolve each with best judgment against skill-rules.md and the ADR registry. Only a genuine user-preference or spec-contradiction question becomes ## Clarification Needed.
3. Patch-handling menu → option 1 (apply every patch).
4. Final next-steps menu → option 3 (done). Do NOT start the next story.

Rules for this stage (from skill-rules.md):

- Rule 3 (real-runtime test evidence): user-facing surface approved without a real-runtime test in the QA suite = high finding. (Distinct from the lead's manual per-story smoke, which is a separate later gate.)
- Rule 5 (NFR tripwire): unmeasurable NFR worked around with code comments + deferred-work.md instead of planning-artifact amendment = high finding.
- Rule 6 (ADR violations): for each AC constrained by an Accepted ADR, verify implementation matches. Mismatch = high (not a low deferrable).
- Rule 1 (Integration ACs): service-introducing story missing an Integration AC = high finding.

All defer-bucket items MUST be added to _bmad-output/implementation-artifacts/deferred-work.md with the originating story ID, severity, issue summary, deferral rationale, and suggested resolution (the skill's step-04 does this; verify it happened).

🚫 Do NOT `git commit` or `git push`. You MAY edit files to apply patches and update tracking docs (story Review Findings, deferred-work.md, sprint-status.yaml), but the lead commits everything (submodules-first) after the per-story smoke gate. Do NOT write cycle-log entries — that is the lead's job.

The skill sets the story's final status itself: `done` when all decision-needed + patch findings are resolved and no high/medium remains; otherwise back to `in-progress`. Do not override that decision.

End your final message with these sections, in order:

## Files Modified
- <full path from repo root>
(or "(none)")

## Tests Added
- <full path from repo root>
(or "(none)")

## Decisions
- final story status (`done` or `in-progress`), resolved/deferred/dismissed counts, any high-severity fix names
(or "(none)")

## Issues Encountered
- <one-line summary>
(or "(none)")

If you cannot make confident progress — same halt + Clarification Needed protocol.
```

### Clarification protocol

If an agent returns with a `## Clarification Needed` section instead of the closing summary, the lead:

1. Reads the question from the returned message.
2. Surfaces it to the user with Story ID + context.
3. Waits for the user's answer.
4. Re-spawns the same stage's agent with the clarification baked into the prompt or written to the story file's Dev Notes.
5. Logs `<stage>_clarification_requested` before the re-spawn, and `<stage>_complete` after the re-spawn succeeds.

In a parallel batch: surface the question and re-spawn only that story's agent; others advance normally.

### Pipeline Flow

```
Lead resolves ADR registry path (typically docs/adr/) — included in every spawn prompt.

For each epic in range:
  Lead verifies clean working tree (parent + every submodule); halts on dirty state.

  # IDE file-sync toggle applicability — conditional, IRIS/ObjectScript projects only (see Source Control Branching)
  ideSync = (.vscode/settings.json exists AND objectscript.conn.active == true)
  If ideSync: record original value   # sync STAYS ON except inside the two branch-op windows; never stage settings.json
  If ideSync: set objectscript.conn.active = false   # >>> Window A start — wraps resume-checkout + SC-1/SC-2 + epic-branch checkout

  # Resume-mode detection (see Resume Semantics)
  For each affected repo, lead determines mode by cross-referencing:
    - cycle-log-epic-{N}.md existence + entries
    - sprint-status.yaml story states for this epic
      (use /bmad-sprint-status with mode=data for the computed snapshot — next story, per-status counts;
       run mode=validate first if the YAML's integrity is in doubt; do not hand-parse)
    - {TICKET}-epic{N} branch presence locally and on remote
  Modes per repo: FRESH | RESUME | REMOTE_ONLY | LOCAL_ONLY | AMBIGUOUS | INTEGRITY_ERROR
    INTEGRITY_ERROR or AMBIGUOUS → halt and surface to user
    LOCAL_ONLY                   → halt and ask user (remote deletion intentional?)
    REMOTE_ONLY                  → fetch + checkout {TICKET}-epic{N}; then RESUME
    RESUME                       → run Cross-stage integrity checks; on pass, set resume point
    FRESH                        → fall through to SC-1 / SC-2

  # SC-1 / SC-2 — only where FRESH
  For each repo in FRESH:
    Lead verifies the feature branch
      If missing → STOP and ask user (TICKET, Description, root); validate; create; push; log feature_branch_created
    Lead verifies {TICKET}-epic{N}
      If missing → branch off the feature branch (deterministic); push; log epic_branch_created
  Lead checks every affected repo out to {TICKET}-epic{N}; logs epic_branch_checked_out
  If ideSync: restore objectscript.conn.active to original   # <<< Window A end — MANDATORY (try/finally; restore even on halt/failure)

  Lead executes /bmad-sprint-planning via Skill tool; logs sprint_planning_complete
  If Epic N-1 retrospective exists OR deferred-work.md has unresolved items, AND no prior retro_review_* entry for this epic:
    Lead reads both sources, triages, creates Story X.0 via /bmad-create-story; logs retro_review_complete
  Else if no prior retro_review_* entry:
    Lead logs retro_review_skipped reason=no_predecessor_no_deferred_work
  Else:
    (resume case — gate already passed; skip)

  For each story (or batch — see Smart Parallelism), starting from the resume point:
    Lead asserts current branch == {TICKET}-epic{N} in every affected repo; halts on mismatch
    Lead executes /bmad-create-story directly with the explicit story ID (pipeline gate + Integration AC validation)
    Lead captures story file path
    Lead records spawn_at=<UTC> and model=<id> at each Agent call

    Lead invokes Agent for /bmad-dev-story (model=sonnet unless re-pinned) → reads ## Files Modified → logs dev_complete
    Lead executes ADR-tooled AC verifications (lead-side, sequential per AC); logs adr_verifications_complete
    Lead invokes Agent for /bmad-qa-generate-e2e-tests (model=sonnet unless re-pinned) → reads ## Tests Added → logs qa_complete
    Lead invokes Agent for /bmad-code-review (model=opus unless re-pinned) → reads return → logs cr_complete
    While review left story in-progress (unresolved high/medium) AND rework iterations < 3:   # see Rework Loop
      Lead re-spawns /bmad-dev-story (review-continuation; cycle_iteration+1) → logs dev_complete
      Lead re-runs ADR verifications if rework touched ADR-constrained ACs
      Lead re-spawns /bmad-code-review → logs cr_complete
    If still in-progress after 3 iterations: STOP; surface outstanding findings to user
    Lead performs per-story smoke (lead-side); logs smoke_complete
    Lead asserts current branch == {TICKET}-epic{N}; commits + pushes ONLY to {TICKET}-epic{N} (submodules first if applicable)
    Lead logs committed; next story or next batch

  Lead sets epic-{N}: done in sprint-status.yaml (the skills never write this transition); logs epic_status_done
  Lead pauses: "Run a retrospective?"   # human-in-the-middle gate — never auto-answered, never times out into a default
    If yes → /bmad-retrospective via Skill tool, fully interactive (all WAITs reach the user); logs epic_retro_complete
    If no  → logs epic_retro_skipped reason=user_declined
  Lead pauses: "Merge {TICKET}-epic{N} → feature, delete {TICKET}-epic{N}?" → if yes:
    If ideSync: set objectscript.conn.active = false   # >>> Window B start — wraps the merge branch ops
    For each affected repo, submodules-first then parent:
      checkout feature; pull; merge --no-ff {TICKET}-epic{N}; push feature; delete {TICKET}-epic{N} local + remote
    If ideSync: restore objectscript.conn.active to original   # <<< Window B end — MANDATORY (try/finally; restore even on conflict/halt)
    Logs epic_merged_to_feature
  Else:
    Logs epic_merge_skipped
  Logs epic complete; next epic
```

### Smart Parallelism (Opt-In Per Batch)

When two or more stories in the same epic touch **disjoint files** and have **all prerequisites already committed**, the lead may run them as a parallel batch. Opt-in per batch — when in doubt, run sequentially.

**Mechanism:** multiple `Agent` tool calls in a single assistant message run concurrently. Dispatch a batch by emitting one message with N `Agent` calls; wait for the tool-results message that resolves all of them together.

**What stays sequential:**

- Story-file creation (`/bmad-create-story` is lead-invoked).
- Commits and pushes (one story at a time; no two git ops interleave).
- Sprint planning, retrospective review, Story X.0 creation, per-epic retrospective.
- ADR-tooled AC verifications.
- Per-story smoke.

**Independence test (all three must hold):**

1. Disjoint files across stories (uncertainty disqualifies).
2. Same epic.
3. All prerequisites already at `committed` stage.

If any fails, run sequentially.

**Batch flow:** sequentially create story files; dispatch N concurrent dev-stage Agents; barrier on all returns; sequential ADR verifications + per-story smoke; sequential commits in story order. The batch barrier is automatic — all N `Agent` uses in one message resolve as a single tool-results message.

**Resume policy for interrupted batches:** find the earliest incomplete stage across the batch; re-spawn only the agents needed. If ambiguous, fall back to sequential resume.

**Write-ahead rule:** write the cycle log entry for a completed stage BEFORE the next dependent action. For `committed`: write immediately after `git push` returns success. If crashed between push success and log write, inspect `git log --oneline` on resume; if the matching commit exists, write the missing log entry — do NOT re-run the commit.

### Rework Loop (dev ↔ code review, bounded)

`/bmad-code-review` closes the story itself: when every decision-needed + patch finding is resolved and no high/medium severity remains, it sets the story (and sprint-status.yaml) to `done`; otherwise it sets `in-progress` and leaves unchecked `[Review]` items in the story file's Review Findings.

When the review returns `in-progress`:

1. Re-spawn `/bmad-dev-story` for the SAME story file with `cycle_iteration` incremented — its review-continuation mode picks up the unchecked review-finding tasks.
2. Re-run ADR-tooled verifications if the rework touched ADR-constrained ACs.
3. Re-spawn `/bmad-code-review`.
4. **Cap: 3 rework iterations.** Non-convergence after 3 → STOP and surface the outstanding findings to the user (mirrors `bmad-dev-auto`'s bounded review-repair loop). Endless dev↔review ping-pong is a signal the spec is wrong, not the code.

Only a story at `done` proceeds to smoke + commit.

### Status Ownership (who writes sprint-status.yaml)

The BMAD skills own the story-level transitions — the lead must NOT double-write them:

| Transition | Written by |
| --- | --- |
| story `backlog → ready-for-dev` (+ epic `backlog → in-progress` on the epic's first story) | `/bmad-create-story` |
| story `ready-for-dev → in-progress → review` | `/bmad-dev-story` |
| story `review → done` (or back to `in-progress`) | `/bmad-code-review` |
| `epic-{N}-retrospective: optional → done` | `/bmad-retrospective` |
| **epic `in-progress → done`** (after the last story reaches `done`) | **the lead** — the only transition no skill writes; log `epic_status_done` |

Status enum (kebab-case, BMAD v6): story `backlog → ready-for-dev → in-progress → review → done`; epic `backlog → in-progress → done`; legacy aliases `drafted` ≡ `ready-for-dev`, `contexted` ≡ `in-progress`. Never downgrade a status; preserve the YAML's comments and STATUS DEFINITIONS block when editing.

### Per-Story Smoke (Critical Gate)

After code review (HIGH/MED resolved) and before commit, the lead performs a per-story smoke — a direct exercise of the story's deliverable in its target runtime. Mandatory; only the method varies.

**Method by deliverable runtime:**

- UI / browser-deployed: drive the dev server (or a deployed build) via browser-automation MCP. Navigate, exercise, assert on DOM / render / console.
- CLI / library: invoke the new command or library entrypoint against a real runtime. Assert on stdout / stderr / return code / produced files.
- Service / API: real HTTP request against the local server (or staging). Assert on status code + response body + side-effect surface.
- Other: whatever exercise mirrors production use. Minimum: the lead invoked the new code path against a real runtime and observed expected outcomes via an out-of-band channel.

The smoke is not a substitute for automated tiers; it's the final check that the wired-up system end-to-end produces the user-observable outcome the story promises.

**Mechanics:**

1. After `cr_complete` (HIGH/MED resolved), determine smoke method from File List + ACs.
2. Execute, capture evidence (screenshots, stdout, response body).
3. On failure: do NOT commit. Either (a) surface to user, or (b) re-spawn dev for a follow-up + re-smoke. Failed smoke is HIGH, never deferrable.
4. On success: log `<UTC> TAB Story <id> TAB smoke_complete TAB method=<browser|cli|api|other> result=pass iterations=<N> defects_caught=<N> evidence=<path-or-summary> model=<lead-model>`. `iterations` is 1 for first-run pass, bump on re-smoke. `defects_caught` = count of bugs the smoke caught that automated tiers passed.
5. Proceed to commit.

Single-threaded across a parallel batch — smoke each story in story order.

### Retrospective Review & Story X.0 Creation (Critical Gate)

After sprint planning, before building the story list, review the previous epic's retrospective and create a cleanup story. Mandatory — closes the feedback loop between retrospectives and sprint planning.

1. Calculate previous epic number (N-1 if processing N).
2. Search for `_bmad-output/implementation-artifacts/epic-{N-1}-retro-*.md`. If multiple, latest by mtime; tie-break by lexicographic filename. Log which file was selected.
3. If a retrospective exists, extract: action items (status: completed / in-progress / not addressed), deferred review findings, preparation tasks for current epic.
4. Also read `_bmad-output/implementation-artifacts/deferred-work.md` if present.
5. Triage every item into: include in Story X.0; defer with rationale; drop.
6. Create Story X.0 in two steps:
   - **6a:** Invoke `/bmad-create-story` via `Skill` with `args` = brief title (e.g., `"Story {N}.0: Epic {N-1} Deferred Cleanup"`). Capture the resulting story file path.
   - **6b:** Append the full triage table to the created story file. Format: rows of `Item | Source (retro or deferred-work.md) | Triage Decision`. Header notes which Epic N-1 the triage covers + the date.
7. Skip Story X.0 ONLY if both sources are empty. If retro is missing but deferred-work has items, do NOT skip — execute steps 5-6 from the deferred-work source.
8. Log retro_review_complete or retro_review_skipped.

### Source Control Branching (Critical Gates)

These fire at the very start of each epic, before sprint planning or story work. Apply uniformly to the parent repo and every submodule in `.gitmodules`. For multi-repo projects (separate child repos rather than git submodules), the user enumerates affected repos up-front; the rules apply to each.

**Precondition — clean working tree.** Before any branching rule, the lead runs `git status --short` against the parent repo and every submodule and halts on dirty state. Non-negotiable. (If the IDE file-sync toggle below applies, run this clean-tree check FIRST; the toggle is then applied only transiently around each branch-changing operation and restored immediately after, so between operations `.vscode/settings.json` is back at its original value and the tree is clean. Never stage the transiently-toggled file into any commit.)

#### IDE file-sync toggle (conditional — IRIS/ObjectScript projects only)

Some IRIS/ObjectScript projects run an IDE extension that bidirectionally syncs the workspace with a live IRIS server (the VSCode-ObjectScript extension with `objectscript.conn.active: true` in `.vscode/settings.json`). When a git operation that **changes branches** rapidly rewrites the working tree, that sync fights the operation — it pushes the new tree to the server, the server recompiles and re-formats, then pushes the formatted files back to disk — producing phantom drift (e.g. spurious whitespace-only diffs), compile cascades, or partially-applied state that has to be reverted before the next commit.

This subsection is self-contained — it does not depend on any project's CLAUDE.md or rules files.

**Applicability — detect once, up front (after the initial clean-tree check):**

1. If `.vscode/settings.json` does NOT exist, or has no `objectscript.conn` block, or `objectscript.conn.active` is not `true` → the extension isn't actively syncing (or this isn't an ObjectScript/IRIS project). **SKIP this toggle entirely; it never applies.** Non-ObjectScript projects are never affected.
2. Otherwise the toggle is in effect for this run: record the original value (almost always `true`) so each window can restore it. The sync stays ENABLED except inside the branch-operation windows defined below.

**Scope — wrap ONLY branch-changing operations; do NOT disable the sync for the whole epic.** Disable the sync immediately before, and restore it immediately after, each git operation (or contiguous group of operations) that moves HEAD and rewrites the working tree: `checkout`, `checkout -b`, `merge`, `pull` (when it advances HEAD), `rebase`, `reset --hard`, `cherry-pick`, `stash apply`/`pop`, `revert`, `submodule update`. Within `/epic-cycle` there are two such windows (plus any resume-time checkout):

- **Window A — epic-start branching (SC-1 + SC-2 + checkout):** wrap the feature-branch checkout/creation, the epic-branch creation, and the `git checkout {TICKET}-epic{N}`. Restore the moment the epic branch is checked out.
- **Window B — SC-4 end-of-epic merge:** wrap the `checkout <feature>` / `pull` / `merge --no-ff` / branch deletes (per affected repo, submodules-first). Restore the moment the merge + deletes complete.

Read-only git ops (`status`/`diff`/`log`) and `add`/`commit`/`push`/`fetch` do NOT change branches and are NOT wrapped. The per-story pipeline stays on `{TICKET}-epic{N}` and only commits/pushes, so it runs with the sync **enabled**, as normal. Between windows the sync is on and `.vscode/settings.json` sits at its original value — clean — so the clean-tree check and the per-story commits never see a toggle-induced modification.

To wrap a window: set `objectscript.conn.active: false` → perform the branch operation(s) → set it back to the recorded original value.

**Restoration is MANDATORY and is the #1 failure mode of this rule.** Each window's restore must run — on success, on halt, on failure, on merge conflict, or on user cancellation. Treat each window like a `try/finally`: the restore belongs on the always-runs path, never only after the success path. The transiently-toggled `.vscode/settings.json` must never be `git add`-ed into any commit; if a window overlaps a commit (the SC-4 merge commit), verify settings.json is not staged. If you discover a window's restore was missed, restore immediately and tell the user the workspace was left disconnected from IRIS and for roughly how long.

**Crash recovery.** If a prior run crashed mid-window, `.vscode/settings.json` may be left at `active: false`. On a fresh run, if detection finds `active: false` where a live connection is expected, surface it to the user before proceeding — it may be an orphaned toggle from a crash, or an intentional manual disconnect; only the user knows.

This toggle is purely an IRIS/ObjectScript convenience; it has no effect on, and must not be applied to, non-ObjectScript projects.

#### Rule SC-1 — Feature branch verification (epic-start)

The lead checks for a feature branch in every affected repo. Branch name follows the project's configured pattern (see "Tracker format flexibility" below); default is `feature/{TICKET}_{Description}`.

- **If the feature branch exists** (locally or fetch-discoverable on remote): check it out, verify it's up to date with its remote, continue.
- **If the feature branch does NOT exist:** STOP and ask the user:
  1. Should the feature branch be created?
  2. The exact `{TICKET}` (validated against the project's `ticket_format` regex).
  3. The exact `{Description}` (validated against `description_format`).
  4. Which root does it branch from? Default precedence: `origin/develop` → `origin/main` → `origin/master`. The lead surfaces candidates the repo actually has and asks the user to confirm.

  On user authorization: validate the resulting branch name, then `git fetch origin && git checkout -b <validated-name> origin/{root} && git push -u origin <validated-name>` per affected repo. Log `feature_branch_created`.

Merging the feature branch into `develop` / `main` is OUT of scope for `/epic-cycle` — that's a PR-review / code-owner workflow. `/epic-cycle` creates and merges INTO the feature branch only.

##### Tracker format flexibility (per-project configuration)

The default assumes a JIRA-style tracker. Real projects use JIRA, Linear, GitHub Issues, Azure DevOps, or no tracker at all. The lead reads the project's branch-naming config from the first of these locations to exist:

1. `_bmad/custom/branch-naming.yaml` (preferred)
2. A `## Branch naming` section in CLAUDE.md
3. The defaults below

**Config schema:**

```yaml
# _bmad/custom/branch-naming.yaml
feature_pattern: "feature/{TICKET}_{Description}"  # template with {TICKET} and {Description}
epic_pattern: "{TICKET}-epic{N}"  # template for epic branch; {TICKET} reused from SC-1, {N} is epic number
ticket_format: "^([A-Z]+-\\d+|SPIKE|EXPLORE|REFACTOR)$"  # regex; tracker IDs OR named exceptions
ticket_required: true   # if false, {TICKET} may be empty
description_format: "^[a-z][a-z0-9-]{2,60}$"  # kebab-case, 3-60 chars, starts with letter
separator: "_"          # between TICKET and Description in the feature template
```

**Defaults if no config:**

| Field | Default |
| --- | --- |
| `feature_pattern` | `feature/{TICKET}_{Description}` |
| `epic_pattern` | `{TICKET}-epic{N}` |
| `ticket_format` | `^[A-Z]+-\d+$` (JIRA/Linear-style) |
| `ticket_required` | `true` |
| `description_format` | `^[a-z][a-z0-9-]{2,60}$` |
| `separator` | `_` |

**Validation at the SC-1 user prompt:**

1. Ask user for `{TICKET}` and `{Description}`, showing an example derived from the configured pattern.
2. Validate each against the configured regex.
3. If invalid: surface the mismatch with the offending regex shown. Offer: (a) re-enter, (b) override and use as-is (logs a warning), (c) update the project config.
4. If valid: render the branch name and confirm before creating.

**Ticketless work.** The default `ticket_format` allows `SPIKE`, `EXPLORE`, `REFACTOR` as named exceptions (e.g., `feature/SPIKE_audio-latency-probe`). Projects can broaden or narrow this list.

**Branch-name safety (non-negotiable).** Refuse any branch name with spaces, shell metacharacters (`*`, `?`, `[`, `]`, `;`, `&`, `|`, `<`, `>`, `$`, `` ` ``, newline), or git-reserved sequences (`..`, `@{`, leading `-`, trailing `.`). These guards are independent of the project config.

#### Rule SC-2 — Epic branch verification (epic-start)

After the feature branch is in place, the lead checks for an epic branch in every affected repo. The branch name follows the project's configured `epic_pattern` (see "Tracker format flexibility" below); default is `{TICKET}-epic{N}` (e.g., `PROJ-1234-epic1`). The ticket prefix is required so that multiple projects committing to the same repository under different tickets do not collide on a shared `epic1` / `epic2` namespace.

`{TICKET}` is the same value validated and recorded by SC-1 for the feature branch — the lead reuses it; do not re-prompt.

- **If the epic branch exists** (local or remote): check it out, continue.
- **If the epic branch does NOT exist:** create deterministically off the feature branch — no user prompt; the name is derived from the epic number and the SC-1 ticket. `git checkout <feature> && git pull && git checkout -b {TICKET}-epic{N} && git push -u origin {TICKET}-epic{N}`. Log `epic_branch_created`.

**Resume semantics:** mid-epic resume should find `{TICKET}-epic{N}` already in place. If the lead is resuming with prior `committed` entries in the cycle log but `{TICKET}-epic{N}` is missing locally AND on remote, that is a workspace-integrity error — halt and surface. Do NOT silently re-create.

**Ticketless projects.** If the project's `ticket_required` is `false` and no ticket was supplied at SC-1, the default `epic_pattern` resolves to a leading-hyphen name (`-epic1`), which is git-invalid. Projects in this mode MUST override `epic_pattern` (e.g., to `epic{N}` for single-project repos, or to `{DESCRIPTION}-epic{N}` to derive the prefix from the feature branch description). The lead validates the resolved epic branch name against the same branch-name safety rules as SC-1 and halts on failure.

#### Rule SC-3 — Commits go ONLY to the epic branch

Every commit during the epic cycle lands on `{TICKET}-epic{N}` in the affected repo. The lead asserts `git branch --show-current == "{TICKET}-epic{N}"` immediately before every `git commit` and halts on mismatch. Applies to submodules (each submodule's HEAD must be on its own `{TICKET}-epic{N}` before the parent's `git add <submodule-path>`).

Push frequency: per story, to the epic branch's remote.

#### Rule SC-4 — End-of-epic merge gate (user decision point)

After the retrospective gate (whether opted in or not), the lead pauses:

> "Epic {N} is complete. Merge `{TICKET}-epic{N}` into the feature branch and delete the epic branch (local + remote) in every affected repo?"

If **yes**, execute the merge — submodules-first, then the parent (mirrors per-story Submodule Commit Order to avoid broken pointers on the feature branch's remote). This is "Window B" for the IDE file-sync toggle: if that toggle applies, set `objectscript.conn.active: false` before the first `checkout` below and restore it immediately after the deletes complete (mandatory, `try/finally`; restore even if the merge conflicts and halts):

For each affected repo, ordered submodules-first:

1. `git checkout <feature>`
2. `git pull origin <feature>` (in case it moved while the epic was in flight)
3. `git merge --no-ff {TICKET}-epic{N} -m "Merge {TICKET}-epic{N}: <one-line summary>"` (preserves the epic branch's commit graph)
4. `git push origin <feature>`
5. `git branch -d {TICKET}-epic{N}` (refuses if not fully merged — the safety we want)
6. `git push origin --delete {TICKET}-epic{N}`

If submodules are involved, the parent's merge step (3) brings in submodule pointer updates that already exist on `{TICKET}-epic{N}` from per-story commits. Because the submodules' own feature branches were merged in the preceding pass, those pointers now resolve cleanly on the submodules' remotes. Verify with `git submodule status` before the final parent push.

If **no**, log `epic_merge_skipped reason=<short>` and leave `{TICKET}-epic{N}` intact.

#### Rule SC-5 — Epic re-open recreates the epic branch

If an epic is re-opened (e.g., the next epic's retrospective surfaces work that belongs on the prior epic, or the user explicitly reopens), the `{TICKET}-epic{N}` branch must be recreated.

- If the prior `{TICKET}-epic{N}` was merged and deleted: branch a new `{TICKET}-epic{N}` off the current feature-branch HEAD (picks up any interim feature-branch progress).
- If the prior `{TICKET}-epic{N}` was never merged and still exists: check it out as-is; do not branch a parallel `{TICKET}-epic{N}`.

Log `epic_branch_reopened reason=<short>`.

#### Rule SC-6 — NEVER commit directly to `main`, `master`, or `develop`

The lead refuses any commit (story, retrospective, hotfix, anything) when the current branch is `main`, `master`, or `develop` in any affected repo. Absolute defensive default. If the user explicitly directs a direct-to-trunk commit (emergency hotfix outside the epic cycle), that's OUT of scope — the user performs it manually.

Pairs naturally with remote branch protection on trunks.

#### Rule SC-7 — If unsure where to commit, STOP and ask

Branching state can drift across sessions. If the lead cannot confidently identify the right branch to commit to — multiple feature branches with similar names, missing epic branch mid-resume, ambiguous parent between `develop` and `main`, etc. — STOP and ask the user. Do not guess.

#### Rule SC-8 — Parallel epics on the same feature branch

Multiple `/epic-cycle` runs may execute concurrently against the same feature branch — typically when different agents drive Epic A and Epic B simultaneously.

**Per-agent isolation: one working tree per agent.** Git only allows one HEAD per working directory. Concurrent agents on different epic branches require either:

- `git worktree add <path> {TICKET}-epic{N}` (recommended) — separate worktrees share the same `.git` object store. Cleanup: `git worktree remove <path>` after the epic merges.
- Separate full clones (simpler but heavier).

A single working directory running two agents on different epic branches is not supported — it requires constant branch-switching that corrupts file state.

**Branch creation under parallelism.** Each agent runs Rule SC-2 independently. `{TICKET}-epic{N}` is created off the feature branch's current HEAD at the moment that agent starts. If Epic A started earlier and a hotfix or sibling-epic merge landed on feature in between, Epic B's `{TICKET}-epic{N}` branches off a newer feature HEAD. That's fine — the `--no-ff` merge at SC-4 handles three-way reconciliation.

**Per-story commits.** Independent branches, independent remotes — no race. Each agent's pre-commit branch assertion is per-agent and per-worktree.

**Merge serialization.** The `git push` to feature is a single-writer point on the remote, so SC-4 must serialize across agents:

- **Coordinated:** each SC-4 sequence starts with `git pull origin <feature>`. If Epic A already merged, Epic B's pull picks that up before its own merge runs. Standard three-way merge from there.
- **Near-simultaneous:** the user picks the order. The second agent re-pulls feature after the first lands.

**Conflict handling at merge time.** If `git merge --no-ff {TICKET}-epic{N}` produces conflicts (against another epic's already-merged work, a hotfix on feature, or any other drift since branching), the lead STOPs and surfaces to the user. Auto-resolution is forbidden — git's conflict heuristics can silently drop intentional changes. The user resolves in the working tree, then signals the lead to continue.

Submodules are independent under this rule too — each submodule's `{TICKET}-epic{N}` merges into its own feature branch sequentially; submodule conflicts require user resolution before the parent's submodule pointer is bumped.

**Out-of-scope coordination:** if two parallel epics' planning artifacts overlap (both stories' ACs touch the same files), that's a sprint-planning conflict the user resolves before parallel execution. Rule of thumb: if two epics' Files-to-Modify tables overlap by more than ~20%, run sequentially.

#### Sub-repository vs submodule terminology

"Submodule" = git submodule (registered in `.gitmodules`; `git -C <path>` operates on it as a child repo). "Sub-repository" = a non-submodule child repo under one umbrella (separate clones the umbrella project orchestrates). Rules SC-1 through SC-8 apply to both. If ambiguous, that's a SC-7 STOP-and-ask trigger.

### Resume Semantics (Critical)

`/epic-cycle` is designed to be resumable across interrupts, context exhaustion, explicit pauses, and clarification gates spanning days. A later session must pick up exactly where the prior one left off — no re-doing work, no skipping work.

#### Resume-mode detection (epic-start)

The lead determines mode before running SC-1 / SC-2:

1. Read `_bmad-output/implementation-artifacts/cycle-log-epic-{N}.md`.
2. Get this epic's story states from `sprint-status.yaml` — prefer `/bmad-sprint-status` with `mode=data` (returns next story + per-status counts machine-readably); run `mode=validate` first if the file's integrity is in doubt.
3. For each affected repo, check whether `{TICKET}-epic{N}` exists locally and on the remote.

| Cycle log | `{TICKET}-epic{N}` local | `{TICKET}-epic{N}` remote | Mode | Action |
| --- | --- | --- | --- | --- |
| Missing / empty | Missing | Missing | **FRESH** | Run SC-1, SC-2. Create branches. |
| Missing / empty | Exists | Exists | **AMBIGUOUS** | Halt; ask user whether to (a) adopt existing branch and start logging against it (existing commits accepted as-is), (b) start a new epic under different `N`, or (c) inspect manually. |
| Has entries | Exists | Exists | **RESUME** | Compute resume point from the log. |
| Has entries | Missing | Exists | **REMOTE_ONLY** | `git fetch && git checkout {TICKET}-epic{N}`; then RESUME. |
| Has entries | Exists | Missing | **LOCAL_ONLY** | Halt; ask user (remote deletion intentional?). |
| Has entries | Missing | Missing | **INTEGRITY_ERROR** | Halt loudly. Log claims work that branches no longer carry. |

Detection runs per affected repo. Different repos may legitimately be in different modes (parent RESUME, submodule FRESH).

#### Resume-point computation (within-epic)

For a repo in RESUME mode:

1. Bucket cycle-log entries by story ID; highest-stage entry per story is its resume anchor.
2. Earliest story whose anchor is not `committed` = resume point. Work resumes at the next pipeline stage after the anchor.
3. If a story has a `<stage>_clarification_requested` without a subsequent `<stage>_complete`, the resume point is "answer the clarification + re-spawn." The lead surfaces the question before spawning.
4. For parallel batches, compute per-story anchors first; the earliest stage across the batch is the batch's resume point. Re-spawn only agents for stories that haven't yet reached that stage.

#### Cross-stage integrity checks (before resuming any stage)

1. **`committed sha=X` reachable on `{TICKET}-epic{N}`.** For every `committed` entry, verify `git merge-base --is-ancestor X {TICKET}-epic{N}`. Failure = branch drift; halt.
2. **Local and remote `{TICKET}-epic{N}` HEADs match.** `git rev-parse {TICKET}-epic{N}` vs `git rev-parse origin/{TICKET}-epic{N}` (post-fetch). Diverged non-fast-forward = halt. Strictly ahead = log `resume_local_ahead`, push. Strictly behind = fetch + fast-forward.
3. **`sprint-status.yaml` agrees with cycle log.** Story marked `done` in YAML with no `committed` entry (or vice versa) = divergence; surface to user.
4. **Submodule pointer consistency.** If `{TICKET}-epic{N}` on the parent recorded a submodule pointer at commit S, the submodule's `{TICKET}-epic{N}` must contain S. Mismatch = INTEGRITY_ERROR.

#### Resume interactions with parallel epics (SC-8)

If Epic A is being resumed and Epic B merged to feature in the interim, Epic A's `{TICKET}-epic{N}` is unaffected — reconciliation happens at Epic A's eventual SC-4 merge. If Epic A's own `{TICKET}-epic{N}` was force-pushed by another contributor during the pause, Check 1 fails and the lead halts.

#### Resume across the Story X.0 / retro-review gate

- `retro_review_complete` or `retro_review_skipped` entry → already done, skip.
- No such entry → run the gate.
- Entry present but Story X.0 has no `story_created` → treat Story X.0 as the first incomplete story and resume there.

#### Resume across the end-of-epic gates

- Log shows `epic_status_done` but no `epic_retro_*` entry → resume at the retrospective question.
- `epic_retro_*` present but no `epic_merged_to_feature` / `epic_merge_skipped` → resume at the merge question.
- Both gates are user decision points; re-asking after a long pause is correct behavior. A run interrupted mid-retrospective resumes by re-asking the retrospective question (the skill's own output artifacts show how far it got); never auto-complete a half-finished retro.

#### Resume across Sprint Planning

Sprint planning is idempotent — `sprint-status.yaml` is regenerated each run. Always re-run on resume; the skill is a no-op when the YAML is current. The cycle log is append-only, so the new `sprint_planning_complete` entry coexists with the prior one (highest-timestamp wins).

#### Workspace-integrity errors are NOT auto-recoverable

INTEGRITY_ERROR or any cross-stage-check failure must halt. Auto-recovery paths ("the branches must have been pruned; recreate them") lose work. Only the user knows whether missing state was intentional (cleanup) or accidental (mistake).

When halting on an integrity error, surface:

1. What the log says happened (story IDs, stages, recorded shas).
2. What the workspace shows (branches present/missing, HEAD shas).
3. The specific check that failed.
4. Options for the user (re-create from log, abandon log, inspect manually).

Never guess.

#### Resume vs starting a new epic

If the cycle log for epic N is missing but cycle log for epic N-1 exists and shows N-1 completed, that's a normal FRESH start for epic N. SC-1 / SC-2 create the new branch. The retro-review gate triages N-1's deferred items into Story N.0.

If cycle logs for both epic N and epic N+1 are present with entries, two epics are in flight (parallel per SC-8). Resume each independently in its own worktree.

### Sprint Planning Per Epic (Critical Gate)

Before processing any stories for an epic:

1. Execute `/bmad-sprint-planning` directly via the `Skill` tool.
2. Ensures `sprint-status.yaml` is current, all stories tracked, status mismatches caught.
3. If sprint planning surfaces a blocking issue (story listed in `epics.md` missing from `sprint-status.yaml` or vice versa; status mismatch; schema-validation error), pause and inform the user.
4. Log `sprint_planning_complete`.

### Retrospective Per Epic (User Decision Point — the human-in-the-middle exception)

The retrospective is the ONE deliberate human-in-the-middle exception to the autonomous loop. Its value is the human's judgment about what just happened — automating it defeats its purpose. Concretely: never spawn it as a subagent, never pre-answer its party-mode elicitation or WAIT points (Rule 9's pre-answer protocol explicitly exempts it), and never set its `non_interactive` flag.

After all stories in an epic complete:

1. Announce: "Epic X is complete. Run a retrospective before moving to the next epic? (yes/no)"
2. **Wait for the user's response.** If the user is away, the run simply pauses at this gate — resume semantics pick it back up later; do not time out into a default answer.
3. **Yes:** execute `/bmad-retrospective` directly via the `Skill` tool, fully interactive. Log `epic_retro_complete` when it finishes (the skill itself marks `epic-{N}-retrospective: done` in sprint-status.yaml).
4. **No:** log `epic_retro_skipped reason=user_declined`; continue.

`AskUserQuestion` always elicits the human regardless of `bypassPermissions`. The lead executes the skill — do NOT spawn an agent for it (spawned subagents cannot reliably surface elicitation).

### Lead Creates Story Files (Critical Gate)

The lead executes `/bmad-create-story` directly via the `Skill` tool — NOT via an agent. Deliberate pipeline gate that prevents agents from racing ahead. **Capture the story file path** from the skill output to pass to the developer agent.

**Integration AC validation (lead-side, also a gate).** Before spawning dev, read the story's ACs: does this story introduce a service, module, or component that later stories will consume? Indicators: a new file under `services/` or `lib/`; a new exported class/factory/module; a `## Consumed-by` field; an AC describing a public surface other stories will call.

If yes — the story is service-introducing — it MUST EITHER (a) contain at least one Integration AC of the form "consumer X reads from this service and produces observable effect Y," OR (b) include an explicit `## Integration ACs` section stating "No consumers in this story; the first consumer will be Story X.Y." (the Rule 1 escape clause for services with no consumers yet in the epic). If neither is present, pause for the user:

> "Story <id> introduces <service-name>. No Integration AC and no 'no consumers yet' declaration found. Choose: (a) re-run `/bmad-create-story` to populate `## Integration ACs`; (b) name the future consumer story and add an explicit 'No consumers in this story; the first consumer will be Story X.Y.' line; (c) proceed without (producer-consumer wire-up defects can ship green)."

If NOT service-introducing (refactor, doc-only, internal cleanup, defect-fix), proceed.

This workflow gate is the binding enforcement.

### Context Handoff Between Stages (Critical)

The **story file path** is the canonical context anchor, passed forward to every downstream agent. File lists flow through the closing-summary sections in each agent's return value.

1. Story creation → Developer: lead passes the story file path.
2. Developer → QA: lead reads `## Files Modified` from dev, passes story path + file list to QA.
3. QA → Code reviewer: lead reads `## Tests Added` from QA, passes story path + dev's files + QA's tests.
4. Code reviewer → Commit: lead stages files from the union of dev + QA file lists.

If a return is missing closing sections, fall back to `git status --short` filtered against the story's `Files to Modify` table.

### Lead Context Management (long-run hygiene)

The lead's context window is the scarcest resource in a multi-epic run. Fresh context per stage is the point of the subagent design — both Anthropic's long-horizon-agent guidance and BMAD's own docs ("run each skill in a fresh context window") converge on it. Lead-side rules:

- The cycle log + `sprint-status.yaml` + story files are the durable state — treat them as external memory (write-ahead, then act). Never rely on conversation memory for a resume or gating decision.
- Do NOT pull stage diffs, full test output, or whole story files into the lead's context; the closing-summary contract exists precisely so stage detail stays in the stage. The lead reads a story file only at gates that require it (Integration AC validation, ADR mapping, smoke planning).
- After a context compaction/summarization event, re-anchor before the next action: re-read the cycle-log tail, the sprint-status snapshot (`/bmad-sprint-status` `mode=data`), and the current story file path. The write-ahead rule guarantees that is sufficient to continue exactly where the run left off.
- Budget: one story's pipeline should cost the lead only its gate-skill invocations, spawn prompts, returned closing summaries, and log writes.

### ADR-Aware Execution (Required)

Projects with an Accepted-Decisions registry (typically `docs/adr/`) commit to specific tooling, methodology, and architectural patterns. An AC satisfied by the wrong tool stack is equivalent to a HIGH-severity defect.

**Layer 1 — Lead-executed ADR-tooling gate (between `dev_complete` and `qa_spawn`).**

After dev returns and before QA is spawned, the lead inspects the story's ACs for any that map to ADR-committed agent-time tooling (visual verification, performance profiling, audits, etc.). For each matched AC, the lead drives the verification using its own tool inventory.

This gate exists because MCP tool inventories may not propagate reliably to spawned subagents. The lead always has the MCP servers at session level.

**Mechanics:**

1. Read the story file (path captured at `story_created`).
2. For each AC, consult the ADR registry. If any Accepted ADR commits to a specific tool stack for that AC, it's "ADR-tooled."
3. Drive each ADR-tooled AC verification using the relevant MCP / tool; record pass/fail + evidence paths.
4. Append one cycle-log entry per story: `<UTC> TAB Story <id> TAB adr_verifications_complete TAB <metadata>`.
5. On failure, surface to user before spawning QA.
6. Pass results to code reviewer's spawn-prompt context.
7. If no ADR-tooled ACs, emit `adr_verifications_complete result=none_required` and proceed.

**Layer 2 — ADR registry path in every spawn prompt.**

The lead resolves the ADR registry path once and includes it in every agent spawn prompt as factual context. Agents must consult ADRs for architectural and methodology decisions referenced in their ACs. Code reviewer must verify implementations match Accepted ADR commitments — violations are HIGH (Rule 6).

## When to Pause

Within each agent, halt and surface a clarification via `## Clarification Needed` if ANY hold:

- Ambiguous ACs or requirements.
- Missing prerequisite — story references data/code/context not present.
- Multiple reasonable design options where user preference matters.
- Environment or dependency failure blocking the work.
- Proceeding would risk breaking a stated constraint (security, compliance, performance, correctness, ADR).

Do not guess; do not soldier on. A short pause beats a wrong implementation unwound later.

## Handling Clarifications

When an agent returns with `## Clarification Needed`:

1. Read the question from the returned message.
2. Surface it to the user with Story ID + context.
3. Wait for the user's answer.
4. Re-spawn the same stage's agent with the clarification baked in (prompt or story file Dev Notes).
5. Log `<stage>_clarification_requested` before re-spawn, `<stage>_complete` after success.

**Key distinction:** clarification-needed is not a completion — closing sections won't be present. Detect via the `## Clarification Needed` heading.

**Parallel batch:** if one batch member returns with clarification, re-spawn only that story's agent. Others advance normally; the clarified story rejoins at the next batch barrier.

## Submodule / Sub-Repository Commit Order (Critical, if Applicable)

Applies to projects with git submodules OR sub-repositories. Skip if neither applies.

When stories modify files in child-repo directories:

1. **Commit and push inside each affected child first.** For git submodules, this produces an updated submodule pointer the parent will reference.
2. **Then commit and push in the parent.** For submodules, stage both parent files AND the updated pointer (`git add <submodule-path>`). For sub-repositories, the parent references children only at workflow level; children should still be pushed first.

If the parent is pushed with a submodule pointer that doesn't exist on the submodule's remote, other developers get checkout failures. Always submodules-first.

After each story, run `git -C <child-path> status --short` for every affected child to detect changes.

## Completion Logging

At each story completion, write a brief log entry: story ID/name, files touched, key design decisions, issues auto-resolved vs requiring user input.

### Cycle Log Format (enables resume)

Per-stage log entries, append-only. File: `_bmad-output/implementation-artifacts/cycle-log-epic-{N}.md`.

**Format (TAB-separated, exactly four fields):**

```
<UTC-timestamp> TAB <Story <id> | Epic <N>> TAB <stage> TAB <metadata>
```

- Fields separated by a literal TAB (`\t`), not spaces.
- The **metadata** field is whitespace-separated `key=value` pairs. Multi-values comma-separated; no spaces or tabs inside values (percent-encode if needed). Keys are lowercase snake_case.
- Two entry kinds (distinguished by field 2):
  - **Story-level:** `Story <id>` (most entries).
  - **Epic-level:** `Epic <N>` (branch lifecycle + the optional epic summary).

**Valid story-level stages, in order:** `story_created`, `dev_complete`, `adr_verifications_complete` (mandatory, between dev and qa; emits `result=none_required` if no ADR-tooled ACs), `qa_complete`, `cr_complete`, `smoke_complete` (mandatory, between cr and commit), `committed`. Clarification events use `<stage>_clarification_requested` followed by `<stage>_complete` on re-spawn.

**Valid epic-level stages:**

- `feature_branch_created` — SC-1 created the feature branch. Metadata: `repos=<paths>` `ticket=<id>` `description=<desc>` `root=<origin/branch>`.
- `epic_branch_created` — SC-2 created `{TICKET}-epic{N}`. Metadata: `repos=<paths>` `from=<feature-sha>`.
- `epic_branch_checked_out` — Lead checked out `{TICKET}-epic{N}` (resume or after creation). Metadata: `repos=<paths>` `head=<sha>`.
- `epic_branch_reopened` — SC-5 recreated after a prior merge. Metadata: `reason=<short>` `from=<feature-sha>`.
- `sprint_planning_complete` — Sprint planning done.
- `retro_review_complete` / `retro_review_skipped` — Retro + Story X.0 gate done (start-of-epic triage of the PREVIOUS epic's retro artifacts). Metadata: `source_retro=<path-or-empty>` `included=<N>` `deferred=<N>` `dropped=<N>` for complete; `reason=<short>` for skipped.
- `epic_retro_complete` / `epic_retro_skipped` — End-of-epic retrospective gate (the fully interactive, human-in-the-middle run of `/bmad-retrospective` — distinct from `retro_review_*` above). Metadata: `reason=<short>` for skipped.
- `epic_status_done` — Lead set `epic-{N}: done` in sprint-status.yaml after the last story reached `done`. Metadata: `stories=<N>`.
- `resume_local_ahead` — Resume check 2 found local ahead of remote; lead pushed. Metadata: `repo=<path>` `pushed_shas=<N>`.
- `epic_merge_skipped` — User declined SC-4 merge. Metadata: `reason=<short>`.
- `epic_merged_to_feature` — SC-4 merge completed. Metadata: `repos=<paths>` `feature_sha=<sha>` `merge_sha=<sha>` `submodules=<paths-or-empty>`.
- `epic_summary` (optional, once per epic after the last `committed`) — see Workflow Telemetry.

**Standardized telemetry (on every `*_complete` entry):**

- `spawn_at=<UTC>` — when the lead invoked `Agent` (omit on lead-driven stages).
- `model=<id>` — which model the agent ran (e.g., `claude-opus-4-8`, `claude-sonnet-5`, `claude-haiku-4-5`). For spawned pipeline stages this is the model resolved per Agent Invocation Pattern step 1 (frontmatter override, else the Model Strategy map) and passed on the `Agent` call. For lead-run gate stages, the lead's model. A run where every stage shows the lead's model is a signal that the `model` parameter was not passed on the spawns — dev/qa should show the Sonnet-tier id and code-review the Opus-tier id unless a project re-pinned them.
- `cycle_iteration=N` — defaults to 1; increment on re-spawn after downstream rejection or clarification.

**Stage-specific telemetry (when available):**

- `dev_complete`: `loc_added=N loc_removed=N files=N clarifications=N nfr_tripwires=N adr_violations_surfaced=N closing_sections_present=true|false`.
- `adr_verifications_complete`: `tool=<id> acs=<comma-separated-list> result=pass|fail|none_required evidence=<path-or-empty>`.
- `qa_complete`: `tests_added=N first_run_failures=N clarifications=N closing_sections_present=true|false`.
- `cr_complete`: `resolved=N deferred=N dismissed=N high=N med=N low=N clarifications=N closing_sections_present=true|false`.
- `smoke_complete`: `method=<browser|cli|api|other> result=pass|fail iterations=N defects_caught=N evidence=<path>`.
- `committed`: `sha=<short-hash> submodules=<paths-or-empty>`.

**Cost telemetry (when available):** `input_tokens=N output_tokens=N cost_usd=X.XX` on any `*_complete` entry. Omit if not extractable.

**Example** (TABs shown as `→`; actual file uses literal tabs):

```
2026-05-18T13:55:02Z→Epic 1→feature_branch_created→repos=. ticket=PROJ-1234 description=initial-foundation root=origin/main
2026-05-18T13:55:10Z→Epic 1→epic_branch_created→repos=. from=a1b2c3d
2026-05-18T13:55:11Z→Epic 1→epic_branch_checked_out→repos=. head=a1b2c3d
2026-05-18T13:56:00Z→Epic 1→sprint_planning_complete→model=claude-opus-4-8
2026-05-18T13:56:30Z→Epic 1→retro_review_skipped→reason=no_predecessor_no_deferred_work
2026-05-18T14:23:11Z→Story 1.5→story_created→path=_bmad-output/implementation-artifacts/1-5-render-engine.md spec_tokens=4820
2026-05-18T14:24:02Z→Story 1.5→dev_complete→spawn_at=2026-05-18T14:23:30Z model=claude-sonnet-5 files=src/render/render-engine.ts loc_added=412 clarifications=1 cycle_iteration=1 closing_sections_present=true
2026-05-18T14:25:00Z→Story 1.5→adr_verifications_complete→tool=chrome_devtools_mcp acs=ac5 result=pass evidence=path/to/evidence/ model=claude-opus-4-8
2026-05-18T14:29:47Z→Story 1.5→qa_complete→spawn_at=2026-05-18T14:25:30Z model=claude-sonnet-5 tests=tests/render-engine.test.ts tests_added=14 closing_sections_present=true
2026-05-18T14:33:18Z→Story 1.5→cr_complete→spawn_at=2026-05-18T14:30:15Z model=claude-opus-4-8 resolved=2 deferred=0 high=1 med=1 low=0 closing_sections_present=true
2026-05-18T14:34:00Z→Story 1.5→smoke_complete→method=browser result=pass iterations=1 defects_caught=0 evidence=path/to/screens/ model=claude-opus-4-8
2026-05-18T14:34:30Z→Story 1.5→committed→sha=abc1234 submodules=
2026-05-18T17:58:40Z→Epic 1→epic_status_done→stories=6
2026-05-18T18:02:11Z→Epic 1→epic_merged_to_feature→repos=. feature_sha=def5678 merge_sha=fed8765 submodules=
```

**Parsing rule:** split each line on TAB into exactly 4 fields; split metadata on whitespace into `key=value` tokens; split each value on `,` for lists.

On restart, scan the cycle log for the highest-stage entry per story / epic to compute the resume point.

## Workflow Telemetry

The cycle log is the primary telemetry surface. Standardized metadata + stage-specific keys make per-stage cost, quality, and model attribution computable without extra instrumentation.

**What the metadata enables:**

- Per-stage duration by model — `entry.timestamp − entry.spawn_at` grouped by `entry.model`.
- Bug rate by upstream model — `cr_complete.high + cr_complete.med` per story, grouped by `dev_complete.model`.
- Rework rate by model — count of `cycle_iteration > 1` entries grouped by model.
- Test-pyramid leak rate — `smoke_complete.defects_caught > 0` events.
- NFR-tripwire surfacing rate — `dev_complete.nfr_tripwires` grouped by model.
- Closing-section reliability — `closing_sections_present=false` rate grouped by model.

**`epic_summary` entry (optional, once per epic after the last `committed`):**

```
<UTC> TAB Epic <N> TAB epic_summary TAB stories=N wall_clock_hours=X.X total_high=N total_med=N total_low=N total_smoke_defects=N rework_events=N opus_stage_count=N sonnet_stage_count=N haiku_stage_count=N input_tokens_total=N output_tokens_total=N cost_usd=X.XX
```

Derivable from per-stage entries; a convenience, not a source of truth.

## Anti-Patterns (Do NOT Use)

- **TeamCreate / SendMessage / TeamDelete / team_name / shutdown handshakes** — Inter-agent messaging is unreliable. Use plain `Agent` tool calls; the return value IS the completion signal.
- **TaskCreate / TaskList / TaskUpdate** — Subagents poll TaskList and grab tasks regardless of `blockedBy` or ownership. The task system isn't needed; ignore it.
- **Story-creator agent** — Races ahead to create future story files. The lead must create story files directly.
- **Inline skill execution** — Agents interpreting skill logic instead of invoking via the `Skill` tool. Always specify `Skill` explicitly in prompts.
- **Missing context handoff** — Not passing file lists between stages; code reviewers can't review effectively.
- **Parent-before-submodule push** — Broken submodule pointers on the remote. Always submodules-first.
- **Normalizing known test failures** — Carrying forward "N pre-existing failures, unrelated" erodes baseline reliability. Fix or formally defer in `deferred-work.md` immediately.
- **Deferred findings only in story files** — Without centralized tracking in `deferred-work.md`, deferred items are invisible at the next epic's Story X.0 triage.
- **Reading only from `epics.md`** — `sprint-status.yaml` may contain additional stories (cleanup, hotfixes). Build the story list from both sources.
- **Skipping retrospective review before epic start** — Without explicitly reading the previous retro and triaging deferred items, accumulation goes silent.
- **Parallelizing without verifying disjoint files** — Two agents writing the same file produce non-deterministic state and corrupt the commit.
- **Deferring ADR-mandated agent-time verification without surfacing it** — "I can't do X from this environment" for work an Accepted ADR commits to specific tooling. The lead executes ADR-tooled verifications directly.
- **Treating ADR violations as LOW deferrable findings** — ADR violations are HIGH (Rule 6).
- **Skipping the per-story smoke** — Test pyramid passing while the deployed product is broken is recurring. Failed smoke is HIGH, never deferrable.
- **Smoke executed by a spawned subagent** — Subagents may lack runtime tooling. Smoke is lead-side.
- **Service-introducing story without an Integration AC** — Producer + consumer ship green with wiring never built. Lead validates integration-AC presence at story creation.
- **`on_complete` hooks in BMAD `.toml` customizations** — Verification gates belong in the workflow's spawn-prompt skeleton, not the `.toml`. Keeping both creates two sources of truth.
- **Blocking the pipeline waiting for a "completion message"** — The `Agent` tool returns once when the subagent's run ends. Read the returned message directly.
- **Committing directly to `main`, `master`, or `develop`** — Rule SC-6 forbids this absolutely. Every workflow commit lands on `{TICKET}-epic{N}`; trunks are reached only via the SC-4 merge gate + an out-of-band PR.
- **Creating the feature branch silently** — Rule SC-1 mandates STOPping and asking. Silent defaults produce `feature/undefined_undefined` on remotes.
- **Skipping Source Control gates on a "resume" assumption** — Mid-resume should find the branches in place. If missing, that's a workspace-integrity error per SC-2 — halt; don't silently re-create. Silent recreation orphans prior commits.
- **Forgetting submodules need their own `{TICKET}-epic{N}`** — SC-2 applies per repo. Each submodule has its own.
- **Running parallel epics in a single working directory** — Git allows one HEAD per working tree. Parallel agents use `git worktree add` or separate clones (SC-8).
- **Auto-resolving merge conflicts at SC-4** — Three-way-merge conflicts at end-of-epic must be surfaced to the user. Git's auto-resolution can silently drop intentional changes.
- **Spawning pipeline sub-agents without passing the resolved model** — Omitting the `model` parameter on the `Agent` call makes every stage inherit the lead's model instead of the pipeline's intent (dev/qa → `sonnet`, code-review → `opus` per the Model Strategy map, unless a skill's frontmatter re-pins it). Resolve per Agent Invocation Pattern step 1 and pass it on the spawn. Lead-run gate skills are the exception — they run inline on the lead's model by design.
- **Letting a skill's interactive checkpoint block the run** — `bmad-code-review` alone has four happy-path halts (context confirm, decision-needed resolution, patch menu, next-steps menu); `bmad-qa-generate-e2e-tests` opens by asking what to test. Pre-answer every checkpoint in the spawn prompt (Rule 9); an un-pre-answered checkpoint is a Clarification, never a silent wait.
- **Double-writing story statuses** — The BMAD skills already sync story transitions to sprint-status.yaml (create-story → `ready-for-dev`, dev-story → `in-progress`/`review`, code-review → `done`/`in-progress`). The lead writes only `epic-{N}: done`. Out-of-band status writes desync tracking (see Status Ownership).
- **Hand-parsing sprint-status.yaml for resume or next-story state** — `/bmad-sprint-status` `mode=data` returns the next story and per-status counts machine-readably; `mode=validate` checks file integrity. Use them.
- **Letting dev-story self-select its story** — Unpinned, the skill implements the FIRST `ready-for-dev` story in sprint-status.yaml, which under parallel batches or resume may not be the intended one. Always pass the explicit story file path in the spawn prompt.
- **Backgrounding pipeline subagents** — A backgrounded subagent never hands control back in an unattended run and the pipeline stalls (the reason `bmad-dev-auto` mandates synchronous subagent calls). Spawn stages synchronously; a parallel batch is N `Agent` calls in ONE message, which still resolve together.
- **Unbounded dev↔review rework** — Endless re-spawn ping-pong on unresolved findings is a signal the spec is wrong, not the code. Cap at 3 rework iterations, then surface to the user (see Rework Loop).
- **Automating the retrospective** — Spawning `/bmad-retrospective` as a subagent, pre-answering its elicitation or WAIT points, or setting its `non_interactive` flag. The retrospective is the one deliberate human-in-the-middle gate in the loop; its output is only as good as the human answers it collects. (Distinct from the start-of-epic retro-REVIEW gate, which is lead-automated triage of the previous retro's written artifacts and needs no human.)
- **Mis-scoping or forgetting to restore the IDE file-sync toggle** — On IRIS/ObjectScript projects, disable `objectscript.conn.active` ONLY transiently around each branch-changing git operation (Window A: epic-start branching; Window B: SC-4 merge), and restore it immediately after each window. Do NOT leave the sync disabled for the whole epic — the per-story pipeline (commits/pushes, which don't change branches) must run with the sync ON. Each window's restore is mandatory `try/finally`-style: restore on success, halt, failure, merge conflict, or cancellation; an un-restored toggle leaves the workspace silently disconnected from IRIS (no error — just no sync). Never `git add` the transiently-toggled `.vscode/settings.json` into any commit.
