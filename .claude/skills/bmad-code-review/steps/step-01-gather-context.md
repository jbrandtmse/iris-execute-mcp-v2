---
diff_output: '' # set at runtime
diff_snapshot_path: '' # set at runtime — path to the frozen diff snapshot written at the end of instruction 3 (AC 34.0.2)
spec_file: '' # set at runtime (path or empty)
review_mode: '' # set at runtime: "full" or "no-spec"
story_key: '' # set at runtime when discovered from sprint status
---

# Step 1: Gather Context

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- The prompt that triggered this workflow IS the intent — not a hint.
- This step is read-only with ONE sanctioned exception: instruction 3's final action writes the frozen `{diff_output}` snapshot to `{diff_snapshot_path}`. That write exists solely to freeze the reviewed diff so later layers can never review a stale, since-patched tree (Rule #57 FROZEN-DIFF) — it is not a license to modify, format, or otherwise touch the code under review, which stays strictly read-only.

## INSTRUCTIONS

1. **Detect review intent from invocation text.** Check the triggering prompt for phrases that map to a review mode:
   - "staged" / "staged changes" → Staged changes only
   - "uncommitted" / "working tree" / "all changes" → Uncommitted changes (staged + unstaged)
   - "branch diff" / "vs main" / "against main" / "compared to {branch}" → Branch diff (extract base branch if mentioned)
   - "commit range" / "last N commits" / "{sha}..{sha}" → Specific commit range
   - "this diff" / "provided diff" / "paste" → User-provided diff (do not match bare "diff" — it appears in other modes)
   - When multiple phrases match, prefer the most specific match (e.g., "branch diff" over bare "diff").
   - **If a clear match is found:** Announce the detected mode (e.g., "Detected intent: review staged changes only"). **First resolve `{story_key}` (34-0-R2), then construct `{diff_output}`** using the corresponding sub-case from instruction 3 — the key must be known BEFORE instruction 3 writes the frozen snapshot, whose filename embeds it — then skip to instruction 4 (spec question). This branch previously jumped straight to instruction 4 without ever running the sprint-status scan below, so `{story_key}` stayed empty and step-04's sprint-status sync silently self-skipped on every review triggered by a matched invocation phrase, which is the common path. Resolution is a silent lookup, never a new HALT (the review mode is already decided by the matched phrase): look for a sprint status file (`*sprint-status*`) in `{implementation_artifacts}` or `{planning_artifacts}`; if the invocation text NAMES a story — its key, its slug, or its story number (e.g. `36.3` ↔ a key starting `36-3-`) — that matches a story in `review` status, set `{story_key}` to that match; otherwise leave `{story_key}` unset. Never adopt a `review` story the invocation did not name, even when it is the only one: the matched phrase can select a diff unrelated to that story, and step-04 would then rewrite the wrong story's status. If no sprint status file exists, leave `{story_key}` unset.
   - **If no match from invocation text, check sprint tracking.** Look for a sprint status file (`*sprint-status*`) in `{implementation_artifacts}` or `{planning_artifacts}`. If found, scan for any story with status `review`. Handle as follows:
     - **Exactly one `review` story:** Set `{story_key}` to the story's key (e.g., `1-2-user-auth`). Suggest it: "I found story {{story-id}} in `review` status. Would you like to review its changes? [Y] Yes / [N] No, let me choose". If confirmed, use the story context to determine the diff source (branch name derived from story slug, or uncommitted changes). If declined, clear `{story_key}` and fall through to instruction 2.
     - **Multiple `review` stories:** Present them as numbered options alongside a manual choice option. Wait for user selection. If the user selects a story, set `{story_key}` to the selected story's key and use the selected story's context to determine the diff source as in the single-story case above, and proceed to instruction 3. If the user selects the manual choice, clear `{story_key}` and fall through to instruction 2.
   - **If no match and no sprint tracking:** Fall through to instruction 2.

2. HALT. Ask the user: **What do you want to review?** Present these options:
   - **Uncommitted changes** (staged + unstaged)
   - **Staged changes only**
   - **Branch diff** vs a base branch (ask which base branch)
   - **Specific commit range** (ask for the range)
   - **Provided diff or file list** (user pastes or provides a path)

3. Construct `{diff_output}` from the chosen source.
   - For **branch diff**: verify the base branch exists before running `git diff`. If it does not exist, HALT and ask the user for a valid branch.
   - For **commit range**: verify the range resolves. If it does not, HALT and ask the user for a valid range.
   - For **provided diff**: validate the content is non-empty and parseable as a unified diff. If it is not parseable, HALT and ask the user to provide a valid diff.
   - For **file list**: validate each path exists in the working tree. Construct `{diff_output}` by running `git diff HEAD -- <path1> <path2> ...`. If any paths are untracked (new files not yet staged), use `git diff --no-index /dev/null <path>` to include them. If the diff is empty (files have no uncommitted changes and are not untracked), ask the user whether to review the full file contents or to specify a different baseline.
   - After constructing `{diff_output}`, verify it is non-empty regardless of source type. If empty, HALT and tell the user there is nothing to review.
   - **Freeze the diff (AC 34.0.2).** Once `{diff_output}` is confirmed non-empty, persist it verbatim to a snapshot file so every review layer in step-02 reads the identical frozen content no matter when it returns. Compute the path as `{implementation_artifacts}/review-diff-snapshot-{key}-{run}.diff`, where `{key}` is `{story_key}` if it is set, otherwise `unkeyed`, and `{run}` is the current UTC timestamp as `YYYYMMDD-HHMMSS`. Write `{diff_output}` to that path exactly as constructed, and set `{diff_snapshot_path}` to the path written. This is the ONE sanctioned file write of this step (see RULES) — its purpose is to freeze the diff under review, never to change it.
     - **The `{run}` component is required, not decorative.** A DEGRADED close routes the story back to `in-progress`, and step-04 section 7 offers "Re-run code review" — so a second review of the SAME `{story_key}` is an ordinary path. Without the per-run suffix, that second run overwrites the first run's snapshot in place, and any still-outstanding layer from the first run that re-reads `{diff_snapshot_path}` would silently review the NEW diff. That would defeat FROZEN-DIFF in exactly the late-return scenario it exists for. Never reuse or overwrite an existing snapshot path.
     - **Never assume `{story_key}` is set here.** It is set only when instruction 1 resolved it — on the sprint-status branch, or on the invocation-text branch when the invocation named a `review`-status story (34-0-R2) — and stays empty otherwise. The `unkeyed` fallback keeps the write well-defined either way.
     - **Retention:** the snapshot is a disposable review artifact, not a deliverable. It is excluded from version control via the `review-diff-snapshot-*.diff` pattern in `.gitignore`, so it must never appear as a file to commit at the lead's commit gate, and must never be picked up as content by a later review's `{diff_output}`. Leave it in place for the duration of the review (a late-returning layer may still be reading it); step-04 handles disposal.
   - **Back-compat (AC 34.0.5):** this snapshot step is purely additive. It does not change how `{diff_output}` is constructed, validated, or presented — it only adds a second, frozen copy for the layers to consume in step-02.

4. Ask the user: **Is there a spec or story file that provides context for these changes?**
   - If yes: set `{spec_file}` to the path provided, verify the file exists and is readable, then set `{review_mode}` = `"full"`.
   - If no: set `{review_mode}` = `"no-spec"`.

5. If `{review_mode}` = `"full"` and the file at `{spec_file}` has a `context` field in its frontmatter listing additional docs, load each referenced document. Warn the user about any docs that cannot be found.

6. Sanity check: if `{diff_output}` exceeds approximately 3000 lines, warn the user and offer to chunk the review by file group.
   - If the user opts to chunk: agree on the first group, narrow `{diff_output}` accordingly, and list the remaining groups for the user to note for follow-up runs.
   - If the user declines: proceed as-is with the full diff.

### CHECKPOINT

Present a summary before proceeding: diff stats (files changed, lines added/removed), `{review_mode}`, and loaded spec/context docs (if any). HALT and wait for user confirmation to proceed.


## NEXT

Read fully and follow `./step-02-review.md`
