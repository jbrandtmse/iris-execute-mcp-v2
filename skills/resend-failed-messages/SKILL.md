---
# DO NOT EDIT: generated from the MCP prompt of the same name.
name: resend-failed-messages
description: "Resends failed interoperability messages for one configuration item, dry run first: it previews the match count and a sample, resends only after the user approves with an explicit confirmation, and then checks the new message headers. It states that a resend delivers the data downstream again and that the resend actions are writes disabled by default. Use when the user wants to retry, replay or resend failed or errored messages in an IRIS interoperability production."
metadata:
  iris-tools-preset: core
---

# Resend Failed Messages

Config item: `<item>`
Window start: `<since>`

GOVERNANCE: `resend` and `resendFiltered` are write actions and are **DEFAULT-DISABLED** under tool governance (their sibling `preview` is a read and is enabled by default). If a call is refused with `GOVERNANCE_DISABLED`, tell the user the write must be explicitly enabled via `IRIS_GOVERNANCE`, e.g.:
`{"global": {"iris_message_resend:resendFiltered": true, "iris_message_resend:resend": true}}`
Do NOT attempt a workaround — surface the refusal and the enable snippet to the user.

DUPLICATION HAZARD: resending an already-processed message delivers its data again downstream — the target sees a brand-new message, not a correction. Always preview first and confirm with the user that the matched messages are genuinely worth retrying (a failed Request, not a completed message or a Response-type error payload, which is typically a no-op).

**DRY-RUN-FIRST workflow — follow IN ORDER, do not skip ahead:**

1. Call `iris_message_resend` with `action: "resendFiltered"`, `item: "<item>"`, `from: "<since>"`, and `dryRun: true` (the default) to preview. This returns the match count and a first-20 sample, and resends NOTHING.
2. Review the preview with the user: how many messages matched, and do the sampled rows look like genuine retry candidates? Narrow the window (`to`) or the `status` filter (default `'Errored'`) if the match set looks wrong, and repeat step 1.
3. The preview always reports the full match count. If it exceeds `maxMessages` (default 100, hard cap 500), the executing call in step 4 would be refused rather than truncated-and-executed — narrow the `from`/`to` window or the `item` filter and repeat step 1; do not raise `maxMessages` past what the user has reviewed.
4. Only after the user EXPLICITLY approves executing the resend: call `iris_message_resend` again with the SAME `action: "resendFiltered"` filters, `dryRun: false`, AND `confirm: true` (`dryRun: false` without `confirm: true` is refused with no changes made; leaving `dryRun` out only previews again, because it defaults to `true`). For a small, specific set of header IDs instead of a filtered batch, use `action: "resend"` with an explicit `headerIds` list.
5. Verify the resend: call `iris_production_messages` for the affected session(s), or look up the `newHeaderId` values returned in step 4's per-header results, to confirm the new headers were delivered as expected. Report any per-header failures — a bad header does not abort the rest of the batch, so check the summary counts, not just success/failure.
