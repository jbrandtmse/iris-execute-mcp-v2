---
title: 'Story 44.3: Confirmation Bound to the Scope Shown'
type: 'bugfix'
created: '2026-11-22'
status: 'done'
baseline_revision: '5717b9f2f68227734a1702a9a7cb35aa74fbf422'
baseline_commit: '5717b9f2f68227734a1702a9a7cb35aa74fbf422'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/.claude/rules/project-rules.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-iris-execute-mcp-v2-2026-10-14/ARCHITECTURE-SPINE.md'
warnings: ['oversized']
deferred: []
---

<intent-contract>

## Intent

**Problem:** A confirmation dialog binds only the tool, the profile and the argument hash. A retry that echoes a valid, unused state decides the call before the scope is resolved again (`server-base.ts` `confirmOnWire`, :2134-2151). So `iris_env_promote` `execute`, which re-runs its Storage preflight on every round, writes the Storage drops the accepting round finds, even when the dialog showed none or other ones (DW-670). The same gap exists for every gate whose scope can change between rounds.

**Approach:** In the one shared helper, the state (`v: 2`) carries a digest of the scope binding the dialog showed. On an accepting round the helper resolves the scope again. An equal digest proceeds. A different digest asks again, showing the new scope, with a new state and nonce, at most once. A second change ends the call with the new refusal `CONFIRMATION_SCOPE_CHANGED`. Each gate supplies its binding value (the gate table in Design Notes). Handlers never compare state.

## Boundaries & Constraints

**Always:**
- The comparison, the re-ask, the bound and the refusal live only in `@iris-mcp/shared` (AD-34). A gate only supplies its scope text and, where the table says so, a binding value.
- The digest is `contentHash` (`confirmation.ts`) of the gate's binding value when it supplies one, and otherwise of the whole resolved scope text.
- The bound is `CONFIRMATION_SCOPE_REASKS = 1`: one re-ask per logical call, then the refusal. The worst case is 3 handler entries, under the SDK client's 10 rounds (modern era) and the server shim's `maxRounds: 8` (legacy era, `server-base.ts:915`). The re-ask count is in the signed state and carries forward through a retry that echoes a valid state with no answer.
- A multi-round call is one logical call with one audit entry, written by the round that ends it (AD-19). A re-asking round writes none. The old nonce is marked used and its pending ask removed, and the new nonce's pending ask is recorded.
- A decline, a cancel and an unticked accept are honored at once, as today, with no scope resolution (no extra request on any decline path).
- A client that does not declare form elicitation gets today's result, requests and audit entry, byte for byte.
- An unchanged scope gives today's dialog message, result and audit entry, byte for byte. The one recorded difference: an accepted `resendFiltered` sends its read-only preview twice (once per round). The fail-closed preview (DW-657) is unchanged.
- The new refusal joins `REFUSAL_CODES` (UPPER_SNAKE_CASE). Sanction `S-44.3-scope-changed-refusal` (AD-15) is named in `CHANGELOG.md`.
- Every test fake answers a shape the real system returns (Rule #54). IRIS's `resendFiltered` fills an omitted `to` with the current second (`MessageResend.cls:543`).

**Never:**
- No new tool, action, input field or governance key. `GOVERNANCE_BASELINE` is checked with `:check` only. No visibility change. No tool description or schema change, so no Frozen goldens entry and no tools-list snapshot regeneration.
- No IRIS-side change, no bootstrap regeneration, no IPM tree regeneration.
- No handler compares a digest, reads `requestState` or calls the SDK's elicitation API.
- No second dialog after a decline. No proceeding on an answer given for a different scope.
- No edit of frozen goldens (`sdk-wire-golden.json`, `sdk-handler-golden.json`), which hold no elicitation exchange. No change to any fake reply unless a test sets an override.
- No IRIS instance: every test runs against the built servers and `scripts/lib/fake-iris-listener.mjs`. No throwaway container and no shared-instance call.

## I/O & Edge-Case Matrix

The deciding round is a retry that echoes a valid, unused `v: 2` state of this call and carries an answer.

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Unchanged scope | accept; the digest of the re-resolved scope equals the state's | proceeds once; `confirmation: "accepted"`; message, result and entry as today | none |
| Changed scope, first time | accept; the digest differs; state re-asks 0; the client declares form elicitation | asks again: the new scope's message, a new state (re-asks 1) and nonce; the old nonce is used; nothing is written; no entry | none |
| Changed again | accept; the digest differs; state re-asks 1 | `CONFIRMATION_SCOPE_CHANGED`, `{code, action}`, `isError`; nothing written; one entry: `denied`, `denyReason` the code, `confirmation: "accepted"` | refusal |
| Changed, capability gone | accept; the digest differs; this request declares no form elicitation (modern era) | `CONFIRMATION_SCOPE_CHANGED`; never proceeds | refusal |
| Decline after re-ask | decline, cancel or unticked accept on the re-asked state | `CONFIRMATION_DECLINED` as today; one `denied` entry; no scope resolution | refusal |
| Scope now `undefined` | accept; the re-resolved scope is `undefined` (for example `resendFiltered` count now 0 or over the cap) | proceeds (no-dialog rule); IRIS's own guards decide; `confirmation: "accepted"` | IRIS refusal passes through |
| Scope resolver throws | accept; the re-resolution throws (`resendFiltered` preview 5xx or timeout) | the call ends with that error, as round 1 would; nonce used; nothing written; the entry is `error` with `confirmation: "accepted"` | fail-closed (DW-657) |
| Handler refuses first | the deciding round ends before `ctx.confirm` (for example promote drops appear while `allowStorageRegeneration` is off -> `STORAGE_DROPPED`) | that one entry only; the echoed state's pending ask is removed and its nonce used, so no later `unanswered` entry | refusal as today |
| Forged / v1 / other-digest state | a tampered, made-up or `v: 1` state, or one minted for another digest | never honored as an accept; asked again (re-asks 0) or re-asked per the rows above | none |
| No capability | client declares no form elicitation | today's contract, byte-identical | as today |

</intent-contract>

## Code Map

- `packages/shared/src/server-base.ts` -- `confirmOnWire` (:2125-2173; deciding branch :2134-2151; mint `{ v: 1, ... }` at :2160), `echoedConfirmationState` (:2098-2112), `wireToolContext` (:2061-2077, `argsHash`), `handleToolCall` (:1633-1685; pending ask recorded at :1661-1663), `recordPendingAsk`/`sweepPendingAsks` (:2176-2232), `deriveAuditOutcome` (:2464-2473; maps `CONFIRMATION_DECLINED` to `denied`), `WireCall` (:304-313), the `inputRequired` knobs (:915, `maxRounds: 8`).
- `packages/shared/src/confirmation.ts` -- `ConfirmationState` (:145-150) and `isConfirmationState` (:153-162) move to `v: 2` with `digest` and `reasks`; `contentHash` (:134); `confirmationDeclinedResult` (:251-265) is the sibling of the new `confirmationScopeChangedResult`.
- `packages/shared/src/tool-types.ts` -- `ConfirmationRequest` (:361-372). `scope` becomes `string | ConfirmationScope | (() => Promise<string | ConfirmationScope | undefined>)` with `ConfirmationScope = { text: string; binding: unknown }`. The doc comment says the scope is also resolved on an accepting deciding round.
- `packages/shared/src/refusals.ts` -- `REFUSAL_CODES` (:15-38); `__tests__/refusals.test.ts:46` holds the sorted key list.
- `packages/shared/src/index.ts` -- the barrel exports only `CONFIRMATION_TEXT_LIMIT` and `contentHash` from `confirmation.ts` (:50); export `ConfirmationScope` wherever `ConfirmationRequest` is exported. The gates build `{ text, binding }` literals and need no new runtime import.
- Gate call sites (verified 2026-11-22, all exact): `iris-admin-mcp/src/tools/audit.ts:387`, `iris-dev-mcp/src/tools/env-promote.ts:1343` (preflight `:1319`, `planned` built at :1327-1332, `promotionScope` :1083-1098 truncates to 10 steps/drops and 600 chars), `iris-interop-mcp/src/tools/production.ts:223`, `iris-interop-mcp/src/tools/message-resend.ts:565` (resend) and `:644` (resendFiltered; preview fn :624-642), `iris-dev-mcp/src/tools/doc-edit.ts:582` (re-reads the document every round; `dropped` at :581).
- Unit tests that pin the request object passed to `ctx.confirm` and change with the promote/doc-edit/resendFiltered scope shape: `iris-dev-mcp/src/__tests__/env-promote-execute.test.ts:1806,1834`, `env-promote-storage-guard.test.ts:294`, `story-42-11-qa-live-gate.test.ts:364`, `story-42-11-qa-promote-gaps.test.ts:160`, `doc-edit.test.ts:1788-1879`; the interop resendFiltered unit tests (search `scope` in `iris-interop-mcp/src/__tests__`).
- `packages/shared/src/__tests__/confirmation.test.ts:248-268` -- `isConfirmationState` fixtures (`v: 1` -> `v: 2`).
- Real-SDK stdio harness (AC 43.3.5): `packages/iris-mcp-all/src/__tests__/sdk-confirmation-rig.ts` (`openSdkRig`, `answer`, `secondListener`; also used by `epic43-capstone-gate.test.ts`), `story-43-3-confirmation-both-eras.test.ts` (GATES :315, promote rows :866-1010, `promoting()`, `PROMOTE_DIFF`).
- Hand-wire harness (modern-era forged/other-digest rows): `story-43-3-qa-wire.ts` (`openRig`, `connect`, `callWith`, listeners `a`/`b`), `story-43-3-confirmation-raw-wire.test.ts`, `story-43-3-qa-binding.test.ts` (`partsOf`, `signedState`).
- 43.3 accept-path request lists that gain the second `resendFiltered` preview: `story-43-3-qa-gates.ts:126-136` (`preflight`), `story-43-3-qa-hand-gates.test.ts:117` and the accepted variants at :264-275, `story-43-3-confirmation-both-eras.test.ts:494`. Decline paths keep one preview.
- `scripts/lib/fake-iris-listener.mjs` -- shared with the handler golden. Today every reply is a function of the request alone. `Demo.Sample.cls` (:37-47) is the promoted document. `resendFiltered` preview (:244-276) answers `to: body.to ?? body.from` and `matchCountOf` (:73-77).
- Docs: `README.md` refusal table (:530), Human confirmation section (:700-729; "Binding" bullet, the audit bullet :718, Known limits :725-728; line 727 says the preview "runs only on the round that asks", which becomes false), `packages/shared/README.md` (:34, :106), `CHANGELOG.md` (top section is `[Unreleased] — Story 44.2`), `.changeset/` (44.1's file is the pattern).
- Read-only evidence: `src/ExecuteMCPv2/REST/MessageResend.cls:531-544` (omitted `to` = `$ZDATETIME($ZTIMESTAMP,3)`); SDK `maxRounds` defaults in `node_modules/.pnpm/@modelcontextprotocol+client@2.4.0/.../index-BCNZS4Ap.d.mts:2527-2534` (client, 10) and `@modelcontextprotocol+server@2.4.0/.../mcp-BCJHyo7l.d.mts:2871-2878` (server shim, 8).

## Tasks & Acceptance

**Execution:**
- `scripts/lib/fake-iris-listener.mjs` -- add opt-in, test-set overrides on the object `startFakeIris` returns: a document's content by name (served by GET and HEAD of `doc/<name>`), and the `resendFiltered` preview's `matchCount` and `to` per item. With no override set, every reply is byte-identical (the handler-golden and 43.3 suites prove it). Update the CONTRACT header.
- `packages/iris-mcp-all/src/__tests__/sdk-confirmation-rig.ts` -- `answer` also takes a function `(request, index) => ElicitationAnswer`, so a test can change the fake while the dialog is open. Expose the two listeners' override setters. Keep every existing member unchanged.
- `packages/iris-mcp-all/src/__tests__/story-44-3-confirmation-scope.test.ts` (new) -- FIRST, before any source edit, the AC 44.3.1 red test. On both eras, through the real SDK client over stdio, promote `Demo.Sample.cls` with `allowStorageRegeneration: true`. While the first dialog is open, the target listener's `Demo.Sample.cls` gains a `Storage Default` definition. Against today's build, one ask is shown and the target gets the save. Record that red output in Verification. Then the AC 44.3.4 rows on both eras:
  - unchanged scope accepts once (a promote with drops on both rounds, and the 43.3 purge);
  - a changed scope asks again with the new drops in the message, and an accept then writes once;
  - a decline after the re-ask writes nothing on either listener, with one `denied` entry;
  - a scope that changes on every dialog gets exactly 2 asks, then `CONFIRMATION_SCOPE_CHANGED`, no write and one entry (`denied`, `denyReason`, `confirmation: "accepted"`);
  - `resendFiltered` whose count (3 -> 4) and defaulted `to` change between rounds asks once, proceeds, and sends 2 previews then the execute;
  - `resendFiltered` whose count becomes 0, or 600 over the cap, proceeds with no re-ask, and IRIS's answer passes through;
  - the "Handler refuses first" row (promote drops appear with `allowStorageRegeneration` off): one entry, and no `unanswered` entry after the client closes;
  - a client without elicitation runs the changed-drops promote with no dialog, and its result and entry equal today's.
- `packages/iris-mcp-all/src/__tests__/story-44-3-confirmation-scope-raw-wire.test.ts` (new) -- the modern era, through the hand driver of `story-43-3-qa-wire.ts`. It covers:
  - a state minted before a fake change, echoed with an accept, is re-asked with a new state (re-asks 1);
  - that re-asked state, echoed again after a second change, is refused;
  - the old state, replayed after the re-ask, is not honored;
  - a changed scope whose retry no longer declares the capability is refused;
  - a no-answer retry carries the re-ask count forward;
  - a decline on the re-asked state sends no preview;
  - the decoded state payload has `v: 2` with `digest` and `reasks`, and a payload re-signed as `v: 1` with a guessed key is never honored.
- `packages/shared/src/confirmation.ts` -- `ConfirmationState` becomes `{ v: 2, tool, hash, digest, reasks, nonce }`; `isConfirmationState` accepts only that shape. Add `CONFIRMATION_SCOPE_REASKS = 1`, a `scopeDigest(scope)` helper over `contentHash`, and `confirmationScopeChangedResult(actionKey, operation)` beside `confirmationDeclinedResult`. Its text is `The scope of <operation> changed again while the person was answering the confirmation dialog, so the call was not run. Nothing was changed. Run the call again once what it covers has stopped changing.` and its `structuredContent` is `{code, action}`.
- `packages/shared/src/tool-types.ts`, `refusals.ts`, `index.ts` -- the `ConfirmationScope` type and the `scope` union; `REFUSAL_CODES.CONFIRMATION_SCOPE_CHANGED`; the exports.
- `packages/shared/src/server-base.ts` -- `confirmOnWire` implements the matrix. Mint `v: 2` with the digest of the scope this round shows and the re-ask count. `deriveAuditOutcome` maps `CONFIRMATION_SCOPE_CHANGED` to `denied`. The framework removes the pending ask of a valid echoed state when the round ends the call without reaching `confirm` (matrix "Handler refuses first"); for example the wire call records the echoed nonce. Update the doc comments to the new order.
- `packages/iris-dev-mcp/src/tools/env-promote.ts` -- `scope: { text: promotionScope(...), binding: planned }` (the full drop list, untruncated). `doc-edit.ts` -- `scope: { text: <today's text>, binding: dropped }`. `packages/iris-interop-mcp/src/tools/message-resend.ts` -- the resendFiltered preview returns `{ text: <today's text>, binding: { status, from, to: input.to === undefined ? undefined : found.to, maxMessages } }`. `audit.ts`, `production.ts` and the `resend` gate are unchanged (they bind their whole text).
- The unit tests and 43.3 suites listed in the Code Map -- update only the confirm-request shape (promote, doc-edit, resendFiltered), the `v: 2` fixtures, the refusal key list, and the accepted `resendFiltered` request lists (+1 preview). No other expectation changes. Add unit pins that the promote and doc-edit `binding` holds every drop, including one past the dialog's cut (11 drops; a drop name longer than 600 characters).
- `README.md`, `packages/shared/README.md`, `CHANGELOG.md`, `.changeset/story-44-3-confirmation-bound-to-the-scope-shown.md` (`@iris-mcp/shared`, `@iris-mcp/dev`, `@iris-mcp/interop` patch) -- the docs:
  - a refusal-table row for `CONFIRMATION_SCOPE_CHANGED`;
  - the "Binding" bullet: the scope digest, one re-ask, the refusal, and the gate table in short form;
  - the audit bullet: the scope-changed entry;
  - Known limits: line 727 corrected, because the accepted round sends the preview again;
  - the shared README entries;
  - a CHANGELOG section `## [Unreleased] — Story 44.3: Confirmation Bound to the Scope Shown` above `[1.1.0]` (em dash), "Fixed" naming DW-670 and the sanction, and recording the extra preview.

**Acceptance Criteria:**
- AC 44.3.1: Given today's build, when the changed-drops promote row runs on both eras, then it is red: one dialog, and the target save is sent with drops the dialog never showed. The red run is recorded under Verification before any source edit.
- AC 44.3.2: Given the fix, when the matrix rows run through the built servers, then each behaves as its row says, on both eras where the era can express the row. The decoded state payload is `v: 2`.
- AC 44.3.3: Given the gate table in Design Notes, when each gate's unit and stdio tests run, then the binding they record matches the table: promote and doc-edit bind every drop; `resendFiltered` binds no count and no defaulted `to`; the rest bind their whole text.
- AC 44.3.4: Given the real SDK client over stdio on both eras, when the six rows of the epic run (unchanged, changed, decline after re-ask, bound, forged or other-digest, no elicitation), then each passes. The forged and other-digest rows run on 2026-07-28 through the hand driver, because on 2025-11-25 the state never leaves the server. **Pinning gate:** replace the digest comparison in `confirmOnWire` with "always equal", and the changed-drops promote test goes red on both eras. The path is the wire retry round of a real elicitation exchange (Rule #59).
- AC 44.3.5: Given a client without form elicitation, or an unchanged scope, when the 43.3 suites run, then they pass. Their only diffs are the confirm-request shape, the `v: 2` fixtures, the refusal list and the accepted `resendFiltered` request lists (+1 preview); `git diff` of those files shows nothing else.
- AC 44.3.6: Given the docs, when the default suite runs, then the doc-claims tests pass. The README, the shared README, CHANGELOG and the changeset say what changed. AD-34 and FR162 already carry the proposal text (verified). The tools-list snapshot check passes unchanged.
- DW-670 (action item `epic-42-retro-item-4-charter-a-story-in-the-next-planned-epic`): Given a client that answers the dialog in a second request, when `iris_env_promote` `execute`'s accepting round finds Storage drops the dialog did not show, then the person is asked again and no unseen drop is written (AC 44.3.1, 44.3.4). The action item closes at the Epic 44 retrospective with the owner's confirmation.

### Review Findings

Code review 2026-11-22 (`bmad-code-review`, full mode; layers Blind Hunter, Edge Case Hunter, Verification Gap, Acceptance Auditor, all delivered). Diff: build commit `5924aa20` against `5717b9f2` plus QA commit `b8a71903` (`packages/` only); Story 44.2's interleaved commits excluded. AD-34, AD-19 and AD-15 verified against the code: no mismatch. Rule 3: the built-server stdio suites against the fake listener are the runtime evidence. Rule 1: no new service; AC 44.3.4 is the Integration AC.

- [x] [Review][Patch] (MED) `resendFiltered` with `to: ""` binds the second IRIS fills in, so every accepted call is asked again and then refused with `CONFIRMATION_SCOPE_CHANGED` (the schema allows `""`, the tool sends it, `MessageResend.cls:543` fills it like an omitted `to`); the binding now leaves out an empty `to` too, with a unit pin [packages/iris-interop-mcp/src/tools/message-resend.ts:645]
- [x] [Review][Patch] (MED) The throw path of the pending-ask release (`releaseEchoedAsk` in `finally`) had no test: a deciding round whose tool throws before the dialog could leave an `unanswered` entry unnoticed; new hand-wire row on both eras (`regenerateStorage`, the document read answers HTTP 500), checked after a clean process stop [packages/iris-mcp-all/src/__tests__/story-44-3-qa-ledger.test.ts]
- [x] [Review][Patch] (MED) Matrix "Scope resolver throws" never checked for a trailing `unanswered` entry (the accept branch must remove its ask before the preview runs); new hand-wire row on both eras, checked after a clean process stop [packages/iris-mcp-all/src/__tests__/story-44-3-qa-ledger.test.ts]
- [x] [Review][Patch] (MED, Rule 19) AC 44.3.6 had no pinning test for Story 44.3's own doc claims (only the older doc-claims suites); new `story-44-3-doc-claims.test.ts` (refusal row, Human confirmation section, shared and per-server READMEs, CHANGELOG, changeset while present) [packages/iris-mcp-all/src/__tests__/story-44-3-doc-claims.test.ts]
- [x] [Review][Patch] (MED, Rule 2) The `Demo.Sample.cls`-with-Storage fixture was copied in three new test files (`story-44-3-confirmation-scope.test.ts`, `story-44-3-confirmation-scope-raw-wire.test.ts`, `story-44-3-qa-ledger.test.ts`); one export `sampleWithStorage` in the hand-wire helper, the three files import it [packages/iris-mcp-all/src/__tests__/story-43-3-qa-wire.ts]
- [x] [Review][Patch] (LOW, Rule #54) The fake answered an empty `to` with `""`, a shape IRIS never returns (it fills the current second); now like an omitted `to` [scripts/lib/fake-iris-listener.mjs]
- [x] [Review][Patch] (LOW, Rule #54) The fake's document override served new content under the old `ts`/ETag; every override now gets a `ts` of its own (and a new opt-in `setDocumentFailure` for the throw row above) [scripts/lib/fake-iris-listener.mjs]
- [x] [Review][Patch] (LOW) The README refusal row said the code is returned "only for a client that declares form elicitation" and, in the same cell, also when the client can no longer be asked; reworded to "a call whose client declared form elicitation when it was asked" [README.md:531]
- [x] [Review][Patch] (LOW) The README Binding bullet said `regenerateStorage` binds "beyond the 10 listed": only the promotion lists 10; split per gate [README.md:716]
- [x] [Review][Patch] (LOW) The shared README said a function scope "is resolved only when the client can be asked"; it is also resolved on the accepting round, before the capability is checked again [packages/shared/README.md:33]
- [x] [Review][Patch] (LOW, Rule #43) The per-server READMEs did not mention the change at the point of use: the dev README now names the promotion's re-ask and `CONFIRMATION_SCOPE_CHANGED`, the interop README the second preview [packages/iris-dev-mcp/README.md:242, packages/iris-interop-mcp/README.md:312]
- [x] [Review][Patch] (LOW, Rule 19) AC 44.3.5 had no `mutation:` line; demonstrated and recorded under Verification [spec ## Verification]

Closed at review (Rule 15):
- `by-design` (spec-bound): `resendFiltered`'s binding cannot change against real IRIS, so its second preview protects nothing and adds a failure mode (Blind; also QA finding 2): the gate table, the matrix row "Scope resolver throws" and the one recorded difference fix this. The re-asked dialog does not say it is a re-ask (Blind): the matrix fixes the re-ask message as the new scope's message. The refusal text says "changed again" also for the capability-gone case (Blind): the text is fixed by the spec. A replayed, used older state restarts at re-asks 0 and abandons the pending re-ask (Edge): matrix row "Forged / v1 / other-digest state", and each re-ask needs a fresh answer, so nothing runs unseen.
- `wontfix-accepted`: the entry of a deciding round that a tool check refuses carries no `confirmation` (Blind), because the answer decided nothing, as for a call cancelled before its dialog (reopen_if: an audit consumer needs the answer of a dialog whose call a tool check refused). No audit marker for a re-ask (Blind) (reopen_if: forensics need to tell a re-asked accept from a first accept). The two SDK-rig "no `unanswered` after close" rows can pass if the child is SIGTERMed after 2 s (Verification Gap) (reopen_if: a run where the server takes over 2 s to exit after stdin closes; the new hand-wire rows cover both release paths deterministically). `signedState`/`stateOf` in the raw-wire file copy `story-43-3-qa-binding.test.ts`, whose diff AC 44.3.5 freezes (Rule 2, LOW) (reopen_if: that file is next edited, or a third copy appears). QA finding 5: the fake saves only two documents (reopen_if: a test must assert more than two saves).
- `wontfix-theoretical`: `ConfirmationScope.binding` is `unknown`, so a `Map`/`Set` would hash as `{}` (Blind, Edge); real only if a gate passes a non-JSON binding (the three gates pass arrays and plain objects). QA finding 4: a `v: 1` state cannot be pinned at the wire without the per-process HMAC key (the unit test pins the shape).
- `by-design` (QA informational): finding 1 (a round that ends before the handler runs cannot echo the same call's state; the probe row pins it) and finding 3 (`regenerateStorage` cannot re-ask, because `STALE_CONTENT` comes first; the unit pin and the "outside the edited lines" row cover the binding).

Rejected:
- `low` The no-elicitation changed-drops row checks the writes exactly but the result only for `isError` (Auditor): byte identity of the no-capability path is pinned by `story-43-3-qa-fallback.test.ts` (mutation M4 below), and a full result oracle needs a pre-feature capture (Rule #36), not a direct correction.
- `low` The raw-wire "decline on the re-asked state sends no preview" row is split across two gates (Auditor): the decline branch does not depend on `reasks`, and a `resendFiltered` re-ask needs a reply shape IRIS cannot produce (Rule #54).
- `false` The `ConfirmationRequest.scope` JSDoc is stale (Blind): it already says "and again on the round that carries the person's accept".

## Spec Change Log

## Review Triage Log

### 2026-11-22 — Review pass
- verdicts: 37 findings — high 0, medium 2, low 19, false 16, maybe-false 0
- findings:
  - `[false]` `[reject]` intent-alignment 1: the change-while-open scenario is driven on the fake listener, not a live IRIS — by design: a live IRIS cannot change a target mid-dialog deterministically (Design Notes, Integration ACs; Rule #54).
  - `[false]` `[reject]` intent-alignment 2: `purge`/`clean`/`resend` bind their whole text, so their comparison cannot fire — by design: the gate table says their scope is a pure function of the arguments; the unchanged-path rows pin it.
  - `[false]` `[reject]` intent-alignment 3: promote drops past the tenth are bound but not shown — the decided binding (Design Notes, Correction 4); a later change to them re-asks.
  - `[false]` `[reject]` intent-alignment 4: a window after the comparison and before the PUT — the write uses the same preflight pass that was compared (`runDocumentsBatch` writes the pass's own content and drop list), so no read sits between them.
  - `[false]` `[reject]` intent-alignment 5: a change during the accepting round itself — the same pass is compared and written, so what is written is what was compared.
  - `[false]` `[reject]` intent-alignment 6: the replay, forged and re-ask rows run only on 2026-07-28 — spec Correction 6: on 2025-11-25 the state never leaves the server.
  - `[false]` `[reject]` intent-alignment 7: an accepted `resendFiltered` sends two previews — the spec records it as the one documented difference (README, CHANGELOG).
  - `[low]` `[patch]` blind 1: the `firstCallOrder` doc comment sat above `scopeTextOf` in `env-promote-storage-guard.test.ts` — patched: moved onto `firstCallOrder`.
  - `[low]` `[patch]` blind 2: the raw-wire "re-signed as v 1" row claims more than it proves (the MAC fails first) — patched: row title and file header now say a state signed with a guessed key is refused whatever its shape, and that the shape check is pinned by `confirmation.test.ts`.
  - `[low]` `[reject]` blind 3: no wire row for a changed `regenerateStorage` scope — the spec's rows cover promote and `resendFiltered` through the shared helper; the doc-edit binding is pinned by its unit test, and a one-sided gate adds no new helper path.
  - `[medium]` `[patch]` blind 4: the accept round's second preview failing is untested — the matrix row "Scope resolver throws" had no covering test. Patched: a `resendFiltered` row on both eras (first preview ok, second HTTP 500: one dialog, two previews, no execute, entry `error` with `confirmation: "accepted"`); the fake gained `failPreview`.
  - `[low]` `[patch]` blind 5: a binding of `undefined` digested as the hash of null whatever the text says — patched: `scopeDigest` falls back to the whole text for `binding: undefined` (what its doc comment already promised); the unit test pins it.
  - `[false]` `[reject]` blind 6: "once per call" does not hold for a replayed or dropped state — a replayed or invalid state is not an accept: the person is asked again and must answer, so nothing runs unseen; the matrix row "Forged / v1 / other-digest state" fixes re-asks 0.
  - `[false]` `[reject]` blind 7: the changelog's "the window the call gave" — it means `from` and a caller-given `to`, which is what the binding holds.
  - `[low]` `[reject]` blind 8: per-server READMEs not updated — the spec's docs list is the root and shared READMEs, CHANGELOG and changeset; the per-server READMEs link to the root section and carry no stale claim (grep).
  - `[false]` `[reject]` blind 9: the changeset is `patch` — the spec names it so.
  - `[low]` `[reject]` blind 10: no direct `server-base` unit test for the new branches — the built-dist suites on both eras and the raw-wire driver cover each branch and carry mutation lines; a duplicate fast test adds no new evidence.
  - `[low]` `[reject]` verification-gap 1: `delete wireCall.confirmation` has no test that cancels a re-asked dialog — a cancel during a re-ask is unlikely, and the fix is a new test row, not a direct correction.
  - `[medium]` `[patch]` verification-gap 2: same root as blind 4 (the matrix row "Scope resolver throws"); patched as above, with a mutation line.
  - `[low]` `[patch]` verification-gap 3: same root as blind 2.
  - `[low]` `[reject]` verification-gap 4: `expect(rig.writes()).toEqual([])` on the source listener is redundant — harmless; the paired `otherWrites()` assertion carries the weight.
  - `[low]` `[reject]` verification-gap 5: the 400 ms wait before the no-`unanswered` check — the check has no end signal to wait on, and its mutation line records it red.
  - `[low]` `[patch]` verification-gap 6: no mutation line for the capability-gone refusal — demonstrated and recorded.
  - `[low]` `[patch]` verification-gap 7: no mutation line for the re-ask count carried by a no-answer retry — demonstrated and recorded.
  - `[low]` `[patch]` verification-gap 8: no mutation line for the `denied` mapping of the new code — demonstrated and recorded.
  - `[low]` `[patch]` verification-gap 9: no mutation line for the `to`-only-when-given clause — demonstrated and recorded.
  - `[low]` `[reject]` verification-gap 10: AC 44.3.5 and 44.3.6 have no mutation lines — AC 44.3.5 is a diff-shape check on the 43.3 files (their doubled-preview lists are covered by the decline-path mutation); AC 44.3.6's doc-claims tests are the existing ones and run green.
  - `[low]` `[reject]` verification-gap 11: one `resendFiltered` raw-wire row makes cumulative preview counts across a decline and a second call — each count is asserted relative to a fresh baseline in the same row; no order dependence across tests.
  - `[false]` `[reject]` verification-gap 12: `status` and `from` echoed by IRIS may change per round — IRIS echoes the request's `from` and a constant default status; nothing varies per round.
  - `[false]` `[reject]` verification-gap 13: a caller-given `to` normalised differently per round — the same input gives the same echo.
  - `[low]` `[patch]` edge 1: same root as blind 5.
  - `[low]` `[patch]` edge 2: `releaseEchoedAsk` hashed the arguments of every wire call before looking for an echoed state — patched: it returns first when the request carries no state.
  - `[false]` `[reject]` edge 3: a throw in the `finally` replaces the result — the arguments are validated JSON, so the hash cannot throw, and a state that fails to verify returns `undefined`.
  - `[false]` `[reject]` edge 4: a replayed used state resets the bound — same as blind 6: a fresh dialog the person must answer.
  - `[false]` `[reject]` edge 5: `undefined` on the accept round proceeds — the matrix row "Scope now undefined" says exactly this; IRIS's own guards decide.
  - `[low]` `[patch]` edge 6: the `scopeDigest` comment promised a whole-text fallback the code did not give — true after the blind 5 patch.
  - `[false]` `[reject]` edge 7: same as blind 6.

## Design Notes

**Governing ADs (Rule 6).**
- AD-34: one helper, the order of checks, binding to the scope, bounded re-asks, the six-gate set, and `v: 2`.
- AD-19: one entry per logical call; the asking round writes none; a refusal before any change is `denied`.
- AD-15: the new refusal code is a sanctioned change, `S-44.3-scope-changed-refusal`; the no-capability and unchanged-scope surfaces are pinned.
- AD-2/AD-3: the helper stays in `@iris-mcp/shared`, behind the chokepoint.
- AD-32: the SDK eras.
- AD-4/AD-5: no new key.
- Conventions: Refusals, Frozen goldens (untouched), Turbo test tasks.

No AC contradicts an AD.

**Gate table (AC 44.3.3, exhaustive as of 2026-11-22; Rule #56; source: the `ctx.confirm` grep, 6 sites).**

| Gate | Call site | Binding value | Why |
|---|---|---|---|
| `iris_audit_manage:purge` | `audit.ts:387` | whole scope text | a pure function of the arguments |
| `iris_env_promote:execute` | `env-promote.ts:1343` | `planned`, every `StorageDrop` | the preflight runs every round; the text cuts at 10 drops and 600 characters |
| `iris_production_control:clean` + `killAppData` | `production.ts:223` | whole scope text | a constant |
| `iris_message_resend:resend` | `message-resend.ts:565` | whole scope text | a pure function of the arguments |
| `iris_message_resend:resendFiltered` | `message-resend.ts:644` | `{status, from, to only when the caller gave it, maxMessages}` from the preview | the live count and a defaulted `to` (IRIS's current second) change every round; the person approves the filter and the cap ("IRIS counts again"), as documented |
| `iris_doc_edit:regenerateStorage` | `doc-edit.ts:582` | `dropped`, every name | the document is re-read every round; the text cuts at 600 characters |

**Decisions (within AC 44.3.3's latitude).**
- **The bound is 1 re-ask.** With the binding values above, a legitimate change is rare. A second change during one call means the target is unstable.
- **The refusal is a new code, `CONFIRMATION_SCOPE_CHANGED`, not `CONFIRMATION_DECLINED`.** The person did not decline. Its audit entry is `denied` with the code as `denyReason`, and `confirmation: "accepted"`: the field records the person's answer, so its value domain stays unchanged.
- **No description change.** The descriptions do not promise binding semantics, and the refusal text tells the agent what to do. So the Frozen goldens are untouched.

**Probe findings (Rules #14/#16/#47; 2026-11-22; source reads only, no IRIS).** Confirmed: the six call sites, `env-promote.ts:1319`, the `v: 1` mint, and `confirmOnWire`'s shape (the deciding branch returns before the scope is resolved).

**Corrections for the lead (Rule #42; `epics.md` not edited).**
1. The anchors. `confirmOnWire` is `server-base.ts:2125-2173`, and its deciding branch is `:2134-2151` (the ledger's `:2133-2143` is stale).
2. The "10-round client limit". It is the SDK client's default `inputRequired.maxRounds` on 2026-07-28. On 2025-11-25 the server's own shim caps handler re-entries at `maxRounds: 8` (`server-base.ts:915`). The bound fits both.
3. `resendFiltered`'s volatility. Its text changes on every round, not only on a busy queue. When `to` is omitted, IRIS sets it to the current second (`MessageResend.cls:543`; README :728). A whole-text digest would re-ask every such call, so the gate binds the value in the table.
4. Truncation. The promote and doc-edit texts are cut, so a whole-text digest can miss a changed drop. Both bind the full drop list.
5. AC 44.3.6. The AD-34 amendment and FR162 are already applied (proposal application record; spine :714-720, `prd.md:719`). This story verifies them and does not re-apply them.
6. AC 44.3.4's forged-state row. It can be driven only on 2026-07-28 with the hand driver. On 2025-11-25 the shim keeps the state on the server, and the SDK client never forges.
7. A defect found by the probe, and in scope (AC 44.3.2's one-entry clause). A deciding round whose handler refuses before `confirm` (promote drops appear while `allowStorageRegeneration` is off) leaves the round-1 pending ask. The call then gets a second, `unanswered` entry at TTL or close. This is fixed by the matrix row "Handler refuses first".

**For the lead (Rule 20 spine bookkeeping, at the story's bookkeeping commit).**
- AD-15 sanctioned list: a Story 44.3 entry for `S-44.3-scope-changed-refusal` (the new code; the state moves to `v: 2`; an accepted `resendFiltered` sends one more read-only preview).
- AD-34 As-built "Binding": the bound (1 re-ask, then `CONFIRMATION_SCOPE_CHANGED`) and a pointer to this spec's gate table.
- AD-19 "Multi-round calls": a scope-changed refusal is `denied` with `confirmation: "accepted"`; a deciding round that ends before `confirm` leaves no pending ask.

**Integration ACs / Consumes (Rules 1/2).** No new service. This story changes the existing shared helper, and its consumers are the six gates of this story. The Integration AC is AC 44.3.4: `iris_env_promote` (consumer) runs in the built dev server over stdio with the real SDK client, re-asks, and writes nothing unseen. The IRIS side is the fake listener, as in 43.3: no IRIS route changes, and a live IRIS cannot make a target change mid-dialog deterministically. Consumes: `contentHash`, the HMAC state codec, the `ConfirmationNonces`/pending-ask bookkeeping (Story 43.3). Consumed-by: no later Epic 44 story.

**Extend, don't copy (Rule 2).**
- `confirmationScopeChangedResult` extends the `confirmationDeclinedResult` pattern (`refusalResult`).
- The digest reuses `contentHash`.
- The new tests reuse `sdk-confirmation-rig.ts` and `story-43-3-qa-wire.ts`, extended additively; no new rig.
- The fake overrides extend `fake-iris-listener.mjs`.

**Ledger.** `LEDGER slice` for this key is empty (`owned_ledger=0`). DW-670 arrives through the story text and the action item, and AC 44.3.1-44.3.6 address it.

## Verification

**Commands** (each in its own foreground call, `timeout: 600000`):
- (loop) `pnpm turbo run build --filter @iris-mcp/shared --filter @iris-mcp/dev --filter @iris-mcp/interop --filter @iris-mcp/admin` -- expected: success (the stdio tests refuse stale dists).
- (loop) `pnpm --filter @iris-mcp/shared exec vitest run src/__tests__/confirmation.test.ts src/__tests__/refusals.test.ts` -- expected: green.
- (loop) `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-44-3-confirmation-scope.test.ts` -- expected: red before the fix (AC 44.3.1), green after.
- (loop) `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-44-3-confirmation-scope-raw-wire.test.ts` -- expected: green.
- (loop) Each 43.3 suite in its own call: `story-43-3-confirmation-both-eras.test.ts`, `story-43-3-qa-hand-gates.test.ts`, `story-43-3-qa-binding.test.ts`, `story-43-3-confirmation-raw-wire.test.ts`, `story-43-3-qa-cancel-audit.test.ts`, `story-43-3-qa-fallback.test.ts`, `story-43-3-qa-interleave.test.ts`, `epic43-capstone-gate.test.ts` -- expected: green.
- (loop) `pnpm --filter @iris-mcp/dev exec vitest run src/__tests__/env-promote-execute.test.ts src/__tests__/env-promote-storage-guard.test.ts src/__tests__/doc-edit.test.ts`, then `pnpm --filter @iris-mcp/interop test` -- expected: green.
- (once) `pnpm turbo run build` -- expected: success.
- (once) `pnpm --filter @iris-mcp/shared test`, `pnpm --filter @iris-mcp/dev test`, `pnpm --filter @iris-mcp/admin test` (one call each) -- expected: green.
- (once) `pnpm --filter @iris-mcp/all test` -- expected: green. If it does not finish inside one call, split it by file into calls that each finish in about 8 minutes.
- (once) `pnpm gen:governance-baseline:check`, `pnpm run gen:tools-list-snapshot:check`, `pnpm run gen:ipm:check`, `pnpm run lint`, `pnpm run type-check` (one call each) -- expected: pass; the baseline stays `1e62c5ad5bf7`/141, and the snapshot and the IPM tree are unchanged.

**Red run (AC 44.3.1; recorded before any source edit; built dists of baseline `5717b9f2`; `pnpm --filter @iris-mcp/all exec vitest run src/__tests__/story-44-3-confirmation-scope.test.ts`):** 2 tests, 2 failed (legacy and modern era). On each era the person was shown ONE dialog (`Scope: 1 step(s) from server 'default': #1 documents putAndCompile Demo.Sample.cls`, no drops) although the target's `Demo.Sample.cls` had gained `Storage Default` while it was open: `expected [ Array(1) ] to deeply equal [ …(2) ]`, the second expected dialog (`...; drops Storage definitions: Demo.Sample.cls ('Default')`) never sent. With the ask assertion made soft, the remaining assertions passed, so the target `PUT` and the compile were sent after that one dialog: the save carried a drop the dialog never showed (DW-670).

**Mutations (Rule 19; the implement stage writes each `mutation:` line after demonstrating it):**
- AC 44.3.1/44.3.4 pinning gate: the digest comparison in `confirmOnWire` becomes "always equal" -> the changed-drops promote rows on both eras go red.
  - mutation: `scopeDigest(now) === state.digest` became `... || Date.now() > 0` (always equal) in `confirmOnWire`, shared dist rebuilt; `story-44-3-confirmation-scope.test.ts` and the raw-wire file ran 16 red of 37, including the AC 44.3.1 row, the changed-scope accept, both decline-after-re-ask rows and the "changes on every dialog" row on legacy and modern, and the raw-wire re-ask, refusal, replay, capability-gone, no-answer and decline rows; reverted byte-identical (`cmp`), dist rebuilt, green. (A first attempt with a literal `|| true` did not compile, so no dist was built and it proved nothing; it is not counted.)
- Bound: `CONFIRMATION_SCOPE_REASKS` becomes 5 -> the "changes on every dialog" row goes red (more than 2 asks, no `CONFIRMATION_SCOPE_CHANGED`).
  - mutation: `CONFIRMATION_SCOPE_REASKS = 5`, shared dist rebuilt; 4 red: the "changes on every dialog" row on both eras (a third dialog instead of the refusal) and the raw-wire refusal row and no-answer row; reverted byte-identical, green.
- resendFiltered binding: it binds the whole text instead -> the count/`to`-change row goes red (2 asks).
  - mutation: `binding` of the `resendFiltered` scope became the whole dialog text, interop dist rebuilt; 3 red: the 3 -> 4 count and moving `to` row on both eras (a second dialog) and the raw-wire `resendFiltered` row; reverted byte-identical, green.
- Promote binding: `binding: planned` becomes `binding: planned.slice(0, 10)` -> the 11-drop unit pin goes red.
  - mutation: `binding: planned.slice(0, 10)`; `env-promote-storage-guard.test.ts` 1 red (the 11-drop binding pin: 10 entries instead of 11); reverted byte-identical, green. A second mutation, `binding: dropped.slice(0, 10)` in `doc-edit.ts`, made the doc-edit pin (11 definitions with names over 600 characters) the 1 red of `doc-edit.test.ts`; reverted byte-identical.
- Decline path: the scope is resolved before a decline is honored -> the decline-after-ask `resendFiltered` request-list pin goes red (two previews).
  - mutation: `await this.resolveConfirmationScope(request)` added to the decline branch, shared dist rebuilt; 3 red: "a decline sends one preview and no execute" on both eras (two previews) and the raw-wire decline row; reverted byte-identical, green.
- Undefined rule: `undefined` on the deciding round is treated as changed -> the count-0/over-cap rows go red.
  - mutation: a deciding-round scope of `undefined` ended the call with `CONFIRMATION_SCOPE_CHANGED`, shared dist rebuilt; 4 red: the count-0 and the 600-over-cap rows on both eras; reverted byte-identical, green.
- Pending-ask cleanup removed -> the "Handler refuses first" row goes red (`unanswered` entry).
  - mutation: `releaseEchoedAsk` made a no-op (`confirmReached === true || confirmReached !== true`; the build reported a TS2367 for the comparison but emitted the dist); 2 red: the "handler refuses first" row on both eras (`[undefined, undefined, 'unanswered']` instead of two entries without `confirmation`); reverted byte-identical, dist rebuilt, green.
- `isConfirmationState` accepts `v: 1` -> the confirmation unit test goes red, and so does the raw-wire `v: 1` row.
  - mutation: `isConfirmationState` accepted `v: 1` as well as `v: 2`; `confirmation.test.ts` 1 red ("rejects the version of the state before the scope digest"); reverted byte-identical, green. The raw-wire `v: 1` row (a payload re-signed as `v: 1` with a guessed key) stays green under this mutation by design: the HMAC key is random per process, so a re-signed state fails the MAC before `isConfirmationState` is reached, and a `v: 1` state with a valid MAC cannot be produced from outside (Rule #54); the row pins the MAC path, and the unit test pins the shape.
- Unit pins added beyond the list: the `ConfirmationScope` binding tests of `message-resend.test.ts` (mutation: `matchCount` added to the `resendFiltered` binding; 2 red, then reverted byte-identical) and the `scopeDigest` tests of `confirmation.test.ts` (mutation: a scope object digested as its string form; 3 red, then reverted byte-identical).
- Review-pass mutations (each applied, observed red, reverted byte-identical with `cmp`, dists rebuilt):
  - mutation: the deciding round's `resolveConfirmationScope` swallowed its error (`.catch(() => undefined)`) -> the new "preview that fails on the round that carries the accept" row goes red on both eras (the call proceeds to the execute).
  - mutation: the `|| !declaresFormElicitation(...)` clause removed from the refusal condition -> the raw-wire "no longer declares form elicitation is refused" row goes red (1 red).
  - mutation: `reasks = state.reasks` removed from the no-answer retry -> the raw-wire "a retry with no answer carries the count of re-asks forward" row goes red (1 red).
  - mutation: the `CONFIRMATION_SCOPE_CHANGED` line of `deriveAuditOutcome` removed -> the "changes on every dialog" row on both eras and the raw-wire refusal row go red (3 red).
  - mutation: `to: input.to === undefined ? undefined : found.to` became `to: found.to` -> the 3 -> 4 count and moving `to` row on both eras and the 43.3 unit row "the scope binds no `to` when the caller gave none" go red (3 red).
  - mutation: `scopeDigest` of `binding: undefined` hashes null instead of the text -> the `confirmation.test.ts` row "digests a binding of undefined as its whole text" goes red (1 red).

- Code-review mutations (2026-11-22; each applied, observed red, restored byte-identical with `git diff --quiet`/`cmp`, dists rebuilt, green):
  - mutation: AC 44.3.5 (no capability, today's contract): the `declaresFormElicitation` shortcut in `confirmOnWire` moved below the scope resolution -> `story-43-3-qa-fallback.test.ts` 4 red (the interop rows with no capability and with url elicitation alone, both eras: the baseline writes gain a preview).
  - mutation: AC 44.3.6 (the docs): the README refusal row's code renamed `CONFIRMATION_SCOPE_CHANGE` -> `story-44-3-doc-claims.test.ts` 1 red (the refusal-table row).
  - mutation: the release on the throw path: `wireCall.confirmReached = true` set in `dispatchToolCall`'s `catch` (the release then runs only for a returned result) -> `story-44-3-qa-ledger.test.ts` 2 red (the document-read-fails row on both eras: a second, `unanswered` entry).
  - mutation: the accept branch removes its pending ask only after the scope resolves -> `story-44-3-qa-ledger.test.ts` 2 red (the preview-fails-on-accept row on both eras: a second, `unanswered` entry).
  - mutation: the `resendFiltered` binding's `|| input.to === ""` removed -> `message-resend.test.ts` 1 red ("the scope binds no `to` when the caller gave an empty one").

**Final run (implement stage, built dists of the working tree):** `pnpm turbo run build` success; `pnpm run lint` and `pnpm run type-check` pass; `@iris-mcp/shared` 2601 passed; `@iris-mcp/dev` 1492 passed (319 skipped, live); `@iris-mcp/admin` 506 passed; `@iris-mcp/interop` 753 passed; `@iris-mcp/all` 6093 passed (729 skipped) in 1234 s, and the two failures of that run (the shared-README phrase pinned by `story-43-3-doc-claims.test.ts`, and the child run of `story-42-1-qa-changeset-readers.test.ts` that includes it) passed after the README sentence was reworded. `story-44-3-confirmation-scope.test.ts` 26 passed and `story-44-3-confirmation-scope-raw-wire.test.ts` 11 passed. `gen:governance-baseline:check`, `gen:tools-list-snapshot:check` (115 entries, 0 new tools) and `gen:ipm:check` pass.

**Shared surfaces:**
- `REFUSAL_CODES` (+1) and its sorted-key test;
- the `ConfirmationState` payload (`v: 2`);
- the `ConfirmationRequest.scope` shape in the promote, doc-edit and resendFiltered unit tests;
- the accepted `resendFiltered` request lists in the 43.3 suites (+1 preview);
- `fake-iris-listener.mjs` (also used by the handler golden) and `sdk-confirmation-rig.ts` (also used by the epic43 capstone);
- the README refusal table and Human confirmation section;
- the `CHANGELOG.md` `[Unreleased]` sections.

Standing criterion: every test added or changed passes on a fresh environment, in either order.

## Auto Run Result

Status: done
Blocking condition: none

Summary: a confirmation is bound to the scope the dialog showed (DW-670, sanction `S-44.3-scope-changed-refusal`). The signed state is `v: 2` with the scope digest and the re-ask count. An accepting round resolves the scope again: an equal digest proceeds, a different one asks again once with the new scope, and a second change (or a client that can no longer be asked) ends the call with `CONFIRMATION_SCOPE_CHANGED`, audited `denied` with `confirmation: "accepted"`. A deciding round that ends before `ctx.confirm` removes the echoed state's pending ask. The comparison lives only in `@iris-mcp/shared`.

Files changed:
- `packages/shared/src/confirmation.ts`, `server-base.ts`, `tool-types.ts`, `refusals.ts`, `index.ts` -- the `v: 2` state, `scopeDigest`/`scopeText`, `confirmOnWire` re-resolution and re-ask, the pending-ask release, the new refusal and its `denied` mapping, the `ConfirmationScope` type.
- `packages/iris-dev-mcp/src/tools/env-promote.ts`, `doc-edit.ts` and `packages/iris-interop-mcp/src/tools/message-resend.ts` -- the gates supply `{ text, binding }`: every Storage drop, every dropped definition, and the `resendFiltered` filter and cap.
- `scripts/lib/fake-iris-listener.mjs`, `sdk-confirmation-rig.ts`, `story-43-3-qa-wire.ts` -- opt-in overrides (`setDocumentContent`, `setResendPreview` with `failPreview`) and an `answer` function.
- New `story-44-3-confirmation-scope.test.ts` (28 tests, both eras) and `story-44-3-confirmation-scope-raw-wire.test.ts` (11 tests); the unit tests, 43.3 suites and refusal list updated for the shapes only.
- `README.md`, `packages/shared/README.md`, `CHANGELOG.md`, `.changeset/story-44-3-confirmation-bound-to-the-scope-shown.md` -- the docs.

Review: 37 findings from four layers (high 0, medium 2, low 19, false 16). Patches applied: 2 medium (the matrix row "Scope resolver throws" got a test and a `failPreview` fake option), 11 low (comment placement, the raw-wire `v: 1` row's name, the `binding: undefined` fallback, the hash-on-every-call early return, four missing mutation lines and their demonstrations). Deferred: none. Every rejected finding and its reason is in the Review Triage Log.

Follow-up review recommended: false (no high patched; one medium patched on this first pass is below the two-medium bar).

Verification: build, lint, type-check, `gen:governance-baseline:check` (141, `1e62c5ad5bf7`), `gen:tools-list-snapshot:check` (115, unchanged) and `gen:ipm:check` pass. After the patches: shared 2601, dev 1492, admin 506, interop 753 passed; the 44.3 suites 28 + 11 and all the 43.3 suites, the epic43 capstone, the handler golden and the doc-claims and changeset-reader suites passed. The full `@iris-mcp/all` run (226 files, 6096 passed) was made before the review patches, which changed only test files, the fake's new option, `scopeDigest`'s undefined case and `releaseEchoedAsk`'s early return; the suites that use those were re-run green.

Residual risks: the scenario runs on the fake listener, not a live IRIS (by design). The raw-wire `v: 1` row pins the MAC path, and the `v: 1` shape check is pinned only by its unit test. `releaseEchoedAsk` runs only after the handler returns or throws, so a round that ends earlier (a governance denial, an unknown profile) leaves its pending ask to the TTL sweep. The spine bookkeeping under Design Notes ("For the lead") is still the lead's.

## Tests Added

QA stage (2026-11-22). Gap-first against the matrix and the gate table; no production code changed. Both files run the BUILT servers against the fake IRIS listeners (no IRIS instance), and fail on a stale dist.

- `packages/iris-mcp-all/src/__tests__/story-44-3-qa-gates.test.ts` (32 tests, real SDK client over stdio, both eras; AC 44.3.2, 44.3.3, 44.3.4):
  - the three whole-text gates the first file ran for one outcome only: `iris_message_resend:resend`, `iris_production_control:clean` + `killAppData`, `iris_audit_manage:purge` -- an accept asks once, writes once, entry `accepted`; a decline writes nothing, one `denied` entry (12 tests);
  - `iris_doc_edit:regenerateStorage` (the only gate with no wire row before): accept once, decline, a change outside the edited lines asks once (the binding is the dropped names, not the document), a change inside the edited lines is `STALE_CONTENT` before the helper (matrix "Handler refuses first": one entry, no `unanswered` entry after close) (8 tests);
  - `iris_env_promote:execute` drops beyond the dialog's cut: the twelfth drop changing while ten are listed re-asks with an identical message and writes only after the second answer; twelve unchanged drops ask once; the tail of a 700-character Storage name changing re-asks; the bound is per logical call (a second call after `CONFIRMATION_SCOPE_CHANGED` gets two dialogs again; entries `ok`, `denied`, `denied`) (8 tests, 4 per era);
  - `iris_message_resend:resendFiltered` decline paths: a dismissed dialog and an accept without the tick send one preview, no execute, one `denied` entry (4 tests).
- `packages/iris-mcp-all/src/__tests__/story-44-3-qa-ledger.test.ts` (5 tests, hand-wire driver, both eras; AD-19 one entry per logical call):
  - a re-asked dialog nobody answers ends as exactly ONE `unanswered` entry when the process stops (the replaced ask is gone) (2 tests);
  - a re-asked dialog the person declines ends as one `denied` entry and the stop adds none (2 tests);
  - probe, modern: a state echoed on a request that names an unknown profile (refused before any handler runs) -- see the finding below (1 test).

Mutations (Rule 19; each on the built path the test guards, dists rebuilt, red shown, restored byte-identical with `git diff`, dists rebuilt, green):
- mutation: AC 44.3.2 / 44.3.4 unchanged-scope rows of every gate (`resend`, `clean`, `purge`, `regenerateStorage`, promote): the comparison in `confirmOnWire` made never equal (`scopeDigest(now) === state.digest + "x"`), shared dist rebuilt; 16 red of 37 in the two new files: the accept rows of the three whole-text gates on both eras, the regenerateStorage accept and "change outside the edited lines" rows, and the promote "same twelve", "twelfth drop" and "700-character tail" rows, on both eras; restored, green.
- mutation: AD-19 one-entry rule after a re-ask: `this.pendingAsks.delete(state.nonce)` removed from the deciding branch of `confirmOnWire`, shared dist rebuilt; 4 red: both ledger rows (nobody answers, declines) on both eras (a second `unanswered` entry for the replaced ask); restored, green.
- mutation: matrix "Handler refuses first" on `regenerateStorage`: `releaseEchoedAsk` made a no-op (`confirmReached === true || confirmReached !== true`; TS2367 reported by the build, dist emitted); 2 red: the STALE_CONTENT row on both eras (an `unanswered` entry after close); restored, green.
- mutation: "no extra request on any decline path" for the cancel and unticked answers: `await this.resolveConfirmationScope(request)` added to the decline branch, shared dist rebuilt; 4 red: the dismissed and unticked `resendFiltered` rows on both eras (two previews); restored, green.
- mutation: the bound is per logical call: the re-ask count kept on the server (`this.qaLeak`) instead of in the signed state, shared dist rebuilt; 2 red: "a new call asks again from no re-asks" on both eras (the second call refused at once); restored, green.
- mutation: promote binds every drop, beyond the tenth: `binding: planned.slice(0, 10)` in `env-promote.ts`, dev dist rebuilt; 2 red: "twelfth drop" on both eras; restored, green.
- mutation: promote binds every drop, beyond the dialog's character cut: `binding: JSON.stringify(planned).slice(0, 600)`, dev dist rebuilt; 4 red: "twelfth drop" and "700-character tail" on both eras; restored, green.
- mutation: doc-edit binds the dropped names, not the document: `binding: dropped` became `binding: lines` in `doc-edit.ts`, dev dist rebuilt; 2 red: "a change outside the edited lines" on both eras; restored, green.

### QA findings for the lead

See the final report of the QA stage (the findings are repeated there with evidence); recorded here so the spec carries them:

1. LOW, informational. The matrix row "round that ends before the handler runs" (governance denial, unknown profile) is not reachable with the SAME call. A state is bound to the tool, the profile and the parsed arguments (`confirmationArgsHash`), governance is frozen at start, and Zod validation of the same arguments is deterministic, so a retry that echoes a valid state of the call always reaches the handler (the one exception, `getOrCreateClient` failing on a first-touch profile, ends as a connection error on round 1 already). The only way a client ends a round before the handler runs while echoing a state is to change the arguments (for example `server: "nowhere"`), and then the state is not that call's: `story-44-3-qa-ledger.test.ts` (the probe) shows the retry's own `error` entry plus an `unanswered` entry for the abandoned ask, i.e. two entries for two logical calls. No fix needed.
2. LOW, informational (Rule #54). `resendFiltered` re-asks only when the preview's `status`, `from`, a caller-given `to` or `maxMessages` changes, and IRIS echoes each of these from the request (`MessageResend.cls`: `body.status ?? 'Errored'`, `from`, `to`, `maxMessages`), which is identical on every round. So against the real system this gate never re-asks on the wire; its binding is pinned by `message-resend.test.ts:1296-1320` (exact binding objects) and the digest by `confirmation.test.ts:294-310`, and no wire test can change those members without a reply shape IRIS cannot produce. The same holds for the whole-text gates (`purge`, `clean`, `resend`): their scope is a pure function of the arguments, so their comparison cannot fire.
3. LOW, informational. `regenerateStorage` cannot re-ask either: `expected` pins the text of the edited range, so the dropped names are a function of the arguments; a change inside the range ends as `STALE_CONTENT` before the helper. The binding is pinned by the unit test, and the wire row that mutates it is "a change outside the edited lines asks once".
4. LOW. The `v: 1` state rejection cannot be pinned at the wire without the per-process HMAC key (`randomBytes(32)` in the `confirmationCodec` field of `server-base.ts`): a `v: 1` state with a valid MAC is not producible from outside, and the raw-wire row already pins the MAC path. Left to `confirmation.test.ts` ("rejects the version of the state before the scope digest").
5. LOW (test infrastructure). The fake saves only `Demo.Sample.cls` and `Demo.Stored.cls` (a `PUT` of another name is a 404), so a promotion of many documents halts at its first save; the twelve-drop rows pin the dialogs and that no save precedes the second answer, not twelve saves.
