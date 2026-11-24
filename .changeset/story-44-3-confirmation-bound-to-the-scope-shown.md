---
"@iris-mcp/shared": patch
"@iris-mcp/dev": patch
"@iris-mcp/interop": patch
---

fix: a confirmation is bound to the scope the dialog showed, so no change the person did not see is written (Story 44.3, DW-670)

- The confirmation state is `v: 2` and carries a digest of the scope the dialog showed. On the round that carries the person's accept, the scope is worked out again: an equal digest runs the call, a different one asks the person again (once per call) with the new scope, and a second change ends the call with the new refusal `CONFIRMATION_SCOPE_CHANGED` (`{code, action}`; nothing changed; audited `denied` with `confirmation: "accepted"`). Sanction `S-44.3-scope-changed-refusal`.
- `iris_env_promote` `execute` binds every Storage drop it found and `iris_doc_edit` `regenerateStorage` every dropped definition (the dialog text cuts both), so a drop the dialog did not show is never written. `iris_message_resend` `resendFiltered` binds the filter and the cap, not the live match count or a `to` that IRIS filled in; an accepted call sends its read-only preview twice. The other gates bind their whole dialog text.
- A deciding round whose tool refuses before it asks no longer leaves an `unanswered` audit entry. A client that does not declare form elicitation, and a call whose scope does not change, get today's requests, result and audit entry. `@iris-mcp/shared` exports the `ConfirmationScope` type and `REFUSAL_CODES.CONFIRMATION_SCOPE_CHANGED`.

No tool, action, input field, governance key, visibility or description changes.
