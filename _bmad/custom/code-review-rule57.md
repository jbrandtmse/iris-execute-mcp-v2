# Rule #57 — review-layer discipline (`bmad-code-review` overlay)

Loaded as a `persistent_facts` entry by `_bmad/custom/bmad-code-review.toml`, where the `/epic-cycle` overlay (`_bmad/custom/epic-cycle-overlay.md`) inserts it on every kit install. These rules AMEND the installed step files; where a step's wording conflicts with a rule here, the rule here wins. They live here — not in the step files or the kit-generated override — because the BMAD installer overwrites `.claude/skills/` on every upgrade (the 6.12.2 upgrade erased Story 34.0's original in-step edits) and the `/epic-cycle` kit rewrites `bmad-code-review.toml` on every install.

Rule #57 (`.claude/rules/project-rules.md`) has three parts: BOUNDED-CLOSE, FROZEN-DIFF, DELIVERY RECEIPTS. Upstream now satisfies two of them natively; this file supplies the rest.

## Already satisfied upstream — keep it that way

- **FROZEN-DIFF = step-01's `{diff_file}`.** Every layer reads that one uniquely-named file, never the live tree. Never rewrite or regenerate it mid-run — patches applied in step-04 change the tree, not the file; a re-review writes a new file.
- **BOUNDED-CLOSE (blocking half) = step-02's synchronous-launch rule.** Layers run as blocking calls awaited in the same turn. Never background a layer to save time — backgrounded layers were the root cause of the Epic 32–33 late returns (review closed, findings arrived post-commit). Nothing proceeds to step-03 until every launched layer has returned or failed.

## Delivery receipts (amends step-02 instructions 3–5)

A layer is **DELIVERED** only when its final message carries an explicit payload. Anything else is **FAILED** — append its `name` to `failed_layers`. FAILED is never "found nothing".

| Layer | DELIVERED payload | FAILED |
|---|---|---|
| Blind Hunter | a Markdown findings list, or an explicit statement that it found nothing after its second pass (the `/epic-cycle` override softened upstream's finding quota, so an empty result is valid when stated) | silence / missing / error / "content was empty" |
| Edge Case Hunter | a JSON array — `[]` is a valid clean pass | unparseable, or the lone `"Input empty or undecodable"` sentinel entry |
| Verification Gap Reviewer | gap blocks, or the exact line `No verification gaps found.` | anything else, incl. silence |
| Acceptance Auditor | a Markdown findings list, or the explicit line `No findings — clean pass.` (required by the overlay's `rule57-auditor-empty` entry) | anything else |

Upstream instruction 4's "returns empty results" means *returned no payload*. An explicit empty payload (`[]`, `No verification gaps found.`, `No findings — clean pass.`, Blind Hunter's stated empty list) is DELIVERED and clean — recording it as FAILED would manufacture a false DEGRADED close. A layer whose findings are discarded because it edited or committed something (an `/epic-cycle` Rule 18 protocol violation) counts as FAILED.

**Manual-paste mode** (no subagents; step-02 writes prompt files and HALTs): no clock applies to the human round-trip. Ask the user which layers they actually ran before classifying. A layer whose payload is pasted back (findings or an explicit empty statement) is DELIVERED; a layer declined, not run, or not mentioned is FAILED. Never infer a clean pass from silence.

## DEGRADED close (amends step-03 instructions 5–6, step-04 sections 1, 2, 3, 6)

Once every launched layer is accounted for, set `review_degraded` = `true` if `failed_layers` is non-empty, else `false`. Nothing downstream recomputes or overrides it.

When `review_degraded` = `true`:

1. **Never "clean".** Step-03 must not print "✅ Clean review — all layers passed." Instead state the review is DEGRADED, name the `failed_layers`, and say the findings cover only the layers that returned.
2. **Story-file record first.** When `spec_file` is set, the FIRST line of `### Review Findings` is: `**⚠ DEGRADED REVIEW** — layer(s) did not deliver a findings payload: <failed_layers>. Findings below reflect only the layers that returned; do not treat this as a full pass (Rule #57).` This write is REQUIRED even on step-04's zero-findings shortcut (section 1) — follow the marker with `_No findings were raised by the layers that delivered._`. Zero findings is the MOST likely degraded outcome, so skipping the write there erases the record exactly where it matters.
3. **Summary first.** Step-04 section 3 opens with: `⚠ **DEGRADED REVIEW** — <failed_layers> did not deliver. The findings below are partial, not a full pass.`
4. **Never `done`.** Step-04 section 6 evaluates this gate BEFORE looking at findings: `new_status` = `in-progress` no matter how many findings were resolved; sync sprint-status accordingly.
5. **Completion block** gains `**Review Outcome:** DEGRADED` and `**Failed Layers:** <failed_layers>`.

In `no-spec` mode there is no story file, so the chat announcement is the only record — say so plainly rather than implying a durable record exists.

**Under `/epic-cycle`** the "story file" is the `bmad-build-auto` spec: the DEGRADED marker leads the `### Review Findings` subsection under its `## Tasks & Acceptance`, the spec's frontmatter `status:` is never touched (the spawn prompt forbids it), `in-progress` reaches the tracker through the pre-answered sprint-status sync, and the closing summary's `## Decisions` carries `review_outcome=<CLEAN|NORMAL|DEGRADED> failed_layers=<csv or none>` for the lead, which re-runs a DEGRADED review instead of reworking the story (`_bmad/custom/epic-cycle-overlay.md`).

When `review_degraded` = `false`, upstream behavior is unchanged except the completion block gains `**Review Outcome:** CLEAN` (status `done`) or `NORMAL` (status `in-progress`).

## `story_key` on explicit invocations (amends step-01 Tiers 1–2)

Upstream sets `story_key` only on the Tier-3 sprint-tracking path, so step-04's sprint-status sync silently self-skips whenever Tier 1 or 2 identified the target (34-0-R2). When Tier 1 or 2 identifies the target, do a silent lookup (never a new HALT): if the invocation NAMES a story — key, slug, or story number (`36.3` ↔ a key starting `36-3-`) — that is in `review` status in `{sprint_status}`, set `story_key` to it. Never adopt a story the invocation did not name, even if it is the only `review` story — the diff may be unrelated and step-04 would rewrite the wrong story's status.
