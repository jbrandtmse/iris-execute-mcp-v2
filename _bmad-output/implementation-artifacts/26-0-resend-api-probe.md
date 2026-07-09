# Story 26.0: Resend API Probe (mandatory Rule #16)

Status: done

<!-- Epic 26 Story 0 — the MANDATORY Rule #16 probe. The exact Ens.MessageHeader resend API is UNVERIFIED until this story pins it from source + live probe. NO spec-driven coding (26.1+) may start until §§3-4 are amended with pinned signatures. -->

## Story

As a **suite maintainer implementing `iris_message_resend`**,
I want **the exact IRIS message-resend API pinned from `EnsPortal.MessageResend` source + a live probe on a scratch production**,
so that **Stories 26.1–26.3 build the resend handlers against verified signatures and observed semantics, not memory or extrapolation (Rules #16/#42)**.

## Acceptance Criteria

From `_bmad-output/planning-artifacts/epics.md` Epic 26 → Story 26.0 and binding spec `research/feature-specs/04-message-resend.md` §2.

- **AC 26.0.1** — `irislib/EnsPortal/MessageResend.cls` (+ `MessageResendEdit.cls`, `MessageResendAfter.cls` as relevant) traced to the underlying `Ens.MessageHeader` / `Ens.MessageHeaderBase` method family. The REAL resend method name(s), signature(s), argument order, and return value(s) are pinned FROM SOURCE (candidates to confirm/reject: `ResendDuplicatedMessage`, resubmit variants — do NOT trust the candidate names; pin what the source actually calls). Rules #2/#16.
- **AC 26.0.2** — A disposable `ExecuteMCPv2.Temp.ResendProbe` class is exercised against a scratch/running production covering the spec §2 matrix, capturing OBSERVED semantics:
  - resend of a **completed** message → does it create a NEW header? capture the new header ID + its linkage to the original.
  - resend of an **errored** message.
  - resend targeting a **stopped/absent** target item → error shape.
  - whether the **production must be running** for resend to succeed (if so → a validated precondition returning a clear error, per §2 step 3).
  - behavior when the **message body class no longer exists**.
- **AC 26.0.3** — Spec `04-message-resend.md` §§3–4 amended in place with the pinned signatures + observed semantics (including any "production must be running" precondition as a validated error). The probe class AND all scratch artifacts (temp production/messages) are deleted (IRIS + disk). Findings recorded in this story's Dev Agent Record.
- **AC 26.0.4** — Any spec CLAIM found to be wrong is corrected in place AND flagged in Dev Notes for the retro (Rule #42). **Known claim to verify:** spec §3 says "reuse the **existing** `horologToIso` helper in the interop package" — grep shows NO `horolog`/`horologToIso` in `packages/iris-interop-mcp/src/`. Confirm where the conversion actually lives (shared package? a differently-named helper? the diagram/messages tool?) or record that 26.2 must add it. Do NOT let 26.1/26.2 assume a helper that isn't there.

## Tasks / Subtasks

- [x] Task 1 (AC 26.0.1): Source-read the SMP resend plumbing — NO IRIS needed, pure file reads:
  - [x] Read `irislib/EnsPortal/MessageResend.cls` — find the method the SMP "Resend" button invokes; trace every call into `Ens.MessageHeader`/`Ens.MessageHeaderBase`.
  - [x] Read `irislib/Ens/MessageHeader.cls` + `irislib/Ens/MessageHeaderBase.cls` — pin the resend/resubmit classmethod(s): exact name, `As`-signature, arg order/types, ByRef outputs, return `%Status` vs new-id, and any production-running assumption in the method body/comments.
  - [x] Read `MessageResendEdit.cls`/`MessageResendAfter.cls` for edit-and-resend (out of v1 scope — note but don't build).
  - [x] Record the pinned API table in Dev Agent Record.
- [x] Task 2 (AC 26.0.2): Live probe on a scratch production (see Dev Notes → "Environment / production" — the lead pre-stages a running production; its name is recorded there):
  - [x] Create `ExecuteMCPv2.Temp.ResendProbe` (`.cls` on disk → `iris_doc_load` glob path Rule #17 → compile). Use a classmethod probe (execute_classmethod works only on class methods — CLAUDE.md).
  - [x] Send / locate a test message on the scratch production; run each matrix case; capture new-header IDs + error shapes via `^ClineDebug` or method return.
  - [x] Confirm the production-running precondition empirically.
- [x] Task 3 (AC 26.0.3/26.0.4): Amend spec §§3–4 with pinned signatures + observed semantics; correct the `horologToIso` claim (AC 26.0.4); DELETE the probe class (IRIS via `iris_doc_delete` + disk) and any scratch messages/production created solely for the probe. Confirm deletion.

## Dev Notes

### This is a research/probe story — deliverable is KNOWLEDGE, not production code

- NO handler code, NO tool code, NO bootstrap change in 26.0. The output is: (1) the pinned-API table in this file, (2) the amended spec §§3-4, (3) probe artifacts deleted. Stories 26.1+ consume it.
- Probe-first is the whole point (Rule #16): the candidate names in the spec (`ResendDuplicatedMessage`, "resubmit variants") are UNVERIFIED. Pin what the source truly calls. Story 22.1's retro proved spec-suggested API names are often wrong.

### Environment / production (live-probe prerequisite)

- The live probe needs a RUNNING interop production. The Project Lead has authorized starting HSCUSTOM's interop production for exactly this purpose (memory `project_epic26_interop_production`): use a disposable scratch production + test message; do NOT resend real clinical data.
- **Live environment as of the gate (lead-observed 2026-07-09):** default profile = HSCUSTOM; governance has **no preset and is fully open** — `iris_production_control:start/stop/recover` are all `true`, so you may start/stop a production directly. HSCUSTOM has two **Stopped** productions available as scratch targets: **`SessionAgent.Sample.Production`** (a sample production — the recommended scratch target; start it, drive/locate a test message through it, probe resend, then stop it) and a stale **`ExecuteMCPv2.Temp.Story172Prod`** (leftover from Story 17.2 — do NOT rely on it; if you want, note it for cleanup but that's out of 26.0 scope). SADEMO's `SessionAgent.Sample.Production` is `Troubled` (avoid).
- If a running production is NOT available when you start Task 2 (e.g. start fails), STOP with `## Clarification Needed` rather than resending against unknown state.
- `iris_execute_classmethod` works on CLASS methods only; instance methods need a classmethod wrapper (CLAUDE.md). Use `^ClineDebug` for step capture; clean it up after.

### IRIS MCP access

- Task 1 is pure file reads (`irislib/` is on disk). Task 2 needs `iris-dev-mcp` (doc load/compile/execute_classmethod/doc_delete) + `iris-interop-mcp` (production status/messages) tools. If you cannot reach the IRIS MCP tools from your context, STOP with `## Clarification Needed` naming the missing tool — the lead will run the live-probe portion and feed findings back (Task 1 source-read can still complete regardless).

### Constraints

- ObjectScript basics (`.claude/rules/iris-objectscript-basics.md`): no `_` in class/method/param names; `///` doc comments; argumentless `Quit` in Try/Catch; classmethod probes.
- Interop.cls is **2485 lines** — near practical size limits; Stories 26.1 will likely put handlers in a NEW `src/ExecuteMCPv2/REST/MessageResend.cls` (spec §4 allows this). Note in the amended spec which file 26.1 should use.
- Delete ALL probe artifacts (Rule #16 discipline). A leftover `Temp.ResendProbe` or scratch production is a review finding.

### References

- [Source: _bmad-output/planning-artifacts/research/feature-specs/04-message-resend.md#2. MANDATORY Story 0 — API probe]
- [Source: irislib/EnsPortal/MessageResend.cls, irislib/Ens/MessageHeader.cls, irislib/Ens/MessageHeaderBase.cls]
- [Source: src/ExecuteMCPv2/REST/Interop.cls (message-query + production-control patterns; 2485 lines), src/ExecuteMCPv2/REST/Dispatch.cls (interop routes ~lines 100-135)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 26.0]

## Dev Agent Record

### Agent Model Used

Claude Sonnet 5 (claude-sonnet-5), via `bmad-dev-story` skill.

### Debug Log References

Live probe used method-return-value capture instead of `^ClineDebug` (each `ExecuteMCPv2.Temp.ResendProbe` classmethod formats and returns a human-readable summary string directly, since `execute_classmethod` doesn't surface `ByRef`/`Output` args) — no debug global was needed or left behind.

### Completion Notes List

- Both IRIS MCP tool families (`iris-dev-mcp`, `iris-interop-mcp`) were reachable from this session — Task 2 live probe completed in full; no `## Clarification Needed` halt required.
- Confirmed candidate `ResendDuplicatedMessage` is exactly right — it's the only method the SMP "Resend" button invokes (`EnsPortal.MessageResend.cls:370`). The spec's other candidate framing ("resubmit variants") pointed at a real but WRONG method family (`ResubmitMessage`) — pinned and explicitly excluded, see below.
- Live probe used `SessionAgent.Sample.Production` (per Dev Notes) — started it, drove two `RunScenario` calls ("none" happy path, "businessOperationFailure" injected failure) to generate real completed/errored headers, ran 6 probe cases via a disposable `ExecuteMCPv2.Temp.ResendProbe` classmethod probe, then deleted all 28 probe-generated `Ens.MessageHeader` rows (verified 0 remaining `ID >= 82546`), stopped the production back to its pre-probe `Stopped` state, and deleted the probe class from IRIS + disk. `git status --short` after cleanup shows no trace of the probe class.
- One own-probe-methodology bug surfaced and self-corrected during Task 2: a hand-built synthetic header omitted `Priority` (no `InitialExpression` on `Ens.MessageHeaderBase.Priority`), which made `Ens.Queue.EnQueue` throw `<SUBSCRIPT>` on `^Ens.Queue("<target>","")`. Not a product finding — flagged only as a probe footnote in the spec amendment; real (already-enqueued) headers always have `Priority` set, so `iris_message_resend` (which only ever resends EXISTING headers) cannot hit this.
- AC 26.0.4 claim VERIFIED WRONG: spec §3's "reuse the existing `horologToIso` helper in the interop package" — `grep -r horolog packages/iris-interop-mcp/src/` returns zero matches. The only `horologToIso` in the repo is package-local to `packages/iris-data-mcp/src/tools/analytics.ts`. Root cause of the wrong claim: the interop package's message tools pull `TimeCreated` via SQL `SELECT` against `Ens.MessageHeader` (`Ens.DataType.UTC`/`%TimeStamp`), which IRIS SQL already renders as an ODBC-formatted string, not raw `$HOROLOG` — so no conversion helper was ever needed there, and none exists. Corrected in spec §3 (see amendment); flagged for retro (Rule #42 — spec's own claims, not just API shapes, need live verification).
- Spec §§2–4 amended in place (see `_bmad-output/planning-artifacts/research/feature-specs/04-message-resend.md`): §2 marked RESOLVED with a pointer to this file (original probe brief kept collapsed for history); §3 output-notes corrected; §4 gained a full "Pinned resend API" + "Observed semantics" subsection that Stories 26.1/26.2 should treat as authoritative over the original speculative §4 prose.
- **Flag for retro / Story 26.1-26.2 attention (beyond AC 26.0.4's specific claim):** the probe surfaced a genuine UX ambiguity not anticipated by the spec — "resend an errored message" is ambiguous between the Response-type error-payload header (IsError=true, usually a no-op on resend) and the Request-type Status=Error header (the actually-useful retry target). Recommend `preview`'s resendability verdict explicitly steer toward Status=Error Request headers. Also recommend `preview` independently check `MessageBodyClassName` existence, since `ResendDuplicatedMessage` itself never validates it and the post-resend header state does not surface a missing-body-class failure (it's only visible in the Ensemble Event Log).

### Pinned Resend API (from source — AC 26.0.1)

**The SMP "Resend" button** (`irislib/EnsPortal/MessageResend.cls:370`, method `ReallyResend()`) calls exactly:
```objectscript
Set tSC=##class(Ens.MessageHeader).ResendDuplicatedMessage(tMsgId,.tNewHeaderId,..NewTarget,,,..HeadOfQueue)
```

**`Ens.MessageHeader.ResendDuplicatedMessage`** (`irislib/Ens/MessageHeader.cls:274`) — THE pinned API for `iris_message_resend`:
```objectscript
ClassMethod ResendDuplicatedMessage(
    pOriginalHeaderId As %String,
    Output pNewHeaderId As %String,
    pNewTarget As %String,
    pNewBody As %RegisteredObject,
    pNewSource As %String,
    pHeadOfQueue As %Boolean
) As %Status
```
- Returns `%Status`; new header id is an `Output` arg, NOT the return value.
- Implementation: `NewDuplicatedMessage()` builds a clone via `%ConstructClone`, `ResendDuplicatedMessage` then `Ens.Queue.EnQueue()`s it and audits via `$$$AuditResendMessage`.
- Precondition (inside `NewDuplicatedMessage`, `MessageHeader.cls:286`): `'##class(Ens.Director).IsProductionRunning()` → `Quit $$$ERROR($$$EnsErrProductionNotRunning)`. Macro `$$$EnsErrProductionNotRunning` = `"<Ens>ErrProductionNotRunning"` (`irislib/EnsErrors.inc:126`). The SMP itself detects this precondition by substring match `errText [ "ErrProductionNotRunning"` (`MessageResend.cls:375`) — our handler should do the same (or pre-check `IsProductionRunning()` directly).
- Bad/absent target (Request-type, `pNewTarget` given or original target no longer resolves a queue): `$$$ERROR($$$EnsErrGeneral,"Target config item '<name>' is not running")`. No new header created on this path — verified live (`pNewHeaderId` empty).
- Response-type original: non-empty `pNewTarget` REJECTED ("Can not send response messages to new target"); reply-queue existence checked ("Target reply queue '<name>' no longer exists" if gone).
- `pNewSource` override on a synchronous request (`ReturnQueueName` set) REJECTED: "Cannot override source for synchronous request message `<id>`".
- `MessageBodyClassName`/`MessageBodyId` copied as plain strings — NOT opened/swizzled during resend (see Observed Semantics #5).
- `Description` on the new header gets `"Resent <originalId>"` prepended — the ONLY structural linkage back to the original. The `Resent` property (`Ens.MessageHeaderBase.Resent`, VALUELIST `,,r,b`) exists but is **NOT set** by this call (confirmed empty on resent headers live) — do not rely on it; the handler should track `{originalId, newHeaderId}` itself.
- New header keeps the SAME `SessionId` as the original (not a new session).

**`Ens.MessageHeader.ResubmitMessage`/`PrepareResubmitMessage`** (`MessageHeader.cls:231`/`239`) — a DIFFERENT, real method family. NOT called by the SMP button. Resubmits the SAME header in place (mutates existing row, no new id). Its production-not-running failure text differs (`"ProductionNotRunning; not resubmitting message '<id>'"`, an `$$$EnsErrGeneral`-wrapped literal, NOT the `$$$EnsErrProductionNotRunning` macro) — inconsistent with `ResendDuplicatedMessage`'s shape. **Explicitly out of scope** — v1 only implements what the SMP button actually does.

`Ens.MessageHeader.ResendMessage(pHeaderId)` (`MessageHeader.cls:222`) is `[Internal, Deprecated]`, pure passthrough to `ResubmitMessage`. Not used anywhere relevant; ignore.

`EnsPortal.MessageResendEdit.cls`/`MessageResendAfter.cls` — confirmed to exist and drive the "Edit and Resend" ribbon button + results page respectively; not read in full detail since edit-and-resend is spec §8 out-of-scope v1. Their existence confirms v1's scoping decision is sound (edit-and-resend is a genuinely separate code path from the plain resend flow probed here).

### Observed Semantics (live probe — AC 26.0.2)

Probe run against HSCUSTOM, production `SessionAgent.Sample.Production` (started for the probe, stopped again after — pre-existing reusable sample fixture, not created solely for this story). Test data generated via `SessionAgent.Sample.BS.OrderIngest.RunScenario("none")` and `RunScenario("businessOperationFailure")`; verified via `iris_sql_execute` against `Ens.MessageHeader` and `Ens_Util.Log` (Event Log) between each probe call.

1. **Resend of a completed message** (header 82546, Type=Request, Status=9/Completed, IsError=false) → `ProbeResend(82546)` returned `sc=OK`, new header **82560** created. New header: SAME SessionId (82546) as original, `Description="Resent 82546"`. The new Request header re-entered the FULL pipeline — BP.OrderRouter reprocessed it and fanned out to Validator + both Operations again (headers 82561-82566), i.e. resend of a Request re-runs the whole downstream chain, not a single-hop retry.
2. **Resend of an errored message** — probed BOTH candidate interpretations:
   - **Response-type error header** (82558: `SessionAgent.Sample.BO.SqlPersist → SessionAgent.Sample.BP.OrderRouter`, Type=Response, IsError=true, injected `<Ens>ErrGeneral` body) → `ProbeResend(82558)` returned `sc=OK`, new header **82567** created (SessionId=82553, `Description="Resent 82558"`, `CorrespondingMessageId=82556` unchanged from the clone). BUT the redelivered response landed with **Status=4 (Discarded)** on `BP.OrderRouter` — the BP had no live correlation waiting for it (the original session had already completed). **Resending a Response-type error header is a harmless no-op, not a useful retry.**
   - **Request-type Error-status header** (82557: `BP.OrderRouter → SessionAgent.Sample.BO.FilePublish`, Type=Request, Status=8/Error) → `ProbeResend(82557)` returned `sc=OK`, new header **82568** created and actually redelivered to the failing operation, which reprocessed it (still Status=8/Error since the injected `ErrorMode` travels on the message body, unchanged) and generated a fresh Response (82569, Status=4/Discarded, same no-correlation reason as above). **This is the semantically correct "errored message" to resend** — the request TO the failed host, not its generated error response. `preview`'s resendability verdict should steer toward Status=Error Request headers.
3. **Resend targeting a stopped/absent target item**: `ProbeResend(82546, "ZZNoSuchTarget12345")` → `sc=ERR`, text = `<Ens>ErrGeneral: Target config item 'ZZNoSuchTarget12345' is not running`, `newId` **empty** (confirmed no write on refusal — matches the spec §2 no-write-on-refusal requirement).
4. **Production-must-be-running precondition — CONFIRMED.** Stopped the production, then `ProbeResend(82574)` → `sc=ERR`, text = `<Ens>ErrProductionNotRunning: No production is running`, `newId` empty. Matches the pinned `$$$EnsErrProductionNotRunning` macro text exactly. Confirms spec §2's speculative "if production must be running, add a validated precondition" — **yes**, and this is the exact failure shape to detect/wrap.
5. **Message body class no longer exists**: built a synthetic header with `MessageBodyClassName="ZZNoSuch.BogusClass12345"` (nonexistent), resent it — `ProbeResend` returned `sc=OK`, new header **82575** created; `Ens.MessageHeader.Status`/`IsError` on BOTH the original synthetic header (82574) and the resent copy (82575) stayed clean (`Status=9`, `IsError=false`). The resend call NEVER validates body-class existence (MessageBodyClassName/Id are plain strings, not opened). HOWEVER, the delivered header WAS routed to `BP.OrderRouter`, which DID try to open the body and threw — confirmed in the Event Log: `Ens_Util.Log` entry `ERROR <Ens>ErrException: <CLASS DOES NOT EXIST>%requestGet+2^Ens.BusinessProcess.1 *ZZNoSuch.BogusClass12345`. **This failure is invisible on the header itself** — only visible in the Event Log — so `preview` should independently verify `MessageBodyClassName` exists (`$$$comClassDefined` / `%Dictionary.CompiledClass.%ExistsId`) rather than relying on resend/header state to catch it.

**Cleanup verification:** all 28 probe-generated `Ens.MessageHeader` rows (IDs 82546-82575, minus 2 already-cleaned malformed intermediate rows) deleted via the probe's own `CleanupHeaders` classmethod; confirmed `SELECT ID FROM Ens.MessageHeader WHERE ID >= 82546` returns 0 rows post-cleanup. Production confirmed `Stopped` (matching its pre-probe state). Probe class deleted from IRIS (`iris_doc_delete`) and disk (`src/ExecuteMCPv2/Temp/ResendProbe.cls` removed, empty `Temp/` dir removed); `git status --short` shows no trace.

### File List

(none — this is a research/probe story; no production code, tests, or bootstrap changes. The disposable `ExecuteMCPv2.Temp.ResendProbe.cls` was created, used, and deleted entirely within this story — never committed. Only non-code artifacts touched: this story file and `_bmad-output/planning-artifacts/research/feature-specs/04-message-resend.md`.)

## Review Findings

**Code review (bmad-code-review, 2026-07-09) — ✅ CLEAN. 0 findings (0 decision-needed, 0 patch, 0 defer, 0 dismissed). Status → done.**

This is a Rule #16 probe where pin-correctness IS the deliverable, so the review independently re-verified every pinned claim against source (Rules #2/#16) rather than accepting the Dev Agent Record:

- **AC 26.0.1 — pinned resend API is EXACT.** Independently confirmed `Ens.MessageHeader.ResendDuplicatedMessage(pOriginalHeaderId, .pNewHeaderId, pNewTarget, pNewBody, pNewSource, pHeadOfQueue) As %Status` at `irislib/Ens/MessageHeader.cls:274` — signature, arg order, `Output`/return shape all match. The SMP button call site `##class(Ens.MessageHeader).ResendDuplicatedMessage(tMsgId,.tNewHeaderId,..NewTarget,,,..HeadOfQueue)` verified at `irislib/EnsPortal/MessageResend.cls:370` (`ReallyResend()`), and the `errText [ "ErrProductionNotRunning"` substring detection at `:375`. The `ResubmitMessage`/`PrepareResubmitMessage` different-family exclusion verified at `:231`/`:239` (production-not-running text `"ProductionNotRunning; not resubmitting message '<id>'"` at `:242` — genuinely inconsistent shape as documented); `ResendMessage` `[Internal, Deprecated]` passthrough verified at `:222`.
- **Precondition + error shapes source-backed.** `'##class(Ens.Director).IsProductionRunning() Quit $$$ERROR($$$EnsErrProductionNotRunning)` at `MessageHeader.cls:286`; macro `$$$EnsErrProductionNotRunning = "<Ens>ErrProductionNotRunning"` at `irislib/EnsErrors.inc:126`. Bad-target `"Target config item '<name>' is not running"` at `:298`; Response-type `"Can not send response messages to new target"` at `:301`; `Description="Resent "_pOriginalHeaderId` at `:323`; `MessageBodyClassName`/`Id` copied as plain strings (never opened) — all consistent with the observed-semantics table. No caret-globals in either error string (Rule #33 compliant), as the amendment notes.
- **AC 26.0.4 correction is CORRECT and defensible.** Confirmed zero `horolog`/`horologToIso` matches under `packages/iris-interop-mcp/src/`; the only repo `horologToIso` is package-local to `packages/iris-data-mcp/src/tools/analytics.ts`. The "timestamps arrive pre-formatted via SQL ODBC string" claim verified against `src/ExecuteMCPv2/REST/Interop.cls:1036-1062` — `iris_production_messages` SELECTs `TimeCreated`/`TimeProcessed` via `%SQL.Statement` and passes them straight through, no conversion. Correction will not mislead Story 26.2.
- **Probe-artifact cleanup verified (Rule #16 discipline).** No `*Resend*`/`*ResendProbe*` files under `src/`; no `src/**/Temp` dir. Story documents IRIS-side deletion (`iris_doc_delete`, 0 rows `ID >= 82546`, production returned to `Stopped`).
- **Spec amendment quality — GOOD.** §§2-4 carry pinned signatures + the production-running precondition as a validated error; §4 explicitly directs Story 26.1 to a NEW `src/ExecuteMCPv2/REST/MessageResend.cls` (Interop.cls at 2485 lines). Story-breakdown §6 / ACs §7 / out-of-scope §8 remain internally consistent with the amendments. Clear enough for 26.1/26.2 to build against.

Rule-3/5/6/1 stage exclusions applied: 0 tests is the correct outcome for a research/probe story (no executable surface), not a Rule-3 violation.
