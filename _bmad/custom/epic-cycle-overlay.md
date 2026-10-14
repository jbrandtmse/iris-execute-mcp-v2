# /epic-cycle project overlay

Project-owned additions to the kit-generated files; the kits never write this file, and every kit install re-applies it (base kit Step 3c). Format and application rules: base kit Step 3c. All entries below carry project Rule #57 (bounded-close, frozen-diff, delivery receipts; `.claude/rules/project-rules.md`, detail in `_bmad/custom/code-review-rule57.md`).

## rule57-facts: load the Rule #57 overlay into bmad-code-review
- file: _bmad/custom/bmad-code-review.toml
- anchor: "file:{project-root}/_bmad/custom/skill-rules.md",
- position: after

```text
  "file:{project-root}/_bmad/custom/code-review-rule57.md",
```

## rule57-auditor-empty: Acceptance Auditor must return an explicit empty-findings payload
- file: _bmad/custom/bmad-code-review.toml
- anchor: You are an Acceptance Auditor.
- position: after

```text
If you find nothing, you MUST still end your final message with the exact line `No findings — clean pass.` Silence, an empty response, or a bare "done" is recorded as a FAILED layer, not a clean one.
```

## rule57-task-sequence: point the lead at the degraded-review path
- file: .claude/commands/epic-cycle.md
- anchor: 7. Agent: `/bmad-code-review` on the Opus tier
- position: after

```text
   - Project Rule #57: if the reviewer's `## Decisions` report `review_outcome=DEGRADED`, follow "Degraded review" under Rework Loop — a review-only re-run, never a rework by itself.
```

## rule57-cr-outcome: code review reports its Rule #57 outcome
- file: .claude/commands/epic-cycle.md
- anchor: - `entries: high=N med=N low=N rows=N unresolved_high_med=N`
- position: after

```text
- `review_outcome=<CLEAN|NORMAL|DEGRADED> failed_layers=<csv or none>` — project Rule #57 (`_bmad/custom/code-review-rule57.md`): DEGRADED when any launched review layer delivered no findings payload; a DEGRADED review never sets `done`. The lead copies it into `cr_complete`.
```

## rule57-degraded-rerun: a degraded review is re-run, not reworked
- file: .claude/commands/epic-cycle.md
- anchor: review-continuation mode has no v6.11 successor, so the lead re-opens the spec
- position: before

```text
**Degraded review (project Rule #57).** A review whose `## Decisions` report `review_outcome=DEGRADED` (a layer delivered no findings payload — `_bmad/custom/code-review-rule57.md`) left the story `in-progress` for that reason alone. If the findings it did deliver contain no re-open trigger (no HIGH, no first-review unpatched in-story MED, no Fix Pack), do NOT re-open the spec or dispatch `bmad-build-auto`: log `cr_complete … review_outcome=DEGRADED failed_layers=<csv>`, `SPRINT_PLAN generate --set <key>=review`, and re-spawn `/bmad-code-review` on the same baseline as a review-only re-run, which does not count against the 3-iteration cap. If it does contain a trigger, run the Rework Loop below as usual — its scoped re-review is the re-run. A second consecutive DEGRADED close on the same story → STOP and surface the failed layers to the user.

```
