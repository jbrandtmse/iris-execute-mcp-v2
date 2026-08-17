---
deferred_work_file: '{implementation_artifacts}/deferred-work.md'
review_close_kind: '' # set at runtime in section 6: CLEAN | NORMAL | DEGRADED — DEGRADED is set whenever {review_degraded} (from step-02) is true, regardless of finding counts (AC 34.0.3/34.0.4)
---

# Step 4: Present and Act

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- When `{spec_file}` is set, always write findings to the story file before offering action choices.
- `decision-needed` findings must be resolved before handling `patch` findings.
- A review with `{review_degraded}` = `true` (set in step-02, passed through unchanged by step-03) MUST NOT reach `{new_status}` = `done` in section 6 — see section 6's degraded gate. This holds no matter how many findings remain or were resolved, and it holds on the section 1 shortcut path as well. (Section 6 is skipped entirely when `{spec_file}` is not set — but that path sets no `{new_status}` at all and updates no story file, so `done` remains unreachable there too. In that `no-spec` mode there is no story file to carry the degraded record, so the section 3 announcement is the only surface; say so plainly rather than implying a durable record exists.)

## INSTRUCTIONS

### 1. Clean review shortcut

If zero findings remain after triage (all dismissed or none raised): state that — using the DEGRADED wording from step-03 instruction 6 if `{review_degraded}` = `true`, never plain "clean" — and proceed to section 6 (Sprint Status Update). Section 6's degraded gate still applies on this shortcut path exactly as on the normal path.

**Exception — the shortcut may NOT skip the story-file degraded record (AC 34.0.4).** If `{review_degraded}` = `true` and `{spec_file}` is set, you MUST still perform section 2's degraded write before proceeding to section 6: append the `### Review Findings` subsection containing the `**⚠ DEGRADED REVIEW**` first line (exact text in section 2), followed by `_No findings were raised by the layers that delivered._`. Zero findings is the MOST likely degraded outcome — silent layers produce no findings — so skipping the write here would erase the degraded record from the story file on precisely the path where it matters most. Only when `{review_degraded}` = `false` does this shortcut skip section 2 entirely (unchanged pre-story behavior, AC 34.0.5).

### 2. Write findings to the story file

If `{spec_file}` exists and contains a Tasks/Subtasks section, append a `### Review Findings` subsection.

If `{review_degraded}` = `true`, the FIRST line of that subsection (before any findings) must be: `**⚠ DEGRADED REVIEW** — the following layer(s) did not deliver a findings payload within the hard timeout: {failed_layers}. Findings below reflect only the layers that returned; do not treat this as a full pass (AC 34.0.4).` This is the story-file record a lead reads at the smoke/commit gate — it must be visible without re-running anything.

Write all findings in this order:

1. **`decision-needed`** findings (unchecked):
   `- [ ] [Review][Decision] <Title> — <Detail>`

2. **`patch`** findings (unchecked):
   `- [ ] [Review][Patch] <Title> [<file>:<line>]`

3. **`defer`** findings (checked off, marked deferred):
   `- [x] [Review][Defer] <Title> [<file>:<line>] — deferred, pre-existing`

Also append each `defer` finding to `{deferred_work_file}` under a heading `## Deferred from: code review ({date})`. If `{spec_file}` is set, include its basename in the heading (e.g., `code review of story-3.3 (2026-03-18)`). One bullet per finding with description.

### 3. Present summary

If `{review_degraded}` = `true`, announce this FIRST, before anything else in this section: `⚠ **DEGRADED REVIEW** — {failed_layers} did not deliver within the hard timeout. The findings below are partial, not a full pass.`

Announce what was written:

> **Code review complete.** <D> `decision-needed`, <P> `patch`, <W> `defer`, <R> dismissed as noise.

If `{spec_file}` is set, add: `Findings written to the review findings section in {spec_file}.`
Otherwise add: `Findings are listed above. No story file was provided, so nothing was persisted.`

### 4. Resolve decision-needed findings

If `decision_needed` findings exist, present each one with its detail and the options available. The user must decide — the correct fix is ambiguous without their input. Walk through each finding (or batch related ones) and get the user's call. Once resolved, each becomes a `patch`, `defer`, or is dismissed.

If the user chooses to defer, ask: Quick one-line reason for deferring this item? (helps future reviews): — then append that reason to both the story file bullet and the `{deferred_work_file}` entry.

**HALT** — I am waiting for your numbered choice. Reply with only the number (or "0" for batch). Do not proceed until you select an option.

### 5. Handle `patch` findings

If `patch` findings exist (including any resolved from step 4), HALT. Ask the user:

If `{spec_file}` is set, present all three options (if >3 `patch` findings exist, also show option 0):

> **How would you like to handle the <Z> `patch` findings?**
> 0. **Batch-apply all** — automatically fix every non-controversial patch (recommended when there are many)
> 1. **Fix them automatically** — I will apply fixes now
> 2. **Leave as action items** — they are already in the story file
> 3. **Walk through each** — let me show details before deciding

If `{spec_file}` is **not** set, present only options 1 and 3 (omit option 2 — findings were not written to a file). If >3 `patch` findings exist, also show option 0:

> **How would you like to handle the <Z> `patch` findings?**
> 0. **Batch-apply all** — automatically fix every non-controversial patch (recommended when there are many)
> 1. **Fix them automatically** — I will apply fixes now
> 2. **Walk through each** — let me show details before deciding

**HALT** — I am waiting for your numbered choice. Reply with only the number (or "0" for batch). Do not proceed until you select an option.

- **Option 0** (only when >3 findings): Apply all non-controversial patches without per-finding confirmation. Skip any finding that requires judgment. Present a summary of changes made and any skipped findings.
- **Option 1**: Apply each fix. After all patches are applied, present a summary of changes made. If `{spec_file}` is set, check off the items in the story file.
- **Option 2** (only when `{spec_file}` is set): Done — findings are already written to the story.
- **Walk through each**: Present each finding with full detail, diff context, and suggested fix. After walkthrough, re-offer the applicable options above.

  **HALT** — I am waiting for your numbered choice. Reply with only the number (or "0" for batch). Do not proceed until you select an option.

**✅ Code review actions complete**

- Decision-needed resolved: <D>
- Patches handled: <P>
- Deferred: <W>
- Dismissed: <R>

### 6. Update story status and sync sprint tracking

Skip this section if `{spec_file}` is not set.

#### Determine new status based on review outcome

**Degraded gate — evaluate this FIRST, before looking at findings at all (AC 34.0.3):** if `{review_degraded}` = `true` (set in step-02; any layer in `{failed_layers}`), this review MUST NOT reach `{new_status}` = `done`, regardless of how many findings were resolved. Set `{new_status}` = `in-progress` and `{review_close_kind}` = `DEGRADED`. Update the story file Status section to `in-progress`. Skip the two bullets below — they apply only when `{review_degraded}` = `false`.

Otherwise (`{review_degraded}` = `false` — every launched layer delivered; this is the ordinary case and the AC 34.0.5 back-compat path, unchanged from before this story):

- If all `decision-needed` and `patch` findings were resolved (fixed or dismissed) AND no unresolved HIGH/MEDIUM issues remain: set `{new_status}` = `done` and `{review_close_kind}` = `CLEAN`. Update the story file Status section to `done`.
- If `patch` findings were left as action items, or unresolved issues remain: set `{new_status}` = `in-progress` and `{review_close_kind}` = `NORMAL`. Update the story file Status section to `in-progress`.

Save the story file.

#### Sync sprint-status.yaml

If `{story_key}` is not set, skip this subsection and note that sprint status was not synced because no story key was available.

If `{sprint_status}` file exists:

1. Load the FULL `{sprint_status}` file.
2. Find the `development_status` entry matching `{story_key}`.
3. If found: update `development_status[{story_key}]` to `{new_status}`. Update `last_updated` to current date. Save the file, preserving ALL comments and structure including STATUS DEFINITIONS.
4. If `{story_key}` not found in sprint status: warn the user that the story file was updated but sprint-status sync failed.

If `{sprint_status}` file does not exist, note that story status was updated in the story file only.

#### Completion summary

> **Review Complete!**
>
> **Story Status:** `{new_status}`
> **Review Outcome:** `{review_close_kind}`
> **Issues Fixed:** <fixed_count>
> **Action Items Created:** <action_count>
> **Deferred:** <W>
> **Dismissed:** <R>

If `{review_close_kind}` = `DEGRADED`, append one more line to the block above: `**Failed/Timed-Out Layers:** {failed_layers}`. This block is a chat announcement only — the durable degraded record is the story-file marker written in section 2 (or via section 1's exception), never this block.

#### Dispose of the frozen diff snapshot

If `{diff_snapshot_path}` is set and the file exists, delete it now that the review has closed — every layer is already accounted for (step-02's bounded close guarantees it), so nothing is still reading it. It is a disposable artifact, already excluded from version control by `.gitignore`; deleting it keeps `{implementation_artifacts}` from accumulating one large `.diff` per review and keeps it out of any later review's `{diff_output}`.

If a layer is still expected to return late (it was marked FAILED-by-timeout), you may instead leave the snapshot in place and say so — but state explicitly that it is retained for a late return, so it is not mistaken for a deliverable at the commit gate.

### 7. Next steps

Present the user with follow-up options:

> **What would you like to do next?**
> 1. **Start the next story** — run `dev-story` to pick up the next `ready-for-dev` story
> 2. **Re-run code review** — address findings and review again
> 3. **Done** — end the workflow

**HALT** — I am waiting for your choice. Do not proceed until the user selects an option.
