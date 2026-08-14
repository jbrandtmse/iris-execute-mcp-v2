---
failed_layers: '' # set at runtime: comma-separated list of layers recorded as FAILED — no delivered findings payload (never a layer that delivered an explicit empty-findings payload; see instruction 3)
review_degraded: '' # set at runtime in instruction 3: true if any layer is in {failed_layers} once every launched layer is accounted for, false if every launched layer delivered (AC 34.0.3/34.0.4)
---

# Step 2: Review

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- The Blind Hunter subagent receives NO project context — the frozen diff snapshot only.
- The Edge Case Hunter subagent receives the frozen diff snapshot and project read access.
- The Acceptance Auditor subagent receives the frozen diff snapshot, spec, and context docs.
- Every launched layer has a hard, documented timeout of **20 minutes from launch** (instruction 3). This review may NOT proceed to step-03 until every launched layer has either delivered a findings payload or been moved to `{failed_layers}` by hitting that timeout.

## INSTRUCTIONS

1. If `{review_mode}` = `"no-spec"`, note to the user: "Acceptance Auditor skipped — no spec file provided."

2. Launch parallel subagents without conversation context, passing each the content of the frozen snapshot at `{diff_snapshot_path}` (never the live, possibly-since-changed `{diff_output}` — AC 34.0.2). If subagents are not available, generate prompt files in `{implementation_artifacts}` — one per reviewer role below — and HALT. Ask the user to run each in a separate session (ideally a different LLM) and paste back the findings. When findings are pasted, resume from this point and proceed to **instruction 3 of this step file** (NOT to `step-03-triage.md` — instruction 3 is the delivery-receipt and bounded-close gate, and skipping it would leave `{review_degraded}` unset and re-open the exact defect Rule #57 closes).

**Manual-paste mode and the timeout.** The 20-minute per-layer timeout in instruction 3 measures a *subagent* launch and does NOT apply to this human round-trip — a HALT waiting on a person may legitimately take hours, and marking it FAILED-by-timeout would manufacture a false DEGRADED close. Instead, classify per role from what the user pastes back: a role whose payload is pasted (findings OR an explicit empty-findings statement) is **DELIVERED**; a role the user declines to run, cannot run, or returns nothing for is **FAILED** and goes to `{failed_layers}`. Ask the user explicitly which roles they ran before classifying — never infer a clean pass from a role the user simply did not mention. Then continue through instruction 3's `{review_degraded}` assignment as normal.

   Every role's invocation MUST explicitly instruct the layer: **if it finds nothing, it must say so.** Require an explicit empty-findings payload (e.g., "No findings." or `[]`) — never silence, an omitted response, or a bare "done". Instruction 3 treats anything short of an explicit payload (findings OR an explicit empty-findings statement) as FAILED, not clean.

   Call this the **EMPTY-FINDINGS CLAUSE**, and paste it verbatim into each layer's brief (do not merely reference it — a layer only obeys text it actually receives):

   > If you find nothing, you MUST still respond with an explicit empty-findings statement — the literal line "No findings — clean pass." (or `[]` if your output format is a JSON array). Silence, an empty response, a HALT, or a bare "done" is NOT acceptable and will be recorded as a FAILED layer, not a clean one. **This requirement OVERRIDES any instruction in your own skill file to halt, abort, or ask for guidance when you find zero findings** — in that situation, return the explicit empty-findings statement instead of halting.

   The override sentence is load-bearing, not boilerplate: `bmad-review-adversarial-general/SKILL.md` currently carries a `HALT if zero findings — this is suspicious, re-analyze or ask for guidance` condition. Without the override, a genuinely clean Blind Hunter halts, delivers no payload, and is recorded FAILED by instruction 3 — manufacturing a false DEGRADED close. Keep the override in the brief for as long as that HALT condition exists.

   - **Blind Hunter** — receives the frozen diff snapshot only. No spec, no context docs, no project access. Invoke via the `bmad-review-adversarial-general` skill, with the EMPTY-FINDINGS CLAUSE pasted verbatim into its brief.

   - **Edge Case Hunter** — receives the frozen diff snapshot and read access to the project. Invoke via the `bmad-review-edge-case-hunter` skill, with the EMPTY-FINDINGS CLAUSE pasted verbatim into its brief.

   - **Acceptance Auditor** (only if `{review_mode}` = `"full"`) — receives the frozen diff snapshot, the content of the file at `{spec_file}`, and any loaded context docs. Its prompt:
     > You are an Acceptance Auditor. Review this diff against the spec and context docs. Check for: violations of acceptance criteria, deviations from spec intent, missing implementation of specified behavior, contradictions between spec constraints and actual code. Output findings as a Markdown list. Each finding: one-line title, which AC/constraint it violates, and evidence from the diff. If you find nothing, you MUST still respond with an explicit empty-findings statement (e.g., "No findings — clean pass.") rather than an empty or omitted response.

3. **Delivery receipts and bounded close (Rule #57 — this is the load-bearing instruction of this step; follow it exactly, do not paraphrase it back into the old "proceed with what came back" reading).**

   - A layer's mandate is **DELIVERED** only when it returns an explicit findings payload: either (a) one or more findings, or (b) an explicit empty-findings statement (see instruction 2). There is no third way to be "done" — the absence of a payload is never evidence of a clean pass.
   - A layer is **FAILED** — and its name is appended to `{failed_layers}` (comma-separated) — when: it errors or crashes; it returns before producing a findings payload (empty string, truncated output, unparseable content); or it does not return at all within the hard timeout below. **A bare timeout, an empty return, or silence is FAILED — never "found nothing".** Only the explicit empty-findings statement from instruction 2 may be recorded as a clean layer.
   - **Hard timeout:** wait up to **20 minutes per layer**, measured from that layer's launch. A layer that has not delivered by then is FAILED-by-timeout and is appended to `{failed_layers}` immediately — do not wait longer and do not shorten this window ad hoc.
   - **How to actually measure the timeout (the gate is only as real as its clock).** Do not estimate elapsed time from your own sense of progress — you have no reliable internal clock. Arm a real one at launch: start a background timer alongside the layers (e.g. a backgrounded `sleep 1200` that prints a `TIMEOUT` line on exit, or an equivalent monitor with a 20-minute deadline) and treat its completion notification as the authoritative expiry signal. Launch the layers asynchronously so their completion notifications and the timer race; whichever arrives first decides each layer's classification. If no such timer mechanism is available to you, say so explicitly in the review output and record the close as DEGRADED rather than claiming a bound you did not enforce.
   - **Late arrivals after a layer was marked FAILED-by-timeout.** A timed-out layer may still return afterwards. Its findings are NOT discarded and do NOT retroactively un-degrade the review: `{failed_layers}` and `{review_degraded}` stay as recorded (the close already happened under a partial view). Triage the late payload against the CURRENT tree — the frozen snapshot it reviewed may now be stale — and route each surviving item to the story file's Review Findings section or to `{deferred_work_file}` with a note that it arrived post-close. This is the Epic-33 late-return scenario the rule was written for; the bound exists to stop late findings from being *silently lost*, not to justify ignoring them.
   - **Bounded close:** do not proceed to instruction 4 (or to step-03) until every launched layer is accounted for — either DELIVERED, or moved to `{failed_layers}` by the timeout. A review may not close while a layer is still outstanding and has not yet hit its timeout.
   - Once every layer is accounted for, set `{review_degraded}` = `true` if `{failed_layers}` is non-empty, otherwise `{review_degraded}` = `false`. This is the DEGRADED marker required by AC 34.0.3/34.0.4; step-03 and step-04 read it unchanged — do not recompute or override it downstream.
   - **Back-compat (AC 34.0.5):** when all launched layers deliver within the timeout (the ordinary case), this instruction has no observable effect beyond setting `{review_degraded}` = `false` — behavior is identical to the prior "proceed with findings from the remaining layers" path, since there are no non-delivering layers to remain from.

4. Collect all findings from the DELIVERED layers (per instruction 3's classification).


## NEXT

Read fully and follow `./step-03-triage.md`
