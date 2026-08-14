---
---

# Step 3: Triage

## RULES

- YOU MUST ALWAYS SPEAK OUTPUT in your Agent communication style with the config `{communication_language}`
- Be precise. When uncertain between categories, prefer the more conservative classification.

## INSTRUCTIONS

1. **Normalize** findings into a common format. Expected input formats:
   - Adversarial (Blind Hunter): markdown list of descriptions
   - Edge Case Hunter: JSON array with `location`, `trigger_condition`, `guard_snippet`, `potential_consequence` fields
   - Acceptance Auditor: markdown list with title, AC/constraint reference, and evidence

   If a layer's output does not match its expected format, attempt best-effort parsing. Note any parsing issues for the user.

   Convert all to a unified list where each finding has:
   - `id` -- sequential integer
   - `source` -- `blind`, `edge`, `auditor`, or merged sources (e.g., `blind+edge`)
   - `title` -- one-line summary
   - `detail` -- full description
   - `location` -- file and line reference (if available)

2. **Deduplicate.** If two or more findings describe the same issue, merge them into one:
   - Use the most specific finding as the base (prefer edge-case JSON with location over adversarial prose).
   - Append any unique detail, reasoning, or location references from the other finding(s) into the surviving `detail` field.
   - Set `source` to the merged sources (e.g., `blind+edge`).

3. **Classify** each finding into exactly one bucket:
   - **decision_needed** -- There is an ambiguous choice that requires human input. The code cannot be correctly patched without knowing the user's intent. Only possible if `{review_mode}` = `"full"`.
   - **patch** -- Code issue that is fixable without human input. The correct fix is unambiguous.
   - **defer** -- Pre-existing issue not caused by the current change. Real but not actionable now.
   - **dismiss** -- Noise, false positive, or handled elsewhere.

   If `{review_mode}` = `"no-spec"` and a finding would otherwise be `decision_needed`, reclassify it as `patch` (if the fix is unambiguous) or `defer` (if not).

4. **Drop** all `dismiss` findings. Record the dismiss count for the summary.

5. If `{failed_layers}` is non-empty, report which layers failed before announcing results. If zero findings remain after dropping dismissed AND `{failed_layers}` is non-empty, warn the user that the review may be incomplete rather than announcing a clean review. This is the review-visible half of the DEGRADED outcome; `{review_degraded}` itself was already set in step-02 instruction 3 and is NOT recomputed here — pass it through unchanged to step-04, which uses it as a hard gate on the `done` status decision (AC 34.0.3/34.0.4). Do not let this step's wording, or a zero-findings result, imply a clean, non-degraded close when `{review_degraded}` = `true`.

6. If zero findings remain after triage (all rejected or none raised): state "✅ Clean review — all layers passed." **ONLY if `{review_degraded}` = `false`.** If `{review_degraded}` = `true`, do NOT use this "clean" wording even with zero findings — instead state that the review is DEGRADED (name the failed layers from `{failed_layers}`) and that zero findings reflects only the layers that returned, not a full pass. (Instruction 5 already warned if any review layers failed via `{failed_layers}`; this instruction is what stops that warning from being overridden by a "Clean review" headline.)

**Back-compat (AC 34.0.5):** when `{review_degraded}` = `false` (the ordinary case — every launched layer delivered), instructions 5 and 6 behave exactly as they did before this story's changes.


## NEXT

Read fully and follow `./step-04-present.md`
